// ── IMPORTS ──
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);
import "dotenv/config";
import * as u from "@ak--47/dungeon-master/utils";
import { hashFloat, cloneEvent } from "@ak--47/dungeon-master/hook-helpers";
/** @typedef {import("../../../types").Dungeon} Config */

// ── OVERVIEW ──
/*
 * NAME:       Shieldstone Insurance
 * APP:        Direct-to-consumer personal insurance carrier (web, iOS, Android)
 *             selling auto (6-month terms), homeowners and renters (12-month
 *             terms) in 12 US states. Shoppers get a quote online without an
 *             account, create an account to save or buy it, and then manage the
 *             policy in the app: ID cards, documents, bills, coverage changes,
 *             roadside help, and claims. Autopay or manual monthly installments
 *             (or the full term up front).
 * SCALE:      10,000 people (≈3,700 shoppers start a first quote in the window,
 *             ≈2,600 of them never create an account; ≈5,900 are existing
 *             policyholders), ~0.76M events, 120 days
 *             (2026-06-04 → 2026-10-01, UTC)
 * CORE LOOP:  quote started → quote completed → account created → policy
 *             purchased → payment made (monthly) → renewal offered → policy
 *             renewed; claims: claim started → claim submitted → claim settled
 *
 * EVENTS (23):
 *   app opened > policy viewed > billing viewed > documents viewed
 *   > id card viewed > support chat started > payment made > coverage changed
 *   > roadside assistance requested > renewal offered > policy renewed
 *   > quote started > $experiment_started > quote completed
 *   > claim status checked > account created > claim submitted > claim started
 *   > claim settled > payment failed > policy cancelled > policy purchased
 *   > claim photos uploaded
 *
 * FUNNELS (2 declared; the everything hook builds the policy lifecycle):
 *   - Quote (first funnel, born shoppers): quote started → quote completed →
 *       account created → policy purchased (engine 100%; the hook decides every
 *       step, because completion depends on the experiment arm (H3), purchase on
 *       channel, product and quote date (H4, H5), and purchase timing on the
 *       shopping reason (H9)). Carries the Express Quote experiment (multipliers
 *       1.0; the hook applies the effect).
 *   - Account visit (weight 12, first-fixed): app opened → policy viewed /
 *       billing viewed / id card viewed / documents viewed
 *
 * USER PROPS:  state, region, age_band, product_lines, bundle, autopay,
 *              customer_status, customer_since, acquisition_channel,
 *              shopping_reason, "Experiment: Express Quote"
 * SUPER PROPS: platform (web / ios / android from the device OS; server for
 *              back-office events), state (sticky per person)
 * SCD PROPS:   none
 * GROUPS:      none
 * WAREHOUSE:   marketing_spend_daily (spend by paid channel),
 *              claims_operations_daily (claims intake, closures, backlog,
 *              adjuster hours, catastrophe code by region),
 *              written_premium_daily (written premium and policies by product
 *              line and new business / renewal, rate level index)
 * LOOKUPS:     none — every attribute is denormalized onto events/profiles
 * SOUP:        weekday-heavy dayOfWeekWeights; US daytime hourOfDayWeights (UTC)
 *
 * IDENTITY: shoppers are anonymous while they quote. quote started and quote
 * completed carry device_id only; account created (isAuthEvent) carries
 * user_id + device_id and stitches the quote device to the customer.
 * $experiment_started (exposed shoppers, 1 s before quote started) carries the
 * quote device_id, plus user_id for shoppers who later create an account (the
 * engine stamps it); for shoppers who never sign up the hook keeps it
 * device-only. A shopper who never creates an account (or whose account would
 * land after the window end) stays a device-only visitor and has no profile
 * (_drop). Existing customers are identified throughout; a person with no
 * events in the window (policies cancelled before June 4, or no activity at
 * all) has no profile either, so profiles = identified people with events.
 * App events carry user_id + device_id (1-4 devices per person, about half use
 * more than one; platform agrees with the device OS). Back-office events
 * (policy purchased, autopay payments and failures, renewal offered, policy
 * renewed, policy cancelled, claim settled) carry user_id only and
 * platform = server.
 *
 * DESIGN NOTES:
 * - Policies: existing customers hold auto, home, renters, auto+home, or
 *   auto+renters (bundle = two lines). Each policy has a term start drawn
 *   uniformly in the term before June 4, a monthly or paid-in-full plan, and an
 *   account-level payment method (autopay card/bank, or manual card/bank).
 * - Billing: monthly installments on the policy anniversary day; autopay draws
 *   post at 07-11 UTC on the due date, manual payers pay 4 days early to 3 days
 *   late. Failed payments, retries and nonpayment cancellations follow H10. One
 *   billing cycle before June 4 is simulated so nonpayment cancellations do not
 *   ramp from zero.
 * - Renewals: renewal offered 30 days before each term end; the customer leaves
 *   (cancels before the term ends) per H6/H7, otherwise policy renewed at the
 *   term end at the new premium. Renewals in the window are not on the new auto
 *   rate plan.
 * - Claims: auto 0.10, home 0.05, renters 0.03 claims per policy per 120 days
 *   (app-active customers, glass included), plus hurricane claims (H2). Claims
 *   reported in the 45 days before June 4 are simulated so June settlements do
 *   not ramp from zero. 8% of claims are denied (payout 0).
 * - Window start: a few existing customers quoted in late May and buy in early
 *   June, so purchases are flat from week 1.
 * - Warehouse drift: marketing networks over-claim conversions and comparison
 *   sites bill their own lead counts (clicks = leads x 1.0-1.3); claims ops adds
 *   phone-reported claims that never touch the app (an independent daily
 *   Poisson count, plus storm calls that queue behind the reps' daily capacity
 *   after the hurricane); written premium adds phone-sold policies and nets
 *   flat cancellations.
 */

// ── HOOK STORIES ──
/*
 * All effects are hidden: no flag properties. Dates live in the TIMELINE
 * constants and are shared by hooks, stories, SQL, warehouse columns, and the
 * timeline guide. Rare outcomes use stratified draws (`quota` / `quotaPick`):
 * each event still fires with its knob probability, but a stratum's total does
 * not carry binomial noise, so reads on a few hundred events land on the knob.
 * Strata: purchase by channel group x auto/property x before/after the rate
 * change x quote week (H4, H5); non-renewal by bundled x notice month (H6;
 * each notice fires with its own price-curve probability, so the H7 price
 * buckets are not strata and carry ordinary sampling noise); photo adoption by
 * peril (H1); shopper channel mix by period and pre-campaign social thinning
 * (H8); autopay retries that fail again (H10). The manual-payment lapse (H10),
 * quote completion (H3), settle times (H1, H2) and purchase gaps (H9) are
 * ordinary seeded draws.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H1. SNAP & SETTLE LAUNCH (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-07-21, 60% of auto collision/glass/comprehensive claims
 *   use photo estimates (claim_channel = photo_estimate) and settle in 0.3x the
 *   time of adjuster-inspected claims with the same peril mix.
 * MIXPANEL: Funnels, claim submitted → claim settled, Totals, hold claim_id
 *   constant, 30-day window, filter product_line = auto and peril in (collision,
 *   glass, comprehensive), Jun 4 - Sep 15 (photo estimates exist only from Jul
 *   21; adjuster handling did not change), breakdown claim_channel, median TTC.
 * REAL WORLD: AI photo estimating cuts days of waiting for an adjuster visit.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H2. HURRICANE DELPHINE (everything + warehouse claims_operations_daily;
 *     external-join)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: landfall 2026-08-27 in FL/LA. Gulf home (35%) and renters (12%)
 *   policies file storm claims in the following days; every Gulf property claim
 *   reported Aug 27 - Sep 9 settles 2.5x slower. The warehouse shows
 *   catastrophe_code = PCS-2614 for gulf_coast on those 14 days, catastrophe
 *   adjusters arriving, and the open-claims backlog.
 * MIXPANEL: Funnels, claim submitted → claim settled, Totals, hold claim_id,
 *   45-day window, property claims, breakdown region; join the warehouse
 *   catastrophe days.
 * REAL WORLD: a catastrophe swamps local adjusters for weeks.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H3. EXPRESS QUOTE EXPERIMENT (Quote funnel experiment + everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-07-08 new shoppers split 50/50. Express Quote (pre-filled
 *   vehicle/property data) lifts quote completion 1.3x (55% → 71.5%) and halves
 *   the time to complete (median 16 min). Purchases per completed quote are not
 *   engineered by arm.
 * MIXPANEL: Funnels, quote started → quote completed, 1-day window, from Jul 8,
 *   breakdown quote_flow (or Experiments report on $experiment_started).
 * REAL WORLD: every question removed from a quote form lifts completion.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H4. COMPARISON-SITE ECONOMICS (everything + warehouse marketing_spend_daily;
 *     external-join)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: spend per quote start $45 comparison sites (billed per lead), $95
 *   search, $40 social; comparison-site shoppers buy at 0.45x the rate of every
 *   other channel, so their cost per policy matches search.
 * MIXPANEL: Insights, quote started by acquisition_channel joined to
 *   marketing_spend_daily.spend_usd; Funnels, quote completed → policy
 *   purchased, 14-day window, breakdown acquisition_channel.
 * REAL WORLD: aggregator shoppers collect prices; few buy.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H5. AUTO RATE CHANGE (everything + warehouse written_premium_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-08-17 new-business auto quotes price 1.14x; purchases per
 *   completed auto quote fall to 0.75x; written premium per completed auto quote
 *   is 0.855x. Home and renters are unchanged.
 * MIXPANEL: Insights, average quoted_premium_monthly on quote completed (auto);
 *   Funnels, quote completed → policy purchased, 14-day window, breakdown
 *   product_line, before vs after Aug 17; written_premium_daily for premium.
 * REAL WORLD: a rate filing that loses more buyers than it earns per buyer.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H6. BUNDLES RENEW (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: a bundled policy (auto + home / auto + renters) leaves at renewal at
 *   0.4x the rate of a single-line policy with the same price change.
 * MIXPANEL: Funnels, renewal offered → policy cancelled (cancel_reason in
 *   found_cheaper, price_increase), Totals, hold policy_id, 35-day window,
 *   offers Jun 4 - Aug 31, breakdown is_bundled.
 * REAL WORLD: multi-line customers are the stickiest in personal lines.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H7. RENEWAL PRICE SHOCK (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: dose-response. Non-renewal is 7% with no increase and rises
 *   linearly with the renewal premium change to 28% at +15% (4x); 0-15%
 *   increases average 2.40x no-increase. The model holds 28% above +15%, but
 *   with under 100 notices above +20% that cap is not visible in the data.
 * MIXPANEL: same funnel as H6, filter is_bundled = false (holds H6 constant),
 *   breakdown premium_change_pct custom buckets (≤ 0, 0-15, ≥ 15).
 * REAL WORLD: customers shop around when the renewal bill jumps.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H8. FALL SOCIAL CAMPAIGN (everything + warehouse marketing_spend_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-09-08 the social budget doubles and social quote starts
 *   per day rise 1.8x (new shoppers; other channels flat). Campaign shoppers
 *   answer a "Switch & Save" ad, so they lean to auto (80%) and switching
 *   (72%). Warehouse social spend per day ≈ 1.9x.
 * MIXPANEL: Insights, quote started per day by acquisition_channel, before vs
 *   from Sep 8; join social spend for the incremental cost per quote.
 * REAL WORLD: a seasonal "switch and save" push on social feeds.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H9. SWITCHERS TAKE LONGER (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: quote completed → policy purchased takes 3x as long for switching
 *   shoppers as for life_change / first_policy shoppers (base median 16 h).
 * MIXPANEL: Funnels, quote completed → policy purchased, 14-day window, quotes
 *   Jun 4 - Sep 17, median TTC, breakdown shopping_reason.
 * REAL WORLD: a switcher compares against the policy they already have; a new
 *   car owner needs coverage today.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H10. AUTOPAY AND LAPSES (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: scheduled installments fail 5% (manual) vs 1.5% (autopay); 25% of
 *   failed manual payments end in a nonpayment cancellation 10-25 days later;
 *   autopay failures retry after 3 days (5% fail again and lapse).
 * MIXPANEL: Insights, payment failed / (payment made + payment failed), both
 *   is_retry = false, breakdown payment_method; Funnels, payment failed (step 1
 *   filter is_retry = false) → policy cancelled (cancel_reason = nonpayment),
 *   Totals, hold policy_id, 30-day window.
 * REAL WORLD: nonpayment is the largest source of mid-term cancellations.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * EXPECTED METRICS SUMMARY (measured: data/verify-insurance-application,
 * 2026-10-07, full fidelity, 10,000 people, 757,612 events)
 * ═════════════════════════════════════════════════════════════════════════
 * Hook | Metric                                          | Derivation                  | Expected | Measured
 * -----|-------------------------------------------------|-----------------------------|----------|---------
 * H1   | median days to settle, photo / adjuster (elig.) | PHOTO_SETTLE_MULT           | 0.30     | 0.302 (1.87 vs 6.19 d)
 * H1   | photo_estimate share of eligible auto claims    | PHOTO_ADOPT                 | 0.60     | 0.619 (117 of 189)
 * H1   | photo_estimate claims before launch             | exact purity                | 0        | 0
 * H2   | median days, Gulf CAT property / other property | CAT_SETTLE_MULT             | 2.50     | 2.491 (17.35 vs 6.97 d)
 * H2   | warehouse catastrophe-code rows                 | 14 days x 1 region          | 14       | 14
 * H3   | quote completion, Express / Control             | EXPRESS_CONV_MULT           | 1.30     | 1.317 (71.8% vs 54.5%)
 * H3   | median minutes to complete, Express / Control   | EXPRESS_TIME_MULT           | 0.50     | 0.519 (8.0 vs 15.5)
 * H3   | Express share of exposed shoppers               | equal 2-arm hash            | 0.50     | 0.494 (1,340 of 2,710)
 * H4   | spend per quote start, comparison / search      | 45 / 95                     | 0.474    | 0.461 ($44.41 vs $96.24)
 * H4   | purchase per completed quote, comparison / rest | COMPARISON_BIND_MULT        | 0.45     | 0.467 (13.3% vs 28.5%)
 * H5   | avg quoted auto premium, after / before         | AUTO_RATE_MULT              | 1.14     | 1.136 ($181.04 vs $159.41)
 * H5   | auto purchase per completed quote, after/before | AUTO_BIND_KEEP              | 0.75     | 0.753 (19.2% vs 25.6%)
 * H5   | property purchase per completed quote (control) | unchanged (knob ±10%)       | 1.00     | 0.970 (25.5% vs 26.3%)
 * H5   | warehouse auto NB premium per completed quote   | 0.75 x 1.14                 | 0.855    | 0.888 ($251 vs $282)
 * H6   | non-renewal per notice, bundled / single-line   | BUNDLE_NONRENEW_MULT        | 0.40     | 0.396 (6.5% vs 16.4%)
 * H7   | single-line non-renewal, ≥ 15% / no increase    | NONRENEW_HIGH / NONRENEW_LOW| 4.00     | 2.909 (23.3% vs 8.0%)
 * H7   | single-line non-renewal, 0-15% / no increase    | linear curve over the draw  | 2.40     | 2.208 (17.7% vs 8.0%)
 * H8   | social quote starts per day, campaign / before  | SOCIAL_LIFT                 | 1.80     | 1.726 (5.13 vs 2.97)
 * H8   | other channels per day, campaign / before       | unchanged                   | 1.00     | 0.963
 * H8   | warehouse social spend per day                  | (2.0 + 1.8) / 2             | 1.90     | 1.851 ($218.45 vs $118.03)
 * H9   | median hours quote → purchase, switching/other  | SWITCHER_TTC_MULT           | 3.00     | 3.233 (52.4 vs 16.2 h)
 * H10  | scheduled payment failure, autopay / manual     | FAIL_AUTOPAY / FAIL_MANUAL  | 0.30     | 0.297 (1.47% vs 4.95%)
 * H10  | failed manual payments lapsing within 30 days   | LAPSE_AFTER_MANUAL_FAIL     | 0.25     | 0.260 (465 failures)
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Verdicts: 9 NAILED, 1 STRONG (H7: the ≥ 15% bucket reads 2.91x no increase
 * against the 4.0x knob and passes the 2.5x half-effect floor; the price
 * buckets are not strata, so 163 shock notices and 23 no-increase
 * non-renewals carry ordinary sampling noise). Every one-sided bound is the
 * half-effect bound 1 + 0.5 x (knob - 1); controls use knob ±10%. Noise notes:
 * insurance events are rare at 10,000 people (about 70 comparison-site
 * purchases, 109 bundled vs 244 single-line non-renewals), so the stratified
 * draws above carry the H4, H5 and H6 reads; sub-splits outside a stratum keep
 * ordinary sampling noise. The H8 control (other channels per day) rests on
 * engine births, about ±4% per period. claims_operations_daily correlates
 * 0.97 with Mixpanel claim submissions: phone-reported claims follow their own
 * daily count and, after the hurricane, the reps' daily capacity. Auto claim
 * frequency is 0.10 per policy per 120 days (about 0.3 per policy-year with
 * glass, a policy often covers two cars), which leaves H1 about 190 eligible
 * claims after launch.
 */

// ── SCALE ──
const SEED = "dm4-insurance";
const NUM_USERS = 10_000;
const DATASET_START = "2026-06-04T00:00:00Z";
const DATASET_END = "2026-10-01T23:59:59Z"; // 120 days
const EVENTS_PER_DAY = 1.2;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

// Per-run state. The hook draws from the engine's seeded chance instance (the
// engine re-seeds it at the start of every run) and keeps its stratified-draw
// accumulators, clone templates and claim ledger per run, so a second run in
// the same process gives the same output as the first.
let chance = null;
let RUN_CONFIG = null;
const QUOTA = new Map();
// first-seen copy of every event (string keys only), the clone source when a
// customer's own stream has no instance of an event the hook needs
const TEMPLATES = {};
// claim-ops accumulators for the warehouse (filled in the everything hook,
// read by the warehouse hook after the user loop)
const CLAIM_LEDGER = []; // { region, submitDay, settleDay | null }
function beginRun(cfg) {
	if (cfg === RUN_CONFIG) return;
	RUN_CONFIG = cfg;
	chance = u.getChance();
	QUOTA.clear();
	for (const k of Object.keys(TEMPLATES)) delete TEMPLATES[k];
	CLAIM_LEDGER.length = 0;
}

// ── TIMELINE (shared by hooks, stories, SQL, warehouse columns, guides) ──
const EXPRESS_QUOTE_START = "2026-07-08T00:00:00Z";   // "Express Quote" A/B test starts in the web/app quote flow
const SNAP_SETTLE_LAUNCH = "2026-07-21T00:00:00Z";    // Snap & Settle (photo estimates for auto claims) launches
const AUTO_RATE_CHANGE = "2026-08-17T00:00:00Z";      // new auto rate plan for new business takes effect
const HURRICANE_LANDFALL = "2026-08-27T00:00:00Z";    // Hurricane Delphine makes landfall (Florida Panhandle / Louisiana)
const CAT_END = "2026-09-10T00:00:00Z";               // exclusive: catastrophe reporting window Aug 27 - Sep 9
const SOCIAL_CAMPAIGN_START = "2026-09-08T00:00:00Z"; // fall "Switch & Save" social campaign starts (runs to window end)

const ms = (iso) => dayjs.utc(iso).valueOf();
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;
const BEGIN_MS = ms(DATASET_START);
const END_MS = ms(DATASET_END);
const WINDOW_DAYS = 120;

// ── WEEKLY AND DAILY RHYTHM (soup) ──
// Sun..Sat. Insurance is a weekday errand: people quote, pay, and file claims
// on workdays; weekends are quiet.
const DOW_WEIGHTS = [0.62, 1.12, 1.1, 1.08, 1.06, 1.0, 0.7];
// UTC hours. Customers are in US time zones (ET..MT): daytime 9am-9pm local is
// about 13:00-04:00 UTC, with a lunchtime and an after-work peak.
const HOUR_WEIGHTS = [0.75, 0.62, 0.45, 0.3, 0.18, 0.1, 0.07, 0.06, 0.07, 0.1, 0.18, 0.32,
	0.55, 0.8, 0.95, 1.0, 1.0, 0.98, 0.92, 0.9, 0.95, 0.98, 0.95, 0.88];

// ── KNOBS ──
// Shopping funnel (born-in-window shoppers)
const BORN_PCT = 40;
const QUOTE_COMPLETE_BASE = 0.55;      // share of quote starts that finish the quote (Control)
const QUOTE_MINUTES_MEDIAN = 16;       // minutes from quote started to quote completed (Control)
const SAVE_QUOTE_SHARE = 0.35;         // non-buyers who create an account to save their quote
const BIND_BASE = 0.3;                 // share of completed quotes that buy (search, social, organic, referral)

// H3 Express Quote experiment (pre-filled vehicle / property data)
const EXPRESS_EXPERIMENT = "Express Quote";
const EXPRESS_VARIANT = "Express Quote";
const EXP_KEY = `Experiment: ${EXPRESS_EXPERIMENT}`;
const EXPRESS_CONV_MULT = 1.3;         // quote completion, variant / control
const EXPRESS_TIME_MULT = 0.5;         // minutes to complete, variant / control

// H4 acquisition channels (warehouse marketing_spend_daily)
const CHANNEL_WEIGHTS = { search_ads: 30, comparison_site: 24, social_ads: 16, organic: 20, referral: 10 };
const PAID_CHANNELS = ["search_ads", "comparison_site", "social_ads"];
const COMPARISON_BIND_MULT = 0.45;     // comparison-site shoppers buy at 0.45x the rate of every other channel
const COST_PER_QUOTE = { search_ads: 95, comparison_site: 45, social_ads: 40 }; // window spend per Mixpanel quote start

// H5 auto rate change (warehouse written_premium_daily)
const AUTO_RATE_MULT = 1.14;           // new-business auto premiums from AUTO_RATE_CHANGE
const AUTO_BIND_KEEP = 0.75;           // auto bind rate per completed quote after the change, vs before

// H6 / H7 renewals
const BUNDLE_NONRENEW_MULT = 0.4;      // bundled customers (2 lines) leave at renewal at 0.4x the single-line rate
const NONRENEW_LOW = 0.07;             // non-renewal when the renewal premium does not rise (change <= 0%)
const NONRENEW_HIGH = 0.28;            // non-renewal when it rises 15% or more (linear in between)
const PRICE_SHOCK_PCT = 15;
const RENEWAL_NOTICE_DAYS = 30;

// H8 fall social campaign
const SOCIAL_LIFT = 1.8;               // social_ads quote starts per day, campaign / before
const SOCIAL_BUDGET_MULT = 2.0;        // social planned budget, campaign / before
// "Switch & Save" targets drivers who already have a policy elsewhere: campaign
// shoppers lean to auto quotes and switching
const CAMPAIGN_PRODUCT_WEIGHTS = { auto: 80, home: 10, renters: 10 };
const CAMPAIGN_REASON_WEIGHTS = { switching: 72, life_change: 18, first_policy: 10 };

// H9 time from quote to purchase, by shopping reason
const BIND_GAP_MEDIAN_H = 16;
const BIND_GAP_SIGMA = 0.6;
const SWITCHER_TTC_MULT = 3.0;         // switching shoppers take 3x as long to buy

// H10 billing
const FAIL_MANUAL = 0.05;              // scheduled manual payments that fail
const FAIL_AUTOPAY = 0.015;            // scheduled autopay draws that fail
const LAPSE_AFTER_MANUAL_FAIL = 0.25;  // failed manual payments that end in a nonpayment cancellation
const AUTOPAY_RETRY_DAYS = 3;
const AUTOPAY_RETRY_FAIL = 0.05;     // autopay retries that fail again (the policy then lapses)

// H1 Snap & Settle
const PHOTO_ELIGIBLE = ["collision", "glass", "comprehensive"];
const PHOTO_ADOPT = 0.6;               // eligible auto claims filed with photo estimates after launch
const PHOTO_SETTLE_MULT = 0.3;         // photo-estimate settle time / adjuster settle time
const AUTO_SETTLE_DAYS = { collision: 8, glass: 4, comprehensive: 7, theft: 15, liability: 13 };
const AUTO_SETTLE_SIGMA = 0.28;

// H2 Hurricane Delphine
const GULF_STATES = ["FL", "LA"];
const HURRICANE_CLAIM_P = { home: 0.35, renters: 0.12 };
const HURRICANE_REPORT_MEAN_DAYS = 2;
const CAT_SETTLE_MULT = 2.5;           // Gulf property claims reported during the CAT window settle 2.5x slower
const PROPERTY_SETTLE_DAYS = 7;
const PROPERTY_SETTLE_SIGMA = 0.3;

// base rates (realism, not stories)
const CLAIM_RATE = { auto: 0.1, home: 0.05, renters: 0.03 }; // claims per policy per 120 days
const MIDTERM_CANCEL = 0.02;           // per policy per 120 days (sold vehicle, moved, ...)
const DENIAL_SHARE = 0.08;
const AUTOPAY_SHARE_EXISTING = 0.55;
const AUTOPAY_SHARE_NEW = 0.5;
const MONTHLY_PLAN_SHARE = 0.8;
const PREWINDOW_CLAIM_DAYS = 45;       // warm start: claims reported before June 4 still open in June
const TERM_MONTHS = { auto: 6, home: 12, renters: 12 };

// ── DATA ──
const STATES = {
	TX: { w: 16, region: "south", auto: 1.1, home: 1.3, renters: 1.05 },
	FL: { w: 13, region: "gulf_coast", auto: 1.35, home: 1.85, renters: 1.2 },
	PA: { w: 10, region: "northeast", auto: 0.95, home: 0.85, renters: 0.95 },
	IL: { w: 9, region: "midwest", auto: 1.0, home: 0.95, renters: 1.0 },
	GA: { w: 8, region: "south", auto: 1.1, home: 1.05, renters: 1.0 },
	OH: { w: 8, region: "midwest", auto: 0.85, home: 0.8, renters: 0.9 },
	AZ: { w: 8, region: "west", auto: 1.05, home: 0.9, renters: 0.95 },
	NC: { w: 7, region: "south", auto: 0.9, home: 1.0, renters: 0.9 },
	CO: { w: 6, region: "west", auto: 1.15, home: 1.2, renters: 1.0 },
	LA: { w: 5, region: "gulf_coast", auto: 1.45, home: 1.7, renters: 1.15 },
	MI: { w: 5, region: "midwest", auto: 1.3, home: 0.9, renters: 0.95 },
	TN: { w: 5, region: "south", auto: 0.95, home: 1.0, renters: 0.9 },
};
const REGIONS = ["gulf_coast", "south", "midwest", "west", "northeast"];
const HOLDINGS_WEIGHTS = { auto: 40, home: 10, renters: 12, "auto+home": 25, "auto+renters": 13 };
const QUOTE_PRODUCT_WEIGHTS = { auto: 58, home: 22, renters: 20 };
const REASON_WEIGHTS = { switching: 50, life_change: 32, first_policy: 18 };
const TIER_WEIGHTS = { basic: 30, standard: 50, premium: 20 };
const TIER_FACTOR = { basic: 0.8, standard: 1.0, premium: 1.3 };
const BASE_PREMIUM = { auto: 145, home: 135, renters: 18 }; // monthly, before state/tier/risk
const AUTO_PERILS = { collision: 40, glass: 25, comprehensive: 15, theft: 5, liability: 15 };
const HOME_PERILS = { water: 35, wind_hail: 25, fire: 8, theft: 17, liability: 15 };
const RENTERS_PERILS = { theft: 45, water: 30, fire: 10, liability: 15 };
const AVG_LOSS = { collision: 4200, glass: 450, comprehensive: 2600, theft: 3800, liability: 7500, water: 9500, wind_hail: 12000, fire: 26000 };
const NONRENEW_REASONS = { found_cheaper: 55, price_increase: 45 };
const MIDTERM_REASONS = { sold_vehicle: 40, moved: 35, no_longer_needed: 25 };

// ── HELPERS ──
const salt = (uid, tag) => hashFloat(`${uid}|${tag}`);
// Stratified draw (systematic sampling): within one stratum key, events fire at
// rate p in order of arrival, from a seeded start offset. Each event still fires
// with probability p, but a stratum's total no longer carries binomial noise, so
// rare outcomes at 10,000 people (purchases, non-renewals, photo claims) land on
// the knob. Users are processed in a fixed order, so this is deterministic.
const quota = (key, p) => {
	const acc = (QUOTA.has(key) ? QUOTA.get(key) : hashFloat(`quota|${key}`)) + p;
	const fires = acc >= 1;
	QUOTA.set(key, fires ? acc - 1 : acc);
	return fires;
};
// stratified categorical draw: each category accrues its weight share per call and
// the most-owed category is picked, so a stratum's mix matches the weights
const quotaPick = (key, weights) => {
	const total = Object.values(weights).reduce((a, b) => a + b, 0);
	let best = null;
	for (const [k, w] of Object.entries(weights)) {
		const sk = `${key}|${k}`;
		const acc = (QUOTA.has(sk) ? QUOTA.get(sk) : hashFloat(`quota|${sk}`)) + w / total;
		QUOTA.set(sk, acc);
		if (best === null || acc > QUOTA.get(`${key}|${best}`)) best = k;
	}
	QUOTA.set(`${key}|${best}`, QUOTA.get(`${key}|${best}`) - 1);
	return best;
};
const round2 = (n) => Math.round(n * 100) / 100;
const round1 = (n) => Math.round(n * 10) / 10;
const T = (e) => dayjs.utc(e.time).valueOf();
const iso = (t) => new Date(Math.round(t)).toISOString();
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const dayStart = (t) => Math.floor(t / DAY_MS) * DAY_MS;
const logNormal = (sigma) => Math.exp(chance.normal({ mean: 0, dev: sigma }));
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
const draw = (obj) => pickWeighted(obj, chance.floating({ min: 0, max: 1 }));
const bool = (p) => chance.floating({ min: 0, max: 1 }) < p;
const between = (a, b) => a + chance.floating({ min: 0, max: 1 }) * (b - a);
const addMonths = (t, n) => dayjs.utc(t).add(n, "month").valueOf();
const idDigits = (key) => String(Math.floor(hashFloat(`${key}|a`) * 1e6)).padStart(6, "0") + String(Math.floor(hashFloat(`${key}|b`) * 1e6)).padStart(6, "0");
const MAX_DOW = Math.max(...DOW_WEIGHTS);
const HOUR_TOTAL = HOUR_WEIGHTS.reduce((a, b) => a + b, 0);
/** a time on the given UTC day at a customer-hours weighted hour */
function atCustomerHour(day) {
	let r = chance.floating({ min: 0, max: HOUR_TOTAL });
	let h = 0;
	for (; h < 23; h++) { r -= HOUR_WEIGHTS[h]; if (r < 0) break; }
	return day + h * HOUR_MS + chance.integer({ min: 0, max: 3599 }) * 1000;
}
/** a customer-initiated moment in [from, to): weekday-weighted day, customer-hours weighted hour */
function customerTime(from, to) {
	let t = between(from, to);
	for (let i = 0; i < 8; i++) {
		if (bool(DOW_WEIGHTS[new Date(t).getUTCDay()] / MAX_DOW)) break;
		t = between(from, to);
	}
	const x = atCustomerHour(dayStart(t));
	return Math.min(Math.max(x, from), to - 1000);
}
/** nearest moment inside a 13:00-23:00 UTC working shift */
function toShift(t) {
	const d = dayStart(t);
	const h = (t - d) / HOUR_MS;
	if (h >= 13 && h <= 23) return t;
	if (h > 23) return d + 23 * HOUR_MS - chance.integer({ min: 1, max: 600 }) * 1000;
	if (h < 6) return d - HOUR_MS - chance.integer({ min: 1, max: 600 }) * 1000; // previous day's shift end
	return d + 13 * HOUR_MS + chance.integer({ min: 1, max: 600 }) * 1000;
}
const monthlyPremium = (uid, product, state, tier, t, isNewBusiness) => {
	const st = STATES[state] || STATES.TX;
	const risk = 0.75 + 0.5 * hashFloat(`${uid}|risk|${product}`);
	let p = BASE_PREMIUM[product] * st[product] * TIER_FACTOR[tier] * risk;
	if (isNewBusiness && product === "auto" && t >= ms(AUTO_RATE_CHANGE)) p *= AUTO_RATE_MULT;
	return round2(p);
};
const nonRenewProb = (chg, bundled) => {
	const x = Math.min(1, Math.max(0, chg / PRICE_SHOCK_PCT));
	return (NONRENEW_LOW + (NONRENEW_HIGH - NONRENEW_LOW) * x) * (bundled ? BUNDLE_NONRENEW_MULT : 1);
};
const platformOf = (os) => (os === "Android" ? "android" : os === "iOS" || os === "iPadOS" ? "ios" : "web");

// event families
const SHOPPING = ["quote started", "quote completed", "account created", "policy purchased", "$experiment_started"];
const LIFECYCLE = new Set(["policy purchased", "payment made", "payment failed", "renewal offered", "policy renewed", "policy cancelled",
	"claim started", "claim photos uploaded", "claim submitted", "claim status checked", "claim settled"]);
const APP_EVENTS = new Set(["app opened", "policy viewed", "billing viewed", "id card viewed", "documents viewed", "coverage changed",
	"support chat started", "roadside assistance requested"]);
// realism: occasional actions keep only a share of the engine's draws (about one
// roadside call per 25 auto customers, a support chat or a coverage change
// every few months per customer)
const APP_KEEP = { "roadside assistance requested": 0.04, "support chat started": 0.2, "coverage changed": 0.25 };
const AUTO_ONLY = new Set(["id card viewed", "roadside assistance requested"]);
const DEVICE_KEYS = ["device_id", "os", "model", "carrier", "radio", "screen_height", "screen_width", "browser", "manufacturer", "os_version", "app_version_string", "wifi"];

const stripCopy = (e) => {
	const c = {};
	for (const [k, v] of Object.entries(e)) if (!DEVICE_KEYS.includes(k) && k !== "user_id") c[k] = v;
	return c;
};

// ── USER HOOK ──
function handleUserHook(profile, meta) {
	beginRun(meta.config);
	const uid = profile.distinct_id;
	profile.region = (STATES[profile.state] || STATES.TX).region;
	profile.shopping_reason = pickWeighted(REASON_WEIGHTS, salt(uid, "reason"));
	if (meta.userIsBornInDataset) {
		profile.product_lines = pickWeighted(QUOTE_PRODUCT_WEIGHTS, salt(uid, "quote-product"));
		profile.bundle = false;
		profile.autopay = false;
		profile.customer_status = "prospect";
		profile.customer_since = null;
		return profile;
	}
	profile.product_lines = pickWeighted(HOLDINGS_WEIGHTS, salt(uid, "holdings"));
	profile.bundle = profile.product_lines.includes("+");
	profile.autopay = salt(uid, "autopay") < AUTOPAY_SHARE_EXISTING;
	profile.customer_status = "active";
	// tenure: first policy between 2021-06 and 2026-04
	const span = ms("2026-04-30T00:00:00Z") - ms("2021-06-01T00:00:00Z");
	profile.customer_since = dayKey(ms("2021-06-01T00:00:00Z") + Math.floor(salt(uid, "tenure") * span / DAY_MS) * DAY_MS);
	return profile;
}

// ── EVERYTHING HOOK ──
function handleEverything(events, meta) {
	// a person with no app or web activity at all is not in Mixpanel: no events, no profile
	if (!events.length) { meta.profile._drop = true; return events; }
	const profile = meta.profile;
	const uid = profile.distinct_id;
	const born = meta.userIsBornInDataset;
	const state = profile.state;
	const region = (STATES[state] || STATES.TX).region;
	const gulf = GULF_STATES.includes(state);

	const own = {};
	for (const e of events) {
		if (!own[e.event]) own[e.event] = e;
		if (!TEMPLATES[e.event]) TEMPLATES[e.event] = stripCopy(e);
	}
	const devEv = events.find((e) => e.event === "quote started" && e.device_id) || events.find((e) => e.device_id);
	const devFields = {};
	if (devEv) for (const k of DEVICE_KEYS) if (devEv[k] !== undefined) devFields[k] = devEv[k];

	/** build an event from the customer's own instance (or the shared first-seen copy) */
	const make = (name, t, props, mode) => {
		const base = own[name] || TEMPLATES[name];
		if (!base) return null;
		const ev = cloneEvent(base, { time: iso(t) });
		Object.assign(ev, props);
		if (mode === "server") {
			for (const k of DEVICE_KEYS) delete ev[k];
			ev.user_id = uid;
			ev.platform = "server";
		} else {
			if (!own[name] || !ev.device_id) {
				for (const k of DEVICE_KEYS) delete ev[k];
				Object.assign(ev, devFields);
			}
			ev.user_id = uid;
			ev.platform = platformOf(ev.os);
		}
		return ev;
	};

	const out = [];
	const policies = [];
	let shopperEnd = null; // born prospects: last moment of activity

	// ── shopping: quote → account → purchase ──
	if (born) {
		const qs = events.find((e) => e.event === "quote started");
		// a shopper born at the very end of the window can have a funnel the engine
		// cut at the window edge; clone the missing steps onto the quote device (the
		// shopping logic below decides which of them are kept)
		const step = (name) => {
			const found = events.find((e) => e.event === name);
			if (found || !qs || !TEMPLATES[name]) return found;
			const c = cloneEvent(TEMPLATES[name], { time: qs.time });
			for (const k of DEVICE_KEYS) if (qs[k] !== undefined) c[k] = qs[k];
			if (name === "account created") c.user_id = uid;
			return c;
		};
		const qc = step("quote completed");
		const ac = step("account created");
		const pp = step("policy purchased");
		const ex = events.find((e) => e.event === "$experiment_started");
		if (!qs || !qc || !ac || !pp) {
			// no clone source yet: the shopper stays an anonymous device-only visitor
			const kept = events.filter((e) => !LIFECYCLE.has(e.event) && !APP_EVENTS.has(e.event) && e.event !== "account created");
			for (const e of kept) { delete e.user_id; e.platform = platformOf(e.os); }
			return kept;
		}
		const t0 = T(qs);
		// channel mix per period (before / during the fall campaign) follows CHANNEL_WEIGHTS
		const channel = quotaPick(`channel|${t0 >= ms(SOCIAL_CAMPAIGN_START)}`, CHANNEL_WEIGHTS);
		profile.acquisition_channel = channel;
		// H8: before the fall campaign, social brought fewer shoppers (the campaign adds volume)
		if (channel === "social_ads" && t0 < ms(SOCIAL_CAMPAIGN_START) && !quota("social-pre", 1 / SOCIAL_LIFT)) return [];
		// H8: campaign shoppers answer the "Switch & Save" ad: mostly drivers switching carriers
		if (channel === "social_ads" && t0 >= ms(SOCIAL_CAMPAIGN_START)) {
			profile.product_lines = pickWeighted(CAMPAIGN_PRODUCT_WEIGHTS, salt(uid, "campaign-product"));
			profile.shopping_reason = pickWeighted(CAMPAIGN_REASON_WEIGHTS, salt(uid, "campaign-reason"));
		}
		const product = profile.product_lines;
		const reason = profile.shopping_reason;
		const variant = ex && profile[EXP_KEY] !== undefined ? profile[EXP_KEY] : null;
		const express = variant === EXPRESS_VARIANT;
		const flow = express ? "express" : "standard";
		const completes = bool(QUOTE_COMPLETE_BASE * (express ? EXPRESS_CONV_MULT : 1));
		const quoteMin = Math.min(120, Math.max(3, QUOTE_MINUTES_MEDIAN * logNormal(0.5))) * (express ? EXPRESS_TIME_MULT : 1);
		const tC = t0 + quoteMin * MIN_MS;
		const tier = draw(TIER_WEIGHTS);
		const premium = monthlyPremium(uid, product, state, tier, tC, true);
		let pBind = BIND_BASE * (channel === "comparison_site" ? COMPARISON_BIND_MULT : 1);
		if (product === "auto" && tC >= ms(AUTO_RATE_CHANGE)) pBind *= AUTO_BIND_KEEP;
		const gapH = BIND_GAP_MEDIAN_H * logNormal(BIND_GAP_SIGMA) * (reason === "switching" ? SWITCHER_TTC_MULT : 1);
		const tAcct = tC + chance.integer({ min: 40, max: 360 }) * 1000;
		const tBind = Math.max(tAcct + 5 * MIN_MS, tC + gapH * HOUR_MS);
		// stratum: comparison vs other channels x auto vs property x before / after the rate change x quote week
		const week = Math.floor((tC - BEGIN_MS) / (7 * DAY_MS));
		const wantsBind = completes && quota(`bind|${channel === "comparison_site"}|${product === "auto"}|${tC >= ms(AUTO_RATE_CHANGE)}|${week}`, pBind);
		const binds = wantsBind && tBind <= END_MS;
		// an account created after the window end never reaches Mixpanel: the shopper stays anonymous
		const saves = completes && (wantsBind || bool(SAVE_QUOTE_SHARE)) && tAcct <= END_MS;

		qs.time = iso(t0);
		Object.assign(qs, { product_line: product, acquisition_channel: channel, quote_flow: flow });
		const shop = [qs];
		if (ex) shop.push(ex);
		if (completes) {
			qc.time = iso(tC);
			Object.assign(qc, { product_line: product, acquisition_channel: channel, quote_flow: flow, coverage_tier: tier,
				quoted_premium_monthly: premium, shopping_reason: reason });
			shop.push(qc);
		}
		if (!saves) {
			// anonymous shopper who never signs up: device-only quote events, no profile
			if (ex) delete ex.user_id;
			for (const e of shop) { e.platform = platformOf(e.os); }
			return shop;
		}
		ac.time = iso(tAcct);
		Object.assign(ac, { acquisition_channel: channel, product_line: product });
		shop.push(ac);
		for (const e of shop) e.platform = platformOf(e.os);
		for (const e of shop) out.push(e);
		if (!binds) {
			profile.customer_status = "prospect";
			shopperEnd = tAcct + 14 * DAY_MS; // logs back in to look at the saved quote, then leaves
		} else {
			const autopay = salt(uid, "autopay-new") < AUTOPAY_SHARE_NEW;
			profile.autopay = autopay;
			profile.customer_since = dayKey(tBind);
			const pol = newPolicy(uid, product, tier, premium, tBind, autopay, true);
			pp.time = iso(tBind);
			Object.assign(pp, purchaseProps(pol, channel, reason));
			for (const k of DEVICE_KEYS) delete pp[k];
			pp.user_id = uid;
			pp.platform = "server";
			out.push(pp);
			policies.push(pol);
		}
	} else {
		// existing customers; a few quoted in late May and buy in early June (warm start)
		const warm = salt(uid, "warm") < WARM_SHARE;
		let warmBind = null;
		if (warm) {
			const tq = BEGIN_MS - salt(uid, "warm-q") * 30 * DAY_MS;
			const gapH = BIND_GAP_MEDIAN_H * logNormal(BIND_GAP_SIGMA) * (profile.shopping_reason === "switching" ? SWITCHER_TTC_MULT : 1);
			if (tq + gapH * HOUR_MS >= BEGIN_MS) warmBind = tq + gapH * HOUR_MS;
		}
		if (warmBind !== null) {
			const product = pickWeighted(QUOTE_PRODUCT_WEIGHTS, salt(uid, "quote-product"));
			profile.product_lines = product;
			profile.bundle = false;
			profile.customer_since = dayKey(warmBind);
			const tier = draw(TIER_WEIGHTS);
			const premium = monthlyPremium(uid, product, state, tier, warmBind - DAY_MS, true);
			const pol = newPolicy(uid, product, tier, premium, warmBind, profile.autopay, true);
			const pp = make("policy purchased", warmBind, purchaseProps(pol, profile.acquisition_channel, profile.shopping_reason), "server");
			if (pp) { out.push(pp); policies.push(pol); }
		} else {
			for (const product of profile.product_lines.split("+")) {
				const tier = pickWeighted(TIER_WEIGHTS, salt(uid, `tier|${product}`));
				// the current term ends on a uniform day in the coming term; renewals and
				// installments stay anchored to that anniversary
				const termDays = Math.round((addMonths(BEGIN_MS, TERM_MONTHS[product]) - BEGIN_MS) / DAY_MS);
				const nextEnd = BEGIN_MS + Math.floor(salt(uid, `end|${product}`) * termDays) * DAY_MS + 5 * HOUR_MS;
				const termStart = addMonths(nextEnd, -TERM_MONTHS[product]);
				const premium = monthlyPremium(uid, product, state, tier, termStart, false);
				policies.push(newPolicy(uid, product, tier, premium, termStart, profile.autopay, false, nextEnd));
			}
		}
	}

	// ── policy lifecycle: payments, renewals, cancellations, claims ──
	const bundled = policies.length > 1;
	for (const pol of policies) {
		for (const x of simulatePolicy(pol, { uid, bundled, gulf, region, autopay: profile.autopay })) {
			const ev = make(x.name, x.t, x.props, x.mode);
			if (ev) out.push(ev);
		}
	}

	// ── app activity: only while the customer has coverage (born prospects: a short look) ──
	const coverage = policies.map((p) => [p.activeFrom, Math.min(END_MS, p.cancelT + 7 * DAY_MS)]);
	const autoCover = policies.filter((p) => p.product === "auto").map((p) => [p.activeFrom, p.cancelT]);
	const covered = (t, list) => list.some(([a, b]) => t >= a && t < b);
	const activeLines = (t) => policies.filter((p) => t >= p.activeFrom && t < p.cancelT).map((p) => p.product);
	for (const e of events) {
		if (!APP_EVENTS.has(e.event)) continue;
		if (APP_KEEP[e.event] !== undefined && hashFloat(`${e.insert_id}|keep`) >= APP_KEEP[e.event]) continue;
		const t = T(e);
		if (born && !policies.length) {
			if (shopperEnd === null || e.event !== "app opened" || t < T(out.find((x) => x.event === "account created")) || t > shopperEnd) continue;
		} else {
			if (!covered(t, coverage)) continue;
			if (AUTO_ONLY.has(e.event) && !covered(t, autoCover)) continue;
			const lines = activeLines(t);
			if ((e.event === "policy viewed" || e.event === "coverage changed") && lines.length) {
				e.product_line = lines[Math.floor(hashFloat(`${e.insert_id}|line`) * lines.length)];
				if (e.event === "coverage changed" && e.product_line !== "auto" && ["add_vehicle", "remove_vehicle", "add_driver"].includes(e.change_type)) e.change_type = "update_address";
			}
		}
		e.user_id = uid;
		if (!e.device_id) Object.assign(e, devFields);
		e.platform = platformOf(e.os);
		out.push(e);
	}

	// profile at the end of the window
	if (policies.length) {
		const active = policies.filter((p) => p.cancelT > END_MS);
		profile.customer_status = active.length ? "active" : "cancelled";
		profile.product_lines = (active.length ? active : policies).map((p) => p.product).join("+");
		profile.bundle = active.length > 1;
	}
	for (const e of out) e.state = state;
	// a customer with no activity in the window (policies cancelled before June 4,
	// or nothing due and no app use) has no events, so no Mixpanel profile either
	if (!out.length) profile._drop = true;
	return out;
}

function newPolicy(uid, product, tier, premium, start, autopay, isNew, anchor = start) {
	return {
		uid, product, tier, premium, start, autopay, isNew, anchor,
		id: `SSI-${product === "auto" ? "AU" : product === "home" ? "HO" : "RE"}-${idDigits(`${uid}|${product}|${start}`)}`,
		plan: hashFloat(`${uid}|plan|${product}`) < MONTHLY_PLAN_SHARE ? "monthly" : "paid_in_full",
		method: autopay ? (hashFloat(`${uid}|method`) < 0.5 ? "autopay_card" : "autopay_bank") : (hashFloat(`${uid}|method`) < 0.8 ? "card" : "bank_transfer"),
		activeFrom: Math.max(BEGIN_MS, start),
		cancelT: Infinity,
	};
}

function purchaseProps(pol, channel, reason) {
	return {
		policy_id: pol.id, product_line: pol.product, coverage_tier: pol.tier, premium_monthly: pol.premium,
		term_months: TERM_MONTHS[pol.product], payment_plan: pol.plan, autopay: pol.autopay,
		transaction_type: "new_business", term_premium_usd: round2(pol.premium * TERM_MONTHS[pol.product]),
		acquisition_channel: channel, shopping_reason: reason,
	};
}

/**
 * One policy's in-window history. Returns event specs { name, t, props, mode }
 * and sets pol.cancelT.
 */
function simulatePolicy(pol, ctx) {
	const { uid, bundled, gulf, region, autopay } = ctx;
	const specs = [];
	const base = { policy_id: pol.id, product_line: pol.product };
	const term = TERM_MONTHS[pol.product];
	let premium = pol.premium;
	const premiumAt = [[pol.start, premium]];
	const premiumFor = (t) => { let p = premiumAt[0][1]; for (const [a, v] of premiumAt) if (t >= a) p = v; return p; };
	let cancelT = Infinity;
	let cancelReason = null;
	const setCancel = (t, reason) => { if (t < cancelT) { cancelT = t; cancelReason = reason; } };

	// mid-term cancellation (sold the car, moved, ...)
	if (bool(MIDTERM_CANCEL * (END_MS - pol.activeFrom) / (WINDOW_DAYS * DAY_MS))) {
		setCancel(customerTime(pol.activeFrom + DAY_MS, END_MS), draw(MIDTERM_REASONS));
	}

	// renewals: every term end in the window
	const renewals = [];
	for (let k = pol.isNew ? 1 : 0; k < 10; k++) {
		const end = addMonths(pol.anchor, term * k);
		if (end <= BEGIN_MS) continue;
		if (end > END_MS + RENEWAL_NOTICE_DAYS * DAY_MS) break;
		const offerT = dayStart(end - RENEWAL_NOTICE_DAYS * DAY_MS) + chance.integer({ min: 9 * 60, max: 12 * 60 }) * MIN_MS;
		const chg = round1(Math.min(30, Math.max(-12, chance.normal({ mean: 6, dev: 7 }))));
		// stratum: bundled vs single line x month of the renewal notice. Each notice fires
		// with its own price-curve probability; the price buckets the H7 read uses are not strata.
		const leaves = quota(`renew|${bundled}|${dayKey(offerT).slice(0, 7)}`, nonRenewProb(chg, bundled));
		let leaveT = leaves ? Math.min(end - DAY_MS, offerT + between(5, 27) * DAY_MS) : null;
		if (leaveT !== null) leaveT = customerTime(dayStart(leaveT), dayStart(leaveT) + DAY_MS);
		// a non-renewal decided before the window looks like a policy that never was; keep those renewing
		renewals.push({ end, offerT, chg, leaveT: leaveT !== null && leaveT >= BEGIN_MS ? leaveT : null });
	}

	// payments (monthly installments, or the full term at each term start)
	const dues = [];
	if (pol.plan === "monthly") {
		for (let j = pol.isNew ? 0 : 1 - term; j < 40; j++) {
			const d = addMonths(pol.anchor, j);
			if (d > END_MS) break;
			if (d >= BEGIN_MS - 31 * DAY_MS) dues.push(d);
		}
	} else {
		if (pol.isNew) dues.push(pol.start);
	}
	for (const r of renewals) if (pol.plan === "paid_in_full") dues.push(r.end);
	dues.sort((a, b) => a - b);

	// walk time: renewals and payments interleave; the earliest cancellation wins
	const items = [
		...renewals.map((r) => ({ kind: "renewal", t: r.offerT, r })),
		...dues.map((d) => ({ kind: "due", t: d })),
	].sort((a, b) => a.t - b.t);
	for (const it of items) {
		if (it.t >= cancelT) break;
		if (it.kind === "renewal") {
			const r = it.r;
			const newPremium = round2(premiumFor(r.end) * (1 + r.chg / 100));
			if (r.offerT >= BEGIN_MS && r.offerT <= END_MS) {
				specs.push({ name: "renewal offered", t: r.offerT, mode: "server", props: { ...base, current_premium_monthly: premiumFor(r.offerT),
					renewal_premium_monthly: newPremium, premium_change_pct: r.chg, is_bundled: bundled, term_months: term } });
			}
			if (r.leaveT !== null) { setCancel(r.leaveT, draw(NONRENEW_REASONS)); break; }
			premiumAt.push([r.end, newPremium]);
			r.renewed = true;
			continue;
		}
		// a scheduled payment
		const due = it.t;
		const isNewDown = pol.isNew && due === pol.start;
		const amount = pol.plan === "monthly" ? premiumFor(due) : round2(premiumFor(due) * term);
		const auto = pol.autopay;
		const payT = isNewDown ? pol.start + chance.integer({ min: 5, max: 90 }) * 1000
			: auto ? dayStart(due) + chance.integer({ min: 7 * 60, max: 11 * 60 }) * MIN_MS
				: customerTime(dayStart(due) - 4 * DAY_MS, dayStart(due) + 3 * DAY_MS);
		const fails = !isNewDown && bool(auto ? FAIL_AUTOPAY : FAIL_MANUAL);
		const pay = { ...base, amount_usd: amount, payment_method: pol.method, is_retry: false };
		if (!fails) {
			if (payT >= BEGIN_MS) specs.push({ name: "payment made", t: payT, mode: auto || isNewDown ? "server" : "user", props: pay });
			continue;
		}
		if (payT >= BEGIN_MS) specs.push({ name: "payment failed", t: payT, mode: auto ? "server" : "user",
			props: { ...pay, failure_reason: draw(auto ? { card_expired: 45, insufficient_funds: 35, bank_returned: 20 } : { card_declined: 45, insufficient_funds: 40, card_expired: 15 }) } });
		if (auto) {
			// the draw is retried automatically; a few retries fail too and the policy lapses
			const rt = payT + AUTOPAY_RETRY_DAYS * DAY_MS;
			if (quota("autopay-retry", AUTOPAY_RETRY_FAIL)) {
				if (rt >= BEGIN_MS) specs.push({ name: "payment failed", t: rt, mode: "server", props: { ...pay, is_retry: true, failure_reason: "insufficient_funds" } });
				const ct = dayStart(rt + between(10, 20) * DAY_MS) + chance.integer({ min: 5 * 60, max: 7 * 60 }) * MIN_MS;
				setCancel(ct >= BEGIN_MS ? ct : BEGIN_MS - 1, "nonpayment");
			} else if (rt >= BEGIN_MS) specs.push({ name: "payment made", t: rt, mode: "server", props: { ...pay, is_retry: true } });
		} else if (bool(LAPSE_AFTER_MANUAL_FAIL)) {
			const ct = dayStart(payT + between(10, 25) * DAY_MS) + chance.integer({ min: 5 * 60, max: 7 * 60 }) * MIN_MS;
			if (ct >= BEGIN_MS) setCancel(ct, "nonpayment");
			else setCancel(BEGIN_MS - 1, "nonpayment");
		} else {
			const rt = customerTime(payT + DAY_MS, payT + 6 * DAY_MS);
			if (rt >= BEGIN_MS) specs.push({ name: "payment made", t: rt, mode: "user", props: { ...pay, is_retry: true } });
		}
	}
	for (const r of renewals) {
		if (r.renewed && r.end >= BEGIN_MS && r.end <= END_MS && r.end < cancelT) {
			specs.push({ name: "policy renewed", t: dayStart(r.end) + chance.integer({ min: 240, max: 360 }) * MIN_MS, mode: "server",
				props: { ...base, premium_monthly: premiumFor(r.end), term_months: term, transaction_type: "renewal",
					term_premium_usd: round2(premiumFor(r.end) * term), is_bundled: bundled } });
		}
	}
	if (cancelT < BEGIN_MS) { pol.cancelT = cancelT; pol.activeFrom = Infinity; return []; }
	if (cancelT <= END_MS) {
		specs.push({ name: "policy cancelled", t: cancelT, mode: "server", props: { ...base, cancel_reason: cancelReason, is_bundled: bundled } });
	}
	pol.cancelT = cancelT;

	// claims: reported while covered (plus a warm start of claims reported before June 4)
	const claims = [];
	const from = pol.isNew ? pol.activeFrom : BEGIN_MS - PREWINDOW_CLAIM_DAYS * DAY_MS;
	const to = Math.min(END_MS, cancelT);
	if (to > from) {
		const x = CLAIM_RATE[pol.product] * (to - from) / (WINDOW_DAYS * DAY_MS);
		const n = Math.floor(x) + (bool(x % 1) ? 1 : 0);
		for (let i = 0; i < n; i++) claims.push({ t: customerTime(from, to), cat: false });
	}
	// H2: Hurricane Delphine — Gulf property customers report storm damage
	const landfall = ms(HURRICANE_LANDFALL);
	if (gulf && pol.product !== "auto" && pol.activeFrom <= landfall && cancelT > landfall && bool(HURRICANE_CLAIM_P[pol.product])) {
		const d = Math.min(13.5, -Math.log(1 - chance.floating({ min: 0, max: 0.999 })) * HURRICANE_REPORT_MEAN_DAYS);
		claims.push({ t: customerTime(landfall + d * DAY_MS, landfall + (d + 1) * DAY_MS), cat: true });
	}
	claims.forEach((c, i) => {
		const t0 = c.t;
		const claimId = `CLM-${idDigits(`${pol.id}|claim|${i}|${Math.round(t0)}`)}`;
		const peril = c.cat ? (pol.product === "home" ? draw({ wind_hail: 70, water: 30 }) : draw({ water: 55, wind_hail: 45 }))
			: draw(pol.product === "auto" ? AUTO_PERILS : pol.product === "home" ? HOME_PERILS : RENTERS_PERILS);
		const photo = pol.product === "auto" && t0 >= ms(SNAP_SETTLE_LAUNCH) && PHOTO_ELIGIBLE.includes(peril) && quota(`photo|${peril}`, PHOTO_ADOPT);
		const channel = photo ? "photo_estimate" : "adjuster_inspection";
		const tSubmit = t0 + chance.integer({ min: 6, max: 25 }) * MIN_MS;
		const inCat = gulf && pol.product !== "auto" && tSubmit >= landfall && tSubmit < ms(CAT_END);
		const days = pol.product === "auto"
			? AUTO_SETTLE_DAYS[peril] * Math.exp(chance.normal({ mean: 0, dev: AUTO_SETTLE_SIGMA })) * (photo ? PHOTO_SETTLE_MULT : 1)
			: PROPERTY_SETTLE_DAYS * Math.exp(chance.normal({ mean: 0, dev: PROPERTY_SETTLE_SIGMA })) * (inCat ? CAT_SETTLE_MULT : 1);
		// settlements post in the claims team's working hours (13:00-23:00 UTC): a
		// settlement that lands outside them moves to the nearest edge of a shift
		const tSettle = Math.max(tSubmit + HOUR_MS, toShift(tSubmit + days * DAY_MS));
		const denied = bool(DENIAL_SHARE);
		const loss = Math.round(AVG_LOSS[peril] * Math.exp(chance.normal({ mean: 0, dev: 0.55 })));
		const cb = { claim_id: claimId, product_line: pol.product };
		CLAIM_LEDGER.push({ region, submitDay: dayKey(tSubmit), settleDay: tSettle <= END_MS ? dayKey(tSettle) : null, submitMs: tSubmit, cat: inCat });
		if (t0 >= BEGIN_MS) {
			specs.push({ name: "claim started", t: t0, mode: "user", props: { ...cb, peril } });
			if (photo || bool(0.6)) {
				specs.push({ name: "claim photos uploaded", t: t0 + chance.integer({ min: 2, max: 5 }) * MIN_MS, mode: "user",
					props: { claim_id: claimId, photo_count: photo ? chance.integer({ min: 6, max: 12 }) : chance.integer({ min: 1, max: 5 }) } });
			}
			specs.push({ name: "claim submitted", t: tSubmit, mode: "user", props: { ...cb, peril, claim_channel: channel, region, estimated_loss_usd: loss } });
		}
		const checks = chance.integer({ min: 1, max: photo ? 2 : 4 });
		const statuses = photo ? ["under_review", "estimate_ready"] : ["under_review", "inspection_scheduled", "estimate_ready", "estimate_ready"];
		for (let k = 0; k < checks; k++) {
			const tc = customerTime(tSubmit + (tSettle - tSubmit) * (k + 0.2) / (checks + 0.5), tSubmit + (tSettle - tSubmit) * (k + 0.9) / (checks + 0.5));
			if (tc >= BEGIN_MS && tc <= END_MS) specs.push({ name: "claim status checked", t: tc, mode: "user", props: { claim_id: claimId, claim_status: statuses[Math.min(k, statuses.length - 1)] } });
		}
		if (tSettle >= BEGIN_MS && tSettle <= END_MS) {
			specs.push({ name: "claim settled", t: tSettle, mode: "server", props: { ...cb, peril, claim_channel: channel, region,
				settlement_type: denied ? "denied" : "paid", payout_usd: denied ? 0 : Math.round(loss * between(0.7, 1.0)),
				days_open: round1((tSettle - tSubmit) / DAY_MS) } });
		}
	});
	return specs;
}

// warm start for purchases: existing customers who quoted in late May (before
// the window) and bought in early June. Share chosen so early-June purchases
// match the steady-state rate from in-window quotes.
const WARM_SHARE = (() => {
	const born = NUM_USERS * BORN_PCT / 100;
	const perDay = born * QUOTE_COMPLETE_BASE * 1.1 * BIND_BASE * 0.9 / WINDOW_DAYS;
	return perDay * 30 / (NUM_USERS - born);
})();

// ── WAREHOUSE HOOK ──
const DAILY_QUOTES = (() => {
	const born = NUM_USERS * BORN_PCT / 100;
	const total = Object.values(CHANNEL_WEIGHTS).reduce((a, b) => a + b, 0);
	return Object.fromEntries(PAID_CHANNELS.map((ch) => [ch, born * CHANNEL_WEIGHTS[ch] / total / WINDOW_DAYS]));
})();
const SPEND_WEEKDAY = (() => {
	const m = DOW_WEIGHTS.reduce((a, b) => a + b, 0) / DOW_WEIGHTS.length;
	return DOW_WEIGHTS.map((w) => 0.4 + 0.6 * w / m);
})();
const CPC_USD = { search_ads: 28, comparison_site: 9, social_ads: 3.2 };
const CTR = { search_ads: 0.045, comparison_site: 0.02, social_ads: 0.009 };
const PLATFORM_CLAIM_INFLATION = { search_ads: 1.12, comparison_site: 1.06, social_ads: 1.3 };
const ADJUSTER_HOURS_BASE = { gulf_coast: 16, south: 26, midwest: 16, west: 12, northeast: 8 }; // staff adjuster hours per weekday
const CAT_ADJUSTER_HOURS = 80; // ten independent catastrophe adjusters, 8 h a day
const PHONE_CLAIM_SHARE = 0.22; // claims reported by phone to in-house service reps, never in the app
const PHONE_PER_APP = PHONE_CLAIM_SHARE / (1 - PHONE_CLAIM_SHARE); // phone claims per app claim, ordinary days
const CAT_PHONE_RATIO = 0.6;    // storm claims phoned in, per storm claim filed in the app
const CAT_PHONE_DECAY_DAYS = 3; // calls arrive over the days after landfall...
const CAT_PHONE_CAPACITY = 9;   // ...but the service reps can log only about this many storm claims a day; the rest wait in the queue
const DOW_MEAN = DOW_WEIGHTS.reduce((a, b) => a + b, 0) / DOW_WEIGHTS.length;
/** expected phone-reported claims per day for a region (ordinary days), from this run's app claims */
let PHONE_BASE = null;
function phoneBaseline(region) {
	if (!PHONE_BASE || PHONE_BASE.run !== RUN_CONFIG) {
		const n = Object.fromEntries(REGIONS.map((x) => [x, 0]));
		for (const c of CLAIM_LEDGER) if (!c.cat && c.submitMs >= BEGIN_MS && c.submitMs <= END_MS) n[c.region]++;
		const catApp = CLAIM_LEDGER.filter((c) => c.cat).length;
		const catDays = (ms(CAT_END) - ms(HURRICANE_LANDFALL)) / DAY_MS;
		const w = Array.from({ length: catDays }, (_, d) => Math.exp(-d / CAT_PHONE_DECAY_DAYS));
		const wSum = w.reduce((a, b) => a + b, 0);
		PHONE_BASE = { run: RUN_CONFIG, perDay: Object.fromEntries(REGIONS.map((x) => [x, n[x] / WINDOW_DAYS * PHONE_PER_APP])),
			catPerDay: (() => {
				// callers queue: each day the reps log up to capacity, the rest call back later
				let queue = 0;
				return w.map((x) => {
					queue += catApp * CAT_PHONE_RATIO * x / wSum;
					const logged = Math.min(CAT_PHONE_CAPACITY, queue);
					queue -= logged;
					return logged;
				});
			})() };
	}
	return PHONE_BASE.perDay[region];
}
/** expected phoned-in storm claims on a catastrophe day (gulf_coast only) */
function catPhoneExpected(region, dayMs) {
	if (catCode(region, dayMs) === "none") return 0;
	phoneBaseline(region);
	return PHONE_BASE.catPerDay[Math.floor((dayMs - ms(HURRICANE_LANDFALL)) / DAY_MS)] || 0;
}
/** seeded Poisson draw (inverse CDF on a salted hash) */
function seededPoisson(lambda, key) {
	const u = hashFloat(key);
	let p = Math.exp(-lambda), F = p, k = 0;
	while (u > F && k < 100) { k++; p *= lambda / k; F += p; }
	return k;
}

function handleWarehouse(row, meta) {
	if (meta.isBackfill) return row;
	if (meta.metricName === "marketing_spend_daily") {
		const ch = row.acquisition_channel;
		const k = `${row.date}|${ch}`;
		const quotes = row.spend_usd; // source: Mixpanel quote starts that day
		const dow = new Date(`${row.date}T00:00:00Z`).getUTCDay();
		const campaign = ch === "social_ads" && ms(`${row.date}T00:00:00Z`) >= ms(SOCIAL_CAMPAIGN_START);
		let spend;
		if (ch === "comparison_site") {
			// billed per lead: leads the site sent (some never load our quote page)
			const leads = Math.round(quotes * 1.08 * jitter(`leads|${k}`, 0.05));
			row.conversions_reported = leads;
			spend = leads * COST_PER_QUOTE[ch] / 1.08 * jitter(`cpl|${k}`, 0.04);
			// click-throughs from the comparison listing: every lead, plus shoppers who
			// clicked through and left before the site counted a lead
			row.clicks = Math.round(leads * (1 + 0.3 * hashFloat(`clk|${k}`)));
		} else {
			const planQuotes = DAILY_QUOTES[ch] * (ch === "social_ads" ? (campaign ? 1 : 1 / SOCIAL_LIFT) : 1);
			const plan = COST_PER_QUOTE[ch] * planQuotes * SPEND_WEEKDAY[dow] * (campaign ? SOCIAL_BUDGET_MULT / SOCIAL_LIFT : 1);
			spend = (0.5 * plan + 0.5 * COST_PER_QUOTE[ch] * quotes) * jitter(`spend|${k}`, 0.12);
			row.conversions_reported = Math.round(quotes * PLATFORM_CLAIM_INFLATION[ch] * jitter(`conv|${k}`, 0.2));
			row.clicks = Math.round(spend / (CPC_USD[ch] * jitter(`cpc|${k}`, 0.15)));
		}
		row.spend_usd = round2(spend);
		row.impressions = Math.round(row.clicks / (CTR[ch] * jitter(`ctr|${k}`, 0.15)));
		return row;
	}
	if (meta.metricName === "claims_operations_daily") {
		const r = row.region;
		const k = `${row.date}|${r}`;
		// phone-reported claims: an independent daily count around the region's usual
		// level (weekday rhythm), plus storm victims who call in during a catastrophe
		// (no power, no data) at a share that swings day to day
		const dayMs = ms(`${row.date}T00:00:00Z`);
		const dow = new Date(dayMs).getUTCDay();
		const appNow = row.new_claims_reported;
		const lambda = phoneBaseline(r) * DOW_WEIGHTS[dow] / DOW_MEAN;
		const catPhone = seededPoisson(catPhoneExpected(r, dayMs), `catph|${k}`);
		row.new_claims_reported = appNow + seededPoisson(lambda, `phone|${k}`) + catPhone;
		let closed = 0, open = 0;
		for (const c of CLAIM_LEDGER) {
			if (c.region !== r) continue;
			if (c.settleDay === row.date) closed++;
			if (c.submitDay <= row.date && (c.settleDay === null || c.settleDay > row.date)) open++;
		}
		row.claims_closed = Math.round(closed * (1 + PHONE_PER_APP * jitter(`phclose|${k}`, 0.6)));
		row.open_claims = Math.round(open * (1 + PHONE_PER_APP));
		return row;
	}
	if (meta.metricName === "written_premium_daily") {
		const k = `${row.date}|${row.product_line}|${row.transaction_type}`;
		const n = meta.raw?.plus?.count ?? 0;
		// policies sold or renewed by the in-house phone sales team are in billing, not Mixpanel; flat
		// cancellations (cancelled on day one) are netted out; renewals pick up
		// mid-term endorsement adjustments in billing
		const nb = row.transaction_type === "new_business";
		let extra = (hashFloat(`agent|${k}`) < (nb ? 0.35 : 0.2) ? 1 : 0) + (hashFloat(`agent2|${k}`) < (nb ? 0.1 : 0.05) ? 1 : 0);
		if (n > 0 && hashFloat(`flat|${k}`) < 0.08) extra -= 1;
		const avg = n > 0 ? row.written_premium_usd / n : TERM_MONTHS[row.product_line] * BASE_PREMIUM[row.product_line];
		row.policies_written = n + extra;
		row.written_premium_usd = round2(Math.max(0, (row.written_premium_usd + extra * avg) * (nb ? 1 : jitter(`endorse|${k}`, 0.06))));
		return row;
	}
	return row;
}

const catCode = (region, t) => (region === "gulf_coast" && t >= ms(HURRICANE_LANDFALL) && t < ms(CAT_END) ? "PCS-2614" : "none");

// ── CONFIG ──
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
		hasSessionIds: false,
		alsoInferFunnels: false,
		hasLocation: false,
		hasAndroidDevices: true,
		hasIOSDevices: true,
		hasDesktopDevices: true,
		hasBrowser: false,
		hasCampaigns: false,
		isAnonymous: false,
		hasAdSpend: false,
		hasAvatar: true,
	},
	identity: { avgDevicePerUser: 1.5 },
	stickyEventProps: ["state"],

	events: [
		// ── shopping (new customers) ──
		{
			event: "quote started",
			weight: 1,
			isStrictEvent: true,
			properties: {
				product_line: ["auto"],
				acquisition_channel: (ctx) => ctx.profile.acquisition_channel,
				quote_flow: ["standard"],
			},
		},
		{
			event: "quote completed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				product_line: ["auto"],
				acquisition_channel: ["organic"],
				quote_flow: ["standard"],
				coverage_tier: ["standard"],
				quoted_premium_monthly: [100],
				shopping_reason: ["switching"],
			},
		},
		{
			event: "account created",
			weight: 1,
			isStrictEvent: true,
			isAuthEvent: true,
			properties: {
				signup_method: { __weights: { email: 55, google: 25, apple: 20 } },
				acquisition_channel: ["organic"],
				product_line: ["auto"],
			},
		},
		{
			event: "policy purchased",
			weight: 1,
			isStrictEvent: true,
			properties: {
				policy_id: ["unassigned"],
				product_line: ["auto"],
				coverage_tier: ["standard"],
				premium_monthly: [100],
				term_months: [6],
				payment_plan: ["monthly"],
				autopay: [false],
				transaction_type: ["new_business"],
				term_premium_usd: [600],
				acquisition_channel: ["organic"],
				shopping_reason: ["switching"],
			},
		},
		{
			event: "$experiment_started",
			weight: 1,
			isStrictEvent: true,
			properties: {
				"Experiment name": [EXPRESS_EXPERIMENT],
				"Variant name": ["Control", EXPRESS_VARIANT],
			},
		},
		// ── app activity (customers) ──
		{
			event: "app opened",
			weight: 1,
			isStrictEvent: true,
			properties: {
				open_source: { __weights: { organic: 60, push_notification: 25, email_link: 15 } },
			},
		},
		{
			event: "policy viewed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				product_line: ["auto"],
				section: { __weights: { overview: 45, coverages: 30, drivers_vehicles_property: 15, discounts: 10 } },
			},
		},
		{
			event: "billing viewed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				billing_section: { __weights: { next_payment: 50, payment_history: 30, payment_methods: 20 } },
			},
		},
		{
			event: "id card viewed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				card_format: { __weights: { in_app: 55, wallet_pass: 30, pdf: 15 } },
			},
		},
		{
			event: "documents viewed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				document_type: { __weights: { declarations_page: 45, policy_contract: 20, billing_statement: 25, claim_letter: 10 } },
			},
		},
		{
			event: "coverage changed",
			weight: 2,
			properties: {
				product_line: ["auto"],
				change_type: { __weights: { change_deductible: 25, add_vehicle: 15, remove_vehicle: 8, add_driver: 12, add_endorsement: 15, update_address: 25 } },
			},
		},
		{
			event: "support chat started",
			weight: 3,
			properties: {
				topic: { __weights: { billing: 35, policy_change: 25, coverage_question: 20, claims: 12, technical: 8 } },
			},
		},
		{
			event: "roadside assistance requested",
			weight: 1,
			properties: {
				service_type: { __weights: { tow: 35, jump_start: 25, flat_tire: 20, lockout: 12, fuel_delivery: 8 } },
			},
		},
		// ── policy lifecycle (built by the hook) ──
		{
			event: "payment made",
			weight: 1,
			properties: {
				policy_id: ["unassigned"],
				product_line: ["auto"],
				amount_usd: [100],
				payment_method: ["card"],
				is_retry: [false],
			},
		},
		{
			event: "payment failed",
			weight: 1,
			properties: {
				policy_id: ["unassigned"],
				product_line: ["auto"],
				amount_usd: [100],
				payment_method: ["card"],
				is_retry: [false],
				failure_reason: ["card_declined"],
			},
		},
		{
			event: "renewal offered",
			weight: 1,
			properties: {
				policy_id: ["unassigned"],
				product_line: ["auto"],
				current_premium_monthly: [100],
				renewal_premium_monthly: [100],
				premium_change_pct: [0],
				is_bundled: [false],
				term_months: [6],
			},
		},
		{
			event: "policy renewed",
			weight: 1,
			properties: {
				policy_id: ["unassigned"],
				product_line: ["auto"],
				premium_monthly: [100],
				term_months: [6],
				transaction_type: ["renewal"],
				term_premium_usd: [600],
				is_bundled: [false],
			},
		},
		{
			event: "policy cancelled",
			weight: 1,
			properties: {
				policy_id: ["unassigned"],
				product_line: ["auto"],
				cancel_reason: ["moved"],
				is_bundled: [false],
			},
		},
		{
			event: "claim started",
			weight: 1,
			properties: {
				claim_id: ["unassigned"],
				product_line: ["auto"],
				peril: ["collision"],
			},
		},
		{
			event: "claim photos uploaded",
			weight: 1,
			properties: {
				claim_id: ["unassigned"],
				photo_count: [1],
			},
		},
		{
			event: "claim submitted",
			weight: 1,
			properties: {
				claim_id: ["unassigned"],
				product_line: ["auto"],
				peril: ["collision"],
				claim_channel: ["adjuster_inspection"],
				region: ["south"],
				estimated_loss_usd: [1000],
			},
		},
		{
			event: "claim status checked",
			weight: 1,
			properties: {
				claim_id: ["unassigned"],
				claim_status: ["under_review"],
			},
		},
		{
			event: "claim settled",
			weight: 1,
			properties: {
				claim_id: ["unassigned"],
				product_line: ["auto"],
				peril: ["collision"],
				claim_channel: ["adjuster_inspection"],
				region: ["south"],
				settlement_type: ["paid"],
				payout_usd: [0],
				days_open: [1],
			},
		},
	],

	funnels: [
		{
			name: "Quote",
			sequence: ["quote started", "quote completed", "account created", "policy purchased"],
			isFirstFunnel: true,
			conversionRate: 100,
			timeToConvert: 1,
			order: "sequential",
			weight: 1,
			experiment: {
				name: EXPRESS_EXPERIMENT,
				startDaysBeforeEnd: (END_MS - ms(EXPRESS_QUOTE_START)) / DAY_MS,
				variants: [{ name: "Control" }, { name: EXPRESS_VARIANT }],
			},
		},
		{
			// a visit to the account: open the app, look at the policy, bills, ID card, documents
			name: "Account visit",
			sequence: ["app opened", "policy viewed", "billing viewed", "id card viewed", "documents viewed"],
			conversionRate: 55,
			timeToConvert: 0.3,
			order: "first-fixed",
			weight: 12,
		},
	],

	warehouseMetrics: [
		{
			name: "marketing_spend_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "quote started",
				measure: "count",
				where: (e) => PAID_CHANNELS.includes(e.acquisition_channel),
				groupBy: "acquisition_channel",
			},
			timeColumn: "date",
			valueColumn: "spend_usd",
			columns: {
				// set by the warehouse hook from the day's spend
				clicks: 0,
				impressions: 0,
				conversions_reported: 0,
			},
		},
		{
			name: "claims_operations_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "claim submitted",
				measure: "count",
				groupBy: "region",
			},
			timeColumn: "date",
			valueColumn: "new_claims_reported",
			columns: {
				claims_closed: 0,
				open_claims: 0,
				adjuster_hours: (ctx) => {
					const r = ctx.row.region;
					const dow = new Date(ctx.time).getUTCDay();
					const base = ADJUSTER_HOURS_BASE[r] * (dow === 0 || dow === 6 ? 0.25 : 1);
					// independent catastrophe adjusters deployed to the Gulf from two days after landfall, for five weeks
					const catDays = (ctx.time - ms(HURRICANE_LANDFALL)) / DAY_MS;
					const cat = r === "gulf_coast" && catDays >= 2 && catDays < 37 ? CAT_ADJUSTER_HOURS * Math.min(1, (catDays - 1) / 4) : 0;
					return round1(Math.max(2, base * jitter(`adj|${ctx.time}|${r}`, 0.15) + cat));
				},
				catastrophe_code: (ctx) => catCode(ctx.row.region, ctx.time),
			},
		},
		{
			name: "written_premium_daily",
			type: "additive",
			grain: "day",
			source: {
				event: ["policy purchased", "policy renewed"],
				measure: "sum",
				property: "term_premium_usd",
				groupBy: ["product_line", "transaction_type"],
			},
			timeColumn: "date",
			valueColumn: "written_premium_usd",
			columns: {
				policies_written: 0,
				rate_level_index: (ctx) => (ctx.row.product_line === "auto" && ctx.row.transaction_type === "new_business" && ctx.time >= ms(AUTO_RATE_CHANGE) ? AUTO_RATE_MULT : 1),
			},
		},
	],

	superProps: {
		platform: ["web"],
		state: ["TX"],
	},

	userProps: {
		state: Object.entries(STATES).flatMap(([k, v]) => Array(v.w).fill(k)),
		region: ["south"],
		age_band: { __weights: { "18-24": 10, "25-34": 27, "35-44": 25, "45-54": 18, "55-64": 13, "65+": 7 } },
		product_lines: ["auto"],
		bundle: [false],
		autopay: [false],
		customer_status: ["active"],
		customer_since: ["2024-01-01"],
		acquisition_channel: Object.entries(CHANNEL_WEIGHTS).flatMap(([k, v]) => Array(v).fill(k)),
		shopping_reason: ["switching"],
	},

	personas: [
		{ name: "app_regular", weight: 25, eventMultiplier: 1.8 },
		{ name: "typical", weight: 45, eventMultiplier: 1.0 },
		{ name: "set_and_forget", weight: 30, eventMultiplier: 0.45 },
	],

	retentionCurve: { type: "logarithmic", day1: 0.6, day7: 0.45, day30: 0.35 },

	hook(record, type, meta) {
		if (type === "user") return handleUserHook(record, meta);
		if (type === "everything") return handleEverything(record, meta);
		if (type === "warehouse") return handleWarehouse(record, meta);
		return record;
	},
};

// ── STORIES ──────────────────────────────────────────────────────────────
// Machine-checkable contract for hooks H1-H10. Evaluate with:
//   node dungeons/vertical/insurance-application/insurance-application.verify.mjs

const EV = `read_json_auto('{{PREFIX}}-EVENTS*.json*', sample_size=-1, union_by_name=true)`;
const WH = (table) => `read_json_auto('{{PREFIX}}-WAREHOUSE-${table}.json*', sample_size=-1, union_by_name=true)`;

// Identity prelude: a device resolves to the customer seen with it on any event
// that carries both ids (account created stitches the quote device). Anonymous
// shoppers who never create an account stay on their device id.
const ID_CTE = `dmap AS (SELECT device_id::VARCHAR AS device_id, min(user_id::VARCHAR) AS mapped FROM ${EV}
  WHERE user_id IS NOT NULL AND device_id IS NOT NULL GROUP BY 1),
ev AS (SELECT coalesce(e.user_id::VARCHAR, m.mapped, e.device_id::VARCHAR) AS uid, e.time::TIMESTAMP AS t, e.*
  FROM ${EV} e LEFT JOIN dmap m ON e.device_id::VARCHAR = m.device_id)`;

const TS = (isoStr) => dayjs.utc(isoStr).format("YYYY-MM-DD HH:mm:ss");
const D = (isoStr) => isoStr.slice(0, 10);
const band = (k) => [Math.round(k * 0.9 * 1000) / 1000, Math.round(k * 1.1 * 1000) / 1000];
const r3 = (x) => Math.round(x * 1000) / 1000;
// half-effect bound for a ratio knob: 1 - 0.5 x (1 - k) for a drop, 1 + 0.5 x (k - 1) for a lift
const half = (k) => r3(1 + 0.5 * (k - 1));
const SQL_LIST = (xs) => xs.map((x) => `'${x}'`).join(", ");
const BIND_WINDOW_DAYS = 14;          // Funnels conversion window quote completed → policy purchased
const QUOTE_READ_END = "2026-09-18 00:00:00"; // quotes through Sep 17 have their full 14-day window
const CLAIM_WINDOW_DAYS = 30;         // H1 read: claim submitted → claim settled
const H1_READ_END = "2026-09-16 00:00:00";
const CAT_WINDOW_DAYS = 45;           // H2 read: property claims (CAT claims settle in weeks)
const H2_BASE_END = "2026-09-16 00:00:00";
const RENEWAL_WINDOW_DAYS = 35;       // H6/H7 read: renewal offered → policy cancelled (term ends 30 days after the offer)
const RENEWAL_READ_END = "2026-09-01 00:00:00";
const LAPSE_WINDOW_DAYS = 30;         // H10 read: payment failed → policy cancelled (nonpayment)
const LAPSE_READ_END = "2026-09-01 00:00:00";
const RATE_AFTER_FROM = "2026-08-31 00:00:00"; // H5 warehouse read: two weeks after the change, when nearly all purchases come from new-rate quotes

const H1_SQL = `WITH ${ID_CTE},
s AS (SELECT claim_id, any_value(uid) AS uid, min(t) AS t0, any_value(claim_channel) AS ch FROM ev
  WHERE event = 'claim submitted' AND product_line = 'auto' AND peril IN (${SQL_LIST(PHOTO_ELIGIBLE)})
    AND t < TIMESTAMP '${H1_READ_END}' GROUP BY 1),
d AS (SELECT claim_id, min(t) AS t1 FROM ev WHERE event = 'claim settled' GROUP BY 1)
SELECT s.ch AS grp, count(DISTINCT s.uid) AS user_count, count(*) AS claims,
 median(date_diff('second', s.t0, d.t1) / 86400.0) FILTER (WHERE d.t1 < s.t0 + INTERVAL ${CLAIM_WINDOW_DAYS} DAY) AS med_days
FROM s LEFT JOIN d ON d.claim_id = s.claim_id GROUP BY 1
UNION ALL
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count, count(*) AS claims, avg((ch = 'photo_estimate')::INT) AS med_days
FROM s WHERE t0 >= TIMESTAMP '${TS(SNAP_SETTLE_LAUNCH)}'`;

const H2_SQL = `WITH ${ID_CTE},
cat AS (SELECT DISTINCT date::DATE AS d, region FROM ${WH("claims_operations_daily")} WHERE catastrophe_code <> 'none'),
s AS (SELECT claim_id, any_value(uid) AS uid, min(t) AS t0, any_value(region) AS region FROM ev
  WHERE event = 'claim submitted' AND product_line IN ('home', 'renters') GROUP BY 1),
d AS (SELECT claim_id, min(t) AS t1 FROM ev WHERE event = 'claim settled' GROUP BY 1),
x AS (SELECT s.*, d.t1, (cat.d IS NOT NULL) AS in_cat FROM s LEFT JOIN d ON d.claim_id = s.claim_id
  LEFT JOIN cat ON cat.d = s.t0::DATE AND cat.region = s.region)
SELECT CASE WHEN in_cat THEN 'cat' ELSE 'baseline' END AS grp, count(DISTINCT uid) AS user_count, count(*) AS claims,
 median(date_diff('second', t0, t1) / 86400.0) FILTER (WHERE t1 < t0 + INTERVAL ${CAT_WINDOW_DAYS} DAY) AS med_days
FROM x WHERE in_cat OR t0 < TIMESTAMP '${H2_BASE_END}' GROUP BY 1`;

const H3_SQL = `WITH ${ID_CTE},
s AS (SELECT uid, min(t) AS t0, any_value(quote_flow) AS flow FROM ev WHERE event = 'quote started' AND t >= TIMESTAMP '${TS(EXPRESS_QUOTE_START)}' GROUP BY 1),
c AS (SELECT uid, min(t) AS t1 FROM ev WHERE event = 'quote completed' GROUP BY 1)
SELECT s.flow AS grp, count(*) AS user_count,
 avg(coalesce(c.t1 >= s.t0 AND c.t1 < s.t0 + INTERVAL 1 DAY, false)::INT) AS completion,
 median(date_diff('second', s.t0, c.t1) / 60.0) FILTER (WHERE c.t1 >= s.t0 AND c.t1 < s.t0 + INTERVAL 1 DAY) AS med_minutes
FROM s LEFT JOIN c ON c.uid = s.uid GROUP BY 1`;

// one row per completed quote: did it turn into a purchase within the window?
const QUOTES_CTE = `qc AS (SELECT uid, min(t) AS tc, any_value(product_line) AS product_line, any_value(acquisition_channel) AS ch,
  any_value(shopping_reason) AS reason, any_value(quote_flow) AS flow, any_value(quoted_premium_monthly) AS premium FROM ev WHERE event = 'quote completed' GROUP BY 1),
pp AS (SELECT uid, min(t) AS tp FROM ev WHERE event = 'policy purchased' GROUP BY 1),
q AS (SELECT qc.*, pp.tp, coalesce(pp.tp >= qc.tc AND pp.tp < qc.tc + INTERVAL ${BIND_WINDOW_DAYS} DAY, false) AS bound FROM qc LEFT JOIN pp ON pp.uid = qc.uid)`;

const H4_SQL = `WITH ${ID_CTE}, ${QUOTES_CTE},
qs AS (SELECT acquisition_channel AS ch, count(*) AS quote_starts FROM ev WHERE event = 'quote started' GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM ${WH("marketing_spend_daily")} GROUP BY 1),
b AS (SELECT ch, count(*) AS completed, avg(bound::INT) AS bind_rate FROM q WHERE tc < TIMESTAMP '${QUOTE_READ_END}' GROUP BY 1)
SELECT qs.ch AS grp, qs.quote_starts AS user_count, b.completed, b.bind_rate, sp.spend, sp.spend / qs.quote_starts AS spend_per_quote
FROM qs LEFT JOIN b ON b.ch = qs.ch LEFT JOIN sp ON sp.ch = qs.ch
UNION ALL
SELECT 'other_channels' AS grp, count(*) AS user_count, count(*) AS completed, avg(bound::INT) AS bind_rate, NULL, NULL
FROM q WHERE tc < TIMESTAMP '${QUOTE_READ_END}' AND ch <> 'comparison_site'`;

const H5_SQL = `WITH ${ID_CTE}, ${QUOTES_CTE}
SELECT CASE WHEN product_line = 'auto' THEN 'auto' ELSE 'property' END || '_' || CASE WHEN tc >= TIMESTAMP '${TS(AUTO_RATE_CHANGE)}' THEN 'after' ELSE 'before' END AS grp,
 count(*) AS user_count, avg(premium) AS avg_premium,
 avg(bound::INT) FILTER (WHERE tc < TIMESTAMP '${QUOTE_READ_END}') AS bind_rate
FROM q GROUP BY 1`;

const H5_WH_SQL = `WITH ${ID_CTE},
w AS (SELECT CASE WHEN date::DATE < DATE '${D(AUTO_RATE_CHANGE)}' THEN 'before' WHEN date::DATE >= DATE '${RATE_AFTER_FROM.slice(0, 10)}' THEN 'after' END AS per,
  sum(written_premium_usd) AS premium, sum(policies_written) AS policies FROM ${WH("written_premium_daily")}
  WHERE product_line = 'auto' AND transaction_type = 'new_business' GROUP BY 1),
c AS (SELECT CASE WHEN t < TIMESTAMP '${TS(AUTO_RATE_CHANGE)}' THEN 'before' WHEN t >= TIMESTAMP '${RATE_AFTER_FROM}' THEN 'after' END AS per,
  count(*) AS completed, count(DISTINCT uid) AS users FROM ev WHERE event = 'quote completed' AND product_line = 'auto' GROUP BY 1)
SELECT w.per AS grp, c.users AS user_count, w.premium, w.policies, c.completed, w.premium / c.completed AS premium_per_quote
FROM w JOIN c ON c.per = w.per WHERE w.per IS NOT NULL`;

const RENEWAL_CTE = `o AS (SELECT policy_id, any_value(uid) AS uid, min(t) AS t0, any_value(premium_change_pct) AS chg, any_value(is_bundled) AS bundled
  FROM ev WHERE event = 'renewal offered' AND t < TIMESTAMP '${RENEWAL_READ_END}' GROUP BY 1),
r AS (SELECT o.*, coalesce(bool_or(c.cancel_reason IN (${SQL_LIST(Object.keys(NONRENEW_REASONS))}) AND c.t >= o.t0 AND c.t < o.t0 + INTERVAL ${RENEWAL_WINDOW_DAYS} DAY), false) AS left_at_renewal
  FROM o LEFT JOIN ev c ON c.event = 'policy cancelled' AND c.policy_id = o.policy_id GROUP BY ALL)`;

const H6_SQL = `WITH ${ID_CTE}, ${RENEWAL_CTE}
SELECT CASE WHEN bundled THEN 'bundled' ELSE 'single' END AS grp, count(DISTINCT uid) AS user_count, count(*) AS offers, avg(left_at_renewal::INT) AS nonrenewal
FROM r GROUP BY 1`;

// H7 middle bucket: expected non-renewal for offers with a 0-15% increase over offers
// with none, integrated over the renewal price-change draw (normal mean 6, sd 7,
// rounded to 0.1). Bundling multiplies every bucket alike, so it cancels.
const H7_MID_RATIO = (() => {
	let num = 0, den = 0;
	for (let i = 1; i < PRICE_SHOCK_PCT * 10; i++) {
		const c = i / 10;
		const w = Math.exp(-((c - 6) ** 2) / (2 * 7 ** 2));
		num += w * nonRenewProb(c, false);
		den += w;
	}
	return r3(num / den / NONRENEW_LOW);
})();

// single-line policies only, so the bundle effect (H6) is held constant across price buckets
const H7_SQL = `WITH ${ID_CTE}, ${RENEWAL_CTE}
SELECT CASE WHEN chg <= 0 THEN 'no_increase' WHEN chg >= ${PRICE_SHOCK_PCT} THEN 'shock' ELSE 'moderate' END AS grp,
 count(DISTINCT uid) AS user_count, count(*) AS offers, avg(left_at_renewal::INT) AS nonrenewal
FROM r WHERE NOT bundled GROUP BY 1`;

const H8_SQL = `WITH ${ID_CTE},
s AS (SELECT CASE WHEN acquisition_channel = 'social_ads' THEN 'social' ELSE 'other' END AS ch,
  CASE WHEN t >= TIMESTAMP '${TS(SOCIAL_CAMPAIGN_START)}' THEN 'campaign' ELSE 'before' END AS per, uid FROM ev WHERE event = 'quote started'),
sp AS (SELECT CASE WHEN date::DATE >= DATE '${D(SOCIAL_CAMPAIGN_START)}' THEN 'campaign' ELSE 'before' END AS per, avg(spend_usd) AS spend_per_day
  FROM ${WH("marketing_spend_daily")} WHERE acquisition_channel = 'social_ads' GROUP BY 1),
g AS (SELECT ch, per, count(*) / CASE WHEN per = 'campaign' THEN ${(END_MS + 1000 - ms(SOCIAL_CAMPAIGN_START)) / DAY_MS}.0 ELSE ${(ms(SOCIAL_CAMPAIGN_START) - BEGIN_MS) / DAY_MS}.0 END AS per_day, count(DISTINCT uid) AS users FROM s GROUP BY 1, 2)
SELECT ch || '_' || per AS grp, users AS user_count, per_day, (SELECT spend_per_day FROM sp WHERE sp.per = g.per) AS social_spend_per_day FROM g`;

const H9_SQL = `WITH ${ID_CTE}, ${QUOTES_CTE}
SELECT CASE WHEN reason = 'switching' THEN 'switching' ELSE 'other' END AS grp, count(*) AS user_count,
 median(date_diff('second', tc, tp) / 3600.0) AS med_hours
FROM q WHERE bound AND tc < TIMESTAMP '${QUOTE_READ_END}' GROUP BY 1`;

const H10_SQL = `WITH ${ID_CTE},
p AS (SELECT CASE WHEN payment_method LIKE 'autopay%' THEN 'autopay' ELSE 'manual' END AS grp, uid, event FROM ev
  WHERE (event = 'payment failed' OR event = 'payment made') AND NOT is_retry),
f AS (SELECT CASE WHEN payment_method LIKE 'autopay%' THEN 'autopay' ELSE 'manual' END AS grp, policy_id, t AS tf FROM ev
  WHERE event = 'payment failed' AND NOT is_retry AND t < TIMESTAMP '${LAPSE_READ_END}'),
l AS (SELECT f.grp, f.policy_id, f.tf, coalesce(bool_or(c.t > f.tf AND c.t < f.tf + INTERVAL ${LAPSE_WINDOW_DAYS} DAY), false) AS lapsed
  FROM f LEFT JOIN ev c ON c.event = 'policy cancelled' AND c.cancel_reason = 'nonpayment' AND c.policy_id = f.policy_id GROUP BY ALL),
lr AS (SELECT grp, avg(lapsed::INT) AS lapse_rate, count(*) AS failures FROM l GROUP BY 1)
SELECT p.grp, count(DISTINCT uid) AS user_count, count(*) AS scheduled,
 count(*) FILTER (WHERE event = 'payment failed')::DOUBLE / count(*) AS fail_rate,
 any_value(lr.lapse_rate) AS lapse_rate, any_value(lr.failures) AS failures
FROM p LEFT JOIN lr ON lr.grp = p.grp GROUP BY 1`;

/** @type {import("../../../types").DungeonStory[]} */
export const stories = [
	{
		id: "H1-snap-and-settle",
		hook: "H1",
		archetype: "funnel-ttc-by-segment",
		narrative: `Snap & Settle launches ${D(SNAP_SETTLE_LAUNCH)}: an auto customer with a ${PHOTO_ELIGIBLE.join(", ")} claim can upload photos and get an AI damage estimate instead of waiting for an adjuster inspection. About ${PHOTO_ADOPT * 100}% of eligible auto claims after launch go through it (claim_channel = photo_estimate); theft and liability claims, property claims, and every claim before launch use adjuster_inspection. A photo-estimate claim settles in ${PHOTO_SETTLE_MULT}x the time of an adjuster claim with the same peril mix (base medians: glass ${AUTO_SETTLE_DAYS.glass} d, comprehensive ${AUTO_SETTLE_DAYS.comprehensive} d, collision ${AUTO_SETTLE_DAYS.collision} d). Read: per claim (claim_id), median days claim submitted → claim settled within ${CLAIM_WINDOW_DAYS} days, eligible auto claims submitted ${D(DATASET_START)} to ${H1_READ_END.slice(0, 10)} (exclusive), photo_estimate over adjuster_inspection. Photo estimates exist only from launch; adjuster handling did not change, so every eligible adjuster claim in the window is the comparison group (adoption is stratified per peril, so the post-launch adjuster claims keep the same peril mix). With about 120 photo claims the ratio carries ~8% noise, so the read uses the knob as target with a ceiling.`,
		mixpanelReport: { type: "Funnels", steps: ["claim submitted", "claim settled"], counting: "totals", holdPropertyConstant: "claim_id", window: `${CLAIM_WINDOW_DAYS} days`, filter: "product_line = auto, peril in collision/glass/comprehensive", dateRange: `${D(DATASET_START)} to 2026-09-15`, breakdown: "claim_channel (step 1)", measure: "median time to convert" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H1_SQL },
				select: { p: { where: { grp: "photo_estimate" } }, a: { where: { grp: "adjuster_inspection" } } },
				expect: { metric: "p.med_days / a.med_days", op: "<=", target: PHOTO_SETTLE_MULT, floor: half(PHOTO_SETTLE_MULT) },
				minCohort: 60,
			},
			{
				breakdown: { type: "duckdb", sql: H1_SQL },
				select: { a: { where: { grp: "all" } } },
				// adoption among eligible auto claims after launch
				expect: { metric: "a.med_days", op: ">=", target: PHOTO_ADOPT, floor: 0.4 },
				minCohort: 100,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 count(*) FILTER (WHERE claim_channel = 'photo_estimate' AND (t < TIMESTAMP '${TS(SNAP_SETTLE_LAUNCH)}' OR product_line <> 'auto' OR peril NOT IN (${SQL_LIST(PHOTO_ELIGIBLE)}))) AS impure
FROM ev WHERE event = 'claim submitted'`,
				},
				select: { a: { where: { grp: "all" } } },
				// exact: no photo estimate before launch or outside eligible auto perils
				expect: { metric: "a.impure", op: "between", target: [0, 0] },
			},
		],
	},
	{
		id: "H2-hurricane-delphine",
		hook: "H2",
		archetype: "external-join",
		narrative: `Hurricane Delphine makes landfall ${D(HURRICANE_LANDFALL)} on the Gulf Coast (Shieldstone's gulf_coast region: ${GULF_STATES.join(", ")}). Home and renters customers there report storm damage (wind_hail, water) in the following days (home ${HURRICANE_CLAIM_P.home * 100}%, renters ${HURRICANE_CLAIM_P.renters * 100}% of policies in force; mean ${HURRICANE_REPORT_MEAN_DAYS} days after landfall). The property claims team is swamped: every Gulf property claim reported during the catastrophe window settles ${CAT_SETTLE_MULT}x slower than usual (base median ${PROPERTY_SETTLE_DAYS} days). The window is the warehouse claims_operations_daily rows with catastrophe_code <> 'none' (gulf_coast, ${D(HURRICANE_LANDFALL)} to ${dayjs.utc(CAT_END).subtract(1, "day").format("YYYY-MM-DD")}), which also show catastrophe adjusters arriving and the open-claims backlog. Read: median days claim submitted → claim settled (within ${CAT_WINDOW_DAYS} days) for home+renters claims submitted on catastrophe days in the affected region, over all other home+renters claims submitted through ${H2_BASE_END.slice(0, 10)} (exclusive). Auto claims are handled by a separate team and are not in this read.`,
		mixpanelReport: { type: "Funnels + warehouse", steps: ["claim submitted", "claim settled"], counting: "totals", holdPropertyConstant: "claim_id", window: `${CAT_WINDOW_DAYS} days`, filter: "product_line in home, renters", breakdown: "region and submit date inside the warehouse catastrophe window", measure: "median time to convert", join: "claims_operations_daily.catastrophe_code on date + region" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H2_SQL },
				select: { c: { where: { grp: "cat" } }, b: { where: { grp: "baseline" } } },
				expect: { metric: "c.med_days / b.med_days", op: ">=", target: CAT_SETTLE_MULT, floor: half(CAT_SETTLE_MULT) },
				minCohort: 80,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT 'all' AS grp, count(*) FILTER (WHERE catastrophe_code <> 'none') AS cat_rows,
 count(DISTINCT region) FILTER (WHERE catastrophe_code <> 'none') AS cat_regions
FROM ${WH("claims_operations_daily")}`,
				},
				select: { a: { where: { grp: "all" } } },
				// exact: 14 catastrophe days, one region
				expect: { metric: "a.cat_rows", op: "between", target: [(ms(CAT_END) - ms(HURRICANE_LANDFALL)) / DAY_MS, (ms(CAT_END) - ms(HURRICANE_LANDFALL)) / DAY_MS] },
			},
		],
	},
	{
		id: "H3-express-quote-experiment",
		hook: "H3",
		archetype: "experiment-lift",
		narrative: `The "${EXPRESS_EXPERIMENT}" test starts ${D(EXPRESS_QUOTE_START)}: every new shopper who starts a quote is split 50/50 (sticky; exposure $experiment_started one second before quote started; quote events carry quote_flow = express or standard). Express Quote pre-fills vehicle and property details from public records, so ${EXPRESS_CONV_MULT}x as many shoppers finish the quote (${QUOTE_COMPLETE_BASE * 100}% → ${Math.round(QUOTE_COMPLETE_BASE * EXPRESS_CONV_MULT * 100)}%) and they finish in ${EXPRESS_TIME_MULT}x the time (median ${QUOTE_MINUTES_MEDIAN} min in Control). Purchase rate per completed quote is not engineered by arm. Shoppers are anonymous until they create an account, so the read resolves each quote to its device (or to the customer the device later stitched to). Read: per shopper, quote completed within 1 day of quote started, shoppers who started ${D(EXPRESS_QUOTE_START)} or later.`,
		mixpanelReport: { type: "Funnels", steps: ["quote started", "quote completed"], counting: "uniques", window: "1 day", dateRange: `${D(EXPRESS_QUOTE_START)} to ${D(DATASET_END)}`, breakdown: "quote_flow (step 1), or Variant name via the Experiments report on $experiment_started", measure: "conversion and median time to convert" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H3_SQL },
				select: { v: { where: { grp: "express" } }, c: { where: { grp: "standard" } } },
				expect: { metric: "v.completion / c.completion", op: "between", target: band(EXPRESS_CONV_MULT) },
				minCohort: 800,
			},
			{
				breakdown: { type: "duckdb", sql: H3_SQL },
				select: { v: { where: { grp: "express" } }, c: { where: { grp: "standard" } } },
				expect: { metric: "v.med_minutes / c.med_minutes", op: "between", target: band(EXPRESS_TIME_MULT) },
				minCohort: 800,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 count(DISTINCT uid) FILTER (WHERE "Variant name" = '${EXPRESS_VARIANT}')::DOUBLE / count(DISTINCT uid) AS variant_share,
 (SELECT count(*) FROM ev WHERE event IN ('quote started', 'quote completed') AND quote_flow = 'express' AND t < TIMESTAMP '${TS(EXPRESS_QUOTE_START)}') AS early_express
FROM ev WHERE event = '$experiment_started'`,
				},
				select: { a: { where: { grp: "all" } } },
				// equal-weight 2-arm hash → 0.5
				expect: { metric: "a.variant_share", op: "between", target: band(0.5) },
				minCohort: 1500,
			},
		],
	},
	{
		id: "H4-comparison-site-economics",
		hook: "H4",
		archetype: "external-join",
		narrative: `Comparison sites are Shieldstone's cheapest paid source of quotes and its weakest at turning quotes into policies. Warehouse marketing_spend_daily: comparison sites bill per lead ($${COST_PER_QUOTE.comparison_site} per quote start delivered, invoiced on the site's own lead count), search ads $${COST_PER_QUOTE.search_ads} and social ads $${COST_PER_QUOTE.social_ads} per Mixpanel quote start over the window (half a paced daily budget, half bid x that day's quote starts, seeded day noise). Comparison-site shoppers buy at ${COMPARISON_BIND_MULT}x the rate of every other channel (${r3(BIND_BASE * COMPARISON_BIND_MULT * 100)}% vs ${BIND_BASE * 100}% of completed quotes before other effects), so the price advantage per quote (${COST_PER_QUOTE.comparison_site}/${COST_PER_QUOTE.search_ads} = ${r3(COST_PER_QUOTE.comparison_site / COST_PER_QUOTE.search_ads)}) disappears per policy. Reads: warehouse spend per Mixpanel quote start, comparison / search; and purchase within ${BIND_WINDOW_DAYS} days per completed quote, comparison / all other channels (quotes completed before ${QUOTE_READ_END.slice(0, 10)}). About 70 comparison-site purchases carry ~12% noise, so the conversion read uses the knob as target with a ceiling.`,
		mixpanelReport: { type: "Insights + Funnels + warehouse", event: "quote started", breakdown: "acquisition_channel", join: "marketing_spend_daily.spend_usd on date + acquisition_channel", funnel: `quote completed → policy purchased, ${BIND_WINDOW_DAYS}-day window, breakdown acquisition_channel` },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H4_SQL },
				select: { c: { where: { grp: "comparison_site" } }, s: { where: { grp: "search_ads" } } },
				expect: { metric: "c.spend_per_quote / s.spend_per_quote", op: "between", target: band(COST_PER_QUOTE.comparison_site / COST_PER_QUOTE.search_ads) },
				minCohort: 500,
			},
			{
				breakdown: { type: "duckdb", sql: H4_SQL },
				select: { c: { where: { grp: "comparison_site" } }, o: { where: { grp: "other_channels" } } },
				expect: { metric: "c.bind_rate / o.bind_rate", op: "<=", target: COMPARISON_BIND_MULT, floor: half(COMPARISON_BIND_MULT) },
				minCohort: 400,
			},
		],
	},
	{
		id: "H5-auto-rate-change",
		hook: "H5",
		archetype: "temporal-inflection",
		narrative: `On ${D(AUTO_RATE_CHANGE)} Shieldstone's new auto rate plan takes effect for new business: auto quotes price ${AUTO_RATE_MULT}x (quoted_premium_monthly; renewals keep current rates in the window, home and renters are unchanged). Auto shoppers push back: purchases per completed auto quote fall to ${AUTO_BIND_KEEP}x. Prices are on quote completed and policy purchased; the money is in warehouse written_premium_daily (product_line, transaction_type), which also carries rate_level_index = ${AUTO_RATE_MULT} for auto new business from the change. Written premium per completed auto quote therefore lands at ${AUTO_BIND_KEEP} x ${AUTO_RATE_MULT} = ${r3(AUTO_BIND_KEEP * AUTO_RATE_MULT)} of before: the higher price does not pay for the lost buyers. Reads: average quoted premium on auto quote completed, after / before; auto purchase within ${BIND_WINDOW_DAYS} days per completed quote, after / before (property quotes are the control); warehouse auto new-business written premium per completed auto quote, from ${RATE_AFTER_FROM.slice(0, 10)} (when nearly all purchases come from new-rate quotes) vs before the change. Purchase reads rest on ~75 auto purchases after the change, so they use the knob as target with a half-effect bound.`,
		mixpanelReport: { type: "Insights + Funnels + warehouse", events: ["quote completed (product_line = auto): average quoted_premium_monthly"], funnel: `quote completed → policy purchased, ${BIND_WINDOW_DAYS}-day window, breakdown product_line, before vs after ${D(AUTO_RATE_CHANGE)}`, join: "written_premium_daily (product_line = auto, transaction_type = new_business)" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H5_SQL },
				select: { a: { where: { grp: "auto_after" } }, b: { where: { grp: "auto_before" } } },
				expect: { metric: "a.avg_premium / b.avg_premium", op: "between", target: band(AUTO_RATE_MULT) },
				minCohort: 400,
			},
			{
				breakdown: { type: "duckdb", sql: H5_SQL },
				select: { a: { where: { grp: "auto_after" } }, b: { where: { grp: "auto_before" } } },
				expect: { metric: "a.bind_rate / b.bind_rate", op: "<=", target: AUTO_BIND_KEEP, floor: half(AUTO_BIND_KEEP) },
				minCohort: 400,
			},
			{
				breakdown: { type: "duckdb", sql: H5_SQL },
				select: { a: { where: { grp: "property_after" } }, b: { where: { grp: "property_before" } } },
				// control: property quotes have no price change (knob ±10%, the same band as the H8 control)
				expect: { metric: "a.bind_rate / b.bind_rate", op: "between", target: band(1) },
				minCohort: 300,
			},
			{
				breakdown: { type: "duckdb", sql: H5_WH_SQL },
				select: { a: { where: { grp: "after" } }, b: { where: { grp: "before" } } },
				expect: { metric: "a.premium_per_quote / b.premium_per_quote", op: "<=", target: r3(AUTO_BIND_KEEP * AUTO_RATE_MULT), floor: half(AUTO_BIND_KEEP * AUTO_RATE_MULT) },
				minCohort: 250,
			},
		],
	},
	{
		id: "H6-bundle-retention",
		hook: "H6",
		archetype: "retention-divergence",
		narrative: `Bundled customers (auto + home or auto + renters, is_bundled = true on the renewal notice) stay. At each renewal a customer leaves (cancels before the term ends, cancel_reason found_cheaper or price_increase) with a probability set by the renewal price change (H7) times ${BUNDLE_NONRENEW_MULT} when the policy is part of a bundle. Price changes are drawn the same way for bundled and single-line policies, so non-renewal per renewal offer, bundled over single-line, reads ${BUNDLE_NONRENEW_MULT}. Renewal offered goes out ${RENEWAL_NOTICE_DAYS} days before the term ends; read offers through ${RENEWAL_READ_END.slice(0, 10)} (exclusive) with a ${RENEWAL_WINDOW_DAYS}-day window, per policy. Non-renewals number in the low hundreds, so the read uses the knob as target with a ceiling.`,
		mixpanelReport: { type: "Funnels", steps: ["renewal offered", "policy cancelled (cancel_reason in found_cheaper, price_increase)"], counting: "totals", holdPropertyConstant: "policy_id", window: `${RENEWAL_WINDOW_DAYS} days`, dateRange: `${D(DATASET_START)} to 2026-08-31`, breakdown: "is_bundled (step 1)" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H6_SQL },
				select: { b: { where: { grp: "bundled" } }, s: { where: { grp: "single" } } },
				expect: { metric: "b.nonrenewal / s.nonrenewal", op: "<=", target: BUNDLE_NONRENEW_MULT, floor: half(BUNDLE_NONRENEW_MULT) },
				minCohort: 800,
			},
		],
	},
	{
		id: "H7-renewal-price-shock",
		hook: "H7",
		archetype: "cohort-prop-scale",
		narrative: `Renewal price drives renewal, dose by dose: the renewal notice carries premium_change_pct (mean +6%, sd 7, range -12 to +30). The chance a customer leaves at renewal is ${NONRENEW_LOW * 100}% when the premium does not rise and climbs linearly with the increase to ${NONRENEW_HIGH * 100}% at +${PRICE_SHOCK_PCT}% (times ${BUNDLE_NONRENEW_MULT} for bundled policies, H6). The model holds ${NONRENEW_HIGH * 100}% above +${PRICE_SHOCK_PCT}%, but fewer than 100 notices exceed +20%, so that cap is not a readable claim; the story is the rising curve. Reads, on single-line policies (is_bundled = false) so the bundle effect is held constant: non-renewal (cancel_reason found_cheaper or price_increase within ${RENEWAL_WINDOW_DAYS} days of the offer, offers through ${RENEWAL_READ_END.slice(0, 10)}) in three buckets of premium_change_pct: an increase of ${PRICE_SHOCK_PCT}% or more over no increase = ${NONRENEW_HIGH}/${NONRENEW_LOW} = ${r3(NONRENEW_HIGH / NONRENEW_LOW)}; an increase above 0 and below ${PRICE_SHOCK_PCT}% over no increase = ${H7_MID_RATIO} (the linear curve averaged over the price-change draw). Non-renewal draws are stratified by bundled x notice month only, not by these price buckets, so the buckets carry ordinary sampling noise; the no-increase group has about 23 non-renewals, so both reads use the knob as target with a half-effect floor.`,
		mixpanelReport: { type: "Funnels", steps: ["renewal offered", "policy cancelled (cancel_reason in found_cheaper, price_increase)"], counting: "totals", holdPropertyConstant: "policy_id", window: `${RENEWAL_WINDOW_DAYS} days`, dateRange: `${D(DATASET_START)} to 2026-08-31`, filter: "is_bundled = false (step 1)", breakdown: "premium_change_pct (custom buckets ≤ 0, 0-15, ≥ 15)" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H7_SQL },
				select: { s: { where: { grp: "shock" } }, n: { where: { grp: "no_increase" } } },
				expect: { metric: "s.nonrenewal / n.nonrenewal", op: ">=", target: r3(NONRENEW_HIGH / NONRENEW_LOW), floor: half(NONRENEW_HIGH / NONRENEW_LOW) },
				minCohort: 100,
			},
			{
				breakdown: { type: "duckdb", sql: H7_SQL },
				select: { m: { where: { grp: "moderate" } }, n: { where: { grp: "no_increase" } } },
				// dose-response middle point: knob-derived ratio, half-effect floor
				expect: { metric: "m.nonrenewal / n.nonrenewal", op: ">=", target: H7_MID_RATIO, floor: half(H7_MID_RATIO) },
				minCohort: 100,
			},
		],
	},
	{
		id: "H8-fall-social-campaign",
		hook: "H8",
		archetype: "temporal-inflection",
		narrative: `The fall "Switch & Save" social campaign starts ${D(SOCIAL_CAMPAIGN_START)} and runs to the end of the window: the social planned budget doubles (${SOCIAL_BUDGET_MULT}x) and social ads bring ${SOCIAL_LIFT}x as many quote starts per day as before (new shoppers, not relabeled ones: the other channels do not move). The ads target drivers insured elsewhere, so campaign shoppers lean to auto (${CAMPAIGN_PRODUCT_WEIGHTS.auto}%) and switching (${CAMPAIGN_REASON_WEIGHTS.switching}%). Warehouse social spend per day = half planned budget (x${SOCIAL_BUDGET_MULT}) and half bid x delivered quote starts (x${SOCIAL_LIFT}), about ${r3((SOCIAL_BUDGET_MULT + SOCIAL_LIFT) / 2)}x. Reads: social_ads quote starts per day, campaign over before; all other channels per day, campaign over before (control, 1.0); warehouse social spend per day, campaign over before. About 130 social quote starts in the campaign carry ~9% noise, so the lift read uses the knob as target with a floor.`,
		mixpanelReport: { type: "Insights + warehouse", event: "quote started", measure: "total per day", breakdown: "acquisition_channel", chart: `daily line; before vs from ${D(SOCIAL_CAMPAIGN_START)}`, join: "marketing_spend_daily.spend_usd (acquisition_channel = social_ads)" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H8_SQL },
				select: { a: { where: { grp: "social_campaign" } }, b: { where: { grp: "social_before" } } },
				expect: { metric: "a.per_day / b.per_day", op: ">=", target: SOCIAL_LIFT, floor: half(SOCIAL_LIFT) },
				minCohort: 120,
			},
			{
				breakdown: { type: "duckdb", sql: H8_SQL },
				select: { a: { where: { grp: "other_campaign" } }, b: { where: { grp: "other_before" } } },
				expect: { metric: "a.per_day / b.per_day", op: "between", target: band(1) },
				minCohort: 500,
			},
			{
				breakdown: { type: "duckdb", sql: H8_SQL },
				select: { a: { where: { grp: "social_campaign" } }, b: { where: { grp: "social_before" } } },
				expect: { metric: "a.social_spend_per_day / b.social_spend_per_day", op: "between", target: band((SOCIAL_BUDGET_MULT + SOCIAL_LIFT) / 2) },
				minCohort: 120,
			},
		],
	},
	{
		id: "H9-switchers-take-longer",
		hook: "H9",
		archetype: "funnel-ttc-by-segment",
		narrative: `Why a shopper is shopping decides how fast they buy. quote completed carries shopping_reason (asked in the quote flow): switching (already insured elsewhere), life_change (new car, new home, a move), first_policy. Switchers take ${SWITCHER_TTC_MULT}x as long from quote to purchase as everyone else (base median ${BIND_GAP_MEDIAN_H} h, log-normal); purchase probability itself does not depend on the reason. Read: median hours quote completed → policy purchased among purchases within ${BIND_WINDOW_DAYS} days, quotes through ${QUOTE_READ_END.slice(0, 10)} (exclusive), switching over the other two reasons. About 230-260 purchases per group carry ~7% noise, so the read uses the knob as target with a floor.`,
		mixpanelReport: { type: "Funnels", steps: ["quote completed", "policy purchased"], counting: "uniques", window: `${BIND_WINDOW_DAYS} days`, dateRange: `${D(DATASET_START)} to 2026-09-17`, breakdown: "shopping_reason (step 1)", measure: "median time to convert" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H9_SQL },
				select: { s: { where: { grp: "switching" } }, o: { where: { grp: "other" } } },
				expect: { metric: "s.med_hours / o.med_hours", op: ">=", target: SWITCHER_TTC_MULT, floor: half(SWITCHER_TTC_MULT) },
				minCohort: 150,
			},
		],
	},
	{
		id: "H10-autopay-and-lapses",
		hook: "H10",
		archetype: "funnel-conversion-by-segment",
		narrative: `Autopay keeps policies alive. A scheduled installment fails ${FAIL_MANUAL * 100}% of the time for customers who pay by hand (card or bank transfer) and ${FAIL_AUTOPAY * 100}% for autopay draws (ratio ${r3(FAIL_AUTOPAY / FAIL_MANUAL)}). After a failed manual payment, ${LAPSE_AFTER_MANUAL_FAIL * 100}% of policies are cancelled for nonpayment 10-25 days later; the rest pay within a week (is_retry = true). Autopay failures are retried automatically after ${AUTOPAY_RETRY_DAYS} days and only ${AUTOPAY_RETRY_FAIL * 100}% of retries fail again. Reads: failed scheduled payments / scheduled payments (payment made with is_retry = false + payment failed with is_retry = false), autopay over manual; and among failed scheduled manual payments through ${LAPSE_READ_END.slice(0, 10)}, the share followed by policy cancelled (cancel_reason = nonpayment) on the same policy within ${LAPSE_WINDOW_DAYS} days. About 200 autopay failures carry ~7% noise, so both reads use the knob as target with a bound.`,
		mixpanelReport: { type: "Insights + Funnels", events: ["payment failed (is_retry = false)", "payment made (is_retry = false)"], formula: "A / (A + B)", breakdown: "payment_method", funnel: `payment failed (step 1 filter is_retry = false) → policy cancelled (cancel_reason = nonpayment), Totals, hold policy_id constant, ${LAPSE_WINDOW_DAYS}-day window, breakdown payment_method` },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H10_SQL },
				select: { a: { where: { grp: "autopay" } }, m: { where: { grp: "manual" } } },
				expect: { metric: "a.fail_rate / m.fail_rate", op: "<=", target: r3(FAIL_AUTOPAY / FAIL_MANUAL), floor: half(FAIL_AUTOPAY / FAIL_MANUAL) },
				minCohort: 1500,
			},
			{
				breakdown: { type: "duckdb", sql: H10_SQL },
				select: { m: { where: { grp: "manual" } } },
				expect: { metric: "m.lapse_rate", op: ">=", target: LAPSE_AFTER_MANUAL_FAIL, floor: 0.15 },
				minCohort: 1500,
			},
		],
	},
];

export default config;
