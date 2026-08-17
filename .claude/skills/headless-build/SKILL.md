---
name: headless-build
description: Use after a dungeon's data is loaded into a real Mixpanel project — builds the full demoable environment with mixpanel-headless (dashboards, charts, Lexicon, cohorts, custom properties, behaviors/metrics/formulas, annotations) targeted at that dungeon's engineered stories, then verifies the stories still read live. Final step after create-dungeon / write-hooks / verify-dungeon / create-project.
argument-hint: [dungeon path, e.g. dungeons/user/nyc-dcp/nyc-dcp.js]
model: claude-opus-4-6
effort: max
---

# Headless Build — turn a loaded project into a demo

Last step of the pipeline:

```
/create-dungeon → /write-hooks → /verify-dungeon → /create-project → /headless-build
```

The project already has data. This skill builds everything a human sees: themed
dashboards whose narrative is computed from the live data, an annotated Lexicon,
saved cohorts and custom properties, saved behaviors/metrics/formulas, and
annotations that explain the engineered moments. Then it re-measures the hook
stories **against the live project** and fails if they no longer read.

That last step is the point. Local story verification passes on the generated
array in memory; it never sees what survived ingest. A build can render five
perfect dashboards on top of a story that silently collapsed on the way in.

## Scope

In scope: dashboards + charts, Lexicon enrichment, cohorts, custom properties,
behaviors/metrics/formulas, annotations, and live story verification.

Out of scope: changing the dungeon, regenerating or re-sending data. If the data
is wrong, fix the dungeon and re-run `/create-project` — do not paper over it
with dashboard copy.

## Prerequisites

- The dungeon's `creds.json` / `credentials` block exists (`/create-project` ran).
- Data is actually loaded — `00_auth_check.py` fails loudly if not.
- `uv` available. `mixpanel_headless` is on PyPI, so it needs no local checkout:
  `uv run --with mixpanel_headless python <script>`.

## Reference implementation

`dungeons/user/nyc-dcp/build/` is the worked example — read it before writing a
new one. (It is gitignored with the rest of `dungeons/user/`, so it lives only in
the working copy.) Peloton's equivalent is
`/Users/ak/code/mixpanel-headless/ak/customer_peloton/`.

## Layout

Create the build inside the dungeon's own folder:

```
dungeons/user/<name>/build/
├── .env                    # MP_USERNAME / MP_SECRET / MP_PROJECT_ID / MP_REGION
├── _common.py              # window detection, ws factory + retry, helpers, knobs, cohorts
├── build_all.py            # one-shot orchestrator, --only / --internal / --from-date
├── scripts/
│   ├── 00_auth_check.py
│   ├── 02_custom_props.py
│   ├── 03_cohorts.py
│   ├── 04_lexicon.py
│   ├── 05_dash_start_here.py    # built LAST — links the other boards by id
│   ├── 06..09_dash_<story>.py   # one board per engineered story
│   ├── 10_annotations.py
│   ├── 11_behaviors_metrics.py  # via power-tools; headless lacks these
│   └── 99_verify.py
└── results/                # entities.json registry, window.json, verification_*.json
```

## Steps

### 1. Read the dungeon

Pull out, from the dungeon file itself: the `stories` export, the HOOK STORIES
doc block, the knob constants, the event/property schema, and the VALUE MOMENT.
**Mirror the knob constants into `_common.py`** so dashboard copy quotes the
designed value while the charts show the measured one. Never let narrative text
hardcode a number no longer tied to a knob.

### 2. Probe the project before designing

Capabilities differ per project. Run a throwaway probe and design around what
actually works. Verified on both NYC DCP and Peloton:

- Insights `group_by` / `where` / saved-cohort filters: **work**.
- Funnels `group_by`: **silently does not segment** — returns rows identical to
  ungrouped. Use one funnel per segment with a `where` filter instead.
- Day-granularity queries reject ranges **over 366 days**.
- Valid `displayOptions.chartType`: `bar`, `column`, `frequency-curve`,
  `funnel-steps`, `funnel-top-paths`, `insights-metric`, `line`, `pie`,
  `retention-curve`, `table`. There is no `stacked-area` — the API rejects it.

### 3. Auto-detect the data window

Never hardcode dates. A regenerated dungeon lands on new ones and every chart
silently clips. Probe wide at `unit="month"`, then resolve exact days inside the
non-empty months (day charts cap at 366 days). Cache to `results/window.json`.

### 4. Build entities, then boards

Order matters: custom properties and cohorts first (boards break down by them),
Lexicon, behaviors/metrics/formulas, annotations, then dashboards, with the
"Start Here" board last so it can link the others by id.

Keep a `results/entities.json` registry of every created id — the Start Here
board and the verifier both read it.

### 5. Write boards that argue, not just render

The difference between a dashboard and a demo:

- **Query first, then narrate.** Compute the numbers live, then interpolate them
  into text cards. Never write a number by hand.
- **One board per story**, plus a Start Here tour board.
- **Normalize rates.** Raw totals carry population and activity; the claim is
  almost always about intensity. Say which denominator you used and why.
- **Name the confound.** If a chart could be read two ways, put the alternative
  in the text card and say what rules it out.
- **End each board with a "So what"** — the decision the board supports.
- Text card HTML must be single-line (`" ".join(html.split())`) — TipTap mangles
  newlines.

### 6. Verify against the live project

`99_verify.py` does two checks:

- **structure** — every registered entity still exists.
- **stories** — re-measure each hook effect live and compare to the knob.

Report MATCH / DIRECTIONAL / MISS per story and exit non-zero on any MISS.
Use a wider tolerance than the dungeon's own ±10% bar (~25%): Mixpanel's cohort
membership is computed over the whole window, not the dungeon's internal binning,
so depth-band style cohorts will not line up exactly.

### 7. Report

Give the user the board URLs
(`https://mixpanel.com/project/<pid>/view/<wsid>/app/boards/<id>`), the entity
counts, and the story verdict table.

## Gotchas that cost real time

**Saved cohort ids, never inline definitions.** `Filter.in_cohort(CohortDefinition(...))`
is accepted and applied, but every definition collapses to the same membership —
three different cohorts return byte-identical numbers instead of erroring. Create
cohorts first, then filter by id: `Filter.in_cohort(<saved_id>, "<name>")`.

**`create_cohort` via headless 500s** on some projects; `CreateCohortParams.definition`
also wants `.to_dict()`, not the builder object. Use `/crud/createCohort` — see the
`powertools` skill for the payload shape and its limits (behavioral counts yes;
profile-property and behavior-nested property filters no).

**Rate limits will kill a full build midway.** A build fires several hundred
queries; the cap trips after the first couple of boards and the rest fail,
leaving a half-built project that still looks fine until you count the boards.
Always install retry-with-backoff around every query method (20s, doubling, cap
300s, ~5 attempts) and retry transient 502s the same way. On Mixpanel-internal
projects `--internal` additionally sends the bypass headers — it is a no-op
elsewhere, so it supplements backoff rather than replacing it.

**`ws._api_client` is lazy** — None immediately after construction. Force it via
`ws._get_api_client()` before patching request headers.

**Idempotency.** Dashboards: delete-by-title then recreate. Everything else:
look up by name and reuse. Re-running must never duplicate.

## Commands

```bash
cd dungeons/user/<name>/build
set -a && . ./.env && set +a

uv run --with mixpanel_headless python build_all.py                      # everything
uv run --with mixpanel_headless python build_all.py --internal           # + rate-limit bypass
uv run --with mixpanel_headless python build_all.py --only dashboards verify
uv run --with mixpanel_headless python build_all.py --skip-lexicon
uv run --with mixpanel_headless python build_all.py --from-date 2026-04-18 --to-date 2026-08-17
uv run --with mixpanel_headless python scripts/99_verify.py              # verify only
```

Phases: `auth`, `customprops`, `cohorts`, `lexicon`, `entities`, `annotations`,
`dashboards`, `verify`.
