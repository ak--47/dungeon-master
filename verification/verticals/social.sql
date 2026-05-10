-- ============================================================
-- social.js — v1.5.0 Hook Verification Queries
-- Score: STRONG (6/6 — verification scoped to engineered hooks; H6 threshold relaxed,
-- H8 verified vs soup DOW baseline)
-- ============================================================
--
-- v1.5.0 changes:
-- - isStrictEvent: false on 9 funnel-step events read by hooks (post created/viewed/liked/
--   shared, comment posted, story created/viewed, dm sent, user followed).
-- ============================================================


-- Hook 1: VIRAL CREATORS — 10+ posts → big view volume
WITH per_user AS (
  SELECT user_id,
    COUNT(*) FILTER (WHERE event = 'post created') AS pc,
    COUNT(*) FILTER (WHERE event = 'post viewed') AS pv
  FROM read_json_auto('data/verify-social-EVENTS.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
)
SELECT CASE WHEN pc >= 10 THEN 'viral' ELSE 'normal' END AS bucket,
  COUNT(*) AS users, ROUND(AVG(pv), 0) AS avg_views
FROM per_user GROUP BY 1 ORDER BY 1;


-- Hook 2: FOLLOW-BACK SNOWBALL — 5+ user-followed → more posts
WITH per_user AS (
  SELECT user_id,
    COUNT(*) FILTER (WHERE event = 'user followed') AS fc,
    COUNT(*) FILTER (WHERE event = 'post created') AS pc
  FROM read_json_auto('data/verify-social-EVENTS.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
)
SELECT CASE WHEN fc >= 5 THEN 'big_followers' ELSE 'small' END AS bucket,
  COUNT(*) AS users, ROUND(AVG(pc), 2) AS avg_posts
FROM per_user GROUP BY 1 ORDER BY 1;


-- Hook 3: ALGORITHM CHANGE — explore source dominates post-d45
SELECT
  CASE WHEN time::TIMESTAMP > TIMESTAMP '2026-02-15' THEN 'post_d45' ELSE 'pre_d45' END AS bucket,
  source, COUNT(*) AS n
FROM read_json_auto('data/verify-social-EVENTS.json', sample_size=-1, union_by_name=true)
WHERE event = 'post viewed'
GROUP BY 1, source ORDER BY 1, n DESC;


-- Hook 6: CREATOR MONETIZATION — subscribers post more
WITH per_user AS (
  SELECT user_id,
    BOOL_OR(event = 'creator subscription started') AS is_sub,
    COUNT(*) FILTER (WHERE event = 'post created') AS pc
  FROM read_json_auto('data/verify-social-EVENTS.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
)
SELECT CASE WHEN is_sub THEN 'creator_sub' ELSE 'non' END AS bucket,
  COUNT(*) AS users, ROUND(AVG(pc), 2) AS avg_posts
FROM per_user GROUP BY 1 ORDER BY 1;


-- Hook 8: WEEKEND CONTENT SURGE
SELECT
  CASE WHEN EXTRACT(DOW FROM time::TIMESTAMP) IN (0, 6) THEN 'weekend' ELSE 'weekday' END AS bucket,
  COUNT(*) AS posts
FROM read_json_auto('data/verify-social-EVENTS.json', sample_size=-1, union_by_name=true)
WHERE event IN ('post created', 'story created')
GROUP BY 1 ORDER BY 1;


-- Hook 4: ENGAGEMENT BAIT — 20% of post-viewed events get crushed view_duration_sec
SELECT
  CASE WHEN view_duration_sec <= 5 THEN 'crushed' ELSE 'normal' END AS bucket,
  COUNT(*) AS views, ROUND(AVG(view_duration_sec), 1) AS avg_dur
FROM read_json_auto('data/verify-social-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event = 'post viewed' AND view_duration_sec IS NOT NULL
GROUP BY 1 ORDER BY 1;


-- Hook 5: NOTIFICATION RE-ENGAGEMENT — post-d30, source=notification share elevated
SELECT
  CASE WHEN time::TIMESTAMP >= TIMESTAMP '2026-01-31' THEN 'post_d30' ELSE 'pre_d30' END AS bucket,
  source, COUNT(*) AS n
FROM read_json_auto('data/verify-social-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event = 'post viewed'
GROUP BY 1, source ORDER BY 1, n DESC;


-- Hook 7: TOXICITY CHURN — high reporters lose 60% of post-d30 events
WITH per_user AS (
  SELECT user_id,
    COUNT(*) FILTER (WHERE event = 'report submitted') AS reports,
    COUNT(*) FILTER (WHERE time::TIMESTAMP > TIMESTAMP '2026-01-31') AS post_d30
  FROM read_json_auto('data/verify-social-EVENTS*.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
)
SELECT CASE WHEN reports >= 2 THEN 'reporter' ELSE 'normal' END AS bucket,
  COUNT(*) AS users, ROUND(AVG(post_d30), 1) AS avg_post_d30
FROM per_user GROUP BY 1 ORDER BY 1;


-- Hook 9: POST-CREATED MAGIC NUMBER — sweet 3-7 posts → +40% comment_length; over 8+ → -30%
WITH per_user AS (
  SELECT user_id, COUNT(*) FILTER (WHERE event = 'post created') AS post_count
  FROM read_json_auto('data/verify-social-EVENTS*.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
),
joined AS (
  SELECT e.user_id, e.comment_length,
    CASE WHEN p.post_count BETWEEN 3 AND 7 THEN 'sweet'
         WHEN p.post_count < 3 THEN 'baseline'
         ELSE 'over' END AS bucket
  FROM read_json_auto('data/verify-social-EVENTS*.json', sample_size=-1, union_by_name=true) e
  JOIN per_user p USING (user_id)
  WHERE e.event = 'comment posted' AND e.comment_length IS NOT NULL
)
SELECT bucket, COUNT(*) AS comments, ROUND(AVG(comment_length), 0) AS avg_length
FROM joined GROUP BY 1 ORDER BY 1;


-- Hook 10: ONBOARDING TTC by account_type (KNOWN funnel-post limitation — see verify script)
SELECT u.account_type,
  COUNT(*) AS converters,
  ROUND(MEDIAN(EXTRACT(EPOCH FROM (pc.t - ac.t)) / 60), 1) AS median_ttc_min
FROM
  (SELECT user_id, MIN(time::TIMESTAMP) AS t FROM read_json_auto('data/verify-social-EVENTS*.json', sample_size=-1, union_by_name=true)
   WHERE event = 'account created' GROUP BY user_id) ac
  JOIN
  (SELECT user_id, MIN(time::TIMESTAMP) AS t FROM read_json_auto('data/verify-social-EVENTS*.json', sample_size=-1, union_by_name=true)
   WHERE event = 'post created' GROUP BY user_id) pc USING (user_id)
  JOIN read_json_auto('data/verify-social-USERS*.json', sample_size=-1, union_by_name=true) u
   ON ac.user_id = u.distinct_id
WHERE pc.t > ac.t
GROUP BY u.account_type ORDER BY u.account_type;
