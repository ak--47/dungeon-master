---
name: verify-hooks
description: Run a dungeon with constrained parameters and use DuckDB to verify that hook-created data patterns actually appear in the output. Produces a hook-results.md diagnostic report.
argument-hint: [dungeon path(s), e.g. dungeons/gaming.js or dungeons/fintech.js]
model: claude-opus-4-6
effort: max
---

# Verify Hooks

Verify that the hooks in one or more dungeon configs actually produce their intended data patterns. Run each dungeon at small scale, query the output with DuckDB, and produce a single consolidated `hook-results.md` diagnostic report.

**Dungeon file(s):** `$ARGUMENTS`

## Batch Mode

`$ARGUMENTS` can be:
- A single dungeon path: `dungeons/my-dungeon.js`
- Multiple space-separated paths: `dungeons/fintech.js dungeons/gaming.js`
- A glob pattern: `dungeons/*.js`

When multiple dungeons are provided, process each one sequentially through Steps 1-3 (read, run, verify), then write a single consolidated report in Step 4. Use a unique `name` prefix per dungeon when running (e.g., `verify-hooks-fintech`, `verify-hooks-gaming`) so output files don't collide. Clean up each dungeon's output files after querying them, before running the next dungeon.

## Important: How Hooks Execute in the Pipeline

Before analyzing hooks, understand the execution model so you can correctly predict what the output data should look like:

### Hook Type Execution Order (per user)

1. `"user"` — profile created, hook fires (user-loop.js:137)
2. `"scd-pre"` — SCD entries created, hook fires (user-loop.js:156)
3. `"funnel-pre"` → `"event"` (per funnel event) → `"funnel-post"` — for each funnel
4. `"event"` — for non-funnel events (events.js:176)
5. `"everything"` — all user events at once (user-loop.js:222)
6. **Storage phase** — data written to disk. Hooks for `event`, `user`, `scd` do NOT re-fire here (already applied above). Hooks for `mirror`, `ad-spend`, `group`, `lookup` fire only in storage.

### Return Value Behavior

- `"event"` hook: return value IS used (replaces the event)
- `"everything"` hook: return value IS used if it's an array (replaces event list)
- `"user"`, `"scd-pre"`, `"funnel-post"` hooks: return value is IGNORED — only in-place mutations work
- `"funnel-pre"` hook: return value is IGNORED — mutate the `record` object in-place (e.g., `record.conversionRate = 0.9`)

### Nested Properties

Event properties are usually flat, but some dungeons may use arrays of objects or nested structures in event properties. When querying with DuckDB:
- Use `json_extract()` or arrow syntax (`column->'key'`) for nested JSON fields
- Use `UNNEST()` for array-type columns
- Check the dungeon's event property definitions for any non-scalar types before writing queries
- Run a quick `SELECT * FROM read_json_auto('./data/verify-hooks-EVENTS.json') LIMIT 5` to inspect the actual schema

## Step 1: Read & Catalog the Hooks

Read the dungeon file at `$ARGUMENTS`. If it's a bare filename (no `/`), check `dungeons/` and `dungeons/` directories.

Find and analyze:

1. **The `hook:` function** — read the full function body
2. **The documentation comment block** — typically a `/** ... */` block above or near the hook that describes all the architected patterns
3. **Module-level closure state** — look for `Map`, `Set`, or tracking variables defined outside the hook function but used inside it

For each hook/pattern, catalog:
- **Hook number and name** (e.g., "Hook #1: Ancient Compass users have 3x quest completion")
- **Hook type** (`event`, `everything`, `funnel-pre`, `funnel-post`, `user`, `scd-pre`)
- **Mechanism** — what the hook code actually does (modifies properties, splices events, changes conversion rates, etc.)
- **Expected signal** — the specific, measurable outcome you should see in the data (e.g., "compass_user=true events should have ~1.5x reward_gold compared to compass_user=false")
- **Which output file** the signal lives in (events, users, groups, etc.)
- **Mixpanel report instructions** — check whether the documentation includes specific Mixpanel report instructions (report type, event, measure, breakdown, filter, expected numbers). If missing or vague (e.g., just "break down by X" without specifying report type or expected values), flag this in the report recommendations as "DOCS: needs Mixpanel report instructions"

## Step 2: Run the Dungeon

The verify runner already exists at `scripts/verify-runner.mjs`. Use it — do NOT recreate.

Two modes:

- **Default (full fidelity)** — runs the dungeon with its own `numUsers` / `avgEventsPerUserPerDay` / `numDays` settings as-shipped. This is the only mode whose verdicts you can trust for benchmark/production. Can take minutes for 50K-user dungeons.
- **`--small`** — overrides to 1K users with `avgEventsPerUserPerDay` scaled so total events ≈ 100K. Use for fast smoke checks only. WEAK/FAIL verdicts from `--small` runs are unreliable due to small-cohort variance — re-verify at full fidelity before reporting.

```bash
# Full fidelity (production-grade verification)
node scripts/verify-runner.mjs <dungeon-path> <run-name>

# Small smoke test
node scripts/verify-runner.mjs <dungeon-path> <run-name> --small
```

Examples:
```bash
node scripts/verify-runner.mjs dungeons/vertical/gaming.js verify-gaming
node scripts/verify-runner.mjs dungeons/vertical/gaming.js verify-gaming --small
```

**Expected output files** (in `./data/`, using `<run-name>` as prefix):
- `<run-name>-EVENTS.json` — all events (JSONL format, one JSON object per line)
- `<run-name>-USERS.json` — user profiles
- `<run-name>-*-GROUPS.json` — group profiles (if dungeon has groups)
- `<run-name>-*-SCD.json` — SCD data (if dungeon has SCDs)

Update your DuckDB queries to use the correct file prefix (e.g., `./data/verify-fintech-EVENTS.json` instead of `./data/verify-hooks-EVENTS.json`).

## Step 3: Verify Each Hook with DuckDB

For each cataloged hook, write and execute a DuckDB SQL query that tests whether the expected pattern exists in the data.

**DuckDB command pattern:**
```bash
duckdb -c "SQL_QUERY_HERE"
```

**Reading data files:**
```sql
-- Events
SELECT * FROM read_json_auto('./data/verify-hooks-EVENTS.json')

-- User profiles
SELECT * FROM read_json_auto('./data/verify-hooks-USERS.json')
```

### Important DuckDB Notes

- The output is **JSONL** (newline-delimited JSON) — `read_json_auto()` handles this natively
- **Properties are FLAT on event records** — use `event.amount`, NOT `event.properties.amount`
- **Time field** is an ISO string — use `CAST(time AS TIMESTAMP)` or `time::TIMESTAMP` for date operations
- Use `COALESCE(column, default)` for properties that only exist on some events (spliced events may lack some fields)
- Use `TRY_CAST()` instead of `CAST()` for columns that might have mixed types
- For large queries, use `LIMIT` to keep output manageable
- Escape single quotes in bash: use `$'...'` syntax or double-quote the SQL and escape internal quotes

### Pitfall: Bot/Anomaly user_id Breaks UUID Type Inference

When a dungeon uses `dataQuality.botUsers > 0` or `anomalies` features, some events have `user_id` like `"bot_db9a7a37"` or `"anomaly_f148a044"` instead of UUIDs. DuckDB's auto-inference reads the first chunk as UUID, then fails on the string IDs:

```
Conversion Error: Could not convert string 'bot_db9a7a37' to INT128
```

**Fix:** every query against EVENTS must use `sample_size=-1` to scan all rows for typing AND filter out the synthetic IDs:

```sql
SELECT ... FROM read_json_auto('./data/verify-X-EVENTS.json', sample_size=-1)
WHERE user_id NOT LIKE 'bot_%' AND user_id NOT LIKE 'anomaly_%'
```

For joins on USERS where the join key is UUID, cast both sides to VARCHAR:
```sql
JOIN read_json_auto('./data/verify-X-USERS.json') u
  ON u.distinct_id::VARCHAR = e.user_id::VARCHAR
```

### Pitfall: Multi-Part EVENTS Files (Batch Mode)

Dungeons that produce >2M total events auto-enable batch mode. Output is split into part files:

```
data/verify-X-EVENTS-part-1.json
data/verify-X-EVENTS-part-2.json
data/verify-X-EVENTS-part-3.json
```

Use a glob plus `union_by_name=true` (schemas may differ slightly across parts):

```sql
SELECT ... FROM read_json_auto('./data/verify-X-EVENTS-part-*.json',
  sample_size=-1, union_by_name=true)
```

### Pitfall: DuckDB Reserved Words

DuckDB reserves common identifiers including `on`, `at`, `from`, `to`, `order`, `group`. If you name a CTE column `on` (e.g. "order count"), the parser fails:

```
Parser Error: syntax error at or near "on"
```

Use suffixed names: `order_n`, `txn_n`, `swap_n`. Same applies to `at` / `to` etc.

### Pitfall: Schema Mismatch Between JSDoc and Actual Data

Stale JSDocs sometimes reference field names that don't exist in the actual data. Sass docs reference `integration_app` but actual prop is `integration_type`. Travel docs reference `segment` but actual user prop is `customer_segment`.

When a query returns 0 rows or NULL where you expected data, run `DESCRIBE SELECT * FROM read_json_auto(...)` to inspect actual columns and adjust the query. If the doc is wrong (not the hook), note this in results.md as a doc nit.

### Pitfall: Nested Properties

Some events store data in struct/array columns (e.g. ecommerce checkout has `cart STRUCT(...)[]`). The flat columns `amount`/`total_value` will be NULL — actual data is inside the array. Use `UNNEST(cart)` or `cart[1].total_value` to access.

### How Hooks Work (Critical for Query Design)

Hooks do NOT add new properties to the schema. They modify existing property values, filter/remove events, and inject events cloned from existing ones. This means you often CANNOT verify a hook by checking for a boolean flag's existence. Instead, verify by:

1. **Comparing value magnitudes** across segments — e.g., power users should have ~3x higher avg purchase amount
2. **Comparing value distributions in time windows** — e.g., avg amount on 1st/15th of month vs other days
3. **Deriving behavioral segments from the data itself** — e.g., sessionize the event stream, count sessions, compare users with >20 sessions vs fewer
4. **Checking event density patterns** — e.g., cloned/injected events create unusually dense clusters within short time windows
5. **Cross-table joins** — e.g., join user profiles with events to see if user-level properties correlate with event-level value differences

Some hooks DO define boolean properties in the config with defaults (e.g., `payday: [false]`) that the hook sets to `true`. For those, you CAN query `WHERE payday = true`. But always check the dungeon's event config to see what properties are defined — don't assume a hook-created flag exists just because the documentation mentions a pattern.

### Query Design Approach

For each hook, design a query that compares:
- **Affected group** (users/events where the hook should have had an effect)
- **Control group** (users/events where the hook should NOT have had an effect)
- **Metric** (the specific measure that should differ between groups)

Then compute a **ratio** or **difference** and compare it to the expected effect size.

### DuckDB Query Templates by Hook Archetype

**Segment Comparison** (e.g., "premium users have higher engagement"):
```sql
SELECT
  segment_property,
  COUNT(*) as event_count,
  AVG(metric) as avg_metric,
  COUNT(DISTINCT user_id) as unique_users
FROM read_json_auto('./data/verify-hooks-EVENTS.json')
WHERE event = 'relevant_event'
GROUP BY segment_property
ORDER BY segment_property;
```

**Time-Based Anomaly** (e.g., "cursed week has higher death rate"):
```sql
WITH events AS (
  SELECT *, time::TIMESTAMP as ts
  FROM read_json_auto('./data/verify-hooks-EVENTS.json')
)
SELECT
  CASE
    WHEN ts BETWEEN 'start_date' AND 'end_date' THEN 'anomaly_window'
    ELSE 'normal'
  END as period,
  COUNT(*) FILTER (WHERE event = 'target_event') as target_count,
  COUNT(*) as total_events,
  ROUND(COUNT(*) FILTER (WHERE event = 'target_event') * 100.0 / COUNT(*), 2) as target_pct
FROM events
GROUP BY period;
```

**Retention / Churn** (e.g., "early guild joiners retain better"):
```sql
WITH user_first_event AS (
  SELECT user_id, MIN(time::TIMESTAMP) as first_seen
  FROM read_json_auto('./data/verify-hooks-EVENTS.json')
  GROUP BY user_id
),
user_segments AS (
  SELECT
    e.user_id,
    BOOL_OR(e.event = 'guild joined'
      AND (e.time::TIMESTAMP - f.first_seen) < INTERVAL '3 days') as early_joiner
  FROM read_json_auto('./data/verify-hooks-EVENTS.json') e
  JOIN user_first_event f ON e.user_id = f.user_id
  GROUP BY e.user_id
),
user_activity AS (
  SELECT
    e.user_id,
    MAX(e.time::TIMESTAMP) - MIN(e.time::TIMESTAMP) as active_span
  FROM read_json_auto('./data/verify-hooks-EVENTS.json') e
  GROUP BY e.user_id
)
SELECT
  s.early_joiner,
  COUNT(*) as users,
  AVG(EXTRACT(DAY FROM a.active_span)) as avg_active_days
FROM user_segments s
JOIN user_activity a ON s.user_id = a.user_id
GROUP BY s.early_joiner;
```

**Revenue / LTV** (e.g., "lucky charm buyers spend 5x more"):
```sql
WITH buyer_segments AS (
  SELECT
    user_id,
    BOOL_OR(event = 'real money purchase' AND product = 'Lucky Charm Pack') as is_target_buyer
  FROM read_json_auto('./data/verify-hooks-EVENTS.json')
  GROUP BY user_id
)
SELECT
  b.is_target_buyer,
  COUNT(*) FILTER (WHERE e.event = 'real money purchase') as purchase_count,
  ROUND(AVG(TRY_CAST(e.price_usd AS DOUBLE)), 2) as avg_purchase,
  ROUND(SUM(TRY_CAST(e.price_usd AS DOUBLE)), 2) as total_revenue,
  COUNT(DISTINCT b.user_id) as users
FROM buyer_segments b
JOIN read_json_auto('./data/verify-hooks-EVENTS.json') e ON b.user_id = e.user_id
GROUP BY b.is_target_buyer;
```

**Funnel Conversion** (e.g., "segment A converts better"):
```sql
WITH step1 AS (
  SELECT DISTINCT user_id, segment_prop
  FROM read_json_auto('./data/verify-hooks-EVENTS.json')
  WHERE event = 'funnel_step_1'
),
step2 AS (
  SELECT DISTINCT user_id
  FROM read_json_auto('./data/verify-hooks-EVENTS.json')
  WHERE event = 'funnel_step_2'
)
SELECT
  s1.segment_prop,
  COUNT(DISTINCT s1.user_id) as started,
  COUNT(DISTINCT s2.user_id) as completed,
  ROUND(COUNT(DISTINCT s2.user_id) * 100.0 / COUNT(DISTINCT s1.user_id), 2) as conversion_pct
FROM step1 s1
LEFT JOIN step2 s2 ON s1.user_id = s2.user_id
GROUP BY s1.segment_prop;
```

**Property Distribution Shift** (e.g., "completion_status breakdown differs by segment"):
```sql
SELECT
  segment_column,
  property_column,
  COUNT(*) as cnt,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (PARTITION BY segment_column), 2) as pct
FROM read_json_auto('./data/verify-hooks-EVENTS.json')
WHERE event = 'relevant_event'
GROUP BY segment_column, property_column
ORDER BY segment_column, cnt DESC;
```

**Event Existence After Date** (e.g., "legendary weapon only appears after day 45"):
```sql
SELECT
  CASE WHEN time::TIMESTAMP < 'release_date' THEN 'before' ELSE 'after' END as period,
  COUNT(*) as occurrences
FROM read_json_auto('./data/verify-hooks-EVENTS.json')
WHERE event = 'find treasure' AND treasure_type = 'Shadowmourne Legendary'
GROUP BY period;
```

**Value Magnitude by Behavioral Segment** (e.g., "power users make 3x higher purchases" where power user is derived from behavior, not a flag):
```sql
-- Sessionize: derive power users from event density (30-min gap)
WITH ordered AS (
  SELECT *, time::TIMESTAMP as ts,
    LAG(time::TIMESTAMP) OVER (PARTITION BY user_id ORDER BY time) as prev_ts
  FROM read_json_auto('./data/verify-hooks-EVENTS.json')
),
sessions AS (
  SELECT user_id,
    SUM(CASE WHEN prev_ts IS NULL OR ts - prev_ts > INTERVAL '30 minutes' THEN 1 ELSE 0 END) as session_count
  FROM ordered
  GROUP BY user_id
),
segments AS (
  SELECT user_id,
    CASE WHEN session_count > 20 THEN 'power_user' ELSE 'regular' END as segment
  FROM sessions
)
SELECT
  seg.segment,
  COUNT(*) as purchase_count,
  ROUND(AVG(TRY_CAST(e.amount AS DOUBLE)), 2) as avg_amount,
  COUNT(DISTINCT seg.user_id) as users
FROM segments seg
JOIN read_json_auto('./data/verify-hooks-EVENTS.json') e ON seg.user_id = e.user_id
WHERE e.event = 'purchase'
GROUP BY seg.segment;
```

**Temporal Value Scaling** (e.g., "amounts are 3x higher on 1st/15th of month"):
```sql
SELECT
  CASE WHEN EXTRACT(DAY FROM time::TIMESTAMP) IN (1, 15) THEN 'payday' ELSE 'normal_day' END as period,
  COUNT(*) as event_count,
  ROUND(AVG(TRY_CAST(amount AS DOUBLE)), 2) as avg_amount,
  ROUND(MEDIAN(TRY_CAST(amount AS DOUBLE)), 2) as median_amount
FROM read_json_auto('./data/verify-hooks-EVENTS.json')
WHERE event = 'transaction completed'
GROUP BY period;
```

**Injected Event Detection** (e.g., "cloned purchase events appear in sessions that had browse-but-no-buy"):
```sql
-- Look for event density anomalies: multiple events of same type within short windows
WITH events AS (
  SELECT *, time::TIMESTAMP as ts,
    LAG(time::TIMESTAMP) OVER (PARTITION BY user_id, event ORDER BY time) as prev_same_event
  FROM read_json_auto('./data/verify-hooks-EVENTS.json')
  WHERE event = 'purchase'
)
SELECT
  CASE WHEN prev_same_event IS NOT NULL AND ts - prev_same_event < INTERVAL '10 minutes'
    THEN 'rapid_cluster' ELSE 'normal_spacing' END as pattern,
  COUNT(*) as count,
  ROUND(AVG(TRY_CAST(amount AS DOUBLE)), 2) as avg_amount
FROM events
GROUP BY pattern;
```

**Cross-Table Correlation** (e.g., "user profile tier drives event behavior via `everything` hook"):

The `everything` hook can read `meta.profile` and modify event values based on user properties. To verify, JOIN events with user profiles:
```sql
WITH users AS (
  SELECT * FROM read_json_auto('./data/verify-hooks-USERS.json')
),
events AS (
  SELECT * FROM read_json_auto('./data/verify-hooks-EVENTS.json')
)
SELECT
  u.tier,
  COUNT(*) as event_count,
  COUNT(DISTINCT e.user_id) as user_count,
  ROUND(COUNT(*) * 1.0 / COUNT(DISTINCT e.user_id), 2) as events_per_user,
  AVG(TRY_CAST(e.metric AS DOUBLE)) as avg_metric
FROM events e
JOIN users u ON e.user_id = u.distinct_id
GROUP BY u.tier
ORDER BY u.tier;
```

When verifying `everything` hooks, you often MUST join events with user profiles. The `everything` hook reads `meta.profile` and modifies event values based on user properties — but those user properties live in the USERS file, not the EVENTS file. The join key is **`events.user_id = users.distinct_id`** (events use `user_id`, profiles use `distinct_id`). Common cross-table patterns to verify:
- User tier/segment → higher/lower event values (amounts, durations, scores)
- User profile properties → different event counts or conversion rates
- Churn simulation: users with certain profiles have fewer events in later time periods

**Output files by data type:**
- `verify-hooks-EVENTS.json` — events (most hooks produce effects here)
- `verify-hooks-USERS.json` — user profiles (check for `user` hook enrichment)
- `verify-hooks-*-GROUPS.json` — group profiles (if groups configured)
- `verify-hooks-*-SCD.json` — SCD data (if SCDs configured)

**Advanced Feature Verification** (if the dungeon uses advanced features):

Advanced features (personas, worldEvents, engagementDecay, dataQuality, subscription, attribution, geo, features, anomalies) produce data patterns alongside hooks. When verifying, also check:

```sql
-- Personas: check distribution matches configured weights
SELECT _persona, count(*) as users FROM read_json_auto('./data/verify-hooks-USERS.json') WHERE _persona IS NOT NULL GROUP BY 1;

-- World Events: check injected properties exist during event windows
SELECT promo, count(*) FROM read_json_auto('./data/verify-hooks-EVENTS.json') WHERE promo IS NOT NULL GROUP BY 1;

-- Data Quality: verify bots, nulls, empty events
SELECT 'bots' as metric, count(*) FROM read_json_auto('./data/verify-hooks-USERS.json') WHERE is_bot = true
UNION ALL SELECT 'null_props', count(*) FROM read_json_auto('./data/verify-hooks-EVENTS.json') WHERE category IS NULL;

-- Subscription: lifecycle events generated
SELECT event, count(*) FROM read_json_auto('./data/verify-hooks-EVENTS.json')
WHERE event IN ('trial started','subscription started','plan upgraded','subscription cancelled') GROUP BY 1;

-- Attribution: campaign sources on profiles
SELECT utm_source, count(*) FROM read_json_auto('./data/verify-hooks-USERS.json') WHERE utm_source IS NOT NULL GROUP BY 1;

-- Geo: region distribution
SELECT _region, count(*) FROM read_json_auto('./data/verify-hooks-USERS.json') WHERE _region IS NOT NULL GROUP BY 1;

-- Features: progressive adoption properties
SELECT theme, count(*) FROM read_json_auto('./data/verify-hooks-EVENTS.json') WHERE theme IS NOT NULL GROUP BY 1;

-- Anomalies: burst/extreme events
SELECT _anomaly, count(*) FROM read_json_auto('./data/verify-hooks-EVENTS.json') WHERE _anomaly IS NOT NULL GROUP BY 1;
```

Include advanced feature verification results in the report when the dungeon uses these features. Advanced feature patterns should ALWAYS be present (they're deterministic from config), unlike hooks which may have statistical variance.

### Query Execution

Run each query separately. For each query:
1. Execute via `duckdb -c "..."`
2. Capture the output
3. If a query fails (column not found, type error), adjust and retry — the schema depends on what the hook actually writes
4. Record both the query and the raw results
5. Accumulate a structured log of every query execution (see Step 3b)

### Standard Verification Checks (Run for Every Dungeon)

In addition to per-hook queries, run these standard checks for every dungeon:

**1. SuperProp Consistency** — verify each user has exactly 1 value per superProp. Adapt the column name for each superProp key in the dungeon:
```sql
SELECT
  'PROP_NAME' as prop,
  COUNT(*) as total_users,
  COUNT(*) FILTER (WHERE n = 1) as consistent,
  COUNT(*) FILTER (WHERE n > 1) as inconsistent,
  ROUND(COUNT(*) FILTER (WHERE n = 1) * 100.0 / COUNT(*), 1) as consistency_pct
FROM (
  SELECT user_id, COUNT(DISTINCT PROP_NAME) as n
  FROM read_json_auto('./data/verify-hooks-EVENTS.json')
  GROUP BY user_id
);
```
Verdict: **PASS** >= 99% consistent, **WEAK** 90-99%, **FAIL** < 90%.

**2. SuperProp-UserProp Mirror Check** — verify that every superProp key also appears on user profiles. Compare the dungeon's `superProps` keys against the columns in the USERS file. Any superProp not mirrored in `userProps` means the stamping fix is incomplete.

**3. Mixpanel Default Property Casing Check** — the system generates device properties with Mixpanel's standard casing (`Platform` with capital P, `os`, `model`, etc.) and location properties (`city`, `region`, `country`). If a dungeon defines a superProp with conflicting casing (e.g., lowercase `platform`), both properties will appear on events — confusing in Mixpanel. Check for:
- `platform` (lowercase) vs system `Platform` — verdict **FAIL** if dungeon uses lowercase
- `City`, `Region`, `Country` vs system `city`, `region`, `country` — check casing matches

**4. funnel-pre Dilution Check** — for any dungeon with `funnel-pre` conversionRate modifications, verify the actual visible effect:
- A `conversionRate *= 1.5` in funnel-pre typically shows as ~1.02-1.08x in the data (diluted by organic events)
- If observed ratio is < 1.1x for a funnel-pre conversionRate hook, verdict is **FAIL** with note: "funnel-pre conversionRate diluted by organic events — migrate to `everything` hook event filtering"
- When the dungeon uses `everything` hook filtering instead, expect the full intended ratio (1.3-1.5x)

### Population Threshold Validation

When a hook targets a specific segment, verify the affected population is large enough to produce a visible signal:

```sql
SELECT
  segment_column,
  COUNT(DISTINCT user_id) as users,
  ROUND(COUNT(DISTINCT user_id) * 100.0 / (SELECT COUNT(DISTINCT user_id) FROM read_json_auto('./data/verify-hooks-EVENTS.json')), 1) as pct_of_users
FROM read_json_auto('./data/verify-hooks-EVENTS.json')
WHERE event = 'relevant_event'
GROUP BY segment_column
ORDER BY users DESC;
```

**Thresholds (at 1K users):**
- Segment < 20 users (< 2%): hook signal will be WEAK or invisible — flag as "insufficient population"
- Segment 20-50 users: may show signal but with high variance — note in report
- Segment > 50 users: should show clear signal if hook effect >= 1.3x

### Statistical Caveats

At full fidelity (the default — dungeon's own scale):
- Cohorts of all sizes should produce clear signal because the absolute population is large
- WEAK results at full fidelity indicate a real problem — investigate

With `--small` (1K users / 100K events):
- Most hooks with >= 10% affected population will show clear signal
- Hooks affecting < 2% of users (e.g., "2% find legendary weapon") may show WEAK results due to small sample size — DO NOT report these as broken without re-running at full fidelity
- Always re-verify any FAIL/WEAK at full fidelity before writing the report

### Verifying No-Flag Cohort Patterns (REV 2)

Modern dungeons hide cohort effects behind raw event mutations rather than stamping flags like `is_whale=true`. Verification must DERIVE the cohort behaviorally, then measure the downstream metric.

**Magic-number BEHAVIORAL pattern** — count an event per user, bin into low/sweet/over, compare downstream metric per bucket:

```sql
WITH x_counts AS (
    SELECT user_id, COUNT(*) FILTER (WHERE event = '<X_EVENT>') AS x_n
    FROM read_json_auto('./data/<run>-EVENTS.json')
    GROUP BY user_id
),
buckets AS (
    SELECT user_id,
        CASE WHEN x_n < <SWEET_LOW> THEN 'low'
             WHEN x_n <= <SWEET_HIGH> THEN 'sweet'
             ELSE 'over' END AS bucket
    FROM x_counts
)
SELECT b.bucket,
    COUNT(DISTINCT b.user_id) AS users,
    AVG(TRY_CAST(e.<TARGET_PROP> AS DOUBLE)) AS avg_target_prop,
    COUNT(*) FILTER (WHERE e.event = '<TARGET_EVENT>') AS total_target_events,
    ROUND(COUNT(*) FILTER (WHERE e.event = '<TARGET_EVENT>') * 1.0 /
          COUNT(DISTINCT b.user_id), 2) AS target_per_user
FROM buckets b
JOIN read_json_auto('./data/<run>-EVENTS.json') e ON b.user_id = e.user_id
GROUP BY b.bucket;
```

**Verdict criteria for inverted-U**:
- `sweet` bucket avg target ≥ 1.2x `low` bucket → boost present (PASS)
- `over` bucket target_per_user ≤ 0.7x `sweet` bucket → drop present (PASS)
- Both visible → inverted-U PASS
- Either missing → flag as WEAK or FAIL with note about cohort sizes

**Population caveat**: high-volume target events can push most users into the `over` bucket at small scale, masking the sweet effect. Re-run at full fidelity if `over` >> `sweet` cohort sizes.

**Inverted-U cohort confound — use NORMALIZED metric for the drop side:**

The "over" bucket users have higher activity by definition (they crossed the threshold). So per-user metrics for downstream events naturally INCREASE with bucket — masking any drop hook. Example from devtools H9:

| bucket | builds | deploys | deploys_per_user | deploys_per_build (NORMALIZED) |
|--------|--------|---------|------------------|--------------------------------|
| low    | 10457  | 6623    | 5.02             | 0.633                          |
| sweet  | 43351  | 36770   | 18.28 (looks BIG)| 0.848 (boost visible)         |
| over   | 86765  | 52024   | 31.43 (looks BIGGER)| 0.600 (drop visible)        |

`deploys_per_user` shows over > sweet > low (cohort effect dominates). `deploys_per_build` correctly shows boost (sweet > low) AND drop (over < sweet). Always include the normalized variant in the drop-side query.

When the dungeon doesn't have a natural "per-X" denominator, compute one from the cohort-binning event: `target_events / cohort_event_count`.

**Time-to-convert (funnel-post) verification** — compute median A→B time per profile segment:

```sql
WITH funnel AS (
    SELECT user_id,
        MIN(time::TIMESTAMP) FILTER (WHERE event = '<STEP_A>') AS a_time,
        MIN(time::TIMESTAMP) FILTER (WHERE event = '<STEP_B>') AS b_time
    FROM read_json_auto('./data/<run>-EVENTS.json')
    GROUP BY user_id
)
SELECT u.<SEGMENT_KEY>,
    COUNT(*) AS users,
    ROUND(MEDIAN(EXTRACT(EPOCH FROM (b_time - a_time)) / 60), 2) AS median_min_a_to_b
FROM funnel f
JOIN read_json_auto('./data/<run>-USERS.json') u ON f.user_id = u.distinct_id
WHERE a_time IS NOT NULL AND b_time IS NOT NULL
GROUP BY u.<SEGMENT_KEY>
ORDER BY median_min_a_to_b;
```

**Verdict for T2C**:
- Fast segment ≤ 0.85x baseline → PASS
- Slow segment ≥ 1.2x baseline → PASS
- Both directions visible → PASS
- One/both missing → check that funnel exists in `funnels:` config and segment property is on `meta.profile`

**Two-tier T2C interpretation**: When a dungeon has only 2 tiers (e.g. Free vs Paid) the funnel-post hook factor `1.0` branch (the "other" / baseline) never fires — both tiers fall into either fast or slow. Pick the slower of the two as the implicit baseline, then verify the faster shows ≤ 0.85x of it.

**No-flag verification rule**: NEVER attempt to verify a hook by querying for a flag like `WHERE sweet_spot = true`. If a dungeon has such flags, treat them as a doc bug — the hook should be reworked to hide the cohort behaviorally. The validator's job is to derive cohorts behaviorally.

### Drop-Event Funnel Dilution Diagnosis (REV 7)

Many dungeons have hooks of pattern `record.filter(e => e.event === 'X' && chance.bool({likelihood: 30}))` to drop ~30% of step-3 events for non-paid tier. The doc claims the hook produces a 30% conversion drop in the funnel — but funnel completion rates often barely move (e.g. 95% vs 97%).

**Why:** the hook drops EVENTS not users. A user with 5 step-3 events still appears in the funnel after losing 1-2 events. Funnel completion = `users with ≥1 step-3 event` — only zero-step-3 users disappear from the conversion count, which is rare.

**Correct verification metric:** per-user volume of step-3 events by tier:

```sql
SELECT u.subscription_tier,
  COUNT(DISTINCT user_id) AS users,
  COUNT(*) AS total_step3,
  ROUND(COUNT(*) * 1.0 / COUNT(DISTINCT user_id), 2) AS per_user
FROM read_json_auto('./data/<run>-EVENTS.json')
WHERE event = '<STEP_3_EVENT>'
GROUP BY u.subscription_tier
ORDER BY per_user DESC;
```

Expected: paid tier ~ 1.5x non-paid per_user (matches 30% drop on non-paid → paid keeps 100%, non-paid keeps 70%, ratio 1/0.7 = 1.43x).

If funnel completion gap < 5pt but per_user gap ≥ 30%, the hook IS firing — the doc just points to the wrong metric. Mark PASS, recommend doc redirect to per-user query.

### Subscription Tier Cohort Sizing Check

Before testing any hook gated on `subscription_tier === "annual"` or `"family"`, check cohort sizes:

```sql
SELECT subscription_plan, COUNT(*) FROM read_json_auto('./data/<run>-USERS.json')
GROUP BY subscription_plan;
```

The default subscription lifecycle (`trialToPayRate=0.30`, `upgradeRate=0.06-0.08`) produces ~85% NULL/Free, ~10-15% Monthly, <2% Annual, ~0% Family at 5K users. Cohorts < 50 users will not produce statistically clean signal at any effect size.

**If annual cohort < 50 users:**
- Don't trust per-tier ratios — note "cohort too small" in results.md
- Per REV 6 you may bump `numUsers` up to 5x to enlarge cohorts
- Or recommend dungeon author tighten subscription lifecycle config

### Per-Day Normalization for Time-Window Hooks

Time-window hooks (e.g. "5x deaths in cursed week d40-47") often produce similar per-USER counts across windows because users active in the window are different from users active overall. Compare per-DAY rates instead:

```
cursed period (7 days): 20711 deaths / 2948 users = 7.03 deaths/user
other period (~93 days): 34857 deaths / 4984 users = 6.99 deaths/user

Per-day rate:
  cursed: 7.03 / 7 = 1.00 deaths/user/day
  other: 6.99 / 93 = 0.075 deaths/user/day
  ratio: 13x  ← signal lives here
```

For any spike/burst hook with a tight day window, ALWAYS normalize by window length before comparing.

### Determinism Check (Optional Confidence Test)

The pinned `datasetStart`/`datasetEnd` window plus seeded RNG produces bit-exact identical output across runs. To confirm no non-determinism crept in (e.g. wall-clock leak in a hook):

1. Run a previously-PASSing dungeon a second time.
2. Compare `eventCount` in the runner's JSON output — must match exactly.
3. Re-run the hook's headline query and verify ratios match to 4 decimals.

If anything differs, the hook has a non-determinism source (typically `dayjs()`, `Date.now()`, `Math.random()`, or stale module-level state). Fix before continuing.

### Critical Time-Window Verification Pattern

Many dungeons use relative time windows (e.g., "spike on days 75-85"). The post-shift dataset start is exposed to hooks as `meta.datasetStart` (unix seconds). For DuckDB verification, use the same anchor:

```sql
-- WRONG: uses MIN(time) which is up to 30 days BEFORE dataset start (pre-existing user spread)
SELECT *, EXTRACT(EPOCH FROM (time::TIMESTAMP - (SELECT MIN(time::TIMESTAMP) FROM events))) / 86400 as day_in
FROM events;

-- RIGHT: anchor to MAX(time) - num_days, which is the post-shift dataset start
WITH bounds AS (
  SELECT MAX(time::TIMESTAMP) - INTERVAL 'NUM_DAYS' day as datasetStart
  FROM events
)
SELECT *, EXTRACT(EPOCH FROM (e.time::TIMESTAMP - b.datasetStart)) / 86400 as day_in
FROM events e, bounds b;
```

Pre-existing users have events for up to 30 days BEFORE the dataset start (`preExistingSpread: 'uniform'` default in macro). MIN(time) reflects those pre-existing events, not the dataset window. Always anchor to MAX(time) - num_days for "day in dataset" calculations.

## Step 3b: Stash Query Results to Disk

If `./research/` exists locally, write a plain-text log of every DuckDB query execution to `./research/hook-query-log.txt`. If `./research/` does not exist, skip this step entirely — do not create the directory.

Check with: `ls -d ./research/ 2>/dev/null`

Use a consistent delimited format — one block per query, separated by a ruler line. DuckDB table output is preserved verbatim (no escaping):

```
================================================================================
DUNGEON: gaming.js
HOOK: #1 — Power users have 3x purchase amount
TYPE: everything
VERDICT: PASS
EXPECTED: ~3x ratio between power and regular users
OBSERVED: 3.05x ratio

SQL:
SELECT segment, AVG(amount) as avg_amt, COUNT(*) as n
FROM read_json_auto('./data/verify-hooks-EVENTS.json')
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
grep "^DUNGEON:" research/hook-query-log.txt            # list of dungeons queried
```

## Step 4: Write hook-results.md

Write the diagnostic report to `./research/hook-results.md` in the project root.

### Ordering: Failures First

**Critical:** Within each dungeon section, order the detailed results by verdict severity:
1. **FAIL** hooks first
2. **WEAK** hooks second
3. **PASS** hooks last

The summary table should also be sorted this way (FAIL → WEAK → PASS). This ensures the actionable issues are immediately visible at the top.

### Single Dungeon Report Structure

When verifying a single dungeon, use this structure:

```markdown
# Hook Verification Report

**Dungeon:** `<filename>`
**Run Date:** <date>
**Users:** <count> | **Events:** <count> | **Duration:** <time>

## Summary

| # | Hook Name | Type | Expected Effect | Observed | Verdict |
|---|-----------|------|-----------------|----------|---------|
| 3 | ... | funnel-pre | ... | ... | FAIL |
| 2 | ... | everything | ... | ... | WEAK |
| 1 | ... | event | ... | ... | PASS |

## Detailed Results

<hooks ordered FAIL → WEAK → PASS>

### Hook #3: <Name> (FAIL)
...

### Hook #2: <Name> (WEAK)
...

### Hook #1: <Name> (PASS)
...

## Recommendations
<For any WEAK or FAIL hooks>
```

### Multi-Dungeon Report Structure

When verifying multiple dungeons, use this consolidated structure. Each dungeon gets its own section with its own summary table and detailed results, all in one file:

```markdown
# Hook Verification Report

**Run Date:** <date>
**Dungeons verified:** <count>

## Overall Summary

| Dungeon | Hooks | PASS | WEAK | FAIL |
|---------|-------|------|------|------|
| `harness-fintech.js` | 8 | 6 | 1 | 1 |
| `harness-gaming.js` | 10 | 9 | 1 | 0 |

---

## harness-fintech.js

**Users:** <count> | **Events:** <count> | **Duration:** <time>

### Summary

| # | Hook Name | Type | Expected Effect | Observed | Verdict |
|---|-----------|------|-----------------|----------|---------|
| 4 | Low Balance Churn | everything | ... | ... | FAIL |
| 2 | Payday Patterns | event | ... | ... | WEAK |
| 1 | Personal vs Business | user | ... | ... | PASS |
| ... | ... | ... | ... | ... | ... |

### Detailed Results

<hooks ordered FAIL → WEAK → PASS>

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

### Per-Hook Detail Block

Each hook's detailed section follows this template (same for single and multi-dungeon):

```markdown
### Hook #N: <Name> (<VERDICT>)

**Intent:** <what the hook is supposed to do>
**Type:** `<hook type>`
**Mechanism:** <brief description of how the code works>

**Query:**
```sql
<the actual SQL executed>
`` `

**Results:**
<paste the DuckDB output table>

**Analysis:** <interpret the numbers — does the ratio/difference match expectations?>

**Verdict:** PASS / WEAK / FAIL
```

### Verdict Criteria

- **PASS** — The observed effect is >= 60% of the expected magnitude and in the correct direction
- **WEAK** — The pattern exists (correct direction) but is weaker than expected (30-60% of target), OR the sample size is too small to be conclusive
- **FAIL** — No discernible pattern, the effect is reversed, or the hook-created properties don't appear in the data at all

## Step 5: Cleanup

After writing the report:

```bash
rm -f ./data/verify-*
rm -f ./verify-runner.mjs
```

Remove ALL files matching the `verify-*` pattern in `./data/` (covers all per-dungeon prefixes like `verify-fintech-*`, `verify-gaming-*`, etc.). Also remove the temporary runner script.

## Final Output

After cleanup, tell the user:
1. Where the report is: `./research/hook-results.md`
2. Whether the query log was written: `./research/hook-query-log.txt` (only if `./research/` existed)
3. How many hooks passed, were weak, or failed (per dungeon if batch mode)
4. A one-line summary of the most interesting finding

If hooks failed, note that `hook-results.md` can be used as context for fixing the hooks (e.g., "read hook-results.md and fix the failing hooks in <dungeon-file>").

The query log can be studied later with grep:
```bash
grep "^VERDICT:" research/hook-query-log.txt           # all verdicts
grep -B4 "^VERDICT: FAIL" research/hook-query-log.txt  # failing hooks with context
grep "^DUNGEON:" research/hook-query-log.txt            # list of dungeons queried
```
