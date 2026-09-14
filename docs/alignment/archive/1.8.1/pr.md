> Historical 1.8.1 checkpoint. Results and unresolved claims below describe that stage of the work. See the [current alignment reference](../../README.md) and [1.8.2 live report](../../live-report.md) for subsequent repairs and proof.

# local PR handoff

suggested title: `fix: offline alignment contracts and generated story evidence`

branch: `alignment/knob-story-proof`. validation ran in
`/Users/ak/code/dungeon-master-alignment-work`. the main executor will move the
checkout to `/Users/ak/code/dungeon-master` after this checkpoint. this file is
local review text. no push or GitHub PR creation is claimed.

## changes for review

- repair source-derived funnel counting contracts and preserve opt-in reentry.
- correct lifecycle clocks and emitted identity, with legacy partial-output warnings.
- preserve source identity lineage on engine-created clones, including explicit hook overrides and later ordinary both-ID mapping evidence with no first-funnel restriction.
- retain legacy session placement and add optional bounded placement; keep path injection append-only.
- add generated proofs, an author-input registry, and a bounded offline sweep.

[API-COMPATIBILITY.md](api-compatibility.md) describes changed output and retained
defaults. [REPORT.md](report.md) owns results, remaining proof gaps, and the final
checklist. [INVENTORY.md](../../inventory.md) maps controls to evidence without claiming
all 321 registry entries are tested.

## final evidence

[FINAL-VALIDATION.md](final-validation.md) owns the authoritative results.
production source is `5e0caa5`; regression config and sweep run HEAD are
`6df615e`; latest artifact commit is `fd112f8`.

- clone provenance: 12 contracts passed in 358ms after the two-failure red checkpoint. analytics source permits valid ordinary both-ID mapping evidence, subject to validation/conflicts, with no first-funnel restriction.
- alignment gate: main executor's firsthand result, 175 passed across nine files in 60.65s at `5e0caa5`.
- full unit/integration regression: 1,838 passed, one existing skip, 93 files, 20.58s. no E2E or standalone industry-generation runners ran.
- fresh sweep: 297 cells, 594 generations, 17,083,972 events, 339097ms, 602 MiB peak RSS, 281,751 maximum events in one dungeon. 125 supported, 172 insufficient-evidence, zero diluted/inverse/contractfail, zero deferred groups, 77 stable start/end hashes.

these checks have overlapping scopes. insufficient evidence is not a pass,
cumulative output is not single-dungeon capacity, and registry gaps remain.
analytics source informed local assertions; analytics and live Mixpanel never ran.
all final execution used OS network denial. this docs pass reran no tests.

- [x] provenance repaired at `5e0caa5`; red and green evidence retained in [LIFECYCLE-REPAIR.md](lifecycle-repair.md).
- [x] final gate, full unit/integration regression, and post-repair sweep recorded in [REPORT.md](report.md).
- [x] reusable [regression-vitest.config.js](../../../../tests/alignment/regression-vitest.config.js) committed at `6df615e`; historical nine-file [repair-vitest.config.js](../../../../tests/alignment/repair-vitest.config.js) preserved unchanged in this checkpoint for earlier 207/235-test evidence.
- [x] [API-COMPATIBILITY.md](api-compatibility.md) documents additive session bounds, output changes, and provenance behavior. revised path acceptance, original G1 limits, and unproved knobs remain explicit in the linked reports.
- [x] this handoff authorizes only an explicit-path documentation/config checkpoint on the local branch. it makes no push, publication, or PR claim.

use installed dependencies. no installs, network access, or data/tmp pruning
belongs to this handoff. [README.md](../../validation.md) contains final gate, sweep, and
sandbox regression commands with their distinct timeout scopes.