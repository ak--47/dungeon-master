// ── TWEAK THESE ──
const SEED = "simple is best";
const num_days = 108;
const num_users = 42_000;
const avg_events_per_user_per_day = 0.37;
let token = "your-mixpanel-token";

// ── env overrides ──
if (process.env.MP_TOKEN) token = process.env.MP_TOKEN;

import Chance from 'chance';
let chance = new Chance();
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);
import { uid, comma } from 'ak-tools';
import { weighNumRange, date, integer, weighChoices, decimal } from "../../lib/utils/utils.js";

/** @typedef {import("../../types").Dungeon} Config */
const itemCategories = ["Books", "Movies", "Music", "Games", "Electronics", "Computers", "Smart Home", "Home", "Garden", "Pet", "Beauty", "Health", "Toys", "Kids", "Baby", "Handmade", "Sports", "Outdoors", "Automotive", "Industrial", "Entertainment", "Art", "Food", "Appliances", "Office", "Wedding", "Software"];
const videoCategories = ["funny", "educational", "inspirational", "music", "news", "sports", "cooking", "DIY", "travel", "gaming"];
const spiritAnimals = ["duck", "dog", "otter", "penguin", "cat", "elephant", "lion", "cheetah", "giraffe", "zebra", "rhino", "hippo", "whale", "dolphin", "shark", "octopus", "squid", "jellyfish", "starfish", "seahorse", "crab", "lobster", "shrimp", "clam", "snail", "slug", "butterfly", "moth", "bee", "wasp", "ant", "beetle", "ladybug", "caterpillar", "centipede", "millipede", "scorpion", "spider", "tarantula", "tick", "mite", "mosquito", "fly", "dragonfly", "damselfly", "grasshopper", "cricket", "locust", "mantis", "cockroach", "termite", "praying mantis", "walking stick", "stick bug", "leaf insect", "lacewing", "aphid", "cicada", "thrips", "psyllid", "scale insect", "whitefly", "mealybug", "planthopper", "leafhopper", "treehopper", "flea", "louse", "bedbug", "flea beetle", "weevil", "longhorn beetle", "leaf beetle", "tiger beetle", "ground beetle", "lady beetle", "firefly", "click beetle", "rove beetle", "scarab beetle", "dung beetle", "stag beetle", "rhinoceros beetle", "hercules beetle", "goliath beetle", "jewel beetle", "tortoise beetle"];

/*
 * ============================================================================
 * DATASET OVERVIEW
 * ============================================================================
 *
 * App: eCommerce marketplace with integrated video content
 * Scale: 50K users, 2M events, 108 days
 *
 * Core loop: Users browse products, watch videos, build carts, and check out.
 * A signup funnel converts browsers into registered users. Video engagement
 * (likes/dislikes) runs alongside the shopping flow.
 *
 * Events:
 *   page view (10) > view item (8) > watch video (8) > like video (6)
 *   > save item (5) > add to cart (4) > dislike video (4) > checkout (2) > sign up (1)
 *
 * Funnels:
 *   - Signup Flow: page view → view item → save item → page view → sign up (50%)
 *   - Video Likes: watch → like → watch → like (60%)
 *   - Video Dislikes: watch → dislike → watch → dislike (20%)
 *   - eCommerce Purchase: view → view → add to cart → view → add to cart → checkout (15%)
 *
 * User props: title, luckyNumber, spiritAnimal
 * Super props: theme (light/dark/custom)
 * ============================================================================
 */

/*
 * ============================================================================
 * ANALYTICS HOOKS (7 hooks)
 *
 * Adds 7. SIGNUP FLOW TIME-TO-CONVERT: gold/platinum loyalty 0.71x faster,
 * bronze 1.3x slower (funnel-post). Discover via funnel median time-to-convert
 * by loyalty_tier breakdown.
 * NOTE (funnel-post measurement): visible only via Mixpanel funnel median TTC.
 * Cross-event MIN→MIN SQL queries on raw events do NOT show this.
 * ============================================================================
 *
 * ----------------------------------------------------------------------------
 * Hook 1: Signup Flow Improvement (event + everything)
 * ----------------------------------------------------------------------------
 *
 * PATTERN: 7 days ago, signup_flow switches from "v1" to "v2". Before
 * that date, 50% of sign ups are tagged _drop and removed in the
 * everything hook, simulating a broken flow that got fixed.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Sign Ups by Flow Version
 *   - Report type: Insights
 *   - Event: "sign up"
 *   - Measure: Total
 *   - Breakdown: "signup_flow"
 *   - Line chart by day
 *   - Expected: v1 disappears at day -7; v2 takes over and roughly 2x daily volume
 *
 *   Report 2: Pre vs Post Volume
 *   - Report type: Insights
 *   - Event: "sign up"
 *   - Measure: Total
 *   - Compare date ranges (last 7 days vs prior 7 days)
 *   - Expected: ~ 2x signups in the post-fix window
 *
 * REAL-WORLD ANALOGUE: A broken signup flow silently halved conversions
 * until a release shipped a fix; daily signups roughly doubled overnight.
 *
 * ----------------------------------------------------------------------------
 * Hook 2: Watch Time Inflection (event)
 * ----------------------------------------------------------------------------
 *
 * PATTERN: 30 days ago, watch time shifts. Before that date, watchTimeSec
 * is reduced by 25-79%. After, it is increased by 25-79%. Creates a
 * clear before/after inflection.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Avg Watch Time Over Time
 *   - Report type: Insights
 *   - Event: "watch video"
 *   - Measure: Average of "watchTimeSec"
 *   - Line chart by day
 *   - Expected: clear upward inflection ~ 30 days ago; watch time ~ doubles
 *
 *   Report 2: Watch Time Distribution Pre vs Post
 *   - Report type: Insights
 *   - Event: "watch video"
 *   - Measure: Average of "watchTimeSec"
 *   - Compare date ranges (last 30 days vs prior 30 days)
 *   - Expected: post-inflection ~ 2x avg watch time
 *
 * REAL-WORLD ANALOGUE: An algorithm or UX change (autoplay, recs)
 * inflects average watch duration sharply on a release date.
 *
 * ----------------------------------------------------------------------------
 * Hook 3: Toys + Shoes Cart Correlation (event)
 * ----------------------------------------------------------------------------
 *
 * PATTERN: Checkout carts with toys get a shoes item injected (and vice
 * versa). Carts with neither toys nor shoes have all item prices
 * discounted to 75-90% of normal.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Cart Category Co-occurrence
 *   - Report type: Insights
 *   - Event: "checkout"
 *   - Measure: Total
 *   - Breakdown: "category" (flattened item category)
 *   - Expected: toys and shoes appear at high co-occurrence rate
 *
 *   Report 2: Cart Value by Category Mix
 *   - Report type: Insights
 *   - Event: "checkout"
 *   - Measure: Average of "amount"
 *   - Breakdown: "category"
 *   - Expected: carts lacking both toys and shoes have lower avg amount
 *
 * REAL-WORLD ANALOGUE: Family shoppers buying for kids tend to bundle
 * toys with shoes; a market-basket pattern that retailers exploit.
 *
 * ----------------------------------------------------------------------------
 * Hook 4: Quality to Watch Time Correlation (event)
 * ----------------------------------------------------------------------------
 *
 * PATTERN: Video quality multiplies watchTimeSec: 2160p=1.5x, 1440p=1.4x,
 * 1080p=1.3x, 720p=1.15x, 480p=1.0x, 360p=0.85x, 240p=0.7x.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Avg Watch Time by Quality
 *   - Report type: Insights
 *   - Event: "watch video"
 *   - Measure: Average of "watchTimeSec"
 *   - Breakdown: "quality"
 *   - Expected: monotonic increase from 240p to 2160p
 *
 *   Report 2: Quality Distribution
 *   - Report type: Insights
 *   - Event: "watch video"
 *   - Measure: Total
 *   - Breakdown: "quality"
 *   - Expected: viewers split across all quality tiers; HD tiers earn more time
 *
 * REAL-WORLD ANALOGUE: Higher-resolution streams correlate with longer
 * sessions because they signal a better connection and more invested viewer.
 *
 * ----------------------------------------------------------------------------
 * Hook 5: Item Flattening (event)
 * ----------------------------------------------------------------------------
 *
 * PATTERN: Events with an item array property get the first item's
 * fields (category, amount, slug, etc.) flattened onto the event record
 * as top-level properties — making them available for direct breakdown
 * in reports.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: View Items by Category
 *   - Report type: Insights
 *   - Event: "view item"
 *   - Measure: Total
 *   - Breakdown: "category"
 *   - Expected: clean breakdown across category values without nested-property issues
 *
 *   Report 2: Add to Cart Avg Amount by Category
 *   - Report type: Insights
 *   - Event: "add to cart"
 *   - Measure: Average of "amount"
 *   - Breakdown: "category"
 *   - Expected: per-category averages render correctly off flat properties
 *
 * REAL-WORLD ANALOGUE: Analytics teams routinely flatten nested cart
 * objects onto events so downstream tools can group/filter without joins.
 *
 * ----------------------------------------------------------------------------
 * Hook 6: View-Item Magic Number (everything)
 * ----------------------------------------------------------------------------
 *
 * PATTERN: Users who view 3-8 items in the dataset window are in the
 * "considered buyer" sweet spot — every cart item amount and total_value
 * gets boosted ~25%. Users who view 9 or more items are over-engaged
 * window-shoppers; ~30% of their checkout events are dropped (decision
 * paralysis / browse without buy). No flag is stamped — discoverable
 * only by binning users on view-item COUNT and comparing avg cart total.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Avg Cart Total by View-Item Bucket
 *   - Report type: Insights (with cohort)
 *   - Cohort A: users with 3-8 "view item" events
 *   - Cohort B: users with 0-2 "view item" events
 *   - Event: "checkout"
 *   - Measure: Average of "amount" (sum across cart items if exposed)
 *   - Compare cohort A vs cohort B
 *   - Expected: cohort A ~ 1.25x higher cart total than B
 *
 *   Report 2: Checkouts per User by Browse Intensity
 *   - Report type: Insights (with cohort)
 *   - Cohort C: users with >= 9 "view item" events
 *   - Cohort A: users with 3-8 "view item" events
 *   - Event: "checkout"
 *   - Measure: Total events per user
 *   - Compare cohort C vs cohort A
 *   - Expected: cohort C has ~ 30% fewer checkouts per user
 *
 * REAL-WORLD ANALOGUE: A focused buyer who reviews a handful of items
 * tends to convert at higher cart value; an excessive browser is a
 * tire-kicker who abandons more often.
 *
 * ============================================================================
 * EXPECTED METRICS SUMMARY
 * ============================================================================
 *
 * Hook                       | Metric                  | Baseline   | Hook Effect | Ratio
 * ---------------------------|-------------------------|------------|-------------|------
 * Signup Flow Improvement    | Daily sign ups          | 1x         | ~ 2x        | 2x
 * Watch Time Inflection      | Avg watchTimeSec        | 1x         | ~ 2x        | 2x
 * Toys + Shoes Correlation   | toys/shoes co-occurrence| ~ 7%       | ~ 50%+      | ~ 7x
 * Quality -> Watch Time      | Avg watchTimeSec (240p->2160p) | 0.7x | 1.5x       | ~ 2.1x
 * Item Flattening            | category breakdown      | nested     | flat        | n/a
 * View-Item Magic Number     | sweet (3-8) cart total  | 1x         | ~ 1.25x     | 1.25x
 * View-Item Magic Number     | over (9+) checkouts/user| 1x         | ~ 0.7x      | -30%
 * ============================================================================
 */


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

			// const product_id = chance.guid();
			const price = integer(1, 100);
			const quantity = integer(1, 5);

			const item = {
				// product_id: product_id,
				// sku: integer(11111, 99999),
				amount: price,
				quantity: quantity,
				total_value: price * quantity,
				featured: chance.pickone([true, false, false]),
				category: category,
				descriptor: descriptor,
				slug: slug,
				assetPreview: `https://example.com/assets/${slug}${asset}`,
				assetType: asset

			};

			data.push(item);
		}

		return () => [data];
	};
};


/** @type {import('../types.d.ts').Dungeon} */
const config = {
	token,
	seed: SEED,
	datasetStart: "2026-01-01T00:00:00Z",
	datasetEnd: "2026-04-28T23:59:59Z",
	// numDays: num_days,
	avgEventsPerUserPerDay: avg_events_per_user_per_day,
	numUsers: num_users,
	format: 'json', //csv or json
	region: "US",
	hasAnonIds: false, //if true, anonymousIds are created for each user
	hasSessionIds: false, //if true, hasSessionIds are created for each user
	hasAdSpend: false,
	hasLocation: true,
	hasAndroidDevices: true,
	hasIOSDevices: true,
	hasDesktopDevices: true,
	hasBrowser: true,
	hasCampaigns: false,
	isAnonymous: false,
	alsoInferFunnels: false,
	concurrency: 1,
	events: [
		{
			event: "checkout",
			weight: 2,
			properties: {
				currency: ["USD", "CAD", "EUR", "BTC", "ETH", "JPY"],
				coupon: weighChoices(["none", "none", "none", "none", "10%OFF", "20%OFF", "10%OFF", "20%OFF", "30%OFF", "40%OFF", "50%OFF"]),
				cart: makeProducts(),
			}
		},
		{
			event: "add to cart",
			weight: 4,
			properties: {
				item: makeProducts(1),
				amount: weighNumRange(1, 100, 0.3),
				quantity: weighNumRange(1, 5, 0.3),
				total_value: weighNumRange(1, 500, 0.3),
				featured: [true, false, false],
				category: ["electronics", "books", "clothing", "home", "garden", "toys", "sports", "automotive", "beauty", "health", "grocery", "jewelry", "shoes", "tools", "office supplies"],
				descriptor: ["brand new", "open box", "refurbished", "used", "like new", "vintage", "antique", "collectible"],
				slug: ["item"],
				assetPreview: ["https://example.com/assets/item.png"],
				assetType: [".png", ".jpg", ".jpeg", ".heic", ".mp4", ".mov", ".avi"],
			}
		},
		{
			event: "view item",
			weight: 8,
			properties: {
				item: makeProducts(1),
				amount: weighNumRange(1, 100, 0.3),
				quantity: weighNumRange(1, 5, 0.3),
				total_value: weighNumRange(1, 500, 0.3),
				featured: [true, false, false],
				category: ["electronics", "books", "clothing", "home", "garden", "toys", "sports", "automotive", "beauty", "health", "grocery", "jewelry", "shoes", "tools", "office supplies"],
				descriptor: ["brand new", "open box", "refurbished", "used", "like new", "vintage", "antique", "collectible"],
				slug: ["item"],
				assetPreview: ["https://example.com/assets/item.png"],
				assetType: [".png", ".jpg", ".jpeg", ".heic", ".mp4", ".mov", ".avi"],
			}
		},
		{
			event: "save item",
			weight: 5,
			properties: {
				item: makeProducts(1),
				amount: weighNumRange(1, 100, 0.3),
				quantity: weighNumRange(1, 5, 0.3),
				total_value: weighNumRange(1, 500, 0.3),
				featured: [true, false, false],
				category: ["electronics", "books", "clothing", "home", "garden", "toys", "sports", "automotive", "beauty", "health", "grocery", "jewelry", "shoes", "tools", "office supplies"],
				descriptor: ["brand new", "open box", "refurbished", "used", "like new", "vintage", "antique", "collectible"],
				slug: ["item"],
				assetPreview: ["https://example.com/assets/item.png"],
				assetType: [".png", ".jpg", ".jpeg", ".heic", ".mp4", ".mov", ".avi"],
			}
		},
		{
			event: "page view",
			weight: 10,
			properties: {
				page: ["/", "/help", "/account", "/watch", "/listen", "/product", "/people", "/peace"],
			}
		},
		{
			event: "watch video",
			weight: 8,
			properties: {
				watchTimeSec: weighNumRange(10, 600, .25),
				quality: ["2160p", "1440p", "1080p", "720p", "480p", "360p", "240p"],
				format: ["mp4", "avi", "mov", "mpg"],
				uploader_id: chance.guid.bind(chance),
			}
		},
		{
			event: "like video",
			weight: 6,
			properties: {

			}
		},
		{
			event: "dislike video",
			weight: 4,
			properties: {

			}
		},
		{
			event: "sign up",
			weight: 1,
			isFirstEvent: true,
			properties: {
				signupMethod: ["email", "google", "facebook", "twitter", "linkedin", "github"],
				referral: weighChoices(["none", "none", "none", "friend", "ad", "ad", "ad", "friend", "friend", "friend", "friend"]),
				signup_flow: ["v1"],
			}
		},

	],
	funnels: [
		{
			sequence: ["page view", "view item", "save item", "page view", "sign up"],
			conversionRate: 50,
			order: "first-and-last-fixed",
			weight: 1,
			isFirstFunnel: true,
			timeToConvert: 2,
			experiment: false,
			name: "Signup Flow"

		},
		{
			sequence: ["watch video", "like video", "watch video", "like video"],
			name: "Video Likes",
			conversionRate: 60,
			props: {
				videoCategory: videoCategories,
				quality: ["2160p", "1440p", "1080p", "720p", "480p", "360p", "240p"],
				format: ["mp4", "avi", "mov", "mpg"],
				uploader_id: chance.guid.bind(chance)
			}
		},
		{
			name: "Video Dislikes",
			sequence: ["watch video", "dislike video", "watch video", "dislike video"],
			conversionRate: 20,
			props: {
				videoCategory: videoCategories,
				quality: ["2160p", "1440p", "1080p", "720p", "480p", "360p", "240p"],
				format: ["mp4", "avi", "mov", "mpg"],
				uploader_id: chance.guid.bind(chance)
			}
		},
		{
			name: "eCommerce Purchase",
			sequence: ["view item", "view item", "add to cart", "view item", "add to cart", "checkout"],
			conversionRate: 15,
			requireRepeats: true,
			weight: 10,
			order: "last-fixed",
		}

	],
	superProps: {
		theme: ["light", "dark", "custom", "light", "dark"],
	},
	/*
	user properties work the same as event properties
	each key should be an array or function reference
	*/
	userProps: {
		title: chance.profession.bind(chance),
		luckyNumber: weighNumRange(42, 420, .3),
		spiritAnimal: spiritAnimals,
		theme: ["light", "dark", "custom", "light", "dark"],
	},
	scdProps: {
		loyalty_tier: {
			values: ["bronze", "silver", "gold", "platinum"],
			frequency: "month",
			timing: "fuzzy",
			max: 8
		}
	},
	mirrorProps: {},

	/*
	for group analytics keys, we need an array of arrays [[],[],[]]
	each pair represents a group_key and the number of profiles for that key
	*/
	groupKeys: [],
	groupProps: {},
	lookupTables: [],
	hook: function (record, type, meta) {

		// Hook 7 (T2C): SIGNUP FLOW TIME-TO-CONVERT (funnel-post)
		// Gold/platinum loyalty tier users complete the Signup Flow funnel
		// 1.4x faster (factor 0.71); bronze users 1.3x slower (factor 1.3).
		if (type === "funnel-post") {
			const segment = meta?.profile?.loyalty_tier;
			if (Array.isArray(record) && record.length > 1) {
				const factor = (
					segment === "gold" || segment === "platinum" ? 0.71 :
					segment === "bronze" ? 1.3 :
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

		if (type === "event") {
			const datasetEnd = dayjs.unix(meta.datasetEnd);
			const DAY_SIGNUPS_IMPROVED = datasetEnd.subtract(7, 'day');
			const DAY_WATCH_TIME_WENT_UP = datasetEnd.subtract(30, 'day');
			const eventTime = dayjs(record.time);

			// unflattering 'items'
			if (record.item && Array.isArray(record.item)) {
				record = { ...record, ...record.item[0] };
				delete record.item;
			}

			if (record.event === 'sign up') {
				record.signup_flow = "v1";
				if (eventTime.isBefore(DAY_SIGNUPS_IMPROVED)) {
					// tag 50% for removal (filtered in "everything" hook)
					if (chance.bool({ likelihood: 50 })) {
						record._drop = true;
					}
				}
				if (eventTime.isAfter(DAY_SIGNUPS_IMPROVED)) {
					record.signup_flow = "v2";
				}
			}

			if (record.event === 'watch video') {
				const factor = decimal(0.25, 0.79);
				if (eventTime.isBefore(DAY_WATCH_TIME_WENT_UP)) {
					record.watchTimeSec = Math.round(record.watchTimeSec * (1 - factor));
				}
				if (eventTime.isAfter(DAY_WATCH_TIME_WENT_UP)) {
					// increase watch time by 33%
					record.watchTimeSec = Math.round(record.watchTimeSec * (1 + factor));
				}

			}

			// toys + shoes frequently purchases together (and are higher cart values)
			if (record.event === 'checkout' && Array.isArray(record.cart)) {
				const hasToys = record.cart.some(item => item.category === 'toys');
				const hasShoes = record.cart.some(item => item.category === 'shoes');
				if (hasToys && !hasShoes) {
					const bigCart = makeProducts(20)()()[0];
					const shoeItems = bigCart.filter(item => item.category === 'shoes');
					if (shoeItems.length > 0) {
						record.cart.push(shoeItems[0]);
					}
				}

				if (hasShoes && !hasToys) {
					const bigCart = makeProducts(20)()()[0];
					const toyItems = bigCart.filter(item => item.category === 'toys');
					if (toyItems.length > 0) {
						record.cart.push(toyItems[0]);
					}
				}

				if (!hasToys && !hasShoes) {
					const cheapFactor = decimal(.75, 0.9);
					// make every item a bit cheaper
					record.cart = record.cart.map(item => {
						return {
							...item,
							amount: Math.round(item.amount * cheapFactor),
							total_value: Math.round(item.total_value * cheapFactor)
						};
					});
				}
			}
			// high quality video means longer watch times (lower quality shorter watch times)
			if (record.event === 'watch video') {
				const qualityFactors = {
					"2160p": 1.5,
					"1440p": 1.4,
					"1080p": 1.3,
					"720p": 1.15,
					"480p": 1.0,
					"360p": 0.85,
					"240p": 0.7
				};
				const quality = record.quality || "480p";
				const factor = qualityFactors[quality] || 1.0;
				record.watchTimeSec = Math.round(record.watchTimeSec * factor);
			}



		}



		if (type === "everything") {
			// Stamp superProps from profile for consistency
			const profile = meta.profile;
			record.forEach(e => {
				e.theme = profile.theme;
			});

			// Hook 6: View-Item Magic Number (behavioral, no flags)
			// Users in 3-8 view-item sweet spot show ~25% higher cart amounts.
			// Users >=9 are over-engaged window-shoppers; ~30% of their checkouts drop.
			const viewItemCount = record.filter(e => e.event === 'view item').length;
			if (viewItemCount >= 3 && viewItemCount <= 8) {
				record.forEach(e => {
					if (e.event === 'checkout' && Array.isArray(e.cart)) {
						e.cart = e.cart.map(it => ({
							...it,
							amount: typeof it.amount === 'number' ? Math.round(it.amount * 1.25) : it.amount,
							total_value: typeof it.total_value === 'number' ? Math.round(it.total_value * 1.25) : it.total_value
						}));
					}
				});
			} else if (viewItemCount >= 9) {
				for (let i = record.length - 1; i >= 0; i--) {
					if (record[i].event === 'checkout' && chance.bool({ likelihood: 30 })) {
						record.splice(i, 1);
					}
				}
			}

		}

		// Filter out events tagged for removal in the event hook
		if (type === "everything") {
			record = record.filter(e => !e._drop);
		}

		return record;
	}
};

function flip(likelihood = 50) {
	return chance.bool({ likelihood });
}


export default config;
