# dungeon-master

generate realistic fake analytics data at scale. events, users, groups, funnels, SCDs, lookup tables, ad spend, mirror datasets, organic text, and more.

this is the best kind of test data: real fake data (really).

## what is this

dungeon-master creates high-volume, semi-structured event data with deliberate patterns ("hooks") baked in. you define a "dungeon" (a configuration describing your data model), and the generator produces millions of events that look like real user behavior, because the time distributions, property weights, and behavioral patterns are all modeled from real-world analytics data.

the key piece is the **hook system**. hooks let you engineer specific, discoverable patterns into the generated data. things like "premium users convert 2x better" or "there was a service outage during days 40-47" or "users who watch low-quality video churn at 50%." the data looks organic, but you have the answer key.

this matters because it's really hard to build, test, and train analytics tools without realistic data that has known ground truth. and it's especially hard when you need millions of events with temporal patterns, funnel behaviors, and cross-table correlations.

i built this because i needed it. and after using it across hundreds of customer demos, internal testing, and AI training workflows... it just works.

```bash
npm install @ak--47/dungeon-master
```

## quick start

```javascript
import DUNGEON_MASTER from '@ak--47/dungeon-master';

// simple: pass a config object
const result = await DUNGEON_MASTER({
  numUsers: 1_000,
  numEvents: 100_000,
  numDays: 90,
  format: 'json',
  writeToDisk: true,
  events: [
    { event: 'page view', weight: 10 },
    { event: 'sign up', weight: 1, isFirstEvent: true },
    { event: 'purchase', weight: 3, properties: { amount: [10, 25, 50, 100, 250] } }
  ]
});

console.log(`${result.eventCount} events, ${result.userCount} users`);
```

the main export accepts multiple input formats. use whatever fits your workflow:

```javascript
// load a dungeon file from disk
const result = await DUNGEON_MASTER('./dungeons/technical/simple.js');

// load a JSON dungeon (exported from the UI)
const result = await DUNGEON_MASTER('./dungeons/technical/simple-schema.json');

// run multiple dungeons
const results = await DUNGEON_MASTER([
  './dungeons/vertical/gaming/gaming.js',
  './dungeons/vertical/media/media.js',
  './dungeons/vertical/food-delivery/food-delivery.js'
]);

// pass raw javascript as a string
const result = await DUNGEON_MASTER(`
  export default {
    numUsers: 500,
    numEvents: 50_000,
    numDays: 60,
    events: [
      { event: 'click', weight: 5 },
      { event: 'submit', weight: 2 }
    ]
  };
`);

// override any config when loading from files
const result = await DUNGEON_MASTER('./dungeons/vertical/fintech/fintech.js', {
  numUsers: 100,       // shrink for testing
  writeToDisk: true,
  verbose: true
});
```

## send data to mixpanel

pass a project token and the generated data imports directly:

```javascript
const result = await DUNGEON_MASTER({
  ...myDungeon,
  token: process.env.MIXPANEL_TOKEN,
  region: 'US'
});

console.log(result.importResults);
```

`token` imports event-shaped streams only: events, users, groups, ad spend, and
`standaloneEvents`. `warehouseMetrics` does **not** import through this path.
warehouse tables are materialized locally and need a separate warehouse deploy
step after the run.

## dungeons

a dungeon is a javascript file that exports a configuration object. it defines your entire data model: events, funnels, user properties, group analytics, SCDs, and a hook function that engineers discoverable patterns into the data.

see `dungeons/vertical/` for customer-facing story dungeons (one folder per vertical, each with engineered hooks and machine-checkable stories) and `dungeons/technical/` for feature-testing dungeons (mirrors, groups, scale, anonymous users).

every vertical dungeon ships with a verification proof at `dungeons/vertical/<name>/<name>.{verify.mjs,sql}` plus a `stories` export evaluated mechanically by `scripts/verify-stories.mjs` — a CI-runnable assertion that the dungeon's documented hooks actually appear in the generated data at full fidelity. 22 dungeons, 212 machine-checkable stories. see [`dungeons/vertical/README.md`](dungeons/vertical/README.md).

```javascript
// dungeons/my-app.js
import dayjs from 'dayjs';
import { pickAWinner, weighNumRange, integer } from '@ak--47/dungeon-master/utils';

export default {
  seed: 'my-app-v1',
  numUsers: 10_000,
  numEvents: 1_000_000,
  numDays: 120,
  format: 'json',

  events: [
    { event: 'page view', weight: 10, properties: { page: ['/', '/pricing', '/docs', '/blog'] } },
    { event: 'sign up', weight: 1, isFirstEvent: true },
    { event: 'feature used', weight: 8, properties: { feature: pickAWinner(['search', 'export', 'share', 'filter']) } },
    { event: 'upgrade', weight: 2, properties: { plan: ['starter', 'pro', 'enterprise'], amount: weighNumRange(10, 500) } },
    { event: 'support ticket', weight: 1, properties: { priority: ['low', 'medium', 'high', 'critical'] } }
  ],

  funnels: [
    { sequence: ['page view', 'sign up'], conversionRate: 40, isFirstFunnel: true, order: 'sequential' },
    { sequence: ['feature used', 'upgrade'], conversionRate: 15, order: 'sequential', timeToConvert: 72 }
  ],

  userProps: {
    plan: ['free', 'free', 'free', 'starter', 'starter', 'pro', 'enterprise'],
    company_size: weighNumRange(1, 500, 0.5)
  },

  soup: 'growth',

  hook: function(record, type, meta) {
    // enterprise users convert 3x better
    if (type === 'funnel-pre' && meta.profile.plan === 'enterprise') {
      record.conversionRate = Math.min(record.conversionRate * 3, 95);
    }
    return record;
  }
};
```

### dungeon utilities

dungeon scripts can import utilities from the package directly:

```javascript
// weighted random selection, number ranges, date generation, and more
import { pickAWinner, weighNumRange, weighChoices, date, integer } from '@ak--47/dungeon-master/utils';

// organic text generation (support tickets, reviews, search queries, etc.)
import { createTextGenerator, generateBatch } from '@ak--47/dungeon-master/text';
```

these are the same functions used internally. `pickAWinner` creates weighted distributions, `weighNumRange` generates realistic numeric ranges with configurable skew, and the text generators produce organic-looking strings with sentiment analysis and keyword injection.

**you usually don't need `pickAWinner`** — as of 1.6.1, any property value that is a plain array of 3–19 unique strings automatically gets a stable power-law distribution: one seed-deterministic winner per array per run (~45% winner / ~25% second / ~15% third / decaying tail). to opt out and get uniform draws, use exactly 2 values, 20+, or include one of the keywords `variant` / `group` / `experiment` / `population` in a value (experiment arms stay balanced). arrays with explicit duplicate entries (`["card", "card", "apple_pay"]`) skip the auto-weighting and honor the duplicates exactly — **repeats are the weights** (that array is 2:1).

**state the distribution instead (1.7.0):** `{ __weights: { free: 60, pro: 30, enterprise: 10 } }` draws exactly those shares — no power law, no per-run winner, zero-weight keys never draw. `autoPowerLaw: false` at the top level turns the automatic power law off for the whole run (uniform picks).

```javascript
userProps: {
  plan_tier: { __weights: { free: 60, pro: 30, enterprise: 10 } },   // honest 60/30/10
  platform:  ['iOS', 'Android', 'web'],                              // 45/25/15 power law (default)
}
```

**value functions see context (1.7.0):** a property function may declare a `ctx` parameter and read `ctx.profile` (the user's resolved profile), `ctx.event` (the event being built), `ctx.time` (unix ms) and `ctx.config`. this is how one field correlates with another without a hook. zero-arity functions keep working untouched.

```javascript
userProps: {
  plan:    ['free', 'pro'],
  revenue: (ctx) => ctx.profile.plan === 'pro' ? 100 : 10,      // profile keys resolve in declaration order
},
events: [{ event: 'Purchased', properties: {
  price:    () => integer(5, 500),
  quantity: [1, 1, 1, 2, 3],
  total:    (ctx) => ctx.event.price * ctx.event.quantity,       // event props resolve in declaration order
}}],
superProps: { plan_on_event: (ctx) => ctx.profile.plan },         // or: stickyEventProps: ['plan']
```

`ctx.profile` is undefined for group profiles, lookup tables, ad spend and mirror props. on funnel steps the step's final time is known before its properties resolve, so `ctx.time` is the real timestamp.

### named exports

alongside the default `DUNGEON_MASTER` export, the package root exports loader + interop helpers:

```javascript
import DUNGEON_MASTER, {
    loadFromFile,          // (path)            → Promise<Dungeon>   load+validate a .js/.mjs/.json dungeon
    loadFromText,          // (code)            → Promise<Dungeon>   load+validate a raw JS source string
    parseJSONDungeon,      // (json)            → Dungeon            revive a JSON dungeon into a runnable config
    validateDungeonShape,  // (config)          → void               throw if config isn't dungeon-shaped
    dungeonToJSON,         // (input, options?) → Promise<DungeonJSON>     serialize a dungeon → JSON (inverse of parseJSONDungeon)
    extractComments,       // (input)           → DungeonComments    pull OVERVIEW / HOOK STORIES doc blocks from source
} from '@ak--47/dungeon-master';
```

`dungeonToJSON` accepts a config object, a file path, raw JS source, or an array of paths, and returns the `{ schema, hooks, timestamp, version }` wrapper format. it round-trips with `parseJSONDungeon`:

```javascript
const json   = await dungeonToJSON('./dungeons/vertical/ecommerce/ecommerce.js');  // creds stripped by default
const config = parseJSONDungeon(json);                                   // back to a runnable dungeon
```

it's best effort — arrow functions and `chance.*` methods survive the round trip; detected utility calls (`weighArray`, `weighNumRange`, …) serialize by name without their args. pass `{ includeCredentials: true }` to keep `token` / `serviceAccount` / etc. in the output (stripped by default).

`extractComments` reads a dungeon's **source** (file path or raw text — never the imported module, since importing discards comments) and returns `{ overview, hookStories, sections }` with the comment scaffolding stripped to readable prose.

## how it works

one call to `DUNGEON_MASTER(config)` runs through these phases in order:

```
  input  →  validate         →  create context     →  init storage         →  ad spend
            (+ v1.5 clamps)     (FIXED_NOW, seed)     (HookedArray bins)      (if hasAdSpend)
              │
              ▼
        ┌────────────┐
        │  userLoop  │  ← per-user generation (most of the work happens here)
        └────────────┘
              │
              ▼
  groups + SCDs  →  lookup tables  →  mirror datasets  →  flush to disk  →  mixpanel  →  return
                                                          (if writeToDisk)   (if token)
```

`userLoop` per-user lifecycle (hooks marked with `►`, terminal guards with `■`):

```
   [next user]
        │
        ▼
   assign persona + location
        │
   create profile + merge persona props
        │
   ► HOOK: user                       — set computed segments / tiers
        │
   build active-day plan              — if avgActiveDaysPerUser set
        │
   generate SCD entries
        │
   ► HOOK: scd-pre                    — modify SCD mutation timeline
        │
   for each first funnel (attempts loop, identity stitching):
        │
        ├─► HOOK: funnel-pre          — change conversionRate, read meta.profile
        │
        ├── generate funnel events    — step1 anchored to FIXED_NOW
        │
        └─► HOOK: funnel-post         — splice cloned events between steps
        │
   generate standalone events         — active-day constrained
        │
   apply world-event props
   apply data-quality nulls
        │
   ► HOOK: event                      — per-event mutate (fires ONCE per event)
        │
   filter _drop events
   apply engagementDecay
   duplicate + late-arriving
        │
   sort by time
   assign session_ids
   per-session sticky device pick
        │
   touchpoint cap pass                — UTM stamping, max maxTouchpointsPerUser
        │
   ► HOOK: everything                 — see ALL events for user (most powerful)
        │
   auto-sort by time                  — opt out: autoSortAfterEverything: false
        │
   ■ future-time guard                — drop events past FIXED_NOW (unconditional)
        │
   push to storage                    — storage hooks fire here:
                                          ad-spend / group / mirror / lookup
```

key points:
- **hook order matters.** `user` runs first, then per-funnel hooks, then per-event, then `everything` last. each hook can override what previous hooks did.
- **`event` hook fires ONCE per event.** the storage layer skips re-running it to prevent double-fire mutations (`price *= 2` won't apply twice).
- **`everything` is the most powerful hook.** sees the user's complete event history with `meta.profile` available. only place where you can drop events (return a filtered array).
- **future-time guard is unconditional.** any event with `time > FIXED_NOW` is dropped before storage. hook authors can clone events with arbitrary timestamps without polluting the dataset.
- **storage hooks** (`ad-spend`, `group`, `mirror`, `lookup`) fire during the storage push, not during userLoop. they're for transforming side-channel data only.

## the hook system

hooks are the most important feature. a hook is a single function on your dungeon config that receives every piece of data as it flows through the pipeline. you can mutate events, modify conversion rates, inject synthetic events, simulate churn, engineer temporal patterns, and correlate behaviors across tables.

```javascript
hook: function(record, type, meta) {
  // type tells you what kind of data you're looking at
  // record is the data object (event, profile, or array of events)
  // meta has contextual info (user profile, config, etc.)

  return record;
}
```

### hook types

hooks fire in this order for each user:

| type | what you get | what you can do |
|------|-------------|----------------|
| `"user"` | user profile object | set computed properties, segments, tiers |
| `"scd-pre"` | SCD entries array | modify time-series attribute mutations |
| `"funnel-pre"` | funnel config + `meta.profile` | change conversion rates based on user properties |
| `"event"` | single event (flat props) | modify properties, tag events, rename events |
| `"funnel-post"` | array of funnel events | splice extra events between funnel steps |
| `"everything"` | ALL events for one user | correlate across event types, filter/inject/duplicate events |

storage hooks (`"ad-spend"`, `"group"`, `"mirror"`, `"lookup"`) fire during write, not generation.

### hook patterns

these are the patterns i use most. they cover probably 90% of what you'd want to engineer into test data:

**temporal windowing** (simulate a product launch, outage, or improvement):

```javascript
hook: function(record, type, meta) {
  if (type === 'event') {
    const LAUNCH_DAY = dayjs().subtract(30, 'day');
    if (dayjs(record.time).isAfter(LAUNCH_DAY)) {
      if (record.event === 'purchase') record.amount *= 2;
    }
  }
  return record;
}
```

**user-property-driven conversion** (premium users convert better):

```javascript
hook: function(record, type, meta) {
  if (type === 'funnel-pre') {
    if (meta.profile.plan === 'enterprise') {
      record.conversionRate = Math.min(record.conversionRate * 2.5, 95);
    }
  }
  return record;
}
```

**two-pass behavioral tagging** (identify power users, then tag all their events):

```javascript
hook: function(record, type, meta) {
  if (type === 'everything') {
    const purchases = record.filter(e => e.event === 'purchase');
    const isPowerUser = purchases.length > 5;
    for (const event of record) {
      event.is_power_user = isPowerUser;
    }
  }
  return record;
}
```

**simulating churn** (low-quality users drop off):

```javascript
hook: function(record, type, meta) {
  if (type === 'everything') {
    const lowQuality = record.filter(e => e.quality === '240p').length;
    const highQuality = record.filter(e => e.quality === '1080p').length;
    if (lowQuality > highQuality && chance.bool({ likelihood: 50 })) {
      const midpoint = Math.floor(record.length / 2);
      return record.slice(0, midpoint);  // user "churns" halfway through
    }
  }
  return record;
}
```

**event injection** (add synthetic milestone events):

```javascript
hook: function(record, type, meta) {
  if (type === 'everything') {
    const purchases = record.filter(e => e.event === 'purchase');
    if (purchases.length >= 10) {
      record.push({
        event: 'loyalty milestone',
        time: purchases[9].time,
        user_id: purchases[9].user_id,
        milestone: '10th purchase',
        total_spend: purchases.reduce((sum, p) => sum + (p.amount || 0), 0)
      });
    }
  }
  return record;
}
```

### critical hook rules

1. event properties are **flat** on the record: `record.amount`, not `record.properties.amount`
2. injected events need `user_id` (not `distinct_id`) and a valid `time` string
3. use `dayjs` for time operations inside hooks
4. to drop events, use the `everything` hook and return a filtered array. don't return `{}` from event hooks (creates broken events)
5. the `everything` hook is the most powerful. it sees all events for one user, has access to `meta.profile`, and can correlate across event types

## time shape — macro and soup

two orthogonal axes shape how events are distributed in time:

- **`macro`** — big-picture trend across the whole window (births, growth, decline). default: `"flat"`.
- **`soup`** — intra-week and intra-day rhythm (DOW/HOD weights, peak count, deviation). default: `"growth"`.

mix and match. most dungeons want `macro: "flat"` (the chart doesn't blow up at the right edge) plus a soup that gives the desired weekly/daily texture.

### per-user-per-day rate

`avgEventsPerUserPerDay` is the canonical event-volume primitive. born-late users get `rate × remaining_days`, not a full per-user budget compressed into a small window — that's what prevents the meteoric ramp at the right edge of the chart. `numEvents` still works as a fallback (the rate is derived from `numEvents / numUsers / numDays`), but new dungeons should set the rate directly.

### macro presets

| preset | trend shape | use case |
|--------|-------------|----------|
| `"flat"` (default) | pure weekly oscillation, no net trend | mature product; let hooks supply the story |
| `"steady"` | slight uptrend | lightly-growing saas |
| `"growth"` | visible acquisition story (no spike) | startup acquisition narrative |
| `"viral"` | hockey-stick acquisition | pair with persona / feature hooks |
| `"decline"` | sunsetting product | pair with churn hooks |

```javascript
macro: 'flat'                                          // default
macro: 'growth'                                        // preset string
macro: { preset: 'growth', percentUsersBornInDataset: 40 }  // preset + override (canonical object spelling)
macro: { bornRecentBias: 0.3, percentUsersBornInDataset: 50 }  // custom macro — no preset, no cap
```

**canonical spelling is the object with `preset`.** the top-level `bornRecentBias` / `percentUsersBornInDataset` / `preExistingSpread` keys are a legacy alias and win over the object when both are set.

**a named preset is a shape contract.** its born% cap applies (flat 12, steady 12, growth 30, viral 55, decline 5) whether you spell it `macro: 'growth', percentUsersBornInDataset: 50` or `macro: { preset: 'growth', percentUsersBornInDataset: 50 }` — both clamp to 30 and report it in `result.warnings`. **an object without `preset` is a custom macro**: you own the shape, no cap applies, your numbers are used as written (missing fields fill from `flat`). before 1.7.0 the preset-less object was silently capped at 12.

## timesoup (intra-week / intra-day rhythm)

timesoup controls the texture of events inside the macro trend. it uses gaussian cluster sampling layered with day-of-week and hour-of-day weighting derived from... i won't tell you. a prize goes to whoever can guess. the result is realistic temporal patterns: weekday peaks, weekend valleys, morning surges, afternoon dips.

### presets

```javascript
soup: 'growth'    // default. real-world weekly + daily rhythm
```

| preset | pattern | use case |
|--------|---------|----------|
| `"steady"` | tighter clustering | mature saas, utility apps |
| `"growth"` | standard intra-week rhythm | general purpose (default) |
| `"spiky"` | dramatic peaks and valleys | gaming, social, viral products |
| `"seasonal"` | 3-4 major waves | ecommerce, education |
| `"global"` | flat DOW + flat HOD | global saas, infrastructure |
| `"churny"` | standard rhythm | pair with `macro: "decline"` for declining shape |
| `"chaotic"` | wild variation | anomaly detection, incident response |

### custom configuration

```javascript
// preset with overrides
soup: { preset: 'spiky', deviation: 5 }

// fully custom
soup: {
  peaks: 200,
  deviation: 2,
  mean: 0,
  dayOfWeekWeights: [0.637, 1.0, 0.999, 0.998, 0.966, 0.802, 0.528],  // [Sun..Sat]
  hourOfDayWeights: [/* 24 values, index 0 = midnight UTC */]
}
```
^ be warned, this can blow up your dataset. most of the 'growth' is what you want (right?)

## output formats

generated data writes to `./data/` by default, but you can pass a path to `writeToDisk` and it will write there instead. supported formats:

| format | extension | notes |
|--------|-----------|-------|
| `json` | `.json` | newline-delimited JSON (one object per line) |
| `csv` | `.csv` | standard CSV with headers |
| `parquet` | `.parquet` | columnar format via hyparquet-writer |

all formats support gzip compression (`gzip: true`).

```javascript
{
  format: 'parquet',
  writeToDisk: true,
  gzip: true
}
```

### cloud storage

you can write directly to google cloud storage by using a `gs://` path:

```javascript
{
  writeToDisk: 'gs://my-bucket/datasets/gaming/',
  format: 'json'
}
```

## OOM protection and batch mode

large datasets (2M+ events) automatically enable batch mode, which flushes data to disk in chunks to prevent out-of-memory crashes. you can configure this manually:

```javascript
{
  numEvents: 50_000_000,
  batchSize: 1_000_000,     // flush every 1M records
  writeToDisk: true,
  format: 'csv'
}
```

batch mode writes numbered files (`dataset-EVENTS-001.csv`, `dataset-EVENTS-002.csv`, etc.) and streams data through instead of holding everything in memory. this means you can generate datasets of arbitrary size on a machine with limited RAM.

## data model

dungeon-master generates multiple data types that mirror a real analytics implementation:

| data type | config key | description |
|-----------|-----------|-------------|
| events | `events` | timestamped user actions with arbitrary properties |
| user profiles | `userProps` | per-user attributes (plan, company, preferences) |
| super properties | `superProps` | properties attached to every event (theme, platform) |
| funnels | `funnels` | conversion sequences with configurable rates and ordering |
| group profiles | `groupKeys` + `groupProps` | B2B group analytics (companies, teams) |
| SCDs | `scdProps` | slowly changing dimensions (subscription tier over time) |
| lookup tables | `lookupTables` | dimension tables (product catalog, region mapping) |
| ad spend | `hasAdSpend` | daily ad spend with impressions, clicks, cost metrics |
| standalone events | `standaloneEvents` | identity-less metric snapshots on a cadence (infrastructure, finance, ops) |
| warehouse metrics | `warehouseMetrics` | warehouse source tables derived from generated events, with a manifest for downstream deploy |
| mirror datasets | `mirrorProps` | transformed copies of event data (A/B versions) |
| organic text | `createTextGenerator` | reviews, support tickets, search queries, chat messages |

## funnels

funnels define conversion sequences. users enter a funnel, and at each step some percentage drops off. the ordering strategy controls how events within the funnel are sequenced:

```javascript
funnels: [
  {
    sequence: ['page view', 'sign up', 'onboarding', 'first action'],
    conversionRate: 35,
    order: 'sequential',           // strict left-to-right ordering
    timeToConvert: 24,             // hours between steps
    isFirstFunnel: true,           // this is the entry funnel
    experiment: true               // generates A/B/C variants automatically
  },
  {
    sequence: ['view item', 'add to cart', 'checkout'],
    conversionRate: 20,
    order: 'first-and-last-fixed', // first and last steps are fixed, middle shuffled
    timeToConvert: 48,
    props: { source: 'organic' },  // constant props on all funnel events
    bindPropsIndex: 1              // props bind at step 1 and persist through
  }
]
```

ordering strategies: `sequential`, `random`, `first-fixed`, `last-fixed`, `first-and-last-fixed`, `middle-fixed`, `interrupted`

### segmented funnels (`conditions`)

`conditions` is the only mechanism that makes **one segment convert differently on one funnel** — `personas[].conversionModifier` applies to every funnel. a funnel with `conditions` is offered only to users whose profile satisfies every key (AND across keys). the idiom is two funnels with the same `name` and `sequence`, different `conditions` and rates:

```javascript
userProps: { platform: ['iOS', 'Android'], seats: [1, 5, 10, 20] },
funnels: [
  { name: 'Checkout', sequence: ['Viewed Item', 'Purchased'], conditions: { platform: 'iOS' },     conversionRate: 80, timeToConvert: 0.5 },
  { name: 'Checkout', sequence: ['Viewed Item', 'Purchased'], conditions: { platform: 'Android' }, conversionRate: 40, timeToConvert: 4 },
  { name: 'Upgrade',  sequence: ['Viewed Plans', 'Upgraded'],
    conditions: { seats: { gte: 10 }, plan_tier: { in: ['pro', 'enterprise'] }, country: { neq: 'US' } } },
]
```

each value is a scalar (strict equality) or an operator map with any of `eq`, `neq`, `in`, `nin`, `gt`, `gte`, `lt`, `lte` (1.7.0). operators within one key AND together; there is no `or`. measured: iOS 80.2% vs Android 39.8% purchased-per-viewed on the config above.

the validator throws on shapes that can never match (a function, a bare array — use `{ in: [...] }`, an unknown operator, `in`/`nin` without an array). a condition key that is not declared in `userProps`, `superProps`, or a persona's `properties` lands in `result.warnings` — only a `user` hook could supply it. users who satisfy none of your funnels fall through to standalone events; the run reports how many under `result.warnings` (`key: 'funnels.conditions'`).

### experiments

experiments are a property of funnels. any funnel with `experiment` set fires a `$experiment_started` event (with `Experiment name` / `Variant name` properties) at the start of every qualifying pass, and the assigned variant's `conversionMultiplier` / `ttcMultiplier` modify that pass:

```javascript
experiment: true                    // shorthand: Variant A (worse) / Variant B (better) / Control
experiment: {
  name: 'Checkout Redesign',
  startDaysBeforeEnd: 30,           // runs before this date skip the experiment entirely
  sticky: true,                     // default — see below
  variants: [
    { name: 'Control' },
    { name: 'New Checkout', conversionMultiplier: 1.25, ttcMultiplier: 0.8, weight: 1 },
  ]
}
```

variant assignment is **sticky by default**: a deterministic hash of `user_id` + experiment name, so a user keeps their variant across every funnel pass (matches Mixpanel experiment SDK bucketing and makes variant lift verifiable). set `sticky: false` to re-roll the variant on each pass with the seeded RNG. hooks see the resolved variant on `meta.experiment` in `funnel-pre` / `funnel-post`.

**the variant lands on the user profile (1.7.0).** every exposed user carries `"Experiment: <name>": "<variant>"` (e.g. `"Experiment: Checkout Redesign": "New Checkout"`), so the funnel breaks down by variant in Mixpanel with a user-property breakdown — no cohort built from the exposure event. stamped when the user is first exposed (respects `startDaysBeforeEnd`); never-exposed users carry nothing; the `user` hook fires before exposure and does not see it, the `everything` hook does. `stampProfile: false` turns it off; `sticky: false` implies off. measured: 0 mismatches between the profile value and the `Variant name` on 13,005 exposure events.

## standalone events (identity-less metric snapshots)

`standaloneEvents` generates records that describe a **system, not a person**. they carry
no `user_id` and no `device_id`. use them for infrastructure, finance, and ops telemetry:
daily CDN egress per region, weekly billing rollups per plan tier, hourly queue depth per
cluster. `hasAdSpend` is the same idea hard-coded to `$ad_spend`; this is the general form
and it does not use a Mixpanel reserved event name.

```javascript
standaloneEvents: [
  {
    event: 'cdn_egress',
    cadence: 'day',                                       // 'hour' | 'day' | 'week' (default 'day')
    dimensions: { region: ['us-east', 'us-west', 'eu'] }, // cross-producted
    distinctIdFrom: 'region',                             // synthetic id, never a person
    properties: {
      gb_out:   (ctx) => 400 + ctx.tickIndex * 3,         // shape a trend across the window
      cost_usd: (ctx) => (400 + ctx.tickIndex * 3) * 0.085,
      p95_ms:   [120, 140, 160],                          // same ValueValid forms as event props
    },
  },
  {
    event: 'billing_rollup',
    cadence: 'week',
    dimensions: { tier: ['free', 'pro', 'max'] },
    properties: { mrr_usd: (ctx) => ..., churn_usd: (ctx) => ... },
  },
]
```

the engine emits **one record per cadence tick per dimension cross-product row**. the
example above produces 3 records per day (`cdn_egress`) plus 3 records per week
(`billing_rollup`). ticks start at the dataset start and step by the cadence; the last tick
is the final one at or before the dataset end, so nothing lands in the future.

each record carries `event`, `time`, `insert_id`, `distinct_id`, every dimension as a flat
property, and every resolved entry in `properties`.

| field | behavior |
|---|---|
| `event` | required, unique across `standaloneEvents` |
| `cadence` | `'hour'`, `'day'`, or `'week'`. default `'day'` |
| `dimensions` | object of non-empty arrays, cross-producted. omit for one record per tick |
| `distinctIdFrom` | must name a declared dimension. omitted → `distinct_id` is the event name |
| `properties` | keys may not collide with a dimension or with `event`/`time`/`insert_id`/`distinct_id`/`user_id`/`device_id` |

property value functions receive a `StandaloneValueContext`: `{ time, config, dimensions,
tickIndex, tickCount, cadence, event }`. `tickIndex / (tickCount - 1)` is window progress —
use it to shape growth, a dip, or a spike, guarding `tickCount <= 1` before division.

the stream lands in `result.standaloneEventData`, writes to its own `-STANDALONE` file
shard, and imports to Mixpanel as its own event stream. hooks fire with type
`"standalone"`; `meta.spec` carries the resolved config so a hook can tell streams apart.
the hook runs before the user loop. return the record object or an array of records;
returning `undefined` drops the record. it has no person metadata and never enters
`everything`. warehouse hooks have a different contract: mutate the row in place;
their return values are ignored.

```javascript
hook: (record, type, meta) => {
  if (type === 'standalone' && meta.spec.event === 'cdn_egress' && record.region === 'us-east') {
    record.p95_ms *= 40;
  }
  return record;
}
```

validation throws rather than skipping. a malformed entry would silently drop a whole data
stream, and you would not notice until the charts were wrong.

## warehouse metrics (local source tables)

`warehouseMetrics` materializes warehouse-ready tables from the run's own event
stream after user generation completes. use it when you need a bookings table, a
subscription level snapshot, or an ARR table that reads like a real warehouse
source. these rows land in `result.warehouseMetricData`, write to
`<name>-WAREHOUSE-<table>.csv|json`, and emit one manifest at
`<name>-WAREHOUSE-MANIFEST.json`.

they are **not** imported by `token`. that is deliberate. the live path is:

1. run the dungeon
2. review `/warehouse-metrics` in dry-run mode
3. obtain explicit operator consent for live execution
4. load the tables to bigquery and save the metrics there

live deploy uses `bq load --replace`, so it overwrites the destination warehouse
tables. the shipped script does not prompt on its own, so the operator or agent
must obtain explicit consent before running it in live mode. if the
warehouse CRUD docs route returns 404, the deploy still loads tables and connects
the source, then writes `warehouse/GAPS.md` for manual metric creation.

the manifest carries `recommendedAggregation: 'sum' | 'last value'`. the
Mixpanel warehouse metric API spells that second value as `last_value`; the
deploy flow maps it for you.

there is one real preview trap: `previewWarehouseMetric` rejects raw SQL
containing `DROP`, `DELETE`, `TRUNCATE`, `ALTER`, `CREATE`, `INSERT`, or
`UPDATE` as plain substrings. `created_at` trips `CREATE`; `updated_at` trips
`UPDATE`. aliasing only helps if the blocked text disappears from the query
entirely.

### canonical shapes

additive daily bookings:

```javascript
warehouseMetrics: [{
  name: 'daily_new_bookings',
  source: {
    event: 'new_booking',
    measure: 'sum',
    property: 'booking_value',
  },
  timeColumn: 'date',
  valueColumn: 'bookings',
}]
```

point-in-time daily active subscriptions:

```javascript
warehouseMetrics: [{
  name: 'daily_active_subscriptions',
  type: 'point-in-time',
  source: {
    event: 'subscription_started',
    minus: 'subscription_cancelled',
    measure: 'count',
  },
  baseline: 40,
  timeColumn: 'date',
  valueColumn: 'active_subscriptions',
}]
```

sparse monthly ARR with backfill:

```javascript
warehouseMetrics: [{
  name: 'monthly_arr_snapshot',
  type: 'point-in-time',
  grain: 'month',
  sparse: true,
  history: 18,
  source: {
    event: 'subscription_started',
    minus: 'subscription_cancelled',
    measure: 'sum',
    property: 'monthly_value',
  },
  baseline: 24000,
  scale: 12,
  timeColumn: 'month',
  valueColumn: 'arr_usd',
}]
```

the shipped technical fixture uses a 60-day live window plus 18 monthly backfill
buckets. sample row counts are illustrative only. `grain`, `history`, `sparse`,
and `groupBy` all change how many rows a table emits.

### config surface

| key | default | range / contract |
|---|---|---|
| `name` | required | unique table / metric name, `/^[a-z][a-z0-9_]{0,63}$/` |
| `type` | `'additive'` | `'additive'` or `'point-in-time'` |
| `grain` | `'day'` | `'day'`, `'week'`, `'month'` |
| `sparse` | `false` | boolean, valid only with `type: 'point-in-time'` |
| `source.event` | required | string or string[] of declared source events |
| `source.minus` | `[]` | string or string[] of declared subtractive events |
| `source.measure` | `'count'` | `'count'`, `'sum'`, `'avg'`, `'dau'`, `'users'`; point-in-time forbids `'avg'` and `'dau'` |
| `source.property` | `null` | required for `'sum'` and `'avg'`; must be declared on every source event or in `superProps` |
| `source.where` | `null` | optional function over flat event rows |
| `source.groupBy` | `[]` | up to 2 keys, each declared on every source event or in `superProps`; observed cardinality above 50 warns |
| `timeColumn` | `'date'` | valid JS identifier; becomes the ordered time axis in rows and manifest |
| `valueColumn` | `'value'` | valid JS identifier |
| `baseline` | `0` | number `>= 0`; used only for point-in-time metrics, ignored on additive |
| `scale` | `1` | finite number `> 0`, applied after bucket aggregation |
| `noise` | `0` | finite number, clamped to `[0, 0.5]` with a warning |
| `history` | `0` | integer `>= 0`; warns above roughly 3 years at each grain (`1095` day, `156` week, `36` month) |
| `columns` | `{}` | extra declared output columns; keys must be valid identifiers and cannot collide with time/value/groupBy columns |
| `format` | dungeon `format`, else `'csv'` | `'csv'` or `'json'` |

materialized tables are deterministic at the same seed and do not perturb the
event stream. the warehouse pass runs after the user loop, so seeded noise and
derived columns never change generated events.

### result and manifest

```javascript
const result = await DUNGEON_MASTER(config);

result.warehouseMetricData.daily_new_bookings
result.warehouseManifest.tables
result.files
```

each manifest table includes:

| field | meaning |
|---|---|
| `table` | warehouse table name |
| `file` | file prefix without extension |
| `format` | `'csv'` or `'json'` |
| `grain` | bucket grain |
| `type` | additive vs point-in-time |
| `timeColumn` | date axis column |
| `valueColumn` | numeric value column |
| `dimensionColumns` | copied `groupBy` keys |
| `columns` | ordered BigQuery schema (`DATE`, `FLOAT64`, `BOOL`, `STRING`) |
| `recommendedAggregation` | `'sum'` or `'last value'` |
| `sql` | `SELECT * FROM \`{{DATASET}}.<table>\` ORDER BY <timeColumn>` |
| `refreshHint` | currently `'hourly'` |

## user generation

users are generated with configurable birth distributions, normally controlled via the `macro` preset (see "time shape" above). these three knobs can also be set directly on the dungeon config — they override the preset's values.

| knob | range | effect |
|------|-------|--------|
| `percentUsersBornInDataset` | 0..100 | share of users created inside the window vs pre-existing |
| `bornRecentBias` | -1..1 | birth-date skew. negative = early, 0 = uniform, positive = recent |
| `preExistingSpread` | `"uniform"` \| `"pinned"` | placement of pre-existing users' first event time |

```javascript
{
  numUsers: 10_000,
  macro: { preset: 'growth', percentUsersBornInDataset: 40, bornRecentBias: 0.5 }
}
```

### personas

`personas` split users into behavioral segments. each persona carries a `weight` (share of users), `properties` merged into the profile, and three multipliers:

| field | applies to | default |
|---|---|---|
| `eventMultiplier` | the whole per-user event budget — funnel passes AND standalone events. a 3x persona runs ~3x the funnel passes (measured 2.9–3.2x) | 1.0 |
| `conversionModifier` | `conversionRate` on every funnel (for one segment on one funnel use `conditions`) | 1.0 |
| `ttcModifier` | `timeToConvert` on every funnel (0.25 = converts four times faster; measured median 0.50h vs 1.96h) — 1.7.0 | 1.0 |

**`isChurnEvent` caps `eventMultiplier`.** a churn event in the standalone pool is drawn by weight like any other event, so it ends every user after roughly the same number of events regardless of budget — the multiplier washes out (measured 1.04x for an asked 3x with a weight-1 churn event among 16 weight units; 2.90x without it). when more than half the users churn and a persona multiplier is in play, `result.warnings` says so (`key: 'personas.eventMultiplier'`). lower the churn event's weight, raise `returnLikelihood`, or drive churn from a hook.

1.7.0 removed the never-implemented `churnRate`, `activeWindow` and `soupOverride` from the `Persona` type. the validator still accepts and warns on them. `engagementDecay` per persona IS implemented and stays.

### sticky event properties

`superProps` re-roll on every event. to put a **stable per-user value on events** — the property behind the most common mixpanel breakdown — name profile keys in `stickyEventProps` (1.7.0):

```javascript
userProps:  { plan_tier: ['free', 'pro', 'enterprise'], platform: ['iOS', 'Android'] },
superProps: { app_version: ['1.0', '1.1', '2.0'] },
switches:   { stickyEventProps: ['plan_tier', 'platform', 'app_version'] },   // or top-level
```

each key must be declared in `userProps`, a persona's `properties`, or `superProps` (schema-first; undeclared keys throw). profile keys copy the profile's value (after the `user` hook). keys declared only in `superProps` resolve once per user and hold constant. sticky values land after `superProps` and before the `event` hook. measured: 67,355 of 67,355 events matched their profile. `(ctx) => ctx.profile.plan_tier` on a super prop does the same thing one field at a time.

with `hasLocation: true`, a user's events now share the user's city / region / country (1.7.0). before, every event drew a fresh random city — 0.8% of events matched their own profile.

### campaigns per user

`hasCampaigns: true` stamps UTMs on up to `maxTouchpointsPerUser` events per user, and before 1.7.0 every touchpoint drew a fresh random campaign — attribution data was uncorrelated noise. `campaignPerUser: true` (1.7.0) draws **one acquisition campaign per user** at birth, stamps its `utm_source` / `utm_campaign` / `utm_medium` / `utm_content` / `utm_term` on the profile, and every touchpoint carries those same values. any UTM key already on the profile wins over the draw, so a persona can own a channel:

```javascript
switches: { hasCampaigns: true, campaignPerUser: true },
personas: [
  { name: 'paid search', weight: 30, conversionModifier: 2.0, properties: { utm_source: 'google', utm_medium: 'cpc' } },
  { name: 'everyone else', weight: 70 },
]
```

"paid search converts 2x better than organic" is now declarative. measured: 0 of 399 users with more than one `utm_source`; 400 of 400 profiles carry it. ad spend is still independent of acquisitions (deferred to 1.8.0).

## seeded generation

all randomness is seeded. same seed + same config + concurrency=1 = identical output every time:

```javascript
{
  seed: 'my-reproducible-dataset',
  concurrency: 1
}
```

pin `datasetStart` and `datasetEnd` too, or the dataset window moves with the
calendar and every timestamp shifts.

**one exception: `insert_id`.** since 1.4.0 it is a `randomUUID()`, so it differs
on every run by design — that is what keeps Mixpanel from deduping re-imports of
the same dataset. strip `insert_id` before diffing two runs. everything else
(event count, order, timestamps, every property, profiles, groups) is
byte-identical.

## what gets generated

the result object contains everything:

```javascript
const result = await DUNGEON_MASTER(config);

result.eventData         // all generated events
result.userProfilesData  // user profiles
result.scdTableData      // SCD mutations
result.groupProfilesData // group profiles
result.adSpendData       // ad spend data
result.standaloneEventData // identity-less event snapshots
result.lookupTableData   // lookup table entries
result.mirrorEventData   // mirror dataset
result.warehouseMetricData // warehouse tables keyed by metric name
result.warehouseManifest // warehouse table manifest

result.eventCount        // total event count
result.userCount         // total user count
result.files             // written file paths (if writeToDisk)
result.time              // { start, end, delta, human }
result.importResults     // mixpanel import results (if token provided)
```

## text generation

dungeon-master includes a built-in text generator for creating organic-looking strings (support tickets, product reviews, search queries, chat messages, etc.) with configurable sentiment, style, and keyword injection:

```javascript
import { createTextGenerator, generateBatch } from '@ak--47/dungeon-master/text';

const generator = createTextGenerator({
  style: 'review',
  tone: 'pos',
  keywords: { products: ['AcmeWidget', 'ProPlan'], features: ['dashboard', 'API'] },
  keywordDensity: 0.3,
  typos: true,
  typoRate: 0.02
});

const reviews = generator.generateBatch({ n: 1000, returnType: 'objects' });
```

styles: `support`, `review`, `search`, `feedback`, `chat`, `email`, `forum`, `comments`, `tweet`

## scripts

```bash
npm test                      # default unit/integration/e2e suite; prunes data/tmp
npm run typecheck             # typescript check
npm run dungeon:run           # run a dungeon file locally
npm run dungeon:to-json       # convert JS dungeon to JSON (for UI import)
npm run dungeon:from-json     # convert JSON to JS dungeon
npm run dungeon:schema        # extract schema from a dungeon
```

`./scripts/` ships with the npm package — direct-run utilities for dungeon authoring + verification:

```bash
node scripts/run-dungeon.mjs <path>              # run a single dungeon
node scripts/run-many.mjs <dir> [--parallel N]   # run multiple dungeons concurrently
node scripts/dungeon-to-json.mjs <path>          # convert JS → JSON
node scripts/json-to-dungeon.mjs <path>          # convert JSON → JS
node scripts/extract-dungeon-schema.mjs <path>   # extract schema
node scripts/verify-runner.mjs <path> [prefix]   # generate at full fidelity for hook verification
```

## tests

1.8.1 compatibility and output changes: [upgrade guide](docs/guides/1.8.1-upgrade-guide.md).

vitest tests live under `tests/` in three tiers:

| dir | scope | wall time |
|---|---|---|
| `tests/unit/` | pure-function tests on helpers, validators, primitives — no `DUNGEON_MASTER()` calls | ~5s |
| `tests/integration/` | one generation pass per test, ≤300 users, in-memory output | ~50s |
| `tests/e2e/` | full pipeline — disk writes, file-path loading, multi-pass | ~50s |

run a single tier or file via `vitest` directly:

```bash
npx vitest run tests/unit                                  # unit tier (~5s)
npx vitest run tests/integration                           # integration tier
npx vitest run tests/e2e                                   # e2e tier
npx vitest run tests/unit tests/integration                # fast inner loop
npx vitest run tests/integration/features.test.js          # single file
npx vitest tests/unit                                       # watch mode
```

`tests/e2e/engine-shape-full-sweep.test.js` skips itself unless `RUN_FULL_SWEEP=1` is set (it wraps the long-running 194-combo engine sweep).

### editor and offline alignment tests

VS Code discovers one serial unit/integration suite through
`tests/alignment/regression-vitest.config.js`. The workspace disables Go test
discovery and ignores the overlapping diagnostic Vitest configs. After changing
these settings, run **Developer: Reload Window** if stale providers or test runs
remain in the Testing panel. Editor runs omit the pruning setup, but they are not
OS-sandboxed.

Use **Tasks: Run Test Task** for `test: regression (offline, macOS)`, or choose
the named alignment and sweep tasks from **Tasks: Run Task**. These test tasks
never invoke the prune or dungeon-run tasks. Existing dungeon-run cleanup is
unchanged and remains separate from testing.

```sh
node tests/alignment/run.mjs                               # offline alignment gate
node tests/alignment/run.mjs --sweep --timeout-ms=600000    # opt-in bounded sweep
```

Alignment is a separate test family, excluded from `npm test` and editor discovery.
Its runner enforces OS network denial on macOS, fails closed elsewhere, and kills
workers at the ten-minute deadline. Tests and reports live in the source checkout;
they are not included in the npm package. The default `npm test` and direct root
Vitest commands still prune `data` and `tmp` through their global setup.

### engine tests (direct-run, NOT vitest)

`tests/engine/` houses direct-run regression tests at scale. these are NOT vitest-compatible — invoke with `node` directly. used to catch engine regressions across a wide variety of dungeon configurations and for ad-hoc chart inspection. outputs land in `./tmp/` (gitignored).

```bash
node tests/engine/sweep-engine.mjs [--workers 4] [--tier short|normal|long|all]
                                                  # 194-combo strict-bar sweep on simplest.js
node tests/engine/sweep-bias.mjs                  # targeted bornRecentBias × born% exploration
node tests/engine/test-bunchiness.mjs <path>      # chart inspector (last-14d / first-14d / spike)
node tests/engine/test-nosedive.mjs <path>        # end-of-window nosedive check
node tests/engine/smoke-test-all.mjs [--dir]      # tiny-scale generation across all dungeons (PASS/FAIL)
```

engine tests are NOT shipped in the npm package and NOT run as part of `npm test`. the vitest gate at `tests/e2e/engine-shape-full-sweep.test.js` wraps `sweep-engine.mjs` and runs only when `RUN_FULL_SWEEP=1` is set.

## config reference

### one config surface, not two

three groups of keys accept both a nested sub-object and a flat top-level form:

| sub-object | keys it groups |
|---|---|
| `credentials` | `token`, `region`, `serviceAccount`, `serviceSecret`, `projectId` |
| `switches` | `hasLocation`, `hasCampaigns`, `hasAdSpend`, `hasSessionIds`, `hasAvatar`, `hasIOSDevices`, `hasAndroidDevices`, `hasDesktopDevices`, `hasBrowser`, `isAnonymous`, `alsoInferFunnels`, `singleCountry`, `campaignPerUser`, `stickyEventProps` |
| `identity` | `avgDevicePerUser`, `sessionTimeout` |

**the sub-object form is canonical.** the flat top-level keys are a back-compat
alias and stay supported. emit one form or the other — never both. when a key is
set in both places the **top-level value wins**, with a `verbose`-gated warning
you will not see unless `verbose: true`.

```javascript
// canonical
{ credentials: { token: process.env.MIXPANEL_TOKEN, region: 'US' },
  switches:    { hasCampaigns: true, hasAdSpend: true },
  identity:    { avgDevicePerUser: 2 } }

// back-compat alias — still works
{ token: process.env.MIXPANEL_TOKEN, region: 'US',
  hasCampaigns: true, hasAdSpend: true, avgDevicePerUser: 2 }
```

`hasAttributionFlags` is **not** a switch. the validator derives it from
`events[].isAttributionEvent`; setting it has no effect.

### `result.warnings` — what the engine changed

every value the engine clamped or flagged comes back on the result, regardless of
`verbose` (1.7.0). a config UI that shows the requested value can now show the
applied one instead of lying:

```javascript
const { warnings } = await DUNGEON_MASTER({ macro: 'growth', percentUsersBornInDataset: 80, ... });
// [{ key: 'percentUsersBornInDataset', requested: 80, applied: 30, severity: 'clamp',
//    reason: 'macro preset "growth" caps percentUsersBornInDataset at 30 to keep its shape; ...' }]
```

validator clamps come first (`percentUsersBornInDataset`, `bornRecentBias`,
`avgEventsPerUserPerDay`, `avgActiveDaysPerUser`, the `numDays < 14` and
`engagementDecay` warnings, auto-set `conversionWindowDays`), then run-level
aggregates with a `count`: `conversionRate` saturation per funnel and source
(`funnels[Checkout].conversionRate:persona "whale" conversionModifier`, requested 195,
applied 100), users matching no conditioned funnel (`funnels.conditions`), churn
washing out a persona multiplier (`personas.eventMultiplier`), and a
`strictEventCount` shortfall (`numEvents`). always an array, empty when nothing was
touched. console output stays `verbose`-gated.

the engine can only report its own clamps. a hook's own `Math.min(95, rate * 3)` never
reaches it — that cap belongs to the hook. see HOOKS.md.

### group keys

`groupKeys` accepts a positional tuple or a named object. both normalize to the
tuple internally, so hooks and the verifier see one shape:

```javascript
groupKeys: [
  ['company_id', 50],                                  // tuple
  ['team_id', 200, ['Deploy', 'Merge PR']],            // tuple + scoped events
  { key: 'org_id', cardinality: 25 },                  // named (v1.6.4)
  { key: 'workspace_id', cardinality: 80, events: ['Save'] },
]
```

an omitted or empty `events` list means every event carries that group key.

### commonly used properties

see [types.d.ts](types.d.ts) for the complete `Dungeon` interface. here are the most commonly used properties:

| property | type | default | description |
|----------|------|---------|-------------|
| `numUsers` | number | 1000 | number of users to generate |
| `numEvents` | number | 100000 | target event count (legacy fallback; derived from `avgEventsPerUserPerDay` when set) |
| `avgEventsPerUserPerDay` | number | derived | per-user-per-day rate (canonical event-volume primitive) |
| `numDays` | number | 30 | days the dataset spans (safe range [14, 365]) |
| `datasetStart` | ISO/unix | undefined | pin window start (for bit-exact deterministic runs); requires `datasetEnd` too |
| `datasetEnd` | ISO/unix | undefined | pin window end; recomputes `numDays` from start/end span |
| `seed` | string | random | RNG seed for reproducibility |
| `format` | string | `'csv'` | output format (csv, json, parquet) |
| `token` | string | null | mixpanel project token (triggers import) |
| `region` | string | `'US'` | mixpanel data residency (`US` / `EU` / `IN`) |
| `writeToDisk` | boolean/string | false | write files to ./data/ or a gs:// path |
| `gzip` | boolean | false | compress output files |
| `verbose` | boolean | false | print progress |
| `strictEventCount` | boolean | false | deliver exactly `numEvents` (forces `concurrency: 1`). 1.7.0: exact when capacity allows; a shortfall lands in `result.warnings` (`key: 'numEvents'`) |
| `autoPowerLaw` | boolean | true | `false` turns off the automatic 45/25/15 draw on 3–19-item string arrays (uniform picks). prefer `{ __weights }` |
| `stickyEventProps` | string[] | `[]` | profile keys copied onto every event of the user (schema-first: must be declared) |
| `campaignPerUser` | boolean | false | one campaign per user; UTMs on the profile and on every touchpoint. needs `hasCampaigns` |
| `singleCountry` | string | undefined | pin `hasLocation` geo to one country by ISO code or name (`'US'`, `'United States'`). a value that matches nothing throws |
| `batchSize` | number | 2500000 | records before auto-flush |
| `concurrency` | number | 1 | parallel user generation |
| `macro` | string/object | `'flat'` | big-picture trend preset (flat/steady/growth/viral/decline). canonical object spelling `{ preset, ...overrides }`; an object without `preset` is a custom, uncapped macro |
| `soup` | string/object | `'growth'` | intra-week / intra-day rhythm preset |
| `bornRecentBias` | number | 0 (from macro `flat`) | user birth date skew (safe range [-0.5, 0.5]; user-explicit values outside the band are clamped) |
| `percentUsersBornInDataset` | number | 12 (from macro `flat`) | % of users born in window (clamped to the named preset's cap; every clamp lands in `result.warnings`) |
| `preExistingSpread` | string | `'uniform'` (from macro `flat`) | placement of pre-existing users' first event |
| `avgActiveDaysPerUser` | number | undefined | concentrate events onto N distinct UTC days per user (preserves total event count). ignored when `retentionCurve` is set; warns when combined with `engagementDecay` |
| `retentionCurve` | object | undefined | per-day return probabilities. **wins over `avgActiveDaysPerUser`** when both are set. **day 1 has a floor near 0.85 the curve cannot move** — funnel steps spill into the next day regardless of the day plan (measured 0.885 for an asked 0.15; days 7 and 30 follow the curve). verify from day 7 on |
| `maxTouchpointsPerUser` | number | 10 | UTM stamping cap per user (Mixpanel `TOUCHPOINTS_LIMIT` parity) |
| `autoSortAfterEverything` | boolean | true | sort events by time after `everything` hook (defends greedy funnel engine) |
| `hook` | function/string | passthrough | data transformation function |
| `hasLocation` | boolean | false | include geo properties |
| `hasCampaigns` | boolean | false | include UTM properties |
| `hasAdSpend` | boolean | false | generate ad spend data |
| `standaloneEvents` | array | `[]` | identity-less cadence streams that import as events |
| `warehouseMetrics` | array | `[]` | local warehouse source tables + manifest, derived from generated events |
| `hasAnonIds` | boolean | false | generate anonymous IDs |
| `hasSessionIds` | boolean | false | generate session IDs |
| `alsoInferFunnels` | boolean | false | auto-generate funnels from events |

## why

i'm building a system that teaches LLMs how to find insights in high-volume, noisy, semi-structured event data. to do that, you need datasets where the patterns are known, complex, and realistic. dungeon-master is that dataset generator.

it's the very best kind of test data: the kind where you have the answer key. you know exactly what patterns are in there because you engineered them. and the noise around those patterns is realistic because the time distributions, property weights, and user behaviors are modeled from real analytics data.

pretty much any engineer who works with product analytics, data pipelines, or AI/ML would find this useful. it's also great for demos, load testing, and integration testing against any system that ingests event data.

## contributing

contributions welcome. for issues or feature requests: [github.com/ak--47/dungeon-master/issues](https://github.com/ak--47/dungeon-master/issues)
