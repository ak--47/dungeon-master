// ── IMPORTS ──
import Chance from "chance";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);
import { weighNumRange, integer, weighChoices } from "../../lib/utils/utils.js";
/** @typedef {import("../../types").Dungeon} Config */

// ── OVERVIEW ──
/*
 * NAME:       array-of-object-lookup
 * PURPOSE:    Exercises nested product arrays in events plus a lookup table
 *             keyed by product_id with rich attributes.
 * SCALE:      1,000 users, ~100K events, 60 days
 * EVENTS (4): checkout (cart array), add to cart, view item, save item (single item)
 * FUNNELS (0): none
 * LOOKUPS (1): product_id (1,000 entries; amount, quantity, featured, category, descriptor)
 */

// ── HOOK STORIES ──
/*
 * 1. COUPON DISCOUNT TAGGING (event hook)
 *    Checkout events with coupons get discount_applied: true and
 *    discount_percent extracted from the coupon string.
 *
 * 2. WEEKEND BROWSE vs WEEKDAY INTENT (event hook)
 *    Save item events on weekends tagged save_context: "weekend_browse",
 *    weekdays tagged "weekday_intent".
 *
 * 3. WINDOW SHOPPERS (everything hook)
 *    Users with 5+ view item events but 0 checkouts get all their
 *    events tagged user_segment: "window_shopper".
 */

// ── SCALE ──
const SEED = "dm4-array-of-object-lookup";
const NUM_DAYS = 60;
const NUM_USERS = 1_000;
const EVENTS_PER_DAY = 1.67;
const token = process.env.MP_TOKEN || "";

const chance = new Chance();

// ── DATA ARRAYS ──
const spiritAnimals = ["duck", "dog", "otter", "penguin", "cat", "elephant", "lion", "cheetah", "giraffe", "zebra", "rhino", "hippo", "whale", "dolphin", "shark", "octopus", "squid", "jellyfish", "starfish", "seahorse", "crab", "lobster", "shrimp", "clam", "snail", "slug", "butterfly", "moth", "bee", "wasp", "ant", "beetle", "ladybug", "caterpillar", "centipede", "millipede", "scorpion", "spider", "tarantula", "tick", "mite", "mosquito", "fly", "dragonfly", "damselfly", "grasshopper", "cricket", "locust", "mantis", "cockroach", "termite", "praying mantis", "walking stick", "stick bug", "leaf insect", "lacewing", "aphid", "cicada", "thrips", "psyllid", "scale insect", "whitefly", "mealybug", "planthopper", "leafhopper", "treehopper", "flea", "louse", "bedbug", "flea beetle", "weevil", "longhorn beetle", "leaf beetle", "tiger beetle", "ground beetle", "lady beetle", "firefly", "click beetle", "rove beetle", "scarab beetle", "dung beetle", "stag beetle", "rhinoceros beetle", "hercules beetle", "goliath beetle", "jewel beetle", "tortoise beetle"];

// ── HELPER FUNCTIONS ──
function makeProducts(maxItems = 5) {
	return function () {
		const categories = ["electronics", "books", "clothing", "home", "garden", "toys", "sports", "automotive", "beauty", "health", "grocery", "jewelry", "shoes", "tools", "office supplies"];
		const descriptors = ["brand new", "open box", "refurbished", "used", "like new", "vintage", "antique", "collectible"];
		const suffix = ["item", "product", "good", "merchandise", "thing", "object", "widget", "gadget", "device", "apparatus", "contraption", "instrument", "tool", "implement", "utensil", "appliance", "machine", "equipment", "gear", "kit", "set", "package"];
		const assetPreview = ['.png', '.jpg', '.jpeg', '.heic', '.mp4', '.mov', '.avi'];
		const data = [];
		const numOfItems = integer(1, maxItems);

		for (var i = 0; i < numOfItems; i++) {
			const category = chance.pickone(categories);
			const descriptor = chance.pickone(descriptors);
			const suffixWord = chance.pickone(suffix);
			const slug = `${descriptor.replace(/\s+/g, '-').toLowerCase()}-${suffixWord.replace(/\s+/g, '-').toLowerCase()}`;
			const asset = chance.pickone(assetPreview);

			const price = integer(1, 100);
			const quantity = integer(1, 5);
			const product_id = integer(1, 1_000);

			const item = {
				product_id: product_id,
				product_url: `https://example.com/assets/${product_id}`,
			};

			data.push(item);
		}

		return () => [data];
	};
}

function flip(likelihood = 50) {
	return chance.bool({ likelihood });
}

function handleEventHooks(record) {
	// Pattern 1: Checkouts with coupons get a discount_applied flag and adjusted total
	if (record.event === "checkout" && record.coupon && record.coupon !== "none") {
		record.discount_applied = true;
		const pctMatch = record.coupon.match(/(\d+)%/);
		if (pctMatch) {
			record.discount_percent = parseInt(pctMatch[1]);
		}
	}

	// Pattern 2: "save item" events on weekends are tagged as wishlist behavior
	if (record.event === "save item") {
		const dow = dayjs(record.time).day();
		if (dow === 0 || dow === 6) {
			record.save_context = "weekend_browse";
		} else {
			record.save_context = "weekday_intent";
		}
	}

	return record;
}

function handleEverythingHooks(record, meta) {
	const profile = meta.profile;
	record.forEach(e => {
		e.theme = profile.theme;
	});

	// Pattern 3: Users who view 5+ items but never checkout are tagged as window shoppers
	const views = record.filter(e => e.event === "view item").length;
	const checkouts = record.filter(e => e.event === "checkout").length;
	if (views >= 5 && checkouts === 0) {
		for (const e of record) {
			e.user_segment = "window_shopper";
		}
	}

	return record;
}

// ── CONFIG ──
/** @type {Config} */
const config = {
	token,
	seed: SEED,
	name: "array-of-object-lookup",
	numDays: NUM_DAYS,
	avgEventsPerUserPerDay: EVENTS_PER_DAY,
	numUsers: NUM_USERS,
	format: 'json',
	region: "US",
	hasAnonIds: true,
	hasSessionIds: true,
	hasAdSpend: false,
	hasLocation: true,
	hasAndroidDevices: false,
	hasIOSDevices: false,
	hasDesktopDevices: true,
	hasBrowser: true,
	hasCampaigns: false,
	isAnonymous: false,
	alsoInferFunnels: true,
	concurrency: 1,
	writeToDisk: false,
	events: [
		{
			event: "checkout",
			weight: 2,
			properties: {
				currency: ["USD", "CAD", "EUR", "BTC", "ETH", "JPY"],
				coupon: weighChoices(["none", "none", "none", "none", "10%OFF", "20%OFF", "10%OFF", "20%OFF", "30%OFF", "40%OFF", "50%OFF"]),
				cart: makeProducts(),
				discount_applied: [false],
				discount_percent: [0],
				user_segment: ["regular"],
			}
		},
		{
			event: "add to cart",
			weight: 4,
			properties: {
				item: makeProducts(1),
				user_segment: ["regular"],
			}
		},
		{
			event: "view item",
			weight: 8,
			properties: {
				item: makeProducts(1),
				user_segment: ["regular"],
			}
		},
		{
			event: "save item",
			weight: 5,
			properties: {
				item: makeProducts(1),
				save_context: ["weekday_intent"],
				user_segment: ["regular"],
			}
		}
	],
	funnels: [],
	superProps: {
		theme: ["light", "dark", "custom", "light", "dark"],
	},
	userProps: {
		theme: ["light", "dark", "custom", "light", "dark"],
		spiritAnimal: spiritAnimals
	},
	scdProps: {},
	mirrorProps: {},
	groupKeys: [],
	groupProps: {},
	lookupTables: [{
		key: "product_id",
		entries: 1000,
		attributes: {
			amount: weighNumRange(1, 1000, .3),
			quantity: weighNumRange(1, 10, .3),
			featured: flip,
			category: ["electronics", "books", "clothing", "home", "garden", "toys", "sports", "automotive", "beauty", "health", "grocery", "jewelry", "shoes", "tools", "office supplies"],
			descriptor: ["brand new", "open box", "refurbished", "used", "like new", "vintage", "antique", "collectible"]
		}
	}],
	hook: function (record, type, meta) {
		if (type === "event") return handleEventHooks(record);
		if (type === "everything") return handleEverythingHooks(record, meta);
		return record;
	}
};

export default config;
