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
macro: { preset: 'growth', percentUsersBornInDataset: 40 }  // preset + override
macro: { bornRecentBias: 0, percentUsersBornInDataset: 15, preExistingSpread: 'uniform' }  // fully custom
```

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

## seeded generation

all randomness is seeded. same seed + same config + concurrency=1 = identical output every time:

```javascript
{
  seed: 'my-reproducible-dataset',
  concurrency: 1
}
```

## what gets generated

the result object contains everything:

```javascript
const result = await DUNGEON_MASTER(config);

result.eventData         // all generated events
result.userProfilesData  // user profiles
result.scdTableData      // SCD mutations
result.groupProfilesData // group profiles
result.adSpendData       // ad spend data
result.lookupTableData   // lookup table entries
result.mirrorEventData   // mirror dataset

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
npm test                      # full vitest test suite
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
| `region` | string | `'US'` | mixpanel data residency |
| `writeToDisk` | boolean/string | false | write files to ./data/ or a gs:// path |
| `gzip` | boolean | false | compress output files |
| `verbose` | boolean | false | print progress |
| `strictEventCount` | boolean | false | stop at exact numEvents |
| `batchSize` | number | 2500000 | records before auto-flush |
| `concurrency` | number | 1 | parallel user generation |
| `macro` | string/object | `'flat'` | big-picture trend preset (flat/steady/growth/viral/decline) |
| `soup` | string/object | `'growth'` | intra-week / intra-day rhythm preset |
| `bornRecentBias` | number | 0 (from macro `flat`) | user birth date skew (safe range [-0.5, 0.5]; user-explicit values outside the band are clamped) |
| `percentUsersBornInDataset` | number | 12 (from macro `flat`) | % of users born in window (clamped per-macro when both `macro` and this field are explicit) |
| `preExistingSpread` | string | `'uniform'` (from macro `flat`) | placement of pre-existing users' first event |
| `avgActiveDaysPerUser` | number | undefined | concentrate events onto N distinct UTC days per user (preserves total event count) |
| `maxTouchpointsPerUser` | number | 10 | UTM stamping cap per user (Mixpanel `TOUCHPOINTS_LIMIT` parity) |
| `autoSortAfterEverything` | boolean | true | sort events by time after `everything` hook (defends greedy funnel engine) |
| `hook` | function/string | passthrough | data transformation function |
| `hasLocation` | boolean | false | include geo properties |
| `hasCampaigns` | boolean | false | include UTM properties |
| `hasAdSpend` | boolean | false | generate ad spend data |
| `hasAnonIds` | boolean | false | generate anonymous IDs |
| `hasSessionIds` | boolean | false | generate session IDs |
| `alsoInferFunnels` | boolean | false | auto-generate funnels from events |

## why

i'm building a system that teaches LLMs how to find insights in high-volume, noisy, semi-structured event data. to do that, you need datasets where the patterns are known, complex, and realistic. dungeon-master is that dataset generator.

it's the very best kind of test data: the kind where you have the answer key. you know exactly what patterns are in there because you engineered them. and the noise around those patterns is realistic because the time distributions, property weights, and user behaviors are modeled from real analytics data.

pretty much any engineer who works with product analytics, data pipelines, or AI/ML would find this useful. it's also great for demos, load testing, and integration testing against any system that ingests event data.

## contributing

contributions welcome. for issues or feature requests: [github.com/ak--47/dungeon-master/issues](https://github.com/ak--47/dungeon-master/issues)
