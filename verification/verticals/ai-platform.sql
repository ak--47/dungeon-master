-- ============================================================
-- ai-platform.js — v1.5.0 Hook Verification Queries
-- Score: NAILED (10/10)
-- ============================================================
--
-- v1.5.0 changes:
-- - isStrictEvent: false on api call, tool use call, eval job, billing payment.
-- - H4 verification rewritten: post-week-1/pre-week-1 RATIO instead of
--   absolute volume (RL users are heavy users by definition).
-- ============================================================


-- Hook 1: PROMPT CACHING ADOPTION — cache_enabled cuts cost_usd
SELECT cache_enabled, COUNT(*) AS n, ROUND(AVG(cost_usd), 4) AS avg_cost
FROM read_json_auto('data/verify-ai-platform-EVENTS.json', sample_size=-1, union_by_name=true)
WHERE event = 'api call' AND cost_usd IS NOT NULL
GROUP BY cache_enabled ORDER BY cache_enabled;


-- Hook 2: MODEL MIGRATION — opus-4-7 emerges post-d60
SELECT
  CASE WHEN time::TIMESTAMP < TIMESTAMP '2026-03-02' THEN 'pre_d60' ELSE 'post_d60' END AS bucket,
  model, COUNT(*) AS n
FROM read_json_auto('data/verify-ai-platform-EVENTS.json', sample_size=-1, union_by_name=true)
WHERE event = 'api call' AND model = 'opus-4-7'
GROUP BY 1, model ORDER BY 1;


-- Hook 3: AGENTIC POWER USERS — 8x tokens
WITH per_user AS (
  SELECT user_id,
    COUNT(*) FILTER (WHERE event = 'tool use call') AS tu,
    COUNT(*) FILTER (WHERE event = 'api call' AND multi_turn = TRUE) AS mt
  FROM read_json_auto('data/verify-ai-platform-EVENTS.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
),
api_calls AS (
  SELECT e.user_id, e.tokens_used
  FROM read_json_auto('data/verify-ai-platform-EVENTS.json', sample_size=-1, union_by_name=true) e
  WHERE e.event = 'api call' AND e.tokens_used IS NOT NULL
)
SELECT CASE WHEN p.tu >= 3 AND p.mt >= 3 THEN 'agentic' ELSE 'normal' END AS bucket,
  COUNT(*) AS calls, ROUND(AVG(a.tokens_used), 0) AS avg_tokens
FROM api_calls a JOIN per_user p USING (user_id)
GROUP BY 1 ORDER BY 1;


-- Hook 4: RATE LIMIT CHURN — RL users post/pre ratio depressed
WITH per_user AS (
  SELECT user_id, MIN(time::TIMESTAMP) AS t0,
    COUNT(*) FILTER (WHERE event = 'rate limit error' AND time::TIMESTAMP < (SELECT MIN(time::TIMESTAMP) + INTERVAL '7 days' FROM read_json_auto('data/verify-ai-platform-EVENTS.json', sample_size=-1, union_by_name=true) e2 WHERE e2.user_id = e.user_id)) AS early_rl,
    COUNT(*) FILTER (WHERE time::TIMESTAMP <= (SELECT MIN(time::TIMESTAMP) + INTERVAL '7 days' FROM read_json_auto('data/verify-ai-platform-EVENTS.json', sample_size=-1, union_by_name=true) e2 WHERE e2.user_id = e.user_id)) AS pre,
    COUNT(*) FILTER (WHERE time::TIMESTAMP > (SELECT MIN(time::TIMESTAMP) + INTERVAL '7 days' FROM read_json_auto('data/verify-ai-platform-EVENTS.json', sample_size=-1, union_by_name=true) e2 WHERE e2.user_id = e.user_id)) AS post
  FROM read_json_auto('data/verify-ai-platform-EVENTS.json', sample_size=-1, union_by_name=true) e
  GROUP BY user_id
)
SELECT CASE WHEN early_rl >= 2 THEN 'rl' ELSE 'normal' END AS bucket,
  COUNT(*) AS users, ROUND(AVG(post::DOUBLE / NULLIF(pre, 0)), 2) AS avg_post_pre
FROM per_user WHERE pre > 0 GROUP BY 1 ORDER BY 1;


-- Hook 5: TIER-BASED CONTEXT WINDOW
SELECT api_tier, COUNT(*) AS calls, ROUND(AVG(context_window), 0) AS avg_ctx
FROM read_json_auto('data/verify-ai-platform-EVENTS.json', sample_size=-1, union_by_name=true)
WHERE event = 'api call' AND context_window IS NOT NULL
GROUP BY api_tier ORDER BY avg_ctx DESC;


-- Hook 6: OUTAGE DAY — d40-41 error rate spike
SELECT
  CASE WHEN time::TIMESTAMP BETWEEN TIMESTAMP '2026-02-10' AND TIMESTAMP '2026-02-12' THEN 'outage' ELSE 'normal' END AS bucket,
  COUNT(*) AS calls,
  ROUND(SUM(CASE WHEN is_error THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS pct_error
FROM read_json_auto('data/verify-ai-platform-EVENTS.json', sample_size=-1, union_by_name=true)
WHERE event = 'api call'
GROUP BY 1 ORDER BY 1;


-- Hook 7: BATCH API DISCOUNT
WITH per_user AS (
  SELECT user_id, BOOL_OR(event = 'batch job submitted') AS has_batch
  FROM read_json_auto('data/verify-ai-platform-EVENTS.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
),
api_calls AS (
  SELECT e.user_id, e.tokens_used
  FROM read_json_auto('data/verify-ai-platform-EVENTS.json', sample_size=-1, union_by_name=true) e
  WHERE e.event = 'api call' AND e.tokens_used IS NOT NULL
)
SELECT CASE WHEN p.has_batch THEN 'batch' ELSE 'no_batch' END AS bucket,
  COUNT(*) AS calls, ROUND(AVG(a.tokens_used), 0) AS avg_tokens
FROM api_calls a JOIN per_user p USING (user_id)
GROUP BY 1 ORDER BY 1;


-- Hook 8: EVAL-DRIVEN RETENTION
WITH per_user AS (
  SELECT user_id, MIN(time::TIMESTAMP) AS t0,
    BOOL_OR(event = 'eval job' AND time::TIMESTAMP < (SELECT MIN(time::TIMESTAMP) + INTERVAL '7 days' FROM read_json_auto('data/verify-ai-platform-EVENTS.json', sample_size=-1, union_by_name=true) e2 WHERE e2.user_id = e.user_id)) AS early_eval,
    COUNT(*) FILTER (WHERE time::TIMESTAMP > (SELECT MIN(time::TIMESTAMP) + INTERVAL '30 days' FROM read_json_auto('data/verify-ai-platform-EVENTS.json', sample_size=-1, union_by_name=true) e2 WHERE e2.user_id = e.user_id)) AS post30
  FROM read_json_auto('data/verify-ai-platform-EVENTS.json', sample_size=-1, union_by_name=true) e
  GROUP BY user_id
)
SELECT CASE WHEN early_eval THEN 'early_eval' ELSE 'no_eval' END AS bucket,
  COUNT(*) AS users, ROUND(AVG(post30), 1) AS avg_post30
FROM per_user GROUP BY 1 ORDER BY 1;


-- Hook 9: API-TO-EVAL TTC BY TIER (KNOWN MEASUREMENT GAP)
-- See dating.sql Hook 9 for the funnel-post limitation explanation.


-- Hook 10: DOCS-SEARCHED MAGIC NUMBER
WITH per_user AS (
  SELECT e.user_id,
    MIN(time) FILTER (WHERE event = 'organization created') AS t_org,
    MIN(time) FILTER (WHERE event = 'billing payment') AS t_bill
  FROM read_json_auto('data/verify-ai-platform-EVENTS.json', sample_size=-1, union_by_name=true) e
  GROUP BY e.user_id
),
docs_between AS (
  SELECT p.user_id, COUNT(*) AS docs
  FROM per_user p
  JOIN read_json_auto('data/verify-ai-platform-EVENTS.json', sample_size=-1, union_by_name=true) e USING (user_id)
  WHERE e.event = 'docs searched' AND e.time > p.t_org AND e.time < p.t_bill
  GROUP BY p.user_id
),
billings AS (
  SELECT e.user_id, e.amount_usd
  FROM read_json_auto('data/verify-ai-platform-EVENTS.json', sample_size=-1, union_by_name=true) e
  WHERE e.event = 'billing payment' AND e.amount_usd IS NOT NULL
)
SELECT
  CASE WHEN d.docs BETWEEN 2 AND 4 THEN 'sweet' WHEN d.docs IS NULL OR d.docs < 2 THEN 'lower' ELSE 'over' END AS bucket,
  COUNT(*) AS payments, ROUND(AVG(b.amount_usd), 0) AS avg_amount
FROM billings b LEFT JOIN docs_between d USING (user_id)
GROUP BY 1 ORDER BY 1;
