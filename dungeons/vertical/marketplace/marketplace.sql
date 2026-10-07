-- Tradepost (marketplace vertical) — story-keyed and eval-keyed DuckDB queries.
--
-- Generate first (repo root):
--   node scripts/verify-runner.mjs dungeons/vertical/marketplace/marketplace.js verify-marketplace
-- Run:
--   duckdb -c ".read dungeons/vertical/marketplace/marketplace.sql"
-- Against a gzipped export:
--   duckdb -c "SET VARIABLE data_prefix='<dir>/marketplace'" -c ".read marketplace.sql"
--
-- All times are UTC. Window: 2026-06-04 00:00 to 2026-10-01 23:59:59.
-- Timeline: casual seller fee 10% -> 12.9% 2026-07-15; Express Checkout test
-- from 2026-07-22; Back to Campus 2026-08-10 to 2026-09-07; Tradepost
-- Guarantee 2026-08-26; card processor incident 2026-09-14 to 2026-09-18.

SET VARIABLE data_prefix = COALESCE(getvariable('data_prefix'), 'data/verify-marketplace');

-- ─────────────────────────────────────────────────────────────────────────
-- PRELUDE: raw files, identity resolution, warehouse tables
-- ─────────────────────────────────────────────────────────────────────────
-- Identity: guests browse before they sign up (device_id only). "account
-- created" carries user_id and device_id, so a device resolves to the member
-- seen with it on any event that carries both ids, the way Mixpanel stitches.
-- A device never seen with a user_id would resolve to itself (the identity
-- check below counts them; there are none). Server-side events (offer answers,
-- order shipped/delivered, item sold) carry user_id only.

CREATE OR REPLACE TEMP TABLE raw_events AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-EVENTS*.json*', sample_size=-1, union_by_name=true);

CREATE OR REPLACE TEMP TABLE users AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-USERS*.json*', sample_size=-1, union_by_name=true);

CREATE OR REPLACE TEMP TABLE device_map AS
SELECT device_id, min(user_id::VARCHAR) AS mapped
FROM raw_events WHERE user_id IS NOT NULL AND device_id IS NOT NULL GROUP BY 1;

CREATE OR REPLACE TEMP TABLE ev AS
SELECT coalesce(e.user_id::VARCHAR, m.mapped, '$device:' || e.device_id) AS uid, e.time::TIMESTAMP AS t, e.*
FROM raw_events e LEFT JOIN device_map m ON e.device_id = m.device_id;

CREATE OR REPLACE TEMP TABLE wh_spend AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-marketing_spend_daily.json*', sample_size=-1, union_by_name=true);
CREATE OR REPLACE TEMP TABLE wh_pay AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-payment_processing_daily.json*', sample_size=-1, union_by_name=true);
CREATE OR REPLACE TEMP TABLE wh_ledger AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-marketplace_ledger_daily.json*', sample_size=-1, union_by_name=true);

-- profile attributes keyed by the resolved member id
CREATE OR REPLACE TEMP TABLE prof AS
SELECT distinct_id::VARCHAR AS uid, account_type, acquisition_channel, region, age_band, member_since,
 member_since < '2026-06-04' AS established, "Experiment: Express Checkout" AS variant
FROM users;

-- new-member signups (one per member who joined in the window)
CREATE OR REPLACE TEMP TABLE signups AS
SELECT uid, t AS t0, acquisition_channel AS ch FROM ev WHERE event = 'account created';

-- one row per checkout (order_id): completion within 1 day
CREATE OR REPLACE TEMP TABLE checkouts AS
SELECT *, coalesce(t1 >= t0 AND t1 < t0 + INTERVAL 1 DAY, false) AS done FROM (
 SELECT order_id, any_value(uid) AS uid,
  min(t) FILTER (WHERE event = 'checkout started') AS t0, min(t) FILTER (WHERE event = 'purchase completed') AS t1,
  any_value(item_price) FILTER (WHERE event = 'checkout started') AS price,
  any_value(payment_method) FILTER (WHERE event = 'checkout started') AS pm,
  any_value(purchase_type) FILTER (WHERE event = 'checkout started') AS purchase_type,
  any_value(platform) FILTER (WHERE event = 'checkout started') AS platform,
  any_value(category) AS category
 FROM ev WHERE event IN ('checkout started', 'purchase completed') GROUP BY 1)
WHERE t0 IS NOT NULL AND t0 < TIMESTAMP '2026-09-30 23:59:59';

-- one row per offer (offer_id): accepted within 2 days
CREATE OR REPLACE TEMP TABLE offers AS
SELECT *, coalesce(t1 >= t0 AND t1 < t0 + INTERVAL 2 DAY, false) AS accepted FROM (
 SELECT offer_id, any_value(uid) AS uid, min(t) FILTER (WHERE event = 'offer made') AS t0,
  any_value(offer_pct_of_ask) FILTER (WHERE event = 'offer made') AS pct,
  any_value(platform) FILTER (WHERE event = 'offer made') AS platform,
  min(t) FILTER (WHERE event = 'offer accepted') AS t1
 FROM ev WHERE event IN ('offer made', 'offer accepted', 'offer declined') GROUP BY 1)
WHERE t0 IS NOT NULL AND t0 < TIMESTAMP '2026-09-29 23:59:59';

-- one row per seller listing (listing_id): sold within 30 days
CREATE OR REPLACE TEMP TABLE listings AS
SELECT *, coalesce(t1 >= t0 AND t1 < t0 + INTERVAL 30 DAY, false) AS sold30, date_diff('second', t0, t1) / 86400.0 AS days FROM (
 SELECT listing_id, any_value(uid) AS uid, min(t) FILTER (WHERE event = 'listing created') AS t0, min(t) FILTER (WHERE event = 'item sold') AS t1,
  any_value(photo_count) FILTER (WHERE event = 'listing created') AS photos, any_value(category) AS category,
  bool_or(event = 'listing price dropped') AS dropped
 FROM ev WHERE event IN ('listing created', 'listing price dropped', 'item sold') GROUP BY 1)
WHERE t0 IS NOT NULL;

-- one row per completed order: purchase, shipping, delivery, review, dispute
CREATE OR REPLACE TEMP TABLE orders AS
SELECT order_id, any_value(uid) AS uid,
 min(t) FILTER (WHERE event = 'purchase completed') AS t_purchase,
 min(t) FILTER (WHERE event = 'order delivered') AS t_delivered,
 any_value(delivery_days) FILTER (WHERE event = 'order delivered') AS delivery_days,
 any_value(item_price) FILTER (WHERE event = 'purchase completed') AS price,
 any_value(seller_type) FILTER (WHERE event = 'purchase completed') AS seller_type,
 any_value(rating) FILTER (WHERE event = 'review submitted') AS rating,
 bool_or(event = 'dispute opened') AS disputed
FROM ev WHERE event IN ('purchase completed', 'order delivered', 'review submitted', 'dispute opened') GROUP BY 1;

-- dataset overview
SELECT count(*) AS events, count(DISTINCT uid) AS people_with_events, (SELECT count(*) FROM users) AS profiles,
 (SELECT count(*) FROM signups) AS new_signups, min(t) AS first_event, max(t) AS last_event FROM ev;

-- identity check: guest events, events resolved through the device map, unresolved guests
SELECT count(*) FILTER (WHERE user_id IS NULL) AS events_without_user_id,
 count(*) FILTER (WHERE user_id IS NULL AND uid NOT LIKE '$device:%') AS stitched_guest_events,
 count(DISTINCT uid) FILTER (WHERE uid LIKE '$device:%') AS anonymous_guests,
 count(*) FILTER (WHERE (platform = 'ios' AND os NOT IN ('iOS', 'iPadOS')) OR (platform = 'android' AND os <> 'Android')) AS platform_os_mismatch
FROM ev;

-- events by name
SELECT event, count(*) AS events, count(DISTINCT uid) AS people FROM ev GROUP BY 1 ORDER BY 2 DESC;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H1-seller-fee-change: casual sellers list less after 2026-07-15
-- ─────────────────────────────────────────────────────────────────────────
-- listings per day, sellers who joined before the window (a fixed group)
SELECT p.account_type, CASE WHEN e.t < TIMESTAMP '2026-07-15' THEN 'before' ELSE 'after' END AS period,
 count(DISTINCT e.uid) AS sellers,
 count(*) FILTER (WHERE e.event = 'listing created') AS listings,
 round(count(*) FILTER (WHERE e.event = 'listing created') / (CASE WHEN e.t < TIMESTAMP '2026-07-15' THEN 41 ELSE 79 END), 1) AS listings_per_day
FROM ev e JOIN prof p ON p.uid = e.uid
WHERE p.established AND p.account_type IN ('seller', 'pro_seller') AND e.event = 'listing created'
GROUP BY 1, 2, (e.t < TIMESTAMP '2026-07-15') ORDER BY 1, 2 DESC;

-- listings per day (41 days before, 79 days from Jul 15), established sellers: difference in differences
WITH g AS (
 SELECT p.account_type, e.t >= TIMESTAMP '2026-07-15' AS aft,
  count(*) / (CASE WHEN e.t >= TIMESTAMP '2026-07-15' THEN 79 ELSE 41 END) AS rate
 FROM ev e JOIN prof p ON p.uid = e.uid
 WHERE p.established AND p.account_type IN ('seller', 'pro_seller') AND e.event = 'listing created' GROUP BY 1, 2, (CASE WHEN e.t >= TIMESTAMP '2026-07-15' THEN 79 ELSE 41 END))
SELECT round(max(rate) FILTER (WHERE account_type = 'seller' AND aft) / max(rate) FILTER (WHERE account_type = 'seller' AND NOT aft), 3) AS casual_after_over_before,
 round(max(rate) FILTER (WHERE account_type = 'pro_seller' AND aft) / max(rate) FILTER (WHERE account_type = 'pro_seller' AND NOT aft), 3) AS pro_after_over_before,
 round((max(rate) FILTER (WHERE account_type = 'seller' AND aft) / max(rate) FILTER (WHERE account_type = 'seller' AND NOT aft))
  / (max(rate) FILTER (WHERE account_type = 'pro_seller' AND aft) / max(rate) FILTER (WHERE account_type = 'pro_seller' AND NOT aft)), 3) AS diff_in_diff
FROM g;

-- buyer side: casual share of listings viewed, before the change vs after the two-week drain (from 2026-07-29)
SELECT CASE WHEN t < TIMESTAMP '2026-07-15' THEN '1 before' WHEN t < TIMESTAMP '2026-07-29' THEN '2 drain' ELSE '3 after' END AS period,
 round(avg((seller_type = 'casual')::INT), 4) AS casual_share,
 round(count(*) FILTER (WHERE seller_type = 'casual')::DOUBLE / count(*) FILTER (WHERE seller_type = 'pro'), 4) AS casual_to_pro_odds
FROM ev WHERE event = 'listing viewed' GROUP BY 1 ORDER BY 1;

-- warehouse: take rate by seller type, before vs after
SELECT seller_type, date::DATE >= DATE '2026-07-15' AS after_change, round(avg(take_rate), 4) AS take_rate FROM wh_ledger GROUP BY 1, 2 ORDER BY 1, 2;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H2-express-checkout-experiment: checkouts from 2026-07-22 by arm
-- ─────────────────────────────────────────────────────────────────────────
SELECT p.variant, count(DISTINCT c.uid) AS members, count(*) AS checkouts, round(avg(c.done::INT), 4) AS conversion,
 round(median(date_diff('second', c.t0, c.t1)) FILTER (WHERE c.done) / 60.0, 2) AS median_minutes
FROM checkouts c JOIN prof p ON p.uid = c.uid
WHERE c.t0 >= TIMESTAMP '2026-07-22' AND p.variant IS NOT NULL GROUP BY 1 ORDER BY 1;

SELECT "Variant name" AS variant, count(DISTINCT uid) AS exposed_members, count(*) AS exposures,
 count(*) FILTER (WHERE t < TIMESTAMP '2026-07-22') AS before_start
FROM ev WHERE event = '$experiment_started' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H3-offer-price-threshold: acceptance by offer % of asking price
-- ─────────────────────────────────────────────────────────────────────────
SELECT CASE WHEN pct < 70 THEN '1 under 70%' WHEN pct < 80 THEN '2 70-79%' WHEN pct < 85 THEN '3 80-84%' ELSE '4 85%+' END AS bucket,
 count(*) AS offers, round(avg(accepted::INT), 4) AS accept_rate
FROM offers GROUP BY 1 ORDER BY 1;

SELECT CASE WHEN pct >= 80 THEN 'high (80%+)' ELSE 'low (<80%)' END AS bucket, count(*) AS offers, round(avg(accepted::INT), 4) AS accept_rate
FROM offers GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H4-photos-sell-through: listings created Jun 4 - Aug 31, sold within 30 days
-- ─────────────────────────────────────────────────────────────────────────
SELECT CASE WHEN photos <= 2 THEN '1-2' WHEN photos <= 4 THEN '3-4' ELSE '5+' END AS photo_band,
 count(*) AS listings, round(avg(sold30::INT), 4) AS sell_through_30d
FROM listings WHERE t0 < TIMESTAMP '2026-09-01' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H5-late-first-delivery: purchase within 30 days after the first delivery
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE TEMP TABLE first_delivery AS
WITH f AS (SELECT uid, t AS f0, delivery_days, row_number() OVER (PARTITION BY uid ORDER BY t, insert_id) AS rn FROM ev WHERE event = 'order delivered')
SELECT f.uid, f.f0, f.delivery_days,
 coalesce(bool_or(e.t > f.f0 AND e.t <= f.f0 + INTERVAL 30 DAY), false) AS repurchased_30d
FROM f LEFT JOIN ev e ON e.uid = f.uid AND e.event = 'purchase completed'
WHERE f.rn = 1 AND f.f0 <= TIMESTAMP '2026-09-01 23:59:59'
GROUP BY 1, 2, 3;

SELECT CASE WHEN delivery_days > 7 THEN 'late (> 7 days)' ELSE 'on time (<= 7 days)' END AS first_delivery,
 count(*) AS buyers, round(avg(repurchased_30d::INT), 4) AS repurchase_30d
FROM first_delivery GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H6-card-processor-incident: checkout completion by payment method
-- ─────────────────────────────────────────────────────────────────────────
SELECT date::DATE AS d, payment_method, processor_status, approval_rate, authorizations_attempted, authorizations_approved
FROM wh_pay WHERE date::DATE BETWEEN DATE '2026-09-12' AND DATE '2026-09-20' AND payment_method = 'card' ORDER BY 1;

SELECT pm = 'card' AS card, CASE WHEN t0 >= TIMESTAMP '2026-09-14' AND t0 < TIMESTAMP '2026-09-19' THEN 'incident' ELSE 'baseline' END AS period,
 count(*) AS checkouts, round(avg(done::INT), 4) AS conversion
FROM checkouts WHERE t0 >= TIMESTAMP '2026-08-31' AND t0 < TIMESTAMP '2026-10-03' GROUP BY 1, 2 ORDER BY 1, 2;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H7-paid-channel-activation: spend per signup and per activated buyer
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE TEMP TABLE activation AS
SELECT s.uid, s.ch, s.t0, coalesce(bool_or(e.t >= s.t0 AND e.t < s.t0 + INTERVAL 14 DAY), false) AS activated
FROM signups s LEFT JOIN ev e ON e.uid = s.uid AND e.event = 'purchase completed' GROUP BY 1, 2, 3;

WITH sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM wh_spend GROUP BY 1),
g AS (SELECT ch, count(*) AS signups, avg(activated::INT) FILTER (WHERE t0 < TIMESTAMP '2026-09-18') AS activation FROM activation GROUP BY 1)
SELECT g.ch, g.signups, round(g.activation, 4) AS activation_14d, round(sp.spend, 2) AS spend,
 round(sp.spend / g.signups, 2) AS spend_per_signup, round(sp.spend / g.signups / g.activation, 2) AS spend_per_activated_buyer
FROM g LEFT JOIN sp ON sp.ch = g.ch ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H8-guarantee-launch: high-ticket checkout completion before vs after 2026-08-26
-- ─────────────────────────────────────────────────────────────────────────
SELECT price >= 150 AS high_ticket, t0 >= TIMESTAMP '2026-08-26' AS after_launch, count(*) AS checkouts, round(avg(done::INT), 4) AS conversion
FROM checkouts GROUP BY 1, 2 ORDER BY 1, 2;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H9-time-to-sell-by-category: median days to sell (sold within 30 days)
-- ─────────────────────────────────────────────────────────────────────────
SELECT category, count(*) AS sales, round(median(days), 2) AS median_days_to_sell
FROM listings WHERE t0 < TIMESTAMP '2026-09-01' AND sold30 GROUP BY 1
UNION ALL
SELECT 'baseline (fashion, toys_games, sports_outdoors)', count(*), round(median(days), 2)
FROM listings WHERE t0 < TIMESTAMP '2026-09-01' AND sold30 AND category IN ('fashion', 'toys_games', 'sports_outdoors')
ORDER BY 3;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H10-back-to-campus: electronics share of listing views
-- ─────────────────────────────────────────────────────────────────────────
SELECT CASE WHEN t < TIMESTAMP '2026-08-10' THEN '1 before (Jun 4 - Aug 9)' WHEN t < TIMESTAMP '2026-09-08' THEN '2 Back to Campus (Aug 10 - Sep 7)' ELSE '3 after (Sep 8 - Oct 1)' END AS period,
 count(*) AS listing_views, round(avg((category = 'electronics')::INT), 4) AS electronics_share
FROM ev WHERE event = 'listing viewed' GROUP BY 1 ORDER BY 1;

-- =========================================================================
-- EVAL QUERIES
-- =========================================================================

-- EVAL Q1 — casual seller listings after the fee change (established sellers)
SELECT p.account_type, CASE WHEN e.t < TIMESTAMP '2026-07-15' THEN '1 Jun 4 - Jul 14' ELSE '2 Jul 15 - Oct 1' END AS period,
 count(DISTINCT e.uid) AS sellers,
 round(count(*) FILTER (WHERE e.event = 'listing created') / (CASE WHEN e.t < TIMESTAMP '2026-07-15' THEN 41 ELSE 79 END), 1) AS listings_per_day,
 round(count(*) FILTER (WHERE e.event = 'listing created')::DOUBLE / count(*) FILTER (WHERE e.event = 'home feed viewed'), 4) AS listings_per_visit
FROM ev e JOIN prof p ON p.uid = e.uid
WHERE p.established AND p.account_type IN ('seller', 'pro_seller') AND e.event IN ('listing created', 'home feed viewed')
GROUP BY 1, 2, (e.t < TIMESTAMP '2026-07-15') ORDER BY 1, 2;
-- weekly casual listings, all sellers
SELECT date_trunc('week', t)::DATE AS week, count(*) FILTER (WHERE p.account_type = 'seller') AS casual_listings, count(*) FILTER (WHERE p.account_type = 'pro_seller') AS pro_listings
FROM ev e JOIN prof p ON p.uid = e.uid WHERE e.event = 'listing created' GROUP BY 1 ORDER BY 1;

-- EVAL Q2 — fee revenue from casual sellers before vs after the change (warehouse ledger)
SELECT seller_type, CASE WHEN date::DATE < DATE '2026-07-15' THEN '1 Jun 4 - Jul 14' WHEN date::DATE < DATE '2026-07-29' THEN '2 Jul 15 - Jul 28' ELSE '3 Jul 29 - Oct 1' END AS period,
 count(*) AS days, round(sum(gmv_usd) / count(*), 0) AS gmv_per_day, round(sum(fee_revenue_usd) / count(*), 0) AS fee_revenue_per_day,
 round(sum(fee_revenue_usd) / sum(gmv_usd), 4) AS take_rate
FROM wh_ledger GROUP BY 1, 2 ORDER BY 1, 2;
SELECT CASE WHEN date::DATE < DATE '2026-07-15' THEN '1 Jun 4 - Jul 14' WHEN date::DATE < DATE '2026-07-29' THEN '2 Jul 15 - Jul 28' ELSE '3 Jul 29 - Oct 1' END AS period,
 round(sum(gmv_usd) FILTER (WHERE seller_type = 'casual') / sum(gmv_usd), 4) AS casual_gmv_share
FROM wh_ledger GROUP BY 1 ORDER BY 1;

-- EVAL Q3 — Express Checkout result (same as STORY H2), plus unique-member funnel
SELECT p.variant, count(DISTINCT c.uid) AS members, count(*) AS checkouts, round(avg(c.done::INT), 4) AS conversion,
 round(median(date_diff('second', c.t0, c.t1)) FILTER (WHERE c.done) / 60.0, 2) AS median_minutes
FROM checkouts c JOIN prof p ON p.uid = c.uid
WHERE c.t0 >= TIMESTAMP '2026-07-22' AND p.variant IS NOT NULL GROUP BY 1 ORDER BY 1;
WITH m AS (SELECT c.uid, p.variant, bool_or(c.done) AS any_done FROM checkouts c JOIN prof p ON p.uid = c.uid
 WHERE c.t0 >= TIMESTAMP '2026-07-22' AND p.variant IS NOT NULL GROUP BY 1, 2)
SELECT variant, count(*) AS members, round(avg(any_done::INT), 4) AS member_conversion FROM m GROUP BY 1 ORDER BY 1;
-- two-proportion z for per-checkout conversion
WITH g AS (SELECT p.variant AS v, count(*) AS n, avg(c.done::INT) AS r FROM checkouts c JOIN prof p ON p.uid = c.uid
 WHERE c.t0 >= TIMESTAMP '2026-07-22' AND p.variant IS NOT NULL GROUP BY 1),
x AS (SELECT max(r) FILTER (WHERE v = 'Express Checkout') AS r1, max(n) FILTER (WHERE v = 'Express Checkout') AS n1,
 max(r) FILTER (WHERE v = 'Control') AS r0, max(n) FILTER (WHERE v = 'Control') AS n0 FROM g)
SELECT round((r1 - r0) / sqrt(((r1 * n1 + r0 * n0) / (n1 + n0)) * (1 - (r1 * n1 + r0 * n0) / (n1 + n0)) * (1.0 / n1 + 1.0 / n0)), 1) AS z FROM x;

-- EVAL Q4 — offer acceptance by offer % of asking price (same as STORY H3)
SELECT CASE WHEN pct < 60 THEN '0 under 60%' WHEN pct < 70 THEN '1 60-69%' WHEN pct < 75 THEN '2 70-74%' WHEN pct < 80 THEN '3 75-79%' WHEN pct < 85 THEN '4 80-84%' WHEN pct < 90 THEN '5 85-89%' ELSE '6 90%+' END AS bucket,
 count(*) AS offers, round(avg(accepted::INT), 4) AS accept_rate
FROM offers GROUP BY 1 ORDER BY 1;
SELECT round(avg(pct), 1) AS avg_offer_pct, round(median(pct), 1) AS median_offer_pct, round(avg(accepted::INT), 4) AS overall_accept_rate, count(*) AS offers FROM offers;

-- EVAL Q5 — photos and sell-through (same as STORY H4), by individual photo count
SELECT photos, count(*) AS listings, round(avg(sold30::INT), 4) AS sell_through_30d
FROM listings WHERE t0 < TIMESTAMP '2026-09-01' GROUP BY 1 ORDER BY 1;
SELECT p.account_type, round(avg(l.photos), 2) AS avg_photos, count(*) AS listings FROM listings l JOIN prof p ON p.uid = l.uid GROUP BY 1;
-- photo bands within each seller type (Pro sellers use more photos)
SELECT p.account_type, CASE WHEN l.photos <= 2 THEN '1-2' WHEN l.photos <= 4 THEN '3-4' ELSE '5+' END AS photo_band,
 count(*) AS listings, round(avg(l.sold30::INT), 4) AS sell_through_30d
FROM listings l JOIN prof p ON p.uid = l.uid WHERE l.t0 < TIMESTAMP '2026-09-01' GROUP BY 1, 2 ORDER BY 1, 2;

-- EVAL Q6 — late first delivery and repeat purchase (same as STORY H5)
SELECT CASE WHEN delivery_days > 7 THEN 'late (> 7 days)' ELSE 'on time (<= 7 days)' END AS first_delivery,
 count(*) AS buyers, round(avg(repurchased_30d::INT), 4) AS repurchase_30d
FROM first_delivery GROUP BY 1 ORDER BY 1;
SELECT round(avg((delivery_days > 7)::INT), 4) AS late_share_of_first_deliveries FROM first_delivery;

-- EVAL Q7 — mid-September purchase dip: daily card conversion and the processor status
SELECT t0::DATE AS d, round(avg(done::INT) FILTER (WHERE pm = 'card'), 3) AS card_conversion, round(avg(done::INT) FILTER (WHERE pm <> 'card'), 3) AS other_conversion,
 count(*) FILTER (WHERE pm = 'card') AS card_checkouts
FROM checkouts WHERE t0 >= TIMESTAMP '2026-09-07' AND t0 < TIMESTAMP '2026-09-26' GROUP BY 1 ORDER BY 1;
SELECT date::DATE AS d, payment_method, processor_status, approval_rate, p95_auth_latency_ms FROM wh_pay WHERE processor_status <> 'operational' ORDER BY 1, 2;
WITH g AS (SELECT pm = 'card' AS card, CASE WHEN t0 >= TIMESTAMP '2026-09-14' AND t0 < TIMESTAMP '2026-09-19' THEN 'inc' ELSE 'base' END AS per, avg(done::INT) AS r
 FROM checkouts WHERE t0 >= TIMESTAMP '2026-08-31' AND t0 < TIMESTAMP '2026-10-03' GROUP BY 1, 2)
SELECT round(max(r) FILTER (WHERE card AND per = 'inc'), 4) AS card_incident, round(max(r) FILTER (WHERE card AND per = 'base'), 4) AS card_baseline,
 round(max(r) FILTER (WHERE NOT card AND per = 'inc'), 4) AS other_incident, round(max(r) FILTER (WHERE NOT card AND per = 'base'), 4) AS other_baseline,
 round((max(r) FILTER (WHERE card AND per = 'inc') / max(r) FILTER (WHERE card AND per = 'base'))
  / (max(r) FILTER (WHERE NOT card AND per = 'inc') / max(r) FILTER (WHERE NOT card AND per = 'base')), 3) AS relative_drop
FROM g;

-- EVAL Q8 — paid channel economics (same as STORY H7)
WITH sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM wh_spend GROUP BY 1),
g AS (SELECT ch, count(*) AS signups, avg(activated::INT) FILTER (WHERE t0 < TIMESTAMP '2026-09-18') AS activation FROM activation GROUP BY 1)
SELECT g.ch, g.signups, round(g.activation, 4) AS activation_14d, round(sp.spend, 2) AS spend,
 round(sp.spend / g.signups, 2) AS spend_per_signup, round(sp.spend / g.signups / g.activation, 2) AS spend_per_activated_buyer
FROM g LEFT JOIN sp ON sp.ch = g.ch ORDER BY 1;

-- EVAL Q9 — Tradepost Guarantee and high-ticket checkouts (same as STORY H8)
SELECT price >= 150 AS high_ticket, t0 >= TIMESTAMP '2026-08-26' AS after_launch, count(*) AS checkouts, round(avg(done::INT), 4) AS conversion
FROM checkouts GROUP BY 1, 2 ORDER BY 1, 2;
WITH g AS (SELECT price >= 150 AS hi, t0 >= TIMESTAMP '2026-08-26' AS aft, avg(done::INT) AS r FROM checkouts GROUP BY 1, 2)
SELECT round((max(r) FILTER (WHERE hi AND aft) / max(r) FILTER (WHERE hi AND NOT aft)) / (max(r) FILTER (WHERE NOT hi AND aft) / max(r) FILTER (WHERE NOT hi AND NOT aft)), 3) AS diff_in_diff FROM g;

-- EVAL Q10 — time to sell by category (same as STORY H9), plus 30-day sell-through by category
SELECT category, count(*) AS listings, round(avg(sold30::INT), 4) AS sell_through_30d,
 round(median(days) FILTER (WHERE sold30), 2) AS median_days_to_sell
FROM listings WHERE t0 < TIMESTAMP '2026-09-01' GROUP BY 1 ORDER BY 4;

-- EVAL Q11 — Back to Campus: electronics share of listing views and purchases by period
SELECT CASE WHEN t < TIMESTAMP '2026-08-10' THEN '1 before (Jun 4 - Aug 9)' WHEN t < TIMESTAMP '2026-09-08' THEN '2 Back to Campus (Aug 10 - Sep 7)' ELSE '3 after (Sep 8 - Oct 1)' END AS period,
 event, count(*) AS events, round(avg((category = 'electronics')::INT), 4) AS electronics_share
FROM ev WHERE event IN ('listing viewed', 'purchase completed') GROUP BY 1, 2 ORDER BY 2, 1;
SELECT count(*) FILTER (WHERE feed_section = 'back_to_campus') AS back_to_campus_visits, min(t) FILTER (WHERE feed_section = 'back_to_campus') AS first_visit,
 max(t) FILTER (WHERE feed_section = 'back_to_campus') AS last_visit FROM ev WHERE event = 'home feed viewed';

-- EVAL Q12 — null: dispute rate per delivered order before vs after the Tradepost Guarantee (2026-08-26),
-- deliveries through 2026-09-27 (a few days to open a dispute), overall and by the obvious splits
SELECT CASE WHEN t_delivered < TIMESTAMP '2026-08-26' THEN '1 before' ELSE '2 after' END AS period, count(*) AS delivered_orders,
 sum(disputed::INT) AS disputes, round(avg(disputed::INT), 4) AS dispute_rate
FROM orders WHERE t_delivered IS NOT NULL AND t_delivered < TIMESTAMP '2026-09-28' GROUP BY 1 ORDER BY 1;
WITH g AS (SELECT t_delivered >= TIMESTAMP '2026-08-26' AS aft, count(*) AS n, avg(disputed::INT) AS r FROM orders
 WHERE t_delivered IS NOT NULL AND t_delivered < TIMESTAMP '2026-09-28' GROUP BY 1),
x AS (SELECT max(r) FILTER (WHERE aft) AS r1, max(n) FILTER (WHERE aft) AS n1, max(r) FILTER (WHERE NOT aft) AS r0, max(n) FILTER (WHERE NOT aft) AS n0 FROM g)
SELECT round((r1 - r0) / sqrt(((r1 * n1 + r0 * n0) / (n1 + n0)) * (1 - (r1 * n1 + r0 * n0) / (n1 + n0)) * (1.0 / n1 + 1.0 / n0)), 2) AS z FROM x;
SELECT 'price band' AS split, CASE WHEN price >= 150 THEN 'high ticket' ELSE 'low ticket' END AS grp,
 round(avg(disputed::INT) FILTER (WHERE t_delivered < TIMESTAMP '2026-08-26'), 4) AS before_rate, round(avg(disputed::INT) FILTER (WHERE t_delivered >= TIMESTAMP '2026-08-26'), 4) AS after_rate,
 count(*) FILTER (WHERE t_delivered < TIMESTAMP '2026-08-26') AS n_before, count(*) FILTER (WHERE t_delivered >= TIMESTAMP '2026-08-26') AS n_after
FROM orders WHERE t_delivered IS NOT NULL AND t_delivered < TIMESTAMP '2026-09-28' AND price IS NOT NULL GROUP BY 1, 2
UNION ALL
SELECT 'platform', o.platform,
 round(avg(o.disputed::INT) FILTER (WHERE o.t_delivered < TIMESTAMP '2026-08-26'), 4), round(avg(o.disputed::INT) FILTER (WHERE o.t_delivered >= TIMESTAMP '2026-08-26'), 4),
 count(*) FILTER (WHERE o.t_delivered < TIMESTAMP '2026-08-26'), count(*) FILTER (WHERE o.t_delivered >= TIMESTAMP '2026-08-26')
FROM (SELECT orders.*, (SELECT any_value(platform) FROM ev WHERE ev.uid = orders.uid) AS platform FROM orders) o
WHERE o.t_delivered IS NOT NULL AND o.t_delivered < TIMESTAMP '2026-09-28' GROUP BY 1, 2
UNION ALL
SELECT 'delivery', CASE WHEN delivery_days > 7 THEN 'late' ELSE 'on time' END,
 round(avg(disputed::INT) FILTER (WHERE t_delivered < TIMESTAMP '2026-08-26'), 4), round(avg(disputed::INT) FILTER (WHERE t_delivered >= TIMESTAMP '2026-08-26'), 4),
 count(*) FILTER (WHERE t_delivered < TIMESTAMP '2026-08-26'), count(*) FILTER (WHERE t_delivered >= TIMESTAMP '2026-08-26')
FROM orders WHERE t_delivered IS NOT NULL AND t_delivered < TIMESTAMP '2026-09-28' GROUP BY 1, 2
ORDER BY 1, 2;
SELECT dispute_reason, count(*) FILTER (WHERE t < TIMESTAMP '2026-08-26') AS before, count(*) FILTER (WHERE t >= TIMESTAMP '2026-08-26') AS after
FROM ev WHERE event = 'dispute opened' GROUP BY 1 ORDER BY 2 DESC;

-- EVAL Q13 — null: offer acceptance and offer level by buyer region (overall and by platform)
SELECT p.region, count(*) AS offers, round(avg(o.accepted::INT), 4) AS accept_rate, round(avg(o.pct), 1) AS avg_offer_pct
FROM offers o JOIN prof p ON p.uid = o.uid GROUP BY 1 ORDER BY 1;
WITH g AS (SELECT p.region = 'south' AS south, count(*) AS n, avg(o.accepted::INT) AS r FROM offers o JOIN prof p ON p.uid = o.uid GROUP BY 1),
x AS (SELECT max(r) FILTER (WHERE south) AS r1, max(n) FILTER (WHERE south) AS n1, max(r) FILTER (WHERE NOT south) AS r0, max(n) FILTER (WHERE NOT south) AS n0 FROM g)
SELECT round(r1, 4) AS south_rate, round(r0, 4) AS rest_rate,
 round((r1 - r0) / sqrt(((r1 * n1 + r0 * n0) / (n1 + n0)) * (1 - (r1 * n1 + r0 * n0) / (n1 + n0)) * (1.0 / n1 + 1.0 / n0)), 2) AS z_south_vs_rest FROM x;
WITH g AS (SELECT o.platform, p.region = 'south' AS south, count(*) AS n, avg(o.accepted::INT) AS r FROM offers o JOIN prof p ON p.uid = o.uid GROUP BY 1, 2),
x AS (SELECT platform, max(r) FILTER (WHERE south) AS r1, max(n) FILTER (WHERE south) AS n1, max(r) FILTER (WHERE NOT south) AS r0, max(n) FILTER (WHERE NOT south) AS n0 FROM g GROUP BY 1)
SELECT platform, round(r1, 4) AS south_rate, round(r0, 4) AS rest_rate, n1 AS south_offers, n0 AS rest_offers,
 round((r1 - r0) / sqrt(((r1 * n1 + r0 * n0) / (n1 + n0)) * (1 - (r1 * n1 + r0 * n0) / (n1 + n0)) * (1.0 / n1 + 1.0 / n0)), 2) AS z
FROM x ORDER BY 1;
-- offer acceptance at matched offer levels (80%+ vs below), South vs rest
SELECT pct >= 80 AS at_80_plus, round(avg(o.accepted::INT) FILTER (WHERE p.region = 'south'), 4) AS south_rate, round(avg(o.accepted::INT) FILTER (WHERE p.region <> 'south'), 4) AS rest_rate
FROM offers o JOIN prof p ON p.uid = o.uid GROUP BY 1 ORDER BY 1;

-- EVAL Q14 — September GMV, orders, take rate, and refunds (warehouse ledger) vs Mixpanel
SELECT round(sum(gmv_usd), 0) AS gmv_usd, sum(orders)::BIGINT AS orders, round(sum(fee_revenue_usd), 0) AS fee_revenue_usd,
 round(sum(fee_revenue_usd) / sum(gmv_usd), 4) AS blended_take_rate, round(sum(refunds_usd), 0) AS refunds_usd
FROM wh_ledger WHERE date::DATE BETWEEN DATE '2026-09-01' AND DATE '2026-09-30';
SELECT count(*) AS mixpanel_purchases, round(sum(item_price), 0) AS mixpanel_item_value, count(DISTINCT uid) AS buyers
FROM ev WHERE event = 'purchase completed' AND t >= TIMESTAMP '2026-09-01' AND t < TIMESTAMP '2026-10-01';
SELECT strftime(date::DATE, '%Y-%m') AS month, round(sum(gmv_usd), 0) AS gmv_usd, round(sum(fee_revenue_usd) / sum(gmv_usd), 4) AS take_rate FROM wh_ledger GROUP BY 1 ORDER BY 1;

-- EVAL Q15 — ratings and disputes by delivery time
SELECT CASE WHEN delivery_days <= 4 THEN '1 within 4 days' WHEN delivery_days <= 7 THEN '2 5-7 days' ELSE '3 more than 7 days' END AS delivery,
 count(*) AS delivered_orders, count(rating) AS reviews, round(avg(rating), 2) AS avg_rating, round(avg(disputed::INT), 4) AS dispute_rate
FROM orders WHERE t_delivered IS NOT NULL GROUP BY 1 ORDER BY 1;
SELECT seller_type, round(avg(delivery_days), 2) AS avg_delivery_days, round(avg((delivery_days > 7)::INT), 4) AS late_share, count(*) AS delivered_orders
FROM orders WHERE t_delivered IS NOT NULL AND seller_type IS NOT NULL GROUP BY 1 ORDER BY 1;

-- EVAL Q16 — purchases lost to the card incident (card checkouts on incident days x conversion gap)
WITH base AS (SELECT avg(done::INT) AS r FROM checkouts WHERE pm = 'card' AND t0 >= TIMESTAMP '2026-08-31' AND t0 < TIMESTAMP '2026-10-03'
  AND NOT (t0 >= TIMESTAMP '2026-09-14' AND t0 < TIMESTAMP '2026-09-19')),
inc AS (SELECT count(*) AS n, sum(done::INT) AS done, avg(price) AS avg_price FROM checkouts WHERE pm = 'card' AND t0 >= TIMESTAMP '2026-09-14' AND t0 < TIMESTAMP '2026-09-19')
SELECT inc.n AS card_checkouts, inc.done AS card_purchases, round(base.r, 4) AS baseline_rate,
 round(inc.n * base.r - inc.done, 0) AS purchases_lost, round((inc.n * base.r - inc.done) * inc.avg_price, 0) AS item_value_lost_usd
FROM base, inc;
SELECT payment_method, round(avg(approval_rate) FILTER (WHERE processor_status = 'degraded'), 4) AS approval_degraded,
 round(avg(approval_rate) FILTER (WHERE processor_status = 'operational'), 4) AS approval_normal
FROM wh_pay GROUP BY 1 ORDER BY 1;

-- EVAL Q17 — share of new signups who buy within 14 days (overall and by channel)
SELECT count(*) AS mature_signups, round(avg(activated::INT), 4) AS activation_14d FROM activation WHERE t0 < TIMESTAMP '2026-09-18';
SELECT ch, count(*) AS mature_signups, round(avg(activated::INT), 4) AS activation_14d FROM activation WHERE t0 < TIMESTAMP '2026-09-18' GROUP BY 1 ORDER BY 3 DESC;

-- EVAL Q18 — buyer-side supply mix: casual share of listings viewed and purchased, weekly
SELECT date_trunc('week', t)::DATE AS week,
 round(avg((seller_type = 'casual')::INT) FILTER (WHERE event = 'listing viewed'), 4) AS casual_share_views,
 round(avg((seller_type = 'casual')::INT) FILTER (WHERE event = 'purchase completed'), 4) AS casual_share_purchases
FROM ev WHERE event IN ('listing viewed', 'purchase completed') GROUP BY 1 ORDER BY 1;

-- EVAL Q19 — open-ended inputs: late deliveries, TikTok activation, casual supply
SELECT 'late first deliveries' AS item, round(avg((delivery_days > 7)::INT), 4) AS value FROM first_delivery
UNION ALL SELECT 'repurchase ratio late vs on time', round(avg(repurchased_30d::INT) FILTER (WHERE delivery_days > 7) / avg(repurchased_30d::INT) FILTER (WHERE delivery_days <= 7), 3) FROM first_delivery
UNION ALL SELECT 'late share, casual-seller orders', round(avg((delivery_days > 7)::INT) FILTER (WHERE seller_type = 'casual'), 4) FROM orders WHERE t_delivered IS NOT NULL
UNION ALL SELECT 'late share, pro-seller orders', round(avg((delivery_days > 7)::INT) FILTER (WHERE seller_type = 'pro'), 4) FROM orders WHERE t_delivered IS NOT NULL
UNION ALL SELECT 'tiktok activation 14d', round(avg(activated::INT), 4) FROM activation WHERE ch = 'tiktok_ads' AND t0 < TIMESTAMP '2026-09-18'
UNION ALL SELECT 'tiktok share of paid signups', round(count(*) FILTER (WHERE ch = 'tiktok_ads')::DOUBLE / count(*) FILTER (WHERE ch IN ('tiktok_ads', 'meta_ads', 'google_shopping')), 4) FROM activation;

-- EVAL Q20 — where purchases are lost: checkout completion by price band and payment method, Sep 1-30
SELECT CASE WHEN price >= 150 THEN 'high ticket' ELSE 'low ticket' END AS band, pm, count(*) AS checkouts, round(avg(done::INT), 4) AS conversion
FROM checkouts WHERE t0 >= TIMESTAMP '2026-09-01' AND t0 < TIMESTAMP '2026-10-01' GROUP BY 1, 2 ORDER BY 1, 2;
SELECT count(*) FILTER (WHERE event = 'checkout started') AS checkouts, count(*) FILTER (WHERE event = 'purchase completed') AS purchases,
 count(*) FILTER (WHERE event = 'offer made') AS offers, count(*) FILTER (WHERE event = 'offer accepted') AS offers_accepted
FROM ev WHERE t >= TIMESTAMP '2026-09-01' AND t < TIMESTAMP '2026-10-01';
