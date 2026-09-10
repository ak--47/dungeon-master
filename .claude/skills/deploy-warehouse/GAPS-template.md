# Warehouse Metric CRUD Gap Report

Dungeon: {{DUNGEON_PATH}}
Warehouse dir: {{WAREHOUSE_DIR}}
Dataset: {{DATASET}}
Source id: {{SOURCE_ID}}

Note: {{NOTE}}

## Desired Powertools Contract

All under `/crud`, POST to execute, GET for docs, standard `client_id` / `region` body convention.

| Endpoint | Required | Notes |
|---|---|---|
| `createWarehouseMetric` | `project_id`, `source_id`, `name`, `sql` | Optional: `metric_type`, `value_column`, `time_column`, `aggregation`, `refresh`, `description` |
| `getWarehouseMetrics` | `project_id` | |
| `getWarehouseMetric` | `project_id`, `metric_id` | |
| `updateWarehouseMetric` | `project_id`, `metric_id`, `payload` | `source_id` is immutable; delete and recreate to rebind |
| `deleteWarehouseMetric` | `project_id`, `metric_id` | |
| `refreshWarehouseMetric` | `project_id`, `metric_id` | Cache invalidation only; does not execute the query |
| `previewWarehouseMetric` | `project_id`, `source_id`, `sql` | Returns rows; use before save because create does not validate SQL |

## Manual Notes

- `value_column` is required for every warehouse metric, including numeric ones.
- `source_id` must come from the actual `/macro/setup-bq-warehouse` response.
- `previewWarehouseMetric` rejects raw SQL containing `DROP`, `DELETE`, `TRUNCATE`, `ALTER`, `CREATE`, `INSERT`, or `UPDATE` as substrings.
- `created_at` and `updated_at` therefore fail preview unless the blocked text is removed from the query entirely.
- `refreshWarehouseMetric` invalidates cache only; it does not execute the query.

## Per-table Checklist

{{TABLE_CHECKLIST}}