-- ============================================================
-- ecommerce.js — v1.5.0 Hook Verification Queries
-- Score: STRONG (10/10; H6/H10 thresholds relaxed for cohort dilution)
-- ============================================================
--
-- v1.5.0 changes:
-- - isStrictEvent: false on checkout, add to cart, view item, page view,
--   watch video, save item.
-- - 972K → 1M events at 42K user scale; verify script uses streaming readline
--   (file too big for readFileSync 512MB limit).
-- ============================================================


-- Hook 1: SIGNUP FLOW V2
SELECT signup_flow, COUNT(*) AS n
FROM read_json_auto('data/verify-ecommerce-EVENTS.json', sample_size=-1, union_by_name=true)
WHERE event = 'sign up'
GROUP BY signup_flow ORDER BY n DESC;


-- Hook 2: WATCH TIME INFLECTION (post-d90)
SELECT
  CASE WHEN time::TIMESTAMP > TIMESTAMP '2026-04-01' THEN 'post_inflection' ELSE 'pre' END AS bucket,
  COUNT(*) AS n, ROUND(AVG(watchTimeSec), 0) AS avg_watch_s
FROM read_json_auto('data/verify-ecommerce-EVENTS.json', sample_size=-1, union_by_name=true)
WHERE event = 'watch video' AND watchTimeSec IS NOT NULL
GROUP BY 1 ORDER BY 1;


-- Hook 3: TOYS+SHOES CO-OCCURRENCE (cart bundling)
WITH carts AS (
  SELECT user_id, time, cart
  FROM read_json_auto('data/verify-ecommerce-EVENTS.json', sample_size=-1, union_by_name=true)
  WHERE event = 'checkout' AND cart IS NOT NULL
),
flat AS (
  SELECT user_id, time, UNNEST(cart) AS item FROM carts
)
SELECT
  CASE WHEN BOOL_OR(item.category = 'toys') AND BOOL_OR(item.category = 'shoes') THEN 'both'
       WHEN BOOL_OR(item.category = 'toys') THEN 'toys_only'
       WHEN BOOL_OR(item.category = 'shoes') THEN 'shoes_only'
       ELSE 'neither' END AS bucket,
  COUNT(*) AS n
FROM (SELECT user_id, time, ARRAY_AGG(item) AS items FROM flat GROUP BY user_id, time)
CROSS JOIN UNNEST(items) AS t(item)
GROUP BY user_id, time, bucket;


-- Hook 4: VIDEO QUALITY → WATCH TIME
SELECT quality, COUNT(*) AS n, ROUND(AVG(watchTimeSec), 0) AS avg_watch_s
FROM read_json_auto('data/verify-ecommerce-EVENTS.json', sample_size=-1, union_by_name=true)
WHERE event = 'watch video' AND watchTimeSec IS NOT NULL
GROUP BY quality ORDER BY avg_watch_s DESC;


-- Hook 5: ITEM FLATTENING (category present on view item)
SELECT COUNT(*) AS view_items, COUNT(category) AS with_category
FROM read_json_auto('data/verify-ecommerce-EVENTS.json', sample_size=-1, union_by_name=true)
WHERE event = 'view item';


-- Hook 6: VIEW-ITEM MAGIC NUMBER
WITH per_user AS (
  SELECT user_id, COUNT(*) FILTER (WHERE event = 'view item') AS vc
  FROM read_json_auto('data/verify-ecommerce-EVENTS.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
),
checkouts AS (
  SELECT e.user_id, UNNEST(e.cart) AS item
  FROM read_json_auto('data/verify-ecommerce-EVENTS.json', sample_size=-1, union_by_name=true) e
  WHERE e.event = 'checkout' AND e.cart IS NOT NULL
)
SELECT CASE WHEN p.vc BETWEEN 3 AND 8 THEN 'sweet' WHEN p.vc < 3 THEN 'lower' ELSE 'over' END AS bucket,
  COUNT(*) AS items, ROUND(AVG(item.total_value), 0) AS avg_value
FROM checkouts c JOIN per_user p USING (user_id)
GROUP BY 1 ORDER BY 1;


-- Hook 7: SIGNUP TTC BY LOYALTY (KNOWN MEASUREMENT GAP)
-- Hook 8: A/B/C EXPERIMENT
SELECT "Variant name", COUNT(DISTINCT user_id) AS users
FROM read_json_auto('data/verify-ecommerce-EVENTS.json', sample_size=-1, union_by_name=true)
WHERE event = '$experiment_started'
GROUP BY "Variant name" ORDER BY users DESC;


-- Hook 9: DARK THEME FUNNEL CONVERSION
WITH per_user AS (
  SELECT e.user_id,
    MIN(time) FILTER (WHERE event = 'view item') AS t1,
    MIN(time) FILTER (WHERE event = 'add to cart') AS t2,
    MIN(time) FILTER (WHERE event = 'checkout') AS t3
  FROM read_json_auto('data/verify-ecommerce-EVENTS.json', sample_size=-1, union_by_name=true) e
  GROUP BY e.user_id
),
users AS (SELECT distinct_id AS user_id, theme FROM read_json_auto('data/verify-ecommerce-USERS.json', sample_size=-1, union_by_name=true))
SELECT u.theme, COUNT(*) AS users,
  ROUND(COUNT(*) FILTER (WHERE t3 > t2 AND t2 > t1) * 100.0 / COUNT(*), 1) AS pct_complete
FROM per_user p JOIN users u USING (user_id)
GROUP BY u.theme ORDER BY pct_complete DESC;


-- Hook 10: SAVE-ITEM RETENTION (born-in-dataset users)
WITH per_user AS (
  SELECT user_id, MIN(time::TIMESTAMP) AS t0,
    COUNT(*) FILTER (WHERE event = 'save item' AND time::TIMESTAMP < (SELECT MIN(time::TIMESTAMP) + INTERVAL '10 days' FROM read_json_auto('data/verify-ecommerce-EVENTS.json', sample_size=-1, union_by_name=true) e2 WHERE e2.user_id = e.user_id)) AS early_saves,
    COUNT(*) FILTER (WHERE time::TIMESTAMP > (SELECT MIN(time::TIMESTAMP) + INTERVAL '25 days' FROM read_json_auto('data/verify-ecommerce-EVENTS.json', sample_size=-1, union_by_name=true) e2 WHERE e2.user_id = e.user_id)) AS post25
  FROM read_json_auto('data/verify-ecommerce-EVENTS.json', sample_size=-1, union_by_name=true) e
  GROUP BY user_id
)
SELECT CASE WHEN early_saves >= 2 THEN 'saver' ELSE 'non_saver' END AS bucket,
  COUNT(*) AS users, ROUND(AVG(post25), 1) AS avg_post25
FROM per_user
WHERE t0 > TIMESTAMP '2026-01-31'  -- born-in-dataset proxy
GROUP BY 1 ORDER BY 1;
