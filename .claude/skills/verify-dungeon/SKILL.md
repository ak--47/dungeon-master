---
name: verify-dungeon
description: Use when a dungeon's hooks need verification before pushing data to Mixpanel — runs the dungeon at full scale, validates schema integrity (catches flag-stamping), queries with DuckDB using Mixpanel-accurate counting semantics, and reports per-hook NAILED/STRONG/WEAK/NONE/INVERSE verdicts.
argument-hint: [dungeon path(s), e.g. dungeons/gaming.js or dungeons/fintech.js]
model: claude-opus-4-6
effort: max
---

# Verify Dungeon

Verify a dungeon at full scale: validate schema integrity, query the output with the Mixpanel emulator (preferred) or DuckDB, write a single consolidated `hook-results.md`.

**Dungeon file(s):** `$ARGUMENTS` — single path, multiple space-separated paths, or glob pattern. In batch mode, process each dungeon sequentially through Steps 1–3, then write one consolidated report in Step 4. Use a unique `name` prefix per dungeon (e.g., `verify-fintech`, `verify-gaming`) so output files don't collide.

## Reference files

Load these on demand:

- [references/counting-semantics.md](references/counting-semantics.md) — Mixpanel counting rules, when to use the emulator vs DuckDB, emulator analysis types, identity-model verification, time-series, common gotchas.
- [references/sql-recipes.md](references/sql-recipes.md) — every DuckDB query template (schema validation, identity / experiment invariants, hook archetype queries, pitfalls, TTC verification, dataset-window computation).
- [references/report-format.md](references/report-format.md) — single + multi-dungeon report templates, per-hook detail block, verdict criteria, query log format, mandatory verification SQL file for user dungeons.

Also: `HOOKS.md` (recipe encyclopedia) and `types.d.ts` (source of truth for hook meta interfaces).

## Pipeline

### Step 1: Read & catalog the hooks

Read the dungeon at `$ARGUMENTS`. If it's a bare filename (no `/`), check `dungeons/`. Find:

1. **The `hook:` function** — read the full body
2. **The documentation comment block** describing engineered patterns
3. **Module-level closure state** (Map / Set / tracking variables defined outside the hook function but used inside)

For each hook/pattern, catalog:
- Hook number and name (e.g., "Hook #1: Compass users have 3x quest completion")
- Hook type (`event`, `everything`, `funnel-pre`, `funnel-post`, `user`, `scd-pre`)
- Mechanism — what the code actually does
- Expected signal — specific, measurable outcome (e.g., "compass_user=true events should have ~1.5x reward_gold")
- Which output file the signal lives in (events, users, groups)
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
- `<run-name>-EVENTS.json` — all events (JSONL)
- `<run-name>-USERS.json` — user profiles
- `<run-name>-*-GROUPS.json` — group profiles (if dungeon has groups)
- `<run-name>-*-SCD.json` — SCD data (if dungeon has SCDs)

For batched output (>2M events), the runner writes `<run-name>-EVENTS-part-*.json`. See [sql-recipes.md "Multi-part EVENTS files"](references/sql-recipes.md#multi-part-events-files-batch-mode).

### Step 3: Validate schema (BEFORE per-hook checks)

Catches hooks that introduce undeclared columns (flag stamping). For each unique event type, compare actual columns against config-declared properties. See [sql-recipes.md "Schema validation queries"](references/sql-recipes.md#schema-validation-queries) for the SQL and the expected-schema source table.

**Schema verdicts:**
- **SCHEMA-PASS** — added column appears on 100% of events of this type (uniform enrichment, acceptable)
- **SCHEMA-FAIL** — added column appears on <100% (flag stamping; conditional property creates inconsistent schema)

If any event type has SCHEMA-FAIL, flag it prominently in the report header with specific remediation: which hook line adds the property and how to remove it while preserving the intended pattern.

### Step 4: Verify each hook

**Decision: emulator vs DuckDB**

| Pattern | Use |
|---|---|
| Funnel completion / step conversion | `emulateBreakdown({type: 'funnelFrequency'})` |
| Insights frequency-distribution | `emulateBreakdown({type: 'frequencyByFrequency'})` |
| Avg(prop) by per-user count(B) | `emulateBreakdown({type: 'aggregatePerUser'})` |
| Funnel TTC by segment | `emulateBreakdown({type: 'timeToConvert'})` |
| First/last touch attribution | `emulateBreakdown({type: 'attributedBy'})` |
| Retention curves | `emulateBreakdown({type: 'retention'})` |
| Per-session metrics | `emulateBreakdown({type: 'sessionMetrics'})` |
| Schema integrity / column coverage | DuckDB |
| Identity-model invariants | DuckDB |
| Experiment invariants | DuckDB |
| Bespoke time-window patterns | DuckDB |

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
- `hook-results.md` (Step 6)
- `hook-query-log.txt` (Step 5)
- `<name>-verifications.sql` (Step 6b)

The ONLY exception is the throwaway verification data the run writes to
`./data/` (`verify-*` event/user files) — that stays in `./data/` and is
deleted in Step 7.

For non-user dungeons (technical/vertical) or batch runs across many dungeons,
fall back to `./research/` for `hook-results.md` / `hook-query-log.txt`.

### Step 5: Stash query log

Write every DuckDB query execution to `hook-query-log.txt`:
- **User dungeon:** always write to `dungeons/user/<name>/hook-query-log.txt`.
- **Otherwise:** if `./research/` exists locally, write to `./research/hook-query-log.txt`; if it doesn't exist, skip — do not create the directory.

Format and conventions: see [report-format.md "Query log format"](references/report-format.md#query-log-format).

### Step 6: Write `hook-results.md`

Write to `dungeons/user/<name>/hook-results.md` for a user dungeon, else `./research/hook-results.md`. Use the templates in [report-format.md](references/report-format.md):
- Single-dungeon report structure
- Multi-dungeon report structure (when batch mode)
- Per-hook detail block
- Verdict criteria (5-tier)

**Order failures first** within each dungeon section: INVERSE → NONE → WEAK → STRONG → NAILED. Sort the summary table the same way. Actionable issues at the top.

### Step 6b: Write verification SQL (mandatory for user dungeons)

When verifying a dungeon in `dungeons/user/`, also write a standalone DuckDB SQL file alongside the dungeon in its folder at `dungeons/user/<name>/<name>-verifications.sql`. Vertical dungeons already have their SQL co-located at `dungeons/vertical/<name>/<name>.sql`. Format: see [report-format.md "Verification SQL file"](references/report-format.md#verification-sql-file-mandatory-for-user-dungeons).

### Step 7: Cleanup

```bash
rm -f ./data/verify-* ./verify-*
```

Remove ALL files matching `verify-*` in `./data/` and project root. Also remove any temporary runner scripts.

## Hook execution model

Per user, hooks fire in this order:

1. `"user"` — profile created (mutate in-place; return ignored)
2. `"scd-pre"` — SCD entries created (mutate in-place OR return new array)
3. For each funnel: `"funnel-pre"` → `"event"` (per step) → `"funnel-post"`
4. `"event"` — for non-funnel standalone events (return value REPLACES the event)
5. `"everything"` — array of ALL the user's events (return array to replace)
6. **Storage phase** — data written to disk. Hooks for `event`, `user`, `scd` do NOT re-fire (already applied above). Hooks for `mirror`, `ad-spend`, `group`, `lookup` fire only in storage.

Return-value behavior:
- `event` hook: return value IS used (replaces the event)
- `everything` hook: return value IS used if it's an array (replaces event list)
- `user`, `scd-pre`, `funnel-post`: return value IGNORED — only in-place mutations work
- `funnel-pre`: return value IGNORED — mutate the `record` object in-place (e.g., `record.conversionRate = 0.9`)

## Final output

Tell the user:
1. Report path: `dungeons/user/<name>/hook-results.md` (user dungeon) or `./research/hook-results.md`
2. Verification SQL path (for user dungeons): `dungeons/user/<name>/<name>-verifications.sql`
3. Query log path (if written): alongside the report (`dungeons/user/<name>/hook-query-log.txt`, else `./research/hook-query-log.txt`)
4. Pass/weak/fail counts (per dungeon if batch mode)
5. One-line summary of the most interesting finding

If hooks failed, note that `hook-results.md` can be used as context for fixing them: "read hook-results.md and fix the failing hooks in <dungeon-file>".
