-- ============================================================
-- marketplace.sql — human-eyeball inspection queries (v1.6)
-- ============================================================
-- Mirrors the story reads in marketplace.js `stories`. Run after:
--   node scripts/verify-runner.mjs dungeons/vertical/marketplace/marketplace.js verify-marketplace
--
-- Derivation notes:
-- - H1 uses the hook's exact cutoff (time > 2026-02-15T00:00:00Z), not
--   date_diff day bucketing — day-45 events straddle the boundary.
-- - H3/H8 read purchases-per-add-to-cart ratio-of-ratios: normalizing by
--   carts cancels the persona activity gap (power 5.0x vs casual 1.5x
--   eventMultiplier); the residual is the engineered clone lift (H3
--   x1.65) or retention edge (H8 4/3).
-- - H4's clean read is per-user purchases: raw category counts carry the
--   engine's seeded favored-index popularity skew.
-- - H5's fast/slow split replicates the hook's charCode hash:
--   (ascii(first char) + ascii(last char)) % 5 < 2.
-- - H9 is NOT visible in cross-event SQL — funnel-post scales gaps within
--   one Browse-to-Purchase instance per user, invisible to MIN→MIN
--   queries over the full event history. See the emulator timeToConvert
--   assertion in marketplace.js stories (48-HOUR window, matching the
--   funnel's timeToConvert; longer windows admit cross-instance chains).
-- - H10's cohort is total message-sent count — exactly reproducible from
--   output because H10 runs last and nothing after it drops messages.

-- Hook 1: FEE CHANGE IMPACT — avg listing_fee steps ~x1.26 after day 45
-- (x1.3 knob, Math.floor shaves ~4%)
SELECT (time::TIMESTAMP > TIMESTAMP '2026-02-15 00:00:00') AS post_d45,
  COUNT(*) AS n, ROUND(AVG(listing_fee), 2) AS avg_fee
FROM read_json_auto('data/verify-marketplace-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event = 'listing created' AND listing_fee IS NOT NULL
GROUP BY 1 ORDER BY post_d45;

-- Hook 2: WEEKEND SHOPPING SURGE — Sat/Sun avg total_amount ~1.21x weekday
SELECT
  CASE WHEN dayofweek(time::TIMESTAMP) IN (0, 6) THEN 'weekend' ELSE 'weekday' END AS bucket,
  COUNT(*) AS n, ROUND(AVG(total_amount), 1) AS avg_amount
FROM read_json_auto('data/verify-marketplace-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event = 'purchase completed' AND total_amount IS NOT NULL
GROUP BY (CASE WHEN dayofweek(time::TIMESTAMP) IN (0, 6) THEN 'weekend' ELSE 'weekday' END);

-- Hook 3 + Hook 8: purchases-per-cart by segment. Power/casual RoR ~1.67
-- (H3 x1.65 clones); frequent/casual RoR ~1.33 (H8 4/3 retention edge).
-- Raw purchases/user power/casual ~6x = clone lift x activity gap.
WITH pu AS (
  SELECT e.user_id::VARCHAR AS uid, ANY_VALUE(u.segment) AS segment,
    COUNT(*) FILTER (WHERE e.event = 'purchase completed') AS purch,
    COUNT(*) FILTER (WHERE e.event = 'add to cart') AS carts
  FROM read_json_auto('data/verify-marketplace-EVENTS*.json', sample_size=-1, union_by_name=true) e
  JOIN read_json_auto('data/verify-marketplace-USERS*.json', sample_size=-1, union_by_name=true) u
    ON e.user_id::VARCHAR = u.distinct_id::VARCHAR
  GROUP BY 1
)
SELECT segment, COUNT(*) AS users,
  ROUND(AVG(purch), 3) AS purch_pu,
  ROUND(SUM(purch)::DOUBLE / NULLIF(SUM(carts), 0), 4) AS purch_per_cart
FROM pu GROUP BY segment ORDER BY purch_per_cart DESC;

-- Hook 4: ELECTRONICS CATEGORY LIFT — elec-searchers ~1.22x purchases/user
WITH pu AS (
  SELECT user_id::VARCHAR AS uid,
    BOOL_OR(event = 'item searched' AND category = 'electronics') AS elec,
    COUNT(*) FILTER (WHERE event = 'purchase completed') AS purch
  FROM read_json_auto('data/verify-marketplace-EVENTS*.json', sample_size=-1, union_by_name=true)
  GROUP BY 1
)
SELECT elec, COUNT(*) AS users, ROUND(AVG(purch), 3) AS purch_pu
FROM pu GROUP BY elec ORDER BY elec;

-- Hook 5: RESPONSE TIME → CONVERSION — fast hash cohort ~10x accepts/user;
-- avg response_time_hours ~2.25h vs ~22h on message sent
WITH pu AS (
  SELECT user_id::VARCHAR AS uid,
    (ascii(substr(user_id::VARCHAR, 1, 1)) + ascii(substr(user_id::VARCHAR, -1, 1))) % 5 < 2 AS is_fast,
    BOOL_OR(event = 'message sent') AS has_msg,
    COUNT(*) FILTER (WHERE event = 'offer accepted') AS accepts
  FROM read_json_auto('data/verify-marketplace-EVENTS*.json', sample_size=-1, union_by_name=true)
  GROUP BY 1
)
SELECT is_fast, COUNT(*) AS users, ROUND(AVG(accepts), 3) AS accepts_pu
FROM pu WHERE has_msg GROUP BY is_fast ORDER BY is_fast;

SELECT
  (ascii(substr(user_id::VARCHAR, 1, 1)) + ascii(substr(user_id::VARCHAR, -1, 1))) % 5 < 2 AS is_fast,
  COUNT(*) AS n, ROUND(AVG(response_time_hours), 2) AS avg_rt
FROM read_json_auto('data/verify-marketplace-EVENTS*.json', sample_size=-1, union_by_name=true)
WHERE event = 'message sent' AND response_time_hours IS NOT NULL
GROUP BY 1 ORDER BY is_fast;

-- Hook 6: NEW SELLER CHURN — new_seller post/pre(+14d) event ratio ~0.5x rest
-- (50% drop stacked on the persona's 28-day activeWindow)
WITH pu AS (
  SELECT e.user_id::VARCHAR AS uid, ANY_VALUE(u.segment) AS segment, MIN(e.time::TIMESTAMP) AS t0
  FROM read_json_auto('data/verify-marketplace-EVENTS*.json', sample_size=-1, union_by_name=true) e
  JOIN read_json_auto('data/verify-marketplace-USERS*.json', sample_size=-1, union_by_name=true) u
    ON e.user_id::VARCHAR = u.distinct_id::VARCHAR
  GROUP BY 1
), flags AS (
  SELECT p.uid, p.segment,
    COUNT(*) FILTER (WHERE e.time::TIMESTAMP <= p.t0 + INTERVAL 14 DAY) AS pre,
    COUNT(*) FILTER (WHERE e.time::TIMESTAMP > p.t0 + INTERVAL 14 DAY) AS post
  FROM read_json_auto('data/verify-marketplace-EVENTS*.json', sample_size=-1, union_by_name=true) e
  JOIN pu p ON e.user_id::VARCHAR = p.uid
  GROUP BY 1, 2
)
SELECT (segment = 'new_seller') AS is_new_seller, COUNT(*) AS users,
  ROUND(AVG(post::DOUBLE / NULLIF(pre, 0)), 4) AS avg_post_pre
FROM flags WHERE pre > 0
GROUP BY (segment = 'new_seller') ORDER BY is_new_seller;

-- Hook 7: POWER SELLER PROFILES — tx means 300 / 27.5 / 1.5; ratings
-- 4.75 / 3.75 / 0; buyers keep the [0] default tx
SELECT segment, COUNT(*) AS users,
  ROUND(AVG(total_transactions), 1) AS avg_tx,
  ROUND(AVG(seller_rating), 2) AS avg_rating
FROM read_json_auto('data/verify-marketplace-USERS*.json', sample_size=-1, union_by_name=true)
GROUP BY segment ORDER BY avg_tx DESC;

-- Hook 9: BROWSE-TO-PURCHASE TTC — not visible here; emulator-only read.
-- See derivation notes above and the timeToConvert assertion in
-- marketplace.js stories (48h window: frequent/casual ~0.61,
-- window/casual ~1.12, power/casual ~0.64).

-- Hook 10: MESSAGE-COUNT MAGIC NUMBER — per-user avg offer_amount by
-- total-message cohort: sweet(2-5)/low(0-1) ~1.30x, over(6+)/low ~0.83x
WITH pu AS (
  SELECT user_id::VARCHAR AS uid,
    COUNT(*) FILTER (WHERE event = 'message sent') AS msgs,
    AVG(offer_amount) FILTER (WHERE event = 'offer received') AS avg_offer
  FROM read_json_auto('data/verify-marketplace-EVENTS*.json', sample_size=-1, union_by_name=true)
  GROUP BY 1
)
SELECT
  CASE WHEN msgs BETWEEN 2 AND 5 THEN 'sweet' WHEN msgs >= 6 THEN 'over' ELSE 'low' END AS bucket,
  COUNT(*) FILTER (WHERE avg_offer IS NOT NULL) AS users,
  ROUND(AVG(avg_offer), 1) AS avg_offer
FROM pu
GROUP BY (CASE WHEN msgs BETWEEN 2 AND 5 THEN 'sweet' WHEN msgs >= 6 THEN 'over' ELSE 'low' END)
ORDER BY bucket;

-- Identity invariants: uid coverage 1.0 (auth event is Buyer Onboarding
-- step 1 — no device-only prefix), device coverage ~0.999, devices/user
-- ~2.06 (avgDevicePerUser: 2)
SELECT
  ROUND(AVG((user_id IS NOT NULL)::INT), 4) AS uid_share,
  ROUND(AVG((device_id IS NOT NULL)::INT), 4) AS device_share,
  ROUND(COUNT(DISTINCT device_id)::DOUBLE / COUNT(DISTINCT user_id), 2) AS devices_per_user
FROM read_json_auto('data/verify-marketplace-EVENTS*.json', sample_size=-1, union_by_name=true);
