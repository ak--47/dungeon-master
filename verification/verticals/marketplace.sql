-- ============================================================
-- marketplace.js — v1.5.0 Hook Verification Queries
-- Score: NAILED (10/10)
-- ============================================================
--
-- v1.5.0 changes:
-- - isStrictEvent: false on item searched, item viewed, purchase completed,
--   listing created, offer received, offer accepted, message sent.
-- ============================================================


-- Hook 1: FEE CHANGE IMPACT — listing_fee post-d45
SELECT
  CASE WHEN time::TIMESTAMP > TIMESTAMP '2026-02-15' THEN 'post_d45' ELSE 'pre_d45' END AS bucket,
  COUNT(*) AS n, ROUND(AVG(listing_fee), 1) AS avg_fee
FROM read_json_auto('data/verify-marketplace-EVENTS.json', sample_size=-1, union_by_name=true)
WHERE event = 'listing created' AND listing_fee IS NOT NULL
GROUP BY 1 ORDER BY 1;


-- Hook 2: WEEKEND SHOPPING SURGE
SELECT
  CASE WHEN EXTRACT(DOW FROM time::TIMESTAMP) IN (0, 6) THEN 'weekend' ELSE 'weekday' END AS bucket,
  COUNT(*) AS n, ROUND(AVG(total_amount), 0) AS avg_amount
FROM read_json_auto('data/verify-marketplace-EVENTS.json', sample_size=-1, union_by_name=true)
WHERE event = 'purchase completed' AND total_amount IS NOT NULL
GROUP BY 1 ORDER BY 1;


-- Hook 3: POWER SELLER PURCHASES
WITH per_user AS (
  SELECT user_id, COUNT(*) FILTER (WHERE event = 'purchase completed') AS purchases
  FROM read_json_auto('data/verify-marketplace-EVENTS.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
),
users AS (SELECT distinct_id AS user_id, segment FROM read_json_auto('data/verify-marketplace-USERS.json', sample_size=-1, union_by_name=true))
SELECT u.segment, COUNT(*) AS users, ROUND(AVG(p.purchases), 2) AS avg_purchases
FROM users u LEFT JOIN per_user p USING (user_id)
GROUP BY u.segment ORDER BY avg_purchases DESC;


-- Hook 4: ELECTRONICS SEARCHERS → MORE PURCHASES
WITH per_user AS (
  SELECT user_id,
    BOOL_OR(event = 'item searched' AND category = 'electronics') AS has_elec,
    COUNT(*) FILTER (WHERE event = 'purchase completed') AS purchases
  FROM read_json_auto('data/verify-marketplace-EVENTS.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
)
SELECT CASE WHEN has_elec THEN 'electronics' ELSE 'other' END AS bucket,
  COUNT(*) AS users, ROUND(AVG(purchases), 2) AS avg_purchases
FROM per_user GROUP BY 1 ORDER BY 1 DESC;


-- Hook 5: FAST RESPONDERS — hash-based cohort
WITH per_user AS (
  SELECT user_id, COUNT(*) FILTER (WHERE event = 'offer accepted') AS accepts
  FROM read_json_auto('data/verify-marketplace-EVENTS.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
)
SELECT
  CASE WHEN (ASCII(SUBSTR(user_id, 1, 1)) + ASCII(SUBSTR(user_id, LENGTH(user_id), 1))) % 5 < 2 THEN 'fast' ELSE 'slow' END AS bucket,
  COUNT(*) AS users, ROUND(AVG(accepts), 2) AS avg_accepts
FROM per_user GROUP BY 1 ORDER BY 1;


-- Hook 6: NEW SELLER CHURN — per-user post14/pre14 ratio
WITH per_user AS (
  SELECT user_id, MIN(time::TIMESTAMP) AS t0,
    COUNT(*) FILTER (WHERE time::TIMESTAMP <= (SELECT MIN(time::TIMESTAMP) + INTERVAL '14 days' FROM read_json_auto('data/verify-marketplace-EVENTS.json', sample_size=-1, union_by_name=true) e2 WHERE e2.user_id = e.user_id)) AS pre,
    COUNT(*) FILTER (WHERE time::TIMESTAMP > (SELECT MIN(time::TIMESTAMP) + INTERVAL '14 days' FROM read_json_auto('data/verify-marketplace-EVENTS.json', sample_size=-1, union_by_name=true) e2 WHERE e2.user_id = e.user_id)) AS post
  FROM read_json_auto('data/verify-marketplace-EVENTS.json', sample_size=-1, union_by_name=true) e
  GROUP BY user_id
),
users AS (SELECT distinct_id AS user_id, segment FROM read_json_auto('data/verify-marketplace-USERS.json', sample_size=-1, union_by_name=true))
SELECT u.segment, COUNT(*) AS users, ROUND(AVG(post::DOUBLE / NULLIF(pre, 0)), 2) AS avg_post_pre
FROM per_user p JOIN users u USING (user_id)
WHERE pre > 0
GROUP BY u.segment ORDER BY avg_post_pre;


-- Hook 7: POWER SELLER PROFILES
SELECT segment, COUNT(*) AS users,
  ROUND(AVG(total_transactions), 0) AS avg_txns,
  ROUND(AVG(seller_rating), 2) AS avg_rating
FROM read_json_auto('data/verify-marketplace-USERS.json', sample_size=-1, union_by_name=true)
GROUP BY segment ORDER BY avg_txns DESC;


-- Hook 8: FREQUENT BUYER FUNNEL
WITH per_user AS (
  SELECT e.user_id,
    MIN(time) FILTER (WHERE event = 'item searched') AS t1,
    MIN(time) FILTER (WHERE event = 'item viewed') AS t2,
    MIN(time) FILTER (WHERE event = 'add to cart') AS t3,
    MIN(time) FILTER (WHERE event = 'purchase completed') AS t4
  FROM read_json_auto('data/verify-marketplace-EVENTS.json', sample_size=-1, union_by_name=true) e
  GROUP BY e.user_id
),
users AS (SELECT distinct_id AS user_id, segment FROM read_json_auto('data/verify-marketplace-USERS.json', sample_size=-1, union_by_name=true))
SELECT u.segment, COUNT(*) AS users,
  ROUND(COUNT(*) FILTER (WHERE t4 > t3 AND t3 > t2 AND t2 > t1) * 100.0 / COUNT(*), 1) AS pct_complete
FROM per_user p JOIN users u USING (user_id)
GROUP BY u.segment ORDER BY pct_complete DESC;


-- Hook 9: BROWSE-TO-PURCHASE TTC BY SEGMENT (KNOWN MEASUREMENT GAP)
-- See dating.sql Hook 9 for the funnel-post limitation explanation.


-- Hook 10: MESSAGE-COUNT MAGIC NUMBER — sweet 2-5 between view/offer
WITH per_user AS (
  SELECT e.user_id,
    MIN(time) FILTER (WHERE event = 'item viewed') AS t_view,
    MIN(time) FILTER (WHERE event = 'offer received') AS t_offer
  FROM read_json_auto('data/verify-marketplace-EVENTS.json', sample_size=-1, union_by_name=true) e
  GROUP BY e.user_id
),
msgs_between AS (
  SELECT p.user_id, COUNT(*) AS msgs
  FROM per_user p
  JOIN read_json_auto('data/verify-marketplace-EVENTS.json', sample_size=-1, union_by_name=true) e USING (user_id)
  WHERE e.event = 'message sent' AND e.time > p.t_view AND e.time < p.t_offer
  GROUP BY p.user_id
),
offers AS (
  SELECT e.user_id, e.offer_amount
  FROM read_json_auto('data/verify-marketplace-EVENTS.json', sample_size=-1, union_by_name=true) e
  WHERE e.event = 'offer received' AND e.offer_amount IS NOT NULL
)
SELECT CASE WHEN m.msgs BETWEEN 2 AND 5 THEN 'sweet' WHEN m.msgs IS NULL OR m.msgs < 2 THEN 'lower' ELSE 'over' END AS bucket,
  COUNT(*) AS offers, ROUND(AVG(o.offer_amount), 0) AS avg_offer
FROM offers o LEFT JOIN msgs_between m USING (user_id)
GROUP BY 1 ORDER BY 1;
