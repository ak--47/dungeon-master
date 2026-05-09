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

Two related rules exist:

- **Calendar bucket** (default in our verifier, `algorithm: 'calendar'`):
  `COUNT(DISTINCT date_trunc(unit, time))` in UTC. Matches what the Mixpanel
  UI shows and what [`injectOnNewDays`](lib/hook-helpers/inject.js) uses
  internally.
- **Rolling window** (`algorithm: 'rolling'`): the C++
  `addiction_query.cpp` rule `qtz_time >= last_counted + seconds_for_unit`.
  Diverges from calendar at unit boundaries (events at 23:59 + 00:01 next
  day = 1 rolling period, 2 calendar periods).

Use the default (`calendar`) for hooks. Use `algorithm: 'rolling'` only
when verifying behavior that explicitly depends on the C++ implementation.

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

### 2.3 Aggregations are null-aware

`AVG(x)` skips null/undefined/NaN/non-numeric from BOTH numerator AND
denominator. Same for SUM, MIN, MAX. Reference: `normal_query.cpp`
ACTION_TYPE_AVERAGE / ACTION_TYPE_SUM / ACTION_TYPE_EXTREMES.

**Implication for hooks:** A property that's only sometimes present (e.g.,
`order_value` only on Purchase events) is averaged ONLY across events where
it exists. You don't need to "fill" missing values with 0 to keep the
average sensible — Mixpanel ignores them. Conversely, if you want to dilute
an average, removing the property is a no-op; you have to add zeros.

### 2.4 Attribution caps at 10 touchpoints

Multi-touch attribution models cap consideration at the last 10 touchpoints
in the lookback window (`TOUCHPOINTS_LIMIT = 10` in
`attributed_value_reader.cpp`). For first-touch attribution this matters
when a user has > 10 touches before conversion — the cap shifts which
touch is "first."

**v1.5 generation contract:** the engine now caps UTM stamping at
`maxTouchpointsPerUser` (default 10) per user, sampled uniform-random across
the user's lifetime (NOT first-N-chronological). Stamps are sorted
chronologically before being applied, so attribution properties land in
time order. Hooks that bias attribution should OVERWRITE engine-stamped
values, not stamp from scratch (those would push the user past the cap).

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

**v1.5 contract:** the generator's `assignSessionIds` pre-stamps `session_id`
using all three rules (UTC day boundary added in v1.5.0 audit). Verifier
trusts pre-stamped IDs and groups by `(user, session_id)`. Use
`emulateBreakdown({ type: 'sessionMetrics' })` to verify session-level shapes.

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

**`birth_can_retain`** (default `false`; `retention_query.cpp:1097-1109`):
ms-strict check on whether returns AT the birth ms count. Default excludes
them (`first_event_time < retention_event_time`). Set `birthCanRetain: true`
on the verifier to count exact-birth-ms returns.

`carry_forward` mode marks a user as retained for every later bucket once
they hit any earlier bucket (Mixpanel's CARRY_FORWARD unbounded mode,
`retention_query.cpp:1824-1837`). Retention is monotonically non-decreasing
across buckets in this mode.

`segmentBy` partitions the cohort by a property on the BIRTH event
(Mixpanel's `segment_event=FIRST` mode — `retention_query.cpp:1309`).

**Documented gaps (out of v1.5.0 verifier scope):**
- **COMPOUNDED retention** (`retention_query.cpp:670`) reuses the first-event
  filter as the return filter, making EVERY cohort event a retention
  candidate. Used heavily in Mixpanel's "DAU coming back" reports — verify
  these patterns in DuckDB or directly in Mixpanel.
- **CARRY_BACK / CONSECUTIVE_FORWARD** unbounded modes
- **CALENDAR_START** bucket alignment (anchor buckets to absolute calendar
  periods instead of birth time)
- **`segment_event=SECOND`** (segment by return-event property)
- **Cohort window** — verifier uses ALL users with the birth event in the
  dataset; Mixpanel restricts to users with birth in `[from_date, to_date]`
- **Week / month bucket units** — verifier supports day buckets only

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
directly (not auto-routed through `funnelFrequency` in v1.5.0).

### 2.10 Funnel segment modes (FIRST_TOUCH / LAST_TOUCH / STEP)

Reference: `options.hpp` `funnel_segment_mode`; `history.cpp`
`property_set_buffer`. The engine snapshots the matched event's properties
at every funnel step. Segmentation chooses which step's properties to use:
FIRST_TOUCH (step 0), LAST_TOUCH (last reached), or STEP N (specific index).
Enable with `evaluateFunnel({ trackStepProperties: true })`, then pick with
`resolveFunnelSegment(result, 'first' | 'last' | { step: N })`.

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

29. **Touchpoint cap awareness for attribution hooks.** The engine now caps
    UTM stamping at `maxTouchpointsPerUser` (default 10) per user, sampled
    across the user's lifetime. Attribution-biasing hooks should OVERWRITE
    engine-stamped values (e.g., set `event.utm_source = "google"` on
    already-stamped touches), NOT stamp fresh touches from scratch. Stamping
    from scratch would push the user past the cap and your hook's stamps
    would land outside Mixpanel's last-10 lookback window.

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
if (type === "everything") {
  const uid = record[0]?.user_id || record[0]?.device_id || "";
  const idHash = String(uid).split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  if (idHash % 5 !== 0) return record;

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
if (type === "user") {
  const hash = String(record.distinct_id || "").charCodeAt(0) % 10;
  record.subscription_tier = hash < 6 ? "free" : hash < 8 ? "monthly" : "annual";
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

#### 4.25 First-Touch Attribution Bias (Capped at 10 Touches)

**Hook:** `everything` | **Counting:** TOUCHPOINTS_LIMIT = 10 (Section 2.4)
**Mixpanel report:** Attribution — Conversions by Source (first-touch model, last-10 lookback)

**In Mixpanel:** `Convert` events broken down by first-touch `Touch.source`
show Google >> Facebook >> Twitter (10:5:1 weights).

```js
import { weighArray } from "@ak--47/dungeon-master/utils";

if (type === "everything") {
  const conversion = record.find(e => e.event === "Convert");
  if (!conversion) return record;
  const convTime = dayjs(conversion.time).valueOf();
  // Mixpanel only considers the LAST 10 touches before conversion. Stamp at
  // most ~6-8 touches per user so the first one is clearly the bias target.
  const sources = weighArray(["google", "facebook", "twitter"], [10, 5, 1]);
  const touches = record.filter(e => e.event === "Touch" && dayjs(e.time).valueOf() <= convTime);
  if (touches.length === 0) return record;
  // Bias the FIRST touch (chronologically earliest within the cap window).
  // Sort descending by time, take last 10, then sort ascending.
  const sortedDesc = touches.slice().sort((a, b) => dayjs(b.time).valueOf() - dayjs(a.time).valueOf());
  const inCap = sortedDesc.slice(0, 10).sort((a, b) => dayjs(a.time).valueOf() - dayjs(b.time).valueOf());
  if (inCap.length > 0) {
    inCap[0].source = chance.pickone(sources);
  }
  return record;
}
```

**Why the cap matters:** Stamping 50 weighted touches per user gives the same
first-touch result as stamping 10 — Mixpanel's attribution module
(`attributed_value_reader.cpp`) only considers `TOUCHPOINTS_LIMIT = 10`. Aim
for sparse, deterministic touches.

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
touches. Stamping fresh ones from scratch in the hook would push the user
past the cap, and your stamps would land outside Mixpanel's last-10 lookback
window — giving them no effect. Overwriting is correct.

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
import { injectOnNewDays } from "@ak--47/dungeon-master/hook-helpers";
import { countDistinctPeriods } from "@ak--47/dungeon-master/verify";

// Config:
//   avgActiveDaysPerUser: 5      // baseline: most users active ~5 days
//   events: [{ event: "open app", weight: 5 }, ...]

if (type === "everything") {
  // Hash-based cohort (deterministic, ~10% of users).
  const uid = record[0]?.user_id || "";
  const isPowerUser = uid.charCodeAt(0) % 10 === 0;
  if (!isPowerUser) return record;

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

## 5. Phase 3 Atom Reference

Import from `@ak--47/dungeon-master/hook-helpers`:

| Atom | Module | Signature | Purpose |
|---|---|---|---|
| `binUsersByEventCount` | cohort | `(events, eventName, bins) -> string\|null` | Classify by **total event count** (use for Insights "events per user") |
| `binUsersByEventInRange` | cohort | `(events, eventName, start, end, bins) -> string\|null` | Same, restricted to a time range |
| `countEventsBetween` | cohort | `(events, eventA, eventB) -> number` | Count events between first A and first B |
| `userInProfileSegment` | cohort | `(profile, key, values) -> boolean` | Profile property match |
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

Full JSDoc in [`lib/hook-helpers/*.js`](lib/hook-helpers/).

---

## 6. Verification Helpers

Import from `@ak--47/dungeon-master/verify`:

| Function | Purpose | Mixpanel Reference |
|---|---|---|
| `emulateBreakdown(events, config)` | Run the table-shape emulator for one of 5 analyses | Insights / Funnels / Flows |
| `verifyDungeon(dungeonConfig, assertions)` | High-level wrapper: run dungeon + run assertions | n/a |
| `evaluateFunnel(events, steps, options?)` | Greedy single-pass funnel state machine | `history.cpp` |
| `timestampComesAfter(t1, t2, grace?)` | 2-second grace window check | `history.cpp` |
| `withinConversionWindow(eventTime, step0Time, windowMs)` | Strict `<` window check | `conversion_window.cpp` |
| `countDistinctPeriods(events, eventName, unit?, options?)` | Distinct-period count (default day, calendar bucket; pass `{algorithm:'rolling'}` for C++ semantics) | `addiction_query.cpp` |
| `nullAwareAvg(values)` / `nullAwareSum(values)` | AVG/SUM that skip non-numeric | `normal_query.cpp` |
| `nullAwareExtreme(values, mode)` | MIN/MAX that skip non-numeric | `normal_query.cpp` |
| `binByDistinctPeriods(events, eventName, bins, unit?)` | Distinct-period cohort assignment | `addiction_query.cpp` |
| `deriveExpectedSchema(config)` / `validateSchema(events, schema)` | Schema integrity checks | n/a |

Full JSDoc in [`lib/verify/*.js`](lib/verify/).

---

## 7. Phase 4 Pattern Reference

Import from `@ak--47/dungeon-master/hook-patterns`:

| Pattern | Hook Type | Signature | Mixpanel Report |
|---|---|---|---|
| `applyFrequencyByFrequency` | everything | `(events, profile, { cohortEvent, bins, targetEvent, multipliers })` | Frequency of A by per-user count of B |
| `applyFunnelFrequencyBreakdown` | funnel-post | `(allEvents, profile, funnelEvents, { cohortEvent, bins, dropMultipliers })` | Funnel conversion by per-user activity bucket |
| `applyAggregateByBin` | everything | `(events, profile, { cohortEvent, bins, event, propertyName, deltas })` | Avg property value by per-user activity bucket |
| `applyTTCBySegment` | funnel-post | `(funnelEvents, profile, { segmentKey, factors })` | Funnel median TTC by profile segment |
| `applyAttributedBySource` | everything | `(events, profile, { sourceEvent, sourceProperty, downstreamEvent, weights })` | Conversions by source (first/last touch) |

> **Caveat (eval follow-up).** The three `*ByBin` / `*Frequency*` patterns
> currently use `binUsersByEventCount` (total events) for cohort assignment.
> The verification emulator now bins by **distinct days**, so cohort axes
> can mismatch — high-event-count users may not be high-distinct-day users.
> When verifying these patterns, expect signal dilution until the patterns
> switch to `binByDistinctPeriods`. For new dungeons targeting frequency
> reports, use the recipes in Section 4.5–4.7 instead of these patterns.

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
  event: 'Page View',                                // optional — only sessions containing this event
  metrics: ['count', 'duration', 'eventsPerSession'],
});
// → [{ metric, avg, median, p90, total_sessions }, ...]
```

Trusts the generator's pre-stamped `session_id`. If you need to verify
session-scoped funnels (steps must land in same session), pass
`sessionScoped: true` to `evaluateFunnel`.

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

HPC is **not auto-routed** through `funnelFrequency` in v1.5.0 — the report
shape differs (one row per `step × hpc_value` instead of `step × cohort`).
Call `evaluateFunnelHPC` directly inside your `verifyDungeon` check's
`assert` callback when you need it.

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
`verification/verticals/`.

**Proof in repo:** `verification/verticals/<dungeon>.{verify.mjs,sql}` —
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
// In hook (everything):
for (const e of events) {
  const isWhale = e.user_id && e.user_id.charCodeAt(0) % 50 === 0;  // 2%
  if (isWhale && e.event === 'swap') e.trade_amount_usd *= 50;
}

// In verify:
const whaleAmts = [], rest = [];
for (const [uid, evs] of byUser) {
  const isWhale = uid.charCodeAt(0) % 50 === 0;
  const amts = evs.filter(e => e.event === 'swap').map(e => e.trade_amount_usd);
  (isWhale ? whaleAmts : rest).push(...amts);
}
check('whale 5x+ trade', avg(whaleAmts) / avg(rest) >= 5);
```

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

