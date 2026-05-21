// ── IMPORTS ──
import Chance from 'chance';
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);
import { pickAWinner, weighNumRange, date, integer, weighChoices } from "../../lib/utils/utils.js";
/** @typedef {import("../../types").Dungeon} Config */

// ── OVERVIEW ──
/*
 * NAME:       scd
 * PURPOSE:    SCD-focused dungeon — user + group slowly-changing dimensions across e-commerce events
 * SCALE:      500 users, ~50K events, 30 days (CSV format, 1,000 company groups)
 * EVENTS (7): checkout, add to cart, page view, watch video, view item, save item, sign up, cart_abandoned
 * FUNNELS (0): none
 * SCDs:       user — role (weekly), NPS (daily); company_id — MRR (monthly), AccountHealthScore (weekly), plan (monthly)
 */

// ── HOOK STORIES ──
/*
 * 1. SPEND TIERS (user hook)
 *    Users with luckyNumber > 250 = "high_spender", else "budget".
 *
 * 2. COUPON DISCOUNTS + WEEKEND VIEWING (event hook)
 *    Checkouts with coupons get discounted amounts. Weekend video
 *    watchers get 1.5x watch time with is_weekend: true.
 *
 *    Mixpanel Report:
 *    - Insights: "checkout", AVG(amount), breakdown by discount_applied
 *      Expected: discount_applied=true shows lower amounts
 *    - Insights: "watch video", AVG(watchTimeSec), breakdown by is_weekend
 *      Expected: weekend watch times ~1.5x higher
 *
 * 3. CART ABANDONMENT (everything hook)
 *    Users who add to cart but never checkout get a synthetic
 *    "cart_abandoned" event 30 min after last add-to-cart.
 *
 *    Mixpanel Report:
 *    - Insights: "cart_abandoned" total events
 *      Expected: visible volume of abandoned cart events
 */

// ── SCALE ──
const SEED = "simple is best";
const NUM_DAYS = 30;
const NUM_USERS = 500;
const EVENTS_PER_DAY = 3.33;
const token = process.env.MP_TOKEN || "";

const chance = new Chance();

// ── KNOBS (tweak these to reshape stories) ──
const HIGH_SPENDER_THRESHOLD = 250;
const WEEKEND_WATCH_MULTIPLIER = 1.5;
const ABANDONMENT_DELAY_MINUTES = 30;

// ── DATA ARRAYS ──
const itemCategories = ["Books", "Movies", "Music", "Games", "Electronics", "Computers", "Smart Home", "Home", "Garden", "Pet", "Beauty", "Health", "Toys", "Kids", "Baby", "Handmade", "Sports", "Outdoors", "Automotive", "Industrial", "Entertainment", "Art", "Food", "Appliances", "Office", "Wedding", "Software"];
const videoCategories = ["funny", "educational", "inspirational", "music", "news", "sports", "cooking", "DIY", "travel", "gaming"];
const spiritAnimals = ["duck", "dog", "otter", "penguin", "cat", "elephant", "lion", "cheetah", "giraffe", "zebra", "rhino", "hippo", "whale", "dolphin", "shark", "octopus", "squid", "jellyfish", "starfish", "seahorse", "crab", "lobster", "shrimp", "clam", "snail", "slug", "butterfly", "moth", "bee", "wasp", "ant", "beetle", "ladybug", "caterpillar", "centipede", "millipede", "scorpion", "spider", "tarantula", "tick", "mite", "mosquito", "fly", "dragonfly", "damselfly", "grasshopper", "cricket", "locust", "mantis", "cockroach", "termite", "praying mantis", "walking stick", "stick bug", "leaf insect", "lacewing", "aphid", "cicada", "thrips", "psyllid", "scale insect", "whitefly", "mealybug", "planthopper", "leafhopper", "treehopper", "flea", "louse", "bedbug", "flea beetle", "weevil", "longhorn beetle", "leaf beetle", "tiger beetle", "ground beetle", "lady beetle", "firefly", "click beetle", "rove beetle", "scarab beetle", "dung beetle", "stag beetle", "rhinoceros beetle", "hercules beetle", "goliath beetle", "jewel beetle", "tortoise beetle"];
const industries = ["technology", "education", "finance", "healthcare", "retail", "manufacturing", "transportation", "entertainment", "media", "real estate", "construction", "hospitality", "energy", "utilities", "agriculture", "other"];
const csmNames = ["AK", "Neha", "Rajiv", "Deepak", "Justin", "Hans", "Katie", "Somya", "Tony", "Kaan"];

// ── HELPER FUNCTIONS ──
function handleUserHook(record) {
	// classify users into spending tiers
	record.spendTier = record.luckyNumber > HIGH_SPENDER_THRESHOLD ? "high_spender" : "budget";
	return record;
}

function handleEventHook(record) {
	// coupon users get discounted checkout amounts
	if (record.event === "checkout" && record.coupon && record.coupon !== "none") {
		const discountPct = parseInt(record.coupon) || 10;
		record.amount = Math.round(record.amount * (1 - discountPct / 100));
		record.discount_applied = true;
	}
	// weekend watchers get longer watch times
	if (record.event === "watch video" && record.time) {
		const day = dayjs(record.time).day();
		if (day === 0 || day === 6) {
			record.watchTimeSec = Math.round((record.watchTimeSec || 60) * WEEKEND_WATCH_MULTIPLIER);
			record.is_weekend = true;
		}
	}
	return record;
}

function handleEverythingHook(record, meta) {
	// stamp superProps from profile for consistency
	const profile = meta.profile;
	record.forEach(e => {
		e.platform = profile.platform;
		e.currentTheme = profile.currentTheme;
	});

	const hasAddToCart = record.some(e => e.event === "add to cart");
	const hasCheckout = record.some(e => e.event === "checkout");
	// users who added to cart but never checked out: synthesize a cart_abandoned event
	if (hasAddToCart && !hasCheckout && record.length > 2) {
		const lastAdd = record.filter(e => e.event === "add to cart").pop();
		if (lastAdd) {
			record.push({
				...lastAdd,
				event: "cart_abandoned",
				time: dayjs(lastAdd.time).add(ABANDONMENT_DELAY_MINUTES, "minute").toISOString(),
				user_id: lastAdd.user_id,
				amount: lastAdd.amount,
			});
		}
	}
	return record;
}

// ── CONFIG ──
/** @type {Config} */
const config = {
	seed: SEED,
	numDays: NUM_DAYS,
	avgEventsPerUserPerDay: EVENTS_PER_DAY,
	numUsers: NUM_USERS,
	format: 'csv', //csv or json
	credentials: {
		token,
		region: "US",
	},
	switches: {
		hasSessionIds: false, //if true, hasSessionIds are created for each user
		hasAdSpend: false,
		hasLocation: true,
		hasAndroidDevices: true,
		hasIOSDevices: true,
		hasDesktopDevices: true,
		hasBrowser: true,
		hasCampaigns: true,
		isAnonymous: false,
	},
	events: [
		{
			event: "checkout",
			weight: 2,
			properties: {
				amount: weighNumRange(5, 500, .25),
				currency: ["USD", "CAD", "EUR", "BTC", "ETH", "JPY"],
				coupon: weighChoices(["none", "none", "none", "none", "10%OFF", "20%OFF", "10%OFF", "20%OFF", "30%OFF", "40%OFF", "50%OFF"]),
				numItems: weighNumRange(1, 10),
				discount_applied: [false],
			}
		},
		{
			event: "add to cart",
			weight: 4,
			properties: {
				amount: weighNumRange(5, 500, .25),
				rating: weighNumRange(1, 5),
				reviews: weighNumRange(0, 35),
				isFeaturedItem: [true, false, false],
				itemCategory: pickAWinner(itemCategories, integer(0, 27)),
				dateItemListed: date(30, true, 'YYYY-MM-DD'),
			}
		},
		{
			event: "page view",
			weight: 10,
			properties: {
				page: ["/", "/", "/help", "/account", "/watch", "/listen", "/product", "/people", "/peace"],
				utm_source: ["$organic", "$organic", "$organic", "$organic", "google", "google", "google", "facebook", "facebook", "twitter", "linkedin"],
			}
		},
		{
			event: "watch video",
			weight: 8,
			properties: {
				videoCategory: pickAWinner(videoCategories, integer(0, 9)),
				isFeaturedItem: [true, false, false],
				watchTimeSec: weighNumRange(10, 600, .25),
				quality: ["2160p", "1440p", "1080p", "720p", "480p", "360p", "240p"],
				format: ["mp4", "avi", "mov", "mpg"],
				uploader_id: chance.guid.bind(chance),
				is_weekend: [false],
			}
		},
		{
			event: "view item",
			weight: 8,
			properties: {
				isFeaturedItem: [true, false, false],
				itemCategory: pickAWinner(itemCategories, integer(0, 27)),
				dateItemListed: date(30, true, 'YYYY-MM-DD'),
			}
		},
		{
			event: "save item",
			weight: 5,
			properties: {
				isFeaturedItem: [true, false, false],
				itemCategory: pickAWinner(itemCategories, integer(0, 27)),
				dateItemListed: date(30, true, 'YYYY-MM-DD'),
			}
		},
		{
			event: "sign up",
			isFirstEvent: true,
			weight: 0,
			properties: {
				variants: ["A", "B", "C", "Control"],
				flows: ["new", "existing", "loyal", "churned"],
				flags: ["on", "off"],
				experiment_ids: ["1234", "5678", "9012", "3456", "7890"],
				multiVariate: [true, false]
			}
		},
		{
			event: "cart_abandoned",
			weight: 0,
			isStrictEvent: true,
			properties: {
				amount: weighNumRange(5, 500, .25),
			}
		}
	],
	superProps: {
		platform: ["web", "mobile", "web", "mobile", "web", "web", "kiosk", "smartTV"],
		currentTheme: weighChoices(["light", "dark", "custom", "light", "dark"]),
	},
	userProps: {
		title: chance.profession.bind(chance),
		luckyNumber: weighNumRange(42, 420, .3),
		spiritAnimal: spiritAnimals,
		spendTier: ["budget"],
		platform: ["web", "mobile", "web", "mobile", "web", "web", "kiosk", "smartTV"],
		currentTheme: weighChoices(["light", "dark", "custom", "light", "dark"]),
	},
	scdProps: {
		role: {
			type: "user",
			frequency: "week",
			values: ["admin", "collaborator", "user", "view only", "no access"],
			timing: 'fuzzy',
			max: 10
		},
		NPS: {
			type: "user",
			frequency: "day",
			values: weighNumRange(1, 10, 2, 150),
			timing: 'fuzzy',
			max: 10
		},
		MRR: {
			type: "company_id",
			frequency: "month",
			values: weighNumRange(0, 10000, .15),
			timing: 'fixed',
			max: 10
		},
		AccountHealthScore: {
			type: "company_id",
			frequency: "week",
			values: weighNumRange(1, 10, .15),
			timing: 'fixed',
			max: 40
		},
		plan: {
			type: "company_id",
			frequency: "month",
			values: ["free", "basic", "premium", "enterprise"],
			timing: 'fixed',
			max: 10
		}
	},
	groupKeys: [["company_id", 1_000]],
	groupProps: {
		company_id: {
			name: () => { return chance.name(); },
			email: () => { return `CSM: ${chance.pickone(csmNames)}`; },
			industry: industries,
			segment: ["SMB", "SMB", "SMB", "Mid Market", "Mid Market", "Enterprise"],
			"# active users": chance.integer({ min: 2, max: 20 })
		}
	},
	hook: function (record, type, meta) {
		if (type === "user") return handleUserHook(record);
		if (type === "event") return handleEventHook(record);
		if (type === "everything") return handleEverythingHook(record, meta);
		return record;
	}
};

export default config;
