// ── IMPORTS ──
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);
import "dotenv/config";
import * as u from "@ak--47/dungeon-master/utils";
import * as v from "ak-tools";
/** @typedef  {import("../../../types").Dungeon} Config */

// ── OVERVIEW ──
/*
 * NAME:       StayQuest
 * APP:        Hotel booking platform for business and leisure travelers.
 *             Users search destinations, compare hotels, book rooms, and leave
 *             reviews. Revenue from commission per booking plus premium loyalty
 *             membership. Four traveler archetypes: business, leisure family,
 *             luxury, budget.
 * SCALE:      10,000 users, ~990K events, 121 days (2026-01-01 → 2026-05-01)
 * CORE LOOP:  search → view hotel → compare → book → stay → review
 *
 * EVENTS (17):
 *   destination searched (8) > hotel viewed (7) > app session (7) > notification received (5)
 *   > price compared (4) > amenity used (4) > booking completed (3) > wishlist updated (3)
 *   > room upgrade selected (2) > booking cancelled (2) > check in completed (2)
 *   > review submitted (2) > price alert set (2) > account created (1)
 *   > loyalty points redeemed (1) > support contacted (1) > account deactivated (1)
 *
 * FUNNELS (5):
 *   - Onboarding to First Booking: account created → destination searched → hotel viewed → booking completed (35%)
 *   - Search to Book:              destination searched → hotel viewed → price compared → booking completed (25%)
 *   - Full Stay Journey:           booking completed → check in completed → amenity used → review submitted (30%)
 *   - Loyalty Engagement:          booking completed → loyalty points redeemed → review submitted (15%)
 *   - Upsell Path:                 hotel viewed → booking completed → room upgrade selected (20%)
 *
 * USER PROPS:  customer_segment, travel_frequency, company_name, preferred_destination,
 *              avg_budget_per_night, Platform, membership_tier
 * SUPER PROPS: Platform, membership_tier
 * SCD PROPS:   membership_tier (member/silver/gold/platinum, monthly fuzzy, max 8)
 * GROUPS:      none
 */

// ── HOOK STORIES ──
/*
 * NOTE: All cohort effects are HIDDEN — no flag stamping. Discoverable via
 * raw-prop breakdowns (booking_window, day, segment) or behavioral cohorts.
 *
 * ───────────────────────────────────────────────────────────────
 * 1. WEEKEND LEISURE SURGE (everything)
 * ───────────────────────────────────────────────────────────────
 * PATTERN: Weekend bookings (Fri-Sun) get 1.3x higher nightly_rate
 * due to leisure demand pricing.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *   Report 1: Weekend vs Weekday Rates
 *   • Report type: Insights
 *   • Event: "booking completed"
 *   • Measure: Average of "nightly_rate"
 *   • Breakdown: Day of week
 *   • Expected: Fri-Sun avg ≈ 1.3x Mon-Thu avg (both arms mix H2's
 *     window factors near-identically, so the day-of-week ratio reads
 *     the knob clean; "hotel viewed" carries the same nightly_rate
 *     prop untouched — the placebo arm)
 *
 * REAL-WORLD ANALOGUE: Hotels use dynamic pricing with higher
 * weekend rates driven by leisure traveler demand.
 *
 * ───────────────────────────────────────────────────────────────
 * 2. ADVANCE BOOKING DISCOUNT (everything)
 * ───────────────────────────────────────────────────────────────
 * PATTERN: Bookings made > 21 days before the dataset end get 0.8x
 * nightly_rate and booking_window overwritten to "advance". Bookings
 * < 3 days before the end get 1.4x and "last_minute". Bookings in the
 * middle band (3-21 days out) KEEP their organic booking_window label
 * (2/5 advance, 2/5 standard, 1/5 last_minute) with untouched rates —
 * so a naive breakdown by booking_window dilutes both treated labels
 * (roughly half of last_minute-LABELED bookings are organic
 * middle-band ones). The clean read is by calendar region.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *   Report 1: Rate by Booking Window (label view — diluted)
 *   • Report type: Insights
 *   • Event: "booking completed"
 *   • Measure: Average of "nightly_rate"
 *   • Breakdown: "booking_window"
 *   • Expected: last_minute vs advance ≈ 1.45x (label mix dilutes
 *     the raw 1.4/0.8 = 1.75x factor ratio)
 *   Report 2: Rate by calendar date (region view — clean)
 *   • Same measure, X-axis: day
 *   • Expected: advance region ≈ 0.79x the middle band; last-minute
 *     region (final 3 days) ≈ 1.35x the middle band (weekend-mix
 *     corrected — the last 3 days are Wed/Thu/Fri)
 *
 * REAL-WORLD ANALOGUE: Hotels offer early-bird discounts and charge
 * premiums for last-minute availability.
 *
 * ───────────────────────────────────────────────────────────────
 * 3. LOYALTY TIER UPGRADE PATH (everything)
 * ───────────────────────────────────────────────────────────────
 * PATTERN: Users with 5+ bookings get boosted loyalty_points on all
 * booking events (3x the baseline).
 *
 * HOW TO FIND IT IN MIXPANEL:
 *   Report 1: Loyalty Points by Booking Frequency
 *   • Report type: Insights
 *   • Event: "booking completed"
 *   • Measure: Average of "loyalty_points"
 *   • Breakdown: user property "customer_segment"
 *   • Expected: power users ≈ 3x points vs casuals
 *
 * REAL-WORLD ANALOGUE: Hotel loyalty programs accelerate rewards
 * for frequent guests, creating a flywheel.
 *
 * ───────────────────────────────────────────────────────────────
 * 4. CANCELLATION BY BOOKING WINDOW (everything)
 * ───────────────────────────────────────────────────────────────
 * PATTERN: Each "booking cancelled" is stamped with the booking_window
 * of the user's nearest PRECEDING "booking completed"; cancellations
 * whose label lands on "last_minute" then have 60% dropped — committed
 * last-minute bookers rarely cancel. Advance/standard-labeled
 * cancellations are all kept.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *   Report 1: Cancellation Rate by Window
 *   • Report type: Funnels
 *   • Steps: "booking completed" → "booking cancelled"
 *   • Breakdown: "booking_window"
 *   • Expected: last_minute ~8% cancel vs advance ~20% cancel
 *
 * REAL-WORLD ANALOGUE: Last-minute bookers are committed;
 * advance bookers have more flexible cancellation policies.
 *
 * ───────────────────────────────────────────────────────────────
 * 5. UPSELL SUCCESS BY SEGMENT (everything)
 * ───────────────────────────────────────────────────────────────
 * PATTERN: After a booking, luxury_seeker users get cloned "room
 * upgrade selected" events injected. Budget users rarely see upsells.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *   Report 1: Upgrade Rate by Segment
 *   • Report type: Insights
 *   • Event: "room upgrade selected"
 *   • Measure: Total per user
 *   • Breakdown: user property "customer_segment"
 *   • Expected: luxury_seeker ≈ 12x upgrades vs budget_hunter — the
 *     organic upsell base is thin (~0.08 upgrades per booking), so the
 *     50%-per-booking clone injection dominates; the clean knob read is
 *     the upgrades-per-booking DIFFERENCE (≈ +0.5), not the ratio
 *
 * REAL-WORLD ANALOGUE: Luxury travelers are receptive to premium
 * upsells (suite upgrades, spa packages).
 *
 * ───────────────────────────────────────────────────────────────
 * 6. REVIEW QUALITY BY STAY RATING (everything)
 * ───────────────────────────────────────────────────────────────
 * PATTERN: Users whose avg stay_rating is >= 4 have longer review_length
 * (1.5x words). Low-rating users write shorter, negative reviews.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *   Report 1: Review Length vs Stay Rating
 *   • Report type: Insights
 *   • Event: "review submitted"
 *   • Measure: Average of "review_length"
 *   • Breakdown: "stay_rating"
 *   • Expected: users with avg rating >= 4 write ≈ 1.5x the baseline
 *     length, avg rating <= 2 ≈ 0.5x (review_length pool mean ≈ 160
 *     words → high arm ≈ 240, low arm ≈ 80; mid arm untouched)
 *
 * REAL-WORLD ANALOGUE: Satisfied guests write detailed positive
 * reviews; dissatisfied guests write brief complaints.
 *
 * ───────────────────────────────────────────────────────────────
 * 7. BUSINESS TRAVELER PROFILE (user)
 * ───────────────────────────────────────────────────────────────
 * PATTERN: Users in business_traveler segment get company_name set
 * to a realistic company and travel_frequency to "weekly".
 *
 * HOW TO FIND IT IN MIXPANEL:
 *   Report 1: Travel Frequency by Segment
 *   • Report type: Insights
 *   • Measure: Profiles → Breakdown by "travel_frequency"
 *   • Filter: customer_segment = "business_traveler"
 *   • Expected: 100% weekly for business, mixed for others
 *
 * REAL-WORLD ANALOGUE: Business travelers have corporate accounts
 * with consistent, high-frequency booking patterns.
 *
 * ───────────────────────────────────────────────────────────────
 * 8. REPEAT DESTINATION CLUSTERING (everything — event filtering)
 * ───────────────────────────────────────────────────────────────
 * PATTERN: Non-business/luxury users have ~25% of "booking completed"
 * events dropped, simulating lower funnel conversion for casual segments.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *   Report 1: Conversion by Segment
 *   • Report type: Funnels
 *   • Steps: "destination searched" → "hotel viewed" → "booking completed"
 *   • Breakdown: user property "customer_segment"
 *   • Expected: business_traveler ≈ 52% vs budget_hunter ≈ 30%
 *
 * REAL-WORLD ANALOGUE: Business travelers book the same hotels
 * repeatedly, leading to faster, more confident conversions.
 *
 * ───────────────────────────────────────────────────────────────
 * 9. BOOKING TIME-TO-CONVERT (funnel-post)
 * ───────────────────────────────────────────────────────────────
 *
 * PATTERN: Business travelers complete the Search-to-Book funnel
 * 1.35x faster (time gaps scaled by 0.74). Budget and leisure-family
 * users complete it 1.25x slower (gaps scaled by 1.25). The hook
 * iterates over the funnel-post event array, compresses or stretches
 * the inter-step time gaps based on the user's customer_segment from
 * meta.profile, then rewrites each event's timestamp. Scoped to the
 * "Search to Book" funnel only (v1.6) — v1.5 stretched every funnel,
 * leaking an undocumented segment-speed pattern into the other four.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Search-to-Book TTC by Segment
 *   - Report type: Funnels
 *   - Steps: "destination searched" -> "hotel viewed" -> "price compared" -> "booking completed"
 *   - Breakdown: user property "customer_segment"
 *   - Metric: Median time to convert
 *   - Expected: business_traveler median TTC ~ 0.74x of budget/leisure TTC
 *     (e.g., business ~ 24h vs budget ~ 43h)
 *
 *   NOTE: Cross-event MIN->MIN SQL on raw events does NOT show this —
 *   greedy pairing crosses funnel instances and buries the signal. The
 *   story asserts the delta through the Mixpanel-aligned emulator
 *   (timeToConvert) at a 60h conversion window: 48h generative window
 *   x the 1.25 max stretch, covering the stretched support so the
 *   slow arm is not censored into a fake speedup.
 *
 * REAL-WORLD ANALOGUE: Business travelers know their preferred hotel
 * chains and corporate rates, moving from search to booking with
 * minimal comparison. Leisure and budget travelers deliberate longer,
 * comparing options and waiting for deals.
 *
 * ───────────────────────────────────────────────────────────────
 * 10. HOTEL-VIEWED MAGIC NUMBER (everything)
 * ───────────────────────────────────────────────────────────────
 *
 * PATTERN: Users who viewed 5-10 hotels sit in a "decisive comparison
 * shopper" sweet spot -- all their nightly_rate values on "booking
 * completed" events are boosted by +30% (factor 1.3), indicating they
 * chose higher-tier rooms after deliberate comparison. Users who
 * viewed 11+ hotels hit analysis-paralysis burnout from day 60
 * (HOTEL_FATIGUE_START_DAY, 2026-03-02): 35% of their "booking
 * completed" events on/after that day are dropped. No flag is
 * stamped -- discoverable only by binning users on hotel-viewed
 * COUNT and comparing booking rates or before/after booking volume.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Nightly Rate by Hotel-View Cohort
 *   - Report type: Insights (with cohorts)
 *   - Cohort A: users who did "hotel viewed" 5-10 times
 *   - Cohort B: users who did "hotel viewed" 0-4 times
 *   - Event: "booking completed"
 *   - Measure: Average of "nightly_rate"
 *   - Compare cohort A vs cohort B
 *   - Expected: cohort A ~ 1.3x higher avg nightly_rate
 *
 *   Report 2: Booking Volume Collapse After Day 60
 *   - Report type: Insights (with cohorts)
 *   - Cohort C: users who did "hotel viewed" 11+ times
 *   - Cohort A: users who did "hotel viewed" 5-10 times
 *   - Event: "booking completed", normalized by "app session"
 *   - X-axis: month; compare each cohort's own after-Mar-2 /
 *     before-Mar-2 bookings-per-session ratio
 *   - Expected: cohort C's ratio ≈ 0.65x cohort A's ratio (the keep
 *     rate). A straight cohort-C-vs-A level comparison does NOT work:
 *     view count is activity-coupled, so heavy viewers book more per
 *     capita organically whatever the denominator — only the
 *     difference-in-differences isolates the drop.
 *
 * REAL-WORLD ANALOGUE: Travelers who compare a handful of hotels
 * make confident, higher-value bookings; those who endlessly browse
 * suffer decision fatigue and often abandon the search entirely.
 *
 * ═══════════════════════════════════════════════════════════════
 * EXPECTED METRICS SUMMARY (Measured = full fidelity, 10K users / 991,659 events)
 * ═══════════════════════════════════════════════════════════════
 *
 * Story id                | Metric                                    | Expected      | Measured
 * ────────────────────────|───────────────────────────────────────────|───────────────|─────────
 * H1-weekend-rate-surge   | wkn/wkd booking nightly_rate ratio        | ≈1.3          | 1.293
 *                         | placebo: hotel viewed wkn/wkd ratio       | ≈1.0          | 1.001
 * H2-booking-window       | advance-region / middle-band rate         | ≈0.79         | 0.784
 *                         | last-minute-region / middle-band rate     | ≈1.35         | 1.408
 * H3-loyalty-boost        | 5+-booking / 1-4-booking loyalty_points   | ≈3.0          | 2.942
 * H4-cancel-by-window     | last_minute cancel keep vs organic mix    | ≈0.4          | 0.484
 *                         | placebo: advance/standard cancel ratio    | ≈1.0          | 0.892
 * H5-luxury-upsell        | lux − budget upgrades-per-booking         | ≈+0.5         | +0.496
 *                         | lux / budget upgrades-per-user            | ≈12x          | 12.68x
 * H6-review-quality       | high-avg / mid review_length              | ≈1.5          | 1.497
 *                         | low-avg / mid review_length               | ≈0.5          | 0.510
 * H7-business-profile     | biz weekly + company share                | 100%          | 100%
 * H8-casual-booking-drop  | zero-booking inflation (treated−control)  | ≈+0.25        | +0.241
 *                         | funnel conversion biz/budget              | ≈1.9x         | 2.46x
 * H9-booking-ttc          | Search-to-Book median TTC biz/lux         | ≈0.74         | 0.900
 *                         | Search-to-Book median TTC budget/lux      | ≈1.25         | 1.061
 * H10-hotel-view-magic    | sweet/low nightly_rate (advance region)   | ≈1.3          | 1.311
 *                         | DiD bookings-per-session over vs sweet    | ≈0.65         | 0.613
 */

// ── SCALE ──
const SEED = "dm4-travel";
const NUM_USERS = 10_000;
const DATASET_START = "2026-01-01T00:00:00Z";
const DATASET_END = "2026-05-01T23:59:59Z";
const EVENTS_PER_DAY = 1.2;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── KNOBS (tweak these to reshape stories) ──
const WEEKEND_RATE_BOOST = 1.3;
const ADVANCE_DAYS_THRESHOLD = 21;
const ADVANCE_RATE_FACTOR = 0.8;
const LAST_MINUTE_DAYS_THRESHOLD = 3;
const LAST_MINUTE_RATE_FACTOR = 1.4;
const LOYALTY_BOOKING_THRESHOLD = 5;
const LOYALTY_POINT_BASE_MULT = 2.5;
const LOYALTY_POINT_VARIANCE = 1.0;
const REPEAT_DEST_DROP_LIKELIHOOD = 25;
const CANCEL_LAST_MINUTE_DROP_LIKELIHOOD = 60;
const UPSELL_LUXURY_LIKELIHOOD = 50;
const REVIEW_HIGH_RATING_THRESHOLD = 4;
const REVIEW_LOW_RATING_THRESHOLD = 2;
const REVIEW_HIGH_LENGTH_MULT = 1.5;
const REVIEW_LOW_LENGTH_MULT = 0.5;
const HOTEL_SWEET_MIN = 5;
const HOTEL_SWEET_MAX = 10;
const HOTEL_OVER_THRESHOLD = 11;
const HOTEL_SWEET_RATE_BOOST = 1.3;
const HOTEL_OVER_BOOKING_DROP_LIKELIHOOD = 35;
// H10's booking drop is CALENDAR-SCOPED (bookings on/after this dataset day).
// Hotel-view count is intrinsically activity-coupled — more views means more
// of everything — so no cross-sectional denominator can separate a 35%
// booking drop from organic activity composition (community.js proved this
// confound class). An in-window calendar edge turns the read into a
// difference-in-differences: each arm's own after/before bookings-per-session
// ratio cancels its activity composition.
const HOTEL_FATIGUE_START_DAY = 60;
const TTC_BUSINESS_FACTOR = 0.74;
const TTC_LEISURE_BUDGET_FACTOR = 1.25;

// ── DATA ARRAYS ──
const hotelIds = v.range(1, 200).map(() => `HTL_${v.uid(6)}`);
const destinationCities = ["New York", "London", "Paris", "Tokyo", "Barcelona", "Dubai", "Sydney", "Rome", "Bangkok", "Cancun", "Bali", "Amsterdam", "Miami", "Singapore", "Lisbon"];

// ── HELPER FUNCTIONS ──
function handleUserHooks(record) {
	// H7: BUSINESS TRAVELER PROFILE
	if (record.customer_segment === "business_traveler") {
		record.company_name = chance.pickone(["Acme Corp", "GlobalTech", "Initech", "Prestige Consulting", "Summit Partners", "Atlas Industries"]);
		record.travel_frequency = "weekly";
	} else if (record.customer_segment === "luxury_seeker") {
		record.avg_budget_per_night = chance.integer({ min: 250, max: 500 });
	} else if (record.customer_segment === "budget_hunter") {
		record.avg_budget_per_night = chance.integer({ min: 50, max: 120 });
	}
	return record;
}

function handleFunnelPostHooks(record, meta) {
	// H9: BOOKING TIME-TO-CONVERT — business 1.35x faster (0.74),
	// leisure_family/budget 1.25x slower. Scoped to the Search to Book funnel
	// only: the documented story (and the Mixpanel report it teaches) is
	// Search-to-Book median TTC — stretching every funnel leaked an
	// undocumented segment-speed pattern into Onboarding/Full Stay/Loyalty/
	// Upsell and polluted their TTC distributions.
	if (meta?.funnel?.name !== "Search to Book") return record;
	const segment = meta?.profile?.customer_segment;
	if (Array.isArray(record) && record.length > 1) {
		const factor = (
			segment === "business_traveler" ? TTC_BUSINESS_FACTOR :
			segment === "budget_hunter" || segment === "leisure_family" ? TTC_LEISURE_BUDGET_FACTOR :
			1.0
		);
		if (factor !== 1.0) {
			for (let i = 1; i < record.length; i++) {
				const prev = dayjs(record[i - 1].time);
				const newGap = Math.round(dayjs(record[i].time).diff(prev) * factor);
				record[i].time = prev.add(newGap, "milliseconds").toISOString();
			}
		}
	}
	return record;
}

function handleEverythingHooks(record, meta) {
	const events = record;
	if (!events.length) return record;

	const profile = meta.profile;

	// Stamp superProps from profile (consistent per user)
	const stampPlatform = profile && profile.Platform ? profile.Platform : undefined;
	const stampTier = profile && profile.membership_tier ? profile.membership_tier : undefined;
	if (stampPlatform || stampTier) {
		events.forEach(e => {
			if (stampPlatform) e.Platform = stampPlatform;
			if (stampTier) e.membership_tier = stampTier;
		});
	}

	// H1: WEEKEND LEISURE SURGE — Fri/Sat/Sun bookings get +30% rate
	events.forEach(e => {
		if (e.event === "booking completed") {
			const dayOfWeek = new Date(e.time).getUTCDay();
			// Friday=5, Saturday=6, Sunday=0
			if (dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6) {
				e.nightly_rate = Math.floor((e.nightly_rate || 150) * WEEKEND_RATE_BOOST);
				e.total_cost = Math.floor((e.total_cost || 450) * WEEKEND_RATE_BOOST);
			}
		}
	});

	// H2: ADVANCE BOOKING DISCOUNT
	const datasetEndForBooking = dayjs.unix(meta.datasetEnd);
	events.forEach(e => {
		if (e.event === "booking completed") {
			const eventTime = dayjs(e.time);
			const daysUntilEnd = datasetEndForBooking.diff(eventTime, "days");
			if (daysUntilEnd > ADVANCE_DAYS_THRESHOLD) {
				e.booking_window = "advance";
				e.nightly_rate = Math.floor((e.nightly_rate || 150) * ADVANCE_RATE_FACTOR);
			} else if (daysUntilEnd < LAST_MINUTE_DAYS_THRESHOLD) {
				e.booking_window = "last_minute";
				e.nightly_rate = Math.floor((e.nightly_rate || 150) * LAST_MINUTE_RATE_FACTOR);
			}
		}
	});

	// H8: REPEAT DESTINATION CLUSTERING — drop ~25% of "booking completed"
	// for non-business/luxury users.
	const segment = profile && profile.customer_segment;
	if (segment !== "business_traveler" && segment !== "luxury_seeker"
			&& chance.bool({ likelihood: REPEAT_DEST_DROP_LIKELIHOOD })) {
		for (let i = events.length - 1; i >= 0; i--) {
			if (events[i].event === "booking completed") {
				events.splice(i, 1);
			}
		}
	}

	// H3: LOYALTY TIER UPGRADE PATH — 5+ bookings → ~3x loyalty_points
	let bookingCount = 0;
	events.forEach(e => { if (e.event === "booking completed") bookingCount++; });
	if (bookingCount >= LOYALTY_BOOKING_THRESHOLD) {
		events.forEach(e => {
			if (e.event === "booking completed" && e.loyalty_points) {
				e.loyalty_points = Math.floor(e.loyalty_points * (LOYALTY_POINT_BASE_MULT + chance.floating({ min: 0, max: LOYALTY_POINT_VARIANCE })));
			}
		});
	}

	// H4: CANCELLATION BY BOOKING WINDOW — copy nearest preceding booking's
	// booking_window onto each cancellation, then drop 60% of last-minute cancels.
	const bookingsByTime = events
		.filter(e => e.event === "booking completed")
		.sort((a, b) => new Date(a.time) - new Date(b.time));
	events.forEach(e => {
		if (e.event === "booking cancelled" && bookingsByTime.length > 0) {
			const cancelTime = new Date(e.time).getTime();
			let matched = bookingsByTime[0];
			for (let b = bookingsByTime.length - 1; b >= 0; b--) {
				if (new Date(bookingsByTime[b].time).getTime() <= cancelTime) {
					matched = bookingsByTime[b];
					break;
				}
			}
			e.booking_window = matched.booking_window;
		}
	});
	for (let i = events.length - 1; i >= 0; i--) {
		if (events[i].event === "booking cancelled" && events[i].booking_window === "last_minute") {
			if (chance.bool({ likelihood: CANCEL_LAST_MINUTE_DROP_LIKELIHOOD })) {
				events.splice(i, 1);
			}
		}
	}

	// H5: UPSELL SUCCESS BY SEGMENT — luxury_seeker users get cloned upgrades
	if (profile && profile.customer_segment === "luxury_seeker") {
		const templateUpgrade = events.find(e => e.event === "room upgrade selected");
		if (templateUpgrade) {
			const bookings = events.filter(e => e.event === "booking completed");
			bookings.forEach(booking => {
				if (chance.bool({ likelihood: UPSELL_LUXURY_LIKELIHOOD })) {
					events.push({
						...templateUpgrade,
						time: dayjs(booking.time).add(chance.integer({ min: 1, max: 30 }), "minutes").toISOString(),
						user_id: booking.user_id,
						upgrade_cost: chance.integer({ min: 75, max: 200 }),
						insert_id: chance.guid(),
					});
				}
			});
		}
	}

	// H6: REVIEW QUALITY BY STAY RATING — high avg → 1.5x review_length;
	// low avg → 0.5x.
	let totalRating = 0;
	let ratingCount = 0;
	events.forEach(e => {
		if (e.event === "review submitted" && e.stay_rating) {
			totalRating += e.stay_rating;
			ratingCount++;
		}
	});
	const avgRating = ratingCount > 0 ? totalRating / ratingCount : 3;
	events.forEach(e => {
		if (e.event === "review submitted") {
			if (avgRating >= REVIEW_HIGH_RATING_THRESHOLD) {
				e.review_length = Math.floor((e.review_length || 120) * REVIEW_HIGH_LENGTH_MULT);
			} else if (avgRating <= REVIEW_LOW_RATING_THRESHOLD) {
				e.review_length = Math.floor((e.review_length || 120) * REVIEW_LOW_LENGTH_MULT);
			}
		}
	});

	// H10: HOTEL-VIEWED MAGIC NUMBER — sweet 5-10 → +30% nightly_rate;
	// over 11+ → analysis-paralysis burnout: 35% of bookings on/after
	// day HOTEL_FATIGUE_START_DAY dropped. The calendar scope (vs the v1.5
	// uniform drop) is what makes the volume story measurable — see the
	// knob comment on HOTEL_FATIGUE_START_DAY.
	const hotelViews = events.filter(e => e.event === "hotel viewed").length;
	if (hotelViews >= HOTEL_SWEET_MIN && hotelViews <= HOTEL_SWEET_MAX) {
		events.forEach(e => {
			if (e.event === "booking completed" && typeof e.nightly_rate === "number") {
				e.nightly_rate = Math.round(e.nightly_rate * HOTEL_SWEET_RATE_BOOST);
			}
		});
	} else if (hotelViews >= HOTEL_OVER_THRESHOLD) {
		const fatigueCutoff = dayjs.unix(meta.datasetStart).add(HOTEL_FATIGUE_START_DAY, "days");
		for (let i = events.length - 1; i >= 0; i--) {
			if (events[i].event === "booking completed"
					&& !dayjs(events[i].time).isBefore(fatigueCutoff)
					&& chance.bool({ likelihood: HOTEL_OVER_BOOKING_DROP_LIKELIHOOD })) {
				events.splice(i, 1);
			}
		}
	}

	return record;
}

// ── CONFIG ──
/** @type {Config} */
const config = {
	version: 2,
	seed: SEED,
	datasetStart: DATASET_START,
	datasetEnd: DATASET_END,
	avgEventsPerUserPerDay: EVENTS_PER_DAY,
	numUsers: NUM_USERS,
	format: "json",
	gzip: true,
	credentials: {
		token,
	},
	switches: {
		hasSessionIds: true,
		alsoInferFunnels: false,
		hasLocation: true,
		hasAndroidDevices: true,
		hasIOSDevices: true,
		hasDesktopDevices: true,
		hasBrowser: false,
		hasCampaigns: false,
		isAnonymous: false,
		hasAdSpend: false,
		hasAvatar: true,
	},
	identity: {
		avgDevicePerUser: 2,
	},
	concurrency: 1,
	writeToDisk: false,
	scdProps: {
		membership_tier: {
			values: ["member", "silver", "gold", "platinum"],
			frequency: "month",
			timing: "fuzzy",
			max: 8
		}
	},
	mirrorProps: {},
	lookupTables: [],

	events: [
		{
			event: "account created",
			weight: 1,
			isFirstEvent: true,
			isAuthEvent: true,
			properties: {
				signup_source: ["organic", "google", "instagram", "tripadvisor", "referral", "email_campaign"],
			},
		},
		{
			event: "destination searched",
			weight: 8,
			properties: {
				destination: chance.pickone.bind(chance, destinationCities),
				check_in_days_out: u.weighNumRange(1, 90, 0.4, 14),
				nights: u.weighNumRange(1, 14, 0.4, 3),
				guests: u.weighNumRange(1, 6, 0.3, 2),
				search_filters: ["price", "price", "rating", "location", "amenities", "pool", "breakfast"],
			},
		},
		{
			event: "hotel viewed",
			weight: 7,
			isStrictEvent: false,
			properties: {
				hotel_id: chance.pickone.bind(chance, hotelIds),
				destination: chance.pickone.bind(chance, destinationCities),
				star_rating: [3, 3, 4, 4, 4, 5],
				nightly_rate: u.weighNumRange(50, 500, 0.3, 150),
				has_pool: [true, true, false],
				has_breakfast: [true, false],
				photos_viewed: u.weighNumRange(0, 20, 0.5, 5),
			},
		},
		{
			event: "price compared",
			weight: 4,
			properties: {
				hotels_compared: u.weighNumRange(2, 5),
				price_difference_pct: u.weighNumRange(0, 40, 0.5, 10),
				chose_cheapest: [true, true, true, false, false],
			},
		},
		{
			event: "booking completed",
			weight: 3,
			isStrictEvent: false,
			properties: {
				hotel_id: chance.pickone.bind(chance, hotelIds),
				destination: chance.pickone.bind(chance, destinationCities),
				nightly_rate: u.weighNumRange(50, 500, 0.3, 150),
				total_cost: u.weighNumRange(100, 5000, 0.3, 450),
				nights: u.weighNumRange(1, 14, 0.4, 3),
				guests: u.weighNumRange(1, 6, 0.3, 2),
				booking_window: ["advance", "advance", "standard", "standard", "last_minute"],
				payment_method: ["credit_card", "credit_card", "debit", "paypal", "apple_pay"],
				loyalty_points: u.weighNumRange(0, 500, 0.5, 100),
			},
		},
		{
			event: "room upgrade selected",
			weight: 2,
			isStrictEvent: false,
			properties: {
				upgrade_type: ["suite", "ocean_view", "executive_floor", "club_lounge", "premium_king"],
				upgrade_cost: u.weighNumRange(25, 200, 0.4, 75),
				hotel_id: chance.pickone.bind(chance, hotelIds),
			},
		},
		{
			event: "booking cancelled",
			weight: 2,
			properties: {
				cancellation_reason: ["change_of_plans", "found_cheaper", "travel_restriction", "schedule_conflict", "weather"],
				refund_amount: u.weighNumRange(0, 2000, 0.4, 200),
				days_before_checkin: u.weighNumRange(0, 60, 0.5, 14),
				booking_window: ["advance", "advance", "standard", "standard", "last_minute"],
			},
		},
		{
			event: "check in completed",
			weight: 2,
			properties: {
				hotel_id: chance.pickone.bind(chance, hotelIds),
				check_in_method: ["app", "app", "front_desk", "kiosk"],
				early_checkin: [false, false, false, true],
			},
		},
		{
			event: "amenity used",
			weight: 4,
			properties: {
				amenity_type: ["pool", "gym", "spa", "restaurant", "bar", "room_service", "business_center", "concierge"],
				spend_amount: u.weighNumRange(0, 200, 0.4, 30),
			},
		},
		{
			event: "review submitted",
			weight: 2,
			isStrictEvent: false,
			properties: {
				hotel_id: chance.pickone.bind(chance, hotelIds),
				// literal weighted integers, NOT weighNumRange: the v1.5 call
				// weighNumRange(1, 5, 0.7, 4) built a 4-VALUE float pool whose
				// contents decide whether the H6 high/low arms even exist (one
				// observed pool was [2,2,3,5] — no avg>=4 user without an all-5
				// draw). Explicit weights pin P(5)=.25 P(4)=.333 P(3)=.167
				// P(2)=.167 P(1)=.083 → mean 3.5, both H6 arms populated.
				stay_rating: [5, 5, 5, 4, 4, 4, 4, 3, 3, 2, 2, 1],
				review_length: u.weighNumRange(20, 300, 0.5, 120),
				would_return: [true, true, true, false],
			},
		},
		{
			event: "loyalty points redeemed",
			weight: 1,
			properties: {
				points_used: u.weighNumRange(100, 5000, 0.4, 500),
				redemption_type: ["room_discount", "free_night", "upgrade", "amenity_credit"],
			},
		},
		{
			event: "notification received",
			weight: 5,
			properties: {
				notification_type: ["deal_alert", "deal_alert", "booking_confirmation", "checkin_reminder", "review_prompt", "loyalty_update"],
				channel: ["push", "push", "email", "sms"],
				opened: [true, true, true, false],
			},
		},
		{
			event: "wishlist updated",
			weight: 3,
			properties: {
				action: ["added", "added", "added", "removed"],
				destination: chance.pickone.bind(chance, destinationCities),
				hotel_id: chance.pickone.bind(chance, hotelIds),
			},
		},
		{
			event: "support contacted",
			weight: 1,
			properties: {
				issue_type: ["booking_change", "refund", "complaint", "question", "loyalty_inquiry"],
				channel: ["chat", "chat", "phone", "email"],
				resolution_time_hours: u.weighNumRange(0.5, 48, 0.3, 4),
			},
		},
		{
			event: "app session",
			weight: 7,
			properties: {
				session_duration_sec: u.weighNumRange(15, 1200, 0.4, 180),
				pages_viewed: u.weighNumRange(1, 20, 0.5, 4),
			},
		},
		{
			event: "price alert set",
			weight: 2,
			properties: {
				destination: chance.pickone.bind(chance, destinationCities),
				target_price: u.weighNumRange(50, 300, 0.5, 120),
				alert_status: ["active", "active", "triggered", "expired"],
			},
		},
		{
			event: "account deactivated",
			weight: 1,
			isChurnEvent: true,
			returnLikelihood: 0.2,
			isStrictEvent: true,
			properties: {
				reason: ["found_alternative", "too_expensive", "poor_experience", "infrequent_travel", "privacy"],
			},
		},
	],

	funnels: [
		{
			name: "Onboarding to First Booking",
			sequence: ["account created", "destination searched", "hotel viewed", "booking completed"],
			conversionRate: 35,
			order: "sequential",
			isFirstFunnel: true,
			timeToConvert: 72,
			weight: 3,
		},
		{
			name: "Search to Book",
			sequence: ["destination searched", "hotel viewed", "price compared", "booking completed"],
			conversionRate: 25,
			order: "sequential",
			timeToConvert: 48,
			weight: 5,
			reentry: true,
		},
		{
			name: "Full Stay Journey",
			sequence: ["booking completed", "check in completed", "amenity used", "review submitted"],
			conversionRate: 30,
			order: "sequential",
			timeToConvert: 336,
			weight: 3,
		},
		{
			name: "Loyalty Engagement",
			sequence: ["booking completed", "loyalty points redeemed", "review submitted"],
			conversionRate: 15,
			order: "sequential",
			timeToConvert: 720,
			weight: 2,
		},
		{
			name: "Upsell Path",
			sequence: ["hotel viewed", "booking completed", "room upgrade selected"],
			conversionRate: 20,
			order: "sequential",
			timeToConvert: 24,
			weight: 2,
		},
	],

	superProps: {
		Platform: ["ios", "android", "web", "web"],
		membership_tier: ["standard", "standard", "standard", "gold", "platinum"],
	},

	userProps: {
		customer_segment: ["leisure_family"],
		travel_frequency: ["occasional", "occasional", "monthly", "weekly"],
		company_name: ["none"],
		preferred_destination: chance.pickone.bind(chance, destinationCities),
		avg_budget_per_night: u.weighNumRange(50, 400, 0.4, 150),
		Platform: ["ios", "android", "web", "web"],
		membership_tier: ["standard", "standard", "standard", "gold", "platinum"],
	},

	personas: [
		{
			name: "business_traveler",
			weight: 20,
			eventMultiplier: 2.5,
			conversionModifier: 1.3,
			churnRate: 0.02,
			properties: { customer_segment: "business_traveler", travel_frequency: "weekly" },
		},
		{
			name: "leisure_family",
			weight: 35,
			eventMultiplier: 0.8,
			conversionModifier: 0.9,
			churnRate: 0.08,
			properties: { customer_segment: "leisure_family", travel_frequency: "occasional" },
		},
		{
			name: "luxury_seeker",
			weight: 15,
			eventMultiplier: 1.5,
			conversionModifier: 1.2,
			churnRate: 0.04,
			properties: { customer_segment: "luxury_seeker", travel_frequency: "monthly" },
		},
		{
			name: "budget_hunter",
			weight: 30,
			eventMultiplier: 1.0,
			conversionModifier: 0.7,
			churnRate: 0.10,
			properties: { customer_segment: "budget_hunter", travel_frequency: "occasional" },
		},
	],

	worldEvents: [
		{
			name: "summer_sale",
			type: "campaign",
			startDay: 40,
			duration: 5,
			volumeMultiplier: 2.0,
			conversionModifier: 1.5,
			injectProps: { promo: "summer_sale" },
			affectsEvents: ["booking completed", "hotel viewed", "destination searched"],
		},
		{
			name: "hurricane_disruption",
			type: "outage",
			startDay: 65,
			duration: 0.5,
			volumeMultiplier: 0.2,
			affectsEvents: ["booking completed", "check in completed"],
			aftermath: { duration: 3, volumeMultiplier: 1.4 },
		},
		{
			name: "loyalty_program_launch",
			type: "product_launch",
			startDay: 50,
			duration: null,
			injectProps: { loyalty_program: "active" },
			affectsEvents: ["booking completed", "loyalty points redeemed"],
		},
	],

	engagementDecay: {
		model: "exponential",
		halfLife: 90,
		floor: 0.2,
		reactivationChance: 0.02,
	},

	attribution: {
		model: "last_touch",
		window: 7,
		campaigns: [
			{
				name: "google_hotels",
				source: "google",
				medium: "cpc",
				activeDays: [0, 100],
				dailyBudget: [300, 1000],
				acquisitionRate: 0.03,
				userPersonaBias: { business_traveler: 0.5, budget_hunter: 0.3 },
			},
			{
				name: "instagram_travel",
				source: "instagram",
				medium: "social",
				activeDays: [10, 90],
				dailyBudget: [150, 500],
				acquisitionRate: 0.02,
				userPersonaBias: { leisure_family: 0.5, luxury_seeker: 0.3 },
			},
			{
				name: "tripadvisor_reviews",
				source: "tripadvisor",
				medium: "referral",
				activeDays: [0, 100],
				dailyBudget: [100, 300],
				acquisitionRate: 0.02,
				userPersonaBias: { leisure_family: 0.4 },
			},
		],
		organicRate: 0.35,
	},

	geo: {
		sticky: true,
		regions: [
			{
				name: "north_america",
				countries: ["US", "CA"],
				weight: 40,
				timezoneOffset: -5,
				properties: { currency: "USD", locale: "en-US" },
			},
			{
				name: "europe",
				countries: ["GB", "DE", "FR", "ES"],
				weight: 35,
				timezoneOffset: 1,
				properties: { currency: "EUR", locale: "en-EU" },
			},
			{
				name: "asia_pacific",
				countries: ["JP", "AU", "SG"],
				weight: 25,
				timezoneOffset: 9,
				properties: { currency: "JPY", locale: "en-APAC" },
			},
		],
	},

	anomalies: [
		{
			type: "extreme_value",
			event: "booking completed",
			property: "total_cost",
			frequency: 0.003,
			multiplier: 20,
			tag: "whale_booking",
		},
		{
			type: "coordinated",
			event: "booking completed",
			day: 75,
			window: 0.04,
			count: 80,
			tag: "group_conference_booking",
		},
	],

	hook(record, type, meta) {
		if (type === "user") return handleUserHooks(record);
		if (type === "funnel-post") return handleFunnelPostHooks(record, meta);
		if (type === "everything") return handleEverythingHooks(record, meta);
		return record;
	},
};

export default config;

// ── STORIES (v1.6 machine-checkable contract — one story per numbered hook) ──
// Generate:  node scripts/verify-runner.mjs dungeons/vertical/travel/travel.js verify-travel
// Evaluate:  node scripts/verify-stories.mjs dungeons/vertical/travel/travel.js --data-prefix verify-travel
//
// Measurement doctrine for this dungeon:
// - Value hooks (H1/H2/H3/H6/H10-sweet) multiply iid per-event pool draws
//   (nightly_rate, loyalty_points, review_length are drawn independent of
//   user activity), so cross-arm MEAN ratios read the knobs directly. The
//   only systematic confound is calendar composition — H2 scales
//   nightly_rate by booking date — handled by scoping every rate read to a
//   single calendar region where H2's factor is constant.
// - Bookings are only ever DELETED post-generation (H8 all-or-nothing per
//   user, H10 per-event after day 60, the silent future-time guard on
//   H9-stretched instances); hotel-viewed / searches / sessions / reviews /
//   upgrades are never deleted. So view/search/session/review counts are
//   EXACT hook-time recoveries, and booking-count cohorts are one-sided:
//   output >= threshold implies hook-time >= threshold. Controls pin the
//   other side with hv <= HOTEL_SWEET_MAX (H10 never drops for them) or
//   pre-day-60 restrictions.
// - H10's volume read is a difference-in-differences: hotel-view count is
//   intrinsically activity-coupled, so no cross-sectional denominator can
//   recover a 35% drop (community.js proved this confound class). The
//   calendar scope (day >= HOTEL_FATIGUE_START_DAY) lets each arm's own
//   after/before bookings-per-session ratio cancel its activity
//   composition; worldEvents (summer sale ×2, hurricane ×0.2) are
//   arm-invariant volume scalers and cancel in the cross-arm DiD.

const EV = `read_json_auto('{{PREFIX}}-EVENTS*.json', sample_size=-1, union_by_name=true)`;
const US = `read_json_auto('{{PREFIX}}-USERS*.json', sample_size=-1, union_by_name=true)`;
// identity prelude: avgDevicePerUser 2 + account created is isAuthEvent+
// isFirstEvent, so born users auth on their first event; the device-pool
// resolve is belt-and-braces for any device-only edge. ::VARCHAR casts —
// user_id sniffs as UUID, device_id as VARCHAR; DuckDB refuses to coalesce
// mixed types.
const ID_CTE = `
us AS (SELECT * FROM ${US}),
dm AS (SELECT unnest("anonymousIds") AS device_id, distinct_id FROM us),
ev AS (
  SELECT coalesce(m.distinct_id::VARCHAR, e.user_id::VARCHAR, e.device_id::VARCHAR) AS uid,
         e.time::TIMESTAMP AS t, e.*
  FROM ${EV} e
  LEFT JOIN dm m ON e.device_id = m.device_id
)`;

// per-user counts used across stories (views/bookings/searches/sessions/upgrades)
const PU_CTE = `
pu AS (
  SELECT e.uid,
    count(*) FILTER (WHERE e.event = 'hotel viewed') AS hv,
    count(*) FILTER (WHERE e.event = 'booking completed') AS bookings,
    count(*) FILTER (WHERE e.event = 'destination searched') AS searches,
    count(*) FILTER (WHERE e.event = 'app session') AS sessions,
    count(*) FILTER (WHERE e.event = 'room upgrade selected') AS upgrades
  FROM ev e GROUP BY 1
)`;

// knob-derived timestamps. H2 stamps by daysUntilEnd = datasetEnd.diff(t,
// "days"), which TRUNCATES: advance <=> diff > 21 <=> t <= end-22d;
// last_minute <=> diff < 3 <=> t > end-3d. Region boundaries below carry a
// >= 1-day / 1-hour interior margin so no boundary-truncation ambiguity
// can leak a mis-stamped booking into a region read.
const DS = dayjs.utc(DATASET_START);
const DE = dayjs.utc(DATASET_END);
const TS = (d) => d.format("YYYY-MM-DD HH:mm:ss");
const ADV_END_TS = TS(DE.subtract(ADVANCE_DAYS_THRESHOLD + 2, "day"));  // t < this => stamped advance
const MID_START_TS = TS(DE.subtract(ADVANCE_DAYS_THRESHOLD - 1, "day")); // t >= this => not advance-stamped
const MID_END_TS = TS(DE.subtract(LAST_MINUTE_DAYS_THRESHOLD + 1, "day")); // t <= this => not last_minute-stamped
const LM_START_TS = TS(DE.subtract(LAST_MINUTE_DAYS_THRESHOLD, "day").add(1, "hour")); // t >= this => stamped last_minute
const FATIGUE_TS = TS(DS.add(HOTEL_FATIGUE_START_DAY, "day"));
// H10 DiD arms need genuine exposure on both sides of the day-60 edge:
// users born after day 45 have no meaningful before-period
const H10_EARLYBORN_TS = TS(DS.add(45, "day"));

const cellsOf = (rows, key) => Object.fromEntries((rows || []).map((r) => [r[key], r]));

export const stories = [
	{
		id: "H1-weekend-rate-surge",
		hook: "H1",
		archetype: "temporal-inflection",
		narrative:
			`Fri/Sat/Sun bookings get nightly_rate (and total_cost) x${WEEKEND_RATE_BOOST}, floored. ` +
			"nightly_rate is an iid per-event pool draw, and every other rate hook (H2 window factors, " +
			"H10 sweet boost) is either calendar-mixed near-identically across the two DOW arms or " +
			"user-level constant, so the weekend/weekday mean ratio reads the 1.3 knob within ~±2% " +
			"composition drift (the last-minute region's 1.4x factor covers Wed/Thu/Fri only — a " +
			"sub-1% asymmetry at region volume share). Band [1.22, 1.38]. 'hotel viewed' carries the " +
			"same nightly_rate pool untouched by every hook — the placebo arm must sit in [0.96, 1.04].",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT CASE WHEN dayofweek(t) IN (0, 5, 6) THEN 'wkn' ELSE 'wkd' END AS bucket,
  count(*)::BIGINT AS user_count, avg(nightly_rate) AS avg_rate
FROM ev WHERE event = 'booking completed' AND nightly_rate IS NOT NULL
GROUP BY 1`,
				},
				select: {
					wkn: { where: { bucket: "wkn" } },
					wkd: { where: { bucket: "wkd" } },
				},
				expect: { metric: "wkn.avg_rate / wkd.avg_rate", op: "between", target: [1.22, 1.38] },
				minCohort: 800,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT CASE WHEN dayofweek(t) IN (0, 5, 6) THEN 'wkn' ELSE 'wkd' END AS bucket,
  count(*)::BIGINT AS user_count, avg(nightly_rate) AS avg_rate
FROM ev WHERE event = 'hotel viewed' AND nightly_rate IS NOT NULL
GROUP BY 1`,
				},
				select: {
					wkn: { where: { bucket: "wkn" } },
					wkd: { where: { bucket: "wkd" } },
				},
				expect: { metric: "wkn.avg_rate / wkd.avg_rate", op: "between", target: [0.96, 1.04] },
				minCohort: 3000,
			},
		],
	},
	{
		id: "H2-booking-window",
		hook: "H2",
		archetype: "temporal-inflection",
		narrative:
			`Bookings > ${ADVANCE_DAYS_THRESHOLD} days before dataset end are stamped 'advance' and get ` +
			`x${ADVANCE_RATE_FACTOR}; bookings < ${LAST_MINUTE_DAYS_THRESHOLD} days before end are stamped ` +
			`'last_minute' and get x${LAST_MINUTE_RATE_FACTOR}. The 3-21-day middle band keeps its ORGANIC ` +
			"booking_window label (2/5 advance, 2/5 standard, 1/5 last_minute) with untouched rates, so a " +
			"label breakdown dilutes both treated labels — the clean read is by calendar REGION with the " +
			"untreated middle band as baseline. Weekend-mix correction: advance region carries ~3/7 weekend " +
			"days (uniform-mix factor 1.129), middle band Apr 12-27 carries 7/16 (1.131), last-minute region " +
			"Wed/Thu/Fri carries 1/3 (1.100); expected adv/mid = 0.8 x 1.129/1.131 = 0.80 with soup-DOW " +
			"volume weighting drifting the mix a few percent either way — band [0.72, 0.86]. Expected " +
			"lm/mid = 1.4 x 1.100/1.131 = 1.36, wider band [1.20, 1.52] for the ~3-day region's n and " +
			"end-of-window decay composition. Third assertion pins the stamping mechanics: stamped regions " +
			"must be label-pure and the middle band must keep the organic 0.4 advance share.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT CASE WHEN t < TIMESTAMP '${ADV_END_TS}' THEN 'adv'
            WHEN t >= TIMESTAMP '${MID_START_TS}' AND t <= TIMESTAMP '${MID_END_TS}' THEN 'mid' END AS region,
  count(*)::BIGINT AS user_count, avg(nightly_rate) AS avg_rate
FROM ev WHERE event = 'booking completed' AND nightly_rate IS NOT NULL
GROUP BY 1`,
				},
				select: {
					adv: { where: { region: "adv" } },
					mid: { where: { region: "mid" } },
				},
				expect: { metric: "adv.avg_rate / mid.avg_rate", op: "between", target: [0.72, 0.86] },
				minCohort: 500,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT CASE WHEN t >= TIMESTAMP '${LM_START_TS}' THEN 'lm'
            WHEN t >= TIMESTAMP '${MID_START_TS}' AND t <= TIMESTAMP '${MID_END_TS}' THEN 'mid' END AS region,
  count(*)::BIGINT AS user_count, avg(nightly_rate) AS avg_rate
FROM ev WHERE event = 'booking completed' AND nightly_rate IS NOT NULL
GROUP BY 1`,
				},
				select: {
					lm: { where: { region: "lm" } },
					mid: { where: { region: "mid" } },
				},
				expect: { metric: "lm.avg_rate / mid.avg_rate", op: "between", target: [1.20, 1.52] },
				minCohort: 150,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT CASE WHEN t < TIMESTAMP '${ADV_END_TS}' THEN 'adv'
            WHEN t >= TIMESTAMP '${LM_START_TS}' THEN 'lm'
            WHEN t >= TIMESTAMP '${MID_START_TS}' AND t <= TIMESTAMP '${MID_END_TS}' THEN 'mid' END AS region,
  count(*)::BIGINT AS user_count,
  count(*) FILTER (WHERE booking_window = 'advance')::DOUBLE / count(*) AS adv_share,
  count(*) FILTER (WHERE booking_window = 'last_minute')::DOUBLE / count(*) AS lm_share
FROM ev WHERE event = 'booking completed'
GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "region");
					const a = by.adv, l = by.lm, m = by.mid;
					if (!a || !l || !m || Number(a.user_count) < 500 || Number(l.user_count) < 100 || Number(m.user_count) < 300) {
						return { verdict: "WEAK", detail: `cohort too small: adv=${a?.user_count ?? 0} lm=${l?.user_count ?? 0} mid=${m?.user_count ?? 0}` };
					}
					const detail = `adv region advance-share=${Number(a.adv_share).toFixed(4)}, lm region last_minute-share=${Number(l.lm_share).toFixed(4)}, mid organic advance-share=${Number(m.adv_share).toFixed(4)}`;
					if (a.adv_share >= 0.999 && l.lm_share >= 0.999 && m.adv_share >= 0.30 && m.adv_share <= 0.50) {
						return { verdict: "NAILED", detail };
					}
					if (a.adv_share >= 0.995 && l.lm_share >= 0.995 && m.adv_share >= 0.25 && m.adv_share <= 0.55) {
						return { verdict: "STRONG", detail };
					}
					return { verdict: a.adv_share > 0.9 && l.lm_share > 0.9 ? "WEAK" : "NONE", detail };
				},
			},
		],
	},
	{
		id: "H3-loyalty-boost",
		hook: "H3",
		archetype: "cohort-prop-scale",
		narrative:
			`Users with >= ${LOYALTY_BOOKING_THRESHOLD} bookings when H3 runs get loyalty_points ` +
			`x(${LOYALTY_POINT_BASE_MULT} + U[0, ${LOYALTY_POINT_VARIANCE}]) floored — E[mult] = 3.0. ` +
			"loyalty_points is an iid pool draw, so the cross-arm mean ratio is composition-clean. " +
			"Cohorts are one-sided-safe: H3 runs after H8's all-or-nothing booking drop and before H10's " +
			"post-day-60 drop, and bookings are only ever deleted afterward — so output >= 5 bookings " +
			"implies hook-time >= 5 (treated). Control = output 1-4 bookings AND hv <= " +
			`${HOTEL_SWEET_MAX}: H10 never drops bookings for hv <= 10 users, so their output count is ` +
			"their H3-time count (the only post-H3 deletion left is the future-time guard on " +
			"H9-stretched instances, sub-1%). The zero-guard in the hook skips loyalty_points = 0 draws, " +
			"which contribute 0 to both arm means and cancel. Band [2.6, 3.4] around the exact 3.0.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
${PU_CTE},
j AS (
  SELECT p.uid, CASE WHEN p.bookings >= ${LOYALTY_BOOKING_THRESHOLD} THEN 'big'
                     WHEN p.bookings BETWEEN 1 AND ${LOYALTY_BOOKING_THRESHOLD - 1} AND p.hv <= ${HOTEL_SWEET_MAX} THEN 'small' END AS arm
  FROM pu p
)
SELECT j.arm, count(DISTINCT j.uid)::BIGINT AS user_count, avg(e.loyalty_points) AS avg_lp
FROM j JOIN ev e ON e.uid = j.uid AND e.event = 'booking completed'
WHERE j.arm IS NOT NULL GROUP BY 1`,
				},
				select: {
					big: { where: { arm: "big" } },
					small: { where: { arm: "small" } },
				},
				expect: { metric: "big.avg_lp / small.avg_lp", op: "between", target: [2.6, 3.4] },
				minCohort: 200,
			},
		],
	},
	{
		id: "H4-cancel-by-window",
		hook: "H4",
		archetype: "cohort-count-scale",
		narrative:
			"H4 stamps each 'booking cancelled' with the booking_window of the user's nearest PRECEDING " +
			`'booking completed', then drops ${CANCEL_LAST_MINUTE_DROP_LIKELIHOOD}% of last_minute-stamped ` +
			"cancels. The assertion REPLICATES the matching with an ASOF JOIN and restricts to cancels " +
			"whose matched booking sits in the organic middle band (labels iid 0.4/0.4/0.2 there) for " +
			`hv <= ${HOTEL_SWEET_MAX} users (their output booking set is their hook-time set — H10 never ` +
			"drops for them, so the ASOF match reproduces the hook's match). Post-drop the lm:std count " +
			"ratio should be 0.2 x 0.4 : 0.4 = organic 0.5 x keep 0.4 => keep = (lm/std)/0.5 in " +
			"[0.30, 0.52] (NAILED, binomial noise at region n) / [0.22, 0.62] (STRONG). adv:std is " +
			"untouched — placebo 1.0 in [0.85, 1.18]. Stamped-vs-ASOF label agreement >= 0.98 pins the " +
			"replication (sub-2% slack for future-guard rematches and same-timestamp ties).",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
${PU_CTE},
bk AS (SELECT uid, t, booking_window FROM ev WHERE event = 'booking completed'),
cn AS (
  SELECT e.uid, e.t, e.booking_window AS stamped
  FROM ev e JOIN pu p ON p.uid = e.uid AND p.hv <= ${HOTEL_SWEET_MAX}
  WHERE e.event = 'booking cancelled'
),
m AS (
  SELECT cn.uid, cn.stamped, bk.booking_window AS matched, bk.t AS bt
  FROM cn ASOF JOIN bk ON cn.uid = bk.uid AND cn.t >= bk.t
)
SELECT matched AS label, count(*)::BIGINT AS user_count,
  count(*) FILTER (WHERE stamped = matched)::DOUBLE / count(*) AS agree
FROM m
WHERE bt >= TIMESTAMP '${MID_START_TS}' AND bt <= TIMESTAMP '${MID_END_TS}'
GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "label");
					const lm = by.last_minute, std = by.standard, adv = by.advance;
					const n = (c) => Number(c?.user_count ?? 0);
					if (n(std) < 80 || n(adv) < 80 || n(lm) < 20) {
						return { verdict: "WEAK", detail: `cells too small: std=${n(std)} adv=${n(adv)} lm=${n(lm)}` };
					}
					const keep = (n(lm) / n(std)) / 0.5;
					const placebo = n(adv) / n(std);
					const total = n(lm) + n(std) + n(adv);
					const agree = (n(lm) * Number(lm.agree) + n(std) * Number(std.agree) + n(adv) * Number(adv.agree)) / total;
					const detail = `keep=${keep.toFixed(3)} (knob ${1 - CANCEL_LAST_MINUTE_DROP_LIKELIHOOD / 100}), adv/std placebo=${placebo.toFixed(3)}, stamped-vs-ASOF agreement=${agree.toFixed(4)} (lm=${n(lm)} std=${n(std)} adv=${n(adv)})`;
					if (agree < 0.98) return { verdict: "NONE", detail: `ASOF replication broke: ${detail}` };
					if (keep >= 0.30 && keep <= 0.52 && placebo >= 0.85 && placebo <= 1.18) return { verdict: "NAILED", detail };
					if (keep >= 0.22 && keep <= 0.62 && placebo >= 0.75 && placebo <= 1.30) return { verdict: "STRONG", detail };
					if (keep < 0.8) return { verdict: "WEAK", detail };
					return { verdict: "INVERSE", detail };
				},
			},
		],
	},
	{
		id: "H5-luxury-upsell",
		hook: "H5",
		archetype: "cohort-count-scale",
		narrative:
			`luxury_seeker users with an existing 'room upgrade selected' template get a ${UPSELL_LUXURY_LIKELIHOOD}% ` +
			"cloned upgrade per booking — an ADDITIVE +0.5 upgrades-per-booking on top of the organic rate. " +
			"Read 1 restricts both arms (lux vs budget_hunter) to template owners (output upgrade >= 1 " +
			"implies hook-time template — upgrades are never deleted) and to PRE-day-60 bookings/upgrades " +
			"(H10's post-day-60 booking drop would shrink over-viewers' denominators and lux skews " +
			"over-viewer); pooled sum(upgrades)/sum(bookings) then measures organic_diff + 0.5 exactly, " +
			"with the organic lux-vs-budget upsell-funnel gap (conversionModifier 1.2 vs 0.7) adding a " +
			"positive confound bounded by the Upsell Path's 20% base — band [0.40, 0.78] (NAILED) / " +
			"[0.30, 0.92] (STRONG). Read 2 is the doc-level Insights report: upgrades per user, lux vs " +
			"budget across ALL users. The organic upsell base is THIN (budget upgrades-per-booking " +
			"measured ~0.08 at reduced scale), so the +0.5 additive clone term dominates the ratio: " +
			"ratio = [(1.2p + 0.5) / 0.7p] x (B_lux/B_bud) with organic propensity p in [0.08, 0.16] " +
			"and booking-ratio in [1.3, 2.0] gives [7, 22] — wide but knob-derived; the v1.5 doc's " +
			"'~3x' figure assumed a thick organic base that the funnel math never supported.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
${PU_CTE},
pre AS (
  SELECT e.uid,
    count(*) FILTER (WHERE e.event = 'booking completed' AND e.t < TIMESTAMP '${FATIGUE_TS}') AS bookings_pre,
    count(*) FILTER (WHERE e.event = 'room upgrade selected' AND e.t < TIMESTAMP '${FATIGUE_TS}') AS upgrades_pre
  FROM ev e GROUP BY 1
),
j AS (
  SELECT u.customer_segment AS seg, pre.bookings_pre, pre.upgrades_pre
  FROM pre
  JOIN pu p ON p.uid = pre.uid AND p.upgrades >= 1
  JOIN us u ON u.distinct_id::VARCHAR = pre.uid
  WHERE u.customer_segment IN ('luxury_seeker', 'budget_hunter') AND pre.bookings_pre >= 1
)
SELECT seg, count(*)::BIGINT AS user_count,
  sum(upgrades_pre)::DOUBLE / sum(bookings_pre) AS upb
FROM j GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "seg");
					const lux = by.luxury_seeker, bud = by.budget_hunter;
					if (!lux || !bud || Number(lux.user_count) < 120 || Number(bud.user_count) < 120) {
						return { verdict: "WEAK", detail: `cohort too small: lux=${lux?.user_count ?? 0} budget=${bud?.user_count ?? 0}` };
					}
					const diff = Number(lux.upb) - Number(bud.upb);
					const detail = `upgrades-per-booking diff=${diff.toFixed(3)} (lux ${Number(lux.upb).toFixed(3)} - budget ${Number(bud.upb).toFixed(3)}; knob +0.5; lux n=${lux.user_count}, budget n=${bud.user_count})`;
					if (diff >= 0.40 && diff <= 0.78) return { verdict: "NAILED", detail };
					if (diff >= 0.30 && diff <= 0.92) return { verdict: "STRONG", detail };
					return { verdict: diff > 0.1 ? "WEAK" : "INVERSE", detail };
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
${PU_CTE}
SELECT u.customer_segment AS seg, count(*)::BIGINT AS user_count,
  avg(coalesce(p.upgrades, 0)) AS avg_upg
FROM us u LEFT JOIN pu p ON p.uid = u.distinct_id::VARCHAR
WHERE u.customer_segment IN ('luxury_seeker', 'budget_hunter')
GROUP BY 1`,
				},
				select: {
					lux: { where: { seg: "luxury_seeker" } },
					bud: { where: { seg: "budget_hunter" } },
				},
				expect: { metric: "lux.avg_upg / bud.avg_upg", op: "between", target: [7, 22] },
				minCohort: 800,
			},
		],
	},
	{
		id: "H6-review-quality",
		hook: "H6",
		archetype: "cohort-prop-scale",
		narrative:
			`Users whose avg stay_rating >= ${REVIEW_HIGH_RATING_THRESHOLD} get review_length x${REVIEW_HIGH_LENGTH_MULT} ` +
			`on ALL reviews; avg <= ${REVIEW_LOW_RATING_THRESHOLD} gets x${REVIEW_LOW_LENGTH_MULT}. Reviews are never ` +
			"deleted or cloned and no other hook touches stay_rating or review_length, so the output per-user " +
			"rating average EXACTLY reproduces the hook-time classification — arm assignment is not a proxy, " +
			"it is the treatment variable itself. stay_rating is a literal weighted integer draw (mean 3.5, " +
			"P(5)=.25) so both arms are structurally populated. review_length is an iid pool draw: arm/mid " +
			"mean ratios read the knobs within floor()-rounding, bands [1.40, 1.60] and [0.42, 0.58].",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
rv AS (SELECT uid, avg(stay_rating) AS avg_r FROM ev WHERE event = 'review submitted' GROUP BY 1),
j AS (
  SELECT uid, CASE WHEN avg_r >= ${REVIEW_HIGH_RATING_THRESHOLD} THEN 'high'
                   WHEN avg_r <= ${REVIEW_LOW_RATING_THRESHOLD} THEN 'low' ELSE 'mid' END AS arm
  FROM rv
)
SELECT j.arm, count(*)::BIGINT AS user_count, avg(e.review_length) AS avg_len
FROM j JOIN ev e ON e.uid = j.uid AND e.event = 'review submitted'
GROUP BY 1`,
				},
				select: {
					high: { where: { arm: "high" } },
					mid: { where: { arm: "mid" } },
				},
				expect: { metric: "high.avg_len / mid.avg_len", op: "between", target: [1.40, 1.60] },
				minCohort: 300,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
rv AS (SELECT uid, avg(stay_rating) AS avg_r FROM ev WHERE event = 'review submitted' GROUP BY 1),
j AS (
  SELECT uid, CASE WHEN avg_r >= ${REVIEW_HIGH_RATING_THRESHOLD} THEN 'high'
                   WHEN avg_r <= ${REVIEW_LOW_RATING_THRESHOLD} THEN 'low' ELSE 'mid' END AS arm
  FROM rv
)
SELECT j.arm, count(*)::BIGINT AS user_count, avg(e.review_length) AS avg_len
FROM j JOIN ev e ON e.uid = j.uid AND e.event = 'review submitted'
GROUP BY 1`,
				},
				select: {
					low: { where: { arm: "low" } },
					mid: { where: { arm: "mid" } },
				},
				expect: { metric: "low.avg_len / mid.avg_len", op: "between", target: [0.42, 0.58] },
				minCohort: 120,
			},
		],
	},
	{
		id: "H7-business-profile",
		hook: "H7",
		archetype: "cohort-prop-scale",
		narrative:
			"The user hook overwrites deterministically by segment: business_traveler gets a real " +
			"company_name (never 'none') and travel_frequency 'weekly'; luxury_seeker gets " +
			"avg_budget_per_night U-int[250, 500]; budget_hunter U-int[50, 120]; everyone else keeps " +
			"company_name 'none' (the schema default). Profile props are written once and never mutated " +
			"again, so every check is exact: shares 1.0/0.0 and hard min/max range bounds.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT customer_segment AS seg, count(*)::BIGINT AS user_count,
  avg((travel_frequency = 'weekly')::INT) AS weekly_share,
  avg((company_name IS NOT NULL AND company_name <> 'none')::INT) AS company_share,
  min(avg_budget_per_night) AS min_budget, max(avg_budget_per_night) AS max_budget
FROM ${US} GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "seg");
					const biz = by.business_traveler, lux = by.luxury_seeker, bud = by.budget_hunter, fam = by.leisure_family;
					if (!biz || !lux || !bud || !fam) return { verdict: "NONE", detail: "missing segment rows" };
					if (Number(biz.user_count) < 500 || Number(lux.user_count) < 300 || Number(bud.user_count) < 500) {
						return { verdict: "WEAK", detail: `cohorts too small: biz=${biz.user_count} lux=${lux.user_count} budget=${bud.user_count}` };
					}
					const detail =
						`biz weekly=${Number(biz.weekly_share).toFixed(4)} company=${Number(biz.company_share).toFixed(4)}; ` +
						`leisure company=${Number(fam.company_share).toFixed(4)}; ` +
						`lux budget [${lux.min_budget}, ${lux.max_budget}]; budget [${bud.min_budget}, ${bud.max_budget}]`;
					const exact =
						Number(biz.weekly_share) === 1 && Number(biz.company_share) === 1 &&
						Number(fam.company_share) === 0 &&
						Number(lux.min_budget) >= 250 && Number(lux.max_budget) <= 500 &&
						Number(bud.min_budget) >= 50 && Number(bud.max_budget) <= 120;
					if (exact) return { verdict: "NAILED", detail };
					const close =
						Number(biz.weekly_share) >= 0.99 && Number(biz.company_share) >= 0.99 &&
						Number(fam.company_share) <= 0.01 &&
						Number(lux.min_budget) >= 245 && Number(lux.max_budget) <= 505 &&
						Number(bud.min_budget) >= 45 && Number(bud.max_budget) <= 125;
					if (close) return { verdict: "STRONG", detail };
					return { verdict: Number(biz.weekly_share) > 0.9 ? "WEAK" : "NONE", detail };
				},
			},
		],
	},
	{
		id: "H8-casual-booking-drop",
		hook: "H8",
		archetype: "funnel-conversion-by-segment",
		narrative:
			`Non-business/luxury users have a ${REPEAT_DEST_DROP_LIKELIHOOD}% per-user chance that ALL their ` +
			"'booking completed' events are spliced out. Read 1: among users with >= 10 output searches " +
			"(searches are never deleted — exact hook-time activity floor), the zero-booking share should " +
			"be inflated in the treated segments (leisure_family + budget_hunter) by ~0.25 x (1 - organic " +
			"P0) plus an organic conversion gap (convMod 0.9/0.7 vs 1.3/1.2, churn 8-10% vs 2-4%) — " +
			"expected diff ~0.22-0.30, band [0.18, 0.33] (NAILED) / [0.13, 0.40] (STRONG), with the " +
			"untreated arm's own P0 <= 0.12 as the derivation guard. Read 2 is the doc-level funnel: " +
			"emulator conversion searched -> viewed -> booked per segment at the 72h Onboarding window; " +
			"business/budget lift = (convMod 1.3/0.7 compressed by organic weight-drawn completions) x " +
			"1/0.75 H8 keep => band [1.35, 2.6] (NAILED) / [1.2, 3.2] (STRONG).",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
${PU_CTE},
j AS (
  SELECT p.uid, p.bookings,
    CASE WHEN u.customer_segment IN ('leisure_family', 'budget_hunter') THEN 'treated' ELSE 'control' END AS arm
  FROM pu p JOIN us u ON u.distinct_id::VARCHAR = p.uid
  WHERE p.searches >= 10
)
SELECT arm, count(*)::BIGINT AS user_count, avg((bookings = 0)::INT) AS zero_share
FROM j GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "arm");
					const t = by.treated, c = by.control;
					if (!t || !c || Number(t.user_count) < 500 || Number(c.user_count) < 300) {
						return { verdict: "WEAK", detail: `cohort too small: treated=${t?.user_count ?? 0} control=${c?.user_count ?? 0}` };
					}
					const diff = Number(t.zero_share) - Number(c.zero_share);
					const detail = `zero-booking share treated=${Number(t.zero_share).toFixed(4)} control=${Number(c.zero_share).toFixed(4)} diff=${diff.toFixed(4)} (n=${t.user_count}/${c.user_count})`;
					if (Number(c.zero_share) > 0.12) {
						return { verdict: diff > 0.13 ? "WEAK" : "NONE", detail: `control P0 exceeds derivation guard 0.12: ${detail}` };
					}
					if (diff >= 0.18 && diff <= 0.33) return { verdict: "NAILED", detail };
					if (diff >= 0.13 && diff <= 0.40) return { verdict: "STRONG", detail };
					return { verdict: diff > 0.05 ? "WEAK" : "INVERSE", detail };
				},
			},
			{
				breakdown: {
					type: "timeToConvert",
					steps: ["destination searched", "hotel viewed", "booking completed"],
					breakdownByUserProperty: "customer_segment",
					conversionWindowMs: 72 * 3600 * 1000,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "segment_value");
					const conv = (cell) => {
						const entered = cell?.step_counts?.[0] ?? 0;
						const done = cell?.step_counts?.[2] ?? 0;
						return entered > 0 ? { rate: done / entered, entered } : null;
					};
					const biz = conv(by.business_traveler);
					const bud = conv(by.budget_hunter);
					if (!biz || !bud) return { verdict: "NONE", detail: "missing segment cells in emulator rows" };
					if (biz.entered < 500 || bud.entered < 500) {
						return { verdict: "WEAK", detail: `attempts too few: biz=${biz.entered} budget=${bud.entered}` };
					}
					const lift = biz.rate / bud.rate;
					const detail = `searched->viewed->booked conv biz=${biz.rate.toFixed(4)} budget=${bud.rate.toFixed(4)} lift=${lift.toFixed(3)} (attempts ${biz.entered}/${bud.entered})`;
					if (lift >= 1.35 && lift <= 2.6) return { verdict: "NAILED", detail };
					if (lift >= 1.2 && lift <= 3.2) return { verdict: "STRONG", detail };
					return { verdict: lift > 1 ? "WEAK" : "INVERSE", detail };
				},
			},
		],
	},
	{
		id: "H9-booking-ttc",
		hook: "H9",
		archetype: "funnel-ttc-by-segment",
		narrative:
			`funnel-post scales Search to Book inter-step gaps: business x${TTC_BUSINESS_FACTOR}, ` +
			`budget/leisure x${TTC_LEISURE_BUDGET_FACTOR}, luxury untouched (the v1.6 hook is scoped to ` +
			"Search to Book only). Cross-event SQL cannot see this (greedy single-pass pairing across " +
			"funnel instances — the documented v1.5 limitation), so both reads go through the " +
			"Mixpanel-aligned emulator's timeToConvert at a conversion window of 48h x " +
			`${TTC_LEISURE_BUDGET_FACTOR} = 60h — the generative window times the max stretch, covering ` +
			"the stretched support so slow-arm conversions are not right-censored into a fake speedup " +
			"(the ai-platform lesson). The 4-step sequence includes 'price compared', which filters most " +
			"Onboarding-funnel cross-instances (that funnel has no compare step). Organic cross-instance " +
			"pairings compress ratios toward 1 asymmetrically (stretches compress harder than " +
			"compressions — the dating measurement); bands: business/luxury [0.60, 0.95], budget/luxury " +
			"[1.04, 1.42].",
		assertions: [
			{
				breakdown: {
					type: "timeToConvert",
					steps: ["destination searched", "hotel viewed", "price compared", "booking completed"],
					breakdownByUserProperty: "customer_segment",
					conversionWindowMs: Math.round(48 * TTC_LEISURE_BUDGET_FACTOR * 3600 * 1000),
				},
				select: {
					biz: { where: { segment_value: "business_traveler" } },
					lux: { where: { segment_value: "luxury_seeker" } },
				},
				expect: { metric: "biz.median_ttc_ms / lux.median_ttc_ms", op: "between", target: [0.60, 0.95] },
				minCohort: 200,
			},
			{
				breakdown: {
					type: "timeToConvert",
					steps: ["destination searched", "hotel viewed", "price compared", "booking completed"],
					breakdownByUserProperty: "customer_segment",
					conversionWindowMs: Math.round(48 * TTC_LEISURE_BUDGET_FACTOR * 3600 * 1000),
				},
				select: {
					bud: { where: { segment_value: "budget_hunter" } },
					lux: { where: { segment_value: "luxury_seeker" } },
				},
				expect: { metric: "bud.median_ttc_ms / lux.median_ttc_ms", op: "between", target: [1.04, 1.42] },
				minCohort: 200,
			},
		],
	},
	{
		id: "H10-hotel-view-magic",
		hook: "H10",
		archetype: "frequency-sweet-spot",
		narrative:
			`Sweet-spot viewers (${HOTEL_SWEET_MIN}-${HOTEL_SWEET_MAX} hotel views — view counts are never ` +
			`deleted, so the output bin is exact) get nightly_rate x${HOTEL_SWEET_RATE_BOOST} on all ` +
			`bookings; over-viewers (${HOTEL_OVER_THRESHOLD}+) lose ${HOTEL_OVER_BOOKING_DROP_LIKELIHOOD}% ` +
			`of bookings on/after day ${HOTEL_FATIGUE_START_DAY} (${FATIGUE_TS}). Read 1: sweet vs low-view ` +
			"(0-4) nightly_rate restricted to the ADVANCE region, where H2's factor is a constant 0.8 on " +
			"both arms and cancels — the iid pool draw makes the mean ratio read 1.3 directly, band " +
			"[1.18, 1.42]. Read 2 is the volume DiD: view count is activity-coupled, so no cross-arm " +
			"level comparison works; instead each arm's own after/before bookings-per-session ratio " +
			"cancels its activity composition ('app session' is untouched by every hook AND by the " +
			"hurricane/summer-sale worldEvents' booking-side scaling — those are arm-invariant and cancel " +
			"in the cross-arm ratio anyway). Restricted to users born before day 45 so both arms have " +
			"real before-period exposure. DiD = (over after/before) / (sweet after/before) reads the 0.65 " +
			"keep rate: [0.55, 0.78] (NAILED) / [0.45, 0.88] (STRONG).",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
${PU_CTE},
j AS (
  SELECT uid, CASE WHEN hv BETWEEN ${HOTEL_SWEET_MIN} AND ${HOTEL_SWEET_MAX} THEN 'sweet'
                   WHEN hv < ${HOTEL_SWEET_MIN} THEN 'low' END AS arm
  FROM pu
)
SELECT j.arm, count(DISTINCT j.uid)::BIGINT AS user_count, avg(e.nightly_rate) AS avg_rate
FROM j JOIN ev e ON e.uid = j.uid AND e.event = 'booking completed'
WHERE j.arm IS NOT NULL AND e.t < TIMESTAMP '${ADV_END_TS}'
GROUP BY 1`,
				},
				select: {
					sweet: { where: { arm: "sweet" } },
					low: { where: { arm: "low" } },
				},
				expect: { metric: "sweet.avg_rate / low.avg_rate", op: "between", target: [1.18, 1.42] },
				minCohort: 250,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
${PU_CTE},
fe AS (SELECT uid, min(t) AS f FROM ev GROUP BY 1),
j AS (
  SELECT p.uid, CASE WHEN p.hv BETWEEN ${HOTEL_SWEET_MIN} AND ${HOTEL_SWEET_MAX} THEN 'sweet'
                     WHEN p.hv >= ${HOTEL_OVER_THRESHOLD} THEN 'over' END AS arm
  FROM pu p JOIN fe ON fe.uid = p.uid
  WHERE fe.f < TIMESTAMP '${H10_EARLYBORN_TS}'
)
SELECT j.arm || '_' || CASE WHEN e.t >= TIMESTAMP '${FATIGUE_TS}' THEN 'after' ELSE 'before' END AS cell,
  count(DISTINCT j.uid)::BIGINT AS user_count,
  count(*) FILTER (WHERE e.event = 'booking completed')::BIGINT AS bookings,
  count(*) FILTER (WHERE e.event = 'app session')::BIGINT AS sessions
FROM j JOIN ev e ON e.uid = j.uid
WHERE j.arm IS NOT NULL
GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "cell");
					const need = ["sweet_before", "sweet_after", "over_before", "over_after"];
					for (const k of need) {
						const c = by[k];
						if (!c) return { verdict: "NONE", detail: `missing DiD cell ${k}` };
						if (Number(c.bookings) < 150 || Number(c.sessions) < 500) {
							return { verdict: "WEAK", detail: `cell ${k} too small: bookings=${c.bookings} sessions=${c.sessions}` };
						}
					}
					const bps = (k) => Number(by[k].bookings) / Number(by[k].sessions);
					const rSweet = bps("sweet_after") / bps("sweet_before");
					const rOver = bps("over_after") / bps("over_before");
					const did = rOver / rSweet;
					const detail = `DiD=${did.toFixed(3)} (over after/before ${rOver.toFixed(3)} ÷ sweet ${rSweet.toFixed(3)}; keep knob ${1 - HOTEL_OVER_BOOKING_DROP_LIKELIHOOD / 100}; bookings s=${by.sweet_before.bookings}/${by.sweet_after.bookings} o=${by.over_before.bookings}/${by.over_after.bookings})`;
					if (did >= 0.55 && did <= 0.78) return { verdict: "NAILED", detail };
					if (did >= 0.45 && did <= 0.88) return { verdict: "STRONG", detail };
					return { verdict: did < 1 ? "WEAK" : "INVERSE", detail };
				},
			},
		],
	},
];
