---
name: write-hooks
description: Use when an existing dungeon needs engineered story trends or "magic number" patterns — writes the `hook` function using atom helpers and high-level patterns. Adds no new event flags; never mutates the schema.
argument-hint: '[path/to/dungeon.js] [free-text story / trend description]'
model: claude-opus-4-6
effort: max
---

# Write Hooks

Engineer story trends into the dungeon at `$ARGUMENTS` (first positional arg)
based on the story description (remaining args).

## Scope

This skill writes the `hook` function ONLY. It assumes the dungeon's schema is
already complete (produced by `create-dungeon`). After writing, hand off to
`/verify-dungeon` to confirm the engineered patterns actually appear.

In scope:
- The `hook: function(record, type, meta) { ... }` body
- Documentation comments above the hook explaining each engineered pattern,
  including a reference Mixpanel report block per pattern and the mandatory
  EXPECTED METRICS SUMMARY table
- The `stories` named export — one machine-checkable story per engineered
  pattern (see "Stories export" below). A hook without stories is
  unverifiable; this skill is not done until the stories exist.

Out of scope:
- Schema changes (events, properties, funnels, superProps, userProps).
  Send missing fields or enumeration changes back to `/create-dungeon` for an
  explicitly authorized schema edit before continuing. This skill never changes schema.
- New top-level config knobs.
- Removing the `hook: function...` body to start over with a new schema.

**Before writing a hook, ask: is this trend structural?** Between-path
comparisons (path X converts worse / slower than path Y, detour-takers drop
off, mix shift drags the blended rate) are better architected as initial
conditions — duplicate funnels with swapped steps/props/`conversionRate`/
`timeToConvert`/`weight` (see the "Structural trend engineering" section in
`create-dungeon`). If a story reduces to structure, recommend the funnel
change back to the schema instead of writing a hook to fight the engine.
Derive the expected effect from the knob, then verify the report against a neutral
control; finite budgets and competing histories can change the measured effect. Hooks are for
within-cohort behavior: segments doing more/less of something over time,
property values that differ by cohort, injected bursts, lifecycle waves.

## Reference reading

- [1.8.1 verification contract](../verify-dungeon/references/alignment-contract.md) - independent reports, neutral controls, counting boundaries, and evidence sufficiency.
- `lib/hook-helpers/index.js` — atoms (cohort, mutate, timing, inject,
  identity). One file per group; full JSDoc on each atom.
- `lib/hook-patterns/index.js` — high-level recipes (one per Mixpanel
  analysis type).
- `lib/verify/emulate-breakdown.js` — what `verify-dungeon` will check.
- `lib/templates/story-spec.schema.json` + `DungeonStory` in `types.d.ts` —
  the story-spec grammar the `stories` export must follow.
- `dungeons/vertical/ecommerce/ecommerce.js` — reference dungeon using a mix
  of atoms and hand-rolled logic, with the mandatory EXPECTED METRICS SUMMARY
  table and a full `stories` export.
- `dungeons/technical/pattern-*.js` — five minimal pattern fixtures, one per
  recipe.
- `HOOKS.md` — encyclopedia of hook recipes organized by story pattern. Contains
  17+ worked examples with code snippets, Mixpanel report instructions, and
  adaptation notes. **Start here** to find the right pattern for your story.

## Hook execution model

Hooks fire in this order per user (see `CLAUDE.md` for the canonical reference):

1. `"user"` — profile created. Mutate in place; return ignored.
2. `"scd-pre"` — SCD entries created. Mutate in place; return ignored.
3. For each funnel: `"funnel-pre"` → `"event"` (per step) → `"funnel-post"`.

**Usage anchors do not accumulate previous funnel TTC.** Each usage run samples
from its eligible window or active day after onboarding. `meta.firstEventTime`
is the supplied anchor, not necessarily the first emitted event time. Persona
and world-event modifiers apply before `funnel-pre`; the hook can mutate
`conversionRate`, `timeToConvert`, and `props` within engine constraints.
4. `"event"` — for non-funnel user events from `events[]`. Return value REPLACES the event.
5. `"everything"` — array of ALL the user's events. Return array to replace.

**Most engineered trends belong in `everything`.** It sees the full user stream,
has access to `meta.profile` / `meta.scd` / `meta.authTime` / `meta.isPreAuth`,
and you can mutate freely.

Storage-only hooks (`ad-spend`, `group`, `mirror`, `lookup`) fire later in the
pipeline and don't see the same `meta` shape.

### Cadence streams and warehouse rows (v1.8.0)

These hooks sit outside the per-user sequence and never enter `everything`.
Neither has person metadata (`meta.profile`, auth state, sessions, or SCDs).

- `standaloneEvents`: `type === 'standalone'` fires on storage push before the
  user loop. Read `meta.spec` and `meta.config` to identify the stream. Return
  the record object or an array of records. Returning `undefined` drops it.
  Mutating without returning is therefore insufficient. Preserve required keys
  and use fresh `insert_id` values for clones. Its synthetic `distinct_id` is a
  series identifier, never a person or a retention cohort.
- `warehouseMetrics`: `type === 'warehouse'` fires after user generation, once
  per materialized row. Mutate the row in place; its return value is ignored.
  Keep the time column and group keys stable. Modify only the value column and
  declared extra columns. Meta includes `spec`, `config`, `metricName`,
  `bucketIndex`, `bucketCount`, `grain`, `seriesKey`, `isBackfill`, and `raw`.
  `raw` describes plus/minus source aggregates before scaling, noise, and carry.

Do not add either schema here. Send missing `standaloneEvents` properties or
warehouse `columns` back to `/create-dungeon`. Warehouse sources consume user
`events[]` only, including both plus and minus legs; they cannot consume cadence
streams. Standalone value functions use tick context, warehouse column functions
use bucket context; neither supplies a user profile.

Verify standalone stories with disk-backed `duckdb` assertions against
`{{PREFIX}}-STANDALONE*.json`. The user-event emulator and `--in-memory` CLI mode
do not evaluate this stream. Warehouse stories can use `warehouse` assertions
or `warehouse-stats` assertions; automatic warehouse audits also run without
stories. Hand off to `/verify-dungeon` with an explicit artifact prefix.

## Hook meta — identity context

Inside `funnel-pre` and `funnel-post`:
- `meta.isFirstFunnel: boolean`
- `meta.isBorn: boolean` (user born inside dataset window)
- `meta.attemptsConfig: { min, max, conversionRate? } | null`
- `meta.attemptNumber, meta.totalAttempts, meta.isFinalAttempt`

Inside `everything`:
- `meta.authTime: number | null` — unix-ms of the stitch event, null if never authed
- `meta.isPreAuth(event): boolean` — convenience predicate
- `meta.profile` — full profile object. Mutate or rescue here.
- `meta.userIsBornInDataset: boolean` — true when user was born inside the dataset window
- `meta.scd: { <key>: SCDEntry[] }` — SCD entries per key
- `meta.datasetStart, meta.datasetEnd: number` — unix-seconds bounds

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
| cohort | `binUsersByEventCount(events, eventName, bins)` | Classify by per-user event count (Insights total events) |
| cohort | `binUsersByEventInRange(events, eventName, start, end, bins)` | Same, time-windowed |
| cohort | `countEventsBetween(events, eventA, eventB)` | Count between first A and first B |
| cohort | `userInProfileSegment(profile, key, values)` | Profile-property cohort check |
| mutate | `cloneEvent(template, overrides)` | Spread+override a template event |
| mutate | `dropEventsWhere(events, predicate)` | In-place filter with count |
| mutate | `scaleEventCount(events, eventName, factor)` | >1 clones, <1 drops. **Targets Insights Total reports.** For frequency-distribution movement use `injectOnNewDays` |
| mutate | `scalePropertyValue(events, predicate, prop, factor)` | Multiply numeric prop |
| mutate | `shiftEventTime(event, deltaMs)` | Shift one event's time |
| timing | `scaleTimingBetween(events, A, B, factor)` | Scale gap between first A and next B |
| timing | `scaleFunnelTTC(funnelEvents, factor)` | Scale all step offsets from anchor |
| timing | `findFirstSequence(events, [names], maxGapMin)` | Detect ordered run within window |
| inject | `injectAfterEvent(events, source, template, gapMs, overrides)` | Splice clone after source |
| inject | `injectBetween(events, A, B, template, overrides)` | Splice at midpoint |
| inject | `injectBurst(events, template, count, anchorTime, spreadMs, overrides)` | Burst around anchor |
| inject | `injectOnNewDays(events, eventName, targetDistinctDays)` | **Cohort-only.** Spreads injections across previously-empty days. Use for cohort-conditional active-day boosts; for global active-day shape, use `Dungeon.avgActiveDaysPerUser` config knob. |
| identity | `isPreAuthEvent(event, authTime)` | Standalone variant of meta.isPreAuth |
| identity | `splitByAuth(events, authTime)` | { preAuth, postAuth, stitch } partition |
| cohort | `hashCohort(id, pct)` | Deterministic pct% cohort (0–100 scale). **Use this first for hidden cohorts** — replaces ad-hoc `charCodeAt % N`. When one dungeon needs several NON-overlapping cohorts, gate on disjoint `hashFloat(uid)` bands instead (e.g. `[0, 0.45)`, `[0.45, 0.70)`) |
| shape | `applyLifecycleWave(events, uid, opts)` | Dormancy window + resurrection burst for Lifecycle reports. When-to-use: the story is "users go quiet, then come back". Gap discipline: ONE stray value moment inside the window destroys the Resurrected read — size `dormantDays` to cover ≥2 whole lifecycle periods, keep the window inside the user's lifespan |
| shape | `applyPathBias(events, uid, opts)` | Inject a Flows path after the user's FIRST anchor occurrence. When-to-use: the story is "X% of users take this route". `share` is a 0–1 FRACTION (not `hashCohort`'s pct scale); needs ~≥0.20–0.25 to survive Sankey top-3-per-level pruning; per-step gaps clamped ≥1s so ordering survives |
| shape | `applySessionShape(events, uid, opts)` | Retime the same records for session-duration/cadence stories. Pass known dataset bounds; explicit-bound mode rejects insufficient capacity before mutation. Legacy unbounded overfull layouts can merge sessions or cross dataset end. Call BEFORE `applyPathBias` so injected paths keep their own tight gaps. |

### Hook anti-patterns

- **DO NOT engineer global active-day distribution in hooks.** Use the
  `Dungeon.avgActiveDaysPerUser` config knob — it's a concentrator that
  preserves total event count while clustering events onto fewer days.
  Hooks own cohort-conditional patterns ("premium users get 7+ days") only.

### Intentional strict-bar deviation is OK

The engine guarantees the no-hook baseline (`dungeons/technical/simplest.js`)
satisfies the per-macro strict bar across the 194-combo sweep matrix
(see [CLAUDE.md "Engine guarantees"](../../../CLAUDE.md#engine-guarantees)).
**Hooks can intentionally violate the strict bar** for legitimate stories:

- **Decline + churn cohort** (engagementDecay or `everything`-hook event-drop)
  produces tail_ratio < 0.4 — well below the decline bar's 0.4 floor. This is
  the design intent of a sunset story.
- **Viral hook + persona-driven late-cohort lift** can push the spike above
  the viral preset's 7.0 cap. Hockey-stick stories are louder than the engine
  baseline.
- **World-event spike** (e.g., a launch-day burst of 5x normal volume) creates
  a single-day right-edge spike above the spike cap.

When you write a hook that intentionally violates the strict bar, document the
deviation in the dungeon's overview JSDoc + the hook's pattern documentation
block. Engine-validation guarantees apply to **no-hook configs only**; hooks
own their shape.
- **DO NOT hand-sort `everything` hook output.** The engine auto-sorts events
  ascending by time after `everything` returns (default ON; opt out via
  `autoSortAfterEverything: false`). Cloned events with arbitrary timestamps
  no longer need explicit sort calls.
- **DO NOT stamp UTM properties from scratch in attribution hooks.** The
  engine caps UTM stamping at `maxTouchpointsPerUser` (default 10) per user,
  sampled across lifetime. Stamping fresh would push users past the cap; your
  stamps would land outside Mixpanel's last-10 lookback window. OVERWRITE
  engine-stamped values instead (e.g., `event.utm_source = "google"` on
  already-stamped touches).

### When to use the verifier primitives

When designing a story, check if any of the new primitives match before
writing a custom hook:

- **Retention curves** ("70% retain at day 1, 30% at day 7") — verify with
  `emulateBreakdown({ type: 'retention', cohortEvent, returnEvent, dayBuckets })`.
  No special hook needed; engineer cohort behavior via `engagementDecay`,
  `dropEventsWhere`, or per-user filtering in `everything`.
- **Session metrics** ("avg session has 6 events, lasts 4 minutes") — verify
  with `emulateBreakdown({ type: 'sessionMetrics' })`. Derive sessions from
  timestamps; stamped `session_id` is diagnostic or explicit legacy mode.
  Engineer with `applySessionShape`, passing known dataset bounds.
- **Reentry funnels** ("power users complete the funnel 3+ times") — set
  `Funnel.reentry: true` (verifier hint). Engineer multiple completions via
  `funnel-post` injecting cloned funnel sequences for that cohort.
- **Exclusion patterns** ("rage-clickers never convert") — declare an event
  in `events[]` (e.g., `rage_click`), set `Funnel.exclusionEvents: ['rage_click']`.
  The generator stamps it on non-converters; the verifier terminates the
  attempt when it sees one.
- **HPC / per-cart funnels** ("checkout completion per item type") — use
  `evaluateFunnelHPC(events, steps, holdProperty)` directly (not auto-routed
  through `funnelFrequency`).
- **Step filters** ("only iOS users complete step 2") — set
  `Funnel.stepFilters: { 1: { prop: 'platform', op: 'eq', value: 'iOS' }}`.
- **Time-series trends** ("conversion rises week over week") — wrap any
  breakdown with `timeBucket: 'week'`. Engineer via temporal-windowed hooks
  using `DATASET_START.add(N, 'days')`.
- **Identity-model dungeons** — when `identity.avgDevicePerUser > 0`
  (or the deprecated `hasAnonIds: true`), pass `profiles` for profile segments.
  For identity proof, pass an explicit `identityMap` derived from emitted valid
  both-ID events. Profile pools alone establish no link; the compatibility helper
  can merge users without emitted stitch evidence. See the shared contract.

**Schema-first reminder:** exclusion events must be declared in `events[]`
before referencing them as `Funnel.exclusionEvents` — the validator throws
on undeclared entries.

### Patterns (`@ak--47/dungeon-master/hook-patterns`)

Higher-level recipes. Each maps to ONE Mixpanel analysis the verify-dungeon
emulator can re-derive.

| Pattern | Mixpanel analysis | Hook type | Caveat (HOOKS.md) |
|---------|-------------------|-----------|-------------------|
| `applyFrequencyByFrequency` | Insights — count(A) by per-user count(B) | everything | `binBy` defaults to `'distinctDays'` (v1.6) — bins match Mixpanel's per-user distinct-day counting, not raw event totals |
| `applyFunnelFrequencyBreakdown` | Funnels - completion by per-user count(X) | funnel-post | Restrict scaling to the target funnel. Completed histories can combine competing instances; verify explicit report options and paired lift instead of assuming the per-run factor equals the report ratio. |
| `applyAggregateByBin` | Insights — avg(prop X) by per-user count(B) | everything | Same `binBy: 'distinctDays'` default as above |
| `applyTTCBySegmentV2` | Funnel TTC by user-property segment | everything | v1 (`applyTTCBySegment`, funnel-post) is deprecated. V2 scales `findFirstSequence`; verify the report's completed histories separately, including restart, grace, windows, and reentry. Neither helper guarantees the requested report ratio. |
| `applyAttributedBySource` | Conversions by Source (first/last touch) | everything | OVERWRITES the engine-stamped touch the chosen model reads; never stamps UTMs onto unstamped events (would blow the `maxTouchpointsPerUser` cap and land outside the last-10 lookback) |

Use a pattern when the trend matches its analysis 1:1. Drop down to atoms when
the trend is bespoke or composite.

### New story archetypes (v1.6) — design rules per report family

Four archetypes joined the story-spec enum in v1.6. Each has a
non-negotiable design rule learned the hard way:

- **`lifecycle-wave`** (`applyLifecycleWave`) — GAP DISCIPLINE. Mixpanel's
  "dormant" state is an `EqualTo 0` filter over the whole period: one stray
  value-moment event inside the dormancy window (including events OTHER hooks
  injected earlier in the same `everything` pass) flips the user out of
  Resurrected. Run the wave AFTER every injecting hook, size `dormantDays` to
  ≥2 lifecycle periods, and keep `dormantFromDay + dormantDays` inside the
  user's lifespan (the future-time guard eats bursts past dataset end).
- **`path-share`** (`applyPathBias`) — FIRST-FLOW ANCHORING. Flows' unique
  counting reads only each user's FIRST flow past the anchor, so the injected
  path must follow the FIRST anchor occurrence (the atom does this; don't
  hand-roll a later anchor). Sankey prunes to the top ~3 branches per level:
  an engineered branch below ~20–25% share silently disappears from the
  visualization even though the data is there. Label-only path reads can
  INVERT when a busier cohort glues extra visible events between path steps —
  assert the share on the cohort you engineered, not globally.
  The helper is append-only: `share` selects injection recipients, not exact
  visible branch share. Keep competing events and measure paired branch lift.
- **`session-shape`** (`applySessionShape`) — 30-MIN STRADDLING + MIDNIGHT
  RULE. The local default derives sessions with a 30-min idle timeout and splits
  at UTC midnight, with a 24-hour maximum. Engineered cadences must keep intra-session gaps clearly
  UNDER 30min and inter-session gaps clearly OVER it — a gap that straddles
  the timeout makes session counts jitter across runs. Never let an
  engineered session cross UTC midnight (the day split cuts it in two). The
  bounded helper checks placement capacity before mutation. Legacy unbounded
  overfull requests can merge sessions. Pass known bounds and measure derived
  sessions; do not infer dataset end from the last observed event.
- **`composition-drift`** — the breakdown's SHARE of a segment moves over
  time while totals stay flat (e.g. plan-mix shifts toward premium). Engineer
  by flipping an existing property value on a date-gated cohort, never by
  changing volumes — volume changes read as `temporal-inflection` instead.
  Assert with a `timeBucket` breakdown comparing first-window vs last-window
  share.

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

(One narrow exception: `meta.profile._drop` is engine-recognized — see
the "Anonymous non-converter `_drop` rescue" section above. All OTHER
flags must live in `userProps`/event `properties` with a declared default.)

DO WRITE:
```js
record.amount *= 3;                            // ✅ scale existing numeric prop
record.payday = true;                          // ✅ ONLY if `payday: [false]` exists in event config
const clone = cloneEvent(template, {time, user_id});  // ✅ clone existing event
events.push(clone);                            // ✅ inject from template
return events.filter(e => !shouldDrop(e));     // ✅ filter inside `everything`
```

If a trend needs an undeclared property, stop that pattern and hand the schema
request to `/create-dungeon`. Resume only after an authorized schema edit declares
the default. Do not add the field or change its enumeration in this skill.

## Identity-aware hook patterns

When a dungeon uses `isAuthEvent`, hooks can branch on auth state:

```js
hook: function(record, type, meta) {
  if (type !== 'everything' || !Array.isArray(record)) return record;
  // Drop pre-auth funnel attempts that fired errors — analytics cleanup
  return record.filter(e => !(e.event === 'API Error' && meta.isPreAuth(e)));
}
```

### Anonymous non-converter `_drop` rescue (v1.5.1)

Born-in-dataset users who never reach an `isAuthEvent` step get
`_drop: true` stamped on their profile BEFORE the `everything` hook fires.
`mixpanel-sender` filters those before pushing to `/engage`. Hooks can
rescue a profile by deleting the flag:

```js
if (type === 'everything' && meta.profile) {
  // Rescue: keep some anonymous power-users in /engage even without sign_up.
  const eventCount = record.length;
  if (eventCount >= 20) delete meta.profile._drop;
}
```

`_drop` is the ONE engine-recognized flag a hook may set/clear on a
profile — every other property must be declared in `userProps` first per
the anti-flag-stamping rule below.

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

### EXPECTED METRICS SUMMARY table (MANDATORY)

The doc block MUST end with an EXPECTED METRICS SUMMARY table — one row per
verifiable read, with the DERIVATION of each expected number from the hook's
knob constants (never a bare number someone has to trust). Follow the style
in `dungeons/vertical/ecommerce/ecommerce.js`:

```
 * EXPECTED METRICS SUMMARY
 * ============================================================================
 *
 * Hook | Metric                          | Derivation          | Expected | Measured (full)
 * -----|---------------------------------|---------------------|----------|----------------
 * H2   | avg watchTimeSec post/pre       | 1.52/0.48           | 3.17x    | 3.19x
 * H6   | sweet/over avg cart item amount | SWEET_CART_BOOST    | 1.25x    | 1.233x
 * H9   | dark/light checkouts per user   | 20/13 diluted       | ~1.48x   | 1.412x
 * ============================================================================
```

Fill the Measured column from the verification run (a reduced-scale iteration
number is fine if labeled). "Diluted" derivations must say WHAT dilutes
(organic events, cohort mixing) — the Derivation column is the anchor
`/verify-dungeon` uses when a read misses.

## Stories export (MANDATORY — the machine contract)

Every engineered pattern ships with one story in a `stories` named export —
the machine-checkable form of the doc block. `scripts/verify-stories.mjs`
evaluates them; `/verify-dungeon` runs it as step 1. Grammar:
`lib/templates/story-spec.schema.json` and `DungeonStory` in `types.d.ts`.

```js
export const stories = [
  {
    id: "H1-power-buyers",
    hook: "H1",
    archetype: "frequency-sweet-spot",
    narrative: "Users with 15+ browse days buy 3x as often as light browsers.",
    mixpanelReport: { type: "Insights", event: "Purchase", breakdown: "per-user count of Browse" },
    assertions: [{
      breakdown: { type: "frequency", event: "Purchase", cohortEvent: "Browse", bins: [5, 15] },
      select: { hi: { where: { bin: ">=15" } }, lo: { where: { bin: "<5" } } },
      expect: { metric: "hi.avg / lo.avg", op: ">=", target: POWER_BUYER_MULT, floor: POWER_BUYER_MULT * 0.8 },
      minCohort: 200,
    }],
  },
];
```

Rules:

- **Thresholds derive from the knob you just wrote.** Export the hook's knob
  constants (`const POWER_BUYER_MULT = 3`) and compute `target` from them —
  never paste the number twice. If the read is diluted (organic mixing),
  derive the dilution too and say so in a comment.
- `floor` must itself be derived (e.g. `target * 0.8`) — never hand-tuned to
  a run. A missed assertion means fixing the hook or the derivation, never
  relaxing the number to match output.
- Set `minCohort` from the planned eligible population, then inspect the actual
  selected-row population fields and independent users/converters. The guard
  does not prove every denominator. Report insufficient evidence separately.
- One story per pattern; story `hook` matches the doc-block numbering (`H3`).
- The `assert` function escape hatch is discouraged — each use needs a
  comment saying why the declarative `expect` grammar can't express it.
- Stories are JS-dungeon-only (`dungeon-to-json` drops them).

## Hook Ordering Within `everything`

The order of operations inside the everything hook matters when hooks interact:

1. **Profile projection** - prefer schema-declared `stickyEventProps`; preserve projected values in clones
2. **Temporal value mutations that DON'T need cloned events** — e.g., version stamping
3. **Behavioral detection + event cloning** — agentic detection, KYC clones, pro clones, magic number clones
4. **Event filtering** — churn, retention, rate-limit drops
5. **Temporal value mutations that NEED cloned events** - e.g., spring price boost, gas spike, outage errors (last mutation)
6. **Return** - the engine auto-sorts after `everything` by default; no manual output sort

**Why:** If a temporal mutation runs before cloning, cloned events that land in
the temporal window miss the mutation. Moving temporal value mutations to the
end ensures ALL events in the window — original and cloned — receive the effect.

## Deprecated Feature Replacement

When a dungeon relied on deprecated config blocks (`subscription`, `attribution`,
`features`, `geo`, `anomalies`) for properties that hooks depend on, those
properties no longer appear in the data. Request an authorized schema migration
through `/create-dungeon` first:

1. Add the property to `superProps` and `userProps` with default values
2. Assign meaningful values in the `user` hook (based on hash, persona, or profile)
3. Use the assigned values in `everything` to drive downstream effects

Example: deprecated `subscription` → add `subscription_tier` to superProps/userProps,
assign tiers by hash in user hook, gate conversion/feature effects on tier in everything.

## Cohort Sizing Guidelines

Cohort detection conditions must be selective enough to create a meaningful
control group, but not so broad they catch everyone:

| Detection | Problem | Fix |
|-----------|---------|-----|
| `events.some(e => e.event === X)` with common X | 90%+ of users qualify | Require 3+ events: `events.filter(...).length >= 3` |
| `charCodeAt(0) % 50 === 0` | First-character distributions are biased; modulo does not imply 2% | Use `hashCohort(uid, 2)` and measure the realized population |
| `profile.tier === "premium"` | Fixed by config distribution | Request a schema distribution change if cohort is too small |
| `earlyEvents.length >= 5` for a low-weight event | 0% qualify (impossible threshold) | Check actual distribution first, set at ~80th percentile |

Target: 10-30% of users in the affected cohort for clean signal at 10K users.

### Threshold Calibration

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

### Compounding Drop Hooks

Use at most ONE drop-based retention hook per dungeon. Multiple hooks that
each drop events after the same day threshold compound destructively:

- Hook A: drop 40% after day 21 for non-loyal users
- Hook B: drop 60% after day 21 for non-streak users
- Combined: 76% drop for users in both groups (which is 95% of users)

The control group barely exists. Fix: use boost-based patterns
(`scaleEventCount(events, "X", 1.8)`) for positive cohorts instead of drops
for negative cohorts. Boosts are additive and don't interact destructively.
Reserve drops for a single churn/retention effect per dungeon.

## Common Hook Pitfalls

Apply these BEFORE handing off to `/verify-dungeon`. See HOOKS.md §9 for full recipes.

### Opt out of strict events only when standalone occurrences are required

If your hook reads `event === 'X'` and `X` is also a funnel-step event, the
validator auto-promotes it to `isStrictEvent: true` and the engine
won't emit standalone occurrences. Funnel-generated occurrences remain readable;
only a cohort that depends on additional standalone traffic needs the opt-out.

```js
// BAD — login is a funnel step + read by hook
events: [{ event: 'login', weight: 4, properties: {...} }]
// GOOD — explicit opt-out preserves standalone occurrences
events: [{ event: 'login', weight: 4, isStrictEvent: false, properties: {...} }]
```

Audit whether the cohort needs standalone occurrences. Request any required
`isStrictEvent: false` schema edit through `/create-dungeon`; do not change it here.

### Reentry on per-instance loops

**`reentry` is verifier-only.** Usage volume, funnel selection, and the event
budget control generated repetitions. Set `reentry: true` for a report that
counts repeated histories; it does not generate loops. Local totals also
default to `reentry: false`, so preserve the report's explicit counting options.

### Hash-based cohorts produce textbook signals

Cleanest hidden-cohort pattern. No flag, no schema mutation, easy to verify
deterministically:

```js
// 2% whales with 50x trade amount → long-tail Insights distribution
const isWhale = hashCohort(uid, 2);
if (isWhale && e.event === 'swap') e.trade_amount_usd *= 50;
```

Use a large multiplier (≥10x, ideally 50x) so the signal beats soup noise.
Use `hashCohort(uid, 2)`, `hashCohort(uid, 4)`, or `hashCohort(uid, 10)` for
those target percentages, then check realized eligible cohort sizes.

### Hook ordering inside `everything`

If hook A injects events that hook B mutates, B must run AFTER A in the
same `everything` block — otherwise the injected events miss B's mutation.
The existing "Hook Ordering Within `everything`" section above codifies
this; the eval revealed it as the single most common subtle bug.

### Avoid behavioral cohorts where the gating event IS the signal

If hook says "users who did X often → reduce X count", the verifier sees
inverted signal because users with high X naturally have higher absolute
counts even after reduction. Either:
- Use hash cohort for the same effect, OR
- Verify by per-user post/pre ratio instead of raw counts

### Don't reference profile.X unless X is a defined userProp

```js
// BAD — profile.level isn't in userProps; resolves to undefined
if (meta.profile.level >= 50) e.gold_earned *= 3;
// Request a schema declaration before targeting this profile segment.
```

When the hook references a missing profile field, you can still get the
data spread you want (gold range), but the cohort can't be analytically
recovered. Request the missing userProp through `/create-dungeon`, or rewrite
the hook to use a hash cohort without changing schema.

## Workflow

1. Read the dungeon at `$ARGUMENTS[0]` and understand the existing schema.
2. Translate the user's story description into 3–5 engineered patterns.
   Consult `HOOKS.md` for recipe ideas that match the user's story. Each recipe
   includes the hook type, code snippet, and Mixpanel report format.
3. **Calibrate thresholds against the real distribution.** Before choosing
   any "N+ events" gate or cohort cutoff, generate a small run and query the
   actual per-user distribution (see "Threshold Calibration" above for the
   query). Set gates at ~the 80th percentile of what the data shows — a
   threshold picked from intuition is the most common cause of empty cohorts.
   ```bash
   node scripts/verify-runner.mjs <dungeon> calib --small
   ```
4. For each pattern:
   - Pick a pattern from `lib/hook-patterns/` if it fits the analysis 1:1.
   - Otherwise compose atoms from `lib/hook-helpers/`.
   - Document the pattern in a comment block (Mixpanel report instructions).
5. Write the `hook` function, importing atoms/patterns at the top of the
   file. Finish the doc block with the EXPECTED METRICS SUMMARY table.
6. Write the `stories` export — one story per pattern, `target`/`floor`
   derived from the exported knob constants (see "Stories export" above).
7. Smoke-test generation, then evaluate the stories:
   ```bash
   node scripts/verify-runner.mjs <dungeon> verify-dungeon --small
   node scripts/verify-stories.mjs <dungeon> --data-prefix verify-dungeon
   ```
   Reduced-scale runs legitimately cap at WEAK on `minCohort` guards; what
   you're checking here is no NONE/INVERSE and no assertion errors.
8. Hand off:
   ```
   /verify-dungeon <dungeon>
   ```
   If verify-dungeon returns WEAK, NONE, or INVERSE on any pattern at full
   fidelity, return to step 4 and refine — fix the hook or the derivation,
   never relax a threshold to match output. Iterate until all patterns score
  STRONG or NAILED with report semantics, neutral controls, and sufficient
  independent populations verified. Insufficient evidence requires more evidence,
  not an automatic hook rewrite or a weaker target.

## Stopping condition

Stop after `/verify-dungeon` reports all engineered patterns as STRONG or NAILED
and the shared proof contract is satisfied,
OR after three iterations without convergence — at that point, document what's
still off in the dungeon's overview comment and report the gap to the user.

## Output

Modify the dungeon file in place. Add the `hook` function. Add the imports.
Add the documentation block (with EXPECTED METRICS SUMMARY) above the config.
Add the `stories` export after the config. Do NOT modify any other file.
Tell the user to run `/verify-dungeon <dungeon>` next.
