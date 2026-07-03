-- ============================================================
-- crypto.js — v1.5.0 Hook Verification Queries
-- Score: NAILED (11/11 verified — all hooks land first try)
-- ============================================================
--
-- v1.5.0 changes:
-- - isStrictEvent: false on 5 funnel-step events read by hooks
--   (wallet connected, kyc completed, deposit, swap, withdrawal).
-- ============================================================


-- Hook 1: WHALE WALLETS — top 2% drive most volume
WITH per_user AS (
  SELECT user_id,
    SUM(trade_amount_usd) AS total_vol,
    AVG(trade_amount_usd) AS avg_amt
  FROM read_json_auto('data/verify-crypto-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event = 'swap' AND trade_amount_usd IS NOT NULL
  GROUP BY user_id
),
ranked AS (
  SELECT *, NTILE(50) OVER (ORDER BY total_vol DESC) AS bucket FROM per_user
)
SELECT CASE WHEN bucket = 1 THEN 'top_2pct' ELSE 'rest' END AS segment,
  COUNT(*) AS users, ROUND(AVG(avg_amt), 0) AS avg_trade,
  ROUND(SUM(total_vol), 0) AS total_vol
FROM ranked GROUP BY 1 ORDER BY 1;


-- Hook 2: GAS SPIKE — days 35-37 see avg gas + failure rate spike
SELECT
  DATE_TRUNC('day', time::TIMESTAMP) AS day,
  COUNT(*) AS swaps,
  ROUND(AVG(gas_fee_usd), 2) AS avg_gas,
  ROUND(100.0 * COUNT(*) FILTER (WHERE swap_status = 'failed') / COUNT(*), 1) AS pct_failed
FROM read_json_auto('data/verify-crypto-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event = 'swap'
  AND time::TIMESTAMP BETWEEN TIMESTAMP '2026-02-01' AND TIMESTAMP '2026-02-10'
GROUP BY 1 ORDER BY 1;


-- Hook 3: MOON TOKEN SURGE post-d50
SELECT
  CASE WHEN time::TIMESTAMP < TIMESTAMP '2026-02-20' THEN 'pre_d50' ELSE 'post_d50' END AS bucket,
  COUNT(*) FILTER (WHERE token_pair LIKE '%MOON%') AS moon_swaps,
  COUNT(*) AS total_swaps
FROM read_json_auto('data/verify-crypto-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event = 'swap'
GROUP BY 1 ORDER BY 1;


-- Hook 4: AIRDROP BOTS — claim airdrop users with low total event count
WITH per_user AS (
  SELECT user_id,
    BOOL_OR(event = 'claim airdrop') AS has_claim,
    COUNT(*) AS total_events
  FROM read_json_auto('data/verify-crypto-EVENTS*.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
)
SELECT CASE WHEN total_events < 10 THEN 'low_engagement' ELSE 'normal' END AS bucket,
  COUNT(*) AS users
FROM per_user
WHERE has_claim
GROUP BY 1 ORDER BY 1;


-- Hook 5: KYC FUNNEL — post-KYC deposit amounts dominate
WITH kyc_users AS (
  SELECT user_id, MIN(time::TIMESTAMP) AS kyc_time
  FROM read_json_auto('data/verify-crypto-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event = 'kyc completed'
  GROUP BY user_id
),
deposits AS (
  SELECT e.user_id, e.deposit_amount_usd,
    CASE WHEN k.kyc_time IS NULL THEN 'no_kyc'
         WHEN e.time::TIMESTAMP > k.kyc_time THEN 'post_kyc'
         ELSE 'pre_kyc' END AS bucket
  FROM read_json_auto('data/verify-crypto-EVENTS*.json', sample_size=-1, union_by_name=true) e
  LEFT JOIN kyc_users k USING (user_id)
  WHERE e.event = 'deposit' AND e.deposit_amount_usd IS NOT NULL
)
SELECT bucket, COUNT(*) AS deposits, ROUND(AVG(deposit_amount_usd), 0) AS avg_deposit
FROM deposits GROUP BY 1 ORDER BY 1;


-- Hook 6: STAKE-TO-RETAIN — early stakers retain better post-d60
WITH classify AS (
  SELECT user_id,
    BOOL_OR(event = 'stake' AND time::TIMESTAMP < TIMESTAMP '2026-01-15') AS early_staker,
    COUNT(*) FILTER (WHERE time::TIMESTAMP > TIMESTAMP '2026-03-02') AS post60_events
  FROM read_json_auto('data/verify-crypto-EVENTS*.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
)
SELECT CASE WHEN early_staker THEN 'staker' ELSE 'non' END AS bucket,
  COUNT(*) AS users, ROUND(AVG(post60_events), 1) AS avg_post60_events
FROM classify GROUP BY 1 ORDER BY 1;


-- Hook 7: PRO TIER FEES — Pro maker_fee_pct should be ~0.05 vs Std ~0.30
SELECT u.trading_tier,
  COUNT(*) AS swaps,
  ROUND(AVG(e.maker_fee_pct), 4) AS avg_maker_fee
FROM read_json_auto('data/verify-crypto-EVENTS*.json', sample_size=-1, union_by_name=true) e
JOIN read_json_auto('data/verify-crypto-USERS*.json', sample_size=-1, union_by_name=true) u
  ON e.user_id = u.distinct_id
WHERE e.event = 'swap' AND e.maker_fee_pct IS NOT NULL
GROUP BY u.trading_tier ORDER BY u.trading_tier;


-- Hook 8: RUG-PULL AFTERMATH — SCAM holders' post/pre ratio dive
WITH classify AS (
  SELECT user_id,
    BOOL_OR(event = 'swap' AND token_pair LIKE '%SCAM%') AS had_scam,
    COUNT(*) FILTER (WHERE time::TIMESTAMP <= TIMESTAMP '2026-03-12') AS pre,
    COUNT(*) FILTER (WHERE time::TIMESTAMP > TIMESTAMP '2026-03-12') AS post
  FROM read_json_auto('data/verify-crypto-EVENTS*.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
)
SELECT CASE WHEN had_scam THEN 'scam' ELSE 'non' END AS bucket,
  COUNT(*) AS users, ROUND(AVG(post::DOUBLE / NULLIF(pre, 0)), 3) AS avg_post_pre_ratio
FROM classify WHERE pre >= 5 GROUP BY 1 ORDER BY 1;


-- Hook 10: SWAP-COUNT MAGIC NUMBER — sweet 8-20 stake amount lift
WITH classify AS (
  SELECT user_id,
    COUNT(*) FILTER (WHERE event = 'swap') AS swap_count
  FROM read_json_auto('data/verify-crypto-EVENTS*.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
),
joined AS (
  SELECT e.user_id, e.amount_usd,
    CASE WHEN c.swap_count BETWEEN 8 AND 20 THEN 'sweet'
         WHEN c.swap_count < 8 THEN 'baseline'
         ELSE 'heavy' END AS bucket
  FROM read_json_auto('data/verify-crypto-EVENTS*.json', sample_size=-1, union_by_name=true) e
  JOIN classify c USING (user_id)
  WHERE e.event = 'stake' AND e.amount_usd IS NOT NULL
)
SELECT bucket, COUNT(*) AS stakes, ROUND(AVG(amount_usd), 0) AS avg_stake
FROM joined GROUP BY 1 ORDER BY 1;


-- Hook 11: EARLY-STAKER RETENTION — born-in-dataset users with 2+ stakes in first 10d retain
WITH first_event AS (
  SELECT user_id, MIN(time::TIMESTAMP) AS first_time
  FROM read_json_auto('data/verify-crypto-EVENTS*.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
),
classify AS (
  SELECT e.user_id,
    SUM(CASE WHEN e.event = 'stake' AND e.time::TIMESTAMP <= f.first_time + INTERVAL 10 DAY THEN 1 ELSE 0 END) AS early_stake_count,
    COUNT(*) FILTER (WHERE e.time::TIMESTAMP > f.first_time + INTERVAL 40 DAY) AS post40_events
  FROM read_json_auto('data/verify-crypto-EVENTS*.json', sample_size=-1, union_by_name=true) e
  JOIN first_event f USING (user_id)
  GROUP BY e.user_id
)
SELECT CASE WHEN early_stake_count >= 2 THEN 'early_staker' ELSE 'late' END AS bucket,
  COUNT(*) AS users, ROUND(AVG(post40_events), 1) AS avg_post40_events
FROM classify GROUP BY 1 ORDER BY 1;


-- Hook 9: TIME-TO-CONVERT BY TIER — deposit → withdrawal
WITH deps AS (
  SELECT user_id, MIN(time::TIMESTAMP) AS dep_time
  FROM read_json_auto('data/verify-crypto-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event = 'deposit'
  GROUP BY user_id
),
wds AS (
  SELECT user_id, MIN(time::TIMESTAMP) AS wd_time
  FROM read_json_auto('data/verify-crypto-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event = 'withdrawal'
  GROUP BY user_id
)
SELECT u.trading_tier,
  COUNT(*) AS converters,
  ROUND(MEDIAN(EXTRACT(EPOCH FROM (wd_time - dep_time)) / 3600), 1) AS median_ttc_hours
FROM deps d JOIN wds w USING (user_id)
JOIN read_json_auto('data/verify-crypto-USERS*.json', sample_size=-1, union_by_name=true) u
  ON d.user_id = u.distinct_id
WHERE wd_time > dep_time
GROUP BY u.trading_tier ORDER BY u.trading_tier;
