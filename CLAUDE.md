# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Project

**dungeon-master** (`@ak--47/dungeon-master`) is a Node.js ES module that generates realistic fake Mixpanel data at scale: events, profiles, group profiles, SCDs, lookup tables, ad spend, mirror datasets, organic text. It is an **npm module** (`import DUNGEON_MASTER from '@ak--47/dungeon-master'`) — not a CLI, server, or cloud function.

The default export accepts: a config object, a path to a `.js`/`.mjs`/`.json` dungeon file, an array of paths, or a raw JS source string. An optional second argument merges overrides into every dungeon. Input detection lives in [lib/core/dungeon-loader.js](lib/core/dungeon-loader.js).

## Where to look first

| Topic | Doc |
|---|---|
| User-facing API, config reference, examples, full preset tables | [README.md](README.md) |
| Hook encyclopedia, recipes, Mixpanel counting semantics | [HOOKS.md](HOOKS.md) |
| Per-version upgrade guides (1.3 → 1.5) | [docs/guides/](docs/guides/) |
| Per-dungeon verify scripts (20 dungeons, 107 hooks) | [verification/verticals/README.md](verification/verticals/README.md) |
| Full `Dungeon` interface | [types.d.ts](types.d.ts) |
| Changelog | [CHANGELOG.md](CHANGELOG.md) |

If a question is about the user-facing API, presets, hook recipes, or property type helpers — read those docs, not this one. CLAUDE.md is only the project-Claude contract.

## Repo layout

```
lib/
├── core/           # Context, config-validator, HookedArray storage, dungeon-loader
├── generators/     # event, funnel, profile, scd, adspend, mirror, text, product
├── orchestrators/  # user-loop (main loop), mixpanel-sender (import)
├── utils/          # utils (RNG, TimeSoup, streaming), logger, mixpanel, function-registry
├── hook-helpers/   # atoms (cohort/mutate/timing/inject/identity)
├── hook-patterns/  # high-level recipes (one per Mixpanel analysis)
├── verify/         # emulateBreakdown + verifyDungeon + Mixpanel-aligned counting primitives
└── templates/      # default data, phrase banks, AI instruction templates, macro/soup presets
scripts/                 # run-dungeon, dungeon-to-json, json-to-dungeon, run-many, verify-runner
dungeons/{vertical,technical,user}/
tests/{unit,integration,e2e,engine}/
verification/verticals/  # <name>.verify.mjs + <name>.sql per vertical dungeon
docs/guides/             # 1.3.0 → 1.5.0 upgrade guides
plans/                   # historical implementation plans (ENGINE-VALIDATION, DATAGEN, etc.)
```

## Commands

```bash
npm test                    # full Vitest suite
npm run typecheck           # tsc --noEmit
npm run dev                 # nodemon scratch.mjs
npm run prune               # clear ./data and ./tmp
```

Dungeon authoring + verification (shipped in the npm package):

```bash
node scripts/run-dungeon.mjs <path>              # run one dungeon
node scripts/run-many.mjs <dir> [--parallel N]   # run many concurrently
node scripts/verify-runner.mjs <path> [prefix]   # full-fidelity run for hook verification
node scripts/verify-stories.mjs <path> [--data-prefix P] [--in-memory] [--json]
                                                 # evaluate the dungeon's `stories` export: five-tier
                                                 # verdicts (NAILED/STRONG/WEAK/NONE/INVERSE) + hook
                                                 # coverage; disk mode reads verify-runner shards
node scripts/dungeon-to-json.mjs <path>          # JS → JSON
node scripts/json-to-dungeon.mjs <path>          # JSON → JS
node scripts/extract-dungeon-schema.mjs <path>   # extract schema
```

## Tests

Three vitest tiers + a direct-run engine tier. **Use `npx vitest run tests/<tier>` directly** — no npm script wrappers (keeps `package.json` slim).

| Tier | Criterion | Wall | Allowed | Forbidden |
|------|-----------|------|---------|-----------|
| `tests/unit/` | pure-function tests on helpers, validators, primitives | ~5s | function calls, in-memory fixtures | `DUNGEON_MASTER()`, file I/O |
| `tests/integration/` | one generation pass at small scale | ~50s | `DUNGEON_MASTER()` ≤300 users, in-memory output | `writeToDisk: true`, network, GCS |
| `tests/e2e/` | full pipeline — disk writes, file loads, GCS, multi-run | ~50s | all of the above | n/a |

```bash
npx vitest run tests/unit                          # ~5s
npx vitest run tests/integration
npx vitest run tests/e2e
npx vitest run tests/unit tests/integration        # fast inner loop (skip e2e)
npx vitest run tests/integration/features.test.js  # single file
npx vitest tests/unit                               # watch mode
```

**Always pipe vitest output through `tail -50`** (`... 2>&1 | tail -50`) — captures the summary without flooding the transcript. Don't rerun expensive suites just to re-read the summary.

`tests/e2e/sanity.test.js` is excluded by default (parked — hangs after Module Integration block; run isolated via `npx vitest run tests/e2e/sanity.test.js`).

### Engine tests (direct-run, NOT vitest)

`tests/engine/` houses scale regression tests. Invoke with `node` directly. Outputs land in `./tmp/` (gitignored).

```bash
node tests/engine/sweep-engine.mjs [--workers 4] [--tier short|normal|long|all]   # 194-combo strict-bar sweep on simplest.js
node tests/engine/sweep-bias.mjs                  # bornRecentBias × born% exploration
node tests/engine/test-bunchiness.mjs <path>      # last-14d / first-14d / spike chart
node tests/engine/test-nosedive.mjs <path>        # end-of-window nosedive check
node tests/engine/smoke-test-all.mjs              # tiny-scale generation across all dungeons (PASS/FAIL)
```

Engine tests are NOT shipped in the npm package and NOT run as part of `npm test`. The vitest gate at [tests/e2e/engine-shape-full-sweep.test.js](tests/e2e/engine-shape-full-sweep.test.js) wraps `sweep-engine.mjs` and runs only when `RUN_FULL_SWEEP=1` is set.

## Engine guarantees

Pure-engine output (no hooks) on `dungeons/technical/simplest.js` satisfies a strict per-macro shape bar across the documented safe ranges. Departures are CI failures. The 10-test canary at [tests/unit/engine-shape-canary.test.js](tests/unit/engine-shape-canary.test.js) runs on every commit (~5s); the full 194-combo sweep runs pre-release via `RUN_FULL_SWEEP=1`. Methodology + sweep evidence: [plans/ENGINE-VALIDATION/PLAN.md](plans/ENGINE-VALIDATION/PLAN.md), [plans/ENGINE-VALIDATION/FIX.md](plans/ENGINE-VALIDATION/FIX.md).

### Safe ranges

| Knob | Safe range | Validator behavior outside range |
|------|-----------|----------------------------------|
| `numDays` | `[14, 365]` | Warn below 14, no clamp |
| `percentUsersBornInDataset` | `[0, 100]` | Hard clamp to [0,100]. **Per-macro clamp** when both `macro` AND this field are explicit: flat→12, steady→12, growth→30, viral→55, decline→5 |
| `bornRecentBias` | `[-0.5, 0.5]` | User-explicit values clamped; compound: `born > 60 && bias > 0.4` clamps bias to 0.3. Macro presets exempt (viral=0.6 allowed). |
| `preExistingSpread` | `'uniform'` (default) or `'pinned'` | n/a |
| `avgEventsPerUserPerDay` | `[0.1, 50]` | Clamped to 50 above; `numEvents` recomputed |
| `avgActiveDaysPerUser` | `[1, numDays * 0.5]` | Clamped to `floor(numDays/2)` above. **Incompatible with `engagementDecay`** — see [HOOKS.md §2.5](HOOKS.md). |
| `macro` | `'flat' \| 'steady' \| 'growth' \| 'viral' \| 'decline'` (default `'flat'`) | Throws on unknown name |

The per-macro born% clamp is a **shape contract**: born above the cap breaks the macro's characteristic curve via cumulative-acquisition. To go higher, switch macros.

### The 6 strict-bar conditions

For the resolved combo's macro, ALL of:

1. `tail_ratio = mean(events_last_W) / mean(events_first_W)` ∈ macro's tail band, where `W = min(14, floor(numDays/2))`
2. `lastDay >= 0.7 * sameDowPrev` (0.6 in `avgActiveDaysPerUser` mode); same-DOW comparison cancels soup-DOW noise
3. `rightEdgeSpike = max(events_last_W) / median(events_window) < macro_spike_cap`
4. `min(events_last_7d) >= macro_l7c * mean(events_last_7d)` — no multi-day collapse
5. `futureEvents == 0` — no events past `FIXED_NOW`
6. `signupFloor`: every day in last 7 has `signup_count >= 0.05 * mean(daily signups)`. Bypassed when mean < 5/day or `macro === 'decline'`.

Per-macro bars (defined in `tests/engine/sweep-engine.mjs` `STRICT_BARS` and mirrored in `tests/unit/engine-shape-canary.test.js`):

| Macro   | tail band     | spike cap | l7c min |
|---------|---------------|-----------|---------|
| flat    | `[0.65, 1.6]` | 2.5       | 0.5     |
| steady  | `[0.65, 1.8]` | 2.5       | 0.5     |
| growth  | `[0.65, 2.5]` | 3.5       | 0.45    |
| viral   | `[0.5, 5.0]`  | 7.0       | 0.3     |
| decline | `[0.4, 2.0]`  | 3.0       | 0.3     |

v1.5.1 recalibration (TODO #10 follow-up): bars widened to absorb the cleaner per-user event distribution introduced by the `numEvents` overshoot fix (`chance.normal(dev=budget/3)` replaced the dice-roll era's heavy-tail-smoothed budget). Macros' intended shapes (flat cumulative-acquisition uptick, steady/growth born-late tail drop at low rate) now show through more visibly; bars reflect that envelope.

The harness pins `datasetEnd` to most-recent past Wednesday-EOD-UTC for full calendar-day determinism.

**Hooks can intentionally violate the strict bar.** Decline-with-churn (engagementDecay + churn cohorts) can produce `tail_ratio < 0.4`; viral hooks with persona-driven late-cohort lift can exceed the spike cap. Engine guarantees apply to no-hook configs only — hook authors should document intentional deviations in the dungeon's overview JSDoc.

## Identity model knobs

| Knob | Default | Behavior |
|------|---------|----------|
| `avgDevicePerUser` | 0 | 0 = no `device_id`; 1 = single sticky; >1 = per-user pool (normal-distributed, sd≈value/2, ≥1), sticky per session |
| `EventConfig.isAuthEvent` | false | Marks identity stitch step. In `isFirstFunnel` for born-in users: pre-auth steps stamped `device_id` only, post-auth `user_id` only. Engine stamps both ON the auth event. |
| `Funnel.attempts` | none | `{ min, max, conversionRate? }` — failed-prior-attempt count. Total passes = failedPriors + 1. Failed attempts truncate before first `isAuthEvent` step. |
| `EventConfig.isAttributionEvent` | false | When `hasCampaigns: true`, only flagged events get UTMs (~25%). Without flags, ~25% of all events get UTMs (legacy fallback). |
| `hasAnonIds` | false | @deprecated alias for `avgDevicePerUser: 1`. |

Every event gets `user_id` by default unless the per-step stamping mode is `device_only` (pre-auth funnel step) or the user is born-in-dataset and never reached the `isAuthEvent`. Hook meta on `funnel-pre`/`funnel-post`/`everything` carries the full identity context; see [types.d.ts](types.d.ts) JSDoc for `HookMetaFunnelPre` / `HookMetaFunnelPost` / `HookMetaEverything`.

## Hook authorship — rules Claude must respect

Full hook reference: [HOOKS.md](HOOKS.md). Per-user execution order: `user → scd-pre → funnel-pre → event → funnel-post → everything`. Storage-only hooks (`ad-spend`, `group`, `mirror`, `lookup`) fire when records push to a HookedArray.

The rules below are non-negotiable when authoring or modifying hooks:

1. **Schema-first.** Hooks do NOT add new properties. Every property in the final output must be defined in the dungeon config (`events` properties, `userProps`, `superProps`) with a default. Hooks modify existing values, filter events, and inject events cloned from existing ones. If a hook needs a boolean flag (e.g. `payday`), define it in the event's `properties` as `[false]` and let the hook flip it to `true`.
2. **Properties are FLAT on event records** — `record.amount`, NOT `record.properties.amount`.
3. **Injected events must be cloned** with spread (`{...existingEvent, time: newTime, user_id: uid}`). Never construct events from scratch.
4. Spliced events need `user_id` (not `distinct_id`) and a valid ISO `time` string.
5. Use `dayjs` for time operations; use the seeded `chance` instance for randomness.
6. **`event`/`user`/`scd` hooks fire ONCE** — storage skips re-running them to prevent double-fire mutations (`price *= 2` won't apply twice).
7. **`everything` is the only place to drop events.** Return a filtered array. Do NOT return `{}` from event hooks (creates broken events).
8. **Engine auto-sorts by time after `everything`** (default `autoSortAfterEverything: true`). Cloned events with arbitrary timestamps no longer need hand-sort calls.
9. **Validator auto-promotes funnel-step events to `isStrictEvent: true`.** Set `isStrictEvent: false` explicitly to opt out.
10. **Touchpoint cap = 10** (`maxTouchpointsPerUser` default). Engine stamps UTMs on up to N eligible events per user, sampled across lifetime. Attribution-biasing hooks should OVERWRITE engine-stamped values, not stamp fresh.
11. **Future-time guard is unconditional.** Events with `time > FIXED_NOW` are dropped before storage.

After creating or modifying a dungeon, run `/verify-dungeon` to validate schema integrity (catches flag stamping — undeclared columns) and verify that engineered hook patterns appear in the output. The verifier matches Mixpanel's exact counting semantics — read [HOOKS.md §2](HOOKS.md) before targeting any Mixpanel report.

## Skills pipeline

Schema → hooks → verify → provision, five slash commands at [.claude/skills/](.claude/skills/):

| Skill | What it does |
|-------|--------------|
| `/create-dungeon <description>` | SCHEMA ONLY — designs events, funnels, superProps, userProps, identity-model knobs (`isAuthEvent`, `attempts`, `avgDevicePerUser`). Does NOT write the `hook` function. Output: `dungeons/user/<name>/<name>.js` (one folder per customer). |
| `/write-hooks <dungeon-path> <story>` | Writes the `hook` function on an existing dungeon using atoms + patterns. Adds Mixpanel report instructions per pattern. Iterates with `/verify-dungeon` until patterns PASS. |
| `/verify-dungeon <dungeon-path>` | Schema integrity (flag stamping) + engineered hook pattern verification. Prefers the emulator (`emulateBreakdown`) for the supported analyses; falls back to DuckDB for bespoke shapes. Always asserts identity-model invariants (stitch count, pre-existing user stamping). |
| `/analyze-soup <dungeon-path>` | Run a dungeon and analyze its time distribution at week/day/hour granularities. |
| `/create-project <dungeon-path>` | Provisions a real Mixpanel project for an existing dungeon via the power-tools API (createProject + setTimezone UTC + mintServiceAccount + addGroupKey + setBusinessContext), then writes `credentials` back into the dungeon. Always creates fresh. Needs `BEARER_TOKEN` + `ORG_ID` in `.env`. Orchestrator: [.claude/skills/create-project/provision.mjs](.claude/skills/create-project/provision.mjs). |

Use the existing `scripts/verify-runner.mjs` — do not create a new runner.

## Critical gotchas

- **ESM only** (`"type": "module"` in `package.json`).
- **Time model:** events generate in a fixed historical window (`FIXED_NOW = 2024-02-02`), then shift forward to present via `.add(1, "day")`. `FIXED_BEGIN` computes dynamically from `numDays`. Test fixtures rely on this stability.
- **No global state** beyond `FIXED_NOW`/`FIXED_BEGIN` constants. All state flows through a `Context` object built per run.
- **Seeded RNG everywhere** via `chance` — same seed + same config + `concurrency: 1` = byte-identical output. `strictEventCount: true` forces `concurrency: 1`.
- **Hooks are a single function** on the dungeon config receiving `(record, type, meta)`. Type discriminates the record shape and metadata. See [HOOKS.md §1](HOOKS.md) for the full type table.
- **Progress callback** (`onProgress`): fault-tolerant, throttled (default 500ms), disabled after 3 throws. Three phases — `generation`, `import`, `step`. Return value includes `progress: { updates, errors, disabled }`.
- **Test count + wall time are not pinned.** `npm test` reports current numbers; treat any specific count in older docs as historical.

## TODO

### Performance: dayjs optimization (deferred)

Primary bottleneck is date/time manipulation. `TimeSoup` creates dayjs objects + `toISOString()` on every event. Fix: perform all time calculations using numeric Unix timestamps and only convert to ISO string once at the end. Key locations: `TimeSoup` in [lib/utils/utils.js](lib/utils/utils.js), timestamp handling in [lib/generators/events.js](lib/generators/events.js) and [lib/orchestrators/user-loop.js](lib/orchestrators/user-loop.js). Constraint: must preserve deterministic seeded generation within a bounded time range, then shift timestamps forward to present.
