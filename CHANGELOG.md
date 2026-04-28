# Changelog

All notable changes to `@ak--47/dungeon-master`.

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
