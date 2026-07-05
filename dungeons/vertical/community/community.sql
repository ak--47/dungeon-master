-- ============================================================
-- community.js — v1.6 human-inspection queries (DuckDB)
--
-- Every query is keyed to a story id in community.js's `stories` export;
-- the machine-checked verdicts come from:
--   node scripts/verify-stories.mjs dungeons/vertical/community/community.js --data-prefix verify-community
-- Generate first:
--   node scripts/verify-runner.mjs dungeons/vertical/community/community.js verify-community
-- Run this file:
--   duckdb -c ".read dungeons/vertical/community/community.sql"
-- ============================================================

-- ── identity-resolution prelude ─────────────────────────────
-- avgDevicePerUser: 2 + account created is both isAuthEvent and
-- isFirstEvent, so born users auth on their first event; the device-pool
-- resolve is belt-and-braces for any device-only edge.
CREATE OR REPLACE VIEW users AS
SELECT * FROM read_json_auto('data/verify-community-USERS*.json', sample_size=-1, union_by_name=true);

CREATE OR REPLACE VIEW device_map AS
-- profiles store the device pool under the legacy "anonymousIds" key
SELECT unnest("anonymousIds") AS device_id, distinct_id FROM users;

CREATE OR REPLACE VIEW ev AS
-- ::VARCHAR casts — user_id sniffs as UUID, device_id as VARCHAR; DuckDB
-- refuses to coalesce mixed types
SELECT coalesce(m.distinct_id::VARCHAR, e.user_id::VARCHAR, e.device_id::VARCHAR) AS uid,
       e.time::TIMESTAMP AS t,
       e.*
FROM read_json_auto('data/verify-community-EVENTS*.json', sample_size=-1, union_by_name=true) e
LEFT JOIN device_map m ON e.device_id = m.device_id;

-- Per-user counts. Deletions-only hooks (H6 lurker churn, H8 free-tier
-- comment drop, H10 over-publisher upvote drop, future-time guard) make
-- hook-time cohort recovery ONE-SIDED: output count >= threshold implies
-- hook-time count >= threshold, but not the reverse. Stories handle this
-- with output-implies-hook cohort choices; read these tables the same way.
CREATE OR REPLACE VIEW per_user AS
SELECT uid,
  count(*) FILTER (WHERE event = 'article published') AS pubs,
  count(*) FILTER (WHERE event = 'article edited') AS edits,
  count(*) FILTER (WHERE event = 'comment posted') AS comments,
  count(*) FILTER (WHERE event = 'upvote given') AS upvotes,
  count(*) FILTER (WHERE event = 'app session') AS sessions,
  count(*) FILTER (WHERE event = 'discussion posted') AS discussions,
  count(*) AS n
FROM ev GROUP BY 1;

CREATE OR REPLACE VIEW first_ev AS
SELECT uid, min(t) AS f FROM ev GROUP BY 1;


-- ── H1-weekend-word-count ───────────────────────────────────
-- Sat/Sun 'article published' word_count ×1.5 (floored). 'wiki page
-- created' carries the same prop but is untouched — the placebo arm.
-- dayofweek(): Sunday = 0 (matches JS getUTCDay).
SELECT event,
  CASE WHEN dayofweek(t) IN (0, 6) THEN 'weekend' ELSE 'weekday' END AS bucket,
  count(*) AS n, round(avg(word_count), 1) AS avg_wc
FROM ev WHERE event IN ('article published', 'wiki page created')
GROUP BY 1, 2 ORDER BY 1, 2;
-- read: published weekend/weekday ≈ 1.5; wiki ≈ 1.0


-- ── H2-trending-gaming-window ───────────────────────────────
-- days 35-50 EXCLUSIVE (hook uses isAfter/isBefore): gaming-hub users'
-- 'article viewed' view_count ×2. Event content_hub is stamped from the
-- profile BEFORE H2 runs, so it selects exactly the treated users.
SELECT CASE WHEN content_hub = 'gaming' THEN 'gaming' ELSE 'other' END AS hub,
  CASE WHEN t > TIMESTAMP '2026-02-05' AND t < TIMESTAMP '2026-02-20' THEN 'in_window' ELSE 'outside' END AS bucket,
  count(*) AS n, round(avg(view_count), 1) AS avg_vc
FROM ev WHERE event = 'article viewed'
GROUP BY 1, 2 ORDER BY 1, 2;
-- read: gaming in/out ≈ 2.0; other in/out ≈ 1.0


-- ── H3-power-creator-upvotes ────────────────────────────────
-- >20 publishes at hook time → upvote_count ×3 (floor(3w)=3w exact on
-- integers). Publishes never deleted → output ≥21 IMPLIES treatment.
SELECT CASE WHEN p.pubs > 20 THEN 'power' WHEN p.pubs <= 1 THEN 'low' END AS arm,
  count(DISTINCT p.uid) AS users, round(avg(e.upvote_count), 2) AS avg_uc,
  round(count(*) FILTER (WHERE e.upvote_count % 3 = 0)::DOUBLE / count(*), 4) AS mod3_share
FROM per_user p JOIN ev e ON e.uid = p.uid AND e.event = 'upvote given'
WHERE p.pubs > 20 OR p.pubs <= 1
GROUP BY 1 ORDER BY 1;
-- read: power/low avg_uc ≈ 3.0; power mod3_share ≈ 1.0, low ≈ 0.2-0.35


-- ── H4-discussion-depth ─────────────────────────────────────
-- active_contributor (role 'contributor') clones 50% of surviving comments
-- as is_reply=true. Raw counts are persona-confounded (1.5× vs 0.3×
-- multipliers) AND conversion-gated (comments are funnel steps;
-- contributor conversionModifier 1.0 vs reader 0.5), so the raw
-- comments-per-session DD over-estimates (~2.1) while the
-- discussion-calibrated DD under-estimates (discussions sit deeper in
-- their funnel — EL step 4 vs comment step 3 — so the calibrator
-- over-corrects). The two bracket the 1.5 knob with sign-known biases.
SELECT u.role, count(DISTINCT u.distinct_id) AS users,
  round(sum(p.comments)::DOUBLE / nullif(sum(p.sessions), 0), 4) AS comments_per_session,
  round(sum(p.discussions)::DOUBLE / nullif(sum(p.sessions), 0), 4) AS discussions_per_session
FROM users u JOIN per_user p ON p.uid = u.distinct_id::VARCHAR
WHERE u.role IN ('contributor', 'reader')
GROUP BY 1 ORDER BY 1;
-- read: corrected DD = (comments DD ÷ discussions DD) ≤ 1.5 ≤ raw comments DD

-- reply-share composition: clones are always replies → contributor share
-- shifts from the organic 2/3 to (2/3 + 0.5)/1.5 ≈ 0.778 (drop-invariant)
SELECT u.role,
  round(count(*) FILTER (WHERE e.is_reply = true)::DOUBLE / count(*), 4) AS reply_share
FROM users u JOIN ev e ON e.uid = u.distinct_id::VARCHAR AND e.event = 'comment posted'
WHERE u.role IN ('contributor', 'reader')
GROUP BY 1 ORDER BY 1;
-- read: contributor ≈ 0.778, reader ≈ 0.667


-- ── H5-edit-war ─────────────────────────────────────────────
-- >5 edits at hook time → ALL edit_quality redrawn U[1.0, 2.0]. Edits
-- never deleted → output ≥6 IMPLIES treatment → redraw is EXACT on the
-- war arm: avg 1.5, zero values above 2.0.
SELECT CASE WHEN p.edits > 5 THEN 'war' WHEN p.edits BETWEEN 1 AND 4 THEN 'calm' END AS arm,
  count(DISTINCT p.uid) AS users, round(avg(e.edit_quality), 3) AS avg_q,
  count(*) FILTER (WHERE e.edit_quality > 2.0) AS over_cap
FROM per_user p JOIN ev e ON e.uid = p.uid AND e.event = 'article edited'
WHERE p.edits > 5 OR p.edits BETWEEN 1 AND 4
GROUP BY 1 ORDER BY 1;
-- read: war avg_q ≈ 1.5 with over_cap = 0; calm avg_q ≈ 3 (organic 1-5)


-- ── H6-lurker-churn ─────────────────────────────────────────
-- <5 events at hook time → 60% of post-day-10 events dropped (keep 0.4).
-- Output n∈[2,4] implies treated; output n∈[5,8] implies untreated.
-- n=1 users carry no churn information (post=0 and days-5-10=0 by
-- construction) and are excluded; the control band is ADJACENT ([5,8],
-- not [6,10]) because the front-loading calibration transfers better
-- between closer activity levels. Arms restricted to role 'reader'.
-- Raw post/pre ratio is confounded by organic front-loading, so calibrate
-- on the pre-cutoff half-split (days 0-5 vs 5-10 — never touched by H6).
SELECT CASE WHEN p.n BETWEEN 2 AND 4 THEN 'tiny' WHEN p.n BETWEEN 5 AND 8 THEN 'small' END AS arm,
  count(DISTINCT p.uid) AS users,
  round(sum(CASE WHEN e.t > fe.f + INTERVAL 10 DAY THEN 1 ELSE 0 END)::DOUBLE
    / nullif(sum(CASE WHEN e.t <= fe.f + INTERVAL 10 DAY THEN 1 ELSE 0 END), 0), 4) AS rho,
  round(sum(CASE WHEN e.t > fe.f + INTERVAL 5 DAY AND e.t <= fe.f + INTERVAL 10 DAY THEN 1 ELSE 0 END)::DOUBLE
    / nullif(sum(CASE WHEN e.t <= fe.f + INTERVAL 5 DAY THEN 1 ELSE 0 END), 0), 4) AS rho_pre
FROM per_user p
JOIN first_ev fe ON fe.uid = p.uid
JOIN ev e ON e.uid = p.uid
JOIN users u ON u.distinct_id::VARCHAR = p.uid AND u.role = 'reader'
WHERE (p.n BETWEEN 2 AND 4 OR p.n BETWEEN 5 AND 8)
  AND fe.f < TIMESTAMP '2026-04-15'   -- exclude births without a post window
GROUP BY 1 ORDER BY 1;
-- read: (rho_tiny/rho_small) ÷ (rho_pre_tiny/rho_pre_small) ≈ 0.4 keep rate


-- ── H7-creator-profiles ─────────────────────────────────────
-- user hook overwrites per role: creator art U[50,200] rep U[80,100];
-- moderator U[10,50]/U[40,70]; contributor U[1,15]/U[15,50]; reader 0/U[0,20].
SELECT role, count(*) AS users,
  min(reputation_score) AS min_rep, round(avg(reputation_score), 2) AS avg_rep, max(reputation_score) AS max_rep,
  min(articles_created) AS min_art, max(articles_created) AS max_art
FROM users GROUP BY 1 ORDER BY 1;
-- read: ranges exact per role; creator avg_rep ≈ 90


-- ── H8-pro-content-lift ─────────────────────────────────────
-- free/non-supporter tiers drop 65% of ALL 'comment posted' (keep 0.35).
-- Tier ⊥ persona → H4's clone factor cancels in the pooled ratio.
SELECT CASE WHEN e.subscription_tier IN ('pro', 'supporter') THEN 'paid' ELSE 'free' END AS arm,
  count(DISTINCT e.uid) AS users,
  round(count(*) FILTER (WHERE e.event = 'comment posted')::DOUBLE
    / nullif(count(*) FILTER (WHERE e.event = 'app session'), 0), 4) AS comments_per_session
FROM ev e GROUP BY 1 ORDER BY 1;
-- read: free/paid comments-per-session ≈ 0.35 (the exact keep rate)


-- ── H9-content-ttc ──────────────────────────────────────────
-- funnel-post scales Content Creation gaps: pro/supporter ×0.77, free
-- ×1.25 (v1.6 scopes the hook to Content Creation only).
-- CAUTION: cross-event TTC SQL here is the documented greedy-single-pass
-- limitation — it pairs views/publishes across funnel instances and buries
-- the signal. The story asserts TTC through the Mixpanel-aligned emulator
-- (timeToConvert, 60h window = 48h generative × 1.25 max stretch); trust
-- the story verdict, not ad-hoc pair SQL.
SELECT u.subscription_tier AS tier, count(*) AS published_events
FROM ev e JOIN users u ON u.distinct_id::VARCHAR = e.uid
WHERE e.event = 'article published' GROUP BY 1 ORDER BY 1;


-- ── H10-article-magic-number ────────────────────────────────
-- sweet spot 2-5 publishes → upvote_count ×1.35 (rounded); 6+ publishes →
-- creator burnout from day 60 (2026-03-02): 40% of upvote events dropped
-- after the cutoff. Value read is persona-clean (iid draw).
SELECT CASE WHEN p.pubs BETWEEN 2 AND 5 THEN 'sweet' WHEN p.pubs <= 1 THEN 'low'
            WHEN p.pubs >= 6 THEN 'over' END AS arm,
  count(DISTINCT p.uid) AS users, round(avg(e.upvote_count), 3) AS avg_uc
FROM per_user p JOIN ev e ON e.uid = p.uid AND e.event = 'upvote given'
GROUP BY 1 ORDER BY 1;
-- read: sweet/low avg_uc ≈ 1.35-1.4 (integer rounding drifts it up)

-- volume read: publish count is intrinsically coupled to activity, so NO
-- cross-arm level comparison works (organic upvote share differs 23-58%
-- across publish bands whatever the denominator). The calendar edge makes
-- it a difference-in-differences: each arm's own after/before
-- upvotes-per-session ratio cancels its activity composition (measured
-- arm-invariant to ~0.1% on untreated data). Contributors only.
SELECT CASE WHEN p.pubs BETWEEN 2 AND 5 THEN 'sweet' WHEN p.pubs >= 6 THEN 'over' END AS arm,
  CASE WHEN e.t >= TIMESTAMP '2026-03-02' THEN 'after' ELSE 'before' END AS period,
  count(DISTINCT p.uid) AS users,
  count(*) FILTER (WHERE e.event = 'upvote given') AS ups,
  count(*) FILTER (WHERE e.event = 'app session') AS sessions
FROM per_user p
JOIN users u ON u.distinct_id::VARCHAR = p.uid AND u.role = 'contributor'
JOIN ev e ON e.uid = p.uid
WHERE p.pubs >= 2
GROUP BY 1, 2 ORDER BY 1, 2;
-- read: DiD = (over after/before ups-per-session) ÷ (sweet after/before)
--       ≈ 0.6 (the keep rate)
