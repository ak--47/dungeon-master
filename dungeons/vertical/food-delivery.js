// ── TWEAK THESE ──
const SEED = "harness-food";
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
import { findFirstSequence, scaleFunnelTTC } from "../../lib/hook-helpers/timing.js";

dayjs.extend(utc);
const chance = u.initChance(SEED);
/** @typedef  {import("../../types").Dungeon} Config */

/*
 * ═══════════════════════════════════════════════════════════════════════════════
 * DATASET OVERVIEW
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * QuickBite — a food delivery platform (DoorDash/Uber Eats style).
 * Users browse restaurants, build carts, place orders, track deliveries,
 * and rate their experiences.
 *
 * Scale: 5,000 users · 600K events · 100 days · 17 event types
 *
 * Core loop:
 *   sign up → browse/search restaurants → add items to cart →
 *   checkout → order placed → track delivery → rate → reorder
 *
 * Restaurant ecosystem: 200 restaurants across 8 cuisine types,
 * four price tiers ($–$$$$), modeled as group profiles.
 *
 * Monetization: delivery fees, QuickBite+ subscription ($9.99/mo or
 * $79.99/yr for free delivery), and promotional coupons.
 *
 * Support & retention: support tickets (missing items, wrong orders,
 * late delivery, quality, refunds) and reorder events model service
 * quality and repeat behavior.
 *
 * Subscription tiers: Free vs QuickBite+ create a natural A/B
 * comparison for monetization and retention analysis.
 */

/*
 * ═══════════════════════════════════════════════════════════════════════════════
 * ANALYTICS HOOKS (10 hooks)
 *
 * Adds 9. ORDER LIFECYCLE TIME-TO-CONVERT: QuickBite+ 0.67x delivery times,
 * Free 1.4x slower (everything hook, property scaling). Discover via
 * avg(actual_delivery_mins) on "order delivered" by subscription_tier.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * NOTE: All cohort effects are HIDDEN — no flag stamping. Discoverable only via
 * behavioral cohorts or raw-prop breakdowns (HOD, day, segment).
 *
 * ───────────────────────────────────────────────────────────────────────────────
 * 1. LUNCH/DINNER RUSH (everything)
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: 30% of "order delivered" events that fall outside meal-hour
 * windows (11-13 UTC and 17-20 UTC) are dropped, depressing non-meal-time
 * conversion. Mutation: event drop. Discover via order delivered HOD chart.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Order Delivered Volume by Hour of Day
 *   - Report type: Insights
 *   - Event: "order delivered"
 *   - Measure: Total
 *   - Breakdown: Hour of day
 *   - Expected: 11-13 and 17-20 dominate; off-hours visibly suppressed
 *
 * REAL-WORLD ANALOGUE: Meal-hour orders convert at higher rates.
 *
 * ───────────────────────────────────────────────────────────────────────────────
 * 2. COUPON INJECTION (everything)
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: Free-tier users get extra "coupon applied" events cloned into the
 * stream near checkout (30% chance per checkout). Cloned with unique offset
 * timestamps. No flag.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Coupons per User by Tier
 *   - Report type: Insights
 *   - Event: "coupon applied"
 *   - Measure: Total per user
 *   - Breakdown: "subscription_tier"
 *   - Expected: Free ~ 1.3x QuickBite+
 *
 * REAL-WORLD ANALOGUE: Free-tier users are the target of coupon promos.
 *
 * ───────────────────────────────────────────────────────────────────────────────
 * 3. LATE NIGHT MUNCHIES (everything)
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: 10PM-2AM UTC: 70% of "restaurant viewed" / "item added to cart"
 * events get cuisine_type flipped to American, item_price bumped 1.3x.
 * Mutates existing props. No flag — discover via HOD breakdown.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Cuisine Distribution by Hour of Day
 *   - Report type: Insights
 *   - Event: "restaurant viewed"
 *   - Measure: Total
 *   - Breakdown: "cuisine_type"
 *   - Filter: hour 22-02
 *   - Expected: American share spikes
 *
 *   Report 2: Avg item_price by Hour of Day
 *   - Report type: Insights
 *   - Event: "item added to cart"
 *   - Measure: Average of "item_price"
 *   - Breakdown: Hour of day
 *   - Expected: 22-02 hours show ~ 1.3x baseline price
 *
 * REAL-WORLD ANALOGUE: Late-night ordering skews to fast food and impulse buys.
 *
 * ───────────────────────────────────────────────────────────────────────────────
 * 4. RAINY WEEK SURGE (event + everything)
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: Days 20-27, "order placed" delivery_fee doubled and 40% of those
 * events get a duplicate cloned event with unique offset. No flag — discover
 * via line chart by day on order placed volume + delivery_fee average.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Order Volume Over Time
 *   - Report type: Insights
 *   - Event: "order placed"
 *   - Measure: Total
 *   - Line chart by day
 *   - Expected: visible spike days 20-27
 *
 *   Report 2: Avg delivery_fee Over Time
 *   - Report type: Insights
 *   - Event: "order placed"
 *   - Measure: Average of "delivery_fee"
 *   - Line chart by day
 *   - Expected: ~ 2x days 20-27
 *
 * REAL-WORLD ANALOGUE: Weather-driven demand surge with surge pricing.
 *
 * ───────────────────────────────────────────────────────────────────────────────
 * 5. REFERRAL POWER USERS (everything)
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: Users with referral_code=true on account-created event get
 * food_rating boosted to 4-5 and 50% of their reorder events cloned (unique
 * offset). Mutates existing prop, no flag.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Reorders per User by Referral Cohort
 *   - Report type: Insights (with cohort)
 *   - Cohort A: users with account-created.referral_code=true
 *   - Cohort B: rest
 *   - Event: "reorder initiated"
 *   - Measure: Total per user
 *   - Expected: A ~ 1.5-2x B
 *
 * REAL-WORLD ANALOGUE: Referred users tend to be more loyal.
 *
 * ───────────────────────────────────────────────────────────────────────────────
 * 6. TRIAL CONVERSION (everything)
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: Users with subscription-started.trial=true who place <3 orders in
 * first 14 days have 60% of post-day-14 events dropped. No flag.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Retention by Trial Order Count
 *   - Report type: Retention
 *   - Cohort A: trial users with >= 3 orders in first 14 days
 *   - Cohort B: trial users with < 3
 *   - Expected: B sharp activity drop after day 14
 *
 * REAL-WORLD ANALOGUE: Trial users who fail to activate churn fast.
 *
 * ───────────────────────────────────────────────────────────────────────────────
 * 7. FIRST ORDER BONUS (everything)
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: ~50% of users (deterministic by user_id hash) have 30% of their
 * "order delivered" events dropped — simulating that returning users convert
 * worse than new users. No flag — analyst sees segment-level conversion gap
 * via cohort builder by hash bucket.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Order Delivered Conversion by First-Letter-Hash
 *   - Report type: Funnels
 *   - Steps: "checkout started" -> "order placed" -> "order delivered"
 *   - Breakdown: derived hash bucket on distinct_id
 *   - Expected: half of users show ~ 30% lower conversion on final step
 *
 * REAL-WORLD ANALOGUE: First-order promos lift new-user conversion.
 *
 * ───────────────────────────────────────────────────────────────────────────────
 * 8. ORDER-COUNT MAGIC NUMBER (everything)
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: Users in the 4-8 order-placed sweet spot get +40% on order_total.
 * Users with 9+ orders are over-engaged; 35% of their order-placed events
 * drop. No flag — discover by binning users on order count.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Avg Order Total by Order-Count Bucket
 *   - Report type: Insights (with cohort)
 *   - Cohort A: users with 4-8 "order placed"
 *   - Cohort B: users with 0-3
 *   - Event: "order placed"
 *   - Measure: Average of "order_total"
 *   - Expected: A ~ 1.4x B
 *
 *   Report 2: Orders per User on Heavy Orderers
 *   - Report type: Insights (with cohort)
 *   - Cohort C: users with >= 9 "order placed"
 *   - Cohort A: users with 4-8
 *   - Event: "order placed"
 *   - Measure: Total per user
 *   - Expected: C ~ 35% fewer orders per user vs A
 *
 * REAL-WORLD ANALOGUE: Engaged orderers lift basket size; over-orderers
 * hit fatigue and slow down.
 *
 * ───────────────────────────────────────────────────────────────────────────────
 * 9. ORDER LIFECYCLE TTC (everything)
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: QuickBite+ users get delivery timing properties scaled 0.67x
 * (faster), Free users get 1.4x (slower). Affects actual_delivery_mins,
 * eta_mins, delivery_time_est_mins. No flag — discover via property avg
 * breakdown by subscription_tier.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Avg Delivery Time by Subscription Tier
 *   - Report type: Insights
 *   - Event: "order delivered"
 *   - Measure: Average of "actual_delivery_mins"
 *   - Breakdown: "subscription_tier"
 *   - Expected: QuickBite+ ~ 0.67x Free
 *
 *   Report 2: Avg ETA by Subscription Tier
 *   - Report type: Insights
 *   - Event: "order tracked"
 *   - Measure: Average of "eta_mins"
 *   - Breakdown: "subscription_tier"
 *   - Expected: QuickBite+ ~ 0.67x Free
 *
 * REAL-WORLD ANALOGUE: Premium subscribers get priority dispatch and faster
 * delivery routing.
 *
 * ───────────────────────────────────────────────────────────────────────────────
 * 10. CITY DENSITY REORDER BOOST (funnel-pre)
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: On the reorder funnel (order delivered → order rated → reorder
 * initiated), dense cities (SF, NYC) convert at 1.4x; sprawl cities
 * (Houston, Phoenix) at 0.7x. Scoped to the funnel containing
 * "reorder initiated".
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Reorder Funnel Conversion by City
 *   - Report type: Funnels
 *   - Steps: "order delivered" → "order rated" → "reorder initiated"
 *   - Breakdown: "city"
 *   - Expected: SF / NYC ~ 1.4x baseline; Houston / Phoenix ~ 0.7x
 *
 * REAL-WORLD ANALOGUE: Dense cities have more restaurant choice and
 * faster delivery, driving higher repeat ordering behavior.
 *
 * ───────────────────────────────────────────────────────────────────────────────
 * EXPECTED METRICS SUMMARY
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * Hook                  | Metric               | Baseline | Hook Effect | Ratio
 * ──────────────────────|──────────────────────|----------|-------------|------
 * Lunch/Dinner Rush     | off-hour delivered   | 1x       | 0.7x        | -30%
 * Coupon Injection      | Free user coupons/u  | 1x       | ~ 1.3x      | 1.3x
 * Late Night Munchies   | American share 22-02 | ~ 15%    | ~ 60%       | 4x
 * Rainy Week Surge      | order vol days 20-27 | 1x       | ~ 1.4x      | 1.4x
 * Referral Power Users  | Reorders/user        | 1x       | ~ 1.5-2x    | ~ 1.7x
 * Trial Conversion      | post-day-14 activity | 1x       | ~ 0.4x      | -60%
 * First Order Bonus     | returning conversion | 1x       | 0.7x        | -30%
 * Order-Count Magic Num | sweet order_total    | 1x       | 1.4x        | 1.4x
 * Order-Count Magic Num | over orders/user     | 1x       | 0.65x       | -35%
 * Order Lifecycle TTC   | QB+ delivery_mins    | 1x       | 0.67x       | -33%
 * Order Lifecycle TTC   | Free delivery_mins   | 1x       | 1.4x        | +40%
 * City Density Reorder  | SF/NYC reorder conv  | 1x       | 1.4x        | 1.4x
 * City Density Reorder  | HOU/PHX reorder conv | 1x       | 0.7x        | -30%
 */

// Generate consistent IDs for lookup tables and event properties
const restaurantIds = v.range(1, 201).map(n => `rest_${v.uid(6)}`);
const itemIds = v.range(1, 301).map(n => `item_${v.uid(7)}`);
const orderIds = v.range(1, 5001).map(n => `order_${v.uid(8)}`);
const couponCodes = v.range(1, 51).map(n => `QUICK${v.uid(5).toUpperCase()}`);

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
		subscription_tier: {
			values: ["free", "trial", "monthly", "annual"],
			frequency: "month",
			timing: "fuzzy",
			max: 6
		},
		restaurant_tier: {
			values: ["new", "verified", "featured", "premium"],
			frequency: "month",
			timing: "fixed",
			max: 6,
			type: "restaurant_id"
		}
	},

	funnels: [
		{
			sequence: ["account created", "restaurant browsed", "restaurant viewed"],
			isFirstFunnel: true,
			conversionRate: 80,
			timeToConvert: 0.5,
		},
		{
			// Browse and discover: most common action on food delivery apps
			sequence: ["restaurant browsed", "restaurant viewed", "item added to cart"],
			conversionRate: 55,
			timeToConvert: 1,
			weight: 5,
			props: { "restaurant_id": restaurantIds },
		},
		{
			// Search-driven ordering
			sequence: ["search performed", "restaurant viewed", "item added to cart", "checkout started"],
			conversionRate: 45,
			timeToConvert: 2,
			weight: 3,
		},
		{
			// Full order lifecycle: checkout to delivery
			sequence: ["checkout started", "order placed", "order tracked", "order delivered"],
			conversionRate: 65,
			timeToConvert: 2,
			weight: 4,
			props: { "order_id": orderIds },
		},
		{
			// Post-order: rate and reorder
			sequence: ["order delivered", "order rated", "reorder initiated"],
			conversionRate: 40,
			timeToConvert: 24,
			weight: 2,
		},
		{
			// Browsing promos and coupons
			sequence: ["promotion viewed", "coupon applied", "checkout started"],
			conversionRate: 50,
			timeToConvert: 1,
			weight: 2,
		},
		{
			// Support flow
			sequence: ["support ticket", "order rated"],
			conversionRate: 45,
			timeToConvert: 6,
			weight: 1,
		},
		{
			// Subscription management
			sequence: ["subscription started", "order placed", "subscription cancelled"],
			conversionRate: 20,
			timeToConvert: 48,
			weight: 1,
		},
	],

	events: [
		{
			event: "account created",
			weight: 1,
			isFirstEvent: true,
			isAuthEvent: true,
			properties: {
				"signup_method": ["email", "google", "apple", "facebook"],
				"referral_code": [false, false, true],
			}
		},
		{
			event: "restaurant browsed",
			weight: 18,
			properties: {
				"cuisine_type": [
					"American",
					"Italian",
					"Chinese",
					"Japanese",
					"Mexican",
					"Indian",
					"Thai",
					"Mediterranean"
				],
				"sort_by": ["recommended", "distance", "rating", "price"],
				"filter_applied": [false, false, false, true, true],
			}
		},
		{
			event: "restaurant viewed",
			weight: 15,
			properties: {
				"restaurant_id": restaurantIds,
				"cuisine_type": [
					"American",
					"Italian",
					"Chinese",
					"Japanese",
					"Mexican",
					"Indian",
					"Thai",
					"Mediterranean"
				],
				"avg_rating": u.weighNumRange(1, 5, 0.8, 30),
				"delivery_time_est_mins": u.weighNumRange(15, 90, 1.2, 40),
				"price_tier": ["$", "$$", "$$$", "$$$$"],
			}
		},
		{
			event: "item added to cart",
			weight: 14,
			properties: {
				"item_id": itemIds,
				"item_category": ["entree", "appetizer", "drink", "dessert", "side"],
				"item_price": u.weighNumRange(3, 65, 1.0, 40),
				"customization_count": u.weighNumRange(0, 5, 1.5, 20),
			}
		},
		{
			event: "item removed from cart",
			weight: 5,
			properties: {
				"item_id": itemIds,
				"removal_reason": ["changed_mind", "too_expensive", "substitution"],
			}
		},
		{
			event: "coupon applied",
			weight: 4,
			properties: {
				"coupon_code": couponCodes,
				"discount_type": ["percent", "flat", "free_delivery"],
				"discount_value": u.weighNumRange(5, 50, 1.2, 20),
			}
		},
		{
			event: "checkout started",
			weight: 12,
			properties: {
				"cart_total": u.weighNumRange(8, 150, 0.8, 40),
				"items_count": u.weighNumRange(1, 8, 1.2, 20),
				"delivery_address_saved": [false, false, false, true, true, true, true, true, true, true],
			}
		},
		{
			event: "order placed",
			weight: 10,
			properties: {
				"order_id": orderIds,
				"payment_method": ["credit_card", "apple_pay", "google_pay", "paypal", "cash"],
				"order_total": u.weighNumRange(10, 200, 0.8, 40),
				"tip_amount": u.weighNumRange(0, 30, 1.5, 20),
				"delivery_fee": u.weighNumRange(0, 12, 1.0, 20),
			}
		},
		{
			event: "order tracked",
			weight: 13,
			properties: {
				"order_id": orderIds,
				"order_status": ["confirmed", "preparing", "picked_up", "en_route", "delivered"],
				"eta_mins": u.weighNumRange(5, 60, 1.0, 30),
			}
		},
		{
			event: "order delivered",
			weight: 9,
			properties: {
				"order_id": orderIds,
				"actual_delivery_mins": u.weighNumRange(12, 90, 1.0, 40),
				"on_time": [false, false, false, true, true, true, true, true, true, true],
			}
		},
		{
			event: "order rated",
			weight: 7,
			properties: {
				"order_id": orderIds,
				"food_rating": u.weighNumRange(1, 5, 0.8, 30),
				"delivery_rating": u.weighNumRange(1, 5, 0.8, 30),
				"would_reorder": [false, true, true],
			}
		},
		{
			event: "search performed",
			weight: 11,
			properties: {
				"search_query": () => chance.pickone([
					"pizza", "sushi", "burger", "tacos", "pad thai",
					"chicken", "salad", "ramen", "pasta", "sandwich",
					"wings", "curry", "pho", "burritos", "steak"
				]),
				"results_count": u.weighNumRange(0, 50, 0.8, 30),
				"search_type": ["restaurant", "cuisine", "dish"],
			}
		},
		{
			event: "promotion viewed",
			weight: 8,
			properties: {
				"promo_id": () => `promo_${v.uid(5)}`,
				"promo_type": ["banner", "push", "in_feed"],
				"promo_value": ["10%", "15%", "20%", "25%", "30%", "40%", "50%"],
			}
		},
		{
			event: "subscription started",
			weight: 2,
			properties: {
				"plan": ["quickbite_plus_monthly", "quickbite_plus_monthly", "quickbite_plus_annual"],
				"price": [9.99, 9.99, 79.99],
				"trial": [true, false],
			}
		},
		{
			event: "subscription cancelled",
			weight: 1,
			properties: {
				"reason": ["too_expensive", "not_ordering_enough", "found_alternative", "bad_experience"],
				"months_subscribed": u.weighNumRange(1, 24, 1.5, 15),
			}
		},
		{
			event: "support ticket",
			weight: 3,
			properties: {
				"issue_type": ["missing_item", "wrong_order", "late_delivery", "quality_issue", "refund_request"],
				"order_id": orderIds,
			}
		},
		{
			event: "reorder initiated",
			weight: 6,
			properties: {
				"order_id": orderIds,
				"original_order_age_days": u.weighNumRange(1, 60, 1.5, 30),
			}
		},
	],

	superProps: {
		Platform: ["iOS", "Android", "Web"],
		subscription_tier: ["Free", "Free", "Free", "Free", "QuickBite+"],
		city: ["New York", "Los Angeles", "Chicago", "Houston", "Phoenix", "San Francisco"],
	},

	userProps: {
		"preferred_cuisine": [
			"American",
			"Italian",
			"Chinese",
			"Japanese",
			"Mexican",
			"Indian",
			"Thai",
			"Mediterranean"
		],
		"avg_order_value": u.weighNumRange(15, 80, 0.8, 40),
		"orders_per_month": u.weighNumRange(1, 20, 1.5, 10),
		"favorite_restaurant_count": u.weighNumRange(1, 10),
		"Platform": ["iOS", "Android", "Web"],
		"subscription_tier": ["Free", "Free", "Free", "Free", "QuickBite+"],
		"city": ["New York", "Los Angeles", "Chicago", "Houston", "Phoenix", "San Francisco"],
	},

	groupKeys: [
		["restaurant_id", 200, ["restaurant viewed", "order placed", "order rated"]],
	],

	groupProps: {
		restaurant_id: {
			"name": () => `${chance.pickone(["The", "Big", "Lucky", "Golden", "Fresh", "Urban"])} ${chance.pickone(["Kitchen", "Grill", "Bowl", "Wok", "Bistro", "Plate", "Table", "Fork"])}`,
			"cuisine": [
				"American",
				"Italian",
				"Chinese",
				"Japanese",
				"Mexican",
				"Indian",
				"Thai",
				"Mediterranean"
			],
			"avg_rating": u.weighNumRange(1, 5, 0.8, 30),
			"delivery_radius_mi": u.weighNumRange(1, 15, 1.0, 10),
		}
	},

	lookupTables: [],

	hook: function (record, type, meta) {
		// HOOK 10: CITY DENSITY REORDER BOOST (funnel-pre)
		// Dense cities (SF, NYC) convert 1.4x on the reorder funnel;
		// sprawl cities (Houston, Phoenix) at 0.7x.
		if (type === "funnel-pre") {
			const isReorderFunnel = meta.funnel?.sequence?.includes("reorder initiated");
			if (isReorderFunnel) {
				const city = meta.profile?.city;
				if (city === "San Francisco" || city === "New York") {
					record.conversionRate = Math.min(95, Math.round(record.conversionRate * 1.4));
				} else if (city === "Houston" || city === "Phoenix") {
					record.conversionRate = Math.round(record.conversionRate * 0.7);
				}
			}
		}

		if (type === "everything") {
			const datasetStart = dayjs.unix(meta.datasetStart);
			const RAINY_WEEK_START = datasetStart.add(20, 'days');
			const RAINY_WEEK_END = datasetStart.add(27, 'days');
			const userEvents = record;
			const profile = meta.profile;

			// Stamp superProps from profile so they stay consistent per user
			if (profile) {
				userEvents.forEach((event) => {
					if (profile.Platform !== undefined) event.Platform = profile.Platform;
					if (profile.subscription_tier !== undefined) event.subscription_tier = profile.subscription_tier;
					if (profile.city !== undefined) event.city = profile.city;
				});
			}

			// HOOK 9 (TTC): ORDER LIFECYCLE TIME-TO-CONVERT (everything)
			// QuickBite+ users experience faster delivery times (0.67x);
			// Free users experience slower delivery times (1.4x).
			// Scales timing properties: actual_delivery_mins, eta_mins,
			// delivery_time_est_mins. Discover via avg(actual_delivery_mins)
			// on "order delivered" broken down by subscription_tier.
			if (profile) {
				const tier = profile.subscription_tier;
				const ttcFactor = (
					tier === "QuickBite+" ? 0.67 :
					tier === "Free" ? 1.4 :
					1.0
				);
				if (ttcFactor !== 1.0) {
					// Timestamp shift: affects Mixpanel funnel TTC
					const orderSeq = findFirstSequence(
						userEvents,
						["checkout started", "order placed", "order tracked", "order delivered"],
						60 * 24 * 7
					);
					if (orderSeq) scaleFunnelTTC(orderSeq, ttcFactor);
					// Property scale: affects Insights AVG reports
					userEvents.forEach(e => {
						if (typeof e.actual_delivery_mins === "number") {
							e.actual_delivery_mins = Math.round(e.actual_delivery_mins * ttcFactor);
						}
						if (typeof e.eta_mins === "number") {
							e.eta_mins = Math.round(e.eta_mins * ttcFactor);
						}
						if (typeof e.delivery_time_est_mins === "number") {
							e.delivery_time_est_mins = Math.round(e.delivery_time_est_mins * ttcFactor);
						}
					});
				}
			}

			// HOOK 3: LATE NIGHT MUNCHIES — 10PM-2AM UTC, 70% of restaurant
			// views/cart additions get cuisine flipped to American, 1.3x
			// item_price. Mutates existing props. No flag — discover via
			// HOD breakdown on cuisine_type / item_price.
			userEvents.forEach(e => {
				if (e.event === "restaurant viewed" || e.event === "item added to cart") {
					const hour = new Date(e.time).getUTCHours();
					const isLateNight = hour >= 22 || hour <= 2;
					if (isLateNight) {
						if (e.cuisine_type !== undefined && chance.bool({ likelihood: 70 })) {
							e.cuisine_type = "American";
						}
						if (e.item_price !== undefined) {
							e.item_price = Math.round(e.item_price * 1.3 * 100) / 100;
						}
					}
				}
			});

			// HOOK 2: COUPON INJECTION — Free-tier users get coupon applied
			// events spliced into stream near checkout. Cloned from existing
			// coupon-applied event with unique offset time. No flag.
			if (profile && profile.subscription_tier === "Free") {
				for (let i = userEvents.length - 1; i >= 1; i--) {
					const evt = userEvents[i];
					if (evt.event === "checkout started" && chance.bool({ likelihood: 30 })) {
						const prevEvent = userEvents[i - 1];
						const midTime = dayjs(prevEvent.time).add(
							dayjs(evt.time).diff(dayjs(prevEvent.time)) / 2,
							'milliseconds'
						).toISOString();

						const couponTemplate = userEvents.find(e => e.event === "coupon applied");
						const couponEvent = {
							...(couponTemplate || evt),
							event: "coupon applied",
							time: midTime,
							user_id: evt.user_id,
							subscription_tier: profile.subscription_tier,
							Platform: profile.Platform,
							city: profile.city,
							coupon_code: chance.pickone(couponCodes),
							discount_type: chance.pickone(["percent", "flat", "free_delivery"]),
							discount_value: chance.integer({ min: 10, max: 30 }),
						};
						userEvents.splice(i, 0, couponEvent);
					}
				}
			}

			// HOOK 1: LUNCH/DINNER RUSH — drop 30% of order delivered events
			// that fall outside the meal hours (11-13 UTC and 17-20 UTC).
			// Discoverable via order delivered breakdown by HOD.
			for (let i = userEvents.length - 1; i >= 0; i--) {
				const event = userEvents[i];
				if (event.event === "order delivered") {
					const hour = new Date(event.time).getUTCHours();
					const inRush = (hour >= 11 && hour <= 13) || (hour >= 17 && hour <= 20);
					if (!inRush && chance.bool({ likelihood: 30 })) {
						userEvents.splice(i, 1);
					}
				}
			}

			// HOOK 7: FIRST ORDER BONUS — hash-based ~50% of users (returning)
			// drop 30% of order delivered events. New users keep all.
			// Discover via cohort builder on hash bucket vs conversion.
			const hashUser = userEvents[0] && userEvents[0].user_id;
			const isNewUser = typeof hashUser === "string" && hashUser.charCodeAt(0) % 2 === 0;
			if (!isNewUser) {
				for (let i = userEvents.length - 1; i >= 0; i--) {
					if (userEvents[i].event === "order delivered" && chance.bool({ likelihood: 30 })) {
						userEvents.splice(i, 1);
					}
				}
			}

			// First pass: identify behavioral patterns (no flags written)
			let isReferralUser = false;
			let hasTrialSubscription = false;
			let earlyOrderCount = 0;
			let orderPlacedCount = 0;
			const firstEventTime = userEvents.length > 0 ? dayjs(userEvents[0].time) : null;

			userEvents.forEach((event) => {
				const eventTime = dayjs(event.time);
				const daysSinceStart = firstEventTime ? eventTime.diff(firstEventTime, 'days', true) : 0;
				if (event.event === "account created" && event.referral_code === true) isReferralUser = true;
				if (event.event === "subscription started" && event.trial === true) hasTrialSubscription = true;
				if (event.event === "order placed") {
					orderPlacedCount++;
					if (daysSinceStart <= 14) earlyOrderCount++;
				}
			});

			// HOOK 5: REFERRAL POWER USERS — boost food rating to 4-5,
			// clone reorder events. No flag.
			userEvents.forEach((event, idx) => {
				if (isReferralUser && event.event === "order rated") {
					event.food_rating = chance.integer({ min: 4, max: 5 });
				}
				if (isReferralUser && event.event === "reorder initiated" && chance.bool({ likelihood: 50 })) {
					const eventTime = dayjs(event.time);
					userEvents.splice(idx + 1, 0, {
						...event,
						time: eventTime.add(chance.integer({ min: 1, max: 7 }), 'days').toISOString(),
						user_id: event.user_id,
						order_id: chance.pickone(orderIds),
						original_order_age_days: chance.integer({ min: 3, max: 30 }),
					});
				}
			});

			// HOOK 6: TRIAL CONVERSION — trial subs with <3 early orders
			// drop 60% of post-day-14 events. No flag.
			if (hasTrialSubscription && earlyOrderCount < 3 && chance.bool({ likelihood: 60 })) {
				const trialCutoff = firstEventTime ? firstEventTime.add(14, 'days') : null;
				if (trialCutoff) {
					for (let i = userEvents.length - 1; i >= 0; i--) {
						if (dayjs(userEvents[i].time).isAfter(trialCutoff)) {
							userEvents.splice(i, 1);
						}
					}
				}
			}

			// HOOK 4: RAINY WEEK SURGE — days 20-27, double delivery_fee on
			// order placed events. Mutates existing prop. No flag.
			userEvents.forEach(e => {
				if (e.event === "order placed") {
					const t = dayjs(e.time);
					if (t.isAfter(RAINY_WEEK_START) && t.isBefore(RAINY_WEEK_END)) {
						e.delivery_fee = (e.delivery_fee || 5) * 2;
					}
				}
			});

			// HOOK 4 (cont): RAINY WEEK SURGE — duplicate 40% of order placed
			// events that fall in the rainy window. Cloned with unique offset.
			const rainyDuplicates = [];
			userEvents.forEach((event) => {
				if (event.event === "order placed") {
					const t = dayjs(event.time);
					if (t.isAfter(RAINY_WEEK_START) && t.isBefore(RAINY_WEEK_END) && chance.bool({ likelihood: 40 })) {
						const dup = JSON.parse(JSON.stringify(event));
						dup.time = t.add(chance.integer({ min: 5, max: 60 }), 'minutes').toISOString();
						rainyDuplicates.push(dup);
					}
				}
			});
			if (rainyDuplicates.length > 0) userEvents.push(...rainyDuplicates);

			// HOOK 8: ORDER-COUNT MAGIC NUMBER (no flags)
			// Sweet 4-8 orders → +40% on order_total. Over 9+ → drop 35% of
			// order placed events (oversaturated; analyst sees inverted-U).
			if (orderPlacedCount >= 4 && orderPlacedCount <= 8) {
				userEvents.forEach(e => {
					if (e.event === "order placed" && typeof e.order_total === "number") {
						e.order_total = Math.round(e.order_total * 1.4);
					}
				});
			} else if (orderPlacedCount >= 9) {
				userEvents.forEach(e => {
					if (e.event === "order placed" && typeof e.order_total === "number") {
						e.order_total = Math.round(e.order_total * 0.65);
					}
				});
			}
		}

		return record;
	}
};

export default config;
