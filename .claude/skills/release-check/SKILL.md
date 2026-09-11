---
name: release-check
description: "Use before a dungeon-master release to audit versioned docs, skills, tests, determinism, package contents, and Git state; report release blockers and prepare an explicitly authorized PR and merge handoff."
argument-hint: "[version, e.g. 1.8.0] [optional base branch]"
---

# Release check

Check the current checkout before release. Read `AGENTS.md`, `package.json`,
the target changelog entry, and its upgrade guide. Default to validation only.
Never publish to npm unless the user gives explicit authorization for npm publishing.
An instruction to merge a PR is not permission to publish a package.

## Establish the release scope

1. Inspect `git status --short`, the current branch, remotes, and recent history.
   Preserve unrelated changes. Never reset or clean the worktree to make checks pass.
2. Confirm the requested version matches `package.json`, the lockfile, changelog,
   and guide. Do not invent a release date or bump a version without authorization.
3. Compare the release diff against the base branch. Check exports, dependencies,
   config defaults, compatibility notes, examples, and migration instructions.
4. Inspect test setup before running it. This repo's suite prunes `data/` and `tmp/`.
   If pending deployment artifacts exist, preserve them outside those directories
   or obtain consent before running the suite. Do not silently delete verified inputs.

## Run executable gates

Use `set -o pipefail` for every piped command. Keep all Vitest output behind
`2>&1 | tail -50`; a successful tail command alone is not passing evidence.

```bash
set -o pipefail
npm test 2>&1 | tail -50
npm run typecheck
git diff --check
npx vitest run tests/unit/engine-shape-canary.test.js 2>&1 | tail -50
RUN_FULL_SWEEP=1 npx vitest run tests/e2e/engine-shape-full-sweep.test.js 2>&1 | tail -50
node tests/engine/smoke-test-all.mjs
npm pack --dry-run --json
```

Run commands separately or chain with `&&` so a failure cannot disappear behind
a later success. Record exit codes, pass/skip counts, and the tested commit/diff.
The smoke script discovers vertical dungeons only. Verify changed technical or
customer fixtures separately with the existing verification runners.

For generation changes, require the event-stream determinism test. Compare runs
with the same seed, pinned window, and `concurrency: 1`; strip only `insert_id`.
Use sequential test cases because the RNG is shared. Include warehouse noise in
warehouse determinism checks. Never accept an unrun or failing determinism gate.

## Audit docs and skills

- Run `tests/e2e/skills-contract.test.js`. Parse YAML frontmatter rather than
  guessing from appearance: names match folders, descriptions are strings, and
  `argument-hint` is a quoted string.
- The canonical skills live in `.claude/skills`. Verify `.agents/skills` and
  `.github/skills` resolve to that directory. Do not duplicate skill content.
- Check README, HOOKS, type comments, changelog, and guide against actual code.
  Do not carry stale test counts, old skill paths, or historical operational
  failures forward as current release claims.
- Follow the complete handoff: author, optional hooks, verify, provision,
  generate/import, optional `/warehouse-metrics`, then headless build.
- Distinguish user events, identity-less `standaloneEvents`, and warehouse rows.
  Synthetic IDs are not people. Standalone hooks return retained records;
  warehouse hooks mutate rows and ignore returns. Preserve deployment artifacts.
- If API integrations changed, read the current endpoint docs and local handback.
  Distinguish docs discovery, mocked execution, dry-run, and live verification.
  Live writes require explicit authorization. Never claim an endpoint GET proves
  authenticated write permission or end-to-end deployment.

## Inspect the package and internal files

Read the file list from `npm pack --dry-run --json`. Confirm new runtime modules,
dependencies, scripts, and canonical skill files ship. Reject credentials,
customer data, `plans/`, `research/`, `.superpowers/`, or obsolete skill paths.
Check symlink handling in the package separately from workspace discovery.

Verify `git ls-files .superpowers` is empty and `.gitignore` covers the directory.
Ignoring an already tracked file does not untrack it. Obtain authorization before
removing index entries; preserve local reports. Archive completed plan folders
whole under `plans/archived/`; leave active or ambiguous work in place.

## Report and optional shipping handoff

Report blockers first, then evidence, skipped checks, compatibility changes,
and remaining operational limits. Do not fix unrelated failures or weaken tests.

Only when explicitly requested: inspect all staged files for secrets, commit the
authorized changes, push the feature branch, create or reuse its PR, and inspect
CI and mergeability. Require successful completed checks for the current PR head
before squash merge. If no CI checks are configured, report that explicitly and
use recorded local release gates; do not describe absent CI as passing. A failed
release gate requires investigation and an explicit operator decision before shipping.
Never bypass protections or use admin merge
to hide a failing check. Confirm the PR is merged before switching local branches.
Fetch, switch to `main`, and pull with `--ff-only`; stop rather than discard local
changes or divergent commits. Report the PR URL, merge SHA, current branch, and
working-tree status. Leave npm publishing to the operator unless separately authorized.