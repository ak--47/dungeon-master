# bounded alignment sweep

```sh
node tests/alignment/run.mjs --sweep --timeout-ms=600000
```

opt-in only. the runner performs the build check, OS network preflight, independent sweep infrastructure tests, then the actual sweep. it does not run generated regression tests. a red retention gate cannot block diagnostic data collection. build or network preflight failures still stop the run.

## one deadline covers the whole command

the outer runner owns the 600-second maximum, including build, preflight, tests, pilots, generation, measurement, and report writes. each generation cell runs in a fresh detached process group under macOS `sandbox-exec` with `(deny network*)`. there is no unsupported-OS fallback. worker descendants inherit the sandbox. no dependencies or network services are required.

the parent kills the active process group with `SIGKILL` at the deadline or on interruption. the worker also has a 512 MiB V8 heap limit. a separate 16 MiB watchdog thread samples process RSS every 100ms and kills the worker above 900 MiB. sampling can briefly overshoot. each requested dungeon is capped at 300,000 events. treatment and neutral samples run sequentially, with only compact summaries retained between samples. no event files are written.

the hanging-worker test runs the real runner with a 12-second deadline from inside the parent sandbox. it requires completed preflight, a recorded worker PID and descendant PID, exit 124, and both PIDs gone. a timeout in the build stage fails this test. `--probe-hang` is test-only and cannot produce a successful sweep.

## coverage follows measured cost

the pilot runs all seven focus scenarios at 300 users, sparse traffic, and all three fixed seeds. candidates cover 100, 300, 1,000, 3,000, and 10,000 users, with 0.3 and 0.9 requested events per user per day. 5% and 95% target shares exercise both rare target and rare control cohorts at 1,000 users. conditions, personas, and experiment variants receive local weight overrides through the existing scenario API.

conditions cells get first claim on every stratum, including a 10,000-user dense single dungeon. remaining budget goes to persona conversion, persona TTC, persona volume, experiment, hook TTC, and retention. every scheduled group contains all three seeds. the estimate scales the measured scenario pilot cost by users and traffic, adds process overhead, and applies a 1.5 safety factor. the scheduler reserves five seconds for final reporting. it records deferred groups and their estimates. a selected group is never silently skipped.

the result is complete only when every scheduled cell completes and every required size, both traffic levels, and both rarity directions appear. the candidate matrix can exceed the budget; deferred groups are untested. full seed spreads for a scenario/stratum require three completed cells. memory failures and deadline kills produce partial results and nonzero exit status.

## measurements preserve strict thresholds

each cell calls `scenarioConfig`, applies local overrides, calls `runFixture`, and calls `measureScenario`. requested and validator-resolved selected knobs are recorded separately. the resolved snapshot comes from a fresh equivalent config passed through the same validator; generation still starts from the original requested config. credentials, source functions, profiles, and event arrays never enter the report. warnings, unique target/control entrants and conversions, retention entrants and returns, event counts, elapsed time, generation throughput, and peak RSS do.

95% Wilson intervals use unique-user counts. TTC uses converted users for its evidence minimum. volume is measured per profile, with entrant minima retained from the scenario contract. event totals are throughput data only. fixed-seed minimum/mean/maximum effects describe seed sensitivity; they are not inferential confidence intervals. retention uses the treatment-minus-neutral D7 return rate. its neutral check replays the same seeded neutral dungeon to test determinism, not an independent population comparison.

labels remain separate:

- `supported`: effect and neutral remain inside the existing strict scenario bands.
- `insufficient-evidence`: a user denominator is below the scenario minimum or an effect is undefined. expected at small N.
- `diluted`: enough users, but the effect moves toward the null beyond the permitted band.
- `inverse`: enough users, but the measured effect points in the wrong direction.
- `contractfail`: invalid unique counts, a neutral miss, or a strict effect-band miss beyond the requested effect.

experiment conversion and TTC receive separate labels. the cell reports the more severe result. low-N does not throw an assertion or relax a regression threshold. sparse traffic, rarity changes, and retention receive `diagnostic-unsupported-envelope` context once evidence is sufficient. this context does not excuse the measured failure. retention curves allocate active days; their weights are not calibrated day-7 probabilities across every traffic level.

## reports and exits

the default outputs are `tests/alignment/sweep-results.json` and `tests/alignment/sweep-results.md`. `--output=path-prefix` selects another existing directory. the runner writes atomic compact checkpoints before and after cells, then final status and summaries. JSON ordering follows the fixed schedule. measurements are seeded; elapsed time, RSS, budget selection, and process IDs are operational metadata and can vary.

- exit `0`: completed required coverage, with only supported or insufficient-evidence cells.
- exit `1`: completed with diagnostic findings, or build/test errors.
- exit `2`: incomplete execution or required coverage, invalid arguments, or unsupported OS.
- exit `124`: hard deadline.
- exits `130` / `143`: interruption.

the report distinguishes cumulative event count from the largest single dungeon. it supports claims only about observed cells. a sweep with no large-cell regression would show no upper cliff observed in those cells; it would not establish a universal scaling guarantee.