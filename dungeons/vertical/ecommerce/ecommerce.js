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
 * NAME:       Marlowe & Pine
 * APP:        Direct-to-consumer home goods brand (bedding, bath, kitchen,
 *             dining, furniture, lighting, decor, outdoor) selling through its
 *             website and iOS / Android apps. An account is required to check
 *             out (no guest checkout). Pine Plus is a paid membership ($49 a
 *             year) with free US shipping on every order. Standard US orders
 *             ship free above a threshold ($75 until 2026-08-04, $50 from
 *             2026-08-05); Canada and the UK pay a flat $24.95.
 * SCALE:      10,000 users (4,071 create an account inside the window),
 *             1.2M events, 18,660 orders, 120 days (2026-06-04 → 2026-10-01, UTC)
 * CORE LOOP:  category browsed → product viewed → product added to cart →
 *             cart viewed → checkout started → shipping info entered →
 *             payment info entered → order completed → order shipped → order delivered
 * VALUE MOMENT: order completed
 *
 * EVENTS (20):
 *   funnels: category browsed, product viewed, product searched, product added
 *   to cart, cart viewed, checkout started, shipping info entered, payment info
 *   entered, order completed, account created, $experiment_started
 *   standalone (catch-all): home page viewed (5), product added to wishlist (5),
 *   product reviews read (2), order history viewed (1)
 *   hook-derived from the user's own events: order shipped and order delivered
 *   (server-side), return requested, review submitted, room visualizer opened,
 *   the product view before each cart, and extra adds of multi-item carts
 *
 * FUNNELS (4):
 *   - Visit to Account (first funnel, new users): category browsed → product
 *       viewed → account created (100%; the two browse steps are anonymous)
 *   - Discovery: category browsed → product viewed → product viewed (70%)
 *   - Search: product searched → product viewed (75%)
 *   - Checkout: product added to cart → cart viewed → checkout started →
 *       shipping info entered → payment info entered → order completed
 *       (35% per cart before segment effects, 45 min; A/B "One-Page Checkout"
 *       from 2026-07-15). Every step of one cart shares a cart_id.
 *
 * USER PROPS:  shopper_segment, membership, ship_country, acquisition_channel,
 *              customer_since, "Experiment: One-Page Checkout" (enrolled users)
 * SUPER PROPS: platform (ios_app / android_app / web, derived from the device OS)
 * STICKY:      membership (pine_plus / standard) on every event
 * SCD PROPS:   none
 * GROUPS:      none
 * WAREHOUSE:   marketing_spend_daily (paid media spend by channel),
 *              carrier_performance_daily (parcel carrier service levels),
 *              inventory_daily (stock position and units shipped by category)
 * LOOKUPS:     none — product attributes are denormalized onto every product event
 * SOUP:        weekend- and evening-heavy (US shoppers, UTC hours)
 *
 * IDENTITY: a new user browses anonymously first: the two pre-signup steps of
 * "Visit to Account" carry device_id only, and "account created" (isAuthEvent)
 * carries user_id + device_id and links the device. About 2 devices per user.
 * Every later event carries user_id. Client events also carry device_id;
 * server-side events (order shipped, order delivered) carry user_id only.
 * Users who joined before June 4 have no account created event. A handful of
 * pre-signup browses sit on a device that never appears with a user_id (the
 * session crossed UTC midnight before signup) and stay anonymous.
 *
 * DESIGN NOTES:
 * - Products: one seeded catalog (126 products). The hook stamps product_id,
 *   product_name, category, and price_usd on every product event; a product
 *   view in a browse session takes the category of the session's category
 *   browse. Each cart's category is a hash of its cart_id (so funnel-pre and
 *   the everything hook agree); its first add follows a view of the same
 *   product 1-7 minutes earlier. A cart that reaches the cart view can hold
 *   extra items of the same category (extra adds before the cart view).
 * - Order values come from the cart's items: subtotal = Σ price × quantity,
 *   shipping by membership / country / threshold, discount by code, total =
 *   subtotal − discount + shipping (sales tax excluded).
 * - Fulfillment: an order ships 8-36 h after purchase and is delivered after a
 *   carrier-specific transit time (with a late tail). Shipments and deliveries
 *   that would fall after Oct 1 do not exist yet. Established customers'
 *   orders from the 40 days before June 4 ship, deliver, are returned, and are
 *   reviewed inside the window (warm start) at each customer's own in-window
 *   order rate.
 * - Returns and reviews are tied to delivered orders (return rate by category;
 *   reviews on 15% of deliveries, ratings lower after a late delivery).
 * - Rhythm: Sunday/Monday peak, US evening hours dominate in UTC.
 * - Device consistency: platform comes from the device OS; web events carry a
 *   browser that fits the OS, app events carry none.
 * - Retention: retentionCurve shapes new users' active days, and 55% of new
 *   users lapse on a uniform day 5-90 (organic churn, independent of stories).
 *   Server-side shipping events keep firing after a user lapses.
 */

// ── HOOK STORIES ──
/*
 * All effects are hidden: no flag properties. Each is found by a breakdown, a
 * date comparison, a cohort, or a warehouse join. Dates live in the TIMELINE
 * constants and are shared by hooks, stories, SQL, warehouse columns, and the
 * timeline guide. "Per-cart conversion" = Funnels, product added to cart →
 * order completed, Totals, hold cart_id constant, 1-day conversion window.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H1. FREE-SHIPPING THRESHOLD BUNCHING (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: standard (non-member) US carts whose subtotal sits within $30 below
 *   the free-shipping threshold in force ($75 until Aug 4, $50 from Aug 5)
 *   add an add-on item 60% of the time, landing within $30 above it. Pine Plus
 *   members ship free anyway and never do. Within the ±$30 window around the
 *   threshold, the share of standard orders just below it is 0.4x the members'
 *   share. Shipping is charged exactly on standard US orders under the bar.
 * MIXPANEL: Insights, order completed, breakdown subtotal_usd (custom $5
 *   buckets), filter ship_country = US, breakdown membership; before vs after
 *   Aug 5.
 * REAL WORLD: shoppers pad carts to clear a free-shipping bar.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H2. ONE-PAGE CHECKOUT EXPERIMENT (declarative funnel experiment)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-07-15 shoppers split 50/50 (sticky per user) when they
 *   start a cart. "One-Page" multiplies per-cart conversion by 1.2 and cart →
 *   order time by 0.8. Average order value is untouched (honest null).
 * MIXPANEL: per-cart conversion, breakdown user property "Experiment: One-Page
 *   Checkout", Jul 15 - Oct 1; median time to convert.
 * REAL WORLD: fewer checkout pages, fewer exits.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H3. CROSS-BORDER DUTIES ABANDONMENT (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: Canadian and UK carts lose 45% of their would-be orders at the
 *   last step (duties appear at final review), so their per-cart conversion
 *   is 0.55x the US rate. From 2026-09-01 Canada shows duties-included prices
 *   (DDP pilot) and converts like the US; the UK does not change.
 * MIXPANEL: Funnels, the six cart steps, Totals, hold cart_id, breakdown
 *   ship_country, before and after Sep 1.
 * REAL WORLD: surprise landed costs kill cross-border checkouts.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H4. PINE PLUS CHECKS OUT FASTER (funnel-pre)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: Pine Plus members' cart → order time is 0.5x (saved address and
 *   payment). Conversion is unchanged.
 * MIXPANEL: per-cart funnel, median time to convert, breakdown membership.
 * REAL WORLD: stored details remove the slowest checkout fields.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H5. CARRIER HUB DISRUPTION → FEWER REPEAT ORDERS
 *     (everything + warehouse carrier_performance_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: Northline Parcel's hub disruption (2026-07-20 to 2026-08-09) adds
 *   5-8 days to every Northline parcel shipped in it. A US customer whose
 *   first order shipped on those days went with Northline places no further
 *   order for 45 days 45% of the time, so their 45-day repeat rate is 0.55x
 *   that of US customers whose first order on those days shipped with Bluejay
 *   or ParcelPost. The warehouse table marks Northline "disrupted" on those days.
 * MIXPANEL: Retention, order completed → order completed (45 days), cohort of
 *   customers with an order shipped on the disrupted days, breakdown
 *   shipping_carrier; join carrier_performance_daily.service_status.
 * REAL WORLD: a late first impression costs the next order.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H6. PAID CHANNEL ECONOMICS (everything + warehouse marketing_spend_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: window spend per Mixpanel signup is $58 Google Shopping, $42 Meta,
 *   $21 TikTok (paced daily budgets on the weekly shopping rhythm with seeded
 *   noise). Share of would-be buyers who ever buy, by channel: Google Shopping
 *   1.0, direct 0.95, organic search 0.9, email/referral 0.9, Meta 0.7, TikTok
 *   0.3 (the rest stop at checkout start). TikTok is the cheapest signup and
 *   the most expensive first order (1.21x Google's at the knobs).
 * MIXPANEL: Insights, account created by acquisition_channel joined to spend;
 *   Funnels account created → order completed, 30-day window, signups Jun 4 -
 *   Aug 31, breakdown acquisition_channel.
 * REAL WORLD: cheap social reach buys browsers, not buyers.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H7. LABOR DAY SALE (declarative worldEvents + everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-09-04 to 2026-09-07, 25% off sitewide (code LABORDAY25).
 *   US carts started during the sale convert 1.5x the 14 days before;
 *   browsing traffic is 1.3x (category browses and product views). Every sale
 *   order carries the code; the home page features the sale.
 * MIXPANEL: per-cart conversion, filter ship_country = US, sale days vs the
 *   14 days before; Insights order completed by discount_code, daily.
 * REAL WORLD: a holiday sale lifts both traffic and intent.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H8. WISHLIST MAGIC NUMBER (everything, new users)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: new users who save fewer than 3 products to their wishlist in
 *   their first 14 days go quiet around day 21-24, on a ramp: 55% with none,
 *   40% with one, 25% with two, none with 3+. Day-45 retention (any shopper
 *   action in days 45-51) for 3+ vs none is at least 1/(1−0.55) = 2.22.
 * MIXPANEL: cohorts from Funnels (account created → wishlist ×3, 14-day
 *   window), then Retention, account created → any shopper event, day 45-51.
 * REAL WORLD: a curated wishlist is a plan to come back.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H9. ROOM VISUALIZER LAUNCH (funnel-pre + everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: Room Visualizer (see furniture and lamps in your room) launches
 *   2026-07-22. 60% of shoppers adopt it, each from a salted day in the 21
 *   days after launch, and open it before a salted 55-95% (mean 75%) of their
 *   furniture and lighting carts. Those carts convert 1.4x. Once ramped, 45%
 *   of furniture and lighting carts start with it; none before launch.
 * MIXPANEL: Funnels, room visualizer opened → product added to cart → order
 *   completed vs furniture and lighting carts without it (US); Insights
 *   weekly adoption.
 * REAL WORLD: seeing a $600 chair in your room removes the size doubt.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H10. BEDDING STOCKOUT (everything + warehouse inventory_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-08-10 to 2026-08-30 a delayed linen shipment leaves 40% of
 *   bedding SKUs out of stock: 40% of would-be bedding carts never start (the
 *   product view still happens). Bedding adds per bedding view fall to 0.6x
 *   relative to furniture, lighting, and outdoor. Events carry no stock flag;
 *   the warehouse in_stock_rate for bedding is ≈0.6 on those days.
 * MIXPANEL: Insights, product added to cart / product viewed, breakdown
 *   category, daily; join inventory_daily.in_stock_rate.
 * REAL WORLD: a stockout looks like a demand drop until you check inventory.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * EXPECTED METRICS SUMMARY (measured: data/verify-ecommerce, 2026-10-07)
 * ═════════════════════════════════════════════════════════════════════════
 * Hook | Metric                                         | Derivation          | Expected | Measured
 * -----|------------------------------------------------|---------------------|----------|---------
 * H1   | share just below bar, standard / Pine Plus     | 1 − BUMP_SHARE      | 0.40     | 0.385 (23.2% vs 60.3%)
 * H1   | US orders with wrong shipping charge           | exact               | 0        | 0
 * H2   | per-cart conversion One-Page / Control         | ONE_PAGE_CONV_MULT  | 1.20     | 1.207 (37.9% vs 31.4%)
 * H2   | median cart → order time One-Page / Control    | ONE_PAGE_TTC_MULT   | 0.80     | 0.801 (28.8 vs 36.0 min)
 * H2   | average order value One-Page / Control (null)  | unchanged           | 1.00     | 0.973
 * H3   | per-cart conversion CA+GB / US, before Sep 1   | 1 − INTL_LOSS       | 0.55     | 0.558
 * H3   | per-cart conversion CA / US, from Sep 1        | DDP pilot           | 1.00     | 1.040 (39.5% vs 38.0%)
 * H4   | median cart → order time Pine Plus / standard  | PLUS_TTC_MULT       | 0.50     | 0.501 (17.6 vs 35.2 min)
 * H4   | per-cart conversion Pine Plus / standard       | unchanged           | 1.00     | 1.005
 * H5   | 45-day repeat rate, Northline / other US       | 1 − REPEAT_LOSS     | 0.55     | 0.558 (37.1% vs 66.5%)
 * H5   | extra delivery days, disrupted Northline       | mean(5, 8)          | 6.5      | 6.50
 * H6   | spend per signup TikTok / Google Shopping      | 21 / 58             | 0.362    | 0.346 ($21.10 vs $61.07)
 * H6   | 30-day first-order rate TikTok / Google        | 0.3 / 1.0           | 0.30     | 0.291 (14.5% vs 49.8%)
 * H7   | per-cart conversion sale / 14 days before (US) | LABOR_DAY_CONV_MULT | 1.50     | 1.431 (52.6% vs 36.8%)
 * H7   | category browses per day, sale / same weekdays | LABOR_DAY_TRAFFIC   | 1.30     | 1.336
 * H7   | orders with code mismatched to sale dates      | exact               | 0        | 0
 * H8   | day-45 retention, 3+ saves / none              | ≥ 1/(1 − 0.55)      | ≥ 2.22   | 2.474 (55.0% vs 22.2%, STRONG)
 * H9   | conversion with / without visualizer (US)      | VIZ_CONV_MULT       | 1.40     | 1.356 (41.3% vs 30.5%)
 * H9   | visualizer share of carts after the ramp       | 0.6 × 0.75          | 0.45     | 0.443
 * H9   | visualizer events before launch                | exact               | 0        | 0
 * H10  | bedding adds per view, ratio of ratios         | 1 − STOCKOUT_SHARE  | 0.60     | 0.590
 * H10  | warehouse bedding in_stock_rate in stockout    | 1 − STOCKOUT_SHARE  | 0.60     | 0.602
 * ═════════════════════════════════════════════════════════════════════════
 *
 * H8 is a knob floor: heavier shoppers save more and are likelier to show any
 * shopper action in the day-45 week even without the dark cut, so the ratio
 * lands above 1/(1 − 0.55) and grades STRONG. An order in the first 14 days
 * does not predict day-45 retention (no engineered effect). H6's first-order
 * read rests on 67 TikTok buyers; its assertion uses the knob as target with a
 * knob-derived ceiling (half the effect). Robustness: three alternate seeds
 * graded every read NAILED except H6's first-order read once (STRONG, 0.265).
 */

// ── SCALE ──
const SEED = "simple is best";
const NUM_USERS = 10_000;
const DATASET_START = "2026-06-04T00:00:00Z";
const DATASET_END = "2026-10-01T23:59:59Z"; // 120 days
const EVENTS_PER_DAY = 1.2;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── TIMELINE (shared by hooks, stories, SQL, warehouse columns, guides) ──
const CHECKOUT_TEST_START = "2026-07-15T00:00:00Z";   // "One-Page Checkout" A/B starts
const VISUALIZER_LAUNCH = "2026-07-22T00:00:00Z";     // Room Visualizer launch
const CARRIER_DISRUPTION_START = "2026-07-20T00:00:00Z"; // Northline Parcel hub disruption
const CARRIER_DISRUPTION_END = "2026-08-10T00:00:00Z";   // exclusive (21 days)
const FREE_SHIP_CHANGE = "2026-08-05T00:00:00Z";      // free-shipping threshold $75 → $50
const BEDDING_STOCKOUT_START = "2026-08-10T00:00:00Z"; // linen bedding stockout
const BEDDING_STOCKOUT_END = "2026-08-31T00:00:00Z";   // exclusive (21 days)
const CANADA_DDP_START = "2026-09-01T00:00:00Z";      // duties-included prices for Canada
const LABOR_DAY_START = "2026-09-04T00:00:00Z";       // Labor Day sale (Fri-Mon)
const LABOR_DAY_END = "2026-09-08T00:00:00Z";         // exclusive

const ms = (iso) => dayjs.utc(iso).valueOf();
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;
const START_MS = ms(DATASET_START);
const END_MS = ms(DATASET_END);
const dayIndex = (iso) => Math.round((ms(iso) - START_MS) / DAY_MS);

// ── WEEKLY AND DAILY RHYTHM (soup) ──
// Sun..Sat. Home shopping peaks on Sunday and Monday; Friday is the low.
const DOW_WEIGHTS = [1.0, 0.94, 0.86, 0.85, 0.86, 0.8, 0.92];
// UTC hours. US evenings (00-04 UTC) are the peak, a lunchtime bump (16-18 UTC),
// and the US overnight (07-12 UTC) is quiet; UK and Canada add little.
const HOUR_WEIGHTS = [0.95, 1.0, 1.0, 0.92, 0.76, 0.56, 0.38, 0.26, 0.2, 0.18, 0.2, 0.26,
	0.36, 0.48, 0.58, 0.66, 0.72, 0.74, 0.72, 0.7, 0.72, 0.78, 0.86, 0.92];

// ── KNOBS ──
// Checkout funnel (per cart, before segment effects)
const CHECKOUT_CONV = 35;
const CHECKOUT_TTC_H = 0.75;
const CATEGORY_CONV_MULT = { furniture: 0.75, lighting: 0.9, outdoor: 0.9 }; // big-ticket carts convert less (realism)
const CHECKOUT_WINDOW_DAYS = 1;    // read: per-cart funnel conversion window

// H1 free-shipping threshold (US standard shoppers)
const FREE_SHIP_OLD = 75;
const FREE_SHIP_NEW = 50;
const SHIP_FEE_US = 7.95;
const SHIP_FEE_INTL = 24.95;
const BUMP_WINDOW = 30;            // $ below / above the threshold
const BUMP_SHARE = 0.6;            // share of near-threshold standard carts that add an add-on
const freeShipThreshold = (t) => (t >= ms(FREE_SHIP_CHANGE) ? FREE_SHIP_NEW : FREE_SHIP_OLD);

// H2 One-Page Checkout experiment
const CHECKOUT_TEST = "One-Page Checkout";
const CHECKOUT_VARIANT = "One-Page";
const EXP_KEY = `Experiment: ${CHECKOUT_TEST}`;
const ONE_PAGE_CONV_MULT = 1.2;
const ONE_PAGE_TTC_MULT = 0.8;

// H3 cross-border duties: share of would-be orders lost at the last step
const INTL_LAST_STEP_LOSS = 0.45;
const SHIP_COUNTRY_WEIGHTS = { US: 84, CA: 10, GB: 6 };

// H4 Pine Plus checkout speed
const PLUS_TTC_MULT = 0.5;
const PLUS_SHARE_ESTABLISHED = 0.35;
const PLUS_SHARE_NEW = 0.15;

// H5 carrier disruption (warehouse carrier_performance_daily)
const US_CARRIER_WEIGHTS = { northline: 55, bluejay: 30, parcelpost: 15 };
const INTL_CARRIER = { CA: "maple_courier", GB: "albion_parcel" };
const DISRUPTED_CARRIER = "northline";
const DISRUPTION_DELAY_DAYS = [5, 8];
const REPEAT_LOSS = 0.45;          // affected customers: share who place no order for 45 days
const REPEAT_WINDOW_DAYS = 45;
const TRANSIT_DAYS = { northline: [1.6, 4.4], bluejay: [1.2, 3.6], parcelpost: [2.2, 4.6], maple_courier: [5, 10], albion_parcel: [6, 11] };
const ON_TIME_BASE = { northline: 0.93, bluejay: 0.95, parcelpost: 0.91, maple_courier: 0.97, albion_parcel: 0.96 }; // carrier-reported, normal operations
const LATE_TAIL_SHARE = 0.12;      // parcels that pick up a 1-4 day delay anywhere (normal ops)
const PROMISED_DAYS = { US: 5, CA: 12, GB: 12 };
const FULFILL_HOURS = [8, 36];

// H6 paid channel economics (warehouse marketing_spend_daily)
const CHANNEL_WEIGHTS = { organic_search: 24, direct: 12, email_referral: 10, meta_ads: 20, google_shopping: 18, tiktok_ads: 16 };
const PAID_CHANNELS = ["meta_ads", "google_shopping", "tiktok_ads"];
const CPS_USD = { meta_ads: 42, google_shopping: 58, tiktok_ads: 21 }; // window spend per Mixpanel signup
const FIRST_ORDER_KEEP = { google_shopping: 1.0, direct: 0.95, organic_search: 0.9, email_referral: 0.9, meta_ads: 0.7, tiktok_ads: 0.3 };
const BORN_PCT = 40;
const WINDOW_DAYS = 120;
const FIRST_ORDER_WINDOW_DAYS = 30;
const SIGNUP_COHORT_END = "2026-09-01T00:00:00Z"; // exclusive: every signup has a full 30 days
const SPEND_NOISE = 0.12;
const SPEND_FLAT_SHARE = 0.35;     // budgets follow the shopping rhythm above a flat floor
const CPC_USD = { meta_ads: 0.95, google_shopping: 0.7, tiktok_ads: 0.45 };
const CTR = { meta_ads: 0.011, google_shopping: 0.018, tiktok_ads: 0.008 };
const PLATFORM_PURCHASE_INFLATION = { meta_ads: 1.6, google_shopping: 1.25, tiktok_ads: 2.2 };

// H7 Labor Day sale
const LABOR_DAY_CONV_MULT = 1.5;
const LABOR_DAY_TRAFFIC_MULT = 1.3;
const LABOR_DAY_CODE = "LABORDAY25";
const LABOR_DAY_DISCOUNT = 0.25;
const WELCOME_CODE = "WELCOME10";
const WELCOME_SHARE = 0.5;

// H8 wishlist magic number (new users)
const WISHLIST_DAYS = 14;
const WISHLIST_MIN = 3;
const DARK_SHARE_BY_SAVES = [0.55, 0.4, 0.25]; // 0, 1, 2 saves; 3+ → 0
const DARK_AFTER_DAYS = 21;
const DARK_SPREAD_DAYS = 3;
const RETENTION_DAY = 45;
const LAPSE_SHARE = 0.55;           // organic churn, every new user
const LAPSE_DAY = [5, 90];

// H9 Room Visualizer
const VIZ_ADOPTER_SHARE = 0.6;
const VIZ_RAMP_DAYS = 21;
const VIZ_USE_MEAN = 0.75;
const VIZ_USE_SPREAD = 0.2;
const VIZ_CONV_MULT = 1.4;
const VIZ_CATEGORIES = ["furniture", "lighting"];

// H10 bedding stockout (warehouse inventory_daily)
const STOCKOUT_CATEGORY = "bedding";
const STOCKOUT_SHARE = 0.4;        // share of bedding SKUs (and would-be bedding carts) out of stock

// Warm start: established customers' orders placed before June 4
const WARM_LOOKBACK_DAYS = 40;

// Returns and reviews (realism)
const RETURN_RATE = { bedding: 0.1, bath: 0.06, kitchen: 0.04, dining: 0.05, furniture: 0.08, lighting: 0.06, decor: 0.05, outdoor: 0.05 };
const REVIEW_RATE = 0.15;

// ── CATALOG (seeded; denormalized onto every product event) ──
const CATEGORY_WEIGHTS = { bedding: 23, bath: 9, kitchen: 13, dining: 8, furniture: 22, lighting: 9, decor: 9, outdoor: 7 };
const CATEGORIES = Object.keys(CATEGORY_WEIGHTS);
// [type, low price, high price, materials]
const PRODUCT_TYPES = {
	bedding: [["Duvet Cover", 120, 260, ["Linen", "Percale", "Sateen"]], ["Sheet Set", 90, 190, ["Linen", "Percale", "Sateen", "Organic Cotton"]], ["Quilt", 140, 280, ["Cotton", "Linen", "Matelasse"]], ["Pillowcase Pair", 30, 60, ["Linen", "Percale", "Silk"]], ["Throw Blanket", 60, 140, ["Wool", "Waffle", "Cashmere Blend"]]],
	bath: [["Bath Towel Set", 50, 110, ["Turkish Cotton", "Waffle", "Plush"]], ["Bath Mat", 25, 55, ["Cotton", "Teak", "Plush"]], ["Robe", 60, 120, ["Waffle", "Plush", "Linen"]], ["Hand Towel Pair", 18, 34, ["Turkish Cotton", "Waffle"]]],
	kitchen: [["Dutch Oven", 110, 240, ["Enameled Cast Iron"]], ["Knife Set", 90, 220, ["Stainless", "Damascus"]], ["Cutting Board", 28, 70, ["Walnut", "Maple", "Acacia"]], ["Dish Towel Set", 14, 26, ["Linen", "Cotton"]], ["Utensil Set", 22, 48, ["Olivewood", "Silicone", "Stainless"]], ["Mixing Bowl Set", 36, 80, ["Stoneware", "Stainless", "Glass"]]],
	dining: [["Dinnerware Set", 80, 200, ["Stoneware", "Porcelain"]], ["Glassware Set", 30, 70, ["Recycled Glass", "Crystal"]], ["Flatware Set", 50, 120, ["Brushed Gold", "Stainless"]], ["Napkin Set", 20, 40, ["Linen", "Cotton"]], ["Serving Platter", 28, 64, ["Stoneware", "Marble", "Acacia"]]],
	furniture: [["Accent Chair", 320, 780, ["Boucle", "Rattan", "Velvet", "Leather"]], ["Coffee Table", 280, 640, ["Oak", "Walnut", "Marble"]], ["Bookshelf", 260, 560, ["Oak", "Walnut"]], ["Bed Frame", 600, 1400, ["Oak", "Walnut", "Upholstered"]], ["Nightstand", 180, 380, ["Oak", "Walnut", "Rattan"]]],
	lighting: [["Table Lamp", 70, 180, ["Brass", "Ceramic", "Rattan"]], ["Floor Lamp", 140, 320, ["Brass", "Matte Black", "Linen Shade"]], ["Pendant Light", 110, 260, ["Rattan", "Glass", "Brass"]]],
	decor: [["Scented Candle", 14, 32, ["Beeswax", "Soy"]], ["Vase", 24, 70, ["Ceramic", "Glass", "Terracotta"]], ["Throw Pillow", 30, 65, ["Linen", "Wool", "Velvet"]], ["Wall Mirror", 90, 240, ["Brass", "Oak", "Arched"]], ["Planter", 22, 58, ["Terracotta", "Ceramic", "Concrete"]], ["Picture Frame", 16, 40, ["Oak", "Brass", "Walnut"]]],
	outdoor: [["Outdoor Cushion", 40, 90, ["All-Weather"]], ["Lantern", 28, 70, ["Brass", "Black Metal"]], ["Patio Chair", 160, 380, ["Teak", "Powder-Coated"]], ["Planter Box", 50, 130, ["Cedar", "Teak"]]],
};
const LINES = ["Cloudweave", "Harbor", "Fernwood", "Ashby", "Larch", "Meadow", "Tidewater", "Juniper", "Halden", "Brookline", "Saltmarsh", "Quarry"];
const ADDON_CATEGORIES = ["decor", "kitchen", "bath", "dining"];
const ADDON_MAX_PRICE = 40;

function cumulative(weights) {
	const total = weights.reduce((a, b) => a + b, 0);
	let acc = 0;
	return weights.map((w) => (acc += w / total));
}

const CATALOG = (() => {
	const out = {};
	let n = 1000;
	for (const cat of CATEGORIES) {
		const list = [];
		for (const [type, lo, hi, materials] of PRODUCT_TYPES[cat]) {
			const variants = chance.integer({ min: 2, max: 4 });
			for (let i = 0; i < variants; i++) {
				const price = Math.max(10, Math.round(chance.integer({ min: lo, max: hi }) / 5) * 5) - 0.01;
				list.push({
					product_id: `MP-${cat.slice(0, 3).toUpperCase()}-${n++}`,
					product_name: `${chance.pickone(LINES)} ${chance.pickone(materials)} ${type}`,
					category: cat,
					price_usd: Math.round(price * 100) / 100,
				});
			}
		}
		// popularity: a seeded order, then a long tail of weights
		const shuffled = chance.shuffle(list);
		out[cat] = { items: shuffled, cum: cumulative(shuffled.map((_, i) => 1 / (1 + i * 0.35))) };
	}
	return out;
})();
const ADDONS = CATEGORIES.filter((c) => ADDON_CATEGORIES.includes(c))
	.flatMap((c) => CATALOG[c].items.filter((p) => p.price_usd <= ADDON_MAX_PRICE))
	.sort((a, b) => a.price_usd - b.price_usd);
const SEARCH_TERMS = [...new Set(Object.values(PRODUCT_TYPES).flat().map(([t]) => t.toLowerCase()))]
	.concat(["linen sheets", "king duvet", "oak table", "candles", "towels", "lamp", "throw", "outdoor chair", "gift ideas", "sale"]);
const CA_CITIES = [["Ontario", "Toronto"], ["Ontario", "Ottawa"], ["British Columbia", "Vancouver"], ["Quebec", "Montreal"], ["Alberta", "Calgary"], ["Alberta", "Edmonton"], ["Nova Scotia", "Halifax"], ["Manitoba", "Winnipeg"]];
const GB_CITIES = [["England", "London"], ["England", "Manchester"], ["England", "Bristol"], ["England", "Leeds"], ["Scotland", "Edinburgh"], ["Scotland", "Glasgow"], ["Wales", "Cardiff"], ["England", "Brighton"]];

// ── HELPERS ──
const pickWeighted = (weights, r) => {
	const entries = Object.entries(weights);
	const total = entries.reduce((s, [, w]) => s + w, 0);
	let acc = 0;
	for (const [k, w] of entries) {
		acc += w / total;
		if (r < acc) return k;
	}
	return entries[entries.length - 1][0];
};
const salt = (key, tag) => hashFloat(`${key}|${tag}`);
const rnd = () => chance.floating({ min: 0, max: 1 });
const round2 = (n) => Math.round(n * 100) / 100;
const round1 = (n) => Math.round(n * 10) / 10;
const T = (e) => Date.parse(e.time);
const iso = (t) => new Date(t).toISOString();
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const jitter = (key, spread) => 1 + (hashFloat(key) - 0.5) * 2 * spread;
const productIn = (cat, r) => {
	const c = CATALOG[cat];
	const i = c.cum.findIndex((x) => r < x);
	return c.items[i < 0 ? c.items.length - 1 : i];
};
const cartCategory = (cartId) => pickWeighted(CATEGORY_WEIGHTS, salt(cartId, "cat"));
const orderIdFor = (cartId) => `MP${cartId.slice(4, 14).toUpperCase()}`;
const inDisruption = (t) => t >= ms(CARRIER_DISRUPTION_START) && t < ms(CARRIER_DISRUPTION_END);
const inStockout = (t) => t >= ms(BEDDING_STOCKOUT_START) && t < ms(BEDDING_STOCKOUT_END);
const inLaborDay = (t) => t >= ms(LABOR_DAY_START) && t < ms(LABOR_DAY_END);
const isVizAdopter = (uid) => salt(uid, "viz-adopter") < VIZ_ADOPTER_SHARE;
const vizStartMs = (uid) => ms(VISUALIZER_LAUNCH) + Math.floor(salt(uid, "viz-start") * VIZ_RAMP_DAYS) * DAY_MS;
const vizUse = (uid) => VIZ_USE_MEAN + (salt(uid, "viz-use") - 0.5) * 2 * VIZ_USE_SPREAD;
const usCarrier = (orderId) => pickWeighted(US_CARRIER_WEIGHTS, salt(orderId, "carrier"));

// Carts whose shopper opened the Room Visualizer first: decided in funnel-pre
// (where conversion is set) and read back once in the everything hook.
const VIZ_CARTS = new Set();

const CHECKOUT_STEPS = ["product added to cart", "cart viewed", "checkout started", "shipping info entered", "payment info entered", "order completed"];
const DEVICE_FIELDS = ["device_id", "model", "screen_height", "screen_width", "os", "carrier", "radio", "browser", "platform"];
const SERVER_EVENTS = new Set(["order shipped", "order delivered"]);

// ── PAID MEDIA (H6) ──
const EXPECTED_SIGNUPS_PER_DAY = (ch) => {
	const totalW = Object.values(CHANNEL_WEIGHTS).reduce((a, b) => a + b, 0);
	return (NUM_USERS * BORN_PCT / 100) * (CHANNEL_WEIGHTS[ch] / totalW) / WINDOW_DAYS;
};
const SPEND_WEEKDAY = (() => {
	const m = DOW_WEIGHTS.reduce((a, b) => a + b, 0) / DOW_WEIGHTS.length;
	return DOW_WEIGHTS.map((w) => SPEND_FLAT_SHARE + (1 - SPEND_FLAT_SHARE) * w / m);
})();
const paidSpend = (date, ch) => round2(CPS_USD[ch] * EXPECTED_SIGNUPS_PER_DAY(ch) * SPEND_WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()] * jitter(`spend|${date}|${ch}`, SPEND_NOISE));

// ── INVENTORY (H10) ──
const SKUS_ACTIVE = Object.fromEntries(CATEGORIES.map((c) => [c, CATALOG[c].items.length * 6])); // sizes and colorways per product
const ON_HAND_BASE = { bedding: 5200, bath: 3100, kitchen: 4200, dining: 2600, furniture: 640, lighting: 900, decor: 3800, outdoor: 1100 };
const stockoutShare = (cat, t) => (cat === STOCKOUT_CATEGORY && inStockout(t) ? STOCKOUT_SHARE : 0);
const oosSkus = (cat, t) => {
	const d = dayKey(t);
	const base = Math.floor(SKUS_ACTIVE[cat] * (0.01 + hashFloat(`oos|${d}|${cat}`) * 0.025));
	const extra = Math.round(SKUS_ACTIVE[cat] * stockoutShare(cat, t) * jitter(`oos-x|${d}|${cat}`, 0.06));
	return Math.min(SKUS_ACTIVE[cat], Math.max(base, extra));
};

// ── CARRIERS (H5) ──
const carrierOnTime = (carrier, t) => {
	const d = dayKey(t);
	if (carrier === DISRUPTED_CARRIER && inDisruption(t)) return round2(0.14 + (hashFloat(`ot|${d}|${carrier}`) - 0.5) * 0.12);
	return round2(Math.min(0.995, (ON_TIME_BASE[carrier] ?? 0.92) + (hashFloat(`ot|${d}|${carrier}`) - 0.5) * 0.05));
};
const carrierTransit = (carrier, t) => {
	const d = dayKey(t);
	const [lo, hi] = TRANSIT_DAYS[carrier] || [3, 6];
	const base = (lo + hi) / 2 + LATE_TAIL_SHARE * 2.5;
	const delay = carrier === DISRUPTED_CARRIER && inDisruption(t) ? (DISRUPTION_DELAY_DAYS[0] + DISRUPTION_DELAY_DAYS[1]) / 2 : 0;
	return round1((base + delay) * jitter(`tr|${d}|${carrier}`, 0.08));
};
const WHOLESALE_PARCELS = { northline: 22, bluejay: 14, parcelpost: 8, maple_courier: 3, albion_parcel: 2 };
const BULK_DAY_SHARE = 0.1;      // days a retail partner's bulk order ships from the same stock
const WHOLESALE_UNITS = { bedding: 18, bath: 12, kitchen: 15, dining: 9, furniture: 2, lighting: 3, decor: 14, outdoor: 4 };

// ── HOOKS ──
function handleUserHook(profile, meta) {
	const uid = profile.distinct_id;
	const born = meta.userIsBornInDataset;
	profile.membership = salt(uid, "plus") < (born ? PLUS_SHARE_NEW : PLUS_SHARE_ESTABLISHED) ? "pine_plus" : "standard";
	const country = pickWeighted(SHIP_COUNTRY_WEIGHTS, salt(uid, "country"));
	profile.ship_country = country;
	if (country !== "US") {
		const list = country === "CA" ? CA_CITIES : GB_CITIES;
		const loc = list[Math.floor(salt(uid, "city") * list.length)];
		profile.country = country === "CA" ? "Canada" : "United Kingdom";
		profile.country_code = country;
		profile.region = loc[0];
		profile.city = loc[1];
	}
	if (!born) {
		// established customers joined between 2021-03-01 and the window start
		const span = dayIndex(DATASET_START) - dayIndex("2021-03-01T00:00:00Z");
		profile.customer_since = dayjs.utc("2021-03-01T00:00:00Z").add(Math.floor(salt(uid, "tenure") * span), "day").format("YYYY-MM-DD");
	}
	return profile;
}

function handleFunnelPre(funnel, meta) {
	if (funnel.name !== "Checkout") return funnel;
	const profile = meta.profile;
	const uid = profile.distinct_id;
	const cartId = `crt_${chance.hash({ length: 14 })}`;
	const cat = cartCategory(cartId);
	let rate = funnel.conversionRate * (CATEGORY_CONV_MULT[cat] ?? 1);
	// H9: furniture and lighting carts of a Room Visualizer adopter (from their start day)
	const dayMs = (meta.firstEventTime || 0) * 1000;
	if (VIZ_CATEGORIES.includes(cat) && isVizAdopter(uid) && dayMs >= vizStartMs(uid) && salt(cartId, "viz") < vizUse(uid)) {
		rate *= VIZ_CONV_MULT;
		VIZ_CARTS.add(cartId);
	}
	funnel.conversionRate = Math.min(97, Math.round(rate));
	// H4: Pine Plus members check out faster
	if (profile.membership === "pine_plus") funnel.timeToConvert = (funnel.timeToConvert || CHECKOUT_TTC_H) * PLUS_TTC_MULT;
	funnel.props = { ...(funnel.props || {}), cart_id: [cartId] };
	return funnel;
}

// Every declared event-specific key; a derived event keeps only its own.
let SOURCE_ONLY_KEYS = [];

/** Copy of `src` renamed to `name`: identity and context fields stay, the source's own properties go. */
function deriveEvent(src, name, time, props, { server = false } = {}) {
	const ev = cloneEvent(src, { event: name, time: iso(time) });
	for (const k of SOURCE_ONLY_KEYS) delete ev[k];
	if (server) for (const k of DEVICE_FIELDS) delete ev[k];
	Object.assign(ev, props);
	return ev;
}

function webBrowser(os, deviceId) {
	const r = hashFloat(`browser|${deviceId}`);
	if (os === "macOS") return r < 0.55 ? "Safari" : r < 0.92 ? "Chrome" : "Firefox";
	if (os === "Windows") return r < 0.62 ? "Chrome" : r < 0.9 ? "Microsoft Edge" : "Firefox";
	return r < 0.8 ? "Chrome" : "Firefox";
}

function unitStart(unit) {
	for (const k of CHECKOUT_STEPS) if (unit.steps[k]) return T(unit.steps[k]);
	return Infinity;
}

function poisson(lambda) {
	const L = Math.exp(-lambda);
	let k = 0, p = 1;
	do {
		k++;
		p *= rnd();
	} while (p > L && k < 60);
	return k - 1;
}

function handleEverything(events, meta) {
	if (!events.length) return events;
	const profile = meta.profile;
	const uid = profile.distinct_id;
	const born = meta.userIsBornInDataset;
	const isUS = profile.ship_country === "US";
	const isPlus = profile.membership === "pine_plus";
	const signup = events.find((e) => e.event === "account created");
	const birthMs = signup ? T(signup) : null;

	// ── device-consistent platform and browser; location matches the profile ──
	for (const e of events) {
		if (e.os) {
			const app = e.os === "iOS" || e.os === "iPadOS" ? "ios_app" : e.os === "Android" ? "android_app" : "web";
			e.platform = app;
			if (app === "web") e.browser = webBrowser(e.os, e.device_id || uid);
			else delete e.browser;
		}
		if (!isUS) {
			e.country = profile.country;
			e.country_code = profile.country_code;
			e.region = profile.region;
			e.city = profile.city;
		}
	}

	// ── browse events: products and categories ──
	const assignProduct = (e, p) => {
		e.product_id = p.product_id;
		e.product_name = p.product_name;
		e.category = p.category;
		e.price_usd = p.price_usd;
	};
	let lastBrowse = null;
	let lastProduct = null;
	for (const e of events) {
		const t = T(e);
		if (e.event === "category browsed") {
			e.category = pickWeighted(CATEGORY_WEIGHTS, rnd());
			lastBrowse = { t, category: e.category };
		} else if (e.event === "product viewed") {
			const cat = lastBrowse && t - lastBrowse.t < 30 * MIN_MS && rnd() < 0.85 ? lastBrowse.category : pickWeighted(CATEGORY_WEIGHTS, rnd());
			const p = productIn(cat, rnd());
			assignProduct(e, p);
			lastProduct = { t, product: p };
		} else if (e.event === "product added to wishlist" || e.event === "product reviews read") {
			const p = lastProduct && t - lastProduct.t < 30 * MIN_MS ? lastProduct.product : productIn(pickWeighted(CATEGORY_WEIGHTS, rnd()), rnd());
			if (e.event === "product added to wishlist") assignProduct(e, p);
			else {
				e.product_id = p.product_id;
				e.category = p.category;
			}
		} else if (e.event === "product searched") {
			e.search_term = SEARCH_TERMS[Math.floor(rnd() * SEARCH_TERMS.length)];
		} else if (e.event === "home page viewed") {
			if (inLaborDay(t) && rnd() < 0.6) e.home_module = "labor_day_sale";
		}
	}

	// ── checkout units (one per cart_id) ──
	const expoByMs = new Map();
	for (const e of events) if (e.event === "$experiment_started") expoByMs.set(T(e), e);
	const units = new Map();
	for (const e of events) {
		if (!e.cart_id || e.cart_id === "unassigned" || !CHECKOUT_STEPS.includes(e.event)) continue;
		if (!units.has(e.cart_id)) units.set(e.cart_id, { id: e.cart_id, steps: {}, derived: [], expo: null });
		units.get(e.cart_id).steps[e.event] = e;
	}
	const unitList = [...units.values()].sort((a, b) => unitStart(a) - unitStart(b));
	const payment = pickWeighted({ credit_card: 55, paypal: 20, digital_wallet: 18, afterpay: 7 }, salt(uid, "pay"));
	let firstOrderSeen = false;
	for (const unit of unitList) {
		const s = unit.steps;
		const add = s["product added to cart"];
		const cv = s["cart viewed"];
		const cat = cartCategory(unit.id);
		unit.category = cat;
		if (add) unit.expo = expoByMs.get(T(add) - 1000) || null;
		// items: the cart's product, then same-category extras (only once the cart is viewed)
		const items = [{ p: productIn(cat, salt(unit.id, "p0")), qty: 1 }];
		if (items[0].p.price_usd < 35 && salt(unit.id, "q0") < 0.3) items[0].qty = 2;
		if (cv) {
			const r = salt(unit.id, "items");
			// big-ticket carts rarely hold a second big piece
			const extras = cat === "furniture" ? (r < 0.78 ? 0 : r < 0.97 ? 1 : 2) : (r < 0.5 ? 0 : r < 0.8 ? 1 : r < 0.93 ? 2 : 3);
			for (let i = 0; i < extras; i++) {
				const p = productIn(cat, salt(unit.id, `p${i + 1}`));
				items.push({ p, qty: p.price_usd < 35 && salt(unit.id, `q${i + 1}`) < 0.3 ? 2 : 1 });
			}
		}
		let subtotal = round2(items.reduce((a, it) => a + it.p.price_usd * it.qty, 0));
		const addTimes = [];
		if (add) {
			assignProduct(add, items[0].p);
			add.quantity = items[0].qty;
			// the product page view that led to the add
			const viewT = Math.max(T(add) - (60 + Math.floor(salt(unit.id, "view-gap") * 360)) * 1000, birthMs ? birthMs + 1000 : START_MS);
			const view = deriveEvent(add, "product viewed", viewT, {});
			assignProduct(view, items[0].p);
			unit.derived.push(view);
			unit.view = view;
			// H9: a Room Visualizer session between the view and the add
			if (VIZ_CARTS.has(unit.id)) {
				const viz = deriveEvent(add, "room visualizer opened", viewT + (T(add) - viewT) * 0.5, {});
				assignProduct(viz, items[0].p);
				unit.derived.push(viz);
				unit.viz = true;
			}
		}
		VIZ_CARTS.delete(unit.id);
		// extra items: adds between the first add and the cart view
		if (add && cv) {
			const a0 = T(add), c0 = T(cv);
			for (let i = 1; i < items.length; i++) {
				const t = a0 + (c0 - a0) * (i / (items.length + 1));
				const x = deriveEvent(add, "product added to cart", t, { cart_id: unit.id, quantity: items[i].qty });
				assignProduct(x, items[i].p);
				unit.derived.push(x);
				addTimes.push(t);
			}
		}
		// H1: a standard US shopper just under the free-shipping bar adds an add-on
		if (cv && isUS && !isPlus) {
			const gap = freeShipThreshold(T(cv)) - subtotal;
			if (gap > 0 && gap <= BUMP_WINDOW && salt(unit.id, "bump") < BUMP_SHARE) {
				const options = ADDONS.filter((p) => p.price_usd >= gap && p.price_usd < gap + BUMP_WINDOW);
				if (options.length) {
					const p = options[Math.floor(salt(unit.id, "addon") * options.length)];
					items.push({ p, qty: 1 });
					subtotal = round2(subtotal + p.price_usd);
					if (add) {
						const t = (Math.max(T(add), ...addTimes) + T(cv)) / 2;
						const x = deriveEvent(add, "product added to cart", t, { cart_id: unit.id, quantity: 1 });
						assignProduct(x, p);
						unit.derived.push(x);
					}
				}
			}
		}
		unit.subtotal = subtotal;
		const itemCount = items.reduce((a, it) => a + it.qty, 0);
		for (const k of ["cart viewed", "checkout started"]) {
			if (s[k]) {
				s[k].cart_items = itemCount;
				s[k].cart_value_usd = subtotal;
			}
		}
		if (s["shipping info entered"]) s["shipping info entered"].ship_country = profile.ship_country;
		if (s["payment info entered"]) s["payment info entered"].payment_method = payment;
		const order = s["order completed"];
		if (order) {
			const t = T(order);
			const shipping = !isUS ? SHIP_FEE_INTL : isPlus || subtotal >= freeShipThreshold(t) ? 0 : SHIP_FEE_US;
			let code = "none";
			if (inLaborDay(t)) code = LABOR_DAY_CODE;
			else if (born && !firstOrderSeen && salt(uid, "welcome") < WELCOME_SHARE) code = WELCOME_CODE;
			firstOrderSeen = true;
			const discount = code === LABOR_DAY_CODE ? round2(subtotal * LABOR_DAY_DISCOUNT) : code === WELCOME_CODE ? round2(subtotal * 0.1) : 0;
			order.order_id = orderIdFor(unit.id);
			order.item_count = itemCount;
			order.primary_category = cat;
			order.subtotal_usd = subtotal;
			order.discount_code = code;
			order.discount_usd = discount;
			order.shipping_usd = shipping;
			order.free_shipping = shipping === 0;
			order.order_total_usd = round2(subtotal - discount + shipping);
			order.payment_method = payment;
			order.ship_country = profile.ship_country;
		}
		if (unit.expo) unit.derived.push(unit.expo);
	}

	const dropSet = new Set();
	const dropUnit = (unit, fromStep = 0) => {
		for (let i = fromStep; i < CHECKOUT_STEPS.length; i++) {
			const ev = unit.steps[CHECKOUT_STEPS[i]];
			if (ev) dropSet.add(ev);
		}
		if (fromStep === 0) {
			for (const ev of unit.derived) if (ev !== unit.view) dropSet.add(ev);
			unit.dropped = true;
		}
	};
	const liveOrder = (unit) => {
		const o = unit.steps["order completed"];
		return o && !dropSet.has(o) ? o : null;
	};

	// ── H3: cross-border duties appear at final review (Canada fixed from Sep 1) ──
	if (!isUS) {
		for (const unit of unitList) {
			const order = unit.steps["order completed"];
			if (!order) continue;
			const fixed = profile.ship_country === "CA" && T(order) >= ms(CANADA_DDP_START);
			if (!fixed && salt(unit.id, "duties") < INTL_LAST_STEP_LOSS) dropSet.add(order);
		}
	}

	// ── H6: some new users from each channel never buy (they stop at checkout start) ──
	if (born && salt(uid, "channel-keep") >= (FIRST_ORDER_KEEP[profile.acquisition_channel] ?? 1)) {
		for (const unit of unitList) dropUnit(unit, 2);
	}

	// ── H10: bedding stockout — would-be bedding carts never start (the view stays) ──
	for (const unit of unitList) {
		if (unit.dropped || unit.category !== STOCKOUT_CATEGORY) continue;
		if (inStockout(unitStart(unit)) && salt(unit.id, "oos") < STOCKOUT_SHARE) dropUnit(unit, 0);
	}

	// ── fulfillment: ship and deliver every order (H5 delays), returns, reviews ──
	const shipments = [];
	const makeFulfillment = (src, orderId, orderMs, cat, subtotal, unit) => {
		const shipMs = orderMs + (FULFILL_HOURS[0] + rnd() * (FULFILL_HOURS[1] - FULFILL_HOURS[0])) * HOUR_MS;
		const carrier = isUS ? usCarrier(orderId) : INTL_CARRIER[profile.ship_country];
		const [lo, hi] = TRANSIT_DAYS[carrier];
		let transit = lo + rnd() * (hi - lo);
		if (rnd() < LATE_TAIL_SHARE) transit += 1 + rnd() * 3;
		const disrupted = carrier === DISRUPTED_CARRIER && inDisruption(shipMs);
		if (disrupted) transit += DISRUPTION_DELAY_DAYS[0] + rnd() * (DISRUPTION_DELAY_DAYS[1] - DISRUPTION_DELAY_DAYS[0]);
		const deliverMs = shipMs + transit * DAY_MS;
		const deliveryDays = round1(transit);
		const onTime = deliveryDays <= PROMISED_DAYS[profile.ship_country];
		const out = [];
		const base = { order_id: orderId, shipping_carrier: carrier, ship_country: profile.ship_country };
		if (shipMs >= START_MS) out.push(deriveEvent(src, "order shipped", shipMs, { ...base }, { server: true }));
		if (deliverMs >= START_MS) out.push(deriveEvent(src, "order delivered", deliverMs, { ...base, delivery_days: deliveryDays, on_time: onTime }, { server: true }));
		if (rnd() < (RETURN_RATE[cat] ?? 0.05)) {
			const t = deliverMs + (2 + rnd() * 19) * DAY_MS;
			const reason = chance.weighted(["changed_mind", "not_as_pictured", "damaged", "wrong_size", "arrived_late"], onTime ? [35, 25, 15, 15, 10] : [20, 15, 10, 10, 45]);
			if (t >= START_MS) out.push(deriveEvent(src, "return requested", t, { order_id: orderId, category: cat, return_reason: reason, refund_usd: round2(subtotal * (0.4 + rnd() * 0.6)) }));
		}
		if (rnd() < REVIEW_RATE) {
			const t = deliverMs + (3 + rnd() * 22) * DAY_MS;
			const rating = Number(chance.weighted(["5", "4", "3", "2", "1"], onTime ? [55, 28, 10, 4, 3] : [20, 22, 22, 18, 18]));
			if (t >= START_MS) out.push(deriveEvent(src, "review submitted", t, { order_id: orderId, category: cat, rating }));
		}
		if (unit) unit.derived.push(...out);
		shipments.push({ unit, orderMs, shipMs, carrier });
		return out;
	};
	const extraEvents = [];
	for (const unit of unitList) {
		const order = liveOrder(unit);
		if (!order || unit.dropped) continue;
		extraEvents.push(...makeFulfillment(order, order.order_id, T(order), unit.category, unit.subtotal, unit));
	}

	// ── H5: a disrupted first delivery costs the next order ──
	const disruptedWindow = shipments.filter((sh) => sh.unit && inDisruption(sh.shipMs)).sort((a, b) => a.orderMs - b.orderMs);
	if (disruptedWindow.length) {
		const ref = disruptedWindow[0];
		if (ref.carrier === DISRUPTED_CARRIER && salt(uid, "repeat-loss") < REPEAT_LOSS) {
			for (const unit of unitList) {
				if (unit.dropped) continue;
				const st = unitStart(unit);
				if (st > ref.orderMs && st <= ref.orderMs + REPEAT_WINDOW_DAYS * DAY_MS) dropUnit(unit, 0);
			}
		}
	}

	// ── warm start: established customers' orders from the 40 days before June 4 ──
	if (!born) {
		const nOrders = unitList.filter((un) => !un.dropped && liveOrder(un)).length;
		const template = events.find((e) => !SERVER_EVENTS.has(e.event) && e.event !== "$experiment_started" && e.user_id && e.device_id);
		if (nOrders > 0 && template) {
			const m = poisson(nOrders / WINDOW_DAYS * WARM_LOOKBACK_DAYS);
			for (let i = 0; i < m; i++) {
				const orderMs = START_MS - rnd() * WARM_LOOKBACK_DAYS * DAY_MS;
				const cat = pickWeighted(CATEGORY_WEIGHTS, rnd());
				const p = productIn(cat, rnd());
				const orderId = `MP${chance.hash({ length: 10 }).toUpperCase()}`;
				extraEvents.push(...makeFulfillment(template, orderId, orderMs, cat, p.price_usd, null));
			}
		}
	}

	// ── assemble ──
	for (const unit of unitList) {
		for (const ev of unit.derived) {
			if (ev.event === "$experiment_started" || SERVER_EVENTS.has(ev.event) || ev.event === "return requested" || ev.event === "review submitted") continue;
			extraEvents.push(ev);
		}
	}
	events = events.filter((e) => !dropSet.has(e)).concat(extraEvents.filter((e) => !dropSet.has(e)));

	// ── H8 + organic lapse (new users): shopper actions stop after the cut ──
	if (born && birthMs !== null) {
		const saves = events.filter((e) => e.event === "product added to wishlist" && T(e) >= birthMs && T(e) < birthMs + WISHLIST_DAYS * DAY_MS).length;
		const cuts = [];
		const dark = saves < WISHLIST_MIN ? DARK_SHARE_BY_SAVES[saves] : 0;
		if (salt(uid, "dark") < dark) cuts.push(birthMs + (DARK_AFTER_DAYS + salt(uid, "dark-day") * DARK_SPREAD_DAYS) * DAY_MS);
		if (salt(uid, "lapse") < LAPSE_SHARE) cuts.push(birthMs + (LAPSE_DAY[0] + salt(uid, "lapse-day") * (LAPSE_DAY[1] - LAPSE_DAY[0])) * DAY_MS);
		if (cuts.length) {
			const cut = Math.min(...cuts);
			const lateCarts = new Set(unitList.filter((un) => unitStart(un) >= cut).map((un) => un.id));
			const lateOrders = new Set([...lateCarts].map(orderIdFor));
			events = events.filter((e) => {
				if (e.cart_id && lateCarts.has(e.cart_id)) return false;
				if (e.order_id && lateOrders.has(e.order_id)) return false;
				if (SERVER_EVENTS.has(e.event)) return true;
				return T(e) < cut;
			});
		}
	}

	// ── profile ──
	if (signup) profile.customer_since = dayKey(birthMs);
	if (profile[EXP_KEY] !== undefined && !events.some((e) => e.event === "$experiment_started")) delete profile[EXP_KEY];
	return events;
}

// warehouse rows: exogenous business facts layered on event-derived volumes
function handleWarehouse(row, meta) {
	if (meta.isBackfill) return row;
	if (meta.metricName === "marketing_spend_daily") {
		// the source counts Mixpanel signups; billed spend is the paced budget
		row.spend_usd = paidSpend(row.date, row.acquisition_channel);
		return row;
	}
	if (meta.metricName === "carrier_performance_daily") {
		// carriers also move wholesale and marketplace parcels that never reach Mixpanel
		const k = `${row.date}|${row.shipping_carrier}`;
		const extra = (WHOLESALE_PARCELS[row.shipping_carrier] || 0) * jitter(`whp|${k}`, 0.45);
		row.parcels_shipped = Math.round(row.parcels_shipped * jitter(`scan|${k}`, 0.06) + extra);
		row.late_parcels = Math.round(row.parcels_shipped * (1 - row.on_time_rate));
		return row;
	}
	if (meta.metricName === "inventory_daily") {
		// wholesale and retail-partner units ship from the same stock
		const k = `${row.date}|${row.primary_category}`;
		const bulk = hashFloat(`bulk|${k}`) < BULK_DAY_SHARE ? Math.round((WHOLESALE_UNITS[row.primary_category] || 0) * (1 + hashFloat(`bulk-n|${k}`) * 2)) : 0;
		row.units_shipped = Math.round(row.units_shipped * jitter(`ret|${k}`, 0.08) + (WHOLESALE_UNITS[row.primary_category] || 0) * jitter(`whu|${k}`, 0.5) + bulk);
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
	// consumer shopping: weekend- and evening-heavy (US time zones in UTC)
	soup: { dayOfWeekWeights: DOW_WEIGHTS, hourOfDayWeights: HOUR_WEIGHTS },
	credentials: { token },
	switches: {
		hasSessionIds: true,
		alsoInferFunnels: false,
		hasLocation: true,
		hasAndroidDevices: true,
		hasIOSDevices: true,
		hasDesktopDevices: true,
		hasBrowser: true,
		hasCampaigns: false,
		isAnonymous: false,
		hasAdSpend: false,
		hasAvatar: true,
	},
	singleCountry: "US",
	identity: { avgDevicePerUser: 2 },
	stickyEventProps: ["membership"],

	events: [
		{
			event: "account created",
			weight: 1,
			isFirstEvent: true,
			isAuthEvent: true,
			properties: {
				signup_method: { __weights: { email: 45, google: 30, apple: 20, facebook: 5 } },
				acquisition_channel: (ctx) => ctx.profile.acquisition_channel,
			},
		},
		{
			event: "category browsed",
			weight: 1,
			properties: {
				category: ["bedding"],
				sort_by: { __weights: { featured: 50, bestselling: 20, newest: 15, price_low_high: 10, price_high_low: 5 } },
			},
		},
		{
			event: "product viewed",
			weight: 1,
			properties: {
				product_id: ["unassigned"],
				product_name: ["unassigned"],
				category: ["bedding"],
				price_usd: [0],
			},
		},
		{
			event: "product searched",
			weight: 1,
			properties: {
				search_term: ["sheets"],
				results_count: u.weighNumRange(0, 140, 0.4, 30),
			},
		},
		{
			event: "home page viewed",
			weight: 5,
			properties: {
				home_module: { __weights: { new_arrivals: 30, bestsellers: 25, seasonal_edit: 20, recently_viewed: 15, room_inspiration: 10 } },
			},
		},
		{
			event: "product added to wishlist",
			weight: 5,
			properties: {
				product_id: ["unassigned"],
				product_name: ["unassigned"],
				category: ["bedding"],
				price_usd: [0],
			},
		},
		{
			event: "product reviews read",
			weight: 2,
			properties: {
				product_id: ["unassigned"],
				category: ["bedding"],
				reviews_shown: u.weighNumRange(3, 60, 0.5, 20),
			},
		},
		{
			event: "order history viewed",
			weight: 1,
			properties: {
				orders_listed: u.weighNumRange(1, 12, 0.4, 6),
			},
		},
		{
			event: "product added to cart",
			weight: 1,
			isStrictEvent: true,
			properties: {
				cart_id: ["unassigned"],
				product_id: ["unassigned"],
				product_name: ["unassigned"],
				category: ["bedding"],
				price_usd: [0],
				quantity: [1],
			},
		},
		{
			event: "cart viewed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				cart_id: ["unassigned"],
				cart_items: [1],
				cart_value_usd: [0],
			},
		},
		{
			event: "checkout started",
			weight: 1,
			isStrictEvent: true,
			properties: {
				cart_id: ["unassigned"],
				cart_items: [1],
				cart_value_usd: [0],
			},
		},
		{
			event: "shipping info entered",
			weight: 1,
			isStrictEvent: true,
			properties: {
				cart_id: ["unassigned"],
				ship_country: ["US"],
				address_type: { __weights: { home: 82, gift_recipient: 10, work: 8 } },
			},
		},
		{
			event: "payment info entered",
			weight: 1,
			isStrictEvent: true,
			properties: {
				cart_id: ["unassigned"],
				payment_method: ["credit_card"],
			},
		},
		{
			event: "order completed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				cart_id: ["unassigned"],
				order_id: ["unassigned"],
				item_count: [1],
				primary_category: ["bedding"],
				subtotal_usd: [0],
				discount_code: ["none"],
				discount_usd: [0],
				shipping_usd: [0],
				free_shipping: [false],
				order_total_usd: [0],
				payment_method: ["credit_card"],
				ship_country: ["US"],
			},
		},
		{
			event: "order shipped",
			weight: 1,
			isStrictEvent: true,
			properties: {
				order_id: ["unassigned"],
				shipping_carrier: ["northline"],
				ship_country: ["US"],
			},
		},
		{
			event: "order delivered",
			weight: 1,
			isStrictEvent: true,
			properties: {
				order_id: ["unassigned"],
				shipping_carrier: ["northline"],
				ship_country: ["US"],
				delivery_days: [0],
				on_time: [true],
			},
		},
		{
			event: "return requested",
			weight: 1,
			isStrictEvent: true,
			properties: {
				order_id: ["unassigned"],
				category: ["bedding"],
				return_reason: ["changed_mind"],
				refund_usd: [0],
			},
		},
		{
			event: "review submitted",
			weight: 1,
			isStrictEvent: true,
			properties: {
				order_id: ["unassigned"],
				category: ["bedding"],
				rating: [5],
			},
		},
		{
			event: "room visualizer opened",
			weight: 1,
			isStrictEvent: true,
			properties: {
				product_id: ["unassigned"],
				product_name: ["unassigned"],
				category: ["furniture"],
				price_usd: [0],
			},
		},
		{
			event: "$experiment_started",
			weight: 1,
			isStrictEvent: true,
			properties: {
				"Experiment name": [CHECKOUT_TEST],
				"Variant name": ["Control", CHECKOUT_VARIANT],
			},
		},
	],

	funnels: [
		{
			name: "Visit to Account",
			sequence: ["category browsed", "product viewed", "account created"],
			isFirstFunnel: true,
			conversionRate: 100,
			timeToConvert: 0.5,
			order: "sequential",
			weight: 1,
		},
		{
			name: "Discovery",
			sequence: ["category browsed", "product viewed", "product viewed"],
			conversionRate: 70,
			timeToConvert: 0.4,
			order: "sequential",
			requireRepeats: true,
			weight: 6,
		},
		{
			name: "Search",
			sequence: ["product searched", "product viewed"],
			conversionRate: 75,
			timeToConvert: 0.2,
			order: "sequential",
			weight: 2,
		},
		{
			name: "Checkout",
			sequence: CHECKOUT_STEPS,
			conversionRate: CHECKOUT_CONV,
			timeToConvert: CHECKOUT_TTC_H,
			order: "sequential",
			weight: 2,
			experiment: {
				name: CHECKOUT_TEST,
				startDaysBeforeEnd: (END_MS / 1000 - ms(CHECKOUT_TEST_START) / 1000) / 86400,
				variants: [
					{ name: "Control" },
					{ name: CHECKOUT_VARIANT, conversionMultiplier: ONE_PAGE_CONV_MULT, ttcMultiplier: ONE_PAGE_TTC_MULT },
				],
			},
		},
	],

	worldEvents: [
		{
			name: "labor_day_sale",
			type: "campaign",
			startDay: dayIndex(LABOR_DAY_START),
			duration: (ms(LABOR_DAY_END) - ms(LABOR_DAY_START)) / DAY_MS,
			conversionModifier: LABOR_DAY_CONV_MULT,
			affectsEvents: ["order completed"],
		},
		{
			name: "labor_day_traffic",
			type: "campaign",
			startDay: dayIndex(LABOR_DAY_START),
			duration: (ms(LABOR_DAY_END) - ms(LABOR_DAY_START)) / DAY_MS,
			volumeMultiplier: LABOR_DAY_TRAFFIC_MULT,
			affectsEvents: ["product viewed", "category browsed"],
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
				clicks: (ctx) => Math.round(paidSpend(dayKey(ctx.time), ctx.seriesKey) / (CPC_USD[ctx.seriesKey] * jitter(`cpc|${dayKey(ctx.time)}|${ctx.seriesKey}`, 0.15))),
				impressions: (ctx) => Math.round(ctx.row.clicks / (CTR[ctx.seriesKey] * jitter(`ctr|${dayKey(ctx.time)}|${ctx.seriesKey}`, 0.15))),
				// ad platforms claim purchases with their own (view-through) attribution
				platform_attributed_purchases: (ctx) => Math.round(paidSpend(dayKey(ctx.time), ctx.seriesKey) / CPS_USD[ctx.seriesKey] * 0.55 * PLATFORM_PURCHASE_INFLATION[ctx.seriesKey] * jitter(`pap|${dayKey(ctx.time)}|${ctx.seriesKey}`, 0.3)),
			},
		},
		{
			name: "carrier_performance_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "order shipped",
				measure: "count",
				groupBy: "shipping_carrier",
			},
			timeColumn: "date",
			valueColumn: "parcels_shipped",
			columns: {
				on_time_rate: (ctx) => carrierOnTime(ctx.seriesKey, ctx.time),
				avg_transit_days: (ctx) => carrierTransit(ctx.seriesKey, ctx.time),
				late_parcels: 0,
				service_status: (ctx) => (ctx.seriesKey === DISRUPTED_CARRIER && inDisruption(ctx.time) ? "disrupted" : "normal"),
			},
		},
		{
			name: "inventory_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "order completed",
				measure: "sum",
				property: "item_count",
				groupBy: "primary_category",
			},
			timeColumn: "date",
			valueColumn: "units_shipped",
			columns: {
				skus_active: (ctx) => SKUS_ACTIVE[ctx.seriesKey],
				skus_out_of_stock: (ctx) => oosSkus(ctx.seriesKey, ctx.time),
				in_stock_rate: (ctx) => Math.round((1 - oosSkus(ctx.seriesKey, ctx.time) / SKUS_ACTIVE[ctx.seriesKey]) * 1000) / 1000,
				units_on_hand: (ctx) => Math.round(ON_HAND_BASE[ctx.seriesKey] * (1 - 0.9 * stockoutShare(ctx.seriesKey, ctx.time)) * jitter(`oh|${dayKey(ctx.time)}|${ctx.seriesKey}`, 0.1)),
			},
		},
	],

	superProps: {
		platform: ["web"],
	},

	userProps: {
		shopper_segment: ["home_refresher"],
		membership: ["standard"],
		ship_country: ["US"],
		acquisition_channel: { __weights: CHANNEL_WEIGHTS },
		customer_since: ["2025-01-01"],
	},

	personas: [
		{ name: "home_refresher", weight: 35, eventMultiplier: 1.0, properties: { shopper_segment: "home_refresher" } },
		{ name: "deal_seeker", weight: 25, eventMultiplier: 1.15, properties: { shopper_segment: "deal_seeker" } },
		{ name: "new_mover", weight: 15, eventMultiplier: 1.5, properties: { shopper_segment: "new_mover" } },
		{ name: "casual_gifter", weight: 25, eventMultiplier: 0.6, properties: { shopper_segment: "casual_gifter" } },
	],

	// new users' active days (also pins each new user's first visit to their creation time)
	retentionCurve: { type: "logarithmic", day1: 0.5, day7: 0.35, day30: 0.25 },

	hook(record, type, meta) {
		if (type === "user") return handleUserHook(record, meta);
		if (type === "funnel-pre") return handleFunnelPre(record, meta);
		if (type === "everything") return handleEverything(record, meta);
		if (type === "warehouse") return handleWarehouse(record, meta);
		return record;
	},
};

SOURCE_ONLY_KEYS = [...new Set(config.events.flatMap((e) => Object.keys(e.properties || {})))];

export default config;

// ── STORIES ──────────────────────────────────────────────────────────────
// Machine-checkable contract for hooks H1-H10. Evaluate with:
//   node dungeons/vertical/ecommerce/ecommerce.verify.mjs
const EV = `read_json_auto('{{PREFIX}}-EVENTS*.json*', sample_size=-1, union_by_name=true)`;
const US = `read_json_auto('{{PREFIX}}-USERS*.json*', sample_size=-1, union_by_name=true)`;
const WH = (table) => `read_json_auto('{{PREFIX}}-WAREHOUSE-${table}.json*', sample_size=-1, union_by_name=true)`;

// Identity prelude: a device resolves to the user seen with it on any event
// carrying both ids (emitted stitch evidence, as Mixpanel merges); pre-signup
// browsing (device_id only) joins its user through the account created event.
const ID_CTE = `dmap AS (SELECT device_id, min(user_id::VARCHAR) AS mapped FROM ${EV}
  WHERE user_id IS NOT NULL AND device_id IS NOT NULL GROUP BY 1),
ev AS (SELECT coalesce(e.user_id::VARCHAR, m.mapped) AS uid, e.time::TIMESTAMP AS t, e.*
  FROM ${EV} e LEFT JOIN dmap m ON e.device_id = m.device_id)`;
// One row per cart (cart_id is shared by every step of a cart): the Mixpanel
// funnel "product added to cart → order completed", Totals, hold cart_id
// constant, 1-day conversion window.
const CARTS_CTE = `carts AS (SELECT cart_id, any_value(uid) AS uid,
  min(t) FILTER (WHERE event = 'product added to cart') AS t_add,
  min(t) FILTER (WHERE event = 'order completed') AS t_ord,
  arg_min(category, t) FILTER (WHERE event = 'product added to cart') AS category,
  any_value(membership) AS membership
  FROM ev WHERE cart_id IS NOT NULL AND cart_id <> 'unassigned' GROUP BY 1),
cc AS (SELECT *, (t_ord IS NOT NULL AND t_ord >= t_add AND t_ord < t_add + INTERVAL ${CHECKOUT_WINDOW_DAYS} DAY) AS converted,
  CASE WHEN t_ord >= t_add AND t_ord < t_add + INTERVAL ${CHECKOUT_WINDOW_DAYS} DAY THEN date_diff('second', t_add, t_ord) END AS ttc_s
  FROM carts WHERE t_add IS NOT NULL),
prof AS (SELECT distinct_id::VARCHAR AS uid, ship_country, membership AS plan, "${EXP_KEY}" AS variant FROM ${US})`;

const TS = (iso) => dayjs.utc(iso).format("YYYY-MM-DD HH:mm:ss");
const D = (iso) => iso.slice(0, 10);
const band = (k) => [Math.round(k * 0.9 * 1000) / 1000, Math.round(k * 1.1 * 1000) / 1000];
const shiftDays = (iso, n) => TS(dayjs.utc(iso).add(n, "day").toISOString());
const SHOPPER_FILTER = `event NOT IN ('order shipped', 'order delivered')`;
const H10_BASE_DAYS = 11;
// control categories: never bought as small add-ons, so their adds per view do
// not move with the free-shipping threshold (add-on adds land in decor,
// kitchen, bath, and dining, more often under the $50 bar than the $75 bar)
const H10_CONTROL = CATEGORIES.filter((c) => c !== STOCKOUT_CATEGORY && !ADDON_CATEGORIES.includes(c));
const LD_DAYS = (ms(LABOR_DAY_END) - ms(LABOR_DAY_START)) / DAY_MS;

const H1_SQL = `WITH ${ID_CTE},
o AS (SELECT uid, subtotal_usd AS s, membership AS m,
  CASE WHEN t >= TIMESTAMP '${TS(FREE_SHIP_CHANGE)}' THEN ${FREE_SHIP_NEW} ELSE ${FREE_SHIP_OLD} END AS thr
  FROM ev WHERE event = 'order completed' AND ship_country = 'US')
SELECT m AS grp, count(DISTINCT uid) AS user_count, count(*) AS orders, avg((s < thr)::INT) AS share_below
FROM o WHERE s >= thr - ${BUMP_WINDOW} AND s < thr + ${BUMP_WINDOW} GROUP BY 1`;

const H2_SQL = `WITH ${ID_CTE}, ${CARTS_CTE}
SELECT p.variant AS grp, count(DISTINCT cc.uid) AS user_count, count(*) AS carts, avg(converted::INT) AS conv,
 median(ttc_s) AS med_ttc_s, avg(o.subtotal_usd) AS aov
FROM cc JOIN prof p ON p.uid = cc.uid
LEFT JOIN (SELECT cart_id, subtotal_usd FROM ev WHERE event = 'order completed') o ON o.cart_id = cc.cart_id AND cc.converted
WHERE cc.t_add >= TIMESTAMP '${TS(CHECKOUT_TEST_START)}' AND p.variant IS NOT NULL GROUP BY 1`;

const H3_SQL = `WITH ${ID_CTE}, ${CARTS_CTE}
SELECT CASE WHEN p.ship_country = 'US' THEN 'us' WHEN p.ship_country = 'CA' THEN 'ca' ELSE 'gb' END
  || CASE WHEN cc.t_add >= TIMESTAMP '${TS(CANADA_DDP_START)}' THEN '_post' ELSE '_pre' END AS grp,
 count(DISTINCT cc.uid) AS user_count, count(*) AS carts, avg(converted::INT) AS conv
FROM cc JOIN prof p ON p.uid = cc.uid GROUP BY 1
UNION ALL
SELECT 'intl_pre' AS grp, count(DISTINCT cc.uid) AS user_count, count(*) AS carts, avg(converted::INT) AS conv
FROM cc JOIN prof p ON p.uid = cc.uid WHERE p.ship_country <> 'US' AND cc.t_add < TIMESTAMP '${TS(CANADA_DDP_START)}'`;

const H4_SQL = `WITH ${ID_CTE}, ${CARTS_CTE}
SELECT membership AS grp, count(DISTINCT uid) AS user_count, count(*) AS carts, avg(converted::INT) AS conv, median(ttc_s) AS med_ttc_s
FROM cc GROUP BY 1`;

// H5: disrupted carrier-days come from the warehouse; each customer's
// reference order is their first order (by order time) that shipped on a day
// any carrier was disrupted; affected = it shipped with the disrupted carrier.
const H5_SQL = `WITH ${ID_CTE},
dis AS (SELECT date::DATE AS d, shipping_carrier FROM ${WH("carrier_performance_daily")} WHERE service_status = 'disrupted'),
ddays AS (SELECT DISTINCT d FROM dis),
sh AS (SELECT s.uid, s.order_id, s.t AS ship_t, s.shipping_carrier, o.t AS ord_t FROM ev s
  JOIN ev o ON o.order_id = s.order_id AND o.event = 'order completed' WHERE s.event = 'order shipped' AND s.ship_country = 'US'),
r AS (SELECT uid, arg_min(shipping_carrier, ord_t) AS carrier, arg_min(ship_t, ord_t) AS ship_t, min(ord_t) AS ref_t FROM sh
  WHERE ship_t::DATE IN (SELECT d FROM ddays) GROUP BY 1),
x AS (SELECT r.uid, (r.carrier, r.ship_t::DATE) IN (SELECT (shipping_carrier, d) FROM dis) AS affected,
  EXISTS (SELECT 1 FROM ev o WHERE o.uid = r.uid AND o.event = 'order completed' AND o.t > r.ref_t AND o.t <= r.ref_t + INTERVAL ${REPEAT_WINDOW_DAYS} DAY) AS repeat_order FROM r)
SELECT CASE WHEN affected THEN 'affected' ELSE 'other_carriers' END AS grp, count(*) AS user_count, avg(repeat_order::INT) AS repeat_rate FROM x GROUP BY 1`;

const H5_DELAY_SQL = `WITH ${ID_CTE},
dis AS (SELECT date::DATE AS d, shipping_carrier FROM ${WH("carrier_performance_daily")} WHERE service_status = 'disrupted'),
sh AS (SELECT order_id, t::DATE AS ship_d, shipping_carrier FROM ev WHERE event = 'order shipped'),
dl AS (SELECT d.uid, d.delivery_days, (sh.shipping_carrier, sh.ship_d) IN (SELECT (shipping_carrier, d) FROM dis) AS disrupted
  FROM ev d JOIN sh ON sh.order_id = d.order_id WHERE d.event = 'order delivered' AND sh.shipping_carrier = '${DISRUPTED_CARRIER}')
SELECT 'all' AS grp, count(DISTINCT uid) FILTER (WHERE disrupted) AS user_count,
 avg(delivery_days) FILTER (WHERE disrupted) - avg(delivery_days) FILTER (WHERE NOT disrupted) AS extra_days FROM dl`;

const H6_SPEND_SQL = `WITH ${ID_CTE},
s AS (SELECT acquisition_channel AS ch, count(*) AS signups, count(DISTINCT uid) AS users FROM ev WHERE event = 'account created' GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM ${WH("marketing_spend_daily")} GROUP BY 1)
SELECT s.ch AS grp, s.users AS user_count, sp.spend / s.signups AS spend_per_signup FROM s JOIN sp ON sp.ch = s.ch`;

const H6_FIRST_ORDER_SQL = `WITH ${ID_CTE},
s AS (SELECT uid, t AS t0, acquisition_channel AS ch FROM ev WHERE event = 'account created' AND t < TIMESTAMP '${TS(SIGNUP_COHORT_END)}'),
b AS (SELECT DISTINCT s.uid FROM s JOIN ev e ON e.uid = s.uid AND e.event = 'order completed'
  AND e.t >= s.t0 AND e.t < s.t0 + INTERVAL ${FIRST_ORDER_WINDOW_DAYS} DAY)
SELECT s.ch AS grp, count(*) AS user_count, count(b.uid)::DOUBLE / count(*) AS first_order_rate FROM s LEFT JOIN b ON b.uid = s.uid GROUP BY 1`;

const H7_CONV_SQL = `WITH ${ID_CTE}, ${CARTS_CTE}
SELECT CASE WHEN t_add >= TIMESTAMP '${TS(LABOR_DAY_START)}' THEN 'sale' ELSE 'before' END AS grp,
 count(DISTINCT cc.uid) AS user_count, count(*) AS carts, avg(converted::INT) AS conv
FROM cc JOIN prof p ON p.uid = cc.uid
WHERE p.ship_country = 'US' AND t_add >= TIMESTAMP '${shiftDays(LABOR_DAY_START, -14)}' AND t_add < TIMESTAMP '${TS(LABOR_DAY_END)}' GROUP BY 1`;

// traffic: category browses per day, sale days vs the same weekdays (Fri-Mon) of the two weeks before
const H7_TRAFFIC_SQL = `WITH ${ID_CTE}
SELECT CASE WHEN t >= TIMESTAMP '${TS(LABOR_DAY_START)}' THEN 'sale' ELSE 'before' END AS grp,
 count(DISTINCT uid) AS user_count, count(*)::DOUBLE / (CASE WHEN t >= TIMESTAMP '${TS(LABOR_DAY_START)}' THEN ${LD_DAYS} ELSE ${2 * LD_DAYS} END) AS per_day
FROM ev WHERE event = 'category browsed' AND (
  (t >= TIMESTAMP '${TS(LABOR_DAY_START)}' AND t < TIMESTAMP '${TS(LABOR_DAY_END)}')
  OR (t >= TIMESTAMP '${shiftDays(LABOR_DAY_START, -7)}' AND t < TIMESTAMP '${shiftDays(LABOR_DAY_END, -7)}')
  OR (t >= TIMESTAMP '${shiftDays(LABOR_DAY_START, -14)}' AND t < TIMESTAMP '${shiftDays(LABOR_DAY_END, -14)}'))
GROUP BY 1, (t >= TIMESTAMP '${TS(LABOR_DAY_START)}')`;

const H7_CODE_SQL = `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 count(*) FILTER (WHERE (discount_code = '${LABOR_DAY_CODE}') <> (t >= TIMESTAMP '${TS(LABOR_DAY_START)}' AND t < TIMESTAMP '${TS(LABOR_DAY_END)}')) AS mismatched
FROM ev WHERE event = 'order completed'`;

const H8_SQL = `WITH ${ID_CTE},
s AS (SELECT uid, t AS t0 FROM ev WHERE event = 'account created' AND t < TIMESTAMP '${TS(DATASET_END)}' - INTERVAL ${RETENTION_DAY + 7} DAY),
f AS (SELECT s.uid,
  count(*) FILTER (WHERE e.event = 'product added to wishlist' AND e.t < s.t0 + INTERVAL ${WISHLIST_DAYS} DAY) AS saves,
  count(*) FILTER (WHERE e.${SHOPPER_FILTER} AND e.t >= s.t0 + INTERVAL ${RETENTION_DAY} DAY AND e.t < s.t0 + INTERVAL ${RETENTION_DAY + 7} DAY) AS ret
  FROM s JOIN ev e ON e.uid = s.uid GROUP BY 1)
SELECT CASE WHEN saves >= ${WISHLIST_MIN} THEN 'three_plus' WHEN saves = 0 THEN 'none' ELSE 'one_two' END AS grp, count(*) AS user_count,
 avg((ret > 0)::INT) AS retention FROM f GROUP BY 1`;

// a furniture cart "used the visualizer" when the shopper opened it on the same product in the 10 minutes before the first add
const H9_CARTS_CTE = `${CARTS_CTE},
viz AS (SELECT uid, product_id, t FROM ev WHERE event = 'room visualizer opened'),
fa AS (SELECT cart_id, uid, product_id, t AS t_add FROM (SELECT cart_id, uid, product_id, t, row_number() OVER (PARTITION BY cart_id ORDER BY t) AS rn
  FROM ev WHERE event = 'product added to cart') WHERE rn = 1),
fc AS (SELECT cc.*, EXISTS (SELECT 1 FROM viz v JOIN fa ON fa.cart_id = cc.cart_id
  WHERE v.uid = cc.uid AND v.product_id = fa.product_id AND v.t <= cc.t_add AND v.t > cc.t_add - INTERVAL 10 MINUTE) AS used_viz
  FROM cc JOIN prof p ON p.uid = cc.uid WHERE p.ship_country = 'US' AND category IN (${VIZ_CATEGORIES.map((c) => `'${c}'`).join(", ")}) AND t_add >= TIMESTAMP '${TS(VISUALIZER_LAUNCH)}')`;
const H9_SQL = `WITH ${ID_CTE}, ${H9_CARTS_CTE}
SELECT CASE WHEN used_viz THEN 'visualizer' ELSE 'no_visualizer' END AS grp, count(DISTINCT uid) AS user_count, count(*) AS carts, avg(converted::INT) AS conv
FROM fc GROUP BY 1`;
const H9_ADOPTION_SQL = `WITH ${ID_CTE}, ${H9_CARTS_CTE}
SELECT 'ramped' AS grp, count(DISTINCT uid) AS user_count, avg(used_viz::INT) AS viz_share,
 (SELECT count(*) FROM ev WHERE event = 'room visualizer opened' AND t < TIMESTAMP '${TS(VISUALIZER_LAUNCH)}') AS pre_launch
FROM fc WHERE t_add >= TIMESTAMP '${shiftDays(VISUALIZER_LAUNCH, VIZ_RAMP_DAYS)}'`;

// H10: stockout days come from the warehouse (bedding in_stock_rate well below normal)
const H10_SQL = `WITH ${ID_CTE},
oos AS (SELECT date::DATE AS d FROM ${WH("inventory_daily")} WHERE primary_category = '${STOCKOUT_CATEGORY}' AND in_stock_rate < 0.8),
w AS (SELECT uid, category = '${STOCKOUT_CATEGORY}' AS target, t::DATE IN (SELECT d FROM oos) AS stockout, event FROM ev
  WHERE event IN ('product viewed', 'product added to cart') AND category IN ('${STOCKOUT_CATEGORY}', ${H10_CONTROL.map((c) => `'${c}'`).join(", ")})
  AND t >= (SELECT min(d) FROM oos) - INTERVAL ${H10_BASE_DAYS} DAY AND t < (SELECT max(d) FROM oos) + INTERVAL ${H10_BASE_DAYS + 1} DAY),
g AS (SELECT target, stockout, count(*) FILTER (WHERE event = 'product added to cart')::DOUBLE / count(*) FILTER (WHERE event = 'product viewed') AS apv, count(DISTINCT uid) AS users FROM w GROUP BY 1, 2)
SELECT 'all' AS grp, min(users) AS user_count,
 (max(apv) FILTER (WHERE target AND stockout) / max(apv) FILTER (WHERE target AND NOT stockout))
 / (max(apv) FILTER (WHERE NOT target AND stockout) / max(apv) FILTER (WHERE NOT target AND NOT stockout)) AS did
FROM g`;
const H10_WH_SQL = `SELECT 'all' AS grp,
 avg(in_stock_rate) FILTER (WHERE date::DATE >= DATE '${D(BEDDING_STOCKOUT_START)}' AND date::DATE < DATE '${D(BEDDING_STOCKOUT_END)}') AS stockout_in_stock,
 count(*) FILTER (WHERE in_stock_rate < 0.8) AS low_rows
FROM ${WH("inventory_daily")} WHERE primary_category = '${STOCKOUT_CATEGORY}'`;

/** @type {import("../../../types").DungeonStory[]} */
export const stories = [
	{
		id: "H1-free-shipping-threshold",
		hook: "H1",
		archetype: "bespoke",
		narrative: `Threshold behavior (magic number). Standard US shoppers pay $${SHIP_FEE_US} shipping below the free-shipping threshold ($${FREE_SHIP_OLD} until ${D(FREE_SHIP_CHANGE)}, $${FREE_SHIP_NEW} from then). When a standard cart sits within $${BUMP_WINDOW} below the threshold in force, the shopper adds an add-on item ${BUMP_SHARE * 100}% of the time, and the add-on always lands the cart within $${BUMP_WINDOW} above it. Pine Plus members ship free on every order and never do. Cart contents are drawn the same way for both groups, so within the ±$${BUMP_WINDOW} window around the threshold the share of standard orders just below it is ${1 - BUMP_SHARE} of the members' share. The bunching follows the threshold when it moves on ${D(FREE_SHIP_CHANGE)}. Shipping is charged exactly on standard US orders below the threshold.`,
		mixpanelReport: { type: "Insights", event: "order completed", measure: "total", breakdown: `subtotal_usd (custom $5 buckets)`, filter: "ship_country = US", compare: "membership; before vs after 2026-08-05" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H1_SQL },
				select: { s: { where: { grp: "standard" } }, p: { where: { grp: "pine_plus" } } },
				expect: { metric: "s.share_below / p.share_below", op: "between", target: band(1 - BUMP_SHARE) },
				minCohort: 500,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 count(*) FILTER (WHERE (shipping_usd > 0) <> (membership = 'standard' AND subtotal_usd < CASE WHEN t >= TIMESTAMP '${TS(FREE_SHIP_CHANGE)}' THEN ${FREE_SHIP_NEW} ELSE ${FREE_SHIP_OLD} END)) AS wrong_shipping
FROM ev WHERE event = 'order completed' AND ship_country = 'US'`,
				},
				select: { a: { where: { grp: "all" } } },
				// exact: shipping is charged on, and only on, standard US orders under the threshold
				expect: { metric: "a.wrong_shipping", op: "between", target: [0, 0] },
			},
		],
	},
	{
		id: "H2-one-page-checkout-experiment",
		hook: "H2",
		archetype: "experiment-lift",
		narrative: `The "${CHECKOUT_TEST}" test starts ${D(CHECKOUT_TEST_START)}: every cart started from then exposes the shopper (sticky 50/50 hash per user). "${CHECKOUT_VARIANT}" multiplies per-cart conversion by ${ONE_PAGE_CONV_MULT} and cart → order time by ${ONE_PAGE_TTC_MULT}. Cart contents do not depend on the variant, so average order value is unchanged (honest null). Every step of a cart shares a cart_id, so the funnel product added to cart → order completed with Totals, cart_id held constant, and a ${CHECKOUT_WINDOW_DAYS}-day window reads per-cart conversion. Segment effects (country, category, Labor Day, Room Visualizer) multiply the rate and are independent of the variant.`,
		mixpanelReport: { type: "Funnels", steps: ["product added to cart", "order completed"], counting: "totals", holdPropertyConstant: "cart_id", window: "1 day", breakdown: `user property "${EXP_KEY}"`, dates: `${D(CHECKOUT_TEST_START)} → ${D(DATASET_END)}` },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H2_SQL },
				select: { v: { where: { grp: CHECKOUT_VARIANT } }, c: { where: { grp: "Control" } } },
				expect: { metric: "v.conv / c.conv", op: "between", target: band(ONE_PAGE_CONV_MULT) },
				minCohort: 2000,
			},
			{
				breakdown: { type: "duckdb", sql: H2_SQL },
				select: { v: { where: { grp: CHECKOUT_VARIANT } }, c: { where: { grp: "Control" } } },
				expect: { metric: "v.med_ttc_s / c.med_ttc_s", op: "between", target: band(ONE_PAGE_TTC_MULT) },
				minCohort: 2000,
			},
			{
				breakdown: { type: "duckdb", sql: H2_SQL },
				select: { v: { where: { grp: CHECKOUT_VARIANT } }, c: { where: { grp: "Control" } } },
				// honest null: the variant changes conversion, not cart contents
				expect: { metric: "v.aov / c.aov", op: "between", target: band(1) },
				minCohort: 2000,
			},
		],
	},
	{
		id: "H3-cross-border-duties",
		hook: "H3",
		archetype: "funnel-conversion-by-segment",
		narrative: `Canadian and UK shoppers see duties and import taxes only at final review, so ${INTL_LAST_STEP_LOSS * 100}% of their would-be orders end at payment info entered: per-cart conversion is ${1 - INTL_LAST_STEP_LOSS} of the US rate, and the loss sits on the last step. From ${D(CANADA_DDP_START)} Canada shows duties-included prices (DDP pilot) and converts like the US; the UK does not change. Country is drawn independently of every other shopper trait.`,
		mixpanelReport: { type: "Funnels", steps: CHECKOUT_STEPS, counting: "totals", holdPropertyConstant: "cart_id", window: "1 day", breakdown: "user property ship_country", dates: `before vs after ${D(CANADA_DDP_START)}` },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H3_SQL },
				select: { i: { where: { grp: "intl_pre" } }, u: { where: { grp: "us_pre" } } },
				expect: { metric: "i.conv / u.conv", op: "between", target: band(1 - INTL_LAST_STEP_LOSS) },
				minCohort: 500,
			},
			{
				breakdown: { type: "duckdb", sql: H3_SQL },
				select: { c: { where: { grp: "ca_post" } }, u: { where: { grp: "us_post" } } },
				// the DDP pilot removes the last-step loss for Canada
				expect: { metric: "c.conv / u.conv", op: "between", target: band(1) },
				minCohort: 300,
			},
		],
	},
	{
		id: "H4-pine-plus-checkout-speed",
		hook: "H4",
		archetype: "funnel-ttc-by-segment",
		narrative: `Pine Plus members check out in ${PLUS_TTC_MULT}x the time of standard shoppers (saved address and payment): the median time from a cart's first add to its order. Conversion is unchanged (control). Membership is drawn independently of the experiment arm and country.`,
		mixpanelReport: { type: "Funnels", steps: ["product added to cart", "order completed"], measure: "median time to convert", counting: "totals", holdPropertyConstant: "cart_id", breakdown: "membership" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H4_SQL },
				select: { p: { where: { grp: "pine_plus" } }, s: { where: { grp: "standard" } } },
				expect: { metric: "p.med_ttc_s / s.med_ttc_s", op: "between", target: band(PLUS_TTC_MULT) },
				minCohort: 1000,
			},
			{
				breakdown: { type: "duckdb", sql: H4_SQL },
				select: { p: { where: { grp: "pine_plus" } }, s: { where: { grp: "standard" } } },
				expect: { metric: "p.conv / s.conv", op: "between", target: band(1) },
				minCohort: 1000,
			},
		],
	},
	{
		id: "H5-carrier-disruption-repeat-orders",
		hook: "H5",
		archetype: "retention-divergence",
		narrative: `External-table join. Northline Parcel's hub disruption (${D(CARRIER_DISRUPTION_START)} to ${D(dayjs.utc(CARRIER_DISRUPTION_END).subtract(1, "day").toISOString())}) adds ${DISRUPTION_DELAY_DAYS[0]}-${DISRUPTION_DELAY_DAYS[1]} days to every Northline parcel shipped in it; the warehouse table carrier_performance_daily marks those carrier-days service_status = 'disrupted'. A customer whose first order shipped on those days went with Northline places no further order for ${REPEAT_WINDOW_DAYS} days ${REPEAT_LOSS * 100}% of the time, so their ${REPEAT_WINDOW_DAYS}-day repeat-order rate is ${1 - REPEAT_LOSS} of US customers whose first order on those days shipped with another US carrier (Bluejay or ParcelPost; the carrier is assigned per order by hash, independent of the shopper; Northline ships US orders only, so the read stays within US customers). Read 2: disrupted Northline deliveries take ${(DISRUPTION_DELAY_DAYS[0] + DISRUPTION_DELAY_DAYS[1]) / 2} more days on average than other Northline deliveries.`,
		mixpanelReport: { type: "Retention / Funnels + warehouse", birth: "order completed (US customers whose order shipped on disrupted days)", return: "order completed within 45 days", breakdown: "shipping_carrier of that shipment", join: "carrier_performance_daily.service_status" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H5_SQL },
				select: { a: { where: { grp: "affected" } }, o: { where: { grp: "other_carriers" } } },
				expect: { metric: "a.repeat_rate / o.repeat_rate", op: "between", target: band(1 - REPEAT_LOSS) },
				minCohort: 500,
			},
			{
				breakdown: { type: "duckdb", sql: H5_DELAY_SQL },
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.extra_days", op: "between", target: band((DISRUPTION_DELAY_DAYS[0] + DISRUPTION_DELAY_DAYS[1]) / 2) },
				minCohort: 500,
			},
		],
	},
	{
		id: "H6-paid-channel-economics",
		hook: "H6",
		archetype: "attribution-bias",
		narrative: `External-table join. Window spend per Mixpanel signup (warehouse marketing_spend_daily: a paced daily budget per channel = cost per signup × expected signups per day, shaped by the weekly shopping rhythm above a ${SPEND_FLAT_SHARE * 100}% flat floor with seeded ±${SPEND_NOISE * 100}% day noise) is $${CPS_USD.tiktok_ads} for TikTok vs $${CPS_USD.google_shopping} for Google Shopping (${(CPS_USD.tiktok_ads / CPS_USD.google_shopping).toFixed(3)}x). But only ${FIRST_ORDER_KEEP.tiktok_ads * 100}% of the TikTok new users who would buy ever do (Google Shopping ${FIRST_ORDER_KEEP.google_shopping * 100}%; the others stop at checkout start), so the 30-day first-order rate is ${FIRST_ORDER_KEEP.tiktok_ads / FIRST_ORDER_KEEP.google_shopping}x and the cost per first order is ${(CPS_USD.tiktok_ads / FIRST_ORDER_KEEP.tiktok_ads / CPS_USD.google_shopping).toFixed(2)}x Google's. Read 2 is the Mixpanel funnel account created → order completed, ${FIRST_ORDER_WINDOW_DAYS}-day window, signups ${D(DATASET_START)} through ${D(dayjs.utc(SIGNUP_COHORT_END).subtract(1, "day").toISOString())}. About a hundred TikTok buyers, so it uses the knob as target with a knob-derived ceiling (half the effect).`,
		mixpanelReport: { type: "Insights + Funnels + warehouse", event: "account created", breakdown: "acquisition_channel", join: "marketing_spend_daily.spend_usd", funnel: "account created → order completed, 30-day window, breakdown acquisition_channel" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H6_SPEND_SQL },
				select: { t: { where: { grp: "tiktok_ads" } }, g: { where: { grp: "google_shopping" } } },
				expect: { metric: "t.spend_per_signup / g.spend_per_signup", op: "between", target: band(CPS_USD.tiktok_ads / CPS_USD.google_shopping) },
				minCohort: 400,
			},
			{
				breakdown: { type: "duckdb", sql: H6_FIRST_ORDER_SQL },
				select: { t: { where: { grp: "tiktok_ads" } }, g: { where: { grp: "google_shopping" } } },
				expect: { metric: "t.first_order_rate / g.first_order_rate", op: "<=", target: FIRST_ORDER_KEEP.tiktok_ads / FIRST_ORDER_KEEP.google_shopping, floor: 1 - 0.5 * (1 - FIRST_ORDER_KEEP.tiktok_ads / FIRST_ORDER_KEEP.google_shopping) },
				minCohort: 400,
			},
		],
	},
	{
		id: "H7-labor-day-sale",
		hook: "H7",
		archetype: "temporal-inflection",
		narrative: `World event. The Labor Day sale runs ${D(LABOR_DAY_START)} to ${D(dayjs.utc(LABOR_DAY_END).subtract(1, "day").toISOString())} (${LABOR_DAY_DISCOUNT * 100}% off sitewide, code ${LABOR_DAY_CODE}). US carts started during the sale convert ${LABOR_DAY_CONV_MULT}x the 14 days before (US only: Canada's duties-included pilot from ${D(CANADA_DDP_START)} lifts Canadian conversion inside the comparison window); browsing traffic (category browses, product views) is ${LABOR_DAY_TRAFFIC_MULT}x, read against the same weekdays (Friday-Monday) of the two weeks before. Every sale order carries the code and no other order does.`,
		mixpanelReport: { type: "Funnels + Insights", funnel: "product added to cart → order completed, totals, hold cart_id, sale days vs 14 days before", insights: "order completed by discount_code, daily; category browsed per day" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H7_CONV_SQL },
				select: { s: { where: { grp: "sale" } }, b: { where: { grp: "before" } } },
				expect: { metric: "s.conv / b.conv", op: "between", target: band(LABOR_DAY_CONV_MULT) },
				minCohort: 800,
			},
			{
				breakdown: { type: "duckdb", sql: H7_TRAFFIC_SQL },
				select: { s: { where: { grp: "sale" } }, b: { where: { grp: "before" } } },
				expect: { metric: "s.per_day / b.per_day", op: "between", target: band(LABOR_DAY_TRAFFIC_MULT) },
				minCohort: 2000,
			},
			{
				breakdown: { type: "duckdb", sql: H7_CODE_SQL },
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.mismatched", op: "between", target: [0, 0] },
			},
		],
	},
	{
		id: "H8-wishlist-magic-number",
		hook: "H8",
		archetype: "retention-divergence",
		narrative: `Magic number. New users who save fewer than ${WISHLIST_MIN} products to their wishlist in their first ${WISHLIST_DAYS} days go quiet about day ${DARK_AFTER_DAYS}-${DARK_AFTER_DAYS + DARK_SPREAD_DAYS}, on a ramp: ${DARK_SHARE_BY_SAVES.map((x) => x * 100 + "%").join(" / ")} with 0 / 1 / 2 saves, none with ${WISHLIST_MIN}+. Every new user also faces organic churn (${LAPSE_SHARE * 100}% stop on a uniform day ${LAPSE_DAY[0]}-${LAPSE_DAY[1]}). Day-${RETENTION_DAY} retention = any shopper action (not order shipped or order delivered) in days ${RETENTION_DAY}-${RETENTION_DAY + 6} after signup, signups at least ${RETENTION_DAY + 7} days before the window end. 3+ savers vs non-savers is at least 1/(1−${DARK_SHARE_BY_SAVES[0]}); heavier shoppers save more and are likelier to show up in the day-${RETENTION_DAY} week anyway, so the knob is a floor.`,
		mixpanelReport: { type: "Funnels → cohorts → Retention", cohortFunnel: `account created → product added to wishlist ×${WISHLIST_MIN}, ${WISHLIST_DAYS}-day window`, birth: "account created", return: "any shopper event (exclude order shipped, order delivered)", brackets: `custom day ${RETENTION_DAY}-${RETENTION_DAY + 6}` },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H8_SQL },
				select: { a: { where: { grp: "three_plus" } }, z: { where: { grp: "none" } } },
				expect: { metric: "a.retention / z.retention", op: ">=", target: 1 / (1 - DARK_SHARE_BY_SAVES[0]), floor: 0.9 / (1 - DARK_SHARE_BY_SAVES[0]) },
				minCohort: 200,
			},
		],
	},
	{
		id: "H9-room-visualizer-launch",
		hook: "H9",
		archetype: "temporal-inflection",
		narrative: `Launch. Room Visualizer launches ${D(VISUALIZER_LAUNCH)}. ${VIZ_ADOPTER_SHARE * 100}% of shoppers adopt it, each from a salted day in the ${VIZ_RAMP_DAYS} days after launch, and open it on the product before a salted ${(VIZ_USE_MEAN - VIZ_USE_SPREAD) * 100}-${(VIZ_USE_MEAN + VIZ_USE_SPREAD) * 100}% (mean ${VIZ_USE_MEAN * 100}%) of their furniture and lighting carts. Those carts convert ${VIZ_CONV_MULT}x the furniture and lighting carts without it (adoption is drawn independently of shopper traits; read on US carts, which keeps the cross-border last-step loss and its September change out of the comparison). Once ramped, ${VIZ_ADOPTER_SHARE * VIZ_USE_MEAN * 100}% of furniture and lighting carts start with a visualizer session; there is none before launch.`,
		mixpanelReport: { type: "Funnels + Insights", funnel: "room visualizer opened → product added to cart → order completed vs furniture and lighting carts without it (hold cart_id from the add), filter ship_country = US", insights: "room visualizer opened, weekly uniques" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H9_SQL },
				select: { v: { where: { grp: "visualizer" } }, n: { where: { grp: "no_visualizer" } } },
				expect: { metric: "v.conv / n.conv", op: "between", target: band(VIZ_CONV_MULT) },
				minCohort: 500,
			},
			{
				breakdown: { type: "duckdb", sql: H9_ADOPTION_SQL },
				select: { r: { where: { grp: "ramped" } } },
				expect: { metric: "r.viz_share", op: "between", target: band(VIZ_ADOPTER_SHARE * VIZ_USE_MEAN) },
				minCohort: 500,
			},
			{
				breakdown: { type: "duckdb", sql: H9_ADOPTION_SQL },
				select: { r: { where: { grp: "ramped" } } },
				expect: { metric: "r.pre_launch", op: "between", target: [0, 0] },
			},
		],
	},
	{
		id: "H10-bedding-stockout",
		hook: "H10",
		archetype: "bespoke",
		narrative: `External-table join. From ${D(BEDDING_STOCKOUT_START)} to ${D(dayjs.utc(BEDDING_STOCKOUT_END).subtract(1, "day").toISOString())} a delayed linen shipment leaves ${STOCKOUT_SHARE * 100}% of bedding SKUs out of stock: ${STOCKOUT_SHARE * 100}% of would-be bedding carts never start, though the shopper still views the product. Events carry no stock flag. The stockout days come from the warehouse table inventory_daily (bedding in_stock_rate far below normal); the event read is a ratio of ratios (bedding adds per bedding view, stockout vs the ${H10_BASE_DAYS} days either side, over the same for ${H10_CONTROL.join(', ')}), which reads 1 − ${STOCKOUT_SHARE} and cancels sitewide swings. The control categories are never bought as small add-ons; add-on adds (decor, kitchen, bath, dining) move with the free-shipping threshold, which changed inside the comparison window. Read 2: the warehouse bedding in_stock_rate during the stockout ≈ 1 − ${STOCKOUT_SHARE}.`,
		mixpanelReport: { type: "Insights + warehouse", formula: "product added to cart / product viewed", breakdown: "category", chart: "daily line", join: "inventory_daily.in_stock_rate" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H10_SQL },
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.did", op: "between", target: band(1 - STOCKOUT_SHARE) },
				minCohort: 1000,
			},
			{
				breakdown: { type: "duckdb", sql: H10_WH_SQL },
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.stockout_in_stock", op: "between", target: band(1 - STOCKOUT_SHARE) },
			},
		],
	},
];

