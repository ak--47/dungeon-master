-- Penny Harbor (fintech vertical) — story-keyed and eval-keyed DuckDB queries.
--
-- Generate first (repo root):
--   node scripts/verify-runner.mjs dungeons/vertical/fintech/fintech.js verify-fintech
-- Run:
--   duckdb -c ".read dungeons/vertical/fintech/fintech.sql"
-- Against a gzipped export:
--   duckdb -c "SET VARIABLE data_prefix='<dir>/fintech'" -c ".read fintech.sql"
--
-- All times are UTC. Window: 2026-06-04 00:00 to 2026-10-01 23:59:59.

SET VARIABLE data_prefix = COALESCE(getvariable('data_prefix'), 'data/verify-fintech');

-- ─────────────────────────────────────────────────────────────────────────
-- PRELUDE: raw files, identity resolution, warehouse tables
-- ─────────────────────────────────────────────────────────────────────────
-- Identity: new members are identified at "account opened" (the auth event,
-- which carries user_id and device_id). A device resolves to the user seen
-- with it on any event that carries both ids, the way Mixpanel stitches.
-- Every event in this dataset already carries user_id; server-side events
-- carry no device_id.

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
CREATE OR REPLACE TEMP TABLE wh_cards AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-card_authorizations_daily.json*', sample_size=-1, union_by_name=true);
CREATE OR REPLACE TEMP TABLE wh_pockets AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-pocket_savings_daily.json*', sample_size=-1, union_by_name=true);

-- profile attributes keyed by the resolved user id
CREATE OR REPLACE TEMP TABLE prof AS
SELECT distinct_id::VARCHAR AS uid, customer_segment, credit_history, acquisition_channel, plan_tier AS current_plan,
 customer_since, "Experiment: Autopay Default" AS variant
FROM users;

-- first time of each onboarding milestone per member
CREATE OR REPLACE TEMP TABLE milestones AS
SELECT uid,
 min(t) FILTER (WHERE event = 'identity verified') AS t_verified,
 min(t) FILTER (WHERE event = 'account funded') AS t_funded,
 min(t) FILTER (WHERE event = 'direct deposit set up') AS t_dd
FROM ev WHERE event IN ('identity verified', 'account funded', 'direct deposit set up') GROUP BY 1;

-- new members: one row per member who opened an account in the window
CREATE OR REPLACE TEMP TABLE signups AS
SELECT s.uid, s.t AS t0, s.acquisition_channel AS ch, s.os AS signup_os, p.credit_history, m.t_verified, m.t_funded, m.t_dd
FROM ev s JOIN prof p ON p.uid = s.uid LEFT JOIN milestones m ON m.uid = s.uid WHERE s.event = 'account opened';

-- one row per support ticket (ticket_id is shared by opened and resolved)
CREATE OR REPLACE TEMP TABLE tickets AS
SELECT ticket_id, any_value(uid) AS uid,
 min(t) FILTER (WHERE event = 'support ticket opened') AS t_open,
 min(t) FILTER (WHERE event = 'support ticket resolved') AS t_resolved,
 any_value(plan_tier) FILTER (WHERE event = 'support ticket opened') AS plan_at_open,
 any_value(issue_type) AS issue_type, any_value(contact_channel) AS contact_channel
FROM ev WHERE event IN ('support ticket opened', 'support ticket resolved') GROUP BY 1;

-- one row per biller added in the window (biller_id is shared by biller added and autopay enabled)
CREATE OR REPLACE TEMP TABLE billers AS
SELECT b.biller_id, b.uid, b.t AS t_added, b.biller_category, a.t_autopay
FROM ev b LEFT JOIN (SELECT biller_id, min(t) AS t_autopay FROM ev WHERE event = 'autopay enabled' GROUP BY 1) a ON a.biller_id = b.biller_id
WHERE b.event = 'biller added';

-- ═════════════════════════════════════════════════════════════════════════
-- STORIES
-- ═════════════════════════════════════════════════════════════════════════

-- STORY H1-thin-file-onboarding: 7-day onboarding completion by credit file (knob 41/74 = 0.554)
SELECT credit_history, count(*) AS signups,
 count(*) FILTER (WHERE t_funded >= t0 AND t_funded < t0 + INTERVAL 7 DAY AND t_verified <= t_funded) AS funded_7d,
 round(funded_7d / count(*), 4) AS completion
FROM signups GROUP BY 1 ORDER BY 1;

-- STORY H2-direct-deposit-retention: D30 retention (app opened days 30-36), DD within 14 days vs not, funded new members (knob 2.0x)
WITH s AS (SELECT uid, t0, coalesce(t_dd < t0 + INTERVAL 14 DAY, false) AS dd14 FROM signups
  WHERE t_funded IS NOT NULL AND t0 < TIMESTAMP '2026-10-01 23:59:59' - INTERVAL 37 DAY),
r AS (SELECT s.uid, s.dd14, count(e.uid) AS opens_d30 FROM s LEFT JOIN ev e ON e.uid = s.uid AND e.event = 'app opened'
  AND e.t >= s.t0 + INTERVAL 30 DAY AND e.t < s.t0 + INTERVAL 37 DAY GROUP BY 1, 2)
SELECT dd14, count(*) AS members, round(avg((opens_d30 > 0)::INT), 4) AS d30_retention FROM r GROUP BY 1 ORDER BY 1;

-- STORY H3-round-ups-launch: no round_up deposit before 2026-07-14; adoption among purchasers after the ramp (knob 0.35)
SELECT count(*) FILTER (WHERE source = 'round_up' AND t < TIMESTAMP '2026-07-14') AS round_ups_before_launch,
 count(*) FILTER (WHERE source = 'round_up') AS round_up_deposits
FROM ev WHERE event = 'savings deposit';
WITH p AS (SELECT DISTINCT uid FROM ev WHERE event = 'card transaction' AND transaction_type = 'purchase' AND authorization_status = 'approved' AND t >= TIMESTAMP '2026-08-04'),
r AS (SELECT DISTINCT uid FROM ev WHERE event = 'savings deposit' AND source = 'round_up' AND t >= TIMESTAMP '2026-08-04')
SELECT count(*) AS purchasers, count(r.uid) AS with_round_ups, round(count(r.uid) / count(*), 4) AS share FROM p LEFT JOIN r ON r.uid = p.uid;

-- STORY H4-wallet-outage: wallet approval relative to other channels, outage days vs ±7 days (knob 0.35); warehouse error rate (knob 0.65)
WITH o AS (SELECT DISTINCT date::DATE AS d FROM wh_cards WHERE processor_status = 'major_outage'),
w AS (SELECT t::DATE AS d, payment_channel = 'contactless_wallet' AS wallet, authorization_status = 'approved' AS ok
  FROM ev WHERE event = 'card transaction' AND t >= TIMESTAMP '2026-08-13' AND t < TIMESTAMP '2026-08-29'),
g AS (SELECT d IN (SELECT d FROM o) AS outage, avg(ok::INT) FILTER (WHERE wallet) AS wallet_ok, avg(ok::INT) FILTER (WHERE NOT wallet) AS other_ok FROM w GROUP BY 1)
SELECT outage, round(wallet_ok, 4) AS wallet_approval, round(other_ok, 4) AS other_approval,
 round((SELECT wallet_ok / other_ok FROM g WHERE outage) / (SELECT wallet_ok / other_ok FROM g WHERE NOT outage), 4) AS ratio_of_ratios
FROM g ORDER BY 1;
SELECT date, payment_channel, processor_status, tokenization_error_rate, approval_rate FROM wh_cards WHERE processor_status = 'major_outage' ORDER BY 1;

-- STORY H5-paid-channel-economics: spend per signup (knob 115/38 = 3.03x) and DD-in-14-days rate per signup by channel (knob 0.62/0.18 = 3.44x)
WITH s AS (SELECT acquisition_channel AS ch, count(*) AS signups FROM ev WHERE event = 'account opened' GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM wh_paid GROUP BY 1)
SELECT s.ch, s.signups, round(sp.spend, 2) AS spend_usd, round(sp.spend / s.signups, 2) AS spend_per_signup FROM s LEFT JOIN sp ON sp.ch = s.ch ORDER BY 4 DESC NULLS LAST, 1;
SELECT ch, count(*) AS signups, round(avg(coalesce(t_dd < t0 + INTERVAL 14 DAY, false)::INT), 4) AS dd14_rate
FROM signups WHERE t0 < TIMESTAMP '2026-09-17 23:59:59' GROUP BY 1 ORDER BY 3 DESC;

-- STORY H6-autopay-default-experiment: per-biller AutoPay adoption by variant, billers added from 2026-07-21 (knob 1.6x)
SELECT p.variant, count(*) AS billers, count(DISTINCT b.uid) AS members,
 round(avg(coalesce(b.t_autopay >= b.t_added AND b.t_autopay < b.t_added + INTERVAL 1 DAY, false)::INT), 4) AS autopay_rate
FROM billers b JOIN prof p ON p.uid = b.uid WHERE b.t_added >= TIMESTAMP '2026-07-21' AND p.variant IS NOT NULL GROUP BY 1 ORDER BY 1;

-- STORY H7-manual-payers-pay-late: late share by payment method (knobs 0.18 manual, 0.03 AutoPay)
SELECT autopay, count(*) AS payments, round(avg((payment_status = 'late')::INT), 4) AS late_share FROM ev WHERE event = 'bill paid' GROUP BY 1 ORDER BY 1;

-- STORY H8-summer-saver-boost: manual deposits per app visit, 8 boost weeks vs 8 weeks before (knob 1.5x Plus/Premium, 1.0x Free)
WITH w AS (SELECT CASE WHEN plan_tier IN ('plus', 'premium') THEN 'plus_premium' ELSE 'free' END AS grp, t >= TIMESTAMP '2026-08-03' AS boost, event FROM ev
  WHERE ((event = 'savings deposit' AND source = 'manual') OR event = 'app opened') AND t >= TIMESTAMP '2026-06-08' AND t < TIMESTAMP '2026-09-28'),
g AS (SELECT grp, boost, count(*) FILTER (WHERE event = 'savings deposit')::DOUBLE / count(*) FILTER (WHERE event = 'app opened') AS per_visit FROM w GROUP BY 1, 2)
SELECT grp, round(max(per_visit) FILTER (WHERE NOT boost), 5) AS before_boost, round(max(per_visit) FILTER (WHERE boost), 5) AS during_boost,
 round(max(per_visit) FILTER (WHERE boost) / max(per_visit) FILTER (WHERE NOT boost), 4) AS ratio FROM g GROUP BY 1 ORDER BY 1;

-- STORY H9-premium-priority-support: median ticket resolution time, Premium vs Free + Plus (knob 0.4x)
SELECT CASE WHEN plan_at_open = 'premium' THEN 'premium' ELSE 'free_plus' END AS grp, count(*) AS tickets,
 round(median(date_diff('second', t_open, t_resolved)) / 3600, 2) AS median_hours
FROM tickets WHERE t_open IS NOT NULL AND t_resolved IS NOT NULL GROUP BY 1 ORDER BY 1;

-- STORY H10-budget-magic-number: average manual deposit by budgets created (knob 1.6x at 3+, flat below)
WITH n AS (SELECT uid, count(*) FILTER (WHERE event = 'budget created') AS budgets FROM ev GROUP BY 1)
SELECT CASE WHEN budgets >= 3 THEN '3+' WHEN budgets = 2 THEN '2' ELSE '0-1' END AS budgets_created, count(DISTINCT ev.uid) AS members,
 count(*) AS deposits, round(avg(amount), 2) AS avg_deposit
FROM ev JOIN n ON n.uid = ev.uid WHERE ev.event = 'savings deposit' AND ev.source = 'manual' GROUP BY 1 ORDER BY 1;

-- ═════════════════════════════════════════════════════════════════════════
-- EVAL
-- ═════════════════════════════════════════════════════════════════════════

-- EVAL Q1: onboarding funnel by credit file, step by step (7-day window)
SELECT coalesce(credit_history, 'all') AS credit_history, count(*) AS signups,
 round(avg(coalesce(t_verified < t0 + INTERVAL 7 DAY, false)::INT), 4) AS verified_7d,
 round(avg(coalesce(t_funded < t0 + INTERVAL 7 DAY AND t_verified <= t_funded, false)::INT), 4) AS funded_7d
FROM signups GROUP BY ROLLUP (credit_history) ORDER BY 1;

-- EVAL Q2: median time from account opened to account funded (members who funded within 7 days), by credit file
SELECT coalesce(credit_history, 'all') AS credit_history, count(*) AS funded_members,
 round(median(date_diff('second', t0, t_funded)) / 3600, 2) AS median_hours,
 round(quantile_cont(date_diff('second', t0, t_funded), 0.9) / 3600, 2) AS p90_hours
FROM signups WHERE t_funded < t0 + INTERVAL 7 DAY GROUP BY ROLLUP (credit_history) ORDER BY 1;

-- EVAL Q3: day-30 retention of funded new members by direct deposit in the first 14 days (D7 alongside)
WITH s AS (SELECT uid, t0, coalesce(t_dd < t0 + INTERVAL 14 DAY, false) AS dd14 FROM signups
  WHERE t_funded IS NOT NULL AND t0 < TIMESTAMP '2026-10-01 23:59:59' - INTERVAL 37 DAY),
r AS (SELECT s.uid, s.dd14,
  count(e.uid) FILTER (WHERE e.t >= s.t0 + INTERVAL 7 DAY AND e.t < s.t0 + INTERVAL 14 DAY) AS d7,
  count(e.uid) FILTER (WHERE e.t >= s.t0 + INTERVAL 30 DAY AND e.t < s.t0 + INTERVAL 37 DAY) AS d30
  FROM s LEFT JOIN ev e ON e.uid = s.uid AND e.event = 'app opened' GROUP BY 1, 2)
SELECT coalesce(dd14::VARCHAR, 'all') AS dd_in_14_days, count(*) AS members, round(avg((d7 > 0)::INT), 4) AS d7_retention, round(avg((d30 > 0)::INT), 4) AS d30_retention
FROM r GROUP BY ROLLUP (dd14) ORDER BY 1;
-- daily active share by day since opening (share of the same members with an app opened on day N), and the day 26-36 average
WITH s AS (SELECT uid, t0, coalesce(t_dd < t0 + INTERVAL 14 DAY, false) AS dd14 FROM signups
  WHERE t_funded IS NOT NULL AND t0 < TIMESTAMP '2026-10-01 23:59:59' - INTERVAL 37 DAY),
a AS (SELECT DISTINCT s.uid, s.dd14, floor(date_diff('second', s.t0, e.t) / 86400)::INT AS n FROM s JOIN ev e ON e.uid = s.uid AND e.event = 'app opened'
  AND e.t >= s.t0 AND e.t < s.t0 + INTERVAL 37 DAY),
c AS (SELECT dd14, count(*) AS members FROM s GROUP BY 1),
d AS (SELECT a.dd14, a.n, count(*)::DOUBLE / any_value(c.members) AS share FROM a JOIN c ON c.dd14 = a.dd14 GROUP BY 1, 2)
SELECT dd14 AS dd_in_14_days,
 round(max(share) FILTER (WHERE n = 0), 4) AS day_0, round(max(share) FILTER (WHERE n = 7), 4) AS day_7,
 round(max(share) FILTER (WHERE n = 14), 4) AS day_14, round(max(share) FILTER (WHERE n = 21), 4) AS day_21,
 round(max(share) FILTER (WHERE n = 30), 4) AS day_30, round(avg(share) FILTER (WHERE n BETWEEN 26 AND 36), 4) AS avg_day_26_36
FROM d GROUP BY 1 ORDER BY 1;

-- EVAL Q4: cost per signup by paid channel (warehouse spend / Mixpanel signups), and what the platforms claim
WITH s AS (SELECT acquisition_channel AS ch, count(*) AS signups FROM ev WHERE event = 'account opened' GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend, sum(platform_reported_installs) AS claimed FROM wh_paid GROUP BY 1)
SELECT sp.ch, s.signups, round(sp.spend, 0) AS spend_usd, round(sp.spend / s.signups, 2) AS cost_per_signup,
 sp.claimed AS platform_installs, round(sp.spend / sp.claimed, 2) AS cost_per_claimed_install
FROM sp JOIN s ON s.ch = sp.ch ORDER BY 4;

-- EVAL Q5: cost per direct-deposit customer by paid channel (signups Jun 4 - Sep 17, DD within 14 days; spend over the same days)
WITH s AS (SELECT ch, count(*) AS signups, sum(coalesce(t_dd < t0 + INTERVAL 14 DAY, false)::INT) AS dd14 FROM signups
  WHERE t0 < TIMESTAMP '2026-09-17 23:59:59' GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM wh_paid WHERE date::DATE <= DATE '2026-09-17' GROUP BY 1)
SELECT s.ch, s.signups, s.dd14, round(s.dd14 / s.signups, 4) AS dd14_rate, round(sp.spend / s.signups, 2) AS cost_per_signup,
 round(sp.spend / s.dd14, 2) AS cost_per_dd_customer
FROM s LEFT JOIN sp ON sp.ch = s.ch ORDER BY 6 NULLS LAST, 1;

-- EVAL Q6: Round-Ups adoption by week (Monday weeks): members turning it on, and share of that week's purchasers whose purchases produced a round_up deposit
WITH p AS (SELECT date_trunc('week', t) AS wk, uid FROM ev WHERE event = 'card transaction' AND transaction_type = 'purchase' AND authorization_status = 'approved' AND t >= TIMESTAMP '2026-07-13' GROUP BY 1, 2),
r AS (SELECT date_trunc('week', t - INTERVAL 1 DAY) AS wk, uid FROM ev WHERE event = 'savings deposit' AND source = 'round_up' GROUP BY 1, 2),
en AS (SELECT date_trunc('week', t) AS wk, count(*) AS turned_on FROM ev WHERE event = 'round-ups enabled' GROUP BY 1)
SELECT p.wk::DATE AS week, count(*) AS purchasers, count(r.uid) AS with_round_up, round(count(r.uid) / count(*), 4) AS share, any_value(en.turned_on) AS turned_on
FROM p LEFT JOIN r ON r.wk = p.wk AND r.uid = p.uid LEFT JOIN en ON en.wk = p.wk GROUP BY 1 ORDER BY 1;
-- totals: members who turned Round-Ups on, and Round-Up sweeps posted
SELECT count(DISTINCT uid) FILTER (WHERE event = 'round-ups enabled') AS members_turned_on,
 count(*) FILTER (WHERE event = 'savings deposit' AND source = 'round_up') AS round_up_sweeps
FROM ev WHERE event IN ('round-ups enabled', 'savings deposit');

-- EVAL Q7: did Round-Ups replace manual Pocket deposits? manual deposits per app visit, adopters vs others, before launch vs after the ramp,
-- overall and by plan group; did = adopters' change / others' change; z = log(did) / sqrt(sum of 1/deposits) (Poisson counts)
WITH a AS (SELECT DISTINCT uid FROM ev WHERE event = 'round-ups enabled'),
w AS (SELECT uid IN (SELECT uid FROM a) AS adopter, CASE WHEN plan_tier = 'free' THEN 'free' ELSE 'plus_premium' END AS grp,
  CASE WHEN t < TIMESTAMP '2026-07-14' THEN 'before' WHEN t >= TIMESTAMP '2026-08-04' THEN 'after' END AS period, event
  FROM ev WHERE event = 'app opened' OR (event = 'savings deposit' AND source = 'manual')),
g AS (SELECT coalesce(grp, 'all') AS grp, adopter, period, count(*) FILTER (WHERE event = 'savings deposit') AS deposits, count(*) FILTER (WHERE event = 'app opened') AS visits
  FROM w WHERE period IS NOT NULL GROUP BY GROUPING SETS ((adopter, period), (grp, adopter, period))),
c AS (SELECT grp, adopter,
  max(deposits::DOUBLE / visits) FILTER (WHERE period = 'before') AS before_launch,
  max(deposits::DOUBLE / visits) FILTER (WHERE period = 'after') AS after_ramp,
  sum(1.0 / deposits) AS inv FROM g GROUP BY 1, 2)
SELECT x.grp AS plan_group, round(x.before_launch, 5) AS adopters_before, round(x.after_ramp, 5) AS adopters_after,
 round(y.before_launch, 5) AS others_before, round(y.after_ramp, 5) AS others_after,
 round((x.after_ramp / x.before_launch) / (y.after_ramp / y.before_launch), 4) AS did,
 round(ln((x.after_ramp / x.before_launch) / (y.after_ramp / y.before_launch)) / sqrt(x.inv + y.inv), 3) AS z
FROM c x JOIN c y ON y.grp = x.grp AND x.adopter AND NOT y.adopter ORDER BY 1;

-- EVAL Q8: card approvals by channel around Aug 20-21, with warehouse processor status
WITH d AS (SELECT t::DATE AS day, payment_channel, count(*) AS txns, avg((authorization_status = 'approved')::INT) AS approval
  FROM ev WHERE event = 'card transaction' AND t >= TIMESTAMP '2026-08-17' AND t < TIMESTAMP '2026-08-25' GROUP BY 1, 2)
SELECT d.day, d.payment_channel, d.txns, round(d.approval, 4) AS approval, w.processor_status, w.tokenization_error_rate
FROM d LEFT JOIN wh_cards w ON w.date::DATE = d.day AND w.payment_channel = d.payment_channel ORDER BY 1, 2;
WITH w AS (SELECT t::DATE IN (DATE '2026-08-20', DATE '2026-08-21') AS outage, payment_channel, authorization_status, decline_reason
  FROM ev WHERE event = 'card transaction' AND t >= TIMESTAMP '2026-08-13' AND t < TIMESTAMP '2026-08-29')
SELECT payment_channel, outage, count(*) AS txns, round(avg((authorization_status = 'approved')::INT), 4) AS approval,
 count(*) FILTER (WHERE decline_reason = 'technical_error') AS technical_declines
FROM w GROUP BY 1, 2 ORDER BY 1, 2;
SELECT count(*) AS outage_wallet_declines, count(DISTINCT uid) AS members_affected
FROM ev WHERE event = 'card transaction' AND payment_channel = 'contactless_wallet' AND decline_reason = 'technical_error' AND t >= TIMESTAMP '2026-08-20' AND t < TIMESTAMP '2026-08-22';

-- EVAL Q9: support tickets around the outage (Aug 20-21 vs the other days)
SELECT CASE WHEN t_open >= TIMESTAMP '2026-08-20' AND t_open < TIMESTAMP '2026-08-22' THEN 'aug_20_21' ELSE 'other_days' END AS period,
 count(*) AS tickets, count(*) FILTER (WHERE issue_type = 'card_declined') AS card_declined,
 round(count(*) / count(DISTINCT t_open::DATE), 1) AS tickets_per_day,
 round(count(*) FILTER (WHERE issue_type = 'card_declined') / count(DISTINCT t_open::DATE), 1) AS card_declined_per_day
FROM tickets WHERE t_open IS NOT NULL GROUP BY 1 ORDER BY 1;

-- EVAL Q10: Autopay Default experiment — AutoPay on new billers by variant, and exposure
SELECT p.variant, count(*) AS billers, count(DISTINCT b.uid) AS members,
 round(avg(coalesce(b.t_autopay >= b.t_added AND b.t_autopay < b.t_added + INTERVAL 1 DAY, false)::INT), 4) AS autopay_rate
FROM billers b JOIN prof p ON p.uid = b.uid WHERE b.t_added >= TIMESTAMP '2026-07-21' AND p.variant IS NOT NULL GROUP BY 1 ORDER BY 1;
SELECT "Variant name" AS variant, count(DISTINCT uid) AS exposed_members FROM ev WHERE event = '$experiment_started' GROUP BY 1 ORDER BY 1;
-- per member (a unique-member funnel): any biller added from 2026-07-21 that got AutoPay within a day
WITH m AS (SELECT b.uid, max(coalesce(b.t_autopay >= b.t_added AND b.t_autopay < b.t_added + INTERVAL 1 DAY, false)::INT) AS conv
  FROM billers b WHERE b.t_added >= TIMESTAMP '2026-07-21' GROUP BY 1)
SELECT p.variant, count(*) AS members, round(avg(m.conv), 4) AS member_autopay_rate FROM m JOIN prof p ON p.uid = m.uid WHERE p.variant IS NOT NULL GROUP BY 1 ORDER BY 1;
-- the same per-biller read over the full window (billers added before 2026-07-21 count in both arms)
SELECT p.variant, count(*) AS billers,
 round(avg(coalesce(b.t_autopay >= b.t_added AND b.t_autopay < b.t_added + INTERVAL 1 DAY, false)::INT), 4) AS autopay_rate_full_window
FROM billers b JOIN prof p ON p.uid = b.uid WHERE p.variant IS NOT NULL GROUP BY 1 ORDER BY 1;

-- EVAL Q11: did the Federal Reserve holidays dent card spending? card transactions on each holiday vs the same weekday 1 and 2 weeks
-- either side; z against the same ratio for every other day that has all four neighbors in the window
WITH d AS (SELECT t::DATE AS day, count(*) AS txns FROM ev WHERE event = 'card transaction' GROUP BY 1),
r AS (SELECT a.day, a.txns, (SELECT avg(b.txns) FROM d b WHERE b.day IN (a.day - 14, a.day - 7, a.day + 7, a.day + 14)) AS neighbors,
  (SELECT count(*) FROM d b WHERE b.day IN (a.day - 14, a.day - 7, a.day + 7, a.day + 14)) AS n
  FROM d a),
base AS (SELECT avg(txns / neighbors) AS m, stddev_samp(txns / neighbors) AS sd FROM r WHERE n = 4 AND day NOT IN (DATE '2026-06-19', DATE '2026-07-03', DATE '2026-09-07'))
SELECT r.day, dayname(r.day) AS weekday, r.txns, round(r.neighbors, 1) AS same_weekday_avg, round(r.txns / r.neighbors, 4) AS ratio,
 round((r.txns / r.neighbors - base.m) / base.sd, 3) AS z
FROM r, base WHERE r.day IN (DATE '2026-06-19', DATE '2026-07-03', DATE '2026-09-07')
UNION ALL
-- pooled over the three holidays: mean ratio, z = mean z × sqrt(3)
SELECT NULL, 'all three', sum(r.txns), round(sum(r.neighbors), 1), round(avg(r.txns / r.neighbors), 4),
 round(avg((r.txns / r.neighbors - base.m) / base.sd) * sqrt(3), 3)
FROM r, base WHERE r.day IN (DATE '2026-06-19', DATE '2026-07-03', DATE '2026-09-07')
ORDER BY 1 NULLS LAST;

-- EVAL Q12: late bill payments by payment method, and overall
SELECT coalesce(CASE WHEN autopay THEN 'autopay' ELSE 'manual' END, 'all') AS method, count(*) AS payments,
 count(*) FILTER (WHERE payment_status = 'late') AS late, round(avg((payment_status = 'late')::INT), 4) AS late_share
FROM ev WHERE event = 'bill paid' GROUP BY ROLLUP (CASE WHEN autopay THEN 'autopay' ELSE 'manual' END) ORDER BY 1;

-- EVAL Q13: late payments on billers added during the test, by the member's variant
SELECT p.variant, count(*) AS payments, round(avg(e.autopay::INT), 4) AS autopay_share, round(avg((e.payment_status = 'late')::INT), 4) AS late_share
FROM ev e JOIN billers b ON b.biller_id = e.biller_id JOIN prof p ON p.uid = e.uid
WHERE e.event = 'bill paid' AND b.t_added >= TIMESTAMP '2026-07-21' AND p.variant IS NOT NULL GROUP BY 1 ORDER BY 1;

-- EVAL Q14: Summer Saver Boost — manual deposits per app visit by plan group (8 weeks before vs 8 boost weeks), APY and deposits from the warehouse
WITH w AS (SELECT CASE WHEN plan_tier IN ('plus', 'premium') THEN 'plus_premium' ELSE 'free' END AS grp, t >= TIMESTAMP '2026-08-03' AS boost, event FROM ev
  WHERE ((event = 'savings deposit' AND source = 'manual') OR event = 'app opened') AND t >= TIMESTAMP '2026-06-08' AND t < TIMESTAMP '2026-09-28'),
g AS (SELECT grp, boost, count(*) FILTER (WHERE event = 'savings deposit') AS deposits, count(*) FILTER (WHERE event = 'app opened') AS visits FROM w GROUP BY 1, 2)
SELECT grp, boost, deposits, visits, round(deposits::DOUBLE / visits, 5) AS per_visit FROM g ORDER BY 1, 2;
SELECT plan_tier, min(date) FILTER (WHERE promo_code <> 'none') AS boost_from, max(date) FILTER (WHERE promo_code <> 'none') AS boost_to,
 max(apy_pct) FILTER (WHERE date < DATE '2026-08-03') AS apy_before, max(apy_pct) FILTER (WHERE promo_code <> 'none') AS apy_boost,
 round(avg(deposits_usd) FILTER (WHERE date >= DATE '2026-06-08' AND date < DATE '2026-08-03'), 0) AS deposits_per_day_before,
 round(avg(deposits_usd) FILTER (WHERE date >= DATE '2026-08-03' AND date < DATE '2026-09-28'), 0) AS deposits_per_day_boost
FROM wh_pockets GROUP BY 1 ORDER BY 1;

-- EVAL Q15: what the boost cost in extra interest (balance × (boost APY − prior APY) / 365, Aug 3 - Sep 30) and how Pocket balances moved
WITH base AS (SELECT plan_tier, max(apy_pct) FILTER (WHERE date < DATE '2026-08-03') AS apy0 FROM wh_pockets GROUP BY 1)
SELECT coalesce(w.plan_tier, 'plus_premium') AS plan_tier,
 round(sum(w.interest_paid_usd) FILTER (WHERE w.promo_code <> 'none'), 0) AS interest_paid_during_boost,
 round(sum(w.pocket_balance_usd * (w.apy_pct - b.apy0) / 100 / 365) FILTER (WHERE w.promo_code <> 'none'), 0) AS extra_interest_from_boost,
 sum(w.pocket_balance_usd) FILTER (WHERE w.date = DATE '2026-08-02') AS balance_aug_2,
 sum(w.pocket_balance_usd) FILTER (WHERE w.date = DATE '2026-09-30') AS balance_sep_30,
 round(sum(w.deposits_usd - w.withdrawals_usd) FILTER (WHERE w.date < DATE '2026-08-03') / 60, 0) AS net_inflow_per_day_before,
 round(sum(w.deposits_usd - w.withdrawals_usd) FILTER (WHERE w.promo_code <> 'none') / 59, 0) AS net_inflow_per_day_boost
FROM wh_pockets w JOIN base b ON b.plan_tier = w.plan_tier WHERE w.plan_tier IN ('plus', 'premium') GROUP BY ROLLUP (w.plan_tier) ORDER BY 1;

-- EVAL Q16: median and mean ticket resolution time by plan at the time the ticket was opened
SELECT plan_at_open, count(*) AS tickets, round(median(date_diff('second', t_open, t_resolved)) / 3600, 2) AS median_hours,
 round(avg(date_diff('second', t_open, t_resolved)) / 3600, 2) AS mean_hours
FROM tickets WHERE t_open IS NOT NULL AND t_resolved IS NOT NULL GROUP BY 1
UNION ALL
SELECT 'free_plus' AS plan_at_open, count(*), round(median(date_diff('second', t_open, t_resolved)) / 3600, 2), round(avg(date_diff('second', t_open, t_resolved)) / 3600, 2)
FROM tickets WHERE t_open IS NOT NULL AND t_resolved IS NOT NULL AND plan_at_open <> 'premium'
ORDER BY 1;

-- EVAL Q17: average manual Pocket deposit by number of budgets created in the window
WITH n AS (SELECT uid, count(*) FILTER (WHERE event = 'budget created') AS budgets FROM ev GROUP BY 1)
SELECT CASE WHEN budgets >= 5 THEN '5+' ELSE budgets::VARCHAR END AS budgets_created, count(DISTINCT ev.uid) AS members,
 count(*) AS deposits, round(avg(amount), 2) AS avg_deposit, round(median(amount), 2) AS median_deposit
FROM ev JOIN n ON n.uid = ev.uid WHERE ev.event = 'savings deposit' AND ev.source = 'manual' GROUP BY 1
UNION ALL
SELECT CASE WHEN budgets >= 3 THEN 'group 3+' ELSE 'group 0-2' END, count(DISTINCT ev.uid), count(*), round(avg(amount), 2), round(median(amount), 2)
FROM ev JOIN n ON n.uid = ev.uid WHERE ev.event = 'savings deposit' AND ev.source = 'manual' GROUP BY 1
ORDER BY 1;

-- EVAL Q18: direct deposits posted around the Federal Reserve holidays
SELECT t::DATE AS day, dayname(t) AS weekday, count(*) FILTER (WHERE event = 'direct deposit received') AS paychecks,
 count(*) FILTER (WHERE event = 'direct deposit received' AND pay_frequency = 'weekly') AS weekly_paychecks,
 count(*) FILTER (WHERE event = 'direct deposit received' AND pay_frequency = 'biweekly') AS biweekly_paychecks,
 count(*) FILTER (WHERE event = 'direct deposit received' AND pay_frequency = 'semimonthly') AS semimonthly_paychecks,
 count(*) FILTER (WHERE event = 'bill paid' AND autopay) AS autopay_payments, count(*) FILTER (WHERE event = 'card transaction') AS card_txns
FROM ev WHERE t::DATE BETWEEN DATE '2026-06-17' AND DATE '2026-06-22' OR t::DATE BETWEEN DATE '2026-07-01' AND DATE '2026-07-06' OR t::DATE BETWEEN DATE '2026-09-03' AND DATE '2026-09-08'
GROUP BY 1, 2 ORDER BY 1;

-- EVAL Q19: did members hit by the wallet outage use their card less afterwards? card transactions per member, 14 days before Aug 20 (Aug 6-19)
-- vs 14 days after Aug 21 (Aug 22 - Sep 4); z = difference in mean change between groups / its standard error.
-- (a) the cleanest comparison: members who made exactly one wallet payment on Aug 20-21; the processor declined some of those payments
--     (technical_error) and approved others, so the two groups had the same outage-day usage (overall and by current plan)
WITH od AS (SELECT uid, count(*) AS wallet_txns, max(coalesce(decline_reason = 'technical_error', false)::INT) AS hit, max((authorization_status = 'approved')::INT) AS approved
  FROM ev WHERE event = 'card transaction' AND payment_channel = 'contactless_wallet' AND t >= TIMESTAMP '2026-08-20' AND t < TIMESTAMP '2026-08-22' GROUP BY 1),
m AS (SELECT od.uid, od.hit = 1 AS hit, CASE WHEN p.current_plan = 'free' THEN 'free' ELSE 'plus_premium' END AS grp,
  count(e.uid) FILTER (WHERE e.t >= TIMESTAMP '2026-08-06' AND e.t < TIMESTAMP '2026-08-20') AS before_14d,
  count(e.uid) FILTER (WHERE e.t >= TIMESTAMP '2026-08-22' AND e.t < TIMESTAMP '2026-09-05') AS after_14d
  FROM od JOIN prof p ON p.uid = od.uid LEFT JOIN ev e ON e.uid = od.uid AND e.event = 'card transaction'
  WHERE od.wallet_txns = 1 AND (od.hit = 1 OR od.approved = 1) GROUP BY 1, 2, 3),
g AS (SELECT coalesce(grp, 'all') AS grp, hit, count(*) AS members, avg(before_14d) AS b, avg(after_14d) AS a, avg(after_14d - before_14d) AS d, var_samp(after_14d - before_14d) AS v
  FROM m GROUP BY GROUPING SETS ((hit), (grp, hit)))
SELECT 'one_wallet_payment' AS comparison, g.grp, g.hit, g.members, round(g.b, 3) AS txns_before, round(g.a, 3) AS txns_after, round(g.a / g.b, 4) AS after_over_before,
 round((SELECT (x.d - y.d) / sqrt(x.v / x.members + y.v / y.members) FROM g x, g y WHERE x.grp = g.grp AND y.grp = g.grp AND x.hit AND NOT y.hit), 3) AS z_diff_in_change
FROM g ORDER BY 2, 3;
-- (b) broader controls: outage-declined members vs other wallet users (wallet payment Aug 6-19) who used their card on Aug 20-21,
--     and vs all other wallet users; hit members were active on the outage days by definition, so these controls favor the hit group
WITH hit AS (SELECT DISTINCT uid FROM ev WHERE event = 'card transaction' AND decline_reason = 'technical_error' AND payment_channel = 'contactless_wallet' AND t >= TIMESTAMP '2026-08-20' AND t < TIMESTAMP '2026-08-22'),
act AS (SELECT DISTINCT uid FROM ev WHERE event = 'card transaction' AND t >= TIMESTAMP '2026-08-20' AND t < TIMESTAMP '2026-08-22'),
wal AS (SELECT DISTINCT uid FROM ev WHERE event = 'card transaction' AND payment_channel = 'contactless_wallet' AND t >= TIMESTAMP '2026-08-06' AND t < TIMESTAMP '2026-08-20'),
m AS (SELECT w.uid, w.uid IN (SELECT uid FROM hit) AS hit, w.uid IN (SELECT uid FROM act) AS active_outage_days,
  count(e.uid) FILTER (WHERE e.t >= TIMESTAMP '2026-08-06' AND e.t < TIMESTAMP '2026-08-20') AS before_14d,
  count(e.uid) FILTER (WHERE e.t >= TIMESTAMP '2026-08-22' AND e.t < TIMESTAMP '2026-09-05') AS after_14d
  FROM wal w LEFT JOIN ev e ON e.uid = w.uid AND e.event = 'card transaction' GROUP BY 1, 2, 3),
c AS (SELECT 'card_users_on_outage_days' AS comparison, * FROM m WHERE active_outage_days UNION ALL SELECT 'all_wallet_users' AS comparison, * FROM m),
g AS (SELECT comparison, hit, count(*) AS members, avg(before_14d) AS b, avg(after_14d) AS a, avg(after_14d - before_14d) AS d, var_samp(after_14d - before_14d) AS v FROM c GROUP BY 1, 2)
SELECT g.comparison, g.hit, g.members, round(g.b, 3) AS txns_before, round(g.a, 3) AS txns_after, round(g.a / g.b, 4) AS after_over_before,
 round((SELECT (x.d - y.d) / sqrt(x.v / x.members + y.v / y.members) FROM g x, g y WHERE x.comparison = g.comparison AND y.comparison = g.comparison AND x.hit AND NOT y.hit), 3) AS z_diff_in_change
FROM g ORDER BY 1, 2;

-- EVAL Q20: quarter summary for the open question
SELECT
 (SELECT count(DISTINCT uid) FROM ev WHERE event = 'app opened' AND t >= TIMESTAMP '2026-09-24' AND t < TIMESTAMP '2026-10-01') AS active_members_last_7d,
 (SELECT count(*) FROM signups) AS signups,
 (SELECT round(avg((t_funded IS NOT NULL)::INT), 4) FROM signups) AS funded_share,
 (SELECT round(avg(coalesce(t_dd < t0 + INTERVAL 14 DAY, false)::INT), 4) FROM signups WHERE t_funded IS NOT NULL AND t0 < TIMESTAMP '2026-09-17 23:59:59') AS dd14_share_of_funded,
 (SELECT round(avg((payment_status = 'late')::INT), 4) FROM ev WHERE event = 'bill paid' AND NOT autopay) AS manual_late_share,
 (SELECT round(avg((NOT autopay)::INT), 4) FROM ev WHERE event = 'bill paid') AS manual_share_of_bills,
 (SELECT round(avg((payment_channel = 'contactless_wallet')::INT), 4) FROM ev WHERE event = 'card transaction') AS wallet_share_of_card_txns,
 (SELECT round(count(*) FILTER (WHERE ch = 'paid_social') / count(*), 4) FROM signups) AS paid_social_share_of_signups;
