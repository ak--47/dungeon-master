# Lifecycle FIX SPEC

Scope: user-loop and funnel clocks, final identity stamping, and owned regressions.
Shared fixtures, helper shape code, and existing acceptance assertions stay unchanged.

## Evidence

- HELPERS-FAILURES FOUND 3: timestamp-pre-auth user identity, missing retry entries,
  and authenticated rows without an emitted stitch.
- GENERATED-FAILURES G1: observed-entry elapsed D7 misses the unchanged 0.10 lift floor.
- Analytics retention_query.cpp:1120 requires a distinct return strictly after birth.
  At :1259 it subtracts the observed aligned birth timestamp for bucket selection.
- Analytics normal_query.cpp:2284-2293 skips absent/empty distinct identity for unique
  counting. At :1919-1930 cumulative uniques use a set of distinct IDs. These are
  reader counting rules, not ingestion merge rules. Generated identity acceptance
  derives merge evidence only from emitted both-ID rows, never profile device pools.
- Production first-funnel calls omit the active-day upper bound. makeEvent samples
  through dataset end. Usage uses the first attempt timestamp, not its completion.
- buildActiveDayPlan weights days from adjusted creation, then shuffles the plan.
  Sampling birth again from that plan moves the report origin away from the curve origin.

## Contract Before Runtime Edits

1. With retention enabled, the first observed entry starts at adjusted creation,
   clipped to dataset start. Usage follows completion of all onboarding attempts.
2. Each failed prior precedes the final attempt. Engine-generated attempts fit the
  lifecycle and dataset bounds when representable. Insufficient time keeps the
  in-window prefix and reports an aggregate warning. Configured TTC stays unchanged.
3. For device-enabled born users, final emitted timestamps and surviving auth rows
  determine engine identity. Earlier rows and users without an emitted auth stay
  device-only, except the documented both-ID `$experiment_started` marker.
  Explicit hook identity overrides and profile-drop rescue remain authoritative.
4. Device-disabled and pre-existing identity behavior stays unchanged.
5. Retention is still finite-budget weighted day scheduling, not literal calibrated
   Bernoulli retention. A clock fix alone does not prove G1 or eliminate capacity limits.

## Validation

Run the tiny lifecycle regression red under the network-denying OS sandbox using
tests/alignment/vitest.config.js, then commit this spec and regression checkpoint.
After repair rerun that slice, unchanged generated identity and G1 acceptance,
selected legacy identity/retention tests, typecheck, determinism, and macro canaries.

## Repair And Evidence

Red checkpoint: `8b161a0`. Both original regressions failed before runtime edits.
The retention birth differed from creation by several days; retry traffic leaked
user identity before auth.

- Retention first entry is pinned to adjusted creation, while TimeSoup still consumes
  seeded draws. Other first funnels retain bounded sampling within their selected day.
- First-funnel timing reserves its actual generated span before dataset end. Retries
  start at lifecycle creation and advance after the preceding attempt plus a seeded
  retry gap. Usage starts strictly after the maximum onboarding timestamp.
- Device-enabled born-user identity is reconciled after hooks, future filtering, and
  strict-count sampling. Missing or later auth cannot leave earlier authenticated rows.
  Deliberate hook timestamps remain unchanged. Disabled-device and pre-existing paths
  retain their identity rules.
- Compatibility correction: the capacity throws from `1ed2527` broke previously
  valid configurations. Insufficient time now emits partial output with
  `lifecycle.firstFunnelClipped`. Auth-first empty priors remain valid and report
  `lifecycle.emptyPreAuthAttempt`. Strict sampling reserves surviving attempt entries
  before sampling other rows. A genuinely insufficient budget wins and reports
  `lifecycle.strictAttemptBudget`. Each warning aggregates through `result.warnings`.
  World suppression and hook filtering do not imply scheduling failure or recreate rows.
  Reservation uses surviving `insert_id` values, so hooks that copy records keep their
  attempt entries when the strict budget fits.
  Identity provenance stays internal; unchanged engine fields reconcile after final
  filtering, while explicit hook fields and the synthetic experiment exception survive.
  No public signature, option, default, or new required API exception is introduced.

Focused compatibility validation: 16 lifecycle tests (birth, retry order,
post-onboarding usage, partial-output warnings, copied-row retry reservation, world
suppression, synthetic experiment IDs, explicit hook identity/profile overrides,
auth removal/retiming/clipping, disabled devices, determinism), seven legacy identity
tests, three legacy retention tests, and ten macro canaries passed offline.
The legacy configuration is `lifecycle-vitest.config.js`, extending the local sandbox
configuration with no global setup. `tsc --noEmit` passes. This worktree rejects
`--ignoreDeprecations 6.0`; that flag is not used in the successful check.

Unchanged helpers-generated identity acceptance passes all three device tests:
18 runs across three seeds, devices 0/1/4, and 0/2 failed priors. All runs report zero
pre-auth leaks, zero anonymous invalid rows, and zero entry-count mismatches.
The requested `-t identity` filter also matches the attribution test through its
parent suite name: four tests passed and eleven were skipped. All Vitest commands
used `sandbox-exec -p '(version 1) (allow default) (deny network*)'`, local binaries,
and configurations without global setup. Typecheck used the same network sandbox.
The G1 evidence below is retained from the preceding repair, not rerun during this
compatibility pass. No full-suite or synthetic-generation success is claimed here.

## G1 Remains Capacity-Limited On The Original Fixture

Do not conflate the concurrent shared-fixture update with the clock repair. The current
fixture adds real standalone Background Activity and permits non-strict organic events.
Its unchanged 0.10 floor passes: mean lifts 0.149419 mixed and 0.303977 dense.

An offline in-memory probe loaded the committed fixture with
`git show 8b161a0:tests/alignment/fixtures.mjs` and ran it against the repaired runtime.
It used first First Entry per user, elapsed `[birth+7d,birth+8d)`, complete-bucket
eligibility, and distinct retained users. No shared file or threshold was changed.

| Noise | Seed | High retained / eligible | Low retained / eligible |
|---|---|---|---|
| mixed | 17 | 61 / 1152 | 39 / 1150 |
| mixed | 43 | 81 / 1165 | 50 / 1146 |
| mixed | 89 | 68 / 1129 | 51 / 1156 |
| dense | 17 | 152 / 1153 | 69 / 1179 |
| dense | 43 | 129 / 1166 | 74 / 1166 |
| dense | 89 | 157 / 1186 | 85 / 1193 |

Original-fixture G1 remains RED: mean lift **0.020350 mixed**, **0.060535 dense**.
The curve selects weighted days; a finite per-user budget and multi-step funnels do
not guarantee a return in each selected elapsed bucket. This repair changes neither
that allocation model nor the 0.10 floor. Neither fixture proves literal 80%/20%
retention calibration. All denominators exceed the unchanged minimum 250.

Unrelated helper session/path repairs and shared fixture/report changes belong to
other agents and are excluded from this lifecycle commit.

## Engine Clone Provenance Contract (Before Fix)

Source reviewed locally, without network: analytics commit
`717286d2d3ed03e9e3f9cb4346e4c6b2e561fb9a` (clean checkout).
Paths below are relative to `/Users/ak/code/analytics`.

- `go/src/mixpanel.com/ingestion/remap/transformers/identity_manager_transformer.go:122`
  builds `LookupAndUpdateRequest` with distinct, device, and user IDs. It passes no
  event name or dungeon funnel designation.
- `go/src/mixpanel.com/arb/identity-manager/server/v3/lookup_and_update_handler.go:68`
  normalizes IDs; `:109` processes them and `:184` writes the device/user pair.
  Valid ordinary both-ID events can establish a mapping. Existing mapping conflicts
  and invalid/reserved IDs still follow the server's own validation rules.
- `go/src/mixpanel.com/arb/identity-manager/server/v3/lookup_and_update_handler_test.go:131`
  (`TestLookupAndUpdateDeviceIDAndUserIDBoth`) asserts device `a1` first resolves to
  `$device:a1`, then the pair `a1`/`u1` resolves to `u1` and stores `$device:a1 -> u1`.
  `TestLookupAndUpdate` at `:170` checks later device-only lookups resolve to `u1`.
  These are source assertions, not a locally executed Spanner test.

Accepted: engine world/data-quality spread clones lose the nonenumerable
`engineIdentity` snapshot. The pre-everything map then saves `original: undefined`.
Removing auth repairs originals but skips clones, leaving unintended user identity.
For valid IDs, a leaked user-only row counts as identified; a leaked both-ID row can
also link its device in simplified identity. The failure concerns actual output IDs.

Rejected: restricting stitch evidence to the first funnel. A later ordinary Login
with both IDs can legitimately link. The current auth-name scan accepts that case;
this patch leaves the scan unchanged. Its configured auth-name restriction is a
generator lifecycle policy, not a complete implementation of Mixpanel ingestion.
Earlier device-only rows can resolve retrospectively after a valid both-ID link.

Repair contract: when the engine creates a clone, preserve an existing source
provenance descriptor. Do not invent provenance for unmarked hook input. Keep the
symbol nonenumerable, omit it from JSON and object spread, preserve fresh insert IDs,
and preserve explicit hook identity overrides. Hook-created fresh-ID spread clones
remain outside engine ownership. Public API and all other runtime behavior stay fixed.

Discriminating check: `identity-clone-contracts.test.js` uses one born, device-enabled
user, guaranteed auth conversion, then removes all auth rows in `everything`.
Run separately with `duplicateRate: 1` and a world multiplier of 2. Require actual
original and cloned usage rows; both must finish device-only. Adjacent controls cover
event/funnel-post/everything identity overrides, unmarked input, hook clones,
serialization, and a surviving later ordinary both-ID Login.

Pre-fix red result (runtime unchanged): 2 failed, 10 passed, 372 ms wall.
Both clone modes emitted two `Repeat Entry` clones with
`user_id: 4bbcddf3-947d-5f35-8f84-9fb0b3f3d8e0` and
`device_id: RwrilSZND7eNlZ3Jp9rVOWY1hO0dZaN6RpSxScJKXW` after auth removal.
Original usage rows passed the device-only assertion in the same runs.
The later Login and all explicit override controls passed before the fix.
Command: `sandbox-exec -p '(version 1) (allow default) (deny network*)'
./node_modules/.bin/vitest run --config tests/alignment/vitest.config.js
tests/alignment/identity-clone-contracts.test.js` (with `pipefail`, output through
`tail -50`). No network, installation, import, or upstream Spanner test ran.

### Clone Repair Validation

The runtime change copies `Object.getOwnPropertyDescriptor(source, engineIdentity)`
onto each engine-created data-quality/world clone when that descriptor exists.
No fallback snapshot is created. No change to events.js, stitch selection, public
types, RNG calls, timestamps, hook ordering, or serialization is required.

All checks below ran with the same network-denying sandbox and installed local
binaries. Vitest used no global setup; output was piped through `tail -50` with
`pipefail`. No installs or pushes ran.

| Check | Result |
|---|---|
| New clone contracts, exact red command rerun | 12 passed, 358 ms |
| Full lifecycle-vitest.config.js | 36 passed, 5.57 s |
| helpers-generated.test.js, `-t identity` | 4 passed, 11 skipped, 4.49 s |
| Full identity atoms, identity resolution, lifecycle helpers | 29 passed, 321 ms |
| `./node_modules/.bin/tsc --noEmit` | exit 0 |
| Editor diagnostics on runtime and new test | no errors |
| `git diff --check` | exit 0 |

Generated identity acceptance covers 18 runs: three seeds, devices 0/1/4, and 0/2
failed priors. Every run reports `preAuthLeaks: 0`, `anonymousLeaks: 0`, and
`attemptMismatches: 0`. The filter also selects attribution through its suite name.
The full lifecycle configuration includes 16 lifecycle contracts, seven legacy
identity tests, three retention tests, and ten macro canaries.

Helper suites ran through `startVitest` from `vitest/node`, with
`config: 'tests/alignment/vitest.config.js'`, `watch: false`, and an in-memory
`include` override containing `tests/unit/hook-helpers-identity.test.js`,
`tests/unit/identity-resolution.test.js`, and `tests/unit/lifecycle.test.js`.
The runner checked that all three files ran and closed the Vitest context.
No configuration file was changed. The main reviewer owns the final full suite;
the prior sweep artifacts have not been regenerated against this runtime change.