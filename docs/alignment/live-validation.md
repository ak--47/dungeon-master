# live alignment tests

These scripts send synthetic data to project 4063241. They never run as part of
normal tests. Get operator authorization before importing or querying. The supplied
project is fixed deliberately; there is no implicit fallback to another account.

## local prerequisites

- Installed Node dependencies and the `mixpanel-headless` checkout environment.
- Root `.env` contains `BEARER_TOKEN` for report queries.
- Ignored `tmp/alignment-1.8.2/auth.env` contains `ALIGNMENT_IMPORT_TOKEN`.
  `ALIGNMENT_API_SECRET` is used only by the scoped raw export diagnostic.
- Set `ALIGNMENT_HEADLESS_PYTHON` to override `~/code/mixpanel-headless/.venv/bin/python`.
- Restrict the private file to mode 600. Never commit it or pass tokens in CLI arguments.

Run scripts serially. The local import ledger reserves requested rows before
sending and caps cumulative reservations at 25 million. An interrupted reservation
stays charged. The query ledger stops at 180 logical requests per rolling hour;
SDK retries and external queries can consume additional server budget. A 429 is
a failed attempt, not a pass. Do offline work before retrying.

## generation and live queries

```sh
node tests/alignment/live/exact.mjs
node tests/alignment/live/exact-queries.mjs
node tests/alignment/live/boundaries.mjs
node tests/alignment/live/generated.mjs conditions persona-ttc hook-ttc
node tests/alignment/live/generated-queries.mjs
node tests/alignment/live/compare-generated.mjs
node tests/alignment/live/patterns.mjs
node tests/alignment/live/pattern-queries.mjs
node tests/alignment/live/compare-patterns.mjs
node tests/alignment/live/shapes.mjs
node tests/alignment/live/shape-queries.mjs
node tests/alignment/live/compare-shapes.mjs
```

Generation uses the public dungeon entry point. Imports use the real sender.
The identity-wire diagnostic alone compares explicit importer configurations;
it does not change production sender behavior. Every row has `alignment_run_id`.
User/device/profile IDs also include the run and cell, preventing cross-run merges.

Query receipts are asynchronous evidence. An import receipt does not mean every
report can see all events or historical identity links yet. Comparators fail on
missing or mismatched counts. Use `refresh.mjs <run-id> <query-name>...` after doing
other work; it preserves previous responses. Do not rerun imports to solve indexing
delay. No automatic polling or unbounded retries are used.

The stored run specifications use the full dataset window, including a midnight
endpoint. Shortening a date range can exclude valid events. Flows uses anchor-level
run filters because its endpoint rejects ordinary report-level property filters.
Namespaced users keep non-anchor paths isolated.

## evidence and scope

[evidence.json](../../tests/alignment/live/evidence.json) contains accepted results and retained native request/response
records, including incomplete early snapshots. [evidence.test.js](../../tests/alignment/live/evidence.test.js) checks internal
consistency offline; it does not make live queries or prove new code against the
server. `snapshot.mjs` freezes this release's explicit accepted run list and rejects
failed accepted sets. Keep that list intentional when repeating the study.

The raw synthetic event sets stay in ignored local storage. The committed evidence
contains aggregate results and synthetic run identifiers, never credentials.
[The live report](live-report.md) distinguishes exact matches, effect checks,
revised fixture conditions, and unresolved report/API limits. The npm package
includes these docs but excludes `tests/alignment/live`, its scripts, and evidence JSON.