-- ============================================================
-- fitness.js — v1.6 human-inspection queries (DuckDB)
--
-- Every query is keyed to a story id in fitness.js's `stories` export;
-- the machine-checked verdicts come from:
--   node scripts/verify-stories.mjs dungeons/vertical/fitness/fitness.js --data-prefix verify-fitness
-- Generate first:
--   node scripts/verify-runner.mjs dungeons/vertical/fitness/fitness.js verify-fitness
-- Run this file:
--   duckdb -c ".read dungeons/vertical/fitness/fitness.sql"
-- ============================================================

-- ── identity-resolution prelude ─────────────────────────────
-- avgDevicePerUser: 3 + account created is both isAuthEvent and
-- isFirstEvent, so born users auth on their first event; the device-pool
-- resolve is belt-and-braces for any device-only edge.
CREATE OR REPLACE VIEW users AS
SELECT * FROM read_json_auto('data/verify-fitness-USERS*.json', sample_size=-1, union_by_name=true);

CREATE OR REPLACE VIEW device_map AS
-- profiles store the device pool under the legacy "anonymousIds" key
SELECT unnest("anonymousIds") AS device_id, distinct_id FROM users;

CREATE OR REPLACE VIEW ev AS
-- ::VARCHAR casts — user_id sniffs as UUID, device_id as VARCHAR; DuckDB
-- refuses to coalesce mixed types
SELECT coalesce(m.distinct_id::VARCHAR, e.user_id::VARCHAR, e.device_id::VARCHAR) AS uid,
       e.time::TIMESTAMP AS t,
       e.*
FROM read_json_auto('data/verify-fitness-EVENTS*.json', sample_size=-1, union_by_name=true) e
LEFT JOIN device_map m ON e.device_id = m.device_id;

-- Per-user workout counts. H3/H4/H10 classify on counts taken after H8's
-- progress-checked drop and H5's resolver thinning; for non-resolver users
-- no later hook deletes "workout completed", so output counts rebuild the
-- hook cohorts exactly (resolver-sensitive queries exclude that segment).
CREATE OR REPLACE VIEW workout_ct AS
SELECT uid, count(*) AS w FROM ev WHERE event = 'workout completed' GROUP BY 1;


-- ── H1-morning-calorie-boost ────────────────────────────────
-- workouts 05:00-09:00 UTC carry calories_burned × 1.3. Nothing else
-- touches calories_burned, so avg AND median ratios read the knob.
SELECT CASE WHEN extract(hour FROM t) >= 5 AND extract(hour FROM t) < 9 THEN 'morning' ELSE 'other' END AS grp,
  count(*) AS workouts, round(avg(calories_burned), 1) AS avg_cal, median(calories_burned) AS med_cal
FROM ev WHERE event = 'workout completed' GROUP BY 1 ORDER BY 1;


-- ── H2-ai-coaching-lift ─────────────────────────────────────
-- after day 35 (2026-02-05), workouts flip to coaching_mode='ai_assisted'
-- at 40% per-event, and ai_assisted duration × 1.2. Pre-launch ai rows
-- must be ZERO (declared pool is the single value 'self_guided').
SELECT count(*) FILTER (WHERE coaching_mode = 'ai_assisted' AND t <= TIMESTAMP '2026-02-05') AS pre_launch_ai,
  count(*) FILTER (WHERE coaching_mode = 'ai_assisted') AS ai_total
FROM ev WHERE event IN ('workout completed', 'workout planned');

SELECT coaching_mode, count(*) AS workouts, round(avg(duration_minutes), 1) AS avg_dur
FROM ev WHERE event = 'workout completed' AND t > TIMESTAMP '2026-02-05' GROUP BY 1 ORDER BY 1;


-- ── H3-streak-achievements ──────────────────────────────────
-- ≥2-workout users: profile streak_days OVERWRITTEN to hook-time workout
-- count, plus C(w) = min(w−1, 3) + 4·max(w−4, 0) cloned achievements.
-- Contract is ONE-SIDED for non-resolvers: sd < w impossible (nothing adds
-- workouts after H3); sd > w happens when the silent future-time guard
-- deletes a counted workout post-hook (~0.5% of users) — so expect
-- below_w = 0 and eq_share ≥ 0.99, NOT perfect equality.
WITH j AS (SELECT u.distinct_id::VARCHAR AS uid, u.segment, u.streak_days AS sd, coalesce(w.w, 0) AS w
  FROM users u LEFT JOIN workout_ct w ON w.uid = u.distinct_id::VARCHAR
  WHERE u.segment <> 'resolver')
SELECT count(*) FILTER (WHERE w >= 2 AND sd < w) AS below_w,
  count(*) FILTER (WHERE segment <> 'coach' AND sd = 1) AS unreachable_one,
  round(count(*) FILTER (WHERE w >= 2 AND sd = w)::DOUBLE / nullif(count(*) FILTER (WHERE w >= 2), 0), 4) AS eq_share,
  count(*) FILTER (WHERE w >= 2) AS streak_users
FROM j;

-- implied organic achievements (total − C(w)) — median should sit in the
-- low single digits (ach weight 2 of 68); a drifted clone formula would
-- push it negative or huge.
WITH ac AS (SELECT uid, count(*) AS a FROM ev WHERE event = 'achievement unlocked' GROUP BY 1),
j AS (SELECT u.distinct_id::VARCHAR AS uid, coalesce(w.w, 0) AS w, coalesce(a.a, 0) AS a
  FROM users u LEFT JOIN workout_ct w ON w.uid = u.distinct_id::VARCHAR LEFT JOIN ac a ON a.uid = u.distinct_id::VARCHAR
  WHERE u.segment <> 'resolver')
SELECT count(*) AS cohort,
  round(count(*) FILTER (WHERE a - (LEAST(w - 1, 3) + GREATEST(w - 4, 0) * 4) >= 1)::DOUBLE / count(*), 4) AS ok_share,
  median(a - (LEAST(w - 1, 3) + GREATEST(w - 4, 0) * 4)) AS med_organic
FROM j WHERE w BETWEEN 2 AND 14 AND a >= 1;


-- ── H4-social-challenge-completion ──────────────────────────
-- ≥3-friend users get max(1, floor(cc × 0.5)) cloned challenge completions.
-- out = cc + max(1, floor(cc/2)) skips {5, 8, 11, …} = {n≥5 : n≡2 mod 3} —
-- gap hits on the clean cohort only come from the future-time guard (~2%).
WITH fr AS (SELECT uid, count(*) AS f FROM ev WHERE event = 'friend added' GROUP BY 1),
ch AS (SELECT uid, count(*) AS c FROM ev WHERE event = 'challenge completed' GROUP BY 1),
j AS (SELECT u.distinct_id::VARCHAR AS uid, coalesce(w.w, 0) AS w, coalesce(f.f, 0) AS f, coalesce(c.c, 0) AS c
  FROM users u LEFT JOIN workout_ct w ON w.uid = u.distinct_id::VARCHAR
  LEFT JOIN fr f ON f.uid = u.distinct_id::VARCHAR LEFT JOIN ch c ON c.uid = u.distinct_id::VARCHAR
  WHERE u.segment <> 'resolver')
SELECT count(*) AS clean_cohort, count(*) FILTER (WHERE c >= 5 AND c % 3 = 2) AS gap_hits
FROM j WHERE w <= 14 AND f >= 3 AND c >= 2;

-- within-social-segment gradient (composite: clone lift × activity correlation)
WITH fr AS (SELECT uid, count(*) AS f FROM ev WHERE event = 'friend added' GROUP BY 1),
ch AS (SELECT uid, count(*) AS c FROM ev WHERE event = 'challenge completed' GROUP BY 1),
j AS (SELECT u.distinct_id::VARCHAR AS uid, coalesce(f.f, 0) AS f, coalesce(c.c, 0) AS c
  FROM users u LEFT JOIN fr f ON f.uid = u.distinct_id::VARCHAR LEFT JOIN ch c ON c.uid = u.distinct_id::VARCHAR
  WHERE u.segment = 'social')
SELECT CASE WHEN f >= 3 THEN 'friend_heavy' ELSE 'friend_light' END AS grp,
  count(*) AS users, round(avg(c), 3) AS avg_challenge_completions
FROM j WHERE f >= 3 OR f <= 1 GROUP BY 1 ORDER BY 1;


-- ── H5-resolver-churn-cliff ─────────────────────────────────
-- resolvers with <30 hook-time events lose 70% of post-day-14
-- (2026-01-15) events. Persona churnRate/activeWindow are deprecated
-- engine no-ops — the cliff is the hook alone, so the estimator targets
-- the 0.30 keep-rate. Deletions-only ⇒ eligible ⟺ output n < 30.
-- Double-difference: birth pinned to first event < day 2 (removes
-- birth-composition), lo/hi volume split normalized by the same split
-- inside casual (removes n-selection; casual lo/hi ≈ 1.22 measured).
-- DD = (res_lo/res_hi) ÷ (cas_lo/cas_hi) ≈ 0.30.
WITH tot AS (SELECT uid, count(*) AS n, min(t) AS first_t,
  count(*) FILTER (WHERE t < TIMESTAMP '2026-01-15') AS pre,
  count(*) FILTER (WHERE t >= TIMESTAMP '2026-01-15') AS post
  FROM ev GROUP BY 1),
j AS (SELECT u.segment AS seg, CASE WHEN t.n < 30 THEN 'lo' ELSE 'hi' END AS arm, t.pre, t.post
  FROM users u JOIN tot t ON t.uid = u.distinct_id::VARCHAR
  WHERE t.first_t < TIMESTAMP '2026-01-03' AND u.segment IN ('resolver', 'casual'))
SELECT seg, arm, count(*) AS users,
  round(sum(post)::DOUBLE / nullif(sum(pre), 0), 4) AS rho
FROM j GROUP BY 1, 2 ORDER BY 1, 2;
-- read: (rho[resolver,lo] / rho[resolver,hi]) / (rho[casual,lo] / rho[casual,hi])
-- ≈ 0.30; the casual lo/hi ratio itself is the placebo (~1, far from 0.3).


-- ── H6-coach-session-quality ────────────────────────────────
-- every coach-session satisfaction_score redrawn uniform [4.0, 5.0]
-- (unconditional — a single sub-4.0 score is a hook bug; avg = median = 4.5).
SELECT count(*) FILTER (WHERE satisfaction_score < 4.0) AS below_min,
  count(*) AS sessions, round(avg(satisfaction_score), 3) AS avg_sat, median(satisfaction_score) AS med_sat
FROM ev WHERE event = 'coach session';


-- ── H7-coach-profile-enrichment ─────────────────────────────
-- user hook: coaches get total_workouts uniform [200, 500] (avg 350);
-- everyone else keeps the declared 0. Ranges deterministic. (streak_days
-- 60-365 also seeded here, but H3 overwrites it for ≥2-workout users —
-- total_workouts is the durable coach signature.)
SELECT CASE WHEN segment = 'coach' THEN 'coach' ELSE 'other' END AS grp,
  count(*) AS users, min(total_workouts) AS min_tw, max(total_workouts) AS max_tw,
  round(avg(total_workouts), 1) AS avg_tw
FROM users GROUP BY 1 ORDER BY 1;


-- ── H8-annual-follow-through ────────────────────────────────
-- 30% of free/monthly users lose ALL progress-checked events (per-user
-- cliff). Tier assigned BY segment → raw cross-tier reads are confounded
-- by persona composition BY CONSTRUCTION; only athlete and social contain
-- both an affected and a control tier, so standardize within those.
WITH pc AS (SELECT uid, count(*) AS ct FROM ev WHERE event = 'progress checked' GROUP BY 1),
j AS (SELECT u.segment AS seg, CASE WHEN u.subscription_tier IN ('annual', 'family') THEN 'ctl' ELSE 'aff' END AS arm,
  coalesce(p.ct, 0) AS ct
  FROM users u LEFT JOIN pc p ON p.uid = u.distinct_id::VARCHAR
  WHERE u.segment IN ('athlete', 'social'))
SELECT seg, arm, count(*) AS users,
  round(count(*) FILTER (WHERE ct = 0)::DOUBLE / count(*), 4) AS zero_share,
  round(avg(ct) FILTER (WHERE ct > 0), 2) AS avg_ct_survivors
FROM j GROUP BY 1, 2 ORDER BY 1, 2;
-- read: (z_aff − z_ctl) / (1 − z_ctl) per segment ≈ 0.30; survivor avgs
-- match within segment (per-user cliff, not thinning).


-- ── H9-workout-loop-ttc ─────────────────────────────────────
-- funnel-post scales EVERY funnel instance's gaps by tier: annual/family
-- × 0.77, free × 1.25, monthly = 1.0.
-- CAUTION: cross-event TTC SQL here would be censored by its lookback
-- window (the ai-platform H9 lesson — censoring can invert the measured
-- direction). The story asserts TTC through the Mixpanel-aligned emulator
-- at a 60h window (= 48h generative window × 1.25 max stretch, covering
-- the stretched support); trust the story verdict, not ad-hoc pair SQL.
SELECT subscription_tier, count(*) AS planned_events
FROM ev WHERE event = 'workout planned' GROUP BY 1 ORDER BY 1;


-- ── H10-workout-magic-number ────────────────────────────────
-- sweet 12-14 workouts → ALL workout durations × 1.35; over 15+ → 65% of
-- post-day-30 (2026-01-31) events dropped EXCEPT workout completed /
-- progress checked. Duration read restricted to pre-AI-launch (≤2026-02-05)
-- where H2 never touched durations — AVG ratio reads the 1.35 knob exactly;
-- median atom-snaps on the discrete duration pool (reads high, ~1.48).
WITH coh AS (SELECT uid, CASE WHEN w BETWEEN 12 AND 14 THEN 'sweet'
  WHEN w BETWEEN 2 AND 11 THEN 'low' WHEN w >= 15 THEN 'over' END AS grp FROM workout_ct)
SELECT c.grp, count(DISTINCT c.uid) AS users, round(avg(e.duration_minutes), 2) AS avg_dur_prelaunch
FROM coh c JOIN ev e ON e.uid = c.uid AND e.event = 'workout completed' AND e.t <= TIMESTAMP '2026-02-05'
WHERE c.grp IS NOT NULL GROUP BY 1 ORDER BY avg_dur_prelaunch;

-- over-drop: within-user-normalized double ratio of non-preserved volume
WITH coh AS (SELECT uid, CASE WHEN w >= 15 THEN 'over' WHEN w BETWEEN 12 AND 14 THEN 'sweet' END AS grp
  FROM workout_ct WHERE w >= 12),
per AS (SELECT c.grp, c.uid,
  count(*) FILTER (WHERE e.event NOT IN ('workout completed', 'progress checked') AND e.t < TIMESTAMP '2026-01-31') AS pre,
  count(*) FILTER (WHERE e.event NOT IN ('workout completed', 'progress checked') AND e.t >= TIMESTAMP '2026-01-31') AS post
  FROM coh c JOIN ev e ON e.uid = c.uid GROUP BY 1, 2)
SELECT grp, count(*) AS users, round(sum(post)::DOUBLE / nullif(sum(pre), 0), 4) AS post_pre
FROM per WHERE grp IS NOT NULL GROUP BY 1 ORDER BY 1;
