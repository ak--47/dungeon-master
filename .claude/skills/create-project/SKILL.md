---
name: create-project
description: Use when an existing dungeon needs a real Mixpanel project provisioned before sending data — creates the project, sets timezone UTC, mints a scoped service account, adds the dungeon's group keys, uploads business context (AI context), and writes the resulting credentials back into the dungeon so it "just runs". Follows create-dungeon / write-hooks / verify-dungeon.
argument-hint: '[dungeon path, e.g. dungeons/user/shopstream/shopstream.js]'
model: claude-opus-4-6
effort: max
---

# Create a Mixpanel Project for a Dungeon

Provision a fresh Mixpanel project for an existing dungeon and wire its credentials back in.

**Dungeon file:** `$ARGUMENTS`

This is the step after a dungeon is authored, reviewed, and tweaked. It turns a
local dungeon into one you can actually send to Mixpanel by creating the project
and stamping `credentials` back into the file.

Follow the [1.8.1 verification contract](../verify-dungeon/references/alignment-contract.md)
when carrying verification claims into business context. Preserve the actual report
definition and explicit counting options. Local evidence is selected source-derived
verification, not live Mixpanel parity. Provisioning is a separately authorized
handoff; never run it automatically during offline verification.

## What it does

All work runs through the orchestrator `provision.mjs` (this skill's directory),
which calls the [power-tools API](https://mixpanel-power-tools-api-lmozz6xkha-uc.a.run.app)
in order:

1. **createProject** — name derived from the dungeon's `OVERVIEW` (`NAME:` line), region `US`, timezone `UTC` (set as a follow-up by the endpoint).
2. **mintServiceAccount** — `admin`, expires `+30 days`, scoped to the new project. This is what the dungeon uses to **send** data.
3. **addGroupKey** — one per `groupKeys` entry in the dungeon (`property_name` + a titleized `display_name`). Skipped if the dungeon has no group keys.
4. **setBusinessContext** — markdown built from the dungeon's `OVERVIEW` comment block plus the `stories` named export (per story: `narrative` + `mixpanelReport` + intentional deviations); dungeons without stories fall back to the `HOOK STORIES` comment scrape (via the package's `extractComments`). Plus an events/funnels/props/group-keys summary and separate standalone-event and warehouse-metric summaries, capped at 50k chars. The dry-run plan prints which source was used.
5. **write-back** — replaces the dungeon's `credentials: { … }` block with `{ token, projectId, serviceAccount, serviceSecret, region }`.

**Always creates a fresh project.** Re-running mints a new project and overwrites
`credentials`. Auth for all four calls is the OAuth `BEARER_TOKEN`; the minted
service account is only written into the dungeon for later data sends.

## Prerequisites

`.env` at the repo root must contain (both are gitignored):

```
BEARER_TOKEN=<oauth token>   # creates projects / mints SAs / adds group keys
ORG_ID=<organization id>
```

If either is missing the orchestrator exits with a clear message — tell the user
to add them to `.env`.

User dungeons (`dungeons/user/`, `dungeons/customers/`, `dungeons/capstone/`) are
gitignored, so writing plaintext credentials into them is expected and safe.

## Steps

### 1. Show the plan (dry run)

```bash
node .claude/skills/create-project/provision.mjs <dungeon-path> --dry-run
```

This makes **no** API calls. It prints the derived project name, group-key
mapping, service-account name/expiry, and a business-context preview. Show this
to the user.

### 2. Confirm

Creating a real project + service account is outward-facing and not easily
undone. Confirm with the user before the live run (one line is enough).

### 3. Provision (live)

```bash
node .claude/skills/create-project/provision.mjs <dungeon-path>
```

On success it writes `credentials` back into the dungeon and prints a non-secret
summary (project URL + id, SA username/expiry, group keys added/skipped, context
size). Token and secret are written into the dungeon, not printed.

### 4. Report

Relay the project URL and confirm credentials were written. Point the user at the
run command:

```bash
node scripts/run-dungeon.mjs <dungeon-path>
```

## Metric handoff (v1.8.0)

Verify `standaloneEvents` and `warehouseMetrics` locally before provisioning.
Keep the verified run's disk files and record its explicit prefix. Cadence events
import through the normal send path; their synthetic `distinct_id` values must
never become people counts or identity-model evidence.

After credentials are written, route `warehouseMetrics` to `/warehouse-metrics`
with that prefix and `credentials.projectId`. Require local uncompressed table
files (`writeToDisk: true`, `gzip: false`) and the matching warehouse manifest.
Review the deploy dry run before obtaining consent for live writes. Project
provisioning alone does not load BigQuery tables or save warehouse metrics.

The pure `context.mjs` helper summarizes cadence, dimension keys and cardinalities,
property names, and synthetic identity separately from person events. Warehouse
summaries include sources, measures, grain, type, point-in-time baseline, history,
dimension and output columns, aggregation, and the separate deployment handoff.
It does not evaluate property functions or include config credentials.

## Provisioning errors

- **Missing `BEARER_TOKEN` / `ORG_ID`** — orchestrator exits; have the user fix `.env`.
- **`createProject` fails** — nothing is provisioned; surface the power-tools error (`{ error }` or `{ errors:[{param,message}] }`) verbatim and stop.
- **A later step fails** (mint / group keys / context / write-back) — the orchestrator continues, writes back whatever succeeded, and lists the failed step under `⚠ warnings`. Relay those warnings; the user may re-run or fix manually.

## Notes

- Region is always `US`; timezone is always `UTC` (matches the dungeon's UTC time window so Mixpanel day-bucketing aligns).
- Group keys come straight from the dungeon's `groupKeys` (`[["parent_account", N, []], …]`) — author them there (via `create-dungeon`) before running this skill.
- The orchestrator reuses the package's own exports (`loadFromFile`, `extractComments`) — no separate parser to keep in sync.
