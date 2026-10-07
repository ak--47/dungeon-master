-- Murmur (social vertical) — story-keyed and eval-keyed DuckDB queries.
--
-- Generate first (repo root):
--   node scripts/verify-runner.mjs dungeons/vertical/social/social.js verify-social
-- Run:
--   duckdb -c ".read dungeons/vertical/social/social.sql"
-- Against a gzipped export:
--   duckdb -c "SET VARIABLE data_prefix='<dir>/social'" -c ".read social.sql"
--
-- All times are UTC. Window: 2026-06-04 00:00 to 2026-10-01 23:59:59.

SET VARIABLE data_prefix = COALESCE(getvariable('data_prefix'), 'data/verify-social');

-- ─────────────────────────────────────────────────────────────────────────
-- PRELUDE: raw files, identity resolution, warehouse tables
-- ─────────────────────────────────────────────────────────────────────────
-- Identity: a new member signs up with "account created" (the auth event,
-- which carries user_id and device_id). A device resolves to the member seen
-- with it on any event that carries both ids, the way Mixpanel stitches.
-- Every Murmur event carries user_id, so uid = user_id in practice.

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
CREATE OR REPLACE TEMP TABLE wh_feed AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-for_you_feed_health_daily.json*', sample_size=-1, union_by_name=true);
CREATE OR REPLACE TEMP TABLE wh_ads AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-ad_revenue_daily.json*', sample_size=-1, union_by_name=true);

-- profile attributes keyed by the resolved member id
CREATE OR REPLACE TEMP TABLE prof AS
SELECT distinct_id::VARCHAR AS uid, account_type, circle_enabled, acquisition_channel, joined_date, age_band, country,
 follower_count, "Experiment: Smart Digest" AS variant
FROM users;

-- member-initiated activity (pushes and experiment assignment are server-side)
CREATE OR REPLACE TEMP TABLE active_ev AS
SELECT * FROM ev WHERE event NOT IN ('push notification sent', '$experiment_started');

-- new members: signup, onboarding follows (suggested-accounts screen), day 14-27 retention
CREATE OR REPLACE TEMP TABLE signups AS
WITH s AS (SELECT uid, t AS t0, acquisition_channel AS ch, platform FROM ev WHERE event = 'account created'),
k AS (SELECT uid, count(*) AS k FROM ev WHERE event = 'user followed' AND discovery_source = 'onboarding_suggestions' GROUP BY 1),
o AS (SELECT DISTINCT uid FROM ev WHERE event = 'interests selected'),
r AS (SELECT s.uid, bool_or(a.t >= s.t0 + INTERVAL 14 DAY AND a.t < s.t0 + INTERVAL 28 DAY) AS ret
  FROM s JOIN active_ev a ON a.uid = s.uid GROUP BY 1)
SELECT s.uid, s.t0, s.ch, s.platform, coalesce(k.k, 0) AS onboarding_follows, (o.uid IS NOT NULL) AS picked_interests,
 (k.uid IS NOT NULL) AS followed_any_suggestion,
 CASE WHEN s.t0 <= TIMESTAMP '2026-09-03 23:59:59' THEN coalesce(r.ret, false) END AS retained_d14_27
FROM s LEFT JOIN k ON k.uid = s.uid LEFT JOIN o ON o.uid = s.uid LEFT JOIN r ON r.uid = s.uid;

-- dataset overview
SELECT count(*) AS events, count(DISTINCT uid) AS members_with_events, (SELECT count(*) FROM users) AS profiles,
 (SELECT count(*) FROM signups) AS new_signups, min(t) AS first_event, max(t) AS last_event FROM ev;

-- identity check: every event resolves to a member; platform agrees with the device OS
SELECT count(*) FILTER (WHERE uid IS NULL) AS unresolved_events,
 count(*) FILTER (WHERE (platform = 'ios' AND os NOT IN ('iOS', 'iPadOS')) OR (platform = 'android' AND os <> 'Android')) AS platform_os_mismatch,
 count(*) FILTER (WHERE device_id IS NULL) AS events_without_device
FROM ev;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H1-clips-launch — Clips ramps to 35% of views, 20% of posts (launch 2026-07-08, 21-day ramp)
-- ─────────────────────────────────────────────────────────────────────────
SELECT CASE WHEN t < TIMESTAMP '2026-07-08' THEN '1 before launch' WHEN t < TIMESTAMP '2026-07-29' THEN '2 ramp' ELSE '3 from Jul 29' END AS period,
 count(*) FILTER (WHERE event = 'post viewed') AS post_views,
 round(avg((post_type = 'clip')::INT) FILTER (WHERE event = 'post viewed'), 4) AS clip_share_of_views,
 round(avg((post_type = 'clip')::INT) FILTER (WHERE event = 'post created'), 4) AS clip_share_of_posts
FROM ev WHERE event IN ('post viewed', 'post created') GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H2-onboarding-follows — day 14-27 retention by accounts followed at onboarding
-- ─────────────────────────────────────────────────────────────────────────
SELECT CASE WHEN onboarding_follows <= 2 THEN '0-2' WHEN onboarding_follows <= 6 THEN '3-6' ELSE '7+' END AS follows_bucket,
 count(*) AS new_members, round(avg(retained_d14_27::INT), 4) AS retention_d14_27
FROM signups WHERE retained_d14_27 IS NOT NULL GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H3-smart-digest-experiment — Digest: 0.6x sends, 1.6x open rate (from 2026-08-05)
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE TEMP TABLE push_after AS
WITH s AS (SELECT uid, notification_id, notification_type FROM ev WHERE event = 'push notification sent' AND t >= TIMESTAMP '2026-08-05'),
o AS (SELECT DISTINCT notification_id FROM ev WHERE event = 'push notification opened')
SELECT p.variant, p.uid, s.notification_id, s.notification_type, (o.notification_id IS NOT NULL) AS opened
FROM prof p LEFT JOIN s ON s.uid = p.uid LEFT JOIN o ON o.notification_id = s.notification_id WHERE p.variant IS NOT NULL;

SELECT variant, count(DISTINCT uid) AS exposed_members, count(notification_id) AS pushes_sent,
 round(count(notification_id)::DOUBLE / count(DISTINCT uid), 3) AS sends_per_member,
 round(avg(opened::INT) FILTER (WHERE notification_id IS NOT NULL), 4) AS open_rate,
 round(count(*) FILTER (WHERE opened)::DOUBLE / count(DISTINCT uid), 3) AS opens_per_member,
 round(avg((notification_type = 'daily_digest')::INT) FILTER (WHERE notification_id IS NOT NULL), 4) AS digest_share
FROM push_after GROUP BY 1 ORDER BY 1;

SELECT "Variant name" AS variant, count(DISTINCT uid) AS exposed_members, count(*) AS exposures FROM ev WHERE event = '$experiment_started' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H4-android-for-you-incident — 60% of Android For You loads fail 2026-08-26..29 (warehouse join)
-- ─────────────────────────────────────────────────────────────────────────
WITH o AS (SELECT DISTINCT date::DATE AS d FROM wh_feed WHERE service_status = 'major_outage'),
w AS (SELECT t::DATE AS d, platform, feed FROM ev WHERE event = 'post viewed' AND feed IN ('for_you', 'following') AND t >= TIMESTAMP '2026-08-12' AND t < TIMESTAMP '2026-09-13'),
g AS (SELECT platform, (d IN (SELECT d FROM o)) AS outage_days, count(*) FILTER (WHERE feed = 'for_you') AS for_you, count(*) FILTER (WHERE feed = 'following') AS following FROM w GROUP BY 1, 2)
SELECT platform, outage_days, for_you, following, round(for_you::DOUBLE / following, 4) AS for_you_per_following FROM g ORDER BY 1, 2;

SELECT platform, count(*) FILTER (WHERE service_status = 'major_outage') AS outage_days, min(date) FILTER (WHERE service_status = 'major_outage') AS first_day,
 max(date) FILTER (WHERE service_status = 'major_outage') AS last_day,
 round(avg(error_rate) FILTER (WHERE service_status = 'major_outage'), 4) AS outage_error_rate,
 round(avg(error_rate) FILTER (WHERE service_status <> 'major_outage'), 4) AS normal_error_rate
FROM wh_feed GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H5-paid-channel-economics — spend per signup, retention, spend per retained member (warehouse join)
-- ─────────────────────────────────────────────────────────────────────────
WITH g AS (SELECT ch, count(*) AS signups, count(retained_d14_27) AS mature, avg(retained_d14_27::INT) AS retention FROM signups GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM wh_spend GROUP BY 1)
SELECT g.ch, g.signups, round(sp.spend, 0) AS spend_usd, round(sp.spend / g.signups, 2) AS spend_per_signup,
 g.mature AS mature_signups, round(g.retention, 4) AS retention_d14_27, round(sp.spend / g.signups / g.retention, 2) AS spend_per_retained_member
FROM g LEFT JOIN sp ON sp.ch = g.ch ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H6-creator-fair-share — Circle creators post 1.35x after the 2026-08-12 fee cut (10-day ramp)
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE TEMP TABLE fee_cut AS
WITH c AS (SELECT uid, circle_enabled FROM prof WHERE account_type = 'creator' AND joined_date < '2026-06-04'),
p AS (SELECT uid, CASE WHEN t < TIMESTAMP '2026-08-12' THEN 'before' WHEN t >= TIMESTAMP '2026-08-22' THEN 'after' END AS per FROM ev WHERE event = 'post created')
SELECT CASE WHEN c.circle_enabled THEN 'circle' ELSE 'no_circle' END AS creator_group, count(DISTINCT c.uid) AS creators,
 count(*) FILTER (WHERE per = 'before') / 69.0 AS posts_per_day_before, count(*) FILTER (WHERE per = 'after') / 41.0 AS posts_per_day_after
FROM c LEFT JOIN p ON p.uid = c.uid GROUP BY 1;

SELECT creator_group, creators, round(posts_per_day_before, 2) AS posts_per_day_before, round(posts_per_day_after, 2) AS posts_per_day_after,
 round(posts_per_day_after / posts_per_day_before, 4) AS after_over_before,
 round((posts_per_day_after / posts_per_day_before) / (SELECT posts_per_day_after / posts_per_day_before FROM fee_cut WHERE creator_group = 'no_circle'), 4) AS diff_in_diff
FROM fee_cut ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H7-sound-awards-livestream — posts/comments/shares/stories 2.5x on 2026-09-12
-- ─────────────────────────────────────────────────────────────────────────
WITH d AS (SELECT t::DATE AS d,
  count(*) FILTER (WHERE event IN ('post created', 'comment posted', 'post shared', 'story posted')) AS award_events,
  count(*) FILTER (WHERE event = 'post viewed') AS post_views, count(DISTINCT uid) AS dau
  FROM active_ev WHERE t::DATE IN (DATE '2026-08-22', DATE '2026-09-05', DATE '2026-09-12', DATE '2026-09-19', DATE '2026-09-26') GROUP BY 1)
SELECT d, award_events, post_views, dau, round(award_events / dau, 3) AS award_events_per_dau, round(post_views / dau, 3) AS post_views_per_dau,
 round((award_events / dau) / (SELECT avg(award_events / dau) FROM d WHERE d <> DATE '2026-09-12'), 3) AS lift_vs_saturdays
FROM d ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H8-ad-load-increase — feed/Clips ads per view 1.6x, eCPM 0.85x from 2026-09-09 (warehouse join)
-- ─────────────────────────────────────────────────────────────────────────
WITH w AS (SELECT CASE WHEN t >= TIMESTAMP '2026-09-09' THEN '2 after' WHEN t >= TIMESTAMP '2026-08-12' THEN '1 before' END AS period, event, ad_placement FROM ev WHERE event IN ('ad viewed', 'post viewed')),
r AS (SELECT CASE WHEN date::DATE >= DATE '2026-09-09' THEN '2 after' WHEN date::DATE >= DATE '2026-08-12' THEN '1 before' END AS period,
  sum(ad_revenue_usd) AS revenue, sum(impressions_served) AS impressions FROM wh_ads WHERE ad_placement IN ('feed', 'clips') GROUP BY 1)
SELECT w.period, count(*) FILTER (WHERE event = 'post viewed') AS post_views,
 count(*) FILTER (WHERE event = 'ad viewed' AND ad_placement IN ('feed', 'clips')) AS feed_clips_ads,
 round(feed_clips_ads::DOUBLE / post_views, 4) AS ads_per_post_view,
 round(max(r.revenue), 2) AS feed_clips_revenue_usd, round(1000 * max(r.revenue) / max(r.impressions), 3) AS ecpm_usd,
 round(1000.0 * max(r.revenue) / post_views, 4) AS revenue_per_1k_post_views
FROM w JOIN r ON r.period = w.period WHERE w.period IS NOT NULL GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H9-creator-first-post — median hours signup → first post: creator 0.35x personal
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE TEMP TABLE first_post AS
SELECT s.uid, s.t0, p.account_type,
 min(e.t) FILTER (WHERE e.t > s.t0 AND e.t < s.t0 + INTERVAL 7 DAY) AS t1
FROM signups s JOIN prof p ON p.uid = s.uid LEFT JOIN ev e ON e.uid = s.uid AND e.event = 'post created'
WHERE s.t0 <= TIMESTAMP '2026-09-24 23:59:59' GROUP BY 1, 2, 3;

SELECT account_type, count(*) AS signups, count(t1) AS posted_within_7d, round(count(t1)::DOUBLE / count(*), 4) AS conversion_7d,
 round(median(date_diff('second', t0, t1) / 3600.0), 2) AS median_hours_to_first_post
FROM first_post GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H10-circle-paywall-trigger — locked post 6% vs profile button 2%
-- ─────────────────────────────────────────────────────────────────────────
SELECT paywall_trigger, count(*) FILTER (WHERE event = 'circle paywall viewed') AS paywall_views,
 count(*) FILTER (WHERE event = 'circle subscription started') AS subscriptions,
 round(subscriptions::DOUBLE / paywall_views, 4) AS conversion
FROM ev WHERE event IN ('circle paywall viewed', 'circle subscription started') GROUP BY 1 ORDER BY 1;

-- ═════════════════════════════════════════════════════════════════════════
-- EVAL QUERIES (eval/social.eval.md)
-- ═════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q1 — Clips share of post views, weekly
-- ─────────────────────────────────────────────────────────────────────────
SELECT date_trunc('week', t)::DATE AS week, count(*) AS post_views,
 round(avg((post_type = 'clip')::INT), 4) AS clip_share, round(avg((post_type = 'photo')::INT), 4) AS photo_share,
 round(avg((post_type = 'text')::INT), 4) AS text_share
FROM ev WHERE event = 'post viewed' GROUP BY 1 ORDER BY 1;

-- post type mix of views before launch vs from Jul 29
SELECT CASE WHEN t < TIMESTAMP '2026-07-08' THEN '1 before launch' WHEN t >= TIMESTAMP '2026-07-29' THEN '2 from Jul 29' END AS period,
 round(avg((post_type = 'clip')::INT), 4) AS clip_share, round(avg((post_type = 'photo')::INT), 4) AS photo_share, round(avg((post_type = 'text')::INT), 4) AS text_share
FROM ev WHERE event = 'post viewed' AND (t < TIMESTAMP '2026-07-08' OR t >= TIMESTAMP '2026-07-29') GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q2 — Clips creation from Jul 29, by account type; who makes Clips
-- ─────────────────────────────────────────────────────────────────────────
SELECT p.account_type, count(*) AS posts, round(avg((e.post_type = 'clip')::INT), 4) AS clip_share,
 count(DISTINCT e.uid) FILTER (WHERE e.post_type = 'clip') AS members_posting_clips
FROM ev e JOIN prof p ON p.uid = e.uid WHERE e.event = 'post created' AND e.t >= TIMESTAMP '2026-07-29' GROUP BY 1 ORDER BY 1;

SELECT count(*) FILTER (WHERE post_type = 'clip') AS clip_posts_from_jul29, round(avg((post_type = 'clip')::INT), 4) AS clip_share_of_posts
FROM ev WHERE event = 'post created' AND t >= TIMESTAMP '2026-07-29';

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q3 — retention by accounts followed at onboarding (each count)
-- ─────────────────────────────────────────────────────────────────────────
SELECT least(onboarding_follows, 10) AS follows_capped_at_10, count(*) AS new_members, round(avg(retained_d14_27::INT), 4) AS retention_d14_27
FROM signups WHERE retained_d14_27 IS NOT NULL GROUP BY 1 ORDER BY 1;

SELECT count(*) AS mature_new_members, round(avg(retained_d14_27::INT), 4) AS retention_d14_27,
 round(avg(onboarding_follows), 2) AS avg_onboarding_follows, round(avg((onboarding_follows >= 7)::INT), 4) AS share_7_plus,
 round(avg((NOT followed_any_suggestion)::INT), 4) AS share_followed_none
FROM signups WHERE retained_d14_27 IS NOT NULL;

-- common mistake: excluding only push notification sent (keeps $experiment_started as a return)
WITH r AS (SELECT s.uid, bool_or(e.t >= s.t0 + INTERVAL 14 DAY AND e.t < s.t0 + INTERVAL 28 DAY) AS ret
  FROM signups s JOIN ev e ON e.uid = s.uid AND e.event <> 'push notification sent' WHERE s.retained_d14_27 IS NOT NULL GROUP BY 1)
SELECT CASE WHEN s.onboarding_follows <= 2 THEN '0-2' WHEN s.onboarding_follows <= 6 THEN '3-6' ELSE '7+' END AS follows_bucket,
 round(avg(coalesce(r.ret, false)::INT), 4) AS retention_keeping_experiment_started
FROM signups s LEFT JOIN r ON r.uid = s.uid WHERE s.retained_d14_27 IS NOT NULL GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q4 — Smart Digest: open rate significance (see STORY H3 for sends and opens per member)
-- ─────────────────────────────────────────────────────────────────────────
WITH g AS (SELECT variant, count(*) AS n, avg(opened::INT) AS r FROM push_after WHERE notification_id IS NOT NULL GROUP BY 1)
SELECT max(r) FILTER (WHERE variant = 'Digest') AS digest_open_rate, max(r) FILTER (WHERE variant = 'Control') AS control_open_rate,
 round(max(r) FILTER (WHERE variant = 'Digest') / max(r) FILTER (WHERE variant = 'Control'), 3) AS ratio,
 round((max(r) FILTER (WHERE variant = 'Digest') - max(r) FILTER (WHERE variant = 'Control'))
  / sqrt(max(r * (1 - r) / n) FILTER (WHERE variant = 'Digest') + max(r * (1 - r) / n) FILTER (WHERE variant = 'Control')), 1) AS z
FROM g;

-- denominators: exposed members vs Uniques of push notification sent from Aug 5
SELECT variant, count(DISTINCT uid) AS exposed_members, count(DISTINCT uid) FILTER (WHERE notification_id IS NOT NULL) AS members_with_a_push,
 count(DISTINCT uid) FILTER (WHERE notification_id IS NULL) AS exposed_without_a_push,
 round(count(notification_id)::DOUBLE / count(DISTINCT uid) FILTER (WHERE notification_id IS NOT NULL), 3) AS sends_per_member_with_a_push
FROM push_after GROUP BY 1 ORDER BY 1;

-- weekly pushes sent, by arm (the drop starts Aug 5)
SELECT date_trunc('week', e.t)::DATE AS week, p.variant, count(*) AS pushes_sent
FROM ev e JOIN prof p ON p.uid = e.uid WHERE e.event = 'push notification sent' AND p.variant IS NOT NULL AND e.t >= TIMESTAMP '2026-07-13'
GROUP BY 1, 2 ORDER BY 1, 2;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q5 — fee cut and fan conversion: Circle subscriptions per paywall view before vs after 2026-08-12, overall and by trigger
-- ─────────────────────────────────────────────────────────────────────────
WITH g AS (SELECT 'all' AS grp, CASE WHEN t >= TIMESTAMP '2026-08-12' THEN 'after' ELSE 'before' END AS per,
  count(*) FILTER (WHERE event = 'circle paywall viewed') AS n, count(*) FILTER (WHERE event = 'circle subscription started') AS subs
  FROM ev WHERE event IN ('circle paywall viewed', 'circle subscription started') GROUP BY 1, 2
  UNION ALL
  SELECT paywall_trigger, CASE WHEN t >= TIMESTAMP '2026-08-12' THEN 'after' ELSE 'before' END,
  count(*) FILTER (WHERE event = 'circle paywall viewed'), count(*) FILTER (WHERE event = 'circle subscription started')
  FROM ev WHERE event IN ('circle paywall viewed', 'circle subscription started') GROUP BY 1, 2
  UNION ALL
  SELECT platform, CASE WHEN t >= TIMESTAMP '2026-08-12' THEN 'after' ELSE 'before' END,
  count(*) FILTER (WHERE event = 'circle paywall viewed'), count(*) FILTER (WHERE event = 'circle subscription started')
  FROM ev WHERE event IN ('circle paywall viewed', 'circle subscription started') GROUP BY 1, 2)
SELECT grp, max(n) FILTER (WHERE per = 'before') AS views_before, max(n) FILTER (WHERE per = 'after') AS views_after,
 round(max(subs::DOUBLE / n) FILTER (WHERE per = 'before'), 4) AS before_conv, round(max(subs::DOUBLE / n) FILTER (WHERE per = 'after'), 4) AS after_conv,
 round((max(subs::DOUBLE / n) FILTER (WHERE per = 'after') - max(subs::DOUBLE / n) FILTER (WHERE per = 'before'))
  / sqrt(max((subs::DOUBLE / n) * (1 - subs::DOUBLE / n) / n) FILTER (WHERE per = 'after') + max((subs::DOUBLE / n) * (1 - subs::DOUBLE / n) / n) FILTER (WHERE per = 'before')), 2) AS z
FROM g GROUP BY 1 ORDER BY 1;

-- paywall mix (locked-post share of paywall views) before vs after the cut, and monthly conversion by trigger
SELECT CASE WHEN t >= TIMESTAMP '2026-08-12' THEN '2 after' ELSE '1 before' END AS period,
 round(count(*) FILTER (WHERE paywall_trigger = 'locked_post')::DOUBLE / count(*), 4) AS locked_post_share_of_views
FROM ev WHERE event = 'circle paywall viewed' GROUP BY 1 ORDER BY 1;
SELECT strftime(t, '%Y-%m') AS month, paywall_trigger, count(*) FILTER (WHERE event = 'circle paywall viewed') AS views,
 round(count(*) FILTER (WHERE event = 'circle subscription started')::DOUBLE / count(*) FILTER (WHERE event = 'circle paywall viewed'), 4) AS conversion
FROM ev WHERE event IN ('circle paywall viewed', 'circle subscription started') AND t < TIMESTAMP '2026-10-01' GROUP BY 1, 2 ORDER BY 2, 1;

-- Smart Digest arms: member-initiated activity per exposed member before and after the start (context for Q4)
WITH a AS (SELECT p.variant, p.uid,
  count(DISTINCT x.t::DATE) FILTER (WHERE x.t < TIMESTAMP '2026-08-05') AS active_days_before,
  count(DISTINCT x.t::DATE) FILTER (WHERE x.t >= TIMESTAMP '2026-08-05') AS active_days_after,
  count(*) FILTER (WHERE x.t >= TIMESTAMP '2026-08-05' AND x.event = 'post viewed') AS post_views_after
  FROM prof p LEFT JOIN active_ev x ON x.uid = p.uid WHERE p.variant IS NOT NULL GROUP BY 1, 2)
SELECT variant, count(*) AS members, round(avg(active_days_before), 3) AS active_days_before, round(avg(active_days_after), 3) AS active_days_after,
 round(avg(active_days_after - active_days_before), 3) AS change_in_active_days, round(avg(post_views_after), 2) AS post_views_after
FROM a GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q6 — Android For You incident: daily views by platform and feed; missing views (see STORY H4)
-- ─────────────────────────────────────────────────────────────────────────
SELECT t::DATE AS day,
 count(*) FILTER (WHERE platform = 'android' AND feed = 'for_you') AS android_for_you,
 count(*) FILTER (WHERE platform = 'android' AND feed = 'following') AS android_following,
 count(*) FILTER (WHERE platform = 'ios' AND feed = 'for_you') AS ios_for_you
FROM ev WHERE event = 'post viewed' AND t >= TIMESTAMP '2026-08-22' AND t < TIMESTAMP '2026-09-03' GROUP BY 1 ORDER BY 1;

-- expected Android For You views on outage days at the baseline For You / Following ratio, vs observed
WITH w AS (SELECT t::DATE AS d, feed FROM ev WHERE event = 'post viewed' AND platform = 'android' AND feed IN ('for_you', 'following') AND t >= TIMESTAMP '2026-08-12' AND t < TIMESTAMP '2026-09-13'),
o AS (SELECT DISTINCT date::DATE AS d FROM wh_feed WHERE service_status = 'major_outage'),
b AS (SELECT count(*) FILTER (WHERE feed = 'for_you')::DOUBLE / count(*) FILTER (WHERE feed = 'following') AS base_ratio FROM w WHERE d NOT IN (SELECT d FROM o)),
x AS (SELECT count(*) FILTER (WHERE feed = 'for_you') AS observed, count(*) FILTER (WHERE feed = 'following') AS following FROM w WHERE d IN (SELECT d FROM o))
SELECT x.observed AS android_for_you_outage, round(x.following * b.base_ratio) AS expected_at_baseline,
 round(x.following * b.base_ratio) - x.observed AS missing_views, round(x.observed / (x.following * b.base_ratio), 3) AS observed_over_expected,
 (SELECT sum(failed_requests) FROM wh_feed WHERE service_status = 'major_outage') AS warehouse_failed_requests
FROM x, b;

-- warehouse: android outage-day latency and Android For You daily views outside the outage (Aug 12 - Sep 12)
SELECT min(p95_latency_ms) AS outage_p95_min, max(p95_latency_ms) AS outage_p95_max FROM wh_feed WHERE service_status = 'major_outage';
WITH d AS (SELECT t::DATE AS d, count(*) AS v FROM ev WHERE event = 'post viewed' AND platform = 'android' AND feed = 'for_you' AND t >= TIMESTAMP '2026-08-12' AND t < TIMESTAMP '2026-09-13' GROUP BY 1)
SELECT (d BETWEEN DATE '2026-08-26' AND DATE '2026-08-29') AS outage_day, min(v) AS min_daily_views, max(v) AS max_daily_views FROM d GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q7 — paid channel economics (see STORY H5); network-claimed installs
-- ─────────────────────────────────────────────────────────────────────────
SELECT acquisition_channel, round(sum(spend_usd), 0) AS spend_usd, sum(installs_reported) AS installs_reported, sum(clicks) AS clicks, sum(impressions) AS impressions
FROM wh_spend GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q8 — onboarding funnel by channel: interests, suggested accounts, follows
-- ─────────────────────────────────────────────────────────────────────────
SELECT ch, count(*) AS signups, round(avg(picked_interests::INT), 4) AS picked_interests, round(avg(followed_any_suggestion::INT), 4) AS followed_any_suggestion,
 round(avg(onboarding_follows), 2) AS avg_onboarding_follows, round(avg((onboarding_follows >= 7)::INT), 4) AS share_7_plus,
 round(avg(retained_d14_27::INT), 4) AS retention_d14_27
FROM signups GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q9 — fee cut: weekly posts per creator, Circle vs no Circle (see STORY H6 for the diff-in-diff)
-- ─────────────────────────────────────────────────────────────────────────
WITH c AS (SELECT uid, circle_enabled FROM prof WHERE account_type = 'creator' AND joined_date < '2026-06-04')
SELECT date_trunc('week', e.t)::DATE AS week,
 round(count(*) FILTER (WHERE c.circle_enabled)::DOUBLE / (SELECT count(*) FROM c WHERE circle_enabled), 3) AS posts_per_circle_creator,
 round(count(*) FILTER (WHERE NOT c.circle_enabled)::DOUBLE / (SELECT count(*) FROM c WHERE NOT circle_enabled), 3) AS posts_per_other_creator
FROM ev e JOIN c ON c.uid = e.uid WHERE e.event = 'post created' AND e.t >= TIMESTAMP '2026-06-08' AND e.t < TIMESTAMP '2026-09-28' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q10 — Circles: subscriptions, first-month list-price bookings, and Murmur's fee before vs after the cut
-- (tier prices from 01-business.md: supporter $2.99, insider $5.99, vip $11.99 per month)
-- ─────────────────────────────────────────────────────────────────────────
WITH s AS (SELECT CASE WHEN t >= TIMESTAMP '2026-08-12' THEN '2 after' ELSE '1 before' END AS period,
  CASE circle_tier WHEN 'supporter' THEN 2.99 WHEN 'insider' THEN 5.99 WHEN 'vip' THEN 11.99 END AS price
  FROM ev WHERE event = 'circle subscription started'),
pw AS (SELECT CASE WHEN t >= TIMESTAMP '2026-08-12' THEN '2 after' ELSE '1 before' END AS period, count(*) AS paywall_views FROM ev WHERE event = 'circle paywall viewed' GROUP BY 1),
g AS (SELECT period, count(*) AS subscriptions, sum(price) AS bookings, CASE WHEN period = '2 after' THEN 51.0 ELSE 69.0 END AS days,
  CASE WHEN period = '2 after' THEN 0.10 ELSE 0.20 END AS fee FROM s GROUP BY 1)
SELECT g.period, g.subscriptions, round(g.subscriptions / g.days, 2) AS subs_per_day, round(g.bookings, 2) AS first_month_bookings_usd,
 round(g.bookings * g.fee, 2) AS murmur_fee_usd, round(g.bookings * g.fee / g.days, 2) AS murmur_fee_per_day,
 round(g.bookings * (1 - g.fee) / g.days, 2) AS creator_share_per_day,
 pw.paywall_views, round(g.subscriptions::DOUBLE / pw.paywall_views, 4) AS subs_per_paywall_view
FROM g JOIN pw ON pw.period = g.period ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q11 — the September 12 spike (see STORY H7): daily counts around it
-- ─────────────────────────────────────────────────────────────────────────
SELECT t::DATE AS day, dayname(t::DATE) AS weekday,
 count(*) FILTER (WHERE event = 'post created') AS posts, count(*) FILTER (WHERE event = 'comment posted') AS comments_posted,
 count(*) FILTER (WHERE event = 'post shared') AS shares, count(*) FILTER (WHERE event = 'story posted') AS stories_posted,
 count(*) FILTER (WHERE event = 'post viewed') AS post_views, count(DISTINCT uid) AS dau
FROM active_ev WHERE t >= TIMESTAMP '2026-09-09' AND t < TIMESTAMP '2026-09-16' GROUP BY 1, 2 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q12 — ad load increase (see STORY H8); by placement
-- ─────────────────────────────────────────────────────────────────────────
WITH a AS (SELECT CASE WHEN t >= TIMESTAMP '2026-09-09' THEN '2 after' WHEN t >= TIMESTAMP '2026-08-12' THEN '1 before' END AS period, ad_placement, count(*) AS ad_views
  FROM ev WHERE event = 'ad viewed' GROUP BY 1, 2),
v AS (SELECT CASE WHEN t >= TIMESTAMP '2026-09-09' THEN '2 after' WHEN t >= TIMESTAMP '2026-08-12' THEN '1 before' END AS period, count(*) AS post_views FROM ev WHERE event = 'post viewed' GROUP BY 1),
r AS (SELECT CASE WHEN date::DATE >= DATE '2026-09-09' THEN '2 after' WHEN date::DATE >= DATE '2026-08-12' THEN '1 before' END AS period, ad_placement,
  sum(ad_revenue_usd) AS revenue, sum(impressions_served) AS impressions FROM wh_ads GROUP BY 1, 2)
SELECT a.period, a.ad_placement, a.ad_views, round(a.ad_views::DOUBLE / v.post_views, 4) AS ads_per_post_view,
 round(r.revenue, 2) AS revenue_usd, round(1000 * r.revenue / r.impressions, 3) AS ecpm_usd, round(1000 * r.revenue / v.post_views, 4) AS revenue_per_1k_post_views
FROM a JOIN v ON v.period = a.period JOIN r ON r.period = a.period AND r.ad_placement = a.ad_placement WHERE a.period IS NOT NULL ORDER BY 1, 2;

-- post views per active member-day before vs after, all members vs members who joined before June 4
-- (excludes the incident days Aug 26-29 and the awards day Sep 12)
WITH d AS (SELECT a.t::DATE AS d, (a.t::DATE >= DATE '2026-09-09') AS after_change, (p.joined_date < '2026-06-04') AS established, a.uid,
  count(*) FILTER (WHERE a.event = 'post viewed') AS pv
  FROM active_ev a JOIN prof p ON p.uid = a.uid
  WHERE a.t >= TIMESTAMP '2026-08-12' AND a.t::DATE NOT BETWEEN DATE '2026-08-26' AND DATE '2026-08-29' AND a.t::DATE <> DATE '2026-09-12' GROUP BY 1, 2, 3, 4)
SELECT 'all members' AS members, round(avg(pv) FILTER (WHERE NOT after_change), 3) AS views_per_member_day_before, round(avg(pv) FILTER (WHERE after_change), 3) AS views_per_member_day_after,
 round(avg((NOT established)::INT) FILTER (WHERE NOT after_change), 4) AS new_member_share_before, round(avg((NOT established)::INT) FILTER (WHERE after_change), 4) AS new_member_share_after FROM d
UNION ALL
SELECT 'joined before Jun 4', round(avg(pv) FILTER (WHERE NOT after_change AND established), 3), round(avg(pv) FILTER (WHERE after_change AND established), 3), NULL, NULL FROM d
UNION ALL
SELECT 'joined in window', round(avg(pv) FILTER (WHERE NOT after_change AND NOT established), 3), round(avg(pv) FILTER (WHERE after_change AND NOT established), 3), NULL, NULL FROM d;

-- established members' post views per active member-day, weekly (the normal week-to-week range)
SELECT date_trunc('week', a.t)::DATE AS week, round(count(*) FILTER (WHERE a.event = 'post viewed')::DOUBLE / count(DISTINCT a.uid || a.t::DATE::VARCHAR), 3) AS views_per_member_day
FROM active_ev a JOIN prof p ON p.uid = a.uid WHERE p.joined_date < '2026-06-04' AND a.t >= TIMESTAMP '2026-06-08' AND a.t < TIMESTAMP '2026-09-28' GROUP BY 1 ORDER BY 1;

-- Stories ad load per story viewed before vs after (Stories slots did not change)
SELECT CASE WHEN t >= TIMESTAMP '2026-09-09' THEN '2 after' ELSE '1 before' END AS period,
 count(*) FILTER (WHERE event = 'ad viewed' AND ad_placement = 'stories') AS stories_ads, count(*) FILTER (WHERE event = 'story viewed') AS story_views,
 round(count(*) FILTER (WHERE event = 'ad viewed' AND ad_placement = 'stories')::DOUBLE / count(*) FILTER (WHERE event = 'story viewed'), 4) AS stories_ads_per_story_view
FROM ev WHERE event IN ('ad viewed', 'story viewed') AND t >= TIMESTAMP '2026-08-12' GROUP BY 1 ORDER BY 1;

-- ad clicks per impression before vs after (not part of the change)
SELECT CASE WHEN t >= TIMESTAMP '2026-09-09' THEN '2 after' ELSE '1 before' END AS period,
 count(*) FILTER (WHERE event = 'ad clicked') AS ad_clicks,
 round(count(*) FILTER (WHERE event = 'ad clicked')::DOUBLE / count(*) FILTER (WHERE event = 'ad viewed'), 4) AS ctr
FROM ev WHERE event IN ('ad viewed', 'ad clicked') AND t >= TIMESTAMP '2026-08-12' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q13 — interests null: new-member day 14-27 retention, 5+ interests vs 3-4 (members who picked interests); sub-splits
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE TEMP TABLE int_ret AS
SELECT s.uid, s.platform, i.interest_count, CASE WHEN i.interest_count >= 5 THEN '5_plus' ELSE '3_4' END AS interest_group,
 CASE WHEN s.ch IN ('friend_invite', 'creator_partnerships') THEN 'invite_or_creator' ELSE 'other_channels' END AS channel_group,
 CASE WHEN s.t0 < TIMESTAMP '2026-07-01' THEN 'signup_jun' WHEN s.t0 < TIMESTAMP '2026-08-01' THEN 'signup_jul' ELSE 'signup_aug_to_sep3' END AS signup_period,
 s.retained_d14_27
FROM signups s JOIN (SELECT uid, max(interest_count) AS interest_count FROM ev WHERE event = 'interests selected' GROUP BY 1) i ON i.uid = s.uid
WHERE s.retained_d14_27 IS NOT NULL;

SELECT interest_count, count(*) AS new_members, round(avg(retained_d14_27::INT), 4) AS retention_d14_27 FROM int_ret GROUP BY 1 ORDER BY 1;

WITH x AS (SELECT 'all' AS grp, interest_group, retained_d14_27 FROM int_ret
  UNION ALL SELECT platform, interest_group, retained_d14_27 FROM int_ret
  UNION ALL SELECT channel_group, interest_group, retained_d14_27 FROM int_ret
  UNION ALL SELECT signup_period, interest_group, retained_d14_27 FROM int_ret),
g AS (SELECT grp, interest_group, count(*) AS n, avg(retained_d14_27::INT) AS r FROM x GROUP BY 1, 2)
SELECT a.grp, a.n AS members_5_plus, round(a.r, 4) AS retention_5_plus, b.n AS members_3_4, round(b.r, 4) AS retention_3_4,
 round((a.r - b.r) / sqrt(a.r * (1 - a.r) / a.n + b.r * (1 - b.r) / b.n), 2) AS z
FROM g a JOIN g b ON a.grp = b.grp AND a.interest_group = '5_plus' AND b.interest_group = '3_4' ORDER BY 1;

-- interaction check: does the interests gap differ between Android and iOS? (difference of the two gaps, z)
WITH g AS (SELECT platform, interest_group, count(*) AS n, avg(retained_d14_27::INT) AS r FROM int_ret GROUP BY 1, 2),
d AS (SELECT a.platform, a.r - b.r AS gap, a.r * (1 - a.r) / a.n + b.r * (1 - b.r) / b.n AS var
  FROM g a JOIN g b ON a.platform = b.platform AND a.interest_group = '5_plus' AND b.interest_group = '3_4')
SELECT round(max(gap) FILTER (WHERE platform = 'android'), 4) AS android_gap, round(max(gap) FILTER (WHERE platform = 'ios'), 4) AS ios_gap,
 round((max(gap) FILTER (WHERE platform = 'android') - max(gap) FILTER (WHERE platform = 'ios')) / sqrt(sum(var)), 2) AS z_interaction
FROM d;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q14 — time to first post by account type (see STORY H9); finer buckets
-- ─────────────────────────────────────────────────────────────────────────
SELECT account_type,
 round(avg((t1 < t0 + INTERVAL 6 HOUR)::INT) FILTER (WHERE t1 IS NOT NULL), 4) AS within_6h,
 round(avg((t1 < t0 + INTERVAL 24 HOUR)::INT) FILTER (WHERE t1 IS NOT NULL), 4) AS within_24h,
 round(avg((t1 < t0 + INTERVAL 72 HOUR)::INT) FILTER (WHERE t1 IS NOT NULL), 4) AS within_72h,
 round(quantile_cont(date_diff('second', t0, t1) / 3600.0, 0.25), 2) AS p25_hours, round(quantile_cont(date_diff('second', t0, t1) / 3600.0, 0.75), 2) AS p75_hours
FROM first_post GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q15 — Circle paywall conversion by trigger (see STORY H10); tier mix
-- ─────────────────────────────────────────────────────────────────────────
SELECT paywall_trigger, circle_tier, count(*) AS subscriptions, round(count(*)::DOUBLE / sum(count(*)) OVER (PARTITION BY paywall_trigger), 4) AS tier_mix
FROM ev WHERE event = 'circle subscription started' GROUP BY 1, 2 ORDER BY 1, 2;

-- Funnels report on uniques (circle paywall viewed with paywall_trigger = X → circle subscription started):
-- a member enters at their first paywall view of that trigger and converts if they subscribe within the window
WITH f AS (SELECT uid, paywall_trigger, min(t) AS t1 FROM ev WHERE event = 'circle paywall viewed' GROUP BY 1, 2),
s AS (SELECT uid, t FROM ev WHERE event = 'circle subscription started'),
w AS (SELECT * FROM (VALUES ('1 hour', INTERVAL 1 HOUR), ('30 days (default)', INTERVAL 30 DAY)) AS x(conversion_window, len))
SELECT w.conversion_window, f.paywall_trigger, count(*) AS members,
 count(*) FILTER (WHERE EXISTS (SELECT 1 FROM s WHERE s.uid = f.uid AND s.t > f.t1 AND s.t <= f.t1 + w.len)) AS converted,
 round(converted / members, 4) AS conversion
FROM f CROSS JOIN w GROUP BY 1, 2 ORDER BY 1, 2;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q16 — Smart Digest engagement null: active days and app opens per exposed member from 2026-08-05, Digest vs Control; sub-splits
-- ─────────────────────────────────────────────────────────────────────────
WITH a AS (SELECT p.variant, p.uid, (p.joined_date < '2026-06-04') AS established, any_value(x.platform) AS platform,
  count(DISTINCT x.t::DATE) FILTER (WHERE x.t >= TIMESTAMP '2026-08-05') AS active_days_after,
  count(*) FILTER (WHERE x.t >= TIMESTAMP '2026-08-05' AND x.event = 'app opened') AS app_opens_after
  FROM prof p LEFT JOIN active_ev x ON x.uid = p.uid WHERE p.variant IS NOT NULL GROUP BY 1, 2, 3),
d AS (SELECT 'all' AS grp, * FROM a UNION ALL SELECT platform, * FROM a
  UNION ALL SELECT CASE WHEN established THEN 'joined before Jun 4' ELSE 'joined in window' END, * FROM a),
g AS (SELECT grp, variant, count(*) AS n, avg(active_days_after) AS m_days, var_samp(active_days_after) AS v_days,
  avg(app_opens_after) AS m_opens, var_samp(app_opens_after) AS v_opens FROM d GROUP BY 1, 2)
SELECT c.grp, c.n AS control_members, x.n AS digest_members,
 round(c.m_days, 3) AS control_active_days, round(x.m_days, 3) AS digest_active_days, round((x.m_days - c.m_days) / sqrt(x.v_days / x.n + c.v_days / c.n), 2) AS z_active_days,
 round(c.m_opens, 3) AS control_app_opens, round(x.m_opens, 3) AS digest_app_opens, round((x.m_opens - c.m_opens) / sqrt(x.v_opens / x.n + c.v_opens / c.n), 2) AS z_app_opens
FROM g c JOIN g x ON x.grp = c.grp AND c.variant = 'Control' AND x.variant = 'Digest' ORDER BY 1;

-- interaction check: does the Digest - Control gap in active days differ between Android and iOS? (z)
WITH a AS (SELECT p.variant, p.uid, any_value(x.platform) AS platform,
  count(DISTINCT x.t::DATE) FILTER (WHERE x.t >= TIMESTAMP '2026-08-05') AS active_days_after
  FROM prof p LEFT JOIN active_ev x ON x.uid = p.uid WHERE p.variant IS NOT NULL GROUP BY 1, 2),
g AS (SELECT platform, variant, count(*) AS n, avg(active_days_after) AS m, var_samp(active_days_after) AS v FROM a GROUP BY 1, 2),
d AS (SELECT x.platform, x.m - c.m AS gap, x.v / x.n + c.v / c.n AS var FROM g x JOIN g c ON c.platform = x.platform AND x.variant = 'Digest' AND c.variant = 'Control')
SELECT round(max(gap) FILTER (WHERE platform = 'android'), 3) AS android_gap, round(max(gap) FILTER (WHERE platform = 'ios'), 3) AS ios_gap,
 round((max(gap) FILTER (WHERE platform = 'android') - max(gap) FILTER (WHERE platform = 'ios')) / sqrt(sum(var)), 2) AS z_interaction
FROM d;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q17 — pushes sent per day before vs after Aug 5
-- ─────────────────────────────────────────────────────────────────────────
WITH d AS (SELECT t::DATE AS d, count(*) AS pushes FROM ev WHERE event = 'push notification sent' AND t >= TIMESTAMP '2026-07-08' AND t < TIMESTAMP '2026-09-02' GROUP BY 1),
m AS (SELECT t::DATE AS d, count(DISTINCT uid) AS dau FROM active_ev WHERE t >= TIMESTAMP '2026-07-08' AND t < TIMESTAMP '2026-09-02' GROUP BY 1)
SELECT CASE WHEN d.d < DATE '2026-08-05' THEN '1 Jul 8 - Aug 4' ELSE '2 Aug 5 - Sep 1' END AS period, round(avg(pushes), 1) AS pushes_per_day,
 round(sum(pushes)::DOUBLE / sum(dau), 3) AS pushes_per_active_member_day
FROM d JOIN m ON m.d = d.d GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q18 — ad revenue and eCPM by placement, September (warehouse)
-- ─────────────────────────────────────────────────────────────────────────
SELECT ad_placement, sum(impressions_served) AS impressions_served, round(sum(ad_revenue_usd), 2) AS revenue_usd,
 round(1000 * sum(ad_revenue_usd) / sum(impressions_served), 3) AS ecpm_usd,
 round(sum(ad_revenue_usd) / sum(sum(ad_revenue_usd)) OVER (), 4) AS revenue_share
FROM wh_ads WHERE date::DATE >= DATE '2026-09-01' AND date::DATE <= DATE '2026-09-30' GROUP BY 1 ORDER BY 1;

SELECT ad_placement,
 round(1000 * sum(ad_revenue_usd) FILTER (WHERE date::DATE BETWEEN DATE '2026-09-01' AND DATE '2026-09-08') / sum(impressions_served) FILTER (WHERE date::DATE BETWEEN DATE '2026-09-01' AND DATE '2026-09-08'), 3) AS ecpm_sep_1_8,
 round(1000 * sum(ad_revenue_usd) FILTER (WHERE date::DATE BETWEEN DATE '2026-09-09' AND DATE '2026-09-30') / sum(impressions_served) FILTER (WHERE date::DATE BETWEEN DATE '2026-09-09' AND DATE '2026-09-30'), 3) AS ecpm_sep_9_30
FROM wh_ads GROUP BY 1 ORDER BY 1;

-- Mixpanel ad viewed vs ad server impressions, September
SELECT a.ad_placement, a.mixpanel_ad_views, w.impressions_served, round(w.impressions_served::DOUBLE / a.mixpanel_ad_views, 3) AS server_over_mixpanel
FROM (SELECT ad_placement, count(*) AS mixpanel_ad_views FROM ev WHERE event = 'ad viewed' AND t >= TIMESTAMP '2026-09-01' AND t < TIMESTAMP '2026-10-01' GROUP BY 1) a
JOIN (SELECT ad_placement, sum(impressions_served) AS impressions_served FROM wh_ads WHERE date::DATE BETWEEN DATE '2026-09-01' AND DATE '2026-09-30' GROUP BY 1) w ON w.ad_placement = a.ad_placement ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q19 — quarter review inputs: new-member retention by signup month, weekly active members
-- ─────────────────────────────────────────────────────────────────────────
SELECT strftime(t0, '%Y-%m') AS signup_month, count(*) AS signups, round(avg(retained_d14_27::INT), 4) AS retention_d14_27,
 round(avg((onboarding_follows <= 2)::INT), 4) AS share_0_2_follows
FROM signups GROUP BY 1 ORDER BY 1;

SELECT date_trunc('week', t)::DATE AS week, count(DISTINCT uid) AS weekly_active_members FROM active_ev GROUP BY 1 ORDER BY 1;

-- per 1,000 weekly active members: first four full weeks vs last four full weeks (the late period holds the Sound Awards, Sep 12)
WITH w AS (SELECT CASE WHEN a.t < TIMESTAMP '2026-07-06' THEN '1 Jun 8 - Jul 5' ELSE '2 Aug 31 - Sep 27' END AS period, date_trunc('week', a.t)::DATE AS week, a.uid, a.event, (p.joined_date < '2026-06-04') AS established
  FROM active_ev a JOIN prof p ON p.uid = a.uid
  WHERE (a.t >= TIMESTAMP '2026-06-08' AND a.t < TIMESTAMP '2026-07-06') OR (a.t >= TIMESTAMP '2026-08-31' AND a.t < TIMESTAMP '2026-09-28')),
k AS (SELECT period, week, 'all members' AS members, count(DISTINCT uid) AS wau,
  count(*) FILTER (WHERE event = 'user unfollowed') AS unf, count(*) FILTER (WHERE event = 'post shared') AS shr, count(*) FILTER (WHERE event = 'community joined') AS cj,
  count(*) FILTER (WHERE event = 'profile updated') AS pu, count(*) FILTER (WHERE event = 'content reported') AS rep FROM w GROUP BY 1, 2
  UNION ALL
  SELECT period, week, 'joined before Jun 4', count(DISTINCT uid),
  count(*) FILTER (WHERE event = 'user unfollowed'), count(*) FILTER (WHERE event = 'post shared'), count(*) FILTER (WHERE event = 'community joined'),
  count(*) FILTER (WHERE event = 'profile updated'), count(*) FILTER (WHERE event = 'content reported') FROM w WHERE established GROUP BY 1, 2)
SELECT members, period, sum(wau) AS member_weeks,
 round(1000.0 * sum(unf) / sum(wau), 1) AS unfollows_per_1k_wau, round(1000.0 * sum(shr) / sum(wau), 1) AS shares_per_1k_wau,
 round(1000.0 * sum(cj) / sum(wau), 1) AS community_joins_per_1k_wau, round(1000.0 * sum(pu) / sum(wau), 1) AS profile_updates_per_1k_wau,
 round(1000.0 * sum(rep) / sum(wau), 1) AS reports_per_1k_wau
FROM k GROUP BY 1, 2 ORDER BY 1, 2;

-- members who joined before Jun 4: unfollow counts in the two periods (equal member-weeks), Poisson z
WITH w AS (SELECT a.t FROM active_ev a JOIN prof p ON p.uid = a.uid
  WHERE a.event = 'user unfollowed' AND p.joined_date < '2026-06-04'
  AND ((a.t >= TIMESTAMP '2026-06-08' AND a.t < TIMESTAMP '2026-07-06') OR (a.t >= TIMESTAMP '2026-08-31' AND a.t < TIMESTAMP '2026-09-28'))),
c AS (SELECT count(*) FILTER (WHERE t < TIMESTAMP '2026-07-06') AS early, count(*) FILTER (WHERE t >= TIMESTAMP '2026-08-31') AS late FROM w)
SELECT early AS unfollows_jun8_jul5, late AS unfollows_aug31_sep27, round((late - early) / sqrt(late + early), 2) AS z FROM c;

-- September (Sep 1-30): ad revenue vs paid acquisition spend
SELECT (SELECT round(sum(ad_revenue_usd), 2) FROM wh_ads WHERE date::DATE BETWEEN DATE '2026-09-01' AND DATE '2026-09-30') AS ad_revenue_usd,
 (SELECT round(sum(spend_usd), 2) FROM wh_spend WHERE date::DATE BETWEEN DATE '2026-09-01' AND DATE '2026-09-30') AS paid_spend_usd;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q20 — why channels retain differently: retention standardized by onboarding follows
-- ─────────────────────────────────────────────────────────────────────────
WITH m AS (SELECT * FROM signups WHERE retained_d14_27 IS NOT NULL),
pk AS (SELECT least(onboarding_follows, 7) AS k, avg(retained_d14_27::INT) AS rk FROM m GROUP BY 1)
SELECT m.ch, count(*) AS mature_signups, round(avg(m.retained_d14_27::INT), 4) AS observed_retention,
 round(avg(pk.rk), 4) AS expected_from_follows_alone, round(avg(m.onboarding_follows), 2) AS avg_onboarding_follows
FROM m JOIN pk ON pk.k = least(m.onboarding_follows, 7) GROUP BY 1 ORDER BY 1;

-- within the same follow bucket, channels retain alike
SELECT CASE WHEN onboarding_follows <= 2 THEN '0-2' WHEN onboarding_follows <= 6 THEN '3-6' ELSE '7+' END AS follows_bucket,
 round(avg(retained_d14_27::INT) FILTER (WHERE ch = 'creator_partnerships'), 4) AS creator_partnerships,
 round(avg(retained_d14_27::INT) FILTER (WHERE ch = 'meta_ads'), 4) AS meta_ads,
 round(avg(retained_d14_27::INT) FILTER (WHERE ch = 'tiktok_ads'), 4) AS tiktok_ads,
 round(avg(retained_d14_27::INT) FILTER (WHERE ch = 'organic'), 4) AS organic,
 round(avg(retained_d14_27::INT) FILTER (WHERE ch = 'friend_invite'), 4) AS friend_invite
FROM signups WHERE retained_d14_27 IS NOT NULL GROUP BY 1 ORDER BY 1;
