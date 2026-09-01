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

## Step 0 — ask who creates the entities

**Ask the user before building.** The answer changes who owns every asset:

| Mode | Effect |
|---|---|
| **bearer** (recommended) | Entities are created by a real user via OAuth token (`BEARER_TOKEN` in the repo `.env`). They appear in that person's Mixpanel UI with owner access. |
| **service** | Entities are created by the dungeon's service account. A human then sees **"Your access: None"**, and custom properties have no share endpoint — so it cannot be fixed from the UI at all. Only correct when no OAuth token exists. |

Default to **bearer** whenever a token is available. To use it with
`mixpanel_headless`, set `MP_OAUTH_TOKEN` and **unset `MP_USERNAME` / `MP_SECRET`** —
the SDK prefers the service account whenever the full SA env set is present.
Power-tools calls must use the same principal (`Authorization: Bearer …`), or
entities created through that path land back under the service account.

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
│   ├── 00_auth_check.py         # also prints WHO is authenticated
│   ├── 01_reset_entities.py     # opt-in: delete this build's own entities
│   ├── 02_custom_props.py
│   ├── 03_cohorts.py
│   ├── 04_lexicon.py
│   ├── 05_dash_start_here.py    # built LAST — links the other boards by id
│   ├── 06..09_dash_<story>.py   # one board per engineered story
│   ├── 10_annotations.py
│   ├── 11_behaviors_metrics.py  # via power-tools; headless lacks these
│   ├── 13_render_check.py       # saved params must be RENDERABLE, not just queryable
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
- Day-granularity queries reject ranges **over 366 days**. `unit="hour"` works
  fine, including with `group_by` — that is how you read hour-of-day, since the
  App API rejects `hour(A)` in a custom-property formula as an unknown function.
- Valid `displayOptions.chartType`: `bar`, `column`, `frequency-curve`,
  `funnel-steps`, `funnel-top-paths`, `insights-metric`, `line`, `pie`,
  `retention-curve`, `table`. There is no `stacked-area` — the API rejects it.

**Filters and breakdowns fail SILENTLY, returning 0 rather than erroring.** Probe
every one before a board depends on it. Verified on Square:

| Intent | Wrong (returns 0 / "undefined") | Right |
|---|---|---|
| Profile property | `Filter.equals("plan", "Pro")` | `Filter.equals("plan", "Pro", resource_type="people")` |
| Profile property breakdown | `group_by="plan"` | not supported — one query per segment with a user-scoped `where` |
| Numeric event property | `Filter.equals("depth", 3)` | `Filter.equals("depth", "3")` — as a **string** |
| Boolean event property | `Filter.equals("flag", True)` | `Filter.is_true("flag")` / `Filter.is_false(...)` |
| Custom-property breakdown | `group_by="Ticket Band"` | `GroupBy(CustomPropertyRef(<id>))` |
| Sum of a property | `math="sum"` (raises) | `math="total"` **with** `math_property` |
| Flows, split by property | `query_flow(where=[Filter.equals(...)])` (raises `Invalid filter type: resourceType`) | cohort filters only — `query_flow(where=[Filter.in_cohort(...)])` |

**Querying successfully is NOT evidence that a report renders.** The single most
expensive bug in the Square build: `Filter.equals(..., resource_type="user")`
instead of `"people"`. The SDK's type is `Literal["events", "people"]`, but the
value is not validated, the query endpoint accepts it, and it returns byte-identical
numbers — so the build printed correct figures, `99_verify.py` re-measured the story
live and called it a MATCH, `query_saved_report` executed the saved bookmark without
complaint, and `get_dashboard_erf` reported `is_valid_for_erf: true`. Six dashboard
cards nonetheless rendered **"The client has issued a malformed request."** The
defect only existed in what was *persisted*: `sections.filter[0].resourceType`.

Two rules follow:

- **Never invent an enum value.** If the SDK declares a `Literal`, use one of its
  members even when another string is accepted and works.
- **Ship a render check.** `scripts/13_render_check.py` in the Square build walks
  every saved bookmark on every registered board and fails on any `resourceType`
  outside `{events, people, user_profiles, cohort}`. It runs as the first step of
  the `verify` phase, before `99_verify`. Inspect persisted params, not query
  results — every query-based check passed while the boards were visibly broken.

**Build the new board BEFORE deleting the old one.** The obvious `replace_dashboard`
(delete by title, then create) means any interruption — and a rate-limit wall
partway through a board's queries is routine — leaves the project with no board at
all. Capture the old ids first, create the replacement, then retire the old ones
(`existing_dashboard_ids` → `publish(..., supersedes=...)` in the Square `_common.py`).

**Budget the per-hour query cap across the whole session, not per run.** Probing,
building, and verifying all draw on the same hourly allowance. Interactive probes
early in a session can exhaust it and strand a rebuild hours later. Boards with
many segment-per-query funnels are the expensive ones — the Square activation board
alone fires ~30.

**Retention: cohort maturity will eat your effect.** `query_retention` pools every
cohort in the range, including ones a fortnight old that cannot yet have failed to
return in week 4, and there is no server-side way to restrict the cohort window.
On Square the same attach-retention gap read **1.71x pooled and 2.98x** over cohorts
with a fully observed horizon. Aggregate the frame yourself: weight buckets by cohort
size, require each bucket to be observed END TO END (`(b+1)*unit - 1` days of history,
not `b*unit`), and cap the cohort date. Put both numbers on the board — the diluted
one is what the chart shows, and naming why is a better demo than hiding it.

**Time-to-convert is a MEAN, and means are tail-dominated.** Funnel frames carry
`avg_time` and `avg_time_from_start` (seconds; not monotonic across steps — each is
over that step's own survivors). A dungeon knob expressed as a median ratio will not
reproduce: Square's designed 13x median gap measured 1.95x as a mean over a 30-day
window. Use the **speed curve** instead — run the same funnel at 1/3/7/14-day
conversion windows and read what share of each segment's eventual conversions had
landed by then. Same effect, expressed in a statistic Mixpanel actually computes.

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

**Board titles carry no app prefix.** The project is already the app; a
`"<App> — "` prefix on every board is noise that eats the readable part of the
name in the sidebar. Title them `Borough Equity & Access`, not
`NYC DCP — Borough Equity & Access`.

**Always label the legend.** By default a series reads
`Data Export [Total Events]` — it names the event and the math, not the thing
being measured. Mixpanel exposes this as **Rename** on a query block; on the
wire it is `params.sections.show[i].name` plus `userNamed: true` (the flag is
what stops the UI regenerating the label). Every insights report should pass a
plain-English label: `Users`, `Exports`, `Comments Filed`.

**Merge KPI cards into ONE multi-metric report.** Four big-number cards do not
need four saved reports. Each report is another entity to create and another
query to run, and the rate limit is the binding constraint on a full build.
Concatenate the `sections.show` arrays of several single-metric queries into one
params dict and keep `chart_type="insights-metric"` — Mixpanel still renders big
numbers, one per metric. Only safe when the inputs share a time range and
report-level filter, since `sections.filter` applies to the whole report; per-metric
filters have to move into `show[i].behavior.filters`.

**Share everything, and warm the cohorts.** Two separate failure modes:

- *Unshared* — an entity is visible only to its creator. Call
  `/crud/shareDash` (`view_only: false`) and `/crud/shareCohort`
  (`can_edit: true`) for everything you create. There is no share endpoint for
  custom properties, behaviors, or metrics — which is exactly why bearer auth
  matters: get the owner right at creation, because you cannot fix it after.
- *Unwarmed* — cohort membership computes **lazily**. A freshly created cohort
  reports `count: 0` until something queries it, and a cohort showing 0 members
  reads as broken in a demo. Run one cheap query per cohort after creating it.
  Verify counts, not just existence.

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

**`getCohorts` can report `count: 0` for every cohort** even when they hold thousands
of members and filter queries correctly. Do not use the listing's count as the
membership check in `99_verify.py` — run one cheap query per cohort instead. This is
the same call that warms them, so it costs nothing extra.

**`create_cohort` via headless 500s** on some projects; `CreateCohortParams.definition`
also wants `.to_dict()`, not the builder object. Use `/crud/createCohort` — see the
`powertools` skill for the payload shape and its limits (behavioral counts yes;
profile-property and behavior-nested property filters no).

**Rate limits will kill a full build midway.** A build fires several hundred
queries; the cap trips after the first couple of boards and the rest fail,
leaving a half-built project that still looks fine until you count the boards.
The client must therefore:

- **Issue one request at a time**, with a small fixed gap. Parallelism does not
  help and actively hurts — the cap is request-rate based, so concurrency only
  reaches the limit sooner and then every worker sits in backoff together.
- **Back off hard and genuinely exponentially** on 429: start ~30s, double, cap
  ~15 minutes, ~7 attempts. The cap is per-hour, so short retries just burn
  attempts without letting the window refill. Retry transient 502s the same way.
- **Be resumable.** Keep the entity registry on disk and reuse by name, so a
  killed build picks up where it stopped instead of duplicating.

On Mixpanel-internal projects `--internal` additionally sends the rate-limit
bypass headers. It is a no-op elsewhere and does *not* remove the need for
backoff — it supplements it.

**Fewer entities is a rate-limit strategy, not just tidiness.** Merging four KPI
cards into one multi-metric report removes three creates and three queries from
every build. Prefer one report with N metrics wherever the chart allows it.

**`ws._api_client` is lazy** — None immediately after construction. Force it via
`ws._get_api_client()` before patching request headers.

**Idempotency.** Dashboards: delete-by-title then recreate. Everything else:
look up by name and reuse. Re-running must never duplicate.

## Commands

```bash
cd dungeons/user/<name>/build
set -a && . ./.env && set +a

uv run --with mixpanel_headless python build_all.py --auth bearer        # recommended
uv run --with mixpanel_headless python build_all.py --auth service       # SA-owned assets
uv run --with mixpanel_headless python build_all.py --internal           # + rate-limit bypass
uv run --with mixpanel_headless python build_all.py --only reset --apply # wipe this build's entities
uv run --with mixpanel_headless python build_all.py --only dashboards verify
uv run --with mixpanel_headless python build_all.py --skip-lexicon
uv run --with mixpanel_headless python build_all.py --from-date 2026-04-18 --to-date 2026-08-17
uv run --with mixpanel_headless python scripts/99_verify.py              # verify only
```

Phases: `auth`, `reset` (opt-in only), `customprops`, `cohorts`, `lexicon`,
`entities`, `annotations`, `dashboards`, `verify`.

`reset` is never part of the default order — it deletes entities, and only ever
the ones this build created, matched by name. Use it when assets were created
under the wrong principal and must be recreated (there is no way to re-own an
existing custom property).
