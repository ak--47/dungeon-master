// ── TWEAK THESE ──
const SEED = "dm4-marketplace";
const num_days = 100;
const num_users = 5_000;
const avg_events_per_user = 120;
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
const NOW = dayjs();
const DATASET_START = NOW.subtract(num_days, "days");

/** @typedef  {import("../../types").Dungeon} Config */

// Generate consistent seller store and listing IDs at module level
const storeIds = v.range(1, 150).map(() => `STORE_${v.uid(6)}`);
const listingIds = v.range(1, 500).map(() => `LST_${v.uid(8)}`);

/**
 * ═══════════════════════════════════════════════════════════════
 * DATASET OVERVIEW
 * ═══════════════════════════════════════════════════════════════
 *
 * TradeNest — a two-sided marketplace connecting sellers who list
 * products with buyers who search, purchase, and review items.
 *
 * - 5,000 users over 100 days, ~600K events
 * - Two-sided: sellers (power, casual, new) and buyers (frequent, window_shopper)
 * - Core loop: search → view → add to cart → purchase → review
 * - Seller loop: create listing → receive offers → accept → ship
 * - Revenue: marketplace fees on transactions, seller listing fees
 *
 * Advanced Features:
 * - Personas: 5 archetypes spanning both buyer and seller roles
 * - World Events: marketplace fee change (day 45, permanent), viral TikTok moment (day 55, 3 days)
 * - Engagement Decay: exponential with 75-day half-life, 0.1 floor
 * - Attribution: Google Shopping, TikTok, Seller Referral, organic
 * - Geo: US/UK/Australia/Canada with local currencies
 * - Anomalies: whale purchases, viral signup burst
 *
 * Key entities:
 * - store_id: unique seller storefront
 * - listing_id: individual product listing
 * - category: product vertical (electronics, clothing, etc.)
 * - user_type: buyer vs seller role
 */

/**
 * ═══════════════════════════════════════════════════════════════
 * ANALYTICS HOOKS (8 hooks)
 * ═══════════════════════════════════════════════════════════════
 *
 * ───────────────────────────────────────────────────────────────
 * 1. FEE CHANGE IMPACT (event hook)
 * ───────────────────────────────────────────────────────────────
 *
 * PATTERN: After day 45 (permanent marketplace fee increase), all
 * "listing created" events get listing_fee multiplied by 1.3x.
 * Simulates the revenue impact of a platform fee adjustment.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Listing Fee Before vs After Fee Change
 *   • Report type: Insights
 *   • Event: "listing created"
 *   • Measure: Average of "listing_fee"
 *   • Line chart by week
 *   • Expected: Clear step-up around day 45 from ~$15 avg to ~$20 avg
 *
 *   Report 2: Fee Change Flag Distribution
 *   • Report type: Insights
 *   • Event: "listing created"
 *   • Measure: Total
 *   • Breakdown: "fee_change"
 *   • Expected: "increased" appears only after day 45
 *
 * REAL-WORLD ANALOGUE: Marketplace platforms periodically adjust
 * commission/listing fees, impacting seller economics and behavior.
 *
 * ───────────────────────────────────────────────────────────────
 * 2. WEEKEND SHOPPING SURGE (event hook)
 * ───────────────────────────────────────────────────────────────
 *
 * PATTERN: "purchase completed" events on Saturday or Sunday get
 * total_amount multiplied by 1.2x. Weekend shoppers spend more
 * per transaction due to leisure browsing.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Weekend vs Weekday Average Spend
 *   • Report type: Insights
 *   • Event: "purchase completed"
 *   • Measure: Average of "total_amount"
 *   • Breakdown: Day of week
 *   • Expected: Sat/Sun avg ≈ $72 vs Mon-Fri avg ≈ $60
 *
 * REAL-WORLD ANALOGUE: E-commerce platforms see higher average
 * order values on weekends when buyers browse leisurely.
 *
 * ───────────────────────────────────────────────────────────────
 * 3. SELLER SUCCESS → BUYER TRUST (everything hook)
 * ───────────────────────────────────────────────────────────────
 *
 * PATTERN: Users with user_type "seller" and segment "power_seller"
 * (from meta.profile) get their "purchase completed" events cloned
 * 2x. Power sellers attract more transactions due to trust/reputation.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Purchases per User by Segment
 *   • Report type: Insights
 *   • Event: "purchase completed"
 *   • Measure: Total per user
 *   • Breakdown: user property "segment"
 *   • Expected: power_seller ≈ 2x purchases vs casual_seller
 *
 * REAL-WORLD ANALOGUE: High-rated sellers with established reputations
 * receive disproportionately more sales on platforms like eBay/Etsy.
 *
 * ───────────────────────────────────────────────────────────────
 * 4. SEARCH-TO-PURCHASE BY CATEGORY (everything hook)
 * ───────────────────────────────────────────────────────────────
 *
 * PATTERN: Users whose events include "item searched" with category
 * "electronics" get cloned "purchase completed" events (electronics
 * buyers have higher conversion). Creates category-specific lift.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Purchase Volume by Category
 *   • Report type: Insights
 *   • Event: "purchase completed"
 *   • Measure: Total
 *   • Breakdown: "category" (superProp)
 *   • Expected: electronics ≈ 1.5-2x more purchases than clothing/home
 *
 * REAL-WORLD ANALOGUE: Electronics shoppers have higher purchase
 * intent — they research, decide, and buy with less browsing.
 *
 * ───────────────────────────────────────────────────────────────
 * 5. RESPONSE TIME → CONVERSION (everything hook)
 * ───────────────────────────────────────────────────────────────
 *
 * PATTERN: Users whose average response_time_hours on "message sent"
 * events is < 2 hours get additional "offer accepted" events cloned.
 * Fast responders close more deals.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Offer Accepted Count vs Response Time
 *   • Report type: Insights
 *   • Event: "offer accepted"
 *   • Measure: Total per user
 *   • Breakdown: user property "response_time_hours"
 *   • Expected: Users with < 2hr avg response ≈ 2x offer accepts
 *
 * REAL-WORLD ANALOGUE: Sellers who respond quickly to inquiries
 * close significantly more deals on marketplace platforms.
 *
 * ───────────────────────────────────────────────────────────────
 * 6. NEW SELLER CHURN (everything hook)
 * ───────────────────────────────────────────────────────────────
 *
 * PATTERN: Users with segment "new_seller" and fewer than 10 total
 * events lose 40% of events after day 14. Simulates new sellers
 * who try the platform and abandon it quickly.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: New Seller Retention
 *   • Report type: Insights
 *   • Event: All events
 *   • Measure: Total per user
 *   • Filter: segment = "new_seller"
 *   • Line chart by week
 *   • Expected: Sharp drop-off around week 2-3
 *
 *   Report 2: Active Users by Segment
 *   • Report type: Insights
 *   • Event: Any active event
 *   • Measure: Uniques
 *   • Breakdown: user property "segment"
 *   • Expected: new_seller retention ~60% vs power_seller ~99%
 *
 * REAL-WORLD ANALOGUE: Most new sellers on marketplace platforms
 * churn within the first month if they don't get early traction.
 *
 * ───────────────────────────────────────────────────────────────
 * 7. POWER SELLER PROFILES (user hook)
 * ───────────────────────────────────────────────────────────────
 *
 * PATTERN: Users with segment "power_seller" get total_transactions
 * set to 100-500, seller_rating to 4.5-5.0, and store_name to a
 * realistic business name. Enriches profiles for realistic cohort analysis.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Transaction Count Distribution by Segment
 *   • Report type: Insights
 *   • Measure: Profiles → Breakdown by "total_transactions" (histogram)
 *   • Filter: segment = "power_seller"
 *   • Expected: power_seller total_transactions 100-500, others ≈ 0
 *
 *   Report 2: Seller Rating by Segment
 *   • Report type: Insights
 *   • Measure: Profiles → Average of "seller_rating"
 *   • Breakdown: "segment"
 *   • Expected: power_seller ≈ 4.7 avg, casual_seller ≈ 3.5
 *
 * REAL-WORLD ANALOGUE: Top sellers have established storefronts,
 * high transaction volumes, and near-perfect ratings.
 *
 * ───────────────────────────────────────────────────────────────
 * 8. FREQUENT BUYER FUNNEL LIFT (everything hook)
 * ───────────────────────────────────────────────────────────────
 *
 * PATTERN: Non-frequent-buyer users lose ~25% of "purchase completed"
 * events (last step of Browse to Purchase funnel), simulating lower
 * conversion. Frequent buyers retain all purchase events.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Browse-to-Purchase Conversion by Segment
 *   • Report type: Funnels
 *   • Steps: "item searched" → "item viewed" → "add to cart" → "purchase completed"
 *   • Breakdown: user property "segment"
 *   • Expected: frequent_buyer ≈ 39% vs window_shopper ≈ 20%
 *
 * REAL-WORLD ANALOGUE: Returning buyers have established trust
 * and familiarity with the platform, converting at higher rates.
 *
 * ═══════════════════════════════════════════════════════════════
 * EXPECTED METRICS SUMMARY
 * ═══════════════════════════════════════════════════════════════
 *
 * Hook                        | Metric              | Baseline | Effect  | Ratio
 * ────────────────────────────|─────────────────────|──────────|─────────|──────
 * Fee Change Impact           | listing_fee         | $15      | $20     | 1.3x
 * Weekend Shopping Surge      | total_amount        | $60      | $72     | 1.2x
 * Seller Success → Trust      | purchases/user      | 3        | 6       | 2x
 * Electronics Category Lift   | electronics purch.  | baseline | 1.5x   | 1.5x
 * Response Time → Conversion  | offer_accepted/user | 1        | 2       | 2x
 * New Seller Churn            | events post-day-14  | 100%     | 60%     | 0.6x
 * Power Seller Profiles       | total_transactions  | 0        | 100-500 | --
 * Frequent Buyer Funnel       | funnel conversion   | 30%      | 39%     | 1.3x
 */

/** @type {Config} */
const config = {
	token,
	seed: SEED,
	numDays: num_days,
	numEvents: num_users * avg_events_per_user,
	numUsers: num_users,
	hasAnonIds: false,
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
	percentUsersBornInDataset: 35,
	hasAvatar: true,
	concurrency: 1,
	writeToDisk: false,
	scdProps: {
		seller_tier: {
			values: ["new", "verified", "power", "featured"],
			frequency: "month",
			timing: "fuzzy",
			max: 8
		}
	},
	mirrorProps: {},
	lookupTables: [],

	// ── Events (18) ──────────────────────────────────────────
	events: [
		{
			event: "account created",
			weight: 1,
			isFirstEvent: true,
			properties: {
				signup_source: ["organic", "google_shopping", "tiktok", "seller_referral", "email_campaign", "word_of_mouth"],
			},
		},
		{
			event: "item searched",
			weight: 8,
			properties: {
				search_query: ["laptop", "vintage jacket", "sneakers", "headphones", "phone case", "gaming console", "watch", "sunglasses", "backpack", "camera"],
				results_count: u.weighNumRange(0, 50, 0.5),
				sort_by: ["relevance", "relevance", "price_low", "price_high", "newest", "best_selling"],
			},
		},
		{
			event: "item viewed",
			weight: 7,
			properties: {
				listing_id: chance.pickone.bind(chance, listingIds),
				item_price: u.weighNumRange(5, 500, 0.3, 45),
				condition: ["new", "new", "like_new", "good", "fair"],
				seller_rating: u.weighNumRange(1, 5, 0.7, 4),
				photos_count: u.weighNumRange(1, 10, 0.5, 3),
			},
		},
		{
			event: "add to cart",
			weight: 5,
			properties: {
				listing_id: chance.pickone.bind(chance, listingIds),
				item_price: u.weighNumRange(5, 500, 0.3, 45),
				quantity: u.weighNumRange(1, 5, 0.2),
			},
		},
		{
			event: "purchase completed",
			weight: 3,
			properties: {
				listing_id: chance.pickone.bind(chance, listingIds),
				total_amount: u.weighNumRange(10, 500, 0.3, 60),
				item_count: u.weighNumRange(1, 5, 0.3),
				payment_method: ["credit_card", "credit_card", "paypal", "apple_pay", "debit"],
				shipping_method: ["standard", "standard", "express", "pickup"],
				is_whale_purchase: [false],
			},
		},
		{
			event: "listing created",
			weight: 4,
			properties: {
				listing_id: chance.pickone.bind(chance, listingIds),
				store_id: chance.pickone.bind(chance, storeIds),
				asking_price: u.weighNumRange(5, 500, 0.3, 50),
				condition: ["new", "new", "like_new", "good", "fair"],
				listing_fee: u.weighNumRange(5, 30, 0.5, 15),
				fee_change: ["none"],
			},
		},
		{
			event: "listing updated",
			weight: 3,
			properties: {
				listing_id: chance.pickone.bind(chance, listingIds),
				field_updated: ["price", "price", "description", "photos", "condition", "shipping"],
				price_change_pct: u.weighNumRange(-30, 30, 0.5),
			},
		},
		{
			event: "offer received",
			weight: 3,
			properties: {
				listing_id: chance.pickone.bind(chance, listingIds),
				offer_amount: u.weighNumRange(5, 400, 0.3, 40),
				offer_pct_of_asking: u.weighNumRange(50, 100, 0.5, 80),
			},
		},
		{
			event: "offer accepted",
			weight: 2,
			properties: {
				listing_id: chance.pickone.bind(chance, listingIds),
				final_price: u.weighNumRange(10, 500, 0.3, 55),
				negotiation_rounds: u.weighNumRange(1, 5, 0.3),
				response_time_hours: u.weighNumRange(0.1, 48, 0.3, 4),
			},
		},
		{
			event: "review submitted",
			weight: 2,
			properties: {
				listing_id: chance.pickone.bind(chance, listingIds),
				rating: u.weighNumRange(1, 5, 0.7, 4),
				review_length: u.weighNumRange(10, 300, 0.5, 80),
				is_verified_purchase: [true, true, true, false],
			},
		},
		{
			event: "seller rated",
			weight: 2,
			properties: {
				store_id: chance.pickone.bind(chance, storeIds),
				seller_rating: u.weighNumRange(1, 5, 0.7, 4),
				would_buy_again: [true, true, true, true, false],
			},
		},
		{
			event: "message sent",
			weight: 5,
			properties: {
				message_type: ["inquiry", "inquiry", "negotiation", "shipping_question", "complaint", "thank_you"],
				recipient_type: ["seller", "seller", "buyer", "support"],
				response_time_hours: u.weighNumRange(0.1, 48, 0.3, 6),
			},
		},
		{
			event: "shipping updated",
			weight: 3,
			properties: {
				status: ["label_created", "in_transit", "in_transit", "out_for_delivery", "delivered", "delivered"],
				carrier: ["usps", "ups", "fedex", "dhl"],
				tracking_viewed: [true, true, false],
			},
		},
		{
			event: "refund requested",
			weight: 1,
			properties: {
				reason: ["not_as_described", "damaged", "wrong_item", "changed_mind", "late_delivery"],
				refund_amount: u.weighNumRange(5, 300, 0.4, 40),
				resolution_status: ["pending", "approved", "approved", "denied"],
			},
		},
		{
			event: "notification received",
			weight: 6,
			properties: {
				notification_type: ["price_drop", "price_drop", "new_offer", "shipping_update", "message_received", "sale_reminder"],
				channel: ["push", "push", "email", "sms"],
				opened: [true, true, true, false],
			},
		},
		{
			event: "profile updated",
			weight: 2,
			properties: {
				field_updated: ["address", "payment_method", "profile_photo", "bio", "phone", "store_description"],
			},
		},
		{
			event: "app session",
			weight: 8,
			properties: {
				session_duration_sec: u.weighNumRange(10, 1800, 0.4, 120),
				pages_viewed: u.weighNumRange(1, 20, 0.5, 4),
			},
		},
		{
			event: "account deactivated",
			weight: 1,
			isChurnEvent: true,
			returnLikelihood: 0.15,
			isStrictEvent: true,
			properties: {
				reason: ["low_sales", "high_fees", "found_alternative", "bad_experience", "no_longer_needed"],
			},
		},
	],

	// ── Funnels (5) ──────────────────────────────────────────
	funnels: [
		{
			name: "Buyer Onboarding",
			sequence: ["account created", "item searched", "item viewed", "add to cart"],
			conversionRate: 40,
			order: "sequential",
			isFirstFunnel: true,
			timeToConvert: 72,
			weight: 3,
		},
		{
			name: "Browse to Purchase",
			sequence: ["item searched", "item viewed", "add to cart", "purchase completed"],
			conversionRate: 30,
			order: "sequential",
			timeToConvert: 48,
			weight: 5,
		},
		{
			name: "Seller Listing Flow",
			sequence: ["listing created", "listing updated", "offer received", "offer accepted"],
			conversionRate: 25,
			order: "sequential",
			timeToConvert: 168,
			weight: 3,
		},
		{
			name: "Offer Negotiation",
			sequence: ["offer received", "message sent", "offer accepted"],
			conversionRate: 35,
			order: "sequential",
			timeToConvert: 72,
			weight: 2,
		},
		{
			name: "Review After Purchase",
			sequence: ["purchase completed", "shipping updated", "review submitted"],
			conversionRate: 20,
			order: "sequential",
			timeToConvert: 336,
			weight: 2,
		},
	],

	// ── SuperProps ──────────────────────────────────────────
	superProps: {
		platform: ["ios", "android", "web"],
		category: ["electronics", "clothing", "home_garden", "collectibles", "sports", "toys", "automotive"],
	},

	// ── UserProps ──────────────────────────────────────────
	userProps: {
		user_type: ["buyer"],
		segment: ["window_shopper"],
		seller_rating: u.weighNumRange(0, 5, 0.5),
		total_transactions: [0],
		response_time_hours: u.weighNumRange(0, 48, 0.3),
		store_name: ["none"],
		platform: ["ios", "android", "web"],
		category: ["electronics", "clothing", "home_garden", "collectibles", "sports", "toys", "automotive"],
	},

	// ── Personas ──────────────────────────────────
	personas: [
		{
			name: "power_seller",
			weight: 8,
			eventMultiplier: 5.0,
			conversionModifier: 1.8,
			churnRate: 0.01,
			properties: {
				user_type: "seller",
				segment: "power_seller",
			},
		},
		{
			name: "casual_seller",
			weight: 20,
			eventMultiplier: 1.5,
			conversionModifier: 1.0,
			churnRate: 0.08,
			properties: {
				user_type: "seller",
				segment: "casual_seller",
			},
		},
		{
			name: "frequent_buyer",
			weight: 25,
			eventMultiplier: 2.0,
			conversionModifier: 1.3,
			churnRate: 0.03,
			properties: {
				user_type: "buyer",
				segment: "frequent_buyer",
			},
		},
		{
			name: "window_shopper",
			weight: 35,
			eventMultiplier: 0.5,
			conversionModifier: 0.4,
			churnRate: 0.15,
			properties: {
				user_type: "buyer",
				segment: "window_shopper",
			},
		},
		{
			name: "new_seller",
			weight: 12,
			eventMultiplier: 0.8,
			conversionModifier: 0.5,
			churnRate: 0.3,
			properties: {
				user_type: "seller",
				segment: "new_seller",
			},
			activeWindow: { maxDays: 28 },
		},
	],

	// ── World Events ──────────────────────────────
	worldEvents: [
		{
			name: "marketplace_fee_change",
			type: "product_launch",
			startDay: 45,
			duration: null,
			injectProps: { fee_change: "increased" },
			affectsEvents: ["listing created"],
		},
		{
			name: "viral_tiktok_moment",
			type: "campaign",
			startDay: 55,
			duration: 3,
			volumeMultiplier: 3.0,
			affectsEvents: ["item searched", "item viewed", "purchase completed"],
		},
	],

	// ── Engagement Decay ──────────────────────────
	engagementDecay: {
		model: "exponential",
		halfLife: 75,
		floor: 0.1,
	},

	// ── Attribution ──────────────────────────────
	attribution: {
		model: "last_touch",
		window: 7,
		campaigns: [
			{
				name: "google_shopping",
				source: "google",
				medium: "cpc",
				activeDays: [0, 100],
				dailyBudget: [200, 800],
				acquisitionRate: 0.03,
				userPersonaBias: { frequent_buyer: 0.5 },
			},
			{
				name: "tiktok",
				source: "tiktok",
				medium: "social",
				activeDays: [10, 90],
				dailyBudget: [100, 400],
				acquisitionRate: 0.02,
				userPersonaBias: { window_shopper: 0.5 },
			},
			{
				name: "seller_referral",
				source: "referral",
				medium: "referral",
				activeDays: [0, 100],
				dailyBudget: [50, 200],
				acquisitionRate: 0.02,
				userPersonaBias: { power_seller: 0.4 },
			},
		],
		organicRate: 0.30,
	},

	// ── Geo ──────────────────────────────────────
	geo: {
		sticky: true,
		regions: [
			{
				name: "us",
				countries: ["US"],
				weight: 50,
				timezoneOffset: -5,
				properties: { currency: "USD", locale: "en-US" },
			},
			{
				name: "uk",
				countries: ["GB"],
				weight: 20,
				timezoneOffset: 0,
				properties: { currency: "GBP", locale: "en-GB" },
			},
			{
				name: "australia",
				countries: ["AU"],
				weight: 15,
				timezoneOffset: 10,
				properties: { currency: "AUD", locale: "en-AU" },
			},
			{
				name: "canada",
				countries: ["CA"],
				weight: 15,
				timezoneOffset: -5,
				properties: { currency: "CAD", locale: "en-CA" },
			},
		],
	},

	// ── Anomalies ──────────────────────────────────
	anomalies: [
		{
			type: "extreme_value",
			event: "purchase completed",
			property: "total_amount",
			frequency: 0.002,
			multiplier: 30,
			tag: "whale_purchase",
		},
		{
			type: "coordinated",
			event: "account created",
			day: 68,
			window: 0.02,
			count: 200,
			tag: "viral_signup",
		},
	],

	// ── Hook Function ──────────────────────────────────────
	hook: function (record, type, meta) {
		// ── HOOK 7: POWER SELLER PROFILES (user) ─────────────
		// Power sellers get high total_transactions, top seller_rating,
		// and a realistic store name. Casual sellers get mid-range stats.
		if (type === "user") {
			if (record.segment === "power_seller") {
				record.total_transactions = chance.integer({ min: 100, max: 500 });
				record.seller_rating = chance.floating({ min: 4.5, max: 5.0, fixed: 1 });
				record.store_name = chance.pickone([
					"TechVault Pro", "StyleHaven", "GearFactory", "PrimeFinds",
					"TopShelf Goods", "EliteDeals", "QualityFirst Store", "BestBuy Resale",
				]);
			} else if (record.segment === "casual_seller") {
				record.total_transactions = chance.integer({ min: 5, max: 50 });
				record.seller_rating = chance.floating({ min: 3.0, max: 4.5, fixed: 1 });
				record.store_name = chance.pickone([
					"My Garage Sale", "Closet Cleanout", "Random Finds", "Weekend Seller",
				]);
			} else if (record.segment === "new_seller") {
				record.total_transactions = chance.integer({ min: 0, max: 3 });
				record.seller_rating = 0;
				record.store_name = "New Store";
			}
		}

		// ── HOOK 8: FREQUENT BUYER FUNNEL LIFT (funnel-pre) ──
		// (conversionRate filtering moved to everything hook)
		if (type === "funnel-pre") {
			// no-op: conversion filtering handled via event dropping in everything hook
		}

		// ── HOOK 1: FEE CHANGE IMPACT (event) ────────────────
		// Listings after day 45 get 1.3x higher listing_fee.
		if (type === "event") {
			const FEE_CHANGE_DAY = DATASET_START.add(45, "days");
			if (record.event === "listing created") {
				const eventTime = dayjs(record.time);
				if (eventTime.isAfter(FEE_CHANGE_DAY)) {
					record.listing_fee = Math.floor((record.listing_fee || 15) * 1.3);
					record.fee_change = "increased";
				}
			}

			// ── HOOK 2: WEEKEND SHOPPING SURGE (event) ───────
			// Purchases on Sat/Sun get 1.2x total_amount.
			if (record.event === "purchase completed") {
				const dayOfWeek = dayjs(record.time).day();
				// Saturday=6, Sunday=0
				if (dayOfWeek === 0 || dayOfWeek === 6) {
					record.total_amount = Math.floor((record.total_amount || 60) * 1.2);
				}
			}
		}

		// ── EVERYTHING HOOKS ─────────────────────────────────
		if (type === "everything") {
			let events = record;
			if (!events.length) return record;

			const profile = meta.profile;

			// ── SUPERPROP STAMPING ──────────────────────────
			// Stamp superProps from profile so they are consistent per user.
			if (profile) {
				events.forEach(e => {
					if (profile.platform) e.platform = profile.platform;
					if (profile.category) e.category = profile.category;
				});
			}

			// ── HOOK 8: FREQUENT BUYER CONVERSION FILTER ────
			// Non-frequent-buyer users drop ~25% of "purchase completed"
			// (last step of Browse to Purchase funnel) to simulate lower conversion.
			if (profile && profile.segment !== "frequent_buyer") {
				record = record.filter(e => {
					if (e.event === "purchase completed" && chance.bool({ likelihood: 25 })) return false;
					return true;
				});
				events = record;
			}

			// ── HOOK 3: SELLER SUCCESS → BUYER TRUST ─────────
			// Power sellers get 2x purchase events (cloned from existing).
			if (profile && profile.segment === "power_seller") {
				const purchases = events.filter(e => e.event === "purchase completed");
				const templatePurchase = purchases[0];
				if (templatePurchase && purchases.length > 0) {
					purchases.forEach(p => {
						if (chance.bool({ likelihood: 65 })) {
							events.push({
								...templatePurchase,
								time: dayjs(p.time).add(chance.integer({ min: 1, max: 48 }), "hours").toISOString(),
								user_id: p.user_id,
								total_amount: chance.integer({ min: 15, max: 400 }),
								item_count: chance.integer({ min: 1, max: 4 }),
							});
						}
					});
				}
			}

			// ── HOOK 4: SEARCH-TO-PURCHASE BY CATEGORY ───────
			// Electronics category gets cloned purchase events (higher conversion).
			const hasElectronicsSearch = events.some(e =>
				e.event === "item searched" && e.category === "electronics"
			);
			if (hasElectronicsSearch) {
				const templatePurchase = events.find(e => e.event === "purchase completed");
				if (templatePurchase) {
					const electronicsSearches = events.filter(e =>
						e.event === "item searched" && e.category === "electronics"
					);
					electronicsSearches.slice(0, 3).forEach(search => {
						if (chance.bool({ likelihood: 40 })) {
							events.push({
								...templatePurchase,
								time: dayjs(search.time).add(chance.integer({ min: 1, max: 12 }), "hours").toISOString(),
								user_id: search.user_id,
								total_amount: chance.integer({ min: 50, max: 300 }),
								category: "electronics",
							});
						}
					});
				}
			}

			// ── HOOK 5: RESPONSE TIME → CONVERSION ───────────
			// Sellers with avg response_time < 2 hours get more offer_accepted.
			const messages = events.filter(e => e.event === "message sent" && e.response_time_hours);
			if (messages.length > 0) {
				const avgResponseTime = messages.reduce((sum, m) => sum + m.response_time_hours, 0) / messages.length;
				if (avgResponseTime < 2) {
					const templateOffer = events.find(e => e.event === "offer accepted");
					if (templateOffer) {
						const offers = events.filter(e => e.event === "offer received");
						offers.forEach(offer => {
							if (chance.bool({ likelihood: 50 })) {
								events.push({
									...templateOffer,
									time: dayjs(offer.time).add(chance.integer({ min: 1, max: 4 }), "hours").toISOString(),
									user_id: offer.user_id,
									response_time_hours: chance.floating({ min: 0.1, max: 2, fixed: 1 }),
								});
							}
						});
					}
				}
			}

			// ── HOOK 6: NEW SELLER CHURN ─────────────────────
			// New sellers with <10 events lose 40% of events after day 14.
			if (profile && profile.segment === "new_seller" && events.length < 10) {
				const DAY_14 = DATASET_START.add(14, "days");
				for (let i = events.length - 1; i >= 0; i--) {
					const eventTime = dayjs(events[i].time);
					if (eventTime.isAfter(DAY_14) && chance.bool({ likelihood: 40 })) {
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
