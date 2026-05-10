# Counting Semantics — Mixpanel-Accurate Verification

Mixpanel does NOT count the way naive SQL does. The verifier (and any DuckDB query you write) must match Mixpanel's rules.

## Core rules

| Concept | Mixpanel rule | Wrong SQL → Right SQL |
|---------|--------------|----------------------|
| Frequency / cohort by event count | Distinct calendar days, NOT total events | `COUNT(*)` → `COUNT(DISTINCT date_trunc('day', time::TIMESTAMP))` |
| Funnels | Greedy single-pass, strict order, 2-second grace | NEVER hand-roll funnel SQL — use `emulateBreakdown` |
| AVG / SUM / MIN / MAX | Skip null and non-numeric from BOTH num and denom | Always wrap in `TRY_CAST(prop AS DOUBLE)` |
| Attribution | Cap at 10 touchpoints in lookback | Use `emulateBreakdown` with `attributedBy` |
| Conversion window | Strict `<` boundary | Read `Funnel.conversionWindowDays` and respect it |

Full rules: see [HOOKS.md Section 2](../../../../HOOKS.md#2-how-mixpanel-counts-things).

## When to use the emulator vs DuckDB

The emulator (`emulateBreakdown` from `@ak--47/dungeon-master/verify`) implements Mixpanel's rules natively. **ALWAYS use the emulator for funnel, frequency, aggregate, TTC, and attribution patterns.** Hand-written DuckDB queries for these pattern types diverge from what Mixpanel shows in reports — even when they look correct.

Use DuckDB ONLY for:
- Schema integrity checks (column coverage, flag detection)
- Identity-model invariants (stitch counts, pre-existing user stamping)
- Experiment invariants (variant distribution, exposure timing)
- Bespoke patterns that don't fit the emulator analyses

If you find yourself writing `WITH step1 AS ..., step2 AS ...` for a funnel, STOP — use `emulateBreakdown` with `funnelFrequency` instead.

## Emulator analysis types

| Pattern style | Emulator type | Use when |
|--------------|---------------|----------|
| count(A) by per-user count(B) | `frequencyByFrequency` | "Insights frequency distribution by per-user count of X" |
| Funnel completion by per-user count(X) | `funnelFrequency` | "Onboarding magic number" / "engaged users complete more" |
| avg(prop X) by per-user count(B) | `aggregatePerUser` | "Average order value by sessions per user" |
| Funnel TTC by user property | `timeToConvert` | "Trial users take 4× longer than enterprise" |
| First/last touch attribution | `attributedBy` | "Conversions by Source" |
| Birth retention curves | `retention` | "Sign Up → Login on day N" — requires `cohortEvent`, `returnEvent`, `dayBuckets` |
| Per-session metrics | `sessionMetrics` | Count / duration / events distributions per session |

Cross-cutting on EVERY type: `timeBucket: 'day' | 'week' | 'month'` partitions events into UTC buckets and emits one row per period.

Quick emulator script:

```js
import generate from './index.js';
import { emulateBreakdown } from './lib/verify/index.js';

const r = await generate('./dungeons/<path>.js');
const events = Array.from(r.eventData);
console.log(emulateBreakdown(events, {
  type: 'frequencyByFrequency',
  metricEvent: 'Purchase',
  breakdownByFrequencyOf: 'Browse',
}));
```

For CI-style assertions, use `verifyDungeon` with a checks array; see `tests/e2e/my-buddy-stories.test.js` for a worked example.

## What the verifier auto-applies

- **`Funnel.conversionWindowDays` auto-applied.** When a check's `breakdown` matches a funnel by sequence, `verifyDungeon` reads `conversionWindowDays` from the funnel config and passes it to the emulator. You do NOT need to thread `conversionWindowMs` by hand for funnels declared in the dungeon.
- **`Funnel.order` auto-dispatched.** For `sequential` / `interrupt` funnels, the emulator runs the greedy single-pass engine. For other order modes (`first-fixed`, `last-fixed`, `random`, etc.), it dispatches to `evaluateAnyOrderCompletion` (set-membership check). For `random` mode, results are `verificationKind: "informational"` — Mixpanel funnel shape doesn't apply; do not assert PASS/FAIL.
- **Auto-sort means custom DuckDB queries can trust event order.** Per-user events arrive sorted ascending by time (default; opt out via `autoSortAfterEverything: false`). `LAG`/`LEAD` window functions work without explicit `ORDER BY time` in the partition.
- **Auto-promote `isStrictEvent` is silent healing — not a regression.** If a stale dungeon's funnel-step events also live in `events[]`, the validator stamps `isStrictEvent: true` and warns. Verification of those dungeons may show CHANGED standalone-event counts vs older runs — that is correct behavior, not a bug to chase.
- **Touchpoint cap = 10 enforced at generation.** `hasCampaigns: true` users get up to `maxTouchpointsPerUser` (default 10) UTM-stamped events, sampled across lifetime. Attribution checks via `attributedBy` should see realistic first/last-touch shapes, not all-stamps-at-birth.

## Hook awareness for verification

- `injectOnNewDays(events, eventName, targetDays)` — clones events onto previously empty days. Hook authors are expected to use it for COHORT-CONDITIONAL active-day patterns only. Global active-day shape lives in `Dungeon.avgActiveDaysPerUser` (config knob), so a dungeon that uses this atom EVERYWHERE (not scoped to a cohort) is suspect — flag it.
- Engine-stamped UTMs may already exist on events. Hooks that bias attribution should OVERWRITE existing UTMs, not stamp fresh.

## Common verification gotchas

| Symptom | Root cause | Fix |
|---------|-----------|-----|
| Cohort B shows MORE absolute post-d30 events than cohort A even though hook reduces B | Cohort B has structurally higher event volume (e.g., low-balance users check balance constantly) | Compare per-user `post / pre` ratio, not raw counts |
| Time-window hook (rainy week, etc.) inverts when measured against full-dataset avg | Born-in-dataset ramp inflates late-window baseline | Compare against neighboring days only, not full-dataset average |
| Weekend-surge hook still <1.0x weekday | Default soup `dayOfWeekWeights` dampens weekends to ~0.55x weekday | Verify against soup baseline (`wknd/wkday > 0.55 × 1.2`), not >1.0 |
| Funnel-post TTC scaling doesn't move emulator's `timeToConvert` rows | `evaluateFunnel` is greedy single-pass over full event history — picks first match per step regardless of which funnel-instance the hook touched | Document as known limitation (`H9 TTC populations present (limitation)`) |
| Hook references `profile.X` that's not a defined userProp | Validator doesn't catch undeclared profile reads — `X` resolves to `undefined` | Verify by data SPREAD (max/min, cv) instead of segment correlation |
| Two `everything` hooks where one injects events the other mutates produce wrong ratios | Hook ordering matters — injection hook ran AFTER cohort-shaping hook | Run cohort-degrading hooks AFTER all injection hooks in same `everything` block |
| `readFileSync` ENOMEM on shards >500MB | Node string cap at ~512MB | Stream-load with `readline.createInterface` over `data/PREFIX-EVENTS*.json` glob |
| Hook reads `e.event === 'login'` but cohort empty | `login` is a funnel-step event auto-promoted to `isStrictEvent: true` | Add `isStrictEvent: false` to the event config to keep standalone occurrences |

When writing per-dungeon verify scripts, follow the template in HOOKS.md §9.9. Reference proofs for all 20 vertical dungeons live at `verification/verticals/` — consult them as exemplars before authoring a new one.

**Coverage discipline:** count documented hooks in the dungeon's top-level comment block; count `check()` calls in your verify script; the two MUST match. A "NAILED 7/7" claim against an 11-hook dungeon is misleading — either add the missing checks or document the limitation explicitly in the verify script and status file.

## Common verification mistakes

If a dungeon's frequency / funnel / TTC pattern shows WEAK or NONE in verification, check these BEFORE concluding the hook is broken:

1. **Did you use `COUNT(*)` instead of distinct days?** Frequency-based patterns require `COUNT(DISTINCT date_trunc('day', time::TIMESTAMP))`.
2. **Did you hand-roll funnel SQL?** Self-joins find the optimal match; Mixpanel uses greedy. Always use `emulateBreakdown` for funnels.
3. **Are you including step events at the conversion-window boundary?** Mixpanel uses strict `<`. An event exactly at the boundary is excluded.
4. **Did the hook scale event count without spreading across days?** `scaleEventCount(events, 'X', 3)` clones at sub-second offsets — same day. Frequency reports show ZERO movement. Use `injectOnNewDays`.
5. **Are you averaging a sometimes-missing property with `AVG()`?** Always wrap in `TRY_CAST(prop AS DOUBLE)`.
6. **Did you write a funnel-step event as a standalone in `events[]`?** The validator auto-promotes it to `isStrictEvent: true`. Verify the resulting standalone count matches expectations.

## Verifier exports

Direct access to the engine's counting + funnel primitives:

```js
import {
  evaluateFunnel,
  evaluateFunnelHPC,            // Hold Property Constant
  resolveFunnelSegment,         // first / last / step segment modes
  evaluateAnyOrderCompletion,
  buildIdentityMap, resolveUserId,  // identity resolution
  countDistinctPeriods,
  nullAwareAvg,
  binByDistinctPeriods,
  partitionByTimeBucket,        // day / week / month
} from '@ak--47/dungeon-master/verify';
```

## Funnel option threading

When the dungeon's `Funnel` config sets these fields, `verifyDungeon` auto-applies them to matching `funnelFrequency` / `timeToConvert` checks:

| Funnel field | Verifier behavior |
|--------------|-------------------|
| `reentry: true` | Counts every completion via `result.completions` |
| `exclusionEvents: string[]` | Wraps as `exclusionSteps: [{ event }]` and terminates the funnel attempt |
| `stepFilters: { N: { prop, op, value } }` | Mutates `breakdownArgs.steps[N]` to attach the `where` clause |

## Identity-model dungeons — pass profiles

When `avgDevicePerUser > 0` or `hasAnonIds: true`, ALWAYS pass `profiles` to `emulateBreakdown`. Without it, pre-auth `device_id` events bucket as separate "users" and your funnel/retention/attribution numbers all deflate.

```js
const events = Array.from(result.eventData);
const profiles = Array.from(result.userProfilesData);

emulateBreakdown(events, {
  type: 'funnelFrequency',
  steps: ['visit_landing', 'sign_up', 'first_action'],
  breakdownByFrequencyOf: 'visit_landing',
  profiles,        // ← REQUIRED for identity-model dungeons
});
```

Auto-builds the device→user map via `buildIdentityMap(profiles)` (reads `device_ids` first, falls back to `anonymousIds`). For repeated calls, build once and pass `identityMap`.

## Time-series verification (timeBucket)

For temporal trends (engineered campaigns, weekly cycles, growth shapes), add `timeBucket` to any breakdown:

```js
emulateBreakdown(events, {
  type: 'frequencyByFrequency',
  metricEvent: 'Purchase',
  breakdownByFrequencyOf: 'Browse',
  timeBucket: 'week',
});
// → [{ period: '2024-W01', metric_freq, breakdown_freq, user_count }, ...]
```

Use `period` to assert weekly / monthly trend shapes (e.g., "engagement rises month over month").
