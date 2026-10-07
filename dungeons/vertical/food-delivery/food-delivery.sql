-- Forkfly (food-delivery vertical) — story-keyed and eval-keyed DuckDB queries.
--
-- Generate first (repo root):
--   node scripts/verify-runner.mjs dungeons/vertical/food-delivery/food-delivery.js verify-food-delivery
-- Run:
--   duckdb -c ".read dungeons/vertical/food-delivery/food-delivery.sql"
-- Against a gzipped export:
--   duckdb -c "SET VARIABLE data_prefix='<dir>/food-delivery'" -c ".read food-delivery.sql"
--
-- All times are UTC. Window: 2026-06-04 00:00 to 2026-10-01 23:59:59.
-- Timeline: Order Again 2026-07-07, Smart Add-ons test 2026-07-28, non-Pass
-- service fee 10% -> 15% 2026-08-11, card processor incident 2026-08-25 to 2026-08-28.

SET VARIABLE data_prefix = COALESCE(getvariable('data_prefix'), 'data/verify-food-delivery');

-- ─────────────────────────────────────────────────────────────────────────
-- PRELUDE: raw files, identity resolution, warehouse tables
-- ─────────────────────────────────────────────────────────────────────────
-- Identity: a new customer signs up with "account created" (the auth event,
-- which carries user_id and device_id). A device resolves to the customer seen
-- with it on any event that carries both ids, the way Mixpanel stitches.
-- Every Forkfly event carries user_id, so uid = user_id in practice.

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

CREATE OR REPLACE TEMP TABLE wh_mkt AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-marketing_spend_daily.json*', sample_size=-1, union_by_name=true);
CREATE OR REPLACE TEMP TABLE wh_pay AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-payment_gateway_daily.json*', sample_size=-1, union_by_name=true);
CREATE OR REPLACE TEMP TABLE wh_ops AS
SELECT *, date::DATE AS d, precipitation_mm >= 4 AS rainy
FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-market_ops_daily.json*', sample_size=-1, union_by_name=true);

-- profile attributes keyed by the resolved customer id
CREATE OR REPLACE TEMP TABLE prof AS
SELECT distinct_id::VARCHAR AS uid, city, household_type, acquisition_channel, customer_since, platform, default_payment,
 pass_status AS current_pass, "Experiment: Smart Add-ons" AS arm
FROM users;

-- one row per checkout (order_id), with the order if it was placed within an hour
CREATE OR REPLACE TEMP TABLE checkouts AS
SELECT c.order_id, c.uid, c.t, c.t::DATE AS d, c.city, c.platform, c.payment_method, c.pass_status <> 'none' AS pass,
 c.quoted_eta_mins AS eta, c.entry_point, c.subtotal_usd AS cart_subtotal,
 p.t AS tp, (p.t IS NOT NULL AND p.t < c.t + INTERVAL 1 HOUR) AS placed
FROM ev c LEFT JOIN (SELECT order_id, min(t) AS t FROM ev WHERE event = 'order placed' GROUP BY 1) p ON p.order_id = c.order_id
WHERE c.event = 'checkout started';

CREATE OR REPLACE TEMP TABLE orders AS
SELECT o.*, o.t::DATE AS d, o.pass_status <> 'none' AS pass, dl.minutes_late::INT AS late_min, dl.delivery_minutes AS delivery_min, dl.t AS t_delivered
FROM ev o LEFT JOIN ev dl ON dl.order_id = o.order_id AND dl.event = 'order delivered'
WHERE o.event = 'order placed';

-- new customers (signed up in the window) and their first delivered order
CREATE OR REPLACE TEMP TABLE signups AS
SELECT uid, t AS t0, acquisition_channel AS ch, signup_method FROM ev WHERE event = 'account created';

CREATE OR REPLACE TEMP TABLE first_delivery AS
WITH d AS (SELECT ev.uid, ev.t, ev.minutes_late::INT AS late,
  row_number() OVER (PARTITION BY ev.uid ORDER BY ev.t, ev.insert_id) AS rn
  FROM ev JOIN signups s ON s.uid = ev.uid WHERE ev.event = 'order delivered')
SELECT d.uid, d.t, d.late, s.ch, s.t0,
 coalesce(bool_or(o.t > d.t AND o.t < d.t + INTERVAL 30 DAY), false) AS repeat30
FROM d JOIN signups s ON s.uid = d.uid LEFT JOIN ev o ON o.uid = d.uid AND o.event = 'order placed'
WHERE d.rn = 1 GROUP BY 1, 2, 3, 4, 5;

-- one row per app session (app opened until the next app opened, at most 60 minutes)
CREATE OR REPLACE TEMP TABLE sessions AS
WITH o AS (SELECT uid, t, lead(t) OVER (PARTITION BY uid ORDER BY t) AS nt FROM ev WHERE event = 'app opened')
SELECT o.uid, o.t,
 coalesce(bool_or(e.event = 'reorder tapped'), false) AS reorder,
 min(e.t) FILTER (WHERE e.event = 'order placed') AS tp,
 arg_min(e.entry_point, e.t) FILTER (WHERE e.event = 'order placed') AS entry_point
FROM o LEFT JOIN ev e ON e.uid = o.uid AND e.event IN ('reorder tapped', 'order placed') AND e.t > o.t
 AND e.t < o.t + INTERVAL 60 MINUTE AND (o.nt IS NULL OR e.t < o.nt)
GROUP BY 1, 2;

-- dataset overview
SELECT count(*) AS events, count(DISTINCT uid) AS customers_with_events, (SELECT count(*) FROM users) AS profiles,
 (SELECT count(*) FROM signups) AS new_signups, (SELECT count(*) FROM orders) AS orders,
 min(t) AS first_event, max(t) AS last_event FROM ev;

-- identity and device checks: every event resolves; platform agrees with the device OS; wallets match the OS
SELECT count(*) FILTER (WHERE uid IS NULL) AS unresolved_events,
 count(*) FILTER (WHERE (platform = 'ios' AND os NOT IN ('iOS', 'iPadOS')) OR (platform = 'android' AND os <> 'Android')) AS platform_os_mismatch,
 count(*) FILTER (WHERE (payment_method = 'apple_pay' AND platform <> 'ios') OR (payment_method = 'google_pay' AND platform <> 'android')) AS wallet_mismatch,
 count(*) FILTER (WHERE device_id IS NULL) AS events_without_device
FROM ev;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H1-late-first-order: 30-day repeat rate after a late (15+ min) first delivery
-- (Mixpanel: Funnels order delivered with the first-time-ever filter -> order placed, 30 days)
-- ─────────────────────────────────────────────────────────────────────────
WITH g AS (SELECT late >= 15 AS is_late, count(*) AS n, avg(repeat30::INT) AS r FROM first_delivery WHERE t < TIMESTAMP '2026-09-01' GROUP BY 1)
SELECT max(n) FILTER (WHERE is_late) AS late_first_orders, round(max(r) FILTER (WHERE is_late), 4) AS late_repeat_30d,
 max(n) FILTER (WHERE NOT is_late) AS on_time_first_orders, round(max(r) FILTER (WHERE NOT is_late), 4) AS on_time_repeat_30d,
 round(max(r) FILTER (WHERE is_late) / max(r) FILTER (WHERE NOT is_late), 4) AS ratio
FROM g;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H2-rainy-days: orders per city-day on rainy vs dry days; lateness on rainy days
-- ─────────────────────────────────────────────────────────────────────────
WITH o AS (SELECT city, d, count(*) AS n FROM orders GROUP BY 1, 2),
j AS (SELECT w.city, w.d, w.rainy, coalesce(o.n, 0) AS n FROM wh_ops w LEFT JOIN o ON o.city = w.city AND o.d = w.d),
c AS (SELECT city, avg(n) FILTER (WHERE NOT rainy) AS dry_mean FROM j GROUP BY 1)
SELECT count(*) FILTER (WHERE j.rainy) AS rainy_city_days,
 round(sum(j.n) FILTER (WHERE j.rainy) / sum(c.dry_mean) FILTER (WHERE j.rainy), 4) AS rain_lift
FROM j JOIN c ON c.city = j.city;

SELECT round(avg(o.late_min) FILTER (WHERE w.rainy) - avg(o.late_min) FILTER (WHERE NOT w.rainy), 2) AS extra_minutes_late_rainy,
 round(avg(o.late_min) FILTER (WHERE NOT w.rainy), 2) AS dry_minutes_late, round(avg(o.late_min) FILTER (WHERE w.rainy), 2) AS rainy_minutes_late
FROM orders o JOIN wh_ops w ON w.city = o.city AND w.d = o.d WHERE o.late_min IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H3-quoted-eta-threshold: checkout -> order by quoted ETA (<= 45 vs > 45 min)
-- ─────────────────────────────────────────────────────────────────────────
WITH g AS (SELECT eta <= 45 AS quick, count(*) AS n, avg(placed::INT) AS conv FROM checkouts GROUP BY 1)
SELECT max(n) FILTER (WHERE quick) AS quick_checkouts, round(max(conv) FILTER (WHERE quick), 4) AS quick_conv,
 max(n) FILTER (WHERE NOT quick) AS slow_checkouts, round(max(conv) FILTER (WHERE NOT quick), 4) AS slow_conv,
 round(max(conv) FILTER (WHERE NOT quick) / max(conv) FILTER (WHERE quick), 4) AS ratio
FROM g;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H4-card-processor-incident: card vs other methods, incident days vs 14 days either side
-- ─────────────────────────────────────────────────────────────────────────
WITH g AS (SELECT payment_method = 'card' AS card, d BETWEEN DATE '2026-08-25' AND DATE '2026-08-28' AS outage, count(*) AS n, avg(placed::INT) AS conv
  FROM checkouts WHERE t >= TIMESTAMP '2026-08-11' AND t < TIMESTAMP '2026-09-12' GROUP BY 1, 2)
SELECT round(max(conv) FILTER (WHERE card AND outage), 4) AS card_incident, round(max(conv) FILTER (WHERE card AND NOT outage), 4) AS card_baseline,
 round(max(conv) FILTER (WHERE NOT card AND outage), 4) AS other_incident, round(max(conv) FILTER (WHERE NOT card AND NOT outage), 4) AS other_baseline,
 round((max(conv) FILTER (WHERE card AND outage) / max(conv) FILTER (WHERE card AND NOT outage))
 / (max(conv) FILTER (WHERE NOT card AND outage) / max(conv) FILTER (WHERE NOT card AND NOT outage)), 4) AS did
FROM g;

SELECT date, payment_method, auth_attempts, auth_declines, decline_rate, gateway_status
FROM wh_pay WHERE gateway_status = 'major_outage' ORDER BY date;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H5-smart-addons-experiment: items per order by arm (pre-period adjusted), conversion by arm
-- ─────────────────────────────────────────────────────────────────────────
WITH o AS (SELECT p.arm, o.items_count, o.subtotal_usd, o.t >= TIMESTAMP '2026-07-28' AS post FROM orders o JOIN prof p ON p.uid = o.uid WHERE p.arm IS NOT NULL)
SELECT arm, round(avg(items_count) FILTER (WHERE post), 4) AS items_after, round(avg(items_count) FILTER (WHERE NOT post), 4) AS items_before,
 round(avg(subtotal_usd) FILTER (WHERE post), 2) AS subtotal_after, round(avg(subtotal_usd) FILTER (WHERE NOT post), 2) AS subtotal_before
FROM o GROUP BY 1 ORDER BY 1;

SELECT p.arm, count(*) AS checkouts, round(avg(c.placed::INT), 4) AS conversion
FROM checkouts c JOIN prof p ON p.uid = c.uid WHERE p.arm IS NOT NULL AND c.t >= TIMESTAMP '2026-07-28' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H6-channel-economics: spend per signup, 30-day repeat rate, spend per repeat customer
-- ─────────────────────────────────────────────────────────────────────────
WITH g AS (SELECT s.ch, count(*) AS signups,
  count(*) FILTER (WHERE f.repeat30 AND f.t < TIMESTAMP '2026-09-01' AND s.t0 < TIMESTAMP '2026-09-01') AS repeaters,
  avg(f.repeat30::INT) FILTER (WHERE f.t < TIMESTAMP '2026-09-01') AS repeat_rate
  FROM signups s LEFT JOIN first_delivery f ON f.uid = s.uid GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend, sum(spend_usd) FILTER (WHERE date::DATE < DATE '2026-09-01') AS spend_read FROM wh_mkt GROUP BY 1)
SELECT g.ch, g.signups, round(sp.spend, 0) AS spend_usd, round(sp.spend / g.signups, 2) AS spend_per_signup,
 round(g.repeat_rate, 4) AS repeat_rate_30d, g.repeaters, round(sp.spend_read / g.repeaters, 2) AS spend_per_repeat_customer
FROM g LEFT JOIN sp ON sp.ch = g.ch ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H7-pass-trial-two-orders: trial -> paid by orders during the trial
-- ─────────────────────────────────────────────────────────────────────────
WITH s AS (SELECT uid, min(t) AS ts FROM ev WHERE event = 'pass trial started' GROUP BY 1),
e AS (SELECT uid, outcome, orders_during_trial AS n FROM ev WHERE event = 'pass trial ended')
SELECT CASE WHEN e.n >= 2 THEN '2+ orders' ELSE '0-1 orders' END AS trial_usage, count(*) AS trials,
 round(avg((e.outcome = 'converted')::INT), 4) AS converted
FROM e JOIN s ON s.uid = e.uid WHERE s.ts < TIMESTAMP '2026-09-17 23:59:59' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H8-pass-free-delivery-minimum: among $10-19.99 orders, the share under $15
-- ─────────────────────────────────────────────────────────────────────────
SELECT CASE WHEN pass THEN 'pass' ELSE 'no_pass' END AS grp, count(DISTINCT uid) AS customers, count(*) AS orders,
 round(count(*) FILTER (WHERE subtotal_usd >= 10 AND subtotal_usd < 15)::DOUBLE / count(*) FILTER (WHERE subtotal_usd >= 10 AND subtotal_usd < 20), 4) AS share_10_15_of_10_20,
 round(avg((subtotal_usd >= 10 AND subtotal_usd < 15)::INT), 4) AS share_10_15_of_all
FROM orders GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H9-service-fee-change: non-Pass vs Pass checkout -> order, before vs after 2026-08-11 (incident days out)
-- ─────────────────────────────────────────────────────────────────────────
WITH g AS (SELECT pass, t >= TIMESTAMP '2026-08-11' AS post, count(*) AS n, avg(placed::INT) AS conv FROM checkouts
  WHERE NOT (d BETWEEN DATE '2026-08-25' AND DATE '2026-08-28') GROUP BY 1, 2)
SELECT round(max(conv) FILTER (WHERE NOT pass AND NOT post), 4) AS non_pass_before, round(max(conv) FILTER (WHERE NOT pass AND post), 4) AS non_pass_after,
 round(max(conv) FILTER (WHERE pass AND NOT post), 4) AS pass_before, round(max(conv) FILTER (WHERE pass AND post), 4) AS pass_after,
 round((max(conv) FILTER (WHERE NOT pass AND post) / max(conv) FILTER (WHERE NOT pass AND NOT post))
  / (max(conv) FILTER (WHERE pass AND post) / max(conv) FILTER (WHERE pass AND NOT post)), 4) AS did
FROM g;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H10-order-again-launch: app opened -> order placed median minutes; session order rate
-- ─────────────────────────────────────────────────────────────────────────
SELECT CASE WHEN entry_point = 'reorder' THEN 'reorder' ELSE 'browse' END AS path, count(*) AS orders,
 round(median(date_diff('second', t, tp)) / 60.0, 2) AS median_minutes
FROM sessions WHERE t >= TIMESTAMP '2026-07-07' AND tp IS NOT NULL GROUP BY 1 ORDER BY 1;

-- session order rate as an Insights formula (cohort: did reorder tapped; one reorder tapped per Order Again visit)
WITH x AS (SELECT * FROM ev WHERE t >= TIMESTAMP '2026-07-07' AND uid IN (SELECT uid FROM ev WHERE event = 'reorder tapped')),
k AS (SELECT count(*) FILTER (WHERE event = 'order placed' AND entry_point = 'reorder') AS a, count(*) FILTER (WHERE event = 'reorder tapped') AS b,
  count(*) FILTER (WHERE event = 'order placed' AND entry_point <> 'reorder') AS c, count(*) FILTER (WHERE event = 'app opened') AS d FROM x)
SELECT a AS reorder_orders, b AS reorder_taps, c AS browse_orders, d - b AS browse_visits,
 round(a / b, 4) AS reorder_order_rate, round(c / (d - b), 4) AS browse_order_rate, round((a / b) / (c / (d - b)), 4) AS ratio FROM k;

-- ═════════════════════════════════════════════════════════════════════════
-- EVAL QUERIES (eval/food-delivery.eval.md)
-- ═════════════════════════════════════════════════════════════════════════

-- EVAL Q1: late FIRST delivery vs 30-day repeat. Mixpanel recipe: Funnels order delivered
-- (filter: first time ever) -> order placed, 30-day window, new customers, Jun 4 - Aug 31.
-- first_delivery keeps each new customer's first delivery (rn = 1), which is what the
-- first-time-ever filter selects.
SELECT CASE WHEN late < 0 THEN 'a: early' WHEN late < 10 THEN 'b: 0-9 late' WHEN late < 15 THEN 'c: 10-14 late' WHEN late < 20 THEN 'd: 15-19 late' ELSE 'e: 20+ late' END AS bucket,
 count(*) AS new_customers, round(avg(repeat30::INT), 4) AS repeat_rate_30d
FROM first_delivery WHERE t < TIMESTAMP '2026-09-01' GROUP BY 1 ORDER BY 1;
-- late vs on time at the 15-minute and the 20-minute (company KPI) cutoff
SELECT cutoff, count(*) FILTER (WHERE late >= cutoff) AS late_first_orders, round(avg(repeat30::INT) FILTER (WHERE late >= cutoff), 4) AS late_repeat_30d,
 count(*) FILTER (WHERE late < cutoff) AS on_time_first_orders, round(avg(repeat30::INT) FILTER (WHERE late < cutoff), 4) AS on_time_repeat_30d,
 round(avg(repeat30::INT) FILTER (WHERE late >= cutoff) / avg(repeat30::INT) FILTER (WHERE late < cutoff), 4) AS ratio,
 round(avg((late >= cutoff)::INT), 4) AS late_first_delivery_share, count(*) AS first_deliveries
FROM first_delivery, (VALUES (15), (20)) v(cutoff) WHERE t < TIMESTAMP '2026-09-01' GROUP BY 1 ORDER BY 1;
-- the wrong recipe: the same funnel WITHOUT the first-time-ever filter. A breakdown on a step-1
-- property runs one funnel per segment, so a customer enters every bucket they have a delivery in
-- (Jun 4 - Aug 31) and converts there if any of those deliveries is followed by an order within
-- 30 days. Later deliveries by kept customers fill the late bucket.
WITH d AS (SELECT ev.uid, ev.t, ev.minutes_late::INT AS late FROM ev JOIN signups s ON s.uid = ev.uid
  WHERE ev.event = 'order delivered' AND ev.t < TIMESTAMP '2026-09-01'),
x AS (SELECT cutoff, d.uid, d.late >= cutoff AS is_late,
  EXISTS (SELECT 1 FROM ev o WHERE o.uid = d.uid AND o.event = 'order placed' AND o.t > d.t AND o.t < d.t + INTERVAL 30 DAY) AS rep
  FROM d, (VALUES (15), (20)) v(cutoff)),
r AS (SELECT cutoff, uid, is_late, bool_or(rep) AS rep FROM x GROUP BY 1, 2, 3)
SELECT cutoff, count(*) FILTER (WHERE is_late) AS late_entrants, round(avg(rep::INT) FILTER (WHERE is_late), 4) AS late_conv,
 count(*) FILTER (WHERE NOT is_late) AS on_time_entrants, round(avg(rep::INT) FILTER (WHERE NOT is_late), 4) AS on_time_conv,
 round(avg(rep::INT) FILTER (WHERE is_late) / avg(rep::INT) FILTER (WHERE NOT is_late), 4) AS ratio_without_first_time_filter
FROM r GROUP BY 1 ORDER BY 1;

-- EVAL Q2: orders on rainy vs dry days, by city
WITH o AS (SELECT city, d, count(*) AS n FROM orders GROUP BY 1, 2),
j AS (SELECT w.city, w.d, w.rainy, coalesce(o.n, 0) AS n FROM wh_ops w LEFT JOIN o ON o.city = w.city AND o.d = w.d)
SELECT city, count(*) FILTER (WHERE rainy) AS rainy_days, round(avg(n) FILTER (WHERE rainy), 1) AS orders_rainy_day,
 round(avg(n) FILTER (WHERE NOT rainy), 1) AS orders_dry_day, round(avg(n) FILTER (WHERE rainy) / avg(n) FILTER (WHERE NOT rainy), 3) AS ratio
FROM j GROUP BY 1 ORDER BY rainy_days DESC, city;
SELECT w.rainy, count(*) AS checkouts, round(avg(c.placed::INT), 4) AS checkout_conversion
FROM checkouts c JOIN wh_ops w ON w.city = c.city AND w.d = c.d GROUP BY 1 ORDER BY 1;

-- EVAL Q3: lateness and couriers per order, rainy vs dry (late = 20+ minutes, the company KPI)
SELECT w.rainy, count(*) AS orders, round(avg(o.late_min), 2) AS avg_minutes_late, round(avg((o.late_min >= 20)::INT), 4) AS late_20_share
FROM orders o JOIN wh_ops w ON w.city = o.city AND w.d = o.d WHERE o.late_min IS NOT NULL GROUP BY 1 ORDER BY 1;
SELECT rainy, round(sum(orders_dispatched) / sum(active_couriers), 3) AS orders_per_courier FROM wh_ops GROUP BY 1 ORDER BY 1;
-- within each city: rainy-day couriers and dispatched orders vs the city's dry-day average
WITH c AS (SELECT city, avg(active_couriers) FILTER (WHERE NOT rainy) AS dry_couriers, avg(orders_dispatched) FILTER (WHERE NOT rainy) AS dry_dispatched FROM wh_ops GROUP BY 1)
SELECT round(sum(w.active_couriers) / sum(c.dry_couriers), 4) AS rainy_courier_lift, round(sum(w.orders_dispatched) / sum(c.dry_dispatched), 4) AS rainy_dispatch_lift
FROM wh_ops w JOIN c ON c.city = w.city WHERE w.rainy;
WITH x AS (SELECT o.order_id, o.late_min, w.rainy, (s.order_id IS NOT NULL) AS contacted FROM orders o JOIN wh_ops w ON w.city = o.city AND w.d = o.d
  LEFT JOIN (SELECT DISTINCT order_id FROM ev WHERE event = 'support contacted') s ON s.order_id = o.order_id WHERE o.late_min IS NOT NULL)
SELECT rainy, round(avg(contacted::INT), 4) AS support_contact_rate FROM x GROUP BY 1 ORDER BY 1;

-- EVAL Q4: checkout -> order by quoted ETA band
SELECT CASE WHEN eta < 30 THEN 'a: < 30' WHEN eta < 40 THEN 'b: 30-39' WHEN eta <= 45 THEN 'c: 40-45' WHEN eta <= 50 THEN 'd: 46-50' WHEN eta <= 60 THEN 'e: 51-60' ELSE 'f: > 60' END AS quote_band,
 count(*) AS checkouts, round(avg(placed::INT), 4) AS conversion
FROM checkouts GROUP BY 1 ORDER BY 1;
SELECT round(avg((eta > 45)::INT), 4) AS share_of_checkouts_quoted_over_45 FROM checkouts;

-- EVAL Q5: the late-August dip — card vs other methods by day, and lost orders
SELECT d, round(avg(placed::INT) FILTER (WHERE payment_method = 'card'), 4) AS card_conv, round(avg(placed::INT) FILTER (WHERE payment_method <> 'card'), 4) AS other_conv,
 count(*) FILTER (WHERE payment_method = 'card') AS card_checkouts
FROM checkouts WHERE d BETWEEN DATE '2026-08-20' AND DATE '2026-09-02' GROUP BY 1 ORDER BY 1;
WITH base AS (SELECT avg(placed::INT) FILTER (WHERE payment_method = 'card') AS card_base FROM checkouts
  WHERE t >= TIMESTAMP '2026-08-11' AND t < TIMESTAMP '2026-09-12' AND NOT (d BETWEEN DATE '2026-08-25' AND DATE '2026-08-28')),
inc AS (SELECT count(*) AS card_checkouts, sum(placed::INT) AS card_orders FROM checkouts WHERE payment_method = 'card' AND d BETWEEN DATE '2026-08-25' AND DATE '2026-08-28')
SELECT inc.card_checkouts, inc.card_orders, round(base.card_base, 4) AS card_base_conv, round(inc.card_checkouts * base.card_base - inc.card_orders, 0) AS lost_card_orders,
 (SELECT count(*) FROM ev WHERE event = 'payment failed' AND decline_code = 'processor_unavailable') AS processor_failures,
 (SELECT round(avg(order_total_usd), 2) FROM orders WHERE payment_method = 'card' AND t >= TIMESTAMP '2026-08-11' AND t < TIMESTAMP '2026-09-12') AS card_avg_order_total
FROM inc, base;

-- EVAL Q6: Smart Add-ons readout (raw arm difference, pre-adjusted lift, subtotal, exposed customers)
WITH o AS (SELECT p.arm, o.items_count, o.subtotal_usd, o.t >= TIMESTAMP '2026-07-28' AS post FROM orders o JOIN prof p ON p.uid = o.uid WHERE p.arm IS NOT NULL),
g AS (SELECT arm, avg(items_count) FILTER (WHERE post) AS ia, avg(items_count) FILTER (WHERE NOT post) AS ib,
  avg(subtotal_usd) FILTER (WHERE post) AS sa, avg(subtotal_usd) FILTER (WHERE NOT post) AS sb FROM o GROUP BY 1)
SELECT round(max(ia) FILTER (WHERE arm = 'Smart Add-ons') - max(ia) FILTER (WHERE arm = 'Control'), 4) AS raw_items_diff,
 round((max(ia) FILTER (WHERE arm = 'Smart Add-ons') - max(ib) FILTER (WHERE arm = 'Smart Add-ons')) - (max(ia) FILTER (WHERE arm = 'Control') - max(ib) FILTER (WHERE arm = 'Control')), 4) AS adjusted_items_lift,
 round(max(sa) FILTER (WHERE arm = 'Smart Add-ons') - max(sa) FILTER (WHERE arm = 'Control'), 2) AS raw_subtotal_diff,
 round((max(sa) FILTER (WHERE arm = 'Smart Add-ons') - max(sb) FILTER (WHERE arm = 'Smart Add-ons')) - (max(sa) FILTER (WHERE arm = 'Control') - max(sb) FILTER (WHERE arm = 'Control')), 2) AS adjusted_subtotal_lift
FROM g;
SELECT "Variant name" AS arm, count(DISTINCT uid) AS exposed_customers FROM ev WHERE event = '$experiment_started' GROUP BY 1 ORDER BY 1;
SELECT count(*) AS addon_items, round(avg(item_price_usd), 2) AS avg_addon_price FROM ev WHERE event = 'item added to cart' AND added_from = 'addon_suggestion';
-- arm balance: household mix of enrolled customers (items per order follow household size)
SELECT arm, count(*) AS customers, round(avg((household_type = 'single')::INT), 4) AS single_share, round(avg((household_type = 'family')::INT), 4) AS family_share
FROM prof WHERE arm IS NOT NULL GROUP BY 1 ORDER BY 1;

-- EVAL Q7: Smart Add-ons and checkout conversion (null), overall and by platform / Pass
WITH x AS (SELECT p.arm, c.platform, c.pass, c.placed FROM checkouts c JOIN prof p ON p.uid = c.uid WHERE p.arm IS NOT NULL AND c.t >= TIMESTAMP '2026-07-28'),
g AS (SELECT 'all' AS split, arm, count(*) AS n, avg(placed::INT) AS conv FROM x GROUP BY 2
  UNION ALL SELECT 'platform=' || platform, arm, count(*), avg(placed::INT) FROM x GROUP BY 1, 2
  UNION ALL SELECT 'pass=' || pass::VARCHAR, arm, count(*), avg(placed::INT) FROM x GROUP BY 1, 2),
w AS (SELECT split, max(n) FILTER (WHERE arm = 'Control') AS n_c, max(conv) FILTER (WHERE arm = 'Control') AS c,
  max(n) FILTER (WHERE arm = 'Smart Add-ons') AS n_v, max(conv) FILTER (WHERE arm = 'Smart Add-ons') AS v FROM g GROUP BY 1)
SELECT split, n_c, round(c, 4) AS control_conv, n_v, round(v, 4) AS variant_conv,
 round((v - c) / sqrt(((c * n_c + v * n_v) / (n_c + n_v)) * (1 - (c * n_c + v * n_v) / (n_c + n_v)) * (1.0 / n_c + 1.0 / n_v)), 2) AS z
FROM w ORDER BY split;

-- EVAL Q8: paid channel CAC (spend / Mixpanel signups) and network-reported signups
WITH s AS (SELECT ch, count(*) AS signups FROM signups GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend, sum(network_reported_signups) AS network_signups FROM wh_mkt GROUP BY 1)
SELECT s.ch, s.signups, round(sp.spend, 0) AS spend_usd, round(sp.spend / s.signups, 2) AS cac, sp.network_signups, round(sp.spend / sp.network_signups, 2) AS cost_per_network_signup
FROM s LEFT JOIN sp ON sp.ch = s.ch ORDER BY s.ch;

-- EVAL Q9: 30-day repeat rate by acquisition channel (new customers, first deliveries through Aug 31)
SELECT ch, count(*) AS first_orders, round(avg(repeat30::INT), 4) AS repeat_rate_30d
FROM first_delivery WHERE t < TIMESTAMP '2026-09-01' GROUP BY 1 ORDER BY 1;
SELECT ch = 'coupon_affiliates' AS coupon, count(*) AS first_orders, round(avg(repeat30::INT), 4) AS repeat_rate_30d FROM first_delivery WHERE t < TIMESTAMP '2026-09-01' GROUP BY 1 ORDER BY 1;
-- first-order rate by channel (signups through Aug 31)
SELECT s.ch, count(*) AS signups, round(avg((f.uid IS NOT NULL)::INT), 4) AS first_order_rate
FROM signups s LEFT JOIN (SELECT DISTINCT uid FROM orders) f ON f.uid = s.uid WHERE s.t0 < TIMESTAMP '2026-09-01' GROUP BY 1 ORDER BY 1;

-- EVAL Q10: Pass trial conversion by orders during the trial
WITH s AS (SELECT uid, min(t) AS ts FROM ev WHERE event = 'pass trial started' GROUP BY 1),
e AS (SELECT uid, outcome, orders_during_trial AS n FROM ev WHERE event = 'pass trial ended')
SELECT least(e.n, 4) AS orders_during_trial_capped, count(*) AS trials, round(avg((e.outcome = 'converted')::INT), 4) AS converted
FROM e JOIN s ON s.uid = e.uid WHERE s.ts < TIMESTAMP '2026-09-17 23:59:59' GROUP BY 1 ORDER BY 1;
WITH s AS (SELECT uid, min(t) AS ts FROM ev WHERE event = 'pass trial started' GROUP BY 1),
e AS (SELECT uid, outcome, orders_during_trial AS n FROM ev WHERE event = 'pass trial ended')
SELECT count(*) AS completed_trials, round(avg((outcome = 'converted')::INT), 4) AS overall_conversion, round(avg((n >= 2)::INT), 4) AS share_with_2plus
FROM e JOIN s ON s.uid = e.uid WHERE s.ts < TIMESTAMP '2026-09-17 23:59:59';

-- EVAL Q11: subtotal distribution near the $15 free-delivery minimum, Pass vs non-Pass orders
SELECT CASE WHEN subtotal_usd < 10 THEN 'a: < 10' WHEN subtotal_usd < 15 THEN 'b: 10-14.99' WHEN subtotal_usd < 20 THEN 'c: 15-19.99' WHEN subtotal_usd < 30 THEN 'd: 20-29.99' ELSE 'e: 30+' END AS band,
 round(count(*) FILTER (WHERE pass)::DOUBLE / (SELECT count(*) FROM orders WHERE pass), 4) AS pass_share,
 round(count(*) FILTER (WHERE NOT pass)::DOUBLE / (SELECT count(*) FROM orders WHERE NOT pass), 4) AS non_pass_share
FROM orders GROUP BY 1 ORDER BY 1;
SELECT pass, round(avg((delivery_fee_usd = 0)::INT), 4) AS free_delivery_share, round(avg(subtotal_usd), 2) AS avg_subtotal FROM orders GROUP BY 1 ORDER BY 1;

-- EVAL Q12: service fee change — conversion and service-fee revenue per non-Pass checkout
WITH g AS (SELECT pass, t >= TIMESTAMP '2026-08-11' AS post, count(*) AS n, avg(placed::INT) AS conv FROM checkouts
  WHERE NOT (d BETWEEN DATE '2026-08-25' AND DATE '2026-08-28') GROUP BY 1, 2)
SELECT pass, post, n AS checkouts, round(conv, 4) AS conversion FROM g ORDER BY 1, 2;
WITH c AS (SELECT c.t >= TIMESTAMP '2026-08-11' AS post, o.service_fee_usd, o.order_total_usd FROM checkouts c LEFT JOIN orders o ON o.order_id = c.order_id
  WHERE NOT c.pass AND NOT (c.d BETWEEN DATE '2026-08-25' AND DATE '2026-08-28'))
SELECT post, count(*) AS non_pass_checkouts, round(sum(coalesce(service_fee_usd, 0)) / count(*), 3) AS service_fee_per_checkout,
 round(avg(service_fee_usd), 3) AS service_fee_per_order, round(sum(coalesce(order_total_usd, 0)) / count(*), 2) AS order_total_per_checkout
FROM c GROUP BY 1 ORDER BY 1;

-- EVAL Q13: Order Again — speed and session order rate
SELECT CASE WHEN entry_point = 'reorder' THEN 'reorder' ELSE 'browse' END AS path, count(*) AS orders,
 round(median(date_diff('second', t, tp)) / 60.0, 2) AS median_minutes
FROM sessions WHERE t >= TIMESTAMP '2026-07-07' AND tp IS NOT NULL GROUP BY 1 ORDER BY 1;
-- session order rate as an Insights formula (cohort: did reorder tapped; one reorder tapped per Order Again visit)
WITH x AS (SELECT * FROM ev WHERE t >= TIMESTAMP '2026-07-07' AND uid IN (SELECT uid FROM ev WHERE event = 'reorder tapped')),
k AS (SELECT count(*) FILTER (WHERE event = 'order placed' AND entry_point = 'reorder') AS a, count(*) FILTER (WHERE event = 'reorder tapped') AS b,
  count(*) FILTER (WHERE event = 'order placed' AND entry_point <> 'reorder') AS c, count(*) FILTER (WHERE event = 'app opened') AS d FROM x)
SELECT a AS reorder_orders, b AS reorder_taps, c AS browse_orders, d - b AS browse_visits,
 round(a / b, 4) AS reorder_order_rate, round(c / (d - b), 4) AS browse_order_rate, round((a / b) / (c / (d - b)), 4) AS ratio FROM k;

-- EVAL Q14: Order Again share of orders by week, and customers who used it
SELECT date_trunc('week', t)::DATE AS week, count(*) AS orders, round(avg((entry_point = 'reorder')::INT), 4) AS reorder_share
FROM orders GROUP BY 1 ORDER BY 1;
SELECT count(DISTINCT uid) AS customers_used_order_again,
 round(count(DISTINCT uid)::DOUBLE / (SELECT count(DISTINCT uid) FROM orders WHERE t >= TIMESTAMP '2026-07-07'), 4) AS share_of_ordering_customers
FROM ev WHERE event = 'reorder tapped';
SELECT round(avg((entry_point = 'reorder')::INT), 4) AS september_reorder_share FROM orders WHERE t >= TIMESTAMP '2026-09-01' AND t < TIMESTAMP '2026-10-01';

-- EVAL Q15: first-order rate by signup method (null), overall and by platform / signup month /
-- channel. New customers who signed up through Aug 31; z compares each method with the other two.
WITH f AS (SELECT s.signup_method AS m, s.ch, p.platform, date_trunc('month', s.t0)::DATE AS mon, (o.uid IS NOT NULL)::INT AS y
  FROM signups s LEFT JOIN (SELECT DISTINCT uid FROM orders) o ON o.uid = s.uid LEFT JOIN prof p ON p.uid = s.uid
  WHERE s.t0 < TIMESTAMP '2026-09-01'),
g AS (SELECT 'all' AS split, m, count(*) AS n, avg(y) AS r FROM f GROUP BY 1, 2
  UNION ALL SELECT 'platform=' || platform, m, count(*), avg(y) FROM f GROUP BY 1, 2
  UNION ALL SELECT 'month=' || strftime(mon, '%Y-%m'), m, count(*), avg(y) FROM f GROUP BY 1, 2
  UNION ALL SELECT 'channel=' || ch, m, count(*), avg(y) FROM f GROUP BY 1, 2),
t AS (SELECT split, sum(n) AS nn, sum(n * r) / sum(n) AS pr FROM g GROUP BY 1)
SELECT g.split, g.m AS signup_method, g.n AS signups, round(g.r, 4) AS first_order_rate,
 round((g.r - (t.pr * t.nn - g.r * g.n) / (t.nn - g.n)) / sqrt(t.pr * (1 - t.pr) * (1.0 / g.n + 1.0 / (t.nn - g.n))), 2) AS z_vs_other_methods
FROM g JOIN t ON t.split = g.split ORDER BY 1, 2;
-- context: iOS vs Android checkout conversion (not engineered; see the dungeon JSDoc noise notes)
SELECT platform, count(*) AS checkouts, round(avg(placed::INT), 4) AS conversion FROM checkouts GROUP BY 1 ORDER BY 1;

-- EVAL Q16: Forkfly Pass footprint — members, share of orders, trials, cancellations
SELECT current_pass, count(*) AS customers FROM prof GROUP BY 1 ORDER BY 1;
SELECT round(avg(pass::INT), 4) AS pass_order_share_window,
 round(avg(pass::INT) FILTER (WHERE t < TIMESTAMP '2026-07-01'), 4) AS pass_share_june,
 round(avg(pass::INT) FILTER (WHERE t >= TIMESTAMP '2026-09-01' AND t < TIMESTAMP '2026-10-01'), 4) AS pass_share_september
FROM orders;
SELECT event, count(*) AS n FROM ev WHERE event IN ('pass offer viewed', 'pass trial started', 'pass trial ended', 'pass cancelled') GROUP BY 1 ORDER BY 1;

-- EVAL Q17: new customers per week and by channel, first-order rate
SELECT date_trunc('week', t0)::DATE AS week, count(*) AS signups FROM signups GROUP BY 1 ORDER BY 1;
SELECT ch, count(*) AS signups, round(count(*)::DOUBLE / (SELECT count(*) FROM signups), 4) AS share FROM signups GROUP BY 1 ORDER BY 2 DESC;
SELECT round(avg((f.uid IS NOT NULL)::INT), 4) AS first_order_rate FROM signups s LEFT JOIN (SELECT DISTINCT uid FROM orders) f ON f.uid = s.uid WHERE s.t0 < TIMESTAMP '2026-09-01';

-- EVAL Q18: the ordering funnel as Mixpanel builds it: Funnels app opened -> restaurant viewed ->
-- item added to cart -> checkout started -> order placed, Totals, 1-hour window, steps in order.
-- Order Again visits have no restaurant viewed or item added to cart, so this funnel counts them
-- as drop-offs at step 2; the second query splits them out and the third gives their own funnel.
-- (Cross-checked against the Mixpanel funnel emulator, Totals with re-entry: stage rates agree
-- within 0.1 point; Mixpanel shows slightly fewer step-1 entries because an app opened inside a
-- live 1-hour attempt does not start a new one.)
CREATE OR REPLACE TEMP TABLE q18_visits AS
WITH o AS (SELECT uid, t, lead(t) OVER (PARTITION BY uid ORDER BY t) AS nt FROM ev WHERE event = 'app opened'),
s1 AS (SELECT o.uid, o.t, o.nt, min(e.t) AS t1 FROM o LEFT JOIN ev e ON e.uid = o.uid AND e.event = 'restaurant viewed'
  AND e.t > o.t AND e.t < o.t + INTERVAL 60 MINUTE GROUP BY 1, 2, 3),
s2 AS (SELECT s1.uid, s1.t, s1.nt, s1.t1, min(e.t) AS t2 FROM s1 LEFT JOIN ev e ON e.uid = s1.uid AND e.event = 'item added to cart'
  AND e.t >= s1.t1 AND e.t < s1.t + INTERVAL 60 MINUTE GROUP BY 1, 2, 3, 4),
s3 AS (SELECT s2.uid, s2.t, s2.nt, s2.t1, s2.t2, min(e.t) AS t3 FROM s2 LEFT JOIN ev e ON e.uid = s2.uid AND e.event = 'checkout started'
  AND e.t >= s2.t2 AND e.t < s2.t + INTERVAL 60 MINUTE GROUP BY 1, 2, 3, 4, 5),
s4 AS (SELECT s3.uid, s3.t, s3.nt, s3.t1, s3.t2, s3.t3, min(e.t) AS t4 FROM s3 LEFT JOIN ev e ON e.uid = s3.uid AND e.event = 'order placed'
  AND e.t >= s3.t3 AND e.t < s3.t + INTERVAL 60 MINUTE GROUP BY 1, 2, 3, 4, 5, 6)
SELECT s4.*, EXISTS (SELECT 1 FROM ev r WHERE r.uid = s4.uid AND r.event = 'reorder tapped' AND r.t > s4.t
  AND r.t < s4.t + INTERVAL 60 MINUTE AND (s4.nt IS NULL OR r.t < s4.nt)) AS order_again_visit
FROM s4;
SELECT count(*) AS visits, round(avg((t1 IS NOT NULL)::INT), 4) AS restaurant_viewed, round(avg((t2 IS NOT NULL)::INT), 4) AS item_added,
 round(avg((t3 IS NOT NULL)::INT), 4) AS checkout_started, round(avg((t4 IS NOT NULL)::INT), 4) AS order_placed
FROM q18_visits;
SELECT CASE WHEN order_again_visit THEN 'order_again' ELSE 'browse' END AS visit_type, count(*) AS visits,
 round(count(*)::DOUBLE / (SELECT count(*) FROM q18_visits), 4) AS share_of_visits,
 round(avg((t1 IS NOT NULL)::INT), 4) AS restaurant_viewed, round(avg((t2 IS NOT NULL)::INT), 4) AS item_added,
 round(avg((t3 IS NOT NULL)::INT), 4) AS checkout_started, round(avg((t4 IS NOT NULL)::INT), 4) AS order_placed
FROM q18_visits GROUP BY 1 ORDER BY 1;
-- Order Again funnel (from 2026-07-07): reorder tapped -> checkout started -> order placed, Totals, 1-hour window
WITH r AS (SELECT uid, t FROM ev WHERE event = 'reorder tapped'),
c AS (SELECT r.uid, r.t, min(e.t) AS tc FROM r LEFT JOIN ev e ON e.uid = r.uid AND e.event = 'checkout started' AND e.t >= r.t AND e.t < r.t + INTERVAL 60 MINUTE GROUP BY 1, 2),
p AS (SELECT c.uid, c.t, c.tc, min(e.t) AS tp FROM c LEFT JOIN ev e ON e.uid = c.uid AND e.event = 'order placed' AND e.t >= c.tc AND e.t < c.t + INTERVAL 60 MINUTE GROUP BY 1, 2, 3)
SELECT count(*) AS reorder_taps, round(avg((tc IS NOT NULL)::INT), 4) AS checkout_started, round(avg((tp IS NOT NULL)::INT), 4) AS order_placed FROM p;
-- checkout -> order and payment failures
SELECT round(avg(placed::INT), 4) AS checkout_to_order, (SELECT count(*) FROM ev WHERE event = 'payment failed') AS payment_failures,
 (SELECT round(count(*) FILTER (WHERE event = 'payment failed')::DOUBLE / count(*) FILTER (WHERE event IN ('payment failed', 'order placed')), 4) FROM ev
  WHERE NOT (t::DATE BETWEEN DATE '2026-08-25' AND DATE '2026-08-28')) AS everyday_payment_failure_rate
FROM checkouts;

-- EVAL Q19: open-ended — quarter health snapshot by month
SELECT date_trunc('month', t)::DATE AS month, count(*) AS orders, count(DISTINCT uid) AS ordering_customers,
 round(avg((late_min >= 20)::INT), 4) AS late_20_share, round(avg(order_total_usd), 2) AS avg_order_total
FROM orders GROUP BY 1 ORDER BY 1;

-- EVAL Q20: late deliveries (20+ minutes, the company KPI) by city and rainy-day share
WITH x AS (SELECT o.city, o.late_min, w.rainy FROM orders o JOIN wh_ops w ON w.city = o.city AND w.d = o.d WHERE o.late_min IS NOT NULL)
SELECT city, count(*) AS delivered, round(avg((late_min >= 20)::INT), 4) AS late_20_share, round(avg(rainy::INT), 4) AS share_on_rainy_days,
 round(avg((late_min >= 20)::INT) FILTER (WHERE NOT rainy), 4) AS late_share_dry_days
FROM x GROUP BY 1 ORDER BY late_20_share DESC, city;
