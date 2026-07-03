-- ============================================================
-- fintech.js — v1.6 human-inspection queries (DuckDB)
--
-- Every query is keyed to a story id in fintech.js's `stories` export;
-- the machine-checked verdicts come from:
--   node scripts/verify-stories.mjs dungeons/vertical/fintech/fintech.js --data-prefix verify-fintech
-- Generate first:
--   node scripts/verify-runner.mjs dungeons/vertical/fintech/fintech.js verify-fintech
-- Run this file:
--   duckdb -c ".read dungeons/vertical/fintech/fintech.sql"
-- ============================================================

-- ── identity-resolution prelude ─────────────────────────────
-- avgDevicePerUser: 2 — resolve device_id → canonical distinct_id via the
-- USERS shards so uniques are identity-correct even for device-only rows.
CREATE OR REPLACE VIEW users AS
SELECT * FROM read_json_auto('data/verify-fintech-USERS*.json', sample_size=-1, union_by_name=true);

CREATE OR REPLACE VIEW device_map AS
-- profiles store the device pool under the legacy "anonymousIds" key
-- (buildIdentityMap in lib/verify/identity.js reads the same field)
SELECT unnest("anonymousIds") AS device_id, distinct_id FROM users;

CREATE OR REPLACE VIEW ev AS
-- ::VARCHAR casts — user_id sniffs as UUID, device_id as VARCHAR; DuckDB
-- refuses to coalesce mixed types
SELECT coalesce(m.distinct_id::VARCHAR, e.user_id::VARCHAR, e.device_id::VARCHAR) AS uid,
       e.time::TIMESTAMP AS t,
       e.*
FROM read_json_auto('data/verify-fintech-EVENTS*.json', sample_size=-1, union_by_name=true) e
LEFT JOIN device_map m ON e.device_id = m.device_id;


-- ── H1-business-txn-4x ──────────────────────────────────────
-- user mix ~ 80/20 personal/business; business avg txn amount ~ 4x personal
SELECT account_segment, count(*) AS users FROM users GROUP BY 1 ORDER BY 1;

SELECT u.account_segment, count(*) AS txns, round(avg(e.amount), 0) AS avg_amount
FROM ev e JOIN users u ON e.uid = u.distinct_id
WHERE e.event = 'transaction completed' AND e.amount IS NOT NULL
GROUP BY 1 ORDER BY avg_amount DESC;


-- ── H2-payday-amounts ───────────────────────────────────────
-- direct deposits 3x on the 1st/15th; transfers ~1.6x on days 1-3 / 15-17
SELECT EXTRACT(DAY FROM t) AS dom, count(*) AS deposits, round(avg(amount), 0) AS avg_amount
FROM ev WHERE event = 'transaction completed' AND transaction_type = 'direct_deposit'
GROUP BY 1 ORDER BY 1;

SELECT CASE WHEN EXTRACT(DAY FROM t) IN (1, 2, 3, 15, 16, 17) THEN 'payday_window' ELSE 'other' END AS bucket,
       count(*) AS transfers, round(avg(amount), 0) AS avg_amount
FROM ev WHERE event = 'transfer sent' GROUP BY 1 ORDER BY 1;


-- ── H3-fraud-cohort-share ───────────────────────────────────
-- ~3% of SUPPORT-HISTORY users carry the full burst signature: 3+ rapid
-- credit purchases, then suspicious lock + unauthorized dispute within 1h.
-- The bare lock+dispute pair is NOT the detector (organic Support-funnel
-- reason collisions outnumber the hook ~4:1).
WITH locks AS (SELECT uid, epoch(t) AS ts FROM ev WHERE event = 'card locked' AND reason = 'suspicious_activity'),
disputes AS (SELECT uid, epoch(t) AS ts FROM ev WHERE event = 'dispute filed' AND reason = 'unauthorized'),
txns AS (SELECT uid, epoch(t) AS ts FROM ev WHERE event = 'transaction completed' AND transaction_type = 'purchase' AND payment_method = 'credit'),
burst_locks AS (
  SELECT l.uid, l.ts FROM locks l JOIN txns x ON x.uid = l.uid AND x.ts BETWEEN l.ts - 3900 AND l.ts
  GROUP BY 1, 2 HAVING count(*) >= 3
),
sig AS (SELECT DISTINCT b.uid FROM burst_locks b JOIN disputes d ON d.uid = b.uid AND d.ts - b.ts BETWEEN 0 AND 3600),
hist AS (SELECT count(*) AS n FROM (
  SELECT uid FROM ev WHERE event = 'card locked' GROUP BY 1
  INTERSECT
  SELECT uid FROM ev WHERE event = 'dispute filed' GROUP BY 1
))
SELECT (SELECT count(*) FROM sig) AS fraud_users,
       (SELECT n FROM hist) AS support_history_users,
       round((SELECT count(*) FROM sig)::DOUBLE / (SELECT n FROM hist), 4) AS fraction;


-- ── H4-lowbal-churn-suppression ─────────────────────────────
-- 3+ balance checks under $8K → post-d30/pre-d30 event ratio ~ 0.5x healthy
WITH low AS (
  SELECT uid, count(*) FILTER (WHERE event = 'balance checked' AND account_balance < 8000) AS low_checks
  FROM ev GROUP BY 1
),
cutoff AS (SELECT min(t) + INTERVAL 30 DAY AS c FROM ev)
SELECT CASE WHEN l.low_checks >= 3 THEN 'lowbal' ELSE 'healthy' END AS cohort,
       count(DISTINCT e.uid) AS users,
       round((count(*) FILTER (WHERE e.t >= (SELECT c FROM cutoff)))::DOUBLE
             / nullif(count(*) FILTER (WHERE e.t < (SELECT c FROM cutoff)), 0), 2) AS post_pre
FROM ev e JOIN low l USING (uid) GROUP BY 1 ORDER BY 1;


-- ── H5-budget-discipline ────────────────────────────────────
-- disciplined budgeters (3+ budgets, ~77% of users): 2x savings
-- contributions, 1.5x investment amounts vs light budgeters (0-2, ~14%)
WITH cohort AS (SELECT uid, count(*) FILTER (WHERE event = 'budget created') >= 3 AS disciplined FROM ev GROUP BY 1)
SELECT CASE WHEN c.disciplined THEN 'disciplined' ELSE 'light' END AS cohort, count(*) AS n,
       round(avg(e.monthly_contribution), 0) AS avg_contribution
FROM ev e JOIN cohort c USING (uid)
WHERE e.event = 'savings goal set' AND e.monthly_contribution IS NOT NULL
GROUP BY 1 ORDER BY 1;

WITH cohort AS (SELECT uid, count(*) FILTER (WHERE event = 'budget created') >= 3 AS disciplined FROM ev GROUP BY 1)
SELECT CASE WHEN c.disciplined THEN 'disciplined' ELSE 'light' END AS cohort, count(*) AS n,
       round(avg(e.amount), 0) AS avg_amount
FROM ev e JOIN cohort c USING (uid)
WHERE e.event = 'investment made' AND e.amount IS NOT NULL
GROUP BY 1 ORDER BY 1;


-- ── H6-autopay-missed-share ─────────────────────────────────
-- missed/paid ~ 0.22 (60% manual x 30% missed → 0.18/0.82); missed rows are
-- always auto_pay = false
SELECT event, auto_pay, count(*) AS n
FROM ev WHERE event IN ('bill paid', 'bill payment missed')
GROUP BY 1, 2 ORDER BY 1, 2;


-- ── H7-premium-tier-value ───────────────────────────────────
-- premium 3x reward value, plus 1.5x; premium 2x investment-sell amount
SELECT account_tier, count(*) AS redemptions, round(avg("value"), 1) AS avg_value
FROM ev WHERE event = 'reward redeemed' GROUP BY 1 ORDER BY avg_value DESC;

SELECT account_tier, count(*) AS sells, round(avg(amount), 0) AS avg_amount
FROM ev WHERE event = 'investment made' AND action = 'sell'
GROUP BY 1 ORDER BY avg_amount DESC;


-- ── H8-month-end-anxiety ────────────────────────────────────
-- days >= 28: session durations 1.4x, reported balances 0.7x
SELECT CASE WHEN EXTRACT(DAY FROM t) >= 28 THEN 'monthEnd' ELSE 'other' END AS bucket,
       round(avg(session_duration_sec), 0) AS avg_session_sec, count(*) AS sessions
FROM ev WHERE event = 'app session' GROUP BY 1 ORDER BY 1;

SELECT CASE WHEN EXTRACT(DAY FROM t) >= 28 THEN 'monthEnd' ELSE 'other' END AS bucket,
       round(avg(account_balance), 0) AS avg_balance, count(*) AS checks
FROM ev WHERE event = 'balance checked' GROUP BY 1 ORDER BY 1;


-- ── H9-onboarding-ttc-by-tier ───────────────────────────────
-- cross-event MIN→MIN TTC (account opened → first balance checked after it):
-- MEDIAN basic ~ 2x premium (factors 1.33 vs 0.67), plus between. Median,
-- not avg — TTC is heavy-tailed and a single multi-day straggler dominates
-- the mean of these small cohorts (only born-in users have "account opened").
WITH ao AS (SELECT uid, min(t) AS t0 FROM ev WHERE event = 'account opened' GROUP BY 1),
bc AS (
  SELECT e.uid, min(e.t) AS t1
  FROM ev e JOIN ao ON e.uid = ao.uid AND e.t >= ao.t0
  WHERE e.event = 'balance checked' GROUP BY 1
)
SELECT u.account_tier, count(*) AS converters,
       round(median(epoch(t1 - t0)) / 60, 1) AS median_ttc_min,
       round(avg(epoch(t1 - t0)) / 60, 1) AS avg_ttc_min
FROM ao JOIN bc USING (uid) JOIN users u ON u.distinct_id = ao.uid
GROUP BY 1 ORDER BY median_ttc_min DESC;


-- ── H10-txn-magic-number ────────────────────────────────────
-- sweet band (12-19 txns, measured: median 12 / p75 17 / p90 20) invests
-- 1.4x the 1-11 band; over band (20+) has 0.8x the premium-upgrade share of
-- NON-TXN events (raw per-user counts RISE with activity, and the over band
-- is selected for high txn counts — normalizing by non-txn events removes
-- both distortions)
WITH txn AS (SELECT uid, count(*) AS n FROM ev WHERE event = 'transaction completed' GROUP BY 1),
bands AS (SELECT uid, CASE WHEN n BETWEEN 12 AND 19 THEN 'sweet' WHEN n < 12 THEN 'low' ELSE 'over' END AS band FROM txn)
SELECT b.band, count(DISTINCT e.uid) AS users, round(avg(e.amount), 0) AS avg_invest_amount
FROM ev e JOIN bands b USING (uid)
WHERE e.event = 'investment made' AND e.amount IS NOT NULL
GROUP BY 1 ORDER BY 1;

WITH txn AS (SELECT uid, count(*) AS n FROM ev WHERE event = 'transaction completed' GROUP BY 1),
bands AS (SELECT uid, CASE WHEN n BETWEEN 12 AND 19 THEN 'sweet' WHEN n < 12 THEN 'low' ELSE 'over' END AS band FROM txn)
SELECT b.band, count(DISTINCT e.uid) AS users,
       round((count(*) FILTER (WHERE e.event = 'premium upgraded'))::DOUBLE
             / (count(*) FILTER (WHERE e.event != 'transaction completed')), 5) AS upgrade_share
FROM ev e JOIN bands b USING (uid) GROUP BY 1 ORDER BY 1;
