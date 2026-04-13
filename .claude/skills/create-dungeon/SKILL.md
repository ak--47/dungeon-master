---
name: create-dungeon
description: Design and create a new dungeon-master dungeon configuration file with realistic events, funnels, and deliberately architected analytics hooks that create discoverable insights.
argument-hint: []
model: claude-opus-4-6
effort: max
---

# Create a Dungeon

Design and build a complete dungeon-master dungeon for: **$ARGUMENTS**

## Your Task

Create a single `.js` file in `dungeons/vertical/` that defines a complete, realistic data schema for the described app/vertical. The dungeon must include deliberately architected analytics "hooks" — hidden trends and patterns that simulate real-world product insights buried in large datasets.

Before writing any code, read these reference files to understand patterns and conventions:
- `types.d.ts` — **the complete API reference** for all config options, event flags, hook types, SCD props, funnel options, and type definitions. Every feature is documented with JSDoc comments.
- `lib/utils/utils.js` — search for `pickAWinner`, `weighNumRange`, `initChance`, `exhaust`, `takeSome` to understand available utilities
- `lib/generators/events.js` — search for `hook` to see how `type === "event"` hooks are called (properties are FLAT on record)
- `lib/generators/funnels.js` — search for `hook` to see `funnel-pre` and `funnel-post` invocation
- `lib/orchestrators/user-loop.js` — search for `hook` to see `user`, `scd-pre`, and `everything` invocation
- `lib/core/config-validator.js` — understand validation rules (especially funnel event name matching)

If you wish, you can view how existing ./dungeons are structured for reference and how ./customers dungeons are for specific customers. Try to provide a realistic event/prop/user schema with the context you have from the prompt.

## File Structure

The file is organized so humans (and AI) can understand the intent before reading code:

1. **Imports + constants** — boilerplate, seed, IDs
2. **Dataset Overview** — what app this models, scale, core loop, monetization
3. **Analytics Hooks** — each hook with quick Mixpanel report steps
4. **Code** — the config object, with inline comments in the hook function explaining each mutation

```javascript
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import "dotenv/config";
import * as u from "../lib/utils/utils.js";
import * as v from "ak-tools";

const SEED = "dm4-VERTICAL";
dayjs.extend(utc);
const chance = u.initChance(SEED);
const num_users = 5_000;
const days = 100;

/** @typedef  {import("../types").Dungeon} Config */

// Generate consistent IDs at module level
const entityIds = v.range(1, N).map(n => `prefix_${v.uid(8)}`);

/**
 * ═══════════════════════════════════════════════════════════════
 * DATASET OVERVIEW
 * ═══════════════════════════════════════════════════════════════
 *
 * App Name — what it models, the core user loop, monetization.
 * - N users over M days, ~X events
 * - Key entities and relationships
 * - Why these events/properties were chosen
 */

/**
 * ═══════════════════════════════════════════════════════════════
 * ANALYTICS HOOKS
 * ═══════════════════════════════════════════════════════════════
 *
 * 1. HOOK NAME (hook type: event/everything/funnel-pre/etc.)
 *    What it does to the data and why.
 *
 *    Mixpanel Report:
 *    • Type: Insights | Funnels | Retention
 *    • Event: "event_name"
 *    • Measure: Average of "property"
 *    • Breakdown: "segment_property"
 *    • Expected: segment_a ~Nx higher than segment_b
 *
 * 2. NEXT HOOK NAME (hook type)
 *    ...
 *
 * ═══════════════════════════════════════════════════════════════
 * EXPECTED METRICS SUMMARY
 * ═══════════════════════════════════════════════════════════════
 *
 * Hook            | Metric          | Baseline | Effect | Ratio
 * ────────────────|─────────────────|──────────|────────|──────
 * Hook Name       | order_total     | $50      | $150   | 3x
 */

/** @type {Config} */
const config = {
  // ... events, funnels, props ...

  hook: function (record, type, meta) {
    if (type === "everything") {
      // ── HOOK 1: HOOK NAME ──────────────────────────────────
      // Explain what this block does and why
      // e.g., "Boost order values 1.5x for premium users"
      // ...mutations with inline comments...
    }
    return record;
  }
};

export default config;
```

**Key principles:**
- Documentation comes BEFORE code so intent is clear before implementation
- Hook code has inline comments explaining each mutation (what it does to engineer the trend)
- No giant doc block after `export default` — all docs are above the config
- Mixpanel report steps are concise and actionable (report type, event, measure, breakdown, expected result)

## Base Config (use these exact values)

```javascript
token: "",
seed: SEED,
numDays: days,
numEvents: num_users * 120,
numUsers: num_users,
hasAnonIds: false,
hasSessionIds: true,
format: "json",
gzip: true,
alsoInferFunnels: false,
hasLocation: true,
hasAndroidDevices: true,
hasIOSDevices: true,
hasDesktopDevices: true,
hasBrowser: false,
hasCampaigns: false,
isAnonymous: false,
hasAdSpend: false,
percentUsersBornInDataset: 35,
hasAvatar: true,
batchSize: 2_500_000,
concurrency: 1,
writeToDisk: false,
scdProps: {},
mirrorProps: {},
lookupTables: [],  // NEVER add lookup tables — they require manual import and are not automated ... only if the user BEGS you.
```

## Advanced Features (Optional — use when they add realism)

These features are **additive and optional**. Include them when they make the dungeon's story richer. Hooks always override these features — hooks are the final authority on every data point.

### Personas (`personas`)

Define behavioral user archetypes. Replaces the random power-user dice rolls with structured segments. Each persona gets `eventMultiplier` (event volume), `conversionModifier` (funnel conversion), `properties` (merged into profile), and optional `churnRate` / `activeWindow`.

```javascript
personas: [
  { name: "power_user", weight: 15, eventMultiplier: 4.0, conversionModifier: 1.5, churnRate: 0.02,
    properties: { segment: "power", loyalty_tier: "gold" } },
  { name: "casual", weight: 50, eventMultiplier: 0.6, conversionModifier: 0.7, churnRate: 0.1,
    properties: { segment: "casual", loyalty_tier: "none" } },
  { name: "churner", weight: 20, eventMultiplier: 0.4, conversionModifier: 0.3, churnRate: 0.6,
    properties: { segment: "churner" }, activeWindow: { maxDays: 14 } },
  { name: "champion", weight: 15, eventMultiplier: 2.5, conversionModifier: 1.5,
    properties: { segment: "champion", loyalty_tier: "platinum" } }
]
```

Personas flow through hook `meta.persona` — hooks can read and override persona assignments.

### World Events (`worldEvents`)

Shared events that affect all users simultaneously. Create correlated cross-user temporal patterns.

```javascript
worldEvents: [
  { name: "black_friday", type: "campaign", startDay: 60, duration: 3,
    volumeMultiplier: 2.5, conversionModifier: 1.8,
    injectProps: { promo: "black_friday" }, affectsEvents: ["checkout"] },
  { name: "outage", type: "outage", startDay: 40, duration: 0.125,
    volumeMultiplier: 0.05, affectsEvents: "*",
    aftermath: { duration: 1, volumeMultiplier: 1.3 } },
  { name: "v2_launch", type: "product_launch", startDay: 50,
    duration: null, injectProps: { app_version: "2.0" } }
]
```

### Engagement Decay (`engagementDecay`)

Gradual engagement decline instead of binary churn. Users' event frequency decreases over their lifetime.

```javascript
engagementDecay: { model: "exponential", halfLife: 45, floor: 0.1, reactivationChance: 0.03 }
```

### Data Quality (`dataQuality`) — ONLY IF EXPLICITLY REQUESTED

**Do NOT include `dataQuality` unless the user explicitly asks for dirty/messy data.** 99% of the time, dungeons should produce clean, perfect test data. Data quality gremlins (nulls, duplicates, bots) are for testing data pipelines and anomaly detection, not for standard demo datasets.

```javascript
// Only add if user specifically asks for messy/dirty/realistic data quality issues
dataQuality: { nullRate: 0.02, nullProps: ["category"], duplicateRate: 0.005,
  botUsers: 3, botEventsPerUser: 500, timezoneConfusion: 0.01 }
```

### Subscription (`subscription`)

Full revenue lifecycle: trial → paid → upgrade → downgrade → cancel → win-back.

```javascript
subscription: {
  plans: [
    { name: "free", price: 0, default: true },
    { name: "pro", price: 19.99, trialDays: 14 },
    { name: "enterprise", price: 99.99 }
  ],
  lifecycle: { trialToPayRate: 0.3, upgradeRate: 0.1, churnRate: 0.05, winBackRate: 0.1 }
}
```

### Attribution (`attribution`)

Connected campaign attribution — links ad spend to user acquisition.

```javascript
attribution: {
  campaigns: [
    { name: "google_ads", source: "google", medium: "cpc", activeDays: [0, 90],
      dailyBudget: [200, 800], acquisitionRate: 0.03 }
  ],
  organicRate: 0.4
}
```

### Geo (`geo`)

Sticky locations, timezone-aware activity, regional properties.

```javascript
geo: {
  sticky: true,
  regions: [
    { name: "us", countries: ["US"], weight: 50, timezoneOffset: -5, properties: { currency: "USD" } },
    { name: "eu", countries: ["GB", "DE"], weight: 30, timezoneOffset: 1, properties: { currency: "EUR" } }
  ]
}
```

### Features (`features`)

Progressive feature adoption with S-curve rollout.

```javascript
features: [
  { name: "dark_mode", launchDay: 30, adoptionCurve: "fast", property: "theme",
    values: ["light", "dark"], defaultBefore: "light", affectsEvents: "*" }
]
```

### Anomalies (`anomalies`)

Extreme values, error bursts, coordinated spikes.

```javascript
anomalies: [
  { type: "extreme_value", event: "checkout", property: "amount", frequency: 0.005, multiplier: 50, tag: "whale" },
  { type: "burst", event: "error", day: 45, duration: 0.08, count: 500, tag: "error_storm" },
  { type: "coordinated", event: "sign up", day: 70, window: 0.01, count: 150, tag: "viral" }
]
```

## TimeSoup — Time Distribution (usually omit this)

**DEFAULT BEHAVIOR: Do NOT include `soup` in the config unless the user's prompt explicitly asks for a specific time distribution pattern** (e.g., "make it spiky", "seasonal pattern", "global users"). The default "growth" preset applies automatically and is correct for the vast majority of dungeons. Do not infer a preset from the vertical — a gaming dungeon does NOT automatically need "spiky", an e-commerce dungeon does NOT automatically need "seasonal". Only set `soup` when the user says so.

If the user does request a specific time pattern, use one of these presets:

```javascript
soup: "steady"     // flat, mature SaaS (low variation)
soup: "growth"     // gradual uptrend with realistic weekly cycle (this is the default if omitted)
soup: "spiky"      // dramatic peaks and valleys
soup: "seasonal"   // 3-4 major waves across the dataset
soup: "global"     // flat DOW + flat HOD (no cyclical patterns)
soup: "churny"     // flat distribution, no growth (pair with churn hooks for declining pattern)
soup: "chaotic"    // wild variation, few tight peaks
```

For fine-grained custom control (only if the user specifically asks):

```javascript
// Preset + overrides
soup: { preset: "spiky", deviation: 5 }

// Fully custom — see lib/templates/soup-presets.js for weight arrays
soup: {
  peaks: 200,                    // Gaussian clusters (default: numDays*2)
  deviation: 2,                  // peak tightness (higher = tighter)
  mean: 0,                       // offset from chunk center
  dayOfWeekWeights: [/* 7 values, Sun..Sat, max=1.0 */],
  hourOfDayWeights: [/* 24 values, 0=midnight UTC, max=1.0 */],
}
```

## Required Components

### 1. Events (15-20)
- Include `isFirstEvent: true` on the signup/account creation event
- **Plain string arrays are automatically power-law weighted** — `["a", "b", "c", "d"]` (3+ unique strings) gets `pickAWinner` applied under the hood by `choose()`. Do NOT wrap these in `pickAWinner()` explicitly.
- Use `u.pickAWinner(array, integerIndex)` ONLY when you need to designate a specific array index as the "winner" (most frequent). This is the only valid use case for `pickAWinner`.
- For boolean or 2-item probability weighting, use **duplicate arrays**: `[false, false, true]` for ~33% true, `[false, false, false, true, true]` for ~40% true. Never pass decimals as the second argument to `pickAWinner` — it treats them as array indices, producing undefined values.
- Use `u.weighNumRange(min, max, skew?, center?)` for numeric ranges (Box-Muller)
- Use arrays with **duplicates** for explicit frequency weighting: `["common", "common", "common", "rare"]`
- Each event needs `event` (name), `weight` (relative frequency 1-10), `properties` (object)

#### Event Flags (see `types.d.ts` EventConfig for full reference)
- `isFirstEvent: true` — marks the signup/onboarding event (used for first funnels)
- `isChurnEvent: true` — when generated, signals the user has churned and stops further event generation. Pair with `returnLikelihood` (0-1) to control whether users can come back (0 = permanent churn, 1 = always returns). Mark churn events with `isStrictEvent: true` so they don't end up in auto-generated funnels.
- `isSessionStartEvent: true` — automatically prepended 15 seconds before each funnel (e.g., `$session_started`). Use for session tracking events.
- `isStrictEvent: true` — excluded from auto-generated funnels (both `inferFunnels` and the catch-all). Use for system events, churn events, or events that shouldn't appear in conversion sequences.

### 2. Funnels (3)
- Mark one with `isFirstFunnel: true` (onboarding funnel)
- Set `conversionRate` (0-1) and `timeToConvert` (days)
- **CRITICAL**: Every event name in `sequence` arrays MUST exist in the `events` array

### 3. SuperProps (2-3)
- Properties that appear on EVERY event (platform, subscription tier, etc.)
- These are accessible in hooks via `record.propName` on every event

### 4. UserProps (4-6)
- User profile properties set once per user

### 5. Groups (0-2)
- Format: `["group_key", count, ["event1", "event2"]]`
- With corresponding `groupProps` object

### 6. Hook Function (8 hooks)
- Single `hook: function(record, type, meta) { ... return record; }` function
- Must implement exactly **8** deliberately architected analytics patterns

## Hook System Reference

### Hook Types and When They Fire

| Type | `record` is | Return behavior | Fires in |
|------|-------------|-----------------|----------|
| `"event"` | Single event object (flat props) | Return value replaces event (must be single object) | `events.js` per event |
| `"user"` | User profile object | Ignored — mutate in-place | `user-loop.js` per user |
| `"funnel-pre"` | Funnel config `{sequence, conversionRate, timeToConvert, props}` | Ignored — mutate in-place | `funnels.js` before generation |
| `"funnel-post"` | Array of generated funnel events | Ignored — mutate in-place | `funnels.js` after generation |
| `"scd-pre"` | Array of SCD entries | Return array to replace, or mutate in-place | `user-loop.js` before SCD write |
| `"everything"` | Array of ALL events for one user | Return array to replace event list | `user-loop.js` after all events generated |

### Critical Hook Rules

1. **The schema is defined in the config. Hooks shape the data within that schema.** Every property that appears in the final output MUST be defined in the dungeon config (events `properties`, `userProps`, or `superProps`). Hooks do NOT invent new properties out of thin air. They modify values of properties that already exist.

2. **To make hooks work, define the properties they need in the config with defaults.** This is the key pattern. If your hook needs a `payday` flag on transactions, add `payday: [false]` to the event's `properties`. If your hook needs a `surge_pricing` boolean, add `surge_pricing: [false]`. The hook then sets these to `true` when conditions are met. This ensures:
   - The property exists on ALL events of that type (consistent schema)
   - The JSON schema output is complete (no surprise columns)
   - The dataset presents a clean, predictable schema to downstream tools
   
   ```javascript
   // In events config: define the property with a default
   { event: "transaction completed", weight: 5, properties: {
       amount: { $range: [10, 500] },
       transaction_type: ["direct_deposit", "transfer", "payment"],
       payday: [false],  // ← hook will set true on 1st/15th
   }}
   
   // In hook: modify the existing property
   if (record.event === "transaction completed" && record.transaction_type === "direct_deposit") {
     if (dayOfMonth === 1 || dayOfMonth === 15) {
       record.amount = Math.floor(record.amount * 3);
       record.payday = true;  // modifying existing property, not adding new one
     }
   }
   ```

3. **Properties are FLAT on event records in hooks** — use `record.amount`, NOT `record.properties.amount`

4. **When injecting events, always clone from an existing event** of the same type using spread (`{...templateEvent}`), then override `time` and `user_id` and tweak values. This ensures injected events have the same properties as organically generated ones. Never construct events from scratch with hand-picked properties.

5. Use `dayjs` for all time operations inside hooks

6. Use the seeded `chance` instance (from module scope) for randomness in hooks

7. **Always return `record`** at the very end of the hook function. Every code path must reach `return record`.

8. **To drop/filter events** (for churn, drop-off, or trend patterns): use the `everything` hook:
   - **Direct filter**: `return record.filter(e => !shouldDrop(e))`
   - **Splice removal**: iterate backwards and `splice(i, 1)` to remove events
   
   This is critical for architecting churn, drop-off, seasonal dips, and other "absence of data" patterns. The `everything` hook is the ONLY place where events can be removed.

### Hook Technique Catalog

Use a MIX of these techniques across your 8 hooks — don't put everything in `"everything"`:

#### Event-Level Techniques (`type === "event"`)

- **Value modification**: Multiply, scale, or shift existing property values based on conditions. `record.amount *= 1.5`
- **Temporal windowing**: Modify existing values within a date range using relative dates:
  ```javascript
  const DATASET_START = NOW.subtract(days, 'days');
  const LAUNCH_DATE = DATASET_START.add(45, 'days');
  if (dayjs(record.time).isAfter(LAUNCH_DATE)) { record.amount *= 2; }
  ```
- **Day-of-week/month patterns**: Scale values based on calendar (payday spending spikes, weekend surges)
- **Closure-based state (Maps)**: Module-level Maps track state across calls. E.g., user who exceeded budget → next scale event forced to existing value "down"

#### User-Level Techniques (`type === "user"`)

- **Value modification**: Change existing userProps values based on conditions. If `company_size` is already a userProp, the hook can change its value for specific segments.
- Note: any property modified in the `user` hook must already be defined in `userProps` in the config

#### Funnel Techniques (`type === "funnel-pre"` / `"funnel-post"`)

- **Conversion rate manipulation** (funnel-pre): `record.conversionRate *= 1.3` for premium users, `*= 0.6` for free
- **Event injection** (funnel-post): Splice events between funnel steps by cloning from existing events of the same type
- **Time-to-convert manipulation** (funnel-pre): `record.timeToConvert *= 0.5` for power users

#### Everything Techniques (`type === "everything"`) — Most Powerful

The `"everything"` hook is the most powerful because it sees ALL events for one user AND has access to `meta.profile`. This enables **cross-table correlation** — driving event behavior based on user profile properties:

- **Two-pass processing**: First pass scans for behavioral signals (session count, purchase history, feature usage), second pass modifies existing values based on findings
- **Sessionization**: Cluster the event stream by inactivity gaps (e.g., 30 min) to derive session count, then use session count to drive modifications
- **Value scaling by segment**: Use `meta.profile` properties to scale existing event values differently for different segments (power users get 3x purchase amounts with jitter)
- **Event filtering/dropping (churn, drop-off, seasonal dips)**: `return record.filter(e => ...)` — the ONLY way to remove events
- **Event injection by cloning**: Find sessions/windows where a behavior almost happened, inject a cloned event (spread from an existing event of the same type) with tweaked values
- **Event duplication**: Clone existing events with time offsets (viral cascades, weekend surges)

#### Relative Date Patterns (Important!)

Always define time windows relative to `DATASET_START`, not absolute dates. This makes hooks work regardless of `numDays`:

```javascript
const NOW = dayjs();
const DATASET_START = NOW.subtract(days, 'days');  // 'days' from module scope

// Product launch happened 25 days ago
const LAUNCH_DATE = NOW.subtract(25, 'days');

// Promotional period: started 40 days in, ended 55 days in
const PROMO_START = DATASET_START.add(40, 'days');
const PROMO_END = DATASET_START.add(55, 'days');

// Last week's outage
const OUTAGE_START = NOW.subtract(7, 'days');
const OUTAGE_END = NOW.subtract(3, 'days');
```

### Aim for this distribution across your 8 hooks:
- 2-3 `event` hooks (property modification, temporal windows, day-of-week)
- 3-4 `everything` hooks — this is the most powerful hook type; it sees the user's full event history AND `meta.profile`, enabling cross-table correlation, two-pass analysis, churn simulation, event injection, and behavioral segmentation. Lean heavily on this.
- 1-2 of: `user`, `funnel-pre`, or `funnel-post`
- 0-1 using module-level closure state (Maps)

### Hook Reference Examples

These are proven, production-tested implementations. Use them as templates. Notice: none of these examples add new properties. They modify existing values and inject events by cloning from existing ones.

#### Example 1: Sessionization + Power User Scaling (everything hook)

The most important pattern. Sessionize the event stream, derive behavioral signals, then modify existing values. No new properties are added.

```javascript
if (type === "everything") {
  const events = record;

  // Sessionize: cluster events by 30-min inactivity gaps
  let sessions = [[]];
  for (let i = 0; i < events.length; i++) {
    sessions[sessions.length - 1].push(events[i]);
    if (i < events.length - 1) {
      const gap = dayjs(events[i + 1].time).diff(dayjs(events[i].time), "minutes");
      if (gap > 30) sessions.push([]);
    }
  }

  const isPowerUser = sessions.length > 20;

  if (isPowerUser) {
    // Scale existing purchase amounts (with jitter so it looks organic)
    events.forEach(e => {
      if (e.event === "purchase") {
        e.amount = Math.floor(e.amount * (2.5 + Math.random() * 1.0));
      }
    });

    // Find sessions where they browsed but didn't buy, inject a purchase
    // by cloning an existing purchase event (preserves schema)
    const templatePurchase = events.find(e => e.event === "purchase");
    if (templatePurchase) {
      sessions.forEach(session => {
        const hasBrowse = session.some(e => e.event === "view item");
        const hasPurchase = session.some(e => e.event === "purchase");
        if (hasBrowse && !hasPurchase && chance.bool({ likelihood: 40 })) {
          const lastEvent = session[session.length - 1];
          events.push({
            ...templatePurchase,  // clone all existing properties
            time: dayjs(lastEvent.time).add(chance.integer({ min: 1, max: 5 }), "minutes").toISOString(),
            user_id: lastEvent.user_id,
            amount: Math.floor(templatePurchase.amount * (0.8 + Math.random() * 0.4)),
          });
        }
      });
    }
  }

  return record;
}
```

#### Example 2: Churn Simulation via Reverse Splice (everything hook)

Drop events to simulate disengagement. Iterate backwards to avoid index corruption. No new properties.

```javascript
if (type === "everything") {
  const events = record;
  const firstTime = events.length > 0 ? dayjs(events[0].time) : null;

  // Identify churn candidates by scanning existing behavior
  let joinedEarly = false;
  let hasLowScore = false;
  events.forEach(e => {
    const days = firstTime ? dayjs(e.time).diff(firstTime, 'days', true) : 0;
    if (e.event === "group joined" && days <= 10) joinedEarly = true;
    if (e.event === "quiz completed" && e.score < 60) hasLowScore = true;
  });

  if (!joinedEarly && hasLowScore) {
    // Remove 70% of events after day 14 (churn)
    const cutoff = firstTime ? firstTime.add(14, 'days') : null;
    for (let i = events.length - 1; i >= 0; i--) {
      if (cutoff && dayjs(events[i].time).isAfter(cutoff)) {
        if (chance.bool({ likelihood: 70 })) {
          events.splice(i, 1);
        }
      }
    }
  }

  return record;
}
```

#### Example 3: Closure-Based State with Maps (event hook)

Module-level Maps enable cross-event causality: one event sets state, a later event reads and reacts by modifying existing values. No new properties.

```javascript
// ── Module scope (outside config object) ──
const costOverrunUsers = new Map();
const failedDeployUsers = new Map();

// ── Inside hook function ──
if (type === "event") {
  // Cost overrun → forced scale-down on next infrastructure event
  // scale_direction and cost_change_percent are already in the event schema
  if (record.event === "cost report generated" && record.cost_change_percent > 25) {
    costOverrunUsers.set(record.user_id, true);
  }
  if (record.event === "infrastructure scaled" && costOverrunUsers.has(record.user_id)) {
    record.scale_direction = "down";  // set to existing enum value
    costOverrunUsers.delete(record.user_id);
  }

  // Failed deploy → recovery deploy takes 1.5x longer
  // duration_sec and status are already in the event schema
  if (record.event === "deployment pipeline run") {
    if (record.status === "failed") {
      failedDeployUsers.set(record.user_id, true);
    } else if (record.status === "success" && failedDeployUsers.has(record.user_id)) {
      record.duration_sec = Math.floor(record.duration_sec * 1.5);
      failedDeployUsers.delete(record.user_id);
    }
  }
}
```

#### Example 4: Funnel-Post Event Injection by Cloning (funnel-post hook)

Inject events between funnel steps by cloning from an existing event in the funnel. Preserves schema.

```javascript
if (type === "funnel-post") {
  if (Array.isArray(record) && record.length >= 2) {
    const firstEvent = record[0];

    // Free users sometimes get an extra step cloned into the funnel
    if (firstEvent.subscription_tier === "Free" && chance.bool({ likelihood: 30 })) {
      const insertIdx = chance.integer({ min: 1, max: record.length - 1 });
      const prevEvent = record[insertIdx - 1];
      const nextEvent = record[insertIdx];
      const midTime = dayjs(prevEvent.time).add(
        dayjs(nextEvent.time).diff(dayjs(prevEvent.time)) / 2, 'milliseconds'
      ).toISOString();

      // Clone from the previous funnel step, just change the time
      record.splice(insertIdx, 0, {
        ...prevEvent,
        time: midTime,
      });
    }
  }
}
```

#### Example 5: User Profile Value Modification (user hook)

Modify existing userProp values based on conditions. All properties here must already be defined in the `userProps` config.

```javascript
if (type === "user") {
  // company_size, seat_count, and annual_contract_value are all in userProps
  if (record.company_size === "enterprise") {
    record.seat_count = chance.integer({ min: 50, max: 500 });
    record.annual_contract_value = chance.integer({ min: 50000, max: 500000 });
  } else if (record.company_size === "startup") {
    record.seat_count = chance.integer({ min: 1, max: 5 });
    record.annual_contract_value = chance.integer({ min: 0, max: 3600 });
  }
}
```

#### Example 6: Day-of-Month Value Scaling (event hook)

Modify existing property values based on calendar patterns. No new properties added.

```javascript
if (type === "event") {
  const dayOfMonth = dayjs(record.time).date();

  // Payday cycle: 1st and 15th see 3x bigger deposits
  // amount and transaction_type are already in the event schema
  if (record.event === "transaction completed" && record.transaction_type === "direct_deposit") {
    if (dayOfMonth === 1 || dayOfMonth === 15) {
      record.amount = Math.floor(record.amount * 3);
    }
  }

  // Post-payday spending window (days 1-3 and 15-17)
  if (record.event === "transfer sent") {
    const isPaydayWindow = (dayOfMonth >= 1 && dayOfMonth <= 3) || (dayOfMonth >= 15 && dayOfMonth <= 17);
    if (isPaydayWindow && chance.bool({ likelihood: 60 })) {
      record.amount = Math.floor(record.amount * 2.0);
    }
  }
}
```

#### Example 7: Viral Cascade via Event Cloning (everything hook)

For viral bursts, clone existing events with time offsets. Every injected event uses spread from a real event so the schema stays clean.

```javascript
if (type === "everything") {
  const events = record;

  // Identify viral creators (5% of users with 10+ posts)
  let postCount = 0;
  events.forEach(e => { if (e.event === "post created") postCount++; });
  const isViralCreator = postCount >= 10 && chance.bool({ likelihood: 5 });

  if (isViralCreator) {
    // Find a template "post viewed" event to clone from
    const templateView = events.find(e => e.event === "post viewed");
    if (templateView) {
      events.forEach(event => {
        if (event.event === "post created") {
          const eventTime = dayjs(event.time);
          // Clone 10-20 views per viral post
          const viewCount = chance.integer({ min: 10, max: 20 });
          for (let i = 0; i < viewCount; i++) {
            events.push({
              ...templateView,  // clone all existing properties
              time: eventTime.add(chance.integer({ min: 1, max: 180 }), 'minutes').toISOString(),
              user_id: event.user_id,
            });
          }
        }
      });
    }
  }

  return record;
}
```

#### Example 8: Cross-Table Correlation via meta.profile (everything hook)

Use `meta.profile` to drive existing event value modifications based on user properties. This creates discoverable correlations across both tables without adding new columns.

```javascript
if (type === "everything") {
  const events = record;
  const profile = meta.profile;
  const tier = profile.subscription_tier || "free";

  events.forEach(event => {
    // Enterprise users get faster resolution times
    // resolution_hours is already in the event schema
    if (tier === "enterprise" && event.event === "support ticket resolved") {
      event.resolution_hours = Math.floor(event.resolution_hours * 0.4);
    }

    // Premium users get higher reward values
    // value is already in the event schema
    if (tier === "premium" && event.event === "reward redeemed") {
      event.value = Math.floor(event.value * 3);
    }
  });

  return record;
}
```

#### Example 9: Anomaly Burst via Event Cloning (everything hook)

Inject a burst of rapid events by cloning an existing event of the same type. Perfect for fraud detection or bot behavior patterns.

```javascript
if (type === "everything") {
  const events = record;

  // 3% of users experience a fraud-like burst
  const templateTransaction = events.find(e => e.event === "transaction completed");
  if (chance.bool({ likelihood: 3 }) && templateTransaction && events.length >= 2) {
    const midIdx = Math.floor(events.length / 2);
    const midTime = dayjs(events[midIdx].time);

    // Clone 3-5 rapid high-value transactions from the template
    const burstCount = chance.integer({ min: 3, max: 5 });
    for (let i = 0; i < burstCount; i++) {
      events.splice(midIdx + 1 + i, 0, {
        ...templateTransaction,  // clone all existing properties
        time: midTime.add(i * 10, "minutes").toISOString(),
        user_id: templateTransaction.user_id,
        amount: chance.integer({ min: 500, max: 3000 }),
      });
    }
  }

  return record;
}
```

## Hook Documentation: Mixpanel Report Instructions (Required)

Every hook's documentation block MUST include a **"Mixpanel Report"** section with step-by-step instructions for recreating the insight in Mixpanel's UI. These instructions should be specific enough that someone unfamiliar with the data can follow them exactly and see the pattern.

### Report Types to Use

| Mixpanel Report Type | When to Use |
|---------------------|-------------|
| **Insights** | Comparing metrics across segments, property distributions, time series |
| **Funnels** | Conversion rate differences between segments |
| **Retention** | Cohort-based retention differences |
| **Flows** | Path analysis, event sequencing |

### Required Fields Per Hook

Each hook's "HOW TO FIND IT" section must include:

1. **Report type** — Which Mixpanel report to create (Insights, Funnels, Retention)
2. **Events** — Which event(s) to add to the report
3. **Measure** — What metric to use (Total, Uniques, Avg, Median, etc.)
4. **Breakdown** — Which property to break down by (if applicable)
5. **Filter** — Any filters to apply (property = value)
6. **Comparison** — What the user should compare (segment A vs B, before vs after, etc.)
7. **Expected result** — What the numbers should look like (e.g., "Premium segment should show ~3x higher avg reward value than Basic")

### Documentation Template Per Hook

```
───────────────────────────────────────────────────────────────────────────────
N. HOOK NAME (hook type)
───────────────────────────────────────────────────────────────────────────────

PATTERN: <what the hook does to the data>

HOW TO FIND IT IN MIXPANEL:

  Report 1: <Title>
  • Report type: Insights
  • Event: "<event_name>"
  • Measure: Average of <property_name>
  • Breakdown: <segment_property>
  • Filter: (optional) <property> = <value>
  • Compare: <segment_a> vs <segment_b>
  • Expected: <segment_a> should show ~Nx higher <metric> than <segment_b>

  Report 2 (optional): <Title>
  • Report type: Funnels
  • Steps: "<step1>" → "<step2>" → "<step3>"
  • Breakdown: <property>
  • Expected: <segment> should convert at ~X% vs ~Y% baseline

REAL-WORLD ANALOGUE: <why this pattern matters in production>
```

### Examples of Good Mixpanel Report Instructions

**Good (specific, actionable):**
```
HOW TO FIND IT IN MIXPANEL:

  Report 1: Premium Reward Value
  • Report type: Insights
  • Event: "reward redeemed"
  • Measure: Average of "value"
  • Breakdown: "account_tier"
  • Expected: "premium" should show ~3x higher avg value than "basic"
    (premium ≈ $30, plus ≈ $15, basic ≈ $10)

  Report 2: Premium Investment Returns
  • Report type: Insights
  • Event: "investment made"
  • Measure: Average of "amount"
  • Filter: "action" = "sell"
  • Breakdown: "account_tier"
  • Expected: "premium" should show ~2x higher avg sell amount
```

**Bad (vague, not actionable):**
```
HOW TO FIND IT:
  - Segment by account_tier
  - Compare reward values
  - Look for premium_reward = true
```

The bad example doesn't tell the user what report type to create, what metric to measure, or what numbers to expect. Always be specific.

## Common Pitfalls to Avoid

1. **Inventing properties in hooks that aren't in the config**: If a hook needs `payday`, `surge_pricing`, or any other flag, it MUST be defined in the event's `properties` with a default (e.g., `payday: [false]`). The hook modifies the value. The config defines the schema. This keeps the dataset schema consistent and the JSON schema output complete.
2. **Constructing injected events from scratch**: Never hand-build event objects with hand-picked properties. Always clone from an existing event of the same type using spread, then override `time`, `user_id`, and the values you want to change. This ensures the injected event has the same schema as organically generated ones.
3. **Don't wrap plain string arrays in `pickAWinner()`**: Arrays of 3+ unique strings like `["email", "google", "facebook"]` are automatically power-law weighted by the engine. Just use the plain array. `pickAWinner(array, integerIndex)` is ONLY for designating a specific winner index. For boolean/2-item weighting, use duplicates: `[false, false, true]` (~33% true). Never pass decimals as the second argument.
4. **Funnel event name mismatch**: If your funnel has `"first quest accepted"` but events array has `"quest accepted"`, validation fails. Names must match exactly.
5. **Using `record.properties.X` in hooks**: Properties are flat. Use `record.X` directly.
6. **Using `distinct_id` on spliced events**: The pipeline uses `user_id`, NOT `distinct_id`. Always copy `user_id` from the source event.
7. **Using `scdProps`**: SCDs generate locally without credentials. Only Mixpanel *import* needs service credentials. You can use `scdProps` freely for local generation with `writeToDisk: true`.
8. **NEVER use `lookupTables`**: Always set to `[]`. Lookup tables require a separate manual import step that is not automated.
9. **Churn events in funnels**: Always mark `isChurnEvent` events with `isStrictEvent: true` so they aren't included in auto-generated funnels.

## JSON Schema Output (Required)

After writing the `.js` dungeon file, also generate a companion `<name>-schema.json` file in `./dungeons/vertical/` containing a stripped-down, plain JSON version of the schema — no function calls, no JS imports, just portable data.

### JSON Format Rules

- **Arrays** → keep as-is (random selection from values)
- **`weighNumRange(min, max, ...)`** → `{"$range": [min, max]}` (integer range)
- **`pickAWinner(array, index)`** → plain array (drop the weighting, just list the values)
- **`chance.xxx.bind(chance)`** → omit the property or use a static placeholder
- **Arrow functions / closures** → omit or use a static placeholder
- **`decimal(min, max, places)`** → `{"$float": [min, max], "decimals": places}`
- **Static values** → keep as-is
- **Hooks, mirrorProps, scdProps, groupKeys, groupProps** → omit (JS-only features)

### JSON Structure

```json
{
  "events": [
    {
      "event": "event_name",
      "weight": 5,
      "properties": {
        "prop_name": ["val1", "val2"],
        "numeric_prop": {"$range": [10, 500]},
        "float_prop": {"$float": [1.0, 5.0], "decimals": 2},
        "static_prop": "constant"
      }
    }
  ],
  "superProps": { ... },
  "userProps": { ... },
  "funnels": [
    {
      "sequence": ["event1", "event2"],
      "conversionRate": 50,
      "order": "sequential",
      "timeToConvert": 24,
      "isFirstFunnel": false,
      "weight": 5
    }
  ]
}
```

Include `isFirstEvent`, `isFirstFunnel`, `name`, `weight`, `order`, and other non-function config fields as-is. Omit any field whose value is a JS function.

## After Writing the Files

1. Validate the JS dungeon with: `node -e "import { validateDungeonConfig } from './lib/core/config-validator.js'; import c from './dungeons/vertical/FILENAME.js'; validateDungeonConfig(c); console.log('valid');"`
2. If validation fails, fix the issue (usually funnel event names or pickAWinner crashes)
3. Verify the hook function loads without errors
4. Verify the JSON schema file is valid JSON: `node -e "import fs from 'fs'; JSON.parse(fs.readFileSync('./dungeons/vertical/FILENAME-schema.json', 'utf8')); console.log('valid json');"`
5. **Run `/verify-hooks dungeons/vertical/FILENAME.js`** to verify all hooks produce their intended patterns. Fix any FAIL or WEAK hooks before considering the dungeon complete.

## Verifying Hooks

A verify runner already exists at `scripts/verify-runner.mjs` — do NOT create a new one. After creating the dungeon, **always run the verify-hooks skill** (`/verify-hooks dungeons/vertical/FILENAME.js`) to confirm hooks produce their intended data patterns. If hooks fail verification, iterate on the hook code until they pass.

Manual verification is also available:

```bash
# Generate test data (1K users, 100K events)
node scripts/verify-runner.mjs dungeons/vertical/FILENAME.js verify-FILENAME

# Query the output with DuckDB to verify hook patterns
duckdb -c "SELECT ... FROM 'verify-FILENAME__events.json'"
```

The runner overrides: `numUsers=1000, numEvents=100_000, format=json, writeToDisk=true, concurrency=1`.

## Quality Checklist

- [ ] App narrative is detailed and explains design choices
- [ ] 15-20 events with realistic properties and weights
- [ ] 5 funnels with one marked `isFirstFunnel`
- [ ] All funnel event names exist in events array
- [ ] 8 hooks using varied techniques (not all `everything`)
- [ ] **No hooks add new properties** — hooks only modify existing values, filter events, and inject events cloned from existing ones
- [ ] Each hook has a clear "how to find it" with **specific Mixpanel report instructions** (report type, event, measure, breakdown, filter, expected result)
- [ ] Each hook has a real-world analogue explained
- [ ] Documentation block includes metrics summary table
- [ ] No `pickAWinner` calls without an explicit integer index arg. No decimal second args. Boolean/2-item weighting uses duplicate arrays.
- [ ] `lookupTables: []` (no lookup tables — events carry all attributes)
- [ ] Passes `validateDungeonConfig`
- [ ] Companion `<name>-schema.json` file generated with portable JSON schema
- [ ] JSON schema is valid JSON and matches the JS dungeon's events/funnels/props
