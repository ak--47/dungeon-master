-- ============================================================
-- support-desk.js — v1.6.0 Hook Inspection Queries (DuckDB)
-- Score: see README — machine contract in support-desk.js `stories`
-- Run after: node scripts/verify-runner.mjs dungeons/vertical/support-desk/support-desk.js verify-support-desk
-- ============================================================
--
-- v1.6.0 derivation notes (2K reduced run vs organic counterfactual):
-- 1. This dungeon is the FLOWS + SESSIONS SHOWCASE: applySessionShape
--    retimes every user's stream into role-shaped sessions (agents ~5
--    long 45-min sessions/week, requesters ~1 short 10-min session/week
--    of ~28 events), then applyPathBias injects a one-touch resolution
--    (H1 band, 5-20s gaps — in-session) and a cross-session escalation
--    chain (H2 band, 1-4h gaps — resolved lands at session ordinal +3).
-- 2. hashFloat bands are not expressible in SQL, but `role` is pinned on
--    every event, so per-role sessionization (LAG > 30 min) is exact.
--    Session-count conversion windows and topPaths semantics live in the
--    stories export (emulator); the queries below eyeball the same
--    signals through time-gap and session aggregates.
-- 3. H2's signature in raw SQL: the session-ordinal span from a user's
--    first 'ticket created' to their first subsequent 'ticket resolved'
--    is 1 for the H1 band (one-touch) and 4 for the H2 band (the
--    injected chain's three cross-session steps) — the histogram in
--    query 2 shows both spikes; organic data ramps smoothly.
-- ============================================================


-- Hook 1: ONE-TOUCH RESOLUTION — ~45% of users get reply+resolved
-- injected 5-20s after their first ticket created.
-- Expect: a large spike of first-created → first-resolved gaps under
-- 30 seconds (2K hooked: ~0.45 of ticket creators; organic: none under
-- a minute — organic resolution flows through the F2 funnel over hours).
WITH firsts AS (
  SELECT user_id,
    MIN(CASE WHEN event = 'ticket created' THEN time::TIMESTAMP END) AS first_created,
    MIN(CASE WHEN event = 'ticket resolved' THEN time::TIMESTAMP END) AS first_resolved
  FROM read_json_auto('data/verify-support-desk-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE user_id IS NOT NULL
  GROUP BY 1
)
SELECT
  CASE
    WHEN gap_s < 30 THEN 'a. <30s (H1 one-touch)'
    WHEN gap_s < 1800 THEN 'b. 30s-30min'
    WHEN gap_s < 14400 THEN 'c. 30min-4h (H2 chain)'
    ELSE 'd. >4h (organic tail)'
  END AS first_resolution_gap,
  COUNT(*) AS users
FROM (
  SELECT EXTRACT(EPOCH FROM first_resolved - first_created)::DOUBLE AS gap_s
  FROM firsts
  WHERE first_created IS NOT NULL AND first_resolved IS NOT NULL AND first_resolved > first_created
)
GROUP BY 1 ORDER BY 1;


-- Hook 2: CROSS-SESSION ESCALATION — the H2 band's organic resolutions
-- are dropped; the injected escalated→reply→resolved chain (1-4h gaps)
-- resolves at session ordinal +3.
-- Expect: bimodal session-ordinal span from first created to first
-- resolved — a spike at 1 (H1 one-touch, ~63% of resolvers) and a spike
-- at 4 (H2 chain, ~35%); organic data spreads across many ordinals.
WITH e AS (
  SELECT user_id AS uid, event, time::TIMESTAMP AS t,
    CASE WHEN LAG(time::TIMESTAMP) OVER (PARTITION BY user_id ORDER BY time::TIMESTAMP) IS NULL
      OR time::TIMESTAMP - LAG(time::TIMESTAMP) OVER (PARTITION BY user_id ORDER BY time::TIMESTAMP) > INTERVAL 30 MINUTE
      THEN 1 ELSE 0 END AS is_start
  FROM read_json_auto('data/verify-support-desk-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE user_id IS NOT NULL
), s AS (
  SELECT uid, event, t, SUM(is_start) OVER (PARTITION BY uid ORDER BY t) AS sid FROM e
), spans AS (
  SELECT c.uid,
    (SELECT MIN(r.sid) FROM s r WHERE r.uid = c.uid AND r.event = 'ticket resolved' AND r.t > c.t0)
      - c.sid0 + 1 AS ordinal_span
  FROM (
    SELECT uid, MIN(t) AS t0, ARG_MIN(sid, t) AS sid0
    FROM s WHERE event = 'ticket created' GROUP BY uid
  ) c
)
SELECT ordinal_span, COUNT(*) AS users
FROM spans WHERE ordinal_span IS NOT NULL
GROUP BY 1 ORDER BY 1 LIMIT 12;


-- Hook 3a: SESSION SHAPE — duration bimodality. applySessionShape gives
-- requesters 10-min sessions and agents 45-min sessions.
-- Expect: requester median ~10.0 min, agent median ~45.0 min (both
-- near-deterministic); organic sessions are ~1.2-event singletons.
WITH e AS (
  SELECT user_id AS uid, role, time::TIMESTAMP AS t,
    CASE WHEN LAG(time::TIMESTAMP) OVER (PARTITION BY user_id ORDER BY time::TIMESTAMP) IS NULL
      OR time::TIMESTAMP - LAG(time::TIMESTAMP) OVER (PARTITION BY user_id ORDER BY time::TIMESTAMP) > INTERVAL 30 MINUTE
      THEN 1 ELSE 0 END AS is_start
  FROM read_json_auto('data/verify-support-desk-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE user_id IS NOT NULL
), s AS (
  SELECT uid, role, t, SUM(is_start) OVER (PARTITION BY uid ORDER BY t) AS sid FROM e
), sess AS (
  SELECT uid, ANY_VALUE(role) AS role, sid,
    COUNT(*) AS events_in_session,
    EXTRACT(EPOCH FROM MAX(t) - MIN(t))::DOUBLE / 60.0 AS dur_min
  FROM s GROUP BY uid, sid
)
SELECT role,
  COUNT(*) AS sessions,
  ROUND(MEDIAN(dur_min), 1) AS median_min,
  ROUND(QUANTILE_CONT(dur_min, 0.9), 1) AS p90_min,
  ROUND(MEDIAN(events_in_session), 1) AS median_events
FROM sess GROUP BY 1 ORDER BY 1;


-- Hook 3b: SESSION CADENCE — agents ~5 sessions/week, requesters ~1.
-- Expect (2K hooked): agent median ~4.6/wk, requester ~1.0/wk (ratio
-- ~4.6x); organic ~23/wk for BOTH roles (ratio ~1.0x).
WITH e AS (
  SELECT user_id AS uid, role, time::TIMESTAMP AS t,
    CASE WHEN LAG(time::TIMESTAMP) OVER (PARTITION BY user_id ORDER BY time::TIMESTAMP) IS NULL
      OR time::TIMESTAMP - LAG(time::TIMESTAMP) OVER (PARTITION BY user_id ORDER BY time::TIMESTAMP) > INTERVAL 30 MINUTE
      THEN 1 ELSE 0 END AS is_start
  FROM read_json_auto('data/verify-support-desk-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE user_id IS NOT NULL
), s AS (
  SELECT uid, role, SUM(is_start) AS sessions FROM e GROUP BY uid, role
)
SELECT role,
  COUNT(*) AS users,
  ROUND(MEDIAN(sessions / 12.0), 2) AS median_sessions_per_week
FROM s GROUP BY 1 ORDER BY 1;


-- Identity invariants: every event carries user_id; avgDevicePerUser: 2.
-- Expect: uid_share 1.0, device_share ~0.999, devices/user ~2.05.
SELECT COUNT(*) AS n,
  AVG((user_id IS NOT NULL)::INT) AS uid_share,
  AVG((device_id IS NOT NULL)::INT) AS device_share,
  COUNT(DISTINCT device_id)::DOUBLE / COUNT(DISTINCT user_id) AS dpu
FROM read_json_auto('data/verify-support-desk-EVENTS*.json', sample_size=-1, union_by_name=true);
