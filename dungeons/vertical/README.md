# Vertical datasets — 22 fictional businesses for analytics evals

Each folder is one fictional company with four months of product analytics data
(events, user profiles, and sometimes group profiles and slowly changing
dimensions), two or three warehouse tables of business facts that are not in the
event stream, five context guides written like an internal wiki, and a
20-question eval with an answer key. The data hides 8-12 engineered business
stories per company. An analyst (human or LLM) with the guides and the data
should be able to find them.

This README is written for an agent that has access to every folder. Read it
first. It tells you what each file is, who may read it, how to load the data,
how to point a model at the context, and how to run the eval.

## The shared setup

| Property | Value |
| --- | --- |
| Companies | 22, one per vertical (table at the end) |
| Window | 2026-06-04 00:00:00 to 2026-10-01 23:59:59, UTC, 120 days |
| Users | 10,000 profiles per company: ~half existed before the window, ~half sign up inside it |
| Events | 0.66M-1.55M per company (~1.2 per user per day) |
| Time zone | Every timestamp is UTC (ISO 8601 with `Z`) |
| Determinism | Same engine version + same file = byte-identical data on any machine |
| Generator | `@ak--47/dungeon-master` 1.9.0 (unreleased at build time) |

All companies, people, and numbers are fictional. The guides never say so; they
are written from inside the company, on purpose.

## Folder layout

Two copies exist with the same files.

**Delivery copy** (`~/Desktop/dungeons/`), one folder per company:

```
<v>/
  context/   00-manifest.md 01-business.md 02-timeline.md 03-event-dictionary.md 04-metrics-and-tables.md
  data/      <v>-EVENTS.json.gz  <v>-USERS.json.gz  [<v>-<key>-GROUPS.json.gz]  [<v>-<prop>-SCD.json.gz]
             <v>-WAREHOUSE-<table>.json.gz (2-3)  <v>-WAREHOUSE-MANIFEST.json
  eval/      <v>.eval.md        20 questions + answer key
  source/    <v>.js             the generator config: every story, knob, and hook
  verify/    <v>.sql            DuckDB queries, one per story and one per eval question
             <v>.verify.mjs     machine-checked story verdicts
```

**Repo copy** (`dungeons/vertical/<v>/` in the dungeon-master repo): the same
`context/`, `eval/`, `<v>.js`, `<v>.sql`, and `<v>.verify.mjs`, with no `data/`.
Data is not committed; rebuild it as shown in "Rebuilding the data".

### Who may read what

| Folder | Analyst being evaluated | Grader / builder |
| --- | --- | --- |
| `context/` | yes | yes |
| `data/` | yes | yes |
| `eval/` | **no** (answer key) | yes |
| `source/` | **no** (states every story and its size) | yes |
| `verify/` | **no** (every query names a story) | yes |

The guides describe the business, the timeline, the events, and the metrics.
They hint at where to look but never state an engineered effect. The answers
live only in `eval/`, `source/`, and `verify/`.

## The data files

All data files are newline-delimited JSON, gzipped: one record per line.

| File | One row is | Key columns |
| --- | --- | --- |
| `<v>-EVENTS.json.gz` | one event | `event`, `time`, `user_id`, `device_id`, `insert_id`, event properties (flat, not nested), super properties |
| `<v>-USERS.json.gz` | one user profile | `distinct_id` (= `user_id`), profile properties, `created` (born users only), `anonymousIds` (the user's device ids) |
| `<v>-<key>-GROUPS.json.gz` | one group profile (company, org, community) | the group key (`company_id`, `org_id`, `community_id`) |
| `<v>-<prop>-SCD.json.gz` | one value change of a slowly changing user property | `distinct_id`, the property, `startTime` |
| `<v>-WAREHOUSE-<table>.json.gz` | one row of a business table (usually one day, sometimes one day per dimension) | see the manifest |
| `<v>-WAREHOUSE-MANIFEST.json` | table list with grain, time column, dimensions, and BigQuery column types | `tables[].columns[].bqType` (DATE, STRING, INT64, FLOAT64, BOOL) |

Groups exist for community, devtools, sass, social, and support-desk. SCD files
exist for fitness (`fitness_level`) and sass (`account_health`). The
`04-metrics-and-tables.md` guide of each company documents its warehouse tables.

### Identity: read this before you count users

The data follows Mixpanel's identity model.

- A user who existed before the window has `user_id` on every event.
- A user born in the window browses anonymously first. Events before their
  signup (the `isAuthEvent` step, for example `account created`) carry only
  `device_id`. This includes a pre-signup `$experiment_started` exposure.
- The signup event carries both `user_id` and `device_id`. Mixpanel uses it to
  merge the device's earlier anonymous events into the user. Events after
  signup carry `user_id` (and, in some companies, `device_id`).
- A born user who never signs up stays anonymous: `device_id` only on every
  event. Their profile is flagged and is not imported to Mixpanel.

Mixpanel does this join for you. **A warehouse does not.** Resolve identity
yourself before you count unique users or build funnels from anonymous steps:

```sql
-- DuckDB. Any event that carries both ids links that device to that user.
CREATE OR REPLACE VIEW device_map AS
SELECT device_id, min(user_id) AS user_id
FROM events
WHERE user_id IS NOT NULL AND device_id IS NOT NULL
GROUP BY device_id;

CREATE OR REPLACE VIEW events_resolved AS
SELECT coalesce(e.user_id, m.user_id, e.device_id) AS distinct_id, e.*
FROM events e
LEFT JOIN device_map m USING (device_id);
```

The profile file gives the same link: unnest `anonymousIds` against
`distinct_id`. Each `verify/<v>.sql` starts with the exact identity prelude for
that company.

## Load the data

### DuckDB (fastest; no schema work)

From inside one company folder:

```sql
-- duckdb
CREATE VIEW events   AS SELECT * FROM read_json_auto('data/*-EVENTS.json.gz',   sample_size=-1, union_by_name=true);
CREATE VIEW profiles AS SELECT * FROM read_json_auto('data/*-USERS.json.gz',    sample_size=-1, union_by_name=true);
-- one view per warehouse table, for example:
CREATE VIEW paid_acquisition_daily AS
  SELECT * FROM read_json_auto('data/*-WAREHOUSE-paid_acquisition_daily.json.gz');
SELECT event, count(*) FROM events GROUP BY 1 ORDER BY 2 DESC;
```

Cast `time` with `time::TIMESTAMP` (it is UTC). DuckDB reads `.gz` directly.

### BigQuery

```sh
V=fitness; DS=my_project:$V
bq mk --dataset "$DS"
bq load --source_format=NEWLINE_DELIMITED_JSON --autodetect "$DS.events"   data/$V-EVENTS.json.gz
bq load --source_format=NEWLINE_DELIMITED_JSON --autodetect "$DS.profiles" data/$V-USERS.json.gz
# warehouse tables: use the manifest's column types instead of autodetect
for T in $(jq -r '.tables[].table' data/$V-WAREHOUSE-MANIFEST.json); do
  SCHEMA=$(jq -r --arg t "$T" '.tables[] | select(.table==$t) | [.columns[] | "\(.name):\(.bqType)"] | join(",")' data/$V-WAREHOUSE-MANIFEST.json)
  bq load --source_format=NEWLINE_DELIMITED_JSON "$DS.$T" "data/$V-WAREHOUSE-$T.json.gz" "$SCHEMA"
done
```

Events have many sparse property columns. If autodetect fails on a column, load
with `--ignore_unknown_values` and a schema built from a DuckDB `DESCRIBE`, or
load into one JSON column and extract fields in SQL.

### Mixpanel

The events and profiles import as they are (`time` in UTC, `insert_id` is a
valid, deterministic dedupe id). Re-importing the same file into the same
project dedupes instead of doubling. Warehouse tables do not go to Mixpanel's
event store; connect them as warehouse metrics or keep them in the warehouse.

## Point a model at the context

Give the analyst model, in this order:

1. `context/00-manifest.md` — the map of the other four files and of the data.
2. `context/01-business.md` through `context/04-metrics-and-tables.md`.
3. Access to the data: a DuckDB or BigQuery connection with the views above, or
   a Mixpanel project with the data imported.

Do not give it `eval/`, `source/`, or `verify/`. Tell it the dataset window and
that time is UTC; the manifest says the same.

## Run the eval

Each `eval/<v>.eval.md` has a header and 20 questions. Every question has:

- **Prompt** — the text to send to the analyst model, as written.
- **Type** — trend, funnel, retention, segmentation, attribution,
  external-join (needs a warehouse table), context (needs the guides),
  null-hypothesis (the honest answer is "no meaningful effect"), or open-ended.
- **Answer** — the correct answer with exact numbers and an accepted tolerance.
- **Evidence** — the story id, a Mixpanel report recipe, and the
  `-- EVAL Q<n>` query in `verify/<v>.sql` that produced each number.
- **Context needed** — which guide files an analyst needs.
- **Grading** — what a correct answer must contain and the common wrong answers.

Procedure:

1. Start the analyst with only the context and data access (section above).
2. Send the 20 prompts one at a time, each in a fresh turn or session, so one
   answer does not leak into the next.
3. Grade each answer against **Answer** and **Grading**. Numbers inside the
   stated tolerance count as correct. A null-hypothesis question is correct only
   when the analyst says there is no meaningful effect. Score 1 (correct),
   0.5 (right direction or partial), or 0.
4. To check an answer key yourself, run the matching `-- EVAL Q<n>` query.

The eval header names the data prefix the numbers were measured on
(`data/verify-<v>` in the repo). The delivery copy's `data/<v>-*` files are the
same bytes under a different file name.

## Verify the stories yourself

SQL only (needs DuckDB, nothing else). From the company folder in the delivery
copy:

```sh
duckdb -c "SET VARIABLE data_prefix='data/<v>'" -c ".read verify/<v>.sql"
```

Every query is labeled `-- STORY H<n>-...` or `-- EVAL Q<n>`.

Machine verdicts (needs a dungeon-master checkout or the installed package): from
the repo root,

```sh
node dungeons/vertical/<v>/<v>.verify.mjs --data-prefix ~/Desktop/dungeons/<v>/data/<v>
```

It prints one verdict per story and fails unless every story is NAILED or
STRONG, every hook is covered, and every warehouse audit passes:

| Verdict | Meaning |
| --- | --- |
| NAILED | The measured effect sits inside a band derived from the story's knob (knob ±10%) |
| STRONG | The effect passes a knob-derived floor or ceiling; its exact size is confounded or noisy |
| WEAK | The effect points the right way but misses the floor |
| NONE / INVERSE | No effect, or the opposite effect |

## Rebuilding the data

From the dungeon-master repo root, on the engine version that built it:

```sh
node scripts/verify-runner.mjs dungeons/vertical/<v>/<v>.js verify-<v>   # plain JSON in ./data
node dungeons/vertical/<v>/<v>.verify.mjs                                 # verdicts
duckdb -c ".read dungeons/vertical/<v>/<v>.sql"                           # SQL checks
```

The gzipped delivery copy comes from `plans/verticals-reeval/export-desktop.mjs`
(local tooling, not in the package). Any engine change can shift the generated
data, so re-measure the eval numbers after an upgrade.

## The companies

COMPANY_TABLE
