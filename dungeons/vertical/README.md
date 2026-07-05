# Vertical Dungeons — Proof of Story-in-Data

One folder per vertical dungeon (v1.6 layout). Each
`dungeons/vertical/<name>/` holds three sibling files:

- **`<name>.js`** — the dungeon, exporting `stories` alongside the default
  config. Stories are the machine-checkable contract for every numbered
  hook; evaluate them with
  `node scripts/verify-stories.mjs dungeons/vertical/<name>/<name>.js`.
- **`<name>.verify.mjs`** — Node script using `@ak--47/dungeon-master/verify`
  primitives (`emulateBreakdown`, `evaluateFunnel`, `buildIdentityMap`,
  `resolveUserId`). Emulator-backed where Mixpanel-equivalent semantics
  matter; per-user JS aggregation where bespoke. Each `check()` call asserts
  one engineered hook produces measurable signal in the generated data.
- **`<name>.sql`** — DuckDB queries for human-eyeball inspection of the
  same hooks. Run after generation to inspect raw outputs the way an
  analyst would in Mixpanel.

These files are the **proof** that the engineered story patterns documented
in each dungeon's top-level comment block actually appear in the generated
data — at full fidelity, not at smoke-test scale.

## Coverage

All 22 vertical dungeons. Every documented hook has a story-backed
verification check — no documented hook is unverified. (Aggregate hook
counts are rebuilt at each release; see the per-dungeon stories exports
for the authoritative contract.)

Score column regenerated 2026-07-04 from the fix-round sweep: every
dungeon regenerated at full fidelity (its shipped `numUsers`) under the
post-review verifier and scored by `scripts/verify-stories.mjs` — the
score is the worst story verdict the runner printed, not an editorial
judgment. 15 NAILED / 7 STRONG, 22/22 at STRONG or better. This is
lower than the 2026-07-03 headline (20/2) **by design**: the fix-round
band policy below re-derived NAILED bands from hook knobs, and verdicts
that previously leaned on measurement-anchored bands now grade STRONG
honestly. No hook regressed — the data is unchanged; the grading got
stricter.

| # | Dungeon | Score | Hooks | Iter |
|---|---------|-------|-------|------|
| 1 | fitness | NAILED | 10/10 | 2 |
| 2 | dating | NAILED | 10/10 | 2 |
| 3 | community | NAILED | 10/10 | 3 |
| 4 | travel | NAILED | 10/10 | 2 |
| 5 | logistics | NAILED | 10/10 | 3 |
| 6 | education | STRONG | 10/10 | 3 |
| 7 | real-estate | NAILED | 10/10 | 2 |
| 8 | insurance-application | STRONG | 10/10 | 3 |
| 9 | food-delivery | STRONG | 10/10 | 2 |
| 10 | devtools | NAILED | 10/10 | 1 |
| 11 | healthcare | NAILED | 10/10 | 2 |
| 12 | fintech | NAILED | 10/10 | 2 |
| 13 | ai-platform | NAILED | 10/10 | 3 |
| 14 | marketplace | NAILED | 10/10 | 2 |
| 15 | media | NAILED | 10/10 | 2 |
| 16 | ecommerce | NAILED | 10/10 | 3 |
| 17 | sass | STRONG | 11/11 | 2 |
| 18 | gaming | STRONG | 13/13 | 2 |
| 19 | social | STRONG | 10/10 | 2 |
| 20 | crypto | NAILED | 11/11 | 2 |
| 21 | streaming | NAILED | 4/4 | 2 |
| 22 | support-desk | STRONG | 3/3 | 1 |

**Score legend.** Grading is mechanical (the runner reports where the
measured value landed), but the bands themselves are author-declared —
band *selection* is an editorial act, and the score is only as honest
as the band derivation. The fix-round band policy (2026-07-04):
- A NAILED band must be derived from the hook's knob (knob ±10%),
  never from a measurement of the dungeon's own output — a band
  centered on a measurement passes by construction.
- Where the realized magnitude is confounded (selection effects,
  mixtures, budget attenuation), the assertion uses a knob-derived
  floor or ceiling instead, which grades STRONG by design. STRONG is
  not a blemish: it is the honest verdict for a real effect whose
  exact magnitude is not knob-derivable.
- **NAILED** — every assertion in every story landed inside its
  knob-derived NAILED band at full fidelity.
- **STRONG** — every assertion passed, but at least one landed in the
  STRONG band outside the NAILED band (or is a floor/ceiling check).
  Each such case documents why in its story's derivation notes.

## Running

```bash
# 1. Generate fresh data (full fidelity — uses dungeon's shipped numUsers)
node scripts/verify-runner.mjs dungeons/vertical/${NAME}/${NAME}.js verify-${NAME}

# 2. Evaluate the dungeon's stories (five-tier verdict table)
node scripts/verify-stories.mjs dungeons/vertical/${NAME}/${NAME}.js --data-prefix verify-${NAME}

# 3. Run the .mjs verifier (CI gate)
node --max-old-space-size=4096 dungeons/vertical/${NAME}/${NAME}.verify.mjs

# 4. (Optional) Run the SQL for human inspection
duckdb -c ".read dungeons/vertical/${NAME}/${NAME}.sql"

# 5. Cleanup
rm -f data/verify-${NAME}-*
```

## Verify-script anatomy

Every `<name>.verify.mjs` follows the same template (see
[HOOKS.md §9.9](../../HOOKS.md#99-per-dungeon-verify-script-template)):

1. Stream-load shards (`readline.createInterface`) — handles dungeons up to
   ~1M events without `readFileSync`'s 512MB cap.
2. Build identity map (`buildIdentityMap(profiles)`) and per-user event
   bucket (`resolveUserId`).
3. One `check(name, pass, detail)` per documented hook.
4. Exit non-zero if any check fails.

## Reading the SQL

SQL files are human-readable Mixpanel inspection queries. They name each
hook the same way as the `.verify.mjs` file and the dungeon's docstring.
Numbering is consistent across all three artifacts:

- Dungeon comment: `* 1. WHALE WALLETS (everything)`
- `<name>.verify.mjs`: `check('H1 whale 5x+ trade amount', ...)`
- `<name>.sql`: `-- Hook 1: WHALE WALLETS — top 2% drive most volume`

## Known limitations (historical — list now empty)

Several engineered hooks intentionally use `funnel-post` to compress
time-to-convert within a single funnel-instance. The verifier's
`evaluateFunnel` is a greedy single-pass over the user's full event
history — it picks the first matching event for each step regardless of
which funnel-instance the hook touched. Through v1.5 this forced some
dungeons to check TTC hooks for population presence only. As of v1.6
every affected dungeon (ai-platform, dating, community, travel,
logistics, education, real-estate, devtools, marketplace, crypto) has
graduated: their TTC stories assert the TTC delta itself through
`emulateBreakdown`'s `timeToConvert` at conversion windows covering the
stretched support (see each story narrative for the censoring
analysis). Three graduation lessons generalize: pick the conversion
window where each cohort's TTC distribution is unimodal (media — at
multi-day windows the median sits on a bimodal mode boundary and flips
on sampling noise); restrict funnel-post scaling to the target
funnel when another funnel shares a step prefix (marketplace — scaling
everything let the greedy evaluator assemble chains across unscaled
instances, collapsing the read); and anchor the scaled funnel on a
unique first step (crypto — `wallet connected` is `isFirstEvent` +
`isAuthEvent`, so it occurs exactly once per user and the greedy
evaluator has no earlier instance to latch onto, making the read
stable across 1h–24h windows).

See
[`research/1.5.0-vertical-eval.md`](../../research/1.5.0-vertical-eval.md)
for the aggregate evaluation methodology and pattern catalog, and
[HOOKS.md §9](../../HOOKS.md#9-verification-patterns-from-the-v150-vertical-eval)
for the verification recipe encyclopedia.
