---
name: warehouse-metrics
description: 'Use when a completed warehouse dungeon needs its warehouse tables loaded into BigQuery and saved as Mixpanel warehouse metrics. Triggers: "deploy warehouse metrics", "load warehouse tables", "connect warehouse metric source", "save warehouse metrics", after a dungeon has already run.'
argument-hint: '[dungeon path, e.g. dungeons/user/acme/acme.js]'
model: claude-opus-4-6
effort: max
---

# Deploy Warehouse Tables and Metrics

Load the generated warehouse tables for a dungeon into BigQuery, connect the dataset to Mixpanel with the existing powertools macro, preview each metric SQL, and save the warehouse metrics when the CRUD endpoints are available.

**Dungeon file:** `$ARGUMENTS`

## What it does

The orchestrator is `.claude/skills/warehouse-metrics/deploy.mjs`. It works from the warehouse manifest emitted by a completed dungeon run.

1. Loads the dungeon with the package loader and requires `warehouseMetrics`.
2. Finds the latest warehouse manifest and table files, or uses `--data-prefix` when supplied.
3. Normalizes the BigQuery dataset name to `dm_<dungeon_name>`, unless `--dataset` overrides it.
4. Writes per-table SQL files under the dungeon's sibling `warehouse/` directory with `{{DATASET}}` already substituted for the dataset id. The metric SQL itself is fully qualified to `mixpanel-gtm-training.<dataset>.<table>`.
5. Runs a non-destructive `bq ls` preflight first so missing CLI or ADC fails before any write.
6. Probes `GET /crud/getWarehouseMetrics` first and, when available, lists metrics before any BigQuery writes so malformed list payloads or upstream 500s fail early.
7. Loads the tables into BigQuery with explicit schemas from the manifest, then reuses `.claude/skills/powertools/pt.mjs` to call `/macro/setup-bq-warehouse`. Do not reimplement that flow here. Only the macro performs the GCP-side IAM grant.
8. If the docs route 404s, the script still completes the BigQuery load and source setup, then writes `warehouse/GAPS.md` from the template for manual metric setup.
9. When the endpoint exists, it dedupes by `name`, previews SQL with `previewWarehouseMetric`, then saves new metrics with `createWarehouseMetric`.

## Flags

```bash
node .claude/skills/warehouse-metrics/deploy.mjs <dungeon-path> [--dataset dm_name] [--data-prefix path/prefix] [--dry-run]
```

- `--dataset`: override the normalized `dm_<name>` dataset.
- `--data-prefix`: explicit run artifact prefix, for example `/tmp/run/warehouse-demo` for `/tmp/run/warehouse-demo-WAREHOUSE-MANIFEST.json`.
- `--dry-run`: prints the full `bq ls`, docs probe, metric list, load, source, preview, and create plan without executing commands or requiring credentials. It still writes the SQL files and renders `warehouse/GAPS.md` for review.

## Preflight

- The dungeon must have passed `/verify-dungeon` and produced local warehouse
	files with `writeToDisk: true` and `gzip: false`. Use the exact verified
	`--data-prefix` and its matching `-WAREHOUSE-MANIFEST.json`; preserve all table
	files referenced by the manifest. Do not use blanket prune before deployment.
- Live mode requires `.env` `BEARER_TOKEN` for powertools.
- Live mode requires working `bq` / gcloud ADC.
- The dungeon must already have `credentials.projectId` from `/create-project`.
- The Power Tools runtime principal needs `roles/resourcemanager.projectIamAdmin`
	to grant project-level `roles/bigquery.jobUser`, and `roles/bigquery.admin`
	(or equivalent permissions) for dataset creation and ACL changes. The macro
	grants the Mixpanel principal `roles/bigquery.dataViewer` on the source dataset.
	Keep these prerequisites; do not describe IAM as currently blocked. The operator
	confirms the grant is fixed. Local Power Tools revision `7ae78aa` records the
	successful one-shot live path and legacy `READER`/`WRITER`/`OWNER` ACL fix.
	This audit used local evidence only and made no live calls.

## Warnings

- `bq load --replace` overwrites the destination table contents. Treat live execution as destructive for existing warehouse tables and get explicit user confirmation before running it.
- `createWarehouseMetric` does not validate SQL. This skill previews every query first so the summary means something.
- `source_id` is immutable on update. This flow is create-or-skip by metric name; it does not try to update a metric onto a new source.
- `refreshWarehouseMetric` only invalidates cache. It does not execute the query.

## Preview gotcha

`previewWarehouseMetric` rejects raw SQL containing `DROP`, `DELETE`, `TRUNCATE`, `ALTER`, `CREATE`, `INSERT`, or `UPDATE` as plain substrings. That means `created_at` trips `CREATE` and `updated_at` trips `UPDATE`.

This skill fails clearly in that case. It does not pretend preview succeeded. It also does not auto-rewrite the SQL. Aliasing only helps if the blocked text disappears from the query entirely. If the generated table uses one of those names, rename the column or finish the metric manually.

## Typical flow

### 1. Show the plan

```bash
node .claude/skills/warehouse-metrics/deploy.mjs <dungeon-path> --data-prefix <verified-prefix> --dry-run
```

Review the printed commands, the emitted SQL files, and the rendered `warehouse/GAPS.md`.

### 2. Confirm live execution

Live mode writes or replaces BigQuery tables and saves metrics into a real Mixpanel project. Confirm with the user before running it.

### 3. Run live

```bash
node .claude/skills/warehouse-metrics/deploy.mjs <dungeon-path> --data-prefix <verified-prefix>
```

### 4. Report

Relay:

- dataset loaded
- source id returned by `/macro/setup-bq-warehouse`
- metrics saved vs skipped by name
- SQL file paths
- whether `warehouse/GAPS.md` was written or an older one was intentionally left in place

## Error handling

- A missing manifest or missing warehouse files is a hard stop. Tell the user to run `node scripts/run-dungeon.mjs <dungeon>` first, or pass `--data-prefix`.
- A `GET /crud/getWarehouseMetrics` 404 is the only fallback. The script still loads tables and connects the source, then writes `warehouse/GAPS.md` instead of pretending metrics were saved.
- Any other docs probe error, `bq` failure, preview failure, or create failure surfaces immediately. No catch-and-continue.
- Existing `warehouse/GAPS.md` is never deleted silently. If a new one is written, the script says so. If CRUD is now available, the old file is left in place and reported as stale.