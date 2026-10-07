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
 * NAME:       Keystead Homes
 * APP:        Home-search app and tech-enabled buyer brokerage in eight Sun
 *             Belt and Mountain metros (web, iOS, Android). Shoppers search
 *             MLS listings, save homes and searches, message their Keystead
 *             buyer agent, book tours (Tour It Now, same-day self-scheduled
 *             tours, launches 2026-07-15), get pre-approved with Keystead Home
 *             Loans, and make offers through their agent. Revenue: the buyer
 *             agent commission at closing plus mortgage origination.
 * SCALE:      10,000 shoppers (4,480 sign up inside the window; 9,747 have
 *             events), ~1.13M events, 120 days (2026-06-04 → 2026-10-01, UTC)
 * CORE LOOP:  home search → listing viewed → listing saved → tour requested →
 *             tour completed → offer submitted → offer accepted
 * VALUE MOMENT: tour completed (a shopper walks a home with a Keystead agent)
 *
 * EVENTS (18):
 *   listing viewed > listing alert sent > home search > 3d tour viewed
 *   > listing saved > agent contacted > agent responded > tour requested
 *   > tour completed > listing alert opened > $experiment_started
 *   > account created > pre-approval started > saved search created
 *   > pre-approval completed > offer submitted > offer rejected
 *   > offer accepted
 *
 * FUNNELS (engine, 3 declared; requireRepeats on all):
 *   - Signup (first funnel, new shoppers): home search → listing viewed →
 *       listing viewed → account created (100%; the steps before signup are
 *       anonymous, device_id only)
 *   - Browse session (weight 10): home search → listing viewed ×5 → 3d tour
 *       viewed (first-fixed, 65%). Carries the Payment Estimate experiment
 *       assignment (no engine multipliers; the hook applies the effect)
 *   - Revisit session (weight 5): listing viewed ×4 → 3d tour viewed (random)
 *   Every other event is strict and built per shopper in the everything hook
 *   from the shopper's own browsing (see DESIGN NOTES).
 *
 * USER PROPS:  home_market, buyer_type, budget_max_usd, acquisition_channel,
 *              member_since, preapproval_status (none / started / approved /
 *              expired), saved_search_count, "Experiment: Payment Estimate"
 *              (exposed shoppers only)
 * SUPER PROPS: none (market and listing facts ride on each listing event)
 * SCD PROPS:   none
 * GROUPS:      none
 * WAREHOUSE:   marketing_spend_daily (spend by paid channel),
 *              mortgage_rate_sheet_daily (Keystead Home Loans rate sheet and
 *              applications by loan type), market_inventory_daily (MLS feed
 *              inventory and listing-page traffic by market)
 * LOOKUPS:     none — listing attributes are denormalized onto every event
 * SOUP:        Sunday-heavy dayOfWeekWeights; US Central evening and lunch
 *              hourOfDayWeights expressed in UTC
 *
 * IDENTITY: a new shopper browses anonymously (device_id only) for a few
 * minutes, then creates an account ("account created", isAuthEvent, carries
 * user_id + device_id), which stitches the anonymous views. Two devices per
 * shopper on average (phone + laptop). Every later event carries user_id.
 * Client events also carry device_id; server-side events (agent responded,
 * tour completed, pre-approval completed, offer accepted / rejected, listing
 * alert sent) carry user_id only. Shoppers who joined before June 4 have no
 * anonymous events in the window. Every anonymous event links to a signup.
 * Visitors who never sign up are not in the dataset (the guides describe it
 * as an export of account holders).
 *
 * DESIGN NOTES:
 * - Listings: a seeded table of about 100k MLS listings (8 markets) built at
 *   module load from hashFloat. Each listing has a fixed id, type, beds,
 *   baths, sqft, list date, time on market, and maybe one 2-7% price cut. A
 *   view picks an active listing in the shopper's home market within ~15% of
 *   their budget (20% of views revisit a home the shopper already saw), and
 *   every event about a listing carries the same facts: list_price_usd,
 *   days_on_market, and price_reduced as of that moment. Shoppers in a market
 *   share the same inventory.
 * - Saves, agent chats, tours, offers, and outcomes are built per listing:
 *   a save is a decision on a view of an unsaved listing (H10); an agent chat
 *   gets a reply after response_minutes and may lead to a tour (H5); a saved
 *   listing the shopper has not discussed with the agent before booking may
 *   get a listing-page tour request (H2); the earliest request wins (one tour
 *   per listing per shopper); 80% of scheduled and 88% of Tour It Now tours
 *   complete in daytime; a completed tour may get an offer (H1, H3, H9),
 *   accepted (30%) or rejected 6-72 h later. booking_type and contact_method
 *   are hash-assigned per shopper and listing (stable across RNG changes).
 * - Shopper intent (realism): a per-shopper log-normal multiplier (sigma 1.5,
 *   capped at 8, mean 1) scales the save and agent-chat chances, independent
 *   of every story cohort. Most account holders rarely save or message an
 *   agent; about 45% of active shoppers complete a tour in the window, 56%
 *   message an agent, 16% make an offer.
 * - A shopper whose offer is accepted is under contract: tour requests stop,
 *   tours still scheduled are cancelled, and 85% of their browsing from two
 *   days later is gone. An offer already decided on an earlier tour still
 *   goes in (rarely a second acceptance, a backup offer).
 * - Pre-approval (Keystead Home Loans): only "serious" buyers apply (share by
 *   acquisition channel, H6). A letter is valid 90 days. 68% of established
 *   serious shoppers got one in the 150 days before June 4 (41% still valid
 *   on June 4, so the pre-approved share of tours is flat from week 1) and
 *   can renew once it lapses. Others become ready at a salted time (37% already on June 4, the
 *   rest at a steady pace; new shoppers at signup), then start an application
 *   on a browsing day with a 10% chance (x1.5 in the Payment Estimate variant
 *   after exposure, H8); 72% are approved about a day later (server-side) at
 *   the day's rate-sheet rate.
 * - Saved searches: new shoppers who adopt (salted, 45%) save a search in
 *   their first week (60% right after signup); 55% of established shoppers
 *   already have one. Holders get a digest "listing alert sent" on about 25%
 *   of days (server-side, also while they are inactive) until 30 days pass
 *   without a visit (alerts pause; a visit turns them back on). An alert is tapped
 *   through ("listing alert opened") only on a day the shopper browses (80% of
 *   alerts followed by a view within 12 h); the next view then has
 *   view_source = listing_alert.
 * - New shoppers: 40% stop browsing 3-27 days after signup whatever they do
 *   (realism; H4 adds its own churn for non-savers). Established shoppers who
 *   joined in the 4 weeks before June 4 (18.7%, the in-window signup pace)
 *   follow the same churn, saved-search, and readiness rules from their join
 *   date, so June has the recent-signup cohort a running business has.
 * - Warm start: established shoppers carry saves and agent chats from the 4
 *   weeks before June 4 (at their in-window rate), so tours, offers, and
 *   outcomes do not ramp from zero; only in-window events remain.
 * - Warehouse drift: marketing spend is half a paced budget, half bid x
 *   delivered signups, with day noise; rate-sheet applications add phone and
 *   branch applications Mixpanel never sees (0-28% by day); listing-page views
 *   add visitors who block analytics and crawler traffic from server logs.
 * - retentionCurve shapes new shoppers' activity; established shoppers'
 *   activity is flat across the window (DOW weights). Daily listing views grow
 *   about 16% from June to September as new-shopper cohorts accumulate.
 * - Engine device fields (os, model, browser) come from the engine's sticky
 *   per-device pools; session_id is diagnostic and sits only on events sent
 *   from a device (server-side events drop it with the other device fields).
 */

// ── HOOK STORIES ──
/*
 * All effects are hidden: no flag properties. Dates live in the TIMELINE
 * constants and are shared by hooks, stories, SQL, warehouse columns, and the
 * timeline guide.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H1. MORTGAGE RATE SPIKE COOLS OFFERS (everything + warehouse
 *     mortgage_rate_sheet_daily; external-table join)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: the 30-year conventional rate on the Keystead Home Loans rate sheet
 *   sits near 6.30% until 2026-08-10, climbs to 7.00% by 2026-08-17, holds
 *   through 2026-09-13, then eases to 6.60% by 2026-09-28. The chance that a
 *   completed tour gets an offer is multiplied by 1 - 0.4286 x (rate - 6.30),
 *   so 0.70x on plateau days. Touring itself does not change.
 * MIXPANEL: Funnels, tour completed → offer submitted, Totals counting, hold
 *   listing_id constant, 14-day window, breakdown buyer_preapproved, daily;
 *   join the warehouse rate by day (high-rate days: conventional
 *   note_rate_pct ≥ 6.95; baseline: below 6.40, before Aug 10).
 * REAL WORLD: a 70 bp jump in mortgage rates prices buyers out of the homes
 *   they just toured.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H2. TOUR IT NOW LAUNCH (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: Tour It Now (book a same-day tour from the listing page) launches
 *   2026-07-15 and ramps over 7 days. Listing-page tour requests per saved
 *   listing rise 1.5x; 55% of listing-page requests after the ramp have
 *   booking_type = tour_it_now (none before launch).
 * MIXPANEL: Insights, tour requested (request_source = listing_page) / listing
 *   saved, weekly; Jun 4-Jul 14 vs from Jul 22.
 * REAL WORLD: removing scheduling friction turns saved homes into showings.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H3. PRE-APPROVED BUYERS MAKE OFFERS (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: a completed tour by a shopper holding a valid Keystead Home Loans
 *   pre-approval (tour completed buyer_preapproved = true) gets an offer 2.5x
 *   as often (35% vs 14% before the rate move).
 * MIXPANEL: Funnels, tour completed → offer submitted, Totals, hold listing_id
 *   constant, 14-day window, breakdown buyer_preapproved (tours before Aug 10).
 * REAL WORLD: a pre-approval letter is what lets a buyer act on a home.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H4. SAVED SEARCH IN WEEK ONE KEEPS SHOPPERS (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 45% of new shoppers save a search in their first 7 days (salted,
 *   independent of activity). Half of the others stop browsing for good 8-27
 *   days after signup.
 * MIXPANEL: Retention, birth account created (Jun 4-Aug 6), return listing
 *   viewed, custom bracket day 28-55, breakdown user property
 *   saved_search_count > 0 (for new shoppers it matches exactly the shoppers
 *   with a saved search in week one), or a cohort saved from the converters of
 *   the Funnel account created → saved search created (7-day window).
 * REAL WORLD: a saved search turns a one-time browse into a standing habit.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H5. SPEED TO LEAD (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: the chance an agent chat turns into a tour request for that
 *   listing falls smoothly (logistic in log minutes, centered at 20 min) with
 *   the agent's response_minutes. Averaged over the response-time
 *   distribution, replies within 10 minutes lead to a tour 42% of the time vs
 *   16.8% after 60 minutes (0.4x), for serious buyers.
 * MIXPANEL: Funnels, agent responded → tour requested, Totals, hold listing_id
 *   constant, 7-day window, breakdown response_minutes (≤ 10, 10-60, > 60).
 * REAL WORLD: a lead answered in minutes is a showing; in hours it is a lead
 *   for another brokerage.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H6. PAID SOCIAL IS CHEAP LEADS, NOT CHEAP BUYERS (warehouse
 *     marketing_spend_daily + everything; external-table join)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: spend per Mixpanel signup is $38 paid search, $15 paid social, $24
 *   YouTube (half paced budget, half bid x delivered signups). Paid social
 *   signups are serious buyers 0.4x as often (24% vs 60%), so they start a
 *   pre-approval within 30 days 0.4x as often, and spend per pre-approval
 *   start is level with paid search ((15 / 0.4) / 38 = 0.99).
 * MIXPANEL: Insights, account created by acquisition_channel joined to
 *   marketing_spend_daily.spend_usd; Funnels, account created → pre-approval
 *   started, 30-day window, breakdown acquisition_channel.
 * REAL WORLD: social ads reach dreamers; search ads reach people who are
 *   moving.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H7. AUSTIN MLS FEED OUTAGE (everything + warehouse market_inventory_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: Monday 2026-08-24 to Sunday 2026-08-30 the Austin MLS feed is
 *   stale: no new Austin listings arrive (they appear on Aug 31), Austin
 *   saved-search alerts stop, and 55% of Austin listing views do not happen.
 *   The warehouse shows feed_status = stale and new_listings = 0 for Austin.
 * MIXPANEL: Insights, listing viewed by market, daily; Austin vs other markets
 *   on stale days vs 14 days either side; join market_inventory_daily.
 * REAL WORLD: a stale feed looks like "Austin buyers lost interest".
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H8. PAYMENT ESTIMATE EXPERIMENT (Browse funnel experiment + everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-07-29, shoppers without a current pre-approval who have
 *   not applied in the window are split 50/50 at their first listing view
 *   ($experiment_started). The variant shows a monthly payment estimate on
 *   listing pages: the daily chance of starting a pre-approval is 1.5x after
 *   exposure; 45% of variant starts have entry_point = payment_estimate
 *   (never in Control).
 * MIXPANEL: Funnels, $experiment_started → pre-approval started, 14-day
 *   window, breakdown "Experiment: Payment Estimate" (or the Experiments
 *   report).
 * REAL WORLD: showing the monthly cost next to the price nudges financing.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H9. TIME TO OFFER BY BUYER TYPE (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: the gap from tour completed to offer submitted (median 48 hours
 *   for move-up buyers, log-normal) is 1.75x for first-time buyers and 0.5x
 *   for investors.
 * MIXPANEL: Funnels, tour completed → offer submitted, Totals, hold listing_id
 *   constant, 14-day window, median time to convert, breakdown buyer_type.
 * REAL WORLD: first-time buyers sleep on it; investors run the numbers and bid.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H10. PRICE CUTS GET SAVED (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: a view of a listing with price_reduced = true becomes a save 1.8x
 *   as often as a view of a listing at its original price.
 * MIXPANEL: Insights, listing saved / listing viewed, breakdown price_reduced.
 * REAL WORLD: a price cut tells buyers the seller will deal.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * EXPECTED METRICS SUMMARY (measured: data/verify-real-estate, 2026-10-07, full
 * fidelity, 10,000 shoppers, 1,130,420 events)
 * ═════════════════════════════════════════════════════════════════════════
 * Hook | Metric                                           | Derivation                 | Expected | Measured
 * -----|--------------------------------------------------|----------------------------|----------|---------
 * H1   | offers per completed tour, high-rate / base days | RATE_PEAK_OFFER_KEEP       | 0.70     | 0.759 (std; 18.1% → 14.0% raw)
 * H1   | listing-page tours per save, high / base (control)| unchanged                 | 1.00     | 1.036 (0.239 vs 0.230)
 * H2   | listing-page tour requests per save, after/before| TIN_LIFT                   | 1.50     | 1.551 (0.154 → 0.238)
 * H2   | tour_it_now requests before launch               | exact purity               | 0        | 0 (55% of listing-page requests after)
 * H3   | offer rate per tour, pre-approved / not          | PREAPPROVED_OFFER_MULT     | 2.50     | 2.521 (30.3% vs 12.0%, band-std)
 * H4   | D28-55 retention, non-savers / savers            | 1 - NON_SAVER_CHURN        | 0.50     | 0.466 (26.6% vs 57.2%)
 * H5   | tour within 7 d per reply, > 60 min / ≤ 10 min   | LEAD_RATE_SLOW / FAST      | 0.40     | 0.399 (12.0% vs 29.9%)
 * H6   | spend per signup, paid social / paid search      | 15 / 38                    | 0.395    | 0.384 ($14.86 vs $38.69)
 * H6   | pre-approval start in 30 d, social / other       | SOCIAL_SERIOUS_MULT (≤, floor 0.7) | 0.40 | 0.377 (7.4% vs 19.7%)
 * H6   | spend per pre-approval start, social / search    | (15 / 0.4) / 38 (≥, floor 0.691) | 0.987 | 0.927 ($200 vs $216)
 * H7   | Austin / other views, stale days / ±14 d         | 1 - OUTAGE_VIEW_DROP       | 0.45     | 0.463 (0.079 vs 0.171)
 * H7   | new Austin listings + Austin alerts while stale  | exact purity               | 0        | 0
 * H8   | pre-approval start in 14 d, variant / Control    | PAYMENT_EST_MULT (≥, floor 1.25) | 1.50 | 1.514 (13.4% vs 8.9%)
 * H8   | variant share of exposed shoppers                | equal 2-arm hash           | 0.50     | 0.507
 * H8   | payment_estimate starts in Control or pre-test   | exact purity               | 0        | 0
 * H9   | median tour → offer hours, first_time / move_up  | BUYER_TTC_MULT.first_time  | 1.75     | 1.813 (87.5 h vs 48.3 h)
 * H9   | median tour → offer hours, investor / move_up    | BUYER_TTC_MULT.investor    | 0.50     | 0.490 (23.6 h)
 * H10  | saves per view, price_reduced / original         | REDUCED_SAVE_MULT          | 1.80     | 1.764 (12.2% vs 6.9%)
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Noise notes: H6 rests on about 245 serious paid-social signups, so its
 * start-rate and spend-per-start reads use the knob as target with a
 * half-effect bound. H8 reads a cumulative 14-day start share from a daily
 * hazard multiplier, so it saturates a little under the knob (knob target,
 * half-effect floor); about 290 Control starts. H1 compares about 520 offers
 * on high-rate days with 1,170 on baseline days (SE of the ratio about 0.04).
 * H9's investor arm has about 440 offers (relative SE of the median ratio
 * about 5%). H3 is read inside rate bands because H1 scales both groups on
 * any given day and the pre-approved share drifts. Not engineered (null
 * checks in the SQL): Tour It Now vs scheduled tours make offers at the same
 * rate (15.3% vs 15.5%, z = -0.2; buyer_type sub-splits |z| ≤ 0.6; one of 8
 * markets, Denver, reaches z = 2.0, which is chance across 11 sub-splits;
 * agent chats and saves share the same intent multiplier and do not depend
 * on how serious the shopper is, so agent-chat tours, all scheduled, carry the
 * same buyer mix), and contact_method does not change tour conversion
 * (chi2 = 2.2 on 2 df, p = 0.33; largest market chi2 4.3, p = 0.12; 7-day window).
 */

// ── SCALE ──
const SEED = "homenest";
const NUM_USERS = 10_000;
const DATASET_START = "2026-06-04T00:00:00Z";
const DATASET_END = "2026-10-01T23:59:59Z"; // 120 days
const EVENTS_PER_DAY = 1.2;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── TIMELINE (shared by hooks, stories, SQL, warehouse columns, guides) ──
const TOUR_IT_NOW_LAUNCH = "2026-07-15T00:00:00Z";  // Tour It Now (same-day self-scheduled tours) launches
const PAYMENT_EST_START = "2026-07-29T00:00:00Z";   // "Payment Estimate" A/B test starts on listing pages
const RATE_RAMP_START = "2026-08-10T00:00:00Z";     // 30-yr conventional rate starts climbing
const RATE_PLATEAU_START = "2026-08-17T00:00:00Z";  // rate reaches its high
const RATE_PLATEAU_END = "2026-09-14T00:00:00Z";    // exclusive: rate starts easing
const RATE_EASE_END = "2026-09-28T00:00:00Z";       // rate settles
const FEED_OUTAGE_START = "2026-08-24T00:00:00Z";   // Austin MLS feed goes stale
const FEED_OUTAGE_END = "2026-08-31T00:00:00Z";     // exclusive (7 days: Mon Aug 24 - Sun Aug 30)
const OUTAGE_MARKET = "Austin";

const ms = (iso) => Date.parse(iso);
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;
const BEGIN = ms(DATASET_START);
const END = ms(DATASET_END);
const WINDOW_DAYS = 120;

// ── WEEKLY AND DAILY RHYTHM (soup) ──
// Sun..Sat. Home shoppers browse most on Sunday (and Saturday, open-house day);
// Friday night is the quietest.
const DOW_WEIGHTS = [1.3, 1.0, 0.92, 0.92, 0.92, 0.82, 1.12];
// Local (US Central-ish) browsing: morning commute, lunch, and a 7-10 pm peak.
const LOCAL_HOUR_WEIGHTS = [0.35, 0.2, 0.12, 0.08, 0.08, 0.12, 0.3, 0.5, 0.6, 0.65, 0.7, 0.75,
	0.85, 0.8, 0.75, 0.75, 0.8, 0.85, 0.95, 1.0, 1.0, 0.9, 0.7, 0.5];
const UTC_OFFSET_H = 5; // CDT
const HOUR_WEIGHTS = Array.from({ length: 24 }, (_, h) => LOCAL_HOUR_WEIGHTS[(h - UTC_OFFSET_H + 24) % 24]);

// ── KNOBS ──
// H1 mortgage rate spike (warehouse mortgage_rate_sheet_daily)
const BASE_RATE = 6.3;              // 30-yr conventional before the spike
const PEAK_RATE = 7.0;              // plateau Aug 17 - Sep 13
const SETTLE_RATE = 6.6;            // from Sep 28
const RATE_PEAK_OFFER_KEEP = 0.7;   // offer chance per completed tour at the peak rate, vs base
const OFFER_RATE_SENSITIVITY = (1 - RATE_PEAK_OFFER_KEEP) / (PEAK_RATE - BASE_RATE); // per rate point
const LOAN_SPREAD = { conventional: 0, fha: -0.3, va: -0.4, jumbo: 0.15 };

// H2 Tour It Now
const TOUR_PER_SAVE = 0.25;        // listing-page tour request per saved listing (serious shoppers)
const TIN_LIFT = 1.5;               // listing-page tour requests per save after the ramp
const TIN_RAMP_DAYS = 7;
const TIN_SHARE = 0.55;             // share of listing-page requests booked as tour_it_now after the ramp

// H3 offers per completed tour
const OFFER_BASE = 0.14;            // no Keystead pre-approval
const PREAPPROVED_OFFER_MULT = 2.5; // with a pre-approval
const ACCEPT_RATE = 0.3;            // offers accepted (the rest are rejected)
const UNDER_CONTRACT_BROWSE_DROP = 0.85;

// H4 saved search in week one
const SAVED_SEARCH_ADOPT = 0.45;    // new shoppers who save a search in their first 7 days
const NON_SAVER_CHURN = 0.5;        // share of the others who go quiet for good
const CHURN_DAY_MIN = 8;
const CHURN_DAY_MAX = 27;
const NEW_SHOPPER_CHURN = 0.4;      // realism (not a story): new shoppers who stop browsing 3-27 days after signup, whatever they do
const NEW_CHURN_DAY_MIN = 3;
const ESTABLISHED_SEARCH_HOLDERS = 0.55;
const ALERT_DAY_P = 0.25;           // share of days a holder gets a digest alert (days with new matches)
const ALERT_OPEN_ON_ACTIVE = 0.8;   // alerts on a browsing day that the shopper taps through before the next view

// H5 speed to lead: tour chance per agent chat by response time (logistic in
// log minutes). LEAD_RATE_FAST / LEAD_RATE_SLOW are the average rates of chats
// answered within FAST_REPLY_MIN / after SLOW_REPLY_MIN (the knob, ratio 0.4);
// the plateaus are solved from the response-time distribution.
const CONTACT_RATE = 0.045;         // agent chats per view of an unchatted listing
const RESPONSE_MEDIAN_MIN = 20;
const RESPONSE_SIGMA = 1.3;
const RESPONSE_MAX_MIN = 36 * 60;
const FAST_REPLY_MIN = 10;
const SLOW_REPLY_MIN = 60;
const LEAD_RATE_FAST = 0.42;
const LEAD_RATE_SLOW = 0.168;
const LEAD_CENTER_MIN = 20;
const LEAD_SOFTNESS = 0.6;          // logistic scale in ln(minutes)
const leadShape = (m) => 1 / (1 + Math.exp((Math.log(m) - Math.log(LEAD_CENTER_MIN)) / LEAD_SOFTNESS));
const [LEAD_RATE_EARLY, LEAD_RATE_LATE] = (() => {
	let nF = 0, sF = 0, nS = 0, sS = 0;
	const N = 4000;
	for (let i = 0; i < N; i++) {
		const z = -6 + 12 * (i + 0.5) / N;
		const w = Math.exp(-z * z / 2);
		const m = Math.max(1, Math.min(RESPONSE_MAX_MIN, RESPONSE_MEDIAN_MIN * Math.exp(RESPONSE_SIGMA * z)));
		if (m <= FAST_REPLY_MIN) { nF += w; sF += w * leadShape(m); } else if (m > SLOW_REPLY_MIN) { nS += w; sS += w * leadShape(m); }
	}
	const span = (LEAD_RATE_FAST - LEAD_RATE_SLOW) / (sF / nF - sS / nS);
	const late = LEAD_RATE_SLOW - span * (sS / nS);
	return [late + span, late];
})();
const leadRate = (m) => LEAD_RATE_LATE + (LEAD_RATE_EARLY - LEAD_RATE_LATE) * leadShape(m);

// H6 paid channels (warehouse marketing_spend_daily) + serious-buyer share
const PAID_CHANNELS = ["paid_search", "paid_social", "youtube_ads"];
const CPS_USD = { paid_search: 38, paid_social: 15, youtube_ads: 24 }; // window spend per Mixpanel signup
const CHANNEL_WEIGHTS = { organic: 26, referral: 10, paid_search: 22, paid_social: 30, youtube_ads: 12 };
const SERIOUS_BASE = 0.6;
const SOCIAL_SERIOUS_MULT = 0.4;
const SERIOUS_SHARE = { organic: SERIOUS_BASE, referral: SERIOUS_BASE, paid_search: SERIOUS_BASE, youtube_ads: SERIOUS_BASE, paid_social: SERIOUS_BASE * SOCIAL_SERIOUS_MULT };
const NONSERIOUS_TOUR_MULT = 0.5;   // shoppers who are not serious buyers tour half as often
const BORN_PCT = 45;
const DAILY_BUDGET_USD = Object.fromEntries(PAID_CHANNELS.map((ch) => {
	const totalW = Object.values(CHANNEL_WEIGHTS).reduce((a, b) => a + b, 0);
	return [ch, CPS_USD[ch] * (NUM_USERS * BORN_PCT / 100) * (CHANNEL_WEIGHTS[ch] / totalW) / WINDOW_DAYS];
}));
const SPEND_FLAT_SHARE = 0.4;
const SPEND_WEEKDAY = (() => {
	const m = DOW_WEIGHTS.reduce((a, b) => a + b, 0) / DOW_WEIGHTS.length;
	return DOW_WEIGHTS.map((w) => SPEND_FLAT_SHARE + (1 - SPEND_FLAT_SHARE) * w / m);
})();
const SPEND_NOISE = 0.12;
const SPEND_PLAN_SHARE = 0.5;
const PLATFORM_LEAD_INFLATION = 1.2; // ad platforms claim more leads than Mixpanel signups
const CPC_USD = { paid_search: 4.2, paid_social: 1.3, youtube_ads: 0.9 };
const CTR = { paid_search: 0.045, paid_social: 0.009, youtube_ads: 0.004 };

// H7 Austin MLS feed outage (warehouse market_inventory_daily)
const OUTAGE_VIEW_DROP = 0.55;
const UNTRACKED_VIEW_SHARE = 0.15;  // listing-page views in server logs from visitors who block analytics (mean; 0-30% by day)
const CRAWLER_VIEWS_PER_DAY = 1500; // crawler and bot page views per day across markets (by market share, log-normal day noise)

// H8 Payment Estimate experiment (pre-approval)
const EXPERIMENT_NAME = "Payment Estimate";
const EXPERIMENT_VARIANT = "Payment Estimate";
const EXP_KEY = `Experiment: ${EXPERIMENT_NAME}`;
const PREAPP_DAILY_RATE = 0.1;      // chance a ready serious shopper starts an application on a browsing day
const PAYMENT_EST_MULT = 1.5;       // variant multiplier on that daily chance after exposure
const PAYMENT_EST_ENTRY_SHARE = 0.45;
const PREAPP_COMPLETE = 0.72;
const PRIOR_APPROVAL_SHARE = 0.68;   // established serious shoppers with a pre-approval issued in the 150 days before June 4
const PRIOR_APPROVAL_SPAN_DAYS = 150; // (so 0.68 x 90/150 = 41% hold a valid letter on June 4; the rest of them can renew)
const PREAPPROVAL_VALID_DAYS = 90;  // a pre-approval letter lapses after 90 days
const READY_AT_START = 0.37;        // established shoppers already in the market on June 4; the rest become ready at a steady pace through the window

// H9 time to offer by buyer type
const OFFER_GAP_MEDIAN_H = 48;
const OFFER_GAP_SIGMA = 0.5;
const BUYER_TTC_MULT = { move_up: 1, first_time: 1.75, investor: 0.5 };

// H10 price cuts get saved
const SAVE_BASE = 0.08;
const REDUCED_SAVE_MULT = 1.8;
const REVISIT_SHARE = 0.2;
const PRE_SIGNUP_EXTRA_VIEWS = { 0: 45, 1: 20, 2: 15, 3: 10, 4: 6, 6: 4 }; // extra anonymous views before signup (weights)

// shopper intent (realism, not a story): most account holders are early-stage
// and rarely save or message an agent; a minority does most of it. Per-shopper
// log-normal multiplier on the save and agent-chat chances (mean 1, capped),
// independent of every story cohort, so per-view, per-save, per-reply and
// per-tour rates are unchanged.
const INTENT_SIGMA = 1.5;
const INTENT_CAP = 8;
const INTENT_NORM = (() => {
	let n = 0, s = 0;
	const N = 4000;
	for (let i = 0; i < N; i++) {
		const z = -6 + 12 * (i + 0.5) / N;
		const w = Math.exp(-z * z / 2);
		n += w; s += w * Math.min(INTENT_CAP, Math.exp(INTENT_SIGMA * z));
	}
	return s / n;
})();
const shopperIntent = (uid) => Math.min(INTENT_CAP, Math.exp(INTENT_SIGMA * hashNormal(`${uid}|intent`))) / INTENT_NORM;

// listing alerts pause after a holder has not visited for this many days
// (Keystead's alert policy); a visit turns them back on
const ALERT_PAUSE_DAYS = 30;

// warm start
const PREWINDOW_DAYS = 28;
// established shoppers who joined in the 4 weeks before June 4 behave like new
// shoppers (same churn and readiness, relative to their join date): about the
// in-window signup pace x 28 days
const RECENT_JOINER_SHARE = 0.187;

// ── DATA ──
const MARKETS = {
	Dallas: { code: "DAL", share: 17, median: 420000, newPerDay: 62 },
	Austin: { code: "AUS", share: 14, median: 525000, newPerDay: 50 },
	Phoenix: { code: "PHX", share: 14, median: 450000, newPerDay: 52 },
	Denver: { code: "DEN", share: 12, median: 590000, newPerDay: 40 },
	Nashville: { code: "NSH", share: 11, median: 480000, newPerDay: 36 },
	Charlotte: { code: "CLT", share: 11, median: 410000, newPerDay: 38 },
	Tampa: { code: "TPA", share: 11, median: 400000, newPerDay: 40 },
	Raleigh: { code: "RAL", share: 10, median: 445000, newPerDay: 32 },
};
const MARKET_NAMES = Object.keys(MARKETS);
const BUYER_TYPE_WEIGHTS = { first_time: 40, move_up: 36, investor: 24 };
const BUYER_BUDGET_MULT = { first_time: 0.85, move_up: 1.35, investor: 0.75 };
const AGENTS_PER_MARKET = 24;
const LIST_DOW = [0.45, 0.95, 1.05, 1.1, 1.25, 1.2, 0.6]; // listings go live mostly Thu-Fri
const LISTING_LOOKBACK_DAYS = 200;   // listings listed up to 200 days before June 4 can still be active
const MAX_ACTIVE_DAYS = 120;

// ── HELPERS ──
const salt = (uid, tag) => hashFloat(`${uid}|${tag}`);
const round2 = (n) => Math.round(n * 100) / 100;
const T = (e) => Date.parse(e.time);
const iso = (t) => new Date(t).toISOString();
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const dayStart = (t) => Math.floor(t / DAY_MS) * DAY_MS;
const byT = (a, b) => T(a) - T(b);
const jitter = (key, spread) => 1 + (hashFloat(key) - 0.5) * 2 * spread;
const hashNormal = (key) => {
	const a = Math.max(1e-9, hashFloat(`${key}|n1`));
	const b = hashFloat(`${key}|n2`);
	return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
};
const logNormal = (median, sigma) => median * Math.exp(chance.normal({ mean: 0, dev: sigma }));
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
const weighted = (obj) => Object.entries(obj).flatMap(([k, w]) => Array(w).fill(k));
const inOutage = (t) => t >= ms(FEED_OUTAGE_START) && t < ms(FEED_OUTAGE_END);
const tinRamp = (t) => Math.max(0, Math.min(1, (t - ms(TOUR_IT_NOW_LAUNCH)) / (TIN_RAMP_DAYS * DAY_MS)));

// 30-yr conventional rate by day (Keystead Home Loans rate sheet)
function conventionalRate(t) {
	const d = dayStart(t);
	const k = dayKey(d);
	const r0 = ms(RATE_RAMP_START), r1 = ms(RATE_PLATEAU_START), r2 = ms(RATE_PLATEAU_END), r3 = ms(RATE_EASE_END);
	let base;
	if (d < r0) base = BASE_RATE + (hashFloat(`rate|${k}`) - 0.5) * 0.12;
	else if (d < r1) base = BASE_RATE + (PEAK_RATE - BASE_RATE) * ((d - r0) / (r1 - r0) + 1 / 7);
	else if (d < r2) base = PEAK_RATE + (hashFloat(`rate|${k}`) - 0.5) * 0.06;
	else if (d < r3) base = PEAK_RATE - (PEAK_RATE - SETTLE_RATE) * ((d - r2) / (r3 - r2) + 1 / 14);
	else base = SETTLE_RATE + (hashFloat(`rate|${k}`) - 0.5) * 0.06;
	return Math.round(Math.min(base, PEAK_RATE + 0.03) * 1000) / 1000;
}
const loanRate = (loanType, t) => Math.round((conventionalRate(t) + (LOAN_SPREAD[loanType] ?? 0)) * 1000) / 1000;
const offerKeep = (t) => 1 - OFFER_RATE_SENSITIVITY * Math.max(0, conventionalRate(t) - BASE_RATE);

// ── LISTINGS (seeded MLS table, built once) ──
const LISTINGS = (() => {
	const out = {};
	const first = dayStart(BEGIN) - LISTING_LOOKBACK_DAYS * DAY_MS;
	const nDays = LISTING_LOOKBACK_DAYS + WINDOW_DAYS;
	for (const [market, m] of Object.entries(MARKETS)) {
		const arr = [];
		let idx = 0;
		for (let d = 0; d < nDays; d++) {
			const ds = first + d * DAY_MS;
			const n = Math.round(m.newPerDay * LIST_DOW[new Date(ds).getUTCDay()] * jitter(`new|${market}|${d}`, 0.3));
			for (let k = 0; k < n; k++) {
				const id = `${m.code}-${100000 + idx++}`;
				const h = (tag) => hashFloat(`${id}|${tag}`);
				const listT = ds + Math.floor((13 + h("hr") * 10) * HOUR_MS);
				const type = h("type") < 0.62 ? "single_family" : h("type") < 0.82 ? "townhome" : "condo";
				const beds = type === "condo" ? 1 + Math.floor(h("beds") * 3) : 2 + Math.floor(h("beds") * (type === "townhome" ? 3 : 4));
				const baths = Math.max(1, Math.min(beds, Math.round((beds * 0.75 + h("baths") * 1.2) * 2) / 2));
				const sqft = Math.round((450 + beds * 520) * (0.8 + h("sqft") * 0.5) / 10) * 10;
				const typeMult = type === "condo" ? 0.7 : type === "townhome" ? 0.85 : 1.05;
				const price = Math.max(120000, Math.round(m.median * typeMult * (0.75 + beds * 0.08) * Math.exp(0.28 * hashNormal(`${id}|p`)) / 5000) * 5000);
				const activeDays = Math.max(3, Math.min(MAX_ACTIVE_DAYS, 38 * Math.exp(0.6 * hashNormal(`${id}|a`))));
				const offT = listT + activeDays * DAY_MS;
				let reducedAt = Infinity, cutPrice = price;
				if (h("red") < 0.38) {
					const rd = 14 + h("redday") * 40;
					if (rd < activeDays) {
						reducedAt = listT + rd * DAY_MS;
						cutPrice = Math.round(price * (1 - (0.02 + h("cut") * 0.05)) / 1000) * 1000;
					}
				}
				const visibleT = market === OUTAGE_MARKET && inOutage(listT) ? ms(FEED_OUTAGE_END) + Math.floor(h("catch") * 6 * HOUR_MS) : listT;
				const sold = h("sold") < 0.82;
				arr.push({ id, market, listT, visibleT, offT, type, beds, baths, sqft, price, reducedAt, cutPrice, sold });
			}
		}
		arr.sort((a, b) => a.listT - b.listT);
		out[market] = arr;
	}
	return out;
})();

const lowerBound = (arr, t) => {
	let lo = 0, hi = arr.length;
	while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid].listT < t) lo = mid + 1; else hi = mid; }
	return lo;
};
const isActive = (L, t) => L.visibleT <= t && t < L.offT;
const listPrice = (L, t) => (t >= L.reducedAt ? L.cutPrice : L.price);
function sampleListing(market, t, budget) {
	const arr = LISTINGS[market];
	const lo = lowerBound(arr, t - MAX_ACTIVE_DAYS * DAY_MS);
	const hi = lowerBound(arr, t);
	if (hi <= lo) return null;
	let fallback = null;
	for (let i = 0; i < 40; i++) {
		const L = arr[chance.integer({ min: lo, max: hi - 1 })];
		if (!isActive(L, t)) continue;
		if (!fallback) fallback = L;
		if (i < 16 && listPrice(L, t) > budget * 1.15) continue;
		return L;
	}
	return fallback;
}
const listingFacts = (L, t) => ({
	listing_id: L.id,
	market: L.market,
	list_price_usd: listPrice(L, t),
	property_type: L.type,
	beds: L.beds,
	days_on_market: Math.max(0, Math.floor((t - L.listT) / DAY_MS)),
	price_reduced: t >= L.reducedAt,
});

// daily inventory facts per market for the warehouse (UTC days in the window)
const INVENTORY = (() => {
	const out = {};
	for (const market of MARKET_NAMES) {
		const arr = LISTINGS[market];
		const rows = {};
		for (let d = 0; d < WINDOW_DAYS; d++) {
			const ds = dayStart(BEGIN) + d * DAY_MS;
			rows[dayKey(ds)] = { new_listings: 0, price_reductions: 0, closed_sales: 0, active: 0, prices: [] };
		}
		for (const L of arr) {
			const kv = dayKey(L.visibleT); if (rows[kv]) rows[kv].new_listings++;
			if (L.reducedAt !== Infinity) { const kr = dayKey(L.reducedAt); if (rows[kr]) rows[kr].price_reductions++; }
			if (L.sold) { const ko = dayKey(L.offT); if (rows[ko]) rows[ko].closed_sales++; }
		}
		for (const k of Object.keys(rows)) {
			const t = ms(`${k}T12:00:00Z`);
			const lo = lowerBound(arr, t - MAX_ACTIVE_DAYS * DAY_MS), hi = lowerBound(arr, t);
			for (let i = lo; i < hi; i++) {
				const L = arr[i];
				if (isActive(L, t)) { rows[k].active++; rows[k].prices.push(listPrice(L, t)); }
			}
			const p = rows[k].prices.sort((a, b) => a - b);
			rows[k].median_price = p.length ? p[Math.floor(p.length / 2)] : 0;
			delete rows[k].prices;
		}
		out[market] = rows;
	}
	return out;
})();

// declared properties per event (used to re-shape a cloned event into another event)
const EVENT_PROPS = {};
const DEVICE_KEYS = ["device_id", "session_id", "os", "model", "screen_height", "screen_width", "carrier", "radio", "wifi", "browser", "browser_version", "$os", "$model", "$browser", "$device", "manufacturer", "platform", "app_version"];

/** Clone a shopper's own event into another event (fresh insert_id) and set its props. */
function makeEvent(src, name, t, props, server = false) {
	const ev = cloneEvent(src, { event: name, time: iso(t) });
	for (const k of EVENT_PROPS[src.event] || []) delete ev[k];
	ev.event = name;
	Object.assign(ev, props);
	if (server) for (const k of DEVICE_KEYS) delete ev[k];
	return ev;
}

// local daytime for tours (14:00-22:59 UTC = 9 am - 6 pm Central)
function snapDaytime(t) {
	const h = new Date(t).getUTCHours();
	if (h >= 14 && h <= 22) return t;
	const d = dayStart(t) + (h > 22 ? DAY_MS : 0);
	return d + Math.floor((14 + chance.floating({ min: 0, max: 8.99 })) * HOUR_MS) + chance.integer({ min: 0, max: 3599 }) * 1000;
}

// join time of an established shopper who joined in the 4 weeks before June 4 (else null)
const recentJoinT = (uid) => (salt(uid, "recent") < RECENT_JOINER_SHARE ? BEGIN - Math.floor(salt(uid, "recent-age") * PREWINDOW_DAYS * DAY_MS) : null);

function handleUserHook(profile, meta) {
	const uid = profile.distinct_id;
	const bt = profile.buyer_type;
	const m = MARKETS[profile.home_market] || MARKETS.Dallas;
	profile.budget_max_usd = Math.round(m.median * (BUYER_BUDGET_MULT[bt] ?? 1) * Math.exp(0.25 * hashNormal(`${uid}|budget`)) / 10000) * 10000;
	if (meta.userIsBornInDataset) {
		profile.member_since = dayKey(Date.parse(profile.created ?? meta.user?.created ?? DATASET_START));
	} else {
		const recent = recentJoinT(uid);
		const span = (BEGIN - PREWINDOW_DAYS * DAY_MS - ms("2024-03-01T00:00:00Z")) / DAY_MS;
		profile.member_since = recent !== null ? dayKey(recent) : dayKey(ms("2024-03-01T00:00:00Z") + Math.floor(salt(uid, "tenure") * span) * DAY_MS);
	}
	profile.preapproval_status = "none";
	profile.saved_search_count = 0;
	return profile;
}

function handleEverything(input, meta) {
	if (!input.length) return input;
	const profile = meta.profile;
	const uid = profile.distinct_id;
	const born = Boolean(meta.userIsBornInDataset);
	const market = profile.home_market;
	const budget = profile.budget_max_usd;
	const btype = profile.buyer_type;
	const channel = profile.acquisition_channel;
	const serious = salt(uid, "serious") < (SERIOUS_SHARE[channel] ?? SERIOUS_BASE);
	const agentId = `${MARKETS[market].code}-A${String(1 + Math.floor(salt(uid, "agent") * AGENTS_PER_MARKET)).padStart(2, "0")}`;
	const variant = profile[EXP_KEY] !== undefined ? profile[EXP_KEY] : null;

	let events = input.filter((e) => e.event !== "$experiment_started").sort(byT);
	const signup = events.find((e) => e.event === "account created") || null;
	const signupT = signup ? T(signup) : null;
	const authed = (e) => Boolean(e.user_id) && (signupT === null || T(e) >= signupT);

	// anonymous browsing before signup varies: some sign up after one listing,
	// some look at several first (the signup funnel emits two)
	if (signup) {
		const pre = events.filter((e) => e.event === "listing viewed" && !e.user_id && T(e) < signupT);
		const extra = Number(pickWeighted(PRE_SIGNUP_EXTRA_VIEWS, chance.floating({ min: 0, max: 1 })));
		if (pre.length) {
			if (extra === 0 && pre.length > 1 && chance.bool({ likelihood: 40 })) {
				const dropped = pre[pre.length - 1];
				events = events.filter((e) => e !== dropped);
			}
			const t0 = T(events[0]);
			for (let i = 0; i < extra; i++) {
				const t = t0 + Math.floor(chance.floating({ min: 0.05, max: 0.95 }) * Math.max(60_000, signupT - 30_000 - t0));
				events.push(cloneEvent(pre[0], { time: iso(t) }));
			}
			events.sort(byT);
		}
	}

	// ── H4: saved-search adoption (new shoppers) and quitting for non-adopters ──
	let saverT = null;
	let holder = false;
	const recentT = born ? null : recentJoinT(uid);
	const joinT = born ? signupT : recentT; // new and recently joined shoppers
	if (joinT !== null) {
		const adopter = salt(uid, "ss-adopt") < SAVED_SEARCH_ADOPT;
		let cut = Infinity;
		if (!adopter && salt(uid, "ss-churn") < NON_SAVER_CHURN) {
			cut = joinT + (CHURN_DAY_MIN + salt(uid, "ss-churn-day") * (CHURN_DAY_MAX - CHURN_DAY_MIN)) * DAY_MS;
		}
		if (salt(uid, "new-churn") < NEW_SHOPPER_CHURN) {
			cut = Math.min(cut, joinT + (NEW_CHURN_DAY_MIN + salt(uid, "new-churn-day") * (CHURN_DAY_MAX - NEW_CHURN_DAY_MIN)) * DAY_MS);
		}
		if (cut < Infinity) events = events.filter((e) => T(e) < cut);
	}
	if (!born && recentT !== null) {
		holder = salt(uid, "ss-adopt") < SAVED_SEARCH_ADOPT;
		saverT = holder ? recentT + salt(uid, "ss-when") * 7 * DAY_MS : null;
	} else if (born && signup) {
		const adopter = salt(uid, "ss-adopt") < SAVED_SEARCH_ADOPT;
		if (adopter) {
			holder = true;
			const searches = events.filter((e) => e.event === "home search" && authed(e) && T(e) > signupT && T(e) < signupT + 7 * DAY_MS);
			saverT = searches.length && salt(uid, "ss-when") >= 0.6
				? T(searches[Math.floor(salt(uid, "ss-pick") * searches.length)]) + chance.integer({ min: 20, max: 180 }) * 1000
				: signupT + chance.integer({ min: 1, max: 30 }) * MIN_MS;
		}
	} else if (!born) {
		holder = salt(uid, "ss-holder") < ESTABLISHED_SEARCH_HOLDERS;
		saverT = holder ? -Infinity : null;
	}

	// ── listings on views and 3D tours; searches carry the shopper's filters ──
	const seen = [];
	let lastView = null;
	const bedsMin = Math.max(1, Math.min(4, Math.round(2 + hashNormal(`${uid}|beds`) * 0.8)));
	const typePref = salt(uid, "typepref") < 0.6 ? "any" : salt(uid, "typepref2") < 0.7 ? "single_family" : salt(uid, "typepref2") < 0.85 ? "townhome" : "condo";
	for (const e of events) {
		const t = T(e);
		if (e.event === "listing viewed") {
			let L = null;
			if (seen.length && chance.bool({ likelihood: REVISIT_SHARE * 100 })) {
				const cand = seen[chance.integer({ min: 0, max: seen.length - 1 })];
				if (isActive(cand, t)) L = cand;
			}
			if (!L) { L = sampleListing(market, t, budget); if (L) seen.push(L); }
			if (!L) { e._drop = true; continue; }
			Object.assign(e, listingFacts(L, t), { baths: L.baths, sqft: L.sqft });
			e._L = L;
			lastView = e;
		} else if (e.event === "3d tour viewed") {
			const L = lastView && lastView._L && t - T(lastView) < 2 * HOUR_MS && isActive(lastView._L, t) ? lastView._L : sampleListing(market, t, budget);
			if (!L) { e._drop = true; continue; }
			e.listing_id = L.id; e.market = L.market; e.list_price_usd = listPrice(L, t);
			e._L = L;
		} else if (e.event === "home search") {
			const active = INVENTORY[market][dayKey(t)]?.active ?? 1500;
			e.market = market;
			e.price_max_usd = budget;
			e.beds_min = bedsMin;
			e.property_type = typePref;
			e.results_count = Math.max(0, Math.round(active * 0.45 * (typePref === "any" ? 1 : 0.4) * (1.2 - bedsMin * 0.15) * jitter(`rc|${e.insert_id}`, 0.2)));
		}
	}
	// H7: Austin feed outage: shoppers find nothing new and leave
	events = events.filter((e) => {
		if (e._drop) return false;
		if ((e.event === "listing viewed" || e.event === "3d tour viewed") && e.market === OUTAGE_MARKET && inOutage(T(e))) {
			return !chance.bool({ likelihood: OUTAGE_VIEW_DROP * 100 });
		}
		return true;
	});

	const views = events.filter((e) => e.event === "listing viewed");
	const postViews = views.filter(authed);
	// identity template for server-side events (a shopper whose activity ended before June 4 still gets alerts)
	const serverSrc = events.find(authed) || input.find((e) => e.user_id) || null;
	if (!serverSrc) return finish(events, [], profile, { holder: false, saverT, exposed: false, status: "none", market, uid });

	// ── H8 + pre-approval: daily chance on browsing days after the shopper is ready ──
	// a pre-approval letter is valid for PREAPPROVAL_VALID_DAYS; established serious
	// shoppers may hold one issued before June 4 and can renew when it lapses
	const VALID = PREAPPROVAL_VALID_DAYS * DAY_MS;
	let prior = null;
	if (joinT === null && serious && salt(uid, "pa-before") < PRIOR_APPROVAL_SHARE) {
		const at = BEGIN - Math.floor(salt(uid, "pa-age") * PRIOR_APPROVAL_SPAN_DAYS * DAY_MS);
		prior = { at, exp: at + VALID };
	}
	let approvedAt = Infinity; // in-window approval
	const holdsApproval = (t) => Boolean(prior && t >= prior.at && t < prior.exp) || (t >= approvedAt && t < approvedAt + VALID);
	const ready = prior ? prior.exp : joinT !== null ? joinT : salt(uid, "pa-ready") < READY_AT_START ? -Infinity : BEGIN + salt(uid, "pa-ready-day") * (END - BEGIN);
	let exposure = null;
	let start = null;
	const derived = [];
	const byDay = new Map();
	for (const v of postViews) {
		const k = dayStart(T(v));
		if (!byDay.has(k)) byDay.set(k, []);
		byDay.get(k).push(v);
	}
	{
		for (const [, allDayViews] of [...byDay.entries()].sort((a, b) => a[0] - b[0])) {
			if (start) break;
			const dayViews = prior ? allDayViews.filter((v) => T(v) >= prior.exp) : allDayViews;
			if (!dayViews.length) continue;
			if (variant !== null && !exposure) {
				const v0 = dayViews.find((v) => T(v) >= ms(PAYMENT_EST_START));
				if (v0) exposure = { t: T(v0) - 1000, view: v0 };
			}
			if (!serious) continue;
			const cands = dayViews.filter((v) => T(v) >= ready);
			if (!cands.length) continue;
			const v = cands[chance.integer({ min: 0, max: cands.length - 1 })];
			const boosted = Boolean(exposure) && variant === EXPERIMENT_VARIANT && T(v) > exposure.t;
			if (!chance.bool({ likelihood: PREAPP_DAILY_RATE * (boosted ? PAYMENT_EST_MULT : 1) * 100 })) continue;
			const st = T(v) + chance.integer({ min: 60, max: 480 }) * 1000;
			const loanType = budget > 760000 && chance.bool({ likelihood: 80 }) ? "jumbo" : pickWeighted({ conventional: 66, fha: 24, va: 10 }, chance.floating({ min: 0, max: 1 }));
			const entry = boosted && chance.bool({ likelihood: PAYMENT_EST_ENTRY_SHARE * 100 })
				? "payment_estimate"
				: pickWeighted({ listing_page: 50, financing_tab: 35, agent_referral: 15 }, chance.floating({ min: 0, max: 1 }));
			start = { t: st, view: v, loanType, entry };
		}
	}

	// ── H10 saves and H5 agent chats, per view ──
	const intent = shopperIntent(uid);
	const habit = (0.6 + 0.8 * salt(uid, "save-habit")) * intent;
	const units = []; // pipeline roots: { kind, t, L, root, pre }
	const saved = new Set();
	const chatted = new Set();
	for (const v of postViews) {
		const L = v._L;
		const t = T(v);
		if (!chatted.has(L.id) && chance.bool({ likelihood: CONTACT_RATE * intent * 100 })) {
			chatted.add(L.id);
			units.push({ kind: "chat", t: t + chance.integer({ min: 60, max: 900 }) * 1000, L, root: v });
		}
		if (!saved.has(L.id) && chance.bool({ likelihood: SAVE_BASE * habit * (v.price_reduced ? REDUCED_SAVE_MULT : 1) * 100 })) {
			saved.add(L.id);
			units.push({ kind: "save", t: t + chance.integer({ min: 10, max: 600 }) * 1000, L, root: v });
		}
	}
	// warm start: established shoppers' saves and chats from the 4 weeks before June 4
	if (!born) {
		for (const kind of ["save", "chat"]) {
			const nIn = units.filter((x) => x.kind === kind && !x.pre).length;
			const x = nIn * PREWINDOW_DAYS / WINDOW_DAYS;
			const n = Math.floor(x) + (chance.bool({ likelihood: (x % 1) * 100 }) ? 1 : 0);
			for (let i = 0; i < n; i++) {
				const t = BEGIN - Math.floor(chance.floating({ min: 0, max: PREWINDOW_DAYS }) * DAY_MS);
				const L = sampleListing(market, t, budget);
				if (!L || chatted.has(L.id) || saved.has(L.id)) continue;
				(kind === "save" ? saved : chatted).add(L.id);
				units.push({ kind, t, L, root: null, pre: true });
			}
		}
	}
	units.sort((a, b) => a.t - b.t);

	// ── tours: agent chats (H5) and listing-page requests on saved homes (H2) ──
	// One tour per listing: the earliest request wins. A saved home the shopper
	// already discussed with the agent before booking is left to the agent chat.
	const cands = [];
	const toured = new Set();
	const tourFactor = serious ? 1 : NONSERIOUS_TOUR_MULT;
	const chatAt = new Map();
	for (const x of units) if (x.kind === "chat") chatAt.set(x.L.id, x.t);
	for (const x of units) {
		if (x.kind !== "chat") continue;
		const minutes = Math.max(1, Math.round(Math.min(RESPONSE_MAX_MIN, logNormal(RESPONSE_MEDIAN_MIN, RESPONSE_SIGMA))));
		x.respT = x.t + minutes * MIN_MS;
		x.minutes = minutes;
		if (chance.bool({ likelihood: leadRate(minutes) * tourFactor * 100 })) {
			const tr = x.respT + Math.floor(Math.min(6 * DAY_MS, logNormal(20, 1.0) * HOUR_MS));
			cands.push({ unit: x, tr, source: "agent_chat", booking: "scheduled" });
		}
	}
	for (const x of units) {
		if (x.kind !== "save") continue;
		const tr = x.t + Math.floor(Math.min(10 * DAY_MS, logNormal(18, 1.0) * HOUR_MS));
		if (chatAt.has(x.L.id) && chatAt.get(x.L.id) < tr) continue;
		const ramp = tinRamp(tr);
		if (!chance.bool({ likelihood: Math.min(95, TOUR_PER_SAVE * tourFactor * (1 + (TIN_LIFT - 1) * ramp) * 100) })) continue;
		const booking = ramp > 0 && hashFloat(`tin|${uid}|${x.L.id}`) < TIN_SHARE * ramp ? "tour_it_now" : "scheduled";
		cands.push({ unit: x, tr, source: "listing_page", booking });
	}
	cands.sort((a, b) => a.tr - b.tr);
	const tours = [];
	for (const c of cands) {
		if (toured.has(c.unit.L.id)) continue;
		toured.add(c.unit.L.id);
		tours.push(c);
	}
	tours.sort((a, b) => a.tr - b.tr);
	for (const tour of tours) {
		const tin = tour.booking === "tour_it_now";
		tour.completed = chance.bool({ likelihood: tin ? 88 : 80 });
		const raw = tin ? tour.tr + chance.integer({ min: 2 * 60, max: 26 * 60 }) * MIN_MS : tour.tr + Math.floor(logNormal(54, 0.5) * HOUR_MS);
		let tc = snapDaytime(raw);
		if (tc <= tour.tr + HOUR_MS) tc = snapDaytime(tc + DAY_MS);
		tour.tc = tc;
	}

	// pre-approval completion time (known before offers)
	if (start && chance.bool({ likelihood: PREAPP_COMPLETE * 100 })) {
		start.completeT = start.t + Math.floor(Math.min(5 * DAY_MS, logNormal(28, 0.6) * HOUR_MS));
		approvedAt = start.completeT;
	}

	// ── offers: H3 (pre-approval), H1 (rate), H9 (timing by buyer type) ──
	for (const tour of tours) {
		tour.preapproved = holdsApproval(tour.tc);
		if (!tour.completed) continue;
		const p = OFFER_BASE * (tour.preapproved ? PREAPPROVED_OFFER_MULT : 1) * offerKeep(tour.tc);
		if (!chance.bool({ likelihood: p * 100 })) continue;
		const gap = Math.min(13 * DAY_MS, logNormal(OFFER_GAP_MEDIAN_H * (BUYER_TTC_MULT[btype] ?? 1), OFFER_GAP_SIGMA) * HOUR_MS);
		tour.offerT = tour.tc + Math.floor(gap);
		tour.accepted = chance.bool({ likelihood: ACCEPT_RATE * 100 });
		tour.outcomeT = tour.offerT + chance.integer({ min: 6 * 60, max: 72 * 60 }) * MIN_MS;
	}
	// under contract after the first accepted offer
	const acceptedTour = tours.filter((x) => x.offerT !== undefined && x.accepted).sort((a, b) => a.outcomeT - b.outcomeT)[0] || null;
	const A = acceptedTour ? acceptedTour.outcomeT : Infinity;
	if (A < Infinity) {
		for (const e of events) {
			if ((e.event === "listing viewed" || e.event === "home search" || e.event === "3d tour viewed") && T(e) > A + 2 * DAY_MS && e !== exposure?.view && e !== start?.view) {
				e._contractDrop = chance.bool({ likelihood: UNDER_CONTRACT_BROWSE_DROP * 100 });
			}
		}
	}

	// ── materialize ──
	const rootOk = (x) => x.root === null || (!x.root._contractDrop && x.t <= A + 2 * DAY_MS);
	for (const x of units) {
		if (!rootOk(x)) continue;
		const src = x.root || serverSrc;
		if (x.kind === "save") {
			derived.push(makeEvent(src, "listing saved", x.t, listingFacts(x.L, x.t)));
		} else {
			derived.push(makeEvent(src, "agent contacted", x.t, { listing_id: x.L.id, market: x.L.market, list_price_usd: listPrice(x.L, x.t), contact_method: pickWeighted({ chat: 70, call_request: 18, email: 12 }, hashFloat(`contact|${uid}|${x.L.id}`)) }));
			derived.push(makeEvent(serverSrc, "agent responded", x.respT, { listing_id: x.L.id, market: x.L.market, agent_id: agentId, response_minutes: x.minutes }, true));
		}
	}
	for (const tour of tours) {
		const x = tour.unit;
		if (!rootOk(x) || tour.tr > A) continue;
		const src = x.root || serverSrc;
		derived.push(makeEvent(src, "tour requested", tour.tr, { ...listingFacts(x.L, tour.tr), request_source: tour.source, booking_type: tour.booking }));
		// under contract: tours still scheduled after the acceptance are cancelled
		if (!tour.completed || tour.tc > A) continue;
		derived.push(makeEvent(serverSrc, "tour completed", tour.tc, { listing_id: x.L.id, market: x.L.market, list_price_usd: listPrice(x.L, tour.tc), booking_type: tour.booking, buyer_preapproved: tour.preapproved, agent_id: agentId }, true));
		// an offer already decided on a tour before the acceptance still goes in (rarely a second acceptance: a backup offer)
		if (tour.offerT === undefined) continue;
		const lp = listPrice(x.L, tour.offerT);
		const offerPrice = Math.round(lp * chance.floating({ min: 0.94, max: 1.03 }) / 1000) * 1000;
		derived.push(makeEvent(src, "offer submitted", tour.offerT, { listing_id: x.L.id, market: x.L.market, list_price_usd: lp, offer_price_usd: offerPrice, buyer_preapproved: tour.preapproved }));
		if (tour.accepted) {
			derived.push(makeEvent(serverSrc, "offer accepted", tour.outcomeT, { listing_id: x.L.id, market: x.L.market, final_price_usd: offerPrice }, true));
		} else {
			derived.push(makeEvent(serverSrc, "offer rejected", tour.outcomeT, { listing_id: x.L.id, market: x.L.market, rejection_reason: pickWeighted({ outbid: 46, price_too_low: 28, terms: 14, seller_withdrew: 12 }, chance.floating({ min: 0, max: 1 })) }, true));
		}
	}
	let started = false;
	if (start && start.t <= A) {
		started = true;
		derived.push(makeEvent(start.view, "pre-approval started", start.t, { loan_type: start.loanType, entry_point: start.entry }));
		if (start.completeT !== undefined) {
			const rate = loanRate(start.loanType, start.completeT);
			derived.push(makeEvent(serverSrc, "pre-approval completed", start.completeT, {
				loan_type: start.loanType,
				approved_amount_usd: Math.round(budget * chance.floating({ min: 0.85, max: 1.0 }) / 5000) * 5000,
				rate_quoted_pct: Math.round((rate + chance.floating({ min: -0.125, max: 0.25 })) * 8) / 8,
			}, true));
		}
	} else if (start) {
		approvedAt = Infinity;
	}
	if (exposure) {
		derived.push(makeEvent(exposure.view, "$experiment_started", exposure.t, { "Experiment name": EXPERIMENT_NAME, "Variant name": variant }));
	}
	if (born && saverT !== null) {
		const src = events.filter((e) => authed(e) && T(e) <= saverT).pop() || serverSrc;
		derived.push(makeEvent(src, "saved search created", saverT, { market, price_max_usd: budget, beds_min: bedsMin, alert_frequency: salt(uid, "freq") < 0.75 ? "daily" : "instant" }));
	}

	events = events.filter((e) => !e._contractDrop);
	const status = holdsApproval(END) ? "approved" : (prior || approvedAt < Infinity) ? "expired" : started ? "started" : "none";
	return finish(events, derived, profile, { holder, saverT, exposed: Boolean(exposure), status, market, serverSrc, uid });
}

// alerts, cleanup, profile
function finish(events, derived, profile, s) {
	const out = events.concat(derived);
	if (s.holder && s.serverSrc) {
		const from = Math.max(BEGIN, s.saverT ?? BEGIN);
		const viewsAfter = out.filter((e) => e.event === "listing viewed" && e.user_id).sort(byT);
		// alerts pause after ALERT_PAUSE_DAYS without a visit (established holders last visited in the 30 days before June 4)
		const visits = out.filter((e) => (e.event === "listing viewed" || e.event === "home search") && e.user_id && !e._contractDrop).map(T).sort((a, b) => a - b);
		let lastVisit = s.saverT === -Infinity ? BEGIN - salt(s.uid, "last-visit") * ALERT_PAUSE_DAYS * DAY_MS : s.saverT;
		let vi = 0;
		const alertChannel = salt(s.uid, "alert-ch") < 0.7 ? "email" : "push";
		for (let d = dayStart(from); d <= END; d += DAY_MS) {
			if (!chance.bool({ likelihood: ALERT_DAY_P * 100 })) continue;
			const t = d + Math.floor((12 + chance.floating({ min: 0, max: 3 })) * HOUR_MS);
			if (t < from || t > END) continue;
			while (vi < visits.length && visits[vi] < t) lastVisit = Math.max(lastVisit, visits[vi++]);
			if (t - lastVisit > ALERT_PAUSE_DAYS * DAY_MS) continue;
			if (s.market === OUTAGE_MARKET && inOutage(t)) continue;
			out.push(makeEvent(s.serverSrc, "listing alert sent", t, { market: s.market, new_matches: chance.integer({ min: 1, max: 9 }), alert_channel: alertChannel }, true));
			const next = viewsAfter.find((v) => T(v) > t && T(v) < t + 12 * HOUR_MS);
			if (next && next.view_source !== "listing_alert" && chance.bool({ likelihood: ALERT_OPEN_ON_ACTIVE * 100 })) {
				const ot = Math.max(t + 60_000, T(next) - chance.integer({ min: 10, max: 90 }) * 1000);
				out.push(makeEvent(next, "listing alert opened", ot, { market: s.market, alert_channel: alertChannel }));
				next.view_source = "listing_alert";
			}
		}
	}
	for (const e of out) { delete e._L; delete e._drop; delete e._contractDrop; }
	if (!s.exposed && profile[EXP_KEY] !== undefined) delete profile[EXP_KEY];
	profile.preapproval_status = s.status;
	profile.saved_search_count = s.holder ? 1 + Math.floor(hashFloat(`${profile.distinct_id}|ss-n`) * (s.saverT === -Infinity ? 2.6 : 1.4)) : 0;
	return out.filter((e) => T(e) >= BEGIN && T(e) <= END);
}

// warehouse rows: exogenous business facts layered on event-derived volumes
function handleWarehouse(row, meta) {
	if (meta.isBackfill) return row;
	if (meta.metricName === "marketing_spend_daily") {
		const ch = row.acquisition_channel;
		const k = `${row.date}|${ch}`;
		const dow = new Date(`${String(row.date).slice(0, 10)}T00:00:00Z`).getUTCDay();
		const spend = round2((SPEND_PLAN_SHARE * DAILY_BUDGET_USD[ch] * SPEND_WEEKDAY[dow] + (1 - SPEND_PLAN_SHARE) * CPS_USD[ch] * row.spend_usd) * jitter(`spend|${k}`, SPEND_NOISE));
		row.spend_usd = spend;
		row.leads_reported = Math.round(spend * PLATFORM_LEAD_INFLATION / CPS_USD[ch] * jitter(`lead|${k}`, 0.2));
		row.clicks = Math.round(spend / (CPC_USD[ch] * jitter(`cpc|${k}`, 0.15)));
		row.impressions = Math.round(row.clicks / (CTR[ch] * jitter(`ctr|${k}`, 0.15)));
		return row;
	}
	if (meta.metricName === "mortgage_rate_sheet_daily") {
		const k = `${row.date}|${row.loan_type}`;
		row.applications = Math.round(row.applications * (1 + 0.14 * jitter(`phone|${k}`, 1)) + (hashFloat(`branch|${k}`) < 0.35 ? 1 : 0));
		row.rate_locks = Math.round(row.applications * 0.32 * jitter(`lock|${k}`, 0.5));
		return row;
	}
	if (meta.metricName === "market_inventory_daily") {
		const k = `${row.date}|${row.market}`;
		const crawl = CRAWLER_VIEWS_PER_DAY * (MARKETS[row.market]?.share ?? 10) / 100 * Math.exp(0.5 * hashNormal(`crawl|${k}`));
		row.listing_page_views = Math.round(row.listing_page_views * (1 + UNTRACKED_VIEW_SHARE * jitter(`untracked|${k}`, 1)) + crawl);
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
		hasAndroidDevices: true,
		hasIOSDevices: true,
		hasDesktopDevices: true,
		hasBrowser: true,
		hasCampaigns: false,
		isAnonymous: false,
		hasAdSpend: false,
		hasAvatar: true,
	},
	identity: { avgDevicePerUser: 2 },

	events: [
		{
			event: "account created",
			weight: 1,
			isAuthEvent: true,
			properties: {
				signup_method: { __weights: { google: 38, apple: 27, email: 35 } },
				acquisition_channel: (ctx) => ctx.profile.acquisition_channel,
			},
		},
		{
			event: "home search",
			weight: 1,
			isStrictEvent: true,
			properties: {
				market: ["Dallas"],
				price_max_usd: [400000],
				beds_min: [2],
				property_type: ["any"],
				results_count: [0],
			},
		},
		{
			event: "listing viewed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				listing_id: ["unassigned"],
				market: ["Dallas"],
				list_price_usd: [0],
				property_type: ["single_family"],
				beds: [3],
				baths: [2],
				sqft: [1800],
				days_on_market: [0],
				price_reduced: [false],
				view_source: { __weights: { search_results: 55, map: 25, saved_homes: 10, shared_link: 10 } },
			},
		},
		{
			event: "3d tour viewed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				listing_id: ["unassigned"],
				market: ["Dallas"],
				list_price_usd: [0],
				watch_seconds: u.weighNumRange(15, 600, 0.6, 60),
			},
		},
		{
			event: "listing saved",
			weight: 1,
			isStrictEvent: true,
			properties: {
				listing_id: ["unassigned"],
				market: ["Dallas"],
				list_price_usd: [0],
				property_type: ["single_family"],
				beds: [3],
				days_on_market: [0],
				price_reduced: [false],
			},
		},
		{
			event: "saved search created",
			weight: 1,
			isStrictEvent: true,
			properties: {
				market: ["Dallas"],
				price_max_usd: [400000],
				beds_min: [2],
				alert_frequency: ["daily"],
			},
		},
		{
			event: "listing alert sent",
			weight: 1,
			isStrictEvent: true,
			properties: {
				market: ["Dallas"],
				new_matches: [1],
				alert_channel: ["email"],
			},
		},
		{
			event: "listing alert opened",
			weight: 1,
			isStrictEvent: true,
			properties: {
				market: ["Dallas"],
				alert_channel: ["email"],
			},
		},
		{
			event: "agent contacted",
			weight: 1,
			isStrictEvent: true,
			properties: {
				listing_id: ["unassigned"],
				market: ["Dallas"],
				list_price_usd: [0],
				contact_method: ["chat"],
			},
		},
		{
			event: "agent responded",
			weight: 1,
			isStrictEvent: true,
			properties: {
				listing_id: ["unassigned"],
				market: ["Dallas"],
				agent_id: ["unassigned"],
				response_minutes: [0],
			},
		},
		{
			event: "tour requested",
			weight: 1,
			isStrictEvent: true,
			properties: {
				listing_id: ["unassigned"],
				market: ["Dallas"],
				list_price_usd: [0],
				property_type: ["single_family"],
				beds: [3],
				days_on_market: [0],
				price_reduced: [false],
				request_source: ["listing_page"],
				booking_type: ["scheduled"],
			},
		},
		{
			event: "tour completed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				listing_id: ["unassigned"],
				market: ["Dallas"],
				list_price_usd: [0],
				booking_type: ["scheduled"],
				buyer_preapproved: [false],
				agent_id: ["unassigned"],
			},
		},
		{
			event: "offer submitted",
			weight: 1,
			isStrictEvent: true,
			properties: {
				listing_id: ["unassigned"],
				market: ["Dallas"],
				list_price_usd: [0],
				offer_price_usd: [0],
				buyer_preapproved: [false],
			},
		},
		{
			event: "offer accepted",
			weight: 1,
			isStrictEvent: true,
			properties: {
				listing_id: ["unassigned"],
				market: ["Dallas"],
				final_price_usd: [0],
			},
		},
		{
			event: "offer rejected",
			weight: 1,
			isStrictEvent: true,
			properties: {
				listing_id: ["unassigned"],
				market: ["Dallas"],
				rejection_reason: ["outbid"],
			},
		},
		{
			event: "pre-approval started",
			weight: 1,
			isStrictEvent: true,
			properties: {
				loan_type: ["conventional"],
				entry_point: ["listing_page"],
			},
		},
		{
			event: "pre-approval completed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				loan_type: ["conventional"],
				approved_amount_usd: [0],
				rate_quoted_pct: [0],
			},
		},
		{
			event: "$experiment_started",
			weight: 1,
			isStrictEvent: true,
			properties: {
				"Experiment name": [EXPERIMENT_NAME],
				"Variant name": ["Control", EXPERIMENT_VARIANT],
			},
		},
	],

	funnels: [
		{
			name: "Signup",
			sequence: ["home search", "listing viewed", "listing viewed", "account created"],
			isFirstFunnel: true,
			conversionRate: 100,
			timeToConvert: 0.3,
			order: "sequential",
			requireRepeats: true,
			weight: 1,
		},
		{
			name: "Browse session",
			sequence: ["home search", "listing viewed", "listing viewed", "listing viewed", "listing viewed", "listing viewed", "3d tour viewed"],
			conversionRate: 65,
			timeToConvert: 0.5,
			order: "first-fixed",
			requireRepeats: true,
			weight: 10,
			experiment: {
				name: EXPERIMENT_NAME,
				startDaysBeforeEnd: (END + 1000 - ms(PAYMENT_EST_START)) / DAY_MS,
				variants: [{ name: "Control" }, { name: EXPERIMENT_VARIANT }],
			},
		},
		{
			name: "Revisit session",
			sequence: ["listing viewed", "listing viewed", "listing viewed", "listing viewed", "3d tour viewed"],
			conversionRate: 60,
			timeToConvert: 0.4,
			order: "random",
			requireRepeats: true,
			weight: 5,
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
				// set by the warehouse hook from the day's spend
				leads_reported: 0,
				clicks: 0,
				impressions: 0,
			},
		},
		{
			name: "mortgage_rate_sheet_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "pre-approval started",
				measure: "count",
				groupBy: "loan_type",
			},
			timeColumn: "date",
			valueColumn: "applications",
			columns: {
				note_rate_pct: (ctx) => loanRate(ctx.row.loan_type, ctx.time),
				apr_pct: (ctx) => Math.round((loanRate(ctx.row.loan_type, ctx.time) + 0.12 + hashFloat(`apr|${dayKey(ctx.time)}|${ctx.seriesKey}`) * 0.1) * 1000) / 1000,
				discount_points: (ctx) => Math.round((0.4 + hashFloat(`pts|${dayKey(ctx.time)}|${ctx.seriesKey}`) * 0.5) * 100) / 100,
				rate_locks: 0,
			},
		},
		{
			name: "market_inventory_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "listing viewed",
				measure: "count",
				groupBy: "market",
			},
			timeColumn: "date",
			valueColumn: "listing_page_views",
			columns: {
				new_listings: (ctx) => INVENTORY[ctx.row.market]?.[dayKey(ctx.time)]?.new_listings ?? 0,
				active_listings: (ctx) => INVENTORY[ctx.row.market]?.[dayKey(ctx.time)]?.active ?? 0,
				price_reductions: (ctx) => INVENTORY[ctx.row.market]?.[dayKey(ctx.time)]?.price_reductions ?? 0,
				closed_sales: (ctx) => INVENTORY[ctx.row.market]?.[dayKey(ctx.time)]?.closed_sales ?? 0,
				median_list_price_usd: (ctx) => INVENTORY[ctx.row.market]?.[dayKey(ctx.time)]?.median_price ?? 0,
				feed_status: (ctx) => (ctx.row.market === OUTAGE_MARKET && inOutage(ctx.time) ? "stale" : "healthy"),
			},
		},
	],

	superProps: {},

	userProps: {
		home_market: weighted(Object.fromEntries(Object.entries(MARKETS).map(([k, m]) => [k, m.share]))),
		buyer_type: weighted(BUYER_TYPE_WEIGHTS),
		budget_max_usd: [400000],
		acquisition_channel: weighted(CHANNEL_WEIGHTS),
		member_since: ["2025-01-01"],
		preapproval_status: ["none"],
		saved_search_count: [0],
	},

	retentionCurve: { type: "logarithmic", day1: 0.5, day7: 0.36, day30: 0.3, day90: 0.27 },

	hook(record, type, meta) {
		if (type === "user") return handleUserHook(record, meta);
		if (type === "everything") return handleEverything(record, meta);
		if (type === "warehouse") return handleWarehouse(record, meta);
		return record;
	},
};

for (const e of config.events) EVENT_PROPS[e.event] = Object.keys(e.properties || {});

// ── STORIES ──────────────────────────────────────────────────────────────
// Machine-checkable contract for hooks H1-H10. Evaluate with:
//   node dungeons/vertical/real-estate/real-estate.verify.mjs

const EV = `read_json_auto('{{PREFIX}}-EVENTS*.json*', sample_size=-1, union_by_name=true)`;
const US = `read_json_auto('{{PREFIX}}-USERS*.json*', sample_size=-1, union_by_name=true)`;
const WH = (table) => `read_json_auto('{{PREFIX}}-WAREHOUSE-${table}.json*', sample_size=-1, union_by_name=true)`;

// Identity prelude: a device resolves to the shopper seen with it on any event
// that carries both ids (the signup event stitches the anonymous pre-signup
// browsing). Server-side events carry user_id only.
const ID_CTE = `dmap AS (SELECT device_id, min(user_id::VARCHAR) AS mapped FROM ${EV}
  WHERE user_id IS NOT NULL AND device_id IS NOT NULL GROUP BY 1),
ev AS (SELECT coalesce(e.user_id::VARCHAR, m.mapped) AS uid, e.time::TIMESTAMP AS t, e.*
  FROM ${EV} e LEFT JOIN dmap m ON e.device_id = m.device_id)`;

const TS = (isoStr) => dayjs.utc(isoStr).format("YYYY-MM-DD HH:mm:ss");
const D = (isoStr) => isoStr.slice(0, 10);
const band = (k) => [Math.round(k * 0.9 * 1000) / 1000, Math.round(k * 1.1 * 1000) / 1000];
const minus = (isoStr, days) => TS(dayjs.utc(isoStr).subtract(days, "day").toISOString());
const OFFER_WINDOW_DAYS = 14;        // Funnels conversion window tour completed → offer submitted
const OFFER_READ_END = minus(DATASET_END, OFFER_WINDOW_DAYS);
const HIGH_RATE_MIN = PEAK_RATE - 0.05; // high-rate days on the rate sheet (plateau)
const BASE_RATE_MAX = BASE_RATE + 0.1;  // baseline days (before the climb)
const POST_LAUNCH_FROM = TS(dayjs.utc(TOUR_IT_NOW_LAUNCH).add(TIN_RAMP_DAYS, "day").toISOString());
const RET_FROM = 28, RET_TO = 56;    // H4: listing viewed on day 28-55 after signup
const RET_BIRTH_END = minus(DATASET_END, RET_TO);
const LEAD_WINDOW_DAYS = 7;          // H5 funnel window
const LEAD_READ_END = minus(DATASET_END, LEAD_WINDOW_DAYS);
const PREAPP_WINDOW_DAYS = 30;       // H6 funnel window
const SIGNUP_READ_END = minus(DATASET_END, PREAPP_WINDOW_DAYS);
const EXP_WINDOW_DAYS = 14;          // H8 funnel window
const EXP_READ_END = minus(DATASET_END, EXP_WINDOW_DAYS);
const INC_BASE_DAYS = 14;            // H7 baseline days either side of the outage
const INC_BASE_FROM = minus(FEED_OUTAGE_START, INC_BASE_DAYS);
const INC_BASE_TO = TS(dayjs.utc(FEED_OUTAGE_END).add(INC_BASE_DAYS, "day").toISOString());
const SPEND_PER_START_RATIO = Math.round(CPS_USD.paid_social / SOCIAL_SERIOUS_MULT / CPS_USD.paid_search * 1000) / 1000;
const SPEND_PER_SIGNUP_RATIO = Math.round(CPS_USD.paid_social / CPS_USD.paid_search * 1000) / 1000;

// offers per completed tour (per listing, 14-day window), with the day's rate
const OFFER_CTE = `${ID_CTE},
r AS (SELECT date::DATE AS d, note_rate_pct AS rate FROM ${WH("mortgage_rate_sheet_daily")} WHERE loan_type = 'conventional'),
tc AS (SELECT uid, listing_id, t AS t0, buyer_preapproved AS pa FROM ev WHERE event = 'tour completed' AND t < TIMESTAMP '${OFFER_READ_END}'),
os AS (SELECT uid, listing_id, min(t) AS t1 FROM ev WHERE event = 'offer submitted' GROUP BY 1, 2),
x AS (SELECT tc.uid, tc.pa, tc.t0, r.rate, os.t1, coalesce(os.t1 >= tc.t0 AND os.t1 < tc.t0 + INTERVAL ${OFFER_WINDOW_DAYS} DAY, false) AS conv
  FROM tc JOIN r ON r.d = tc.t0::DATE LEFT JOIN os ON os.uid = tc.uid AND os.listing_id = tc.listing_id)`;

const H1_SQL = `WITH ${OFFER_CTE},
g AS (SELECT CASE WHEN rate >= ${HIGH_RATE_MIN} THEN 'high' WHEN rate < ${BASE_RATE_MAX} THEN 'base' END AS per, pa,
  count(*) AS tours, avg(conv::INT) AS cr, count(DISTINCT uid) AS users FROM x GROUP BY 1, 2)
SELECT 'all' AS grp, min(h.users) AS user_count, sum(b.tours) AS base_tours, sum(h.tours) AS high_tours,
 sum(b.tours * h.cr) / sum(b.tours * b.cr) AS std_ratio
FROM g b JOIN g h ON h.pa = b.pa AND b.per = 'base' AND h.per = 'high'`;

const H1_CONTROL_SQL = `WITH ${ID_CTE},
r AS (SELECT date::DATE AS d, note_rate_pct AS rate FROM ${WH("mortgage_rate_sheet_daily")} WHERE loan_type = 'conventional'),
w AS (SELECT CASE WHEN r.rate >= ${HIGH_RATE_MIN} THEN 'high' WHEN r.rate < ${BASE_RATE_MAX} AND ev.t >= TIMESTAMP '${POST_LAUNCH_FROM}' THEN 'base' END AS per, ev.event, ev.request_source, ev.uid
  FROM ev JOIN r ON r.d = ev.t::DATE WHERE ev.event IN ('tour requested', 'listing saved'))
SELECT per AS grp, count(DISTINCT uid) AS user_count,
 count(*) FILTER (WHERE event = 'tour requested' AND request_source = 'listing_page')::DOUBLE / count(*) FILTER (WHERE event = 'listing saved') AS tours_per_save
FROM w WHERE per IS NOT NULL GROUP BY 1`;

const H2_SQL = `WITH ${ID_CTE}
SELECT CASE WHEN t < TIMESTAMP '${TS(TOUR_IT_NOW_LAUNCH)}' THEN 'before' WHEN t >= TIMESTAMP '${POST_LAUNCH_FROM}' THEN 'after' END AS grp,
 count(DISTINCT uid) AS user_count,
 count(*) FILTER (WHERE event = 'tour requested' AND request_source = 'listing_page')::DOUBLE / count(*) FILTER (WHERE event = 'listing saved') AS tours_per_save,
 count(*) FILTER (WHERE event = 'tour requested' AND booking_type = 'tour_it_now') AS tin_requests,
 count(*) FILTER (WHERE event = 'tour requested' AND booking_type = 'tour_it_now')::DOUBLE / count(*) FILTER (WHERE event = 'tour requested' AND request_source = 'listing_page') AS tin_share
FROM ev WHERE event IN ('tour requested', 'listing saved') GROUP BY 1 HAVING grp IS NOT NULL`;

// offer rate per completed tour by buyer_preapproved, compared inside rate bands
// (H1 scales both groups the same way on any given day) and pooled with the
// band's tour count as weight
const H3_SQL = `WITH ${OFFER_CTE},
b AS (SELECT CASE WHEN rate < ${BASE_RATE_MAX} THEN 'base' WHEN rate >= ${HIGH_RATE_MIN} THEN 'high' ELSE 'mid' END AS band, pa, uid, conv FROM x),
g AS (SELECT band, pa, count(*) AS tours, avg(conv::INT) AS cr, count(DISTINCT uid) AS users FROM b GROUP BY 1, 2),
w AS (SELECT band, sum(tours) AS nb FROM g GROUP BY 1),
n AS (SELECT pa, count(DISTINCT uid) AS users FROM b GROUP BY 1)
SELECT CASE WHEN g.pa THEN 'preapproved' ELSE 'not_preapproved' END AS grp, any_value(n.users) AS user_count, sum(g.tours)::BIGINT AS tours,
 sum(w.nb * g.cr) / sum(w.nb) AS offer_rate
FROM g JOIN w ON w.band = g.band JOIN n ON n.pa = g.pa GROUP BY 1`;

const H4_SQL = `WITH ${ID_CTE},
b AS (SELECT uid, t AS t0 FROM ev WHERE event = 'account created' AND t <= TIMESTAMP '${RET_BIRTH_END}'),
c AS (SELECT b.uid,
  bool_or(e.event = 'saved search created' AND e.t >= b.t0 AND e.t < b.t0 + INTERVAL 7 DAY) AS saver,
  bool_or(e.event = 'listing viewed' AND e.t >= b.t0 + INTERVAL ${RET_FROM} DAY AND e.t < b.t0 + INTERVAL ${RET_TO} DAY) AS ret
  FROM b JOIN ev e ON e.uid = b.uid GROUP BY 1)
SELECT CASE WHEN saver THEN 'saver' ELSE 'non_saver' END AS grp, count(*) AS user_count, avg(ret::INT) AS retention FROM c GROUP BY 1`;

const H5_SQL = `WITH ${ID_CTE},
a AS (SELECT uid, listing_id, t AS t0, response_minutes AS m FROM ev WHERE event = 'agent responded' AND t < TIMESTAMP '${LEAD_READ_END}'),
q AS (SELECT uid, listing_id, min(t) AS t1 FROM ev WHERE event = 'tour requested' GROUP BY 1, 2)
SELECT CASE WHEN m <= ${FAST_REPLY_MIN} THEN 'fast' WHEN m > ${SLOW_REPLY_MIN} THEN 'slow' ELSE 'mid' END AS grp,
 count(DISTINCT a.uid) AS user_count, count(*) AS replies,
 avg(coalesce(q.t1 >= a.t0 AND q.t1 < a.t0 + INTERVAL ${LEAD_WINDOW_DAYS} DAY, false)::INT) AS tour_rate
FROM a LEFT JOIN q ON q.uid = a.uid AND q.listing_id = a.listing_id GROUP BY 1`;

const H6_SQL = `WITH ${ID_CTE},
s AS (SELECT uid, t AS t0, acquisition_channel AS ch FROM ev WHERE event = 'account created' AND t < TIMESTAMP '${SIGNUP_READ_END}'),
p AS (SELECT s.uid FROM s JOIN ev e ON e.uid = s.uid AND e.event = 'pre-approval started' AND e.t >= s.t0 AND e.t < s.t0 + INTERVAL ${PREAPP_WINDOW_DAYS} DAY GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM ${WH("marketing_spend_daily")} WHERE date::DATE < DATE '${SIGNUP_READ_END.slice(0, 10)}' GROUP BY 1),
g AS (SELECT s.ch, count(*) AS signups, count(p.uid) AS starts FROM s LEFT JOIN p ON p.uid = s.uid GROUP BY 1)
SELECT g.ch AS grp, g.signups AS user_count, g.starts::DOUBLE / g.signups AS start_rate,
 sp.spend / g.signups AS spend_per_signup, sp.spend / nullif(g.starts, 0) AS spend_per_start
FROM g LEFT JOIN sp ON sp.ch = g.ch
UNION ALL
SELECT 'non_social' AS grp, sum(signups)::BIGINT AS user_count, sum(starts)::DOUBLE / sum(signups) AS start_rate, NULL, NULL FROM g WHERE ch <> 'paid_social'`;

const H7_SQL = `WITH ${ID_CTE},
o AS (SELECT DISTINCT date::DATE AS d, market FROM ${WH("market_inventory_daily")} WHERE feed_status = 'stale'),
od AS (SELECT DISTINCT d FROM o), om AS (SELECT DISTINCT market FROM o),
w AS (SELECT t::DATE AS d, uid, (market IN (SELECT market FROM om)) AS hit FROM ev
  WHERE event = 'listing viewed' AND t >= TIMESTAMP '${INC_BASE_FROM}' AND t < TIMESTAMP '${INC_BASE_TO}'),
g AS (SELECT (d IN (SELECT d FROM od)) AS outage, count(*) FILTER (WHERE hit)::DOUBLE / count(*) FILTER (WHERE NOT hit) AS rel,
  count(DISTINCT uid) FILTER (WHERE hit) AS users FROM w GROUP BY 1)
SELECT 'all' AS grp, (SELECT count(*) FROM od) AS outage_days, min(users) AS user_count,
 max(rel) FILTER (WHERE outage) / max(rel) FILTER (WHERE NOT outage) AS did
FROM g`;

const H8_SQL = `WITH ${ID_CTE},
x AS (SELECT uid, t AS t0, "Variant name" AS v FROM ev WHERE event = '$experiment_started' AND t < TIMESTAMP '${EXP_READ_END}'),
p AS (SELECT uid, min(t) AS t1 FROM ev WHERE event = 'pre-approval started' GROUP BY 1)
SELECT x.v AS grp, count(DISTINCT x.uid) AS user_count,
 avg(coalesce(p.t1 > x.t0 AND p.t1 < x.t0 + INTERVAL ${EXP_WINDOW_DAYS} DAY, false)::INT) AS start_rate
FROM x LEFT JOIN p ON p.uid = x.uid GROUP BY 1`;

const H9_SQL = `WITH ${OFFER_CTE},
y AS (SELECT u.buyer_type AS bt, x.uid, date_diff('second', x.t0, x.t1) / 3600.0 AS hours
  FROM x JOIN ${US} u ON u.distinct_id::VARCHAR = x.uid WHERE x.conv)
SELECT bt AS grp, count(DISTINCT uid) AS user_count, count(*) AS offers, median(hours) AS med_hours FROM y GROUP BY 1`;

const H10_SQL = `WITH ${ID_CTE}
SELECT CASE WHEN price_reduced THEN 'reduced' ELSE 'original' END AS grp, count(DISTINCT uid) AS user_count,
 count(*) FILTER (WHERE event = 'listing saved')::DOUBLE / count(*) FILTER (WHERE event = 'listing viewed') AS save_rate
FROM ev WHERE event IN ('listing saved', 'listing viewed') GROUP BY 1`;

/** @type {import("../../../types").DungeonStory[]} */
export const stories = [
	{
		id: "H1-rate-spike-cools-offers",
		hook: "H1",
		archetype: "external-join",
		narrative: `Mortgage rates move offers. The Keystead Home Loans rate sheet (warehouse mortgage_rate_sheet_daily, loan_type = conventional) holds near ${BASE_RATE}% until ${D(RATE_RAMP_START)}, climbs to ${PEAK_RATE}% by ${D(RATE_PLATEAU_START)}, holds through ${dayjs.utc(RATE_PLATEAU_END).subtract(1, "day").format("YYYY-MM-DD")}, and eases to ${SETTLE_RATE}% by ${D(RATE_EASE_END)}. The chance that a completed tour gets an offer is multiplied by 1 - ${OFFER_RATE_SENSITIVITY.toFixed(4)} x (rate - ${BASE_RATE}), so ${RATE_PEAK_OFFER_KEEP}x on plateau days. Read: offer submitted within ${OFFER_WINDOW_DAYS} days of tour completed (same listing_id), tours on high-rate days (note_rate_pct ≥ ${HIGH_RATE_MIN}) vs baseline days (< ${BASE_RATE_MAX}), standardized to the baseline mix of buyer_preapproved (pre-approval share shifts slowly over the window). Control: listing-page tour requests per saved listing do not move with the rate (high-rate days vs post-launch baseline days from ${POST_LAUNCH_FROM.slice(0, 10)}).`,
		mixpanelReport: { type: "Funnels + warehouse", steps: ["tour completed", "offer submitted"], counting: "totals", holdPropertyConstant: "listing_id", window: `${OFFER_WINDOW_DAYS} days`, breakdown: "buyer_preapproved", chart: "daily conversion", join: "mortgage_rate_sheet_daily.note_rate_pct (conventional) on date" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H1_SQL },
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.std_ratio", op: "between", target: band(RATE_PEAK_OFFER_KEEP) },
				minCohort: 400,
			},
			{
				breakdown: { type: "duckdb", sql: H1_CONTROL_SQL },
				select: { h: { where: { grp: "high" } }, b: { where: { grp: "base" } } },
				// control: touring itself is not rate-sensitive
				expect: { metric: "h.tours_per_save / b.tours_per_save", op: "between", target: band(1) },
				minCohort: 1000,
			},
		],
	},
	{
		id: "H2-tour-it-now-launch",
		hook: "H2",
		archetype: "temporal-inflection",
		narrative: `Tour It Now (book a same-day tour from the listing page) launches ${D(TOUR_IT_NOW_LAUNCH)} and ramps in over ${TIN_RAMP_DAYS} days. Listing-page tour requests per saved listing rise ${TIN_LIFT}x (the new booking adds showings, it does not only relabel them); after the ramp ${TIN_SHARE * 100}% of listing-page requests carry booking_type = tour_it_now, which never appears before launch. Agent-chat tour requests (request_source = agent_chat) are not part of the launch. Read: tour requested (request_source = listing_page) / listing saved, ${D(DATASET_START)} to ${dayjs.utc(TOUR_IT_NOW_LAUNCH).subtract(1, "day").format("YYYY-MM-DD")} vs from ${POST_LAUNCH_FROM.slice(0, 10)}. Mortgage rates do not change touring (see H1 control).`,
		mixpanelReport: { type: "Insights", events: ["tour requested (request_source = listing_page)", "listing saved"], formula: "A / B", chart: "weekly line; before Jul 15 vs from Jul 22", breakdown: "booking_type" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H2_SQL },
				select: { a: { where: { grp: "after" } }, b: { where: { grp: "before" } } },
				expect: { metric: "a.tours_per_save / b.tours_per_save", op: "between", target: band(TIN_LIFT) },
				minCohort: 2000,
			},
			{
				breakdown: { type: "duckdb", sql: H2_SQL },
				select: { b: { where: { grp: "before" } } },
				// exact: a Tour It Now booking before launch is a bug
				expect: { metric: "b.tin_requests", op: "between", target: [0, 0] },
			},
		],
	},
	{
		id: "H3-preapproved-buyers-offer",
		hook: "H3",
		archetype: "funnel-conversion-by-segment",
		narrative: `A completed tour by a shopper who holds a Keystead Home Loans pre-approval (tour completed buyer_preapproved = true; letters are valid ${PREAPPROVAL_VALID_DAYS} days) gets an offer ${PREAPPROVED_OFFER_MULT}x as often: ${OFFER_BASE * PREAPPROVED_OFFER_MULT * 100}% vs ${OFFER_BASE * 100}% at baseline rates. Read: offer submitted within ${OFFER_WINDOW_DAYS} days of tour completed (same listing_id), tours through ${OFFER_READ_END.slice(0, 10)}, compared inside rate bands of the warehouse rate sheet (base < ${BASE_RATE_MAX}, high ≥ ${HIGH_RATE_MIN}, the rest) and pooled with each band's tour count as weight, because H1 scales both groups the same way on a given day while the pre-approved share drifts. Buyers whose offer is accepted stop making offers, which removes a few in-flight offers more often from pre-approved buyers.`,
		mixpanelReport: { type: "Funnels", steps: ["tour completed", "offer submitted"], counting: "totals", holdPropertyConstant: "listing_id", window: `${OFFER_WINDOW_DAYS} days`, dateRange: `${D(DATASET_START)} to ${OFFER_READ_END.slice(0, 10)}`, breakdown: "buyer_preapproved" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H3_SQL },
				select: { p: { where: { grp: "preapproved" } }, n: { where: { grp: "not_preapproved" } } },
				expect: { metric: "p.offer_rate / n.offer_rate", op: "between", target: band(PREAPPROVED_OFFER_MULT) },
				minCohort: 500,
			},
		],
	},
	{
		id: "H4-saved-search-retention",
		hook: "H4",
		archetype: "retention-divergence",
		narrative: `A saved search in week one keeps new shoppers coming back. ${SAVED_SEARCH_ADOPT * 100}% of new shoppers save a search within 7 days of "account created" (most right after signup; adoption is salted per shopper, independent of how active they are). ${NON_SAVER_CHURN * 100}% of the others stop browsing for good ${CHURN_DAY_MIN}-${CHURN_DAY_MAX} days after signup. Separately, ${NEW_SHOPPER_CHURN * 100}% of all new shoppers stop within 3-27 days whatever they do (realism; it scales both groups equally). Read: new shoppers who signed up by ${RET_BIRTH_END.slice(0, 10)} (so the bracket is complete); retained = any "listing viewed" on day ${RET_FROM}-${RET_TO - 1} after signup; non-savers over savers reads 1 - ${NON_SAVER_CHURN}.`,
		mixpanelReport: { type: "Retention", birth: "account created", return: "listing viewed", brackets: `custom: day ${RET_FROM}-${RET_TO - 1}`, breakdown: "user property saved_search_count > 0 (identical to the week-one savers for new shoppers), or a cohort from the converters of Funnels account created → saved search created, 7-day window", dateRange: `births ${D(DATASET_START)} to ${RET_BIRTH_END.slice(0, 10)}` },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H4_SQL },
				select: { n: { where: { grp: "non_saver" } }, s: { where: { grp: "saver" } } },
				expect: { metric: "n.retention / s.retention", op: "between", target: band(1 - NON_SAVER_CHURN) },
				minCohort: 800,
			},
		],
	},
	{
		id: "H5-speed-to-lead",
		hook: "H5",
		archetype: "cohort-prop-scale",
		narrative: `Speed to lead: when a shopper messages their Keystead agent about a listing ("agent contacted"), the agent's reply ("agent responded", response_minutes) decides whether a tour follows. The chance of a tour request for that listing declines smoothly with response time (logistic in log minutes centered at ${LEAD_CENTER_MIN} min; about ${Math.round(LEAD_RATE_EARLY * 100)}% for instant replies, about ${Math.round(LEAD_RATE_LATE * 100)}% for replies after many hours). Averaged over the response-time distribution (median ${RESPONSE_MEDIAN_MIN} min), replies within ${FAST_REPLY_MIN} minutes lead to a tour ${LEAD_RATE_FAST * 100}% of the time vs ${(LEAD_RATE_SLOW * 100).toFixed(1)}% after ${SLOW_REPLY_MIN} minutes (0.4x), for serious buyers; other shoppers tour half as often at every speed. Read: per reply (same listing_id), tour requested within ${LEAD_WINDOW_DAYS} days, replies through ${LEAD_READ_END.slice(0, 10)}, slow over fast.`,
		mixpanelReport: { type: "Funnels", steps: ["agent responded", "tour requested"], counting: "totals", holdPropertyConstant: "listing_id", window: `${LEAD_WINDOW_DAYS} days`, breakdown: `response_minutes (custom buckets ≤ ${FAST_REPLY_MIN}, ${FAST_REPLY_MIN}-${SLOW_REPLY_MIN}, > ${SLOW_REPLY_MIN})` },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H5_SQL },
				select: { s: { where: { grp: "slow" } }, f: { where: { grp: "fast" } } },
				expect: { metric: "s.tour_rate / f.tour_rate", op: "between", target: band(LEAD_RATE_SLOW / LEAD_RATE_FAST) },
				minCohort: 1000,
			},
		],
	},
	{
		id: "H6-paid-social-economics",
		hook: "H6",
		archetype: "external-join",
		narrative: `Paid social looks like the cheapest channel and is not. Warehouse marketing_spend_daily bills each paid channel: half of each day's spend is a paced budget (cost per signup x expected signups, weekday shape above a ${SPEND_FLAT_SHARE * 100}% floor), half is the bid x that day's delivered signups, with ±${SPEND_NOISE * 100}% seeded day noise: $${CPS_USD.paid_search} paid search, $${CPS_USD.paid_social} paid social, $${CPS_USD.youtube_ads} YouTube per Mixpanel signup. Paid social signups are serious buyers ${SOCIAL_SERIOUS_MULT}x as often (${Math.round(SERIOUS_SHARE.paid_social * 100)}% vs ${SERIOUS_BASE * 100}%), and only serious buyers apply for a pre-approval, so the share who start one within ${PREAPP_WINDOW_DAYS} days of signup is ${SOCIAL_SERIOUS_MULT}x every other channel's. Spend per pre-approval start is then level between paid social and paid search: (${CPS_USD.paid_social} / ${SOCIAL_SERIOUS_MULT}) / ${CPS_USD.paid_search} = ${SPEND_PER_START_RATIO}. Reads use signups before ${SIGNUP_READ_END.slice(0, 10)} (complete windows) and the spend on the same days. Paid social has only about 240 serious signups in that span, so the start-rate and spend-per-start reads use the knob as target with a half-effect bound.`,
		mixpanelReport: { type: "Insights + Funnels + warehouse", event: "account created", breakdown: "acquisition_channel", join: "marketing_spend_daily.spend_usd on date and acquisition_channel", funnel: `account created → pre-approval started, ${PREAPP_WINDOW_DAYS}-day window, breakdown acquisition_channel` },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H6_SQL },
				select: { s: { where: { grp: "paid_social" } }, p: { where: { grp: "paid_search" } } },
				expect: { metric: "s.spend_per_signup / p.spend_per_signup", op: "between", target: band(SPEND_PER_SIGNUP_RATIO) },
				minCohort: 500,
			},
			{
				breakdown: { type: "duckdb", sql: H6_SQL },
				select: { s: { where: { grp: "paid_social" } }, o: { where: { grp: "non_social" } } },
				// floor: half the knob's effect (1 - 0.5 x (1 - 0.4))
				expect: { metric: "s.start_rate / o.start_rate", op: "<=", target: SOCIAL_SERIOUS_MULT, floor: 1 - 0.5 * (1 - SOCIAL_SERIOUS_MULT) },
				minCohort: 500,
			},
			{
				breakdown: { type: "duckdb", sql: H6_SQL },
				select: { s: { where: { grp: "paid_social" } }, p: { where: { grp: "paid_search" } } },
				// floor: halfway from the per-signup ratio to the knob ratio
				expect: { metric: "s.spend_per_start / p.spend_per_start", op: ">=", target: SPEND_PER_START_RATIO, floor: Math.round((SPEND_PER_SIGNUP_RATIO + SPEND_PER_START_RATIO) / 2 * 1000) / 1000 },
				minCohort: 500,
			},
		],
	},
	{
		id: "H7-austin-feed-outage",
		hook: "H7",
		archetype: "bespoke",
		narrative: `From ${D(FEED_OUTAGE_START)} to ${D(FEED_OUTAGE_END)} (exclusive) the ${OUTAGE_MARKET} MLS feed is stale: no new ${OUTAGE_MARKET} listings arrive (they appear on ${D(FEED_OUTAGE_END)}), ${OUTAGE_MARKET} saved-search alerts stop, and ${OUTAGE_VIEW_DROP * 100}% of ${OUTAGE_MARKET} listing views do not happen (shoppers find nothing new). Other markets are untouched. Warehouse market_inventory_daily marks the days (feed_status = stale, new_listings = 0). Read: ${OUTAGE_MARKET} / other-market listing views on stale days over the same ratio on the ${INC_BASE_DAYS} days either side reads 1 - ${OUTAGE_VIEW_DROP}.`,
		mixpanelReport: { type: "Insights", event: "listing viewed", measure: "total", breakdown: "market", chart: "daily line", join: "market_inventory_daily.feed_status and new_listings" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H7_SQL },
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.did", op: "between", target: band(1 - OUTAGE_VIEW_DROP) },
				minCohort: 500,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
o AS (SELECT date::DATE AS d, market, new_listings FROM ${WH("market_inventory_daily")} WHERE feed_status = 'stale')
SELECT 'all' AS grp, count(*) AS stale_rows, sum(new_listings) AS stale_new_listings,
 (SELECT count(*) FROM ev JOIN o ON o.d = ev.t::DATE AND o.market = ev.market WHERE ev.event = 'listing alert sent') AS stale_alerts,
 (coalesce(sum(new_listings), 0) + (SELECT count(*) FROM ev JOIN o ON o.d = ev.t::DATE AND o.market = ev.market WHERE ev.event = 'listing alert sent'))::DOUBLE AS impure
FROM o`,
				},
				select: { a: { where: { grp: "all" } } },
				// exact: no new listings and no alerts in the stale market while the feed is down
				expect: { metric: "a.impure", op: "between", target: [0, 0] },
			},
		],
	},
	{
		id: "H8-payment-estimate-experiment",
		hook: "H8",
		archetype: "experiment-lift",
		narrative: `The "${EXPERIMENT_NAME}" test starts ${D(PAYMENT_EST_START)}: shoppers without a current pre-approval who have not applied in the window are split 50/50 (sticky per shopper) at their first listing view on or after the start ($experiment_started). The variant shows the estimated monthly payment on listing pages with a "Get pre-approved" link. For serious buyers who are ready to finance, the daily chance of starting a pre-approval on a browsing day is ${PAYMENT_EST_MULT}x after exposure (${PREAPP_DAILY_RATE * 100}% → ${(PREAPP_DAILY_RATE * PAYMENT_EST_MULT * 100).toFixed(0)}%); ${PAYMENT_EST_ENTRY_SHARE * 100}% of variant starts come from entry_point = payment_estimate, which never appears in Control or before the test. Read: share of exposed shoppers who start a pre-approval within ${EXP_WINDOW_DAYS} days of exposure (exposures through ${EXP_READ_END.slice(0, 10)}), variant over Control. Shoppers with several browsing days in the window saturate slightly, so the read sits at or a little under ${PAYMENT_EST_MULT}; about 300 Control starts make the knob the target with a half-effect floor.`,
		mixpanelReport: { type: "Funnels", steps: ["$experiment_started", "pre-approval started"], counting: "uniques", window: `${EXP_WINDOW_DAYS} days`, dateRange: `${D(PAYMENT_EST_START)} to ${EXP_READ_END.slice(0, 10)}`, breakdown: `user property "${EXP_KEY}" (or the Experiments report)` },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H8_SQL },
				select: { v: { where: { grp: EXPERIMENT_VARIANT } }, c: { where: { grp: "Control" } } },
				expect: { metric: "v.start_rate / c.start_rate", op: ">=", target: PAYMENT_EST_MULT, floor: 1 + 0.5 * (PAYMENT_EST_MULT - 1) },
				minCohort: 2000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 count(DISTINCT uid) FILTER (WHERE "Variant name" = '${EXPERIMENT_VARIANT}')::DOUBLE / count(DISTINCT uid) AS variant_share
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
 count(*) FILTER (WHERE entry_point = 'payment_estimate' AND (t < TIMESTAMP '${TS(PAYMENT_EST_START)}' OR v.variant IS DISTINCT FROM '${EXPERIMENT_VARIANT}')) AS impure
FROM ev LEFT JOIN v ON v.uid = ev.uid WHERE event = 'pre-approval started'`,
				},
				select: { a: { where: { grp: "all" } } },
				// exact: payment-estimate starts exist only in the variant after the start
				expect: { metric: "a.impure", op: "between", target: [0, 0] },
			},
		],
	},
	{
		id: "H9-time-to-offer-by-buyer-type",
		hook: "H9",
		archetype: "funnel-ttc-by-segment",
		narrative: `How fast a tour turns into an offer depends on who is buying (profile buyer_type): the gap from "tour completed" to "offer submitted" is ${BUYER_TTC_MULT.first_time}x for first_time buyers and ${BUYER_TTC_MULT.investor}x for investors, vs move_up buyers (median ${OFFER_GAP_MEDIAN_H} h, log-normal). Read: median hours from tour completed to offer submitted for the same listing_id within ${OFFER_WINDOW_DAYS} days (tours through ${OFFER_READ_END.slice(0, 10)}).`,
		mixpanelReport: { type: "Funnels", steps: ["tour completed", "offer submitted"], counting: "totals", holdPropertyConstant: "listing_id", window: `${OFFER_WINDOW_DAYS} days`, measure: "median time to convert", breakdown: "user property buyer_type" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H9_SQL },
				select: { f: { where: { grp: "first_time" } }, m: { where: { grp: "move_up" } } },
				expect: { metric: "f.med_hours / m.med_hours", op: "between", target: band(BUYER_TTC_MULT.first_time) },
				minCohort: 250,
			},
			{
				breakdown: { type: "duckdb", sql: H9_SQL },
				select: { i: { where: { grp: "investor" } }, m: { where: { grp: "move_up" } } },
				expect: { metric: "i.med_hours / m.med_hours", op: "between", target: band(BUYER_TTC_MULT.investor) },
				minCohort: 150,
			},
		],
	},
	{
		id: "H10-price-cuts-get-saved",
		hook: "H10",
		archetype: "cohort-prop-scale",
		narrative: `Price cuts get saved. About 38% of MLS listings take one price cut (2-7%) some weeks after they list; every event about a listing carries price_reduced as of that moment. A view of a listing with price_reduced = true becomes a "listing saved" ${REDUCED_SAVE_MULT}x as often as a view at the original price (a save decision is made on each view of a listing the shopper has not saved yet; ${REVISIT_SHARE * 100}% of views are revisits). Read: listing saved / listing viewed by price_reduced.`,
		mixpanelReport: { type: "Insights", events: ["listing saved", "listing viewed"], formula: "A / B", breakdown: "price_reduced" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H10_SQL },
				select: { r: { where: { grp: "reduced" } }, o: { where: { grp: "original" } } },
				expect: { metric: "r.save_rate / o.save_rate", op: "between", target: band(REDUCED_SAVE_MULT) },
				minCohort: 2000,
			},
		],
	},
];

export default config;
