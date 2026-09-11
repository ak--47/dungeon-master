---
name: verify-dungeon
description: Use when a dungeon needs verification before import or warehouse deployment, including standaloneEvents cadence streams and warehouseMetrics tables. Runs full-scale story checks, schema validation, and automatic warehouse audits even without stories. Reports per-hook NAILED/STRONG/WEAK/NONE/INVERSE verdicts; investigates failures and duckdb assertions.
argument-hint: '[dungeon path(s), e.g. dungeons/vertical/gaming/gaming.js or dungeons/vertical/fintech/fintech.js]'
model: claude-opus-4-6
effort: max
---

# Verify Dungeon

Verify a dungeon at full scale: run the story runner (`scripts/verify-stories.mjs`) as the primary mechanical check, validate schema integrity, investigate only what the runner can't settle (failures + `duckdb`-type assertions), write a single consolidated `hook-results.md`.

**Dungeon file(s):** `$ARGUMENTS` — single path, multiple space-separated paths, or glob pattern. In batch mode, process each dungeon sequentially through Steps 1–5, then write one consolidated report in Step 7. Use a unique `name` prefix per dungeon (e.g., `verify-fintech`, `verify-gaming`) so output files don't collide.

## Reference files

Load these on demand:

- [references/counting-semantics.md](references/counting-semantics.md) — Mixpanel counting rules, when to use the emulator vs DuckDB, emulator analysis types, identity-model verification, time-series, common gotchas.
- [references/sql-recipes.md](references/sql-recipes.md) — every DuckDB query template (schema validation, identity / experiment invariants, hook archetype queries, pitfalls, TTC verification, dataset-window computation).
- [references/report-format.md](references/report-format.md) — single + multi-dungeon report templates, per-hook detail block, verdict criteria, query log format, mandatory verification SQL file for user dungeons.

Also: `HOOKS.md` (recipe encyclopedia) and `types.d.ts` (source of truth for hook meta interfaces).

## Pipeline

### Step 1: Read & catalog the hooks

Read the dungeon at `$ARGUMENTS`. If it's a bare filename (no `/`), check `dungeons/`. Find:

1. **The `stories` named export** — the machine-checkable contract (see `lib/templates/story-spec.schema.json` and the `DungeonStory` typedef in `types.d.ts`). If present, the story runner in Step 3 does the heavy lifting. If absent (legacy dungeon), the full per-hook flow in Step 5 applies to every hook.
2. **The `hook:` function** — read the full body
3. **The documentation comment block** describing engineered patterns
4. **Module-level closure state** (Map / Set / tracking variables defined outside the hook function but used inside)

For each hook/pattern, catalog:
- Hook number and name (e.g., "Hook #1: Compass users have 3x quest completion")
- Hook type (`event`, `everything`, `funnel-pre`, `funnel-post`, `user`, `scd-pre`, `standalone`, `warehouse`)
- Mechanism — what the code actually does
- Expected signal — specific, measurable outcome (e.g., "compass_user=true events should have ~1.5x reward_gold")
- Which output file the signal lives in (user events, users, groups, standalone cadence shards, warehouse tables)
- Mixpanel report instructions — flag missing/vague ones for the report

### Step 2: Run the dungeon

The runner already exists at `scripts/verify-runner.mjs`. Use it — do NOT recreate.

**ALWAYS run at full fidelity. Never use `--small` for verification.** `--small` runs (1K users, 100K events) compress per-cohort populations and shift ratios within ±25%, hiding real bugs and flagging fake ones. They exist in the runner only as a developer-troubleshooting escape hatch.

```bash
node scripts/verify-runner.mjs <dungeon-path> <run-name>
```

Example:
```bash
node scripts/verify-runner.mjs dungeons/vertical/gaming/gaming.js verify-gaming
```

Full-fidelity runs can take minutes (50K+ user dungeons). Plan accordingly — kick off the run, do other reading, return when the file lands. If a run takes longer than your budget, report that as a finding ("dungeon too large to verify in current session") rather than falling back to `--small`.

**Expected output files** (in `./data/`, prefixed by `<run-name>`):
- `<run-name>-EVENTS.json` — user events only (JSONL)
- `<run-name>-USERS.json` — user profiles
- `<run-name>-*-GROUPS.json` — group profiles (if dungeon has groups)
- `<run-name>-*-SCD.json` — SCD data (if dungeon has SCDs)
- `<run-name>-STANDALONE*.json` — `standaloneEvents` cadence records, separate from users
- `<run-name>-WAREHOUSE-<metric>.*` — `warehouseMetrics` tables; use manifest paths and formats
- `<run-name>-WAREHOUSE-MANIFEST.json` — table columns, grain, paths, SQL, and deployment metadata

Use local disk output, `format: 'json'`, `gzip: false`, and sending disabled
(`token: ''`) for this verification path. The existing runner supplies these
overrides. Record the exact prefix, for example `data/verify-gaming`, and pass
it explicitly to every downstream command. Preserve table files and their
matching manifest for `/warehouse-metrics`; do not regenerate silently.

For batched output (>2M events), the runner writes `<run-name>-EVENTS-part-*.json`. See [sql-recipes.md "Multi-part EVENTS files"](references/sql-recipes.md#multi-part-events-files-batch-mode).

### Step 3: Run the story runner (primary mechanical check)

Run this for any dungeon with a `stories` export or `warehouseMetrics`:

```bash
node scripts/verify-stories.mjs <dungeon-path> --data-prefix <run-name>
node scripts/verify-stories.mjs <dungeon-path> --data-prefix <run-name> --json   # machine-readable, for hook-results.md
```

The runner streams the shards from Step 2, evaluates every assertion against its declared `target` / `floor` / `minCohort`, substitutes `{{PREFIX}}` into `duckdb`-type assertions and shells them out, enforces hook coverage (every numbered hook in the HOOK STORIES comment block must be targeted by at least one story), and prints a five-tier verdict table. Exit code is non-zero when any story lands WEAK / NONE / INVERSE or coverage is incomplete.

When the dungeon declares `warehouseMetrics`, the runner also performs an automatic warehouse shape audit even if the dungeon exports no `stories`: it checks declared-column integrity, dense-gap absence, monotonic time ordering, empty numeric cells, sparse repeated-value suppression, and row-count sanity against the dataset window. Audit failures are reported alongside story verdicts and fail the CLI.

Warehouse stories support `warehouse` row assertions and `warehouse-stats`
summary assertions in the story schema. Automatic audits do not replace engineered story
assertions, and an audit-only dungeon must not be reported as having passing stories.

If a request calls these checks `rawStats`, translate that intent into supported
`warehouse-stats` fields or disk DuckDB. There is no `rawStats` breakdown type
in the local story schema or dispatcher. Inspect `lib/verify/warehouse.js` and
`lib/verify/story-runner.js` for the available summary fields; never invent one.

For `standaloneEvents`, use disk-backed `duckdb` assertions with
`read_json_auto('{{PREFIX}}-STANDALONE*.json', union_by_name=true, sample_size=-1)`.
The CLI's emulator input contains user EVENTS shards only. `--in-memory` skips
disk-only DuckDB assertions; it cannot prove standalone stories. The disk CLI
also requires nonempty user EVENTS shards. For a standalone-only artifact set
without those shards, run the same SQL directly and report that CLI limitation.
A standalone-only config without stories does not receive an automatic cadence
audit; perform the explicit schema, tick, dimension, and identity checks below.

**Verdicts are computed, not judged.** They include the population floor: a cohort smaller than the assertion's `minCohort` caps at WEAK — a 12-user cohort can no longer score NAILED regardless of how clean its ratio looks. See [report-format.md "Verdict criteria"](references/report-format.md#verdict-criteria-5-tier) for the mechanical definitions.

**What the LLM investigates after this step — and nothing else:**
1. **Stories below STRONG** (WEAK / NONE / INVERSE) — root-cause via Step 5's decision table. A miss means fixing the hook or the assertion's derivation, never relaxing the number to match output.
2. **`duckdb`-type assertions** — the runner executes them but can't interpret bespoke shapes; sanity-check their output against the story narrative.
3. **Dungeons without a `stories` export** — legacy fallback: full per-hook flow (Step 5) for every documented hook.

Do NOT re-derive verdicts the runner already computed as passing. `hook-results.md` (Step 7) renders the runner's JSON.

### Step 4: Validate schema (BEFORE per-hook checks)

Catches hooks that introduce undeclared columns (flag stamping). For each unique event type, compare actual columns against config-declared properties. See [sql-recipes.md "Schema validation queries"](references/sql-recipes.md#schema-validation-queries) for the SQL and the expected-schema source table.

Keep schemas separate. User-event checks use `events[]`, superProps, and enabled
SDK fields. Standalone checks use only core `event`, `time`, `insert_id`,
`distinct_id`, plus that spec's dimensions and properties. Require no `user_id`
or `device_id`; synthetic ids never count as people. Check one row per cadence
tick and dimension tuple unless a documented hook intentionally changes it.
Warehouse checks use the manifest's fixed columns and the metric's time column,
group keys, value column, and declared extras. Never apply user superProp or
identity requirements to cadence records or warehouse rows.

**Schema verdicts:**
- **SCHEMA-PASS** — added column appears on 100% of events of this type (uniform enrichment, acceptable)
- **SCHEMA-FAIL** — added column appears on <100% (flag stamping; conditional property creates inconsistent schema)

If any event type has SCHEMA-FAIL, flag it prominently in the report header with specific remediation: which hook line adds the property and how to remove it while preserving the intended pattern.

### Step 5: Investigate failures (and legacy no-stories dungeons)

Applies only to the investigation targets from Step 3 — failing stories, `duckdb`-type assertions, and dungeons with no `stories` export.

**Decision: emulator vs DuckDB**

| Pattern | Use |
|---|---|
| Funnel completion / step conversion | `emulateBreakdown({type: 'funnelFrequency'})` |
| Insights frequency-distribution | `emulateBreakdown({type: 'frequencyByFrequency'})` |
| Avg(prop) by per-user count(B) | `emulateBreakdown({type: 'aggregatePerUser'})` |
| Funnel TTC by segment (steps-based or funnel-based) | `emulateBreakdown({type: 'timeToConvert'})` |
| First/last touch attribution | `emulateBreakdown({type: 'attributedBy'})` |
| Retention curves — birth or compounded | `emulateBreakdown({type: 'retention'})` (`compounded: true` for "DAU coming back") |
| Per-session metrics | `emulateBreakdown({type: 'sessionMetrics'})` |
| Lifecycle (new / retained / resurrected / dormant) | `emulateBreakdown({type: 'lifecycle'})` |
| Flows / top paths (Sankey) | `emulateBreakdown({type: 'topPaths'})` |
| Event totals segmented by property | `emulateBreakdown({type: 'eventBreakdown'})` (`countType: 'general' \| 'sessions'`) |
| Uniques per segment | `emulateBreakdown({type: 'uniques'})` |
| COUNT DISTINCT of a property + top values | `emulateBreakdown({type: 'distinctCount'})` |
| Ratio / composite metrics (conversion %, ARPU, blends) | `evaluateFormula` (`lib/verify/formula.js`) over emulator rows |
| Schema integrity / column coverage | DuckDB |
| Identity-model invariants | DuckDB |
| Experiment invariants | DuckDB |
| True bespokes (no emulator analysis fits) | DuckDB |
| Standalone cadence values, dimensions, tick counts | Disk DuckDB on `{{PREFIX}}-STANDALONE*.json` |
| Warehouse value stories | `warehouse` or `warehouse-stats` assertion |
| Warehouse schema, gaps, ordering, numeric cells | Automatic warehouse audit, with or without stories |

The emulator now covers lifecycle, flows, sessions, event breakdowns, formulas, and compounded retention — DuckDB's remit is schema / identity / experiment invariants plus true bespoke shapes. If a "bespoke" check is really a funnel, frequency, path, or breakdown in disguise, it belongs in the emulator.

**Hand-written DuckDB funnel SQL diverges from Mixpanel — never hand-roll.** If you find yourself writing `WITH step1 AS ..., step2 AS ...` for a funnel, STOP — use `emulateBreakdown` with `funnelFrequency` instead.

For emulator details, identity-model dungeons (must pass `profiles`), and time-series breakdown via `timeBucket`, see [counting-semantics.md](references/counting-semantics.md). For DuckDB query templates by hook archetype, pitfalls, and standard checks, see [sql-recipes.md](references/sql-recipes.md).

**Always run for every dungeon** (before per-hook checks):
- Standard identity-model invariants (stitch counts, pre-existing user stamping) when the dungeon uses the identity model
- Experiment invariants (variant distribution, exposure timing, deterministic assignment) when any funnel uses `experiment:`
- SuperProp consistency, SuperProp/UserProp mirror, Mixpanel default-property casing, funnel-pre dilution

### Artifact location

**Everything about a dungeon lives in its folder.** When the dungeon being
verified is a user dungeon at `dungeons/user/<name>/<name>.js`, write ALL
generated artifacts into `dungeons/user/<name>/`:
- `hook-results.md` (Step 7)
- `hook-query-log.txt` (Step 6)
- `<name>-verifications.sql` (Step 7b)

The exception is run data under `./data/`, including cadence shards, warehouse
tables, and the manifest. Keep it under its explicit prefix until verification
and deployment finish. Step 8 requires consent before any scoped cleanup.

For non-user dungeons (technical/vertical) or batch runs across many dungeons,
fall back to `./research/` for `hook-results.md` / `hook-query-log.txt`.

### Step 6: Stash query log

Write every DuckDB query execution to `hook-query-log.txt`:
- **User dungeon:** always write to `dungeons/user/<name>/hook-query-log.txt`.
- **Otherwise:** if `./research/` exists locally, write to `./research/hook-query-log.txt`; if it doesn't exist, skip — do not create the directory.

Format and conventions: see [report-format.md "Query log format"](references/report-format.md#query-log-format).

### Step 7: Write `hook-results.md`

Write to `dungeons/user/<name>/hook-results.md` for a user dungeon, else `./research/hook-results.md`. For story-backed dungeons, **the report renders the runner's JSON** (`verify-stories.mjs --json`): the hook summary table comes straight from the runner's per-story verdicts (story id, hook, archetype, observed vs target, verdict), and detailed blocks exist only for the Step-3 investigation targets. Use the templates in [report-format.md](references/report-format.md):
- Single-dungeon report structure
- Multi-dungeon report structure (when batch mode)
- Per-hook detail block
- Verdict criteria (5-tier, mechanical)

**Order failures first** within each dungeon section: INVERSE → NONE → WEAK → STRONG → NAILED. Sort the summary table the same way. Actionable issues at the top.

### Step 7b: Write verification SQL (mandatory for user dungeons)

When verifying a dungeon in `dungeons/user/`, also write a standalone DuckDB SQL file alongside the dungeon in its folder at `dungeons/user/<name>/<name>-verifications.sql`. Vertical dungeons already have their SQL co-located at `dungeons/vertical/<name>/<name>.sql`. Format: see [report-format.md "Verification SQL file"](references/report-format.md#verification-sql-file-mandatory-for-user-dungeons).

### Step 8: Preserve artifacts and hand off

Record the exact verified prefix and retained files in the report. If warehouse
tables are present, provision with `/create-project`, then hand off to
`/warehouse-metrics` using `--data-prefix <verified-prefix>`. Provisioning and
ordinary event import do not deploy these tables.

Do not run blanket prune or delete `verify-*` globs. Only after deployment is
complete, list files for this exact run and obtain user consent for scoped
cleanup. Keep reports and reproducible SQL. Do not delete files during an audit.

## Hook execution model

Per user, hooks fire in this order:

1. `"user"` — profile created (mutate in-place; return ignored)
2. `"scd-pre"` — SCD entries created (mutate in-place; return ignored)
3. For each funnel: `"funnel-pre"` → `"event"` (per step) → `"funnel-post"`
4. `"event"` — for non-funnel user events from `events[]` (return value REPLACES the event)
5. `"everything"` — array of ALL the user's events (return array to replace)
6. **Storage phase** — data written to disk. Hooks for `event`, `user`, `scd` do NOT re-fire (already applied above). Hooks for `mirror`, `ad-spend`, `group`, `lookup` fire only in storage.

Return-value behavior:
- `event` hook: return value IS used (replaces the event)
- `everything` hook: return value IS used if it's an array (replaces event list)
- `user`, `scd-pre`, `funnel-post`: return value IGNORED — only in-place mutations work
- `funnel-pre`: return value IGNORED — mutate the `record` object in-place (e.g., `record.conversionRate = 0.9`)
- `standalone`: runs before the user loop. Return an object or array; `undefined`
	drops the record. `meta.spec` and `meta.config` describe the cadence stream.
- `warehouse`: runs after the user loop. Mutate the row; return value is ignored.
	Meta includes `spec`, `config`, `metricName`, bucket fields, `grain`,
	`seriesKey`, `isBackfill`, and `raw` source aggregates.

Neither `standalone` nor `warehouse` receives person metadata or passes through
`everything`. Their generation phases differ even though both hooks fire on
storage push. Other storage-only types return objects or arrays to retain rows.

## Final output

Tell the user:
1. Report path: `dungeons/user/<name>/hook-results.md` (user dungeon) or `./research/hook-results.md`
2. Verification SQL path (for user dungeons): `dungeons/user/<name>/<name>-verifications.sql`
3. Query log path (if written): alongside the report (`dungeons/user/<name>/hook-query-log.txt`, else `./research/hook-query-log.txt`)
4. Verdict counts from the story runner (per dungeon if batch mode), plus which stories needed LLM investigation
5. One-line summary of the most interesting finding
6. Separate standalone checks and `warehouseAudits`, including audit-only runs,
   skipped assertions, retained artifact prefix, and warehouse deployment handoff

If hooks failed, note that `hook-results.md` can be used as context for fixing them: "read hook-results.md and fix the failing hooks in <dungeon-file>".
