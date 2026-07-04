# HOOKS.md -- Hook Encyclopedia

Hook reference and recipe catalog for dungeon-master. Every recipe is calibrated
against Mixpanel's actual counting semantics (greedy single-pass funnels,
distinct-period frequency, null-aware aggregation, capped attribution) — see
[Section 2](#2-how-mixpanel-counts-things) before adapting any pattern.

---

## 1. Quick Reference

```
hook: function (record, type, meta) { ... return record; }
```

| Type | Fires In | `record` Is | Return | Key `meta` Fields |
|---|---|---|---|---|
| `user` | `user-loop.js:156` | User profile object | Ignored (mutate in-place) | `user`, `config`, `userIsBornInDataset` |
| `scd-pre` | `user-loop.js:175` | Array of SCD entries | Ignored (mutate in-place) | `profile`, `type`, `scd`, `config`, `allSCDs` |
| `funnel-pre` | `funnels.js:70` | Funnel config object | Ignored (mutate in-place) | `user`, `profile`, `scd`, `funnel`, `config`, `firstEventTime`, `experiment` |
| `event` | `events.js:176` | Single event (flat props) | **Used** (replaces event) | `user: { distinct_id }`, `config`, `datasetStart`, `datasetEnd` |
| `funnel-post` | `funnels.js:153` | Array of funnel events | Ignored (mutate in-place) | `user`, `profile`, `scd`, `funnel`, `config`, `experiment` |
| `everything` | `user-loop.js:280` | Array of ALL user events | **Used** if array returned | `profile`, `scd`, `config`, `datasetStart`, `datasetEnd`, `userIsBornInDataset`, `authTime`, `isPreAuth`, `persona` |
| `ad-spend` | `storage.js` | Ad spend event | Ignored | -- |
| `group` | `storage.js` | Group profile | Ignored | -- |
| `mirror` | `storage.js` | Mirror data point | Ignored | -- |
| `lookup` | `storage.js` | Lookup table entry | Ignored | -- |

**Per-user execution order:** `user` -> `scd-pre` -> `funnel-pre` -> `event` -> `funnel-post` -> `everything`

Storage-only hooks (`ad-spend`, `group`, `mirror`, `lookup`) fire once per
record when pushed to a HookedArray. Core hooks (`event`, `user`, `scd-pre`)
fire only in the generator/orchestrator -- storage skips them to prevent
double-fire mutations.

**Return rules:**
- `event`: return the (possibly replaced) event object.
- `everything`: return the (possibly modified) array. Filtered array removes events.
- All other types: mutate `record` in-place. Return value is ignored.

---

## 2. How Mixpanel Counts Things

**Read this before writing any hook that targets a Mixpanel report.** The
verification emulator (`@ak--47/dungeon-master/verify`) now matches these
rules; old recipes that ignored them will look correct on the dataset but
fail when verified or queried in Mixpanel.

### 2.1 Frequency reports count DISTINCT PERIODS, not total events

Mixpanel's frequency distribution / cohort-by-event-count reports count
**distinct time periods** (default: days) on which the user fired the
event. Two purchases on the same day = frequency **1**, not 2.

Two related rules exist (v1.6 names them for what they are; the old
`'calendar'` / `'rolling'` names remain as silent aliases, unknown names
now throw):

- **`algorithm: 'ui-bucket'`** (default in our verifier):
  `COUNT(DISTINCT date_trunc(unit, time))` in UTC. Matches what the Mixpanel
  UI shows and what [`injectOnNewDays`](lib/hook-helpers/inject.js) uses
  internally.
- **`algorithm: 'mixpanel-rolling'`**: the C++
  `addiction_query.cpp` rule `qtz_time >= last_counted + seconds_for_unit`
  (`addiction_query_update_history`, `addiction_query.cpp:363-374`) — what
  Mixpanel's reader actually computes. Diverges from ui-bucket at unit
  boundaries (events at 23:59 + 00:01 next day = 1 rolling period, 2
  calendar periods).

Use the default (`ui-bucket`) for hooks. Use `'mixpanel-rolling'` only
when verifying behavior that explicitly depends on the C++ implementation.

**The actual Frequency report shape** is `frequencyHistogram(events,
{ event, unit, intervalDays, profiles })` (v1.6): per report interval, a
per-user ROLLING unit counter that **resets at every interval boundary**
(`last_counted` is per-(user, interval), `addiction_query.cpp:363-374`),
bucketed into `histogram[count - 1]` with zero-count users **omitted** — no
zero bucket (`addiction_query.cpp:546-573`). Array length is
`ceil(interval / unit)` (`unit.c:108-113`). Use it when a dungeon targets
the Frequency report itself rather than a frequency-derived cohort.

**Implication for hooks:** `scaleEventCount(record, "Buy", 3)` clones 3x as
many Buy events at sub-second offsets — they all land on the same calendar
day, so the user moves **zero bins** in Mixpanel's frequency report. Use
[`injectOnNewDays`](lib/hook-helpers/inject.js) when the goal is to move
users between frequency bins. Both `injectOnNewDays` and the default
`countDistinctPeriods` algorithm use calendar-bucket math, so they agree
at boundaries.

### 2.2 Funnels are GREEDY single-pass with a 2-second grace

Mixpanel processes events in chronological order, single pass. Each event is
greedily assigned to the first eligible step. Step N requires step N-1 first.
The "after" check has a 2-second grace window
(`OUT_OF_ORDER_MILLISECONDS = 2000` in `history.cpp`).

Implementation: [`evaluateFunnel`](lib/verify/funnel-engine.js).

**Implications for hooks:**
- Out-of-order injected events get **consumed by the first matching step**
  even if they break the intended sequence — the engine has no backtracking.
- Conversion window is measured from step 0 with **strict `<`**
  (`event_time < step_0_time + window`). An event at exactly the boundary
  is excluded.
- TTC is `stepTimes[last] - stepTimes[0]` from the greedy match, not from a
  property value. To shift TTC, shift event timestamps (Recipe 3.14).

**v1.6 funnel completion** (all in [`evaluateFunnel`](lib/verify/funnel-engine.js)
/ `emulateBreakdown`):

- **Session-count conversion windows** (`conversionWindowSessions`): the
  window is bounded by N session boundaries after step 0, not wall-clock
  (`WINDOW_TYPE_SESSIONS`, `conversion_window.cpp`). `countMode: 'sessions'`
  is the API preset that rewrites count type + window together.
- **Exclusion steps** use ARB's gap-slot semantics: an exclusion event
  kills only the funnel attempt whose gap it lands in — full audit against
  `history.cpp` shipped in v1.6.
- **Any-order step blocks** run ARB's anchor/chunk greedy pass: unordered
  steps inside a block match in any sequence between the surrounding
  anchors.
- **Trends under `timeBucket`** anchor on STEP 0's timestamp — a funnel
  converting across midnight counts in the bucket where it STARTED
  (`funnel_query.cpp` anchors step 0 in `[start, stop)`).
- **TTC** aggregates use ARB's integer-second gap deltas: per-gap deltas
  floor to whole seconds and clamp to 0 per gap; `$ttc` is integer seconds
  (`history.cpp`). Sub-second TTC engineering is invisible to Mixpanel.

### 2.3 Aggregations are null-aware

`AVG(x)` skips null/undefined/NaN/non-numeric from BOTH numerator AND
denominator. Same for SUM, MIN, MAX. Reference: `normal_query.cpp`
ACTION_TYPE_AVERAGE / ACTION_TYPE_SUM / ACTION_TYPE_EXTREMES.

**Implication for hooks:** A property that's only sometimes present (e.g.,
`order_value` only on Purchase events) is averaged ONLY across events where
it exists. You don't need to "fill" missing values with 0 to keep the
average sensible — Mixpanel ignores them. Conversely, if you want to dilute
an average, removing the property is a no-op; you have to add zeros.

**List-valued properties (v1.6):** Mixpanel's list branch aggregates each
numeric list ITEM independently — for AVG every item adds to the numerator
AND increments the denominator (`normal_query.cpp:1585-1617`), one level
deep (nested lists are skipped, not recursed). `nullAwareAvg` /
`nullAwareSum` mirror this behind `{ flatten: true }` — opt-in, because the
v1.5 default (arrays skipped whole) would otherwise silently change results
for 1-item-array data. If a dungeon carries numeric list properties and
targets an Insights SUM/AVG, verify with `flatten: true` or the numbers
won't match Mixpanel.

### 2.4 Attribution: first/last touch are UNCAPPED; only multi-touch caps at 10

First-touch and last-touch attribution read the globally first / most
recent touch in the lookback window, no matter how many touches precede
the conversion — ARB's FIRST/LAST paths execute hard-`LIMIT 1` statements
(`whoval/read.cpp:173-192`, `:643-655`). `TOUCHPOINTS_LIMIT = 10`
(`attributed_value_reader.cpp:16`) is consumed only by the sorted-list
statement (`LIMIT ?4`, `read.cpp:595`) serving multi-touch models
(linear / participation / time-decay). A user with 50 touches before
conversion still first-touch-attributes to touch #1, not touch #41.

**v1.5 generation contract:** the engine now caps UTM stamping at
`maxTouchpointsPerUser` (default 10) per user, sampled uniform-random across
the user's lifetime (NOT first-N-chronological). Stamps are sorted
chronologically before being applied, so attribution properties land in
time order. Hooks that bias attribution should OVERWRITE engine-stamped
values, not stamp from scratch (those would push the user past the cap).

**Per-conversion attribution (v1.6):** Mixpanel runs attribution once PER
conversion event — each conversion gets its own lookback read ending at
that conversion (`attributed_value_reader_read` takes one `event_time_ms`
per read; `backend/libquery/properties_over_time/attributed_value_reader.cpp`).
The verifier's `attributedBy` matches with `perConversion: 'all'`; its
default stays `'first'` (one conversion per user — v1.5 back-compat, NOT
ARB semantics).

**⚠ Touchpoint seam (documented, by design):** the generator samples WHICH
events get UTMs uniformly across a user's lifetime (capped at
`maxTouchpointsPerUser`, default 10); the verifier and Mixpanel read
touches BEFORE each conversion. A user with more eligible events than the
generator cap can carry touches that never got stamped — and stamped
touches can postdate every conversion. Divergence is theoretical below
~10 eligible events per user. Attribution-engineering hooks should
overwrite engine-stamped UTMs rather than relying on lifetime-uniform
sampling.

### 2.5 Active-day distribution is config-first

Mixpanel frequency reports count distinct days (§2.1). The v1.5 engine
exposes `Dungeon.avgActiveDaysPerUser` as the canonical primitive for this
shape. Set it at the config level and the engine concentrates each user's
events onto a sampled subset of days drawn from `normal(mean=N, sd=N/3)`,
clamped to `[1, userActiveDays]`.

**Concentrator semantic — total event count is preserved.** The per-active-day
rate INFLATES when `avgActiveDaysPerUser < userActiveDays`. Example:

```
avgEventsPerUserPerDay: 4
avgActiveDaysPerUser: 2
numDays: 30
→ userEventBudget = 4 × 30 = 120 events  (preserved)
→ events concentrated onto 2 days
→ effective per-active-day rate = 120 / 2 = 60 events per active day
```

The validator emits a warning when implied per-active-day rate > 50.

**Hook authoring rule:** do NOT engineer global active-day distribution in
hooks. Use the config knob. Reserve `injectOnNewDays` for cohort-conditional
patterns ("premium users get 7+ active days, rest stay default").

**Incompatibility with `engagementDecay`:** decay drops events from late-day
positions in the user's lifetime, eroding picked active days. Setting both
`avgActiveDaysPerUser` AND `engagementDecay` produces an effective active-day
count BELOW the configured target. Pick one. If you need both effects, set
`avgActiveDaysPerUser` and write decay logic in an `everything` hook scoped
to specific cohorts (gives explicit control over the interaction).

### 2.6 Sessions are query-time computed (30-min gap, 24h max, day-boundary split)

Reference: `backend/arb/reader/queries/session_query.cpp:828-830, 905-928`.
Sessions are NOT persisted on raw events in Mixpanel — they're derived per
query from THREE reset triggers:

1. **Inactivity gap** > `session_timeout` (default 30 min, strict `>`)
2. **Max session duration** > `session_max_time` (default 24h)
3. **UTC (qtz) day boundary** — `last_event_day_idx != day_idx` ends the session

Each session emits synthetic `$duration_s`, `$event_count`, `$origin_start`,
`$origin_end` properties.

**Namespace rule:** synthetic session events are `EVENT_TYPE_SESSION` — a
separate selector namespace from regular events (`libquery/event/filter.h`).
A dungeon event literally named `"$session_start"` would NOT merge with or
shadow Mixpanel's session events; don't name events into the `$session_*`
family (see `lib/verify/sessionize.js:41-42`).

**v1.6 contract:** the verifier derives sessions at query time via
`sessionize()` (`lib/verify/sessionize.js`) — the same three triggers, all
strict `>`, plus synthetic `$session_start`/`$session_end` events carrying
the four computed props. `sessionMetrics` defaults to `source: 'derived'`;
the generator's pre-stamped `session_id` (from `assignSessionIds`) is a
generator artifact Mixpanel never sees, kept available via
`source: 'stamped'` and audited by the per-row `stampedDivergence` count.
`eventBreakdown` and `uniques` accept `countType: 'sessions'` (count once
per (user, session, segment) / distinct (user, session) pairs per bucket —
`normal_query.cpp:1318-1352`). Sessions always derive from the FULL event
stream; name filters select which events count, never which events shape
sessions (`normal_query.cpp:2271-2280`).

**Verifier-only conveniences (not directly reproducible in Mixpanel UI):**
- `evaluateFunnel({ sessionScoped: true })` partitions events per session and
  runs the matcher independently. Mixpanel's closest analog is
  `WINDOW_TYPE_SESSIONS` (`conversion_window.cpp:9-13`) — bounds the window
  by session COUNT, not by partitioning. Use sessionScoped for clean
  per-session funnel verification; for Mixpanel-replay accuracy, prefer
  setting `conversionWindowMs = 1800000` (30 min).
- `sessionMetrics({ event: 'X' })` filters to sessions containing event X.
  Mixpanel has no direct equivalent in `session_query.cpp`.

**Divergences (documented):**
- Verifier uses **UTC**, not query timezone (qtz). For non-UTC accounts,
  bucket boundaries shift by hours.
- Percentiles use linear interpolation (d3.quantile). Mixpanel uses TDigest
  in production — diverges by single-digit % at p90 on small samples.

### 2.7 Retention is birth-anchored, ms-delta bucketed

Reference: `backend/arb/reader/queries/retention_query.cpp:1227-1231`. For
each user, the engine finds the first occurrence of `birth_event` →
`first_event_time_s`. For each return event, it computes:

```
time_to_retention_event_s = retention_event_time_s - first_event_time_s
bucket = floor(time_to_retention_event_s / bucket_seconds)
```

**Bucketing is ms-delta from birth, NOT a UTC-calendar-day-number difference.**
A return 23h after birth lands in bucket 0; a return 25h after birth lands in
bucket 1 — even when both fall on the UTC calendar day after the birth day.

**`birth_can_retain`** (default `false`; `retention_query.cpp:1120-1139`,
`retention_query_event_occurs_after_birth` — cites COR-233): returns strictly
after the birth ms count by default (`first_event_time <
retention_event_time`). `birthCanRetain: true` relaxes the gate to `<=` — but
ONLY when the return event ALSO matches the birth filter (`matches_first`). A
*distinct* return event at the exact birth ms stays excluded even with the
flag on. The gate reads the RAW birth time — calendar alignment applies only
inside the bucket delta.

**Unbounded modes** — `unbounded: 'carryForward' | 'carryBack' |
'consecutiveForward'` (v1.6; the v1.5 `carry_forward: true` spelling remains
as an alias for `carryForward`):

- `carryForward` — retained at bucket N if active in ANY bucket ≤ N; read-time
  carry (`retention_query.cpp:1854-1868`). Curve is monotonically
  non-decreasing.
- `carryBack` — retained at bucket N if active in ANY bucket ≥ N;
  reverse-iteration carry (`retention_query.cpp:274-278`). Curve is
  monotonically non-increasing.
- `consecutiveForward` — gated at WRITE time (`retention_query.cpp:1275-1287`):
  bucket N is marked only if N−1 is already marked (except N = 0), so a user's
  surviving marks are exactly their maximal consecutive streak `{0..k}` from
  birth.

**`compounded: true`** (`retention_query.cpp:677-685`): `rq->second =
rq->first` — the return side IS the cohort side, so every cohort event is a
return candidate. This is Mixpanel's "DAU coming back" report family. Setting
a conflicting `returnEvent` alongside `compounded` throws.

**`bucketUnit: 'hour' | 'day' | 'week' | 'month'`** — month is **31 days
FIXED** ("maximum possible seconds in a month", `libquery/util.h:265-273`),
NOT calendar months. Week is 7 fixed days.

**`bucketAlignment: 'calendarStart'`** (`retention_query.cpp:312-332`): floors
the BIRTH time to the bucket-unit boundary before computing deltas (week
floors to ISO Monday, matching `partitionByTimeBucket`). Month alignment
floors to the calendar month start while the bucket WIDTH stays 31d fixed.

**`segmentBy` + `segmentOn: 'birth' | 'return'`**: `'birth'` (default,
SEGMENT_EVENT_FIRST) reads the segment value from the BIRTH event; `'return'`
(SEGMENT_EVENT_SECOND, `retention_query.cpp:1421-1444`) reads it from each
RETURN event — a user joins a segment's cohort only via a qualifying return
carrying that value, so births are unsegmented unless `birthCanRetain` lets
the birth itself qualify as a return.

**`cohortWindow: { from, to }`** restricts births to `[from, to]` inclusive —
Mixpanel's `[from_date, to_date]` cohort restriction. Without it the verifier
uses all users with the birth event anywhere in the dataset.

**Internal-event ignore list** (`retention_query.cpp:2546-2555`): when a side
has no explicit event selector (`'$any_event'`), `$campaign_delivery`,
`$campaign_bounced`, `$create_alias`, `$identify`, `$merge` are ignored for
that side. Explicit selectors bypass the list.

All items on the v1.5.0 "documented gaps" list closed in 1.6.0. Unrecognized
retention option keys now THROW — kills the silent-ignore class of bug where a
typo'd `compounded: true` was dropped without effect.

### 2.8 Funnel reentry: state machine resets after completion

Reference: `history.cpp` (`last_step_starts_next_funnel`). With reentry
enabled, after the state machine reaches the final step the engine resets to
step 0 and continues scanning. `result.completions` reports the total. In
`countMode: 'totals'` the engine returns one `FunnelResult` per completion
(simultaneous histories — one user, many funnel completions). Without
reentry the funnel runs once per user.

### 2.9 HPC (Hold Property Constant) — parallel sub-funnels

Reference: `funnel_query.cpp` lines 749-784 (`aggregate_hash_get_key_cursor`).
HPC partitions a single funnel into one parallel sub-funnel per unique value
of the held property on the step-0 event. A user can complete the funnel in
one HPC bucket and drop off in another simultaneously — the buckets are
independent. Use `evaluateFunnelHPC(events, steps, holdProperty, options)`
directly, or (v1.6) pass `holdPropertyConstant: '<prop>'` to the
`funnelFrequency` emulator — it routes through the HPC engine and reports
per-held-value sub-funnel counts.

### 2.10 Funnel segment modes (FIRST_TOUCH / LAST_TOUCH / STEP)

Reference: `options.hpp` `funnel_segment_mode`; `history.cpp`
`property_set_buffer`. The engine snapshots the matched event's properties
at every funnel step. Segmentation chooses which step's properties to use:
FIRST_TOUCH (step 0), LAST_TOUCH (last reached), or STEP N (specific index).
Enable with `evaluateFunnel({ trackStepProperties: true })`, then pick with
`resolveFunnelSegment(result, 'first' | 'last' | { step: N })`.

### 2.11 Engine-validation guarantees (v1.5+)

The v1.5 ship gate added a 194-combo cross-product sweep
(`tests/engine/sweep-engine.mjs`) that proves the **no-hook** baseline
(`dungeons/technical/simplest.js`) satisfies a per-macro strict bar across
the supported param space. Same 6 conditions enumerated in
[CLAUDE.md "Tuning guidance"](CLAUDE.md#tuning-guidance--safe-ranges-and-engine-guarantees-v15).
Validator strict-clamps prevent the worst pathological combos (e.g.,
`percentUsersBornInDataset: 100` + `bornRecentBias: 0.6`) at config time.

**What this means for hook authors:**

1. **Engine gives you a clean canvas.** Without hooks, the per-day distribution
   stays in-band across all 5 macro presets (flat / steady / growth / viral /
   decline) at any reasonable `numDays` / `numUsers` / `rate` / `activeDays`
   combo. You don't have to defend against engine drift — the canary at
   `tests/unit/engine-shape-canary.test.js` runs every commit, the full sweep
   gate at `tests/e2e/engine-shape-full-sweep.test.js` runs pre-release.

2. **Hooks own their shape — guarantees stop applying.** The strict bar is
   measured on no-hook output. Engineered hook patterns CAN and SHOULD
   intentionally bend the bar:
   - **Decline + churn cohort** (engagementDecay or `everything`-hook event-drop)
     produces tail_ratio < 0.4 — well below the decline bar's 0.4 floor.
     Sunset-story design intent.
   - **Viral hooks with persona-driven late-cohort lift** can push the
     right-edge spike above the viral preset's 7.0 cap. Hockey-stick stories
     are louder than the engine baseline.
   - **World-event spike** (e.g., a launch-day burst of 5x normal volume)
     creates a single-day right-edge spike above the spike cap.
   Document intentional deviations in the dungeon's overview JSDoc + the
   hook's pattern documentation block.

3. **Validator clamps fire only when you pass user-explicit values.** Macro
   preset values (e.g., `viral` = bias=0.6 + born=55%) are exempt — clamp
   targets dungeons that override `percentUsersBornInDataset`,
   `bornRecentBias`, `avgEventsPerUserPerDay`, `avgActiveDaysPerUser` outside
   safe bounds. If your dungeon explicitly sets these and you see a
   `⚠️ ... clamped to ...` warning on first run, the validator just rescued
   you from a broken-looking chart. Either accept the clamped value or fix
   the config (the warning explains which).

4. **`futureEvents == 0` is unconditional.** The future-time guard at storage
   step 14 drops any event with `time > FIXED_NOW`. Hooks can clone events
   with arbitrary timestamps without polluting the dataset. Verified across
   the 194-combo matrix; this guarantee survives every hook pattern.

### 2.12 Event breakdown counts EVENTS, not users (v1.6)

Reference: `normal_query.cpp:1718-1776` (ACTION_TYPE_FOR_EACH). Insights
"Total" broken down by a property counts every matching EVENT into its
segment — a user firing 50 times contributes 50, not 1. Emulator:
`emulateBreakdown(events, { type: 'eventBreakdown', event, breakdownProperty,
topN })`.

- **List-valued properties explode**: an event with `tags: ['a', 'b']`
  contributes one count to segment `a` AND one to segment `b`. An EMPTY list
  lands in the literal segment `"$empty_list"` (`normal_query.cpp:1762`).
- **Segments are case-sensitive and type-tagged**: number `1` and string
  `'1'` are DIFFERENT segments. Engineer property values with exact casing
  and types.
- **Two rulebooks — segment IDENTITY vs WHERE-filter matching**
  (implementation: `lib/verify/coerce.js`):

  | Operation | Case | Types | ARB source |
  |---|---|---|---|
  | Segment bucketing (breakdown key) | **sensitive** | tagged (`1` ≠ `'1'`) | `hash_value.c:114-115` (raw XXH3), `:92-97` (type tags); ordering `cmp.c:24-32` (`arb_strcmp`) |
  | Filter `==` / `!=` | **INsensitive** | string-coerced | `value.c:285` (`arb_strcasecmp`) |
  | Filter `contains` | **INsensitive** | string-coerced | `eval_node.c:2914` (`arb_strcaseinstr`) |
  | Filter `<` `>` `<=` `>=` on strings | **INsensitive** | string-coerced | `eval_node.c:2931` (`arb_strcasecmp`) |

  So `plan == "PRO"` in a WHERE filter matches `"pro"` events, but those
  events still land in a `"pro"` segment distinct from `"PRO"` when broken
  down. A hook that stamps mixed-case variants passes its own filter check
  and STILL splits the breakdown table.
- **Coercion to breakdown key**: `null`/`undefined` → `"undefined"`
  (`arb_selector.py:889-916`), booleans → `"true"`/`"false"`, `-0` → `0`
  (`hash_value.c:111`), objects JSON-stringify, lists fan out per item
  BEFORE coercion.
- **`topN` defaults to 250** (`normal_query.cpp:1195-1197` — "If no
  meaningful limit is supplied, set it to 250"), sorted count-desc, truncated
  with NO "other" bucket. Segments below the cut disappear from the table
  entirely — keep engineered breakdowns well under 250 distinct values.
- `countType: 'unique'` switches to per-segment distinct users;
  `countType: 'sessions'` counts distinct derived sessions per segment.
  `firstTimeOnly: true` composes (see §2.15).

### 2.13 Uniques, XAU rolling windows, and cumulative (v1.6)

Reference: `normal_query.cpp:1300-1316` (per-interval dedup), `:1797-1830`
(rolling), `:1834-1863` (cumulative). Emulator: `{ type: 'uniques', event,
unit, rollingWindow, cumulative }`.

- **Per-interval dedup is independent**: a user active on day 3 and day 5
  counts once in EACH bucket. DAU across a week can sum to 7× the true user
  count.
- **XAU (`rollingWindow: W`) is a look-back window, NOT a calendar period**:
  an event on day E contributes the user to buckets `[E, E+W−1]` — forward
  tiling of the look-back. WAU on a Wednesday covers the 7 days ENDING that
  Wednesday, not the ISO calendar week. Do not verify weekly-active stories
  against calendar-week buckets.
- **`cumulative: true`**: bucket N reports distinct users seen in buckets
  0..N — each user counts once, at first appearance, and the curve is
  monotonically non-decreasing.
- **Empty/missing distinct_ids are skipped** (`normal_query.cpp:2200-2208`) —
  events with `''` ids never count toward uniques.
- `countType: 'sessions'` composes with `rollingWindow` but NOT with
  `cumulative` (`normal_query.cpp:1318-1352` — no cumulative sessions path).

### 2.14 Formulas evaluate in the API layer, zero-filled (v1.6)

Reference: `analytics/api/.../formula/util.py` `operate()` (:25-47),
div-by-zero (:81-86), `grammar.lark` (PEMDAS). Insights formulas (e.g.
`A/B*100`) are NOT an ARB query — the API layer fetches each letter's series
independently and combines them in Python:

- **Union-of-keys broadcast**: series are joined on the union of their date
  keys; a date missing from one series contributes **0** (not null, not
  skipped).
- **Division by zero yields 0** — not NaN, not infinity, not a gap. A
  conversion-rate formula over a day with zero denominators shows 0%.
- **A missing/empty series is all zeros.**

Helper: `evaluateFormula(expr, { A: series, B: series })` implements the same
grammar and zero-fill rules. Engineer stories so denominators are non-zero on
days the chart must look alive.

### 2.15 First-time-ever is a two-query rewrite (v1.6)

Reference: `analytics/.../event_selector.py:59-149`,
`arb_selector.py:1874-1936`. "First time ever doing X" runs TWO queries:
pass 1 computes each user's `first_event_time` over (event + **pre-filters**);
pass 2 selects events matching event name + `$time == first_event_time` +
**post-filters**. Consequences:

- **Pre-filters define the universe** — they decide WHICH event is "the
  first". Post-filters only test the already-picked event; a first event
  failing a post-filter is dropped, NOT replaced by the next candidate.
- **Filter position decides pre vs post** — in Mixpanel's UI, filters above
  the first-time operator are pre, below are post.
- Helper: `filterFirstTimeEver(events, { event, preWhere, postWhere })`;
  `firstTimeOnly: true` on the `eventBreakdown`/`uniques` emulators applies
  the no-filter form.

### 2.16 Lifecycle is a board template, not an engine query (v1.6)

Mixpanel has NO lifecycle query type (`query_type.cpp:8-30` enumerates every
ARB query — nothing lifecycle-shaped). "Lifecycle" is the Lifecycle Cohort
Analysis BOARD TEMPLATE: Insights uniques filtered by four behavioral cohorts
on a **Value Moment** event (`iron/common/report/dashboards/types.ts:367-390`),
in 7- and 30-day period variants. The canonical cohort definition is
`weeklyResurrectedUserBookmark`
(`iron/common/widgets/profile-summary/bookmark_templates.ts:179-320`).

Classification per period T: **new** = first-ever value moment in T;
**retained** = active in T and T−1; **resurrected** = active in T, inactive
in T−1, active in some period before; **dormant** = INACTIVE in T, active in
T−1. Emulator: `{ type: 'lifecycle', valueMomentEvent, periodDays: 7|30 }`.

- **Declared divergence (tiled vs rolling)**: the real template's cohort
  windows are rolling, re-anchored as-of each charting interval; the emulator
  tiles fixed periods back from the dataset's last event day — identical
  classification rules, deterministic period edges.
- **Dormancy is an EqualTo-0 filter**: ONE stray value-moment event inside a
  would-be dormancy window reclassifies the user (resurrected → retained).
  Resurrection stories need disciplined gaps — use the lifecycle-wave atom
  rather than hand-rolled probabilistic gaps.

### 2.17 Flows (Top Paths) are next-anchor-only with per-level pruning (v1.6)

Reference: `flows_query.cpp:988-994` (next-anchor-only), `flows.cpp:680-717`
(buffers), `bookmark.py:96/:110` (pruning thresholds). Emulator: `{ type:
'topPaths', anchors, forward, reverse, countType, output }`; helpers
`extractFlows` / `aggregateFlows`.

- **Next-anchor-only matching**: an event only advances the flow if it
  matches anchor `reached + 1`. Matching a LATER anchor (or an earlier one
  again) makes it a plain step. Out-of-order anchor engineering does nothing.
- **Capacity rings**: each anchor keeps `forward` steps after it (linear —
  first N) and `reverse` steps before it (circular — LAST N). Defaults
  forward=4, reverse=0 mirror the Flows UI view, not ARB constants.
- **`countType: 'unique'`** = one flow per user across the whole stream;
  `'general'` coincides for pure flows; `'sessions'` restarts the flow
  universe at every session boundary (sessions derive from the user's FULL
  stream, not the filtered steps).
- **Per-level top-N pruning**: nodes below the per-level top
  `cardinalityThreshold` coalesce into `$mp_uncommon_flows_events`. Defaults:
  **50** for list output, **3** for sankey. ANCHOR nodes are exempt from
  coalescing. A path must hold roughly ≥20-25% share at each level to survive
  the sankey view — engineer dominant paths, not long tails.
- **Step spacing**: give engineered path steps ≥1s spacing — same-ms steps
  sort nondeterministically and can reorder the path.

---

## 3. Core Principles

1. **Schema-first.** Every property in the output must be defined in the dungeon
   config (`events[].properties`, `userProps`, or `superProps`) with a default
   value. Hooks modify existing values. They never invent new properties.

2. **No flag-stamping.** Never add cohort labels like `is_whale = true` or
   `power_user = true`. Derive segments from behavioral data (event counts,
   property values, sequences) that analysts discover via Mixpanel cohorts.

3. **Clone-don't-construct.** Injected events must be cloned from an existing
   event using spread (`{...template, time: t, user_id: uid}`). Never build
   events from scratch. This guarantees the schema stays consistent.

4. **Properties are FLAT.** Access `record.amount`, not
   `record.properties.amount`. The engine flattens event properties before
   hooks see them.

5. **Hooks are the final authority.** They override persona modifiers, world
   events, experiment modifiers, and engagement decay. Whatever the hook writes
   is what ships.

6. **Use `dayjs` for time, seeded `chance` for randomness.** Never use
   `Math.random()`. Initialize `chance` at module scope with the dungeon seed:
   `const chance = u.initChance(SEED)`.

7. **Temporal hooks go in `everything`.** Any hook that checks
   `dayInDataset >= N` must live in the `everything` hook, not the `event`
   hook. The `event` hook's `meta.datasetStart` produces unreliable day
   calculations. The `everything` hook's `meta.datasetStart` is verified
   correct.

8. **Event cloning requires `everything`.** The `event` hook's return value
   REPLACES the original event. To DUPLICATE or INJECT events, use the
   `everything` hook and `push()` to the array.

9. **Property baselines must contrast with hook targets.** If a hook sets
   `event_type = "plan_upgraded"` during a window, the baseline distribution
   must make `plan_upgraded` rare (~10-15%). Same applies to direction-of-change
   properties (forced "down" needs baseline favoring "up").

10. **TTC effects go in `everything`, not `funnel-post`.** Funnel-post TTC
    scaling is not verifiable via cross-event SQL — standalone events drown
    the within-funnel signal. Move TTC effects to `everything` and shift
    timestamps directly with `findFirstSequence` + `scaleFunnelTTC`. Use
    factors of 0.5x/1.8x or stronger.

11. **Temporal mutations run AFTER all cloning.** If Hook A clones events and
    Hook B mutates events in a time window, run B at the END of the everything
    hook so cloned events land inside the window correctly.

12. **Cohort detection must survive downstream filtering.** Use stricter
    detection (3+ events instead of 1+) so surviving events still identify
    the cohort even if churn / retention filters prune some.

13. **Deprecated feature replacement.** Hooks that depended on properties
    generated by `subscription`, `attribution`, `features`, etc. (removed in
    1.4) must add equivalent property assignments via `user` or `everything`
    hooks; add the property to `superProps`/`userProps` with a default.

14. **Unseeded `Chance` instances break determinism.** Always
    `const chance = u.initChance(SEED)`.

15. **TTC effects must shift timestamps, not just properties.** Mixpanel's
    funnel TTC measures the delta between event *timestamps*. Scaling a
    timing *property* (`wait_time_hours *= 0.67`) changes Insights AVG
    reports but does NOT affect Funnel TTC. Use `scaleFunnelTTC` on
    timestamps as the primary mechanism.

16. **Scope `funnel-pre` to specific funnels.** Unscoped `funnel-pre` hooks
    affect ALL funnels. Always check `meta.funnel?.sequence?.includes(...)`
    before scaling `record.conversionRate`.

17. **SCD props live in `meta.scd`, not `meta.profile`.** Read the latest
    entry from `meta.scd.<scdName>`. Reading `meta.profile.<scdPropName>`
    is always `undefined`.

18. **Calibrate thresholds against actual event distributions.** Run the
    distribution query before setting thresholds:
    ```sql
    SELECT count, COUNT(*) FROM (
      SELECT user_id, COUNT(*) AS count FROM events WHERE event = 'X' GROUP BY user_id
    ) GROUP BY count ORDER BY count;
    ```
    Aim for ~80th percentile so ~20% of users qualify.

19. **Prefer boosts over drops for retention hooks.** `scaleEventCount(record,
    "X", 1.8)` on the positive cohort produces cleaner signal than
    `dropEventsWhere` on the negative cohort. Drops compound destructively;
    boosts don't.

20. **Compounding drop hooks destroy signal.** Use at most ONE drop-based
    retention hook per dungeon. Move the rest to boost-based patterns.

### New principles from the emulator alignment

21. **Distinct-day vs total-event binning.** Frequency-distribution reports in
    Mixpanel count distinct days (Section 2.1). For any hook whose verification
    target is a frequency report, use [`binByDistinctPeriods`](lib/verify/counting.js)
    instead of `binUsersByEventCount`. For hooks targeting raw event counts
    (Insights `total events`, `events per user`), `binUsersByEventCount` is
    still correct.

22. **`scaleEventCount` does not move users between frequency bins.** Cloning
    Buy events at sub-second offsets places them on the same calendar day, so
    the user's distinct-day count is unchanged. To shift frequency bins use
    [`injectOnNewDays`](lib/hook-helpers/inject.js), which spreads injections
    across previously empty days within the user's active window.

23. **Out-of-order injected events get consumed by the funnel engine.** Adding
    a "step C" event before "step B" in the stream causes Mixpanel's greedy
    engine to assign the C event correctly only if step B has already
    advanced. If your hook injects funnel-step events, ensure they land
    after the prior step's timestamp (with margin > 2 seconds for the grace
    window).

24. **Attribution stamping is capped at 10 touchpoints.** When biasing
    `firstTouch` attribution by stamping touchpoint events, ≤10 touches per
    user enter the candidate pool. Stamping 50 weighted Touch events per
    user gives the same answer as stamping 10. Aim for sparse, distinct
    touches with deterministic weight ratios.

25. **Null-aware aggregation removes the need to "fill" defaults.** Don't
    coalesce missing numeric properties to 0 to keep AVG sane — Mixpanel
    skips them. Use absence to signal "no measurement," not "zero."

### v1.5 principles

26. **Engine auto-sorts events by time after `everything` hook.** Default ON;
    opt out via `autoSortAfterEverything: false` on the dungeon config. Hooks
    that `push()` cloned events with arbitrary timestamps no longer need to
    hand-sort to keep the greedy funnel engine happy. Sort is O(n log n)
    where n is single-user events.

27. **Validator auto-promotes funnel-step events to `isStrictEvent: true`.**
    When an event in `events[]` also appears in any user-declared funnel
    sequence, the validator stamps `isStrictEvent: true` and warns. This
    heals the silent-corruption footgun where the greedy engine consumed
    standalone instances as funnel matches. Set `isStrictEvent: false`
    explicitly to opt out and preserve mixed funnel/standalone semantics.

28. **Active-day distribution is set via config, not hooks.** Use
    `Dungeon.avgActiveDaysPerUser` at the config level. Hooks should NOT
    engineer global active-day patterns via `injectOnNewDays`. Reserve
    `injectOnNewDays` for cohort-conditional cases ("premium users get 7+
    active days, rest stay default"). See §2.5.

29. **Touchpoint cap awareness for attribution hooks.** The engine caps
    UTM stamping at `maxTouchpointsPerUser` (default 10) per user, sampled
    across the user's lifetime. Attribution-biasing hooks should OVERWRITE
    engine-stamped values (e.g., set `event.utm_source = "google"` on
    already-stamped touches), NOT stamp fresh touches from scratch.
    First/last-touch attribution is UNCAPPED (§2.4) — a fresh stamp
    EARLIER than the engine's first stamp silently becomes the first-touch
    winner, changing results out from under your derivation. Overwriting
    the engine's stamps keeps the touch set fixed so your bias lands
    exactly where attribution reads.

---

## 4. Recipe Catalog

Each recipe shows the hook, the Mixpanel report it targets, and (where
counting semantics matter) the rule from Section 2.

### Temporal Trends

#### 4.1 Conversion Change Over Time

**Hook:** `funnel-pre` | **Meta:** `meta.firstEventTime`
**Mixpanel report:** Funnels — conversion rate over time

**In Mixpanel:** Funnel conversion shows a step-change at a specific date.

```js
if (type === "funnel-pre") {
  const isTargetFunnel = meta.funnel?.sequence?.includes("Activate");
  if (!isTargetFunnel) return;
  const LAUNCH = dayjs.unix(meta.datasetStart).add(60, "days").valueOf();
  if (meta.firstEventTime > LAUNCH) {
    record.conversionRate *= 1.2;
  }
}
```

Greedy funnel engine (Section 2.2) applies after — keep `conversionRate`
adjustments modest (1.2x is comfortable; 3x can saturate at the 95% cap).

---

#### 4.2 Feature Launch Inflection

**Hook:** `everything` | **Meta:** `meta.datasetStart`
**Mixpanel report:** Insights — Total events broken down by `Feedback Source`

**In Mixpanel:** Line chart of `Submit Feedback` broken down by `Feedback
Source` shows new sources appearing only after a launch date.

```js
if (type === "everything") {
  const LAUNCH = dayjs.unix(meta.datasetStart).add(74, "days");
  const feedbackTemplate = record.find(e => e.event === "Submit Feedback");
  if (!feedbackTemplate) return record;

  for (const e of record) {
    if (e.event !== "Ask MyBuddy" || !dayjs(e.time).isAfter(LAUNCH)) continue;
    const tail = record.slice(record.indexOf(e));
    const match = findFirstSequence(tail, ["Ask MyBuddy", "View Summary"], 5);
    if (match && chance.bool({ likelihood: 35 })) {
      record.push(cloneEvent(feedbackTemplate, {
        time: dayjs(match[1].time).add(2, "minutes").toISOString(),
        user_id: record[0].user_id,
        "Rating": chance.integer({ min: 4, max: 5 }),
        "Feedback Source": "Post Search",
      }));
    }
  }
  return record;
}
```

---

#### 4.3 End-of-Quarter Spike

**Hook:** `event` | **Meta:** `meta.datasetStart`
**Mixpanel report:** Insights — Total events filtered by `event_type`

**In Mixpanel:** `billing event` filtered to `event_type = "plan_upgraded"`
shows a 4x spike in the final 10 days.

```js
if (type === "event" && record.event === "billing event") {
  const dayInDataset = dayjs(record.time).diff(dayjs.unix(meta.datasetStart), "days", true);
  if (dayInDataset >= 80 && dayInDataset <= 90 && chance.bool({ likelihood: 40 })) {
    record.event_type = "plan_upgraded";
  }
}
```

---

#### 4.4 Degradation and Recovery

**Hook:** `everything` | **Meta:** `meta.datasetEnd`, `meta.profile`
**Mixpanel report:** Insights — Total events broken down by `Region`

**In Mixpanel:** `Agenda Error` line chart shows zero before April 10, ramps
during the bug window, decays after the fix. Breakdown by `Region` shows EU
dominates.

```js
if (type === "everything") {
  const BUG_START = dayjs.unix(meta.datasetEnd).subtract(20, "days");
  const FIX_DATE = dayjs.unix(meta.datasetEnd).subtract(4, "days");
  if (meta.profile.Region !== "EU") return record;

  const errorTemplate = record.find(e => e.event === "Agenda Error") || record[0];
  record.filter(e => e.event === "Create Agenda" && dayjs(e.time).isAfter(BUG_START))
    .forEach(agenda => {
      const t = dayjs(agenda.time);
      let likelihood = 60;
      if (t.isAfter(FIX_DATE)) {
        likelihood = Math.max(0, 60 * Math.pow(0.15, t.diff(FIX_DATE, "days", true)));
      }
      if (likelihood > 0 && chance.bool({ likelihood })) {
        record.push(cloneEvent(errorTemplate, {
          event: "Agenda Error",
          time: t.add(chance.integer({ min: 2, max: 10 }), "seconds").toISOString(),
          user_id: record[0].user_id,
          "Error Message": "model not found in region eu-west-5-2",
          "Error Code": 500,
        }));
      }
    });
  return record;
}
```

---

### Magic Numbers (Distinct-Day Frequency)

> The recipes in this section all target Mixpanel **frequency distribution**
> reports. They use distinct-day binning (Section 2.1), not total-event
> binning.

#### 4.5 Inverted-U Sweet Spot (Frequency Report)

**Hook:** `everything` | **Counting:** distinct days (Section 2.1)
**Mixpanel report:** Insights — Frequency Distribution (distinct-day count)

**In Mixpanel:** Insights frequency distribution of `Onboarding Question`
shows peak conversion at 3 distinct days of activity, dropping on both sides.

```js
import { binByDistinctPeriods } from "@ak--47/dungeon-master/verify";

if (type === "everything") {
  const BINS = {
    low:    [0, 3],
    sweet:  [3, 4],
    four:   [4, 5],
    high:   [5, Infinity],
  };
  const DROP = { low: 75, sweet: 0, four: 20, high: 70 };
  const bin = binByDistinctPeriods(record, "Onboarding Question", BINS, "day");
  const dropProb = DROP[bin] ?? 0;

  if (dropProb > 0 && chance.bool({ likelihood: dropProb })) {
    const keep = new Set(["View Shared Page", "Onboarding Question"]);
    dropEventsWhere(record, e => !keep.has(e.event));
  }
  return record;
}
```

**Why distinct-day binning:** A user who answered 5 onboarding questions in
a single sitting is still in the "1 distinct day" bin in Mixpanel's
frequency report. Total-event binning would mis-classify them as "high
engagement."

**Adaptation:** For bins targeting Insights *total event count* rather than
frequency distribution, swap `binByDistinctPeriods` for
`binUsersByEventCount`.

---

#### 4.6 Frequency × Engagement Sweet Spot

**Hook:** `everything` | **Counting:** distinct days
**Mixpanel report:** Insights — Frequency × Frequency cross-table (distinct-day counts on both axes)

**In Mixpanel:** Users with 3-8 distinct browse days show 25% higher cart
amounts. Users with 9+ distinct browse days are window-shoppers whose
checkouts drop 30%.

```js
import { countDistinctPeriods } from "@ak--47/dungeon-master/verify";

if (type === "everything") {
  const browseDays = countDistinctPeriods(record, "view item", "day");
  if (browseDays >= 3 && browseDays <= 8) {
    scalePropertyValue(record, e => e.event === "checkout", "amount", 1.25);
  } else if (browseDays >= 9) {
    dropEventsWhere(record, e => e.event === "checkout" && chance.bool({ likelihood: 30 }));
  }
  return record;
}
```

---

#### 4.7 Move Users Between Frequency Bins (Active Day Injection)

**Hook:** `everything` | **Atom:** [`injectOnNewDays`](lib/hook-helpers/inject.js)
**Mixpanel report:** Insights — Frequency Distribution (distinct-day buckets per user)

**In Mixpanel:** A "power user" cohort needs ≥7 distinct days of `commit
pushed` activity in the dataset window. Some users have the right total
count but cluster on 2-3 days; spread their activity across more days to
move them into the cohort.

```js
import { injectOnNewDays } from "@ak--47/dungeon-master/hook-helpers";
import { countDistinctPeriods } from "@ak--47/dungeon-master/verify";

if (type === "everything") {
  if (meta.profile?.tier !== "premium") return record;
  const days = countDistinctPeriods(record, "commit pushed", "day");
  if (days >= 7) return record;
  // Only premium users get the boost; spread commits across 7 distinct days.
  injectOnNewDays(record, "commit pushed", 7);
  return record;
}
```

**Why this works:** `scaleEventCount(record, "commit pushed", 3)` clones
events at sub-second offsets — they all land on the same calendar day, so
Mixpanel's frequency report shows no movement.
[`injectOnNewDays`](lib/hook-helpers/inject.js) finds days inside the
user's active window with no `commit pushed` activity and clones one event
onto each, advancing the user's distinct-day count by exactly the right
amount.

**Constraints:**
- Requires at least one `commit pushed` event already on the user (template).
- Injections respect the user's first-to-last event window — never extends it.
- Stripped `insert_id` so Mixpanel re-dedups on import.

---

### Experiments

#### 4.8 A/B/C Test with Variant-Specific Effects

**Hook:** `funnel-post` + `everything` | **Meta:** `meta.experiment`
**Mixpanel report:** Experiments — variant performance on downstream metric

```js
{
  sequence: ["Create Agenda", "Agenda Generated"],
  conversionRate: 60,
  experiment: {
    name: "Collaborative Agenda",
    variants: [
      { name: "Control" },
      { name: "Variant A", conversionMultiplier: 1.15, ttcMultiplier: 0.9 },
      { name: "Variant B", conversionMultiplier: 1.35, ttcMultiplier: 0.7 },
    ],
    startDaysBeforeEnd: 30,
  },
}
```

```js
if (type === "funnel-post" && meta.experiment?.variantName === "Variant B") {
  const last = record[record.length - 1];
  if (!last) return;
  const tpTemplate = record.find(e => e.event === "Add Talking Point") || last;
  record.push(cloneEvent(tpTemplate, {
    event: "Add Talking Point",
    time: dayjs(last.time).add(chance.integer({ min: 5, max: 30 }), "minutes").toISOString(),
    user_id: last.user_id,
    "Source": "AI Suggested",
  }));
}
```

---

### Cohort Effects

#### 4.9 Subscription Tier Stacking

**Hook:** `everything` | **Counting:** null-aware AVG (Section 2.3)
**Mixpanel report:** Insights — AVG of `reward_gold` broken down by `subscription_tier`

**In Mixpanel:** `quest turned in` AVG `reward_gold` broken down by
`subscription_tier` shows Premium at 1.4x, Elite at 1.8x vs Free.

```js
if (type === "everything") {
  const tier = meta.profile.subscription_tier;
  const multiplier = tier === "Elite" ? 1.8 : tier === "Premium" ? 1.4 : 1.0;
  if (multiplier !== 1.0) {
    scalePropertyValue(record, e => e.event === "quest turned in", "reward_gold", multiplier);
    scalePropertyValue(record, e => e.event === "quest turned in", "reward_xp", multiplier);
  }
  return record;
}
```

Null-aware AVG means events without a numeric `reward_gold` are silently
ignored — no need to fill defaults to keep the average sensible.

---

#### 4.10 Integration Users Succeed (Compound Cohort)

**Hook:** `everything`
**Mixpanel report:** Insights — AVG of `response_time_mins` broken down by behavioral cohort

```js
if (type === "everything") {
  let hasSlack = false, hasPagerduty = false;
  for (const e of record) {
    if (e.event !== "integration configured") continue;
    if (e.integration_type === "slack") hasSlack = true;
    if (e.integration_type === "pagerduty") hasPagerduty = true;
  }
  if (hasSlack && hasPagerduty) {
    scalePropertyValue(record, e => e.event === "alert acknowledged", "response_time_mins", 0.4);
    scalePropertyValue(record, e => e.event === "alert resolved", "resolution_time_mins", 0.5);
  }
  return record;
}
```

---

#### 4.11 Power User Behavioral Amplification

**Hook:** `everything`
**Mixpanel report:** Insights — Total events + AVG of `reward_gold` for behavioral cohort

```js
if (type === "everything") {
  const usedCompass = record.some(e => e.event === "use item" && e.item_type === "Ancient Compass");
  if (!usedCompass) return record;

  for (const e of record) {
    if (e.event !== "quest turned in") continue;
    e.reward_gold = Math.floor((e.reward_gold || 100) * 1.5);
    e.reward_xp = Math.floor((e.reward_xp || 500) * 1.5);
    if (chance.bool({ likelihood: 40 })) {
      record.push(cloneEvent(e, {
        time: dayjs(e.time).add(chance.integer({ min: 10, max: 120 }), "minutes").toISOString(),
        user_id: e.user_id,
        quest_id: chance.pickone(questIds),
      }));
    }
  }
  return record;
}
```

Cloned quest events at minute offsets land on the same day as the original
~95% of the time — fine for Insights `count of quests` reports, but won't
move users in a "distinct days with quest" frequency report. If that's the
verification target, add `injectOnNewDays(record, "quest turned in", N)`
after the main cloning loop.

---

### Operational Stories

#### 4.12 Night Deploy Failure Spike

**Hook:** `everything`
**Mixpanel report:** Insights — Total events filtered by `deploy_status='failed'`, broken down by hour-of-day

```js
if (type === "everything") {
  for (const e of record) {
    if (e.event !== "deployment completed") continue;
    const hour = new Date(e.time).getUTCHours();
    if ((hour >= 22 || hour < 6) && chance.bool({ likelihood: 40 })) {
      e.deploy_status = "failed";
    }
  }
  return record;
}
```

---

#### 4.13 Regional Error Injection

**Mixpanel report:** Insights — Total errors broken down by `Region`

See [4.4 Degradation and Recovery](#44-degradation-and-recovery) — the same
template with a profile-segment gate.

---

### Funnel Manipulation

#### 4.14 TTC by User Segment (Timestamp Shifting)

**Hook:** `everything` | **Counting:** greedy funnel TTC (Section 2.2)
**Mixpanel report:** Funnels — Time to Convert, broken down by user segment

**In Mixpanel:** Funnel median TTC, broken down by segment, shows Enterprise
completing 3x faster than Free.

```js
import { findFirstSequence, scaleFunnelTTC } from "@ak--47/dungeon-master/hook-helpers";

if (type === "everything") {
  const factor = meta.profile?.tier === "elite" ? 0.3
    : meta.profile?.tier === "free" ? 1.4
    : 1.0;
  if (factor === 1.0) return record;

  const seq = findFirstSequence(record, ["step_a", "step_b", "step_c"], 60 * 24 * 30);
  if (seq) scaleFunnelTTC(seq, factor);
  return record;
}
```

**Why timestamps and not properties:** Mixpanel's funnel TTC report uses the
greedy engine (Section 2.2) on event timestamps. A property like
`wait_time_hours` doesn't enter the calculation. To verify locally:

```js
import { evaluateFunnel } from "@ak--47/dungeon-master/verify";

const r = evaluateFunnel(userEvents, ["step_a", "step_b", "step_c"]);
console.log(r.completed, r.ttcMs);
```

**Greedy gotcha:** `findFirstSequence` finds an in-order sequence within the
max gap. If your sequence has multiple `step_a` events, only the first is
used. The greedy engine in Mixpanel picks the same first one, so behavior
matches.

**As a pattern (v1.6):** `applyTTCBySegmentV2` from
`@ak--47/dungeon-master/hook-patterns` packages this recipe — segment lookup,
`findFirstSequence`, `scaleFunnelTTC` — in one call. The older funnel-post
`applyTTCBySegment` is deprecated: it scales one run's internal gaps, which
only reaches the TTC report when that run is the user's first occurrence of
the steps.

**Conversion-window strict `<`:** If `step_c` lands at exactly `step_a + window`,
it is **excluded**. When shifting timestamps, leave at least 1ms of slack
under the conversion-window cap.

---

#### 4.15 Funnel Conversion by Profile

**Hook:** `funnel-pre` | **Meta:** `meta.profile`, `meta.funnel`
**Mixpanel report:** Funnels — conversion rate broken down by `plan_tier`

```js
if (type === "funnel-pre") {
  const isTargetFunnel = meta.funnel?.sequence?.includes("certificate earned");
  if (!isTargetFunnel) return;

  const tier = meta.profile?.plan_tier;
  if (tier === "enterprise" || tier === "business") {
    record.conversionRate = Math.min(95, record.conversionRate * 1.3);
  } else if (tier === "free") {
    record.conversionRate *= 0.7;
  }
}
```

---

### Event Injection

#### 4.16 Binge-Watching Pattern

**Hook:** `everything`
**Mixpanel report:** Insights — Total `playback completed` per user / Flows

```js
if (type === "everything") {
  let streak = 0, maxStreak = 0;
  for (const e of record) {
    if (e.event === "playback completed") { streak++; maxStreak = Math.max(maxStreak, streak); }
    else if (e.event !== "playback started") { streak = 0; }
  }
  if (maxStreak < 3) return record;

  dropEventsWhere(record, e => e.event === "playback paused" && chance.bool({ likelihood: 60 }));

  const startTemplate = record.find(e => e.event === "playback started");
  for (const e of record.filter(e => e.event === "playback completed")) {
    if (!chance.bool({ likelihood: 40 })) continue;
    const t = dayjs(e.time);
    if (startTemplate) {
      record.push(cloneEvent(startTemplate, {
        time: t.add(chance.integer({ min: 1, max: 5 }), "minutes").toISOString(),
        user_id: e.user_id,
        content_type: "series",
      }));
    }
    record.push(cloneEvent(e, {
      time: t.add(chance.integer({ min: 30, max: 90 }), "minutes").toISOString(),
      user_id: e.user_id,
    }));
  }
  return record;
}
```

---

#### 4.17 Contextual Event Injection

**Hook:** `everything`
**Mixpanel report:** Flows — preceding-path analysis for `Submit Feedback`

See [4.2 Feature Launch Inflection](#42-feature-launch-inflection) for the
full implementation. Key atom: `findFirstSequence(tail, [eventA, eventB],
maxGapMin)` returns the matched events or `null`.

---

### Cross-Event State

#### 4.18 Closure-Based State (Cost Overrun → Scale Down)

**Hook:** `event` | Module-level Map
**Mixpanel report:** Insights — `infrastructure scaled` broken down by `scale_direction`, sequenced after `cost report generated`

```js
const costOverrunUsers = new Map();

if (type === "event") {
  if (record.event === "cost report generated" && record.cost_change_percent > 25) {
    costOverrunUsers.set(record.user_id, true);
  }
  if (record.event === "infrastructure scaled" && costOverrunUsers.has(record.user_id)) {
    record.scale_direction = "down";
    costOverrunUsers.delete(record.user_id);
  }
}
```

---

#### 4.19 Failed Deploy Recovery

**Hook:** `event` | Module-level Map
**Mixpanel report:** Insights — AVG of `duration_sec` broken down by `status`, sequenced after a failed run

```js
const failedDeployUsers = new Map();

if (type === "event" && record.event === "deployment pipeline run") {
  if (record.status === "failed") {
    failedDeployUsers.set(record.user_id, true);
  } else if (record.status === "success" && failedDeployUsers.has(record.user_id)) {
    record.duration_sec = Math.floor((record.duration_sec || 300) * 1.5);
    failedDeployUsers.delete(record.user_id);
  }
}
```

---

### Profile Enrichment

#### 4.20 Segment-Based Profile Enrichment

**Hook:** `user`
**Mixpanel report:** Insights — User profile property AVG broken down by `company_size` (no event report — profile-only)

```js
if (type === "user") {
  const size = record.company_size;
  if (size === "enterprise") {
    record.seat_count = chance.integer({ min: 50, max: 500 });
    record.annual_contract_value = chance.integer({ min: 50000, max: 500000 });
    record.customer_success_manager = true;
  } else if (size === "startup") {
    record.seat_count = chance.integer({ min: 1, max: 5 });
    record.annual_contract_value = chance.integer({ min: 0, max: 3600 });
    record.customer_success_manager = false;
  }
}
```

---

### Churn and Retention

#### 4.21 Hash-Based Churn Silencing

**Hook:** `everything`
**Mixpanel report:** Retention / Insights — surviving event count broken down by hash-derived cohort

```js
import { hashCohort } from "@ak--47/dungeon-master/hook-helpers";

if (type === "everything") {
  const uid = record[0]?.user_id || record[0]?.device_id || "";
  // hashCohort = FNV-1a over the FULL id (v1.6). Don't hand-roll char-code
  // arithmetic — id alphabets don't cover charcode space uniformly, so
  // `% N` idioms silently miss their target rate (see §5, hashFloat).
  if (!hashCohort(uid, 20)) return record; // ~20% of users churn-silenced

  const cutoff = dayjs.unix(meta.datasetStart).add(30, "days");
  dropEventsWhere(record, e => dayjs(e.time).isAfter(cutoff));
  return record;
}
```

---

#### 4.22 Retention Magic Number (N Distinct Days in First X Days)

**Hook:** `everything` | **Meta:** `meta.userIsBornInDataset` |
**Mixpanel report:** Retention — N+1 day retention by cohort
**Counting:** distinct days (Section 2.1)

**In Mixpanel:** Born-in-dataset users with **5+ distinct days** of `user
followed` activity in their first 14 days retain ~2x better past day 36 than
users below the threshold.

```js
import { countDistinctPeriods } from "@ak--47/dungeon-master/verify";

if (type === "everything") {
  if (!meta.userIsBornInDataset) return record;
  const firstEventTime = record[0]?.time;
  if (!firstEventTime) return record;

  const userStart = dayjs(firstEventTime);
  const windowEndMs = userStart.add(14, "days").valueOf();
  const startMs = userStart.valueOf();
  // Slice to the user's first 14 days.
  const firstWindow = record.filter(e => {
    const t = dayjs(e.time).valueOf();
    return t >= startMs && t < windowEndMs;
  });
  const followDays = countDistinctPeriods(firstWindow, "user followed", "day");

  if (followDays < 5) {
    const cutoff = userStart.add(36, "days");
    dropEventsWhere(record, e => dayjs(e.time).isAfter(cutoff));
  }
  return record;
}
```

**Why distinct days:** A user who logged 50 follows in a single sitting and
nothing else is **not** the "engaged" cohort. Mixpanel's retention reports
backed by behavioral cohorts use distinct-day filters to capture sustained
engagement, not single-session bursts.

**Calibration:** With `user followed` at weight 5 of ~84 total weight and
~5 events/user/day, expect ~0.3 follows/day → ~4.2 follows in 14 days.
If most follow events cluster on the same days, distinct-day count is even
lower. Set the threshold by running the actual distribution (Principle 18)
for distinct days, not total events.

---

#### 4.23 Deprecated Feature Replacement

**Hook:** `user` + `everything`
**Mixpanel report:** Varies by use — same report the deprecated feature targeted (typically Insights breakdown by `subscription_tier`)

```js
import { hashFloat } from "@ak--47/dungeon-master/hook-helpers";

if (type === "user") {
  const h = hashFloat(record.distinct_id); // FNV-1a full-string → [0,1)
  record.subscription_tier = h < 0.6 ? "free" : h < 0.8 ? "monthly" : "annual";
}

if (type === "everything") {
  const tier = meta.profile.subscription_tier;
  if (tier === "annual") {
    for (const e of record) {
      if (e.event === "feature used") e.feature_limit = 999;
    }
  }
}
```

---

#### 4.24 Post-Clone Temporal Mutation

**Hook:** `everything` (must run LAST)
**Mixpanel report:** Insights — AVG of `offer_price` over time, expecting consistent within-window value

```js
// Run all cloning hooks first, THEN apply window mutation:
for (const e of record) {
  if (e.event !== "offer submitted") continue;
  const t = dayjs(e.time);
  if (t.isAfter(springStart) && t.isBefore(springEnd)) {
    e.offer_price = Math.floor((e.offer_price || 400000) * 2.5);
  }
}
return record;
```

---

### Attribution

#### 4.25 First-Touch Attribution Bias

**Hook:** `everything` | **Counting:** first-touch is uncapped (Section 2.4)
**Mixpanel report:** Attribution — Conversions by Source (first-touch model)

**In Mixpanel:** `Convert` events broken down by first-touch `Touch.source`
show Google >> Facebook >> Twitter (10:5:1 weights).

```js
import { weighArray } from "@ak--47/dungeon-master/utils";

if (type === "everything") {
  const conversion = record.find(e => e.event === "Convert");
  if (!conversion) return record;
  const convTime = dayjs(conversion.time).valueOf();
  const sources = weighArray(["google", "facebook", "twitter"], [10, 5, 1]);
  const touches = record.filter(e => e.event === "Touch" && dayjs(e.time).valueOf() <= convTime);
  if (touches.length === 0) return record;
  // First-touch reads the CHRONOLOGICALLY FIRST touch before conversion —
  // no cap (whoval/read.cpp LIMIT 1). Bias exactly that one.
  const sorted = touches.slice().sort((a, b) => dayjs(a.time).valueOf() - dayjs(b.time).valueOf());
  sorted[0].source = chance.pickone(sources);
  return record;
}
```

**Where the 10-cap DOES apply:** only multi-touch models (linear /
participation / time-decay) consider just the last `TOUCHPOINTS_LIMIT = 10`
touches. First/last-touch read the true first/most-recent touch however
many exist. Sparse touches are still good practice — they keep the data
legible — but they're realism, not a correctness requirement.

**v1.5 with `hasCampaigns: true`:** when the engine has already stamped UTMs
on up to `maxTouchpointsPerUser` events per user (default 10), DO NOT stamp
fresh touches in your hook — a fresh stamp earlier than the engine's first
would silently become the first-touch winner. Use
[Recipe 4.26](#426-bias-engine-stamped-touches-v15) to OVERWRITE the
engine's `utm_source` on the existing stamped events instead. See
[§2.4](#24-attribution-firstlast-touch-are-uncapped-only-multi-touch-caps-at-10).

---

#### 4.26 Bias Engine-Stamped Touches (v1.5)

**Hook:** `everything` | **Counting:** `maxTouchpointsPerUser` (default 10)
**Mixpanel report:** Attribution — Conversions by `utm_source` (first-touch + last-touch models)

**In Mixpanel:** First-touch attribution shows your campaign sources weighted
toward "google" without changing total touch count.

In v1.5, the engine stamps UTMs on up to `maxTouchpointsPerUser` events per
user (default 10), sampled across the user's lifetime. Hooks bias attribution
by OVERWRITING engine-stamped values rather than stamping new touches.

```js
import { weighArray } from "@ak--47/dungeon-master/utils";

if (type === "everything") {
  // Find events the engine already stamped with a campaign.
  const stamped = record
    .filter(e => e.utm_source != null)
    .sort((a, b) => dayjs(a.time).valueOf() - dayjs(b.time).valueOf());
  if (stamped.length === 0) return record;
  // Bias the FIRST stamped touch (Mixpanel's first-touch model picks this).
  const sources = weighArray(["google", "facebook", "twitter"], [10, 5, 1]);
  stamped[0].utm_source = chance.pickone(sources);
  // Optional: also bias the LAST stamped touch for last-touch attribution.
  if (stamped.length > 1) stamped[stamped.length - 1].utm_source = chance.pickone(sources);
  return record;
}
```

**Why this works under v1.5:** the engine has already capped + sampled the
touches, so the stamped set IS the touch set attribution reads. Stamping
fresh touches from scratch would change that set — an earlier fresh stamp
becomes the new first-touch winner (first/last-touch are uncapped, §2.4) —
invisibly to whatever derivation your bands came from. Overwriting is
correct.

**As a pattern (v1.6):** `applyAttributedBySource` from
`@ak--47/dungeon-master/hook-patterns` packages this recipe:
`applyAttributedBySource(record, null, { weights: { google: 10, facebook: 5,
twitter: 1 }, model: 'firstTouch' })` overwrites the first engine-stamped
touch with a seeded weighted pick (models: `firstTouch`, `lastTouch`,
`both`). It never stamps unstamped events, so total touch count is
unchanged.

---

#### 4.27 Active-Day Cohort Engineering (v1.5)

**Hook:** `everything` | **Counting:** distinct calendar days (Section 2.1)
**Mixpanel report:** Insights — Frequency Distribution; cohort-conditional active-day boost

**In Mixpanel:** 10% of users land in a "power user" cohort with ≥10 distinct
days of activity, while the rest stay at the dataset baseline.

Use `Dungeon.avgActiveDaysPerUser` for the BASELINE distribution, then write
a cohort-conditional `everything` hook that uses `injectOnNewDays` to push
specific users above the baseline.

```js
import { injectOnNewDays, hashCohort } from "@ak--47/dungeon-master/hook-helpers";
import { countDistinctPeriods } from "@ak--47/dungeon-master/verify";

// Config:
//   avgActiveDaysPerUser: 5      // baseline: most users active ~5 days
//   events: [{ event: "open app", weight: 5 }, ...]

if (type === "everything") {
  // Hash-based cohort (deterministic, ~10% of users — FNV-1a full-string).
  const uid = record[0]?.user_id || "";
  if (!hashCohort(uid, 10)) return record;

  const days = countDistinctPeriods(record, "open app", "day");
  if (days >= 10) return record;
  // Boost: spread events across more days inside the user's active window.
  injectOnNewDays(record, "open app", 10);
  return record;
}
```

**Why two layers:** the config knob keeps the dungeon's distribution sane.
The hook engineers a SPECIFIC cohort above baseline. If you tried to use the
hook ALONE for the global shape, you'd reinvent the engine's day-picking and
fight its scheduling.

---

#### 4.28 Conversion-Window-Aware TTC Scaling (v1.5)

**Hook:** `funnel-pre` | **Meta:** `meta.funnel`
**Mixpanel report:** Funnels — Time to Convert by user segment, respecting `conversionWindowDays`

**In Mixpanel:** Funnel TTC for Enterprise users is 2x faster than Free, but
the scaling factor must respect the funnel's `conversionWindowDays` cap so
shifted timestamps don't fall outside the window (where Mixpanel's strict-`<`
rule excludes them).

```js
if (type === "funnel-pre") {
  const tier = meta.profile?.tier || "free";
  const baseFactor = tier === "enterprise" ? 0.5 : tier === "free" ? 1.4 : 1.0;
  if (baseFactor === 1.0) return;

  // Read the funnel's conversion window (auto-applied by validator, default 30d).
  const windowDays = meta.funnel?.conversionWindowDays || 30;
  const ttcDays = (meta.funnel?.timeToConvert || 24) / 24;
  // Clamp factor so scaled TTC stays at most 90% of the window — leaves slack
  // for the strict-< boundary AND for engine-side per-step jitter.
  const maxSafeFactor = (windowDays * 0.9) / ttcDays;
  const factor = baseFactor < 1.0
    ? baseFactor                          // shorter is always safe
    : Math.min(baseFactor, maxSafeFactor); // longer must respect the window

  meta.funnel.timeToConvert *= factor;
}
```

**Why clamp:** A 1.4× factor on a `timeToConvert: 720h` (30d) funnel pushes
the last step past 30d. Mixpanel's `is_within_conversion_window` is strict
`<`, so step C at exactly window-boundary gets excluded — funnel completion
silently drops. Always read `meta.funnel.conversionWindowDays` and bound
your factor.

---

#### 4.29 Lifecycle Wave — Dormancy + Resurrection (v1.6)

**Hook:** `everything`
**Mixpanel report:** Lifecycle — Resurrected users spike after the dormancy window (Section 2.16)

**In Mixpanel:** ~15% of users go dormant for two full weeks starting a week
after signup, then resurrect with a burst of value-moment activity.

```js
import { applyLifecycleWave, hashCohort } from "@ak--47/dungeon-master/hook-helpers";

if (type === "everything") {
  const uid = record[0]?.user_id || "";
  if (!hashCohort(uid, 15)) return record;
  // Sweep [birth+7d, birth+21d] clean of value moments, then clone a
  // 4-event resurrection burst 1-3h after the window.
  return applyLifecycleWave(record, uid, {
    dormantFromDay: 7,
    dormantDays: 14,
    resurrectBurst: 4,
    valueMomentEvent: "complete workout",
  });
}
```

**Why the atom sweeps the whole window:** lifecycle "dormant" is an
`EqualTo 0` filter per period — ONE stray value moment inside the window
reclassifies the user and the Resurrected spike vanishes. The atom filters
by timestamp over the array as passed, so events injected by EARLIER hook
logic in the same pass get swept too. Size `dormantDays` to ≥ 2 lifecycle
periods (2 weeks for weekly charts) so period tiling can't clip the gap, and
keep the window inside the user's lifespan (clones past the dataset end are
dropped by the future-time guard). `dropAll: true` silences the user
completely for the window — use it when the lifecycle chart counts a broad
event set rather than one value moment.

---

#### 4.30 Flows Path Share — Biased Branch After an Anchor (v1.6)

**Hook:** `everything`
**Mixpanel report:** Flows — top paths after the anchor event show the engineered branch (Section 2.17)

**In Mixpanel:** ~30% of users who view an item proceed straight down
`add to cart → begin checkout`, making it the dominant Sankey branch.

```js
import { applyPathBias } from "@ak--47/dungeon-master/hook-helpers";

if (type === "everything") {
  const uid = record[0]?.user_id || "";
  return applyPathBias(record, uid, {
    anchor: "view item",
    path: ["add to cart", "begin checkout"],
    share: 0.30,                    // FRACTION [0,1] — the atom hashes uid itself
    gapSeconds: [2, 30],
  });
}
```

**Why the constraints exist:** Flows' unique mode reads only the FIRST flow
per user, so the atom anchors on the first `anchor` occurrence; gaps are
clamped ≥1s because sub-second jitter scrambles Sankey step order; and the
branch needs roughly ≥20-25% share to survive top-3-per-level pruning —
don't engineer a 5% path and expect to see it. Users missing a source event
for ANY step are skipped entirely (a partial path would pollute the share);
verify the effective share with `extractFlows`/`aggregateFlows` rather than
assuming `share` landed.

---

#### 4.31 Session Shape — Deterministic Cadence (v1.6)

**Hook:** `everything`
**Mixpanel report:** Insights — sessions per user per week / events per session (Section 2.13)

**In Mixpanel:** A "focused" cohort shows exactly ~3 tight sessions per week
of ~5 events each, against a diffuse baseline.

```js
import { applySessionShape, hashCohort } from "@ak--47/dungeon-master/hook-helpers";

if (type === "everything") {
  const uid = record[0]?.user_id || "";
  if (!hashCohort(uid, 20)) return record;   // cohort gating is the caller's job
  return applySessionShape(record, uid, {
    sessionsPerWeek: 3,
    eventsPerSession: 5,
    sessionMinutes: 25,
  });
}
```

**Why it's safe in v1.6:** the engine re-derives `session_id` on the FINAL
event set (after the `everything` hook), so wholesale timestamp rewrites no
longer leave stale session labels. The atom keeps intra-session gaps well
under the 30-min timeout (spacing capped at 20min + bounded jitter), keeps
inter-session gaps well over it, and never crosses UTC midnight inside one
engineered session (the day-boundary split would cut it). Retiming only — no
events are added or dropped, so total counts and event mixes are untouched.
Session count follows `min(sessionsPerWeek × weeks, ceil(N /
eventsPerSession))`: scarce users get fewer sessions, not fabricated events.

---

## 5. Phase 3 Atom Reference

Import from `@ak--47/dungeon-master/hook-helpers`:

| Atom | Module | Signature | Purpose |
|---|---|---|---|
| `binUsersByEventCount` | cohort | `(events, eventName, bins) -> string\|null` | Classify by **total event count** (use for Insights "events per user") |
| `binUsersByEventInRange` | cohort | `(events, eventName, start, end, bins) -> string\|null` | Same, restricted to a time range |
| `countEventsBetween` | cohort | `(events, eventA, eventB) -> number` | Count events between first A and first B |
| `userInProfileSegment` | cohort | `(profile, key, values) -> boolean` | Profile property match |
| **`hashFloat`** | cohort | `(id) -> number` | FNV-1a over the FULL id string → [0,1). Deterministic bucketing primitive (v1.6) — replaces `charCodeAt(0) % N` idioms, which bias cohort rates on hex-ish id alphabets |
| **`hashCohort`** | cohort | `(id, pct) -> boolean` | True for ~`pct`% of ids (pct on a 0–100 scale). Membership nests: `pct=5` ⊂ `pct=20` |
| `cloneEvent` | mutate | `(template, overrides?) -> event` | Shallow clone with overrides |
| `dropEventsWhere` | mutate | `(events, predicate) -> number` | Remove matching events in-place |
| `scaleEventCount` | mutate | `(events, eventName, factor) -> number` | Scale total count via clones at sub-second offsets (does NOT move frequency-distribution bins — see Section 2.1) |
| `scalePropertyValue` | mutate | `(events, predicate, prop, factor) -> number` | Multiply numeric property; null-aware safe |
| `shiftEventTime` | mutate | `(event, deltaMs) -> event` | Shift one timestamp |
| `scaleTimingBetween` | timing | `(events, eventA, eventB, factor) -> boolean` | Scale gap between first A and first B |
| `scaleFunnelTTC` | timing | `(funnelEvents, factor) -> number` | Scale offsets from funnel's first event |
| `findFirstSequence` | timing | `(events, names[], maxGapMin) -> events[]\|null` | Detect ordered sequence |
| `injectAfterEvent` | inject | `(events, source, template, gapMs, overrides?) -> event` | Splice clone after a specific event |
| `injectBetween` | inject | `(events, eventA, eventB, template, overrides?) -> event` | Splice clone at midpoint of A→B gap |
| `injectBurst` | inject | `(events, template, count, anchor, spreadMs, overrides?) -> events[]` | Inject N clones around an anchor |
| **`injectOnNewDays`** | inject | `(events, eventName, targetDays, options?) -> events[]` | Inject clones on previously empty days within active window — **the right tool for moving frequency-distribution bins** |
| `isPreAuthEvent` | identity | `(event, authTime) -> boolean` | Check if before user's stitch |
| `splitByAuth` | identity | `(events, authTime) -> { preAuth, postAuth, stitch }` | Partition by auth boundary |
| **`applyLifecycleWave`** | shape | `(events, uid, { dormantFromDay, dormantDays, resurrectBurst?, valueMomentEvent, dropAll? }) -> events[]` | Clean dormancy gap + resurrection burst; sweeps the ENTIRE window by timestamp (v1.6, recipe 4.29). Returns a NEW array |
| **`applyPathBias`** | shape | `(events, uid, { anchor, path, share, gapSeconds? }) -> events[]` | Inject a Flows path after the user's first anchor for ~`share` (fraction) of users; skips users missing any step template (v1.6, recipe 4.30) |
| **`applySessionShape`** | shape | `(events, uid, { sessionsPerWeek, eventsPerSession, sessionMinutes }) -> events[]` | Retime the stream into deterministic session clusters — intra-gaps ≪ 30min, inter-gaps ≫ 30min, never crosses UTC midnight (v1.6, recipe 4.31) |

**Inject atoms + v1.5:** the engine auto-sorts events by time after the
`everything` hook (`autoSortAfterEverything: true` default — see Principle
26). Hooks using `injectBetween` / `injectBurst` / `injectAfterEvent` /
`injectOnNewDays` no longer need a trailing `record.sort(...)` to keep the
greedy funnel engine happy.

Full JSDoc in [`lib/hook-helpers/*.js`](lib/hook-helpers/).

---

## 6. Verification Helpers

Import from `@ak--47/dungeon-master/verify`:

| Function | Purpose | Mixpanel Reference |
|---|---|---|
| `emulateBreakdown(events, config)` | Run the table-shape emulator; `config.type` selects one of 12 analyses (`frequencyByFrequency`, `funnelFrequency`, `aggregatePerUser`, `timeToConvert`, `attributedBy`, `sessionMetrics`, `retention`, `distinctCount`, `eventBreakdown`, `uniques`, `lifecycle`, `topPaths` — `topPaths` returns an object, the rest return row arrays) | Insights / Funnels / Retention / Flows |
| `verifyDungeon(dungeonConfig, assertions)` | High-level wrapper: run dungeon + run assertions | n/a |
| `evaluateFunnel(events, steps, options?)` | Greedy single-pass funnel state machine | `history.cpp` |
| `evaluateFunnelHPC(events, steps, holdProperty, options?)` | Hold-property-constant parallel sub-funnels (also routed via `funnelFrequency` + `holdPropertyConstant`) | `funnel_query.cpp` |
| `timestampComesAfter(t1, t2, grace?)` | 2-second grace window check | `history.cpp` |
| `withinConversionWindow(eventTime, step0Time, windowMs)` | Strict `<` window check | `conversion_window.cpp` |
| `countDistinctPeriods(events, eventName, unit?, options?)` | Distinct-period count (default `'ui-bucket'` calendar math; `{algorithm: 'mixpanel-rolling'}` for the C++ rolling counter; unknown names throw) | `addiction_query.cpp` |
| `frequencyHistogram(events, { event, unit, intervalDays, profiles? })` | Full Frequency-report shape: per-interval histogram of users by rolling-counter value | `addiction_query.cpp` |
| `countEvents(events, eventName?, where?)` | Total event count with optional name/property filter | `normal_query.cpp` |
| `countDistinctValues(events, property, options?)` | Distinct property-value count | `normal_query.cpp` |
| `nullAwareAvg(values, options?)` / `nullAwareSum(values, options?)` | AVG/SUM that skip non-numeric; `{ flatten: true }` explodes list values one level | `normal_query.cpp` |
| `nullAwareExtreme(values, mode)` | MIN/MAX that skip non-numeric | `normal_query.cpp` |
| `binByDistinctPeriods(events, eventName, bins, unit?)` | Distinct-period cohort assignment | `addiction_query.cpp` |
| `partitionByTimeBucket(events, unit, range?)` | Split a stream into day/week/month buckets (week = ISO Monday) | `normal_query.cpp` |
| `evaluateFormula(expr, series)` | API-layer formula math: PEMDAS, zero-fill broadcast, div-by-zero → 0 | `formula/util.py` |
| `filterFirstTimeEver(events, { event, preWhere?, postWhere? })` | Two-query first-time-ever rewrite (§2.15) | `event_selector.py` |
| `sessionize(events, options?)` / `sessionOrdinals(events, options?)` | Query-time session derivation (30-min gap, 24h max) | `session_query.cpp` |
| `extractFlows(events, options)` / `aggregateFlows(flows, options?)` | Per-user flow extraction + Top Paths tree (`UNCOMMON_FLOWS_EVENT` = coalesced-node label) | `flows_query.cpp` |
| `buildIdentityMap(profiles)` / `resolveUserId(event, identityMap?)` | device_id → canonical-id identity merge | n/a |
| `deriveExpectedSchema(config)` / `validateSchema(events, schema)` | Schema integrity checks | n/a |

Full JSDoc in [`lib/verify/*.js`](lib/verify/).

---

## 7. Phase 4 Pattern Reference

Import from `@ak--47/dungeon-master/hook-patterns`:

| Pattern | Hook Type | Signature | Mixpanel Report |
|---|---|---|---|
| `applyFrequencyByFrequency` | everything | `(events, profile, { cohortEvent, bins, targetEvent, multipliers, binBy? })` | Frequency of A by per-user frequency of B |
| `applyFunnelFrequencyBreakdown` | funnel-post | `(allEvents, profile, funnelEvents, { cohortEvent, bins, dropMultipliers, binBy? })` | Funnel conversion by per-user activity bucket |
| `applyAggregateByBin` | everything | `(events, profile, { cohortEvent, bins, event, propertyName, deltas, binBy? })` | Avg property value by per-user activity bucket |
| `applyTTCBySegmentV2` | everything | `(events, profile, { segmentKey, factors, steps, maxGapMinutes? })` | Funnel TTC by profile segment (greedy first sequence — recipe 4.14 as code, v1.6) |
| `applyTTCBySegment` | funnel-post | `(funnelEvents, profile, { segmentKey, factors })` | **Deprecated (v1.6)** — scales one run's gaps; only reaches Mixpanel TTC for `isFirstFunnel` runs. Use V2. |
| `applyAttributedBySource` | everything | `(events, profile, { weights, property?, model? })` | Conversions by source — overwrites engine-stamped touches (recipe 4.26 as code, rewritten v1.6) |

> **Bin axis (v1.6).** The three `*ByBin` / `*Frequency*` patterns bin by
> **distinct calendar days** of `cohortEvent` by default
> (`binBy: 'distinctDays'`, via `binByDistinctPeriods`) — the same axis the
> verification emulator and Mixpanel's frequency reports use, so pattern
> cohorts and report buckets align. Pass `binBy: 'events'` to restore the
> pre-1.6 total-event-count axis (needed for
> `applyFunnelFrequencyBreakdown`'s funnelEvents fallback, where a single
> funnel run rarely spans more than one day).

Full JSDoc in [`lib/hook-patterns/*.js`](lib/hook-patterns/). Pair with
`emulateBreakdown` from `@ak--47/dungeon-master/verify` to assert patterns
in CI.

---

## 8. v1.5.0 Verification Recipes

Verifier primitives added in v1.5.0. All accept the same `emulateBreakdown`
options shape, with `type` selecting the analysis. Pass `profiles` on any
type to enable identity merge (pre-auth `device_id` events resolve to the
same canonical user as post-auth `user_id` events).

### 8.1 Retention curves

```js
import { emulateBreakdown } from '@ak--47/dungeon-master/verify';

const rows = emulateBreakdown(events, {
  type: 'retention',
  cohortEvent: 'Sign Up',
  returnEvent: 'Login',
  dayBuckets: [0, 1, 7, 14, 30],   // bucket 0 = within 24h of birth
  segmentBy: 'plan',               // optional — segment by birth event prop
  carry_forward: false,            // optional — monotonically non-decreasing
  birthCanRetain: false,           // optional — count returns AT birth ms (default false)
  profiles,                        // optional — auto-builds identity map
});
// → [{ day, retained_count, cohort_size, retained_pct, segment }, ...]
```

**In Mixpanel:** Retention report with cohort = "did Sign Up", return =
"did Login". Buckets use ms-delta from birth, NOT calendar-day differences
(see §2.7) — a return 23h after birth = bucket 0, 25h = bucket 1.

### 8.2 Session metrics

```js
const rows = emulateBreakdown(events, {
  type: 'sessionMetrics',
  event: 'Page View',                // optional — only sessions containing this event
  metrics: ['count', 'duration', 'eventsPerSession'],
  source: 'derived',                 // default — sessions re-derived from timestamps
  sessionTimeoutMs: 30 * 60_000,     // optional — gap trigger (strict >)
});
// → [{ metric, avg, median, p90, total_sessions, source, stampedDivergence }, ...]
```

`source: 'derived'` (default since v1.6.0) re-derives sessions from raw
timestamps the way `session_query.cpp` does — pre-stamped `session_id`s are
ignored. `source: 'stamped'` keeps the v1.5 group-by-`(user, session_id)`
behavior. Either way, when events carry stamps, every row reports
`stampedDivergence`: the number of consecutive stamped-event pairs whose
stamped session boundary disagrees with the derived one (0 means the
generator's stamping matches what Mixpanel will compute).

**Session duration / depth metrics need no special type.** `sessionize()`
returns `syntheticEvents` — `$session_start`/`$session_end` pairs carrying
`$duration_s` and `$event_count` as plain numeric properties (plus
`$origin_start`/`$origin_end` and the copy props). Aggregate them with the
existing types, exactly like Mixpanel aggregates session properties:

```js
import { sessionize, emulateBreakdown } from '@ak--47/dungeon-master/verify';

const { syntheticEvents } = sessionize(events);
// Avg session duration per user, cohorted by # active session days
// (Insights: AGGREGATE $duration_s on $session_end):
emulateBreakdown(syntheticEvents, {
  type: 'aggregatePerUser', event: '$session_end', property: '$duration_s',
  agg: 'avg', breakdownByFrequencyOf: '$session_start',
});
// Session-depth distribution (Insights: $session_end segmented by $event_count):
emulateBreakdown(syntheticEvents, {
  type: 'eventBreakdown', event: '$session_end', breakdownProperty: '$event_count',
});
```

For plain duration averages without a cohort axis, `sessionMetrics`'s
`duration` row (avg/median/p90) is the direct path.

Synthetic session events live OUTSIDE the regular event-name namespace
(`libquery/event/filter.h`) — name filters and "all events" over raw events
never match them, which is why `sessionize` returns them as a separate array
you feed in explicitly.

If you need to verify session-scoped funnels (steps must land in same
session), pass `sessionScoped: true` to `evaluateFunnel`, or use the
Mixpanel-faithful session count window
(`conversionWindow: { unit: 'sessions', n: 1 }`).

### 8.3 Funnel reentry (counting repeat completions)

```js
import { evaluateFunnel } from '@ak--47/dungeon-master/verify';

// Per-user totals: how many times did this user complete the funnel?
const r = evaluateFunnel(userEvents, ['Sign Up', 'Activate'], {
  reentry: true,
  countMode: 'totals',  // returns FunnelResult[] (one per completion)
});
console.log(r.length);  // e.g. 3 completions
```

For dungeon-level verification, set `Funnel.reentry: true` — the verifier
auto-applies it in `funnelFrequency` / `timeToConvert` when matching the
funnel.

### 8.4 Exclusion step patterns

```js
// Direct API
const r = evaluateFunnel(events, ['Sign Up', 'Activate'], {
  exclusionSteps: [{ event: 'Bounce', afterStep: 1, beforeStep: 2 }],
});
```

For dungeon-level wiring: declare exclusion events in `events[]` (schema-first),
then add them to the funnel:

```js
{
  events: [
    { event: 'land', isFirstEvent: true },
    { event: 'sign_up' },
    { event: 'rage_click' },                     // declared
  ],
  funnels: [
    { sequence: ['land', 'sign_up'],
      conversionRate: 30,
      exclusionEvents: ['rage_click'] },         // generator + verifier
  ],
}
```

The generator stamps 1-2 cloned `rage_click` events on non-converters; the
verifier reads `funnel.exclusionEvents` and applies them as exclusion steps
when emulating the funnel.

### 8.5 Hold Property Constant (HPC) patterns

```js
import { evaluateFunnelHPC } from '@ak--47/dungeon-master/verify';

// One sub-funnel per unique value of `plan` on the step-0 event.
const map = evaluateFunnelHPC(userEvents, ['Add to Bag', 'Checkout'], 'plan');
console.log(map.get('pro').completed);   // pro user completed
console.log(map.get('free').completed);  // free user did not (independent)
```

Since v1.6, passing `holdPropertyConstant: 'plan'` to the `funnelFrequency`
emulator routes through the HPC engine and reports per-held-value sub-funnel
rows. `evaluateFunnelHPC` remains available directly for bespoke assertions
inside a `verifyDungeon` check's `assert` callback.

### 8.6 Step-level filter patterns

```js
const r = evaluateFunnel(events, [
  { event: 'View Pricing' },
  { event: 'Sign Up', where: { prop: 'plan', op: 'eq', value: 'pro' } },
], { conversionWindowMs: 30 * 86400_000 });
```

For dungeon-level wiring: set `Funnel.stepFilters` (verifier-only hint):

```js
{
  funnels: [{
    sequence: ['View Pricing', 'Sign Up'],
    stepFilters: { 1: { prop: 'plan', op: 'eq', value: 'pro' } },
  }],
}
```

The verifier auto-applies the filter to the matching step at index 1.

### 8.7 Time-series verification (timeBucket)

```js
const rows = emulateBreakdown(events, {
  type: 'frequencyByFrequency',
  metricEvent: 'Purchase',
  breakdownByFrequencyOf: 'Browse',
  timeBucket: 'week',         // 'day' | 'week' | 'month'
});
// → [{ period: '2024-W01', metric_freq, breakdown_freq, user_count }, ...]
```

Cross-cutting on every breakdown type. Period labels: `YYYY-MM-DD` (day),
`YYYY-Www` (ISO Monday-anchored week), `YYYY-MM` (month).

**Empty-bucket backfill (Mixpanel parity):** Mixpanel's `normal_query.cpp`
emits zero rows for empty intervals on its trend axis. Pass
`timeBucketRange: { from, to }` to enumerate every bucket in the range and
emit `{ period, _empty: true }` markers for buckets with no events:

```js
emulateBreakdown(events, {
  type: 'frequencyByFrequency',
  metricEvent: 'Purchase',
  breakdownByFrequencyOf: 'Browse',
  timeBucket: 'day',
  timeBucketRange: { from: '2024-01-01', to: '2024-01-31' },
});
// → 31 rows, one per day. Days with no data: { period, _empty: true }.
```

**Documented divergence:** verifier uses UTC; Mixpanel uses qtz. For non-UTC
accounts, day/week/month boundaries shift by hours.

### 8.8 Identity-aware verification

For dungeons using `avgDevicePerUser > 0` or `hasAnonIds: true`, ALWAYS
pass `profiles` so the verifier resolves pre-auth `device_id` events to the
same canonical user as post-auth `user_id` events. Without it, pre-auth
events bucket as separate "users" — funnel completion drops, retention
deflates, attribution mis-routes.

```js
const rows = emulateBreakdown(events, {
  type: 'funnelFrequency',
  steps: ['visit_landing', 'sign_up', 'first_action'],
  breakdownByFrequencyOf: 'visit_landing',
  profiles,   // auto-builds identityMap from profile.device_ids/anonymousIds
});
```

You can also pre-build the map and reuse:

```js
import { buildIdentityMap } from '@ak--47/dungeon-master/verify';
const identityMap = buildIdentityMap(profiles);
emulateBreakdown(events, { type: 'retention', cohortEvent: 'Sign Up',
                          returnEvent: 'Login', dayBuckets: [7],
                          identityMap });
```

---

## 9. Verification Patterns from the v1.5.0 Vertical Eval

20-dungeon eval surfaced patterns where naive verification inverts. Apply
these recipes when writing per-dungeon verify scripts under
`dungeons/vertical/<name>/`.

**Proof in repo:** `dungeons/vertical/<dungeon>/<dungeon>.{verify.mjs,sql}` —
20 dungeons, 107 documented hooks, 107 verification checks. Each
`<dungeon>.verify.mjs` is a CI-runnable assertion that the dungeon's
engineered story patterns appear in full-fidelity generated data.

### 9.1 Stream-load shards (>500MB)

`fs.readFileSync` caps at ~512MB. For dungeons that produce sharded output
(`data/PREFIX-EVENTS-part-*.json`) or single shards above the cap, stream:

```js
import fs from 'fs';
import path from 'path';
import readline from 'readline';

async function loadShards(prefix, suffix) {
  const dir = path.dirname(prefix), base = path.basename(prefix);
  const out = [];
  for (const f of fs.readdirSync(dir)
    .filter(f => f.startsWith(`${base}-${suffix}`) && f.endsWith('.json'))
    .sort()) {
    const stream = fs.createReadStream(path.join(dir, f));
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) if (line.trim()) out.push(JSON.parse(line));
  }
  return out;
}
const events = await loadShards('data/verify-mydungeon', 'EVENTS');
const profiles = await loadShards('data/verify-mydungeon', 'USERS');
```

Works for both single-shard (`...EVENTS.json`) and glob output
(`...EVENTS-part-001.json`).

### 9.2 Per-user post/pre ratio (population dilution)

Cohorts that themselves bias event volume break absolute-count comparisons.
Example: low-balance users check their balance constantly — a hook that
reduces post-d30 activity 50% still leaves them with MORE absolute events
than high-balance users.

```js
const ratios = [];
for (const [uid, evs] of byUser) {
  const pre = evs.filter(e => new Date(e.time).getTime() < day30).length;
  const post = evs.filter(e => new Date(e.time).getTime() >= day30).length;
  if (pre > 0) ratios.push(post / pre);
}
const avg = a => a.reduce((s, v) => s + v, 0) / a.length;
// Cohort A vs cohort B: compare avg(ratiosA) vs avg(ratiosB), not raw post counts
```

### 9.3 Neighbor-day baseline (born-ramp confound)

Born-in-dataset users plus pre-existing-spread make late-window days denser
on average. Comparing a 5-day window against the full-dataset average can
invert the signal. Compare against adjacent days only:

```js
const inWindow = (e, lo, hi) => {
  const t = new Date(e.time).getTime();
  return t >= ds + lo * 86400000 && t < ds + hi * 86400000;
};
const target = events.filter(e => e.event === 'order' && inWindow(e, 20, 27)).length;
const before = events.filter(e => e.event === 'order' && inWindow(e, 15, 19)).length;
const after = events.filter(e => e.event === 'order' && inWindow(e, 28, 32)).length;
const baseline = (before + after) / 9;          // 9 neighbor days
const targetRate = target / 7;                  // 7 target days
check('rainy week dip', targetRate < baseline * 0.85);
```

### 9.4 Soup-aware weekend baseline

Default soup `dayOfWeekWeights` dampens weekends to ~0.55x weekday. A hook
that adds 30% weekend clones lifts to ~0.70x — still <1.0x but ABOVE soup
baseline. Verify against expected-without-hook ratio, not against 1.0:

```js
const wkndDelta = wkndAvg / wkdayAvg;
const SOUP_BASELINE = 0.55;
check('weekend surge above soup baseline', wkndDelta > SOUP_BASELINE * 1.2,
  `wknd/wkday=${wkndDelta.toFixed(2)} (baseline ${SOUP_BASELINE})`);
```

### 9.5 Verify by spread when cohort key isn't in schema

Hooks sometimes reference a `profile.X` that isn't a defined userProp. The
validator doesn't catch this — `X` resolves to `undefined`. Verify the
resulting data SPREAD instead of segment correlation:

```js
// HOOK references profile.level (not in userProps); can't bin by level.
// Verify quest_gold spread shows the engineered variance instead.
const golds = events.filter(e => e.event === 'quest completed')
  .map(e => e.gold_earned).filter(g => typeof g === 'number');
const max = Math.max(...golds), min = Math.min(...golds);
const cv = stddev(golds) / avg(golds);
check('quest gold spread engineered', max / min > 50 && cv > 1.5);
```

### 9.6 Hash-based whale/bot cohort

Cleanest pattern for hidden cohorts. Deterministic, no schema mutation, no
flag stamping. Produces textbook long-tail signals:

```js
import { hashCohort } from "@ak--47/dungeon-master/hook-helpers";

// In hook (everything):
for (const e of events) {
  const isWhale = e.user_id && hashCohort(e.user_id, 2);  // ~2% of users
  if (isWhale && e.event === 'swap') e.trade_amount_usd *= 50;
}

// In verify (same primitive — hook and verifier CANNOT disagree on membership):
const whaleAmts = [], rest = [];
for (const [uid, evs] of byUser) {
  const isWhale = hashCohort(uid, 2);
  const amts = evs.filter(e => e.event === 'swap').map(e => e.trade_amount_usd);
  (isWhale ? whaleAmts : rest).push(...amts);
}
check('whale 5x+ trade', avg(whaleAmts) / avg(rest) >= 5);
```

**Why not `uid.charCodeAt(0) % 50 === 0`** (the pre-1.6 idiom): first-char
arithmetic depends on the id alphabet covering charcode space uniformly — it
doesn't. GUID first chars are hex (0-9, a-f), which reach only ~2 of 50
residues under `% 50`, so the "2% cohort" actually lands anywhere from 0% to
~12% depending on id format. `hashCohort` runs FNV-1a over the FULL string;
on engine-stamped GUIDs the share tracks the target within a few tenths of a
point.

### 9.7 Hook ordering inside `everything`

When one hook injects events that another hook then mutates, ordering
breaks ratios. Example (dating):

- HOOK 1: cap `match_score` for a cohort to ≤0.4
- HOOK 4: clone high-`match_score` matches for premium users

If HOOK 1 runs FIRST, then HOOK 4 injects new high-score matches into the
capped cohort — the cohort's avg moves back up.

**Recipe:** in a single `everything` block, run cohort-degrading hooks
AFTER all injection hooks. Document the ordering inline:

```js
hook(events, type, meta) {
  if (type !== 'everything') return events;
  // 1. Injection hooks first
  applyHook4(events, meta);
  applyHook5(events, meta);
  // 2. Cohort-shaping hooks last (operate on final event set)
  applyHook1(events, meta);
  return events;
}
```

### 9.8 Funnel-post TTC limitation (KNOWN)

`funnel-post` hooks that compress timing between funnel events DON'T move
the verifier's `timeToConvert` rows because `evaluateFunnel` is a greedy
single-pass over the user's full event history — it picks the first
matching event for each step regardless of which funnel-instance the hook
mutated. Document the limitation rather than failing the check:

```js
const rows = emulateBreakdown(events, {
  type: 'timeToConvert',
  fromEvent: 'deposit',
  toEvent: 'withdrawal',
  breakdownByUserProperty: 'trading_tier',
  profiles,
});
check('TTC populations present (limitation)', rows.length > 0,
  `rows=${rows.length} tiers=${rows.map(r => r.segment_value).join(',')}`);
```

### 9.9 Per-dungeon verify script template

```js
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { emulateBreakdown, evaluateFunnel,
         buildIdentityMap, resolveUserId } from '@ak--47/dungeon-master/verify';

const PREFIX = 'data/verify-MYDUNGEON';
async function loadShards(suffix) { /* see 9.1 */ }

const events = await loadShards('EVENTS');
const profiles = await loadShards('USERS');
const identityMap = buildIdentityMap(profiles);
const profileBy = new Map(profiles.map(p => [p.distinct_id, p]));

const byUser = new Map();
for (const e of events) {
  const uid = resolveUserId(e, identityMap);
  if (!byUser.has(uid)) byUser.set(uid, []);
  byUser.get(uid).push(e);
}

const results = [];
const check = (n, p, d = '') => {
  results.push({ n, p, d });
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${n}  ${d}`);
};
const avg = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;

// ... per-hook checks ...

const passed = results.filter(r => r.p).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
```

