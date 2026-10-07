-- The Lantern (media vertical) — story-keyed and eval-keyed DuckDB queries.
--
-- Generate first (repo root):
--   node scripts/verify-runner.mjs dungeons/vertical/media/media.js verify-media
-- Run:
--   duckdb -c ".read dungeons/vertical/media/media.sql"
-- Against a gzipped export:
--   duckdb -c "SET VARIABLE data_prefix='<dir>/media'" -c ".read media.sql"
--
-- All times are UTC. Window: 2026-06-04 00:00 to 2026-10-01 23:59:59.

SET VARIABLE data_prefix = COALESCE(getvariable('data_prefix'), 'data/verify-media');

-- ─────────────────────────────────────────────────────────────────────────
-- PRELUDE: raw files, identity resolution, warehouse tables
-- ─────────────────────────────────────────────────────────────────────────
-- Identity: a new visitor's first read is anonymous (device_id only). The
-- registration event ("account registered", the auth event) carries user_id
-- and device_id, so Mixpanel stitches that device's earlier anonymous events
-- to the member. A device resolves to the member seen with it on any event
-- that carries both ids; devices never seen with a user_id stay anonymous
-- visitors (uid = device_id), the way Mixpanel counts them.

CREATE OR REPLACE TEMP TABLE raw_events AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-EVENTS*.json*', sample_size=-1, union_by_name=true);

CREATE OR REPLACE TEMP TABLE device_map AS
SELECT device_id, min(user_id::VARCHAR) AS mapped
FROM raw_events WHERE user_id IS NOT NULL AND device_id IS NOT NULL GROUP BY 1;

CREATE OR REPLACE TEMP TABLE ev AS
SELECT coalesce(e.user_id::VARCHAR, m.mapped, e.device_id) AS uid, e.time::TIMESTAMP AS t, e.*
FROM raw_events e LEFT JOIN device_map m ON e.device_id = m.device_id;

-- profiles of identified members (visitors who never registered have no profile in Mixpanel)
CREATE OR REPLACE TEMP TABLE users AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-USERS*.json*', sample_size=-1, union_by_name=true)
WHERE distinct_id::VARCHAR IN (SELECT DISTINCT user_id::VARCHAR FROM raw_events WHERE user_id IS NOT NULL);

CREATE OR REPLACE TEMP TABLE wh_spend AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-marketing_spend_daily.json*', sample_size=-1, union_by_name=true);
CREATE OR REPLACE TEMP TABLE wh_platform AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-platform_reliability_daily.json*', sample_size=-1, union_by_name=true);
CREATE OR REPLACE TEMP TABLE wh_billing AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-subscription_billing_daily.json*', sample_size=-1, union_by_name=true);

-- new visitors: one row per reader whose first read in the data is anonymous,
-- with their registration (if any) within 7 days
CREATE OR REPLACE TEMP TABLE visitors AS
WITH v AS (SELECT uid, min(t) AS t0, any_value(acquisition_channel) AS ch, any_value(platform) AS platform
  FROM ev WHERE event = 'article viewed' AND reader_tier = 'anonymous' GROUP BY 1),
r AS (SELECT uid, min(t) AS tr FROM ev WHERE event = 'account registered' GROUP BY 1)
SELECT v.*, r.tr, (r.tr IS NOT NULL AND r.tr >= v.t0 AND r.tr < v.t0 + INTERVAL 7 DAY) AS registered_7d,
 date_diff('second', v.t0, r.tr) / 3600.0 AS hours_to_register,
 CASE WHEN v.ch IN ('meta_ads', 'social') THEN 'social' ELSE 'other' END AS channel_group
FROM v LEFT JOIN r ON r.uid = v.uid;

-- dataset overview
SELECT count(*) AS events, count(DISTINCT uid) AS readers, count(DISTINCT user_id) AS identified_members,
 count(DISTINCT uid) FILTER (WHERE user_id IS NULL AND uid = device_id) AS anonymous_visitors,
 min(t) AS first_event, max(t) AS last_event FROM ev;

-- identity and device checks: one platform per device; apps only on phones and tablets
SELECT (SELECT max(n) FROM (SELECT device_id, count(DISTINCT platform) AS n FROM ev GROUP BY 1)) AS max_platforms_per_device,
 count(*) FILTER (WHERE platform <> 'web' AND os NOT IN ('iOS', 'iPadOS', 'Android')) AS app_events_on_desktop,
 count(*) FILTER (WHERE reader_tier = 'anonymous' AND user_id IS NOT NULL) AS anonymous_events_with_user_id
FROM ev;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H1-world-cup-sports-surge — sports reads x1.97 (mean) during the World Cup
-- ─────────────────────────────────────────────────────────────────────────
-- subscribers (no meter): sports / non-sports reads, Jun 11 - Jul 19 vs Jun 4-7 + Jul 23 - Aug 19
WITH w AS (SELECT CASE WHEN t >= TIMESTAMP '2026-06-11' AND t < TIMESTAMP '2026-07-20' THEN 'in'
    WHEN t < TIMESTAMP '2026-06-08' OR (t >= TIMESTAMP '2026-07-23' AND t < TIMESTAMP '2026-08-20') THEN 'base' END AS per, section
  FROM ev WHERE event = 'article viewed' AND reader_tier IN ('digital', 'all_access'))
SELECT (count(*) FILTER (WHERE per = 'in' AND section = 'sports')::DOUBLE / count(*) FILTER (WHERE per = 'in' AND section <> 'sports'))
 / (count(*) FILTER (WHERE per = 'base' AND section = 'sports')::DOUBLE / count(*) FILTER (WHERE per = 'base' AND section <> 'sports')) AS sports_lift_subscribers
FROM w WHERE per IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H2-for-you-feed-experiment — home_feed clicks per home view x1.5 in the For You arm
-- ─────────────────────────────────────────────────────────────────────────
WITH x AS (SELECT uid, any_value("Variant name") AS variant, min(t) AS t0 FROM ev WHERE event = '$experiment_started' GROUP BY 1)
SELECT x.variant, count(DISTINCT x.uid) AS exposed_readers,
 count(*) FILTER (WHERE event = 'recommendation clicked' AND module = 'home_feed') AS feed_clicks,
 count(*) FILTER (WHERE event = 'front page viewed' AND page = 'home') AS home_views,
 round(count(*) FILTER (WHERE event = 'recommendation clicked' AND module = 'home_feed')::DOUBLE / count(*) FILTER (WHERE event = 'front page viewed' AND page = 'home'), 4) AS feed_ctr
FROM ev JOIN x ON x.uid = ev.uid WHERE ev.t >= x.t0 AND ev.platform IN ('ios_app', 'android_app') GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H3-gift-articles-launch — subscriber shares per attempted read x1.6 after 2026-08-11
-- ─────────────────────────────────────────────────────────────────────────
WITH w AS (SELECT CASE WHEN t >= TIMESTAMP '2026-07-20' AND t < TIMESTAMP '2026-08-11' THEN 'pre' WHEN t >= TIMESTAMP '2026-08-18' THEN 'post' END AS per,
  CASE WHEN reader_tier IN ('digital', 'all_access') THEN 'subscriber' WHEN reader_tier = 'registered' THEN 'free' END AS grp, event
  FROM ev WHERE event IN ('article shared', 'article viewed', 'paywall shown')),
g AS (SELECT per, grp, count(*) FILTER (WHERE event = 'article shared')::DOUBLE / count(*) FILTER (WHERE event IN ('article viewed', 'paywall shown')) AS share_rate
  FROM w WHERE per IS NOT NULL AND grp IS NOT NULL GROUP BY 1, 2)
SELECT grp, max(share_rate) FILTER (WHERE per = 'pre') AS share_rate_pre, max(share_rate) FILTER (WHERE per = 'post') AS share_rate_post,
 max(share_rate) FILTER (WHERE per = 'post') / max(share_rate) FILTER (WHERE per = 'pre') AS change
FROM g GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H4-web-meter-outage — 70% of blocked web reads went through free, 2026-08-25..27 (warehouse join)
-- ─────────────────────────────────────────────────────────────────────────
WITH o AS (SELECT DISTINCT date::DATE AS d FROM wh_platform WHERE service_status = 'major_outage'),
w AS (SELECT t::DATE AS d, platform = 'web' AS web FROM ev WHERE event = 'paywall shown' AND t >= TIMESTAMP '2026-08-11' AND t < TIMESTAMP '2026-09-11'),
g AS (SELECT (d IN (SELECT d FROM o)) AS outage, count(*) FILTER (WHERE web)::DOUBLE / count(*) FILTER (WHERE NOT web) AS web_to_app FROM w GROUP BY 1)
SELECT max(web_to_app) FILTER (WHERE outage) AS web_to_app_outage, max(web_to_app) FILTER (WHERE NOT outage) AS web_to_app_baseline,
 max(web_to_app) FILTER (WHERE outage) / max(web_to_app) FILTER (WHERE NOT outage) AS relative_web_paywall,
 (SELECT avg(meter_error_rate) FROM wh_platform WHERE service_status = 'major_outage') AS warehouse_meter_error_rate
FROM g;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H5-paid-channel-economics — spend per visitor, registration rate, spend per registration
-- ─────────────────────────────────────────────────────────────────────────
WITH sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM wh_spend GROUP BY 1),
c AS (SELECT ch, count(*) AS visitors, count(*) FILTER (WHERE registered_7d) AS registrations FROM visitors GROUP BY 1)
SELECT c.ch, c.visitors, c.registrations, round(sp.spend, 2) AS spend_usd, round(sp.spend / c.visitors, 3) AS spend_per_visitor,
 round(sp.spend / c.registrations, 2) AS spend_per_registration
FROM c LEFT JOIN sp ON sp.ch = c.ch ORDER BY c.ch;

-- registration within 7 days, social platforms vs the rest (visitors through Sep 24)
SELECT channel_group, count(*) AS visitors, round(avg(registered_7d::INT), 4) AS registration_rate
FROM visitors WHERE t0 < TIMESTAMP '2026-09-25' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H6-newsletter-readers-convert — paywall conversion per view x2.5 for newsletter reads
-- ─────────────────────────────────────────────────────────────────────────
SELECT CASE WHEN referrer = 'newsletter' THEN 'newsletter' ELSE 'other' END AS source,
 count(*) FILTER (WHERE event = 'paywall shown') AS paywall_views, count(*) FILTER (WHERE event = 'subscription started') AS subscriptions,
 round(count(*) FILTER (WHERE event = 'subscription started')::DOUBLE / count(*) FILTER (WHERE event = 'paywall shown'), 5) AS conversion_per_view
FROM ev WHERE event IN ('paywall shown', 'subscription started') GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H7-labor-day-sale — conversion x2 and first-period bookings per view x0.8, 2026-09-03..09 (warehouse join)
-- ─────────────────────────────────────────────────────────────────────────
WITH p AS (SELECT DISTINCT date::DATE AS d, plan, billing_period, first_period_price_usd FROM wh_billing),
w AS (SELECT CASE WHEN t >= TIMESTAMP '2026-09-03' AND t < TIMESTAMP '2026-09-10' THEN 'sale'
    WHEN t >= TIMESTAMP '2026-08-06' AND t < TIMESTAMP '2026-09-03' THEN 'pre' END AS per, ev.event, p.first_period_price_usd
  FROM ev LEFT JOIN p ON ev.event = 'subscription started' AND p.d = ev.t::DATE AND p.plan = ev.plan AND p.billing_period = ev.billing_period
  WHERE ev.event IN ('paywall shown', 'subscription started'))
SELECT per, count(*) FILTER (WHERE event = 'paywall shown') AS paywall_views, count(*) FILTER (WHERE event = 'subscription started') AS subscriptions,
 round(count(*) FILTER (WHERE event = 'subscription started')::DOUBLE / count(*) FILTER (WHERE event = 'paywall shown'), 5) AS conversion_per_view,
 round(sum(first_period_price_usd) FILTER (WHERE event = 'subscription started') / count(*) FILTER (WHERE event = 'paywall shown'), 4) AS first_period_bookings_per_view
FROM w WHERE per IS NOT NULL GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H8-registration-speed-by-channel — median first read → registration 4 h vs 12 h (social)
-- ─────────────────────────────────────────────────────────────────────────
SELECT channel_group, count(*) FILTER (WHERE registered_7d) AS registrations,
 round(median(hours_to_register) FILTER (WHERE registered_7d), 2) AS median_hours,
 round(avg(hours_to_register) FILTER (WHERE registered_7d), 2) AS mean_hours
FROM visitors WHERE t0 < TIMESTAMP '2026-09-25' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H9-reading-habit-churn — monthly cancel 16% (< 4 reading days prior month) vs 4%
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE TEMP TABLE sub_months AS
WITH m AS (SELECT * FROM (VALUES (DATE '2026-07-01', DATE '2026-06-01'), (DATE '2026-08-01', DATE '2026-07-01'), (DATE '2026-09-01', DATE '2026-08-01')) x(ms, pms)),
um AS (SELECT m.ms, ev.uid, bool_and(ev.reader_tier IN ('digital', 'all_access')) AS all_sub,
  bool_or(ev.event IN ('subscription started', 'subscription cancelled')) AS changed,
  count(DISTINCT ev.t::DATE) FILTER (WHERE ev.event = 'article viewed') AS reading_days
  FROM ev JOIN m ON ev.t >= m.pms AND ev.t < m.ms GROUP BY 1, 2),
c AS (SELECT DISTINCT m.ms, ev.uid FROM ev JOIN m ON ev.t >= m.ms AND ev.t < m.ms + INTERVAL 1 MONTH WHERE ev.event = 'subscription cancelled')
SELECT um.ms, um.uid, um.reading_days, c.uid IS NOT NULL AS cancelled
FROM um LEFT JOIN c ON c.ms = um.ms AND c.uid = um.uid WHERE all_sub AND NOT changed;

SELECT CASE WHEN reading_days < 4 THEN 'under 4 days' ELSE '4+ days' END AS prior_month_reading, count(*) AS subscriber_months,
 count(*) FILTER (WHERE cancelled) AS cancels, round(avg(cancelled::INT), 4) AS cancel_rate
FROM sub_months GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H10-weekend-long-reads — read time x1.35 on Saturday and Sunday (UTC)
-- ─────────────────────────────────────────────────────────────────────────
SELECT round(avg(read_time_sec) FILTER (WHERE dayofweek(t) IN (0, 6)), 1) AS weekend_avg_read_sec,
 round(avg(read_time_sec) FILTER (WHERE dayofweek(t) NOT IN (0, 6)), 1) AS weekday_avg_read_sec,
 round(avg(read_time_sec) FILTER (WHERE dayofweek(t) IN (0, 6)) / avg(read_time_sec) FILTER (WHERE dayofweek(t) NOT IN (0, 6)), 4) AS weekend_ratio
FROM ev WHERE event = 'article viewed';

-- ═════════════════════════════════════════════════════════════════════════
-- EVAL QUERIES (eval/media.eval.md)
-- ═════════════════════════════════════════════════════════════════════════

-- EVAL Q1 — World Cup sports surge: all readers and subscribers, and weekly sports reads
WITH w AS (SELECT CASE WHEN t >= TIMESTAMP '2026-06-11' AND t < TIMESTAMP '2026-07-20' THEN 'in'
    WHEN t < TIMESTAMP '2026-06-08' OR (t >= TIMESTAMP '2026-07-23' AND t < TIMESTAMP '2026-08-20') THEN 'base' END AS per,
  section, reader_tier IN ('digital', 'all_access') AS sub, t::DATE AS d FROM ev WHERE event = 'article viewed')
SELECT 'all readers' AS who,
 round(count(*) FILTER (WHERE per = 'in' AND section = 'sports')::DOUBLE / count(DISTINCT d) FILTER (WHERE per = 'in'), 1) AS sports_reads_per_day_in,
 round(count(*) FILTER (WHERE per = 'base' AND section = 'sports')::DOUBLE / count(DISTINCT d) FILTER (WHERE per = 'base'), 1) AS sports_reads_per_day_base,
 round(avg((section = 'sports')::INT) FILTER (WHERE per = 'in'), 4) AS sports_share_in, round(avg((section = 'sports')::INT) FILTER (WHERE per = 'base'), 4) AS sports_share_base,
 round((count(*) FILTER (WHERE per = 'in' AND section = 'sports')::DOUBLE / count(*) FILTER (WHERE per = 'in' AND section <> 'sports'))
  / (count(*) FILTER (WHERE per = 'base' AND section = 'sports')::DOUBLE / count(*) FILTER (WHERE per = 'base' AND section <> 'sports')), 3) AS sports_lift
FROM w WHERE per IS NOT NULL
UNION ALL
SELECT 'subscribers',
 round(count(*) FILTER (WHERE per = 'in' AND section = 'sports')::DOUBLE / count(DISTINCT d) FILTER (WHERE per = 'in'), 1),
 round(count(*) FILTER (WHERE per = 'base' AND section = 'sports')::DOUBLE / count(DISTINCT d) FILTER (WHERE per = 'base'), 1),
 round(avg((section = 'sports')::INT) FILTER (WHERE per = 'in'), 4), round(avg((section = 'sports')::INT) FILTER (WHERE per = 'base'), 4),
 round((count(*) FILTER (WHERE per = 'in' AND section = 'sports')::DOUBLE / count(*) FILTER (WHERE per = 'in' AND section <> 'sports'))
  / (count(*) FILTER (WHERE per = 'base' AND section = 'sports')::DOUBLE / count(*) FILTER (WHERE per = 'base' AND section <> 'sports')), 3)
FROM w WHERE per IS NOT NULL AND sub;

-- EVAL Q1 (weekly sports reads, all readers)
SELECT date_trunc('week', t)::DATE AS week_of, count(*) FILTER (WHERE section = 'sports') AS sports_reads,
 round(avg((section = 'sports')::INT), 4) AS sports_share
FROM ev WHERE event = 'article viewed' AND t >= TIMESTAMP '2026-06-08' AND t < TIMESTAMP '2026-09-28' GROUP BY 1 ORDER BY 1;

-- EVAL Q1 (was it only sports? non-sports reads per active reader-day and active readers per day, all readers)
WITH w AS (SELECT CASE WHEN t >= TIMESTAMP '2026-06-11' AND t < TIMESTAMP '2026-07-20' THEN 'in'
    WHEN t < TIMESTAMP '2026-06-08' OR (t >= TIMESTAMP '2026-07-23' AND t < TIMESTAMP '2026-08-20') THEN 'base' END AS per,
  section, uid, t::DATE AS d FROM ev WHERE event = 'article viewed')
SELECT per, count(DISTINCT d) AS days, round(count(DISTINCT uid || '|' || d)::DOUBLE / count(DISTINCT d), 1) AS active_readers_per_day,
 round(count(*) FILTER (WHERE section <> 'sports')::DOUBLE / count(DISTINCT uid || '|' || d), 3) AS non_sports_reads_per_reader_day,
 round(count(*) FILTER (WHERE section = 'sports')::DOUBLE / count(DISTINCT uid || '|' || d), 3) AS sports_reads_per_reader_day
FROM w WHERE per IS NOT NULL GROUP BY 1 ORDER BY 1;

-- EVAL Q2 — For You feed experiment: feed CTR, exposed readers, reads per exposed reader-day on the apps
WITH x AS (SELECT uid, any_value("Variant name") AS variant, min(t) AS t0 FROM ev WHERE event = '$experiment_started' GROUP BY 1),
a AS (SELECT x.variant, ev.uid, ev.t::DATE AS d, ev.event, ev.module, ev.page FROM ev JOIN x ON x.uid = ev.uid
  WHERE ev.t >= x.t0 AND ev.platform IN ('ios_app', 'android_app'))
SELECT variant, count(DISTINCT uid) AS exposed_readers,
 round(count(*) FILTER (WHERE event = 'recommendation clicked' AND module = 'home_feed')::DOUBLE / count(*) FILTER (WHERE event = 'front page viewed' AND page = 'home'), 4) AS feed_ctr,
 round(count(*) FILTER (WHERE event IN ('article viewed', 'paywall shown'))::DOUBLE / count(DISTINCT uid || '|' || d), 3) AS attempted_reads_per_reader_day,
 round(count(*) FILTER (WHERE event = 'article viewed')::DOUBLE / count(DISTINCT uid || '|' || d), 3) AS article_views_per_reader_day
FROM a GROUP BY 1 ORDER BY 1;

-- EVAL Q2 (z for the feed click-through, treating each home view as a trial)
WITH x AS (SELECT uid, any_value("Variant name") AS variant, min(t) AS t0 FROM ev WHERE event = '$experiment_started' GROUP BY 1),
g AS (SELECT x.variant, count(*) FILTER (WHERE event = 'recommendation clicked' AND module = 'home_feed') AS k, count(*) FILTER (WHERE event = 'front page viewed' AND page = 'home') AS n
  FROM ev JOIN x ON x.uid = ev.uid WHERE ev.t >= x.t0 AND ev.platform IN ('ios_app', 'android_app') GROUP BY 1),
p AS (SELECT max(k) FILTER (WHERE variant = 'For You') AS k1, max(n) FILTER (WHERE variant = 'For You') AS n1, max(k) FILTER (WHERE variant = 'Control') AS k0, max(n) FILTER (WHERE variant = 'Control') AS n0 FROM g)
SELECT round((k1::DOUBLE / n1) / (k0::DOUBLE / n0), 3) AS ctr_ratio,
 round((k1::DOUBLE / n1 - k0::DOUBLE / n0) / sqrt(((k1 + k0)::DOUBLE / (n1 + n0)) * (1 - (k1 + k0)::DOUBLE / (n1 + n0)) * (1.0 / n1 + 1.0 / n0)), 1) AS z
FROM p;

-- EVAL Q3 — For You and paywall conversion (null check): subscriptions per paywall view by arm, overall and by app
WITH x AS (SELECT uid, any_value("Variant name") AS variant, min(t) AS t0 FROM ev WHERE event = '$experiment_started' GROUP BY 1),
a AS (SELECT x.variant, ev.event, ev.platform FROM ev JOIN x ON x.uid = ev.uid WHERE ev.t >= x.t0 AND ev.event IN ('paywall shown', 'subscription started')),
g AS (SELECT variant, 'all' AS platform, count(*) FILTER (WHERE event = 'paywall shown') AS n, count(*) FILTER (WHERE event = 'subscription started') AS k FROM a GROUP BY 1
  UNION ALL SELECT variant, platform, count(*) FILTER (WHERE event = 'paywall shown'), count(*) FILTER (WHERE event = 'subscription started') FROM a GROUP BY 1, 2),
p AS (SELECT platform, max(n) FILTER (WHERE variant = 'For You') AS n1, max(k) FILTER (WHERE variant = 'For You') AS k1,
  max(n) FILTER (WHERE variant = 'Control') AS n0, max(k) FILTER (WHERE variant = 'Control') AS k0 FROM g GROUP BY 1)
SELECT platform, n1 AS for_you_views, k1 AS for_you_subs, round(k1::DOUBLE / n1, 5) AS for_you_rate, n0 AS control_views, k0 AS control_subs, round(k0::DOUBLE / n0, 5) AS control_rate,
 round((k1::DOUBLE / n1 - k0::DOUBLE / n0) / sqrt(((k1 + k0)::DOUBLE / (n1 + n0)) * (1 - (k1 + k0)::DOUBLE / (n1 + n0)) * (1.0 / n1 + 1.0 / n0)), 3) AS z
FROM p ORDER BY platform;

-- EVAL Q3 (share of exposed readers who subscribed after exposure, by arm)
WITH x AS (SELECT uid, any_value("Variant name") AS variant, min(t) AS t0 FROM ev WHERE event = '$experiment_started' GROUP BY 1),
s AS (SELECT DISTINCT ev.uid FROM ev JOIN x ON x.uid = ev.uid WHERE ev.event = 'subscription started' AND ev.t >= x.t0)
SELECT x.variant, count(*) AS exposed, count(s.uid) AS subscribed_after_exposure, round(count(s.uid)::DOUBLE / count(*), 4) AS share
FROM x LEFT JOIN s ON s.uid = x.uid GROUP BY 1 ORDER BY 1;

-- EVAL Q3 (z for the share of exposed readers who subscribed, For You vs Control)
WITH x AS (SELECT uid, any_value("Variant name") AS variant, min(t) AS t0 FROM ev WHERE event = '$experiment_started' GROUP BY 1),
s AS (SELECT DISTINCT ev.uid FROM ev JOIN x ON x.uid = ev.uid WHERE ev.event = 'subscription started' AND ev.t >= x.t0),
g AS (SELECT x.variant, count(*) AS n, count(s.uid) AS k FROM x LEFT JOIN s ON s.uid = x.uid GROUP BY 1),
p AS (SELECT max(k) FILTER (WHERE variant = 'For You') AS k1, max(n) FILTER (WHERE variant = 'For You') AS n1, max(k) FILTER (WHERE variant = 'Control') AS k0, max(n) FILTER (WHERE variant = 'Control') AS n0 FROM g)
SELECT round((k1::DOUBLE / n1 - k0::DOUBLE / n0) / sqrt(((k1 + k0)::DOUBLE / (n1 + n0)) * (1 - (k1 + k0)::DOUBLE / (n1 + n0)) * (1.0 / n1 + 1.0 / n0)), 2) AS z_subscribed_share FROM p;

-- EVAL Q4 — Gift Articles: weekly shares by tier and gift links
SELECT date_trunc('week', t)::DATE AS week_of,
 count(*) FILTER (WHERE event = 'article shared' AND reader_tier IN ('digital', 'all_access')) AS subscriber_shares,
 count(*) FILTER (WHERE event = 'article shared' AND share_method = 'gift_link') AS gift_links,
 count(*) FILTER (WHERE event = 'article shared' AND reader_tier = 'registered') AS free_reader_shares
FROM ev WHERE t >= TIMESTAMP '2026-07-13' AND t < TIMESTAMP '2026-09-28' GROUP BY 1 ORDER BY 1;

-- EVAL Q4 (gift totals)
SELECT count(*) FILTER (WHERE share_method = 'gift_link') AS gift_links_total,
 count(DISTINCT uid) FILTER (WHERE share_method = 'gift_link') AS subscribers_who_gifted,
 round(avg((share_method = 'gift_link')::INT) FILTER (WHERE t >= TIMESTAMP '2026-08-18' AND reader_tier IN ('digital', 'all_access')), 4) AS gift_share_of_subscriber_shares_after_ramp
FROM ev WHERE event = 'article shared';

-- EVAL Q5 — late-August paywall and subscription dip (web vs apps, daily) joined to the warehouse status
WITH d AS (SELECT t::DATE AS day, platform = 'web' AS web, event FROM ev WHERE event IN ('paywall shown', 'subscription started') AND t >= TIMESTAMP '2026-08-18' AND t < TIMESTAMP '2026-09-04')
SELECT day, count(*) FILTER (WHERE web AND event = 'paywall shown') AS web_paywalls, count(*) FILTER (WHERE NOT web AND event = 'paywall shown') AS app_paywalls,
 count(*) FILTER (WHERE web AND event = 'subscription started') AS web_subs, count(*) FILTER (WHERE NOT web AND event = 'subscription started') AS app_subs,
 any_value(w.service_status) AS web_status, any_value(w.meter_error_rate) AS web_meter_error_rate
FROM d LEFT JOIN wh_platform w ON w.date::DATE = d.day AND w.platform = 'web' GROUP BY 1 ORDER BY 1;

-- EVAL Q6 — subscriptions lost to the outage: expected web paywall views (from the web/app baseline) x web conversion
WITH o AS (SELECT DISTINCT date::DATE AS d FROM wh_platform WHERE service_status = 'major_outage'),
w AS (SELECT t::DATE AS d, platform = 'web' AS web, event FROM ev WHERE event IN ('paywall shown', 'subscription started') AND t >= TIMESTAMP '2026-08-11' AND t < TIMESTAMP '2026-09-11'),
base AS (SELECT count(*) FILTER (WHERE web AND event = 'paywall shown')::DOUBLE / count(*) FILTER (WHERE NOT web AND event = 'paywall shown') AS ratio,
  count(*) FILTER (WHERE web AND event = 'subscription started')::DOUBLE / count(*) FILTER (WHERE web AND event = 'paywall shown') AS web_conv
  FROM w WHERE d NOT IN (SELECT d FROM o)),
inc AS (SELECT count(*) FILTER (WHERE web AND event = 'paywall shown') AS web_views, count(*) FILTER (WHERE NOT web AND event = 'paywall shown') AS app_views,
  count(*) FILTER (WHERE web AND event = 'subscription started') AS web_subs FROM w WHERE d IN (SELECT d FROM o))
SELECT inc.web_views, round(inc.app_views * base.ratio) AS expected_web_views, round(inc.app_views * base.ratio) - inc.web_views AS missing_web_paywalls,
 inc.web_subs AS web_subs_actual, round(inc.app_views * base.ratio * base.web_conv, 1) AS web_subs_expected,
 round((inc.app_views * base.ratio - inc.web_views) * base.web_conv, 1) AS subscriptions_lost,
 round((inc.app_views * base.ratio - inc.web_views) * base.web_conv
  * (SELECT sum(gross_bookings_usd) / sum(new_subscriptions) FROM wh_billing WHERE date::DATE NOT BETWEEN DATE '2026-09-03' AND DATE '2026-09-09'), 0) AS first_period_bookings_lost_usd
FROM inc, base;

-- EVAL Q7 — paid channel economics (warehouse spend joined to Mixpanel visitors and registrations)
WITH sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend, sum(clicks) AS reported_clicks FROM wh_spend GROUP BY 1),
c AS (SELECT ch, count(*) AS visitors, count(*) FILTER (WHERE registered_7d) AS registrations FROM visitors GROUP BY 1),
subs AS (SELECT v.ch, count(DISTINCT s.uid) AS subscribers FROM visitors v JOIN ev s ON s.uid = v.uid AND s.event = 'subscription started' GROUP BY 1)
SELECT c.ch, round(sp.spend, 0) AS spend_usd, c.visitors, sp.reported_clicks, c.registrations, coalesce(subs.subscribers, 0) AS subscribers,
 round(sp.spend / c.visitors, 2) AS per_visitor, round(sp.spend / c.registrations, 2) AS per_registration,
 round(sp.spend / nullif(subs.subscribers, 0), 0) AS per_subscriber
FROM c JOIN sp ON sp.ch = c.ch LEFT JOIN subs ON subs.ch = c.ch ORDER BY per_registration;

-- EVAL Q8 — new visitors and 7-day registration by acquisition channel (visitors through Sep 24)
SELECT ch, count(*) AS visitors, count(*) FILTER (WHERE registered_7d) AS registered, round(avg(registered_7d::INT), 4) AS registration_rate
FROM visitors WHERE t0 < TIMESTAMP '2026-09-25' GROUP BY ROLLUP (ch) ORDER BY ch NULLS LAST;

-- EVAL Q9 — paywall conversion per view by the blocked read's referrer
SELECT referrer, count(*) FILTER (WHERE event = 'paywall shown') AS paywall_views, count(*) FILTER (WHERE event = 'subscription started') AS subscriptions,
 round(count(*) FILTER (WHERE event = 'subscription started')::DOUBLE / count(*) FILTER (WHERE event = 'paywall shown'), 5) AS conversion_per_view,
 round(count(*) FILTER (WHERE event = 'subscription started')::DOUBLE / sum(count(*) FILTER (WHERE event = 'subscription started')) OVER (), 4) AS share_of_subscriptions,
 round(count(*) FILTER (WHERE event = 'paywall shown')::DOUBLE / sum(count(*) FILTER (WHERE event = 'paywall shown')) OVER (), 4) AS share_of_paywall_views
FROM ev WHERE event IN ('paywall shown', 'subscription started') GROUP BY 1 ORDER BY conversion_per_view DESC;

-- EVAL Q10 — Labor Day sale: conversion, subscriptions, and first-period bookings (warehouse prices)
WITH p AS (SELECT DISTINCT date::DATE AS d, plan, billing_period, first_period_price_usd, list_price_usd FROM wh_billing),
w AS (SELECT CASE WHEN t >= TIMESTAMP '2026-09-03' AND t < TIMESTAMP '2026-09-10' THEN 'sale (Sep 3-9)'
    WHEN t >= TIMESTAMP '2026-08-06' AND t < TIMESTAMP '2026-09-03' THEN 'pre (Aug 6 - Sep 2)' END AS per, ev.event, p.first_period_price_usd, p.list_price_usd, ev.t::DATE AS d
  FROM ev LEFT JOIN p ON ev.event = 'subscription started' AND p.d = ev.t::DATE AND p.plan = ev.plan AND p.billing_period = ev.billing_period
  WHERE ev.event IN ('paywall shown', 'subscription started'))
SELECT per, count(DISTINCT d) AS days, count(*) FILTER (WHERE event = 'paywall shown') AS paywall_views, count(*) FILTER (WHERE event = 'subscription started') AS subscriptions,
 round(count(*) FILTER (WHERE event = 'subscription started')::DOUBLE / count(DISTINCT d), 1) AS subs_per_day,
 round(count(*) FILTER (WHERE event = 'subscription started')::DOUBLE / count(*) FILTER (WHERE event = 'paywall shown'), 5) AS conversion_per_view,
 round(sum(first_period_price_usd) FILTER (WHERE event = 'subscription started'), 2) AS first_period_bookings,
 round(sum(first_period_price_usd) FILTER (WHERE event = 'subscription started') / count(DISTINCT d), 2) AS first_period_bookings_per_day,
 round(sum(first_period_price_usd) FILTER (WHERE event = 'subscription started') / count(*) FILTER (WHERE event = 'paywall shown'), 4) AS bookings_per_paywall_view,
 round(sum(list_price_usd) FILTER (WHERE event = 'subscription started') / count(DISTINCT d), 2) AS list_value_per_day
FROM w WHERE per IS NOT NULL GROUP BY 1 ORDER BY 1;

-- EVAL Q11 — time from first visit to registration by channel (registrations within 7 days, visitors through Sep 24)
SELECT ch, count(*) FILTER (WHERE registered_7d) AS registrations, round(median(hours_to_register) FILTER (WHERE registered_7d), 1) AS median_hours,
 round(avg((hours_to_register <= 1)::INT) FILTER (WHERE registered_7d), 3) AS share_within_1h, round(avg((hours_to_register > 24)::INT) FILTER (WHERE registered_7d), 3) AS share_after_24h
FROM visitors WHERE t0 < TIMESTAMP '2026-09-25' GROUP BY ROLLUP (ch) ORDER BY ch NULLS LAST;

-- EVAL Q12 — cancellation by prior-month reading days (subscriber-months Jul-Sep), finer buckets
SELECT CASE WHEN reading_days = 0 THEN '0' WHEN reading_days <= 3 THEN '1-3' WHEN reading_days <= 7 THEN '4-7' WHEN reading_days <= 14 THEN '8-14' ELSE '15+' END AS prior_month_reading_days,
 count(*) AS subscriber_months, count(*) FILTER (WHERE cancelled) AS cancels, round(avg(cancelled::INT), 4) AS cancel_rate
FROM sub_months GROUP BY 1 ORDER BY min(reading_days);

-- EVAL Q12 (stated cancellation reasons, whole window)
SELECT cancel_reason, count(*) AS cancellations, round(count(*)::DOUBLE / sum(count(*)) OVER (), 4) AS share
FROM ev WHERE event = 'subscription cancelled' GROUP BY 1 ORDER BY 2 DESC;

-- EVAL Q13 — weekend reading: read time and scroll depth by day of week
SELECT dayname(t) AS day, count(*) AS reads, round(avg(read_time_sec), 1) AS avg_read_sec, round(avg(scroll_depth_pct), 1) AS avg_scroll_pct,
 round(avg((content_type IN ('feature', 'analysis'))::INT), 4) AS long_form_share
FROM ev WHERE event = 'article viewed' GROUP BY 1, dayofweek(t) ORDER BY dayofweek(t);

-- EVAL Q14 — plan and billing mix of new subscriptions, outside vs during the Labor Day sale
SELECT CASE WHEN offer = 'labor_day_sale' THEN 'sale week' ELSE 'rest of window' END AS period, count(*) AS subscriptions,
 round(avg((plan = 'digital')::INT), 4) AS digital_share, round(avg((plan = 'all_access')::INT), 4) AS all_access_share,
 round(avg((billing_period = 'annual')::INT), 4) AS annual_share
FROM ev WHERE event = 'subscription started' GROUP BY 1 ORDER BY 1;

-- EVAL Q14 (z for the sale-week mix vs the rest of the window: All Access share and annual share)
WITH g AS (SELECT offer = 'labor_day_sale' AS sale, count(*) AS n, count(*) FILTER (WHERE plan = 'all_access') AS aa, count(*) FILTER (WHERE billing_period = 'annual') AS an
  FROM ev WHERE event = 'subscription started' GROUP BY 1),
p AS (SELECT max(n) FILTER (WHERE sale) AS n1, max(n) FILTER (WHERE NOT sale) AS n0, max(aa) FILTER (WHERE sale) AS aa1, max(aa) FILTER (WHERE NOT sale) AS aa0,
  max(an) FILTER (WHERE sale) AS an1, max(an) FILTER (WHERE NOT sale) AS an0 FROM g)
SELECT round((aa1::DOUBLE / n1 - aa0::DOUBLE / n0) / sqrt(((aa1 + aa0)::DOUBLE / (n1 + n0)) * (1 - (aa1 + aa0)::DOUBLE / (n1 + n0)) * (1.0 / n1 + 1.0 / n0)), 2) AS z_all_access_share,
 round((an1::DOUBLE / n1 - an0::DOUBLE / n0) / sqrt(((an1 + an0)::DOUBLE / (n1 + n0)) * (1 - (an1 + an0)::DOUBLE / (n1 + n0)) * (1.0 / n1 + 1.0 / n0)), 2) AS z_annual_share
FROM p;

-- EVAL Q14 (plan x billing period, whole window)
SELECT plan, billing_period, count(*) AS subscriptions, round(count(*)::DOUBLE / sum(count(*)) OVER (), 4) AS share
FROM ev WHERE event = 'subscription started' GROUP BY 1, 2 ORDER BY 1, 2;

-- EVAL Q15 — registrations and new visitors per day: World Cup vs the rest of the window (null check)
WITH d AS (SELECT t::DATE AS day, count(*) FILTER (WHERE event = 'account registered') AS regs FROM ev GROUP BY 1),
v AS (SELECT t0::DATE AS day, count(*) AS visitors FROM visitors GROUP BY 1),
j AS (SELECT d.day, d.regs, coalesce(v.visitors, 0) AS visitors, (d.day >= DATE '2026-06-11' AND d.day < DATE '2026-07-20') AS wc FROM d LEFT JOIN v ON v.day = d.day
  WHERE d.day > DATE '2026-06-04' AND d.day < DATE '2026-10-01')
SELECT wc, count(*) AS days, round(avg(regs), 2) AS registrations_per_day, round(stddev_samp(regs), 2) AS sd_regs, round(avg(visitors), 2) AS visitors_per_day,
 round(stddev_samp(visitors), 2) AS sd_visitors
FROM j GROUP BY 1 ORDER BY 1;

-- EVAL Q15 (Welch t for registrations per day; sports share of new visitors' first reads)
WITH d AS (SELECT t::DATE AS day, count(*) FILTER (WHERE event = 'account registered') AS regs FROM ev GROUP BY 1),
j AS (SELECT regs, (day >= DATE '2026-06-11' AND day < DATE '2026-07-20') AS wc FROM d WHERE day > DATE '2026-06-04' AND day < DATE '2026-10-01'),
s AS (SELECT wc, avg(regs) AS m, var_samp(regs) AS v, count(*) AS n FROM j GROUP BY 1)
SELECT round((max(m) FILTER (WHERE wc) - max(m) FILTER (WHERE NOT wc)) / sqrt(max(v / n) FILTER (WHERE wc) + max(v / n) FILTER (WHERE NOT wc)), 3) AS welch_t_registrations,
 (SELECT round(avg((e.section = 'sports')::INT), 4) FROM visitors v JOIN ev e ON e.uid = v.uid AND e.event = 'article viewed' AND e.reader_tier = 'anonymous' WHERE v.t0 >= TIMESTAMP '2026-06-11' AND v.t0 < TIMESTAMP '2026-07-20') AS sports_share_first_reads_wc,
 (SELECT round(avg((e.section = 'sports')::INT), 4) FROM visitors v JOIN ev e ON e.uid = v.uid AND e.event = 'article viewed' AND e.reader_tier = 'anonymous' WHERE NOT (v.t0 >= TIMESTAMP '2026-06-11' AND v.t0 < TIMESTAMP '2026-07-20')) AS sports_share_first_reads_other
FROM s;

-- EVAL Q15 (Welch t for new visitors per day; 7-day registration rate of visitors who arrived during vs outside the tournament)
WITH v AS (SELECT t0::DATE AS day, count(*) AS visitors FROM visitors GROUP BY 1),
j AS (SELECT visitors, (day >= DATE '2026-06-11' AND day < DATE '2026-07-20') AS wc FROM v WHERE day > DATE '2026-06-04' AND day < DATE '2026-10-01'),
s AS (SELECT wc, avg(visitors) AS m, var_samp(visitors) AS v, count(*) AS n FROM j GROUP BY 1),
r AS (SELECT (t0 >= TIMESTAMP '2026-06-11' AND t0 < TIMESTAMP '2026-07-20') AS wc, count(*) AS n, count(*) FILTER (WHERE registered_7d) AS k,
  avg((channel_group = 'social')::INT) AS social_share FROM visitors WHERE t0 < TIMESTAMP '2026-09-25' GROUP BY 1),
rp AS (SELECT max(k) FILTER (WHERE wc) AS k1, max(n) FILTER (WHERE wc) AS n1, max(k) FILTER (WHERE NOT wc) AS k0, max(n) FILTER (WHERE NOT wc) AS n0,
  max(social_share) FILTER (WHERE wc) AS soc1, max(social_share) FILTER (WHERE NOT wc) AS soc0 FROM r)
SELECT (SELECT round((max(m) FILTER (WHERE wc) - max(m) FILTER (WHERE NOT wc)) / sqrt(max(v / n) FILTER (WHERE wc) + max(v / n) FILTER (WHERE NOT wc)), 3) FROM s) AS welch_t_visitors,
 round(k1::DOUBLE / n1, 4) AS registration_rate_wc_arrivals, round(k0::DOUBLE / n0, 4) AS registration_rate_other_arrivals,
 round((k1::DOUBLE / n1 - k0::DOUBLE / n0) / sqrt(((k1 + k0)::DOUBLE / (n1 + n0)) * (1 - (k1 + k0)::DOUBLE / (n1 + n0)) * (1.0 / n1 + 1.0 / n0)), 2) AS z_registration_rate,
 round(soc1, 4) AS social_share_wc_arrivals, round(soc0, 4) AS social_share_other_arrivals
FROM rp;

-- EVAL Q16 — warehouse pageviews served vs Mixpanel article views, by platform
WITH mp AS (SELECT t::DATE AS d, platform, count(*) AS mixpanel_views FROM ev WHERE event = 'article viewed' GROUP BY 1, 2)
SELECT w.platform, sum(w.pageviews_served) AS pageviews_served, sum(mp.mixpanel_views) AS mixpanel_article_views,
 round(sum(w.pageviews_served)::DOUBLE / sum(mp.mixpanel_views) - 1, 4) AS warehouse_excess,
 round(min(w.pageviews_served::DOUBLE / mp.mixpanel_views - 1), 3) AS min_daily_excess, round(max(w.pageviews_served::DOUBLE / mp.mixpanel_views - 1), 3) AS max_daily_excess,
 round(corr(w.pageviews_served, mp.mixpanel_views), 3) AS daily_corr
FROM wh_platform w JOIN mp ON mp.d = w.date::DATE AND mp.platform = w.platform GROUP BY 1 ORDER BY 1;

-- EVAL Q17 — subscribers at the start, subscriptions and cancellations by month; monthly cancel rate; members by current tier
WITH f AS (SELECT uid, arg_min(reader_tier, t) AS first_tier, arg_min(event, t) AS first_event FROM ev WHERE user_id IS NOT NULL GROUP BY 1)
SELECT count(*) FILTER (WHERE first_tier IN ('digital', 'all_access') AND first_event <> 'subscription started') AS subscribers_at_start FROM f;

SELECT strftime(t, '%Y-%m') AS month, count(*) FILTER (WHERE event = 'subscription started') AS new_subscriptions,
 count(*) FILTER (WHERE event = 'subscription cancelled') AS cancellations
FROM ev WHERE event IN ('subscription started', 'subscription cancelled') GROUP BY 1 ORDER BY 1;

SELECT round(avg(cancelled::INT), 4) AS monthly_cancel_rate_jul_sep, count(*) AS subscriber_months FROM sub_months;

-- EVAL Q17 (subscriptions and paywall views per day: World Cup vs the five weeks after, before the incident and the sale)
SELECT CASE WHEN t < TIMESTAMP '2026-07-20' THEN 'World Cup (Jun 11 - Jul 19)' ELSE 'after (Jul 20 - Aug 24)' END AS period, count(DISTINCT t::DATE) AS days,
 round(count(*) FILTER (WHERE event = 'subscription started')::DOUBLE / count(DISTINCT t::DATE), 2) AS subscriptions_per_day,
 round(count(*) FILTER (WHERE event = 'paywall shown')::DOUBLE / count(DISTINCT t::DATE), 0) AS paywall_views_per_day
FROM ev WHERE t >= TIMESTAMP '2026-06-11' AND t < TIMESTAMP '2026-08-25' GROUP BY 1 ORDER BY 1 DESC;

SELECT reader_tier, count(*) AS members FROM users GROUP BY 1 ORDER BY 1;

-- EVAL Q18 — readers in the window: unique readers, never-registered visitors, identified members, registrations
SELECT count(DISTINCT uid) AS unique_readers,
 count(DISTINCT uid) FILTER (WHERE uid NOT IN (SELECT DISTINCT user_id::VARCHAR FROM raw_events WHERE user_id IS NOT NULL)) AS never_registered_visitors,
 count(DISTINCT user_id) AS identified_members,
 count(DISTINCT uid) FILTER (WHERE event = 'account registered') AS registered_in_window,
 count(DISTINCT device_id) AS distinct_devices
FROM ev;

-- EVAL Q19 — paywall conversion per view by platform (null check), overall and within the obvious sub-splits
WITH g AS (SELECT platform, 'all' AS split, count(*) FILTER (WHERE event = 'paywall shown') AS n, count(*) FILTER (WHERE event = 'subscription started') AS k
  FROM ev WHERE event IN ('paywall shown', 'subscription started') GROUP BY 1
  UNION ALL SELECT platform, CASE WHEN referrer = 'newsletter' THEN 'newsletter reads' ELSE 'other reads' END,
  count(*) FILTER (WHERE event = 'paywall shown'), count(*) FILTER (WHERE event = 'subscription started')
  FROM ev WHERE event IN ('paywall shown', 'subscription started') GROUP BY 1, 2
  UNION ALL SELECT platform, CASE WHEN t >= TIMESTAMP '2026-09-03' AND t < TIMESTAMP '2026-09-10' THEN 'sale week' ELSE 'outside the sale' END,
  count(*) FILTER (WHERE event = 'paywall shown'), count(*) FILTER (WHERE event = 'subscription started')
  FROM ev WHERE event IN ('paywall shown', 'subscription started') GROUP BY 1, 2),
p AS (SELECT split, sum(k)::DOUBLE / sum(n) AS p0 FROM g GROUP BY 1)
SELECT g.split, string_agg(g.platform || ' ' || round(100.0 * g.k / g.n, 3) || '% (' || g.k || '/' || g.n || ')', '; ' ORDER BY g.platform) AS conversion_by_platform,
 round(sum(power(g.k - g.n * p.p0, 2) / (g.n * p.p0) + power((g.n - g.k) - g.n * (1 - p.p0), 2) / (g.n * (1 - p.p0))), 2) AS chi_square, count(*) - 1 AS dof
FROM g JOIN p USING (split) GROUP BY 1 ORDER BY 1;

-- EVAL Q19 (app vs web reading volume per active reader-day, for context)
SELECT CASE WHEN platform = 'web' THEN 'web' ELSE 'apps' END AS surface, count(*) FILTER (WHERE event = 'paywall shown') AS paywall_views,
 round(count(*) FILTER (WHERE event IN ('article viewed', 'paywall shown'))::DOUBLE / count(DISTINCT uid || '|' || t::DATE), 3) AS attempted_reads_per_reader_day
FROM ev WHERE event IN ('article viewed', 'paywall shown') GROUP BY 1 ORDER BY 1;

-- EVAL Q20 — open-ended: the quarter's watch list in one place
SELECT 'registered free readers (end of window)' AS metric, count(*)::DOUBLE AS value FROM users WHERE reader_tier = 'registered'
UNION ALL SELECT 'subscribers (end of window)', count(*) FROM users WHERE reader_tier IN ('digital', 'all_access')
UNION ALL SELECT 'new subscriptions in window', count(*) FROM ev WHERE event = 'subscription started'
UNION ALL SELECT 'cancellations in window', count(*) FROM ev WHERE event = 'subscription cancelled'
UNION ALL SELECT 'share of subscriber-months under 4 reading days (Jul-Sep)', round(avg((reading_days < 4)::INT), 4) FROM sub_months
UNION ALL SELECT 'cancel rate, under 4 reading days', round(avg(cancelled::INT) FILTER (WHERE reading_days < 4), 4) FROM sub_months
UNION ALL SELECT 'cancel rate, 4+ reading days', round(avg(cancelled::INT) FILTER (WHERE reading_days >= 4), 4) FROM sub_months
UNION ALL SELECT 'weekly paywall views, Jun 8 - Jul 5', round(count(*) / 4.0, 0) FROM ev WHERE event = 'paywall shown' AND t >= TIMESTAMP '2026-06-08' AND t < TIMESTAMP '2026-07-06'
UNION ALL SELECT 'weekly paywall views, Aug 31 - Sep 27', round(count(*) / 4.0, 0) FROM ev WHERE event = 'paywall shown' AND t >= TIMESTAMP '2026-08-31' AND t < TIMESTAMP '2026-09-28'
UNION ALL SELECT 'Meta spend per registration / Google', (SELECT round((max(s) FILTER (WHERE ch = 'meta_ads') / max(r) FILTER (WHERE ch = 'meta_ads')) / (max(s) FILTER (WHERE ch = 'google_ads') / max(r) FILTER (WHERE ch = 'google_ads')), 3)
  FROM (SELECT c.ch, c.r, sp.s FROM (SELECT ch, count(*) FILTER (WHERE registered_7d) AS r FROM visitors GROUP BY 1) c JOIN (SELECT acquisition_channel AS ch, sum(spend_usd) AS s FROM wh_spend GROUP BY 1) sp ON sp.ch = c.ch));
