-- Shieldstone Insurance (insurance-application vertical) — story-keyed and eval-keyed DuckDB queries.
--
-- Generate first (repo root):
--   node scripts/verify-runner.mjs dungeons/vertical/insurance-application/insurance-application.js verify-insurance-application
-- Run:
--   duckdb -c ".read dungeons/vertical/insurance-application/insurance-application.sql"
-- Against a gzipped export:
--   duckdb -c "SET VARIABLE data_prefix='<dir>/insurance-application'" -c ".read insurance-application.sql"
--
-- All times are UTC. Window: 2026-06-04 00:00 to 2026-10-01 23:59:59.
-- Timeline: Express Quote test 2026-07-08; Snap & Settle 2026-07-21; auto rate
-- plan 2026-08-17; Hurricane Delphine landfall 2026-08-27 (catastrophe window
-- Aug 27 - Sep 9); fall social campaign from 2026-09-08.

SET VARIABLE data_prefix = COALESCE(getvariable('data_prefix'), 'data/verify-insurance-application');

-- ─────────────────────────────────────────────────────────────────────────
-- PRELUDE: raw files, identity resolution, warehouse tables
-- ─────────────────────────────────────────────────────────────────────────
-- Identity: shoppers quote anonymously (quote started / quote completed carry
-- device_id only). "account created" carries user_id + device_id and stitches
-- the quote device to the customer, the way Mixpanel merges identities. A
-- device resolves to the customer seen with it on any event that carries both
-- ids; a shopper who never creates an account stays on their device id.

CREATE OR REPLACE TEMP TABLE raw_events AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-EVENTS*.json*', sample_size=-1, union_by_name=true);

-- profiles of anonymous shoppers are never sent to Mixpanel (_drop = true)
CREATE OR REPLACE TEMP TABLE users AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-USERS*.json*', sample_size=-1, union_by_name=true)
WHERE _drop IS NOT TRUE;

CREATE OR REPLACE TEMP TABLE device_map AS
SELECT device_id::VARCHAR AS device_id, min(user_id::VARCHAR) AS mapped
FROM raw_events WHERE user_id IS NOT NULL AND device_id IS NOT NULL GROUP BY 1;

CREATE OR REPLACE TEMP TABLE ev AS
SELECT coalesce(e.user_id::VARCHAR, m.mapped, e.device_id::VARCHAR) AS uid, e.time::TIMESTAMP AS t, e.*
FROM raw_events e LEFT JOIN device_map m ON e.device_id::VARCHAR = m.device_id;

CREATE OR REPLACE TEMP TABLE wh_marketing AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-marketing_spend_daily.json*', sample_size=-1, union_by_name=true);
CREATE OR REPLACE TEMP TABLE wh_claims AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-claims_operations_daily.json*', sample_size=-1, union_by_name=true);
CREATE OR REPLACE TEMP TABLE wh_premium AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-written_premium_daily.json*', sample_size=-1, union_by_name=true);

-- profile attributes keyed by customer id
CREATE OR REPLACE TEMP TABLE prof AS
SELECT distinct_id::VARCHAR AS uid, state, region, age_band, product_lines, bundle, autopay, customer_status,
 customer_since, acquisition_channel, shopping_reason, "Experiment: Express Quote" AS variant
FROM users;

-- one row per shopper (one quote each): start, completion, account, purchase
CREATE OR REPLACE TEMP TABLE quotes AS
SELECT s.uid, s.t AS t_start, s.product_line, s.acquisition_channel AS ch, s.quote_flow, s.platform,
 c.t_complete, c.shopping_reason, c.coverage_tier, c.premium, a.t_account, p.t_purchase,
 coalesce(p.t_purchase >= c.t_complete AND p.t_purchase < c.t_complete + INTERVAL 14 DAY, false) AS bound14
FROM (SELECT uid, min(t) AS t, any_value(product_line) AS product_line, any_value(acquisition_channel) AS acquisition_channel,
        any_value(quote_flow) AS quote_flow, any_value(platform) AS platform FROM ev WHERE event = 'quote started' GROUP BY 1) s
LEFT JOIN (SELECT uid, min(t) AS t_complete, any_value(shopping_reason) AS shopping_reason, any_value(coverage_tier) AS coverage_tier,
        any_value(quoted_premium_monthly) AS premium FROM ev WHERE event = 'quote completed' GROUP BY 1) c ON c.uid = s.uid
LEFT JOIN (SELECT uid, min(t) AS t_account FROM ev WHERE event = 'account created' GROUP BY 1) a ON a.uid = s.uid
LEFT JOIN (SELECT uid, min(t) AS t_purchase FROM ev WHERE event = 'policy purchased' GROUP BY 1) p ON p.uid = s.uid;

-- one row per claim
CREATE OR REPLACE TEMP TABLE claims AS
SELECT s.claim_id, s.uid, s.t AS t_submit, s.product_line, s.peril, s.claim_channel, s.region, s.state, s.estimated_loss_usd,
 d.t AS t_settle, d.settlement_type, d.payout_usd, d.days_open,
 date_diff('second', s.t, d.t) / 86400.0 AS days_to_settle
FROM (SELECT claim_id, any_value(uid) AS uid, min(t) AS t, any_value(product_line) AS product_line, any_value(peril) AS peril,
        any_value(claim_channel) AS claim_channel, any_value(region) AS region, any_value(state) AS state,
        any_value(estimated_loss_usd) AS estimated_loss_usd FROM ev WHERE event = 'claim submitted' GROUP BY 1) s
LEFT JOIN (SELECT claim_id, min(t) AS t, any_value(settlement_type) AS settlement_type, any_value(payout_usd) AS payout_usd,
        any_value(days_open) AS days_open FROM ev WHERE event = 'claim settled' GROUP BY 1) d ON d.claim_id = s.claim_id;

-- one row per renewal offer: did the customer leave at renewal (35-day window)?
CREATE OR REPLACE TEMP TABLE renewals AS
SELECT o.policy_id, o.uid, o.t AS t_offer, o.product_line, o.premium_change_pct AS chg, o.is_bundled,
 coalesce(bool_or(c.cancel_reason IN ('found_cheaper', 'price_increase') AND c.t >= o.t AND c.t < o.t + INTERVAL 35 DAY), false) AS left_at_renewal,
 coalesce(bool_or(r.t IS NOT NULL), false) AS renewed
FROM (SELECT * FROM ev WHERE event = 'renewal offered') o
LEFT JOIN ev c ON c.event = 'policy cancelled' AND c.policy_id = o.policy_id
LEFT JOIN ev r ON r.event = 'policy renewed' AND r.policy_id = o.policy_id AND r.t > o.t AND r.t < o.t + INTERVAL 35 DAY
GROUP BY 1, 2, 3, 4, 5, 6;

-- dataset overview
SELECT count(*) AS events, count(DISTINCT uid) AS people, count(DISTINCT uid) FILTER (WHERE user_id IS NOT NULL) AS identified_customers,
 (SELECT count(*) FROM users) AS profiles, (SELECT count(*) FROM quotes) AS shoppers, min(t) AS first_event, max(t) AS last_event FROM ev;

-- identity check: every event resolves; platform agrees with the device OS; back-office events have no device
SELECT count(*) FILTER (WHERE uid IS NULL) AS unresolved_events,
 count(*) FILTER (WHERE (platform = 'ios' AND os NOT IN ('iOS', 'iPadOS')) OR (platform = 'android' AND os <> 'Android')
   OR (platform = 'web' AND os IN ('iOS', 'iPadOS', 'Android')) OR (platform = 'server' AND device_id IS NOT NULL)) AS platform_mismatch,
 count(*) FILTER (WHERE user_id IS NULL) AS anonymous_events
FROM ev;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H1-snap-and-settle: photo-estimate auto claims settle in 0.3x the time
-- ─────────────────────────────────────────────────────────────────────────
-- Eligible auto claims (collision, glass, comprehensive) submitted Jul 21 - Sep 15, settled within 30 days.
SELECT claim_channel, count(*) AS claims, median(days_to_settle) FILTER (WHERE days_to_settle < 30) AS median_days
FROM claims WHERE product_line = 'auto' AND peril IN ('collision', 'glass', 'comprehensive')
  AND t_submit >= TIMESTAMP '2026-07-21' AND t_submit < TIMESTAMP '2026-09-16' GROUP BY 1 ORDER BY 1;
SELECT avg((claim_channel = 'photo_estimate')::INT) AS photo_share_after_launch
FROM claims WHERE product_line = 'auto' AND peril IN ('collision', 'glass', 'comprehensive') AND t_submit >= TIMESTAMP '2026-07-21' AND t_submit < TIMESTAMP '2026-09-16';
SELECT count(*) AS photo_claims_before_launch FROM claims WHERE claim_channel = 'photo_estimate' AND t_submit < TIMESTAMP '2026-07-21';

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H2-hurricane-delphine: Gulf property claims in the catastrophe window settle 2.5x slower
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE TEMP TABLE cat_days AS
SELECT DISTINCT date::DATE AS d, region FROM wh_claims WHERE catastrophe_code <> 'none';
SELECT CASE WHEN cd.d IS NOT NULL THEN 'cat' ELSE 'baseline' END AS grp, count(*) AS claims,
 median(c.days_to_settle) FILTER (WHERE c.days_to_settle < 45) AS median_days
FROM claims c LEFT JOIN cat_days cd ON cd.d = c.t_submit::DATE AND cd.region = c.region
WHERE c.product_line IN ('home', 'renters') AND (cd.d IS NOT NULL OR c.t_submit < TIMESTAMP '2026-09-16')
GROUP BY 1 ORDER BY 1;
SELECT count(*) AS cat_rows, min(date) AS first_cat_day, max(date) AS last_cat_day, any_value(catastrophe_code) AS code
FROM wh_claims WHERE catastrophe_code <> 'none';

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H3-express-quote-experiment: completion 1.3x, time to complete 0.5x
-- ─────────────────────────────────────────────────────────────────────────
SELECT quote_flow, count(*) AS shoppers,
 avg((t_complete IS NOT NULL AND t_complete < t_start + INTERVAL 1 DAY)::INT) AS completion,
 median(date_diff('second', t_start, t_complete) / 60.0) AS median_minutes
FROM quotes WHERE t_start >= TIMESTAMP '2026-07-08' GROUP BY 1 ORDER BY 1;
SELECT "Variant name" AS variant, count(DISTINCT uid) AS exposed FROM ev WHERE event = '$experiment_started' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H4-comparison-site-economics: cheap per quote, 0.45x purchase rate
-- ─────────────────────────────────────────────────────────────────────────
SELECT q.ch, count(*) AS quote_starts, round(any_value(m.spend), 2) AS spend,
 round(any_value(m.spend) / count(*), 2) AS spend_per_quote_start,
 avg(q.bound14::INT) FILTER (WHERE q.t_complete IS NOT NULL AND q.t_complete < TIMESTAMP '2026-09-18') AS purchase_per_completed_quote
FROM quotes q LEFT JOIN (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM wh_marketing GROUP BY 1) m ON m.ch = q.ch
GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H5-auto-rate-change: auto quotes 1.14x, purchases per completed auto quote 0.75x
-- ─────────────────────────────────────────────────────────────────────────
SELECT CASE WHEN product_line = 'auto' THEN 'auto' ELSE 'property' END AS line,
 CASE WHEN t_complete >= TIMESTAMP '2026-08-17' THEN 'after' ELSE 'before' END AS period,
 count(*) AS completed_quotes, round(avg(premium), 2) AS avg_quoted_premium,
 avg(bound14::INT) FILTER (WHERE t_complete < TIMESTAMP '2026-09-18') AS purchase_rate
FROM quotes WHERE t_complete IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 2 DESC;
SELECT CASE WHEN date::DATE < DATE '2026-08-17' THEN 'before' ELSE 'from_aug_31' END AS period,
 round(sum(written_premium_usd)) AS written_premium, sum(policies_written) AS policies,
 (SELECT count(*) FROM ev WHERE event = 'quote completed' AND product_line = 'auto'
   AND (CASE WHEN period = 'before' THEN t < TIMESTAMP '2026-08-17' ELSE t >= TIMESTAMP '2026-08-31' END)) AS completed_auto_quotes
FROM wh_premium WHERE product_line = 'auto' AND transaction_type = 'new_business'
  AND (date::DATE < DATE '2026-08-17' OR date::DATE >= DATE '2026-08-31') GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H6-bundle-retention: bundled policies leave at renewal at 0.4x
-- ─────────────────────────────────────────────────────────────────────────
SELECT is_bundled, count(*) AS offers, avg(left_at_renewal::INT) AS nonrenewal
FROM renewals WHERE t_offer < TIMESTAMP '2026-09-01' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H7-renewal-price-shock: non-renewal 4x at +15% or more vs no increase
-- ─────────────────────────────────────────────────────────────────────────
SELECT CASE WHEN chg <= 0 THEN '1: <= 0%' WHEN chg < 5 THEN '2: 0-5%' WHEN chg < 10 THEN '3: 5-10%' WHEN chg < 15 THEN '4: 10-15%' ELSE '5: >= 15%' END AS change_band,
 count(*) AS offers, avg(left_at_renewal::INT) AS nonrenewal
FROM renewals WHERE t_offer < TIMESTAMP '2026-09-01' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H8-fall-social-campaign: social quote starts per day 1.8x from Sep 8
-- ─────────────────────────────────────────────────────────────────────────
SELECT CASE WHEN ch = 'social_ads' THEN 'social_ads' ELSE 'other channels' END AS channel,
 count(*) FILTER (WHERE t_start < TIMESTAMP '2026-09-08') / 96.0 AS per_day_before,
 count(*) FILTER (WHERE t_start >= TIMESTAMP '2026-09-08') / 24.0 AS per_day_campaign
FROM quotes GROUP BY 1 ORDER BY 1;
SELECT CASE WHEN date::DATE >= DATE '2026-09-08' THEN 'campaign' ELSE 'before' END AS period, round(avg(spend_usd), 2) AS social_spend_per_day
FROM wh_marketing WHERE acquisition_channel = 'social_ads' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H9-switchers-take-longer: switchers take 3x as long from quote to purchase
-- ─────────────────────────────────────────────────────────────────────────
SELECT shopping_reason, count(*) AS purchases, median(date_diff('second', t_complete, t_purchase) / 3600.0) AS median_hours
FROM quotes WHERE bound14 AND t_complete < TIMESTAMP '2026-09-18' GROUP BY 1 ORDER BY 1;

-- ─────────────────────────────────────────────────────────────────────────
-- STORY H10-autopay-and-lapses: autopay fails 0.3x as often; 25% of failed manual payments lapse
-- ─────────────────────────────────────────────────────────────────────────
SELECT CASE WHEN payment_method LIKE 'autopay%' THEN 'autopay' ELSE 'manual' END AS method,
 count(*) AS scheduled, count(*) FILTER (WHERE event = 'payment failed') AS failed,
 count(*) FILTER (WHERE event = 'payment failed')::DOUBLE / count(*) AS fail_rate
FROM ev WHERE event IN ('payment made', 'payment failed') AND NOT is_retry GROUP BY 1 ORDER BY 1;
CREATE OR REPLACE TEMP TABLE failures AS
SELECT f.insert_id, f.policy_id, f.t, CASE WHEN f.payment_method LIKE 'autopay%' THEN 'autopay' ELSE 'manual' END AS method,
 coalesce(bool_or(c.t > f.t AND c.t < f.t + INTERVAL 30 DAY), false) AS lapsed30
FROM ev f LEFT JOIN ev c ON c.event = 'policy cancelled' AND c.cancel_reason = 'nonpayment' AND c.policy_id = f.policy_id
WHERE f.event = 'payment failed' AND NOT f.is_retry GROUP BY 1, 2, 3, 4;
SELECT method, count(*) AS failures, avg(lapsed30::INT) AS nonpayment_cancel_within_30d
FROM failures WHERE t < TIMESTAMP '2026-09-01' GROUP BY 1 ORDER BY 1;

-- =========================================================================
-- EVAL QUERIES (one per question in eval/insurance-application.eval.md)
-- =========================================================================

-- EVAL Q1: Express Quote — completion, time, purchases per completed quote, purchases per shopper
SELECT quote_flow, count(*) AS shoppers,
 round(avg((t_complete IS NOT NULL AND t_complete < t_start + INTERVAL 1 DAY)::INT), 4) AS completion,
 round(median(date_diff('second', t_start, t_complete) / 60.0), 2) AS median_minutes,
 round(avg(bound14::INT) FILTER (WHERE t_complete IS NOT NULL AND t_complete < TIMESTAMP '2026-09-18'), 4) AS purchase_per_completed,
 round(avg(bound14::INT) FILTER (WHERE t_start < TIMESTAMP '2026-09-18'), 4) AS purchase_per_shopper
FROM quotes WHERE t_start >= TIMESTAMP '2026-07-08' GROUP BY 1 ORDER BY 1;

CREATE OR REPLACE TEMP TABLE exp_quotes AS
SELECT quote_flow, product_line, bound14 FROM quotes WHERE t_start >= TIMESTAMP '2026-07-08' AND t_complete IS NOT NULL AND t_complete < TIMESTAMP '2026-09-18';
WITH g AS (SELECT quote_flow, count(*) AS n, avg(bound14::INT) AS p FROM exp_quotes GROUP BY 1)
SELECT c.n AS n_standard, round(c.p, 4) AS purchase_standard, v.n AS n_express, round(v.p, 4) AS purchase_express,
 round((v.p - c.p) / sqrt(((v.p * v.n + c.p * c.n) / (v.n + c.n)) * (1 - (v.p * v.n + c.p * c.n) / (v.n + c.n)) * (1.0 / v.n + 1.0 / c.n)), 2) AS z
FROM g v, g c WHERE v.quote_flow = 'express' AND c.quote_flow = 'standard';

-- EVAL Q2: Snap & Settle — photo vs adjuster settle time, adoption, auto cycle time before/after launch
SELECT claim_channel, count(*) AS claims, round(median(days_to_settle) FILTER (WHERE days_to_settle < 30), 2) AS median_days
FROM claims WHERE product_line = 'auto' AND peril IN ('collision', 'glass', 'comprehensive')
  AND t_submit >= TIMESTAMP '2026-07-21' AND t_submit < TIMESTAMP '2026-09-16' GROUP BY 1 ORDER BY 1;
SELECT CASE WHEN t_submit >= TIMESTAMP '2026-07-21' THEN 'after' ELSE 'before' END AS period, count(*) AS auto_claims,
 round(avg((claim_channel = 'photo_estimate')::INT), 4) AS photo_share,
 round(median(days_to_settle) FILTER (WHERE days_to_settle < 30), 2) AS median_days_all_auto
FROM claims WHERE product_line = 'auto' AND t_submit < TIMESTAMP '2026-09-16' GROUP BY 1 ORDER BY 1 DESC;

-- EVAL Q3: Hurricane Delphine — claims volume, settle time, backlog, adjuster hours
SELECT CASE WHEN date::DATE < DATE '2026-08-27' THEN '1 before (Jun 4-Aug 26)' WHEN date::DATE < DATE '2026-09-10' THEN '2 cat (Aug 27-Sep 9)' ELSE '3 after (Sep 10-Oct 1)' END AS period,
 round(avg(new_claims_reported), 2) AS claims_per_day, max(open_claims) AS peak_open_claims, round(avg(open_claims), 1) AS avg_open_claims,
 round(avg(adjuster_hours), 1) AS adjuster_hours_per_day
FROM wh_claims WHERE region = 'gulf_coast' GROUP BY 1 ORDER BY 1;
SELECT count(*) AS gulf_property_claims_in_cat_window, count(*) FILTER (WHERE peril IN ('wind_hail', 'water')) AS storm_perils,
 round(median(days_to_settle) FILTER (WHERE days_to_settle < 45), 2) AS median_days
FROM claims WHERE region = 'gulf_coast' AND product_line IN ('home', 'renters') AND t_submit >= TIMESTAMP '2026-08-27' AND t_submit < TIMESTAMP '2026-09-10';
SELECT round(median(days_to_settle) FILTER (WHERE days_to_settle < 45), 2) AS baseline_property_median_days, count(*) AS claims
FROM claims WHERE product_line IN ('home', 'renters') AND t_submit < TIMESTAMP '2026-09-16'
  AND NOT (region = 'gulf_coast' AND t_submit >= TIMESTAMP '2026-08-27' AND t_submit < TIMESTAMP '2026-09-10');
SELECT round(sum(payout_usd)) AS gulf_cat_payouts_to_date, count(*) FILTER (WHERE t_settle IS NOT NULL) AS settled_by_oct1
FROM claims WHERE region = 'gulf_coast' AND product_line IN ('home', 'renters') AND t_submit >= TIMESTAMP '2026-08-27' AND t_submit < TIMESTAMP '2026-09-10';

-- EVAL Q4: paid channel cost per quote start and per policy (Mixpanel purchases attributed to the shopper's channel)
SELECT q.ch, count(*) AS quote_starts, count(q.t_complete) AS completed, count(q.t_purchase) AS purchases,
 round(any_value(m.spend)) AS spend, round(any_value(m.spend) / count(*), 2) AS cost_per_quote_start,
 round(any_value(m.spend) / nullif(count(q.t_purchase), 0), 2) AS cost_per_policy,
 round(avg(q.bound14::INT) FILTER (WHERE q.t_complete IS NOT NULL AND q.t_complete < TIMESTAMP '2026-09-18'), 4) AS purchase_per_completed,
 any_value(m.conv) AS network_reported_conversions
FROM quotes q LEFT JOIN (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend, sum(conversions_reported) AS conv FROM wh_marketing GROUP BY 1) m ON m.ch = q.ch
GROUP BY 1 ORDER BY 1;

-- EVAL Q5: auto rate change — quoted premium, purchase rate, written premium per completed quote
SELECT CASE WHEN t_complete >= TIMESTAMP '2026-08-17' THEN 'after' ELSE 'before' END AS period, count(*) AS completed_auto_quotes,
 round(avg(premium), 2) AS avg_quoted_premium,
 round(avg(bound14::INT) FILTER (WHERE t_complete < TIMESTAMP '2026-09-18'), 4) AS purchase_rate
FROM quotes WHERE product_line = 'auto' AND t_complete IS NOT NULL GROUP BY 1 ORDER BY 1 DESC;
SELECT period, written_premium, policies, completed_auto_quotes, round(written_premium / completed_auto_quotes, 2) AS premium_per_completed_quote,
 round(written_premium / days, 2) AS premium_per_day
FROM (
  SELECT 'before (Jun 4-Aug 16)' AS period, 74 AS days, round(sum(written_premium_usd)) AS written_premium, sum(policies_written) AS policies,
   (SELECT count(*) FROM ev WHERE event = 'quote completed' AND product_line = 'auto' AND t < TIMESTAMP '2026-08-17') AS completed_auto_quotes
  FROM wh_premium WHERE product_line = 'auto' AND transaction_type = 'new_business' AND date::DATE < DATE '2026-08-17'
  UNION ALL
  SELECT 'after (Aug 31-Oct 1)', 32, round(sum(written_premium_usd)), sum(policies_written),
   (SELECT count(*) FROM ev WHERE event = 'quote completed' AND product_line = 'auto' AND t >= TIMESTAMP '2026-08-31')
  FROM wh_premium WHERE product_line = 'auto' AND transaction_type = 'new_business' AND date::DATE >= DATE '2026-08-31'
) ORDER BY period DESC;

WITH g AS (SELECT CASE WHEN product_line = 'auto' THEN 'auto' ELSE 'property' END AS line,
   CASE WHEN t_complete >= TIMESTAMP '2026-08-17' THEN 'after' ELSE 'before' END AS period, count(*) AS n, avg(bound14::INT) AS p
   FROM quotes WHERE t_complete IS NOT NULL AND t_complete < TIMESTAMP '2026-09-18' GROUP BY 1, 2)
SELECT b.line, b.n AS n_before, round(b.p, 4) AS rate_before, a.n AS n_after, round(a.p, 4) AS rate_after, round(a.p / b.p, 3) AS ratio,
 round((a.p - b.p) / sqrt(((a.p * a.n + b.p * b.n) / (a.n + b.n)) * (1 - (a.p * a.n + b.p * b.n) / (a.n + b.n)) * (1.0 / a.n + 1.0 / b.n)), 2) AS z
FROM g b JOIN g a ON a.line = b.line AND a.period = 'after' WHERE b.period = 'before' ORDER BY 1;

-- EVAL Q6: bundles and renewal — non-renewal by bundle, by product line
SELECT is_bundled, product_line, count(*) AS offers, round(avg(left_at_renewal::INT), 4) AS nonrenewal, round(avg(renewed::INT), 4) AS renewed
FROM renewals WHERE t_offer < TIMESTAMP '2026-09-01' GROUP BY ROLLUP (is_bundled, product_line) ORDER BY 1, 2;

-- EVAL Q7: renewal price sensitivity — non-renewal by price change band (all, and single-line only)
SELECT CASE WHEN chg <= 0 THEN '1: <= 0%' WHEN chg < 5 THEN '2: 0-5%' WHEN chg < 10 THEN '3: 5-10%' WHEN chg < 15 THEN '4: 10-15%' ELSE '5: >= 15%' END AS change_band,
 count(*) AS offers, round(avg(left_at_renewal::INT), 4) AS nonrenewal,
 round(avg(left_at_renewal::INT) FILTER (WHERE NOT is_bundled), 4) AS nonrenewal_single_line,
 round(avg(chg), 2) AS avg_change
FROM renewals WHERE t_offer < TIMESTAMP '2026-09-01' GROUP BY 1 ORDER BY 1;

-- EVAL Q8: fall social campaign — quote starts per day, spend per day, incremental cost per quote, purchases
WITH qd AS (SELECT count(*) FILTER (WHERE t_start < TIMESTAMP '2026-09-08') / 96.0 AS q_before,
              count(*) FILTER (WHERE t_start >= TIMESTAMP '2026-09-08') / 24.0 AS q_campaign,
              count(t_purchase) FILTER (WHERE t_start < TIMESTAMP '2026-09-08') / 96.0 AS p_before,
              count(t_purchase) FILTER (WHERE t_start >= TIMESTAMP '2026-09-08') / 24.0 AS p_campaign
            FROM quotes WHERE ch = 'social_ads'),
sd AS (SELECT avg(spend_usd) FILTER (WHERE date::DATE < DATE '2026-09-08') AS s_before,
              avg(spend_usd) FILTER (WHERE date::DATE >= DATE '2026-09-08') AS s_campaign FROM wh_marketing WHERE acquisition_channel = 'social_ads')
SELECT round(q_before, 2) AS quotes_per_day_before, round(q_campaign, 2) AS quotes_per_day_campaign, round(q_campaign / q_before, 3) AS quote_lift,
 round(s_before, 2) AS spend_per_day_before, round(s_campaign, 2) AS spend_per_day_campaign, round(s_campaign / s_before, 3) AS spend_lift,
 round(s_before / q_before, 2) AS cost_per_quote_before, round((s_campaign - s_before) / (q_campaign - q_before), 2) AS incremental_cost_per_quote,
 round(p_before, 3) AS purchases_per_day_before, round(p_campaign, 3) AS purchases_per_day_campaign
FROM qd, sd;
SELECT CASE WHEN ch = 'social_ads' THEN 'social_ads' ELSE 'other channels' END AS channel,
 round(count(*) FILTER (WHERE t_start < TIMESTAMP '2026-09-08') / 96.0, 2) AS per_day_before,
 round(count(*) FILTER (WHERE t_start >= TIMESTAMP '2026-09-08') / 24.0, 2) AS per_day_campaign
FROM quotes GROUP BY 1 ORDER BY 1;

SELECT round(count(*) FILTER (WHERE t < TIMESTAMP '2026-09-08') / 96.0, 3) AS social_purchases_per_day_before,
 round(count(*) FILTER (WHERE t >= TIMESTAMP '2026-09-08') / 24.0, 3) AS social_purchases_per_day_campaign
FROM ev WHERE event = 'policy purchased' AND acquisition_channel = 'social_ads';

-- EVAL Q9: time from quote to purchase, by shopping reason and product line
SELECT shopping_reason, count(*) AS purchases, round(median(date_diff('second', t_complete, t_purchase) / 3600.0), 1) AS median_hours,
 round(avg((t_purchase < t_complete + INTERVAL 1 DAY)::INT), 3) AS same_day_share
FROM quotes WHERE bound14 AND t_complete < TIMESTAMP '2026-09-18' GROUP BY ROLLUP (shopping_reason) ORDER BY 1;
SELECT product_line, round(median(date_diff('second', t_complete, t_purchase) / 3600.0), 1) AS median_hours, count(*) AS purchases
FROM quotes WHERE bound14 AND t_complete < TIMESTAMP '2026-09-18' GROUP BY 1 ORDER BY 1;

-- EVAL Q10: autopay — failure rate, lapses, nonpayment cancellations, autopay share
SELECT CASE WHEN payment_method LIKE 'autopay%' THEN 'autopay' ELSE 'manual' END AS method,
 count(DISTINCT policy_id) AS policies, count(*) AS scheduled_payments, count(*) FILTER (WHERE event = 'payment failed') AS failed,
 round(count(*) FILTER (WHERE event = 'payment failed')::DOUBLE / count(*), 4) AS fail_rate
FROM ev WHERE event IN ('payment made', 'payment failed') AND NOT is_retry GROUP BY 1 ORDER BY 1;
SELECT method, count(*) AS failures, round(avg(lapsed30::INT), 4) AS nonpayment_cancel_within_30d
FROM failures WHERE t < TIMESTAMP '2026-09-01' GROUP BY 1 ORDER BY 1;
WITH pol AS (SELECT policy_id, any_value(payment_method) AS pm FROM ev WHERE event IN ('payment made', 'payment failed') GROUP BY 1),
cx AS (SELECT DISTINCT policy_id FROM ev WHERE event = 'policy cancelled' AND cancel_reason = 'nonpayment')
SELECT CASE WHEN pm LIKE 'autopay%' THEN 'autopay' ELSE 'manual' END AS method, count(*) AS policies_billed,
 count(cx.policy_id) AS nonpayment_cancellations, round(count(cx.policy_id)::DOUBLE / count(*), 4) AS nonpayment_cancel_share
FROM pol LEFT JOIN cx USING (policy_id) GROUP BY 1 ORDER BY 1;

-- EVAL Q11: book of business at the end of the window (identified customers)
SELECT customer_status, count(*) AS customers FROM prof GROUP BY 1 ORDER BY 1;
SELECT product_lines, count(*) AS active_customers, round(count(*) * 100.0 / sum(count(*)) OVER (), 1) AS pct
FROM prof WHERE customer_status = 'active' GROUP BY 1 ORDER BY 2 DESC;
SELECT round(avg(bundle::INT) FILTER (WHERE customer_status = 'active'), 4) AS bundle_share_active,
 round(avg(autopay::INT) FILTER (WHERE customer_status = 'active'), 4) AS autopay_share_active,
 (SELECT count(*) FROM ev WHERE event = 'policy purchased') AS new_policies_in_window,
 (SELECT count(*) FROM ev WHERE event = 'policy renewed') AS renewals_in_window,
 (SELECT count(*) FROM ev WHERE event = 'policy cancelled') AS cancellations_in_window
FROM prof;
SELECT product_line, transaction_type, round(sum(written_premium_usd)) AS written_premium, sum(policies_written) AS policies
FROM wh_premium GROUP BY ROLLUP (product_line, transaction_type) ORDER BY 1, 2;

-- EVAL Q12 (null): do premium-tier quotes convert to purchases less often than basic-tier quotes?
CREATE OR REPLACE TEMP TABLE tier_quotes AS
SELECT coverage_tier, CASE WHEN product_line = 'auto' THEN 'auto' ELSE 'property' END AS line,
 CASE WHEN ch = 'comparison_site' THEN 'comparison_site' ELSE 'other channels' END AS chgrp, bound14
FROM quotes WHERE t_complete IS NOT NULL AND t_complete < TIMESTAMP '2026-09-18';
SELECT coverage_tier, count(*) AS completed_quotes, round(avg(bound14::INT), 4) AS purchase_rate FROM tier_quotes GROUP BY 1 ORDER BY 1;
WITH g AS (SELECT 'all' AS split, coverage_tier, count(*) AS n, avg(bound14::INT) AS p FROM tier_quotes GROUP BY 2
  UNION ALL SELECT line, coverage_tier, count(*), avg(bound14::INT) FROM tier_quotes GROUP BY 1, 2
  UNION ALL SELECT chgrp, coverage_tier, count(*), avg(bound14::INT) FROM tier_quotes GROUP BY 1, 2)
SELECT b.split, b.n AS n_basic, round(b.p, 4) AS rate_basic, pr.n AS n_premium, round(pr.p, 4) AS rate_premium,
 round((pr.p - b.p) / sqrt(((pr.p * pr.n + b.p * b.n) / (pr.n + b.n)) * (1 - (pr.p * pr.n + b.p * b.n) / (pr.n + b.n)) * (1.0 / pr.n + 1.0 / b.n)), 2) AS z_premium_vs_basic
FROM g b JOIN g pr ON pr.split = b.split AND pr.coverage_tier = 'premium' WHERE b.coverage_tier = 'basic' ORDER BY 1;

-- EVAL Q13 (null): do shoppers on phones complete quotes less often than on the web?
CREATE OR REPLACE TEMP TABLE device_quotes AS
SELECT CASE WHEN platform = 'web' THEN 'web' ELSE 'mobile' END AS device, quote_flow,
 (t_complete IS NOT NULL AND t_complete < t_start + INTERVAL 1 DAY) AS done FROM quotes;
WITH g AS (SELECT device, count(*) AS n, avg(done::INT) AS p FROM device_quotes GROUP BY 1)
SELECT w.n AS n_web, round(w.p, 4) AS completion_web, m.n AS n_mobile, round(m.p, 4) AS completion_mobile,
 round((m.p - w.p) / sqrt(((m.p * m.n + w.p * w.n) / (m.n + w.n)) * (1 - (m.p * m.n + w.p * w.n) / (m.n + w.n)) * (1.0 / m.n + 1.0 / w.n)), 2) AS z
FROM g w, g m WHERE w.device = 'web' AND m.device = 'mobile';
WITH g AS (SELECT quote_flow, device, count(*) AS n, avg(done::INT) AS p FROM device_quotes GROUP BY 1, 2)
SELECT w.quote_flow, w.n AS n_web, round(w.p, 4) AS completion_web, m.n AS n_mobile, round(m.p, 4) AS completion_mobile,
 round((m.p - w.p) / sqrt(((m.p * m.n + w.p * w.n) / (m.n + w.n)) * (1 - (m.p * m.n + w.p * w.n) / (m.n + w.n)) * (1.0 / m.n + 1.0 / w.n)), 2) AS z
FROM g w JOIN g m ON m.quote_flow = w.quote_flow AND m.device = 'mobile' WHERE w.device = 'web' ORDER BY 1;

-- EVAL Q14 (null): do autopay customers leave at renewal less often than manual payers?
CREATE OR REPLACE TEMP TABLE renewal_pay AS
SELECT r.left_at_renewal, r.is_bundled, p.autopay FROM renewals r JOIN prof p USING (uid) WHERE r.t_offer < TIMESTAMP '2026-09-01';
WITH g AS (SELECT 'all' AS split, autopay, count(*) AS n, avg(left_at_renewal::INT) AS p FROM renewal_pay GROUP BY 2
  UNION ALL SELECT CASE WHEN is_bundled THEN 'bundled' ELSE 'single-line' END, autopay, count(*), avg(left_at_renewal::INT) FROM renewal_pay GROUP BY 1, 2)
SELECT m.split, m.n AS n_manual, round(m.p, 4) AS nonrenewal_manual, a.n AS n_autopay, round(a.p, 4) AS nonrenewal_autopay,
 round((a.p - m.p) / sqrt(((a.p * a.n + m.p * m.n) / (a.n + m.n)) * (1 - (a.p * a.n + m.p * m.n) / (a.n + m.n)) * (1.0 / a.n + 1.0 / m.n)), 2) AS z
FROM g m JOIN g a ON a.split = m.split AND a.autopay WHERE NOT m.autopay ORDER BY 1;

-- EVAL Q15: when are customers active (customer-initiated events; back-office events excluded)
SELECT dayname(t) AS dow, count(*) AS events, round(count(*) * 7.0 / sum(count(*)) OVER (), 3) AS vs_avg_day
FROM ev WHERE platform <> 'server' GROUP BY 1, dayofweek(t) ORDER BY dayofweek(t);
SELECT hour(t) AS utc_hour, count(*) AS events, round(count(*) * 24.0 / sum(count(*)) OVER (), 2) AS vs_avg_hour
FROM ev WHERE platform <> 'server' GROUP BY 1 ORDER BY 1;

-- EVAL Q16: claims mix — claims per product line, denials, payouts, peril mix
SELECT product_line, count(*) AS claims_submitted, count(t_settle) AS settled,
 round(avg((settlement_type = 'denied')::INT) FILTER (WHERE t_settle IS NOT NULL), 4) AS denial_rate,
 round(sum(payout_usd)) AS payouts, round(avg(payout_usd) FILTER (WHERE settlement_type = 'paid'), 0) AS avg_paid_claim
FROM claims GROUP BY ROLLUP (product_line) ORDER BY 1;
SELECT product_line, peril, count(*) AS claims FROM claims GROUP BY 1, 2 ORDER BY 1, 3 DESC, 2;

-- EVAL Q17: the shopping funnel — quote started → quote completed → account created → policy purchased
SELECT count(*) AS quote_started, count(t_complete) AS quote_completed, count(t_account) AS account_created, count(t_purchase) AS policy_purchased,
 round(count(t_complete)::DOUBLE / count(*), 4) AS start_to_complete, round(count(t_account)::DOUBLE / count(t_complete), 4) AS complete_to_account,
 round(count(t_purchase)::DOUBLE / count(t_account), 4) AS account_to_purchase, round(count(t_purchase)::DOUBLE / count(*), 4) AS start_to_purchase,
 count(*) FILTER (WHERE t_account IS NULL) AS never_identified
FROM quotes;
SELECT product_line, count(*) AS quote_started, round(count(t_complete)::DOUBLE / count(*), 4) AS start_to_complete,
 round(avg(bound14::INT) FILTER (WHERE t_complete IS NOT NULL AND t_complete < TIMESTAMP '2026-09-18'), 4) AS purchase_per_completed
FROM quotes GROUP BY 1 ORDER BY 1;

-- EVAL Q18: why customers cancel
SELECT cancel_reason, count(*) AS cancellations, round(count(*) * 100.0 / sum(count(*)) OVER (), 1) AS pct
FROM ev WHERE event = 'policy cancelled' GROUP BY 1 ORDER BY 2 DESC;
SELECT product_line, count(*) AS cancellations FROM ev WHERE event = 'policy cancelled' GROUP BY 1 ORDER BY 2 DESC;

-- EVAL Q19: quarter overview — monthly shoppers, purchases, renewals, cancellations, claims (Sep = Sep 1-30)
SELECT strftime(t, '%Y-%m') AS month,
 count(*) FILTER (WHERE event = 'quote started') AS quote_starts,
 count(*) FILTER (WHERE event = 'policy purchased') AS new_policies,
 count(*) FILTER (WHERE event = 'policy renewed') AS renewals,
 count(*) FILTER (WHERE event = 'policy cancelled') AS cancellations,
 count(*) FILTER (WHERE event = 'claim submitted') AS claims,
 count(DISTINCT uid) FILTER (WHERE platform <> 'server' AND user_id IS NOT NULL) AS active_customers
FROM ev WHERE t < TIMESTAMP '2026-10-01' GROUP BY 1 ORDER BY 1;

-- EVAL Q20: paid budget allocation inputs — daily spend, cost per policy, network-claimed cost per conversion
SELECT q.ch, round(any_value(m.spend) / 120.0, 2) AS spend_per_day, count(q.t_purchase) AS purchases,
 round(any_value(m.spend) / nullif(count(q.t_purchase), 0), 2) AS cost_per_policy,
 round(any_value(m.spend) / any_value(m.conv), 2) AS network_cost_per_conversion
FROM quotes q LEFT JOIN (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend, sum(conversions_reported) AS conv FROM wh_marketing GROUP BY 1) m ON m.ch = q.ch
WHERE q.ch IN ('search_ads', 'comparison_site', 'social_ads') GROUP BY 1 ORDER BY 1;
