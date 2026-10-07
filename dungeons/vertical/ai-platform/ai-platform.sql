-- Cortexa (ai-platform vertical) — story-keyed and eval-keyed DuckDB queries.
--
-- Generate first (repo root):
--   node scripts/verify-runner.mjs dungeons/vertical/ai-platform/ai-platform.js verify-ai-platform
-- Run:
--   duckdb -c ".read dungeons/vertical/ai-platform/ai-platform.sql"
-- Against a gzipped export:
--   duckdb -c "SET VARIABLE data_prefix='<dir>/ai-platform'" -c ".read ai-platform.sql"
--
-- All times are UTC. Window: 2026-06-04 00:00 to 2026-10-01 23:59:59.
-- One "api request" event is a 1-in-1,000 sample of API traffic; warehouse
-- tables meter every request.

SET VARIABLE data_prefix = COALESCE(getvariable('data_prefix'), 'data/verify-ai-platform');

-- ─────────────────────────────────────────────────────────────────────────
-- PRELUDE: raw files, identity resolution, warehouse tables
-- ─────────────────────────────────────────────────────────────────────────
-- Identity: Cortexa tracks every event server-side with the account's user_id
-- and there is no device_id, so Mixpanel's distinct_id is user_id on every
-- event. New accounts are identified at "account created" (their first event).

CREATE OR REPLACE TEMP TABLE raw_events AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-EVENTS*.json*', sample_size=-1, union_by_name=true);

CREATE OR REPLACE TEMP TABLE users AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-USERS*.json*', sample_size=-1, union_by_name=true);

CREATE OR REPLACE TEMP TABLE ev AS
SELECT user_id::VARCHAR AS uid, time::TIMESTAMP AS t, * FROM raw_events;

CREATE OR REPLACE TEMP TABLE wh_fleet AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-inference_fleet_daily.json*', sample_size=-1, union_by_name=true);
CREATE OR REPLACE TEMP TABLE wh_billing AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-model_billing_daily.json*', sample_size=-1, union_by_name=true);
CREATE OR REPLACE TEMP TABLE wh_marketing AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-developer_marketing_daily.json*', sample_size=-1, union_by_name=true);

-- profile attributes keyed by the resolved user id
CREATE OR REPLACE TEMP TABLE prof AS
SELECT distinct_id::VARCHAR AS uid, plan_tier AS current_plan, company_size, use_case, sdk_language,
 acquisition_channel, inference_region, primary_role, customer_since,
 "Experiment: Interactive Quickstart" AS variant
FROM users;

-- new accounts (one signup per account that joined in the window)
CREATE OR REPLACE TEMP TABLE signups AS
SELECT uid, t AS t0, acquisition_channel AS ch, signup_method FROM ev WHERE event = 'account created';

-- onboarding: account created → api key created → first api request after the key, 7-day window
CREATE OR REPLACE TEMP TABLE onboarding AS
WITH k AS (SELECT uid, min(t) AS tk FROM ev WHERE event = 'api key created' GROUP BY 1),
r AS (SELECT e.uid, min(e.t) AS tr FROM ev e JOIN k ON k.uid = e.uid AND e.t >= k.tk WHERE e.event = 'api request' GROUP BY 1)
SELECT s.uid, s.t0, s.ch, p.sdk_language, p.variant, r.tr,
 coalesce(k.tk >= s.t0 AND r.tr < s.t0 + INTERVAL 7 DAY, false) AS converted
FROM signups s JOIN prof p ON p.uid = s.uid LEFT JOIN k ON k.uid = s.uid LEFT JOIN r ON r.uid = s.uid;

-- one row per batch job, paired on batch_id
CREATE OR REPLACE TEMP TABLE batches AS
SELECT s.uid, s.batch_id, s.plan_tier, s.t AS t_sub, c.t AS t_done, c.batch_status
FROM (SELECT * FROM ev WHERE event = 'batch job submitted') s
JOIN (SELECT * FROM ev WHERE event = 'batch job completed') c ON c.batch_id = s.batch_id;

-- request log
CREATE OR REPLACE TEMP TABLE requests AS
SELECT * FROM ev WHERE event = 'api request';

-- dataset overview
SELECT count(*) AS events, count(DISTINCT uid) AS accounts_with_events, (SELECT count(*) FROM users) AS profiles,
 (SELECT count(*) FROM signups) AS new_accounts, min(t) AS first_event, max(t) AS last_event FROM ev;

-- identity check: every event carries user_id
SELECT count(*) FILTER (WHERE uid IS NULL) AS events_without_user_id FROM ev;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H1-prompt-caching-launch — caching GA 2026-07-08; hits cut time to first token (expected 0.561x on
-- plain requests); 35% of requests once ramped
-- ─────────────────────────────────────────────────────────────────────────
SELECT count(*) FILTER (WHERE cache_hit AND t < TIMESTAMP '2026-07-08') AS hits_before_launch FROM requests;
SELECT cache_hit, count(*) AS requests, round(avg(time_to_first_token_ms), 0) AS avg_ttft_ms,
 round(avg(time_to_first_token_ms) / (SELECT avg(time_to_first_token_ms) FROM requests WHERE status_code = 200 AND NOT tool_use AND t >= TIMESTAMP '2026-07-08' AND NOT cache_hit), 4) AS vs_miss
FROM requests WHERE status_code = 200 AND NOT tool_use AND t >= TIMESTAMP '2026-07-08' GROUP BY 1 ORDER BY 1;
SELECT round(avg(cache_hit::INT), 4) AS hit_share_after_ramp FROM requests WHERE t >= TIMESTAMP '2026-07-29';

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H2-atlas-3-launch — 2026-07-28 paid, 2026-09-08 Free; 39% of paid flagship traffic; 1.3x output
-- ─────────────────────────────────────────────────────────────────────────
SELECT count(*) FILTER (WHERE model = 'atlas-3' AND (t < TIMESTAMP '2026-07-28' OR (plan_tier = 'free' AND t < TIMESTAMP '2026-09-08'))) AS impure_rows FROM requests;
SELECT round(avg((model = 'atlas-3')::INT), 4) AS atlas3_share_paid_flagship
FROM requests WHERE model IN ('atlas-2', 'atlas-3') AND plan_tier IN ('build', 'scale', 'enterprise') AND t >= TIMESTAMP '2026-08-18';
SELECT round(avg((model = 'atlas-3')::INT), 4) AS atlas3_share_free_flagship
FROM requests WHERE model IN ('atlas-2', 'atlas-3') AND plan_tier = 'free' AND t >= TIMESTAMP '2026-09-18';
SELECT model, round(avg(output_tokens), 1) AS avg_output_tokens
FROM requests WHERE status_code = 200 AND model IN ('atlas-2', 'atlas-3') AND plan_tier IN ('build', 'scale', 'enterprise') AND t >= TIMESTAMP '2026-07-28'
GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H3-interactive-quickstart-experiment — onboarding A/B from 2026-07-01
-- ─────────────────────────────────────────────────────────────────────────
SELECT variant, count(*) AS signups, round(avg(converted::INT), 4) AS first_request_rate,
 round(median(date_diff('second', t0, tr)) FILTER (WHERE converted) / 3600.0, 2) AS median_hours_to_first_request
FROM onboarding WHERE variant IS NOT NULL GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H4-batch-turnaround-by-plan — Scale/Enterprise 0.4x, Free 1.6x the Build turnaround
-- ─────────────────────────────────────────────────────────────────────────
SELECT plan_tier, count(*) AS jobs, round(median(date_diff('second', t_sub, t_done)) / 3600.0, 2) AS median_hours
FROM batches GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H5-early-evals-retention — 2+ eval runs in the first 14 days → D30 retention
-- ─────────────────────────────────────────────────────────────────────────
-- New accounts that made an API request; activity excludes the system-sent
-- batch job completed / eval run completed. early_evals >= 2 equals completing
-- the Mixpanel funnel account created → eval run started → eval run started
-- with a 14-day window.
CREATE OR REPLACE TEMP TABLE eval_retention AS
WITH s AS (SELECT uid, t0 FROM signups WHERE uid IN (SELECT uid FROM ev WHERE event = 'api request')
  AND t0 < TIMESTAMP '2026-10-01 23:59:59' - INTERVAL 37 DAY)
SELECT s.uid,
 count(*) FILTER (WHERE e.event = 'eval run started' AND e.t < s.t0 + INTERVAL 14 DAY) AS early_evals,
 count(*) FILTER (WHERE e.t >= s.t0 + INTERVAL 30 DAY AND e.t < s.t0 + INTERVAL 37 DAY AND e.event NOT IN ('batch job completed', 'eval run completed')) > 0 AS d30
FROM s JOIN ev e ON e.uid = s.uid GROUP BY 1;

SELECT CASE WHEN early_evals >= 2 THEN '2+' ELSE early_evals::VARCHAR END AS early_eval_runs, count(*) AS accounts,
 round(avg(d30::INT), 4) AS d30_retention
FROM eval_retention GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H6-us-east-capacity-incident — us-east 2026-08-26..27 (warehouse join)
-- ─────────────────────────────────────────────────────────────────────────
WITH o AS (SELECT DISTINCT date::DATE AS d, inference_region FROM wh_fleet WHERE region_status = 'major_outage'),
w AS (SELECT t::DATE AS d, (inference_region IN (SELECT inference_region FROM o)) AS hit, (status_code = 200) AS ok
  FROM requests WHERE t >= TIMESTAMP '2026-08-19' AND t < TIMESTAMP '2026-09-04'),
g AS (SELECT (d IN (SELECT d FROM o)) AS outage, avg(ok::INT) FILTER (WHERE hit) AS hit_success, avg(ok::INT) FILTER (WHERE NOT hit) AS other_success FROM w GROUP BY 1)
SELECT outage, round(hit_success, 4) AS affected_region_success, round(other_success, 4) AS other_region_success,
 round(hit_success / other_success, 4) AS relative_success FROM g ORDER BY outage;

SELECT inference_region, count(*) FILTER (WHERE region_status = 'major_outage') AS outage_days,
 round(avg(error_rate_5xx) FILTER (WHERE region_status = 'major_outage'), 4) AS outage_error_rate
FROM wh_fleet GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H7-swift-price-cut — swift-2 price halved 2026-08-18; Build swift share 1.6x
-- ─────────────────────────────────────────────────────────────────────────
SELECT plan_tier, round(avg((model = 'swift-2')::INT) FILTER (WHERE t < TIMESTAMP '2026-08-18'), 4) AS swift_share_before,
 round(avg((model = 'swift-2')::INT) FILTER (WHERE t >= TIMESTAMP '2026-09-01'), 4) AS swift_share_september,
 round(avg((model = 'swift-2')::INT) FILTER (WHERE t >= TIMESTAMP '2026-09-01') / avg((model = 'swift-2')::INT) FILTER (WHERE t < TIMESTAMP '2026-08-18'), 4) AS shift
FROM requests GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H8-agent-tool-use — tool requests carry 2.5x input tokens; agents 60% tool use
-- ─────────────────────────────────────────────────────────────────────────
SELECT tool_use, count(*) AS requests, round(avg(input_tokens), 0) AS avg_input_tokens FROM requests WHERE status_code = 200 GROUP BY 1 ORDER BY 1;
SELECT p.use_case, round(avg(r.tool_use::INT), 4) AS tool_share FROM requests r JOIN prof p ON p.uid = r.uid GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H9-developer-marketing-economics — spend per signup and upgrade rate by channel (warehouse join)
-- ─────────────────────────────────────────────────────────────────────────
WITH s AS (SELECT ch, count(*) AS n FROM signups GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM wh_marketing GROUP BY 1)
SELECT s.ch, s.n AS signups, round(sp.spend, 0) AS spend_usd, round(sp.spend / s.n, 2) AS spend_per_signup
FROM s JOIN sp ON sp.ch = s.ch ORDER BY 1;

-- 30-day paid conversion: Mixpanel funnel account created → plan upgraded, 30-day window, signups 2026-06-04..08-31
CREATE OR REPLACE TEMP TABLE paid_funnel AS
WITH s AS (SELECT uid, t0, ch FROM signups WHERE t0 < TIMESTAMP '2026-09-01'),
b AS (SELECT DISTINCT s.uid FROM s JOIN ev e ON e.uid = s.uid AND e.event = 'plan upgraded'
  AND e.t >= s.t0 AND e.t < s.t0 + INTERVAL 30 DAY)
SELECT s.uid, s.ch, (b.uid IS NOT NULL) AS bought FROM s LEFT JOIN b ON b.uid = s.uid;

SELECT round(avg(bought::INT) FILTER (WHERE ch = 'hackathons') / avg(bought::INT) FILTER (WHERE ch = 'search_ads'), 4) AS hackathons_vs_search_paid_rate
FROM paid_funnel;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H10-build-rate-limit-raise — Build rate-limit episodes per request 0.4x from 2026-09-01
-- (September vs the whole pre-period Jun 4 - Aug 31, relative to Free)
-- ─────────────────────────────────────────────────────────────────────────
WITH g AS (SELECT plan_tier, t >= TIMESTAMP '2026-09-01' AS post,
  count(*) FILTER (WHERE event = 'rate limit hit')::DOUBLE / count(*) FILTER (WHERE event = 'api request') AS per_request
  FROM ev WHERE event IN ('rate limit hit', 'api request') AND t < TIMESTAMP '2026-10-01' GROUP BY 1, 2)
SELECT round((max(per_request) FILTER (WHERE plan_tier = 'build' AND post) / max(per_request) FILTER (WHERE plan_tier = 'build' AND NOT post))
 / (max(per_request) FILTER (WHERE plan_tier = 'free' AND post) / max(per_request) FILTER (WHERE plan_tier = 'free' AND NOT post)), 4) AS build_vs_free_did
FROM g;

-- ═════════════════════════════════════════════════════════════════════════
-- EVAL QUERIES (one per question in eval/ai-platform.eval.md)
-- ═════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q1 — prompt caching: latency effect and adoption
-- ─────────────────────────────────────────────────────────────────────────
-- time to first token and total latency, successful requests since launch, by cache hit
-- (all successful requests, and plain requests without tools where prompt sizes match)
SELECT NOT tool_use AS plain_only, cache_hit, count(*) AS requests,
 round(avg(time_to_first_token_ms), 0) AS avg_ttft_ms, round(median(time_to_first_token_ms), 0) AS median_ttft_ms,
 round(avg(latency_ms), 0) AS avg_latency_ms, round(avg(input_tokens), 0) AS avg_input_tokens
FROM requests WHERE status_code = 200 AND t >= TIMESTAMP '2026-07-08' GROUP BY 1, 2
UNION ALL
SELECT NULL, cache_hit, count(*), round(avg(time_to_first_token_ms), 0), round(median(time_to_first_token_ms), 0), round(avg(latency_ms), 0), round(avg(input_tokens), 0)
FROM requests WHERE status_code = 200 AND t >= TIMESTAMP '2026-07-08' GROUP BY 2 ORDER BY 1 NULLS FIRST, 2;
SELECT date_trunc('week', t)::DATE AS week_start, count(*) AS requests, round(avg(cache_hit::INT), 4) AS hit_share
FROM requests WHERE t >= TIMESTAMP '2026-06-29' GROUP BY 1 ORDER BY 1;
SELECT round(avg(cache_hit::INT), 4) AS hit_share_since_jul29,
 count(DISTINCT uid) FILTER (WHERE cache_hit) AS accounts_with_hits, count(DISTINCT uid) AS accounts_with_requests,
 round(count(DISTINCT uid) FILTER (WHERE cache_hit)::DOUBLE / count(DISTINCT uid), 4) AS account_share
FROM requests WHERE t >= TIMESTAMP '2026-07-29';

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q2 — what caching discounts are worth in billed usage (warehouse)
-- ─────────────────────────────────────────────────────────────────────────
-- Cached input tokens bill at 10% of the input price, so the discount is 90% of
-- their list value.
SELECT strftime(date::DATE, '%Y-%m') AS month,
 round(sum(cached_input_tokens_billed) / 1e9, 2) AS cached_input_tokens_billions,
 round(sum(cached_input_tokens_billed * list_price_input_per_mtok * 0.9) / 1e6, 0) AS cache_discount_usd,
 round(sum(usage_value_usd), 0) AS usage_value_usd,
 round(sum(cached_input_tokens_billed * list_price_input_per_mtok * 0.9) / 1e6 / (sum(usage_value_usd) + sum(cached_input_tokens_billed * list_price_input_per_mtok * 0.9) / 1e6), 4) AS discount_share_of_undiscounted
FROM wh_billing GROUP BY 1 ORDER BY 1;
SELECT round(sum(cached_input_tokens_billed * list_price_input_per_mtok * 0.9) / 1e6, 0) AS cache_discount_since_launch_usd
FROM wh_billing WHERE date::DATE >= DATE '2026-07-08';

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q3 — atlas-3 adoption since launch
-- ─────────────────────────────────────────────────────────────────────────
SELECT date_trunc('week', t)::DATE AS week_start,
 round(avg((model = 'atlas-3')::INT) FILTER (WHERE plan_tier IN ('build', 'scale', 'enterprise')), 4) AS paid_flagship_share,
 round(avg((model = 'atlas-3')::INT) FILTER (WHERE plan_tier = 'free'), 4) AS free_flagship_share
FROM requests WHERE model IN ('atlas-2', 'atlas-3') AND t >= TIMESTAMP '2026-07-27' GROUP BY 1 ORDER BY 1;
SELECT round(avg((model = 'atlas-3')::INT), 4) AS atlas3_share_of_all_requests_sep,
 count(DISTINCT uid) FILTER (WHERE model = 'atlas-3') AS accounts_using_atlas3_sep
FROM requests WHERE t >= TIMESTAMP '2026-09-01' AND t < TIMESTAMP '2026-10-01';
SELECT round(avg((model = 'atlas-3')::INT), 4) AS paid_flagship_share_aug18_on
FROM requests WHERE model IN ('atlas-2', 'atlas-3') AND plan_tier IN ('build', 'scale', 'enterprise') AND t >= TIMESTAMP '2026-08-18';

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q4 — is atlas-3 slower than atlas-2, and why?
-- ─────────────────────────────────────────────────────────────────────────
-- Successful requests on paid plans since the atlas-3 launch, split by cache hit
-- so caching (which began three weeks earlier) does not blur the comparison.
SELECT model, cache_hit, count(*) AS requests, round(avg(latency_ms), 0) AS avg_latency_ms, round(median(latency_ms), 0) AS median_latency_ms,
 round(avg(time_to_first_token_ms), 0) AS avg_ttft_ms, round(avg(output_tokens), 0) AS avg_output_tokens,
 round(avg(latency_ms - time_to_first_token_ms) / avg(output_tokens), 2) AS decode_ms_per_output_token
FROM requests WHERE status_code = 200 AND model IN ('atlas-2', 'atlas-3') AND plan_tier IN ('build', 'scale', 'enterprise') AND t >= TIMESTAMP '2026-07-28'
GROUP BY 1, 2 ORDER BY 2, 1;
SELECT round(avg(latency_ms) FILTER (WHERE model = 'atlas-3') / avg(latency_ms) FILTER (WHERE model = 'atlas-2'), 4) AS latency_ratio,
 round(avg(output_tokens) FILTER (WHERE model = 'atlas-3') / avg(output_tokens) FILTER (WHERE model = 'atlas-2'), 4) AS output_ratio
FROM requests WHERE status_code = 200 AND model IN ('atlas-2', 'atlas-3') AND plan_tier IN ('build', 'scale', 'enterprise') AND t >= TIMESTAMP '2026-07-28';
-- weekly median latency of successful paid requests (all models)
SELECT date_trunc('week', t)::DATE AS week_start, round(median(latency_ms), 0) AS median_latency_ms, round(avg(cache_hit::INT), 4) AS hit_share,
 round(avg((model = 'atlas-3')::INT), 4) AS atlas3_share, round(avg((model = 'swift-2')::INT), 4) AS swift_share
FROM requests WHERE status_code = 200 AND plan_tier IN ('build', 'scale', 'enterprise') GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q5 — Interactive Quickstart experiment readout
-- ─────────────────────────────────────────────────────────────────────────
WITH g AS (SELECT variant, count(*) AS n, avg(converted::INT) AS p,
  median(date_diff('second', t0, tr)) FILTER (WHERE converted) / 3600.0 AS med_h FROM onboarding WHERE variant IS NOT NULL GROUP BY 1)
SELECT variant, n AS signups, round(p, 4) AS first_request_rate, round(med_h, 2) AS median_hours,
 round(p / (SELECT p FROM g WHERE variant = 'Control'), 4) AS rate_vs_control,
 round(med_h / (SELECT med_h FROM g WHERE variant = 'Control'), 4) AS time_vs_control
FROM g ORDER BY 1;
SELECT round(avg(converted::INT), 4) AS first_request_rate_before_test, count(*) AS signups FROM onboarding WHERE variant IS NULL;
WITH g AS (SELECT count(*) FILTER (WHERE variant = 'Interactive Quickstart') AS n1, avg(converted::INT) FILTER (WHERE variant = 'Interactive Quickstart') AS p1,
  count(*) FILTER (WHERE variant = 'Control') AS n0, avg(converted::INT) FILTER (WHERE variant = 'Control') AS p0 FROM onboarding)
SELECT round((p1 - p0) / sqrt(p1 * (1 - p1) / n1 + p0 * (1 - p0) / n0), 1) AS z,
 (SELECT round(count(DISTINCT uid) FILTER (WHERE "Variant name" = 'Interactive Quickstart')::DOUBLE / count(DISTINCT uid), 4) FROM ev WHERE event = '$experiment_started') AS variant_share_of_exposed
FROM g;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q6 — null: do Java and Go developers onboard worse?
-- ─────────────────────────────────────────────────────────────────────────
SELECT sdk_language, count(*) AS signups, round(avg(converted::INT), 4) AS first_request_rate FROM onboarding GROUP BY 1 ORDER BY 1;
WITH x AS (SELECT coalesce(variant, 'not_enrolled') AS arm, sdk_language IN ('java', 'go') AS jg, converted::INT AS c FROM onboarding),
g AS (SELECT arm, count(*) FILTER (WHERE jg) AS n1, avg(c) FILTER (WHERE jg) AS p1, count(*) FILTER (WHERE NOT jg) AS n0, avg(c) FILTER (WHERE NOT jg) AS p0 FROM x GROUP BY ROLLUP (arm))
SELECT coalesce(arm, 'all') AS arm, n1 AS java_go, round(p1, 4) AS java_go_rate, n0 AS others, round(p0, 4) AS others_rate,
 round((p1 - p0) / sqrt(p1 * (1 - p1) / n1 + p0 * (1 - p0) / n0), 2) AS z
FROM g ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q7 — batch turnaround by plan
-- ─────────────────────────────────────────────────────────────────────────
SELECT plan_tier, count(*) AS jobs, round(median(date_diff('second', t_sub, t_done)) / 3600.0, 2) AS median_hours,
 round(quantile_cont(date_diff('second', t_sub, t_done), 0.9) / 3600.0, 2) AS p90_hours,
 round(avg((batch_status = 'expired')::INT), 4) AS expired_share
FROM batches GROUP BY 1 ORDER BY 1;
SELECT round(median(date_diff('second', t_sub, t_done)) / 3600.0, 2) AS scale_enterprise_median_hours FROM batches WHERE plan_tier IN ('scale', 'enterprise');

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q8 — early behavior that predicts new-account retention
-- ─────────────────────────────────────────────────────────────────────────
SELECT CASE WHEN early_evals >= 3 THEN '3+' ELSE early_evals::VARCHAR END AS early_eval_runs, count(*) AS accounts,
 round(avg(d30::INT), 4) AS d30_retention
FROM eval_retention GROUP BY 1 ORDER BY 1;
SELECT CASE WHEN early_evals >= 2 THEN '2+' ELSE '0-1' END AS grp, count(*) AS accounts, round(avg(d30::INT), 4) AS d30_retention
FROM eval_retention GROUP BY 1 ORDER BY 1;
SELECT round(avg((early_evals >= 2)::INT), 4) AS share_with_2plus FROM eval_retention;
-- all new accounts with a full day-30 bracket (including those that never made a request)
WITH a AS (SELECT s.uid, s.t0, (s.uid IN (SELECT uid FROM requests)) AS made_request,
  count(e.uid) FILTER (WHERE e.t >= s.t0 + INTERVAL 30 DAY AND e.t < s.t0 + INTERVAL 37 DAY AND e.event NOT IN ('batch job completed', 'eval run completed')) > 0 AS d30
  FROM signups s LEFT JOIN ev e ON e.uid = s.uid WHERE s.t0 < TIMESTAMP '2026-10-01 23:59:59' - INTERVAL 37 DAY GROUP BY 1, 2, 3)
SELECT made_request, count(*) AS accounts, round(avg(d30::INT), 4) AS d30_retention FROM a GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q9 — the August 26-27 errors (warehouse join)
-- ─────────────────────────────────────────────────────────────────────────
SELECT date::DATE AS day, inference_region, requests_served, error_rate_5xx, gpus_online, gpu_utilization, p95_latency_ms, region_status
FROM wh_fleet WHERE date::DATE BETWEEN DATE '2026-08-25' AND DATE '2026-08-28' ORDER BY 1, 2;
SELECT inference_region, (t >= TIMESTAMP '2026-08-26' AND t < TIMESTAMP '2026-08-28') AS incident, count(*) AS sampled_requests,
 round(avg((status_code = 200)::INT), 4) AS success_rate, count(*) FILTER (WHERE status_code = 529) AS overloaded_529
FROM requests WHERE t >= TIMESTAMP '2026-08-19' AND t < TIMESTAMP '2026-09-04' GROUP BY 1, 2 ORDER BY 1, 2;
-- excess failed requests in us-east (sampled events x 1,000), vs the region's success rate on the surrounding days
WITH b AS (SELECT avg((status_code = 200)::INT) AS base FROM requests WHERE inference_region = 'us-east'
  AND ((t >= TIMESTAMP '2026-08-19' AND t < TIMESTAMP '2026-08-26') OR (t >= TIMESTAMP '2026-08-28' AND t < TIMESTAMP '2026-09-04'))),
i AS (SELECT count(*) AS n, avg((status_code = 200)::INT) AS ok FROM requests WHERE inference_region = 'us-east' AND t >= TIMESTAMP '2026-08-26' AND t < TIMESTAMP '2026-08-28')
SELECT i.n AS sampled_requests, round(b.base, 4) AS baseline_success, round(i.ok, 4) AS incident_success,
 round(i.n * (b.base - i.ok)) AS excess_failed_sampled, round(i.n * (b.base - i.ok)) * 1000 AS excess_failed_requests_est
FROM b, i;
SELECT round(avg(latency_ms) FILTER (WHERE inference_region = 'us-east' AND t >= TIMESTAMP '2026-08-26' AND t < TIMESTAMP '2026-08-28'), 0) AS us_east_incident_latency,
 round(avg(latency_ms) FILTER (WHERE inference_region = 'us-east' AND t >= TIMESTAMP '2026-08-19' AND t < TIMESTAMP '2026-08-26'), 0) AS us_east_week_before_latency
FROM requests WHERE status_code = 200;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q10 — null: did the August outage cost us customers?
-- ─────────────────────────────────────────────────────────────────────────
-- Accounts with API traffic in the three weeks before the incident (Aug 5-25):
-- share still sending traffic in the three weeks after (Aug 28 - Sep 17), us-east
-- vs the other regions, by plan at the last request before the incident. Three
-- weeks, because api request is sampled 1 in 1,000 and a low-volume account can
-- go two weeks without a sampled request. The same comparison one month earlier
-- (traffic Jul 8-28, still sending Jul 31 - Aug 20) gives the usual regional
-- gap; the difference in differences is the incident's effect (z treats the two
-- periods as independent). The two-week version (window_days = 14) is shown too.
WITH per AS (SELECT * FROM (VALUES ('incident', TIMESTAMP '2026-08-26'), ('month_before', TIMESTAMP '2026-07-29')) v(period, d0)),
win AS (SELECT * FROM (VALUES (21), (14)) w(window_days)),
a AS (SELECT window_days, period, r.uid, r.inference_region = 'us-east' AS ue, arg_max(r.plan_tier, r.t) FILTER (WHERE r.t < d0) AS plan_tier,
  count(*) FILTER (WHERE r.t >= d0 - to_days(window_days) AND r.t < d0) AS pre,
  count(*) FILTER (WHERE r.t >= d0 + INTERVAL 2 DAY AND r.t < d0 + INTERVAL 2 DAY + to_days(window_days)) AS post
  FROM requests r CROSS JOIN per CROSS JOIN win GROUP BY 1, 2, 3, 4),
g AS (SELECT window_days, period, coalesce(plan_tier, 'all plans') AS plan_tier,
  count(*) FILTER (WHERE pre > 0 AND ue) AS n1, avg((post > 0)::INT) FILTER (WHERE pre > 0 AND ue) AS p1,
  count(*) FILTER (WHERE pre > 0 AND NOT ue) AS n0, avg((post > 0)::INT) FILTER (WHERE pre > 0 AND NOT ue) AS p0,
  sum(post) FILTER (WHERE ue)::DOUBLE / sum(pre) FILTER (WHERE ue) AS v1, sum(post) FILTER (WHERE NOT ue)::DOUBLE / sum(pre) FILTER (WHERE NOT ue) AS v0
  FROM a GROUP BY window_days, period, ROLLUP (plan_tier)),
h AS (SELECT *, p1 - p0 AS gap, p1 * (1 - p1) / n1 + p0 * (1 - p0) / n0 AS var FROM g WHERE n1 > 0)
SELECT i.window_days, i.plan_tier, i.n1 AS us_east_accounts, round(i.p1, 4) AS us_east_still_active, i.n0 AS other_accounts, round(i.p0, 4) AS other_still_active,
 round(i.gap / sqrt(i.var), 2) AS z_raw, round(b.p1, 4) AS us_east_month_before, round(b.p0, 4) AS other_month_before,
 round(100 * (i.gap - b.gap), 2) AS did_points, round((i.gap - b.gap) / sqrt(i.var + b.var), 2) AS z_did,
 round(i.v1, 4) AS us_east_volume_after_before, round(i.v0, 4) AS other_volume_after_before
FROM h i JOIN h b ON b.plan_tier = i.plan_tier AND b.window_days = i.window_days AND b.period = 'month_before' WHERE i.period = 'incident'
ORDER BY i.window_days DESC, i.plan_tier;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q11 — model mix after the swift-2 price cut
-- ─────────────────────────────────────────────────────────────────────────
SELECT plan_tier, round(avg((model = 'swift-2')::INT) FILTER (WHERE t < TIMESTAMP '2026-08-18'), 4) AS swift_share_jun4_aug17,
 round(avg((model = 'swift-2')::INT) FILTER (WHERE t >= TIMESTAMP '2026-09-01' AND t < TIMESTAMP '2026-10-01'), 4) AS swift_share_september,
 round(avg((model = 'swift-2')::INT) FILTER (WHERE t >= TIMESTAMP '2026-09-01' AND t < TIMESTAMP '2026-10-01') / avg((model = 'swift-2')::INT) FILTER (WHERE t < TIMESTAMP '2026-08-18'), 3) AS ratio
FROM requests GROUP BY 1 ORDER BY 1;
SELECT round(avg((model = 'swift-2')::INT) FILTER (WHERE t >= TIMESTAMP '2026-09-01' AND t < TIMESTAMP '2026-10-01') / avg((model = 'swift-2')::INT) FILTER (WHERE t < TIMESTAMP '2026-08-18'), 3) AS all_plans_ratio
FROM requests;
SELECT date_trunc('week', t)::DATE AS week_start, round(avg((model = 'swift-2')::INT), 4) AS build_swift_share
FROM requests WHERE plan_tier = 'build' AND t >= TIMESTAMP '2026-08-03' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q12 — why revenue per day fell after July (warehouse)
-- ─────────────────────────────────────────────────────────────────────────
SELECT strftime(date::DATE, '%Y-%m') AS month, count(DISTINCT date) AS days, model,
 round(sum(revenue_usd) / count(DISTINCT date), 0) AS revenue_per_day, round(sum(requests_billed) / count(DISTINCT date), 0) AS requests_per_day,
 max(list_price_input_per_mtok) AS max_input_price
FROM wh_billing WHERE date::DATE < DATE '2026-10-01' GROUP BY 1, 3 ORDER BY 1, 3;
SELECT strftime(date::DATE, '%Y-%m') AS month, round(sum(revenue_usd) / count(DISTINCT date), 0) AS revenue_per_day,
 round(sum(usage_value_usd) / count(DISTINCT date), 0) AS usage_value_per_day, round(sum(requests_billed) / count(DISTINCT date), 0) AS requests_per_day
FROM wh_billing WHERE date::DATE < DATE '2026-10-01' GROUP BY 1 ORDER BY 1;
-- caching discount per day, flagship vs swift-2 revenue per day, free-credit share of usage value
SELECT strftime(date::DATE, '%Y-%m') AS month,
 round(sum(cached_input_tokens_billed * list_price_input_per_mtok * 0.9) / 1e6 / count(DISTINCT date), 0) AS cache_discount_per_day,
 round(sum(revenue_usd) FILTER (WHERE model IN ('atlas-2', 'atlas-3')) / count(DISTINCT date), 0) AS flagship_revenue_per_day,
 round(sum(requests_billed) FILTER (WHERE model IN ('atlas-2', 'atlas-3')) / count(DISTINCT date), 0) AS flagship_requests_per_day,
 round(sum(revenue_usd) FILTER (WHERE model = 'swift-2') / count(DISTINCT date), 0) AS swift_revenue_per_day,
 round(sum(requests_billed) FILTER (WHERE model = 'swift-2') / count(DISTINCT date), 0) AS swift_requests_per_day,
 round(sum(free_credit_usd) / sum(usage_value_usd), 4) AS free_credit_share
FROM wh_billing WHERE date::DATE < DATE '2026-10-01' GROUP BY 1 ORDER BY 1;
-- counterfactual: September swift-2 usage at the old price
SELECT round(sum(revenue_usd) / 30, 0) AS sep_swift_revenue_per_day,
 round(sum(revenue_usd) * 2 / 30, 0) AS sep_swift_revenue_per_day_at_old_price
FROM wh_billing WHERE model = 'swift-2' AND date::DATE >= DATE '2026-09-01' AND date::DATE < DATE '2026-10-01';

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q13 — who sends the biggest prompts, and why
-- ─────────────────────────────────────────────────────────────────────────
SELECT tool_use, count(*) AS requests, round(avg(input_tokens), 0) AS avg_input_tokens FROM requests WHERE status_code = 200 GROUP BY 1 ORDER BY 1;
SELECT p.use_case, count(*) AS requests, round(avg(r.tool_use::INT), 4) AS tool_share, round(avg(r.input_tokens), 0) AS avg_input_tokens,
 round(count(*)::DOUBLE / sum(count(*)) OVER (), 4) AS request_share, round(sum(r.input_tokens)::DOUBLE / sum(sum(r.input_tokens)) OVER (), 4) AS input_token_share
FROM requests r JOIN prof p ON p.uid = r.uid WHERE r.status_code = 200 GROUP BY 1 ORDER BY 1;
SELECT p.use_case = 'agents' AS agents, r.tool_use, round(avg(r.input_tokens), 0) AS avg_input_tokens
FROM requests r JOIN prof p ON p.uid = r.uid WHERE r.status_code = 200 GROUP BY 1, 2 ORDER BY 1, 2;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q14 — cost per signup by paid channel (warehouse join)
-- ─────────────────────────────────────────────────────────────────────────
WITH s AS (SELECT ch, count(*) AS n FROM signups GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend, sum(platform_reported_signups) AS platform_signups,
  min(spend_usd) AS min_day, max(spend_usd) AS max_day FROM wh_marketing GROUP BY 1)
SELECT s.ch, s.n AS mixpanel_signups, sp.platform_signups, round(sp.spend, 0) AS spend_usd, round(sp.spend / s.n, 2) AS spend_per_signup,
 round(sp.spend / sum(sp.spend) OVER (), 4) AS budget_share, round(min_day, 0) AS min_day_spend, round(max_day, 0) AS max_day_spend
FROM s JOIN sp ON sp.ch = s.ch ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q15 — are hackathons worth it? (30-day paid conversion and cost per paying account)
-- ─────────────────────────────────────────────────────────────────────────
WITH c AS (SELECT ch, count(*) AS signups, count(*) FILTER (WHERE bought) AS buyers, avg(bought::INT) AS rate FROM paid_funnel GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM wh_marketing WHERE date::DATE < DATE '2026-09-01' GROUP BY 1)
SELECT c.ch, c.signups, c.buyers, round(c.rate, 4) AS paid_rate_30d, round(sp.spend, 0) AS spend_jun4_aug31,
 round(sp.spend / c.signups, 2) AS spend_per_signup, round(sp.spend / c.buyers, 0) AS spend_per_paying_account
FROM c LEFT JOIN sp ON sp.ch = c.ch ORDER BY 1;
WITH x AS (SELECT ch, bought::INT AS b FROM paid_funnel WHERE ch IN ('hackathons', 'search_ads')),
g AS (SELECT count(*) FILTER (WHERE ch = 'hackathons') AS n1, avg(b) FILTER (WHERE ch = 'hackathons') AS p1,
  count(*) FILTER (WHERE ch = 'search_ads') AS n0, avg(b) FILTER (WHERE ch = 'search_ads') AS p0 FROM x)
SELECT round(p1 / p0, 4) AS hackathons_vs_search, round((p1 - p0) / sqrt(p1 * (1 - p1) / n1 + p0 * (1 - p0) / n0), 2) AS z FROM g;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q16 — did the September 1 Build rate-limit increase work?
-- ─────────────────────────────────────────────────────────────────────────
SELECT plan_tier, strftime(t, '%Y-%m') AS month, count(*) FILTER (WHERE event = 'rate limit hit') AS episodes,
 count(*) FILTER (WHERE event = 'api request') AS sampled_requests,
 round(1000.0 * count(*) FILTER (WHERE event = 'rate limit hit') / count(*) FILTER (WHERE event = 'api request'), 1) AS episodes_per_1000_sampled_requests
FROM ev WHERE event IN ('rate limit hit', 'api request') AND t < TIMESTAMP '2026-10-01'
GROUP BY 1, 2 ORDER BY 1, 2;
-- September vs the whole pre-period (Jun 4 - Aug 31), per plan, and Build relative to Free
WITH g AS (SELECT plan_tier, t >= TIMESTAMP '2026-09-01' AS post,
  1000.0 * count(*) FILTER (WHERE event = 'rate limit hit') / count(*) FILTER (WHERE event = 'api request') AS per_k
  FROM ev WHERE event IN ('rate limit hit', 'api request') AND t < TIMESTAMP '2026-10-01' GROUP BY 1, 2),
p AS (SELECT plan_tier, round(max(per_k) FILTER (WHERE NOT post), 1) AS per_k_jun4_aug31, round(max(per_k) FILTER (WHERE post), 1) AS per_k_sep,
  max(per_k) FILTER (WHERE post) / max(per_k) FILTER (WHERE NOT post) AS ratio FROM g GROUP BY 1)
SELECT plan_tier, per_k_jun4_aug31, per_k_sep, round(ratio, 4) AS sep_vs_before, round(ratio / (SELECT ratio FROM p WHERE plan_tier = 'free'), 4) AS vs_free FROM p ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q17 — monthly metered usage, free credits, and revenue (warehouse)
-- ─────────────────────────────────────────────────────────────────────────
SELECT strftime(date::DATE, '%Y-%m') AS month, count(DISTINCT date) AS days, round(sum(requests_billed) / 1e6, 1) AS requests_millions,
 round(sum(usage_value_usd), 0) AS usage_value_usd, round(sum(free_credit_usd), 0) AS free_credit_usd, round(sum(revenue_usd), 0) AS revenue_usd,
 round(sum(revenue_usd) / count(DISTINCT date), 0) AS revenue_per_day
FROM wh_billing GROUP BY 1 ORDER BY 1;
SELECT model, round(sum(revenue_usd), 0) AS revenue_usd, round(sum(revenue_usd) / (SELECT sum(revenue_usd) FROM wh_billing), 4) AS share
FROM wh_billing GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q18 — Free → Build upgrades: how many and how fast
-- ─────────────────────────────────────────────────────────────────────────
SELECT count(*) AS upgrades, count(*) FILTER (WHERE uid IN (SELECT uid FROM signups)) AS by_new_accounts FROM ev WHERE event = 'plan upgraded';
SELECT date_trunc('week', t)::DATE AS week_start, count(*) AS upgrades FROM ev WHERE event = 'plan upgraded' GROUP BY 1 ORDER BY 1;
WITH a AS (SELECT s.uid, s.t0, min(e.t) AS tu FROM signups s JOIN ev e ON e.uid = s.uid AND e.event = 'plan upgraded' GROUP BY 1, 2)
SELECT count(*) AS new_account_upgrades, round(median(date_diff('second', t0, tu)) / 86400.0, 2) AS median_days_to_upgrade,
 round(avg((tu < t0 + INTERVAL 7 DAY)::INT), 4) AS share_within_7_days FROM a;
WITH s AS (SELECT o.uid FROM onboarding o WHERE o.converted AND o.t0 < TIMESTAMP '2026-09-01')
SELECT count(*) AS activated_signups_jun4_aug31, round(avg((s.uid IN (SELECT pf.uid FROM paid_funnel pf WHERE pf.bought))::INT), 4) AS paid_30d_rate_activated,
 (SELECT round(avg(bought::INT), 4) FROM paid_funnel) AS paid_30d_rate_all_signups
FROM s;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q19 — atlas-3 vs atlas-2: response length and billed usage per request (warehouse)
-- ─────────────────────────────────────────────────────────────────────────
SELECT model, round(avg(output_tokens), 0) AS avg_output_tokens, round(avg(input_tokens), 0) AS avg_input_tokens, round(avg(latency_ms), 0) AS avg_latency_ms
FROM requests WHERE status_code = 200 AND t >= TIMESTAMP '2026-09-01' AND t < TIMESTAMP '2026-10-01' GROUP BY 1 ORDER BY 1;
SELECT model, round(sum(usage_value_usd) / sum(requests_billed) * 1000, 2) AS usage_value_per_1000_requests,
 round(sum(output_tokens_billed)::DOUBLE / sum(requests_billed), 0) AS output_tokens_per_request
FROM wh_billing WHERE date::DATE >= DATE '2026-09-01' AND date::DATE < DATE '2026-10-01' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- EVAL Q20 — headline numbers for "what should we worry about"
-- ─────────────────────────────────────────────────────────────────────────
SELECT round(avg(converted::INT), 4) AS first_request_rate_all_signups, count(*) AS signups FROM onboarding;
SELECT round(sum(revenue_usd) FILTER (WHERE date::DATE BETWEEN DATE '2026-07-01' AND DATE '2026-07-31') / 31, 0) AS jul_revenue_per_day,
 round(sum(revenue_usd) FILTER (WHERE date::DATE BETWEEN DATE '2026-09-01' AND DATE '2026-09-30') / 30, 0) AS sep_revenue_per_day
FROM wh_billing;
SELECT round(avg(d30::INT), 4) AS d30_retention_new_api_accounts, round(avg((early_evals >= 2)::INT), 4) AS share_2plus_evals FROM eval_retention;
SELECT plan_tier, round(1000.0 * count(*) FILTER (WHERE event = 'rate limit hit') / count(*) FILTER (WHERE event = 'api request'), 1) AS episodes_per_1000_sampled_requests_sep
FROM ev WHERE event IN ('rate limit hit', 'api request') AND t >= TIMESTAMP '2026-09-01' AND t < TIMESTAMP '2026-10-01' GROUP BY 1 ORDER BY 1;
