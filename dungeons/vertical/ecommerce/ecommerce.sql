-- Marlowe & Pine (ecommerce vertical) — story-keyed and eval-keyed DuckDB queries.
--
-- Generate first (repo root):
--   node scripts/verify-runner.mjs dungeons/vertical/ecommerce/ecommerce.js verify-ecommerce
-- Run:
--   duckdb -c ".read dungeons/vertical/ecommerce/ecommerce.sql"
-- Against a gzipped export:
--   duckdb -c "SET VARIABLE data_prefix='<dir>/ecommerce'" -c ".read ecommerce.sql"
--
-- All times are UTC. Window: 2026-06-04 00:00 to 2026-10-01 23:59:59.

SET VARIABLE data_prefix = COALESCE(getvariable('data_prefix'), 'data/verify-ecommerce');

-- ─────────────────────────────────────────────────────────────────────────
-- PRELUDE: raw files, identity resolution, carts, warehouse tables
-- ─────────────────────────────────────────────────────────────────────────
-- Identity: a new user's first two events (category browsed, product viewed)
-- are anonymous (device_id only); "account created" carries user_id and
-- device_id. A device resolves to the user seen with it on any event that
-- carries both ids, the way Mixpanel merges. Every later event carries user_id.

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

CREATE OR REPLACE TEMP TABLE wh_marketing AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-marketing_spend_daily.json*', sample_size=-1, union_by_name=true);
CREATE OR REPLACE TEMP TABLE wh_carrier AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-carrier_performance_daily.json*', sample_size=-1, union_by_name=true);
CREATE OR REPLACE TEMP TABLE wh_inventory AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-inventory_daily.json*', sample_size=-1, union_by_name=true);

-- profile attributes keyed by the resolved user id
CREATE OR REPLACE TEMP TABLE prof AS
SELECT distinct_id::VARCHAR AS uid, membership, ship_country, acquisition_channel, shopper_segment, customer_since,
 "Experiment: One-Page Checkout" AS variant, created
FROM users;

-- new-user signups (one per user who created an account in the window)
CREATE OR REPLACE TEMP TABLE signups AS
SELECT uid, t AS t0, acquisition_channel AS ch, signup_method FROM ev WHERE event = 'account created';

-- one row per cart: every step of a cart shares cart_id. Converted = an order
-- within 1 day of the first add (Mixpanel Funnels: product added to cart →
-- order completed, Totals, hold cart_id constant, 1-day window).
CREATE OR REPLACE TEMP TABLE carts AS
WITH c AS (
  SELECT cart_id, any_value(uid) AS uid,
   min(t) FILTER (WHERE event = 'product added to cart') AS t_add,
   min(t) FILTER (WHERE event = 'cart viewed') AS t_cart,
   min(t) FILTER (WHERE event = 'checkout started') AS t_checkout,
   min(t) FILTER (WHERE event = 'shipping info entered') AS t_shipping,
   min(t) FILTER (WHERE event = 'payment info entered') AS t_payment,
   min(t) FILTER (WHERE event = 'order completed') AS t_ord,
   arg_min(category, t) FILTER (WHERE event = 'product added to cart') AS category,
   arg_min(product_id, t) FILTER (WHERE event = 'product added to cart') AS product_id,
   arg_min(platform, t) FILTER (WHERE event = 'product added to cart') AS platform,
   any_value(subtotal_usd) FILTER (WHERE event = 'order completed') AS subtotal_usd,
   any_value(order_total_usd) FILTER (WHERE event = 'order completed') AS order_total_usd
  FROM ev WHERE cart_id IS NOT NULL AND cart_id <> 'unassigned' GROUP BY 1)
SELECT c.*, p.membership, p.ship_country, p.variant, p.acquisition_channel,
 (t_ord IS NOT NULL AND t_ord >= t_add AND t_ord < t_add + INTERVAL 1 DAY) AS converted,
 CASE WHEN t_ord >= t_add AND t_ord < t_add + INTERVAL 1 DAY THEN date_diff('second', t_add, t_ord) END AS ttc_s
FROM c LEFT JOIN prof p ON p.uid = c.uid WHERE t_add IS NOT NULL;

-- orders with their shipment and delivery
CREATE OR REPLACE TEMP TABLE orders AS
SELECT o.uid, o.order_id, o.cart_id, o.t AS t_ord, o.subtotal_usd, o.order_total_usd, o.shipping_usd, o.discount_usd, o.discount_code,
 o.primary_category, o.membership, o.ship_country,
 s.t AS t_ship, s.shipping_carrier, d.t AS t_deliver, d.delivery_days, d.on_time
FROM ev o
LEFT JOIN (SELECT order_id, min(t) AS t, any_value(shipping_carrier) AS shipping_carrier FROM ev WHERE event = 'order shipped' GROUP BY 1) s ON s.order_id = o.order_id
LEFT JOIN (SELECT order_id, min(t) AS t, any_value(delivery_days) AS delivery_days, any_value(on_time) AS on_time FROM ev WHERE event = 'order delivered' GROUP BY 1) d ON d.order_id = o.order_id
WHERE o.event = 'order completed';

-- dataset overview
SELECT count(*) AS events, count(DISTINCT uid) AS users, (SELECT count(*) FROM users) AS profiles,
 (SELECT count(*) FROM signups) AS new_signups, (SELECT count(*) FROM orders) AS orders,
 round((SELECT sum(order_total_usd) FROM orders), 0) AS revenue_usd, min(t) AS first_event, max(t) AS last_event FROM ev;

-- identity check: anonymous events that never resolve to a user
SELECT count(*) FILTER (WHERE uid IS NULL) AS unresolved_events,
 count(*) FILTER (WHERE user_id IS NULL AND uid IS NOT NULL) AS stitched_anonymous_events FROM ev;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H1-free-shipping-threshold — standard carts bunch just above the bar ($75, then $50 from 2026-08-05)
-- ─────────────────────────────────────────────────────────────────────────
WITH o AS (SELECT membership, subtotal_usd AS s, CASE WHEN t_ord >= TIMESTAMP '2026-08-05' THEN 50 ELSE 75 END AS thr
  FROM orders WHERE ship_country = 'US')
SELECT membership, count(*) AS orders_in_window, round(avg((s < thr)::INT), 4) AS share_just_below
FROM o WHERE s >= thr - 30 AND s < thr + 30 GROUP BY 1 ORDER BY 1;

-- shipping is charged exactly on standard US orders under the threshold in force
SELECT count(*) FILTER (WHERE (shipping_usd > 0) <> (membership = 'standard' AND subtotal_usd < CASE WHEN t_ord >= TIMESTAMP '2026-08-05' THEN 50 ELSE 75 END)) AS wrong_shipping
FROM orders WHERE ship_country = 'US';

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H2-one-page-checkout-experiment — per-cart conversion ×1.2, time ×0.8 (from 2026-07-15)
-- ─────────────────────────────────────────────────────────────────────────
SELECT variant, count(*) AS carts, round(avg(converted::INT), 4) AS conversion,
 round(median(ttc_s) / 60, 1) AS median_minutes, round(avg(subtotal_usd) FILTER (WHERE converted), 2) AS avg_subtotal
FROM carts WHERE t_add >= TIMESTAMP '2026-07-15' AND variant IS NOT NULL GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H3-cross-border-duties — Canada/UK lose 45% of orders at the last step; Canada fixed 2026-09-01
-- ─────────────────────────────────────────────────────────────────────────
SELECT ship_country, (t_add >= TIMESTAMP '2026-09-01') AS from_sep_1, count(*) AS carts,
 round(avg(converted::INT), 4) AS conversion,
 round(count(t_payment)::DOUBLE / count(*), 4) AS reached_payment,
 round(avg(converted::INT) FILTER (WHERE t_payment IS NOT NULL), 4) AS payment_to_order
FROM carts GROUP BY 1, 2 ORDER BY 2, 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H4-pine-plus-checkout-speed — cart → order time ×0.5 for Pine Plus
-- ─────────────────────────────────────────────────────────────────────────
SELECT membership, count(*) AS carts, round(avg(converted::INT), 4) AS conversion, round(median(ttc_s) / 60, 1) AS median_minutes
FROM carts GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H5-carrier-disruption-repeat-orders — Northline hub disruption 2026-07-20..08-09 (warehouse join)
-- ─────────────────────────────────────────────────────────────────────────
-- each US customer's first order (by order time) that shipped on a disrupted day
-- (Northline ships US orders only, so the comparison stays within US carriers)
CREATE OR REPLACE TEMP TABLE h5_ref AS
WITH dis AS (SELECT date::DATE AS d, shipping_carrier FROM wh_carrier WHERE service_status = 'disrupted'),
ddays AS (SELECT DISTINCT d FROM dis),
r AS (SELECT uid, arg_min(shipping_carrier, t_ord) AS carrier, arg_min(t_ship, t_ord) AS t_ship, min(t_ord) AS ref_t
  FROM orders WHERE ship_country = 'US' AND t_ship::DATE IN (SELECT d FROM ddays) GROUP BY 1)
SELECT r.*, (r.carrier, r.t_ship::DATE) IN (SELECT (shipping_carrier, d) FROM dis) AS affected,
 EXISTS (SELECT 1 FROM orders o WHERE o.uid = r.uid AND o.t_ord > r.ref_t AND o.t_ord <= r.ref_t + INTERVAL 45 DAY) AS repeat_45d
FROM r;
SELECT affected, count(*) AS customers, round(avg(repeat_45d::INT), 4) AS repeat_rate_45d FROM h5_ref GROUP BY 1 ORDER BY 1;

-- delivery time of Northline parcels shipped on disrupted vs normal days
SELECT (t_ship::DATE IN (SELECT date::DATE FROM wh_carrier WHERE service_status = 'disrupted' AND shipping_carrier = 'northline')) AS disrupted,
 count(*) AS deliveries, round(avg(delivery_days), 2) AS avg_delivery_days, round(avg(on_time::INT), 4) AS on_time_share
FROM orders WHERE shipping_carrier = 'northline' AND delivery_days IS NOT NULL GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H6-paid-channel-economics — spend per signup and first-order rate by channel (warehouse join)
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE TEMP TABLE h6_channels AS
WITH s AS (SELECT ch, count(*) AS signups FROM signups GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM wh_marketing GROUP BY 1),
c AS (SELECT s.ch, count(*) AS cohort, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM orders o WHERE o.uid = s.uid AND o.t_ord >= s.t0 AND o.t_ord < s.t0 + INTERVAL 30 DAY)) AS buyers_30d
  FROM signups s WHERE s.t0 < TIMESTAMP '2026-09-01' GROUP BY 1)
SELECT s.ch, s.signups, round(sp.spend, 0) AS spend_usd, round(sp.spend / s.signups, 2) AS spend_per_signup,
 c.cohort AS signups_to_aug_31, c.buyers_30d, round(c.buyers_30d::DOUBLE / c.cohort, 4) AS first_order_rate_30d
FROM s LEFT JOIN sp ON sp.ch = s.ch LEFT JOIN c ON c.ch = s.ch;
SELECT * FROM h6_channels ORDER BY ch;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H7-labor-day-sale — 2026-09-04..09-07: per-cart conversion ×1.5 (US carts), traffic ×1.3
-- ─────────────────────────────────────────────────────────────────────────
SELECT CASE WHEN t_add >= TIMESTAMP '2026-09-04' THEN 'sale' ELSE '14_days_before' END AS period,
 count(*) AS carts, round(avg(converted::INT), 4) AS conversion
FROM carts WHERE ship_country = 'US' AND t_add >= TIMESTAMP '2026-08-21' AND t_add < TIMESTAMP '2026-09-08' GROUP BY 1 ORDER BY 1;

-- category browses per day: sale days vs the same weekdays (Fri-Mon) of the two weeks before
SELECT CASE WHEN t >= TIMESTAMP '2026-09-04' THEN 'sale' ELSE 'same_weekdays_before' END AS period,
 round(count(*)::DOUBLE / CASE WHEN t >= TIMESTAMP '2026-09-04' THEN 4 ELSE 8 END, 1) AS browses_per_day
FROM ev WHERE event = 'category browsed' AND ((t >= TIMESTAMP '2026-09-04' AND t < TIMESTAMP '2026-09-08')
  OR (t >= TIMESTAMP '2026-08-28' AND t < TIMESTAMP '2026-09-01') OR (t >= TIMESTAMP '2026-08-21' AND t < TIMESTAMP '2026-08-25'))
GROUP BY 1, (t >= TIMESTAMP '2026-09-04') ORDER BY 1;

-- every sale order carries LABORDAY25, no other order does
SELECT count(*) FILTER (WHERE (discount_code = 'LABORDAY25') <> (t_ord >= TIMESTAMP '2026-09-04' AND t_ord < TIMESTAMP '2026-09-08')) AS mismatched FROM orders;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H8-wishlist-magic-number — day-45 retention by first-14-day wishlist saves (new users)
-- ─────────────────────────────────────────────────────────────────────────
-- shopper actions exclude the server-side order shipped / order delivered
CREATE OR REPLACE TEMP TABLE h8_users AS
SELECT s.uid, s.t0,
 count(*) FILTER (WHERE e.event = 'product added to wishlist' AND e.t < s.t0 + INTERVAL 14 DAY) AS saves_14d,
 count(*) FILTER (WHERE e.event NOT IN ('order shipped', 'order delivered') AND e.t >= s.t0 + INTERVAL 7 DAY AND e.t < s.t0 + INTERVAL 14 DAY) AS act_d7,
 count(*) FILTER (WHERE e.event NOT IN ('order shipped', 'order delivered') AND e.t >= s.t0 + INTERVAL 30 DAY AND e.t < s.t0 + INTERVAL 37 DAY) AS act_d30,
 count(*) FILTER (WHERE e.event NOT IN ('order shipped', 'order delivered') AND e.t >= s.t0 + INTERVAL 45 DAY AND e.t < s.t0 + INTERVAL 52 DAY) AS act_d45
FROM signups s JOIN ev e ON e.uid = s.uid GROUP BY 1, 2;
SELECT CASE WHEN saves_14d >= 3 THEN '3+' ELSE saves_14d::VARCHAR END AS saves_14d, count(*) AS new_users,
 round(avg((act_d45 > 0)::INT), 4) AS d45_retention
FROM h8_users WHERE t0 < TIMESTAMP '2026-10-01 23:59:59' - INTERVAL 52 DAY GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H9-room-visualizer-launch — 2026-07-22: furniture/lighting carts with a visualizer session convert ×1.4 (US)
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE TEMP TABLE h9_carts AS
SELECT c.*, EXISTS (SELECT 1 FROM ev v WHERE v.event = 'room visualizer opened' AND v.uid = c.uid AND v.product_id = c.product_id
  AND v.t <= c.t_add AND v.t > c.t_add - INTERVAL 10 MINUTE) AS used_visualizer
FROM carts c WHERE c.category IN ('furniture', 'lighting') AND c.t_add >= TIMESTAMP '2026-07-22';
SELECT used_visualizer, count(*) AS carts, round(avg(converted::INT), 4) AS conversion
FROM h9_carts WHERE ship_country = 'US' GROUP BY 1 ORDER BY 1;
SELECT round(avg(used_visualizer::INT), 4) AS share_of_carts_from_aug_12,
 (SELECT count(*) FROM ev WHERE event = 'room visualizer opened' AND t < TIMESTAMP '2026-07-22') AS pre_launch_events
FROM h9_carts WHERE ship_country = 'US' AND t_add >= TIMESTAMP '2026-08-12';

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H10-bedding-stockout — 2026-08-10..08-30: bedding adds per view ×0.6 (warehouse join)
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE TEMP TABLE h10_days AS
SELECT date::DATE AS d FROM wh_inventory WHERE primary_category = 'bedding' AND in_stock_rate < 0.8;
-- control categories never bought as small add-ons (furniture, lighting, outdoor)
WITH w AS (SELECT category = 'bedding' AS bedding, t::DATE IN (SELECT d FROM h10_days) AS stockout, event FROM ev
  WHERE event IN ('product viewed', 'product added to cart') AND category IN ('bedding', 'furniture', 'lighting', 'outdoor')
  AND t >= (SELECT min(d) FROM h10_days) - INTERVAL 11 DAY AND t < (SELECT max(d) FROM h10_days) + INTERVAL 12 DAY)
SELECT bedding, stockout, round(count(*) FILTER (WHERE event = 'product added to cart')::DOUBLE / count(*) FILTER (WHERE event = 'product viewed'), 4) AS adds_per_view
FROM w GROUP BY 1, 2 ORDER BY 1, 2;
SELECT min(d) AS first_day, max(d) AS last_day, count(*) AS days,
 (SELECT round(avg(in_stock_rate), 3) FROM wh_inventory WHERE primary_category = 'bedding' AND date::DATE IN (SELECT d FROM h10_days)) AS bedding_in_stock_rate
FROM h10_days;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL QUERIES (eval/ecommerce.eval.md)
-- ─────────────────────────────────────────────────────────────────────────

-- EVAL Q1 — One-Page Checkout result (per cart, from 2026-07-15)
SELECT variant, count(DISTINCT uid) AS shoppers, count(*) AS carts, count(*) FILTER (WHERE converted) AS orders,
 round(avg(converted::INT), 4) AS conversion, round(median(ttc_s) / 60, 1) AS median_minutes
FROM carts WHERE t_add >= TIMESTAMP '2026-07-15' AND variant IS NOT NULL GROUP BY 1 ORDER BY 1;
-- two-proportion z on per-cart conversion
WITH g AS (SELECT variant, count(*) AS n, avg(converted::INT) AS p FROM carts WHERE t_add >= TIMESTAMP '2026-07-15' AND variant IS NOT NULL GROUP BY 1),
x AS (SELECT max(p) FILTER (WHERE variant = 'One-Page') AS p1, max(n) FILTER (WHERE variant = 'One-Page') AS n1,
  max(p) FILTER (WHERE variant = 'Control') AS p0, max(n) FILTER (WHERE variant = 'Control') AS n0 FROM g)
SELECT round(p1 / p0, 3) AS lift_ratio, round((p1 - p0) / sqrt(p1 * (1 - p1) / n1 + p0 * (1 - p0) / n0), 1) AS z FROM x;

-- EVAL Q2 — null: One-Page Checkout and basket size (orders from carts started Jul 15 onward)
CREATE OR REPLACE TEMP TABLE q2_orders AS
SELECT c.variant, c.platform, c.membership, c.order_total_usd, o.item_count
FROM carts c JOIN (SELECT cart_id, item_count FROM ev WHERE event = 'order completed') o ON o.cart_id = c.cart_id
WHERE c.t_add >= TIMESTAMP '2026-07-15' AND c.variant IS NOT NULL AND c.converted;
SELECT variant, count(*) AS orders, round(avg(item_count), 3) AS items_per_order, round(median(order_total_usd), 2) AS median_order_total,
 round(avg(order_total_usd), 2) AS mean_order_total FROM q2_orders GROUP BY 1 ORDER BY 1;
-- Welch z: items per order, and log order total (order values are heavy-tailed)
WITH g AS (SELECT variant, count(*) AS n, avg(item_count) AS mi, var_samp(item_count) AS vi,
  avg(ln(order_total_usd)) AS ml, var_samp(ln(order_total_usd)) AS vl, avg(order_total_usd) AS mo, var_samp(order_total_usd) AS vo FROM q2_orders GROUP BY 1),
x AS (SELECT * FROM g WHERE variant = 'One-Page'), y AS (SELECT * FROM g WHERE variant = 'Control')
SELECT round((x.mi - y.mi) / sqrt(x.vi / x.n + y.vi / y.n), 2) AS z_items, round((x.ml - y.ml) / sqrt(x.vl / x.n + y.vl / y.n), 2) AS z_log_order_total,
 round((x.mo - y.mo) / sqrt(x.vo / x.n + y.vo / y.n), 2) AS z_mean_order_total FROM x, y;
-- sub-splits: items per order by platform of the cart and by membership
SELECT platform, variant, count(*) AS orders, round(avg(item_count), 3) AS items_per_order FROM q2_orders GROUP BY 1, 2 ORDER BY 1, 2;
SELECT membership, variant, count(*) AS orders, round(avg(item_count), 3) AS items_per_order FROM q2_orders GROUP BY 1, 2 ORDER BY 1, 2;
WITH g AS (SELECT platform AS seg, variant, count(*) AS n, avg(item_count) AS m, var_samp(item_count) AS v FROM q2_orders GROUP BY 1, 2
  UNION ALL SELECT membership AS seg, variant, count(*), avg(item_count), var_samp(item_count) FROM q2_orders GROUP BY 1, 2)
SELECT a.seg, round((a.m - b.m) / sqrt(a.v / a.n + b.v / b.n), 2) AS z_items FROM g a JOIN g b ON a.seg = b.seg AND a.variant = 'One-Page' AND b.variant = 'Control' ORDER BY 1;

-- EVAL Q3 — cross-border conversion and the Canada duties-included pilot
SELECT ship_country, (t_add >= TIMESTAMP '2026-09-01') AS from_sep_1, count(*) AS carts, round(avg(converted::INT), 4) AS conversion,
 round(avg(converted::INT) FILTER (WHERE t_payment IS NOT NULL), 4) AS payment_to_order,
 round(avg((t_payment IS NOT NULL)::INT) FILTER (WHERE t_shipping IS NOT NULL), 4) AS shipping_to_payment
FROM carts GROUP BY 1, 2 ORDER BY 2, 1;

-- EVAL Q4 — free-shipping bunching (US orders, ±$30 around the threshold in force)
WITH o AS (SELECT membership, subtotal_usd AS s, CASE WHEN t_ord >= TIMESTAMP '2026-08-05' THEN 50 ELSE 75 END AS thr, t_ord >= TIMESTAMP '2026-08-05' AS after_change
  FROM orders WHERE ship_country = 'US')
SELECT membership, after_change, count(*) FILTER (WHERE s >= thr - 30 AND s < thr) AS just_below, count(*) FILTER (WHERE s >= thr AND s < thr + 30) AS just_above,
 round(avg((s < thr)::INT) FILTER (WHERE s >= thr - 30 AND s < thr + 30), 4) AS share_below
FROM o GROUP BY 1, 2 ORDER BY 1, 2;
WITH o AS (SELECT membership, subtotal_usd AS s, CASE WHEN t_ord >= TIMESTAMP '2026-08-05' THEN 50 ELSE 75 END AS thr FROM orders WHERE ship_country = 'US')
SELECT membership, round(avg((s < thr)::INT) FILTER (WHERE s >= thr - 30 AND s < thr + 30), 4) AS share_below_pooled FROM o GROUP BY 1 ORDER BY 1;
-- $5 buckets $40-$100 for standard US orders, before vs after the change
SELECT floor(subtotal_usd / 5) * 5 AS bucket, count(*) FILTER (WHERE t_ord < TIMESTAMP '2026-08-05') AS before_aug_5, count(*) FILTER (WHERE t_ord >= TIMESTAMP '2026-08-05') AS from_aug_5
FROM orders WHERE ship_country = 'US' AND membership = 'standard' AND subtotal_usd >= 40 AND subtotal_usd < 100 GROUP BY 1 ORDER BY 1;

-- EVAL Q5 — the 2026-08-05 threshold change: free-shipping share and order size (standard US orders)
SELECT (t_ord >= TIMESTAMP '2026-08-05') AS from_aug_5, count(*) AS orders,
 round(count(*)::DOUBLE / count(DISTINCT t_ord::DATE), 1) AS orders_per_day,
 round(avg((shipping_usd = 0)::INT), 4) AS free_shipping_share,
 round(avg(subtotal_usd), 2) AS avg_subtotal, round(median(subtotal_usd), 2) AS median_subtotal,
 round(sum(shipping_usd), 0) AS shipping_revenue_usd, round(sum(shipping_usd) / count(DISTINCT t_ord::DATE), 1) AS shipping_revenue_per_day
FROM orders WHERE ship_country = 'US' AND membership = 'standard' GROUP BY 1 ORDER BY 1;
-- share of standard US orders under $75 / under $50 before vs after
SELECT (t_ord >= TIMESTAMP '2026-08-05') AS from_aug_5, round(avg((subtotal_usd < 75)::INT), 4) AS share_under_75,
 round(avg((subtotal_usd < 50)::INT), 4) AS share_under_50
FROM orders WHERE ship_country = 'US' AND membership = 'standard' GROUP BY 1 ORDER BY 1;

-- EVAL Q6 — checkout time by membership (median first add → order, converted carts)
SELECT membership, count(*) FILTER (WHERE converted) AS orders, round(median(ttc_s) / 60, 1) AS median_minutes,
 round(avg(ttc_s) / 60, 1) AS mean_minutes, round(avg(converted::INT), 4) AS conversion
FROM carts GROUP BY 1 ORDER BY 1;
SELECT membership, variant, round(median(ttc_s) / 60, 1) AS median_minutes FROM carts
WHERE t_add >= TIMESTAMP '2026-07-15' AND variant IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 2;

-- EVAL Q7 — repeat orders after the Northline disruption (US customers whose order shipped Jul 20 - Aug 9)
SELECT carrier, affected, count(*) AS customers, round(avg(repeat_45d::INT), 4) AS repeat_rate_45d FROM h5_ref GROUP BY 1, 2 ORDER BY 1;
SELECT affected, count(*) AS customers, round(avg(repeat_45d::INT), 4) AS repeat_rate_45d FROM h5_ref GROUP BY 1 ORDER BY 1;
-- 45-day repeat rate by the 21-day window in which a US customer's first order of the period shipped (any carrier).
-- Only windows whose 45-day follow-up ends before Oct 1 are compared.
WITH r AS (SELECT uid, min(t_ord) AS ref_t, CASE WHEN min(t_ship) < TIMESTAMP '2026-07-20' THEN 'a_jun_29_jul_19' ELSE 'b_jul_20_aug_09' END AS win
  FROM orders WHERE ship_country = 'US' AND t_ship >= TIMESTAMP '2026-06-29' AND t_ship < TIMESTAMP '2026-08-10' GROUP BY 1)
SELECT win, count(*) AS customers, round(avg((EXISTS (SELECT 1 FROM orders o WHERE o.uid = r.uid AND o.t_ord > r.ref_t AND o.t_ord <= r.ref_t + INTERVAL 45 DAY))::INT), 4) AS repeat_rate_45d
FROM r GROUP BY 1 ORDER BY 1;

-- EVAL Q8 — carrier performance (warehouse) and delivery days (events)
SELECT shipping_carrier, service_status, count(*) AS days, round(avg(on_time_rate), 3) AS avg_on_time_rate, round(avg(avg_transit_days), 2) AS avg_transit_days,
 sum(parcels_shipped)::BIGINT AS parcels, sum(late_parcels)::BIGINT AS late_parcels, min(date) AS first_day, max(date) AS last_day
FROM wh_carrier GROUP BY 1, 2 ORDER BY 1, 2;
SELECT shipping_carrier, count(*) AS deliveries, round(avg(delivery_days), 2) AS avg_delivery_days, round(avg(on_time::INT), 4) AS on_time_share
FROM orders WHERE delivery_days IS NOT NULL GROUP BY 1 ORDER BY 1;
SELECT (t_ship >= TIMESTAMP '2026-07-20' AND t_ship < TIMESTAMP '2026-08-10') AS shipped_jul20_aug9, count(*) AS northline_deliveries,
 round(avg(delivery_days), 2) AS avg_delivery_days, round(avg(on_time::INT), 4) AS on_time_share
FROM orders WHERE delivery_days IS NOT NULL AND shipping_carrier = 'northline' GROUP BY 1 ORDER BY 1;

-- EVAL Q9 — CAC by paid channel (spend per signup, per 30-day first order)
SELECT ch, signups, spend_usd, spend_per_signup, signups_to_aug_31, buyers_30d, first_order_rate_30d,
 round(spend_usd * signups_to_aug_31::DOUBLE / signups / nullif(buyers_30d, 0), 2) AS spend_per_first_order
FROM h6_channels ORDER BY ch;
SELECT acquisition_channel, round(sum(spend_usd), 0) AS spend, sum(platform_attributed_purchases)::BIGINT AS platform_claimed_purchases,
 sum(clicks)::BIGINT AS clicks, sum(impressions)::BIGINT AS impressions FROM wh_marketing GROUP BY 1 ORDER BY 1;

-- EVAL Q10 — Labor Day sale (2026-09-04..09-07) vs the 14 days before
SELECT CASE WHEN t_ord >= TIMESTAMP '2026-09-04' THEN 'sale_4_days' ELSE '14_days_before' END AS period,
 count(*) AS orders, round(count(*)::DOUBLE / CASE WHEN t_ord >= TIMESTAMP '2026-09-04' THEN 4 ELSE 14 END, 1) AS orders_per_day,
 round(sum(order_total_usd), 0) AS revenue, round(sum(order_total_usd) / CASE WHEN t_ord >= TIMESTAMP '2026-09-04' THEN 4 ELSE 14 END, 0) AS revenue_per_day,
 round(avg(order_total_usd), 2) AS aov, round(sum(discount_usd), 0) AS discounts
FROM orders WHERE t_ord >= TIMESTAMP '2026-08-21' AND t_ord < TIMESTAMP '2026-09-08' GROUP BY 1, (t_ord >= TIMESTAMP '2026-09-04') ORDER BY 1;
SELECT CASE WHEN t_add >= TIMESTAMP '2026-09-04' THEN 'sale' ELSE '14_days_before' END AS period, count(*) AS carts,
 round(count(*)::DOUBLE / CASE WHEN t_add >= TIMESTAMP '2026-09-04' THEN 4 ELSE 14 END, 1) AS carts_per_day, round(avg(converted::INT), 4) AS conversion_all,
 round(avg(converted::INT) FILTER (WHERE ship_country = 'US'), 4) AS conversion_us
FROM carts WHERE t_add >= TIMESTAMP '2026-08-21' AND t_add < TIMESTAMP '2026-09-08' GROUP BY 1, (t_add >= TIMESTAMP '2026-09-04') ORDER BY 1;
SELECT CASE WHEN t >= TIMESTAMP '2026-09-04' THEN 'sale' ELSE 'same_weekdays_before' END AS period,
 round(count(*) FILTER (WHERE event = 'product viewed')::DOUBLE / CASE WHEN t >= TIMESTAMP '2026-09-04' THEN 4 ELSE 8 END, 0) AS product_views_per_day,
 round(count(*) FILTER (WHERE event = 'category browsed')::DOUBLE / CASE WHEN t >= TIMESTAMP '2026-09-04' THEN 4 ELSE 8 END, 0) AS category_browses_per_day
FROM ev WHERE (t >= TIMESTAMP '2026-09-04' AND t < TIMESTAMP '2026-09-08') OR (t >= TIMESTAMP '2026-08-28' AND t < TIMESTAMP '2026-09-01') OR (t >= TIMESTAMP '2026-08-21' AND t < TIMESTAMP '2026-08-25')
GROUP BY 1, (t >= TIMESTAMP '2026-09-04') ORDER BY 1;

-- EVAL Q11 — early behavior and new-user retention (signups through Aug 10; day-N = a shopper action in days N to N+6)
SELECT CASE WHEN saves_14d >= 5 THEN '5+' ELSE saves_14d::VARCHAR END AS saves_14d, count(*) AS new_users,
 round(avg((act_d7 > 0)::INT), 4) AS d7, round(avg((act_d30 > 0)::INT), 4) AS d30, round(avg((act_d45 > 0)::INT), 4) AS d45
FROM h8_users WHERE t0 < TIMESTAMP '2026-10-01 23:59:59' - INTERVAL 52 DAY GROUP BY 1 ORDER BY 1;
SELECT (saves_14d >= 3) AS three_plus, count(*) AS new_users, round(avg((act_d45 > 0)::INT), 4) AS d45, round(avg((act_d30 > 0)::INT), 4) AS d30
FROM h8_users WHERE t0 < TIMESTAMP '2026-10-01 23:59:59' - INTERVAL 52 DAY GROUP BY 1 ORDER BY 1;
-- an order in the first 14 days as an alternative signal
WITH f AS (SELECT h.*, (SELECT count(*) FROM orders o WHERE o.uid = h.uid AND o.t_ord < h.t0 + INTERVAL 14 DAY) AS orders_14d
  FROM h8_users h WHERE t0 < TIMESTAMP '2026-10-01 23:59:59' - INTERVAL 52 DAY)
SELECT (orders_14d > 0) AS ordered_in_14d, count(*) AS new_users, round(avg((act_d45 > 0)::INT), 4) AS d45 FROM f GROUP BY 1 ORDER BY 1;

-- EVAL Q12 — Room Visualizer (launched 2026-07-22)
SELECT used_visualizer, count(*) AS carts, round(avg(converted::INT), 4) AS conversion FROM h9_carts WHERE ship_country = 'US' GROUP BY 1 ORDER BY 1;
SELECT used_visualizer, count(*) AS carts, round(avg(converted::INT), 4) AS conversion FROM h9_carts GROUP BY 1 ORDER BY 1;
SELECT date_trunc('week', t_add)::DATE AS week, count(*) AS furniture_lighting_carts, round(avg(used_visualizer::INT), 4) AS visualizer_share
FROM h9_carts GROUP BY 1 ORDER BY 1;
SELECT count(DISTINCT uid) AS visualizer_users, count(*) AS visualizer_opens FROM ev WHERE event = 'room visualizer opened';
-- furniture and lighting cart conversion before vs after launch (US)
SELECT (t_add >= TIMESTAMP '2026-07-22') AS after_launch, count(*) AS furniture_lighting_carts, round(avg(converted::INT), 4) AS conversion
FROM carts WHERE category IN ('furniture', 'lighting') AND ship_country = 'US' GROUP BY 1 ORDER BY 1;

-- EVAL Q13 — bedding add-to-cart drop in mid-August (inventory join)
SELECT date_trunc('week', t)::DATE AS week,
 round(count(*) FILTER (WHERE event = 'product added to cart' AND category = 'bedding')::DOUBLE / count(*) FILTER (WHERE event = 'product viewed' AND category = 'bedding'), 4) AS bedding_adds_per_view,
 round(count(*) FILTER (WHERE event = 'product added to cart' AND category <> 'bedding')::DOUBLE / count(*) FILTER (WHERE event = 'product viewed' AND category <> 'bedding'), 4) AS other_adds_per_view
FROM ev WHERE event IN ('product viewed', 'product added to cart') AND t >= TIMESTAMP '2026-07-13' AND t < TIMESTAMP '2026-09-07' GROUP BY 1 ORDER BY 1;
SELECT CASE WHEN date::DATE < DATE '2026-08-10' THEN 'a_before' WHEN date::DATE < DATE '2026-08-31' THEN 'b_aug_10_30' ELSE 'c_after' END AS period,
 round(avg(in_stock_rate), 3) AS bedding_in_stock_rate, round(avg(skus_out_of_stock), 0) AS skus_out_of_stock, round(avg(units_on_hand), 0) AS units_on_hand
FROM wh_inventory WHERE primary_category = 'bedding' GROUP BY 1 ORDER BY 1;
-- bedding orders and revenue during the stockout (21 days) vs the 21 days before
SELECT CASE WHEN t_ord >= TIMESTAMP '2026-08-10' THEN 'b_aug_10_30' ELSE 'a_jul_20_aug_09' END AS period, count(*) AS bedding_orders, round(sum(order_total_usd), 0) AS bedding_revenue
FROM orders WHERE primary_category = 'bedding' AND t_ord >= TIMESTAMP '2026-07-20' AND t_ord < TIMESTAMP '2026-08-31' GROUP BY 1 ORDER BY 1;

-- EVAL Q14 — null: iOS vs Android app cart conversion
SELECT platform, count(*) AS carts, round(avg(converted::INT), 4) AS conversion FROM carts GROUP BY 1 ORDER BY 1;
WITH g AS (SELECT platform, count(*) AS n, avg(converted::INT) AS p FROM carts WHERE platform IN ('ios_app', 'android_app') GROUP BY 1),
x AS (SELECT max(p) FILTER (WHERE platform = 'ios_app') AS p1, max(n) FILTER (WHERE platform = 'ios_app') AS n1,
  max(p) FILTER (WHERE platform = 'android_app') AS p0, max(n) FILTER (WHERE platform = 'android_app') AS n0 FROM g)
SELECT round(p1 / p0, 3) AS ios_over_android, round((p1 - p0) / sqrt(p1 * (1 - p1) / n1 + p0 * (1 - p0) / n0), 2) AS z FROM x;
-- sub-splits: by experiment arm (from Jul 15) and by membership
SELECT platform, variant, count(*) AS carts, round(avg(converted::INT), 4) AS conversion FROM carts
WHERE platform IN ('ios_app', 'android_app') AND t_add >= TIMESTAMP '2026-07-15' AND variant IS NOT NULL GROUP BY 1, 2 ORDER BY 2, 1;
SELECT platform, membership, count(*) AS carts, round(avg(converted::INT), 4) AS conversion FROM carts
WHERE platform IN ('ios_app', 'android_app') GROUP BY 1, 2 ORDER BY 2, 1;

-- EVAL Q15 — null: do new movers convert carts better? (volume vs rate)
CREATE OR REPLACE TEMP TABLE q15 AS
SELECT c.*, p.shopper_segment, (p.shopper_segment = 'new_mover') AS new_mover FROM carts c JOIN prof p ON p.uid = c.uid;
SELECT shopper_segment, count(DISTINCT uid) AS shoppers, count(*) AS carts, round(count(*)::DOUBLE / count(DISTINCT uid), 2) AS carts_per_shopper,
 count(*) FILTER (WHERE converted) AS orders, round(count(*) FILTER (WHERE converted)::DOUBLE / count(DISTINCT uid), 2) AS orders_per_shopper,
 round(avg(converted::INT), 4) AS conversion FROM q15 GROUP BY 1 ORDER BY 1;
WITH g AS (SELECT new_mover, count(*) AS n, avg(converted::INT) AS p FROM q15 GROUP BY 1),
x AS (SELECT max(p) FILTER (WHERE new_mover) AS p1, max(n) FILTER (WHERE new_mover) AS n1, max(p) FILTER (WHERE NOT new_mover) AS p0, max(n) FILTER (WHERE NOT new_mover) AS n0 FROM g)
SELECT round(p1, 4) AS new_mover_conversion, round(p0, 4) AS others_conversion, round((p1 - p0) / sqrt(p1 * (1 - p1) / n1 + p0 * (1 - p0) / n0), 2) AS z FROM x;
-- sub-splits: by membership, by country group, by experiment arm (from Jul 15)
WITH s AS (SELECT membership AS seg, new_mover, converted FROM q15
  UNION ALL SELECT CASE WHEN ship_country = 'US' THEN 'us' ELSE 'intl' END, new_mover, converted FROM q15
  UNION ALL SELECT variant, new_mover, converted FROM q15 WHERE variant IS NOT NULL AND t_add >= TIMESTAMP '2026-07-15'),
g AS (SELECT seg, new_mover, count(*) AS n, avg(converted::INT) AS p FROM s GROUP BY 1, 2)
SELECT a.seg, round(a.p, 4) AS new_mover_conversion, round(b.p, 4) AS others_conversion, round((a.p - b.p) / sqrt(a.p * (1 - a.p) / a.n + b.p * (1 - b.p) / b.n), 2) AS z
FROM g a JOIN g b ON a.seg = b.seg AND a.new_mover AND NOT b.new_mover ORDER BY 1;

-- EVAL Q16 — shipments and deliveries by week (the mid-August delivery bulge)
SELECT date_trunc('week', t)::DATE AS week, count(*) FILTER (WHERE event = 'order shipped') AS shipped, count(*) FILTER (WHERE event = 'order delivered') AS delivered,
 count(*) FILTER (WHERE event = 'order delivered' AND shipping_carrier = 'northline') AS northline_delivered,
 round(avg(delivery_days) FILTER (WHERE event = 'order delivered'), 2) AS avg_delivery_days
FROM ev WHERE event IN ('order shipped', 'order delivered') GROUP BY 1 ORDER BY 1;

-- EVAL Q17 — reviews and returns after late deliveries
SELECT d.on_time, count(*) AS reviews, round(avg(r.rating), 2) AS avg_rating, round(avg((r.rating <= 2)::INT), 4) AS share_1_2_stars
FROM ev r JOIN orders d ON d.order_id = r.order_id WHERE r.event = 'review submitted' AND d.on_time IS NOT NULL GROUP BY 1 ORDER BY 1;
SELECT category, count(*) AS returns, round(count(*)::DOUBLE / (SELECT count(*) FROM orders o WHERE o.primary_category = r.category), 4) AS returns_per_order
FROM ev r WHERE event = 'return requested' GROUP BY 1 ORDER BY 3 DESC;
SELECT return_reason, count(*) AS returns FROM ev WHERE event = 'return requested' GROUP BY 1 ORDER BY 2 DESC;

-- EVAL Q18 — cart funnel step conversion (all carts, 1-day window)
SELECT count(*) AS carts,
 round(avg((t_cart IS NOT NULL)::INT), 4) AS to_cart_viewed,
 round(avg((t_checkout IS NOT NULL)::INT), 4) AS to_checkout_started,
 round(avg((t_shipping IS NOT NULL)::INT), 4) AS to_shipping,
 round(avg((t_payment IS NOT NULL)::INT), 4) AS to_payment,
 round(avg(converted::INT), 4) AS to_order
FROM carts;
SELECT ship_country, round(avg(converted::INT) FILTER (WHERE t_payment IS NOT NULL), 4) AS payment_to_order,
 round(avg((t_checkout IS NOT NULL)::INT) FILTER (WHERE t_cart IS NOT NULL), 4) AS cart_to_checkout
FROM carts GROUP BY 1 ORDER BY 1;
SELECT category, count(*) AS carts, round(avg(converted::INT), 4) AS conversion FROM carts GROUP BY 1 ORDER BY 3;

-- EVAL Q19 — Q4 risk scan: monthly orders and revenue, September conversion by country
SELECT date_trunc('month', t_ord)::DATE AS month, count(*) AS orders, round(sum(order_total_usd), 0) AS revenue, round(avg(order_total_usd), 2) AS aov
FROM orders GROUP BY 1 ORDER BY 1;
SELECT ship_country, count(*) FILTER (WHERE t_add >= TIMESTAMP '2026-09-01') AS sep_carts,
 round(avg(converted::INT) FILTER (WHERE t_add >= TIMESTAMP '2026-09-01'), 4) AS sep_conversion FROM carts GROUP BY 1 ORDER BY 1;

-- EVAL Q20 — summer summary: new signups, buyers, orders, revenue, repeat behavior
SELECT (SELECT count(*) FROM signups) AS new_signups,
 (SELECT count(DISTINCT uid) FROM orders) AS buyers,
 (SELECT count(*) FROM orders) AS orders,
 (SELECT round(sum(order_total_usd), 0) FROM orders) AS revenue,
 (SELECT round(avg(order_total_usd), 2) FROM orders) AS aov,
 (SELECT round(count(*)::DOUBLE / count(DISTINCT uid), 2) FROM orders) AS orders_per_buyer,
 (SELECT round(avg((membership = 'pine_plus')::INT), 4) FROM orders) AS pine_plus_order_share;
