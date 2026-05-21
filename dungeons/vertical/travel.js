// ── IMPORTS ──
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);
import "dotenv/config";
import * as u from "../../lib/utils/utils.js";
import * as v from "ak-tools";
/** @typedef  {import("../../types").Dungeon} Config */

// ── OVERVIEW ──
/*
 * NAME:       StayQuest
 * APP:        Hotel booking platform for business and leisure travelers.
 *             Users search destinations, compare hotels, book rooms, and leave
 *             reviews. Revenue from commission per booking plus premium loyalty
 *             membership. Four traveler archetypes: business, leisure family,
 *             luxury, budget.
 * SCALE:      10,000 users, ~600K events, 121 days (2026-01-01 → 2026-05-01)
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
 *   • Expected: Fri-Sun avg ≈ $195 vs Mon-Thu avg ≈ $150
 *
 * REAL-WORLD ANALOGUE: Hotels use dynamic pricing with higher
 * weekend rates driven by leisure traveler demand.
 *
 * ───────────────────────────────────────────────────────────────
 * 2. ADVANCE BOOKING DISCOUNT (everything)
 * ───────────────────────────────────────────────────────────────
 * PATTERN: Bookings made > 21 days before the dataset end get 0.8x
 * nightly_rate (advance purchase discount). Last-minute bookings
 * (< 3 days) get 1.4x nightly_rate.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *   Report 1: Rate by Booking Window
 *   • Report type: Insights
 *   • Event: "booking completed"
 *   • Measure: Average of "nightly_rate"
 *   • Breakdown: "booking_window"
 *   • Expected: last_minute ≈ $210 vs advance ≈ $120 (1.75x)
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
 * PATTERN: Users who book last-minute (< 7 days out) have 60% of
 * their "booking cancelled" events dropped — they rarely cancel.
 * Advance bookers keep all cancellation events.
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
 *   • Expected: luxury_seeker ≈ 3x upgrades vs budget_hunter
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
 *   • Expected: 4-5 star reviews ≈ 180 words, 1-2 star ≈ 80 words
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
 * meta.profile, then rewrites each event's timestamp.
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
 *   NOTE: This effect is visible ONLY in Mixpanel funnel median TTC.
 *   Cross-event MIN->MIN SQL queries on raw events do NOT show this
 *   because funnel-post mutates timestamps after event generation but
 *   before storage.
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
 * viewed 11+ hotels trigger analysis paralysis: 35% of their
 * "booking completed" events are dropped entirely. No flag is
 * stamped -- discoverable only by binning users on hotel-viewed
 * COUNT and comparing booking revenue or conversion volume.
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
 *   Report 2: Bookings per User by Hotel-View Volume
 *   - Report type: Insights (with cohorts)
 *   - Cohort C: users who did "hotel viewed" 11+ times
 *   - Cohort A: users who did "hotel viewed" 5-10 times
 *   - Event: "booking completed"
 *   - Measure: Total events per user
 *   - Compare cohort C vs cohort A
 *   - Expected: cohort C ~ 35% fewer bookings per user
 *
 * REAL-WORLD ANALOGUE: Travelers who compare a handful of hotels
 * make confident, higher-value bookings; those who endlessly browse
 * suffer decision fatigue and often abandon the search entirely.
 *
 * ═══════════════════════════════════════════════════════════════
 * EXPECTED METRICS SUMMARY
 * ═══════════════════════════════════════════════════════════════
 *
 * Hook                        | Metric              | Baseline | Effect  | Ratio
 * ────────────────────────────|─────────────────────|──────────|─────────|──────
 * Weekend Leisure Surge       | nightly_rate        | $150     | $195    | 1.3x
 * Advance Booking Discount    | nightly_rate        | $150     | $120/$210 | 0.8x/1.4x
 * Loyalty Tier Upgrade        | loyalty_points      | 100      | 300     | 3x
 * Cancellation by Window      | cancel rate         | 20%      | 8%      | 0.4x
 * Upsell by Segment           | upgrades/user       | 0.5      | 1.5     | 3x
 * Review Quality              | review_length       | 120      | 180/80  | 1.5x/0.67x
 * Business Profile            | travel_frequency    | mixed    | weekly  | —
 * Repeat Destination          | funnel conversion   | 40%      | 52%     | 1.3x
 * Booking TTC                 | funnel median TTC   | 1x       | 0.74x   | 1.35x faster (business)
 * Hotel-Viewed Magic Num      | sweet nightly_rate  | 1x       | 1.3x    | +30%
 * Hotel-Viewed Magic Num      | over bookings/user  | 1x       | 0.65x   | -35%
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
	// leisure_family/budget 1.25x slower.
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
	// over 11+ → drop 35% of bookings.
	const hotelViews = events.filter(e => e.event === "hotel viewed").length;
	if (hotelViews >= HOTEL_SWEET_MIN && hotelViews <= HOTEL_SWEET_MAX) {
		events.forEach(e => {
			if (e.event === "booking completed" && typeof e.nightly_rate === "number") {
				e.nightly_rate = Math.round(e.nightly_rate * HOTEL_SWEET_RATE_BOOST);
			}
		});
	} else if (hotelViews >= HOTEL_OVER_THRESHOLD) {
		for (let i = events.length - 1; i >= 0; i--) {
			if (events[i].event === "booking completed" && chance.bool({ likelihood: HOTEL_OVER_BOOKING_DROP_LIKELIHOOD })) {
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
	token,
	seed: SEED,
	datasetStart: DATASET_START,
	datasetEnd: DATASET_END,
	avgEventsPerUserPerDay: EVENTS_PER_DAY,
	numUsers: NUM_USERS,
	hasAnonIds: true,
	avgDevicePerUser: 2,
	hasSessionIds: true,
	format: "json",
	gzip: true,
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
				stay_rating: u.weighNumRange(1, 5, 0.7, 4),
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
