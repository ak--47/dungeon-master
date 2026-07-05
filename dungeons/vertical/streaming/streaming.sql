-- ============================================================
-- streaming.js — v1.6.0 Hook Inspection Queries (DuckDB)
-- Score: see README — machine contract in streaming.js `stories`
-- Run after: node scripts/verify-runner.mjs dungeons/vertical/streaming/streaming.js verify-streaming
-- ============================================================
--
-- v1.6.0 derivation notes (2K reduced run vs organic counterfactual):
-- 1. This dungeon is the LIFECYCLE SHOWCASE: three applyLifecycleWave
--    cohorts on disjoint hashFloat bands (25% / 15% / 12%), gated to
--    early-born users so birth-relative windows land on near-absolute
--    calendar days. hashFloat is not expressible in SQL — cohort-exact
--    reads live in the stories export; these queries eyeball the same
--    signals through calendar aggregates and the whole-stream gap audit.
-- 2. Machine verification reads lifecycle TILES BY INDEX via the
--    emulator (22 seven-day tiles, 6 thirty-day tiles over the fixed
--    151-day span). The dates below match the configured window
--    2026-01-01 → 2026-05-31.
-- 3. Only H3 (dropAll) creates ≥25-day whole-stream gaps — H1/H2 users
--    keep browsing through their windows — so the LAG gap scan isolates
--    the campaign cohort without hashFloat.
-- ============================================================


-- Hook 1: WEEKLY LIFECYCLE WAVE — ~25% of early-born users stop playing
-- for 3 weeks (days 42-63), then burst back.
-- Expect: weekly distinct players dip ~Feb 15 - Mar 7, spike the week of
-- Mar 8 (the 4-clone resurrection burst), flat elsewhere.
SELECT DATE_TRUNC('week', time::TIMESTAMP) AS week,
  COUNT(DISTINCT user_id) AS players,
  COUNT(*) AS plays
FROM read_json_auto('data/verify-streaming-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event = 'content played'
GROUP BY 1 ORDER BY 1;


-- Hook 2: MONTHLY LIFECYCLE WAVE — ~15% of early-born users go
-- value-moment-dark for 65 days (days 21-86; the gap covers all of
-- February, one whole 30d tile).
-- Expect: February's distinct-player count drops vs January/April; the
-- users missing in February reappear in late March.
SELECT DATE_TRUNC('month', time::TIMESTAMP) AS month,
  COUNT(DISTINCT user_id) AS players,
  COUNT(*) AS plays
FROM read_json_auto('data/verify-streaming-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event = 'content played'
GROUP BY 1 ORDER BY 1;


-- Hook 3: RESURRECTION CAMPAIGN — ~12% of early-born users vanish
-- entirely for 30 days (days 100-130, dropAll), then return with a
-- push_open burst 15-45 min before the first post-gap play.
-- Expect: ~10% of users have a ≥25d whole-stream gap; ~all return to the
-- value moment; pushed share ~0.97 (organic: a handful of users, ~0.5).
WITH e AS (
  SELECT user_id::VARCHAR AS uid, event, time::TIMESTAMP AS t,
    LAG(time::TIMESTAMP) OVER (PARTITION BY user_id::VARCHAR ORDER BY time::TIMESTAMP) AS prev_t
  FROM read_json_auto('data/verify-streaming-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE user_id IS NOT NULL
), gaps AS (
  SELECT uid, MAX(t - prev_t) AS max_gap FROM e WHERE prev_t IS NOT NULL GROUP BY 1
), gap_users AS (
  SELECT uid FROM gaps WHERE max_gap >= INTERVAL 25 DAY
), gap_edge AS (
  SELECT e.uid, MIN(e.t) AS gap_end
  FROM e JOIN gap_users g ON e.uid = g.uid
  WHERE e.prev_t IS NOT NULL AND e.t - e.prev_t >= INTERVAL 25 DAY
  GROUP BY 1
), first_play AS (
  SELECT e.uid, MIN(e.t) AS play_t
  FROM e JOIN gap_edge g ON e.uid = g.uid
  WHERE e.event = 'content played' AND e.t >= g.gap_end
  GROUP BY 1
), pushed AS (
  SELECT DISTINCT f.uid
  FROM first_play f JOIN e ON e.uid = f.uid
  WHERE e.event = 'push_open' AND e.t <= f.play_t AND e.t >= f.play_t - INTERVAL 24 HOUR
)
SELECT (SELECT COUNT(*) FROM gap_users) AS gap_users,
  (SELECT COUNT(*) FROM first_play) AS returners,
  (SELECT COUNT(*) FROM pushed) AS pushed_returners,
  ROUND((SELECT COUNT(*) FROM pushed)::DOUBLE / GREATEST((SELECT COUNT(*) FROM first_play), 1), 3) AS pushed_share;


-- Hook 4 (combined effect): WAU DOUBLE TROUGH — daily distinct players,
-- bucketed. Expect: deep trough days 49-63 (H1+H2 overlap, ~0.59x
-- baseline), partial recovery, second dip days 107-137 (H3, ~0.89x),
-- full tail recovery. Eyeball the daily series for the two-dip shape.
SELECT DATE_TRUNC('day', time::TIMESTAMP) AS day,
  COUNT(DISTINCT user_id) AS players
FROM read_json_auto('data/verify-streaming-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event = 'content played'
GROUP BY 1 ORDER BY 1;


-- Identity invariants: every event carries user_id; ~all carry device_id
-- (avgDevicePerUser: 2 → devices/user ~2.1).
SELECT COUNT(*) AS n,
  ROUND(AVG((user_id IS NOT NULL)::INT), 4) AS uid_share,
  ROUND(AVG((device_id IS NOT NULL)::INT), 4) AS device_share,
  ROUND(COUNT(DISTINCT device_id)::DOUBLE / COUNT(DISTINCT user_id), 2) AS devices_per_user
FROM read_json_auto('data/verify-streaming-EVENTS*.json', sample_size=-1, union_by_name=true);
