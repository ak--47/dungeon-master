# local PR handoff

suggested title: `fix: offline alignment contracts and generated story evidence`

branch: `alignment/knob-story-proof` in
`/Users/ak/code/dungeon-master-alignment-work`. keep the work on this one unpushed
branch. this file is review text, not a GitHub PR or a PR URL.

## changes for review

- repair source-derived funnel counting contracts and preserve opt-in reentry.
- correct lifecycle clocks and emitted identity, with legacy partial-output warnings.
- retain legacy session placement and add optional bounded placement; keep path injection append-only.
- add generated proofs, an author-input registry, and a bounded offline sweep.

[API-COMPATIBILITY.md](API-COMPATIBILITY.md) describes changed output and retained
defaults. [REPORT.md](REPORT.md) owns results, remaining proof gaps, and the final
checklist. [INVENTORY.md](INVENTORY.md) maps controls to evidence without claiming
all 321 registry entries are tested.

## evidence and blockers

the sweep artifact commit is `b2f4c76`: 297 cells, 125 supported, 172 insufficient,
zero other verdicts. all 77 start/end hashes matched during that run. detailed
measurements and original red checkpoints remain linked from the report.
analytics source informed local assertions; analytics and live Mixpanel never ran.

**final gate pending. provenance blocker open.** earlier scoped passes and the
completed sweep do not replace final validation after the active repair.

- [ ] main executor resolves provenance and records focused regression evidence.
- [ ] main executor commits the reviewed repair config or an equivalent selected-regression runner. its current local config disables global setup and setup files and contains no prune command.
- [ ] main executor runs the bounded alignment gate and selected old regressions with OS network denial, then records exact commands and results in [REPORT.md](REPORT.md).
- [ ] reviewer checks the additive session options, output changes, revised path acceptance, and retained G1 capacity-limit evidence.
- [ ] final Git review confirms explicit-path commits only, one local branch, and no unrelated staged files.

use installed dependencies. no installs, network access, data/tmp pruning, push,
or publication belongs to this handoff. [README.md](README.md) contains commands
and the macOS-only fail-closed policy. the docs executor leaves the untracked repair
config to the main executor and keeps the root shape report in place to preserve links.