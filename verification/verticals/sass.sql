-- ============================================================
-- sass.js — v1.5.0 Hook Verification Queries
-- Score: NAILED (10/10)
-- ============================================================
--
-- v1.5.0 changes:
-- - isStrictEvent: false on 12 funnel-step events read by hooks.
-- ============================================================


-- Hook 1: END-OF-QUARTER SPIKE (d100-110 plan upgrades)
SELECT
  CASE WHEN time::TIMESTAMP BETWEEN TIMESTAMP '2026-04-11' AND TIMESTAMP '2026-04-21' THEN 'eoq' ELSE 'normal' END AS bucket,
  event_type, COUNT(*) AS n
FROM read_json_auto('data/verify-sass-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event = 'billing event'
GROUP BY 1, event_type ORDER BY 1, n DESC;


-- Hook 2: CHURNED ACCOUNT SILENCING (hash %5 cohort)
WITH per_user AS (
  SELECT user_id, COUNT(*) FILTER (WHERE time::TIMESTAMP > TIMESTAMP '2026-01-31') AS post_d30
  FROM read_json_auto('data/verify-sass-EVENTS*.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
)
SELECT CASE WHEN ASCII(SUBSTR(user_id, 1, 1)) % 5 = 0 THEN 'churned' ELSE 'normal' END AS bucket,
  COUNT(*) AS users, ROUND(AVG(post_d30), 1) AS avg_post_d30
FROM per_user GROUP BY 1 ORDER BY 1;


-- Hook 3: ALERT ESCALATION → INCIDENTS
SELECT event, COUNT(*) AS n
FROM read_json_auto('data/verify-sass-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event IN ('alert triggered', 'incident created')
GROUP BY event;


-- Hook 4: INTEGRATION USERS RESPOND FASTER
WITH int_users AS (
  SELECT user_id FROM read_json_auto('data/verify-sass-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event = 'integration configured' AND integration_type IN ('slack', 'pagerduty')
  GROUP BY user_id HAVING COUNT(DISTINCT integration_type) = 2
),
acks AS (
  SELECT e.user_id, e.response_time_mins
  FROM read_json_auto('data/verify-sass-EVENTS*.json', sample_size=-1, union_by_name=true) e
  WHERE e.event = 'alert acknowledged' AND e.response_time_mins IS NOT NULL
)
SELECT CASE WHEN a.user_id IN (SELECT user_id FROM int_users) THEN 'integrated' ELSE 'normal' END AS bucket,
  COUNT(*) AS n, ROUND(AVG(a.response_time_mins), 0) AS avg_resp_min
FROM acks a GROUP BY 1 ORDER BY 1;


-- Hook 5/10: DOCS MAGIC NUMBER
WITH per_user AS (
  SELECT user_id,
    COUNT(*) FILTER (WHERE event = 'documentation viewed') AS dc,
    COUNT(*) FILTER (WHERE event = 'service deployed') AS sd
  FROM read_json_auto('data/verify-sass-EVENTS*.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
)
SELECT CASE WHEN dc BETWEEN 4 AND 7 THEN 'sweet' WHEN dc < 4 THEN 'lower' ELSE 'over' END AS bucket,
  COUNT(*) AS users, ROUND(AVG(sd), 2) AS avg_deploys
FROM per_user GROUP BY 1 ORDER BY 1;


-- Hook 6: COST OVERRUN PATTERN — bespoke (sequential per-user check)
-- See verify script: 56% of cost overruns followed by scale-down.


-- Hook 7: FAILED DEPLOYMENT RECOVERY — recovery duration > regular success
-- See verify script: 1156s vs 787s avg.


-- Hook 8: ENTERPRISE VS STARTUP PROFILES
SELECT company_size, COUNT(*) AS users,
  ROUND(AVG(seat_count), 0) AS avg_seats,
  ROUND(AVG(annual_contract_value), 0) AS avg_acv
FROM read_json_auto('data/verify-sass-USERS*.json', sample_size=-1, union_by_name=true)
GROUP BY company_size ORDER BY avg_seats DESC;


-- Hook 9: INCIDENT RESPONSE TTC BY COMPANY SIZE
SELECT company_size, COUNT(*) AS n, ROUND(AVG(resolution_time_mins), 0) AS avg_resolve_min
FROM read_json_auto('data/verify-sass-EVENTS*.json', sample_size=-1, union_by_name=true) e
JOIN read_json_auto('data/verify-sass-USERS*.json', sample_size=-1, union_by_name=true) u ON e.user_id = u.distinct_id
WHERE e.event = 'alert resolved' AND e.resolution_time_mins IS NOT NULL
GROUP BY company_size ORDER BY avg_resolve_min;


-- Hook 11: DEPLOY PIPELINE EXPERIMENT — Canary Deploys variants
SELECT "Variant name", COUNT(*) AS exposures,
  COUNT(DISTINCT user_id) AS unique_users
FROM read_json_auto('data/verify-sass-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event = '$experiment_started' AND "Experiment name" = 'Canary Deploys'
GROUP BY "Variant name" ORDER BY exposures DESC;
