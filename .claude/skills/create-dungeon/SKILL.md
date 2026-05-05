---
name: create-dungeon
description: Design and create a new dungeon-master dungeon configuration file with realistic events, funnels, and a clean schema. SCHEMA ONLY — no engineered story trends. Hooks are added later by the `write-hooks` skill.
argument-hint: [free-text app description, e.g. "AI meeting assistant" or "B2B logistics platform"]
model: claude-opus-4-6
effort: max
---

# Create a Dungeon (schema only)

Design and write a complete dungeon-master dungeon for: **$ARGUMENTS**

## Scope (post-1.4 split)

This skill produces a **realistic baseline schema** that runs cleanly out of the
box. It does **NOT** engineer story trends or magic numbers — those are the
`write-hooks` skill's job. After this skill produces a dungeon, the next call
should be:

```
/write-hooks dungeons/user/<your-dungeon>.js "describe the trends to engineer"
```

In scope here:
- Event names, weights, properties (with realistic value distributions)
- `superProps` and `userProps` (consistent across users)
- Funnels with `sequence`, `conversionRate`, `timeToConvert`, `weight`,
  `isFirstFunnel`, `attempts`
- Event flags: `isAuthEvent`, `isAttributionEvent`, `isFirstEvent`,
  `isStrictEvent`, `isChurnEvent`, `isSessionStartEvent`
- Top-level: `datasetStart`, `datasetEnd`, `numUsers`, `avgEventsPerUserPerDay`,
  `seed`, `format`, device flags, `avgDevicePerUser`, `hasLocation`,
  `hasCampaigns`, `hasSessionIds`, `hasAvatar`, `macro`, `soup`
- Surviving Phase 2 entities: `personas`, `worldEvents`, `engagementDecay`,
  `dataQuality` — use sparingly

Out of scope (hand off to `write-hooks`):
- The `hook` function (default to no hook OR a tiny stub that stamps superProps
  on injected events)
- Engineered patterns (magic numbers, A/B effects, time-bomb regressions, etc.)

For an encyclopedia of hook patterns, recipes, and real-world examples:
see `HOOKS.md` at the project root.

Removed from the engine in 1.4 (DO NOT use these config keys; they're silently
ignored): `subscription`, `attribution`, `geo`, `features`, `anomalies`.
Recreate with hooks via `write-hooks`.

## Reference reading

Before writing any code, scan:

- `types.d.ts` — the complete API reference. Every Dungeon field, EventConfig
  flag, Funnel option, AttemptsConfig, and Hook meta interface is documented
  with full JSDoc. **Treat this as the source of truth.**
- `lib/utils/utils.js` — `pickAWinner`, `weighNumRange`, `initChance`, `exhaust`,
  `takeSome` for property value distributions
- `dungeons/vertical/sass.js` — B2B reference dungeon, post-1.4 identity model
- `dungeons/user/my-buddy.js` — consumer-app reference (gitignored)
- `dungeons/technical/identity-model-verify.js` — minimal Phase 2 model fixture

## File structure

```javascript
// ── TWEAK THESE ──
const SEED = "dm4-VERTICAL";
const num_days = 120;
const num_users = 5_000;
const avg_events_per_user_per_day = 1.2;
let token = "your-mixpanel-token";
if (process.env.MP_TOKEN) token = process.env.MP_TOKEN;

import dayjs from "dayjs";
import "dotenv/config";
import * as u from "../../lib/utils/utils.js";
import * as v from "ak-tools";

const chance = u.initChance(SEED);

/** @typedef  {import("../../types").Dungeon} Config */

// Generate consistent IDs at module level
const productIds = v.range(1, 200).map(n => `prod_${v.uid(8)}`);

/**
 * ═══════════════════════════════════════════════════════════════
 * DATASET OVERVIEW
 * ═══════════════════════════════════════════════════════════════
 *
 * App Name — what it models, the core user loop, monetization.
 * - N users over M days, ~X events
 * - Key entities and relationships
 * - Why these events/properties were chosen
 *
 * NO STORY TRENDS YET — schema only. Pass to /write-hooks for engineering.
 */

/** @type {Config} */
const config = {
  token, seed: SEED,
  numDays: num_days,
  avgEventsPerUserPerDay: avg_events_per_user_per_day,
  numUsers: num_users,

  // Identity model — see "Identity guidelines" below
  hasAnonIds: true,
  avgDevicePerUser: 2,
  hasSessionIds: true,

  // I/O
  format: "json", gzip: true, writeToDisk: false, concurrency: 1,

  // Realistic platform
  hasLocation: true, hasAndroidDevices: false, hasIOSDevices: false,
  hasDesktopDevices: true, hasBrowser: true, hasAvatar: true,

  funnels: [ /* see "Funnels" below */ ],
  events: [ /* see "Events" below */ ],
  superProps: { /* see "SuperProps" below */ },
  userProps: { /* see "UserProps" below */ },
  scdProps: { /* see "SCDs" below */ },
  groupKeys: [ /* see "Groups" below */ ],

  // No hook — schema only.
};

export default config;
```

## Required components

### 1. Events (~15–20)

15–20 distinct event types covering the app's core loop. Each event:

- `event` — name in **lowercase with spaces** (Mixpanel convention)
- `weight` — relative frequency 1–10 (clamped)
- `properties` — flat property map. Values can be arrays (random pick) or
  utility calls like `u.weighNumRange(1, 100, 0.5, 20)`

**Event flags** (see `types.d.ts` `EventConfig`):

- `isFirstEvent: true` — the user's first-ever event (e.g., "sign up")
- `isAuthEvent: true` — marks the identity stitch moment. See "Identity
  guidelines" below. Multiple events may carry it; the engine looks at the
  first occurrence in the user's stream when stamping inside an `isFirstFunnel`.
- `isAttributionEvent: true` — when `hasCampaigns: true`, only flagged events
  get UTMs (~25% of them). Without flags, ~25% of all events get UTMs (legacy).
- `isStrictEvent: true` — exclude from auto-generated catch-all funnels. Use
  for funnel-only events (Sign Up, Onboarding Question) so they don't bleed
  into the standalone weighted picker.
- `isChurnEvent: true` + `returnLikelihood` — fire-and-stop semantics
- `isSessionStartEvent: true` — auto-prepended 15s before each funnel sequence

When using experiments, include `$experiment_started` in the events array with
`isStrictEvent: true` so the engine schema includes its properties:
```js
{ event: "$experiment_started", weight: 1, isStrictEvent: true, properties: {
    "Experiment name": ["My Experiment"],
    "Variant name": ["Control", "Variant A", "Variant B"],
}}
```

### 2. Funnels (3–6)

- First funnel: includes `isFirstEvent` AND has `isAuthEvent: true` on the
  identity-transition step.
- Usage funnels: ordinary sequences without `isFirstFunnel`. Optionally use
  `attempts` for repeat-usage modeling (abandon-cart pattern).
- Pick `conversionRate` between 30 and 80; `timeToConvert` in hours.

Funnel `props` stamp constant properties on all events in that funnel run.
Use for funnel-level context (checkout flow variant, onboarding version):

```js
{
  sequence: ["View Item", "Add to Cart", "Checkout"],
  conversionRate: 40,
  timeToConvert: 2,
  props: {
    checkout_version: ["v1", "v2"],      // random per funnel run
    payment_method: ["card", "paypal"],
  },
}
```

### 3. SuperProps (2–3)

Properties present on EVERY event. Common picks: `Plan`, `Region`, `Platform`,
`App Version`. Values must come from same enumerations used in `userProps` for
consistency.

### 4. UserProps (4–8)

User profile properties. Set once per user. Use enumerations whose values
match `superProps` for any overlapping keys (so per-event Region matches per-user
Region).

### 5. Groups (0–2)

Use `groupKeys: [["company_id", 250]]` for B2B SaaS. Add `groupProps` for
group attributes. Skip for B2C apps.

### 6. SCDs (0–2)

Slowly-changing dimensions for plan tier, role, etc. JSDoc on `SCDProp` covers
type/frequency/timing/values/max.

### 7. Hook function — DO NOT WRITE

Skip the `hook:` field entirely (engine defaults to pass-through). The
`write-hooks` skill picks this up and engineers the trends.

If you absolutely need a stub for downstream stamping consistency, leave a
1-liner that returns the record unchanged.

## Identity guidelines (Phase 2 model)

The post-1.4 identity model has three knobs:

### `avgDevicePerUser` (whole number, default 0)

| App type | Recommended | Why |
|----------|-------------|-----|
| B2C consumer app, web/mobile single device | 1 | Sticky single device; ratio of user_id to device_id is 1:1 |
| B2B SaaS engineer / knowledge worker | 2 | Laptop + work-from-home laptop; per-session sticky pick |
| Multi-device-heavy product (streaming, fitness) | 2–3 | TV + phone + tablet sessions distinguishable |
| Server / API-only product | 0 | No client device concept |

`hasAnonIds: true` aliases to `avgDevicePerUser: 1`. Set both for clarity.

### `isAuthEvent` placement

Flag the event that represents "user becomes identified". Put it in the
`isFirstFunnel` sequence. Common picks:

- Consumer apps: `Sign Up`, `Login`
- B2B SaaS: `workspace created`, `account created`
- Marketplaces: `Account Activated`

The engine stamps user_id+device_id on this event; pre-auth funnel steps get
device_id only; post-auth funnel steps get user_id only.

### `attempts` (per-funnel, optional)

```js
{
  sequence: ["Land", "Onboarding Question", "Sign Up"],
  isFirstFunnel: true,
  conversionRate: 70,
  attempts: { min: 0, max: 2 },         // 0–2 failed priors → 1–3 total passes
}
```

Typical ranges:

- Direct-acquisition first funnels: `{ min: 0, max: 0 }` (single attempt) or omit
- Shared-link / friction-heavy onboarding: `{ min: 0, max: 2 }` (some retry)
- Re-engagement / abandon-cart usage funnels: `{ min: 0, max: 3 }`

When set, `attempts.conversionRate` (optional) overrides `funnel.conversionRate`
on the FINAL attempt. Failed prior attempts truncate before the first
`isAuthEvent` step (no stitch fires for those attempts).

### Experiments (per-funnel, optional)

Funnels can run A/B/C experiments with `experiment: true` (3 default variants) or
a rich `ExperimentConfig`:

```js
{
  sequence: ["Create Agenda", "Agenda Generated"],
  conversionRate: 60,
  timeToConvert: 0.5,
  name: "Collaborative Agenda",
  experiment: {
    name: "Collaborative Agenda",
    variants: [
      { name: "Control (No Collab)" },
      { name: "Variant A (Ask User)", conversionMultiplier: 1.15, ttcMultiplier: 0.9 },
      { name: "Variant B (Assume + Confirm)", conversionMultiplier: 1.35, ttcMultiplier: 0.7 },
    ],
    startDaysBeforeEnd: 30,
  },
}
```

Key fields (see `ExperimentConfig` in `types.d.ts`):
- `variants[]` — custom names, conversion/TTC multipliers, distribution weights
- `startDaysBeforeEnd` — temporal gating (experiment activates N days before dataset end)
- Variant assignment is **deterministic per user** (hash-based, not random per run)
- Engine injects `$experiment_started` with "Experiment name" and "Variant name" properties
- Add `$experiment_started` to the events array with `isStrictEvent: true` so the schema includes it

Variant-specific downstream effects (e.g., "Variant B boosts downstream event X") go in the `write-hooks` skill via `funnel-post` hooks that check `meta.experiment.variantName`.

### World Events (optional)

Shared temporal events affecting all users. Good for modeling outages, campaigns,
or launches that create visible inflection points:

```js
worldEvents: [
  {
    name: "Black Friday Sale",
    startDay: 55,
    duration: 3,
    affectsEvents: ["Purchase", "Add to Cart"],
    volumeMultiplier: 2.5,
    conversionModifier: 1.3,
    injectProps: { promo_active: true },
  },
  {
    name: "API Outage",
    startDay: 30,
    duration: 1,
    affectsEvents: "*",
    volumeMultiplier: 0.3,
  },
]
```

World events stamp `injectProps` on matching events and modulate volume via
accept/reject sampling. `conversionModifier` affects funnel conversion rates.
See `types.d.ts` `ResolvedWorldEvent` for the full interface.

## Trend shape — `macro` and `soup`

Default to NOT setting either. Defaults: `macro: "flat"` (no birth bias,
50% of users born in dataset window) + `soup: "growth"` (standard intra-week /
intra-day rhythm). The 50% born-in-dataset default ensures retention and
onboarding hooks have large enough cohorts to produce visible signal. Only
override when you have a specific reason:

- Use `macro: "growth"` if you want a mild acquisition trend (visible births
  over the window, 25% born-in-dataset).
- Use `macro: "viral"` only if the app has a hockey-stick acquisition story.
  Pair with `personas` so the late entrants behave differently.
- Use `soup: "spiky"` for products with dramatic peaks / valleys (gaming
  weekends, financial market hours).
- Use `soup: "global"` to flatten all DOW/HOD weights (24/7 server-side products).

## SuperProp consistency rule

If `superProps` and `userProps` both define a property like `Plan`, the
enumeration must match exactly. Otherwise users with `userProps.Plan = 'pro'`
will fire events with `superProps.Plan = 'free'` — Mixpanel will see broken
breakdowns.

```js
const PLANS = ["Free", "Free", "Free", "Pro", "Pro", "Enterprise"];
// ...
superProps: { Plan: PLANS, Region: REGIONS },
userProps:  { Plan: PLANS, Region: REGIONS, Role: ROLES, ... },
```

## Verification

After writing the file:

1. Smoke-test: `node scripts/verify-runner.mjs dungeons/user/<file>.js verify-<file> --small`. Confirm zero errors.
2. Hand to the next skill: `/write-hooks dungeons/user/<file>.js "describe trends"`.
3. After hooks land: `/verify-dungeon dungeons/user/<file>.js`.

## Property Type Reference

Use the correct helper for each Mixpanel property data type. All helpers are imported from `@ak--47/dungeon-master/utils` (already available as `u` in dungeon files).

| Mixpanel Type | Helper | Example |
|---|---|---|
| **String** | Array of options | `["Basic", "Pro", "Enterprise"]` |
| **Numeric** | `weighNumRange()` or array | `u.weighNumRange(1, 100)` or `[10, 20, 50, 100]` |
| **Boolean** | Boolean array | `[true, false, false]` (weighted 33/67) |
| **Date** | `dateRange()` | `dateRange()` (dataset window) or `dateRange('2023-01-01', '2024-01-01')` |
| **List** | `listOf()` | `listOf(["tag1", "tag2", "tag3"], {min: 1, max: 3})` |
| **Object** | Plain object | `{tier: "premium", seats: 5}` |
| **List of Objects** | `objectList()` | `objectList({sku: u.weighNumRange(1000,9999), qty: [1,2,3]}, {min:1, max:4})` |

When designing event properties, always consider which Mixpanel type best represents the data:
- Tags, genres, interests → `listOf()`
- Cart items, line items, participants → `objectList()`
- Subscription start, trial end, next billing → `dateRange()`
- Status, tier, category → string array

## Output

Write the file to `dungeons/user/<descriptive-name>.js`. Do NOT inject hooks.
Do NOT use `subscription`, `attribution`, `geo`, `features`, or `anomalies`
(the engine will silently strip them and warn).

When done, tell the user the next skill to run.
