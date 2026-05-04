# Round 4: Full Re-verification of All Vertical Dungeons

Paste the section below `--- BEGIN PROMPT ---` into a fresh Claude Code session in bypass mode.

--- BEGIN PROMPT ---

You are working autonomously on a dungeon-master verification sprint. The user is away and will check results when you're done. Bypass mode is on. Make decisions and ship results.

## Your job

Re-verify all 20 vertical dungeons at full fidelity using the `/verify-dungeon` skill. This is Round 4 — the first round after the schema validation layer was added to the verification pipeline. Every dungeon must pass both **schema validation** (no flag stamping) and **hook pattern verification** (all hooks STRONG or NAILED).

## Context: what changed since Round 3

Round 3 (2026-04-29) verified all 20 dungeons with 187/187 hooks PASSing. Since then:

1. **Schema validation added** — `lib/verify/schema-validator.js` derives expected columns from config and compares against actual output. Hooks that introduce undeclared columns with <100% per-event-type coverage are flagged as SCHEMA-FAIL. This is NEW and may surface flag-stamping bugs that Round 3 didn't catch.
2. **Skill renamed** — `verify-hooks` → `verify-dungeon` (broader scope). The skill now includes a Step 2b: Schema Validation section.
3. **`verifyDungeon()` API updated** — now runs schema validation automatically and returns `schemaReport` alongside pattern results.
4. **verify-runner.mjs** — default run name changed from `verify-hooks` to `verify-dungeon`.

No changes were made to the engine, generators, hook helpers, hook patterns, or any dungeon files themselves. If a dungeon fails schema validation, it means the hook was always flag-stamping — we just couldn't detect it before.

## Working directory

`/Users/ak/code/dungeon-master/` — Node.js ESM module (`@ak--47/dungeon-master`). Read `CLAUDE.md` first for architecture, hook rules, and API surface.

## The 20 dungeons

Process in this order (largest/most complex first — surface failures early):

| # | Dungeon | Users | Days | Rate | ~Events | Hook branches |
|---|---------|-------|------|------|---------|---------------|
| 1 | dating.js | 30K | 120 | 1.5 | 5.4M | 2 |
| 2 | ecommerce.js | 42K | 120 | 0.37 | 1.9M | 4 |
| 3 | insurance-application.js | 15K | 120 | 1.2 | 2.2M | 2 |
| 4 | social.js | 10K | 120 | 1.2 | 1.5M | 2 |
| 5 | sass.js | 10K | 120 | 1.2 | 1.4M | 6 |
| 6 | education.js | 10K | 120 | 1.2 | 1.4M | 6 |
| 7 | fintech.js | 10K | 120 | 1.2 | 1.4M | 5 |
| 8 | gaming.js | 10K | 120 | 1.2 | 1.4M | 5 |
| 9 | healthcare.js | 10K | 120 | 1.2 | 1.4M | 5 |
| 10 | logistics.js | 10K | 120 | 1.2 | 1.4M | 5 |
| 11 | devtools.js | 10K | 120 | 1.2 | 1.4M | 4 |
| 12 | travel.js | 10K | 120 | 1.2 | 1.4M | 4 |
| 13 | community.js | 10K | 120 | 1.2 | 1.4M | 3 |
| 14 | fitness.js | 10K | 120 | 1.2 | 1.4M | 3 |
| 15 | marketplace.js | 10K | 120 | 1.2 | 1.4M | 3 |
| 16 | media.js | 10K | 120 | 1.2 | 1.4M | 3 |
| 17 | food-delivery.js | 10K | 120 | 1.2 | 1.4M | 2 |
| 18 | ai-platform.js | 10K | 120 | 0.83 | 1.0M | 2 |
| 19 | crypto.js | 10K | 120 | 0.83 | 1.0M | 2 |
| 20 | real-estate.js | 10K | 120 | 0.53 | 636K | 2 |

## Verification procedure per dungeon

For each dungeon, execute this sequence:

### 1. Read & catalog

Read the dungeon file. Identify:
- All hook branches (by `type ===` conditions)
- The JSDoc/comment block documenting the engineered patterns
- Module-level closure state (Maps, Sets, tracking variables)
- Any advanced features (personas, worldEvents, engagementDecay, dataQuality)

### 2. Run at full fidelity

```bash
node scripts/verify-runner.mjs dungeons/vertical/<name>.js verify-<name>
```

Wait for the JSON result line before proceeding. Note `eventCount` and `wallMs`.

### 3. Schema validation (NEW — Round 4 addition)

Query the output to check for undeclared columns per event type:

```sql
-- For each unique event type, list columns and coverage
SELECT event, COUNT(*) as total_events
FROM read_json_auto('./data/verify-<name>-EVENTS*.json', sample_size=-1, union_by_name=true)
GROUP BY event ORDER BY total_events DESC;
```

Then for each event type, compare actual columns against what the config declares. Use `DESCRIBE` or column inspection:

```sql
-- Inspect all columns and their non-null rates for a specific event type
WITH filtered AS (
  SELECT * FROM read_json_auto('./data/verify-<name>-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event = '<EVENT_TYPE>'
)
SELECT column_name, COUNT(*) as total, COUNT(column_name) as non_null,
  ROUND(COUNT(column_name) * 100.0 / COUNT(*), 1) as pct
FROM filtered
UNPIVOT (val FOR column_name IN (COLUMNS(*)))
GROUP BY column_name
ORDER BY pct ASC;
```

Cross-reference with the dungeon's `events[].properties`, `superProps`, and config flags (`hasLocation`, `hasBrowser`, `hasCampaigns`, etc.) to identify columns NOT declared in config.

**Verdicts:**
- Column from hook with 100% coverage within that event type → **SCHEMA-PASS** (acceptable uniform enrichment)
- Column from hook with <100% coverage → **SCHEMA-FAIL** (flag stamping — must be fixed)
- Columns from config that are sometimes missing → informational only (campaigns ~25%, world events temporal)

### 4. Hook pattern verification

Run per-hook DuckDB queries following the patterns in the `/verify-dungeon` skill. Key references:
- `CLAUDE.md` Hook System section for hook types and execution order
- `.claude/skills/verify-dungeon/SKILL.md` for query templates, pitfalls, and verdict criteria
- Per-dungeon JSDoc for expected signals and Mixpanel report instructions

### 5. Standard checks

For every dungeon, also run:
- **Identity model invariants** (if `isAuthEvent` configured)
- **SuperProp consistency** (each user has exactly 1 value per superProp)
- **Experiment invariants** (if any funnel has `experiment:`)
- **Event count comparison** against Round 3 (from `research/verticals/ROUND3-SUMMARY.md`)

### 6. Clean up

```bash
rm -f ./data/verify-<name>-*
```

## Handling failures

### Schema validation failures (SCHEMA-FAIL)

If a hook introduces a column with <100% coverage:

1. **Identify** the hook code that adds the property
2. **Fix** the hook:
   - If the column is a boolean flag (`is_whale`, `power_user`, etc.): **remove it entirely**. The pattern should be derived behaviorally in verification queries, not stamped as a flag.
   - If the column is a computed value added conditionally: either define it in the event's `properties` config with a default value, or restructure the hook to set it on ALL events of that type (e.g., set to `null`/`0`/`false` as default, override to the computed value when the condition is met).
3. **Re-run** the dungeon and re-verify

### Hook pattern failures (WEAK/NONE/INVERSE)

Follow the diagnosis patterns in the verify-dungeon SKILL.md:
- Check population thresholds (segment ≥ 20 users)
- Check for funnel-pre dilution
- Check for clone dilution of temporal effects
- Check for normalized vs raw metric confusion
- Check for property baseline dilution

If a hook genuinely fails:
1. Fix the hook code
2. Re-run and re-verify
3. Document the fix in the progress file

### Event count drift

Compare against Round 3 event counts (in `research/verticals/ROUND3-SUMMARY.md`):
- <1% drift: PASS (expected from seeded RNG state interactions)
- 1-5% drift: WARN (investigate but acceptable if hook signals hold)
- >5% drift: FAIL (something changed — investigate before proceeding)

## Output files

Write output to two locations:

### 1. Per-dungeon SQL files → `./research/verifications/v2/`

`research/verifications/v2/` already exists. For each dungeon, write a `.sql` file matching the v1 format:

```
research/verifications/v2/<dungeon-name>.sql
```

**Use the same format as v1** (`research/verifications/v1/*.sql`). Read any v1 file (e.g., `research/verifications/v1/gaming.sql`) as a reference template. The format is:

```sql
-- ============================================================================
-- <name>.js — Hook Verification SQL (N hooks + schema validation)
-- ============================================================================
--
-- USAGE:
--   1. Generate data:
--      node scripts/verify-runner.mjs dungeons/vertical/<name>.js verify-<name>
--
--   2. Run all queries:
--      duckdb -c ".read research/verifications/v2/<name>.sql"
--
-- DATA FILES:
--   data/verify-<name>-EVENTS.json  (or -EVENTS-part-*.json for batched)
--   data/verify-<name>-USERS.json
-- ============================================================================


-- ----------------------------------------------------------------------------
-- SCHEMA VALIDATION (new in v2)
-- ----------------------------------------------------------------------------
-- Checks for columns not declared in the dungeon config.
-- PASS: no undeclared columns, OR undeclared columns have 100% coverage
--       within their event type (uniform enrichment).
-- FAIL: undeclared column with <100% coverage (flag stamping).

<SQL queries that inspect columns per event type>;


-- ----------------------------------------------------------------------------
-- HOOK 1: NAME (TYPE)
-- ----------------------------------------------------------------------------
-- PATTERN: <verbatim from dungeon JSDoc>
--
-- EXPECTED: <numeric expectation>
-- PASS:     <verifiable criterion>

<SQL query>;


-- ----------------------------------------------------------------------------
-- HOOK 2: NAME (TYPE)
-- ----------------------------------------------------------------------------
-- ...
```

Key differences from v1:
- **Schema validation block** at the top (before hook queries)
- For batched dungeons, use glob: `read_json_auto('data/verify-<NAME>-EVENTS-part-*.json', sample_size=-1, union_by_name=true)`
- Bot/anomaly user_id filter when applicable: `WHERE user_id NOT LIKE 'bot_%' AND user_id NOT LIKE 'anomaly_%'`

Also write a `research/verifications/v2/README.md` following the v1 README format — include the verification roll-up table, verdict types, file format spec, and notes on any WEAK hooks.

### 2. Summary + progress → `./research/verticals/`

#### Progress tracking

Write `research/verticals/ROUND4-PROGRESS.md` — update after EACH dungeon:

```markdown
# Round 4 Progress

| # | Dungeon | Status | Events | Schema | Hooks | Notes |
|---|---------|--------|--------|--------|-------|-------|
| 1 | dating | ✅ | 6.3M | PASS | 8/8 STRONG+ | — |
| 2 | ecommerce | ✅ | 2.3M | PASS | 12/12 STRONG+ | — |
| 3 | insurance | 🔄 | — | — | — | running |
| ... |
```

#### Final summary

When all 20 are complete, write `research/verticals/ROUND4-SUMMARY.md`:

```markdown
# Round 4 Summary

**Date:** <date>
**Purpose:** Post-schema-validation re-verification of all 20 verticals
**Mode:** Full-fidelity

## Roll-up

| Metric | Round 3 | Round 4 |
|--------|---------|---------|
| Dungeons verified | 20 | 20 |
| Total hooks | 187 | <count> |
| PASS (STRONG+NAILED) | 187 | <count> |
| Schema PASS | n/a | <count> |
| Schema FAIL | n/a | <count> |
| Regressions | 0 | <count> |

## Event count comparison (R3 → R4)

<table comparing event counts per dungeon, with drift %>

## Schema validation results

<per-dungeon schema verdict: PASS/FAIL with details on any failures found and fixed>

## Hook fixes applied

<list any hooks that were modified, with before/after and reason>

## Per-dungeon detailed results

<for each dungeon: event count, schema verdict, per-hook verdicts, any notes>
```

#### Query log

Write all DuckDB queries and results to `research/verticals/ROUND4-QUERY-LOG.txt` using the format from the verify-dungeon skill (DUNGEON/HOOK/TYPE/VERDICT/SQL/OUTPUT blocks). This is the aggregated version — individual dungeon files in `research/verifications/v2/` have the per-dungeon detail.

## Parallelism strategy

You can run multiple dungeons in parallel using background agents, but:
- Each dungeon needs its own unique run name (`verify-<name>`)
- Don't run more than 3 dungeon generations simultaneously (memory: each dungeon holds 1-5M events in memory)
- Clean up data files between dungeons to avoid disk pressure
- Write to the progress file after each dungeon completes

## Test suite gate

Before starting verification, run the test suite once to confirm baseline:

```bash
npm test
```

All 890 tests must pass. If tests fail, stop and investigate — don't verify against broken code.

## Stopping conditions

Stop and write ROUND4-SUMMARY.md (even if incomplete) if any of:

- A dungeon crashes during generation (not a hook problem — engine bug)
- More than 5 dungeons require hook fixes (systemic issue — flag and report, don't chase all 20)
- A schema fix breaks a hook pattern that was previously STRONG (regression)

## Definition of done

1. All 20 dungeons verified at full fidelity
2. Schema validation results for all 20 (PASS or fixed-to-PASS)
3. All hooks STRONG or NAILED (or documented why WEAK is acceptable)
4. Event counts compared against Round 3 (drift < 1% expected)
5. ROUND4-PROGRESS.md, ROUND4-SUMMARY.md, ROUND4-QUERY-LOG.txt written
6. Any hook fixes committed with message `round4: fix <dungeon> — <description>`
7. NO `git push`. NO `npm publish`. Local commits only.

--- END PROMPT ---
