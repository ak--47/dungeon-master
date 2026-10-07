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
 * NAME:       Driftway Travel
 * APP:        Hotel and vacation-rental booking app (iOS, Android, web) for US,
 *             UK, and Canadian travelers. Travelers search a destination and
 *             dates, view properties, start checkout, and book; Driftway earns
 *             a commission on each stay. Members collect Driftway Rewards
 *             (member / silver / gold). Flex Pay (book now, pay in four
 *             installments) launches 2026-07-14.
 * SCALE:      10,000 members (about 5,000 join inside the window), ~1.55M
 *             events, ~14K bookings, 120 days (2026-06-04 → 2026-10-01, UTC)
 * CORE LOOP:  destination searched → property viewed (1-12) → checkout started
 *             → booking completed → (booking cancelled | check in completed →
 *             review submitted)
 * VALUE MOMENT: booking completed
 *
 * EVENTS (16):
 *   property viewed > destination searched > notification received
 *   > filters applied > map viewed > wishlist saved > checkout started
 *   > price alert set > booking completed > check in completed
 *   > $experiment_started > support contacted > review submitted
 *   > account created > booking cancelled > payment failed
 *
 * FUNNELS (2 declared; the hook shapes every search session):
 *   - Signup (first funnel, born members): destination searched → property
 *     viewed ×2 → account created (anonymous browse, then sign up; 100%)
 *   - Trip search (weight 7): destination searched → property viewed →
 *     checkout started → booking completed, all sharing one search_id. Engine
 *     conversion is 100%; the everything hook decides the number of views
 *     (1-12), whether the session reaches checkout, and whether the checkout
 *     books. Carries the All-in Pricing experiment (multipliers 1.0; the hook
 *     applies the effect).
 *
 * USER PROPS:  traveler_segment (business / family / couple / solo, persona),
 *              home_market, age_band, acquisition_channel, rewards_tier,
 *              member_since, push_enabled, "Experiment: All-in Pricing"
 * SUPER PROPS: platform (ios / android / web, from the event's device os)
 * SCD PROPS:   none
 * GROUPS:      none
 * WAREHOUSE:   marketing_spend_daily (spend, clicks, impressions by paid
 *              channel), payment_gateway_daily (payment authorizations and
 *              gateway health by platform), destination_supply_daily (room
 *              nights booked across all channels, rooms listed, average daily
 *              rate, weather advisory by region)
 * LOOKUPS:     none — the property catalog (id, name, type, destination,
 *              region, stars, review_count, guest_rating, rate) is denormalized
 *              onto every view, checkout, and booking
 * SOUP:        Sunday/Monday-heavy dayOfWeekWeights; US evening + lunch
 *              hourOfDayWeights (UTC)
 *
 * IDENTITY: avgDevicePerUser 2 (a phone and often a computer). A new member's
 * first search and property views are anonymous (device_id only); "account
 * created" (isAuthEvent) carries user_id + device_id and stitches them. Every
 * other event carries user_id and device_id. platform agrees with the device os
 * (iOS / iPadOS → ios, Android → android, everything else → web).
 *
 * DESIGN NOTES:
 * - Search sessions: each engine Trip-search run is one session (search_id).
 *   The hook draws destination (region weights by segment), lead time and
 *   nights (by segment), 1-12 property views a few minutes apart (properties
 *   from that destination's catalog), the search → booking time (H6), and
 *   then: P(checkout) = BASE_CHECKOUT x member propensity (log-normal, mean 1,
 *   truncated at 3x so no session's checkout chance reaches 1 even with every
 *   lift applied) x review-count factor of the last property viewed (H8) x sale (H10) x
 *   All-in variant (H5) x hurricane (H9) x (a small member-specific factor,
 *   mean 0.08, for low-intent TikTok signups, H3); P(book | checkout) =
 *   BASE_BOOK x Flex Pay (H1) x All-in variant (H5), and web checkouts fail
 *   during the payment gateway incident (H2; the gateway authorizes every web
 *   payment method: cards, wallets, and PayPal). A failed checkout sometimes logs
 *   "payment failed" (gateway_timeout during the incident). The traveler picks
 *   the rate type at checkout: non-refundable is 10% below the free-
 *   cancellation rate.
 * - Catalog: 28 destinations x 24 properties (property_id prefix = a unique
 *   destination code; names unique within a destination). 30% of listings go
 *   live between 40 days before and 110 days into the window with no reviews;
 *   review_count is the page's count on the day of the event and grows at a
 *   per-listing pace (faster at busy destinations, always ahead of Driftway's
 *   own reviews of that listing).
 * - Booking lifecycle: cancellation by lead time and rate type (H4), Caribbean
 *   weather cancellations (H9), a trip reminder the day before check-in (push,
 *   or email for members who turned push off),
 *   check-in on the stay's first day (18:00-23:55 UTC, on check_in_date), a
 *   review 12 h-6 days after checkout for
 *   55% of stays. Support contacts follow cancellations (30%) and failed
 *   payments (20%), plus a trickle of other questions.
 * - Window start: members who joined before June 4 hold stays booked in the
 *   180 days before the window (at their in-window booking rate), so June
 *   check-ins, reviews, and cancellations do not ramp from zero; search
 *   sessions they began in the 10 days before June 4 still check out and book
 *   on the first days, so June 4 checkouts are not light. A new traveler whose
 *   signup would fall past the window end has no account and no events.
 * - Wishlists and price alerts follow the destination the member searched
 *   most recently. member_since is the UTC date of "account created" (the
 *   profile's created time is the first anonymous visit, minutes earlier).
 * - Server-side messages: a weekly deals email (Thursdays) to members on the
 *   marketing list, sale emails/pushes, and trip reminders keep arriving for
 *   members who stopped using the app.
 * - Warehouse drift: payment_gateway_daily approvals are Mixpanel bookings x
 *   0.93-1.17 by day (date-change re-authorizations, members who opted out of
 *   analytics, dropped SDK calls) and attempts are approvals / the day's
 *   approval rate (declines, timeouts, retries); destination_supply_daily counts
 *   partner-channel room nights the app never sees; spend is half a paced
 *   budget (weekday shape, never zero) and half bid x the day's delivered
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
 * H1. FLEX PAY LAUNCH (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-07-14, checkout → booking conversion is 1.2x (50% →
 *   60%); 35% of bookings pay with payment_method = flex_pay.
 * MIXPANEL: Insights, booking completed / checkout started, weekly;
 *   Jun 4-Jul 13 vs Jul 14-Aug 17; breakdown payment_method.
 * REAL WORLD: installments lower the pain of a big up-front payment.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H2. WEB PAYMENT GATEWAY INCIDENT (everything + warehouse payment_gateway_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-08-18 to 2026-08-21, 55% of web checkouts fail whatever the
 *   payment method (most log payment failed / gateway_timeout); apps
 *   untouched. The warehouse shows gateway_status = degraded for web on those
 *   days, approval_rate 0.45x the web's normal rate (about 0.42 vs 0.92);
 *   attempts derive from approvals / approval rate, so attempt volume stays
 *   near normal.
 * MIXPANEL: Insights, booking completed / checkout started, daily, breakdown
 *   platform; web/app ratio on degraded days vs 14 days either side; join
 *   payment_gateway_daily.gateway_status.
 * REAL WORLD: a payment provider outage looks like "people stopped booking".
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H3. PAID CHANNEL ECONOMICS (first funnel + warehouse marketing_spend_daily;
 *     external-table join)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: spend per Mixpanel signup $26 Google Hotel Ads, $14 Meta, $10
 *   TikTok; about 59% of TikTok signups are browsers whose checkout chance is
 *   a member-specific fraction (log-normal, mean 0.08) of an ordinary
 *   member's, so TikTok's 30-day booker rate is 0.5x every other channel (the
 *   knob; the browser share is derived from it) and spend per booker is
 *   (10 / 0.5) / 14 = 1.43x Meta's.
 * MIXPANEL: Funnels, account created → booking completed, 30-day window,
 *   breakdown acquisition_channel, joined to marketing_spend_daily.spend_usd.
 * REAL WORLD: cheap social signups are browsers, not bookers.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H4. LEAD TIME DRIVES CANCELLATIONS (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: cancellation probability 6% (0-6 days lead), 15% (7-29), 27%
 *   (30-59), 40% (60+), x0.25 on a non-refundable rate (30% of bookings,
 *   independent of the traveler); log-normal 4 days after booking, within 30
 *   days and before check-in.
 * MIXPANEL: Funnels, booking completed → booking cancelled (reason ≠
 *   weather), Totals, hold booking_id constant, 30-day window, bookings
 *   Jun 4-Aug 31, breakdown lead_time_days buckets and refundable.
 * REAL WORLD: plans made months out change; a non-refundable rate commits.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H5. ALL-IN PRICING EXPERIMENT (Trip search experiment + everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-08-25 members split 50/50; the variant shows taxes and
 *   fees up front. Search → checkout is 0.85x, checkout → booking is 1.3x;
 *   net bookings per search ≈ 1.1x by design. Arms are hashed per member, so
 *   per-session rates also carry each arm's member mix (members differ a lot
 *   in how often they book); compare with the same arms before the start.
 *   One exposure per member: the engine places it 1 s before the member's
 *   first search on or after the start; the hook moves it to the first
 *   search that still happens when H9 removes that search, and drops it for
 *   a member who left (H7) before any.
 * MIXPANEL: Funnels, destination searched → checkout started → booking
 *   completed, Totals, hold search_id constant, 7-day window, Aug 25-Sep 23,
 *   breakdown "Experiment: All-in Pricing" (or the Experiments report).
 * REAL WORLD: drip pricing wins the click and loses the sale.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H6. BOOKING SPEED BY TRAVELER SEGMENT (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: search → booking time per session is log-normal (median 4 h for
 *   couples and solo travelers), x0.5 for business travelers, x1.8 for
 *   families.
 * MIXPANEL: Funnels, destination searched → booking completed, Totals, hold
 *   search_id constant, 14-day window, searches through Sep 16, median time
 *   to convert, breakdown traveler_segment.
 * REAL WORLD: a work trip is booked between meetings; a family vacation is a
 *   group decision.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H7. A BAD STAY COSTS A CUSTOMER (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: after a review rated 1-2 stars the member stops planning trips
 *   with probability 0.5, 1-3 days later (stays already booked still happen;
 *   server-side messages continue).
 * MIXPANEL: Retention, birth review submitted (first time), return
 *   destination searched, custom bracket day 7-29, breakdown rating.
 * REAL WORLD: travelers blame the booking site for a bad hotel.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H8. REVIEW-COUNT THRESHOLD (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: a session reaches checkout with a factor by the review_count the
 *   last property viewed showed on that day. The factor ramps smoothly
 *   (logistic in ln reviews) around 10 and 50 reviews; its plateaus are
 *   solved at load so the bucket averages over property views are 0-9
 *   reviews 0.4, 10-49 0.75, 50+ 1.0 (the knobs). New listings keep the
 *   low bucket supplied all window, so the pooled read is not confounded
 *   with the sale (June) or the All-in test (September).
 * MIXPANEL: Insights, checkout started / property viewed, breakdown
 *   review_count (custom buckets 0-9, 10-49, 50+).
 * REAL WORLD: nobody wants to be a listing's first guest.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H9. HURRICANE DELIA (everything + warehouse destination_supply_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-09-09 to 2026-09-13 (weather_advisory = hurricane_warning for
 *   the caribbean region as the storm tracks west; rooms_listed x0.6): Caribbean searches 0.5x, Caribbean
 *   checkouts per search 0.25x, and 70% of Caribbean stays checking in during
 *   the warnings (booked before Sep 7) cancel Sep 7-9 with reason weather.
 * MIXPANEL: Insights, destination searched and checkout started by region,
 *   daily; join destination_supply_daily.weather_advisory; booking cancelled
 *   by cancellation_reason.
 * REAL WORLD: a named storm empties a region's bookings for a week.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H10. SUMMER KICKOFF SALE (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-06-24 to 2026-06-28 every stay is 15% off (nightly_rate;
 *   promo_code = SUMMERKICKOFF); launch and reminder emails (Jun 24, Jun 27)
 *   plus pushes to members who allow push; 12% of pushed members move their
 *   next search up. Search sessions reach checkout 1.4x as often.
 * MIXPANEL: Insights, checkout started / destination searched and average
 *   nightly_rate on booking completed, daily, Jun 10-Jul 12; notification
 *   received by campaign.
 * REAL WORLD: a sale converts browsers who were waiting for a deal.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * EXPECTED METRICS SUMMARY (measured: data/verify-travel, 2026-10-07, full fidelity,
 * 10,000 members, 1,551,549 events)
 * ═════════════════════════════════════════════════════════════════════════
 * Hook | Metric                                            | Derivation                 | Expected | Measured
 * -----|---------------------------------------------------|----------------------------|----------|---------
 * H1   | booking per checkout, after/before Jul 14         | FLEX_LIFT                  | 1.20     | 1.211 (50.0% → 60.5%)
 * H1   | Flex Pay share of bookings after launch           | FLEX_SHARE                 | 0.35     | 0.356
 * H2   | web/app booking per checkout, incident / ±14 d    | 1 − WEB_FAIL (≤, ceil 0.725)| 0.45    | 0.391
 * H2   | web approval_rate, degraded / operational (wh)    | 1 − WEB_FAIL               | 0.45     | 0.452 (0.416 vs 0.921)
 * H3   | spend per signup, TikTok / Meta                   | 10 / 14                    | 0.714    | 0.719 ($9.90 vs $13.77)
 * H3   | 30-day booker rate, TikTok / other channels       | TIKTOK_BOOKER_RATIO (≤, ceil 0.75) | 0.50 | 0.474 (22.4% vs 47.3%)
 * H3   | spend per booker, TikTok / Meta                   | (10 / 0.5) / 14 (≥, floor 1.21) | 1.429 | 1.399 ($44.13 vs $31.55)
 * H4   | 30-day cancel rate, 60+ / 7-29 days lead          | 0.40 / 0.15 (≥, floor 1.83)| 2.667    | 2.504
 * H4   | 30-day cancel rate, 30-59 / 7-29 days lead        | 0.27 / 0.15 (≥, floor 1.4) | 1.80     | 1.781
 * H4   | 30-day cancel rate, non-refundable / refundable   | 0.25 (≤, ceil 0.625)       | 0.25     | 0.212
 * H5   | search → checkout (7 d), variant / control        | ALLIN_CHECKOUT_MULT        | 0.85     | 0.871
 * H5   | checkout → booking (7 d), variant / control       | ALLIN_BOOK_MULT            | 1.30     | 1.284
 * H5   | variant share of exposed members                  | equal 2-arm hash           | 0.50     | 0.496
 * H6   | median search → booking, business / couple+solo   | SEGMENT_GAP_MULT.business  | 0.50     | 0.495 (1.99 h vs 4.02 h)
 * H6   | median search → booking, family / couple+solo     | SEGMENT_GAP_MULT.family    | 1.80     | 1.851 (7.44 h)
 * H7   | day 7-29 return, first review 1-2★ / 3-5★         | 1 − BAD_STAY_CHURN (≤, ceil 0.75) | 0.50 | 0.496 (47.0% vs 94.8%)
 * H8   | checkout per view, 0-9 / 50+ reviews              | REVIEW_CHECKOUT_K["0-9"]   | 0.40     | 0.388
 * H8   | checkout per view, 10-49 / 50+ reviews            | REVIEW_CHECKOUT_K["10-49"] | 0.75     | 0.746
 * H9   | Caribbean / other searches, warning / ±14 d       | HURRICANE_SEARCH_KEEP (≤, ceil 0.75) | 0.50 | 0.482
 * H9   | Caribbean / other checkout per search, warning / ±14 d | HURRICANE_CHECKOUT_K (≤, ceil 0.625) | 0.25 | 0.196
 * H9   | warehouse rooms_listed, warning / normal Caribbean | HURRICANE_ROOMS_K         | 0.60     | 0.604
 * H10  | checkout per search, sale / ±14 d                 | SALE_CHECKOUT_LIFT         | 1.40     | 1.399 (11.1% → 15.6%)
 * H10  | average booked nightly_rate, sale / ±14 d         | 1 − SALE_DISCOUNT          | 0.85     | 0.839 ($209 vs $249)
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Noise notes: the reads marked ≤ / ≥ rest on a few hundred events or fewer
 * (113 web bookings from 467 web checkouts on 4 incident days, where the web
 * baseline itself is 62% against the app's 64%; about 110 non-refundable
 * cancellations; 727 TikTok signups; 402 members whose first review was bad;
 * 642 Caribbean searches and 14 Caribbean checkouts on warning days), so they
 * use the knob as target with a half-effect floor or ceiling: NAILED inside
 * knob ±10%, STRONG beyond (H2 reads past the knob: 0.391). 70% of storm-window
 * Caribbean stays cancelled for weather is not asserted (43 of 60 eligible
 * stays, 0.72). H5 arms are hashed per member and members differ in booking
 * appetite, so arm-level session rates carry member mix (here the arms matched
 * before the test: 1.03x net bookings per search Jul 14-Aug 17; 1.12x during
 * it). Checkout → booking splits by any user-level attribute (platform,
 * market) after Aug 25 inherit the All-in Pricing arm mix of that subgroup;
 * they are not engineered and are not independent per checkout.
 *
 * Activity levels (owner decision; engagement sits above a typical hotel app):
 * 21.6 searches per active member in 120 days, 6.6% of search sessions end
 * in a booking, 59% of active members booked, 42% of new members book within
 * 30 days, 94% of members searched on or after Aug 25. The keenest member
 * checks out on at most 69% of their searches (propensity cap); the most
 * bookings by one member is 26 (a business traveler).
 */

// ── SCALE ──
const SEED = "dm4-travel";
const NUM_USERS = 10_000;
const DATASET_START = "2026-06-04T00:00:00Z";
const DATASET_END = "2026-10-01T23:59:59Z"; // 120 days
const EVENTS_PER_DAY = 1.2;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── TIMELINE (shared by hooks, stories, SQL, warehouse columns, guides) ──
const SALE_START = "2026-06-24T00:00:00Z";             // "Summer Kickoff Sale" (15% off every stay) starts
const SALE_END = "2026-06-29T00:00:00Z";               // exclusive (5 days: Jun 24-28)
const SALE_PUSH_TIMES = ["2026-06-24T15:00:00Z", "2026-06-27T15:00:00Z"]; // launch + reminder (email, plus push to opted-in members)
const FLEX_PAY_LAUNCH = "2026-07-14T00:00:00Z";        // Flex Pay (book now, pay in 4 installments) launches
const PAYMENT_INCIDENT_START = "2026-08-18T00:00:00Z"; // payment gateway incident (web checkouts) starts
const PAYMENT_INCIDENT_END = "2026-08-22T00:00:00Z";   // exclusive (4 days: Aug 18-21)
const ALLIN_START = "2026-08-25T00:00:00Z";            // "All-in Pricing" A/B test starts
const HURRICANE_START = "2026-09-09T00:00:00Z";        // Hurricane Delia warnings for the Caribbean
const HURRICANE_END = "2026-09-14T00:00:00Z";          // exclusive (5 days: Sep 9-13)
const HURRICANE_CANCEL_FROM = "2026-09-07T00:00:00Z";  // weather cancellations start when the forecast track firms up

const TIKTOK_START = "2026-03-02T00:00:00Z";          // TikTok ads go live (before the window; spring 2026)
const ms = (iso) => dayjs.utc(iso).valueOf();
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;
const WINDOW_DAYS = 120;

// ── WEEKLY AND DAILY RHYTHM (soup) ──
// Sun..Sat. Trip planning peaks Sunday and Monday; Friday is the quietest day.
const DOW_WEIGHTS = [1.12, 1.1, 1.04, 1.0, 0.96, 0.84, 0.92];
// UTC hours. Mostly US travelers (evenings ET-PT = 23-06 UTC, lunch 16-19 UTC),
// plus UK and Canada.
const HOUR_WEIGHTS = [0.95, 0.92, 0.85, 0.72, 0.55, 0.38, 0.26, 0.2, 0.22, 0.3, 0.4, 0.5,
	0.58, 0.66, 0.74, 0.82, 0.88, 0.9, 0.88, 0.84, 0.82, 0.85, 0.9, 0.95];

// ── KNOBS ──
// Trip-search funnel base rates (per search session)
const BASE_CHECKOUT = 0.16;         // search session → checkout started (before the review-count factor)
const BASE_BOOK = 0.5;              // checkout started → booking completed
const PROPENSITY_SIGMA = 0.9;       // per-member booking propensity (log-normal, mean 1) scales the checkout chance
const PROPENSITY_CAP = 3;           // the keenest member's propensity (x the mean): the checkout chance stays below 1 with every lift applied
const SEARCH_TO_BOOK_MEDIAN_H = 4;  // log-normal time from search to booking (couple / solo travelers)
const SEARCH_TO_BOOK_SIGMA = 1.5;
const SEARCH_TO_BOOK_MAX_H = 240;

// H1 Flex Pay launch: checkout → booking conversion lifts
const FLEX_LIFT = 1.2;
const FLEX_SHARE = 0.35;            // share of post-launch bookings paid with Flex Pay

// H2 web payment incident (warehouse payment_gateway_daily)
const WEB_FAIL = 0.55;              // share of web checkouts whose payment fails during the incident (any payment method)
const INCIDENT_ERROR_EVENT = 0.8;   // failed incident checkouts that log "payment failed"
const BASE_ERROR_EVENT = 0.12;      // ordinary abandoned checkouts that log "payment failed"

// H3 paid channel economics (warehouse marketing_spend_daily)
const PAID_CHANNELS = ["google_hotel_ads", "meta_ads", "tiktok_ads"];
const CPA_USD = { google_hotel_ads: 26, meta_ads: 14, tiktok_ads: 10 }; // window spend per Mixpanel signup
const CHANNEL_WEIGHTS = { organic: 28, google_hotel_ads: 20, meta_ads: 20, tiktok_ads: 20, referral: 7, email: 5 };
const TIKTOK_BOOKER_RATIO = 0.5;    // TikTok 30-day booker rate / every other channel (the H3 knob)
const LOW_INTENT_PROPENSITY = 0.08; // low-intent members' mean checkout-propensity multiplier (log-normal, salted per member)
const LOW_INTENT_SIGMA = 0.6;
const LOW_INTENT_BOOKER_REL = 0.15; // 30-day booker rate of a low-intent member relative to other members at that multiplier
const TIKTOK_LOW_INTENT_SHARE = (1 - TIKTOK_BOOKER_RATIO) / (1 - LOW_INTENT_BOOKER_REL); // ≈ 0.59
const BORN_PCT = 50;
const SPEND_PLAN_SHARE = 0.5;
const SPEND_FLAT_SHARE = 0.4;
const SPEND_NOISE = 0.12;
const CPC_USD = { google_hotel_ads: 1.9, meta_ads: 1.1, tiktok_ads: 0.6 };
const CTR = { google_hotel_ads: 0.045, meta_ads: 0.012, tiktok_ads: 0.008 };
const PLATFORM_SIGNUP_INFLATION = 1.2; // networks claim more signups than Mixpanel records
const AGE_WEIGHTS = { "18-24": 12, "25-34": 31, "35-44": 27, "45-54": 18, "55-64": 9, "65+": 3 };
const TIKTOK_AGE_WEIGHTS = { "18-24": 30, "25-34": 38, "35-44": 18, "45-54": 9, "55-64": 4, "65+": 1 };

// H4 cancellations by lead time and rate type
const LEAD_BUCKETS = ["0-6", "7-29", "30-59", "60+"];
const leadBucket = (d) => (d <= 6 ? "0-6" : d <= 29 ? "7-29" : d <= 59 ? "30-59" : "60+");
const CANCEL_RATE = { "0-6": 0.06, "7-29": 0.15, "30-59": 0.27, "60+": 0.4 };
const NONREFUNDABLE_CANCEL_MULT = 0.25;
const CANCEL_MEDIAN_DAYS = 4;
const CANCEL_MAX_DAYS = 30;

// H5 All-in Pricing experiment
const ALLIN_EXPERIMENT = "All-in Pricing";
const ALLIN_VARIANT = "All-in Pricing";
const EXP_KEY = `Experiment: ${ALLIN_EXPERIMENT}`;
const ALLIN_CHECKOUT_MULT = 0.85;   // fewer sessions reach checkout when the full price shows up front
const ALLIN_BOOK_MULT = 1.3;        // fewer checkout surprises

// H6 booking speed by traveler segment (search → checkout gap)
const SEGMENT_GAP_MULT = { business: 0.5, family: 1.8, couple: 1, solo: 1 };

// H7 a bad stay costs a customer
const BAD_RATING_MAX = 2;
const BAD_STAY_CHURN = 0.5;
const CHURN_DAY_MIN = 1;
const CHURN_DAY_MAX = 3;
const REVIEW_RATE = 0.55;
const RATING_WEIGHTS = { 1: 7, 2: 10, 3: 18, 4: 33, 5: 32 };

// H8 review-count threshold: checkout chance by the property's review count when viewed.
// The knob is each bucket's AVERAGE factor; the factor itself ramps smoothly
// (logistic in log review count) around 10 and 50 reviews (see reviewFactor below).
const REVIEW_BUCKETS = ["0-9", "10-49", "50+"];
const reviewBucket = (n) => (n <= 9 ? "0-9" : n <= 49 ? "10-49" : "50+");
const REVIEW_CHECKOUT_K = { "0-9": 0.4, "10-49": 0.75, "50+": 1 };
const REVIEW_RAMP_WIDTH = 0.18;
const NEW_LISTING_SHARE = 0.3;      // catalog share listed during (or just before) the window, starting with no reviews     // logistic width in ln(reviews): the factor moves over roughly 7-15 and 35-75 reviews

// H9 Hurricane Delia (warehouse destination_supply_daily)
const HURRICANE_REGION = "caribbean";
const HURRICANE_SEARCH_KEEP = 0.5;  // Caribbean search sessions that still happen during warnings
const HURRICANE_CHECKOUT_K = 0.25;  // Caribbean search sessions that still reach checkout during warnings
const HURRICANE_CANCEL = 0.7;       // Caribbean stays checking in Sep 9-13 cancelled for weather
const HURRICANE_ROOMS_K = 0.6;      // rooms partners keep listed during warnings

// H10 Summer Kickoff Sale
const SALE_DISCOUNT = 0.15;
const SALE_CHECKOUT_LIFT = 1.4;
const SALE_PUSH_RESPONSE = 0.12;    // pushed members whose next search moves up to right after the push
const PROMO_CODE = "SUMMERKICKOFF";
const EMAIL_OPTIN_SHARE = 0.78;     // members subscribed to marketing email (the push goes to those who also allow push)

// window start: stays booked before June 4 still check in during the window
const PREWINDOW_DAYS = 180;
const CARRY_IN_DAYS = 10;           // search sessions begun up to 10 days before June 4 can still book in the window
const TAX_FEE_RATE = 0.16;
// support contacts follow real problems: cancellations and failed payments, plus a trickle of other questions
const SUPPORT_BACKGROUND_KEEP = 0.2;
const SUPPORT_AFTER_CANCEL = 0.3;
const SUPPORT_AFTER_PAYMENT_FAIL = 0.2;

// ── CATALOG (denormalized onto events; deterministic) ──
const REGIONS = {
	us_cities: { weight: 28, dest: { "New York": 260, Chicago: 190, "San Francisco": 240, "Las Vegas": 150, Nashville: 210, "New Orleans": 180 } },
	us_beaches: { weight: 22, dest: { "Miami Beach": 230, "San Diego": 220, "Myrtle Beach": 150, Honolulu: 290, "Outer Banks": 200 } },
	mountains: { weight: 14, dest: { Denver: 170, Asheville: 180, "Lake Tahoe": 240, "Park City": 250, Banff: 260 } },
	caribbean: { weight: 16, dest: { Cancun: 210, "Punta Cana": 190, "Montego Bay": 200, Nassau: 240, "San Juan": 180, "Turks and Caicos": 260 } },
	europe: { weight: 20, dest: { London: 230, Paris: 240, Barcelona: 190, Lisbon: 160, Rome: 200, Amsterdam: 210 } },
};
const SEGMENT_REGION_MULT = {
	business: { us_cities: 3, us_beaches: 0.5, mountains: 0.5, caribbean: 0.2, europe: 1.2 },
	family: { us_cities: 0.7, us_beaches: 1.5, mountains: 1.2, caribbean: 1.2, europe: 0.6 },
	couple: { us_cities: 1, us_beaches: 1, mountains: 1, caribbean: 1.3, europe: 1.2 },
	solo: { us_cities: 1.2, us_beaches: 0.8, mountains: 1, caribbean: 0.8, europe: 1.4 },
};
const DEST_REGION = {};
const DEST_BASE_RATE = {};
for (const [r, { dest }] of Object.entries(REGIONS)) for (const [d, rate] of Object.entries(dest)) { DEST_REGION[d] = r; DEST_BASE_RATE[d] = rate; }
const DESTINATIONS = Object.keys(DEST_REGION);
const PROPERTY_TYPES = { hotel: 55, resort: 12, vacation_rental: 23, boutique_hotel: 10 };
const TYPE_RATE_MULT = { hotel: 1, resort: 1.45, vacation_rental: 1.15, boutique_hotel: 1.2 };
const NAME_A = ["Harbor", "Juniper", "Saltwater", "Copper", "Lantern", "Meridian", "Willow", "Cedar", "Coral", "Granite", "Bluebird", "Palm", "Summit", "Riverstone", "Marigold", "Driftwood", "Ivy", "Anchor", "Sterling", "Golden"];
const NAME_B = { hotel: ["Hotel", "Inn", "Suites", "House"], resort: ["Resort", "Beach Resort", "Resort & Spa"], vacation_rental: ["Cottage", "Loft", "Villa", "Retreat"], boutique_hotel: ["Boutique Hotel", "Hotel & Bar", "Lodge"] };
const pickWeightedR = (obj, r) => {
	const entries = Object.entries(obj);
	const total = entries.reduce((s, [, w]) => s + w, 0);
	let acc = 0;
	for (const [k, w] of entries) {
		acc += w / total;
		if (r < acc) return k;
	}
	return entries[entries.length - 1][0];
};
// property_id prefix: one unique code per destination (airport or city code)
const DEST_CODE = {
	"New York": "NYC", Chicago: "CHI", "San Francisco": "SFO", "Las Vegas": "LAS", Nashville: "BNA", "New Orleans": "MSY",
	"Miami Beach": "MIA", "San Diego": "SAN", "Myrtle Beach": "MYR", Honolulu: "HNL", "Outer Banks": "OBX",
	Denver: "DEN", Asheville: "AVL", "Lake Tahoe": "TVL", "Park City": "PKC", Banff: "BNF",
	Cancun: "CUN", "Punta Cana": "PUJ", "Montego Bay": "MBJ", Nassau: "NAS", "San Juan": "SJU", "Turks and Caicos": "PLS",
	London: "LON", Paris: "PAR", Barcelona: "BCN", Lisbon: "LIS", Rome: "ROM", Amsterdam: "AMS",
};
// traffic share of a destination relative to the average destination (region weight
// spread over its destinations): busier destinations collect reviews faster
const DEST_TRAFFIC = Object.fromEntries(DESTINATIONS.map((d) => [d, (REGIONS[DEST_REGION[d]].weight / Object.keys(REGIONS[DEST_REGION[d]].dest).length) / (Object.values(REGIONS).reduce((a, r) => a + r.weight, 0) / DESTINATIONS.length)]));
const PROPERTIES_BY_DEST = {};
for (const d of DESTINATIONS) {
	const list = [];
	const names = new Set();
	for (let i = 0; i < 24; i++) {
		const k = `prop|${d}|${i}`;
		const type = pickWeightedR(DEST_REGION[d] === "caribbean" ? { ...PROPERTY_TYPES, resort: 40 } : PROPERTY_TYPES, hashFloat(`${k}|type`));
		// partners keep adding listings: NEW_LISTING_SHARE of the catalog goes live on a
		// date between 40 days before and 110 days into the window with no reviews; the
		// rest were listed long ago (review count on June 4 log-normal around 45). Every
		// listing gains reviews from Driftway guests and every other booking channel,
		// faster at busier destinations.
		const isNew = hashFloat(`${k}|new`) < NEW_LISTING_SHARE;
		const listedMs = isNew ? Date.parse(DATASET_START) + Math.floor(-40 + 150 * hashFloat(`${k}|listed`)) * DAY_MS : -Infinity;
		const z = Math.sqrt(-2 * Math.log(Math.max(1e-9, hashFloat(`${k}|rc1`)))) * Math.cos(2 * Math.PI * hashFloat(`${k}|rc2`));
		const reviews0 = isNew ? 0 : Math.max(0, Math.round(Math.exp(Math.log(45) + 1.0 * z)));
		const reviewsPerDay = DEST_TRAFFIC[d] * (0.15 + 0.2 * hashFloat(`${k}|rpd`));
		const stars = type === "vacation_rental" ? 0 : type === "resort" ? 4 + Math.round(hashFloat(`${k}|st`)) : 2 + Math.floor(hashFloat(`${k}|st`) * 3.2);
		const rate = Math.round(DEST_BASE_RATE[d] * TYPE_RATE_MULT[type] * (0.75 + 0.5 * hashFloat(`${k}|rate`)) * (stars >= 4 ? 1.2 : 1));
		// names are unique within a destination
		let name = null;
		for (let tries = 0; !name || names.has(name); tries++) {
			const nameA = NAME_A[Math.floor(hashFloat(`${k}|na|${tries}`) * NAME_A.length)];
			const nameB = NAME_B[type][Math.floor(hashFloat(`${k}|nb|${tries}`) * NAME_B[type].length)];
			name = `${nameA} ${nameB} ${d}`;
		}
		names.add(name);
		list.push({
			property_id: `DW-${DEST_CODE[d]}-${1000 + i * 37 + Math.floor(hashFloat(`${k}|id`) * 30)}`,
			property_name: name,
			property_type: type,
			destination: d,
			region: DEST_REGION[d],
			star_rating: stars,
			listedMs,
			reviews0,
			reviewsPerDay,
			guest_rating: Math.round((3.6 + 1.3 * hashFloat(`${k}|gr`)) * 10) / 10,
			base_rate: rate,
		});
	}
	PROPERTIES_BY_DEST[d] = list;
}
// review count shown on the property page at time t (a daily snapshot, counted from
// June 4 or from the listing date)
const reviewsAt = (p, t) => p.reviews0 + Math.floor(p.reviewsPerDay * Math.max(0, Math.floor((t - Math.max(p.listedMs, Date.parse(DATASET_START))) / DAY_MS)));
// properties a traveler can find at time t (listed by then)
const listedAt = (d, t) => PROPERTIES_BY_DEST[d].filter((p) => p.listedMs <= t);
const guestRatingAt = (p, t) => (reviewsAt(p, t) === 0 ? 0 : p.guest_rating);

// H8 factor: two logistic steps in ln(reviews + 1) at 10 and 50 reviews, with plateau
// levels solved so each bucket's average factor over property views (every property
// and day of the window, weighted by destination traffic) equals REVIEW_CHECKOUT_K.
const reviewSteps = (n) => {
	const x = Math.log(n + 1);
	const s1 = 1 / (1 + Math.exp(-(x - Math.log(10.5)) / REVIEW_RAMP_WIDTH));
	const s2 = 1 / (1 + Math.exp(-(x - Math.log(50.5)) / REVIEW_RAMP_WIDTH));
	return [1 - s1, s1 - s2, s2]; // basis weights on the low, middle, and high plateaus
};
const REVIEW_PLATEAUS = (() => {
	const M = Object.fromEntries(REVIEW_BUCKETS.map((b) => [b, [0, 0, 0, 0]]));
	for (const [r, { weight, dest }] of Object.entries(REGIONS)) {
		const w = weight / Object.keys(dest).length;
		for (const d of Object.keys(dest)) for (const p of PROPERTIES_BY_DEST[d]) for (let day = 0; day < WINDOW_DAYS; day++) {
			const t = Date.parse(DATASET_START) + day * DAY_MS;
			if (p.listedMs > t) continue;
			const n = reviewsAt(p, t);
			const m = M[reviewBucket(n)];
			reviewSteps(n).forEach((v, i) => { m[i] += w * v; });
			m[3] += w;
		}
	}
	// solve A x = K (3x3, Cramer's rule); row b = bucket b's mean basis weights
	const A = REVIEW_BUCKETS.map((b) => M[b].slice(0, 3).map((v) => v / M[b][3]));
	const K = REVIEW_BUCKETS.map((b) => REVIEW_CHECKOUT_K[b]);
	const det3 = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
	const D0 = det3(A);
	return [0, 1, 2].map((j) => det3(A.map((row, i) => row.map((v, c) => (c === j ? K[i] : v)))) / D0);
})();
const reviewFactor = (n) => reviewSteps(n).reduce((s, v, i) => s + v * REVIEW_PLATEAUS[i], 0);

// member propensity: a log-normal truncated at PROPENSITY_CAP x its mean. Solve the
// truncation point a (in standard-normal z) and the truncated mean at load, so the
// draw exp(sigma z) / mean has mean 1 and a ceiling of PROPENSITY_CAP.
const PROPENSITY_TRUNC = (() => {
	const meanExp = (a) => {
		let num = 0, den = 0;
		for (let z = -8; z <= a; z += 0.002) { const w = Math.exp(-z * z / 2); num += w * Math.exp(PROPENSITY_SIGMA * z); den += w; }
		return num / den;
	};
	let lo = 0, hi = 6;
	for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (Math.exp(PROPENSITY_SIGMA * m) / meanExp(m) > PROPENSITY_CAP) hi = m; else lo = m; }
	return { a: lo, mean: meanExp(lo) };
})();
// highest checkout chance any session can have (propensity cap, top review plateau, sale lift)
if (BASE_CHECKOUT * PROPENSITY_CAP * Math.max(...REVIEW_PLATEAUS) * SALE_CHECKOUT_LIFT >= 1) throw new Error("travel: checkout chance can reach 1; lower PROPENSITY_CAP");

// ── SEGMENTS ──
const SEGMENTS = ["business", "family", "couple", "solo"];
const LEAD = { business: [6, 0.8, 60], family: [50, 0.7, 180], couple: [24, 0.9, 180], solo: [14, 1.0, 150] }; // median days, sigma, cap
const NIGHTS = { business: [1, 3], family: [4, 8], couple: [2, 5], solo: [2, 6] };
const GUESTS = { business: [1, 1], family: [3, 5], couple: [2, 2], solo: [1, 1] };
const REFUNDABLE_SHARE = 0.7;       // share of bookings on a free-cancellation rate (same for every traveler)
const NONREFUNDABLE_DISCOUNT = 0.1; // the non-refundable rate is 10% below the free-cancellation rate
const VIEW_COUNT_WEIGHTS = { 1: 18, 2: 18, 3: 16, 4: 13, 5: 10, 6: 8, 7: 6, 8: 4, 9: 3, 10: 2, 11: 1, 12: 1 };

// ── HELPERS ──
const salt = (uid, tag) => hashFloat(`${uid}|${tag}`);
const round2 = (n) => Math.round(n * 100) / 100;
const T = (e) => dayjs.utc(e.time).valueOf();
const iso = (t) => new Date(Math.floor(t)).toISOString();
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const dayStart = (t) => Math.floor(t / DAY_MS) * DAY_MS;
const logNormal = (sigma) => Math.exp(chance.normal({ mean: 0, dev: sigma }));
const jitter = (key, spread) => 1 + (hashFloat(key) - 0.5) * 2 * spread;
const pickW = (obj) => pickWeightedR(obj, chance.floating({ min: 0, max: 1 }));
const inSale = (t) => t >= ms(SALE_START) && t < ms(SALE_END);
const inIncident = (t) => t >= ms(PAYMENT_INCIDENT_START) && t < ms(PAYMENT_INCIDENT_END);
const inHurricane = (t) => t >= ms(HURRICANE_START) && t < ms(HURRICANE_END);
const platformOf = (os) => (os === "iOS" || os === "iPadOS" ? "ios" : os === "Android" ? "android" : "web");
// check-in day starts at 20:00 UTC (mid-afternoon in the US); the guest arrives 18:00-23:55 UTC, on the check-in date
const checkInAfter = (day0Ms, minMs) => {
	let c = dayStart(day0Ms) + 20 * HOUR_MS;
	while (c < minMs) c += DAY_MS;
	return c;
};
// the free-cancellation rate is the listed price; the non-refundable rate is NONREFUNDABLE_DISCOUNT cheaper
const nightlyRate = (p, checkInMs, t, refundable = true) => {
	const r = p.base_rate * jitter(`ndr|${p.property_id}|${dayKey(checkInMs)}`, 0.08);
	return Math.round(r * (inSale(t) ? 1 - SALE_DISCOUNT : 1) * (refundable ? 1 : 1 - NONREFUNDABLE_DISCOUNT));
};
const DAILY_BUDGET_USD = Object.fromEntries(PAID_CHANNELS.map((ch) => {
	const totalW = Object.values(CHANNEL_WEIGHTS).reduce((a, b) => a + b, 0);
	return [ch, CPA_USD[ch] * (NUM_USERS * BORN_PCT / 100) * (CHANNEL_WEIGHTS[ch] / totalW) / WINDOW_DAYS];
}));
const SPEND_WEEKDAY = (() => {
	const m = DOW_WEIGHTS.reduce((a, b) => a + b, 0) / DOW_WEIGHTS.length;
	return DOW_WEIGHTS.map((w) => SPEND_FLAT_SHARE + (1 - SPEND_FLAT_SHARE) * w / m);
})();
const paidSpend = (date, ch, signups) => round2((SPEND_PLAN_SHARE * DAILY_BUDGET_USD[ch] * SPEND_WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()]
	+ (1 - SPEND_PLAN_SHARE) * CPA_USD[ch] * signups) * jitter(`spend|${date}|${ch}`, SPEND_NOISE));
// wallets follow the device: Apple Pay on Apple devices, Google Pay on Android, both on the web
const PAY_METHODS = {
	ios: { credit_card: 45, paypal: 10, apple_pay: 45 },
	android: { credit_card: 50, paypal: 12, google_pay: 38 },
	web: { credit_card: 66, paypal: 18, apple_pay: 8, google_pay: 8 },
};
// gateway health for one platform-day: the normal approval rate, and during the
// incident the share of would-be approvals that time out instead (H2)
const gatewayDay = (ctx) => {
	const key = `${dayKey(ctx.time)}|${ctx.row.platform}`;
	const normal = 0.905 + 0.03 * hashFloat(`appr|${key}`);
	if (!(ctx.row.platform === "web" && inIncident(ctx.time))) return { approval: normal, timeout: 0.002 + 0.006 * hashFloat(`gto|${key}`) };
	const lost = WEB_FAIL * jitter(`gto|${key}`, 0.06);
	return { approval: normal * (1 - lost), timeout: normal * lost };
};
const ROOMS_LISTED = { us_cities: 41000, us_beaches: 23000, mountains: 12500, caribbean: 18500, europe: 36000 };

// declared event properties (filled from config.events below) — used to
// re-shape a cloned event into another event type without leaking keys
const EVENT_KEYS = {};
const ALL_EVENT_KEYS = new Set(["search_id"]);
const UNIT_EVENTS = new Set(["destination searched", "property viewed", "checkout started", "booking completed", "payment failed"]);
const BOOKING_LIFECYCLE = new Set(["booking cancelled", "check in completed", "review submitted"]);

/** Clone `src` into a `name` event at `t` carrying exactly the declared props in `props`. */
function morph(src, name, t, props) {
	const ev = cloneEvent(src, { event: name, time: iso(t) });
	for (const k of ALL_EVENT_KEYS) delete ev[k];
	ev.event = name;
	Object.assign(ev, props);
	return ev;
}

function handleUserHook(profile, meta) {
	const uid = profile.distinct_id;
	const seg = profile.traveler_segment;
	profile.push_enabled = salt(uid, "push") < 0.62;
	// TikTok's audience skews young: TikTok signups draw their age band from a younger mix
	if (profile.acquisition_channel === "tiktok_ads") profile.age_band = pickWeightedR(TIKTOK_AGE_WEIGHTS, salt(uid, "age"));
	if (meta.userIsBornInDataset) {
		profile.member_since = dayKey(dayjs.utc(profile.created ?? meta.user.created).valueOf());
		profile.rewards_tier = "member";
		return profile;
	}
	// TikTok ads started in the spring (TIKTOK_START), so TikTok members joined after it
	const from = ms(profile.acquisition_channel === "tiktok_ads" ? TIKTOK_START : "2022-01-01T00:00:00Z");
	profile.member_since = dayKey(from + Math.floor(salt(uid, "tenure") * (ms(DATASET_START) - from) / DAY_MS) * DAY_MS);
	const tierR = salt(uid, "tier") * (seg === "business" ? 0.6 : 1);
	// tiers are earned by stays in the previous calendar year: members who joined in 2026 have none yet
	profile.rewards_tier = profile.member_since >= "2026-01-01" ? "member" : tierR < 0.12 ? "gold" : tierR < 0.35 ? "silver" : "member";
	return profile;
}

function handleEverything(events, meta) {
	if (!events.length) return events;
	const profile = meta.profile;
	const uid = profile.distinct_id;
	const seg = SEGMENTS.includes(profile.traveler_segment) ? profile.traveler_segment : "couple";
	const BEGIN = ms(DATASET_START), END = ms(DATASET_END);
	const signup = events.find((e) => e.event === "account created");
	// a new traveler whose account would be created after the window end has no
	// account in the window: no anonymous browsing, no lists, no messages
	if (meta.userIsBornInDataset && !signup) return [];
	const authT = signup ? T(signup) : -Infinity;
	// member_since is the UTC date of the account created event
	if (signup) profile.member_since = dayKey(authT);
	// H3: a share of TikTok signups are browsers with a small, member-specific checkout propensity
	const lowIntent = profile.acquisition_channel === "tiktok_ads" && salt(uid, "intent") < TIKTOK_LOW_INTENT_SHARE;
	const lowIntentK = (() => {
		const u1 = Math.max(1e-9, salt(uid, "li1")), u2 = salt(uid, "li2");
		const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
		return LOW_INTENT_PROPENSITY * Math.exp(LOW_INTENT_SIGMA * z - LOW_INTENT_SIGMA * LOW_INTENT_SIGMA / 2);
	})();
	const variant = profile[EXP_KEY] !== undefined ? profile[EXP_KEY] : null;
	// each member's own appetite for booking (some mostly browse); mean 1
	// (truncated log-normal: re-draw with a fresh salt above the cap)
	const propensity = (() => {
		for (let k = 0; ; k++) {
			const tag = k ? `|${k}` : "";
			const u1 = Math.max(1e-9, salt(uid, `prop1${tag}`)), u2 = salt(uid, `prop2${tag}`);
			const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
			if (z <= PROPENSITY_TRUNC.a) return Math.exp(PROPENSITY_SIGMA * z) / PROPENSITY_TRUNC.mean;
		}
	})();

	// platform follows the device the event came from
	const anchor = events.find((e) => e.user_id && e.device_id) || events.find((e) => e.user_id) || events[0];
	for (const e of events) if (e.os) e.platform = platformOf(e.os);
	const fallbackPlatform = anchor.os ? platformOf(anchor.os) : "web";
	for (const e of events) if (!e.os) e.platform = fallbackPlatform;

	// ── collect search sessions (units) ──
	const units = new Map();
	const exposures = [];
	const rest = [];
	for (const e of events) {
		// funnel-level search_id belongs to the search steps, not the signup or the exposure
		if (e.event === "account created" || e.event === "$experiment_started") delete e.search_id;
		if (e.event === "$experiment_started") { exposures.push(e); continue; }
		if (UNIT_EVENTS.has(e.event)) {
			if (!units.has(e.search_id)) units.set(e.search_id, { id: e.search_id, search: null, views: [], checkout: null, booking: null });
			const un = units.get(e.search_id);
			if (e.event === "destination searched") un.search = e;
			else if (e.event === "property viewed") un.views.push(e);
			else if (e.event === "checkout started") un.checkout = e;
			else if (e.event === "booking completed") un.booking = e;
			continue;
		}
		if (BOOKING_LIFECYCLE.has(e.event)) continue; // rebuilt from bookings below
		rest.push(e);
	}
	const unitList = [...units.values()].filter((x) => x.search && x.views.length).sort((a, b) => T(a.search) - T(b.search));

	// ── window start: established members were already mid-search before June 4; sessions
	// that began in the days before the window still check out and book on its first days ──
	if (!signup && unitList.length) {
		const x = unitList.length * CARRY_IN_DAYS / WINDOW_DAYS;
		const n = Math.floor(x) + (chance.bool({ likelihood: (x % 1) * 100 }) ? 1 : 0);
		const carry = [];
		for (let i = 0; i < n; i++) {
			const tpl = chance.pickone(unitList);
			const shift = BEGIN - Math.ceil(chance.floating({ min: 0, max: CARRY_IN_DAYS }) * DAY_MS) - T(tpl.search);
			const c = (ev) => (ev ? cloneEvent(ev, { time: iso(T(ev) + shift) }) : null);
			const id = `S-${chance.hash({ length: 14 })}`;
			const search = c(tpl.search);
			search.search_id = id;
			carry.push({ id, carry: true, search, views: tpl.views.map(c), checkout: c(tpl.checkout), booking: c(tpl.booking) });
		}
		unitList.unshift(...carry);
		unitList.sort((a, b) => T(a.search) - T(b.search));
	}

	// ── H10: sale email (+ push for opted-in members); some move their next search up ──
	const pushes = [];
	const reachableFrom = signup ? authT : ms(DATASET_START); // members who joined before the window are on the lists from day one
	for (const pt of SALE_PUSH_TIMES) {
		const t = ms(pt) + Math.floor(salt(uid, `pushmin|${pt}`) * 40) * MIN_MS;
		if (t < reachableFrom || t > END || salt(uid, "email-optin") >= EMAIL_OPTIN_SHARE) continue;
		pushes.push(morph(anchor, "notification received", t, { notification_type: "marketing_campaign", channel: "email", campaign: "summer_kickoff_sale" }));
		if (!profile.push_enabled) continue;
		pushes.push(morph(anchor, "notification received", t + 2 * MIN_MS, { notification_type: "marketing_campaign", channel: "push", campaign: "summer_kickoff_sale" }));
		if (chance.bool({ likelihood: SALE_PUSH_RESPONSE * 100 })) {
			const next = unitList.find((x) => !x.moved && T(x.search) > t + 3 * HOUR_MS && T(x.search) < t + 21 * DAY_MS);
			if (next) {
				const shift = t + chance.integer({ min: 5, max: 90 }) * MIN_MS - T(next.search);
				for (const ev of [next.search, ...next.views, next.checkout, next.booking]) if (ev) ev.time = iso(T(ev) + shift);
				next.moved = true;
			}
		}
	}
	unitList.sort((a, b) => T(a.search) - T(b.search));

	// weekly "deals" email every Thursday to members subscribed to marketing email
	// (server-side: it keeps arriving whether or not the member is still active)
	if (salt(uid, "email-optin") < EMAIL_OPTIN_SHARE) {
		const digestMin = Math.floor(salt(uid, "digest-min") * 90);
		for (let d = dayStart(BEGIN); d <= END; d += DAY_MS) {
			if (new Date(d).getUTCDay() !== 4) continue;
			const t = d + 14 * HOUR_MS + digestMin * MIN_MS;
			if (t < reachableFrom || t > END) continue;
			pushes.push(morph(anchor, "notification received", t, { notification_type: "deal_digest", channel: "email", campaign: "none" }));
		}
	}

	// experiment exposure: the engine sends one per enrolled member, 1 s before their first search on or after the start
	let exposure = variant !== null && exposures.length ? exposures[0] : null;
	const exposureT = exposure ? T(exposure) : Infinity;
	let firstExposedSearchT = Infinity; // the first search that still happens (H9 can cancel the one the engine exposed on)

	// ── build each search session ──
	const regionW = Object.fromEntries(Object.entries(REGIONS).map(([r, v]) => [r, v.weight * SEGMENT_REGION_MULT[seg][r]]));
	const out = [];
	const bookings = [];
	for (const un of unitList) {
		const t0 = T(un.search);
		const preSignup = t0 < authT; // the anonymous first search, before the account exists
		let region = pickW(regionW);
		// H9: during the hurricane warnings a share of Caribbean trip planning never happens
		// (a new traveler's first search goes somewhere else instead)
		if (region === HURRICANE_REGION && inHurricane(t0) && !chance.bool({ likelihood: HURRICANE_SEARCH_KEEP * 100 })) {
			if (!preSignup) continue;
			while (region === HURRICANE_REGION) region = pickW(regionW);
		}
		const dest = chance.pickone(Object.keys(REGIONS[region].dest));
		if (t0 >= exposureT && t0 < firstExposedSearchT) firstExposedSearchT = t0;
		const [lm, ls, lc] = LEAD[seg];
		const leadDays = Math.min(lc, Math.floor(lm * logNormal(ls)));
		const nights = chance.integer({ min: NIGHTS[seg][0], max: NIGHTS[seg][1] });
		const guests = chance.integer({ min: GUESTS[seg][0], max: GUESTS[seg][1] });
		// views: 1-12 per session, a few minutes apart
		const nViews = Number(pickW(VIEW_COUNT_WEIGHTS));
		const views = un.views.slice(0, nViews);
		while (views.length < nViews) views.push(cloneEvent(un.views[views.length % un.views.length], { time: un.views[0].time }));
		const maxStep = preSignup ? Math.max(5, Math.floor((authT - t0) / 1000 / (nViews + 1))) : 360;
		let vt = t0;
		const viewProps = [];
		for (const v of views) {
			vt += chance.integer({ min: Math.min(40, maxStep - 1), max: maxStep }) * 1000;
			v.time = iso(vt);
			viewProps.push(chance.pickone(listedAt(dest, vt)));
		}
		// H6: search → booking time (log-normal, scaled by traveler segment); checkout opens minutes before
		const gapH = Math.min(SEARCH_TO_BOOK_MAX_H, SEARCH_TO_BOOK_MEDIAN_H * logNormal(SEARCH_TO_BOOK_SIGMA) * SEGMENT_GAP_MULT[seg]);
		let bkT = Math.max(vt + chance.integer({ min: 2, max: 10 }) * MIN_MS, t0 + gapH * HOUR_MS);
		if (preSignup) bkT = Math.max(bkT, authT + chance.integer({ min: 2, max: 6 }) * MIN_MS);
		const ckT = Math.max(vt + 30_000, preSignup ? authT + 30_000 : 0, bkT - chance.integer({ min: 60, max: 480 }) * 1000);
		if (un.carry && bkT < BEGIN) continue; // a stay booked before the window: the pre-window stays below cover it
		// the searched check-in date is never before the booking could happen
		const checkInMs = checkInAfter(t0 + leadDays * DAY_MS, bkT + 3 * HOUR_MS);
		const checkInDate = dayKey(checkInMs);
		Object.assign(un.search, { destination: dest, region, check_in_date: checkInDate, lead_time_days: Math.floor((dayStart(checkInMs) - dayStart(t0)) / DAY_MS), nights, guests });
		views.forEach((v, i) => {
			const p = viewProps[i];
			Object.assign(v, {
				search_id: un.id, property_id: p.property_id, property_name: p.property_name, property_type: p.property_type,
				destination: dest, region, star_rating: p.star_rating, review_count: reviewsAt(p, T(v)), guest_rating: guestRatingAt(p, T(v)),
				nightly_rate: nightlyRate(p, checkInMs, T(v)),
			});
		});
		out.push(un.search, ...views);

		// H8 + H10 + H5 + H9 + H3: does the session reach checkout? (last property viewed)
		const p = viewProps[viewProps.length - 1];
		const treated = variant === ALLIN_VARIANT && t0 >= exposureT;
		let pCk = BASE_CHECKOUT * propensity * reviewFactor(views[views.length - 1].review_count);
		if (inSale(ckT)) pCk *= SALE_CHECKOUT_LIFT;
		if (treated) pCk *= ALLIN_CHECKOUT_MULT;
		if (region === HURRICANE_REGION && inHurricane(ckT)) pCk *= HURRICANE_CHECKOUT_K;
		if (lowIntent) pCk *= lowIntentK;
		if (!chance.bool({ likelihood: pCk * 100 }) || ckT > END) continue;
		const ckSrc = un.checkout || signup;
		if (!ckSrc) continue;
		// the traveler picks the rate type at checkout (independent of who they are)
		const refundable = chance.bool({ likelihood: REFUNDABLE_SHARE * 100 });
		const rate = nightlyRate(p, checkInMs, ckT, refundable);
		const total = round2(rate * nights * (1 + TAX_FEE_RATE));
		const ck = un.checkout || morph(signup, "checkout started", ckT, {});
		Object.assign(ck, {
			time: iso(ckT), search_id: un.id, property_id: p.property_id, property_name: p.property_name, property_type: p.property_type,
			destination: dest, region, star_rating: p.star_rating, review_count: reviewsAt(p, ckT), nightly_rate: rate, nights, guests,
			total_price: total, check_in_date: checkInDate, lead_time_days: Math.floor((dayStart(checkInMs) - dayStart(ckT)) / DAY_MS),
		});
		out.push(ck);

		// H1 + H2 + H5: does the checkout become a booking?
		let pBk = BASE_BOOK;
		if (ckT >= ms(FLEX_PAY_LAUNCH)) pBk *= FLEX_LIFT;
		if (treated) pBk *= ALLIN_BOOK_MULT;
		const incidentFail = ck.platform === "web" && inIncident(ckT) && chance.bool({ likelihood: WEB_FAIL * 100 });
		const books = !incidentFail && chance.bool({ likelihood: Math.min(100, pBk * 100) });
		if (!books || bkT > END) {
			if (bkT <= END && chance.bool({ likelihood: (incidentFail ? INCIDENT_ERROR_EVENT : BASE_ERROR_EVENT) * 100 })) {
				const errT = ckT + chance.integer({ min: 20, max: 200 }) * 1000;
				out.push(morph(ck, "payment failed", errT, {
					search_id: un.id, property_id: p.property_id,
					error_code: incidentFail ? "gateway_timeout" : pickW({ card_declined: 55, insufficient_funds: 20, "3ds_failed": 25 }),
					payment_method: pickW(PAY_METHODS[ck.platform] || PAY_METHODS.web),
				}));
				if (chance.bool({ likelihood: SUPPORT_AFTER_PAYMENT_FAIL * 100 })) {
					out.push(morph(ck, "support contacted", errT + chance.integer({ min: 2, max: 90 }) * MIN_MS, { topic: "payment_issue", contact_channel: pickW({ chat: 70, phone: 20, email: 10 }) }));
				}
			}
			continue;
		}
		const flex = bkT >= ms(FLEX_PAY_LAUNCH) && chance.bool({ likelihood: FLEX_SHARE * 100 });
		const bk = un.booking || morph(ck, "booking completed", bkT, {});
		const leadDays2 = Math.floor((dayStart(checkInMs) - dayStart(bkT)) / DAY_MS);
		Object.assign(bk, {
			time: iso(bkT), booking_id: `BK-${un.id.slice(2, 12).toUpperCase()}`, search_id: un.id,
			property_id: p.property_id, property_name: p.property_name, property_type: p.property_type,
			destination: dest, region, star_rating: p.star_rating, review_count: reviewsAt(p, bkT), nightly_rate: rate, nights, guests,
			total_price: total, check_in_date: checkInDate, lead_time_days: leadDays2,
			refundable, payment_method: flex ? "flex_pay" : pickW(PAY_METHODS[ck.platform] || PAY_METHODS.web),
			promo_code: inSale(bkT) ? PROMO_CODE : "none",
		});
		out.push(bk);
		bookings.push({ id: bk.booking_id, prop: p, checkInMs, nights, refundable, leadDays: leadDays2, bookingT: bkT, total, src: bk });
	}

	// ── window start: established members already hold upcoming stays ──
	if (!signup) {
		const x = bookings.length * PREWINDOW_DAYS / WINDOW_DAYS;
		const n = Math.floor(x) + (chance.bool({ likelihood: (x % 1) * 100 }) ? 1 : 0);
		for (let i = 0; i < n; i++) {
			const bkT = BEGIN - Math.floor(chance.floating({ min: 0, max: PREWINDOW_DAYS }) * DAY_MS);
			const [lm, ls, lc] = LEAD[seg];
			const lead = Math.min(lc, Math.floor(lm * logNormal(ls)));
			const checkInMs = checkInAfter(bkT + lead * DAY_MS, bkT + 3 * HOUR_MS);
			const nights = chance.integer({ min: NIGHTS[seg][0], max: NIGHTS[seg][1] });
			if (checkInMs + (nights + 7) * DAY_MS < BEGIN) continue; // the stay and its review are over before the window
			const region = pickW(regionW);
			const dest = chance.pickone(Object.keys(REGIONS[region].dest));
			const p = chance.pickone(listedAt(dest, bkT));
			const refundable = chance.bool({ likelihood: REFUNDABLE_SHARE * 100 });
			const rate = nightlyRate(p, checkInMs, bkT, refundable);
			bookings.push({
				id: `BK-${chance.hash({ length: 10 }).toUpperCase()}`, prop: p, checkInMs, nights, refundable,
				leadDays: Math.floor((dayStart(checkInMs) - dayStart(bkT)) / DAY_MS), bookingT: bkT,
				total: round2(rate * nights * (1 + TAX_FEE_RATE)), src: anchor,
			});
		}
	}

	// ── booking lifecycle: cancellation (H4, H9), reminder, check-in, review ──
	const reviews = [];
	for (const b of bookings) {
		b.life = [];
		const pC = CANCEL_RATE[leadBucket(b.leadDays)] * (b.refundable ? 1 : NONREFUNDABLE_CANCEL_MULT);
		let cancelT = null, reason = null;
		if (chance.bool({ likelihood: pC * 100 })) {
			const gap = Math.min(CANCEL_MAX_DAYS * DAY_MS - HOUR_MS, CANCEL_MEDIAN_DAYS * DAY_MS * logNormal(1.0), b.checkInMs - 2 * HOUR_MS - b.bookingT);
			cancelT = b.bookingT + Math.max(10 * MIN_MS, gap);
			reason = pickW({ change_of_plans: 38, found_better_price: 24, schedule_conflict: 20, travel_restrictions: 6, illness: 12 });
		}
		// H9: Hurricane Delia — Caribbean stays checking in during the warnings
		const stormStay = b.prop.region === HURRICANE_REGION && b.checkInMs >= ms(HURRICANE_START) && b.checkInMs < ms(HURRICANE_END) && b.bookingT < ms(HURRICANE_CANCEL_FROM);
		if (stormStay && !(cancelT !== null && cancelT < ms(HURRICANE_CANCEL_FROM)) && chance.bool({ likelihood: HURRICANE_CANCEL * 100 })) {
			const latest = Math.min(b.checkInMs - 2 * HOUR_MS, ms(HURRICANE_CANCEL_FROM) + 3 * DAY_MS);
			cancelT = ms(HURRICANE_CANCEL_FROM) + chance.floating({ min: 0, max: 1 }) * Math.max(HOUR_MS, latest - ms(HURRICANE_CANCEL_FROM));
			reason = "weather";
		}
		const base = { booking_id: b.id, property_id: b.prop.property_id, destination: b.prop.destination, region: b.prop.region };
		if (cancelT !== null) {
			if (cancelT >= BEGIN && cancelT <= END) {
				b.life.push(morph(b.src, "booking cancelled", cancelT, {
					...base, check_in_date: dayKey(b.checkInMs), lead_time_days: b.leadDays,
					days_before_check_in: Math.max(0, Math.floor((dayStart(b.checkInMs) - dayStart(cancelT)) / DAY_MS)),
					cancellation_reason: reason, refund_amount: b.refundable || reason === "weather" ? b.total : 0,
				}));
				if (chance.bool({ likelihood: SUPPORT_AFTER_CANCEL * 100 })) {
					const supT = cancelT + chance.integer({ min: 10, max: 48 * 60 }) * MIN_MS;
					if (supT <= END) b.life.push(morph(b.src, "support contacted", supT, { topic: pickW({ refund_status: 60, cancellation: 40 }), contact_channel: pickW({ chat: 55, phone: 30, email: 15 }) }));
				}
			}
			continue;
		}
		// trip reminder the day before check-in, mid-morning US time (server-side)
		const remT = dayStart(b.checkInMs) - DAY_MS + 13 * HOUR_MS + chance.integer({ min: 0, max: 180 }) * MIN_MS;
		if (remT >= BEGIN && remT <= END && remT > b.bookingT) {
			b.life.push(morph(b.src, "notification received", remT, { notification_type: "trip_reminder", channel: profile.push_enabled ? "push" : "email", campaign: "none" }));
		}
		if (b.checkInMs > END) continue;
		if (b.checkInMs >= BEGIN) {
			b.life.push(morph(b.src, "check in completed", b.checkInMs + chance.integer({ min: -120, max: 235 }) * MIN_MS, {
				...base, property_type: b.prop.property_type, nights: b.nights,
				check_in_method: pickW(b.prop.property_type === "vacation_rental" ? { self_check_in: 85, front_desk: 15 } : { front_desk: 55, mobile_key: 35, self_check_in: 10 }),
			}));
		}
		const revT = b.checkInMs + b.nights * DAY_MS + chance.integer({ min: 12, max: 6 * 24 }) * HOUR_MS;
		if (revT >= BEGIN && revT <= END && chance.bool({ likelihood: REVIEW_RATE * 100 })) {
			const rating = Number(pickW(RATING_WEIGHTS));
			const rv = morph(b.src, "review submitted", revT, {
				...base, property_type: b.prop.property_type, rating,
				review_length: Math.max(5, Math.round((rating <= 2 ? 95 : rating === 3 ? 60 : 70) * logNormal(0.6))),
				would_recommend: rating >= 4 ? true : rating === 3 ? chance.bool({ likelihood: 40 }) : false,
			});
			b.life.push(rv);
			reviews.push({ rating, t: revT });
		}
	}

	// ── H7: a bad stay costs a customer ──
	let cut = Infinity;
	for (const r of reviews.sort((a, b) => a.t - b.t)) {
		if (r.rating <= BAD_RATING_MAX && chance.bool({ likelihood: BAD_STAY_CHURN * 100 })) {
			cut = Math.floor(r.t + chance.floating({ min: CHURN_DAY_MIN, max: CHURN_DAY_MAX }) * DAY_MS);
			break;
		}
	}

	// ── assemble ──
	let all = out.concat(pushes, rest.filter((e) => e.event !== "support contacted" || chance.bool({ likelihood: SUPPORT_BACKGROUND_KEEP * 100 })));
	for (const b of bookings) if (b.bookingT < cut) all = all.concat(b.life);
	if (cut < Infinity) {
		// a member who leaves stops searching and reviewing; stays already booked still happen,
		// and server-side messages keep arriving
		const keepAfterCut = new Set(["notification received", "check in completed", "booking cancelled"]);
		all = all.filter((e) => T(e) < cut || keepAfterCut.has(e.event));
	}

	// standalone browsing events carry real catalog values: wishlists and price alerts
	// follow the destination the member searched most recently (their first search if
	// none yet); app alerts reach members who turned push off by email instead
	const searchLog = out.filter((e) => e.event === "destination searched").map((e) => ({ t: T(e), dest: e.destination })).sort((a, b) => a.t - b.t);
	const recentDest = (t) => {
		if (!searchLog.length) return chance.pickone(Object.keys(REGIONS[pickW(regionW)].dest));
		let d = searchLog[0].dest;
		for (const x of searchLog) { if (x.t > t) break; d = x.dest; }
		return d;
	};
	for (const e of all) {
		if (e.event === "notification received" && e.channel === "push" && !profile.push_enabled) e.channel = "email";
		else if (e.event === "wishlist saved") {
			const d = recentDest(T(e));
			const p = chance.pickone(listedAt(d, T(e)));
			Object.assign(e, { property_id: p.property_id, property_name: p.property_name, destination: d, region: DEST_REGION[d] });
		} else if (e.event === "price alert set") {
			const d = recentDest(T(e));
			Object.assign(e, { destination: d, region: DEST_REGION[d], target_price: Math.round(DEST_BASE_RATE[d] * chance.floating({ min: 0.6, max: 0.95 })) });
		}
	}

	// the engine put the exposure 1 s before the member's first post-start search; when
	// H9 removed that search, it moves to the first one that still happened (a no-op
	// otherwise), and a member who left (H7) before any search was never exposed
	if (exposure && firstExposedSearchT < cut) {
		exposure.time = iso(firstExposedSearchT - 1000);
		all.push(exposure);
	}
	else if (profile[EXP_KEY] !== undefined) delete profile[EXP_KEY];

	return all.filter((e) => T(e) >= BEGIN && T(e) <= END);
}

// warehouse rows: exogenous business facts layered on event-derived volumes
function handleWarehouse(row, meta) {
	if (meta.isBackfill) return row;
	if (meta.metricName === "marketing_spend_daily") {
		const k = `${row.date}|${row.acquisition_channel}`;
		const spend = paidSpend(row.date, row.acquisition_channel, row.spend_usd);
		row.spend_usd = spend;
		row.signups_reported = Math.round(spend * PLATFORM_SIGNUP_INFLATION / CPA_USD[row.acquisition_channel] * jitter(`sr|${k}`, 0.2));
		row.clicks = Math.round(spend / (CPC_USD[row.acquisition_channel] * jitter(`cpc|${k}`, 0.15)));
		row.impressions = Math.round(row.clicks / (CTR[row.acquisition_channel] * jitter(`ctr|${k}`, 0.15)));
		return row;
	}
	if (meta.metricName === "payment_gateway_daily") {
		const k = `${row.date}|${row.platform}`;
		// every booking needs one approved authorization; date changes re-authorize the card,
		// members who opted out of analytics book without a Mixpanel event, and a few
		// booking events never arrive (dropped SDK calls)
		row.authorizations_approved = Math.round(row.authorizations_approved * (0.93 + 0.24 * hashFloat(`reauth|${k}`)));
		// attempts: approvals plus declines, timeouts, and card retries at the day's approval rate
		row.authorization_attempts = Math.round(row.authorizations_approved / row.approval_rate);
		return row;
	}
	if (meta.metricName === "destination_supply_daily") {
		const k = `${row.date}|${row.region}`;
		// partner-channel bookings (corporate travel desks, wholesalers) never pass through the app
		row.room_nights_booked = Math.round(row.room_nights_booked * (1.3 + 0.25 * jitter(`partner|${k}`, 1)) + 12 * jitter(`whs|${k}`, 0.9));
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
		hasBrowser: false,
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
				signup_method: { __weights: { email: 45, google: 30, apple: 25 } },
				acquisition_channel: (ctx) => ctx.profile.acquisition_channel,
			},
		},
		{
			event: "destination searched",
			weight: 1,
			isStrictEvent: true,
			properties: {
				search_id: ["unassigned"],
				destination: ["New York"],
				region: ["us_cities"],
				check_in_date: ["2026-06-04"],
				lead_time_days: [0],
				nights: [1],
				guests: [1],
			},
		},
		{
			event: "property viewed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				search_id: ["unassigned"],
				property_id: ["unassigned"],
				property_name: ["unassigned"],
				property_type: ["hotel"],
				destination: ["New York"],
				region: ["us_cities"],
				star_rating: [3],
				review_count: [0],
				guest_rating: [0],
				nightly_rate: [0],
			},
		},
		{
			event: "checkout started",
			weight: 1,
			isStrictEvent: true,
			properties: {
				search_id: ["unassigned"],
				property_id: ["unassigned"],
				property_name: ["unassigned"],
				property_type: ["hotel"],
				destination: ["New York"],
				region: ["us_cities"],
				star_rating: [3],
				review_count: [0],
				nightly_rate: [0],
				nights: [1],
				guests: [1],
				total_price: [0],
				check_in_date: ["2026-06-04"],
				lead_time_days: [0],
			},
		},
		{
			event: "booking completed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				booking_id: ["unassigned"],
				search_id: ["unassigned"],
				property_id: ["unassigned"],
				property_name: ["unassigned"],
				property_type: ["hotel"],
				destination: ["New York"],
				region: ["us_cities"],
				star_rating: [3],
				review_count: [0],
				nightly_rate: [0],
				nights: [1],
				guests: [1],
				total_price: [0],
				check_in_date: ["2026-06-04"],
				lead_time_days: [0],
				refundable: [true],
				payment_method: ["credit_card"],
				promo_code: ["none"],
			},
		},
		{
			event: "payment failed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				search_id: ["unassigned"],
				property_id: ["unassigned"],
				error_code: ["card_declined"],
				payment_method: ["credit_card"],
			},
		},
		{
			event: "booking cancelled",
			weight: 1,
			isStrictEvent: true,
			properties: {
				booking_id: ["unassigned"],
				property_id: ["unassigned"],
				destination: ["New York"],
				region: ["us_cities"],
				check_in_date: ["2026-06-04"],
				lead_time_days: [0],
				days_before_check_in: [0],
				cancellation_reason: ["change_of_plans"],
				refund_amount: [0],
			},
		},
		{
			event: "check in completed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				booking_id: ["unassigned"],
				property_id: ["unassigned"],
				property_type: ["hotel"],
				destination: ["New York"],
				region: ["us_cities"],
				nights: [1],
				check_in_method: ["front_desk"],
			},
		},
		{
			event: "review submitted",
			weight: 1,
			isStrictEvent: true,
			properties: {
				booking_id: ["unassigned"],
				property_id: ["unassigned"],
				property_type: ["hotel"],
				destination: ["New York"],
				region: ["us_cities"],
				rating: [4],
				review_length: [60],
				would_recommend: [true],
			},
		},
		{
			event: "filters applied",
			weight: 6,
			properties: {
				filter_type: { __weights: { price: 34, guest_rating: 18, free_cancellation: 16, property_type: 12, amenities: 12, neighborhood: 8 } },
			},
		},
		{
			event: "map viewed",
			weight: 5,
			properties: {
				zoom_level: [11, 12, 12, 13, 13, 14, 15],
			},
		},
		{
			event: "wishlist saved",
			weight: 2,
			properties: {
				property_id: ["unassigned"],
				property_name: ["unassigned"],
				destination: ["New York"],
				region: ["us_cities"],
			},
		},
		{
			event: "price alert set",
			weight: 1,
			properties: {
				destination: ["New York"],
				region: ["us_cities"],
				target_price: [150],
			},
		},
		{
			event: "notification received",
			weight: 3,
			properties: {
				notification_type: { __weights: { price_drop: 55, abandoned_search: 45 } },
				channel: { __weights: { push: 55, email: 45 } },
				campaign: ["none"],
			},
		},
		{
			event: "support contacted",
			weight: 1,
			properties: {
				topic: { __weights: { change_dates: 28, cancellation: 22, refund_status: 18, payment_issue: 12, property_issue: 12, other: 8 } },
				contact_channel: { __weights: { chat: 60, phone: 25, email: 15 } },
			},
		},
		{
			event: "$experiment_started",
			weight: 1,
			isStrictEvent: true,
			properties: {
				"Experiment name": [ALLIN_EXPERIMENT],
				"Variant name": ["Control", ALLIN_VARIANT],
			},
		},
	],

	funnels: [
		{
			// a new traveler browses anonymously, then creates an account
			name: "Signup",
			sequence: ["destination searched", "property viewed", "property viewed", "account created"],
			isFirstFunnel: true,
			conversionRate: 100,
			requireRepeats: true,
			timeToConvert: 0.3,
			order: "sequential",
			weight: 1,
			props: {
				search_id: () => `S-${chance.hash({ length: 14 })}`,
			},
		},
		{
			// a search session: the hook decides views, checkout, and booking
			name: "Trip search",
			sequence: ["destination searched", "property viewed", "checkout started", "booking completed"],
			conversionRate: 100,
			timeToConvert: 0.4,
			order: "sequential",
			weight: 7,
			props: {
				search_id: () => `S-${chance.hash({ length: 14 })}`,
			},
			experiment: {
				name: ALLIN_EXPERIMENT,
				startDaysBeforeEnd: (ms(DATASET_END) - ms(ALLIN_START)) / DAY_MS,
				variants: [{ name: "Control" }, { name: ALLIN_VARIANT }],
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
				signups_reported: 0,
			},
		},
		{
			name: "payment_gateway_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "booking completed",
				measure: "count",
				groupBy: "platform",
			},
			timeColumn: "date",
			valueColumn: "authorizations_approved",
			columns: {
				authorization_attempts: 0,
				approval_rate: (ctx) => Math.round(gatewayDay(ctx).approval * 1000) / 1000,
				gateway_timeout_rate: (ctx) => Math.round(gatewayDay(ctx).timeout * 10000) / 10000,
				p95_auth_latency_ms: (ctx) => {
					const hit = ctx.row.platform === "web" && inIncident(ctx.time);
					const j = hashFloat(`lat|${dayKey(ctx.time)}|${ctx.seriesKey}`);
					return hit ? Math.round(14000 + j * 9000) : Math.round(900 + j * 500);
				},
				gateway_status: (ctx) => (ctx.row.platform === "web" && inIncident(ctx.time) ? "degraded" : "operational"),
			},
		},
		{
			name: "destination_supply_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "booking completed",
				measure: "sum",
				property: "nights",
				groupBy: "region",
			},
			timeColumn: "date",
			valueColumn: "room_nights_booked",
			columns: {
				rooms_listed: (ctx) => {
					const hit = ctx.row.region === HURRICANE_REGION && inHurricane(ctx.time);
					return Math.round(ROOMS_LISTED[ctx.row.region] * (hit ? HURRICANE_ROOMS_K : 1) * jitter(`rooms|${dayKey(ctx.time)}|${ctx.seriesKey}`, 0.03));
				},
				avg_daily_rate_usd: (ctx) => {
					const rates = Object.values(REGIONS[ctx.row.region].dest);
					const base = rates.reduce((a, b) => a + b, 0) / rates.length;
					const dow = new Date(ctx.time).getUTCDay();
					return round2(base * (dow === 5 || dow === 6 ? 1.12 : 1) * jitter(`adr|${dayKey(ctx.time)}|${ctx.seriesKey}`, 0.05));
				},
				weather_advisory: (ctx) => (ctx.row.region === HURRICANE_REGION && inHurricane(ctx.time) ? "hurricane_warning" : "none"),
			},
		},
	],

	superProps: {
		platform: ["web"],
	},

	userProps: {
		traveler_segment: ["couple"],
		home_market: { __weights: { "New York": 14, "Los Angeles": 11, Chicago: 8, Dallas: 7, Houston: 6, Atlanta: 6, "Washington DC": 6, Boston: 5, Seattle: 5, Denver: 5, Miami: 5, Phoenix: 4, Toronto: 6, London: 8, Manchester: 4 } },
		age_band: { __weights: AGE_WEIGHTS },
		acquisition_channel: { __weights: CHANNEL_WEIGHTS },
		rewards_tier: ["member"],
		member_since: ["2025-01-01"],
		push_enabled: [false],
	},

	personas: [
		{ name: "business", weight: 20, eventMultiplier: 1.4, properties: { traveler_segment: "business" } },
		{ name: "family", weight: 25, eventMultiplier: 0.8, properties: { traveler_segment: "family" } },
		{ name: "couple", weight: 30, eventMultiplier: 1.0, properties: { traveler_segment: "couple" } },
		{ name: "solo", weight: 25, eventMultiplier: 1.0, properties: { traveler_segment: "solo" } },
	],

	retentionCurve: { type: "logarithmic", day1: 0.55, day7: 0.35, day30: 0.22 },

	hook(record, type, meta) {
		if (type === "user") return handleUserHook(record, meta);
		if (type === "everything") return handleEverything(record, meta);
		if (type === "warehouse") return handleWarehouse(record, meta);
		return record;
	},
};

for (const e of config.events) {
	EVENT_KEYS[e.event] = Object.keys(e.properties || {});
	for (const k of EVENT_KEYS[e.event]) ALL_EVENT_KEYS.add(k);
}

// ── STORIES ──────────────────────────────────────────────────────────────
// Machine-checkable contract for hooks H1-H10. Evaluate with:
//   node dungeons/vertical/travel/travel.verify.mjs

const EV = `read_json_auto('{{PREFIX}}-EVENTS*.json*', sample_size=-1, union_by_name=true)`;
const US = `read_json_auto('{{PREFIX}}-USERS*.json*', sample_size=-1, union_by_name=true)`;
const WH = (table) => `read_json_auto('{{PREFIX}}-WAREHOUSE-${table}.json*', sample_size=-1, union_by_name=true)`;

// Identity prelude: a device resolves to the member seen with it on any event
// that carries both ids (emitted stitch evidence). A new traveler's anonymous
// first search and property views carry device_id only; "account created"
// carries both, so those rows resolve to the member (Mixpanel ID merge).
const ID_CTE = `dmap AS (SELECT device_id, min(user_id::VARCHAR) AS mapped FROM ${EV}
  WHERE user_id IS NOT NULL AND device_id IS NOT NULL GROUP BY 1),
ev AS (SELECT coalesce(e.user_id::VARCHAR, m.mapped) AS uid, e.time::TIMESTAMP AS t, e.*
  FROM ${EV} e LEFT JOIN dmap m ON e.device_id = m.device_id)`;

const TS = (iso) => dayjs.utc(iso).format("YYYY-MM-DD HH:mm:ss");
const D = (iso) => iso.slice(0, 10);
const addDays = (iso, n) => dayjs.utc(iso).add(n, "day").toISOString();
const band = (k) => [Math.round(k * 0.9 * 1000) / 1000, Math.round(k * 1.1 * 1000) / 1000];
const r3 = (x) => Math.round(x * 1000) / 1000;
const leadCase = (col) => `CASE WHEN ${col} <= 6 THEN '0-6' WHEN ${col} <= 29 THEN '7-29' WHEN ${col} <= 59 THEN '30-59' ELSE '60+' END`;
const reviewCase = (col) => `CASE WHEN ${col} <= 9 THEN '0-9' WHEN ${col} <= 49 THEN '10-49' ELSE '50+' END`;

// read windows (each keeps one engineered change inside it)
const H1_READ_END = PAYMENT_INCIDENT_START;                    // after-period: Flex Pay launch to the day before the incident
const INC_BASE_DAYS = 14;                                     // H2 baseline: 14 days either side of the incident
const SIGNUP_READ_END = "2026-09-01T00:00:00Z";               // H3: signups Jun 4-Aug 31 have a full 30-day booking window
const BOOKER_WINDOW_DAYS = 30;
const CANCEL_READ_END = "2026-09-01T00:00:00Z";               // H4: bookings through Aug 31 (30-day window closes by Sep 30); weather cancellations excluded
const EXP_READ_END = addDays(DATASET_END, -7).slice(0, 10) + "T00:00:00Z"; // H5: searches with a full 7-day window
const EXP_WINDOW_DAYS = 7;
const TTC_READ_END = "2026-09-17T00:00:00Z";                  // H6: searches with a full 14-day window
const TTC_WINDOW_DAYS = 14;
const BASE_SEGMENTS = ["couple", "solo"];
const RET_FROM = 7, RET_TO = 30;                              // H7: destination searched on day 7-29 after the first review
const RET_BIRTH_END = addDays(DATASET_END, -RET_TO);
const STORM_BASE_DAYS = 14;                                   // H9 baseline: 14 days either side of the warnings
const SALE_BASE_DAYS = 14;                                    // H10 baseline: 14 days either side of the sale

const H1_SQL = `WITH ${ID_CTE}
SELECT CASE WHEN t < TIMESTAMP '${TS(FLEX_PAY_LAUNCH)}' THEN 'before' ELSE 'after' END AS grp, count(DISTINCT uid) AS user_count,
 count(*) FILTER (WHERE event = 'checkout started') AS checkouts,
 count(*) FILTER (WHERE event = 'booking completed')::DOUBLE / count(*) FILTER (WHERE event = 'checkout started') AS book_rate,
 count(*) FILTER (WHERE event = 'booking completed' AND payment_method = 'flex_pay')::DOUBLE / count(*) FILTER (WHERE event = 'booking completed') AS flex_share
FROM ev WHERE event IN ('checkout started', 'booking completed') AND t < TIMESTAMP '${TS(H1_READ_END)}' GROUP BY 1`;

const H2_SQL = `WITH ${ID_CTE},
o AS (SELECT DISTINCT date::DATE AS d, platform FROM ${WH("payment_gateway_daily")} WHERE gateway_status = 'degraded'),
od AS (SELECT DISTINCT d FROM o), op AS (SELECT DISTINCT platform FROM o),
w AS (SELECT t::DATE AS d, uid, event, (platform IN (SELECT platform FROM op)) AS hit FROM ev
  WHERE event IN ('checkout started', 'booking completed')
    AND t >= TIMESTAMP '${TS(addDays(PAYMENT_INCIDENT_START, -INC_BASE_DAYS))}' AND t < TIMESTAMP '${TS(addDays(PAYMENT_INCIDENT_END, INC_BASE_DAYS))}'),
g AS (SELECT (d IN (SELECT d FROM od)) AS outage, hit, count(DISTINCT uid) AS users,
  count(*) FILTER (WHERE event = 'booking completed')::DOUBLE / count(*) FILTER (WHERE event = 'checkout started') AS rate
  FROM w GROUP BY 1, 2)
SELECT 'all' AS grp, (SELECT count(*) FROM od) AS outage_days, (SELECT count(*) FROM op) AS outage_platforms, min(users) AS user_count,
 (max(rate) FILTER (WHERE outage AND hit) / max(rate) FILTER (WHERE outage AND NOT hit))
  / (max(rate) FILTER (WHERE NOT outage AND hit) / max(rate) FILTER (WHERE NOT outage AND NOT hit)) AS did
FROM g`;

const H3_SQL = `WITH ${ID_CTE},
s AS (SELECT uid, t AS t0, acquisition_channel AS ch FROM ev WHERE event = 'account created' AND t < TIMESTAMP '${TS(SIGNUP_READ_END)}'),
b AS (SELECT s.uid FROM s JOIN ev e ON e.uid = s.uid AND e.event = 'booking completed' AND e.t >= s.t0 AND e.t < s.t0 + INTERVAL ${BOOKER_WINDOW_DAYS} DAY GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM ${WH("marketing_spend_daily")} WHERE date::DATE < DATE '${D(SIGNUP_READ_END)}' GROUP BY 1),
g AS (SELECT s.ch, count(*) AS signups, count(b.uid) AS bookers FROM s LEFT JOIN b ON b.uid = s.uid GROUP BY 1)
SELECT g.ch AS grp, g.signups AS user_count, g.bookers::DOUBLE / g.signups AS booker_rate,
 sp.spend / g.signups AS spend_per_signup, sp.spend / g.bookers AS spend_per_booker
FROM g LEFT JOIN sp ON sp.ch = g.ch
UNION ALL
SELECT 'non_tiktok' AS grp, sum(signups)::BIGINT AS user_count, sum(bookers)::DOUBLE / sum(signups) AS booker_rate, NULL, NULL FROM g WHERE ch <> 'tiktok_ads'`;

const H4_SQL = `WITH ${ID_CTE},
b AS (SELECT booking_id, uid, t AS t0, lead_time_days, refundable FROM ev WHERE event = 'booking completed' AND t < TIMESTAMP '${TS(CANCEL_READ_END)}'),
c AS (SELECT booking_id, min(t) AS tc FROM ev WHERE event = 'booking cancelled' AND cancellation_reason <> 'weather' GROUP BY 1),
x AS (SELECT b.*, coalesce(c.tc >= b.t0 AND c.tc < b.t0 + INTERVAL ${CANCEL_MAX_DAYS} DAY, false) AS cancelled FROM b LEFT JOIN c ON c.booking_id = b.booking_id)
SELECT ${leadCase("lead_time_days")} AS grp, count(DISTINCT uid) AS user_count, count(*) AS bookings, avg(cancelled::INT) AS cancel_rate FROM x GROUP BY 1
UNION ALL
SELECT CASE WHEN refundable THEN 'refundable' ELSE 'non_refundable' END AS grp, count(DISTINCT uid) AS user_count, count(*) AS bookings, avg(cancelled::INT) AS cancel_rate FROM x GROUP BY 1`;

const H5_SQL = `WITH ${ID_CTE},
v AS (SELECT distinct_id::VARCHAR AS uid, "${EXP_KEY}" AS variant FROM ${US} WHERE "${EXP_KEY}" IS NOT NULL),
s AS (SELECT uid, search_id, t AS t0 FROM ev WHERE event = 'destination searched' AND t >= TIMESTAMP '${TS(ALLIN_START)}' AND t < TIMESTAMP '${TS(EXP_READ_END)}'),
c AS (SELECT search_id, min(t) AS tc FROM ev WHERE event = 'checkout started' GROUP BY 1),
b AS (SELECT search_id, min(t) AS tb FROM ev WHERE event = 'booking completed' GROUP BY 1),
x AS (SELECT v.variant, s.uid, coalesce(c.tc < s.t0 + INTERVAL ${EXP_WINDOW_DAYS} DAY, false) AS ck,
  coalesce(c.tc < s.t0 + INTERVAL ${EXP_WINDOW_DAYS} DAY AND b.tb < s.t0 + INTERVAL ${EXP_WINDOW_DAYS} DAY, false) AS bk
  FROM s JOIN v ON v.uid = s.uid LEFT JOIN c ON c.search_id = s.search_id LEFT JOIN b ON b.search_id = s.search_id)
SELECT variant AS grp, count(DISTINCT uid) AS user_count, count(*) AS searches, avg(ck::INT) AS checkout_rate,
 sum(bk::INT)::DOUBLE / sum(ck::INT) AS book_rate FROM x GROUP BY 1`;

const H6_SQL = `WITH ${ID_CTE},
s AS (SELECT search_id, uid, t AS t0 FROM ev WHERE event = 'destination searched' AND t < TIMESTAMP '${TS(TTC_READ_END)}'),
b AS (SELECT search_id, min(t) AS tb FROM ev WHERE event = 'booking completed' GROUP BY 1),
x AS (SELECT u.traveler_segment AS seg, s.uid, date_diff('second', s.t0, b.tb) / 3600.0 AS hours
  FROM s JOIN b ON b.search_id = s.search_id JOIN ${US} u ON u.distinct_id::VARCHAR = s.uid
  WHERE b.tb >= s.t0 AND b.tb < s.t0 + INTERVAL ${TTC_WINDOW_DAYS} DAY)
SELECT seg AS grp, count(DISTINCT uid) AS user_count, count(*) AS bookings, median(hours) AS med_hours FROM x GROUP BY 1
UNION ALL
SELECT 'baseline' AS grp, count(DISTINCT uid) AS user_count, count(*) AS bookings, median(hours) AS med_hours FROM x WHERE seg IN (${BASE_SEGMENTS.map((x) => `'${x}'`).join(", ")})`;

const H7_SQL = `WITH ${ID_CTE},
f AS (SELECT uid, t AS f0, rating, row_number() OVER (PARTITION BY uid ORDER BY t, insert_id) AS rn FROM ev WHERE event = 'review submitted'),
f1 AS (SELECT * FROM f WHERE rn = 1 AND f0 <= TIMESTAMP '${TS(RET_BIRTH_END)}'),
r AS (SELECT f1.uid, bool_or(e.event = 'destination searched' AND e.t >= f1.f0 + INTERVAL ${RET_FROM} DAY AND e.t < f1.f0 + INTERVAL ${RET_TO} DAY) AS ret
  FROM f1 LEFT JOIN ev e ON e.uid = f1.uid GROUP BY 1)
SELECT CASE WHEN f1.rating <= ${BAD_RATING_MAX} THEN 'bad' ELSE 'ok' END AS grp, count(*) AS user_count, avg(coalesce(r.ret, false)::INT) AS retention
FROM f1 JOIN r ON r.uid = f1.uid GROUP BY 1`;

const H8_SQL = `WITH ${ID_CTE}
SELECT ${reviewCase("review_count")} AS grp, count(DISTINCT uid) AS user_count,
 count(*) FILTER (WHERE event = 'property viewed') AS views,
 count(*) FILTER (WHERE event = 'checkout started')::DOUBLE / count(*) FILTER (WHERE event = 'property viewed') AS checkout_per_view
FROM ev WHERE event IN ('property viewed', 'checkout started') GROUP BY 1`;

const H9_SQL = `WITH ${ID_CTE},
o AS (SELECT DISTINCT date::DATE AS d, region FROM ${WH("destination_supply_daily")} WHERE weather_advisory = 'hurricane_warning'),
od AS (SELECT DISTINCT d FROM o), orr AS (SELECT DISTINCT region FROM o),
w AS (SELECT t::DATE AS d, uid, event, (region IN (SELECT region FROM orr)) AS hit FROM ev
  WHERE event IN ('destination searched', 'checkout started')
    AND t >= TIMESTAMP '${TS(addDays(HURRICANE_START, -STORM_BASE_DAYS))}' AND t < TIMESTAMP '${TS(addDays(HURRICANE_END, STORM_BASE_DAYS))}'),
g AS (SELECT (d IN (SELECT d FROM od)) AS storm, hit, count(DISTINCT uid) AS users,
  count(*) FILTER (WHERE event = 'destination searched') AS searches,
  count(*) FILTER (WHERE event = 'checkout started') AS checkouts
  FROM w GROUP BY 1, 2)
SELECT 'all' AS grp, (SELECT count(*) FROM od) AS warning_days, min(users) AS user_count,
 (max(searches) FILTER (WHERE storm AND hit)::DOUBLE / max(searches) FILTER (WHERE storm AND NOT hit))
  / (max(searches) FILTER (WHERE NOT storm AND hit)::DOUBLE / max(searches) FILTER (WHERE NOT storm AND NOT hit)) AS search_did,
 (max(checkouts) FILTER (WHERE storm AND hit)::DOUBLE / max(searches) FILTER (WHERE storm AND hit))
  / (max(checkouts) FILTER (WHERE storm AND NOT hit)::DOUBLE / max(searches) FILTER (WHERE storm AND NOT hit))
  / ((max(checkouts) FILTER (WHERE NOT storm AND hit)::DOUBLE / max(searches) FILTER (WHERE NOT storm AND hit))
   / (max(checkouts) FILTER (WHERE NOT storm AND NOT hit)::DOUBLE / max(searches) FILTER (WHERE NOT storm AND NOT hit))) AS checkout_did
FROM g`;

const H10_SQL = `WITH ${ID_CTE}
SELECT CASE WHEN t >= TIMESTAMP '${TS(SALE_START)}' AND t < TIMESTAMP '${TS(SALE_END)}' THEN 'sale' ELSE 'base' END AS grp, count(DISTINCT uid) AS user_count,
 count(*) FILTER (WHERE event = 'checkout started')::DOUBLE / count(*) FILTER (WHERE event = 'destination searched') AS checkout_per_search,
 avg(nightly_rate) FILTER (WHERE event = 'booking completed') AS avg_booked_rate,
 count(*) FILTER (WHERE event = 'booking completed' AND promo_code = '${PROMO_CODE}') AS promo_bookings
FROM ev WHERE event IN ('destination searched', 'checkout started', 'booking completed')
 AND t >= TIMESTAMP '${TS(addDays(SALE_START, -SALE_BASE_DAYS))}' AND t < TIMESTAMP '${TS(addDays(SALE_END, SALE_BASE_DAYS))}'
GROUP BY 1`;

/** @type {import("../../../types").DungeonStory[]} */
export const stories = [
	{
		id: "H1-flex-pay-launch",
		hook: "H1",
		archetype: "temporal-inflection",
		narrative: `Flex Pay (book now, pay in four installments) launches ${D(FLEX_PAY_LAUNCH)}. From that day the share of checkouts that become a booking rises ${FLEX_LIFT}x (${BASE_BOOK * 100}% → ${Math.round(BASE_BOOK * FLEX_LIFT * 100)}%), and about ${FLEX_SHARE * 100}% of bookings pay with payment_method = flex_pay (never before launch). Read: booking completed per checkout started, ${D(DATASET_START)} to ${D(addDays(FLEX_PAY_LAUNCH, -1))} vs ${D(FLEX_PAY_LAUNCH)} to ${D(addDays(H1_READ_END, -1))} (the after-period stops before the August payment incident and the All-in Pricing test). Search volume, the Summer Kickoff Sale, and acquisition mix change how many sessions reach checkout, not what happens at checkout.`,
		mixpanelReport: { type: "Insights", events: ["checkout started", "booking completed"], formula: "B / A", chart: `weekly line; ${D(DATASET_START)}-${D(addDays(FLEX_PAY_LAUNCH, -1))} vs ${D(FLEX_PAY_LAUNCH)}-${D(addDays(H1_READ_END, -1))}`, breakdown: "payment_method on booking completed" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H1_SQL },
				select: { a: { where: { grp: "after" } }, b: { where: { grp: "before" } } },
				expect: { metric: "a.book_rate / b.book_rate", op: "between", target: band(FLEX_LIFT) },
				minCohort: 2000,
			},
			{
				breakdown: { type: "duckdb", sql: H1_SQL },
				select: { a: { where: { grp: "after" } } },
				expect: { metric: "a.flex_share", op: "between", target: band(FLEX_SHARE) },
				minCohort: 2000,
			},
			{
				breakdown: { type: "duckdb", sql: H1_SQL },
				select: { b: { where: { grp: "before" } } },
				// exact: Flex Pay cannot exist before launch
				expect: { metric: "b.flex_share", op: "between", target: [0, 0] },
			},
		],
	},
	{
		id: "H2-web-payment-incident",
		hook: "H2",
		archetype: "external-join",
		narrative: `From ${D(PAYMENT_INCIDENT_START)} to ${D(addDays(PAYMENT_INCIDENT_END, -1))} the payment gateway degrades for web checkouts: ${WEB_FAIL * 100}% of web checkouts fail whatever the payment method and never become a booking (most log "payment failed" with error_code = gateway_timeout). The iOS and Android apps are untouched. The incident days and platform come from warehouse payment_gateway_daily (gateway_status = 'degraded'; approval_rate ${1 - WEB_FAIL}x the platform's operational days, with attempt volume near normal). Event read: web/app ratio of booking completed per checkout started on degraded days vs the ${INC_BASE_DAYS} days either side reads 1 - ${WEB_FAIL}; the ratio cancels the All-in Pricing test (both platforms) and the weekly rhythm.`,
		mixpanelReport: { type: "Insights + warehouse", events: ["checkout started", "booking completed"], formula: "B / A", breakdown: "platform", chart: "daily line", join: "payment_gateway_daily.gateway_status on date + platform" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H2_SQL },
				select: { a: { where: { grp: "all" } } },
				// a few hundred web bookings on degraded days: knob target, half-effect ceiling
				expect: { metric: "a.did", op: "<=", target: 1 - WEB_FAIL, floor: 1 - 0.5 * WEB_FAIL },
				minCohort: 200,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT 'all' AS grp, count(*) FILTER (WHERE gateway_status = 'degraded') AS degraded_rows,
 count(DISTINCT platform) FILTER (WHERE gateway_status = 'degraded') AS degraded_platforms,
 avg(approval_rate) FILTER (WHERE gateway_status = 'degraded')
  / avg(approval_rate) FILTER (WHERE gateway_status = 'operational' AND platform IN (SELECT platform FROM ${WH("payment_gateway_daily")} WHERE gateway_status = 'degraded')) AS degraded_approval_ratio
FROM ${WH("payment_gateway_daily")}`,
				},
				select: { a: { where: { grp: "all" } } },
				// warehouse approval rate on degraded rows relative to the same platform's operational days = 1 - the failure knob
				expect: { metric: "a.degraded_approval_ratio", op: "between", target: band(1 - WEB_FAIL) },
			},
		],
	},
	{
		id: "H3-paid-channel-economics",
		hook: "H3",
		archetype: "external-join",
		narrative: `TikTok is Driftway's cheapest paid channel per signup and the most expensive per booker. Warehouse marketing_spend_daily bills each channel: half a paced daily budget (weekday shape above a ${SPEND_FLAT_SHARE * 100}% floor) and half a bid on that day's delivered signups, with seeded ±${SPEND_NOISE * 100}% day noise, so spend per Mixpanel signup comes to $${CPA_USD.google_hotel_ads} Google Hotel Ads, $${CPA_USD.meta_ads} Meta, $${CPA_USD.tiktok_ads} TikTok. About ${Math.round(TIKTOK_LOW_INTENT_SHARE * 100)}% of TikTok signups are browsers: their chance of starting checkout is a member-specific fraction (log-normal, mean ${LOW_INTENT_PROPENSITY}) of an ordinary member's, so a few of them still book. TikTok signups book within ${BOOKER_WINDOW_DAYS} days at ${TIKTOK_BOOKER_RATIO}x the rate of every other channel (the low-intent share is derived from that knob), and spend per booker is (${CPA_USD.tiktok_ads} / ${TIKTOK_BOOKER_RATIO}) / ${CPA_USD.meta_ads} = ${r3(CPA_USD.tiktok_ads / TIKTOK_BOOKER_RATIO / CPA_USD.meta_ads)}x Meta's. Read: signups ${D(DATASET_START)} to ${D(addDays(SIGNUP_READ_END, -1))} (full ${BOOKER_WINDOW_DAYS}-day window) joined to spend over the same days.`,
		mixpanelReport: { type: "Funnels + warehouse", steps: ["account created", "booking completed"], window: `${BOOKER_WINDOW_DAYS} days`, breakdown: "acquisition_channel", dateRange: `${D(DATASET_START)} to ${D(addDays(SIGNUP_READ_END, -1))}`, join: "marketing_spend_daily.spend_usd summed by acquisition_channel" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H3_SQL },
				select: { t: { where: { grp: "tiktok_ads" } }, m: { where: { grp: "meta_ads" } } },
				expect: { metric: "t.spend_per_signup / m.spend_per_signup", op: "between", target: band(CPA_USD.tiktok_ads / CPA_USD.meta_ads) },
				minCohort: 300,
			},
			{
				breakdown: { type: "duckdb", sql: H3_SQL },
				select: { t: { where: { grp: "tiktok_ads" } }, o: { where: { grp: "non_tiktok" } } },
				// about 730 TikTok signups: knob target, half-effect ceiling
				expect: { metric: "t.booker_rate / o.booker_rate", op: "<=", target: TIKTOK_BOOKER_RATIO, floor: 1 - 0.5 * (1 - TIKTOK_BOOKER_RATIO) },
				minCohort: 300,
			},
			{
				breakdown: { type: "duckdb", sql: H3_SQL },
				select: { t: { where: { grp: "tiktok_ads" } }, m: { where: { grp: "meta_ads" } } },
				// composite of two count-limited reads: knob target, half-effect floor
				expect: { metric: "t.spend_per_booker / m.spend_per_booker", op: ">=", target: r3(CPA_USD.tiktok_ads / TIKTOK_BOOKER_RATIO / CPA_USD.meta_ads), floor: r3(1 + 0.5 * (CPA_USD.tiktok_ads / TIKTOK_BOOKER_RATIO / CPA_USD.meta_ads - 1)) },
				minCohort: 300,
			},
		],
	},
	{
		id: "H4-lead-time-cancellations",
		hook: "H4",
		archetype: "funnel-conversion-by-segment",
		narrative: `The further ahead a stay is booked, the more likely it is cancelled. Each booking is cancelled with probability ${LEAD_BUCKETS.map((b) => `${CANCEL_RATE[b] * 100}% (${b} days lead)`).join(", ")}, times ${NONREFUNDABLE_CANCEL_MULT} on a non-refundable rate (${(1 - REFUNDABLE_SHARE) * 100}% of bookings, chosen independently of the traveler). Cancellations land a log-normal ${CANCEL_MEDIAN_DAYS} days (median) after the booking, within ${CANCEL_MAX_DAYS} days and before check-in. Read: per booking_id, booking completed → booking cancelled (cancellation_reason other than weather, which follows Hurricane Delia) within ${CANCEL_MAX_DAYS} days, bookings ${D(DATASET_START)} to ${D(addDays(CANCEL_READ_END, -1))} (complete windows), by lead_time_days bucket and by refundable.`,
		mixpanelReport: { type: "Funnels", steps: ["booking completed", "booking cancelled (cancellation_reason ≠ weather)"], counting: "totals", holdPropertyConstant: "booking_id", window: `${CANCEL_MAX_DAYS} days`, dateRange: `${D(DATASET_START)} to ${D(addDays(CANCEL_READ_END, -1))}`, breakdown: "lead_time_days (custom buckets 0-6, 7-29, 30-59, 60+); refundable" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H4_SQL },
				select: { l: { where: { grp: "60+" } }, m: { where: { grp: "7-29" } } },
				// several hundred cancellations per bucket (ratio SE ≈ 5%): knob target, half-effect floor
				expect: { metric: "l.cancel_rate / m.cancel_rate", op: ">=", target: r3(CANCEL_RATE["60+"] / CANCEL_RATE["7-29"]), floor: r3(1 + 0.5 * (CANCEL_RATE["60+"] / CANCEL_RATE["7-29"] - 1)) },
				minCohort: 500,
			},
			{
				breakdown: { type: "duckdb", sql: H4_SQL },
				select: { s: { where: { grp: "30-59" } }, m: { where: { grp: "7-29" } } },
				expect: { metric: "s.cancel_rate / m.cancel_rate", op: ">=", target: r3(CANCEL_RATE["30-59"] / CANCEL_RATE["7-29"]), floor: r3(1 + 0.5 * (CANCEL_RATE["30-59"] / CANCEL_RATE["7-29"] - 1)) },
				minCohort: 500,
			},
			{
				breakdown: { type: "duckdb", sql: H4_SQL },
				select: { n: { where: { grp: "non_refundable" } }, r: { where: { grp: "refundable" } } },
				// about 110 non-refundable cancellations: knob target, half-effect ceiling
				expect: { metric: "n.cancel_rate / r.cancel_rate", op: "<=", target: NONREFUNDABLE_CANCEL_MULT, floor: 1 - 0.5 * (1 - NONREFUNDABLE_CANCEL_MULT) },
				minCohort: 500,
			},
		],
	},
	{
		id: "H5-all-in-pricing-experiment",
		hook: "H5",
		archetype: "experiment-lift",
		narrative: `The "${ALLIN_EXPERIMENT}" test starts ${D(ALLIN_START)}: members are split 50/50 (sticky per member; one $experiment_started exposure 1 s before their first destination searched on or after the start, profile property "${EXP_KEY}"). The variant shows the full price with taxes and fees on search results and property pages. Two effects pull in opposite directions: search sessions reach checkout ${ALLIN_CHECKOUT_MULT}x as often (sticker shock moves earlier), and checkouts become bookings ${ALLIN_BOOK_MULT}x as often (no surprise at payment). Net bookings per search ≈ ${r3(ALLIN_CHECKOUT_MULT * ALLIN_BOOK_MULT)}x by design; arms are hashed per member, so a raw net read also carries the arms' member mix (compare each arm with itself before the start). Read: per search_id, searches ${D(ALLIN_START)} to ${D(addDays(EXP_READ_END, -1))} with a full ${EXP_WINDOW_DAYS}-day window, by arm.`,
		mixpanelReport: { type: "Funnels", steps: ["destination searched", "checkout started", "booking completed"], counting: "totals", holdPropertyConstant: "search_id", window: `${EXP_WINDOW_DAYS} days`, dateRange: `${D(ALLIN_START)} to ${D(addDays(EXP_READ_END, -1))}`, breakdown: `user property "${EXP_KEY}"`, alt: "Experiments report on $experiment_started" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H5_SQL },
				select: { v: { where: { grp: ALLIN_VARIANT } }, c: { where: { grp: "Control" } } },
				expect: { metric: "v.checkout_rate / c.checkout_rate", op: "between", target: band(ALLIN_CHECKOUT_MULT) },
				minCohort: 2000,
			},
			{
				breakdown: { type: "duckdb", sql: H5_SQL },
				select: { v: { where: { grp: ALLIN_VARIANT } }, c: { where: { grp: "Control" } } },
				expect: { metric: "v.book_rate / c.book_rate", op: "between", target: band(ALLIN_BOOK_MULT) },
				minCohort: 2000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count, count(*) - count(DISTINCT uid) AS repeat_exposures,
 count(DISTINCT uid) FILTER (WHERE "Variant name" = '${ALLIN_VARIANT}')::DOUBLE / count(DISTINCT uid) AS variant_share,
 count(*) FILTER (WHERE t < TIMESTAMP '${TS(ALLIN_START)}') AS early
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
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count, (count(*) - count(DISTINCT uid)) + count(*) FILTER (WHERE t < TIMESTAMP '${TS(ALLIN_START)}') AS impure
FROM ev WHERE event = '$experiment_started'`,
				},
				select: { a: { where: { grp: "all" } } },
				// exact: one exposure per member, none before the start
				expect: { metric: "a.impure", op: "between", target: [0, 0] },
			},
		],
	},
	{
		id: "H6-booking-speed-by-segment",
		hook: "H6",
		archetype: "funnel-ttc-by-segment",
		narrative: `Business travelers book fast and families deliberate. The time from destination searched to booking completed in the same search session (search_id) is log-normal (median ${SEARCH_TO_BOOK_MEDIAN_H} h for couples and solo travelers), times ${SEGMENT_GAP_MULT.business} for business travelers and ${SEGMENT_GAP_MULT.family} for families (profile traveler_segment). Read: median hours from search to booking per search_id, within ${TTC_WINDOW_DAYS} days, searches through ${D(addDays(TTC_READ_END, -1))} (complete windows); baseline = couple + solo.`,
		mixpanelReport: { type: "Funnels", steps: ["destination searched", "booking completed"], counting: "totals", holdPropertyConstant: "search_id", window: `${TTC_WINDOW_DAYS} days`, dateRange: `${D(DATASET_START)} to ${D(addDays(TTC_READ_END, -1))}`, measure: "median time to convert", breakdown: "user property traveler_segment" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H6_SQL },
				select: { s: { where: { grp: "business" } }, b: { where: { grp: "baseline" } } },
				expect: { metric: "s.med_hours / b.med_hours", op: "between", target: band(SEGMENT_GAP_MULT.business) },
				minCohort: 500,
			},
			{
				breakdown: { type: "duckdb", sql: H6_SQL },
				select: { f: { where: { grp: "family" } }, b: { where: { grp: "baseline" } } },
				expect: { metric: "f.med_hours / b.med_hours", op: "between", target: band(SEGMENT_GAP_MULT.family) },
				minCohort: 500,
			},
		],
	},
	{
		id: "H7-bad-stay-churn",
		hook: "H7",
		archetype: "retention-divergence",
		narrative: `A bad stay costs a customer. After a review rated ${BAD_RATING_MAX} stars or less, the member stops planning trips with probability ${BAD_STAY_CHURN}, ${CHURN_DAY_MIN}-${CHURN_DAY_MAX} days later (no more searches, views, bookings, or reviews; stays already booked still happen and server-side messages keep arriving). Ratings are drawn independently of the traveler. Read: members grouped by the rating on their FIRST review in the window (on or before ${D(RET_BIRTH_END)} so the bracket is complete); retained = any destination searched on day ${RET_FROM}-${RET_TO - 1} after it. Later bad reviews can take either group away the same way, so the ratio (1-${BAD_RATING_MAX} stars over 3-5 stars) reads 1 - ${BAD_STAY_CHURN}.`,
		mixpanelReport: { type: "Retention", birth: "review submitted (first time)", return: "destination searched", breakdown: `birth-event property rating (≤ ${BAD_RATING_MAX} vs ≥ ${BAD_RATING_MAX + 1})`, brackets: `custom: day ${RET_FROM}-${RET_TO - 1}`, dateRange: `births ${D(DATASET_START)} to ${D(RET_BIRTH_END)}` },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H7_SQL },
				select: { b: { where: { grp: "bad" } }, o: { where: { grp: "ok" } } },
				// about 400 members with a bad first review (ratio SE ≈ 7%): knob target, half-effect ceiling
				expect: { metric: "b.retention / o.retention", op: "<=", target: 1 - BAD_STAY_CHURN, floor: 1 - 0.5 * BAD_STAY_CHURN },
				minCohort: 300,
			},
		],
	},
	{
		id: "H8-review-count-threshold",
		hook: "H8",
		archetype: "cohort-prop-scale",
		narrative: `Travelers do not book places nobody has reviewed. A search session reaches checkout with a chance scaled by the review_count the last property viewed showed that day. The factor ramps smoothly around 10 and 50 reviews (logistic in ln reviews); its average over property views in each bucket is ${REVIEW_BUCKETS.map((b) => `${b} reviews ${REVIEW_CHECKOUT_K[b]}`).join(", ")}. review_count is a daily snapshot that grows with each listing's reviews, and ${NEW_LISTING_SHARE * 100}% of listings go live during the window with none, so every bucket has views all window. Properties are drawn independently of the traveler and of their position in the session, so checkouts per property view by review bucket read the bucket averages.`,
		mixpanelReport: { type: "Insights", events: ["property viewed", "checkout started"], formula: "B / A", breakdown: "review_count (custom buckets 0-9, 10-49, 50+)" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H8_SQL },
				select: { lo: { where: { grp: "0-9" } }, hi: { where: { grp: "50+" } } },
				expect: { metric: "lo.checkout_per_view / hi.checkout_per_view", op: "between", target: band(REVIEW_CHECKOUT_K["0-9"]) },
				minCohort: 2000,
			},
			{
				breakdown: { type: "duckdb", sql: H8_SQL },
				select: { mid: { where: { grp: "10-49" } }, hi: { where: { grp: "50+" } } },
				expect: { metric: "mid.checkout_per_view / hi.checkout_per_view", op: "between", target: band(REVIEW_CHECKOUT_K["10-49"]) },
				minCohort: 2000,
			},
		],
	},
	{
		id: "H9-hurricane-delia",
		hook: "H9",
		archetype: "external-join",
		narrative: `Hurricane Delia: warehouse destination_supply_daily posts weather_advisory = 'hurricane_warning' for the ${HURRICANE_REGION} region ${D(HURRICANE_START)} to ${D(addDays(HURRICANE_END, -1))} (partners also pull ${Math.round((1 - HURRICANE_ROOMS_K) * 100)}% of rooms). During the warnings only ${HURRICANE_SEARCH_KEEP * 100}% of Caribbean search sessions happen, the ones that do reach checkout ${HURRICANE_CHECKOUT_K}x as often, and ${HURRICANE_CANCEL * 100}% of Caribbean stays checking in during the warnings (booked before ${D(HURRICANE_CANCEL_FROM)}) are cancelled from ${D(HURRICANE_CANCEL_FROM)} with cancellation_reason = weather. Reads relative to other regions, warning days vs the ${STORM_BASE_DAYS} days either side: Caribbean searches ${HURRICANE_SEARCH_KEEP}x; checkouts per search ${HURRICANE_CHECKOUT_K}x. The checkout read rests on a few dozen Caribbean checkouts, so it uses the knob as target with a half-effect ceiling.`,
		mixpanelReport: { type: "Insights + warehouse", events: ["destination searched", "checkout started"], breakdown: "region", chart: "daily line", join: "destination_supply_daily.weather_advisory on date + region" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H9_SQL },
				select: { a: { where: { grp: "all" } } },
				// a few hundred Caribbean searches on warning days (SE ≈ 5%): knob target, half-effect ceiling
				expect: { metric: "a.search_did", op: "<=", target: HURRICANE_SEARCH_KEEP, floor: 1 - 0.5 * (1 - HURRICANE_SEARCH_KEEP) },
				minCohort: 300,
			},
			{
				breakdown: { type: "duckdb", sql: H9_SQL },
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.checkout_did", op: "<=", target: HURRICANE_CHECKOUT_K, floor: 1 - 0.5 * (1 - HURRICANE_CHECKOUT_K) },
				minCohort: 300,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT 'all' AS grp, count(*) FILTER (WHERE weather_advisory = 'hurricane_warning') AS warning_rows,
 count(DISTINCT region) FILTER (WHERE weather_advisory = 'hurricane_warning') AS warning_regions,
 avg(rooms_listed) FILTER (WHERE weather_advisory = 'hurricane_warning') / avg(rooms_listed) FILTER (WHERE region = '${HURRICANE_REGION}' AND weather_advisory = 'none') AS rooms_ratio
FROM ${WH("destination_supply_daily")}`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.rooms_ratio", op: "between", target: band(HURRICANE_ROOMS_K) },
			},
		],
	},
	{
		id: "H10-summer-kickoff-sale",
		hook: "H10",
		archetype: "temporal-inflection",
		narrative: `The Summer Kickoff Sale runs ${D(SALE_START)} to ${D(addDays(SALE_END, -1))}: every stay shows ${SALE_DISCOUNT * 100}% off (nightly_rate on views, checkouts, and bookings; bookings carry promo_code = ${PROMO_CODE}). Members subscribed to marketing email get a launch email and a reminder (${SALE_PUSH_TIMES.map(D).join(", ")}), plus a push when they allow push; ${SALE_PUSH_RESPONSE * 100}% of pushed members move their next search up to right after the push. During the sale, search sessions reach checkout ${SALE_CHECKOUT_LIFT}x as often. Reads vs the ${SALE_BASE_DAYS} days either side (all before Flex Pay): checkouts per search ${SALE_CHECKOUT_LIFT}x; average booked nightly_rate ${1 - SALE_DISCOUNT}x.`,
		mixpanelReport: { type: "Insights", events: ["destination searched", "checkout started", "booking completed"], formula: "B / A; average nightly_rate on C", chart: `daily line ${D(addDays(SALE_START, -SALE_BASE_DAYS))} to ${D(addDays(SALE_END, SALE_BASE_DAYS - 1))}`, breakdown: "promo_code; notification received by campaign" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H10_SQL },
				select: { s: { where: { grp: "sale" } }, b: { where: { grp: "base" } } },
				expect: { metric: "s.checkout_per_search / b.checkout_per_search", op: "between", target: band(SALE_CHECKOUT_LIFT) },
				minCohort: 2000,
			},
			{
				breakdown: { type: "duckdb", sql: H10_SQL },
				select: { s: { where: { grp: "sale" } }, b: { where: { grp: "base" } } },
				expect: { metric: "s.avg_booked_rate / b.avg_booked_rate", op: "between", target: band(1 - SALE_DISCOUNT) },
				minCohort: 2000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 count(*) FILTER (WHERE campaign = 'summer_kickoff_sale' AND (t < TIMESTAMP '${TS(SALE_START)}' OR t >= TIMESTAMP '${TS(SALE_END)}')) AS stray_sends
FROM ev WHERE event = 'notification received' AND campaign = 'summer_kickoff_sale'`,
				},
				select: { a: { where: { grp: "all" } } },
				// exact: campaign sends happen only on sale days
				expect: { metric: "a.stray_sends", op: "between", target: [0, 0] },
			},
		],
	},
];

export default config;
