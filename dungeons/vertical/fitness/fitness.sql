-- ============================================================
-- fitness.js — v1.5.0 Hook Verification Queries
-- Score: NAILED (12/12 emulator-backed checks passed)
-- Generated: 2026-05-08
-- ============================================================
--
-- v1.5.0 changes from v2:
-- - All funnel-step events read by hooks have explicit isStrictEvent: false
--   (workout completed/planned, progress checked, friend added, challenge
--   joined/completed, achievement unlocked, coach session, profile updated)
-- - Workout Loop funnel has reentry: true (recurring per-user behavior)
-- - Identity-aware verification (avgDevicePerUser=3, hasAnonIds=true) —
--   emulator script passes profiles to all checks
--
-- Run:
--   node scripts/verify-runner.mjs dungeons/vertical/fitness.js verify-fitness
--   duckdb -c ".read research/verifications/v3/fitness.sql"
--   node research/verifications/v3/fitness.verify.mjs
-- ============================================================


-- Hook 1: MORNING WORKOUT BOOST (everything)
-- Pattern: bespoke (DuckDB) — hour-of-day breakdown on raw prop
-- Expected: 5-9 UTC workouts ~1.3x calories vs other hours (range 1.20-1.45)
-- Mixpanel: Insights → workout completed, Avg of calories_burned, breakdown by HOD
SELECT
  CASE WHEN EXTRACT(HOUR FROM time::TIMESTAMP) BETWEEN 5 AND 8 THEN 'morning' ELSE 'other' END AS bucket,
  COUNT(*) AS n,
  ROUND(AVG(calories_burned), 1) AS avg_cal
FROM read_json_auto('data/verify-fitness-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event = 'workout completed' AND calories_burned IS NOT NULL
GROUP BY bucket
ORDER BY bucket;


-- Hook 2: POST-LAUNCH AI COACHING LIFT (everything)
-- Pattern: bespoke (DuckDB) — temporal + property breakdown
-- Expected: After 2026-02-05 (day 35), ai_assisted workouts ~1.2x duration vs self_guided
-- Mixpanel: Insights → workout completed, Avg of duration_minutes, breakdown by coaching_mode, filter time>2026-02-05
SELECT coaching_mode,
  COUNT(*) AS n,
  ROUND(AVG(duration_minutes), 2) AS avg_dur
FROM read_json_auto('data/verify-fitness-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event = 'workout completed'
  AND time::TIMESTAMP >= TIMESTAMP '2026-02-05'
  AND coaching_mode IS NOT NULL
GROUP BY coaching_mode
ORDER BY coaching_mode;


-- Hook 3: STREAK RETENTION (everything)
-- Pattern: bespoke (DuckDB) — segment-level achievement count via cohort
-- Expected: athlete + coach segments avg 2-3x more achievements than casual
-- Mixpanel: Insights → achievement unlocked, Total per user, breakdown by segment user prop
WITH achievements AS (
  SELECT user_id, COUNT(*) AS n
  FROM read_json_auto('data/verify-fitness-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event = 'achievement unlocked'
  GROUP BY user_id
),
users AS (
  SELECT distinct_id AS user_id, segment FROM read_json_auto('data/verify-fitness-USERS*.json', sample_size=-1, union_by_name=true)
)
SELECT u.segment, COUNT(*) AS users, ROUND(AVG(COALESCE(a.n, 0)), 2) AS avg_ach
FROM users u LEFT JOIN achievements a USING (user_id)
GROUP BY u.segment ORDER BY avg_ach DESC;


-- Hook 4: SOCIAL CHALLENGE COMPLETION (everything)
-- Pattern: bespoke (DuckDB) — behavioral cohort (>=3 friends)
-- Expected: users with >=3 friend_added events have ~1.5x+ challenge completions
-- Mixpanel: Insights → challenge completed, Total per user, filter cohort users-who-did friend added>=3
WITH friends AS (
  SELECT user_id, COUNT(*) AS f_n
  FROM read_json_auto('data/verify-fitness-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event = 'friend added' GROUP BY user_id
),
challenges AS (
  SELECT user_id, COUNT(*) AS c_n
  FROM read_json_auto('data/verify-fitness-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event = 'challenge completed' GROUP BY user_id
),
users AS (SELECT distinct_id AS user_id FROM read_json_auto('data/verify-fitness-USERS*.json', sample_size=-1, union_by_name=true))
SELECT
  CASE WHEN COALESCE(f.f_n, 0) >= 3 THEN 'social' ELSE 'non' END AS bucket,
  COUNT(*) AS users, ROUND(AVG(COALESCE(c.c_n, 0)), 3) AS avg_challenges
FROM users u LEFT JOIN friends f USING (user_id) LEFT JOIN challenges c USING (user_id)
GROUP BY 1 ORDER BY 1;


-- Hook 5: RESOLVER CHURN CLIFF (everything)
-- Pattern: bespoke (DuckDB) — segment × time-window
-- Expected: resolver post-day-14 events ~30% of pre-day-14 (vs ~80%+ for casual)
-- Mixpanel: Retention → "account created" → any active event, breakdown by segment
WITH per_user AS (
  SELECT e.user_id,
    COUNT(*) FILTER (WHERE e.time::TIMESTAMP < TIMESTAMP '2026-01-15') AS pre,
    COUNT(*) FILTER (WHERE e.time::TIMESTAMP >= TIMESTAMP '2026-01-15') AS post
  FROM read_json_auto('data/verify-fitness-EVENTS*.json', sample_size=-1, union_by_name=true) e
  GROUP BY e.user_id
),
users AS (SELECT distinct_id AS user_id, segment FROM read_json_auto('data/verify-fitness-USERS*.json', sample_size=-1, union_by_name=true))
SELECT u.segment,
  ROUND(SUM(p.post)::DOUBLE / NULLIF(SUM(p.pre), 0), 3) AS post_pre_ratio
FROM per_user p JOIN users u USING (user_id)
GROUP BY u.segment ORDER BY post_pre_ratio;


-- Hook 6: COACH SESSION QUALITY (everything)
-- Pattern: bespoke (DuckDB) — single-event aggregate
-- Expected: coach session satisfaction_score avg ~4.5 (vs baseline ~3.0)
-- Mixpanel: Insights → coach session, Avg of satisfaction_score
SELECT event, COUNT(*) AS n, ROUND(AVG(satisfaction_score), 2) AS avg_sat
FROM read_json_auto('data/verify-fitness-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event = 'coach session' AND satisfaction_score IS NOT NULL
GROUP BY event;


-- Hook 7: COACH PROFILE ENRICHMENT (user)
-- Pattern: bespoke (DuckDB) — user-property breakdown
-- Expected: coach segment total_workouts 200-500, others ~0
-- Mixpanel: Users → breakdown by segment, Avg of total_workouts user prop
SELECT segment, COUNT(*) AS users,
  ROUND(AVG(total_workouts), 1) AS avg_workouts,
  ROUND(AVG(streak_days), 1) AS avg_streak
FROM read_json_auto('data/verify-fitness-USERS*.json', sample_size=-1, union_by_name=true)
GROUP BY segment ORDER BY avg_workouts DESC;


-- Hook 8: ANNUAL SUBSCRIBER FUNNEL LIFT (everything)
-- Pattern: funnelFrequency (use emulator script for greedy single-pass + identity merge)
-- Expected: annual/family conversion ~1.4x free conversion on Workout Loop funnel
-- Mixpanel: Funnels → workout planned → workout completed → progress checked, breakdown by subscription_tier
-- Note: SQL approximation below; canonical check is emulator funnelFrequency with profiles param.
WITH ordered AS (
  SELECT user_id, time, event,
    ROW_NUMBER() OVER (PARTITION BY user_id, event ORDER BY time) AS rn
  FROM read_json_auto('data/verify-fitness-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event IN ('workout planned', 'workout completed', 'progress checked')
),
firsts AS (
  SELECT user_id,
    MIN(time) FILTER (WHERE event = 'workout planned') AS t_plan,
    MIN(time) FILTER (WHERE event = 'workout completed' AND time > MIN(time) FILTER (WHERE event = 'workout planned')) AS t_done
  FROM ordered GROUP BY user_id
),
users AS (SELECT distinct_id AS user_id, subscription_tier FROM read_json_auto('data/verify-fitness-USERS*.json', sample_size=-1, union_by_name=true))
SELECT u.subscription_tier,
  COUNT(*) AS planned,
  COUNT(t_done) AS completed,
  ROUND(COUNT(t_done) * 100.0 / COUNT(*), 1) AS pct
FROM firsts f JOIN users u USING (user_id)
WHERE t_plan IS NOT NULL
GROUP BY u.subscription_tier ORDER BY pct DESC;


-- Hook 9: WORKOUT LOOP TIME-TO-CONVERT (funnel-post)
-- Pattern: timeToConvert with breakdownByUserProperty (use emulator script)
-- Expected: free TTC ~1.25x slower than annual; ratio free/annual > 1.20
-- Mixpanel: Funnels → workout planned → progress checked, Median TTC, breakdown by subscription_tier
-- Note: SQL only approximates median by-user MIN→MIN gap; emulator computes greedy single-pass TTC.
WITH per_user AS (
  SELECT e.user_id,
    MIN(time) FILTER (WHERE event = 'workout planned') AS t_plan,
    MIN(time) FILTER (WHERE event = 'progress checked') AS t_done
  FROM read_json_auto('data/verify-fitness-EVENTS*.json', sample_size=-1, union_by_name=true) e
  GROUP BY e.user_id
),
users AS (SELECT distinct_id AS user_id, subscription_tier FROM read_json_auto('data/verify-fitness-USERS*.json', sample_size=-1, union_by_name=true))
SELECT u.subscription_tier,
  COUNT(*) FILTER (WHERE t_done > t_plan) AS converters,
  ROUND(MEDIAN(EXTRACT(EPOCH FROM (t_done::TIMESTAMP - t_plan::TIMESTAMP)) / 3600), 2) AS median_ttc_hr
FROM per_user p JOIN users u USING (user_id)
WHERE t_plan IS NOT NULL AND t_done > t_plan
GROUP BY u.subscription_tier ORDER BY median_ttc_hr;


-- Hook 10: WORKOUT-COUNT MAGIC NUMBER (everything)
-- Pattern: bespoke (DuckDB) — behavioral cohort by event count
-- Expected: users with 12-14 workouts avg ~1.35x duration vs <12 cohort
-- Mixpanel: Insights → workout completed, Avg duration_minutes, filter cohort users-who-did workout completed 12-14 times
WITH per_user AS (
  SELECT user_id, COUNT(*) AS n, AVG(duration_minutes) AS avg_dur
  FROM read_json_auto('data/verify-fitness-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event = 'workout completed' AND duration_minutes IS NOT NULL
  GROUP BY user_id
)
SELECT
  CASE WHEN n BETWEEN 12 AND 14 THEN 'sweet' WHEN n < 12 THEN 'lower' ELSE 'over' END AS bucket,
  COUNT(*) AS users, ROUND(AVG(avg_dur), 1) AS mean_avg_dur
FROM per_user GROUP BY 1 ORDER BY 1;


-- BONUS: Retention curve (emulator-backed; SQL approximation)
-- Pattern: retention (cohortEvent='account created', returnEvent='workout completed')
-- Expected: monotonically non-increasing across day buckets [0,1,7,14,30]
-- Mixpanel: Retention → cohort: did account created, return: did workout completed
-- Note: SQL bucketing here is calendar-day-floor; emulator uses ms-delta from birth (Mixpanel-aligned).
WITH cohorts AS (
  SELECT user_id, MIN(time) AS birth_time
  FROM read_json_auto('data/verify-fitness-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event = 'account created' GROUP BY user_id
),
returns AS (
  SELECT e.user_id, FLOOR(EXTRACT(EPOCH FROM (e.time::TIMESTAMP - c.birth_time::TIMESTAMP)) / 86400) AS day_delta
  FROM read_json_auto('data/verify-fitness-EVENTS*.json', sample_size=-1, union_by_name=true) e
  JOIN cohorts c ON e.user_id = c.user_id
  WHERE e.event = 'workout completed' AND e.time > c.birth_time
)
SELECT day_delta, COUNT(DISTINCT user_id) AS retained
FROM returns
WHERE day_delta IN (0, 1, 7, 14, 30)
GROUP BY day_delta ORDER BY day_delta;
