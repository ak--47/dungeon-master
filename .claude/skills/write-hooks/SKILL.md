---
name: write-hooks
description: Engineer story trends and "magic number" patterns into an existing dungeon by writing its `hook` function. Uses the Phase 3 atom helpers + Phase 4 patterns. Adds NO new event flags. Iterates until /verify-hooks PASSes.
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
`/verify-hooks` to confirm the engineered patterns actually appear.

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
- `lib/verify/emulate-breakdown.js` — what `verify-hooks` will check.
- `dungeons/user/my-buddy.js` — reference dungeon using a mix of atoms and
  hand-rolled logic.
- `dungeons/technical/pattern-*.js` — five minimal pattern fixtures, one per
  Phase 4 recipe.

## Hook execution model

Hooks fire in this order per user (see `CLAUDE.md` for the canonical reference):

1. `"user"` — profile created. Mutate in place; return ignored.
2. `"scd-pre"` — SCD entries created. Mutate in place OR return new array.
3. For each funnel: `"funnel-pre"` → `"event"` (per step) → `"funnel-post"`.
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

Higher-level recipes. Each maps to ONE Mixpanel analysis the verify-hooks
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
engineered pattern with a Mixpanel report block. This is what verify-hooks
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

## Workflow

1. Read the dungeon at `$ARGUMENTS[0]` and understand the existing schema.
2. Translate the user's story description into 3–5 engineered patterns.
3. For each pattern:
   - Pick a pattern from `lib/hook-patterns/` if it fits the analysis 1:1.
   - Otherwise compose atoms from `lib/hook-helpers/`.
   - Document the pattern in a comment block (Mixpanel report instructions).
4. Write the `hook` function, importing atoms/patterns at the top of the file.
5. Smoke-test:
   ```bash
   node scripts/verify-runner.mjs <dungeon> verify-hooks --small
   ```
   Confirm the run completes without errors.
6. Hand off:
   ```
   /verify-hooks <dungeon>
   ```
   If verify-hooks returns FAIL or WEAK on any pattern, return to step 4 and
   refine. Iterate until all patterns PASS or you've hit a hard ceiling.

## Stopping condition

Stop after `/verify-hooks` reports all engineered patterns as PASS, OR after
two iterations without convergence — at that point, document what's still off
in the dungeon's overview comment and report the gap to the user.

## Output

Modify the dungeon file in place. Add the `hook` function. Add the imports.
Add the documentation block above the config. Do NOT modify any other file.
Tell the user to run `/verify-hooks <dungeon>` next.
