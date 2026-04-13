# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

**dungeon-master** (`@ak--47/dungeon-master`) is a Node.js ES module for generating realistic fake Mixpanel data at scale. It creates events, user profiles, group profiles, SCDs (Slowly Changing Dimensions), lookup tables, ad spend data, funnel analytics, and organic text — everything needed for testing and demoing Mixpanel.

It is an **npm module** (`import DUNGEON_MASTER from '@ak--47/dungeon-master'`). It is NOT a CLI tool, cloud function, or server.

### API

The default export `DUNGEON_MASTER` accepts multiple input types:
- **Config object** — plain JS object with events, funnels, hooks, etc.
- **File path** (`.js`/`.mjs`) — dynamic import of a dungeon module
- **File path** (`.json`) — JSON dungeon (UI schema format with `{ schema, hooks }`)
- **Array of file paths** — runs each dungeon, returns array of results
- **Raw JS string** — JavaScript source text with `export default { ... }`
- **Optional second argument** — config overrides merged into every dungeon

Input detection is handled by `lib/core/dungeon-loader.js`.

## Architecture

```
lib/
├── core/           # Context, config validation, HookedArray storage, dungeon loader
├── generators/     # Event, funnel, profile, SCD, adspend, mirror, text, product generators
├── orchestrators/  # user-loop (main generation), mixpanel-sender (import)
├── utils/          # utils, logger (Pino), mixpanel tracking, chart, project
└── templates/      # Default data, phrase banks, AI instruction templates, hook examples
scripts/            # dungeon management (run, convert to/from JSON, verify hooks)
dungeons/
├── vertical/       # Customer-facing story dungeons (healthcare, fintech, gaming, etc.)
└── technical/      # Feature/limit testing dungeons (SCDs, mirrors, groups, scale, etc.)
tests/              # Vitest test suite
```

### Key Patterns

- **Context Pattern**: All state flows through a `Context` object (config, storage, defaults, runtime metrics, time constants). No global state except `FIXED_NOW`/`FIXED_BEGIN` timestamps.
- **HookedArray**: Storage containers that support hook-based transformation, automatic batching to disk, and streaming to CSV/JSON/Parquet with optional gzip.
- **Dungeon Configs**: JS files that export a `Dungeon` configuration object defining events, funnels, user/group props, SCDs, etc.
- **Seeded RNG**: All randomness uses `chance` with configurable seeds for reproducible output.

### Data Generation Pipeline (index.js)

0. Resolve input (detect type → load from file/text/JSON/object → merge overrides)
1. Validate config + compute `FIXED_BEGIN` from `numDays`
2. Create context
3. Initialize HookedArray storage containers
4. Generate ad spend (if `hasAdSpend`)
5. Main `userLoop()` — generates users, profiles, events, funnels, SCDs
6. Generate group profiles
7. Generate group SCDs
8. Generate lookup tables
9. Generate mirror datasets
10. Flush to disk (if `writeToDisk`)
11. Send to Mixpanel (if `token` provided)
12. Return results

## Commands

```bash
npm test                      # Vitest test suite
npm run typecheck             # tsc --noEmit
npm run dev                   # nodemon scratch.mjs
npm run prune                 # Clean generated data files

# Dungeon management
npm run dungeon:run           # Run a dungeon file
npm run dungeon:to-json       # Convert JS dungeon → JSON (for UI)
npm run dungeon:from-json     # Convert JSON → JS dungeon
npm run dungeon:schema        # Extract simplified schema from dungeon
```

### Utility Scripts

The `scripts/` directory is shipped with the npm package and can be used directly:

```bash
node scripts/run-dungeon.mjs <path>              # Run a single dungeon
node scripts/dungeon-to-json.mjs <path>           # Convert JS dungeon → JSON
node scripts/json-to-dungeon.mjs <path>           # Convert JSON → JS dungeon
node scripts/extract-dungeon-schema.mjs <path>    # Extract dungeon schema
node scripts/run-many.mjs <dir> [--parallel N]    # Run multiple dungeons concurrently
node scripts/verify-runner.mjs <path> [prefix]    # Run dungeon at test scale (1K users, 100K events)
```

## Tests

Uses **Vitest** (ESM-native). Test files:

- `tests/unit.test.js` — Individual function tests (text generator, utils, weights)
- `tests/int.test.js` — Integration tests (context, storage, orchestrators)
- `tests/e2e.test.js` — End-to-end generation + Mixpanel import
- `tests/advanced-features.test.js` — Advanced features (personas, world events, decay, data quality, subscription, attribution, geo, features, anomalies)
- `tests/sanity.test.js` — Module integration (all dungeon types, formats, batch mode)
- `tests/performance.test.js` — Context caching, device pools, time shift
- `tests/hooks.test.js` — Hook system: all hook types, double-fire prevention, patterns (temporal, two-pass, closure state)
- `tests/features.test.js` — strictEventCount, bornRecentBias, hook strings, product generators, function registry, JSON evaluator

## Core Modules

### Generators (`lib/generators/`)

| File | Purpose |
|------|---------|
| `events.js` | Creates individual Mixpanel events with TimeSoup time distribution |
| `funnels.js` | Conversion sequences with ordering strategies, experiments (A/B/C variants), `bindPropsIndex` |
| `profiles.js` | User and group profile generation via `choose()` property resolution |
| `scd.js` | Slowly Changing Dimensions with frequency/timing/max config; outputs `time`, `startTime`, `insertTime` |
| `adspend.js` | Ad spend events with realistic cost/CPC/CTR/click metrics |
| `mirror.js` | Transform event data (create/update/fill/delete strategies) |
| `text.js` | Organic text generation (`createTextGenerator`/`generateBatch`) with styles, tones, typos, keywords |
| `product-lookup.js` | E-commerce product catalog (10K+ products with categories, ratings, stock) |
| `product-names.js` | Pre-configured text generators for product reviews, searches, comparisons |

### Core (`lib/core/`)

| File | Purpose |
|------|---------|
| `dungeon-loader.js` | Input detection and loading: file paths (.js/.mjs/.json), raw JS text, config objects. JSON dungeon revival, shape validation. |
| `context.js` | Context factory. Pre-computes weighted defaults, device pools. Time shift uses `.add(1, "day")`. |
| `config-validator.js` | Validates/enriches dungeon config. Hook string→function conversion, `strictEventCount` forces concurrency=1, event weight clamping [1,10], SCD credential fallback for UI jobs, `isStrictEvent` filtering in `inferFunnels()` |
| `storage.js` | HookedArray with batching, event validation in hook path, Pino logging, entity type tracking for SCDs |

### Utils (`lib/utils/`)

| File | Purpose |
|------|---------|
| `utils.js` | RNG (`initChance`/`getChance`), pickers (`pick`/`choose`/`weighArray`), `TimeSoup`, streaming (CSV/JSON/Parquet), `bytesHuman`, `formatDuration` |
| `logger.js` | Pino structured logging. Silent in `NODE_ENV=test`, pretty in dev, JSON in production. Child loggers: `serverLogger`, `dataLogger`, `importLogger` |
| `mixpanel.js` | Server-side Mixpanel tracking for AI observability (`trackAIJob`) |
| `function-registry.js` | Registry of valid functions for JSON dungeon configs (validation) |
| `json-evaluator.js` | Converts JSON function call objects to JavaScript code strings |
| `project.js` | Mixpanel project setup utilities |

### Orchestrators (`lib/orchestrators/`)

| File | Purpose |
|------|---------|
| `user-loop.js` | Main generation loop. `strictEventCount` bailout, `bornRecentBias` (power function for birth dates), memory/time in progress display, `percentUsersBornInDataset` default=15 |
| `mixpanel-sender.js` | Imports all data types to Mixpanel. Reads from batch files if needed. SCD type inference from values. |

## Key Config Properties

```typescript
interface Dungeon {
  // Core
  numUsers, numEvents, numDays, seed, format, token, region

  // Features
  hasAdSpend, hasCampaigns, hasLocation, hasAvatar, hasBrowser
  hasAndroidDevices, hasIOSDevices, hasDesktopDevices
  hasAnonIds, hasSessionIds, isAnonymous

  // Data model
  events: EventConfig[]         // event name, weight, properties, isFirstEvent, isStrictEvent
  funnels: Funnel[]             // sequence, conversionRate, order, experiment, bindPropsIndex
  userProps, superProps, groupKeys, groupProps, scdProps, mirrorProps, lookupTables

  // Advanced
  strictEventCount: boolean     // Stop at exact numEvents (forces concurrency=1)
  bornRecentBias: number        // 0=uniform, 1=heavily recent user births (default 0.3)
  percentUsersBornInDataset     // Default 15
  soup: SoupPreset | SoupConfig     // Time distribution (see TimeSoup section below)

  // I/O
  writeToDisk, gzip, batchSize, concurrency, verbose
  hook: Hook                    // Transform function (string or function)
}
```

## Hook System

Hooks are the primary mechanism for engineering deliberate trends and patterns in generated data. A hook is a single function on the dungeon config that receives every piece of data as it flows through the pipeline, with the opportunity to mutate it.

### Signature

```javascript
hook: function(record, type, meta) {
  // mutate record or return a new one
  return record;
}
```

- `record` — the data object being processed (event, profile, funnel config, or array of events)
- `type` — string identifying what kind of data (`"event"`, `"user"`, `"everything"`, etc.)
- `meta` — contextual metadata (varies by type)

### Hook Types and Execution Order

Per user, hooks fire in this order:

| Type | Fires in | `record` is | Return value | Metadata |
|------|----------|-------------|--------------|----------|
| `"user"` | `user-loop.js:156` | User profile object | Ignored (mutate in-place) | `{ user, config, userIsBornInDataset }` |
| `"scd-pre"` | `user-loop.js:175` | Array of SCD entries | Ignored (mutate in-place) | `{ profile, type, scd, config, allSCDs }` |
| `"funnel-pre"` | `funnels.js:70` | Funnel config object | Ignored (mutate in-place) | `{ user, profile, scd, funnel, config, firstEventTime }` |
| `"event"` | `events.js:176` | Single event (flat props) | **Used** (replaces event) | `{ user: { distinct_id }, config }` |
| `"funnel-post"` | `funnels.js:153` | Array of funnel events | Ignored (mutate in-place) | `{ user, profile, scd, funnel, config }` |
| `"everything"` | `user-loop.js:280` | Array of ALL user events | **Used** if array returned | `{ profile, scd, config, userIsBornInDataset }` |

Storage-only hooks (no upstream execution):

| Type | Fires in | `record` is |
|------|----------|-------------|
| `"ad-spend"` | `storage.js` | Ad spend event |
| `"group"` | `storage.js` | Group profile |
| `"mirror"` | `storage.js` | Mirror data point |
| `"lookup"` | `storage.js` | Lookup table entry |

**Important**: `event`, `user`, and `scd` hooks fire only once — in the generator/orchestrator. The storage layer skips re-running hooks for these types to prevent double-fire mutations (e.g., `price *= 2` would otherwise apply twice).

### Schema-First Hook Design

**The config defines the schema. Hooks shape the data within that schema.** This is the most important principle:

- Every property that appears in the final output MUST be defined in the dungeon config (`events` properties, `userProps`, or `superProps`) with a default value
- Hooks CANNOT invent new properties. They modify existing values, filter events, and inject events cloned from existing ones
- If a hook needs a boolean flag (like `payday`), define it in the event's `properties` as `[false]`. The hook sets it to `true` when the condition is met
- When injecting events, always clone from an existing event using spread: `{...existingEvent, time: newTime, user_id: uid}`
- This ensures the JSON schema output is complete and the dataset presents a consistent schema to downstream tools (Mixpanel, DuckDB, BigQuery)

### Hook Patterns Catalog

| Pattern | Hook Type | Description | Example |
|---------|-----------|-------------|---------|
| **Value modification** | `event` | Modify existing property values on specific events | `record.amount *= 3` |
| **Boolean flag activation** | `event` | Set config-defined boolean defaults to `true` | `record.payday = true` (defined as `[false]` in config) |
| **Temporal windowing** | `event` | Modify values within a date range | Check `dayjs(record.time).isAfter(start)` |
| **Relative date windows** | `event` | Use `DATASET_START.add(N, 'days')` for portable time ranges | Launch day 45, outage days 20-27 |
| **User profile modification** | `user` | Modify existing `userProps` values based on conditions | `record.seat_count = 200` (already in userProps) |
| **Funnel conversion manipulation** | `funnel-pre` | Change `record.conversionRate` based on user properties | Premium users get 1.3x conversion |
| **Funnel event injection** | `funnel-post` | Splice cloned events between funnel steps | Clone from existing event with spread |
| **Sessionization** | `everything` | Cluster events by time gaps, derive behavioral segments | 30-min gap → session count → power user |
| **Two-pass processing** | `everything` | First pass: scan patterns. Second pass: modify values | Identify buyers, then scale their amounts |
| **Cross-table correlation** | `everything` | Use `meta.profile` to drive event value modifications | User tier determines purchase amounts |
| **Event filtering/removal** | `everything` | Return filtered array to simulate churn | `return record.filter(e => ...)` |
| **Event injection by cloning** | `everything` | Clone existing events into browse-but-didn't-buy sessions | `events.push({...template, time: t})` |
| **Event duplication** | `everything` | Clone events with time offsets (viral, weekend surge) | Spread copies + add 1-3 hour offset |
| **Closure-based state (Maps)** | `event` | Module-level Maps track state across users | Cost overrun → forced scale-down next event |
| **Hash-based cohorts** | `everything` | Deterministic user segmentation without randomness | `userId.charCodeAt(0) % 10 === 0` |
| **Compound conditions** | `everything` | Require multiple behaviors for an effect | Slack AND PagerDuty → faster resolution |

### Critical Hook Rules

1. **Hooks do NOT add new properties.** All properties must be defined in the config with defaults. Hooks modify values within that schema.
2. **Properties are FLAT on event records** — use `record.amount`, NOT `record.properties.amount`
3. **Injected events must be cloned** from existing events using spread (`{...existingEvent}`), then override `time`, `user_id`, and values. Never construct events from scratch.
4. **Spliced events need `user_id`** — copy from source event: `user_id: event.user_id` (not `distinct_id`)
5. **Spliced events need `time`** — must be a valid ISO string
6. **Use `dayjs` for time operations** inside hooks
7. **Use the seeded `chance` instance** from module scope for randomness
8. **`everything` is the most powerful hook** — it sees all events for one user, can correlate across event types, and access `meta.profile` to drive behavior based on user properties
9. **Return `record`** from `event` hooks (single object only). For `everything`, return the (possibly modified) array
10. **To drop/filter events (churn, drop-off, seasonal dips)**: use the `everything` hook: `return record.filter(e => !shouldDrop(e))`. The `everything` hook is the ONLY place where events can be removed.

### Verifying Hooks with DuckDB

After creating or modifying a dungeon, always verify that hooks actually produce their intended patterns by running `/verify-hooks`. This generates data at small scale (1K users, 100K events), queries the output with DuckDB, and produces a diagnostic report at `research/hook-results.md` with PASS/WEAK/FAIL verdicts for each hook. Verify BEFORE pushing data to Mixpanel.

## TimeSoup — Time Distribution System

TimeSoup controls how events are distributed across the time range. It uses Gaussian cluster sampling layered with day-of-week and hour-of-day accept/reject weighting derived from real Mixpanel data.

### Soup Presets

Set `soup` to a preset string for quick configuration:

```javascript
soup: "growth"     // default — gradual uptrend with weekly cycle
soup: "steady"     // flat, mature SaaS pattern
soup: "spiky"      // dramatic peaks and valleys
soup: "seasonal"   // 3-4 major waves across the dataset
soup: "global"     // flat DOW + flat HOD (no cyclical patterns)
soup: "churny"     // flat distribution, all users pre-exist (pair with churn hooks)
soup: "chaotic"    // wild variation, few tight peaks
```

Presets also suggest `bornRecentBias` and `percentUsersBornInDataset` values (applied only if not explicitly set in the dungeon config).

### Custom Soup Config

Override specific parameters or use a preset as a base:

```javascript
// Preset with overrides
soup: { preset: "spiky", deviation: 5 }

// Fully custom
soup: {
  peaks: 200,           // number of Gaussian clusters (default: numDays*2)
  deviation: 2,         // peak tightness, higher = tighter (default: 2)
  mean: 0,              // offset from chunk center (default: 0)
  dayOfWeekWeights: [0.637, 1.0, 0.999, 0.998, 0.966, 0.802, 0.528],  // [Sun..Sat]
  hourOfDayWeights: [/* 24 elements, 0=midnight UTC */],
}

// Disable cyclical patterns
soup: { dayOfWeekWeights: null, hourOfDayWeights: null }
```

### Key Implementation Details

- DOW uses accept/reject sampling (retry with new Gaussian sample if rejected)
- HOD uses redistribution (directly sample a new hour from weight distribution)
- Peaks default to `numDays * 2` to avoid chunk-boundary interference with 7-day week cycle
- Default weights are derived from real Mixpanel data and produce realistic weekly "matterhorn hump" and daily curves
- Presets are defined in `lib/templates/soup-presets.js` and resolved in `config-validator.js`

## Dependencies

**Core**: `ak-tools`, `chance`, `dayjs`, `mixpanel-import`, `p-limit`, `seedrandom`, `pino`, `pino-pretty`, `mixpanel`, `sentiment`, `tracery-grammar`, `hyparquet-writer`

**Cloud**: `@google-cloud/storage` (for `gs://` output paths)

**Dev**: `vitest`, `nodemon`, `typescript`

## Claude Code Skills

Three skills are available via slash commands:

- `/create-dungeon <description>` — Design and create a new dungeon with 8 architected analytics hooks, companion JSON schema, and Mixpanel report instructions
- `/verify-hooks <dungeon-path>` — Run a dungeon at constrained params (1K users, 100K events) and use DuckDB to verify hook patterns appear in the output
- `/analyze-soup <dungeon-path>` — Run a dungeon and analyze its time distribution at week/day/hour granularities

The verify runner script lives at `scripts/verify-runner.mjs` — skills use it, do not create a new one.

## Advanced Features

All advanced features are **optional and additive**. If a config key is absent, behavior is identical to the original. Hooks always override these features — hooks are the final authority.

### Feature Summary

| Feature | Config Key | What It Does |
|---------|-----------|--------------|
| **Personas** | `personas` | Structured user archetypes with distinct event volumes, conversion rates, and properties |
| **World Events** | `worldEvents` | Shared temporal events (outages, campaigns, launches) affecting all users |
| **Engagement Decay** | `engagementDecay` | Gradual user engagement decline (exponential/linear/step) replacing binary churn |
| **Data Quality** | `dataQuality` | Controlled imperfections: nulls, duplicates, bots, late-arriving events, timezone confusion |
| **Subscription** | `subscription` | Revenue lifecycle: trial → paid → upgrade → downgrade → cancel → win-back |
| **Attribution** | `attribution` | Connected campaign attribution linking ad spend to user acquisition |
| **Geo** | `geo` | Sticky locations, timezone-aware activity, regional properties |
| **Features** | `features` | Progressive feature adoption with S-curve rollout mid-dataset |
| **Anomalies** | `anomalies` | Extreme values, error bursts, coordinated signup spikes |

### Key Integration Points

- **Personas** flow through all hook `meta.persona` — hooks can read persona assignments
- **World Events** inject properties and modulate volume via accept/reject sampling in `events.js`
- **Engagement Decay** filters events in `user-loop.js` between `_drop` filter and `everything` hook
- **Data Quality** applies nulls/timezone in `events.js`, duplicates/late-arriving in `user-loop.js`, bots after user loop
- **Subscription** events injected between `_drop` filter and `everything` hook in `user-loop.js`
- **Attribution** assigns campaigns at user creation in `user-loop.js`
- **Geo** assigns sticky location at user creation, region properties merged into profile
- **Features** apply per-event in `events.js` using logistic adoption function
- **Anomalies** extreme values per-event in `events.js`, bursts/coordinated after user loop in `user-loop.js`

### Execution Order (per user)

1. Assign persona → assign region/location → assign campaign attribution
2. Create profile → merge persona properties → merge region properties → merge attribution
3. **User hook fires** (can override everything above)
4. Generate events → apply world event props → apply feature adoption → apply anomaly extreme values → apply data quality nulls
5. **Event hook fires** (can override everything above)
6. Filter `_drop` events → inject subscription events → apply engagement decay → apply duplicate/late-arriving
7. **Everything hook fires** (final authority)

### Showcase Dungeon

`research/feature-showcase.js` exercises all 9 features in a realistic e-commerce scenario.

## Important Notes

- **ESM only** — `"type": "module"` in package.json
- **Time model**: Events are generated in a fixed historical window (`FIXED_NOW` = 2024-02-02), then shifted forward to present. `FIXED_BEGIN` is computed dynamically from `numDays`.
- **Hook types**: See Hook System section above. Core types: `event`, `user`, `everything`, `funnel-pre`, `funnel-post`, `scd-pre`. Storage-only: `ad-spend`, `group`, `mirror`, `lookup`

---

## TODO

### Performance: dayjs optimization (deferred)

Primary bottleneck is date/time manipulation. `TimeSoup` creates dayjs objects + `toISOString()` on every event. Fix: perform all time calculations using numeric Unix timestamps and only convert to ISO string once at the end. Key locations: `TimeSoup` in `utils.js`, timestamp handling in `events.js` and `user-loop.js`. Constraint: must preserve deterministic seeded generation within a bounded time range, then shift timestamps forward to present.
