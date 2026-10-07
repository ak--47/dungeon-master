-- Routewise Freight (logistics vertical) — story-keyed and eval-keyed DuckDB queries.
--
-- Generate first (repo root):
--   node scripts/verify-runner.mjs dungeons/vertical/logistics/logistics.js verify-logistics
-- Run:
--   duckdb -c ".read dungeons/vertical/logistics/logistics.sql"
-- Against a gzipped export:
--   duckdb -c "SET VARIABLE data_prefix='<dir>/logistics'" -c ".read logistics.sql"
--
-- All times are UTC. Window: 2026-06-04 00:00 to 2026-10-01 23:59:59.

SET VARIABLE data_prefix = COALESCE(getvariable('data_prefix'), 'data/verify-logistics');

-- ─────────────────────────────────────────────────────────────────────────
-- PRELUDE: raw files, identity resolution, warehouse tables
-- ─────────────────────────────────────────────────────────────────────────
-- Identity: a new shipper signs up with "account created" (the auth event,
-- which carries user_id and device_id). A device resolves to the shipper seen
-- with it on any event that carries both ids, the way Mixpanel stitches.
-- Every Routewise event carries user_id (carrier and billing events carry
-- user_id only), so uid = user_id in practice.

CREATE OR REPLACE TEMP TABLE raw_events AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-EVENTS*.json*', sample_size=-1, union_by_name=true);

CREATE OR REPLACE TEMP TABLE users AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-USERS*.json*', sample_size=-1, union_by_name=true);

CREATE OR REPLACE TEMP TABLE device_map AS
SELECT device_id, min(user_id::VARCHAR) AS mapped
FROM raw_events WHERE user_id IS NOT NULL AND device_id IS NOT NULL GROUP BY 1;

CREATE OR REPLACE TEMP TABLE ev AS
SELECT coalesce(e.user_id::VARCHAR, m.mapped) AS uid, e.time::TIMESTAMP AS t, e.*
FROM raw_events e LEFT JOIN device_map m ON e.device_id = m.device_id;

CREATE OR REPLACE TEMP TABLE wh_market AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-spot_market_rates_daily.json*', sample_size=-1, union_by_name=true);
CREATE OR REPLACE TEMP TABLE wh_margin AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-load_margin_daily.json*', sample_size=-1, union_by_name=true);
CREATE OR REPLACE TEMP TABLE wh_paid AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-paid_marketing_daily.json*', sample_size=-1, union_by_name=true);

-- profile attributes keyed by the resolved shipper id
CREATE OR REPLACE TEMP TABLE prof AS
SELECT distinct_id::VARCHAR AS uid, company_tier, industry, primary_equipment, home_region, acquisition_channel,
 customer_since, saved_lanes, payment_terms, (created IS NOT NULL) AS new_shipper, "Experiment: Instant Book" AS variant
FROM users;

-- new-shipper signups, credit application and approval within 7 days
CREATE OR REPLACE TEMP TABLE signups AS
WITH s AS (SELECT uid, t AS t0, acquisition_channel AS ch FROM ev WHERE event = 'account created'),
a AS (SELECT s.uid, bool_or(e.event = 'credit approved' AND e.t >= s.t0 AND e.t < s.t0 + INTERVAL 7 DAY) AS approved_7d,
  bool_or(e.event = 'credit application submitted' AND e.t >= s.t0 AND e.t < s.t0 + INTERVAL 7 DAY) AS applied_7d
  FROM s JOIN ev e ON e.uid = s.uid AND e.event IN ('credit approved', 'credit application submitted') GROUP BY 1)
SELECT s.uid, s.t0, s.ch, coalesce(a.approved_7d, false) AS approved_7d, coalesce(a.applied_7d, false) AS applied_7d
FROM s LEFT JOIN a ON a.uid = s.uid;

-- one row per shipment (shipment_id is shared by every step of a load)
CREATE OR REPLACE TEMP TABLE shipments AS
SELECT shipment_id, any_value(uid) AS uid,
 min(t) FILTER (WHERE event = 'quote requested') AS t_quote,
 min(t) FILTER (WHERE event = 'load booked') AS t_book,
 min(t) FILTER (WHERE event = 'carrier assigned') AS t_cover,
 min(t) FILTER (WHERE event = 'pickup confirmed') AS t_pickup,
 min(t) FILTER (WHERE event = 'load delivered') AS t_deliver,
 min(t) FILTER (WHERE event = 'invoice paid') AS t_invoice,
 coalesce(any_value(equipment_type) FILTER (WHERE event = 'quote requested'), any_value(equipment_type) FILTER (WHERE event = 'load booked'), any_value(equipment_type) FILTER (WHERE event = 'load delivered')) AS equipment_type,
 coalesce(any_value(origin_region) FILTER (WHERE event = 'quote requested'), any_value(origin_region) FILTER (WHERE event = 'pickup confirmed'), any_value(origin_region) FILTER (WHERE event = 'load delivered')) AS origin_region,
 coalesce(any_value(destination_region) FILTER (WHERE event = 'quote requested'), any_value(destination_region) FILTER (WHERE event = 'pickup confirmed'), any_value(destination_region) FILTER (WHERE event = 'load delivered')) AS destination_region,
 any_value(quoted_rate_per_mile) FILTER (WHERE event = 'quote requested') AS quoted_rate_per_mile,
 any_value(customer_rate_usd) FILTER (WHERE event = 'load booked') AS customer_rate_usd,
 any_value(booking_method) FILTER (WHERE event = 'load booked') AS booking_method,
 any_value(appointment_scheduled) FILTER (WHERE event = 'load booked') AS appointment_scheduled,
 any_value(on_time) FILTER (WHERE event = 'load delivered') AS on_time,
 count(*) FILTER (WHERE event = 'accessorial charged' AND charge_type = 'detention') > 0 AS detention,
 count(*) FILTER (WHERE event = 'accessorial charged' AND charge_type = 'lumper') > 0 AS lumper
FROM ev WHERE shipment_id IS NOT NULL GROUP BY 1;

-- quotes with the spot benchmark of their day and equipment (warehouse join)
CREATE OR REPLACE TEMP TABLE quotes AS
SELECT s.*, m.spot_rate_per_mile, s.quoted_rate_per_mile / m.spot_rate_per_mile - 1 AS spread,
 coalesce(s.t_book >= s.t_quote AND s.t_book < s.t_quote + INTERVAL 7 DAY, false) AS booked_7d
FROM shipments s JOIN wh_market m ON m.date::DATE = s.t_quote::DATE AND m.equipment_type = s.equipment_type
WHERE s.t_quote IS NOT NULL;

-- dataset overview
SELECT count(*) AS events, count(DISTINCT uid) AS shippers_with_events, (SELECT count(*) FROM users) AS profiles,
 (SELECT count(*) FROM signups) AS new_signups, (SELECT count(*) FROM shipments WHERE t_book IS NOT NULL) AS loads_booked_in_window,
 min(t) AS first_event, max(t) AS last_event FROM ev;

-- identity check: every event resolves to a shipper; back-office events carry no device or session
SELECT count(*) FILTER (WHERE uid IS NULL) AS unresolved_events,
 count(*) FILTER (WHERE event IN ('carrier assigned', 'pickup confirmed', 'delivery exception', 'load delivered', 'accessorial charged', 'invoice paid',
   'credit application submitted', 'credit approved', 'lane saved') AND (device_id IS NOT NULL OR session_id IS NOT NULL OR browser IS NOT NULL)) AS back_office_events_with_device_or_session
FROM ev;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H1-live-eta-tickets — tracking tickets per load ×0.4 after 2026-07-21 (14-day ramp)
-- ─────────────────────────────────────────────────────────────────────────
WITH w AS (SELECT CASE WHEN t < TIMESTAMP '2026-07-21' THEN '1 before launch' WHEN t >= TIMESTAMP '2026-08-04' THEN '2 after ramp' END AS period, event, ticket_category
  FROM ev WHERE event IN ('support ticket created', 'pickup confirmed', 'load booked'))
SELECT period,
 count(*) FILTER (WHERE event = 'support ticket created' AND ticket_category = 'tracking_status') AS tracking_tickets,
 count(*) FILTER (WHERE event = 'pickup confirmed') AS pickups,
 round(tracking_tickets / pickups, 4) AS tracking_tickets_per_pickup,
 count(*) FILTER (WHERE event = 'support ticket created' AND ticket_category IN ('booking_change', 'billing_question')) AS other_tickets,
 count(*) FILTER (WHERE event = 'load booked') AS loads_booked,
 round(other_tickets / loads_booked, 4) AS other_tickets_per_load
FROM w WHERE period IS NOT NULL GROUP BY 1 ORDER BY 1;

SELECT count(*) FILTER (WHERE view_source = 'eta_notification' AND t < TIMESTAMP '2026-07-21') AS eta_views_before_launch,
 count(*) FILTER (WHERE view_source = 'eta_notification') AS eta_views FROM ev WHERE event = 'shipment tracked';

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H2-price-vs-market — booking rate by spread over the spot benchmark (warehouse join)
-- ─────────────────────────────────────────────────────────────────────────
SELECT CASE WHEN spread <= 0.05 THEN '1 within 5% of market' WHEN spread > 0.15 THEN '3 more than 15% over' ELSE '2 5-15% over' END AS spread_bucket,
 count(*) AS quotes, round(avg(booked_7d::INT), 4) AS book_rate_7d
FROM quotes WHERE t_quote < TIMESTAMP '2026-09-24 23:59:59' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H3-instant-book-experiment — dry van booking ×1.3 in the variant; instant margin (warehouse)
-- ─────────────────────────────────────────────────────────────────────────
SELECT p.variant, count(DISTINCT q.uid) AS shippers, count(*) AS dry_van_quotes,
 round(avg(q.booked_7d::INT), 4) AS book_rate_7d,
 round(avg((q.booking_method = 'instant')::INT) FILTER (WHERE q.t_book IS NOT NULL), 4) AS instant_share_of_bookings
FROM quotes q JOIN prof p ON p.uid = q.uid
WHERE q.equipment_type = 'dry_van' AND q.t_quote >= TIMESTAMP '2026-08-11' AND q.t_quote < TIMESTAMP '2026-09-24 23:59:59' AND p.variant IS NOT NULL
GROUP BY 1 ORDER BY 1;

SELECT booking_method, sum(loads_booked)::BIGINT AS loads, round(sum(gross_revenue_usd), 0) AS revenue_usd,
 round(sum(gross_margin_usd), 0) AS margin_usd, round(sum(gross_margin_usd) / sum(gross_revenue_usd), 4) AS margin_pct
FROM wh_margin WHERE date::DATE >= DATE '2026-08-11' GROUP BY 1 ORDER BY 1;

SELECT count(*) FILTER (WHERE booking_method = 'instant' AND (t < TIMESTAMP '2026-08-11' OR equipment_type <> 'dry_van')) AS impure_instant_bookings
FROM ev WHERE event = 'load booked';

SELECT "Variant name" AS variant, count(DISTINCT uid) AS exposed_shippers, min(t) AS first_exposure FROM ev WHERE event = '$experiment_started' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H4-coverage-by-equipment — booked → carrier assigned, reefer ×1.6, flatbed ×2.2
-- ─────────────────────────────────────────────────────────────────────────
SELECT equipment_type, count(*) AS loads,
 round(median(date_diff('second', t_book, t_cover)) / 3600.0, 2) AS median_hours_to_cover
FROM shipments WHERE t_book IS NOT NULL AND t_cover >= t_book AND t_cover < t_book + INTERVAL 30 DAY GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H5-late-first-load-churn — new shippers whose first delivery was late leave (p 0.5)
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE TEMP TABLE first_delivery AS
WITH f AS (SELECT uid, t AS f0, on_time, row_number() OVER (PARTITION BY uid ORDER BY t, insert_id) AS rn
  FROM ev WHERE event = 'load delivered' AND uid IN (SELECT uid FROM signups))
SELECT f.uid, f.f0, f.on_time,
 coalesce(bool_or(e.t >= f.f0 + INTERVAL 14 DAY), false) AS quoted_on_or_after_d14,
 coalesce(bool_or(e.t >= f.f0 + INTERVAL 14 DAY AND e.t < f.f0 + INTERVAL 28 DAY), false) AS quoted_d14_27
FROM f LEFT JOIN ev e ON e.uid = f.uid AND e.event = 'quote requested'
WHERE f.rn = 1 AND f.f0 <= TIMESTAMP '2026-09-17 23:59:59' GROUP BY 1, 2, 3;

SELECT CASE WHEN on_time THEN 'on time' ELSE 'late' END AS first_delivery, count(*) AS new_shippers,
 round(avg(quoted_on_or_after_d14::INT), 4) AS retained_on_or_after_d14
FROM first_delivery GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H6-paid-channel-economics — spend per signup, credit approval, spend per approved shipper
-- ─────────────────────────────────────────────────────────────────────────
WITH g AS (SELECT ch, count(*) AS signups, count(*) FILTER (WHERE approved_7d) AS approved FROM signups GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM wh_paid GROUP BY 1)
SELECT g.ch, g.signups, g.approved, round(g.approved / g.signups, 4) AS approval_7d, round(sp.spend, 0) AS spend_usd,
 round(sp.spend / g.signups, 2) AS spend_per_signup, round(sp.spend / g.approved, 2) AS spend_per_approved
FROM g LEFT JOIN sp ON sp.ch = g.ch ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H7-hurricane-odessa — Gulf-lane loads in the storm days late 70% (vs 18%); spot rates
-- ─────────────────────────────────────────────────────────────────────────
WITH x AS (SELECT *, (origin_region IN ('southeast', 'south_central') OR destination_region IN ('southeast', 'south_central')) AS gulf,
  (t_pickup >= TIMESTAMP '2026-09-14' AND t_pickup < TIMESTAMP '2026-09-19') AS storm_pickup
  FROM shipments WHERE t_pickup IS NOT NULL AND t_deliver IS NOT NULL)
SELECT CASE WHEN gulf AND storm_pickup THEN '1 Gulf lane, picked up Sep 14-18' WHEN storm_pickup THEN '2 other lanes, picked up Sep 14-18' ELSE '3 all other loads' END AS grp,
 count(*) AS loads, round(avg((NOT on_time)::INT), 4) AS late_share
FROM x GROUP BY 1 ORDER BY 1;

SELECT equipment_type,
 round(avg(spot_rate_per_mile) FILTER (WHERE date::DATE BETWEEN DATE '2026-08-31' AND DATE '2026-09-12'), 3) AS rate_2_weeks_before,
 round(avg(spot_rate_per_mile) FILTER (WHERE date::DATE BETWEEN DATE '2026-09-14' AND DATE '2026-09-18'), 3) AS rate_storm_days,
 round(rate_storm_days / rate_2_weeks_before, 3) AS storm_ratio
FROM wh_market GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H8-saved-lanes-threshold — new shippers under 3 saved lanes book 0.5x the loads
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE TEMP TABLE approved_new AS
SELECT a.uid, p.saved_lanes, count(e.uid) AS loads
FROM (SELECT DISTINCT uid FROM ev WHERE event = 'credit approved') a JOIN prof p ON p.uid = a.uid
LEFT JOIN ev e ON e.uid = a.uid AND e.event = 'load booked' GROUP BY 1, 2;

SELECT CASE WHEN saved_lanes < 3 THEN '1 under 3' WHEN saved_lanes <= 4 THEN '2 3-4' ELSE '3 5+' END AS saved_lanes_bucket,
 count(*) AS approved_new_shippers, round(avg(loads), 3) AS loads_per_shipper
FROM approved_new GROUP BY 1 ORDER BY 1;

-- the story read: ratios within each company tier, weighted by the tier's share of approved new shippers
WITH t AS (SELECT p.company_tier AS tier, count(*) AS users,
  avg(a.loads) FILTER (WHERE a.saved_lanes < 3) AS m_lo, avg(a.loads) FILTER (WHERE a.saved_lanes >= 3) AS m_hi,
  avg(a.loads) FILTER (WHERE a.saved_lanes BETWEEN 3 AND 4) AS m_mid, avg(a.loads) FILTER (WHERE a.saved_lanes >= 5) AS m_top
  FROM approved_new a JOIN prof p ON p.uid = a.uid GROUP BY 1)
SELECT tier, users, round(m_lo, 3) AS under_3, round(m_hi, 3) AS three_plus, round(m_lo / m_hi, 3) AS threshold_ratio, round(m_top / m_mid, 3) AS plateau_ratio FROM t
UNION ALL
SELECT 'weighted', sum(users), NULL, NULL, round(sum(m_lo / m_hi * users) / sum(users), 3), round(sum(m_top / m_mid * users) / sum(users), 3) FROM t
ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H9-dock-appointments — detention on 0.4x as many loads with an appointment
-- ─────────────────────────────────────────────────────────────────────────
SELECT appointment_scheduled, count(*) AS loads, round(avg(detention::INT), 4) AS detention_share, round(avg(lumper::INT), 4) AS lumper_share
FROM shipments WHERE t_book IS NOT NULL AND t_book < TIMESTAMP '2026-09-15' GROUP BY 1 ORDER BY 1;

-- ═════════════════════════════════════════════════════════════════════════
-- EVAL QUERIES (eval/logistics.eval.md)
-- ═════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q1 — tracking tickets per load before vs after Live ETA, weekly (see STORY H1)
-- ─────────────────────────────────────────────────────────────────────────
SELECT date_trunc('week', t)::DATE AS week,
 count(*) FILTER (WHERE event = 'support ticket created' AND ticket_category = 'tracking_status') AS tracking_tickets,
 count(*) FILTER (WHERE event = 'pickup confirmed') AS pickups,
 round(tracking_tickets / pickups, 4) AS tracking_tickets_per_pickup
FROM ev WHERE event IN ('support ticket created', 'pickup confirmed') GROUP BY 1 ORDER BY 1;

SELECT CASE WHEN t < TIMESTAMP '2026-07-21' THEN '1 before' WHEN t < TIMESTAMP '2026-08-04' THEN '2 rollout' ELSE '3 after' END AS period,
 ticket_category, count(*) AS tickets
FROM ev WHERE event = 'support ticket created' GROUP BY 1, 2 ORDER BY 1, 2;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q2 — Live ETA adoption: tracking views by source, before vs after launch
-- ─────────────────────────────────────────────────────────────────────────
WITH v AS (SELECT CASE WHEN t < TIMESTAMP '2026-07-21' THEN '1 before' ELSE '2 from launch' END AS period, view_source FROM ev WHERE event = 'shipment tracked')
SELECT period, view_source, count(*) AS views, round(count(*) / sum(count(*)) OVER (PARTITION BY period), 4) AS share
FROM v GROUP BY 1, 2 ORDER BY 1, 2;

SELECT CASE WHEN s.t_pickup < TIMESTAMP '2026-07-21' THEN '1 before' WHEN s.t_pickup >= TIMESTAMP '2026-08-04' THEN '3 after' ELSE '2 rollout' END AS period,
 count(*) AS loads, round(avg(v), 3) AS tracking_views_per_load
FROM (SELECT s.shipment_id, s.t_pickup, count(e.uid) AS v FROM shipments s LEFT JOIN ev e ON e.shipment_id = s.shipment_id AND e.event = 'shipment tracked'
  WHERE s.t_pickup IS NOT NULL AND s.t_deliver IS NOT NULL GROUP BY 1, 2) s GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q3 — quote-to-book by price vs market, finer buckets (see STORY H2), and without the join
-- ─────────────────────────────────────────────────────────────────────────
SELECT CASE WHEN spread < 0 THEN 'a below market' WHEN spread <= 0.05 THEN 'b 0-5%' WHEN spread <= 0.10 THEN 'c 5-10%'
  WHEN spread <= 0.15 THEN 'd 10-15%' WHEN spread <= 0.20 THEN 'e 15-20%' ELSE 'f over 20%' END AS spread_bucket,
 count(*) AS quotes, round(avg(booked_7d::INT), 4) AS book_rate_7d
FROM quotes WHERE t_quote < TIMESTAMP '2026-09-24 23:59:59' GROUP BY 1 ORDER BY 1;

SELECT count(*) AS quotes, round(avg(booked_7d::INT), 4) AS overall_book_rate_7d, round(median(spread), 4) AS median_spread,
 round(corr(quoted_rate_per_mile, booked_7d::INT), 4) AS corr_rate_vs_booked, round(corr(spread, booked_7d::INT), 4) AS corr_spread_vs_booked
FROM quotes WHERE t_quote < TIMESTAMP '2026-09-24 23:59:59';

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q4 — Instant Book: lift, significance, and margin dollars per quote (see STORY H3)
-- ─────────────────────────────────────────────────────────────────────────
WITH a AS (SELECT p.variant, count(*) AS n, sum(q.booked_7d::INT) AS k,
  count(*) FILTER (WHERE q.booked_7d AND q.booking_method = 'instant') AS k_instant,
  avg(q.customer_rate_usd) FILTER (WHERE q.booked_7d) AS rev_per_load
  FROM quotes q JOIN prof p ON p.uid = q.uid
  WHERE q.equipment_type = 'dry_van' AND q.t_quote >= TIMESTAMP '2026-08-11' AND q.t_quote < TIMESTAMP '2026-09-24 23:59:59' AND p.variant IS NOT NULL GROUP BY 1),
m AS (SELECT sum(gross_margin_usd) FILTER (WHERE booking_method = 'negotiated') / sum(gross_revenue_usd) FILTER (WHERE booking_method = 'negotiated') AS neg,
  sum(gross_margin_usd) FILTER (WHERE booking_method = 'instant') / sum(gross_revenue_usd) FILTER (WHERE booking_method = 'instant') AS inst
  FROM wh_margin WHERE date::DATE >= DATE '2026-08-11'),
b AS (SELECT a.*, ((a.k - a.k_instant) * m.neg + a.k_instant * m.inst) / a.k AS blended FROM a, m)
SELECT variant, n AS dry_van_quotes, k AS bookings, round(k / n, 4) AS book_rate, round(rev_per_load, 0) AS revenue_per_load,
 round(blended, 4) AS blended_margin_pct, round(k / n * rev_per_load * blended, 2) AS est_margin_usd_per_quote
FROM b ORDER BY 1;

WITH a AS (SELECT p.variant, count(*) AS n, avg(q.booked_7d::INT) AS r
  FROM quotes q JOIN prof p ON p.uid = q.uid
  WHERE q.equipment_type = 'dry_van' AND q.t_quote >= TIMESTAMP '2026-08-11' AND q.t_quote < TIMESTAMP '2026-09-24 23:59:59' AND p.variant IS NOT NULL GROUP BY 1)
SELECT round((max(r) FILTER (WHERE variant = 'Instant Book') - max(r) FILTER (WHERE variant = 'Control'))
 / sqrt(max(r * (1 - r) / n) FILTER (WHERE variant = 'Instant Book') + max(r * (1 - r) / n) FILTER (WHERE variant = 'Control')), 1) AS z FROM a;

-- arm balance: exposed shippers per arm (sample-ratio z vs 50/50) and pre-test dry van booking rate by arm
WITH x AS (SELECT "Variant name" AS variant, count(DISTINCT uid) AS n FROM ev WHERE event = '$experiment_started' GROUP BY 1),
pre AS (SELECT p.variant, round(avg(q.booked_7d::INT), 4) AS pre_test_book_rate FROM quotes q JOIN prof p ON p.uid = q.uid
  WHERE q.equipment_type = 'dry_van' AND q.t_quote < TIMESTAMP '2026-08-11' AND p.variant IS NOT NULL GROUP BY 1)
SELECT x.variant, x.n AS exposed_shippers, round(x.n / sum(x.n) OVER (), 4) AS share,
 round((x.n - sum(x.n) OVER () / 2) / sqrt(sum(x.n) OVER () / 4), 2) AS srm_z, pre.pre_test_book_rate
FROM x JOIN pre USING (variant) ORDER BY 1;

-- reefer and flatbed quotes are outside the test: booking rate by arm
SELECT q.equipment_type, p.variant, count(*) AS quotes, round(avg(q.booked_7d::INT), 4) AS book_rate_7d
FROM quotes q JOIN prof p ON p.uid = q.uid
WHERE q.equipment_type <> 'dry_van' AND q.t_quote >= TIMESTAMP '2026-08-11' AND q.t_quote < TIMESTAMP '2026-09-24 23:59:59' AND p.variant IS NOT NULL
GROUP BY 1, 2 ORDER BY 1, 2;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q5 — gross margin by booking method and week (warehouse)
-- ─────────────────────────────────────────────────────────────────────────
SELECT date_trunc('week', date::DATE)::DATE AS week, booking_method, sum(loads_booked)::BIGINT AS loads,
 round(sum(gross_margin_usd) / nullif(sum(gross_revenue_usd), 0), 4) AS margin_pct
FROM wh_margin WHERE date::DATE >= DATE '2026-08-10' GROUP BY 1, 2 ORDER BY 1, 2;

SELECT CASE WHEN date::DATE < DATE '2026-08-11' THEN '1 Jun 4-Aug 10' ELSE '2 Aug 11-Oct 1' END AS period,
 round(sum(gross_margin_usd) / sum(gross_revenue_usd), 4) AS margin_pct_all_loads,
 round(sum(gross_revenue_usd) FILTER (WHERE booking_method = 'instant') / sum(gross_revenue_usd), 4) AS instant_revenue_share
FROM wh_margin GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q6 — time to cover by equipment, plus share covered within 4 h (see STORY H4)
-- ─────────────────────────────────────────────────────────────────────────
SELECT equipment_type, count(*) AS loads,
 round(median(date_diff('second', t_book, t_cover)) / 3600.0, 2) AS median_hours,
 round(avg(date_diff('second', t_book, t_cover)) / 3600.0, 2) AS mean_hours,
 round(avg((t_cover < t_book + INTERVAL 4 HOUR)::INT), 4) AS covered_within_4h
FROM shipments WHERE t_book IS NOT NULL AND t_cover >= t_book GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q7 — new shippers after a late first delivery (see STORY H5), plus a 14-27 day bracket
-- ─────────────────────────────────────────────────────────────────────────
SELECT CASE WHEN on_time THEN 'on time' ELSE 'late' END AS first_delivery, count(*) AS new_shippers,
 round(avg(quoted_on_or_after_d14::INT), 4) AS retained_on_or_after_d14,
 count(*) FILTER (WHERE f0 <= TIMESTAMP '2026-09-03 23:59:59') AS births_to_sep3,
 round(avg(quoted_d14_27::INT) FILTER (WHERE f0 <= TIMESTAMP '2026-09-03 23:59:59'), 4) AS retained_d14_27
FROM first_delivery GROUP BY 1 ORDER BY 1;

SELECT count(*) AS new_shippers_with_a_delivery, round(avg((NOT on_time)::INT), 4) AS late_first_share FROM first_delivery;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q8 — paid channel economics incl. loads booked by those signups (see STORY H6)
-- ─────────────────────────────────────────────────────────────────────────
WITH g AS (SELECT ch, count(*) AS signups, count(*) FILTER (WHERE approved_7d) AS approved FROM signups GROUP BY 1),
l AS (SELECT s.ch, count(e.uid) AS loads FROM signups s JOIN ev e ON e.uid = s.uid AND e.event = 'load booked' GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend, sum(leads_reported) AS leads FROM wh_paid GROUP BY 1)
SELECT g.ch, g.signups, g.approved, l.loads, round(sp.spend, 0) AS spend_usd, sp.leads AS platform_leads,
 round(sp.spend / g.signups, 2) AS spend_per_signup, round(sp.spend / g.approved, 2) AS spend_per_approved,
 round(sp.spend / l.loads, 2) AS spend_per_load_booked
FROM g LEFT JOIN sp ON sp.ch = g.ch LEFT JOIN l ON l.ch = g.ch ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q9 — onboarding funnel by channel (7 days)
-- ─────────────────────────────────────────────────────────────────────────
SELECT ch, count(*) AS signups, round(avg(applied_7d::INT), 4) AS applied_7d, round(avg(approved_7d::INT), 4) AS approved_7d
FROM signups GROUP BY 1
UNION ALL
SELECT 'all other channels', count(*), round(avg(applied_7d::INT), 4), round(avg(approved_7d::INT), 4) FROM signups WHERE ch <> 'google_ads'
UNION ALL
SELECT 'all channels', count(*), round(avg(applied_7d::INT), 4), round(avg(approved_7d::INT), 4) FROM signups
ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q10 — mid-September on-time drop: weekly late share by lane group (see STORY H7)
-- ─────────────────────────────────────────────────────────────────────────
SELECT date_trunc('week', t_deliver)::DATE AS delivery_week,
 round(avg((NOT on_time)::INT) FILTER (WHERE origin_region IN ('southeast', 'south_central') OR destination_region IN ('southeast', 'south_central')), 4) AS late_gulf_lanes,
 round(avg((NOT on_time)::INT) FILTER (WHERE NOT (origin_region IN ('southeast', 'south_central') OR destination_region IN ('southeast', 'south_central'))), 4) AS late_other_lanes,
 count(*) AS deliveries
FROM shipments WHERE t_deliver IS NOT NULL GROUP BY 1 ORDER BY 1;

SELECT exception_type, count(*) FILTER (WHERE t >= TIMESTAMP '2026-09-14' AND t < TIMESTAMP '2026-09-21') AS sep14_20,
 count(*) FILTER (WHERE t >= TIMESTAMP '2026-08-31' AND t < TIMESTAMP '2026-09-07') AS aug31_sep6
FROM ev WHERE event = 'delivery exception' GROUP BY 1 ORDER BY 2 DESC;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q11 — spot rates and margin around the storm (warehouse; see STORY H7)
-- ─────────────────────────────────────────────────────────────────────────
SELECT date::DATE AS day, round(avg(spot_rate_per_mile) FILTER (WHERE equipment_type = 'flatbed'), 3) AS flatbed_rate,
 round(avg(spot_rate_per_mile) FILTER (WHERE equipment_type = 'dry_van'), 3) AS dry_van_rate,
 round(avg(spot_rate_per_mile) FILTER (WHERE equipment_type = 'reefer'), 3) AS reefer_rate,
 round(avg(load_to_truck_ratio) FILTER (WHERE equipment_type = 'flatbed'), 2) AS flatbed_load_to_truck
FROM wh_market WHERE date::DATE BETWEEN DATE '2026-09-07' AND DATE '2026-09-30' GROUP BY 1 ORDER BY 1;

SELECT CASE WHEN date::DATE < DATE '2026-09-14' THEN '1 Aug 31-Sep 13' WHEN date::DATE < DATE '2026-09-19' THEN '2 Sep 14-18' ELSE '3 Sep 19-30' END AS period,
 booking_method, round(sum(gross_margin_usd) / sum(gross_revenue_usd), 4) AS margin_pct
FROM wh_margin WHERE date::DATE BETWEEN DATE '2026-08-31' AND DATE '2026-09-30' GROUP BY 1, 2 ORDER BY 1, 2;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q12 — loads per approved new shipper by exact saved lanes (see STORY H8)
-- ─────────────────────────────────────────────────────────────────────────
SELECT saved_lanes, count(*) AS approved_new_shippers, round(avg(loads), 3) AS loads_per_shipper
FROM approved_new GROUP BY 1 ORDER BY 1;

-- Mixpanel "average per user" reading: only shippers who booked at least once
SELECT CASE WHEN saved_lanes < 3 THEN '1 under 3' ELSE '2 3+' END AS saved_lanes_bucket, count(*) AS approved_new_shippers,
 round(avg(loads), 3) AS loads_per_approved_shipper, round(avg((loads > 0)::INT), 4) AS share_booking_any,
 round(avg(loads) FILTER (WHERE loads > 0), 3) AS loads_per_booking_shipper
FROM approved_new GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q13 — detention by appointment, by tier (see STORY H9); accessorial dollars
-- ─────────────────────────────────────────────────────────────────────────
SELECT p.company_tier, s.appointment_scheduled, count(*) AS loads, round(avg(s.detention::INT), 4) AS detention_share
FROM shipments s JOIN prof p ON p.uid = s.uid WHERE s.t_book IS NOT NULL AND s.t_book < TIMESTAMP '2026-09-15' GROUP BY 1, 2 ORDER BY 1, 2;

SELECT p.company_tier, round(avg(s.appointment_scheduled::INT), 4) AS appointment_share
FROM shipments s JOIN prof p ON p.uid = s.uid WHERE s.t_book IS NOT NULL GROUP BY 1 ORDER BY 1;

SELECT charge_type, count(*) AS charges, round(sum(amount_usd), 0) AS amount_usd, round(avg(amount_usd), 1) AS avg_usd
FROM ev WHERE event = 'accessorial charged' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q14 — the quote dips on Jul 3 and Sep 7 (US holidays)
-- ─────────────────────────────────────────────────────────────────────────
SELECT t::DATE AS day, dayname(t::DATE) AS weekday, count(*) FILTER (WHERE event = 'quote requested') AS quotes,
 count(*) FILTER (WHERE event = 'dashboard viewed') AS dashboard_views, count(*) FILTER (WHERE event = 'pickup confirmed') AS pickups
FROM ev WHERE t::DATE IN (DATE '2026-06-26', DATE '2026-07-02', DATE '2026-07-03', DATE '2026-07-10', DATE '2026-08-31', DATE '2026-09-07', DATE '2026-09-14')
GROUP BY 1, 2 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q15 — quote-to-book by company tier (null), overall and by equipment
-- ─────────────────────────────────────────────────────────────────────────
WITH a AS (SELECT p.company_tier AS tier, count(*) AS n, avg(q.booked_7d::INT) AS r
  FROM quotes q JOIN prof p ON p.uid = q.uid WHERE q.t_quote < TIMESTAMP '2026-09-24 23:59:59' GROUP BY 1)
SELECT tier, n AS quotes, round(r, 4) AS book_rate_7d,
 round((r - (SELECT r FROM a WHERE tier = 'small_business')) / sqrt(r * (1 - r) / n + (SELECT r * (1 - r) / n FROM a WHERE tier = 'small_business')), 2) AS z_vs_small_business
FROM a ORDER BY 1;

WITH a AS (SELECT p.company_tier AS tier, q.equipment_type, count(*) AS n, avg(q.booked_7d::INT) AS r
  FROM quotes q JOIN prof p ON p.uid = q.uid WHERE q.t_quote < TIMESTAMP '2026-09-24 23:59:59' GROUP BY 1, 2)
SELECT equipment_type,
 round(max(r) FILTER (WHERE tier = 'enterprise'), 4) AS enterprise, round(max(r) FILTER (WHERE tier = 'mid_market'), 4) AS mid_market,
 round(max(r) FILTER (WHERE tier = 'small_business'), 4) AS small_business,
 round((max(r) FILTER (WHERE tier = 'enterprise') - max(r) FILTER (WHERE tier = 'small_business'))
  / sqrt(max(r * (1 - r) / n) FILTER (WHERE tier = 'enterprise') + max(r * (1 - r) / n) FILTER (WHERE tier = 'small_business')), 2) AS z_ent_vs_smb
FROM a GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q16 — did Instant Book spill over to reefer and flatbed quotes? (null), by equipment and tier
-- ─────────────────────────────────────────────────────────────────────────
WITH a AS (SELECT coalesce(q.equipment_type, 'reefer + flatbed') AS equipment_type, p.variant, count(*) AS n, avg(q.booked_7d::INT) AS r
  FROM quotes q JOIN prof p ON p.uid = q.uid
  WHERE q.equipment_type <> 'dry_van' AND q.t_quote >= TIMESTAMP '2026-08-11' AND q.t_quote < TIMESTAMP '2026-09-24 23:59:59' AND p.variant IS NOT NULL
  GROUP BY GROUPING SETS ((q.equipment_type, p.variant), (p.variant)))
SELECT equipment_type,
 max(n) FILTER (WHERE variant = 'Control') AS control_quotes, max(n) FILTER (WHERE variant = 'Instant Book') AS variant_quotes,
 round(max(r) FILTER (WHERE variant = 'Control'), 4) AS control_book_rate, round(max(r) FILTER (WHERE variant = 'Instant Book'), 4) AS variant_book_rate,
 round((max(r) FILTER (WHERE variant = 'Instant Book') - max(r) FILTER (WHERE variant = 'Control'))
  / sqrt(max(r * (1 - r) / n) FILTER (WHERE variant = 'Instant Book') + max(r * (1 - r) / n) FILTER (WHERE variant = 'Control')), 2) AS z
FROM a GROUP BY 1 ORDER BY 1;

WITH a AS (SELECT pr.company_tier AS tier, pr.variant, count(*) AS n, avg(q.booked_7d::INT) AS r
  FROM quotes q JOIN prof pr ON pr.uid = q.uid
  WHERE q.equipment_type <> 'dry_van' AND q.t_quote >= TIMESTAMP '2026-08-11' AND q.t_quote < TIMESTAMP '2026-09-24 23:59:59' AND pr.variant IS NOT NULL
  GROUP BY 1, 2)
SELECT tier, round(max(r) FILTER (WHERE variant = 'Control'), 4) AS control_book_rate, round(max(r) FILTER (WHERE variant = 'Instant Book'), 4) AS variant_book_rate,
 round((max(r) FILTER (WHERE variant = 'Instant Book') - max(r) FILTER (WHERE variant = 'Control'))
  / sqrt(max(r * (1 - r) / n) FILTER (WHERE variant = 'Instant Book') + max(r * (1 - r) / n) FILTER (WHERE variant = 'Control')), 2) AS z
FROM a GROUP BY 1 ORDER BY 1;

-- on-time delivery with vs without a dock appointment (not engineered; reference)
WITH a AS (SELECT appointment_scheduled, count(*) AS n, avg(on_time::INT) AS r FROM shipments WHERE t_deliver IS NOT NULL GROUP BY 1)
SELECT round(max(r) FILTER (WHERE appointment_scheduled), 4) AS on_time_with_appt, round(max(r) FILTER (WHERE NOT appointment_scheduled), 4) AS on_time_without,
 round((max(r) FILTER (WHERE appointment_scheduled) - max(r) FILTER (WHERE NOT appointment_scheduled))
  / sqrt(max(r * (1 - r) / n) FILTER (WHERE appointment_scheduled) + max(r * (1 - r) / n) FILTER (WHERE NOT appointment_scheduled)), 2) AS z FROM a;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q17 — quarter review inputs: monthly quotes, loads, revenue, margin, new shippers (also Q11)
-- ─────────────────────────────────────────────────────────────────────────
SELECT strftime(t, '%Y-%m') AS month, count(*) FILTER (WHERE event = 'quote requested') AS quotes,
 count(*) FILTER (WHERE event = 'load booked') AS loads_booked, round(sum(customer_rate_usd) FILTER (WHERE event = 'load booked'), 0) AS booked_revenue_usd,
 round(avg(customer_rate_usd) FILTER (WHERE event = 'load booked'), 0) AS booked_revenue_per_load,
 count(*) FILTER (WHERE event = 'account created') AS new_signups,
 count(DISTINCT uid) FILTER (WHERE event IN ('quote requested', 'load booked', 'dashboard viewed', 'rate lookup', 'shipment tracked', 'document downloaded', 'report exported', 'lane saved', 'support ticket created')) AS active_shippers
FROM ev GROUP BY 1 ORDER BY 1;

SELECT strftime(date::DATE, '%Y-%m') AS month, round(sum(gross_revenue_usd), 0) AS billed_revenue_usd, round(sum(gross_margin_usd), 0) AS gross_margin_usd,
 round(sum(gross_margin_usd) / sum(gross_revenue_usd), 4) AS margin_pct
FROM wh_margin GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q18 — weekly quotes and loads booked (trend)
-- ─────────────────────────────────────────────────────────────────────────
SELECT date_trunc('week', t)::DATE AS week, count(*) FILTER (WHERE event = 'quote requested') AS quotes,
 count(*) FILTER (WHERE event = 'load booked') AS loads_booked, count(*) FILTER (WHERE event = 'load delivered') AS loads_delivered,
 count(*) FILTER (WHERE event = 'account created') AS new_signups
FROM ev GROUP BY 1 ORDER BY 1;

SELECT CASE WHEN p.new_shipper THEN 'new (joined in window)' ELSE 'established' END AS shipper_type,
 count(*) FILTER (WHERE e.event = 'load booked' AND e.t < TIMESTAMP '2026-07-01') AS loads_june,
 count(*) FILTER (WHERE e.event = 'load booked' AND e.t >= TIMESTAMP '2026-09-01' AND e.t < TIMESTAMP '2026-10-01') AS loads_september,
 round(count(*) FILTER (WHERE e.event = 'quote requested' AND e.t < TIMESTAMP '2026-07-01') / 27.0, 1) AS quotes_per_day_june,
 round(count(*) FILTER (WHERE e.event = 'quote requested' AND e.t >= TIMESTAMP '2026-09-01' AND e.t < TIMESTAMP '2026-10-01') / 30.0, 1) AS quotes_per_day_september,
 round(count(*) FILTER (WHERE e.event = 'load booked' AND e.t < TIMESTAMP '2026-07-01') / 27.0, 1) AS loads_per_day_june,
 round(count(*) FILTER (WHERE e.event = 'load booked' AND e.t >= TIMESTAMP '2026-09-01' AND e.t < TIMESTAMP '2026-10-01') / 30.0, 1) AS loads_per_day_september
FROM ev e JOIN prof p ON p.uid = e.uid GROUP BY 1 ORDER BY 1;

-- established shippers' September loads by Instant Book arm (dry van), per day
SELECT coalesce(p.variant, 'not exposed') AS variant,
 round(count(*) FILTER (WHERE e.t < TIMESTAMP '2026-07-01') / 27.0, 1) AS dry_van_loads_per_day_june,
 round(count(*) FILTER (WHERE e.t >= TIMESTAMP '2026-09-01' AND e.t < TIMESTAMP '2026-10-01') / 30.0, 1) AS dry_van_loads_per_day_september
FROM ev e JOIN prof p ON p.uid = e.uid WHERE e.event = 'load booked' AND e.equipment_type = 'dry_van' AND NOT p.new_shipper GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q19 — on-time delivery overall and by equipment (outside the storm days)
-- ─────────────────────────────────────────────────────────────────────────
SELECT coalesce(equipment_type, 'all') AS equipment_type, count(*) AS loads, round(avg(on_time::INT), 4) AS on_time_share
FROM shipments WHERE t_deliver IS NOT NULL AND NOT (t_pickup >= TIMESTAMP '2026-09-12' AND t_pickup < TIMESTAMP '2026-09-19')
GROUP BY ROLLUP (equipment_type) ORDER BY 1;

SELECT round(avg(on_time::INT), 4) AS on_time_all_loads, count(*) AS delivered_loads FROM shipments WHERE t_deliver IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q20 — days to pay by tier and payment terms
-- ─────────────────────────────────────────────────────────────────────────
SELECT p.company_tier, p.payment_terms, count(*) AS invoices, round(median(e.days_to_pay), 1) AS median_days_to_pay, round(avg(e.days_to_pay), 1) AS mean_days_to_pay
FROM ev e JOIN prof p ON p.uid = e.uid WHERE e.event = 'invoice paid' GROUP BY 1, 2 ORDER BY 1;
