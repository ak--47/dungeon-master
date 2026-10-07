SET VARIABLE data_prefix = COALESCE(getvariable('data_prefix'), 'data/verify-crypto');

-- Ledgerline (crypto vertical) — story-keyed and eval-keyed DuckDB queries.
--
-- Generate first (repo root):
--   node scripts/verify-runner.mjs dungeons/vertical/crypto/crypto.js verify-crypto
-- Run:
--   duckdb -c ".read dungeons/vertical/crypto/crypto.sql"
-- Against a gzipped export:
--   duckdb -c "SET VARIABLE data_prefix='<dir>/crypto'" -c ".read crypto.sql"
--
-- All times are UTC. Window: 2026-06-04 00:00 to 2026-10-01 23:59:59.

-- ─────────────────────────────────────────────────────────────────────────
-- PRELUDE: raw files, identity resolution, warehouse tables
-- ─────────────────────────────────────────────────────────────────────────
-- Identity: new users sign up with "account created" (the auth event, which
-- carries user_id and device_id). A device resolves to the user seen with it
-- on any event that carries both ids, the way Mixpanel stitches. Every event
-- in this dataset already carries user_id, so uid = user_id.

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

CREATE OR REPLACE TEMP TABLE wh_market AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-market_prices_daily.json*', sample_size=-1, union_by_name=true);
CREATE OR REPLACE TEMP TABLE wh_network AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-chain_network_daily.json*', sample_size=-1, union_by_name=true);
CREATE OR REPLACE TEMP TABLE wh_marketing AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-paid_marketing_daily.json*', sample_size=-1, union_by_name=true);

-- profile attributes keyed by the resolved user id
CREATE OR REPLACE TEMP TABLE prof AS
SELECT distinct_id::VARCHAR AS uid, investor_type, acquisition_channel, customer_since, kyc_status,
 "Experiment: One-Tap Buy" AS variant, customer_since >= DATE '2026-06-04' AS is_new
FROM users;

-- server-side events (they keep firing when a customer goes quiet); "active" excludes them
CREATE OR REPLACE TEMP TABLE passive AS
SELECT * FROM (VALUES ('price alert triggered'), ('recurring buy executed'), ('withdrawal confirmed')) v(event);

-- daily activity: trades, Simple Buy starts, active users (user-initiated events)
CREATE OR REPLACE TEMP TABLE daily AS
SELECT t::DATE AS d,
 count(*) FILTER (WHERE event = 'trade executed') AS trades,
 count(*) FILTER (WHERE event = 'quick buy started') AS buys,
 count(DISTINCT uid) FILTER (WHERE event NOT IN (SELECT event FROM passive)) AS dau
FROM ev GROUP BY 1;

CREATE OR REPLACE TEMP TABLE btc AS
SELECT date::DATE AS d, realized_vol_pct AS vol, daily_return_pct AS ret, close_usd
FROM wh_market WHERE asset = 'BTC';

-- onboarding funnel per new user: steps in order, 7-day completion window
CREATE OR REPLACE TEMP TABLE onboarding AS
WITH s AS (SELECT uid, t AS t0, acquisition_channel AS ch, signup_method, os FROM ev WHERE event = 'account created'),
a AS (SELECT s.*, (SELECT min(t) FROM ev WHERE ev.uid = s.uid AND event = 'identity verification started' AND t >= s.t0) AS t1,
  (SELECT arg_min(id_document_type, t) FROM ev WHERE ev.uid = s.uid AND event = 'identity verification started' AND t >= s.t0) AS doc FROM s),
b AS (SELECT a.*, (SELECT min(t) FROM ev WHERE ev.uid = a.uid AND event = 'identity verified' AND t >= a.t1) AS t2 FROM a),
c AS (SELECT b.*, (SELECT min(t) FROM ev WHERE ev.uid = b.uid AND event = 'deposit completed' AND t >= b.t2) AS t3,
  (SELECT arg_min(deposit_method, t) FROM ev WHERE ev.uid = b.uid AND event = 'deposit completed' AND t >= b.t2) AS first_deposit_method FROM b)
SELECT *, (t1 IS NOT NULL AND t1 < t0 + INTERVAL 7 DAY) AS s1, (t2 IS NOT NULL AND t2 < t0 + INTERVAL 7 DAY) AS s2,
 (t3 IS NOT NULL AND t3 < t0 + INTERVAL 7 DAY) AS done, t0 >= TIMESTAMP '2026-07-28' AS post,
 t0 < TIMESTAMP '2026-09-24' AS full_window
FROM c;

-- one row per Simple Buy order (order_id is shared by start and completion)
CREATE OR REPLACE TEMP TABLE orders AS
SELECT s.uid, s.order_id, s.t AS t0, s.os, s.asset, c.t1, c.amount_usd,
 (c.t1 IS NOT NULL AND c.t1 < s.t + INTERVAL 1 DAY) AS ok
FROM (SELECT * FROM ev WHERE event = 'quick buy started') s
LEFT JOIN (SELECT order_id, min(t) AS t1, any_value(amount_usd) AS amount_usd FROM ev WHERE event = 'quick buy completed' GROUP BY 1) c ON c.order_id = s.order_id;

-- one row per withdrawal (withdrawal_id is shared by submission and confirmation)
CREATE OR REPLACE TEMP TABLE withdrawals AS
SELECT s.uid, s.withdrawal_id, s.t, s.network, s.asset, s.network_fee_usd, s.amount_usd, c.tc, c.confirmation_mins
FROM (SELECT * FROM ev WHERE event = 'withdrawal submitted') s
LEFT JOIN (SELECT withdrawal_id, min(t) AS tc, any_value(confirmation_mins) AS confirmation_mins FROM ev WHERE event = 'withdrawal confirmed' GROUP BY 1) c
 ON c.withdrawal_id = s.withdrawal_id;

-- funded new users and their day-7 / day-30 activity (app opened = a session start)
CREATE OR REPLACE TEMP TABLE new_funded AS
WITH s AS (SELECT uid, t0, os, first_deposit_method FROM onboarding WHERE uid IN (SELECT uid FROM ev WHERE event = 'deposit completed'))
SELECT s.uid, s.t0, s.os, s.first_deposit_method,
 count(*) FILTER (WHERE e.event = 'recurring buy created' AND e.t < s.t0 + INTERVAL 14 DAY) AS early_plans,
 count(*) FILTER (WHERE e.event = 'app opened' AND e.t >= s.t0 + INTERVAL 7 DAY AND e.t < s.t0 + INTERVAL 14 DAY) AS opens_d7,
 count(*) FILTER (WHERE e.event = 'app opened' AND e.t >= s.t0 + INTERVAL 30 DAY AND e.t < s.t0 + INTERVAL 37 DAY) AS opens_d30
FROM s JOIN ev e ON e.uid = s.uid GROUP BY 1, 2, 3, 4;

-- dataset overview
SELECT count(*) AS events, count(DISTINCT uid) AS users_with_events, (SELECT count(*) FROM users) AS profiles,
 count(DISTINCT uid) FILTER (WHERE event = 'account created') AS new_signups,
 min(t) AS first_event, max(t) AS last_event
FROM ev;

-- profiles with no event in the window (by customer_since: late-May sign-ups vs older customers)
SELECT customer_since >= DATE '2026-05-28' AS signed_up_last_week_of_may, kyc_status, count(*) AS profiles
FROM prof WHERE uid NOT IN (SELECT uid FROM ev) GROUP BY 1, 2 ORDER BY 1, 2;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H1-volatility-drives-trading
-- trades per daily active user on high-volatility days (BTC realized vol >= 4.5)
-- vs calm days (< 3.0); Simple Buy is the control
-- ─────────────────────────────────────────────────────────────────────────
WITH g AS (
 SELECT CASE WHEN vol >= 4.5 THEN 'high' WHEN vol < 3.0 THEN 'calm' ELSE 'mid' END AS grp, count(*) AS days,
  sum(trades)::DOUBLE / sum(dau) AS trades_per_dau, sum(buys)::DOUBLE / sum(dau) AS buys_per_dau
 FROM daily JOIN btc USING (d) GROUP BY 1)
SELECT grp, days, round(trades_per_dau, 4) AS trades_per_dau, round(buys_per_dau, 4) AS buys_per_dau,
 round(trades_per_dau / (SELECT trades_per_dau FROM g WHERE grp = 'calm'), 3) AS trades_vs_calm,
 round(buys_per_dau / (SELECT buys_per_dau FROM g WHERE grp = 'calm'), 3) AS buys_vs_calm
FROM g ORDER BY grp;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H2-ethereum-congestion-withdrawals
-- ratio of ratios: ethereum confirmation rate / other networks, congested days
-- (from chain_network_daily) vs the 7 days either side; warehouse fail rate
-- ─────────────────────────────────────────────────────────────────────────
WITH o AS (SELECT DISTINCT date::DATE AS d, network FROM wh_network WHERE network_status = 'congested'),
w AS (SELECT (t::DATE IN (SELECT d FROM o)) AS congested, network IN (SELECT network FROM o) AS hit, (tc IS NOT NULL) AS ok
 FROM withdrawals WHERE t >= TIMESTAMP '2026-07-13' AND t < TIMESTAMP '2026-07-30'),
g AS (SELECT congested, avg(ok::INT) FILTER (WHERE hit) AS eth_rate, avg(ok::INT) FILTER (WHERE NOT hit) AS other_rate FROM w GROUP BY 1)
SELECT (SELECT count(*) FROM o) AS congested_network_days,
 round(max(eth_rate) FILTER (WHERE congested), 4) AS eth_rate_congested, round(max(other_rate) FILTER (WHERE congested), 4) AS other_rate_congested,
 round(max(eth_rate) FILTER (WHERE NOT congested), 4) AS eth_rate_around, round(max(other_rate) FILTER (WHERE NOT congested), 4) AS other_rate_around,
 round((max(eth_rate) FILTER (WHERE congested) / max(other_rate) FILTER (WHERE congested))
  / (max(eth_rate) FILTER (WHERE NOT congested) / max(other_rate) FILTER (WHERE NOT congested)), 4) AS ratio_of_ratios,
 (SELECT round(avg(failed_broadcast_rate::DECIMAL(18,6)), 4) FROM wh_network WHERE network_status = 'congested') AS wh_congested_fail_rate
FROM g;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H3-kyc-vendor-switch
-- onboarding completion (7-day window) and median signup → first deposit time,
-- signups before vs from 2026-07-28 (signups through 2026-09-23)
-- ─────────────────────────────────────────────────────────────────────────
WITH g AS (SELECT post, count(*) AS signups, avg(done::INT) AS conv,
  median(date_diff('second', t0, t3)) FILTER (WHERE done) / 3600.0 AS median_hours
 FROM onboarding WHERE full_window GROUP BY 1)
SELECT post, signups, round(conv, 4) AS conv, round(median_hours, 2) AS median_hours,
 round(conv / (SELECT conv FROM g WHERE NOT post), 3) AS conv_vs_pre,
 round(median_hours / (SELECT median_hours FROM g WHERE NOT post), 3) AS ttc_vs_pre
FROM g ORDER BY post;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H4-recurring-buy-retention
-- funded new users (signups through 2026-08-25): day-30 and day-7 retention
-- (an app open in days 30-36 / 7-13) by recurring buy set up in the first 14 days
-- ─────────────────────────────────────────────────────────────────────────
WITH g AS (SELECT early_plans > 0 AS planner, count(*) AS users, avg((opens_d30 > 0)::INT) AS d30, avg((opens_d7 > 0)::INT) AS d7
 FROM new_funded WHERE t0 <= TIMESTAMP '2026-08-25 23:59:59' GROUP BY 1)
SELECT planner, users, round(d30, 4) AS d30, round(d7, 4) AS d7,
 round(d30 / (SELECT d30 FROM g WHERE NOT planner), 3) AS d30_ratio, round(d7 / (SELECT d7 FROM g WHERE NOT planner), 3) AS d7_ratio
FROM g ORDER BY planner;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H5-one-tap-buy-experiment
-- per-order Simple Buy completion (order_id held constant, 1-day window) and
-- median start → complete time by variant, orders from 2026-07-08
-- ─────────────────────────────────────────────────────────────────────────
WITH x AS (SELECT p.variant, o.uid, o.ok, CASE WHEN o.ok THEN date_diff('millisecond', o.t0, o.t1) / 1000.0 END AS ttc_s
 FROM orders o JOIN prof p ON p.uid = o.uid WHERE o.t0 >= TIMESTAMP '2026-07-08' AND p.variant IS NOT NULL),
g AS (SELECT variant, count(DISTINCT uid) AS users, count(*) AS orders, avg(ok::INT) AS conv, median(ttc_s) AS median_ttc_s FROM x GROUP BY 1)
SELECT variant, users, orders, round(conv, 4) AS conv, round(median_ttc_s, 1) AS median_ttc_s,
 round(conv / (SELECT conv FROM g WHERE variant = 'Control'), 3) AS conv_vs_control,
 round(median_ttc_s / (SELECT median_ttc_s FROM g WHERE variant = 'Control'), 3) AS ttc_vs_control
FROM g ORDER BY variant;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H6-paid-channel-quality
-- whole-window spend per Mixpanel signup by paid channel (budgets re-paced to
-- each channel's trailing 7-day sign-ups); 7-day onboarding
-- completion by channel (signups through 2026-09-23)
-- ─────────────────────────────────────────────────────────────────────────
WITH s AS (SELECT acquisition_channel AS ch, count(*) AS signups FROM ev WHERE event = 'account created' GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd::DECIMAL(18,2)) AS spend FROM wh_marketing GROUP BY 1),
f AS (SELECT ch, avg(done::INT) AS conv FROM onboarding WHERE full_window GROUP BY 1)
SELECT s.ch, s.signups, round(sp.spend, 0) AS spend_usd, round(sp.spend / s.signups, 2) AS spend_per_signup, round(f.conv, 4) AS conv_7d,
 round(f.conv / (SELECT conv FROM f WHERE ch = 'paid_search'), 3) AS conv_vs_paid_search
FROM s LEFT JOIN sp ON sp.ch = s.ch JOIN f ON f.ch = s.ch ORDER BY spend_per_signup NULLS LAST, s.ch;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H7-drawdown-panic-selling
-- sell share of trades on 2026-09-09..11 vs the 28 days before, new vs established
-- ─────────────────────────────────────────────────────────────────────────
WITH w AS (SELECT CASE WHEN p.is_new THEN 'new' ELSE 'established' END AS seg, e.uid, e.t >= TIMESTAMP '2026-09-09' AS crash, (e.side = 'sell') AS sell
 FROM ev e JOIN prof p ON p.uid = e.uid
 WHERE e.event = 'trade executed' AND e.t >= TIMESTAMP '2026-08-12' AND e.t < TIMESTAMP '2026-09-12')
SELECT seg, count(*) FILTER (WHERE crash) AS crash_trades, count(DISTINCT uid) FILTER (WHERE crash) AS crash_traders,
 round(avg(sell::INT) FILTER (WHERE crash), 4) AS sell_share_crash, round(avg(sell::INT) FILTER (WHERE NOT crash), 4) AS sell_share_before,
 round(avg(sell::INT) FILTER (WHERE crash) / avg(sell::INT) FILTER (WHERE NOT crash), 3) AS sell_ratio
FROM w GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H8-staking-commission-change
-- established customers: stake started and unstake requested totals, 21 days
-- after vs before 2026-08-19 (stakes 0.75; unstakes 1.667 = 14 days at 1.8 and
-- a 7-day fade to 1.0); average ETH net APY before vs after
-- ─────────────────────────────────────────────────────────────────────────
WITH x AS (SELECT e.event, e.t >= TIMESTAMP '2026-08-19' AS post FROM ev e JOIN prof p ON p.uid = e.uid
 WHERE NOT p.is_new AND e.event IN ('stake started', 'unstake requested') AND e.t >= TIMESTAMP '2026-07-29' AND e.t < TIMESTAMP '2026-09-09')
SELECT event, count(*) FILTER (WHERE NOT post) AS before_21d, count(*) FILTER (WHERE post) AS after_21d,
 round(count(*) FILTER (WHERE post)::DOUBLE / count(*) FILTER (WHERE NOT post), 3) AS after_vs_before,
 (SELECT round(avg(apy_pct::DECIMAL(18,6)) FILTER (WHERE t < TIMESTAMP '2026-08-19'), 3) FROM ev WHERE event = 'stake started' AND asset = 'ETH') AS eth_apy_before,
 (SELECT round(avg(apy_pct::DECIMAL(18,6)) FILTER (WHERE t >= TIMESTAMP '2026-08-19'), 3) FROM ev WHERE event = 'stake started' AND asset = 'ETH') AS eth_apy_after
FROM x GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H9-android-simple-buy-bug
-- per platform: Simple Buy completion on 2026-08-26..28 / completion in the
-- 7 days either side (Android reads 1 - 0.5; iOS + iPadOS is the 1.0 control);
-- the Android / Apple ratio of ratios for reference
-- ─────────────────────────────────────────────────────────────────────────
WITH w AS (SELECT (t0 >= TIMESTAMP '2026-08-26' AND t0 < TIMESTAMP '2026-08-29') AS inc, CASE WHEN os = 'Android' THEN 'android' ELSE 'apple' END AS plat, ok
 FROM orders WHERE t0 >= TIMESTAMP '2026-08-19' AND t0 < TIMESTAMP '2026-09-05'),
g AS (SELECT plat, avg(ok::INT) FILTER (WHERE inc) AS rate_incident, avg(ok::INT) FILTER (WHERE NOT inc) AS rate_around,
  count(*) FILTER (WHERE inc) AS orders_incident FROM w GROUP BY 1)
SELECT plat, orders_incident, round(rate_incident, 4) AS rate_incident, round(rate_around, 4) AS rate_around,
 round(rate_incident / rate_around, 4) AS incident_vs_around,
 round((SELECT rate_incident / rate_around FROM g WHERE plat = 'android') / (SELECT rate_incident / rate_around FROM g WHERE plat = 'apple'), 4) AS android_vs_apple_ratio_of_ratios
FROM g ORDER BY plat;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H10-ondo-listing
-- ONDO rows before the 2026-08-05 listing (must be 0); ONDO share of trades
-- after the ramp (from 2026-08-15)
-- ─────────────────────────────────────────────────────────────────────────
SELECT count(*) FILTER (WHERE asset = 'ONDO' AND t < TIMESTAMP '2026-08-05' AND event IN ('trade executed', 'asset viewed')) AS ondo_rows_before_listing,
 round(avg((asset = 'ONDO')::INT) FILTER (WHERE event = 'trade executed' AND t >= TIMESTAMP '2026-08-15'), 4) AS ondo_trade_share_after_ramp
FROM ev;

-- ═════════════════════════════════════════════════════════════════════════
-- EVAL QUERIES (eval/crypto.eval.md)
-- ═════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q1 — volatility and trading (H1): high / mid / calm days, correlation
-- ─────────────────────────────────────────────────────────────────────────
WITH j AS (SELECT d, vol, trades, buys, dau, trades::DOUBLE / dau AS tpd, buys::DOUBLE / dau AS bpd FROM daily JOIN btc USING (d))
SELECT CASE WHEN vol >= 4.5 THEN 'high (>=4.5)' WHEN vol < 3.0 THEN 'calm (<3.0)' ELSE 'mid' END AS grp, count(*) AS days,
 round(sum(trades)::DOUBLE / sum(dau), 4) AS trades_per_dau, round(sum(buys)::DOUBLE / sum(dau), 4) AS buys_per_dau,
 round(avg(trades), 0) AS avg_daily_trades, round(avg(dau), 0) AS avg_dau,
 (SELECT round(corr(vol, tpd), 3) FROM j) AS corr_vol_trades_per_dau, (SELECT round(corr(vol, bpd), 3) FROM j) AS corr_vol_buys_per_dau
FROM j GROUP BY 1 ORDER BY 1;

-- days with BTC realized volatility >= 4.5% and that day's trades per active user
SELECT d, vol, ret AS btc_return_pct, trades, dau, round(trades::DOUBLE / dau, 3) AS trades_per_dau
FROM daily JOIN btc USING (d) WHERE vol >= 4.5 ORDER BY d;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q2 — July withdrawal problems (H2)
-- ─────────────────────────────────────────────────────────────────────────
SELECT network, CASE WHEN t >= TIMESTAMP '2026-07-20' AND t < TIMESTAMP '2026-07-23' THEN 'jul20-22' ELSE 'jul13-19 + jul23-29' END AS period,
 count(*) AS submitted, count(tc) AS confirmed, round(count(tc)::DOUBLE / count(*), 4) AS confirm_rate,
 round(median(confirmation_mins), 1) AS median_conf_mins, round(avg(network_fee_usd::DECIMAL(18,6)), 3) AS avg_fee_usd
FROM withdrawals WHERE t >= TIMESTAMP '2026-07-13' AND t < TIMESTAMP '2026-07-30'
GROUP BY 1, 2 ORDER BY 1, 2;

SELECT date, network, withdrawals_broadcast, avg_network_fee_usd, median_confirmation_mins, failed_broadcast_rate, network_status
FROM wh_network WHERE network = 'ethereum' AND date BETWEEN DATE '2026-07-18' AND DATE '2026-07-24' ORDER BY date;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q3 — KYC vendor switch (H3): step conversion and time, before vs from 2026-07-28
-- ─────────────────────────────────────────────────────────────────────────
SELECT post, count(*) AS signups, round(avg(s1::INT), 4) AS started_kyc, round(avg(s2::INT), 4) AS verified,
 round(avg(done::INT), 4) AS funded_7d, round(median(date_diff('second', t0, t3)) FILTER (WHERE done) / 3600.0, 2) AS median_hours_to_fund,
 round(median(date_diff('second', t1, t2)) FILTER (WHERE done) / 3600.0, 2) AS median_hours_kyc
FROM onboarding WHERE full_window GROUP BY 1 ORDER BY 1;

SELECT post, ch = 'influencer_affiliate' AS influencer, count(*) AS signups, round(avg(done::INT), 4) AS funded_7d
FROM onboarding WHERE full_window GROUP BY 1, 2 ORDER BY 1, 2;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q4 — early behavior and retention (H4): funded new users, signups through 2026-08-25
-- ─────────────────────────────────────────────────────────────────────────
SELECT early_plans > 0 AS recurring_buy_first_14d, count(*) AS users, round(avg((opens_d7 > 0)::INT), 4) AS d7,
 round(avg((opens_d30 > 0)::INT), 4) AS d30
FROM new_funded WHERE t0 <= TIMESTAMP '2026-08-25 23:59:59' GROUP BY 1 ORDER BY 1;

-- other first-14-day behaviors (for contrast): staking, Advanced Trade, price alerts
WITH b AS (SELECT n.uid, n.opens_d30,
  count(*) FILTER (WHERE e.event = 'stake started' AND e.t < n.t0 + INTERVAL 14 DAY) AS stakes,
  count(*) FILTER (WHERE e.event = 'trade executed' AND e.t < n.t0 + INTERVAL 14 DAY) AS trades,
  count(*) FILTER (WHERE e.event = 'price alert created' AND e.t < n.t0 + INTERVAL 14 DAY) AS alerts
 FROM new_funded n JOIN ev e ON e.uid = n.uid WHERE n.t0 <= TIMESTAMP '2026-08-25 23:59:59' GROUP BY 1, 2)
SELECT 'staked' AS behavior, round(avg((opens_d30 > 0)::INT) FILTER (WHERE stakes > 0), 4) AS d30_did, round(avg((opens_d30 > 0)::INT) FILTER (WHERE stakes = 0), 4) AS d30_did_not FROM b
UNION ALL SELECT 'traded', round(avg((opens_d30 > 0)::INT) FILTER (WHERE trades > 0), 4), round(avg((opens_d30 > 0)::INT) FILTER (WHERE trades = 0), 4) FROM b
UNION ALL SELECT 'set price alert', round(avg((opens_d30 > 0)::INT) FILTER (WHERE alerts > 0), 4), round(avg((opens_d30 > 0)::INT) FILTER (WHERE alerts = 0), 4) FROM b;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q5 — One-Tap Buy experiment (H5)
-- ─────────────────────────────────────────────────────────────────────────
WITH x AS (SELECT p.variant, o.uid, o.ok, CASE WHEN o.ok THEN date_diff('millisecond', o.t0, o.t1) / 1000.0 END AS ttc_s
 FROM orders o JOIN prof p ON p.uid = o.uid WHERE o.t0 >= TIMESTAMP '2026-07-08' AND p.variant IS NOT NULL)
SELECT variant, count(DISTINCT uid) AS users, count(*) AS orders, sum(ok::INT) AS completed, round(avg(ok::INT), 4) AS completion,
 round(median(ttc_s), 1) AS median_seconds
FROM x GROUP BY 1 ORDER BY 1;

SELECT "Variant name" AS variant, count(DISTINCT uid) AS exposed_users FROM ev WHERE event = '$experiment_started' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q6 — paid channel efficiency (H6): signups 2026-06-04..09-23 and the same days' spend
-- ─────────────────────────────────────────────────────────────────────────
WITH sp AS (SELECT acquisition_channel AS ch, sum(spend_usd::DECIMAL(18,2)) AS spend FROM wh_marketing WHERE date::DATE < DATE '2026-09-24' GROUP BY 1),
f AS (SELECT ch, count(*) AS signups, sum(done::INT) AS funded FROM onboarding WHERE full_window GROUP BY 1)
SELECT f.ch, f.signups, f.funded, round(f.funded::DOUBLE / f.signups, 4) AS funded_rate, round(sp.spend, 0) AS spend_usd,
 round(sp.spend / f.signups, 2) AS cost_per_signup, round(sp.spend / f.funded, 2) AS cost_per_funded
FROM f LEFT JOIN sp ON sp.ch = f.ch ORDER BY cost_per_funded NULLS LAST, f.ch;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q7 — the September drawdown (H7)
-- ─────────────────────────────────────────────────────────────────────────
WITH w AS (SELECT CASE WHEN p.is_new THEN 'new' ELSE 'established' END AS seg,
  CASE WHEN e.t >= TIMESTAMP '2026-09-09' THEN 'sep9-11' ELSE 'aug12-sep8' END AS period, e.uid, (e.side = 'sell') AS sell
 FROM ev e JOIN prof p ON p.uid = e.uid WHERE e.event = 'trade executed' AND e.t >= TIMESTAMP '2026-08-12' AND e.t < TIMESTAMP '2026-09-12')
SELECT seg, period, count(*) AS trades, count(DISTINCT uid) AS traders, round(avg(sell::INT), 4) AS sell_share FROM w GROUP BY 1, 2 ORDER BY 1, 2;

SELECT t::DATE AS d, count(*) AS trades, round(avg((side = 'sell')::INT), 4) AS sell_share
FROM ev WHERE event = 'trade executed' AND t >= TIMESTAMP '2026-09-06' AND t < TIMESTAMP '2026-09-15' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q8 — staking commission change (H8)
-- ─────────────────────────────────────────────────────────────────────────
SELECT CASE WHEN p.is_new THEN 'new' ELSE 'established' END AS seg, e.event,
 count(*) FILTER (WHERE e.t >= TIMESTAMP '2026-07-29' AND e.t < TIMESTAMP '2026-08-19') AS jul29_aug18,
 count(*) FILTER (WHERE e.t >= TIMESTAMP '2026-08-19' AND e.t < TIMESTAMP '2026-09-09') AS aug19_sep8,
 count(*) FILTER (WHERE e.t >= TIMESTAMP '2026-09-09' AND e.t < TIMESTAMP '2026-09-30') AS sep9_sep29
FROM ev e JOIN prof p ON p.uid = e.uid WHERE e.event IN ('stake started', 'unstake requested') GROUP BY 1, 2 ORDER BY 1, 2;

-- established customers' unstake requests by week relative to the change (week 0 = Aug 19-25)
SELECT floor(date_diff('second', TIMESTAMP '2026-08-19', e.t) / 604800.0)::INT AS week_from_change, min(e.t)::DATE AS week_start, count(*) AS unstakes
FROM ev e JOIN prof p ON p.uid = e.uid
WHERE NOT p.is_new AND e.event = 'unstake requested' AND e.t >= TIMESTAMP '2026-07-29' AND e.t < TIMESTAMP '2026-09-30'
GROUP BY 1 ORDER BY 1;

SELECT asset, round(avg(apy_pct::DECIMAL(18,6)) FILTER (WHERE t < TIMESTAMP '2026-08-19'), 2) AS apy_before, round(avg(apy_pct::DECIMAL(18,6)) FILTER (WHERE t >= TIMESTAMP '2026-08-19'), 2) AS apy_after
FROM ev WHERE event = 'stake started' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q9 — late-August Simple Buy dip (H9)
-- ─────────────────────────────────────────────────────────────────────────
SELECT t0::DATE AS d, round(avg(ok::INT) FILTER (WHERE os = 'Android'), 4) AS android, round(avg(ok::INT) FILTER (WHERE os = 'iOS'), 4) AS ios,
 round(avg(ok::INT) FILTER (WHERE os = 'iPadOS'), 4) AS ipados, count(*) AS orders
FROM orders WHERE t0 >= TIMESTAMP '2026-08-22' AND t0 < TIMESTAMP '2026-09-02' GROUP BY 1 ORDER BY 1;

WITH w AS (SELECT CASE WHEN t0 >= TIMESTAMP '2026-08-26' AND t0 < TIMESTAMP '2026-08-29' THEN 'aug26-28' ELSE 'aug19-25 + aug29-sep4' END AS period, os, ok
 FROM orders WHERE t0 >= TIMESTAMP '2026-08-19' AND t0 < TIMESTAMP '2026-09-05')
SELECT period, os, count(*) AS orders, sum(ok::INT) AS completed, round(avg(ok::INT), 4) AS completion FROM w GROUP BY 1, 2 ORDER BY 1, 2;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q10 — ONDO since listing (H10)
-- ─────────────────────────────────────────────────────────────────────────
SELECT CASE WHEN t < TIMESTAMP '2026-08-05' THEN '1 before listing' WHEN t < TIMESTAMP '2026-08-15' THEN '2 aug5-14' ELSE '3 aug15-oct1' END AS period,
 count(*) AS trades, round(avg((asset = 'ONDO')::INT), 4) AS ondo_trade_share,
 round(sum(notional_usd::DECIMAL(18,2)) FILTER (WHERE asset = 'ONDO') / sum(notional_usd::DECIMAL(18,2)), 4) AS ondo_notional_share,
 count(DISTINCT uid) FILTER (WHERE asset = 'ONDO') AS ondo_traders, count(DISTINCT uid) AS traders
FROM ev WHERE event = 'trade executed' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q11 — does the ID document type change KYC approval? (null)
-- sign-ups through 2026-09-23 who started verification within 7 days: share
-- verified within 7 days of sign-up by id_document_type, and z vs driver's
-- license overall and within each platform, KYC vendor era, channel, and investor type
-- ─────────────────────────────────────────────────────────────────────────
WITH x AS (SELECT o.*, unnest(['all', 'os: ' || o.os, CASE WHEN o.post THEN 'from jul28' ELSE 'before jul28' END, 'ch: ' || o.ch, 'inv: ' || p.investor_type]) AS grp
 FROM onboarding o JOIN prof p ON p.uid = o.uid WHERE o.full_window AND o.s1),
g AS (SELECT grp, doc, count(*) AS n, avg(s2::INT) AS p FROM x GROUP BY 1, 2)
SELECT a.grp, b.doc, a.n AS n_drivers_license, b.n AS n_doc, round(a.p, 4) AS approved_drivers_license, round(b.p, 4) AS approved_doc,
 round((b.p - a.p) / sqrt(a.p * (1 - a.p) / a.n + b.p * (1 - b.p) / b.n), 2) AS z
FROM g a JOIN g b ON a.grp = b.grp AND a.doc = 'drivers_license' AND b.doc <> 'drivers_license' ORDER BY 1, 2;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q12 — do bank-transfer funders retain better than card funders? (null)
-- funded new users who signed up through 2026-08-25: day-30 retention (an app
-- open in days 30-36) by the method of their first deposit; z for bank transfer
-- vs debit card and vs every other method, overall and within each platform,
-- investor type, channel, and sign-up era
-- ─────────────────────────────────────────────────────────────────────────
SELECT first_deposit_method, count(*) AS users, round(avg((opens_d30 > 0)::INT), 4) AS d30
FROM new_funded WHERE t0 <= TIMESTAMP '2026-08-25 23:59:59' GROUP BY 1 ORDER BY 1;

WITH x AS (SELECT n.*, unnest(['all', 'os: ' || n.os, 'inv: ' || p.investor_type, 'ch: ' || p.acquisition_channel,
  CASE WHEN n.t0 >= TIMESTAMP '2026-07-28' THEN 'from jul28' ELSE 'before jul28' END]) AS grp
 FROM new_funded n JOIN prof p ON p.uid = n.uid WHERE n.t0 <= TIMESTAMP '2026-08-25 23:59:59'),
g AS (SELECT grp, CASE WHEN first_deposit_method = 'bank_transfer' THEN 'bank' WHEN first_deposit_method = 'debit_card' THEN 'card' ELSE 'other' END AS m,
  count(*) AS n, avg((opens_d30 > 0)::INT) AS p FROM x GROUP BY 1, 2),
h AS (SELECT grp, m = 'bank' AS bank, sum(n) AS n, sum(n * p) / sum(n) AS p FROM g GROUP BY 1, 2)
SELECT a.grp, 'bank vs card' AS comparison, b.n AS n_bank, a.n AS n_other, round(b.p, 4) AS d30_bank, round(a.p, 4) AS d30_other,
 round((b.p - a.p) / sqrt(a.p * (1 - a.p) / a.n + b.p * (1 - b.p) / b.n), 2) AS z
FROM g a JOIN g b ON a.grp = b.grp AND a.m = 'card' AND b.m = 'bank'
UNION ALL
SELECT a.grp, 'bank vs all other', b.n, a.n, round(b.p, 4), round(a.p, 4),
 round((b.p - a.p) / sqrt(a.p * (1 - a.p) / a.n + b.p * (1 - b.p) / b.n), 2)
FROM h a JOIN h b ON a.grp = b.grp AND NOT a.bank AND b.bank ORDER BY 2, 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q13 — Q3 paid marketing spend (2026-07-01..09-30)
-- ─────────────────────────────────────────────────────────────────────────
SELECT coalesce(acquisition_channel, 'total') AS channel, round(sum(spend_usd::DECIMAL(18,2)), 0) AS spend_usd,
 round(sum(spend_usd::DECIMAL(18,2)) / (SELECT sum(spend_usd::DECIMAL(18,2)) FROM wh_marketing WHERE date BETWEEN DATE '2026-07-01' AND DATE '2026-09-30'), 4) AS share
FROM wh_marketing WHERE date BETWEEN DATE '2026-07-01' AND DATE '2026-09-30'
GROUP BY ROLLUP (acquisition_channel) ORDER BY spend_usd;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q14 — ad-platform signups vs Mixpanel signups (whole window)
-- ─────────────────────────────────────────────────────────────────────────
WITH m AS (SELECT acquisition_channel AS ch, count(*) AS mixpanel_signups FROM ev WHERE event = 'account created' GROUP BY 1),
p AS (SELECT acquisition_channel AS ch, sum(platform_reported_signups) AS platform_signups, sum(spend_usd::DECIMAL(18,2)) AS spend FROM wh_marketing GROUP BY 1)
SELECT p.ch, p.platform_signups, m.mixpanel_signups, round(p.platform_signups / m.mixpanel_signups, 3) AS platform_over_mixpanel,
 round(p.spend / p.platform_signups, 2) AS cpa_platform, round(p.spend / m.mixpanel_signups, 2) AS cpa_mixpanel
FROM p JOIN m ON m.ch = p.ch ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q15 — new signups and funding
-- ─────────────────────────────────────────────────────────────────────────
SELECT coalesce(strftime(t0, '%Y-%m'), 'total') AS month, count(*) AS signups, sum(done::INT) AS funded_7d, round(avg(done::INT), 4) AS funded_7d_rate,
 sum((t3 IS NOT NULL)::INT) AS funded_ever, sum((t3 IS NOT NULL AND NOT done)::INT) AS funded_after_day_7
FROM onboarding GROUP BY ROLLUP (strftime(t0, '%Y-%m')) ORDER BY 1;

-- late funders (first deposit after day 7): count and days from sign-up
SELECT count(*) AS late_funders, round(min(date_diff('second', t0, t3)) / 86400.0, 1) AS min_days,
 round(median(date_diff('second', t0, t3)) / 86400.0, 1) AS median_days, round(max(date_diff('second', t0, t3)) / 86400.0, 1) AS max_days,
 round(count(*)::DOUBLE / (SELECT count(*) FROM onboarding WHERE t3 IS NOT NULL), 4) AS share_of_funders
FROM onboarding WHERE t3 IS NOT NULL AND NOT done;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q16 — how investor types differ (per user, whole window)
-- ─────────────────────────────────────────────────────────────────────────
WITH pu AS (SELECT p.investor_type, e.uid,
  count(*) FILTER (WHERE e.event = 'trade executed') AS trades, count(*) FILTER (WHERE e.event = 'quick buy completed') AS buys,
  count(*) FILTER (WHERE e.event = 'stake started') AS stakes, count(*) FILTER (WHERE e.event = 'app opened') AS sessions,
  median(e.notional_usd) FILTER (WHERE e.event = 'trade executed') AS med_trade_usd
 FROM ev e JOIN prof p ON p.uid = e.uid GROUP BY 1, 2)
SELECT investor_type, count(*) AS users, round(avg(sessions), 1) AS sessions_per_user, round(avg(trades), 1) AS trades_per_user,
 round(avg(buys), 1) AS simple_buys_per_user, round(avg(stakes), 2) AS stakes_per_user, round(median(med_trade_usd), 0) AS median_trade_usd
FROM pu GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q17 — incidents in the window (H2 + H9 summary)
-- ─────────────────────────────────────────────────────────────────────────
SELECT 'ethereum withdrawals jul20-22' AS incident, count(*) AS attempts, count(*) - count(tc) AS not_completed,
 round(count(tc)::DOUBLE / count(*), 4) AS success_rate
FROM withdrawals WHERE network = 'ethereum' AND t >= TIMESTAMP '2026-07-20' AND t < TIMESTAMP '2026-07-23'
UNION ALL
SELECT 'android simple buy aug26-28', count(*), count(*) - sum(ok::INT), round(avg(ok::INT), 4)
FROM orders WHERE os = 'Android' AND t0 >= TIMESTAMP '2026-08-26' AND t0 < TIMESTAMP '2026-08-29';

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q18 — recurring buys from customers who stopped opening the app (September)
-- ─────────────────────────────────────────────────────────────────────────
WITH x AS (SELECT r.uid, r.t, (SELECT max(t) FROM ev WHERE ev.uid = r.uid AND event = 'app opened' AND t <= r.t) AS last_open
 FROM ev r WHERE r.event = 'recurring buy executed' AND r.t >= TIMESTAMP '2026-09-01' AND r.t < TIMESTAMP '2026-10-01')
SELECT count(*) AS executions, count(DISTINCT uid) AS customers,
 round(avg((last_open IS NULL OR last_open < t - INTERVAL 30 DAY)::INT), 4) AS share_no_open_30d,
 count(DISTINCT uid) FILTER (WHERE last_open IS NULL OR last_open < t - INTERVAL 30 DAY) AS customers_no_open_30d
FROM x;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q19 — day-7 and day-30 retention of funded new customers (signups through 2026-08-25)
-- ─────────────────────────────────────────────────────────────────────────
SELECT count(*) AS funded_new_users, round(avg((opens_d7 > 0)::INT), 4) AS d7, round(avg((opens_d30 > 0)::INT), 4) AS d30,
 round(avg((early_plans > 0)::INT), 4) AS share_recurring_first_14d
FROM new_funded WHERE t0 <= TIMESTAMP '2026-08-25 23:59:59';

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q20 — open-ended: what to worry about in Q4 (supporting numbers)
-- ─────────────────────────────────────────────────────────────────────────
-- net customer money flow by month (deposits minus withdrawals, USD)
SELECT strftime(t, '%Y-%m') AS month, round(sum(amount_usd) FILTER (WHERE event = 'deposit completed'), 0) AS deposits_usd,
 round(sum(amount_usd) FILTER (WHERE event = 'withdrawal submitted'), 0) AS withdrawals_usd,
 round(sum(amount_usd) FILTER (WHERE event = 'deposit completed') - sum(amount_usd) FILTER (WHERE event = 'withdrawal submitted'), 0) AS net_usd
FROM ev WHERE event IN ('deposit completed', 'withdrawal submitted') GROUP BY 1 ORDER BY 1;

-- market move over the window (first vs last close)
SELECT asset, arg_min(close_usd, date) AS close_jun4, arg_max(close_usd, date) AS close_oct1,
 round(arg_max(close_usd, date) / arg_min(close_usd, date) - 1, 4) AS change
FROM wh_market GROUP BY 1 ORDER BY change;
