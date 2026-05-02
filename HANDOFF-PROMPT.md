# Autonomous Overnight Handoff Prompt

Paste the section below `--- BEGIN PROMPT ---` into a fresh Claude Code session in bypass mode.

--- BEGIN PROMPT ---

You are working autonomously overnight on a dungeon-master sprint. The user is asleep and will check results in the morning. Bypass mode is on. Make decisions and ship.

## Your job

Execute the plan at `/Users/ak/code/dungeon-master/ID-MGMT-AND-MAGIC-NUMBER-IMPROVEMENT-PLAN.md`. It is the authoritative spec. Read it in full before starting. The plan locks every major design call in Sections 2 and 3. Do not relitigate those.

## Working directory

`/Users/ak/code/dungeon-master/` — this is a Node.js ESM module (`@ak--47/dungeon-master`). Read `CLAUDE.md` first, then the plan, then `types.d.ts`.

## Phasing rules (non-negotiable)

The plan has 6 phases (Sections 4–9). Each has an explicit **verification gate** at its end. Rules:

1. Do not start phase N+1 until phase N's verification gate passes.
2. If a verification gate fails, fix the underlying issue. Do not lower the bar.
3. Skills (Phase 5) are LAST. Do not edit `.claude/skills/*` until phases 1–4 are passing AND at least `dungeons/user/my-buddy.js` is migrated and PASSing under verify-hooks.
4. Reference dungeons (Phase 6) can interleave with Phase 5 (skill content benefits from learning what works in real dungeons).

## Commits

- Conventional prefix per phase: `phase1:`, `phase2:`, etc.
- Sub-commits within a phase OK (`phase2: identity model — events.js`).
- Commit message body includes the verification gate output (a few lines from `npm test` and the relevant DuckDB queries).
- Author: standard `Co-Authored-By: Claude` footer.
- DO NOT push. Local commits only.

## Test + verification commands

```bash
# Unit + integration tests
npm test

# Run all verticals at default scale (regression check after Phase 1 + Phase 2)
node scripts/run-many.mjs dungeons/vertical --parallel 4

# Verify a single dungeon end-to-end
node scripts/verify-runner.mjs dungeons/<path>.js verify-<name>
duckdb -c "SELECT ... FROM read_json_auto('./data/verify-<name>-EVENTS.json')"

# Clean up data files between runs
rm -f ./data/verify-*
```

When in doubt, mirror the patterns in `.claude/skills/verify-hooks/SKILL.md` for DuckDB query design.

## Ambiguity policy

- **If the plan locks the decision**, follow it exactly (Section 2 decisions table + Section 3 architecture).
- **If the plan defers a small decision** to the implementing agent (parameter names, file organization within a phase, exact JSDoc wording), make a conservative choice and document it inline in the code.
- **If you hit a hard block** (something the plan didn't anticipate), prefer the simpler decision that preserves backwards compat. Add a note to `IMPLEMENTATION-NOTES.md` at project root with: what blocked you, what you decided, why.
- **Never relitigate locked decisions.** Identity model, kill list, hybrid approach, helper API surface, skill split — these are settled.

## Scratch space

`dungeons/technical/*` exists for ad-hoc testing. The plan explicitly invites you to repurpose those files as fixtures for new identity primitives, atoms, patterns, and emulator queries. Each Phase 4 pattern should land at least one technical-dungeon reference test case. These files have no customer-facing story — feel free to overwrite or replace.

`dungeons/vertical/*` and `dungeons/user/*` are reference dungeons. Touch only as the plan calls for (Phase 6 migrates `my-buddy.js` + one vertical, recommended `sass.js`).

## Tooling notes

- Use the Agent tool with subagent_type `Explore` for any open-ended codebase search (>3 queries worth).
- Use the Agent tool with subagent_type `Plan` for designing internals of complex phases (Phase 2 identity model, Phase 4 emulator) before implementing — these are the riskiest sub-designs.
- Use the Agent tool with subagent_type `superpowers:code-reviewer` after each major phase commit to verify the implementation against the plan's acceptance criteria.
- Use TodoWrite to track progress across phases. Mark each phase done only after its gate passes.

## Backwards compat tripwire

After Phase 1 and Phase 2, run:

```bash
node scripts/run-many.mjs dungeons/vertical --parallel 4 2>&1 | tee /tmp/regression.log
```

If any vertical dungeon now throws an exception that didn't before, that's a backwards-compat break — investigate and fix BEFORE moving on. Acceptable: event count drift up to ~5% per dungeon (the killed Phase 2 entities and identity stamping cleanup will shift counts). Unacceptable: thrown errors, missing required output files, or hooks that previously PASSed now FAILing for unrelated reasons.

## Definition of done (morning deliverables)

When you stop, the following must all be true:

1. All 6 phases' verification gates have PASSed (or you've stopped at a phase boundary with the prior phase committed and PASSing).
2. `dungeons/user/my-buddy.js` migrated to new identity model + new hook helpers, passing `verify-hooks` for all 3 stories using the new emulator.
3. At least one `dungeons/vertical/*` migrated as a B2B reference (recommended: `sass.js`).
4. `CLAUDE.md` updated at the end of the sprint to reflect new architecture, public API exports, skill pipeline.
5. `IMPLEMENTATION-NOTES.md` exists at project root, documenting any decisions you made beyond what the plan locked + any blockers you couldn't fully resolve.
6. Final summary written to `OVERNIGHT-SUMMARY.md` at project root: phases completed, phases skipped (with reason), test results, hook verification results, list of new commits, list of risks/follow-ups for the morning review.
7. NO `git push`. NO `npm publish`. NO destructive operations on the user's data outside `./data/`.

## Stopping conditions

Stop and write `OVERNIGHT-SUMMARY.md` if any of the following:

- A phase verification gate fails 3 consecutive times after good-faith fix attempts → halt at the start of that phase, summarize the failure mode and what was tried.
- Backwards compat regression you cannot fix within the constraints (acceptable to halt mid-phase here).
- You discover the plan has a fundamental flaw that invalidates a downstream phase → halt, summarize, propose plan amendments in `IMPLEMENTATION-NOTES.md`.
- You finish all 6 phases — write the final summary and stop.

## Style

- Code: match existing project style (2-space tabs in dungeon files, full JSDoc on public APIs).
- Commits: terse subject (≤50 chars), useful body.
- Markdown: structured, scannable, links to file paths.
- No emojis unless the user has used them in adjacent context.

Begin. Read `CLAUDE.md`, then `ID-MGMT-AND-MAGIC-NUMBER-IMPROVEMENT-PLAN.md`, then `types.d.ts`. Then start Phase 1.

--- END PROMPT ---
