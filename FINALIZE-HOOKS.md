# FINALIZE-HOOKS.md — Overnight Eval Plan

**Goal:** Re-verify and upgrade all 20 vertical dungeons to produce STRONG or
NAILED hook verdicts across every engineered pattern. Prove determinism with
two consecutive runs per dungeon.

**Branch:** `may-2-eval`

**Model:** claude-opus-4-6

---

## Scoring (5-Tier)

| Verdict | Threshold | Pass? |
|---------|-----------|-------|
| **NAILED** | Within 10% of expected value/ratio | YES |
| **STRONG** | Within 25% of expected | YES |
| **WEAK** | Within 50% of expected | NO — fix |
| **NONE** | No observable effect | NO — fix |
| **INVERSE** | Opposite direction | NO — fix |

Target: every hook STRONG or NAILED. Iterate until there, then confirm with
two consecutive full-fidelity runs (no code changes between them).

---

## Standard Dataset Window

All dungeons MUST use:
```
datasetStart: "2026-01-01T00:00:00Z"
datasetEnd: "2026-05-01T23:59:59Z"
num_days = 120
```

DuckDB verification anchors to `TIMESTAMP '2026-01-01'` for day-in-dataset.
Do NOT use `MAX(time) - INTERVAL` as anchor (pre-existing user spread skews it).

If a dungeon has different dates or num_days, update them FIRST before verification.

---

## Universal Upgrades (apply to every dungeon before verifying)

### 1. Identity Model Adoption
Every dungeon gets:
- `avgDevicePerUser: 2` (or appropriate for vertical — mobile apps may use 3)
- `isAuthEvent: true` on the sign-up/auth event
- If a funnel starts with the auth event, add 1-2 pre-auth steps from existing
  schema events (e.g., page view, landing page) so the identity stitch is visible

### 2. Date Window Standardization
Set `datasetStart`, `datasetEnd`, and `num_days` per the standard above.
Adjust any hook day references proportionally (e.g., d80-90 in 100-day → d100-110 in 120-day).

### 3. Population Floor
Already done: all dungeons now 10K-42K users. Verify the const at top of file.

### 4. Deprecated Feature Replacement
Dungeons with `subscription:`, `attribution:`, `geo:`, `features:`, `anomalies:`
config blocks — these are silently stripped by the 1.4 engine. If hooks DEPEND
on events/data from deprecated features:
- Add equivalent events to the `events[]` array with appropriate properties
- Wire them into funnels where the story requires them
- Update hooks to work with the new schema events

If the deprecated config block is unused by hooks (just sitting there), remove it.

### 5. Experiment Migration
Any hook that manually simulates A/B test variants → migrate to the declarative
`experiment: { name, variants: [...], startDaysBeforeEnd }` on the funnel config.
Simplify the hook to only add downstream behavioral effects (the engine handles
variant assignment, `$experiment_started` events, and conversion modifiers).

### 6. No Flag Stamping Audit
**MANDATORY for every dungeon.** Scan the hook function for ANY property
assignments that create boolean/categorical cohort flags not defined in the
original event schema. Examples of violations:
- `record.is_whale = true`
- `record.power_user = true`
- `record.sweet_spot = true`
- `record.is_churned = true`
- `event.cohort = "high_value"`

If found: REMOVE the flag. Rewrite the hook to achieve the same effect through
value mutations, event filtering, or event injection. The cohort must be
derived behaviorally in Mixpanel, not stamped as a property.

### 7. Macro/Soup
Leave as defaults unless a hook story is actively broken by time distribution.
Note any changes in the final report.

---

## Allowed Changes (Boundary)

| CAN change | CANNOT change |
|------------|---------------|
| Hook function body | Core story narratives |
| Conversion rates on funnels | Number of hook patterns |
| Population params (numUsers, numDays, avgEventsPerUserPerDay) | Existing events/funnels (unless deprecated-feature replacement) |
| Add events/funnels for deprecated feature replacement | Dungeon seed |
| Adopt identity model (avgDevicePerUser, isAuthEvent, attempts) | Remove existing non-deprecated events |
| Adopt declarative experiments | |
| Event weights and property distributions | |
| macro/soup settings (only if breaking a hook) | |
| datasetStart/datasetEnd (standardize to Jan 1 - May 1) | |

---

## Key Learnings from sass.js Gold Standard

These patterns were proven during the sass.js calibration run. Apply them
when fixing hooks in other dungeons:

### L1: Temporal hooks belong in `everything`, not `event`
The `event` hook's `meta.datasetStart` produces unreliable day-in-dataset
calculations. Move any hook that checks day ranges to the `everything` hook
where `meta.datasetStart` is verified reliable.

### L2: Event cloning requires `everything` hook
The `event` hook's return value REPLACES the event. To DUPLICATE an event
(spike patterns, injection), use the `everything` hook and push() to the array.

### L3: Property baseline must contrast with hook target
If a hook overrides `event_type = "plan_upgraded"` but the baseline already
has 20% plan_upgraded, the hook is invisible. Skew the baseline distribution
AWAY from the target value so the hook creates visible contrast.

### L4: Closure-state hooks (Maps) work in `event` hook
Module-level Map patterns (cost overrun → scale down, failed → recovery) work
correctly in the event hook. Keep them there.

### L5: Funnel-post TTC is not SQL-verifiable
Move TTC-by-segment effects to the `everything` hook where you can directly
manipulate time gaps between alert/response events. This makes the effect
visible in cross-event MIN-to-MIN SQL queries.

### L6: Use stronger multipliers for everything-hook effects
The everything hook operates on a user's full event array. Effects like TTC
scaling need stronger factors (0.5x/1.8x) to show clearly in cross-event
queries, because standalone events dilute the within-funnel signal.

### L7: DuckDB anchor must match hook anchor
Use `TIMESTAMP '2026-01-01'` (the config's datasetStart) as the anchor for
day-in-dataset calculations, not `MAX(time) - INTERVAL`. Pre-existing users
have events 30+ days before the dataset start.

---

## Execution Plan

### Wave 1: Reference (already done)
- [x] `sass.js` — 5 NAILED, 5 STRONG, determinism confirmed

### Wave 2: Light Deprecated Usage (5 dungeons)
Process in this order:
1. `ai-platform.js`
2. `crypto.js`
3. `ecommerce.js`
4. `insurance-application.js`
5. `real-estate.js`

These have minimal subscription/deprecated references. Mostly hook tuning,
identity model adoption, and date standardization.

### Wave 3: Heavy Deprecated Usage (14 dungeons)
Process in this order:
1. `community.js`
2. `dating.js`
3. `devtools.js`
4. `education.js`
5. `fintech.js`
6. `fitness.js`
7. `food-delivery.js`
8. `gaming.js`
9. `healthcare.js`
10. `logistics.js`
11. `marketplace.js`
12. `media.js`
13. `social.js`
14. `travel.js`

These need schema additions for deprecated subscription/attribution/geo/features
events, plus hook rewrites.

---

## Per-Dungeon Workflow

For each dungeon, follow this exact sequence:

### Phase A: Audit & Upgrade
1. Read the full dungeon file
2. Catalog all hooks (number, name, type, mechanism, expected signal)
3. **Flag stamping audit** — scan for any boolean/categorical cohort flags
4. Apply universal upgrades:
   - Set `datasetStart: "2026-01-01T00:00:00Z"`, `datasetEnd: "2026-05-01T23:59:59Z"`, `num_days = 120`
   - Add `avgDevicePerUser: 2` and `isAuthEvent: true` on auth event
   - Add pre-auth funnel steps if first funnel starts with auth event
   - Replace deprecated feature events/funnels where hooks depend on them
   - Migrate manual experiment hooks to declarative experiment API
   - Remove unused deprecated config blocks (`subscription:`, `attribution:`, etc.)
5. Adjust hook day references for 120-day window
6. Check property baselines don't dilute hook targets (L3)

### Phase B: Verify
1. Run: `node scripts/verify-runner.mjs dungeons/vertical/<name>.js verify-<name>`
2. Query each hook with DuckDB, scoring NAILED/STRONG/WEAK/NONE/INVERSE
3. If any hook is WEAK/NONE/INVERSE:
   - Diagnose using learnings L1-L7
   - Fix the hook or config
   - Re-run and re-verify
   - Max 3 fix-verify cycles per hook. If no progress after 3, mark
     impossible in TODO.md and move on.

### Phase C: Determinism
1. When all hooks score STRONG or NAILED, run the dungeon a second time
2. Verify event count matches within 0.5%
3. Verify key hook ratios match to 2 decimal places
4. If determinism fails, investigate non-determinism source (dayjs(), Date.now(), Math.random())

### Phase D: Finalize
1. Add `version: 2` to the dungeon config object (top-level property)
2. Commit: `git add dungeons/vertical/<name>.js && git commit -m "finalize <name>.js: all hooks STRONG/NAILED, version 2"`
3. Clean up: `rm -f ./data/verify-<name>-*`

---

## Cross-Dungeon Learning

After completing each dungeon:
1. If a new hook pattern was discovered that works reliably, append it to
   `HOOKS.md` following the existing format (category, hook type, code, analogue)
2. If a hook is impossible (needs engine changes), add it to `TODO.md` with:
   - Dungeon and hook number
   - What the hook tries to do
   - Why it can't work
   - What module change would fix it
3. If a skill improvement was identified, update the relevant skill file

Learnings from earlier waves MUST inform later waves. If you discover that
e.g. subscription tier cohort sizing requires 15K+ users, apply that to
subsequent dungeons proactively.

---

## Impossible Hook Protocol

A hook is "impossible" after 3 fix-verify cycles with no progress toward
STRONG on the same pattern. At that point:
1. Document in `TODO.md`:
   ```
   ## <dungeon> — Hook #N: <name>
   **Problem:** <what the hook tries to do>
   **Why impossible:** <root cause — missing engine capability, signal too weak, etc.>
   **Fix needed:** <what module change would enable this>
   ```
2. The dungeon still gets `version: 2` if all OTHER hooks are STRONG/NAILED
3. Add an exemption note in the hook's documentation block
4. Move on to the next dungeon

---

## Final Report

At the end of the session, write `research/FINALIZE-REPORT.md`:

```markdown
# Finalize Hooks Report — 2026-05-02

## Summary
- Dungeons processed: X/20
- All STRONG+: X dungeons
- Has NAILED hooks: X dungeons
- Impossible hooks flagged: X (see TODO.md)
- Total hooks verified: X
- Breakdown: X NAILED, X STRONG, X WEAK, X NONE, X INVERSE

## Per-Dungeon Results Table
| Dungeon | Hooks | NAILED | STRONG | WEAK | Iterations | Status |
|---------|-------|--------|--------|------|------------|--------|

## Wave 1 Learnings
(from sass.js — already documented above)

## Wave 2 Learnings
...

## Wave 3 Learnings
...

## HOOKS.md Additions
- List of new/updated recipes with section references

## TODO.md Items
- List of impossible hooks with brief rationale

## Skill/Config Updates Made
- Changes to verify-hooks, write-hooks, or other skills
```

---

## Commit Strategy

- One commit per finalized dungeon
- Non-dungeon changes (skills, HOOKS.md, TODO.md) get their own commits
- All on `may-2-eval` branch
- Do NOT push to remote

---

## Reference Files

- `HOOKS.md` — hook recipe catalog (read before writing/fixing hooks)
- `CLAUDE.md` — full project documentation
- `.claude/skills/verify-hooks/SKILL.md` — verification skill (5-tier scoring)
- `.claude/skills/write-hooks/SKILL.md` — hook writing skill
- `research/1.4.0-upgrade-guide.md` — 1.4 migration reference
- `dungeons/vertical/sass.js` — gold standard reference dungeon (version 2)
