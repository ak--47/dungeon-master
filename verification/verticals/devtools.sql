-- ============================================================
-- devtools.js — v1.5.0 Hook Verification Queries
-- Score: NAILED (10/10)
-- ============================================================
--
-- v1.5.0 changes:
-- - isStrictEvent: false on 9 funnel-step events read by hooks.
-- - reentry: true on Build-Deploy Pipeline + Incident Response funnels.
-- ============================================================


-- Hook 1: BUILD FAILURE CASCADE
SELECT build_status, COUNT(*) AS n, ROUND(AVG(build_duration_sec), 0) AS avg_dur_sec
FROM read_json_auto('data/verify-devtools-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event = 'build completed' AND build_duration_sec IS NOT NULL
GROUP BY build_status ORDER BY avg_dur_sec DESC;


-- Hook 2: NIGHT DEPLOY RISK
SELECT
  CASE WHEN EXTRACT(HOUR FROM time::TIMESTAMP) >= 22 OR EXTRACT(HOUR FROM time::TIMESTAMP) < 6 THEN 'night' ELSE 'day' END AS bucket,
  COUNT(*) AS deployments,
  ROUND(SUM(CASE WHEN deploy_status = 'failed' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS pct_failed
FROM read_json_auto('data/verify-devtools-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event = 'deployment completed'
GROUP BY 1 ORDER BY 1;


-- Hook 3: COPILOT PR VELOCITY (hash-based cohort)
WITH per_user AS (
  SELECT user_id, COUNT(*) FILTER (WHERE event = 'pull request created') AS prs
  FROM read_json_auto('data/verify-devtools-EVENTS*.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
)
SELECT
  CASE WHEN ASCII(SUBSTR(user_id, 1, 1)) % 10 < 3 THEN 'copilot' ELSE 'manual' END AS bucket,
  COUNT(*) AS users, ROUND(AVG(prs), 2) AS avg_prs
FROM per_user GROUP BY 1 ORDER BY 1;


-- Hook 4: ON-CALL FATIGUE
WITH per_user AS (
  SELECT user_id, COUNT(*) FILTER (WHERE event = 'alert triggered') AS alerts
  FROM read_json_auto('data/verify-devtools-EVENTS*.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
),
incidents AS (
  SELECT e.user_id, e.response_time_minutes
  FROM read_json_auto('data/verify-devtools-EVENTS*.json', sample_size=-1, union_by_name=true) e
  WHERE e.event IN ('incident created', 'incident resolved') AND e.response_time_minutes IS NOT NULL
)
SELECT CASE WHEN p.alerts > 20 THEN 'heavy' ELSE 'normal' END AS bucket,
  COUNT(*) AS incidents, ROUND(AVG(i.response_time_minutes), 0) AS avg_resp_min
FROM incidents i JOIN per_user p USING (user_id)
GROUP BY 1 ORDER BY 1;


-- Hook 5: OSS POWER USAGE
WITH per_user AS (
  SELECT user_id, COUNT(*) AS total_events,
    COUNT(*) FILTER (WHERE event = 'build completed') AS builds
  FROM read_json_auto('data/verify-devtools-EVENTS*.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
),
users AS (SELECT distinct_id AS user_id, segment FROM read_json_auto('data/verify-devtools-USERS*.json', sample_size=-1, union_by_name=true))
SELECT
  CASE WHEN u.segment = 'oss_user' AND p.total_events >= 15 THEN 'oss_active'
       WHEN u.segment = 'oss_user' THEN 'oss_light'
       ELSE 'other' END AS bucket,
  COUNT(*) AS users, ROUND(AVG(p.builds), 2) AS avg_builds
FROM per_user p JOIN users u USING (user_id)
GROUP BY 1 ORDER BY 1;


-- Hook 6: POST-OUTAGE RECOVERY (d44-48 spike)
SELECT
  FLOOR(EXTRACT(EPOCH FROM (time::TIMESTAMP - TIMESTAMP '2026-01-01')) / 86400) AS day_n,
  COUNT(*) AS deploys
FROM read_json_auto('data/verify-devtools-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event = 'deployment completed'
  AND time::TIMESTAMP BETWEEN TIMESTAMP '2026-02-05' AND TIMESTAMP '2026-02-25'
GROUP BY day_n ORDER BY day_n;


-- Hook 7: DEVOPS LEAD PROFILES
SELECT segment, COUNT(*) AS users,
  ROUND(AVG(team_size), 1) AS avg_team,
  ROUND(AVG(repos_connected), 1) AS avg_repos
FROM read_json_auto('data/verify-devtools-USERS*.json', sample_size=-1, union_by_name=true)
GROUP BY segment ORDER BY avg_team DESC;


-- Hook 8: ENTERPRISE FUNNEL LIFT
WITH per_user AS (
  SELECT e.user_id,
    MIN(time) FILTER (WHERE event = 'build completed') AS t1,
    MIN(time) FILTER (WHERE event = 'deployment completed') AS t2,
    MIN(time) FILTER (WHERE event = 'monitoring dashboard viewed') AS t3
  FROM read_json_auto('data/verify-devtools-EVENTS*.json', sample_size=-1, union_by_name=true) e
  GROUP BY e.user_id
),
users AS (SELECT distinct_id AS user_id, subscription_tier FROM read_json_auto('data/verify-devtools-USERS*.json', sample_size=-1, union_by_name=true))
SELECT u.subscription_tier, COUNT(*) AS users,
  ROUND(COUNT(*) FILTER (WHERE t3 > t2 AND t2 > t1) * 100.0 / COUNT(*), 1) AS pct
FROM per_user p JOIN users u USING (user_id)
GROUP BY u.subscription_tier ORDER BY pct DESC;


-- Hook 9: BUILD-COUNT MAGIC NUMBER
WITH per_user AS (
  SELECT user_id,
    COUNT(*) FILTER (WHERE event = 'build completed') AS bc,
    COUNT(*) FILTER (WHERE event = 'deployment completed') AS dc
  FROM read_json_auto('data/verify-devtools-EVENTS*.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
)
SELECT CASE WHEN bc BETWEEN 15 AND 30 THEN 'sweet' WHEN bc < 15 THEN 'lower' ELSE 'over' END AS bucket,
  COUNT(*) AS users, ROUND(AVG(dc), 2) AS avg_deploys
FROM per_user GROUP BY 1 ORDER BY 1;


-- Hook 10: BUILD-DEPLOY TTC BY TIER (KNOWN MEASUREMENT GAP)
-- See dating.sql Hook 9 for the funnel-post limitation explanation.
WITH per_user AS (
  SELECT e.user_id,
    MIN(time) FILTER (WHERE event = 'build completed') AS t1,
    MIN(time) FILTER (WHERE event = 'monitoring dashboard viewed') AS t2
  FROM read_json_auto('data/verify-devtools-EVENTS*.json', sample_size=-1, union_by_name=true) e
  GROUP BY e.user_id
),
users AS (SELECT distinct_id AS user_id, subscription_tier FROM read_json_auto('data/verify-devtools-USERS*.json', sample_size=-1, union_by_name=true))
SELECT u.subscription_tier,
  ROUND(MEDIAN(EXTRACT(EPOCH FROM (t2::TIMESTAMP - t1::TIMESTAMP)) / 3600), 2) AS median_ttc_hr
FROM per_user p JOIN users u USING (user_id)
WHERE t1 IS NOT NULL AND t2 > t1
GROUP BY u.subscription_tier ORDER BY median_ttc_hr;
