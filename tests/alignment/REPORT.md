# alignment audit: final validation complete

the clone provenance repair, alignment gate, full unit/integration regression,
and post-repair sweep are complete. [FINAL-VALIDATION.md](FINAL-VALIDATION.md)
is the authoritative record. the main executor reported its firsthand gate
result: 175 tests passed across nine files in 60.65s at `5e0caa5`.
this documentation pass reran no tests, generation, analytics, or live queries.

## recorded sweep

latest artifact commit: `fd112f8`. production source: `5e0caa5`.
regression config commit and sweep run HEAD: `6df615e`.
see [SWEEP-RUN.md](SWEEP-RUN.md) for commands, chronology, and sampling limits;
[sweep-results.json](sweep-results.json) contains the measurements.

| measurement | recorded result |
| --- | ---: |
| completed cells / dungeon generations | 297 / 594 |
| cumulative emitted events | 17,083,972 |
| elapsed / deadline | 339097ms / 600000ms |
| supported / insufficient-evidence cells | 125 / 172 |
| diluted / inverse / contractfail cells | 0 / 0 / 0 |
| deferred groups | 0 |
| largest single dungeon | 281,751 events |
| start/end source hashes | 77, all unchanged during the run |

the near-cap group requested 299,997 events per dungeon. peak worker RSS was
602 MiB. the 512 MiB V8 heap cap and sampled 900 MiB RSS guard stayed in place.
cumulative output does not prove a 17-million-event single-dungeon capacity.
172 cells lack enough independent users for acceptance; they do not count as passes.
all 77 start/end hashes matched the post-repair source. no worker, memory, or
deadline failure occurred. the run retained 42 persona-conversion saturation warnings.

## completed checks have separate scopes

| evidence | recorded result and limit |
| --- | --- |
| [FINAL-VALIDATION.md](FINAL-VALIDATION.md), alignment gate | main executor's firsthand result: 175 passed, nine files, 60.65s at `5e0caa5`; includes 12 clone contracts |
| [regression-vitest.config.js](regression-vitest.config.js), full unit/integration | 1,838 passed, one existing skip, 93 files, 20.58s; unit: 60 files / 1,486 passed; integration: 33 files / 352 passed / one skipped |
| post-repair sweep stages | TypeScript 5.8.3 `--noEmit` passed; two preflight tests passed in 0.132s; eight selected infrastructure tests passed in 0.365s, three excluded by the existing filter |
| [REPAIRS.md](REPAIRS.md) | 72 counting contracts plus 163 existing funnel regressions passed; source-derived C1-C4 repairs, including shared-edge completion without reentry |
| [GENERATED-FAILURES.md](GENERATED-FAILURES.md) | latest generated-only run: 30 passed, 32.96s, 11 stable start/end hashes; historical reds remain below that result |
| [SHAPE-REPAIRS.md](../../SHAPE-REPAIRS.md) | 13 shape contracts plus 15 generated helper tests passed; session preservation and revised append/branch acceptance |
| [LIFECYCLE-REPAIR.md](LIFECYCLE-REPAIR.md) | 16 lifecycle, seven legacy identity, three legacy retention, and ten macro canaries passed in that repair slice |

these scopes overlap; do not sum them. historical 207/235-test repair runs used
[repair-vitest.config.js](repair-vitest.config.js), preserved unchanged in this
checkpoint. it selects exactly nine files: alignment contracts and eight legacy
unit files, with empty global setup and setup-file lists. those counts describe
earlier source states, not fresh runs of this checkpoint. earlier raw generated
validation logs are not shipped; the linked failure documents retain the results.
final regression logs remain in ignored local `tmp/`.

all final execution used OS network denial and installed dependencies. no E2E or
standalone industry-generation runners ran. unit schema tests still inspected
existing dungeon definitions. no installs, data/tmp pruning, or coverage
instrumentation ran.

G1's original all-strict fixture remains immutable evidence of a finite-budget
retention limit. the repaired runtime still missed its lift floor on that fixture.
the current mixed-noise fixture adds real standalone traffic and non-strict organic
events and passes the unchanged floor. neither proves literal 80%/20% retention,
and the clock repair alone did not clear the original fixture.

## clone provenance is closed

`5e0caa5` preserves the source's nonenumerable identity provenance descriptor
on engine-created data-quality and world-event clones. it invents no lineage
for unmarked input. explicit hook identity overrides and fresh-ID hook clones
retain their existing treatment. all 12 clone contracts passed in 358ms;
[LIFECYCLE-REPAIR.md](LIFECYCLE-REPAIR.md) retains the two pre-fix failures and
focused validation results.

analytics ingestion sends IDs without an event name or funnel designation. its
identity-manager source accepts valid ordinary both-ID events as mapping evidence,
subject to ID validation and mapping conflicts. evidence comes from actual emitted
IDs, never profile device pools. there is no first-funnel restriction: a later
ordinary both-ID Login can link a device, including earlier device-only rows.
the generator's configured-auth-name scan is lifecycle policy, not full ingestion
parity. the lifecycle report records the exact analytics source paths.

## proof gaps remain explicit

[coverage.json](coverage.json) has 321 canonical registry entries, including all
23 helpers and six patterns. its classifications are 14 exact, three directional,
nine calibrated, six structural, 281 gap, and eight unsupported. classification
describes the generated slice's proof strength, not a global support percentage.
other helper evidence lives in [INVENTORY.md](INVENTORY.md).

- macro/soup presets, long windows, and acquisition/cadence interactions lack generated proof in this audit.
- decay and reactivation calibration, retention anchors, and budget interactions remain gaps.
- SCD, group, lookup, mirror, standalone cadence, warehouse, and ad-spend table knobs lack table-contract proof here. Background Activity is an ordinary standalone-pool event, not `standaloneEvents` cadence evidence.
- arbitrary hooks, callback bodies, property domains, parallel execution, and loader/serialization behavior remain unproved here.
- verifier limits include non-UTC project timezone behavior, list-valued HPC, and project-specific hidden/excluded session events. totals retains explicit opt-in reentry.

analytics source at `717286d2d3ed03e9e3f9cb4346e4c6b2e561fb9a` informed the
local contracts. analytics was neither compiled nor executed. no live differential
comparison, customer import, network call, or install establishes broader parity.

## final acceptance checklist

- [x] provenance repair `5e0caa5`: 12 focused contracts passed; original reds retained.
- [x] reproducibility: full regression config committed at `6df615e`; unchanged nine-file repair config included in this checkpoint after sandboxed syntax validation.
- [x] alignment gate: main executor's firsthand 175 passed / nine files / 60.65s at `5e0caa5`.
- [x] full unit/integration regression: 1,838 passed / one existing skip / 93 files / 20.58s under network denial.
- [x] post-repair sweep: artifact `fd112f8`, source `5e0caa5`, run/config `6df615e`; 297 cells completed, 77 stable hashes, zero deferred groups.
- [x] proof limits retained: 172 insufficient-evidence cells, original G1 capacity limit, registry gaps, source-only analytics review, and no all-knobs claim.
- [x] handoff limited to one local branch and explicit documentation/config paths. no push, publication, or GitHub PR creation is claimed or authorized here.

historical runs used `/Users/ak/code/dungeon-master-alignment-work`. after the
main executor relocates the checkout, run from `/Users/ak/code/dungeon-master`.
[README.md](README.md) gives gate, sweep, and sandbox regression commands.
gate and sweep retain the 600-second maximum. direct Vitest commands have
per-test timeouts, not the runner's process-group deadline. no default setup
or data/tmp pruning is permitted.