-- Kindred (dating vertical) — story-keyed and eval-keyed DuckDB queries.
--
-- Generate first (repo root):
--   node scripts/verify-runner.mjs dungeons/vertical/dating/dating.js verify-dating
-- Run:
--   duckdb -c ".read dungeons/vertical/dating/dating.sql"
-- Against a gzipped export:
--   duckdb -c "SET VARIABLE data_prefix='<dir>/dating'" -c ".read dating.sql"
--
-- All times are UTC. Window: 2026-06-04 00:00 to 2026-10-01 23:59:59.

SET VARIABLE data_prefix = COALESCE(getvariable('data_prefix'), 'data/verify-dating');

-- ─────────────────────────────────────────────────────────────────────────
-- PRELUDE: raw files, identity resolution, warehouse tables
-- ─────────────────────────────────────────────────────────────────────────
-- Identity: a new member signs up with "account created" (the auth event,
-- which carries user_id and device_id). A device resolves to the member seen
-- with it on any event that carries both ids, the way Mixpanel stitches.
-- Every Kindred event carries user_id, so uid = user_id in practice.

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

CREATE OR REPLACE TEMP TABLE wh_paid AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-paid_acquisition_daily.json*', sample_size=-1, union_by_name=true);
CREATE OR REPLACE TEMP TABLE wh_chat AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-chat_delivery_daily.json*', sample_size=-1, union_by_name=true);
CREATE OR REPLACE TEMP TABLE wh_bookings AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-subscription_bookings_daily.json*', sample_size=-1, union_by_name=true);

-- profile attributes keyed by the resolved member id
CREATE OR REPLACE TEMP TABLE prof AS
SELECT distinct_id::VARCHAR AS uid, photo_count, relationship_goal, acquisition_channel, gender, age_band, market,
 member_since, verified, subscription_plan AS current_plan, "Experiment: Icebreakers" AS variant
FROM users;

-- new-member signups (one per member who joined in the window)
CREATE OR REPLACE TEMP TABLE signups AS
SELECT uid, t AS t0, acquisition_channel AS ch, signup_method FROM ev WHERE event = 'account created';

-- onboarding: profile completed within 7 days of signup (each step happens once per member)
CREATE OR REPLACE TEMP TABLE onboarding AS
SELECT s.uid, s.t0, s.ch, s.signup_method,
 coalesce(bool_or(e.t >= s.t0 AND e.t < s.t0 + INTERVAL 7 DAY), false) AS completed
FROM signups s LEFT JOIN ev e ON e.uid = s.uid AND e.event = 'profile completed' GROUP BY 1, 2, 3, 4;

-- one row per match: match, opener, date plan, feedback (match_id is shared by all four)
CREATE OR REPLACE TEMP TABLE matches AS
SELECT match_id, any_value(uid) AS uid,
 min(t) FILTER (WHERE event = 'match created') AS t_match,
 min(t) FILTER (WHERE event = 'conversation started') AS t_conv,
 min(t) FILTER (WHERE event = 'date planned') AS t_date,
 min(t) FILTER (WHERE event = 'date feedback submitted') AS t_fb,
 any_value(match_source) FILTER (WHERE event = 'match created') AS match_source,
 any_value(hours_since_match) FILTER (WHERE event = 'conversation started') AS hours_since_match,
 any_value(opener_type) FILTER (WHERE event = 'conversation started') AS opener_type,
 any_value(rating) FILTER (WHERE event = 'date feedback submitted') AS rating
FROM ev WHERE event IN ('match created', 'conversation started', 'date planned', 'date feedback submitted') GROUP BY 1;

-- dataset overview
SELECT count(*) AS events, count(DISTINCT uid) AS members_with_events, (SELECT count(*) FROM users) AS profiles,
 (SELECT count(*) FROM signups) AS new_signups, min(t) AS first_event, max(t) AS last_event FROM ev;

-- identity check: every event resolves to a member; platform agrees with the device OS
SELECT count(*) FILTER (WHERE uid IS NULL) AS unresolved_events,
 count(*) FILTER (WHERE (platform = 'ios' AND os NOT IN ('iOS', 'iPadOS')) OR (platform = 'android' AND os <> 'Android')) AS platform_os_mismatch
FROM ev;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H1-verified-profiles-launch — fake/scam reports ×0.4 after 2026-07-14 (21-day ramp)
-- ─────────────────────────────────────────────────────────────────────────
WITH w AS (SELECT CASE WHEN t < TIMESTAMP '2026-07-14' THEN '1 before launch' WHEN t >= TIMESTAMP '2026-08-04' THEN '2 after ramp' END AS period, event, report_reason
  FROM ev WHERE event IN ('profile reported', 'like sent', 'profile passed'))
SELECT period,
 count(*) FILTER (WHERE event = 'profile reported' AND report_reason IN ('fake_profile', 'scam')) AS fake_scam_reports,
 count(*) FILTER (WHERE event = 'profile reported' AND report_reason NOT IN ('fake_profile', 'scam')) AS other_reports,
 count(*) FILTER (WHERE event <> 'profile reported') AS profile_decisions,
 round(1000.0 * fake_scam_reports / profile_decisions, 2) AS fake_scam_per_1000,
 round(1000.0 * other_reports / profile_decisions, 2) AS other_per_1000
FROM w WHERE period IS NOT NULL GROUP BY 1 ORDER BY 1;

SELECT count(*) FILTER (WHERE t < TIMESTAMP '2026-07-14') AS verifications_before_launch, count(*) AS verifications FROM ev WHERE event = 'selfie verified';

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H2-photo-count-sweet-spot — matches per like by profile photo_count
-- ─────────────────────────────────────────────────────────────────────────
SELECT CASE WHEN p.photo_count <= 2 THEN '1-2' WHEN p.photo_count = 3 THEN '3' WHEN p.photo_count <= 6 THEN '4-6' ELSE '7-9' END AS photo_band,
 count(DISTINCT e.uid) AS members,
 count(*) FILTER (WHERE event = 'like sent') AS likes, count(*) FILTER (WHERE event = 'match created') AS matches,
 round(matches::DOUBLE / likes, 4) AS matches_per_like
FROM ev e JOIN prof p ON p.uid = e.uid WHERE event IN ('like sent', 'match created') GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H3-sparks-match-rate — Sparks match at 3x a standard like
-- ─────────────────────────────────────────────────────────────────────────
SELECT count(*) FILTER (WHERE event = 'like sent' AND like_type = 'spark') AS sparks,
 count(*) FILTER (WHERE event = 'like sent' AND like_type = 'standard') AS standard_likes,
 round(count(*) FILTER (WHERE event = 'match created' AND match_source = 'spark')::DOUBLE / sparks, 4) AS spark_match_rate,
 round(count(*) FILTER (WHERE event = 'match created' AND match_source = 'like')::DOUBLE / standard_likes, 4) AS standard_match_rate,
 round(spark_match_rate / standard_match_rate, 3) AS ratio
FROM ev WHERE event IN ('like sent', 'match created');

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H4-icebreakers-experiment — opener rate ×1.25, opener time ×0.6 from 2026-07-22
-- ─────────────────────────────────────────────────────────────────────────
-- per match (hold match_id constant), opener within 7 days; matches Jul 22 - Sep 24
SELECT p.variant, count(DISTINCT m.uid) AS members, count(*) AS matches,
 round(avg(coalesce(m.t_conv < m.t_match + INTERVAL 7 DAY, false)::INT), 4) AS opener_rate,
 round(median(m.hours_since_match) FILTER (WHERE m.t_conv < m.t_match + INTERVAL 7 DAY), 2) AS median_hours_to_opener,
 round(avg((m.opener_type = 'icebreaker')::INT) FILTER (WHERE m.t_conv IS NOT NULL), 4) AS icebreaker_share_of_openers
FROM matches m JOIN prof p ON p.uid = m.uid
WHERE m.t_match >= TIMESTAMP '2026-07-22' AND m.t_match < TIMESTAMP '2026-09-24 23:59:59' AND p.variant IS NOT NULL
GROUP BY 1 ORDER BY 1;

SELECT "Variant name" AS variant, count(DISTINCT uid) AS exposed_members FROM ev WHERE event = '$experiment_started' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H5-success-churn — after a 4-5 star date, 45% leave within 2-10 days
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE TEMP TABLE first_feedback AS
WITH f AS (SELECT uid, t AS f0, rating, row_number() OVER (PARTITION BY uid ORDER BY t, insert_id) AS rn FROM ev WHERE event = 'date feedback submitted')
SELECT f.uid, f.f0, f.rating,
 coalesce(bool_or(e.t >= f.f0 + INTERVAL 14 DAY AND e.t < f.f0 + INTERVAL 28 DAY), false) AS retained_d14_27
FROM f LEFT JOIN ev e ON e.uid = f.uid AND e.event = 'app opened'
WHERE f.rn = 1 AND f.f0 <= TIMESTAMP '2026-09-03 23:59:59' GROUP BY 1, 2, 3;

SELECT CASE WHEN rating >= 4 THEN '4-5 stars' ELSE '1-3 stars' END AS first_date_rating, count(*) AS members,
 round(avg(retained_d14_27::INT), 4) AS retention_d14_27
FROM first_feedback GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H6-paid-channel-economics — spend per signup, onboarding, spend per completed profile
-- ─────────────────────────────────────────────────────────────────────────
WITH g AS (SELECT ch, count(*) AS signups, count(*) FILTER (WHERE completed) AS completed FROM onboarding GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM wh_paid GROUP BY 1)
SELECT g.ch, g.signups, round(g.completed::DOUBLE / g.signups, 4) AS completion_7d, round(sp.spend, 0) AS spend_usd,
 round(sp.spend / g.signups, 2) AS spend_per_signup, round(sp.spend / g.completed, 2) AS spend_per_completed_profile
FROM g LEFT JOIN sp ON sp.ch = g.ch ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H7-android-chat-incident — 60% of Android sends fail 2026-08-24..28 (warehouse join)
-- ─────────────────────────────────────────────────────────────────────────
WITH o AS (SELECT DISTINCT date::DATE AS d FROM wh_chat WHERE service_status = 'major_outage'),
w AS (SELECT t::DATE AS d, platform FROM ev WHERE event = 'message sent' AND t >= TIMESTAMP '2026-08-10' AND t < TIMESTAMP '2026-09-12'),
g AS (SELECT (d IN (SELECT d FROM o)) AS incident_days, count(*) FILTER (WHERE platform = 'android') AS android, count(*) FILTER (WHERE platform = 'ios') AS ios FROM w GROUP BY 1)
SELECT incident_days, android, ios, round(android::DOUBLE / ios, 4) AS android_per_ios FROM g ORDER BY 1;

SELECT platform, count(*) FILTER (WHERE service_status = 'major_outage') AS outage_days, min(date) FILTER (WHERE service_status = 'major_outage') AS first_day,
 round(avg(delivery_failure_rate) FILTER (WHERE service_status = 'major_outage'), 4) AS outage_failure_rate,
 round(avg(delivery_failure_rate) FILTER (WHERE service_status <> 'major_outage'), 4) AS normal_failure_rate
FROM wh_chat GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H8-plus-price-change — Kindred+ +17% on 2026-08-18; purchases per view ×0.7 (warehouse join)
-- ─────────────────────────────────────────────────────────────────────────
WITH p AS (SELECT DISTINCT date::DATE AS d, plan, billing_period, list_price_usd FROM wh_bookings),
w AS (SELECT CASE WHEN e.t >= TIMESTAMP '2026-08-18' THEN '2 after' ELSE '1 before' END AS period, e.event, e.plan, p.list_price_usd
  FROM ev e LEFT JOIN p ON e.event = 'subscription started' AND p.d = e.t::DATE AND p.plan = e.plan AND p.billing_period = e.billing_period
  WHERE e.event IN ('paywall viewed', 'subscription started'))
SELECT period, count(*) FILTER (WHERE event = 'paywall viewed') AS paywall_views,
 count(*) FILTER (WHERE event = 'subscription started' AND plan = 'plus') AS plus_subs,
 count(*) FILTER (WHERE event = 'subscription started' AND plan = 'premier') AS premier_subs,
 round(plus_subs::DOUBLE / paywall_views, 4) AS plus_per_view, round(premier_subs::DOUBLE / paywall_views, 4) AS premier_per_view,
 round(sum(list_price_usd) FILTER (WHERE event = 'subscription started' AND plan = 'plus') / paywall_views, 3) AS plus_bookings_per_view
FROM w GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H9-date-speed-by-goal — opener → date plan time ×1.5 long_term, ×0.6 short_term_fun
-- ─────────────────────────────────────────────────────────────────────────
SELECT p.relationship_goal, count(*) AS dates,
 round(median(date_diff('second', m.t_conv, m.t_date)) / 3600.0, 1) AS median_hours_opener_to_date
FROM matches m JOIN prof p ON p.uid = m.uid
WHERE m.t_conv < TIMESTAMP '2026-09-01' AND m.t_date >= m.t_conv AND m.t_date < m.t_conv + INTERVAL 30 DAY
GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H10-fast-openers — openers within 24 h plan a date 2x as often
-- ─────────────────────────────────────────────────────────────────────────
SELECT CASE WHEN hours_since_match <= 24 THEN 'within 24h' ELSE 'after 24h' END AS opener_speed, count(*) AS conversations,
 round(avg(coalesce(t_date < t_conv + INTERVAL 30 DAY, false)::INT), 4) AS date_rate_30d
FROM matches WHERE t_conv IS NOT NULL AND t_conv < TIMESTAMP '2026-09-01' GROUP BY 1 ORDER BY 1;

-- ═════════════════════════════════════════════════════════════════════════
-- EVAL QUERIES (eval/dating.eval.md)
-- ═════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q1 — fake-profile and scam reports before vs after Verified Profiles
-- ─────────────────────────────────────────────────────────────────────────
WITH w AS (SELECT date_trunc('week', t)::DATE AS week, event, report_reason FROM ev WHERE event IN ('profile reported', 'like sent', 'profile passed'))
SELECT week,
 round(1000.0 * count(*) FILTER (WHERE event = 'profile reported' AND report_reason IN ('fake_profile', 'scam')) / count(*) FILTER (WHERE event <> 'profile reported'), 2) AS fake_scam_per_1000,
 round(1000.0 * count(*) FILTER (WHERE event = 'profile reported' AND report_reason NOT IN ('fake_profile', 'scam')) / count(*) FILTER (WHERE event <> 'profile reported'), 2) AS other_per_1000
FROM w GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q2 — Verified Profiles adoption
-- ─────────────────────────────────────────────────────────────────────────
WITH active AS (SELECT DISTINCT uid FROM ev WHERE t >= TIMESTAMP '2026-07-14' AND event = 'app opened'),
v AS (SELECT uid, min(t) AS tv FROM ev WHERE event = 'selfie verified' GROUP BY 1),
s AS (SELECT uid, t0 FROM signups)
SELECT count(*) AS members_active_after_launch, count(v.uid) AS verified,
 round(count(v.uid)::DOUBLE / count(*), 4) AS verified_share,
 count(v.uid) FILTER (WHERE s.uid IS NULL OR s.t0 < TIMESTAMP '2026-07-14') AS verified_existing_members,
 round(count(v.uid) FILTER (WHERE s.uid IS NULL OR s.t0 < TIMESTAMP '2026-07-14')::DOUBLE / count(*) FILTER (WHERE s.uid IS NULL OR s.t0 < TIMESTAMP '2026-07-14'), 4) AS existing_share,
 round(count(v.uid) FILTER (WHERE s.t0 >= TIMESTAMP '2026-07-14')::DOUBLE / count(*) FILTER (WHERE s.t0 >= TIMESTAMP '2026-07-14'), 4) AS new_member_share
FROM active a LEFT JOIN v ON v.uid = a.uid LEFT JOIN s ON s.uid = a.uid;

SELECT date_trunc('week', t)::DATE AS week, count(*) AS verifications FROM ev WHERE event = 'selfie verified' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q3 — matches per like by photo count (see STORY H2 for bands)
-- ─────────────────────────────────────────────────────────────────────────
SELECT p.photo_count, count(*) FILTER (WHERE event = 'like sent') AS likes,
 round(count(*) FILTER (WHERE event = 'match created')::DOUBLE / count(*) FILTER (WHERE event = 'like sent'), 4) AS matches_per_like
FROM ev e JOIN prof p ON p.uid = e.uid WHERE event IN ('like sent', 'match created') GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q4 — Spark vs standard like match rate, by plan at the time (see STORY H3)
-- ─────────────────────────────────────────────────────────────────────────
SELECT subscription_plan,
 count(*) FILTER (WHERE event = 'like sent' AND like_type = 'spark') AS sparks,
 round(count(*) FILTER (WHERE event = 'like sent' AND like_type = 'spark')::DOUBLE / count(*) FILTER (WHERE event = 'like sent'), 4) AS spark_share_of_likes,
 round(count(*) FILTER (WHERE event = 'match created' AND match_source = 'spark')::DOUBLE / count(*) FILTER (WHERE event = 'like sent' AND like_type = 'spark'), 4) AS spark_match_rate,
 round(count(*) FILTER (WHERE event = 'match created' AND match_source = 'like')::DOUBLE / count(*) FILTER (WHERE event = 'like sent' AND like_type = 'standard'), 4) AS standard_match_rate
FROM ev WHERE event IN ('like sent', 'match created') GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q5 — Icebreakers: opener rate and speed (see STORY H4); plus significance
-- ─────────────────────────────────────────────────────────────────────────
WITH x AS (SELECT p.variant, coalesce(m.t_conv < m.t_match + INTERVAL 7 DAY, false) AS ok
  FROM matches m JOIN prof p ON p.uid = m.uid
  WHERE m.t_match >= TIMESTAMP '2026-07-22' AND m.t_match < TIMESTAMP '2026-09-24 23:59:59' AND p.variant IS NOT NULL),
g AS (SELECT variant, count(*) AS n, avg(ok::INT) AS r FROM x GROUP BY 1)
SELECT max(r) FILTER (WHERE variant = 'Icebreakers') AS variant_rate, max(r) FILTER (WHERE variant = 'Control') AS control_rate,
 round((max(r) FILTER (WHERE variant = 'Icebreakers') - max(r) FILTER (WHERE variant = 'Control'))
  / sqrt(max(r * (1 - r) / n) FILTER (WHERE variant = 'Icebreakers') + max(r * (1 - r) / n) FILTER (WHERE variant = 'Control')), 1) AS z
FROM g;

-- the same read with Uniques counting (a member converts if any of their matches gets an opener in 7 days)
SELECT p.variant, count(DISTINCT m.uid) AS members,
 round(count(DISTINCT m.uid) FILTER (WHERE m.t_conv < m.t_match + INTERVAL 7 DAY)::DOUBLE / count(DISTINCT m.uid), 4) AS member_opener_rate_uniques
FROM matches m JOIN prof p ON p.uid = m.uid
WHERE m.t_match >= TIMESTAMP '2026-07-22' AND m.t_match < TIMESTAMP '2026-09-24 23:59:59' AND p.variant IS NOT NULL GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q6 — retention after a member's first rated date (see STORY H5); cancellation reasons
-- ─────────────────────────────────────────────────────────────────────────
SELECT rating, count(*) AS members, round(avg(retained_d14_27::INT), 4) AS retention_d14_27 FROM first_feedback GROUP BY 1 ORDER BY 1;

SELECT cancel_reason, count(*) AS cancellations, round(count(*)::DOUBLE / sum(count(*)) OVER (), 4) AS share,
 count(*) FILTER (WHERE subscription_plan = 'plus') AS plus, count(*) FILTER (WHERE subscription_plan = 'premier') AS premier
FROM ev WHERE event = 'subscription cancelled' GROUP BY 1 ORDER BY 2 DESC;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q7 — paid channel economics: spend per signup, completed profile, and paid subscriber
-- ─────────────────────────────────────────────────────────────────────────
WITH b AS (SELECT DISTINCT s.uid FROM signups s JOIN ev e ON e.uid = s.uid AND e.event = 'subscription started'),
g AS (SELECT o.ch, count(*) AS signups, count(*) FILTER (WHERE o.completed) AS completed, count(b.uid) AS subscribers
  FROM onboarding o LEFT JOIN b ON b.uid = o.uid GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, round(sum(spend_usd), 0) AS spend, sum(installs_reported) AS installs_reported FROM wh_paid GROUP BY 1)
SELECT g.ch, sp.spend, g.signups, sp.installs_reported, g.completed, g.subscribers,
 round(sp.spend / g.signups, 2) AS per_signup, round(sp.spend / g.completed, 2) AS per_completed_profile,
 round(sp.spend / g.subscribers, 2) AS per_new_subscriber, round(g.subscribers::DOUBLE / g.signups, 4) AS subscriber_rate
FROM g LEFT JOIN sp ON sp.ch = g.ch ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q8 — onboarding funnel by acquisition channel (step by step, 7 days)
-- ─────────────────────────────────────────────────────────────────────────
WITH st AS (SELECT s.uid, s.ch,
  bool_or(e.event = 'photos uploaded' AND e.t >= s.t0 AND e.t < s.t0 + INTERVAL 7 DAY) AS photos,
  bool_or(e.event = 'profile completed' AND e.t >= s.t0 AND e.t < s.t0 + INTERVAL 7 DAY) AS completed
  FROM signups s LEFT JOIN ev e ON e.uid = s.uid AND e.event IN ('photos uploaded', 'profile completed') GROUP BY 1, 2)
SELECT CASE WHEN ch = 'tiktok_ads' THEN 'tiktok_ads' ELSE 'all other channels' END AS channel_group, count(*) AS signups,
 round(avg(coalesce(photos, false)::INT), 4) AS reached_photos, round(avg(coalesce(completed, false)::INT), 4) AS completed_profile
FROM st GROUP BY 1 ORDER BY 1;

SELECT count(*) AS signups, round(avg(completed::INT), 4) AS overall_completion FROM onboarding;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q9 — the late-August message dip (daily messages by platform + warehouse)
-- ─────────────────────────────────────────────────────────────────────────
SELECT e.d, e.android, e.ios, round(e.android::DOUBLE / e.ios, 3) AS android_per_ios, w.service_status, w.delivery_failure_rate
FROM (SELECT t::DATE AS d, count(*) FILTER (WHERE platform = 'android') AS android, count(*) FILTER (WHERE platform = 'ios') AS ios
  FROM ev WHERE event = 'message sent' AND t >= TIMESTAMP '2026-08-17' AND t < TIMESTAMP '2026-09-05' GROUP BY 1) e
LEFT JOIN wh_chat w ON w.date::DATE = e.d AND w.platform = 'android' ORDER BY 1;

-- lost Android messages: expected (baseline Android/iOS ratio x incident iOS) minus observed
WITH o AS (SELECT DISTINCT date::DATE AS d FROM wh_chat WHERE service_status = 'major_outage'),
w AS (SELECT t::DATE AS d, platform FROM ev WHERE event = 'message sent' AND t >= TIMESTAMP '2026-08-10' AND t < TIMESTAMP '2026-09-12'),
g AS (SELECT (d IN (SELECT d FROM o)) AS inc, count(*) FILTER (WHERE platform = 'android') AS a, count(*) FILTER (WHERE platform = 'ios') AS i FROM w GROUP BY 1)
SELECT round(max(a::DOUBLE / i) FILTER (WHERE inc) / max(a::DOUBLE / i) FILTER (WHERE NOT inc), 4) AS relative_android_volume,
 round(max(a::DOUBLE / i) FILTER (WHERE NOT inc) * max(i) FILTER (WHERE inc) - max(a) FILTER (WHERE inc), 0) AS android_messages_lost_in_mixpanel,
 (SELECT sum(messages_attempted - messages_delivered) FROM wh_chat WHERE service_status = 'major_outage') AS warehouse_failed_sends
FROM g;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q10 — Kindred+ price change: conversion, bookings, Premier (see STORY H8)
-- ─────────────────────────────────────────────────────────────────────────
WITH p AS (SELECT DISTINCT date::DATE AS d, plan, billing_period, list_price_usd FROM wh_bookings),
w AS (SELECT CASE WHEN e.t >= TIMESTAMP '2026-08-18' THEN 'after' ELSE 'before' END AS period, e.event, e.plan, p.list_price_usd
  FROM ev e LEFT JOIN p ON e.event = 'subscription started' AND p.d = e.t::DATE AND p.plan = e.plan AND p.billing_period = e.billing_period
  WHERE e.event IN ('paywall viewed', 'subscription started')),
g AS (SELECT period, count(*) FILTER (WHERE event = 'paywall viewed') AS v,
  count(*) FILTER (WHERE event = 'subscription started' AND plan = 'premier') AS pr FROM w GROUP BY 1)
SELECT max(pr::DOUBLE / v) FILTER (WHERE period = 'before') AS premier_before, max(pr::DOUBLE / v) FILTER (WHERE period = 'after') AS premier_after,
 round((max(pr::DOUBLE / v) FILTER (WHERE period = 'after') - max(pr::DOUBLE / v) FILTER (WHERE period = 'before'))
  / sqrt(max(pr::DOUBLE / v * (1 - pr::DOUBLE / v) / v) FILTER (WHERE period = 'after') + max(pr::DOUBLE / v * (1 - pr::DOUBLE / v) / v) FILTER (WHERE period = 'before')), 2) AS z_premier
FROM g;

-- warehouse bookings per day, Kindred+ vs Premier, before vs after
SELECT plan, CASE WHEN date::DATE >= DATE '2026-08-18' THEN 'after' ELSE 'before' END AS period,
 sum(new_subscriptions) AS new_subscriptions, round(sum(gross_bookings_usd), 0) AS gross_bookings_usd,
 round(sum(gross_bookings_usd) / count(DISTINCT date), 1) AS bookings_per_day
FROM wh_bookings GROUP BY 1, 2 ORDER BY 1, 2 DESC;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q11 — opener → date plan time by relationship goal (see STORY H9); overall
-- ─────────────────────────────────────────────────────────────────────────
SELECT round(median(date_diff('second', t_conv, t_date)) / 3600.0, 1) AS median_hours_all,
 round(median(date_diff('second', t_match, t_date)) / 3600.0, 1) AS median_hours_match_to_date
FROM matches WHERE t_conv < TIMESTAMP '2026-09-01' AND t_date >= t_conv AND t_date < t_conv + INTERVAL 30 DAY;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q12 — opener speed and date rate, finer buckets (see STORY H10)
-- ─────────────────────────────────────────────────────────────────────────
-- Totals counting, hold match_id constant (one row per conversation)
SELECT CASE WHEN hours_since_match <= 6 THEN '0-6h' WHEN hours_since_match <= 12 THEN '6-12h' WHEN hours_since_match <= 18 THEN '12-18h'
  WHEN hours_since_match <= 24 THEN '18-24h' WHEN hours_since_match <= 36 THEN '24-36h' WHEN hours_since_match <= 48 THEN '36-48h'
  ELSE '48h+' END AS opener_speed, count(*) AS conversations,
 round(avg(coalesce(t_date < t_conv + INTERVAL 30 DAY, false)::INT), 4) AS date_rate_30d
FROM matches WHERE t_conv IS NOT NULL AND t_conv < TIMESTAMP '2026-09-01' GROUP BY 1 ORDER BY min(hours_since_match);

-- the same split read with Uniques counting (a member counts once per bucket and
-- converts if any of their conversations in that bucket converts)
WITH c AS (SELECT uid, CASE WHEN hours_since_match <= 24 THEN 'within 24h' ELSE 'after 24h' END AS opener_speed,
  coalesce(t_date < t_conv + INTERVAL 30 DAY, false) AS ok
  FROM matches WHERE t_conv IS NOT NULL AND t_conv < TIMESTAMP '2026-09-01'),
u AS (SELECT uid, opener_speed, bool_or(ok) AS ok FROM c GROUP BY 1, 2)
SELECT opener_speed, count(*) AS members, round(avg(ok::INT), 4) AS member_date_rate_uniques FROM u GROUP BY 1 ORDER BY 1 DESC;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q13 — Icebreakers downstream: date plans per match
-- ─────────────────────────────────────────────────────────────────────────
SELECT p.variant, count(*) AS matches,
 round(avg(coalesce(m.t_date < m.t_match + INTERVAL 30 DAY, false)::INT), 4) AS date_plan_rate_30d
FROM matches m JOIN prof p ON p.uid = m.uid
WHERE m.t_match >= TIMESTAMP '2026-07-22' AND m.t_match < TIMESTAMP '2026-09-01' AND p.variant IS NOT NULL GROUP BY 1 ORDER BY 1;

-- the same read with Uniques counting (a member converts if any of their matches leads to a date in 30 days)
SELECT p.variant, count(DISTINCT m.uid) AS members,
 round(count(DISTINCT m.uid) FILTER (WHERE m.t_date < m.t_match + INTERVAL 30 DAY)::DOUBLE / count(DISTINCT m.uid), 4) AS member_date_rate_uniques
FROM matches m JOIN prof p ON p.uid = m.uid
WHERE m.t_match >= TIMESTAMP '2026-07-22' AND m.t_match < TIMESTAMP '2026-09-01' AND p.variant IS NOT NULL GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q14 — verified vs unverified members: matches per like after the ramp (null)
-- ─────────────────────────────────────────────────────────────────────────
WITH x AS (SELECT p.verified, e.platform, count(*) FILTER (WHERE event = 'like sent') AS likes, count(*) FILTER (WHERE event = 'match created') AS m
  FROM ev e JOIN prof p ON p.uid = e.uid WHERE e.t >= TIMESTAMP '2026-08-04' AND event IN ('like sent', 'match created') GROUP BY ROLLUP (1, 2))
SELECT coalesce(platform, 'all') AS platform, coalesce(verified::VARCHAR, 'all') AS verified, likes, m AS matches, round(m::DOUBLE / likes, 4) AS matches_per_like
FROM x ORDER BY 1, 2;

WITH x AS (SELECT p.verified, count(*) FILTER (WHERE event = 'like sent') AS n, count(*) FILTER (WHERE event = 'match created')::DOUBLE / count(*) FILTER (WHERE event = 'like sent') AS r
  FROM ev e JOIN prof p ON p.uid = e.uid WHERE e.t >= TIMESTAMP '2026-08-04' AND event IN ('like sent', 'match created') GROUP BY 1)
SELECT round((max(r) FILTER (WHERE verified) - max(r) FILTER (WHERE NOT verified)) / sqrt(max(r * (1 - r) / n) FILTER (WHERE verified) + max(r * (1 - r) / n) FILTER (WHERE NOT verified)), 2) AS z_like_level
FROM x;

-- activity trap: verified members like more, so they collect more matches per member
SELECT p.verified, count(DISTINCT e.uid) AS members,
 round(count(*) FILTER (WHERE event = 'like sent')::DOUBLE / count(DISTINCT e.uid), 1) AS likes_per_member,
 round(count(*) FILTER (WHERE event = 'match created')::DOUBLE / count(DISTINCT e.uid), 2) AS matches_per_member
FROM ev e JOIN prof p ON p.uid = e.uid WHERE e.t >= TIMESTAMP '2026-08-04' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q15 — onboarding completion, Android vs iOS (null), overall and by channel group
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE TEMP TABLE onboarding_platform AS
SELECT o.*, a.platform, CASE WHEN o.ch = 'tiktok_ads' THEN 'tiktok_ads' ELSE 'other channels' END AS channel_group
FROM onboarding o JOIN (SELECT uid, any_value(platform) AS platform FROM ev WHERE event = 'account created' GROUP BY 1) a ON a.uid = o.uid;

SELECT coalesce(channel_group, 'all') AS channel_group, platform, count(*) AS signups, round(avg(completed::INT), 4) AS completion
FROM onboarding_platform GROUP BY GROUPING SETS ((platform), (channel_group, platform)) ORDER BY 1, 2;

WITH g AS (SELECT coalesce(channel_group, 'all') AS grp, platform, count(*) AS n, avg(completed::INT) AS r
  FROM onboarding_platform GROUP BY GROUPING SETS ((platform), (channel_group, platform)))
SELECT grp, round((max(r) FILTER (WHERE platform = 'android') - max(r) FILTER (WHERE platform = 'ios'))
  / sqrt(max(r * (1 - r) / n) FILTER (WHERE platform = 'android') + max(r * (1 - r) / n) FILTER (WHERE platform = 'ios')), 2) AS z
FROM g GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q16 — matches per like by gender
-- ─────────────────────────────────────────────────────────────────────────
SELECT p.gender, count(DISTINCT e.uid) AS members, count(*) FILTER (WHERE event = 'like sent') AS likes,
 round(count(*) FILTER (WHERE event = 'like sent')::DOUBLE / count(DISTINCT e.uid), 1) AS likes_per_member,
 round(count(*) FILTER (WHERE event = 'match created')::DOUBLE / count(*) FILTER (WHERE event = 'like sent'), 4) AS matches_per_like
FROM ev e JOIN prof p ON p.uid = e.uid WHERE event IN ('like sent', 'match created') GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q17 — the paying base: current plans, new subscriptions, warehouse bookings
-- ─────────────────────────────────────────────────────────────────────────
SELECT current_plan, count(*) AS members, round(count(*)::DOUBLE / sum(count(*)) OVER (), 4) AS share FROM prof GROUP BY 1 ORDER BY 2 DESC;

SELECT plan, billing_period, count(*) AS new_subscriptions_mixpanel FROM ev WHERE event = 'subscription started' GROUP BY 1, 2 ORDER BY 1, 2;

SELECT plan, sum(new_subscriptions) AS new_subscriptions_billing, round(sum(gross_bookings_usd), 0) AS gross_bookings_usd FROM wh_bookings GROUP BY ROLLUP (1) ORDER BY 1 NULLS LAST;

SELECT (SELECT count(*) FROM ev WHERE event = 'subscription started') AS mixpanel_subscriptions,
 (SELECT sum(new_subscriptions) FROM wh_bookings) AS billing_subscriptions,
 (SELECT count(*) FROM ev WHERE event = 'subscription cancelled') AS cancellations;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q18 — weekly and daily rhythm (UTC)
-- ─────────────────────────────────────────────────────────────────────────
SELECT dayname(t) AS day_of_week, count(*) AS events, round(count(*)::DOUBLE / (SELECT count(*) FROM ev) * 7, 3) AS index_vs_average_day
FROM ev GROUP BY 1, dayofweek(t) ORDER BY dayofweek(t);

SELECT hour(t) AS hour_utc, count(*) AS events FROM ev GROUP BY 1 ORDER BY 2 DESC LIMIT 6;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q19 — quarter review inputs: weekly active members, signups, dates, revenue
-- ─────────────────────────────────────────────────────────────────────────
SELECT date_trunc('month', t)::DATE AS month, count(DISTINCT uid) FILTER (WHERE event = 'app opened') AS monthly_active_members,
 count(*) FILTER (WHERE event = 'account created') AS signups, count(*) FILTER (WHERE event = 'match created') AS matches,
 count(*) FILTER (WHERE event = 'date planned') AS dates_planned, count(*) FILTER (WHERE event = 'subscription started') AS new_subscriptions
FROM ev GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q20 — budget inputs: see EVAL Q7 (spend per signup / completed profile / subscriber)
-- ─────────────────────────────────────────────────────────────────────────
SELECT acquisition_channel, round(sum(spend_usd), 0) AS spend_usd, round(sum(spend_usd) / count(DISTINCT date), 1) AS spend_per_day,
 round(sum(spend_usd) / sum(installs_reported), 2) AS platform_cost_per_install
FROM wh_paid GROUP BY 1 ORDER BY 1;
