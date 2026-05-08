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

**Implication for hooks:** If you stamp 50 touchpoint events per user before
a conversion to bias attribution, only the last 10 enter the candidate pool.
Stamp fewer, more decisive touches.

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

---

## 4. Recipe Catalog

Each recipe shows the hook, the Mixpanel report it targets, and (where
counting semantics matter) the rule from Section 2.

### Temporal Trends

#### 4.1 Conversion Change Over Time

**Hook:** `funnel-pre` | **Meta:** `meta.firstEventTime`

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

See [4.4 Degradation and Recovery](#44-degradation-and-recovery) — the same
template with a profile-segment gate.

---

### Funnel Manipulation

#### 4.14 TTC by User Segment (Timestamp Shifting)

**Hook:** `everything` | **Counting:** greedy funnel TTC (Section 2.2)

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

See [4.2 Feature Launch Inflection](#42-feature-launch-inflection) for the
full implementation. Key atom: `findFirstSequence(tail, [eventA, eventB],
maxGapMin)` returns the matched events or `null`.

---

### Cross-Event State

#### 4.18 Closure-Based State (Cost Overrun → Scale Down)

**Hook:** `event` | Module-level Map

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
