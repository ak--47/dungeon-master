-- Ticketloop (support-desk vertical) — story-keyed and eval-keyed DuckDB queries.
--
-- Generate first (repo root):
--   node scripts/verify-runner.mjs dungeons/vertical/support-desk/support-desk.js verify-support-desk
-- Run:
--   duckdb -c ".read dungeons/vertical/support-desk/support-desk.sql"
-- Against a gzipped export:
--   duckdb -c "SET VARIABLE data_prefix='<dir>/support-desk'" -c ".read support-desk.sql"
--
-- All times are UTC. Window: 2026-06-04 00:00 to 2026-10-01 23:59:59.
-- Timeline: Skills Routing test 2026-07-08; Reply Assist 2026-07-21; back-to-school
-- 2026-08-17 to 2026-09-13; Growth price change 2026-08-18; email ingestion
-- incident 2026-08-26 to 2026-08-27 (backlog reaches agents 2026-08-28);
-- US holidays 2026-07-03 and 2026-09-07.

SET VARIABLE data_prefix = COALESCE(getvariable('data_prefix'), 'data/verify-support-desk');

-- ─────────────────────────────────────────────────────────────────────────
-- PRELUDE: raw files, identity resolution, warehouse tables
-- ─────────────────────────────────────────────────────────────────────────
-- Identity: a trial signup is identified at "account created" (the auth event,
-- which carries user_id and device_id). A device resolves to the user seen
-- with it on any event that carries both ids, the way Mixpanel stitches.
-- Every Ticketloop event carries user_id, so uid = user_id in practice.

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

CREATE OR REPLACE TEMP TABLE wh_paid AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-paid_marketing_daily.json*', sample_size=-1, union_by_name=true);
CREATE OR REPLACE TEMP TABLE wh_inbound AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-inbound_channel_daily.json*', sample_size=-1, union_by_name=true);
CREATE OR REPLACE TEMP TABLE wh_billing AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-subscription_billing_daily.json*', sample_size=-1, union_by_name=true);

-- profile attributes keyed by the resolved user id
CREATE OR REPLACE TEMP TABLE prof AS
SELECT distinct_id::VARCHAR AS uid, company_id, company_size, industry, region, role, plan_tier AS current_plan, email_provider,
 acquisition_channel, customer_since, agent_seats, "Experiment: Skills Routing" AS variant
FROM users;

-- trial signups in the window (one "account created" per new workspace owner)
CREATE OR REPLACE TEMP TABLE signups AS
SELECT uid, min(t) AS t0, any_value(acquisition_channel) AS ch, any_value(email_provider) AS provider
FROM ev WHERE event = 'account created' GROUP BY 1;

-- one row per ticket assigned in the window (ticket_id ties every step of a ticket)
CREATE OR REPLACE TEMP TABLE tickets AS
SELECT ticket_id, any_value(uid) FILTER (WHERE event = 'ticket assigned') AS uid,
 min(t) FILTER (WHERE event = 'ticket assigned') AS t0,
 any_value(channel) FILTER (WHERE event = 'ticket assigned') AS channel,
 any_value(priority) FILTER (WHERE event = 'ticket assigned') AS priority,
 any_value(category) FILTER (WHERE event = 'ticket assigned') AS category,
 any_value(plan_tier) FILTER (WHERE event = 'ticket assigned') AS plan_at_assignment,
 min(t) FILTER (WHERE event = 'reply sent') AS t1,
 arg_min(reply_method, t) FILTER (WHERE event = 'reply sent') AS first_reply_method,
 min(t) FILTER (WHERE event = 'ticket resolved') AS t2,
 count(*) FILTER (WHERE event = 'ticket escalated') > 0 AS escalated,
 count(*) FILTER (WHERE event = 'ticket reopened') > 0 AS reopened,
 any_value(score) FILTER (WHERE event = 'csat received') AS csat_score
FROM ev WHERE ticket_id IS NOT NULL
GROUP BY 1 HAVING min(t) FILTER (WHERE event = 'ticket assigned') IS NOT NULL;

-- dataset overview
SELECT count(*) AS events, count(DISTINCT uid) AS users_with_events, (SELECT count(*) FROM users) AS profiles,
 (SELECT count(*) FROM signups) AS trial_signups, (SELECT count(*) FROM tickets) AS tickets_assigned,
 (SELECT count(*) FROM companies) AS companies, min(t) AS first_event, max(t) AS last_event FROM ev;

-- identity check: every event resolves to a user; server-side events carry no device
SELECT count(*) FILTER (WHERE uid IS NULL) AS unresolved_events,
 count(*) FILTER (WHERE event IN ('ticket assigned', 'ticket reopened', 'csat received', 'subscription started') AND device_id IS NOT NULL) AS server_events_with_device
FROM ev;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H1-reply-assist-launch — AI-drafted first replies ×0.5 time, Growth/Enterprise from 2026-07-21
-- ─────────────────────────────────────────────────────────────────────────
-- per ticket: ticket assigned → first reply sent within 7 days; tickets Jul 21 - Sep 24
SELECT CASE WHEN first_reply_method = 'ai_draft' THEN 'ai_draft' ELSE 'other (typed, macro)' END AS first_reply, count(DISTINCT uid) AS users, count(*) AS tickets,
 round(median(date_diff('second', t0, t1)) / 60.0, 1) AS median_minutes_to_first_reply
FROM tickets
WHERE plan_at_assignment IN ('growth', 'enterprise') AND t0 >= TIMESTAMP '2026-07-21' AND t0 < TIMESTAMP '2026-09-24 23:59:59'
  AND t1 < t0 + INTERVAL 7 DAY
GROUP BY 1 ORDER BY 1;

-- AI share of eligible first replies once the 21-day ramp is done (from 2026-08-11)
SELECT round(avg((first_reply_method = 'ai_draft')::INT), 4) AS ai_share_of_first_replies, count(*) AS tickets
FROM tickets WHERE plan_at_assignment IN ('growth', 'enterprise') AND t0 >= TIMESTAMP '2026-08-11' AND t1 IS NOT NULL;

-- purity: no AI draft before launch or outside Growth/Enterprise
SELECT count(*) FILTER (WHERE reply_method = 'ai_draft' AND (t < TIMESTAMP '2026-07-21' OR plan_tier NOT IN ('growth', 'enterprise'))) AS impure_ai_replies
FROM ev WHERE event = 'reply sent';

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H2-resolution-time-by-priority — urgent ×0.3, high ×0.6, low ×1.5 vs normal
-- ─────────────────────────────────────────────────────────────────────────
-- per ticket: ticket assigned → first ticket resolved within 14 days; tickets through Sep 17
SELECT priority, count(*) AS resolved_tickets, round(median(date_diff('second', t0, t2)) / 3600.0, 2) AS median_hours_to_resolve,
 round(median_hours_to_resolve / max(median_hours_to_resolve) FILTER (WHERE priority = 'normal') OVER (), 3) AS ratio_to_normal
FROM (SELECT * FROM tickets WHERE t0 < TIMESTAMP '2026-09-17 23:59:59' AND t2 < t0 + INTERVAL 14 DAY)
GROUP BY 1 ORDER BY 3;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H3-microsoft-365-onboarding — setup completion 37% vs 68%
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE TEMP TABLE onboarding AS
WITH ib AS (SELECT uid, min(t) AS t1 FROM ev WHERE event = 'inbox connected' GROUP BY 1),
wg AS (SELECT uid, min(t) AS t2 FROM ev WHERE event = 'widget installed' GROUP BY 1)
SELECT s.uid, s.t0, s.ch, s.provider,
 coalesce(ib.t1 < s.t0 + INTERVAL 7 DAY, false) AS inbox_7d,
 coalesce(ib.t1 >= s.t0 AND wg.t2 >= ib.t1 AND wg.t2 < s.t0 + INTERVAL 7 DAY, false) AS completed_7d,
 ib.t1 IS NOT NULL AS inbox_ever
FROM signups s LEFT JOIN ib ON ib.uid = s.uid LEFT JOIN wg ON wg.uid = s.uid;

SELECT CASE WHEN provider = 'microsoft_365' THEN 'microsoft_365' ELSE 'google_workspace + other' END AS provider_group, count(*) AS signups,
 round(avg(inbox_7d::INT), 4) AS inbox_connected_7d, round(avg(completed_7d::INT), 4) AS setup_completed_7d
FROM onboarding WHERE t0 < TIMESTAMP '2026-09-24 23:59:59' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H4-paid-channel-economics — spend per signup and 30-day paid conversion by channel (warehouse join)
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE TEMP TABLE first_purchase AS
SELECT uid, min(t) AS tb, arg_min(plan, t) AS plan, arg_min(seats, t) AS seats FROM ev WHERE event = 'subscription started' GROUP BY 1;

WITH g AS (SELECT s.ch, count(*) AS signups,
  count(*) FILTER (WHERE s.t0 < TIMESTAMP '2026-09-01 23:59:59') AS mature_signups,
  count(*) FILTER (WHERE s.t0 < TIMESTAMP '2026-09-01 23:59:59' AND p.tb < s.t0 + INTERVAL 30 DAY) AS paid_30d
  FROM signups s LEFT JOIN first_purchase p ON p.uid = s.uid GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM wh_paid GROUP BY 1)
SELECT g.ch, g.signups, round(sp.spend, 0) AS spend_usd, round(sp.spend / g.signups, 2) AS spend_per_signup,
 round(g.paid_30d::DOUBLE / g.mature_signups, 4) AS paid_rate_30d, round(sp.spend / (g.signups * g.paid_30d::DOUBLE / g.mature_signups), 0) AS spend_per_paid_workspace
FROM g LEFT JOIN sp ON sp.ch = g.ch ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H5-skills-routing-experiment — first reply ×0.7, reopen rate ×0.6 from 2026-07-08
-- ─────────────────────────────────────────────────────────────────────────
SELECT p.variant, count(DISTINCT k.uid) AS users, count(*) AS tickets,
 round(median(date_diff('second', k.t0, k.t1)) FILTER (WHERE k.t1 < k.t0 + INTERVAL 7 DAY AND k.t0 < TIMESTAMP '2026-09-24 23:59:59') / 60.0, 1) AS median_minutes_to_first_reply,
 round(avg(k.reopened::INT) FILTER (WHERE k.t2 IS NOT NULL AND k.t0 < TIMESTAMP '2026-09-10 23:59:59'), 4) AS reopen_rate,
 round(avg(k.escalated::INT), 4) AS escalation_rate
FROM tickets k JOIN prof p ON p.uid = k.uid
WHERE k.t0 >= TIMESTAMP '2026-07-08' AND p.variant IS NOT NULL GROUP BY 1 ORDER BY 1;

SELECT "Variant name" AS variant, count(DISTINCT uid) AS exposed_users, min(t) AS first_exposure FROM ev WHERE event = '$experiment_started' GROUP BY 1 ORDER BY 1;

-- the arm belongs to the customer account: one arm per company_id, and single-agent workspaces are not in the test
WITH c AS (SELECT company_id, count(*) AS members, count(variant) AS exposed, count(DISTINCT variant) AS arms FROM prof GROUP BY 1)
SELECT CASE WHEN members = 1 THEN 'single-agent workspaces' ELSE 'accounts with 2+ agents' END AS workspace_type, count(*) AS companies,
 sum(members) AS users, sum(exposed) AS exposed_users, max(arms) AS max_arms_per_company,
 count(*) FILTER (WHERE arms = 1) AS companies_in_test
FROM c GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H6-email-ingestion-incident — 70% of email tickets stuck 2026-08-26..27 (warehouse join)
-- ─────────────────────────────────────────────────────────────────────────
WITH o AS (SELECT DISTINCT date::DATE AS d FROM wh_inbound WHERE ingestion_status = 'degraded' AND channel = 'email'),
w AS (SELECT t0::DATE AS d, channel FROM tickets WHERE t0 >= TIMESTAMP '2026-08-12' AND t0 < TIMESTAMP '2026-09-12' AND t0::DATE <> DATE '2026-08-28'),
g AS (SELECT (d IN (SELECT d FROM o)) AS degraded_days, count(*) FILTER (WHERE channel = 'email') AS email, count(*) FILTER (WHERE channel <> 'email') AS other FROM w GROUP BY 1)
SELECT degraded_days, email, other, round(email::DOUBLE / other, 4) AS email_per_other,
 round(email_per_other / max(email_per_other) FILTER (WHERE NOT degraded_days) OVER (), 4) AS ratio_to_baseline
FROM g ORDER BY 1;

SELECT date, channel, tickets_ingested, tickets_delayed_over_1h, p95_ingest_latency_sec, ingestion_status
FROM wh_inbound WHERE date BETWEEN DATE '2026-08-25' AND DATE '2026-08-29' AND channel = 'email' ORDER BY date;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H7-fast-replies-csat — positive CSAT 0.92 within 60 min vs 0.60 after 8 h
-- ─────────────────────────────────────────────────────────────────────────
SELECT CASE WHEN first_response_mins <= 60 THEN '1 ≤ 60 min' WHEN first_response_mins <= 120 THEN '2 61-120 min' WHEN first_response_mins <= 240 THEN '3 121-240 min'
  WHEN first_response_mins <= 480 THEN '4 241-480 min' ELSE '5 > 480 min' END AS first_response_bucket,
 count(*) AS csat_answers, round(avg((score >= 4)::INT), 4) AS positive_share, round(avg(score), 2) AS avg_score
FROM ev WHERE event = 'csat received' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H8-back-to-school-surge — education tickets ×1.8 from 2026-08-17 to 2026-09-13
-- ─────────────────────────────────────────────────────────────────────────
-- workspaces that existed before the window; season (4 weeks) vs the 8 weeks before, weekly averages
WITH w AS (SELECT CASE WHEN k.t0 >= TIMESTAMP '2026-08-17' AND k.t0 < TIMESTAMP '2026-09-14' THEN 'season'
    WHEN k.t0 >= TIMESTAMP '2026-06-22' AND k.t0 < TIMESTAMP '2026-08-17' THEN 'before' END AS per,
  p.industry = 'education' AS education
  FROM tickets k JOIN prof p ON p.uid = k.uid WHERE p.customer_since < DATE '2026-06-04'),
g AS (SELECT education, count(*) FILTER (WHERE per = 'season') / 4.0 AS season_per_week, count(*) FILTER (WHERE per = 'before') / 8.0 AS before_per_week FROM w GROUP BY 1)
SELECT education, round(season_per_week, 1) AS season_per_week, round(before_per_week, 1) AS before_per_week, round(season_per_week / before_per_week, 4) AS season_ratio,
 round(season_ratio / max(season_ratio) FILTER (WHERE NOT education) OVER (), 4) AS ratio_vs_other_industries
FROM g ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H9-macros-first-two-weeks — go-dark chance falls smoothly with macros saved in 14 days; under 3 vs 3+ day 28-41 retention ×0.435
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE TEMP TABLE macro_cohort AS
SELECT s.uid, s.t0,
 count(*) FILTER (WHERE e.event = 'macro created' AND e.t >= s.t0 AND e.t < s.t0 + INTERVAL 14 DAY) AS macros_14d,
 coalesce(bool_or(e.event = 'queue viewed' AND e.t >= s.t0 + INTERVAL 28 DAY AND e.t < s.t0 + INTERVAL 42 DAY), false) AS retained_d28_41,
 coalesce(bool_or(e.event = 'queue viewed' AND e.t >= s.t0 + INTERVAL 7 DAY AND e.t < s.t0 + INTERVAL 14 DAY), false) AS retained_d7_13
FROM signups s JOIN onboarding o ON o.uid = s.uid AND o.inbox_ever LEFT JOIN ev e ON e.uid = s.uid
WHERE s.t0 <= TIMESTAMP '2026-08-20 23:59:59' GROUP BY 1, 2;

SELECT CASE WHEN macros_14d >= 3 THEN '3+ macros' ELSE 'under 3' END AS cohort, count(*) AS workspaces,
 round(avg(retained_d7_13::INT), 4) AS retention_d7_13, round(avg(retained_d28_41::INT), 4) AS retention_d28_41
FROM macro_cohort GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H10-growth-price-change — Growth $39 → $49 on 2026-08-18; Growth share of new subscriptions ×0.6
-- ─────────────────────────────────────────────────────────────────────────
SELECT CASE WHEN t >= TIMESTAMP '2026-08-18' THEN '2 after' ELSE '1 before' END AS period, count(*) AS new_subscriptions,
 count(*) FILTER (WHERE plan = 'growth') AS growth, count(*) FILTER (WHERE plan = 'starter') AS starter,
 round(growth::DOUBLE / new_subscriptions, 4) AS growth_share
FROM ev WHERE event = 'subscription started' GROUP BY 1 ORDER BY 1;

-- ═════════════════════════════════════════════════════════════════════════
-- EVAL QUERIES (eval/support-desk.eval.md)
-- ═════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q1 — Reply Assist speed: median minutes to first reply, AI drafts vs other replies
-- ─────────────────────────────────────────────────────────────────────────
SELECT CASE WHEN first_reply_method = 'ai_draft' THEN 'ai_draft' ELSE 'other' END AS first_reply, count(*) AS tickets,
 round(median(date_diff('second', t0, t1)) / 60.0, 1) AS median_minutes
FROM tickets WHERE plan_at_assignment IN ('growth', 'enterprise') AND t0 >= TIMESTAMP '2026-07-21' AND t0 < TIMESTAMP '2026-09-24 23:59:59'
  AND t1 < t0 + INTERVAL 7 DAY GROUP BY 1 ORDER BY 1;
-- same-plan before/after view: Growth/Enterprise, Jun 4 - Jul 20 vs Aug 11 - Sep 24, and Starter as a control
SELECT CASE WHEN plan_at_assignment IN ('growth', 'enterprise') THEN 'growth + enterprise' ELSE plan_at_assignment END AS plan_group,
 round(median(date_diff('second', t0, t1)) FILTER (WHERE t0 < TIMESTAMP '2026-07-21') / 60.0, 1) AS before_launch_min,
 round(median(date_diff('second', t0, t1)) FILTER (WHERE t0 >= TIMESTAMP '2026-08-11' AND t0 < TIMESTAMP '2026-09-24 23:59:59') / 60.0, 1) AS after_ramp_min
FROM tickets WHERE t1 < t0 + INTERVAL 7 DAY AND plan_at_assignment IN ('growth', 'enterprise', 'starter') GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q2 — Reply Assist adoption: weekly AI share of Growth/Enterprise first replies; adopting agents
-- ─────────────────────────────────────────────────────────────────────────
SELECT date_trunc('week', t0)::DATE AS week, count(*) AS eligible_tickets, round(avg((first_reply_method = 'ai_draft')::INT), 4) AS ai_share
FROM tickets WHERE plan_at_assignment IN ('growth', 'enterprise') AND t0 >= TIMESTAMP '2026-07-13' AND t1 IS NOT NULL GROUP BY 1 ORDER BY 1;
SELECT count(DISTINCT uid) FILTER (WHERE reply_method = 'ai_draft') AS agents_using_ai,
 count(DISTINCT uid) AS agents_replying_on_eligible_plans,
 round(agents_using_ai / agents_replying_on_eligible_plans, 4) AS share_of_agents
FROM ev WHERE event = 'reply sent' AND plan_tier IN ('growth', 'enterprise') AND t >= TIMESTAMP '2026-08-11';

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q3 — resolution time by priority (median hours, 14-day window)
-- ─────────────────────────────────────────────────────────────────────────
SELECT priority, count(*) AS resolved_tickets, round(median(date_diff('second', t0, t2)) / 3600.0, 1) AS median_hours,
 round(median(date_diff('second', t0, t1)) / 60.0, 0) AS median_minutes_first_reply
FROM tickets WHERE t0 < TIMESTAMP '2026-09-17 23:59:59' AND t2 < t0 + INTERVAL 14 DAY GROUP BY 1 ORDER BY 3;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q4 — trial setup funnel by email provider (7-day window)
-- ─────────────────────────────────────────────────────────────────────────
SELECT provider, count(*) AS signups, round(avg(inbox_7d::INT), 4) AS inbox_connected_7d, round(avg(completed_7d::INT), 4) AS setup_completed_7d
FROM onboarding WHERE t0 < TIMESTAMP '2026-09-24 23:59:59' GROUP BY 1 ORDER BY 1;
SELECT 'all' AS provider, count(*) AS signups, round(avg(inbox_7d::INT), 4) AS inbox_connected_7d, round(avg(completed_7d::INT), 4) AS setup_completed_7d
FROM onboarding WHERE t0 < TIMESTAMP '2026-09-24 23:59:59';

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q5 — paid channel CAC: spend per signup and per paying workspace (warehouse join)
-- ─────────────────────────────────────────────────────────────────────────
WITH g AS (SELECT s.ch, count(*) AS signups,
  count(*) FILTER (WHERE s.t0 < TIMESTAMP '2026-09-01 23:59:59') AS mature_signups,
  count(*) FILTER (WHERE s.t0 < TIMESTAMP '2026-09-01 23:59:59' AND p.tb < s.t0 + INTERVAL 30 DAY) AS paid_30d,
  count(p.uid) AS paid_in_window
  FROM signups s LEFT JOIN first_purchase p ON p.uid = s.uid GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend, sum(signups_reported) AS reported FROM wh_paid GROUP BY 1)
SELECT g.ch, g.signups, sp.reported AS signups_reported_by_platform, round(sp.spend, 0) AS spend_usd, round(sp.spend / g.signups, 2) AS cost_per_signup,
 round(g.paid_30d::DOUBLE / g.mature_signups, 4) AS paid_rate_30d, g.paid_in_window, round(sp.spend / g.paid_in_window, 0) AS spend_per_paid_workspace_in_window
FROM g LEFT JOIN sp ON sp.ch = g.ch ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q6 — Skills Routing test readout
-- ─────────────────────────────────────────────────────────────────────────
SELECT p.variant, count(DISTINCT k.uid) AS users, count(*) AS tickets,
 round(median(date_diff('second', k.t0, k.t1)) FILTER (WHERE k.t1 < k.t0 + INTERVAL 7 DAY AND k.t0 < TIMESTAMP '2026-09-24 23:59:59') / 60.0, 1) AS median_minutes_first_reply,
 round(avg(k.reopened::INT) FILTER (WHERE k.t2 IS NOT NULL AND k.t0 < TIMESTAMP '2026-09-10 23:59:59'), 4) AS reopen_rate,
 round(avg(coalesce(k.t2 < k.t0 + INTERVAL 14 DAY, false)::INT) FILTER (WHERE k.t0 < TIMESTAMP '2026-09-17 23:59:59'), 4) AS resolved_14d,
 round(avg((k.csat_score >= 4)::INT) FILTER (WHERE k.csat_score IS NOT NULL), 4) AS csat_positive
FROM tickets k JOIN prof p ON p.uid = k.uid WHERE k.t0 >= TIMESTAMP '2026-07-08' AND p.variant IS NOT NULL GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q7 — late-August email incident: daily email tickets vs other channels (warehouse join)
-- ─────────────────────────────────────────────────────────────────────────
SELECT t0::DATE AS day, count(*) FILTER (WHERE channel = 'email') AS email_tickets, count(*) FILTER (WHERE channel <> 'email') AS other_tickets,
 round(email_tickets::DOUBLE / other_tickets, 3) AS email_per_other
FROM tickets WHERE t0 >= TIMESTAMP '2026-08-19' AND t0 < TIMESTAMP '2026-09-03' GROUP BY 1 ORDER BY 1;
WITH w AS (SELECT CASE WHEN t0::DATE IN (DATE '2026-08-26', DATE '2026-08-27') THEN '1 incident days' WHEN t0::DATE = DATE '2026-08-28' THEN '2 backlog day'
    WHEN t0 >= TIMESTAMP '2026-08-12' AND t0 < TIMESTAMP '2026-09-12' THEN '3 baseline (Aug 12-25, Aug 29-Sep 11)' END AS per, channel FROM tickets)
SELECT per, count(*) FILTER (WHERE channel = 'email') AS email, count(*) FILTER (WHERE channel <> 'email') AS other,
 round(email::DOUBLE / other, 4) AS email_per_other FROM w WHERE per IS NOT NULL GROUP BY 1 ORDER BY 1;
-- email tickets missing on the stuck days vs the baseline mix, and the surplus that reached agents on Aug 28
WITH b AS (SELECT count(*) FILTER (WHERE channel = 'email')::DOUBLE / count(*) FILTER (WHERE channel <> 'email') AS r FROM tickets
  WHERE t0 >= TIMESTAMP '2026-08-12' AND t0 < TIMESTAMP '2026-09-12' AND t0::DATE NOT IN (DATE '2026-08-26', DATE '2026-08-27', DATE '2026-08-28'))
SELECT d, email, round((SELECT r FROM b) * other, 0) AS expected_email_at_baseline_mix, round(email - (SELECT r FROM b) * other, 0) AS difference
FROM (SELECT t0::DATE AS d, count(*) FILTER (WHERE channel = 'email') AS email, count(*) FILTER (WHERE channel <> 'email') AS other
  FROM tickets WHERE t0::DATE IN (DATE '2026-08-26', DATE '2026-08-27', DATE '2026-08-28') GROUP BY 1) ORDER BY 1;
SELECT date, tickets_ingested, tickets_delayed_over_1h, p95_ingest_latency_sec, ingestion_status
FROM wh_inbound WHERE channel = 'email' AND date BETWEEN DATE '2026-08-24' AND DATE '2026-08-30' ORDER BY date;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q8 — first response time vs CSAT
-- ─────────────────────────────────────────────────────────────────────────
SELECT CASE WHEN first_response_mins <= 60 THEN '1 ≤ 1h' WHEN first_response_mins <= 240 THEN '2 1-4h' WHEN first_response_mins <= 480 THEN '3 4-8h' ELSE '4 > 8h' END AS bucket,
 count(*) AS answers, round(avg((score >= 4)::INT), 4) AS positive_share, round(avg(score), 2) AS avg_score
FROM ev WHERE event = 'csat received' GROUP BY 1 ORDER BY 1;
SELECT count(*) AS answers, round(avg((score >= 4)::INT), 4) AS positive_share, round(avg(score), 2) AS avg_score FROM ev WHERE event = 'csat received';

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q9 — the late-August ticket jump: weekly tickets by industry
-- ─────────────────────────────────────────────────────────────────────────
SELECT date_trunc('week', k.t0)::DATE AS week, count(*) AS tickets, count(*) FILTER (WHERE p.industry = 'education') AS education,
 count(*) FILTER (WHERE p.industry <> 'education') AS other_industries
FROM tickets k JOIN prof p ON p.uid = k.uid WHERE k.t0 >= TIMESTAMP '2026-07-13' AND k.t0 < TIMESTAMP '2026-09-28' GROUP BY 1 ORDER BY 1;
-- season vs the 8 weeks before, workspaces that existed before the window (same as STORY H8), by industry
WITH w AS (SELECT CASE WHEN k.t0 >= TIMESTAMP '2026-08-17' AND k.t0 < TIMESTAMP '2026-09-14' THEN 'season'
    WHEN k.t0 >= TIMESTAMP '2026-06-22' AND k.t0 < TIMESTAMP '2026-08-17' THEN 'before' END AS per, p.industry
  FROM tickets k JOIN prof p ON p.uid = k.uid WHERE p.customer_since < DATE '2026-06-04')
SELECT industry, round(count(*) FILTER (WHERE per = 'season') / 4.0, 1) AS season_per_week, round(count(*) FILTER (WHERE per = 'before') / 8.0, 1) AS before_per_week,
 round(season_per_week / before_per_week, 3) AS ratio
FROM w WHERE per IS NOT NULL GROUP BY 1 ORDER BY 4 DESC;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q10 — early behavior that predicts new workspaces staying (macros in the first 14 days)
-- ─────────────────────────────────────────────────────────────────────────
SELECT least(macros_14d, 8) AS macros_first_14d, count(*) AS workspaces, round(avg(retained_d28_41::INT), 4) AS retention_d28_41
FROM macro_cohort GROUP BY 1 ORDER BY 1;
SELECT CASE WHEN macros_14d >= 3 THEN '3+ macros' ELSE 'under 3' END AS cohort, count(*) AS workspaces, round(avg(retained_d28_41::INT), 4) AS retention_d28_41
FROM macro_cohort GROUP BY 1 ORDER BY 1;
-- other first-14-day setup behaviors for comparison (did the event at least once in the first 14 days)
WITH f AS (SELECT m.uid, m.retained_d28_41 AS ret,
  coalesce(bool_or(e.event = 'integration connected'), false) AS integration,
  coalesce(bool_or(e.event = 'automation rule created'), false) AS automation,
  coalesce(bool_or(e.event = 'kb article published'), false) AS kb_article,
  coalesce(bool_or(e.event = 'widget installed'), false) AS widget
  FROM macro_cohort m LEFT JOIN ev e ON e.uid = m.uid AND e.t >= m.t0 AND e.t < m.t0 + INTERVAL 14 DAY GROUP BY 1, 2)
SELECT 'integration connected' AS behavior, round(avg(ret::INT) FILTER (WHERE integration), 4) AS did, round(avg(ret::INT) FILTER (WHERE NOT integration), 4) AS did_not FROM f
UNION ALL SELECT 'automation rule created', round(avg(ret::INT) FILTER (WHERE automation), 4), round(avg(ret::INT) FILTER (WHERE NOT automation), 4) FROM f
UNION ALL SELECT 'kb article published', round(avg(ret::INT) FILTER (WHERE kb_article), 4), round(avg(ret::INT) FILTER (WHERE NOT kb_article), 4) FROM f
UNION ALL SELECT 'widget installed', round(avg(ret::INT) FILTER (WHERE widget), 4), round(avg(ret::INT) FILTER (WHERE NOT widget), 4) FROM f;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q11 — did the Growth price change hurt new subscriptions? (volume and plan mix)
-- ─────────────────────────────────────────────────────────────────────────
SELECT date_trunc('week', t)::DATE AS week, count(*) AS new_subscriptions, count(*) FILTER (WHERE plan = 'growth') AS growth, count(*) FILTER (WHERE plan = 'starter') AS starter
FROM ev WHERE event = 'subscription started' GROUP BY 1 ORDER BY 1;
-- per day: Jun 4 - Aug 17 (75 days) vs Aug 18 - Sep 14 (28 days; later September is short of trials that have not decided yet)
SELECT CASE WHEN t >= TIMESTAMP '2026-08-18' THEN '2 Aug 18 - Sep 14' ELSE '1 Jun 4 - Aug 17' END AS period, count(*) AS subs,
 round(count(*) / max(CASE WHEN t >= TIMESTAMP '2026-08-18' THEN 28.0 ELSE 75.0 END), 2) AS subs_per_day,
 round(avg((plan = 'growth')::INT), 4) AS growth_share
FROM ev WHERE event = 'subscription started' AND t < TIMESTAMP '2026-09-15' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q12 — new MRR per new subscription before vs after the Growth price change (warehouse join)
-- ─────────────────────────────────────────────────────────────────────────
SELECT CASE WHEN date >= DATE '2026-08-18' THEN '2 after' ELSE '1 before' END AS period,
 sum(new_subscriptions) AS new_subscriptions, sum(seats_purchased) AS seats, round(sum(new_mrr_usd), 0) AS new_mrr_usd,
 round(sum(new_mrr_usd) / sum(new_subscriptions), 2) AS new_mrr_per_subscription,
 round(sum(new_mrr_usd) FILTER (WHERE plan = 'growth') / sum(seats_purchased) FILTER (WHERE plan = 'growth'), 2) AS growth_price_per_seat
FROM wh_billing GROUP BY 1 ORDER BY 1;
-- the same from Mixpanel seats x warehouse list price
WITH p AS (SELECT DISTINCT date::DATE AS d, plan, list_price_per_seat_usd FROM wh_billing)
SELECT CASE WHEN e.t >= TIMESTAMP '2026-08-18' THEN '2 after' ELSE '1 before' END AS period, count(*) AS subs,
 round(sum(e.seats * p.list_price_per_seat_usd) / count(*), 2) AS mrr_per_subscription, round(avg(e.seats), 3) AS avg_seats
FROM ev e JOIN p ON p.d = e.t::DATE AND p.plan = e.plan WHERE e.event = 'subscription started' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q13 — null: does Skills Routing change the escalation rate?
-- ─────────────────────────────────────────────────────────────────────────
WITH x AS (SELECT p.variant, k.escalated FROM tickets k JOIN prof p ON p.uid = k.uid WHERE k.t0 >= TIMESTAMP '2026-07-08' AND p.variant IS NOT NULL),
g AS (SELECT variant, count(*) AS n, sum(escalated::INT) AS k FROM x GROUP BY 1),
s AS (SELECT sum(k)::DOUBLE / sum(n) AS p0,
  max(k::DOUBLE / n) FILTER (WHERE variant = 'Skills Routing') AS pv, max(n) FILTER (WHERE variant = 'Skills Routing') AS nv,
  max(k::DOUBLE / n) FILTER (WHERE variant = 'Control') AS pc, max(n) FILTER (WHERE variant = 'Control') AS nc FROM g)
SELECT g.variant, g.n AS tickets, g.k AS escalated, round(g.k::DOUBLE / g.n, 4) AS escalation_rate,
 round((s.pv - s.pc) / sqrt(s.p0 * (1 - s.p0) * (1.0 / s.nv + 1.0 / s.nc)), 2) AS z
FROM g, s ORDER BY 1;
-- sub-splits: priority, channel, plan, company size, category, region (ticket-level z per split)
WITH x AS (SELECT p.variant, k.escalated, k.priority, k.channel, k.plan_at_assignment AS plan, p.company_size, k.category, p.region
  FROM tickets k JOIN prof p ON p.uid = k.uid WHERE k.t0 >= TIMESTAMP '2026-07-08' AND p.variant IS NOT NULL),
l AS (SELECT variant, escalated, 'priority' AS dim, priority AS val FROM x UNION ALL SELECT variant, escalated, 'channel', channel FROM x
  UNION ALL SELECT variant, escalated, 'plan', plan FROM x UNION ALL SELECT variant, escalated, 'company_size', company_size FROM x
  UNION ALL SELECT variant, escalated, 'category', category FROM x UNION ALL SELECT variant, escalated, 'region', region FROM x),
g AS (SELECT dim, val, avg(escalated::INT) AS p0,
  avg(escalated::INT) FILTER (WHERE variant = 'Control') AS control_rate, avg(escalated::INT) FILTER (WHERE variant = 'Skills Routing') AS skills_rate,
  count(*) FILTER (WHERE variant = 'Control') AS control_n, count(*) FILTER (WHERE variant = 'Skills Routing') AS skills_n FROM l GROUP BY 1, 2)
SELECT dim, val, round(control_rate, 4) AS control_rate, round(skills_rate, 4) AS skills_rate, control_n, skills_n,
 round((skills_rate - control_rate) / sqrt(p0 * (1 - p0) * (1.0 / control_n + 1.0 / skills_n)), 2) AS z
FROM g ORDER BY 1, 2;
-- account level: escalation rate per account, Welch t between arms
WITH a AS (SELECT p.company_id, any_value(p.variant) AS variant, avg(k.escalated::INT) AS r
  FROM tickets k JOIN prof p ON p.uid = k.uid WHERE k.t0 >= TIMESTAMP '2026-07-08' AND p.variant IS NOT NULL GROUP BY 1),
s AS (SELECT variant, count(*) AS n, avg(r) AS m, var_samp(r) AS v FROM a GROUP BY 1)
SELECT max(n) FILTER (WHERE variant = 'Skills Routing') AS skills_accounts, max(n) FILTER (WHERE variant = 'Control') AS control_accounts,
 round(max(m) FILTER (WHERE variant = 'Skills Routing'), 4) AS skills_mean, round(max(m) FILTER (WHERE variant = 'Control'), 4) AS control_mean,
 round((max(m) FILTER (WHERE variant = 'Skills Routing') - max(m) FILTER (WHERE variant = 'Control'))
  / sqrt(max(v / n) FILTER (WHERE variant = 'Skills Routing') + max(v / n) FILTER (WHERE variant = 'Control')), 2) AS welch_t
FROM s;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q14 — null: once set up, do Microsoft 365 trials convert to paid any worse?
-- ─────────────────────────────────────────────────────────────────────────
-- trial owners who connected an inbox; signups Jun 4 - Sep 1; paid within 30 days of signup
CREATE OR REPLACE TEMP TABLE setup_paid AS
SELECT o.uid, o.ch, CASE WHEN o.provider = 'microsoft_365' THEN 'microsoft_365' ELSE 'google_workspace + other' END AS provider_group,
 coalesce(p.tb < o.t0 + INTERVAL 30 DAY, false) AS paid
FROM onboarding o LEFT JOIN first_purchase p ON p.uid = o.uid
WHERE o.inbox_ever AND o.t0 < TIMESTAMP '2026-09-01 23:59:59';

WITH g AS (SELECT provider_group, count(*) AS n, sum(paid::INT) AS k FROM setup_paid GROUP BY 1),
s AS (SELECT sum(k)::DOUBLE / sum(n) AS p0,
  max(k::DOUBLE / n) FILTER (WHERE provider_group = 'microsoft_365') AS pm, max(n) FILTER (WHERE provider_group = 'microsoft_365') AS nm,
  max(k::DOUBLE / n) FILTER (WHERE provider_group <> 'microsoft_365') AS po, max(n) FILTER (WHERE provider_group <> 'microsoft_365') AS no FROM g)
SELECT g.provider_group, g.n AS workspaces, g.k AS paid_30d, round(g.k::DOUBLE / g.n, 4) AS paid_rate,
 round((s.pm - s.po) / sqrt(s.p0 * (1 - s.p0) * (1.0 / s.nm + 1.0 / s.no)), 2) AS z
FROM g, s ORDER BY 1;
-- sub-splits: paid channels vs organic, referral, and app store; and growth vs starter choice among buyers
SELECT CASE WHEN ch IN ('google_ads', 'capterra', 'linkedin_ads') THEN 'paid channels' ELSE 'organic + referral + app store' END AS grp,
 round(avg(paid::INT) FILTER (WHERE provider_group = 'microsoft_365'), 4) AS m365_rate, round(avg(paid::INT) FILTER (WHERE provider_group <> 'microsoft_365'), 4) AS other_rate,
 count(*) FILTER (WHERE provider_group = 'microsoft_365') AS m365_n, count(*) FILTER (WHERE provider_group <> 'microsoft_365') AS other_n,
 round((m365_rate - other_rate) / sqrt(avg(paid::INT) * (1 - avg(paid::INT)) * (1.0 / m365_n + 1.0 / other_n)), 2) AS z
FROM setup_paid GROUP BY 1 ORDER BY 1;
SELECT x.provider_group, count(*) AS buyers, round(avg((p.plan = 'growth')::INT), 4) AS growth_share
FROM setup_paid x JOIN first_purchase p ON p.uid = x.uid GROUP BY 1 ORDER BY 1;
-- sub-splits by acquisition channel and by region (9 splits; one |z| near 2 has about a 1-in-4 chance under the null)
WITH l AS (SELECT 'channel' AS dim, x.ch AS val, x.provider_group, x.paid FROM setup_paid x
  UNION ALL SELECT 'region', p.region, x.provider_group, x.paid FROM setup_paid x JOIN prof p ON p.uid = x.uid),
g AS (SELECT dim, val, avg(paid::INT) AS p0,
  avg(paid::INT) FILTER (WHERE provider_group = 'microsoft_365') AS m365_rate, avg(paid::INT) FILTER (WHERE provider_group <> 'microsoft_365') AS other_rate,
  count(*) FILTER (WHERE provider_group = 'microsoft_365') AS m365_n, count(*) FILTER (WHERE provider_group <> 'microsoft_365') AS other_n FROM l GROUP BY 1, 2)
SELECT dim, val, round(m365_rate, 4) AS m365_rate, round(other_rate, 4) AS other_rate, m365_n, other_n,
 round((m365_rate - other_rate) / sqrt(p0 * (1 - p0) * (1.0 / m365_n + 1.0 / other_n)), 2) AS z
FROM g ORDER BY 1, 2;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q15 — where trials come from: signups by acquisition channel, by month
-- ─────────────────────────────────────────────────────────────────────────
SELECT ch, count(*) AS signups, round(count(*) / (SELECT count(*) FROM signups)::DOUBLE, 4) AS share,
 count(*) FILTER (WHERE month(t0) = 6) AS jun, count(*) FILTER (WHERE month(t0) = 7) AS jul, count(*) FILTER (WHERE month(t0) = 8) AS aug, count(*) FILTER (WHERE month(t0) = 9) AS sep
FROM signups GROUP BY 1 ORDER BY 2 DESC;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q16 — ticket volume trend since June (weekly tickets assigned; new vs established workspaces)
-- ─────────────────────────────────────────────────────────────────────────
SELECT date_trunc('week', k.t0)::DATE AS week, count(*) AS tickets,
 count(*) FILTER (WHERE p.customer_since < DATE '2026-06-04') AS established_workspaces, count(*) FILTER (WHERE p.customer_since >= DATE '2026-06-04') AS new_workspaces
FROM tickets k JOIN prof p ON p.uid = k.uid GROUP BY 1 ORDER BY 1;
SELECT CASE WHEN month(t0) = 6 THEN 'June (Jun 4-30)' ELSE 'September' END AS month, count(*) AS tickets,
 round(count(*) / max(CASE WHEN month(t0) = 6 THEN 27.0 ELSE 30.0 END), 1) AS per_day
FROM tickets WHERE month(t0) IN (6, 9) GROUP BY 1 ORDER BY 1;
-- US holidays: tickets on Jul 3 and Sep 7 vs the same weekday one week before and after, by company region
SELECT p.region, k.t0::DATE AS day, count(*) AS tickets FROM tickets k JOIN prof p ON p.uid = k.uid
WHERE k.t0::DATE IN (DATE '2026-06-26', DATE '2026-07-03', DATE '2026-07-10', DATE '2026-08-31', DATE '2026-09-07', DATE '2026-09-14') GROUP BY 1, 2 ORDER BY 1, 2;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q17 — weekend tickets wait longer for a first reply
-- ─────────────────────────────────────────────────────────────────────────
SELECT CASE WHEN dayofweek(t0) IN (0, 6) THEN 'weekend arrival' ELSE 'weekday arrival' END AS arrival, count(*) AS tickets,
 round(median(date_diff('second', t0, t1)) / 60.0, 1) AS median_minutes_first_reply
FROM tickets WHERE t1 < t0 + INTERVAL 7 DAY AND t0 < TIMESTAMP '2026-09-24 23:59:59' GROUP BY 1 ORDER BY 1;
SELECT channel, round(median(date_diff('second', t0, t1)) / 60.0, 1) AS median_minutes_first_reply, count(*) AS tickets
FROM tickets WHERE t1 < t0 + INTERVAL 7 DAY AND t0 < TIMESTAMP '2026-09-24 23:59:59' GROUP BY 1 ORDER BY 2;
-- the Mixpanel date-range recipe: one weekend vs the weekdays that follow, two sample weeks
SELECT CASE WHEN t0::DATE BETWEEN DATE '2026-09-12' AND DATE '2026-09-13' THEN '1 Sat-Sun Sep 12-13' WHEN t0::DATE BETWEEN DATE '2026-09-14' AND DATE '2026-09-18' THEN '2 Mon-Fri Sep 14-18'
  WHEN t0::DATE BETWEEN DATE '2026-09-19' AND DATE '2026-09-20' THEN '3 Sat-Sun Sep 19-20' ELSE '4 Mon-Fri Sep 21-25' END AS date_range, count(*) AS tickets,
 round(median(date_diff('second', t0, t1)) / 60.0, 1) AS median_minutes_first_reply
FROM tickets WHERE t1 < t0 + INTERVAL 7 DAY AND t0::DATE BETWEEN DATE '2026-09-12' AND DATE '2026-09-25' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q18 — reopen rate overall and by channel
-- ─────────────────────────────────────────────────────────────────────────
SELECT channel, count(*) AS resolved_tickets, round(avg(reopened::INT), 4) AS reopen_rate
FROM tickets WHERE t2 IS NOT NULL AND t0 < TIMESTAMP '2026-09-10 23:59:59' GROUP BY 1 ORDER BY 1;
SELECT 'all' AS channel, count(*) AS resolved_tickets, round(avg(reopened::INT), 4) AS reopen_rate
FROM tickets WHERE t2 IS NOT NULL AND t0 < TIMESTAMP '2026-09-10 23:59:59';
SELECT CASE WHEN k.t0 < TIMESTAMP '2026-07-08' THEN '1 before test' ELSE '2 test period' END AS period, coalesce(p.variant, 'not exposed') AS arm,
 count(*) AS resolved_tickets, round(avg(k.reopened::INT), 4) AS reopen_rate
FROM tickets k JOIN prof p ON p.uid = k.uid WHERE k.t2 IS NOT NULL AND k.t0 < TIMESTAMP '2026-09-10 23:59:59' GROUP BY 1, 2 ORDER BY 1, 2;
-- the quick Insights recipe: total ticket reopened / total ticket resolved over the window (a reopened
-- ticket's second resolution sits in the denominator, so this reads lower than the per-ticket rate)
SELECT 'all' AS grp, count(*) FILTER (WHERE event = 'ticket reopened') AS reopened_events, count(*) FILTER (WHERE event = 'ticket resolved') AS resolved_events,
 round(reopened_events::DOUBLE / resolved_events, 4) AS totals_ratio FROM ev;
SELECT coalesce(p.variant, 'not exposed') AS arm, count(*) FILTER (WHERE event = 'ticket reopened') AS reopened_events, count(*) FILTER (WHERE event = 'ticket resolved') AS resolved_events,
 round(reopened_events::DOUBLE / resolved_events, 4) AS totals_ratio
FROM ev JOIN prof p ON p.uid = ev.uid WHERE ev.t >= TIMESTAMP '2026-07-08' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q19 — quarter review inputs (open-ended): headline KPIs by month
-- ─────────────────────────────────────────────────────────────────────────
SELECT month(t0) AS month, count(*) AS tickets,
 round(median(date_diff('second', t0, t1)) FILTER (WHERE t1 < t0 + INTERVAL 7 DAY) / 60.0, 1) AS median_first_reply_min,
 -- reopen rate: resolved tickets assigned through Sep 10 only (the reopen window must have passed; same cap as Q18)
 round(avg(reopened::INT) FILTER (WHERE t2 IS NOT NULL AND t0 < TIMESTAMP '2026-09-10 23:59:59'), 4) AS reopen_rate,
 round(avg((csat_score >= 4)::INT) FILTER (WHERE csat_score IS NOT NULL), 4) AS csat_positive
FROM tickets WHERE t0 >= TIMESTAMP '2026-06-04' AND t0 < TIMESTAMP '2026-10-01' GROUP BY 1 ORDER BY 1;
SELECT month(t0) AS month, count(*) AS trial_signups, round(avg(completed_7d::INT), 4) AS setup_completed_7d FROM onboarding WHERE t0 < TIMESTAMP '2026-10-01' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q20 — warehouse ingestion vs Mixpanel tickets: how many tickets never reach an agent?
-- ─────────────────────────────────────────────────────────────────────────
WITH m AS (SELECT t0::DATE AS d, channel, count(*) AS assigned FROM tickets GROUP BY 1, 2),
w AS (SELECT date::DATE AS d, channel, tickets_ingested, tickets_auto_closed, tickets_merged FROM wh_inbound)
SELECT w.channel, sum(w.tickets_ingested) AS ingested, sum(w.tickets_auto_closed) AS auto_closed, sum(w.tickets_merged) AS merged, sum(m.assigned) AS mixpanel_assigned,
 round(sum(m.assigned)::DOUBLE / sum(w.tickets_ingested), 4) AS assigned_share_of_ingested,
 round(corr(w.tickets_ingested, m.assigned), 3) AS daily_corr
FROM w LEFT JOIN m ON m.d = w.d AND m.channel = w.channel GROUP BY 1 ORDER BY 1;
