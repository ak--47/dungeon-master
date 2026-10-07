-- Reelhouse (streaming vertical) — story-keyed and eval-keyed DuckDB queries.
--
-- Generate first (repo root):
--   node scripts/verify-runner.mjs dungeons/vertical/streaming/streaming.js verify-streaming
-- Run:
--   duckdb -c ".read dungeons/vertical/streaming/streaming.sql"
-- Against a gzipped export:
--   duckdb -c "SET VARIABLE data_prefix='<dir>/streaming'" -c ".read streaming.sql"
--
-- All times are UTC. Window: 2026-06-04 00:00 to 2026-10-01 23:59:59.

SET VARIABLE data_prefix = COALESCE(getvariable('data_prefix'), 'data/verify-streaming');

-- ─────────────────────────────────────────────────────────────────────────
-- PRELUDE: raw files, identity resolution, warehouse tables
-- ─────────────────────────────────────────────────────────────────────────
-- Identity: a new household signs up with "account created" (the auth event,
-- which carries user_id and device_id). A device resolves to the household
-- seen with it on any event that carries both ids, the way Mixpanel stitches.
-- Every Reelhouse event carries user_id, so uid = user_id in practice.

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

CREATE OR REPLACE TEMP TABLE wh_spend AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-marketing_spend_daily.json*', sample_size=-1, union_by_name=true);
CREATE OR REPLACE TEMP TABLE wh_qos AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-playback_qos_daily.json*', sample_size=-1, union_by_name=true);
CREATE OR REPLACE TEMP TABLE wh_billing AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-subscription_billing_daily.json*', sample_size=-1, union_by_name=true);

-- profile attributes keyed by the resolved household id
CREATE OR REPLACE TEMP TABLE prof AS
SELECT distinct_id::VARCHAR AS uid, plan AS current_plan, subscription_status, acquisition_channel, profile_count,
 has_kids_profile, country, member_since, "Experiment: Smart Start" AS variant
FROM users;

-- one row per trial started in the window: signup, early completions (first 72 h),
-- converted within 8 days (a trial converts at exactly day 7)
CREATE OR REPLACE TEMP TABLE trials AS
WITH ts AS (SELECT uid, min(t) AS t0, any_value(plan) AS plan FROM ev WHERE event = 'trial started' GROUP BY 1),
sg AS (SELECT uid, min(t) AS signup_t, any_value(platform) AS signup_platform, any_value(signup_method) AS signup_method FROM ev WHERE event = 'account created' GROUP BY 1),
cv AS (SELECT uid, min(t) AS tc FROM ev WHERE event = 'trial converted' GROUP BY 1),
kc AS (SELECT ts.uid, count(e.uid) AS k FROM ts LEFT JOIN ev e ON e.uid = ts.uid AND e.event = 'playback completed'
  AND e.t >= ts.t0 AND e.t < ts.t0 + INTERVAL 72 HOUR GROUP BY 1)
SELECT ts.uid, ts.t0, ts.plan, sg.signup_t, sg.signup_platform, sg.signup_method, kc.k, p.acquisition_channel, p.variant, p.country, p.profile_count,
 coalesce(cv.tc >= ts.t0 AND cv.tc < ts.t0 + INTERVAL 8 DAY, false) AS conv,
 ts.t0 < TIMESTAMP '2026-09-24 00:00:00' AS full_window
FROM ts JOIN sg USING (uid) JOIN kc USING (uid) LEFT JOIN cv USING (uid) LEFT JOIN prof p USING (uid);

-- dataset overview
SELECT count(*) AS events, count(DISTINCT uid) AS households_with_events, (SELECT count(*) FROM users) AS profiles,
 (SELECT count(*) FROM ev WHERE event = 'account created') AS new_accounts, (SELECT count(*) FROM trials) AS trials_started,
 min(t) AS first_event, max(t) AS last_event FROM ev;

-- identity check: every event resolves to a household; each device has one platform
SELECT count(*) FILTER (WHERE uid IS NULL) AS unresolved_events,
 count(*) FILTER (WHERE device_id IS NULL) AS events_without_device,
 (SELECT count(*) FROM (SELECT device_id FROM ev WHERE device_id IS NOT NULL GROUP BY 1 HAVING count(DISTINCT platform) > 1)) AS devices_with_two_platforms
FROM ev;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H1-saltmarsh-season-2-premiere
-- ─────────────────────────────────────────────────────────────────────────
-- Season 2 reach among households that joined before the premiere and played
-- anything Jul 17-30 (target 0.35), and season 2 plays before the premiere (0).
WITH a AS (SELECT DISTINCT ev.uid FROM ev JOIN prof p USING (uid)
  WHERE event = 'playback started' AND t >= '2026-07-17' AND t < '2026-07-31' AND p.member_since < '2026-07-17'),
s AS (SELECT DISTINCT uid FROM ev WHERE event = 'playback started' AND title_name = 'Saltmarsh' AND season_number = 2
  AND t >= '2026-07-17' AND t < '2026-07-31')
SELECT count(*) AS active_members, count(s.uid) AS season2_viewers, round(count(s.uid) / count(*), 4) AS reach,
 (SELECT count(*) FROM ev WHERE title_name = 'Saltmarsh' AND season_number = 2 AND t < '2026-07-17') AS season2_plays_before_premiere
FROM a LEFT JOIN s USING (uid);

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H2-premiere-tourists
-- ─────────────────────────────────────────────────────────────────────────
-- Trial conversion (8-day window), trials Jul 8 - Sep 23: accounts created
-- Jul 17 - Aug 6 vs every other account (target ratio 0.60).
WITH g AS (SELECT CASE WHEN signup_t >= '2026-07-17' AND signup_t < '2026-08-07' THEN 'premiere' ELSE 'other' END AS grp,
  count(*) AS trials, avg(conv::INT) AS conv FROM trials WHERE full_window AND t0 >= '2026-07-08' GROUP BY 1)
SELECT grp, trials, round(conv, 4) AS conv, round(conv / (SELECT conv FROM g WHERE grp = 'other'), 4) AS ratio_vs_other FROM g ORDER BY grp DESC;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H3-smart-start-experiment
-- ─────────────────────────────────────────────────────────────────────────
-- Trial conversion by arm (target 1.20), variant share (0.50), exposures before
-- Jul 8 (0).
WITH g AS (SELECT variant, count(*) AS trials, avg(conv::INT) AS conv, avg(k) AS early_completions
  FROM trials WHERE full_window AND t0 >= '2026-07-08' AND variant IS NOT NULL GROUP BY 1)
SELECT variant, trials, round(conv, 4) AS conv, round(early_completions, 3) AS early_completions,
 round(conv / (SELECT conv FROM g WHERE variant = 'Control'), 4) AS lift_vs_control FROM g ORDER BY variant;
SELECT count(DISTINCT uid) AS exposed, round(count(DISTINCT uid) FILTER (WHERE "Variant name" = 'Smart Start') / count(DISTINCT uid), 4) AS variant_share,
 count(*) FILTER (WHERE t < '2026-07-08') AS exposures_before_start
FROM ev WHERE event = '$experiment_started';

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H4-three-episodes-in-three-days
-- ─────────────────────────────────────────────────────────────────────────
-- Trial conversion by playback completed count in the first 72 h; 3+ vs 0-2
-- (target 1.804) and 5+ vs 3-4 (plateau, target 1.017).
WITH b AS (SELECT CASE WHEN k >= 5 THEN '5+' ELSE k::VARCHAR END AS early_completions, count(*) AS trials, avg(conv::INT) AS conv
  FROM trials WHERE full_window GROUP BY 1)
SELECT early_completions, trials, round(conv, 4) AS conv FROM b ORDER BY early_completions;
WITH g AS (SELECT avg(conv::INT) FILTER (WHERE k >= 3) AS c3, avg(conv::INT) FILTER (WHERE k <= 2) AS c02,
  avg(conv::INT) FILTER (WHERE k >= 5) AS c5, avg(conv::INT) FILTER (WHERE k IN (3, 4)) AS c34 FROM trials WHERE full_window)
SELECT round(c3, 4) AS conv_3plus, round(c02, 4) AS conv_0_2, round(c3 / c02, 4) AS ratio_3plus_vs_0_2,
 round(c5, 4) AS conv_5plus, round(c34, 4) AS conv_3_4, round(c5 / c34, 4) AS ratio_5plus_vs_3_4 FROM g;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H5-tv-streaming-incident
-- ─────────────────────────────────────────────────────────────────────────
-- Degraded days and platform come from the warehouse; TV/other completion per
-- start on degraded days vs 14 days either side (target 0.510).
WITH o AS (SELECT DISTINCT date::DATE AS d, platform FROM wh_qos WHERE cdn_status = 'degraded'),
w AS (SELECT t::DATE AS d, event, (platform IN (SELECT platform FROM o)) AS hit FROM ev
  WHERE event IN ('playback started', 'playback completed') AND t >= '2026-08-06' AND t < '2026-09-06'),
g AS (SELECT (d IN (SELECT d FROM o)) AS degraded, hit,
  count(*) FILTER (WHERE event = 'playback completed')::DOUBLE / count(*) FILTER (WHERE event = 'playback started') AS cr FROM w GROUP BY 1, 2)
SELECT (SELECT string_agg(DISTINCT d::VARCHAR || ' ' || platform, ', ' ORDER BY d::VARCHAR || ' ' || platform) FROM o) AS degraded_rows,
 round(max(cr) FILTER (WHERE degraded AND hit), 4) AS tv_cr_incident, round(max(cr) FILTER (WHERE degraded AND NOT hit), 4) AS other_cr_incident,
 round(max(cr) FILTER (WHERE NOT degraded AND hit), 4) AS tv_cr_baseline, round(max(cr) FILTER (WHERE NOT degraded AND NOT hit), 4) AS other_cr_baseline,
 round((max(cr) FILTER (WHERE degraded AND hit) / max(cr) FILTER (WHERE degraded AND NOT hit))
  / (max(cr) FILTER (WHERE NOT degraded AND hit) / max(cr) FILTER (WHERE NOT degraded AND NOT hit)), 4) AS did
FROM g;
SELECT platform, round(avg(playback_failure_rate) FILTER (WHERE cdn_status = 'degraded'), 4) AS fail_degraded,
 round(avg(playback_failure_rate) FILTER (WHERE cdn_status = 'healthy'), 4) AS fail_healthy
FROM wh_qos GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H6-standard-price-increase
-- ─────────────────────────────────────────────────────────────────────────
-- Plan share of plan selections before vs after Aug 11 (Standard target 0.65,
-- Basic with Ads target 1.583).
WITH p AS (SELECT CASE WHEN t >= '2026-08-11' THEN 'after' ELSE 'before' END AS per, plan FROM ev WHERE event = 'plan selected'),
s AS (SELECT per, plan, count(*) AS n, count(*)::DOUBLE / sum(count(*)) OVER (PARTITION BY per) AS share FROM p GROUP BY 1, 2)
SELECT plan, max(n) FILTER (WHERE per = 'before') AS n_before, max(n) FILTER (WHERE per = 'after') AS n_after,
 round(max(share) FILTER (WHERE per = 'before'), 4) AS share_before, round(max(share) FILTER (WHERE per = 'after'), 4) AS share_after,
 round(max(share) FILTER (WHERE per = 'after') / max(share) FILTER (WHERE per = 'before'), 4) AS share_ratio
FROM s GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H7-paid-social-cac
-- ─────────────────────────────────────────────────────────────────────────
-- Spend per signup by paid channel (paid_social / paid_search target 0.656)
-- and trial conversion paid_social / other channels (target 0.55).
WITH sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM wh_spend GROUP BY 1),
su AS (SELECT acquisition_channel AS ch, count(*) AS signups FROM ev WHERE event = 'account created' GROUP BY 1),
pd AS (SELECT p.acquisition_channel AS ch, count(*) AS paid FROM ev JOIN prof p USING (uid)
  WHERE ev.event = 'trial converted' AND p.member_since >= '2026-06-04' GROUP BY 1)
SELECT su.ch, round(sp.spend, 2) AS spend, su.signups, pd.paid AS paid_subscribers,
 round(sp.spend / su.signups, 2) AS spend_per_signup, round(sp.spend / pd.paid, 2) AS spend_per_paid
FROM su LEFT JOIN sp USING (ch) LEFT JOIN pd USING (ch) ORDER BY su.ch;
SELECT CASE WHEN acquisition_channel = 'paid_social' THEN 'paid_social' ELSE 'other' END AS grp, count(*) AS trials, round(avg(conv::INT), 4) AS conv
FROM trials WHERE full_window GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H8-shared-households-stay
-- ─────────────────────────────────────────────────────────────────────────
-- Renewal-time churn = paid cancellations / (renewals + paid cancellations),
-- by profile_count (shared / single target 0.50).
WITH x AS (SELECT CASE WHEN p.profile_count >= 2 THEN 'shared (2+ profiles)' ELSE 'single profile' END AS grp, ev.event FROM ev JOIN prof p USING (uid)
  WHERE ev.event = 'subscription renewed' OR (ev.event = 'subscription cancelled' AND NOT ev.during_trial))
SELECT grp, count(*) FILTER (WHERE event = 'subscription renewed') AS renewals, count(*) FILTER (WHERE event = 'subscription cancelled') AS cancellations,
 round(count(*) FILTER (WHERE event = 'subscription cancelled')::DOUBLE / count(*), 4) AS churn_rate
FROM x GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H9-personalized-pushes
-- ─────────────────────────────────────────────────────────────────────────
-- Open rate by campaign_type (new_episode / trending_now target 3.0,
-- because_you_watched / trending_now target 1.8).
SELECT campaign_type, count(*) FILTER (WHERE event = 'notification received') AS received,
 count(*) FILTER (WHERE event = 'notification opened') AS opened,
 round(count(*) FILTER (WHERE event = 'notification opened')::DOUBLE / count(*) FILTER (WHERE event = 'notification received'), 4) AS open_rate
FROM ev WHERE event IN ('notification received', 'notification opened') GROUP BY 1 ORDER BY open_rate DESC;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H10-tv-search-is-slow
-- ─────────────────────────────────────────────────────────────────────────
-- Median seconds from search performed to the playback with the same
-- search_id, within 60 minutes (tv / other target 2.2).
WITH s AS (SELECT uid, search_id, t AS ts, platform FROM ev WHERE event = 'search performed'),
p AS (SELECT search_id, min(t) AS tp FROM ev WHERE event = 'playback started' AND search_id IS NOT NULL GROUP BY 1),
x AS (SELECT s.platform, date_diff('millisecond', s.ts, p.tp) / 1000.0 AS sec FROM s JOIN p USING (search_id)
  WHERE p.tp >= s.ts AND p.tp < s.ts + INTERVAL 60 MINUTE)
SELECT CASE WHEN platform = 'tv' THEN 'tv' ELSE 'other' END AS grp, count(*) AS searches_to_play, round(median(sec), 1) AS median_seconds
FROM x GROUP BY 1 ORDER BY 1;

-- ═════════════════════════════════════════════════════════════════════════
-- EVAL QUERIES
-- ═════════════════════════════════════════════════════════════════════════

-- EVAL Q1 — Saltmarsh season 2 reach and depth
WITH a AS (SELECT DISTINCT ev.uid FROM ev JOIN prof p USING (uid)
  WHERE event = 'playback started' AND t >= '2026-07-17' AND t < '2026-07-31' AND p.member_since < '2026-07-17'),
v AS (SELECT uid, count(DISTINCT episode_number) AS eps FROM ev WHERE event = 'playback started' AND title_name = 'Saltmarsh' AND season_number = 2 GROUP BY 1),
f AS (SELECT DISTINCT uid FROM ev WHERE event = 'playback started' AND title_name = 'Saltmarsh' AND season_number = 2 AND t >= '2026-07-17' AND t < '2026-07-31')
SELECT (SELECT count(*) FROM a) AS active_members,
 (SELECT count(*) FROM a JOIN f USING (uid)) AS fortnight_viewers,
 round((SELECT count(*) FROM a JOIN f USING (uid)) / (SELECT count(*) FROM a), 4) AS reach,
 (SELECT count(*) FROM v) AS all_window_viewers,
 round((SELECT avg(eps) FROM v), 2) AS avg_episodes_started,
 round((SELECT avg((eps = 8)::INT) FROM v), 4) AS share_started_all_8,
 (SELECT count(*) FROM ev WHERE event = 'playback completed' AND title_name = 'Saltmarsh' AND season_number = 2) AS season2_completions;

-- EVAL Q2 — the late-July viewing jump: plays per day and per active household
WITH d AS (SELECT CASE WHEN t >= '2026-07-03' AND t < '2026-07-17' THEN '1 Jul 3-16' WHEN t >= '2026-07-17' AND t < '2026-07-31' THEN '2 Jul 17-30'
  WHEN t >= '2026-07-31' AND t < '2026-08-14' THEN '3 Jul 31-Aug 13' END AS per, uid, title_name, season_number
  FROM ev WHERE event = 'playback started')
SELECT per, count(*) AS plays, round(count(*) / 14.0, 1) AS plays_per_day, count(DISTINCT uid) AS households,
 round(count(*)::DOUBLE / count(DISTINCT uid), 2) AS plays_per_household,
 count(*) FILTER (WHERE title_name = 'Saltmarsh' AND season_number = 2) AS season2_plays,
 round(count(*) FILTER (WHERE title_name = 'Saltmarsh' AND season_number = 2)::DOUBLE / count(*), 4) AS season2_share
FROM d WHERE per IS NOT NULL GROUP BY 1 ORDER BY 1;
SELECT count(*) FILTER (WHERE event = 'notification received') AS new_season_pushes, count(*) FILTER (WHERE event = 'notification opened') AS opens,
 round(count(*) FILTER (WHERE event = 'notification opened')::DOUBLE / count(*) FILTER (WHERE event = 'notification received'), 4) AS open_rate
FROM ev WHERE campaign_type = 'new_season';

-- EVAL Q3 — premiere signups' trial conversion (same as STORY H2, plus by signup week)
SELECT date_trunc('week', signup_t)::DATE AS signup_week, count(*) AS trials, round(avg(conv::INT), 4) AS conv
FROM trials WHERE full_window AND t0 >= '2026-07-08' AND t0 < '2026-08-24' GROUP BY 1 ORDER BY 1;
WITH s2 AS (SELECT uid, min(t) AS first_s2 FROM ev WHERE event = 'playback started' AND title_name = 'Saltmarsh' AND season_number = 2 GROUP BY 1)
SELECT CASE WHEN signup_t >= '2026-07-17' AND signup_t < '2026-08-07' THEN 'premiere' ELSE 'other' END AS grp,
 count(*) AS trials, round(avg(conv::INT), 4) AS conv,
 round(avg(coalesce(s2.first_s2 < trials.t0 + INTERVAL 1 DAY, false)::INT), 4) AS share_started_s2_day1
FROM trials LEFT JOIN s2 USING (uid) WHERE full_window AND t0 >= '2026-07-08' GROUP BY 1 ORDER BY 1 DESC;

-- EVAL Q4 — Smart Start: conversion by arm with a two-proportion z
WITH g AS (SELECT variant, count(*) AS n, avg(conv::INT) AS p FROM trials WHERE full_window AND t0 >= '2026-07-08' AND variant IS NOT NULL GROUP BY 1),
v AS (SELECT * FROM g WHERE variant = 'Smart Start'), c AS (SELECT * FROM g WHERE variant = 'Control')
SELECT c.n AS control_trials, round(c.p, 4) AS control_conv, v.n AS variant_trials, round(v.p, 4) AS variant_conv,
 round(v.p / c.p, 4) AS lift, round((v.p - c.p) / sqrt(((v.p * v.n + c.p * c.n) / (v.n + c.n)) * (1 - (v.p * v.n + c.p * c.n) / (v.n + c.n)) * (1.0 / v.n + 1.0 / c.n)), 2) AS z
FROM v, c;

-- EVAL Q5 — null: early viewing (playback completed in the first 72 h) by arm, overall and by signup platform
WITH g AS (SELECT variant, count(*) AS n, avg(k) AS m, var_samp(k) AS v FROM trials WHERE full_window AND t0 >= '2026-07-08' AND variant IS NOT NULL GROUP BY 1)
SELECT round(max(m) FILTER (WHERE variant = 'Smart Start'), 3) AS variant_mean, round(max(m) FILTER (WHERE variant = 'Control'), 3) AS control_mean,
 round((max(m) FILTER (WHERE variant = 'Smart Start') - max(m) FILTER (WHERE variant = 'Control'))
  / sqrt(max(v / n) FILTER (WHERE variant = 'Smart Start') + max(v / n) FILTER (WHERE variant = 'Control')), 2) AS t_stat
FROM g;
SELECT signup_platform, round(avg(k) FILTER (WHERE variant = 'Smart Start'), 3) AS variant_mean, round(avg(k) FILTER (WHERE variant = 'Control'), 3) AS control_mean,
 round((avg(k) FILTER (WHERE variant = 'Smart Start') - avg(k) FILTER (WHERE variant = 'Control'))
  / sqrt(var_samp(k) FILTER (WHERE variant = 'Smart Start') / count(*) FILTER (WHERE variant = 'Smart Start')
       + var_samp(k) FILTER (WHERE variant = 'Control') / count(*) FILTER (WHERE variant = 'Control')), 2) AS t_stat
FROM trials WHERE full_window AND t0 >= '2026-07-08' AND variant IS NOT NULL GROUP BY 1 ORDER BY 1;

-- EVAL Q6 — early-viewing milestone (same as STORY H4)
SELECT CASE WHEN k >= 3 THEN '3+' ELSE '0-2' END AS early_completions, count(*) AS trials, round(avg(conv::INT), 4) AS conv
FROM trials WHERE full_window GROUP BY 1 ORDER BY 1;

-- EVAL Q7 — TV completion per start by day around the incident, with warehouse status
WITH d AS (SELECT t::DATE AS d, platform = 'tv' AS tv, event FROM ev WHERE event IN ('playback started', 'playback completed', 'playback error') AND t >= '2026-08-16' AND t < '2026-08-27'),
g AS (SELECT d, round(count(*) FILTER (WHERE tv AND event = 'playback completed')::DOUBLE / count(*) FILTER (WHERE tv AND event = 'playback started'), 4) AS tv_completion,
  round(count(*) FILTER (WHERE NOT tv AND event = 'playback completed')::DOUBLE / count(*) FILTER (WHERE NOT tv AND event = 'playback started'), 4) AS other_completion,
  count(*) FILTER (WHERE tv AND event = 'playback error') AS tv_errors FROM d GROUP BY 1)
SELECT g.*, q.cdn_status AS tv_cdn_status, q.playback_failure_rate AS tv_failure_rate, q.rebuffer_ratio AS tv_rebuffer_ratio
FROM g LEFT JOIN wh_qos q ON q.date::DATE = g.d AND q.platform = 'tv' ORDER BY 1;

-- EVAL Q8 — TV playback lost to the incident: errors and missing completions vs the 14-day baseline
WITH b AS (SELECT count(*) FILTER (WHERE event = 'playback completed')::DOUBLE / count(*) FILTER (WHERE event = 'playback started') AS cr,
  count(*) FILTER (WHERE event = 'playback error')::DOUBLE / count(*) FILTER (WHERE event = 'playback started') AS er
  FROM ev WHERE platform = 'tv' AND ((t >= '2026-08-06' AND t < '2026-08-20') OR (t >= '2026-08-23' AND t < '2026-09-06'))),
i AS (SELECT count(*) FILTER (WHERE event = 'playback started') AS starts, count(*) FILTER (WHERE event = 'playback completed') AS completions,
  count(*) FILTER (WHERE event = 'playback error') AS errors, count(DISTINCT uid) FILTER (WHERE event = 'playback error') AS households_with_error
  FROM ev WHERE platform = 'tv' AND t >= '2026-08-20' AND t < '2026-08-23')
SELECT i.starts AS tv_starts, i.completions AS tv_completions, i.errors AS tv_errors, i.households_with_error,
 round(b.cr, 4) AS baseline_completion_rate, round(i.completions::DOUBLE / i.starts, 4) AS incident_completion_rate,
 round(b.cr * i.starts - i.completions) AS completions_lost, round(b.er, 4) AS baseline_errors_per_start, round(i.errors::DOUBLE / i.starts, 4) AS incident_errors_per_start
FROM i, b;

-- EVAL Q9 — plan mix of new households before vs after the Standard price change (same as STORY H6)
SELECT CASE WHEN t >= '2026-08-11' THEN '2 after (Aug 11-Oct 1)' ELSE '1 before (Jun 4-Aug 10)' END AS per, plan, count(*) AS selections,
 round(count(*)::DOUBLE / sum(count(*)) OVER (PARTITION BY per), 4) AS share
FROM ev WHERE event = 'plan selected' GROUP BY 1, 2 ORDER BY 1, 2;
SELECT CASE WHEN t >= '2026-08-11' THEN '2 after' ELSE '1 before' END AS per, round(count(*) / count(DISTINCT t::DATE), 2) AS plan_selections_per_day
FROM ev WHERE event = 'plan selected' GROUP BY 1 ORDER BY 1;

-- EVAL Q10 — revenue per new paid subscription before vs after (warehouse list prices)
-- New paid subscriptions start 7 days after the trial, so subscriptions billed from
-- Aug 18 come from households that chose a plan on or after Aug 11.
SELECT CASE WHEN date::DATE < '2026-08-11' THEN '1 Jun 4-Aug 10' WHEN date::DATE < '2026-08-18' THEN '2 Aug 11-17' ELSE '3 Aug 18-Oct 1' END AS per,
 sum(new_paid_subscriptions)::BIGINT AS new_paid_subscriptions, round(sum(gross_bookings_usd), 2) AS gross_bookings_usd,
 round(sum(gross_bookings_usd) / sum(new_paid_subscriptions), 2) AS avg_list_price,
 round(sum(new_paid_subscriptions) FILTER (WHERE plan = 'standard') / sum(new_paid_subscriptions), 4) AS standard_share
FROM wh_billing GROUP BY 1 ORDER BY 1;
WITH p AS (SELECT DISTINCT date::DATE AS d, plan, list_price_usd FROM wh_billing)
SELECT CASE WHEN ev.t < '2026-08-18' THEN '1 before Aug 18' ELSE '2 from Aug 18' END AS per, count(*) AS trial_conversions,
 round(avg(p.list_price_usd), 2) AS avg_list_price_mixpanel_join
FROM ev JOIN p ON p.d = ev.t::DATE AND p.plan = ev.plan WHERE ev.event = 'trial converted' GROUP BY 1 ORDER BY 1;

-- EVAL Q11 — cost per signup and per paying subscriber by paid channel (same as STORY H7)
WITH sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM wh_spend GROUP BY 1),
su AS (SELECT acquisition_channel AS ch, count(*) AS signups FROM ev WHERE event = 'account created' GROUP BY 1),
tr AS (SELECT acquisition_channel AS ch, count(*) AS trials, avg(conv::INT) AS conv FROM trials WHERE full_window GROUP BY 1),
pd AS (SELECT p.acquisition_channel AS ch, count(*) AS paid FROM ev JOIN prof p USING (uid) WHERE ev.event = 'trial converted' AND p.member_since >= '2026-06-04' GROUP BY 1)
SELECT sp.ch, round(sp.spend, 0) AS spend, su.signups, round(sp.spend / su.signups, 2) AS cost_per_signup, round(tr.conv, 4) AS trial_conv,
 pd.paid, round(sp.spend / pd.paid, 2) AS cost_per_paid
FROM sp JOIN su USING (ch) JOIN tr USING (ch) JOIN pd USING (ch) ORDER BY cost_per_signup;
SELECT acquisition_channel, count(*) AS trials, round(avg(conv::INT), 4) AS trial_conv FROM trials WHERE full_window GROUP BY 1 ORDER BY 1;

-- EVAL Q12 — who cancels least: renewal-time churn by profile_count (same as STORY H8), and by plan
WITH x AS (SELECT p.profile_count, ev.event FROM ev JOIN prof p USING (uid)
  WHERE ev.event = 'subscription renewed' OR (ev.event = 'subscription cancelled' AND NOT ev.during_trial))
SELECT profile_count, count(*) FILTER (WHERE event = 'subscription cancelled') AS cancellations, count(*) AS renewals_due,
 round(count(*) FILTER (WHERE event = 'subscription cancelled')::DOUBLE / count(*), 4) AS churn_rate
FROM x GROUP BY 1 ORDER BY 1;
WITH x AS (SELECT ev.plan, ev.event FROM ev WHERE ev.event = 'subscription renewed' OR (ev.event = 'subscription cancelled' AND NOT ev.during_trial))
SELECT plan, round(count(*) FILTER (WHERE event = 'subscription cancelled')::DOUBLE / count(*), 4) AS churn_rate FROM x GROUP BY 1 ORDER BY 1;

-- EVAL Q13 — push open rate by campaign type (same as STORY H9), plus plays after an open
WITH o AS (SELECT uid, t, campaign_type FROM ev WHERE event = 'notification opened'),
p AS (SELECT uid, t FROM ev WHERE event = 'playback started' AND source = 'push_notification'),
j AS (SELECT o.uid, o.t, o.campaign_type, bool_or(p.uid IS NOT NULL) AS played FROM o LEFT JOIN p ON p.uid = o.uid AND p.t >= o.t AND p.t < o.t + INTERVAL 10 MINUTE GROUP BY 1, 2, 3)
SELECT campaign_type, count(*) AS opens, round(avg(played::INT), 4) AS share_followed_by_play FROM j GROUP BY 1 ORDER BY 1;

-- EVAL Q14 — search to play by platform (same as STORY H10), plus search conversion
WITH s AS (SELECT uid, search_id, t AS ts, platform FROM ev WHERE event = 'search performed'),
p AS (SELECT search_id, min(t) AS tp FROM ev WHERE event = 'playback started' AND search_id IS NOT NULL GROUP BY 1)
SELECT s.platform, count(*) AS searches, round(avg(coalesce(p.tp < s.ts + INTERVAL 60 MINUTE, false)::INT), 4) AS search_to_play_rate,
 round(median(date_diff('millisecond', s.ts, p.tp) / 1000.0) FILTER (WHERE p.tp < s.ts + INTERVAL 60 MINUTE), 1) AS median_seconds
FROM s LEFT JOIN p USING (search_id) GROUP BY 1 ORDER BY 1;

-- EVAL Q15 — Q3 (Jul 1 - Sep 30) paid marketing: spend, signups, paying subscribers
WITH sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM wh_spend WHERE date::DATE BETWEEN '2026-07-01' AND '2026-09-30' GROUP BY 1),
su AS (SELECT uid, acquisition_channel AS ch FROM ev WHERE event = 'account created' AND t >= '2026-07-01' AND t < '2026-10-01'),
pd AS (SELECT DISTINCT uid FROM ev WHERE event = 'trial converted'),
g AS (SELECT su.ch, count(*) AS signups, count(pd.uid) AS paid FROM su LEFT JOIN pd USING (uid) GROUP BY 1)
SELECT sp.ch, round(sp.spend, 0) AS spend, g.signups, g.paid AS paid_by_oct1, round(sp.spend / g.signups, 2) AS cost_per_signup, round(sp.spend / g.paid, 2) AS cost_per_paid
FROM sp JOIN g USING (ch)
UNION ALL
SELECT 'zz total paid', round(sum(sp.spend), 0), sum(g.signups), sum(g.paid), round(sum(sp.spend) / sum(g.signups), 2), round(sum(sp.spend) / sum(g.paid), 2)
FROM sp JOIN g USING (ch)
ORDER BY 1;

-- EVAL Q16 — null: Canada vs US trial conversion and renewal-time churn
WITH g AS (SELECT country, count(*) AS n, avg(conv::INT) AS p FROM trials WHERE full_window GROUP BY 1)
SELECT round(max(p) FILTER (WHERE country = 'US'), 4) AS us_conv, round(max(p) FILTER (WHERE country = 'CA'), 4) AS ca_conv,
 max(n) FILTER (WHERE country = 'US') AS us_trials, max(n) FILTER (WHERE country = 'CA') AS ca_trials,
 round((max(p) FILTER (WHERE country = 'CA') - max(p) FILTER (WHERE country = 'US'))
  / sqrt(max(p * (1 - p) / n) FILTER (WHERE country = 'CA') + max(p * (1 - p) / n) FILTER (WHERE country = 'US')), 2) AS z
FROM g;
WITH x AS (SELECT p.country, ev.event FROM ev JOIN prof p USING (uid) WHERE ev.event = 'subscription renewed' OR (ev.event = 'subscription cancelled' AND NOT ev.during_trial)),
g AS (SELECT country, count(*) AS n, count(*) FILTER (WHERE event = 'subscription cancelled')::DOUBLE / count(*) AS p FROM x GROUP BY 1)
SELECT round(max(p) FILTER (WHERE country = 'US'), 4) AS us_churn, round(max(p) FILTER (WHERE country = 'CA'), 4) AS ca_churn,
 round((max(p) FILTER (WHERE country = 'CA') - max(p) FILTER (WHERE country = 'US'))
  / sqrt(max(p * (1 - p) / n) FILTER (WHERE country = 'CA') + max(p * (1 - p) / n) FILTER (WHERE country = 'US')), 2) AS z
FROM g;
WITH g AS (SELECT country, variant, count(*) AS n, avg(conv::INT) AS p FROM trials WHERE full_window AND t0 >= '2026-07-08' AND variant IS NOT NULL GROUP BY 1, 2)
SELECT variant, round(max(p) FILTER (WHERE country = 'US'), 4) AS us_conv, round(max(p) FILTER (WHERE country = 'CA'), 4) AS ca_conv,
 round((max(p) FILTER (WHERE country = 'CA') - max(p) FILTER (WHERE country = 'US'))
  / sqrt(max(p * (1 - p) / n) FILTER (WHERE country = 'CA') + max(p * (1 - p) / n) FILTER (WHERE country = 'US')), 2) AS z
FROM g GROUP BY 1 ORDER BY 1;

-- EVAL Q17 — trial conversion by month the trial started (June, July, August, September 1-23)
SELECT strftime(t0, '%Y-%m') AS month, count(*) AS trials, round(avg(conv::INT), 4) AS conv,
 round(avg((signup_t >= '2026-07-17' AND signup_t < '2026-08-07')::INT), 4) AS premiere_signup_share,
 round(avg(coalesce(variant = 'Smart Start', false)::INT), 4) AS smart_start_share
FROM trials WHERE full_window GROUP BY 1 ORDER BY 1;

-- EVAL Q18 — monthly churn of paying subscribers (renewal-time churn by month of the event)
WITH x AS (SELECT strftime(t, '%Y-%m') AS month, event FROM ev WHERE event = 'subscription renewed' OR (event = 'subscription cancelled' AND NOT during_trial))
SELECT month, count(*) FILTER (WHERE event = 'subscription cancelled') AS paid_cancellations, count(*) FILTER (WHERE event = 'subscription renewed') AS renewals,
 round(count(*) FILTER (WHERE event = 'subscription cancelled')::DOUBLE / count(*), 4) AS churn_rate
FROM x GROUP BY 1 ORDER BY 1;
WITH x AS (SELECT event FROM ev WHERE event = 'subscription renewed' OR (event = 'subscription cancelled' AND NOT during_trial))
SELECT round(count(*) FILTER (WHERE event = 'subscription cancelled')::DOUBLE / count(*), 4) AS overall_churn_rate FROM x;
SELECT cancel_reason, count(*) AS n FROM ev WHERE event = 'subscription cancelled' AND NOT during_trial GROUP BY 1 ORDER BY 2 DESC;

-- EVAL Q19 — open-ended: headline numbers (the story queries above carry the detail)
SELECT (SELECT count(DISTINCT uid) FROM ev WHERE event = 'playback started' AND t >= '2026-09-01' AND t < '2026-10-01') AS september_viewing_households,
 (SELECT count(*) FROM users WHERE subscription_status = 'active') AS active_subscriptions_oct1,
 (SELECT round(avg(conv::INT), 4) FROM trials WHERE full_window) AS trial_conversion_all;

-- EVAL Q20 — new paid subscriptions and bookings by month (warehouse) vs Mixpanel trial conversions
WITH w AS (SELECT strftime(date::DATE, '%Y-%m') AS month, sum(new_paid_subscriptions) AS billed, sum(gross_bookings_usd) AS bookings FROM wh_billing GROUP BY 1),
m AS (SELECT strftime(t, '%Y-%m') AS month, count(*) AS mixpanel_conversions FROM ev WHERE event = 'trial converted' GROUP BY 1)
SELECT w.month, w.billed::BIGINT AS billed_new_subscriptions, m.mixpanel_conversions, round(w.bookings, 2) AS gross_bookings_usd
FROM w LEFT JOIN m USING (month) ORDER BY 1;
