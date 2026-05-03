# Changelog

All notable changes to `@ak--47/dungeon-master`.

## 1.4.0 — 2026-05-03

The "identity model + hook verification" release. Users get multi-device identity, declarative experiments, and a complete hook authoring pipeline with verification. All 20 vertical dungeons upgraded and verified.

### Added

- **Identity model.** Three additive knobs for realistic user/device identity:
  - `avgDevicePerUser: N` — per-user device pool sized by normal distribution; sessions are sticky to a device drawn from the pool.
  - `EventConfig.isAuthEvent: true` — marks the sign-up/login event as the identity stitch point. Pre-auth funnel steps get `device_id` only; the stitch event gets both; post-auth gets `user_id` only.
  - `Funnel.attempts: { min, max, conversionRate? }` — failed-prior-attempt retries before final conversion. Failed attempts truncate before `isAuthEvent`.
  - `EventConfig.isAttributionEvent: true` — opt-in UTM stamping on specific events (replaces blanket 25% of all events).
- **Declarative experiments.** `Funnel.experiment: { name, variants, startDaysBeforeEnd }` on any funnel. Engine handles variant assignment (deterministic hash), `$experiment_started` events, and conversion/TTC multipliers. Hooks read `meta.experiment` for variant-specific downstream effects.
- **Hook helpers** (`@ak--47/dungeon-master/hook-helpers`). 14 composable atoms across 5 modules: cohort binning, event mutation, timing manipulation, event injection, and identity partitioning. Full JSDoc on each atom.
- **Hook patterns** (`@ak--47/dungeon-master/hook-patterns`). 5 high-level recipes mapping 1:1 to Mixpanel analysis types: frequency-by-frequency, funnel-frequency breakdown, aggregate-by-bin, TTC-by-segment, attributed-by-source.
- **Verification pipeline** (`@ak--47/dungeon-master/verify`). `emulateBreakdown` re-derives Mixpanel breakdown tables from raw events. `verifyDungeon` runs CI-style assertions with NAILED/STRONG/WEAK/NONE/INVERSE scoring.
- **`HOOKS.md` encyclopedia.** 23 production-proven hook recipes with code, Mixpanel report instructions, and adaptation notes. 14 core principles. Phase 3/4 atom and pattern reference tables.
- **`EmulateOptions` type.** Previously referenced but undefined in `types.d.ts`. Now fully typed with per-analysis-type field documentation.
- **Skills pipeline.** `/create-dungeon` (schema only) → `/write-hooks` (engineer patterns) → `/verify-hooks` (DuckDB verification with 5-tier scoring). Each skill is self-contained with reference examples.

### Changed

- **Legacy 42% per-event `user_id` dice removed.** Every event now gets `user_id` by default (unless in a pre-auth funnel step). More correct for Mixpanel identity.
- **`isStrictEvent` events excluded from standalone generation.** They appear only in explicitly-defined funnels — cleaner data for events like "application approved" that shouldn't exist outside funnel context.
- **`insert_id` uses `crypto.randomUUID()`.** Eliminates hash collisions. Non-deterministic but irrelevant for analytics.
- **Funnel-pre hooks have final authority.** Persona and world-event modifiers apply before the hook — hooks can override everything.
- **Experiment variant assignment is deterministic per user** (hash-based, not random per funnel run).
- **All 20 vertical dungeons upgraded to version 2.** Identity model adopted, dates standardized (120-day window), temporal hooks migrated to `everything`, deprecated features replaced in hooks, all hooks verified STRONG or NAILED.
- **`types.d.ts` expanded.** JSDoc warnings on `HookMetaEvent` (temporal unreliability), hook ordering note on `HookMetaEverything`, `numDays` 3-mode resolution docs, `isStrictEvent` clarification.

### Removed (silently ignored)

- `subscription`, `attribution`, `geo`, `features`, `anomalies` config keys. Engine strips them with one deprecation warning per dungeon and continues. Recreate these patterns via hooks — see `HOOKS.md` recipes 3.22 (deprecated feature replacement) and the `write-hooks` skill.

### Key Learnings from 20-Dungeon Eval

These patterns are documented in `HOOKS.md` principles 7-14 and the skill REV 10 sections:

1. **Temporal hooks belong in `everything`, not `event`.** The event hook's `meta.datasetStart`/`meta.datasetEnd` are in a different time frame than `record.time`. Move any day-in-dataset check to `everything`.
2. **Temporal mutations run AFTER all cloning.** If Hook A clones events into a time window and Hook B mutates events in that window, B must run after A or clones miss the mutation.
3. **Cohort detection must survive downstream filtering.** If a churn hook removes the marker events used to detect a cohort, require 3+ markers instead of 1+ so survivors still identify the group.
4. **Deprecated feature replacement.** Add equivalent property assignments in `user`/`everything` hooks and `superProps`/`userProps`. See recipe 3.22.
5. **Unseeded Chance breaks determinism.** Replace `new Chance()` with `initChance(SEED)`.

### Documentation

- **`research/FINALIZE-REPORT.md`** — full eval report: 19 dungeons, 191 hooks, all STRONG/NAILED.
- **`research/1.4.0-upgrade-guide.md`** — migration checklist and hook-writing guide.
- **`HOOKS.md`** — 23 recipes, 14 principles, atom/pattern reference.
- **`.claude/skills/verify-hooks/SKILL.md`** — REV 10: clone dilution, cohort filtering, deprecated features, dynamic date window derivation.
- **`.claude/skills/write-hooks/SKILL.md`** — REV 10: hook ordering within `everything`, deprecated feature replacement, cohort sizing guidelines.

### Backward Compatibility

- **No breaking changes to the public API.** `DUNGEON_MASTER(config)` signature unchanged. All named exports unchanged.
- Existing dungeons run without modification. New features are opt-in.
- Dungeons that relied on the legacy 42% `user_id` dice will see more consistent identity (every event gets `user_id`). This is more correct for Mixpanel.
- `numDays`-only configs continue to work (window anchors to today). Pin `datasetStart`+`datasetEnd` for deterministic runs.

## 1.3.0 — 2026-04-28

The "no more end-of-dataset blowup" release. Rewrote how per-user event budgets and big-picture trends are decided so the default chart looks flat with a weekly cycle, instead of meteoric ramp + cliff in the final ~14 days.

### Added

- **`avgEventsPerUserPerDay` (canonical event-volume primitive).** Per-user event budgets now scale with each user's active days (`rate × user_active_days`), so users born late in the dataset don't compress their entire event budget into a tiny window. `numEvents` still works as a fallback target — see [`research/1.3.0-upgrade-guide.md`](research/1.3.0-upgrade-guide.md).
- **`macro` preset system.** Big-picture trend across the whole window. Default: `"flat"`. Other presets: `"steady"`, `"growth"`, `"viral"`, `"decline"`. Accepts a string, `{ preset, ...overrides }`, or a fully custom object.
- **`preExistingSpread` config field.** `"uniform"` (default in `flat`) spreads pre-existing users' first event time across `[FIXED_BEGIN-30d, FIXED_BEGIN]`. `"pinned"` (legacy, used by `growth`/`viral`) stacks them all at `FIXED_BEGIN`.
- **Future-event guard.** End of `lib/orchestrators/user-loop.js` drops any event whose timestamp landed past `MAX_TIME` after the everything hook runs. Mixpanel rejects future-dated events; this catches hook-injected duplicates that overflow.
- **Public type aliases.** `Soup`, `Macro`, `ResolvedMacro`, plus per-hook-type meta interfaces (`HookMetaEvent`, `HookMetaUser`, `HookMetaEverything`, etc.) for users who want to narrow inside their hooks.
- **Validator hardening.** Rejects `numUsers <= 0` and explicit `numDays <= 0`; clamps `bornRecentBias` to `[-1, 1]`; coerces non-finite `bornRecentBias` to `0`.
- **`engines.node: ">=18.0.0"`** declared in `package.json`.
- **`tests/macro-and-rate.test.js`** and **`tests/integration-1.3.0.test.js`** — 34 new tests covering the rate primitive, macro resolution, validator guards, future-event guard, per-user budget, and `preExistingSpread`.

### Changed

- **Default trend is now `flat`.** Previously the implicit trend (via the `growth` soup preset) used `bornRecentBias: 0.3` and `percentUsersBornInDataset: 15`. New default produces a level chart with weekly oscillation. To recover the old shape, set `macro: "growth"`.
- **Soup presets are now intra-week / intra-day only.** `bornRecentBias` and `percentUsersBornInDataset` were removed from soup presets and live on `macro` instead. Soup preset names are unchanged.
- **`dungeons/vertical/questforge.js` → `dungeons/vertical/gaming.js`.** File names follow the vertical convention; the product/app name lives inside file comments.
- **Auto-batch ordering bug fixed.** The `numEvents >= 2_000_000` auto-batch check in `config-validator.js` now runs AFTER rate→numEvents resolution, so dungeons that set only `avgEventsPerUserPerDay` correctly trigger batch mode.
- **Validator no longer mutates the caller's config.** Macro-resolved values (`bornRecentBias`, `percentUsersBornInDataset`, `preExistingSpread`) are stored in local vars and added to the output, instead of being written back onto the input object.
- **All 36 dungeons migrated** via `scripts/experiments/migrate-dungeons.mjs` to use `avgEventsPerUserPerDay`. Hook bugs surfaced by `/verify-hooks` (13 failures) fixed across `dating`, `social`, `travel`, `community`, `logistics`, `media`, `fintech`, `food-delivery`, `education`, `real-estate`, `devtools`, and `marketplace`.
- **npm publish surface trimmed.** `dungeons/user/` and `scripts/experiments/` excluded from the published package.

### Documentation

- **`research/1.3.0-upgrade-guide.md`** — full upgrade guide for AI agents, including hook-writing learnings from the verify-hooks pass.
- **`research/end-bunchiness.md`** — full diagnosis, experiment data, before/after numbers.
- **`research/hook-results.md`** — consolidated PASS/WEAK/FAIL report for ~160 hooks across 20 vertical dungeons.
- **`CLAUDE.md`** and **`.claude/skills/create-dungeon/SKILL.md`** updated with the new two-tier preset API and hook-writing rules.

### Backward compatibility

- Dungeons that set only `numEvents` continue to work — the per-day rate is derived. They render with the new `flat` macro defaults; add `macro: "growth"` to restore the old growth-bias.
- Dungeons that set `bornRecentBias` / `percentUsersBornInDataset` directly continue to work — those values override the macro preset.
- Soup preset names are unchanged. Hook semantics are unchanged. Output file naming is unchanged.
- `numEvents` is **not deprecated** — it remains the right primitive for fixed total-volume targets.
