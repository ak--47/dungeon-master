# bounded alignment sweep

```sh
node tests/alignment/run.mjs --sweep --timeout-ms=600000
```

opt-in only. the runner performs the build check, OS network preflight, independent sweep infrastructure tests, then the actual sweep. it does not run generated regression tests. a red retention gate cannot block diagnostic data collection. build or network preflight failures still stop the run.

the inline infrastructure stage selects pure evidence, scheduling, and reporting tests. process-lifecycle tests run separately before release. this prevents a short outer deadline from orphaning detached test workers under the Vitest stage.

## one deadline covers the whole command

the outer runner owns the 600-second maximum, including build, preflight, tests, pilots, generation, measurement, and report writes. each generation cell runs in a fresh detached process group under macOS `sandbox-exec` with `(deny network*)`. there is no unsupported-OS fallback. worker descendants inherit the sandbox. no dependencies or network services are required.

the parent kills the active process group with `SIGKILL` at the deadline or on interruption. the worker also has a 512 MiB V8 heap limit. a separate 16 MiB watchdog thread samples process RSS every 100ms and kills the worker above 900 MiB. sampling can briefly overshoot. each requested dungeon is capped at 300,000 events. treatment and neutral samples run sequentially, with only compact summaries retained between samples. no event files are written.

the hanging-worker test runs the real runner with a 12-second deadline from inside the parent sandbox. it requires completed preflight, a recorded worker PID and descendant PID, exit 124, and both PIDs gone. a timeout in the build stage fails this test. `--probe-hang` is test-only and cannot produce a successful sweep.

## coverage follows measured cost

the pilot runs all seven focus scenarios at 300 users, sparse traffic, and all three fixed seeds. candidates cover 100, 300, 1,000, 3,000, and 10,000 users, with the scenario API's unchanged 0.5 and 0.9 requested events per user per day. both rates are sparse; `dense` is only the historical label for 0.9. an additional 11,111-user dense conditions group requests 299,997 events per dungeon, near the unchanged 300,000 cap. 5% and 95% target shares exercise both rare target and rare control cohorts at 1,000 users. conditions, personas, and experiment variants receive local weight overrides.

all seven scenarios at 1,000 users and both traffic levels get first claim on the budget, followed by hook TTC at 3,000 users in both traffic levels. conditions cells cover the remaining sizes, rarity, and near-cap dungeon. remaining budget expands other scenarios. every scheduled group contains all three seeds. after each group, the scheduler uses real remaining wall time and updates estimates from the nearest completed scenario sizes. it separates 200ms process overhead from rate-scaled work and applies a 1.35 safety factor. it reserves five seconds for reporting. unused estimates are not subtracted from future wall time. deferred groups and estimates remain explicit.

the result is complete only when every scheduled cell completes and all three seeds cover every required size, both rarity directions, each focus scenario at 1,000 or more users under both traffic levels, both 3,000-user hook TTC groups, and the near-cap group. the candidate matrix can exceed the budget; deferred groups are untested. memory failures and deadline kills produce partial results and nonzero exit status.

## measurements preserve strict thresholds

each cell calls `scenarioConfig` with the users override, applies rarity overrides, and uses `runFixture` and `measureScenario`. for hook TTC, the worker reproduces the scenario implementation's full-stream capture inside the actual hook: untouched records, factor-1 copies, post-hook records, and final emitted records. the shared `measurePairedTtc` verifies exact IDs, membership, anchors, control fields, timestamp bounds, and storage session relabels. Q is `baselineAdjustedTtcRatio`; N is `interventionNeutralTtcRatio`, exactly 1. the report also retains raw and baseline target/control ratios. no missing paired values are reconstructed from raw TTC.

requested and validator-resolved selected knobs are recorded separately. the resolved snapshot comes from a fresh equivalent config passed through the same validator; generation still starts from the original requested config. credentials, source functions, profiles, and event arrays never enter the report. warnings, observed Background Activity standalone counts, unique target/control entrants and conversions, retention entrants and returns, event counts, elapsed time, generation throughput, and peak RSS do. undefined numeric quantities become null with their JSON paths recorded, never invented finite values. compiler version, Node version, repository commit, and start/end SHA-256 hashes of the compiler, engine, and sweep harness establish provenance. changed sources prevent a completed claim.

95% Wilson intervals use unique-user counts. TTC requires at least 70 converted users in each target/control arm, including the paired hook checks. volume is measured per profile, with entrant minima retained from the scenario contract. event totals are throughput data only. fixed-seed minimum/mean/maximum effects describe seed sensitivity; they are not inferential confidence intervals. retention uses high-minus-low D7 return rate with at least 250 eligible users per run. its neutral compares target-minus-control profile segments inside the same low-curve run with at least 100 eligible users each. only two dungeons run; identical replays do not establish a neutral effect.

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