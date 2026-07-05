-- ============================================================
-- ai-platform.js — v1.6 human-inspection queries (DuckDB)
--
-- Every query is keyed to a story id in ai-platform.js's `stories` export;
-- the machine-checked verdicts come from:
--   node scripts/verify-stories.mjs dungeons/vertical/ai-platform/ai-platform.js --data-prefix verify-ai-platform
-- Generate first:
--   node scripts/verify-runner.mjs dungeons/vertical/ai-platform/ai-platform.js verify-ai-platform
-- Run this file:
--   duckdb -c ".read dungeons/vertical/ai-platform/ai-platform.sql"
-- ============================================================

-- ── identity-resolution prelude ─────────────────────────────
-- avgDevicePerUser: 2 + organization created is both isAuthEvent and
-- isFirstEvent, so born users auth on their first event; the device-pool
-- resolve is belt-and-braces for any device-only edge.
CREATE OR REPLACE VIEW users AS
SELECT * FROM read_json_auto('data/verify-ai-platform-USERS*.json', sample_size=-1, union_by_name=true);

CREATE OR REPLACE VIEW device_map AS
-- profiles store the device pool under the legacy "anonymousIds" key
SELECT unnest("anonymousIds") AS device_id, distinct_id FROM users;

CREATE OR REPLACE VIEW ev AS
-- ::VARCHAR casts — user_id sniffs as UUID, device_id as VARCHAR; DuckDB
-- refuses to coalesce mixed types
SELECT coalesce(m.distinct_id::VARCHAR, e.user_id::VARCHAR, e.device_id::VARCHAR) AS uid,
       e.time::TIMESTAMP AS t,
       e.*
FROM read_json_auto('data/verify-ai-platform-EVENTS*.json', sample_size=-1, union_by_name=true) e
LEFT JOIN device_map m ON e.device_id = m.device_id;

-- H3/H7 four-cell cohort: agentic = 3+ tool use calls AND 3+ multi-turn
-- api calls; batch = any batch job submitted. Filters (H4/H8) run before
-- the cohort mutators, so output-side classification reproduces the
-- hook's cohorts 1:1.
CREATE OR REPLACE VIEW cells AS
WITH coh AS (SELECT e.uid,
  (count(*) FILTER (WHERE e.event = 'tool use call') >= 3
   AND count(*) FILTER (WHERE e.event = 'api call' AND e.multi_turn = true) >= 3) AS agentic,
  bool_or(e.event = 'batch job submitted') AS batch
  FROM ev e GROUP BY 1)
SELECT uid, CASE WHEN agentic AND batch THEN 'both' WHEN agentic THEN 'agentic'
  WHEN batch THEN 'batch' ELSE 'neither' END AS cell FROM coh;


-- ── H1-prompt-caching ───────────────────────────────────────
-- ~25% of users flip cache_enabled=true ~30% into their stream; cached
-- api calls carry cost_usd × 0.3.
SELECT CASE WHEN cache_enabled = true THEN 'cached' ELSE 'uncached' END AS grp,
  count(*) AS calls, round(avg(cost_usd), 4) AS avg_cost
FROM ev WHERE event = 'api call' GROUP BY 1 ORDER BY 1;


-- ── H2-model-migration ──────────────────────────────────────
-- opus-4-7 releases day 60 (2026-03-02): 35% of post-release
-- Build/Enterprise api calls migrate at 1.5x tokens. Purity is exact —
-- the hook scrubs engine-sampled opus-4-7 back to the pre-release mix.
SELECT
  count(*) FILTER (WHERE model = 'opus-4-7' AND (t < TIMESTAMP '2026-03-02' OR api_tier = 'Free' OR event <> 'api call')) AS impure_rows,
  count(*) FILTER (WHERE model = 'opus-4-7') AS opus_calls,
  round(count(*) FILTER (WHERE model = 'opus-4-7' AND event = 'api call' AND api_tier IN ('Build', 'Enterprise') AND t >= TIMESTAMP '2026-03-02')::DOUBLE
        / nullif(count(*) FILTER (WHERE event = 'api call' AND api_tier IN ('Build', 'Enterprise') AND t >= TIMESTAMP '2026-03-02'), 0), 4) AS post_paid_share
FROM ev WHERE model IS NOT NULL;

-- tokens 1.5x on neither-cell users (H3's 8x / H7's 2x excluded by cell)
SELECT CASE WHEN e.model = 'opus-4-7' THEN 'opus' ELSE 'other' END AS grp,
  count(*) AS calls, round(avg(e.tokens_used), 0) AS avg_tokens
FROM ev e JOIN cells c ON c.uid = e.uid AND c.cell = 'neither'
WHERE e.event = 'api call' AND e.api_tier IN ('Build', 'Enterprise')
  AND e.t >= TIMESTAMP '2026-03-02'
GROUP BY 1 ORDER BY 1;


-- ── H3-agentic-power-users / H7-batch-discount ──────────────
-- Four-cell token design: neither 1x / agentic 8x / batch 2x / both 16x.
-- Agentic clones stamp multi_turn=true → agentic mt_share ≈ 0.75
-- ((0.25n + 2n) / 3n against the declared 1-in-4 mix).
SELECT c.cell, count(DISTINCT e.uid) AS users, count(*) AS calls,
  round(avg(e.tokens_used), 0) AS avg_tokens,
  round(count(*) FILTER (WHERE e.multi_turn = true)::DOUBLE / count(*), 4) AS mt_share
FROM cells c JOIN ev e ON e.uid = c.uid
WHERE e.event = 'api call' GROUP BY 1 ORDER BY avg_tokens;

-- H7: cost_per_token × 0.5 for batch users (no other hook touches it)
SELECT CASE WHEN c.cell IN ('batch', 'both') THEN 'batch' ELSE 'rest' END AS grp,
  count(*) AS calls, round(avg(e.cost_per_token), 6) AS avg_cpt
FROM cells c JOIN ev e ON e.uid = c.uid
WHERE e.event = 'api call' GROUP BY 1 ORDER BY 1;


-- ── H4-rate-limit-churn ─────────────────────────────────────
-- 60% of users with 2+ rate limit errors in week 1 lose ALL post-week-1
-- events (per-user cliff). Signal: zero-post-week-1 share, flagged vs
-- rest — the DIFFERENCE cancels the natural-quiet baseline. Eligibility:
-- t0 ≤ datasetEnd − 21d (≥14d of post-week-1 runway).
WITH t0 AS (SELECT uid, min(t) AS t0 FROM ev GROUP BY 1),
rl AS (SELECT e.uid FROM ev e JOIN t0 ON t0.uid = e.uid
  WHERE e.event = 'rate limit error' AND e.t < t0.t0 + INTERVAL 7 DAY
  GROUP BY 1 HAVING count(*) >= 2),
per AS (SELECT t0.uid, (t0.uid IN (SELECT uid FROM rl)) AS flagged,
  count(*) FILTER (WHERE e.t > t0.t0 + INTERVAL 7 DAY) AS post_ct
  FROM t0 JOIN ev e ON e.uid = t0.uid
  WHERE t0.t0 <= TIMESTAMP '2026-04-10 23:59:59' GROUP BY 1, 2)
SELECT CASE WHEN flagged THEN 'flagged' ELSE 'rest' END AS grp,
  count(*) AS users,
  round(count(*) FILTER (WHERE post_ct = 0)::DOUBLE / count(*), 4) AS zero_post_share
FROM per GROUP BY 1 ORDER BY 1;


-- ── H5-tier-context-window ──────────────────────────────────
-- input_tokens × 1/2/4 by tier; context_window pinned to the tier
-- constant (200K / 1M / 2M) on every api call — min = max proves it.
SELECT api_tier, count(*) AS calls,
  round(avg(input_tokens), 0) AS avg_input,
  min(context_window) AS min_cw, max(context_window) AS max_cw
FROM ev WHERE event = 'api call' GROUP BY 1 ORDER BY avg_input;


-- ── H6-outage-day ───────────────────────────────────────────
-- days 40-41 (2026-02-10 → 2026-02-12): 40% of api calls flagged
-- is_error + 3x latency. is_error declares [false] → zero errors outside
-- the window by schema.
SELECT
  CASE WHEN t >= TIMESTAMP '2026-02-10' AND t < TIMESTAMP '2026-02-12' THEN 'outage' ELSE 'normal' END AS bucket,
  count(*) AS calls,
  round(count(*) FILTER (WHERE is_error = true)::DOUBLE / count(*), 4) AS error_share,
  round(avg(latency_ms), 0) AS avg_latency
FROM ev WHERE event = 'api call' GROUP BY 1 ORDER BY 1;


-- ── H8-eval-retention ───────────────────────────────────────
-- users without an eval job in week 1 keep 25% of post-day-30 events.
-- Ratio-of-ratios (noneval post/pre vs eval post/pre) cancels window
-- lengths and the growth soup.
WITH t0 AS (SELECT uid, min(t) AS t0 FROM ev GROUP BY 1),
ev_users AS (SELECT e.uid FROM ev e JOIN t0 ON t0.uid = e.uid
  WHERE e.event = 'eval job' AND e.t < t0.t0 + INTERVAL 7 DAY GROUP BY 1),
per AS (SELECT t0.uid, (t0.uid IN (SELECT uid FROM ev_users)) AS eval_user,
  count(*) FILTER (WHERE e.t <= t0.t0 + INTERVAL 30 DAY) AS pre_ct,
  count(*) FILTER (WHERE e.t > t0.t0 + INTERVAL 30 DAY) AS post_ct
  FROM t0 JOIN ev e ON e.uid = t0.uid GROUP BY 1, 2)
SELECT CASE WHEN eval_user THEN 'eval' ELSE 'noneval' END AS grp,
  count(*) AS users, round(avg(pre_ct), 1) AS avg_pre, round(avg(post_ct), 1) AS avg_post,
  round(avg(post_ct) / nullif(avg(pre_ct), 0), 4) AS post_pre
FROM per GROUP BY 1 ORDER BY 1;


-- ── H9-api-to-eval-ttc ──────────────────────────────────────
-- funnel-post scales API-to-Eval step gaps: Enterprise × 0.5, Free × 2.0.
-- CAUTION: this nearest-preceding-pair SQL is shown for inspection only —
-- it is censored by its lookback window (stretched Free pairs fall out and
-- organic events intercept), which can INVERT the direction. The story
-- asserts through the Mixpanel-aligned funnel emulator at a 336h window
-- (= 2.0 × the funnel's 168h generative window, covering the stretched
-- support); trust the story verdict, not this query's ratio.
WITH ej AS (SELECT uid, t, api_tier FROM ev WHERE event = 'eval job'),
gap AS (SELECT ej.uid, ej.api_tier, epoch(ej.t - max(tc.t)) / 3600.0 AS gap_h
  FROM ej JOIN ev tc ON tc.uid = ej.uid AND tc.event = 'tool use call'
    AND tc.t < ej.t AND tc.t >= ej.t - INTERVAL 336 HOUR
  GROUP BY ej.uid, ej.api_tier, ej.t)
SELECT api_tier, count(*) AS pairs, count(DISTINCT uid) AS users,
  round(median(gap_h), 1) AS med_gap_h
FROM gap GROUP BY 1 ORDER BY med_gap_h;


-- ── H10-docs-magic-number ───────────────────────────────────
-- docs searched strictly between earliest org-created and earliest
-- billing payment: 1-2 (sweet) → amount_usd × 1.35 on ALL billing
-- payments; 3+ (over) → × 0.75. Both branches amount-only (iid draw,
-- selection-free); median ratios vs the untouched zero-docs cohort read
-- the knobs directly.
WITH org AS (SELECT uid, min(t) AS org_t FROM ev WHERE event = 'organization created' GROUP BY 1),
bill AS (SELECT uid, min(t) AS bill_t FROM ev WHERE event = 'billing payment' GROUP BY 1),
docs AS (SELECT o.uid, count(e.uid) AS docs_ct
  FROM org o JOIN bill b ON b.uid = o.uid
  LEFT JOIN ev e ON e.uid = o.uid AND e.event = 'docs searched' AND e.t > o.org_t AND e.t < b.bill_t
  GROUP BY 1, o.org_t, b.bill_t),
dcoh AS (SELECT uid, CASE WHEN docs_ct BETWEEN 1 AND 2 THEN 'sweet'
  WHEN docs_ct >= 3 THEN 'over' ELSE 'zero' END AS grp FROM docs)
SELECT d.grp, count(DISTINCT d.uid) AS users, count(*) AS payments,
  round(median(e.amount_usd), 0) AS med_amount
FROM dcoh d JOIN ev e ON e.uid = d.uid AND e.event = 'billing payment'
GROUP BY 1 ORDER BY med_amount;
