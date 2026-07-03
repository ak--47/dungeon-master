-- ============================================================
-- travel.js — v1.6 human-inspection queries (DuckDB)
--
-- Every query is keyed to a story id in travel.js's `stories` export;
-- the machine-checked verdicts come from:
--   node scripts/verify-stories.mjs dungeons/vertical/travel/travel.js --data-prefix verify-travel
-- Generate first:
--   node scripts/verify-runner.mjs dungeons/vertical/travel/travel.js verify-travel
-- Run this file:
--   duckdb -c ".read dungeons/vertical/travel/travel.sql"
-- ============================================================

-- ── identity-resolution prelude ─────────────────────────────
-- avgDevicePerUser: 2 + account created is both isAuthEvent and
-- isFirstEvent, so born users auth on their first event; the device-pool
-- resolve is belt-and-braces for any device-only edge.
CREATE OR REPLACE VIEW users AS
SELECT * FROM read_json_auto('data/verify-travel-USERS*.json', sample_size=-1, union_by_name=true);

CREATE OR REPLACE VIEW device_map AS
-- profiles store the device pool under the legacy "anonymousIds" key
SELECT unnest("anonymousIds") AS device_id, distinct_id FROM users;

CREATE OR REPLACE VIEW ev AS
-- ::VARCHAR casts — user_id sniffs as UUID, device_id as VARCHAR; DuckDB
-- refuses to coalesce mixed types
SELECT coalesce(m.distinct_id::VARCHAR, e.user_id::VARCHAR, e.device_id::VARCHAR) AS uid,
       e.time::TIMESTAMP AS t,
       e.*
FROM read_json_auto('data/verify-travel-EVENTS*.json', sample_size=-1, union_by_name=true) e
LEFT JOIN device_map m ON e.device_id = m.device_id;

-- Per-user counts. Bookings are only ever DELETED post-generation (H8
-- all-or-nothing per user, H10 post-day-60, future-time guard), so
-- booking-count cohorts are ONE-SIDED: output >= threshold implies
-- hook-time >= threshold. hotel viewed / searches / sessions / reviews /
-- upgrades are never deleted — exact hook-time recovery.
CREATE OR REPLACE VIEW per_user AS
SELECT uid,
  count(*) FILTER (WHERE event = 'hotel viewed') AS hv,
  count(*) FILTER (WHERE event = 'booking completed') AS bookings,
  count(*) FILTER (WHERE event = 'destination searched') AS searches,
  count(*) FILTER (WHERE event = 'app session') AS sessions,
  count(*) FILTER (WHERE event = 'room upgrade selected') AS upgrades,
  count(*) FILTER (WHERE event = 'review submitted') AS reviews
FROM ev GROUP BY 1;

CREATE OR REPLACE VIEW first_ev AS
SELECT uid, min(t) AS f FROM ev GROUP BY 1;

-- Calendar landmarks (dataset 2026-01-01 → 2026-05-01 23:59:59 UTC):
--   advance-stamped region:      t <  '2026-04-08 23:59:59'  (H2, >21d before end + margin)
--   organic middle band:         t in ['2026-04-11 23:59:59', '2026-04-27 23:59:59']
--   last_minute-stamped region:  t >= '2026-04-29 00:59:59'  (<3d before end + margin)
--   H10 fatigue cutoff (day 60): t >= '2026-03-02 00:00:00'


-- ── H1-weekend-rate-surge ───────────────────────────────────
-- Fri/Sat/Sun 'booking completed' nightly_rate ×1.3 (floored). 'hotel
-- viewed' carries the same nightly_rate pool untouched — the placebo arm.
-- dayofweek(): Sunday = 0 (matches JS getUTCDay).
SELECT event,
  CASE WHEN dayofweek(t) IN (0, 5, 6) THEN 'wkn' ELSE 'wkd' END AS bucket,
  count(*) AS n, round(avg(nightly_rate), 1) AS avg_rate
FROM ev WHERE event IN ('booking completed', 'hotel viewed') AND nightly_rate IS NOT NULL
GROUP BY 1, 2 ORDER BY 1, 2;
-- read: booking wkn/wkd ≈ 1.3; hotel viewed ≈ 1.0


-- ── H2-booking-window ───────────────────────────────────────
-- H2 stamps by calendar distance to dataset end: advance (>21d, rate ×0.8),
-- last_minute (<3d, rate ×1.4). The 3-21d middle band keeps ORGANIC labels
-- (2/5 advance, 2/5 standard, 1/5 last_minute) and untouched rates — a
-- label breakdown DILUTES both treated labels; read by calendar REGION
-- with the middle band as baseline instead.
SELECT CASE WHEN t < TIMESTAMP '2026-04-08 23:59:59' THEN 'adv'
            WHEN t >= TIMESTAMP '2026-04-29 00:59:59' THEN 'lm'
            WHEN t >= TIMESTAMP '2026-04-11 23:59:59' AND t <= TIMESTAMP '2026-04-27 23:59:59' THEN 'mid' END AS region,
  count(*) AS n, round(avg(nightly_rate), 1) AS avg_rate,
  round(count(*) FILTER (WHERE booking_window = 'advance')::DOUBLE / count(*), 4) AS adv_share,
  round(count(*) FILTER (WHERE booking_window = 'last_minute')::DOUBLE / count(*), 4) AS lm_share
FROM ev WHERE event = 'booking completed'
GROUP BY 1 ORDER BY 1;
-- read: adv/mid avg_rate ≈ 0.80 (weekend-mix corrected); lm/mid ≈ 1.36;
--       stamped regions label-pure (adv_share / lm_share = 1.0), middle
--       band keeps organic adv_share ≈ 0.4


-- ── H3-loyalty-boost ────────────────────────────────────────
-- >=5 bookings at hook time → loyalty_points ×(2.5 + U[0,1]) floored,
-- E[mult] = 3.0. Output >=5 IMPLIES treatment (deletions-only); control
-- 1-4 bookings AND hv <= 10 (H10 never drops their bookings).
SELECT CASE WHEN p.bookings >= 5 THEN 'big'
            WHEN p.bookings BETWEEN 1 AND 4 AND p.hv <= 10 THEN 'small' END AS arm,
  count(DISTINCT p.uid) AS users, round(avg(e.loyalty_points), 2) AS avg_lp
FROM per_user p JOIN ev e ON e.uid = p.uid AND e.event = 'booking completed'
WHERE p.bookings >= 5 OR (p.bookings BETWEEN 1 AND 4 AND p.hv <= 10)
GROUP BY 1 ORDER BY 1;
-- read: big/small avg_lp ≈ 3.0


-- ── H4-cancel-by-window ─────────────────────────────────────
-- Each 'booking cancelled' is stamped with the booking_window of the
-- user's nearest PRECEDING booking, then 60% of last_minute-stamped
-- cancels are dropped. Replicate the matching with an ASOF JOIN; restrict
-- to matched bookings in the organic middle band (labels iid 0.4/0.4/0.2)
-- for hv <= 10 users (their output booking set = hook-time set).
WITH bk AS (SELECT uid, t, booking_window FROM ev WHERE event = 'booking completed'),
cn AS (
  SELECT e.uid, e.t, e.booking_window AS stamped
  FROM ev e JOIN per_user p ON p.uid = e.uid AND p.hv <= 10
  WHERE e.event = 'booking cancelled'
),
m AS (
  SELECT cn.uid, cn.stamped, bk.booking_window AS matched, bk.t AS bt
  FROM cn ASOF JOIN bk ON cn.uid = bk.uid AND cn.t >= bk.t
)
SELECT matched AS label, count(*) AS n,
  round(count(*) FILTER (WHERE stamped = matched)::DOUBLE / count(*), 4) AS agree
FROM m
WHERE bt >= TIMESTAMP '2026-04-11 23:59:59' AND bt <= TIMESTAMP '2026-04-27 23:59:59'
GROUP BY 1 ORDER BY 1;
-- read: keep = (lm_n / std_n) / 0.5 ≈ 0.4 (the 40% keep rate);
--       adv_n / std_n ≈ 1.0 (placebo); agree ≈ 1.0 (ASOF replicates hook)


-- ── H5-luxury-upsell ────────────────────────────────────────
-- luxury_seeker with an upgrade template: 50% cloned 'room upgrade
-- selected' per booking → +0.5 upgrades-per-booking ADDITIVE. Both arms
-- restricted to template owners and PRE-day-60 counts (H10's post-day-60
-- booking drop would shrink over-viewers' denominators).
SELECT u.customer_segment AS seg, count(DISTINCT pr.uid) AS users,
  round(sum(pr.upgrades_pre)::DOUBLE / sum(pr.bookings_pre), 4) AS upgrades_per_booking
FROM (
  SELECT uid,
    count(*) FILTER (WHERE event = 'booking completed' AND t < TIMESTAMP '2026-03-02') AS bookings_pre,
    count(*) FILTER (WHERE event = 'room upgrade selected' AND t < TIMESTAMP '2026-03-02') AS upgrades_pre
  FROM ev GROUP BY 1
) pr
JOIN per_user p ON p.uid = pr.uid AND p.upgrades >= 1
JOIN users u ON u.distinct_id::VARCHAR = pr.uid
WHERE u.customer_segment IN ('luxury_seeker', 'budget_hunter') AND pr.bookings_pre >= 1
GROUP BY 1 ORDER BY 1;
-- read: lux − budget ≈ +0.5 (plus small positive organic funnel-gap confound)

-- doc-level Insights view: upgrades per user across ALL users
SELECT u.customer_segment AS seg, count(*) AS users,
  round(avg(coalesce(p.upgrades, 0)), 3) AS avg_upgrades
FROM users u LEFT JOIN per_user p ON p.uid = u.distinct_id::VARCHAR
WHERE u.customer_segment IN ('luxury_seeker', 'budget_hunter')
GROUP BY 1 ORDER BY 1;
-- read: lux/budget ≈ 12x — the +0.5 additive clone term dominates the thin
--       organic upsell base (~0.08 upb); the knob-clean read is the
--       upgrades-per-booking DIFFERENCE above


-- ── H6-review-quality ───────────────────────────────────────
-- Per-user avg stay_rating >= 4 → review_length ×1.5; <= 2 → ×0.5.
-- Reviews are never deleted/cloned → output avg EXACTLY reproduces the
-- hook-time classification (arm = the treatment variable itself).
WITH rv AS (SELECT uid, avg(stay_rating) AS avg_r FROM ev WHERE event = 'review submitted' GROUP BY 1)
SELECT CASE WHEN rv.avg_r >= 4 THEN 'high' WHEN rv.avg_r <= 2 THEN 'low' ELSE 'mid' END AS arm,
  count(DISTINCT rv.uid) AS users, round(avg(e.review_length), 1) AS avg_len
FROM rv JOIN ev e ON e.uid = rv.uid AND e.event = 'review submitted'
GROUP BY 1 ORDER BY 1;
-- read: high/mid ≈ 1.5; low/mid ≈ 0.5


-- ── H7-business-profile ─────────────────────────────────────
-- user hook overwrites per segment: business gets company_name (never
-- 'none') + travel_frequency 'weekly'; luxury avg_budget U-int[250,500];
-- budget U-int[50,120]; everyone else keeps company_name 'none'.
SELECT customer_segment AS seg, count(*) AS users,
  round(avg((travel_frequency = 'weekly')::INT), 4) AS weekly_share,
  round(avg((company_name IS NOT NULL AND company_name <> 'none')::INT), 4) AS company_share,
  min(avg_budget_per_night) AS min_budget, max(avg_budget_per_night) AS max_budget
FROM users GROUP BY 1 ORDER BY 1;
-- read: biz weekly_share = company_share = 1.0; others company_share = 0;
--       lux budget within [250, 500]; budget_hunter within [50, 120]


-- ── H8-casual-booking-drop ──────────────────────────────────
-- leisure_family/budget_hunter: 25% per-user chance ALL bookings spliced
-- out. Among users with >= 10 searches (exact activity floor), treated
-- zero-booking share inflates by ~0.25 plus the organic conversion gap.
SELECT CASE WHEN u.customer_segment IN ('leisure_family', 'budget_hunter') THEN 'treated' ELSE 'control' END AS arm,
  count(*) AS users, round(avg((p.bookings = 0)::INT), 4) AS zero_booking_share
FROM per_user p JOIN users u ON u.distinct_id::VARCHAR = p.uid
WHERE p.searches >= 10
GROUP BY 1 ORDER BY 1;
-- read: treated − control ≈ +0.22-0.30; control ≈ <= 0.12


-- ── H9-booking-ttc ──────────────────────────────────────────
-- funnel-post scales Search to Book gaps: business ×0.74, budget/leisure
-- ×1.25, luxury untouched (v1.6 scopes the hook to Search to Book only).
-- CAUTION: cross-event TTC SQL here is the documented greedy-single-pass
-- limitation — it pairs searches/bookings across funnel instances and
-- buries the signal. The story asserts TTC through the Mixpanel-aligned
-- emulator (timeToConvert, 60h window = 48h generative × 1.25 max
-- stretch); trust the story verdict, not ad-hoc pair SQL.
SELECT u.customer_segment AS seg, count(*) AS booking_events
FROM ev e JOIN users u ON u.distinct_id::VARCHAR = e.uid
WHERE e.event = 'booking completed' GROUP BY 1 ORDER BY 1;


-- ── H10-hotel-view-magic ────────────────────────────────────
-- Sweet spot 5-10 hotel views → nightly_rate ×1.3 on all bookings; 11+
-- views → 35% of bookings dropped on/after day 60 (2026-03-02). Value
-- read restricted to the ADVANCE region where H2's ×0.8 is constant on
-- both arms and cancels.
SELECT CASE WHEN p.hv BETWEEN 5 AND 10 THEN 'sweet' WHEN p.hv < 5 THEN 'low' END AS arm,
  count(DISTINCT p.uid) AS users, round(avg(e.nightly_rate), 1) AS avg_rate
FROM per_user p JOIN ev e ON e.uid = p.uid AND e.event = 'booking completed'
WHERE (p.hv <= 10) AND e.t < TIMESTAMP '2026-04-08 23:59:59'
GROUP BY 1 ORDER BY 1;
-- read: sweet/low avg_rate ≈ 1.3

-- volume read: hotel-view count is intrinsically coupled to activity, so
-- NO cross-arm level comparison works. The day-60 calendar edge makes it
-- a difference-in-differences: each arm's own after/before
-- bookings-per-session ratio cancels its activity composition; worldEvents
-- (summer sale ×2, hurricane ×0.2) are arm-invariant and cancel cross-arm.
-- Users born before day 45 only, so both arms have real before-exposure.
SELECT CASE WHEN p.hv BETWEEN 5 AND 10 THEN 'sweet' WHEN p.hv >= 11 THEN 'over' END AS arm,
  CASE WHEN e.t >= TIMESTAMP '2026-03-02' THEN 'after' ELSE 'before' END AS period,
  count(DISTINCT p.uid) AS users,
  count(*) FILTER (WHERE e.event = 'booking completed') AS bookings,
  count(*) FILTER (WHERE e.event = 'app session') AS sessions
FROM per_user p
JOIN first_ev fe ON fe.uid = p.uid AND fe.f < TIMESTAMP '2026-02-15'
JOIN ev e ON e.uid = p.uid
WHERE p.hv >= 5
GROUP BY 1, 2 ORDER BY 1, 2;
-- read: DiD = (over after/before bookings-per-session) ÷ (sweet after/before)
--       ≈ 0.65 (the keep rate)
