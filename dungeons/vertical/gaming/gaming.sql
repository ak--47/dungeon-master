-- Emberfall (gaming vertical) — story-keyed and eval-keyed DuckDB queries.
--
-- Generate first (repo root):
--   node scripts/verify-runner.mjs dungeons/vertical/gaming/gaming.js verify-gaming
-- Run:
--   duckdb -c ".read dungeons/vertical/gaming/gaming.sql"
-- Against a gzipped export:
--   duckdb -c "SET VARIABLE data_prefix='<dir>/gaming'" -c ".read gaming.sql"
--
-- All times are UTC. Window: 2026-06-04 00:00 to 2026-10-01 23:59:59.

SET VARIABLE data_prefix = COALESCE(getvariable('data_prefix'), 'data/verify-gaming');

-- ─────────────────────────────────────────────────────────────────────────
-- PRELUDE: raw files, identity resolution, warehouse tables
-- ─────────────────────────────────────────────────────────────────────────
-- Identity: a new player is identified at "account created" (the auth event,
-- which carries user_id and device_id). A device resolves to the player seen
-- with it on any event that carries both ids, the way Mixpanel stitches.
-- Every Emberfall event carries user_id, so uid = user_id in practice.

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

CREATE OR REPLACE TEMP TABLE wh_ua AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-ua_spend_daily.json*', sample_size=-1, union_by_name=true);
CREATE OR REPLACE TEMP TABLE wh_health AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-server_health_daily.json*', sample_size=-1, union_by_name=true);
CREATE OR REPLACE TEMP TABLE wh_store AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-store_revenue_daily.json*', sample_size=-1, union_by_name=true);

-- profile attributes keyed by the resolved player id
CREATE OR REPLACE TEMP TABLE prof AS
SELECT distinct_id::VARCHAR AS uid, server_region, acquisition_channel, main_role, main_class, account_level,
 member_since, in_guild, total_spend_usd, "Experiment: First Flame Tutorial" AS variant
FROM users;

-- new players: one signup per player who joined in the window
CREATE OR REPLACE TEMP TABLE signups AS
SELECT uid, t AS t0, acquisition_channel AS ch, server_region FROM ev WHERE event = 'account created';

-- onboarding steps within 7 days of signup (a player-level flag; tutorial started can repeat on a later visit)
CREATE OR REPLACE TEMP TABLE onboarding AS
SELECT s.uid, s.t0, s.ch, s.server_region, p.variant,
 coalesce(bool_or(e.event = 'character created' AND e.t < s.t0 + INTERVAL 7 DAY), false) AS made_character,
 coalesce(bool_or(e.event = 'tutorial started' AND e.t < s.t0 + INTERVAL 7 DAY), false) AS started_tutorial,
 coalesce(bool_or(e.event = 'tutorial completed' AND e.t < s.t0 + INTERVAL 7 DAY), false) AS completed
FROM signups s JOIN prof p ON p.uid = s.uid
LEFT JOIN ev e ON e.uid = s.uid AND e.event IN ('character created', 'tutorial started', 'tutorial completed')
GROUP BY 1, 2, 3, 4, 5;

-- veterans: players with no signup in the window (joined before June 4)
CREATE OR REPLACE TEMP TABLE veterans AS
SELECT DISTINCT uid FROM ev WHERE uid NOT IN (SELECT uid FROM signups);

-- one row per dungeon run (queue, start, finish share run_id)
CREATE OR REPLACE TEMP TABLE runs AS
SELECT run_id, any_value(uid) AS uid,
 min(t) FILTER (WHERE event = 'dungeon queued') AS t_queue,
 min(t) FILTER (WHERE event = 'dungeon started') AS t_start,
 min(t) FILTER (WHERE event = 'dungeon finished') AS t_finish,
 any_value(server_region) AS server_region,
 any_value(platform) FILTER (WHERE event = 'dungeon started') AS platform,
 any_value(role) FILTER (WHERE event = 'dungeon queued') AS role,
 any_value(queue_type) FILTER (WHERE event = 'dungeon started') AS queue_type,
 any_value(party_size) FILTER (WHERE event = 'dungeon started') AS party_size,
 any_value(dungeon_name) AS dungeon_name,
 any_value(result) FILTER (WHERE event = 'dungeon finished') AS result,
 any_value(xp_earned) FILTER (WHERE event = 'dungeon finished') AS xp_earned
FROM ev WHERE event IN ('dungeon queued', 'dungeon started', 'dungeon finished') GROUP BY 1;

-- daily active players (a "game launched" in the day)
CREATE OR REPLACE TEMP TABLE dau AS
SELECT t::DATE AS d, count(DISTINCT uid) AS dau,
 count(DISTINCT uid) FILTER (WHERE uid IN (SELECT uid FROM veterans)) AS veteran_dau
FROM ev WHERE event = 'game launched' GROUP BY 1;

-- dataset overview
SELECT count(*) AS events, count(DISTINCT uid) AS players_with_events, (SELECT count(*) FROM users) AS profiles,
 (SELECT count(*) FROM signups) AS new_players, (SELECT count(*) FROM veterans) AS veterans_with_events,
 min(t) AS first_event, max(t) AS last_event FROM ev;

-- identity check: every event resolves to a player; platform agrees with the device OS
SELECT count(*) FILTER (WHERE uid IS NULL) AS unresolved_events,
 count(*) FILTER (WHERE device_id IS NULL) AS events_without_device,
 count(*) FILTER (WHERE (platform = 'ios' AND os NOT IN ('iOS', 'iPadOS')) OR (platform = 'android' AND os <> 'Android')
   OR (platform = 'pc' AND os IN ('iOS', 'iPadOS', 'Android'))) AS platform_os_mismatch
FROM ev;

-- session check: one device per Mixpanel session; sessions without "game launched" are a new
-- player's first session (starts at account created) or the part of a session after midnight UTC
WITH s AS (SELECT session_id, count(DISTINCT device_id) AS devices, bool_or(event = 'game launched') AS launched,
  bool_or(event = 'account created') AS signup, hour(min(t)) AS first_hour FROM ev GROUP BY 1)
SELECT count(*) AS sessions, count(*) FILTER (WHERE devices > 1) AS multi_device_sessions,
 count(*) FILTER (WHERE launched) AS with_launch, count(*) FILTER (WHERE signup) AS signup_sessions,
 count(*) FILTER (WHERE NOT launched AND NOT signup AND first_hour = 0) AS after_midnight_continuations,
 count(*) FILTER (WHERE NOT launched AND NOT signup AND first_hour <> 0) AS other_without_launch
FROM s;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H1-first-flame-tutorial-test
-- Guided / Control tutorial completion (account created → tutorial completed, 7 days); knob 1.25
-- ─────────────────────────────────────────────────────────────────────────
WITH g AS (SELECT variant, count(*) AS signups, avg(completed::INT) AS completion FROM onboarding WHERE variant IS NOT NULL GROUP BY 1)
SELECT *, completion / (SELECT completion FROM g WHERE variant = 'Control') AS ratio_vs_control FROM g ORDER BY variant;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H2-early-guild-retention
-- Tutorial finishers (signup ≤ Sep 3): game launched on day 14-27 by guild joined within 72 h; knob 0.55
-- ─────────────────────────────────────────────────────────────────────────
WITH f AS (SELECT uid, t0 FROM onboarding WHERE completed AND t0 <= TIMESTAMP '2026-09-03 23:59:59'),
g AS (SELECT f.uid,
  bool_or(e.event = 'guild joined' AND e.t >= f.t0 AND e.t < f.t0 + INTERVAL 72 HOUR) AS early_guild,
  bool_or(e.event = 'game launched' AND e.t >= f.t0 + INTERVAL 14 DAY AND e.t < f.t0 + INTERVAL 28 DAY) AS retained
  FROM f JOIN ev e ON e.uid = f.uid GROUP BY 1),
r AS (SELECT CASE WHEN early_guild THEN 'guild' ELSE 'no_guild' END AS grp, count(*) AS players, avg(retained::INT) AS retention FROM g GROUP BY 1)
SELECT *, retention / (SELECT retention FROM r WHERE grp = 'guild') AS ratio_vs_guild FROM r ORDER BY grp;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H3-ashen-warden-rebalance
-- Boss win rate per attempt before / from 2026-07-23; knob 0.30 → 0.50 (x1.667), other bosses x1.0
-- ─────────────────────────────────────────────────────────────────────────
SELECT boss_name, any_value(chapter) AS chapter,
 count(*) FILTER (WHERE t < TIMESTAMP '2026-07-23') AS attempts_before,
 round(avg((result = 'victory')::INT) FILTER (WHERE t < TIMESTAMP '2026-07-23'), 4) AS win_before,
 count(*) FILTER (WHERE t >= TIMESTAMP '2026-07-23') AS attempts_after,
 round(avg((result = 'victory')::INT) FILTER (WHERE t >= TIMESTAMP '2026-07-23'), 4) AS win_after,
 round(avg((result = 'victory')::INT) FILTER (WHERE t >= TIMESTAMP '2026-07-23') / avg((result = 'victory')::INT) FILTER (WHERE t < TIMESTAMP '2026-07-23'), 3) AS lift
FROM ev WHERE event = 'boss fight' GROUP BY 1 ORDER BY chapter;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H4-eu-instance-outage
-- EU / other "dungeon started", outage days (warehouse sev1) vs 14 days either side; knob 0.40
-- ─────────────────────────────────────────────────────────────────────────
WITH o AS (SELECT DISTINCT date::DATE AS d FROM wh_health WHERE incident_severity = 'sev1'),
w AS (SELECT t::DATE AS d, server_region = 'EU' AS eu FROM ev
  WHERE event = 'dungeon started' AND t >= TIMESTAMP '2026-08-29' AND t < TIMESTAMP '2026-09-29'),
g AS (SELECT (d IN (SELECT d FROM o)) AS outage, count(*) FILTER (WHERE eu) AS eu_starts, count(*) FILTER (WHERE NOT eu) AS other_starts,
  count(*) FILTER (WHERE eu)::DOUBLE / count(*) FILTER (WHERE NOT eu) AS eu_per_other FROM w GROUP BY 1)
SELECT *, eu_per_other / (SELECT eu_per_other FROM g WHERE NOT outage) AS relative_to_baseline FROM g ORDER BY outage;

SELECT date, server_region, instance_launch_success_rate, uptime_pct, avg_queue_seconds, incident_severity
FROM wh_health WHERE incident_severity = 'sev1' ORDER BY date;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H5-paid-channel-economics
-- Spend per signup and per tutorial finisher by channel (warehouse ua_spend_daily);
-- knobs: CPI 2.5 / 4.5 / 5.5 / 7, TikTok tutorial completion x0.6
-- ─────────────────────────────────────────────────────────────────────────
WITH sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend, sum(installs_reported) AS installs_reported FROM wh_ua GROUP BY 1),
g AS (SELECT ch, count(*) AS signups, count(*) FILTER (WHERE completed) AS finishers, avg(completed::INT) AS completion FROM onboarding GROUP BY 1)
SELECT g.ch, g.signups, g.finishers, round(g.completion, 4) AS completion, round(sp.spend, 2) AS spend, sp.installs_reported,
 round(sp.spend / g.signups, 2) AS spend_per_signup, round(sp.spend / g.finishers, 2) AS spend_per_finisher
FROM g LEFT JOIN sp ON sp.ch = g.ch ORDER BY spend_per_signup NULLS LAST;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H6-queue-time-by-role
-- Median seconds dungeon queued → dungeon started (same run_id) by main_role; knobs healer x0.4, tank x0.2
-- ─────────────────────────────────────────────────────────────────────────
WITH w AS (SELECT p.main_role, date_diff('millisecond', r.t_queue, r.t_start) / 1000.0 AS wait_s
  FROM runs r JOIN prof p ON p.uid = r.uid WHERE r.t_queue IS NOT NULL AND r.t_start IS NOT NULL),
g AS (SELECT main_role, count(*) AS queued_runs, median(wait_s) AS median_wait_s, quantile_cont(wait_s, 0.9) AS p90_wait_s FROM w GROUP BY 1)
SELECT *, median_wait_s / (SELECT median_wait_s FROM g WHERE main_role = 'dps') AS ratio_vs_dps FROM g ORDER BY median_wait_s DESC;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H7-pc-pack-mix-and-store-fees
-- Average Ember pack price and warehouse net revenue per Mixpanel Ember purchase, PC vs mobile;
-- knobs: pack mix x1.855, x2.073 after fees (app stores 15%, PC webshop 5%)
-- ─────────────────────────────────────────────────────────────────────────
WITH p AS (SELECT CASE WHEN platform = 'pc' THEN 'pc' ELSE 'mobile' END AS store, count(DISTINCT uid) AS buyers, count(*) AS purchases, avg(price_usd) AS avg_price
  FROM ev WHERE event = 'purchase completed' AND product_type = 'embers' GROUP BY 1),
w AS (SELECT CASE WHEN platform = 'pc' THEN 'pc' ELSE 'mobile' END AS store, sum(net_revenue_usd) AS net FROM wh_store WHERE product_type = 'embers' GROUP BY 1)
SELECT p.store, p.buyers, p.purchases, round(p.avg_price, 2) AS avg_price, round(w.net, 2) AS warehouse_net, round(w.net / p.purchases, 2) AS net_per_purchase
FROM p JOIN w USING (store) ORDER BY store;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H8-season4-brings-veterans-back
-- Veteran DAU Aug 13 - Sep 9 over Jul 9 - Aug 5; knob 1.267. The new dungeon has no runs before Aug 6.
-- ─────────────────────────────────────────────────────────────────────────
SELECT round(avg(veteran_dau) FILTER (WHERE d >= DATE '2026-07-09' AND d < DATE '2026-08-06'), 1) AS veteran_dau_before,
 round(avg(veteran_dau) FILTER (WHERE d >= DATE '2026-08-13' AND d < DATE '2026-09-10'), 1) AS veteran_dau_after,
 round(avg(veteran_dau) FILTER (WHERE d >= DATE '2026-08-13' AND d < DATE '2026-09-10') / avg(veteran_dau) FILTER (WHERE d >= DATE '2026-07-09' AND d < DATE '2026-08-06'), 3) AS lift
FROM dau;

SELECT count(*) FILTER (WHERE t_start < TIMESTAMP '2026-08-06') AS frostspire_runs_before_launch,
 count(*) FILTER (WHERE t_start >= TIMESTAMP '2026-08-06') AS frostspire_runs_after,
 round(count(*) FILTER (WHERE t_start >= TIMESTAMP '2026-08-06')::DOUBLE / (SELECT count(*) FROM runs WHERE t_start >= TIMESTAMP '2026-08-06'), 4) AS share_of_runs_after
FROM runs WHERE dungeon_name = 'Frostspire Vault';

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H9-double-xp-weekend
-- Dungeon starts per active player-day, Aug 21-23 vs Aug 14-16 + Aug 28-30; knob 1.6
-- ─────────────────────────────────────────────────────────────────────────
WITH w AS (SELECT CASE WHEN t >= TIMESTAMP '2026-08-21' AND t < TIMESTAMP '2026-08-24' THEN 'double_xp'
  WHEN (t >= TIMESTAMP '2026-08-14' AND t < TIMESTAMP '2026-08-17') OR (t >= TIMESTAMP '2026-08-28' AND t < TIMESTAMP '2026-08-31') THEN 'normal' END AS grp,
  uid, t::DATE AS d, event FROM ev WHERE event IN ('dungeon started', 'game launched')),
g AS (SELECT grp, count(DISTINCT d) AS days, count(*) FILTER (WHERE event = 'dungeon started') AS runs,
  count(DISTINCT uid || '|' || d::VARCHAR) FILTER (WHERE event = 'game launched') AS player_days
  FROM w WHERE grp IS NOT NULL GROUP BY 1)
SELECT grp, days, runs, player_days, round(runs::DOUBLE / player_days, 3) AS runs_per_active_player,
 round(player_days::DOUBLE / days, 1) AS avg_dau,
 round((runs::DOUBLE / player_days) / (SELECT runs::DOUBLE / player_days FROM g WHERE grp = 'normal'), 3) AS lift
FROM g ORDER BY grp;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H10-party-size-clear-rate
-- Cleared share of dungeon finished by party_size; knobs 0.40 / 0.50 / 0.58 / 0.64 / 0.70
-- ─────────────────────────────────────────────────────────────────────────
SELECT party_size, count(*) AS runs, round(avg((result = 'cleared')::INT), 4) AS clear_rate,
 round(avg((result = 'cleared')::INT) / (SELECT avg((result = 'cleared')::INT) FROM ev WHERE event = 'dungeon finished' AND party_size = 5), 3) AS ratio_vs_full
FROM ev WHERE event = 'dungeon finished' GROUP BY 1 ORDER BY 1;

-- ═════════════════════════════════════════════════════════════════════════
-- EVAL QUERIES (eval/gaming.eval.md)
-- ═════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q1 — guided tutorial test: completion, z, D7 return, by arm and channel group
-- ─────────────────────────────────────────────────────────────────────────
WITH d7 AS (SELECT o.uid, bool_or(e.event = 'game launched' AND e.t >= o.t0 + INTERVAL 7 DAY AND e.t < o.t0 + INTERVAL 14 DAY) AS d7
  FROM onboarding o LEFT JOIN ev e ON e.uid = o.uid AND e.event = 'game launched' GROUP BY 1),
o AS (SELECT o.*, coalesce(d7.d7, false) AS d7 FROM onboarding o JOIN d7 USING (uid) WHERE variant IS NOT NULL),
a AS (SELECT variant, count(*) AS n, avg(completed::INT) AS p,
  avg(d7::INT) FILTER (WHERE t0 <= TIMESTAMP '2026-09-17 23:59:59') AS d7_return,
  avg(completed::INT) FILTER (WHERE ch = 'tiktok_ads') AS tiktok_completion,
  avg(completed::INT) FILTER (WHERE ch <> 'tiktok_ads') AS other_completion FROM o GROUP BY 1)
SELECT a.*, (SELECT (g.p - c.p) / sqrt(((g.p * g.n + c.p * c.n) / (g.n + c.n)) * (1 - (g.p * g.n + c.p * c.n) / (g.n + c.n)) * (1.0 / g.n + 1.0 / c.n))
  FROM a g, a c WHERE g.variant = 'Guided' AND c.variant = 'Control') AS z_completion
FROM a ORDER BY variant;

-- tutorial length by arm: tutorial_minutes on "tutorial completed" and the real gap from the last
-- "tutorial started" before it (test players who finished within 7 days)
WITH c AS (SELECT o.uid, o.variant, e.t AS tc, e.tutorial_minutes AS m FROM onboarding o
  JOIN ev e ON e.uid = o.uid AND e.event = 'tutorial completed' AND e.t < o.t0 + INTERVAL 7 DAY WHERE o.variant IS NOT NULL),
g AS (SELECT c.uid, c.variant, c.m, date_diff('millisecond', max(s.t), c.tc) / 60000.0 AS gap_min FROM c
  JOIN ev s ON s.uid = c.uid AND s.event = 'tutorial started' AND s.t <= c.tc GROUP BY 1, 2, 3, c.tc)
SELECT variant, count(*) AS finishers, round(avg(m), 2) AS avg_tutorial_minutes, round(median(m), 2) AS median_tutorial_minutes,
 round(median(gap_min), 2) AS median_real_gap_min, round(corr(m, gap_min), 4) AS corr_minutes_vs_gap
FROM g GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q2 — early guild and retention (tutorial finishers, signup ≤ Sep 3), plus share who join early
-- ─────────────────────────────────────────────────────────────────────────
WITH f AS (SELECT uid, t0 FROM onboarding WHERE completed AND t0 <= TIMESTAMP '2026-09-03 23:59:59'),
g AS (SELECT f.uid,
  bool_or(e.event = 'guild joined' AND e.t >= f.t0 AND e.t < f.t0 + INTERVAL 72 HOUR) AS early_guild,
  bool_or(e.event = 'game launched' AND e.t >= f.t0 + INTERVAL 7 DAY AND e.t < f.t0 + INTERVAL 14 DAY) AS ret_7_13,
  bool_or(e.event = 'game launched' AND e.t >= f.t0 + INTERVAL 14 DAY AND e.t < f.t0 + INTERVAL 28 DAY) AS ret_14_27
  FROM f JOIN ev e ON e.uid = f.uid GROUP BY 1)
SELECT early_guild, count(*) AS players, round(count(*) / sum(count(*)) OVER (), 4) AS share,
 round(avg(ret_7_13::INT), 4) AS ret_day_7_13, round(avg(ret_14_27::INT), 4) AS ret_day_14_27
FROM g GROUP BY 1 ORDER BY 1;

-- other "early" windows: guild joined within 24 hours / 7 days of signup
WITH f AS (SELECT uid, t0 FROM onboarding WHERE completed AND t0 <= TIMESTAMP '2026-09-03 23:59:59'),
g AS (SELECT f.uid,
  bool_or(e.event = 'guild joined' AND e.t >= f.t0 AND e.t < f.t0 + INTERVAL 24 HOUR) AS guild_24h,
  bool_or(e.event = 'guild joined' AND e.t >= f.t0 AND e.t < f.t0 + INTERVAL 7 DAY) AS guild_7d,
  bool_or(e.event = 'game launched' AND e.t >= f.t0 + INTERVAL 14 DAY AND e.t < f.t0 + INTERVAL 28 DAY) AS ret_14_27
  FROM f JOIN ev e ON e.uid = f.uid GROUP BY 1)
SELECT '24h' AS window, guild_24h AS early_guild, count(*) AS players, round(avg(ret_14_27::INT), 4) AS ret_day_14_27 FROM g GROUP BY 2
UNION ALL
SELECT '7d', guild_7d, count(*), round(avg(ret_14_27::INT), 4) FROM g GROUP BY 2 ORDER BY 1, 2;

-- the plain recipe without the finisher filter: ALL new players (signup ≤ Sep 3), guild joined within 72 h
WITH s AS (SELECT uid, t0, completed FROM onboarding WHERE t0 <= TIMESTAMP '2026-09-03 23:59:59'),
g AS (SELECT s.uid, any_value(s.completed) AS completed,
  coalesce(bool_or(e.event = 'guild joined' AND e.t >= s.t0 AND e.t < s.t0 + INTERVAL 72 HOUR), false) AS early_guild,
  coalesce(bool_or(e.event = 'game launched' AND e.t >= s.t0 + INTERVAL 14 DAY AND e.t < s.t0 + INTERVAL 28 DAY), false) AS ret_14_27
  FROM s LEFT JOIN ev e ON e.uid = s.uid GROUP BY 1),
r AS (SELECT early_guild, count(*) AS players, round(avg(completed::INT), 4) AS finished_tutorial, avg(ret_14_27::INT) AS ret FROM g GROUP BY 1)
SELECT early_guild, players, finished_tutorial, round(ret, 4) AS ret_day_14_27,
 round(ret / (SELECT ret FROM r WHERE early_guild), 3) AS ratio_vs_guild FROM r ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q3 — Ashen Warden weekly win rate (see STORY H3 for before/after by boss)
-- ─────────────────────────────────────────────────────────────────────────
SELECT date_trunc('week', t)::DATE AS week, count(*) AS warden_attempts, round(avg((result = 'victory')::INT), 3) AS warden_win_rate
FROM ev WHERE event = 'boss fight' AND boss_name = 'Ashen Warden' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q4 — mid-September dungeon dip: daily starts by region, EU launches missing
-- ─────────────────────────────────────────────────────────────────────────
SELECT t::DATE AS d, count(*) FILTER (WHERE server_region = 'EU') AS eu, count(*) FILTER (WHERE server_region = 'NA') AS na,
 count(*) FILTER (WHERE server_region = 'APAC') AS apac
FROM ev WHERE event = 'dungeon started' AND t >= TIMESTAMP '2026-09-08' AND t < TIMESTAMP '2026-09-19' GROUP BY 1 ORDER BY 1;

WITH base AS (SELECT count(*) FILTER (WHERE server_region = 'EU')::DOUBLE / count(*) FILTER (WHERE server_region <> 'EU') AS rel FROM ev
  WHERE event = 'dungeon started' AND ((t >= TIMESTAMP '2026-08-29' AND t < TIMESTAMP '2026-09-12') OR (t >= TIMESTAMP '2026-09-15' AND t < TIMESTAMP '2026-09-29'))),
o AS (SELECT count(*) FILTER (WHERE server_region = 'EU') AS eu, count(*) FILTER (WHERE server_region <> 'EU') AS other FROM ev
  WHERE event = 'dungeon started' AND t >= TIMESTAMP '2026-09-12' AND t < TIMESTAMP '2026-09-15'),
q AS (SELECT count(*) AS eu_queues, count(*) FILTER (WHERE t_start IS NOT NULL) AS eu_queues_started FROM runs
  WHERE server_region = 'EU' AND t_queue >= TIMESTAMP '2026-09-12' AND t_queue < TIMESTAMP '2026-09-15')
SELECT o.eu AS eu_starts_outage, round(base.rel * o.other) AS eu_starts_expected, round(base.rel * o.other - o.eu) AS eu_starts_missing,
 round(o.eu / (base.rel * o.other), 3) AS eu_relative, q.eu_queues, round(q.eu_queues_started::DOUBLE / q.eu_queues, 3) AS eu_queue_start_rate
FROM o, base, q;

-- matchmade queue wait (dungeon queued → dungeon started, same run_id) by region, outage days vs Aug 29 - Sep 28 otherwise
SELECT server_region, (t_queue >= TIMESTAMP '2026-09-12' AND t_queue < TIMESTAMP '2026-09-15') AS outage, count(*) AS started_runs,
 median(date_diff('second', t_queue, t_start)) AS median_wait_s, round(avg(date_diff('second', t_queue, t_start)), 1) AS avg_wait_s
FROM runs WHERE t_queue IS NOT NULL AND t_start IS NOT NULL AND t_queue >= TIMESTAMP '2026-08-29' AND t_queue < TIMESTAMP '2026-09-29'
GROUP BY 1, 2 ORDER BY 1, 2;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q5 — paid channel CAC (see STORY H5); per-channel payer counts for context
-- ─────────────────────────────────────────────────────────────────────────
WITH sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM wh_ua GROUP BY 1),
pay AS (SELECT DISTINCT uid FROM ev WHERE event = 'purchase completed')
SELECT o.ch, count(*) AS signups, count(*) FILTER (WHERE o.uid IN (SELECT uid FROM pay)) AS payers,
 round(any_value(sp.spend) / nullif(count(*) FILTER (WHERE o.uid IN (SELECT uid FROM pay)), 0), 2) AS spend_per_payer
FROM onboarding o LEFT JOIN sp ON sp.ch = o.ch GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q6 — onboarding funnel by channel group (7-day window)
-- ─────────────────────────────────────────────────────────────────────────
SELECT CASE WHEN ch = 'tiktok_ads' THEN 'tiktok_ads' ELSE 'other_channels' END AS grp, count(*) AS signups,
 round(avg(made_character::INT), 4) AS character_created, round(avg(started_tutorial::INT), 4) AS tutorial_started,
 round(avg(completed::INT), 4) AS tutorial_completed
FROM onboarding GROUP BY ROLLUP (1) ORDER BY 1 NULLS LAST;

SELECT ch, count(*) AS signups, round(avg(completed::INT), 4) AS tutorial_completed FROM onboarding GROUP BY 1 ORDER BY 3;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q7 — queue waits by role (see STORY H6); queue type mix and role mix
-- ─────────────────────────────────────────────────────────────────────────
SELECT queue_type, count(*) AS runs, round(count(*) / sum(count(*)) OVER (), 4) AS share FROM runs WHERE t_start IS NOT NULL GROUP BY 1 ORDER BY 2 DESC;
SELECT main_role, count(*) AS players, round(count(*) / sum(count(*)) OVER (), 4) AS share FROM prof GROUP BY 1 ORDER BY 2 DESC;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q8 — Ember pack mix and average price by platform
-- ─────────────────────────────────────────────────────────────────────────
SELECT platform, count(*) AS ember_purchases, round(avg(price_usd), 2) AS avg_price,
 round(avg((price_usd <= 4.99)::INT), 3) AS share_small_packs, round(avg((price_usd >= 19.99)::INT), 3) AS share_big_packs
FROM ev WHERE event = 'purchase completed' AND product_type = 'embers' GROUP BY 1 ORDER BY avg_price DESC;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q9 — revenue after store fees by platform (warehouse store_revenue_daily vs Mixpanel)
-- ─────────────────────────────────────────────────────────────────────────
WITH m AS (SELECT platform, count(*) AS mp_purchases, sum(price_usd) AS mp_revenue FROM ev WHERE event = 'purchase completed' GROUP BY 1),
w AS (SELECT platform, sum(transactions) AS transactions, sum(gross_bookings_usd) AS gross, sum(refunds_usd) AS refunds, sum(store_fees_usd) AS fees, sum(net_revenue_usd) AS net FROM wh_store GROUP BY 1)
SELECT m.platform, m.mp_purchases, round(m.mp_revenue, 2) AS mp_revenue, w.transactions, round(w.gross, 2) AS gross, round(w.refunds, 2) AS refunds,
 round(w.fees, 2) AS fees, round(w.net, 2) AS net, round(w.net / sum(w.net) OVER (), 4) AS share_of_net, round(w.gross / sum(w.gross) OVER (), 4) AS share_of_gross,
 round(w.net / m.mp_purchases, 2) AS net_per_mp_purchase
FROM m JOIN w USING (platform) ORDER BY net DESC;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q10 — Season 4: veteran and total DAU, weekly (see STORY H8 for the 4-week read)
-- ─────────────────────────────────────────────────────────────────────────
WITH w AS (SELECT date_trunc('week', d)::DATE AS week, round(avg(dau), 1) AS avg_dau, round(avg(veteran_dau), 1) AS avg_veteran_dau
  FROM dau WHERE d >= DATE '2026-06-08' AND d < DATE '2026-09-28' GROUP BY 1),
n AS (SELECT date_trunc('week', t0)::DATE AS week, count(*) AS new_accounts FROM signups GROUP BY 1)
SELECT w.*, n.new_accounts FROM w LEFT JOIN n USING (week) ORDER BY week;

SELECT round(avg(dau) FILTER (WHERE d >= DATE '2026-07-09' AND d < DATE '2026-08-06'), 1) AS dau_before,
 round(avg(dau) FILTER (WHERE d >= DATE '2026-08-13' AND d < DATE '2026-09-10'), 1) AS dau_after
FROM dau;

-- veterans nearly inactive in the 4 weeks before launch (≤ 2 play days) and active in the 4 weeks after (≥ 5 play days)
WITH a AS (SELECT uid, count(DISTINCT t::DATE) FILTER (WHERE t >= TIMESTAMP '2026-07-09' AND t < TIMESTAMP '2026-08-06') AS days_before,
  count(DISTINCT t::DATE) FILTER (WHERE t >= TIMESTAMP '2026-08-13' AND t < TIMESTAMP '2026-09-10') AS days_after
  FROM ev WHERE event = 'game launched' AND uid IN (SELECT uid FROM veterans) GROUP BY 1)
SELECT count(*) FILTER (WHERE days_before <= 2 AND days_after >= 5) AS returned_veterans,
 count(*) FILTER (WHERE days_before >= 5 AND days_after <= 2) AS faded_veterans FROM a;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q11 — Double XP weekend (see STORY H9): daily runs, DAU, XP
-- ─────────────────────────────────────────────────────────────────────────
SELECT d.d, dayname(d.d) AS dow, d.dau, count(r.run_id) AS runs, round(count(r.run_id)::DOUBLE / d.dau, 3) AS runs_per_dau, sum(r.xp_earned) AS xp_earned
FROM dau d LEFT JOIN runs r ON r.t_start::DATE = d.d
WHERE d.d IN (DATE '2026-08-14', DATE '2026-08-15', DATE '2026-08-16', DATE '2026-08-21', DATE '2026-08-22', DATE '2026-08-23', DATE '2026-08-28', DATE '2026-08-29', DATE '2026-08-30')
GROUP BY 1, 2, 3 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q12 — clear rate by queue type and party size (see STORY H10)
-- ─────────────────────────────────────────────────────────────────────────
SELECT queue_type, party_size, count(*) AS runs, round(avg((result = 'cleared')::INT), 4) AS clear_rate,
 round(avg((result = 'wiped')::INT), 4) AS wipe_rate, round(avg((result = 'abandoned')::INT), 4) AS abandon_rate
FROM runs WHERE t_finish IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 2;

-- clear rate by difficulty, overall and per party size
SELECT coalesce(party_size::VARCHAR, 'all') AS party, difficulty, count(*) AS runs, round(avg((result = 'cleared')::INT), 4) AS clear_rate
FROM ev WHERE event = 'dungeon finished' GROUP BY GROUPING SETS ((difficulty), (party_size, difficulty)) ORDER BY 1, 2;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q13 — null: dungeon clear rate, mobile vs PC (overall and within party size); z of the difference
-- ─────────────────────────────────────────────────────────────────────────
WITH x AS (SELECT CASE WHEN platform = 'pc' THEN 'pc' ELSE 'mobile' END AS store, party_size, (result = 'cleared')::INT AS c FROM ev WHERE event = 'dungeon finished'),
g AS (SELECT coalesce(party_size::VARCHAR, 'all') AS party, store, count(*) AS n, avg(c) AS p FROM x GROUP BY GROUPING SETS ((store), (party_size, store)))
SELECT a.party, a.n AS mobile_runs, round(a.p, 4) AS mobile_clear, b.n AS pc_runs, round(b.p, 4) AS pc_clear,
 round((a.p - b.p) / sqrt(((a.p * a.n + b.p * b.n) / (a.n + b.n)) * (1 - (a.p * a.n + b.p * b.n) / (a.n + b.n)) * (1.0 / a.n + 1.0 / b.n)), 2) AS z
FROM g a JOIN g b ON a.party = b.party AND a.store = 'mobile' AND b.store = 'pc' ORDER BY a.party;

SELECT platform, count(*) AS runs, round(avg((result = 'cleared')::INT), 4) AS clear_rate FROM ev WHERE event = 'dungeon finished' GROUP BY 1 ORDER BY 1;

-- the same null within server region and within difficulty
WITH x AS (SELECT CASE WHEN platform = 'pc' THEN 'pc' ELSE 'mobile' END AS store, 'region=' || server_region AS k, (result = 'cleared')::INT AS c FROM ev WHERE event = 'dungeon finished'
  UNION ALL SELECT CASE WHEN platform = 'pc' THEN 'pc' ELSE 'mobile' END, 'difficulty=' || difficulty, (result = 'cleared')::INT FROM ev WHERE event = 'dungeon finished'),
g AS (SELECT k, store, count(*) AS n, avg(c) AS p FROM x GROUP BY 1, 2)
SELECT a.k AS split, a.n AS mobile_runs, round(a.p, 4) AS mobile_clear, b.n AS pc_runs, round(b.p, 4) AS pc_clear,
 round((a.p - b.p) / sqrt(((a.p * a.n + b.p * b.n) / (a.n + b.n)) * (1 - (a.p * a.n + b.p * b.n) / (a.n + b.n)) * (1.0 / a.n + 1.0 / b.n)), 2) AS z
FROM g a JOIN g b ON a.k = b.k AND a.store = 'mobile' AND b.store = 'pc' ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q14 — null: dungeon clear rate before vs from patch 4.0.2 (overall and within party size); z
-- ─────────────────────────────────────────────────────────────────────────
WITH x AS (SELECT CASE WHEN t >= TIMESTAMP '2026-07-23' THEN 'after' ELSE 'before' END AS per, party_size, (result = 'cleared')::INT AS c FROM ev WHERE event = 'dungeon finished'),
g AS (SELECT coalesce(party_size::VARCHAR, 'all') AS party, per, count(*) AS n, avg(c) AS p FROM x GROUP BY GROUPING SETS ((per), (party_size, per)))
SELECT a.party, a.n AS runs_before, round(a.p, 4) AS clear_before, b.n AS runs_after, round(b.p, 4) AS clear_after,
 round((b.p - a.p) / sqrt(((a.p * a.n + b.p * b.n) / (a.n + b.n)) * (1 - (a.p * a.n + b.p * b.n) / (a.n + b.n)) * (1.0 / a.n + 1.0 / b.n)), 2) AS z
FROM g a JOIN g b ON a.party = b.party AND a.per = 'before' AND b.per = 'after' ORDER BY a.party;

-- the same null within server region, difficulty, and platform
WITH x AS (SELECT CASE WHEN t >= TIMESTAMP '2026-07-23' THEN 'after' ELSE 'before' END AS per, 'region=' || server_region AS k, (result = 'cleared')::INT AS c FROM ev WHERE event = 'dungeon finished'
  UNION ALL SELECT CASE WHEN t >= TIMESTAMP '2026-07-23' THEN 'after' ELSE 'before' END, 'difficulty=' || difficulty, (result = 'cleared')::INT FROM ev WHERE event = 'dungeon finished'
  UNION ALL SELECT CASE WHEN t >= TIMESTAMP '2026-07-23' THEN 'after' ELSE 'before' END, 'platform=' || platform, (result = 'cleared')::INT FROM ev WHERE event = 'dungeon finished'),
g AS (SELECT k, per, count(*) AS n, avg(c) AS p FROM x GROUP BY 1, 2)
SELECT a.k AS split, a.n AS runs_before, round(a.p, 4) AS clear_before, b.n AS runs_after, round(b.p, 4) AS clear_after,
 round((b.p - a.p) / sqrt(((a.p * a.n + b.p * b.n) / (a.n + b.n)) * (1 - (a.p * a.n + b.p * b.n) / (a.n + b.n)) * (1.0 / a.n + 1.0 / b.n)), 2) AS z
FROM g a JOIN g b ON a.k = b.k AND a.per = 'before' AND b.per = 'after' ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q15 — Season 4 Ember Pass sales: buyers, timing, share of payers active after launch
-- ─────────────────────────────────────────────────────────────────────────
WITH pass AS (SELECT uid, t, price_usd FROM ev WHERE event = 'purchase completed' AND product = 'Season 4 Ember Pass'),
payers_after AS (SELECT DISTINCT uid FROM ev WHERE t >= TIMESTAMP '2026-08-06' AND uid IN (SELECT DISTINCT uid FROM ev WHERE event = 'purchase completed'))
SELECT count(*) AS passes, count(DISTINCT uid) AS buyers, round(sum(price_usd), 2) AS revenue,
 count(*) FILTER (WHERE t < TIMESTAMP '2026-08-13') AS first_week, round(count(*) FILTER (WHERE t < TIMESTAMP '2026-08-13')::DOUBLE / count(*), 3) AS first_week_share,
 count(*) FILTER (WHERE t < TIMESTAMP '2026-08-20') AS first_two_weeks,
 (SELECT count(*) FROM payers_after) AS payers_active_after_launch,
 round(count(DISTINCT uid)::DOUBLE / (SELECT count(*) FROM payers_after), 3) AS share_of_active_payers,
 (SELECT count(*) FROM ev WHERE event = 'purchase completed' AND product = 'Season 3 Ember Pass') AS season3_passes_in_window
FROM pass;

SELECT date_trunc('week', t)::DATE AS week, count(*) FILTER (WHERE product = 'Season 4 Ember Pass') AS season4_passes,
 count(*) FILTER (WHERE product = 'Season 3 Ember Pass') AS season3_passes
FROM ev WHERE event = 'purchase completed' AND product_type = 'ember_pass' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q16 — weekly Mixpanel revenue by product type; revenue per day before / from Season 4
-- ─────────────────────────────────────────────────────────────────────────
SELECT date_trunc('week', t)::DATE AS week, count(*) AS purchases, round(sum(price_usd), 2) AS revenue,
 round(sum(price_usd) FILTER (WHERE product_type = 'embers'), 2) AS embers, round(sum(price_usd) FILTER (WHERE product_type = 'ember_pass'), 2) AS ember_pass,
 round(sum(price_usd) FILTER (WHERE product_type = 'bundle'), 2) AS bundles
FROM ev WHERE event = 'purchase completed' AND t >= TIMESTAMP '2026-06-08' AND t < TIMESTAMP '2026-09-28' GROUP BY 1 ORDER BY 1;

SELECT CASE WHEN t < TIMESTAMP '2026-08-06' THEN 'jun4_aug5' ELSE 'aug6_oct1' END AS per, count(DISTINCT t::DATE) AS days,
 round(sum(price_usd) / count(DISTINCT t::DATE), 2) AS revenue_per_day,
 round(sum(price_usd) FILTER (WHERE product_type <> 'ember_pass') / count(DISTINCT t::DATE), 2) AS non_pass_revenue_per_day
FROM ev WHERE event = 'purchase completed' GROUP BY 1 ORDER BY 1 DESC;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q17 — server health by region (warehouse server_health_daily)
-- ─────────────────────────────────────────────────────────────────────────
SELECT server_region, round(avg(peak_concurrent_players), 1) AS avg_peak_ccu, max(peak_concurrent_players) AS max_peak_ccu,
 round(avg(uptime_pct), 3) AS avg_uptime_pct, round(min(uptime_pct), 2) AS min_uptime_pct,
 round(avg(avg_queue_seconds) FILTER (WHERE incident_severity = 'none'), 1) AS normal_avg_queue_s,
 count(*) FILTER (WHERE incident_severity <> 'none') AS incident_days
FROM wh_health GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q18 — payers and ARPPU (Mixpanel purchases), new players vs veterans
-- ─────────────────────────────────────────────────────────────────────────
WITH act AS (SELECT DISTINCT uid FROM ev WHERE event = 'game launched'),
pay AS (SELECT uid, count(*) AS purchases, sum(price_usd) AS spend FROM ev WHERE event = 'purchase completed' GROUP BY 1)
SELECT CASE WHEN a.uid IN (SELECT uid FROM veterans) THEN 'veterans' ELSE 'new_players' END AS grp,
 count(*) AS active_players, count(p.uid) AS payers, round(count(p.uid)::DOUBLE / count(*), 4) AS payer_share,
 round(sum(p.spend), 2) AS revenue, round(sum(p.spend) / count(p.uid), 2) AS arppu, round(avg(p.purchases), 2) AS purchases_per_payer
FROM act a LEFT JOIN pay p ON p.uid = a.uid GROUP BY ROLLUP (1) ORDER BY 1 NULLS LAST;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q19 — open-ended "what should we worry about": headline numbers
-- (also uses STORY H2, H4, H5, H7, H8 outputs)
-- ─────────────────────────────────────────────────────────────────────────
SELECT
 (SELECT round(avg(completed::INT), 4) FROM onboarding) AS tutorial_completion_all,
 (SELECT round(avg(completed::INT), 4) FROM onboarding WHERE ch = 'tiktok_ads') AS tutorial_completion_tiktok,
 (SELECT round(count(*) FILTER (WHERE ch = 'tiktok_ads')::DOUBLE / count(*), 4) FROM onboarding) AS tiktok_share_of_signups,
 (SELECT round(sum(net_revenue_usd) FILTER (WHERE platform <> 'pc') / sum(net_revenue_usd), 4) FROM wh_store) AS mobile_share_of_net,
 (SELECT round(sum(store_fees_usd) / sum(gross_bookings_usd), 4) FROM wh_store) AS fee_share_of_gross;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q20 — new-player retention: day 1 / 7 / 30 (elapsed 24-hour buckets after signup, game launched), signups by Aug 31
-- ─────────────────────────────────────────────────────────────────────────
WITH s AS (SELECT o.uid, o.t0, o.completed FROM onboarding o WHERE o.t0 <= TIMESTAMP '2026-08-31 23:59:59'),
a AS (SELECT DISTINCT s.uid, floor(date_diff('second', s.t0, e.t) / 86400)::INT AS dd FROM s JOIN ev e ON e.uid = s.uid WHERE e.event = 'game launched' AND e.t > s.t0)
SELECT CASE WHEN s.completed THEN 'finished_tutorial' ELSE 'did_not_finish' END AS grp, count(*) AS players,
 round(avg((s.uid IN (SELECT uid FROM a WHERE dd = 1))::INT), 4) AS d1,
 round(avg((s.uid IN (SELECT uid FROM a WHERE dd = 7))::INT), 4) AS d7,
 round(avg((s.uid IN (SELECT uid FROM a WHERE dd = 30))::INT), 4) AS d30
FROM s GROUP BY ROLLUP (1) ORDER BY 1 NULLS LAST;
