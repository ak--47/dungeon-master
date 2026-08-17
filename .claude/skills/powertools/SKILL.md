---
name: powertools
description: Use when any task needs the Mixpanel Power Tools API ("use powertools") — schema export (get-schema), event volumes, project CRUD, query methods, macros, or snapshotting a prod project's schema to copy it into a dungeon. Companion to create-project (which handles provisioning specifically).
argument-hint: [what to do, e.g. "get schema for project 12345" or "copy project 12345 into a dungeon"]
---

# Power Tools API

Base URL: `https://mixpanel-power-tools-api-lmozz6xkha-uc.a.run.app`

## Auth model — read this first

- **GET any endpoint path = documentation, no auth.** Always `curl -s GET <base><path>` before first use of an unfamiliar endpoint — docs include exact body params and response shapes.
- **POST = execute.** `Authorization: Bearer <oauth-token>` (employee OAuth from repo `.env` `BEARER_TOKEN`, or a customer's OAuth token) or `Basic base64(service_acct:secret)`.
- **Customer OAuth tokens are accepted** (verified 2026-07-06): `/auth` and `/macro/get-schema` work with a customer token on projects that token can access. `ai_endpoints_allowed: false` for non-employees — the `ai-*` family stays employee-only.
- **Every POST body** should include `client_id: "dungeon-master"` and `region` (`US` default).
- **`/auth` accessibility ≠ data access.** `/auth {project_id}` can report `accessible: true` while `get-schema`/`query/*` on the same project return `HTTP 403: Forbidden` (token lacks data-level access, e.g. an employee token on a customer project). Diagnose with `/auth`, but don't trust it for data endpoints. Prefer the token of an actual project member.

## Tools in this skill

### `pt.mjs` — ad-hoc client

```bash
node .claude/skills/powertools/pt.mjs <path> ['<json-body>'] [--bearer <token>] [--get] [--region US]
# examples
node .claude/skills/powertools/pt.mjs /auth '{}'
node .claude/skills/powertools/pt.mjs /macro/get-schema '{"project_id":"123","include_metadata":true,"verbose":true}'
node .claude/skills/powertools/pt.mjs /query/getTopEvents --get          # docs, no auth
```

Bearer defaults to `.env` `BEARER_TOKEN`. Merges `client_id`/`region` into the body. Prints pretty JSON to stdout.

### `snapshot-project.mjs` — schema + relative-volume snapshot

```bash
node .claude/skills/powertools/snapshot-project.mjs <project_id> --bearer <token> \
  [--region US] [--out snapshot.json]
```

- Uses `/macro/get-schema` (`include_metadata` + `verbose`) + `/query/getTopEvents`. Token (customer or employee) needs data access to the project.
- Output shape: `{ projectId, projectName, fetchedAt, totalCount, events: [{ name, count, pct, properties: [{name, type, description}] }], userProps: [{name, type, description}], groups: {} }`, events sorted by count desc.
- **Never captures property values** — schema + volumes only. Snapshots stay privacy-safe by construction.

## Endpoint catalog (the useful subset)

GET the path for full docs. Full list: GET `/` and GET `/macro`.

**crud** — 187 endpoints. GET `/crud` for the full list.

*Project lifecycle* (used by create-project's `provision.mjs`): `/crud/createProject`, `/crud/deleteProject` (**irreversible** — deletes the project and all its data; needs `org_id`), `/crud/getProjects`, `/crud/mintServiceAccount`, `/crud/deleteServiceAccount`, `/crud/addGroupKey`, `/crud/deleteGroupKey`, `/crud/setBusinessContext`.

*Analysis entities* (used by the `headless-build` skill for what `mixpanel_headless` does not expose): `/crud/createCohort` + `getCohorts`/`getCohort`/`updateCohort`/`deleteCohort`, `/crud/createBehavior` + `getBehaviors`/`deleteBehavior`, `/crud/createMetric` + `getMetrics`/`deleteMetric`, `/crud/createFormula` + `getFormulas`/`deleteFormula`, `/crud/createDash`/`updateDash`/`pinDash`/`duplicateDash`, `/crud/makeInsightsReport`/`makeFunnelsReport`/`makeFlowsReport`/`makeRetentionReport`, `/crud/createCustomProp`, `/crud/createCustomEvent`, `/crud/createAnnotation`, `/crud/createLookupTable`.

### Entity-CRUD response shapes (verified 2026-08-17 — these bite)

Three different shapes across one API family. Assuming a flat list or a flat `results.id` silently yields `None`/empty rather than erroring:

- **create** returns `{"status":"ok","results":{"<id>":{...}}}` — `results` is keyed BY id, so `results["id"]` is None. Take `next(iter(results.values()))["id"]`.
- **list** (`getBehaviors`/`getMetrics`/`getFormulas`) returns numerically-keyed entries at the **top level** — `{"0":{...},"1":{...},"duration_ms":…}` — with nothing under `results`. Iterate `raw.values()` and keep dicts that carry a `name`+`id`.
- `getMetrics` and `getFormulas` return the **same combined set** (metrics and formulas share one store), so dedupe by name if you call both.

### Cohort payload limits (verified on project 4054934)

`/crud/createCohort` accepts the native UI shape: `groups[]` of `cohort_group` (each `{type, event:{resourceType:"cohort",value:"$all_users"}, filters[]}`) plus `determiner: "all"|"any"`. What works and what does not:

- ✅ behavioral counts — `customProperty.behavior` + `filterOperator: "is at least"|"is at most"`; multiple filters in one group give a RANGE; multiple groups give AND (`all`) / OR (`any`).
- ❌ profile-property filters, and property filters nested inside a `behavior` — both fail with `Failed to resolve cohort references`. Express those as report `where` filters instead.
- New cohorts report `count: 0` at creation; membership computes asynchronously.

**query** — `/query/getTopEvents` (per-event counts, limit≤100 default), `/query/getEventNames`, `/query/getPropertyValues`, `/query/getTopProperties`, `/query/getSegmentation`, `/query/getFunnel`, `/query/listFunnels`, `/query/listCohorts`, `/query/runJQL`. Rate limits: 5 concurrent / 60 per hour; 1h response cache.

**macros** — `/macro/get-schema` (always pass `include_metadata: true, verbose: true`; also `include_density: true` for per-(event,property) coverage % and `include_sdk_defaults: true` to keep `$browser`/`$os`-style SDK props — needed for carbon copies), `/macro/analyze-project` (volumes + cardinality + activity), `/macro/enumerate-project`, `/macro/clone-project`, `/macro/clone-boards`, `/macro/delete-entities`, `/macro/dungeon-master` (runs a dungeon config server-side and ingests), `/macro/ai-e2e-dm4` (demo build from a supplied schema, designed for dungeon-master), plus the `ai-*` family (dashboards, cohorts, metrics, schema naming).

### get-schema field notes (verified on a 2,410-event project, 2026-07-06)

- Response nests under `json`: `{ json: { events, properties, users, groups, dependencies }, duration_ms }`. Large projects are slow — 2,410 events took ~13 min; run it in the background.
- Event counts include custom events (`customEventId > 0`) and merged events. Filter `!merged && !(customEventId > 0)` to match the Lexicon UI event count.
- `properties` includes `mp_*` internals and `$custom_property:<id>` computed-prop references — exclude both when authoring a dungeon (ingestion stamps `mp_*` itself; computed props can't be tracked).
- `exampleValue` fields contain REAL customer values — never copy them into a dungeon.
- **Known issue**: `dependencies` can come back empty (`{events:{},properties:{}}`) on large projects even with `verbose: true` + `include_density: true` — the bulk dependency call silently fails. Retry the call; per-event property mapping is unavailable until it succeeds.

## Recipe: copy a prod project into a dungeon

Goal: a purely synthetic dungeon with the same events/props/user-props and matching **relative** event volumes. Safe to share — no customer data.

1. **Snapshot** the source project (`snapshot-project.mjs`, customer token unless the employee token has data access). Sanity-check event count + that counts are non-zero.
2. **Author the dungeon** from the snapshot (schema-first, per repo hook rules):
   - Take the top-N events covering ≥95% of total volume (`pct` cumsum); note dropped tail in the OVERVIEW comment.
   - `weight` per event ∝ snapshot `count` (normalize so max ≈ 100, min ≥ 1).
   - Properties per event from snapshot; **invent all values** from name/type/description — never copy real values.
   - `userProps` from snapshot; shared high-frequency props → `superProps`.
   - Funnels: best-effort from event-name semantics (or `/query/listFunnels` + `/query/getFunnel` on the source if accessible).
3. **Provision** into our org via the create-project skill: `node .claude/skills/create-project/provision.mjs <dungeon> --dry-run` → confirm → live. Uses `.env` `BEARER_TOKEN` + `ORG_ID`, writes `credentials` back into the dungeon.
4. **Run**: `node scripts/run-dungeon.mjs <dungeon>`.
5. **Verify** relative volumes: top-10 generated events should rank in the same order as the snapshot's top-10.
