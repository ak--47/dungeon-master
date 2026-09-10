# Changelog

All notable changes to `@ak--47/dungeon-master`.

## 1.8.0 — 2026-09-09

### Added — `standaloneEvents`: identity-less metric snapshots

A new top-level config key that generates records describing a **system, not a
person**. They carry no `user_id` and no `device_id`. Before 1.8.0 the only
identity-less stream the engine could produce was `$ad_spend` via `hasAdSpend`,
which is hard-coded to one shape, one cadence, and a Mixpanel reserved event
name. `standaloneEvents` is the general form.

```js
standaloneEvents: [{
  event: 'cdn_egress',
  cadence: 'day',                                       // 'hour' | 'day' | 'week', default 'day'
  dimensions: { region: ['us-east', 'us-west', 'eu'] }, // cross-producted
  distinctIdFrom: 'region',                             // synthetic id, never a person
  properties: {
    gb_out:   (ctx) => 400 + ctx.tickIndex * 3,
    cost_usd: (ctx) => (400 + ctx.tickIndex * 3) * 0.085,
    p95_ms:   [120, 140, 160],
  },
}]
```

- One record per cadence tick per dimension cross-product row.
- Ticks start at the dataset start and step by the cadence. The last tick is the
  final one at or before the dataset end, so nothing lands in the future.
- Each record carries `event`, `time`, `insert_id`, `distinct_id`, every
  dimension as a flat property, and every resolved entry in `properties`.
- `distinct_id` is the value of the dimension named by `distinctIdFrom`, else the
  event name. It exists so Mixpanel accepts the record; it never maps to a person.
- Property value functions receive a `StandaloneValueContext`:
  `{ time, config, dimensions, tickIndex, tickCount, cadence, event }`.
  `tickIndex / (tickCount - 1)` is window progress — use it to shape a trend.
- New hook type `"standalone"` (storage-only, return value ignored, mutate in
  place). `meta.spec` carries the stream's resolved config.
- Lands in `result.standaloneEventData`, writes to a `-STANDALONE` file shard,
  and imports to Mixpanel as its own event stream.
- Validation **throws** on a malformed entry rather than skipping it. A silent
  skip would drop a whole data stream without the author noticing.

New types: `StandaloneEventConfig`, `ResolvedStandaloneEventConfig`,
`StandaloneValueContext`, `HookMetaStandalone`. `WritePaths` gains
`standaloneFiles`; `Result` gains `standaloneEventData`; `hookTypes` gains
`"standalone"`.

**Output compatibility.** Additive only. A config without `standaloneEvents` is
byte-identical to 1.7.0 — the generation pass is gated on the key being present,
so the seeded RNG stream is untouched. `config.standaloneEvents` normalizes to
`[]` when absent. Full unit + integration suite: 1920 passed, 1 skipped, 0 failed.
`tsc --noEmit` clean.

New tests: `tests/unit/standalone-events.test.js` (25),
`tests/integration/standalone-events.test.js` (15).

### Added — `warehouseMetrics`: manifest-driven warehouse source tables

A new top-level config key that materializes warehouse-ready tables from the
run's own events after generation completes. This is the local source-table side
of a warehouse metric demo: bookings rollups, active subscription levels, ARR
snapshots, and other time-series tables that should read like a real warehouse.

```js
warehouseMetrics: [{
  name: 'daily_new_bookings',
  source: { event: 'new_booking', measure: 'sum', property: 'booking_value' },
  valueColumn: 'bookings',
}]
```

- Supports additive and point-in-time metrics.
- Grain: `day`, `week`, `month`.
- Supports subtractive `minus` legs, `groupBy` on up to two declared keys,
  optional `history` backfill, sparse point-in-time emission, seeded `noise`,
  `scale`, and derived `columns`.
- Lands in `result.warehouseMetricData` keyed by metric name and emits
  `result.warehouseManifest` with table schemas, SQL, and recommended
  aggregation.
- Writes `<name>-WAREHOUSE-<table>.csv|json` plus
  `<name>-WAREHOUSE-MANIFEST.json` when `writeToDisk` is enabled.
- Never imports through `token`. Warehouse deploy is a separate flow.
- New hook type `warehouse` fires once per materialized row with
  `metricName`, `bucketIndex`, `bucketCount`, `grain`, `seriesKey`,
  `isBackfill`, and `raw` bucket stats.
- Warehouse verification adds `warehouse` / `warehouse-stats` story breakdowns
  plus automatic audits over gaps, monotonic time, empty numeric cells, sparse
  first-bucket coverage, and source-shape correlation.

### Added — `/deploy-warehouse`: BigQuery load + warehouse metric save flow

The shipped skill at `.claude/skills/deploy-warehouse/` loads the generated
warehouse tables into BigQuery, connects that dataset to Mixpanel with the
existing powertools macro, previews each metric SQL, and saves new metrics when
the CRUD endpoints are available.

- Uses the emitted warehouse manifest as the contract.
- Maps manifest `recommendedAggregation: 'last value'` to the API's
  `aggregation: 'last_value'`.
- If `GET /crud/getWarehouseMetrics` returns 404, the script still completes the
  BigQuery load and source setup, then writes `warehouse/GAPS.md` for manual
  metric creation.
- Preview fails fast on the raw substring block (`CREATE`, `UPDATE`, etc.), so
  identifiers like `created_at` and `updated_at` are a real deploy-time trap.

### Changed — `streamCSV` preserves falsy cells

CSV serialization now writes `0` and `false` as literal cell values instead of
empty strings. If downstream warehouse SQL or fixtures were treating blank cells
as zero or false, update them to read the actual value.

## 1.7.0 — 2026-09-03

The engine round for DM4 v5. Executes the 1.6.4 "Deferred to 1.7.0" table plus
the five round-two items (`dm-engine-round-two.md`) and the three round-one items
that table missed (P0-3, P1-5, P1-6). Every behavior change below carries the
number that proved the gap and the number after the fix, both from real
generation passes (400 users × 60 days unless stated; scripts in the session
scratchpad, assertions pinned in `tests/integration/v170-engine-requests.test.js`).

**Output compatibility.** Same seed, same config, `concurrency: 1`, pinned window:
1.7.0 and 1.6.5 produce byte-identical **events** (modulo `insert_id`) on every
technical fixture that does not set `hasLocation` — `simplest`, `datagen-v15-verify`,
`experiments`, `group-analytics`, `mirror-strategies`, `ad-spend`, `anonymous-users`
(the funnel-step time pin below still runs TimeSoup, so the RNG stream is
unchanged). Profiles and groups are identical where the fixture is deterministic
(`datagen-v15-verify`, `ad-spend`, `anonymous-users`); `simplest`, `experiments`,
`group-analytics` and `scd` build some profile/group props from their own unseeded
`new Chance()` and were never run-to-run stable. Three changes alter output on
purpose, each gated on a feature you would know you are using — see **Behavior
changes** (B1–B3). The 10-test engine-shape canary passes; `smoke-test-all` runs
22/22 shipped dungeons clean. The full 194-combo strict-bar sweep
(`RUN_FULL_SWEEP=1`, 2026-09-04, window pinned to Wednesday 2026-09-02) passes
191/194. The 3 failures are one config three times — `growth/365d/r1.2` with
born `-`/`30`/`100`, which the growth cap resolves to the same 30 — failing the
last-day bar at ratio 0.66 vs 0.70. Running the same `long` tier on 1.6.5 (`main`)
produces the identical 3 failures with identical numbers, so this is a
pre-existing, calendar-window-dependent marginal dip on one 365-day config, not a
1.7.0 regression. Tracked as a follow-up; not a release blocker.

**For DM4: tripwires that now flip.** `tests/integration/v5-engine.test.js` pins
several of the old behaviors; when these assertions fail on 1.7.0 that is the fix
landing, and the workaround it guards can go:
- the spike hook for The Moment (`volumeMultiplier` amplifies — P0-3)
- the flat-only born-share restriction (`macro: { bornRecentBias, percentUsersBornInDataset }` with no `preset` is uncapped — R2-1)
- the 19-country `SINGLE_COUNTRY_NAMES` enum in `tests/v5-render.test.js` (`singleCountry: 'US'` works; a miss throws — R2-2)
- the `importResults.users.success` overwrite (the receipt reconciles — R2-5)
- the repeated-value weighting idiom (`{ __weights }` — P2-1)
- the "fewer than two non-funnel events" refusal on Persona Difference — its premise was wrong; see P1-5 below

### Tier 1 — silent lies fixed

- **R2-1 `MacroConfig` object overrides.** Measured before: `macro: { preset: 'flat',
  percentUsersBornInDataset: 50 }` → 10.3% born; `macro: { percentUsersBornInDataset: 50 }`
  (no preset) → 10.0%; only the top-level key with no `macro` at all gave 52.3%.
  Cause: the born% cap keyed the preset-less object to `flat` (12) and the warning was
  `verbose`-gated. Now: a NAMED preset (string or `{ preset }`) is a shape contract and
  still clamps — 12.3% after, with the clamp in `result.warnings`
  (`{ key: 'percentUsersBornInDataset', requested: 50, applied: 12 }`); an object
  WITHOUT `preset` is a custom macro and is honored as written — 55.0% after for
  `{ percentUsersBornInDataset: 50 }`, 48.8% for `{ bornRecentBias: 0.3, percentUsersBornInDataset: 50 }`.
  Canonical spelling: `macro: { preset, ...overrides }`; the top-level keys are a legacy
  alias that wins over the object. Documented in README, `MacroConfig` JSDoc, CLAUDE.md.
- **R2-2 `singleCountry`.** Accepts the ISO code or the full name, case-insensitive
  (`resolveSingleCountry`, also hoisted from `switches`). A value matching no country
  THROWS with the list of valid values. Measured before: `'US'` and `'Narnia'` both
  silently deleted every geo property from events and profiles; after: `'US'` → 100%
  `country_code: US` on events and profiles.
- **R2-3 `strictEventCount` is exact.** Before: stopped on the GENERATED count (drops
  included) and never topped up — 4,987 of 5,000 with ~4x headroom (DM4 measured 4,705
  on its config). Now: the bailout reads the STORED count; a per-user budget controller
  scales the remaining users' budgets by (events still needed ÷ expected remaining
  delivery at the realized yield), clamped to [0.25, 4], aiming slightly high; the
  final user's stream is trimmed with a seeded uniform sample so the count never
  exceeds the target. Measured: 5,000 of 5,000; 30,000 of 30,000; test pins 3,000 of
  3,000. When capacity cannot reach the target (e.g. a churn event ends every user
  early) the run stops short and `result.warnings` carries
  `{ key: 'numEvents', requested, applied }`. User creation still stops once the target
  is met (legacy). Only under the flag — the default path is untouched.
- **R2-5 profile receipt.** `importResults.users` now carries `generated` (profiles the
  engine pushed to storage, bots included) and `dropped_anonymous` (`_drop`-flagged
  anonymous non-converters never sent to `/engage`) alongside mixpanel-import's
  `success` / `failed`, so `generated - dropped_anonymous - failed === success` is
  checkable. Counters tick at push time, so they hold in batch mode. The sender logs
  a line when the receipt does not reconcile. DM4's "100 generated, 45 reported" is
  now decidable from the result object.

### Tier 2 — the deferred 1.7.0 feature set

- **P0-1 `funnels[].conditions`: operators, validation, docs, tests.** Operator maps
  `eq`, `neq`, `in`, `nin`, `gt`, `gte`, `lt`, `lte` (AND within a key, AND across keys;
  no `or`); the scalar shorthand is unchanged. Matching moved to
  `lib/utils/conditions.js` (re-exported from user-loop). The validator THROWS on
  shapes that silently never matched — function values, bare arrays (points at
  `{ in: [...] }`), unknown operators, `in`/`nin` without an array — and warns into
  `result.warnings` when a condition key is declared nowhere the profile is built from.
  Users who satisfy none of the author's funnels (the engine catch-all excluded) are
  counted and reported once per run (`key: 'funnels.conditions'`). Measured: iOS 80.2%
  vs Android 39.8% purchased-per-viewed on the duplicate-funnel idiom; `{ gte: 10 }` 89.7%
  vs `{ lt: 10 }` 20.0%. README "segmented funnels", typed `FunnelConditions`, 30 unit
  cases + integration coverage of the filter branch that had none.
- **P0-2 experiment variant on the profile.** Every exposed user carries
  `"Experiment: <name>": "<variant>"`, stamped lazily at first exposure (so
  `startDaysBeforeEnd` is respected and never-exposed users carry nothing), before the
  `everything` hook. `experiment.stampProfile` (default `true`) opts out; `sticky: false`
  implies off. Not stamped on step events (would be undeclared columns). Measured: 0
  mismatches against `Variant name` on 13,005 exposure events.
- **P1-1 `(ctx) => value`.** `choose(value, ctx)` passes
  `{ profile?, event?, time?, config }` to every property function. Zero-arity functions
  are untouched; a function that declares a parameter is context-aware and skips the
  source-string cache (which would otherwise freeze its first result). Bound natives
  (`chance.animal.bind(chance)`) are still called with no argument. Funnel steps after
  the first now know their final time before properties resolve (`fixedTimeMs`, fed by
  a synchronous side channel from step 0) — TimeSoup still runs so the RNG stream is
  unchanged; context-aware step properties defer from `buildFunnelEvents` into
  `makeEvent`. `json-evaluator` emits `(ctx) => body` for expression bodies and passes
  whole-function bodies through unwrapped. Measured: 203 of 203 `pro` users got
  `revenue: 100` from `(ctx) => ctx.profile.plan === 'pro' ? 100 : 0`; 0 events without
  profile context.
- **P1-2 `stickyEventProps` + stable location (B2).** `stickyEventProps: ['plan_tier']`
  copies the profile value onto every event after `superProps`, before the `event`
  hook; keys declared only in `superProps` resolve once per user. Schema-first: undeclared
  keys throw; `lib/verify/schema-validator.js` treats sticky keys as legal on every event.
  Measured: 67,355 of 67,355 events matched the profile. **B2:** with `hasLocation: true`
  a user's events now share the user's location — `featureCtx.userLocation` was computed
  and never read; measured 0.8% of events matched their profile city before, 100% after.
- **P1-3 `personas[].ttcModifier`.** Multiplies `timeToConvert` after the experiment
  `ttcMultiplier`, before `funnel-pre`. Measured median TTC 0.50h vs 1.96h for 0.25 vs 1.
  **B3:** `churnRate`, `activeWindow`, `soupOverride` removed from the `Persona` type
  (never implemented); the validator still accepts and warns on them, and no longer
  defaults `churnRate`.
- **P1-4 `campaignPerUser`.** One campaign template per user at birth; UTMs stamped on
  the profile and reused on every touchpoint. Profile UTM keys already present (persona
  `properties`, `user` hook) win over the draw, so a persona can own a channel. Measured:
  0 of 399 users with more than one `utm_source` (400 of 400 before). Ad spend derived
  from acquisitions is deferred to 1.8.0.
- **P2-1 `{ __weights }` + `autoPowerLaw`.** `{ __weights: { free: 60, pro: 30,
  enterprise: 10 } }` draws exactly those shares (measured 239/123/38 over 400 users);
  `autoPowerLaw: false` turns the implicit 45/25/15 draw off for the run (module flag set
  per run, reset with the value caches). Both round-trip through `dungeon-to-json`.
- **P2-2 `result.warnings[]`.** Always present. Validator clamps (`percentUsersBornInDataset`,
  `bornRecentBias`, compound bias, `avgEventsPerUserPerDay`, `avgActiveDaysPerUser`,
  `numDays < 14`, `engagementDecay` + active days, auto-set `conversionWindowDays`) plus
  runtime aggregates via `context.addWarning` (one entry per key with `count`). Console
  output stays `verbose`-gated. `EngineWarning` type.
- **P2-4 `conversionRate` saturation.** Every engine clamp of a modified rate above 100
  — experiment variant, persona, world event, or whatever a `funnel-pre` hook left behind
  — is reported once per funnel and source
  (`funnels[Buy].conversionRate:persona "whale" conversionModifier`, requested 195,
  applied 100). The engine cannot see a hook's own `Math.min(95, rate * 3)`; HOOKS.md
  says so.

### Tier 3 — open items outside the deferred table

- **P0-3 `worldEvents[].volumeMultiplier > 1` amplifies.** New per-user pass
  `amplifyWorldEvents` clones affected in-window events — `floor(m − 1)` copies plus one
  with probability `frac(m)` — each with a fresh `insert_id` and a timestamp spread
  uniformly across the window (never past the dataset end), after the churn cut and
  before decay and hooks. Measured 3x on a 4-day window: **1.08x before, 3.06x after**,
  all `insert_id`s unique, clones on every window day; 1.5x lands in [1.3, 1.7].
  `aftermath.volumeMultiplier` follows the same rule. Validation rejects negative or
  non-finite multipliers.
- **P1-5 `eventMultiplier` and funnels — the premise was wrong.** The multiplier scales
  the whole per-user budget, which drives funnel passes too: measured **3.19x / 2.96x**
  for an asked 3x with every event a funnel step. DM4's 0.96x came from its fixture's
  `isChurnEvent` (`Churned`, weight 1, `returnLikelihood: 0.15`): a churn event in the
  standalone pool ends every user after roughly the same number of events regardless of
  budget — measured **1.04x with the churn event, 2.90x without**, same config. The
  engine now reports it (`key: 'personas.eventMultiplier'`) when more than half the
  users churn while a persona multiplier is in play; `eventMultiplier` and `isChurnEvent`
  docs state the cap. DM4 should replace its "fewer than two non-funnel events" check
  with a churn-event check.
- **P1-6 day-1 retention floor — documented (option 2).** `retentionCurve` picks session
  days; retention counts events; birth-day funnels spill into day 1 regardless of the
  day plan, so day 1 sits near 0.85 (DM4 measured 0.885 for an asked 0.15; days 7 and 30
  follow the curve). Stated in the `retentionCurve` JSDoc, README config table, and
  HOOKS.md §2.7. Verify from day 7 on.

### Behavior changes (not purely additive)

- **B1** — `conditions` values that are functions or bare arrays now THROW at validation.
  Any dungeon relying on them was already producing an empty funnel.
- **B2** — `hasLocation: true` now yields one stable location per user on events instead
  of a fresh random city per event. Event geo distributions change; `scd.js` (the one
  technical fixture with `hasLocation`) is the reference.
- **B3** — `churnRate`, `activeWindow`, `soupOverride` are gone from the `Persona` type.
  Runtime still accepts them with the existing once-per-process warning.
- World-event windows on funnel steps after the first now test the step's FINAL time
  (previously the pre-offset TimeSoup time). Only dungeons combining `worldEvents` with
  multi-step funnels see different `_drop` / `injectProps` decisions; the fix is what the
  docs always described.

### Not built (by request)

Session replay, per-funnel `soup`, `or` conditions, anything in `stories` / `verify` /
`emulateBreakdown`, and ad spend derived from acquisitions (P1-4 item 3, 1.8.0). R2-4
(the verticals as DM4 templates) is deferred to its own sprint per AK: each vertical
should demonstrate a different declarative trend type so the template gallery doubles
as a catalog demo; the R2-4 audit stands as that sprint's punch list.

## 1.6.5 — 2026-09-02

### Changed

- **`matchMixpanelDefaults: true` on every live send to Mixpanel.** Set in
  `commonOpts` in `lib/orchestrators/mixpanel-sender.js`, passed straight through
  to `mixpanel-import`. Renames warehouse-style property keys to Mixpanel's
  reserved names (e.g. `current_url` → `$current_url`, `_browser` → `$browser`)
  as records stream out. Only affects the wire payload sent to Mixpanel's
  ingestion API — generated events, profiles, and files on disk are unchanged.
  Same seed, same config still produces byte-identical generated output.

## 1.6.4 — 2026-09-01

Answers the doc/type half of the DM4 v5 engine request
(`dungeon-master-library-changes-requested.md`, 2026-09-01). Every claim in that
document was checked against source; all were accurate except the three noted
under "Already correct" below.

This release is deliberately scoped to changes that cannot alter generated data:
docs, types, one additive helper option, one additive config form, and one
warning. The feature requests are tracked for 1.7.0 — see "Deferred to 1.7.0".

No generated output changes. Verified: same seed, same config, `concurrency: 1`,
pinned dataset window — 1.6.4 and 1.6.3 produce byte-identical events, user
profiles, and group profiles.

### Added

- **`scaleEventCount(events, name, factor, { spreadDays })`.** Scatters clones
  uniformly across the next N days instead of stepping 1 second at a time. The
  default 1-second spread cannot create a new distinct active day and cannot open
  a new session under Mixpanel's 30-minute gap rule, so a default call moves event
  volume and nothing else — not active days, DAU, stickiness, sessions, frequency
  bins, or retention. 33 dungeons in the DM4 corpus used the default and then
  documented an active-day, session, frequency, or stickiness claim. All 33 were
  wrong. The limitation is now stated in the helper's JSDoc, in HOOKS.md §2.1, and
  in HOOKS.md gotcha #22. Clones that land past `FIXED_NOW` are still dropped by
  the future-time guard. Default behavior is unchanged.
- **Named-object form for `groupKeys`.** `{ key, cardinality, events? }` alongside
  the positional tuple `[key, cardinality]` / `[key, cardinality, events]`. Both
  forms may be mixed in one array. The validator normalizes to tuples, so hooks,
  the generators, and the verifier still see exactly one shape. Added so a
  form-driven config generator never has to emit an untyped positional tuple.
  Bad input throws with the offending index.
- **HOOKS.md §2.1.1 — "Cloned events MUST carry a fresh `insert_id`."** The
  consequence was only in a source comment before. Four DM4 corpus files
  hand-rolled `JSON.parse(JSON.stringify(e))` and had their entire engineered
  surge deduped away by Mixpanel at ingest, with local verification still
  reporting the surge as present. Includes the note that data generated this way
  on 1.6.2 or earlier is wrong in-project and must be regenerated.
- **README "one config surface, not two."** States that the `credentials` /
  `switches` / `identity` sub-objects are the canonical form, that the flat
  top-level keys are a back-compat alias, and that top-level wins when both are
  set. Mirrored in CLAUDE.md and in the three sub-object JSDoc blocks.

### Changed

- **The `avgActiveDaysPerUser` + `engagementDecay` warning is no longer gated
  behind `verbose`.** The combination silently returns an active-day count at or
  below the configured value, never above. A config UI that shows the requested
  number was lying about it. Documented in HOOKS.md §2.5 and in the
  `avgActiveDaysPerUser` JSDoc.
- **`retentionCurve` precedence is now documented.** When both `retentionCurve`
  and `avgActiveDaysPerUser` are set, the curve wins and `avgActiveDaysPerUser` is
  ignored entirely. Behavior is unchanged — only the docs were missing. Added to
  the CLAUDE.md safe-range table, the README config table, HOOKS.md §2.5, and the
  `avgActiveDaysPerUser` JSDoc.

### Fixed (types and docs)

- **`writeToDisk` doc was wrong.** It read "If true (default), writes output files
  to ./data/". The runtime default is `false` (`config-validator.js`).
- **`region` types disagreed.** Top-level `region` was `"US" | "EU"` while
  `DungeonCredentials.region` allowed `"IN"`. Both now use a shared `Region` type
  of `'US' | 'EU' | 'IN'`, which matches what `mixpanel-import` accepts.
- **`hasAttributionFlags` was presented as a settable switch.** The validator
  unconditionally overwrites it with `events.some(e => e.isAttributionEvent)`. It
  is removed from `DungeonSwitches` and from the `switches` hoisting allowlist,
  and marked `@internal` on `Dungeon`. Read it off `result.validatedConfig`;
  setting it never did anything.
- **`GroupEventConfig` / `config.groupEvents` removed from the public types.** A
  declared-only stub — nothing in `lib/` ever read it, its own doc comment said
  "not yet implemented", and no shipped dungeon set it. Removed from `types.d.ts`,
  `lib/templates/abbreviated.d.ts`, `lib/templates/schema.d.ts`, and the `wrapFunc`
  whitelist. To scope an event to a group, list it in that group key's `events`
  array.

- **The determinism claim was overstated.** README and CLAUDE.md both said "same
  seed + same config + `concurrency: 1` = byte-identical output". That has been
  false since 1.4.0: `insert_id` is a `randomUUID()`, so it differs on every run
  by design — which is what keeps Mixpanel from deduping a re-import of the same
  dataset. Found while verifying that this release changes no output. Everything
  else is byte-identical; strip `insert_id` before diffing two runs. Both docs now
  say so.

### Already correct (no change needed)

- `funnels[].reentry` and `funnels[].stepFilters` were reported as reading like
  generation features. Their JSDoc already says "Verifier-only hint … Generator
  behavior unchanged."
- The dead persona fields (`churnRate`, `activeWindow`, `soupOverride`) were
  reported as `verbose`-gated. Their warning already fires unconditionally, once
  per process. They stay accepted and warned; removing them from the `Persona`
  type is a 1.7.0 change because it is a type-level break.

### Deferred to 1.7.0

Everything below is new public surface or a behavior change, so none of it belongs
in a patch. Per-item design lives in the maintainer's local `plans/1.7.0/SPEC.md`
(the `plans/` tree is not published).

| Request | Why not in 1.6.4 |
|---|---|
| `funnels[].conditions` operators (`in`, `gte`, `neq`, …) | New public surface. Also throws on function/array condition values, which is a break. |
| Experiment variant stamped on the user profile | New profile property; needs a change to when variants resolve. |
| `(ctx) => value` for property value functions | New signature. Requires an arity guard on the `choose` source-string cache first, or context-aware functions get frozen at their first evaluation. |
| `stickyEventProps` | New surface. Also needs `lib/verify/schema-validator.js` taught about it, or `/verify-dungeon` reports every sticky prop as flag stamping. |
| Stable per-user `location` under `hasLocation` | A real fix (`featureCtx.userLocation` is computed and never read), but it changes generated event geo. |
| `personas[].ttcModifier` | New surface. |
| Removing the three dead persona fields from the `Persona` type | Type-level break. |
| `campaignPerUser` | New surface. |
| `autoPowerLaw: false` and `{ __weights }` | New surface. |
| `result.warnings[]` for clamps | New result surface. |
| Ad spend derived from users acquired per campaign | Needs a new cross-user aggregate pass. Deferred past 1.7.0. |
| Engine-side `conversionRate` saturation reporting | Depends on `result.warnings[]`. Note: the engine can report its own `Math.min(100, …)` clamps, but not a hook's own `Math.min(95, rate * 3)` — that cap belongs to the hook and the engine never sees the intended value. |

## 1.6.3 — 2026-08-17

### Fixed

- **Cloned events no longer get deduplicated away by Mixpanel on ingest.** All
  eight clone-producing helpers now give each clone a fresh `insert_id`:
  `cloneEvent`, `scaleEventCount`, `injectAfterEvent`, `injectBetween`,
  `injectBurst`, `injectOnNewDays`, `applyLifecycleWave`, and `applyPathBias`.
  Four of them (`cloneEvent` and the three `injectAfterEvent`/`injectBetween`/
  `injectBurst`) copied the template's id verbatim, so clones arrived as
  byte-identical twins and Mixpanel deduped them server-side. The others deleted
  the id, which is no safer: `mixpanel-import` runs with `fixData: true` and
  synthesizes a missing id by content-hashing the record, so identical clones
  collide into one anyway. Measured on an 8K-user dungeon: 608,081 events
  generated, 598,555 landed. The loss fell entirely on the two events the hooks
  clone, and an engineered 4x comment surge read as **1.17x** in the project while
  local story verification still reported 4.14x — verification never inspects
  `insert_id`. After the fix, all 608,081 ids are distinct and in-project counts
  match sent counts exactly. Affects any dungeon whose hooks clone or inject
  events. New shared helpers `stampFreshInsertId` / `cloneWithFreshId` in
  `lib/hook-helpers/_internal.js`; every clone site honors an explicit
  `insert_id` override uniformly. Swept by `tests/unit/clone-insert-id.test.js`,
  which covers every clone site rather than the one that happened to break.
- **The engine now guarantees unique `insert_id` across each user's final event
  stream.** Fixing the clone helpers was not sufficient: hooks are documented to
  inject events by spreading an existing one, and a spread copies `insert_id`
  too — so any hand-rolled clone reintroduced the bug. Several shipped dungeons
  (including `dungeons/technical/simple.js` and most of `dungeons/vertical/`) do
  exactly that, and measured 160 duplicate ids in a 3,254-event sample. The user
  loop now re-stamps any duplicate or missing `insert_id` after the `everything`
  hook, alongside the existing auto-sort and future-time guards. A legitimate
  stream never carries two events with the same id, so any collision at that
  point is a clone. Pinned by `tests/integration/insert-id-uniqueness.test.js`.
  CLAUDE.md's hook rule now points at `cloneEvent` while documenting that a bare
  spread remains safe.
- **`mixpanel-import` 3.5.1 → 3.6.1**, which fixes an undercount in the reported
  user-profile success total (3.5.1 reported 196 profiles sent for a batch of
  6,049 that had in fact all landed).
- **`create-project` no longer reports a successful group-key add as a failure.**
  The summary read `added [(none)] skipped [(none)]` even when the key was created
  and ready, because the response's `added`/`skipped` arrays are not always
  populated. It now reports against `all_group_keys`, the authoritative post-state,
  and warns when a declared key is genuinely absent.

### Added

- **`/headless-build` skill** — final step of the pipeline (after `/create-project`).
  Builds a demoable Mixpanel environment with `mixpanel_headless`: dashboards whose
  narrative text is computed live from the project, Lexicon enrichment, saved
  cohorts, custom properties, behaviors/metrics/formulas, and annotations — then
  re-measures every hook story against the live project and fails on a miss.
- **`powertools` skill: entity-CRUD index.** Documents the three inconsistent
  response shapes across the create/list endpoints, the `createCohort` payload
  contract, and which cohort filter types the API accepts.

## 1.6.2 — 2026-07-30

### Fixed

- **Running the same dungeon twice in one process no longer collapses the second
  run.** `validateDungeonConfig` enriched in place — stamping `isStrictEvent` on
  funnel-step events and `conversionWindowDays` / `_experiment` on funnels — and
  `DUNGEON_MASTER` handed the pipeline a shallow spread, so those stamps landed on
  the caller's own `events` / `funnels` arrays. For a file input that array belongs
  to the ESM module cache, so run 2 got a config already enriched by run 1: every
  event pre-promoted to strict, the catch-all funnel swept nothing, and event volume
  collapsed (measured 317 → 0 on `dungeons/technical/simple.js`). The validator now
  clones its input and enriches only what it returns; functions (`hook`,
  `onProgress`, chance-bound prop thunks) are preserved by reference. Affects an
  object config passed by a caller who reuses it, a file path run more than once in
  a process, and an array of paths. Not affected: raw-text input (each call writes a
  fresh temp module) and `scripts/run-many.mjs` (forks a child per dungeon). Pinned
  by `tests/integration/config-isolation.test.js`.
- **`verifyDungeon` now applies funnel config to path and JSON inputs.** It read
  `conversionWindowDays` / `order` back off the caller's own `config`, which for a
  string input has no `.funnels` at all — so every funnel check silently ran with
  the default order and an unbounded window. It now reads
  `result.validatedConfig.funnels`.
- **`verifyDungeon`'s schema report is no longer spurious.** `validateSchema` also
  ran against the raw input: a path input has no fields to derive an expected
  schema from, and a v1.5.1 dungeon keeps `hasAndroidDevices` / `hasBrowser` under
  `switches`, which `deriveExpectedSchema` only sees once flattened. Both produced
  a wall of phantom `flagStamping` findings and a permanently false `report.pass`
  (16 phantom findings on `dungeons/technical/experiments.js`; now 0). It now
  validates against the config the run actually used.
- **The 22 shipped `dungeons/vertical/*/*.verify.mjs` wrappers now thread VALIDATED
  funnels** into `evaluateStories`. They passed `config.funnels` raw, so no funnel
  story in any vertical had a conversion window — every vertical funnel resolves to
  a 30- or 45-day `conversionWindowDays` that was being dropped. Pre-existing (these
  scripts read shards off disk, so nothing ever enriched their config).
  `validateDungeonConfig` is now exported from `@ak--47/dungeon-master/verify` for
  exactly this.
- **`verifyDungeon` throws on a multi-dungeon input** instead of silently verifying
  `result[0]` and discarding the rest — which returned a green report for dungeons
  nobody looked at. Call it once per dungeon.
- **`tests/unit/dungeon-shapes.test.js` no longer asserts the lowercase-hyphen naming
  convention against `dungeons/user/`.** That directory is gitignored per-machine
  scratch space, so the check failed on whatever a given developer had checked out
  locally and was unreproducible in CI. The convention still applies to the tracked
  `technical/` and `vertical/` dungeons.

### Added

- **`result.validatedConfig`** — the enriched config the run actually used. Read
  resolved values (`funnels[].conversionWindowDays`, `events[].isStrictEvent`, the
  resolved dataset window) here now that the validator no longer writes them back to
  the object you passed in. Two caveats, both documented on the type: credentials
  are stripped (a Result gets logged), and it is **read-only** — validation is not
  idempotent, so feeding it back into `DUNGEON_MASTER` grows the funnel set and
  eventually yields an empty `sequence`. Re-run the original config instead.
- **`verifyDungeon(config, checks, overrides)`** — an optional third argument,
  merged into the dungeon before it runs exactly like `DUNGEON_MASTER`'s second
  argument. Lets CI verify a production-scale dungeon at a small `numUsers` /
  `numEvents` without editing it. The report also carries `validatedConfig`.
- **`validateDungeonConfig`** re-exported from `@ak--47/dungeon-master/verify`, so a
  standalone verify script that reads shards off disk can resolve funnel defaults
  before calling `evaluateStories` / `applyFunnelDefaults`.
- **`releaseConnections()`** exported from `lib/orchestrators/mixpanel-sender.js`,
  for hosts that drive `mixpanel-import` directly and want the same pool teardown.

### Changed

- **`validateDungeonConfig` no longer mutates its input.** Enrichment lands only on
  the returned object. If you called it directly and then read `isStrictEvent` /
  `conversionWindowDays` back off the config you passed in, read the return value
  instead (or `result.validatedConfig` after a run). Running a dungeon is
  unaffected. This is the fix for the collapse bug above, so it ships on a patch.
- **`mixpanel-import` bumped `^3.3.2` → `^3.5.1`.** Notable for dungeon-master:
  - **Flat events past `epochEnd` no longer kill the entire import job.** The sender
    sets `epochEnd: dayjs().unix()` and dungeon-master events are flat, which on
    3.3.2 threw `Record has no properties object, cannot fix time` and failed the
    whole batch; 3.5.1 counts the record as `outOfBounds` and carries on. Verified
    directly against both versions.
  - **India-region SCD imports go to `api-in`.** 3.3.2 routed `region: 'IN'` SCD
    batches to `api-eu`.
  - **The library no longer installs five process-global handlers**
    (`unhandledRejection`, `uncaughtException`, `exit`, `SIGINT`, `SIGTERM`) as an
    import side effect. **Hosts embedding dungeon-master will now crash on uncaught
    exceptions and unhandled rejections instead of logging and continuing** — those
    errors were always happening, only the reporting changes. Register your own
    handlers to restore the old behavior. Upside: `user-loop`'s own SIGINT handler is
    no longer preempted, so Ctrl+C cancellation works as designed.
  - Prod-only `npm audit` for the dependency tree: 45 findings → 20 (critical 3 → 1).
- **`sendToMixpanel` releases mixpanel-import's shared undici connection pools**
  when it settles, so a host that runs occasional imports doesn't hold ingest
  sockets open in between. Runs in a `finally`, guarded, and non-fatal; pools are
  recreated on demand. The pools are process-global, so teardown is refcounted —
  concurrent `DUNGEON_MASTER()` calls in one process won't close sockets out from
  under each other.
- **`engines.node` raised `>=18.0.0` → `>=20.20.0`**, matching what mixpanel-import
  requires. The old floor had been wrong since 3.3.2 (which already wanted 20.18.1).

## 1.6.1 — 2026-07-08

### Fixed

- **Unweighted string arrays now produce stable power-law distributions**
  (the long-documented intent finally works). Previously `choose()` rolled a
  fresh random winner on every event — two compounding bugs (`!mostChosenIndex`
  discarding an explicit `0`, plus a fresh `pickAWinner` closure per event) —
  so aggregate breakdowns came out uniform (±edge noise). Now any plain array
  of 3–19 unique strings gets ONE seed-deterministic winner per array per run,
  drawn as ~45% winner / ~25% second / ~15% third / geometric-decay tail
  (`winnerWeights` in `lib/utils/utils.js` is the single tuning point).
  - Existing opt-outs unchanged: arrays containing
    `variant`/`group`/`experiment`/`population`, arrays with explicit
    duplicate entries (dupes honored exactly), arrays of length ≤2 or ≥20,
    and non-string values.
  - Direct `u.pickAWinner([...])` use in dungeon files gets the same stable
    memoized winner for the run; explicit `pickAWinner(arr, 0)` is honored now.
    (Note: `pickAWinner` calls at module-import time in dungeon files execute
    before the run's seed is applied — as before — so those winners are stable
    within a run but not pinned across processes.) Each `pickAWinner` resolver
    now also carries its own expansion — previously `choose()`'s resolver cache
    keyed by function source could serve one property's value list to a
    different property.
  - UTM properties (`utm_campaign` etc.) draw through the same path, so
    campaign values now skew realistically per network instead of splitting
    uniformly.
  - New `resetValueCaches()` clears the per-run winner memo (and the
    weighted-array resolver cache, which previously leaked across in-process
    runs); called automatically by `initChance()` and at every run start.
  - Side effect: ~1 RNG draw per string-array property per event instead of
    ~30, and the seeded RNG stream shifts vs 1.6.0 — same seed no longer
    reproduces 1.6.0 output byte-for-byte (within-version determinism is
    unchanged).
- **Engine-shape canary and hook-pattern integration tests made truly
  deterministic** — their generating tests now run `describe.sequential`,
  since concurrent in-process `generate()` calls interleave draws (and
  re-seeds) on the shared seeded chance. The hook-pattern negative control
  was recalibrated to 600 users; at 150 it exceeded its own threshold on
  1.6.0 too and only passed under one lucky interleaving.

## 1.6.0 — 2026-07-04

### Added

- **Emulator: five new analysis types + retention completion**
  (`emulateBreakdown`, all ARB-cited):
  - `eventBreakdown` — Insights "Total" broken down by a property, with
    Mixpanel's exact segment coercion (list fan-out, `$empty_list`,
    `undefined` bucket, case-sensitive type-tagged segments, topN 250);
    `countType: 'unique' | 'sessions'`, `firstTimeOnly` compose;
    unrecognized `countType` values throw (same strict-option rule as
    retention keys).
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
- **Experiments: `sticky` knob** (`ExperimentConfig.sticky`, default
  `true`). Sticky bucketing — the pre-1.6 per-user hash — is now explicit
  and opt-out-able: `sticky: false` re-rolls the variant on every funnel
  pass via the seeded RNG. Default preserves byte-identical output for
  existing dungeons.
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
  numbers. `carry_forward: true` is kept as a deprecated alias for
  `unbounded: 'carryForward'`.
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
