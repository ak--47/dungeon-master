-- Keystead Homes (real-estate vertical): story and eval queries
--
-- Generate first (repo root):
--   node scripts/verify-runner.mjs dungeons/vertical/real-estate/real-estate.js verify-real-estate
-- Run:
--   duckdb -c ".read dungeons/vertical/real-estate/real-estate.sql"
-- Against another export (plain or gzipped):
--   duckdb -c "SET VARIABLE data_prefix='<dir>/real-estate'" -c ".read real-estate.sql"
--
-- Every timestamp is UTC. Sections: -- STORY H<n> (one per hook in real-estate.js)
-- and -- EVAL Q<n> (one per question in eval/real-estate.eval.md).

SET VARIABLE data_prefix = COALESCE(getvariable('data_prefix'), 'data/verify-real-estate');

-- ── prelude: data, identity, warehouse ────────────────────────────────────
CREATE OR REPLACE TEMP TABLE raw_events AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-EVENTS*.json*', sample_size=-1, union_by_name=true);

CREATE OR REPLACE TEMP TABLE users AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-USERS*.json*', sample_size=-1, union_by_name=true);

-- Identity: a device belongs to the shopper seen with it on any event that
-- carries both ids ("account created" stitches the anonymous browsing before
-- signup). Server-side events carry user_id only. uid = resolved shopper.
CREATE OR REPLACE TEMP TABLE dmap AS
SELECT device_id, min(user_id::VARCHAR) AS mapped
FROM raw_events WHERE user_id IS NOT NULL AND device_id IS NOT NULL GROUP BY 1;

CREATE OR REPLACE TEMP TABLE ev AS
SELECT coalesce(e.user_id::VARCHAR, m.mapped) AS uid, e.time::TIMESTAMP AS t, e.*
FROM raw_events e LEFT JOIN dmap m ON e.device_id = m.device_id;

CREATE OR REPLACE TEMP TABLE wh_spend AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-marketing_spend_daily.json*', sample_size=-1, union_by_name=true);
CREATE OR REPLACE TEMP TABLE wh_rates AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-mortgage_rate_sheet_daily.json*', sample_size=-1, union_by_name=true);
CREATE OR REPLACE TEMP TABLE wh_inventory AS
SELECT * FROM read_json_auto(getvariable('data_prefix') || '-WAREHOUSE-market_inventory_daily.json*', sample_size=-1, union_by_name=true);

-- conventional 30-yr rate by day; rate bands used by H1/H3
CREATE OR REPLACE TEMP TABLE conv_rate AS
SELECT date::DATE AS d, note_rate_pct AS rate,
  CASE WHEN note_rate_pct < 6.40 THEN 'base' WHEN note_rate_pct >= 6.95 THEN 'high' ELSE 'mid' END AS band
FROM wh_rates WHERE loan_type = 'conventional';

-- completed tours with the first offer on the same listing within 14 days
-- (Funnels: tour completed → offer submitted, Totals, hold listing_id, 14-day window)
CREATE OR REPLACE TEMP TABLE tour_offers AS
WITH tc AS (SELECT uid, listing_id, t AS t0, buyer_preapproved AS pa, booking_type FROM ev WHERE event = 'tour completed'),
os AS (SELECT uid, listing_id, min(t) AS t1 FROM ev WHERE event = 'offer submitted' GROUP BY 1, 2)
SELECT tc.*, r.rate, r.band, os.t1,
  coalesce(os.t1 >= tc.t0 AND os.t1 < tc.t0 + INTERVAL 14 DAY, false) AS conv,
  date_diff('second', tc.t0, os.t1) / 3600.0 AS hours
FROM tc JOIN conv_rate r ON r.d = tc.t0::DATE
LEFT JOIN os ON os.uid = tc.uid AND os.listing_id = tc.listing_id;

SELECT 'prelude' AS section, (SELECT count(*) FROM ev) AS events, (SELECT count(*) FROM users) AS profiles,
  (SELECT count(*) FROM ev WHERE uid IS NULL) AS unresolved_events,
  (SELECT count(DISTINCT uid) FROM ev) AS shoppers_with_events;

-- ═════════════════════════════════════════════════════════════════════════
-- STORY H1-rate-spike-cools-offers: offers per completed tour, high-rate days
-- vs baseline days, standardized to the baseline buyer_preapproved mix (knob 0.70)
SELECT 'H1' AS story, b.pa, b.tours AS base_tours, b.cr AS base_offer_rate, h.tours AS high_tours, h.cr AS high_offer_rate, h.cr / b.cr AS ratio
FROM (SELECT pa, count(*) AS tours, avg(conv::INT) AS cr FROM tour_offers WHERE band = 'base' AND t0 < TIMESTAMP '2026-09-17 23:59:59' GROUP BY 1) b
JOIN (SELECT pa, count(*) AS tours, avg(conv::INT) AS cr FROM tour_offers WHERE band = 'high' AND t0 < TIMESTAMP '2026-09-17 23:59:59' GROUP BY 1) h USING (pa)
ORDER BY pa;

WITH g AS (SELECT band, pa, count(*) AS tours, avg(conv::INT) AS cr FROM tour_offers WHERE t0 < TIMESTAMP '2026-09-17 23:59:59' GROUP BY 1, 2)
SELECT 'H1' AS story, sum(b.tours * h.cr) / sum(b.tours * b.cr) AS std_ratio_high_vs_base
FROM g b JOIN g h ON h.pa = b.pa AND b.band = 'base' AND h.band = 'high';

-- H1 control: listing-page tour requests per saved listing do not move with the rate
SELECT 'H1 control' AS story, per,
  count(*) FILTER (WHERE event = 'tour requested' AND request_source = 'listing_page')::DOUBLE / count(*) FILTER (WHERE event = 'listing saved') AS tours_per_save
FROM (SELECT CASE WHEN r.band = 'high' THEN 'high' WHEN r.band = 'base' AND ev.t >= TIMESTAMP '2026-07-22' THEN 'base_post_launch' END AS per, ev.event, ev.request_source
      FROM ev JOIN conv_rate r ON r.d = ev.t::DATE WHERE ev.event IN ('tour requested', 'listing saved'))
WHERE per IS NOT NULL GROUP BY 2 ORDER BY 2;

-- ═════════════════════════════════════════════════════════════════════════
-- STORY H2-tour-it-now-launch: listing-page tour requests per saved listing,
-- Jun 4-Jul 14 vs from Jul 22 (knob 1.5); no tour_it_now before launch
SELECT 'H2' AS story, per,
  count(*) FILTER (WHERE event = 'tour requested' AND request_source = 'listing_page') AS listing_page_requests,
  count(*) FILTER (WHERE event = 'listing saved') AS saves,
  count(*) FILTER (WHERE event = 'tour requested' AND request_source = 'listing_page')::DOUBLE / count(*) FILTER (WHERE event = 'listing saved') AS tours_per_save,
  count(*) FILTER (WHERE event = 'tour requested' AND booking_type = 'tour_it_now') AS tour_it_now_requests,
  count(*) FILTER (WHERE event = 'tour requested' AND booking_type = 'tour_it_now')::DOUBLE / count(*) FILTER (WHERE event = 'tour requested' AND request_source = 'listing_page') AS tour_it_now_share
FROM (SELECT CASE WHEN t < TIMESTAMP '2026-07-15' THEN '1_before' WHEN t >= TIMESTAMP '2026-07-22' THEN '2_after' END AS per, event, request_source, booking_type
      FROM ev WHERE event IN ('tour requested', 'listing saved'))
WHERE per IS NOT NULL GROUP BY 2 ORDER BY 2;

-- ═════════════════════════════════════════════════════════════════════════
-- STORY H3-preapproved-buyers-offer: offer rate per completed tour by
-- buyer_preapproved, inside rate bands, pooled by band tour count (knob 2.5)
WITH g AS (SELECT band, pa, count(*) AS tours, avg(conv::INT) AS cr FROM tour_offers WHERE t0 < TIMESTAMP '2026-09-17 23:59:59' GROUP BY 1, 2),
w AS (SELECT band, sum(tours) AS nb FROM g GROUP BY 1),
p AS (SELECT g.pa, sum(w.nb * g.cr) / sum(w.nb) AS std_rate FROM g JOIN w USING (band) GROUP BY 1)
SELECT 'H3' AS story, max(std_rate) FILTER (WHERE pa) AS preapproved_rate, max(std_rate) FILTER (WHERE NOT pa) AS not_preapproved_rate,
  max(std_rate) FILTER (WHERE pa) / max(std_rate) FILTER (WHERE NOT pa) AS ratio
FROM p;

-- ═════════════════════════════════════════════════════════════════════════
-- STORY H4-saved-search-retention: new shoppers (signup by Aug 6), listing
-- viewed on day 28-55, non-savers / savers (knob 0.5)
CREATE OR REPLACE TEMP TABLE h4 AS
WITH b AS (SELECT uid, t AS t0 FROM ev WHERE event = 'account created' AND t <= TIMESTAMP '2026-08-06 23:59:59')
SELECT b.uid,
  bool_or(e.event = 'saved search created' AND e.t >= b.t0 AND e.t < b.t0 + INTERVAL 7 DAY) AS saver,
  bool_or(e.event = 'listing viewed' AND e.t >= b.t0 + INTERVAL 28 DAY AND e.t < b.t0 + INTERVAL 56 DAY) AS ret
FROM b JOIN ev e ON e.uid = b.uid GROUP BY 1;
SELECT 'H4' AS story, saver, count(*) AS shoppers, avg(ret::INT) AS retention_d28_55 FROM h4 GROUP BY 2 ORDER BY 2;

-- ═════════════════════════════════════════════════════════════════════════
-- STORY H5-speed-to-lead: tour requested (same listing) within 7 days of the
-- agent's reply, by response_minutes; slow (> 60) / fast (≤ 10) (knob 0.4)
CREATE OR REPLACE TEMP TABLE replies AS
WITH a AS (SELECT uid, listing_id, t AS t0, response_minutes AS m FROM ev WHERE event = 'agent responded'),
q AS (SELECT uid, listing_id, min(t) AS t1 FROM ev WHERE event = 'tour requested' GROUP BY 1, 2)
SELECT a.*, CASE WHEN m <= 10 THEN '1_fast' WHEN m > 60 THEN '3_slow' ELSE '2_mid' END AS bucket,
  coalesce(q.t1 >= a.t0 AND q.t1 < a.t0 + INTERVAL 7 DAY, false) AS toured
FROM a LEFT JOIN q ON q.uid = a.uid AND q.listing_id = a.listing_id;
SELECT 'H5' AS story, bucket, count(*) AS replies, avg(toured::INT) AS tour_rate
FROM replies WHERE t0 < TIMESTAMP '2026-09-24 23:59:59' GROUP BY 2 ORDER BY 2;

-- ═════════════════════════════════════════════════════════════════════════
-- STORY H6-paid-social-economics: spend per signup and per pre-approval start
-- (within 30 days of signup), signups and spend before Sep 2
CREATE OR REPLACE TEMP TABLE h6 AS
WITH s AS (SELECT uid, t AS t0, acquisition_channel AS ch FROM ev WHERE event = 'account created' AND t < TIMESTAMP '2026-09-01 23:59:59'),
p AS (SELECT s.uid FROM s JOIN ev e ON e.uid = s.uid AND e.event = 'pre-approval started' AND e.t >= s.t0 AND e.t < s.t0 + INTERVAL 30 DAY GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM wh_spend WHERE date::DATE < DATE '2026-09-02' GROUP BY 1),
g AS (SELECT s.ch, count(*) AS signups, count(p.uid) AS starts FROM s LEFT JOIN p ON p.uid = s.uid GROUP BY 1)
SELECT g.ch, g.signups, g.starts, g.starts::DOUBLE / g.signups AS start_rate, sp.spend,
  sp.spend / g.signups AS spend_per_signup, sp.spend / nullif(g.starts, 0) AS spend_per_start
FROM g LEFT JOIN sp ON sp.ch = g.ch;
SELECT 'H6' AS story, * FROM h6 ORDER BY ch;
SELECT 'H6' AS story,
  (SELECT spend_per_signup FROM h6 WHERE ch = 'paid_social') / (SELECT spend_per_signup FROM h6 WHERE ch = 'paid_search') AS spend_per_signup_social_vs_search,
  (SELECT start_rate FROM h6 WHERE ch = 'paid_social') / (SELECT sum(starts)::DOUBLE / sum(signups) FROM h6 WHERE ch <> 'paid_social') AS start_rate_social_vs_rest,
  (SELECT spend_per_start FROM h6 WHERE ch = 'paid_social') / (SELECT spend_per_start FROM h6 WHERE ch = 'paid_search') AS spend_per_start_social_vs_search;

-- ═════════════════════════════════════════════════════════════════════════
-- STORY H7-austin-feed-outage: Austin / other listing views on stale days vs
-- 14 days either side (knob 0.45); no new listings or alerts while stale
WITH o AS (SELECT DISTINCT date::DATE AS d FROM wh_inventory WHERE feed_status = 'stale'),
w AS (SELECT t::DATE AS d, market = 'Austin' AS aus FROM ev
      WHERE event = 'listing viewed' AND t >= TIMESTAMP '2026-08-10' AND t < TIMESTAMP '2026-09-14'),
g AS (SELECT d IN (SELECT d FROM o) AS stale, count(*) FILTER (WHERE aus)::DOUBLE / count(*) FILTER (WHERE NOT aus) AS rel FROM w GROUP BY 1)
SELECT 'H7' AS story, (SELECT count(*) FROM o) AS stale_days,
  max(rel) FILTER (WHERE stale) AS austin_rel_stale, max(rel) FILTER (WHERE NOT stale) AS austin_rel_around,
  max(rel) FILTER (WHERE stale) / max(rel) FILTER (WHERE NOT stale) AS did
FROM g;
SELECT 'H7' AS story, sum(i.new_listings) AS stale_new_listings,
  (SELECT count(*) FROM ev WHERE event = 'listing alert sent' AND market = 'Austin' AND t >= TIMESTAMP '2026-08-24' AND t < TIMESTAMP '2026-08-31') AS stale_austin_alerts
FROM wh_inventory i WHERE i.feed_status = 'stale';

-- ═════════════════════════════════════════════════════════════════════════
-- STORY H8-payment-estimate-experiment: pre-approval started within 14 days
-- of exposure (exposures through Sep 17), variant / Control (knob 1.4)
CREATE OR REPLACE TEMP TABLE h8 AS
WITH x AS (SELECT uid, t AS t0, "Variant name" AS v FROM ev WHERE event = '$experiment_started' AND t < TIMESTAMP '2026-09-17 23:59:59'),
p AS (SELECT uid, min(t) AS t1 FROM ev WHERE event = 'pre-approval started' GROUP BY 1)
SELECT x.v, count(*) AS exposed, sum(coalesce(p.t1 > x.t0 AND p.t1 < x.t0 + INTERVAL 14 DAY, false)::INT) AS starts_14d,
  avg(coalesce(p.t1 > x.t0 AND p.t1 < x.t0 + INTERVAL 14 DAY, false)::INT) AS start_rate
FROM x LEFT JOIN p ON p.uid = x.uid GROUP BY 1;
SELECT 'H8' AS story, *, start_rate / (SELECT start_rate FROM h8 WHERE v = 'Control') AS vs_control FROM h8 ORDER BY v;
SELECT 'H8 purity' AS story, count(*) FILTER (WHERE e.entry_point = 'payment_estimate' AND (e.t < TIMESTAMP '2026-07-29' OR u."Experiment: Payment Estimate" IS DISTINCT FROM 'Payment Estimate')) AS impure
FROM ev e LEFT JOIN users u ON u.distinct_id::VARCHAR = e.uid WHERE e.event = 'pre-approval started';

-- ═════════════════════════════════════════════════════════════════════════
-- STORY H9-time-to-offer-by-buyer-type: median hours tour completed → offer
-- submitted (same listing, 14 days), vs move_up (knobs 1.75 and 0.5)
CREATE OR REPLACE TEMP TABLE h9 AS
SELECT u.buyer_type, count(*) AS offers, median(o.hours) AS med_hours, avg(o.hours) AS avg_hours
FROM tour_offers o JOIN users u ON u.distinct_id::VARCHAR = o.uid
WHERE o.conv AND o.t0 < TIMESTAMP '2026-09-17 23:59:59' GROUP BY 1;
SELECT 'H9' AS story, *, med_hours / (SELECT med_hours FROM h9 WHERE buyer_type = 'move_up') AS vs_move_up FROM h9 ORDER BY med_hours;

-- ═════════════════════════════════════════════════════════════════════════
-- STORY H10-price-cuts-get-saved: listing saved / listing viewed by price_reduced (knob 1.8)
CREATE OR REPLACE TEMP TABLE h10 AS
SELECT price_reduced, count(*) FILTER (WHERE event = 'listing viewed') AS views, count(*) FILTER (WHERE event = 'listing saved') AS saves,
  count(*) FILTER (WHERE event = 'listing saved')::DOUBLE / count(*) FILTER (WHERE event = 'listing viewed') AS save_rate
FROM ev WHERE event IN ('listing saved', 'listing viewed') GROUP BY 1;
SELECT 'H10' AS story, *, save_rate / (SELECT save_rate FROM h10 WHERE NOT price_reduced) AS vs_original FROM h10 ORDER BY price_reduced;

-- ═════════════════════════════════════════════════════════════════════════
-- EVAL Q1: rate spike and offers. Offer rate per completed tour by rate band
-- (the H1 queries above give the standardized ratio)
SELECT 'Q1' AS q, band, count(*) AS tours, sum(conv::INT) AS offers, avg(conv::INT) AS offer_rate,
  min(t0)::DATE AS first_day, max(t0)::DATE AS last_day, avg(rate) AS avg_rate
FROM tour_offers WHERE t0 < TIMESTAMP '2026-09-17 23:59:59' GROUP BY 2 ORDER BY 2;
SELECT 'Q1 weekly' AS q, date_trunc('week', t0)::DATE AS wk, count(*) AS tours, avg(conv::INT) AS offer_rate, avg(rate) AS avg_rate
FROM tour_offers WHERE t0 < TIMESTAMP '2026-09-17 23:59:59' GROUP BY 2 ORDER BY 2;

-- EVAL Q2: Tour It Now. Listing-page requests per save (H2 above) and weekly requests by booking type
SELECT 'Q2 weekly' AS q, date_trunc('week', t)::DATE AS wk,
  count(*) FILTER (WHERE event = 'tour requested' AND booking_type = 'scheduled') AS scheduled,
  count(*) FILTER (WHERE event = 'tour requested' AND booking_type = 'tour_it_now') AS tour_it_now,
  count(*) FILTER (WHERE event = 'tour completed') AS tours_completed,
  count(*) FILTER (WHERE event = 'tour requested' AND request_source = 'listing_page')::DOUBLE / count(*) FILTER (WHERE event = 'listing saved') AS listing_page_per_save
FROM ev WHERE event IN ('tour requested', 'tour completed', 'listing saved') GROUP BY 2 ORDER BY 2;
SELECT 'Q2 completion' AS q, booking_type, count(*) FILTER (WHERE event = 'tour requested') AS requested, count(*) FILTER (WHERE event = 'tour completed') AS completed
FROM ev WHERE event IN ('tour requested', 'tour completed') AND t >= TIMESTAMP '2026-07-22' GROUP BY 2 ORDER BY 2;

-- EVAL Q3: pre-approval and offers. Raw full-window rates and rates before the climb (H3 gives the band-standardized ratio)
SELECT 'Q3' AS q, pa, count(*) AS tours, avg(conv::INT) AS offer_rate_all,
  avg(conv::INT) FILTER (WHERE t0 < TIMESTAMP '2026-08-10') AS offer_rate_before_aug10
FROM tour_offers WHERE t0 < TIMESTAMP '2026-09-17 23:59:59' GROUP BY 2 ORDER BY 2;

-- EVAL Q4: saved search retention (H4 above) plus the early saved-search share
SELECT 'Q4' AS q, count(*) AS new_shoppers, avg(saver::INT) AS saver_share,
  avg(ret::INT) FILTER (WHERE saver) AS saver_ret, avg(ret::INT) FILTER (WHERE NOT saver) AS non_saver_ret
FROM h4;

-- EVAL Q5: speed to lead. Buckets (H5 above), median response, share answered within 10 minutes
SELECT 'Q5' AS q, count(*) AS replies, median(m) AS median_minutes, avg((m <= 10)::INT) AS within_10, avg((m > 60)::INT) AS over_60,
  avg(toured::INT) AS overall_tour_rate
FROM replies WHERE t0 < TIMESTAMP '2026-09-24 23:59:59';

-- EVAL Q6: CAC by channel (H6 above) plus full-window spend and signups
SELECT 'Q6 window' AS q, s.acquisition_channel, s.spend, c.signups, s.spend / c.signups AS spend_per_signup, s.leads_reported, s.spend / s.leads_reported AS cost_per_platform_lead
FROM (SELECT acquisition_channel, sum(spend_usd) AS spend, sum(leads_reported) AS leads_reported FROM wh_spend GROUP BY 1) s
JOIN (SELECT acquisition_channel, count(*) AS signups FROM ev WHERE event = 'account created' GROUP BY 1) c USING (acquisition_channel)
ORDER BY 2;
SELECT 'Q6 signups' AS q, acquisition_channel, count(*) AS signups FROM ev WHERE event = 'account created' GROUP BY 2 ORDER BY 3 DESC;

-- EVAL Q7: Austin in late August. Daily Austin views and warehouse feed status
SELECT 'Q7' AS q, i.date::DATE AS d, i.feed_status, i.new_listings, v.austin_views, v.other_views, v.austin_views::DOUBLE / v.other_views AS austin_rel
FROM wh_inventory i
JOIN (SELECT t::DATE AS d, count(*) FILTER (WHERE market = 'Austin') AS austin_views, count(*) FILTER (WHERE market <> 'Austin') AS other_views
      FROM ev WHERE event = 'listing viewed' GROUP BY 1) v ON v.d = i.date::DATE
WHERE i.market = 'Austin' AND i.date::DATE BETWEEN DATE '2026-08-17' AND DATE '2026-09-06' ORDER BY 2;

-- EVAL Q8: Payment Estimate experiment (H8 above) plus entry points by arm
SELECT 'Q8 entry' AS q, coalesce(u."Experiment: Payment Estimate", 'not in test') AS arm, e.entry_point, count(*) AS starts
FROM ev e LEFT JOIN users u ON u.distinct_id::VARCHAR = e.uid
WHERE e.event = 'pre-approval started' AND e.t >= TIMESTAMP '2026-07-29' GROUP BY 2, 3 ORDER BY 2, 3;

-- EVAL Q9: time from tour to offer by buyer type (H9 above), overall median
SELECT 'Q9' AS q, count(*) AS offers, median(hours) AS med_hours FROM tour_offers WHERE conv AND t0 < TIMESTAMP '2026-09-17 23:59:59';

-- EVAL Q10: price cuts and saves (H10 above), share of views on reduced listings
SELECT 'Q10' AS q, sum(views) FILTER (WHERE price_reduced)::DOUBLE / sum(views) AS reduced_view_share FROM h10;

-- EVAL Q11: the rate sheet. Conventional rate path, other loan types, applications
SELECT 'Q11' AS q, loan_type,
  avg(note_rate_pct) FILTER (WHERE date::DATE < DATE '2026-08-10') AS avg_rate_before_aug10,
  max(note_rate_pct) AS max_rate,
  avg(note_rate_pct) FILTER (WHERE date::DATE BETWEEN DATE '2026-08-17' AND DATE '2026-09-13') AS avg_rate_aug17_sep13,
  avg(note_rate_pct) FILTER (WHERE date::DATE >= DATE '2026-09-28') AS avg_rate_from_sep28,
  sum(applications) AS applications
FROM wh_rates GROUP BY 2 ORDER BY 2;
SELECT 'Q11 high days' AS q, min(d) AS first_day_at_or_above_6_95, max(d) AS last_day_at_or_above_6_95, count(*) AS days FROM conv_rate WHERE rate >= 6.95;

-- EVAL Q12 (null): are Tour It Now tours worse leads than scheduled tours?
-- Offer within 14 days per completed tour (same listing), tours Jul 22-Sep 17
CREATE OR REPLACE TEMP TABLE q12 AS
SELECT coalesce(pa::VARCHAR, 'all') AS seg, booking_type, count(*) AS n, avg(conv::INT) AS r
FROM tour_offers WHERE t0 >= TIMESTAMP '2026-07-22' AND t0 < TIMESTAMP '2026-09-17 23:59:59'
GROUP BY GROUPING SETS ((booking_type), (pa, booking_type));
SELECT 'Q12' AS q, a.seg AS buyer_preapproved, a.n AS tour_it_now_tours, a.r AS tour_it_now_offer_rate, b.n AS scheduled_tours, b.r AS scheduled_offer_rate,
  (a.r - b.r) / sqrt(((a.r * a.n + b.r * b.n) / (a.n + b.n)) * (1 - (a.r * a.n + b.r * b.n) / (a.n + b.n)) * (1.0 / a.n + 1.0 / b.n)) AS z
FROM q12 a JOIN q12 b ON a.seg = b.seg AND a.booking_type = 'tour_it_now' AND b.booking_type = 'scheduled' ORDER BY 2;

-- offer acceptance per submitted offer (used in Q18)
CREATE OR REPLACE TEMP TABLE offer_outcomes AS
WITH o AS (SELECT uid, listing_id, t, buyer_preapproved AS pa, market FROM ev WHERE event = 'offer submitted'),
oc AS (SELECT uid, listing_id, max((event = 'offer accepted')::INT) AS acc FROM ev WHERE event IN ('offer accepted', 'offer rejected') GROUP BY 1, 2)
SELECT o.*, oc.acc FROM o JOIN oc USING (uid, listing_id);

-- EVAL Q13 (null): does the way a shopper contacts the agent change tour conversion?
CREATE OR REPLACE TEMP TABLE chats AS
WITH c AS (SELECT uid, listing_id, t AS t0, contact_method, market FROM ev WHERE event = 'agent contacted' AND t < TIMESTAMP '2026-09-23 23:59:59'),
q AS (SELECT uid, listing_id, min(t) AS t1 FROM ev WHERE event = 'tour requested' GROUP BY 1, 2)
SELECT c.*, coalesce(q.t1 >= c.t0 AND q.t1 < c.t0 + INTERVAL 8 DAY, false) AS toured
FROM c LEFT JOIN q ON q.uid = c.uid AND q.listing_id = c.listing_id;
WITH g AS (SELECT contact_method, count(*) AS n, sum(toured::INT) AS k FROM chats GROUP BY 1),
tot AS (SELECT sum(k)::DOUBLE / sum(n) AS p FROM g)
SELECT 'Q13' AS q, g.contact_method, g.n AS chats, g.k::DOUBLE / g.n AS tour_rate,
  sum((g.k - g.n * tot.p) ^ 2 / (g.n * tot.p * (1 - tot.p))) OVER () AS chi2_df2
FROM g, tot ORDER BY 2;
WITH g AS (SELECT market, contact_method, count(*) AS n, sum(toured::INT) AS k FROM chats GROUP BY 1, 2),
tot AS (SELECT market, sum(k)::DOUBLE / sum(n) AS p FROM g GROUP BY 1)
SELECT 'Q13 by market' AS q, g.market, sum((g.k - g.n * tot.p) ^ 2 / (g.n * tot.p * (1 - tot.p))) AS chi2_df2
FROM g JOIN tot USING (market) GROUP BY 2 ORDER BY 2;

-- EVAL Q14: Austin new listings around the feed outage (warehouse)
SELECT 'Q14' AS q, date::DATE AS d, market, feed_status, new_listings, active_listings, price_reductions
FROM wh_inventory WHERE market = 'Austin' AND date::DATE BETWEEN DATE '2026-08-20' AND DATE '2026-09-03' ORDER BY 2;
SELECT 'Q14 typical' AS q, avg(new_listings) FILTER (WHERE date::DATE BETWEEN DATE '2026-08-03' AND DATE '2026-08-23') AS austin_avg_new_3wk_before,
  max(new_listings) FILTER (WHERE date::DATE = DATE '2026-08-31') AS austin_new_aug31
FROM wh_inventory WHERE market = 'Austin';

-- EVAL Q15: pre-approvals. Weekly starts and completions, quoted rates, profile status
SELECT 'Q15 weekly' AS q, date_trunc('week', t)::DATE AS wk,
  count(*) FILTER (WHERE event = 'pre-approval started') AS started, count(*) FILTER (WHERE event = 'pre-approval completed') AS completed
FROM ev WHERE event IN ('pre-approval started', 'pre-approval completed') GROUP BY 2 ORDER BY 2;
SELECT 'Q15 totals' AS q, count(*) FILTER (WHERE event = 'pre-approval started') AS started, count(*) FILTER (WHERE event = 'pre-approval completed') AS completed,
  count(*) FILTER (WHERE event = 'pre-approval started' AND t < TIMESTAMP '2026-07-29') / 55.0 * 7 AS starts_per_week_before_jul29,
  count(*) FILTER (WHERE event = 'pre-approval started' AND t >= TIMESTAMP '2026-07-29') / 65.0 * 7 AS starts_per_week_from_jul29,
  median(rate_quoted_pct) FILTER (WHERE event = 'pre-approval completed' AND t < TIMESTAMP '2026-08-10') AS median_quoted_rate_before_aug10,
  median(rate_quoted_pct) FILTER (WHERE event = 'pre-approval completed' AND t >= TIMESTAMP '2026-08-17' AND t < TIMESTAMP '2026-09-14') AS median_quoted_rate_aug17_sep13
FROM ev WHERE event IN ('pre-approval started', 'pre-approval completed');
SELECT 'Q15 status' AS q, preapproval_status, count(*) AS profiles FROM users GROUP BY 2 ORDER BY 3 DESC;

-- EVAL Q16: growth. Monthly active shoppers (listing viewed or home search) and signups
SELECT 'Q16 monthly' AS q, strftime(t, '%Y-%m') AS month, count(DISTINCT uid) FILTER (WHERE event IN ('listing viewed', 'home search')) AS active_shoppers,
  count(*) FILTER (WHERE event = 'account created') AS signups, count(*) FILTER (WHERE event = 'listing viewed') AS listing_views
FROM ev GROUP BY 2 ORDER BY 2;
SELECT 'Q16 weekly' AS q, date_trunc('week', t)::DATE AS wk, count(DISTINCT uid) FILTER (WHERE event IN ('listing viewed', 'home search')) AS weekly_active,
  count(*) FILTER (WHERE event = 'account created') AS signups
FROM ev GROUP BY 2 ORDER BY 2;

-- EVAL Q17 (open-ended): headline numbers used in the answer
SELECT 'Q17' AS q,
  (SELECT count(*) FROM ev WHERE event = 'offer submitted') AS offers,
  (SELECT count(*) FROM ev WHERE event = 'offer accepted') AS accepted,
  (SELECT count(*) FROM ev WHERE event = 'offer submitted' AND t >= TIMESTAMP '2026-07-20' AND t < TIMESTAMP '2026-08-17') / 4.0 AS offers_per_week_jul20_aug16,
  (SELECT count(*) FROM ev WHERE event = 'offer submitted' AND t >= TIMESTAMP '2026-08-17' AND t < TIMESTAMP '2026-09-14') / 4.0 AS offers_per_week_aug17_sep13,
  (SELECT count(*) FROM ev WHERE event = 'offer submitted' AND t >= TIMESTAMP '2026-09-14' AND t < TIMESTAMP '2026-09-28') / 2.0 AS offers_per_week_sep14_27;

-- EVAL Q18: offers, acceptance, homes under contract, by market
SELECT 'Q18' AS q, market, count(*) AS offers, sum(acc) AS accepted, avg(acc) AS accept_rate FROM offer_outcomes GROUP BY ROLLUP(market) ORDER BY 2 NULLS LAST;
SELECT 'Q18 price' AS q, count(*) AS accepted, median(final_price_usd) AS median_final_price, count(DISTINCT uid) AS buyers
FROM ev WHERE event = 'offer accepted';
SELECT 'Q18 offer vs list' AS q, median(offer_price_usd::DOUBLE / list_price_usd) AS median_offer_to_list FROM ev WHERE event = 'offer submitted';

-- EVAL Q19: anonymous browsing before signup (identity stitching)
WITH s AS (SELECT uid, device_id, t AS t0 FROM ev WHERE event = 'account created'),
pre AS (SELECT s.uid, count(e.time) AS n FROM s LEFT JOIN raw_events e ON e.device_id = s.device_id AND e.user_id IS NULL AND e.event = 'listing viewed' AND e.time::TIMESTAMP < s.t0 GROUP BY 1)
SELECT 'Q19' AS q, count(*) AS new_shoppers, avg(n) AS avg_views_before_signup, median(n) AS median_views, avg((n <= 1)::INT) AS share_one_or_none,
  avg((n >= 4)::INT) AS share_four_plus,
  (SELECT count(*) FROM raw_events WHERE user_id IS NULL) AS anonymous_events,
  (SELECT count(*) FROM raw_events WHERE user_id IS NULL AND device_id IN (SELECT device_id FROM dmap)) AS anonymous_events_stitched
FROM pre;

-- EVAL Q20 (open-ended): channel quality beyond pre-approval (tours within 30 days of signup)
WITH s AS (SELECT uid, t AS t0, acquisition_channel AS ch FROM ev WHERE event = 'account created' AND t < TIMESTAMP '2026-09-01 23:59:59'),
x AS (SELECT s.uid, s.ch, bool_or(e.event = 'tour completed' AND e.t >= s.t0 AND e.t < s.t0 + INTERVAL 30 DAY) AS toured,
      bool_or(e.event = 'offer submitted' AND e.t >= s.t0 AND e.t < s.t0 + INTERVAL 30 DAY) AS offered
      FROM s JOIN ev e ON e.uid = s.uid GROUP BY 1, 2)
SELECT 'Q20' AS q, x.ch, count(*) AS signups, avg(toured::INT) AS tour_30d, avg(offered::INT) AS offer_30d,
  any_value(h6.spend) / nullif(sum(toured::INT), 0) AS spend_per_touring_signup
FROM x LEFT JOIN h6 ON h6.ch = x.ch GROUP BY 2 ORDER BY 2;
