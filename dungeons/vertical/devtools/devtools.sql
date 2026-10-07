-- Forgebench (devtools vertical) — story-keyed and eval-keyed DuckDB queries.
--
-- Generate first (repo root):
--   node scripts/verify-runner.mjs dungeons/vertical/devtools/devtools.js verify-devtools
-- Run:
--   duckdb -c ".read dungeons/vertical/devtools/devtools.sql"
-- Against a gzipped export:
--   duckdb -c "SET VARIABLE data_prefix='<dir>/devtools'" -c ".read devtools.sql"
--
-- All times are UTC. Window: 2026-06-04 00:00 to 2026-10-01 23:59:59.

SET VARIABLE data_prefix = COALESCE(getvariable('data_prefix'), 'data/verify-devtools');

-- ─────────────────────────────────────────────────────────────────────────
-- PRELUDE: raw files, identity resolution, warehouse tables
-- ─────────────────────────────────────────────────────────────────────────
-- Identity: new developers sign up with "account created" (the auth event,
-- which carries user_id and device_id). A device resolves to the user seen
-- with it on any event that carries both ids, the way Mixpanel stitches.
-- Every event already carries user_id, so uid = user_id in practice.

CREATE OR REPLACE TEMP TABLE raw_events AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-EVENTS*.json*', sample_size=-1, union_by_name=true);

CREATE OR REPLACE TEMP TABLE users AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-USERS*.json*', sample_size=-1, union_by_name=true);

CREATE OR REPLACE TEMP TABLE orgs AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-org_id-GROUPS*.json*', sample_size=-1, union_by_name=true);

CREATE OR REPLACE TEMP TABLE device_map AS
SELECT device_id, min(user_id::VARCHAR) AS mapped
FROM raw_events WHERE user_id IS NOT NULL AND device_id IS NOT NULL GROUP BY 1;

CREATE OR REPLACE TEMP TABLE ev AS
SELECT coalesce(e.user_id::VARCHAR, m.mapped) AS uid, e.time::TIMESTAMP AS t, e.*
FROM raw_events e LEFT JOIN device_map m ON e.device_id = m.device_id;

CREATE OR REPLACE TEMP TABLE wh_marketing AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-marketing_spend_daily.json*', sample_size=-1, union_by_name=true);
CREATE OR REPLACE TEMP TABLE wh_fleet AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-build_fleet_daily.json*', sample_size=-1, union_by_name=true);
CREATE OR REPLACE TEMP TABLE wh_billing AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-usage_billing_daily.json*', sample_size=-1, union_by_name=true);

-- profile attributes keyed by the resolved user id
CREATE OR REPLACE TEMP TABLE prof AS
SELECT distinct_id::VARCHAR AS uid, org_size, primary_stack, acquisition_channel, role, plan_tier AS current_plan,
 customer_since, "Experiment: Remote Build Cache" AS variant
FROM users;

-- new-developer signups (one per developer who joined in the window)
CREATE OR REPLACE TEMP TABLE signups AS
SELECT uid, t AS t0, acquisition_channel AS ch, signup_method, primary_stack, plan_tier AS signup_plan FROM ev WHERE event = 'account created';

-- onboarding: the first step times after signup, in order, within 7 days (the Mixpanel funnel)
CREATE OR REPLACE TEMP TABLE onboarding AS
WITH r AS (SELECT s.uid, min(e.t) AS t1 FROM signups s JOIN ev e ON e.uid = s.uid AND e.event = 'repository imported' AND e.t >= s.t0 AND e.t < s.t0 + INTERVAL 7 DAY GROUP BY 1),
p AS (SELECT r.uid, min(e.t) AS t2 FROM r JOIN signups s USING (uid) JOIN ev e ON e.uid = r.uid AND e.event = 'pipeline configured' AND e.t >= r.t1 AND e.t < s.t0 + INTERVAL 7 DAY GROUP BY 1),
v AS (SELECT p.uid, min(e.t) AS t3 FROM p JOIN signups s USING (uid) JOIN ev e ON e.uid = p.uid AND e.event = 'preview deployed' AND e.t >= p.t2 AND e.t < s.t0 + INTERVAL 7 DAY GROUP BY 1)
SELECT s.uid, s.t0, s.ch, s.signup_method, s.primary_stack, r.t1 IS NOT NULL AS imported, p.t2 IS NOT NULL AS configured, v.t3 IS NOT NULL AS onboarded
FROM signups s LEFT JOIN r USING (uid) LEFT JOIN p USING (uid) LEFT JOIN v USING (uid);

-- one row per pull request (pr_id is shared by its four steps)
CREATE OR REPLACE TEMP TABLE prs AS
SELECT pr_id, any_value(uid) AS uid, any_value(lines_changed) AS lines, any_value(test_coverage_pct) AS coverage,
 any_value(review_mode) AS review_mode,
 min(t) FILTER (WHERE event = 'pull request opened') AS t_open,
 min(t) FILTER (WHERE event = 'review submitted') AS t_review,
 min(t) FILTER (WHERE event = 'pull request merged') AS t_merge,
 min(t) FILTER (WHERE event = 'production deployed') AS t_deploy,
 any_value(plan_tier) FILTER (WHERE event = 'pull request opened') AS plan_open,
 any_value(plan_tier) FILTER (WHERE event = 'review submitted') AS plan_review,
 any_value(deploy_outcome) FILTER (WHERE event = 'production deployed') AS deploy_outcome
FROM ev WHERE event IN ('pull request opened', 'review submitted', 'pull request merged', 'production deployed') GROUP BY 1;

-- one row per build (build_id is shared by start and finish)
CREATE OR REPLACE TEMP TABLE builds AS
SELECT build_id, any_value(uid) AS uid, any_value(ecosystem) AS ecosystem, any_value(trigger) AS trigger,
 min(t) FILTER (WHERE event = 'build started') AS t_start,
 min(t) FILTER (WHERE event = 'build finished') AS t_finish,
 any_value(build_status) FILTER (WHERE event = 'build finished') AS build_status,
 any_value(failure_stage) FILTER (WHERE event = 'build finished') AS failure_stage,
 any_value(build_duration_sec) FILTER (WHERE event = 'build finished') AS duration_sec,
 any_value(plan_tier) FILTER (WHERE event = 'build started') AS plan_start
FROM ev WHERE event IN ('build started', 'build finished') GROUP BY 1;

-- ═════════════════════════════════════════════════════════════════════════
-- STORIES (H1-H10)
-- ═════════════════════════════════════════════════════════════════════════

-- STORY H1-forge-assist-launch: review → merge time, Forge Assist vs standard
-- (Pro/Team/Enterprise, reviews on or after 2026-07-29); knob 0.6
SELECT review_mode, count(*) AS prs, round(median(date_diff('second', t_review, t_merge)) / 3600.0, 2) AS median_merge_h,
 round(avg(date_diff('second', t_review, t_merge)) / 3600.0, 2) AS avg_merge_h
FROM prs WHERE t_review IS NOT NULL AND t_merge IS NOT NULL AND t_review >= TIMESTAMP '2026-07-29' AND plan_review IN ('pro', 'team', 'enterprise')
GROUP BY 1 ORDER BY 1;
-- STORY H1 (purity + plateau): assisted rows before launch or on Free (0); assisted share of eligible PRs opened from 2026-08-26 (knob 0.40)
SELECT count(*) FILTER (WHERE review_mode = 'forge_assist' AND (t < TIMESTAMP '2026-07-29' OR plan_tier = 'free')) AS impure_rows FROM ev
WHERE event IN ('pull request opened', 'review submitted', 'pull request merged', 'production deployed');
SELECT round(avg((review_mode = 'forge_assist')::INT), 4) AS assist_share, count(*) AS prs
FROM ev WHERE event = 'pull request opened' AND t >= TIMESTAMP '2026-08-26' AND plan_tier IN ('pro', 'team', 'enterprise');

-- STORY H2-remote-build-cache-experiment: median successful build time and success rate by arm (knob 0.6; success unchanged)
SELECT p.variant, count(DISTINCT b.uid) AS developers, count(*) AS builds, round(avg((b.build_status = 'success')::INT), 4) AS success_rate,
 median(b.duration_sec) FILTER (WHERE b.build_status = 'success') AS median_success_sec
FROM builds b JOIN prof p ON p.uid = b.uid
WHERE b.t_finish IS NOT NULL AND b.t_finish >= TIMESTAMP '2026-07-08' AND p.variant IS NOT NULL GROUP BY 1 ORDER BY 1;

-- STORY H3-jvm-dotnet-onboarding-friction: 7-day onboarding completion, Java/.NET vs other stacks (knob 0.55)
SELECT CASE WHEN primary_stack IN ('java', 'dotnet') THEN 'java_dotnet' ELSE 'other_stacks' END AS stack_group,
 count(*) AS signups, round(avg(onboarded::INT), 4) AS onboarding_rate
FROM onboarding GROUP BY 1 ORDER BY 1;

-- STORY H4-large-pr-review-wait: median open → first review, by PR size (knob 2.5 for 1,000+ vs ≤100 lines)
SELECT CASE WHEN lines <= 100 THEN 'a: <=100' WHEN lines >= 1000 THEN 'c: 1000+' ELSE 'b: 101-999' END AS pr_size,
 count(*) AS prs, round(median(date_diff('second', t_open, t_review)) / 3600.0, 2) AS median_wait_h
FROM prs WHERE t_open IS NOT NULL AND t_review IS NOT NULL GROUP BY 1 ORDER BY 1;

-- STORY H5-first-build-red-churn: D30 retention by first-build status (first build within 14 days of signup;
-- signups at least 37 days before the end); knob passed/failed = 2.0
WITH s AS (SELECT uid, t0 FROM signups WHERE t0 < TIMESTAMP '2026-10-01 23:59:59' - INTERVAL 37 DAY),
fb AS (SELECT s.uid, arg_min(b.build_status, b.t_finish) AS first_status, min(b.t_finish) AS tb
  FROM s JOIN builds b ON b.uid = s.uid AND b.t_finish >= s.t0 GROUP BY 1),
f AS (SELECT s.uid, fb.first_status, count(e.t) FILTER (WHERE e.t >= s.t0 + INTERVAL 30 DAY AND e.t < s.t0 + INTERVAL 37 DAY) AS ret
  FROM s JOIN fb ON fb.uid = s.uid AND fb.tb < s.t0 + INTERVAL 14 DAY JOIN ev e ON e.uid = s.uid GROUP BY 1, 2)
SELECT first_status, count(*) AS developers, round(avg((ret > 0)::INT), 4) AS d30_retention FROM f GROUP BY 1 ORDER BY 1;

-- STORY H6-npm-registry-incident: npm vs other ecosystems' build success, degraded days vs the 7 days either side (knob 0.40)
WITH o AS (SELECT DISTINCT date::DATE AS d FROM wh_fleet WHERE registry_mirror_status = 'degraded'),
w AS (SELECT t_finish::DATE AS d, ecosystem = 'npm' AS npm, build_status = 'success' AS ok FROM builds
  WHERE t_finish >= TIMESTAMP '2026-08-12' AND t_finish < TIMESTAMP '2026-08-28'),
g AS (SELECT d IN (SELECT d FROM o) AS degraded, avg(ok::INT) FILTER (WHERE npm) AS npm_success, avg(ok::INT) FILTER (WHERE NOT npm) AS other_success FROM w GROUP BY 1)
SELECT degraded, round(npm_success, 4) AS npm_success, round(other_success, 4) AS other_success, round(npm_success / other_success, 4) AS relative FROM g ORDER BY 1;
SELECT date, ecosystem, registry_mirror_status, dependency_fetch_error_rate FROM wh_fleet WHERE registry_mirror_status = 'degraded' ORDER BY 1, 2;

-- STORY H7-paid-channel-economics: spend per Mixpanel signup (knob social/search = 55/85) and onboarding by channel (knob 0.6)
WITH s AS (SELECT ch, count(*) AS signups, avg(onboarded::INT) AS onboarding_rate FROM onboarding GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM wh_marketing GROUP BY 1)
SELECT s.ch, s.signups, round(s.onboarding_rate, 4) AS onboarding_rate, round(sp.spend, 2) AS spend_usd,
 round(sp.spend / s.signups, 2) AS spend_per_signup, round(sp.spend / (s.signups * s.onboarding_rate), 2) AS spend_per_onboarded
FROM s LEFT JOIN sp USING (ch) ORDER BY spend_per_signup NULLS LAST, s.ch;

-- STORY H8-team-overage-billing: scheduled builds per push build, Sep 15-30 vs August, Team vs other plans (knob 0.5; control 1.0)
WITH b AS (SELECT CASE WHEN plan_tier = 'team' THEN 'team' ELSE 'other_plans' END AS grp, t >= TIMESTAMP '2026-09-15' AS post, trigger
  FROM ev WHERE event = 'build started' AND ((t >= TIMESTAMP '2026-08-01' AND t < TIMESTAMP '2026-09-01') OR (t >= TIMESTAMP '2026-09-15' AND t < TIMESTAMP '2026-10-01'))),
r AS (SELECT grp, post, count(*) FILTER (WHERE trigger = 'schedule')::DOUBLE / count(*) FILTER (WHERE trigger = 'push') AS sched_per_push FROM b GROUP BY 1, 2)
SELECT grp, round(max(sched_per_push) FILTER (WHERE NOT post), 4) AS august, round(max(sched_per_push) FILTER (WHERE post), 4) AS sep_15_30,
 round(max(sched_per_push) FILTER (WHERE post) / max(sched_per_push) FILTER (WHERE NOT post), 4) AS ratio
FROM r GROUP BY 1 ORDER BY 1;
SELECT plan_tier, count(*) FILTER (WHERE overage_revenue_usd > 0) AS days_with_overage, min(date) FILTER (WHERE overage_revenue_usd > 0) AS first_day,
 round(sum(overage_revenue_usd), 2) AS overage_revenue_usd FROM wh_billing GROUP BY 1 ORDER BY 1;
-- allowances reset on the 1st: Team overage on days 1-3 of a month (0) and Team days Sep 8-30 without overage (0)
SELECT count(*) FILTER (WHERE day(date) <= 3 AND overage_revenue_usd > 0) AS month_start_overage_days,
 count(*) FILTER (WHERE date >= DATE '2026-09-08' AND date < DATE '2026-10-01' AND overage_revenue_usd <= 0) AS missing_overage_days
FROM wh_billing WHERE plan_tier = 'team';

-- STORY H9-test-coverage-rollbacks: rollback rate by repository coverage (knob ≤30% / ≥75% = 4.0)
SELECT CASE WHEN test_coverage_pct <= 30 THEN 'a: <=30%' WHEN test_coverage_pct >= 75 THEN 'c: >=75%' ELSE 'b: 31-74%' END AS coverage,
 count(*) AS deploys, round(avg((deploy_outcome = 'rolled_back')::INT), 4) AS rollback_rate
FROM ev WHERE event = 'production deployed' GROUP BY 1 ORDER BY 1;

-- STORY H10-preview-habit-converts: paid within 42 days by preview deploys in the first 14 days
-- (Free signups through 2026-08-20; developers who join a Team or Enterprise workspace have nothing to buy); keep-ratio floor 2.5
WITH s AS (SELECT uid, t0 FROM signups WHERE signup_plan = 'free' AND t0 < TIMESTAMP '2026-08-20 23:59:59'),
f AS (SELECT s.uid, count(*) FILTER (WHERE e.event = 'preview deployed' AND e.t < s.t0 + INTERVAL 14 DAY) AS previews,
  count(*) FILTER (WHERE e.event = 'subscription started' AND e.t < s.t0 + INTERVAL 42 DAY) AS buys
  FROM s JOIN ev e ON e.uid = s.uid GROUP BY 1)
SELECT CASE WHEN previews >= 3 THEN 'habit (3+)' WHEN previews >= 1 THEN 'light (1-2)' ELSE 'none (not onboarded)' END AS preview_group,
 count(*) AS developers, round(avg((buys > 0)::INT), 4) AS paid_rate
FROM f GROUP BY 1 ORDER BY 1;
-- STORY H10 (controlled read): purchases per upgrade-page visit in the first 42 days, same cohorts (knob 2.5)
WITH s AS (SELECT uid, t0 FROM signups WHERE signup_plan = 'free' AND t0 < TIMESTAMP '2026-08-20 23:59:59'),
f AS (SELECT s.uid, count(*) FILTER (WHERE e.event = 'preview deployed' AND e.t < s.t0 + INTERVAL 14 DAY) AS previews,
  count(*) FILTER (WHERE e.event = 'upgrade page viewed' AND e.t < s.t0 + INTERVAL 42 DAY) AS visits,
  count(*) FILTER (WHERE e.event = 'subscription started' AND e.t < s.t0 + INTERVAL 42 DAY) AS buys
  FROM s JOIN ev e ON e.uid = s.uid GROUP BY 1)
SELECT CASE WHEN previews >= 3 THEN 'habit (3+)' WHEN previews >= 1 THEN 'light (1-2)' ELSE 'none (not onboarded)' END AS preview_group,
 count(*) FILTER (WHERE visits > 0) AS visitors, sum(visits) AS visits, sum(buys) AS buys, round(sum(buys)::DOUBLE / sum(visits), 4) AS buys_per_visit
FROM f GROUP BY 1 ORDER BY 1;

-- ═════════════════════════════════════════════════════════════════════════
-- EVAL (Q1-Q20) — every number in eval/devtools.eval.md comes from these
-- ═════════════════════════════════════════════════════════════════════════

-- EVAL Q1 — Forge Assist and merge speed: review → merge by mode (eligible plans, reviews from launch),
-- then blended eligible vs Free before/after launch
SELECT review_mode, count(*) AS prs, round(median(date_diff('second', t_review, t_merge)) / 3600.0, 2) AS median_h,
 round(avg(date_diff('second', t_review, t_merge)) / 3600.0, 2) AS avg_h
FROM prs WHERE t_review IS NOT NULL AND t_merge IS NOT NULL AND t_review >= TIMESTAMP '2026-07-29' AND plan_review IN ('pro', 'team', 'enterprise')
GROUP BY 1 ORDER BY 1;
SELECT CASE WHEN plan_review = 'free' THEN 'free' ELSE 'pro_team_enterprise' END AS plan_group, t_review >= TIMESTAMP '2026-07-29' AS after_launch, count(*) AS prs,
 round(median(date_diff('second', t_review, t_merge)) / 3600.0, 2) AS median_h, round(avg(date_diff('second', t_review, t_merge)) / 3600.0, 2) AS avg_h
FROM prs WHERE t_review IS NOT NULL AND t_merge IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 2;

-- EVAL Q2 — Forge Assist adoption: weekly share of eligible PRs opened with review_mode = forge_assist
SELECT date_trunc('week', t)::DATE AS week, count(*) AS eligible_prs, round(avg((review_mode = 'forge_assist')::INT), 4) AS assist_share
FROM ev WHERE event = 'pull request opened' AND t >= TIMESTAMP '2026-07-27' AND plan_tier IN ('pro', 'team', 'enterprise') GROUP BY 1 ORDER BY 1;
SELECT count(DISTINCT uid) FILTER (WHERE review_mode = 'forge_assist') AS assist_authors, count(DISTINCT uid) AS eligible_authors,
 round(avg((review_mode = 'forge_assist')::INT) FILTER (WHERE t >= TIMESTAMP '2026-08-26'), 4) AS share_from_aug_26
FROM ev WHERE event = 'pull request opened' AND t >= TIMESTAMP '2026-07-29' AND plan_tier IN ('pro', 'team', 'enterprise');

-- EVAL Q3 — do Forge Assist PRs roll back less? (null) PRs opened from launch on eligible plans that deployed
SELECT review_mode, count(*) AS deploys, sum((deploy_outcome = 'rolled_back')::INT) AS rollbacks, round(avg((deploy_outcome = 'rolled_back')::INT), 4) AS rollback_rate
FROM prs WHERE t_deploy IS NOT NULL AND t_open >= TIMESTAMP '2026-07-29' AND plan_open IN ('pro', 'team', 'enterprise') GROUP BY 1 ORDER BY 1;
SELECT plan_open, review_mode, count(*) AS deploys, round(avg((deploy_outcome = 'rolled_back')::INT), 4) AS rollback_rate
FROM prs WHERE t_deploy IS NOT NULL AND t_open >= TIMESTAMP '2026-07-29' AND plan_open IN ('pro', 'team', 'enterprise') GROUP BY 1, 2 ORDER BY 1, 2;

-- EVAL Q4 — Remote Build Cache experiment: build time, success rate, volume per developer, split
SELECT p.variant, count(DISTINCT b.uid) AS developers, count(*) AS builds, round(avg((b.build_status = 'success')::INT), 4) AS success_rate,
 median(b.duration_sec) FILTER (WHERE b.build_status = 'success') AS median_success_sec,
 round(avg(b.duration_sec) FILTER (WHERE b.build_status = 'success'), 1) AS avg_success_sec,
 round(count(*)::DOUBLE / count(DISTINCT b.uid), 2) AS builds_per_developer
FROM builds b JOIN prof p ON p.uid = b.uid WHERE b.t_finish >= TIMESTAMP '2026-07-08' AND p.variant IS NOT NULL GROUP BY 1 ORDER BY 1;
SELECT "Variant name" AS variant, count(DISTINCT uid) AS exposed_developers FROM ev WHERE event = '$experiment_started' GROUP BY 1 ORDER BY 1;

-- EVAL Q5 — where new signups stall: 7-day onboarding by stack, step by step
SELECT primary_stack, count(*) AS signups, round(avg(imported::INT), 4) AS imported, round(avg(configured::INT), 4) AS configured, round(avg(onboarded::INT), 4) AS onboarded
FROM onboarding GROUP BY 1 ORDER BY onboarded;
SELECT CASE WHEN primary_stack IN ('java', 'dotnet') THEN 'java_dotnet' ELSE 'other_stacks' END AS stack_group, count(*) AS signups,
 round(avg(imported::INT), 4) AS imported, round(avg(configured::INT), 4) AS configured, round(avg(onboarded::INT), 4) AS onboarded
FROM onboarding GROUP BY 1 ORDER BY 1;
SELECT count(*) AS signups, round(avg(onboarded::INT), 4) AS overall_onboarding FROM onboarding;

-- EVAL Q6 — do enterprise orgs wait longer for code review? (null)
SELECT p.org_size, count(*) AS prs, round(median(date_diff('second', t_open, t_review)) / 3600.0, 2) AS median_wait_h,
 round(avg(date_diff('second', t_open, t_review)) / 3600.0, 2) AS avg_wait_h, median(lines) AS median_lines
FROM prs JOIN prof p ON p.uid = prs.uid WHERE t_open IS NOT NULL AND t_review IS NOT NULL GROUP BY 1 ORDER BY 1;
-- log wait time by org size (Welch z vs startups)
WITH w AS (SELECT p.org_size, ln(date_diff('second', t_open, t_review) / 3600.0) AS lw FROM prs JOIN prof p ON p.uid = prs.uid WHERE t_open IS NOT NULL AND t_review IS NOT NULL),
g AS (SELECT org_size, avg(lw) AS m, var_samp(lw) AS v, count(*) AS n FROM w GROUP BY 1)
SELECT g.org_size, round(g.m, 4) AS mean_log_wait, round((g.m - s.m) / sqrt(g.v / g.n + s.v / s.n), 2) AS z_vs_startup FROM g, g s WHERE s.org_size = 'startup' ORDER BY 1;
-- the same check inside each plan (plan at the PR's open): enterprise vs startup log wait
WITH w AS (SELECT prs.plan_open AS plan, p.org_size, ln(date_diff('second', t_open, t_review) / 3600.0) AS lw FROM prs JOIN prof p ON p.uid = prs.uid WHERE t_open IS NOT NULL AND t_review IS NOT NULL),
g AS (SELECT plan, org_size, avg(lw) AS m, var_samp(lw) AS v, count(*) AS n FROM w GROUP BY 1, 2)
SELECT g.plan, g.n AS enterprise_prs, s.n AS startup_prs, round((g.m - s.m) / sqrt(g.v / g.n + s.v / s.n), 2) AS z_enterprise_vs_startup
FROM g JOIN g s ON s.plan = g.plan AND s.org_size = 'startup' WHERE g.org_size = 'enterprise' ORDER BY 1;

-- EVAL Q7 — review wait by PR size
SELECT CASE WHEN lines <= 100 THEN 'a: <=100' WHEN lines < 400 THEN 'b: 101-399' WHEN lines < 1000 THEN 'c: 400-999' ELSE 'd: 1000+' END AS pr_size,
 count(*) AS prs, round(count(*) * 100.0 / sum(count(*)) OVER (), 1) AS pct_of_prs, round(median(date_diff('second', t_open, t_review)) / 3600.0, 2) AS median_wait_h
FROM prs WHERE t_open IS NOT NULL AND t_review IS NOT NULL GROUP BY 1 ORDER BY 1;
-- the same read from review_wait_hours on review submitted (Insights median by lines_changed)
SELECT CASE WHEN lines_changed <= 100 THEN 'a: <=100' WHEN lines_changed < 1000 THEN 'b: 101-999' ELSE 'c: 1000+' END AS pr_size,
 count(*) AS reviews, median(review_wait_hours) AS median_review_wait_hours
FROM ev WHERE event = 'review submitted' GROUP BY 1 ORDER BY 1;

-- EVAL Q8 — first CI build and retention (first build within 14 days; signups at least 37 days before the end)
WITH s AS (SELECT uid, t0 FROM signups WHERE t0 < TIMESTAMP '2026-10-01 23:59:59' - INTERVAL 37 DAY),
fb AS (SELECT s.uid, arg_min(b.build_status, b.t_finish) AS first_status, min(b.t_finish) AS tb FROM s JOIN builds b ON b.uid = s.uid AND b.t_finish >= s.t0 GROUP BY 1),
f AS (SELECT s.uid, fb.first_status,
  count(e.t) FILTER (WHERE e.t >= s.t0 + INTERVAL 7 DAY AND e.t < s.t0 + INTERVAL 14 DAY) AS ret7,
  count(e.t) FILTER (WHERE e.t >= s.t0 + INTERVAL 30 DAY AND e.t < s.t0 + INTERVAL 37 DAY) AS ret30
  FROM s JOIN fb ON fb.uid = s.uid AND fb.tb < s.t0 + INTERVAL 14 DAY JOIN ev e ON e.uid = s.uid GROUP BY 1, 2)
SELECT first_status, count(*) AS developers, round(avg((ret7 > 0)::INT), 4) AS d7_retention, round(avg((ret30 > 0)::INT), 4) AS d30_retention FROM f GROUP BY 1 ORDER BY 1;
WITH fb AS (SELECT s.uid, s.t0, arg_min(b.build_status, b.t_finish) AS first_status, arg_min(b.failure_stage, b.t_finish) AS first_stage, min(b.t_finish) AS tb
  FROM signups s JOIN builds b ON b.uid = s.uid AND b.t_finish >= s.t0 GROUP BY 1, 2)
SELECT count(*) AS new_devs_with_first_build_in_14d, round(avg((first_status = 'failed')::INT), 4) AS first_build_fail_rate,
 round(avg((first_stage = 'configuration')::INT) FILTER (WHERE first_status = 'failed'), 4) AS configuration_share_of_failures
FROM fb WHERE tb < t0 + INTERVAL 14 DAY;
SELECT round(avg((build_status = 'failed')::INT), 4) AS all_build_fail_rate FROM builds WHERE build_status IS NOT NULL;
-- all new signups (through Aug 25): day-1, day 7-13, and day 30-36 activity
WITH s AS (SELECT uid, t0 FROM signups WHERE t0 < TIMESTAMP '2026-10-01 23:59:59' - INTERVAL 37 DAY),
f AS (SELECT s.uid, count(e.t) FILTER (WHERE e.t >= s.t0 + INTERVAL 1 DAY AND e.t < s.t0 + INTERVAL 2 DAY) AS r1,
  count(e.t) FILTER (WHERE e.t >= s.t0 + INTERVAL 7 DAY AND e.t < s.t0 + INTERVAL 14 DAY) AS r7,
  count(e.t) FILTER (WHERE e.t >= s.t0 + INTERVAL 30 DAY AND e.t < s.t0 + INTERVAL 37 DAY) AS r30
  FROM s LEFT JOIN ev e ON e.uid = s.uid GROUP BY 1)
SELECT count(*) AS signups, round(avg((r1 > 0)::INT), 4) AS d1_active, round(avg((r7 > 0)::INT), 4) AS d7_13_active, round(avg((r30 > 0)::INT), 4) AS d30_36_active FROM f;

-- EVAL Q9 — mid-August build failures: daily success by ecosystem, lost builds, warehouse status
SELECT t_finish::DATE AS d, ecosystem = 'npm' AS npm, count(*) AS builds, round(avg((build_status = 'success')::INT), 4) AS success_rate,
 round(avg((failure_stage = 'dependency_install')::INT), 4) AS dependency_install_failures
FROM builds WHERE t_finish >= TIMESTAMP '2026-08-17' AND t_finish < TIMESTAMP '2026-08-22' GROUP BY 1, 2 ORDER BY 1, 2;
WITH w AS (SELECT (t_finish >= TIMESTAMP '2026-08-19' AND t_finish < TIMESTAMP '2026-08-21') AS inc, ecosystem = 'npm' AS npm, build_status = 'success' AS ok
  FROM builds WHERE t_finish >= TIMESTAMP '2026-08-12' AND t_finish < TIMESTAMP '2026-08-28')
SELECT count(*) FILTER (WHERE inc AND npm) AS npm_incident_builds, round(avg(ok::INT) FILTER (WHERE inc AND npm), 4) AS npm_incident_success,
 round(avg(ok::INT) FILTER (WHERE NOT inc AND npm), 4) AS npm_surrounding_success,
 round(count(*) FILTER (WHERE inc AND npm) * (avg(ok::INT) FILTER (WHERE NOT inc AND npm) - avg(ok::INT) FILTER (WHERE inc AND npm))) AS lost_successful_builds
FROM w;
SELECT date, ecosystem, registry_mirror_status, dependency_fetch_error_rate FROM wh_fleet WHERE registry_mirror_status = 'degraded' ORDER BY 1;
SELECT max(dependency_fetch_error_rate) FILTER (WHERE registry_mirror_status = 'operational') AS max_normal_error_rate FROM wh_fleet;

-- EVAL Q10 — did other ecosystems fail on dependency downloads during the incident? (null outside npm)
WITH w AS (SELECT (t_finish >= TIMESTAMP '2026-08-19' AND t_finish < TIMESTAMP '2026-08-21') AS inc, ecosystem, build_status = 'success' AS ok,
  failure_stage = 'dependency_install' AS dep, failure_stage IN ('test', 'compile') AS code_fail
  FROM builds WHERE t_finish >= TIMESTAMP '2026-08-12' AND t_finish < TIMESTAMP '2026-08-28')
SELECT ecosystem, count(*) FILTER (WHERE inc) AS incident_builds, round(avg(ok::INT) FILTER (WHERE inc), 4) AS incident_success,
 round(avg(ok::INT) FILTER (WHERE NOT inc), 4) AS surrounding_success,
 round(avg(dep::INT) FILTER (WHERE inc), 4) AS incident_dependency_fail, round(avg(dep::INT) FILTER (WHERE NOT inc), 4) AS surrounding_dependency_fail,
 round(avg(code_fail::INT) FILTER (WHERE inc), 4) AS incident_test_compile_fail, round(avg(code_fail::INT) FILTER (WHERE NOT inc), 4) AS surrounding_test_compile_fail
FROM w GROUP BY 1 ORDER BY 1;
WITH w AS (SELECT (t_finish >= TIMESTAMP '2026-08-19' AND t_finish < TIMESTAMP '2026-08-21') AS inc, build_status = 'success' AS ok, failure_stage = 'dependency_install' AS dep
  FROM builds WHERE ecosystem <> 'npm' AND t_finish >= TIMESTAMP '2026-08-12' AND t_finish < TIMESTAMP '2026-08-28')
SELECT count(*) FILTER (WHERE inc) AS incident_builds, round(avg(ok::INT) FILTER (WHERE inc), 4) AS incident_success,
 count(*) FILTER (WHERE NOT inc) AS surrounding_builds, round(avg(ok::INT) FILTER (WHERE NOT inc), 4) AS surrounding_success,
 round(avg(dep::INT) FILTER (WHERE inc), 4) AS incident_dependency_fail, round(avg(dep::INT) FILTER (WHERE NOT inc), 4) AS surrounding_dependency_fail FROM w;
SELECT ecosystem, max(dependency_fetch_error_rate) AS max_error_rate, string_agg(DISTINCT registry_mirror_status, ',') AS statuses
FROM wh_fleet WHERE date >= DATE '2026-08-19' AND date < DATE '2026-08-21' GROUP BY 1 ORDER BY 1;
-- baseline over every other day of the window: dependency-install failure rate outside npm, incident days vs the rest
WITH w AS (SELECT ecosystem, (t_finish >= TIMESTAMP '2026-08-19' AND t_finish < TIMESTAMP '2026-08-21') AS inc, failure_stage = 'dependency_install' AS dep
  FROM builds WHERE ecosystem <> 'npm' AND build_status IS NOT NULL)
SELECT coalesce(ecosystem, 'all non-npm') AS ecosystem, count(*) FILTER (WHERE inc) AS incident_builds, sum(dep::INT) FILTER (WHERE inc) AS incident_dependency_failures,
 round(avg(dep::INT) FILTER (WHERE inc), 4) AS incident_dependency_fail, round(avg(dep::INT) FILTER (WHERE NOT inc), 4) AS window_dependency_fail,
 round((avg(dep::INT) FILTER (WHERE inc) - avg(dep::INT) FILTER (WHERE NOT inc))
   / sqrt(avg(dep::INT) FILTER (WHERE NOT inc) * (1 - avg(dep::INT) FILTER (WHERE NOT inc)) / count(*) FILTER (WHERE inc)), 2) AS z_vs_window
FROM w GROUP BY ROLLUP (ecosystem) ORDER BY ecosystem NULLS FIRST;

-- EVAL Q11 — spend per Mixpanel signup by paid channel
WITH s AS (SELECT ch, count(*) AS signups FROM signups GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend, sum(platform_reported_signups) AS platform_signups,
  min(spend_usd) AS min_daily_spend, max(spend_usd) AS max_daily_spend FROM wh_marketing GROUP BY 1)
SELECT sp.ch, s.signups, round(sp.spend, 2) AS spend_usd, round(sp.spend / s.signups, 2) AS spend_per_signup, sp.platform_signups,
 round(min_daily_spend, 2) AS min_daily_spend, round(max_daily_spend, 2) AS max_daily_spend
FROM sp JOIN s USING (ch) ORDER BY spend_per_signup;
SELECT round(sum(spend_usd), 2) AS total_paid_spend FROM wh_marketing;

-- EVAL Q12 — cost per onboarded developer by paid channel
WITH s AS (SELECT ch, count(*) AS signups, sum(onboarded::INT) AS onboarded FROM onboarding GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM wh_marketing GROUP BY 1)
SELECT s.ch, s.signups, s.onboarded, round(s.onboarded::DOUBLE / s.signups, 4) AS onboarding_rate,
 round(sp.spend / s.signups, 2) AS spend_per_signup, round(sp.spend / s.onboarded, 2) AS spend_per_onboarded
FROM s LEFT JOIN sp USING (ch) ORDER BY spend_per_onboarded NULLS LAST, s.ch;

-- EVAL Q13 — Team overage billing: scheduled builds per push build, weekly, Team vs other plans
WITH b AS (SELECT plan_tier = 'team' AS team, date_trunc('week', t)::DATE AS week, trigger FROM ev WHERE event = 'build started' AND t >= TIMESTAMP '2026-08-03')
SELECT week, round(count(*) FILTER (WHERE team AND trigger = 'schedule')::DOUBLE / count(*) FILTER (WHERE team AND trigger = 'push'), 4) AS team_sched_per_push,
 round(count(*) FILTER (WHERE NOT team AND trigger = 'schedule')::DOUBLE / count(*) FILTER (WHERE NOT team AND trigger = 'push'), 4) AS other_sched_per_push,
 count(*) FILTER (WHERE team AND trigger = 'schedule') AS team_scheduled_builds
FROM b GROUP BY 1 ORDER BY 1;
WITH b AS (SELECT plan_tier, t >= TIMESTAMP '2026-09-15' AS post, trigger FROM ev WHERE event = 'build started'
  AND ((t >= TIMESTAMP '2026-08-01' AND t < TIMESTAMP '2026-09-01') OR (t >= TIMESTAMP '2026-09-15' AND t < TIMESTAMP '2026-10-01')))
SELECT plan_tier, round(count(*) FILTER (WHERE NOT post AND trigger = 'schedule')::DOUBLE / count(*) FILTER (WHERE NOT post AND trigger = 'push'), 4) AS august,
 round(count(*) FILTER (WHERE post AND trigger = 'schedule')::DOUBLE / count(*) FILTER (WHERE post AND trigger = 'push'), 4) AS sep_15_30,
 round(count(*) FILTER (WHERE NOT post AND trigger = 'push') / 31.0, 1) AS august_push_per_day, round(count(*) FILTER (WHERE post AND trigger = 'push') / 16.0, 1) AS sep_15_30_push_per_day
FROM b GROUP BY 1 ORDER BY 1;

-- EVAL Q14 — Team overage revenue and runner minutes by month (warehouse)
SELECT date_trunc('month', date)::DATE AS month, round(sum(billable_runner_minutes)) AS runner_minutes, round(sum(overage_minutes)) AS overage_minutes,
 round(sum(overage_revenue_usd), 2) AS overage_revenue_usd
FROM wh_billing WHERE plan_tier = 'team' GROUP BY 1 ORDER BY 1;
SELECT round(sum(overage_revenue_usd) / sum(billable_runner_minutes) * 1000, 3) AS overage_usd_per_1000_minutes_sep FROM wh_billing WHERE plan_tier = 'team' AND date >= '2026-09-01' AND date < '2026-10-01';
-- the build-up through September (Monday weeks; the last row is Sep 28-30 plus Oct 1, which bills nothing)
SELECT date_trunc('week', date)::DATE AS week, min(date) FILTER (WHERE overage_minutes > 0) AS first_overage_day, round(sum(overage_revenue_usd), 2) AS overage_revenue_usd
FROM wh_billing WHERE plan_tier = 'team' AND date >= DATE '2026-08-31' GROUP BY 1 ORDER BY 1;

-- EVAL Q15 — rollbacks by repository test coverage
SELECT CASE WHEN test_coverage_pct <= 30 THEN 'a: <=30%' WHEN test_coverage_pct < 50 THEN 'b: 31-49%' WHEN test_coverage_pct < 75 THEN 'c: 50-74%' ELSE 'd: >=75%' END AS coverage,
 count(*) AS deploys, sum((deploy_outcome = 'rolled_back')::INT) AS rollbacks, round(avg((deploy_outcome = 'rolled_back')::INT), 4) AS rollback_rate
FROM ev WHERE event = 'production deployed' GROUP BY 1 ORDER BY 1;
SELECT count(*) AS deploys, round(avg((deploy_outcome = 'rolled_back')::INT), 4) AS overall_rollback_rate FROM ev WHERE event = 'production deployed';

-- EVAL Q16 — what predicts buying a paid seat: preview deploys in the first 14 days (Free signups through Aug 20, purchase within 42 days)
WITH s AS (SELECT uid, t0 FROM signups WHERE signup_plan = 'free' AND t0 < TIMESTAMP '2026-08-20 23:59:59'),
f AS (SELECT s.uid, count(*) FILTER (WHERE e.event = 'preview deployed' AND e.t < s.t0 + INTERVAL 14 DAY) AS previews,
  count(*) FILTER (WHERE e.event = 'subscription started' AND e.t < s.t0 + INTERVAL 42 DAY) AS buys
  FROM s JOIN ev e ON e.uid = s.uid GROUP BY 1)
SELECT least(previews, 5) AS previews_first_14d, count(*) AS developers, round(avg((buys > 0)::INT), 4) AS paid_rate FROM f GROUP BY 1 ORDER BY 1;
WITH s AS (SELECT uid, t0 FROM signups WHERE signup_plan = 'free' AND t0 < TIMESTAMP '2026-08-20 23:59:59'),
f AS (SELECT s.uid, count(*) FILTER (WHERE e.event = 'preview deployed' AND e.t < s.t0 + INTERVAL 14 DAY) AS previews,
  count(*) FILTER (WHERE e.event = 'subscription started' AND e.t < s.t0 + INTERVAL 42 DAY) AS buys
  FROM s JOIN ev e ON e.uid = s.uid GROUP BY 1)
SELECT CASE WHEN previews >= 3 THEN 'habit (3+)' WHEN previews >= 1 THEN 'light (1-2)' ELSE 'none (not onboarded)' END AS preview_group,
 count(*) AS developers, sum((buys > 0)::INT) AS buyers, round(avg((buys > 0)::INT), 4) AS paid_rate FROM f GROUP BY 1 ORDER BY 1;
-- reach and purchases per visit: upgrade-page visits in the first 42 days, and over the whole window (the Insights formula B/A)
WITH s AS (SELECT uid, t0 FROM signups WHERE signup_plan = 'free' AND t0 < TIMESTAMP '2026-08-20 23:59:59'),
f AS (SELECT s.uid, count(*) FILTER (WHERE e.event = 'preview deployed' AND e.t < s.t0 + INTERVAL 14 DAY) AS previews,
  count(*) FILTER (WHERE e.event = 'upgrade page viewed' AND e.t < s.t0 + INTERVAL 42 DAY) AS visits_42d,
  count(*) FILTER (WHERE e.event = 'upgrade page viewed') AS visits_all,
  count(*) FILTER (WHERE e.event = 'subscription started') AS buys
  FROM s JOIN ev e ON e.uid = s.uid GROUP BY 1)
SELECT CASE WHEN previews >= 3 THEN 'habit (3+)' WHEN previews >= 1 THEN 'light (1-2)' ELSE 'none (not onboarded)' END AS preview_group,
 count(*) AS developers, round(avg((visits_42d > 0)::INT), 4) AS reached_upgrade_page_42d, sum(buys) AS buys,
 round(sum(buys)::DOUBLE / sum(visits_42d), 4) AS buys_per_visit_42d, round(sum(buys)::DOUBLE / sum(visits_all), 4) AS buys_per_visit_all
FROM f GROUP BY 1 ORDER BY 1;
-- the same split without the Free filter (all signups through Aug 20)
WITH s AS (SELECT uid, t0 FROM signups WHERE t0 < TIMESTAMP '2026-08-20 23:59:59'),
f AS (SELECT s.uid, count(*) FILTER (WHERE e.event = 'preview deployed' AND e.t < s.t0 + INTERVAL 14 DAY) AS previews,
  count(*) FILTER (WHERE e.event = 'subscription started' AND e.t < s.t0 + INTERVAL 42 DAY) AS buys
  FROM s JOIN ev e ON e.uid = s.uid GROUP BY 1)
SELECT CASE WHEN previews >= 3 THEN 'habit (3+)' WHEN previews >= 1 THEN 'light (1-2)' ELSE 'none (not onboarded)' END AS preview_group,
 count(*) AS developers, round(avg((buys > 0)::INT), 4) AS paid_rate FROM f GROUP BY 1 ORDER BY 1;

-- EVAL Q17 — the Labor Day dip: builds and active developers, Mondays around Sep 7 (and July 3 vs other Fridays)
SELECT t::DATE AS d, dayname(t::DATE) AS dow, count(*) FILTER (WHERE event = 'build started') AS builds_started, count(DISTINCT uid) AS active_developers
FROM ev WHERE t::DATE IN ('2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-06-26', '2026-07-03', '2026-07-10', '2026-07-17') GROUP BY 1, 2 ORDER BY 1;
-- user-initiated work (pushes, PRs opened, non-scheduled builds) by developer location: each holiday vs the same weekday one week either side
WITH w AS (SELECT t::DATE AS d, (country_code = 'US') AS us FROM ev WHERE event IN ('commit pushed', 'pull request opened') OR (event = 'build started' AND trigger <> 'schedule')),
h AS (SELECT * FROM (VALUES (DATE '2026-07-03', 'Jul 3 Independence Day (observed)'), (DATE '2026-09-07', 'Sep 7 Labor Day')) v(hd, holiday))
SELECT holiday, CASE WHEN us THEN 'US' ELSE 'outside US' END AS location, count(*) FILTER (WHERE d = hd) AS on_holiday,
 round(count(*) FILTER (WHERE d IN (hd - 7, hd + 7)) / 2.0, 1) AS same_weekday_avg,
 round(count(*) FILTER (WHERE d = hd) / (count(*) FILTER (WHERE d IN (hd - 7, hd + 7)) / 2.0) - 1, 3) AS change
FROM w, h GROUP BY ALL ORDER BY 1, 2;
SELECT round(avg((country_code = 'US')::INT), 3) AS us_share_of_developers FROM users;

-- EVAL Q18 — new self-serve subscriptions and new MRR by month (list prices from 01-business.md: Pro $12, Team $29 per seat per month)
SELECT date_trunc('month', t)::DATE AS month, plan, count(*) AS subscriptions, sum(seats) AS seats,
 sum(seats * CASE plan WHEN 'pro' THEN 12 WHEN 'team' THEN 29 END) AS new_mrr_usd
FROM ev WHERE event = 'subscription started' GROUP BY 1, 2 ORDER BY 1, 2;
SELECT date_trunc('month', t)::DATE AS month, count(*) AS subscriptions, sum(seats * CASE plan WHEN 'pro' THEN 12 WHEN 'team' THEN 29 END) AS new_mrr_usd,
 count(*) FILTER (WHERE uid IN (SELECT uid FROM signups)) AS from_window_signups
FROM ev WHERE event = 'subscription started' GROUP BY 1 ORDER BY 1;

-- EVAL Q19 — do larger PRs roll back more? (null)
SELECT CASE WHEN lines_changed <= 100 THEN 'a: <=100' WHEN lines_changed < 1000 THEN 'b: 101-999' ELSE 'c: 1000+' END AS pr_size,
 count(*) AS deploys, round(avg((deploy_outcome = 'rolled_back')::INT), 4) AS rollback_rate, round(avg(test_coverage_pct), 1) AS avg_coverage
FROM ev WHERE event = 'production deployed' GROUP BY 1 ORDER BY 1;

-- EVAL Q20 — headline numbers for the quarter review
SELECT count(DISTINCT uid) AS developers_with_events, (SELECT count(*) FROM signups) AS new_signups, (SELECT count(*) FROM raw_events) AS events FROM ev;
SELECT date_trunc('week', t)::DATE AS week, count(DISTINCT uid) AS weekly_active_developers FROM ev WHERE t >= TIMESTAMP '2026-06-08' AND t < TIMESTAMP '2026-09-28' GROUP BY 1 ORDER BY 1;
