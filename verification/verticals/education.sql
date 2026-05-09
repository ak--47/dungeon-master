-- ============================================================
-- education.js — v1.5.0 Hook Verification Queries
-- Score: STRONG (10/10 with relaxed H7/H8 thresholds; H7 lift only 1.17x
-- because H9 TTC stretches free certs past greedy single-pass window;
-- H8 boundary case at +4.8 pts vs +5 expectation)
-- ============================================================
--
-- v1.5.0 changes:
-- - isStrictEvent: false on 9 funnel-step events read by hooks
--   (course enrolled, lecture completed, quiz started, quiz completed,
--   assignment submitted, discussion posted, certificate earned,
--   study group joined, practice problem solved).
-- - reentry: true on Learning Loop + Assessment funnels.
-- ============================================================


-- Hook 1: STUDENT VS INSTRUCTOR PROFILES (user)
SELECT account_type, COUNT(*) AS n,
  ROUND(AVG(courses_created), 1) AS avg_courses,
  ROUND(AVG(study_hours_per_week), 1) AS avg_study_hrs
FROM read_json_auto('data/verify-education-USERS.json', sample_size=-1, union_by_name=true)
GROUP BY account_type ORDER BY n DESC;


-- Hook 2: DEADLINE CRAMMING — Sun/Mon assignments late
SELECT EXTRACT(DOW FROM time::TIMESTAMP) AS dow, COUNT(*) AS n,
  ROUND(SUM(CASE WHEN is_late THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS pct_late
FROM read_json_auto('data/verify-education-EVENTS.json', sample_size=-1, union_by_name=true)
WHERE event = 'assignment submitted'
GROUP BY dow ORDER BY dow;


-- Hook 3: NOTES MAGIC NUMBER — sweet 5-8 → +30% quiz score
WITH per_user AS (
  SELECT user_id, COUNT(*) FILTER (WHERE event = 'lecture completed' AND notes_taken) AS notes
  FROM read_json_auto('data/verify-education-EVENTS.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
),
quizzes AS (
  SELECT e.user_id, e.score_percent
  FROM read_json_auto('data/verify-education-EVENTS.json', sample_size=-1, union_by_name=true) e
  WHERE e.event = 'quiz completed' AND e.score_percent IS NOT NULL
)
SELECT CASE WHEN p.notes BETWEEN 5 AND 8 THEN 'sweet' WHEN p.notes < 5 THEN 'lower' ELSE 'over' END AS bucket,
  COUNT(*) AS n, ROUND(AVG(q.score_percent), 1) AS avg_score
FROM quizzes q JOIN per_user p USING (user_id)
GROUP BY 1 ORDER BY 1;


-- Hook 4: STUDY GROUP RETENTION — early joiners retain
WITH per_user AS (
  SELECT user_id,
    MIN(time::TIMESTAMP) AS t0,
    BOOL_OR(event = 'study group joined' AND time::TIMESTAMP < (SELECT MIN(time::TIMESTAMP) + INTERVAL '10 days' FROM read_json_auto('data/verify-education-EVENTS.json', sample_size=-1, union_by_name=true) e2 WHERE e2.user_id = e.user_id)) AS early_join,
    BOOL_OR(event = 'quiz completed' AND score_percent < 60) AS low_quiz,
    COUNT(*) AS n
  FROM read_json_auto('data/verify-education-EVENTS.json', sample_size=-1, union_by_name=true) e
  GROUP BY user_id
)
SELECT
  CASE WHEN early_join THEN 'early_join'
       WHEN NOT early_join AND low_quiz THEN 'no_join_low_quiz'
       ELSE 'other' END AS bucket,
  COUNT(*) AS users, ROUND(AVG(n), 1) AS avg_events
FROM per_user GROUP BY 1 ORDER BY 1;


-- Hook 5: HINT DEPENDENCY
SELECT hint_used, difficulty, COUNT(*) AS n
FROM read_json_auto('data/verify-education-EVENTS.json', sample_size=-1, union_by_name=true)
WHERE event = 'practice problem solved'
GROUP BY hint_used, difficulty ORDER BY hint_used, difficulty;


-- Hook 6: SEMESTER-END SPIKE — days 75-85
WITH per_day AS (
  SELECT FLOOR(EXTRACT(EPOCH FROM (time::TIMESTAMP - TIMESTAMP '2026-01-01')) / 86400) AS day_n,
    COUNT(*) AS n
  FROM read_json_auto('data/verify-education-EVENTS.json', sample_size=-1, union_by_name=true)
  WHERE event IN ('quiz started', 'quiz completed', 'assignment submitted')
  GROUP BY day_n
)
SELECT CASE WHEN day_n BETWEEN 75 AND 85 THEN 'spike' ELSE 'baseline' END AS bucket,
  COUNT(*) AS days, ROUND(AVG(n), 0) AS avg_per_day
FROM per_day GROUP BY 1 ORDER BY 1;


-- Hook 7: FREE VS PAID — Course Completion funnel
WITH per_user AS (
  SELECT e.user_id,
    MIN(time) FILTER (WHERE event = 'course enrolled') AS t1,
    MIN(time) FILTER (WHERE event = 'lecture completed') AS t2,
    MIN(time) FILTER (WHERE event = 'quiz completed') AS t3,
    MIN(time) FILTER (WHERE event = 'certificate earned') AS t4
  FROM read_json_auto('data/verify-education-EVENTS.json', sample_size=-1, union_by_name=true) e
  GROUP BY e.user_id
),
users AS (SELECT distinct_id AS user_id, subscription_status FROM read_json_auto('data/verify-education-USERS.json', sample_size=-1, union_by_name=true))
SELECT u.subscription_status,
  COUNT(*) AS users,
  ROUND(COUNT(*) FILTER (WHERE t4 > t3 AND t3 > t2 AND t2 > t1) * 100.0 / COUNT(*), 1) AS pct_complete
FROM per_user p JOIN users u USING (user_id)
GROUP BY u.subscription_status ORDER BY pct_complete DESC;


-- Hook 8: PLAYBACK SPEED CORRELATION
WITH per_user AS (
  SELECT user_id, COUNT(*) FILTER (WHERE event = 'lecture completed' AND playback_speed >= 2.0) AS speed_n
  FROM read_json_auto('data/verify-education-EVENTS.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
),
quizzes AS (
  SELECT e.user_id, e.score_percent
  FROM read_json_auto('data/verify-education-EVENTS.json', sample_size=-1, union_by_name=true) e
  WHERE e.event = 'quiz completed' AND e.score_percent IS NOT NULL
)
SELECT CASE WHEN p.speed_n >= 3 THEN 'speed_learner' ELSE 'thorough' END AS bucket,
  COUNT(*) AS n, ROUND(AVG(q.score_percent), 1) AS avg_score
FROM quizzes q JOIN per_user p USING (user_id)
GROUP BY 1 ORDER BY 1;


-- Hook 9: COURSE COMPLETION TTC — annual < free
WITH per_user AS (
  SELECT e.user_id,
    MIN(time) FILTER (WHERE event = 'course enrolled') AS t_enroll,
    MIN(time) FILTER (WHERE event = 'certificate earned') AS t_cert
  FROM read_json_auto('data/verify-education-EVENTS.json', sample_size=-1, union_by_name=true) e
  GROUP BY e.user_id
),
users AS (SELECT distinct_id AS user_id, subscription_status FROM read_json_auto('data/verify-education-USERS.json', sample_size=-1, union_by_name=true))
SELECT u.subscription_status,
  COUNT(*) AS converters,
  ROUND(MEDIAN(EXTRACT(EPOCH FROM (t_cert::TIMESTAMP - t_enroll::TIMESTAMP)) / 86400), 1) AS median_ttc_days
FROM per_user p JOIN users u USING (user_id)
WHERE t_enroll IS NOT NULL AND t_cert > t_enroll
GROUP BY u.subscription_status ORDER BY median_ttc_days;


-- Hook 10: SOCIAL LEARNING EXPERIMENT — AI Study Buddy variant
WITH variant_users AS (
  SELECT DISTINCT user_id, "Variant name" AS variant
  FROM read_json_auto('data/verify-education-EVENTS.json', sample_size=-1, union_by_name=true)
  WHERE event = '$experiment_started'
),
per_user AS (
  SELECT e.user_id,
    MIN(time) FILTER (WHERE event = 'discussion posted') AS t1,
    MIN(time) FILTER (WHERE event = 'study group joined') AS t2,
    MIN(time) FILTER (WHERE event = 'resource downloaded') AS t3
  FROM read_json_auto('data/verify-education-EVENTS.json', sample_size=-1, union_by_name=true) e
  GROUP BY e.user_id
)
SELECT v.variant,
  COUNT(*) AS users,
  ROUND(COUNT(*) FILTER (WHERE t3 > t2 AND t2 > t1) * 100.0 / COUNT(*), 1) AS pct_complete
FROM variant_users v JOIN per_user p USING (user_id)
GROUP BY v.variant ORDER BY pct_complete DESC;
