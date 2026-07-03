-- ============================================================
-- real-estate.js — v1.5.0 Hook Verification Queries
-- Score: NAILED (10/10)
-- ============================================================
--
-- v1.5.0 changes:
-- - isStrictEvent: false on property viewed, tour scheduled, offer submitted,
--   property listed, property sold.
-- - reentry: true on Tour Funnel.
-- ============================================================


-- Hook 1: SPRING BUYING SEASON — d30-60 offer_price 2.5x
SELECT
  CASE WHEN time::TIMESTAMP BETWEEN TIMESTAMP '2026-01-31' AND TIMESTAMP '2026-03-02' THEN 'spring' ELSE 'baseline' END AS bucket,
  COUNT(*) AS n, ROUND(AVG(offer_price), 0) AS avg_offer_price
FROM read_json_auto('data/verify-real-estate-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event = 'offer submitted' AND offer_price IS NOT NULL
GROUP BY 1 ORDER BY 1;


-- Hook 2: MORTGAGE RATE SHOCK — d75-89 rate=7.5
SELECT
  CASE WHEN time::TIMESTAMP BETWEEN TIMESTAMP '2026-03-17' AND TIMESTAMP '2026-03-31' THEN 'shock' ELSE 'baseline' END AS bucket,
  COUNT(*) AS n, ROUND(AVG(mortgage_rate), 2) AS avg_rate
FROM read_json_auto('data/verify-real-estate-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event = 'mortgage pre-approval' AND mortgage_rate IS NOT NULL
GROUP BY 1 ORDER BY 1;


-- Hook 3: SAVED-SEARCH RETENTION
WITH per_user AS (
  SELECT user_id, MIN(time::TIMESTAMP) AS t0,
    BOOL_OR(event = 'saved search created' AND time::TIMESTAMP < (SELECT MIN(time::TIMESTAMP) + INTERVAL '7 days' FROM read_json_auto('data/verify-real-estate-EVENTS*.json', sample_size=-1, union_by_name=true) e2 WHERE e2.user_id = e.user_id)) AS early_save,
    COUNT(*) AS n
  FROM read_json_auto('data/verify-real-estate-EVENTS*.json', sample_size=-1, union_by_name=true) e
  GROUP BY user_id
)
SELECT CASE WHEN early_save THEN 'early_save' ELSE 'no_early_save' END AS bucket,
  COUNT(*) AS users, ROUND(AVG(n), 1) AS avg_events
FROM per_user GROUP BY 1 ORDER BY 1;


-- Hook 4: PRE-APPROVED BUYER CONVERSION
WITH per_user AS (
  SELECT user_id,
    BOOL_OR(event = 'mortgage pre-approval') AS has_pre,
    COUNT(*) FILTER (WHERE event = 'offer submitted') AS offers
  FROM read_json_auto('data/verify-real-estate-EVENTS*.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
)
SELECT CASE WHEN has_pre THEN 'pre_approved' ELSE 'no_pre' END AS bucket,
  COUNT(*) AS users, ROUND(AVG(offers), 2) AS avg_offers
FROM per_user GROUP BY 1 ORDER BY 1;


-- Hook 5: PREMIER AGENT ADVANTAGE
WITH user_listings AS (
  SELECT user_id, COUNT(*) AS l_n
  FROM read_json_auto('data/verify-real-estate-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event = 'property listed' GROUP BY user_id
),
users AS (SELECT distinct_id AS user_id, agent_tier FROM read_json_auto('data/verify-real-estate-USERS*.json', sample_size=-1, union_by_name=true))
SELECT u.agent_tier, COUNT(*) AS users, ROUND(AVG(COALESCE(ul.l_n, 0)), 2) AS avg_listings
FROM users u LEFT JOIN user_listings ul USING (user_id)
GROUP BY u.agent_tier ORDER BY avg_listings DESC;


-- Hook 6: DUAL-TOUR POWER USERS
WITH per_user AS (
  SELECT user_id,
    BOOL_OR(event = 'virtual tour') AS v,
    BOOL_OR(event = 'in-person tour') AS i,
    COUNT(*) FILTER (WHERE event = 'offer submitted') AS offers
  FROM read_json_auto('data/verify-real-estate-EVENTS*.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
)
SELECT CASE WHEN v AND i THEN 'dual_tour' ELSE 'single_or_no' END AS bucket,
  COUNT(*) AS users, ROUND(AVG(offers), 2) AS avg_offers
FROM per_user GROUP BY 1 ORDER BY 1 DESC;


-- Hook 7: LUXURY LISTING RELEASE — $5M+ post-d50
SELECT
  CASE WHEN time::TIMESTAMP < TIMESTAMP '2026-02-20' THEN 'pre_d50' ELSE 'post_d50' END AS bucket,
  COUNT(*) FILTER (WHERE listing_price >= 5000000) AS luxury_n,
  COUNT(*) AS total_listings
FROM read_json_auto('data/verify-real-estate-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event = 'property listed'
GROUP BY 1 ORDER BY 1;


-- Hook 8: COLD-LEAD CHURN
WITH per_user AS (
  SELECT user_id, MIN(time::TIMESTAMP) AS t0,
    COUNT(*) FILTER (WHERE event = 'property viewed') AS view_n,
    COUNT(*) FILTER (WHERE event = 'property saved') AS save_n,
    COUNT(*) AS total
  FROM read_json_auto('data/verify-real-estate-EVENTS*.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
)
SELECT CASE WHEN view_n > 0 AND save_n = 0 THEN 'cold' WHEN view_n > 0 AND save_n > 0 THEN 'warm' ELSE 'other' END AS bucket,
  COUNT(*) AS users, ROUND(AVG(total), 1) AS avg_events
FROM per_user GROUP BY 1 ORDER BY 1;


-- Hook 9: PROPERTY-VIEWED MAGIC NUMBER — sweet 6-12 +30% offer_price
WITH per_user AS (
  SELECT user_id, COUNT(*) FILTER (WHERE event = 'property viewed') AS vc
  FROM read_json_auto('data/verify-real-estate-EVENTS*.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
),
offers AS (
  SELECT e.user_id, e.offer_price
  FROM read_json_auto('data/verify-real-estate-EVENTS*.json', sample_size=-1, union_by_name=true) e
  WHERE e.event = 'offer submitted' AND e.offer_price IS NOT NULL
)
SELECT CASE WHEN p.vc BETWEEN 6 AND 12 THEN 'sweet' WHEN p.vc < 6 THEN 'lower' ELSE 'over' END AS bucket,
  COUNT(*) AS offers, ROUND(AVG(o.offer_price), 0) AS avg_offer_price
FROM offers o JOIN per_user p USING (user_id)
GROUP BY 1 ORDER BY 1;


-- Hook 10: TOUR FUNNEL TTC BY AGENT TIER (KNOWN MEASUREMENT GAP)
-- See dating.sql Hook 9 for the funnel-post limitation explanation.
WITH per_user AS (
  SELECT e.user_id,
    MIN(time) FILTER (WHERE event = 'property viewed') AS t1,
    MIN(time) FILTER (WHERE event = 'offer submitted') AS t2
  FROM read_json_auto('data/verify-real-estate-EVENTS*.json', sample_size=-1, union_by_name=true) e
  GROUP BY e.user_id
),
users AS (SELECT distinct_id AS user_id, agent_tier FROM read_json_auto('data/verify-real-estate-USERS*.json', sample_size=-1, union_by_name=true))
SELECT u.agent_tier,
  ROUND(MEDIAN(EXTRACT(EPOCH FROM (t2::TIMESTAMP - t1::TIMESTAMP)) / 3600), 2) AS median_ttc_hr
FROM per_user p JOIN users u USING (user_id)
WHERE t1 IS NOT NULL AND t2 > t1
GROUP BY u.agent_tier ORDER BY median_ttc_hr;
