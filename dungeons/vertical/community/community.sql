-- Hearthside (community vertical) — story-keyed and eval-keyed DuckDB queries.
--
-- Generate first (repo root):
--   node scripts/verify-runner.mjs dungeons/vertical/community/community.js verify-community
-- Run:
--   duckdb -c ".read dungeons/vertical/community/community.sql"
-- Against a gzipped export:
--   duckdb -c "SET VARIABLE data_prefix='<dir>/community'" -c ".read community.sql"
--
-- All times are UTC. Window: 2026-06-04 00:00 to 2026-10-01 23:59:59.

SET VARIABLE data_prefix = COALESCE(getvariable('data_prefix'), 'data/verify-community');

-- ─────────────────────────────────────────────────────────────────────────
-- PRELUDE: raw files, identity resolution, warehouse tables
-- ─────────────────────────────────────────────────────────────────────────
-- Identity: new members sign up with "account created" (the auth event, which
-- carries user_id and device_id). A device resolves to the member seen with it
-- on any event that carries both ids, the way Mixpanel stitches. Every event
-- already carries user_id, so uid = user_id in practice.

CREATE OR REPLACE TEMP TABLE raw_events AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-EVENTS*.json*', sample_size=-1, union_by_name=true);

CREATE OR REPLACE TEMP TABLE users AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-USERS*.json*', sample_size=-1, union_by_name=true);

CREATE OR REPLACE TEMP TABLE communities AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-community_id-GROUPS*.json*', sample_size=-1, union_by_name=true);

CREATE OR REPLACE TEMP TABLE device_map AS
SELECT device_id, min(user_id::VARCHAR) AS mapped
FROM raw_events WHERE user_id IS NOT NULL AND device_id IS NOT NULL GROUP BY 1;

CREATE OR REPLACE TEMP TABLE ev AS
SELECT coalesce(e.user_id::VARCHAR, m.mapped) AS uid, e.time::TIMESTAMP AS t, e.*
FROM raw_events e LEFT JOIN device_map m ON e.device_id = m.device_id;

CREATE OR REPLACE TEMP TABLE wh_marketing AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-paid_marketing_daily.json*', sample_size=-1, union_by_name=true);
CREATE OR REPLACE TEMP TABLE wh_trust AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-trust_safety_daily.json*', sample_size=-1, union_by_name=true);
CREATE OR REPLACE TEMP TABLE wh_ads AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-ad_revenue_daily.json*', sample_size=-1, union_by_name=true);

-- member actions: everything except server-side messages (notifications, report resolutions)
CREATE OR REPLACE TEMP TABLE actions AS
SELECT * FROM ev WHERE event NOT IN ('notification received', 'report resolved');

-- new-member signups, with the intro post (onboarding step 3) if any
CREATE OR REPLACE TEMP TABLE signups AS
SELECT s.uid, s.t AS t0, s.acquisition_channel AS ch, s.signup_method, i.ti,
 coalesce(i.ti >= s.t AND i.ti < s.t + INTERVAL 7 DAY, false) AS onboarded
FROM (SELECT * FROM ev WHERE event = 'account created') s
LEFT JOIN (SELECT uid, min(t) AS ti FROM ev WHERE event = 'intro posted' GROUP BY 1) i ON i.uid = s.uid;

-- one row per report: filed, resolved (report_id is shared by both)
CREATE OR REPLACE TEMP TABLE reports AS
SELECT s.report_id, s.uid, s.report_type, s.content_hub, s.t AS t_sub, r.t AS t_res, r.resolution_hours,
 s.report_type IN ('spam', 'harassment', 'vandalism') AS triaged
FROM (SELECT * FROM ev WHERE event = 'report submitted') s
LEFT JOIN (SELECT report_id, min(t) AS t, any_value(resolution_hours) AS resolution_hours FROM ev WHERE event = 'report resolved' GROUP BY 1) r
  ON r.report_id = s.report_id;

-- one row per thread view, matched to the same member's reply on that thread within a day
CREATE OR REPLACE TEMP TABLE thread_views AS
SELECT r.uid, r.thread_id, r.content_hub, r.t AS t_view, min(c.t) AS t_reply
FROM (SELECT * FROM ev WHERE event = 'discussion viewed') r
LEFT JOIN (SELECT uid, thread_id, t FROM ev WHERE event = 'comment posted') c
  ON c.uid = r.uid AND c.thread_id = r.thread_id AND c.t >= r.t AND c.t < r.t + INTERVAL 1 DAY
GROUP BY 1, 2, 3, 4;

-- dataset overview
SELECT count(*) AS events, count(DISTINCT uid) AS members_with_events, (SELECT count(*) FROM users) AS profiles,
 (SELECT count(*) FROM signups) AS new_signups, (SELECT count(*) FROM communities) AS communities,
 min(t) AS first_event, max(t) AS last_event FROM ev;

-- identity check: every event resolves to a member; device_id gaps are the two post-signup onboarding steps
SELECT count(*) FILTER (WHERE uid IS NULL) AS unresolved_events,
 string_agg(DISTINCT event, ', ') FILTER (WHERE device_id IS NULL) AS events_without_device_id
FROM ev;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H1-starfall-launch-surge — gaming reading + search, Aug 6-19 vs Jul 23 - Aug 5
-- ─────────────────────────────────────────────────────────────────────────
WITH w AS (SELECT (content_hub = 'gaming') AS gaming, (t >= TIMESTAMP '2026-08-06') AS launch FROM ev
  WHERE event IN ('article viewed', 'search performed') AND t >= TIMESTAMP '2026-07-23' AND t < TIMESTAMP '2026-08-20')
SELECT round((count(*) FILTER (WHERE gaming AND launch)::DOUBLE / count(*) FILTER (WHERE NOT gaming AND launch))
   / (count(*) FILTER (WHERE gaming AND NOT launch)::DOUBLE / count(*) FILTER (WHERE NOT gaming AND NOT launch)), 3) AS gaming_vs_other_lift,
 round(count(*) FILTER (WHERE NOT gaming AND launch)::DOUBLE / count(*) FILTER (WHERE NOT gaming AND NOT launch), 3) AS other_hubs_ratio
FROM w;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H2-onboarding-by-channel — intro posted within 7 days, by acquisition channel
-- ─────────────────────────────────────────────────────────────────────────
SELECT ch AS acquisition_channel, count(*) AS signups, round(avg(onboarded::INT), 4) AS onboarding_rate
FROM signups GROUP BY 1 ORDER BY 3 DESC;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H3-reply-nudges-experiment — per thread view reply rate and time, by variant (from 2026-07-08)
-- ─────────────────────────────────────────────────────────────────────────
SELECT u."Experiment: Reply Nudges" AS variant, count(DISTINCT v.uid) AS members, count(*) AS thread_views,
 round(avg((v.t_reply IS NOT NULL)::INT), 4) AS reply_rate,
 round(median(date_diff('second', v.t_view, v.t_reply)) / 60.0, 2) AS median_minutes_to_reply
FROM thread_views v JOIN users u ON u.distinct_id::VARCHAR = v.uid
WHERE v.t_view >= TIMESTAMP '2026-07-08' AND u."Experiment: Reply Nudges" IS NOT NULL
GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H4-hearth-guard-triage — median hours to resolve, before 2026-07-22 vs 2026-08-01..09-23
-- (reports filed during the Aug 19-21 raid left out; every "after" report has a week to resolve)
-- ─────────────────────────────────────────────────────────────────────────
WITH x AS (SELECT triaged, CASE WHEN t_sub < TIMESTAMP '2026-07-22' THEN 'before' WHEN t_sub >= TIMESTAMP '2026-08-01' AND t_sub < TIMESTAMP '2026-09-24' THEN 'after' END AS period,
  date_diff('second', t_sub, t_res) / 3600.0 AS h
  FROM reports WHERE t_res IS NOT NULL AND NOT (t_sub >= TIMESTAMP '2026-08-19' AND t_sub < TIMESTAMP '2026-08-22'))
SELECT CASE WHEN triaged THEN 'spam/harassment/vandalism' ELSE 'misinformation/copyright/other' END AS kind,
 round(median(h) FILTER (WHERE period = 'before'), 2) AS median_h_before, round(median(h) FILTER (WHERE period = 'after'), 2) AS median_h_after,
 round(median(h) FILTER (WHERE period = 'after') / median(h) FILTER (WHERE period = 'before'), 3) AS after_before
FROM x WHERE period IS NOT NULL GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H5-anime-spam-raid — raid days from the warehouse; anime share of participation vs same weekdays ±7 days
-- ─────────────────────────────────────────────────────────────────────────
SELECT date, content_hub, reports_received, spam_accounts_removed, automod_removals, volunteer_mod_hours
FROM wh_trust WHERE raid_alert_level = 'raid' ORDER BY date;

WITH w AS (SELECT (content_hub = 'anime') AS anime,
  (t >= TIMESTAMP '2026-08-19' AND t < TIMESTAMP '2026-08-22') AS raid FROM ev
  WHERE event IN ('comment posted', 'discussion posted', 'upvote given', 'media uploaded')
    AND ((t >= TIMESTAMP '2026-08-19' AND t < TIMESTAMP '2026-08-22') OR (t >= TIMESTAMP '2026-08-12' AND t < TIMESTAMP '2026-08-15') OR (t >= TIMESTAMP '2026-08-26' AND t < TIMESTAMP '2026-08-29')))
SELECT round((count(*) FILTER (WHERE anime AND raid)::DOUBLE / count(*) FILTER (WHERE NOT anime AND raid))
   / (count(*) FILTER (WHERE anime AND NOT raid)::DOUBLE / count(*) FILTER (WHERE NOT anime AND NOT raid)), 3) AS anime_share_ratio,
 round((count(*) FILTER (WHERE NOT anime AND raid) / 3.0) / (count(*) FILTER (WHERE NOT anime AND NOT raid) / 6.0), 3) AS other_hubs_ratio
FROM w;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H6-first-reply-retention — day-30 unbounded retention by reply to the intro within 24 h
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE TEMP TABLE intro_reply AS
SELECT s.uid, s.t0, s.ti, s.ch,
 EXISTS (SELECT 1 FROM ev e WHERE e.uid = s.uid AND e.event = 'notification received' AND e.notification_type = 'reply'
   AND e.t > s.ti AND e.t <= s.ti + INTERVAL 24 HOUR) AS replied,
 EXISTS (SELECT 1 FROM actions a WHERE a.uid = s.uid AND a.t >= s.t0 + INTERVAL 30 DAY) AS retained_d30,
 EXISTS (SELECT 1 FROM actions a WHERE a.uid = s.uid AND a.t >= s.t0 + INTERVAL 30 DAY AND a.t < s.t0 + INTERVAL 37 DAY) AS active_d30_week
FROM signups s WHERE s.ti IS NOT NULL;

SELECT CASE WHEN replied THEN 'reply_within_24h' ELSE 'no_reply_24h' END AS grp, count(*) AS members,
 round(avg(retained_d30::INT), 4) AS d30_unbounded_retention
FROM intro_reply WHERE t0 < TIMESTAMP '2026-09-01' GROUP BY 1 ORDER BY 1;

SELECT round(avg(replied::INT), 4) AS share_of_intros_replied_24h FROM intro_reply WHERE ti < TIMESTAMP '2026-09-30 23:59:59';

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H7-reverted-first-edit — new editors: edited again within 30 days, by revert of the first edit
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE TEMP TABLE new_editors AS
WITH f AS (SELECT e.uid, min(e.t) AS t1 FROM ev e JOIN signups s ON s.uid = e.uid WHERE e.event = 'article edited' GROUP BY 1)
SELECT f.uid, f.t1,
 EXISTS (SELECT 1 FROM ev e WHERE e.uid = f.uid AND e.event = 'notification received' AND e.notification_type = 'edit_reverted' AND e.t >= f.t1 AND e.t < f.t1 + INTERVAL 2 DAY) AS reverted,
 EXISTS (SELECT 1 FROM ev e WHERE e.uid = f.uid AND e.event = 'article edited' AND e.t > f.t1 AND e.t <= f.t1 + INTERVAL 30 DAY) AS edited_again_30d
FROM f;

SELECT CASE WHEN reverted THEN 'first_edit_reverted' ELSE 'first_edit_kept' END AS grp, count(*) AS new_editors,
 round(avg(edited_again_30d::INT), 4) AS edited_again_within_30d
FROM new_editors WHERE t1 < TIMESTAMP '2026-09-01' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H8-ad-load-change — warehouse impressions per free article view; reading per search; upgrade conversion
-- ─────────────────────────────────────────────────────────────────────────
WITH v AS (SELECT t::DATE AS d, count(*) AS page_views FROM ev WHERE event = 'article viewed' AND membership = 'free' GROUP BY 1),
w AS (SELECT date::DATE AS d, sum(ad_impressions) AS imp, sum(ad_revenue_usd) AS rev FROM wh_ads GROUP BY 1)
SELECT CASE WHEN d < DATE '2026-09-02' THEN 'before' ELSE 'after' END AS period,
 round(sum(imp) / sum(page_views), 3) AS impressions_per_free_view, round(sum(rev) / count(*), 2) AS ad_revenue_per_day
FROM v JOIN w USING (d) GROUP BY 1 ORDER BY 1 DESC;

SELECT membership, CASE WHEN t < TIMESTAMP '2026-09-02' THEN 'before' ELSE 'after' END AS period,
 round(count(*) FILTER (WHERE event = 'article viewed')::DOUBLE / count(*) FILTER (WHERE event = 'search performed'), 3) AS views_per_search
FROM ev WHERE event IN ('article viewed', 'search performed') GROUP BY 1, 2 ORDER BY 1, 2 DESC;

WITH p AS (SELECT uid, t AS t0 FROM ev WHERE event = 'plus page viewed'),
b AS (SELECT uid, min(t) AS t1 FROM ev WHERE event = 'plus subscribed' GROUP BY 1)
SELECT CASE WHEN p.t0 < TIMESTAMP '2026-09-02' THEN '1_before' WHEN p.t0 >= TIMESTAMP '2026-09-09' THEN '3_after' ELSE '2_ramp' END AS period,
 count(*) AS upgrade_page_visits, sum(coalesce(b.t1 >= p.t0 AND b.t1 < p.t0 + INTERVAL 1 DAY, false)::INT) AS converted_visits,
 round(avg(coalesce(b.t1 >= p.t0 AND b.t1 < p.t0 + INTERVAL 1 DAY, false)::INT), 4) AS conversion_per_visit
FROM p LEFT JOIN b ON b.uid = p.uid GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H9-paid-channel-economics — spend per signup and per onboarded member, by paid channel
-- ─────────────────────────────────────────────────────────────────────────
SELECT s.ch AS acquisition_channel, count(*) AS signups, sum(onboarded::INT) AS onboarded, round(sp.spend, 2) AS spend_usd,
 round(sp.spend / count(*), 2) AS spend_per_signup, round(sp.spend / sum(onboarded::INT), 2) AS spend_per_onboarded
FROM signups s JOIN (SELECT acquisition_channel, sum(spend_usd) AS spend FROM wh_marketing GROUP BY 1) sp ON sp.acquisition_channel = s.ch
GROUP BY s.ch, sp.spend ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H10-fandom-fest — participation Thu-Sun Sep 17-20 vs the same days a week before and after
-- ─────────────────────────────────────────────────────────────────────────
WITH x AS (SELECT CASE WHEN event = 'article viewed' THEN 'reading' ELSE 'participation' END AS grp,
  CASE WHEN t >= TIMESTAMP '2026-09-17' AND t < TIMESTAMP '2026-09-21' THEN 'fest'
       WHEN (t >= TIMESTAMP '2026-09-10' AND t < TIMESTAMP '2026-09-14') OR (t >= TIMESTAMP '2026-09-24' AND t < TIMESTAMP '2026-09-28') THEN 'base' END AS p
  FROM ev WHERE event IN ('media uploaded', 'discussion posted', 'comment posted', 'upvote given', 'article viewed'))
SELECT grp, count(*) FILTER (WHERE p = 'fest') AS fest_events, count(*) FILTER (WHERE p = 'base') / 2.0 AS baseline_events,
 round(count(*) FILTER (WHERE p = 'fest')::DOUBLE / (count(*) FILTER (WHERE p = 'base') / 2.0), 3) AS lift
FROM x WHERE p IS NOT NULL GROUP BY 1 ORDER BY 1;

-- ═════════════════════════════════════════════════════════════════════════
-- EVAL QUERIES (eval/community.eval.md)
-- ═════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q1 — Starfall: gaming article views per day, before / launch fortnight / first and last 3 days
-- ─────────────────────────────────────────────────────────────────────────
WITH d AS (SELECT t::DATE AS day, count(*) FILTER (WHERE content_hub = 'gaming') AS gaming, count(*) FILTER (WHERE content_hub <> 'gaming') AS other
  FROM ev WHERE event = 'article viewed' AND t >= TIMESTAMP '2026-07-23' AND t < TIMESTAMP '2026-08-20' GROUP BY 1)
SELECT round(avg(gaming) FILTER (WHERE day < DATE '2026-08-06'), 1) AS gaming_per_day_jul23_aug5,
 round(avg(gaming) FILTER (WHERE day >= DATE '2026-08-06'), 1) AS gaming_per_day_aug6_19,
 round(avg(gaming) FILTER (WHERE day BETWEEN DATE '2026-08-06' AND DATE '2026-08-08'), 1) AS gaming_per_day_aug6_8,
 round(avg(gaming) FILTER (WHERE day BETWEEN DATE '2026-08-17' AND DATE '2026-08-19'), 1) AS gaming_per_day_aug17_19,
 round(avg(other) FILTER (WHERE day < DATE '2026-08-06'), 1) AS other_per_day_before,
 round(avg(other) FILTER (WHERE day >= DATE '2026-08-06'), 1) AS other_per_day_launch,
 round((avg(gaming) FILTER (WHERE day >= DATE '2026-08-06') / avg(other) FILTER (WHERE day >= DATE '2026-08-06'))
   / (avg(gaming) FILTER (WHERE day < DATE '2026-08-06') / avg(other) FILTER (WHERE day < DATE '2026-08-06')), 3) AS gaming_lift_vs_other_hubs
FROM d;
-- gaming searches, same windows
SELECT round(count(*) FILTER (WHERE t < TIMESTAMP '2026-08-06') / 14.0, 1) AS gaming_searches_per_day_before,
 round(count(*) FILTER (WHERE t >= TIMESTAMP '2026-08-06') / 14.0, 1) AS gaming_searches_per_day_launch
FROM ev WHERE event = 'search performed' AND content_hub = 'gaming' AND t >= TIMESTAMP '2026-07-23' AND t < TIMESTAMP '2026-08-20';

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q2 — onboarding completion (7-day window) by acquisition channel, with the interests step
-- ─────────────────────────────────────────────────────────────────────────
WITH x AS (SELECT s.*, EXISTS (SELECT 1 FROM ev e WHERE e.uid = s.uid AND e.event = 'interests selected') AS interests FROM signups s)
SELECT ch AS acquisition_channel, count(*) AS signups, sum(onboarded::INT) AS onboarded, round(avg(onboarded::INT), 4) AS onboarding_rate,
 round(avg(interests::INT), 4) AS reached_interests_step
FROM x GROUP BY 1
UNION ALL SELECT 'ALL', count(*), sum(onboarded::INT), round(avg(onboarded::INT), 4), round(avg(interests::INT), 4) FROM x
ORDER BY 4 DESC;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q3 — onboarding by device at signup (null): mobile (iOS, iPadOS, Android) vs desktop, overall and by paid/unpaid channel
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE TEMP TABLE signup_device AS
SELECT s.*, e.os, CASE WHEN e.os IN ('iOS', 'iPadOS', 'Android') THEN 'mobile' ELSE 'desktop' END AS device_type,
 CASE WHEN s.ch IN ('reddit_ads', 'tiktok_ads', 'youtube_creators') THEN 'paid' ELSE 'unpaid' END AS channel_group
FROM signups s JOIN (SELECT uid, os FROM ev WHERE event = 'account created') e ON e.uid = s.uid;
WITH g AS (SELECT 'all' AS split, device_type, count(*) AS n, avg(onboarded::INT) AS r FROM signup_device GROUP BY 2
  UNION ALL SELECT channel_group, device_type, count(*), avg(onboarded::INT) FROM signup_device GROUP BY 1, 2)
SELECT split, max(n) FILTER (WHERE device_type = 'mobile') AS mobile_n, round(max(r) FILTER (WHERE device_type = 'mobile'), 4) AS mobile_rate,
 max(n) FILTER (WHERE device_type = 'desktop') AS desktop_n, round(max(r) FILTER (WHERE device_type = 'desktop'), 4) AS desktop_rate,
 round((max(r) FILTER (WHERE device_type = 'mobile') - max(r) FILTER (WHERE device_type = 'desktop'))
   / sqrt(avg(r) * (1 - avg(r)) * (1.0 / max(n) FILTER (WHERE device_type = 'mobile') + 1.0 / max(n) FILTER (WHERE device_type = 'desktop'))), 2) AS z
FROM g GROUP BY 1 ORDER BY 1;
-- by operating system, with a chi-square across all systems
WITH g AS (SELECT os, count(*) AS n, sum(onboarded::INT) AS k FROM signup_device GROUP BY 1), tot AS (SELECT sum(k)::DOUBLE / sum(n) AS p FROM g)
SELECT os, n, round(k::DOUBLE / n, 4) AS rate,
 round(sum(power(k - n * p, 2) / (n * p) + power((n - k) - n * (1 - p), 2) / (n * (1 - p))) OVER (), 2) AS chi2, count(*) OVER () - 1 AS df
FROM g, tot ORDER BY n DESC;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q4 — Reply Nudges: per thread view reply rate and time, by variant; exposure split
-- ─────────────────────────────────────────────────────────────────────────
SELECT u."Experiment: Reply Nudges" AS variant, count(DISTINCT v.uid) AS members, count(*) AS thread_views,
 sum((v.t_reply IS NOT NULL)::INT) AS replies, round(avg((v.t_reply IS NOT NULL)::INT), 4) AS reply_rate,
 round(median(date_diff('second', v.t_view, v.t_reply)) / 60.0, 2) AS median_minutes_to_reply,
 round(count(*)::DOUBLE / count(DISTINCT v.uid), 2) AS thread_views_per_member
FROM thread_views v JOIN users u ON u.distinct_id::VARCHAR = v.uid
WHERE v.t_view >= TIMESTAMP '2026-07-08' AND u."Experiment: Reply Nudges" IS NOT NULL GROUP BY 1 ORDER BY 1;
SELECT "Variant name" AS variant, count(DISTINCT uid) AS exposed_members, min(t)::DATE AS first_exposure FROM ev WHERE event = '$experiment_started' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q5 — Hearth Guard: median hours to resolve by report type, before Jul 22 vs Aug 1 - Sep 23 (raid days left out); weekly trend
-- ─────────────────────────────────────────────────────────────────────────
WITH x AS (SELECT report_type, triaged, CASE WHEN t_sub < TIMESTAMP '2026-07-22' THEN 'before' WHEN t_sub >= TIMESTAMP '2026-08-01' AND t_sub < TIMESTAMP '2026-09-24' THEN 'after' END AS period,
  date_diff('second', t_sub, t_res) / 3600.0 AS h
  FROM reports WHERE t_res IS NOT NULL AND NOT (t_sub >= TIMESTAMP '2026-08-19' AND t_sub < TIMESTAMP '2026-08-22'))
SELECT report_type, count(*) FILTER (WHERE period = 'before') AS n_before, count(*) FILTER (WHERE period = 'after') AS n_after,
 round(median(h) FILTER (WHERE period = 'before'), 1) AS median_h_before, round(median(h) FILTER (WHERE period = 'after'), 1) AS median_h_after,
 round(median(h) FILTER (WHERE period = 'after') / median(h) FILTER (WHERE period = 'before'), 3) AS ratio
FROM x WHERE period IS NOT NULL GROUP BY 1
UNION ALL
SELECT CASE WHEN triaged THEN 'ALL spam/harassment/vandalism' ELSE 'ALL misinformation/copyright/other' END, count(*) FILTER (WHERE period = 'before'), count(*) FILTER (WHERE period = 'after'),
 round(median(h) FILTER (WHERE period = 'before'), 1), round(median(h) FILTER (WHERE period = 'after'), 1),
 round(median(h) FILTER (WHERE period = 'after') / median(h) FILTER (WHERE period = 'before'), 3)
FROM x WHERE period IS NOT NULL GROUP BY triaged
UNION ALL
SELECT 'ALL TYPES', count(*) FILTER (WHERE period = 'before'), count(*) FILTER (WHERE period = 'after'),
 round(median(h) FILTER (WHERE period = 'before'), 1), round(median(h) FILTER (WHERE period = 'after'), 1),
 round(median(h) FILTER (WHERE period = 'after') / median(h) FILTER (WHERE period = 'before'), 3)
FROM x WHERE period IS NOT NULL ORDER BY 1;
SELECT date_trunc('week', t_sub)::DATE AS week, count(*) AS resolved_reports, round(median(resolution_hours), 1) AS median_resolution_hours,
 round(median(resolution_hours) FILTER (WHERE triaged), 1) AS median_h_spam_harassment_vandalism
FROM reports WHERE t_res IS NOT NULL GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q6 — Hearth Guard and misinformation / copyright / other reports (null): per type, log-hours Welch z
-- ─────────────────────────────────────────────────────────────────────────
WITH x AS (SELECT report_type, CASE WHEN t_sub < TIMESTAMP '2026-07-22' THEN 0 WHEN t_sub >= TIMESTAMP '2026-08-01' AND t_sub < TIMESTAMP '2026-09-24' THEN 1 END AS after,
  ln(date_diff('second', t_sub, t_res) / 3600.0) AS lh, date_diff('second', t_sub, t_res) / 3600.0 AS h
  FROM reports WHERE t_res IS NOT NULL AND report_type IN ('misinformation', 'copyright', 'other') AND NOT (t_sub >= TIMESTAMP '2026-08-19' AND t_sub < TIMESTAMP '2026-08-22'))
SELECT report_type, count(*) FILTER (WHERE after = 0) AS n_before, count(*) FILTER (WHERE after = 1) AS n_after,
 round(median(h) FILTER (WHERE after = 0), 1) AS median_h_before, round(median(h) FILTER (WHERE after = 1), 1) AS median_h_after,
 round(exp(avg(lh) FILTER (WHERE after = 1) - avg(lh) FILTER (WHERE after = 0)), 3) AS geo_mean_ratio,
 round((avg(lh) FILTER (WHERE after = 1) - avg(lh) FILTER (WHERE after = 0)) / sqrt(var_samp(lh) FILTER (WHERE after = 1) / count(*) FILTER (WHERE after = 1) + var_samp(lh) FILTER (WHERE after = 0) / count(*) FILTER (WHERE after = 0)), 2) AS welch_z_log_hours
FROM x WHERE after IS NOT NULL GROUP BY 1
UNION ALL
SELECT 'ALL THREE', count(*) FILTER (WHERE after = 0), count(*) FILTER (WHERE after = 1),
 round(median(h) FILTER (WHERE after = 0), 1), round(median(h) FILTER (WHERE after = 1), 1),
 round(exp(avg(lh) FILTER (WHERE after = 1) - avg(lh) FILTER (WHERE after = 0)), 3),
 round((avg(lh) FILTER (WHERE after = 1) - avg(lh) FILTER (WHERE after = 0)) / sqrt(var_samp(lh) FILTER (WHERE after = 1) / count(*) FILTER (WHERE after = 1) + var_samp(lh) FILTER (WHERE after = 0) / count(*) FILTER (WHERE after = 0)), 2)
FROM x WHERE after IS NOT NULL ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q7 — anime raid: warehouse signals and participation, raid days vs the same weekdays a week before and after
-- ─────────────────────────────────────────────────────────────────────────
SELECT content_hub, round(avg(spam_accounts_removed) FILTER (WHERE raid_alert_level = 'raid'), 1) AS spam_removed_per_raid_day,
 round(avg(spam_accounts_removed) FILTER (WHERE date::DATE IN (DATE '2026-08-12', DATE '2026-08-13', DATE '2026-08-14', DATE '2026-08-26', DATE '2026-08-27', DATE '2026-08-28')), 1) AS spam_removed_per_base_day,
 round(avg(automod_removals) FILTER (WHERE raid_alert_level = 'raid'), 1) AS automod_per_raid_day,
 round(avg(automod_removals) FILTER (WHERE date::DATE IN (DATE '2026-08-12', DATE '2026-08-13', DATE '2026-08-14', DATE '2026-08-26', DATE '2026-08-27', DATE '2026-08-28')), 1) AS automod_per_base_day,
 round(avg(reports_received) FILTER (WHERE raid_alert_level = 'raid'), 1) AS reports_per_raid_day,
 round(avg(reports_received) FILTER (WHERE date::DATE IN (DATE '2026-08-12', DATE '2026-08-13', DATE '2026-08-14', DATE '2026-08-26', DATE '2026-08-27', DATE '2026-08-28')), 1) AS reports_per_base_day,
 round(avg(volunteer_mod_hours) FILTER (WHERE raid_alert_level = 'raid'), 1) AS mod_hours_per_raid_day,
 round(avg(volunteer_mod_hours) FILTER (WHERE date::DATE IN (DATE '2026-08-12', DATE '2026-08-13', DATE '2026-08-14', DATE '2026-08-26', DATE '2026-08-27', DATE '2026-08-28')), 1) AS mod_hours_per_base_day
FROM wh_trust WHERE content_hub = 'anime' GROUP BY 1;
WITH w AS (SELECT content_hub = 'anime' AS anime, (t >= TIMESTAMP '2026-08-19' AND t < TIMESTAMP '2026-08-22') AS raid, event FROM ev
  WHERE event IN ('comment posted', 'discussion posted', 'upvote given', 'media uploaded', 'report submitted')
    AND ((t >= TIMESTAMP '2026-08-19' AND t < TIMESTAMP '2026-08-22') OR (t >= TIMESTAMP '2026-08-12' AND t < TIMESTAMP '2026-08-15') OR (t >= TIMESTAMP '2026-08-26' AND t < TIMESTAMP '2026-08-29')))
SELECT round(count(*) FILTER (WHERE anime AND raid AND event <> 'report submitted') / 3.0, 1) AS anime_participation_per_raid_day,
 round(count(*) FILTER (WHERE anime AND NOT raid AND event <> 'report submitted') / 6.0, 1) AS anime_participation_per_base_day,
 round((count(*) FILTER (WHERE anime AND raid AND event <> 'report submitted') / 3.0) / (count(*) FILTER (WHERE anime AND NOT raid AND event <> 'report submitted') / 6.0), 3) AS anime_raw_ratio,
 round((count(*) FILTER (WHERE NOT anime AND raid AND event <> 'report submitted') / 3.0) / (count(*) FILTER (WHERE NOT anime AND NOT raid AND event <> 'report submitted') / 6.0), 3) AS other_hubs_ratio,
 round(((count(*) FILTER (WHERE anime AND NOT raid AND event <> 'report submitted') / 6.0)
   * ((count(*) FILTER (WHERE NOT anime AND raid AND event <> 'report submitted') / 3.0) / (count(*) FILTER (WHERE NOT anime AND NOT raid AND event <> 'report submitted') / 6.0))
   - count(*) FILTER (WHERE anime AND raid AND event <> 'report submitted') / 3.0) * 3, 0) AS lost_anime_actions_3_days,
 round(count(*) FILTER (WHERE anime AND raid AND event = 'report submitted') / 3.0, 1) AS anime_reports_per_raid_day,
 round(count(*) FILTER (WHERE anime AND NOT raid AND event = 'report submitted') / 6.0, 1) AS anime_reports_per_base_day
FROM w;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q8 — new-member retention by a reply to the intro within 24 h (signups Jun 4 - Aug 31)
-- ─────────────────────────────────────────────────────────────────────────
SELECT CASE WHEN replied THEN 'reply_within_24h' ELSE 'no_reply_24h' END AS grp, count(*) AS members,
 round(avg(retained_d30::INT), 4) AS d30_on_or_after, round(avg(active_d30_week::INT), 4) AS d30_week_30_36
FROM intro_reply WHERE t0 < TIMESTAMP '2026-09-01' GROUP BY 1 ORDER BY 1;
SELECT round(avg(replied::INT), 4) AS share_of_intros_replied_24h, count(*) AS intros FROM intro_reply WHERE ti < TIMESTAMP '2026-09-30 23:59:59';
SELECT 'no_intro' AS grp, count(*) AS members,
 round(avg(EXISTS (SELECT 1 FROM actions a WHERE a.uid = s.uid AND a.t >= s.t0 + INTERVAL 30 DAY)::INT), 4) AS d30_on_or_after
FROM signups s WHERE s.t0 < TIMESTAMP '2026-09-01' AND s.ti IS NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q9 — new editors whose first edit was reverted: edited again within 30 days
-- ─────────────────────────────────────────────────────────────────────────
SELECT CASE WHEN reverted THEN 'first_edit_reverted' ELSE 'first_edit_kept' END AS grp, count(*) AS new_editors,
 sum(edited_again_30d::INT) AS edited_again, round(avg(edited_again_30d::INT), 4) AS edited_again_within_30d
FROM new_editors WHERE t1 < TIMESTAMP '2026-09-01' GROUP BY 1 ORDER BY 1;
SELECT round(avg(reverted::INT), 4) AS share_first_edits_reverted, count(*) AS new_editors FROM new_editors WHERE t1 < TIMESTAMP '2026-09-30';

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q10 — ad load change: impressions per free article view, revenue per day, before vs after Sep 2
-- ─────────────────────────────────────────────────────────────────────────
WITH v AS (SELECT t::DATE AS d, count(*) AS page_views FROM ev WHERE event = 'article viewed' AND membership = 'free' GROUP BY 1),
w AS (SELECT date::DATE AS d, sum(ad_impressions) AS imp, sum(ad_revenue_usd) AS rev FROM wh_ads GROUP BY 1)
SELECT CASE WHEN d < DATE '2026-09-02' THEN '1_jun4_sep1' WHEN d < DATE '2026-09-09' THEN '2_sep2_8' ELSE '3_sep9_oct1' END AS period, count(*) AS days,
 round(avg(page_views), 1) AS free_article_views_per_day, round(avg(imp), 0) AS impressions_per_day,
 round(sum(imp) / sum(page_views), 2) AS impressions_per_free_view, round(avg(rev), 2) AS ad_revenue_per_day,
 round(sum(rev) / sum(imp) * 1000, 3) AS effective_ecpm
FROM v JOIN w USING (d) GROUP BY 1 ORDER BY 1;
-- four full weeks before (Aug 3-30, includes the Starfall surge) vs after (Sep 3-30); and July 1-28 as a quieter baseline
WITH v AS (SELECT t::DATE AS d, count(*) AS page_views FROM ev WHERE event = 'article viewed' AND membership = 'free' GROUP BY 1),
w AS (SELECT date::DATE AS d, sum(ad_impressions) AS imp, sum(ad_revenue_usd) AS rev FROM wh_ads GROUP BY 1)
SELECT CASE WHEN d BETWEEN DATE '2026-07-01' AND DATE '2026-07-28' THEN '1_jul1_28' WHEN d BETWEEN DATE '2026-08-03' AND DATE '2026-08-30' THEN '2_aug3_30' ELSE '3_sep3_30' END AS period,
 round(sum(rev), 2) AS ad_revenue_4wk, round(avg(page_views), 1) AS free_views_per_day, round(sum(imp) / sum(page_views), 2) AS impressions_per_free_view
FROM v JOIN w USING (d) WHERE d BETWEEN DATE '2026-07-01' AND DATE '2026-07-28' OR d BETWEEN DATE '2026-08-03' AND DATE '2026-08-30' OR d BETWEEN DATE '2026-09-03' AND DATE '2026-09-30'
GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q11 — did free members read less after Sep 2? weekly average article views per viewer, and views per search
-- ─────────────────────────────────────────────────────────────────────────
WITH wk AS (SELECT date_trunc('week', t)::DATE AS week, membership, count(*)::DOUBLE / count(DISTINCT uid) AS avg_per_viewer
  FROM ev WHERE event = 'article viewed' AND t >= TIMESTAMP '2026-06-08' AND t < TIMESTAMP '2026-09-28' GROUP BY 1, 2)
SELECT membership,
 round(avg(avg_per_viewer) FILTER (WHERE week BETWEEN DATE '2026-06-08' AND DATE '2026-07-27'), 2) AS weekly_avg_jun8_aug2,
 round(avg(avg_per_viewer) FILTER (WHERE week BETWEEN DATE '2026-09-07' AND DATE '2026-09-21'), 2) AS weekly_avg_sep7_27,
 round(avg(avg_per_viewer) FILTER (WHERE week BETWEEN DATE '2026-09-07' AND DATE '2026-09-21') / avg(avg_per_viewer) FILTER (WHERE week BETWEEN DATE '2026-06-08' AND DATE '2026-07-27'), 3) AS ratio
FROM wk GROUP BY 1 ORDER BY 1;
WITH g AS (SELECT membership, (t >= TIMESTAMP '2026-09-02') AS post,
  count(*) FILTER (WHERE event = 'article viewed') AS article_views, count(*) FILTER (WHERE event = 'search performed') AS searches
  FROM ev WHERE event IN ('article viewed', 'search performed') GROUP BY 1, 2)
SELECT membership, round(max(article_views::DOUBLE / searches) FILTER (WHERE NOT post), 3) AS views_per_search_before,
 round(max(article_views::DOUBLE / searches) FILTER (WHERE post), 3) AS views_per_search_after,
 round(max(article_views::DOUBLE / searches) FILTER (WHERE post) / max(article_views::DOUBLE / searches) FILTER (WHERE NOT post), 3) AS after_before
FROM g GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q12 — Plus upgrades: visits, conversion per visit, subscriptions per week
-- ─────────────────────────────────────────────────────────────────────────
WITH p AS (SELECT uid, t AS t0 FROM ev WHERE event = 'plus page viewed'),
b AS (SELECT uid, min(t) AS t1 FROM ev WHERE event = 'plus subscribed' GROUP BY 1)
SELECT CASE WHEN p.t0 < TIMESTAMP '2026-09-02' THEN '1_jun4_sep1' WHEN p.t0 >= TIMESTAMP '2026-09-09' THEN '3_sep9_oct1' ELSE '2_sep2_8' END AS period,
 count(*) AS upgrade_page_visits, round(count(*) / (max(p.t0)::DATE - min(p.t0)::DATE + 1)::DOUBLE, 1) AS visits_per_day,
 sum(coalesce(b.t1 >= p.t0 AND b.t1 < p.t0 + INTERVAL 1 DAY, false)::INT) AS converted_visits,
 round(avg(coalesce(b.t1 >= p.t0 AND b.t1 < p.t0 + INTERVAL 1 DAY, false)::INT), 4) AS conversion_per_visit
FROM p LEFT JOIN b ON b.uid = p.uid GROUP BY 1 ORDER BY 1;
SELECT CASE WHEN t < TIMESTAMP '2026-09-02' THEN '1_jun4_sep1' WHEN t >= TIMESTAMP '2026-09-09' THEN '3_sep9_oct1' ELSE '2_sep2_8' END AS period,
 count(*) AS plus_subscriptions, round(count(*) * 7.0 / (max(t)::DATE - min(t)::DATE + 1), 1) AS per_week
FROM ev WHERE event = 'plus subscribed' GROUP BY 1 ORDER BY 1;
SELECT upgrade_trigger, count(*) FILTER (WHERE t < TIMESTAMP '2026-09-02') AS visits_before, count(*) FILTER (WHERE t >= TIMESTAMP '2026-09-09') AS visits_after
FROM ev WHERE event = 'plus page viewed' GROUP BY 1 ORDER BY 1;
SELECT count(*) FILTER (WHERE membership = 'plus') AS plus_members_now, count(*) AS profiles, round(avg((membership = 'plus')::INT), 4) AS plus_share FROM users;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q13 — cost per signup by paid channel (window), and by month
-- ─────────────────────────────────────────────────────────────────────────
SELECT s.ch AS acquisition_channel, count(*) AS signups, round(sp.spend, 2) AS spend_usd, round(sp.spend / count(*), 2) AS spend_per_signup,
 round(sp.leads, 0) AS platform_reported_signups, round(sp.spend / sp.leads, 2) AS spend_per_platform_signup
FROM signups s JOIN (SELECT acquisition_channel, sum(spend_usd) AS spend, sum(platform_reported_signups) AS leads FROM wh_marketing GROUP BY 1) sp ON sp.acquisition_channel = s.ch
GROUP BY s.ch, sp.spend, sp.leads ORDER BY 1;
WITH m AS (SELECT acquisition_channel AS ch, strftime(date::DATE, '%Y-%m') AS mon, sum(spend_usd) AS spend FROM wh_marketing GROUP BY 1, 2),
s AS (SELECT ch, strftime(t0, '%Y-%m') AS mon, count(*) AS signups FROM signups WHERE ch IN ('reddit_ads', 'tiktok_ads', 'youtube_creators') GROUP BY 1, 2)
SELECT m.ch, m.mon, round(m.spend, 2) AS spend, s.signups, round(m.spend / s.signups, 2) AS spend_per_signup FROM m JOIN s USING (ch, mon) WHERE m.mon <= '2026-09' ORDER BY 1, 2;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q14 — cost per onboarded member and day-30 retention by paid channel
-- ─────────────────────────────────────────────────────────────────────────
SELECT s.ch AS acquisition_channel, count(*) AS signups, sum(onboarded::INT) AS onboarded, round(avg(onboarded::INT), 4) AS onboarding_rate,
 round(sp.spend / count(*), 2) AS spend_per_signup, round(sp.spend / sum(onboarded::INT), 2) AS spend_per_onboarded
FROM signups s JOIN (SELECT acquisition_channel, sum(spend_usd) AS spend FROM wh_marketing GROUP BY 1) sp ON sp.acquisition_channel = s.ch
GROUP BY s.ch, sp.spend ORDER BY 1;
SELECT ch, count(*) AS signups_to_aug31,
 round(avg(EXISTS (SELECT 1 FROM actions a WHERE a.uid = s.uid AND a.t >= s.t0 + INTERVAL 30 DAY)::INT), 4) AS d30_on_or_after
FROM signups s WHERE s.t0 < TIMESTAMP '2026-09-01' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q15 — Fandom Fest: participation by event, fest Thu-Sun vs the same days a week before and after
-- ─────────────────────────────────────────────────────────────────────────
WITH x AS (SELECT event,
  CASE WHEN t >= TIMESTAMP '2026-09-17' AND t < TIMESTAMP '2026-09-21' THEN 'fest'
       WHEN (t >= TIMESTAMP '2026-09-10' AND t < TIMESTAMP '2026-09-14') OR (t >= TIMESTAMP '2026-09-24' AND t < TIMESTAMP '2026-09-28') THEN 'base' END AS p
  FROM ev WHERE event IN ('media uploaded', 'discussion posted', 'comment posted', 'upvote given', 'article viewed', 'search performed', 'account created'))
SELECT event, count(*) FILTER (WHERE p = 'fest') AS fest_thu_sun, count(*) FILTER (WHERE p = 'base') / 2.0 AS avg_neighbor_thu_sun,
 round(count(*) FILTER (WHERE p = 'fest')::DOUBLE / (count(*) FILTER (WHERE p = 'base') / 2.0), 3) AS lift
FROM x WHERE p IS NOT NULL GROUP BY 1
UNION ALL
SELECT 'PARTICIPATION (4 events)', count(*) FILTER (WHERE p = 'fest' AND event IN ('media uploaded', 'discussion posted', 'comment posted', 'upvote given')),
 count(*) FILTER (WHERE p = 'base' AND event IN ('media uploaded', 'discussion posted', 'comment posted', 'upvote given')) / 2.0,
 round(count(*) FILTER (WHERE p = 'fest' AND event IN ('media uploaded', 'discussion posted', 'comment posted', 'upvote given'))::DOUBLE
   / (count(*) FILTER (WHERE p = 'base' AND event IN ('media uploaded', 'discussion posted', 'comment posted', 'upvote given')) / 2.0), 3)
FROM x WHERE p IS NOT NULL ORDER BY 1;
SELECT media_type, count(*) FILTER (WHERE t >= TIMESTAMP '2026-09-17' AND t < TIMESTAMP '2026-09-21') AS fest_uploads FROM ev WHERE event = 'media uploaded' GROUP BY 1 ORDER BY 2 DESC;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q16 — ad revenue by hub: revenue, share, eCPM, revenue per 1,000 free-member article views
-- ─────────────────────────────────────────────────────────────────────────
WITH v AS (SELECT content_hub, count(*) AS page_views FROM ev WHERE event = 'article viewed' AND membership = 'free' GROUP BY 1),
w AS (SELECT content_hub, sum(ad_impressions) AS imp, sum(ad_revenue_usd) AS rev FROM wh_ads GROUP BY 1)
SELECT w.content_hub, round(w.rev, 2) AS ad_revenue_usd, round(w.rev / (SELECT sum(rev) FROM w), 4) AS revenue_share, w.imp AS impressions,
 round(w.rev / w.imp * 1000, 3) AS effective_ecpm, round(w.rev / v.page_views * 1000, 2) AS revenue_per_1000_free_views
FROM w JOIN v USING (content_hub) ORDER BY 2 DESC;
SELECT round(sum(ad_revenue_usd), 2) AS total_ad_revenue, sum(ad_impressions) AS total_impressions FROM wh_ads;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q17 — is the community growing? weekly active members (member actions), new vs established; signups per month
-- ─────────────────────────────────────────────────────────────────────────
WITH a AS (SELECT a.uid, date_trunc('week', a.t)::DATE AS week, (s.uid IS NOT NULL) AS joined_in_window FROM actions a LEFT JOIN signups s ON s.uid = a.uid)
SELECT week, count(DISTINCT uid) AS weekly_active_members, count(DISTINCT uid) FILTER (WHERE joined_in_window) AS of_which_joined_since_jun4
FROM a GROUP BY 1 ORDER BY 1;
SELECT strftime(t0, '%Y-%m') AS month, count(*) AS new_members FROM signups GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q18 — reports: Mixpanel report submitted vs warehouse reports_received, per day and in total
-- ─────────────────────────────────────────────────────────────────────────
WITH m AS (SELECT t::DATE AS d, content_hub, count(*) AS mp FROM ev WHERE event = 'report submitted' GROUP BY 1, 2),
w AS (SELECT date::DATE AS d, content_hub, reports_received AS wh FROM wh_trust)
SELECT sum(coalesce(m.mp, 0)) AS mixpanel_reports, sum(w.wh) AS warehouse_reports, round(sum(w.wh)::DOUBLE / sum(coalesce(m.mp, 0)), 3) AS warehouse_over_mixpanel,
 round(sum(w.wh) / 120.0, 1) AS warehouse_reports_per_day, round(sum(coalesce(m.mp, 0)) / 120.0, 1) AS mixpanel_reports_per_day,
 round(corr(w.wh, coalesce(m.mp, 0)), 3) AS daily_hub_correlation
FROM w LEFT JOIN m ON m.d = w.d AND m.content_hub = w.content_hub;
SELECT count(DISTINCT uid) AS members_who_reported, (SELECT count(DISTINCT uid) FROM actions) AS active_members,
 round(count(*)::DOUBLE / count(DISTINCT uid), 2) AS reports_per_reporter FROM ev WHERE event = 'report submitted';

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q19 — what to worry about: inputs gathered from the stories
-- ─────────────────────────────────────────────────────────────────────────
SELECT 'share of signups from tiktok_ads' AS metric, round(avg((ch = 'tiktok_ads')::INT), 4) AS value FROM signups
UNION ALL SELECT 'onboarding rate tiktok_ads', round(avg(onboarded::INT), 4) FROM signups WHERE ch = 'tiktok_ads'
UNION ALL SELECT 'onboarding rate all', round(avg(onboarded::INT), 4) FROM signups
UNION ALL SELECT 'intros without a reply in 24h', round(1 - avg(replied::INT), 4) FROM intro_reply WHERE ti < TIMESTAMP '2026-09-30 23:59:59'
UNION ALL SELECT 'new editors first edit reverted', round(avg(reverted::INT), 4) FROM new_editors WHERE t1 < TIMESTAMP '2026-09-30'
UNION ALL SELECT 'D30 on-or-after, all new members (signups to Aug 31)', round(avg(EXISTS (SELECT 1 FROM actions a WHERE a.uid = s.uid AND a.t >= s.t0 + INTERVAL 30 DAY)::INT), 4) FROM signups s WHERE s.t0 < TIMESTAMP '2026-09-01';

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q20 — where to focus on new-member retention: D30 by onboarding, reply, and channel groups
-- ─────────────────────────────────────────────────────────────────────────
WITH x AS (SELECT s.uid, s.ch, s.ti IS NOT NULL AS intro, coalesce(r.replied, false) AS replied,
  EXISTS (SELECT 1 FROM actions a WHERE a.uid = s.uid AND a.t >= s.t0 + INTERVAL 30 DAY) AS ret
  FROM signups s LEFT JOIN intro_reply r ON r.uid = s.uid WHERE s.t0 < TIMESTAMP '2026-09-01')
SELECT CASE WHEN NOT intro THEN '1_no_intro' WHEN replied THEN '3_intro_replied_24h' ELSE '2_intro_no_reply_24h' END AS grp, count(*) AS members,
 round(avg(ret::INT), 4) AS d30_on_or_after
FROM x GROUP BY 1 ORDER BY 1;
