-- ============================================================
-- travel.js — v1.5.0 Hook Verification Queries
-- Score: NAILED (10/10 emulator-backed checks)
-- ============================================================
--
-- v1.5.0 changes:
-- - isStrictEvent: false on hotel viewed, booking completed, review submitted,
--   room upgrade selected.
-- - reentry: true on Search to Book.
-- - Identity-aware (avgDevicePerUser=2, hasAnonIds=true).
-- ============================================================


-- Hook 1: WEEKEND LEISURE SURGE
-- Pattern: bespoke (DuckDB) — DOW breakdown on nightly_rate
-- Expected: Fri/Sat/Sun bookings ~1.3x weekday rates
-- Mixpanel: Insights → booking completed, Avg of nightly_rate, breakdown by DOW
SELECT
  CASE WHEN EXTRACT(DOW FROM time::TIMESTAMP) IN (0, 5, 6) THEN 'weekend' ELSE 'weekday' END AS bucket,
  COUNT(*) AS n, ROUND(AVG(nightly_rate), 0) AS avg_rate
FROM read_json_auto('data/verify-travel-EVENTS.json', sample_size=-1, union_by_name=true)
WHERE event = 'booking completed' AND nightly_rate IS NOT NULL
GROUP BY 1 ORDER BY 1;


-- Hook 2: ADVANCE BOOKING DISCOUNT
-- Pattern: bespoke (DuckDB) — booking_window breakdown
-- Expected: last_minute ~1.4x advance rate
-- Mixpanel: Insights → booking completed, Avg nightly_rate, breakdown by booking_window
SELECT booking_window, COUNT(*) AS n, ROUND(AVG(nightly_rate), 0) AS avg_rate
FROM read_json_auto('data/verify-travel-EVENTS.json', sample_size=-1, union_by_name=true)
WHERE event = 'booking completed' AND nightly_rate IS NOT NULL
GROUP BY booking_window ORDER BY avg_rate;


-- Hook 3: LOYALTY TIER UPGRADE PATH
-- Pattern: bespoke (DuckDB) — behavioral cohort by booking count
-- Expected: 5+ bookings users ~1.4-3x loyalty_points avg
-- Mixpanel: Insights → booking completed, Avg loyalty_points, breakdown by behavioral cohort
WITH per_user AS (
  SELECT user_id, COUNT(*) AS bn
  FROM read_json_auto('data/verify-travel-EVENTS.json', sample_size=-1, union_by_name=true)
  WHERE event = 'booking completed' GROUP BY user_id
),
points AS (
  SELECT e.user_id, e.loyalty_points
  FROM read_json_auto('data/verify-travel-EVENTS.json', sample_size=-1, union_by_name=true) e
  WHERE e.event = 'booking completed' AND e.loyalty_points IS NOT NULL
)
SELECT CASE WHEN p.bn >= 5 THEN 'big' ELSE 'rest' END AS bucket,
  COUNT(*) AS n, ROUND(AVG(pt.loyalty_points), 0) AS avg_points
FROM points pt JOIN per_user p USING (user_id)
GROUP BY 1 ORDER BY 1 DESC;


-- Hook 4: CANCELLATION BY BOOKING WINDOW
-- Pattern: bespoke (DuckDB) — cancellation count by window
-- Expected: last_minute cancellations ~10-20% of advance cancellation count
-- Mixpanel: Funnels → booking completed → booking cancelled, breakdown by booking_window
SELECT booking_window, COUNT(*) AS cancellations
FROM read_json_auto('data/verify-travel-EVENTS.json', sample_size=-1, union_by_name=true)
WHERE event = 'booking cancelled'
GROUP BY booking_window ORDER BY cancellations DESC;


-- Hook 5: UPSELL SUCCESS BY SEGMENT
-- Pattern: aggregatePerUser — upgrades per user by segment
-- Expected: luxury_seeker ~2x+ upgrades per user vs budget_hunter
-- Mixpanel: Insights → room upgrade selected, Total per user, breakdown by customer_segment
WITH user_upgrades AS (
  SELECT user_id, COUNT(*) AS u_n
  FROM read_json_auto('data/verify-travel-EVENTS.json', sample_size=-1, union_by_name=true)
  WHERE event = 'room upgrade selected' GROUP BY user_id
),
users AS (SELECT distinct_id AS user_id, customer_segment FROM read_json_auto('data/verify-travel-USERS.json', sample_size=-1, union_by_name=true))
SELECT u.customer_segment, COUNT(*) AS users, ROUND(AVG(COALESCE(uu.u_n, 0)), 2) AS avg_upgrades
FROM users u LEFT JOIN user_upgrades uu USING (user_id)
GROUP BY u.customer_segment ORDER BY avg_upgrades DESC;


-- Hook 6: REVIEW QUALITY BY STAY RATING
-- Pattern: bespoke (DuckDB) — review_length by avg rating cohort
-- Expected: high-rating users (avg>=4) review_length ~1.5x+ low-rating
-- Mixpanel: Insights → review submitted, Avg of review_length, breakdown by stay_rating
WITH per_user AS (
  SELECT user_id, AVG(stay_rating) AS avg_r
  FROM read_json_auto('data/verify-travel-EVENTS.json', sample_size=-1, union_by_name=true)
  WHERE event = 'review submitted' AND stay_rating IS NOT NULL
  GROUP BY user_id
),
reviews AS (
  SELECT e.user_id, e.review_length
  FROM read_json_auto('data/verify-travel-EVENTS.json', sample_size=-1, union_by_name=true) e
  WHERE e.event = 'review submitted' AND e.review_length IS NOT NULL
)
SELECT CASE WHEN p.avg_r >= 4 THEN 'high' WHEN p.avg_r <= 2 THEN 'low' ELSE 'mid' END AS bucket,
  COUNT(*) AS n, ROUND(AVG(r.review_length), 0) AS avg_length
FROM reviews r JOIN per_user p USING (user_id)
GROUP BY 1 ORDER BY 1;


-- Hook 7: BUSINESS TRAVELER PROFILE
-- Pattern: bespoke (DuckDB) — user-property check
-- Expected: 100% of business_traveler users have travel_frequency=weekly + company_name
-- Mixpanel: Users → filter customer_segment=business_traveler, breakdown by travel_frequency
SELECT customer_segment, travel_frequency, company_name IS NOT NULL AND company_name <> 'none' AS has_company,
  COUNT(*) AS users
FROM read_json_auto('data/verify-travel-USERS.json', sample_size=-1, union_by_name=true)
GROUP BY customer_segment, travel_frequency, has_company
ORDER BY customer_segment, travel_frequency;


-- Hook 8: REPEAT DESTINATION CLUSTERING
-- Pattern: funnelFrequency-style — funnel conversion by segment
-- Expected: business_traveler ~1.3x+ conversion vs budget_hunter
-- Mixpanel: Funnels → destination searched → hotel viewed → booking completed, breakdown by customer_segment
WITH per_user AS (
  SELECT e.user_id,
    MIN(time) FILTER (WHERE event = 'destination searched') AS t1,
    MIN(time) FILTER (WHERE event = 'hotel viewed') AS t2,
    MIN(time) FILTER (WHERE event = 'booking completed') AS t3
  FROM read_json_auto('data/verify-travel-EVENTS.json', sample_size=-1, union_by_name=true) e
  GROUP BY e.user_id
),
users AS (SELECT distinct_id AS user_id, customer_segment FROM read_json_auto('data/verify-travel-USERS.json', sample_size=-1, union_by_name=true))
SELECT u.customer_segment,
  COUNT(*) AS users,
  ROUND(COUNT(*) FILTER (WHERE t3 > t2 AND t2 > t1) * 100.0 / COUNT(*), 1) AS pct
FROM per_user p JOIN users u USING (user_id)
WHERE t1 IS NOT NULL
GROUP BY u.customer_segment ORDER BY pct DESC;


-- Hook 9: BOOKING TTC BY SEGMENT (KNOWN MEASUREMENT GAP)
-- See dating.sql Hook 9 for the funnel-post limitation explanation.
WITH per_user AS (
  SELECT e.user_id,
    MIN(time) FILTER (WHERE event = 'destination searched') AS t1,
    MIN(time) FILTER (WHERE event = 'booking completed') AS t2
  FROM read_json_auto('data/verify-travel-EVENTS.json', sample_size=-1, union_by_name=true) e
  GROUP BY e.user_id
),
users AS (SELECT distinct_id AS user_id, customer_segment FROM read_json_auto('data/verify-travel-USERS.json', sample_size=-1, union_by_name=true))
SELECT u.customer_segment,
  ROUND(MEDIAN(EXTRACT(EPOCH FROM (t2::TIMESTAMP - t1::TIMESTAMP)) / 3600), 2) AS median_ttc_hr
FROM per_user p JOIN users u USING (user_id)
WHERE t1 IS NOT NULL AND t2 > t1
GROUP BY u.customer_segment ORDER BY median_ttc_hr;


-- Hook 10: HOTEL-VIEWED MAGIC NUMBER
-- Pattern: bespoke (DuckDB) — sweet 5-10 hotels boosts nightly_rate
-- Expected: sweet (5-10 views) avg booking nightly_rate ~1.2-1.3x lower (<5)
-- Mixpanel: Insights → booking completed, Avg nightly_rate, behavioral cohorts on hotel viewed count
WITH per_user AS (
  SELECT user_id, COUNT(*) FILTER (WHERE event = 'hotel viewed') AS hv
  FROM read_json_auto('data/verify-travel-EVENTS.json', sample_size=-1, union_by_name=true)
  GROUP BY user_id
),
bookings AS (
  SELECT e.user_id, e.nightly_rate
  FROM read_json_auto('data/verify-travel-EVENTS.json', sample_size=-1, union_by_name=true) e
  WHERE e.event = 'booking completed' AND e.nightly_rate IS NOT NULL
)
SELECT CASE WHEN p.hv BETWEEN 5 AND 10 THEN 'sweet' WHEN p.hv < 5 THEN 'lower' ELSE 'over' END AS bucket,
  COUNT(*) AS bookings, ROUND(AVG(b.nightly_rate), 0) AS avg_rate
FROM bookings b JOIN per_user p USING (user_id)
GROUP BY 1 ORDER BY 1;
