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
 * NAME:       Routewise Freight
 * APP:        Digital truckload freight broker. Shippers (manufacturers,
 *             retailers, food and building-materials companies) price a load
 *             in the Routewise portal, book it, and Routewise covers it with a
 *             carrier from its network; the portal then tracks the load to
 *             delivery and bills it. Equipment: dry van, reefer (refrigerated),
 *             flatbed. Customer tiers: enterprise, mid-market, small business.
 *             Live ETA launches 2026-07-21; the "Instant Book" test (one-click
 *             booking at the quoted price for dry van) starts 2026-08-11;
 *             Hurricane Odessa hits the Gulf Coast 2026-09-14 to 09-18.
 * SCALE:      10,000 shipper users (≈4,400 sign up inside the window; ≈37% of
 *             those are never approved for credit and leave), ~0.82M events,
 *             ≈52,000 loads booked, 120 days (2026-06-04 → 2026-10-01, UTC)
 * CORE LOOP:  quote requested → load booked → carrier assigned → pickup
 *             confirmed → load delivered → invoice paid
 * VALUE MOMENT: load delivered
 *
 * EVENTS (19):
 *   quote requested > shipment tracked > dashboard viewed > rate lookup
 *   > load booked > carrier assigned > pickup confirmed > load delivered
 *   > $experiment_started > invoice paid > document downloaded > report
 *   exported > accessorial charged > support ticket created > delivery
 *   exception > lane saved > account created > credit application submitted
 *   > credit approved
 *
 * FUNNELS (4 declared):
 *   - Shipper onboarding (first funnel, two copies by acquisition_channel, H6):
 *       account created → lane saved → credit application submitted → credit
 *       approved (72%; Google Ads 36%)
 *   - Shipment (weight 3, engine 100%): the ten shipment steps; each engine
 *       unit is a quote session and the everything hook decides every step
 *       and its timing (see DESIGN NOTES). Carries the Instant Book experiment
 *       (multipliers 1.0; the hook applies the effect and the exposures)
 *   - Portal session (weight 2, first-fixed): dashboard viewed → lane saved /
 *       rate lookup / document downloaded / report exported
 *
 * USER PROPS:  company_tier, industry, primary_equipment, home_region,
 *              acquisition_channel, customer_since, credit_limit_usd,
 *              payment_terms, annual_freight_spend_band, saved_lanes,
 *              "Experiment: Instant Book" (exposed shippers)
 * SUPER PROPS: company_tier (sticky per shipper)
 * SCD PROPS:   none
 * GROUPS:      none
 * WAREHOUSE:   spot_market_rates_daily (third-party spot index by equipment:
 *              rate per mile, load and truck posts, diesel),
 *              load_margin_daily (billed revenue, carrier cost, margin by
 *              booking_method), paid_marketing_daily (spend by paid channel)
 * LOOKUPS:     none — every attribute is denormalized onto events/profiles
 * SOUP:        weekday dayOfWeekWeights (weekends about a fifth of a weekday);
 *              US business hours in UTC
 *
 * IDENTITY: a new shipper is identified at "account created" (isAuthEvent,
 * first event, user_id + device_id); 2 devices per user on average. Every event
 * carries user_id; there is no anonymous pre-signup activity. Server-side
 * events carry user_id only, no device_id, session_id, or device fields: credit application
 * submitted, credit approved, lane saved (the lanes service), and the carrier
 * and billing events (carrier assigned, pickup confirmed, delivery exception,
 * load delivered, accessorial charged, invoice paid). Every other event carries
 * device_id. No Platform-style property.
 *
 * DESIGN NOTES:
 * - Shipments: each engine Shipment unit is a quote session with 1-5 quotes a
 *   few minutes apart (mean ≈2.2). Each quote gets lane, equipment, miles,
 *   weight, and a price = the day's spot benchmark x (1 + spread) (H2); it
 *   books with p(spread) (x Instant Book, H3). A booked load gets a carrier
 *   (H4), a pickup 1-3 business days after booking (business hours), a transit
 *   time from the lane miles (≈520 mi/day; half of weekend delivery appointments
 *   move to Monday or Tuesday), lateness (H7), tracking views, tickets (H1), accessorials
 *   (H9), and an invoice paid on a business day by tier terms (median
 *   19/27/38 days). Shipper-side moments (tracking views, tickets) fall in US
 *   business hours when the load's timing allows. Engine unit events are reused; extra quotes and
 *   steps are clones of the shipper's own unit templates. Unused unit events
 *   are dropped. Every step of a load shares shipment_id.
 * - Window start: established shippers have loads in flight. Each gets
 *   pre-window quote sessions over the 75 days before June 4 at their in-window
 *   pace; only steps on or after June 4 remain, so pickups, deliveries, and
 *   invoices run flat from the first week. Established shippers who joined
 *   in the two weeks before June 4 (RECENT_JOIN_SHARE, the in-window pace of
 *   approved signups) are still saving their first lanes and follow the H8
 *   rule, so lane saves do not ramp from zero.
 * - Credit approval (H6) is an even per-channel quota of the declared rate
 *   (funnel-pre error diffusion), not an independent coin per shipper.
 * - New shippers: credit approval decides everything. Shippers never approved
 *   keep their onboarding steps and a few days of rate lookups and dashboards,
 *   then leave. Approved shippers quote only after approval. The onboarding lane
 *   and the credit application are minutes after signup; the credit decision
 *   comes hours later.
 * - US holidays (Jul 3 observed, Sep 7): shippers keep 25% of their quote
 *   sessions and portal visits that UTC day. Carriers keep moving loads
 *   already booked.
 * - Server-side events keep firing after a shipper goes quiet (H5): carrier
 *   and billing events for loads already booked still arrive.
 * - Warehouse drift: load_margin_daily drops 0-8% of a day's loads as
 *   cancellations and moves billed revenue ±20% a day (rebills, fuel true-ups,
 *   short pays); spot_market_rates_daily posts follow the season of Routewise's
 *   own quote flow with ±30% day noise plus a base; paid_marketing_daily is a
 *   half paced budget (weekday shape, never zero) and half bid x the day's
 *   delivered signups, with seeded day noise.
 * - Legacy activity mode (no retentionCurve): each shipper's events spread
 *   evenly over their active window.
 * - Instant Book enrollment is per dry van quote, which the engine's funnel
 *   experiment cannot express (it enrolls whole Shipment runs of any
 *   equipment). The experiment is configured without a start date so every
 *   shipper gets a sticky variant; the hook keeps one $experiment_started per
 *   shipper, 1 s before their first dry van quote from 2026-08-11, and clears
 *   the profile variant of shippers with no such quote.
 */

// ── HOOK STORIES ──
/*
 * All effects are hidden: no flag properties. Dates live in the TIMELINE
 * constants and are shared by hooks, stories, SQL, warehouse columns, and the
 * timeline guide.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H1. LIVE ETA CUTS "WHERE IS MY TRUCK" TICKETS (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: before 2026-07-21, 15% of loads in transit draw a support ticket
 *   with ticket_category = tracking_status. Live ETA rolls out to every shipper
 *   over 14 days and the chance falls to 0.4x. Booking-change and billing
 *   tickets per load do not change. From launch, 35% of tracking views come
 *   from an ETA notification (view_source = eta_notification).
 * MIXPANEL: Insights, support ticket created (ticket_category =
 *   tracking_status) / pickup confirmed, weekly; before Jul 21 vs from Aug 4.
 * REAL WORLD: proactive ETAs answer the question before the shipper calls.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H2. QUOTES PRICED NEAR THE MARKET BOOK (everything + warehouse
 *     spot_market_rates_daily; external-table join)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: quote price = spot benchmark x (1 + spread); booking probability
 *   falls smoothly with spread: 42% for quotes within 5% of market, 14% for
 *   quotes more than 15% over market (0.333x).
 * MIXPANEL: Funnels, quote requested → load booked, Totals, hold shipment_id
 *   constant, 7-day window; spread needs quoted_rate_per_mile joined to
 *   spot_market_rates_daily.spot_rate_per_mile on date + equipment_type.
 * REAL WORLD: shippers shop every load against what the market pays.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H3. INSTANT BOOK EXPERIMENT (Shipment funnel experiment + everything +
 *     warehouse load_margin_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-08-11 shippers split 50/50 on dry van quotes. In the
 *   Instant Book arm dry van quotes book 1.3x as often; 80% of those bookings
 *   are booking_method = instant (minutes after the quote). Instant loads run a
 *   9.0% gross margin vs 15.5% negotiated (warehouse), 0.581x.
 * MIXPANEL: Funnels, quote requested (equipment_type = dry_van) → load booked,
 *   Totals, hold shipment_id, 7-day window, Aug 11 - Sep 24, breakdown
 *   "Experiment: Instant Book"; margin from load_margin_daily by booking_method.
 * REAL WORLD: one-click booking wins loads but gives up the negotiation margin.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H4. SPECIALIZED EQUIPMENT TAKES LONGER TO COVER (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: load booked → carrier assigned median 3 h for dry van, 1.6x for
 *   reefer, 2.2x for flatbed (log-normal, sigma 0.6).
 * MIXPANEL: Funnels, load booked → carrier assigned, hold shipment_id, median
 *   time to convert, breakdown equipment_type.
 * REAL WORLD: there are far fewer reefer and flatbed trucks than dry vans.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H5. A LATE FIRST LOAD LOSES THE NEW SHIPPER (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: a new shipper whose first delivered load is late leaves with
 *   probability 0.5, 2-10 days after that delivery (carrier and billing events
 *   for booked loads still arrive).
 * MIXPANEL: Retention, birth load delivered (first time), cohort new shippers,
 *   breakdown on_time, return quote requested, on or after day 14.
 * REAL WORLD: a shipper trusts a new broker with one load; miss it and there is
 *   no second.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H6. PAID CHANNEL ECONOMICS (first funnels + warehouse paid_marketing_daily;
 *     external-table join)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: spend per Mixpanel signup $55 Google Ads, $110 LinkedIn, $80 trade
 *   media; Google signups are approved for credit at 0.5x the rate of every
 *   other channel (36% vs 72%), so spend per approved shipper is level between
 *   Google and LinkedIn (1.0).
 * MIXPANEL: Insights, account created by acquisition_channel joined to
 *   paid_marketing_daily.spend_usd; Funnels, account created → credit
 *   approved, 7-day window, breakdown acquisition_channel.
 * REAL WORLD: search ads bring many tiny or unqualified shippers who fail
 *   the credit check.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H7. HURRICANE ODESSA (everything + warehouse spot_market_rates_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-09-14 to 09-18, Gulf-lane loads (origin or destination
 *   southeast or south_central) moving in the storm days are late 70% of the
 *   time (weather_delay exceptions) vs 18% for every other load; flatbed spot
 *   rates jump 16% in the storm days, dry van 12%, reefer 10%.
 * MIXPANEL: Funnels, pickup confirmed → load delivered, hold shipment_id,
 *   Sep 14-18, breakdown region (step 1) and on_time (step 2); warehouse rates.
 * REAL WORLD: hurricanes close ports and roads and pull trucks into recovery.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H8. THREE SAVED LANES (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: new shippers save 0-7 lanes in their first 14 days (drawn
 *   independently of activity); those under 3 keep half their quote sessions,
 *   so they book 0.5x the loads; no further gain past 3 (5+ vs 3-4 = 1.0).
 * MIXPANEL: Insights, A = load booked (total), B = credit approved (uniques),
 *   formula A / B, filter customer_since ≥ 2026-06-04, breakdown company_tier
 *   then saved_lanes (< 3, 3-4, 5+). Read the plateau within company_tier:
 *   the pooled 5+ vs 3-4 ratio carries tier-mix noise.
 * REAL WORLD: shippers who set up their recurring lanes have recurring freight.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H9. DOCK APPOINTMENTS CUT DETENTION (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: detention charges on 22% of loads without a dock appointment vs
 *   8.8% with one (0.4x); lumper fees (10%) do not depend on appointments.
 * MIXPANEL: Funnels, load booked → accessorial charged (charge_type =
 *   detention), hold shipment_id, breakdown appointment_scheduled.
 * REAL WORLD: a scheduled dock door means the driver is not left waiting.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * EXPECTED METRICS SUMMARY (measured: data/verify-logistics, 2026-10-07, full
 * fidelity, 10,000 shippers, 822,398 events, 51,917 loads booked in window)
 * ═════════════════════════════════════════════════════════════════════════
 * Hook | Metric                                        | Derivation              | Expected | Measured
 * -----|-----------------------------------------------|-------------------------|----------|---------
 * H1   | tracking tickets / pickup, after/before       | LIVE_ETA_KEEP           | 0.40     | 0.400 (14.7% → 5.9%)
 * H1   | booking-change + billing tickets / load       | unchanged (control)     | 1.00     | 1.037
 * H1   | eta_notification views before launch          | exact purity            | 0        | 0
 * H2   | 7-day booking, >15% over / within 5% of market| 0.14 / 0.42             | 0.333    | 0.333 (14.6% vs 43.7%)
 * H3   | dry van 7-day booking, variant / control      | INSTANT_BOOK_MULT       | 1.30     | 1.302 (39.6% vs 30.4%)
 * H3   | instant share of variant dry van bookings     | INSTANT_SHARE           | 0.80     | 0.797
 * H3   | instant bookings outside variant/dry van/test | exact purity            | 0        | 0
 * H3   | warehouse margin %, instant / negotiated      | 0.09 / 0.155            | 0.581    | 0.583 (8.6% vs 14.7%)
 * H3   | variant share of exposed shippers             | equal 2-arm hash        | 0.50     | 0.488 (3,315 of 6,799)
 * H4   | median hours to cover, reefer / dry van       | COVER_MULT.reefer       | 1.60     | 1.611 (4.79 vs 2.97 h)
 * H4   | median hours to cover, flatbed / dry van      | COVER_MULT.flatbed      | 2.20     | 2.254 (6.70 h)
 * H5   | retention ≥ d14, late first / on-time first   | 1 − LATE_FIRST_CHURN (≤, ceiling 0.75) | 0.50 | 0.422 (33.2% vs 78.8%)
 * H6   | spend per signup, Google / LinkedIn           | 55 / 110                | 0.50     | 0.509 ($56.20 vs $110.42)
 * H6   | 7-day credit approval, Google / others        | 36 / 72                 | 0.50     | 0.501 (36.0% vs 71.8%)
 * H6   | spend per approved shipper, Google / LinkedIn | (55 / 0.5) / 110        | 1.00     | 1.019 ($156.26 vs $153.32)
 * H7   | late share, Gulf lanes picked up Sep 14-18    | STORM_LATE_RATE         | 0.70     | 0.719
 * H7   | late share, every other load                  | BASE_LATE_RATE          | 0.18     | 0.186
 * H7   | flatbed spot rate, storm days / 2 weeks before| 1 + STORM_RATE_BUMP     | 1.16     | 1.164
 * H8   | loads per approved new shipper, <3 / 3+ lanes (within tier) | LOW_LANE_KEEP | 0.50 | 0.504 (pooled 1.81 vs 3.69)
 * H8   | loads per approved new shipper, 5+ / 3-4 (within tier)      | plateau       | 1.00 | 0.971
 * H9   | detention share, appointment / none           | APPT_DETENTION_MULT     | 0.40     | 0.406 (8.8% vs 21.7%)
 * H9   | lumper share, appointment / none              | unchanged (control)     | 1.00     | 0.974
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Noise and confounding notes: H5 rests on 256 new shippers whose first
 * delivery was late; each one's leave/stay is a coin flip, so the ratio moves
 * about ±0.05 from run to run, and it carries a selection effect (a late load
 * is less often the first to arrive when several loads move at once, so
 * late-first shippers lean toward single-load shippers, who return less
 * anyway). Its assertion uses the knob as target with a half-effect ceiling
 * and grades STRONG on this run (0.42). H8 takes both ratios within company
 * tier (tier drives volume, lane counts are independent of it); the pooled
 * ratios carry tier-mix noise (pooled <3 / 3+ = 0.489, 5+ / 3-4 = 1.013). The
 * exposed-shipper split is 48.8% Instant Book (sample-ratio z = −2.0): it
 * follows which shippers quoted dry van after Aug 11 (pre-test dry van booking
 * 30.7% Control vs 30.1% Instant Book), not the treatment. Quote-to-book by
 * company tier is not engineered (31.8% / 31.7% / 32.0%, |z| ≤ 0.8), nor is
 * reefer/flatbed booking by Instant Book arm (30.9% vs 31.0%, z = 0.2), nor
 * on-time delivery by dock appointment (79.1% vs 79.1%).
 */

// ── SCALE ──
const SEED = "dm4-logistics";
const NUM_USERS = 10_000;
const DATASET_START = "2026-06-04T00:00:00Z";
const DATASET_END = "2026-10-01T23:59:59Z"; // 120 days
const EVENTS_PER_DAY = 1.2;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── TIMELINE (shared by hooks, stories, SQL, warehouse columns, guides) ──
const LIVE_ETA_LAUNCH = "2026-07-21T00:00:00Z";    // Live ETA: proactive ETA notifications + live map for every load
const INSTANT_BOOK_START = "2026-08-11T00:00:00Z"; // "Instant Book" A/B test starts on dry van quotes
const STORM_START = "2026-09-14T00:00:00Z";        // Hurricane Odessa reaches the Gulf Coast
const STORM_END = "2026-09-19T00:00:00Z";          // exclusive (5 days: Sep 14-18)
const HOLIDAYS = ["2026-07-03", "2026-09-07"];     // US Independence Day (observed), Labor Day

const ms = (iso) => dayjs.utc(iso).valueOf();
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;
const WINDOW_DAYS = 120;

// ── WEEKLY AND DAILY RHYTHM (soup) ──
// Sun..Sat. Freight is booked on weekdays; weekends are a skeleton crew.
const DOW_WEIGHTS = [0.18, 1.0, 1.0, 0.98, 0.96, 0.86, 0.22];
// UTC hours: US business hours (8 am ET = 12 UTC through 5 pm PT = 00 UTC).
const HOUR_WEIGHTS = [0.4, 0.26, 0.14, 0.08, 0.05, 0.04, 0.04, 0.05, 0.07, 0.1, 0.16, 0.3,
	0.55, 0.8, 0.95, 1.0, 1.0, 0.98, 0.95, 0.92, 0.85, 0.72, 0.58, 0.48];

// ── KNOBS ──
// H1 Live ETA: "where is my truck" tickets per load fall after launch
const TRACK_TICKET_RATE = 0.15;     // share of loads in transit that get a tracking_status ticket (before launch)
const LIVE_ETA_KEEP = 0.4;          // share of tracking tickets left once the rollout is done
const LIVE_ETA_RAMP_DAYS = 14;      // rollout to every shipper over two weeks
const ETA_VIEW_SHARE = 0.35;        // after launch, share of tracking views opened from an ETA notification
const BOOKING_CHANGE_RATE = 0.05;   // tickets that do not depend on tracking (H1 control)
const BILLING_TICKET_RATE = 0.04;

// H2 price vs market: booking probability falls with the quote's spread over the spot market
const SPREAD_MEAN = 0.08;
const SPREAD_SD = 0.07;
const SPREAD_MIN = -0.08;
const SPREAD_MAX = 0.35;
const COMPETITIVE_MAX = 0.05;       // spread ≤ 5% over market: "at market"
const EXPENSIVE_MIN = 0.15;         // spread > 15% over market: "expensive"
const BOOK_RATE_COMPETITIVE = 0.42; // average booking rate of at-market quotes (the knob)
const BOOK_RATE_EXPENSIVE = 0.14;   // average booking rate of expensive quotes (the knob)
const BOOK_CURVE_CENTER = 0.10;     // logistic center (spread)
const BOOK_CURVE_SCALE = 0.03;      // logistic scale (spread)
const bookCurveShape = (s) => 1 / (1 + Math.exp((s - BOOK_CURVE_CENTER) / BOOK_CURVE_SCALE));
const [BOOK_PLATEAU_HI, BOOK_PLATEAU_LO] = (() => {
	// integrate the curve over the truncated-normal spread distribution so the
	// bucket averages land on BOOK_RATE_COMPETITIVE / BOOK_RATE_EXPENSIVE
	let nC = 0, sC = 0, nE = 0, sE = 0;
	const N = 6000;
	for (let i = 0; i < N; i++) {
		const s = SPREAD_MIN + (SPREAD_MAX - SPREAD_MIN) * (i + 0.5) / N;
		const w = Math.exp(-((s - SPREAD_MEAN) ** 2) / (2 * SPREAD_SD ** 2));
		if (s <= COMPETITIVE_MAX) { nC += w; sC += w * bookCurveShape(s); }
		if (s > EXPENSIVE_MIN) { nE += w; sE += w * bookCurveShape(s); }
	}
	const span = (BOOK_RATE_COMPETITIVE - BOOK_RATE_EXPENSIVE) / (sC / nC - sE / nE);
	const lo = BOOK_RATE_EXPENSIVE - span * (sE / nE);
	return [lo + span, lo];
})();
const bookRate = (s) => BOOK_PLATEAU_LO + (BOOK_PLATEAU_HI - BOOK_PLATEAU_LO) * bookCurveShape(s);

// H3 Instant Book experiment (dry van quotes) + warehouse load_margin_daily
const EXPERIMENT_NAME = "Instant Book";
const VARIANT = "Instant Book";
const EXP_KEY = `Experiment: ${EXPERIMENT_NAME}`;
const INSTANT_BOOK_MULT = 1.3;      // dry van booking rate in the variant vs control
const INSTANT_SHARE = 0.8;          // share of variant dry van bookings made with one click (the rest still negotiate)
const MARGIN_PCT = { negotiated: 0.155, instant: 0.09 }; // gross margin by booking method
const STORM_MARGIN_SQUEEZE = 0.25;  // margins compress by a quarter while storm rates spike
const NEGOTIATE_MEDIAN_H = 3;       // quote → book when the shipper negotiates (log-normal)
const INSTANT_MEDIAN_MIN = 5;       // quote → book with Instant Book

// H4 carrier coverage time by equipment
const COVER_MEDIAN_H = 3;           // dry van: booked → carrier assigned (log-normal median)
const COVER_MULT = { dry_van: 1, reefer: 1.6, flatbed: 2.2 };
const COVER_SIGMA = 0.6;

// H5 a late first load drives new shippers away
const LATE_FIRST_CHURN = 0.5;       // chance a new shipper whose first delivered load was late leaves
const CHURN_DAY_MIN = 2;
const CHURN_DAY_MAX = 10;

// H6 paid acquisition (warehouse paid_marketing_daily) + credit approval by channel
const PAID_CHANNELS = ["google_ads", "linkedin_ads", "trade_media"];
const CPL_USD = { google_ads: 55, linkedin_ads: 110, trade_media: 80 }; // window spend per Mixpanel signup
const CHANNEL_WEIGHTS = { organic: 28, referral: 14, google_ads: 26, linkedin_ads: 16, trade_media: 16 };
const APPROVAL_CONV = 72;
const GOOGLE_APPROVAL_MULT = 0.5;
const APPROVAL_TTC_H = 2;            // engine onboarding window (short so applications near the window end survive); the hook times the decision
const APPROVAL_MEDIAN_H = 3;         // credit decision after the application (log-normal, 0.5-30 h)
const BORN_PCT = 45;
const DAILY_BUDGET_USD = Object.fromEntries(PAID_CHANNELS.map((ch) => {
	const totalW = Object.values(CHANNEL_WEIGHTS).reduce((a, b) => a + b, 0);
	return [ch, CPL_USD[ch] * (NUM_USERS * BORN_PCT / 100) * (CHANNEL_WEIGHTS[ch] / totalW) / WINDOW_DAYS];
}));
const SPEND_FLAT_SHARE = 0.3;
const SPEND_WEEKDAY = (() => {
	const m = DOW_WEIGHTS.reduce((a, b) => a + b, 0) / DOW_WEIGHTS.length;
	return DOW_WEIGHTS.map((w) => SPEND_FLAT_SHARE + (1 - SPEND_FLAT_SHARE) * w / m);
})();
const SPEND_NOISE = 0.12;
const SPEND_PLAN_SHARE = 0.5;       // half paced budget, half bid x the day's delivered signups
const PLATFORM_LEAD_INFLATION = 1.15; // ad platforms claim more leads than Mixpanel signups
const CPC_USD = { google_ads: 6.5, linkedin_ads: 11, trade_media: 4.2 };
const CTR = { google_ads: 0.035, linkedin_ads: 0.006, trade_media: 0.009 };

// H7 Hurricane Odessa: late deliveries on Gulf lanes
const BASE_LATE_RATE = 0.18;
const STORM_LATE_RATE = 0.7;
const STORM_REGIONS = ["southeast", "south_central"];
const STORM_RATE_BUMP = { dry_van: 0.12, reefer: 0.1, flatbed: 0.16 }; // spot rates in the storm week

// H8 saved lanes in the first two weeks
const LANE_THRESHOLD = 3;
const LOW_LANE_KEEP = 0.5;          // shippers with < 3 saved lanes keep half their shipments
const LANE_SETUP_DAYS = 14;
const LANE_COUNT_WEIGHTS = { 0: 18, 1: 16, 2: 16, 3: 16, 4: 13, 5: 10, 6: 6, 7: 5 };
const ESTABLISHED_LANE_TRICKLE = 0.06; // established shippers rarely add lanes
// warm start: established shippers who joined in the two weeks before June 4 are
// still saving their first lanes (same share as the in-window signup pace)
// (approved signups only: 0.74 x 72% + 0.26 x 36% of signups reach credit approval)
const APPROVED_SHARE = (1 - CHANNEL_WEIGHTS.google_ads / 100) * APPROVAL_CONV / 100 + CHANNEL_WEIGHTS.google_ads / 100 * APPROVAL_CONV * GOOGLE_APPROVAL_MULT / 100;
const RECENT_JOIN_SHARE = (NUM_USERS * BORN_PCT / 100 * APPROVED_SHARE / WINDOW_DAYS * LANE_SETUP_DAYS) / (NUM_USERS * (1 - BORN_PCT / 100));

// H9 dock appointments cut detention
const APPT_RATE = { enterprise: 0.65, mid_market: 0.45, small_business: 0.25 };
const DETENTION_RATE = 0.22;
const APPT_DETENTION_MULT = 0.4;
const LUMPER_RATE = 0.1;            // H9 control: lumper fees do not depend on appointments

// window start: established shippers have loads in flight and invoices coming due
const PREWINDOW_DAYS = 75;
const QUOTES_PER_SESSION = { 1: 34, 2: 30, 3: 20, 4: 10, 5: 6 }; // loads priced in one quote session
const NONAPPROVED_DAYS = 5;         // shippers who are never approved browse for a few days, then leave
const HOLIDAY_KEEP = 0.25;          // share of shipper activity on a US holiday
const WEEKEND_MOVE_SHARE = 0.5;     // weekend delivery appointments moved to Monday/Tuesday (closed receivers)

// ── DATA ──
const EQUIPMENT = ["dry_van", "reefer", "flatbed"];
const REGIONS = ["northeast", "southeast", "midwest", "south_central", "mountain", "west_coast"];
const REGION_WEIGHTS = { northeast: 20, southeast: 19, midwest: 22, south_central: 17, mountain: 7, west_coast: 15 };
const LANE_MILES = {
	"northeast|northeast": 280, "northeast|southeast": 900, "northeast|midwest": 750, "northeast|south_central": 1500, "northeast|mountain": 1800, "northeast|west_coast": 2800,
	"southeast|southeast": 350, "southeast|midwest": 800, "southeast|south_central": 800, "southeast|mountain": 1600, "southeast|west_coast": 2400,
	"midwest|midwest": 320, "midwest|south_central": 900, "midwest|mountain": 1000, "midwest|west_coast": 2000,
	"south_central|south_central": 380, "south_central|mountain": 800, "south_central|west_coast": 1400,
	"mountain|mountain": 400, "mountain|west_coast": 900,
	"west_coast|west_coast": 420,
};
const INDUSTRY_WEIGHTS = { retail: 22, food_beverage: 18, manufacturing: 20, building_materials: 12, consumer_goods: 14, automotive: 8, chemicals: 6 };
const EQUIP_BY_INDUSTRY = {
	food_beverage: { reefer: 70, dry_van: 26, flatbed: 4 },
	building_materials: { flatbed: 65, dry_van: 30, reefer: 5 },
	manufacturing: { dry_van: 62, flatbed: 34, reefer: 4 },
	automotive: { dry_van: 60, flatbed: 38, reefer: 2 },
	chemicals: { dry_van: 80, flatbed: 12, reefer: 8 },
	retail: { dry_van: 85, reefer: 12, flatbed: 3 },
	consumer_goods: { dry_van: 84, reefer: 12, flatbed: 4 },
};
const BASE_RATE_PER_MILE = { dry_van: 2.12, reefer: 2.58, flatbed: 2.71 };
const WEIGHT_LBS = { dry_van: [18000, 44000], reefer: [20000, 42000], flatbed: [14000, 47000] };
const PAY_DAYS_MEDIAN = { enterprise: 38, mid_market: 27, small_business: 19 };
const PAYMENT_TERMS = { enterprise: "net_45", mid_market: "net_30", small_business: "net_21" };
const CREDIT_LIMIT = { enterprise: [250000, 1500000], mid_market: [50000, 250000], small_business: [10000, 50000] };
const SPEND_BAND = { enterprise: "over_10m", mid_market: "1m_to_10m", small_business: "under_1m" };

// ── HELPERS ──
const salt = (uid, tag) => hashFloat(`${uid}|${tag}`);
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;
const T = (e) => dayjs.utc(e.time).valueOf();
const iso = (t) => new Date(t).toISOString();
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
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
const pickR = (obj) => pickWeighted(obj, chance.floating({ min: 0, max: 1 }));
const laneMiles = (a, b) => LANE_MILES[`${a}|${b}`] ?? LANE_MILES[`${b}|${a}`];
const dayIndex = (key) => Math.round((ms(`${key}T00:00:00Z`) - ms(DATASET_START)) / DAY_MS);
// a business-hours instant (13:00-22:00 UTC) addDays business days after the
// UTC day of t (a weekend day rolls to Monday)
const businessTime = (t, addDays) => {
	let d0 = ms(`${dayKey(t)}T00:00:00Z`);
	let left = addDays;
	const dow = () => new Date(d0).getUTCDay();
	while (left > 0 || dow() === 0 || dow() === 6) {
		d0 += DAY_MS;
		if (dow() !== 0 && dow() !== 6) left--;
	}
	return d0 + chance.integer({ min: 13 * 60, max: 22 * 60 }) * MIN_MS + chance.integer({ min: 0, max: 59 }) * 1000;
};

// US business hours in UTC (8 am ET to 6 pm PT), weekdays
const isBusinessHour = (t) => {
	const d = new Date(t);
	const dow = d.getUTCDay(), h = d.getUTCHours();
	return dow >= 1 && dow <= 5 && (h >= 13 || h === 0);
};
// a shipper-side moment between lo and hi, preferring weekday business hours
const shipperTime = (lo, hi) => {
	let t = lo;
	for (let i = 0; i < 8; i++) {
		t = lo + Math.floor((hi - lo) * chance.floating({ min: 0, max: 1 }));
		if (isBusinessHour(t)) return t;
	}
	return t;
};

// spot market benchmark (third-party index) by day and equipment: drift, produce
// season for reefer, the storm spike, and day noise
function marketRate(key, equip) {
	const d = dayIndex(key);
	let r = BASE_RATE_PER_MILE[equip] * (1 + 0.00045 * d);
	if (equip === "reefer") r *= 1 + 0.09 * Math.min(1, Math.max(0, 1 - d / 45));
	const sd = (ms(`${key}T00:00:00Z`) - ms(STORM_START)) / DAY_MS;
	if (sd >= -1 && sd < 12) r *= 1 + STORM_RATE_BUMP[equip] * (sd < 5 ? 1 : (12 - sd) / 7) * (sd < 0 ? 0.4 : 1);
	return round3(r * jitter(`mkt|${key}|${equip}`, 0.025));
}
const dieselPrice = (key) => round3((3.71 + 0.0028 * dayIndex(key)) * jitter(`diesel|${key}`, 0.006));
const inStorm = (t) => t >= ms(STORM_START) && t < ms(STORM_END);
const liveEtaKeep = (t) => (t < ms(LIVE_ETA_LAUNCH) ? 1 : 1 - (1 - LIVE_ETA_KEEP) * Math.min(1, (t - ms(LIVE_ETA_LAUNCH)) / (LIVE_ETA_RAMP_DAYS * DAY_MS)));
const paidSpend = (date, ch, signups) => round2((SPEND_PLAN_SHARE * DAILY_BUDGET_USD[ch] * SPEND_WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()]
	+ (1 - SPEND_PLAN_SHARE) * CPL_USD[ch] * signups) * jitter(`spend|${date}|${ch}`, SPEND_NOISE));
const drawSpread = () => {
	for (let i = 0; i < 20; i++) {
		const s = chance.normal({ mean: SPREAD_MEAN, dev: SPREAD_SD });
		if (s >= SPREAD_MIN && s <= SPREAD_MAX) return s;
	}
	return SPREAD_MEAN;
};

const UNIT_STEPS = ["quote requested", "load booked", "carrier assigned", "pickup confirmed", "shipment tracked",
	"delivery exception", "load delivered", "accessorial charged", "invoice paid", "support ticket created"];
const UNIT_SET = new Set(UNIT_STEPS);
// carrier- and billing-side events: they keep firing for loads already booked
// after a shipper goes quiet, and carry no device
const SYSTEM_EVENTS = new Set(["carrier assigned", "pickup confirmed", "delivery exception", "load delivered", "accessorial charged", "invoice paid"]);
const ONBOARDING = new Set(["account created", "credit application submitted", "credit approved"]);
const BACK_OFFICE = new Set(["credit application submitted", "credit approved", "lane saved"]);
const ONBOARDING_STEPS = ["account created", "lane saved", "credit application submitted", "credit approved"];
const PORTAL = new Set(["dashboard viewed", "rate lookup", "document downloaded", "report exported", "lane saved"]);
const DEVICE_KEYS = ["device_id", "session_id", "browser", "os", "model", "screen_height", "screen_width", "carrier", "radio", "wifi", "manufacturer", "brand"];

// lane and rate-lookup properties follow the shipper's own network
function setLaneProps(e, profile) {
	e.equipment_type = chance.bool({ likelihood: 75 }) ? profile.primary_equipment : pickR({ dry_van: 70, reefer: 18, flatbed: 12 });
	e.origin_region = chance.bool({ likelihood: 70 }) ? profile.home_region : pickR(REGION_WEIGHTS);
	e.destination_region = pickR(REGION_WEIGHTS);
}

function handleUserHook(profile, meta) {
	const uid = profile.distinct_id;
	const tier = profile.company_tier || "small_business";
	profile.primary_equipment = pickWeighted(EQUIP_BY_INDUSTRY[profile.industry] ?? EQUIP_BY_INDUSTRY.retail, salt(uid, "equip"));
	profile.home_region = pickWeighted(REGION_WEIGHTS, salt(uid, "region"));
	const [lo, hi] = CREDIT_LIMIT[tier];
	profile.credit_limit_usd = Math.round((lo + (hi - lo) * salt(uid, "credit")) / 5000) * 5000;
	profile.payment_terms = PAYMENT_TERMS[tier];
	profile.annual_freight_spend_band = SPEND_BAND[tier];
	if (meta.userIsBornInDataset) {
		profile.customer_since = dayKey(ms(profile.created ?? meta.user.created));
		profile.saved_lanes = 0;
	} else {
		const span = ms(DATASET_START) - ms("2021-03-01T00:00:00Z");
		profile.customer_since = salt(uid, "recent") < RECENT_JOIN_SHARE
			? dayKey(ms(DATASET_START) - Math.ceil(salt(uid, "recent-day") * LANE_SETUP_DAYS) * DAY_MS)
			: dayKey(ms("2021-03-01T00:00:00Z") + Math.floor(salt(uid, "since") * (span - LANE_SETUP_DAYS * DAY_MS) / DAY_MS) * DAY_MS);
		profile.saved_lanes = 3 + Math.floor(salt(uid, "lanes-est") * 13);
	}
	return profile;
}

function handleEverything(events, meta) {
	if (!events.length) return events;
	const profile = meta.profile;
	const uid = profile.distinct_id;
	const tier = profile.company_tier || "small_business";
	const BEGIN = ms(DATASET_START), END = ms(DATASET_END);
	const signup = events.find((e) => e.event === "account created");
	const approval = events.find((e) => e.event === "credit approved");
	const born = Boolean(signup);
	const approvalT0 = approval ? T(approval) : null;

	const stripDevice = (e) => { for (const k of DEVICE_KEYS) if (k in e) delete e[k]; };
	// back-office events carry no device or session
	const finalize = (evs) => {
		for (const e of evs) if (SYSTEM_EVENTS.has(e.event) || BACK_OFFICE.has(e.event)) stripDevice(e);
		return evs;
	};

	// onboarding wizard: the first lane and the credit application are minutes
	// after signup; the credit decision comes later (engine timing)
	// (onboarding steps after signup are server-side: user_id only, no device)
	const onboardLane = born ? events.find((e) => e.event === "lane saved" && !e.device_id) ?? null : null;
	if (born) {
		const t0 = T(signup);
		const app = events.find((e) => e.event === "credit application submitted");
		if (onboardLane) onboardLane.time = iso(t0 + chance.integer({ min: 60, max: 420 }) * 1000);
		if (app) app.time = iso(t0 + chance.integer({ min: 480, max: 1800 }) * 1000);
		if (app && approvalT0 !== null) approval.time = iso(T(app) + Math.floor(Math.min(30, Math.max(0.5, APPROVAL_MEDIAN_H * logNormal(0.8))) * HOUR_MS));
	}
	const approvedT = approval ? T(approval) : null;

	// ── new shippers who are never approved for credit browse rates briefly, then leave ──
	if (born && !approval) {
		const lim = T(signup) + NONAPPROVED_DAYS * DAY_MS;
		events = events.filter((e) => ONBOARDING.has(e.event) || e === onboardLane || ((e.event === "rate lookup" || e.event === "dashboard viewed") && T(e) < lim));
		profile.saved_lanes = onboardLane ? 1 : 0;
		if (onboardLane) { setLaneProps(onboardLane, profile); stripDevice(onboardLane); }
		if (profile[EXP_KEY] !== undefined) delete profile[EXP_KEY];
		return finalize(events);
	}

	const isHoliday = (t) => HOLIDAYS.includes(dayKey(t));

	// ── shipment units from the engine (one per shipment_id) and templates ──
	const pool = new Map();
	const templates = {};
	const exposures = [];
	const portal = [];
	const other = [];
	for (const e of events) {
		if (e.event === "$experiment_started") { exposures.push(e); continue; }
		if (UNIT_SET.has(e.event)) {
			if (!templates[e.event]) templates[e.event] = { ...e };
			if (!pool.has(e.shipment_id)) pool.set(e.shipment_id, {});
			pool.get(e.shipment_id)[e.event] = e;
			continue;
		}
		if (PORTAL.has(e.event)) { portal.push(e); continue; }
		other.push(e);
	}
	const haveTemplates = UNIT_STEPS.every((s) => templates[s]);
	const variant = profile[EXP_KEY] !== undefined ? profile[EXP_KEY] : null;

	// H8: new shippers' saved lanes in their first two weeks (salted, independent of activity)
	// (established shippers who joined in the two weeks before the window follow the same rule)
	const recentJoinT = !born && ms(`${profile.customer_since}T00:00:00Z`) >= BEGIN - LANE_SETUP_DAYS * DAY_MS
		? ms(`${profile.customer_since}T00:00:00Z`) + chance.integer({ min: 13 * 60, max: 20 * 60 }) * MIN_MS : null;
	const laneTarget = born || recentJoinT !== null ? Number(pickWeighted(LANE_COUNT_WEIGHTS, salt(uid, "lanes"))) : null;
	const lowLanes = laneTarget !== null && laneTarget < LANE_THRESHOLD;

	// ── plan every shipment ──
	// each engine unit is a quote session: the shipper prices one to several
	// loads a few minutes apart; every quote decides on its own whether it books
	const anchors = [];
	const addSession = (t0, unit) => {
		const session = { unit, used: new Set() };
		const m = Number(pickR(QUOTES_PER_SESSION));
		let t = t0;
		for (let i = 0; i < m; i++) {
			if (i > 0) t += chance.integer({ min: 90, max: 900 }) * 1000;
			anchors.push({ t, session, first: i === 0 });
		}
	};
	let sessions = 0;
	for (const unit of pool.values()) {
		const q = unit["quote requested"];
		if (!q) continue;
		const t = T(q);
		if (born && t < approvedT) continue;                    // a shipper books only after credit approval
		if (isHoliday(t) && !chance.bool({ likelihood: HOLIDAY_KEEP * 100 })) continue;
		if (lowLanes && !chance.bool({ likelihood: LOW_LANE_KEEP * 100 })) continue; // H8
		addSession(t, unit);
		sessions++;
	}
	// established shippers: shipments quoted before the window are still moving
	// (pickups, deliveries, invoices coming due) when it opens
	if (!born && haveTemplates && sessions) {
		const x = sessions * PREWINDOW_DAYS / WINDOW_DAYS;
		const n = Math.floor(x) + (chance.bool({ likelihood: (x % 1) * 100 }) ? 1 : 0);
		for (let i = 0; i < n; i++) {
			const t0 = BEGIN - Math.floor(chance.floating({ min: 0, max: PREWINDOW_DAYS }) * DAY_MS);
			addSession(businessTime(t0, 0), null);
		}
	}

	const plans = anchors.map(({ t, session, first }) => {
		const equip = chance.bool({ likelihood: 75 }) ? profile.primary_equipment : pickR({ dry_van: 70, reefer: 18, flatbed: 12 });
		const origin = chance.bool({ likelihood: 65 }) ? profile.home_region : pickR(REGION_WEIGHTS);
		const dest = pickR(REGION_WEIGHTS);
		const miles = Math.round(laneMiles(origin, dest) * chance.floating({ min: 0.75, max: 1.25 }));
		const [wLo, wHi] = WEIGHT_LBS[equip];
		const weight = Math.round(chance.integer({ min: wLo, max: wHi }) / 100) * 100;
		const spread = drawSpread();
		const market = marketRate(dayKey(t), equip);
		const rpm = round2(market * (1 + spread));
		const total = round2(rpm * miles);
		const leadDays = chance.integer({ min: 1, max: 3 });
		// H3: Instant Book (variant arm, dry van quotes from the test start)
		const enrolled = variant !== null && equip === "dry_van" && t >= ms(INSTANT_BOOK_START);
		const isVar = enrolled && variant === VARIANT;
		// H2: booking probability from the spread over the spot market
		const booked = chance.bool({ likelihood: Math.min(95, bookRate(spread) * (isVar ? INSTANT_BOOK_MULT : 1) * 100) });
		const instant = isVar && chance.bool({ likelihood: INSTANT_SHARE * 100 });
		const tb = t + (instant
			? Math.max(20_000, Math.floor(INSTANT_MEDIAN_MIN * MIN_MS * logNormal(0.6)))
			: Math.floor(Math.min(72, NEGOTIATE_MEDIAN_H * logNormal(1.0)) * HOUR_MS));
		const appt = chance.bool({ likelihood: APPT_RATE[tier] * 100 });
		// H4: coverage time by equipment
		const coverH = COVER_MEDIAN_H * COVER_MULT[equip] * logNormal(COVER_SIGMA);
		const tc = tb + Math.floor(coverH * HOUR_MS);
		let tp = businessTime(tb, leadDays);
		if (tp < tc + HOUR_MS) tp = tc + chance.integer({ min: 120, max: 360 }) * MIN_MS;
		const plannedH = miles / 520 * 24 + chance.floating({ min: 3, max: 8 });
		let plannedTd = tp + Math.floor(plannedH * HOUR_MS);
		// many receivers are closed on weekends: half of weekend delivery appointments
		// move to the next business days (Monday or Tuesday, as dock slots allow)
		const pdow = new Date(plannedTd).getUTCDay();
		if ((pdow === 0 || pdow === 6) && chance.bool({ likelihood: WEEKEND_MOVE_SHARE * 100 })) plannedTd = businessTime(plannedTd, chance.bool({ likelihood: 60 }) ? 1 : 2);
		// H7: storm on Gulf lanes; base lateness otherwise
		const gulf = STORM_REGIONS.includes(origin) || STORM_REGIONS.includes(dest);
		const stormHit = gulf && (inStorm(tp) || inStorm(plannedTd) || (tp < ms(STORM_START) && plannedTd >= ms(STORM_END)));
		const late = chance.bool({ likelihood: (stormHit ? STORM_LATE_RATE : BASE_LATE_RATE) * 100 });
		const delayH = late ? (stormHit ? chance.floating({ min: 20, max: 72 }) : chance.floating({ min: 4, max: 36 })) : 0;
		const td = plannedTd + Math.floor(delayH * HOUR_MS) - (late ? 0 : chance.integer({ min: 0, max: 180 }) * MIN_MS);
		const exception = late
			? (chance.bool({ likelihood: 85 }) ? (stormHit ? "weather_delay" : pickR({ mechanical: 30, missed_appointment: 22, traffic: 20, weather_delay: 10, consignee_closed: 18 })) : null)
			: (chance.bool({ likelihood: 3 }) ? pickR({ damage: 60, shortage: 40 }) : null);
		const tex = tp + Math.floor((td - tp) * chance.floating({ min: 0.3, max: 0.8 }));
		// shipper tracking views while the load moves
		const nViews = chance.integer({ min: 1, max: 3 }) + (late ? 2 : 0);
		const views = Array.from({ length: nViews }, () => shipperTime(tp + Math.floor((td - tp) * 0.05), td));
		// tickets
		const tickets = [];
		const tTrack = shipperTime(tp + Math.floor((td - tp) * 0.1), tp + Math.floor((td - tp) * 0.95));
		if (chance.bool({ likelihood: TRACK_TICKET_RATE * 100 }) && chance.bool({ likelihood: liveEtaKeep(tTrack) * 100 })) tickets.push({ t: tTrack, cat: "tracking_status" });
		if (chance.bool({ likelihood: BOOKING_CHANGE_RATE * 100 })) tickets.push({ t: shipperTime(tb + Math.floor((tp - tb) * 0.1), tb + Math.floor((tp - tb) * 0.9)), cat: "booking_change" });
		if (chance.bool({ likelihood: (late ? 40 : 2) })) tickets.push({ t: shipperTime(td + 30 * MIN_MS, td + 36 * HOUR_MS), cat: "delivery_issue" });
		if (chance.bool({ likelihood: BILLING_TICKET_RATE * 100 })) tickets.push({ t: shipperTime(td + 3 * DAY_MS, td + 10 * DAY_MS), cat: "billing_question" });
		// H9: accessorials
		const acc = [];
		if (chance.bool({ likelihood: DETENTION_RATE * (appt ? APPT_DETENTION_MULT : 1) * 100 })) acc.push({ type: "detention", amount: 75 * chance.integer({ min: 2, max: 6 }) });
		if (chance.bool({ likelihood: LUMPER_RATE * 100 })) acc.push({ type: "lumper", amount: chance.integer({ min: 12, max: 38 }) * 10 });
		if (late && chance.bool({ likelihood: 20 })) acc.push({ type: "layover", amount: chance.integer({ min: 30, max: 45 }) * 10 });
		const accT = acc.map(() => td + chance.integer({ min: 120, max: 480 }) * MIN_MS);
		const accTotal = acc.reduce((s, a) => s + a.amount, 0);
		const payDays = Math.max(3, PAY_DAYS_MEDIAN[tier] * logNormal(0.35));
		const tinv = businessTime(td, Math.max(2, Math.round(payDays * 5 / 7))); // payment runs on business days
		return {
			t, session, first, equip, origin, dest, miles, weight, rpm, total, leadDays, spread, enrolled, isVar,
			booked, instant, tb, appt, tc, tp, td, late, delayH, exception, tex, views, tickets, acc, accT, accTotal, tinv,
			transitH: (td - tp) / HOUR_MS,
		};
	});

	// H5: a new shipper whose first delivered load was late leaves with p = LATE_FIRST_CHURN
	let cut = Infinity;
	if (born) {
		const first = plans.filter((p) => p.booked && p.td >= BEGIN && p.td <= END).sort((a, b) => a.td - b.td)[0];
		if (first && first.late && chance.bool({ likelihood: LATE_FIRST_CHURN * 100 })) {
			cut = Math.floor(first.td + chance.floating({ min: CHURN_DAY_MIN, max: CHURN_DAY_MAX }) * DAY_MS);
		}
	}

	// ── materialize shipments ──
	const unitEvents = [];
	const out = (ev) => { if (T(ev) >= BEGIN && T(ev) <= END) unitEvents.push(ev); };
	for (const p of plans) {
		if (!haveTemplates || p.t >= cut) continue;
		const src = p.session.unit;
		const used = p.session.used;
		const id = src && p.first ? src["quote requested"].shipment_id : `SHP-${chance.string({ length: 10, pool: "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" })}`;
		const put = (step, t, set) => {
			let ev = src && src[step] && !used.has(step) ? src[step] : null;
			if (ev) used.add(step);
			else ev = cloneEvent(templates[step], { time: iso(t) });
			ev.time = iso(t);
			ev.shipment_id = id;
			Object.assign(ev, set);
			if (SYSTEM_EVENTS.has(step)) stripDevice(ev);
			out(ev);
		};
		const lane = { equipment_type: p.equip, origin_region: p.origin, destination_region: p.dest };
		put("quote requested", p.t, { ...lane, lane_miles: p.miles, weight_lbs: p.weight, quoted_rate_per_mile: p.rpm, quoted_total_usd: p.total, pickup_lead_days: p.leadDays });
		if (!p.booked || p.tb >= cut) continue;
		put("load booked", p.tb, { ...lane, lane_miles: p.miles, customer_rate_usd: p.total, booking_method: p.instant ? "instant" : "negotiated", appointment_scheduled: p.appt });
		put("carrier assigned", p.tc, { equipment_type: p.equip, carrier_tier: pickR({ preferred: 58, standard: 32, new_partner: 10 }) });
		put("pickup confirmed", p.tp, { ...lane });
		for (const tv of p.views) {
			if (tv >= cut) continue;
			const fromEta = tv >= ms(LIVE_ETA_LAUNCH) && chance.bool({ likelihood: ETA_VIEW_SHARE * 100 });
			put("shipment tracked", tv, { view_source: fromEta ? "eta_notification" : pickR({ portal: 62, tracking_link: 38 }) });
		}
		if (p.exception) put("delivery exception", p.tex, { exception_type: p.exception, delay_hours: round1(p.delayH) });
		put("load delivered", p.td, { ...lane, on_time: !p.late, transit_hours: round1(p.transitH) });
		p.acc.forEach((a, i) => put("accessorial charged", p.accT[i], { charge_type: a.type, amount_usd: a.amount }));
		put("invoice paid", p.tinv, { amount_usd: round2(p.total + p.accTotal), days_to_pay: Math.round((p.tinv - p.td) / DAY_MS), payment_method: pickR(tier === "small_business" ? { card: 45, ach: 50, check: 5 } : { ach: 78, check: 15, card: 7 }) });
		for (const tk of p.tickets) {
			if (tk.t >= cut) continue;
			put("support ticket created", tk.t, { ticket_category: tk.cat, contact_channel: pickR({ chat: 48, email: 34, phone: 18 }) });
		}
	}

	// ── portal activity: holidays, the H5 cut ──
	let kept = portal.filter((e) => {
		if (e.event === "lane saved") return false;              // lanes are handled below
		const t = T(e);
		if (t >= cut) return false;
		if (born && t < approvedT && e.event !== "rate lookup" && e.event !== "dashboard viewed") return false;
		if (isHoliday(t) && !chance.bool({ likelihood: HOLIDAY_KEEP * 100 })) return false;
		return true;
	});
	// ── saved lanes (H8): a new shipper saves exactly laneTarget lanes in the first
	// 14 days after signup (the onboarding lane included; skipping it means 0) ──
	const laneEvents = portal.filter((e) => e.event === "lane saved");
	if (born) {
		const t0 = T(signup);
		const winEnd = Math.min(t0 + LANE_SETUP_DAYS * DAY_MS, cut, END + 1);
		const template = laneEvents.find((e) => e !== onboardLane) || onboardLane;
		const inWin = laneEvents.filter((e) => T(e) >= t0 && T(e) < winEnd).sort((a, b) => T(a) - T(b));
		const lanes = inWin.slice(0, laneTarget);
		const sessions = kept.filter((e) => e.event === "dashboard viewed" && T(e) >= t0 && T(e) < winEnd);
		while (template && lanes.length < laneTarget) {
			const t = sessions.length && chance.bool({ likelihood: 70 })
				? T(sessions[chance.integer({ min: 0, max: sessions.length - 1 })]) + chance.integer({ min: 20, max: 300 }) * 1000
				: t0 + Math.floor(chance.floating({ min: 0.02, max: 0.98 }) * (winEnd - t0));
			lanes.push(cloneEvent(template, { time: iso(Math.min(t, winEnd - 1)) }));
		}
		kept = kept.concat(lanes);
		profile.saved_lanes = lanes.length;
	} else if (recentJoinT !== null) {
		// joined just before the window: the first lanes, spread over their first 14 days
		const template = laneEvents[0];
		const lanes = [];
		for (let i = 0; template && i < laneTarget; i++) {
			const t = shipperTime(recentJoinT, recentJoinT + LANE_SETUP_DAYS * DAY_MS);
			if (t >= BEGIN && t < cut) lanes.push(cloneEvent(template, { time: iso(t) }));
		}
		kept = kept.concat(lanes);
		profile.saved_lanes = laneTarget;
	} else {
		const lanes = laneEvents.filter((e) => T(e) < cut && chance.bool({ likelihood: ESTABLISHED_LANE_TRICKLE * 100 }));
		kept = kept.concat(lanes);
		profile.saved_lanes += lanes.length;
	}
	for (const e of kept) {
		if (e.event === "lane saved" || e.event === "rate lookup") setLaneProps(e, profile);
		if (e.event === "lane saved") stripDevice(e); // the lanes service records saves server-side
	}

	// ── experiment exposure: one per shipper, 1 s before their first dry van quote from the test start ──
	const exposed = [];
	if (variant !== null && exposures.length) {
		const first = unitEvents.filter((e) => e.event === "quote requested" && e.equipment_type === "dry_van" && T(e) >= ms(INSTANT_BOOK_START)).sort((a, b) => T(a) - T(b))[0];
		if (first) {
			const ex = exposures[0];
			ex.time = iso(T(first) - 1000);
			exposed.push(ex);
		}
	}
	if (!exposed.length && profile[EXP_KEY] !== undefined) delete profile[EXP_KEY];

	const rest = other.filter((e) => T(e) < cut || ONBOARDING.has(e.event));
	return finalize(rest.concat(kept, unitEvents, exposed).filter((e) => T(e) >= BEGIN && T(e) <= END));
}

// H6: the credit team approves each channel's declared share of applicants,
// spread evenly through the run (an error-diffusion quota per channel, state kept
// per run) instead of an independent coin per shipper, so the channel approval
// rates the story compares are not moved by a few hundred coin flips
const approvalTally = new WeakMap();
function handleFunnelPre(funnel, meta) {
	if (!meta.isFirstFunnel || !meta.isBorn) return funnel;
	if (!approvalTally.has(meta.config)) approvalTally.set(meta.config, new Map());
	const tally = approvalTally.get(meta.config);
	const ch = meta.profile.acquisition_channel;
	const p = funnel.conversionRate / 100;
	const n = tally.get(ch) ?? 0;
	tally.set(ch, n + 1);
	funnel.conversionRate = Math.floor((n + 1) * p + 0.5) > Math.floor(n * p + 0.5) ? 100 : 0;
	return funnel;
}

// warehouse rows: exogenous business facts layered on event-derived volumes
function handleWarehouse(row, meta) {
	if (meta.isBackfill) return row;
	if (meta.metricName === "spot_market_rates_daily") {
		// industry load-board posts follow the season of our own quote flow but run
		// their own course; truck posts follow from the market's load-to-truck ratio
		const k = `${row.date}|${row.equipment_type}`;
		const posts = Math.round(row.market_load_posts * 38 * jitter(`posts|${k}`, 0.3) + 1500 * jitter(`posts0|${k}`, 0.8));
		const base = { dry_van: 3.1, reefer: 5.4, flatbed: 9.2 }[row.equipment_type] ?? 4;
		const tight = row.spot_rate_per_mile / (BASE_RATE_PER_MILE[row.equipment_type] ?? 2.2);
		const ratio = round2(base * Math.pow(tight, 3) * jitter(`ltr|${k}`, 0.08));
		row.market_load_posts = posts;
		row.market_truck_posts = Math.max(1, Math.round(posts / ratio));
		row.load_to_truck_ratio = ratio;
		return row;
	}
	if (meta.metricName === "load_margin_daily") {
		// billed revenue drifts from booked revenue: cancellations (truck ordered,
		// not used) and rate adjustments; carrier cost from the method's margin
		const k = `${row.date}|${row.booking_method}`;
		const booked = meta.raw?.plus?.count ?? 0;
		const cancels = booked > 0 && hashFloat(`cancel|${k}`) < 0.7 ? Math.min(booked - 1, Math.round(booked * 0.04 * jitter(`cn|${k}`, 1))) : 0;
		const loads = Math.max(0, booked - cancels);
		// rebills, fuel true-ups, and short pays move billed revenue by up to ±20% a day
		const revenue = booked > 0 ? round2(row.gross_revenue_usd * (loads / booked) * jitter(`adj|${k}`, 0.2)) : 0;
		const d = (ms(`${row.date}T00:00:00Z`) - ms(STORM_START)) / DAY_MS;
		const squeeze = d >= 0 && d < 12 ? STORM_MARGIN_SQUEEZE * (d < 5 ? 1 : (12 - d) / 7) : 0;
		const pct = loads > 0 ? Math.max(0.01, (MARGIN_PCT[row.booking_method] ?? 0.15) * (1 - squeeze) + (hashFloat(`m|${k}`) - 0.5) * 0.03) : 0;
		row.gross_revenue_usd = revenue;
		row.loads_booked = loads;
		row.carrier_cost_usd = round2(revenue * (1 - pct));
		row.gross_margin_usd = round2(revenue - row.carrier_cost_usd);
		row.gross_margin_pct = loads > 0 ? round3(row.gross_margin_usd / revenue) : 0;
		return row;
	}
	if (meta.metricName === "paid_marketing_daily") {
		const k = `${row.date}|${row.acquisition_channel}`;
		const spend = paidSpend(row.date, row.acquisition_channel, row.spend_usd);
		row.spend_usd = spend;
		row.leads_reported = Math.round(spend * PLATFORM_LEAD_INFLATION / CPL_USD[row.acquisition_channel] * jitter(`lead|${k}`, 0.2));
		row.clicks = Math.round(spend / (CPC_USD[row.acquisition_channel] * jitter(`cpc|${k}`, 0.15)));
		row.impressions = Math.round(row.clicks / (CTR[row.acquisition_channel] * jitter(`ctr|${k}`, 0.15)));
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
		hasSessionIds: true,
		alsoInferFunnels: false,
		hasLocation: false,
		hasAndroidDevices: false,
		hasIOSDevices: false,
		hasDesktopDevices: true,
		hasBrowser: true,
		hasCampaigns: false,
		isAnonymous: false,
		hasAdSpend: false,
		hasAvatar: true,
	},
	identity: { avgDevicePerUser: 2 },
	stickyEventProps: ["company_tier"],

	events: [
		{
			event: "account created",
			weight: 1,
			isFirstEvent: true,
			isAuthEvent: true,
			properties: {
				signup_method: { __weights: { email: 52, google_sso: 30, microsoft_sso: 18 } },
				acquisition_channel: (ctx) => ctx.profile.acquisition_channel,
			},
		},
		{
			event: "credit application submitted",
			weight: 1,
			isStrictEvent: true,
			properties: {
				annual_freight_spend_band: (ctx) => ctx.profile.annual_freight_spend_band,
				years_in_business: { __weights: { under_2: 18, "2_to_5": 27, "5_to_10": 22, over_10: 33 } },
			},
		},
		{
			event: "credit approved",
			weight: 1,
			isStrictEvent: true,
			properties: {
				credit_limit_usd: (ctx) => ctx.profile.credit_limit_usd,
				payment_terms: (ctx) => ctx.profile.payment_terms,
			},
		},
		{
			event: "quote requested",
			weight: 1,
			isStrictEvent: true,
			properties: {
				shipment_id: ["unassigned"],
				equipment_type: ["dry_van"],
				origin_region: ["midwest"],
				destination_region: ["midwest"],
				lane_miles: [0],
				weight_lbs: [0],
				quoted_rate_per_mile: [0],
				quoted_total_usd: [0],
				pickup_lead_days: [1],
			},
		},
		{
			event: "load booked",
			weight: 1,
			isStrictEvent: true,
			properties: {
				shipment_id: ["unassigned"],
				equipment_type: ["dry_van"],
				origin_region: ["midwest"],
				destination_region: ["midwest"],
				lane_miles: [0],
				customer_rate_usd: [0],
				booking_method: ["negotiated"],
				appointment_scheduled: [false],
			},
		},
		{
			event: "carrier assigned",
			weight: 1,
			isStrictEvent: true,
			properties: {
				shipment_id: ["unassigned"],
				equipment_type: ["dry_van"],
				carrier_tier: ["preferred"],
			},
		},
		{
			event: "pickup confirmed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				shipment_id: ["unassigned"],
				equipment_type: ["dry_van"],
				origin_region: ["midwest"],
				destination_region: ["midwest"],
			},
		},
		{
			event: "shipment tracked",
			weight: 1,
			isStrictEvent: true,
			properties: {
				shipment_id: ["unassigned"],
				view_source: ["portal"],
			},
		},
		{
			event: "delivery exception",
			weight: 1,
			isStrictEvent: true,
			properties: {
				shipment_id: ["unassigned"],
				exception_type: ["traffic"],
				delay_hours: [0],
			},
		},
		{
			event: "load delivered",
			weight: 1,
			isStrictEvent: true,
			properties: {
				shipment_id: ["unassigned"],
				equipment_type: ["dry_van"],
				origin_region: ["midwest"],
				destination_region: ["midwest"],
				on_time: [true],
				transit_hours: [0],
			},
		},
		{
			event: "accessorial charged",
			weight: 1,
			isStrictEvent: true,
			properties: {
				shipment_id: ["unassigned"],
				charge_type: ["detention"],
				amount_usd: [0],
			},
		},
		{
			event: "invoice paid",
			weight: 1,
			isStrictEvent: true,
			properties: {
				shipment_id: ["unassigned"],
				amount_usd: [0],
				days_to_pay: [0],
				payment_method: ["ach"],
			},
		},
		{
			event: "support ticket created",
			weight: 1,
			isStrictEvent: true,
			properties: {
				shipment_id: ["unassigned"],
				ticket_category: ["booking_change"],
				contact_channel: ["chat"],
			},
		},
		{
			event: "dashboard viewed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				dashboard_name: { __weights: { active_shipments: 46, spend_overview: 18, carrier_scorecard: 12, lane_analytics: 14, invoices: 10 } },
			},
		},
		{
			event: "lane saved",
			weight: 1,
			isStrictEvent: true,
			properties: {
				equipment_type: ["dry_van"],
				origin_region: ["midwest"],
				destination_region: ["midwest"],
			},
		},
		{
			event: "rate lookup",
			weight: 1,
			isStrictEvent: true,
			properties: {
				equipment_type: ["dry_van"],
				origin_region: ["midwest"],
				destination_region: ["midwest"],
			},
		},
		{
			event: "document downloaded",
			weight: 1,
			isStrictEvent: true,
			properties: {
				document_type: { __weights: { bill_of_lading: 38, proof_of_delivery: 34, rate_confirmation: 18, invoice_pdf: 10 } },
			},
		},
		{
			event: "report exported",
			weight: 1,
			isStrictEvent: true,
			properties: {
				report_type: { __weights: { shipment_history: 40, freight_spend: 28, on_time_performance: 20, accessorials: 12 } },
				file_format: { __weights: { csv: 55, xlsx: 35, pdf: 10 } },
			},
		},
		{
			event: "$experiment_started",
			weight: 1,
			isStrictEvent: true,
			properties: {
				"Experiment name": [EXPERIMENT_NAME],
				"Variant name": ["Control", VARIANT],
			},
		},
	],

	funnels: [
		{
			name: "Shipper onboarding",
			sequence: ONBOARDING_STEPS,
			isFirstFunnel: true,
			conditions: { acquisition_channel: { neq: "google_ads" } },
			conversionRate: APPROVAL_CONV,
			timeToConvert: APPROVAL_TTC_H,
			order: "sequential",
			weight: 1,
		},
		{
			name: "Shipper onboarding",
			sequence: ONBOARDING_STEPS,
			isFirstFunnel: true,
			conditions: { acquisition_channel: "google_ads" },
			conversionRate: Math.round(APPROVAL_CONV * GOOGLE_APPROVAL_MULT),
			timeToConvert: APPROVAL_TTC_H,
			order: "sequential",
			weight: 1,
		},
		{
			// one shipment: the everything hook decides each step and its timing
			name: "Shipment",
			sequence: UNIT_STEPS,
			conversionRate: 100,
			timeToConvert: 1,
			order: "sequential",
			weight: 3,
			props: {
				shipment_id: () => `SHP-${chance.string({ length: 10, pool: "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" })}`,
			},
			experiment: {
				name: EXPERIMENT_NAME,
				variants: [{ name: "Control" }, { name: VARIANT }],
			},
		},
		{
			// a portal session: dashboards, rate checks, documents, reports
			name: "Portal session",
			sequence: ["dashboard viewed", "lane saved", "rate lookup", "document downloaded", "rate lookup", "report exported", "dashboard viewed"],
			conversionRate: 55,
			timeToConvert: 0.5,
			order: "first-fixed",
			weight: 2,
		},
	],

	warehouseMetrics: [
		{
			name: "spot_market_rates_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "quote requested",
				measure: "count",
				groupBy: "equipment_type",
			},
			timeColumn: "date",
			valueColumn: "market_load_posts",
			columns: {
				market_truck_posts: 0,
				load_to_truck_ratio: 0,
				spot_rate_per_mile: (ctx) => marketRate(dayKey(ctx.time), ctx.row.equipment_type),
				diesel_usd_per_gallon: (ctx) => dieselPrice(dayKey(ctx.time)),
			},
		},
		{
			name: "load_margin_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "load booked",
				measure: "sum",
				property: "customer_rate_usd",
				groupBy: "booking_method",
			},
			timeColumn: "date",
			valueColumn: "gross_revenue_usd",
			columns: {
				loads_booked: 0,
				carrier_cost_usd: 0,
				gross_margin_usd: 0,
				gross_margin_pct: 0,
			},
		},
		{
			name: "paid_marketing_daily",
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
				leads_reported: 0,
				clicks: 0,
				impressions: 0,
			},
		},
	],

	superProps: {
		company_tier: ["small_business"],
	},

	userProps: {
		company_tier: ["small_business"],
		industry: { __weights: INDUSTRY_WEIGHTS },
		primary_equipment: ["dry_van"],
		home_region: ["midwest"],
		acquisition_channel: { __weights: CHANNEL_WEIGHTS },
		customer_since: ["2025-01-01"],
		credit_limit_usd: [0],
		payment_terms: ["net_30"],
		annual_freight_spend_band: ["under_1m"],
		saved_lanes: [0],
	},

	personas: [
		{ name: "enterprise_shipper", weight: 15, eventMultiplier: 2.0, properties: { company_tier: "enterprise" } },
		{ name: "mid_market_shipper", weight: 35, eventMultiplier: 1.2, properties: { company_tier: "mid_market" } },
		{ name: "small_business_shipper", weight: 50, eventMultiplier: 0.75, properties: { company_tier: "small_business" } },
	],

	hook(record, type, meta) {
		if (type === "user") return handleUserHook(record, meta);
		if (type === "funnel-pre") return handleFunnelPre(record, meta);
		if (type === "everything") return handleEverything(record, meta);
		if (type === "warehouse") return handleWarehouse(record, meta);
		return record;
	},
};

// ── STORIES ──────────────────────────────────────────────────────────────
// Machine-checkable contract for hooks H1-H9. Evaluate with:
//   node dungeons/vertical/logistics/logistics.verify.mjs

const EV = `read_json_auto('{{PREFIX}}-EVENTS*.json*', sample_size=-1, union_by_name=true)`;
const US = `read_json_auto('{{PREFIX}}-USERS*.json*', sample_size=-1, union_by_name=true)`;
const WH = (table) => `read_json_auto('{{PREFIX}}-WAREHOUSE-${table}.json*', sample_size=-1, union_by_name=true)`;

// Identity prelude: a device resolves to the shipper seen with it on any event
// that carries both ids (emitted stitch evidence). Every Routewise event carries
// user_id, so uid = user_id in practice.
const ID_CTE = `dmap AS (SELECT device_id, min(user_id::VARCHAR) AS mapped FROM ${EV}
  WHERE user_id IS NOT NULL AND device_id IS NOT NULL GROUP BY 1),
ev AS (SELECT coalesce(e.user_id::VARCHAR, m.mapped) AS uid, e.time::TIMESTAMP AS t, e.*
  FROM ${EV} e LEFT JOIN dmap m ON e.device_id = m.device_id)`;

const TS = (isoStr) => dayjs.utc(isoStr).format("YYYY-MM-DD HH:mm:ss");
const D = (isoStr) => isoStr.slice(0, 10);
const band = (k) => [Math.round(k * 0.9 * 1000) / 1000, Math.round(k * 1.1 * 1000) / 1000];
const SQL_LIST = (xs) => xs.map((x) => `'${x}'`).join(", ");
const LIVE_ETA_RAMPED = TS(dayjs.utc(LIVE_ETA_LAUNCH).add(LIVE_ETA_RAMP_DAYS, "day").toISOString());
const BOOK_WINDOW_DAYS = 7;          // H2/H3 read: Funnels conversion window quote → booking
const QUOTE_READ_END = TS(dayjs.utc(DATASET_END).subtract(BOOK_WINDOW_DAYS, "day").toISOString()); // quotes with a full window
const DETENTION_READ_END = "2026-09-15 00:00:00"; // H9: loads booked by Sep 14 are delivered and billed in the window
const RET_FROM = 14;                 // H5 read: return on or after day 14 after the first delivery
const RET_BIRTH_END = TS(dayjs.utc(DATASET_END).subtract(RET_FROM, "day").toISOString());
const ACTIVE_EVENTS = ["quote requested", "load booked", "shipment tracked", "support ticket created", "dashboard viewed", "rate lookup", "document downloaded", "report exported", "lane saved"];
const STORM_PRE_FROM = TS(dayjs.utc(STORM_START).subtract(14, "day").toISOString());

const H1_SQL = `WITH ${ID_CTE},
w AS (SELECT CASE WHEN t < TIMESTAMP '${TS(LIVE_ETA_LAUNCH)}' THEN 'before' WHEN t >= TIMESTAMP '${LIVE_ETA_RAMPED}' THEN 'after' END AS per, event, ticket_category, uid FROM ev
  WHERE event IN ('support ticket created', 'pickup confirmed', 'load booked')),
g AS (SELECT per, count(DISTINCT uid) AS users,
  count(*) FILTER (WHERE event = 'support ticket created' AND ticket_category = 'tracking_status')::DOUBLE / count(*) FILTER (WHERE event = 'pickup confirmed') AS track_rate,
  count(*) FILTER (WHERE event = 'support ticket created' AND ticket_category IN ('booking_change', 'billing_question'))::DOUBLE / count(*) FILTER (WHERE event = 'load booked') AS other_rate
  FROM w WHERE per IS NOT NULL GROUP BY 1)
SELECT 'all' AS grp, min(users) AS user_count,
 max(track_rate) FILTER (WHERE per = 'after') / max(track_rate) FILTER (WHERE per = 'before') AS track_ratio,
 max(other_rate) FILTER (WHERE per = 'after') / max(other_rate) FILTER (WHERE per = 'before') AS other_ratio
FROM g`;

const QUOTES_CTE = `m AS (SELECT date::DATE AS d, equipment_type, spot_rate_per_mile FROM ${WH("spot_market_rates_daily")}),
q AS (SELECT ev.uid, ev.shipment_id, ev.t, ev.equipment_type, ev.quoted_rate_per_mile / m.spot_rate_per_mile - 1 AS spread
  FROM ev JOIN m ON m.d = ev.t::DATE AND m.equipment_type = ev.equipment_type
  WHERE ev.event = 'quote requested' AND ev.t < TIMESTAMP '${QUOTE_READ_END}'),
b AS (SELECT shipment_id, min(t) AS tb, any_value(booking_method) AS booking_method FROM ev WHERE event = 'load booked' GROUP BY 1)`;

const H2_SQL = `WITH ${ID_CTE}, ${QUOTES_CTE}
SELECT CASE WHEN spread <= ${COMPETITIVE_MAX} THEN 'at_market' WHEN spread > ${EXPENSIVE_MIN} THEN 'expensive' ELSE 'middle' END AS grp,
 count(DISTINCT q.uid) AS user_count, count(*) AS quotes,
 avg(coalesce(b.tb >= q.t AND b.tb < q.t + INTERVAL ${BOOK_WINDOW_DAYS} DAY, false)::INT) AS book_rate
FROM q LEFT JOIN b USING (shipment_id) GROUP BY 1`;

const H3_SQL = `WITH ${ID_CTE}, ${QUOTES_CTE},
v AS (SELECT distinct_id::VARCHAR AS uid, "${EXP_KEY}" AS variant FROM ${US} WHERE "${EXP_KEY}" IS NOT NULL)
SELECT v.variant AS grp, count(DISTINCT q.uid) AS user_count, count(*) AS quotes,
 avg(coalesce(b.tb >= q.t AND b.tb < q.t + INTERVAL ${BOOK_WINDOW_DAYS} DAY, false)::INT) AS book_rate,
 avg((b.booking_method = 'instant')::INT) FILTER (WHERE b.tb IS NOT NULL) AS instant_share
FROM q JOIN v ON v.uid = q.uid LEFT JOIN b USING (shipment_id)
WHERE q.equipment_type = 'dry_van' AND q.t >= TIMESTAMP '${TS(INSTANT_BOOK_START)}' GROUP BY 1`;

const H4_SQL = `WITH ${ID_CTE},
bk AS (SELECT shipment_id, any_value(uid) AS uid, min(t) AS tb, any_value(equipment_type) AS equipment_type FROM ev WHERE event = 'load booked' GROUP BY 1),
c AS (SELECT shipment_id, min(t) AS tc FROM ev WHERE event = 'carrier assigned' GROUP BY 1)
SELECT bk.equipment_type AS grp, count(DISTINCT bk.uid) AS user_count, count(*) AS loads,
 median(date_diff('second', bk.tb, c.tc) / 3600.0) AS med_hours
FROM bk JOIN c USING (shipment_id) WHERE c.tc >= bk.tb AND c.tc < bk.tb + INTERVAL 30 DAY GROUP BY 1`;

const H5_SQL = `WITH ${ID_CTE},
s AS (SELECT DISTINCT uid FROM ev WHERE event = 'account created'),
f AS (SELECT uid, t AS f0, on_time, row_number() OVER (PARTITION BY uid ORDER BY t, insert_id) AS rn FROM ev WHERE event = 'load delivered' AND uid IN (SELECT uid FROM s)),
f1 AS (SELECT * FROM f WHERE rn = 1 AND f0 <= TIMESTAMP '${RET_BIRTH_END}'),
r AS (SELECT f1.uid, bool_or(e.t >= f1.f0 + INTERVAL ${RET_FROM} DAY) AS ret
  FROM f1 LEFT JOIN ev e ON e.uid = f1.uid AND e.event = 'quote requested' GROUP BY 1)
SELECT CASE WHEN f1.on_time THEN 'on_time' ELSE 'late' END AS grp, count(*) AS user_count, avg(coalesce(r.ret, false)::INT) AS retention
FROM f1 JOIN r ON r.uid = f1.uid GROUP BY 1`;

const H6_SQL = `WITH ${ID_CTE},
s AS (SELECT uid, t AS t0, acquisition_channel AS ch FROM ev WHERE event = 'account created'),
a AS (SELECT s.uid FROM s JOIN ev e ON e.uid = s.uid AND e.event = 'credit approved' AND e.t >= s.t0 AND e.t < s.t0 + INTERVAL 7 DAY GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM ${WH("paid_marketing_daily")} GROUP BY 1),
g AS (SELECT s.ch, count(*) AS signups, count(a.uid) AS approved FROM s LEFT JOIN a ON a.uid = s.uid GROUP BY 1)
SELECT g.ch AS grp, g.signups AS user_count, g.approved::DOUBLE / g.signups AS approval,
 sp.spend / g.signups AS spend_per_signup, sp.spend / g.approved AS spend_per_approved
FROM g LEFT JOIN sp ON sp.ch = g.ch
UNION ALL
SELECT 'not_google' AS grp, sum(signups)::BIGINT AS user_count, sum(approved)::DOUBLE / sum(signups) AS approval, NULL, NULL FROM g WHERE ch <> 'google_ads'`;

const H7_SQL = `WITH ${ID_CTE},
p AS (SELECT shipment_id, any_value(uid) AS uid, min(t) AS tp,
  bool_or(origin_region IN (${SQL_LIST(STORM_REGIONS)}) OR destination_region IN (${SQL_LIST(STORM_REGIONS)})) AS gulf
  FROM ev WHERE event = 'pickup confirmed' GROUP BY 1),
d AS (SELECT shipment_id, bool_and(on_time) AS on_time FROM ev WHERE event = 'load delivered' GROUP BY 1),
x AS (SELECT p.*, d.on_time, (p.gulf AND p.tp >= TIMESTAMP '${TS(STORM_START)}' AND p.tp < TIMESTAMP '${TS(STORM_END)}') AS storm_gulf FROM p JOIN d USING (shipment_id))
SELECT CASE WHEN storm_gulf THEN 'storm_gulf' ELSE 'everything_else' END AS grp, count(DISTINCT uid) AS user_count, count(*) AS loads,
 avg((NOT on_time)::INT) AS late_share
FROM x GROUP BY 1`;

// H8 compares lane buckets within each company tier (tier drives how much a
// shipper ships; lane counts are drawn independently of tier), then weights the
// per-tier ratios by the tier's share of approved new shippers
const H8_SQL = `WITH ${ID_CTE},
a AS (SELECT DISTINCT uid FROM ev WHERE event = 'credit approved'),
n AS (SELECT a.uid, count(e.uid) AS loads FROM a LEFT JOIN ev e ON e.uid = a.uid AND e.event = 'load booked' GROUP BY 1),
u AS (SELECT distinct_id::VARCHAR AS uid, saved_lanes, company_tier FROM ${US}),
x AS (SELECT u.company_tier AS tier, u.saved_lanes AS k, n.loads FROM n JOIN u ON u.uid = n.uid),
t AS (SELECT tier, count(*) AS users,
  avg(loads) FILTER (WHERE k < ${LANE_THRESHOLD}) AS m_lo, avg(loads) FILTER (WHERE k >= ${LANE_THRESHOLD}) AS m_hi,
  avg(loads) FILTER (WHERE k BETWEEN ${LANE_THRESHOLD} AND 4) AS m_mid, avg(loads) FILTER (WHERE k >= 5) AS m_top,
  count(*) FILTER (WHERE k < ${LANE_THRESHOLD}) AS n_lo, count(*) FILTER (WHERE k >= ${LANE_THRESHOLD}) AS n_hi,
  count(*) FILTER (WHERE k BETWEEN ${LANE_THRESHOLD} AND 4) AS n_mid, count(*) FILTER (WHERE k >= 5) AS n_top
  FROM x GROUP BY 1)
SELECT 'threshold' AS grp, least(sum(n_lo), sum(n_hi))::BIGINT AS user_count, sum(m_lo / m_hi * users) / sum(users) AS ratio FROM t
UNION ALL
SELECT 'plateau' AS grp, least(sum(n_mid), sum(n_top))::BIGINT AS user_count, sum(m_top / m_mid * users) / sum(users) AS ratio FROM t`;

const H9_SQL = `WITH ${ID_CTE},
bk AS (SELECT shipment_id, any_value(uid) AS uid, bool_or(appointment_scheduled) AS appt FROM ev WHERE event = 'load booked' AND t < TIMESTAMP '${DETENTION_READ_END}' GROUP BY 1),
ac AS (SELECT shipment_id, bool_or(charge_type = 'detention') AS det, bool_or(charge_type = 'lumper') AS lum FROM ev WHERE event = 'accessorial charged' GROUP BY 1)
SELECT CASE WHEN bk.appt THEN 'appointment' ELSE 'no_appointment' END AS grp, count(DISTINCT bk.uid) AS user_count, count(*) AS loads,
 avg(coalesce(ac.det, false)::INT) AS detention_share, avg(coalesce(ac.lum, false)::INT) AS lumper_share
FROM bk LEFT JOIN ac USING (shipment_id) GROUP BY 1`;

/** @type {import("../../../types").DungeonStory[]} */
export const stories = [
	{
		id: "H1-live-eta-tickets",
		hook: "H1",
		archetype: "temporal-inflection",
		narrative: `Live ETA (proactive ETA notifications plus a live map for every load in transit) launches ${D(LIVE_ETA_LAUNCH)} and reaches every shipper over ${LIVE_ETA_RAMP_DAYS} days. Before launch ${TRACK_TICKET_RATE * 100}% of loads in transit draw a "where is my truck" support ticket (ticket_category = tracking_status); the chance falls on a ${LIVE_ETA_RAMP_DAYS}-day ramp to ${LIVE_ETA_KEEP}x. Booking-change and billing tickets per booked load do not change (control). The trace of the launch: shipment tracked with view_source = eta_notification exists only from launch day. Read: tracking tickets per pickup confirmed, after the ramp (from ${LIVE_ETA_RAMPED.slice(0, 10)}) vs before launch.`,
		mixpanelReport: { type: "Insights", events: ["support ticket created (ticket_category = tracking_status)", "pickup confirmed"], formula: "A / B", chart: `weekly line; before ${D(LIVE_ETA_LAUNCH)} vs from ${LIVE_ETA_RAMPED.slice(0, 10)}` },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H1_SQL },
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.track_ratio", op: "between", target: band(LIVE_ETA_KEEP) },
				minCohort: 2000,
			},
			{
				breakdown: { type: "duckdb", sql: H1_SQL },
				select: { a: { where: { grp: "all" } } },
				// control: tickets Live ETA does not address
				expect: { metric: "a.other_ratio", op: "between", target: band(1) },
				minCohort: 2000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count, count(*) FILTER (WHERE view_source = 'eta_notification' AND t < TIMESTAMP '${TS(LIVE_ETA_LAUNCH)}') AS early FROM ev WHERE event = 'shipment tracked'`,
				},
				select: { a: { where: { grp: "all" } } },
				// exact: an ETA notification before the launch is a bug
				expect: { metric: "a.early", op: "between", target: [0, 0] },
			},
		],
	},
	{
		id: "H2-price-vs-market",
		hook: "H2",
		archetype: "external-join",
		narrative: `Shippers book quotes that are priced near the spot market. Each quote is the day's spot benchmark for its equipment (warehouse spot_market_rates_daily.spot_rate_per_mile) times (1 + spread), with spread drawn per quote (mean ${SPREAD_MEAN * 100}%, sd ${SPREAD_SD * 100}%, ${SPREAD_MIN * 100}% to ${SPREAD_MAX * 100}%). The chance a quote books falls smoothly with spread (logistic centered at ${BOOK_CURVE_CENTER * 100}%, scale ${BOOK_CURVE_SCALE * 100} points), solved so that quotes within ${COMPETITIVE_MAX * 100}% of market book ${BOOK_RATE_COMPETITIVE * 100}% of the time and quotes more than ${EXPENSIVE_MIN * 100}% over market book ${BOOK_RATE_EXPENSIVE * 100}% of the time (ratio ${(BOOK_RATE_EXPENSIVE / BOOK_RATE_COMPETITIVE).toFixed(3)}). The spread is not on the event: it needs the warehouse join on date and equipment. Read: per quote (shipment_id), booked within ${BOOK_WINDOW_DAYS} days, quotes through ${QUOTE_READ_END.slice(0, 10)}. Instant Book multiplies booking for some dry van quotes after ${D(INSTANT_BOOK_START)} at every spread, so the ratio holds.`,
		mixpanelReport: { type: "Funnels + warehouse", steps: ["quote requested", "load booked"], counting: "totals", holdPropertyConstant: "shipment_id", window: `${BOOK_WINDOW_DAYS} days`, join: "spot_market_rates_daily.spot_rate_per_mile on date + equipment_type; spread = quoted_rate_per_mile / spot_rate_per_mile - 1", breakdown: "spread buckets ≤ 5%, 5-15%, > 15%" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H2_SQL },
				select: { x: { where: { grp: "expensive" } }, c: { where: { grp: "at_market" } } },
				expect: { metric: "x.book_rate / c.book_rate", op: "between", target: band(Math.round(BOOK_RATE_EXPENSIVE / BOOK_RATE_COMPETITIVE * 1000) / 1000) },
				minCohort: 2000,
			},
		],
	},
	{
		id: "H3-instant-book-experiment",
		hook: "H3",
		archetype: "experiment-lift",
		narrative: `The "${EXPERIMENT_NAME}" test starts ${D(INSTANT_BOOK_START)} on dry van quotes: shippers are split 50/50 (sticky per shipper; one $experiment_started per shipper, 1 s before their first dry van quote from the start). In the "${VARIANT}" arm a dry van quote can be booked with one click at the quoted price: dry van quotes book ${INSTANT_BOOK_MULT}x as often as in Control, and ${INSTANT_SHARE * 100}% of variant dry van bookings carry booking_method = instant (booked within minutes; the rest still negotiate). booking_method = instant never appears in Control, before the start, or on reefer and flatbed. Instant loads earn a thinner margin: warehouse load_margin_daily shows gross margin ${MARGIN_PCT.instant * 100}% on instant loads vs ${MARGIN_PCT.negotiated * 100}% negotiated (both squeezed the same share in the storm weeks), ratio ${(MARGIN_PCT.instant / MARGIN_PCT.negotiated).toFixed(3)}. Read: per dry van quote from ${D(INSTANT_BOOK_START)} through ${QUOTE_READ_END.slice(0, 10)}, booked within ${BOOK_WINDOW_DAYS} days, by "${EXP_KEY}".`,
		mixpanelReport: { type: "Funnels + warehouse", steps: ["quote requested (equipment_type = dry_van)", "load booked"], counting: "totals", holdPropertyConstant: "shipment_id", window: `${BOOK_WINDOW_DAYS} days`, dateRange: `${D(INSTANT_BOOK_START)} to ${QUOTE_READ_END.slice(0, 10)}`, breakdown: `user property "${EXP_KEY}"`, join: "load_margin_daily gross_margin_usd / gross_revenue_usd by booking_method" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H3_SQL },
				select: { v: { where: { grp: VARIANT } }, c: { where: { grp: "Control" } } },
				expect: { metric: "v.book_rate / c.book_rate", op: "between", target: band(INSTANT_BOOK_MULT) },
				minCohort: 1500,
			},
			{
				breakdown: { type: "duckdb", sql: H3_SQL },
				select: { v: { where: { grp: VARIANT } } },
				expect: { metric: "v.instant_share", op: "between", target: band(INSTANT_SHARE) },
				minCohort: 1500,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
v AS (SELECT distinct_id::VARCHAR AS uid, "${EXP_KEY}" AS variant FROM ${US})
SELECT 'all' AS grp, count(DISTINCT ev.uid) AS user_count,
 count(*) FILTER (WHERE booking_method = 'instant' AND (t < TIMESTAMP '${TS(INSTANT_BOOK_START)}' OR equipment_type <> 'dry_van' OR v.variant IS DISTINCT FROM '${VARIANT}')) AS impure
FROM ev LEFT JOIN v ON v.uid = ev.uid WHERE event = 'load booked'`,
				},
				select: { a: { where: { grp: "all" } } },
				// exact: one-click booking exists only in the variant, on dry van, after the start
				expect: { metric: "a.impure", op: "between", target: [0, 0] },
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT booking_method AS grp, sum(loads_booked)::BIGINT AS loads, sum(gross_margin_usd) / sum(gross_revenue_usd) AS margin_pct
FROM ${WH("load_margin_daily")} WHERE date::DATE >= DATE '${D(INSTANT_BOOK_START)}' GROUP BY 1`,
				},
				select: { i: { where: { grp: "instant" } }, n: { where: { grp: "negotiated" } } },
				expect: { metric: "i.margin_pct / n.margin_pct", op: "between", target: band(Math.round(MARGIN_PCT.instant / MARGIN_PCT.negotiated * 1000) / 1000) },
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 count(DISTINCT uid) FILTER (WHERE "Variant name" = '${VARIANT}')::DOUBLE / count(DISTINCT uid) AS variant_share,
 count(*) FILTER (WHERE t < TIMESTAMP '${TS(INSTANT_BOOK_START)}') AS early
FROM ev WHERE event = '$experiment_started'`,
				},
				select: { a: { where: { grp: "all" } } },
				// equal-weight 2-arm hash → 0.5
				expect: { metric: "a.variant_share", op: "between", target: band(0.5) },
				minCohort: 2000,
			},
		],
	},
	{
		id: "H4-coverage-by-equipment",
		hook: "H4",
		archetype: "funnel-ttc-by-segment",
		narrative: `Carrier coverage (load booked → carrier assigned) takes longer for specialized equipment: the gap is log-normal with median ${COVER_MEDIAN_H} h for dry van, ${COVER_MULT.reefer}x for reefer and ${COVER_MULT.flatbed}x for flatbed (sigma ${COVER_SIGMA}). Every step of a load shares shipment_id. Read: median hours from booking to carrier assigned per load, by the booking's equipment_type.`,
		mixpanelReport: { type: "Funnels", steps: ["load booked", "carrier assigned"], counting: "totals", holdPropertyConstant: "shipment_id", window: "30 days (dungeon default)", measure: "median time to convert", breakdown: "equipment_type" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H4_SQL },
				select: { r: { where: { grp: "reefer" } }, d: { where: { grp: "dry_van" } } },
				expect: { metric: "r.med_hours / d.med_hours", op: "between", target: band(COVER_MULT.reefer) },
				minCohort: 1000,
			},
			{
				breakdown: { type: "duckdb", sql: H4_SQL },
				select: { f: { where: { grp: "flatbed" } }, d: { where: { grp: "dry_van" } } },
				expect: { metric: "f.med_hours / d.med_hours", op: "between", target: band(COVER_MULT.flatbed) },
				minCohort: 1000,
			},
		],
	},
	{
		id: "H5-late-first-load-churn",
		hook: "H5",
		archetype: "retention-divergence",
		narrative: `A new shipper (signed up in the window) whose first delivered load arrives late (load delivered with on_time = false) leaves with probability ${LATE_FIRST_CHURN}, ${CHURN_DAY_MIN}-${CHURN_DAY_MAX} days after that delivery: no more quotes, bookings, portal visits, or tickets (carrier and billing events for loads already booked still arrive). Read: new shippers grouped by on_time on their FIRST load delivered (on or before ${RET_BIRTH_END.slice(0, 10)}); retained = any quote requested on or after day ${RET_FROM}. The knob ratio is ${1 - LATE_FIRST_CHURN}, but the read rests on about 250 late-first shippers, each of whose leave/stay is a coin flip (the ratio moves about ±0.05 between seeds), and carries a selection effect: a late load is less often the first to arrive when several loads move at once, so late-first shippers lean toward single-load shippers. The assertion uses the knob as target with a half-effect ceiling, so it grades STRONG when noise or selection pushes it past the ±10% band.`,
		mixpanelReport: { type: "Retention", birth: "load delivered (first time)", return: "quote requested", breakdown: "birth-event property on_time", brackets: `on or after day ${RET_FROM} (unbounded)`, cohort: "users with account created in the window", dateRange: `births to ${RET_BIRTH_END.slice(0, 10)}` },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H5_SQL },
				select: { l: { where: { grp: "late" } }, o: { where: { grp: "on_time" } } },
				expect: { metric: "l.retention / o.retention", op: "<=", target: 1 - LATE_FIRST_CHURN, floor: 1 - 0.5 * LATE_FIRST_CHURN },
				minCohort: 150,
			},
		],
	},
	{
		id: "H6-paid-channel-economics",
		hook: "H6",
		archetype: "external-join",
		narrative: `Google Ads is Routewise's cheapest paid channel per signup and its weakest at credit approval. Warehouse paid_marketing_daily: each day ${SPEND_PLAN_SHARE * 100}% of spend is a paced budget (cost per signup x expected signups per day, weekday shape above a ${SPEND_FLAT_SHARE * 100}% flat floor) and ${(1 - SPEND_PLAN_SHARE) * 100}% is bid x that day's delivered signups, with seeded ±${SPEND_NOISE * 100}% day noise: $${CPL_USD.google_ads} Google, $${CPL_USD.linkedin_ads} LinkedIn, $${CPL_USD.trade_media} trade media per Mixpanel signup over the window. Google signups are approved for credit (account created → credit approved within 7 days) at ${GOOGLE_APPROVAL_MULT}x the rate of every other channel (${Math.round(APPROVAL_CONV * GOOGLE_APPROVAL_MULT)}% vs ${APPROVAL_CONV}%; two declared first funnels with acquisition_channel conditions), so spend per approved shipper is level between Google and LinkedIn: (${CPL_USD.google_ads} / ${GOOGLE_APPROVAL_MULT}) / ${CPL_USD.linkedin_ads} = ${(CPL_USD.google_ads / GOOGLE_APPROVAL_MULT / CPL_USD.linkedin_ads).toFixed(2)}.`,
		mixpanelReport: { type: "Insights + Funnels + warehouse", event: "account created", breakdown: "acquisition_channel", join: "paid_marketing_daily.spend_usd", funnel: "account created → credit approved, 7-day window, breakdown acquisition_channel" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H6_SQL },
				select: { g: { where: { grp: "google_ads" } }, l: { where: { grp: "linkedin_ads" } } },
				expect: { metric: "g.spend_per_signup / l.spend_per_signup", op: "between", target: band(CPL_USD.google_ads / CPL_USD.linkedin_ads) },
				minCohort: 400,
			},
			{
				breakdown: { type: "duckdb", sql: H6_SQL },
				select: { g: { where: { grp: "google_ads" } }, o: { where: { grp: "not_google" } } },
				expect: { metric: "g.approval / o.approval", op: "between", target: band(Math.round(APPROVAL_CONV * GOOGLE_APPROVAL_MULT) / APPROVAL_CONV) },
				minCohort: 400,
			},
			{
				breakdown: { type: "duckdb", sql: H6_SQL },
				select: { g: { where: { grp: "google_ads" } }, l: { where: { grp: "linkedin_ads" } } },
				expect: { metric: "g.spend_per_approved / l.spend_per_approved", op: "between", target: band(Math.round(CPL_USD.google_ads / GOOGLE_APPROVAL_MULT / CPL_USD.linkedin_ads * 1000) / 1000) },
				minCohort: 400,
			},
		],
	},
	{
		id: "H7-hurricane-odessa",
		hook: "H7",
		archetype: "bespoke",
		narrative: `Hurricane Odessa reaches the Gulf Coast ${D(STORM_START)} to ${D(STORM_END)} (exclusive). Loads on a Gulf lane (origin or destination region ${STORM_REGIONS.join(" or ")}) that are picked up or due in the storm days, or in transit across them, arrive late with probability ${STORM_LATE_RATE} (delays of 20-72 h, delivery exception weather_delay); every other load is late with probability ${BASE_LATE_RATE}. Spot rates in warehouse spot_market_rates_daily jump in the storm week (flatbed +${STORM_RATE_BUMP.flatbed * 100}%, dry van +${STORM_RATE_BUMP.dry_van * 100}%) and fade over the following week. Read: late share of Gulf-lane loads picked up in the storm days vs all other loads; flatbed spot rate in the storm days vs the 14 days before.`,
		mixpanelReport: { type: "Funnels + warehouse", steps: ["pickup confirmed", "load delivered"], holdPropertyConstant: "shipment_id", dateRange: `${D(STORM_START)} to 2026-09-18`, breakdown: "origin_region / destination_region (step 1), on_time (step 2)", join: "spot_market_rates_daily.spot_rate_per_mile" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H7_SQL },
				select: { s: { where: { grp: "storm_gulf" } } },
				expect: { metric: "s.late_share", op: "between", target: band(STORM_LATE_RATE) },
				minCohort: 300,
			},
			{
				breakdown: { type: "duckdb", sql: H7_SQL },
				select: { o: { where: { grp: "everything_else" } } },
				expect: { metric: "o.late_share", op: "between", target: band(BASE_LATE_RATE) },
				minCohort: 2000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT 'flatbed' AS grp,
 avg(spot_rate_per_mile) FILTER (WHERE date::DATE >= DATE '${D(STORM_START)}' AND date::DATE < DATE '${D(STORM_END)}')
 / avg(spot_rate_per_mile) FILTER (WHERE date::DATE >= DATE '${STORM_PRE_FROM.slice(0, 10)}' AND date::DATE < DATE '${D(dayjs.utc(STORM_START).subtract(1, "day").toISOString())}') AS storm_ratio
FROM ${WH("spot_market_rates_daily")} WHERE equipment_type = 'flatbed'`,
				},
				select: { f: { where: { grp: "flatbed" } } },
				expect: { metric: "f.storm_ratio", op: "between", target: band(1 + STORM_RATE_BUMP.flatbed) },
			},
		],
	},
	{
		id: "H8-saved-lanes-threshold",
		hook: "H8",
		archetype: "cohort-count-scale",
		narrative: `New shippers who save at least ${LANE_THRESHOLD} lanes in their first ${LANE_SETUP_DAYS} days (the onboarding lane included) ship twice as much. Each new shipper's lane count is drawn independently of activity (0-7, ${LANE_COUNT_WEIGHTS[0] + LANE_COUNT_WEIGHTS[1] + LANE_COUNT_WEIGHTS[2]}% under ${LANE_THRESHOLD}); shippers under ${LANE_THRESHOLD} keep ${LOW_LANE_KEEP * 100}% of their quote sessions (quotes and the loads behind them). There is no extra gain past ${LANE_THRESHOLD}. New shippers save lanes only in their first ${LANE_SETUP_DAYS} days, so the profile property saved_lanes equals that count. Read: loads booked per credit-approved new shipper by saved_lanes: under ${LANE_THRESHOLD} vs ${LANE_THRESHOLD}+ (${LOW_LANE_KEEP}), and 5+ vs 3-4 (1.0, the plateau). Company tier drives volume (enterprise users ship several times what small businesses do) while lane counts are independent of tier, so both ratios are taken within each tier and weighted by the tier's share of approved new shippers; the pooled ratios carry the tier-mix noise of buckets of 600-1,400 shippers.`,
		mixpanelReport: { type: "Insights", events: ["load booked (total)", "credit approved (uniques)"], formula: "A / B", filter: "user property customer_since on or after 2026-06-04 (new shippers)", breakdown: "user property company_tier, then saved_lanes (buckets < 3, 3-4, 5+)" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H8_SQL },
				select: { a: { where: { grp: "threshold" } } },
				expect: { metric: "a.ratio", op: "between", target: band(LOW_LANE_KEEP) },
				minCohort: 800,
			},
			{
				breakdown: { type: "duckdb", sql: H8_SQL },
				select: { a: { where: { grp: "plateau" } } },
				// plateau: no extra effect past the threshold
				expect: { metric: "a.ratio", op: "between", target: band(1) },
				minCohort: 400,
			},
		],
	},
	{
		id: "H9-dock-appointments",
		hook: "H9",
		archetype: "cohort-prop-scale",
		narrative: `Loads booked with a dock appointment (load booked appointment_scheduled = true) are charged detention ${APPT_DETENTION_MULT}x as often: ${DETENTION_RATE * 100}% of loads without an appointment get a detention charge (accessorial charged, charge_type = detention) vs ${Math.round(DETENTION_RATE * APPT_DETENTION_MULT * 1000) / 10}% with one. Appointment use varies by tier (enterprise ${APPT_RATE.enterprise * 100}%, mid-market ${APPT_RATE.mid_market * 100}%, small business ${APPT_RATE.small_business * 100}%), but detention depends only on the appointment, so the ratio holds in every tier. Lumper fees (${LUMPER_RATE * 100}% of loads) do not depend on appointments (control). Read: per load booked through ${DETENTION_READ_END.slice(0, 10)}, share with a detention charge, appointment vs not.`,
		mixpanelReport: { type: "Funnels", steps: ["load booked", "accessorial charged (charge_type = detention)"], counting: "totals", holdPropertyConstant: "shipment_id", window: "30 days (dungeon default)", breakdown: "appointment_scheduled (step 1)" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H9_SQL },
				select: { a: { where: { grp: "appointment" } }, n: { where: { grp: "no_appointment" } } },
				expect: { metric: "a.detention_share / n.detention_share", op: "between", target: band(APPT_DETENTION_MULT) },
				minCohort: 2000,
			},
			{
				breakdown: { type: "duckdb", sql: H9_SQL },
				select: { a: { where: { grp: "appointment" } }, n: { where: { grp: "no_appointment" } } },
				// control: lumper fees do not depend on the appointment
				expect: { metric: "a.lumper_share / n.lumper_share", op: "between", target: band(1) },
				minCohort: 2000,
			},
		],
	},
];

export default config;
