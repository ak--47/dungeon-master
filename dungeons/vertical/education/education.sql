-- ============================================================
-- education.js — v1.6 human-inspection queries (DuckDB)
--
-- Every query is keyed to a story id in education.js's `stories` export;
-- the machine-checked verdicts come from:
--   node scripts/verify-stories.mjs dungeons/vertical/education/education.js --data-prefix verify-education
-- Generate first:
--   node scripts/verify-runner.mjs dungeons/vertical/education/education.js verify-education
-- Run this file:
--   duckdb -c ".read dungeons/vertical/education/education.sql"
--
-- NOTE: this dungeon uses a LITERAL historical window (datasetStart
-- 2026-01-01 → datasetEnd 2026-05-01, no forward shift), so day indexes
-- are computed from the actual min event date.
-- ============================================================

-- ── identity-resolution prelude ─────────────────────────────
-- avgDevicePerUser: 2 + 'account registered' is both isAuthEvent and
-- isFirstEvent, so born users auth on their first event; the device-pool
-- resolve is belt-and-braces for any device-only edge.
CREATE OR REPLACE VIEW users AS
SELECT * FROM read_json_auto('data/verify-education-USERS*.json', sample_size=-1, union_by_name=true);

CREATE OR REPLACE VIEW device_map AS
-- profiles store the device pool under the legacy "anonymousIds" key
SELECT unnest("anonymousIds") AS device_id, distinct_id FROM users;

CREATE OR REPLACE VIEW ev AS
-- ::VARCHAR casts — user_id sniffs as UUID, device_id as VARCHAR; DuckDB
-- refuses to coalesce mixed types
SELECT coalesce(m.distinct_id::VARCHAR, e.user_id::VARCHAR, e.device_id::VARCHAR) AS uid,
       e.time::TIMESTAMP AS t,
       e.*
FROM read_json_auto('data/verify-education-EVENTS*.json', sample_size=-1, union_by_name=true) e
LEFT JOIN device_map m ON e.device_id = m.device_id;

-- Per-user counts. H4's churn (delete ALL events after firstEvent+14d for
-- non-early-joiners with a raw sub-60 quiz) is the only removal touching
-- lectures/quizzes, so lifespan > 14.5d identifies the not-churned
-- population exactly — and within it, output note/speed counts equal the
-- hook-time counts the score treatments keyed on.
CREATE OR REPLACE VIEW per_user AS
SELECT e.uid,
  min(e.t) AS first_t, max(e.t) AS last_t,
  count(*) FILTER (WHERE event = 'lecture completed' AND notes_taken) AS notes,
  count(*) FILTER (WHERE event = 'lecture completed' AND playback_speed >= 2.0) AS fast_lex,
  count(*) FILTER (WHERE event = 'quiz completed') AS quizzes,
  count(*) FILTER (WHERE event = 'certificate earned') AS certs,
  count(*) FILTER (WHERE event = 'course enrolled') AS enrolls,
  count(*) FILTER (WHERE event = 'discussion posted') AS discussions,
  min(CASE WHEN event = 'study group joined' THEN e.t END) AS first_join_t
FROM ev e GROUP BY 1;

CREATE OR REPLACE VIEW per_user_u AS
SELECT p.*, u.subscription_status, u.account_type,
  (p.first_join_t IS NOT NULL AND date_diff('hour', p.first_t, p.first_join_t) <= 240) AS early_join,
  (p.last_t > p.first_t + INTERVAL '14 days 12 hours') AS retained
FROM per_user p JOIN users u ON p.uid = u.distinct_id::VARCHAR;


-- ── H1-role-profiles ────────────────────────────────────────
-- 8:1 student pool (instructor share 1/9 ≈ 0.111); role-exclusive profile
-- attributes; the everything hook stamps account_type on 'account
-- registered' events from the profile, so the event breakdown is exact.
SELECT account_type, count(*) AS n,
  round(avg(courses_created), 1) AS avg_courses_created,
  round(avg(instructor_rating), 2) AS avg_rating,
  round(avg(study_hours_per_week), 1) AS avg_study_hrs
FROM users GROUP BY 1 ORDER BY n DESC;
-- read: student ~89% with courses_created 0; instructor ~11% with
--       study_hours 0

SELECT round(avg((e.account_type = u.account_type)::INT), 4) AS event_profile_agreement, count(*) AS n
FROM ev e JOIN users u ON e.uid = u.distinct_id::VARCHAR
WHERE e.event = 'account registered';
-- read: agreement = 1.0 (hook-stamped)


-- ── H2-deadline-cramming ────────────────────────────────────
-- Sun/Mon: is_late redrawn at 60% (organic ~20%); quiz scores -25 (clamp 0).
-- DuckDB dayofweek: Sunday=0, Monday=1.
SELECT dayofweek(t) AS dow, count(*) AS n,
  round(avg(is_late::INT) * 100, 1) AS pct_late
FROM ev WHERE event = 'assignment submitted'
GROUP BY 1 ORDER BY 1;
-- read: dow 0/1 ≈ 60%; dow 2-6 ≈ 20%

SELECT (dayofweek(t) IN (0, 1)) AS sun_mon, count(*) AS n,
  round(avg(score_percent), 2) AS avg_score
FROM ev WHERE event = 'quiz completed'
GROUP BY 1 ORDER BY 1;
-- read: gap ≈ 24 pts (25 knob minus clamp-at-0 attenuation)


-- ── H3-notes-magic-number ───────────────────────────────────
-- 5-8 notes → quiz ×1.3 (cap 100) + 40% bonus cert; 9+ notes → 35% of
-- certs dropped. Score read: retained non-speed users, non-Sun/Mon
-- quizzes (isolates H3 from H8's +8 and H2's -25).
WITH b AS (
  SELECT uid, CASE WHEN notes BETWEEN 5 AND 8 THEN 'sweet'
                   WHEN notes <= 4 THEN 'low' ELSE 'over' END AS bin
  FROM per_user_u WHERE retained AND fast_lex < 3
)
SELECT b.bin, count(DISTINCT e.uid) AS users, round(avg(e.score_percent), 2) AS avg_score
FROM ev e JOIN b ON e.uid = b.uid
WHERE e.event = 'quiz completed' AND dayofweek(e.t) NOT IN (0, 1)
GROUP BY 1 ORDER BY 1;
-- read: sweet/low ≈ 1.3; over/low ≈ 1.0 (placebo — 9+ scores untreated)

SELECT CASE WHEN notes <= 4 THEN 'low' WHEN notes BETWEEN 5 AND 8 THEN 'sweet' ELSE 'over' END AS bin,
  count(*) AS users, round(sum(certs)::DOUBLE / nullif(sum(enrolls), 0), 4) AS certs_per_enroll
FROM per_user_u WHERE retained GROUP BY 1 ORDER BY 1;
-- read: over/sweet ≈ 0.70 (0.65 keep knob, diluted by sweet's bonus
--       certs); sweet/low ≈ 1.0 (flatness — activity coupling nets out)


-- ── H4-study-group-retention ────────────────────────────────
-- Non-early-joiners with ANY raw sub-60 quiz lose all events after
-- day 14 — near-deterministic at organic score mean ~40. Restrict to
-- users with >= 20d possible tenure.
SELECT early_join, count(*) AS users,
  round(avg(retained::INT), 4) AS d14_activity,
  round(avg(discussions), 2) AS discussions_per_user
FROM per_user_u WHERE first_t <= (SELECT max(t) - INTERVAL 20 DAY FROM ev)
GROUP BY 1 ORDER BY 1;
-- read: early_join ≈ 1.00 vs ≈ 0.01; discussions ratio ≈ 18x (churn
--       truncation + 60% single-clone bonus)


-- ── H5-hint-dependency ──────────────────────────────────────
-- hint → easy forced 60%; no-hint → hard forced 40%. Organic difficulty
-- pool is NOT uniform (easy 0.36 / med 0.29 / hard 0.35 measured), so
-- expected = knob + (1-knob) × organic share.
SELECT hint_used, count(*) AS n,
  round(avg((difficulty = 'easy')::INT), 4) AS p_easy,
  round(avg((difficulty = 'medium')::INT), 4) AS p_med,
  round(avg((difficulty = 'hard')::INT), 4) AS p_hard
FROM ev WHERE event = 'practice problem solved'
GROUP BY 1 ORDER BY 1;
-- read: p_easy|hint ≈ 0.745; p_hard|no-hint ≈ 0.610


-- ── H6-semester-spike ───────────────────────────────────────
-- Days 75-84 from dataset start: quiz started / quiz completed /
-- assignment submitted duplicated at 80% → ~1.8x. Flanks 60-74 + 85-100.
WITH d AS (
  SELECT date_diff('day', (SELECT min(t)::DATE FROM ev), t::DATE) AS day_idx,
         event IN ('quiz started', 'quiz completed', 'assignment submitted') AS spikable
  FROM ev
)
SELECT CASE WHEN day_idx BETWEEN 75 AND 84 THEN 'window'
            WHEN day_idx BETWEEN 60 AND 74 OR day_idx BETWEEN 85 AND 100 THEN 'flank' END AS zone,
  round(count(*) FILTER (WHERE spikable) / count(DISTINCT day_idx)::DOUBLE, 1) AS spikable_per_day,
  round(count(*) FILTER (WHERE NOT spikable) / count(DISTINCT day_idx)::DOUBLE, 1) AS other_per_day
FROM d WHERE day_idx BETWEEN 60 AND 100 GROUP BY 1 ORDER BY 1;
-- read: spikable window/flank ≈ 1.9; other (placebo) ≈ 1.1 (organic
--       mid-dataset ramp)


-- ── H7-free-vs-paid ─────────────────────────────────────────
-- Cert-funnel conversion ×0.5 free / ×1.5 paid (funnel-pre), THEN free
-- loses 55% of certs (everything). Compound = 3 × 1/0.45 = 6.67x on the
-- funnel read; certs-per-enrollment lands ~6.0 (diluted by standalone
-- certs). annual vs monthly is the placebo (identical treatment; H9
-- moves cert TIMES, not counts).
SELECT subscription_status, count(*) AS users,
  sum(certs) AS certs, sum(enrolls) AS enrolls,
  round(sum(certs)::DOUBLE / nullif(sum(enrolls), 0), 4) AS certs_per_enroll
FROM per_user_u GROUP BY 1 ORDER BY 1;
-- read: monthly/free ≈ 6.0; annual/monthly ≈ 1.0-1.1 (placebo)


-- ── H8-playback-speed ───────────────────────────────────────
-- speed >= 2.0: watch ×0.6 (floor 3); speed <= 1.0: ×1.4 (cap 90, never
-- binds). Mid (1.25/1.5) untreated.
SELECT CASE WHEN playback_speed >= 2.0 THEN 'fast'
            WHEN playback_speed <= 1.0 THEN 'slow' ELSE 'mid' END AS bucket,
  count(*) AS n, round(avg(watch_time_mins), 2) AS avg_watch
FROM ev WHERE event = 'lecture completed' GROUP BY 1 ORDER BY 1;
-- read: fast/mid ≈ 0.59 (Math.floor costs ~2%); slow/mid ≈ 1.40

-- +8 quiz boost for 3+-fast-lecture users — read as a DIFFERENCE among
-- retained non-sweet-notes users on non-Sun/Mon quizzes (isolates H8
-- from H3 and H2).
WITH c AS (SELECT uid, fast_lex >= 3 AS speedy FROM per_user_u
           WHERE retained AND notes NOT BETWEEN 5 AND 8)
SELECT c.speedy, count(DISTINCT e.uid) AS users, round(avg(e.score_percent), 2) AS avg_score
FROM ev e JOIN c ON e.uid = c.uid
WHERE e.event = 'quiz completed' AND dayofweek(e.t) NOT IN (0, 1)
GROUP BY 1 ORDER BY 1;
-- read: speedy − rest ≈ +8 to +9 pts


-- ── H9-completion-ttc ───────────────────────────────────────
-- Cert gap to nearest preceding enrollment rescaled: annual ×0.5, free
-- ×1.8 (monthly untouched). Cross-event proxy: first-enroll → first-cert
-- per user. The story's authoritative read is the emulator's 2-step
-- timeToConvert at 86.4h (see education.verify.mjs) — this SQL proxy is
-- directional only (first-cert pairing is not Mixpanel's greedy pick).
WITH fe AS (
  SELECT uid, min(t) FILTER (WHERE event = 'course enrolled') AS first_enroll,
         min(t) FILTER (WHERE event = 'certificate earned') AS first_cert
  FROM ev GROUP BY 1
)
SELECT u.subscription_status, count(*) AS converters,
  round(median(date_diff('minute', fe.first_enroll, fe.first_cert)) / 60.0, 2) AS median_ttc_h
FROM fe JOIN users u ON fe.uid = u.distinct_id::VARCHAR
WHERE fe.first_cert IS NOT NULL AND fe.first_cert > fe.first_enroll
GROUP BY 1 ORDER BY 2;
-- read: annual < monthly < free (direction; magnitudes compress because
--       first-pair TTC spans multiple enrollments)


-- ── H10-ai-study-buddy ──────────────────────────────────────
-- 'AI Study Buddy' A/B on Social Learning (last 30 days): conversion
-- ×1.4 generative (~1.37 observed after ~0.035 organic pollution), TTC ×0.85.
-- Strict pairing anchors at funnel ENTRY (first 'discussion posted' at/
-- after $experiment_started; the exp→entry lag is arm-dependent) with a
-- 12h conversion window and an interior 'study group joined'.
WITH exp AS (
  SELECT uid, t, "Variant name" AS variant FROM ev WHERE event = '$experiment_started'
),
a AS (
  SELECT exp.uid, exp.variant, exp.t,
    (SELECT min(x.t) FROM ev x WHERE x.uid = exp.uid AND x.event = 'discussion posted'
     AND x.t >= exp.t - INTERVAL 1 MINUTE) AS s1
  FROM exp
),
c AS (
  SELECT a.*, (
      SELECT min(r.t) FROM ev r
      WHERE r.uid = a.uid AND r.event = 'resource downloaded'
        AND r.t > a.s1 AND r.t <= a.s1 + INTERVAL 12 HOUR
        AND EXISTS (SELECT 1 FROM ev s WHERE s.uid = a.uid AND s.event = 'study group joined'
                    AND s.t > a.s1 AND s.t < r.t)
    ) AS conv_t
  FROM a WHERE a.s1 IS NOT NULL AND a.s1 <= a.t + INTERVAL 24 HOUR
)
SELECT variant, count(*) AS attempts, count(conv_t) AS conversions,
  round(count(conv_t)::DOUBLE / count(*), 4) AS conv_rate,
  round(median(date_diff('minute', s1, conv_t)) / 60.0, 2) AS median_ttc_h
FROM c GROUP BY 1 ORDER BY 1;
-- read: lift ≈ 1.37 (AI/Control); TTC ratio ≈ 0.85
