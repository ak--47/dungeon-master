-- ============================================================
-- ecommerce.js — v1.6 human-inspection queries (DuckDB)
--
-- Every query is keyed to a story id in ecommerce.js's `stories` export;
-- the machine-checked verdicts come from:
--   node scripts/verify-stories.mjs dungeons/vertical/ecommerce/ecommerce.js --data-prefix verify-ecommerce
-- Generate first:
--   node scripts/verify-runner.mjs dungeons/vertical/ecommerce/ecommerce.js verify-ecommerce
-- Run this file:
--   duckdb -c ".read dungeons/vertical/ecommerce/ecommerce.sql"
-- ============================================================

-- ── identity-resolution prelude ─────────────────────────────
-- avgDevicePerUser: 2 + sign up isAuthEvent — born-in users' pre-auth
-- Signup Flow steps carry device_id ONLY; resolve through the profile's
-- device pool so per-user aggregations are identity-correct.
CREATE OR REPLACE VIEW users AS
SELECT * FROM read_json_auto('data/verify-ecommerce-USERS*.json', sample_size=-1, union_by_name=true);

CREATE OR REPLACE VIEW device_map AS
-- profiles store the device pool under the legacy "anonymousIds" key
-- (buildIdentityMap in lib/verify/identity.js reads the same field)
SELECT unnest("anonymousIds") AS device_id, distinct_id FROM users;

CREATE OR REPLACE VIEW ev AS
-- ::VARCHAR casts — user_id sniffs as UUID, device_id as VARCHAR; DuckDB
-- refuses to coalesce mixed types
SELECT coalesce(m.distinct_id::VARCHAR, e.user_id::VARCHAR, e.device_id::VARCHAR) AS uid,
       e.time::TIMESTAMP AS t,
       e.*
FROM read_json_auto('data/verify-ecommerce-EVENTS*.json', sample_size=-1, union_by_name=true) e
LEFT JOIN device_map m ON e.device_id = m.device_id;

CREATE OR REPLACE VIEW scd AS
SELECT * FROM read_json_auto('data/verify-ecommerce-loyalty_tier-SCD*.json', sample_size=-1, union_by_name=true);


-- ── H1-signup-fix ───────────────────────────────────────────
-- signup_flow flips v1 → v2 at datasetEnd - 7d; 50% of pre-fix signups
-- dropped. Purity is exact (0 v2 pre, 0 v1 post); daily-rate jump is a
-- 2x-drop × acquisition-ramp composite (~7x measured).
SELECT
  count(*) FILTER (WHERE signup_flow = 'v2' AND t < TIMESTAMP '2026-04-24 23:59:59') AS v2_pre,
  count(*) FILTER (WHERE signup_flow = 'v1' AND t > TIMESTAMP '2026-04-24 23:59:59') AS v1_post,
  round(count(*) FILTER (WHERE t >= TIMESTAMP '2026-04-24 23:59:59') / 7.0, 2) AS post_daily,
  round(count(*) FILTER (WHERE t <  TIMESTAMP '2026-04-24 23:59:59') / 114.0, 2) AS pre_daily,
  round((count(*) FILTER (WHERE t >= TIMESTAMP '2026-04-24 23:59:59') / 7.0)
        / nullif(count(*) FILTER (WHERE t < TIMESTAMP '2026-04-24 23:59:59') / 114.0, 0), 2) AS daily_ratio
FROM ev WHERE event = 'sign up';


-- ── H2-watch-inflection ─────────────────────────────────────
-- watchTimeSec ×(1-f) before datasetEnd - 30d, ×(1+f) after, f ~ U[0.25, 0.79]
-- → post/pre avg = E[1+f]/E[1-f] = 1.52/0.48 ≈ 3.17
SELECT
  round(avg(watchTimeSec) FILTER (WHERE t <  TIMESTAMP '2026-04-01 23:59:59'), 1) AS pre_avg,
  round(avg(watchTimeSec) FILTER (WHERE t >= TIMESTAMP '2026-04-01 23:59:59'), 1) AS post_avg,
  round(avg(watchTimeSec) FILTER (WHERE t >= TIMESTAMP '2026-04-01 23:59:59')
        / nullif(avg(watchTimeSec) FILTER (WHERE t < TIMESTAMP '2026-04-01 23:59:59'), 0), 3) AS ratio
FROM ev WHERE event = 'watch video';


-- ── H3-toys-shoes-basket ────────────────────────────────────
-- toys carts get a shoes item injected when the donor cart has one (~49%)
-- and vice versa; neither-carts get amounts ×U[0.75, 0.9] (mean 0.825).
-- P(shoes|toys) ≈ 0.64-0.71 vs P(shoes|no toys) ≈ 0.11 → ~6x lift.
WITH x AS (SELECT insert_id, unnest(cart) AS item FROM ev WHERE event = 'checkout' AND cart IS NOT NULL),
flags AS (SELECT insert_id, bool_or(item.category = 'toys') AS has_toys,
  bool_or(item.category = 'shoes') AS has_shoes, avg(item.amount) AS avg_amt FROM x GROUP BY 1)
SELECT count(*) AS carts,
  round(count(*) FILTER (WHERE has_toys AND has_shoes)::DOUBLE / nullif(count(*) FILTER (WHERE has_toys), 0), 3) AS p_shoes_given_toys,
  round(count(*) FILTER (WHERE has_shoes AND NOT has_toys)::DOUBLE / nullif(count(*) FILTER (WHERE NOT has_toys), 0), 3) AS p_shoes_given_no_toys,
  round(avg(avg_amt) FILTER (WHERE NOT has_toys AND NOT has_shoes)
        / nullif(avg(avg_amt) FILTER (WHERE has_toys OR has_shoes), 0), 3) AS neither_either_ratio
FROM flags;


-- ── H4-quality-watchtime ────────────────────────────────────
-- watchTimeSec × quality factor (240p 0.7 … 2160p 1.5) → strict monotone,
-- 2160p/240p ≈ 2.14 (H2's temporal factor is quality-blind and cancels)
SELECT quality, count(*) AS n, round(avg(watchTimeSec), 1) AS avg_watch
FROM ev WHERE event = 'watch video' GROUP BY 1 ORDER BY avg_watch;


-- ── H5-item-flattening ──────────────────────────────────────
-- view item / add to cart / save item: item[0] spread top-level, nested
-- item deleted (no `item` column survives in shards — DESCRIBE proves it);
-- checkout's cart stays nested 100%. Flattened slug is always the
-- "<descriptor>-<suffix>" compound, never the schema default "item".
SELECT count(*) FILTER (WHERE column_name = 'item') AS item_cols,
       count(*) FILTER (WHERE column_name = 'cart') AS cart_cols
FROM (DESCRIBE SELECT * FROM read_json_auto('data/verify-ecommerce-EVENTS*.json', sample_size=-1, union_by_name=true));

SELECT event, count(*) AS n,
  count(*) FILTER (WHERE slug LIKE '%-%') AS compound_slug,
  count(*) FILTER (WHERE category IS NOT NULL) AS with_category,
  count(*) FILTER (WHERE cart IS NOT NULL) AS with_cart
FROM ev WHERE event IN ('view item', 'add to cart', 'save item', 'checkout')
GROUP BY 1 ORDER BY 1;


-- ── H6-view-magic-number ────────────────────────────────────
-- 3-8 view items → cart amounts ×1.25 + 45% add-to-cart clones; 9+ views →
-- 30% of checkouts dropped. View count is funnel-dominated (over bin ≈ 89%
-- of users) so the signals are per-item amount (clean 1.25), carts-per-view
-- (~1.37 clone composite), checkouts-per-cart (~0.54 drop composite).
WITH vc AS (
  SELECT u.distinct_id::VARCHAR AS duid,
    count(e.uid) FILTER (WHERE e.event = 'view item') AS views,
    count(e.uid) FILTER (WHERE e.event = 'add to cart') AS carts,
    count(e.uid) FILTER (WHERE e.event = 'checkout') AS cks
  FROM users u LEFT JOIN ev e ON e.uid = u.distinct_id::VARCHAR GROUP BY 1),
bins AS (SELECT duid, views, carts, cks,
  CASE WHEN views BETWEEN 3 AND 8 THEN 'sweet' WHEN views < 3 THEN 'low' ELSE 'over' END AS bin FROM vc),
items AS (SELECT e.uid, unnest(e.cart) AS item FROM ev e WHERE e.event = 'checkout' AND e.cart IS NOT NULL)
SELECT b.bin, count(DISTINCT b.duid) AS users,
  round(avg(i.item.amount), 2) AS avg_cart_item_amt
FROM bins b LEFT JOIN items i ON i.uid = b.duid GROUP BY 1 ORDER BY 1;

WITH vc AS (
  SELECT u.distinct_id::VARCHAR AS duid,
    count(e.uid) FILTER (WHERE e.event = 'view item') AS views,
    count(e.uid) FILTER (WHERE e.event = 'add to cart') AS carts,
    count(e.uid) FILTER (WHERE e.event = 'checkout') AS cks
  FROM users u LEFT JOIN ev e ON e.uid = u.distinct_id::VARCHAR GROUP BY 1)
SELECT CASE WHEN views BETWEEN 3 AND 8 THEN 'sweet' WHEN views < 3 THEN 'low' ELSE 'over' END AS bin,
  count(*) AS users,
  round(sum(carts)::DOUBLE / nullif(sum(views), 0), 4) AS carts_per_view,
  round(sum(cks)::DOUBLE / nullif(sum(carts), 0), 4) AS ck_per_cart
FROM vc GROUP BY 1 ORDER BY 1;


-- ── H7-loyalty-signup-ttc ───────────────────────────────────
-- Signup Flow TTC scaled by latest SCD loyalty_tier: gold/platinum ×0.67,
-- bronze ×1.33 → bronze/(gold+plat) pure-scale ratio 1.99, measured
-- ~1.85-2.04 across seeds (organic events inside the 2d lookback dilute;
-- re-windowing on scaled times censors tails)
WITH latest AS (
  SELECT distinct_id, loyalty_tier FROM (
    SELECT distinct_id, loyalty_tier, row_number() OVER (PARTITION BY distinct_id ORDER BY time DESC) AS rn
    FROM scd) WHERE rn = 1),
su AS (SELECT uid, min(t) AS st FROM ev WHERE event = 'sign up' GROUP BY 1),
steps AS (
  SELECT s.uid, s.st, min(e.t) AS first_step
  FROM su s JOIN ev e ON e.uid = s.uid
  WHERE e.event IN ('page view', 'view item', 'save item')
    AND e.t >= s.st - INTERVAL 2 DAY AND e.t <= s.st GROUP BY 1, 2)
SELECT CASE WHEN l.loyalty_tier IN ('gold', 'platinum') THEN 'fast'
            WHEN l.loyalty_tier = 'bronze' THEN 'slow' ELSE 'silver' END AS grp,
  count(*) AS users, round(median(epoch(st - first_step)) / 60, 1) AS med_ttc_min
FROM steps s JOIN latest l ON l.distinct_id = s.uid GROUP BY 1 ORDER BY med_ttc_min;


-- ── H8-checkout-experiment ──────────────────────────────────
-- engine experiment on eCommerce Purchase (last 30 days): deterministic
-- per-user hash → equal thirds; theme-composed per-attempt conversion
-- Control ≈ 16.2%, Express ≈ 20.2%, Social ≈ 17.8%; Social ttc ×0.9.
-- STRICT pairing: checkout within 75min AND >= 5 view/add steps between
-- $experiment_started and the checkout. Naive time-window pairing is
-- polluted by same-session organic weight-2 checkouts (~48K organic vs
-- ~2K funnel checkouts), which compresses both ratios toward 1 (measured
-- 1.06 conv ratio / 34min mean TTC naive vs ~1.25 / ~60min strict).
WITH att AS (SELECT user_id::VARCHAR AS auid, time::TIMESTAMP AS att_t, "Variant name" AS variant
  FROM read_json_auto('data/verify-ecommerce-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event = '$experiment_started'),
ck AS (SELECT user_id::VARCHAR AS cuid, time::TIMESTAMP AS ct
  FROM read_json_auto('data/verify-ecommerce-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event = 'checkout'),
naive AS (
  SELECT a.auid, a.variant, a.att_t, min(c.ct) AS ct
  FROM att a LEFT JOIN ck c ON c.cuid = a.auid AND c.ct > a.att_t AND c.ct <= a.att_t + INTERVAL 75 MINUTE
  GROUP BY 1, 2, 3),
mids AS (
  SELECT n.auid, n.att_t, count(*) AS steps
  FROM naive n JOIN read_json_auto('data/verify-ecommerce-EVENTS*.json', sample_size=-1, union_by_name=true) s
    ON s.user_id::VARCHAR = n.auid AND s.event IN ('view item', 'add to cart')
    AND s.time::TIMESTAMP > n.att_t AND s.time::TIMESTAMP < n.ct
  WHERE n.ct IS NOT NULL GROUP BY 1, 2),
paired AS (
  SELECT n.auid, n.variant, n.att_t,
    CASE WHEN m.steps >= 5 THEN n.ct ELSE NULL END AS conv_t
  FROM naive n LEFT JOIN mids m ON m.auid = n.auid AND m.att_t = n.att_t)
SELECT variant, count(DISTINCT auid) AS users, count(*) AS attempts, count(conv_t) AS conversions,
  round(count(conv_t)::DOUBLE / count(*), 4) AS conv_rate,
  round(avg(epoch(conv_t - att_t)) FILTER (WHERE conv_t IS NOT NULL) / 60, 1) AS mean_ttc_min
FROM paired GROUP BY 1 ORDER BY 1;


-- ── H9-dark-theme-power ─────────────────────────────────────
-- funnel-pre scales purchase conversionRate: dark 20%, light 13%, custom 15%
-- → per-user checkouts dark/light ≈ 1.48 (organic weight-2 checkouts dilute)
WITH uc AS (SELECT theme, count(*) AS users FROM users GROUP BY 1),
ec AS (SELECT theme, count(*) AS cks
  FROM read_json_auto('data/verify-ecommerce-EVENTS*.json', sample_size=-1, union_by_name=true)
  WHERE event = 'checkout' GROUP BY 1)
SELECT uc.theme, uc.users, ec.cks AS checkouts,
  round(ec.cks::DOUBLE / uc.users, 3) AS checkouts_per_user
FROM uc JOIN ec ON uc.theme = ec.theme ORDER BY checkouts_per_user DESC;


-- ── H10-save-retention ──────────────────────────────────────
-- born users with <2 save items in first 10d lose 70% of post-day-25
-- events. Every signer has one funnel-guaranteed save (Signup Flow
-- includes the step) — savers made a 2nd, organic one. Ratio-of-ratios
-- (nonsaver post/pre)/(saver post/pre) cancels window lengths +
-- acquisition ramp → ≈ 0.30 by knob. Savers engineered-small.
WITH born AS (SELECT uid, min(t) AS t0 FROM ev WHERE event = 'sign up' GROUP BY 1),
eligible AS (SELECT uid, t0 FROM born WHERE t0 <= TIMESTAMP '2026-05-01 23:59:59' - INTERVAL 35 DAY),
per AS (
  SELECT b.uid,
    count(e.uid) FILTER (WHERE e.event = 'save item' AND e.t <= b.t0 + INTERVAL 10 DAY) AS early_saves,
    count(e.uid) FILTER (WHERE e.t <= b.t0 + INTERVAL 25 DAY) AS pre_events,
    count(e.uid) FILTER (WHERE e.t >  b.t0 + INTERVAL 25 DAY) AS post_events
  FROM eligible b JOIN ev e ON e.uid = b.uid GROUP BY 1)
SELECT CASE WHEN early_saves >= 2 THEN 'saver' ELSE 'nonsaver' END AS cohort,
  count(*) AS users, round(avg(pre_events), 1) AS avg_pre, round(avg(post_events), 1) AS avg_post,
  round(avg(post_events)::DOUBLE / nullif(avg(pre_events), 0), 3) AS post_pre
FROM per GROUP BY 1 ORDER BY 1;
