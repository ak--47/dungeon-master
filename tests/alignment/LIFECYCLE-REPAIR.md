# Lifecycle FIX SPEC

Scope: user-loop and funnel clocks, final identity stamping, and owned regressions.
Shared fixtures, helper shape code, and existing acceptance assertions stay unchanged.

## Evidence

- HELPERS-FAILURES FOUND 3: timestamp-pre-auth user identity, missing retry entries,
  and authenticated rows without an emitted stitch.
- GENERATED-FAILURES G1: observed-entry elapsed D7 misses the unchanged 0.10 lift floor.
- Analytics retention_query.cpp:1120 requires a distinct return strictly after birth.
  At :1259 it subtracts the observed aligned birth timestamp for bucket selection.
- Production first-funnel calls omit the active-day upper bound. makeEvent samples
  through dataset end. Usage uses the first attempt timestamp, not its completion.
- buildActiveDayPlan weights days from adjusted creation, then shuffles the plan.
  Sampling birth again from that plan moves the report origin away from the curve origin.

## Contract Before Runtime Edits

1. With retention enabled, the first observed entry starts at adjusted creation,
   clipped to dataset start. Usage follows completion of all onboarding attempts.
2. Each failed prior precedes the final attempt. Engine-generated attempts fit the
   lifecycle and dataset bounds. Impossible capacity raises an explicit error;
   promised entry rows must not silently disappear through future clipping.
3. For device-enabled born users, final emitted timestamps and surviving auth rows
   determine identity. Earlier rows and users without an emitted auth stay device-only.
   Hooks may deliberately change timestamps; final stamping does not undo those times.
4. Device-disabled and pre-existing identity behavior stays unchanged.
5. Retention is still finite-budget weighted day scheduling, not literal calibrated
   Bernoulli retention. A clock fix alone does not prove G1 or eliminate capacity limits.

## Validation

Run the tiny lifecycle regression red under the network-denying OS sandbox using
tests/alignment/vitest.config.js, then commit this spec and regression checkpoint.
After repair rerun that slice, unchanged generated identity and G1 acceptance,
selected legacy identity/retention tests, typecheck, determinism, and macro canaries.