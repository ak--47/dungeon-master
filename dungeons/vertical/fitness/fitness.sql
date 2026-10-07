-- Stridewell (fitness vertical) — story-keyed and eval-keyed DuckDB queries.
--
-- Generate first (repo root):
--   node scripts/verify-runner.mjs dungeons/vertical/fitness/fitness.js verify-fitness
-- Run:
--   duckdb -c ".read dungeons/vertical/fitness/fitness.sql"
-- Against a gzipped export:
--   duckdb -c "SET VARIABLE data_prefix='<dir>/fitness'" -c ".read fitness.sql"
--
-- All times are UTC. Window: 2026-06-04 00:00 to 2026-10-01 23:59:59.

SET VARIABLE data_prefix = COALESCE(getvariable('data_prefix'), 'data/verify-fitness');

-- ─────────────────────────────────────────────────────────────────────────
-- PRELUDE: raw files, identity resolution, warehouse tables
-- ─────────────────────────────────────────────────────────────────────────
-- Identity: new members sign up with "account created" (the auth event, which
-- carries both user_id and device_id). A device resolves to the user seen with
-- it on any event that carries both ids, the way Mixpanel stitches. In this
-- data every event already carries user_id (there is no anonymous pre-signup
-- activity; an enrolled member's $experiment_started fires 1 s before
-- "account created" and already carries user_id), so the stitch is a no-op.
-- device_id is on every event except the three onboarding steps after signup
-- (goal quiz completed, plan generated, starter workout completed), which
-- carry user_id only. Each member uses one phone (one device_id); Platform
-- follows that phone's os (iOS and iPadOS → ios, Android → android).
--
-- Passive events: notification received (server-side; it keeps arriving after a
-- member stops using the app, until the account is deactivated) and account
-- deactivated never count as activity (retention returns, "active members").

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
CREATE OR REPLACE TEMP TABLE wh_sync AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-wearable_sync_daily.json*', sample_size=-1, union_by_name=true);
CREATE OR REPLACE TEMP TABLE wh_billing AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-subscription_billing_daily.json*', sample_size=-1, union_by_name=true);

-- new-member signups (one per member who joined in the window)
CREATE OR REPLACE TEMP TABLE signups AS
SELECT uid, t AS t0, acquisition_channel AS ch, Platform AS platform FROM ev WHERE event = 'account created';

-- dataset overview (a few pre-existing profiles have no events in the window,
-- so profiles can exceed members with events)
SELECT count(*) AS events, count(DISTINCT uid) AS users_with_events, (SELECT count(*) FROM users) AS profiles,
 min(t) AS first_event, max(t) AS last_event FROM ev;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H1-guided-first-week — onboarding A/B starting 2026-07-01
-- ─────────────────────────────────────────────────────────────────────────
-- Onboarding steps are onboarding-only events, so a per-user "reached every
-- step in order within 7 days" read equals the Mixpanel funnel.
CREATE OR REPLACE TEMP TABLE onboarding AS
WITH s AS (SELECT u."Experiment: Guided First Week" AS variant, g.uid, g.t0, g.platform FROM signups g JOIN users u ON u.distinct_id::VARCHAR = g.uid),
q AS (SELECT uid, min(t) AS tq FROM ev WHERE event = 'goal quiz completed' GROUP BY 1),
p AS (SELECT uid, min(t) AS tp FROM ev WHERE event = 'plan generated' GROUP BY 1),
w AS (SELECT uid, min(t) AS tw FROM ev WHERE event = 'starter workout completed' GROUP BY 1)
SELECT s.*, coalesce(q.tq >= s.t0 AND p.tp >= q.tq AND w.tw >= p.tp AND w.tw < s.t0 + INTERVAL 7 DAY, false) AS converted,
 CASE WHEN w.tw >= p.tp AND p.tp >= q.tq AND q.tq >= s.t0 AND w.tw < s.t0 + INTERVAL 7 DAY THEN date_diff('second', s.t0, w.tw) END AS ttc_s
FROM s LEFT JOIN q USING (uid) LEFT JOIN p USING (uid) LEFT JOIN w USING (uid);

SELECT coalesce(variant, '(not enrolled)') AS variant, count(*) AS signups,
 round(avg(converted::INT), 4) AS onboarding_conversion,
 round(median(ttc_s) / 3600.0, 2) AS median_hours_to_finish
FROM onboarding GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H2-stride-coach-launch — AI coaching for Plus from 2026-08-12
-- ─────────────────────────────────────────────────────────────────────────
-- subscription_tier <> 'free' = members with Plus features (monthly, annual, or a
-- running 7-day trial, tier 'trial').
SELECT coaching_mode, count(*) AS workouts, round(avg(duration_minutes), 2) AS avg_minutes, round(avg(calories_burned), 1) AS avg_calories
FROM ev WHERE event = 'workout completed' AND t >= TIMESTAMP '2026-08-12' AND subscription_tier <> 'free'
GROUP BY 1 ORDER BY 1;

SELECT count(*) FILTER (WHERE coaching_mode = 'ai_coach' AND (t < TIMESTAMP '2026-08-12' OR subscription_tier = 'free')) AS impure_rows
FROM ev WHERE event IN ('workout completed', 'workout planned');

-- a planned workout and the completion right after it (within 3 h) share coaching_mode
WITH s AS (SELECT event, coaching_mode, t, lag(event) OVER w AS prev_event, lag(coaching_mode) OVER w AS prev_mode, lag(t) OVER w AS prev_t
  FROM ev WHERE event IN ('workout planned', 'workout completed') WINDOW w AS (PARTITION BY uid ORDER BY t))
SELECT count(*) AS plan_workout_pairs, count(*) FILTER (WHERE coaching_mode <> prev_mode) AS mode_mismatches,
 (SELECT count(*) FROM ev WHERE event = 'workout completed' AND subscription_tier = 'trial' AND coaching_mode = 'ai_coach') AS trial_ai_coach_workouts
FROM s WHERE event = 'workout completed' AND prev_event = 'workout planned' AND prev_t > t - INTERVAL 3 HOUR AND t >= TIMESTAMP '2026-08-12';

-- steady-state Stride Coach share of Plus workouts, after the 21-day adoption ramp
SELECT round(count(*) FILTER (WHERE coaching_mode = 'ai_coach')::DOUBLE / count(*), 4) AS ai_share_after_ramp
FROM ev WHERE event = 'workout completed' AND t >= TIMESTAMP '2026-09-02' AND subscription_tier <> 'free';

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H3-wearable-sync-outage — partner health-API outage 2026-08-20..22
-- ─────────────────────────────────────────────────────────────────────────
-- watch and band owners' wearable-tracked workouts per planned workout (planning
-- happens in the app and is untouched), outage days vs the 7 days on each side
CREATE OR REPLACE TEMP TABLE watch_band_owners AS
SELECT distinct_id::VARCHAR AS uid FROM users WHERE wearable_type IN ('smartwatch', 'fitness_band');
WITH od AS (SELECT DISTINCT date::DATE AS d FROM wh_sync WHERE sync_error_rate > 0.2),
w AS (SELECT t::DATE AS d, event, tracking_source FROM ev
  WHERE event IN ('workout completed', 'workout planned') AND uid IN (SELECT uid FROM watch_band_owners)
  AND t >= TIMESTAMP '2026-08-13' AND t < TIMESTAMP '2026-08-30'),
g AS (SELECT (d IN (SELECT d FROM od)) AS outage, count(*) FILTER (WHERE event = 'workout completed' AND tracking_source = 'wearable') AS synced,
  count(*) FILTER (WHERE event = 'workout planned') AS plans FROM w GROUP BY 1)
SELECT outage, synced, plans, round(synced::DOUBLE / plans, 4) AS synced_per_plan,
 round((synced::DOUBLE / plans) / (SELECT synced::DOUBLE / plans FROM g WHERE NOT outage), 4) AS vs_surrounding_week FROM g ORDER BY outage;

SELECT wearable_type, round(avg(sync_error_rate) FILTER (WHERE partner_api_status = 'major_outage'), 4) AS outage_error_rate,
 count(*) FILTER (WHERE partner_api_status = 'major_outage') AS outage_days
FROM wh_sync GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H4-monthly-price-change — Plus Monthly $12.99 → $14.99 on 2026-09-01
-- ─────────────────────────────────────────────────────────────────────────
WITH p AS (SELECT (t >= TIMESTAMP '2026-09-01') AS post, plan FROM ev WHERE event = 'subscription purchased'),
g AS (SELECT post, count(*) FILTER (WHERE plan = 'monthly') AS monthly, count(*) FILTER (WHERE plan = 'annual') AS annual FROM p GROUP BY 1)
SELECT post, monthly, annual, round(monthly::DOUBLE / annual, 4) AS monthly_per_annual FROM g ORDER BY post;

WITH p AS (SELECT t::DATE AS d, plan FROM ev WHERE event = 'subscription purchased'),
j AS (SELECT p.*, b.list_price_usd FROM p JOIN wh_billing b ON b.date::DATE = p.d AND b.plan = p.plan),
g AS (SELECT (d >= DATE '2026-09-01') AS post,
  sum(list_price_usd) FILTER (WHERE plan = 'monthly') / sum(list_price_usd) FILTER (WHERE plan = 'annual') AS m_rev_per_a FROM j GROUP BY 1)
SELECT round(max(m_rev_per_a) FILTER (WHERE post) / max(m_rev_per_a) FILTER (WHERE NOT post), 4) AS monthly_bookings_did FROM g;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H5-summer-shred-paid-social — 2026-06-15..07-14 campaign
-- ─────────────────────────────────────────────────────────────────────────
WITH s AS (SELECT t0::DATE AS d, count(*) AS n FROM signups WHERE ch = 'paid_social' GROUP BY 1),
j AS (SELECT (p.date::DATE >= DATE '2026-06-15' AND p.date::DATE < DATE '2026-07-15') AS shred, sum(p.spend_usd) AS spend, sum(coalesce(s.n, 0)) AS signups
  FROM wh_paid p LEFT JOIN s ON s.d = p.date::DATE WHERE p.acquisition_channel = 'paid_social' GROUP BY 1)
SELECT shred, round(spend, 2) AS spend_usd, signups, round(spend / signups, 2) AS spend_per_signup FROM j ORDER BY shred;

-- daily signups inside (30 days) vs outside (90 days) the campaign: total and non-paid-social
WITH g AS (SELECT (t0 >= TIMESTAMP '2026-06-15' AND t0 < TIMESTAMP '2026-07-15') AS shred,
  count(*)::DOUBLE / (CASE WHEN (t0 >= TIMESTAMP '2026-06-15' AND t0 < TIMESTAMP '2026-07-15') THEN 30 ELSE 90 END) AS per_day,
  count(*) FILTER (WHERE ch <> 'paid_social')::DOUBLE / (CASE WHEN (t0 >= TIMESTAMP '2026-06-15' AND t0 < TIMESTAMP '2026-07-15') THEN 30 ELSE 90 END) AS other_per_day
  FROM signups GROUP BY 1)
SELECT round(max(per_day) FILTER (WHERE shred) / max(per_day) FILTER (WHERE NOT shred), 4) AS volume_lift,
 round(max(other_per_day) FILTER (WHERE shred) / max(other_per_day) FILTER (WHERE NOT shred), 4) AS other_channels_lift FROM g;

WITH b AS (SELECT DISTINCT uid FROM ev WHERE event = 'subscription purchased'),
w AS (SELECT date_trunc('week', s.t0) AS wk,
  count(*) FILTER (WHERE ch = 'paid_social') AS sn, count(b.uid) FILTER (WHERE ch = 'paid_social') AS sb,
  count(*) FILTER (WHERE ch <> 'paid_social') AS onn, count(b.uid) FILTER (WHERE ch <> 'paid_social') AS ob
  FROM signups s LEFT JOIN b ON b.uid = s.uid GROUP BY 1)
SELECT round(sum(sb)::DOUBLE / sum(sn * ob::DOUBLE / nullif(onn, 0)), 4) AS paid_social_vs_other_buy_rate_std FROM w WHERE onn > 0;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H6-first-week-habit — first-week workout count vs Week-4 retention
-- ─────────────────────────────────────────────────────────────────────────
-- Week 4 = Mixpanel Retention, weekly unit, birth-aligned bucket 4 (days 28-34
-- after signup). Signups at least 35 days before the window end. A return is any
-- member-initiated event: passive events (notification received, account
-- deactivated) do not count (in Mixpanel: a custom event "Active action" that
-- combines every other event).
CREATE OR REPLACE TEMP TABLE habit AS
WITH s AS (SELECT * FROM signups WHERE t0 < TIMESTAMP '2026-10-01 23:59:59' - INTERVAL 35 DAY)
SELECT s.uid, s.t0,
 count(*) FILTER (WHERE e.event = 'workout completed' AND e.t < s.t0 + INTERVAL 7 DAY) AS early_workouts,
 count(*) FILTER (WHERE e.t >= s.t0 + INTERVAL 28 DAY AND e.t < s.t0 + INTERVAL 35 DAY
  AND e.event NOT IN ('notification received', 'account deactivated')) AS w4_events,
 count(*) FILTER (WHERE e.t >= s.t0 + INTERVAL 28 DAY AND e.t < s.t0 + INTERVAL 35 DAY) AS w4_any_events
FROM s JOIN ev e ON e.uid = s.uid GROUP BY 1, 2;

SELECT CASE WHEN early_workouts = 0 THEN '0' WHEN early_workouts <= 2 THEN '1-2' WHEN early_workouts <= 4 THEN '3-4' ELSE '5+' END AS first_week_workouts,
 count(*) AS members, round(avg((w4_events > 0)::INT), 4) AS week4_retention
FROM habit GROUP BY 1 ORDER BY 1;
SELECT round((SELECT avg((w4_events > 0)::INT) FROM habit WHERE early_workouts >= 5)
 / (SELECT avg((w4_events > 0)::INT) FROM habit WHERE early_workouts = 0), 4) AS five_plus_vs_zero;

-- Mixpanel-cohort approximation: members whose signup falls in Monday week W, counting
-- workout completed from the start of W to 7 days after the end of W (a 14-day
-- window, since a cohort cannot follow each member's own first 7 days)
WITH a AS (SELECT h.uid, h.w4_events,
  count(*) FILTER (WHERE e.event = 'workout completed' AND e.t >= date_trunc('week', h.t0) AND e.t < date_trunc('week', h.t0) + INTERVAL 14 DAY) AS cohort_workouts
  FROM habit h JOIN ev e ON e.uid = h.uid GROUP BY 1, 2)
SELECT CASE WHEN cohort_workouts = 0 THEN '0' WHEN cohort_workouts <= 2 THEN '1-2' WHEN cohort_workouts <= 4 THEN '3-4' ELSE '5+' END AS cohort_window_workouts,
 count(*) AS members, round(avg((w4_events > 0)::INT), 4) AS week4_retention
FROM a GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H7-team-vs-solo-challenges — per-challenge completion
-- ─────────────────────────────────────────────────────────────────────────
-- challenge_id is held constant, so each challenge converts on its own completion.
-- A challenge completes near the end of its duration_days, so the read takes joins
-- up to 2026-08-31 (a 30-day challenge joined then ends inside the data) with a
-- 31-day conversion window.
CREATE OR REPLACE TEMP TABLE challenges AS
WITH j AS (SELECT uid, challenge_id, challenge_format, challenge_type, duration_days, min(t) AS tj FROM ev WHERE event = 'challenge joined' GROUP BY ALL),
c AS (SELECT uid, challenge_id, min(t) AS tc FROM ev WHERE event = 'challenge completed' GROUP BY ALL)
SELECT j.*, c.tc, coalesce(c.tc > j.tj AND c.tc < j.tj + INTERVAL 31 DAY, false) AS completed,
 date_diff('second', j.tj, c.tc) / 86400.0 AS days_to_complete
FROM j LEFT JOIN c USING (uid, challenge_id);

SELECT challenge_format, count(*) AS challenges, round(avg(completed::INT), 4) AS completion_rate
FROM challenges WHERE tj < TIMESTAMP '2026-09-01' GROUP BY 1 ORDER BY 1;
SELECT round(avg(completed::INT) FILTER (WHERE challenge_format = 'team') / avg(completed::INT) FILTER (WHERE challenge_format = 'solo'), 4) AS team_vs_solo
FROM challenges WHERE tj < TIMESTAMP '2026-09-01';
-- completion timing follows duration_days: completions land in the last fifth of the challenge
SELECT duration_days, count(*) FILTER (WHERE completed) AS completions, round(median(days_to_complete) FILTER (WHERE completed), 2) AS median_days_to_complete,
 round(min(days_to_complete) FILTER (WHERE completed), 2) AS min_days, round(max(days_to_complete) FILTER (WHERE completed), 2) AS max_days
FROM challenges GROUP BY 1 ORDER BY 1;
-- team challenges are shared: participants per team challenge_id
WITH p AS (SELECT challenge_id, count(DISTINCT uid) AS participants FROM ev WHERE event = 'challenge joined' AND challenge_format = 'team' GROUP BY 1)
SELECT count(*) AS team_challenges, round(avg(participants), 2) AS avg_participants, median(participants) AS median_participants,
 round(avg((participants = 1)::INT), 4) AS share_single_participant, max(participants) AS max_participants FROM p;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H8-push-fatigue — open rate falls with notifications in the last 30 days
-- ─────────────────────────────────────────────────────────────────────────
-- recent = the member's other notifications in the 30 days up to this one.
-- Members who joined before June 4 also got notifications before the export,
-- so the look-back is only complete from 2026-07-04 (raw-export read).
-- Notifications keep reaching new members after they stop using the app
-- (unopened), so the fatigue reads use members who joined before June 4
-- (pre_window = true), who do not lapse in the window.
CREATE OR REPLACE TEMP TABLE push_seq AS
SELECT uid, t, opened, uid NOT IN (SELECT uid FROM signups) AS pre_window,
 count(*) OVER (PARTITION BY uid ORDER BY t RANGE BETWEEN INTERVAL 30 DAY PRECEDING AND CURRENT ROW) - 1 AS recent
FROM ev WHERE event = 'notification received';
CREATE OR REPLACE TEMP TABLE push AS
SELECT uid, pre_window, count(*) AS n, sum(opened::INT) AS opens FROM push_seq GROUP BY 1, 2;

-- 12+ recent vs 4 or fewer, from 2026-07-04 (members who joined before June 4)
SELECT round(avg(opened::INT) FILTER (WHERE recent <= 4), 4) AS open_rate_4_or_fewer,
 round(avg(opened::INT) FILTER (WHERE recent >= 12), 4) AS open_rate_12_plus,
 round(avg(opened::INT) FILTER (WHERE recent >= 12) / avg(opened::INT) FILTER (WHERE recent <= 4), 4) AS full_vs_fresh
FROM push_seq WHERE t >= TIMESTAMP '2026-07-04' AND pre_window;

-- Mixpanel recipe: cohorts on notification count in the window (members who joined before June 4)
SELECT CASE WHEN n < 12 THEN '1 <12' WHEN n < 24 THEN '2 12-23' WHEN n < 36 THEN '3 24-35' ELSE '4 36+' END AS cohort,
 count(*) AS members, round(sum(opens)::DOUBLE / sum(n), 4) AS open_rate
FROM push WHERE pre_window GROUP BY 1 ORDER BY 1;

-- no calendar trend: pre-window members' open rate by month
SELECT strftime(p.t, '%Y-%m') AS month, count(*) AS notifications, round(avg(p.opened::INT), 4) AS open_rate
FROM push_seq p WHERE p.uid NOT IN (SELECT uid FROM signups) GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H9-fall-reset-program — 2026-09-08 for 14 days
-- ─────────────────────────────────────────────────────────────────────────
WITH w AS (SELECT (t >= TIMESTAMP '2026-09-08') AS prog, event FROM ev
  WHERE event IN ('workout completed', 'workout planned', 'app opened', 'meal logged', 'progress checked') AND t >= TIMESTAMP '2026-08-25' AND t < TIMESTAMP '2026-09-22'),
g AS (SELECT prog, count(*) FILTER (WHERE event = 'workout completed') AS completed, count(*) FILTER (WHERE event = 'workout planned') AS planned,
  count(*) FILTER (WHERE event = 'app opened') AS opens, count(*) FILTER (WHERE event = 'meal logged') AS meals,
  count(*) FILTER (WHERE event = 'progress checked') AS progress FROM w GROUP BY 1)
SELECT prog, completed, planned, opens, meals, progress, round(completed::DOUBLE / opens, 4) AS completed_per_open, round(planned::DOUBLE / opens, 4) AS planned_per_open,
 round(opens::DOUBLE / meals, 4) AS opens_per_meal, round(progress::DOUBLE / completed, 4) AS progress_per_completed FROM g ORDER BY prog;
-- plan follow-through: share of planned workouts followed by a completed workout
-- within 4 h (the Workout Loop window; a totals funnel workout planned → workout
-- completed) and within 1 day, program vs the 14 days before
CREATE OR REPLACE TEMP TABLE follow_through AS
WITH p AS (SELECT uid, t FROM ev WHERE event = 'workout planned' AND t >= TIMESTAMP '2026-08-25' AND t < TIMESTAMP '2026-09-22'),
c AS (SELECT uid, t FROM ev WHERE event = 'workout completed')
SELECT p.uid, (p.t >= TIMESTAMP '2026-09-08') AS prog, c.t IS NOT NULL AND c.t <= p.t + INTERVAL 4 HOUR AS done_4h,
 c.t IS NOT NULL AND c.t <= p.t + INTERVAL 1 DAY AS done_1d
FROM p ASOF LEFT JOIN c ON p.uid = c.uid AND p.t < c.t;
SELECT prog, count(*) AS planned, round(avg(done_4h::INT), 4) AS follow_through_4h, round(avg(done_1d::INT), 4) AS follow_through_1d
FROM follow_through GROUP BY 1 ORDER BY 1;
SELECT round(avg(done_4h::INT) FILTER (WHERE prog) / avg(done_4h::INT) FILTER (WHERE NOT prog), 4) AS follow_through_4h_ratio,
 round(avg(done_1d::INT) FILTER (WHERE prog) / avg(done_1d::INT) FILTER (WHERE NOT prog), 4) AS follow_through_1d_ratio FROM follow_through;

-- ─────────────────────────────────────────────────────────────────────────
-- CHECKS — lifecycle and segment realism (not stories)
-- ─────────────────────────────────────────────────────────────────────────
-- account deactivated by week (Monday weeks; the first and last are partial):
-- steady from June 4 to October 1, no ramp at the start and no cliff at the end
SELECT date_trunc('week', t)::DATE AS week, count(DISTINCT t::DATE) AS days, count(*) AS deactivations,
 round(count(*)::DOUBLE / count(DISTINCT t::DATE), 2) AS per_day
FROM ev WHERE event = 'account deactivated' GROUP BY 1 ORDER BY 1;
-- deactivations per day: Jun-Aug vs September
SELECT CASE WHEN t < TIMESTAMP '2026-09-01' THEN '1 Jun 4 - Aug 31' ELSE '2 Sep 1 - Oct 1' END AS period,
 count(*) AS deactivations, round(count(*)::DOUBLE / count(DISTINCT t::DATE), 2) AS per_day
FROM ev WHERE event = 'account deactivated' GROUP BY 1 ORDER BY 1;
-- challenges and social features per member by segment (members with events)
WITH m AS (SELECT u.segment, e.uid, count(*) FILTER (WHERE e.event = 'challenge joined') AS joins,
  count(*) FILTER (WHERE e.event = 'friend added') AS friends, count(*) FILTER (WHERE e.event = 'leaderboard viewed') AS leaderboards,
  count(*) FILTER (WHERE e.event = 'workout completed') AS workouts
  FROM ev e JOIN users u ON u.distinct_id::VARCHAR = e.uid GROUP BY ALL)
SELECT segment, count(*) AS members, round(avg(joins), 1) AS challenge_joins, quantile_cont(joins, 0.9) AS joins_p90, max(joins) AS joins_max,
 round(avg(friends), 1) AS friends_added, round(avg(leaderboards), 1) AS leaderboard_views, round(avg(workouts), 1) AS workouts
FROM m GROUP BY 1 ORDER BY 1;
-- most challenges a free member is in at once (Free plan limit: 3)
WITH j AS (SELECT uid, t, t + duration_days * INTERVAL 1 DAY AS te, subscription_tier FROM ev WHERE event = 'challenge joined')
SELECT max(n) AS max_running_at_a_free_join FROM (SELECT a.uid, a.t, count(*) AS n FROM j a JOIN j b ON a.uid = b.uid AND b.t <= a.t AND b.te > a.t
 WHERE a.subscription_tier = 'free' GROUP BY ALL);
-- app opens vs planned and completed workouts (app opened is the most common event)
SELECT count(*) FILTER (WHERE event = 'app opened') AS app_opens, count(*) FILTER (WHERE event = 'workout planned') AS workouts_planned,
 count(*) FILTER (WHERE event = 'workout completed') AS workouts_completed FROM ev;
-- Platform agrees with the device os on every event; one Platform per member
SELECT Platform, os, count(*) AS events FROM ev GROUP BY ALL ORDER BY ALL;
SELECT count(*) AS members_with_two_platforms FROM (SELECT uid FROM ev GROUP BY 1 HAVING count(DISTINCT Platform) > 1);
-- human coaching: sessions and coach-hours by plan at the session (Plus includes one a billing month)
SELECT subscription_tier, count(*) AS sessions, count(DISTINCT uid) AS members, round(sum(session_minutes) / 60.0) AS coach_hours
FROM ev WHERE event = 'coach session' GROUP BY 1 ORDER BY 1;
SELECT count(*) AS sessions, round(sum(session_minutes) / 60.0) AS coach_hours, round(sum(session_minutes) / 60.0 / 120, 1) AS coach_hours_per_day,
 round(sum(session_minutes) / 60.0 / (120 / 7.0), 1) AS coach_hours_per_week
FROM ev WHERE event = 'coach session';
-- notifications after a member's last member-initiated event (server-side messages keep arriving, unopened)
WITH la AS (SELECT uid, max(t) AS last_active FROM ev WHERE event NOT IN ('notification received', 'account deactivated') GROUP BY 1)
SELECT count(*) AS notifications_after_last_activity, round(avg(opened::INT), 4) AS open_rate,
 count(DISTINCT n.uid) AS members FROM ev n JOIN la USING (uid) WHERE n.event = 'notification received' AND n.t > la.last_active + INTERVAL 7 DAY;
SELECT count(*) AS notifications_after_deactivation FROM ev n JOIN (SELECT uid, min(t) AS td FROM ev WHERE event = 'account deactivated' GROUP BY 1) d USING (uid)
WHERE n.event = 'notification received' AND n.t > d.td;
-- weekly series of every event (events per day; Monday weeks, the first and last are partial):
-- no event ramps up from an empty June
PIVOT (SELECT event, date_trunc('week', t)::DATE AS week, round(count(*)::DOUBLE / count(DISTINCT t::DATE)) AS per_day FROM ev GROUP BY ALL)
ON week USING first(per_day) ORDER BY event;

-- ═════════════════════════════════════════════════════════════════════════
-- EVAL QUERIES (one per question in eval/fitness.eval.md)
-- ═════════════════════════════════════════════════════════════════════════

-- EVAL Q1 — Guided First Week onboarding conversion by variant (7-day window)
SELECT variant, count(*) AS enrolled_signups, count(*) FILTER (WHERE converted) AS finished,
 round(avg(converted::INT), 4) AS conversion,
 round(avg(converted::INT) / (SELECT avg(converted::INT) FROM onboarding WHERE variant = 'Control'), 4) AS lift_vs_control
FROM onboarding WHERE variant IS NOT NULL GROUP BY 1 ORDER BY 1;
-- downstream: Plus buyers per enrolled signup by variant
WITH b AS (SELECT DISTINCT uid FROM ev WHERE event = 'subscription purchased')
SELECT variant, count(*) AS enrolled_signups, count(b.uid) AS buyers, round(count(b.uid)::DOUBLE / count(*), 4) AS buy_rate
FROM onboarding o LEFT JOIN b USING (uid) WHERE variant IS NOT NULL GROUP BY 1 ORDER BY 1;
-- two-proportion z, Guided Plan vs Control buyers per enrolled signup
WITH b AS (SELECT DISTINCT uid FROM ev WHERE event = 'subscription purchased'),
g AS (SELECT variant, count(*) AS n, count(b.uid) AS x FROM onboarding o LEFT JOIN b USING (uid) WHERE variant IS NOT NULL GROUP BY 1),
w AS (SELECT gp.x::DOUBLE / gp.n AS pg, c.x::DOUBLE / c.n AS pc, (gp.x + c.x)::DOUBLE / (gp.n + c.n) AS pp, gp.n AS ng, c.n AS nc
  FROM g gp JOIN g c ON gp.variant = 'Guided Plan' AND c.variant = 'Control')
SELECT round(pg / pc, 4) AS buy_rate_ratio, round((pg - pc) / sqrt(pp * (1 - pp) * (1.0 / ng + 1.0 / nc)), 2) AS z FROM w;
-- all new members: those who finish onboarding vs those who do not (activity and Plus purchase)
WITH a AS (SELECT o.uid, o.converted,
  count(*) FILTER (WHERE e.event = 'workout completed') AS workouts, count(*) FILTER (WHERE e.event = 'app opened') AS opens,
  count(*) FILTER (WHERE e.event = 'paywall viewed') AS paywalls, max((e.event = 'trial started')::INT) AS trial,
  max((e.event = 'challenge joined')::INT) AS challenge, max((e.event = 'subscription purchased')::INT) AS buyer
  FROM onboarding o JOIN ev e ON e.uid = o.uid GROUP BY 1, 2)
SELECT converted AS finished_onboarding, count(*) AS members, round(avg(workouts), 2) AS workouts_per_member, round(avg(opens), 2) AS app_opens_per_member,
 round(avg(paywalls), 2) AS paywall_views_per_member, round(avg(trial), 4) AS trial_rate, round(avg(challenge), 4) AS challenge_rate, round(avg(buyer), 4) AS buy_rate
FROM a GROUP BY 1 ORDER BY 1;

-- EVAL Q2 — median time from signup to starter workout, by variant
SELECT variant, round(median(ttc_s) / 3600.0, 2) AS median_hours,
 round(median(ttc_s) / (SELECT median(ttc_s) FROM onboarding WHERE variant = 'Control'), 4) AS ratio_vs_control
FROM onboarding WHERE variant IS NOT NULL AND converted GROUP BY 1 ORDER BY 1;

-- EVAL Q3 — Plus workout duration before vs after the Stride Coach launch, by coaching mode
SELECT (t >= TIMESTAMP '2026-08-12') AS after_launch, coaching_mode, count(*) AS workouts, round(avg(duration_minutes), 2) AS avg_minutes
FROM ev WHERE event = 'workout completed' AND subscription_tier <> 'free' GROUP BY ALL ORDER BY ALL;

-- all workouts before vs after launch (the diluted read)
SELECT (t >= TIMESTAMP '2026-08-12') AS after_launch, round(avg(duration_minutes), 2) AS avg_minutes_all_workouts
FROM ev WHERE event = 'workout completed' GROUP BY 1 ORDER BY 1;

-- EVAL Q4 — share of Plus workouts using Stride Coach since launch, by week and overall
SELECT date_trunc('week', t) AS week, count(*) AS plus_workouts,
 round(count(*) FILTER (WHERE coaching_mode = 'ai_coach')::DOUBLE / count(*), 4) AS ai_share
FROM ev WHERE event = 'workout completed' AND subscription_tier <> 'free' AND t >= TIMESTAMP '2026-08-12'
GROUP BY 1 ORDER BY 1;
SELECT round(count(*) FILTER (WHERE coaching_mode = 'ai_coach')::DOUBLE / count(*), 4) AS ai_share_overall,
 round(count(*) FILTER (WHERE coaching_mode = 'ai_coach' AND t >= TIMESTAMP '2026-09-02')::DOUBLE / count(*) FILTER (WHERE t >= TIMESTAMP '2026-09-02'), 4) AS ai_share_from_sep_2
FROM ev WHERE event = 'workout completed' AND subscription_tier <> 'free' AND t >= TIMESTAMP '2026-08-12';
-- adoption by member: Plus members with 10+ workouts from Sep 2, by their own Stride Coach share
WITH m AS (SELECT uid, avg((coaching_mode = 'ai_coach')::INT) AS s FROM ev
  WHERE event = 'workout completed' AND subscription_tier <> 'free' AND t >= TIMESTAMP '2026-09-02' GROUP BY 1 HAVING count(*) >= 10)
SELECT CASE WHEN s = 0 THEN '1 never' WHEN s < 0.25 THEN '2 under 25%' WHEN s < 0.5 THEN '3 25-49%' WHEN s < 0.75 THEN '4 50-74%' ELSE '5 75%+' END AS member_use, count(*) AS members,
 round(count(*)::DOUBLE / sum(count(*)) OVER (), 4) AS share_of_members
FROM m GROUP BY 1 ORDER BY 1;

-- EVAL Q5 — workout intensity, Stride Coach vs self-guided (Plus, after launch)
SELECT coaching_mode, count(*) AS workouts, round(avg(avg_heart_rate), 1) AS avg_heart_rate, round(avg(perceived_effort), 2) AS avg_perceived_effort,
 round(sum(calories_burned)::DOUBLE / sum(duration_minutes), 2) AS calories_per_minute
FROM ev WHERE event = 'workout completed' AND subscription_tier <> 'free' AND t >= TIMESTAMP '2026-08-12'
GROUP BY 1 ORDER BY 1;

-- EVAL Q6 — daily workouts by tracking source around the August incident, with warehouse error rate
WITH d AS (SELECT t::DATE AS day,
  count(*) FILTER (WHERE tracking_source = 'wearable' AND wearable_type IN ('smartwatch', 'fitness_band')) AS watch_band,
  count(*) FILTER (WHERE tracking_source = 'wearable' AND wearable_type = 'chest_strap') AS chest_strap,
  count(*) FILTER (WHERE tracking_source = 'phone') AS phone
  FROM ev WHERE event = 'workout completed' AND t >= TIMESTAMP '2026-08-13' AND t < TIMESTAMP '2026-08-30' GROUP BY 1),
e AS (SELECT date::DATE AS day, max(sync_error_rate) FILTER (WHERE wearable_type = 'smartwatch') AS smartwatch_err FROM wh_sync GROUP BY 1)
SELECT d.*, e.smartwatch_err FROM d JOIN e USING (day) ORDER BY day;
WITH od AS (SELECT DISTINCT date::DATE AS d FROM wh_sync WHERE sync_error_rate > 0.2),
w AS (SELECT t::DATE AS d,
  CASE WHEN tracking_source = 'wearable' AND wearable_type IN ('smartwatch', 'fitness_band') THEN 'aff' ELSE 'ctl' END AS arm
  FROM ev WHERE event = 'workout completed' AND t >= TIMESTAMP '2026-08-13' AND t < TIMESTAMP '2026-08-30'),
g AS (SELECT (d IN (SELECT d FROM od)) AS outage, count(DISTINCT d) AS days, count(*) FILTER (WHERE arm = 'aff') AS aff, count(*) FILTER (WHERE arm = 'ctl') AS ctl FROM w GROUP BY 1)
SELECT outage, days, round(aff::DOUBLE / days, 1) AS watch_band_per_day, round(ctl::DOUBLE / days, 1) AS unaffected_per_day,
 round(aff::DOUBLE / ctl, 4) AS watch_band_per_unaffected,
 round((aff::DOUBLE / ctl) / (SELECT aff::DOUBLE / ctl FROM g WHERE NOT outage), 4) AS vs_baseline FROM g ORDER BY outage;
-- same weekdays (Thu-Sat) one week before and after, so the Friday-Saturday dip cancels
WITH w AS (SELECT CASE WHEN t::DATE BETWEEN DATE '2026-08-20' AND DATE '2026-08-22' THEN 'outage Aug 20-22'
    ELSE 'same weekdays Aug 13-15 + 27-29' END AS period,
  CASE WHEN tracking_source = 'wearable' AND wearable_type IN ('smartwatch', 'fitness_band') THEN 'aff' ELSE 'ctl' END AS arm, t::DATE AS d
  FROM ev WHERE event = 'workout completed' AND (t::DATE BETWEEN DATE '2026-08-13' AND DATE '2026-08-15'
    OR t::DATE BETWEEN DATE '2026-08-20' AND DATE '2026-08-22' OR t::DATE BETWEEN DATE '2026-08-27' AND DATE '2026-08-29'))
SELECT period, count(DISTINCT d) AS days, round(count(*) FILTER (WHERE arm = 'aff')::DOUBLE / count(DISTINCT d), 1) AS watch_band_per_day,
 round(count(*) FILTER (WHERE arm = 'ctl')::DOUBLE / count(DISTINCT d), 1) AS unaffected_per_day FROM w GROUP BY 1 ORDER BY 1;

-- the same members' own control: watch and band owners' wearable-tracked workouts per
-- planned workout (the H3 story read), by day and outage vs the 7 days on each side
SELECT t::DATE AS day, count(*) FILTER (WHERE event = 'workout completed' AND tracking_source = 'wearable') AS synced_workouts,
 count(*) FILTER (WHERE event = 'workout planned') AS planned_workouts,
 round(count(*) FILTER (WHERE event = 'workout completed' AND tracking_source = 'wearable')::DOUBLE / count(*) FILTER (WHERE event = 'workout planned'), 3) AS synced_per_plan
FROM ev WHERE event IN ('workout completed', 'workout planned') AND uid IN (SELECT uid FROM watch_band_owners)
 AND t >= TIMESTAMP '2026-08-13' AND t < TIMESTAMP '2026-08-30' GROUP BY 1 ORDER BY 1;

-- the wearable_type-only read (breakdown by the device a member owns, no tracking_source
-- filter): owners of a watch or band also log some workouts with the phone, and those
-- kept syncing, so this read is diluted. Owners' workouts vs everyone else's, outage
-- days vs the 7 days on each side; and per device type against members with no wearable.
WITH od AS (SELECT DISTINCT date::DATE AS d FROM wh_sync WHERE sync_error_rate > 0.2),
w AS (SELECT t::DATE AS d, wearable_type AS wt
  FROM ev WHERE event = 'workout completed' AND t >= TIMESTAMP '2026-08-13' AND t < TIMESTAMP '2026-08-30'),
g AS (SELECT (d IN (SELECT d FROM od)) AS outage,
  count(*) FILTER (WHERE wt IN ('smartwatch', 'fitness_band')) AS owners, count(*) FILTER (WHERE wt NOT IN ('smartwatch', 'fitness_band')) AS others,
  count(*) FILTER (WHERE wt = 'smartwatch') AS smartwatch, count(*) FILTER (WHERE wt = 'fitness_band') AS fitness_band,
  count(*) FILTER (WHERE wt = 'chest_strap') AS chest_strap, count(*) FILTER (WHERE wt = 'none') AS no_wearable FROM w GROUP BY 1)
SELECT round((max(owners::DOUBLE / others) FILTER (WHERE outage)) / (max(owners::DOUBLE / others) FILTER (WHERE NOT outage)), 4) AS watch_band_owners_vs_others,
 round((max(smartwatch::DOUBLE / no_wearable) FILTER (WHERE outage)) / (max(smartwatch::DOUBLE / no_wearable) FILTER (WHERE NOT outage)), 4) AS smartwatch_owners_vs_none,
 round((max(fitness_band::DOUBLE / no_wearable) FILTER (WHERE outage)) / (max(fitness_band::DOUBLE / no_wearable) FILTER (WHERE NOT outage)), 4) AS fitness_band_owners_vs_none,
 round((max(chest_strap::DOUBLE / no_wearable) FILTER (WHERE outage)) / (max(chest_strap::DOUBLE / no_wearable) FILTER (WHERE NOT outage)), 4) AS chest_strap_owners_vs_none
FROM g;

-- EVAL Q7 — which devices were hit: per-device workouts per phone workout, outage vs the surrounding week
WITH od AS (SELECT DISTINCT date::DATE AS d FROM wh_sync WHERE sync_error_rate > 0.2),
w AS (SELECT t::DATE AS d, CASE WHEN tracking_source = 'wearable' THEN wearable_type ELSE tracking_source END AS src
  FROM ev WHERE event = 'workout completed' AND t >= TIMESTAMP '2026-08-13' AND t < TIMESTAMP '2026-08-30'),
g AS (SELECT (d IN (SELECT d FROM od)) AS outage, src, count(*) AS n FROM w GROUP BY ALL),
r AS (SELECT outage, src, n::DOUBLE / sum(n) FILTER (WHERE src = 'phone') OVER (PARTITION BY outage) AS per_phone FROM g)
SELECT src, round(max(per_phone) FILTER (WHERE outage) / max(per_phone) FILTER (WHERE NOT outage), 4) AS outage_vs_baseline
FROM r WHERE src <> 'phone' GROUP BY 1 ORDER BY 1;
SELECT wearable_type, partner_api_status, count(*) AS days, round(avg(sync_error_rate), 4) AS avg_error_rate, round(avg(p95_sync_latency_ms)) AS avg_p95_ms
FROM wh_sync GROUP BY ALL ORDER BY ALL;

-- EVAL Q8 — Plus purchases by plan, August vs September (calendar months), and the before/after-Sep-1 mix shift
SELECT strftime(t, '%Y-%m') AS month,
 count(*) FILTER (WHERE plan = 'monthly') AS monthly, count(*) FILTER (WHERE plan = 'annual') AS annual,
 round(count(*) FILTER (WHERE plan = 'monthly')::DOUBLE / count(*), 4) AS monthly_share
FROM ev WHERE event = 'subscription purchased' AND t >= TIMESTAMP '2026-08-01' AND t < TIMESTAMP '2026-10-01' GROUP BY 1 ORDER BY 1;
WITH g AS (SELECT (t >= TIMESTAMP '2026-09-01') AS post, count(*) FILTER (WHERE plan = 'monthly')::DOUBLE / count(*) FILTER (WHERE plan = 'annual') AS m_per_a
  FROM ev WHERE event = 'subscription purchased' GROUP BY 1)
SELECT round(max(m_per_a) FILTER (WHERE NOT post), 4) AS monthly_per_annual_before, round(max(m_per_a) FILTER (WHERE post), 4) AS monthly_per_annual_after,
 round(max(m_per_a) FILTER (WHERE post) / max(m_per_a) FILTER (WHERE NOT post), 4) AS ratio FROM g;

-- EVAL Q9 — plan gross bookings (warehouse list price x Mixpanel purchases), August vs September (calendar months)
WITH p AS (SELECT t::DATE AS d, plan FROM ev WHERE event = 'subscription purchased' AND t >= TIMESTAMP '2026-08-01' AND t < TIMESTAMP '2026-10-01'),
j AS (SELECT p.*, b.list_price_usd FROM p JOIN wh_billing b ON b.date::DATE = p.d AND b.plan = p.plan)
SELECT strftime(d, '%Y-%m') AS month, plan, count(*) AS purchases,
 round(sum(list_price_usd), 2) AS gross_bookings
FROM j GROUP BY ALL ORDER BY ALL;
WITH p AS (SELECT t::DATE AS d, plan FROM ev WHERE event = 'subscription purchased'),
j AS (SELECT p.*, b.list_price_usd FROM p JOIN wh_billing b ON b.date::DATE = p.d AND b.plan = p.plan),
g AS (SELECT (d >= DATE '2026-09-01') AS post, sum(list_price_usd) FILTER (WHERE plan = 'monthly') / sum(list_price_usd) FILTER (WHERE plan = 'annual') AS m_rev_per_a FROM j GROUP BY 1)
SELECT round(max(m_rev_per_a) FILTER (WHERE post) / max(m_rev_per_a) FILTER (WHERE NOT post), 4) AS monthly_vs_annual_bookings_ratio FROM g;
-- the same reads from the billing table alone (billing counts drift slightly from Mixpanel purchases)
SELECT strftime(date::DATE, '%Y-%m') AS month, plan, sum(new_subscriptions) AS new_subscriptions, round(sum(gross_bookings_usd), 2) AS gross_bookings_usd
FROM wh_billing WHERE date::DATE >= DATE '2026-08-01' AND date::DATE < DATE '2026-10-01' GROUP BY ALL ORDER BY ALL;
WITH g AS (SELECT (date::DATE >= DATE '2026-09-01') AS post,
  sum(gross_bookings_usd) FILTER (WHERE plan = 'monthly') / sum(gross_bookings_usd) FILTER (WHERE plan = 'annual') AS m_rev_per_a FROM wh_billing GROUP BY 1)
SELECT round(max(m_rev_per_a) FILTER (WHERE post) / max(m_rev_per_a) FILTER (WHERE NOT post), 4) AS billing_table_monthly_vs_annual_bookings_ratio FROM g;

-- EVAL Q10 — spend per Mixpanel signup by paid channel, Summer Shred vs rest of window
WITH s AS (SELECT t0::DATE AS d, ch, count(*) AS n FROM signups GROUP BY ALL),
j AS (SELECT p.acquisition_channel AS ch, (p.date::DATE >= DATE '2026-06-15' AND p.date::DATE < DATE '2026-07-15') AS shred,
  sum(p.spend_usd) AS spend, sum(coalesce(s.n, 0)) AS signups
  FROM wh_paid p LEFT JOIN s ON s.d = p.date::DATE AND s.ch = p.acquisition_channel GROUP BY ALL)
SELECT ch, shred, round(spend, 2) AS spend_usd, signups, round(spend / signups, 2) AS spend_per_signup FROM j ORDER BY ch, shred;

-- EVAL Q11 — did Summer Shred add members? daily signups by channel inside (30 days) vs outside (90 days)
WITH s AS (SELECT (t0 >= TIMESTAMP '2026-06-15' AND t0 < TIMESTAMP '2026-07-15') AS shred, ch FROM signups),
g AS (SELECT shred, ch, count(*) AS signups FROM s GROUP BY ALL)
-- z = (campaign signups − 30 days at the outside rate) / Poisson sd of that difference
SELECT ch, max(signups) FILTER (WHERE shred) AS shred_signups, max(signups) FILTER (WHERE NOT shred) AS other_signups,
 round(max(signups) FILTER (WHERE shred) / 30.0, 2) AS shred_per_day,
 round(max(signups) FILTER (WHERE NOT shred) / 90.0, 2) AS other_per_day,
 round((max(signups) FILTER (WHERE shred) / 30.0) / (max(signups) FILTER (WHERE NOT shred) / 90.0), 4) AS lift,
 round(max(signups) FILTER (WHERE shred)::DOUBLE / sum(max(signups) FILTER (WHERE shred)) OVER (), 4) AS shred_share,
 round(max(signups) FILTER (WHERE NOT shred)::DOUBLE / sum(max(signups) FILTER (WHERE NOT shred)) OVER (), 4) AS other_share,
 round((max(signups) FILTER (WHERE shred) - max(signups) FILTER (WHERE NOT shred) / 3.0)
  / sqrt(max(signups) FILTER (WHERE shred) + max(signups) FILTER (WHERE NOT shred) / 9.0), 2) AS z
FROM g GROUP BY ch ORDER BY ch;
-- totals, and the cost of the extra members: extra paid-social spend / extra signups
WITH t AS (SELECT count(*) FILTER (WHERE t0 >= TIMESTAMP '2026-06-15' AND t0 < TIMESTAMP '2026-07-15') / 30.0 AS in_pd,
  count(*) FILTER (WHERE NOT (t0 >= TIMESTAMP '2026-06-15' AND t0 < TIMESTAMP '2026-07-15')) / 90.0 AS out_pd FROM signups),
sp AS (SELECT sum(spend_usd) FILTER (WHERE date::DATE >= DATE '2026-06-15' AND date::DATE < DATE '2026-07-15') / 30.0 AS in_pd,
  sum(spend_usd) FILTER (WHERE NOT (date::DATE >= DATE '2026-06-15' AND date::DATE < DATE '2026-07-15')) / 90.0 AS out_pd
  FROM wh_paid WHERE acquisition_channel = 'paid_social')
SELECT round(t.in_pd, 2) AS signups_per_day_shred, round(t.out_pd, 2) AS signups_per_day_other, round(t.in_pd / t.out_pd, 4) AS volume_lift,
 round((t.in_pd - t.out_pd) * 30) AS extra_members,
 round(sp.in_pd, 2) AS paid_social_spend_per_day_shred, round(sp.out_pd, 2) AS paid_social_spend_per_day_other,
 round((sp.in_pd - sp.out_pd) * 30, 2) AS extra_spend_usd,
 round((sp.in_pd - sp.out_pd) / (t.in_pd - t.out_pd), 2) AS cost_per_extra_member
FROM t, sp;

-- EVAL Q12 — Plus purchase rate and spend per paying member by acquisition channel (new members)
WITH b AS (SELECT DISTINCT uid FROM ev WHERE event = 'subscription purchased'),
c AS (SELECT s.ch, count(*) AS signups, count(b.uid) AS buyers FROM signups s LEFT JOIN b ON b.uid = s.uid GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM wh_paid GROUP BY 1)
SELECT c.ch, signups, buyers, round(buyers::DOUBLE / signups, 4) AS buy_rate, round(sp.spend, 2) AS spend_usd,
 round(sp.spend / nullif(buyers, 0), 2) AS spend_per_paying_member
FROM c LEFT JOIN sp USING (ch) ORDER BY ch;
WITH b AS (SELECT DISTINCT uid FROM ev WHERE event = 'subscription purchased'),
w AS (SELECT date_trunc('week', s.t0) AS wk,
  count(*) FILTER (WHERE ch = 'paid_social') AS sn, count(b.uid) FILTER (WHERE ch = 'paid_social') AS sb,
  count(*) FILTER (WHERE ch <> 'paid_social') AS onn, count(b.uid) FILTER (WHERE ch <> 'paid_social') AS ob
  FROM signups s LEFT JOIN b ON b.uid = s.uid GROUP BY 1)
SELECT round(sum(sb)::DOUBLE / sum(sn * ob::DOUBLE / nullif(onn, 0)), 4) AS paid_social_vs_other_same_week FROM w WHERE onn > 0;
-- the same funnel with a 30-day conversion window (Mixpanel's default): purchase within 30 days of signup
WITH b AS (SELECT s.uid, min(e.t) AS tb FROM signups s JOIN ev e ON e.uid = s.uid AND e.event = 'subscription purchased' AND e.t >= s.t0 GROUP BY 1)
SELECT CASE WHEN s.ch = 'paid_social' THEN 'paid_social' ELSE 'other channels' END AS grp, count(*) AS signups,
 round(avg((b.tb IS NOT NULL AND b.tb <= s.t0 + INTERVAL 30 DAY)::INT), 4) AS buy_rate_30d,
 round(avg((b.tb IS NOT NULL)::INT), 4) AS buy_rate_whole_window
FROM signups s LEFT JOIN b ON b.uid = s.uid GROUP BY 1 ORDER BY 1;

-- EVAL Q13 — Week-4 retention by first-week workout count (members who signed up by 2026-08-27)
-- (a return = any member-initiated event; notification received and account deactivated excluded)
SELECT least(early_workouts, 6) AS first_week_workouts_capped, count(*) AS members, round(avg((w4_events > 0)::INT), 4) AS week4_retention,
 round(avg((w4_any_events > 0)::INT), 4) AS week4_any_event_incl_notifications
FROM habit GROUP BY 1 ORDER BY 1;
SELECT CASE WHEN early_workouts >= 3 THEN '3+' ELSE '0-2' END AS grp, count(*) AS members, round(avg((w4_events > 0)::INT), 4) AS week4_retention
FROM habit GROUP BY 1 ORDER BY 1;
SELECT round(avg((w4_events > 0)::INT), 4) AS week4_retention_all_new_members, count(*) AS members, round(avg((early_workouts < 3)::INT), 4) AS share_0_2_early,
 round((SELECT avg((w4_any_events > 0)::INT) FROM habit WHERE early_workouts >= 5) / (SELECT avg((w4_any_events > 0)::INT) FROM habit WHERE early_workouts = 0), 4) AS five_plus_vs_zero_any_event
FROM habit;

-- EVAL Q14 — per-challenge completion by format (joins Jun 4 - Aug 31, 31-day window)
SELECT challenge_format, count(*) AS challenges, count(*) FILTER (WHERE completed) AS completed,
 round(avg(completed::INT), 4) AS completion_rate
FROM challenges WHERE tj < TIMESTAMP '2026-09-01' GROUP BY 1 ORDER BY 1;
-- the same funnel over every join in the window: September joins have not had time to finish
SELECT challenge_format, count(*) AS challenges, round(avg(completed::INT), 4) AS completion_rate_all_joins
FROM challenges GROUP BY 1 ORDER BY 1;
-- member-level read (any completion per format, joins Jun 4 - Aug 31): hides most of the gap
WITH j AS (SELECT uid, challenge_format AS f, min(tj) AS tj, max(completed::INT) AS any_done FROM challenges WHERE tj < TIMESTAMP '2026-09-01' GROUP BY ALL)
SELECT f AS challenge_format, count(*) AS members, round(avg(any_done), 4) AS share_completing_any FROM j GROUP BY 1 ORDER BY 1;
-- days from join to completion by challenge length
SELECT duration_days, round(median(days_to_complete) FILTER (WHERE completed), 1) AS median_days_to_complete FROM challenges GROUP BY 1 ORDER BY 1;

-- weekly trend (Monday weeks; the first and last are partial): completions per join are flat
-- from the first week, because challenges joined before June 4 still complete in June
SELECT date_trunc('week', t)::DATE AS week, count(DISTINCT t::DATE) AS days,
 count(*) FILTER (WHERE event = 'challenge joined') AS joins, count(*) FILTER (WHERE event = 'challenge completed') AS completions,
 round(count(*) FILTER (WHERE event = 'challenge completed')::DOUBLE / count(*) FILTER (WHERE event = 'challenge joined'), 3) AS completions_per_join
FROM ev WHERE event IN ('challenge joined', 'challenge completed') GROUP BY 1 ORDER BY 1;

-- EVAL Q15 — notification open rate by members' notification volume, by recent volume, and over time
-- members who joined before June 4 (they do not lapse in the window), by notification count in the window
SELECT CASE WHEN n < 12 THEN '1 01-11' WHEN n < 24 THEN '2 12-23' WHEN n < 36 THEN '3 24-35' WHEN n < 48 THEN '4 36-47' ELSE '5 48+' END AS notifications_received,
 count(*) AS members, round(sum(opens)::DOUBLE / sum(n), 4) AS open_rate
FROM push WHERE pre_window GROUP BY 1 ORDER BY 1;
-- every member (new members who stopped using the app still receive notifications, unopened)
SELECT CASE WHEN n < 12 THEN '1 01-11' WHEN n < 24 THEN '2 12-23' WHEN n < 36 THEN '3 24-35' WHEN n < 48 THEN '4 36-47' ELSE '5 48+' END AS notifications_received,
 count(*) AS members, round(sum(opens)::DOUBLE / sum(n), 4) AS open_rate
FROM push GROUP BY 1 ORDER BY 1;
-- new members: notifications while still active vs after their last member-initiated event
WITH la AS (SELECT uid, max(t) AS last_active FROM ev WHERE event NOT IN ('notification received', 'account deactivated') GROUP BY 1)
SELECT (p.t > la.last_active) AS after_last_activity, count(*) AS notifications, round(avg(p.opened::INT), 4) AS open_rate
FROM push_seq p JOIN la USING (uid) WHERE NOT p.pre_window GROUP BY 1 ORDER BY 1;
-- by notifications the member received in the previous 30 days (from 2026-07-04, when the look-back is complete; members who joined before June 4)
SELECT CASE WHEN recent <= 4 THEN '1 0-4' WHEN recent <= 7 THEN '2 5-7' WHEN recent <= 11 THEN '3 8-11' WHEN recent <= 15 THEN '4 12-15' ELSE '5 16+' END AS recent_30d,
 count(*) AS notifications, round(count(*)::DOUBLE / sum(count(*)) OVER (), 4) AS share_of_notifications, round(avg(opened::INT), 4) AS open_rate
FROM push_seq WHERE t >= TIMESTAMP '2026-07-04' AND pre_window GROUP BY 1 ORDER BY 1;
-- members who joined before June 4, by calendar month (no trend); and every member
SELECT strftime(t, '%Y-%m') AS month, count(*) FILTER (WHERE pre_window) AS notifications_pre_window, round(avg(opened::INT) FILTER (WHERE pre_window), 4) AS open_rate_pre_window,
 count(*) AS notifications_all, round(avg(opened::INT), 4) AS open_rate_all FROM push_seq GROUP BY 1 ORDER BY 1;
-- members who ever had 12+ notifications in 30 days (from 2026-07-04; members who joined before June 4)
SELECT count(DISTINCT uid) AS members_12_plus_recent, round(count(DISTINCT uid)::DOUBLE / (SELECT count(*) FROM push WHERE pre_window), 4) AS share_of_pre_window_members_with_notifications
FROM push_seq WHERE t >= TIMESTAMP '2026-07-04' AND recent >= 12 AND pre_window;

-- EVAL Q16 — Fall Reset (Sep 8-21) vs the two weeks before: workouts, app opens, meals (untouched control)
WITH w AS (SELECT (t >= TIMESTAMP '2026-09-08') AS prog, event FROM ev
  WHERE event IN ('workout completed', 'app opened', 'meal logged') AND t >= TIMESTAMP '2026-08-25' AND t < TIMESTAMP '2026-09-22'),
g AS (SELECT prog, count(*) FILTER (WHERE event = 'workout completed') AS completed, count(*) FILTER (WHERE event = 'app opened') AS opens,
  count(*) FILTER (WHERE event = 'meal logged') AS meals FROM w GROUP BY 1)
SELECT prog, completed, opens, meals, round(completed::DOUBLE / opens, 4) AS completed_per_open,
 round((completed::DOUBLE / opens) / (SELECT completed::DOUBLE / opens FROM g WHERE NOT prog), 4) AS per_open_vs_before,
 round((completed::DOUBLE / meals) / (SELECT completed::DOUBLE / meals FROM g WHERE NOT prog), 4) AS workouts_per_meal_vs_before,
 round((opens::DOUBLE / meals) / (SELECT opens::DOUBLE / meals FROM g WHERE NOT prog), 4) AS opens_per_meal_vs_before FROM g ORDER BY prog;
-- plan follow-through (Workout Loop, 4-hour window, and 1 day): program vs before
SELECT prog, count(*) AS planned, round(avg(done_4h::INT), 4) AS follow_through_4h, round(avg(done_1d::INT), 4) AS follow_through_1d
FROM follow_through GROUP BY 1 ORDER BY 1;

-- EVAL Q17 — onboarding conversion by platform (all new members, 7-day window)
SELECT platform, count(*) AS signups, round(avg(converted::INT), 4) AS onboarding_conversion FROM onboarding GROUP BY 1 ORDER BY 1;
SELECT variant, platform, count(*) AS signups, round(avg(converted::INT), 4) AS onboarding_conversion
FROM onboarding WHERE variant IS NOT NULL GROUP BY ALL ORDER BY ALL;
-- two-proportion z test, android vs ios (all new members, then within each variant);
-- two-sided p from the normal CDF via the Abramowitz-Stegun 7.1.26 erf approximation
WITH g AS (SELECT CASE WHEN grouping(variant) = 1 THEN 'all new members' ELSE coalesce(variant, 'not enrolled') END AS scope,
  platform, count(*) AS n, sum(converted::INT) AS x FROM onboarding GROUP BY GROUPING SETS ((platform), (variant, platform))),
w AS (SELECT a.scope, a.x::DOUBLE / a.n AS pa, i.x::DOUBLE / i.n AS pi, (a.x + i.x)::DOUBLE / (a.n + i.n) AS pp, a.n AS na, i.n AS ni
  FROM g a JOIN g i ON a.scope = i.scope AND a.platform = 'android' AND i.platform = 'ios'),
z AS (SELECT scope, pa, pi, (pa - pi) / sqrt(pp * (1 - pp) * (1.0 / na + 1.0 / ni)) AS z FROM w),
e AS (SELECT *, abs(z) / sqrt(2) AS x, 1 / (1 + 0.3275911 * abs(z) / sqrt(2)) AS t FROM z)
SELECT scope, round(pa, 4) AS android, round(pi, 4) AS ios, round(z, 2) AS z,
 round(1 - (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-x * x)), 3) AS p_two_sided
FROM e ORDER BY scope;

-- EVAL Q18 — meal logging per app open during the sync outage vs the surrounding week
WITH w AS (SELECT (t >= TIMESTAMP '2026-08-20' AND t < TIMESTAMP '2026-08-23') AS outage, event FROM ev
  WHERE event IN ('meal logged', 'app opened') AND t >= TIMESTAMP '2026-08-13' AND t < TIMESTAMP '2026-08-30'),
g AS (SELECT outage, count(*) FILTER (WHERE event = 'meal logged') AS meals, count(*) FILTER (WHERE event = 'app opened') AS opens FROM w GROUP BY 1)
SELECT outage, meals, opens, round(meals::DOUBLE / opens, 4) AS meals_per_open,
 round((meals::DOUBLE / opens) / (SELECT meals::DOUBLE / opens FROM g WHERE NOT outage), 4) AS vs_baseline FROM g ORDER BY outage;
-- all members, per day: outage vs the same weekdays (Thu-Sat) one week before and after
WITH w AS (SELECT CASE WHEN t::DATE BETWEEN DATE '2026-08-20' AND DATE '2026-08-22' THEN 'outage Aug 20-22'
    ELSE 'same weekdays Aug 13-15 + 27-29' END AS period, event, t::DATE AS d
  FROM ev WHERE event IN ('meal logged', 'app opened') AND (t::DATE BETWEEN DATE '2026-08-13' AND DATE '2026-08-15'
    OR t::DATE BETWEEN DATE '2026-08-20' AND DATE '2026-08-22' OR t::DATE BETWEEN DATE '2026-08-27' AND DATE '2026-08-29'))
SELECT period, round(count(*) FILTER (WHERE event = 'app opened')::DOUBLE / count(DISTINCT d), 1) AS opens_per_day,
 round(count(*) FILTER (WHERE event = 'meal logged')::DOUBLE / count(DISTINCT d), 1) AS meals_per_day FROM w GROUP BY 1 ORDER BY 1;
-- Thu-Sat app opens in every full week outside Fall Reset (the week-to-week range)
WITH d AS (SELECT t::DATE AS d, count(*) AS opens FROM ev WHERE event = 'app opened' AND dayofweek(t) IN (4, 5, 6)
  AND t >= TIMESTAMP '2026-06-11' AND t < TIMESTAMP '2026-09-27' AND NOT (t >= TIMESTAMP '2026-09-08' AND t < TIMESTAMP '2026-09-22') GROUP BY 1),
wk AS (SELECT date_trunc('week', d) AS wk, sum(opens) AS opens FROM d GROUP BY 1)
SELECT count(*) FILTER (WHERE wk <> DATE '2026-08-17') AS other_weeks, min(opens) FILTER (WHERE wk <> DATE '2026-08-17') AS min_other,
 max(opens) FILTER (WHERE wk <> DATE '2026-08-17') AS max_other, max(opens) FILTER (WHERE wk = DATE '2026-08-17') AS outage_week FROM wk;
-- did members whose watch or band workouts stopped syncing use the app less than other members?
-- Each member active Aug 13-29 is one observation: their daily rate during the
-- outage (3 days) minus their daily rate on the 14 surrounding days. Welch test,
-- smartwatch / fitness-band owners vs everyone else (a member-level test: heavy
-- users make event counts overdispersed, so a Poisson test on totals overstates
-- significance). p two-sided via the Abramowitz-Stegun 7.1.26 erf approximation.
WITH m AS (SELECT distinct_id::VARCHAR AS uid, wearable_type IN ('smartwatch', 'fitness_band') AS aff FROM users),
a AS (SELECT DISTINCT uid FROM ev WHERE t >= TIMESTAMP '2026-08-13' AND t < TIMESTAMP '2026-08-30'),
x AS (SELECT a.uid, m.aff, k.event,
  count(e.t) FILTER (WHERE e.t >= TIMESTAMP '2026-08-20' AND e.t < TIMESTAMP '2026-08-23') / 3.0 AS o,
  count(e.t) FILTER (WHERE NOT (e.t >= TIMESTAMP '2026-08-20' AND e.t < TIMESTAMP '2026-08-23')) / 14.0 AS b
  FROM a JOIN m USING (uid) CROSS JOIN (VALUES ('app opened'), ('meal logged')) k(event)
  LEFT JOIN ev e ON e.uid = a.uid AND e.event = k.event AND e.t >= TIMESTAMP '2026-08-13' AND e.t < TIMESTAMP '2026-08-30'
  GROUP BY ALL),
s AS (SELECT event, aff, count(*) AS n, avg(o - b) AS d, var_samp(o - b) AS v, sum(o) AS so, sum(b) AS sb FROM x GROUP BY ALL),
w AS (SELECT a.event, a.n AS affected_members, u.n AS other_members, (a.so / a.sb) / (u.so / u.sb) AS did,
  (a.d - u.d) / sqrt(a.v / a.n + u.v / u.n) AS z FROM s a JOIN s u ON a.event = u.event AND a.aff AND NOT u.aff),
e AS (SELECT *, abs(z) / sqrt(2) AS x, 1 / (1 + 0.3275911 * abs(z) / sqrt(2)) AS t FROM w)
SELECT event, affected_members, other_members, round(did, 4) AS affected_vs_other_members, round(z, 2) AS z,
 round(1 - (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-x * x)), 3) AS p_two_sided
FROM e ORDER BY event;

-- EVAL Q19 — subscription bookings by month (warehouse)
SELECT strftime(date::DATE, '%Y-%m') AS month, sum(new_subscriptions) AS new_subscriptions,
 round(sum(gross_bookings_usd), 2) AS gross_bookings_usd, round(sum(store_fees_usd), 2) AS store_fees_usd, round(sum(net_bookings_usd), 2) AS net_bookings_usd
FROM wh_billing GROUP BY 1 ORDER BY 1;
-- billing counts vs Mixpanel purchases by month: settlement timing, failed or
-- refunded first payments, and store-page purchases make them differ slightly
WITH b AS (SELECT strftime(date::DATE, '%Y-%m') AS month, sum(new_subscriptions) AS billing FROM wh_billing GROUP BY 1),
m AS (SELECT strftime(t, '%Y-%m') AS month, count(*) AS mixpanel FROM ev WHERE event = 'subscription purchased' GROUP BY 1)
SELECT month, billing, mixpanel, billing - mixpanel AS difference FROM b FULL JOIN m USING (month) ORDER BY month;
-- weekly new subscriptions (Monday weeks; the first and last weeks are partial): June has no ramp
SELECT date_trunc('week', date::DATE) AS week, count(DISTINCT date::DATE) AS days, sum(new_subscriptions) AS new_subscriptions,
 round(sum(new_subscriptions)::DOUBLE / count(DISTINCT date::DATE), 2) AS per_day
FROM wh_billing GROUP BY 1 ORDER BY 1;
-- Mixpanel purchases by month and buyer type: pre-window members, new paid-social members, other new members
WITH p AS (SELECT uid, t FROM ev WHERE event = 'subscription purchased')
SELECT strftime(p.t, '%Y-%m') AS month, count(*) FILTER (WHERE s.uid IS NULL) AS pre_window_members,
 count(*) FILTER (WHERE s.ch = 'paid_social') AS new_paid_social, count(*) FILTER (WHERE s.ch <> 'paid_social') AS new_other_channels
FROM p LEFT JOIN signups s USING (uid) GROUP BY 1 ORDER BY 1;
-- weekly trial starts (members who joined shortly before June 4 still start trials in June)
SELECT date_trunc('week', t) AS week, count(*) AS trial_starts FROM ev WHERE event = 'trial started' GROUP BY 1 ORDER BY 1;

-- EVAL Q20 — open-ended: headline numbers for a Q4 risk review
SELECT 'paid social same-week buy rate vs other channels' AS metric,
 (WITH b AS (SELECT DISTINCT uid FROM ev WHERE event = 'subscription purchased'),
  w AS (SELECT date_trunc('week', s.t0) AS wk, count(*) FILTER (WHERE ch = 'paid_social') AS sn, count(b.uid) FILTER (WHERE ch = 'paid_social') AS sb,
   count(*) FILTER (WHERE ch <> 'paid_social') AS onn, count(b.uid) FILTER (WHERE ch <> 'paid_social') AS ob FROM signups s LEFT JOIN b ON b.uid = s.uid GROUP BY 1)
  SELECT round(sum(sb)::DOUBLE / sum(sn * ob::DOUBLE / nullif(onn, 0)), 4) FROM w WHERE onn > 0) AS value
UNION ALL
SELECT 'Summer Shred daily signup lift (all channels)',
 (SELECT round((count(*) FILTER (WHERE t0 >= TIMESTAMP '2026-06-15' AND t0 < TIMESTAMP '2026-07-15') / 30.0)
   / (count(*) FILTER (WHERE NOT (t0 >= TIMESTAMP '2026-06-15' AND t0 < TIMESTAMP '2026-07-15')) / 90.0), 4) FROM signups)
UNION ALL
SELECT 'monthly/annual purchase mix, after vs before Sep 1',
 (WITH g AS (SELECT (t >= TIMESTAMP '2026-09-01') AS post, count(*) FILTER (WHERE plan = 'monthly')::DOUBLE / count(*) FILTER (WHERE plan = 'annual') AS m FROM ev WHERE event = 'subscription purchased' GROUP BY 1)
  SELECT round(max(m) FILTER (WHERE post) / max(m) FILTER (WHERE NOT post), 4) FROM g)
UNION ALL
SELECT 'open rate, notifications with 0-4 others in the previous 30 days (from Jul 4, pre-window members)', (SELECT round(avg(opened::INT), 4) FROM push_seq WHERE recent <= 4 AND t >= TIMESTAMP '2026-07-04' AND pre_window)
UNION ALL
SELECT 'open rate, notifications with 12+ others in the previous 30 days (from Jul 4, pre-window members)', (SELECT round(avg(opened::INT), 4) FROM push_seq WHERE recent >= 12 AND t >= TIMESTAMP '2026-07-04' AND pre_window)
UNION ALL
SELECT 'share of notifications sent with 12+ others in the previous 30 days (from Jul 4, pre-window members)', (SELECT round(avg((recent >= 12)::INT), 4) FROM push_seq WHERE t >= TIMESTAMP '2026-07-04' AND pre_window)
UNION ALL
SELECT 'onboarding non-finishers who bought Plus (share)', (SELECT round(avg(b::INT), 4) FROM (SELECT o.uid, o.uid IN (SELECT uid FROM ev WHERE event = 'subscription purchased') AS b FROM onboarding o WHERE NOT o.converted))
UNION ALL
SELECT 'onboarding finishers who bought Plus (share)', (SELECT round(avg(b::INT), 4) FROM (SELECT o.uid, o.uid IN (SELECT uid FROM ev WHERE event = 'subscription purchased') AS b FROM onboarding o WHERE o.converted))
UNION ALL
SELECT 'Week-4 retention, 0 first-week workouts', (SELECT round(avg((w4_events > 0)::INT), 4) FROM habit WHERE early_workouts = 0)
UNION ALL
SELECT 'Week-4 retention, 5+ first-week workouts', (SELECT round(avg((w4_events > 0)::INT), 4) FROM habit WHERE early_workouts >= 5)
UNION ALL
SELECT 'share of new members with 0-2 first-week workouts', (SELECT round(avg((early_workouts < 3)::INT), 4) FROM habit)
UNION ALL
SELECT 'long-time free members (trial used) who bought Plus in the window (share)',
 (WITH lt AS (SELECT distinct_id::VARCHAR AS uid FROM users WHERE NOT trial_eligible),
  pf AS (SELECT DISTINCT uid FROM ev WHERE uid IN (SELECT uid FROM lt) AND subscription_tier = 'free')
  SELECT round(count(DISTINCT e.uid)::DOUBLE / (SELECT count(*) FROM pf), 4) FROM ev e WHERE e.event = 'subscription purchased' AND e.uid IN (SELECT uid FROM pf));
