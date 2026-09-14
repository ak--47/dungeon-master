# preserved 1.8.1 alignment checkpoints

These records retain original failures, superseded decisions, source contracts,
and old worktree paths. Claims about open defects or absent live evidence describe
that checkpoint. Use the [current guide](../../README.md) and
[1.8.2 live report](../../live-report.md) for current interpretation.

| record | retained knowledge |
| --- | --- |
| [Audit report](report.md) | source-derived scope and repair summary |
| [Final validation](final-validation.md) | completed gates and fingerprints |
| [API compatibility](api-compatibility.md) | defaults and output changes |
| [Counting failures](failures.md) | original red contracts |
| [Counting repairs](repairs.md) | C1-C4 fixes |
| [Generated methodology](generated.md) | controls, populations, paired TTC |
| [Generated failures](generated-failures.md) | retention capacity and TTC corrections |
| [Helper failures](helpers-failures.md) | preservation, paths, identity |
| [Lifecycle repair](lifecycle-repair.md) | birth, retries, clone provenance |
| [Shape repair](shape-repairs.md) | session bounds and append-only path acceptance |
| [Sweep method](sweep.md) | sampling, deadlines, failure categories |
| [Sweep history](sweep-run.md) | successive checkpoints |
| [Original PR handoff](pr.md) | historical local review record |

Machine-readable artifacts remain in `tests/alignment`. Historical JSON can name
pre-cleanup Markdown paths; those strings are preserved as provenance. Current
report generators use the relocated documentation paths.