-- ============================================================
-- dating.js — v1.5.0 Hook Verification Queries
-- Score: NAILED (13/13 emulator-backed checks passed)
-- Generated: 2026-05-08
-- ============================================================
--
-- v1.5.0 changes:
-- - isStrictEvent: false on photo uploaded, swipe right, match received,
--   message sent, phone number exchanged, date scheduled, premium upgrade,
--   app opened (8 events read by hooks outside funnel context).
-- - reentry: true on Match Flow + Date Funnel (recurring per-user behavior).
-- - HOOK 1 split: cloning runs at top of everything (sweet 2-5 cohort);
--   over-6 score reduction moved to bottom so it ALSO drops match_score
--   on matches injected by HOOK 4 premium boost.
-- - Identity-aware (avgDevicePerUser=2, hasAnonIds=true) — verifier passes
--   profiles to all emulator checks.
--
-- Output is sharded; queries use glob:
--   data/verify-dating-EVENTS-part-*.json
--   data/verify-dating-USERS-part-*.json
-- ============================================================


-- Hook 1: PHOTO MAGIC NUMBER — sweet 2-5 cohort
-- Pattern: bespoke (DuckDB) — behavioral cohort by photo count
-- Expected: sweet (2-5 photos) avg ~2-3x more matches than lower (0-1 photos)
-- Mixpanel: Insights → match received, Total per user, cohort filter on photo uploaded count
WITH user_photos AS (
  SELECT user_id, COUNT(*) FILTER (WHERE event = 'photo uploaded') AS pc
  FROM read_json_auto('data/verify-dating-EVENTS-part-*.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
),
user_matches AS (
  SELECT user_id, COUNT(*) AS mc
  FROM read_json_auto('data/verify-dating-EVENTS-part-*.json', sample_size=-1, union_by_name=true)
  WHERE event = 'match received'
  GROUP BY user_id
)
SELECT
  CASE WHEN pc BETWEEN 2 AND 5 THEN 'sweet' WHEN pc <= 1 THEN 'lower' ELSE 'over' END AS bucket,
  COUNT(*) AS users, ROUND(AVG(COALESCE(mc, 0)), 2) AS avg_matches
FROM user_photos LEFT JOIN user_matches USING (user_id)
GROUP BY 1 ORDER BY 1;


-- Hook 1b: PHOTO MAGIC NUMBER — over-6 score reduction
-- Pattern: bespoke (DuckDB) — score breakdown by photo cohort
-- Expected: 6+ photo users' match_score ~0.65x baseline (over avg ~50, sweet avg ~75)
-- Mixpanel: Insights → match received, Avg of match_score, cohort filter on photo count
WITH user_photos AS (
  SELECT user_id, COUNT(*) FILTER (WHERE event = 'photo uploaded') AS pc
  FROM read_json_auto('data/verify-dating-EVENTS-part-*.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
),
matches AS (
  SELECT e.user_id, e.match_score
  FROM read_json_auto('data/verify-dating-EVENTS-part-*.json', sample_size=-1, union_by_name=true) e
  WHERE e.event = 'match received' AND e.match_score IS NOT NULL
)
SELECT
  CASE WHEN p.pc >= 6 THEN 'over' WHEN p.pc BETWEEN 2 AND 5 THEN 'sweet' ELSE 'low' END AS bucket,
  COUNT(*) AS n, ROUND(AVG(m.match_score), 1) AS avg_score
FROM matches m JOIN user_photos p USING (user_id)
GROUP BY 1 ORDER BY 1;


-- Hook 2: WEEKEND SWIPE SURGE
-- Pattern: bespoke (DuckDB) — DOW breakdown
-- Expected: Sunday (DOW 0) ~1.5-2x other days
-- Mixpanel: Insights → swipe right, Total, breakdown by day of week
SELECT EXTRACT(DOW FROM time::TIMESTAMP) AS dow, COUNT(*) AS swipes
FROM read_json_auto('data/verify-dating-EVENTS-part-*.json', sample_size=-1, union_by_name=true)
WHERE event = 'swipe right'
GROUP BY dow ORDER BY dow;


-- Hook 3: SUPER-LIKE EFFECT — match-near-swipe rate by is_super_like
-- Pattern: bespoke (DuckDB) — within-window event correlation
-- Expected: super-like swipes followed by ~3 matches in 2h vs ~0.2 for regular swipes
-- Mixpanel: Funnels → swipe right (filter is_super_like=true) → match received vs same with =false
WITH swipes AS (
  SELECT user_id, time::TIMESTAMP AS swipe_time, is_super_like
  FROM read_json_auto('data/verify-dating-EVENTS-part-*.json', sample_size=-1, union_by_name=true)
  WHERE event = 'swipe right'
),
matches AS (
  SELECT user_id, time::TIMESTAMP AS match_time
  FROM read_json_auto('data/verify-dating-EVENTS-part-*.json', sample_size=-1, union_by_name=true)
  WHERE event = 'match received'
)
SELECT s.is_super_like,
  COUNT(DISTINCT (s.user_id, s.swipe_time)) AS swipes,
  COUNT(*) FILTER (WHERE m.match_time > s.swipe_time AND m.match_time < s.swipe_time + INTERVAL '2 hours') AS matches_within_2h,
  ROUND(COUNT(*) FILTER (WHERE m.match_time > s.swipe_time AND m.match_time < s.swipe_time + INTERVAL '2 hours') * 1.0 /
        COUNT(DISTINCT (s.user_id, s.swipe_time)), 2) AS matches_per_swipe
FROM swipes s LEFT JOIN matches m ON s.user_id = m.user_id
GROUP BY s.is_super_like ORDER BY s.is_super_like;


-- Hook 4: PREMIUM MATCH BOOST
-- Pattern: aggregatePerUser-style — total per user, breakdown by subscription tier
-- Expected: Premium ~2x Free, Elite ~4x Free
-- Mixpanel: Insights → match received, Total per user, breakdown by subscription user prop
WITH user_matches AS (
  SELECT user_id, COUNT(*) AS mc
  FROM read_json_auto('data/verify-dating-EVENTS-part-*.json', sample_size=-1, union_by_name=true)
  WHERE event = 'match received'
  GROUP BY user_id
),
users AS (SELECT distinct_id AS user_id, subscription FROM read_json_auto('data/verify-dating-USERS-part-*.json', sample_size=-1, union_by_name=true))
SELECT u.subscription, COUNT(*) AS users, ROUND(AVG(COALESCE(m.mc, 0)), 2) AS avg_matches
FROM users u LEFT JOIN user_matches m USING (user_id)
GROUP BY u.subscription ORDER BY avg_matches DESC;


-- Hook 5: GHOSTING CHURN
-- Pattern: bespoke (DuckDB) — match-then-message-within-48h cohort
-- Expected: ghost cohort (no msg within 48h) post-match events ~0.5x of timely cohort
-- Mixpanel: Retention → match received → any active event, breakdown by behavioral cohort
WITH first_match AS (
  SELECT user_id, MIN(time::TIMESTAMP) AS m0
  FROM read_json_auto('data/verify-dating-EVENTS-part-*.json', sample_size=-1, union_by_name=true)
  WHERE event = 'match received'
  GROUP BY user_id
),
timely_users AS (
  SELECT DISTINCT m.user_id
  FROM first_match m
  JOIN read_json_auto('data/verify-dating-EVENTS-part-*.json', sample_size=-1, union_by_name=true) e
    ON e.user_id = m.user_id
  WHERE e.event = 'message sent' AND e.time::TIMESTAMP > m.m0
    AND e.time::TIMESTAMP < m.m0 + INTERVAL '48 hours'
),
post_match_count AS (
  SELECT e.user_id, COUNT(*) AS post_n
  FROM first_match m
  JOIN read_json_auto('data/verify-dating-EVENTS-part-*.json', sample_size=-1, union_by_name=true) e USING (user_id)
  WHERE e.time::TIMESTAMP > m.m0
  GROUP BY e.user_id
)
SELECT
  CASE WHEN p.user_id IN (SELECT user_id FROM timely_users) THEN 'timely' ELSE 'ghost' END AS bucket,
  COUNT(*) AS users, ROUND(AVG(p.post_n), 1) AS avg_post_match_events
FROM post_match_count p GROUP BY 1 ORDER BY 1;


-- Hook 6: BIO + PROMPT POWER USERS
-- Pattern: bespoke (DuckDB) — compound behavioral cohort
-- Expected: users with bio_updated AND >=3 prompt_answered have ~3x+ date_scheduled
-- Mixpanel: Insights → date scheduled, Total per user, cohort filter
WITH user_signals AS (
  SELECT user_id,
    BOOL_OR(event = 'bio updated') AS has_bio,
    COUNT(*) FILTER (WHERE event = 'prompt answered') AS prompt_n,
    COUNT(*) FILTER (WHERE event = 'date scheduled') AS date_n
  FROM read_json_auto('data/verify-dating-EVENTS-part-*.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
)
SELECT
  CASE WHEN has_bio AND prompt_n >= 3 THEN 'power' ELSE 'rest' END AS bucket,
  COUNT(*) AS users, ROUND(AVG(date_n), 2) AS avg_dates
FROM user_signals GROUP BY 1 ORDER BY 1 DESC;


-- Hook 7: VALENTINE'S DAY SPIKE
-- Pattern: time-bucketed (timeBucket='day') — daily signup volume
-- Expected: days 58-63 (V-Day window) avg ~1.5-3x baseline daily signup volume
-- Mixpanel: Insights → profile created, Total, line by day
SELECT DATE_TRUNC('day', time::TIMESTAMP) AS day, COUNT(*) AS signups
FROM read_json_auto('data/verify-dating-EVENTS-part-*.json', sample_size=-1, union_by_name=true)
WHERE event = 'profile created'
GROUP BY day ORDER BY day;


-- Hook 8: OFF-APP RETENTION
-- Pattern: bespoke (DuckDB) — milestone cohort × post-day-30 event volume
-- Expected: milestone users avg ~10x+ more post-d30 events than non-milestone
-- Mixpanel: Retention → first activity, breakdown by milestone cohort
WITH user_first AS (
  SELECT user_id, MIN(time::TIMESTAMP) AS t0
  FROM read_json_auto('data/verify-dating-EVENTS-part-*.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
),
milestones AS (
  SELECT DISTINCT e.user_id
  FROM user_first u
  JOIN read_json_auto('data/verify-dating-EVENTS-part-*.json', sample_size=-1, union_by_name=true) e USING (user_id)
  WHERE e.event IN ('phone number exchanged', 'date scheduled')
    AND e.time::TIMESTAMP < u.t0 + INTERVAL '14 days'
),
post_d30 AS (
  SELECT e.user_id, COUNT(*) AS n
  FROM user_first u
  JOIN read_json_auto('data/verify-dating-EVENTS-part-*.json', sample_size=-1, union_by_name=true) e USING (user_id)
  WHERE e.time::TIMESTAMP > u.t0 + INTERVAL '30 days'
  GROUP BY e.user_id
)
SELECT
  CASE WHEN u.user_id IN (SELECT user_id FROM milestones) THEN 'milestone' ELSE 'non' END AS bucket,
  COUNT(*) AS users, ROUND(AVG(COALESCE(p.n, 0)), 1) AS avg_post_d30
FROM user_first u LEFT JOIN post_d30 p USING (user_id)
GROUP BY 1 ORDER BY 1;


-- Hook 9: MATCH FLOW T2C BY TIER (KNOWN MEASUREMENT GAP)
-- Pattern: timeToConvert with breakdownByUserProperty
-- Note: funnel-post adjusts gaps WITHIN funnel-instance only. Greedy single-pass
-- evaluator picks first matching events across full event history (usually
-- organic events outside the funnel-post instance), so cross-event TTC by tier
-- shows minimal difference even though Mixpanel funnel TTC will reflect it.
-- This is documented as a measurement limitation in the dungeon header. SQL
-- below is illustrative only — the actual lift is visible only in Mixpanel funnel
-- median TTC (which restricts to funnel-instance events).
WITH per_user AS (
  SELECT e.user_id,
    MIN(time) FILTER (WHERE event = 'swipe right') AS t_swipe,
    MIN(time) FILTER (WHERE event = 'message sent') AS t_msg
  FROM read_json_auto('data/verify-dating-EVENTS-part-*.json', sample_size=-1, union_by_name=true) e
  GROUP BY e.user_id
),
users AS (SELECT distinct_id AS user_id, subscription FROM read_json_auto('data/verify-dating-USERS-part-*.json', sample_size=-1, union_by_name=true))
SELECT u.subscription,
  COUNT(*) FILTER (WHERE t_msg > t_swipe) AS converters,
  ROUND(MEDIAN(EXTRACT(EPOCH FROM (t_msg::TIMESTAMP - t_swipe::TIMESTAMP)) / 60), 1) AS median_ttc_min
FROM per_user p JOIN users u USING (user_id)
WHERE t_swipe IS NOT NULL AND t_msg > t_swipe
GROUP BY u.subscription ORDER BY median_ttc_min;


-- Hook 10: AGE RANGE AFFECTS DATE CONVERSION (funnel-pre)
-- Pattern: funnelFrequency-style breakdown by user property
-- Expected: 25-29 / 30-34 ~1.3x baseline date conversion; 40+ ~0.6x
-- Mixpanel: Funnels → message sent → phone number exchanged → date scheduled, breakdown by age_range
WITH per_user AS (
  SELECT e.user_id,
    MIN(time) FILTER (WHERE event = 'message sent') AS t_msg,
    MIN(time) FILTER (WHERE event = 'phone number exchanged') AS t_phone,
    MIN(time) FILTER (WHERE event = 'date scheduled') AS t_date
  FROM read_json_auto('data/verify-dating-EVENTS-part-*.json', sample_size=-1, union_by_name=true) e
  GROUP BY e.user_id
),
users AS (SELECT distinct_id AS user_id, age_range FROM read_json_auto('data/verify-dating-USERS-part-*.json', sample_size=-1, union_by_name=true))
SELECT u.age_range,
  COUNT(*) AS users,
  COUNT(*) FILTER (WHERE t_date > t_phone AND t_phone > t_msg) AS conversions,
  ROUND(COUNT(*) FILTER (WHERE t_date > t_phone AND t_phone > t_msg) * 100.0 / COUNT(*), 2) AS pct
FROM per_user p JOIN users u USING (user_id)
WHERE t_msg IS NOT NULL
GROUP BY u.age_range ORDER BY pct DESC;
