# HOOKS.md -- Hook Encyclopedia

Hook reference and recipe catalog for dungeon-master. Every pattern here is
drawn from production dungeons. Code snippets are concrete but adaptable --
change event names, property names, and thresholds to fit your schema.

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
- `event`: return the (possibly replaced) event object. Returning a different object replaces the event entirely.
- `everything`: return the (possibly modified) array. Returning a filtered array removes events.
- All other types: mutate `record` in-place. Return value is ignored.

---

## 2. Core Principles

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
   correct (churn/silencing hooks work there consistently).

8. **Event cloning requires `everything`.** The `event` hook's return value
   REPLACES the original event. To DUPLICATE or INJECT events (spike
   patterns, burst clones), use the `everything` hook and `push()` to the
   array. Only use the `event` hook return for event REPLACEMENT patterns
   (e.g., alert triggered → incident created).

9. **Property baselines must contrast with hook targets.** If a hook sets
   `event_type = "plan_upgraded"` during a time window, the baseline
   distribution must make `plan_upgraded` rare (~10-15%). If it's already
   20%+ at baseline, the hook produces no visible spike. Similarly, if a
   hook forces `scale_direction = "down"`, the baseline must favor "up" so
   the forced "down" creates measurable contrast.

10. **TTC effects go in `everything`, not `funnel-post`.** Funnel-post TTC
    scaling (e.g., enterprise converts 1.4x faster) is not verifiable via
    cross-event SQL queries — standalone events drown the within-funnel
    signal. Move TTC-by-segment effects to the `everything` hook where you
    can directly scale time gaps between event pairs (e.g., alert triggered
    → alert resolved). Use stronger factors (0.5x/1.8x) to compensate for
    dilution by non-funnel events.

---

## 3. Recipe Catalog

### Temporal Trends

#### 3.1 Conversion Change Over Time

**Hook type:** `funnel-pre` | **Meta:** `meta.firstEventTime`

**In Mixpanel:** Funnel conversion rate shows a step-change at a specific date.
Before the date, conversion is baseline; after, it jumps or drops.

```js
// funnel-pre: feature launch boosts onboarding conversion by 20%
if (type === "funnel-pre") {
  const LAUNCH = dayjs.unix(meta.datasetStart).add(60, "days").valueOf();
  if (meta.firstEventTime > LAUNCH) {
    record.conversionRate *= 1.2;
  }
}
```

**Real-world analogue:** Product team ships a new onboarding wizard; conversion
lifts overnight and stays elevated.

**Adaptation:** Change the date offset and multiplier. Use `< LAUNCH` with a
multiplier `< 1` for degradation stories.

---

#### 3.2 Feature Launch Inflection

**Hook type:** `everything` | **Meta:** `meta.profile`, `meta.datasetStart`

**In Mixpanel:** A line chart of "Submit Feedback" broken down by "Feedback
Source" shows new source values ("Post Search", "Post Action") appearing only
after a launch date, with volume and ratings jumping.

```js
// everything: contextual feedback sources appear after feature launch
if (type === "everything") {
  const LAUNCH = dayjs.unix(meta.datasetStart).add(74, "days");
  const feedbackTemplate = record.find(e => e.event === "Submit Feedback");
  if (!feedbackTemplate) return record;

  // Path A: Ask MyBuddy -> View Summary within 5 min triggers "Post Search"
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

**Real-world analogue:** PM discovers that users at "moments of accomplishment"
are receptive to feedback prompts; contextual triggers outperform timed prompts.

**Adaptation:** Replace the sequence and source labels. Any behavioral trigger
(event count threshold, property match) can gate the injection.

---

#### 3.3 End-of-Quarter Spike

**Hook type:** `event` | **Meta:** `meta.datasetStart`

**In Mixpanel:** Line chart of "billing event" filtered to `event_type =
"plan_upgraded"` shows a 4x spike in the final 10 days.

```js
// event: days 80-90, 40% of billing events become plan upgrades
if (type === "event" && record.event === "billing event") {
  const dayInDataset = dayjs(record.time).diff(dayjs.unix(meta.datasetStart), "days", true);
  if (dayInDataset >= 80 && dayInDataset <= 90 && chance.bool({ likelihood: 40 })) {
    record.event_type = "plan_upgraded";
  }
}
```

**Real-world analogue:** B2B SaaS revenue clusters at quarter-close as sales
teams pull deals forward and customers expand seats.

**Adaptation:** Change the day range and target property. Clone events for
volume spikes (team invites, seat additions).

---

#### 3.4 Degradation and Recovery

**Hook type:** `everything` | **Meta:** `meta.datasetStart`, `meta.datasetEnd`

**In Mixpanel:** "Agenda Error" line chart shows zero before April 10, ramps up
during the bug window, then decays exponentially after the fix on April 26.
Breakdown by "Region" shows EU dominates errors.

```js
// everything: EU users get 60% error rate during bug window, exponential decay after fix
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
        // exponential decay: 60 * 0.15^(days since fix)
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

**Real-world analogue:** A/B test deployed globally where the backend model
serving layer lacks coverage in certain EU regions. The experiment looks great
in aggregate but is silently failing for 30% of users.

**Adaptation:** Replace the region check with any profile segment. Adjust the
decay base (0.15 is aggressive; use 0.5 for slower recovery).

---

### Magic Numbers

#### 3.5 Inverted-U Sweet Spot

**Hook type:** `everything` | **Meta:** `meta.profile`

**In Mixpanel:** Users bucketed by count of "Onboarding Question" events show
peak conversion at 3 questions (~85%), dropping on both sides. Classic
inverted-U.

```js
// everything: inverted-U conversion by onboarding question count
if (type === "everything") {
  const BINS = {
    low:    [0, 3],   // 0-2 questions: not enough context
    sweet:  [3, 4],   // exactly 3: peak conversion
    four:   [4, 5],
    high:   [5, Infinity],
  };
  const DROP = { low: 75, sweet: 0, four: 20, high: 70 };
  const bin = binUsersByEventCount(record, "Onboarding Question", BINS);
  const dropProb = DROP[bin] ?? 0;

  if (dropProb > 0 && chance.bool({ likelihood: dropProb })) {
    // non-converter: keep only acquisition events
    const keep = new Set(["View Shared Page", "Onboarding Question"]);
    dropEventsWhere(record, e => !keep.has(e.event));
  }
  return record;
}
```

**Real-world analogue:** Signup flow friction optimization -- too few screens
means users don't understand the value prop; too many means they abandon.

**Adaptation:** Change the event name, bin boundaries, and drop probabilities.
Add a profile-based penalty (e.g., email auth +20% drop).

---

#### 3.6 Frequency x Engagement Sweet Spot

**Hook type:** `everything` | **Meta:** none

**In Mixpanel:** Users with 3-8 "view item" events show 25% higher cart
amounts. Users with 9+ are window-shoppers whose checkouts drop 30%.

```js
// everything: view-item magic number for cart value
if (type === "everything") {
  const viewCount = record.filter(e => e.event === "view item").length;
  if (viewCount >= 3 && viewCount <= 8) {
    // sweet spot: boost cart amounts
    scalePropertyValue(record, e => e.event === "checkout", "amount", 1.25);
  } else if (viewCount >= 9) {
    // decision paralysis: drop checkouts
    dropEventsWhere(record, e => e.event === "checkout" && chance.bool({ likelihood: 30 }));
  }
  return record;
}
```

**Real-world analogue:** Shoppers who browse a moderate amount convert with
higher carts; excessive browsing signals indecision and abandonment.

**Adaptation:** Replace event names and property. Works for any
count-of-A-affects-B-outcome pattern.

---

#### 3.7 CI Build Magic Number

**Hook type:** `everything` | **Meta:** none

**In Mixpanel:** Users with 15-30 builds sit in the healthy CI sweet spot
(30% more deploys). Users with 31+ suffer flaky-CI burnout (25% fewer deploys).

```js
// everything: build count magic number
if (type === "everything") {
  const buildCount = record.filter(e => e.event === "build completed").length;
  if (buildCount >= 15 && buildCount <= 30) {
    // healthy CI: clone 30% extra deploys
    scaleEventCount(record, "deployment completed", 1.3);
  } else if (buildCount >= 31) {
    // flaky burnout: drop 25% of deploys
    scaleEventCount(record, "deployment completed", 0.75);
  }
  return record;
}
```

**Real-world analogue:** Healthy CI cadence drives reliable deploys; runaway
builds signal a flaky pipeline that scares teams off shipping.

**Adaptation:** Change the count event, target event, bin boundaries, and
scale factors. Use `applyFrequencyByFrequency` (Phase 4) for a declarative
version.

---

### Experiments

#### 3.8 A/B/C Test with Variant-Specific Effects

**Hook type:** `funnel-post` + `everything` | **Meta:** `meta.experiment`

**In Mixpanel:** Experiment report shows Variant B outperforms on downstream
metrics (more Add Talking Point events, higher engagement). Breakdown by
"Variant name" on `$experiment_started` shows even distribution.

The experiment is declared on the funnel config -- the engine handles variant
assignment, `$experiment_started` events, and conversion modifiers:

```js
// Funnel config (declarative):
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
// funnel-post: inject downstream events for Variant B
if (type === "funnel-post" && meta.experiment?.variantName === "Variant B") {
  const last = record[record.length - 1];
  if (last) {
    const tpTemplate = record.find(e => e.event === "Add Talking Point") || last;
    record.push(cloneEvent(tpTemplate, {
      event: "Add Talking Point",
      time: dayjs(last.time).add(chance.integer({ min: 5, max: 30 }), "minutes").toISOString(),
      user_id: last.user_id,
      "Source": "AI Suggested",
    }));
  }
}
```

**Real-world analogue:** A/B test where the winning variant drives measurably
more downstream engagement, not just higher funnel conversion.

**Adaptation:** Change the variant names, multipliers, and the downstream
events injected. Combine with an everything-hook EU bug story for a "looks
great in aggregate, broken in a segment" narrative.

---

### Cohort Effects

#### 3.9 Subscription Tier Stacking

**Hook type:** `everything` | **Meta:** `meta.profile`

**In Mixpanel:** "quest turned in" avg reward_gold, broken down by
subscription_tier, shows Premium at 1.4x and Elite at 1.8x vs Free baseline.

```js
// everything: tier-based reward scaling
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

**Real-world analogue:** Subscription tiers in live-service games confer
XP/loot bonuses that translate into measurable progress speed.

**Adaptation:** Change the profile property, event, and value property. Works
for any segment-scales-value pattern.

---

#### 3.10 Integration Users Succeed

**Hook type:** `everything` | **Meta:** none (derived from events)

**In Mixpanel:** Cohort of users who configured both Slack AND PagerDuty
integrations shows 60% lower response time and 50% faster resolution.

```js
// everything: integration users resolve incidents faster
if (type === "everything") {
  let hasSlack = false, hasPagerduty = false;
  record.forEach(e => {
    if (e.event === "integration configured") {
      if (e.integration_type === "slack") hasSlack = true;
      if (e.integration_type === "pagerduty") hasPagerduty = true;
    }
  });
  if (hasSlack && hasPagerduty) {
    scalePropertyValue(record, e => e.event === "alert acknowledged", "response_time_mins", 0.4);
    scalePropertyValue(record, e => e.event === "alert resolved", "resolution_time_mins", 0.5);
  }
  return record;
}
```

**Real-world analogue:** Teams that wire alerting into their existing comms
stack respond minutes faster -- the alert literally finds the human.

**Adaptation:** Replace the integration check with any compound behavioral
condition (two+ events, property matches, thresholds).

---

#### 3.11 Power User Behavioral Amplification

**Hook type:** `everything` | **Meta:** none (derived from events)

**In Mixpanel:** Users who used the "Ancient Compass" item earn 1.5x quest
rewards and get 40% more quest completions via cloned events.

```js
// everything: Ancient Compass users get amplified rewards + extra quests
if (type === "everything") {
  const usedCompass = record.some(e => e.event === "use item" && e.item_type === "Ancient Compass");
  if (!usedCompass) return record;

  record.forEach((event, idx) => {
    if (event.event === "quest turned in") {
      event.reward_gold = Math.floor((event.reward_gold || 100) * 1.5);
      event.reward_xp = Math.floor((event.reward_xp || 500) * 1.5);
      // 40% chance: clone a bonus quest completion
      if (chance.bool({ likelihood: 40 })) {
        record.push(cloneEvent(event, {
          time: dayjs(event.time).add(chance.integer({ min: 10, max: 120 }), "minutes").toISOString(),
          user_id: event.user_id,
          quest_id: chance.pickone(questIds),
        }));
      }
    }
  });
  return record;
}
```

**Real-world analogue:** Players who discover a power-up item measurably
outperform those who don't -- classic feature discovery correlation.

**Adaptation:** Replace the trigger event/property and the amplified
downstream event. The pattern works for any "did X -> gets more Y" story.

---

### Operational Stories

#### 3.12 Night Deploy Failure Spike

**Hook type:** `everything` | **Meta:** none

**In Mixpanel:** "deployment completed" failure rate broken down by hour of
day shows 22:00-05:59 at 40% failure vs 15% baseline.

```js
// everything: night deploys fail at 40% rate
if (type === "everything") {
  record.forEach(e => {
    if (e.event === "deployment completed") {
      const hour = new Date(e.time).getUTCHours();
      if ((hour >= 22 || hour < 6) && chance.bool({ likelihood: 40 })) {
        e.deploy_status = "failed";
      }
    }
  });
  return record;
}
```

**Real-world analogue:** Night deploys fail more due to skeleton crews and
delayed incident response.

**Adaptation:** Change the hour range and failure likelihood. Works for any
time-of-day-affects-outcome pattern.

---

#### 3.13 Regional Error Injection

**Hook type:** `everything` | **Meta:** `meta.profile`

**In Mixpanel:** Error events broken down by Region show EU dominating (>90%
of errors), concentrated in a specific date window.

See [Recipe 3.4](#34-degradation-and-recovery) for the full implementation.
The key addition is a profile-segment gate:

```js
if (meta.profile.Region !== "EU") return record;
// ... inject errors only for EU users during the bug window
```

**Real-world analogue:** Region-specific infrastructure failure that only
affects a subset of users, invisible in aggregate metrics.

---

### Funnel Manipulation

#### 3.14 TTC by User Segment

**Hook type:** `funnel-post` | **Meta:** `meta.profile`

**In Mixpanel:** Funnel median time-to-convert, broken down by company_size,
shows Enterprise completing 1.4x faster and Startup 1.25x slower.

```js
// funnel-post: scale TTC by company size
if (type === "funnel-post") {
  const factor =
    meta.profile?.company_size === "enterprise" ? 0.71 :
    meta.profile?.company_size === "startup" ? 1.25 :
    1.0;
  if (factor !== 1.0) {
    for (let i = 1; i < record.length; i++) {
      const prev = dayjs(record[i - 1].time);
      const newGap = Math.round(dayjs(record[i].time).diff(prev) * factor);
      record[i].time = prev.add(newGap, "milliseconds").toISOString();
    }
  }
}
```

**Real-world analogue:** Enterprise customers with dedicated CSMs and priority
support convert faster through multi-step workflows.

**Adaptation:** Change `meta.profile` key and factor values. Use
`applyTTCBySegment` (Phase 4) for a declarative version. Note: funnel TTC is
visible only in Mixpanel's funnel median TTC report, not in cross-event SQL
queries.

---

#### 3.15 Funnel Conversion by Profile

**Hook type:** `funnel-pre` | **Meta:** `meta.profile`, `meta.funnel`

**In Mixpanel:** Funnel conversion rate broken down by a user property shows
paid users converting at 1.3x the rate of free users.

```js
// funnel-pre: paid users get boosted conversion
if (type === "funnel-pre") {
  const tier = meta.profile?.plan_tier;
  if (tier === "enterprise" || tier === "business") {
    record.conversionRate = Math.min(95, record.conversionRate * 1.3);
  } else if (tier === "free") {
    record.conversionRate *= 0.7;
  }
}
```

**Real-world analogue:** Paid-tier users who've invested in the product
complete multi-step workflows at higher rates.

**Adaptation:** Change the profile key and multipliers. Can also modify
`record.timeToConvert` to affect TTC from funnel-pre.

---

### Event Injection

#### 3.16 Binge-Watching Pattern

**Hook type:** `everything` | **Meta:** none (derived from events)

**In Mixpanel:** Users with 3+ consecutive completions show 1.5x more
completions per user. Pause events are suppressed for bingers.

```js
// everything: binge-watchers get extra playback pairs, fewer pauses
if (type === "everything") {
  // detect 3+ consecutive completions
  let streak = 0, maxStreak = 0;
  record.forEach(e => {
    if (e.event === "playback completed") { streak++; maxStreak = Math.max(maxStreak, streak); }
    else if (e.event !== "playback started") { streak = 0; }
  });
  if (maxStreak < 3) return record;

  // suppress 60% of pauses
  dropEventsWhere(record, e => e.event === "playback paused" && chance.bool({ likelihood: 60 }));

  // clone start+complete pairs for 40% of completions
  const startTemplate = record.find(e => e.event === "playback started");
  record.filter(e => e.event === "playback completed").forEach(e => {
    if (!chance.bool({ likelihood: 40 })) return;
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
  });
  return record;
}
```

**Real-world analogue:** Autoplay and cliffhangers push hooked viewers through
entire seasons in a sitting.

**Adaptation:** Replace event names. The pattern (detect streak -> suppress
interrupts -> clone continuation pairs) generalizes to any repeat-consumption
flow.

---

#### 3.17 Contextual Event Injection

**Hook type:** `everything` | **Meta:** `meta.datasetStart`

**In Mixpanel:** Flows report shows "Ask MyBuddy" -> "View Summary" as a
strong preceding path for "Submit Feedback". Feedback source breakdown reveals
"Post Search" only appearing after the feature launch date.

```js
// everything: detect Ask -> View within 5 min, inject contextual feedback
if (type === "everything") {
  const LAUNCH = dayjs.unix(meta.datasetStart).add(74, "days");
  const feedbackTemplate = record.find(e => e.event === "Submit Feedback");
  if (!feedbackTemplate) return record;

  for (let i = 0; i < record.length; i++) {
    if (record[i].event !== "Ask MyBuddy") continue;
    if (!dayjs(record[i].time).isAfter(LAUNCH)) continue;
    const tail = record.slice(i);
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

**Real-world analogue:** Smart feedback prompts triggered at moments of
accomplishment dramatically outperform random timed prompts.

**Adaptation:** Replace the trigger sequence and injected event. The
`findFirstSequence` atom handles the gap detection; change the max gap (in
minutes) to match your use case.

---

### Cross-Event State

#### 3.18 Closure-Based State (Cost Overrun -> Scale Down)

**Hook type:** `event` | **Meta:** none (module-level Map)

**In Mixpanel:** Sequencing users' cost reports with 25%+ cost_change_percent
followed by their next "infrastructure scaled" event shows 100% of those
next-scale events are `scale_direction = "down"`.

```js
// Module-level Map — persists across hook calls within a single dungeon run
const costOverrunUsers = new Map();

// event: cost report > 25% records user; next scale event forced down
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

**Real-world analogue:** A surprise cloud bill triggers an immediate
downscale; no engineer ignores a 25% month-over-month cost jump.

**Adaptation:** Replace the trigger condition and the forced property value.
Module-level Maps work for any "event A for user X affects their next event B"
pattern. The Map acts as a one-shot flag that is consumed on the next match.

---

#### 3.19 Failed Deploy Recovery

**Hook type:** `event` | **Meta:** none (module-level Map)

**In Mixpanel:** Successful deploys immediately following a failed deploy show
1.5x longer duration, reflecting the extra verification overhead.

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

**Real-world analogue:** After a bad deploy, teams add manual gates and extra
verification steps that slow the very next release.

---

### Profile Enrichment

#### 3.20 Segment-Based Profile Enrichment

**Hook type:** `user` | **Meta:** none

**In Mixpanel:** Average user property "seat_count" broken down by
"company_size" shows a monotonic ramp from startup (1-5) to enterprise
(50-500).

```js
// user: company size determines seat count, ACV, and CSM assignment
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

**Real-world analogue:** B2B SaaS pricing scales orders of magnitude across
customer segments.

**Adaptation:** Change the profile properties and segment values. Use for any
"profile property A determines profile properties B, C, D" pattern.

---

### Churn and Retention

#### 3.21 Hash-Based Churn Silencing

**Hook type:** `everything` | **Meta:** `meta.datasetStart`

**In Mixpanel:** Retention report shows a visible cliff at day 30, with 10-20%
of users going completely silent.

```js
// everything: deterministic 20% of users go silent after day 30
if (type === "everything") {
  const uid = record[0]?.user_id || record[0]?.device_id || "";
  const idHash = String(uid).split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  if (idHash % 5 !== 0) return record; // only 20% of users

  const cutoff = dayjs.unix(meta.datasetStart).add(30, "days");
  dropEventsWhere(record, e => dayjs(e.time).isAfter(cutoff));
  return record;
}
```

**Real-world analogue:** Most SaaS churn happens silently -- accounts simply
stop logging in long before the formal cancellation.

**Adaptation:** Change the hash modulus (5 = 20%, 10 = 10%) and the day
cutoff. Use char-code hashing for deterministic, seedless cohort assignment
that survives re-runs.

---

## 4. Phase 3 Atom Reference

Import from `@ak--47/dungeon-master/hook-helpers`:

| Atom | Module | Signature | Purpose |
|---|---|---|---|
| `binUsersByEventCount` | cohort | `(events, eventName, bins) -> string\|null` | Classify user into a named bin by event count |
| `binUsersByEventInRange` | cohort | `(events, eventName, start, end, bins) -> string\|null` | Same, but only counts events in a time range |
| `countEventsBetween` | cohort | `(events, eventA, eventB) -> number` | Count events between first A and first B |
| `userInProfileSegment` | cohort | `(profile, key, values) -> boolean` | Check if profile property matches segment |
| `cloneEvent` | mutate | `(template, overrides?) -> event` | Shallow clone with overrides |
| `dropEventsWhere` | mutate | `(events, predicate) -> number` | Remove matching events in-place |
| `scaleEventCount` | mutate | `(events, eventName, factor) -> number` | Scale count of an event type (clone or drop) |
| `scalePropertyValue` | mutate | `(events, predicate, prop, factor) -> number` | Multiply a numeric property on matching events |
| `shiftEventTime` | mutate | `(event, deltaMs) -> event` | Shift one event's timestamp |
| `scaleTimingBetween` | timing | `(events, eventA, eventB, factor) -> boolean` | Scale the gap between first A and first B |
| `scaleFunnelTTC` | timing | `(funnelEvents, factor) -> number` | Scale all offsets from the funnel's first event |
| `findFirstSequence` | timing | `(events, names[], maxGapMin) -> events[]\|null` | Detect ordered sequence within a max gap |
| `injectAfterEvent` | inject | `(events, source, template, gapMs, overrides?) -> event` | Splice a clone after a specific event |
| `injectBetween` | inject | `(events, eventA, eventB, template, overrides?) -> event` | Splice a clone at the midpoint of A-B gap |
| `injectBurst` | inject | `(events, template, count, anchor, spreadMs, overrides?) -> events[]` | Inject N clones distributed around an anchor time |
| `isPreAuthEvent` | identity | `(event, authTime) -> boolean` | Check if event is before the user's stitch |
| `splitByAuth` | identity | `(events, authTime) -> { preAuth, postAuth, stitch }` | Partition events by auth boundary |

Full JSDoc in `lib/hook-helpers/*.js`.

---

## 5. Phase 4 Pattern Reference

Import from `@ak--47/dungeon-master/hook-patterns`:

| Pattern | Hook Type | Signature | Mixpanel Report |
|---|---|---|---|
| `applyFrequencyByFrequency` | everything | `(events, profile, { cohortEvent, bins, targetEvent, multipliers })` | Frequency of A by per-user count of B |
| `applyFunnelFrequencyBreakdown` | funnel-post | `(allEvents, profile, funnelEvents, { cohortEvent, bins, dropMultipliers })` | Funnel conversion by per-user activity bucket |
| `applyAggregateByBin` | everything | `(events, profile, { cohortEvent, bins, event, propertyName, deltas })` | Avg property value by per-user activity bucket |
| `applyTTCBySegment` | funnel-post | `(funnelEvents, profile, { segmentKey, factors })` | Funnel median TTC by profile segment |
| `applyAttributedBySource` | everything | `(events, profile, { sourceEvent, sourceProperty, downstreamEvent, weights })` | Conversions by source (first/last touch) |

Full JSDoc in `lib/hook-patterns/*.js`. Pair with `emulateBreakdown` from
`@ak--47/dungeon-master/verify` to assert patterns in CI.
