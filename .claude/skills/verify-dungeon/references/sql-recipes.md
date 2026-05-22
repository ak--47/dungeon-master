# DuckDB SQL Recipes for Verification

Use DuckDB only for schema integrity, identity-model invariants, experiment invariants, and bespoke patterns the emulator can't express. For funnel / frequency / aggregate / TTC / attribution patterns, use `emulateBreakdown` instead — see [counting-semantics.md](counting-semantics.md).

## Schema validation queries

For each unique event type in the output, compare actual columns against the config-declared properties:

```sql
WITH event_data AS (
  SELECT * FROM read_json_auto('./data/<run-name>-EVENTS.json', sample_size=-1)
  WHERE event = '<EVENT_TYPE>'
)
SELECT
  unnest(map_keys(columns(*))) as col_name,
  COUNT(*) as total_events,
  COUNT(col_name) FILTER (WHERE col_name IS NOT NULL) as non_null_count,
  ROUND(COUNT(col_name) FILTER (WHERE col_name IS NOT NULL) * 100.0 / COUNT(*), 1) as coverage_pct
FROM event_data
GROUP BY col_name
ORDER BY coverage_pct DESC;
```

Or use the programmatic API (`lib/verify/schema-validator.js`):

```javascript
import { deriveExpectedSchema, validateSchema } from './lib/verify/index.js';
// deriveExpectedSchema(config) → Map<eventName, Set<propKey>>
// validateSchema(events, config) → { pass, eventTypes, summary, flagStamping }
```

### Expected schema sources

The expected set of columns per event type is derived from config:

| Source | Keys | Condition |
|--------|------|-----------|
| Core | `event`, `time`, `insert_id`, `user_id` | Always |
| Identity | `device_id` | `identity.avgDevicePerUser > 0` |
| Identity | `session_id` | `switches.hasSessionIds` |
| Event config | `events[i].properties` keys | Per event type |
| Super props | `superProps` keys | All event types |
| Location | `city`, `region`, `country`, `country_code` | `switches.hasLocation` |
| Browser | `browser` | `switches.hasBrowser` |
| Device | `model`, `screen_height`, `screen_width`, `os`, `carrier`, `radio` | `switches.hasAndroidDevices`/`hasIOSDevices`/`hasDesktopDevices`. **`Platform` removed in 1.5.1** — `os` covers the signal. Hooks/dungeons may opt back in by declaring `Platform` in event `properties`. |
| Campaigns | `utm_source`, `utm_campaign`, `utm_medium`, `utm_content`, `utm_term` | `switches.hasCampaigns` |
| Group keys | group key name | Per event type from `groupKeys[i][2]`, or all if empty |
| Funnel props | `funnel.props` keys | Events in funnel sequence |
| Experiment | `Experiment name`, `Variant name` | `$experiment_started` event |
| World events | `worldEvent.injectProps` keys | Events matching `affectsEvents` |

### Schema verdicts

For each event type, classify any column present in output but NOT in expected schema:

- **SCHEMA-PASS** — Column appears on 100% of events of this type. Uniform enrichment is acceptable.
- **SCHEMA-FAIL** — Column appears on <100% of events of this type. This is flag stamping — hook conditionally adds a property, creating an inconsistent schema.

If any event type has SCHEMA-FAIL, flag it prominently and include specific remediation: which hook line adds the property and how to remove it while preserving the intended pattern.

## Standard identity-model invariants

Run these for every dungeon that uses the identity model (`isAuthEvent` + `attempts` + `identity.avgDevicePerUser`), BEFORE per-pattern checks:

```sql
-- Stitch event count must match converted-born count, exactly one per user.
WITH e AS (SELECT * FROM read_json_auto('./data/<file>-EVENTS.json')),
     auth_event AS (SELECT 'Sign Up' AS name) -- name of your isAuthEvent
SELECT
  COUNT(*) AS auth_events_total,
  SUM(CASE WHEN user_id IS NOT NULL AND device_id IS NOT NULL THEN 1 ELSE 0 END) AS stitches,
  COUNT(DISTINCT CASE WHEN user_id IS NOT NULL THEN user_id END) AS converted_users
FROM e WHERE event = (SELECT name FROM auth_event);

-- Pre-existing users must have user_id on every event (no anon-only records).
WITH e AS (SELECT * FROM read_json_auto('./data/<file>-EVENTS.json')),
     u AS (SELECT * FROM read_json_auto('./data/<file>-USERS.json'))
SELECT COUNT(*) AS preexisting_anon_only_records
FROM e JOIN u ON u.distinct_id::VARCHAR = e.user_id::VARCHAR
WHERE u.created < (SELECT MIN(time::TIMESTAMP) FROM e)
  AND e.user_id IS NULL;
```

Failures usually indicate incomplete identity-model migration. Flag in report.

## Experiment invariants

Run when dungeon uses `experiment:` on any funnel:

```sql
-- Variant distribution should be roughly even (within ±10% of expected share)
SELECT "Variant name", COUNT(*) AS exposure_count,
  COUNT(DISTINCT user_id) AS unique_users
FROM read_json_auto('./data/<file>-EVENTS.json')
WHERE event = '$experiment_started'
GROUP BY "Variant name"
ORDER BY exposure_count DESC;

-- $experiment_started should only appear after experiment start date
SELECT MIN(time) AS earliest_exposure, MAX(time) AS latest_exposure
FROM read_json_auto('./data/<file>-EVENTS.json')
WHERE event = '$experiment_started';

-- Same user should always be in the same variant (deterministic assignment)
SELECT user_id, COUNT(DISTINCT "Variant name") AS variant_count
FROM read_json_auto('./data/<file>-EVENTS.json')
WHERE event = '$experiment_started' AND user_id IS NOT NULL
GROUP BY user_id
HAVING variant_count > 1;
-- Expected: 0 rows (no user in multiple variants)
```

## DuckDB notes

- Output is **JSONL** (newline-delimited JSON) — `read_json_auto()` handles this natively
- **Properties are FLAT on event records** — use `event.amount`, NOT `event.properties.amount`
- **Time field** is an ISO string — use `CAST(time AS TIMESTAMP)` or `time::TIMESTAMP`
- Use `COALESCE(column, default)` for properties that only exist on some events (spliced events may lack some fields)
- Use `TRY_CAST()` instead of `CAST()` for columns with mixed types
- For large queries, use `LIMIT` to keep output manageable
- Escape single quotes in bash: use `$'...'` syntax or double-quote the SQL and escape internal quotes

## DuckDB pitfalls

### Bot/Anomaly user_id breaks UUID type inference

When a dungeon uses `dataQuality.botUsers > 0` or `anomalies` features, some events have `user_id` like `"bot_db9a7a37"` or `"anomaly_f148a044"` instead of UUIDs. DuckDB auto-inference reads first chunk as UUID, then fails on string IDs:

```
Conversion Error: Could not convert string 'bot_db9a7a37' to INT128
```

**Fix:** every query against EVENTS must use `sample_size=-1` to scan all rows for typing AND filter out synthetic IDs:

```sql
SELECT ... FROM read_json_auto('./data/verify-X-EVENTS.json', sample_size=-1)
WHERE user_id NOT LIKE 'bot_%' AND user_id NOT LIKE 'anomaly_%'
```

For joins on USERS where the join key is UUID, cast both sides to VARCHAR:
```sql
JOIN read_json_auto('./data/verify-X-USERS.json') u
  ON u.distinct_id::VARCHAR = e.user_id::VARCHAR
```

### Multi-part EVENTS files (batch mode)

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

### DuckDB reserved words

DuckDB reserves common identifiers including `on`, `at`, `from`, `to`, `order`, `group`. If you name a CTE column `on` (e.g. "order count"), the parser fails:

```
Parser Error: syntax error at or near "on"
```

Use suffixed names: `order_n`, `txn_n`, `swap_n`. Same applies to `at` / `to` etc.

### Schema mismatch between JSDoc and actual data

Stale JSDocs sometimes reference field names that don't exist in the actual data. When a query returns 0 rows or NULL where you expected data, run `DESCRIBE SELECT * FROM read_json_auto(...)` to inspect actual columns and adjust the query. If the doc is wrong (not the hook), note this in results.md as a doc nit.

### Nested properties

Some events store data in struct/array columns (e.g. ecommerce checkout has `cart STRUCT(...)[]`). The flat columns `amount`/`total_value` will be NULL — actual data is inside the array. Use `UNNEST(cart)` or `cart[1].total_value` to access.

## How hooks work (critical for query design)

Hooks do NOT add new properties to the schema. They modify existing property values, filter/remove events, and inject events cloned from existing ones. This means you often CANNOT verify a hook by checking for a boolean flag's existence. Instead, verify by:

1. **Comparing value magnitudes** across segments — e.g., power users should have ~3x higher avg purchase amount
2. **Comparing value distributions in time windows** — e.g., avg amount on 1st/15th of month vs other days
3. **Deriving behavioral segments from the data itself** — e.g., sessionize the event stream, count sessions, compare users with >20 sessions vs fewer
4. **Checking event density patterns** — e.g., cloned/injected events create unusually dense clusters within short time windows
5. **Cross-table joins** — e.g., join user profiles with events to see if user-level properties correlate with event-level value differences

Some hooks DO define boolean properties in the config with defaults (e.g., `payday: [false]`) that the hook sets to `true`. For those, you CAN query `WHERE payday = true`. But always check the dungeon's event config to see what properties are defined — don't assume a hook-created flag exists just because the documentation mentions a pattern.

## Query design approach

For each hook, design a query that compares:
- **Affected group** (users/events where the hook should have had an effect)
- **Control group** (users/events where the hook should NOT have had an effect)
- **Metric** (the specific measure that should differ between groups)

Then compute a **ratio** or **difference** and compare it to the expected effect size.

## Query templates by hook archetype

### Segment Comparison (e.g., "premium users have higher engagement")
```sql
SELECT
  segment_property,
  COUNT(*) as event_count,
  AVG(metric) as avg_metric,
  COUNT(DISTINCT user_id) as unique_users
FROM read_json_auto('./data/verify-dungeon-EVENTS.json')
WHERE event = 'relevant_event'
GROUP BY segment_property
ORDER BY segment_property;
```

### Time-Based Anomaly (e.g., "cursed week has higher death rate")
```sql
WITH events AS (
  SELECT *, time::TIMESTAMP as ts
  FROM read_json_auto('./data/verify-dungeon-EVENTS.json')
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

### Retention / Churn (e.g., "early guild joiners retain better")
```sql
WITH user_first_event AS (
  SELECT user_id, MIN(time::TIMESTAMP) as first_seen
  FROM read_json_auto('./data/verify-dungeon-EVENTS.json')
  GROUP BY user_id
),
user_segments AS (
  SELECT
    e.user_id,
    BOOL_OR(e.event = 'guild joined'
      AND (e.time::TIMESTAMP - f.first_seen) < INTERVAL '3 days') as early_joiner
  FROM read_json_auto('./data/verify-dungeon-EVENTS.json') e
  JOIN user_first_event f ON e.user_id = f.user_id
  GROUP BY e.user_id
),
user_activity AS (
  SELECT
    e.user_id,
    MAX(e.time::TIMESTAMP) - MIN(e.time::TIMESTAMP) as active_span
  FROM read_json_auto('./data/verify-dungeon-EVENTS.json') e
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

### Revenue / LTV (e.g., "lucky charm buyers spend 5x more")
```sql
WITH buyer_segments AS (
  SELECT
    user_id,
    BOOL_OR(event = 'real money purchase' AND product = 'Lucky Charm Pack') as is_target_buyer
  FROM read_json_auto('./data/verify-dungeon-EVENTS.json')
  GROUP BY user_id
)
SELECT
  b.is_target_buyer,
  COUNT(*) FILTER (WHERE e.event = 'real money purchase') as purchase_count,
  ROUND(AVG(TRY_CAST(e.price_usd AS DOUBLE)), 2) as avg_purchase,
  ROUND(SUM(TRY_CAST(e.price_usd AS DOUBLE)), 2) as total_revenue,
  COUNT(DISTINCT b.user_id) as users
FROM buyer_segments b
JOIN read_json_auto('./data/verify-dungeon-EVENTS.json') e ON b.user_id = e.user_id
GROUP BY b.is_target_buyer;
```

### Funnel Conversion by Segment (when emulator can't do it)
```sql
WITH step1 AS (
  SELECT DISTINCT user_id, segment_prop
  FROM read_json_auto('./data/verify-dungeon-EVENTS.json')
  WHERE event = 'funnel_step_1'
),
step2 AS (
  SELECT DISTINCT user_id
  FROM read_json_auto('./data/verify-dungeon-EVENTS.json')
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

For Mixpanel-accurate funnel verification, prefer `emulateBreakdown({type: 'funnelFrequency'})` — see [counting-semantics.md](counting-semantics.md).

### Property Distribution Shift
```sql
SELECT
  segment_column,
  property_column,
  COUNT(*) as cnt,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (PARTITION BY segment_column), 2) as pct
FROM read_json_auto('./data/verify-dungeon-EVENTS.json')
WHERE event = 'relevant_event'
GROUP BY segment_column, property_column
ORDER BY segment_column, cnt DESC;
```

### Event Existence After Date
```sql
SELECT
  CASE WHEN time::TIMESTAMP < 'release_date' THEN 'before' ELSE 'after' END as period,
  COUNT(*) as occurrences
FROM read_json_auto('./data/verify-dungeon-EVENTS.json')
WHERE event = 'find treasure' AND treasure_type = 'Shadowmourne Legendary'
GROUP BY period;
```

### Value Magnitude by Behavioral Segment (sessionize derived cohorts)
```sql
WITH ordered AS (
  SELECT *, time::TIMESTAMP as ts,
    LAG(time::TIMESTAMP) OVER (PARTITION BY user_id ORDER BY time) as prev_ts
  FROM read_json_auto('./data/verify-dungeon-EVENTS.json')
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
JOIN read_json_auto('./data/verify-dungeon-EVENTS.json') e ON seg.user_id = e.user_id
WHERE e.event = 'purchase'
GROUP BY seg.segment;
```

### Temporal Value Scaling (e.g., 3x amounts on 1st/15th)
```sql
SELECT
  CASE WHEN EXTRACT(DAY FROM time::TIMESTAMP) IN (1, 15) THEN 'payday' ELSE 'normal_day' END as period,
  COUNT(*) as event_count,
  ROUND(AVG(TRY_CAST(amount AS DOUBLE)), 2) as avg_amount,
  ROUND(MEDIAN(TRY_CAST(amount AS DOUBLE)), 2) as median_amount
FROM read_json_auto('./data/verify-dungeon-EVENTS.json')
WHERE event = 'transaction completed'
GROUP BY period;
```

### Injected Event Detection (cloned events create density anomalies)
```sql
WITH events AS (
  SELECT *, time::TIMESTAMP as ts,
    LAG(time::TIMESTAMP) OVER (PARTITION BY user_id, event ORDER BY time) as prev_same_event
  FROM read_json_auto('./data/verify-dungeon-EVENTS.json')
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

### Cross-Table Correlation (everything hook reads meta.profile)
```sql
WITH users AS (
  SELECT * FROM read_json_auto('./data/verify-dungeon-USERS.json')
),
events AS (
  SELECT * FROM read_json_auto('./data/verify-dungeon-EVENTS.json')
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

When verifying `everything` hooks, you often MUST join events with user profiles. Join key is **`events.user_id = users.distinct_id`**.

## Output files by data type

- `verify-dungeon-EVENTS.json` — events (most hooks produce effects here)
- `verify-dungeon-USERS.json` — user profiles (check for `user` hook enrichment)
- `verify-dungeon-*-GROUPS.json` — group profiles (if groups configured)
- `verify-dungeon-*-SCD.json` — SCD data (if SCDs configured)

## Advanced feature verification

Supported advanced features (still active in 1.5.x): `personas`,
`worldEvents`, `engagementDecay`, `dataQuality`. When verifying:

```sql
-- Personas: check distribution matches configured weights
SELECT _persona, count(*) as users FROM read_json_auto('./data/verify-dungeon-USERS.json') WHERE _persona IS NOT NULL GROUP BY 1;

-- World Events: check injected properties exist during event windows
SELECT promo, count(*) FROM read_json_auto('./data/verify-dungeon-EVENTS.json') WHERE promo IS NOT NULL GROUP BY 1;

-- Data Quality: verify bots, nulls, empty events
SELECT 'bots' as metric, count(*) FROM read_json_auto('./data/verify-dungeon-USERS.json') WHERE is_bot = true
UNION ALL SELECT 'null_props', count(*) FROM read_json_auto('./data/verify-dungeon-EVENTS.json') WHERE category IS NULL;
```

Advanced feature patterns should ALWAYS be present (deterministic from config), unlike hooks which may have statistical variance.

**Deprecated config blocks (silently stripped by validator since 1.4):**
`subscription`, `attribution`, `geo`, `features`, `anomalies`. If a
dungeon still references these, properties they used to generate
(`subscription_plan`, `_region`, `theme`, `_anomaly`, etc.) will be
missing from the output. Migration: add equivalents to `superProps` /
`userProps` and drive downstream effects in `user` or `everything` hooks.

## Standard verification checks (run for every dungeon)

### 0. Anonymous non-converter `_drop` audit (v1.5.1, identity-model dungeons)

Born-in-dataset users who never reach an `isAuthEvent` get `_drop: true`
stamped on their profile. Real Mixpanel `/engage` skips these — the
verifier's profile-count assertions should mirror that. Quick check:

```sql
SELECT
  COUNT(*) AS total_profiles,
  SUM(CASE WHEN _drop = true THEN 1 ELSE 0 END) AS dropped,
  SUM(CASE WHEN _drop IS NULL OR _drop = false THEN 1 ELSE 0 END) AS would_push
FROM read_json_auto('./data/verify-dungeon-USERS.json');
```

`would_push` should equal `result.profilesPushed` from the run output.
For pre-existing-only dungeons (`percentUsersBornInDataset: 0`) expect
`dropped = 0`.

### 1. SuperProp Consistency
Verify each user has exactly 1 value per superProp:

```sql
SELECT
  'PROP_NAME' as prop,
  COUNT(*) as total_users,
  COUNT(*) FILTER (WHERE n = 1) as consistent,
  COUNT(*) FILTER (WHERE n > 1) as inconsistent,
  ROUND(COUNT(*) FILTER (WHERE n = 1) * 100.0 / COUNT(*), 1) as consistency_pct
FROM (
  SELECT user_id, COUNT(DISTINCT PROP_NAME) as n
  FROM read_json_auto('./data/verify-dungeon-EVENTS.json')
  GROUP BY user_id
);
```
Verdict: **STRONG** ≥99% consistent, **WEAK** 90-99%, **FAIL** <90%.

### 2. SuperProp-UserProp Mirror Check
Every superProp key should also appear on user profiles. Compare the dungeon's `superProps` keys against columns in the USERS file. Any superProp not mirrored in `userProps` means the stamping fix is incomplete.

### 3. Mixpanel Default Property Casing Check
The system generates device properties with Mixpanel's standard casing
(`os`, `model`, `screen_height`, `screen_width`, `carrier`, `radio`,
`browser`) and location properties (`city`, `region`, `country`,
`country_code`). If a dungeon defines a superProp with conflicting casing
(e.g., capitalized `City` vs system `city`), both properties appear on
events — confusing in Mixpanel. Check for:
- `City`, `Region`, `Country` (caps) vs system `city`, `region`, `country` — verdict **FAIL** if dungeon uses caps for these
- `Browser` (caps) vs system `browser` — verdict **FAIL** if mismatched

**Note:** `Platform` was REMOVED from default device props in 1.5.1.
If a dungeon explicitly declares `Platform` in event `properties`, that's
intentional opt-in — not a casing conflict.

### 4. funnel-pre Dilution Check
For any dungeon with `funnel-pre` conversionRate modifications, verify the actual visible effect:
- A `conversionRate *= 1.5` in funnel-pre typically shows as ~1.02-1.08x in the data (diluted by organic events)
- If observed ratio is <1.1x for a funnel-pre conversionRate hook, verdict is **FAIL** with note: "funnel-pre conversionRate diluted by organic events — migrate to `everything` hook event filtering"
- When the dungeon uses `everything` hook filtering instead, expect the full intended ratio (1.3-1.5x)

## Population threshold validation

When a hook targets a specific segment, verify the affected population is large enough to produce a visible signal:

```sql
SELECT
  segment_column,
  COUNT(DISTINCT user_id) as users,
  ROUND(COUNT(DISTINCT user_id) * 100.0 / (SELECT COUNT(DISTINCT user_id) FROM read_json_auto('./data/verify-dungeon-EVENTS.json')), 1) as pct_of_users
FROM read_json_auto('./data/verify-dungeon-EVENTS.json')
WHERE event = 'relevant_event'
GROUP BY segment_column
ORDER BY users DESC;
```

**Thresholds (at 1K users):**
- Segment <20 users (<2%): hook signal will be WEAK or invisible — flag as "insufficient population"
- Segment 20-50 users: may show signal but with high variance — note in report
- Segment >50 users: should show clear signal if hook effect ≥1.3x

## Statistical caveats

This skill always runs at full fidelity (the dungeon's own scale). At full fidelity, cohorts of all sizes should produce clear signal because the absolute population is large. WEAK or FAIL results at full fidelity indicate a real problem — investigate, do not retry at smaller scale.

`--small` mode is a developer-troubleshooting escape hatch on the runner script; verdicts from `--small` runs are unreliable and not permitted in this skill's output.

## Verifying no-flag cohort patterns

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
- `sweet` bucket avg target ≥1.2x `low` bucket → boost present (STRONG)
- `over` bucket target_per_user ≤0.7x `sweet` bucket → drop present (STRONG)
- Both visible → inverted-U STRONG
- Either missing → flag as WEAK or FAIL with note about cohort sizes

**Inverted-U cohort confound — use NORMALIZED metric for the drop side.** The "over" bucket users have higher activity by definition (they crossed the threshold). So per-user metrics for downstream events naturally INCREASE with bucket — masking any drop hook. Example:

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
- Fast segment ≤0.85x baseline → STRONG
- Slow segment ≥1.2x baseline → STRONG
- Both directions visible → STRONG
- One/both missing → check that funnel exists in `funnels:` config and segment property is on `meta.profile`

**Two-tier T2C interpretation**: When a dungeon has only 2 tiers (e.g. Free vs Paid) the funnel-post hook factor `1.0` branch never fires — both tiers fall into either fast or slow. Pick the slower of the two as the implicit baseline, then verify the faster shows ≤0.85x of it.

**No-flag verification rule**: NEVER attempt to verify a hook by querying for a flag like `WHERE sweet_spot = true`. If a dungeon has such flags, treat them as a doc bug — the hook should be reworked to hide the cohort behaviorally. The validator's job is to derive cohorts behaviorally.

## Drop-event funnel dilution diagnosis

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

Expected: paid tier ~1.5x non-paid per_user (matches 30% drop on non-paid → paid keeps 100%, non-paid keeps 70%, ratio 1/0.7 = 1.43x).

If funnel completion gap <5pt but per_user gap ≥30%, the hook IS firing — the doc just points to the wrong metric. Mark STRONG, recommend doc redirect to per-user query.

## Subscription tier cohort sizing check

Before testing any hook gated on `subscription_tier === "annual"` or `"family"`, check cohort sizes:

```sql
SELECT subscription_plan, COUNT(*) FROM read_json_auto('./data/<run>-USERS.json')
GROUP BY subscription_plan;
```

The default subscription lifecycle (`trialToPayRate=0.30`, `upgradeRate=0.06-0.08`) produces ~85% NULL/Free, ~10-15% Monthly, <2% Annual, ~0% Family at 5K users. Cohorts <50 users will not produce statistically clean signal at any effect size.

**If annual cohort <50 users:**
- Don't trust per-tier ratios — note "cohort too small" in results.md
- Bump `numUsers` up to 5x to enlarge cohorts
- Or recommend dungeon author tighten subscription lifecycle config

## Per-day normalization for time-window hooks

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

## Determinism check (optional confidence test)

The pinned `datasetStart`/`datasetEnd` window plus seeded RNG produces near-bit-exact output across runs. To confirm no NEW non-determinism crept in (e.g. wall-clock leak in a hook):

1. Run a previously-passing dungeon a second time.
2. Compare `eventCount` in the runner's JSON output — should match within ~0.5%.
3. Re-run the hook's headline query and verify ratios match to 2 decimals.

**Tolerance note**: most vertical dungeons produce bit-exact event counts across runs, but a few show <0.5% variance from RNG-state interactions. Variance at this scale does NOT affect hook signal direction or magnitude — all signals remain stable across runs. Treat <1% event-count drift as acceptable; investigate only if drift exceeds 1% OR a hook ratio swings meaningfully (>10% relative change between runs).

If event count differs by >1% OR a hook ratio swings sharply, the hook has a fresh non-determinism source (typically `dayjs()`, `Date.now()`, `Math.random()`, or stale module-level state). Fix before continuing.

## Critical time-window verification pattern

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

## TTC hook verification — two approaches

TTC hooks come in two forms. Use the matching verification approach:

### Approach 1: Property-Scaling TTC (preferred — produces NAILED verdicts)

The hook scales a timing PROPERTY (e.g., `response_time_mins *= 0.67`) by segment. Verification is trivial:

```sql
SELECT segment,
  ROUND(AVG(response_time_mins), 1) AS avg_response,
  ROUND(AVG(resolution_time_mins), 1) AS avg_resolution
FROM events
WHERE event IN ('alert acknowledged', 'alert resolved')
GROUP BY segment ORDER BY avg_response;
```

This consistently produces exact matches to the hook factors (e.g., 0.67x target → 0.665x measured).

### Approach 2: Timestamp-Shifting TTC (use when no timing property exists)

The hook shifts event timestamps in the everything hook using `scaleFunnelTTC()` or manual gap scaling. Verification requires a **bound-sequence query** — never use the lazy MIN→MIN proxy:

```sql
-- WRONG: lazy MIN→MIN proxy (mixes events from different funnel passes)
SELECT user_id, MIN(a.time) AS start, MIN(b.time) AS end ...

-- RIGHT: bound-sequence (first A, then first B AFTER that A)
WITH steps AS (
  SELECT user_id, event, time::TIMESTAMP AS t
  FROM events WHERE event IN ('step_a', 'step_b', 'step_c')
),
funnel AS (
  SELECT DISTINCT ON (a.user_id) a.user_id, a.t AS start_t,
    (SELECT MIN(t) FROM steps c
     WHERE c.user_id = a.user_id AND c.event = 'step_c' AND c.t > a.t) AS end_t
  FROM steps a WHERE a.event = 'step_a'
  ORDER BY a.user_id, a.t
)
SELECT segment,
  COUNT(*) AS users,
  ROUND(MEDIAN(EXTRACT(EPOCH FROM (end_t - start_t)) / 60), 1) AS median_min
FROM funnel JOIN users USING (user_id)
WHERE end_t IS NOT NULL
GROUP BY segment ORDER BY median_min;
```

The bound-sequence pattern finds the first A per user, then the first C strictly after that A. This matches how the everything hook operates and typically produces STRONG verdicts. The lazy MIN→MIN proxy produces flat or inverted results because it grabs unrelated events from different funnel passes.

### Which approach to recommend when writing hooks

Property scaling is strictly better for verification. When creating new TTC hooks, always prefer scaling timing properties (see HOOKS.md principle #15). Reserve timestamp shifting for cases where no numeric timing property exists on the relevant events.

### Legacy funnel-post TTC hooks

If a dungeon still uses `funnel-post` for TTC (not yet migrated to `everything`), the effect is only visible in Mixpanel's funnel median TTC report, not in any SQL query. Mark as STRONG by code inspection and recommend migration to property scaling or everything-hook timestamp shifting.

## Magic-number cohort sizing — inspect distribution first

Before checking inverted-U signal magnitude, confirm the cohort sizes are statistically meaningful (≥200 in sweet bucket). If cohort is too small, signal magnitude is irrelevant:

```sql
SELECT pn, COUNT(*) FROM (
  SELECT user_id, COUNT(*) FILTER (WHERE event = '<X_EVENT>') AS pn
  FROM events GROUP BY user_id
) GROUP BY pn ORDER BY pn LIMIT 20;
```

If 90%+ of users have 0-1 events of X, the dungeon's `sweet=4-7 / over=8+` ranges produce <50 users in sweet → no signal possible. Two fixes:
1. Bump `numUsers` 5x (cohort grows linearly with users; preserves story)
2. Recommend the dungeon author redefine ranges to match actual distribution (e.g. `sweet=2-5 / over=6+`)

Choice depends on whether the JSDoc's stated ranges are load-bearing for the dungeon's narrative ("you need 8+ photos to seem fake" — preserve range, scale up users) or arbitrary ("sweet 4-7" can shift to "sweet 2-5" without losing the story).

## Re-run required after hook edits

If you edit a hook then query the existing data files, you'll get STALE results. The verifier must re-run the dungeon AND wait for full completion before re-querying:

```bash
rm -f ./data/verify-<NAME>-*
node scripts/verify-runner.mjs dungeons/vertical/<NAME>.js verify-<NAME>
# Wait for the {"mode":"full","eventCount":...} JSON to print before querying
```

For batched output (multi-million events), the runner writes `verify-<NAME>-EVENTS-part-*.json` instead of a single `verify-<NAME>-EVENTS.json`. Use glob in queries:

```sql
read_json_auto('./data/verify-<NAME>-EVENTS-part-*.json', sample_size=-1, union_by_name=true)
```

Without the glob, queries against `verify-<NAME>-EVENTS.json` fail with "No files found".

## Event hook meta.datasetStart pitfall

The `event` hook receives `meta.datasetStart` as a unix timestamp, but temporal hooks checking `dayInDataset >= N` often produce NONE verdicts because the anchor doesn't match expectations. Proven fix: move temporal windowing to the `everything` hook where `meta.datasetStart` is verified reliable. The `everything` hook also allows push() for event cloning instead of return (which replaces the event in the `event` hook).

**When to move temporal hooks to `everything`:**
- Any hook that checks `dayInDataset` ranges and scores NONE at verification
- Any hook that needs to CLONE events (push to array) rather than REPLACE
- Any hook that needs access to the user's full event history for context

**When to keep hooks in `event` type:**
- Closure-based state patterns (module-level Maps) that track across users
- Event REPLACEMENT (returning a different event, e.g., alert → incident)
- Simple property mutations that don't need temporal context

## Property baseline dilution

When a hook overrides a property value (e.g., `event_type = "plan_upgraded"`), the effect is invisible if the baseline distribution already has a high rate of that value. Example: if `plan_upgraded` is 1 of 5 values (20% baseline), a 40% hook override produces ~28% observed — nearly invisible.

**Fix:** skew the baseline distribution AWAY from the hook's target value. Make `plan_upgraded` 1 of 8+ values (12.5% baseline), then the 40% hook produces ~48% in the window — a clear 4x spike.

Similarly, if a hook forces `scale_direction = "down"` but the baseline is already 86% "down" (6:1 ratio in config), the hook is invisible. Change the baseline to favor "up" (e.g., 3:1 up:down) so the hook's forced "down" creates a measurable shift.

## Computing the dataset window

Dungeons declare their time window in one of three ways — the verifier must derive the actual start/end before writing DuckDB queries:

| Config shape | How to derive window |
|---|---|
| `datasetStart` + `datasetEnd` | Use directly |
| `numDays` only (no explicit start/end) | `datasetEnd = NOW`, `datasetStart = NOW - numDays` |
| `datasetStart` + `numDays` | `datasetEnd = datasetStart + numDays` |

The engine always resolves to a `[datasetStart, datasetEnd]` pair internally (see `config-validator.js`). To find the actual window from the OUTPUT data:

```sql
SELECT
  MAX(time::TIMESTAMP) as datasetEnd,
  MAX(time::TIMESTAMP) - INTERVAL '<numDays>' DAY as datasetStart
FROM read_json_auto('./data/verify-X-EVENTS*.json', sample_size=-1);
```

Use `datasetStart` (derived above) as the DuckDB anchor for day-in-dataset:

```sql
WITH bounds AS (
  SELECT MAX(time::TIMESTAMP) - INTERVAL '<numDays>' DAY as ds_start
  FROM read_json_auto('./data/verify-X-EVENTS*.json', sample_size=-1)
)
SELECT EXTRACT(EPOCH FROM (e.time::TIMESTAMP - b.ds_start)) / 86400 as day_in
FROM events e, bounds b;
```

Do NOT use `MIN(time)` as the anchor — pre-existing users have events up to 30 days before `datasetStart` (from `preExistingSpread: 'uniform'`).

When the dungeon has explicit `datasetStart` (e.g., `"2026-01-01T00:00:00Z"`), use it directly: `TIMESTAMP '2026-01-01'`. When `numDays` is used without explicit start, derive from MAX(time) as shown above.

## No flag stamping audit

Hooks must NEVER add cohort flags like `is_whale`, `power_user`, `sweet_spot`, `is_churned`, etc. All cohorts must be derived behaviorally from raw event data. When auditing a dungeon, check the hook for any property assignments that create boolean/categorical flags not defined in the original schema. If found, remove them and rewrite the hook to achieve the same effect through property value mutations, event filtering, or event injection.

## Clone dilution of temporal effects

When a dungeon has BOTH temporal value mutations (e.g., "days 30-60 offer_price 2.5x") AND event cloning hooks (e.g., "pre-approved users get 5 extra offers"), cloned events with time offsets can land inside the temporal window without receiving the mutation — because the temporal hook ran BEFORE the cloning.

**Diagnosis:** The temporal effect shows a lower ratio than expected (e.g., 1.2x instead of 2.5x). Check if other hooks clone events that could land in the temporal window.

**Fix:** Move the temporal value mutation to the END of the everything hook, after all cloning/injection hooks. Re-run and verify.

## Cohort detection survives filtering

If Hook A classifies users by event presence (`events.some(e => e.event === X)`) and Hook B later removes events (churn, retention filter), the verification query may misclassify users whose marker events were filtered. The "non-cohort" group gets contaminated with cohort members, diluting the measured ratio.

**Diagnosis:** Expected ratio is 8x but observed is <2x. Check if the cohort detection event is also affected by a downstream filter.

**Fixes:**
1. Require 3+ marker events instead of 1+ (surviving events still identify)
2. Accept the verification limitation and note it in the report
3. Use a metric that doesn't depend on cohort reconstruction (e.g., overall distribution shift instead of cohort comparison)

## Deprecated feature property gaps

Dungeons using deprecated config blocks (`subscription`, `attribution`, `features`, `geo`, `anomalies`) may have hooks that depend on properties those blocks used to generate. The engine silently strips deprecated configs, so properties like `coaching_mode`, `subscription_plan`, or `feature_tier` never appear in the data.

**Diagnosis:** Hook logic references a property that's always NULL/undefined in the output. Check if the property was produced by a deprecated feature.

**Fix:** The dungeon author must add equivalent property generation in the hook itself (via `user` or `everything` hook) or add the property to `superProps`/`userProps` with appropriate values. This is a schema-level fix, not a verification fix — flag it in the report as "NONE: deprecated feature property missing" with the recommended fix.
