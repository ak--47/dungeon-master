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
  './dungeons/vertical/gaming.js',
  './dungeons/vertical/media.js',
  './dungeons/vertical/food-delivery.js'
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
const result = await DUNGEON_MASTER('./dungeons/vertical/fintech.js', {
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

see `dungeons/vertical/` for customer-facing story dungeons (18 events, 8 hooks) and `dungeons/technical/` for feature-testing dungeons (mirrors, groups, scale, anonymous users).

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

## timesoup

timesoup controls how events are distributed across time. it uses gaussian cluster sampling layered with day-of-week and hour-of-day weighting derived from... i won't tell you. a prize goes to whoever can guess. the result is realistic temporal patterns: weekday peaks, weekend valleys, morning surges, afternoon dips.

### presets

```javascript
soup: 'growth'    // default. gradual uptrend with weekly cycles
```

| preset | pattern | use case |
|--------|---------|----------|
| `"steady"` | flat, minimal variation | mature saas, utility apps |
| `"growth"` | gradual uptrend + weekly cycle | general purpose (default) |
| `"spiky"` | dramatic peaks and valleys | gaming, social, viral products |
| `"seasonal"` | 3-4 major waves | ecommerce, education |
| `"global"` | flat DOW + flat HOD | global saas, infrastructure |
| `"churny"` | flat, no growth trend | declining products (pair with churn hooks) |
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

## user generation

users are generated with configurable birth distributions. `percentUsersBornInDataset` controls how many users were "created" during the dataset window vs. pre-existing. `bornRecentBias` skews new user creation toward recent dates (0 = uniform, 1 = heavily recent).

```javascript
{
  numUsers: 10_000,
  percentUsersBornInDataset: 25,  // 25% of users sign up during the time window
  bornRecentBias: 0.5             // new users skew toward recent dates
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
npm run dungeon:run           # run a dungeon file locally
npm run dungeon:to-json       # convert JS dungeon to JSON (for UI import)
npm run dungeon:from-json     # convert JSON to JS dungeon
npm test                      # vitest test suite
npm run typecheck             # typescript check
```

## config reference

see [types.d.ts](types.d.ts) for the complete `Dungeon` interface. here are the most commonly used properties:

| property | type | default | description |
|----------|------|---------|-------------|
| `numUsers` | number | 1000 | number of users to generate |
| `numEvents` | number | 100000 | target event count |
| `numDays` | number | 30 | days the dataset spans |
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
| `soup` | string/object | `'growth'` | time distribution preset |
| `bornRecentBias` | number | 0.3 | user birth date skew (0-1) |
| `percentUsersBornInDataset` | number | 15 | % of users born in time window |
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
