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
 * NAME:       Tradepost
 * APP:        Peer-to-peer resale marketplace (iOS and Android apps). Members
 *             browse and search listings, save items, buy now or make an
 *             offer, check out, and get the item shipped; afterwards they can
 *             review the order or open a dispute. Sellers list items, drop
 *             prices, sell, and print a prepaid shipping label. Casual sellers
 *             pay a selling fee on each sale (10% → 12.9% from 2026-07-15);
 *             Tradepost Pro sellers pay a monthly subscription and a 9.5% fee.
 *             Tradepost earns the selling fee (take rate) on gross
 *             merchandise value (GMV).
 * SCALE:      10,000 simulated people (≈4,640 sign up inside the window; ≈330
 *             start signing up but never finish and stay anonymous guests),
 *             ~0.75M events, 120 days (2026-06-04 → 2026-10-01, UTC)
 * CORE LOOP:  buyer: listing viewed → (offer made → offer accepted) → checkout
 *             started → purchase completed → order shipped → order delivered
 *             → review submitted; seller: listing created → (listing price
 *             dropped) → item sold → shipping label printed
 * VALUE MOMENT: purchase completed (buyer), item sold (seller)
 *
 * EVENTS (19):
 *   listing viewed > home feed viewed > search performed > item saved
 *   > listing created > checkout started > purchase completed > order shipped
 *   > order delivered > $experiment_started > offer made > item sold
 *   > shipping label printed > offer declined > review submitted
 *   > offer accepted > listing price dropped > account created > dispute opened
 *
 * FUNNELS (6 declared; every unit is rebuilt by the everything hook):
 *   - Signup (first funnel): home feed viewed → listing viewed ×2 → account
 *       created (auth) → search performed → listing viewed. Guest steps before
 *       signup carry device_id only.
 *   - Browse (weight 12): home feed viewed → search performed → listing viewed
 *       ×4 / item saved (first-fixed)
 *   - Buy Now (weight 6): listing viewed → checkout started → purchase
 *       completed → order shipped → order delivered → review submitted →
 *       dispute opened (engine 100%; the hook decides each step). Carries the
 *       Express Checkout experiment (multipliers 1.0; the hook applies it).
 *   - Offer (weight 4): listing viewed → offer made → offer accepted / offer
 *       declined → checkout started → … (as Buy Now)
 *   - Listing (casual, weight 10; Pro, weight 75; conditions on account_type):
 *       listing created → listing price dropped → item sold → shipping label
 *       printed
 *
 * USER PROPS:  account_type (buyer / seller / pro_seller), acquisition_channel,
 *              region, age_band, member_since, "Experiment: Express Checkout"
 * SUPER PROPS: platform (ios/android, from the device), region (sticky)
 * SCD PROPS:   none
 * GROUPS:      none
 * WAREHOUSE:   marketing_spend_daily (spend, clicks, impressions by paid
 *              channel), payment_processing_daily (authorizations, approval
 *              rate, latency, status by payment method),
 *              marketplace_ledger_daily (GMV, orders, take rate, fee revenue,
 *              refunds by seller type)
 * LOOKUPS:     none — listing attributes (category, price, condition, photo
 *              count, seller type) are denormalized onto every event
 * SOUP:        Sunday-heavy dayOfWeekWeights, Friday lowest; US lunch and
 *              evening hourOfDayWeights (UTC)
 *
 * IDENTITY: guests browse before they sign up; those steps carry device_id
 * only. "account created" (isAuthEvent) carries user_id and device_id, so
 * Mixpanel stitches the guest steps to the member. One phone per member
 * (avgDevicePerUser 1). The two Signup steps after account created carry
 * user_id only; server-side events (offer accepted / declined, order shipped,
 * order delivered, item sold) carry user_id only; every other event carries
 * both. About 330 people never finish signing up: they keep up to 3 days of
 * anonymous browsing (device_id only) and their profiles have no identified
 * events. platform agrees with the engine os field (iOS, iPadOS → ios;
 * Android → android).
 *
 * DESIGN NOTES:
 * - Units: every engine Buy Now / Offer / Listing instance has its own
 *   listing_id (funnel prop). The hook groups them, draws the listing
 *   (category by date, price by category, seller type by date), and places
 *   every step with real gaps: checkout 6 min after the view (log-normal),
 *   purchase minutes later, shipping 1.1 days (Pro) or 2.6 days (casual)
 *   median, transit by carrier, review / dispute after delivery. Unused engine
 *   steps are dropped; a unit never orphans a step.
 * - Window start: members who joined before June 4 have orders in flight
 *   (units anchored in the 21 days before the window) and listings already
 *   live (45 days before); only in-window steps remain, so deliveries, sales,
 *   and labels do not ramp from zero in June.
 * - Seller and buyer streams are separate people: item sold counts the
 *   sellers' sales, purchase completed counts the buyers' purchases.
 * - Ratings and disputes depend on delivery time (realism, not a story):
 *   deliveries over 7 days rate lower and get disputed more often.
 * - Warehouse drift: payment_processing_daily adds untracked orders (0-10% by
 *   day), a ±9% settlement mix, and a few ops authorizations; the ledger adds
 *   untracked orders, cancellations, and ±10% settlement timing. Spend is half
 *   a paced budget (weekday shape, never zero) and half bid × delivered
 *   signups, with seeded day noise.
 * - retentionCurve shapes new members' activity; established members' activity
 *   is flat across the window (DOW weights).
 */

// ── HOOK STORIES ──
/*
 * All effects are hidden: no flag properties. Dates live in the TIMELINE
 * constants and are shared by hooks, stories, SQL, warehouse columns, and the
 * timeline guide.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H1. CASUAL SELLER FEE CHANGE (everything + warehouse marketplace_ledger_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: on 2026-07-15 the casual seller fee rises 10% → 12.9% (Pro stays
 *   9.5%). Casual sellers create 0.75x as many listings afterwards (whole
 *   listing units dropped). Buyers see the casual share of listings fall over
 *   a 14-day drain: casual:Pro odds of listings viewed 0.75x from Jul 29.
 *   take_rate lives only in the ledger.
 * MIXPANEL: Insights, listing created, total per day, filter member_since
 *   before 2026-06-04, breakdown account_type, Jun 4-Jul 14 vs Jul 15-Oct 1;
 *   Insights, listing viewed, breakdown seller_type, % of total, weekly.
 * REAL WORLD: a fee rise thins the hobby sellers first; pros price it in.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H2. EXPRESS CHECKOUT EXPERIMENT (Buy Now funnel experiment + everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-07-22 members split 50/50 at checkout. The variant
 *   completes 1.15x as many checkouts (64% base) and halves checkout time
 *   (median 4 → 2 min). Exposure 1 s before each checkout.
 * MIXPANEL: Funnels, checkout started → purchase completed, Totals, hold
 *   order_id constant, 1-day window, Jul 22-Sep 30, breakdown
 *   "Experiment: Express Checkout"; median time to convert. Or Experiments.
 * REAL WORLD: every extra form field at checkout loses buyers.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H3. OFFER PRICE THRESHOLD (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: acceptance is logistic in offer_pct_of_ask (5% → 68%, midpoint
 *   77%, scale 3 points). Integrated over buyers' offer habits: 63.3% of
 *   offers at 80%+ of ask are accepted vs 20.9% below 80% (3.03x); under 70%
 *   only 6.6%.
 * MIXPANEL: Funnels, offer made → offer accepted, Totals, hold offer_id
 *   constant, 2-day window, breakdown offer_pct_of_ask (custom buckets).
 * REAL WORLD: sellers ignore lowballs; a serious offer gets a yes.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H4. PHOTOS SELL (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: share of listings that sell: 1-2 photos 0.5x, 3-4 photos 0.8x of
 *   5+ photos (50% base). Time to sell does not depend on photos.
 * MIXPANEL: Funnels, listing created → item sold, Totals, hold listing_id
 *   constant, 30-day window, listings Jun 4-Aug 31, breakdown photo_count
 *   (custom buckets 1-2, 3-4, 5+).
 * REAL WORLD: buyers do not trust what they cannot see.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H5. LATE FIRST DELIVERY COSTS A BUYER (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: when a buyer's first delivery in the window took more than 7 days
 *   (delivery_days), the buyer stops buying with probability 0.45.
 *   Lateness comes from seller shipping speed and the carrier.
 * MIXPANEL: Retention, birth order delivered (first time), return purchase
 *   completed, custom bracket day 0-29, breakdown delivery_days (<= 7, > 7),
 *   births Jun 4-Sep 1.
 * REAL WORLD: a buyer who waited two weeks for the first order does not come
 *   back.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H6. CARD PROCESSOR INCIDENT (everything + warehouse payment_processing_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-09-14 to 2026-09-18, 40% of card checkouts fail at payment
 *   (no purchase). Apple Pay, Google Pay, PayPal untouched. The warehouse
 *   shows processor_status = degraded and approval_rate ≈ 0.6x normal for
 *   card on those days.
 * MIXPANEL: Funnels, checkout started → purchase completed, hold order_id,
 *   1-day window, breakdown payment_method, daily; join processor_status.
 * REAL WORLD: a payment partner's bad week shows up as "conversion fell".
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H7. PAID CHANNEL ACTIVATION (everything + warehouse marketing_spend_daily;
 *     external-table join)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: spend per Mixpanel signup $12 Google Shopping, $9 Meta, $6 TikTok
 *   (half paced budget, half bid x delivered signups, seeded noise). New
 *   members activate (first purchase within 14 days) at a channel share of
 *   0.9 Google, 0.65 Meta, 0.4 TikTok, 0.8 organic, 0.85 referral; activated
 *   members' first buy-now visit in those days completes. Google costs 2x
 *   TikTok per signup but 0.89x per activated buyer.
 * MIXPANEL: Funnels, account created → purchase completed, 14-day window,
 *   breakdown acquisition_channel, signups Jun 4-Sep 17; spend from
 *   marketing_spend_daily by acquisition_channel.
 * REAL WORLD: shopping-intent clicks cost more and buy sooner.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H8. TRADEPOST GUARANTEE LAUNCH (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: before 2026-08-26, checkouts of items priced $150+ complete at
 *   0.8x the rate of cheaper items. The Guarantee lifts high-ticket
 *   completion 1.25x (level with low-ticket); low-ticket unchanged.
 * MIXPANEL: Funnels, checkout started → purchase completed, Totals, hold
 *   order_id, 1-day window, breakdown item_price (< 150, >= 150), before vs
 *   after Aug 26.
 * REAL WORLD: buyer protection unlocks the expensive purchases.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H9. TIME TO SELL BY CATEGORY (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: days from listing to sale are log-normal (median 6 days for
 *   fashion, toys & games, sports & outdoors) x 0.5 electronics, 0.75
 *   sneakers, 1.3 home decor, 1.6 collectibles.
 * MIXPANEL: Funnels, listing created → item sold, Totals, hold listing_id
 *   constant, 30-day window, listings Jun 4-Aug 31, median time to convert,
 *   breakdown category.
 * REAL WORLD: phones sell in days; a vintage figurine waits for its buyer.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H10. BACK TO CAMPUS (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-08-10 to 2026-09-07 the home feed carries a Back to Campus
 *   collection (feed_section = back_to_campus on ~20% of visits) and the
 *   electronics weight in what buyers browse doubles: electronics share of
 *   listing views 18% → 30.5% (1.695x), back to 18% after.
 * MIXPANEL: Insights, listing viewed, breakdown category, % of total, weekly.
 * REAL WORLD: students buy used laptops, tablets, and headphones in August.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * EXPECTED METRICS SUMMARY (measured: data/verify-marketplace, 2026-10-07,
 * full fidelity, 10,000 people, 753,792 events)
 * ═════════════════════════════════════════════════════════════════════════
 * Hook | Metric                                         | Derivation            | Expected | Measured
 * -----|------------------------------------------------|-----------------------|----------|---------
 * H1   | listings/day, established casual vs Pro (DiD)  | CASUAL_LISTING_KEEP   | 0.75     | 0.750 (casual 72.3 → 53.9/day; Pro 217.0 → 215.6)
 * H1   | casual:Pro odds of listings viewed, after/before | CASUAL_LISTING_KEEP | 0.75     | 0.736 (0.335 → 0.247)
 * H1   | ledger take_rate casual, after/before          | 12.9 / 10             | 1.29     | 1.290
 * H2   | checkout conversion, variant/control           | EXPRESS_CONV_MULT     | 1.15     | 1.149 (72.5% vs 63.1%)
 * H2   | median checkout minutes, variant/control       | EXPRESS_TIME_MULT     | 0.50     | 0.517 (2.05 vs 3.97 min)
 * H2   | variant share of exposed members               | equal 2-arm hash      | 0.50     | 0.498
 * H2   | exposures before start or off-arm              | exact purity          | 0        | 0
 * H3   | acceptance, offers 80%+ / below 80%            | logistic x offer mix  | 3.03     | 3.096 (63.2% vs 20.4%)
 * H4   | 30-day sell-through, 1-2 photos / 5+           | PHOTO_SELL_KEEP(1)    | 0.50     | 0.496 (24.7% vs 49.9%)
 * H4   | 30-day sell-through, 3-4 photos / 5+           | PHOTO_SELL_KEEP(3)    | 0.80     | 0.787 (39.2% vs 49.9%)
 * H5   | 30-day repurchase, late / on-time first delivery | 1 − TRUST_LOSS      | 0.55     | 0.537 (31.5% vs 58.6%)
 * H6   | card / other conversion, incident / ±14 d      | 1 − CARD_FAIL         | 0.60     | 0.615 (card 43.4% vs 70.1%)
 * H6   | warehouse card approval_rate, degraded/normal  | 1 − CARD_FAIL         | 0.60     | 0.599
 * H7   | spend per signup, Google / TikTok              | 12 / 6                | 2.00     | 2.021 ($12.41 vs $6.14)
 * H7   | 14-day activation, Google / TikTok             | 0.9 / 0.4             | 2.25     | 2.182 (69.6% vs 31.9%)
 * H7   | spend per activated buyer, Google / TikTok     | 2.0 / 2.25            | 0.889    | 0.926 ($17.83 vs $19.25)
 * H8   | high/low-ticket conversion, after/before (DiD) | GUARANTEE_MULT        | 1.25     | 1.276 (54.9% → 70.1% vs 67.6% → 67.7%)
 * H9   | median days to sell, electronics / base        | CAT_SELL_TTC          | 0.50     | 0.493 (2.95 vs 5.98 d)
 * H9   | median days to sell, collectibles / base       | CAT_SELL_TTC          | 1.60     | 1.572 (9.39 d)
 * H10  | electronics share of listing views, BTS/before | 2w / (2w + 1 − w) / w | 1.695    | 1.692 (18.0% → 30.4%)
 * H10  | electronics share, after / before (control)    | unchanged             | 1.00     | 0.998
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Noise notes: H1's listing read rests on about 1,000 established casual
 * sellers whose engine listing timing moves each period a few percent, so it
 * uses the knob as target with a half-effect floor. H5's late group is about
 * 750 buyers (relative SE about 5%). H6 rests on about 940 card checkouts on
 * incident days (relative SE about 4%). H7's TikTok activation rests on about
 * 920 signups (relative SE about 4%); its spend-per-activated read compounds
 * that with spend noise. Activated buyers whose first 14 days had no
 * completed buy-now visit get one forced (about 1,150 checkouts, under 3% of
 * all), which pulls the H2/H6/H8 ratios toward 1 by about 1%.
 */

// ── SCALE ──
const SEED = "dm4-marketplace";
const NUM_USERS = 10_000;
const DATASET_START = "2026-06-04T00:00:00Z";
const DATASET_END = "2026-10-01T23:59:59Z"; // 120 days
const EVENTS_PER_DAY = 1.2;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── TIMELINE (shared by hooks, stories, SQL, warehouse columns, guides) ──
const FEE_CHANGE = "2026-07-15T00:00:00Z";          // casual-seller selling fee 10% → 12.9%
const EXPRESS_START = "2026-07-22T00:00:00Z";       // "Express Checkout" A/B test starts
const BTS_START = "2026-08-10T00:00:00Z";           // Back to Campus collection on the home feed
const BTS_END = "2026-09-08T00:00:00Z";             // exclusive (Aug 10 - Sep 7, through Labor Day)
const GUARANTEE_LAUNCH = "2026-08-26T00:00:00Z";    // Tradepost Guarantee (buyer protection) launches
const CARD_INCIDENT_START = "2026-09-14T00:00:00Z"; // card processor incident starts
const CARD_INCIDENT_END = "2026-09-19T00:00:00Z";   // exclusive (5 days: Mon Sep 14 - Fri Sep 18)

const ms = (iso) => dayjs.utc(iso).valueOf();
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;
const WINDOW_DAYS = 120;

// ── WEEKLY AND DAILY RHYTHM (soup) ──
// Sun..Sat. Resale shopping and listing peak on Sunday; Friday night is quiet.
const DOW_WEIGHTS = [1.22, 1.02, 0.96, 0.96, 0.98, 0.9, 1.08];
// UTC hours. US members: lunch (16-19 UTC) and evening (00-04 UTC) peaks.
const HOUR_WEIGHTS = [0.95, 1.0, 1.0, 0.92, 0.75, 0.55, 0.38, 0.26, 0.2, 0.18, 0.2, 0.26,
	0.36, 0.48, 0.6, 0.68, 0.74, 0.76, 0.72, 0.7, 0.72, 0.76, 0.82, 0.9];

// ── KNOBS ──
// H1 seller fee change: casual sellers list less; buyer-side supply follows
const TAKE_RATE = { casual: [0.10, 0.129], pro: [0.095, 0.095] }; // [before, after] FEE_CHANGE
const CASUAL_LISTING_KEEP = 0.75;     // share of casual sellers' would-be listings created after the change
const SUPPLY_CASUAL_SHARE = 0.25;     // share of listings buyers see from casual sellers before the change
const SUPPLY_RAMP_DAYS = 14;          // casual inventory drains over two weeks after the change

// H2 Express Checkout experiment
const EXPRESS_EXPERIMENT = "Express Checkout";
const EXPRESS_VARIANT = "Express Checkout";
const EXP_KEY = `Experiment: ${EXPRESS_EXPERIMENT}`;
const CHECKOUT_BASE = 0.64;           // share of checkouts that end in a purchase (low-ticket, control)
const EXPRESS_CONV_MULT = 1.15;
const EXPRESS_TIME_MULT = 0.5;        // checkout started → purchase completed time
const CHECKOUT_MEDIAN_MIN = 4;
const CHECKOUT_SIGMA = 0.6;

// H3 offer price threshold: acceptance rises steeply with offer % of asking price
const OFFER_HABIT_MEAN = 80;          // each buyer's typical offer, % of asking (salted per buyer)
const OFFER_HABIT_SD = 5;
const OFFER_SD = 9;                   // spread of one buyer's offers around their habit
const ACCEPT_FLOOR = 0.05;
const ACCEPT_CEIL = 0.68;
const ACCEPT_CENTER = 77;             // logistic midpoint, % of asking
const ACCEPT_SCALE = 3;
const OFFER_LOW_MAX = 70;             // read buckets: under 70% vs 85% and up
const OFFER_HIGH_MIN = 85;
const acceptProb = (pct) => ACCEPT_FLOOR + (ACCEPT_CEIL - ACCEPT_FLOOR) / (1 + Math.exp(-(pct - ACCEPT_CENTER) / ACCEPT_SCALE));
const OFFER_CHECKOUT_SHARE = 0.92;    // accepted offers that go to checkout

// H4 photo count → sell-through; H9 time to sell by category
const SELL_BASE = 0.5;                // share of listings with 5+ photos that sell
const PHOTO_SELL_KEEP = (n) => (n <= 2 ? 0.5 : n <= 4 ? 0.8 : 1);
const SELL_DAYS_MEDIAN = 6;
const SELL_DAYS_SIGMA = 0.6;
const CAT_SELL_TTC = { electronics: 0.5, sneakers: 0.75, fashion: 1, toys_games: 1, sports_outdoors: 1, home_decor: 1.3, collectibles: 1.6 };
const PRICE_DROP_SHARE = 0.3;

// H5 a late first delivery costs buyer trust
const LATE_DAYS = 7;
const TRUST_LOSS = 0.45;              // share of buyers whose first delivery is late who stop buying

// H6 card processor incident
const CARD_FAIL = 0.4;                // share of card checkouts whose payment fails during the incident

// H7 paid acquisition and new-buyer activation
const PAID_CHANNELS = ["google_shopping", "meta_ads", "tiktok_ads"];
const CHANNEL_WEIGHTS = { organic: 28, referral: 10, google_shopping: 24, meta_ads: 16, tiktok_ads: 22 };
const CPI_USD = { google_shopping: 12, meta_ads: 9, tiktok_ads: 6 }; // window spend per Mixpanel signup
const ACTIVATE = { organic: 0.8, referral: 0.85, google_shopping: 0.9, meta_ads: 0.65, tiktok_ads: 0.4 };
const ACTIVATION_DAYS = 14;
const BORN_PCT = 50;
const DAILY_BUDGET_USD = Object.fromEntries(PAID_CHANNELS.map((ch) => {
	const totalW = Object.values(CHANNEL_WEIGHTS).reduce((a, b) => a + b, 0);
	return [ch, CPI_USD[ch] * (NUM_USERS * BORN_PCT / 100) * (CHANNEL_WEIGHTS[ch] / totalW) / WINDOW_DAYS];
}));
const SPEND_PLAN_SHARE = 0.5;         // half paced budget, half bid x delivered signups
const SPEND_FLAT_SHARE = 0.4;
const SPEND_WEEKDAY = (() => {
	const m = DOW_WEIGHTS.reduce((a, b) => a + b, 0) / DOW_WEIGHTS.length;
	return DOW_WEIGHTS.map((w) => SPEND_FLAT_SHARE + (1 - SPEND_FLAT_SHARE) * w / m);
})();
const SPEND_NOISE = 0.12;
const CPC_USD = { google_shopping: 0.85, meta_ads: 1.1, tiktok_ads: 0.6 };
const CTR = { google_shopping: 0.021, meta_ads: 0.009, tiktok_ads: 0.007 };

// H8 Tradepost Guarantee: high-ticket checkouts stop lagging
const HIGH_TICKET_USD = 150;
const HIGH_TICKET_BEFORE = 0.8;       // high-ticket checkout completion relative to low-ticket, before launch
const GUARANTEE_MULT = 1.25;          // after launch high-ticket completion = 0.8 x 1.25 = low-ticket rate

// H10 Back to Campus: electronics share of browsing
const CATEGORY_WEIGHTS = { electronics: 18, fashion: 26, sneakers: 10, home_decor: 14, collectibles: 10, toys_games: 10, sports_outdoors: 12 };
const BTS_ELECTRONICS_MULT = 2.0;
const BTS_FEED_SHARE = 0.2;           // home feed visits that open the Back to Campus collection

// realism
const PRICE_MEDIAN = { electronics: 165, fashion: 34, sneakers: 125, home_decor: 48, collectibles: 62, toys_games: 28, sports_outdoors: 58 };
const PRICE_SIGMA = 0.7;
const SHIP_DAYS_MEDIAN = { pro: 1.1, casual: 2.6 };
const TRANSIT_MEDIAN = { usps: 3.3, ups: 2.8, fedex: 2.6 };
const CARRIER_WEIGHTS = { usps: 50, ups: 30, fedex: 20 };
const REVIEW_RATE = 0.42;
const PREWINDOW_BUY_DAYS = 21;        // orders in flight at the window start
const PREWINDOW_LIST_DAYS = 45;       // listings live at the window start
const UNTRACKED_ORDER_SHARE = 0.05;   // orders from clients that never reach Mixpanel (varies 0-10% by day)

// ── HELPERS ──
const salt = (uid, tag) => hashFloat(`${uid}|${tag}`);
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
const T = (e) => dayjs.utc(e.time).valueOf();
const iso = (t) => new Date(t).toISOString();
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const byT = (a, b) => T(a) - T(b);
const logNormal = (sigma) => Math.exp(chance.normal({ mean: 0, dev: sigma }));
const jitter = (key, spread) => 1 + (hashFloat(key) - 0.5) * 2 * spread;
const rnd = () => chance.floating({ min: 0, max: 1 });
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
const inBts = (t) => t >= ms(BTS_START) && t < ms(BTS_END);
const inCardIncident = (t) => t >= ms(CARD_INCIDENT_START) && t < ms(CARD_INCIDENT_END);
const categoryAt = (t) => pickWeighted(inBts(t) ? { ...CATEGORY_WEIGHTS, electronics: CATEGORY_WEIGHTS.electronics * BTS_ELECTRONICS_MULT } : CATEGORY_WEIGHTS, rnd());
const priceFor = (cat) => Math.max(5, Math.round(PRICE_MEDIAN[cat] * logNormal(PRICE_SIGMA)));
const casualSupplyMult = (t) => 1 - (1 - CASUAL_LISTING_KEEP) * Math.min(1, Math.max(0, (t - ms(FEE_CHANGE)) / (SUPPLY_RAMP_DAYS * DAY_MS)));
const sellerTypeAt = (t) => {
	const c = SUPPLY_CASUAL_SHARE * casualSupplyMult(t);
	return rnd() < c / (c + (1 - SUPPLY_CASUAL_SHARE)) ? "casual" : "pro";
};
const takeRate = (sellerType, t) => (TAKE_RATE[sellerType] ?? TAKE_RATE.casual)[t >= ms(FEE_CHANGE) ? 1 : 0];
const paidSpend = (date, ch, signups) => round2((SPEND_PLAN_SHARE * DAILY_BUDGET_USD[ch] * SPEND_WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()]
	+ (1 - SPEND_PLAN_SHARE) * CPI_USD[ch] * signups) * jitter(`spend|${date}|${ch}`, SPEND_NOISE));
const PAY_WEIGHTS = {
	ios: { card: 45, apple_pay: 35, paypal: 20 },
	android: { card: 52, google_pay: 28, paypal: 20 },
};
const RATING_WEIGHTS = (d) => (d <= 4 ? { 5: 62, 4: 24, 3: 8, 2: 3, 1: 3 } : d <= LATE_DAYS ? { 5: 50, 4: 29, 3: 11, 2: 5, 1: 5 } : { 5: 28, 4: 28, 3: 21, 2: 11, 1: 12 });
const DISPUTE_RATE = (d) => (d <= LATE_DAYS ? 0.025 : 0.07);
const DISPUTE_REASONS = (d) => (d <= LATE_DAYS
	? { not_as_described: 46, damaged: 24, counterfeit: 12, not_received: 6, other: 12 }
	: { not_as_described: 30, damaged: 18, counterfeit: 8, not_received: 34, other: 10 });

const BUY_STEPS = ["listing viewed", "checkout started", "purchase completed", "order shipped", "order delivered", "review submitted", "dispute opened"];
const OFFER_STEPS = ["listing viewed", "offer made", "offer accepted", "offer declined", "checkout started", "purchase completed", "order shipped", "order delivered", "review submitted", "dispute opened"];
const LIST_STEPS = ["listing created", "listing price dropped", "item sold", "shipping label printed"];
const UNIT_EVENTS = new Set([...OFFER_STEPS, ...LIST_STEPS]);
const GUEST_EVENTS = new Set(["home feed viewed", "listing viewed", "search performed"]);
const GUEST_DAYS = 3;
const SERVER_EVENTS = new Set(["offer accepted", "offer declined", "order shipped", "order delivered", "item sold"]);

function handleUserHook(profile, meta) {
	const uid = profile.distinct_id;
	if (meta.userIsBornInDataset) {
		profile.member_since = dayKey(dayjs.utc(profile.created ?? meta.user?.created).valueOf());
		return profile;
	}
	const tenureDays = Math.floor(salt(uid, "tenure") * (ms(DATASET_START) - ms("2022-03-01T00:00:00Z")) / DAY_MS);
	profile.member_since = dayjs.utc("2022-03-01T00:00:00Z").add(tenureDays, "day").format("YYYY-MM-DD");
	return profile;
}

function handleEverything(events, meta) {
	if (!events.length) return events;
	const profile = meta.profile;
	const uid = profile.distinct_id;
	const BEGIN = ms(DATASET_START), END = ms(DATASET_END);
	const signup = events.find((e) => e.event === "account created");
	const birthMs = signup ? T(signup) : null;
	const accountType = profile.account_type;
	const sellerType = accountType === "pro_seller" ? "pro" : "casual";

	// ── platform: from the member's device ──
	const osEv = events.find((e) => e.device_id && e.os) || events.find((e) => e.os);
	const os = osEv?.os;
	const platform = os === "Android" ? "android" : "ios";

	// guests who started signing up but never finished: anonymous browsing only, a few days
	if (meta.userIsBornInDataset && !signup) {
		const t0 = Math.min(...events.map(T));
		const kept = events.filter((e) => GUEST_EVENTS.has(e.event) && T(e) < t0 + GUEST_DAYS * DAY_MS);
		for (const e of kept) {
			e.platform = platform;
			// guest listing attributes from hashed draws (keeps the seeded stream of members unchanged)
			const h = (tag) => hashFloat(`${e.insert_id}|${tag}`);
			const t = T(e);
			if (e.event === "listing viewed") {
				const cat = pickWeighted(inBts(t) ? { ...CATEGORY_WEIGHTS, electronics: CATEGORY_WEIGHTS.electronics * BTS_ELECTRONICS_MULT } : CATEGORY_WEIGHTS, h("cat"));
				const z = Math.sqrt(-2 * Math.log(Math.max(1e-9, h("p1")))) * Math.cos(2 * Math.PI * h("p2"));
				const c = SUPPLY_CASUAL_SHARE * casualSupplyMult(t);
				e.listing_id = `l_${String(e.insert_id).replace(/-/g, "").slice(0, 10)}`;
				e.category = cat;
				e.item_price = Math.max(5, Math.round(PRICE_MEDIAN[cat] * Math.exp(PRICE_SIGMA * z)));
				e.seller_type = h("st") < c / (c + (1 - SUPPLY_CASUAL_SHARE)) ? "casual" : "pro";
			} else if (e.event === "search performed") {
				e.search_category = pickWeighted(inBts(t) ? { ...CATEGORY_WEIGHTS, electronics: CATEGORY_WEIGHTS.electronics * BTS_ELECTRONICS_MULT } : CATEGORY_WEIGHTS, h("cat"));
			} else if (e.event === "home feed viewed") {
				e.feed_section = inBts(t) && h("bts") < BTS_FEED_SHARE ? "back_to_campus" : pickWeighted({ for_you: 70, following: 20, deals: 10 }, h("feed"));
			}
		}
		return kept;
	}
	const payHabit = pickWeighted(PAY_WEIGHTS[platform], salt(uid, "pay"));
	const payMethod = () => (rnd() < 0.8 ? payHabit : pickWeighted(PAY_WEIGHTS[platform], rnd()));
	const offerHabit = OFFER_HABIT_MEAN + OFFER_HABIT_SD * 2 * (salt(uid, "offer-habit") - 0.5) * 1.73;

	// ── group engine units by listing_id ──
	const groups = new Map();
	const templates = {};
	const exposures = [];
	const other = [];
	for (const e of events) {
		if (e.event === "$experiment_started") { exposures.push(e); continue; }
		if (!templates[e.event]) templates[e.event] = { ...e };
		if (!UNIT_EVENTS.has(e.event)) { other.push(e); continue; }
		if (!groups.has(e.listing_id)) groups.set(e.listing_id, []);
		groups.get(e.listing_id).push(e);
	}
	const buyUnits = [], offerUnits = [], listUnits = [], browseViews = [];
	for (const evs of groups.values()) {
		const by = {};
		for (const e of evs) by[e.event] = by[e.event] || e;
		if (by["listing created"]) listUnits.push(by);
		else if (by["offer made"]) offerUnits.push(by);
		else if (by["checkout started"]) buyUnits.push(by);
		// a unit with no anchor step left: its listing views read as browsing; the rest is dropped
		else for (const e of evs) if (e.event === "listing viewed" || e.event === "item saved") browseViews.push(e);
	}
	const variant = (exposures.length && profile[EXP_KEY] !== undefined) ? profile[EXP_KEY] : null;

	// ── browsing: listing attributes follow the season and the supply mix ──
	const browse = [...other, ...browseViews].sort(byT);
	let lastView = null;
	for (const e of browse) {
		const t = T(e);
		if (e.event === "listing viewed") {
			const cat = categoryAt(t);
			e.listing_id = `l_${chance.hash({ length: 10 })}`;
			e.category = cat;
			e.item_price = priceFor(cat);
			e.seller_type = sellerTypeAt(t);
			lastView = e;
		} else if (e.event === "item saved") {
			if (lastView && t - T(lastView) < 2 * HOUR_MS) {
				e.listing_id = lastView.listing_id; e.category = lastView.category; e.item_price = lastView.item_price;
			} else {
				const cat = categoryAt(t);
				e.listing_id = `l_${chance.hash({ length: 10 })}`; e.category = cat; e.item_price = priceFor(cat);
			}
		} else if (e.event === "search performed") {
			e.search_category = categoryAt(t);
		} else if (e.event === "home feed viewed") {
			e.feed_section = inBts(t) && rnd() < BTS_FEED_SHARE ? "back_to_campus" : pickWeighted({ for_you: 70, following: 20, deals: 10 }, rnd());
		}
	}
	const browseOut = browse;

	// ── purchase units (buy now and offers) ──
	const checkoutPlan = (checkoutT, price, pm) => {
		const isVariant = variant === EXPRESS_VARIANT && checkoutT >= ms(EXPRESS_START);
		let p = CHECKOUT_BASE * (isVariant ? EXPRESS_CONV_MULT : 1);
		if (price >= HIGH_TICKET_USD) p *= checkoutT >= ms(GUARANTEE_LAUNCH) ? HIGH_TICKET_BEFORE * GUARANTEE_MULT : HIGH_TICKET_BEFORE;
		if (pm === "card" && inCardIncident(checkoutT)) p *= 1 - CARD_FAIL;
		const completed = rnd() < p;
		const durMin = CHECKOUT_MEDIAN_MIN * logNormal(CHECKOUT_SIGMA) * (isVariant ? EXPRESS_TIME_MULT : 1);
		return { completed, purchaseT: checkoutT + Math.max(20_000, Math.round(durMin * MIN_MS)) };
	};
	const lifecycle = (purchaseT, st) => {
		const shipDays = SHIP_DAYS_MEDIAN[st] * logNormal(0.55);
		const carrier = pickWeighted(CARRIER_WEIGHTS, rnd());
		const transitDays = TRANSIT_MEDIAN[carrier] * logNormal(0.35);
		const shipT = purchaseT + Math.round(shipDays * DAY_MS);
		const deliveredT = shipT + Math.round(transitDays * DAY_MS);
		const deliveryDays = round1((deliveredT - purchaseT) / DAY_MS);
		const review = rnd() < REVIEW_RATE;
		const rating = Number(pickWeighted(RATING_WEIGHTS(deliveryDays), rnd()));
		const reviewT = deliveredT + chance.integer({ min: 2 * 60, max: 4 * 24 * 60 }) * MIN_MS;
		const dispute = rnd() < DISPUTE_RATE(deliveryDays);
		const disputeT = deliveredT + chance.integer({ min: 60, max: 3 * 24 * 60 }) * MIN_MS;
		return { shipDays: round1(shipDays), carrier, shipT, deliveredT, deliveryDays, review, rating, reviewT, dispute, disputeT,
			disputeReason: pickWeighted(DISPUTE_REASONS(deliveryDays), rnd()), hasPhoto: rnd() < 0.22 };
	};
	const planPurchase = (anchor, kind, src) => {
		const cat = categoryAt(anchor);
		const asking = priceFor(cat);
		const st = sellerTypeAt(anchor);
		const p = { kind, src, anchor, cat, asking, st, listingId: `l_${chance.hash({ length: 10 })}`, orderId: `o_${chance.hash({ length: 10 })}`, condition: pickWeighted({ new_with_tags: 22, like_new: 34, good: 32, fair: 12 }, rnd()) };
		let price = asking;
		if (kind === "offer") {
			const pct = Math.max(40, Math.min(100, Math.round(offerHabit + OFFER_SD * chance.normal({ mean: 0, dev: 1 }))));
			p.pct = pct;
			p.offerAmount = Math.max(1, Math.round(asking * pct / 100));
			p.offerT = anchor + Math.round(chance.floating({ min: 1, max: 40 }) * MIN_MS);
			p.accepted = rnd() < acceptProb(pct);
			const respH = Math.min(47, (p.accepted ? 2 : 5) * logNormal(0.9));
			p.respH = round1(respH);
			p.respT = p.offerT + Math.round(respH * HOUR_MS);
			p.toCheckout = p.accepted && rnd() < OFFER_CHECKOUT_SHARE;
			price = p.offerAmount;
			p.checkoutT = p.respT + Math.round(Math.min(36, 1.5 * logNormal(1.0)) * HOUR_MS);
		} else {
			p.toCheckout = true;
			p.checkoutT = anchor + Math.round(Math.min(90, 6 * logNormal(0.8)) * MIN_MS);
		}
		p.price = price;
		p.pm = payMethod();
		Object.assign(p, checkoutPlan(p.checkoutT, price, p.pm));
		p.life = lifecycle(p.purchaseT, st);
		p.photos = Math.max(1, Math.min(12, Math.round(5 + 2.2 * chance.normal({ mean: 0, dev: 1 }))));
		return p;
	};
	const purchasePlans = [
		...buyUnits.map((by) => planPurchase(T(by["listing viewed"] || by["checkout started"]), "buy", by)),
		...offerUnits.map((by) => planPurchase(T(by["listing viewed"] || by["offer made"]), "offer", by)),
	];
	// orders in flight at the window start (members who joined before June 4)
	if (!signup && purchasePlans.length) {
		const nIn = purchasePlans.length;
		const x = nIn * PREWINDOW_BUY_DAYS / WINDOW_DAYS;
		const n = Math.floor(x) + (rnd() < x % 1 ? 1 : 0);
		for (let i = 0; i < n; i++) {
			const anchor = BEGIN - Math.floor(chance.floating({ min: 0, max: PREWINDOW_BUY_DAYS }) * DAY_MS);
			const kind = purchasePlans[chance.integer({ min: 0, max: nIn - 1 })].kind;
			purchasePlans.push({ ...planPurchase(anchor, kind, null), pre: true });
		}
	}
	purchasePlans.sort((a, b) => a.anchor - b.anchor);
	// a plan's purchase can be withdrawn (H7 activation, H5 trust): the view (and offer) stay
	const noBuy = (p) => { p.toCheckout = false; };

	// H7: new buyers activate (first purchase within 14 days) by acquisition channel.
	// Activated buyers make their first purchase in those 14 days (their first
	// buy-now visit completes; one from later is pulled forward if needed);
	// the others buy nothing in their first 14 days.
	if (signup) {
		const ch = profile.acquisition_channel;
		const actEnd = birthMs + ACTIVATION_DAYS * DAY_MS;
		const early = purchasePlans.filter((p) => p.anchor < actEnd);
		if (salt(uid, "activate") >= (ACTIVATE[ch] ?? 0.8)) {
			for (const p of early) noBuy(p);
		} else if (!early.some((p) => p.toCheckout && p.completed && p.purchaseT < actEnd)) {
			let i = purchasePlans.findIndex((p) => p.kind === "buy" && p.anchor < actEnd);
			if (i < 0) {
				i = purchasePlans.findIndex((p) => p.kind === "buy");
				if (i >= 0) {
					const anchor = birthMs + Math.round(chance.floating({ min: 0.05, max: ACTIVATION_DAYS - 1.5 }) * DAY_MS);
					purchasePlans[i] = planPurchase(anchor, "buy", purchasePlans[i].src);
				}
			}
			if (i >= 0) {
				const f = purchasePlans[i];
				f.completed = true;
				f.purchaseT = Math.min(f.purchaseT, actEnd - MIN_MS);
				f.life = lifecycle(f.purchaseT, f.st);
			}
		}
		purchasePlans.sort((a, b) => a.anchor - b.anchor);
	}
	// H5: a late first delivery in the window costs trust; the buyer stops buying
	const firstDelivered = purchasePlans
		.filter((p) => p.toCheckout && p.completed && p.life.deliveredT >= BEGIN && p.life.deliveredT <= END)
		.sort((a, b) => a.life.deliveredT - b.life.deliveredT)[0];
	if (firstDelivered && firstDelivered.life.deliveryDays > LATE_DAYS && salt(uid, "trust") < TRUST_LOSS) {
		for (const p of purchasePlans) if (p !== firstDelivered && p.checkoutT > firstDelivered.life.deliveredT) noBuy(p);
	}

	// ── seller units ──
	const listPlans = [];
	if (accountType === "seller" || accountType === "pro_seller") {
		const primary = pickWeighted(CATEGORY_WEIGHTS, salt(uid, "primary-cat"));
		const photoHabit = (accountType === "pro_seller" ? 6.2 : 3.8) + 2 * (salt(uid, "photo-habit") - 0.5);
		const planListing = (anchor, src) => {
			const cat = rnd() < 0.7 ? primary : pickWeighted(CATEGORY_WEIGHTS, rnd());
			const photos = Math.max(1, Math.min(12, Math.round(photoHabit + 1.8 * chance.normal({ mean: 0, dev: 1 }))));
			const asking = priceFor(cat);
			const sold = rnd() < SELL_BASE * PHOTO_SELL_KEEP(photos);
			const sellDays = Math.min(90, SELL_DAYS_MEDIAN * (CAT_SELL_TTC[cat] ?? 1) * logNormal(SELL_DAYS_SIGMA));
			const soldT = anchor + Math.round(sellDays * DAY_MS);
			const dropDays = chance.floating({ min: 3, max: 14 });
			const dropT = anchor + Math.round(dropDays * DAY_MS);
			const dropped = rnd() < PRICE_DROP_SHARE && (!sold || dropT < soldT);
			const dropPct = chance.integer({ min: 5, max: 25 });
			const newPrice = Math.max(3, Math.round(asking * (1 - dropPct / 100)));
			const listPrice = dropped ? newPrice : asking;
			const saleType = rnd() < 0.35 ? "offer" : "buy_now";
			const salePrice = saleType === "offer" ? Math.round(listPrice * chance.floating({ min: 0.78, max: 0.97 })) : listPrice;
			const shipDays = SHIP_DAYS_MEDIAN[sellerType] * logNormal(0.55);
			return {
				src, anchor, cat, photos, asking, sold, sellDays: round1(sellDays), soldT, dropped, dropT, dropDays: Math.floor(dropDays), dropPct, newPrice,
				saleType, salePrice, shipDays: round1(shipDays), labelT: soldT + Math.round(shipDays * DAY_MS),
				carrier: pickWeighted(CARRIER_WEIGHTS, rnd()), listingId: `l_${chance.hash({ length: 10 })}`,
				condition: pickWeighted({ new_with_tags: 22, like_new: 34, good: 32, fair: 12 }, rnd()),
				packageSize: pickWeighted({ small: 55, medium: 35, large: 10 }, rnd()),
			};
		};
		for (const by of listUnits) {
			const anchor = T(by["listing created"]);
			// H1: after the fee change casual sellers create fewer listings (whole units dropped)
			if (sellerType === "casual" && anchor >= ms(FEE_CHANGE) && rnd() >= CASUAL_LISTING_KEEP) continue;
			listPlans.push(planListing(anchor, by));
		}
		// listings already live at the window start
		if (!signup && listUnits.length) {
			const x = listUnits.length * PREWINDOW_LIST_DAYS / WINDOW_DAYS;
			const n = Math.floor(x) + (rnd() < x % 1 ? 1 : 0);
			for (let i = 0; i < n; i++) {
				const anchor = BEGIN - Math.floor(chance.floating({ min: 0, max: PREWINDOW_LIST_DAYS }) * DAY_MS);
				listPlans.push({ ...planListing(anchor, null), pre: true });
			}
		}
	}

	// ── materialize units ──
	const out = [];
	const put = (src, step, t, set) => {
		if (t < BEGIN || t > END) return null;
		let ev = src && src[step];
		if (ev) { src[step] = null; } else {
			if (!templates[step]) return null;
			ev = cloneEvent(templates[step], { time: iso(t) });
		}
		ev.time = iso(t);
		Object.assign(ev, set);
		out.push(ev);
		return ev;
	};
	const checkouts = [];
	for (const p of purchasePlans) {
		const base = { listing_id: p.listingId, category: p.cat };
		put(p.src, "listing viewed", p.anchor, { ...base, item_price: p.asking, seller_type: p.st, condition: p.condition, photo_count: p.photos, view_source: pickWeighted({ search: 50, feed: 35, saved: 15 }, rnd()) });
		if (p.kind === "offer") {
			const ob = { ...base, offer_id: `of_${chance.hash({ length: 10 })}`, offer_amount: p.offerAmount, offer_pct_of_ask: p.pct };
			put(p.src, "offer made", p.offerT, { ...ob, asking_price: p.asking, seller_type: p.st });
			put(p.src, p.accepted ? "offer accepted" : "offer declined", p.respT, { ...ob, hours_to_response: p.respH });
		}
		if (!p.toCheckout) continue;
		const ob = { ...base, order_id: p.orderId };
		const c = put(p.src, "checkout started", p.checkoutT, { ...ob, item_price: p.price, seller_type: p.st, payment_method: p.pm, purchase_type: p.kind === "offer" ? "offer" : "buy_now" });
		if (c && p.checkoutT >= ms(EXPRESS_START)) checkouts.push(c);
		if (!p.completed) continue;
		const shippingFee = p.price >= 100 ? 0 : round2(5.49 + (p.cat === "home_decor" ? 3 : 0));
		put(p.src, "purchase completed", p.purchaseT, { ...ob, item_price: p.price, shipping_fee: shippingFee, order_total: round2(p.price + shippingFee), seller_type: p.st, payment_method: p.pm, purchase_type: p.kind === "offer" ? "offer" : "buy_now" });
		const L = p.life;
		put(p.src, "order shipped", L.shipT, { ...ob, shipping_carrier: L.carrier, days_to_ship: L.shipDays });
		put(p.src, "order delivered", L.deliveredT, { ...ob, shipping_carrier: L.carrier, delivery_days: L.deliveryDays });
		if (L.review) put(p.src, "review submitted", L.reviewT, { ...ob, rating: L.rating, has_photo: L.hasPhoto });
		if (L.dispute) put(p.src, "dispute opened", L.disputeT, { ...ob, dispute_reason: L.disputeReason, item_price: p.price });
	}
	for (const p of listPlans) {
		const base = { listing_id: p.listingId, category: p.cat };
		put(p.src, "listing created", p.anchor, { ...base, asking_price: p.asking, condition: p.condition, photo_count: p.photos, package_size: p.packageSize });
		if (p.dropped) put(p.src, "listing price dropped", p.dropT, { ...base, old_price: p.asking, new_price: p.newPrice, drop_pct: p.dropPct, days_since_listed: p.dropDays });
		if (!p.sold) continue;
		put(p.src, "item sold", p.soldT, { ...base, sale_price: p.salePrice, days_to_sell: p.sellDays, sale_type: p.saleType });
		put(p.src, "shipping label printed", p.labelT, { ...base, shipping_carrier: p.carrier, days_to_ship: p.shipDays });
	}

	// ── experiment exposure: one per checkout after the test starts, 1 s before it ──
	const exposed = [];
	if (variant !== null && exposures.length) {
		checkouts.sort(byT).forEach((c, i) => {
			const t = T(c) - 1000;
			const ex = exposures[i] || cloneEvent(exposures[0], { time: iso(t) });
			ex.time = iso(t);
			ex["Experiment name"] = EXPRESS_EXPERIMENT;
			ex["Variant name"] = variant;
			exposed.push(ex);
		});
	}
	if (!exposed.length && profile[EXP_KEY] !== undefined) delete profile[EXP_KEY];

	const final = browseOut.concat(out, exposed).filter((e) => T(e) >= BEGIN && T(e) <= END);
	for (const e of final) {
		e.platform = platform;
		if (SERVER_EVENTS.has(e.event)) delete e.device_id;
	}
	return final;
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
		return row;
	}
	if (meta.metricName === "payment_processing_daily") {
		const k = `${row.date}|${row.payment_method}`;
		// approved authorizations include orders from clients that never reach Mixpanel
		// and a settlement mix that moves a few percent day to day
		row.authorizations_approved = Math.round(row.authorizations_approved * (1 + UNTRACKED_ORDER_SHARE * jitter(`untracked|${k}`, 1)) * jitter(`settle|${k}`, 0.09) + 3 * jitter(`ops|${k}`, 1));
		row.authorizations_attempted = Math.round(row.authorizations_approved / row.approval_rate);
		return row;
	}
	if (meta.metricName === "marketplace_ledger_daily") {
		const k = `${row.date}|${row.seller_type}`;
		// untracked orders, cancellations before shipping, and settlement timing
		const lift = (1 + UNTRACKED_ORDER_SHARE * jitter(`ledger-untracked|${k}`, 1)) * jitter(`ledger-settle|${k}`, 0.1);
		const cancelled = 0.015 * jitter(`cancel|${k}`, 0.8);
		row.orders = Math.max(0, Math.round(meta.raw.plus.count * (lift - cancelled)));
		row.gmv_usd = round2(row.gmv_usd * (lift - cancelled));
		row.fee_revenue_usd = round2(row.gmv_usd * row.take_rate);
		row.refunds_usd = round2(row.gmv_usd * 0.028 * jitter(`refund|${k}`, 0.6));
		return row;
	}
	return row;
}

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
		hasDesktopDevices: false,
		hasBrowser: false,
		hasCampaigns: false,
		isAnonymous: false,
		hasAdSpend: false,
		hasAvatar: true,
	},
	identity: { avgDevicePerUser: 1 },
	stickyEventProps: ["region"],

	events: [
		{
			event: "account created",
			weight: 1,
			isFirstEvent: true,
			isAuthEvent: true,
			properties: {
				signup_method: { __weights: { email: 38, google: 34, apple: 28 } },
				acquisition_channel: (ctx) => ctx.profile.acquisition_channel,
				account_type: (ctx) => ctx.profile.account_type,
			},
		},
		{
			event: "home feed viewed",
			weight: 1,
			isStrictEvent: true,
			properties: { feed_section: ["for_you"] },
		},
		{
			event: "search performed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				search_category: ["fashion"],
				results_count: u.weighNumRange(0, 400, 0.4, 60),
				sort_by: { __weights: { relevance: 62, newest: 16, price_low: 14, price_high: 8 } },
			},
		},
		{
			event: "listing viewed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				listing_id: ["l_unassigned"],
				category: ["fashion"],
				item_price: [30],
				condition: { __weights: { new_with_tags: 22, like_new: 34, good: 32, fair: 12 } },
				photo_count: u.weighNumRange(1, 12, 0.6, 5),
				seller_type: ["casual"],
				view_source: { __weights: { search: 48, feed: 38, saved: 14 } },
			},
		},
		{
			event: "item saved",
			weight: 1,
			isStrictEvent: true,
			properties: { listing_id: ["l_unassigned"], category: ["fashion"], item_price: [30] },
		},
		{
			event: "offer made",
			weight: 1,
			isStrictEvent: true,
			properties: { listing_id: ["l_unassigned"], category: ["fashion"], offer_id: ["of_unassigned"], asking_price: [30], offer_amount: [25], offer_pct_of_ask: [80], seller_type: ["casual"] },
		},
		{
			event: "offer accepted",
			weight: 1,
			isStrictEvent: true,
			properties: { listing_id: ["l_unassigned"], category: ["fashion"], offer_id: ["of_unassigned"], offer_amount: [25], offer_pct_of_ask: [80], hours_to_response: [2] },
		},
		{
			event: "offer declined",
			weight: 1,
			isStrictEvent: true,
			properties: { listing_id: ["l_unassigned"], category: ["fashion"], offer_id: ["of_unassigned"], offer_amount: [25], offer_pct_of_ask: [80], hours_to_response: [2] },
		},
		{
			event: "checkout started",
			weight: 1,
			isStrictEvent: true,
			properties: { listing_id: ["l_unassigned"], category: ["fashion"], order_id: ["o_unassigned"], item_price: [30], seller_type: ["casual"], payment_method: ["card"], purchase_type: ["buy_now"] },
		},
		{
			event: "purchase completed",
			weight: 1,
			isStrictEvent: true,
			properties: { listing_id: ["l_unassigned"], category: ["fashion"], order_id: ["o_unassigned"], item_price: [30], shipping_fee: [5.49], order_total: [35.49], seller_type: ["casual"], payment_method: ["card"], purchase_type: ["buy_now"] },
		},
		{
			event: "order shipped",
			weight: 1,
			isStrictEvent: true,
			properties: { listing_id: ["l_unassigned"], category: ["fashion"], order_id: ["o_unassigned"], shipping_carrier: ["usps"], days_to_ship: [1] },
		},
		{
			event: "order delivered",
			weight: 1,
			isStrictEvent: true,
			properties: { listing_id: ["l_unassigned"], category: ["fashion"], order_id: ["o_unassigned"], shipping_carrier: ["usps"], delivery_days: [4] },
		},
		{
			event: "review submitted",
			weight: 1,
			isStrictEvent: true,
			properties: { listing_id: ["l_unassigned"], category: ["fashion"], order_id: ["o_unassigned"], rating: [5], has_photo: [false] },
		},
		{
			event: "dispute opened",
			weight: 1,
			isStrictEvent: true,
			properties: { listing_id: ["l_unassigned"], category: ["fashion"], order_id: ["o_unassigned"], dispute_reason: ["not_as_described"], item_price: [30] },
		},
		{
			event: "listing created",
			weight: 1,
			isStrictEvent: true,
			properties: { listing_id: ["l_unassigned"], category: ["fashion"], asking_price: [30], condition: ["good"], photo_count: [4], package_size: ["small"] },
		},
		{
			event: "listing price dropped",
			weight: 1,
			isStrictEvent: true,
			properties: { listing_id: ["l_unassigned"], category: ["fashion"], old_price: [30], new_price: [27], drop_pct: [10], days_since_listed: [5] },
		},
		{
			event: "item sold",
			weight: 1,
			isStrictEvent: true,
			properties: { listing_id: ["l_unassigned"], category: ["fashion"], sale_price: [30], days_to_sell: [6], sale_type: ["buy_now"] },
		},
		{
			event: "shipping label printed",
			weight: 1,
			isStrictEvent: true,
			properties: { listing_id: ["l_unassigned"], category: ["fashion"], shipping_carrier: ["usps"], days_to_ship: [1] },
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
	],

	funnels: [
		{
			// guests browse a few listings, then sign up
			name: "Signup",
			sequence: ["home feed viewed", "listing viewed", "listing viewed", "account created", "search performed", "listing viewed"],
			isFirstFunnel: true,
			conversionRate: 100,
			timeToConvert: 0.5,
			order: "sequential",
			weight: 1,
		},
		{
			// a browsing session
			name: "Browse",
			sequence: ["home feed viewed", "search performed", "listing viewed", "listing viewed", "item saved", "listing viewed", "listing viewed"],
			conversionRate: 65,
			timeToConvert: 0.4,
			order: "first-fixed",
			weight: 12,
		},
		{
			// buy now (the hook decides checkout, payment, and the order's life)
			name: "Buy Now",
			sequence: BUY_STEPS,
			conversionRate: 100,
			timeToConvert: 1,
			order: "sequential",
			weight: 6,
			props: { listing_id: () => `l_${chance.hash({ length: 10 })}` },
			experiment: {
				name: EXPRESS_EXPERIMENT,
				startDaysBeforeEnd: (ms(DATASET_END) - ms(EXPRESS_START)) / DAY_MS,
				variants: [{ name: "Control" }, { name: EXPRESS_VARIANT }],
			},
		},
		{
			// make an offer (the hook decides the seller's answer)
			name: "Offer",
			sequence: OFFER_STEPS,
			conversionRate: 100,
			timeToConvert: 1,
			order: "sequential",
			weight: 4,
			props: { listing_id: () => `l_${chance.hash({ length: 10 })}` },
		},
		{
			name: "Listing (casual)",
			sequence: LIST_STEPS,
			conditions: { account_type: "seller" },
			conversionRate: 100,
			timeToConvert: 1,
			order: "sequential",
			weight: 10,
			props: { listing_id: () => `l_${chance.hash({ length: 10 })}` },
		},
		{
			name: "Listing (pro)",
			sequence: LIST_STEPS,
			conditions: { account_type: "pro_seller" },
			conversionRate: 100,
			timeToConvert: 1,
			order: "sequential",
			weight: 75,
			props: { listing_id: () => `l_${chance.hash({ length: 10 })}` },
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
				clicks: 0,
				impressions: 0,
			},
		},
		{
			name: "payment_processing_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "purchase completed",
				measure: "count",
				groupBy: "payment_method",
			},
			timeColumn: "date",
			valueColumn: "authorizations_approved",
			columns: {
				authorizations_attempted: 0,
				approval_rate: (ctx) => {
					const j = hashFloat(`appr|${dayKey(ctx.time)}|${ctx.seriesKey}`);
					const normal = 0.955 + j * 0.025;
					return ctx.row.payment_method === "card" && inCardIncident(ctx.time) ? Math.round(normal * (1 - CARD_FAIL) * 10000) / 10000 : Math.round(normal * 10000) / 10000;
				},
				p95_auth_latency_ms: (ctx) => {
					const j = hashFloat(`lat|${dayKey(ctx.time)}|${ctx.seriesKey}`);
					return ctx.row.payment_method === "card" && inCardIncident(ctx.time) ? Math.round(6500 + j * 4000) : Math.round(620 + j * 380);
				},
				processor_status: (ctx) => (ctx.row.payment_method === "card" && inCardIncident(ctx.time) ? "degraded" : "operational"),
			},
		},
		{
			name: "marketplace_ledger_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "purchase completed",
				measure: "sum",
				property: "item_price",
				groupBy: "seller_type",
			},
			timeColumn: "date",
			valueColumn: "gmv_usd",
			columns: {
				orders: 0,
				take_rate: (ctx) => takeRate(ctx.row.seller_type, ctx.time),
				fee_revenue_usd: 0,
				refunds_usd: 0,
			},
		},
	],

	superProps: {
		platform: ["ios"],
		region: ["south"],
	},

	userProps: {
		account_type: ["buyer"],
		acquisition_channel: { __weights: CHANNEL_WEIGHTS },
		region: { __weights: { south: 36, west: 24, midwest: 20, northeast: 20 } },
		age_band: { __weights: { "18-24": 20, "25-34": 34, "35-44": 24, "45-54": 13, "55+": 9 } },
		member_since: ["2025-01-01"],
	},

	personas: [
		{ name: "browser", weight: 38, eventMultiplier: 0.6, properties: { account_type: "buyer" } },
		{ name: "regular_buyer", weight: 32, eventMultiplier: 1.3, properties: { account_type: "buyer" } },
		{ name: "casual_seller", weight: 22, eventMultiplier: 1.0, properties: { account_type: "seller" } },
		{ name: "pro_seller", weight: 8, eventMultiplier: 2.6, properties: { account_type: "pro_seller" } },
	],

	retentionCurve: { type: "logarithmic", day1: 0.75, day7: 0.55, day30: 0.4 },

	hook(record, type, meta) {
		if (type === "user") return handleUserHook(record, meta);
		if (type === "everything") return handleEverything(record, meta);
		if (type === "warehouse") return handleWarehouse(record, meta);
		return record;
	},
};

// ── STORIES ──────────────────────────────────────────────────────────────
// Machine-checkable contract for hooks H1-H10. Evaluate with:
//   node dungeons/vertical/marketplace/marketplace.verify.mjs

const EV = `read_json_auto('{{PREFIX}}-EVENTS*.json*', sample_size=-1, union_by_name=true)`;
const US = `read_json_auto('{{PREFIX}}-USERS*.json*', sample_size=-1, union_by_name=true)`;
const WH = (table) => `read_json_auto('{{PREFIX}}-WAREHOUSE-${table}.json*', sample_size=-1, union_by_name=true)`;

// Identity prelude: guests browse before signing up (device_id only); "account
// created" carries both ids, so every device resolves to its member the way
// Mixpanel stitches. Guests who never finished signing up stay anonymous
// (resolved to their device). Server-side events carry user_id only.
const ID_CTE = `dmap AS (SELECT device_id, min(user_id::VARCHAR) AS mapped FROM ${EV}
  WHERE user_id IS NOT NULL AND device_id IS NOT NULL GROUP BY 1),
ev AS (SELECT coalesce(e.user_id::VARCHAR, m.mapped, '$device:' || e.device_id) AS uid, e.time::TIMESTAMP AS t, e.*
  FROM ${EV} e LEFT JOIN dmap m ON e.device_id = m.device_id)`;

const TS = (isoStr) => dayjs.utc(isoStr).format("YYYY-MM-DD HH:mm:ss");
const D = (isoStr) => isoStr.slice(0, 10);
const D0 = D(DATASET_START);
const band = (k) => [Math.round(k * 0.9 * 1000) / 1000, Math.round(k * 1.1 * 1000) / 1000];
const SQL_LIST = (xs) => xs.map((x) => `'${x}'`).join(", ");
const r3 = (n) => Math.round(n * 1000) / 1000;
const SUPPLY_RAMPED = TS(dayjs.utc(FEE_CHANGE).add(SUPPLY_RAMP_DAYS, "day").toISOString());
const CHECKOUT_WINDOW_DAYS = 1;      // H2/H6/H8 read: checkout started → purchase completed within 1 day (hold order_id)
const CHECKOUT_READ_END = TS(dayjs.utc(DATASET_END).subtract(CHECKOUT_WINDOW_DAYS, "day").toISOString());
const OFFER_WINDOW_DAYS = 2;         // H3 read: offer made → offer accepted within 2 days (hold offer_id)
const OFFER_READ_END = TS(dayjs.utc(DATASET_END).subtract(OFFER_WINDOW_DAYS, "day").toISOString());
const OFFER_SPLIT = 80;              // H3 read: offers at 80%+ of asking vs below 80%
const SELL_WINDOW_DAYS = 30;         // H4/H9 read: listing created → item sold within 30 days (hold listing_id)
const SELL_READ_END = "2026-09-01 00:00:00"; // listings through Aug 31 have their full 30 days
const RET_DAYS = 30;                 // H5 read: purchase completed within 30 days after the first delivery
const RET_BIRTH_END = TS(dayjs.utc(DATASET_END).subtract(RET_DAYS, "day").toISOString());
const INC_BASE_DAYS = 14;            // H6 read: baseline days either side of the incident
const INC_BASE_FROM = TS(dayjs.utc(CARD_INCIDENT_START).subtract(INC_BASE_DAYS, "day").toISOString());
const INC_BASE_TO = TS(dayjs.utc(CARD_INCIDENT_END).add(INC_BASE_DAYS, "day").toISOString());
const ACT_READ_END = TS(dayjs.utc(DATASET_END).subtract(ACTIVATION_DAYS, "day").toISOString());
const BASE_CATS = Object.keys(CAT_SELL_TTC).filter((c) => CAT_SELL_TTC[c] === 1);
const photoBand = (col) => `CASE WHEN ${col} <= 2 THEN '1-2' WHEN ${col} <= 4 THEN '3-4' ELSE '5+' END`;

// H3 target: the acceptance curve integrated over the offer distribution
// (each buyer's habit uniform within ±${OFFER_HABIT_SD} sd of ${OFFER_HABIT_MEAN}%, offers normal sd ${OFFER_SD} around it,
// rounded and clamped to 40-100), split at OFFER_SPLIT
const OFFER_RATES = (() => {
	const acc = { lo: [0, 0], hi: [0, 0], lt70: [0, 0], ge85: [0, 0] };
	const NU = 200, NZ = 2000, half = OFFER_HABIT_SD * 1.73;
	for (let i = 0; i < NU; i++) {
		const habit = OFFER_HABIT_MEAN - half + 2 * half * (i + 0.5) / NU;
		for (let j = 0; j < NZ; j++) {
			const z = -6 + 12 * (j + 0.5) / NZ;
			const w = Math.exp(-z * z / 2);
			const pct = Math.max(40, Math.min(100, Math.round(habit + OFFER_SD * z)));
			const a = acceptProb(pct);
			const k = pct >= OFFER_SPLIT ? "hi" : "lo";
			acc[k][0] += w; acc[k][1] += w * a;
			if (pct < OFFER_LOW_MAX) { acc.lt70[0] += w; acc.lt70[1] += w * a; }
			if (pct >= OFFER_HIGH_MIN) { acc.ge85[0] += w; acc.ge85[1] += w * a; }
		}
	}
	return Object.fromEntries(Object.entries(acc).map(([k, [n, s]]) => [k, s / n]));
})();
const OFFER_RATIO = r3(OFFER_RATES.hi / OFFER_RATES.lo);
// H10 target: electronics share of listing views, Back to Campus vs before
const ELEC_W = CATEGORY_WEIGHTS.electronics / Object.values(CATEGORY_WEIGHTS).reduce((a, b) => a + b, 0);
const BTS_SHARE_RATIO = r3((BTS_ELECTRONICS_MULT * ELEC_W / (BTS_ELECTRONICS_MULT * ELEC_W + 1 - ELEC_W)) / ELEC_W);
const TAKE_RATE_RATIO = r3(TAKE_RATE.casual[1] / TAKE_RATE.casual[0]);
const SPEND_PER_SIGNUP_RATIO = r3(CPI_USD.google_shopping / CPI_USD.tiktok_ads);
const ACTIVATION_RATIO = r3(ACTIVATE.google_shopping / ACTIVATE.tiktok_ads);
const SPEND_PER_ACTIVATED_RATIO = r3(SPEND_PER_SIGNUP_RATIO / ACTIVATION_RATIO);

const FEE_DAYS_BEFORE = (ms(FEE_CHANGE) - ms(DATASET_START)) / DAY_MS;
const FEE_DAYS_AFTER = Math.round((ms(DATASET_END) - ms(FEE_CHANGE)) / DAY_MS);
const H1_LISTING_SQL = `WITH ${ID_CTE},
u AS (SELECT distinct_id::VARCHAR AS uid, account_type FROM ${US} WHERE member_since < '${D0}' AND account_type IN ('seller', 'pro_seller')),
w AS (SELECT u.account_type, ev.t >= TIMESTAMP '${TS(FEE_CHANGE)}' AS aft, ev.uid FROM ev JOIN u ON u.uid = ev.uid WHERE ev.event = 'listing created'),
g AS (SELECT account_type, aft, count(DISTINCT uid) AS users, count(*) / (CASE WHEN aft THEN ${FEE_DAYS_AFTER} ELSE ${FEE_DAYS_BEFORE} END) AS per_day FROM w GROUP BY 1, 2)
SELECT 'all' AS grp, min(users) AS user_count,
 (max(per_day) FILTER (WHERE account_type = 'seller' AND aft) / max(per_day) FILTER (WHERE account_type = 'seller' AND NOT aft))
 / (max(per_day) FILTER (WHERE account_type = 'pro_seller' AND aft) / max(per_day) FILTER (WHERE account_type = 'pro_seller' AND NOT aft)) AS did
FROM g`;

const CHECKOUT_CTE = `c AS (SELECT order_id, any_value(uid) AS uid,
  min(t) FILTER (WHERE event = 'checkout started') AS t0, min(t) FILTER (WHERE event = 'purchase completed') AS t1,
  any_value(item_price) FILTER (WHERE event = 'checkout started') AS price,
  any_value(payment_method) FILTER (WHERE event = 'checkout started') AS pm
  FROM ev WHERE event IN ('checkout started', 'purchase completed') GROUP BY 1),
cc AS (SELECT *, coalesce(t1 >= t0 AND t1 < t0 + INTERVAL ${CHECKOUT_WINDOW_DAYS} DAY, false) AS done FROM c WHERE t0 IS NOT NULL AND t0 < TIMESTAMP '${CHECKOUT_READ_END}')`;

const H2_SQL = `WITH ${ID_CTE}, ${CHECKOUT_CTE},
v AS (SELECT distinct_id::VARCHAR AS uid, "${EXP_KEY}" AS variant FROM ${US} WHERE "${EXP_KEY}" IS NOT NULL)
SELECT v.variant AS grp, count(DISTINCT cc.uid) AS user_count, count(*) AS checkouts, avg(done::INT) AS conv,
 median(date_diff('second', t0, t1)) FILTER (WHERE done) / 60.0 AS med_minutes
FROM cc JOIN v ON v.uid = cc.uid WHERE t0 >= TIMESTAMP '${TS(EXPRESS_START)}' GROUP BY 1`;

const H4_SQL = `WITH ${ID_CTE},
l AS (SELECT listing_id, any_value(uid) AS uid, min(t) FILTER (WHERE event = 'listing created') AS t0, min(t) FILTER (WHERE event = 'item sold') AS t1,
  any_value(photo_count) FILTER (WHERE event = 'listing created') AS photos, any_value(category) AS category
  FROM ev WHERE event IN ('listing created', 'item sold') GROUP BY 1)
SELECT ${photoBand("photos")} AS grp, count(DISTINCT uid) AS user_count, count(*) AS listings,
 avg(coalesce(t1 >= t0 AND t1 < t0 + INTERVAL ${SELL_WINDOW_DAYS} DAY, false)::INT) AS sell_through
FROM l WHERE t0 IS NOT NULL AND t0 < TIMESTAMP '${SELL_READ_END}' GROUP BY 1`;

const H6_SQL = `WITH ${ID_CTE}, ${CHECKOUT_CTE},
o AS (SELECT DISTINCT date::DATE AS d, payment_method FROM ${WH("payment_processing_daily")} WHERE processor_status = 'degraded'),
od AS (SELECT DISTINCT d FROM o), op AS (SELECT DISTINCT payment_method FROM o),
w AS (SELECT t0::DATE AS d, uid, (pm IN (SELECT payment_method FROM op)) AS hit, done FROM cc
  WHERE t0 >= TIMESTAMP '${INC_BASE_FROM}' AND t0 < TIMESTAMP '${INC_BASE_TO}'),
g AS (SELECT (d IN (SELECT d FROM od)) AS outage, hit, avg(done::INT) AS conv, count(DISTINCT uid) AS users FROM w GROUP BY 1, 2)
SELECT 'all' AS grp, (SELECT count(*) FROM od) AS outage_days, min(users) AS user_count,
 (max(conv) FILTER (WHERE outage AND hit) / max(conv) FILTER (WHERE NOT outage AND hit))
 / (max(conv) FILTER (WHERE outage AND NOT hit) / max(conv) FILTER (WHERE NOT outage AND NOT hit)) AS did
FROM g`;

const H7_SQL = `WITH ${ID_CTE},
s AS (SELECT uid, t AS t0, acquisition_channel AS ch FROM ev WHERE event = 'account created'),
a AS (SELECT s.uid, s.ch, s.t0, coalesce(bool_or(e.t >= s.t0 AND e.t < s.t0 + INTERVAL ${ACTIVATION_DAYS} DAY), false) AS act
  FROM s LEFT JOIN ev e ON e.uid = s.uid AND e.event = 'purchase completed' GROUP BY 1, 2, 3),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM ${WH("marketing_spend_daily")} GROUP BY 1),
g AS (SELECT ch, count(*) AS signups, avg(act::INT) FILTER (WHERE t0 < TIMESTAMP '${ACT_READ_END}') AS activation FROM a GROUP BY 1)
SELECT g.ch AS grp, g.signups AS user_count, g.activation, sp.spend / g.signups AS spend_per_signup,
 sp.spend / g.signups / g.activation AS spend_per_activated
FROM g LEFT JOIN sp ON sp.ch = g.ch`;

const H9_SQL = `WITH ${ID_CTE},
l AS (SELECT listing_id, any_value(uid) AS uid, min(t) FILTER (WHERE event = 'listing created') AS t0, min(t) FILTER (WHERE event = 'item sold') AS t1,
  any_value(category) AS category FROM ev WHERE event IN ('listing created', 'item sold') GROUP BY 1),
x AS (SELECT category, uid, date_diff('second', t0, t1) / 86400.0 AS days FROM l
  WHERE t0 IS NOT NULL AND t0 < TIMESTAMP '${SELL_READ_END}' AND t1 >= t0 AND t1 < t0 + INTERVAL ${SELL_WINDOW_DAYS} DAY)
SELECT category AS grp, count(DISTINCT uid) AS user_count, count(*) AS sales, median(days) AS med_days FROM x GROUP BY 1
UNION ALL
SELECT 'baseline' AS grp, count(DISTINCT uid) AS user_count, count(*) AS sales, median(days) AS med_days FROM x WHERE category IN (${SQL_LIST(BASE_CATS)})`;

/** @type {import("../../../types").DungeonStory[]} */
export const stories = [
	{
		id: "H1-seller-fee-change",
		hook: "H1",
		archetype: "temporal-inflection",
		narrative: `On ${D(FEE_CHANGE)} the selling fee for casual sellers rises from ${TAKE_RATE.casual[0] * 100}% to ${TAKE_RATE.casual[1] * 100}% of the sale price; Tradepost Pro sellers keep their ${TAKE_RATE.pro[0] * 100}% fee (they pay a monthly subscription). Casual sellers create ${CASUAL_LISTING_KEEP}x as many listings afterwards (whole listings are never created: no price drops, sales, or labels). Read: listings per day from sellers who joined before ${D0} (a fixed group; sellers who join in the window add listings as they arrive), casual after/before over Pro after/before; the engine's own listing timing moves each group a few percent, so the read uses the knob as target with a half-effect floor. Buyers see the supply shift: the casual:Pro mix of listings viewed falls to ${CASUAL_LISTING_KEEP}x of its before-change odds once the casual inventory has drained (${SUPPLY_RAMP_DAYS}-day ramp; from ${D(SUPPLY_RAMPED)}). The fee schedule itself exists only in warehouse marketplace_ledger_daily (take_rate).`,
		mixpanelReport: { type: "Insights + warehouse", event: "listing created", measure: "total, daily average", filter: `user member_since before ${D0}`, breakdown: "user account_type", chart: `${D0} to ${D(FEE_CHANGE)} vs ${D(FEE_CHANGE)} to ${D(DATASET_END)}`, join: "marketplace_ledger_daily.take_rate by seller_type" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H1_LISTING_SQL },
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.did", op: "<=", target: CASUAL_LISTING_KEEP, floor: 1 - 0.5 * (1 - CASUAL_LISTING_KEEP) },
				minCohort: 300,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
w AS (SELECT uid, seller_type, t < TIMESTAMP '${TS(FEE_CHANGE)}' AS bef, t >= TIMESTAMP '${SUPPLY_RAMPED}' AS aft FROM ev WHERE event = 'listing viewed')
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 (count(*) FILTER (WHERE aft AND seller_type = 'casual')::DOUBLE / count(*) FILTER (WHERE aft AND seller_type = 'pro'))
 / (count(*) FILTER (WHERE bef AND seller_type = 'casual')::DOUBLE / count(*) FILTER (WHERE bef AND seller_type = 'pro')) AS odds_ratio
FROM w`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.odds_ratio", op: "between", target: band(CASUAL_LISTING_KEEP) },
				minCohort: 2000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT 'all' AS grp,
 avg(take_rate) FILTER (WHERE seller_type = 'casual' AND date::DATE >= DATE '${D(FEE_CHANGE)}') / avg(take_rate) FILTER (WHERE seller_type = 'casual' AND date::DATE < DATE '${D(FEE_CHANGE)}') AS casual_ratio,
 avg(take_rate) FILTER (WHERE seller_type = 'pro' AND date::DATE >= DATE '${D(FEE_CHANGE)}') / avg(take_rate) FILTER (WHERE seller_type = 'pro' AND date::DATE < DATE '${D(FEE_CHANGE)}') AS pro_ratio
FROM ${WH("marketplace_ledger_daily")}`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.casual_ratio", op: "between", target: band(TAKE_RATE_RATIO) },
			},
		],
	},
	{
		id: "H2-express-checkout-experiment",
		hook: "H2",
		archetype: "experiment-lift",
		narrative: `The "${EXPRESS_EXPERIMENT}" test starts ${D(EXPRESS_START)}: members who start a checkout are split 50/50 (sticky per member; $experiment_started 1 s before each checkout). The variant (saved payment and address, one confirm tap) completes ${EXPRESS_CONV_MULT}x as many checkouts and halves the time from "checkout started" to "purchase completed" (${EXPRESS_TIME_MULT}x, base median ${CHECKOUT_MEDIAN_MIN} min). Read: per checkout (order_id), purchase within ${CHECKOUT_WINDOW_DAYS} day, checkouts ${D(EXPRESS_START)} to ${CHECKOUT_READ_END.slice(0, 10)}, by the profile's experiment arm. The arms share every other factor (Guarantee, card incident, price mix), so the ratio reads the knob.`,
		mixpanelReport: { type: "Funnels", steps: ["checkout started", "purchase completed"], counting: "totals", holdPropertyConstant: "order_id", window: `${CHECKOUT_WINDOW_DAYS} day`, dateRange: `${D(EXPRESS_START)} to ${CHECKOUT_READ_END.slice(0, 10)}`, breakdown: `user property "${EXP_KEY}"`, measure: "conversion and median time to convert" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H2_SQL },
				select: { v: { where: { grp: EXPRESS_VARIANT } }, c: { where: { grp: "Control" } } },
				expect: { metric: "v.conv / c.conv", op: "between", target: band(EXPRESS_CONV_MULT) },
				minCohort: 1500,
			},
			{
				breakdown: { type: "duckdb", sql: H2_SQL },
				select: { v: { where: { grp: EXPRESS_VARIANT } }, c: { where: { grp: "Control" } } },
				expect: { metric: "v.med_minutes / c.med_minutes", op: "between", target: band(EXPRESS_TIME_MULT) },
				minCohort: 1500,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 count(DISTINCT uid) FILTER (WHERE "Variant name" = '${EXPRESS_VARIANT}')::DOUBLE / count(DISTINCT uid) AS variant_share
FROM ev WHERE event = '$experiment_started'`,
				},
				select: { a: { where: { grp: "all" } } },
				// equal-weight 2-arm hash → 0.5
				expect: { metric: "a.variant_share", op: "between", target: band(0.5) },
				minCohort: 2000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
v AS (SELECT distinct_id::VARCHAR AS uid, "${EXP_KEY}" AS variant FROM ${US})
SELECT 'all' AS grp, count(DISTINCT ev.uid) AS user_count,
 count(*) FILTER (WHERE t < TIMESTAMP '${TS(EXPRESS_START)}' OR v.variant IS DISTINCT FROM ev."Variant name") AS impure
FROM ev LEFT JOIN v ON v.uid = ev.uid WHERE event = '$experiment_started'`,
				},
				select: { a: { where: { grp: "all" } } },
				// exact: no exposure before the start; every exposure matches the profile arm
				expect: { metric: "a.impure", op: "between", target: [0, 0] },
			},
		],
	},
	{
		id: "H3-offer-price-threshold",
		hook: "H3",
		archetype: "funnel-conversion-by-segment",
		narrative: `Sellers accept offers on a steep curve in offer_pct_of_ask (the offer as a % of the asking price): logistic from ${ACCEPT_FLOOR * 100}% to ${ACCEPT_CEIL * 100}% acceptance, midpoint ${ACCEPT_CENTER}%, scale ${ACCEPT_SCALE} points. Buyers each have an offer habit (salted around ${OFFER_HABIT_MEAN}%). Integrated over the offer distribution, offers at ${OFFER_SPLIT}%+ of ask are accepted ${(OFFER_RATES.hi * 100).toFixed(1)}% of the time vs ${(OFFER_RATES.lo * 100).toFixed(1)}% below ${OFFER_SPLIT}% (${OFFER_RATIO}x); under ${OFFER_LOW_MAX}% only ${(OFFER_RATES.lt70 * 100).toFixed(1)}% are accepted vs ${(OFFER_RATES.ge85 * 100).toFixed(1)}% at ${OFFER_HIGH_MIN}%+. Read: per offer (offer_id), offer accepted within ${OFFER_WINDOW_DAYS} days, offers made through ${OFFER_READ_END.slice(0, 10)}.`,
		mixpanelReport: { type: "Funnels", steps: ["offer made", "offer accepted"], counting: "totals", holdPropertyConstant: "offer_id", window: `${OFFER_WINDOW_DAYS} days`, breakdown: `offer_pct_of_ask (custom buckets < ${OFFER_SPLIT}, >= ${OFFER_SPLIT})` },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
o AS (SELECT offer_id, any_value(uid) AS uid, min(t) FILTER (WHERE event = 'offer made') AS t0,
  any_value(offer_pct_of_ask) FILTER (WHERE event = 'offer made') AS pct,
  min(t) FILTER (WHERE event = 'offer accepted') AS t1
  FROM ev WHERE event IN ('offer made', 'offer accepted') GROUP BY 1)
SELECT CASE WHEN pct >= ${OFFER_SPLIT} THEN 'high' ELSE 'low' END AS grp, count(DISTINCT uid) AS user_count, count(*) AS offers,
 avg(coalesce(t1 >= t0 AND t1 < t0 + INTERVAL ${OFFER_WINDOW_DAYS} DAY, false)::INT) AS accept_rate
FROM o WHERE t0 IS NOT NULL AND t0 < TIMESTAMP '${OFFER_READ_END}' GROUP BY 1`,
				},
				select: { h: { where: { grp: "high" } }, l: { where: { grp: "low" } } },
				expect: { metric: "h.accept_rate / l.accept_rate", op: "between", target: band(OFFER_RATIO) },
				minCohort: 1500,
			},
		],
	},
	{
		id: "H4-photos-sell-through",
		hook: "H4",
		archetype: "funnel-conversion-by-segment",
		narrative: `Listings with more photos sell. The share of listings that sell scales with photo_count: 1-2 photos ${PHOTO_SELL_KEEP(1)}x, 3-4 photos ${PHOTO_SELL_KEEP(3)}x of listings with 5+ photos (${SELL_BASE * 100}% of which sell). Photo counts follow each seller's habit (Pro sellers shoot more photos) but nothing else about a listing depends on them, and time to sell does not, so sell-through within ${SELL_WINDOW_DAYS} days by photo band reads the multiplier. Read: per listing (listing_id), item sold within ${SELL_WINDOW_DAYS} days, listings created ${D0} to ${SELL_READ_END.slice(0, 10)}.`,
		mixpanelReport: { type: "Funnels", steps: ["listing created", "item sold"], counting: "totals", holdPropertyConstant: "listing_id", window: `${SELL_WINDOW_DAYS} days`, dateRange: `${D0} to 2026-08-31`, breakdown: "photo_count (custom buckets 1-2, 3-4, 5+)" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H4_SQL },
				select: { lo: { where: { grp: "1-2" } }, hi: { where: { grp: "5+" } } },
				expect: { metric: "lo.sell_through / hi.sell_through", op: "between", target: band(PHOTO_SELL_KEEP(1)) },
				minCohort: 300,
			},
			{
				breakdown: { type: "duckdb", sql: H4_SQL },
				select: { mid: { where: { grp: "3-4" } }, hi: { where: { grp: "5+" } } },
				expect: { metric: "mid.sell_through / hi.sell_through", op: "between", target: band(PHOTO_SELL_KEEP(3)) },
				minCohort: 300,
			},
		],
	},
	{
		id: "H5-late-first-delivery",
		hook: "H5",
		archetype: "retention-divergence",
		narrative: `A late first delivery costs Tradepost a buyer. When a buyer's first order delivered in the window took more than ${LATE_DAYS} days from purchase (delivery_days on "order delivered"), the buyer stops buying with probability ${TRUST_LOSS} (they keep browsing). Lateness comes from the seller's shipping speed and the carrier, not from the buyer. Read: buyers grouped by delivery_days on their first "order delivered" (on or before ${RET_BIRTH_END.slice(0, 10)}); retained = any "purchase completed" within ${RET_DAYS} days after it. Ratio late / on-time reads 1 - ${TRUST_LOSS}.`,
		mixpanelReport: { type: "Retention", birth: "order delivered (first time)", return: "purchase completed", breakdown: `birth-event property delivery_days (custom buckets <= ${LATE_DAYS}, > ${LATE_DAYS})`, brackets: `custom: day 0-${RET_DAYS - 1}`, dateRange: `births ${D0} to ${RET_BIRTH_END.slice(0, 10)}` },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
f AS (SELECT uid, t AS f0, delivery_days, row_number() OVER (PARTITION BY uid ORDER BY t, insert_id) AS rn FROM ev WHERE event = 'order delivered'),
f1 AS (SELECT * FROM f WHERE rn = 1 AND f0 <= TIMESTAMP '${RET_BIRTH_END}'),
r AS (SELECT f1.uid, bool_or(e.t > f1.f0 AND e.t <= f1.f0 + INTERVAL ${RET_DAYS} DAY) AS ret
  FROM f1 LEFT JOIN ev e ON e.uid = f1.uid AND e.event = 'purchase completed' GROUP BY 1)
SELECT CASE WHEN f1.delivery_days > ${LATE_DAYS} THEN 'late' ELSE 'on_time' END AS grp, count(*) AS user_count, avg(coalesce(r.ret, false)::INT) AS retention
FROM f1 JOIN r ON r.uid = f1.uid GROUP BY 1`,
				},
				select: { l: { where: { grp: "late" } }, o: { where: { grp: "on_time" } } },
				expect: { metric: "l.retention / o.retention", op: "between", target: band(1 - TRUST_LOSS) },
				minCohort: 500,
			},
		],
	},
	{
		id: "H6-card-processor-incident",
		hook: "H6",
		archetype: "bespoke",
		narrative: `From ${D(CARD_INCIDENT_START)} to ${D(CARD_INCIDENT_END)} (exclusive) Tradepost's card processor degrades: ${CARD_FAIL * 100}% of card checkouts fail at payment and never reach "purchase completed". Apple Pay, Google Pay, and PayPal run on other rails and are untouched. The incident days and the affected method come from warehouse payment_processing_daily (processor_status = 'degraded', approval_rate ≈ ${1 - CARD_FAIL} of normal). Event read: checkout completion for card over other methods on incident days vs the ${INC_BASE_DAYS} days either side reads 1 - ${CARD_FAIL}.`,
		mixpanelReport: { type: "Funnels + warehouse", steps: ["checkout started", "purchase completed"], counting: "totals", holdPropertyConstant: "order_id", window: `${CHECKOUT_WINDOW_DAYS} day`, breakdown: "payment_method", chart: "daily trend", join: "payment_processing_daily.processor_status" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H6_SQL },
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.did", op: "between", target: band(1 - CARD_FAIL) },
				minCohort: 500,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT 'all' AS grp, count(*) FILTER (WHERE processor_status = 'degraded') AS degraded_rows,
 avg(approval_rate) FILTER (WHERE processor_status = 'degraded') / avg(approval_rate) FILTER (WHERE processor_status = 'operational' AND payment_method = 'card') AS approval_ratio
FROM ${WH("payment_processing_daily")}`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.approval_ratio", op: "between", target: band(1 - CARD_FAIL) },
			},
		],
	},
	{
		id: "H7-paid-channel-activation",
		hook: "H7",
		archetype: "funnel-conversion-by-segment",
		narrative: `Paid channels differ in what a new member is worth. Warehouse marketing_spend_daily bills each channel half as a paced daily budget and half as a bid on the signups it delivered that day, with seeded day noise: about $${CPI_USD.google_shopping} Google Shopping, $${CPI_USD.meta_ads} Meta, $${CPI_USD.tiktok_ads} TikTok per Mixpanel signup. New buyers activate (first purchase within ${ACTIVATION_DAYS} days of "account created") by channel: a share of ${ACTIVATE.google_shopping} Google Shopping, ${ACTIVATE.meta_ads} Meta, ${ACTIVATE.tiktok_ads} TikTok, ${ACTIVATE.organic} organic, ${ACTIVATE.referral} referral can activate; the rest buy nothing in their first ${ACTIVATION_DAYS} days. Activation needs a buy-now visit, which about three in four new members have, the same in every channel, so the activation ratio Google/TikTok reads ${ACTIVATION_RATIO}. Google costs ${SPEND_PER_SIGNUP_RATIO}x TikTok per signup but ${SPEND_PER_ACTIVATED_RATIO}x per activated buyer. Read: signups through ${ACT_READ_END.slice(0, 10)} (full ${ACTIVATION_DAYS} days) for activation; window spend over window signups for cost per signup.`,
		mixpanelReport: { type: "Funnels + warehouse", steps: ["account created", "purchase completed"], window: `${ACTIVATION_DAYS} days`, breakdown: "acquisition_channel", dateRange: `${D0} to ${ACT_READ_END.slice(0, 10)}`, join: "marketing_spend_daily.spend_usd by acquisition_channel" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H7_SQL },
				select: { g: { where: { grp: "google_shopping" } }, t: { where: { grp: "tiktok_ads" } } },
				expect: { metric: "g.spend_per_signup / t.spend_per_signup", op: "between", target: band(SPEND_PER_SIGNUP_RATIO) },
				minCohort: 400,
			},
			{
				breakdown: { type: "duckdb", sql: H7_SQL },
				select: { g: { where: { grp: "google_shopping" } }, t: { where: { grp: "tiktok_ads" } } },
				expect: { metric: "g.activation / t.activation", op: "between", target: band(ACTIVATION_RATIO) },
				minCohort: 400,
			},
			{
				breakdown: { type: "duckdb", sql: H7_SQL },
				select: { g: { where: { grp: "google_shopping" } }, t: { where: { grp: "tiktok_ads" } } },
				expect: { metric: "g.spend_per_activated / t.spend_per_activated", op: "between", target: band(SPEND_PER_ACTIVATED_RATIO) },
				minCohort: 400,
			},
		],
	},
	{
		id: "H8-guarantee-launch",
		hook: "H8",
		archetype: "temporal-inflection",
		narrative: `Before the Tradepost Guarantee, buyers hesitate on expensive items: checkouts of $${HIGH_TICKET_USD}+ items complete at ${HIGH_TICKET_BEFORE}x the rate of cheaper ones. On ${D(GUARANTEE_LAUNCH)} the Guarantee (refund if an item is not as described or never arrives) launches for every order, and high-ticket checkouts complete ${GUARANTEE_MULT}x as often as before, level with cheaper items; low-ticket completion does not change. Read: per checkout (order_id), purchase within ${CHECKOUT_WINDOW_DAYS} day, item_price on the checkout >= $${HIGH_TICKET_USD} vs below, after/before the launch (difference in differences; the Express Checkout split and the card incident hit both price bands alike).`,
		mixpanelReport: { type: "Funnels", steps: ["checkout started", "purchase completed"], counting: "totals", holdPropertyConstant: "order_id", window: `${CHECKOUT_WINDOW_DAYS} day`, breakdown: `item_price (custom buckets < ${HIGH_TICKET_USD}, >= ${HIGH_TICKET_USD})`, chart: `before vs after ${D(GUARANTEE_LAUNCH)}` },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${CHECKOUT_CTE},
g AS (SELECT price >= ${HIGH_TICKET_USD} AS hi, t0 >= TIMESTAMP '${TS(GUARANTEE_LAUNCH)}' AS aft, avg(done::INT) AS conv, count(DISTINCT uid) AS users FROM cc GROUP BY 1, 2)
SELECT 'all' AS grp, min(users) AS user_count,
 (max(conv) FILTER (WHERE hi AND aft) / max(conv) FILTER (WHERE hi AND NOT aft))
 / (max(conv) FILTER (WHERE NOT hi AND aft) / max(conv) FILTER (WHERE NOT hi AND NOT aft)) AS did
FROM g`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.did", op: "between", target: band(GUARANTEE_MULT) },
				minCohort: 1000,
			},
		],
	},
	{
		id: "H9-time-to-sell-by-category",
		hook: "H9",
		archetype: "funnel-ttc-by-segment",
		narrative: `How fast a listing sells depends on its category: days from "listing created" to "item sold" are log-normal (base median ${SELL_DAYS_MEDIAN} days for fashion, toys & games, and sports & outdoors) times ${CAT_SELL_TTC.electronics} for electronics, ${CAT_SELL_TTC.sneakers} for sneakers, ${CAT_SELL_TTC.home_decor} for home decor, and ${CAT_SELL_TTC.collectibles} for collectibles. Read: median days to sell among listings sold within ${SELL_WINDOW_DAYS} days, listings created ${D0} to ${SELL_READ_END.slice(0, 10)}, category over the base categories pooled (the ${SELL_WINDOW_DAYS}-day window trims a few percent of the slowest collectibles).`,
		mixpanelReport: { type: "Funnels", steps: ["listing created", "item sold"], counting: "totals", holdPropertyConstant: "listing_id", window: `${SELL_WINDOW_DAYS} days`, dateRange: `${D0} to 2026-08-31`, measure: "median time to convert", breakdown: "category" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H9_SQL },
				select: { e: { where: { grp: "electronics" } }, b: { where: { grp: "baseline" } } },
				expect: { metric: "e.med_days / b.med_days", op: "between", target: band(CAT_SELL_TTC.electronics) },
				minCohort: 300,
			},
			{
				breakdown: { type: "duckdb", sql: H9_SQL },
				select: { c: { where: { grp: "collectibles" } }, b: { where: { grp: "baseline" } } },
				expect: { metric: "c.med_days / b.med_days", op: "between", target: band(CAT_SELL_TTC.collectibles) },
				minCohort: 200,
			},
		],
	},
	{
		id: "H10-back-to-campus",
		hook: "H10",
		archetype: "composition-drift",
		narrative: `From ${D(BTS_START)} to ${D(BTS_END)} (exclusive, through Labor Day) the home feed carries a Back to Campus collection (feed_section = back_to_campus on about ${BTS_FEED_SHARE * 100}% of feed visits) and buyer interest in electronics doubles: the electronics weight in what buyers browse is x${BTS_ELECTRONICS_MULT} (base share ${(ELEC_W * 100).toFixed(0)}%). Electronics' share of "listing viewed" rises to ${BTS_SHARE_RATIO}x its share from ${D0} to ${D(BTS_START)} and returns afterwards. Read: electronics share of listing views, Back to Campus weeks over before.`,
		mixpanelReport: { type: "Insights", event: "listing viewed", measure: "total, % of total", breakdown: "category", chart: `weekly; ${D0} to ${D(BTS_START)} vs ${D(BTS_START)} to 2026-09-07` },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 avg((category = 'electronics')::INT) FILTER (WHERE t >= TIMESTAMP '${TS(BTS_START)}' AND t < TIMESTAMP '${TS(BTS_END)}')
 / avg((category = 'electronics')::INT) FILTER (WHERE t < TIMESTAMP '${TS(BTS_START)}') AS share_ratio,
 avg((category = 'electronics')::INT) FILTER (WHERE t >= TIMESTAMP '${TS(BTS_END)}')
 / avg((category = 'electronics')::INT) FILTER (WHERE t < TIMESTAMP '${TS(BTS_START)}') AS after_ratio
FROM ev WHERE event = 'listing viewed'`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.share_ratio", op: "between", target: band(BTS_SHARE_RATIO) },
				minCohort: 2000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 avg((category = 'electronics')::INT) FILTER (WHERE t >= TIMESTAMP '${TS(BTS_END)}')
 / avg((category = 'electronics')::INT) FILTER (WHERE t < TIMESTAMP '${TS(BTS_START)}') AS after_ratio
FROM ev WHERE event = 'listing viewed'`,
				},
				select: { a: { where: { grp: "all" } } },
				// control: the share returns to its base after the season
				expect: { metric: "a.after_ratio", op: "between", target: band(1) },
				minCohort: 2000,
			},
		],
	},
];

export default config;
