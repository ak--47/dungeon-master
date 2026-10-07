-- Tallyboard (sass vertical) — story-keyed and eval-keyed DuckDB queries.
--
-- Generate first (repo root):
--   node scripts/verify-runner.mjs dungeons/vertical/sass/sass.js verify-sass
-- Run:
--   duckdb -c ".read dungeons/vertical/sass/sass.sql"
-- Against a gzipped export:
--   duckdb -c "SET VARIABLE data_prefix='<dir>/sass'" -c ".read sass.sql"
--
-- All times are UTC. Window: 2026-06-04 00:00 to 2026-10-01 23:59:59.

SET VARIABLE data_prefix = COALESCE(getvariable('data_prefix'), 'data/verify-sass');

-- ─────────────────────────────────────────────────────────────────────────
-- PRELUDE: raw files, identity resolution, warehouse tables
-- ─────────────────────────────────────────────────────────────────────────
-- Identity: new users sign up with "account created" (the auth event, which
-- carries user_id and device_id). A device resolves to the user seen with it
-- on any event that carries both ids, the way Mixpanel stitches. Every other
-- event already carries user_id.

CREATE OR REPLACE TEMP TABLE raw_events AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-EVENTS*.json*', sample_size=-1, union_by_name=true);

CREATE OR REPLACE TEMP TABLE users AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-USERS*.json*', sample_size=-1, union_by_name=true);

CREATE OR REPLACE TEMP TABLE companies AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-company_id-GROUPS*.json*', sample_size=-1, union_by_name=true);

CREATE OR REPLACE TEMP TABLE device_map AS
SELECT device_id, min(user_id::VARCHAR) AS mapped
FROM raw_events WHERE user_id IS NOT NULL AND device_id IS NOT NULL GROUP BY 1;

CREATE OR REPLACE TEMP TABLE ev AS
SELECT coalesce(e.user_id::VARCHAR, m.mapped) AS uid, e.time::TIMESTAMP AS t, e.*
FROM raw_events e LEFT JOIN device_map m ON e.device_id = m.device_id;

CREATE OR REPLACE TEMP TABLE wh_marketing AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-paid_marketing_daily.json*', sample_size=-1, union_by_name=true);
CREATE OR REPLACE TEMP TABLE wh_runner AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-ci_runner_health_daily.json*', sample_size=-1, union_by_name=true);
CREATE OR REPLACE TEMP TABLE wh_bookings AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-subscription_bookings_daily.json*', sample_size=-1, union_by_name=true);

-- profile attributes keyed by the resolved user id; slack_and_pagerduty = both
-- tools in the profile's connected_integrations (current integrations; for
-- accounts set up before the window they were connected before June 4)
CREATE OR REPLACE TEMP TABLE prof AS
SELECT distinct_id::VARCHAR AS uid, company_size, cloud_provider, acquisition_channel, plan_tier AS current_plan,
 "Experiment: Smart Test Selection" AS variant, created, customer_since,
 coalesce(list_contains(connected_integrations, 'slack') AND list_contains(connected_integrations, 'pagerduty'), false) AS slack_and_pagerduty
FROM users;

-- new-user signups (one per user who joined in the window)
CREATE OR REPLACE TEMP TABLE signups AS
SELECT uid, t AS t0, acquisition_channel AS ch, signup_method FROM ev WHERE event = 'account created';

-- one row per alert: trigger, acknowledgement, resolution (alert_id is shared by all three)
CREATE OR REPLACE TEMP TABLE alerts AS
SELECT alert_id, any_value(uid) AS uid, any_value(severity) AS severity,
 min(t) FILTER (WHERE event = 'alert triggered') AS t_trig,
 min(t) FILTER (WHERE event = 'alert acknowledged') AS t_ack,
 min(t) FILTER (WHERE event = 'alert resolved') AS t_res,
 any_value(response_time_mins) FILTER (WHERE event = 'alert acknowledged') AS response_time_mins,
 any_value(resolution_time_mins) FILTER (WHERE event = 'alert resolved') AS resolution_time_mins,
 any_value(resolution_method) FILTER (WHERE event = 'alert resolved') AS resolution_method,
 any_value(plan_tier) FILTER (WHERE event = 'alert resolved') AS res_plan
FROM ev WHERE event IN ('alert triggered', 'alert acknowledged', 'alert resolved') GROUP BY 1;

-- one row per pipeline run, matched to its deploy on deploy_id
CREATE OR REPLACE TEMP TABLE runs AS
SELECT r.uid, r.deploy_id, r.t AS t_run, r.runner_region, r.pipeline_status, d.t_dep
FROM (SELECT * FROM ev WHERE event = 'deployment pipeline run') r
LEFT JOIN (SELECT deploy_id, min(t) AS t_dep FROM ev WHERE event = 'service deployed' GROUP BY 1) d ON d.deploy_id = r.deploy_id;

-- users who configured both Slack and PagerDuty; ready = later of the first slack and first pagerduty configuration
CREATE OR REPLACE TEMP TABLE integrated AS
SELECT uid, greatest(min(t) FILTER (WHERE integration_type = 'slack'), min(t) FILTER (WHERE integration_type = 'pagerduty')) AS ready
FROM ev WHERE event = 'integration configured'
GROUP BY 1 HAVING bool_or(integration_type = 'slack') AND bool_or(integration_type = 'pagerduty');

-- users with both integrations on the profile (current state)
CREATE OR REPLACE TEMP TABLE integrated_profile AS SELECT uid, customer_since FROM prof WHERE slack_and_pagerduty;

-- dataset overview
SELECT count(*) AS events, count(DISTINCT uid) AS users, (SELECT count(*) FROM users) AS profiles,
 (SELECT count(*) FROM signups) AS new_signups, min(t) AS first_event, max(t) AS last_event FROM ev;

-- identity check: every event resolves to a user; company_id on events matches the profile
SELECT count(*) FILTER (WHERE uid IS NULL) AS unresolved_events,
 count(*) FILTER (WHERE e.company_id::VARCHAR <> u.company_id::VARCHAR) AS company_mismatch
FROM ev e LEFT JOIN users u ON u.distinct_id::VARCHAR = e.uid;

-- timeline check: US holidays (Jul 3 observed, Sep 7) vs the same weekday a week before and after
SELECT t::DATE AS day, dayname(t::DATE) AS weekday, count(*) AS events, count(*) FILTER (WHERE event = 'dashboard viewed') AS dashboard_views,
 count(*) FILTER (WHERE event = 'alert triggered') AS alerts
FROM ev WHERE t::DATE IN (DATE '2026-06-26', DATE '2026-07-03', DATE '2026-07-10', DATE '2026-08-31', DATE '2026-09-07', DATE '2026-09-14')
GROUP BY 1, 2 ORDER BY 1;

-- account health coverage: rows exist only for accounts with a customer success manager
SELECT u.customer_success_manager, count(DISTINCT u.distinct_id) AS users, count(DISTINCT s.distinct_id) AS users_with_health_rows
FROM users u LEFT JOIN read_json_auto(getvariable('data_prefix') || '-account_health-SCD*.json*', sample_size=-1, union_by_name=true) s
  ON s.distinct_id = u.distinct_id GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H1-quarter-close-seat-push — paid-plan invites ×1.5, 2026-09-16..09-30; Free unchanged
-- ─────────────────────────────────────────────────────────────────────────
WITH w AS (SELECT CASE WHEN plan_tier IN ('team', 'business', 'enterprise') THEN 'paid' ELSE 'free' END AS plan_group,
  (t >= TIMESTAMP '2026-09-16') AS promo, event FROM ev
  WHERE event IN ('teammate invited', 'dashboard viewed') AND t >= TIMESTAMP '2026-09-01' AND t < TIMESTAMP '2026-10-01'),
g AS (SELECT plan_group, promo, count(*) FILTER (WHERE event = 'teammate invited') AS invites, count(*) FILTER (WHERE event = 'dashboard viewed') AS views FROM w GROUP BY 1, 2)
SELECT plan_group, promo, invites, views, round(invites::DOUBLE / views, 4) AS invites_per_view FROM g ORDER BY 1, 2;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H2-root-cause-assist-launch — AI resolution for Business/Enterprise from 2026-07-22
-- ─────────────────────────────────────────────────────────────────────────
SELECT CASE WHEN resolution_method = 'ai_assist' THEN 'ai_assist' ELSE 'manual_or_runbook' END AS method,
 count(*) AS resolutions, round(avg(resolution_time_mins), 1) AS avg_resolution_mins
FROM ev WHERE event = 'alert resolved' AND t >= TIMESTAMP '2026-07-22' AND plan_tier IN ('business', 'enterprise')
GROUP BY 1 ORDER BY 1;

SELECT count(*) FILTER (WHERE resolution_method = 'ai_assist' AND (t < TIMESTAMP '2026-07-22' OR plan_tier NOT IN ('business', 'enterprise'))) AS impure_rows
FROM ev WHERE event = 'alert resolved';

-- adoption share once ramped (every adopter has started by 2026-08-19)
SELECT round(avg((resolution_method = 'ai_assist')::INT), 4) AS ai_share_after_ramp
FROM ev WHERE event = 'alert resolved' AND t >= TIMESTAMP '2026-08-19' AND plan_tier IN ('business', 'enterprise');

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H3-azure-onboarding-friction — onboarding conversion by cloud provider
-- ─────────────────────────────────────────────────────────────────────────
-- Onboarding steps are onboarding-only events (one each per user), so "reached
-- every step in order within 7 days" equals the Mixpanel unique funnel.
CREATE OR REPLACE TEMP TABLE onboarding AS
WITH c AS (SELECT uid, min(t) AS tc FROM ev WHERE event = 'cloud account connected' GROUP BY 1),
a AS (SELECT uid, min(t) AS ta FROM ev WHERE event = 'agent installed' GROUP BY 1),
d AS (SELECT uid, min(t) AS td FROM ev WHERE event = 'dashboard created' GROUP BY 1)
SELECT s.uid, s.t0, s.ch, s.signup_method, p.cloud_provider,
 coalesce(c.tc >= s.t0 AND a.ta >= c.tc AND d.td >= a.ta AND d.td < s.t0 + INTERVAL 7 DAY, false) AS converted,
 coalesce(c.tc >= s.t0 AND c.tc < s.t0 + INTERVAL 7 DAY, false) AS connected,
 coalesce(c.tc >= s.t0 AND a.ta >= c.tc AND a.ta < s.t0 + INTERVAL 7 DAY, false) AS installed
FROM signups s JOIN prof p ON p.uid = s.uid LEFT JOIN c ON c.uid = s.uid LEFT JOIN a ON a.uid = s.uid LEFT JOIN d ON d.uid = s.uid;

SELECT CASE WHEN cloud_provider = 'azure' THEN 'azure' ELSE 'aws_gcp_multi' END AS grp, count(*) AS signups,
 round(avg(converted::INT), 4) AS onboarding_conversion
FROM onboarding GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H4-slack-pagerduty-response — ack time ×0.4 once Slack + PagerDuty are both live
-- ─────────────────────────────────────────────────────────────────────────
-- read 1: accounts set up before the window (customer_since before 2026-05-14),
-- profile connected_integrations has slack AND pagerduty vs the rest
SELECT CASE WHEN p.slack_and_pagerduty THEN 'slack_and_pagerduty' ELSE 'rest' END AS grp,
 count(DISTINCT a.uid) AS users, count(*) AS acks, round(avg(a.response_time_mins), 2) AS avg_response_mins
FROM alerts a JOIN prof p ON p.uid = a.uid
WHERE a.t_ack IS NOT NULL AND p.customer_since < '2026-05-14' GROUP BY 1 ORDER BY 1;
-- read 2: new signups in the cohort, alerts triggered before vs after both integrations were live
SELECT CASE WHEN a.t_trig >= i.ready THEN 'after' ELSE 'before' END AS grp,
 count(DISTINCT a.uid) AS users, count(*) AS acks, round(avg(a.response_time_mins), 2) AS avg_response_mins
FROM alerts a JOIN integrated i ON i.uid = a.uid JOIN signups s ON s.uid = a.uid
WHERE a.t_ack IS NOT NULL AND a.t_trig IS NOT NULL GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H5-first-week-team-activation — 2+ invites in week 1 → D30 retention
-- ─────────────────────────────────────────────────────────────────────────
-- early_invites >= 2 equals completing the Mixpanel funnel account created →
-- teammate invited → teammate invited with a 7-day conversion window; = 1 is
-- dropping after step 2, = 0 dropping after step 1 (the cohorts the recipe saves).
CREATE OR REPLACE TEMP TABLE activation AS
WITH s AS (SELECT uid, t0 FROM signups WHERE t0 < TIMESTAMP '2026-10-01 23:59:59' - INTERVAL 37 DAY)
SELECT s.uid,
 count(*) FILTER (WHERE e.event = 'teammate invited' AND e.t < s.t0 + INTERVAL 7 DAY) AS early_invites,
 bool_or(e.event = 'dashboard created') AS onboarded,
 count(*) FILTER (WHERE e.t >= s.t0 + INTERVAL 7 DAY AND e.t < s.t0 + INTERVAL 14 DAY) > 0 AS d7,
 count(*) FILTER (WHERE e.t >= s.t0 + INTERVAL 30 DAY AND e.t < s.t0 + INTERVAL 37 DAY) > 0 AS d30
FROM s JOIN ev e ON e.uid = s.uid GROUP BY 1;

SELECT CASE WHEN early_invites >= 2 THEN 'activated' ELSE 'not_activated' END AS grp, count(*) AS users,
 round(avg(d30::INT), 4) AS d30_retention
FROM activation GROUP BY 1 ORDER BY 1;
-- dose read: onboarded new users, 2+ vs 1 vs 0 first-week invites
SELECT CASE WHEN early_invites >= 2 THEN '2+' ELSE early_invites::VARCHAR END AS first_week_invites, count(*) AS users,
 round(avg(d30::INT), 4) AS d30_retention
FROM activation WHERE onboarded GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H6-smart-test-selection-experiment — pipeline A/B from 2026-07-15
-- ─────────────────────────────────────────────────────────────────────────
-- Per-run success (hold deploy_id constant), runs after the test start.
SELECT p.variant, count(DISTINCT r.uid) AS users, count(*) AS runs,
 round(avg(coalesce(r.t_dep >= r.t_run AND r.t_dep < r.t_run + INTERVAL 1 DAY, false)::INT), 4) AS run_success,
 round(median(CASE WHEN r.t_dep >= r.t_run AND r.t_dep < r.t_run + INTERVAL 1 DAY THEN date_diff('second', r.t_run, r.t_dep) END) / 60.0, 1) AS median_minutes_to_deploy
FROM runs r JOIN prof p ON p.uid = r.uid WHERE r.t_run >= TIMESTAMP '2026-07-15' AND p.variant IS NOT NULL
GROUP BY 1 ORDER BY 1;

SELECT "Variant name" AS variant, count(DISTINCT uid) AS enrolled_users FROM ev WHERE event = '$experiment_started' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H7-ci-runner-incident — us-east runners 2026-08-25..27 (warehouse join)
-- ─────────────────────────────────────────────────────────────────────────
WITH o AS (SELECT DISTINCT date::DATE AS d, runner_region FROM wh_runner WHERE runner_status = 'major_outage'),
w AS (SELECT t_run::DATE AS d, (runner_region IN (SELECT runner_region FROM o)) AS hit, (pipeline_status = 'success') AS ok
  FROM runs WHERE t_run >= TIMESTAMP '2026-08-18' AND t_run < TIMESTAMP '2026-09-04'),
g AS (SELECT (d IN (SELECT d FROM o)) AS outage, avg(ok::INT) FILTER (WHERE hit) AS hit_success, avg(ok::INT) FILTER (WHERE NOT hit) AS other_success FROM w GROUP BY 1)
SELECT outage, round(hit_success, 4) AS affected_region_success, round(other_success, 4) AS other_region_success,
 round(hit_success / other_success, 4) AS relative_success FROM g ORDER BY outage;

SELECT runner_region, count(*) FILTER (WHERE runner_status = 'major_outage') AS outage_days,
 round(avg(infra_error_rate) FILTER (WHERE runner_status = 'major_outage'), 4) AS outage_error_rate,
 round(avg(queue_p95_seconds) FILTER (WHERE runner_status = 'major_outage'), 0) AS outage_queue_p95_s
FROM wh_runner GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H8-paid-channel-economics — spend per signup and buy rate by channel (warehouse join)
-- ─────────────────────────────────────────────────────────────────────────
WITH s AS (SELECT ch, count(*) AS n FROM signups GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM wh_marketing GROUP BY 1)
SELECT s.ch, s.n AS signups, round(sp.spend, 0) AS spend_usd, round(sp.spend / s.n, 2) AS spend_per_signup
FROM s JOIN sp ON sp.ch = s.ch ORDER BY 1;

-- paid-plan rate: Mixpanel funnel account created → subscription started,
-- 30-day conversion window (Mixpanel default), signups 2026-06-04 to 2026-08-31
CREATE OR REPLACE TEMP TABLE paid_funnel AS
WITH s AS (SELECT uid, t0, ch FROM signups WHERE t0 < TIMESTAMP '2026-09-01'),
b AS (SELECT DISTINCT s.uid FROM s JOIN ev e ON e.uid = s.uid AND e.event = 'subscription started'
  AND e.t >= s.t0 AND e.t < s.t0 + INTERVAL 30 DAY)
SELECT s.uid, s.ch, (b.uid IS NOT NULL) AS bought FROM s LEFT JOIN b ON b.uid = s.uid;

SELECT round(avg(bought::INT) FILTER (WHERE ch = 'linkedin_ads') / avg(bought::INT) FILTER (WHERE ch = 'paid_search'), 4) AS linkedin_vs_search_paid_rate
FROM paid_funnel;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H9-team-price-change — Team $20 → $25 per seat on 2026-08-17 (warehouse join)
-- ─────────────────────────────────────────────────────────────────────────
SELECT plan, (t >= TIMESTAMP '2026-08-17') AS post, count(*) AS subscriptions, round(avg(seats), 2) AS avg_seats
FROM ev WHERE event = 'subscription started' GROUP BY 1, 2 ORDER BY 1, 2;

WITH p AS (SELECT t::DATE AS d, plan, seats FROM ev WHERE event = 'subscription started'),
j AS (SELECT p.*, p.seats * b.list_price_per_seat_usd AS mrr FROM p JOIN wh_bookings b ON b.date::DATE = p.d AND b.plan = p.plan)
SELECT plan, (d >= DATE '2026-08-17') AS post, count(*) AS subscriptions, round(avg(mrr), 2) AS new_mrr_per_subscription
FROM j GROUP BY 1, 2 ORDER BY 1, 2;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H10-response-time-by-company-size — per-alert median trigger → ack
-- ─────────────────────────────────────────────────────────────────────────
SELECT p.company_size, count(*) AS acked_alerts, round(median(date_diff('second', a.t_trig, a.t_ack)) / 60.0, 2) AS median_minutes_to_ack
FROM alerts a JOIN prof p ON p.uid = a.uid WHERE a.t_ack >= a.t_trig GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H11-alert-fatigue — ack rate by alerts received in the window
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE TEMP TABLE alert_load AS
SELECT uid, count(*) AS alerts, count(t_ack) AS acks FROM alerts WHERE t_trig IS NOT NULL GROUP BY 1;

SELECT CASE WHEN alerts <= 12 THEN '01: 1-12' WHEN alerts < 30 THEN '02: 13-29' ELSE '03: 30+' END AS alerts_received,
 count(*) AS users, round(sum(acks)::DOUBLE / sum(alerts), 4) AS ack_rate
FROM alert_load GROUP BY 1 ORDER BY 1;

-- ═════════════════════════════════════════════════════════════════════════
-- EVAL QUERIES (eval/sass.eval.md)
-- ═════════════════════════════════════════════════════════════════════════

-- EVAL Q1 — Root Cause Assist and resolution time
SELECT CASE WHEN resolution_method = 'ai_assist' THEN 'ai_assist' ELSE 'manual_or_runbook' END AS method,
 count(*) AS resolutions, round(avg(resolution_time_mins), 1) AS avg_resolution_mins, round(median(resolution_time_mins), 1) AS median_resolution_mins
FROM ev WHERE event = 'alert resolved' AND t >= TIMESTAMP '2026-07-22' AND plan_tier IN ('business', 'enterprise')
GROUP BY 1 ORDER BY 1;
-- all Business/Enterprise resolutions, before vs after launch (blended)
SELECT (t >= TIMESTAMP '2026-07-22') AS after_launch, count(*) AS resolutions, round(avg(resolution_time_mins), 1) AS avg_resolution_mins
FROM ev WHERE event = 'alert resolved' AND plan_tier IN ('business', 'enterprise') GROUP BY 1 ORDER BY 1;
-- Free/Team control, before vs after
SELECT (t >= TIMESTAMP '2026-07-22') AS after_launch, count(*) AS resolutions, round(avg(resolution_time_mins), 1) AS avg_resolution_mins
FROM ev WHERE event = 'alert resolved' AND plan_tier IN ('free', 'team') GROUP BY 1 ORDER BY 1;

-- EVAL Q2 — Root Cause Assist adoption, weekly (and after the ramp, from 2026-08-19)
SELECT date_trunc('week', t)::DATE AS week, count(*) AS eligible_resolutions,
 round(avg((resolution_method = 'ai_assist')::INT), 4) AS ai_share
FROM ev WHERE event = 'alert resolved' AND t >= TIMESTAMP '2026-07-22' AND plan_tier IN ('business', 'enterprise')
GROUP BY 1 ORDER BY 1;
SELECT round(avg((resolution_method = 'ai_assist')::INT), 4) AS ai_share_overall, count(DISTINCT uid) FILTER (WHERE resolution_method = 'ai_assist') AS ai_users,
 round(avg((resolution_method = 'ai_assist')::INT) FILTER (WHERE t >= TIMESTAMP '2026-08-19'), 4) AS ai_share_from_aug_19
FROM ev WHERE event = 'alert resolved' AND t >= TIMESTAMP '2026-07-22' AND plan_tier IN ('business', 'enterprise');

-- EVAL Q3 — null: do alerts handled with Root Cause Assist also get acknowledged faster?
-- Alert level (alert_id holds trigger, acknowledgement, resolution), Business/Enterprise
-- resolutions since adoption leveled off (2026-08-19): acknowledgement time of alerts
-- resolved with ai_assist vs the other resolutions, with sub-splits by plan and company size.
CREATE OR REPLACE TEMP TABLE q3 AS
SELECT a.alert_id, a.response_time_mins AS r, a.resolution_method = 'ai_assist' AS ai, a.res_plan, p.company_size
FROM alerts a JOIN prof p ON p.uid = a.uid
WHERE a.t_res >= TIMESTAMP '2026-08-19' AND a.res_plan IN ('business', 'enterprise') AND a.response_time_mins IS NOT NULL;
WITH s AS (SELECT 'all' AS split, ai, r FROM q3
  UNION ALL SELECT 'plan=' || res_plan, ai, r FROM q3
  UNION ALL SELECT 'size=' || company_size, ai, r FROM q3),
g AS (SELECT split, ai, count(*) AS n, avg(r) AS m, var_samp(r) AS v, median(r) AS med, avg(ln(r + 0.1)) AS lm, var_samp(ln(r + 0.1)) AS lv FROM s GROUP BY 1, 2)
SELECT split, max(n) FILTER (WHERE ai) AS n_ai, max(n) FILTER (WHERE NOT ai) AS n_other,
 round(max(m) FILTER (WHERE ai), 2) AS avg_ack_ai, round(max(m) FILTER (WHERE NOT ai), 2) AS avg_ack_other,
 round(max(med) FILTER (WHERE ai), 2) AS median_ack_ai, round(max(med) FILTER (WHERE NOT ai), 2) AS median_ack_other,
 round((max(m) FILTER (WHERE ai) - max(m) FILTER (WHERE NOT ai)) / sqrt(sum(v / n)), 2) AS z_mean,
 round((max(lm) FILTER (WHERE ai) - max(lm) FILTER (WHERE NOT ai)) / sqrt(sum(lv / n)), 2) AS z_log
FROM g GROUP BY 1 ORDER BY 1;
-- context: the plain before/after read on Business/Enterprise acknowledgements (whole window)
SELECT (t >= TIMESTAMP '2026-07-22') AS after_launch, count(*) AS acks, round(avg(response_time_mins), 2) AS avg_response_mins,
 round(median(response_time_mins), 2) AS median_response_mins
FROM ev WHERE event = 'alert acknowledged' AND plan_tier IN ('business', 'enterprise') GROUP BY 1 ORDER BY 1;
WITH g AS (SELECT (t >= TIMESTAMP '2026-07-22') AS post, count(*) AS n, avg(response_time_mins) AS m, var_samp(response_time_mins) AS v,
  avg(ln(response_time_mins + 0.1)) AS lm, var_samp(ln(response_time_mins + 0.1)) AS lv
  FROM ev WHERE event = 'alert acknowledged' AND plan_tier IN ('business', 'enterprise') GROUP BY 1),
x AS (SELECT max(m) FILTER (WHERE post) - max(m) FILTER (WHERE NOT post) AS dm, sqrt(sum(v / n)) AS se,
  max(lm) FILTER (WHERE post) - max(lm) FILTER (WHERE NOT post) AS dl, sqrt(sum(lv / n)) AS lse FROM g)
SELECT round(dm / se, 2) AS z_mean, round(dl / lse, 2) AS z_log FROM x;
-- the same before/after for accounts whose plan did not change in the window vs accounts that upgraded during it
WITH fp AS (SELECT uid, arg_min(plan_tier, t) AS first_plan FROM ev GROUP BY 1)
SELECT fp.first_plan IN ('business', 'enterprise') AS on_plan_all_window, (e.t >= TIMESTAMP '2026-07-22') AS after_launch,
 count(*) AS acks, round(avg(e.response_time_mins), 2) AS avg_response_mins
FROM ev e JOIN fp ON fp.uid = e.uid WHERE e.event = 'alert acknowledged' AND e.plan_tier IN ('business', 'enterprise') GROUP BY 1, 2 ORDER BY 1, 2;

-- EVAL Q4 — onboarding conversion by cloud provider (with step detail)
SELECT cloud_provider, count(*) AS signups, round(avg(connected::INT), 4) AS connected_cloud,
 round(avg(installed::INT), 4) AS installed_agent, round(avg(converted::INT), 4) AS created_dashboard
FROM onboarding GROUP BY 1 ORDER BY 1;

-- EVAL Q5 — null: do SSO signups finish onboarding less often? (onboarding conversion by signup method)
SELECT signup_method, count(*) AS signups, round(avg(converted::INT), 4) AS onboarding_conversion
FROM onboarding GROUP BY 1 ORDER BY 1;
-- each method vs all other signups (two-proportion z)
WITH t AS (SELECT count(*) AS n, avg(converted::INT) AS p FROM onboarding),
g AS (SELECT signup_method AS m, count(*) AS n1, avg(converted::INT) AS p1 FROM onboarding GROUP BY 1),
x AS (SELECT g.m, g.n1, g.p1, t.n - g.n1 AS n2, (t.p * t.n - g.p1 * g.n1) / (t.n - g.n1) AS p2, t.p FROM g, t)
SELECT m AS signup_method, round(p1, 4) AS conversion, round(p2, 4) AS rest_conversion,
 round((p1 - p2) / sqrt(p * (1 - p) * (1.0 / n1 + 1.0 / n2)), 2) AS z_vs_rest FROM x ORDER BY 1;

-- EVAL Q6 — Slack + PagerDuty: acknowledgement and resolution time (profile connected_integrations)
SELECT CASE WHEN p.slack_and_pagerduty THEN 'slack_and_pagerduty' ELSE 'rest' END AS grp,
 count(DISTINCT a.uid) AS users,
 round(avg(a.response_time_mins), 2) AS avg_response_mins, round(median(a.response_time_mins), 2) AS median_response_mins,
 round(avg(a.resolution_time_mins) FILTER (WHERE a.resolution_method <> 'ai_assist'), 1) AS avg_resolution_mins_non_ai
FROM alerts a JOIN prof p ON p.uid = a.uid WHERE a.t_ack IS NOT NULL GROUP BY 1 ORDER BY 1;
-- share of alert recipients (users with at least one alert triggered) who have both
WITH r AS (SELECT DISTINCT uid FROM alerts WHERE t_trig IS NOT NULL)
SELECT count(*) AS alert_recipients, count(*) FILTER (WHERE p.slack_and_pagerduty) AS recipients_with_both,
 round(avg(p.slack_and_pagerduty::INT), 4) AS share_with_both
FROM r JOIN prof p ON p.uid = r.uid;
-- accounts set up before the window (customer_since before 2026-05-14) and new signups before/after both were live
SELECT CASE WHEN p.slack_and_pagerduty THEN 'slack_and_pagerduty' ELSE 'rest' END AS grp, count(DISTINCT a.uid) AS users,
 round(avg(a.response_time_mins), 2) AS avg_response_mins
FROM alerts a JOIN prof p ON p.uid = a.uid
WHERE a.t_ack IS NOT NULL AND p.customer_since < '2026-05-14' GROUP BY 1 ORDER BY 1;
SELECT CASE WHEN a.t_trig >= i.ready THEN 'after' ELSE 'before' END AS grp, count(DISTINCT a.uid) AS users, count(*) AS acks,
 round(avg(a.response_time_mins), 2) AS avg_response_mins
FROM alerts a JOIN integrated i ON i.uid = a.uid JOIN signups s ON s.uid = a.uid
WHERE a.t_ack IS NOT NULL AND a.t_trig IS NOT NULL GROUP BY 1 ORDER BY 1;
-- new signups who never configured both (reference)
SELECT count(DISTINCT a.uid) AS users, round(avg(a.response_time_mins), 2) AS avg_response_mins
FROM alerts a JOIN signups s ON s.uid = a.uid WHERE a.t_ack IS NOT NULL AND a.uid NOT IN (SELECT uid FROM integrated);

-- EVAL Q7 — time to acknowledge by company size (median minutes, per alert)
SELECT p.company_size, count(*) AS acked_alerts, round(median(date_diff('second', a.t_trig, a.t_ack)) / 60.0, 2) AS median_minutes_to_ack,
 round(avg(a.response_time_mins), 2) AS avg_response_mins
FROM alerts a JOIN prof p ON p.uid = a.uid WHERE a.t_ack >= a.t_trig GROUP BY 1 ORDER BY 1;

-- EVAL Q8 — alert fatigue: ack rate by alerts received
SELECT CASE WHEN alerts <= 6 THEN '01: 1-6' WHEN alerts <= 12 THEN '02: 7-12' WHEN alerts <= 18 THEN '03: 13-18'
            WHEN alerts <= 24 THEN '04: 19-24' WHEN alerts < 30 THEN '05: 25-29' WHEN alerts < 45 THEN '06: 30-44' ELSE '07: 45+' END AS alerts_received,
 count(*) AS users, round(sum(acks)::DOUBLE / sum(alerts), 4) AS ack_rate
FROM alert_load GROUP BY 1 ORDER BY 1;
SELECT count(*) FILTER (WHERE alerts >= 30) AS users_30_plus, round(avg((alerts >= 30)::INT), 4) AS share_30_plus,
 round(sum(alerts) FILTER (WHERE alerts >= 30)::DOUBLE / sum(alerts), 4) AS share_of_alerts_30_plus FROM alert_load;

-- EVAL Q9 — first-week invites and retention
SELECT least(early_invites, 4) AS first_week_invites, count(*) AS users, round(avg(d7::INT), 4) AS d7_retention, round(avg(d30::INT), 4) AS d30_retention
FROM activation GROUP BY 1 ORDER BY 1;
SELECT CASE WHEN early_invites >= 2 THEN 'activated' ELSE 'not_activated' END AS grp, count(*) AS users,
 round(avg(d30::INT), 4) AS d30_retention, round(count(*)::DOUBLE / sum(count(*)) OVER (), 4) AS share
FROM activation GROUP BY 1 ORDER BY 1;
-- onboarding completion and retention (setup matters too)
SELECT onboarded, count(*) AS users, round(avg(d7::INT), 4) AS d7_retention, round(avg(d30::INT), 4) AS d30_retention
FROM activation GROUP BY 1 ORDER BY 1;
SELECT onboarded, CASE WHEN early_invites >= 2 THEN 'activated' ELSE 'not_activated' END AS grp, count(*) AS users, round(avg(d30::INT), 4) AS d30_retention
FROM activation GROUP BY 1, 2 ORDER BY 1, 2;

-- EVAL Q10 — Smart Test Selection results
SELECT p.variant, count(DISTINCT r.uid) AS users, count(*) AS runs,
 round(avg((r.pipeline_status = 'success')::INT), 4) AS run_success,
 round(median(CASE WHEN r.t_dep >= r.t_run AND r.t_dep < r.t_run + INTERVAL 1 DAY THEN date_diff('second', r.t_run, r.t_dep) END) / 60.0, 1) AS median_minutes_to_deploy,
 round(count(*)::DOUBLE / count(DISTINCT r.uid), 2) AS runs_per_user
FROM runs r JOIN prof p ON p.uid = r.uid WHERE r.t_run >= TIMESTAMP '2026-07-15' AND p.variant IS NOT NULL
GROUP BY 1 ORDER BY 1;

-- EVAL Q11 — late-August deploy failures (warehouse runner health)
SELECT t_run::DATE AS day, runner_region = 'us-east' AS us_east, count(*) AS runs, round(avg((pipeline_status = 'success')::INT), 4) AS success_rate
FROM runs WHERE t_run >= TIMESTAMP '2026-08-22' AND t_run < TIMESTAMP '2026-08-31' GROUP BY 1, 2 ORDER BY 1, 2;
WITH w AS (SELECT (t_run >= TIMESTAMP '2026-08-25' AND t_run < TIMESTAMP '2026-08-28') AS incident, runner_region = 'us-east' AS us_east, pipeline_status = 'success' AS ok
  FROM runs WHERE t_run >= TIMESTAMP '2026-08-18' AND t_run < TIMESTAMP '2026-09-04')
SELECT incident, us_east, count(*) AS runs, round(avg(ok::INT), 4) AS success_rate FROM w GROUP BY 1, 2 ORDER BY 1, 2;
-- deploys lost: us-east successes expected at the surrounding-days relative rate, minus actual
WITH w AS (SELECT (t_run >= TIMESTAMP '2026-08-25' AND t_run < TIMESTAMP '2026-08-28') AS incident, runner_region = 'us-east' AS us_east, pipeline_status = 'success' AS ok
  FROM runs WHERE t_run >= TIMESTAMP '2026-08-18' AND t_run < TIMESTAMP '2026-09-04'),
r AS (SELECT
  avg(ok::INT) FILTER (WHERE incident AND us_east) AS inc_e, count(*) FILTER (WHERE incident AND us_east) AS n_inc_e,
  avg(ok::INT) FILTER (WHERE incident AND NOT us_east) AS inc_o,
  avg(ok::INT) FILTER (WHERE NOT incident AND us_east) AS base_e, avg(ok::INT) FILTER (WHERE NOT incident AND NOT us_east) AS base_o FROM w)
SELECT round((inc_e / inc_o) / (base_e / base_o), 4) AS relative_success_did, n_inc_e AS us_east_incident_runs,
 round(n_inc_e * (inc_o * base_e / base_o - inc_e), 0) AS deploys_lost FROM r;
SELECT date::DATE AS day, runner_region, jobs_started, infra_error_rate, queue_p95_seconds, runner_status
FROM wh_runner WHERE date::DATE BETWEEN DATE '2026-08-24' AND DATE '2026-08-28' AND runner_region IN ('us-east', 'us-west') ORDER BY 1, 2;

-- EVAL Q12 — did the incident touch other regions? (null for the other regions)
WITH w AS (SELECT (t_run >= TIMESTAMP '2026-08-25' AND t_run < TIMESTAMP '2026-08-28') AS incident, runner_region, pipeline_status = 'success' AS ok
  FROM runs WHERE t_run >= TIMESTAMP '2026-08-18' AND t_run < TIMESTAMP '2026-09-04')
SELECT runner_region, count(*) FILTER (WHERE incident) AS incident_runs, round(avg(ok::INT) FILTER (WHERE incident), 4) AS incident_success,
 round(avg(ok::INT) FILTER (WHERE NOT incident), 4) AS surrounding_success
FROM w GROUP BY 1 ORDER BY 1;
-- the three other regions pooled, with a two-proportion z (incident vs surrounding days)
WITH w AS (SELECT (t_run >= TIMESTAMP '2026-08-25' AND t_run < TIMESTAMP '2026-08-28') AS incident, pipeline_status = 'success' AS ok
  FROM runs WHERE t_run >= TIMESTAMP '2026-08-18' AND t_run < TIMESTAMP '2026-09-04' AND runner_region <> 'us-east'),
x AS (SELECT count(*) FILTER (WHERE incident) AS n1, avg(ok::INT) FILTER (WHERE incident) AS p1,
  count(*) FILTER (WHERE NOT incident) AS n2, avg(ok::INT) FILTER (WHERE NOT incident) AS p2, avg(ok::INT) AS p FROM w)
SELECT n1 AS incident_runs, round(p1, 4) AS incident_success, round(p2, 4) AS surrounding_success,
 round((p1 - p2) / sqrt(p * (1 - p) * (1.0 / n1 + 1.0 / n2)), 2) AS z FROM x;
-- ap-south has few runs: its success rate over every Tuesday-Thursday span in the window (normal range)
WITH r AS (SELECT t_run::DATE AS d, pipeline_status = 'success' AS ok FROM runs WHERE runner_region = 'ap-south'),
w AS (SELECT d0.d AS start, count(*) AS n, avg(ok::INT) AS s FROM (SELECT DISTINCT d FROM r WHERE dayofweek(d) = 2) d0
  JOIN r ON r.d >= d0.d AND r.d < d0.d + 3 GROUP BY 1)
SELECT count(*) AS tue_thu_spans, round(min(s), 4) AS min_success, round(quantile_cont(s, 0.1), 4) AS p10_success,
 round(median(s), 4) AS median_success, round(max(s), 4) AS max_success, round(avg(n), 0) AS avg_runs FROM w;

-- EVAL Q13 — spend per signup by paid channel (warehouse join)
WITH s AS (SELECT ch, count(*) AS n FROM signups GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend, sum(platform_reported_leads) AS leads FROM wh_marketing GROUP BY 1)
SELECT s.ch, s.n AS mixpanel_signups, round(sp.spend, 0) AS spend_usd, round(sp.spend / s.n, 2) AS spend_per_signup,
 sp.leads AS platform_reported_leads, round(sp.spend / sp.leads, 2) AS spend_per_platform_lead
FROM s JOIN sp ON sp.ch = s.ch ORDER BY 1;
-- day level: spend is a paced budget (never zero); daily cost per signup swings with the day's signups
WITH d AS (SELECT date::DATE AS d, acquisition_channel AS ch, spend_usd FROM wh_marketing),
n AS (SELECT t0::DATE AS d, ch, count(*) AS signups FROM signups GROUP BY 1, 2)
SELECT d.ch, round(min(spend_usd), 0) AS min_daily_spend, round(avg(spend_usd), 0) AS avg_daily_spend, round(max(spend_usd), 0) AS max_daily_spend,
 count(*) FILTER (WHERE spend_usd = 0) AS zero_spend_days, count(*) FILTER (WHERE coalesce(n.signups, 0) = 0) AS zero_signup_days,
 round(avg(spend_usd) FILTER (WHERE dayofweek(d.d) IN (0, 6)), 0) AS avg_weekend_spend
FROM d LEFT JOIN n ON n.d = d.d AND n.ch = d.ch GROUP BY 1 ORDER BY 1;

-- EVAL Q14 — paid-plan rate (30-day funnel window, signups Jun 4 - Aug 31) and cost per paying customer by channel
WITH s AS (SELECT ch, count(*) AS signups, count(*) FILTER (WHERE bought) AS buyers FROM paid_funnel GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM wh_marketing WHERE date::DATE < DATE '2026-09-01' GROUP BY 1)
SELECT s.ch, s.signups, s.buyers, round(s.buyers::DOUBLE / s.signups, 4) AS paid_rate_30d,
 round(sp.spend, 0) AS spend_jun4_aug31, round(sp.spend / nullif(s.buyers, 0), 0) AS spend_per_paying_customer
FROM s LEFT JOIN sp ON sp.ch = s.ch ORDER BY paid_rate_30d DESC;
-- two-proportion z, LinkedIn vs paid search
WITH x AS (SELECT count(*) FILTER (WHERE ch = 'linkedin_ads') AS n1, avg(bought::INT) FILTER (WHERE ch = 'linkedin_ads') AS p1,
  count(*) FILTER (WHERE ch = 'paid_search') AS n2, avg(bought::INT) FILTER (WHERE ch = 'paid_search') AS p2,
  avg(bought::INT) FILTER (WHERE ch IN ('linkedin_ads', 'paid_search')) AS p FROM paid_funnel)
SELECT round(p1 / p2, 4) AS ratio, round((p1 - p2) / sqrt(p * (1 - p) * (1.0 / n1 + 1.0 / n2)), 2) AS z FROM x;

-- EVAL Q15 — Team price change: did new Team subscriptions fall?
SELECT (t >= TIMESTAMP '2026-08-17') AS post, count(*) FILTER (WHERE plan = 'team') AS team, count(*) FILTER (WHERE plan = 'business') AS business,
 round(count(*) FILTER (WHERE plan = 'team')::DOUBLE / count(*), 4) AS team_share,
 round(count(*) FILTER (WHERE plan = 'team')::DOUBLE / count(*) FILTER (WHERE plan = 'business'), 4) AS team_per_business,
 round(avg(seats) FILTER (WHERE plan = 'team'), 2) AS team_avg_seats, round(avg(seats) FILTER (WHERE plan = 'business'), 2) AS business_avg_seats
FROM ev WHERE event = 'subscription started' GROUP BY 1 ORDER BY 1;
-- two-proportion z for Team share of new subscriptions, before vs after
WITH g AS (SELECT (t >= TIMESTAMP '2026-08-17') AS post, count(*) AS n, avg((plan = 'team')::INT) AS p FROM ev WHERE event = 'subscription started' GROUP BY 1),
x AS (SELECT max(n) FILTER (WHERE post) AS n1, max(p) FILTER (WHERE post) AS p1, max(n) FILTER (WHERE NOT post) AS n2, max(p) FILTER (WHERE NOT post) AS p2 FROM g)
SELECT round(p1 - p2, 4) AS team_share_diff, round((p1 - p2) / sqrt(((p1 * n1 + p2 * n2) / (n1 + n2)) * (1 - (p1 * n1 + p2 * n2) / (n1 + n2)) * (1.0 / n1 + 1.0 / n2)), 2) AS z FROM x;
-- equal 6-week windows either side of the change
SELECT (t >= TIMESTAMP '2026-08-17') AS post, count(*) FILTER (WHERE plan = 'team') AS team, count(*) FILTER (WHERE plan = 'business') AS business,
 round(avg(seats) FILTER (WHERE plan = 'team'), 2) AS team_avg_seats
FROM ev WHERE event = 'subscription started' AND t >= TIMESTAMP '2026-07-06' AND t < TIMESTAMP '2026-09-28' GROUP BY 1 ORDER BY 1;

-- new subscriptions by month and plan (events), for the overall trend behind Q15 and Q18
SELECT strftime(t, '%Y-%m') AS month, count(*) FILTER (WHERE plan = 'team') AS team, count(*) FILTER (WHERE plan = 'business') AS business,
 round(count(*) FILTER (WHERE plan = 'team')::DOUBLE / count(*), 4) AS team_share
FROM ev WHERE event = 'subscription started' GROUP BY 1 ORDER BY 1;

-- EVAL Q16 — Team new MRR before vs after the price change (warehouse)
SELECT plan, (date::DATE >= DATE '2026-08-17') AS post, count(*) AS days, sum(new_subscriptions) AS subscriptions, sum(new_seats) AS seats,
 round(sum(new_mrr_usd), 0) AS new_mrr_usd, round(sum(new_mrr_usd) / count(*), 1) AS new_mrr_per_day,
 round(sum(new_mrr_usd) / nullif(sum(new_subscriptions), 0), 2) AS new_mrr_per_subscription
FROM wh_bookings GROUP BY 1, 2 ORDER BY 1, 2;

-- EVAL Q17 — quarter-close promotion and invites, paid plans vs Free
SELECT CASE WHEN plan_tier IN ('team', 'business', 'enterprise') THEN 'paid' ELSE 'free' END AS plan_group,
 CASE WHEN t < TIMESTAMP '2026-09-16' THEN '1: Sep 1-15' ELSE '2: Sep 16-30' END AS period,
 count(*) FILTER (WHERE event = 'teammate invited') AS invites, count(*) FILTER (WHERE event = 'dashboard viewed') AS dashboard_views,
 count(DISTINCT uid) FILTER (WHERE event = 'teammate invited') AS inviting_users,
 round(count(*) FILTER (WHERE event = 'teammate invited')::DOUBLE / count(*) FILTER (WHERE event = 'dashboard viewed'), 4) AS invites_per_view
FROM ev WHERE t >= TIMESTAMP '2026-09-01' AND t < TIMESTAMP '2026-10-01' GROUP BY 1, 2 ORDER BY 1, 2;
SELECT CASE WHEN plan_tier IN ('team', 'business', 'enterprise') THEN 'paid' ELSE 'free' END AS plan_group, round(
 (count(*) FILTER (WHERE event = 'teammate invited' AND t >= TIMESTAMP '2026-09-16')::DOUBLE / count(*) FILTER (WHERE event = 'dashboard viewed' AND t >= TIMESTAMP '2026-09-16'))
 / (count(*) FILTER (WHERE event = 'teammate invited' AND t < TIMESTAMP '2026-09-16')::DOUBLE / count(*) FILTER (WHERE event = 'dashboard viewed' AND t < TIMESTAMP '2026-09-16')), 4) AS lift
FROM ev WHERE t >= TIMESTAMP '2026-09-01' AND t < TIMESTAMP '2026-10-01' GROUP BY 1 ORDER BY 1;

-- EVAL Q18 — new bookings by month and plan (warehouse)
SELECT strftime(date::DATE, '%Y-%m') AS month, plan, sum(new_subscriptions) AS subscriptions, sum(new_seats) AS seats,
 round(sum(new_mrr_usd), 0) AS new_mrr_usd, round(sum(new_arr_usd), 0) AS new_arr_usd
FROM wh_bookings GROUP BY 1, 2 ORDER BY 1, 2;
SELECT strftime(date::DATE, '%Y-%m') AS month, sum(new_subscriptions) AS subscriptions, round(sum(new_mrr_usd), 0) AS new_mrr_usd FROM wh_bookings GROUP BY 1 ORDER BY 1;

-- EVAL Q19 — null: did the runner incident make customers stop acknowledging alerts or using dashboards?
-- Usage is weekday-heavy, so compare the incident days (Tue Aug 25 - Thu Aug 27)
-- with the same weekdays one week before (Aug 18-20) and one week after (Sep 1-3).
CREATE OR REPLACE TEMP TABLE q19_days AS
SELECT d, CASE WHEN d BETWEEN DATE '2026-08-25' AND DATE '2026-08-27' THEN 'incident' ELSE 'comparison' END AS grp
FROM (SELECT unnest([DATE '2026-08-18', DATE '2026-08-19', DATE '2026-08-20', DATE '2026-08-25', DATE '2026-08-26',
  DATE '2026-08-27', DATE '2026-09-01', DATE '2026-09-02', DATE '2026-09-03']) AS d);
-- acknowledgement rate of alerts triggered on those days (match on alert_id), dashboard views and queries per day
WITH a AS (SELECT q.grp, count(*) AS alerts, count(a.t_ack) AS acked FROM alerts a JOIN q19_days q ON q.d = a.t_trig::DATE GROUP BY 1),
u AS (SELECT q.grp, count(*) FILTER (WHERE e.event = 'dashboard viewed') AS views, count(*) FILTER (WHERE e.event = 'query executed') AS queries,
  count(DISTINCT e.t::DATE) AS days FROM ev e JOIN q19_days q ON q.d = e.t::DATE GROUP BY 1),
p AS (SELECT sum(acked)::DOUBLE / sum(alerts) AS pp FROM a)
SELECT a.grp, a.alerts, round(a.acked::DOUBLE / a.alerts, 4) AS ack_rate,
 round((a.acked::DOUBLE / a.alerts - (SELECT pp FROM p)) / sqrt((SELECT pp * (1 - pp) FROM p) / a.alerts), 2) AS z_vs_pooled,
 round(u.views::DOUBLE / u.days, 1) AS dashboard_views_per_day, round(u.queries::DOUBLE / u.days, 1) AS queries_per_day
FROM a JOIN u ON u.grp = a.grp ORDER BY 1;
-- two-proportion z on the acknowledgement rate, incident vs comparison days
WITH a AS (SELECT q.grp, count(*) AS n, avg((a.t_ack IS NOT NULL)::INT) AS r FROM alerts a JOIN q19_days q ON q.d = a.t_trig::DATE GROUP BY 1),
x AS (SELECT max(n) FILTER (WHERE grp = 'incident') AS n1, max(r) FILTER (WHERE grp = 'incident') AS p1,
  max(n) FILTER (WHERE grp = 'comparison') AS n2, max(r) FILTER (WHERE grp = 'comparison') AS p2 FROM a)
SELECT round(p1, 4) AS incident_ack_rate, round(p2, 4) AS comparison_ack_rate,
 round((p1 - p2) / sqrt(((p1 * n1 + p2 * n2) / (n1 + n2)) * (1 - (p1 * n1 + p2 * n2) / (n1 + n2)) * (1.0 / n1 + 1.0 / n2)), 2) AS z FROM x;
-- daily dashboard views on each of the nine days, and the range over every Tue-Thu span in the window
SELECT e.t::DATE AS day, q.grp, count(*) AS dashboard_views FROM ev e JOIN q19_days q ON q.d = e.t::DATE
WHERE e.event = 'dashboard viewed' GROUP BY 1, 2 ORDER BY 1;
WITH v AS (SELECT t::DATE AS d, count(*) AS n FROM ev WHERE event = 'dashboard viewed' GROUP BY 1),
s AS (SELECT d FROM v WHERE dayofweek(d) = 2),
x AS (SELECT s.d AS span_start, avg(v.n) AS views FROM s JOIN v ON v.d >= s.d AND v.d < s.d + 3 GROUP BY 1)
SELECT count(*) AS tue_thu_spans, round(min(views), 0) AS min_views_per_day, round(median(views), 0) AS median_views_per_day,
 round(max(views), 0) AS max_views_per_day, round(max(views) FILTER (WHERE span_start = DATE '2026-08-25'), 0) AS incident_views_per_day FROM x;
-- acknowledgement time (not slower): averages, and the within-user change for users with acknowledgements on both sets of days
WITH w AS (SELECT a.uid, q.grp, a.response_time_mins AS r FROM alerts a JOIN q19_days q ON q.d = a.t_ack::DATE WHERE a.t_ack IS NOT NULL),
u AS (SELECT uid, avg(r) FILTER (WHERE grp = 'incident') AS mi, avg(r) FILTER (WHERE grp = 'comparison') AS mc FROM w GROUP BY 1
  HAVING count(*) FILTER (WHERE grp = 'incident') > 0 AND count(*) FILTER (WHERE grp = 'comparison') > 0)
SELECT (SELECT round(avg(r), 2) FROM w WHERE grp = 'incident') AS incident_avg_ack_mins,
 (SELECT round(avg(r), 2) FROM w WHERE grp = 'comparison') AS comparison_avg_ack_mins,
 count(*) AS users_on_both, round(avg(mi - mc), 2) AS within_user_change_mins,
 round(avg(mi - mc) / (stddev(mi - mc) / sqrt(count(*))), 2) AS z_paired FROM u;

-- EVAL Q20 — headline numbers for the Q4 risk review
SELECT 'azure_onboarding' AS metric, round(avg(converted::INT) FILTER (WHERE cloud_provider = 'azure'), 4) AS value FROM onboarding
UNION ALL SELECT 'non_azure_onboarding', round(avg(converted::INT) FILTER (WHERE cloud_provider <> 'azure'), 4) FROM onboarding
UNION ALL SELECT 'azure_share_of_signups', round(avg((cloud_provider = 'azure')::INT), 4) FROM onboarding
UNION ALL SELECT 'not_activated_share', round(avg((early_invites < 2)::INT), 4) FROM activation
UNION ALL SELECT 'users_30_plus_alerts_share', round(avg((alerts >= 30)::INT), 4) FROM alert_load
UNION ALL SELECT 'alert_recipients_without_slack_and_pagerduty', round(avg((NOT p.slack_and_pagerduty)::INT), 4) FROM alert_load l JOIN prof p ON p.uid = l.uid
UNION ALL SELECT 'linkedin_share_of_paid_spend', round((SELECT sum(spend_usd) FROM wh_marketing WHERE acquisition_channel = 'linkedin_ads') / (SELECT sum(spend_usd) FROM wh_marketing), 4)
UNION ALL SELECT 'total_paid_spend_usd', round((SELECT sum(spend_usd) FROM wh_marketing), 0)
UNION ALL SELECT 'team_mrr_per_sub_post_vs_pre', round(
  (SELECT sum(new_mrr_usd) / sum(new_subscriptions) FROM wh_bookings WHERE plan = 'team' AND date::DATE >= DATE '2026-08-17')
  / (SELECT sum(new_mrr_usd) / sum(new_subscriptions) FROM wh_bookings WHERE plan = 'team' AND date::DATE < DATE '2026-08-17'), 4);
