-- Brightpath Academy (education vertical) — story-keyed and eval-keyed DuckDB queries.
--
-- Generate first (repo root):
--   node scripts/verify-runner.mjs dungeons/vertical/education/education.js verify-education
-- Run:
--   duckdb -c ".read dungeons/vertical/education/education.sql"
-- Against a gzipped export:
--   duckdb -c "SET VARIABLE data_prefix='<dir>/education'" -c ".read education.sql"
--
-- All times are UTC. Window: 2026-06-04 00:00 to 2026-10-01 23:59:59.

SET VARIABLE data_prefix = COALESCE(getvariable('data_prefix'), 'data/verify-education');

-- ─────────────────────────────────────────────────────────────────────────
-- PRELUDE: raw files, identity resolution, warehouse tables
-- ─────────────────────────────────────────────────────────────────────────
-- Identity: new learners sign up with "account created" (the auth event,
-- which carries user_id and device_id). A device resolves to the user seen
-- with it on any event that carries both ids, the way Mixpanel stitches.
-- Every event in this dataset already carries user_id.

CREATE OR REPLACE TEMP TABLE raw_events AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-EVENTS*.json*', sample_size=-1, union_by_name=true);

CREATE OR REPLACE TEMP TABLE users AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-USERS*.json*', sample_size=-1, union_by_name=true);

CREATE OR REPLACE TEMP TABLE device_map AS
SELECT device_id, min(user_id::VARCHAR) AS mapped
FROM raw_events WHERE user_id IS NOT NULL AND device_id IS NOT NULL GROUP BY 1;

CREATE OR REPLACE TEMP TABLE ev AS
SELECT coalesce(e.user_id::VARCHAR, m.mapped) AS uid, e.time::TIMESTAMP AS t, e.*
FROM raw_events e LEFT JOIN device_map m ON e.device_id = m.device_id;

CREATE OR REPLACE TEMP TABLE wh_marketing AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-paid_marketing_daily.json*', sample_size=-1, union_by_name=true);
CREATE OR REPLACE TEMP TABLE wh_stability AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-app_stability_daily.json*', sample_size=-1, union_by_name=true);
CREATE OR REPLACE TEMP TABLE wh_billing AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-subscription_billing_daily.json*', sample_size=-1, union_by_name=true);

-- profile attributes keyed by the resolved user id
CREATE OR REPLACE TEMP TABLE prof AS
SELECT distinct_id::VARCHAR AS uid, learner_segment, account_type, acquisition_channel, plan_tier AS current_plan,
 preferred_playback_speed, customer_since, "Experiment: Personalized Course Picks" AS variant
FROM users;

-- new-learner signups (one per learner who joined in the window)
CREATE OR REPLACE TEMP TABLE signups AS
SELECT uid, t AS t0, acquisition_channel AS ch, account_type, signup_method FROM ev WHERE event = 'account created';

-- one row per enrollment, matched to a certificate for the same course
CREATE OR REPLACE TEMP TABLE enrollments AS
SELECT e.uid, e.course_id, e.course_format, e.course_category, e.course_length_weeks, e.t AS t_enroll, c.t_cert
FROM (SELECT * FROM ev WHERE event = 'course enrolled') e
LEFT JOIN (SELECT uid, course_id, min(t) AS t_cert FROM ev WHERE event = 'certificate earned' GROUP BY 1, 2) c
  ON c.uid = e.uid AND c.course_id = e.course_id AND c.t_cert > e.t;

-- one row per lesson start, matched to its completion on lesson_id
CREATE OR REPLACE TEMP TABLE lessons AS
SELECT s.uid, s.lesson_id, s.t AS t_start, s.platform, s.content_type, c.t_done
FROM (SELECT * FROM ev WHERE event = 'lesson started') s
LEFT JOIN (SELECT lesson_id, min(t) AS t_done FROM ev WHERE event = 'lesson completed' GROUP BY 1) c ON c.lesson_id = s.lesson_id;

-- first tutor question per learner
CREATE OR REPLACE TEMP TABLE tutor_first AS
SELECT uid, min(t) AS t1 FROM ev WHERE event = 'ai tutor question asked' GROUP BY 1;

-- dataset overview
SELECT count(*) AS events, count(DISTINCT uid) AS learners_with_events, (SELECT count(*) FROM users) AS profiles,
 (SELECT count(*) FROM signups) AS new_signups, min(t) AS first_event, max(t) AS last_event FROM ev;

-- ─────────────────────────────────────────────────────────────────────────
-- STORIES
-- ─────────────────────────────────────────────────────────────────────────

-- STORY H1-ask-bright-ai-tutor — quiz scores before/after a learner's first tutor question,
-- adopters vs eligible (Plus/Teams) non-adopters before/after the 2026-07-21 launch
WITH q AS (SELECT ev.uid, ev.t, ev.score_pct, ev.plan_tier, f.t1 FROM ev LEFT JOIN tutor_first f ON f.uid = ev.uid WHERE ev.event = 'quiz submitted'),
g AS (SELECT CASE WHEN t1 IS NULL THEN 'non_adopter' ELSE 'adopter' END AS grp,
  CASE WHEN t1 IS NULL THEN t >= TIMESTAMP '2026-07-21' ELSE t > t1 END AS post,
  count(*) AS quizzes, count(DISTINCT uid) AS learners, avg(score_pct) AS avg_score
  FROM q WHERE t1 IS NOT NULL OR plan_tier IN ('plus', 'teams') GROUP BY 1, 2)
SELECT *, (SELECT (max(avg_score) FILTER (WHERE grp = 'adopter' AND post) - max(avg_score) FILTER (WHERE grp = 'adopter' AND NOT post))
  - (max(avg_score) FILTER (WHERE grp = 'non_adopter' AND post) - max(avg_score) FILTER (WHERE grp = 'non_adopter' AND NOT post)) FROM g) AS did
FROM g ORDER BY grp, post;
-- purity: no tutor question before launch or on a Free plan
SELECT count(*) FILTER (WHERE t < TIMESTAMP '2026-07-21' OR plan_tier NOT IN ('plus', 'teams')) AS impure_rows, count(*) AS tutor_questions
FROM ev WHERE event = 'ai tutor question asked';

-- STORY H2-personalized-course-picks-experiment — per-view conversion (hold course_id, 1-day window)
WITH pv AS (SELECT uid, course_id, t AS t0 FROM ev WHERE event = 'course page viewed' AND t >= TIMESTAMP '2026-07-08'),
en AS (SELECT uid, course_id, t AS t1 FROM ev WHERE event = 'course enrolled'),
x AS (SELECT p.variant, pv.uid, pv.t0, min(en.t1) AS t1 FROM pv JOIN prof p ON p.uid = pv.uid AND p.variant IS NOT NULL
  LEFT JOIN en ON en.uid = pv.uid AND en.course_id = pv.course_id AND en.t1 >= pv.t0 AND en.t1 < pv.t0 + INTERVAL 1 DAY GROUP BY 1, 2, 3)
SELECT variant, count(DISTINCT uid) AS learners, count(*) AS page_views, round(avg((t1 IS NOT NULL)::INT), 4) AS conversion,
 round(median(date_diff('second', t0, t1)) / 60, 1) AS median_minutes_to_enroll
FROM x GROUP BY 1 ORDER BY 1;

-- STORY H3-sponsored-onboarding — onboarding funnel within 7 days, by account type
WITH f AS (SELECT s.uid, s.account_type, s.t0,
  (SELECT min(t) FROM ev e WHERE e.uid = s.uid AND e.event = 'learning goals set' AND e.t >= s.t0 AND e.t < s.t0 + INTERVAL 7 DAY) AS t1 FROM signups s),
f2 AS (SELECT f.*, (SELECT min(t) FROM ev e WHERE e.uid = f.uid AND e.event = 'course enrolled' AND e.t >= f.t1 AND e.t < f.t0 + INTERVAL 7 DAY) AS t2 FROM f),
f3 AS (SELECT f2.*, (SELECT min(t) FROM ev e WHERE e.uid = f2.uid AND e.event = 'lesson started' AND e.t >= f2.t2 AND e.t < f2.t0 + INTERVAL 7 DAY) AS t3 FROM f2)
SELECT account_type, count(*) AS signups, round(avg((t1 IS NOT NULL)::INT), 4) AS step2, round(avg((t2 IS NOT NULL)::INT), 4) AS step3,
 round(avg((t3 IS NOT NULL)::INT), 4) AS completed, round(median(date_diff('second', t0, t3)) / 3600, 2) AS median_hours
FROM f3 GROUP BY 1 ORDER BY 1;

-- STORY H4-cohort-vs-self-paced-completion — per enrollment, enrollments before 2026-07-01
SELECT course_format, count(*) AS enrollments, count(DISTINCT uid) AS learners, round(avg((t_cert IS NOT NULL)::INT), 4) AS completion
FROM enrollments WHERE t_enroll < TIMESTAMP '2026-07-01' GROUP BY 1 ORDER BY 1;

-- CONTEXT cohort schedule — cohort groups share a Monday start and an end date; live sessions run at fixed weekly section times
WITH g AS (SELECT course_id, cohort_start_date, count(*) AS n FROM ev WHERE event = 'course enrolled' AND course_format = 'cohort' GROUP BY 1, 2)
SELECT 'enrollments_per_cohort_group' AS metric, round(median(n), 1) AS median, round(avg(n), 2) AS mean, count(*) AS cohort_groups FROM g
UNION ALL
SELECT 'certificates_per_cohort_group', median(n), round(avg(n), 2), count(*) FROM (SELECT course_id, cohort_start_date, count(*) AS n FROM ev
  WHERE event = 'certificate earned' AND course_format = 'cohort' GROUP BY 1, 2)
UNION ALL
SELECT 'attendees_per_live_session', median(n), round(avg(n), 2), count(*) FROM (SELECT course_id, date_trunc('hour', t + INTERVAL 3 MINUTE) AS h,
  count(DISTINCT uid) AS n FROM ev WHERE event = 'live session attended' GROUP BY 1, 2);

-- STORY H5-first-week-lessons — retention (learner-initiated events) on or after day 30 by first-week completed lessons
-- (new learners who started a lesson; signups at least 37 days before the window end)
-- graded read: exactly 3 vs exactly 2 first-week lessons (knob 0.85 / 0.55 = 1.545); 3+ vs fewer is context
WITH s AS (SELECT uid, t0 FROM signups WHERE t0 < TIMESTAMP '2026-10-01 23:59:59' - INTERVAL 37 DAY
  AND uid IN (SELECT uid FROM ev WHERE event = 'lesson started')),
f AS (SELECT s.uid, count(*) FILTER (WHERE e.event = 'lesson completed' AND e.t < s.t0 + INTERVAL 7 DAY) AS first_week,
  count(*) FILTER (WHERE e.t >= s.t0 + INTERVAL 30 DAY AND e.event NOT IN ('certificate earned', 'subscription started')) AS ret_unbounded,
  count(*) FILTER (WHERE e.t >= s.t0 + INTERVAL 30 DAY AND e.t < s.t0 + INTERVAL 37 DAY AND e.event NOT IN ('certificate earned', 'subscription started')) AS ret_d30_week
  FROM s JOIN ev e ON e.uid = s.uid GROUP BY 1),
g AS (SELECT 'exactly_' || first_week AS first_week_lessons, count(*) AS learners, avg((ret_unbounded > 0)::INT) AS r,
  avg((ret_d30_week > 0)::INT) AS r_week FROM f WHERE first_week IN (2, 3) GROUP BY 1
  UNION ALL SELECT CASE WHEN first_week >= 3 THEN 'context_3_plus' ELSE 'context_0_2' END, count(*), avg((ret_unbounded > 0)::INT),
  avg((ret_d30_week > 0)::INT) FROM f GROUP BY 1)
SELECT first_week_lessons, learners, round(r, 4) AS retained_day30_or_later, round(r_week, 4) AS retained_day30_36,
 round((SELECT max(r) FILTER (WHERE first_week_lessons = 'exactly_3') / max(r) FILTER (WHERE first_week_lessons = 'exactly_2') FROM g), 3) AS ratio_3_over_2,
 round((SELECT max(r) FILTER (WHERE first_week_lessons = 'context_3_plus') / max(r) FILTER (WHERE first_week_lessons = 'context_0_2') FROM g), 3) AS ratio_3plus_over_0_2
FROM g ORDER BY 1;

-- STORY H6-plus-price-change — annual share of new Plus subscriptions, first payment (warehouse list price), volume 53 days either side
WITH s AS (SELECT ev.uid, ev.t, ev.billing_interval, b.list_price_usd FROM ev
  JOIN wh_billing b ON b.date::DATE = ev.t::DATE AND b.billing_interval = ev.billing_interval WHERE ev.event = 'subscription started')
SELECT CASE WHEN t >= TIMESTAMP '2026-08-10' THEN 'after' ELSE 'before' END AS period, count(*) AS subscriptions,
 round(avg((billing_interval = 'annual')::INT), 4) AS annual_share, round(avg(list_price_usd), 2) AS avg_first_payment_usd
FROM s GROUP BY 1 ORDER BY 1 DESC;
SELECT CASE WHEN t >= TIMESTAMP '2026-08-10' THEN 'after' ELSE 'before' END AS period, round(count(*) / 53.0, 2) AS subscriptions_per_day
FROM ev WHERE event = 'subscription started' AND t >= TIMESTAMP '2026-06-18' GROUP BY 1 ORDER BY 1 DESC;

-- STORY H7-paid-channel-economics — spend per signup (warehouse) and 30-day paid conversion (signups through Aug 31)
WITH sg AS (SELECT ch, count(*) AS signups FROM signups GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM wh_marketing GROUP BY 1),
c AS (SELECT s.ch, count(*) AS cohort, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM ev e WHERE e.uid = s.uid AND e.event = 'subscription started'
  AND e.t >= s.t0 AND e.t < s.t0 + INTERVAL 30 DAY)) AS buyers FROM signups s WHERE s.t0 < TIMESTAMP '2026-09-01' GROUP BY 1)
SELECT sg.ch, sg.signups, round(sp.spend, 0) AS spend_usd, round(sp.spend / sg.signups, 2) AS spend_per_signup,
 c.cohort, c.buyers, round(c.buyers / c.cohort, 4) AS paid_rate_30d
FROM sg LEFT JOIN sp ON sp.ch = sg.ch LEFT JOIN c ON c.ch = sg.ch ORDER BY 1;

-- STORY H8-android-playback-incident — video completion per start by platform, incident days vs 7 days either side
WITH w AS (SELECT platform = 'android' AS android, (t_done IS NOT NULL)::INT AS ok,
  (t_start >= TIMESTAMP '2026-09-09' AND t_start < TIMESTAMP '2026-09-13') AS incident
  FROM lessons WHERE content_type = 'video' AND platform IS NOT NULL AND t_start >= TIMESTAMP '2026-09-02' AND t_start < TIMESTAMP '2026-09-20')
SELECT incident, android, count(*) AS video_starts, round(avg(ok), 4) AS completion FROM w GROUP BY 1, 2 ORDER BY 1, 2;
SELECT date, platform, video_starts, playback_failure_rate, crash_free_session_rate, app_version FROM wh_stability
WHERE date::DATE BETWEEN DATE '2026-09-07' AND DATE '2026-09-14' AND platform = 'android' ORDER BY date;

-- STORY H9-fall-term-students — lesson completions per day, students vs other segments, summer vs fall term
-- full-rate days only: summer = before Aug 17, fall = from Sep 8 (term starts are staggered Aug 17 - Sep 7)
WITH x AS (SELECT CASE WHEN p.learner_segment = 'university_student' THEN 'student' ELSE 'other' END AS seg, ev.t >= TIMESTAMP '2026-09-08' AS fall, ev.t::DATE AS d
  FROM ev JOIN prof p ON p.uid = ev.uid WHERE ev.event = 'lesson completed'
  AND (ev.t < TIMESTAMP '2026-08-17' OR ev.t >= TIMESTAMP '2026-09-08')),
g AS (SELECT seg, fall, count(*) / count(DISTINCT d) AS per_day FROM x GROUP BY 1, 2)
SELECT seg, round(max(per_day) FILTER (WHERE NOT fall), 1) AS summer_per_day, round(max(per_day) FILTER (WHERE fall), 1) AS fall_per_day,
 round(max(per_day) FILTER (WHERE fall) / max(per_day) FILTER (WHERE NOT fall), 3) AS fall_over_summer
FROM g GROUP BY 1 ORDER BY 1;

-- STORY H10-double-speed-quiz-scores — quiz score by preferred playback speed
SELECT p.preferred_playback_speed, count(DISTINCT ev.uid) AS learners, count(*) AS quizzes, round(avg(score_pct), 2) AS avg_score,
 round(avg(passed::INT), 4) AS pass_rate
FROM ev JOIN prof p ON p.uid = ev.uid WHERE ev.event = 'quiz submitted' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL QUESTIONS (numbers cited in eval/education.eval.md)
-- ─────────────────────────────────────────────────────────────────────────

-- EVAL Q1 — Does Ask Bright improve quiz scores?
-- (a) adopters before vs after their first question; eligible non-adopters before vs after launch (difference in differences)
WITH q AS (SELECT ev.uid, ev.t, ev.score_pct, ev.passed, ev.plan_tier, f.t1 FROM ev LEFT JOIN tutor_first f ON f.uid = ev.uid WHERE ev.event = 'quiz submitted')
SELECT CASE WHEN t1 IS NULL THEN 'non_adopter_plus_teams' ELSE 'adopter' END AS grp,
 CASE WHEN t1 IS NULL THEN t >= TIMESTAMP '2026-07-21' ELSE t > t1 END AS post,
 count(*) AS quizzes, round(avg(score_pct), 2) AS avg_score, round(avg(passed::INT), 4) AS pass_rate
FROM q WHERE t1 IS NOT NULL OR plan_tier IN ('plus', 'teams') GROUP BY 1, 2 ORDER BY 1, 2;
-- (b) naive post-launch comparison on eligible plans: adopters vs non-adopters
WITH q AS (SELECT ev.uid, ev.score_pct, f.t1 FROM ev LEFT JOIN tutor_first f ON f.uid = ev.uid
  WHERE ev.event = 'quiz submitted' AND ev.t >= TIMESTAMP '2026-07-21' AND ev.plan_tier IN ('plus', 'teams'))
SELECT (t1 IS NOT NULL) AS adopter, count(*) AS quizzes, round(avg(score_pct), 2) AS avg_score FROM q GROUP BY 1 ORDER BY 1;
-- (c) the Insights recipe: weekly average score, report filter plan_tier in (plus, teams), breakdown cohort "did ai tutor question asked"
SELECT date_trunc('week', ev.t)::DATE AS week, round(avg(score_pct) FILTER (WHERE f.uid IS NOT NULL), 1) AS adopters,
 round(avg(score_pct) FILTER (WHERE f.uid IS NULL), 1) AS eligible_non_adopters
FROM ev LEFT JOIN tutor_first f ON f.uid = ev.uid WHERE ev.event = 'quiz submitted' AND ev.plan_tier IN ('plus', 'teams') GROUP BY 1 ORDER BY 1;

-- EVAL Q2 — Ask Bright adoption and its trend
-- eligible learners = any event on a Plus or Teams plan since launch; adopters = at least one tutor question
SELECT (SELECT count(DISTINCT uid) FROM ev WHERE t >= TIMESTAMP '2026-07-21' AND plan_tier IN ('plus', 'teams')) AS eligible_learners,
 (SELECT count(*) FROM tutor_first) AS adopters,
 round((SELECT count(*) FROM tutor_first) / (SELECT count(DISTINCT uid) FROM ev WHERE t >= TIMESTAMP '2026-07-21' AND plan_tier IN ('plus', 'teams')), 4) AS adoption,
 (SELECT count(*) FROM ev WHERE event = 'ai tutor question asked') AS questions,
 round((SELECT count(*) FROM ev WHERE event = 'ai tutor question asked') / (SELECT count(*) FROM tutor_first), 2) AS questions_per_adopter;
-- weekly questions, askers, and first-time askers (Monday weeks)
SELECT date_trunc('week', ev.t)::DATE AS week, count(*) AS questions, count(DISTINCT ev.uid) AS askers,
 count(DISTINCT ev.uid) FILTER (WHERE date_trunc('week', f.t1) = date_trunc('week', ev.t)) AS new_askers
FROM ev JOIN tutor_first f ON f.uid = ev.uid WHERE ev.event = 'ai tutor question asked' GROUP BY 1 ORDER BY 1;

-- EVAL Q3 — Personalized Course Picks experiment
WITH pv AS (SELECT uid, course_id, t AS t0 FROM ev WHERE event = 'course page viewed' AND t >= TIMESTAMP '2026-07-08'),
en AS (SELECT uid, course_id, t AS t1 FROM ev WHERE event = 'course enrolled'),
x AS (SELECT p.variant, pv.uid, pv.t0, min(en.t1) AS t1 FROM pv JOIN prof p ON p.uid = pv.uid AND p.variant IS NOT NULL
  LEFT JOIN en ON en.uid = pv.uid AND en.course_id = pv.course_id AND en.t1 >= pv.t0 AND en.t1 < pv.t0 + INTERVAL 1 DAY GROUP BY 1, 2, 3)
SELECT variant, count(DISTINCT uid) AS learners, count(*) AS page_views, count(t1) AS enrollments_from_views,
 round(avg((t1 IS NOT NULL)::INT), 4) AS conversion, round(median(date_diff('second', t0, t1)) / 60, 1) AS median_minutes
FROM x GROUP BY 1 ORDER BY 1;
-- enrollments per exposed learner after exposure
WITH x AS (SELECT e.uid, min(e.t) AS t_exp FROM ev e WHERE e.event = '$experiment_started' GROUP BY 1)
SELECT p.variant, count(DISTINCT x.uid) AS learners, round(count(en.uid) / count(DISTINCT x.uid), 3) AS enrollments_per_learner
FROM x JOIN prof p ON p.uid = x.uid LEFT JOIN ev en ON en.uid = x.uid AND en.event = 'course enrolled' AND en.t >= x.t_exp
GROUP BY 1 ORDER BY 1;

-- EVAL Q4 — Onboarding completion by account type (7-day window)
WITH f AS (SELECT s.uid, s.account_type, s.t0,
  (SELECT min(t) FROM ev e WHERE e.uid = s.uid AND e.event = 'learning goals set' AND e.t >= s.t0 AND e.t < s.t0 + INTERVAL 7 DAY) AS t1 FROM signups s),
f2 AS (SELECT f.*, (SELECT min(t) FROM ev e WHERE e.uid = f.uid AND e.event = 'course enrolled' AND e.t >= f.t1 AND e.t < f.t0 + INTERVAL 7 DAY) AS t2 FROM f),
f3 AS (SELECT f2.*, (SELECT min(t) FROM ev e WHERE e.uid = f2.uid AND e.event = 'lesson started' AND e.t >= f2.t2 AND e.t < f2.t0 + INTERVAL 7 DAY) AS t3 FROM f2)
SELECT coalesce(account_type, 'all') AS account_type, count(*) AS signups, round(avg((t1 IS NOT NULL)::INT), 4) AS reached_goals,
 round(avg((t2 IS NOT NULL)::INT), 4) AS reached_enroll, round(avg((t3 IS NOT NULL)::INT), 4) AS completed
FROM f3 GROUP BY ROLLUP (account_type) ORDER BY 1;

-- EVAL Q5 — Time from signup to first lesson (completed onboarding funnels, 7-day window)
WITH f AS (SELECT s.uid, s.account_type, s.t0,
  (SELECT min(t) FROM ev e WHERE e.uid = s.uid AND e.event = 'learning goals set' AND e.t >= s.t0 AND e.t < s.t0 + INTERVAL 7 DAY) AS t1 FROM signups s),
f2 AS (SELECT f.*, (SELECT min(t) FROM ev e WHERE e.uid = f.uid AND e.event = 'course enrolled' AND e.t >= f.t1 AND e.t < f.t0 + INTERVAL 7 DAY) AS t2 FROM f),
f3 AS (SELECT f2.*, (SELECT min(t) FROM ev e WHERE e.uid = f2.uid AND e.event = 'lesson started' AND e.t >= f2.t2 AND e.t < f2.t0 + INTERVAL 7 DAY) AS t3 FROM f2)
SELECT coalesce(account_type, 'all') AS account_type, count(t3) AS completed, round(median(date_diff('second', t0, t3)) / 3600, 1) AS median_hours,
 round(avg(date_diff('second', t0, t3)) / 3600, 1) AS avg_hours
FROM f3 WHERE t3 IS NOT NULL GROUP BY ROLLUP (account_type) ORDER BY 1;

-- EVAL Q6 — Course completion by format (per enrollment, enrollments Jun 4 - Jun 30)
SELECT coalesce(course_format, 'all') AS course_format, count(*) AS enrollments, count(t_cert) AS certificates,
 round(avg((t_cert IS NOT NULL)::INT), 4) AS completion, round(median(date_diff('day', t_enroll, t_cert)), 1) AS median_days_to_certificate
FROM enrollments WHERE t_enroll < TIMESTAMP '2026-07-01' GROUP BY ROLLUP (course_format) ORDER BY 1;

-- EVAL Q7 — First-week lessons and retention (new learners who started a lesson, signups through Aug 25)
WITH s AS (SELECT uid, t0 FROM signups WHERE t0 < TIMESTAMP '2026-10-01 23:59:59' - INTERVAL 37 DAY
  AND uid IN (SELECT uid FROM ev WHERE event = 'lesson started')),
f AS (SELECT s.uid, count(*) FILTER (WHERE e.event = 'lesson completed' AND e.t < s.t0 + INTERVAL 7 DAY) AS first_week,
  count(*) FILTER (WHERE e.t >= s.t0 + INTERVAL 30 DAY AND e.event NOT IN ('certificate earned', 'subscription started')) AS ret_unbounded,
  count(*) FILTER (WHERE e.t >= s.t0 + INTERVAL 30 DAY AND e.t < s.t0 + INTERVAL 37 DAY AND e.event NOT IN ('certificate earned', 'subscription started')) AS ret_d30_week
  FROM s JOIN ev e ON e.uid = s.uid GROUP BY 1)
SELECT least(first_week, 5) AS first_week_lessons_capped_5, count(*) AS learners,
 round(avg((ret_unbounded > 0)::INT), 4) AS retained_day30_or_later, round(avg((ret_d30_week > 0)::INT), 4) AS retained_day30_36
FROM f GROUP BY 1 ORDER BY 1;
WITH s AS (SELECT uid, t0 FROM signups WHERE t0 < TIMESTAMP '2026-10-01 23:59:59' - INTERVAL 37 DAY
  AND uid IN (SELECT uid FROM ev WHERE event = 'lesson started')),
f AS (SELECT s.uid, count(*) FILTER (WHERE e.event = 'lesson completed' AND e.t < s.t0 + INTERVAL 7 DAY) AS first_week,
  count(*) FILTER (WHERE e.t >= s.t0 + INTERVAL 30 DAY AND e.event NOT IN ('certificate earned', 'subscription started')) AS ret_unbounded,
  count(*) FILTER (WHERE e.t >= s.t0 + INTERVAL 30 DAY AND e.t < s.t0 + INTERVAL 37 DAY AND e.event NOT IN ('certificate earned', 'subscription started')) AS ret_d30_week
  FROM s JOIN ev e ON e.uid = s.uid GROUP BY 1)
SELECT first_week >= 3 AS three_plus, count(*) AS learners,
 round(avg((ret_unbounded > 0)::INT), 4) AS retained_day30_or_later, round(avg((ret_d30_week > 0)::INT), 4) AS retained_day30_36
FROM f GROUP BY 1 ORDER BY 1;

-- EVAL Q8 — The August 10 Plus price change: billing mix, first payment, bookings, volume
WITH s AS (SELECT ev.uid, ev.t, ev.billing_interval, b.list_price_usd FROM ev
  JOIN wh_billing b ON b.date::DATE = ev.t::DATE AND b.billing_interval = ev.billing_interval WHERE ev.event = 'subscription started')
SELECT CASE WHEN t >= TIMESTAMP '2026-08-10' THEN 'after' ELSE 'before' END AS period, count(*) AS subscriptions,
 CASE WHEN t >= TIMESTAMP '2026-08-10' THEN 53 ELSE 67 END AS calendar_days,
 round(count(*) / CASE WHEN t >= TIMESTAMP '2026-08-10' THEN 53 ELSE 67 END, 2) AS per_day,
 round(avg((billing_interval = 'annual')::INT), 4) AS annual_share, round(avg(list_price_usd), 2) AS avg_first_payment_usd
FROM s GROUP BY 1, 3 ORDER BY 1 DESC;
-- per-day subscriptions, 53 days either side (Jun 18 - Aug 9 vs Aug 10 - Oct 1), by billing interval
SELECT CASE WHEN t >= TIMESTAMP '2026-08-10' THEN 'after' ELSE 'before' END AS period, count(*) AS subscriptions, round(count(*) / 53.0, 2) AS per_day,
 round(count(*) FILTER (WHERE billing_interval = 'monthly') / 53.0, 2) AS monthly_per_day, round(count(*) FILTER (WHERE billing_interval = 'annual') / 53.0, 2) AS annual_per_day
FROM ev WHERE event = 'subscription started' AND t >= TIMESTAMP '2026-06-18' GROUP BY 1 ORDER BY 1 DESC;
-- weekly new subscriptions (Monday weeks; the first and last weeks are partial)
SELECT date_trunc('week', t)::DATE AS week, count(*) AS subscriptions, count(*) FILTER (WHERE billing_interval = 'annual') AS annual
FROM ev WHERE event = 'subscription started' GROUP BY 1 ORDER BY 1;
-- warehouse bookings before vs after
SELECT CASE WHEN date::DATE >= DATE '2026-08-10' THEN 'after' ELSE 'before' END AS period, billing_interval,
 sum(new_subscriptions) AS billed_subscriptions, round(sum(gross_bookings_usd), 0) AS gross_bookings_usd, min(list_price_usd) AS min_price, max(list_price_usd) AS max_price
FROM wh_billing GROUP BY 1, 2 ORDER BY 1 DESC, 2;
SELECT CASE WHEN date::DATE >= DATE '2026-08-10' THEN 'after' ELSE 'before' END AS period,
 round(sum(gross_bookings_usd) / sum(new_subscriptions), 2) AS bookings_per_subscription, round(sum(gross_bookings_usd) / count(DISTINCT date), 0) AS bookings_per_day
FROM wh_billing GROUP BY 1 ORDER BY 1 DESC;

-- EVAL Q9 — Paid channel efficiency: spend per signup, 30-day paid conversion, cost per paying subscriber
WITH sg AS (SELECT ch, count(*) AS signups FROM signups GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend, sum(spend_usd) FILTER (WHERE date::DATE < DATE '2026-09-01') AS spend_to_aug FROM wh_marketing GROUP BY 1),
c AS (SELECT s.ch, count(*) AS cohort, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM ev e WHERE e.uid = s.uid AND e.event = 'subscription started'
  AND e.t >= s.t0 AND e.t < s.t0 + INTERVAL 30 DAY)) AS buyers FROM signups s WHERE s.t0 < TIMESTAMP '2026-09-01' GROUP BY 1)
SELECT sg.ch, sg.signups, round(sp.spend, 0) AS spend_usd, round(sp.spend / sg.signups, 2) AS spend_per_signup,
 c.cohort AS signups_to_aug31, c.buyers, round(c.buyers / c.cohort, 4) AS paid_rate_30d,
 round(sp.spend_to_aug / nullif(c.buyers, 0), 0) AS spend_per_paying_subscriber
FROM sg JOIN sp ON sp.ch = sg.ch LEFT JOIN c ON c.ch = sg.ch ORDER BY 1;
-- 30-day Plus conversion of all new self-pay learners (signups through Aug 31)
SELECT count(*) AS self_pay_signups_to_aug31, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM ev e WHERE e.uid = s.uid AND e.event = 'subscription started'
  AND e.t >= s.t0 AND e.t < s.t0 + INTERVAL 30 DAY)) AS buyers,
 round(count(*) FILTER (WHERE EXISTS (SELECT 1 FROM ev e WHERE e.uid = s.uid AND e.event = 'subscription started'
  AND e.t >= s.t0 AND e.t < s.t0 + INTERVAL 30 DAY)) / count(*), 4) AS paid_rate_30d
FROM signups s WHERE s.t0 < TIMESTAMP '2026-09-01' AND s.account_type = 'individual';
-- platform-reported signups vs Mixpanel signups
SELECT acquisition_channel, sum(platform_reported_signups) AS platform_reported, (SELECT count(*) FROM signups s WHERE s.ch = m.acquisition_channel) AS mixpanel_signups,
 round(sum(spend_usd) / sum(platform_reported_signups), 2) AS spend_per_platform_signup
FROM wh_marketing m GROUP BY 1 ORDER BY 1;

-- EVAL Q10 — The September dip in Android lesson completions
SELECT t_start::DATE AS day, platform, count(*) AS video_starts, round(avg((t_done IS NOT NULL)::INT), 4) AS completion
FROM lessons WHERE content_type = 'video' AND platform IS NOT NULL AND t_start >= TIMESTAMP '2026-09-06' AND t_start < TIMESTAMP '2026-09-16'
GROUP BY 1, 2 ORDER BY 1, 2;
-- the Insights recipe: lesson completed / lesson started (totals), content_type = video, breakdown platform (event property),
-- incident days vs the 7 days either side (a completion carries its start's device, so this matches the per-lesson join)
WITH x AS (SELECT platform, event, t FROM ev WHERE event IN ('lesson started', 'lesson completed') AND content_type = 'video'
  AND platform IS NOT NULL AND t >= TIMESTAMP '2026-09-02' AND t < TIMESTAMP '2026-09-20')
SELECT platform, (t >= TIMESTAMP '2026-09-09' AND t < TIMESTAMP '2026-09-13') AS incident,
 count(*) FILTER (WHERE event = 'lesson started') AS started, count(*) FILTER (WHERE event = 'lesson completed') AS completed,
 round(count(*) FILTER (WHERE event = 'lesson completed') / count(*) FILTER (WHERE event = 'lesson started'), 4) AS completed_per_started
FROM x GROUP BY 1, 2 ORDER BY 1, 2;
WITH w AS (SELECT platform, content_type, (t_done IS NOT NULL)::INT AS ok,
  (t_start >= TIMESTAMP '2026-09-09' AND t_start < TIMESTAMP '2026-09-13') AS incident
  FROM lessons WHERE platform IS NOT NULL AND t_start >= TIMESTAMP '2026-09-02' AND t_start < TIMESTAMP '2026-09-20')
SELECT platform, content_type, round(avg(ok) FILTER (WHERE NOT incident), 4) AS completion_around, round(avg(ok) FILTER (WHERE incident), 4) AS completion_incident,
 count(*) FILTER (WHERE incident) AS starts_incident
FROM w GROUP BY 1, 2 ORDER BY 1, 2;

-- EVAL Q11 — Why did learning activity jump in late August? (weekly lesson completions by segment)
SELECT date_trunc('week', ev.t)::DATE AS week, p.learner_segment, count(*) AS lesson_completions
FROM ev JOIN prof p ON p.uid = ev.uid WHERE ev.event = 'lesson completed' AND ev.t >= TIMESTAMP '2026-08-03' AND ev.t < TIMESTAMP '2026-09-21'
GROUP BY 1, 2 ORDER BY 1, 2;
-- the obvious split at Aug 24 (includes the staggered term starts on both sides)
WITH x AS (SELECT p.learner_segment AS seg, ev.t >= TIMESTAMP '2026-08-24' AS fall, ev.t::DATE AS d
  FROM ev JOIN prof p ON p.uid = ev.uid WHERE ev.event = 'lesson completed'),
g AS (SELECT seg, fall, count(*) / count(DISTINCT d) AS per_day FROM x GROUP BY 1, 2)
SELECT seg, round(max(per_day) FILTER (WHERE NOT fall), 1) AS before_per_day, round(max(per_day) FILTER (WHERE fall), 1) AS from_aug24_per_day,
 round(max(per_day) FILTER (WHERE fall) / max(per_day) FILTER (WHERE NOT fall), 3) AS ratio
FROM g GROUP BY 1 ORDER BY 1;
-- full-rate windows: before Aug 17 vs from Sep 8
WITH x AS (SELECT p.learner_segment AS seg, ev.t >= TIMESTAMP '2026-09-08' AS fall, ev.t::DATE AS d
  FROM ev JOIN prof p ON p.uid = ev.uid WHERE ev.event = 'lesson completed' AND (ev.t < TIMESTAMP '2026-08-17' OR ev.t >= TIMESTAMP '2026-09-08')),
g AS (SELECT seg, fall, count(*) / count(DISTINCT d) AS per_day FROM x GROUP BY 1, 2)
SELECT seg, round(max(per_day) FILTER (WHERE NOT fall), 1) AS before_aug17_per_day, round(max(per_day) FILTER (WHERE fall), 1) AS from_sep8_per_day,
 round(max(per_day) FILTER (WHERE fall) / max(per_day) FILTER (WHERE NOT fall), 3) AS ratio
FROM g GROUP BY 1 ORDER BY 1;

-- EVAL Q12 — Does watching at 2x hurt quiz performance?
SELECT p.preferred_playback_speed, count(DISTINCT ev.uid) AS learners, count(*) AS quizzes, round(avg(score_pct), 2) AS avg_score,
 round(avg(passed::INT), 4) AS pass_rate
FROM ev JOIN prof p ON p.uid = ev.uid WHERE ev.event = 'quiz submitted' GROUP BY 1 ORDER BY 1;
-- minutes per video lesson by speed actually played
SELECT playback_speed, count(*) AS video_completions, round(avg(minutes_spent), 2) AS avg_minutes
FROM ev WHERE event = 'lesson completed' AND content_type = 'video' GROUP BY 1 ORDER BY 1;

-- EVAL Q13 — null: do employer-sponsored learners finish more courses? (per enrollment, all enrollments and Jun 4-30)
WITH e AS (SELECT en.*, p.account_type FROM enrollments en JOIN prof p ON p.uid = en.uid)
SELECT 'all_enrollments' AS cut, account_type, count(*) AS enrollments, round(avg((t_cert IS NOT NULL)::INT), 4) AS completion FROM e GROUP BY 2
UNION ALL
SELECT 'june_' || course_format, account_type, count(*), round(avg((t_cert IS NOT NULL)::INT), 4) FROM e WHERE t_enroll < TIMESTAMP '2026-07-01' GROUP BY 1, 2
ORDER BY 1, 2;
-- two-proportion z (sponsored minus self-pay) overall and within the June format cuts
WITH e AS (SELECT en.*, p.account_type FROM enrollments en JOIN prof p ON p.uid = en.uid),
g AS (SELECT 'all_enrollments' AS cut, account_type, count(*) AS n, avg((t_cert IS NOT NULL)::INT) AS r FROM e GROUP BY 2
  UNION ALL SELECT 'june_' || course_format, account_type, count(*), avg((t_cert IS NOT NULL)::INT) FROM e WHERE t_enroll < TIMESTAMP '2026-07-01' GROUP BY 1, 2),
w AS (SELECT cut, max(n) FILTER (WHERE account_type = 'employer_sponsored') AS n1, max(r) FILTER (WHERE account_type = 'employer_sponsored') AS r1,
  max(n) FILTER (WHERE account_type = 'individual') AS n0, max(r) FILTER (WHERE account_type = 'individual') AS r0 FROM g GROUP BY 1)
SELECT cut, round(r1 - r0, 4) AS diff, round((r1 - r0) / sqrt(((r1 * n1 + r0 * n0) / (n1 + n0)) * (1 - (r1 * n1 + r0 * n0) / (n1 + n0)) * (1.0 / n1 + 1.0 / n0)), 2) AS z
FROM w ORDER BY 1;

-- EVAL Q14 — null: do learners score lower on quizzes taken in the Android app than in the iOS app?
-- quiz score by platform (event property), overall, by month, and by plan at quiz time; Welch z (Android minus iOS)
WITH q AS (SELECT platform, score_pct, passed::INT AS passed, strftime(t, '%Y-%m') AS month, plan_tier FROM ev
  WHERE event = 'quiz submitted' AND platform IN ('android', 'ios')),
c AS (SELECT 'all' AS cut, platform, score_pct, passed FROM q
  UNION ALL SELECT 'month_' || month, platform, score_pct, passed FROM q WHERE month < '2026-10'
  UNION ALL SELECT 'plan_' || plan_tier, platform, score_pct, passed FROM q),
g AS (SELECT cut, count(*) FILTER (WHERE platform = 'android') AS n1, avg(score_pct) FILTER (WHERE platform = 'android') AS m1, var_samp(score_pct) FILTER (WHERE platform = 'android') AS v1,
  avg(passed) FILTER (WHERE platform = 'android') AS p1,
  count(*) FILTER (WHERE platform = 'ios') AS n0, avg(score_pct) FILTER (WHERE platform = 'ios') AS m0, var_samp(score_pct) FILTER (WHERE platform = 'ios') AS v0,
  avg(passed) FILTER (WHERE platform = 'ios') AS p0 FROM c GROUP BY 1)
SELECT cut, n1 AS android_quizzes, round(m1, 2) AS android_score, round(p1, 4) AS android_pass, n0 AS ios_quizzes, round(m0, 2) AS ios_score, round(p0, 4) AS ios_pass,
 round((m1 - m0) / sqrt(v1 / n1 + v0 / n0), 2) AS z
FROM g ORDER BY 1;
-- secondary: lesson completion per start outside the Sep 9-12 incident (starts on Sep 9-12 excluded on both platforms), overall, by content type, and by month
WITH w AS (SELECT platform, content_type, strftime(t_start, '%Y-%m') AS month, (t_done IS NOT NULL)::INT AS ok
  FROM lessons WHERE platform IN ('android', 'ios')
  AND NOT (t_start >= TIMESTAMP '2026-09-09' AND t_start < TIMESTAMP '2026-09-13')),
c AS (SELECT 'all' AS cut, platform, ok FROM w
  UNION ALL SELECT 'content_' || content_type, platform, ok FROM w
  UNION ALL SELECT 'month_' || month, platform, ok FROM w),
g AS (SELECT cut, count(*) FILTER (WHERE platform = 'android') AS n1, avg(ok) FILTER (WHERE platform = 'android') AS r1,
  count(*) FILTER (WHERE platform = 'ios') AS n0, avg(ok) FILTER (WHERE platform = 'ios') AS r0 FROM c GROUP BY 1)
SELECT cut, n1 AS android_starts, round(r1, 4) AS android, n0 AS ios_starts, round(r0, 4) AS ios,
 round((r1 - r0) / sqrt(((r1 * n1 + r0 * n0) / (n1 + n0)) * (1 - (r1 * n1 + r0 * n0) / (n1 + n0)) * (1.0 / n1 + 1.0 / n0)), 2) AS z
FROM g ORDER BY 1;
-- warehouse: crash-free sessions by platform outside the incident days
SELECT platform, round(avg(crash_free_session_rate), 4) AS crash_free, round(avg(playback_failure_rate), 4) AS playback_failure
FROM wh_stability WHERE NOT (date::DATE BETWEEN DATE '2026-09-09' AND DATE '2026-09-12') GROUP BY 1 ORDER BY 1;

-- EVAL Q15 — Weekly active learners (any event except the backend events certificate earned and subscription started), new vs established
SELECT date_trunc('week', ev.t)::DATE AS week, count(DISTINCT ev.uid) AS active_learners,
 count(DISTINCT ev.uid) FILTER (WHERE ev.uid IN (SELECT uid FROM signups)) AS new_this_window,
 count(DISTINCT ev.uid) FILTER (WHERE ev.uid NOT IN (SELECT uid FROM signups)) AS established
FROM ev WHERE ev.event NOT IN ('certificate earned', 'subscription started') GROUP BY 1 ORDER BY 1;

-- EVAL Q16 — Enrollments and completion by course category (enrollments Jun 4-30 for completion)
SELECT course_category, count(*) AS enrollments, round(count(*) / (SELECT count(*) FROM enrollments), 4) AS share,
 round(avg((t_cert IS NOT NULL)::INT) FILTER (WHERE t_enroll < TIMESTAMP '2026-07-01'), 4) AS june_completion,
 round(avg((course_format = 'cohort')::INT), 4) AS cohort_share
FROM enrollments GROUP BY 1 ORDER BY 2 DESC;

-- EVAL Q17 — Billing vs Mixpanel: new subscriptions and bookings reconciliation
SELECT b.billing_interval, sum(b.new_subscriptions) AS billed, (SELECT count(*) FROM ev WHERE event = 'subscription started' AND ev.billing_interval = b.billing_interval) AS mixpanel,
 round(sum(b.gross_bookings_usd), 0) AS gross_bookings_usd
FROM wh_billing b GROUP BY 1 ORDER BY 1;
WITH d AS (SELECT b.date::DATE AS d, b.billing_interval, b.new_subscriptions AS billed,
  (SELECT count(*) FROM ev WHERE event = 'subscription started' AND ev.t::DATE = b.date::DATE AND ev.billing_interval = b.billing_interval) AS mixpanel FROM wh_billing b)
SELECT count(*) AS interval_days, count(*) FILTER (WHERE billed = mixpanel) AS days_equal, count(*) FILTER (WHERE billed > mixpanel) AS days_billing_higher,
 count(*) FILTER (WHERE billed < mixpanel) AS days_billing_lower, round(corr(billed, mixpanel), 3) AS corr FROM d;

-- EVAL Q18 — What did the Android playback bug cost in lesson completions?
WITH w AS (SELECT (t_done IS NOT NULL)::INT AS ok, (t_start >= TIMESTAMP '2026-09-09' AND t_start < TIMESTAMP '2026-09-13') AS incident
  FROM lessons WHERE content_type = 'video' AND platform = 'android' AND t_start >= TIMESTAMP '2026-09-02' AND t_start < TIMESTAMP '2026-09-20')
SELECT count(*) FILTER (WHERE incident) AS incident_starts, sum(ok) FILTER (WHERE incident) AS incident_completions,
 round(avg(ok) FILTER (WHERE NOT incident), 4) AS baseline_completion,
 round(count(*) FILTER (WHERE incident) * avg(ok) FILTER (WHERE NOT incident) - sum(ok) FILTER (WHERE incident), 0) AS lost_completions,
 (SELECT count(DISTINCT uid) FROM lessons WHERE content_type = 'video' AND platform = 'android' AND t_start >= TIMESTAMP '2026-09-09' AND t_start < TIMESTAMP '2026-09-13') AS android_learners_affected
FROM w;

-- EVAL Q19 — open-ended: headline numbers for "what should we worry about"
SELECT 'self_paced_completion_june' AS metric, round(avg((t_cert IS NOT NULL)::INT), 4) AS value FROM enrollments WHERE t_enroll < TIMESTAMP '2026-07-01' AND course_format = 'self_paced'
UNION ALL SELECT 'self_paced_share_of_enrollments', round(avg((course_format = 'self_paced')::INT), 4) FROM enrollments
UNION ALL SELECT 'paid_social_share_of_paid_signups', round((SELECT count(*) FROM signups WHERE ch = 'paid_social') / (SELECT count(*) FROM signups WHERE ch IN ('paid_search', 'paid_social', 'youtube_ads')), 4)
UNION ALL SELECT 'new_learners_started_lesson_share', round((SELECT count(DISTINCT s.uid) FROM signups s JOIN ev e ON e.uid = s.uid AND e.event = 'lesson started') / (SELECT count(*) FROM signups), 4);

-- EVAL Q20 — null: do learners who sign up in the mobile apps (iOS or Android) finish onboarding at a different rate than web signups?
-- full onboarding funnel within 7 days; signup platform from account created; all signups and within each account type and weekday/weekend signup day
WITH f AS (SELECT s.uid, s.account_type, s.t0, dayofweek(s.t0) IN (0, 6) AS weekend,
  (SELECT platform FROM ev e WHERE e.uid = s.uid AND e.event = 'account created') AS platform,
  (SELECT min(t) FROM ev e WHERE e.uid = s.uid AND e.event = 'learning goals set' AND e.t >= s.t0 AND e.t < s.t0 + INTERVAL 7 DAY) AS t1 FROM signups s),
f2 AS (SELECT f.*, (SELECT min(t) FROM ev e WHERE e.uid = f.uid AND e.event = 'course enrolled' AND e.t >= f.t1 AND e.t < f.t0 + INTERVAL 7 DAY) AS t2 FROM f),
f3 AS (SELECT f2.*, (SELECT min(t) FROM ev e WHERE e.uid = f2.uid AND e.event = 'lesson started' AND e.t >= f2.t2 AND e.t < f2.t0 + INTERVAL 7 DAY) AS t3 FROM f2),
x AS (SELECT *, platform IN ('ios', 'android') AS mobile, (t3 IS NOT NULL)::INT AS ok FROM f3),
g AS (SELECT 'all' AS cut, mobile, ok FROM x
  UNION ALL SELECT 'account_' || account_type, mobile, ok FROM x
  UNION ALL SELECT CASE WHEN weekend THEN 'signup_weekend' ELSE 'signup_weekday' END, mobile, ok FROM x),
w AS (SELECT cut, count(*) FILTER (WHERE mobile) AS n1, avg(ok) FILTER (WHERE mobile) AS r1, count(*) FILTER (WHERE NOT mobile) AS n0, avg(ok) FILTER (WHERE NOT mobile) AS r0 FROM g GROUP BY 1)
SELECT cut, n1 AS mobile_signups, round(r1, 4) AS mobile, n0 AS web_signups, round(r0, 4) AS web,
 round((r1 - r0) / sqrt(((r1 * n1 + r0 * n0) / (n1 + n0)) * (1 - (r1 * n1 + r0 * n0) / (n1 + n0)) * (1.0 / n1 + 1.0 / n0)), 2) AS z
FROM w ORDER BY 1;
-- by app: iOS and Android separately vs web
WITH f AS (SELECT s.uid, s.t0, (SELECT platform FROM ev e WHERE e.uid = s.uid AND e.event = 'account created') AS platform,
  (SELECT min(t) FROM ev e WHERE e.uid = s.uid AND e.event = 'learning goals set' AND e.t >= s.t0 AND e.t < s.t0 + INTERVAL 7 DAY) AS t1 FROM signups s),
f2 AS (SELECT f.*, (SELECT min(t) FROM ev e WHERE e.uid = f.uid AND e.event = 'course enrolled' AND e.t >= f.t1 AND e.t < f.t0 + INTERVAL 7 DAY) AS t2 FROM f),
f3 AS (SELECT f2.*, (SELECT min(t) FROM ev e WHERE e.uid = f2.uid AND e.event = 'lesson started' AND e.t >= f2.t2 AND e.t < f2.t0 + INTERVAL 7 DAY) AS t3 FROM f2)
SELECT platform, count(*) AS signups, round(avg((t3 IS NOT NULL)::INT), 4) AS completed FROM f3 GROUP BY 1 ORDER BY 1;
