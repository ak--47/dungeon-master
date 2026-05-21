// ── IMPORTS ──
import Chance from 'chance';
let chance = new Chance();
import { pickAWinner, weighNumRange, integer, weighChoices, dateRange, listOf, objectList } from "../../lib/utils/utils.js";
/** @typedef {import("../../types").Dungeon} Config */

// ── OVERVIEW ──
/*
 * NAME:       simplest
 * PURPOSE:    Engine-validation baseline — no hooks. Engine + TimeSoup alone produce the trend shape. Used by engine-shape canary + full sweep.
 * SCALE:      2,500 users, ~250K events, 100 days
 * EVENTS (25): page view (10) > view item (9) > view category (8) > login (8) > search (7) > notification received (7) > watch video (6) > add to cart (5) > notification clicked (5) > rate item (4) > add to wishlist (4) > checkout (3) > remove from cart (3) > update profile (3) > compare items (3) > share content (2) > support ticket (2) > apply coupon (2) > leave review (2) > sign up (1) > add payment method (1) > invite friend (1) > save address (1) > subscribe newsletter (1) > redeem reward (1)
 * FUNNELS (11): Signup Funnel, Purchase Funnel, Content Engagement, Review Funnel, Browse to Cart, Notification Engagement, Wishlist to Purchase, Post-Purchase Advocacy, Coupon Purchase Flow, Newsletter to Purchase, Support Recovery
 * USER PROPS:  theme, title, spiritAnimal, luckyNumber, emailOptIn, signupDate, favoriteCategories, preferences, recentOrders
 * SUPER PROPS: theme
 * GROUPS:      none
 *
 * USE CASES:
 *   - Engine sweep harness baseline (`scripts/sweep-engine.mjs`). Strict-bar regression
 *     testing across the 184-combo macro/born/rate/active-day matrix.
 *   - Reference for "what an average dungeon looks like" — diverse events + funnels +
 *     user props with no hook architecting on top.
 *   - Starting template for new dungeons before adding bespoke hooks.
 *   - At least one property of every Mixpanel data type:
 *       string, numeric, boolean, date, list, object, list-of-objects
 *     on both event properties and user properties.
 *   - No device/location/campaign data — pure event stream.
 *   - **No hooks.** This is the engine-validation baseline; engine + TimeSoup alone
 *     produce the trend shape. Hook authors should reach for vertical dungeons or
 *     write hooks against this template; do NOT add hooks here.
 */

// ── SCALE ──
const SEED = "simple is best";
const num_days = 100;
const num_users = 2_500;
const avg_events_per_user_per_day = 1;
const token = process.env.MP_TOKEN || "";

// ── DATA ARRAYS ──
const itemCategories = ["Books", "Movies", "Music", "Games", "Electronics", "Computers", "Smart Home", "Home", "Garden", "Pet", "Beauty", "Health", "Toys", "Kids", "Baby", "Handmade", "Sports", "Outdoors", "Automotive", "Industrial", "Entertainment", "Art", "Food", "Appliances", "Office", "Wedding", "Software"];

const videoCategories = ["funny", "educational", "inspirational", "music", "news", "sports", "cooking", "DIY", "travel", "gaming"];

// ── CONFIG ──
/** @type {import('../types.js').Dungeon} */
const config = {
	seed: SEED,
	numDays: num_days,
	avgEventsPerUserPerDay: avg_events_per_user_per_day,
	numUsers: num_users,
	format: 'json', //csv or json
	credentials: {
		token,
		region: "US",
	},
	switches: {
		hasSessionIds: false, //if true, hasSessionIds are created for each user
		hasAdSpend: false,
		hasLocation: false,
		hasAndroidDevices: false,
		hasIOSDevices: false,
		hasDesktopDevices: false,
		hasBrowser: false,
		hasCampaigns: false,
		isAnonymous: false,
		alsoInferFunnels: false,
	},
	concurrency: 1,
	writeToDisk: false,

	events: [
		{
			event: "page view",
			weight: 10,
			isStrictEvent: false,
			properties: {
				page: ["/", "/", "/help", "/account", "/pricing", "/product", "/about", "/blog"],
				utm_source: ["$organic", "$organic", "$organic", "$organic", "google", "google", "google", "facebook", "facebook", "twitter", "linkedin"],
			}
		},
		{
			event: "sign up",
			weight: 1,
			isStrictEvent: false,
			isFirstEvent: true,
			properties: {
				signupMethod: ["email", "google", "facebook", "github"],
				referral: weighChoices(["none", "none", "none", "friend", "ad", "ad", "friend", "friend"]),
			}
		},
		{
			event: "login",
			weight: 8,
			isStrictEvent: false,
			properties: {
				method: ["password", "google", "facebook", "github"],
			}
		},
		{
			event: "search",
			weight: 7,
			isStrictEvent: false,
			properties: {
				query_length: weighNumRange(1, 50),
				resultsReturned: weighNumRange(0, 100, .25),
				category: pickAWinner(itemCategories, integer(0, 27)),
			}
		},
		{
			event: "view item",
			weight: 9,
			isStrictEvent: false,
			properties: {
				isFeaturedItem: [true, false, false],
				itemCategory: pickAWinner(itemCategories, integer(0, 27)),
				price: weighNumRange(5, 500, .25),
				rating: weighNumRange(1, 5),
				// list (array of strings) — Mixpanel "List" property type
				tags: listOf(["new", "sale", "limited", "popular", "trending", "exclusive", "clearance", "preorder"], { min: 1, max: 3 }),
				// date — Mixpanel "Date" property type, default ISO string
				lastRestockedAt: dateRange(),
			}
		},
		{
			event: "add to cart",
			weight: 5,
			isStrictEvent: false,
			properties: {
				amount: weighNumRange(5, 500, .25),
				itemCategory: pickAWinner(itemCategories, integer(0, 27)),
				numItems: weighNumRange(1, 5),
			}
		},
		{
			event: "checkout",
			weight: 3,
			isStrictEvent: false,
			properties: {
				amount: weighNumRange(10, 500, .25),
				currency: ["USD", "CAD", "EUR", "JPY"],
				coupon: weighChoices(["none", "none", "none", "none", "10%OFF", "20%OFF", "30%OFF"]),
				numItems: weighNumRange(1, 10),
				// object — Mixpanel "Object" property type (plain object, returned as-is)
				billingAddress: { country: "US", region: "CA", postalCode: "94016" },
				// list of objects — Mixpanel "List of Objects" property type
				lineItems: objectList({
					sku: weighNumRange(10000, 99999),
					name: pickAWinner(itemCategories, integer(0, 27)),
					qty: [1, 1, 1, 2, 2, 3],
					price: weighNumRange(5, 200, .25),
				}, { min: 1, max: 5 }),
			}
		},
		{
			event: "watch video",
			weight: 6,
			isStrictEvent: false,
			properties: {
				videoCategory: pickAWinner(videoCategories, integer(0, 9)),
				watchTimeSec: weighNumRange(10, 600, .25),
				quality: ["1080p", "720p", "480p", "360p"],
			}
		},
		{
			event: "share content",
			weight: 2,
			isStrictEvent: false,
			properties: {
				platform: ["twitter", "facebook", "linkedin", "email", "link"],
				contentType: ["video", "product", "article"],
			}
		},
		{
			event: "rate item",
			weight: 4,
			isStrictEvent: false,
			properties: {
				rating: weighNumRange(1, 5),
				itemCategory: pickAWinner(itemCategories, integer(0, 27)),
				hasReviewText: [true, false, false, false],
			}
		},
		// weight 1 used by sign up (isFirstEvent)
		// weights 1-10 across 26 events; some sharing is unavoidable
		// but no two adjacent events share a weight
		{
			event: "support ticket",
			weight: 2,
			isStrictEvent: false,
			properties: {
				priority: weighChoices(["low", "low", "medium", "medium", "medium", "high"]),
				category: ["billing", "technical", "account", "shipping", "returns"],
			}
		},
		{
			event: "add to wishlist",
			weight: 4,
			isStrictEvent: false,
			properties: {
				itemCategory: pickAWinner(itemCategories, integer(0, 27)),
				price: weighNumRange(5, 500, .25),
			}
		},
		{
			event: "remove from cart",
			weight: 3,
			isStrictEvent: false,
			properties: {
				reason: weighChoices(["changed mind", "too expensive", "found better", "duplicate", "changed mind", "changed mind"]),
			}
		},
		{
			event: "apply coupon",
			weight: 2,
			isStrictEvent: false,
			properties: {
				couponCode: weighChoices(["SAVE10", "SAVE20", "WELCOME", "FREESHIP", "VIP30", "SAVE10", "SAVE10"]),
				discountPercent: weighNumRange(5, 50),
			}
		},
		{
			event: "notification received",
			weight: 7,
			isStrictEvent: false,
			properties: {
				channel: ["push", "email", "in-app", "sms"],
				type: ["promo", "order update", "recommendation", "reminder"],
			}
		},
		{
			event: "notification clicked",
			weight: 5,
			isStrictEvent: false,
			properties: {
				channel: ["push", "email", "in-app", "sms"],
				type: ["promo", "order update", "recommendation", "reminder"],
			}
		},
		{
			event: "add payment method",
			weight: 1,
			isStrictEvent: false,
			properties: {
				type: ["credit card", "debit card", "paypal", "apple pay", "google pay"],
			}
		},
		{
			event: "update profile",
			weight: 3,
			isStrictEvent: false,
			properties: {
				field: ["avatar", "name", "email", "address", "phone", "preferences"],
			}
		},
		{
			event: "invite friend",
			weight: 1,
			isStrictEvent: false,
			properties: {
				method: ["email", "link", "sms"],
			}
		},
		{
			event: "view category",
			weight: 8,
			isStrictEvent: false,
			properties: {
				category: pickAWinner(itemCategories, integer(0, 27)),
				sortBy: ["popular", "newest", "price low", "price high", "rating"],
			}
		},
		{
			event: "save address",
			weight: 1,
			isStrictEvent: false,
			properties: {
				type: ["home", "work", "other"],
			}
		},
		{
			event: "compare items",
			weight: 3,
			isStrictEvent: false,
			properties: {
				numItems: weighNumRange(2, 5),
				itemCategory: pickAWinner(itemCategories, integer(0, 27)),
			}
		},
		{
			event: "subscribe newsletter",
			weight: 1,
			isStrictEvent: false,
			properties: {
				frequency: ["daily", "weekly", "monthly"],
				topics: ["deals", "new arrivals", "recommendations", "deals", "deals"],
			}
		},
		{
			event: "leave review",
			weight: 2,
			isStrictEvent: false,
			properties: {
				rating: weighNumRange(1, 5),
				wordCount: weighNumRange(10, 200, .25),
				hasPhotos: [true, false, false, false, false],
			}
		},
		{
			event: "redeem reward",
			weight: 1,
			isStrictEvent: false,
			properties: {
				rewardType: ["discount", "free shipping", "free item", "points bonus"],
				pointsUsed: weighNumRange(100, 5000, .25),
			}
		},

	],
	funnels: [
		{
			sequence: ["page view", "sign up"],
			conversionRate: 55,
			order: "sequential",
			weight: 5,
			isFirstFunnel: true,
			timeToConvert: 1,
			name: "Signup Funnel"
		},
		{
			sequence: ["search", "view item", "add to cart", "checkout"],
			conversionRate: 35,
			order: "sequential",
			weight: 8,
			timeToConvert: 3,
			name: "Purchase Funnel"
		},
		{
			sequence: ["page view", "watch video", "share content"],
			conversionRate: 40,
			order: "sequential",
			weight: 6,
			timeToConvert: 2,
			name: "Content Engagement"
		},
		{
			sequence: ["view item", "rate item"],
			conversionRate: 25,
			order: "sequential",
			weight: 3,
			timeToConvert: 5,
			name: "Review Funnel"
		},
		{
			sequence: ["view category", "view item", "compare items", "add to cart"],
			conversionRate: 30,
			order: "sequential",
			weight: 7,
			timeToConvert: 3,
			name: "Browse to Cart"
		},
		{
			sequence: ["notification received", "notification clicked", "view item"],
			conversionRate: 45,
			order: "sequential",
			weight: 4,
			timeToConvert: 1,
			name: "Notification Engagement"
		},
		{
			sequence: ["view item", "add to wishlist", "apply coupon", "add to cart", "checkout"],
			conversionRate: 20,
			order: "sequential",
			weight: 2,
			timeToConvert: 7,
			name: "Wishlist to Purchase"
		},
		{
			sequence: ["checkout", "leave review", "invite friend"],
			conversionRate: 15,
			order: "sequential",
			weight: 1,
			timeToConvert: 14,
			name: "Post-Purchase Advocacy"
		},
		{
			sequence: ["login", "view item", "add to cart", "apply coupon", "checkout"],
			conversionRate: 30,
			order: "sequential",
			weight: 9,
			timeToConvert: 2,
			name: "Coupon Purchase Flow"
		},
		{
			sequence: ["subscribe newsletter", "notification received", "notification clicked", "checkout"],
			conversionRate: 10,
			order: "sequential",
			weight: 3,
			timeToConvert: 14,
			name: "Newsletter to Purchase"
		},
		{
			sequence: ["support ticket", "update profile", "checkout"],
			conversionRate: 20,
			order: "sequential",
			weight: 10,
			timeToConvert: 7,
			name: "Support Recovery"
		},

	],
	superProps: {
		theme: ["light", "dark", "custom", "light", "dark"],
	},
	/*
	user properties work the same as event properties
	each key should be an array or function reference
	*/
	userProps: {
		// string
		theme: ["light", "dark", "custom", "light", "dark"],
		title: chance.profession.bind(chance),
		spiritAnimal: ["duck", "dog", "otter", "penguin", "cat", "elephant", "lion", "cheetah", "giraffe", "zebra", "rhino", "hippo", "whale", "dolphin", "shark", "octopus", "squid", "jellyfish", "starfish", "seahorse", "crab", "lobster", "shrimp", "clam", "snail", "slug", "butterfly", "moth", "bee", "wasp", "ant", "beetle", "ladybug", "caterpillar", "centipede", "millipede", "scorpion", "spider", "tarantula", "tick", "mite", "mosquito", "fly", "dragonfly", "damselfly", "grasshopper", "cricket", "locust", "mantis", "cockroach", "termite", "praying mantis", "walking stick", "stick bug", "leaf insect", "lacewing", "aphid", "cicada", "thrips", "psyllid", "scale insect", "whitefly", "mealybug", "planthopper", "leafhopper", "treehopper", "flea", "louse", "bedbug", "flea beetle", "weevil", "longhorn beetle", "leaf beetle", "tiger beetle", "ground beetle", "lady beetle", "firefly", "click beetle", "rove beetle", "scarab beetle", "dung beetle", "stag beetle", "rhinoceros beetle", "hercules beetle", "goliath beetle", "jewel beetle", "tortoise beetle"],
		// numeric
		luckyNumber: weighNumRange(42, 420, .3),
		// boolean
		emailOptIn: [true, true, false],
		// date
		signupDate: dateRange(),
		// list
		favoriteCategories: listOf(itemCategories, { min: 1, max: 4 }),
		// object
		preferences: { notifications: true, currency: "USD", language: "en-US" },
		// list of objects
		recentOrders: objectList({
			orderId: weighNumRange(100000, 999999),
			total: weighNumRange(10, 500, .25),
			itemCount: [1, 1, 2, 2, 3],
		}, { min: 0, max: 3 }),
	},
	scdProps: {},
	mirrorProps: {},

	/*
	for group analytics keys, we need an array of arrays [[],[],[]]
	each pair represents a group_key and the number of profiles for that key
	*/
	groupKeys: [],
	groupProps: {},
	lookupTables: [],
	// No hook by design — this is the engine-validation baseline. Engine + TimeSoup
	// alone produce the trend shape. To experiment with hooks, fork this file.
};

export default config;
