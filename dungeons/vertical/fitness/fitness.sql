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
-- it on any event that carries both ids, the way Mixpanel stitches. Every
-- remaining event already carries user_id.

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

-- dataset overview
SELECT count(*) AS events, count(DISTINCT uid) AS users, min(t) AS first_event, max(t) AS last_event FROM ev;

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
SELECT coaching_mode, count(*) AS workouts, round(avg(duration_minutes), 2) AS avg_minutes, round(avg(calories_burned), 1) AS avg_calories
FROM ev WHERE event = 'workout completed' AND t >= TIMESTAMP '2026-08-12' AND subscription_tier <> 'free'
GROUP BY 1 ORDER BY 1;

SELECT count(*) FILTER (WHERE coaching_mode = 'ai_coach' AND (t < TIMESTAMP '2026-08-12' OR subscription_tier = 'free')) AS impure_rows
FROM ev WHERE event IN ('workout completed', 'workout planned');

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H3-wearable-sync-outage — partner health-API outage 2026-08-20..22
-- ─────────────────────────────────────────────────────────────────────────
WITH od AS (SELECT DISTINCT date::DATE AS d FROM wh_sync WHERE sync_error_rate > 0.2),
w AS (SELECT t::DATE AS d,
  CASE WHEN tracking_source = 'wearable' AND wearable_type IN ('smartwatch', 'fitness_band') THEN 'aff'
       WHEN tracking_source = 'phone' THEN 'phone' END AS arm
  FROM ev WHERE event = 'workout completed' AND t >= TIMESTAMP '2026-08-13' AND t < TIMESTAMP '2026-08-30'),
g AS (SELECT (d IN (SELECT d FROM od)) AS outage, count(*) FILTER (WHERE arm = 'aff') AS aff, count(*) FILTER (WHERE arm = 'phone') AS phone FROM w GROUP BY 1)
SELECT round((max(aff::DOUBLE / phone) FILTER (WHERE outage)) / (max(aff::DOUBLE / phone) FILTER (WHERE NOT outage)), 4) AS affected_vs_phone_did FROM g;

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
-- STORY H6-first-week-habit — 3+ workouts in the first 7 days
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE TEMP TABLE habit AS
WITH s AS (SELECT * FROM signups WHERE t0 < TIMESTAMP '2026-10-01 23:59:59' - INTERVAL 35 DAY)
SELECT s.uid, s.t0,
 count(*) FILTER (WHERE e.event = 'workout completed' AND e.t < s.t0 + INTERVAL 7 DAY) AS early_workouts,
 count(*) FILTER (WHERE e.t >= s.t0 + INTERVAL 28 DAY AND e.t < s.t0 + INTERVAL 35 DAY) AS d28_events
FROM s JOIN ev e ON e.uid = s.uid GROUP BY 1, 2;

SELECT CASE WHEN early_workouts >= 3 THEN 'habit (3+)' ELSE 'low (0-2)' END AS grp, count(*) AS members,
 round(avg((d28_events > 0)::INT), 4) AS d28_retention
FROM habit GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H7-team-vs-solo-challenges — per-challenge completion
-- ─────────────────────────────────────────────────────────────────────────
-- challenge_id is held constant, so each challenge converts on its own completion
CREATE OR REPLACE TEMP TABLE challenges AS
WITH j AS (SELECT uid, challenge_id, challenge_format, min(t) AS tj FROM ev WHERE event = 'challenge joined' GROUP BY ALL),
c AS (SELECT uid, challenge_id, min(t) AS tc FROM ev WHERE event = 'challenge completed' GROUP BY ALL)
SELECT j.*, coalesce(c.tc >= j.tj AND c.tc < j.tj + INTERVAL 30 DAY, false) AS completed FROM j LEFT JOIN c USING (uid, challenge_id);

SELECT challenge_format, count(*) AS challenges, round(avg(completed::INT), 4) AS completion_rate
FROM challenges GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H8-push-fatigue — 20+ notifications in the window
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE TEMP TABLE push AS
SELECT uid, count(*) AS n, sum(opened::INT) AS opens FROM ev WHERE event = 'notification received' GROUP BY 1;

SELECT CASE WHEN n >= 20 THEN 'heavy (20+)' ELSE 'light (<20)' END AS grp, count(*) AS members,
 round(sum(opens)::DOUBLE / sum(n), 4) AS open_rate
FROM push GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H9-fall-reset-program — 2026-09-08 for 14 days
-- ─────────────────────────────────────────────────────────────────────────
WITH w AS (SELECT (t >= TIMESTAMP '2026-09-08') AS prog, event FROM ev
  WHERE event IN ('workout completed', 'workout planned', 'app opened') AND t >= TIMESTAMP '2026-08-25' AND t < TIMESTAMP '2026-09-22'),
g AS (SELECT prog, count(*) FILTER (WHERE event = 'workout completed') AS completed, count(*) FILTER (WHERE event = 'workout planned') AS planned,
  count(*) FILTER (WHERE event = 'app opened') AS opens FROM w GROUP BY 1)
SELECT prog, completed, planned, opens, round(completed::DOUBLE / opens, 4) AS completed_per_open, round(planned::DOUBLE / opens, 4) AS planned_per_open FROM g ORDER BY prog;

-- ═════════════════════════════════════════════════════════════════════════
-- EVAL QUERIES (one per question in eval/fitness.eval.md)
-- ═════════════════════════════════════════════════════════════════════════

-- EVAL Q1 — Guided First Week onboarding conversion by variant (7-day window)
SELECT variant, count(*) AS enrolled_signups, count(*) FILTER (WHERE converted) AS finished,
 round(avg(converted::INT), 4) AS conversion,
 round(avg(converted::INT) / (SELECT avg(converted::INT) FROM onboarding WHERE variant = 'Control'), 4) AS lift_vs_control
FROM onboarding WHERE variant IS NOT NULL GROUP BY 1 ORDER BY 1;

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
SELECT round(count(*) FILTER (WHERE coaching_mode = 'ai_coach')::DOUBLE / count(*), 4) AS ai_share_overall
FROM ev WHERE event = 'workout completed' AND subscription_tier <> 'free' AND t >= TIMESTAMP '2026-08-12';

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
  CASE WHEN tracking_source = 'wearable' AND wearable_type IN ('smartwatch', 'fitness_band') THEN 'aff'
       WHEN tracking_source = 'phone' THEN 'phone' END AS arm
  FROM ev WHERE event = 'workout completed' AND t >= TIMESTAMP '2026-08-13' AND t < TIMESTAMP '2026-08-30'),
g AS (SELECT (d IN (SELECT d FROM od)) AS outage, count(DISTINCT d) AS days, count(*) FILTER (WHERE arm = 'aff') AS aff, count(*) FILTER (WHERE arm = 'phone') AS phone FROM w GROUP BY 1)
SELECT outage, days, round(aff::DOUBLE / days, 1) AS watch_band_per_day, round(phone::DOUBLE / days, 1) AS phone_per_day,
 round(aff::DOUBLE / phone, 4) AS watch_band_per_phone FROM g ORDER BY outage;

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

-- EVAL Q8 — Plus purchases by plan, August vs September, and the full-period mix shift
SELECT CASE WHEN t >= TIMESTAMP '2026-09-01' THEN 'after (Sep 1-Oct 1)' ELSE 'before (Aug 1-31)' END AS period,
 count(*) FILTER (WHERE plan = 'monthly') AS monthly, count(*) FILTER (WHERE plan = 'annual') AS annual,
 round(count(*) FILTER (WHERE plan = 'monthly')::DOUBLE / count(*), 4) AS monthly_share
FROM ev WHERE event = 'subscription purchased' AND t >= TIMESTAMP '2026-08-01' GROUP BY 1 ORDER BY 1;
WITH g AS (SELECT (t >= TIMESTAMP '2026-09-01') AS post, count(*) FILTER (WHERE plan = 'monthly')::DOUBLE / count(*) FILTER (WHERE plan = 'annual') AS m_per_a
  FROM ev WHERE event = 'subscription purchased' GROUP BY 1)
SELECT round(max(m_per_a) FILTER (WHERE NOT post), 4) AS monthly_per_annual_before, round(max(m_per_a) FILTER (WHERE post), 4) AS monthly_per_annual_after,
 round(max(m_per_a) FILTER (WHERE post) / max(m_per_a) FILTER (WHERE NOT post), 4) AS ratio FROM g;

-- EVAL Q9 — plan gross bookings (warehouse list price x Mixpanel purchases), August vs September
WITH p AS (SELECT t::DATE AS d, plan FROM ev WHERE event = 'subscription purchased' AND t >= TIMESTAMP '2026-08-01'),
j AS (SELECT p.*, b.list_price_usd FROM p JOIN wh_billing b ON b.date::DATE = p.d AND b.plan = p.plan)
SELECT CASE WHEN d >= DATE '2026-09-01' THEN 'Sep 1-Oct 1' ELSE 'Aug 1-31' END AS period, plan, count(*) AS purchases,
 round(sum(list_price_usd), 2) AS gross_bookings
FROM j GROUP BY ALL ORDER BY ALL;
WITH p AS (SELECT t::DATE AS d, plan FROM ev WHERE event = 'subscription purchased'),
j AS (SELECT p.*, b.list_price_usd FROM p JOIN wh_billing b ON b.date::DATE = p.d AND b.plan = p.plan),
g AS (SELECT (d >= DATE '2026-09-01') AS post, sum(list_price_usd) FILTER (WHERE plan = 'monthly') / sum(list_price_usd) FILTER (WHERE plan = 'annual') AS m_rev_per_a FROM j GROUP BY 1)
SELECT round(max(m_rev_per_a) FILTER (WHERE post) / max(m_rev_per_a) FILTER (WHERE NOT post), 4) AS monthly_vs_annual_bookings_ratio FROM g;

-- EVAL Q10 — spend per Mixpanel signup by paid channel, Summer Shred vs rest of window
WITH s AS (SELECT t0::DATE AS d, ch, count(*) AS n FROM signups GROUP BY ALL),
j AS (SELECT p.acquisition_channel AS ch, (p.date::DATE >= DATE '2026-06-15' AND p.date::DATE < DATE '2026-07-15') AS shred,
  sum(p.spend_usd) AS spend, sum(coalesce(s.n, 0)) AS signups
  FROM wh_paid p LEFT JOIN s ON s.d = p.date::DATE AND s.ch = p.acquisition_channel GROUP BY ALL)
SELECT ch, shred, round(spend, 2) AS spend_usd, signups, round(spend / signups, 2) AS spend_per_signup FROM j ORDER BY ch, shred;

-- EVAL Q11 — did Summer Shred add members? daily signups by channel inside (30 days) vs outside (90 days)
WITH s AS (SELECT (t0 >= TIMESTAMP '2026-06-15' AND t0 < TIMESTAMP '2026-07-15') AS shred, ch FROM signups),
g AS (SELECT shred, ch, count(*) AS signups FROM s GROUP BY ALL)
SELECT ch, max(signups) FILTER (WHERE shred) AS shred_signups, round(max(signups) FILTER (WHERE shred) / 30.0, 2) AS shred_per_day,
 round(max(signups) FILTER (WHERE NOT shred) / 90.0, 2) AS other_per_day,
 round((max(signups) FILTER (WHERE shred) / 30.0) / (max(signups) FILTER (WHERE NOT shred) / 90.0), 4) AS lift,
 round(max(signups) FILTER (WHERE shred)::DOUBLE / sum(max(signups) FILTER (WHERE shred)) OVER (), 4) AS shred_share,
 round(max(signups) FILTER (WHERE NOT shred)::DOUBLE / sum(max(signups) FILTER (WHERE NOT shred)) OVER (), 4) AS other_share
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

-- EVAL Q13 — day-28 retention by first-week workout count (members who signed up by 2026-08-27)
SELECT least(early_workouts, 6) AS first_week_workouts_capped, count(*) AS members, round(avg((d28_events > 0)::INT), 4) AS d28_retention
FROM habit GROUP BY 1 ORDER BY 1;
SELECT CASE WHEN early_workouts >= 3 THEN 'habit (3+)' ELSE 'low (0-2)' END AS grp, count(*) AS members, round(avg((d28_events > 0)::INT), 4) AS d28_retention
FROM habit GROUP BY 1 ORDER BY 1;

-- EVAL Q14 — per-challenge completion by format
SELECT challenge_format, count(*) AS challenges, count(*) FILTER (WHERE completed) AS completed,
 round(avg(completed::INT), 4) AS completion_rate
FROM challenges GROUP BY 1 ORDER BY 1;

-- member-level read (any completion per format): hides most of the gap
WITH j AS (SELECT uid, challenge_format AS f, min(t) AS tj FROM ev WHERE event = 'challenge joined' GROUP BY ALL),
c AS (SELECT uid, challenge_format AS f, max(t) AS tc FROM ev WHERE event = 'challenge completed' GROUP BY ALL)
SELECT j.f AS challenge_format, count(*) AS members, round(avg(coalesce(c.tc >= j.tj, false)::INT), 4) AS share_completing_any
FROM j LEFT JOIN c USING (uid, f) GROUP BY 1 ORDER BY 1;

-- EVAL Q15 — notification open rate by members' notification volume
SELECT CASE WHEN n < 10 THEN '01-09' WHEN n < 15 THEN '10-14' WHEN n < 20 THEN '15-19' WHEN n < 25 THEN '20-24' WHEN n < 35 THEN '25-34' ELSE '35+' END AS notifications_received,
 count(*) AS members, round(sum(opens)::DOUBLE / sum(n), 4) AS open_rate
FROM push GROUP BY 1 ORDER BY 1;

-- EVAL Q16 — workouts per app open, Fall Reset (Sep 8-21) vs the two weeks before
WITH w AS (SELECT (t >= TIMESTAMP '2026-09-08') AS prog, event FROM ev
  WHERE event IN ('workout completed', 'app opened') AND t >= TIMESTAMP '2026-08-25' AND t < TIMESTAMP '2026-09-22'),
g AS (SELECT prog, count(*) FILTER (WHERE event = 'workout completed') AS completed, count(*) FILTER (WHERE event = 'app opened') AS opens FROM w GROUP BY 1)
SELECT prog, completed, opens, round(completed::DOUBLE / opens, 4) AS completed_per_open,
 round((completed::DOUBLE / opens) / (SELECT completed::DOUBLE / opens FROM g WHERE NOT prog), 4) AS vs_before FROM g ORDER BY prog;

-- EVAL Q17 — onboarding conversion by platform (all new members, 7-day window)
SELECT platform, count(*) AS signups, round(avg(converted::INT), 4) AS onboarding_conversion FROM onboarding GROUP BY 1 ORDER BY 1;
SELECT variant, platform, count(*) AS signups, round(avg(converted::INT), 4) AS onboarding_conversion
FROM onboarding WHERE variant IS NOT NULL GROUP BY ALL ORDER BY ALL;

-- EVAL Q18 — meal logging per app open during the sync outage vs the surrounding week
WITH w AS (SELECT (t >= TIMESTAMP '2026-08-20' AND t < TIMESTAMP '2026-08-23') AS outage, event FROM ev
  WHERE event IN ('meal logged', 'app opened') AND t >= TIMESTAMP '2026-08-13' AND t < TIMESTAMP '2026-08-30'),
g AS (SELECT outage, count(*) FILTER (WHERE event = 'meal logged') AS meals, count(*) FILTER (WHERE event = 'app opened') AS opens FROM w GROUP BY 1)
SELECT outage, meals, opens, round(meals::DOUBLE / opens, 4) AS meals_per_open,
 round((meals::DOUBLE / opens) / (SELECT meals::DOUBLE / opens FROM g WHERE NOT outage), 4) AS vs_baseline FROM g ORDER BY outage;

-- EVAL Q19 — subscription bookings by month (warehouse)
SELECT strftime(date::DATE, '%Y-%m') AS month, sum(new_subscriptions) AS new_subscriptions,
 round(sum(gross_bookings_usd), 2) AS gross_bookings_usd, round(sum(store_fees_usd), 2) AS store_fees_usd, round(sum(net_bookings_usd), 2) AS net_bookings_usd
FROM wh_billing GROUP BY 1 ORDER BY 1;

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
SELECT 'heavy-notification open rate (20+)', (SELECT round(sum(opens)::DOUBLE / sum(n), 4) FROM push WHERE n >= 20)
UNION ALL
SELECT 'members with 20+ notifications (share)', (SELECT round(avg((n >= 20)::INT), 4) FROM push)
UNION ALL
SELECT 'D28 retention, low first week (0-2 workouts)', (SELECT round(avg((d28_events > 0)::INT), 4) FROM habit WHERE early_workouts < 3)
UNION ALL
SELECT 'D28 retention, habit first week (3+ workouts)', (SELECT round(avg((d28_events > 0)::INT), 4) FROM habit WHERE early_workouts >= 3)
UNION ALL
SELECT 'share of new members with 0-2 first-week workouts', (SELECT round(avg((early_workouts < 3)::INT), 4) FROM habit);
