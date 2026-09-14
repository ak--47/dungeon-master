# documentation

## understand the engine and author a story

- [How dungeon-master maps simulation to Mixpanel reports](alignment/README.md):
  start here for the parameter model, counting rules, measured effects, and limits.
- [Counting contracts](alignment/counting-contracts.md): identity, attempts, TTC,
  sessions, frequency, numeric values, retention, attribution, and Flows.
- [Story recipes](alignment/story-recipes.md): practical API fragments and what to verify.
- [Configuration reference](../README.md) and [hook encyclopedia](../HOOKS.md): full API and recipe catalog.

## inspect evidence without rerunning it

- [1.8.2 live report](alignment/live-report.md): repairs, measured deltas, original failures, and limits.
- [Latest retained sweep summary](alignment/sweep-results.md): supported and insufficient-evidence cells.
- [Generated coverage registry](alignment/coverage.md): one test slice, not a product coverage percentage.
- [Repair history](alignment/archive/1.8.1/README.md): preserved source contracts, red checkpoints, and earlier validation.

Machine-readable JSON, runnable fixtures, and tests stay in `tests/alignment`.
The docs summarize their meaning. The npm package contains docs but not test
artifacts; repository-relative test links are for checkout readers.

## run a check or upgrade

- [Validation workflows](alignment/validation.md): offline gates, targeted reruns, generated report locations.
- [Live validation operations](alignment/live-validation.md): authorized imports, isolation, budgets, and query readiness.
- [1.8.2 upgrade guide](guides/1.8.2-upgrade-guide.md)
- [1.8.1 upgrade guide](guides/1.8.1-upgrade-guide.md)
- [1.8.0 upgrade guide](guides/1.8.0-upgrade-guide.md)
- [Changelog](../CHANGELOG.md); earlier version guides remain in `guides/`.

1.8.2 is published. This documentation cleanup does not change its API or start
the 1.8.3 implementation. Historical reports preserve what was known at each
checkpoint; use the current alignment guide to interpret superseded claims.