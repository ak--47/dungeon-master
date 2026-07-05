-- ============================================================
-- logistics.js — v1.6 human-inspection queries (DuckDB)
--
-- Every query is keyed to a story id in logistics.js's `stories` export;
-- the machine-checked verdicts come from:
--   node scripts/verify-stories.mjs dungeons/vertical/logistics/logistics.js --data-prefix verify-logistics
-- Generate first:
--   node scripts/verify-runner.mjs dungeons/vertical/logistics/logistics.js verify-logistics
-- Run this file:
--   duckdb -c ".read dungeons/vertical/logistics/logistics.sql"
-- ============================================================

-- ── identity-resolution prelude ─────────────────────────────
-- avgDevicePerUser: 2 + account created is both isAuthEvent and
-- isFirstEvent, so born users auth on their first event; the device-pool
-- resolve is belt-and-braces for any device-only edge.
CREATE OR REPLACE VIEW users AS
SELECT * FROM read_json_auto('data/verify-logistics-USERS*.json', sample_size=-1, union_by_name=true);

CREATE OR REPLACE VIEW device_map AS
-- profiles store the device pool under the legacy "anonymousIds" key
SELECT unnest("anonymousIds") AS device_id, distinct_id FROM users;

CREATE OR REPLACE VIEW ev AS
-- ::VARCHAR casts — user_id sniffs as UUID, device_id as VARCHAR; DuckDB
-- refuses to coalesce mixed types
SELECT coalesce(m.distinct_id::VARCHAR, e.user_id::VARCHAR, e.device_id::VARCHAR) AS uid,
       e.time::TIMESTAMP AS t,
       e.*
FROM read_json_auto('data/verify-logistics-EVENTS*.json', sample_size=-1, union_by_name=true) e
LEFT JOIN device_map m ON e.device_id = m.device_id;

-- Per-user counts. Inventory checks are ONE-SIDED (only H6 deletes them,
-- for trial users, and H9 reads them AFTER H6 ran) — output counts equal
-- H9's hook-time counts exactly. POs are deleted only for 16+ checkers
-- (H9); stockout alerts only for enterprise (H3); clones are identified
-- by report_type = 'integration_summary' (outside the organic pool).
CREATE OR REPLACE VIEW per_user AS
SELECT uid,
  count(*) AS total,
  count(*) FILTER (WHERE event = 'inventory checked') AS inv,
  count(*) FILTER (WHERE event = 'purchase order created') AS po,
  count(*) FILTER (WHERE event = 'stockout alert') AS so,
  count(*) FILTER (WHERE event = 'integration connected') AS ic,
  count(*) FILTER (WHERE event = 'report generated' AND report_type = 'integration_summary') AS clones,
  min(t) AS first_t
FROM ev GROUP BY 1;


-- ── H1-month-end-pages ──────────────────────────────────────
-- Reports on calendar days >= 28 get report_pages ×2.5 (floored). H4's
-- clones (report_type 'integration_summary', uniform [5,25] pages stamped
-- AFTER H1) dilute a pooled read — exclude them; they are the placebo arm.
SELECT (report_type = 'integration_summary') AS is_clone,
  CASE WHEN extract(day FROM t) >= 28 THEN 'month_end' ELSE 'mid_month' END AS bucket,
  count(*) AS n, round(avg(report_pages), 1) AS avg_pages
FROM ev WHERE event = 'report generated'
GROUP BY 1, 2 ORDER BY 1, 2;
-- read: organic month_end/mid_month ≈ 2.4-2.5 (floor loss ~1%);
--       clone ratio ≈ 1.0 (placebo)


-- ── H2-rush-order-premium ───────────────────────────────────
-- 'urgent' POs get unit_cost ×1.5 (floored); 'expedited' is untreated.
SELECT priority, count(*) AS n, round(avg(unit_cost), 1) AS avg_cost
FROM ev WHERE event = 'purchase order created'
GROUP BY 1 ORDER BY 1;
-- read: urgent/standard ≈ 1.5; expedited/standard ≈ 1.0 (placebo)


-- ── H3-stockout-by-tier ─────────────────────────────────────
-- Enterprise loses 10% of stockout alerts. Per-user LEVELS are dominated
-- by persona multipliers (enterprise 5x) — read the stockout-per-
-- inventory-check ratio instead; the supply-chain worldEvent (×3, days
-- 35-40) hits all tiers alike and cancels cross-tier.
SELECT u.company_tier AS tier, count(*) AS users,
  round(sum(p.so)::DOUBLE / sum(p.inv), 4) AS so_per_inv
FROM per_user p JOIN users u ON u.distinct_id::VARCHAR = p.uid
GROUP BY 1 ORDER BY 1;
-- read: enterprise/small_business ≈ 0.88; mid_market/small_business ≈ 1.0


-- ── H4-integration-reports ──────────────────────────────────
-- Users with >= 3 'integration connected' get a cloned 'report generated'
-- per integration at 65% (+1-5d later, report_type 'integration_summary').
-- H6 (the only integration-deleter) runs BEFORE H4 → output counts equal
-- H4's hook-time counts exactly; the treated cohort is fully recoverable.
SELECT (p.ic >= 3) AS treated, count(*) AS users,
  round(sum(p.clones)::DOUBLE / nullif(sum(p.ic), 0), 4) AS clones_per_integration,
  round(avg((p.clones > 0)::INT), 4) AS any_clone_share
FROM per_user p GROUP BY 1 ORDER BY 1;
-- read: treated clones_per_integration ≈ 0.63 (0.65 × ~2% future-guard
--       loss); untreated any_clone_share = 0 (structural — leakage would
--       mean the hook-order invariant broke)


-- ── H5-alert-fatigue ────────────────────────────────────────
-- Users with > 30 stockout alerts: response_time_hours scaled from alert
-- index 20 on, ×(1.5 + 1.5×(idx-20)/n). Hook index = record order; time
-- order matches exactly (iteration placebo 1.000). Control = 20-30-alert
-- users (never treated, same iid response_time pool).
WITH al AS (
  SELECT uid, response_time_hours AS rt,
    row_number() OVER (PARTITION BY uid ORDER BY t) - 1 AS idx,
    count(*) OVER (PARTITION BY uid) AS n
  FROM ev WHERE event = 'stockout alert'
)
SELECT arm, count(DISTINCT uid) AS users, round(avg(rt), 2) AS avg_rt FROM (
  SELECT uid, rt, 'late_treated' AS arm FROM al WHERE n > 30 AND idx >= 25
  UNION ALL
  SELECT uid, rt, 'early_untreated' FROM al WHERE n > 30 AND idx <= 14
  UNION ALL
  SELECT uid, rt, 'control_20_30' FROM al WHERE n BETWEEN 20 AND 30
) GROUP BY 1 ORDER BY 1;
-- read: late_treated/control ≈ 2.0; early_untreated/control ≈ 1.0


-- ── H6-trial-churn ──────────────────────────────────────────
-- Trial-tier users lose 50% of events after day 7 from first event
-- (v1.6 behavior change: v1.5 keyed on record.length < 10 — matched ~0.9%
-- of users, never touched trials). Cross-tier levels are incomparable
-- (activeWindow 14d, 0.4x multiplier) — read each tier's own
-- rate(day 8-13)/rate(day 1-6); the ratio cancels the level.
WITH fe AS (SELECT uid, min(t) AS f FROM ev GROUP BY 1),
rd AS (SELECT e.uid, date_diff('day', fe.f, e.t) AS d FROM ev e JOIN fe ON fe.uid = e.uid)
SELECT u.company_tier AS tier, count(DISTINCT r.uid) AS users,
  round(count(*) FILTER (WHERE d BETWEEN 8 AND 13)::DOUBLE
      / count(*) FILTER (WHERE d BETWEEN 1 AND 6), 4) AS wk2_over_wk1
FROM rd r JOIN users u ON u.distinct_id::VARCHAR = r.uid
GROUP BY 1 ORDER BY 1;
-- read: trial ratio ≈ 0.5 × small_business ratio (DiD ≈ 0.55);
--       mid_market ≈ small_business (placebo)


-- ── H7-enterprise-profiles ──────────────────────────────────
-- user hook overwrites warehouse_count/employee_count per tier with
-- disjoint uniform ranges. Personas cover 100% of users → ranges EXACT.
SELECT company_tier AS tier, count(*) AS users,
  min(warehouse_count) AS min_wh, max(warehouse_count) AS max_wh,
  min(employee_count) AS min_emp, max(employee_count) AS max_emp
FROM users GROUP BY 1 ORDER BY 1;
-- read: enterprise wh [5,15] emp [200,2000]; mid_market wh [2,6]
--       emp [20,200]; small_business wh [1,3] emp [5,80];
--       trial wh = 1 emp [1,10] — zero out-of-range rows


-- ── H8-smb-conversion-drop ──────────────────────────────────
-- small_business loses 35% of 'alert configured' — last step of
-- Integration Setup. CAUTION: cross-event SQL step-pairing here is the
-- documented greedy-single-pass limitation; the story asserts conversion
-- through the emulator (timeToConvert, 48h treated / 336h Supplier
-- Management placebo). This query shows the RAW event-count shadow only.
SELECT u.company_tier AS tier,
  count(*) FILTER (WHERE e.event = 'report generated') AS step2_events,
  count(*) FILTER (WHERE e.event = 'alert configured') AS step3_events,
  round(count(*) FILTER (WHERE e.event = 'alert configured')::DOUBLE
      / count(*) FILTER (WHERE e.event = 'report generated'), 4) AS ac_per_rg
FROM ev e JOIN users u ON u.distinct_id::VARCHAR = e.uid
WHERE u.company_tier IN ('small_business', 'mid_market')
GROUP BY 1 ORDER BY 1;
-- read: smb ac_per_rg depressed vs mid_market (raw shadow of the 35% drop;
--       trust the story's emulator verdict for the funnel-conversion read)


-- ── H9-inventory-magic-number ───────────────────────────────
-- Sweet 5-15 inventory checks → PO quantity ×1.4; 16+ checks → 60% of POs
-- dropped. Value read: quantity is an iid pool draw — sweet/low mean ratio
-- reads the knob; unit_cost is the placebo.
SELECT CASE WHEN p.inv BETWEEN 5 AND 15 THEN 'sweet' WHEN p.inv <= 4 THEN 'low' END AS arm,
  count(DISTINCT p.uid) AS users,
  round(avg(e.quantity), 1) AS avg_qty, round(avg(e.unit_cost), 1) AS avg_cost
FROM per_user p JOIN ev e ON e.uid = p.uid AND e.event = 'purchase order created'
WHERE p.inv <= 15
GROUP BY 1 ORDER BY 1;
-- read: sweet/low avg_qty ≈ 1.4; avg_cost ≈ 1.0 (placebo)

-- volume read: PO count is activity-coupled → no cross-arm level works.
-- Read PO-per-inventory-check within small_business only (constant
-- conversionModifier), treated cliff bin 16-23 vs adjacent untreated
-- 12-15, with a flatness guard on the pre-cliff bins.
SELECT CASE WHEN p.inv BETWEEN 4 AND 7 THEN 'b04_07'
            WHEN p.inv BETWEEN 8 AND 11 THEN 'b08_11'
            WHEN p.inv BETWEEN 12 AND 15 THEN 'b12_15'
            WHEN p.inv BETWEEN 16 AND 23 THEN 'b16_23'
            WHEN p.inv BETWEEN 24 AND 40 THEN 'b24_40' END AS bin,
  count(*) AS users, round(sum(p.po)::DOUBLE / sum(p.inv), 4) AS po_per_inv
FROM per_user p JOIN users u ON u.distinct_id::VARCHAR = p.uid
WHERE u.company_tier = 'small_business' AND p.inv BETWEEN 4 AND 40
GROUP BY 1 ORDER BY 1;
-- read: pre-cliff bins flat (~1.6, mild organic decline), then
--       b16_23/b12_15 ≈ 0.4 × organic gradient [0.83, 1.0] ≈ 0.37


-- ── H10-onboarding-ttc ──────────────────────────────────────
-- funnel-post scales Onboarding inter-step gaps: enterprise ×0.71,
-- small_business/trial ×1.3, mid_market untouched (v1.6 scopes the hook
-- to Onboarding only). CAUTION: cross-event TTC SQL is the documented
-- greedy-single-pass limitation — it pairs steps across funnel instances
-- and buries the signal. The story asserts TTC through the emulator
-- (timeToConvert, 93.6h window = 72h generative × 1.3 max stretch);
-- trust the story verdict, not ad-hoc pair SQL. Only born-in-dataset
-- users (~12%) have 'account created' in-window — cohort sanity below.
SELECT u.company_tier AS tier, count(*) AS account_created_events
FROM ev e JOIN users u ON u.distinct_id::VARCHAR = e.uid
WHERE e.event = 'account created' GROUP BY 1 ORDER BY 1;
