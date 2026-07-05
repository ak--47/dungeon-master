-- ============================================================
-- dating.js — v1.6 human-inspection queries (DuckDB)
--
-- Every query is keyed to a story id in dating.js's `stories` export;
-- the machine-checked verdicts come from:
--   node scripts/verify-stories.mjs dungeons/vertical/dating/dating.js --data-prefix verify-dating
-- Generate first:
--   node scripts/verify-runner.mjs dungeons/vertical/dating/dating.js verify-dating
-- Run this file:
--   duckdb -c ".read dungeons/vertical/dating/dating.sql"
-- ============================================================

-- ── identity-resolution prelude ─────────────────────────────
-- avgDevicePerUser: 2 + profile created is both isAuthEvent and
-- isFirstEvent, so born users auth on their first event; the device-pool
-- resolve is belt-and-braces for any device-only edge.
CREATE OR REPLACE VIEW users AS
SELECT * FROM read_json_auto('data/verify-dating-USERS*.json', sample_size=-1, union_by_name=true);

CREATE OR REPLACE VIEW device_map AS
-- profiles store the device pool under the legacy "anonymousIds" key
SELECT unnest("anonymousIds") AS device_id, distinct_id FROM users;

CREATE OR REPLACE VIEW ev AS
-- ::VARCHAR casts — user_id sniffs as UUID, device_id as VARCHAR; DuckDB
-- refuses to coalesce mixed types
SELECT coalesce(m.distinct_id::VARCHAR, e.user_id::VARCHAR, e.device_id::VARCHAR) AS uid,
       e.time::TIMESTAMP AS t,
       e.*
FROM read_json_auto('data/verify-dating-EVENTS*.json', sample_size=-1, union_by_name=true) e
LEFT JOIN device_map m ON e.device_id = m.device_id;

-- Per-user counts. Deletions-only hooks (H5 ghosting, H8 off-app drop,
-- future-time guard) make hook-time cohort recovery ONE-SIDED: output
-- count >= threshold implies hook-time count >= threshold, but not the
-- reverse. Stories handle this with output-implies-hook cohort choices;
-- read these tables the same way.
CREATE OR REPLACE VIEW per_user AS
SELECT uid,
  count(*) FILTER (WHERE event = 'photo uploaded') AS photos,
  count(*) FILTER (WHERE event = 'match received') AS matches,
  count(*) FILTER (WHERE event = 'swipe right') AS swipes,
  count(*) FILTER (WHERE event = 'swipe right' AND is_super_like = true) AS sls,
  count(*) FILTER (WHERE event = 'message sent') AS msgs,
  count(*) FILTER (WHERE event = 'date scheduled') AS dates
FROM ev GROUP BY 1;

-- output-visible timely pair (match → message within 48h) proves the user
-- was NOT ghosted at hook time (H5 deletes but never adds)
CREATE OR REPLACE VIEW timely AS
SELECT DISTINCT a.uid FROM ev a
JOIN ev b ON b.uid = a.uid AND b.event = 'message sent'
WHERE a.event = 'match received' AND b.t > a.t AND b.t < a.t + INTERVAL 48 HOUR;

-- output-visible early milestone (phone/date inside first 14 days)
CREATE OR REPLACE VIEW first_ev AS
SELECT uid, min(t) AS f FROM ev GROUP BY 1;

CREATE OR REPLACE VIEW milestone AS
SELECT DISTINCT e.uid FROM ev e JOIN first_ev fe ON fe.uid = e.uid
WHERE e.event IN ('phone number exchanged', 'date scheduled')
  AND e.t < fe.f + INTERVAL 14 DAY;


-- ── H1-photo-magic-number ───────────────────────────────────
-- score cut: 6+ uploaders' match_score × 0.65 applied at the END of the
-- everything hook (covers H3/H4-injected matches too). Compare vs 0-1
-- uploaders, NOT vs sweet (sweet users' H1 clones redraw score U[60,98]).
SELECT CASE WHEN p.photos >= 6 THEN 'over' WHEN p.photos <= 1 THEN 'low' ELSE 'sweet' END AS grp,
  count(DISTINCT p.uid) AS users, round(avg(e.match_score), 2) AS avg_score
FROM per_user p JOIN ev e ON e.uid = p.uid AND e.event = 'match received'
GROUP BY 1 ORDER BY 1;
-- read: over/low avg_score ≈ 0.65 (knob); sweet reads high (clone redraws)

-- count lift: activity-normalized double ratio, Free tier, H3's additive
-- term subtracted arithmetically (adj = matches − 3·super_likes).
-- Conditioning on sls=0 instead would select the near-inactive tail
-- (P(no SL) ≈ 0.9^swipes) and starve the sweet cell. DD ≈ 1+E[U{2..4}] = 4.
SELECT CASE WHEN p.photos BETWEEN 2 AND 5 THEN 'sweet' WHEN p.photos <= 1 THEN 'low' END AS arm,
  count(*) AS users, round(avg(p.matches - 3 * p.sls), 3) AS avg_adj_m, round(avg(p.swipes), 3) AS avg_s
FROM per_user p JOIN users u ON u.distinct_id::VARCHAR = p.uid
WHERE u.subscription = 'Free' AND p.swipes > 0
  AND (p.photos BETWEEN 2 AND 5 OR p.photos <= 1)
GROUP BY 1 ORDER BY 1;
-- read: (avg_adj_m_sweet/avg_adj_m_low) ÷ (avg_s_sweet/avg_s_low) ≈ 4


-- ── H2-sunday-swipe-surge ───────────────────────────────────
-- Sunday swipes cloned in place: evening (18-23 UTC) ×6, daytime ×3.
-- dayofweek(): Sunday = 0 (matches JS getUTCDay).
SELECT dayofweek(t) AS dow, count(*) AS swipes
FROM ev WHERE event = 'swipe right' GROUP BY 1 ORDER BY 1;
-- read: dow 0 strict max; Sunday / mean(other six) in [2, 6]

-- hour-of-day mix inside Sunday (evening share drives where the
-- multiplier lands between 3 and 6)
SELECT CASE WHEN extract(hour FROM t) >= 18 THEN 'evening' ELSE 'daytime' END AS bucket,
  count(*) AS sunday_swipes
FROM ev WHERE event = 'swipe right' AND dayofweek(t) = 0 GROUP BY 1 ORDER BY 1;


-- ── H3-super-like-effect ────────────────────────────────────
-- each super-like injects exactly 3 cloned matches (additive, scores
-- U[70,99]). Cohort: Free, photos outside sweet 2-5 (isolates from H1/H4).
SELECT CASE WHEN p.sls >= 1 THEN 'super_liker' ELSE 'no_sl' END AS arm,
  count(*) AS users, round(avg(p.matches), 3) AS avg_m,
  round(avg(p.swipes), 3) AS avg_s, round(avg(p.sls), 3) AS avg_sl
FROM per_user p JOIN users u ON u.distinct_id::VARCHAR = p.uid
WHERE u.subscription = 'Free' AND p.photos NOT BETWEEN 2 AND 5 AND p.swipes > 0
GROUP BY 1 ORDER BY 1;
-- read: measured lift avg_m(sl)/[avg_m(none) × avg_s(sl)/avg_s(none)]
-- vs predicted (organic + 3·avg_sl)/organic — ratio ≈ 1

-- injected-match score floor: H3 clones draw match_score U[70,99]; for
-- non-over-6 users nothing lowers scores, so super-liker matches skew high
SELECT CASE WHEN p.sls >= 1 THEN 'super_liker' ELSE 'no_sl' END AS arm,
  round(avg(e.match_score), 2) AS avg_score, median(e.match_score) AS med_score
FROM per_user p JOIN ev e ON e.uid = p.uid AND e.event = 'match received'
WHERE p.photos < 6 GROUP BY 1 ORDER BY 1;


-- ── H4-premium-match-boost ──────────────────────────────────
-- H4 runs after H5's churn: surviving matches × 2 (Premium) / × 4 (Elite),
-- toAdd = base×mult − base exactly. Tier ⊥ activity → cross-tier avg ratio
-- reads the multiplier (diluted only by zero-hook-match users).
SELECT u.subscription AS tier, count(*) AS users,
  round(avg(coalesce(p.matches, 0)), 3) AS avg_matches
FROM users u LEFT JOIN per_user p ON p.uid = u.distinct_id::VARCHAR
GROUP BY 1 ORDER BY avg_matches;
-- read: Elite/Free ≈ 4, Premium/Free ≈ 2 (both slightly diluted)

-- structural signature: timely ∩ milestone Elite users (non-ghosted, H8
-- add-branch) have matches ≡ 0 mod 4 except the ~1-2% future-guard tail;
-- Free is the placebo (~0.25 random).
SELECT u.subscription AS tier, count(*) AS users,
  round(count(*) FILTER (WHERE p.matches % 4 = 0)::DOUBLE / count(*), 4) AS mod4_share
FROM users u
JOIN per_user p ON p.uid = u.distinct_id::VARCHAR
JOIN timely tp ON tp.uid = p.uid
JOIN milestone ms ON ms.uid = p.uid
WHERE p.matches >= 4 AND u.subscription IN ('Elite', 'Free')
GROUP BY 1 ORDER BY 1;
-- read: Elite mod4_share ≥ 0.9, Free ≈ 0.25


-- ── H5-ghosting-churn ───────────────────────────────────────
-- no timely message within 48h of any match → 80% of post-first-match
-- events dropped (keep 0.2). Non-milestone restriction: H8's post-day-30
-- drop applies to BOTH arms and cancels in the ρ ratio (milestone users
-- get H8 ADDS, which would inflate the timely arm only).
-- The raw ρ ratio is confounded DOWNWARD by activity selection (the
-- ghosted arm is the least-engaged matched tail on a flatter organic
-- trajectory), so the story self-calibrates on the PRE-first-match
-- half-split (rho_pre) — H5 never touches pre-match events.
WITH fm AS (SELECT uid, min(t) AS first_match FROM ev WHERE event = 'match received' GROUP BY 1),
per AS (
  SELECT fm.uid,
    count(*) FILTER (WHERE e.t <= fm.first_match) AS pre,
    count(*) FILTER (WHERE e.t > fm.first_match) AS post,
    count(*) FILTER (WHERE e.t <= to_timestamp((epoch(fe.f) + epoch(fm.first_match)) / 2)) AS pre_a,
    count(*) FILTER (WHERE e.t > to_timestamp((epoch(fe.f) + epoch(fm.first_match)) / 2) AND e.t <= fm.first_match) AS pre_b
  FROM fm JOIN first_ev fe ON fe.uid = fm.uid JOIN ev e ON e.uid = fm.uid GROUP BY 1
)
SELECT CASE WHEN tp.uid IS NOT NULL THEN 'timely' ELSE 'ghosted' END AS arm,
  count(*) AS users, round(sum(post)::DOUBLE / nullif(sum(pre), 0), 4) AS rho,
  round(sum(pre_b)::DOUBLE / nullif(sum(pre_a), 0), 4) AS rho_pre
FROM per LEFT JOIN timely tp ON tp.uid = per.uid
WHERE per.uid NOT IN (SELECT uid FROM milestone)
GROUP BY 1 ORDER BY 1;
-- read: (rho_g/rho_t) ÷ (rho_pre_g/rho_pre_t) ≈ 0.2 keep rate (±40%)


-- ── H6-bio-prompt-power-users ───────────────────────────────
-- bio ≥1 ∧ prompts ≥3 → 3 cloned dates per existing date (×4 at hook
-- time). At ~190 events/user the power cohort is ~80% of users; the rest
-- arm is the low-activity tail whose messages come disproportionately
-- from Date Funnel instances (which co-emit dates), so its ORGANIC
-- dates-per-message runs ~2× the power arm's. Population rate ratio is a
-- composite: 4× mechanism × 0.4-0.85 composition → [1.5, 3.4].
WITH pw AS (
  SELECT uid,
    count(*) FILTER (WHERE event = 'bio updated') AS bios,
    count(*) FILTER (WHERE event = 'prompt answered') AS prompts,
    count(*) FILTER (WHERE event = 'date scheduled') AS dates,
    count(*) FILTER (WHERE event = 'message sent') AS msgs
  FROM ev GROUP BY 1
)
SELECT CASE WHEN bios >= 1 AND prompts >= 3 THEN 'power' ELSE 'rest' END AS arm,
  count(*) AS users, round(sum(dates)::DOUBLE / sum(msgs), 5) AS date_rate
FROM pw WHERE msgs > 0 GROUP BY 1 ORDER BY 1;
-- read: power/rest date_rate in [1.5, 3.4] (composite, see above)

-- exact mechanism: timely ∩ milestone power users have no post-H6 date
-- deletions → output dates ≡ 0 (mod 4) except the ~9% future-guard tail
-- (H6 clones stamped source+1..72h past datasetEnd silently dropped);
-- clean-cohort rest arm is the placebo (~0.25 random).
WITH pw AS (
  SELECT uid,
    count(*) FILTER (WHERE event = 'bio updated') AS bios,
    count(*) FILTER (WHERE event = 'prompt answered') AS prompts,
    count(*) FILTER (WHERE event = 'date scheduled') AS dates
  FROM ev GROUP BY 1
)
SELECT CASE WHEN p.bios >= 1 AND p.prompts >= 3 THEN 'power' ELSE 'rest' END AS arm,
  count(*) AS users,
  round(count(*) FILTER (WHERE p.dates % 4 = 0)::DOUBLE / count(*), 4) AS mod4_share
FROM pw p
JOIN timely tp ON tp.uid = p.uid
JOIN milestone ms ON ms.uid = p.uid
WHERE p.dates >= 4 GROUP BY 1 ORDER BY 1;
-- read: power mod4_share ≥ 0.9, rest ≈ 0.25


-- ── H7-vday-spike ───────────────────────────────────────────
-- V-Day window = dataset days 58-63 (2026-02-28 → 2026-03-05): signups
-- ×3 total (clones +U[1,48]h, E[leak] 20%), upgrades ×5 total (clones
-- +U[1,24]h, E[leak] 10%). Baseline flanks skip 3 days post-window so
-- clone spill can't inflate them.
SELECT date_trunc('day', t) AS day, count(*) AS signups
FROM ev WHERE event = 'profile created'
  AND t >= TIMESTAMP '2026-02-21' AND t < TIMESTAMP '2026-03-12'
GROUP BY 1 ORDER BY 1;
-- read: 02-28..03-04 daily ≈ 2.6× the flanking days

SELECT
  count(*) FILTER (WHERE t >= TIMESTAMP '2026-02-28' AND t < TIMESTAMP '2026-03-05') / 5.0 AS window_daily,
  count(*) FILTER (WHERE (t >= TIMESTAMP '2026-02-14' AND t < TIMESTAMP '2026-02-28')
                OR (t >= TIMESTAMP '2026-03-08' AND t < TIMESTAMP '2026-03-22')) / 28.0 AS baseline_daily
FROM ev WHERE event = 'premium upgrade';
-- read: window/baseline ≈ 4.6 (band [3.5, 5.6])


-- ── H8-offapp-retention ─────────────────────────────────────
-- milestone users (early phone/date) get post-day-30 top-up clones toward
-- 30% share; non-milestone lose 80% of post-day-30 events. Cohort: born
-- before day 30 (clone support day30+U[1,60] fits the 121-day window) AND
-- timely-or-match-free (removes the H5 confound).
WITH per AS (
  SELECT fe.uid,
    count(*) FILTER (WHERE e.t > fe.f + INTERVAL 30 DAY) AS post30,
    count(*) AS total
  FROM first_ev fe JOIN ev e ON e.uid = fe.uid
  WHERE fe.f < TIMESTAMP '2026-01-31' GROUP BY 1
)
SELECT CASE WHEN ms.uid IS NOT NULL THEN 'milestone' ELSE 'rest' END AS arm,
  count(*) AS users, round(sum(post30)::DOUBLE / sum(total), 4) AS post30_share
FROM per
LEFT JOIN milestone ms ON ms.uid = per.uid
LEFT JOIN timely tp ON tp.uid = per.uid
LEFT JOIN per_user pu ON pu.uid = per.uid
WHERE tp.uid IS NOT NULL OR coalesce(pu.matches, 0) = 0
GROUP BY 1 ORDER BY 1;
-- read: with keep k=0.2 and milestone share s (≈ organic), predicted rest
-- share = k·s / (1 − (1−k)·s); measured rest / predicted ≈ 1


-- ── H9-match-flow-ttc ───────────────────────────────────────
-- funnel-post stretches Match Flow gaps by tier: Elite ×0.71, Free ×1.4,
-- Premium untouched (v1.6 scopes the hook to Match Flow only).
-- CAUTION: cross-event TTC SQL here is the documented greedy-single-pass
-- limitation — it pairs swipes/matches across funnel instances and buries
-- the signal. The story asserts TTC through the Mixpanel-aligned emulator
-- (timeToConvert, 33.6h window = 24h generative × 1.4 max stretch); trust
-- the story verdict, not ad-hoc pair SQL.
SELECT u.subscription AS tier, count(*) AS matches
FROM ev e JOIN users u ON u.distinct_id::VARCHAR = e.uid
WHERE e.event = 'match received' GROUP BY 1 ORDER BY 1;


-- ── H10-age-date-conversion ─────────────────────────────────
-- funnel-pre scales Date Funnel completion: 25-29/30-34 ×1.3, 40+ ×0.6.
-- Emulator story reads step_counts at the 72h generative window; this
-- query approximates the same read with a sequenced 72h pairing per user
-- (close enough for eyeballing, not for the verdict).
WITH msg AS (SELECT uid, min(t) AS m0 FROM ev WHERE event = 'message sent' GROUP BY 1),
done AS (
  SELECT DISTINCT m.uid FROM msg m
  JOIN ev d ON d.uid = m.uid AND d.event = 'date scheduled'
  WHERE d.t > m.m0 AND d.t < m.m0 + INTERVAL 72 HOUR
)
SELECT u.age_range, count(*) AS msg_users,
  round(count(*) FILTER (WHERE dn.uid IS NOT NULL)::DOUBLE / count(*), 4) AS date_rate_72h
FROM msg m
JOIN users u ON u.distinct_id::VARCHAR = m.uid
LEFT JOIN done dn ON dn.uid = m.uid
GROUP BY 1 ORDER BY 1;
-- read: 25-29/30-34 rates > 18-24/35-39 > 40+ (compressed vs the
-- 1.3/0.6 knobs by organic age-independent dates)
