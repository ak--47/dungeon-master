-- ============================================================
-- real-estate.js — v1.6 human-inspection queries (DuckDB)
--
-- Every query is keyed to a story id in real-estate.js's `stories` export;
-- the machine-checked verdicts come from:
--   node scripts/verify-stories.mjs dungeons/vertical/real-estate/real-estate.js --data-prefix verify-real-estate
-- Generate first:
--   node scripts/verify-runner.mjs dungeons/vertical/real-estate/real-estate.js verify-real-estate
-- Run this file:
--   duckdb -c ".read dungeons/vertical/real-estate/real-estate.sql"
--
-- NOTE: this dungeon uses a LITERAL historical window (datasetStart
-- 2026-01-01 → datasetEnd 2026-05-01, no forward shift), so
-- day_idx = date_diff('day', DATE '2026-01-01', t::DATE) matches the
-- hook's day offsets exactly. H10's TTC-by-tier read is emulator-only
-- (timeToConvert in the stories) — greedy SQL pairing can't isolate the
-- funnel-instance the hook stretched, so there is no SQL twin here.
-- ============================================================

-- ── identity-resolution prelude ─────────────────────────────
-- avgDevicePerUser: 2 + 'account created' is both isAuthEvent and
-- isFirstEvent, so every user auths on their very first event; the
-- device-pool resolve is belt-and-braces for any device-only edge.
CREATE OR REPLACE VIEW users AS
SELECT * FROM read_json_auto('data/verify-real-estate-USERS*.json', sample_size=-1, union_by_name=true);

CREATE OR REPLACE VIEW device_map AS
-- profiles store the device pool under the legacy "anonymousIds" key
SELECT unnest("anonymousIds") AS device_id, distinct_id FROM users;

CREATE OR REPLACE VIEW ev AS
-- ::VARCHAR casts — user_id sniffs as UUID, device_id as VARCHAR; DuckDB
-- refuses to coalesce mixed types
SELECT coalesce(m.distinct_id::VARCHAR, e.user_id::VARCHAR, e.device_id::VARCHAR) AS uid,
       e.time::TIMESTAMP AS t,
       date_diff('day', DATE '2026-01-01', e.time::TIMESTAMP::DATE) AS day_idx,
       e.*
FROM read_json_auto('data/verify-real-estate-EVENTS*.json', sample_size=-1, union_by_name=true) e
LEFT JOIN device_map m ON e.device_id = m.device_id;

-- Per-user aggregates. Output-cohort classification is exact for the
-- behavioral cohorts below: H8 (cold lead) classifies after all first-14d
-- view/save mutations are in the array, H9's view count is untouched by
-- later hooks, and H3's first-7d saved-search events are never deleted.
CREATE OR REPLACE VIEW pu AS
SELECT e.uid, min(e.t) AS first_t, max(e.t) AS last_t,
  count(*) AS total_ev,
  count(*) FILTER (WHERE event = 'property viewed') AS views,
  count(*) FILTER (WHERE event = 'offer submitted') AS offers,
  count(*) FILTER (WHERE event = 'property listed') AS listings,
  count(*) FILTER (WHERE event = 'property sold') AS solds,
  count(*) FILTER (WHERE event = 'virtual tour') AS vtours,
  count(*) FILTER (WHERE event = 'in-person tour') AS iptours,
  count(*) FILTER (WHERE event = 'mortgage pre-approval') AS preapps
FROM ev e GROUP BY 1;

CREATE OR REPLACE VIEW puu AS
SELECT p.*, u.agent_tier, u.user_type, u.pre_approval_status,
  EXISTS (SELECT 1 FROM ev s WHERE s.uid = p.uid AND s.event = 'saved search created'
          AND s.t < p.first_t + INTERVAL '7 days') AS saver,
  EXISTS (SELECT 1 FROM ev v WHERE v.uid = p.uid AND v.event = 'property viewed'
          AND v.t < p.first_t + INTERVAL '14 days') AS viewed14,
  EXISTS (SELECT 1 FROM ev sv WHERE sv.uid = p.uid AND sv.event = 'property saved'
          AND sv.t < p.first_t + INTERVAL '14 days') AS saved14,
  (p.vtours >= 1 AND p.iptours >= 1) AS dual_tour,
  (p.preapps >= 1) AS preapproved
FROM pu p JOIN users u ON p.uid = u.distinct_id::VARCHAR;


-- ── H1-spring-season: offer_price ×2.5 + tour duration ×3, days 30-60 ──
SELECT 'H1 offer price spring vs outside (expect ~2.6x)' AS q;
SELECT CASE WHEN day_idx BETWEEN 30 AND 59 THEN 'spring' ELSE 'outside' END AS zone,
  count(*) AS n, round(avg(offer_price), 0) AS avg_price, round(median(offer_price), 0) AS med_price
FROM ev WHERE event = 'offer submitted' GROUP BY 1;

SELECT 'H1 tour duration spring vs outside (expect ~2.65x — H3 clone leak dilutes the 3x knob)' AS q;
SELECT CASE WHEN day_idx BETWEEN 30 AND 59 THEN 'spring' ELSE 'outside' END AS zone,
  count(*) AS n, round(avg(duration_mins), 2) AS avg_dur
FROM ev WHERE event = 'tour scheduled' GROUP BY 1;

-- ── H2-rate-shock: mortgage_rate pinned 7.5 days 75-89; offers -45% post-75 ──
SELECT 'H2 rate pin (shock min=max=7.5; outside ~6.35)' AS q;
SELECT CASE WHEN day_idx BETWEEN 75 AND 88 THEN 'shock' ELSE 'outside' END AS zone,
  count(*) AS n, round(avg(mortgage_rate), 4) AS avg_rate, min(mortgage_rate) AS mn, max(mortgage_rate) AS mx
FROM ev WHERE event = 'mortgage pre-approval' GROUP BY 1;

SELECT 'H2 offer share-of-volume pre vs post d75 (expect ratio ~0.77 = 0.55 knob x clone drift)' AS q;
SELECT (day_idx > 75) AS post,
  count(*) FILTER (WHERE event = 'offer submitted') AS offers, count(*) AS all_ev,
  round(count(*) FILTER (WHERE event = 'offer submitted')::DOUBLE / count(*), 5) AS offer_share
FROM ev GROUP BY 1 ORDER BY 1;

-- ── H3-saved-search-retention: savers cloned forward, non-savers cut post-d30 ──
SELECT 'H3 events/user post-day-30 by saver (expect ~6-7x)' AS q;
SELECT saver, count(*) AS n_users,
  round(avg((SELECT count(*) FROM ev e WHERE e.uid = puu.uid AND e.day_idx > 30)), 2) AS ev_post30_pu
FROM puu GROUP BY 1;

SELECT 'H3 active-in-April, born pre-March (expect savers ~0.98 vs non ~0.55)' AS q;
SELECT saver, count(*) AS n_users, round(avg((last_t >= TIMESTAMP '2026-04-01')::INT), 4) AS active_apr
FROM puu WHERE first_t < TIMESTAMP '2026-03-01' GROUP BY 1;

-- ── H4-preapproval-conversion: 4-6 offer clones for pre-approved users ──
SELECT 'H4 offers/user by pre-approval event cohort (expect ~4.5x)' AS q;
SELECT preapproved, count(*) AS n_users, round(avg(offers), 3) AS offers_pu
FROM puu GROUP BY 1;

SELECT 'H4 profile flag superset check (expect flagged = 1.0 among event cohort)' AS q;
SELECT round(avg((pre_approval_status = 'approved')::INT), 4) AS flagged, count(*) AS n
FROM puu WHERE preapproved;

-- ── H5-premier-agents: 3x listings / 2x sales for Premier tier ──
SELECT 'H5 listings + sales per user by agent_tier (expect ~2.8x / ~1.9x)' AS q;
SELECT agent_tier, count(*) AS n_users,
  round(avg(listings), 4) AS listings_pu, round(avg(solds), 4) AS solds_pu
FROM puu GROUP BY 1;

-- ── H6-dual-tour-buyers: 5-7 offer clones for virtual+in-person tour users ──
SELECT 'H6 offers/user by dual-tour cohort (expect ~5x)' AS q;
SELECT dual_tour, count(*) AS n_users, round(avg(offers), 3) AS offers_pu
FROM puu GROUP BY 1;

-- exclusion by PROFILE flag (exact hook-time cohort): the event-cohort
-- proxy under-excludes users whose pre-approval event H8 later deleted
-- but who kept their H4 clones, contaminating the baseline (~3.5x)
SELECT 'H6 overlap decomposition: dual-only vs neither, profile-flag pre-approved excluded (expect ~4.8x)' AS q;
SELECT dual_tour, count(*) AS n_users, round(avg(offers), 3) AS offers_pu
FROM puu WHERE pre_approval_status != 'approved' GROUP BY 1;

-- ── H7-luxury-release: $2M+ listings only after day 50; luxury-browser cohort ──
SELECT 'H7 luxury listings by era (expect pre-d50 lux = 0; post share ~1.9% = 3% x 0.643 organic)' AS q;
SELECT (day_idx >= 50) AS post50, count(*) AS n_listings,
  count(*) FILTER (WHERE listing_price >= 2000000) AS lux_n,
  round(count(*) FILTER (WHERE listing_price >= 2000000)::DOUBLE / count(*), 4) AS lux_share
FROM ev WHERE event = 'property listed' GROUP BY 1 ORDER BY 1;

SELECT 'H7 luxury ($5M+) views by browser cohort (uuid first char = c, 1/16 of users; non-browsers expect 0)' AS q;
SELECT (left(puu.uid, 1) = 'c') AS browser, count(*) AS n_users,
  round(avg((SELECT count(*) FROM ev e WHERE e.uid = puu.uid AND e.event = 'property viewed' AND e.listing_price >= 5000000)), 3) AS luxviews_pu
FROM puu GROUP BY 1;

-- ── H8-cold-lead-churn: viewed-but-never-saved in first 14d lose 90% after ──
SELECT 'H8 events/user after first-14d, cold vs rest (expect ~0.13 absolute)' AS q;
SELECT (viewed14 AND NOT saved14) AS cold, count(*) AS n_users,
  round(avg((SELECT count(*) FROM ev e WHERE e.uid = puu.uid AND e.t > puu.first_t + INTERVAL '14 days')), 2) AS ev_post14_pu,
  round(avg((SELECT count(*) FROM ev e WHERE e.uid = puu.uid AND e.t <= puu.first_t + INTERVAL '14 days')), 2) AS ev_pre14_pu
FROM puu WHERE first_t < TIMESTAMP '2026-04-01' GROUP BY 1;

-- ── H9-view-magic-number: 6-12 views => +30% offer_price; 13+ => fewer offers ──
SELECT 'H9 offer price by view bucket, non-spring (expect sweet/low ~1.35; over/low placebo ~1.0)' AS q;
SELECT CASE WHEN p.views BETWEEN 6 AND 12 THEN 'sweet' WHEN p.views < 6 THEN 'low' ELSE 'over' END AS bucket,
  count(*) AS n_offers, count(DISTINCT e.uid) AS n_users, round(avg(e.offer_price), 0) AS avg_price
FROM puu p JOIN ev e ON e.uid = p.uid AND e.event = 'offer submitted'
WHERE e.day_idx NOT BETWEEN 30 AND 59
GROUP BY 1 ORDER BY 1;

SELECT 'H9 offers/user over vs sweet (expect ~0.65 — 60% knob nets the visible ~35% drop)' AS q;
SELECT CASE WHEN views BETWEEN 6 AND 12 THEN 'sweet' WHEN views >= 13 THEN 'over' ELSE 'low' END AS bucket,
  count(*) AS n_users, round(avg(offers), 3) AS offers_pu
FROM puu GROUP BY 1 ORDER BY 1;

-- ── H10-tour-ttc-by-tier: emulator-only (see stories) — identity invariants here ──
SELECT 'H10 identity invariants (expect uid_resolved = 1.0, stamp_agree = 1.0)' AS q;
SELECT count(*) AS n,
  round(avg((u.distinct_id IS NOT NULL)::INT), 6) AS uid_resolved,
  round(avg(CASE WHEN u.distinct_id IS NOT NULL THEN (e.user_type = u.user_type)::INT END), 6) AS stamp_agree
FROM ev e LEFT JOIN users u ON e.uid = u.distinct_id::VARCHAR;
