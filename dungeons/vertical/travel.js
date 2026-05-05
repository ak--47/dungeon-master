// ── TWEAK THESE ──
const SEED = "dm4-travel";
const num_days = 120;
const num_users = 10_000;
const avg_events_per_user_per_day = 1.2;
let token = "your-mixpanel-token";

// ── env overrides ──
if (process.env.MP_TOKEN) token = process.env.MP_TOKEN;

import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import "dotenv/config";
import * as u from "../../lib/utils/utils.js";
import * as v from "ak-tools";

dayjs.extend(utc);
const chance = u.initChance(SEED);
/** @typedef  {import("../../types").Dungeon} Config */

const hotelIds = v.range(1, 200).map(() => `HTL_${v.uid(6)}`);
const destinationCities = ["New York", "London", "Paris", "Tokyo", "Barcelona", "Dubai", "Sydney", "Rome", "Bangkok", "Cancun", "Bali", "Amsterdam", "Miami", "Singapore", "Lisbon"];

/**
 * ═══════════════════════════════════════════════════════════════
 * DATASET OVERVIEW
 * ═══════════════════════════════════════════════════════════════
 *
 * StayQuest — a hotel booking platform for business and leisure travelers.
 * Users search destinations, compare hotels, book rooms, and leave reviews.
 *
 * - 5,000 users over 120 days, ~600K events
 * - Segments: business travelers (weekday), leisure families, luxury, budget
 * - Core loop: search → view hotel → compare → book → stay → review
 * - Revenue: commission per booking + premium loyalty membership
 *
 * Advanced Features:
 * - Personas: 4 traveler archetypes with different booking behaviors
 * - World Events: summer sale (day 40), hurricane disruption (day 65), loyalty launch (day 50)
 * - Engagement Decay: exponential with 90-day half-life (travel is infrequent)
 * - Attribution: Google Hotels, Instagram, TripAdvisor, organic
 * - Geo: North America, Europe, Asia-Pacific with timezone + currency
 * - Anomalies: whale bookings, coordinated group booking spike
 */

/**
 * ═══════════════════════════════════════════════════════════════
 * ANALYTICS HOOKS (10 hooks)
 *
 * NOTE: All cohort effects are HIDDEN — no flag stamping. Discoverable via
 * raw-prop breakdowns (booking_window, day, segment) or behavioral cohorts.
 *
 * Adds 9. BOOKING TIME-TO-CONVERT (Business 1.35x faster, Budget 1.25x slower)
 *      [funnel-post: visible only in Mixpanel funnel median TTC; cross-event
 *      MIN→MIN SQL queries do NOT show this]
 * and 10. HOTEL-VIEWED MAGIC NUMBER (sweet 5-10 → +30% nightly_rate;
 * over 11+ → drop 35% of bookings).
 * ═══════════════════════════════════════════════════════════════
 *
 * ───────────────────────────────────────────────────────────────
 * 1. WEEKEND LEISURE SURGE (event hook)
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
 * 2. ADVANCE BOOKING DISCOUNT (event hook)
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
 * 3. LOYALTY TIER UPGRADE PATH (everything hook)
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
 * 4. CANCELLATION BY BOOKING WINDOW (everything hook)
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
 * 5. UPSELL SUCCESS BY SEGMENT (everything hook)
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
 * 6. REVIEW QUALITY BY STAY RATING (everything hook)
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
 * 7. BUSINESS TRAVELER PROFILE (user hook)
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
 * 8. REPEAT DESTINATION CLUSTERING (everything hook — event filtering)
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
 * 9. BOOKING TIME-TO-CONVERT (funnel-post hook)
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
 * 10. HOTEL-VIEWED MAGIC NUMBER (everything hook)
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

/** @type {Config} */
const config = {
	version: 2,
	token,
	seed: SEED,
	datasetStart: "2026-01-01T00:00:00Z",
	datasetEnd: "2026-05-01T23:59:59Z",
	// numDays: num_days,
	avgEventsPerUserPerDay: avg_events_per_user_per_day,
	numUsers: num_users,
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

	// ── Events (17) ──────────────────────────────────────────
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

	// ── Funnels (5) ──────────────────────────────────────────
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

	// ── SuperProps ──────────────────────────────────────────
	superProps: {
		Platform: ["ios", "android", "web", "web"],
		membership_tier: ["standard", "standard", "standard", "gold", "platinum"],
	},

	// ── UserProps ──────────────────────────────────────────
	userProps: {
		customer_segment: ["leisure_family"],
		travel_frequency: ["occasional", "occasional", "monthly", "weekly"],
		company_name: ["none"],
		preferred_destination: chance.pickone.bind(chance, destinationCities),
		avg_budget_per_night: u.weighNumRange(50, 400, 0.4, 150),
		Platform: ["ios", "android", "web", "web"],
		membership_tier: ["standard", "standard", "standard", "gold", "platinum"],
	},

	// ── Personas ──────────────────────────────────
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

	// ── World Events ──────────────────────────────
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

	// ── Engagement Decay ──────────────────────────
	engagementDecay: {
		model: "exponential",
		halfLife: 90,
		floor: 0.2,
		reactivationChance: 0.02,
	},

	// ── Attribution ──────────────────────────────
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

	// ── Geo ──────────────────────────────────────
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

	// ── Anomalies ──────────────────────────────────
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

	// ── Hook Function ──────────────────────────────────────
	hook: function (record, type, meta) {
		// ── HOOK 7: BUSINESS TRAVELER PROFILE (user) ─────────
		if (type === "user") {
			if (record.customer_segment === "business_traveler") {
				record.company_name = chance.pickone(["Acme Corp", "GlobalTech", "Initech", "Prestige Consulting", "Summit Partners", "Atlas Industries"]);
				record.travel_frequency = "weekly";
			} else if (record.customer_segment === "luxury_seeker") {
				record.avg_budget_per_night = chance.integer({ min: 250, max: 500 });
			} else if (record.customer_segment === "budget_hunter") {
				record.avg_budget_per_night = chance.integer({ min: 50, max: 120 });
			}
		}

		// HOOK 9 (T2C): BOOKING TIME-TO-CONVERT (funnel-post)
		// Business travelers complete the Search-to-Book funnel 1.35x faster
		// (factor 0.74); leisure_family/budget customers 1.25x slower (1.25).
		if (type === "funnel-post") {
			const segment = meta?.profile?.customer_segment;
			if (Array.isArray(record) && record.length > 1) {
				const factor = (
					segment === "business_traveler" ? 0.74 :
					segment === "budget_hunter" || segment === "leisure_family" ? 1.25 :
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
		}

		// ── HOOK 1: WEEKEND LEISURE SURGE ────────────
		// Moved to everything hook (sessionization reassigns times after event hook)

		// ── HOOK 2: ADVANCE BOOKING DISCOUNT ─────
		// Moved to everything hook (sessionization reassigns times after event hook)
		if (type === "event") {
			// no-op: DOW-dependent hooks moved to everything hook
		}

		// ── EVERYTHING HOOKS ─────────────────────────────────
		if (type === "everything") {
			const events = record;
			if (!events.length) return record;

			const profile = meta.profile;

			// ─── Stamp superProps from profile (consistent per user) ───
			const stampPlatform = profile && profile.Platform ? profile.Platform : undefined;
			const stampTier = profile && profile.membership_tier ? profile.membership_tier : undefined;
			if (stampPlatform || stampTier) {
				events.forEach(e => {
					if (stampPlatform) e.Platform = stampPlatform;
					if (stampTier) e.membership_tier = stampTier;
				});
			}

			// ── HOOK 1: WEEKEND LEISURE SURGE ────────────
			// Apply AFTER sessionization has finalized times
			events.forEach(e => {
				if (e.event === "booking completed") {
					const dayOfWeek = new Date(e.time).getUTCDay();
					// Friday=5, Saturday=6, Sunday=0
					if (dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6) {
						e.nightly_rate = Math.floor((e.nightly_rate || 150) * 1.3);
						e.total_cost = Math.floor((e.total_cost || 450) * 1.3);
					}
				}
			});

			// ── HOOK 2: ADVANCE BOOKING DISCOUNT ─────
			const datasetEndForBooking = dayjs.unix(meta.datasetEnd);
			events.forEach(e => {
				if (e.event === "booking completed") {
					const eventTime = dayjs(e.time);
					const daysUntilEnd = datasetEndForBooking.diff(eventTime, "days");
					if (daysUntilEnd > 21) {
						e.booking_window = "advance";
						e.nightly_rate = Math.floor((e.nightly_rate || 150) * 0.8);
					} else if (daysUntilEnd < 3) {
						e.booking_window = "last_minute";
						e.nightly_rate = Math.floor((e.nightly_rate || 150) * 1.4);
					}
				}
			});

			// ─── Bug 2 fix: Repeat destination clustering conversion filtering ───
			// Drop ~25% of "booking completed" events for users who are NOT
			// business_traveler or luxury_seeker to simulate their lower funnel
			// conversion (was conversionRate * 1.3 / 1.15 in funnel-pre)
			const segment = profile && profile.customer_segment;
			if (segment !== "business_traveler" && segment !== "luxury_seeker"
					&& chance.bool({ likelihood: 25 })) {
				for (let i = events.length - 1; i >= 0; i--) {
					if (events[i].event === "booking completed") {
						events.splice(i, 1);
					}
				}
			}

			// ── HOOK 3: LOYALTY TIER UPGRADE PATH ────────────
			let bookingCount = 0;
			events.forEach(e => { if (e.event === "booking completed") bookingCount++; });
			if (bookingCount >= 5) {
				events.forEach(e => {
					if (e.event === "booking completed" && e.loyalty_points) {
						e.loyalty_points = Math.floor(e.loyalty_points * (2.5 + chance.floating({ min: 0, max: 1.0 })));
					}
				});
			}

			// ── HOOK 4: CANCELLATION BY BOOKING WINDOW ───────
			// Match each cancellation to its nearest preceding booking
			// and copy the booking's booking_window. This replaces the
			// random booking_window that the event config assigns to
			// cancellation events independently.
			const bookingsByTime = events
				.filter(e => e.event === "booking completed")
				.sort((a, b) => new Date(a.time) - new Date(b.time));
			events.forEach(e => {
				if (e.event === "booking cancelled" && bookingsByTime.length > 0) {
					const cancelTime = new Date(e.time).getTime();
					// Find the nearest preceding booking (or the first one)
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

			// Last-minute bookers rarely cancel — drop 60%.
			for (let i = events.length - 1; i >= 0; i--) {
				if (events[i].event === "booking cancelled" && events[i].booking_window === "last_minute") {
					if (chance.bool({ likelihood: 60 })) {
						events.splice(i, 1);
					}
				}
			}

			// ── HOOK 5: UPSELL SUCCESS BY SEGMENT ────────────
			if (profile && profile.customer_segment === "luxury_seeker") {
				const templateUpgrade = events.find(e => e.event === "room upgrade selected");
				if (templateUpgrade) {
					const bookings = events.filter(e => e.event === "booking completed");
					bookings.forEach(booking => {
						if (chance.bool({ likelihood: 50 })) {
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

			// HOOK 6: REVIEW QUALITY BY STAY RATING — high avg ratings get
			// review_length 1.5x; low avg ratings get 0.5x. Mutates raw prop.
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
					if (avgRating >= 4) {
						e.review_length = Math.floor((e.review_length || 120) * 1.5);
					} else if (avgRating <= 2) {
						e.review_length = Math.floor((e.review_length || 120) * 0.5);
					}
				}
			});

			// HOOK 10: HOTEL-VIEWED MAGIC NUMBER (in-funnel, no flags)
			// Sweet 5-10 hotel-viewed events → +30% on booking nightly_rate
			// (decisive comparison shoppers book higher-tier rooms).
			// Over 11+ → drop 35% of booking-completed events (analysis
			// paralysis blocks conversion).
			const hotelViews = events.filter(e => e.event === "hotel viewed").length;
			if (hotelViews >= 5 && hotelViews <= 10) {
				events.forEach(e => {
					if (e.event === "booking completed" && typeof e.nightly_rate === "number") {
						e.nightly_rate = Math.round(e.nightly_rate * 1.3);
					}
				});
			} else if (hotelViews >= 11) {
				for (let i = events.length - 1; i >= 0; i--) {
					if (events[i].event === "booking completed" && chance.bool({ likelihood: 35 })) {
						events.splice(i, 1);
					}
				}
			}

			return record;
		}

		return record;
	},
};

export default config;
