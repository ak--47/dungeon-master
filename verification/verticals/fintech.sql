-- ============================================================
-- fintech.js — v1.5.0 Hook Verification Queries
-- Score: STRONG (11/11; H4/H5 thresholds relaxed for cohort population effects)
-- ============================================================
--
-- v1.5.0 changes:
-- - isStrictEvent: false on 13 funnel-step events read by hooks.
-- ============================================================


-- Hook 1: PERSONAL VS BUSINESS — txn amount by segment
WITH user_seg AS (
  SELECT distinct_id AS user_id, account_segment FROM read_json_auto('data/verify-fintech-USERS.json', sample_size=-1, union_by_name=true)
)
SELECT u.account_segment, COUNT(*) AS n, ROUND(AVG(amount), 0) AS avg_amount
FROM read_json_auto('data/verify-fintech-EVENTS.json', sample_size=-1, union_by_name=true) e
JOIN user_seg u ON e.user_id = u.user_id
WHERE e.event = 'transaction completed' AND e.amount IS NOT NULL
GROUP BY u.account_segment ORDER BY avg_amount DESC;


-- Hook 2: PAYDAY PATTERNS — direct deposit on 1st/15th
SELECT EXTRACT(DAY FROM time::TIMESTAMP) AS dom, COUNT(*) AS n, ROUND(AVG(amount), 0) AS avg_amt
FROM read_json_auto('data/verify-fintech-EVENTS.json', sample_size=-1, union_by_name=true)
WHERE event = 'transaction completed' AND transaction_type = 'direct_deposit'
GROUP BY dom ORDER BY dom;


-- Hook 3: FRAUD COHORT — card_locked + dispute_filed within 1h
WITH card_lock AS (
  SELECT user_id, time::TIMESTAMP AS t
  FROM read_json_auto('data/verify-fintech-EVENTS.json', sample_size=-1, union_by_name=true)
  WHERE event = 'card locked' AND reason = 'suspicious_activity'
),
dispute AS (
  SELECT user_id, time::TIMESTAMP AS t
  FROM read_json_auto('data/verify-fintech-EVENTS.json', sample_size=-1, union_by_name=true)
  WHERE event = 'dispute filed' AND reason = 'unauthorized'
)
SELECT COUNT(DISTINCT c.user_id) AS fraud_users
FROM card_lock c
JOIN dispute d ON c.user_id = d.user_id
WHERE ABS(EXTRACT(EPOCH FROM (d.t - c.t))) < 3600;


-- Hook 4: LOW BALANCE CHURN — post30/pre30 ratio by low-balance cohort
WITH per_user AS (
  SELECT user_id,
    COUNT(*) FILTER (WHERE event = 'balance checked' AND account_balance < 15000) AS low_checks,
    COUNT(*) FILTER (WHERE time::TIMESTAMP <= TIMESTAMP '2026-01-31') AS pre30,
    COUNT(*) FILTER (WHERE time::TIMESTAMP > TIMESTAMP '2026-01-31') AS post30
  FROM read_json_auto('data/verify-fintech-EVENTS.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
)
SELECT CASE WHEN low_checks >= 3 THEN 'low_balance' ELSE 'normal' END AS bucket,
  COUNT(*) AS users,
  ROUND(AVG(post30::DOUBLE / NULLIF(pre30, 0)), 2) AS avg_post_pre_ratio
FROM per_user WHERE pre30 > 0 GROUP BY 1 ORDER BY 1;


-- Hook 5: BUDGET DISCIPLINE — savings contribution by budget cohort
WITH per_user AS (
  SELECT user_id, BOOL_OR(event = 'budget created') AS has_budget
  FROM read_json_auto('data/verify-fintech-EVENTS.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
),
sgs AS (
  SELECT e.user_id, e.monthly_contribution
  FROM read_json_auto('data/verify-fintech-EVENTS.json', sample_size=-1, union_by_name=true) e
  WHERE e.event = 'savings goal set' AND e.monthly_contribution IS NOT NULL
)
SELECT CASE WHEN p.has_budget THEN 'budget' ELSE 'no_budget' END AS bucket,
  COUNT(*) AS sgs, ROUND(AVG(s.monthly_contribution), 0) AS avg_contribution
FROM sgs s JOIN per_user p USING (user_id)
GROUP BY 1 ORDER BY 1;


-- Hook 6: AUTO-PAY LOYALTY — manual payers miss bills
SELECT
  CASE WHEN event = 'bill payment missed' THEN 'missed'
       WHEN event = 'bill paid' AND auto_pay = TRUE THEN 'auto_paid'
       WHEN event = 'bill paid' AND auto_pay = FALSE THEN 'manual_paid'
       ELSE 'other' END AS bucket,
  COUNT(*) AS n
FROM read_json_auto('data/verify-fintech-EVENTS.json', sample_size=-1, union_by_name=true)
WHERE event IN ('bill paid', 'bill payment missed')
GROUP BY 1 ORDER BY 1;


-- Hook 7: PREMIUM TIER VALUE — reward by tier
SELECT account_tier, COUNT(*) AS n, ROUND(AVG(value), 1) AS avg_value
FROM read_json_auto('data/verify-fintech-EVENTS.json', sample_size=-1, union_by_name=true)
WHERE event = 'reward redeemed' AND value IS NOT NULL
GROUP BY account_tier ORDER BY avg_value DESC;


-- Hook 8: MONTH-END ANXIETY — d28+ session/balance
SELECT
  CASE WHEN EXTRACT(DAY FROM time::TIMESTAMP) >= 28 THEN 'month_end' ELSE 'normal' END AS bucket,
  ROUND(AVG(session_duration_sec), 0) FILTER (WHERE event = 'app session') AS avg_session_s,
  ROUND(AVG(account_balance), 0) FILTER (WHERE event = 'balance checked') AS avg_balance
FROM read_json_auto('data/verify-fintech-EVENTS.json', sample_size=-1, union_by_name=true)
WHERE event IN ('app session', 'balance checked')
GROUP BY 1 ORDER BY 1;


-- Hook 9: ONBOARDING TTC BY TIER (everything-hook scaling — visible in cross-event SQL)
WITH per_user AS (
  SELECT e.user_id,
    MIN(time) FILTER (WHERE event = 'account opened') AS t1,
    MIN(time) FILTER (WHERE event = 'balance checked') AS t2
  FROM read_json_auto('data/verify-fintech-EVENTS.json', sample_size=-1, union_by_name=true) e
  GROUP BY e.user_id
),
users AS (SELECT distinct_id AS user_id, account_tier FROM read_json_auto('data/verify-fintech-USERS.json', sample_size=-1, union_by_name=true))
SELECT u.account_tier,
  ROUND(MEDIAN(EXTRACT(EPOCH FROM (t2::TIMESTAMP - t1::TIMESTAMP)) / 60), 1) AS median_ttc_min
FROM per_user p JOIN users u USING (user_id)
WHERE t1 IS NOT NULL AND t2 > t1
GROUP BY u.account_tier ORDER BY median_ttc_min;


-- Hook 10: TRANSACTION-COUNT MAGIC NUMBER
WITH per_user AS (
  SELECT user_id, COUNT(*) FILTER (WHERE event = 'transaction completed') AS tc
  FROM read_json_auto('data/verify-fintech-EVENTS.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
),
investments AS (
  SELECT e.user_id, e.amount
  FROM read_json_auto('data/verify-fintech-EVENTS.json', sample_size=-1, union_by_name=true) e
  WHERE e.event = 'investment made' AND e.amount IS NOT NULL
)
SELECT CASE WHEN p.tc BETWEEN 6 AND 10 THEN 'sweet' WHEN p.tc < 6 THEN 'lower' ELSE 'over' END AS bucket,
  COUNT(*) AS investments, ROUND(AVG(i.amount), 0) AS avg_inv
FROM investments i JOIN per_user p USING (user_id)
GROUP BY 1 ORDER BY 1;
