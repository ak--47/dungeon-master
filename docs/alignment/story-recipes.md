# build the event behavior the report will measure

Read [the overview](README.md) and [counting contracts](counting-contracts.md)
first. These recipes are small API patterns for existing dungeons, not full
configs or a promise of their final magnitude. Declare every property and event
before using a hook. Keep the full [hook encyclopedia](../../HOOKS.md) nearby.

Older encyclopedia recipes sometimes use "frequency" loosely or describe an old
fixture as a universal retention floor. The three frequency definitions and the
qualified retention/TTC contracts in this guide take precedence when interpreting
those examples. Measure the exact report named in your story.

## segment conversion with declarative funnels

Use `conditions` when one segment should receive a different conversion probability
on one funnel. Use persona modifiers when the behavior should apply more broadly.
Define `plan` in `userProps` before using these funnel fragments.

```js
const funnels = [
  { name: 'Activation', sequence: ['Signup', 'Activate'], isFirstFunnel: true,
    conditions: { plan: { eq: 'Pro' } }, conversionRate: 75, timeToConvert: 1 },
  { name: 'Activation', sequence: ['Signup', 'Activate'], isFirstFunnel: true,
    conditions: { plan: { eq: 'Free' } }, conversionRate: 30, timeToConvert: 1 },
];
```

Measure unique entrants and completers by plan. For the neutral config, use equal
conversion rates on both funnels. Keep event selection, window, population, and
segment filters unchanged. Do not expect 75/30 to equal the final unique-user rate
ratio if users have other opportunities to complete the same event sequence.

For a date-scoped release or outage, a `funnel-pre` hook can change the offered
pass's conversion rate using metadata. Cap deliberately and keep an unaffected
funnel/segment as a control. See the encyclopedia's conversion-over-time recipes.

## scale the first matching sequence

Use V2 in `everything` so it can inspect the user's full event stream.
Its greedy sequence search does not implement every native exclusion, reentry,
or history-selection mode. Verify that the changed sequence is the one the
specified report counts.

```js
import { applyTTCBySegmentV2 } from '@ak--47/dungeon-master/hook-patterns';

const hook = (records, type, meta) => {
  if (type === 'everything') {
    applyTTCBySegmentV2(records, meta.profile, {
      segmentKey: 'plan', factors: { Pro: 0.25, Free: 1 },
      steps: ['Trial Started', 'Subscription Started'], maxGapMinutes: 30 * 1440,
    });
  }
  return records;
};
```

Capture the same stream before the hook and compare selected completion IDs,
entry anchors, converted users, and mean TTC afterward. Factor one must be a
measured no-op. A factor above one can cross conversion or dataset bounds.
The legacy `applyTTCBySegment` remains useful for a known first-funnel history;
the live first-funnel case worked. It does not prove repeated-history equivalence.

## revenue and usage answer different questions

Both examples use a full user stream and raw Search-count bins. `amount` must
already be numeric in Browse's declared properties.

```js
import { applyAggregateByBin, applyFrequencyByFrequency } from '@ak--47/dungeon-master/hook-patterns';

function increaseOrderValue(records, profile) {
  return applyAggregateByBin(records, profile, {
    cohortEvent: 'Search', bins: { low: [0, 4], high: [4, Infinity] },
    event: 'Browse', propertyName: 'amount', deltas: { low: 1, high: 2 }, binBy: 'events',
  });
}

function increaseUsage(records, profile) {
  return applyFrequencyByFrequency(records, profile, {
    cohortEvent: 'Search', bins: { low: [0, 4], high: [4, Infinity] },
    targetEvent: 'Browse', multipliers: { low: 1, high: 2 }, binBy: 'events',
  });
}
```

Choose one mechanism for the intended story. The first changes average amount
with unchanged event count. The second changes event volume and per-user raw-count
histograms. Neither automatically adds active days. Verify the unchanged low bin,
eligible user counts, and before/after numerator. Reserve time for clones before
the dataset end; never treat attempted clone count as emitted count.

Native raw-frequency breakdowns need the same event/count interval as your helper
bins. To test calendar-day bins instead, use `binBy: 'distinctDays'` and an explicitly
calendar-day-defined report property or local check. Do not silently substitute
the rolling Frequency/Addiction report.

## conversion by activity needs the whole cohort history

```js
import { applyFunnelFrequencyBreakdown } from '@ak--47/dungeon-master/hook-patterns';

const hook = (records, type, meta) => {
  if (type === 'everything') {
    applyFunnelFrequencyBreakdown(records, meta.profile, records, {
      cohortEvent: 'Search', bins: { low: [0, 4], high: [4, Infinity] },
      finalStep: 'Activate', dropMultipliers: { low: 0.25, high: 0.9 }, binBy: 'events',
    });
  }
  return records;
};
```

`dropMultipliers` set one deterministic keep/drop decision per call. In this
full-stream recipe, a user keeps all or loses all matching final-step events.
This use removes matching final events across that user stream, not a handpicked native
funnel history. Make that scope deliberate. In `funnel-post`, only the current pass
is available unless you separately maintain history; it cannot know future activity.

Require both bins to exist. Compare report-selected unique conversion, not final
event totals. A conditional assertion that disappears for an empty bin proves
nothing. In 1.8.2 keep/drop hashing uses stable identity/event/time fields instead
of random `insert_id` values.

## make more active days when that is the claim

```js
import { injectOnNewDays } from '@ak--47/dungeon-master/hook-helpers';

const hook = (records, type, meta) => {
  if (type === 'everything' && meta.profile.plan === 'Pro') {
    injectOnNewDays(records, 'Feature Used', 7);
  }
  return records;
};
```

Seven is the target total of distinct UTC days containing the event, not seven
additional days. The helper adds only the deficit and does nothing at seven or more.
It needs an existing template and unused days in the user's available
stream window. Seven requested days may not fit. Count actual emitted distinct
days, then independently measure the later retention report. Avoid moving activity
before birth/auth or using same-day bursts to claim seven-day retention.

For retention magic-number stories, define an early observation window and a later
return window. Classify the cohort only from early activity. Including the return
itself in the classifier leaks the outcome into the segment.

## shape sessions without losing records

```js
import { applySessionShape } from '@ak--47/dungeon-master/hook-helpers';

const hook = (records, type, meta) => {
  if (type === 'everything') {
    applySessionShape(records, meta.profile.distinct_id, {
      sessionsPerWeek: 3, eventsPerSession: 3, sessionMinutes: 5,
      datasetStart: meta.datasetStart, datasetEnd: meta.datasetEnd,
    });
  }
  return records;
};
```

This retimes the same records. It does not create more events. Explicit bounds
reject impossible capacity before mutation. Unbounded legacy calls cannot know
the dataset end and can be clipped later. Compare exact event IDs before/after,
derive sessions from the full emitted stream, and compare native session counts.

## add a visible path while preserving competing traffic

```js
import { applyPathBias } from '@ak--47/dungeon-master/hook-helpers';

const hook = (records, type, meta) => {
  if (type === 'everything') {
    applyPathBias(records, meta.profile.distinct_id, {
      anchor: 'Browse', path: ['Search', 'Help'], share: 1, gapSeconds: [2, 4],
    });
  }
  return records;
};
```

The user needs existing Search and Help templates. `share: 1` means every eligible
recipient receives an injection. It does not promise 100% immediate branch share.
Measure first-anchor Flows with explicit forward slots and repeat-collapse settings,
including original traffic. Verify the paired baseline branch before the hook.

## bias eligible attribution touches

```js
import { applyAttributedBySource } from '@ak--47/dungeon-master/hook-patterns';

function biasKnownEligibleTouches(eligibleTouches, profile) {
  return applyAttributedBySource(eligibleTouches, profile, {
    property: 'utm_source', weights: { search: 3, referral: 1 }, model: 'firstTouch',
  });
}
```

Call this only after defining what "eligible" means for the conversion and native
lookback. The subset must contain references to the existing stamped records if
you intend its mutations to reach the full stream. The helper overwrites lifetime
endpoints of whatever stream you pass; it cannot infer a conversion selector.

For repeated purchases, a single lifetime-first/last mutation may not affect every
purchase's credited source. Preserve unstamped records, use distinct touch times,
keep touchless conversions in the denominator, and test first/last separately.

## hook execution and schema checklist

Per-user order is `user`, `scd-pre`, `funnel-pre`, `event`, `funnel-post`, `everything`.
Use `funnel-pre` for configuration changes to a pass, and `everything` for filtering
or full-history timing/injection. Return a filtered array to drop events; do not
return an empty event object. Some hooks mutate in place and ignore return values;
check the detailed hook table before replacing an object.

Clone existing event templates and use fresh insertion IDs. Keep flat properties,
valid ISO times, and the correct identity. Use seeded randomness and existing time
helpers. Automatic sorting follows `everything`, but it cannot repair invalid time,
wrong identity, undeclared properties, or insufficient capacity.

Standalone cadence and warehouse hooks run in separate phases and do not receive
the per-user `everything` stream. A fake series ID is not a person. Preserve the
warehouse manifest and use the warehouse verification/deployment workflow for
table-backed stories.

## acceptance template

```text
claim:
report and exact options:
population and segment definition:
numerator / denominator / statistic:
window and mature observation horizon:
neutral intervention and unaffected control:
minimum eligible users or converters per arm:
practical effect band declared before running:
before / after / emitted measurements:
schema, ID, time, and count preservation checks:
import receipt and query readiness:
live query payload, result, and comparison:
known unsupported settings or revised fixture conditions:
```

Use [validation](validation.md) for the cheapest existing check. Reading this guide
does not require rerunning the 297-cell sweep. A changed contract does require a
focused test, and a new live parity claim requires the corresponding native query.