-- ============================================================
-- logistics.js — v1.5.0 Hook Verification Queries
-- Score: NAILED (10/10)
-- ============================================================
--
-- v1.5.0 changes:
-- - isStrictEvent: false on inventory checked, integration connected,
--   report generated, stockout alert, purchase order created, alert configured.
-- - reentry: true on Order Fulfillment.
-- - HOOK 9 quantity boost: 1.25x → 1.4x (compensates for cohort population overlap
--   with persona event multipliers; sweet 5-15 inv-check users overlap mid-market
--   tier whose baseline POs are already small).
-- ============================================================


-- Hook 1: MONTH-END REPORTING SURGE
-- Pattern: bespoke (DuckDB) — day-of-month breakdown
-- Expected: days 28-31 reports avg ~2-2.5x report_pages vs mid-month
-- Mixpanel: Insights → report generated, Avg report_pages, breakdown by DOM
SELECT
  CASE WHEN EXTRACT(DAY FROM time::TIMESTAMP) >= 28 THEN 'month_end' ELSE 'mid_month' END AS bucket,
  COUNT(*) AS n, ROUND(AVG(report_pages), 0) AS avg_pages
FROM read_json_auto('data/verify-logistics-EVENTS.json', sample_size=-1, union_by_name=true)
WHERE event = 'report generated' AND report_pages IS NOT NULL
GROUP BY 1 ORDER BY 1;


-- Hook 2: RUSH ORDER PREMIUM
-- Pattern: bespoke (DuckDB) — priority breakdown on unit_cost
-- Expected: urgent priority ~1.5x unit_cost vs standard
-- Mixpanel: Insights → purchase order created, Avg unit_cost, breakdown by priority
SELECT priority, COUNT(*) AS n, ROUND(AVG(unit_cost), 0) AS avg_cost
FROM read_json_auto('data/verify-logistics-EVENTS.json', sample_size=-1, union_by_name=true)
WHERE event = 'purchase order created' AND unit_cost IS NOT NULL
GROUP BY priority ORDER BY avg_cost DESC;


-- Hook 3: REORDER ACCURACY BY TIER (NORMALIZED RATIO)
-- Pattern: bespoke (DuckDB) — stockout-to-inventory-check ratio by tier
-- Expected: enterprise ratio ~0.9x SMB ratio (10% reduction)
-- Mixpanel: Insights formula → stockout total / inventory checked total, breakdown by tier
WITH per_tier AS (
  SELECT u.company_tier,
    SUM(CASE WHEN e.event = 'stockout alert' THEN 1 ELSE 0 END) AS stockouts,
    SUM(CASE WHEN e.event = 'inventory checked' THEN 1 ELSE 0 END) AS checks
  FROM read_json_auto('data/verify-logistics-EVENTS.json', sample_size=-1, union_by_name=true) e
  JOIN read_json_auto('data/verify-logistics-USERS.json', sample_size=-1, union_by_name=true) u
    ON e.user_id = u.distinct_id
  GROUP BY u.company_tier
)
SELECT company_tier, stockouts, checks, ROUND(stockouts * 1.0 / NULLIF(checks, 0), 3) AS ratio
FROM per_tier ORDER BY ratio;


-- Hook 4: INTEGRATION COMPLETION DRIVES RETENTION
-- Pattern: bespoke (DuckDB) — behavioral cohort
-- Expected: 3+ integration users have ~2x+ reports per user
-- Mixpanel: Insights → report generated, Total per user, cohort filter on integration count
WITH per_user AS (
  SELECT user_id,
    COUNT(*) FILTER (WHERE event = 'integration connected') AS ic,
    COUNT(*) FILTER (WHERE event = 'report generated') AS rc
  FROM read_json_auto('data/verify-logistics-EVENTS.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
)
SELECT CASE WHEN ic >= 3 THEN 'big' ELSE 'rest' END AS bucket,
  COUNT(*) AS users, ROUND(AVG(rc), 2) AS avg_reports
FROM per_user GROUP BY 1 ORDER BY 1 DESC;


-- Hook 5: ALERT FATIGUE
-- Pattern: bespoke (DuckDB) — early vs late alerts for heavy-alert users
-- Expected: heavy-alert users (>30 alerts) have late alerts ~1.5-3x response_time vs early
-- Mixpanel: Insights → stockout alert, Avg response_time_hours, line by week, filter heavy users
WITH alerts AS (
  SELECT user_id, time, response_time_hours,
    ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY time) AS rn
  FROM read_json_auto('data/verify-logistics-EVENTS.json', sample_size=-1, union_by_name=true)
  WHERE event = 'stockout alert' AND response_time_hours IS NOT NULL
),
heavy_users AS (
  SELECT user_id FROM alerts GROUP BY user_id HAVING COUNT(*) > 30
)
SELECT CASE WHEN rn < 20 THEN 'early' ELSE 'late' END AS phase,
  COUNT(*) AS n, ROUND(AVG(response_time_hours), 1) AS avg_resp
FROM alerts WHERE user_id IN (SELECT user_id FROM heavy_users)
GROUP BY 1 ORDER BY 1;


-- Hook 6: TRIAL CHURN
-- Pattern: bespoke (DuckDB) — events per user by tier
-- Expected: trial tier event volume ~0.5x other tiers
-- Mixpanel: Retention → account created → any event, breakdown by company_tier
WITH user_counts AS (
  SELECT user_id, COUNT(*) AS n
  FROM read_json_auto('data/verify-logistics-EVENTS.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
),
users AS (SELECT distinct_id AS user_id, company_tier FROM read_json_auto('data/verify-logistics-USERS.json', sample_size=-1, union_by_name=true))
SELECT u.company_tier, COUNT(*) AS users, ROUND(AVG(COALESCE(c.n, 0)), 1) AS avg_events
FROM users u LEFT JOIN user_counts c USING (user_id)
GROUP BY u.company_tier ORDER BY avg_events;


-- Hook 7: ENTERPRISE PROFILES
-- Pattern: bespoke (DuckDB) — user-property breakdown
-- Expected: enterprise warehouse_count ~10, smb ~2 (5x ratio)
-- Mixpanel: Users → Avg warehouse_count, Avg employee_count, breakdown by company_tier
SELECT company_tier, COUNT(*) AS users,
  ROUND(AVG(warehouse_count), 1) AS avg_warehouses,
  ROUND(AVG(employee_count), 0) AS avg_employees
FROM read_json_auto('data/verify-logistics-USERS.json', sample_size=-1, union_by_name=true)
GROUP BY company_tier ORDER BY avg_warehouses DESC;


-- Hook 8: SMALL-BUSINESS CONVERSION DROP (Integration Setup funnel)
-- Pattern: funnelFrequency-style breakdown by tier
-- Expected: enterprise/mid_market ~1.5x+ funnel conversion vs small_business
-- Mixpanel: Funnels → integration connected → report generated → alert configured, breakdown by tier
WITH per_user AS (
  SELECT e.user_id,
    MIN(time) FILTER (WHERE event = 'integration connected') AS t1,
    MIN(time) FILTER (WHERE event = 'report generated') AS t2,
    MIN(time) FILTER (WHERE event = 'alert configured') AS t3
  FROM read_json_auto('data/verify-logistics-EVENTS.json', sample_size=-1, union_by_name=true) e
  GROUP BY e.user_id
),
users AS (SELECT distinct_id AS user_id, company_tier FROM read_json_auto('data/verify-logistics-USERS.json', sample_size=-1, union_by_name=true))
SELECT u.company_tier,
  COUNT(*) AS users,
  COUNT(*) FILTER (WHERE t3 > t2 AND t2 > t1) AS converters,
  ROUND(COUNT(*) FILTER (WHERE t3 > t2 AND t2 > t1) * 100.0 / COUNT(*), 1) AS pct
FROM per_user p JOIN users u USING (user_id)
WHERE t1 IS NOT NULL
GROUP BY u.company_tier ORDER BY pct DESC;


-- Hook 9: INVENTORY-CHECK MAGIC NUMBER
-- Pattern: bespoke (DuckDB) — sweet 5-15 inv checks → +40% PO quantity
-- Expected: sweet (5-15 checks) avg PO quantity ~1.15-1.4x lower (<5 checks) cohort
-- Mixpanel: Insights → purchase order created, Avg quantity, behavioral cohorts on inventory checked count
WITH per_user AS (
  SELECT user_id, COUNT(*) FILTER (WHERE event = 'inventory checked') AS ic
  FROM read_json_auto('data/verify-logistics-EVENTS.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
),
pos AS (
  SELECT e.user_id, e.quantity
  FROM read_json_auto('data/verify-logistics-EVENTS.json', sample_size=-1, union_by_name=true) e
  WHERE e.event = 'purchase order created' AND e.quantity IS NOT NULL
)
SELECT CASE WHEN p.ic BETWEEN 5 AND 15 THEN 'sweet' WHEN p.ic < 5 THEN 'lower' ELSE 'over' END AS bucket,
  COUNT(*) AS pos, ROUND(AVG(po.quantity), 0) AS avg_qty
FROM pos po JOIN per_user p USING (user_id)
GROUP BY 1 ORDER BY 1;


-- Hook 10: ONBOARDING TTC BY TIER (KNOWN MEASUREMENT GAP)
-- See dating.sql Hook 9 for the funnel-post limitation explanation.
WITH per_user AS (
  SELECT e.user_id,
    MIN(time) FILTER (WHERE event = 'account created') AS t1,
    MIN(time) FILTER (WHERE event = 'report generated') AS t2
  FROM read_json_auto('data/verify-logistics-EVENTS.json', sample_size=-1, union_by_name=true) e
  GROUP BY e.user_id
),
users AS (SELECT distinct_id AS user_id, company_tier FROM read_json_auto('data/verify-logistics-USERS.json', sample_size=-1, union_by_name=true))
SELECT u.company_tier,
  ROUND(MEDIAN(EXTRACT(EPOCH FROM (t2::TIMESTAMP - t1::TIMESTAMP)) / 3600), 2) AS median_ttc_hr
FROM per_user p JOIN users u USING (user_id)
WHERE t1 IS NOT NULL AND t2 > t1
GROUP BY u.company_tier ORDER BY median_ttc_hr;
