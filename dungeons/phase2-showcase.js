/**
 * Phase 2 Showcase Dungeon
 * Exercises all 9 Phase 2 features in a realistic e-commerce scenario
 */
import { initChance, integer, weighChoices, pickAWinner } from '../lib/utils/utils.js';
const chance = initChance('phase2-showcase');

export default {
	name: "phase2-showcase",
	seed: "phase2-showcase",
	numUsers: 1000,
	numEvents: 100_000,
	numDays: 90,
	format: "json",
	writeToDisk: false,

	hasLocation: true,
	hasBrowser: true,
	hasCampaigns: false, // using attribution instead
	hasIOSDevices: true,
	hasAndroidDevices: true,
	hasDesktopDevices: true,

	// ── Events ──
	events: [
		{ event: "sign up", weight: 1, isFirstEvent: true },
		{ event: "page view", weight: 8 },
		{ event: "search", weight: 4, properties: { query: () => chance.word() } },
		{ event: "view item", weight: 6, properties: {
			product_id: () => `PROD-${integer(1, 500)}`,
			category: ["electronics", "clothing", "home", "beauty", "sports"],
			price: () => chance.floating({ min: 5, max: 200, fixed: 2 })
		}},
		{ event: "add to cart", weight: 3, properties: {
			product_id: () => `PROD-${integer(1, 500)}`,
			quantity: [1, 1, 1, 2, 2, 3],
			price: () => chance.floating({ min: 5, max: 200, fixed: 2 })
		}},
		{ event: "checkout", weight: 2, properties: {
			amount: () => chance.floating({ min: 10, max: 500, fixed: 2 }),
			payment_method: ["credit_card", "credit_card", "paypal", "apple_pay", "google_pay"],
			items_count: [1, 1, 2, 2, 3, 4, 5]
		}},
		{ event: "support ticket", weight: 1, properties: {
			priority: ["low", "low", "medium", "medium", "high", "critical"],
			category: ["billing", "shipping", "product", "account", "other"]
		}},
		{ event: "app crash", weight: 1, isChurnEvent: true, returnLikelihood: 0.3 }
	],

	// ── Funnels ──
	funnels: [
		{
			sequence: ["sign up", "page view", "search", "view item", "add to cart", "checkout"],
			conversionRate: 35,
			order: "sequential",
			isFirstFunnel: true,
			timeToConvert: 72,
			name: "Onboarding Purchase"
		},
		{
			sequence: ["page view", "view item", "add to cart", "checkout"],
			conversionRate: 25,
			order: "sequential",
			timeToConvert: 48,
			weight: 3,
			name: "Browse to Buy"
		},
		{
			sequence: ["search", "view item", "add to cart", "checkout"],
			conversionRate: 40,
			order: "sequential",
			timeToConvert: 24,
			weight: 2,
			experiment: true,
			name: "Search Purchase"
		}
	],

	superProps: {
		platform: weighChoices([
			{ value: "web", weight: 40 },
			{ value: "ios", weight: 35 },
			{ value: "android", weight: 25 }
		])
	},

	userProps: {
		age_group: ["18-24", "18-24", "25-34", "25-34", "25-34", "35-44", "35-44", "45-54", "55+"],
		gender: ["male", "female", "non-binary"],
	},

	// ── Feature 1: Personas ──
	personas: [
		{
			name: "power_buyer",
			weight: 15,
			eventMultiplier: 4.0,
			conversionModifier: 1.5,
			churnRate: 0.02,
			properties: {
				customer_segment: "power_buyer",
				loyalty_tier: "gold"
			}
		},
		{
			name: "casual_browser",
			weight: 45,
			eventMultiplier: 0.6,
			conversionModifier: 0.7,
			churnRate: 0.1,
			properties: {
				customer_segment: "casual_browser",
				loyalty_tier: "none"
			}
		},
		{
			name: "deal_hunter",
			weight: 25,
			eventMultiplier: 1.2,
			conversionModifier: 1.1,
			churnRate: 0.05,
			properties: {
				customer_segment: "deal_hunter",
				loyalty_tier: "silver"
			}
		},
		{
			name: "churner",
			weight: 15,
			eventMultiplier: 0.4,
			conversionModifier: 0.3,
			churnRate: 0.6,
			properties: {
				customer_segment: "churner",
				loyalty_tier: "none"
			},
			activeWindow: { maxDays: 14 }
		}
	],

	// ── Feature 2: World Events ──
	worldEvents: [
		{
			name: "black_friday",
			type: "campaign",
			startDay: 60,
			duration: 3,
			volumeMultiplier: 2.5,
			conversionModifier: 1.8,
			injectProps: { promo: "black_friday", discount_pct: 30 },
			affectsEvents: ["checkout", "add to cart", "view item"]
		},
		{
			name: "platform_outage",
			type: "outage",
			startDay: 40,
			duration: 0.125, // 3 hours
			volumeMultiplier: 0.05,
			injectProps: { during_outage: true },
			affectsEvents: "*",
			aftermath: { duration: 1, volumeMultiplier: 1.3 }
		},
		{
			name: "new_checkout_v2",
			type: "product_launch",
			startDay: 50,
			duration: null, // permanent
			injectProps: { checkout_version: "v2" },
			affectsEvents: ["checkout"]
		}
	],

	// ── Feature 3: Engagement Decay ──
	engagementDecay: {
		model: "exponential",
		halfLife: 60,
		floor: 0.15,
		reactivationChance: 0.03,
		reactivationMultiplier: 2.0
	},

	// ── Feature 4: Data Quality ──
	dataQuality: {
		nullRate: 0.02,
		nullProps: ["category", "payment_method", "query"],
		duplicateRate: 0.005,
		lateArrivingRate: 0.003,
		botUsers: 3,
		botEventsPerUser: 500,
		timezoneConfusion: 0.01,
		emptyEvents: 0.001
	},

	// ── Feature 5: Subscription ──
	subscription: {
		plans: [
			{ name: "free", price: 0, default: true },
			{ name: "plus", price: 9.99, trialDays: 14 },
			{ name: "premium", price: 24.99 },
			{ name: "business", price: 49.99 }
		],
		lifecycle: {
			trialToPayRate: 0.35,
			upgradeRate: 0.08,
			downgradeRate: 0.04,
			churnRate: 0.06,
			winBackRate: 0.12,
			winBackDelay: 21,
			paymentFailureRate: 0.03
		}
	},

	// ── Feature 6: Attribution ──
	attribution: {
		model: "last_touch",
		window: 7,
		campaigns: [
			{
				name: "google_shopping",
				source: "google",
				medium: "cpc",
				activeDays: [0, 90],
				dailyBudget: [200, 800],
				acquisitionRate: 0.03,
				userPersonaBias: { deal_hunter: 0.4, casual_browser: 0.4 }
			},
			{
				name: "instagram_brand",
				source: "instagram",
				medium: "social",
				activeDays: [10, 80],
				dailyBudget: [100, 400],
				acquisitionRate: 0.02,
				userPersonaBias: { casual_browser: 0.6, power_buyer: 0.2 }
			},
			{
				name: "black_friday_push",
				source: "email",
				medium: "email",
				activeDays: [58, 65],
				dailyBudget: [500, 2000],
				acquisitionRate: 0.05,
				userPersonaBias: { deal_hunter: 0.7 }
			}
		],
		organicRate: 0.35
	},

	// ── Feature 7: Geographic Intelligence ──
	geo: {
		sticky: true,
		regions: [
			{
				name: "north_america",
				countries: ["US", "CA"],
				weight: 45,
				timezoneOffset: -5,
				properties: { currency: "USD", locale: "en-US" }
			},
			{
				name: "europe",
				countries: ["GB", "DE", "FR"],
				weight: 30,
				timezoneOffset: 1,
				properties: { currency: "EUR", locale: "en-EU", gdpr_consent: true }
			},
			{
				name: "asia_pacific",
				countries: ["JP", "AU"],
				weight: 25,
				timezoneOffset: 9,
				properties: { currency: "JPY", locale: "ja-JP" }
			}
		]
	},

	// ── Feature 8: Progressive Feature Adoption ──
	features: [
		{
			name: "dark_mode",
			launchDay: 20,
			adoptionCurve: "fast",
			property: "theme",
			values: ["light", "dark"],
			defaultBefore: "light",
			affectsEvents: "*"
		},
		{
			name: "ai_recommendations",
			launchDay: 45,
			adoptionCurve: { k: 0.12, midpoint: 20 },
			property: "rec_source",
			values: ["manual", "ai_personalized"],
			affectsEvents: ["view item", "search"],
			conversionLift: 1.15
		}
	],

	// ── Feature 9: Anomalies ──
	anomalies: [
		{
			type: "extreme_value",
			event: "checkout",
			property: "amount",
			frequency: 0.005,
			multiplier: 50,
			tag: "whale_purchase"
		},
		{
			type: "burst",
			event: "app crash",
			day: 38,
			duration: 0.083, // ~2 hours
			count: 800,
			properties: { crash_type: "payment_sdk", severity: "critical" },
			tag: "crash_storm"
		},
		{
			type: "coordinated",
			event: "sign up",
			day: 70,
			window: 0.007, // ~10 minutes
			count: 150,
			tag: "viral_signup"
		}
	],

	percentUsersBornInDataset: 50,
	bornRecentBias: 0.3,
	soup: "growth",

	// ── Hook (overrides everything) ──
	hook: function(record, type, meta) {
		if (type === 'event' && record.event === 'checkout' && meta.persona) {
			// Hook demonstrates override: power buyers get free shipping
			if (meta.persona.name === 'power_buyer') {
				record.free_shipping = true;
			}
		}
		return record;
	}
};
