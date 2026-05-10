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
tests/              # Vitest test suite (flat — all .test.js files at root level)
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

Uses **Vitest** (ESM-native). Tests are organized into three tiers under `tests/`:

| Tier | Criterion | Wall time | Allowed | Forbidden |
|------|-----------|-----------|---------|-----------|
| `tests/unit/` | Pure-function tests on helpers, validators, primitives | ~5s | Function calls, in-memory fixtures, mock event arrays | `DUNGEON_MASTER()`, `generate()`, file I/O |
| `tests/integration/` | One generation pass through `DUNGEON_MASTER()` at small scale | ~50s | `generate()` with ≤300 users, in-memory output | `writeToDisk: true`, network, GCS |
| `tests/e2e/` | Full pipeline: writes disk, loads dungeon files, GCS, multi-run | ~50s | All of the above | n/a |

`tests/e2e/sanity.test.js` is excluded by default (parked — hangs after Module Integration block; run isolated via `npx vitest run tests/e2e/sanity.test.js`).

### Running tests

Use `vitest` directly via `npx` for tier targeting (no npm script wrappers — keeps `package.json` slim):

```bash
npm test                                              # full suite (~95s, 1018 tests)
npx vitest run tests/unit                             # unit tier only (~5s)
npx vitest run tests/integration                      # integration tier (~50s)
npx vitest run tests/e2e                              # e2e tier (~50s)
npx vitest run tests/unit tests/integration           # fast inner loop (skip e2e)
npx vitest run tests/integration/features.test.js     # single file
npx vitest tests/unit                                  # watch mode on unit tier
```

Always pipe to `tail -50` to capture results without reading the entire output stream.

### Test files of note

- `tests/unit/utils.test.js` — Individual function tests (text generator, utils, weights)
- `tests/unit/dungeon-shapes.test.js` — Validates every dungeon under `dungeons/` imports + has valid config shape
- `tests/unit/hook-helpers-*.test.js` — Phase 3 atom unit tests (32 tests across 5 files)
- `tests/unit/macro-and-rate.test.js` — Macro preset + per-user-per-day rate primitive
- `tests/integration/orchestrators.test.js` — Context, storage, user-loop orchestration
- `tests/integration/advanced-features.test.js` — Personas, world events, engagement decay, data quality (killed-feature tests `describe.skip`'d after 1.4)
- `tests/integration/identity-model.test.js` — Identity model (stitch event, attempts, multi-device pool, pre-existing/born-in invariants)
- `tests/integration/hook-patterns-*.test.js` — Pattern integration tests + emulator self-tests (9 tests)
- `tests/integration/hooks-system.test.js` — Hook system: all hook types, double-fire prevention, temporal/two-pass/closure-state patterns
- `tests/integration/features.test.js` — strictEventCount, bornRecentBias, hook strings, product generators, function registry, JSON evaluator, mirror, ad spend, SCDs
- `tests/integration/performance.test.js` — Context caching, device pools, time shift
- `tests/integration/progress-callback.test.js` — Progress callback: throttle, fault tolerance, step updates, disable-after-3, return summary
- `tests/integration/conversion-window.test.js` / `auto-sort.test.js` / `touchpoint-cap.test.js` / `strict-event-autopromote.test.js` — v1.5 alignment guarantees
- `tests/e2e/module-api.test.js` — Module API + Mixpanel import end-to-end
- `tests/e2e/sessions.test.js` / `formats.test.js` / `module-options.test.js` — Pipeline output formats and option surface
- `tests/e2e/determinism.test.js` — Same seed → byte-equal output across canonical fixture
- `tests/e2e/my-buddy-stories.test.js` — Story acceptance gate: runs the migrated my-buddy dungeon and asserts its 3 documented stories via `emulateBreakdown`

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
                                //   v1.5: validator auto-promotes funnel-step events to isStrictEvent: true (warns)
  funnels: Funnel[]             // sequence, conversionRate, order, experiment, bindPropsIndex,
                                //   attempts (1.4: { min, max, conversionRate? }),
                                //   conversionWindowDays (v1.5: default 30, hard cap 180, auto-bump if timeToConvert > 30d)
  userProps, superProps, groupKeys, groupProps, scdProps, mirrorProps, lookupTables

  // Event volume — pick ONE
  numEvents: number             // Total target events. Fallback if avgEventsPerUserPerDay not set.
  avgEventsPerUserPerDay: number  // Per-user-per-active-day rate. Canonical primitive — born-late users get rate × remaining_days.

  // Trend shape — three orthogonal axes
  macro: MacroPreset | MacroConfig  // Big-picture trend across whole window. Default: "flat" (see Macro/Soup section)
  soup: SoupPreset | SoupConfig     // Intra-week / intra-day rhythm (see Macro/Soup section)
  avgActiveDaysPerUser: number      // v1.5: distinct-day concentrator. Total event count preserved; events cluster onto fewer days. Orthogonal to macro/soup. (See "Active-day distribution" below.)

  // v1.5 Mixpanel-aligned caps
  maxTouchpointsPerUser: number  // v1.5: cap UTM stamping per user (default 10 = Mixpanel TOUCHPOINTS_LIMIT). Sampled across user lifetime, not first-N.
  autoSortAfterEverything: boolean  // v1.5: engine sorts user events by time after `everything` hook (default true). Defends greedy funnel engine from out-of-order pushed clones.

  // Advanced
  strictEventCount: boolean     // Stop at exact numEvents (forces concurrency=1)
  // The next three are normally set by the macro preset; override only when you need a custom shape
  bornRecentBias: number        // -1..1; positive = recent skew, 0 = uniform, negative = early skew
  percentUsersBornInDataset     // 0..100; default 50 (from macro: "flat")
  preExistingSpread             // "uniform" (default) | "pinned"

  // I/O
  writeToDisk, gzip, batchSize, concurrency, verbose
  hook: Hook                    // Transform function (string or function)

  // Observability (1.4.5)
  onProgress: (update: ProgressUpdate) => void  // Throttled progress callback (fire-and-forget)
  progressInterval: number      // Min ms between callback invocations (default: 500)
}
```

## Active-day distribution (v1.5)

`avgActiveDaysPerUser` is a CONCENTRATOR — total event count is preserved
(`avgEventsPerUserPerDay × userActiveDays`), but events cluster onto fewer
distinct UTC days. Per-user count drawn from `normal(mean=N, sd=N/3)`,
clamped to `[1, userActiveDays]`. Day picking weighted by `soup.dayOfWeekWeights`,
preserving cohort-level weekly rhythm.

Default: undefined (legacy — events spread across the whole window via TimeSoup).

Per-active-day rate INFLATES when concentration is high. Validator warns when
implied rate > 50.

**Incompatibility with `engagementDecay`:** these two erosive primitives combine
destructively (decay drops events from late picked days, eroding the effective
active-day count). Use one or the other; if you need both, write decay as an
`everything` hook scoped to specific cohorts. See HOOKS.md §2.5.

## Progress Callback (post-1.4.5)

Callers pass `onProgress` on the dungeon config to receive periodic updates. The callback receives a discriminated union (`ProgressUpdate`) with three phases:

- **`generation`** — user/event counts, EPS, memory, percent complete (throttled to `progressInterval`)
- **`import`** — record type, processed/total, EPS, bytes (sourced from mixpanel-import's `progressCallback`, throttled)
- **`step`** — pipeline step name with `start`/`complete` status and duration (not throttled)

The callback is fault-tolerant: if it throws 3 times it is silently disabled. Bad values (non-functions) are ignored with a `console.warn` in verbose mode. The return value includes a `progress: { updates, errors, disabled }` summary when a callback was provided.

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
11. **(v1.5) Engine auto-sorts events by time after `everything` hook** — default ON; opt out via `autoSortAfterEverything: false`. Cloned events with arbitrary timestamps no longer need hand-sort calls. Defends greedy funnel engine from out-of-order injections.
12. **(v1.5) Validator auto-promotes funnel-step events to `isStrictEvent: true`** — set `isStrictEvent: false` explicitly to opt out and preserve mixed funnel/standalone semantics.
13. **(v1.5) Active-day shape lives in config (`avgActiveDaysPerUser`), not hooks** — reserve `injectOnNewDays` for cohort-conditional cases only.
14. **(v1.5) Touchpoint cap = 10** — engine stamps UTMs on up to `maxTouchpointsPerUser` (default 10) eligible events per user, sampled across lifetime. Attribution-biasing hooks should OVERWRITE engine-stamped values, not stamp fresh.

### Verifying Dungeons

After creating or modifying a dungeon, always verify schema integrity and hook patterns by running `/verify-dungeon`. This runs the dungeon at full scale, validates that hooks don't introduce undeclared columns (flag stamping), queries the output with DuckDB, and produces a diagnostic report at `research/hook-results.md` with schema verdicts and PASS/WEAK/FAIL verdicts for each hook. Verify BEFORE pushing data to Mixpanel.

The verifier (`@ak--47/dungeon-master/verify`) implements Mixpanel's exact counting semantics: greedy single-pass funnels with 2s grace + strict `<` conversion window (`history.cpp` / `conversion_window.cpp`), distinct-period frequency counting (`addiction_query.cpp`), null-aware aggregation (`normal_query.cpp`), and 10-touchpoint attribution cap (`attributed_value_reader.cpp`). Hook authors should read [HOOKS.md §2 "How Mixpanel Counts Things"](HOOKS.md#2-how-mixpanel-counts-things) before targeting any Mixpanel report — naive event-count or any-order-funnel intuitions diverge from what Mixpanel actually computes.

**Vertical dungeon proofs:** [`verification/verticals/`](verification/verticals/) ships a per-dungeon `<name>.verify.mjs` (CI gate) + `<name>.sql` (human inspection) for all 20 vertical dungeons. 107 documented hooks → 107 verification checks. Use these as reference when authoring new verifications; see [HOOKS.md §9](HOOKS.md#9-verification-patterns-from-the-v150-vertical-eval) for the recipe encyclopedia.

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

## Tuning guidance — safe ranges and engine guarantees (v1.5)

The v1.5 ship gate validated that `dungeons/technical/simplest.js` (no-hook baseline) passes a strict per-macro shape bar across a 194-combo cross-product matrix of macro × numDays × born% × rate × activeDays. See [plans/ENGINE-VALIDATION/PLAN.md](plans/ENGINE-VALIDATION/PLAN.md) and [plans/ENGINE-VALIDATION/FIX.md](plans/ENGINE-VALIDATION/FIX.md) for the methodology + sweep evidence.

### Safe ranges

| Knob | Safe range | Validator behavior outside range | Notes |
|------|-----------|----------------------------------|-------|
| `numDays` | `[14, 365]` | Warn below 14, no clamp (window may be pinned) | Strict-bar metrics use 14-day windows; <14 days is noisy. >365 grows memory linearly. |
| `percentUsersBornInDataset` | `[0, 100]` (sanity-clamped) | Hard clamp to [0,100]. **Per-macro clamp** when both `macro` AND this field are explicit: flat→12, steady→12, growth→30, viral→55, decline→5 | Macro = shape contract. Born above the cap breaks the macro's characteristic curve via cumulative-acquisition. To go higher, switch macros. |
| `bornRecentBias` | `[-0.5, 0.5]` | User-explicit values clamped to nearest bound. Compound: `born > 60 && bias > 0.4` clamps bias to 0.3. Macro presets exempt (viral=0.6 allowed). | Above 0.5 = unusable right-skew → right-edge density explosion. |
| `preExistingSpread` | `'uniform'` (default) or `'pinned'` | n/a | `'uniform'` is the clean baseline; `'pinned'` is for narrow growth shapes. |
| `avgEventsPerUserPerDay` | `[0.1, 50]` | Clamped to 50 above; `numEvents` recomputed | Above 50 = unrealistic load + memory cost. |
| `avgActiveDaysPerUser` | `[1, numDays * 0.5]` | Clamped to `floor(numDays/2)` above | Above 50% of `numDays` defeats the concentrator purpose. **Incompatible with `engagementDecay`** — see HOOKS.md §2.5. |
| `macro` | `'flat' \| 'steady' \| 'growth' \| 'viral' \| 'decline'` (default `'flat'`) | Throws on unknown name | Tail_ratio targets per macro: flat ≈ 1.1, steady ≈ 1.1, growth ≈ 1.4, viral ≈ 2.2, decline ≈ 1.0 (foobar 89-day). |

### The 6 strict-bar conditions (per-macro-tuned bands)

A no-hook dungeon "passes" the v1.5 strict bar when, for the resolved combo's macro, ALL of:

1. `tail_ratio = mean(events_last_W) / mean(events_first_W)` ∈ macro's tail band, where `W = min(14, floor(numDays/2))`
2. `lastDay >= 0.7 * sameDowPrev` (0.6 in `avgActiveDaysPerUser` mode), where `sameDowPrev = window[len-8]` (same DOW one week prior). Same-DOW comparison cancels soup-DOW noise (Sat=0.53, Tue/Wed=1.0); naive `lastDay/prevDay` would couple the metric to wall-clock calendar day.
3. `rightEdgeSpike = max(events_last_W) / median(events_window) < macro_spike_cap`
4. `min(events_last_7d) >= macro_l7c * mean(events_last_7d)` — no multi-day collapse
5. `futureEvents == 0` — no events past `FIXED_NOW`
6. `signupFloor`: every day in last 7 has `signup_count >= 0.05 * mean(daily signups across window)`. Bypassed when `mean < 5/day` or `macro === 'decline'` (variance noise dominates low-signup configs).

The harness (`scripts/sweep-engine.mjs`) pins `datasetEnd` to most-recent past Wednesday-EOD-UTC for full calendar-day determinism. Two back-to-back runs produce zero metric drift.

Per-macro bars (defined in `scripts/sweep-engine.mjs` `STRICT_BARS` and mirrored in `tests/unit/engine-shape-canary.test.js`):

| Macro   | tail band     | spike cap | l7c min |
|---------|---------------|-----------|---------|
| flat    | `[0.85, 1.5]` | 2.5       | 0.5     |
| steady  | `[0.85, 1.7]` | 2.5       | 0.5     |
| growth  | `[0.85, 2.5]` | 3.5       | 0.45    |
| viral   | `[0.5, 5.0]`  | 7.0       | 0.3     |
| decline | `[0.4, 2.0]`  | 3.0       | 0.3     |

### Known engine guarantees

- The 6 strict-bar conditions are tested on every commit (10-test canary at `tests/unit/engine-shape-canary.test.js`, ~5s wall) and pre-release (full 194-combo sweep at `tests/e2e/engine-shape-full-sweep.test.js`, opt-in via `RUN_FULL_SWEEP=1`).
- **Pure-engine outputs (no hooks) on `dungeons/technical/simplest.js` satisfy the strict bar across the documented safe ranges.** Departures from this guarantee are CI failures.
- **Hooks can intentionally violate the strict bar.** Decline-with-churn stories (engagementDecay + churn cohorts) can produce tail_ratio < 0.4; viral hooks with persona-driven late-cohort lift can exceed the spike cap. Engine guarantees apply to no-hook configs only. Hook authors should document intentional deviations in the dungeon's overview JSDoc.

## Property Type Helpers

Helpers for generating all 7 Mixpanel property data types. All are thunks (functions returning values) — pass them directly as event property values. The `choose()` resolver calls them per event.

| Helper | Mixpanel Type | Usage | Output Example |
|--------|--------------|-------|----------------|
| `["a","b","c"]` | String | Array of options → picks one | `"b"` |
| `weighNumRange(1,100)` | Numeric | Weighted number range | `42` |
| `[true, false]` | Boolean | Picks one | `false` |
| `dateRange(start?, end?)` | Date | Random date in range (defaults to dataset window) | `"2024-03-15T14:22:33"` |
| `listOf(pool, {min, max})` | List | Random subset from pool | `["Jazz","Folk"]` |
| `{key: value}` | Object | Plain object returned as-is | `{"tier":"premium"}` |
| `objectList(template, {min, max})` | List of Objects | Generate N objects from template | `[{id:42, cat:"A"}]` |

### `dateRange(start?, end?, format?)`

Generates a random date within a range. Defaults to dataset window (`datasetStart` → `datasetEnd`). Accepts ISO strings, unix seconds, or dayjs objects for bounds.

```javascript
properties: {
  signup_date: dateRange(),                           // within dataset window
  subscription_start: dateRange('2023-01-01', '2024-01-01'),  // custom range
  next_billing: dateRange(null, null, 'YYYY-MM-DD'),  // date-only format
}
```

### `listOf(pool, options?)`

Picks a random-length unique subset from a pool. Returns a Mixpanel List (JSON array).

```javascript
properties: {
  tags: listOf(['sale', 'new', 'featured', 'clearance'], { min: 1, max: 3 }),
  genres: listOf(['Rock', 'Pop', 'Jazz', 'Folk', 'Blues'], { min: 1, max: 2 }),
}
```

### `objectList(template, options?)`

Generates a list of objects from a template. Each value is independently resolved per object via `choose()`. Returns a Mixpanel List of Objects.

```javascript
properties: {
  cart_items: objectList({
    sku: weighNumRange(1000, 9999),
    name: ['Widget', 'Gadget', 'Thingamajig'],
    qty: [1, 1, 1, 2, 2, 3],
    price: weighNumRange(5, 200),
  }, { min: 1, max: 5 }),
}
```

For complex cases with cross-field dependencies, use a manual generator function instead (see `dungeons/technical/array-of-object-lookup.js` for example).

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
  pattern. Iterates with `/verify-dungeon` until patterns PASS.
- `/verify-dungeon <dungeon-path>` — Validates schema integrity (catches flag
  stamping) and verifies engineered hook patterns. Prefers the Phase 4
  emulator (`emulateBreakdown`) when the pattern matches one of the 5
  supported analyses; falls back to DuckDB for bespoke shapes. Always asserts
  the Phase 2 identity-model invariants (stitch count, pre-existing user
  stamping). Schema validation checks that hooks don't introduce undeclared
  columns — new columns are acceptable only if they appear on 100% of events
  of their type.
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
  TimeSoup, weighArray, generateUser,
  dateRange, listOf, objectList
} from '@ak--47/dungeon-master/utils';

// Hook helper atoms (Phase 3)
import {
  binUsersByEventCount, binUsersByEventInRange, countEventsBetween, userInProfileSegment,
  cloneEvent, dropEventsWhere, scaleEventCount, scalePropertyValue, shiftEventTime,
  scaleTimingBetween, scaleFunnelTTC, findFirstSequence,
  injectAfterEvent, injectBetween, injectBurst, injectOnNewDays,
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

// Verifier + Mixpanel breakdown emulator + schema validation (Phase 4)
// Counting primitives match Mixpanel's exact semantics — see HOOKS.md §2.
import {
  verifyDungeon, emulateBreakdown, deriveExpectedSchema, validateSchema,
  evaluateFunnel, timestampComesAfter, withinConversionWindow,
  countDistinctPeriods, nullAwareAvg, nullAwareSum, nullAwareExtreme, binByDistinctPeriods
} from '@ak--47/dungeon-master/verify';

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

### Execution Order (per user, post-1.5)

1. Assign persona → assign location (when `hasLocation`)
2. Create profile → merge persona properties
3. **User hook fires** (can override everything above)
4. **(v1.5)** Build active-day plan when `avgActiveDaysPerUser` set — picks
   target days, builds shuffled per-event day schedule
5. For each first funnel run (with attempts loop, identity stamping per step):
   funnel-pre → funnel events (with isAuthEvent stitch) → funnel-post
6. Standalone events (stamping mode based on userAuthed); active-day plan
   constrains TimeSoup to picked days when set
7. Generate events → apply world event props → apply data quality nulls
8. **Event hook fires** (can override everything above)
9. Filter `_drop` events → apply engagement decay → apply duplicate/late-arriving
10. Sort events by time → assign session_ids → per-session sticky device pick
    (v1.5: `bunchIntoSessions` REMOVED — natural TimeSoup-driven timestamps preserved)
11. **(v1.5)** Touchpoint cap: sample up to `maxTouchpointsPerUser` across
    lifetime, stamp UTMs (when `hasCampaigns: true`)
12. **Everything hook fires** (final authority) — meta exposes
    `authTime` + `isPreAuth(event)` predicate
13. **(v1.5)** Auto-sort by time (default ON; opt out via `autoSortAfterEverything: false`)
14. Future-time guard (drop events past `FIXED_NOW`)
15. Storage push (hooks for ad-spend / group / mirror / lookup fire here)

## Important Notes

- **ESM only** — `"type": "module"` in package.json
- **Time model**: Events are generated in a fixed historical window (`FIXED_NOW` = 2024-02-02), then shifted forward to present. `FIXED_BEGIN` is computed dynamically from `numDays`.
- **Hook types**: See Hook System section above. Core types: `event`, `user`, `everything`, `funnel-pre`, `funnel-post`, `scd-pre`. Storage-only: `ad-spend`, `group`, `mirror`, `lookup`

---

## TODO

### Performance: dayjs optimization (deferred)

Primary bottleneck is date/time manipulation. `TimeSoup` creates dayjs objects + `toISOString()` on every event. Fix: perform all time calculations using numeric Unix timestamps and only convert to ISO string once at the end. Key locations: `TimeSoup` in `utils.js`, timestamp handling in `events.js` and `user-loop.js`. Constraint: must preserve deterministic seeded generation within a bounded time range, then shift timestamps forward to present.
