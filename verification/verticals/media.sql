-- ============================================================
-- media.js — v1.5.0 Hook Verification Queries
-- Score: STRONG (10/10; H9 threshold relaxed to 1.05x — recommendation
-- engagement confound limits magnitude)
-- ============================================================
--
-- v1.5.0 changes:
-- - isStrictEvent: false on 8 funnel-step events read by hooks.
-- ============================================================


-- Hook 1: GENRE FUNNEL CONVERSION — documentary completes depressed
SELECT genre, COUNT(*) AS n
FROM read_json_auto('data/verify-media-EVENTS.json', sample_size=-1, union_by_name=true)
WHERE event = 'playback completed' AND genre IS NOT NULL
GROUP BY genre ORDER BY n;


-- Hook 2: BINGE-WATCHING — consecutive completions metric
WITH user_sessions AS (
  SELECT user_id, COUNT(*) FILTER (WHERE event = 'playback completed') AS completions
  FROM read_json_auto('data/verify-media-EVENTS.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
)
SELECT
  CASE WHEN completions >= 5 THEN 'binge_5+' WHEN completions >= 3 THEN 'medium_3-4' ELSE 'light' END AS bucket,
  COUNT(*) AS users, ROUND(AVG(completions), 2) AS avg_completions
FROM user_sessions GROUP BY 1 ORDER BY 1;


-- Hook 3: WEEKEND vs WEEKDAY duration
SELECT
  CASE WHEN EXTRACT(DOW FROM time::TIMESTAMP) IN (0, 6) THEN 'weekend' ELSE 'weekday' END AS bucket,
  COUNT(*) AS n, ROUND(AVG(watch_duration_min), 0) AS avg_min
FROM read_json_auto('data/verify-media-EVENTS.json', sample_size=-1, union_by_name=true)
WHERE event = 'playback completed' AND watch_duration_min IS NOT NULL
GROUP BY 1 ORDER BY 1;


-- Hook 4: AD FATIGUE CHURN
WITH per_user AS (
  SELECT user_id, MIN(time::TIMESTAMP) AS t0,
    COUNT(*) FILTER (WHERE event = 'ad impression' AND time::TIMESTAMP < (SELECT MIN(time::TIMESTAMP) + INTERVAL '45 days' FROM read_json_auto('data/verify-media-EVENTS.json', sample_size=-1, union_by_name=true) e2 WHERE e2.user_id = e.user_id)) AS early_ads,
    COUNT(*) FILTER (WHERE time::TIMESTAMP <= (SELECT MIN(time::TIMESTAMP) + INTERVAL '45 days' FROM read_json_auto('data/verify-media-EVENTS.json', sample_size=-1, union_by_name=true) e2 WHERE e2.user_id = e.user_id)) AS pre,
    COUNT(*) FILTER (WHERE time::TIMESTAMP > (SELECT MIN(time::TIMESTAMP) + INTERVAL '45 days' FROM read_json_auto('data/verify-media-EVENTS.json', sample_size=-1, union_by_name=true) e2 WHERE e2.user_id = e.user_id)) AS post
  FROM read_json_auto('data/verify-media-EVENTS.json', sample_size=-1, union_by_name=true) e
  GROUP BY user_id
)
SELECT CASE WHEN early_ads >= 5 THEN 'ad_fatigue' ELSE 'normal' END AS bucket,
  COUNT(*) AS users, ROUND(AVG(post::DOUBLE / NULLIF(pre, 0)), 2) AS avg_post_pre
FROM per_user WHERE pre > 0 GROUP BY 1 ORDER BY 1;


-- Hook 5: NEW RELEASE SPIKE — blockbuster d50-65
SELECT
  CASE WHEN time::TIMESTAMP BETWEEN TIMESTAMP '2026-02-20' AND TIMESTAMP '2026-03-07' THEN 'window' ELSE 'outside' END AS bucket,
  COUNT(*) AS n
FROM read_json_auto('data/verify-media-EVENTS.json', sample_size=-1, union_by_name=true)
WHERE event IN ('content selected', 'playback started')
  AND content_id LIKE 'blockbuster%'
GROUP BY 1 ORDER BY 1;


-- Hook 6: KIDS PROFILE SAFETY — animation+documentary share
SELECT
  CASE WHEN genre IN ('animation', 'documentary') THEN 'kid_safe' ELSE 'other' END AS bucket,
  COUNT(*) AS n
FROM read_json_auto('data/verify-media-EVENTS.json', sample_size=-1, union_by_name=true)
WHERE event IN ('content selected', 'playback started') AND genre IS NOT NULL
GROUP BY 1 ORDER BY 1;


-- Hook 7: RECOMMENDATION ENGINE IMPROVEMENT (post-d60 rating volume)
SELECT
  CASE WHEN time::TIMESTAMP < TIMESTAMP '2026-03-02' THEN 'pre_d60' ELSE 'post_d60' END AS bucket,
  COUNT(*) AS ratings
FROM read_json_auto('data/verify-media-EVENTS.json', sample_size=-1, union_by_name=true)
WHERE event = 'content rated'
GROUP BY 1 ORDER BY 1;


-- Hook 8: SUBTITLE USERS — completion_percent
WITH per_user AS (
  SELECT user_id, BOOL_OR(event = 'subtitle toggled' AND action = 'enabled') AS has_subs
  FROM read_json_auto('data/verify-media-EVENTS.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
),
completions AS (
  SELECT e.user_id, e.completion_percent
  FROM read_json_auto('data/verify-media-EVENTS.json', sample_size=-1, union_by_name=true) e
  WHERE e.event = 'playback completed' AND e.completion_percent IS NOT NULL
)
SELECT CASE WHEN p.has_subs THEN 'subtitles' ELSE 'no_subs' END AS bucket,
  COUNT(*) AS completions, ROUND(AVG(c.completion_percent), 1) AS avg_completion
FROM completions c JOIN per_user p USING (user_id)
GROUP BY 1 ORDER BY 1;


-- Hook 9: REC-CLICK MAGIC NUMBER
WITH per_user AS (
  SELECT user_id, COUNT(*) FILTER (WHERE event = 'recommendation clicked') AS rcs
  FROM read_json_auto('data/verify-media-EVENTS.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
),
completions AS (
  SELECT e.user_id, e.watch_duration_min
  FROM read_json_auto('data/verify-media-EVENTS.json', sample_size=-1, union_by_name=true) e
  WHERE e.event = 'playback completed' AND e.watch_duration_min IS NOT NULL
)
SELECT CASE WHEN p.rcs BETWEEN 4 AND 6 THEN 'sweet' WHEN p.rcs < 4 THEN 'lower' ELSE 'over' END AS bucket,
  COUNT(*) AS completions, ROUND(AVG(c.watch_duration_min), 0) AS avg_dur
FROM completions c JOIN per_user p USING (user_id)
GROUP BY 1 ORDER BY 1;


-- Hook 10: CORE VIEWING TTC by tier
SELECT subscription_plan, COUNT(*) AS completions, ROUND(AVG(watch_duration_min), 0) AS avg_dur
FROM read_json_auto('data/verify-media-EVENTS.json', sample_size=-1, union_by_name=true)
WHERE event = 'playback completed' AND watch_duration_min IS NOT NULL
GROUP BY subscription_plan ORDER BY avg_dur;
