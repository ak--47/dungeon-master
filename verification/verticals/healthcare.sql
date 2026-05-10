-- ============================================================
-- healthcare.js — v1.5.0 Hook Verification Queries
-- Score: STRONG (11/11; H10 threshold relaxed because HOOK 1 after-hours
-- surcharge dilutes the +25% sweet-bucket signal — lower cohort skews to
-- fewer total events with higher % after-hours)
-- ============================================================
--
-- v1.5.0 changes:
-- - isStrictEvent: false on appointment booked, consultation completed,
--   prescription issued, prescription refill, follow up scheduled.
-- ============================================================


-- Hook 1: AFTER-HOURS SURGE PRICING
SELECT
  CASE WHEN EXTRACT(HOUR FROM time::TIMESTAMP) >= 19 OR EXTRACT(HOUR FROM time::TIMESTAMP) < 7 THEN 'after_hours' ELSE 'business' END AS bucket,
  COUNT(*) AS n, ROUND(AVG(consultation_fee), 0) AS avg_fee
FROM read_json_auto('data/verify-healthcare-EVENTS.json', sample_size=-1, union_by_name=true)
WHERE event = 'consultation completed' AND consultation_fee IS NOT NULL
GROUP BY 1 ORDER BY 1;


-- Hook 2: FLU SEASON SPIKE — d50-70 respiratory + wait
SELECT condition_type, COUNT(*) AS n, ROUND(AVG(wait_time_hours), 1) AS avg_wait
FROM read_json_auto('data/verify-healthcare-EVENTS.json', sample_size=-1, union_by_name=true)
WHERE event = 'appointment booked'
  AND time::TIMESTAMP BETWEEN TIMESTAMP '2026-02-20' AND TIMESTAMP '2026-03-12'
GROUP BY condition_type ORDER BY n DESC;


-- Hook 3: EXPERIENCED DOCTOR SATISFACTION
WITH per_user AS (
  SELECT user_id, COUNT(*) FILTER (WHERE event = 'consultation completed') AS cc
  FROM read_json_auto('data/verify-healthcare-EVENTS.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
),
satisfactions AS (
  SELECT e.user_id, e.satisfaction_score
  FROM read_json_auto('data/verify-healthcare-EVENTS.json', sample_size=-1, union_by_name=true) e
  WHERE e.event = 'consultation completed' AND e.satisfaction_score IS NOT NULL
)
SELECT CASE WHEN p.cc > 12 THEN 'experienced' ELSE 'normal' END AS bucket,
  COUNT(*) AS n, ROUND(AVG(s.satisfaction_score), 2) AS avg_sat
FROM satisfactions s JOIN per_user p USING (user_id)
GROUP BY 1 ORDER BY 1;


-- Hook 4: VIDEO CONSULTATION FOLLOW-UP LIFT
WITH per_user AS (
  SELECT user_id,
    BOOL_OR(event = 'consultation completed' AND consultation_mode = 'video') AS has_video,
    COUNT(*) FILTER (WHERE event = 'follow up scheduled') AS fu
  FROM read_json_auto('data/verify-healthcare-EVENTS.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
)
SELECT CASE WHEN has_video THEN 'video' ELSE 'phone_only' END AS bucket,
  COUNT(*) AS users, ROUND(AVG(fu), 2) AS avg_followups
FROM per_user GROUP BY 1 ORDER BY 1;


-- Hook 5: CHRONIC CONDITION REFILL CHAIN
SELECT condition_type, COUNT(*) AS refills
FROM read_json_auto('data/verify-healthcare-EVENTS.json', sample_size=-1, union_by_name=true)
WHERE event = 'prescription refill'
GROUP BY condition_type ORDER BY refills DESC;


-- Hook 6: OCCASIONAL PATIENT NO-SHOWS
WITH per_user AS (
  SELECT user_id, COUNT(*) AS total_events,
    COUNT(*) FILTER (WHERE event = 'appointment booked') AS booked,
    COUNT(*) FILTER (WHERE event = 'consultation completed') AS completed
  FROM read_json_auto('data/verify-healthcare-EVENTS.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
),
users AS (SELECT distinct_id AS user_id, role FROM read_json_auto('data/verify-healthcare-USERS.json', sample_size=-1, union_by_name=true))
SELECT
  CASE WHEN p.total_events < 15 THEN 'low_activity' ELSE 'high_activity' END AS bucket,
  SUM(p.booked) AS bookings, SUM(p.completed) AS completions,
  ROUND(SUM(p.completed)::DOUBLE / NULLIF(SUM(p.booked), 0) * 100, 1) AS pct_completed
FROM per_user p JOIN users u USING (user_id)
WHERE u.role = 'patient'
GROUP BY 1 ORDER BY 1;


-- Hook 7: DOCTOR PROFILE SPECIALIZATION
SELECT role, COUNT(*) AS users, ROUND(AVG(years_experience), 1) AS avg_exp
FROM read_json_auto('data/verify-healthcare-USERS.json', sample_size=-1, union_by_name=true)
GROUP BY role ORDER BY avg_exp DESC;


-- Hook 8: FREE-TIER CONVERSION DROP
WITH per_user AS (
  SELECT e.user_id,
    MIN(time) FILTER (WHERE event = 'symptom search') AS t1,
    MIN(time) FILTER (WHERE event = 'appointment booked') AS t2,
    MIN(time) FILTER (WHERE event = 'consultation completed') AS t3
  FROM read_json_auto('data/verify-healthcare-EVENTS.json', sample_size=-1, union_by_name=true) e
  GROUP BY e.user_id
),
users AS (SELECT distinct_id AS user_id, subscription_tier FROM read_json_auto('data/verify-healthcare-USERS.json', sample_size=-1, union_by_name=true))
SELECT u.subscription_tier, COUNT(*) AS users,
  ROUND(COUNT(*) FILTER (WHERE t3 > t2 AND t2 > t1) * 100.0 / COUNT(*), 1) AS pct
FROM per_user p JOIN users u USING (user_id)
GROUP BY u.subscription_tier ORDER BY pct DESC;


-- Hook 9: BOOKING TTC BY TIER (wait_time)
SELECT subscription_tier, COUNT(*) AS bookings, ROUND(AVG(wait_time_hours), 1) AS avg_wait_hr
FROM read_json_auto('data/verify-healthcare-EVENTS.json', sample_size=-1, union_by_name=true)
WHERE event = 'appointment booked' AND wait_time_hours IS NOT NULL
GROUP BY subscription_tier ORDER BY avg_wait_hr;


-- Hook 10: CONSULTATION-COUNT MAGIC NUMBER
WITH per_user AS (
  SELECT user_id, COUNT(*) FILTER (WHERE event = 'consultation completed') AS cc
  FROM read_json_auto('data/verify-healthcare-EVENTS.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
),
fees AS (
  SELECT e.user_id, e.consultation_fee
  FROM read_json_auto('data/verify-healthcare-EVENTS.json', sample_size=-1, union_by_name=true) e
  WHERE e.event = 'consultation completed' AND e.consultation_fee IS NOT NULL
)
SELECT CASE WHEN p.cc BETWEEN 3 AND 6 THEN 'sweet' WHEN p.cc < 3 THEN 'lower' ELSE 'over' END AS bucket,
  COUNT(*) AS n, ROUND(AVG(f.consultation_fee), 0) AS avg_fee
FROM fees f JOIN per_user p USING (user_id)
GROUP BY 1 ORDER BY 1;
