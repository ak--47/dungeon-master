# Changelog

All notable changes to `@ak--47/dungeon-master`.

## Unreleased (1.6.0 branch)

### Added

- **Emulator: five new analysis types + retention completion**
  (`emulateBreakdown`, all ARB-cited):
  - `eventBreakdown` — Insights "Total" broken down by a property, with
    Mixpanel's exact segment coercion (list fan-out, `$empty_list`,
    `undefined` bucket, case-sensitive type-tagged segments, topN 250);
    `countType: 'unique' | 'sessions'`, `firstTimeOnly` compose.
  - `uniques` — per-interval independent dedup, rolling XAU windows,
    cumulative running distinct; `countType: 'sessions'`, `firstTimeOnly`.
  - `lifecycle` — Lifecycle Cohort Analysis board-template classification
    (new / retained / resurrected / dormant) on a value-moment event, 7- or
    30-day periods.
  - `topPaths` — Flows: next-anchor-only matching, forward/reverse capacity
    rings, per-level top-N pruning into `$mp_uncommon_flows_events`,
    `hiddenEvents` / `visibleEvents`, `countType: 'general' | 'unique' |
    'sessions'`.
  - `distinctCount` — distinct values of a property + top-N value counts.
  - `retention` completion — `compounded`, `birthCanRetain`,
    `carryForward` / `carryBack` / `consecutiveForward`, `calendarStart`,
    `cohortWindow`, `segmentOn: 'return'`, internal-event ignore list.
- **Funnel evaluator upgrades**: session-count conversion windows,
  `countMode: 'sessions'`, ARB-exact exclusion handling, any-order step
  blocks, step-0-anchored trends under `timeBucket`.
- **New verify primitives**: `sessionize()` (query-time sessions — 30-min
  gap / 24h max / UTC-day triggers, synthetic `$session_start`/`$session_end`),
  `filterFirstTimeEver()`, `evaluateFormula()` (ARB formula grammar),
  `extractFlows` / `aggregateFlows`, breakdown-key coercion
  (`lib/verify/coerce.js`), `frequencyHistogram`, null-aware avg/sum
  `{ flatten: true }`, `attributedBy` per-conversion output.
- **Hook atoms**: `hashCohort` (seed-stable cohort assignment),
  `applyLifecycleWave`, `applyPathBias`, `applySessionShape`; pattern
  `applyTTCBySegmentV2` (see Deprecated).
- **Story layer**: `stories` named export on dungeons — one machine-checkable
  story per hook (`DungeonStory` typedef,
  `lib/templates/story-spec.schema.json`) — and the
  `scripts/verify-stories.mjs` runner: mechanical five-tier verdicts
  (NAILED / STRONG / WEAK / NONE / INVERSE), population floors (`minCohort`),
  hook-coverage discipline, disk + in-memory modes, `--json`.
- **Verticals**: `dungeons/vertical/` restructured to one folder per vertical
  (`<name>/<name>.js` + `<name>.verify.mjs` + `<name>.sql`); `stories`
  exports and rebuilt hooks across all verticals; two new showcase dungeons —
  `streaming` (lifecycle) and `support-desk` (flows + sessions).
- **Skills**: `/write-hooks` authors the stories export; `/verify-dungeon`
  runs the story runner first and investigates only failures;
  `/create-dungeon` designs analysis-friendly vocabularies (session
  fan-out, value moment, hidden-event hygiene); `/analyze-soup` queries in
  UTC; `/create-project` builds business context from the stories export.
- **Docs**: HOOKS.md §2.12–2.17 (event breakdown coercion, uniques/XAU,
  formulas, first-time-ever, lifecycle, flows, sessions), recipes 4.29–4.31,
  atom/helper reference sections.

### Behavior changes

- **Retention option keys are strict** (P1.5). Unknown keys in a `retention`
  emulator config now throw instead of being silently ignored — a typo'd
  option previously ran with defaults and produced plausible-but-wrong
  numbers. `carry_forward` is kept as a deprecated alias for `carryForward`.
- **Funnel exclusions no longer fire before step 0** (P1.6.4).
  `evaluateFunnel`'s `exclusionSteps` previously defaulted `afterStep` to
  −Infinity, so an exclusion event could condemn an attempt before the first
  step was ever reached. ARB has no exclusion gaps before the first step: a
  pre-step-0 exclusion event now only matters inside the 2-second grace rule
  at step 0 (condemns with `excludedAtStep`), otherwise the attempt proceeds.
- **Non-sequential funnel orders verify with full ARB semantics** (P1.6.6).
  `first-fixed` / `last-fixed` / `first-and-last-fixed` / `outside-in` /
  `random` previously verified via set-membership ("fired all step events,
  any order", `verificationKind: 'partial'`); they now route through
  any-order step blocks with full conversion-window / 2-second-rule /
  exclusion / anchor-ordering semantics. Users that passed the loose check
  but violate window or anchor ordering no longer convert. `middle-fixed`
  keeps set-membership (its scrambled slots are non-contiguous).
- **`sessionMetrics` defaults to query-time derived sessions** (P1.7.2). New
  `source: 'derived' | 'stamped'` option, default `'derived'`: sessions are
  re-derived from raw timestamps via `sessionize()` — what Mixpanel actually
  computes — instead of reading the generator's pre-stamped `session_id`.
  The stamped path remains via `source: 'stamped'`, and the per-row
  `stampedDivergence` count audits the gap between the two.
- **`$experiment_started` is pinned to funnel-pass start** (P4.2 engine fix,
  pre-existing since 1.4.0). For experiment funnels with a non-`sequential`
  `order` (`last-fixed`, `random`, `first-fixed`, ...), `applyOrderingStrategy`
  shuffled the synthetic exposure event into the funnel body — the exposure
  landed mid-pass at a uniform position, so exposure→conversion TTC read ~58%
  of `timeToConvert`, and any exposure-anchored conversion measurement (the
  Mixpanel Experiments report, ordered-funnel pairing from
  `$experiment_started`) undercounted variant lift. The ordering strategy now
  shuffles only the real steps; `$experiment_started` stays at execution index
  0 (offset 0), and `first-fixed`/`first-and-last-fixed` pin the true first
  step instead of the exposure marker. Output changes (event order + RNG
  stream) for experiment funnels with shuffle orders; `sequential` experiment
  funnels are unaffected.
- **Session IDs are re-derived after the `everything` hook** (P2.1). The first
  `assignSessionIds` pass still runs before hooks (hooks may read
  `session_id`), but a second pass now relabels on the FINAL event set — after
  the `everything` hook, auto-sort, and the future-time guard. Time-mutating
  hooks (TTC scaling, injected bursts) previously left stale session ids that
  disagreed with what Mixpanel derives from timestamps at query time. Session
  ids hash from (user key + first event time of the session), so sessions
  whose events did not move keep their exact ids. The per-session sticky-device
  rewrite is NOT re-run — relabeling never mutates identity fields. Behavior
  change only for dungeons whose hooks mutate event times; their stamped
  `session_id` values now match query-time derivation
  (`stampedDivergence === 0`).
- **Churn is now a hard activity boundary** (P2.2). `isChurnEvent` broke the
  budget loop (stopping generation), but already-generated events carry
  independent timestamps — uniform TimeSoup draws on the legacy path, a
  shuffled active-day plan under `avgActiveDaysPerUser`/`retentionCurve` — so
  churned users kept events DATED after their churn event. Churned users'
  events are now truncated at the churn event's timestamp (the churn event
  itself survives). Affects only dungeons using `isChurnEvent`; users who
  return (`returnLikelihood` roll succeeds) are untouched. `simplest.js` has
  no churn events, so the engine-shape canary and sweep are unaffected.
- **Bin-based patterns bin by distinct days by default** (P2.4).
  `applyFrequencyByFrequency`, `applyFunnelFrequencyBreakdown`, and
  `applyAggregateByBin` gain `binBy: 'events' | 'distinctDays'` (default
  `'distinctDays'`, via `binByDistinctPeriods`). Mixpanel's frequency reports
  — and the local emulator — bucket users by distinct calendar days, so the
  old total-event-count axis could put a user in a different cohort than the
  report bucket their data lands in, diluting engineered signal. Pass
  `binBy: 'events'` to restore the pre-1.6 axis (also the right choice for
  `applyFunnelFrequencyBreakdown`'s funnelEvents fallback, where one funnel
  run rarely spans two days).
- **`applyAttributedBySource` rewritten to overwrite engine-stamped touches**
  (P2.4, HOOKS.md recipe 4.26 as code). New opts:
  `{ weights, property = 'utm_source', model = 'firstTouch'|'lastTouch'|'both' }`;
  returns `{ overwritten, touches }`. The old copy-source-to-conversion
  mechanism stamped fresh values, which under the v1.5 touchpoint cap land
  outside Mixpanel's lookback and never move the attribution report. The
  pattern now overwrites the value on the touch the chosen model reads and
  never adds the property to unstamped events.

### Changed

- **Shipped vertical dungeons: hook fixes that change generated output**
  (P4.2 rebuild — same seeds, different data where noted):
  - **media**: H10 applied the plan-tier factor to `watch_duration_min` in
    two separate blocks — the engineered free/premium ratio compounded to
    ~4.4x instead of the documented 2.09x. Single application now; the
    duplicate block is deleted (no RNG-stream impact).
  - **marketplace**: H9 funnel-post TTC scaling is restricted to the
    Browse-to-Purchase funnel (it previously scaled all five; Buyer
    Onboarding shares the search→view→cart prefix, so first-occurrence
    funnel evaluation assembled chains across unscaled instances and the
    engineered ratio never reached the report). H10 redesigned from a
    windowed message-cohort purchase-drop to a total-message-count cohort
    with property-only `offer_amount` effects.
  - **sass**: H9 TTC scaling moved from one stitched whole-history
    sequence (everything hook) to per-instance funnel-post gap scaling
    gated on the `alert triggered` funnel — the old single scaled sequence
    was diluted by the user's unscaled instances and never survived to the
    funnel report.
  - **crypto**: all hook day-boundary math converted from local-time dayjs
    to UTC (dataset timestamps are UTC; boundaries previously shifted by
    the host's UTC offset). H9 TTC scaling restricted to the onboarding
    funnel (same cross-instance dilution class as marketplace). H6 churn
    no longer erases a user's first 24 hours — the old absolute-day cutoff
    shredded late-born users' signup/onboarding/auth events under the
    growth macro.

### Deprecated

- **`applyTTCBySegment`** (P2.4) — the funnel-post variant scales one run's
  internal gaps, but Mixpanel's TTC measures the FIRST occurrence of each
  step per user, so the scaling only reaches the report for `isFirstFunnel`
  runs. Still functional; warns once. Use **`applyTTCBySegmentV2`** (new,
  `everything` hook) — finds the greedy first sequence via
  `findFirstSequence` and scales it with `scaleFunnelTTC`.
- **`Persona.churnRate`, `Persona.activeWindow`, `Persona.soupOverride`**
  (P2.5) — declared config surface that was never implemented: nothing in
  lib/ reads them after validation. Marked `@deprecated` in types.d.ts; the
  validator warns once per process when a dungeon sets any of them. Not
  removed (declared surface) and not implemented (config-shape freeze).

## 1.5.4 — 2026-06-04

Patch. Import-phase progress now reaches `onProgress` consumers.

### Changed

- **Bumped `mixpanel-import` to `^3.3.2`.** It now fires `progressCallback`
  independently of `verbose` / `showProgress`. Previously the import callbacks
  wired up in `mixpanel-sender.js` never fired in non-verbose runs because the
  importer only invoked them when its stdout progress bar was enabled.

### Fixed

- **Import progress reaches `onProgress`** (requires `mixpanel-import >= 3.3.2`).
  Every import call (events, user profiles, ad spend, group profiles, group
  events, SCD) already passed a `progressCallback`; with the dependency bump
  those now emit `{ phase: "import", recordType, processed, total, eps,
  bytesProcessed }` to the consumer's `onProgress` during the import phase.
  `showProgress: !!verbose` is unchanged — it still gates only the importer's
  stdout bar, so non-verbose runs stay quiet while the callback fires.

### Why

Consumers (e.g. DM4) already handle `update.phase === 'import'` to render an
import progress bar; the callbacks simply weren't firing. This is a dependency
bump plus a regression test — no DM API change. Consumers pick it up via their
normal upgrade flow with no code change.

## 1.5.3 — 2026-06-04

Adds two JSON/source interop helpers to the public API. No breaking changes —
existing exports and behavior are untouched.

### Added

- **`dungeonToJSON(input, options?)`** export. The inverse of `parseJSONDungeon`:
  turns a dungeon into the `{ schema, hooks, timestamp, version }` JSON/UI wrapper
  format. Accepts the same input flavors as the default export — a config object,
  a `.js`/`.mjs`/`.json` file path, a raw JS source string, or an array of file
  paths (returns an array). Output round-trips: `parseJSONDungeon(await
  dungeonToJSON(x))` yields a runnable config. Best effort — arrow functions and
  bound `chance.*` methods survive the round trip; detected utility calls
  (`weighArray`, `weighNumRange`, …) are serialized by name without their
  arguments and revive to `null` (handled gracefully by the validator). To keep
  the field's **type** even when the generator can't be revived, every function
  is sampled at serialization time (closures are still live) and its inferred
  output type is recorded as `dataType` on the serialized object (e.g.
  `{ functionName: "weighNumRange", args: [], dataType: "number" }`).
  **Credentials (`token`, `serviceAccount`, `serviceSecret`, `projectId`,
  `secret`) are stripped by default** so tokens never leak into JSON — pass
  `{ includeCredentials: true }` to keep them.
- **`DungeonJSON`, `DungeonComments`, and `SerializedFunction` types** in
  `types.d.ts` — the JSON-representation shapes are now formally specced.
- **`extractComments(input)`** export. Pulls the human-readable doc blocks out of
  a dungeon's **source** — the `// ── OVERVIEW ──` and `// ── HOOK STORIES ──`
  blocks plus every other `// ── LABEL ──` header that is immediately followed by
  a block comment. Returns `{ overview, hookStories, sections }` with the comment
  scaffolding (`// ──`, `/* */`, leading ` * `) stripped to readable prose.
  Operates on a file path or raw source string — it never imports the dungeon,
  since importing discards comments. Best effort: relies on the canonical
  header + block-comment convention emitted by the `create-dungeon` /
  `write-hooks` skills.

### Changed

- **`scripts/dungeon-to-json.mjs`** is now a thin CLI wrapper over the exported
  `dungeonToJSON` (passing `includeCredentials: true` to preserve its legacy
  full-config UI round-trip output). The inline `convertToJSON` /
  `convertFunctionToObject` logic moved into `lib/core/dungeon-to-json.js`.

### Why

The package could ingest JSON dungeons (`parseJSONDungeon`, `loadFromFile`,
`loadFromText`) but had no exported way to go the other direction, and no way to
programmatically read a dungeon's OVERVIEW / HOOK STORIES documentation. Both
existed only as un-importable script internals. Exporting them completes
best-effort JSON interop and lets tools (UIs, LLM pipelines) read dungeon docs
directly.

## 1.5.2 — 2026-05-21

Docs-only patch. Aligns the `.claude/skills/` authoring + verification
guides with the 1.5.1 engine + config API. No runtime changes.

### Changed

- **`create-dungeon` skill** now emits the canonical dungeon layout
  (IMPORTS / OVERVIEW / SCALE / DATA ARRAYS / CONFIG sections) and the
  sub-object config API (`credentials` / `switches` / `identity`).
  Removed the old `// ── TWEAK THESE ──` template + flat-key example.
- **`create-dungeon` skill** documents `hasAnonIds` as deprecated; nudges
  authors to write `identity.avgDevicePerUser: 1` directly.
- **`create-dungeon` skill** adds sections for `retentionCurve`,
  `userSeed`, anonymous-non-converter `_drop: true` semantics, and
  flags the touchpoint-sampling generator/verifier asymmetry.
- **`write-hooks` skill** documents the `meta.profile._drop` rescue
  pattern (the one engine-recognized flag a hook may set/clear on a
  profile). Expanded `meta` interface listing for the `everything` hook.
- **`verify-dungeon/references/counting-semantics.md`** notes known
  divergences from Mixpanel C++ (calendar vs rolling distinct-period
  default, COMPOUNDED retention not implemented, touchpoint sampling
  asymmetry, list-typed AVG/SUM no auto-flatten). All references to
  `hasAnonIds: true` updated to the new `identity.avgDevicePerUser` shape.
- **`verify-dungeon/references/sql-recipes.md`** drops `Platform` from
  the expected device-keys table (removed in 1.5.1; `os` covers the
  signal). Updates casing check to drop `Platform`-vs-`platform` rule.
  Adds an anonymous-non-converter `_drop` audit query as standard check
  #0 for identity-model dungeons. Updates "Advanced feature verification"
  to list only currently-supported features (`personas`, `worldEvents`,
  `engagementDecay`, `dataQuality`); calls out the deprecated config
  blocks (`subscription`, `attribution`, `geo`, `features`, `anomalies`)
  the validator silently strips.

### Why

Skills are how most dungeons get authored. Drifting between skill-emitted
output and 1.5.1 engine behavior would silently produce stale-shape
dungeons + missed coverage of new features (`retentionCurve`, `userSeed`,
`_drop` semantics, sub-object API). Patch keeps skill output and engine
behavior synchronized.

## 1.5.1 — 2026-05-20

Quality + ergonomics release. No new analytical capabilities — fixes accumulated rough edges around concurrency, accuracy, profiles, and config ergonomics that surfaced after 1.5.0 shipped. Adds a generator-side retention shaper, exposes a config sub-object API for cleaner dungeon files, and restructures all 48 shipped dungeons to a canonical layout. Top-level keys keep working for back-compat.

### Added

- **`credentials` / `switches` / `identity` config sub-objects.** New ergonomic shape for grouping related dungeon keys: `credentials: { token, region, serviceAccount, serviceSecret, projectId }`, `switches: { hasLocation, hasCampaigns, hasSessionIds, hasAvatar, isAnonymous, ... }`, `identity: { avgDevicePerUser, sessionTimeout }`. `mergeConfigSubObjects` hoists sub-object values into top-level keys at validation time; top-level still wins when both set (with a verbose warn). Old flat top-level keys keep working — back-compat suite in `tests/unit/config-restructure.test.js`.
- **`retentionCurve` config knob.** Generator-side retention shaper. Accepts an array of `{day, retention}` waypoints; the engine interpolates log-linearly to drop late events per user based on first-event age. Independent of `engagementDecay`. Enables analytical-style retention shapes (D1 80% → D7 50% → D30 20%) at dungeon-config level instead of via hooks.
- **Per-macro `avgActiveDaysPerUser` defaults.** When `avgActiveDaysPerUser` is unset, defaults derived per macro: steady=15, growth=10, viral=20, decline=5, flat=20 (numDays/4 cap). Removes the need to hand-tune for every macro.
- **`COUNT_DISTINCT` aggregation in `emulateBreakdown`** (`type: 'distinctCount'`). Mirrors Mixpanel's count-distinct measure for cohort sizing / unique-user breakdowns.
- **`userSeed` config knob.** Separate distinct_id seed from the main `seed`. Lets you regenerate a dataset with a different event distribution while keeping the user pool stable across runs — useful for incremental data layering.
- **`result.profilesPushed`** count exposed on the `Result` object. Reports how many profiles actually got pushed to `/engage` after `_drop` filtering.
- **`runWithDataset(begin, now, fn)`** API for explicit dataset-window scoping (rare — most callers don't need this; in-process `generate()` calls now auto-scope via AsyncLocalStorage).

### Changed

- **Anonymous non-converters get `_drop: true` stamped on their profile.** Real-world Mixpanel `$identify` semantics — profiles only exist for users who actually identified. Born-in-dataset users who never reach an `isAuthEvent` step in their first funnel are anonymous: events still flow (tied to `device_id`), but no profile is pushed to `/engage`. `userProfilesData` still contains every profile object; `mixpanel-sender` filters `_drop:true` before push. Pre-existing users are considered already-identified and never get `_drop`. The `everything` hook can rescue a profile by `delete meta.profile._drop`.
- **`numEvents` more accurate.** Removed dice rolls + `0.714` magic dampening from per-user budget computation; replaced with a clean `chance.normal(mean=budget, dev=budget/3)`. Old behavior overshot the target by 1.6-2x; new behavior matches the configured rate within ±3% across all 5 macros at 50K target. **If you previously tuned `avgEventsPerUserPerDay` around the old overshoot, expect ~40-60% fewer events at the same rate.** Recompute targets.
- **Default `Platform` device property removed.** 59 entries commented out in `lib/templates/defaults.js` (15 iOS + 15 Android + 29 Desktop). `os` already carries the platform signal. If a dungeon reads `Platform` in hooks or downstream, you'll see undefined — define `Platform` explicitly in your event properties to opt back in.
- **`hasAnonIds` deprecated.** Use `identity.avgDevicePerUser: 1` instead. The deprecated alias still works through 1.5.x: when `hasAnonIds: true` is set without an explicit `avgDevicePerUser`, the validator promotes to `avgDevicePerUser: 1`.
- **`DATASET_NOW` / `DATASET_BEGIN` scoped via AsyncLocalStorage.** No more module-level mutable globals. In-process concurrent `generate()` calls with different `datasetStart`/`datasetEnd` windows now produce isolated, in-window output. Legacy `setDatasetNow` / `setDatasetBegin` setters remain as back-compat shims.
- **UTC bare-date parsing** for `datasetStart` / `datasetEnd`. `"2026-01-01"` parses as `2026-01-01T00:00:00Z`, not as local-midnight (which shifted the window by UTC offset).
- **Quiet by default.** `verbose: false` (default) now gates all warnings, info logs, and dataset-context messages. Set `verbose: true` to opt back into the chatty output.
- **GCS upload retry hardening.** 10 retries with exponential backoff, 10-minute total budget. Handles transient cloud upload failures without giving up.
- **>64K user runs no longer crash V8.** Internal data structure swap (`Array` for sparse-keyed maps) eliminates V8 limit hit at high user counts.
- **All 48 shipped dungeons restructured to canonical layout.** Sections in fixed order: IMPORTS → OVERVIEW → HOOK STORIES → SCALE → KNOBS → DATA ARRAYS → HOOK STATE → HELPER FUNCTIONS → CONFIG. Hook stories preserve full per-hook Mixpanel report docs; `config.hook` becomes a thin dispatcher delegating to per-type helpers (`handleEventHooks`, `handleEverythingHooks`, etc.). Zero behavioral changes — every dungeon's seed-pinned output is unchanged.
- **All 49 dungeons + ~18 test fixtures migrated to the new sub-object API.** Cosmetic adoption only — `mergeConfigSubObjects` already supported both shapes since Phase 1.

### Fixed

- **Standalone events now stamp `config.superProps`.** Was silently `{}` before — masked by the validator's auto-funnel pre-fix in 1.5.0. Surfaced by the `numEvents` overshoot fix when the `useFunnel` gate started routing more users to the standalone path.
- **Born-late funnel auth events past `FIXED_NOW` no longer set `userAuthTimeMs`.** Engine drops the event at storage time (`funnels.js:640`) but previously still recorded the auth-time, marking the user as authed without a real sign_up event. Fix gates `authTimeMs` on `!_drop` (`funnels.js:328`). Affected 1-2% of users in test runs.
- **Pre-existing user events strict-clamp at `FIXED_BEGIN`.** Born-outside-window users no longer leak events into the pre-dataset window via TimeSoup's sub-window distribution.

### Docs

- **HOOKS.md targeted edits.** Recipe 4.25 (First-Touch Attribution Bias) gains a v1.5 note pointing to Recipe 4.26's OVERWRITE pattern when `hasCampaigns: true`. Atom catalog gains a footnote that `injectBetween` / `injectBurst` / `injectAfterEvent` / `injectOnNewDays` no longer require trailing `record.sort(...)` calls — covered by `autoSortAfterEverything: true` default since 1.5.0.
- **`docs/guides/1.5.1-upgrade-guide.md`** — TL;DR + per-change action items for existing dungeon authors.

### Infra

- 95+ commits across the branch; 1269 vitest tests pass; engine canary 10/10; engine-shape full sweep 194/194; smoke test 20/20 verticals; 5-vertical hook verifier matches Sprint 1 baseline (ecommerce 10/10, fitness 12/12, sass 10/10, social 11/11, dating 11/13 pre-existing small-mode artifacts).

## 1.5.0 — 2026-05-08

The "count and verify like Mixpanel does" release. Aligns BOTH the data generation engine AND the verifier with Mixpanel's actual counting semantics — greedy single-pass funnels, distinct-period frequency counting, null-aware aggregation, touchpoint-capped attribution, identity merge, retention, sessions, time-bucketed trends. Removes `bunchIntoSessions`, the root cause of funnel ordering corruption since 1.0.

### Generator changes

#### Added
- **`avgActiveDaysPerUser`** — Concentrates events onto fewer distinct UTC days per user. Uses weighted-without-replacement day picking from soup DOW weights. Events per active day scale naturally (`rate × remaining_days ÷ active_days`). Interacts correctly with `engagementDecay` (protects last event per picked day from being dropped).
- **`conversionWindowDays`** on funnels — Explicit conversion window (default 30, hard cap 180). Validator auto-bumps when `timeToConvert` exceeds the default. Funnel generator caps step-to-step time to the window. Verifier and `emulateBreakdown` apply the same window.
- **`maxTouchpointsPerUser`** — Per-user touchpoint cap (default 10) matching Mixpanel's `attributed_value_reader.cpp`. Engine samples eligible events across user lifetime using `chance.pickset`, stamps UTMs on the sample only. Replaces the old inline 25% UTM stamping in `events.js`.
- **`autoSortAfterEverything`** — Auto-sorts user events by time after the `everything` hook (default `true`). Defends greedy funnel verification from out-of-order hook-injected events. Opt out with `autoSortAfterEverything: false`.
- **`isStrictEvent` auto-promote** — Config validator detects events that appear in both `events[]` and `funnels[].sequence` and auto-promotes them to `isStrictEvent: true`. Prevents greedy engine corruption where standalone instances of funnel-step events confound conversion counting. Opt out per-event with `isStrictEvent: false`. Runs BEFORE catch-all funnel creation.
- **`Funnel.exclusionEvents: string[]`** — events that terminate the funnel for non-converters. Generator stamps 1-2 cloned events bearing one of the listed names between the last completed step and where the next step would have been. Schema-first: validator throws on undeclared entries; cloned events copy ONLY identity + super props + group keys + props declared on the exclusion event's own config (no source-event prop pollution).
- **`Funnel.reentry: boolean`** — verifier-only hint. Auto-applied by `verifyDungeon` to matching `funnelFrequency` / `timeToConvert` checks.
- **`Funnel.stepFilters: Record<number, { prop, op, value }>`** — verifier-only hint. The verifier attaches `where`-clauses at the matching step index.
- **Session day-boundary split** — `assignSessionIds` now ends a session at the UTC day boundary (matches Mixpanel `session_query.cpp:828-830, 911`). Three reset triggers: timeout gap > 30 min, max session > 24h, OR day-index change.
- **`weightedSampleNoReplacement`** — Seeded weighted sampling utility for active-day picking and touchpoint selection.

#### Changed
- **`bunchIntoSessions` removed.** Was a wholesale timestamp overwrite that scrambled funnel ordering and destroyed TimeSoup's time distribution. Replaced by natural TimeSoup-driven timestamps + `assignSessionIds` (which was already running but had its work overwritten by `bunchIntoSessions`). Events now arrive in correct temporal order without post-hoc rewriting.
- **Standalone events use `isFirstEvent: false`.** Previously all standalone events used `isFirstEvent: true`, pinning them to the same timestamp. The old `bunchIntoSessions` retimed them — now TimeSoup distributes them directly.
- **UTM stamping moved to per-user pass.** Inline per-event UTM stamping in `events.js` replaced by `applyTouchpointCap` in `user-loop.js`. Runs after all events are generated, samples up to `maxTouchpointsPerUser` eligible events. Matches Mixpanel's attribution counting behavior.
- **Funnel generator respects conversion window.** When a funnel's step-to-step span exceeds `conversionWindowDays`, the generator scales `relativeTimeMs` to fit.
- **`funnelFeatureCtx` preserves `latestTime`.** Bug fix: was dropping `featureCtx.latestTime`, causing funnel first events to use the full `[earliest, FIXED_NOW]` range instead of the picked day's bounds in active-day mode.
- **Empty event pool bail-out.** When all events are funnel steps (auto-promoted to strict) and there are no standalone events, the user loop skips standalone generation instead of crashing on `pick([])`.
- **Future-event filter now logs in verbose mode.** Events past `FIXED_NOW` (from catch-all funnel TTC drift) are filtered with a verbose log showing count, user, and time range.
- **`buildActiveDayPlan` returns `pickedDayBuckets`.** Shape changed from `number[] | null` to `{ plan, pickedDayBuckets } | null` so engagement decay can protect last events on active days.
- **User loop wrapped in try/finally.** SIGINT cleanup (progress interval, user count reset) runs even on error.

### Verifier changes

The "verify like Mixpanel does" half. Adds counting primitives behind `emulateBreakdown` so engineered hook patterns can be verified against the same shapes Mixpanel computes.

#### Added
- **Identity resolution** — `buildIdentityMap(profiles)` inverts each profile's `device_ids` / `anonymousIds` (legacy field name supported) into a flat `Map<device_id, canonical_user_id>`. `resolveUserId(event, identityMap)` resolves a single event with priority: `event.distinct_id` → identity map → `event.user_id` → `event.device_id` (Mixpanel canonical post-merge id wins). `emulateBreakdown` auto-builds the map when `profiles` are passed (any breakdown type, hoisted above `timeBucket` recursion to avoid rebuild per partition).
- **Funnel engine extensions** — `evaluateFunnel` accepts:
  - `reentry: boolean` — re-runs state machine after each completion; `result.completions` reports total.
  - `exclusionSteps: [{ event, afterStep?, beforeStep? }]` — events that terminate the current attempt. `afterStep`/`beforeStep` use the index of the step that must (have) been reached; defaults `afterStep=-Infinity`, `beforeStep=steps.length` (fires anywhere, used by simple `Funnel.exclusionEvents` shape). Cooperates with reentry.
  - Step filters — steps may be `{ event, where: { prop, op, value } }`. Supported ops: eq, neq, gt, lt, gte, lte, contains, not_contains.
  - `trackStepProperties: boolean | string[]` — captures matched event properties at each step into `result.stepProperties`.
  - `countMode: 'uniques' | 'totals'` — totals mode returns `FunnelResult[]` (Mixpanel `funnel_query.cpp:2055-2100`). Includes incomplete attempts so per-step drop-off counts are preserved (`history_get_reached >= 0`, NOT "completed"). Without reentry: single-attempt array.
  - `sessionScoped: boolean` — partition by `session_id`, run per session. Verifier-only convenience; Mixpanel's closest analog is `WINDOW_TYPE_SESSIONS` on the conversion window.
- **HPC** — `evaluateFunnelHPC(events, steps, holdProperty, options)` runs parallel sub-funnels per unique value of the held property on the step-0 event. Returns `Map<value, FunnelResult | FunnelResult[]>`. NOT auto-routed through `funnelFrequency` (different report shape); call directly inside `verifyDungeon` checks.
- **Segment modes** — `resolveFunnelSegment(result, 'first' | 'last' | { step: N })` picks property snapshot for FIRST_TOUCH / LAST_TOUCH / STEP modes.
- **`emulateBreakdown({ type: 'sessionMetrics' })`** — group by user→session, emit `[{ metric, avg, median, p90, total_sessions }]` for count / duration / eventsPerSession. Trusts pre-stamped `session_id`. Optional `event` filter restricts to sessions containing a target event (verifier-only convenience).
- **`emulateBreakdown({ type: 'retention' })`** — birth-anchored ms-delta bucketed retention (`retention_query.cpp:1227-1231`). A return 23h after birth lands in bucket 0; 25h lands in bucket 1. `birthCanRetain: false` default (`retention_query.cpp:1097-1109`). Inputs `cohortEvent`, `returnEvent`, `dayBuckets`. Optional `segmentBy` partitions cohort by birth event property (`segment_event=FIRST` mode); optional `carry_forward` marks once-retained users as retained on later buckets (CARRY_FORWARD unbounded mode).
- **`emulateBreakdown({ timeBucket: 'day' | 'week' | 'month' })`** — cross-cutting wrapper on every breakdown type. Partitions events by UTC bucket, tags rows with `period: string` (`YYYY-MM-DD`, `YYYY-Www`, `YYYY-MM`). Optional `timeBucketRange: { from, to }` enumerates every bucket and emits `{ period, _empty: true }` markers for empty intervals (Mixpanel `normal_query.cpp:352-356` parity).
- **`aggregatePerUser` cohort-level rollup** — `cohort_sum` / `cohort_min` / `cohort_max` field added when the per-user `agg` is `sum`/`count`/`min`/`max`. `avg_aggregate` always populated. Matches Mixpanel's "Aggregate per user" report column for the corresponding agg mode.
- **`partitionByTimeBucket(events, bucket, options?)`** — exposed helper. Accepts `{ from, to }` for empty-bucket enumeration.
- **`evaluateAnyOrderCompletion`** — Verifier function for `unordered`/`random` funnel modes. `emulateBreakdown` auto-dispatches based on `funnel.order`.

#### Changed
- **Identity resolver order** — `event.distinct_id` now wins over the merge map (Mixpanel canonical post-merge id; never demote).
- **Sessions split on UTC day** — `session_query.cpp:828-830` parity (added to `assignSessionIds` AND `sessionMetrics`).

### Documented divergences (intentional v1.5.0 scope gaps)

- **HPC list-property values** — scalar only; Mixpanel `aggregate_hash_get_key_cursor` explodes list values into N sub-funnels per event.
- **`sessionScoped` funnel** + **`sessionMetrics({ event })`** — verifier-only conveniences; not directly reproducible in Mixpanel UI.
- **Retention COMPOUNDED, CARRY_BACK, CONSECUTIVE_FORWARD, CALENDAR_START, segment_event=SECOND, cohort window, week/month bucket units** — out of v1.5.0 scope.
- **Timezone** — verifier uses UTC; Mixpanel uses query timezone (qtz).
- **Percentiles** — linear interpolation (d3.quantile); Mixpanel uses TDigest.
- **Selector grammar** — eq/neq/gt/lt/gte/lte/contains/not_contains only; no is_set/between/regex/contains_ci.

### Backward Compatibility

- **No breaking changes to the public API.** `DUNGEON_MASTER(config)` signature unchanged. All named exports unchanged.
- Existing dungeons run without modification. New config fields are additive and optional.
- `bunchIntoSessions` removal changes timestamp distribution for all dungeons. Events now follow TimeSoup's natural distribution instead of being rewritten into synthetic session clusters. This is more correct — funnels maintain temporal ordering.
- `isStrictEvent` auto-promote may reduce standalone event variety for dungeons where funnel-step events overlap with `events[]`. Add `isStrictEvent: false` on specific events to preserve standalone instances.
- Touchpoint cap (default 10) reduces UTM-stamped events from ~25% of all events to at most 10 per user. Attribution analysis produces more realistic distributions.
- UTC day-boundary session split may produce more sessions per user than 1.4 (sessions crossing midnight now split). Session metrics shift accordingly.

### Documentation

- **`research/1.5.0-upgrade-guide.md`** — consumer upgrade guide with behavioral changes, new verifier capabilities, identity-aware verification requirement.
- **CLAUDE.md** updated with `avgActiveDaysPerUser`, `conversionWindowDays`, `maxTouchpointsPerUser`, `autoSortAfterEverything`, active-day distribution section, 15-step execution order.
- **HOOKS.md** — §2.4 touchpoint generation contract, §2.5 active-day distribution, §2.6–2.10 (sessions, retention, reentry, HPC, segment modes), §8 v1.5.0 verification recipes (8 patterns).
- **Skill files** updated: `create-dungeon`, `write-hooks`, `verify-dungeon` with v1.5 considerations + new primitive table.

### Engine validation + strict clamps (post-eval ship gate)

Final 1.5.0 hardening pass — proves the engine produces clean, in-band charts across the param space and adds validator guards against the worst foot-guns. Methodology + sweep evidence: `plans/ENGINE-VALIDATION/FIX.md`.

#### Engine

- **`FUNNEL_DEAD_ZONE_CAP_SEC = 0`** (`lib/orchestrators/user-loop.js`). Earlier rounds reserved a 1-day "dead zone" before `FIXED_NOW` for funnel step-1 anchors to defend against a cursor-accumulation bug. Round 1 fixed the cursor accumulation directly, leaving the cap as defense-in-depth. The future-time guard at storage step 14 already drops any `time > FIXED_NOW`, so removing the cap is safe — funnels can now anchor right up to `FN`. Eliminates the last-day cliff for funnel-heavy dungeons. Verified across 194-combo sweep: `futureEvents == 0` everywhere.

#### Validator strict clamps (`lib/core/config-validator.js`)

Seven clamps with `console.warn` messages explaining what changed and why. All fire either unconditionally (sanity bounds) or only when the user explicitly overrides via top-level field OR `macro: { preset, ... }` object override (raw preset names exempt — preset values are designed to be safe).

| # | Clamp | Trigger | Action |
|---|-------|---------|--------|
| 1 | `percentUsersBornInDataset` ∈ [0, 100] | Always | Clamp + warn |
| 2 | Per-macro born cap (flat=12, steady=12, growth=30, viral=55, decline=5) | User-explicit `macro` AND user-explicit `percentUsersBornInDataset` | Clamp + warn |
| 3 | `bornRecentBias` ∈ [-0.5, 0.5] | User-explicit (incl. macro-object override) | Clamp + warn |
| 4 | Compound: `born > 60 && bias > 0.4` → bias=0.3 | User-explicit (either) | Clamp + warn |
| 5 | `bornRecentBias` ∈ [-1, 1] (`Math.pow` guard) | Always | Clamp |
| 6 | `avgEventsPerUserPerDay` > 50 → 50 | Always | Clamp + warn (recompute `numEvents`) |
| 7 | `avgActiveDaysPerUser` > `numDays * 0.5` → `floor(numDays * 0.5)` | Always | Clamp + warn |

Plus a warning-only check for `numDays < 14` (window may be pinned via `datasetStart`/`datasetEnd` upstream).

#### Sweep harness (`scripts/sweep-engine.mjs`)

Validates `dungeons/technical/simplest.js` (no-hook baseline) across a 194-combo cross-product matrix of macro × numDays × born × rate × activeDays. Per-macro strict bars match each preset's design intent (flat is stationary, viral is hockey-stick). Pinned to most-recent past Wednesday-EOD-UTC anchor for full calendar-day determinism — back-to-back runs produce zero metric drift. **194 / 194 PASS.**

`tests/unit/engine-shape-canary.test.js` — 10-test ~5s canary (runs every commit) with fixed-date pinning (`datasetEnd = '2026-04-30T23:59:59Z'`).

`tests/e2e/engine-shape-full-sweep.test.js` — gated by `RUN_FULL_SWEEP=1`, runs the full 194-combo matrix (~5.5 min). Pre-release acceptance gate.

#### Hook compatibility

Spot-checked 5 verticals post-fix: **56 / 56 hook checks PASS** (fitness 12, dating 13, ecommerce 10, sass 10, social 11). Hook magnitudes match prior eval within ±10%. Engine fix is hook-compatible at full fidelity. None of the 20 vertical dungeons set `percentUsersBornInDataset` / `bornRecentBias` / `avgEventsPerUserPerDay > 50` explicitly → validator clamps don't fire on existing dungeons.

#### Documentation

- **CLAUDE.md** — new "Tuning guidance — safe ranges and engine guarantees (v1.5)" section under "Trend Shape — Macro and Soup". Per-tunable safe-range table, 6 strict-bar conditions, per-macro bar values, known-engine-guarantees subsection.
- **types.d.ts** — JSDoc `safe range` + clamp behavior on `numDays`, `percentUsersBornInDataset`, `bornRecentBias`, `avgEventsPerUserPerDay`, `avgActiveDaysPerUser`.
- **`.claude/skills/create-dungeon/SKILL.md`** — macro × born% compatibility note + clamp warnings.
- **`.claude/skills/write-hooks/SKILL.md`** — "intentional strict-bar deviation" pattern (decline + churn cohorts and viral-with-persona-lift can intentionally exceed bars).

### Test Suite

Full suite: **46 files, 1100+ tests** (was 960 in 1.4). Engine-validation pass adds 12 (10 canary + 2 clamp + 4 macro-object form, minus updates) → **1122 passed / 2 skipped**. Highlights:

| File | Tests | Coverage |
|------|-------|----------|
| Generator: `active-days`, `conversion-window`, `order-mode-dispatch`, `touchpoint-cap`, `strict-event-autopromote`, `auto-sort`, `interrupt-funnel`, `datagen-determinism`, `decay-respects-active-days` | 41 | Engine changes |
| `tests/unit/identity-resolution.test.js` | 14 | Map inversion, resolver fallback chain |
| `tests/unit/funnel-engine.test.js` (extended) | 51 | Reentry, exclusion, HPC, step filters, step properties, segment modes, sessionScoped — 5+ ported fixtures from `test_qt_funnel.py` |
| `tests/unit/session-metrics.test.js` | 11 | count/duration/eventsPerSession + day-boundary + ported `test_qt_sessions.py` fixture |
| `tests/unit/retention.test.js` | 9 | ms-delta bucketing + birthCanRetain + carry_forward + segmentBy + ported `test_qt_retention.py` fixture |
| `tests/unit/time-bucketed.test.js` | 11 | day/week/month + cross-cutting + empty backfill |
| `tests/integration/identity-model.test.js` (extended) | +1 | `emulateBreakdown` profile-merge round-trip |
| `tests/integration/hook-patterns-emulator.test.js` (extended) | +7 | Funnel options + new breakdown types + cohort SUM/MAX |
| `tests/integration/features.test.js` (extended) | +4 | exclusionEvents validator + injection + schema-clean clone |

## 1.4.5 — 2026-05-06

### Added

- **Progress callback.** Callers can pass `onProgress: (update) => void` on the dungeon config to receive throttled updates during generation, import, and pipeline step transitions. Update frequency is configurable via `progressInterval` (default 500ms). The callback is fault-tolerant — bad functions are caught and disabled after 3 failures, never breaking the job. Return value includes a `progress` summary with update count, error count, and disabled flag.
- **Mixpanel import progress.** When `onProgress` is set and a Mixpanel token is provided, import progress from `mixpanel-import`'s `progressCallback` is surfaced through the same `onProgress` interface as `{ phase: "import" }` updates.
- **Full TypeScript typings** for `ProgressUpdate` (discriminated union), `ProgressSummary`, `ProgressGeneration`, `ProgressImport`, and `ProgressStep`.

## 1.4.4 — 2026-05-06

The "GCS imports actually work now" release.

### Fixed

- **GCS-sourced imports hung indefinitely.** `streamJSON`, `streamCSV`, and `streamParquet` used `createWriteStream({ gzip: true })` for all GCS writes, setting `Content-Encoding: gzip` on objects. The HTTP transport auto-decompressed on some environments but not others (Cloud Run). When it didn't, raw gzip bytes reached parsers, stream errors didn't propagate through `.pipe()` chains, and the pipeline promise never resolved. Fix: GCS writes no longer use `Content-Encoding: gzip`. Gzip is handled at the application level (pipe through `zlib.createGzip()`), same as local writes.
- **Group profiles silently skipped in batch mode.** After flush, `groupEntity.length === 0` triggered an early `continue` even when batch files existed on GCS. Events/users/ad-spend had `isBATCH_MODE` fallbacks — groups didn't.
- **GCS gzip finish-event timing.** Promise resolved on gzip transform's `finish` (compression done) instead of GCS stream's `finish` (upload complete), potentially producing truncated files.
- **Group events batch mode fallback** (latent). Added `isBATCH_MODE` guard for future use.

### Changed

- **GCS default format is now JSONL.** When `writeToDisk` is a `gs://` path and no `format` is specified, the default is `"json"` instead of `"csv"`. Explicit `format` settings are unaffected.
- **HOOKS.md shipped in npm package.** The hook encyclopedia (24 recipes, 20 principles, atom/pattern reference) is now included in the published package.

### Added

- **GCS round-trip tests.** Three e2e tests that write to GCS and read back through `mixpanel-import`'s stream parser: default JSONL, gzipped JSONL, and full dungeon (events + users + groups + SCDs + ad spend). Verifies actual record counts, not just file existence.

### Documentation

- **`research/1.4.4-upgrade-guide.md`** — full details on the GCS fix, migration notes, and root cause analysis.

## 1.4.3 — 2026-05-05

### Changed

- **`percentUsersBornInDataset` defaults raised.** The "flat" macro preset (default) changed from 15% to 50%. All other presets raised proportionally (floor 25%). Retention/onboarding hooks now have much larger cohorts for cleaner signal.
- **Skill rename:** `verify-hooks` → `verify-dungeon`. Reflects broader scope (schema + hooks + identity + experiments).
- **Test directory cleanup.** Removed benchmark scripts, intellisense test files, and legacy test helpers. Flattened hook helper/pattern test file names.

### Added

- **HOOKS.md recipe 3.22** — Retention Magic Number pattern ("N actions in first X days predicts retention"), drawn from the Twitter dungeon iteration.
- **Schema validation** (`lib/verify/schema-validator.js`). Catches hooks that introduce undeclared columns. Integrated into `verifyDungeon()`.
- **Property type helpers:** `dateRange()`, `listOf()`, `objectList()` — complete coverage of all 7 Mixpanel property data types.
- **Twitter/X dungeon** (`dungeons/user/twitter.js`) — consumer social platform with 4 verified hooks.

### Documentation

- **`research/1.4.3-upgrade-guide.md`** — macro preset migration, retention hook calibration lessons, schema validation API.

## 1.4.2 — 2026-05-04

### Changed

- **All 20 vertical dungeons verified STRONG or NAILED.** 200 hooks across 20 verticals evaluated and fixed via the verify-dungeon pipeline.

### Fixed

- Various hook bugs across `dating`, `social`, `travel`, `community`, `logistics`, `media`, `fintech`, `food-delivery`, `education`, `real-estate`, `devtools`, and `marketplace` dungeons surfaced by `/verify-dungeon`.
- Vertical dungeon property defaults, temporal hook ordering, and cohort threshold calibration.

## 1.4.1 — 2026-05-04

### Added

- **File path tracking (`getWrittenFiles()`).** HookedArray containers track exact file paths written during a run. Replaces fragile `ls()` + string-filter directory scans. Works for local and `gs://` paths.
- **`cleanup: true` config option.** Deletes all written files at end of run (local and GCS). Runs in `finally` block.
- **Cloud Run / serverless OOM guide** in upgrade guide — `batchSize` + `writeToDisk: 'gs://'` + `concurrency: 1` pattern for low peak memory.

### Fixed

- **SCD multi-batch import.** Sender used `.pop()` when discovering SCD batch files — only the last batch was imported. All batch files now imported.
- **Warnings gated behind `verbose: true`.** Config validator and storage layer warnings no longer fire unconditionally.

### Documentation

- **`research/1.4.1-upgrade-guide.md`** — file tracking API, cleanup option, Cloud Run deployment guide.

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
