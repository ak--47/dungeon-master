---
name: write-hooks
description: Engineer story trends and "magic number" patterns into an existing dungeon by writing its `hook` function. Uses the Phase 3 atom helpers + Phase 4 patterns. Adds NO new event flags. Iterates until /verify-dungeon scores STRONG or NAILED.
argument-hint: [path/to/dungeon.js] [free-text story / trend description]
model: claude-opus-4-6
effort: max
---

# Write Hooks

Engineer story trends into the dungeon at `$ARGUMENTS` (first positional arg)
based on the story description (remaining args).

## Scope (post-1.4 split)

This skill writes the `hook` function ONLY. It assumes the dungeon's schema is
already complete (produced by `create-dungeon`). After writing, hand off to
`/verify-dungeon` to confirm the engineered patterns actually appear.

In scope:
- The `hook: function(record, type, meta) { ... }` body
- Documentation comments above the hook explaining each engineered pattern,
  including a reference Mixpanel report block per pattern

Out of scope:
- Schema changes (events, properties, funnels, superProps, userProps).
  Only modify schema if the hook can't possibly work without a new field —
  and even then, prefer changing the value enumeration over adding a new field.
- New top-level config knobs.
- Removing the `hook: function...` body to start over with a new schema.

## Reference reading

- `lib/hook-helpers/index.js` — Phase 3 atoms (cohort, mutate, timing, inject,
  identity). One file per group; full JSDoc on each atom.
- `lib/hook-patterns/index.js` — Phase 4 high-level recipes (one per Mixpanel
  analysis type).
- `lib/verify/emulate-breakdown.js` — what `verify-dungeon` will check.
- `dungeons/user/my-buddy.js` — reference dungeon using a mix of atoms and
  hand-rolled logic.
- `dungeons/technical/pattern-*.js` — five minimal pattern fixtures, one per
  Phase 4 recipe.
- `HOOKS.md` — encyclopedia of hook recipes organized by story pattern. Contains
  17+ worked examples with code snippets, Mixpanel report instructions, and
  adaptation notes. **Start here** to find the right pattern for your story.

## Hook execution model

Hooks fire in this order per user (see `CLAUDE.md` for the canonical reference):

1. `"user"` — profile created. Mutate in place; return ignored.
2. `"scd-pre"` — SCD entries created. Mutate in place OR return new array.
3. For each funnel: `"funnel-pre"` → `"event"` (per step) → `"funnel-post"`.

**`funnel-pre` is now reliable for temporal patterns.** Usage funnels advance a
cursor after each run, so successive `meta.firstEventTime` values spread across
the user's active window. Persona and world-event modifiers apply BEFORE the
hook — the hook has final authority on `conversionRate`, `timeToConvert`, and
`props`.
4. `"event"` — for non-funnel standalone events. Return value REPLACES the event.
5. `"everything"` — array of ALL the user's events. Return array to replace.

**Most engineered trends belong in `everything`.** It sees the full user stream,
has access to `meta.profile` / `meta.scd` / `meta.authTime` / `meta.isPreAuth`,
and you can mutate freely.

Storage-only hooks (`ad-spend`, `group`, `mirror`, `lookup`) fire later in the
pipeline and don't see the same `meta` shape.

## Hook meta — Phase 2 identity context

Inside `funnel-pre` and `funnel-post`:
- `meta.isFirstFunnel: boolean`
- `meta.isBorn: boolean` (user born inside dataset window)
- `meta.attemptsConfig: { min, max, conversionRate? } | null`
- `meta.attemptNumber, meta.totalAttempts, meta.isFinalAttempt`

Inside `everything`:
- `meta.authTime: number | null` — unix-ms of the stitch event, null if never authed
- `meta.isPreAuth(event): boolean` — convenience predicate

Pattern: gate trend logic on `meta.isFinalAttempt` so failed prior attempts
don't get the same treatment as the converted attempt.

Inside `funnel-pre` and `funnel-post` (when experiment is active):
- `meta.experiment.name: string` — experiment name
- `meta.experiment.variantName: string` — assigned variant
- `meta.experiment.variantIndex: number` — 0-based index
- `meta.experiment.conversionMultiplier: number`
- `meta.experiment.ttcMultiplier: number`
- `meta.experiment` is `null` when no experiment or funnel run is before start date

Pattern: use `funnel-post` + `meta.experiment` to inject variant-specific
downstream effects:

```js
if (type === 'funnel-post' && meta.experiment) {
  if (meta.experiment.variantName === 'Variant B') {
    // Winner variant: inject downstream engagement event
    const last = record[record.length - 1];
    record.push(cloneEvent(last, {
      event: 'Agenda Generated',
      time: dayjs(last.time).add(5, 'minutes').toISOString(),
    }));
  }
}
```

## Atom + pattern catalog

### Atoms (`@ak--47/dungeon-master/hook-helpers`)

| File | Atom | Purpose |
|------|------|---------|
| cohort | `binUsersByEventCount(events, eventName, bins)` | Classify by per-user event count |
| cohort | `binUsersByEventInRange(events, eventName, start, end, bins)` | Same, time-windowed |
| cohort | `countEventsBetween(events, eventA, eventB)` | Count between first A and first B |
| cohort | `userInProfileSegment(profile, key, values)` | Profile-property cohort check |
| mutate | `cloneEvent(template, overrides)` | Spread+override a template event |
| mutate | `dropEventsWhere(events, predicate)` | In-place filter with count |
| mutate | `scaleEventCount(events, eventName, factor)` | >1 clones, <1 drops (seeded RNG) |
| mutate | `scalePropertyValue(events, predicate, prop, factor)` | Multiply numeric prop |
| mutate | `shiftEventTime(event, deltaMs)` | Shift one event's time |
| timing | `scaleTimingBetween(events, A, B, factor)` | Scale gap between first A and next B |
| timing | `scaleFunnelTTC(funnelEvents, factor)` | Scale all step offsets from anchor |
| timing | `findFirstSequence(events, [names], maxGapMin)` | Detect ordered run within window |
| inject | `injectAfterEvent(events, source, template, gapMs, overrides)` | Splice clone after source |
| inject | `injectBetween(events, A, B, template, overrides)` | Splice at midpoint |
| inject | `injectBurst(events, template, count, anchorTime, spreadMs, overrides)` | Burst around anchor |
| identity | `isPreAuthEvent(event, authTime)` | Standalone variant of meta.isPreAuth |
| identity | `splitByAuth(events, authTime)` | { preAuth, postAuth, stitch } partition |

### Patterns (`@ak--47/dungeon-master/hook-patterns`)

Higher-level recipes. Each maps to ONE Mixpanel analysis the verify-dungeon
emulator can re-derive.

| Pattern | Mixpanel analysis | Hook type |
|---------|-------------------|-----------|
| `applyFrequencyByFrequency` | Insights — count(A) by per-user count(B) | everything |
| `applyFunnelFrequencyBreakdown` | Funnels — completion by per-user count(X) | funnel-post |
| `applyAggregateByBin` | Insights — avg(prop X) by per-user count(B) | everything |
| `applyTTCBySegment` | Funnel TTC — broken down by user-property segment | funnel-post |
| `applyAttributedBySource` | Conversions by Source (first/last touch) | everything |

Use a pattern when the trend matches its analysis 1:1. Drop down to atoms when
the trend is bespoke or composite.

## Anti-flag-stamping rule (HARD WALL)

Hooks MUST NOT add new properties to records. The schema (config) defines what
properties exist; hooks modify VALUES of existing properties or inject events
cloned from existing ones.

DO NOT WRITE:
```js
record.is_whale = true;          // ❌ flag-stamping
record.cohort = "engaged";       // ❌ flag-stamping
record.was_dropped = false;      // ❌ flag-stamping
event.engineered_pattern_id = 5; // ❌ flag-stamping
```

DO WRITE:
```js
record.amount *= 3;                            // ✅ scale existing numeric prop
record.payday = true;                          // ✅ ONLY if `payday: [false]` exists in event config
const clone = cloneEvent(template, {time, user_id});  // ✅ clone existing event
events.push(clone);                            // ✅ inject from template
return events.filter(e => !shouldDrop(e));     // ✅ filter inside `everything`
```

If a trend genuinely needs a new property and the schema doesn't have it, add
the property to the EVENT CONFIG with a default value (typically `[null]` or
`[false]`), not via the hook.

## Identity-aware hook patterns

When a dungeon uses `isAuthEvent`, hooks can branch on auth state:

```js
hook: function(record, type, meta) {
  if (type !== 'everything' || !Array.isArray(record)) return record;
  // Drop pre-auth funnel attempts that fired errors — analytics cleanup
  return record.filter(e => !(e.event === 'API Error' && meta.isPreAuth(e)));
}
```

When a dungeon uses funnel `attempts`, hooks can reach into individual attempts
via funnel-post meta:

```js
if (type === 'funnel-post' && meta.isFirstFunnel && !meta.isFinalAttempt) {
  // Failed prior attempt — reduce its event count to model "abandoned quickly"
  scaleEventCount(record, record[0].event, 0.5);
}
```

## Pattern documentation block

Above the `hook` function (or in the dataset overview comment), document each
engineered pattern with a Mixpanel report block. This is what verify-dungeon
checks against and what consumers read to understand the dataset.

```
 * ─────────────────────────────────────────────────────────────────────────
 * 1. POWER USERS BUY 3X MORE (everything, applyFrequencyByFrequency)
 * ─────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: Users with 15+ Browse events buy 3× as often as users with <5 Browse.
 *
 * MIXPANEL REPORT:
 *   Type: Insights
 *   Event: "Purchase"
 *   Measure: Frequency Distribution
 *   Breakdown: per-user count of "Browse"
 *   Expected ratio: bin>=15 / bin<5 ≈ 3x (within ±15%)
```

## Hook Ordering Within `everything` (REV 10)

The order of operations inside the everything hook matters when hooks interact:

1. **SuperProp stamping** — stamp profile values onto events (always first)
2. **Temporal value mutations that DON'T need cloned events** — e.g., version stamping
3. **Behavioral detection + event cloning** — agentic detection, KYC clones, pro clones, magic number clones
4. **Event filtering** — churn, retention, rate-limit drops
5. **Temporal value mutations that NEED cloned events** — e.g., spring price boost, gas spike, outage errors (always LAST before sort)
6. **Sort** — `userEvents.sort((a, b) => new Date(a.time) - new Date(b.time))`

**Why:** If a temporal mutation runs before cloning, cloned events that land in
the temporal window miss the mutation. Moving temporal value mutations to the
end ensures ALL events in the window — original and cloned — receive the effect.

## Deprecated Feature Replacement (REV 10)

When a dungeon relied on deprecated config blocks (`subscription`, `attribution`,
`features`, `geo`, `anomalies`) for properties that hooks depend on, those
properties no longer appear in the data. Replace them:

1. Add the property to `superProps` and `userProps` with default values
2. Assign meaningful values in the `user` hook (based on hash, persona, or profile)
3. Use the assigned values in `everything` to drive downstream effects

Example: deprecated `subscription` → add `subscription_tier` to superProps/userProps,
assign tiers by hash in user hook, gate conversion/feature effects on tier in everything.

## Cohort Sizing Guidelines (REV 10)

Cohort detection conditions must be selective enough to create a meaningful
control group, but not so broad they catch everyone:

| Detection | Problem | Fix |
|-----------|---------|-----|
| `events.some(e => e.event === X)` with common X | 90%+ of users qualify | Require 3+ events: `events.filter(...).length >= 3` |
| `charCodeAt(0) % 50 === 0` | Only 2% of users | Increase modulus denominator or use `% 10` for 10% |
| `profile.tier === "premium"` | Fixed by config distribution | Adjust userProps distribution if cohort too small |
| `earlyEvents.length >= 5` for a low-weight event | 0% qualify (impossible threshold) | Check actual distribution first, set at ~80th percentile |

Target: 10-30% of users in the affected cohort for clean signal at 10K users.

### Threshold Calibration (REV 11)

When a hook gates on "N+ events of type X in first Y days," check the actual
distribution BEFORE choosing the threshold. With 200 event types and 2.5
events/user/day, a weight-7 event might produce only ~0.2 per user per day.
Setting threshold=5 for 7 days means ~0% of users qualify. Run this check
in your smoke test:

```sql
SELECT n, COUNT(*) FROM (
  SELECT user_id, COUNT(*) as n FROM events WHERE event = 'X' GROUP BY user_id
) GROUP BY n ORDER BY n LIMIT 15;
```

Set the threshold at approximately the 80th percentile of the distribution.

### Compounding Drop Hooks (REV 11)

Use at most ONE drop-based retention hook per dungeon. Multiple hooks that
each drop events after the same day threshold compound destructively:

- Hook A: drop 40% after day 21 for non-loyal users
- Hook B: drop 60% after day 21 for non-streak users
- Combined: 76% drop for users in both groups (which is 95% of users)

The control group barely exists. Fix: use boost-based patterns
(`scaleEventCount(events, "X", 1.8)`) for positive cohorts instead of drops
for negative cohorts. Boosts are additive and don't interact destructively.
Reserve drops for a single churn/retention effect per dungeon.

## Workflow

1. Read the dungeon at `$ARGUMENTS[0]` and understand the existing schema.
2. Translate the user's story description into 3–5 engineered patterns.
   Consult `HOOKS.md` for recipe ideas that match the user's story. Each recipe
   includes the hook type, code snippet, and Mixpanel report format.
3. For each pattern:
   - Pick a pattern from `lib/hook-patterns/` if it fits the analysis 1:1.
   - Otherwise compose atoms from `lib/hook-helpers/`.
   - Document the pattern in a comment block (Mixpanel report instructions).
4. Write the `hook` function, importing atoms/patterns at the top of the file.
5. Smoke-test:
   ```bash
   node scripts/verify-runner.mjs <dungeon> verify-dungeon --small
   ```
   Confirm the run completes without errors.
6. Hand off:
   ```
   /verify-dungeon <dungeon>
   ```
   If verify-dungeon returns WEAK, NONE, or INVERSE on any pattern, return to
   step 4 and refine. Iterate until all patterns score STRONG or NAILED.

## Stopping condition

Stop after `/verify-dungeon` reports all engineered patterns as STRONG or NAILED,
OR after three iterations without convergence — at that point, document what's
still off in the dungeon's overview comment and report the gap to the user.

## Output

Modify the dungeon file in place. Add the `hook` function. Add the imports.
Add the documentation block above the config. Do NOT modify any other file.
Tell the user to run `/verify-dungeon <dungeon>` next.
