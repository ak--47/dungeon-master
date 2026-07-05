-- ============================================================
-- food-delivery.js — v1.6.0 hook verification queries (human eyeball)
-- Machine contract lives in the `stories` export of food-delivery.js;
-- run ./food-delivery.verify.mjs for verdicts. These queries mirror the
-- story reads for interactive inspection.
--
-- Generate first:
--   node scripts/verify-runner.mjs dungeons/vertical/food-delivery/food-delivery.js verify-food-delivery
--
-- Key derivation notes (full math in HOOK STORIES block of food-delivery.js):
-- - H1/H7 read delivered-per-PLACED ratios: 'order placed' shares the soup
--   HOD/hash distribution but is untouched by either drop, so it cancels
--   the confound. Raw delivered HOD volume does NOT show a clean 0.70.
-- - H6 zero-post share lands near 0.25 (not the 0.60 knob): the deletion
--   removes late 'subscription started' events themselves, so churned
--   users with a late trial start vanish from the visible cohort.
-- - H8 buckets by HOOK-TIME order count; output counts are contaminated by
--   H4 duplication and H6 deletion, so the clean read excludes rainy-window
--   orderers and users with zero post-day-14 activity.
-- - H10 reads reorders-per-DELIVERED: last funnel step fires only on
--   conversion (determineConversion, lib/generators/funnels.js), so the
--   ratio recovers the conversionRate scaling exactly (1.40 / 0.70).
-- ============================================================


-- H1: RUSH-HOUR KEEP RATE — delivered-per-placed off/rush ≈ 0.70
WITH ev AS (
  SELECT event, hour(time::TIMESTAMP) AS hr
  FROM read_json_auto('data/verify-food-delivery-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event IN ('order delivered','order placed')
), agg AS (
  SELECT (hr BETWEEN 11 AND 13) OR (hr BETWEEN 17 AND 20) AS rush,
    count(*) FILTER (WHERE event='order delivered') AS del,
    count(*) FILTER (WHERE event='order placed') AS placed
  FROM ev GROUP BY 1
)
SELECT rush, del, placed, round(del::DOUBLE/placed, 3) AS del_per_placed FROM agg ORDER BY rush;


-- H2: COUPON INJECTION — coupons-per-checkout diff ≈ +0.30 (Free − QB+); cpu ratio ≈ 2.2
WITH pu AS (
  SELECT user_id::VARCHAR AS uid, any_value(subscription_tier) AS tier,
    count(*) FILTER (WHERE event='coupon applied') AS coupons,
    count(*) FILTER (WHERE event='checkout started') AS checkouts
  FROM read_json_auto('data/verify-food-delivery-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event IN ('coupon applied','checkout started') GROUP BY 1
)
SELECT tier, count(*) AS users,
  round(sum(coupons)::DOUBLE/count(*), 2) AS coupons_per_user,
  round(sum(coupons)::DOUBLE/nullif(sum(checkouts),0), 3) AS coupons_per_checkout
FROM pu GROUP BY tier ORDER BY tier;


-- H3: LATE-NIGHT MUNCHIES — flip inversion (late−off)/(1−off) ≈ 0.70; price ratio ≈ 1.30
WITH ev AS (
  SELECT event, cuisine_type, TRY_CAST(item_price AS DOUBLE) AS price,
    hour(time::TIMESTAMP) AS hr
  FROM read_json_auto('data/verify-food-delivery-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event IN ('restaurant viewed','restaurant browsed','item added to cart')
)
SELECT
  round(avg((cuisine_type='American')::INT) FILTER (WHERE event='restaurant viewed' AND (hr>=22 OR hr<=2)), 3) AS amer_late,
  round(avg((cuisine_type='American')::INT) FILTER (WHERE event='restaurant viewed' AND hr BETWEEN 6 AND 18), 3) AS amer_off,
  round(avg((cuisine_type='American')::INT) FILTER (WHERE event='restaurant browsed'), 3) AS amer_organic_ctrl,
  round(avg(price) FILTER (WHERE event='item added to cart' AND (hr>=22 OR hr<=2)) /
        avg(price) FILTER (WHERE event='item added to cart' AND hr BETWEEN 6 AND 18), 3) AS price_ratio
FROM ev;


-- H4: RAINY WEEK (day_idx 20-27) — dup share ≈ 0.40, fee ratio ≈ 2.0, vol RoR vs checkout ≈ 1.4
WITH ev AS (
  SELECT user_id::VARCHAR AS uid, event, order_id, TRY_CAST(delivery_fee AS DOUBLE) AS fee,
    date_diff('day', TIMESTAMP '2026-01-01 00:00:00', time::TIMESTAMP) AS day_idx
  FROM read_json_auto('data/verify-food-delivery-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event IN ('order placed','checkout started')
)
SELECT
  round((count(*) FILTER (WHERE event='order placed' AND day_idx BETWEEN 20 AND 27)
       - count(DISTINCT uid || '|' || order_id) FILTER (WHERE event='order placed' AND day_idx BETWEEN 20 AND 27))::DOUBLE
       / count(DISTINCT uid || '|' || order_id) FILTER (WHERE event='order placed' AND day_idx BETWEEN 20 AND 27), 3) AS dup_share,
  round(avg(fee) FILTER (WHERE event='order placed' AND day_idx BETWEEN 20 AND 27) /
        avg(fee) FILTER (WHERE event='order placed' AND (day_idx BETWEEN 10 AND 19 OR day_idx BETWEEN 28 AND 37)), 3) AS fee_ratio,
  round((count(*) FILTER (WHERE event='order placed' AND day_idx BETWEEN 20 AND 27)::DOUBLE /
         count(*) FILTER (WHERE event='order placed' AND (day_idx BETWEEN 10 AND 19 OR day_idx BETWEEN 28 AND 37))) /
        (count(*) FILTER (WHERE event='checkout started' AND day_idx BETWEEN 20 AND 27)::DOUBLE /
         count(*) FILTER (WHERE event='checkout started' AND (day_idx BETWEEN 10 AND 19 OR day_idx BETWEEN 28 AND 37))), 3) AS vol_ror
FROM ev;


-- H5: REFERRAL POWER USERS (born-in only) — reorders/user ratio ≈ 1.4; ratings 4.4 vs 2.8
WITH ev AS (
  SELECT user_id::VARCHAR AS uid, event, referral_code, TRY_CAST(food_rating AS DOUBLE) AS rating
  FROM read_json_auto('data/verify-food-delivery-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event IN ('account created','reorder initiated','order rated')
), born AS (
  SELECT uid, bool_or(referral_code = true) AS referred
  FROM ev WHERE event='account created' GROUP BY 1
), pu AS (
  SELECT b.uid, b.referred,
    count(*) FILTER (WHERE e.event='reorder initiated') AS reorders,
    avg(e.rating) FILTER (WHERE e.event='order rated') AS user_rating
  FROM born b LEFT JOIN ev e ON e.uid=b.uid GROUP BY 1,2
)
SELECT referred, count(*) AS users,
  round(sum(reorders)::DOUBLE/count(*), 2) AS reorders_per_user,
  round(avg(user_rating), 2) AS mean_user_rating
FROM pu GROUP BY referred ORDER BY referred;


-- H6: TRIAL CHURN (survivor-biased view) — zero-post share ~0.25 nonactivated vs ~0.04 activated
WITH ev AS (
  SELECT user_id::VARCHAR AS uid, time::TIMESTAMP AS t, event, trial
  FROM read_json_auto('data/verify-food-delivery-EVENTS*.json', sample_size=-1, union_by_name=true)
), fu AS (SELECT uid, min(t) AS first_t FROM ev GROUP BY 1),
trial AS (SELECT uid FROM ev WHERE event='subscription started' AND trial = true GROUP BY 1),
pux AS (
  SELECT f.uid,
    count(*) FILTER (WHERE e.event='order placed' AND e.t <= f.first_t + INTERVAL '14 days') AS early_orders,
    count(*) FILTER (WHERE e.t > f.first_t + INTERVAL '14 days') AS post_n
  FROM fu f JOIN trial tr ON tr.uid=f.uid JOIN ev e ON e.uid=f.uid GROUP BY 1
)
SELECT (early_orders >= 3) AS activated, count(*) AS users,
  round(avg(CASE WHEN post_n = 0 THEN 1.0 ELSE 0 END), 3) AS zero_post_share
FROM pux GROUP BY 1 ORDER BY 1;


-- H7: HASH-BUCKET DROP — delivered-per-placed odd/even ≈ 0.70
WITH pu AS (
  SELECT user_id::VARCHAR AS uid, (ascii(substr(user_id::VARCHAR,1,1)) % 2 = 0) AS even_bucket,
    count(*) FILTER (WHERE event='order placed') AS placed,
    count(*) FILTER (WHERE event='order delivered') AS delivered
  FROM read_json_auto('data/verify-food-delivery-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event IN ('order placed','order delivered') GROUP BY 1,2
)
SELECT even_bucket, count(*) AS users,
  round(sum(delivered)::DOUBLE/nullif(sum(placed),0), 3) AS del_per_placed
FROM pu GROUP BY even_bucket ORDER BY even_bucket;


-- H8: ORDER-COUNT MAGIC NUMBER (clean population) — sweet/base ≈ 1.40, over/sweet ≈ 0.46
WITH raw AS (
  SELECT user_id::VARCHAR AS uid, time::TIMESTAMP AS t, event,
    TRY_CAST(order_total AS DOUBLE) AS ot,
    date_diff('day', TIMESTAMP '2026-01-01 00:00:00', time::TIMESTAMP) AS day_idx
  FROM read_json_auto('data/verify-food-delivery-EVENTS*.json', sample_size=-1, union_by_name=true)
), fu AS (SELECT uid, min(t) AS first_t FROM raw GROUP BY 1),
flags AS (
  SELECT r.uid,
    max(CASE WHEN r.event='order placed' AND r.day_idx BETWEEN 20 AND 27 THEN 1 ELSE 0 END) AS rainy,
    max(CASE WHEN r.t > f.first_t + INTERVAL '14 days' THEN 1 ELSE 0 END) AS alive,
    count(*) FILTER (WHERE r.event='order placed') AS orders,
    sum(r.ot) FILTER (WHERE r.event='order placed') AS spend
  FROM raw r JOIN fu f USING(uid) GROUP BY 1
)
SELECT CASE WHEN orders BETWEEN 4 AND 8 THEN 'sweet' WHEN orders >= 9 THEN 'over' ELSE 'base' END AS bucket,
  count(*) AS users, round(sum(spend)/nullif(sum(orders),0), 1) AS avg_order_total
FROM flags WHERE rainy = 0 AND alive = 1 AND orders > 0
GROUP BY 1 ORDER BY 1;


-- H9: TIER DELIVERY SPEED — QB+/Free property ratio ≈ 0.479 (= 0.67/1.4) on both props
SELECT
  round(avg(TRY_CAST(actual_delivery_mins AS DOUBLE)) FILTER (WHERE subscription_tier='QuickBite+' AND event='order delivered') /
        avg(TRY_CAST(actual_delivery_mins AS DOUBLE)) FILTER (WHERE subscription_tier='Free' AND event='order delivered'), 3) AS adm_ratio,
  round(avg(TRY_CAST(eta_mins AS DOUBLE)) FILTER (WHERE subscription_tier='QuickBite+' AND event='order tracked') /
        avg(TRY_CAST(eta_mins AS DOUBLE)) FILTER (WHERE subscription_tier='Free' AND event='order tracked'), 3) AS eta_ratio
FROM read_json_auto('data/verify-food-delivery-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event IN ('order delivered','order tracked');


-- H10: CITY DENSITY — reorders-per-delivered dense/base ≈ 1.40, sprawl/base ≈ 0.70
WITH pu AS (
  SELECT user_id::VARCHAR AS uid, any_value(city) AS city,
    count(*) FILTER (WHERE event='order delivered') AS delivered,
    count(*) FILTER (WHERE event='reorder initiated') AS reorders
  FROM read_json_auto('data/verify-food-delivery-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event IN ('order delivered','reorder initiated') GROUP BY 1
)
SELECT CASE WHEN city IN ('San Francisco','New York') THEN 'dense'
  WHEN city IN ('Houston','Phoenix') THEN 'sprawl' ELSE 'base' END AS grp,
  count(*) AS users,
  round(sum(reorders)::DOUBLE/nullif(sum(delivered),0), 4) AS reorders_per_delivered
FROM pu GROUP BY 1 ORDER BY 1;
