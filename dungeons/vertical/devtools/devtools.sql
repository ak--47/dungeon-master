-- ============================================================
-- devtools.sql — human-eyeball inspection queries (v1.6)
-- ============================================================
-- Mirrors the story reads in devtools.js `stories`. Run after:
--   node scripts/verify-runner.mjs dungeons/vertical/devtools/devtools.js verify-devtools
--
-- Derivation notes:
-- - H1 uses MEDIAN: the extreme-value anomaly (10x build_duration_sec
--   at 0.3%) fattens means; medians isolate the clean 2x mechanism.
--   Bot events carry null build_status and fall out of status groups.
-- - H2/H9 exclude days 43-49: H6 recovery clones carry status
--   success/rolled_back only (never failed) and inflate deploy counts,
--   polluting both the failure-share and deploys-per-build reads.
-- - H3's cohort is the user_id hash (first GUID char in {2,3,4,d,e,f}),
--   NOT ai_assist — the copilot_integration feature (launchDay 30)
--   also flips ai_assist for feature adopters.
-- - H5/H9 normalize per-event / per-build: shares cancel persona event
--   multipliers, and the over/sweet pair cancels organic deploys-per-
--   build entirely (0.6/1.5 = 0.40 exact).
-- - H10 is NOT visible here: funnel-post scales gaps within funnel
--   instances; cross-event MIN→MIN SQL flattens it. See the emulator
--   timeToConvert assertion in devtools.js stories.

-- Hook 1: BUILD FAILURE CASCADE — failed builds 2x duration (median)
SELECT build_status, COUNT(*) AS n,
  ROUND(MEDIAN(TRY_CAST(build_duration_sec AS DOUBLE)), 0) AS med_dur,
  ROUND(AVG(TRY_CAST(build_duration_sec AS DOUBLE)), 0) AS avg_dur
FROM read_json_auto('data/verify-devtools-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event = 'build completed'
GROUP BY build_status ORDER BY med_dur DESC;

-- Hook 2: NIGHT DEPLOY RISK — ~52% night vs ~21% day failure share
-- (recovery window days 43-49 excluded; H6 clones dilute it)
WITH ev AS (
  SELECT deploy_status, hour(time::TIMESTAMP) AS hr,
    date_diff('day', TIMESTAMP '2026-01-01 00:00:00', time::TIMESTAMP) AS day_idx
  FROM read_json_auto('data/verify-devtools-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event = 'deployment completed'
)
SELECT CASE WHEN hr >= 22 OR hr < 6 THEN 'night' ELSE 'day' END AS bucket,
  COUNT(*) AS deploys,
  ROUND(AVG((deploy_status = 'failed')::INT), 4) AS failure_share
FROM ev WHERE day_idx NOT BETWEEN 43 AND 49
GROUP BY (CASE WHEN hr >= 22 OR hr < 6 THEN 'night' ELSE 'day' END);

-- Hook 3: COPILOT PR VELOCITY — hash cohort ~1.5x PRs/user
WITH pu AS (
  SELECT user_id::VARCHAR AS uid,
    (ascii(substr(user_id::VARCHAR, 1, 1)) % 10 < 3) AS copilot,
    COUNT(*) FILTER (WHERE event = 'pull request created') AS prs
  FROM read_json_auto('data/verify-devtools-EVENTS*.json', sample_size=-1, union_by_name=true)
  GROUP BY 1, 2
)
SELECT copilot, COUNT(*) AS users,
  ROUND(SUM(prs)::DOUBLE / COUNT(*), 2) AS prs_per_user
FROM pu GROUP BY copilot ORDER BY copilot;

-- Hook 4: ON-CALL FATIGUE — >20 alerts → ~2.6x mean response time
WITH pu AS (
  SELECT user_id::VARCHAR AS uid,
    COUNT(*) FILTER (WHERE event = 'alert triggered') AS alerts,
    AVG(TRY_CAST(response_time_minutes AS DOUBLE)) FILTER (WHERE event IN ('incident created', 'incident resolved')) AS rt,
    COUNT(*) FILTER (WHERE event IN ('incident created', 'incident resolved')) AS incidents
  FROM read_json_auto('data/verify-devtools-EVENTS*.json', sample_size=-1, union_by_name=true)
  GROUP BY 1
)
SELECT (alerts > 20) AS fatigued, COUNT(*) AS users,
  ROUND(AVG(rt), 1) AS mean_response_min,
  ROUND(AVG(1 + LEAST(alerts / 20.0, 3)) FILTER (WHERE alerts > 20), 2) AS mean_engineered_mult
FROM pu WHERE incidents > 0 GROUP BY (alerts > 20) ORDER BY 1;

-- Hook 5: OSS POWER USAGE — active oss build share ~1.3x active non-oss
WITH us AS (
  SELECT distinct_id::VARCHAR AS uid, segment
  FROM read_json_auto('data/verify-devtools-USERS*.json', sample_size=-1, union_by_name=true)
), pu AS (
  SELECT user_id::VARCHAR AS uid, COUNT(*) AS n_ev,
    COUNT(*) FILTER (WHERE event = 'build completed') AS builds,
    COUNT(*) FILTER (WHERE event = 'deployment completed') AS deploys
  FROM read_json_auto('data/verify-devtools-EVENTS*.json', sample_size=-1, union_by_name=true)
  GROUP BY 1
)
SELECT (u.segment = 'oss_user') AS is_oss, COUNT(*) AS users,
  ROUND(SUM(builds)::DOUBLE / SUM(n_ev), 4) AS build_share,
  ROUND(SUM(deploys)::DOUBLE / SUM(n_ev), 4) AS deploy_share
FROM pu p JOIN us u USING (uid)
WHERE n_ev > 25
GROUP BY (u.segment = 'oss_user') ORDER BY is_oss;

-- Hook 6: POST-OUTAGE RECOVERY — deploys ~3.7x on days 44-47
-- (ratio-of-ratios vs builds cancels the growth ramp)
WITH ev AS (
  SELECT event, date_diff('day', TIMESTAMP '2026-01-01 00:00:00', time::TIMESTAMP) AS day_idx
  FROM read_json_auto('data/verify-devtools-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event IN ('deployment completed', 'build completed')
)
SELECT CASE WHEN day_idx BETWEEN 44 AND 47 THEN 'recovery' ELSE 'baseline' END AS zone,
  COUNT(*) FILTER (WHERE event = 'deployment completed') AS deploys,
  COUNT(*) FILTER (WHERE event = 'build completed') AS builds,
  ROUND(COUNT(*) FILTER (WHERE event = 'deployment completed')::DOUBLE
    / COUNT(*) FILTER (WHERE event = 'build completed'), 3) AS deploys_per_build
FROM ev
WHERE day_idx BETWEEN 35 AND 41 OR day_idx BETWEEN 44 AND 47 OR day_idx BETWEEN 49 AND 55
GROUP BY (CASE WHEN day_idx BETWEEN 44 AND 47 THEN 'recovery' ELSE 'baseline' END);

-- Hook 7: DEVOPS PROFILE ENRICHMENT — repos_connected is the crisp
-- signal (default [0]); team_size contrast is devops vs junior
-- (full_stack/oss default pool mean is ~24, NOT ~10)
SELECT segment, COUNT(*) AS users,
  ROUND(AVG(TRY_CAST(team_size AS DOUBLE)), 1) AS avg_team,
  ROUND(AVG(TRY_CAST(repos_connected AS DOUBLE)), 1) AS avg_repos,
  MODE(experience_level) AS mode_exp
FROM read_json_auto('data/verify-devtools-USERS*.json', sample_size=-1, union_by_name=true)
GROUP BY segment ORDER BY avg_repos DESC;

-- Hook 8: ENTERPRISE FUNNEL LIFT — free/team mv-per-deploy ~0.63x paid
-- (per-deploy normalization cancels H6/H9 deploy inflation)
WITH pu AS (
  SELECT user_id::VARCHAR AS uid, ANY_VALUE(subscription_tier) AS tier,
    COUNT(*) FILTER (WHERE event = 'monitoring dashboard viewed') AS mv,
    COUNT(*) FILTER (WHERE event = 'deployment completed') AS dep
  FROM read_json_auto('data/verify-devtools-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event IN ('monitoring dashboard viewed', 'deployment completed')
  GROUP BY 1
)
SELECT CASE WHEN tier IN ('enterprise', 'business') THEN 'paid' ELSE 'free_team' END AS grp,
  COUNT(*) AS users,
  ROUND(SUM(mv)::DOUBLE / NULLIF(SUM(dep), 0), 4) AS mv_per_deploy
FROM pu WHERE tier IS NOT NULL
GROUP BY (CASE WHEN tier IN ('enterprise', 'business') THEN 'paid' ELSE 'free_team' END);

-- Hook 9: BUILD-COUNT MAGIC NUMBER — deploys-per-build by bucket
-- (full_stack only; recovery-window deploys excluded; over/sweet ≈ 0.40)
WITH us AS (
  SELECT distinct_id::VARCHAR AS uid, segment
  FROM read_json_auto('data/verify-devtools-USERS*.json', sample_size=-1, union_by_name=true)
), pu AS (
  SELECT user_id::VARCHAR AS uid,
    COUNT(*) FILTER (WHERE event = 'build completed') AS builds,
    COUNT(*) FILTER (WHERE event = 'deployment completed'
      AND date_diff('day', TIMESTAMP '2026-01-01 00:00:00', time::TIMESTAMP) NOT BETWEEN 43 AND 49) AS deploys
  FROM read_json_auto('data/verify-devtools-EVENTS*.json', sample_size=-1, union_by_name=true)
  GROUP BY 1
)
SELECT CASE WHEN builds BETWEEN 15 AND 30 THEN 'sweet'
  WHEN builds >= 31 THEN 'over' ELSE 'base' END AS bucket,
  COUNT(*) AS users,
  ROUND(SUM(deploys)::DOUBLE / SUM(builds), 4) AS deploys_per_build
FROM pu p JOIN us u USING (uid)
WHERE u.segment = 'full_stack' AND builds >= 1
GROUP BY (CASE WHEN builds BETWEEN 15 AND 30 THEN 'sweet' WHEN builds >= 31 THEN 'over' ELSE 'base' END)
ORDER BY bucket;

-- Hook 10: BUILD-DEPLOY TTC BY TIER — not visible in cross-event SQL.
-- funnel-post rewrites step timestamps within funnel instances; the
-- emulator's timeToConvert (see devtools.js stories) is the honest
-- read. This query only confirms the tier populations exist.
SELECT subscription_tier, COUNT(DISTINCT user_id) AS users
FROM read_json_auto('data/verify-devtools-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event IN ('build completed', 'deployment completed') AND subscription_tier IS NOT NULL
GROUP BY subscription_tier ORDER BY users DESC;
