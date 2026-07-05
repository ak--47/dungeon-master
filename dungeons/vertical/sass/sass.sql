-- ============================================================
-- sass.js — hook inspection queries (v1.6.0 stories rebuild)
--
-- The verification CONTRACT lives in the `stories` export of
-- sass.js (run via sass.verify.mjs). These queries are for
-- manual inspection of the same reads.
--
-- Derivation notes (measured at 2K reduced scale + organic
-- counterfactual run — same seed, identity hook):
--   - Doc-view buckets correlate with overall activity; deploys
--     must be read as a rate over other events (H5/H10). The
--     organic over/low activity curve is ~1.18x.
--   - The churn cutoff for behavioral reads is 2026-02-04
--     (day 34): H5 deploy clones spawn at lastEvent + 1-48h
--     AFTER the churn splice, reaching ~day 33 at most.
--   - H9's funnel TTC leg is NOT visible to cross-event SQL
--     (funnel-post scales gaps within funnel instances); use
--     the emulator via sass.verify.mjs. Property legs below
--     carry the full 0.67/1.5 factors.
--   - H11 must be read per-instance ($experiment_started
--     anchors), not per-user; engine column casing is
--     "Experiment name" / "Variant name".
--
-- Replace data/verify-sass with your run prefix.
-- ============================================================

-- H1a: plan_upgraded share of billing events, EOQ window (days 100-110) vs rest
-- Expected: upgrades/day ~3.95x; in-window share ~0.45 vs baseline ~0.11
SELECT (time::TIMESTAMP >= TIMESTAMP '2026-04-11 00:00:00' AND time::TIMESTAMP <= TIMESTAMP '2026-04-21 00:00:00') AS eoq,
  COUNT(*) AS n,
  COUNT(*) FILTER (WHERE event_type = 'plan_upgraded') AS upgrades,
  ROUND(AVG((event_type = 'plan_upgraded')::INT), 4) AS upgrade_share
FROM read_json_auto('data/verify-sass-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event = 'billing event' GROUP BY 1 ORDER BY 1;

-- H1b: team invites per day, EOQ window vs rest — expected ~1.55x
SELECT (time::TIMESTAMP >= TIMESTAMP '2026-04-11 00:00:00' AND time::TIMESTAMP <= TIMESTAMP '2026-04-21 00:00:00') AS eoq,
  COUNT(*) AS n,
  ROUND(COUNT(*)::DOUBLE / (CASE WHEN (time::TIMESTAMP >= TIMESTAMP '2026-04-11 00:00:00' AND time::TIMESTAMP <= TIMESTAMP '2026-04-21 00:00:00') THEN 10.0 ELSE 111.0 END), 2) AS per_day
FROM read_json_auto('data/verify-sass-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event = 'team member invited' GROUP BY 1 ORDER BY 1;

-- H2: charCode-hash churn cohort vs behavioral silence (< 2026-02-04)
-- Expected: hash-true silent 1.00, hash-false ~0, cohort ~19% of event-users
WITH ue AS (
  SELECT user_id::VARCHAR AS uid, MAX(time::TIMESTAMP) AS last_t
  FROM read_json_auto('data/verify-sass-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE user_id IS NOT NULL GROUP BY 1
)
SELECT (list_sum([ascii(x) for x in string_split(uid, '')]) % 5 = 0) AS churn_hash,
  COUNT(*) AS users,
  ROUND(AVG((last_t < TIMESTAMP '2026-02-04 00:00:00')::INT), 4) AS silent_share
FROM ue GROUP BY 1 ORDER BY 1;

-- H2: zero-event profiles (churn-hashed users born after day 30) — expected ~2.4%
SELECT (SELECT COUNT(*) FROM read_json_auto('data/verify-sass-USERS*.json', sample_size=-1, union_by_name=true)) AS profiles,
  (SELECT COUNT(DISTINCT user_id::VARCHAR) FROM read_json_auto('data/verify-sass-EVENTS*.json', sample_size=-1, union_by_name=true) WHERE user_id IS NOT NULL) AS event_users;

-- H3: escalated (alert_id set) vs organic incidents vs remaining crit/emerg alerts
-- Expected: esc / (esc + remaining crit) = 0.30; esc share of incidents ~0.45
SELECT
  COUNT(*) FILTER (WHERE event = 'incident created' AND alert_id IS NOT NULL) AS esc,
  COUNT(*) FILTER (WHERE event = 'incident created' AND alert_id IS NULL) AS organic,
  COUNT(*) FILTER (WHERE event = 'alert triggered' AND severity IN ('critical', 'emergency')) AS crit
FROM read_json_auto('data/verify-sass-EVENTS*.json', sample_size=-1, union_by_name=true);

-- H4: response/resolution by slack+pagerduty cohort — expected ratios ~0.39 / ~0.50
WITH integ AS (
  SELECT user_id::VARCHAR AS uid,
    BOOL_OR(event = 'integration configured' AND integration_type = 'slack') AS s,
    BOOL_OR(event = 'integration configured' AND integration_type = 'pagerduty') AS p
  FROM read_json_auto('data/verify-sass-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE user_id IS NOT NULL GROUP BY 1
)
SELECT (s AND p) AS both_integ, COUNT(DISTINCT e.user_id::VARCHAR) AS users,
  ROUND(AVG(response_time_mins) FILTER (WHERE event = 'alert acknowledged'), 2) AS avg_resp,
  ROUND(AVG(resolution_time_mins) FILTER (WHERE event = 'alert resolved'), 2) AS avg_reso
FROM read_json_auto('data/verify-sass-EVENTS*.json', sample_size=-1, union_by_name=true) e
JOIN integ i ON e.user_id::VARCHAR = i.uid GROUP BY 1 ORDER BY 1;

-- H5/H10: deploys-per-other-event by doc-view bucket, non-churned users only
-- Expected: sweet/low ~1.26; over/low ~0.89; over/sweet ~0.70
WITH pu AS (
  SELECT user_id::VARCHAR AS uid,
    COUNT(*) FILTER (WHERE event = 'documentation viewed') AS docs,
    COUNT(*) FILTER (WHERE event = 'service deployed') AS deploys,
    COUNT(*) FILTER (WHERE event NOT IN ('service deployed', 'documentation viewed')) AS other,
    MAX(time::TIMESTAMP) AS last_t
  FROM read_json_auto('data/verify-sass-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE user_id IS NOT NULL GROUP BY 1
)
SELECT CASE WHEN docs >= 8 THEN 'over' WHEN docs >= 4 THEN 'sweet' ELSE 'low' END AS bucket,
  COUNT(*) AS users, ROUND(AVG(docs), 2) AS avg_docs,
  ROUND(SUM(deploys)::DOUBLE / SUM(other), 5) AS deploys_per_other
FROM pu WHERE last_t >= TIMESTAMP '2026-02-04 00:00:00'
GROUP BY 1 ORDER BY 1;

-- H6: scale-direction by armed state (last >25% cost spike newer than last scale)
-- Expected: armed down-share ~0.90 vs unarmed ~0.27 (baseline array is 3 up / 1 down)
WITH seq AS (
  SELECT user_id::VARCHAR AS uid, time::TIMESTAMP AS t, event, cost_change_percent, scale_direction
  FROM read_json_auto('data/verify-sass-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event IN ('cost report generated', 'infrastructure scaled') AND user_id IS NOT NULL
), marked AS (
  SELECT *,
    MAX(CASE WHEN event = 'cost report generated' AND cost_change_percent > 25 THEN t END)
      OVER (PARTITION BY uid ORDER BY t ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS last_spike,
    MAX(CASE WHEN event = 'infrastructure scaled' THEN t END)
      OVER (PARTITION BY uid ORDER BY t ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS last_infra
  FROM seq
)
SELECT (last_spike IS NOT NULL AND (last_infra IS NULL OR last_spike > last_infra)) AS armed,
  COUNT(*) AS n, ROUND(AVG((scale_direction = 'down')::INT), 4) AS down_share
FROM marked WHERE event = 'infrastructure scaled' GROUP BY 1 ORDER BY 1;

-- H7: recovery-run duration vs other success runs (first runs excluded) — expected ~1.52x
WITH p AS (
  SELECT user_id::VARCHAR AS uid, status, duration_sec,
    LAG(status) OVER (PARTITION BY user_id::VARCHAR ORDER BY time) AS prev
  FROM read_json_auto('data/verify-sass-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event = 'deployment pipeline run' AND user_id IS NOT NULL
)
SELECT (prev = 'failed') AS recovery, COUNT(*) AS n, ROUND(AVG(duration_sec), 1) AS avg_dur
FROM p WHERE status = 'success' AND prev IS NOT NULL GROUP BY 1 ORDER BY 1;

-- H8: profile economics by company_size — expected ACV ~273K/31K/7.8K/1.8K, csm enterprise-only
SELECT company_size, COUNT(*) AS users, ROUND(AVG(annual_contract_value), 0) AS acv,
  ROUND(AVG(seat_count), 1) AS seats, ROUND(AVG(customer_success_manager::INT), 3) AS csm
FROM read_json_auto('data/verify-sass-USERS*.json', sample_size=-1, union_by_name=true)
GROUP BY 1 ORDER BY acv DESC;

-- H9 (property legs): response/resolution by company_size
-- Expected vs smb/mid avg: enterprise ~0.65, startup ~1.50 (full factors)
SELECT u.company_size,
  COUNT(*) FILTER (WHERE event = 'alert acknowledged') AS n_ack,
  ROUND(AVG(response_time_mins) FILTER (WHERE event = 'alert acknowledged'), 2) AS resp,
  ROUND(AVG(resolution_time_mins) FILTER (WHERE event = 'alert resolved'), 2) AS reso
FROM read_json_auto('data/verify-sass-EVENTS*.json', sample_size=-1, union_by_name=true) e
JOIN read_json_auto('data/verify-sass-USERS*.json', sample_size=-1, union_by_name=true) u
  ON e.user_id::VARCHAR = u.distinct_id::VARCHAR
GROUP BY 1 ORDER BY resp;

-- H11: per-instance experiment read (greedy min-chain within 24h of each anchor)
-- Expected: canary/control conversion lift ~1.21, median TTC ratio ~0.81
WITH exp AS (
  SELECT user_id::VARCHAR AS uid, time::TIMESTAMP AS t0, "Variant name" AS variant
  FROM read_json_auto('data/verify-sass-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event = '$experiment_started'
), ev2 AS (
  SELECT user_id::VARCHAR AS uid, event, time::TIMESTAMP AS t
  FROM read_json_auto('data/verify-sass-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event IN ('deployment pipeline run', 'service deployed', 'dashboard viewed')
), c1 AS (
  SELECT x.uid, x.variant, x.t0,
    (SELECT MIN(t) FROM ev2 e WHERE e.uid = x.uid AND e.event = 'deployment pipeline run' AND e.t >= x.t0) AS tp
  FROM exp x
), c2 AS (
  SELECT c.*, (SELECT MIN(t) FROM ev2 e WHERE e.uid = c.uid AND e.event = 'service deployed' AND e.t >= c.tp) AS td
  FROM c1 c
), c3 AS (
  SELECT c.*, (SELECT MIN(t) FROM ev2 e WHERE e.uid = c.uid AND e.event = 'dashboard viewed' AND e.t >= c.td) AS tb
  FROM c2 c
)
SELECT variant, COUNT(*) AS attempts, COUNT(DISTINCT uid) AS users,
  ROUND(AVG((tb IS NOT NULL AND tb <= t0 + INTERVAL 24 HOUR)::INT), 4) AS conv_rate,
  median(CASE WHEN tb IS NOT NULL AND tb <= t0 + INTERVAL 24 HOUR THEN date_diff('minute', tp, tb) END) AS med_ttc_min
FROM c3 GROUP BY 1 ORDER BY 1;

-- Identity invariants — expected uid_share 1.0, device_share >= 0.99, devices/user ~2
SELECT ROUND(AVG((user_id IS NOT NULL)::INT), 4) AS uid_share,
  ROUND(AVG((device_id IS NOT NULL)::INT), 4) AS device_share,
  ROUND(COUNT(DISTINCT device_id)::DOUBLE / COUNT(DISTINCT user_id), 2) AS devices_per_user
FROM read_json_auto('data/verify-sass-EVENTS*.json', sample_size=-1, union_by_name=true);
