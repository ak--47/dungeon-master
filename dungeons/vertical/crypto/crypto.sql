-- ============================================================
-- crypto.js — v1.6.0 Hook Inspection Queries (DuckDB)
-- Score: NAILED (11/11 stories; machine contract in crypto.js `stories`)
-- Run after: node scripts/verify-runner.mjs dungeons/vertical/crypto/crypto.js verify-crypto
-- ============================================================
--
-- v1.6.0 derivation notes (2K reduced run vs organic counterfactual):
-- 1. Whale/bot cohorts are ~13-14% of users, not the 2%/4% the v1.5
--    docstring claimed — user_ids are hex uuids, so charCodeAt % 50/25
--    matches hex digits '2' and 'd' (2 of 16), not 1-in-50/25.
-- 2. All boundary days are UTC calendar days from 2026-01-01 (hooks run
--    dayjs in UTC mode; the dataset spans the 2026-03-08 US DST shift).
-- 3. H6 has a first-24h grace window: churn never erases the signup, so
--    late-born users keep their onboarding funnel + auth event.
-- 4. H8's SCAM-holder cohort is the MAJORITY of eventful users (~59%):
--    2%/swap over hundreds of swaps catches almost everyone active.
-- 5. H9 is emulator-only (funnel median TTC): funnel-post gap scaling is
--    invisible to cross-event MIN→MIN SQL. Scoped to the onboarding
--    funnel; see crypto.verify.mjs.
-- ============================================================


-- Hook 1: WHALE WALLETS — ~13% of wallets trade at 50x
-- Expect: whale/non avg trade amount ~48x; top-5% volume share ~0.75.
WITH pu AS (
  SELECT user_id::VARCHAR AS uid,
    (ascii(substr(user_id::VARCHAR, 1, 1)) % 50 = 0) AS whale,
    AVG(trade_amount_usd) AS avg_amt, SUM(trade_amount_usd) AS vol
  FROM read_json_auto('data/verify-crypto-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event = 'swap' AND user_id IS NOT NULL
  GROUP BY 1, 2
)
SELECT CASE WHEN whale THEN 'whale' ELSE 'non' END AS cohort,
  COUNT(*) AS users, ROUND(AVG(avg_amt), 0) AS avg_trade, ROUND(SUM(vol), 0) AS total_vol
FROM pu GROUP BY 1 ORDER BY 1;


-- Hook 2: GAS SPIKE — days 35-37 (2026-02-05..07 UTC), ~10x gas + fail share ~0.52
SELECT
  DATE_TRUNC('day', time::TIMESTAMP) AS day,
  COUNT(*) AS swaps,
  ROUND(AVG(gas_fee_usd), 2) AS avg_gas,
  ROUND(100.0 * COUNT(*) FILTER (WHERE swap_status = 'failed') / COUNT(*), 1) AS pct_failed
FROM read_json_auto('data/verify-crypto-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event = 'swap'
  AND time::TIMESTAMP BETWEEN TIMESTAMP '2026-02-01' AND TIMESTAMP '2026-02-12'
GROUP BY 1 ORDER BY 1;


-- Hook 3: TOKEN LAUNCH SURGE — MOON pairs: exactly 0 before day 50
-- (2026-02-20 UTC), ~58% of swaps after.
SELECT CASE WHEN time::TIMESTAMP > TIMESTAMP '2026-02-20 00:00:00' THEN 'post_d50' ELSE 'pre_d50' END AS win,
  COUNT(*) AS swaps,
  ROUND(AVG((token_pair LIKE '%MOON%')::INT), 4) AS moon_share
FROM read_json_auto('data/verify-crypto-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event = 'swap' GROUP BY 1 ORDER BY 1;


-- Hook 4: AIRDROP HUNTER CHURN — bot claimers (~14%, hash) post/pre ~1.5
-- vs non-bot claimers ~25 (contrast ~0.06).
WITH claims AS (
  SELECT user_id::VARCHAR AS uid, MIN(time::TIMESTAMP) AS t0
  FROM read_json_auto('data/verify-crypto-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event = 'claim airdrop' AND user_id IS NOT NULL GROUP BY 1
), pu AS (
  SELECT e.user_id::VARCHAR AS uid,
    (ascii(substr(e.user_id::VARCHAR, 2, 1)) % 25 = 0) AS bot,
    COUNT(*) FILTER (WHERE e.time::TIMESTAMP <= c.t0) AS pre_ev,
    COUNT(*) FILTER (WHERE e.time::TIMESTAMP > c.t0) AS post_ev
  FROM read_json_auto('data/verify-crypto-EVENTS*.json', sample_size=-1, union_by_name=true) e
  JOIN claims c ON e.user_id::VARCHAR = c.uid GROUP BY 1, 2
)
SELECT CASE WHEN bot THEN 'bot' ELSE 'non' END AS cohort, COUNT(*) AS users,
  ROUND(AVG(post_ev::DOUBLE / GREATEST(pre_ev, 1)), 3) AS post_pre_ratio
FROM pu GROUP BY 1 ORDER BY 1;


-- Hook 5: KYC COMPLETION — post-KYC deposits ~3.4x, swaps/user ~7.6x
-- (organic activity confound alone is 2.0x).
WITH kyc AS (
  SELECT user_id::VARCHAR AS uid, MIN(time::TIMESTAMP) AS kt
  FROM read_json_auto('data/verify-crypto-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event = 'kyc completed' AND user_id IS NOT NULL GROUP BY 1
), pu AS (
  SELECT e.user_id::VARCHAR AS uid, (k.uid IS NOT NULL) AS has_kyc,
    AVG(e.deposit_amount_usd) FILTER (WHERE e.event = 'deposit' AND (k.uid IS NULL OR e.time::TIMESTAMP > k.kt)) AS dep,
    COUNT(*) FILTER (WHERE e.event = 'swap') AS swaps
  FROM read_json_auto('data/verify-crypto-EVENTS*.json', sample_size=-1, union_by_name=true) e
  LEFT JOIN kyc k ON e.user_id::VARCHAR = k.uid
  WHERE e.user_id IS NOT NULL GROUP BY 1, 2
)
SELECT CASE WHEN has_kyc THEN 'kyc' ELSE 'non' END AS cohort, COUNT(*) AS users,
  ROUND(AVG(dep), 0) AS avg_deposit, ROUND(AVG(swaps), 1) AS swaps_per_user
FROM pu GROUP BY 1 ORDER BY 1;


-- Hook 6: STAKE-TO-RETAIN — first-14d stakers keep ~5.3x post-d60
-- (2026-03-02 UTC) volume. Binary retention barely moves; volume is the read.
WITH pu AS (
  SELECT user_id::VARCHAR AS uid,
    BOOL_OR(event = 'stake' AND time::TIMESTAMP < TIMESTAMP '2026-01-15 00:00:00') AS early_staker,
    COUNT(*) FILTER (WHERE time::TIMESTAMP > TIMESTAMP '2026-03-02 00:00:00') AS post60
  FROM read_json_auto('data/verify-crypto-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE user_id IS NOT NULL GROUP BY 1
)
SELECT CASE WHEN early_staker THEN 'staker' ELSE 'non' END AS cohort,
  COUNT(*) AS users, ROUND(AVG(post60), 1) AS post60_per_user,
  ROUND(AVG((post60 > 0)::INT), 3) AS active_post60_share
FROM pu GROUP BY 1 ORDER BY 1;


-- Hook 7: PRO TIER FEES — Pro 0.05 vs Standard 0.30 exact; swaps/user ~5.2x.
SELECT trading_tier, COUNT(DISTINCT user_id::VARCHAR) AS users,
  ROUND(AVG(maker_fee_pct), 4) AS avg_fee,
  ROUND(COUNT(*)::DOUBLE / COUNT(DISTINCT user_id::VARCHAR), 1) AS swaps_per_user
FROM read_json_auto('data/verify-crypto-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event = 'swap' AND user_id IS NOT NULL GROUP BY 1 ORDER BY 1;


-- Hook 8: RUG-PULL AFTERMATH — SCAM holders (~59% of eventful users)
-- post/pre-d70 (2026-03-12 UTC) ~0.21 vs ~1.25 non-holders.
WITH pu AS (
  SELECT user_id::VARCHAR AS uid,
    BOOL_OR(event = 'swap' AND token_pair LIKE '%SCAM%') AS scam,
    COUNT(*) FILTER (WHERE time::TIMESTAMP <= TIMESTAMP '2026-03-12 00:00:00') AS pre_ev,
    COUNT(*) FILTER (WHERE time::TIMESTAMP > TIMESTAMP '2026-03-12 00:00:00') AS post_ev
  FROM read_json_auto('data/verify-crypto-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE user_id IS NOT NULL GROUP BY 1
)
SELECT CASE WHEN scam THEN 'scam' ELSE 'non' END AS cohort, COUNT(*) AS users,
  ROUND(AVG(post_ev::DOUBLE / pre_ev), 3) AS post_pre_ratio
FROM pu WHERE pre_ev >= 5 GROUP BY 1 ORDER BY 1;


-- Hook 9: ONBOARDING TTC BY TIER — emulator-only read (see crypto.verify.mjs).
-- This query only shows the funnel-step populations by tier; the median
-- TTC delta (Pro/Std ~0.74 @6h window) is NOT visible in cross-event SQL —
-- funnel-post scales gaps within the funnel instance, and greedy MIN→MIN
-- queries pick unrelated instances.
SELECT trading_tier, event, COUNT(*) AS n, COUNT(DISTINCT user_id::VARCHAR) AS users
FROM read_json_auto('data/verify-crypto-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event IN ('wallet connected', 'kyc started', 'deposit') AND user_id IS NOT NULL
GROUP BY 1, 2 ORDER BY 1, 2;


-- Hook 10: SWAP-COUNT MAGIC NUMBER — sweet (8-20) stake amounts ~1.32x low;
-- over (21+) portfolio total_value_usd ~0.50x sweet. Views-per-user is NOT
-- the read (activity confound nets the 75% drop to parity).
WITH pu AS (
  SELECT user_id::VARCHAR AS uid,
    COUNT(*) FILTER (WHERE event = 'swap') AS swaps,
    AVG(amount_usd) FILTER (WHERE event = 'stake') AS stake_amt,
    AVG(total_value_usd) FILTER (WHERE event = 'portfolio viewed') AS pv_val
  FROM read_json_auto('data/verify-crypto-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE user_id IS NOT NULL GROUP BY 1
)
SELECT CASE WHEN swaps >= 21 THEN 'over' WHEN swaps >= 8 THEN 'sweet' ELSE 'low' END AS bucket,
  COUNT(*) AS users, ROUND(AVG(stake_amt), 0) AS avg_stake_amt,
  ROUND(AVG(pv_val), 0) AS avg_portfolio_value
FROM pu GROUP BY 1 ORDER BY 1;


-- Hook 11: EARLY STAKER RETENTION — born-in (has 'wallet connected') users
-- with 2+ stakes in first 10 lifetime days: post-d40 ratio ~1.31 vs the
-- INVERSE organic baseline 0.52.
WITH born AS (
  SELECT DISTINCT user_id::VARCHAR AS uid
  FROM read_json_auto('data/verify-crypto-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event = 'wallet connected' AND user_id IS NOT NULL
), firsts AS (
  SELECT user_id::VARCHAR AS uid, MIN(time::TIMESTAMP) AS t0
  FROM read_json_auto('data/verify-crypto-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE user_id IS NOT NULL GROUP BY 1
), pu AS (
  SELECT e.user_id::VARCHAR AS uid,
    COUNT(*) FILTER (WHERE e.event = 'stake' AND e.time::TIMESTAMP <= f.t0 + INTERVAL 10 DAY) AS early_stakes,
    COUNT(*) FILTER (WHERE e.time::TIMESTAMP > f.t0 + INTERVAL 40 DAY) AS post40
  FROM read_json_auto('data/verify-crypto-EVENTS*.json', sample_size=-1, union_by_name=true) e
  JOIN firsts f ON e.user_id::VARCHAR = f.uid
  JOIN born b ON e.user_id::VARCHAR = b.uid
  GROUP BY 1
)
SELECT CASE WHEN early_stakes >= 2 THEN 'early' ELSE 'non' END AS cohort,
  COUNT(*) AS users, ROUND(AVG(post40), 2) AS post40_per_user
FROM pu GROUP BY 1 ORDER BY 1;


-- Identity invariants: every event carries user_id; device coverage ~1.0;
-- devices/user ~2.06 (avgDevicePerUser: 2).
SELECT COUNT(*) AS n,
  ROUND(AVG((user_id IS NOT NULL)::INT), 4) AS uid_share,
  ROUND(AVG((device_id IS NOT NULL)::INT), 4) AS device_share,
  ROUND(COUNT(DISTINCT device_id)::DOUBLE / COUNT(DISTINCT user_id), 3) AS devices_per_user
FROM read_json_auto('data/verify-crypto-EVENTS*.json', sample_size=-1, union_by_name=true);
