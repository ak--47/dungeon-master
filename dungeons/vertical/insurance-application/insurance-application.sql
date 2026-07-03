-- ============================================================
-- insurance-application.js — v1.6 human-inspection queries (DuckDB)
--
-- Every query is keyed to a story id in insurance-application.js's
-- `stories` export; the machine-checked verdicts come from:
--   node scripts/verify-stories.mjs dungeons/vertical/insurance-application/insurance-application.js --data-prefix verify-insurance-application
-- Generate first:
--   node scripts/verify-runner.mjs dungeons/vertical/insurance-application/insurance-application.js verify-insurance-application
-- Run this file:
--   duckdb -c ".read dungeons/vertical/insurance-application/insurance-application.sql"
--
-- NOTE: this dungeon uses a LITERAL historical window (datasetStart
-- 2026-01-01 → datasetEnd 2026-05-01T23:59:59Z, no forward shift), so
-- day_idx = date_diff('day', DATE '2026-01-01', t::DATE) matches the
-- hook's day offsets exactly. Version boundaries are exact timestamps:
--   v2.11 @ 2026-01-31 00:00:00, v2.12 @ 2026-03-02 00:00:00,
--   v2.13 @ 2026-04-21 23:59:59 (end − 10d — NOT midnight).
-- ============================================================

-- ── identity-resolution prelude ─────────────────────────────
-- 'account created' is both isAuthEvent and isFirstEvent, so every user
-- auths on their very first event — user_id is present on ALL events and
-- there are zero device-only rows (asserted by story H1).
CREATE OR REPLACE VIEW us AS
SELECT distinct_id::VARCHAR AS duid, risk_profile
FROM read_json_auto('data/verify-insurance-application-USERS*.json', sample_size=-1, union_by_name=true);

CREATE OR REPLACE VIEW ev AS
SELECT e.user_id::VARCHAR AS uid, e.device_id::VARCHAR AS did, e.time::TIMESTAMP AS t,
       date_diff('day', DATE '2026-01-01', e.time::TIMESTAMP::DATE) AS day_idx,
       e.*
FROM read_json_auto('data/verify-insurance-application-EVENTS*.json', sample_size=-1, union_by_name=true) e;

-- Per-user aggregates. H8 deletes 75% of post-day-30 events for born
-- non-uploaders, so reads needing undistorted per-user tallies (H4, H10)
-- restrict to the H8-untouched population: (NOT born) OR uploader.
CREATE OR REPLACE VIEW pu AS
SELECT uid, min(t) AS first_t,
  count(*) FILTER (WHERE event = 'account created') AS acct_created,
  count(*) FILTER (WHERE event = 'application step completed') AS steps,
  count(*) FILTER (WHERE event = 'application approved') AS approvals,
  count(*) FILTER (WHERE event = 'application submitted') AS submits,
  count(*) FILTER (WHERE event = 'claim filed') AS claims,
  count(*) FILTER (WHERE event = 'payment made') AS payments
FROM ev GROUP BY 1;

CREATE OR REPLACE VIEW puu AS
SELECT p.*, p.acct_created > 0 AS born,
  ((SELECT count(*) FROM ev e WHERE e.uid = p.uid AND e.event = 'document uploaded'
      AND e.t <= p.first_t + INTERVAL '14 days') >= 3) AS uploader
FROM pu p;

CREATE OR REPLACE VIEW h4pop AS
SELECT * FROM puu WHERE (NOT born) OR uploader;

-- ── H1-version-bands: app_version is a pure function of timestamp ──
-- Expect: zero violations, four crisp bands.
SELECT app_version, count(*) AS events,
  min(t) AS first_seen, max(t) AS last_seen
FROM ev GROUP BY 1 ORDER BY 1;

SELECT count(*) AS version_violations FROM ev
WHERE app_version != CASE
  WHEN t < TIMESTAMP '2026-01-31 00:00:00' THEN '2.10'
  WHEN t < TIMESTAMP '2026-03-02 00:00:00' THEN '2.11'
  WHEN t < TIMESTAMP '2026-04-21 23:59:59' THEN '2.12'
  ELSE '2.13' END;

-- ── H2-ticket-drop: volume collapse + bug categories vanish ──
-- Expect: v2.13 daily rate ~0.3x the final-v2.12 rate; bug-category share
-- ~0.67 pre-release, EXACTLY ZERO post (survivors are recategorized).
SELECT
  count(*) FILTER (WHERE day_idx BETWEEN 101 AND 110) / 10.0 AS v212_last10_per_day,
  count(*) FILTER (WHERE day_idx BETWEEN 111 AND 120) / 10.0 AS v213_per_day
FROM ev WHERE event = 'support ticket created';

SELECT
  avg((issue_category IN ('form_crash','login_error','page_timeout','payment_failure'))::INT)
    FILTER (WHERE t < TIMESTAMP '2026-04-21 23:59:59') AS bug_share_pre,
  count(*) FILTER (WHERE issue_category IN ('form_crash','login_error','page_timeout','payment_failure')
    AND t >= TIMESTAMP '2026-04-21 23:59:59') AS bug_tickets_post
FROM ev WHERE event = 'support ticket created';

-- ── H3-activation-gap: policy activated flatlines pre-v2.13 ──
-- Expect: ~28x per-day step-up on release (1/0.05 gate x organic drift);
-- approvals are untouched (H5 pins them near each user's start).
SELECT
  count(*) FILTER (WHERE t < TIMESTAMP '2026-04-21 23:59:59') / 111.0 AS act_pre_per_day,
  count(*) FILTER (WHERE t >= TIMESTAMP '2026-04-21 23:59:59') / 10.0 AS act_post_per_day
FROM ev WHERE event = 'policy activated';

-- ── H4-step-magic: sweet-spot premium boost + over-engagement drop ──
-- Expect: sweet/base avg approved_premium ~1.35x; over/sweet
-- approvals-per-submit ~0.5x (raw per-user is activity-confounded).
SELECT
  (SELECT avg(e.approved_premium) FROM ev e JOIN h4pop p ON e.uid = p.uid
     WHERE e.event = 'application approved' AND p.steps BETWEEN 8 AND 14) AS sweet_avg_premium,
  (SELECT avg(e.approved_premium) FROM ev e JOIN h4pop p ON e.uid = p.uid
     WHERE e.event = 'application approved' AND p.steps < 8) AS base_avg_premium,
  (SELECT sum(approvals)::DOUBLE / nullif(sum(submits), 0) FROM h4pop WHERE steps >= 15) AS over_app_per_submit,
  (SELECT sum(approvals)::DOUBLE / nullif(sum(submits), 0) FROM h4pop WHERE steps BETWEEN 8 AND 14) AS sweet_app_per_submit;

-- ── H5-ttc-account-type: started→approved gap pinned per account type ──
-- Expect: medians ~37h (business) / ~50h (individual) / ~65h (family);
-- support exactly [target, target+4h). Born users only (account_type
-- lives on the "account created" event).
WITH acct AS (SELECT uid, min(account_type) AS account_type FROM ev WHERE event = 'account created' GROUP BY 1),
fs AS (SELECT uid, min(t) AS first_started FROM ev WHERE event = 'application started' GROUP BY 1),
gaps AS (SELECT a.account_type, date_diff('second', f.first_started, e.t) / 3600.0 AS gap_h
  FROM ev e JOIN fs f ON e.uid = f.uid JOIN acct a ON e.uid = a.uid
  WHERE e.event = 'application approved')
SELECT account_type, count(*) AS n, median(gap_h) AS med_h, min(gap_h) AS min_h, max(gap_h) AS max_h
FROM gaps GROUP BY 1 ORDER BY med_h;

-- ── H6-claims-experiment: engine-native A/B on Claims Process ──
-- Expect: ~50/50 split, zero exposures before end−35d, Simplified ~1.3x
-- completion (49h window covers the 0.8x-compressed variant TTC).
SELECT "Variant name" AS variant, count(*) AS exposures, count(DISTINCT uid) AS users,
  count(*) FILTER (WHERE t < TIMESTAMP '2026-03-27 23:59:59') AS pre_start_exposures
FROM ev WHERE event = '$experiment_started' GROUP BY 1;

WITH expusers AS (SELECT uid, min("Variant name") AS variant FROM ev WHERE event = '$experiment_started'
  GROUP BY 1 HAVING count(DISTINCT "Variant name") = 1),
claimwin AS (SELECT c.uid,
  (EXISTS (SELECT 1 FROM ev s WHERE s.uid = c.uid AND s.event = 'claim status checked'
      AND s.t > c.t AND s.t <= c.t + INTERVAL 49 HOUR
      AND EXISTS (SELECT 1 FROM ev k WHERE k.uid = c.uid AND k.event = 'support ticket created'
          AND k.t > s.t AND k.t <= c.t + INTERVAL 49 HOUR))) AS completed
  FROM ev c WHERE c.event = 'claim filed' AND c.t >= TIMESTAMP '2026-03-27 23:59:59')
SELECT x.variant, count(*) AS instances, avg(w.completed::INT) AS completion_49h
FROM claimwin w JOIN expusers x ON w.uid = x.uid GROUP BY 1;

-- ── H7-risk-approval: funnel-pre conversion multipliers ──
-- Expect approvals-per-submit low/med ~1.15x, high/med ~0.71x (partial-step
-- walk compresses the 1.8x/0.3x knobs: p = c + (1−c)/2 → 0.975/0.85/0.605).
SELECT u.risk_profile, count(*) AS users,
  sum(p.approvals)::DOUBLE / nullif(sum(p.submits), 0) AS approvals_per_submit
FROM puu p JOIN us u ON p.uid = u.duid GROUP BY 1 ORDER BY 1;

-- ── H8-doc-retention: churn for born non-uploaders ──
-- Expect DiD (nonup post/pre ÷ up post/pre) ~0.25-0.30. Small cohorts even
-- at 15K (~240 non-uploaders / ~45 uploaders born before Mar 2).
WITH h8pop AS (SELECT p.*,
  (SELECT count(*) FROM ev e WHERE e.uid = p.uid AND e.t <= p.first_t + INTERVAL '30 days') AS pre_n,
  (SELECT count(*) FROM ev e WHERE e.uid = p.uid AND e.t > p.first_t + INTERVAL '30 days') AS post_n
FROM puu p WHERE p.born AND p.first_t < TIMESTAMP '2026-03-02')
SELECT
  (SELECT sum(post_n)::DOUBLE / sum(pre_n) FROM h8pop WHERE NOT uploader) AS nonup_post_pre,
  (SELECT sum(post_n)::DOUBLE / sum(pre_n) FROM h8pop WHERE uploader) AS up_post_pre,
  (SELECT count(*) FROM h8pop WHERE NOT uploader) AS nonup_users,
  (SELECT count(*) FROM h8pop WHERE uploader) AS up_users;

-- ── H9-renewal-spike: end-of-quarter clone burst, days 85-94 ──
-- Expect renewals ~3x and coverage reviews ~1.8-2x a LOCAL baseline
-- (days 75-84 ∪ 96-105; day 95 skipped — clone jitter bleeds into Apr 6).
SELECT event,
  count(*) FILTER (WHERE t > TIMESTAMP '2026-03-27' AND t < TIMESTAMP '2026-04-06') / 10.0 AS spike_per_day,
  count(*) FILTER (WHERE (day_idx BETWEEN 75 AND 84) OR (day_idx BETWEEN 96 AND 105)) / 20.0 AS local_base_per_day
FROM ev WHERE event IN ('renewal completed', 'coverage reviewed') GROUP BY 1;

-- ── H10-claim-premium: one-shot doubling after claim ──
-- Expect: zero payments > 600 among H8-untouched non-claimants (organic
-- premium caps at 600); claimant/non-claimant avg ~1.5x (only ~half of a
-- claimant's payments double — the 2.0x lives on the doubled payments).
SELECT
  (SELECT count(*) FROM ev e JOIN puu p ON e.uid = p.uid
     WHERE e.event = 'payment made' AND e.premium_amount > 600 AND p.claims = 0
       AND ((NOT p.born) OR p.uploader)) AS gt600_untouched_nonclaimants,
  (SELECT count(*) FROM ev e JOIN puu p ON e.uid = p.uid
     WHERE e.event = 'payment made' AND e.premium_amount > 600 AND p.claims > 0) AS gt600_claimants,
  (SELECT avg(e.premium_amount) FROM ev e JOIN puu p ON e.uid = p.uid
     WHERE e.event = 'payment made' AND p.claims > 0) AS claimant_avg,
  (SELECT avg(e.premium_amount) FROM ev e JOIN puu p ON e.uid = p.uid
     WHERE e.event = 'payment made' AND p.claims = 0) AS nonclaimant_avg;
