-- ============================================================
-- media.sql — human-eyeball inspection queries (v1.6)
-- ============================================================
-- Mirrors the story reads in media.js `stories`. Run after:
--   node scripts/verify-runner.mjs dungeons/vertical/media/media.js verify-media
--
-- Derivation notes:
-- - H1 is a completions-per-selection ratio-of-ratios vs ANIMATION:
--   animation absorbs the same H6 selection-count inflation as
--   documentary, and per-selection normalization cancels the
--   favored-index popularity skew (action/romance selections run hot).
--   Genre exists on completions only via core-viewing funnel props.
-- - H7 normalizes rated counts by total events pre/post day 60 —
--   cancels the user-growth ramp (1/0.7 = 1.43 mechanism).
-- - H8's clean read is completion_percent; the duration x1.15 is
--   cancelled by subtitle users skewing into the H9 over-bucket.
-- - H9 over/sweet = 0.5/1.25 = 0.40 exact — the engagement confound
--   cancels between the two high-activity buckets.
-- - H10's TTC leg is NOT visible in cross-event SQL; see the emulator
--   timeToConvert assertion in media.js stories (6-HOUR window — at
--   multi-day windows the median sits on a bimodal mode boundary and
--   flips on sampling noise).

-- Hook 1: GENRE FUNNEL CONVERSION — doc/anim comp-per-sel RoR ~0.75
WITH g AS (
  SELECT genre,
    COUNT(*) FILTER (WHERE event = 'content selected') AS sel_n,
    COUNT(*) FILTER (WHERE event = 'playback completed') AS comp_n
  FROM read_json_auto('data/verify-media-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE genre IS NOT NULL AND event IN ('content selected', 'playback completed')
  GROUP BY genre
)
SELECT genre, sel_n, comp_n, ROUND(comp_n::DOUBLE / sel_n, 4) AS comp_per_sel
FROM g ORDER BY comp_per_sel;

-- Hook 2: BINGE-WATCHING — binge cohort (max completed-streak >= 3,
-- started ignored) ~1.6x completions per user
WITH seq AS (
  SELECT user_id::VARCHAR AS uid, event,
    ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY time::TIMESTAMP, event) AS rn
  FROM read_json_auto('data/verify-media-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event != 'playback started'
), runs AS (
  SELECT uid, rn - ROW_NUMBER() OVER (PARTITION BY uid ORDER BY rn) AS grp
  FROM seq WHERE event = 'playback completed'
), streaks AS (
  SELECT uid, MAX(cnt) AS max_streak
  FROM (SELECT uid, grp, COUNT(*) AS cnt FROM runs GROUP BY uid, grp) GROUP BY uid
), pu AS (
  SELECT user_id::VARCHAR AS uid,
    COUNT(*) FILTER (WHERE event = 'playback completed') AS completions
  FROM read_json_auto('data/verify-media-EVENTS*.json', sample_size=-1, union_by_name=true)
  GROUP BY 1
)
SELECT COALESCE(s.max_streak >= 3, false) AS binge, COUNT(*) AS users,
  ROUND(AVG(p.completions), 2) AS completions_pu
FROM pu p LEFT JOIN streaks s USING (uid)
GROUP BY (COALESCE(s.max_streak >= 3, false)) ORDER BY binge;

-- Hook 3: WEEKEND VS WEEKDAY — ~1.45x avg duration (1.5 engineered,
-- diluted by fresh-draw clone durations)
SELECT
  CASE WHEN dayofweek(time::TIMESTAMP) IN (0, 6) THEN 'weekend' ELSE 'weekday' END AS bucket,
  COUNT(*) AS n, ROUND(AVG(watch_duration_min), 1) AS avg_min
FROM read_json_auto('data/verify-media-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event = 'playback completed' AND watch_duration_min IS NOT NULL
GROUP BY (CASE WHEN dayofweek(time::TIMESTAMP) IN (0, 6) THEN 'weekend' ELSE 'weekday' END);

-- Hook 4: AD FATIGUE CHURN — fatigued post/pre ~0.04x rest (among users
-- whose lifecycle spans past day 52; late-born users dilute otherwise)
WITH pu AS (
  SELECT user_id::VARCHAR AS uid, MIN(time::TIMESTAMP) AS t0, MAX(time::TIMESTAMP) AS tlast
  FROM read_json_auto('data/verify-media-EVENTS*.json', sample_size=-1, union_by_name=true)
  GROUP BY 1
), flags AS (
  SELECT p.uid,
    COUNT(*) FILTER (WHERE e.event = 'ad impression' AND e.time::TIMESTAMP < p.t0 + INTERVAL 45 DAY) AS early_ads,
    COUNT(*) FILTER (WHERE e.time::TIMESTAMP > p.t0 + INTERVAL 45 DAY) AS post,
    COUNT(*) FILTER (WHERE e.time::TIMESTAMP <= p.t0 + INTERVAL 45 DAY) AS pre
  FROM read_json_auto('data/verify-media-EVENTS*.json', sample_size=-1, union_by_name=true) e
  JOIN pu p ON e.user_id::VARCHAR = p.uid
  WHERE p.tlast > p.t0 + INTERVAL 52 DAY
  GROUP BY 1
)
SELECT (early_ads >= 5) AS fatigued, COUNT(*) AS users,
  ROUND(AVG(post::DOUBLE / NULLIF(pre, 0)), 4) AS avg_post_pre
FROM flags WHERE pre > 0
GROUP BY (early_ads >= 5) ORDER BY fatigued;

-- Hook 5: NEW RELEASE SPIKE — 20% blockbuster share of selections in
-- days 50-64, zero outside; blockbuster ratings pinned 4-5
SELECT (day_idx BETWEEN 50 AND 64) AS in_window, COUNT(*) AS n,
  ROUND(AVG((content_id LIKE 'blockbuster%')::INT), 4) AS bb_share
FROM (
  SELECT content_id,
    date_diff('day', TIMESTAMP '2026-01-01 00:00:00', time::TIMESTAMP) AS day_idx
  FROM read_json_auto('data/verify-media-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event = 'content selected'
)
GROUP BY (day_idx BETWEEN 50 AND 64) ORDER BY in_window;

SELECT COUNT(*) AS bb_rated, MIN(rating) AS min_rating, MAX(rating) AS max_rating
FROM read_json_auto('data/verify-media-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event = 'content rated' AND content_id LIKE 'blockbuster%';

-- Hook 6: KIDS PROFILE SAFETY — anim+doc ~32% of selected (vs ~20% base).
-- Read content selected ONLY: playback started carries genre solely via
-- funnel-2 props or this hook's stamp (its genre subset reads ~48%).
SELECT COUNT(*) AS n,
  ROUND(AVG((genre IN ('animation', 'documentary'))::INT), 4) AS kid_share
FROM read_json_auto('data/verify-media-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event = 'content selected' AND genre IS NOT NULL;

-- Hook 7: REC ENGINE IMPROVEMENT — post/pre rated-share-of-events ~1.43x
WITH ev AS (
  SELECT event,
    date_diff('day', TIMESTAMP '2026-01-01 00:00:00', time::TIMESTAMP) < 60 AS pre
  FROM read_json_auto('data/verify-media-EVENTS*.json', sample_size=-1, union_by_name=true)
)
SELECT
  COUNT(*) FILTER (WHERE pre AND event = 'content rated') AS pre_rated,
  COUNT(*) FILTER (WHERE NOT pre AND event = 'content rated') AS post_rated,
  ROUND((COUNT(*) FILTER (WHERE NOT pre AND event = 'content rated')::DOUBLE / COUNT(*) FILTER (WHERE NOT pre))
    / (COUNT(*) FILTER (WHERE pre AND event = 'content rated')::DOUBLE / COUNT(*) FILTER (WHERE pre)), 4) AS share_ratio
FROM ev;

-- Hook 8: SUBTITLE USERS — completion_percent ~1.28x (the clean read)
WITH pu AS (
  SELECT user_id::VARCHAR AS uid,
    BOOL_OR(event = 'subtitle toggled' AND action = 'enabled') AS subs
  FROM read_json_auto('data/verify-media-EVENTS*.json', sample_size=-1, union_by_name=true)
  GROUP BY 1
)
SELECT p.subs, COUNT(DISTINCT p.uid) AS users,
  ROUND(AVG(e.completion_percent), 2) AS avg_cp
FROM read_json_auto('data/verify-media-EVENTS*.json', sample_size=-1, union_by_name=true) e
JOIN pu p ON e.user_id::VARCHAR = p.uid
WHERE e.event = 'playback completed' AND e.completion_percent IS NOT NULL
GROUP BY p.subs ORDER BY p.subs;

-- Hook 9: REC-CLICK MAGIC NUMBER — sweet/low ~1.25x, over/sweet ~0.40x
WITH pu AS (
  SELECT user_id::VARCHAR AS uid,
    COUNT(*) FILTER (WHERE event = 'recommendation clicked') AS rcs
  FROM read_json_auto('data/verify-media-EVENTS*.json', sample_size=-1, union_by_name=true)
  GROUP BY 1
)
SELECT
  CASE WHEN p.rcs BETWEEN 4 AND 6 THEN 'sweet' WHEN p.rcs >= 7 THEN 'over' ELSE 'low' END AS bucket,
  COUNT(DISTINCT p.uid) AS users, ROUND(AVG(e.watch_duration_min), 1) AS avg_dur
FROM read_json_auto('data/verify-media-EVENTS*.json', sample_size=-1, union_by_name=true) e
JOIN pu p ON e.user_id::VARCHAR = p.uid
WHERE e.event = 'playback completed' AND e.watch_duration_min IS NOT NULL
GROUP BY (CASE WHEN p.rcs BETWEEN 4 AND 6 THEN 'sweet' WHEN p.rcs >= 7 THEN 'over' ELSE 'low' END)
ORDER BY bucket;

-- Hook 10: CORE VIEWING LOOP — free/premium avg duration ~2.0x. The TTC
-- leg is not visible here: scaleFunnelTTC rewrites gaps within one funnel
-- instance per user; see the emulator timeToConvert assertion in media.js
-- stories (6-hour conversion window).
SELECT subscription_plan, COUNT(*) AS n, ROUND(AVG(watch_duration_min), 1) AS avg_dur
FROM read_json_auto('data/verify-media-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event = 'playback completed' AND watch_duration_min IS NOT NULL AND subscription_plan IS NOT NULL
GROUP BY subscription_plan ORDER BY avg_dur;

-- Identity invariants: uid coverage 1.0, device coverage ~0.998,
-- devices/user ~2 (avgDevicePerUser: 2), plan stamped on all events
SELECT
  ROUND(AVG((user_id IS NOT NULL)::INT), 4) AS uid_share,
  ROUND(AVG((device_id IS NOT NULL)::INT), 4) AS device_share,
  ROUND(AVG((subscription_plan IS NOT NULL)::INT), 4) AS plan_share,
  ROUND(COUNT(DISTINCT device_id)::DOUBLE / COUNT(DISTINCT user_id), 2) AS devices_per_user
FROM read_json_auto('data/verify-media-EVENTS*.json', sample_size=-1, union_by_name=true);
