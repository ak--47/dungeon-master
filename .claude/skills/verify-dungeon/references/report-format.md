# Report Format

Templates and conventions for writing `hook-results.md` and per-dungeon verification SQL. For user dungeons these live in the dungeon's folder (`dungeons/user/<name>/`); otherwise in `./research/`. See [SKILL.md "Artifact location"](../SKILL.md).

## Verdict criteria (5-tier)

- **NAILED** — Within 10% of expected value/ratio. Direction correct, magnitude precise. The story reads exactly as documented.
- **STRONG** — Within 25% of expected. Direction correct, clearly visible. An analyst would find this pattern immediately.
- **WEAK** — Within 50% of expected. Directionally correct but magnitude is off, OR sample size is too small to be conclusive.
- **NONE** — No statistically meaningful difference between cohorts. The hook has no observable effect.
- **INVERSE** — Effect goes the opposite direction from intended. The story is backwards.

NAILED and STRONG are passing verdicts. WEAK, NONE, and INVERSE are failing verdicts that require investigation.

## Ordering: failures first

Within each dungeon section, order detailed results by verdict severity:
1. **INVERSE** hooks first
2. **NONE** hooks second
3. **WEAK** hooks third
4. **STRONG** hooks fourth
5. **NAILED** hooks last

The summary table should also be sorted this way (INVERSE → NONE → WEAK → STRONG → NAILED). This ensures actionable issues are immediately visible at the top.

## Single-dungeon report structure

```markdown
# Dungeon Verification Report

**Dungeon:** `<filename>`
**Run Date:** <date>
**Users:** <count> | **Events:** <count> | **Duration:** <time>

## Schema Validation

| Event Type | Added Columns | Coverage | Verdict |
|-----------|---------------|----------|---------|
| purchase | (none) | — | SCHEMA-PASS |
| page view | (none) | — | SCHEMA-PASS |

<if any SCHEMA-FAIL, list remediation details here>

## Hook Summary

| # | Hook Name | Type | Expected Effect | Observed | Verdict |
|---|-----------|------|-----------------|----------|---------|
| 3 | ... | funnel-pre | ... | ... | INVERSE |
| 2 | ... | everything | ... | ... | WEAK |
| 1 | ... | event | ... | ... | NAILED |

## Detailed Results

<hooks ordered INVERSE → NONE → WEAK → STRONG → NAILED>

### Hook #3: <Name> (INVERSE)
...

### Hook #2: <Name> (WEAK)
...

### Hook #1: <Name> (NAILED)
...

## Recommendations
<For any WEAK or FAIL hooks>
```

## Multi-dungeon report structure

When verifying multiple dungeons, use this consolidated structure. Each dungeon gets its own section with its own summary table and detailed results, all in one file:

```markdown
# Hook Verification Report

**Run Date:** <date>
**Dungeons verified:** <count>

## Overall Summary

| Dungeon | Hooks | NAILED | STRONG | WEAK | NONE | INVERSE |
|---------|-------|--------|--------|------|------|---------|
| `harness-fintech.js` | 8 | 4 | 2 | 1 | 1 | 0 |
| `harness-gaming.js` | 10 | 7 | 2 | 1 | 0 | 0 |

---

## harness-fintech.js

**Users:** <count> | **Events:** <count> | **Duration:** <time>

### Summary

| # | Hook Name | Type | Expected Effect | Observed | Verdict |
|---|-----------|------|-----------------|----------|---------|
| 4 | Low Balance Churn | everything | ... | ... | NONE |
| 2 | Payday Patterns | event | ... | ... | WEAK |
| 1 | Personal vs Business | user | ... | ... | NAILED |
| ... | ... | ... | ... | ... | ... |

### Detailed Results

<hooks ordered INVERSE → NONE → WEAK → STRONG → NAILED>

### Recommendations

<for this dungeon's WEAK/FAIL hooks>

---

## harness-gaming.js

<same structure, repeated per dungeon>

---
```

**Key rules for multi-dungeon reports:**
- The overall summary table at the top shows pass/weak/fail counts per dungeon, sorted with most failures first
- Each dungeon section is self-contained with its own summary, details, and recommendations
- Dungeon sections are ordered by failure count descending (most problems first)
- Use the dungeon filename (without path) as the section header for clarity

## Per-hook detail block

Each hook's detailed section follows this template (same for single and multi-dungeon):

```markdown
### Hook #N: <Name> (<VERDICT>)

**Intent:** <what the hook is supposed to do>
**Type:** `<hook type>`
**Mechanism:** <brief description of how the code works>

**Query:**
```sql
<the actual SQL executed>
```

**Results:**
<paste the DuckDB output table>

**Analysis:** <interpret the numbers — does the ratio/difference match expectations?>

**Verdict:** NAILED / STRONG / WEAK / NONE / INVERSE
```

## Query log format

Write a plain-text log of every DuckDB query execution to `hook-query-log.txt`. For a user dungeon, write it to the dungeon's folder (`dungeons/user/<name>/hook-query-log.txt`). Otherwise, only if `./research/` exists locally write `./research/hook-query-log.txt` — if it doesn't exist, skip this step entirely (don't create the directory; check with `ls -d ./research/ 2>/dev/null`).

Use a consistent delimited format — one block per query, separated by a ruler line. DuckDB table output is preserved verbatim:

```
================================================================================
DUNGEON: gaming.js
HOOK: #1 — Power users have 3x purchase amount
TYPE: everything
VERDICT: STRONG
EXPECTED: ~3x ratio between power and regular users
OBSERVED: 3.05x ratio

SQL:
SELECT segment, AVG(amount) as avg_amt, COUNT(*) as n
FROM read_json_auto('./data/verify-dungeon-EVENTS.json')
WHERE event = 'purchase'
GROUP BY segment;

OUTPUT:
┌────────────┬─────────┬───────┐
│  segment   │ avg_amt │   n   │
│  varchar   │ double  │ int64 │
├────────────┼─────────┼───────┤
│ power_user │   45.20 │  3841 │
│ regular    │   14.80 │ 12037 │
└────────────┴─────────┴───────┘

ANALYSIS: Power users avg $45.20 vs regular $14.80 = 3.05x ratio
================================================================================
```

In batch mode (multiple dungeons), all queries across all dungeons go into the same file sequentially. The format is grep-friendly:

```bash
grep "^VERDICT:" research/hook-query-log.txt           # all verdicts
grep -B4 "^VERDICT: FAIL" research/hook-query-log.txt  # failing hooks with context
grep "^DUNGEON:" research/hook-query-log.txt           # list of dungeons queried
```

## Verification SQL file (mandatory for user dungeons)

When verifying a dungeon in `dungeons/user/`, write a standalone DuckDB SQL file alongside the dungeon in its folder at `dungeons/user/<name>/<name>-verifications.sql`. This file is the reproducible verification artifact — anyone can re-run it against fresh data.

Follow the format in `verification/verticals/`:

```sql
-- ============================================================================
-- <name>.js — Hook Verification SQL (N hooks)
-- ============================================================================
-- USAGE:
--   1. node scripts/verify-runner.mjs dungeons/user/<name>/<name>.js verify-<name>
--   2. duckdb < dungeons/user/<name>/<name>-verifications.sql
--   3. rm -f verify-<name>-*
-- ============================================================================

-- HOOK N: NAME (TYPE)
-- PATTERN: <from dungeon JSDoc>
-- R1 RESULT: <observed> => <verdict>
<SQL>;
```

Each query block includes the pattern description, observed result, and verdict as SQL comments. This makes the file self-documenting and grep-friendly.

**This step is mandatory for user dungeons.** Vertical dungeons already have their SQL in `verification/verticals/`. User dungeons keep theirs co-located with the dungeon file.
