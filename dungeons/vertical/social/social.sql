-- ============================================================
-- social.js — hook inspection queries (v1.6.0 stories rebuild)
--
-- The verification CONTRACT lives in the `stories` export of
-- social.js (run via social.verify.mjs). These queries are for
-- manual inspection of the same reads.
--
-- Derivation notes (measured at 2K reduced scale + organic
-- counterfactual run — same seed, identity hook):
--   - H1's old "10+ post created" cohort read is dead: 85% of
--     users clear 10 FINAL posts (clones inflate counts). The
--     live read is concentration: top-3% engagement share 0.62
--     vs organic 0.06.
--   - H2's 1.5x posts ratio decomposes into 1.24x activity
--     confound x 1.21x true hook increment.
--   - Organic DOW is FLAT (soup weights >= 1.0 accept-always);
--     H8's 1.25x weekend ratio is pure hook. The v1.5 "soup
--     baseline ~0.55" claim was wrong.
--   - H9 must be read by FINAL post counts (the analyst view) —
--     the hook buckets on pre-injection counts, so the final
--     3-7 bucket is dominated by boosted 0-2 dodgers: sweet
--     avg ~250, low ~200, over ~145.
--   - H10's funnel-post gap scaling is NOT visible to
--     MIN(step)-join SQL; use the emulator via social.verify.mjs.
--     The MIN-join below shows direction only.
--
-- Replace data/verify-social with your run prefix.
-- ============================================================

-- H1: VIRAL CONTENT — top-3% of users' share of engagement events
-- Expected: ~0.62 (organic counterfactual 0.057)
WITH pu AS (
  SELECT user_id::VARCHAR AS uid,
    COUNT(*) FILTER (WHERE event IN ('post viewed', 'post liked', 'post shared')) AS eng
  FROM read_json_auto('data/verify-social-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE user_id IS NOT NULL GROUP BY 1
), ranked AS (
  SELECT eng, ROW_NUMBER() OVER (ORDER BY eng DESC) AS rn,
    COUNT(*) OVER () AS n, SUM(eng) OVER () AS tot
  FROM pu
)
SELECT ROUND(SUM(eng)::DOUBLE / MAX(tot), 4) AS top3_share, MAX(n) AS users
FROM ranked WHERE rn <= CEIL(n * 0.03);

-- H2: FOLLOW-BACK SNOWBALL — 5+ user-followed → more posts
-- Expected: big/small posts-per-user ~1.50 (42.3 vs 28.2 at 2K)
WITH pu AS (
  SELECT user_id::VARCHAR AS uid,
    COUNT(*) FILTER (WHERE event = 'user followed') AS fc,
    COUNT(*) FILTER (WHERE event = 'post created') AS pc
  FROM read_json_auto('data/verify-social-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE user_id IS NOT NULL GROUP BY 1
)
SELECT (fc >= 5) AS big_followers, COUNT(*) AS users, ROUND(AVG(pc), 2) AS avg_posts
FROM pu GROUP BY 1 ORDER BY 1;

-- H3 + H5: SOURCE MIX by window (algorithm change @d45, notifications @d30)
-- Expected: pre_d30 feed ~0.78, notif ~0.03; d30_45 feed ~0.54, notif ~0.32;
--           post_d45 explore ~0.54, notif ~0.32, feed ~0.05
SELECT
  CASE WHEN time::TIMESTAMP < TIMESTAMP '2026-01-31 00:00:00' THEN 'pre_d30'
       WHEN time::TIMESTAMP < TIMESTAMP '2026-02-15 00:00:00' THEN 'd30_45'
       ELSE 'post_d45' END AS win,
  COUNT(*) AS n,
  ROUND(AVG((source = 'feed')::INT), 4) AS feed,
  ROUND(AVG((source = 'explore')::INT), 4) AS explore,
  ROUND(AVG((source = 'notification')::INT), 4) AS notif,
  ROUND(AVG((source = 'profile')::INT), 4) AS prof
FROM read_json_auto('data/verify-social-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event = 'post viewed'
GROUP BY 1 ORDER BY 1;

-- H4: ENGAGEMENT BAIT — share of post-viewed events with crushed (<=5s) duration
-- Expected: ~0.20 (organic 0.000 — generator floors durations above 5s)
SELECT COUNT(*) AS views,
  ROUND(AVG((view_duration_sec <= 5)::INT), 4) AS crushed_share,
  ROUND(AVG(view_duration_sec) FILTER (WHERE view_duration_sec <= 5), 2) AS avg_crushed_dur
FROM read_json_auto('data/verify-social-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event = 'post viewed' AND view_duration_sec IS NOT NULL;

-- H6: CREATOR MONETIZATION — subscribers (~78% of users) vs non
-- Expected: posts/user ratio ~3.32; stories/user ~3.82 (purer read —
-- H2 dupes lift non-sub posts but never stories)
WITH pu AS (
  SELECT user_id::VARCHAR AS uid,
    BOOL_OR(event = 'creator subscription started') AS sub,
    COUNT(*) FILTER (WHERE event = 'post created') AS pc,
    COUNT(*) FILTER (WHERE event = 'story created') AS sc
  FROM read_json_auto('data/verify-social-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE user_id IS NOT NULL GROUP BY 1
)
SELECT sub, COUNT(*) AS users, ROUND(AVG(pc), 2) AS avg_posts, ROUND(AVG(sc), 2) AS avg_stories
FROM pu GROUP BY 1 ORDER BY 1;

-- H7: TOXICITY CHURN — per-user post/pre-d30 event ratio, reporters vs normal
-- Expected: reporters ~1.27 vs normal ~3.21 → contrast ~0.40 (60% drop knob;
-- growth shape makes the raw post/pre ~3.2 for everyone)
WITH pu AS (
  SELECT user_id::VARCHAR AS uid,
    COUNT(*) FILTER (WHERE event = 'report submitted') AS rep,
    COUNT(*) FILTER (WHERE time::TIMESTAMP <= TIMESTAMP '2026-01-31 00:00:00') AS pre,
    COUNT(*) FILTER (WHERE time::TIMESTAMP > TIMESTAMP '2026-01-31 00:00:00') AS post
  FROM read_json_auto('data/verify-social-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE user_id IS NOT NULL GROUP BY 1
)
SELECT (rep >= 2) AS reporter, COUNT(*) AS users, ROUND(AVG(post::DOUBLE / pre), 3) AS post_pre_ratio
FROM pu WHERE pre > 0 GROUP BY 1 ORDER BY 1;

-- H8: WEEKEND SURGE — weekend vs weekday daily creation rate
-- Expected: ~1.25x (organic counterfactual 0.98 — flat DOW baseline)
WITH d AS (
  SELECT time::DATE AS dt, COUNT(*) AS n
  FROM read_json_auto('data/verify-social-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event IN ('post created', 'story created') GROUP BY 1
)
SELECT
  ROUND(AVG(n) FILTER (WHERE EXTRACT(DOW FROM dt) IN (0, 6)), 1) AS weekend_per_day,
  ROUND(AVG(n) FILTER (WHERE EXTRACT(DOW FROM dt) NOT IN (0, 6)), 1) AS weekday_per_day,
  ROUND(AVG(n) FILTER (WHERE EXTRACT(DOW FROM dt) IN (0, 6))
      / AVG(n) FILTER (WHERE EXTRACT(DOW FROM dt) NOT IN (0, 6)), 3) AS ratio
FROM d;

-- H9: MAGIC NUMBER — comment_length by FINAL post-count bucket
-- Expected: sweet(3-7) ~250, low(0-2) ~200, over(8+) ~145; sweet/over ~1.72
WITH pu AS (
  SELECT user_id::VARCHAR AS uid,
    COUNT(*) FILTER (WHERE event = 'post created') AS pc
  FROM read_json_auto('data/verify-social-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE user_id IS NOT NULL GROUP BY 1
)
SELECT CASE WHEN pu.pc >= 8 THEN 'over' WHEN pu.pc >= 3 THEN 'sweet' ELSE 'low' END AS bucket,
  COUNT(DISTINCT pu.uid) AS users, COUNT(*) AS n_comments, ROUND(AVG(e.comment_length), 1) AS avg_len
FROM read_json_auto('data/verify-social-EVENTS*.json', sample_size=-1, union_by_name=true) e
JOIN pu ON e.user_id::VARCHAR = pu.uid
WHERE e.event = 'comment posted' AND e.comment_length IS NOT NULL
GROUP BY 1 ORDER BY 1;

-- H10: ONBOARDING TTC by account_type — DIRECTION ONLY via MIN-join
-- (funnel-post gap scaling needs per-instance greedy matching; the story
-- asserts fast/personal ~0.71 through emulateBreakdown @6h window)
SELECT u.account_type, COUNT(*) AS converters,
  ROUND(MEDIAN(EXTRACT(EPOCH FROM (pc.t - ac.t)) / 60), 1) AS median_ttc_min
FROM
  (SELECT user_id, MIN(time::TIMESTAMP) AS t
   FROM read_json_auto('data/verify-social-EVENTS*.json', sample_size=-1, union_by_name=true)
   WHERE event = 'account created' GROUP BY user_id) ac
  JOIN
  (SELECT user_id, MIN(time::TIMESTAMP) AS t
   FROM read_json_auto('data/verify-social-EVENTS*.json', sample_size=-1, union_by_name=true)
   WHERE event = 'post created' GROUP BY user_id) pc USING (user_id)
  JOIN read_json_auto('data/verify-social-USERS*.json', sample_size=-1, union_by_name=true) u
   ON ac.user_id = u.distinct_id
WHERE pc.t > ac.t
GROUP BY u.account_type ORDER BY u.account_type;

-- Identity invariants — expected uid_share 1.0, device_share >= 0.99, devices/user ~2
SELECT ROUND(AVG((user_id IS NOT NULL)::INT), 4) AS uid_share,
  ROUND(AVG((device_id IS NOT NULL)::INT), 4) AS device_share,
  ROUND(COUNT(DISTINCT device_id)::DOUBLE / COUNT(DISTINCT user_id), 2) AS devices_per_user
FROM read_json_auto('data/verify-social-EVENTS*.json', sample_size=-1, union_by_name=true);
