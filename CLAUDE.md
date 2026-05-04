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
├── hook-helpers/   # Phase 3 atoms (cohort/mutate/timing/inject/identity)
├── hook-patterns/  # Phase 4 high-level recipes (one per Mixpanel analysis)
├── verify/         # Mixpanel breakdown emulator + verifyDungeon CI helper
└── templates/      # Default data, phrase banks, AI instruction templates, hook examples
scripts/            # dungeon management (run, convert to/from JSON, verify hooks)
dungeons/
├── vertical/       # Customer-facing story dungeons (healthcare, fintech, gaming, etc.)
└── technical/      # Feature/limit testing dungeons (SCDs, mirrors, groups, scale,
                    # plus pattern-* fixtures and identity-model-verify.js)
tests/              # Vitest test suite (incl. tests/hook-helpers, hook-patterns,
                    # identity-model.test.js, my-buddy-stories.test.js)
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
- `tests/advanced-features.test.js` — Surviving advanced features (personas, world events, engagement decay, data quality). Killed-feature tests for subscription/attribution/geo/features/anomalies are `describe.skip`'d after the 1.4 audit.
- `tests/identity-model.test.js` — Phase 2 identity model (stitch event, attempts, multi-device pool, pre-existing/born-in invariants).
- `tests/hook-helpers/*.test.js` — Phase 3 atom unit tests (32 tests across 5 files).
- `tests/hook-patterns/*.test.js` — Phase 4 pattern integration tests + emulator self-tests (9 tests).
- `tests/my-buddy-stories.test.js` — Phase 6 acceptance gate: runs the migrated my-buddy dungeon at small scale and asserts each of its 3 documented stories via `emulateBreakdown`.
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
| `user-loop.js` | Main generation loop. `strictEventCount` bailout, `bornRecentBias` (power function for birth dates), memory/time in progress display, `percentUsersBornInDataset` default=50 |
| `mixpanel-sender.js` | Imports all data types to Mixpanel. Reads from batch files if needed. SCD type inference from values. |

## Key Config Properties

```typescript
interface Dungeon {
  // Core
  numUsers, numEvents, numDays, seed, format, token, region

  // Features
  hasAdSpend, hasCampaigns, hasLocation, hasAvatar, hasBrowser
  hasAndroidDevices, hasIOSDevices, hasDesktopDevices
  hasAnonIds                    // @deprecated 1.4 — alias for avgDevicePerUser:1
  avgDevicePerUser: number      // 0=no device stamping, 1=single sticky, >1=normal-dist pool, sticky per session
  hasSessionIds, isAnonymous

  // Data model
  events: EventConfig[]         // event, weight, properties, isFirstEvent, isStrictEvent,
                                //   isAuthEvent (1.4), isAttributionEvent (1.4)
  funnels: Funnel[]             // sequence, conversionRate, order, experiment, bindPropsIndex,
                                //   attempts (1.4: { min, max, conversionRate? })
  userProps, superProps, groupKeys, groupProps, scdProps, mirrorProps, lookupTables

  // Event volume — pick ONE
  numEvents: number             // Total target events. Fallback if avgEventsPerUserPerDay not set.
  avgEventsPerUserPerDay: number  // Per-user-per-active-day rate. Canonical primitive — born-late users get rate × remaining_days.

  // Trend shape — two orthogonal axes
  macro: MacroPreset | MacroConfig  // Big-picture trend across whole window. Default: "flat" (see Macro/Soup section)
  soup: SoupPreset | SoupConfig     // Intra-week / intra-day rhythm (see Macro/Soup section)

  // Advanced
  strictEventCount: boolean     // Stop at exact numEvents (forces concurrency=1)
  // The next three are normally set by the macro preset; override only when you need a custom shape
  bornRecentBias: number        // -1..1; positive = recent skew, 0 = uniform, negative = early skew
  percentUsersBornInDataset     // 0..100; default 50 (from macro: "flat")
  preExistingSpread             // "uniform" (default) | "pinned"

  // I/O
  writeToDisk, gzip, batchSize, concurrency, verbose
  hook: Hook                    // Transform function (string or function)
}
```

## Identity Model (post-1.4)

Three top-level knobs govern user / device / auth identity. All are additive —
omitting them leaves the engine in pre-1.4 default behavior.

| Knob | Default | Behavior |
|------|---------|----------|
| `avgDevicePerUser` | 0 | 0 = no `device_id` stamping; 1 = single sticky device; >1 = per-user pool sized by normal distribution (mean=value, sd≈value/2, ≥1 integer), with sticky-per-session device assignment after `assignSessionIds` runs |
| `hasAnonIds` | false | @deprecated alias. `true` is interpreted as `avgDevicePerUser: 1` |
| `EventConfig.isAuthEvent` | false | Marks the identity stitch step. Inside an `isFirstFunnel` for born-in-dataset users, the engine stamps user_id+device_id ON this event. Pre-auth funnel steps get `device_id` only; post-auth get `user_id` only. |
| `Funnel.attempts` | none | `{ min, max, conversionRate? }` — failed-prior-attempt count. Total passes = failedPriors + 1. Final attempt uses `attempts.conversionRate ?? funnel.conversionRate`. Failed attempts truncate before the first `isAuthEvent` step. |
| `EventConfig.isAttributionEvent` | false | When `hasCampaigns: true`, only flagged events get UTMs (~25%). Without flags, ~25% of all events get UTMs (legacy fallback). |

The legacy 42% per-event `user_id` dice is REMOVED. Every event now gets
`user_id` by default (unless the per-step stamping mode is `device_only` for a
pre-auth funnel step, or the user is born-in-dataset and never reached the
`isAuthEvent`).

Hook meta (`funnel-pre`, `funnel-post`, `everything`) carries the full
attempts + identity context. See `types.d.ts` for the JSDoc on
`HookMetaFunnelPre` / `HookMetaFunnelPost` / `HookMetaEverything`.

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

## Trend Shape — Macro and Soup

Two orthogonal axes shape how events are distributed in time:

- **`macro`** — big-picture trend across the whole window (births, growth, decline). Sets `bornRecentBias`, `percentUsersBornInDataset`, `preExistingSpread`. Default: `"flat"`.
- **`soup`** — intra-week and intra-day rhythm (DOW/HOD weights, peak count, deviation). Default: `"growth"`.

Pair them independently. Most dungeons want `macro: "flat"` (so the chart doesn't blow up at the right edge) plus a soup that gives the desired weekly/daily texture.

### Macro Presets

```javascript
macro: "flat"     // DEFAULT — pure weekly oscillation, no net trend. Use when hooks supply the story.
macro: "steady"   // Slight uptrend, mature-SaaS feel
macro: "growth"   // Visible acquisition story, no spike at the right edge
macro: "viral"    // Hockey-stick acquisition; pair with persona/feature hooks
macro: "decline"  // Sunsetting product; pair with churn hooks
```

Macro preset values are defined in [`lib/templates/macro-presets.js`](lib/templates/macro-presets.js) and resolved in [`lib/core/config-validator.js`](lib/core/config-validator.js). Each preset is a `{ bornRecentBias, percentUsersBornInDataset, preExistingSpread }` triple.

You can override individual fields:

```javascript
macro: { preset: "growth", bornRecentBias: 0.5 }   // growth defaults but stronger recency
macro: { bornRecentBias: 0, percentUsersBornInDataset: 25, preExistingSpread: "uniform" }
```

Or set the underlying fields directly on the dungeon config — they win over the macro preset's values.

### Why this fixes the "blow-up at the right edge"

Three things changed at once:
1. **`avgEventsPerUserPerDay` is the canonical event-volume primitive.** A user born late in the window now gets `rate × remaining_days` events, not the full `numEvents/numUsers` budget compressed into a tiny window. Density per active day stays constant. (`numEvents` still works as a fallback — config-validator derives the rate.)
2. **Macro defaults to `"flat"`** so new dungeons don't inherit the legacy growth-bias settings. Existing dungeons that depend on a growth shape can opt into `macro: "growth"`.
3. **Pre-existing users' first event time spreads uniformly across `[FIXED_BEGIN-30d, FIXED_BEGIN]`** instead of all stacking at `FIXED_BEGIN`.

See `research/end-bunchiness.md` for the full diagnosis and experiment data.

### Soup Presets

Set `soup` to a preset string for quick configuration:

```javascript
soup: "growth"     // default — standard intra-week rhythm with real-world DOW/HOD
soup: "steady"     // tighter clustering, mature SaaS texture
soup: "spiky"      // dramatic peaks and valleys
soup: "seasonal"   // 3-4 major waves across the dataset
soup: "global"     // flat DOW + flat HOD (no cyclical patterns)
soup: "churny"     // standard rhythm; pair with macro: "decline" for declining shape
soup: "chaotic"    // wild variation, few tight peaks
```

Soup presets only set intra-week / intra-day fields. Birth-distribution settings (which used to be bundled into soup) now live exclusively in `macro`.

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
- Soup presets are defined in `lib/templates/soup-presets.js`; macro presets in `lib/templates/macro-presets.js`. Both resolved in `config-validator.js`.

## Dependencies

**Core**: `ak-tools`, `chance`, `dayjs`, `mixpanel-import`, `p-limit`, `seedrandom`, `pino`, `pino-pretty`, `mixpanel`, `sentiment`, `tracery-grammar`, `hyparquet-writer`

**Cloud**: `@google-cloud/storage` (for `gs://` output paths)

**Dev**: `vitest`, `nodemon`, `typescript`

## Claude Code Skills (post-1.4 pipeline)

Four slash commands, with a clear schema → hooks → verify pipeline:

- `/create-dungeon <description>` — SCHEMA ONLY. Designs events, funnels,
  superProps, userProps, and identity-model knobs (`isAuthEvent`, `attempts`,
  `avgDevicePerUser`). Does NOT write the `hook` function. Output goes to
  `dungeons/user/<name>.js`.
- `/write-hooks <dungeon-path> <story>` — Writes the `hook` function on an
  existing dungeon, using the Phase 3 atom helpers and Phase 4 patterns. Adds
  a documentation block above the hook with Mixpanel report instructions per
  pattern. Iterates with `verify-hooks` until patterns PASS.
- `/verify-hooks <dungeon-path>` — Verifies engineered patterns. Prefers the
  Phase 4 emulator (`emulateBreakdown`) when the pattern matches one of the 5
  supported analyses; falls back to DuckDB for bespoke shapes. Always asserts
  the Phase 2 identity-model invariants (stitch count, pre-existing user
  stamping).
- `/analyze-soup <dungeon-path>` — Run a dungeon and analyze its time
  distribution at week/day/hour granularities.

The verify runner script lives at `scripts/verify-runner.mjs` — skills use it,
do not create a new one.

## Public API Surface (post-1.4)

```js
import DUNGEON_MASTER from '@ak--47/dungeon-master';

// Utility primitives — used by every dungeon config
import {
  weighNumRange, pickAWinner, initChance,
  TimeSoup, weighArray, generateUser
} from '@ak--47/dungeon-master/utils';

// Hook helper atoms (Phase 3)
import {
  binUsersByEventCount, binUsersByEventInRange, countEventsBetween, userInProfileSegment,
  cloneEvent, dropEventsWhere, scaleEventCount, scalePropertyValue, shiftEventTime,
  scaleTimingBetween, scaleFunnelTTC, findFirstSequence,
  injectAfterEvent, injectBetween, injectBurst,
  isPreAuthEvent, splitByAuth
} from '@ak--47/dungeon-master/hook-helpers';

// Hook patterns (Phase 4)
import {
  applyFrequencyByFrequency,
  applyFunnelFrequencyBreakdown,
  applyAggregateByBin,
  applyTTCBySegment,
  applyAttributedBySource
} from '@ak--47/dungeon-master/hook-patterns';

// Verifier + Mixpanel breakdown emulator (Phase 4)
import { verifyDungeon, emulateBreakdown } from '@ak--47/dungeon-master/verify';

// Text generation
import { createTextGenerator, generateBatch } from '@ak--47/dungeon-master/text';

// Types
import type { Dungeon, EventConfig, Funnel, AttemptsConfig } from '@ak--47/dungeon-master';
```

## Advanced Features (post-1.4)

Surviving advanced features are **optional and additive**. If a config key is
absent, behavior is identical to the baseline. Hooks always override — hooks
are the final authority.

### Feature Summary

| Feature | Config Key | What It Does |
|---------|-----------|--------------|
| **Personas** | `personas` | Structured user archetypes with distinct event volumes, conversion rates, and properties |
| **World Events** | `worldEvents` | Shared temporal events (outages, campaigns, launches) affecting all users |
| **Engagement Decay** | `engagementDecay` | Gradual user engagement decline (exponential/linear/step) replacing binary churn |
| **Data Quality** | `dataQuality` | Controlled imperfections: nulls, duplicates, bots, late-arriving events, timezone confusion |

### Removed in 1.4 (silently ignored, one warning per dungeon)

`subscription`, `attribution`, `geo`, `features`, `anomalies` were removed
from the engine in 1.4. The validator strips these config keys with a single
deprecation warning per dungeon and continues. Recreate any of these patterns
via hooks (see `lib/hook-patterns/*` and the `write-hooks` skill).
`hasCampaigns: true` still produces UTM stamping; opt into per-event control
with `EventConfig.isAttributionEvent: true`.

### Key Integration Points

- **Personas** flow through all hook `meta.persona` — hooks can read persona assignments
- **World Events** inject properties and modulate volume via accept/reject sampling in `events.js`
- **Engagement Decay** filters events in `user-loop.js` between `_drop` filter and `everything` hook
- **Data Quality** applies nulls/timezone in `events.js`, duplicates/late-arriving in `user-loop.js`, bots after user loop

### Execution Order (per user, post-1.4)

1. Assign persona → assign location (when `hasLocation`)
2. Create profile → merge persona properties
3. **User hook fires** (can override everything above)
4. For each first funnel run (with attempts loop, identity stamping per step):
   funnel-pre → funnel events (with isAuthEvent stitch) → funnel-post
5. Standalone events (stamping mode based on userAuthed)
6. Generate events → apply world event props → apply data quality nulls
7. **Event hook fires** (can override everything above)
8. Filter `_drop` events → apply engagement decay → apply duplicate/late-arriving
9. Bunch into sessions → assign session_ids → per-session sticky device pick
10. **Everything hook fires** (final authority) — meta now exposes
    `authTime` + `isPreAuth(event)` predicate
11. Storage push (hooks for ad-spend / group / mirror / lookup fire here)

## Important Notes

- **ESM only** — `"type": "module"` in package.json
- **Time model**: Events are generated in a fixed historical window (`FIXED_NOW` = 2024-02-02), then shifted forward to present. `FIXED_BEGIN` is computed dynamically from `numDays`.
- **Hook types**: See Hook System section above. Core types: `event`, `user`, `everything`, `funnel-pre`, `funnel-post`, `scd-pre`. Storage-only: `ad-spend`, `group`, `mirror`, `lookup`

---

## TODO

### Performance: dayjs optimization (deferred)

Primary bottleneck is date/time manipulation. `TimeSoup` creates dayjs objects + `toISOString()` on every event. Fix: perform all time calculations using numeric Unix timestamps and only convert to ISO string once at the end. Key locations: `TimeSoup` in `utils.js`, timestamp handling in `events.js` and `user-loop.js`. Constraint: must preserve deterministic seeded generation within a bounded time range, then shift timestamps forward to present.
