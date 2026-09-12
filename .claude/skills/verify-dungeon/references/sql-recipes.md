# DuckDB SQL Recipes for Verification

Use DuckDB only for schema integrity, identity-model invariants, experiment invariants, and bespoke patterns the emulator can't express. For funnel / frequency / aggregate / TTC / attribution patterns, use `emulateBreakdown` instead — see [counting-semantics.md](counting-semantics.md).

Apply the [1.8.1 verification contract](alignment-contract.md) to every query.
The SQL examples below are diagnostics for their named measures. They cannot
replace a different report's acceptance check. Use explicit report options,
paired baselines, neutral controls, and actual eligible population counts.

## Schema validation queries

For each event type, compare raw record keys against config-declared properties
and enabled engine/SDK fields. SQL unioned columns lose per-record key presence;
null coverage alone cannot distinguish an absent key from a declared null.
Use the programmatic API (`lib/verify/schema-validator.js`) to derive expected
keys, then explicitly fail any undeclared key in the raw records:

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

- **SCHEMA-PASS** - every observed key is declared or a recognized enabled engine/SDK field.
- **SCHEMA-FAIL** - any undeclared key, even at 100% coverage. Uniform enrichment does not bypass schema-first authorship.

The runtime summary may permit uniform enrichment. Retain its output, but apply
the stricter authorship gate separately. Declared nullable fields remain valid.

If any event type has SCHEMA-FAIL, flag it prominently and include specific remediation: which hook line adds the property and how to remove it while preserving the intended pattern.

## Standard identity-model invariants

### Metric artifacts use separate schemas

The expected-schema table above applies only to user EVENTS. For `standaloneEvents`,
expect `event`, `time`, `insert_id`, `distinct_id`, plus the matching spec's
dimension and property keys. User superProps, session ids, and SDK flags do not
apply. Check undeclared columns explicitly; the story CLI's user schema pass
does not cover standalone shards.

Use a `duckdb` story assertion with this source, filtering the declared event:

```sql
SELECT event, count(*) AS records, min(time::TIMESTAMP) AS first_tick,
       max(time::TIMESTAMP) AS last_tick
FROM read_json_auto('{{PREFIX}}-STANDALONE*.json',
  union_by_name=true, sample_size=-1)
GROUP BY event;
```

Compare the count with cadence ticks times the dimension cross-product size.
Check duplicate `(event, time, <dimension keys>)` tuples and undeclared keys,
and assert that `user_id` and `device_id` are absent. Synthetic `distinct_id`
values identify series, never people. Do not union these shards into EVENTS
for funnels, retention, stitching, or user counts. Substitute `{{PREFIX}}`
with the exact artifact prefix when running SQL outside the story CLI.

For `warehouseMetrics`, use the matching `-WAREHOUSE-MANIFEST.json` to resolve
each table file and schema. Read JSONL with `read_json_auto` or CSV with
`read_csv_auto` according to that manifest. Check the declared `timeColumn`,
group keys, `valueColumn`, and extra `columns`; no identity fields are required.
Use `warehouse` or `warehouse-stats` assertions for stories. The
automatic warehouse audit runs even without stories. Account for `history`
backfill and `sparse` point-in-time rows before judging counts or time coverage.

### User-event identity checks

Run identity checks whenever the dungeon uses device identity, before per-pattern
checks. Count configured auth rows as a diagnostic, not as a universal one-stitch
invariant; ordinary both-ID events can also establish a link.

```sql
-- Diagnostic counts for a configured auth event, not a mapping proof.
WITH e AS (SELECT * FROM read_json_auto('./data/<file>-EVENTS.json')),
     auth_event AS (SELECT 'Sign Up' AS name) -- name of your isAuthEvent
SELECT
  COUNT(*) AS auth_events_total,
  SUM(CASE WHEN user_id IS NOT NULL AND device_id IS NOT NULL THEN 1 ELSE 0 END) AS stitches,
  COUNT(DISTINCT CASE WHEN user_id IS NOT NULL THEN user_id END) AS converted_users
FROM e WHERE event = (SELECT name FROM auth_event);
```

Build the proof map from valid emitted both-ID events, including later ordinary
Login events, and resolve earlier device-only rows retrospectively. Inspect
conflicting links. Profile pools are not mapping evidence. For pre-existing
stamping, use generator ownership evidence and resolved dataset bounds; joining
on `e.user_id` and then testing it for NULL can never detect missing IDs. If row
ownership is unavailable in retained artifacts, report that check as unproved.

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

### Activity-span diagnostic (not a retention report)

This measures first-to-last activity span. Use `retention` with the report's
cohort, return event, buckets, and mature horizon for a retention claim.
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

### Funnel conversion by segment

Use `emulateBreakdown({type: 'funnelFrequency'})` with explicit report options.
A join between users who did A and users who did B does not check ordered
completion, restart, grace, exclusions, or the conversion window. If the emulator
cannot express the requested report, record the semantic gap instead of substituting
an unordered SQL intersection. See [counting-semantics.md](counting-semantics.md).

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

### Value magnitude by session-derived cohort

Derive sessions with the verifier from the full resolved user stream before
filtering events or partitioning by hold-property value. Use all three split
rules (idle timeout, maximum duration, UTC day change). A timeout-only SQL `LAG`
query and generator-stamped `session_id` do not establish this contract. Export
the resulting user/cohort mapping for a SQL value diagnostic if needed.

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

Check whether the relevant population and time window are present before asserting
an advanced-feature effect. Seeded determinism does not guarantee that a finite
sample contains every configured segment or outcome.

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
For properties declared in `stickyEventProps` or explicitly promised as stable,
check per-user consistency. Other `superProps` may legitimately vary by event:

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
For a strict profile projection contract, investigate every mismatch. Do not
replace the declared contract with a generic percentage tolerance.

### 2. SuperProp-UserProp Mirror Check
Only keys promised as profile projections must mirror `userProps`. Matching
enumerations alone do not guarantee equality; use `stickyEventProps`. Event-only
context such as an app version does not require a profile mirror.

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
- Compare the declared funnel report on paired baseline and treatment streams.
- Inspect organic competitors, repeated opportunities, saturation, and eligible populations.
- Keep the target and report fixed; neither funnel-pre scaling nor everything filtering guarantees a universal ratio.

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

Set population floors before measuring, based on the intended effect and report.
Report actual independent eligible users and converters on both sides. No fixed
user count guarantees a clear signal for every effect or distribution.

## Statistical caveats

This skill uses the dungeon's configured scale for acceptance. Full fidelity does
not guarantee enough eligible users, converters, or mature cohorts. Distinguish
`INSUFFICIENT_EVIDENCE` from measured failure and investigate each accordingly.

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

**Time-to-convert verification:** use the steps-based `timeToConvert` emulator
with explicit report options and completed histories. Independent MIN(A)/MIN(B)
timestamps can mix attempts. Preserve the requested statistic and derive its
target from the hook, with a measured factor-one or hook-disabled control. Two
differently modified segments do not constitute a neutral baseline.

**No-flag verification rule:** derive hidden cohorts behaviorally or with the
declared hash. A flag with a schema-declared default is allowed; an undeclared
flag fails even when present on every record.

## Drop-event funnel dilution diagnosis

Many dungeons have hooks of pattern `record.filter(e => e.event === 'X' && chance.bool({likelihood: 30}))` to drop ~30% of step-3 events for non-paid tier. The doc claims the hook produces a 30% conversion drop in the funnel — but funnel completion rates often barely move (e.g. 95% vs 97%).

**Why:** the hook drops EVENTS not users. A user with 5 step-3 events still appears in the funnel after losing 1-2 events. Funnel completion = `users with ≥1 step-3 event` — only zero-step-3 users disappear from the conversion count, which is rare.

**Supplementary diagnostic:** per-user volume of step-3 events by tier. This
does not replace the declared funnel completion check:

```sql
SELECT u.subscription_tier,
  COUNT(DISTINCT user_id) AS users,
  COUNT(*) AS total_step3,
  ROUND(COUNT(*) * 1.0 / COUNT(DISTINCT user_id), 2) AS per_user
FROM read_json_auto('./data/<run>-EVENTS.json') e
JOIN read_json_auto('./data/<run>-USERS.json') u
  ON e.user_id::VARCHAR = u.distinct_id::VARCHAR
WHERE e.event = '<STEP_3_EVENT>'
GROUP BY u.subscription_tier
ORDER BY per_user DESC;
```

Expected: paid tier ~1.5x non-paid per_user (matches 30% drop on non-paid → paid keeps 100%, non-paid keeps 70%, ratio 1/0.7 = 1.43x).

A volume gap can show the mutation fired while the declared conversion story
still fails. Preserve that failure. Change the report only through an explicit
story revision, then verify the revised claim with its own controls.

## Subscription tier cohort sizing check

Before testing any hook gated on `subscription_tier === "annual"` or `"family"`, check cohort sizes:

```sql
SELECT subscription_plan, COUNT(*) FROM read_json_auto('./data/<run>-USERS.json')
GROUP BY subscription_plan;
```

There is no active subscription lifecycle config block. Read the declared
`userProps` distribution and hook logic, then measure eligible populations.
If evidence is insufficient, request a larger run or an authorized schema change;
do not invent lifecycle defaults or silently relax the acceptance threshold.

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

For seeded generation, pin `datasetStart`/`datasetEnd` and `concurrency: 1`.
Use isolated sequential runs and strip only `insert_id` before comparing events:

1. Run a previously-passing dungeon a second time.
2. Require identical event counts, timestamps, ordering, and seeded property values.
3. Require identical report output under the same explicit options.

Investigate differences, including wall-clock calls, unseeded RNG, and stale
module state. Document known unseeded property functions separately; do not
accept a generic percentage drift as determinism proof.

## Critical time-window verification pattern

Use the resolved dataset bounds, also exposed as `meta.datasetStart` and
`meta.datasetEnd` in unix seconds. Generation occurs inside this window without
a post-generation shift. Observed event extrema do not reconstruct configured
bounds, especially for sparse or partially observed windows:

```sql
WITH bounds AS (
  SELECT TIMESTAMP '<RESOLVED_DATASET_START_UTC>' as datasetStart
)
SELECT *, EXTRACT(EPOCH FROM (e.time::TIMESTAMP - b.datasetStart)) / 86400 as day_in
FROM events e, bounds b;
```

Pre-existing profile creation can precede the window; generated user events still
stay inside the resolved bounds. Never substitute `MAX(time) - numDays` for them.

## TTC hook verification — two approaches

TTC hooks come in two forms. Use the matching verification approach:

### Approach 1: Numeric timing-property report

The hook scales a timing PROPERTY (e.g., `response_time_mins *= 0.67`) by segment. Verification is trivial:

```sql
SELECT segment,
  ROUND(AVG(response_time_mins), 1) AS avg_response,
  ROUND(AVG(resolution_time_mins), 1) AS avg_resolution
FROM events
WHERE event IN ('alert acknowledged', 'alert resolved')
GROUP BY segment ORDER BY avg_response;
```

This proves a property aggregate only. Measure paired baseline/treatment and a
factor-one control; raw segment ratios can reflect different starting distributions.

### Approach 2: Funnel timestamp TTC report

Use steps-based `timeToConvert` on completed histories with the report's window,
order, filters, identity, and reentry options. A first-A/next-C query can skip
required B, miss restarts, or mishandle grace. Compare the same report on baseline,
treatment, and neutral-control streams. Keep mean and median claims separate.

### Which approach to recommend when writing hooks

Choose the hook based on the intended report. Numeric property scaling answers
a property report; timestamp changes target funnel elapsed time. Ease of
verification does not authorize replacing one with the other.

### Legacy funnel-post TTC hooks

Measure legacy `funnel-post` effects with the same report contract and controls.
Never assign STRONG by code inspection. If instance-level mutations fail to move
completed report histories, retain the miss and investigate competing instances.

## Magic-number cohort sizing — inspect distribution first

Before checking inverted-U signal magnitude, count independent eligible users in
each bucket against a predeclared population floor. A floor such as 200 is a
design choice, not universal statistical proof:

```sql
SELECT pn, COUNT(*) FROM (
  SELECT user_id, COUNT(*) FILTER (WHERE event = '<X_EVENT>') AS pn
  FROM events GROUP BY user_id
) GROUP BY pn ORDER BY pn LIMIT 20;
```

If too few users reach the declared buckets, report insufficient evidence.
Request a larger run while preserving the story. Changing bucket ranges changes
the report specification and requires an explicit story revision and new proof.

## Re-run required after hook edits

If you edit a hook then query the existing data files, you'll get STALE results. The verifier must re-run the dungeon AND wait for full completion before re-querying:

```bash
# Keep this run's files for verification and deployment; cleanup needs explicit consent.
node scripts/verify-runner.mjs dungeons/vertical/<NAME>/<NAME>.js verify-<NAME>-r2
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

If an independent hook forces a value on fraction `q` of eligible events with
baseline prevalence `p`, expected prevalence is `q + (1 - q) * p`. For `p=0.20`
and `q=0.40`, that is 0.52. Other targeting and time-window rules need their own
derivation. Measure the neutral baseline; request an authorized schema change if
the baseline distribution must change. Do not tune it silently after a miss.

## Computing the dataset window

Record the engine's resolved `datasetStart`/`datasetEnd` from the run, including
derived windows. Use those values in the query shown under "Critical time-window
verification pattern". If the artifacts do not retain bounds, report the missing
metadata or regenerate a separately named pinned run. Neither observed MIN/MAX
nor the current wall clock can recover the original resolved window reliably.

## No flag stamping audit

Hooks must never add undeclared flags. A schema-declared flag with a default is
valid; hidden cohorts can use behavioral or hash definitions. Flag undeclared
assignments as SCHEMA-FAIL and request an authorized schema declaration or a hook
rewrite using existing fields. Uniform coverage does not make them acceptable.

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
3. Propose a separate distribution diagnostic while retaining the original cohort report's unresolved status; changing the report requires explicit revision.

## Deprecated feature property gaps

Dungeons using deprecated config blocks (`subscription`, `attribution`, `features`, `geo`, `anomalies`) may have hooks that depend on properties those blocks used to generate. The engine silently strips deprecated configs, so properties like `coaching_mode`, `subscription_plan`, or `feature_tier` never appear in the data.

**Diagnosis:** Hook logic references a property that's always NULL/undefined in the output. Check if the property was produced by a deprecated feature.

**Fix:** Request a schema declaration with a default through `/create-dungeon`
before hooks assign values. Report the missing field and preserve the runner's
verdict; adding undeclared property generation inside a hook is not a valid fix.
