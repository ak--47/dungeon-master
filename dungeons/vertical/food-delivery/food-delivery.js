// ── IMPORTS ──
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);
import "dotenv/config";
import * as u from "@ak--47/dungeon-master/utils";
import { hashFloat, cloneEvent } from "@ak--47/dungeon-master/hook-helpers";
/** @typedef  {import("../../../types").Dungeon} Config */

// ── OVERVIEW ──
/*
 * NAME:       Forkfly
 * APP:        Food delivery app (iOS, Android) that works with a curated set of
 *             about 24 local restaurants in each of 8 US cities (New York,
 *             Chicago, Atlanta, Miami, Boston, Austin, Denver, Seattle).
 *             Customers browse or search, add items, check out, track the
 *             courier, and rate the order. Revenue: delivery fee ($1.99-4.99),
 *             a service fee (10% of subtotal; 15% for non-Pass orders from
 *             2026-08-11), tips pass through to couriers. Forkfly Pass
 *             ($9.99/month, 14-day free trial) waives the delivery fee on orders
 *             of $15+ and cuts the service fee to 5%.
 * SCALE:      10,000 customers (≈4,160 sign up inside the window), ~0.81M
 *             events, ~42,400 orders, 120 days (2026-06-04 → 2026-10-01, UTC)
 * CORE LOOP:  app opened → restaurant viewed → item added to cart → checkout
 *             started → order placed → order delivered → order rated
 * VALUE MOMENT: order delivered
 *
 * EVENTS (19):
 *   restaurant viewed > item added to cart > app opened > order tracking viewed
 *   > checkout started > order placed > order delivered > search performed
 *   > pass offer viewed > reorder tapped > order rated > $experiment_started
 *   > account created > support contacted > address saved > pass trial started
 *   > pass trial ended > payment failed > pass cancelled
 *
 * FUNNELS (2 declared):
 *   - Signup (first funnel): account created → address saved (88%)
 *   - Session (weight 1, 100%): app opened → restaurant viewed → item added to
 *     cart → checkout started → order placed → order delivered. A template: the
 *     everything hook decides how far each session goes, re-times every step,
 *     and builds the delivery, tracking, rating, support, Pass, and payment
 *     events by cloning the user's own events. Carries the Smart Add-ons
 *     experiment (multipliers 1.0; the hook applies the effect).
 *
 * USER PROPS:  city, platform, household_type, favorite_cuisine,
 *              acquisition_channel, customer_since, default_payment,
 *              pass_status, "Experiment: Smart Add-ons"
 * SUPER PROPS: city (sticky per customer), platform (ios/android, from the
 *              phone's OS), pass_status (none / trial / member at event time)
 * SCD PROPS:   none
 * GROUPS:      none
 * WAREHOUSE:   marketing_spend_daily (spend by paid channel),
 *              payment_gateway_daily (authorizations and declines by payment
 *              method), market_ops_daily (orders dispatched, weather, couriers
 *              by city)
 * LOOKUPS:     none — the restaurant catalog (id, name, cuisine, price tier,
 *              rating) is denormalized onto events
 * SOUP:        Friday-Sunday heavy dayOfWeekWeights; lunch (15-19 UTC) and
 *              dinner (22-03 UTC) peaks for US time zones
 *
 * IDENTITY: a new customer is identified at "account created" (isAuthEvent,
 * first event, user_id + device_id). One device per customer. Every event
 * carries user_id; there is no anonymous browsing in the data. "address saved"
 * (the post-auth signup step) carries user_id only; every other event also
 * carries device_id. platform agrees with the engine's os field; Apple Pay only
 * appears on iOS and Google Pay only on Android.
 *
 * DESIGN NOTES:
 * - Sessions: each engine "app opened" is a session start (the soup gives meal
 *   peaks). A session that opens while the previous one is still running is
 *   dropped. Browse sessions: 15% stop on the home feed (app opened only);
 *   the rest have an optional search, 1-4 restaurant views, a cart (58%),
 *   checkout (78% of carts). Order Again sessions (H10) skip browsing and
 *   refill the cart the customer built on one of their last three orders
 *   (same items and count; 30% of reorders at a price drift of -4% to +6%);
 *   checkout-screen add-ons (H5) and top-ups (H8) are offered again, not copied.
 *   Time from app opened to order placed is log-normal (median 16 min browse).
 * - Checkout: quoted ETA (log-normal, median 36 min), fees from Pass status and
 *   date, payment method (the customer's default 90% of the time). Conversion =
 *   ETA curve (H3) x fee factor (H9); then 2% everyday payment failures and the
 *   card incident (H4). A placed order is delivered quoted ETA + minutes_late
 *   later; minutes_late ~ normal(3, 10) + 12 on rainy days (H2).
 * - Restaurants: 24 per city, deterministic from hashFloat (name, cuisine,
 *   price tier, rating, popularity). Customers return to 3 favorites 45% of
 *   the time. Items per cart follow household_type; item prices follow tier.
 * - Pass: 18% of established customers are members on June 4 (20% cancel over
 *   the window); never-trialed non-members see the free-trial offer on 50% of
 *   checkouts and 8% of offers start a trial (one trial per customer). 4% of
 *   established non-members are mid-trial on June 4 (trial ends from June 4),
 *   so trial endings are flat from week 1. Their orders_during_trial adds
 *   an estimate for the pre-June trial days (the customer's visits on the
 *   same number of days right after the trial x the knob-derived June
 *   orders-per-visit rate), so no in-window order counts twice. "pass trial
 *   ended" fires server-side whether or not the customer still uses the app.
 * - New customers' first order carries a welcome promo (WELCOME8, or DEAL15 for
 *   coupon affiliates); later orders carry FORK5 4% of the time.
 * - Support: 3% of orders, rising to about 28% for very late ones.
 * - Ratings: 42% of orders; delivery_rating falls with minutes_late.
 * - Warehouse drift: orders_dispatched adds phone and partner-site orders (0-16%
 *   plus 0-14 a day per city) and nets cancellations; auth_attempts adds web
 *   orders and retries; spend is part paced budget, part per-signup, with
 *   seeded day noise. Audit correlations 0.93-0.99.
 * - Growth: new customers arrive steadily (~240 a week), so weekly sessions
 *   and orders grow through the window; Order Again lifts orders from July.
 */

// ── HOOK STORIES ──
/*
 * All effects are hidden: no flag properties. Dates live in the TIMELINE
 * constants and are shared by hooks, stories, SQL, warehouse columns, and the
 * timeline guide.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H1. LATE FIRST ORDER (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: after a new customer's first delivered order, they leave Forkfly
 *   with a chance that rises with minutes_late (logistic centered at 15 min,
 *   softness 2.5 min, plateau 0.45). Integrated over the lateness distribution
 *   (rain included), the 30-day repeat rate after a 15+ minute late first
 *   delivery is 0.647x the on-time rate.
 * MIXPANEL: Funnels, order delivered (filter: first time ever) → order
 *   placed, 30-day window (Mixpanel's default),
 *   cohort "did account created" in the window, date range Jun 4 - Aug 31,
 *   breakdown step 1 minutes_late (custom buckets < 15, >= 15). The
 *   first-time filter matters: a breakdown on a step-1 property runs one
 *   funnel per bucket, so without it a kept customer's later late
 *   deliveries enter the late bucket and the ratio reads about 0.9.
 *   A churned customer opens no session after the first delivery; that
 *   order's rating and support contact still arrive.
 * REAL WORLD: a cold, late first meal is the end of a new relationship.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H2. RAINY DAYS (everything + warehouse market_ops_daily; external join)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: on rainy days (4+ mm in market_ops_daily.precipitation_mm, by city
 *   and UTC date) customers open the app 1.4x as often (dry-day sessions kept
 *   at 1/1.4), so orders per city-day are 1.4x the city's dry-day mean.
 *   Deliveries on rainy days run 12 minutes later against the quote (couriers
 *   are scarce; the warehouse shows more orders per active courier). Checkout
 *   conversion does not change.
 * MIXPANEL: Insights, order placed, daily, breakdown city, joined to
 *   market_ops_daily on date + city; order delivered average minutes_late,
 *   rainy vs dry days.
 * REAL WORLD: rain is the best and worst day for a delivery business.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H3. QUOTED ETA THRESHOLD (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: the checkout → order rate falls smoothly with quoted_eta_mins
 *   (logistic centered at 45 min, softness 3 min); plateaus are solved so
 *   quotes <= 45 min convert 80% and longer quotes 48% on average (0.6x).
 * MIXPANEL: Funnels, checkout started → order placed, Totals, hold order_id
 *   constant, 1-hour window, breakdown step 1 quoted_eta_mins (custom buckets
 *   <= 45, > 45).
 * REAL WORLD: past 45 minutes, people cook or call the pizza place.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H4. CARD PROCESSOR INCIDENT (everything + warehouse payment_gateway_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-08-25 to 2026-08-28, 60% of card payments that would have
 *   gone through fail (payment failed, decline_code processor_unavailable)
 *   and the order is lost. Apple Pay, Google Pay, and PayPal are untouched.
 *   The warehouse marks card major_outage with decline_rate ≈ 0.61.
 * MIXPANEL: Funnels, checkout started → order placed, Totals, hold order_id,
 *   1-hour window, breakdown payment_method, daily; join
 *   payment_gateway_daily.gateway_status.
 * REAL WORLD: a payment outage looks like "demand fell" until you split by method.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H5. SMART ADD-ONS EXPERIMENT (Session funnel experiment + everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-07-28 customers split 50/50 (exposure 1 s before their
 *   first checkout on or after the start). The variant checkout screen
 *   suggests a dessert, drink, or side; 40% of variant orders add one, so
 *   items per order rise by 0.4 (pre-period adjusted) and the basket by
 *   about $2; checkout → order conversion is unchanged.
 * MIXPANEL: Insights (or Experiments), order placed, average items_count and
 *   subtotal_usd, breakdown "Experiment: Smart Add-ons", Jul 28 - Oct 1 vs
 *   Jun 4 - Jul 27; Funnels checkout started → order placed by arm.
 * REAL WORLD: "complete your meal" prompts raise basket size at no conversion cost.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H6. CHANNEL ECONOMICS (everything + warehouse marketing_spend_daily;
 *     external join)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: spend per Mixpanel signup $9 coupon affiliates, $18 paid social,
 *   $26 paid search. Half of coupon-affiliate customers leave after their
 *   discounted first order, so their 30-day repeat rate is 0.5x the other
 *   channels' and spend per repeat customer is level with paid social (1.0).
 * MIXPANEL: Insights, account created by acquisition_channel joined to
 *   marketing_spend_daily.spend_usd; Funnels order delivered → order placed,
 *   30-day window, cohort "did account created" in the window, date range
 *   Jun 4 - Aug 31, breakdown user property acquisition_channel (the
 *   first-time-ever filter on step 1 gives the same result here).
 * REAL WORLD: deal-site customers come for the coupon, not the restaurant.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H7. PASS TRIAL TWO-ORDER RULE (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: a 14-day Forkfly Pass trial converts to paid 65% of the time with
 *   2+ orders during the trial and 30% with 0-1. "pass trial ended" carries
 *   outcome and orders_during_trial.
 * MIXPANEL: Insights, pass trial ended, share outcome = converted, breakdown
 *   orders_during_trial (0-1, 2+), customers who did pass trial started in
 *   the window.
 * REAL WORLD: members who feel the free delivery twice keep paying for it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H8. PASS FREE-DELIVERY MINIMUM (everything; magic-number threshold)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 60% of Pass orders (trial or member) with a $10-14.99 subtotal add
 *   an item that lifts them to $15.50-19.50, so among $10-19.99 orders the
 *   share under $15 is 0.4x for Pass vs non-Pass orders.
 * MIXPANEL: Insights, order placed, filter subtotal_usd 10-20, breakdown
 *   pass_status and subtotal_usd (custom buckets 10-15, 15-20).
 * REAL WORLD: a free-delivery minimum pulls baskets up to the line.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H9. SERVICE FEE CHANGE (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-08-11 the non-Pass service fee rises from 10% to 15% of the
 *   subtotal; non-Pass checkouts convert at 0.85x their earlier rate, Pass
 *   checkouts do not change.
 * MIXPANEL: Funnels, checkout started → order placed, Totals, hold order_id,
 *   1-hour window, breakdown pass_status, before vs after Aug 11.
 * REAL WORLD: fee increases show up at the last step, as abandoned checkouts.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H10. ORDER AGAIN LAUNCH (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-07-07 customers with a past delivery can reorder in one
 *   tap; adoption ramps over 21 days to about 30% of eligible sessions
 *   (habit x0.4-1.6 per customer). An Order Again session reaches order
 *   placed 0.35x as fast (median 5.6 vs 16 min) and ends in an order 2.34x as
 *   often as a browsing visit (browse visits include home-feed bounces).
 * MIXPANEL: Funnels, app opened → order placed, Totals, 60-minute window,
 *   median time to convert, breakdown step 2 entry_point; Jul 7 - Oct 1.
 *   Order rate: Insights, cohort "did reorder tapped", Jul 7 - Oct 1, totals
 *   A = order placed (entry_point = reorder), B = reorder tapped, C = order
 *   placed (entry_point != reorder), D = app opened; formula
 *   (A / B) / (C / (D - B)). Each Order Again visit has one reorder tapped.
 * REAL WORLD: most food orders are repeats; removing the browse step pays.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * EXPECTED METRICS SUMMARY (measured: data/verify-food-delivery, 2026-10-07,
 * full fidelity, 10,000 customers, 808,750 events, 42,431 orders)
 * ═════════════════════════════════════════════════════════════════════════
 * Hook | Metric                                          | Derivation                  | Expected | Measured
 * -----|-------------------------------------------------|-----------------------------|----------|---------
 * H1   | 30-day repeat, late (15+) / on-time first order | logistic churn, integrated  | 0.647    | 0.635 (40.4% vs 63.6%)
 * H2   | orders per city-day, rainy / dry mean           | RAIN_DEMAND_MULT            | 1.40     | 1.345
 * H2   | minutes_late, rainy − dry                       | RAIN_LATE_MIN               | 12.0     | 12.11
 * H3   | checkout → order, quote > 45 / <= 45 min        | PLACE_SLOW / PLACE_FAST     | 0.60     | 0.600 (43.7% vs 72.9%)
 * H4   | card conversion DiD, incident / ±14 days        | 1 − INCIDENT_FAIL           | 0.40     | 0.415
 * H4   | warehouse card decline_rate, incident days      | 1 − 0.98 × 0.4              | 0.608    | 0.610
 * H5   | items per order lift, pre-period adjusted       | ADDON_TAKE                  | 0.40     | 0.388 (raw arm diff 0.404)
 * H5   | checkout → order, variant / control             | no effect                   | 1.00     | 1.006
 * H5   | addon_suggestion items outside the variant      | exact purity                | 0        | 0
 * H6   | spend per signup, coupon / paid search          | 9 / 26                      | 0.346    | 0.343 ($8.92 vs $25.99)
 * H6   | 30-day repeat, coupon / other channels          | 1 − COUPON_CHURN            | 0.50     | 0.475 (31.4% vs 66.1%)
 * H6   | spend per repeat customer, coupon / paid social | (9 / 0.5) / 18              | 1.00     | 1.001 ($48.61 vs $48.56)
 * H7   | trial → paid, 2+ orders during trial            | TRIAL_CONV_HIGH             | 0.65     | 0.696
 * H7   | trial → paid, 0-1 orders during trial           | TRIAL_CONV_LOW              | 0.30     | 0.301
 * H7   | orders_during_trial vs orders placed            | exact                       | 0        | 0
 * H8   | share < $15 of $10-19.99 orders, Pass / non-Pass | 1 − BUMP_SHARE             | 0.40     | 0.381 (14.6% vs 38.4%)
 * H9   | non-Pass conversion DiD, after / before Aug 11  | FEE_KEEP                    | 0.85     | 0.843
 * H10  | median app opened → order, reorder / browse     | REORDER_TTC_MULT            | 0.35     | 0.348 (5.6 vs 16.1 min)
 * H10  | visit order rate, reorder / browse (Insights)   | 0.9 / (0.85 × 0.58 × 0.78)  | 2.34     | 2.200 (58.4% vs 26.6%)
 * H10  | reorder tapped before Jul 7                     | exact purity                | 0        | 0
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Noise notes: H1 rests on about 440 late first orders and H6's repeat read
 * on about 420 coupon first orders (relative SE about 7-8%), so both use the
 * knob as target with a half-effect ceiling. H4 rests on about 1,250 card
 * checkouts in the incident (half-effect ceiling). H5's lift is pre-period
 * adjusted because items per order follow household size and the arms can
 * differ in household mix; in this run the arms match (single 42.9% vs
 * 42.3%) and the raw difference (0.404) agrees with the adjusted lift. It
 * keeps a half-effect floor. H8 clusters on about 2,450 Pass customers
 * (half-effect ceiling). Unengineered: Smart Add-ons conversion by arm
 * (63.9% vs 63.5%, z = 0.80) and first-order rate by signup method (71.4-
 * 72.2%, every |z| < 0.5). iOS vs Android checkout conversion (66.8% vs
 * 65.9%, z = -2.3) has no engineered cause: about 0.2 points come from the
 * card incident (Android customers pay by card more often) and the rest is
 * this run's draw, so the eval does not use platform as a null question.
 */

// ── SCALE ──
const SEED = "harness-food";
const NUM_USERS = 10_000;
const DATASET_START = "2026-06-04T00:00:00Z";
const DATASET_END = "2026-10-01T23:59:59Z"; // 120 days
const EVENTS_PER_DAY = 1.2;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── TIMELINE (shared by hooks, stories, SQL, warehouse columns, guides) ──
const REORDER_LAUNCH = "2026-07-07T00:00:00Z";      // "Order Again" button ships on iOS and Android
const ADDONS_START = "2026-07-28T00:00:00Z";        // "Smart Add-ons" A/B test starts on the checkout screen
const FEE_CHANGE = "2026-08-11T00:00:00Z";          // service fee for non-Pass orders 10% → 15%
const PAY_INCIDENT_START = "2026-08-25T00:00:00Z";  // card processor incident starts
const PAY_INCIDENT_END = "2026-08-29T00:00:00Z";    // exclusive (4 days: Aug 25-28)

const ms = (iso) => dayjs.utc(iso).valueOf();
const DAY_MS = 86_400_000;
const MIN_MS = 60_000;
const SEC_MS = 1000;
const WINDOW_DAYS = 120;

// ── WEEKLY AND DAILY RHYTHM (soup) ──
// Sun..Sat. Friday to Sunday dinners are the busiest; Monday-Tuesday the quietest.
const DOW_WEIGHTS = [1.0, 0.8, 0.78, 0.82, 0.88, 0.98, 0.95];
// UTC hours. Customers are in US time zones (ET 56%, CT 25%, MT 9%, PT 10%):
// lunch (11:30-13:30 local) lands at 15-19 UTC, dinner (18-21 local) at 22-03 UTC.
const HOUR_WEIGHTS = [0.9, 0.7, 0.5, 0.32, 0.2, 0.12, 0.08, 0.06, 0.06, 0.07, 0.09, 0.13,
	0.2, 0.28, 0.4, 0.6, 0.78, 0.74, 0.58, 0.52, 0.56, 0.72, 0.92, 1.0];

// ── MARKETS ──
// share of customers, summer chance of a rainy day, typical high (°F)
const CITIES = {
	"New York": { code: "nyc", w: 22, rain: 0.2, temp: 84 },
	"Chicago": { code: "chi", w: 15, rain: 0.2, temp: 82 },
	"Boston": { code: "bos", w: 11, rain: 0.19, temp: 80 },
	"Atlanta": { code: "atl", w: 12, rain: 0.27, temp: 89 },
	"Miami": { code: "mia", w: 11, rain: 0.34, temp: 90 },
	"Austin": { code: "aus", w: 10, rain: 0.12, temp: 95 },
	"Denver": { code: "den", w: 9, rain: 0.15, temp: 87 },
	"Seattle": { code: "sea", w: 10, rain: 0.1, temp: 76 },
};
const CITY_NAMES = Object.keys(CITIES);

// ── KNOBS ──
// H1 late first order: a new customer whose first delivery is late may not come back
const LATE_MEAN_MIN = 3;            // minutes_late ~ normal(mean, sd) (+ rain), rounded
const LATE_SD_MIN = 10;
const LATE_THRESHOLD_MIN = 15;      // "late" = 15+ minutes past the promised time
const LATE_SOFT_MIN = 2.5;          // logistic softness of the churn response
const LATE_CHURN = 0.45;            // churn chance after a very late first order (logistic plateau)

// H2 rain: rainy days bring more orders, and couriers run late
const RAIN_DAY_MM = 4;              // rainy day = 4+ mm of precipitation (every rainy draw is >= 4 mm)
const RAIN_DEMAND_MULT = 1.4;       // app sessions (and so orders) per customer on rainy days vs dry days
const RAIN_LATE_MIN = 12;           // extra minutes late on rainy days (the ETA model ignores weather)

// H3 quoted ETA: customers abandon checkout when the promised time is long
const ETA_MEDIAN_MIN = 36;
const ETA_SIGMA = 0.3;
const ETA_MIN = 15;
const ETA_MAX = 90;
const ETA_THRESHOLD_MIN = 45;
const ETA_SOFT_MIN = 3;
const PLACE_FAST = 0.8;             // average checkout → order rate for quotes <= 45 min
const PLACE_SLOW = 0.48;            // average checkout → order rate for quotes > 45 min (ratio 0.6)

// H4 card processor incident (warehouse payment_gateway_daily)
const BASE_PAY_FAIL = 0.02;         // everyday payment failures, every method
const INCIDENT_FAIL = 0.6;          // extra share of card payments that fail during the incident

// H5 Smart Add-ons experiment (checkout screen suggests a dessert, drink, or side)
const ADDONS_EXPERIMENT = "Smart Add-ons";
const ADDONS_VARIANT = "Smart Add-ons";
const EXP_KEY = `Experiment: ${ADDONS_EXPERIMENT}`;
const ADDON_TAKE = 0.4;             // share of variant orders that add one suggested item

// H6 acquisition channels (warehouse marketing_spend_daily)
const PAID_CHANNELS = ["paid_search", "paid_social", "coupon_affiliates"];
const CHANNEL_WEIGHTS = { organic: 28, referral: 10, paid_search: 18, paid_social: 22, coupon_affiliates: 22 };
const CPA_USD = { paid_search: 26, paid_social: 18, coupon_affiliates: 9 }; // window spend per Mixpanel signup
const COUPON_CHURN = 0.5;           // deal-site signups who leave after their discounted first order
const SPEND_PLAN_SHARE = { paid_search: 0.5, paid_social: 0.5, coupon_affiliates: 0.2 }; // paced budget share (rest is per-signup)
const SPEND_FLAT_SHARE = 0.4;
const SPEND_NOISE = 0.12;
const CPC_USD = { paid_search: 2.4, paid_social: 1.1, coupon_affiliates: 0.55 };
const CTR = { paid_search: 0.045, paid_social: 0.009, coupon_affiliates: 0.02 };
const NETWORK_SIGNUP_INFLATION = 1.15;

// H7 Forkfly Pass trial: conversion to paid depends on orders during the trial
const TRIAL_DAYS = 14;
const TRIAL_MAGIC_ORDERS = 2;
const TRIAL_CONV_LOW = 0.3;         // 0-1 orders during the trial
const TRIAL_CONV_HIGH = 0.65;       // 2+ orders during the trial
const PASS_OFFER_SHARE = 0.5;       // non-Pass checkouts that show the free-trial offer (never-trialed customers)
const TRIAL_ACCEPT = 0.08;          // offers that start a trial
const PREEXIST_PASS_SHARE = 0.18;   // established customers who are Pass members on June 4
const WARM_TRIAL_SHARE = 0.04;      // established non-members whose trial started in the 14 days before June 4
const PASS_CANCEL_SHARE = 0.2;      // members who cancel during a full 120-day window
const PASS_PRICE_USD = 9.99;

// H8 Pass free-delivery minimum: Pass members top up small baskets
const PASS_FREE_DELIVERY_MIN = 15;
const BUMP_FROM = 10;
const BUMP_SHARE = 0.6;             // Pass baskets of $10-14.99 topped up past $15

// H9 service fee change for non-Pass orders
const FEE_RATE_BEFORE = 0.1;
const FEE_RATE_AFTER = 0.15;
const PASS_FEE_RATE = 0.05;
const FEE_KEEP = 0.85;              // non-Pass checkout → order after the change, relative to before

// H10 "Order Again" launch: reorder sessions reach the order faster
const TTC_MEDIAN_MIN = 16;          // app opened → order placed, browsing sessions (log-normal median)
const TTC_SIGMA = 0.45;
const REORDER_TTC_MULT = 0.35;
const REORDER_SHARE = 0.3;          // mean share of eligible sessions that use Order Again once adoption ramps
const REORDER_RAMP_DAYS = 21;

// session shape (realism)
const P_BOUNCE = 0.15;              // browse visits that end on the home feed (a quick look, checking an order)
const P_SEARCH = 0.4;
const P_CART = 0.58;
const P_CHECKOUT = 0.78;
const P_REORDER_CHECKOUT = 0.9;
const P_RATE = 0.42;
const NO_ADDRESS_DAYS = 5;          // signups without a saved address browse a few days, then leave
const BORN_PCT = 42;

// ── DATA ──
const CUISINE_WEIGHTS = { american: 18, pizza: 16, mexican: 13, chinese: 11, japanese: 9, indian: 8, thai: 7, mediterranean: 7, italian: 6, healthy: 5 };
const TIER_WEIGHTS = { "$": 30, "$$": 45, "$$$": 20, "$$$$": 5 };
const ENTREE_PRICE = { "$": 10, "$$": 15, "$$$": 23, "$$$$": 34 };
const CATEGORY_PRICE_MULT = { entree: 1, side: 0.4, drink: 0.25, appetizer: 0.55, dessert: 0.4 };
const EXTRA_ITEM_WEIGHTS = { side: 30, drink: 25, appetizer: 20, dessert: 15, entree: 10 };
const ADDON_WEIGHTS = { dessert: 40, drink: 35, side: 25 };
const HOUSEHOLD_WEIGHTS = { single: 42, couple: 33, family: 25 };
const ITEMS_BY_HOUSEHOLD = {
	single: { 1: 45, 2: 40, 3: 15 },
	couple: { 2: 55, 3: 35, 4: 10 },
	family: { 2: 20, 3: 40, 4: 30, 5: 10 },
};
const NAME_PREFIX = ["Golden", "Corner", "Lucky", "Maple", "Blue Door", "Little", "Union", "Harbor", "Fifth Street", "Copper", "Red Lantern", "Old Town", "Sunset", "Green Leaf", "Iron", "Northside", "Velvet", "Half Moon", "Juniper", "Brick Lane"];
const NAME_SUFFIX = {
	american: ["Burger Bar", "Smokehouse", "Diner", "Grill", "Chicken Shack"],
	pizza: ["Pizzeria", "Slice Shop", "Pie Co.", "Pizza Kitchen"],
	mexican: ["Taqueria", "Cantina", "Burrito Co.", "Tacos"],
	chinese: ["Dumpling House", "Wok", "Noodle Bar", "Kitchen"],
	japanese: ["Sushi", "Ramen", "Izakaya", "Bento"],
	indian: ["Curry House", "Tandoor", "Masala", "Biryani"],
	thai: ["Thai Kitchen", "Noodle House", "Basil", "Thai Street"],
	mediterranean: ["Grill", "Falafel", "Kebab House", "Mezze"],
	italian: ["Trattoria", "Pasta Bar", "Osteria", "Cucina"],
	healthy: ["Salad Co.", "Bowls", "Greens", "Juice Bar"],
};
const SEARCH_TERMS = {
	american: ["burger", "fried chicken", "wings", "mac and cheese"], pizza: ["pizza", "pepperoni", "calzone"],
	mexican: ["tacos", "burrito", "quesadilla"], chinese: ["dumplings", "lo mein", "orange chicken"],
	japanese: ["sushi", "ramen", "poke"], indian: ["tikka masala", "biryani", "curry"],
	thai: ["pad thai", "green curry"], mediterranean: ["falafel", "shawarma", "gyro"],
	italian: ["pasta", "lasagna"], healthy: ["salad", "grain bowl", "smoothie"],
};
const RESTAURANTS_PER_CITY = 24;
const PAYMENT_BY_PLATFORM = {
	ios: { apple_pay: 45, card: 45, paypal: 10 },
	android: { google_pay: 30, card: 60, paypal: 10 },
};
const DECLINE_CODES = { insufficient_funds: 40, card_declined: 35, expired_card: 15, authentication_failed: 10 };
const SUPPORT_ISSUES = { missing_item: 45, wrong_item: 25, food_quality: 20, refund_request: 10 };
const CANCEL_REASONS = { not_ordering_enough: 35, too_expensive: 30, switching_apps: 15, moving: 5, other: 15 };

// ── HELPERS ──
const salt = (uid, tag) => hashFloat(`${uid}|${tag}`);
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
const T = (e) => dayjs.utc(e.time).valueOf();
const iso = (t) => new Date(t).toISOString();
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const byT = (a, b) => T(a) - T(b);
const coin = (p) => chance.bool({ likelihood: Math.max(0, Math.min(1, p)) * 100 });
const unif = (a, b) => a + (b - a) * chance.floating({ min: 0, max: 1, fixed: 8 });
const normal = () => chance.normal({ mean: 0, dev: 1 });
const logistic = (x) => 1 / (1 + Math.exp(-x));
const jitter = (key, spread) => 1 + (hashFloat(key) - 0.5) * 2 * spread;
const pickWeighted = (obj, r) => {
	const entries = Object.entries(obj);
	const total = entries.reduce((s, [, w]) => s + w, 0);
	let acc = 0;
	for (const [k, w] of entries) {
		acc += w / total;
		if (r < acc) return k;
	}
	return entries[entries.length - 1][0];
};
const pick = (obj) => pickWeighted(obj, chance.floating({ min: 0, max: 1, fixed: 8 }));
const weighted = (obj) => Object.entries(obj).flatMap(([k, w]) => Array(w).fill(k));
// deterministic standard normal from a key (Box-Muller on two hash draws)
const hashNormal = (key) => {
	const a = Math.max(1e-9, hashFloat(`${key}|a`));
	const b = hashFloat(`${key}|b`);
	return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
};
const erf = (x) => {
	const s = Math.sign(x);
	const z = Math.abs(x);
	const t = 1 / (1 + 0.3275911 * z);
	const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
	return s * y;
};
const Phi = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

// ── WEATHER (shared by the hook, the warehouse table, and the stories) ──
const precipitationMm = (date, city) => {
	const c = CITIES[city];
	if (!c) return 0;
	if (hashFloat(`rain|${date}|${city}`) < c.rain) {
		return round1(Math.min(60, RAIN_DAY_MM + 8 * Math.exp(0.9 * hashNormal(`rainmm|${date}|${city}`))));
	}
	const trace = hashFloat(`trace|${date}|${city}`);
	return trace < 0.3 ? round1(0.1 + trace * 6) : 0; // 0.1-1.9 mm drizzle on some dry days
};
const isRainy = (date, city) => precipitationMm(date, city) >= RAIN_DAY_MM;
const weatherCondition = (date, city) => {
	const mm = precipitationMm(date, city);
	if (mm >= 25) return "thunderstorm";
	if (mm >= RAIN_DAY_MM) return "rain";
	if (mm > 0) return "drizzle";
	return hashFloat(`cloud|${date}|${city}`) < 0.35 ? "cloudy" : "clear";
};
const tempHighF = (date, city) => Math.round((CITIES[city]?.temp ?? 80) + 5 * hashNormal(`temp|${date}|${city}`) - (isRainy(date, city) ? 6 : 0));
const WINDOW_DATES = Array.from({ length: WINDOW_DAYS }, (_, i) => dayjs.utc(DATASET_START).add(i, "day").format("YYYY-MM-DD"));

// ── RESTAURANT CATALOG (deterministic; denormalized onto events) ──
const RESTAURANTS = Object.fromEntries(CITY_NAMES.map((city) => {
	const list = Array.from({ length: RESTAURANTS_PER_CITY }, (_, i) => {
		const k = `rest|${city}|${i}`;
		const cuisine = pickWeighted(CUISINE_WEIGHTS, hashFloat(`${k}|cuisine`));
		const suffixes = NAME_SUFFIX[cuisine];
		return {
			restaurant_id: `rst_${CITIES[city].code}_${String(i + 1).padStart(2, "0")}`,
			restaurant_name: `${NAME_PREFIX[Math.floor(hashFloat(`${k}|pre`) * NAME_PREFIX.length)]} ${suffixes[Math.floor(hashFloat(`${k}|suf`) * suffixes.length)]}`,
			cuisine,
			price_tier: pickWeighted(TIER_WEIGHTS, hashFloat(`${k}|tier`)),
			restaurant_rating: round1(3.7 + 1.2 * hashFloat(`${k}|rating`)),
			popularity: 1 / Math.pow(i + 1, 0.7),
		};
	});
	return [city, list];
}));

// ── KNOB-DERIVED READS (exact math over the configured distributions) ──
// H3: solve the logistic plateaus so the bucket averages of the checkout → order
// rate are PLACE_FAST (quote <= 45 min) and PLACE_SLOW (quote > 45 min).
const ETA_PMF = (() => {
	const out = [];
	const mu = Math.log(ETA_MEDIAN_MIN);
	for (let m = ETA_MIN; m <= ETA_MAX; m++) {
		const lo = m === ETA_MIN ? -Infinity : (Math.log(m - 0.5) - mu) / ETA_SIGMA;
		const hi = m === ETA_MAX ? Infinity : (Math.log(m + 0.5) - mu) / ETA_SIGMA;
		out.push([m, Phi(hi) - Phi(lo)]);
	}
	return out;
})();
const etaShape = (m) => logistic((ETA_THRESHOLD_MIN - m) / ETA_SOFT_MIN);
const [PLACE_EARLY, PLACE_LATE] = (() => {
	let nF = 0, sF = 0, nS = 0, sS = 0;
	for (const [m, p] of ETA_PMF) {
		if (m <= ETA_THRESHOLD_MIN) { nF += p; sF += p * etaShape(m); } else { nS += p; sS += p * etaShape(m); }
	}
	const span = (PLACE_FAST - PLACE_SLOW) / (sF / nF - sS / nS);
	const late = PLACE_SLOW - span * (sS / nS);
	return [late + span, late];
})();
const placeProb = (eta) => PLACE_LATE + (PLACE_EARLY - PLACE_LATE) * etaShape(eta);
// H7 warm-start trials: expected orders per visit before Order Again and the fee change
// (browse visits only), used to estimate the trial days that fall before June 4
const PRE_ORDERS_PER_OPEN = (1 - P_BOUNCE) * P_CART * P_CHECKOUT * (1 - BASE_PAY_FAIL)
	* ETA_PMF.reduce((s, [m, p]) => s + p * placeProb(m), 0);

// H1: share of first orders on rainy days (realized rain calendar x the rain
// demand lift), then the 30-day repeat ratio late (15+ min) vs on time.
const RAIN_SESSION_SHARE = (() => {
	let wSum = 0, acc = 0;
	for (const city of CITY_NAMES) {
		const r = WINDOW_DATES.filter((d) => isRainy(d, city)).length / WINDOW_DAYS;
		acc += CITIES[city].w * (r * RAIN_DEMAND_MULT) / (r * RAIN_DEMAND_MULT + (1 - r));
		wSum += CITIES[city].w;
	}
	return acc / wSum;
})();
const lateChurn = (m) => LATE_CHURN * logistic((m - LATE_THRESHOLD_MIN) / LATE_SOFT_MIN);
const LATE_REPEAT_RATIO = (() => {
	let nL = 0, sL = 0, nO = 0, sO = 0;
	for (let m = -50; m <= 80; m++) {
		const pm = (mu) => Phi((m + 0.5 - mu) / LATE_SD_MIN) - Phi((m - 0.5 - mu) / LATE_SD_MIN);
		const p = (1 - RAIN_SESSION_SHARE) * pm(LATE_MEAN_MIN) + RAIN_SESSION_SHARE * pm(LATE_MEAN_MIN + RAIN_LATE_MIN);
		if (m >= LATE_THRESHOLD_MIN) { nL += p; sL += p * lateChurn(m); } else { nO += p; sO += p * lateChurn(m); }
	}
	return (1 - sL / nL) / (1 - sO / nO);
})();

// ── DERIVED HELPERS ──
const inPayIncident = (t) => t >= ms(PAY_INCIDENT_START) && t < ms(PAY_INCIDENT_END);
const serviceRate = (passActive, t) => (passActive ? PASS_FEE_RATE : t >= ms(FEE_CHANGE) ? FEE_RATE_AFTER : FEE_RATE_BEFORE);
const BORN_EXPECTED = NUM_USERS * BORN_PCT / 100;
const CHANNEL_TOTAL_W = Object.values(CHANNEL_WEIGHTS).reduce((a, b) => a + b, 0);
const DAILY_BUDGET_USD = Object.fromEntries(PAID_CHANNELS.map((ch) => [ch, CPA_USD[ch] * BORN_EXPECTED * (CHANNEL_WEIGHTS[ch] / CHANNEL_TOTAL_W) / WINDOW_DAYS]));
const SPEND_WEEKDAY = (() => {
	const m = DOW_WEIGHTS.reduce((a, b) => a + b, 0) / DOW_WEIGHTS.length;
	return DOW_WEIGHTS.map((w) => SPEND_FLAT_SHARE + (1 - SPEND_FLAT_SHARE) * w / m);
})();
const paidSpend = (date, ch, signups) => {
	const plan = SPEND_PLAN_SHARE[ch];
	return round2((plan * DAILY_BUDGET_USD[ch] * SPEND_WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()]
		+ (1 - plan) * CPA_USD[ch] * signups) * jitter(`spend|${date}|${ch}`, SPEND_NOISE));
};

// ── EVENT SCHEMA (declared properties per event; hooks only fill these) ──
const EVENT_PROPS = {
	"account created": ["signup_method", "acquisition_channel"],
	"address saved": ["address_type"],
	"app opened": ["open_source"],
	"search performed": ["search_term", "results_count"],
	"restaurant viewed": ["restaurant_id", "restaurant_name", "cuisine", "price_tier", "restaurant_rating"],
	"item added to cart": ["restaurant_id", "item_category", "item_price_usd", "added_from"],
	"reorder tapped": ["restaurant_id", "restaurant_name", "cuisine", "days_since_last_order"],
	"checkout started": ["order_id", "restaurant_id", "restaurant_name", "cuisine", "items_count", "subtotal_usd", "delivery_fee_usd", "service_fee_usd", "quoted_eta_mins", "payment_method", "entry_point"],
	"pass offer viewed": ["order_id", "offer_type"],
	"pass trial started": ["plan", "price_after_trial_usd"],
	"payment failed": ["order_id", "payment_method", "decline_code"],
	"order placed": ["order_id", "restaurant_id", "restaurant_name", "cuisine", "price_tier", "items_count", "subtotal_usd", "delivery_fee_usd", "service_fee_usd", "tip_usd", "discount_usd", "promo_code", "order_total_usd", "quoted_eta_mins", "payment_method", "entry_point"],
	"order tracking viewed": ["order_id", "order_status"],
	"order delivered": ["order_id", "restaurant_id", "delivery_minutes", "minutes_late"],
	"order rated": ["order_id", "restaurant_id", "food_rating", "delivery_rating"],
	"support contacted": ["order_id", "issue_type", "contact_channel"],
	"pass trial ended": ["outcome", "orders_during_trial"],
	"pass cancelled": ["cancel_reason", "months_subscribed"],
	"$experiment_started": ["Experiment name", "Variant name"],
};

// ── HOOKS ──
function handleUserHook(profile, meta) {
	const uid = profile.distinct_id;
	profile.city = pickWeighted(Object.fromEntries(CITY_NAMES.map((c) => [c, CITIES[c].w])), salt(uid, "city"));
	profile.household_type = pickWeighted(HOUSEHOLD_WEIGHTS, salt(uid, "household"));
	profile.favorite_cuisine = pickWeighted(CUISINE_WEIGHTS, salt(uid, "fav-cuisine"));
	if (meta.userIsBornInDataset) {
		profile.acquisition_channel = pickWeighted(CHANNEL_WEIGHTS, salt(uid, "channel"));
		profile.customer_since = dayKey(dayjs.utc(profile.created ?? meta.user?.created).valueOf());
		profile.pass_status = "none";
		return profile;
	}
	profile.acquisition_channel = pickWeighted({ organic: 40, referral: 14, paid_search: 18, paid_social: 18, coupon_affiliates: 10 }, salt(uid, "channel"));
	const tenureDays = Math.floor(salt(uid, "tenure") * (ms(DATASET_START) - ms("2024-03-01T00:00:00Z")) / DAY_MS);
	profile.customer_since = dayjs.utc("2024-03-01T00:00:00Z").add(tenureDays, "day").format("YYYY-MM-DD");
	profile.pass_status = salt(uid, "pass") < PREEXIST_PASS_SHARE ? "member" : "none";
	return profile;
}

function handleEverything(events, meta) {
	if (!events.length) return events;
	const profile = meta.profile;
	const uid = profile.distinct_id;
	const BEGIN = ms(DATASET_START), END = ms(DATASET_END);
	const city = profile.city;
	const signup = events.find((e) => e.event === "account created") || null;
	const address = events.find((e) => e.event === "address saved") || null;
	const signupT = signup ? T(signup) : null;

	// platform and wallet follow the customer's phone (one device per customer)
	const osEv = events.find((e) => e.os);
	const platform = osEv && osEv.os === "Android" ? "android" : "ios";
	profile.platform = platform;
	const wallet = PAYMENT_BY_PLATFORM[platform];
	const defaultPay = pickWeighted(wallet, salt(uid, "pay"));
	profile.default_payment = defaultPay;

	// templates: the first engine event of each name; every built event is a clone
	const tpl = {};
	for (const e of events) if (!tpl[e.event]) tpl[e.event] = { ...e };
	const fallback = tpl["app opened"] || tpl["account created"] || { ...events[0] };
	const make = (name, t, props) => {
		const src = tpl[name] || fallback;
		const ev = cloneEvent(src, { time: iso(t) });
		for (const k of EVENT_PROPS[src.event] || []) delete ev[k];
		ev.event = name;
		Object.assign(ev, props);
		return ev;
	};

	const exposures = events.filter((e) => e.event === "$experiment_started");
	const variant = exposures.length && profile[EXP_KEY] !== undefined ? profile[EXP_KEY] : null;

	// ── sessions: one engine "app opened" per session ──
	// H2: rainy days bring more sessions. Dry-day sessions survive at 1 / RAIN_DEMAND_MULT.
	const opens = events.filter((e) => e.event === "app opened").sort(byT)
		.filter((o) => isRainy(dayKey(T(o)), city) || coin(1 / RAIN_DEMAND_MULT));

	// ── Forkfly Pass state ──
	const passChanges = [{ t: -Infinity, s: profile.pass_status === "member" ? "member" : "none" }];
	const statusAt = (t) => {
		let s = passChanges[0].s;
		for (const c of passChanges) if (c.t <= t) s = c.s;
		return s;
	};
	const passActive = (t) => statusAt(t) !== "none";
	const passEvents = [];
	const orders = []; // { t, orderId, rest, items, cartItems, cartSubtotal, deliveredT, late }
	let trial = null;  // { start, end, preDays }
	let trialed = false;
	let memberSince = null;
	let cancelT = Infinity;
	const scheduleCancel = (from, share) => {
		if (!coin(share)) return Infinity;
		return Math.floor(from + unif(0, 1) * (END - from));
	};
	if (passChanges[0].s === "member") {
		memberSince = BEGIN - Math.floor(salt(uid, "member-since") * 300) * DAY_MS;
		cancelT = scheduleCancel(BEGIN, PASS_CANCEL_SHARE);
	} else if (!signup && salt(uid, "warm-trial") < WARM_TRIAL_SHARE) {
		// established non-member whose free trial began in the two weeks before June 4
		const start = BEGIN - Math.floor(salt(uid, "warm-trial-day") * TRIAL_DAYS * DAY_MS);
		trial = { start, end: start + TRIAL_DAYS * DAY_MS, preDays: (BEGIN - start) / DAY_MS };
		trialed = true;
		passChanges[0].s = "trial";
	}
	const advance = (t) => {
		for (;;) {
			const s = statusAt(Math.min(t, END));
			if (trial && s === "trial" && trial.end <= t && trial.end <= END) {
				const inTrial = orders.filter((o) => o.t >= trial.start && o.t < trial.end).length;
				// warm-start trials began before June 4. Billing saw the orders on those days; the
				// data does not. Estimate them from the customer's own visits on the same number of
				// days right after the trial (disjoint from the in-trial days, so no order counts twice).
				const preEnd = trial.end + trial.preDays * DAY_MS;
				const pre = trial.preDays
					? opens.filter((o) => T(o) >= trial.end && T(o) < preEnd && hashFloat(`${uid}|pre-trial|${T(o)}`) < PRE_ORDERS_PER_OPEN).length
					: 0;
				const n = inTrial + pre;
				const converted = coin(n >= TRIAL_MAGIC_ORDERS ? TRIAL_CONV_HIGH : TRIAL_CONV_LOW);
				passEvents.push(make("pass trial ended", trial.end, { outcome: converted ? "converted" : "not_converted", orders_during_trial: n }));
				passChanges.push({ t: trial.end, s: converted ? "member" : "none" });
				if (converted) {
					memberSince = trial.end;
					cancelT = scheduleCancel(trial.end + 7 * DAY_MS, PASS_CANCEL_SHARE * (END - trial.end) / (WINDOW_DAYS * DAY_MS));
				}
				trial = null;
				continue;
			}
			if (s === "member" && cancelT <= t && cancelT <= END) {
				const months = Math.max(1, Math.round((cancelT - memberSince) / (30 * DAY_MS)));
				passEvents.push(make("pass cancelled", cancelT, { cancel_reason: pick(CANCEL_REASONS), months_subscribed: months }));
				passChanges.push({ t: cancelT, s: "none" });
				cancelT = Infinity;
				continue;
			}
			break;
		}
	};

	// ── experiment: exposure at the first checkout on/after the start ──
	let exposureT = null;

	// ── per-session simulation (chronological) ──
	const sessionEvents = [];
	let cut = Infinity; // H1/H6: a churned new customer stops using the app
	const favorites = [0, 1, 2].map((i) => Math.floor(salt(uid, `fav${i}`) * RESTAURANTS_PER_CITY));
	const cityRest = RESTAURANTS[city] || RESTAURANTS["New York"];
	const popTotal = cityRest.reduce((s, r) => s + r.popularity, 0);
	const popularPick = () => {
		let r = unif(0, popTotal);
		for (const x of cityRest) { r -= x.popularity; if (r <= 0) return x; }
		return cityRest[cityRest.length - 1];
	};
	const pickRestaurant = () => (coin(0.45) ? cityRest[favorites[chance.integer({ min: 0, max: 2 })]] : popularPick());
	const reorderHabit = 0.4 + 1.2 * salt(uid, "reorder-habit");
	const household = profile.household_type || "single";
	const itemPrice = (rest, cat) => round2(ENTREE_PRICE[rest.price_tier] * CATEGORY_PRICE_MULT[cat] * unif(0.75, 1.25));
	const deliveryBase = (rest) => [1.99, 2.99, 3.99, 4.99][Math.floor(hashFloat(`dfee|${uid}|${rest.restaurant_id}`) * 4)];

	let busyUntil = -Infinity; // a session that opens while the previous one is still running is the same visit
	for (const open of opens) {
		const T0 = T(open);
		if (T0 >= cut || T0 > END || T0 < busyUntil) continue;
		advance(T0);
		const evs = [open];
		const browseOnly = signup && !address;
		if (browseOnly && T0 > signupT + NO_ADDRESS_DAYS * DAY_MS) continue;

		// path: Order Again (H10) or browse
		const lastDelivered = [...orders].reverse().find((o) => o.deliveredT && o.deliveredT < T0) || null;
		const ramp = Math.min(1, Math.max(0, (T0 - ms(REORDER_LAUNCH)) / (REORDER_RAMP_DAYS * DAY_MS)));
		const reorder = !browseOnly && lastDelivered && T0 >= ms(REORDER_LAUNCH) && coin(REORDER_SHARE * reorderHabit * ramp);
		// some browse visits stop at the home feed: no restaurant page, no cart
		if (!reorder && coin(P_BOUNCE)) {
			busyUntil = T0 + Math.round(unif(0.5, 4) * MIN_MS);
			sessionEvents.push(open);
			continue;
		}
		const ttcMin = Math.min(75, Math.max(reorder ? 1.5 : 3, TTC_MEDIAN_MIN * Math.exp(TTC_SIGMA * normal()) * (reorder ? REORDER_TTC_MULT : 1)));
		const orderT = T0 + Math.round(ttcMin * MIN_MS);
		const dwell = Math.round(Math.min(unif(20, 90) * SEC_MS, 0.4 * ttcMin * MIN_MS));
		let rest, items = 0, subtotal = 0, entry;
		let goCheckout = false;
		const browse = []; // [name, props] laid out between open and checkout

		if (reorder) {
			const recent = orders.slice(-3);
			const prev = recent[chance.integer({ min: 0, max: recent.length - 1 })];
			rest = prev.rest;
			entry = "reorder";
			browse.push(["reorder tapped", { restaurant_id: rest.restaurant_id, restaurant_name: rest.restaurant_name, cuisine: rest.cuisine, days_since_last_order: Math.max(0, Math.floor((T0 - prev.t) / DAY_MS)) }]);
			// one tap refills the cart the customer built on that order, at current menu prices
			// (checkout-screen add-ons and top-ups are offered again, not copied)
			items = prev.cartItems;
			subtotal = prev.cartSubtotal * (coin(0.7) ? 1 : unif(0.96, 1.06));
			goCheckout = coin(P_REORDER_CHECKOUT);
		} else {
			rest = pickRestaurant();
			const searched = coin(P_SEARCH);
			entry = searched ? "search" : "home_feed";
			if (searched) {
				const terms = SEARCH_TERMS[rest.cuisine];
				browse.push(["search performed", { search_term: terms[chance.integer({ min: 0, max: terms.length - 1 })], results_count: coin(0.04) ? 0 : chance.integer({ min: 3, max: 40 }) }]);
			}
			const nViews = Number(pick({ 1: 45, 2: 30, 3: 17, 4: 8 }));
			for (let i = 0; i < nViews; i++) {
				const r = i === nViews - 1 ? rest : popularPick();
				browse.push(["restaurant viewed", { restaurant_id: r.restaurant_id, restaurant_name: r.restaurant_name, cuisine: r.cuisine, price_tier: r.price_tier, restaurant_rating: r.restaurant_rating }]);
			}
			if (coin(P_CART)) {
				items = Number(pick(ITEMS_BY_HOUSEHOLD[household]));
				for (let i = 0; i < items; i++) {
					const cat = i === 0 ? "entree" : pick(EXTRA_ITEM_WEIGHTS);
					const price = itemPrice(rest, cat);
					subtotal += price;
					browse.push(["item added to cart", { restaurant_id: rest.restaurant_id, item_category: cat, item_price_usd: price, added_from: "menu" }]);
				}
				goCheckout = !browseOnly && coin(P_CHECKOUT);
			}
		}
		subtotal = round2(subtotal);
		const cartItems = items, cartSubtotal = subtotal;
		const checkoutT = orderT - dwell;
		const browseEnd = goCheckout ? checkoutT - 5 * SEC_MS : orderT;
		busyUntil = orderT + 2 * MIN_MS;
		browse.forEach(([name, props], i) => {
			const frac = (i + unif(0.2, 0.8)) / browse.length;
			evs.push(make(name, T0 + 5 * SEC_MS + Math.floor(frac * Math.max(SEC_MS, browseEnd - T0 - 5 * SEC_MS)), props));
		});

		if (goCheckout) {
			const orderId = `ord_${chance.hash({ length: 12 })}`;
			const eta = Math.round(Math.min(ETA_MAX, Math.max(ETA_MIN, ETA_MEDIAN_MIN * Math.exp(ETA_SIGMA * normal()))));
			const passAtCheckout = passActive(checkoutT);
			const pay = coin(0.9) ? defaultPay : pickWeighted(wallet, chance.floating({ min: 0, max: 1, fixed: 8 }));
			const dBase = deliveryBase(rest);
			const fees = (sub, active, t) => ({
				delivery_fee_usd: active && sub >= PASS_FREE_DELIVERY_MIN ? 0 : dBase,
				service_fee_usd: round2(sub * serviceRate(active, t)),
			});
			// experiment exposure: the first checkout on/after the start
			if (variant && exposureT === null && checkoutT >= ms(ADDONS_START) && checkoutT <= END) exposureT = checkoutT - SEC_MS;
			evs.push(make("checkout started", checkoutT, {
				order_id: orderId, restaurant_id: rest.restaurant_id, restaurant_name: rest.restaurant_name, cuisine: rest.cuisine,
				items_count: items, subtotal_usd: subtotal, ...fees(subtotal, passAtCheckout, checkoutT),
				quoted_eta_mins: eta, payment_method: pay, entry_point: entry,
			}));
			// Forkfly Pass free-trial offer on the checkout screen (never-trialed non-members)
			if (!passAtCheckout && !trialed && coin(PASS_OFFER_SHARE)) {
				const offerT = checkoutT + Math.round(unif(2, 6) * SEC_MS);
				evs.push(make("pass offer viewed", offerT, { order_id: orderId, offer_type: "free_trial_14_days" }));
				if (coin(TRIAL_ACCEPT) && offerT + 25 * SEC_MS < orderT) {
					const start = offerT + Math.round(unif(5, 20) * SEC_MS);
					evs.push(make("pass trial started", start, { plan: "monthly", price_after_trial_usd: PASS_PRICE_USD }));
					trial = { start, end: start + TRIAL_DAYS * DAY_MS, preDays: 0 };
					trialed = true;
					passChanges.push({ t: start, s: "trial" });
				}
			}
			// H3 quoted ETA x H9 service fee (non-Pass after the change) → does the customer order?
			const p = placeProb(eta) * (!passAtCheckout && checkoutT >= ms(FEE_CHANGE) ? FEE_KEEP : 1);
			if (coin(p)) {
				// H4: payment attempt (card processor incident)
				const fail = coin(BASE_PAY_FAIL) ? pick(DECLINE_CODES)
					: (pay === "card" && inPayIncident(orderT) && coin(INCIDENT_FAIL)) ? "processor_unavailable" : null;
				if (fail) {
					evs.push(make("payment failed", orderT, { order_id: orderId, payment_method: pay, decline_code: fail }));
				} else {
					const passAtOrder = passActive(orderT);
					// H5: Smart Add-ons suggests a dessert, drink, or side on the checkout screen
					if (variant === ADDONS_VARIANT && exposureT !== null && checkoutT >= ms(ADDONS_START) && coin(ADDON_TAKE)) {
						const cat = pick(ADDON_WEIGHTS);
						const price = itemPrice(rest, cat);
						items += 1;
						subtotal = round2(subtotal + price);
						evs.push(make("item added to cart", checkoutT + Math.round(dwell * unif(0.3, 0.6)), { restaurant_id: rest.restaurant_id, item_category: cat, item_price_usd: price, added_from: "addon_suggestion" }));
					}
					// H8: Pass members top up a $10-14.99 basket past the $15 free-delivery minimum
					if (passAtOrder && subtotal >= BUMP_FROM && subtotal < PASS_FREE_DELIVERY_MIN && coin(BUMP_SHARE)) {
						const price = round2(PASS_FREE_DELIVERY_MIN - subtotal + unif(0.5, 4.5));
						items += 1;
						subtotal = round2(subtotal + price);
						evs.push(make("item added to cart", checkoutT + Math.round(dwell * unif(0.65, 0.9)), { restaurant_id: rest.restaurant_id, item_category: pick({ side: 45, drink: 30, dessert: 25 }), item_price_usd: price, added_from: "menu" }));
					}
					const isFirst = Boolean(signup) && orders.length === 0;
					const discount = isFirst ? (profile.acquisition_channel === "coupon_affiliates" ? 15 : 8) : coin(0.04) ? 5 : 0;
					const promo = isFirst ? (profile.acquisition_channel === "coupon_affiliates" ? "DEAL15" : "WELCOME8") : discount ? "FORK5" : "none";
					const f = fees(subtotal, passAtOrder, orderT);
					const tip = coin(0.8) ? round2(subtotal * unif(0.1, 0.22)) : 0;
					const disc = Math.min(discount, Math.max(0, subtotal - 1));
					evs.push(make("order placed", orderT, {
						order_id: orderId, restaurant_id: rest.restaurant_id, restaurant_name: rest.restaurant_name, cuisine: rest.cuisine, price_tier: rest.price_tier,
						items_count: items, subtotal_usd: subtotal, ...f, tip_usd: tip, discount_usd: round2(disc), promo_code: promo,
						order_total_usd: round2(subtotal + f.delivery_fee_usd + f.service_fee_usd + tip - disc),
						quoted_eta_mins: eta, payment_method: pay, entry_point: entry,
					}));
					// delivery: H2 rain adds lateness (quoted ETAs ignore weather)
					const late = Math.round(LATE_MEAN_MIN + LATE_SD_MIN * normal() + (isRainy(dayKey(orderT), city) ? RAIN_LATE_MIN : 0));
					const deliveryMin = Math.max(10, eta + late);
					const deliveredT = orderT + deliveryMin * MIN_MS;
					const nTrack = 1 + (coin(0.5) ? 1 : 0) + (late >= 10 ? 1 + (coin(0.5) ? 1 : 0) : 0);
					for (let i = 0; i < nTrack; i++) {
						const frac = (i + unif(0.15, 0.85)) / nTrack;
						const st = frac < 0.3 ? "preparing" : frac < 0.55 ? "picked_up" : late >= 10 && frac > 0.75 ? "running_late" : "on_the_way";
						evs.push(make("order tracking viewed", orderT + 60 * SEC_MS + Math.floor(frac * (deliveredT - orderT - 90 * SEC_MS)), { order_id: orderId, order_status: st }));
					}
					evs.push(make("order delivered", deliveredT, { order_id: orderId, restaurant_id: rest.restaurant_id, delivery_minutes: deliveryMin, minutes_late: late }));
					const pSupport = 0.03 + 0.25 * logistic((late - LATE_THRESHOLD_MIN) / 3);
					if (coin(pSupport)) {
						const st = deliveredT + Math.round(unif(5, 90) * MIN_MS);
						evs.push(make("support contacted", st, { order_id: orderId, issue_type: late >= 10 ? "late_delivery" : pick(SUPPORT_ISSUES), contact_channel: coin(0.8) ? "chat" : "phone" }));
					}
					if (coin(P_RATE)) {
						const rt = deliveredT + Math.round(unif(20, 600) * MIN_MS);
						const food = Math.max(1, Math.min(5, Math.round(rest.restaurant_rating + 0.9 * normal())));
						const dScore = 4.7 - 0.07 * Math.max(0, late) + 0.8 * normal();
						evs.push(make("order rated", rt, { order_id: orderId, restaurant_id: rest.restaurant_id, food_rating: food, delivery_rating: Math.max(1, Math.min(5, Math.round(dScore))) }));
					}
					orders.push({ t: orderT, orderId, rest, items, cartItems, cartSubtotal, deliveredT, late });
					// H1 + H6: a new customer's first delivery decides whether they come back.
					// A churned customer opens no session after the delivery; the first order's
					// rating and support contact are already placed and stay.
					if (isFirst) {
						const churnLate = coin(lateChurn(late));
						const churnDeal = profile.acquisition_channel === "coupon_affiliates" && coin(COUPON_CHURN);
						if (churnLate || churnDeal) cut = deliveredT + MIN_MS;
					}
				}
			}
		}
		sessionEvents.push(...evs);
	}
	advance(END);

	// experiment exposure (both arms) at the first checkout on/after the start
	let exposure = null;
	if (variant && exposureT !== null) {
		exposure = exposures[0];
		exposure.time = iso(exposureT);
	} else if (profile[EXP_KEY] !== undefined) {
		delete profile[EXP_KEY];
	}

	const keep = [signup, address, exposure].filter(Boolean);
	const out = keep.concat(sessionEvents, passEvents).filter((e) => {
		const t = T(e);
		return t >= BEGIN && t <= END;
	});
	for (const e of out) {
		e.platform = platform;
		const t = T(e);
		e.pass_status = statusAt(e.event === "pass trial ended" || e.event === "pass cancelled" ? t - 1 : t);
	}
	profile.pass_status = statusAt(END);
	return out;
}

// warehouse rows: exogenous business facts layered on event-derived volumes
function handleWarehouse(row, meta) {
	if (meta.isBackfill) return row;
	if (meta.metricName === "marketing_spend_daily") {
		const ch = row.acquisition_channel;
		const k = `${row.date}|${ch}`;
		const spend = paidSpend(row.date, ch, row.spend_usd);
		row.spend_usd = spend;
		row.clicks = Math.round(spend / (CPC_USD[ch] * jitter(`cpc|${k}`, 0.15)));
		row.impressions = Math.round(row.clicks / (CTR[ch] * jitter(`ctr|${k}`, 0.15)));
		row.network_reported_signups = Math.round(spend * NETWORK_SIGNUP_INFLATION / CPA_USD[ch] * jitter(`net|${k}`, 0.2));
		return row;
	}
	if (meta.metricName === "payment_gateway_daily") {
		const k = `${row.date}|${row.payment_method}`;
		// the gateway also sees web and phone orders and retries Mixpanel never receives
		row.auth_attempts = Math.round(row.auth_attempts * (1 + 0.14 * hashFloat(`untracked|${k}`)) + 16 * hashFloat(`web|${k}`));
		row.auth_declines = Math.round(row.auth_attempts * row.decline_rate);
		return row;
	}
	if (meta.metricName === "market_ops_daily") {
		const k = `${row.date}|${row.city}`;
		const rainy = isRainy(row.date, row.city);
		// dispatch also counts phone and partner-site orders; cancelled orders drop out
		row.orders_dispatched = Math.max(0, Math.round(row.orders_dispatched * (1 + 0.16 * hashFloat(`phone|${k}`)) + 14 * hashFloat(`partner|${k}`) - 2 * hashFloat(`cancel|${k}`)));
		row.active_couriers = Math.max(3, Math.round(row.orders_dispatched / ((rainy ? 3.1 : 2.4) * jitter(`cap|${k}`, 0.12))));
		row.courier_hours = round1(row.active_couriers * (3.2 + 1.6 * hashFloat(`hrs|${k}`)));
		return row;
	}
	return row;
}

// ── CONFIG ──
const SESSION_STEPS = ["app opened", "restaurant viewed", "item added to cart", "checkout started", "order placed", "order delivered"];

/** @type {Config} */
const config = {
	seed: SEED,
	datasetStart: DATASET_START,
	datasetEnd: DATASET_END,
	numUsers: NUM_USERS,
	avgEventsPerUserPerDay: EVENTS_PER_DAY,
	format: "json",
	gzip: true,
	concurrency: 1,
	writeToDisk: false,
	macro: { percentUsersBornInDataset: BORN_PCT, bornRecentBias: 0, preExistingSpread: "uniform" },
	soup: { dayOfWeekWeights: DOW_WEIGHTS, hourOfDayWeights: HOUR_WEIGHTS },
	credentials: { token },
	switches: {
		hasSessionIds: true,
		alsoInferFunnels: false,
		hasLocation: false,
		hasAndroidDevices: true,
		hasIOSDevices: true,
		hasDesktopDevices: false,
		hasBrowser: false,
		hasCampaigns: false,
		isAnonymous: false,
		hasAdSpend: false,
		hasAvatar: true,
	},
	identity: { avgDevicePerUser: 1 },
	stickyEventProps: ["city"],

	events: [
		{
			event: "account created",
			weight: 1,
			isFirstEvent: true,
			isAuthEvent: true,
			properties: {
				signup_method: { __weights: { apple: 38, google: 34, email: 28 } },
				acquisition_channel: (ctx) => ctx.profile.acquisition_channel,
			},
		},
		{ event: "address saved", weight: 1, isStrictEvent: true, properties: { address_type: { __weights: { home: 72, work: 22, other: 6 } } } },
		{ event: "app opened", weight: 1, isStrictEvent: true, properties: { open_source: { __weights: { organic: 62, push_notification: 28, deep_link: 10 } } } },
		{ event: "search performed", weight: 1, isStrictEvent: true, properties: { search_term: ["pizza"], results_count: [10] } },
		{ event: "restaurant viewed", weight: 1, isStrictEvent: true, properties: { restaurant_id: ["rst_nyc_01"], restaurant_name: ["Golden Pizzeria"], cuisine: ["pizza"], price_tier: ["$$"], restaurant_rating: [4.3] } },
		{ event: "item added to cart", weight: 1, isStrictEvent: true, properties: { restaurant_id: ["rst_nyc_01"], item_category: ["entree"], item_price_usd: [14], added_from: ["menu"] } },
		{ event: "reorder tapped", weight: 1, isStrictEvent: true, properties: { restaurant_id: ["rst_nyc_01"], restaurant_name: ["Golden Pizzeria"], cuisine: ["pizza"], days_since_last_order: [7] } },
		{
			event: "checkout started", weight: 1, isStrictEvent: true,
			properties: { order_id: ["unassigned"], restaurant_id: ["rst_nyc_01"], restaurant_name: ["Golden Pizzeria"], cuisine: ["pizza"], items_count: [2], subtotal_usd: [28], delivery_fee_usd: [2.99], service_fee_usd: [2.8], quoted_eta_mins: [35], payment_method: ["card"], entry_point: ["home_feed"] },
		},
		{ event: "pass offer viewed", weight: 1, isStrictEvent: true, properties: { order_id: ["unassigned"], offer_type: ["free_trial_14_days"] } },
		{ event: "pass trial started", weight: 1, isStrictEvent: true, properties: { plan: ["monthly"], price_after_trial_usd: [PASS_PRICE_USD] } },
		{ event: "payment failed", weight: 1, isStrictEvent: true, properties: { order_id: ["unassigned"], payment_method: ["card"], decline_code: ["card_declined"] } },
		{
			event: "order placed", weight: 1, isStrictEvent: true,
			properties: { order_id: ["unassigned"], restaurant_id: ["rst_nyc_01"], restaurant_name: ["Golden Pizzeria"], cuisine: ["pizza"], price_tier: ["$$"], items_count: [2], subtotal_usd: [28], delivery_fee_usd: [2.99], service_fee_usd: [2.8], tip_usd: [4], discount_usd: [0], promo_code: ["none"], order_total_usd: [37.79], quoted_eta_mins: [35], payment_method: ["card"], entry_point: ["home_feed"] },
		},
		{ event: "order tracking viewed", weight: 1, isStrictEvent: true, properties: { order_id: ["unassigned"], order_status: ["on_the_way"] } },
		{ event: "order delivered", weight: 1, isStrictEvent: true, properties: { order_id: ["unassigned"], restaurant_id: ["rst_nyc_01"], delivery_minutes: [38], minutes_late: [0] } },
		{ event: "order rated", weight: 1, isStrictEvent: true, properties: { order_id: ["unassigned"], restaurant_id: ["rst_nyc_01"], food_rating: [4], delivery_rating: [4] } },
		{ event: "support contacted", weight: 1, isStrictEvent: true, properties: { order_id: ["unassigned"], issue_type: ["missing_item"], contact_channel: ["chat"] } },
		{ event: "pass trial ended", weight: 1, isStrictEvent: true, properties: { outcome: ["not_converted"], orders_during_trial: [0] } },
		{ event: "pass cancelled", weight: 1, isStrictEvent: true, properties: { cancel_reason: ["other"], months_subscribed: [1] } },
		{
			event: "$experiment_started",
			weight: 1,
			isStrictEvent: true,
			properties: { "Experiment name": [ADDONS_EXPERIMENT], "Variant name": ["Control", ADDONS_VARIANT] },
		},
	],

	funnels: [
		{
			name: "Signup",
			sequence: ["account created", "address saved"],
			isFirstFunnel: true,
			conversionRate: 88,
			timeToConvert: 0.15,
			order: "sequential",
			weight: 1,
		},
		{
			// one app session (the hook decides how far each session goes)
			name: "Session",
			sequence: SESSION_STEPS,
			conversionRate: 100,
			timeToConvert: 0.5,
			order: "sequential",
			weight: 1,
			experiment: {
				name: ADDONS_EXPERIMENT,
				startDaysBeforeEnd: (ms(DATASET_END) - ms(ADDONS_START)) / DAY_MS,
				variants: [{ name: "Control" }, { name: ADDONS_VARIANT }],
			},
		},
	],

	warehouseMetrics: [
		{
			name: "marketing_spend_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "account created",
				measure: "count",
				where: (e) => PAID_CHANNELS.includes(e.acquisition_channel),
				groupBy: "acquisition_channel",
			},
			timeColumn: "date",
			valueColumn: "spend_usd",
			columns: {
				impressions: 0,
				clicks: 0,
				network_reported_signups: 0,
			},
		},
		{
			name: "payment_gateway_daily",
			type: "additive",
			grain: "day",
			source: {
				event: ["order placed", "payment failed"],
				measure: "count",
				groupBy: "payment_method",
			},
			timeColumn: "date",
			valueColumn: "auth_attempts",
			columns: {
				auth_declines: 0,
				decline_rate: (ctx) => {
					const j = hashFloat(`decl|${dayKey(ctx.time)}|${ctx.seriesKey}`);
					const hit = ctx.row.payment_method === "card" && inPayIncident(ctx.time);
					const rate = hit ? 1 - (1 - BASE_PAY_FAIL) * (1 - INCIDENT_FAIL) : BASE_PAY_FAIL;
					return Math.round((rate + (j - 0.5) * (hit ? 0.03 : 0.012)) * 10000) / 10000;
				},
				p95_auth_latency_ms: (ctx) => {
					const j = hashFloat(`lat|${dayKey(ctx.time)}|${ctx.seriesKey}`);
					const hit = ctx.row.payment_method === "card" && inPayIncident(ctx.time);
					return hit ? Math.round(6500 + j * 5000) : Math.round(620 + j * 380);
				},
				gateway_status: (ctx) => (ctx.row.payment_method === "card" && inPayIncident(ctx.time) ? "major_outage" : "operational"),
			},
		},
		{
			name: "market_ops_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "order placed",
				measure: "count",
				groupBy: "city",
			},
			timeColumn: "date",
			valueColumn: "orders_dispatched",
			columns: {
				precipitation_mm: (ctx) => precipitationMm(dayKey(ctx.time), ctx.row.city),
				weather_condition: (ctx) => weatherCondition(dayKey(ctx.time), ctx.row.city),
				temp_high_f: (ctx) => tempHighF(dayKey(ctx.time), ctx.row.city),
				active_couriers: 0,
				courier_hours: 0,
			},
		},
	],

	superProps: {
		city: ["New York"],
		platform: ["ios"],
		pass_status: ["none"],
	},

	userProps: {
		city: weighted(Object.fromEntries(CITY_NAMES.map((c) => [c, CITIES[c].w]))),
		platform: ["ios"],
		household_type: weighted(HOUSEHOLD_WEIGHTS),
		favorite_cuisine: weighted(CUISINE_WEIGHTS),
		acquisition_channel: weighted(CHANNEL_WEIGHTS),
		customer_since: ["2025-01-01"],
		default_payment: ["card"],
		pass_status: ["none"],
	},

	personas: [
		{ name: "regular", weight: 45, eventMultiplier: 1.0 },
		{ name: "power_orderer", weight: 20, eventMultiplier: 2.0 },
		{ name: "occasional", weight: 35, eventMultiplier: 0.45 },
	],

	retentionCurve: { type: "logarithmic", day1: 0.55, day7: 0.38, day30: 0.25 },

	hook(record, type, meta) {
		if (type === "user") return handleUserHook(record, meta);
		if (type === "everything") return handleEverything(record, meta);
		if (type === "warehouse") return handleWarehouse(record, meta);
		return record;
	},
};

// ── STORIES ──────────────────────────────────────────────────────────────
// Machine-checkable contract for hooks H1-H10. Evaluate with:
//   node dungeons/vertical/food-delivery/food-delivery.verify.mjs

const EV = `read_json_auto('{{PREFIX}}-EVENTS*.json*', sample_size=-1, union_by_name=true)`;
const US = `read_json_auto('{{PREFIX}}-USERS*.json*', sample_size=-1, union_by_name=true)`;
const WH = (table) => `read_json_auto('{{PREFIX}}-WAREHOUSE-${table}.json*', sample_size=-1, union_by_name=true)`;

// Identity prelude: a device resolves to the customer seen with it on any event
// that carries both ids (emitted stitch evidence). Every Forkfly event carries
// user_id, so the device map only matters for completeness.
const ID_CTE = `dmap AS (SELECT device_id, min(user_id::VARCHAR) AS mapped FROM ${EV}
  WHERE user_id IS NOT NULL AND device_id IS NOT NULL GROUP BY 1),
ev AS (SELECT coalesce(e.user_id::VARCHAR, m.mapped) AS uid, e.time::TIMESTAMP AS t, e.*
  FROM ${EV} e LEFT JOIN dmap m ON e.device_id = m.device_id)`;

const TS = (isoStr) => dayjs.utc(isoStr).format("YYYY-MM-DD HH:mm:ss");
const D = (isoStr) => isoStr.slice(0, 10);
const r3 = (n) => Math.round(n * 1000) / 1000;
const band = (k) => [r3(k * 0.9), r3(k * 1.1)];
const halfToward = (k, neutral) => r3(neutral + 0.5 * (k - neutral)); // half-effect floor / ceiling
const REPEAT_DAYS = 30;                 // H1/H6 read: next order within 30 days of the first delivery
const REPEAT_READ_END = "2026-09-01 00:00:00"; // first deliveries through Aug 31 have a full 30 days
const INC_BASE_DAYS = 14;               // H4 read: baseline days either side of the incident
const INC_BASE_FROM = TS(dayjs.utc(PAY_INCIDENT_START).subtract(INC_BASE_DAYS, "day").toISOString());
const INC_BASE_TO = TS(dayjs.utc(PAY_INCIDENT_END).add(INC_BASE_DAYS, "day").toISOString());
const TTC_WINDOW_MIN = 60;              // H10 read: app opened → order placed within one hour, same session
const REORDER_CONV_RATIO = P_REORDER_CHECKOUT / ((1 - P_BOUNCE) * P_CART * P_CHECKOUT);
const TRIAL_READ_END = TS(dayjs.utc(DATASET_END).subtract(TRIAL_DAYS, "day").toISOString());

const H1_SQL = `WITH ${ID_CTE},
s AS (SELECT uid, acquisition_channel AS ch FROM ev WHERE event = 'account created'),
d AS (SELECT ev.uid, ev.t, ev.minutes_late::INT AS late, row_number() OVER (PARTITION BY ev.uid ORDER BY ev.t, ev.insert_id) AS rn
  FROM ev JOIN s ON s.uid = ev.uid WHERE ev.event = 'order delivered'),
f AS (SELECT * FROM d WHERE rn = 1 AND t < TIMESTAMP '${REPEAT_READ_END}'),
r AS (SELECT f.uid, f.late, s.ch, coalesce(bool_or(o.t > f.t AND o.t < f.t + INTERVAL ${REPEAT_DAYS} DAY), false) AS rep
  FROM f JOIN s ON s.uid = f.uid LEFT JOIN ev o ON o.uid = f.uid AND o.event = 'order placed' GROUP BY 1, 2, 3)
SELECT CASE WHEN late >= ${LATE_THRESHOLD_MIN} THEN 'late' ELSE 'on_time' END AS grp, count(*) AS user_count, avg(rep::INT) AS repeat_rate FROM r GROUP BY 1
UNION ALL
SELECT CASE WHEN ch = 'coupon_affiliates' THEN 'coupon' ELSE 'other_channels' END AS grp, count(*) AS user_count, avg(rep::INT) AS repeat_rate FROM r GROUP BY 1`;

const H2_SQL = `WITH ${ID_CTE},
w AS (SELECT date::DATE AS d, city, precipitation_mm >= ${RAIN_DAY_MM} AS rainy FROM ${WH("market_ops_daily")}),
o AS (SELECT city, t::DATE AS d, count(*) AS n, count(DISTINCT uid) AS users FROM ev WHERE event = 'order placed' GROUP BY 1, 2),
j AS (SELECT w.city, w.d, w.rainy, coalesce(o.n, 0) AS n FROM w LEFT JOIN o ON o.city = w.city AND o.d = w.d),
c AS (SELECT city, avg(n) FILTER (WHERE NOT rainy) AS dry_mean FROM j GROUP BY 1),
lt AS (SELECT dl.minutes_late::DOUBLE AS late, w.rainy FROM ev dl
  JOIN ev p ON p.order_id = dl.order_id AND p.event = 'order placed'
  JOIN w ON w.city = p.city AND w.d = p.t::DATE WHERE dl.event = 'order delivered')
SELECT 'all' AS grp, (SELECT count(DISTINCT uid) FROM ev WHERE event = 'order placed') AS user_count,
 count(*) FILTER (WHERE j.rainy) AS rainy_city_days,
 sum(j.n) FILTER (WHERE j.rainy) / sum(c.dry_mean) FILTER (WHERE j.rainy) AS rain_lift,
 (SELECT avg(late) FILTER (WHERE rainy) - avg(late) FILTER (WHERE NOT rainy) FROM lt) AS late_diff
FROM j JOIN c ON c.city = j.city`;

const H3_SQL = `WITH ${ID_CTE},
c AS (SELECT order_id, uid, quoted_eta_mins AS eta, t FROM ev WHERE event = 'checkout started'),
p AS (SELECT order_id, min(t) AS tp FROM ev WHERE event = 'order placed' GROUP BY 1)
SELECT CASE WHEN c.eta <= ${ETA_THRESHOLD_MIN} THEN 'quick' ELSE 'slow' END AS grp, count(DISTINCT c.uid) AS user_count, count(*) AS checkouts,
 avg(coalesce(p.tp >= c.t AND p.tp < c.t + INTERVAL 1 HOUR, false)::INT) AS conv
FROM c LEFT JOIN p ON p.order_id = c.order_id GROUP BY 1`;

const H4_SQL = `WITH ${ID_CTE},
o AS (SELECT DISTINCT date::DATE AS d, payment_method FROM ${WH("payment_gateway_daily")} WHERE gateway_status = 'major_outage'),
od AS (SELECT DISTINCT d FROM o), om AS (SELECT DISTINCT payment_method FROM o),
c AS (SELECT order_id, uid, t, payment_method IN (SELECT payment_method FROM om) AS hit, t::DATE IN (SELECT d FROM od) AS outage
  FROM ev WHERE event = 'checkout started' AND t >= TIMESTAMP '${INC_BASE_FROM}' AND t < TIMESTAMP '${INC_BASE_TO}'),
p AS (SELECT DISTINCT order_id FROM ev WHERE event = 'order placed'),
g AS (SELECT hit, outage, count(DISTINCT uid) AS users, avg((p.order_id IS NOT NULL)::INT) AS conv FROM c LEFT JOIN p ON p.order_id = c.order_id GROUP BY 1, 2)
SELECT 'all' AS grp, (SELECT count(*) FROM od) AS outage_days, min(users) AS user_count,
 (max(conv) FILTER (WHERE hit AND outage) / max(conv) FILTER (WHERE hit AND NOT outage))
 / (max(conv) FILTER (WHERE NOT hit AND outage) / max(conv) FILTER (WHERE NOT hit AND NOT outage)) AS did
FROM g`;

const H5_ARMS = `v AS (SELECT distinct_id::VARCHAR AS uid, "${EXP_KEY}" AS arm FROM ${US} WHERE "${EXP_KEY}" IS NOT NULL)`;
const H5_SQL = `WITH ${ID_CTE}, ${H5_ARMS},
c AS (SELECT order_id, uid FROM ev WHERE event = 'checkout started' AND t >= TIMESTAMP '${TS(ADDONS_START)}'),
p AS (SELECT order_id, any_value(items_count) AS items, any_value(subtotal_usd) AS subtotal FROM ev WHERE event = 'order placed' AND t >= TIMESTAMP '${TS(ADDONS_START)}' GROUP BY 1)
SELECT v.arm AS grp, count(DISTINCT c.uid) AS user_count, count(*) AS checkouts, avg((p.order_id IS NOT NULL)::INT) AS conv,
 avg(p.items) AS items_per_order, avg(p.subtotal) AS subtotal_per_order
FROM c JOIN v ON v.uid = c.uid LEFT JOIN p ON p.order_id = c.order_id GROUP BY 1`;

// pre-period adjusted lift: (variant post - pre) - (control post - pre) in items per order
const H5_DID_SQL = `WITH ${ID_CTE}, ${H5_ARMS},
o AS (SELECT v.arm, ev.uid, ev.items_count, ev.t >= TIMESTAMP '${TS(ADDONS_START)}' AS post FROM ev JOIN v ON v.uid = ev.uid WHERE ev.event = 'order placed'),
g AS (SELECT arm, avg(items_count) FILTER (WHERE post) AS post_items, avg(items_count) FILTER (WHERE NOT post) AS pre_items, count(DISTINCT uid) AS users FROM o GROUP BY 1)
SELECT 'all' AS grp, min(users) AS user_count,
 (max(post_items) FILTER (WHERE arm = '${ADDONS_VARIANT}') - max(pre_items) FILTER (WHERE arm = '${ADDONS_VARIANT}'))
 - (max(post_items) FILTER (WHERE arm = 'Control') - max(pre_items) FILTER (WHERE arm = 'Control')) AS did,
 max(post_items) FILTER (WHERE arm = '${ADDONS_VARIANT}') - max(post_items) FILTER (WHERE arm = 'Control') AS raw_diff
FROM g`;

const H6_SQL = `WITH ${ID_CTE},
s AS (SELECT uid, t AS t0, acquisition_channel AS ch FROM ev WHERE event = 'account created'),
d AS (SELECT ev.uid, ev.t, row_number() OVER (PARTITION BY ev.uid ORDER BY ev.t, ev.insert_id) AS rn FROM ev JOIN s ON s.uid = ev.uid WHERE ev.event = 'order delivered'),
f AS (SELECT * FROM d WHERE rn = 1 AND t < TIMESTAMP '${REPEAT_READ_END}'),
r AS (SELECT f.uid, coalesce(bool_or(o.t > f.t AND o.t < f.t + INTERVAL ${REPEAT_DAYS} DAY), false) AS rep
  FROM f LEFT JOIN ev o ON o.uid = f.uid AND o.event = 'order placed' GROUP BY 1),
g AS (SELECT s.ch, count(*) AS signups, count(*) FILTER (WHERE s.t0 < TIMESTAMP '${REPEAT_READ_END}') AS signups_read,
  count(*) FILTER (WHERE r.rep AND s.t0 < TIMESTAMP '${REPEAT_READ_END}') AS repeaters, avg(r.rep::INT) AS repeat_rate
  FROM s LEFT JOIN r ON r.uid = s.uid GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend, sum(spend_usd) FILTER (WHERE date::DATE < DATE '${REPEAT_READ_END.slice(0, 10)}') AS spend_read
  FROM ${WH("marketing_spend_daily")} GROUP BY 1)
SELECT g.ch AS grp, g.signups AS user_count, g.repeat_rate, sp.spend / g.signups AS spend_per_signup, sp.spend_read / g.repeaters AS spend_per_repeat
FROM g LEFT JOIN sp ON sp.ch = g.ch`;

const H7_SQL = `WITH ${ID_CTE},
s AS (SELECT uid, min(t) AS ts FROM ev WHERE event = 'pass trial started' GROUP BY 1),
e AS (SELECT uid, outcome, orders_during_trial AS n FROM ev WHERE event = 'pass trial ended')
SELECT CASE WHEN e.n >= ${TRIAL_MAGIC_ORDERS} THEN 'two_plus' ELSE 'zero_one' END AS grp, count(*) AS user_count,
 avg((e.outcome = 'converted')::INT) AS conv
FROM e JOIN s ON s.uid = e.uid WHERE s.ts < TIMESTAMP '${TRIAL_READ_END}' GROUP BY 1`;

// among $10-19.99 orders, the share under $15 (topped-up baskets land at $15.50-19.50)
const H8_SQL = `WITH ${ID_CTE}
SELECT CASE WHEN pass_status = 'none' THEN 'no_pass' ELSE 'pass' END AS grp, count(DISTINCT uid) AS user_count, count(*) AS orders,
 count(*) FILTER (WHERE subtotal_usd >= ${BUMP_FROM} AND subtotal_usd < ${PASS_FREE_DELIVERY_MIN})::DOUBLE
  / count(*) FILTER (WHERE subtotal_usd >= ${BUMP_FROM} AND subtotal_usd < ${PASS_FREE_DELIVERY_MIN + 5}) AS small_basket_share
FROM ev WHERE event = 'order placed' GROUP BY 1`;

const H9_SQL = `WITH ${ID_CTE},
c AS (SELECT order_id, uid, pass_status <> 'none' AS pass, t >= TIMESTAMP '${TS(FEE_CHANGE)}' AS post FROM ev
  WHERE event = 'checkout started' AND NOT (t >= TIMESTAMP '${TS(PAY_INCIDENT_START)}' AND t < TIMESTAMP '${TS(PAY_INCIDENT_END)}')),
p AS (SELECT DISTINCT order_id FROM ev WHERE event = 'order placed'),
g AS (SELECT pass, post, count(DISTINCT uid) AS users, avg((p.order_id IS NOT NULL)::INT) AS conv FROM c LEFT JOIN p ON p.order_id = c.order_id GROUP BY 1, 2)
SELECT 'all' AS grp, min(users) AS user_count,
 (max(conv) FILTER (WHERE NOT pass AND post) / max(conv) FILTER (WHERE NOT pass AND NOT post))
 / (max(conv) FILTER (WHERE pass AND post) / max(conv) FILTER (WHERE pass AND NOT post)) AS did
FROM g`;

const H10_SQL = `WITH ${ID_CTE},
o AS (SELECT uid, t, lead(t) OVER (PARTITION BY uid ORDER BY t) AS nt FROM ev WHERE event = 'app opened'),
p AS (SELECT uid, t, entry_point FROM ev WHERE event = 'order placed'),
x AS (SELECT o.uid, o.t, min(p.t) AS tp, arg_min(p.entry_point, p.t) AS ep FROM o JOIN p ON p.uid = o.uid AND p.t > o.t
  AND p.t < o.t + INTERVAL ${TTC_WINDOW_MIN} MINUTE AND (o.nt IS NULL OR p.t < o.nt)
  WHERE o.t >= TIMESTAMP '${TS(REORDER_LAUNCH)}' GROUP BY 1, 2)
SELECT CASE WHEN ep = 'reorder' THEN 'reorder' ELSE 'browse' END AS grp, count(DISTINCT uid) AS user_count, count(*) AS orders,
 median(date_diff('second', t, tp)) / 60.0 AS med_minutes
FROM x GROUP BY 1`;

// Insights formula over customers who used Order Again, Jul 7 - Oct 1 (one reorder tapped per
// Order Again visit): reorder rate = orders with entry_point = reorder / reorder tapped;
// browse rate = other orders / (app opened - reorder tapped).
const H10_CONV_SQL = `WITH ${ID_CTE},
el AS (SELECT DISTINCT uid FROM ev WHERE event = 'reorder tapped'),
x AS (SELECT ev.* FROM ev JOIN el ON el.uid = ev.uid WHERE ev.t >= TIMESTAMP '${TS(REORDER_LAUNCH)}'),
k AS (SELECT count(DISTINCT uid) AS users,
  count(*) FILTER (WHERE event = 'order placed' AND entry_point = 'reorder') AS a,
  count(*) FILTER (WHERE event = 'reorder tapped') AS b,
  count(*) FILTER (WHERE event = 'order placed' AND entry_point <> 'reorder') AS c,
  count(*) FILTER (WHERE event = 'app opened') AS d FROM x)
SELECT 'reorder' AS grp, users AS user_count, b AS sessions, a::DOUBLE / b AS order_rate FROM k
UNION ALL
SELECT 'browse' AS grp, users AS user_count, d - b AS sessions, c::DOUBLE / (d - b) AS order_rate FROM k`;

/** @type {import("../../../types").DungeonStory[]} */
export const stories = [
	{
		id: "H1-late-first-order",
		hook: "H1",
		archetype: "retention-divergence",
		narrative: `A new customer's first delivery decides whether they come back. After the first delivered order, a new customer leaves Forkfly with a chance that rises with minutes_late (logistic centered at ${LATE_THRESHOLD_MIN} min, softness ${LATE_SOFT_MIN} min, plateau ${LATE_CHURN}). Lateness is independent of the customer (normal mean ${LATE_MEAN_MIN} min, sd ${LATE_SD_MIN} min, +${RAIN_LATE_MIN} min on rainy days), so the 30-day repeat rate (another order within ${REPEAT_DAYS} days of the first delivery, first deliveries through Aug 31) for first deliveries ${LATE_THRESHOLD_MIN}+ minutes late over on-time ones is ${r3(LATE_REPEAT_RATIO)} (integrated over the lateness distribution and the realized rain calendar). Rests on about 400 late first orders, so the read uses the knob as target with a half-effect ceiling.`,
		mixpanelReport: { type: "Funnels", steps: ["order delivered (filter: first time ever)", "order placed"], window: `${REPEAT_DAYS} days`, cohort: "customers who did account created in the window", dateRange: `${D(DATASET_START)} to 2026-08-31`, breakdown: `step 1 minutes_late (custom buckets < ${LATE_THRESHOLD_MIN}, >= ${LATE_THRESHOLD_MIN})`, note: "without the first-time-ever filter each minutes_late bucket runs its own funnel, kept customers' later late deliveries enter the late bucket, and the ratio reads about 0.9" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H1_SQL },
				select: { l: { where: { grp: "late" } }, o: { where: { grp: "on_time" } } },
				expect: { metric: "l.repeat_rate / o.repeat_rate", op: "<=", target: r3(LATE_REPEAT_RATIO), floor: halfToward(LATE_REPEAT_RATIO, 1) },
				minCohort: 300,
			},
		],
	},
	{
		id: "H2-rainy-days",
		hook: "H2",
		archetype: "external-join",
		narrative: `Rain sends people to delivery apps and slows couriers. Warehouse market_ops_daily records precipitation by city and UTC day; on rainy days (${RAIN_DAY_MM}+ mm) customers in that city open the app ${RAIN_DEMAND_MULT}x as often, so orders per city-day are ${RAIN_DEMAND_MULT}x the city's dry-day average. Quoted ETAs ignore the weather, so deliveries on rainy days run ${RAIN_LATE_MIN} minutes later against the promise (minutes_late), while checkout conversion is unchanged. Read: event orders joined to the warehouse weather by city and date.`,
		mixpanelReport: { type: "Insights + warehouse", event: "order placed", measure: "total", breakdown: "city", chart: "daily", join: "market_ops_daily.precipitation_mm on date + city", second: "order delivered, average minutes_late, rainy vs dry days" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H2_SQL },
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.rain_lift", op: "between", target: band(RAIN_DEMAND_MULT) },
				minCohort: 3000,
			},
			{
				breakdown: { type: "duckdb", sql: H2_SQL },
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.late_diff", op: "between", target: band(RAIN_LATE_MIN) },
				minCohort: 3000,
			},
		],
	},
	{
		id: "H3-quoted-eta-threshold",
		hook: "H3",
		archetype: "funnel-conversion-by-segment",
		narrative: `Customers abandon checkout when the promised delivery time is long. The chance a checkout becomes an order falls smoothly with quoted_eta_mins (logistic centered at ${ETA_THRESHOLD_MIN} min, softness ${ETA_SOFT_MIN} min). Plateaus are solved from the quote distribution (log-normal, median ${ETA_MEDIAN_MIN} min) so that checkouts quoted ${ETA_THRESHOLD_MIN} min or less convert ${PLACE_FAST * 100}% of the time on average and longer quotes ${PLACE_SLOW * 100}% (${r3(PLACE_SLOW / PLACE_FAST)}x). Fees, payment failures, and the experiment act on both buckets alike. Read: per checkout (order_id), order placed within 1 hour.`,
		mixpanelReport: { type: "Funnels", steps: ["checkout started", "order placed"], counting: "totals", holdPropertyConstant: "order_id", window: "1 hour", breakdown: `step 1 quoted_eta_mins (custom buckets <= ${ETA_THRESHOLD_MIN}, > ${ETA_THRESHOLD_MIN})` },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H3_SQL },
				select: { s: { where: { grp: "slow" } }, q: { where: { grp: "quick" } } },
				expect: { metric: "s.conv / q.conv", op: "between", target: band(PLACE_SLOW / PLACE_FAST) },
				minCohort: 2000,
			},
		],
	},
	{
		id: "H4-card-processor-incident",
		hook: "H4",
		archetype: "bespoke",
		narrative: `From ${D(PAY_INCIDENT_START)} to ${D(PAY_INCIDENT_END)} (exclusive) Forkfly's card processor degrades: ${INCIDENT_FAIL * 100}% of card payments that would have gone through fail ("payment failed", decline_code processor_unavailable) and the order is lost. Apple Pay, Google Pay, and PayPal are untouched. Warehouse payment_gateway_daily marks card as major_outage on those days with decline_rate ≈ ${r3(1 - (1 - BASE_PAY_FAIL) * (1 - INCIDENT_FAIL))}. Read: per-checkout conversion for card vs other methods, incident days vs the ${INC_BASE_DAYS} days either side (difference in differences) = 1 - ${INCIDENT_FAIL}. About 1,170 card checkouts fall in the incident, so the read uses the knob as target with a half-effect ceiling.`,
		mixpanelReport: { type: "Funnels + warehouse", steps: ["checkout started", "order placed"], counting: "totals", holdPropertyConstant: "order_id", window: "1 hour", breakdown: "payment_method", chart: "daily", join: "payment_gateway_daily.gateway_status on date + payment_method" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H4_SQL },
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.did", op: "<=", target: 1 - INCIDENT_FAIL, floor: halfToward(1 - INCIDENT_FAIL, 1) },
				minCohort: 500,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT 'all' AS grp, count(*) FILTER (WHERE gateway_status = 'major_outage') AS outage_rows,
 avg(decline_rate) FILTER (WHERE gateway_status = 'major_outage') AS outage_decline
FROM ${WH("payment_gateway_daily")}`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.outage_decline", op: "between", target: band(1 - (1 - BASE_PAY_FAIL) * (1 - INCIDENT_FAIL)) },
			},
		],
	},
	{
		id: "H5-smart-addons-experiment",
		hook: "H5",
		archetype: "experiment-lift",
		narrative: `The "${ADDONS_EXPERIMENT}" test starts ${D(ADDONS_START)}: customers are split 50/50 (sticky; exposure $experiment_started 1 s before their first checkout on or after the start). In the "${ADDONS_VARIANT}" arm the checkout screen suggests a dessert, drink, or side; ${ADDON_TAKE * 100}% of variant orders add one (item added to cart with added_from = addon_suggestion), so items per order rise by ${ADDON_TAKE} and the basket grows, while checkout → order conversion is unchanged. Items per order also depend on household size, and the arms can differ a little in household mix, so the lift is read pre-period adjusted: (variant after − before) − (control after − before) items per order, with the knob as target and a half-effect floor.`,
		mixpanelReport: { type: "Insights (or Experiments)", event: "order placed", measure: "average items_count and average subtotal_usd", breakdown: `user property "${EXP_KEY}"`, dateRange: `${D(ADDONS_START)} to ${D(DATASET_END)}`, second: "Funnels checkout started → order placed, hold order_id, by arm" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H5_DID_SQL },
				select: { a: { where: { grp: "all" } } },
				// pre-period means differ by which customers ordered when (SE about 0.02 items), so a half-effect floor
				expect: { metric: "a.did", op: ">=", target: ADDON_TAKE, floor: ADDON_TAKE / 2 },
				minCohort: 2000,
			},
			{
				breakdown: { type: "duckdb", sql: H5_SQL },
				select: { v: { where: { grp: ADDONS_VARIANT } }, c: { where: { grp: "Control" } } },
				// no engineered conversion effect: the arms convert alike
				expect: { metric: "v.conv / c.conv", op: "between", target: band(1) },
				minCohort: 2000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${H5_ARMS}
SELECT 'all' AS grp, count(DISTINCT ev.uid) AS user_count,
 count(*) FILTER (WHERE added_from = 'addon_suggestion' AND (t < TIMESTAMP '${TS(ADDONS_START)}' OR v.arm IS DISTINCT FROM '${ADDONS_VARIANT}')) AS impure
FROM ev LEFT JOIN v ON v.uid = ev.uid WHERE event = 'item added to cart'`,
				},
				select: { a: { where: { grp: "all" } } },
				// exact: suggestions exist only in the variant after the start
				expect: { metric: "a.impure", op: "between", target: [0, 0] },
			},
		],
	},
	{
		id: "H6-channel-economics",
		hook: "H6",
		archetype: "external-join",
		narrative: `Coupon affiliates (deal sites) are Forkfly's cheapest paid channel per signup and its worst at keeping customers. Warehouse marketing_spend_daily bills each paid channel as a paced daily budget plus a per-signup component (coupon affiliates are mostly per-signup), with seeded day noise: $${CPA_USD.coupon_affiliates} coupon affiliates, $${CPA_USD.paid_social} paid social, $${CPA_USD.paid_search} paid search per Mixpanel signup over the window. ${COUPON_CHURN * 100}% of coupon-affiliate customers leave after their discounted first order (DEAL15), so their 30-day repeat rate is ${1 - COUPON_CHURN}x every other channel's, and spend per repeat customer comes out level with paid social: (${CPA_USD.coupon_affiliates} / ${1 - COUPON_CHURN}) / ${CPA_USD.paid_social} = ${r3(CPA_USD.coupon_affiliates / (1 - COUPON_CHURN) / CPA_USD.paid_social)}. About 420 coupon first orders back the repeat read, so it uses the knob as target with a half-effect ceiling; spend per repeat customer uses a floor (the claim is that the channel is not cheaper per kept customer).`,
		mixpanelReport: { type: "Insights + Funnels + warehouse", event: "account created", breakdown: "acquisition_channel", join: "marketing_spend_daily.spend_usd", funnel: `order delivered → order placed, ${REPEAT_DAYS}-day window, cohort customers who did account created in the window, date range ${D(DATASET_START)} to 2026-08-31, breakdown user property acquisition_channel` },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H6_SQL },
				select: { c: { where: { grp: "coupon_affiliates" } }, s: { where: { grp: "paid_search" } } },
				expect: { metric: "c.spend_per_signup / s.spend_per_signup", op: "between", target: band(CPA_USD.coupon_affiliates / CPA_USD.paid_search) },
				minCohort: 500,
			},
			{
				breakdown: { type: "duckdb", sql: H1_SQL },
				select: { c: { where: { grp: "coupon" } }, o: { where: { grp: "other_channels" } } },
				expect: { metric: "c.repeat_rate / o.repeat_rate", op: "<=", target: 1 - COUPON_CHURN, floor: halfToward(1 - COUPON_CHURN, 1) },
				minCohort: 300,
			},
			{
				breakdown: { type: "duckdb", sql: H6_SQL },
				select: { c: { where: { grp: "coupon_affiliates" } }, s: { where: { grp: "paid_social" } } },
				expect: { metric: "c.spend_per_repeat / s.spend_per_repeat", op: ">=", target: r3(CPA_USD.coupon_affiliates / (1 - COUPON_CHURN) / CPA_USD.paid_social), floor: 0.75 },
				minCohort: 500,
			},
		],
	},
	{
		id: "H7-pass-trial-two-orders",
		hook: "H7",
		archetype: "funnel-conversion-by-segment",
		narrative: `Forkfly Pass free trials (${TRIAL_DAYS} days, $${PASS_PRICE_USD}/month after) convert on usage: a trial with ${TRIAL_MAGIC_ORDERS}+ orders during the trial converts to paid ${TRIAL_CONV_HIGH * 100}% of the time, one with 0-1 orders ${TRIAL_CONV_LOW * 100}%. "pass trial ended" carries outcome and orders_during_trial (orders placed in the 14 days from the trial start). Read: trials started in the window through ${TRIAL_READ_END.slice(0, 10)} (complete trials), conversion by orders during the trial.`,
		mixpanelReport: { type: "Insights", event: "pass trial ended", measure: "share with outcome = converted", breakdown: `orders_during_trial (custom buckets 0-1, ${TRIAL_MAGIC_ORDERS}+)`, filter: "customers who did pass trial started in the window" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H7_SQL },
				select: { h: { where: { grp: "two_plus" } } },
				expect: { metric: "h.conv", op: "between", target: band(TRIAL_CONV_HIGH) },
				minCohort: 400,
			},
			{
				breakdown: { type: "duckdb", sql: H7_SQL },
				select: { l: { where: { grp: "zero_one" } } },
				expect: { metric: "l.conv", op: "between", target: band(TRIAL_CONV_LOW) },
				minCohort: 400,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
s AS (SELECT uid, min(t) AS ts FROM ev WHERE event = 'pass trial started' GROUP BY 1),
e AS (SELECT uid, orders_during_trial AS n FROM ev WHERE event = 'pass trial ended'),
c AS (SELECT s.uid, count(o.uid) AS placed FROM s LEFT JOIN ev o ON o.uid = s.uid AND o.event = 'order placed' AND o.t >= s.ts AND o.t < s.ts + INTERVAL ${TRIAL_DAYS} DAY GROUP BY 1)
SELECT 'all' AS grp, count(*) AS user_count, count(*) FILTER (WHERE e.n <> c.placed) AS mismatched
FROM e JOIN c ON c.uid = e.uid`,
				},
				select: { a: { where: { grp: "all" } } },
				// exact: orders_during_trial equals the orders placed in the trial
				expect: { metric: "a.mismatched", op: "between", target: [0, 0] },
			},
		],
	},
	{
		id: "H8-pass-free-delivery-minimum",
		hook: "H8",
		// magic-number threshold: baskets bunch just above the $15 line (the enum has no threshold archetype)
		archetype: "bespoke",
		narrative: `Forkfly Pass waives the delivery fee on orders of $${PASS_FREE_DELIVERY_MIN} or more, and members top up small baskets to reach it: ${BUMP_SHARE * 100}% of Pass orders (trial or member at order time) with a $${BUMP_FROM}-${PASS_FREE_DELIVERY_MIN - 0.01} subtotal add an item that lifts them past $${PASS_FREE_DELIVERY_MIN}. Topped-up baskets land at $${PASS_FREE_DELIVERY_MIN + 0.5}-${PASS_FREE_DELIVERY_MIN + 4.5}, so among $${BUMP_FROM}-${PASS_FREE_DELIVERY_MIN + 4.99} orders the share under $${PASS_FREE_DELIVERY_MIN} is ${r3(1 - BUMP_SHARE)}x for Pass orders vs non-Pass orders (conditioning on the $${BUMP_FROM}-${PASS_FREE_DELIVERY_MIN + 4.99} range keeps household basket-size mix out of the read). Pass orders cluster on about 2,360 customers, so the read uses the knob as target with a half-effect ceiling.`,
		mixpanelReport: { type: "Insights", event: "order placed", measure: "total", breakdown: ["pass_status", `subtotal_usd (custom buckets 10-15, 15-20)`], formula: "share of orders in the $10-15 bucket" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H8_SQL },
				select: { p: { where: { grp: "pass" } }, n: { where: { grp: "no_pass" } } },
				// Pass orders cluster on about 2,360 customers (relative SE about 5%), so a half-effect ceiling
				expect: { metric: "p.small_basket_share / n.small_basket_share", op: "<=", target: r3(1 - BUMP_SHARE), floor: halfToward(1 - BUMP_SHARE, 1) },
				minCohort: 1000,
			},
		],
	},
	{
		id: "H9-service-fee-change",
		hook: "H9",
		archetype: "temporal-inflection",
		narrative: `On ${D(FEE_CHANGE)} the service fee on non-Pass orders rises from ${FEE_RATE_BEFORE * 100}% to ${FEE_RATE_AFTER * 100}% of the subtotal (Pass stays at ${PASS_FEE_RATE * 100}%). Non-Pass checkouts convert to orders at ${FEE_KEEP}x their earlier rate; Pass checkouts do not change. Read: per-checkout conversion, non-Pass after/before over Pass after/before (difference in differences), card-incident days excluded.`,
		mixpanelReport: { type: "Funnels", steps: ["checkout started", "order placed"], counting: "totals", holdPropertyConstant: "order_id", window: "1 hour", breakdown: "pass_status", chart: `before vs after ${D(FEE_CHANGE)}` },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H9_SQL },
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.did", op: "between", target: band(FEE_KEEP) },
				minCohort: 1000,
			},
		],
	},
	{
		id: "H10-order-again-launch",
		hook: "H10",
		archetype: "funnel-ttc-by-segment",
		narrative: `"Order Again" ships ${D(REORDER_LAUNCH)}: customers with a past delivery can reorder from a recent restaurant in one tap. Adoption ramps over ${REORDER_RAMP_DAYS} days to about ${REORDER_SHARE * 100}% of eligible sessions (each customer's habit scatters around that). An Order Again session reaches "order placed" ${REORDER_TTC_MULT}x as fast as a browsing session (median ${TTC_MEDIAN_MIN} min from app opened) and reaches checkout far more often, so sessions that use it end in an order ${r3(REORDER_CONV_RATIO)}x as often as browsing sessions of the same customers (each Order Again session has exactly one reorder tapped, so the session order rate reads as an Insights formula). No reorder tapped exists before the launch.`,
		mixpanelReport: {
			type: "Funnels + Insights",
			steps: ["app opened", "order placed"], counting: "totals", window: `${TTC_WINDOW_MIN} minutes`, measure: "median time to convert", breakdown: "step 2 entry_point (reorder vs others)", dateRange: `${D(REORDER_LAUNCH)} to ${D(DATASET_END)}`,
			second: `Insights, cohort "did reorder tapped", ${D(REORDER_LAUNCH)} to ${D(DATASET_END)}, totals: A = order placed where entry_point = reorder, B = reorder tapped, C = order placed where entry_point is not reorder, D = app opened; formula (A / B) / (C / (D - B))`,
		},
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H10_SQL },
				select: { r: { where: { grp: "reorder" } }, b: { where: { grp: "browse" } } },
				expect: { metric: "r.med_minutes / b.med_minutes", op: "between", target: band(REORDER_TTC_MULT) },
				minCohort: 2000,
			},
			{
				breakdown: { type: "duckdb", sql: H10_CONV_SQL },
				select: { r: { where: { grp: "reorder" } }, b: { where: { grp: "browse" } } },
				expect: { metric: "r.order_rate / b.order_rate", op: "between", target: band(REORDER_CONV_RATIO) },
				minCohort: 2000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count, count(*) FILTER (WHERE t < TIMESTAMP '${TS(REORDER_LAUNCH)}') AS early FROM ev WHERE event = 'reorder tapped'`,
				},
				select: { a: { where: { grp: "all" } } },
				// exact: Order Again does not exist before the launch
				expect: { metric: "a.early", op: "between", target: [0, 0] },
			},
		],
	},
];

export default config;
export { LATE_REPEAT_RATIO, RAIN_SESSION_SHARE, PLACE_EARLY, PLACE_LATE };
