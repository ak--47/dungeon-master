# API compatibility and corrected output

existing public names, call forms, and documented defaults remain. the session
helper gains optional bounds. this is an additive option change, so saying the
API is byte-for-byte unchanged would be inaccurate. this docs commit changes no
runtime, declarations, exports, or defaults.

## session bounds are optional

`applySessionShape(events, uid, options)` still retimes the same objects in the
same array. it adds or drops no events. existing calls omit both bounds and keep
the original full-UTC-day placement algorithm. overfull legacy requests remain
nonthrowing, although derived sessions can merge.

optional `datasetStart` and `datasetEnd` accept ISO strings, unix seconds, or unix
milliseconds. pass the known hook metadata bounds when clipping must be prevented.
either explicit bound enables constrained placement; the omitted side uses the
corresponding full UTC day edge. the last observed event cannot reveal dataset end.

explicit-bound mode throws `RangeError` for invalid bounds or insufficient per-week
capacity, before mutating records. two same-day sessions cannot fit within a
20-minute interval when their gap must exceed the 30-minute timeout. reducing
the requested session count or dropping records would violate the helper contract.
unbounded legacy placement can still cross an unknown dataset end and get clipped
by the engine. see [SHAPE-REPAIRS.md](../../SHAPE-REPAIRS.md).

## corrected clocks change generated output

retention entry now follows adjusted creation. representable retries precede the
final onboarding attempt, and usage follows onboarding completion. final emitted
auth timing controls engine identity for born users. these repairs change the old
buggy timestamps and identity output; API compatibility does not promise identical
output across the repair. disabled-device and pre-existing behavior stays intact.

insufficient onboarding capacity retains legacy partial output rather than adding
a required exception. aggregate warnings use the existing `result.warnings` channel:
`lifecycle.firstFunnelClipped`, `lifecycle.emptyPreAuthAttempt`, and
`lifecycle.strictAttemptBudget`. configured TTC stays unchanged. hook filtering and
world suppression do not recreate removed events.

explicit hook identity overrides and the synthetic experiment exception survive
reconciliation. clone provenance was repaired at `5e0caa5`. engine-created
data-quality and world-event clones retain the source's existing nonenumerable
identity descriptor. unmarked input receives no invented lineage. serialization,
fresh insert IDs, and explicit hook identity overrides remain unchanged;
fresh-ID spread clones created by hooks remain outside engine ownership.

all 12 clone contracts passed in 358ms. they include auth removal from actual
original/clone output and a surviving later ordinary both-ID Login. analytics
ingestion and identity-manager source at
`717286d2d3ed03e9e3f9cb4346e4c6b2e561fb9a` accepts valid ordinary both-ID events
as mapping evidence, subject to ID validation and mapping conflicts. it has no
first-funnel restriction. earlier device-only rows can resolve retrospectively
after that link. profile device pools alone establish no mapping. the generator's
configured-auth-name scan remains lifecycle policy, not full ingestion parity.

analytics was read locally, not compiled or executed. see the exact source paths,
red checkpoint, and focused results in [LIFECYCLE-REPAIR.md](LIFECYCLE-REPAIR.md).
[FINAL-VALIDATION.md](FINAL-VALIDATION.md) records the post-repair gate, full
unit/integration regression, and refreshed sweep; [REPORT.md](REPORT.md) retains
the remaining proof gaps.

## counting corrections preserve the reentry default

C1-C4 correct ordered shared-edge completion/restart, inclusive 2000ms completion
grace, full-stream sessions before HPC partitioning, and reached-step property
merges. shared-edge completion finalizes even when replay is disabled.
first/last property selection retains defined fallback values using the source's
null/undefined predicate. explicit-step selection remains separate.

`reentry` still defaults to `false`, including `countMode: 'totals'`. request
`reentry: true` for repeated histories. this retains the documented compatibility
gap with analytics general counting; no default migration occurred.
local session counting retains UTC, a 30-minute timeout, and a 24-hour maximum.
project timezone, list-valued HPC, and hidden/excluded session-event parity remain
outside this proof. [REPAIRS.md](REPAIRS.md) contains the source references.

## path injection remains append-only

`applyPathBias` still clones steps after the earliest anchor and leaves competing
events intact. `share: 1` selects every eligible recipient for injection; it cannot
guarantee every visible immediate branch. the revised acceptance checks exact
append payloads plus at least 95% branch share and 15 percentage points of paired
lift. those thresholds were revised after observation. the original red evidence
remains in [HELPERS-FAILURES.md](HELPERS-FAILURES.md).