-- ============================================================
-- community.js — v1.5.0 Hook Verification Queries
-- Score: NAILED (11/11 emulator-backed checks passed)
-- Generated: 2026-05-08
-- ============================================================
--
-- v1.5.0 changes:
-- - isStrictEvent: false on article viewed, article published, comment posted,
--   upvote given, discussion posted (5 events read by hooks).
-- - reentry: true on Engagement Loop (recurring per-user behavior).
-- - HOOK 8 strengthened: 50% → 65% comment drop on free tier (signal lift
--   moved from 1.34x to 1.68x to clear ~1.5x threshold).
-- - Identity-aware (avgDevicePerUser=2, hasAnonIds=true).
-- ============================================================


-- Hook 1: WEEKEND CONTENT SURGE
-- Pattern: bespoke (DuckDB) — DOW breakdown on word_count
-- Expected: weekend (Sat/Sun) word_count ~1.5x weekday
-- Mixpanel: Insights → article published, Avg of word_count, breakdown by DOW
SELECT
  CASE WHEN EXTRACT(DOW FROM time::TIMESTAMP) IN (0, 6) THEN 'weekend' ELSE 'weekday' END AS bucket,
  COUNT(*) AS n, ROUND(AVG(word_count), 0) AS avg_word
FROM read_json_auto('data/verify-community-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event IN ('article published', 'article viewed') AND word_count IS NOT NULL
GROUP BY 1 ORDER BY 1;


-- Hook 2: TRENDING TOPIC WINDOW
-- Pattern: bespoke (DuckDB) — gaming hub × time window
-- Expected: gaming hub view_count avg ~2x in days 35-50 vs outside window
-- Mixpanel: Insights → article viewed, Avg view_count, filter content_hub=gaming, line by week
SELECT
  CASE WHEN time::TIMESTAMP BETWEEN TIMESTAMP '2026-02-05' AND TIMESTAMP '2026-02-20' THEN 'in_window' ELSE 'outside' END AS bucket,
  COUNT(*) AS n, ROUND(AVG(view_count), 0) AS avg_views
FROM read_json_auto('data/verify-community-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event = 'article viewed' AND content_hub = 'gaming' AND view_count IS NOT NULL
GROUP BY 1 ORDER BY 1;


-- Hook 3: POWER CREATOR ENGAGEMENT LIFT
-- Pattern: bespoke (DuckDB) — behavioral cohort by article-published count
-- Expected: users with >20 articles published have ~3x avg upvote_count on upvote events
-- Mixpanel: Insights → upvote given, Avg of upvote_count, breakdown by behavioral cohort
WITH per_user AS (
  SELECT user_id, COUNT(*) FILTER (WHERE event = 'article published') AS pc
  FROM read_json_auto('data/verify-community-EVENTS*.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
),
upvotes AS (
  SELECT e.user_id, e.upvote_count
  FROM read_json_auto('data/verify-community-EVENTS*.json', sample_size=-1, union_by_name=true) e
  WHERE e.event = 'upvote given' AND e.upvote_count IS NOT NULL
)
SELECT CASE WHEN p.pc > 20 THEN 'big' ELSE 'rest' END AS bucket,
  COUNT(*) AS n, ROUND(AVG(u.upvote_count), 2) AS avg_upvote
FROM upvotes u JOIN per_user p USING (user_id)
GROUP BY 1 ORDER BY 1 DESC;


-- Hook 4: DISCUSSION DEPTH BY CONTRIBUTOR TYPE
-- Pattern: aggregatePerUser — comments per user by segment
-- Expected: active_contributor segment has ~1.5x+ avg comments vs others
-- Mixpanel: Insights → comment posted, Total per user, breakdown by segment user prop
WITH user_comments AS (
  SELECT user_id, COUNT(*) AS c_n
  FROM read_json_auto('data/verify-community-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event = 'comment posted' GROUP BY user_id
),
users AS (SELECT distinct_id AS user_id, segment FROM read_json_auto('data/verify-community-USERS*.json', sample_size=-1, union_by_name=true))
SELECT u.segment, COUNT(*) AS users, ROUND(AVG(COALESCE(c.c_n, 0)), 2) AS avg_comments
FROM users u LEFT JOIN user_comments c USING (user_id)
GROUP BY u.segment ORDER BY avg_comments DESC;


-- Hook 5: EDIT WAR DETECTION
-- Pattern: bespoke (DuckDB) — edit_quality by edit-volume cohort
-- Expected: users with >5 edits have edit_quality avg ~1.5 (vs ~3.0 baseline)
-- Mixpanel: Insights → article edited, Avg of edit_quality, breakdown by behavioral cohort
WITH per_user AS (
  SELECT user_id, COUNT(*) AS edit_n
  FROM read_json_auto('data/verify-community-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event = 'article edited' GROUP BY user_id
),
edits AS (
  SELECT e.user_id, e.edit_quality
  FROM read_json_auto('data/verify-community-EVENTS*.json', sample_size=-1, union_by_name=true) e
  WHERE e.event = 'article edited' AND e.edit_quality IS NOT NULL
)
SELECT CASE WHEN p.edit_n > 5 THEN 'heavy' ELSE 'light' END AS bucket,
  COUNT(*) AS n, ROUND(AVG(e.edit_quality), 2) AS avg_quality
FROM edits e JOIN per_user p USING (user_id)
GROUP BY 1 ORDER BY 1;


-- Hook 6: LURKER CHURN
-- Pattern: bespoke (DuckDB) — events per user by segment
-- Expected: lurker segment has ~25% of avg events vs other segments
-- Mixpanel: Insights → all events, Total per user, breakdown by segment, line by week
WITH user_counts AS (
  SELECT user_id, COUNT(*) AS n
  FROM read_json_auto('data/verify-community-EVENTS*.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
),
users AS (SELECT distinct_id AS user_id, segment FROM read_json_auto('data/verify-community-USERS*.json', sample_size=-1, union_by_name=true))
SELECT u.segment, COUNT(*) AS users, ROUND(AVG(COALESCE(c.n, 0)), 1) AS avg_events
FROM users u LEFT JOIN user_counts c USING (user_id)
GROUP BY u.segment ORDER BY avg_events;


-- Hook 7: CREATOR PROFILES
-- Pattern: bespoke (DuckDB) — user-property breakdown
-- Expected: creator avg reputation_score ~90, reader ~10-20
-- Mixpanel: Users → breakdown by role, Avg of reputation_score user prop
SELECT role, COUNT(*) AS users,
  ROUND(AVG(reputation_score), 1) AS avg_rep,
  ROUND(AVG(articles_created), 1) AS avg_articles
FROM read_json_auto('data/verify-community-USERS*.json', sample_size=-1, union_by_name=true)
GROUP BY role ORDER BY avg_rep DESC;


-- Hook 8: PRO SUBSCRIBER CONTENT CREATION FUNNEL LIFT
-- Pattern: funnelFrequency-style breakdown by tier
-- Expected: paid (pro/supporter) ~1.5x+ free conversion on Content Creation funnel
-- Mixpanel: Funnels → article viewed → article published → comment posted, breakdown by subscription_tier
WITH ordered AS (
  SELECT user_id, time, event
  FROM read_json_auto('data/verify-community-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event IN ('article viewed', 'article published', 'comment posted')
),
firsts AS (
  SELECT user_id,
    MIN(time) FILTER (WHERE event = 'article viewed') AS t1,
    MIN(time) FILTER (WHERE event = 'article published') AS t2,
    MIN(time) FILTER (WHERE event = 'comment posted') AS t3
  FROM ordered GROUP BY user_id
),
users AS (SELECT distinct_id AS user_id, subscription_tier FROM read_json_auto('data/verify-community-USERS*.json', sample_size=-1, union_by_name=true))
SELECT u.subscription_tier,
  COUNT(*) AS users,
  COUNT(*) FILTER (WHERE t3 > t2 AND t2 > t1) AS converters,
  ROUND(COUNT(*) FILTER (WHERE t3 > t2 AND t2 > t1) * 100.0 / COUNT(*), 1) AS pct
FROM firsts f JOIN users u USING (user_id)
GROUP BY u.subscription_tier ORDER BY pct DESC;


-- Hook 9: CONTENT CREATION TTC BY TIER (KNOWN MEASUREMENT GAP)
-- Pattern: timeToConvert with breakdownByUserProperty
-- Note: funnel-post adjusts gaps WITHIN funnel-instance only. Cross-event
-- queries on raw events do not show this — Mixpanel funnel median TTC does.
-- See research/verifications/v3/dating.sql Hook 9 for the same caveat.
WITH per_user AS (
  SELECT e.user_id,
    MIN(time) FILTER (WHERE event = 'article viewed') AS t_view,
    MIN(time) FILTER (WHERE event = 'comment posted') AS t_comment
  FROM read_json_auto('data/verify-community-EVENTS*.json', sample_size=-1, union_by_name=true) e
  GROUP BY e.user_id
),
users AS (SELECT distinct_id AS user_id, subscription_tier FROM read_json_auto('data/verify-community-USERS*.json', sample_size=-1, union_by_name=true))
SELECT u.subscription_tier,
  COUNT(*) FILTER (WHERE t_comment > t_view) AS converters,
  ROUND(MEDIAN(EXTRACT(EPOCH FROM (t_comment::TIMESTAMP - t_view::TIMESTAMP)) / 3600), 2) AS median_ttc_hr
FROM per_user p JOIN users u USING (user_id)
WHERE t_view IS NOT NULL AND t_comment > t_view
GROUP BY u.subscription_tier ORDER BY median_ttc_hr;


-- Hook 10: ARTICLE-PUBLISHED MAGIC NUMBER
-- Pattern: bespoke (DuckDB) — sweet 2-5 boost + over 6+ drop on upvote events
-- Expected: sweet (2-5 articles) avg upvote_count ~1.35x lower (0-1) cohort
-- Mixpanel: Insights → upvote given, Avg of upvote_count, behavioral cohorts on article published count
WITH per_user AS (
  SELECT user_id, COUNT(*) FILTER (WHERE event = 'article published') AS ac
  FROM read_json_auto('data/verify-community-EVENTS*.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
),
upvotes AS (
  SELECT e.user_id, e.upvote_count
  FROM read_json_auto('data/verify-community-EVENTS*.json', sample_size=-1, union_by_name=true) e
  WHERE e.event = 'upvote given' AND e.upvote_count IS NOT NULL
)
SELECT CASE WHEN p.ac BETWEEN 2 AND 5 THEN 'sweet' WHEN p.ac < 2 THEN 'lower' ELSE 'over' END AS bucket,
  COUNT(*) AS upvote_events,
  COUNT(DISTINCT user_id) AS users,
  ROUND(AVG(u.upvote_count), 2) AS avg_upvote_count
FROM upvotes u JOIN per_user p USING (user_id)
GROUP BY 1 ORDER BY 1;
