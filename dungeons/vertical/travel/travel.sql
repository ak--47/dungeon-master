-- Driftway Travel (travel vertical) — story-keyed and eval-keyed DuckDB queries.
--
-- Generate first (repo root):
--   node scripts/verify-runner.mjs dungeons/vertical/travel/travel.js verify-travel
-- Run:
--   duckdb -c ".read dungeons/vertical/travel/travel.sql"
-- Against a gzipped export:
--   duckdb -c "SET VARIABLE data_prefix='<dir>/travel'" -c ".read travel.sql"
--
-- All times are UTC. Window: 2026-06-04 00:00 to 2026-10-01 23:59:59.

SET VARIABLE data_prefix = COALESCE(getvariable('data_prefix'), 'data/verify-travel');

-- ─────────────────────────────────────────────────────────────────────────
-- PRELUDE: raw files, identity resolution, warehouse tables
-- ─────────────────────────────────────────────────────────────────────────
-- Identity: a new traveler's first search and property views are anonymous
-- (device_id only). "account created" carries user_id and device_id, which
-- links the device to the member; every later event carries user_id. A device
-- resolves to the member seen with it on any event that carries both ids, the
-- way Mixpanel ID merge stitches the anonymous rows.

CREATE OR REPLACE TEMP TABLE raw_events AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-EVENTS*.json*', sample_size=-1, union_by_name=true);

CREATE OR REPLACE TEMP TABLE users AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-USERS*.json*', sample_size=-1, union_by_name=true);

CREATE OR REPLACE TEMP TABLE device_map AS
SELECT device_id, min(user_id::VARCHAR) AS mapped
FROM raw_events WHERE user_id IS NOT NULL AND device_id IS NOT NULL GROUP BY 1;

CREATE OR REPLACE TEMP TABLE ev AS
SELECT coalesce(e.user_id::VARCHAR, m.mapped) AS uid, e.time::TIMESTAMP AS t, e.*
FROM raw_events e LEFT JOIN device_map m ON e.device_id = m.device_id;

CREATE OR REPLACE TEMP TABLE wh_spend AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-marketing_spend_daily.json*', sample_size=-1, union_by_name=true);
CREATE OR REPLACE TEMP TABLE wh_gateway AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-payment_gateway_daily.json*', sample_size=-1, union_by_name=true);
CREATE OR REPLACE TEMP TABLE wh_supply AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-destination_supply_daily.json*', sample_size=-1, union_by_name=true);

-- profile attributes keyed by the resolved member id
CREATE OR REPLACE TEMP TABLE prof AS
SELECT distinct_id::VARCHAR AS uid, traveler_segment AS seg, acquisition_channel, home_market, age_band, rewards_tier,
 member_since, push_enabled, created IS NOT NULL AS joined_in_window, "Experiment: All-in Pricing" AS variant
FROM users;

-- one row per search session (search_id is shared by the search, its property views,
-- the checkout, and the booking)
CREATE OR REPLACE TEMP TABLE sessions AS
WITH s AS (SELECT search_id, uid, t AS t0, region, destination, lead_time_days AS search_lead, platform FROM ev WHERE event = 'destination searched'),
v AS (SELECT search_id, count(*) AS views FROM ev WHERE event = 'property viewed' GROUP BY 1),
c AS (SELECT search_id, min(t) AS tc, any_value(platform) AS ck_platform, any_value(review_count) AS ck_reviews FROM ev WHERE event = 'checkout started' GROUP BY 1),
b AS (SELECT search_id, min(t) AS tb, any_value(booking_id) AS booking_id FROM ev WHERE event = 'booking completed' GROUP BY 1)
SELECT s.*, v.views, c.tc, c.ck_platform, c.ck_reviews, b.tb, b.booking_id
FROM s LEFT JOIN v USING (search_id) LEFT JOIN c USING (search_id) LEFT JOIN b USING (search_id);

-- one row per booking with its cancellation and check-in (if any)
CREATE OR REPLACE TEMP TABLE bookings AS
WITH b AS (SELECT booking_id, uid, t AS t0, region, destination, property_type, nightly_rate, nights, total_price, check_in_date,
  lead_time_days, refundable, payment_method, promo_code, platform FROM ev WHERE event = 'booking completed'),
c AS (SELECT booking_id, min(t) AS tc, any_value(cancellation_reason) AS reason, any_value(refund_amount) AS refund FROM ev WHERE event = 'booking cancelled' GROUP BY 1),
ci AS (SELECT booking_id, min(t) AS tci FROM ev WHERE event = 'check in completed' GROUP BY 1)
SELECT b.*, c.tc, c.reason, c.refund, ci.tci,
 CASE WHEN lead_time_days <= 6 THEN '0-6' WHEN lead_time_days <= 29 THEN '7-29' WHEN lead_time_days <= 59 THEN '30-59' ELSE '60+' END AS lead_bucket
FROM b LEFT JOIN c USING (booking_id) LEFT JOIN ci USING (booking_id);

-- new-member signups (one per member who joined in the window)
CREATE OR REPLACE TEMP TABLE signups AS
SELECT uid, t AS t0, acquisition_channel AS ch FROM ev WHERE event = 'account created';

-- ─────────────────────────────────────────────────────────────────────────
-- STORIES (one section per hook; numbers match the stories export)
-- ─────────────────────────────────────────────────────────────────────────

-- STORY H1-flex-pay-launch: booking completed per checkout started, before vs after 2026-07-14
-- (after-period ends 2026-08-17, the day before the payment incident)
SELECT CASE WHEN t < TIMESTAMP '2026-07-14' THEN 'before' ELSE 'after' END AS period,
 count(*) FILTER (WHERE event = 'checkout started') AS checkouts,
 count(*) FILTER (WHERE event = 'booking completed') AS bookings,
 round(count(*) FILTER (WHERE event = 'booking completed')::DOUBLE / count(*) FILTER (WHERE event = 'checkout started'), 4) AS book_rate,
 round(count(*) FILTER (WHERE event = 'booking completed' AND payment_method = 'flex_pay')::DOUBLE / count(*) FILTER (WHERE event = 'booking completed'), 4) AS flex_share
FROM ev WHERE event IN ('checkout started', 'booking completed') AND t < TIMESTAMP '2026-08-18'
GROUP BY 1 ORDER BY 1 DESC;

-- STORY H2-web-payment-incident: web/app booking rate per checkout, degraded days vs 14 days either side
WITH o AS (SELECT DISTINCT date::DATE AS d FROM wh_gateway WHERE gateway_status = 'degraded'),
w AS (SELECT (t::DATE IN (SELECT d FROM o)) AS outage, platform = 'web' AS web, event FROM ev
  WHERE event IN ('checkout started', 'booking completed') AND t >= TIMESTAMP '2026-08-04' AND t < TIMESTAMP '2026-09-05'),
g AS (SELECT outage, web, count(*) FILTER (WHERE event = 'checkout started') AS checkouts,
  count(*) FILTER (WHERE event = 'booking completed')::DOUBLE / count(*) FILTER (WHERE event = 'checkout started') AS rate FROM w GROUP BY 1, 2)
SELECT *, round((SELECT rate FROM g WHERE outage AND web) / (SELECT rate FROM g WHERE outage AND NOT web)
  / ((SELECT rate FROM g WHERE NOT outage AND web) / (SELECT rate FROM g WHERE NOT outage AND NOT web)), 4) AS did
FROM g ORDER BY outage, web;

-- STORY H3-paid-channel-economics: spend per signup and per 30-day booker, signups Jun 4-Aug 31
WITH s AS (SELECT * FROM signups WHERE t0 < TIMESTAMP '2026-09-01'),
b AS (SELECT s.uid FROM s JOIN ev e ON e.uid = s.uid AND e.event = 'booking completed' AND e.t >= s.t0 AND e.t < s.t0 + INTERVAL 30 DAY GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM wh_spend WHERE date::DATE < DATE '2026-09-01' GROUP BY 1)
SELECT s.ch, count(*) AS signups, count(b.uid) AS bookers, round(count(b.uid)::DOUBLE / count(*), 4) AS booker_rate,
 round(sp.spend, 0) AS spend, round(sp.spend / count(*), 2) AS spend_per_signup, round(sp.spend / count(b.uid), 2) AS spend_per_booker
FROM s LEFT JOIN b ON b.uid = s.uid LEFT JOIN sp ON sp.ch = s.ch GROUP BY s.ch, sp.spend ORDER BY s.ch;

-- STORY H4-lead-time-cancellations: cancellation (not weather) within 30 days, bookings Jun 4-Aug 31
WITH x AS (SELECT *, coalesce(reason <> 'weather' AND tc < t0 + INTERVAL 30 DAY, false) AS cancelled FROM bookings WHERE t0 < TIMESTAMP '2026-09-01')
SELECT 'lead ' || lead_bucket AS grp, count(*) AS bookings, round(avg(cancelled::INT), 4) AS cancel_rate FROM x GROUP BY 1
UNION ALL
SELECT CASE WHEN refundable THEN 'refundable' ELSE 'non_refundable' END, count(*), round(avg(cancelled::INT), 4) FROM x GROUP BY 1
ORDER BY 1;

-- STORY H5-all-in-pricing-experiment: per search session, searches Aug 25-Sep 23, 7-day window
WITH x AS (SELECT p.variant, s.uid, coalesce(s.tc < s.t0 + INTERVAL 7 DAY, false) AS ck,
  coalesce(s.tc < s.t0 + INTERVAL 7 DAY AND s.tb < s.t0 + INTERVAL 7 DAY, false) AS bk
  FROM sessions s JOIN prof p ON p.uid = s.uid
  WHERE p.variant IS NOT NULL AND s.t0 >= TIMESTAMP '2026-08-25' AND s.t0 < TIMESTAMP '2026-09-24')
SELECT variant, count(DISTINCT uid) AS members, count(*) AS searches, round(avg(ck::INT), 4) AS checkout_rate,
 round(sum(bk::INT)::DOUBLE / sum(ck::INT), 4) AS book_rate, round(avg(bk::INT), 4) AS bookings_per_search
FROM x GROUP BY 1 ORDER BY 1;

-- STORY H6-booking-speed-by-segment: median hours search → booking per search_id (14-day window, searches through Sep 16)
SELECT p.seg, count(*) AS bookings, round(median(date_diff('second', s.t0, s.tb) / 3600.0), 2) AS median_hours
FROM sessions s JOIN prof p ON p.uid = s.uid
WHERE s.tb IS NOT NULL AND s.t0 < TIMESTAMP '2026-09-17' AND s.tb < s.t0 + INTERVAL 14 DAY
GROUP BY 1 ORDER BY 3;

-- STORY H7-bad-stay-churn: destination searched on day 7-29 after the first review, by its rating
WITH f AS (SELECT uid, t AS f0, rating, row_number() OVER (PARTITION BY uid ORDER BY t, insert_id) AS rn FROM ev WHERE event = 'review submitted'),
f1 AS (SELECT * FROM f WHERE rn = 1 AND f0 <= TIMESTAMP '2026-09-01 23:59:59'),
r AS (SELECT f1.uid, bool_or(e.event = 'destination searched' AND e.t >= f1.f0 + INTERVAL 7 DAY AND e.t < f1.f0 + INTERVAL 30 DAY) AS ret
  FROM f1 LEFT JOIN ev e ON e.uid = f1.uid GROUP BY 1)
SELECT CASE WHEN f1.rating <= 2 THEN '1-2 stars' ELSE '3-5 stars' END AS first_review, count(*) AS members, round(avg(coalesce(r.ret, false)::INT), 4) AS retained
FROM f1 JOIN r ON r.uid = f1.uid GROUP BY 1 ORDER BY 1;

-- STORY H8-review-count-threshold: checkouts per property view by the property's review_count
SELECT CASE WHEN review_count <= 9 THEN '0-9' WHEN review_count <= 49 THEN '10-49' ELSE '50+' END AS reviews,
 count(*) FILTER (WHERE event = 'property viewed') AS views,
 count(*) FILTER (WHERE event = 'checkout started') AS checkouts,
 round(count(*) FILTER (WHERE event = 'checkout started')::DOUBLE / count(*) FILTER (WHERE event = 'property viewed'), 5) AS checkout_per_view
FROM ev WHERE event IN ('property viewed', 'checkout started') GROUP BY 1 ORDER BY 1;

-- STORY H9-hurricane-delia: Caribbean vs other regions, warning days vs 14 days either side
WITH o AS (SELECT DISTINCT date::DATE AS d FROM wh_supply WHERE weather_advisory = 'hurricane_warning'),
w AS (SELECT (t::DATE IN (SELECT d FROM o)) AS storm, region = 'caribbean' AS car, event FROM ev
  WHERE event IN ('destination searched', 'checkout started') AND t >= TIMESTAMP '2026-08-26' AND t < TIMESTAMP '2026-09-28'),
g AS (SELECT storm, car, count(*) FILTER (WHERE event = 'destination searched') AS searches, count(*) FILTER (WHERE event = 'checkout started') AS checkouts FROM w GROUP BY 1, 2)
SELECT *, round(checkouts::DOUBLE / searches, 4) AS checkout_per_search,
 round(((SELECT searches FROM g WHERE storm AND car)::DOUBLE / (SELECT searches FROM g WHERE storm AND NOT car))
  / ((SELECT searches FROM g WHERE NOT storm AND car)::DOUBLE / (SELECT searches FROM g WHERE NOT storm AND NOT car)), 4) AS search_did
FROM g ORDER BY storm, car;

-- STORY H10-summer-kickoff-sale: sale days (Jun 24-28) vs 14 days either side
SELECT CASE WHEN t >= TIMESTAMP '2026-06-24' AND t < TIMESTAMP '2026-06-29' THEN 'sale' ELSE 'base' END AS period,
 count(DISTINCT t::DATE) AS days,
 count(*) FILTER (WHERE event = 'destination searched') AS searches,
 round(count(*) FILTER (WHERE event = 'checkout started')::DOUBLE / count(*) FILTER (WHERE event = 'destination searched'), 4) AS checkout_per_search,
 count(*) FILTER (WHERE event = 'booking completed') AS bookings,
 round(avg(nightly_rate) FILTER (WHERE event = 'booking completed'), 2) AS avg_booked_rate
FROM ev WHERE event IN ('destination searched', 'checkout started', 'booking completed')
 AND t >= TIMESTAMP '2026-06-10' AND t < TIMESTAMP '2026-07-13'
GROUP BY 1 ORDER BY 1 DESC;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL (one section per question in eval/travel.eval.md)
-- ─────────────────────────────────────────────────────────────────────────

-- EVAL Q1: Flex Pay — weekly booking rate per checkout and the Flex Pay share
SELECT date_trunc('week', t)::DATE AS week,
 count(*) FILTER (WHERE event = 'checkout started') AS checkouts,
 round(count(*) FILTER (WHERE event = 'booking completed')::DOUBLE / count(*) FILTER (WHERE event = 'checkout started'), 3) AS book_rate,
 round(count(*) FILTER (WHERE event = 'booking completed' AND payment_method = 'flex_pay')::DOUBLE / nullif(count(*) FILTER (WHERE event = 'booking completed'), 0), 3) AS flex_share
FROM ev WHERE event IN ('checkout started', 'booking completed') GROUP BY 1 ORDER BY 1;
-- EVAL Q1 (cont.): before vs after launch, clean after-period and whole after-period
SELECT CASE WHEN t < TIMESTAMP '2026-07-14' THEN '1 before (Jun 4-Jul 13)' ELSE '3 after, whole (Jul 14-Oct 1)' END AS period,
 round(count(*) FILTER (WHERE event = 'booking completed')::DOUBLE / count(*) FILTER (WHERE event = 'checkout started'), 4) AS book_rate
FROM ev WHERE event IN ('checkout started', 'booking completed') GROUP BY 1
UNION ALL
SELECT '2 after, to Aug 17', round(count(*) FILTER (WHERE event = 'booking completed')::DOUBLE / count(*) FILTER (WHERE event = 'checkout started'), 4)
FROM ev WHERE event IN ('checkout started', 'booking completed') AND t >= TIMESTAMP '2026-07-14' AND t < TIMESTAMP '2026-08-18'
ORDER BY 1;

-- EVAL Q2: payment incident — daily web vs app booking rate, gateway timeouts, warehouse status
WITH d AS (SELECT t::DATE AS day, platform = 'web' AS web,
  count(*) FILTER (WHERE event = 'checkout started') AS checkouts,
  count(*) FILTER (WHERE event = 'booking completed') AS bookings,
  count(*) FILTER (WHERE event = 'payment failed' AND error_code = 'gateway_timeout') AS timeouts
  FROM ev WHERE event IN ('checkout started', 'booking completed', 'payment failed') AND t >= TIMESTAMP '2026-08-11' AND t < TIMESTAMP '2026-08-29' GROUP BY 1, 2)
SELECT d.day, d.web, d.checkouts, d.bookings, round(d.bookings::DOUBLE / d.checkouts, 3) AS book_rate, d.timeouts,
 g.gateway_status, g.approval_rate
FROM d LEFT JOIN wh_gateway g ON g.date::DATE = d.day AND g.platform = 'web' AND d.web
ORDER BY d.day, d.web;
-- EVAL Q2 (cont.): web bookings lost on degraded days vs the web baseline rate (14 days either side)
WITH base AS (SELECT count(*) FILTER (WHERE event = 'booking completed')::DOUBLE / count(*) FILTER (WHERE event = 'checkout started') AS r
  FROM ev WHERE platform = 'web' AND event IN ('checkout started', 'booking completed')
   AND ((t >= TIMESTAMP '2026-08-04' AND t < TIMESTAMP '2026-08-18') OR (t >= TIMESTAMP '2026-08-22' AND t < TIMESTAMP '2026-09-05'))),
inc AS (SELECT count(*) FILTER (WHERE event = 'checkout started') AS ck, count(*) FILTER (WHERE event = 'booking completed') AS bk
  FROM ev WHERE platform = 'web' AND event IN ('checkout started', 'booking completed') AND t >= TIMESTAMP '2026-08-18' AND t < TIMESTAMP '2026-08-22'),
avgp AS (SELECT avg(total_price) AS p FROM ev WHERE event = 'booking completed' AND platform = 'web' AND t >= TIMESTAMP '2026-08-04' AND t < TIMESTAMP '2026-09-05')
SELECT inc.ck AS web_checkouts, inc.bk AS web_bookings, round(base.r, 3) AS baseline_web_rate, round(inc.bk::DOUBLE / inc.ck, 3) AS incident_web_rate,
 round(inc.ck * base.r - inc.bk, 0) AS lost_web_bookings, round((inc.ck * base.r - inc.bk) * avgp.p, 0) AS lost_booking_value_usd
FROM inc, base, avgp;

-- EVAL Q3: paid channels — see STORY H3; plus Jul 1-Sep 30 spend and network-reported signups by channel
SELECT acquisition_channel, round(sum(spend_usd), 0) AS spend, sum(clicks)::BIGINT AS clicks, sum(signups_reported)::BIGINT AS signups_reported
FROM wh_spend WHERE date::DATE BETWEEN DATE '2026-07-01' AND DATE '2026-09-30' GROUP BY 1 ORDER BY 1;
SELECT ch, count(*) AS mixpanel_signups FROM signups WHERE t0 >= TIMESTAMP '2026-07-01' AND t0 < TIMESTAMP '2026-10-01' GROUP BY 1 ORDER BY 1;
-- EVAL Q3 (cont.): whole-window version — all signups, bookers at any time in the window, all spend
WITH b AS (SELECT DISTINCT s.uid FROM signups s JOIN ev e ON e.uid = s.uid AND e.event = 'booking completed'),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM wh_spend GROUP BY 1)
SELECT s.ch, count(*) AS signups, count(b.uid) AS bookers, round(count(b.uid)::DOUBLE / count(*), 4) AS booker_rate,
 round(sp.spend / count(*), 2) AS spend_per_signup, round(sp.spend / count(b.uid), 2) AS spend_per_booker
FROM signups s LEFT JOIN b ON b.uid = s.uid JOIN sp ON sp.ch = s.ch GROUP BY s.ch, sp.spend ORDER BY s.ch;

-- EVAL Q4: cancellations by lead time — see STORY H4; plus overall cancellation share and the bucket x rate-type grid
SELECT count(*) AS bookings, count(*) FILTER (WHERE tc IS NOT NULL) AS cancelled,
 round(count(*) FILTER (WHERE tc IS NOT NULL)::DOUBLE / count(*), 4) AS cancel_share_all,
 round(avg(coalesce(reason <> 'weather' AND tc < t0 + INTERVAL 30 DAY, false)::INT) FILTER (WHERE t0 < TIMESTAMP '2026-09-01'), 4) AS cancel_30d_jun_aug
FROM bookings;
WITH x AS (SELECT *, coalesce(reason <> 'weather' AND tc < t0 + INTERVAL 30 DAY, false) AS cancelled FROM bookings WHERE t0 < TIMESTAMP '2026-09-01')
SELECT lead_bucket, refundable, count(*) AS bookings, round(avg(cancelled::INT), 4) AS cancel_rate FROM x GROUP BY 1, 2 ORDER BY 2, 1;

-- EVAL Q5: non-refundable vs refundable — see STORY H4 (refundable rows); cancellations and refunds paid
SELECT refundable, count(*) AS bookings, count(*) FILTER (WHERE tc IS NOT NULL) AS cancellations, round(sum(refund), 0) AS refunds_usd FROM bookings GROUP BY 1 ORDER BY 1;

-- EVAL Q6: All-in Pricing — see STORY H5; plus booked value per search and exposed members by arm
WITH x AS (SELECT p.variant, s.search_id, s.booking_id, s.tb, s.t0 FROM sessions s JOIN prof p ON p.uid = s.uid
  WHERE p.variant IS NOT NULL AND s.t0 >= TIMESTAMP '2026-08-25' AND s.t0 < TIMESTAMP '2026-09-24')
SELECT x.variant, count(*) AS searches, round(coalesce(sum(b.total_price) FILTER (WHERE x.tb < x.t0 + INTERVAL 7 DAY), 0) / count(*), 2) AS booked_value_per_search
FROM x LEFT JOIN bookings b ON b.booking_id = x.booking_id GROUP BY 1 ORDER BY 1;
SELECT "Variant name" AS variant, count(DISTINCT uid) AS exposed_members FROM ev WHERE event = '$experiment_started' GROUP BY 1 ORDER BY 1;

-- EVAL Q7: time to book by segment — see STORY H6; plus share within 1 hour and the 75th percentile
SELECT p.seg, round(avg((date_diff('second', s.t0, s.tb) <= 3600)::INT), 3) AS share_within_1h,
 round(quantile_cont(date_diff('second', s.t0, s.tb) / 3600.0, 0.75), 1) AS p75_hours
FROM sessions s JOIN prof p ON p.uid = s.uid
WHERE s.tb IS NOT NULL AND s.t0 < TIMESTAMP '2026-09-17' AND s.tb < s.t0 + INTERVAL 14 DAY GROUP BY 1 ORDER BY 1;

-- EVAL Q8: bad stays — see STORY H7; plus retention by every first-review rating and the rating mix
WITH f AS (SELECT uid, t AS f0, rating, row_number() OVER (PARTITION BY uid ORDER BY t, insert_id) AS rn FROM ev WHERE event = 'review submitted'),
f1 AS (SELECT * FROM f WHERE rn = 1 AND f0 <= TIMESTAMP '2026-09-01 23:59:59'),
r AS (SELECT f1.uid, bool_or(e.event = 'destination searched' AND e.t >= f1.f0 + INTERVAL 7 DAY AND e.t < f1.f0 + INTERVAL 30 DAY) AS ret
  FROM f1 LEFT JOIN ev e ON e.uid = f1.uid GROUP BY 1)
SELECT f1.rating, count(*) AS members, round(avg(coalesce(r.ret, false)::INT), 4) AS retained FROM f1 JOIN r ON r.uid = f1.uid GROUP BY 1 ORDER BY 1;
SELECT rating, count(*) AS reviews, round(count(*)::DOUBLE / sum(count(*)) OVER (), 4) AS share FROM ev WHERE event = 'review submitted' GROUP BY 1 ORDER BY 1;

-- EVAL Q9: review-count threshold — see STORY H8; plus finer review buckets
SELECT CASE WHEN review_count = 0 THEN '0' WHEN review_count <= 4 THEN '1-4' WHEN review_count <= 9 THEN '5-9' WHEN review_count <= 24 THEN '10-24'
  WHEN review_count <= 49 THEN '25-49' WHEN review_count <= 99 THEN '50-99' ELSE '100+' END AS reviews,
 min(review_count) AS lo,
 count(*) FILTER (WHERE event = 'property viewed') AS views,
 round(count(*) FILTER (WHERE event = 'checkout started')::DOUBLE / count(*) FILTER (WHERE event = 'property viewed'), 5) AS checkout_per_view,
 count(DISTINCT property_id) FILTER (WHERE event = 'property viewed') AS properties
FROM ev WHERE event IN ('property viewed', 'checkout started') GROUP BY 1 ORDER BY lo;

-- EVAL Q10: Hurricane Delia — see STORY H9; plus daily Caribbean searches, checkouts, bookings, and warehouse supply
SELECT t::DATE AS day,
 count(*) FILTER (WHERE event = 'destination searched') AS car_searches,
 count(*) FILTER (WHERE event = 'checkout started') AS car_checkouts,
 count(*) FILTER (WHERE event = 'booking completed') AS car_bookings,
 any_value(s.weather_advisory) AS advisory, any_value(s.rooms_listed) AS rooms_listed
FROM ev LEFT JOIN wh_supply s ON s.date::DATE = ev.t::DATE AND s.region = 'caribbean'
WHERE ev.region = 'caribbean' AND event IN ('destination searched', 'checkout started', 'booking completed')
 AND t >= TIMESTAMP '2026-09-02' AND t < TIMESTAMP '2026-09-21'
GROUP BY 1 ORDER BY 1;

-- EVAL Q11: weather cancellations — Caribbean stays checking in Sep 9-13, booked before Sep 7
WITH b AS (SELECT * FROM bookings WHERE region = 'caribbean' AND check_in_date BETWEEN DATE '2026-09-09' AND DATE '2026-09-13' AND t0 < TIMESTAMP '2026-09-07')
SELECT count(*) AS stays, count(*) FILTER (WHERE reason = 'weather') AS weather_cancels,
 count(*) FILTER (WHERE reason IS NOT NULL AND reason <> 'weather' AND tc < TIMESTAMP '2026-09-07') AS cancelled_earlier,
 round(count(*) FILTER (WHERE reason = 'weather')::DOUBLE / (count(*) - count(*) FILTER (WHERE reason IS NOT NULL AND reason <> 'weather' AND tc < TIMESTAMP '2026-09-07')), 4) AS weather_cancel_share,
 round(sum(refund) FILTER (WHERE reason = 'weather'), 0) AS weather_refunds_usd,
 count(*) FILTER (WHERE tci IS NOT NULL) AS checked_in
FROM b;
-- (events, so stays booked before June 4 count too)
SELECT count(*) AS all_weather_cancellations, min(t)::DATE AS first_day, max(t)::DATE AS last_day, round(sum(refund_amount), 0) AS refunds_usd
FROM ev WHERE event = 'booking cancelled' AND cancellation_reason = 'weather';

-- EVAL Q12: Summer Kickoff Sale — see STORY H10; plus promo bookings, bookings per day, and campaign sends
SELECT count(*) FILTER (WHERE promo_code = 'SUMMERKICKOFF') AS promo_bookings,
 round(sum(total_price) FILTER (WHERE promo_code = 'SUMMERKICKOFF'), 0) AS promo_booking_value,
 round(count(*) FILTER (WHERE t0 >= TIMESTAMP '2026-06-24' AND t0 < TIMESTAMP '2026-06-29')::DOUBLE / 5, 1) AS bookings_per_day_sale,
 round(count(*) FILTER (WHERE (t0 >= TIMESTAMP '2026-06-10' AND t0 < TIMESTAMP '2026-06-24') OR (t0 >= TIMESTAMP '2026-06-29' AND t0 < TIMESTAMP '2026-07-13'))::DOUBLE / 28, 1) AS bookings_per_day_base,
 round(sum(total_price) FILTER (WHERE t0 >= TIMESTAMP '2026-06-24' AND t0 < TIMESTAMP '2026-06-29') / 5, 0) AS value_per_day_sale,
 round(sum(total_price) FILTER (WHERE (t0 >= TIMESTAMP '2026-06-10' AND t0 < TIMESTAMP '2026-06-24') OR (t0 >= TIMESTAMP '2026-06-29' AND t0 < TIMESTAMP '2026-07-13')) / 28, 0) AS value_per_day_base
FROM bookings;
SELECT channel, count(*) AS sends, count(DISTINCT uid) AS members FROM ev WHERE event = 'notification received' AND campaign = 'summer_kickoff_sale' GROUP BY 1 ORDER BY 1;

-- EVAL Q13: card approval rate by platform and gateway status (warehouse only)
SELECT platform, gateway_status, count(*) AS days, round(avg(approval_rate), 4) AS avg_approval_rate,
 round(sum(authorizations_approved)::DOUBLE / sum(authorization_attempts), 4) AS weighted_approval_rate,
 round(avg(p95_auth_latency_ms), 0) AS avg_p95_latency_ms
FROM wh_gateway GROUP BY 1, 2 ORDER BY 1, 2;

-- EVAL Q14 (null): booked nightly_rate by All-in Pricing arm (bookings from Aug 25), overall and by web/app
SELECT p.variant, count(*) AS bookings, round(avg(b.nightly_rate), 2) AS avg_rate, round(stddev_samp(b.nightly_rate), 2) AS sd_rate,
 round(avg(b.total_price), 2) AS avg_total, round(avg(b.nights), 3) AS avg_nights
FROM bookings b JOIN prof p ON p.uid = b.uid WHERE p.variant IS NOT NULL AND b.t0 >= TIMESTAMP '2026-08-25' GROUP BY 1 ORDER BY 1;
WITH x AS (SELECT p.variant, b.nightly_rate AS r, CASE WHEN b.platform = 'web' THEN 'web' ELSE 'app' END AS split FROM bookings b JOIN prof p ON p.uid = b.uid WHERE p.variant IS NOT NULL AND b.t0 >= TIMESTAMP '2026-08-25'
  UNION ALL SELECT p.variant, b.nightly_rate, 'all' FROM bookings b JOIN prof p ON p.uid = b.uid WHERE p.variant IS NOT NULL AND b.t0 >= TIMESTAMP '2026-08-25'),
g AS (SELECT split, variant, count(*) AS n, avg(r) AS m, var_samp(r) AS v FROM x GROUP BY ALL)
SELECT a.split, round(a.m - c.m, 2) AS diff_variant_minus_control, round((a.m - c.m) / sqrt(a.v / a.n + c.v / c.n), 3) AS z
FROM g a JOIN g c ON a.split = c.split AND a.variant = 'All-in Pricing' AND c.variant = 'Control' ORDER BY 1;

-- EVAL Q15 (null): 30-day cancellation rate (not weather) of app vs web bookings, bookings Jun 4-Aug 31,
-- overall and within each lead bucket and rate type
WITH x AS (SELECT CASE WHEN platform = 'web' THEN 'web' ELSE 'app' END AS plat, lead_bucket, refundable,
  coalesce(reason <> 'weather' AND tc < t0 + INTERVAL 30 DAY, false) AS c FROM bookings WHERE t0 < TIMESTAMP '2026-09-01'),
y AS (SELECT plat, 'all' AS split, c FROM x UNION ALL SELECT plat, 'lead ' || lead_bucket, c FROM x
  UNION ALL SELECT plat, CASE WHEN refundable THEN 'refundable' ELSE 'non_refundable' END, c FROM x),
g AS (SELECT split, plat, count(*) AS n, avg(c::INT) AS p FROM y GROUP BY 1, 2),
p AS (SELECT a.split, a.p AS pa, b.p AS pw, a.n AS na, b.n AS nw FROM g a JOIN g b ON a.split = b.split AND a.plat = 'app' AND b.plat = 'web')
SELECT split, na AS app_bookings, nw AS web_bookings, round(pa, 4) AS app_rate, round(pw, 4) AS web_rate,
 round((pa - pw) / sqrt(((pa * na + pw * nw) / (na + nw)) * (1 - (pa * na + pw * nw) / (na + nw)) * (1.0 / na + 1.0 / nw)), 3) AS z
FROM p ORDER BY 1;

-- EVAL Q16: booking volume and value by region (whole window)
SELECT region, count(*) AS bookings, round(sum(total_price), 0) AS booking_value_usd, round(avg(nightly_rate), 2) AS avg_rate,
 round(avg(nights), 2) AS avg_nights, round(count(*)::DOUBLE / sum(count(*)) OVER (), 4) AS share
FROM bookings GROUP BY 1 ORDER BY 3 DESC;

-- EVAL Q17: members, new members, bookers, bookings
SELECT (SELECT count(*) FROM users) AS members, (SELECT count(DISTINCT uid) FROM ev) AS members_with_events,
 (SELECT count(*) FROM signups) AS new_members, (SELECT count(DISTINCT uid) FROM bookings) AS bookers,
 (SELECT count(*) FROM bookings) AS bookings, (SELECT round(sum(total_price), 0) FROM bookings) AS booking_value_usd,
 (SELECT count(*) FROM raw_events) AS events;

-- EVAL Q18: traveler segments — members, bookings, rate, lead time, nights
SELECT p.seg, count(DISTINCT p.uid) AS members, count(b.booking_id) AS bookings, round(avg(b.nightly_rate), 2) AS avg_rate,
 round(median(b.lead_time_days), 1) AS median_lead_days, round(avg(b.nights), 2) AS avg_nights
FROM prof p LEFT JOIN bookings b ON b.uid = p.uid GROUP BY 1 ORDER BY 1;

-- EVAL Q19: open-ended — inputs: paid spend mix and the share of property views on listings with under 10 reviews
SELECT acquisition_channel, round(sum(spend_usd), 0) AS spend, round(sum(spend_usd) / sum(sum(spend_usd)) OVER (), 4) AS spend_share FROM wh_spend GROUP BY 1 ORDER BY 1;
SELECT round(count(*) FILTER (WHERE review_count <= 9)::DOUBLE / count(*), 4) AS low_review_view_share FROM ev WHERE event = 'property viewed';

-- EVAL Q20: booking funnel per search session (searches Jun 4-Sep 23, 7-day window)
SELECT count(*) AS searches,
 round(avg(views), 2) AS avg_views,
 round(avg(coalesce(tc < t0 + INTERVAL 7 DAY, false)::INT), 4) AS search_to_checkout,
 round(sum(coalesce(tc < t0 + INTERVAL 7 DAY AND tb < t0 + INTERVAL 7 DAY, false)::INT)::DOUBLE / sum(coalesce(tc < t0 + INTERVAL 7 DAY, false)::INT), 4) AS checkout_to_booking,
 round(avg(coalesce(tb < t0 + INTERVAL 7 DAY, false)::INT), 4) AS search_to_booking
FROM sessions WHERE t0 < TIMESTAMP '2026-09-24';
