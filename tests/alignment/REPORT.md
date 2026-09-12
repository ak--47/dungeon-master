# alignment audit: final gate pending

the bounded sweep is complete. the branch still needs the provenance repair and
a final combined gate. this report summarizes recorded local evidence; the docs
pass did not rerun generation, analytics, or a live Mixpanel query.

## recorded sweep

artifact commit: `b2f4c76`. run commit: `012931ea2fa53a9893f937a2e43c96566015028c`.
see [SWEEP-RUN.md](SWEEP-RUN.md) for commands, chronology, and sampling limits;
[sweep-results.json](sweep-results.json) contains the measurements.

| measurement | recorded result |
| --- | ---: |
| completed cells / dungeon generations | 297 / 594 |
| cumulative emitted events | 17,083,972 |
| elapsed / deadline | 337638ms / 600000ms |
| supported / insufficient-evidence cells | 125 / 172 |
| diluted / inverse / contractfail cells | 0 / 0 / 0 |
| deferred groups | 0 |
| largest single dungeon | 281,751 events |
| start/end source hashes | 77, all unchanged during the run |

the near-cap group requested 299,997 events per dungeon. peak worker RSS was
591 MiB. the 512 MiB V8 heap cap and sampled 900 MiB RSS guard stayed in place.
cumulative output does not prove a 17-million-event single-dungeon capacity.
172 cells lack enough independent users for acceptance; they do not count as passes.
source stability applies to that run, not later provenance edits.

## completed checks have separate scopes

| evidence | recorded result and limit |
| --- | --- |
| [REPAIRS.md](REPAIRS.md) | 72 counting contracts plus 163 existing funnel regressions passed; source-derived C1-C4 repairs, including shared-edge completion without reentry |
| [GENERATED-FAILURES.md](GENERATED-FAILURES.md) | latest generated-only run: 30 passed, 32.96s, 11 stable start/end hashes; historical reds remain below that result |
| [SHAPE-REPAIRS.md](../../SHAPE-REPAIRS.md) | 13 shape contracts plus 15 generated helper tests passed; session preservation and revised append/branch acceptance |
| [LIFECYCLE-REPAIR.md](LIFECYCLE-REPAIR.md) | 16 lifecycle, seven legacy identity, three legacy retention, and ten macro canaries passed in that repair slice |

do not sum these counts into a final suite result. the older
[generated-validation-results.log](generated-validation-results.log) records a failed
run and is not the latest generated-only acceptance record.

G1's original all-strict fixture remains immutable evidence of a finite-budget
retention limit. the repaired runtime still missed its lift floor on that fixture.
the current mixed-noise fixture adds real standalone traffic and non-strict organic
events and passes the unchanged floor. neither proves literal 80%/20% retention,
and the clock repair alone did not clear the original fixture.

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

- [ ] provenance blocker: another executor is investigating identity provenance. fix status and regression evidence pending; no closure claim here.
- [ ] reproducibility: review and commit the local repair Vitest config, or integrate its selected old regressions into the bounded no-prune runner.
- [ ] final gate command: `node tests/alignment/run.mjs --timeout-ms=600000` plus selected legacy regressions under the reviewed runner/config. exact combined command pending.
- [ ] final gate commit, result, test counts, elapsed time, and source stability: pending after the provenance work.
- [ ] confirm any post-sweep runtime change against the recorded hashes; retain the historical sweep and qualify or refresh affected evidence.
- [ ] review the one local branch and docs-only commit; no push, publish, or GitHub PR creation is authorized by this handoff.

all execution commands start in `/Users/ak/code/dungeon-master-alignment-work`.
[README.md](README.md) gives the macOS fail-closed, OS-network-denied commands.
the 600-second maximum stays fixed. no default setup or data/tmp pruning is permitted.