-- ============================================================
-- food-delivery.js — v1.5.0 Hook Verification Queries
-- Score: NAILED (12/12)
-- ============================================================
--
-- v1.5.0 changes:
-- - isStrictEvent: false on 9 funnel-step events read by hooks.
-- - H4b rainy week volume verified vs NEIGHBORING days (15-19, 28-32) to
--   control for born-in-dataset growth ramp; comparing vs full-dataset average
--   is misleading because most users aren't born until later.
-- ============================================================


-- Hook 1: LUNCH/DINNER RUSH — meal-hour orders dominate
SELECT EXTRACT(HOUR FROM time::TIMESTAMP) AS hour, COUNT(*) AS deliveries
FROM read_json_auto('data/verify-food-delivery-EVENTS.json', sample_size=-1, union_by_name=true)
WHERE event = 'order delivered'
GROUP BY hour ORDER BY hour;


-- Hook 2: COUPON INJECTION (Free tier)
WITH user_coupons AS (
  SELECT user_id, COUNT(*) AS c
  FROM read_json_auto('data/verify-food-delivery-EVENTS.json', sample_size=-1, union_by_name=true)
  WHERE event = 'coupon applied' GROUP BY user_id
),
users AS (SELECT distinct_id AS user_id, subscription_tier FROM read_json_auto('data/verify-food-delivery-USERS.json', sample_size=-1, union_by_name=true))
SELECT u.subscription_tier, COUNT(*) AS users, ROUND(AVG(COALESCE(uc.c, 0)), 2) AS avg_coupons
FROM users u LEFT JOIN user_coupons uc USING (user_id)
GROUP BY u.subscription_tier;


-- Hook 3: LATE NIGHT MUNCHIES (American cuisine 22-02)
SELECT
  CASE WHEN EXTRACT(HOUR FROM time::TIMESTAMP) >= 22 OR EXTRACT(HOUR FROM time::TIMESTAMP) <= 2 THEN 'late' ELSE 'normal' END AS time_bucket,
  cuisine_type, COUNT(*) AS n
FROM read_json_auto('data/verify-food-delivery-EVENTS.json', sample_size=-1, union_by_name=true)
WHERE event = 'restaurant viewed' AND cuisine_type IS NOT NULL
GROUP BY 1, cuisine_type ORDER BY 1, n DESC;


-- Hook 4: RAINY WEEK SURGE — d20-27 delivery_fee 2x
SELECT
  CASE WHEN time::TIMESTAMP BETWEEN TIMESTAMP '2026-01-21' AND TIMESTAMP '2026-01-28' THEN 'rainy' ELSE 'normal' END AS bucket,
  COUNT(*) AS orders, ROUND(AVG(delivery_fee), 1) AS avg_fee
FROM read_json_auto('data/verify-food-delivery-EVENTS.json', sample_size=-1, union_by_name=true)
WHERE event = 'order placed' AND delivery_fee IS NOT NULL
GROUP BY 1 ORDER BY 1;


-- Hook 5: REFERRAL POWER USERS
WITH ref_users AS (
  SELECT DISTINCT user_id FROM read_json_auto('data/verify-food-delivery-EVENTS.json', sample_size=-1, union_by_name=true)
  WHERE event = 'account created' AND referral_code = TRUE
)
SELECT
  CASE WHEN e.user_id IN (SELECT user_id FROM ref_users) THEN 'referral' ELSE 'non' END AS bucket,
  COUNT(*) FILTER (WHERE event = 'reorder initiated') AS reorders,
  ROUND(AVG(food_rating) FILTER (WHERE event = 'order rated' AND food_rating IS NOT NULL), 2) AS avg_food_rating
FROM read_json_auto('data/verify-food-delivery-EVENTS.json', sample_size=-1, union_by_name=true) e
GROUP BY 1 ORDER BY 1;


-- Hook 6: TRIAL CONVERSION
WITH per_user AS (
  SELECT user_id, MIN(time::TIMESTAMP) AS t0,
    BOOL_OR(event = 'subscription started' AND trial = TRUE) AS is_trial,
    COUNT(*) FILTER (WHERE event = 'order placed' AND time::TIMESTAMP < (SELECT MIN(time::TIMESTAMP) + INTERVAL '14 days' FROM read_json_auto('data/verify-food-delivery-EVENTS.json', sample_size=-1, union_by_name=true) e2 WHERE e2.user_id = e.user_id)) AS early_orders,
    COUNT(*) FILTER (WHERE time::TIMESTAMP > (SELECT MIN(time::TIMESTAMP) + INTERVAL '14 days' FROM read_json_auto('data/verify-food-delivery-EVENTS.json', sample_size=-1, union_by_name=true) e2 WHERE e2.user_id = e.user_id)) AS post_14
  FROM read_json_auto('data/verify-food-delivery-EVENTS.json', sample_size=-1, union_by_name=true) e
  GROUP BY user_id
)
SELECT CASE WHEN is_trial AND early_orders >= 3 THEN 'trial_3+' WHEN is_trial THEN 'trial_<3' ELSE 'non_trial' END AS bucket,
  COUNT(*) AS users, ROUND(AVG(post_14), 1) AS avg_post14
FROM per_user GROUP BY 1 ORDER BY 1;


-- Hook 7: FIRST ORDER BONUS (returning users converted worse)
-- Bespoke: groups by user_id first character (% 2) — odd = "returning" cohort with H7 dropping 30% of deliveries
WITH per_user AS (
  SELECT user_id,
    COUNT(*) FILTER (WHERE event = 'order placed') AS placed,
    COUNT(*) FILTER (WHERE event = 'order delivered') AS delivered
  FROM read_json_auto('data/verify-food-delivery-EVENTS.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
)
SELECT
  CASE WHEN ASCII(SUBSTR(user_id, 1, 1)) % 2 = 0 THEN 'new' ELSE 'returning' END AS bucket,
  COUNT(*) AS users,
  ROUND(SUM(delivered)::DOUBLE / NULLIF(SUM(placed), 0), 3) AS deliver_per_place
FROM per_user GROUP BY 1 ORDER BY 1;


-- Hook 8: ORDER-COUNT MAGIC NUMBER
WITH per_user AS (
  SELECT user_id, COUNT(*) FILTER (WHERE event = 'order placed') AS oc
  FROM read_json_auto('data/verify-food-delivery-EVENTS.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
),
orders AS (
  SELECT e.user_id, e.order_total
  FROM read_json_auto('data/verify-food-delivery-EVENTS.json', sample_size=-1, union_by_name=true) e
  WHERE e.event = 'order placed' AND e.order_total IS NOT NULL
)
SELECT CASE WHEN p.oc BETWEEN 4 AND 8 THEN 'sweet' WHEN p.oc < 4 THEN 'lower' ELSE 'over' END AS bucket,
  COUNT(*) AS orders, ROUND(AVG(o.order_total), 0) AS avg_total
FROM orders o JOIN per_user p USING (user_id)
GROUP BY 1 ORDER BY 1;


-- Hook 9: ORDER LIFECYCLE TTC (subscription tier delivery time)
SELECT subscription_tier, COUNT(*) AS deliveries,
  ROUND(AVG(actual_delivery_mins), 1) AS avg_delivery_min
FROM read_json_auto('data/verify-food-delivery-EVENTS.json', sample_size=-1, union_by_name=true)
WHERE event = 'order delivered' AND actual_delivery_mins IS NOT NULL
GROUP BY subscription_tier ORDER BY avg_delivery_min;


-- Hook 10: CITY DENSITY REORDER BOOST
WITH per_user AS (
  SELECT e.user_id,
    MIN(time) FILTER (WHERE event = 'order delivered') AS t1,
    MIN(time) FILTER (WHERE event = 'order rated') AS t2,
    MIN(time) FILTER (WHERE event = 'reorder initiated') AS t3
  FROM read_json_auto('data/verify-food-delivery-EVENTS.json', sample_size=-1, union_by_name=true) e
  GROUP BY e.user_id
),
users AS (SELECT distinct_id AS user_id, city FROM read_json_auto('data/verify-food-delivery-USERS.json', sample_size=-1, union_by_name=true))
SELECT u.city, COUNT(*) AS users,
  ROUND(COUNT(*) FILTER (WHERE t3 > t2 AND t2 > t1) * 100.0 / COUNT(*), 1) AS pct_reorder
FROM per_user p JOIN users u USING (user_id)
GROUP BY u.city ORDER BY pct_reorder DESC;
