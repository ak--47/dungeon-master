-- ============================================================
-- healthcare.js — v1.6 human-inspection queries (DuckDB)
--
-- Every query is keyed to a story id in healthcare.js's `stories` export;
-- the machine-checked verdicts come from:
--   node scripts/verify-stories.mjs dungeons/vertical/healthcare/healthcare.js --data-prefix verify-healthcare
-- Generate first:
--   node scripts/verify-runner.mjs dungeons/vertical/healthcare/healthcare.js verify-healthcare
-- Run this file:
--   duckdb -c ".read dungeons/vertical/healthcare/healthcare.sql"
-- ============================================================

-- ── identity-resolution prelude ─────────────────────────────
-- avgDevicePerUser: 2 + account created is both isAuthEvent and
-- isFirstEvent, so born users auth on their first event; the device-pool
-- resolve is belt-and-braces for any device-only edge.
CREATE OR REPLACE VIEW users AS
SELECT * FROM read_json_auto('data/verify-healthcare-USERS*.json', sample_size=-1, union_by_name=true);

CREATE OR REPLACE VIEW device_map AS
-- profiles store the device pool under the legacy "anonymousIds" key
SELECT unnest("anonymousIds") AS device_id, distinct_id FROM users;

CREATE OR REPLACE VIEW ev AS
-- ::VARCHAR casts — user_id sniffs as UUID, device_id as VARCHAR; DuckDB
-- refuses to coalesce mixed types
SELECT coalesce(m.distinct_id::VARCHAR, e.user_id::VARCHAR, e.device_id::VARCHAR) AS uid,
       e.time::TIMESTAMP AS t,
       e.*
FROM read_json_auto('data/verify-healthcare-EVENTS*.json', sample_size=-1, union_by_name=true) e
LEFT JOIN device_map m ON e.device_id = m.device_id;

-- Per-user consultation counts. H3/H10 classify on counts taken after all
-- filters (H8 cliff, H6 thinning) and nothing drops consultations later,
-- so output-side counts rebuild the hook cohorts exactly.
CREATE OR REPLACE VIEW consult_ct AS
SELECT uid, count(*) AS ct FROM ev WHERE event = 'consultation completed' GROUP BY 1;


-- ── H1-after-hours-pricing ──────────────────────────────────
-- consultations 19:00-07:00 UTC carry consultation_fee × 1.5. H10's
-- sweet-spot boost rides both HOD bins equally, so avg AND median ratios
-- read the knob.
SELECT CASE WHEN extract(hour FROM t) >= 19 OR extract(hour FROM t) < 7 THEN 'after' ELSE 'business' END AS grp,
  count(*) AS consults, round(avg(consultation_fee), 2) AS avg_fee, median(consultation_fee) AS med_fee
FROM ev WHERE event = 'consultation completed' GROUP BY 1 ORDER BY 1;


-- ── H2-flu-season ───────────────────────────────────────────
-- days 50-70 (2026-02-20 → 2026-03-12): bookings forced respiratory at
-- 60% (expected share 0.60 + 0.40 × 1/8 = 0.65 vs declared 0.125) and
-- in-window respiratory wait_time_hours × 2.
SELECT CASE WHEN t > TIMESTAMP '2026-02-20' AND t < TIMESTAMP '2026-03-12' THEN 'in' ELSE 'out' END AS grp,
  count(*) AS bookings,
  round(count(*) FILTER (WHERE condition_type = 'respiratory')::DOUBLE / count(*), 4) AS resp_share,
  round(avg(wait_time_hours) FILTER (WHERE condition_type = 'respiratory'), 1) AS resp_wait,
  round(avg(wait_time_hours) FILTER (WHERE condition_type <> 'respiratory'), 1) AS other_wait
FROM ev WHERE event = 'appointment booked' GROUP BY 1 ORDER BY 1;


-- ── H3-experienced-doctor-satisfaction ──────────────────────
-- users with >12 output consultations: every satisfaction_score redrawn
-- uniform [4.0, 5.0]. Purity is exact (later hooks only delete consults) —
-- below_min must be 0.
SELECT count(*) FILTER (WHERE e.satisfaction_score < 4.0) AS below_min,
  count(*) AS scores, count(DISTINCT c.uid) AS exp_users
FROM consult_ct c JOIN ev e ON e.uid = c.uid AND e.event = 'consultation completed'
WHERE c.ct > 12;

SELECT CASE WHEN c.ct > 12 THEN 'exp' WHEN c.ct <= 9 THEN 'base' ELSE 'mid' END AS grp,
  count(DISTINCT c.uid) AS users, round(avg(e.satisfaction_score), 2) AS avg_sat
FROM consult_ct c JOIN ev e ON e.uid = c.uid AND e.event = 'consultation completed'
GROUP BY 1 ORDER BY avg_sat;


-- ── H4-video-followup-lift ──────────────────────────────────
-- 60% of video consultations inject one cloned follow-up 1-7d later.
-- Per-consultation attribution: follow-ups within 7d after each consult,
-- video minus phone ≈ 0.6 (attenuated by clones landing in neighboring
-- phone consults' windows). Restricted to consults ≥7d before datasetEnd
-- (clones past the end are future-guard dropped) among users with ≥1
-- follow-up (clones need an organic template).
WITH fu_users AS (SELECT DISTINCT uid FROM ev WHERE event = 'follow up scheduled'),
cons AS (SELECT e.uid, e.t, e.consultation_mode AS mode
  FROM ev e JOIN fu_users f ON f.uid = e.uid
  WHERE e.event = 'consultation completed' AND e.t <= TIMESTAMP '2026-04-24 23:59:59'),
cnt AS (SELECT c.uid, c.mode, c.t, count(fu.uid) AS fu7
  FROM cons c LEFT JOIN ev fu ON fu.uid = c.uid AND fu.event = 'follow up scheduled'
    AND fu.t > c.t AND fu.t <= c.t + INTERVAL 7 DAY
  GROUP BY 1, 2, 3)
SELECT mode AS grp, count(*) AS consults, round(avg(fu7), 3) AS avg_fu_within_7d
FROM cnt GROUP BY 1 ORDER BY 1;


-- ── H5-chronic-refill-chain ─────────────────────────────────
-- each chronic prescription spawns 2-4 cloned refills at ~30d intervals
-- (chronic / chronic_maintenance / refill_count=i); clones past
-- datasetEnd are future-guard dropped. Inspect: refill mix on chronic-rx
-- users vs everyone else (organic chronic∧chronic_maintenance mix is
-- 2/7 × 1/8 ≈ 0.036).
WITH refill_users AS (SELECT DISTINCT uid FROM ev WHERE event = 'prescription refill'),
cohort AS (SELECT DISTINCT e.uid FROM ev e JOIN refill_users ru ON ru.uid = e.uid
  WHERE e.event = 'prescription issued' AND e.condition_type = 'chronic')
SELECT (c.uid IS NOT NULL) AS chronic_rx_user, count(*) AS refills,
  round(count(*) FILTER (WHERE e.condition_type = 'chronic' AND e.medication_type = 'chronic_maintenance')::DOUBLE / count(*), 4) AS cm_share
FROM ev e LEFT JOIN cohort c ON c.uid = e.uid
WHERE e.event = 'prescription refill' GROUP BY 1 ORDER BY 1;


-- ── H6-occasional-no-shows ──────────────────────────────────
-- users with <15 events (hook-time) lose 25% of consultations and get
-- no_show=true on 25% of bookings. Flag purity is exact: flagged ⇒ output
-- count ≤ 14 (everything after only deletes), so ≥15-event users must
-- carry ZERO no_show=true rows.
WITH tot AS (SELECT uid, count(*) AS ct FROM ev GROUP BY 1)
SELECT (t2.ct >= 15) AS big_user, count(*) AS bookings,
  count(*) FILTER (WHERE e.no_show = true) AS noshows,
  round(count(*) FILTER (WHERE e.no_show = true)::DOUBLE / count(*), 4) AS ns_rate
FROM ev e JOIN tot t2 ON t2.uid = e.uid
WHERE e.event = 'appointment booked' GROUP BY 1 ORDER BY 1;


-- ── H7-doctor-specialization ────────────────────────────────
-- user hook: doctors get specialty + years_experience uniform [15, 30];
-- nurses [3, 15]; patients pinned 0. Ranges are deterministic — min/max
-- outside them is a hook bug.
SELECT role, count(*) AS users,
  round(avg(years_experience), 1) AS avg_yx, min(years_experience) AS min_yx, max(years_experience) AS max_yx,
  count(*) FILTER (WHERE specialty = 'none') AS specialty_none
FROM users GROUP BY 1 ORDER BY avg_yx DESC;


-- ── H8-free-tier-cliff ──────────────────────────────────────
-- 30% of free-tier users lose ALL consultations (per-user cliff).
-- (z_free − z_paid) / (1 − z_paid) reads the knob with the natural-zero
-- baseline cancelled.
WITH per AS (SELECT u.distinct_id::VARCHAR AS uid, u.subscription_tier AS tier FROM users u),
cons AS (SELECT uid, count(*) AS ct FROM ev WHERE event = 'consultation completed' GROUP BY 1),
j AS (SELECT p.tier, coalesce(c.ct, 0) AS ct FROM per p LEFT JOIN cons c ON c.uid = p.uid)
SELECT CASE WHEN tier = 'free' THEN 'free' ELSE 'paid' END AS grp, count(*) AS users,
  round(count(*) FILTER (WHERE ct = 0)::DOUBLE / count(*), 4) AS zero_consult_share,
  round(avg(ct) FILTER (WHERE ct > 0), 2) AS avg_consults_survivors
FROM j GROUP BY 1 ORDER BY 1;

-- Survivor placebo (cliff vs per-event thinning), SEGMENT-STANDARDIZED:
-- tier and persona come out correlated in-sample and persona
-- eventModifier drives volume, so the raw survivor comparison above is
-- confounded by composition (visible in avg_consults_survivors). Within
-- segment, free survivors ≈ basic (ratio ~1.0); thinning would read ~0.7
-- in every segment.
WITH cons AS (SELECT uid, count(*) AS ct FROM ev WHERE event = 'consultation completed' GROUP BY 1),
surv AS (SELECT u.subscription_tier AS tier, u.segment AS seg, c.ct
  FROM users u JOIN cons c ON c.uid = u.distinct_id::VARCHAR)
SELECT seg, count(*) FILTER (WHERE tier = 'free') AS free_n, count(*) FILTER (WHERE tier = 'basic') AS basic_n,
  round(avg(ct) FILTER (WHERE tier = 'free'), 2) AS free_avg,
  round(avg(ct) FILTER (WHERE tier = 'basic'), 2) AS basic_avg,
  round(avg(ct) FILTER (WHERE tier = 'free') / avg(ct) FILTER (WHERE tier = 'basic'), 4) AS ratio
FROM surv GROUP BY 1 ORDER BY 1;


-- ── H9-ttc-by-tier ──────────────────────────────────────────
-- premium × 0.67 / free × 1.4 on wait_time_hours, duration_minutes, and
-- the first booked→consult→follow-up sequence's timestamps. Property
-- ratios read the knobs exactly (H2's flu doubling is tier-blind and
-- cancels in the ratio).
SELECT subscription_tier, count(*) AS bookings, round(avg(wait_time_hours), 1) AS avg_wait
FROM ev WHERE event = 'appointment booked' GROUP BY 1 ORDER BY avg_wait;

SELECT subscription_tier, count(*) AS consults, round(avg(duration_minutes), 1) AS avg_dur
FROM ev WHERE event = 'consultation completed' GROUP BY 1 ORDER BY avg_dur;

-- CAUTION: cross-event TTC SQL here would be censored by its lookback
-- window (the ai-platform H9 lesson — censoring can invert the measured
-- direction). The story asserts TTC through the Mixpanel-aligned emulator
-- at a 2016h window (= 1.4 × 2 gaps × 30d per-gap cap, covering the
-- stretched support); trust the story verdict, not ad-hoc pair SQL.


-- ── H10-consult-count-magic-number ──────────────────────────
-- sweet 3-6 consults → consultation_fee × 1.25; over 7+ → phone-mode
-- days_until_followup × 1.5 (phone filter excludes H4's video clones,
-- whose different base distribution would confound). Median ratios are
-- selection-free: whole-cohort iid scaling moves every quantile by the
-- knob.
SELECT CASE WHEN c.ct BETWEEN 3 AND 6 THEN 'sweet' WHEN c.ct >= 7 THEN 'over' ELSE 'low' END AS grp,
  count(DISTINCT c.uid) AS users, median(e.consultation_fee) AS med_fee
FROM consult_ct c JOIN ev e ON e.uid = c.uid AND e.event = 'consultation completed'
GROUP BY 1 ORDER BY med_fee;

SELECT CASE WHEN c.ct BETWEEN 3 AND 6 THEN 'sweet' WHEN c.ct >= 7 THEN 'over' ELSE 'low' END AS grp,
  count(DISTINCT c.uid) AS users, median(e.days_until_followup) AS med_days
FROM consult_ct c JOIN ev e ON e.uid = c.uid AND e.event = 'follow up scheduled' AND e.consultation_mode = 'phone'
GROUP BY 1 ORDER BY med_days;
