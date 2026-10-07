-- Clearwell Health (healthcare vertical) — story-keyed and eval-keyed DuckDB queries.
--
-- Generate first (repo root):
--   node scripts/verify-runner.mjs dungeons/vertical/healthcare/healthcare.js verify-healthcare
-- Run:
--   duckdb -c ".read dungeons/vertical/healthcare/healthcare.sql"
-- Against a gzipped export:
--   duckdb -c "SET VARIABLE data_prefix='<dir>/healthcare'" -c ".read healthcare.sql"
--
-- All times are UTC. Window: 2026-06-04 00:00 to 2026-10-01 23:59:59.

SET VARIABLE data_prefix = COALESCE(getvariable('data_prefix'), 'data/verify-healthcare');

-- ─────────────────────────────────────────────────────────────────────────
-- PRELUDE: raw files, identity resolution, warehouse tables, visit table
-- ─────────────────────────────────────────────────────────────────────────
-- Identity: a new patient signs up with "account created" (the auth event,
-- which carries user_id and device_id). A device resolves to the patient seen
-- with it on any event that carries both ids, the way Mixpanel stitches.
-- Every Clearwell event carries user_id, so uid = user_id in practice.

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

CREATE OR REPLACE TEMP TABLE wh_staff AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-clinician_staffing_daily.json*', sample_size=-1, union_by_name=true);
CREATE OR REPLACE TEMP TABLE wh_rev AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-visit_revenue_daily.json*', sample_size=-1, union_by_name=true);

-- profile attributes keyed by the resolved patient id
CREATE OR REPLACE TEMP TABLE prof AS
SELECT distinct_id::VARCHAR AS uid, coverage_type, age_band, gender, preferred_language, state, chronic_program,
 device_connectivity, therapy_client, therapist_preference, acquisition_channel, member_since,
 "Experiment: Pickup Reminders" AS variant
FROM users;

-- one row per visit (visit_id is shared by every step of an urgent-care visit
-- or a primary care appointment)
CREATE OR REPLACE TEMP TABLE visits AS
SELECT visit_id, any_value(uid) AS uid,
 CASE WHEN bool_or(event = 'appointment booked') THEN 'primary_care' ELSE 'urgent_care' END AS service_line,
 min(t) FILTER (WHERE event = 'symptom check completed') AS t_check,
 min(t) FILTER (WHERE event = 'visit requested') AS t_req,
 min(t) FILTER (WHERE event = 'appointment booked') AS t_booked,
 min(t) FILTER (WHERE event = 'waiting room left') AS t_left,
 min(t) FILTER (WHERE event = 'appointment missed') AS t_missed,
 min(t) FILTER (WHERE event = 'visit started') AS t_start,
 min(t) FILTER (WHERE event = 'visit completed') AS t_done,
 min(t) FILTER (WHERE event = 'prescription sent') AS t_rx,
 min(t) FILTER (WHERE event = 'prescription picked up') AS t_pick,
 any_value(reason_category) FILTER (WHERE event = 'symptom check completed') AS reason,
 any_value(triage_result) FILTER (WHERE event = 'symptom check completed') AS triage,
 any_value(visit_type) FILTER (WHERE event IN ('visit requested', 'appointment booked')) AS visit_type,
 any_value(estimated_wait_min) FILTER (WHERE event = 'visit requested') AS est_wait,
 any_value(wait_min) FILTER (WHERE event = 'visit started') AS wait_min,
 any_value(lead_days) FILTER (WHERE event = 'appointment booked') AS lead_days,
 any_value(patient_cost_usd) FILTER (WHERE event IN ('visit requested', 'appointment booked')) AS patient_cost,
 any_value(rating) FILTER (WHERE event = 'visit rated') AS rating,
 any_value(coverage_type) AS coverage_type, any_value(preferred_language) AS language,
 any_value(os) FILTER (WHERE os IS NOT NULL) AS os
FROM ev WHERE visit_id IS NOT NULL GROUP BY 1;

-- dataset overview
SELECT count(*) AS events, count(DISTINCT uid) AS patients_with_events, (SELECT count(*) FROM users) AS profiles,
 count(*) FILTER (WHERE event = 'account created') AS new_signups, min(t) AS first_event, max(t) AS last_event FROM ev;

-- identity check: every event resolves to a patient
SELECT count(*) FILTER (WHERE uid IS NULL) AS unresolved_events,
 count(*) FILTER (WHERE device_id IS NULL) AS events_without_device,
 count(*) FILTER (WHERE device_id IS NULL AND event NOT IN ('reminder sent', 'appointment missed', 'coverage added', 'program enrolled')) AS unexpected_without_device
FROM ev;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H1-async-launch — 50% of minor-condition requests async from 2026-07-29 (launch 07-15, 14-day ramp)
-- ─────────────────────────────────────────────────────────────────────────
SELECT CASE WHEN t < TIMESTAMP '2026-07-15' THEN '1 before launch' WHEN t < TIMESTAMP '2026-07-29' THEN '2 ramp' ELSE '3 after ramp' END AS period,
 count(*) AS minor_requests, count(*) FILTER (WHERE visit_type = 'async') AS async_requests,
 round(async_requests::DOUBLE / minor_requests, 4) AS async_share
FROM ev WHERE event = 'visit requested' AND reason_category IN ('urinary', 'skin_rash', 'pink_eye', 'allergy') GROUP BY 1 ORDER BY 1;

SELECT count(*) FILTER (WHERE visit_type = 'async' AND reason_category NOT IN ('urinary', 'skin_rash', 'pink_eye', 'allergy')) AS async_other_reasons,
 count(*) FILTER (WHERE visit_type = 'async' AND t < TIMESTAMP '2026-07-15') AS async_before_launch
FROM ev WHERE event = 'visit requested';

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H2-waiting-room-threshold — start rate 93% up to 10 min, 62% from 20 min
-- ─────────────────────────────────────────────────────────────────────────
-- per request (hold visit_id constant), visit started within 1 day; live visits only
SELECT CASE WHEN est_wait <= 10 THEN '1 <=10 min' WHEN est_wait >= 20 THEN '3 >=20 min' ELSE '2 11-19 min' END AS est_wait_bucket,
 count(*) AS requests, round(avg(coalesce(t_start < t_req + INTERVAL 1 DAY, false)::INT), 4) AS start_rate
FROM visits WHERE t_req IS NOT NULL AND visit_type <> 'async' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H3-urgent-care-staffing-gap — waits ×2.2 while agency hours are 0 (warehouse join)
-- ─────────────────────────────────────────────────────────────────────────
WITH g AS (SELECT DISTINCT date::DATE AS d FROM wh_staff WHERE service_line = 'urgent_care' AND agency_clinician_hours = 0)
SELECT CASE WHEN t::DATE IN (SELECT d FROM g) THEN 'gap days' ELSE 'baseline (14 days either side)' END AS period,
 count(DISTINCT t::DATE) AS days, count(*) AS live_requests, round(avg(estimated_wait_min), 2) AS avg_estimated_wait
FROM ev WHERE event = 'visit requested' AND visit_type <> 'async' AND t >= TIMESTAMP '2026-07-27' AND t < TIMESTAMP '2026-09-07'
GROUP BY 1 ORDER BY 1;

WITH r AS (SELECT t::DATE AS d, count(*) AS requests FROM ev WHERE event = 'visit requested' GROUP BY 1)
SELECT CASE WHEN s.agency_clinician_hours = 0 THEN 'gap days' ELSE 'baseline' END AS period, count(*) AS days,
 min(s.date) AS first_day, max(s.date) AS last_day, round(sum(s.clinician_hours) / sum(r.requests), 4) AS hours_per_request
FROM wh_staff s JOIN r ON r.d = s.date::DATE
WHERE s.service_line = 'urgent_care' AND s.date >= DATE '2026-07-27' AND s.date < DATE '2026-09-07' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H4-pickup-reminders-experiment — pickup ×1.25, time to pickup ×0.7 from 2026-07-28
-- ─────────────────────────────────────────────────────────────────────────
-- per prescription (hold visit_id constant), picked up within 7 days; urgent-care prescriptions Jul 28 - Sep 24
SELECT p.variant, count(DISTINCT v.uid) AS patients, count(*) AS prescriptions,
 round(avg(coalesce(v.t_pick < v.t_rx + INTERVAL 7 DAY, false)::INT), 4) AS pickup_rate_7d,
 round(median(date_diff('second', v.t_rx, v.t_pick) / 3600.0) FILTER (WHERE v.t_pick < v.t_rx + INTERVAL 7 DAY), 2) AS median_hours_to_pickup
FROM visits v JOIN prof p ON p.uid = v.uid
WHERE v.service_line = 'urgent_care' AND v.t_rx >= TIMESTAMP '2026-07-28' AND v.t_rx < TIMESTAMP '2026-09-24 23:59:59' AND p.variant IS NOT NULL
GROUP BY 1 ORDER BY 1;

SELECT "Variant name" AS variant, count(DISTINCT uid) AS exposed_patients, count(*) AS exposures FROM ev WHERE event = '$experiment_started' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H5-bluetooth-cuff-lapse — 40% of bluetooth patients stop logging by 2026-09-02
-- ─────────────────────────────────────────────────────────────────────────
WITH early AS (SELECT DISTINCT uid FROM ev WHERE event = 'reading logged' AND t < TIMESTAMP '2026-06-18'),
late AS (SELECT DISTINCT uid FROM ev WHERE event = 'reading logged' AND t >= TIMESTAMP '2026-09-03')
SELECT p.device_connectivity, count(*) AS early_patients, count(late.uid) AS still_logging_sep3_oct1,
 round(count(late.uid)::DOUBLE / count(*), 4) AS retained
FROM early JOIN prof p ON p.uid = early.uid LEFT JOIN late ON late.uid = early.uid GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H6-no-shows-by-lead-time — P(missed) = 0.05 + 0.012 × lead_days
-- ─────────────────────────────────────────────────────────────────────────
-- per appointment (hold visit_id constant), bookings Jun 4 - Aug 31
SELECT CASE WHEN lead_days <= 1 THEN '1 0-1 days' WHEN lead_days <= 7 THEN '2 2-7 days' ELSE '3 8+ days' END AS lead_bucket,
 count(*) AS appointments, round(avg((t_missed IS NOT NULL)::INT), 4) AS no_show_rate
FROM visits WHERE service_line = 'primary_care' AND t_booked < TIMESTAMP '2026-09-01' GROUP BY 1 ORDER BY 1;

SELECT round(regr_slope((t_missed IS NOT NULL)::INT, lead_days), 5) AS no_show_slope_per_day,
 round(regr_intercept((t_missed IS NOT NULL)::INT, lead_days), 4) AS no_show_intercept
FROM visits WHERE service_line = 'primary_care' AND t_booked < TIMESTAMP '2026-09-01';

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H7-therapist-choice-wait — first session 2.5x later for specific_therapist (median 96 h otherwise)
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE TEMP TABLE therapy_starts AS
WITH i AS (SELECT uid, min(t) AS t0, arg_min(therapist_preference, t) AS pref, arg_min(primary_concern, t) AS concern FROM ev WHERE event = 'therapy intake completed' GROUP BY 1)
SELECT i.uid, i.t0, i.pref, i.concern,
 min(e.t) FILTER (WHERE e.t > i.t0 AND e.t < i.t0 + INTERVAL 30 DAY) AS t_first_session
FROM i LEFT JOIN ev e ON e.uid = i.uid AND e.event = 'therapy session completed' GROUP BY 1, 2, 3, 4;

SELECT pref AS therapist_preference, count(*) AS intakes, count(t_first_session) AS first_session_30d,
 round(count(t_first_session)::DOUBLE / count(*), 4) AS conversion_30d,
 round(median(date_diff('second', t0, t_first_session) / 3600.0), 1) AS median_hours_to_first_session
FROM therapy_starts WHERE t0 < TIMESTAMP '2026-09-01' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H8-self-pay-price-cut — self-pay requests per symptom check ×1.35 from 2026-08-31 (warehouse join)
-- ─────────────────────────────────────────────────────────────────────────
SELECT CASE WHEN t >= TIMESTAMP '2026-08-31' THEN '2 after' ELSE '1 before' END AS period,
 CASE WHEN coverage_type = 'self_pay' THEN 'self_pay' ELSE 'insured' END AS coverage,
 count(*) FILTER (WHERE event = 'symptom check completed') AS symptom_checks,
 count(*) FILTER (WHERE event = 'visit requested') AS requests,
 round(requests::DOUBLE / symptom_checks, 4) AS requests_per_check
FROM ev WHERE event IN ('symptom check completed', 'visit requested') GROUP BY 1, 2 ORDER BY 2, 1;

WITH c AS (SELECT CASE WHEN t >= TIMESTAMP '2026-08-31' THEN '2 after' ELSE '1 before' END AS period, count(*) AS checks
  FROM ev WHERE event = 'symptom check completed' AND coverage_type = 'self_pay' GROUP BY 1),
r AS (SELECT CASE WHEN date >= DATE '2026-08-31' THEN '2 after' ELSE '1 before' END AS period, sum(visits_billed) AS visits_billed,
  sum(patient_revenue_usd) AS revenue, avg(avg_patient_charge_usd) AS price
  FROM wh_rev WHERE service_line = 'urgent_care' AND coverage_type = 'self_pay' GROUP BY 1)
SELECT c.period, c.checks, r.visits_billed, round(r.price, 2) AS list_price, round(r.revenue, 0) AS revenue_usd,
 round(r.revenue / c.checks, 2) AS revenue_per_self_pay_check
FROM c JOIN r ON r.period = c.period ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H9-respiratory-season — respiratory / other symptom checks ×2.5 from 2026-09-21 (ramp from 09-14)
-- ─────────────────────────────────────────────────────────────────────────
SELECT CASE WHEN t >= TIMESTAMP '2026-09-21' THEN '3 Sep 21 - Oct 1' WHEN t >= TIMESTAMP '2026-09-14' THEN '2 Sep 14-20' ELSE '1 Jun 4 - Sep 13' END AS period,
 count(*) FILTER (WHERE reason_category = 'respiratory') AS respiratory_checks,
 count(*) FILTER (WHERE reason_category <> 'respiratory') AS other_checks,
 round(respiratory_checks::DOUBLE / other_checks, 4) AS respiratory_per_other
FROM ev WHERE event = 'symptom check completed' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H10-spanish-wait-gap — Spanish-preferring patients' estimated waits ×1.6
-- ─────────────────────────────────────────────────────────────────────────
SELECT preferred_language, count(DISTINCT uid) AS patients, count(*) AS live_requests,
 round(avg(estimated_wait_min), 2) AS avg_estimated_wait, median(estimated_wait_min) AS median_estimated_wait
FROM ev WHERE event = 'visit requested' AND visit_type <> 'async' GROUP BY 1 ORDER BY 1;

-- ═════════════════════════════════════════════════════════════════════════
-- EVAL QUERIES (eval/healthcare.eval.md)
-- ═════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q1 — Clearwell Async adoption
-- ─────────────────────────────────────────────────────────────────────────
SELECT date_trunc('week', t)::DATE AS week_start, count(*) AS minor_requests,
 count(*) FILTER (WHERE visit_type = 'async') AS async_requests, round(async_requests::DOUBLE / minor_requests, 3) AS async_share
FROM ev WHERE event = 'visit requested' AND reason_category IN ('urinary', 'skin_rash', 'pink_eye', 'allergy') AND t >= TIMESTAMP '2026-07-06'
GROUP BY 1 ORDER BY 1;

SELECT round(avg((visit_type = 'async')::INT), 4) AS async_share_of_all_urgent_requests_after_ramp
FROM ev WHERE event = 'visit requested' AND t >= TIMESTAMP '2026-07-29';

SELECT count(*) AS async_visits_completed, count(DISTINCT uid) AS async_patients,
 round(median(date_diff('second', t_req, t_done) / 3600.0), 2) AS median_hours_request_to_done,
 round(avg((t_left IS NOT NULL)::INT), 4) AS async_abandon_rate
FROM visits WHERE visit_type = 'async';

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q2 — how long patients wait before giving up
-- ─────────────────────────────────────────────────────────────────────────
SELECT CASE WHEN est_wait <= 5 THEN '1 1-5' WHEN est_wait <= 10 THEN '2 6-10' WHEN est_wait <= 15 THEN '3 11-15'
  WHEN est_wait < 20 THEN '4 16-19' WHEN est_wait <= 30 THEN '5 20-30' ELSE '6 31+' END AS est_wait_min,
 count(*) AS live_requests, round(avg(coalesce(t_start < t_req + INTERVAL 1 DAY, false)::INT), 4) AS start_rate,
 round(avg((t_left IS NOT NULL)::INT), 4) AS left_waiting_room
FROM visits WHERE t_req IS NOT NULL AND visit_type <> 'async' GROUP BY 1 ORDER BY 1;

SELECT count(*) AS live_requests, round(avg((t_left IS NOT NULL)::INT), 4) AS abandon_rate,
 round(median(est_wait), 1) AS median_est_wait,
 (SELECT round(median(minutes_waited), 1) FROM ev WHERE event = 'waiting room left') AS median_minutes_before_leaving
FROM visits WHERE t_req IS NOT NULL AND visit_type <> 'async';

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q3 — the mid-August dip in completed urgent-care visits (warehouse join)
-- ─────────────────────────────────────────────────────────────────────────
WITH s AS (SELECT date::DATE AS d, clinician_hours, agency_clinician_hours FROM wh_staff WHERE service_line = 'urgent_care')
SELECT date_trunc('week', v.t_req)::DATE AS week_start, count(*) AS live_requests,
 count(v.t_start) AS live_visits_started, round(count(v.t_start)::DOUBLE / count(*), 4) AS start_rate,
 round(avg(v.est_wait), 1) AS avg_est_wait,
 round(sum(DISTINCT s.agency_clinician_hours), 0) AS agency_hours_week_approx
FROM visits v LEFT JOIN s ON s.d = v.t_req::DATE
WHERE v.t_req >= TIMESTAMP '2026-07-20' AND v.t_req < TIMESTAMP '2026-09-14' AND v.visit_type <> 'async' GROUP BY 1 ORDER BY 1;

SELECT min(date) AS first_zero_agency_day, max(date) AS last_zero_agency_day, count(*) AS days,
 round(avg(clinician_hours), 1) AS avg_clinician_hours_gap,
 (SELECT round(avg(clinician_hours), 1) FROM wh_staff WHERE service_line = 'urgent_care' AND agency_clinician_hours > 0 AND date BETWEEN DATE '2026-07-27' AND DATE '2026-09-06') AS avg_clinician_hours_baseline,
 (SELECT round(avg(agency_clinician_hours / clinician_hours), 3) FROM wh_staff WHERE service_line = 'urgent_care' AND agency_clinician_hours > 0) AS normal_agency_share
FROM wh_staff WHERE service_line = 'urgent_care' AND agency_clinician_hours = 0;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q4 — Pickup Reminders: ship it?  (same read as STORY H4, plus reminders sent)
-- ─────────────────────────────────────────────────────────────────────────
SELECT p.variant, count(*) AS prescriptions,
 round(avg(coalesce(v.t_pick < v.t_rx + INTERVAL 7 DAY, false)::INT), 4) AS pickup_rate_7d,
 round(median(date_diff('second', v.t_rx, v.t_pick) / 3600.0) FILTER (WHERE v.t_pick < v.t_rx + INTERVAL 7 DAY), 2) AS median_hours_to_pickup
FROM visits v JOIN prof p ON p.uid = v.uid
WHERE v.service_line = 'urgent_care' AND v.t_rx >= TIMESTAMP '2026-07-28' AND v.t_rx < TIMESTAMP '2026-09-24 23:59:59' AND p.variant IS NOT NULL
GROUP BY 1 ORDER BY 1;

SELECT count(*) AS pickup_reminders_sent, count(DISTINCT uid) AS patients_reminded FROM ev WHERE event = 'reminder sent' AND reminder_type = 'rx_pickup';

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q5 — remote monitoring engagement by device  (same read as STORY H5, plus program size)
-- ─────────────────────────────────────────────────────────────────────────
WITH early AS (SELECT DISTINCT uid FROM ev WHERE event = 'reading logged' AND t < TIMESTAMP '2026-06-18'),
late AS (SELECT DISTINCT uid FROM ev WHERE event = 'reading logged' AND t >= TIMESTAMP '2026-09-03')
SELECT p.device_connectivity, count(*) AS early_patients, round(count(late.uid)::DOUBLE / count(*), 4) AS still_logging_sep3_oct1
FROM early JOIN prof p ON p.uid = early.uid LEFT JOIN late ON late.uid = early.uid GROUP BY 1
UNION ALL
SELECT 'all', count(*), round(count(late.uid)::DOUBLE / count(*), 4) FROM early LEFT JOIN late ON late.uid = early.uid ORDER BY 1;

SELECT chronic_program, device_connectivity, count(*) AS program_patients FROM prof WHERE chronic_program <> 'none' GROUP BY 1, 2 ORDER BY 1, 2;

WITH early AS (SELECT DISTINCT uid FROM ev WHERE event = 'reading logged' AND t < TIMESTAMP '2026-06-18'),
late AS (SELECT DISTINCT uid FROM ev WHERE event = 'reading logged' AND t >= TIMESTAMP '2026-09-03')
SELECT p.chronic_program, p.device_connectivity, count(*) AS early_patients, round(count(late.uid)::DOUBLE / count(*), 4) AS still_logging_sep3_oct1
FROM early JOIN prof p ON p.uid = early.uid LEFT JOIN late ON late.uid = early.uid GROUP BY 1, 2 ORDER BY 1, 2;

SELECT date_trunc('month', t)::DATE AS month, p.device_connectivity, count(DISTINCT e.uid) AS patients_logging, count(*) AS readings
FROM ev e JOIN prof p ON p.uid = e.uid WHERE event = 'reading logged' GROUP BY 1, 2 ORDER BY 1, 2;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q6 — primary care no-shows  (same read as STORY H6, finer buckets)
-- ─────────────────────────────────────────────────────────────────────────
SELECT CASE WHEN lead_days <= 1 THEN '1 0-1' WHEN lead_days <= 3 THEN '2 2-3' WHEN lead_days <= 7 THEN '3 4-7' WHEN lead_days <= 14 THEN '4 8-14' ELSE '5 15-21' END AS lead_days,
 count(*) AS appointments, round(avg((t_missed IS NOT NULL)::INT), 4) AS no_show_rate
FROM visits WHERE service_line = 'primary_care' AND t_booked < TIMESTAMP '2026-09-01' GROUP BY 1 ORDER BY 1;

SELECT count(*) AS appointments, round(avg((t_missed IS NOT NULL)::INT), 4) AS overall_no_show_rate,
 round(avg(lead_days), 2) AS avg_lead_days
FROM visits WHERE service_line = 'primary_care' AND t_booked < TIMESTAMP '2026-09-01';

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q7 — time to first therapy session  (same read as STORY H7, in days)
-- ─────────────────────────────────────────────────────────────────────────
SELECT pref AS therapist_preference, count(*) AS intakes, round(count(t_first_session)::DOUBLE / count(*), 4) AS first_session_within_30d,
 round(median(date_diff('second', t0, t_first_session) / 86400.0), 2) AS median_days_to_first_session
FROM therapy_starts WHERE t0 < TIMESTAMP '2026-09-01' GROUP BY 1
UNION ALL
SELECT 'all', count(*), round(count(t_first_session)::DOUBLE / count(*), 4), round(median(date_diff('second', t0, t_first_session) / 86400.0), 2)
FROM therapy_starts WHERE t0 < TIMESTAMP '2026-09-01' ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q8 — did the self-pay price cut work? (warehouse join)
-- ─────────────────────────────────────────────────────────────────────────
WITH c AS (SELECT CASE WHEN t >= TIMESTAMP '2026-08-31' THEN '2 Aug 31 - Oct 1' ELSE '1 Jun 4 - Aug 30' END AS period,
  count(*) FILTER (WHERE event = 'symptom check completed') AS checks, count(*) FILTER (WHERE event = 'visit requested') AS requests,
  count(DISTINCT t::DATE) AS days
  FROM ev WHERE coverage_type = 'self_pay' AND event IN ('symptom check completed', 'visit requested') GROUP BY 1),
r AS (SELECT CASE WHEN date >= DATE '2026-08-31' THEN '2 Aug 31 - Oct 1' ELSE '1 Jun 4 - Aug 30' END AS period,
  sum(visits_billed) AS visits_billed, sum(patient_revenue_usd) AS revenue
  FROM wh_rev WHERE service_line = 'urgent_care' AND coverage_type = 'self_pay' GROUP BY 1)
SELECT c.period, c.days, c.checks, c.requests, round(c.requests::DOUBLE / c.checks, 4) AS requests_per_check,
 round(c.requests::DOUBLE / c.days, 1) AS requests_per_day, r.visits_billed, round(r.visits_billed::DOUBLE / c.days, 1) AS billed_visits_per_day,
 round(r.revenue, 0) AS revenue_usd, round(r.revenue / c.days, 0) AS revenue_per_day, round(r.revenue / c.checks, 2) AS revenue_per_check
FROM c JOIN r ON r.period = c.period ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q9 — respiratory season
-- ─────────────────────────────────────────────────────────────────────────
SELECT date_trunc('week', t)::DATE AS week_start, count(*) FILTER (WHERE reason_category = 'respiratory') AS respiratory_checks,
 count(*) FILTER (WHERE reason_category <> 'respiratory') AS other_checks,
 round(respiratory_checks::DOUBLE / count(*), 4) AS respiratory_share
FROM ev WHERE event = 'symptom check completed' AND t >= TIMESTAMP '2026-08-03' GROUP BY 1 ORDER BY 1;

SELECT CASE WHEN t >= TIMESTAMP '2026-09-21' THEN '2 Sep 21 - Oct 1' ELSE '1 Jun 4 - Sep 13' END AS period,
 round(count(*) FILTER (WHERE reason_category = 'respiratory')::DOUBLE / count(DISTINCT t::DATE), 1) AS respiratory_checks_per_day,
 round(count(*) FILTER (WHERE reason_category <> 'respiratory')::DOUBLE / count(DISTINCT t::DATE), 1) AS other_checks_per_day,
 round(count(*) FILTER (WHERE reason_category = 'respiratory')::DOUBLE / count(*), 4) AS respiratory_share
FROM ev WHERE event = 'symptom check completed' AND (t < TIMESTAMP '2026-09-14' OR t >= TIMESTAMP '2026-09-21') GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q10 — Spanish-speaking patients' urgent-care experience (warehouse join)
-- ─────────────────────────────────────────────────────────────────────────
SELECT language, count(*) AS live_requests, round(avg(est_wait), 2) AS avg_est_wait, median(est_wait) AS median_est_wait,
 round(avg(coalesce(t_start < t_req + INTERVAL 1 DAY, false)::INT), 4) AS start_rate,
 round(avg((t_left IS NOT NULL)::INT), 4) AS left_waiting_room
FROM visits WHERE t_req IS NOT NULL AND visit_type <> 'async' GROUP BY 1 ORDER BY 1;

SELECT round(sum(spanish_speaking_clinician_hours) / sum(clinician_hours), 4) AS spanish_share_of_urgent_hours,
 (SELECT round(avg((preferred_language = 'es')::INT), 4) FROM ev WHERE event = 'visit requested' AND visit_type <> 'async') AS spanish_share_of_live_requests,
 (SELECT round(avg((preferred_language = 'es')::INT), 4) FROM prof) AS spanish_share_of_patients
FROM wh_staff WHERE service_line = 'urgent_care';

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q11 — visits lost to the August staffing gap (warehouse join)
-- ─────────────────────────────────────────────────────────────────────────
WITH g AS (SELECT DISTINCT date::DATE AS d FROM wh_staff WHERE service_line = 'urgent_care' AND agency_clinician_hours = 0),
w AS (SELECT (t_req::DATE IN (SELECT d FROM g)) AS gap, (t_start IS NOT NULL)::INT AS started
  FROM visits WHERE t_req >= TIMESTAMP '2026-07-27' AND t_req < TIMESTAMP '2026-09-07' AND visit_type <> 'async'),
s AS (SELECT gap, count(*) AS requests, avg(started) AS start_rate FROM w GROUP BY 1),
x AS (SELECT gs.requests AS gap_live_requests, gs.start_rate AS gap_start_rate, bs.start_rate AS baseline_start_rate,
  gs.requests * (bs.start_rate - gs.start_rate) AS visits_lost
  FROM s gs, s bs WHERE gs.gap AND NOT bs.gap),
r AS (SELECT sum(total_revenue_usd) / sum(visits_billed) AS revenue_per_billed_urgent_visit FROM wh_rev WHERE service_line = 'urgent_care')
SELECT x.gap_live_requests, round(x.gap_start_rate, 4) AS gap_start_rate, round(x.baseline_start_rate, 4) AS baseline_start_rate,
 round(x.visits_lost, 0) AS visits_lost,
 (SELECT count(*) FROM ev WHERE event = 'waiting room left' AND t::DATE IN (SELECT d FROM g)) AS waiting_room_exits_gap,
 round(r.revenue_per_billed_urgent_visit, 2) AS revenue_per_billed_urgent_visit,
 round(x.visits_lost * r.revenue_per_billed_urgent_visit, 0) AS revenue_lost_usd
FROM x, r;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q12 — revenue by service line and coverage, by month (warehouse)
-- ─────────────────────────────────────────────────────────────────────────
SELECT date_trunc('month', date)::DATE AS month, round(sum(total_revenue_usd), 0) AS total_revenue_usd,
 round(sum(patient_revenue_usd), 0) AS patient_revenue_usd, round(sum(payer_revenue_usd), 0) AS payer_revenue_usd, sum(visits_billed) AS visits_billed
FROM wh_rev GROUP BY 1 ORDER BY 1;

SELECT service_line, coverage_type, sum(visits_billed) AS visits_billed, round(sum(total_revenue_usd), 0) AS revenue_usd,
 round(sum(total_revenue_usd) / nullif(sum(visits_billed), 0), 2) AS revenue_per_visit
FROM wh_rev WHERE date >= DATE '2026-09-01' AND date <= DATE '2026-09-30' GROUP BY 1, 2 ORDER BY 1, 2;

SELECT service_line, round(sum(total_revenue_usd), 0) AS sept_revenue_usd, sum(visits_billed) AS sept_visits_billed
FROM wh_rev WHERE date >= DATE '2026-09-01' AND date <= DATE '2026-09-30' GROUP BY 1
UNION ALL SELECT 'all', round(sum(total_revenue_usd), 0), sum(visits_billed) FROM wh_rev WHERE date >= DATE '2026-09-01' AND date <= DATE '2026-09-30' ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q13 — did Async raise completed visits for minor conditions?
-- ─────────────────────────────────────────────────────────────────────────
SELECT CASE WHEN t_req < TIMESTAMP '2026-07-15' THEN '1 before launch' WHEN t_req >= TIMESTAMP '2026-07-29' THEN '3 after ramp' ELSE '2 ramp' END AS period,
 CASE WHEN reason IN ('urinary', 'skin_rash', 'pink_eye', 'allergy') THEN 'minor' ELSE 'other' END AS reason_group,
 count(*) AS requests, round(avg(coalesce(t_done < t_req + INTERVAL 1 DAY, false)::INT), 4) AS completed_within_1d
FROM visits WHERE t_req IS NOT NULL AND service_line = 'urgent_care' GROUP BY 1, 2 ORDER BY 2, 1;

SELECT visit_type, count(*) AS minor_requests_after_ramp, round(avg(coalesce(t_done < t_req + INTERVAL 1 DAY, false)::INT), 4) AS completed_within_1d,
 round(median(date_diff('second', t_req, t_done) / 60.0), 1) AS median_minutes_to_done
FROM visits WHERE t_req >= TIMESTAMP '2026-07-29' AND reason IN ('urinary', 'skin_rash', 'pink_eye', 'allergy') GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q14 — are patients less satisfied with Async visits? (null)
-- ─────────────────────────────────────────────────────────────────────────
-- urgent-care visits requested from the Async launch (Jul 15) with a rating
WITH r AS (SELECT CASE WHEN visit_type = 'async' THEN 'async' ELSE 'live (video/phone)' END AS kind,
  reason IN ('urinary', 'skin_rash', 'pink_eye', 'allergy') AS minor, rating
  FROM visits WHERE service_line = 'urgent_care' AND rating IS NOT NULL AND t_req >= TIMESTAMP '2026-07-15')
SELECT 'all urgent' AS scope, kind, count(*) AS ratings, round(avg(rating), 3) AS avg_rating, round(stddev(rating), 3) AS sd,
 round(avg((rating >= 4)::INT), 4) AS share_4_5 FROM r GROUP BY 2
UNION ALL
SELECT 'minor reasons only', kind, count(*), round(avg(rating), 3), round(stddev(rating), 3), round(avg((rating >= 4)::INT), 4) FROM r WHERE minor GROUP BY 2
ORDER BY 1, 2;

WITH r AS (SELECT (visit_type = 'async') AS is_async, rating FROM visits WHERE service_line = 'urgent_care' AND rating IS NOT NULL AND t_req >= TIMESTAMP '2026-07-15'),
s AS (SELECT is_async, count(*) AS n, avg(rating) AS m, var_samp(rating) AS v FROM r GROUP BY 1)
SELECT round((a.m - l.m) / sqrt(a.v / a.n + l.v / l.n), 2) AS z_avg_rating
FROM s a, s l WHERE a.is_async AND NOT l.is_async;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q15 — did the self-pay price cut change insured patients' requests? (null)
-- ─────────────────────────────────────────────────────────────────────────
WITH w AS (SELECT coverage_type, CASE WHEN t >= TIMESTAMP '2026-08-31' THEN '2 after' ELSE '1 before' END AS period, event
  FROM ev WHERE event IN ('symptom check completed', 'visit requested') AND coverage_type <> 'self_pay')
SELECT coalesce(coverage_type, 'all insured') AS coverage_type, period, count(*) FILTER (WHERE event = 'symptom check completed') AS checks,
 round(count(*) FILTER (WHERE event = 'visit requested')::DOUBLE / count(*) FILTER (WHERE event = 'symptom check completed'), 4) AS requests_per_check
FROM w GROUP BY GROUPING SETS ((coverage_type, period), (period)) ORDER BY 1, 2;

WITH w AS (SELECT CASE WHEN t >= TIMESTAMP '2026-08-31' THEN 'after' ELSE 'before' END AS period, event
  FROM ev WHERE event IN ('symptom check completed', 'visit requested') AND coverage_type <> 'self_pay'),
s AS (SELECT period, count(*) FILTER (WHERE event = 'symptom check completed') AS n,
  count(*) FILTER (WHERE event = 'visit requested')::DOUBLE / count(*) FILTER (WHERE event = 'symptom check completed') AS p FROM w GROUP BY 1)
SELECT round((a.p - b.p) / sqrt(a.p * (1 - a.p) / a.n + b.p * (1 - b.p) / b.n), 2) AS z_after_vs_before
FROM s a, s b WHERE a.period = 'after' AND b.period = 'before';

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q16 — revenue per completed urgent-care visit by coverage (warehouse + business model)
-- ─────────────────────────────────────────────────────────────────────────
SELECT coverage_type, sum(visits_billed) AS visits_billed, round(sum(patient_revenue_usd) / sum(visits_billed), 2) AS patient_rev_per_visit,
 round(sum(payer_revenue_usd) / sum(visits_billed), 2) AS payer_rev_per_visit, round(sum(total_revenue_usd) / sum(visits_billed), 2) AS total_rev_per_visit,
 round(sum(visits_billed)::DOUBLE / (SELECT sum(visits_billed) FROM wh_rev WHERE service_line = 'urgent_care'), 4) AS share_of_visits
FROM wh_rev WHERE service_line = 'urgent_care' GROUP BY 1 ORDER BY 1;

SELECT coverage_type, count(*) AS patients FROM prof GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q17 — when urgent-care demand peaks (day of week, hour, UTC)
-- ─────────────────────────────────────────────────────────────────────────
WITH d AS (SELECT t::DATE AS day, dayname(t) AS dow, count(*) AS n FROM ev WHERE event = 'visit requested' GROUP BY 1, 2)
SELECT dow, count(*) AS days, round(avg(n), 1) AS avg_requests_per_day, round(avg(n) / (SELECT avg(n) FROM d), 3) AS index_vs_avg_day
FROM d GROUP BY 1 ORDER BY index_vs_avg_day DESC;

SELECT extract(hour FROM t) AS hour_utc, count(*) AS requests, round(count(*)::DOUBLE / (SELECT count(*) FROM ev WHERE event = 'visit requested') * 24, 3) AS index_vs_avg_hour
FROM ev WHERE event = 'visit requested' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q18 — patients served and visits by month
-- ─────────────────────────────────────────────────────────────────────────
SELECT date_trunc('month', t)::DATE AS month, count(DISTINCT t::DATE) AS days,
 count(DISTINCT uid) FILTER (WHERE event IN ('visit completed', 'therapy session completed')) AS patients_with_a_visit,
 count(*) FILTER (WHERE event = 'visit completed' AND service_line = 'urgent_care') AS urgent_visits,
 count(*) FILTER (WHERE event = 'visit completed' AND service_line = 'primary_care') AS primary_visits,
 count(*) FILTER (WHERE event = 'therapy session completed') AS therapy_sessions,
 count(*) FILTER (WHERE event = 'account created') AS new_patients,
 count(DISTINCT uid) FILTER (WHERE event NOT IN ('reminder sent', 'appointment missed')) AS active_patients
FROM ev GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q19 — open-ended: what to worry about (summary of the reads above)
-- ─────────────────────────────────────────────────────────────────────────
SELECT 'urgent start rate, live' AS metric, round(avg(coalesce(t_start < t_req + INTERVAL 1 DAY, false)::INT), 4) AS value FROM visits WHERE t_req IS NOT NULL AND visit_type <> 'async'
UNION ALL SELECT 'urgent start rate, live, Spanish', round(avg(coalesce(t_start < t_req + INTERVAL 1 DAY, false)::INT), 4) FROM visits WHERE t_req IS NOT NULL AND visit_type <> 'async' AND language = 'es'
UNION ALL SELECT 'urgent start rate, live, Sep 21 - Oct 1', round(avg(coalesce(t_start < t_req + INTERVAL 1 DAY, false)::INT), 4) FROM visits WHERE t_req >= TIMESTAMP '2026-09-21' AND visit_type <> 'async'
UNION ALL SELECT 'avg est wait, live, Sep 21 - Oct 1', round(avg(est_wait), 2) FROM visits WHERE t_req >= TIMESTAMP '2026-09-21' AND visit_type <> 'async'
UNION ALL SELECT 'urgent requests per day, Sep 21 - Oct 1', round(count(*) / 11.0, 1) FROM visits WHERE t_req >= TIMESTAMP '2026-09-21'
UNION ALL SELECT 'urgent requests per day, Aug 24 - Sep 13', round(count(*) / 21.0, 1) FROM visits WHERE t_req >= TIMESTAMP '2026-08-24' AND t_req < TIMESTAMP '2026-09-14'
UNION ALL SELECT 'urgent clinician hours per day, Sep 21 - Oct 1', round(avg(clinician_hours), 1) FROM wh_staff WHERE service_line = 'urgent_care' AND date >= DATE '2026-09-21'
UNION ALL SELECT 'urgent clinician hours per day, Aug 24 - Sep 13', round(avg(clinician_hours), 1) FROM wh_staff WHERE service_line = 'urgent_care' AND date >= DATE '2026-08-24' AND date < DATE '2026-09-14';

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q20 — open-ended: where to add clinical capacity (Spanish pool, agency cover)
-- ─────────────────────────────────────────────────────────────────────────
SELECT language, count(*) AS live_requests_sept, count(t_left) AS waiting_room_exits_sept,
 round(avg((t_left IS NOT NULL)::INT), 4) AS exit_rate_sept, round(avg(est_wait), 1) AS avg_est_wait_sept
FROM visits WHERE t_req >= TIMESTAMP '2026-09-01' AND t_req < TIMESTAMP '2026-10-01' AND visit_type <> 'async' GROUP BY 1 ORDER BY 1;
