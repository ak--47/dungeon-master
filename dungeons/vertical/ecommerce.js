// ── IMPORTS ──
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);
import { uid } from "ak-tools";
import { weighNumRange, integer, weighChoices, decimal, initChance } from "../../lib/utils/utils.js";
import { scaleFunnelTTC } from "../../lib/hook-helpers/timing.js";
/** @typedef {import("../../types").Dungeon} Config */

// ── OVERVIEW ──
/*
 * APP:        eCommerce marketplace with integrated video content
 * SCALE:      42,000 users, ~2M events, 121 days (2026-01-01 → 2026-05-01)
 * CORE LOOP:  page view → view item → save/add to cart → checkout (+ video like/dislike side loop)
 *
 * EVENTS (9):
 *   page view (10) > view item (8) > watch video (8) > like video (6) > save item (5)
 *   > add to cart (4) > dislike video (4) > checkout (2) > sign up (1)
 *
 * FUNNELS (4):
 *   - Signup Flow:        page view → view item → save item → page view → sign up (50%)
 *   - Video Likes:        watch video → like video → watch video → like video (60%)
 *   - Video Dislikes:     watch video → dislike video → watch video → dislike video (20%)
 *   - eCommerce Purchase: view item → view item → add to cart → view item → add to cart → checkout (15%, A/B/C experiment)
 *
 * USER PROPS:  title, luckyNumber, spiritAnimal, theme
 * SUPER PROPS: theme
 * SCD PROPS:   loyalty_tier (bronze/silver/gold/platinum, monthly fuzzy, max 8)
 * GROUPS:      none
 */

// ── HOOK STORIES ──
/*
 * ============================================================================
 * ANALYTICS HOOKS (10 hooks)
 *
 * Adds 7. SIGNUP FLOW TIME-TO-CONVERT: gold/platinum loyalty 0.67x faster,
 * bronze 1.33x slower (everything hook via scaleFunnelTTC on the page-view-
 * to-sign-up window). Loyalty tier is determined from SCD data
 * (meta.scd.loyalty_tier) with deterministic hash fallback. Discover via
 * bound-sequence funnel TTC breakdown by loyalty tier.
 *
 * Adds 8. CHECKOUT FLOW EXPERIMENT: A/B/C experiment on the eCommerce
 * Purchase funnel — "Control", "Express Checkout" (1.25x conversion),
 * "Social Proof" (1.15x conversion, 0.9x TTC). Engine-managed via funnel
 * experiment config; starts 30 days before dataset end.
 *
 * Adds 9. DARK THEME POWER USERS: funnel-pre hook that boosts purchase
 * funnel conversion 1.3x for dark-theme users and penalizes light-theme
 * users to 0.85x. Discoverable by breakdown of funnel conversion by theme.
 *
 * Adds 10. SAVE-ITEM RETENTION: born-in-dataset users who save 2+ items
 * in their first 10 days retain long-term; those below threshold lose ~70%
 * of post-day-25 events. Discoverable by retention or frequency analysis
 * segmented by early save-item count.
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
 * gets boosted ~25%, AND ~45% of their add-to-cart events are cloned
 * (with time offsets) to elevate their cart add rate. Users who view
 * 9 or more items are over-engaged window-shoppers; ~30% of their
 * checkout events are dropped (decision paralysis / browse without buy).
 * No flag is stamped — discoverable only by binning users on view-item
 * COUNT and comparing avg cart total or add-to-cart rate.
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
 * ----------------------------------------------------------------------------
 * Hook 7: Signup Flow Time-to-Convert (everything)
 * ----------------------------------------------------------------------------
 *
 * PATTERN: The Signup Flow funnel (page view → view item → save item →
 * page view → sign up) has its time-to-convert scaled by the user's
 * loyalty tier from SCD data (meta.scd.loyalty_tier). Gold and platinum
 * users complete the funnel 0.67x faster; bronze users take 1.33x longer;
 * silver is unaffected. The hook reads the latest SCD entry for
 * loyalty_tier, falling back to a deterministic hash of user_id for
 * consistent tier assignment. It anchors on the first "sign up" event,
 * looks back up to 2 days for all funnel-step events in that window,
 * and scales the whole cluster via scaleFunnelTTC.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Signup Funnel TTC by Loyalty Tier
 *   - Report type: Funnels
 *   - Steps: "page view" → "view item" → "save item" → "page view" → "sign up"
 *   - Measure: Median time to convert
 *   - Breakdown: "loyalty_tier" (SCD property)
 *   - Expected: gold/platinum ~ 0.67x median TTC vs silver; bronze ~ 1.33x
 *
 *   Report 2: Signup Funnel Conversion by Loyalty Tier
 *   - Report type: Funnels
 *   - Steps: same as above
 *   - Breakdown: "loyalty_tier"
 *   - Expected: conversion rate similar across tiers (TTC changes, not conversion)
 *
 * REAL-WORLD ANALOGUE: Loyal, high-tier customers already trust the
 * platform and breeze through signup flows, while new or low-engagement
 * users deliberate longer before committing.
 *
 * ----------------------------------------------------------------------------
 * Hook 8: Checkout Flow Experiment (funnel experiment config)
 * ----------------------------------------------------------------------------
 *
 * PATTERN: A/B/C experiment on the eCommerce Purchase funnel. Control
 * group uses base conversion, "Express Checkout" variant gets 1.25x
 * conversion multiplier, "Social Proof" gets 1.15x conversion and 0.9x
 * time-to-convert. Starts 30 days before dataset end.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Experiment Events by Variant
 *   - Report type: Insights
 *   - Event: "$experiment_started"
 *   - Measure: Total
 *   - Breakdown: "$experiment_variant"
 *   - Expected: roughly equal distribution across Control, Express Checkout, Social Proof
 *
 *   Report 2: Purchase Funnel Conversion by Variant
 *   - Report type: Funnels
 *   - Funnel: view item → add to cart → checkout
 *   - Breakdown: "$experiment_variant"
 *   - Expected: Express Checkout > Social Proof > Control conversion rate
 *
 * REAL-WORLD ANALOGUE: Product team tests a streamlined checkout and a
 * social proof variant against the existing flow to lift conversion.
 *
 * ----------------------------------------------------------------------------
 * Hook 9: Dark Theme Power Users (funnel-pre)
 * ----------------------------------------------------------------------------
 *
 * PATTERN: Dark-theme users convert 1.3x better on the purchase funnel;
 * light-theme users convert at 0.85x. Custom theme is unaffected.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Purchase Funnel by Theme
 *   - Report type: Funnels
 *   - Funnel: view item → add to cart → checkout
 *   - Breakdown: "theme"
 *   - Expected: dark > custom > light conversion rate
 *
 *   Report 2: Checkout Count by Theme
 *   - Report type: Insights
 *   - Event: "checkout"
 *   - Measure: Total
 *   - Breakdown: "theme"
 *   - Expected: dark-theme users over-index on checkout counts
 *
 * REAL-WORLD ANALOGUE: Power users who customize their UI (dark mode)
 * tend to be more committed and convert at higher rates.
 *
 * ----------------------------------------------------------------------------
 * Hook 10: Save-Item Retention (everything — retention magic number)
 * ----------------------------------------------------------------------------
 *
 * PATTERN: Born-in-dataset users who perform 2+ "save item" events in
 * their first 10 days retain long-term. Users below that threshold lose
 * ~70% of events after day 25, simulating churn. No flag is stamped —
 * discoverable only by segmenting users on early save-item count and
 * comparing retention or late-period activity.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Retention by Early Save Count
 *   - Report type: Retention
 *   - First event: any event
 *   - Return event: any event
 *   - Cohort A: users with >= 2 "save item" in first 10 days
 *   - Cohort B: users with < 2 "save item" in first 10 days
 *   - Expected: Cohort A retains at 4+ weeks; Cohort B drops sharply after week 3
 *
 *   Report 2: Post-Day-25 Activity
 *   - Report type: Insights
 *   - Event: any event
 *   - Filter: time > first_event + 25 days
 *   - Cohort A: >= 2 early saves; Cohort B: < 2 early saves
 *   - Expected: Cohort B has ~70% fewer events in the late window
 *
 * REAL-WORLD ANALOGUE: Saving items signals purchase intent and product
 * engagement; users who curate a wishlist early are more likely to return.
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
 * View-Item Magic Number     | sweet (3-8) cart rate   | 1x         | ~ 1.45x     | 1.45x
 * View-Item Magic Number     | over (9+) checkouts/user| 1x         | ~ 0.7x      | -30%
 * Signup TTC by Loyalty      | gold/plat median TTC    | 1x         | ~ 0.67x     | -33%
 * Signup TTC by Loyalty      | bronze median TTC       | 1x         | ~ 1.33x     | +33%
 * Checkout Experiment         | Express Checkout conv   | 1x         | ~ 1.25x     | +25%
 * Checkout Experiment         | Social Proof conv       | 1x         | ~ 1.15x     | +15%
 * Checkout Experiment         | Social Proof TTC        | 1x         | ~ 0.9x      | -10%
 * Dark Theme Power Users      | dark-theme conv rate    | 1x         | ~ 1.3x      | +30%
 * Dark Theme Power Users      | light-theme conv rate   | 1x         | ~ 0.85x     | -15%
 * Save-Item Retention         | post-d25 events (saver) | 1x         | ~ 1x        | baseline
 * Save-Item Retention         | post-d25 events (non-s) | 1x         | ~ 0.3x      | -70%
 * ============================================================================
 */

// ── SCALE ──
const SEED = "simple is best";
const NUM_USERS = 42_000;
const DATASET_START = "2026-01-01T00:00:00Z";
const DATASET_END = "2026-05-01T23:59:59Z";
const EVENTS_PER_DAY = 0.37;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = initChance(SEED);

// ── KNOBS (tweak these to reshape stories) ──
const SIGNUP_FIX_DAYS_AGO = 7;
const WATCH_INFLECTION_DAYS_AGO = 30;
const WATCH_FACTOR_MIN = 0.25;
const WATCH_FACTOR_MAX = 0.79;
const VIEW_SWEET_MIN = 3;
const VIEW_SWEET_MAX = 8;
const VIEW_OVER_THRESHOLD = 9;
const SWEET_CART_BOOST = 1.25;
const SWEET_CLONE_LIKELIHOOD = 45;
const OVER_CHECKOUT_DROP_LIKELIHOOD = 30;
const LOYALTY_TTC_FAST = 0.67;
const LOYALTY_TTC_SLOW = 1.33;
const LOYALTY_LOOKBACK_DAYS = 2;
const SAVE_RETENTION_MIN = 2;
const SAVE_RETENTION_WINDOW_DAYS = 10;
const SAVE_RETENTION_CUTOFF_DAYS = 25;
const SAVE_RETENTION_DROP_LIKELIHOOD = 70;
const QUALITY_FACTORS = {
	"2160p": 1.5,
	"1440p": 1.4,
	"1080p": 1.3,
	"720p": 1.15,
	"480p": 1.0,
	"360p": 0.85,
	"240p": 0.7,
};

// ── DATA ARRAYS ──
const videoCategories = ["funny", "educational", "inspirational", "music", "news", "sports", "cooking", "DIY", "travel", "gaming"];
const spiritAnimals = ["duck", "dog", "otter", "penguin", "cat", "elephant", "lion", "cheetah", "giraffe", "zebra", "rhino", "hippo", "whale", "dolphin", "shark", "octopus", "squid", "jellyfish", "starfish", "seahorse", "crab", "lobster", "shrimp", "clam", "snail", "slug", "butterfly", "moth", "bee", "wasp", "ant", "beetle", "ladybug", "caterpillar", "centipede", "millipede", "scorpion", "spider", "tarantula", "tick", "mite", "mosquito", "fly", "dragonfly", "damselfly", "grasshopper", "cricket", "locust", "mantis", "cockroach", "termite", "praying mantis", "walking stick", "stick bug", "leaf insect", "lacewing", "aphid", "cicada", "thrips", "psyllid", "scale insect", "whitefly", "mealybug", "planthopper", "leafhopper", "treehopper", "flea", "louse", "bedbug", "flea beetle", "weevil", "longhorn beetle", "leaf beetle", "tiger beetle", "ground beetle", "lady beetle", "firefly", "click beetle", "rove beetle", "scarab beetle", "dung beetle", "stag beetle", "rhinoceros beetle", "hercules beetle", "goliath beetle", "jewel beetle", "tortoise beetle"];
const productCategories = ["electronics", "books", "clothing", "home", "garden", "toys", "sports", "automotive", "beauty", "health", "grocery", "jewelry", "shoes", "tools", "office supplies"];
const productDescriptors = ["brand new", "open box", "refurbished", "used", "like new", "vintage", "antique", "collectible"];
const productSuffixes = ["item", "product", "good", "merchandise", "thing", "object", "widget", "gadget", "device", "apparatus", "contraption", "instrument", "tool", "implement", "utensil", "appliance", "machine", "equipment", "gear", "kit", "set", "package"];
const assetPreview = [".png", ".jpg", ".jpeg", ".heic", ".mp4", ".mov", ".avi"];

// ── HELPER FUNCTIONS ──
function makeProducts(maxItems = 5) {
	return function () {
		const data = [];
		const numOfItems = integer(1, maxItems);

		for (let i = 0; i < numOfItems; i++) {
			const category = chance.pickone(productCategories);
			const descriptor = chance.pickone(productDescriptors);
			const suffixWord = chance.pickone(productSuffixes);
			const slug = `${descriptor.replace(/\s+/g, "-").toLowerCase()}-${suffixWord.replace(/\s+/g, "-").toLowerCase()}`;
			const asset = chance.pickone(assetPreview);

			const price = integer(1, 100);
			const quantity = integer(1, 5);

			data.push({
				amount: price,
				quantity: quantity,
				total_value: price * quantity,
				featured: chance.pickone([true, false, false]),
				category: category,
				descriptor: descriptor,
				slug: slug,
				assetPreview: `https://example.com/assets/${slug}${asset}`,
				assetType: asset,
			});
		}

		return () => [data];
	};
}

function handleFunnelPreHooks(record, meta) {
	// H9: Dark Theme Power Users — dark +30%, light -15%, custom unchanged
	const isPurchaseFunnel = meta.funnel?.sequence?.includes("checkout");
	if (isPurchaseFunnel) {
		const theme = meta.profile?.theme;
		if (theme === "dark") record.conversionRate = Math.min(95, Math.round(record.conversionRate * 1.3));
		else if (theme === "light") record.conversionRate = Math.round(record.conversionRate * 0.85);
	}
	return record;
}

function handleEventHooks(record) {
	// H5: Item flattening — promote first item's fields to top level
	if (record.item && Array.isArray(record.item)) {
		record = { ...record, ...record.item[0] };
		delete record.item;
	}

	// H3: Toys + Shoes cart correlation
	if (record.event === "checkout" && Array.isArray(record.cart)) {
		const hasToys = record.cart.some(item => item.category === "toys");
		const hasShoes = record.cart.some(item => item.category === "shoes");
		if (hasToys && !hasShoes) {
			const bigCart = makeProducts(20)()()[0];
			const shoeItems = bigCart.filter(item => item.category === "shoes");
			if (shoeItems.length > 0) record.cart.push(shoeItems[0]);
		}
		if (hasShoes && !hasToys) {
			const bigCart = makeProducts(20)()()[0];
			const toyItems = bigCart.filter(item => item.category === "toys");
			if (toyItems.length > 0) record.cart.push(toyItems[0]);
		}
		if (!hasToys && !hasShoes) {
			const cheapFactor = decimal(0.75, 0.9);
			record.cart = record.cart.map(item => ({
				...item,
				amount: Math.round(item.amount * cheapFactor),
				total_value: Math.round(item.total_value * cheapFactor),
			}));
		}
	}

	// H4: Quality → watch time correlation
	if (record.event === "watch video") {
		const quality = record.quality || "480p";
		const factor = QUALITY_FACTORS[quality] ?? 1.0;
		record.watchTimeSec = Math.round(record.watchTimeSec * factor);
	}

	return record;
}

function handleEverythingHooks(record, meta) {
	const profile = meta.profile;
	record.forEach(e => {
		e.theme = profile.theme;
	});

	const datasetEnd = dayjs.unix(meta.datasetEnd);
	const DAY_SIGNUPS_IMPROVED = datasetEnd.subtract(SIGNUP_FIX_DAYS_AGO, "day");
	const DAY_WATCH_TIME_WENT_UP = datasetEnd.subtract(WATCH_INFLECTION_DAYS_AGO, "day");

	// H1: Signup flow v1 → v2; pre-fix v1 signups lose 50% to _drop
	record.forEach(e => {
		if (e.event !== "sign up") return;
		const eventTime = dayjs(e.time);
		e.signup_flow = "v1";
		if (eventTime.isBefore(DAY_SIGNUPS_IMPROVED)) {
			if (chance.bool({ likelihood: 50 })) e._drop = true;
		}
		if (eventTime.isAfter(DAY_SIGNUPS_IMPROVED)) {
			e.signup_flow = "v2";
		}
	});

	// H2: Watch time inflection — before: shrink, after: grow
	record.forEach(e => {
		if (e.event !== "watch video") return;
		const eventTime = dayjs(e.time);
		const factor = decimal(WATCH_FACTOR_MIN, WATCH_FACTOR_MAX);
		if (eventTime.isBefore(DAY_WATCH_TIME_WENT_UP)) {
			e.watchTimeSec = Math.round(e.watchTimeSec * (1 - factor));
		}
		if (eventTime.isAfter(DAY_WATCH_TIME_WENT_UP)) {
			e.watchTimeSec = Math.round(e.watchTimeSec * (1 + factor));
		}
	});

	// H6: View-item magic number — sweet spot (3-8) boost; over (9+) checkout drop
	const viewItemCount = record.filter(e => e.event === "view item").length;
	if (viewItemCount >= VIEW_SWEET_MIN && viewItemCount <= VIEW_SWEET_MAX) {
		record.forEach(e => {
			if (e.event === "checkout" && Array.isArray(e.cart)) {
				e.cart = e.cart.map(it => ({
					...it,
					amount: typeof it.amount === "number" ? Math.round(it.amount * SWEET_CART_BOOST) : it.amount,
					total_value: typeof it.total_value === "number" ? Math.round(it.total_value * SWEET_CART_BOOST) : it.total_value,
				}));
			}
		});
		const addToCartEvents = record.filter(e => e.event === "add to cart");
		const clones = [];
		addToCartEvents.forEach(e => {
			if (chance.bool({ likelihood: SWEET_CLONE_LIKELIHOOD })) {
				const offsetMs = integer(60_000, 600_000);
				clones.push({
					...e,
					insert_id: uid(),
					time: dayjs(e.time).add(offsetMs, "milliseconds").toISOString(),
				});
			}
		});
		if (clones.length > 0) record.push(...clones);
	} else if (viewItemCount >= VIEW_OVER_THRESHOLD) {
		for (let i = record.length - 1; i >= 0; i--) {
			if (record[i].event === "checkout" && chance.bool({ likelihood: OVER_CHECKOUT_DROP_LIKELIHOOD })) {
				record.splice(i, 1);
			}
		}
	}

	// H7: Signup-flow TTC scaled by loyalty tier (gold/plat fast, bronze slow)
	{
		let loyaltyTier = "silver";
		const scdEntries = meta?.scd?.loyalty_tier;
		if (Array.isArray(scdEntries) && scdEntries.length > 0) {
			const latest = scdEntries.reduce((a, b) => (a.time > b.time ? a : b));
			loyaltyTier = latest.loyalty_tier || "silver";
		} else {
			const uidStr = record[0]?.user_id || "";
			const hash = uidStr.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
			const bucket = hash % 100;
			loyaltyTier = bucket < 20 ? "gold" : bucket < 50 ? "silver" : "bronze";
		}
		const ttcFactor = (
			loyaltyTier === "gold" || loyaltyTier === "platinum" ? LOYALTY_TTC_FAST :
			loyaltyTier === "bronze" ? LOYALTY_TTC_SLOW :
			1.0
		);
		if (ttcFactor !== 1.0) {
			const funnelSteps = new Set(["page view", "view item", "save item", "sign up"]);
			const sorted = record.slice().sort((a, b) => new Date(a.time) - new Date(b.time));
			const signupEvent = sorted.find(e => e.event === "sign up");
			if (signupEvent) {
				const signupMs = new Date(signupEvent.time).getTime();
				const windowMs = LOYALTY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
				const funnelEvents = sorted.filter(e =>
					funnelSteps.has(e.event) &&
					new Date(e.time).getTime() >= signupMs - windowMs &&
					new Date(e.time).getTime() <= signupMs
				);
				if (funnelEvents.length >= 2) scaleFunnelTTC(funnelEvents, ttcFactor);
			}
		}
	}

	// H10: Save-item retention — born-in users below threshold churn after day 25
	if (meta.userIsBornInDataset) {
		const firstT = record[0]?.time;
		if (firstT) {
			const window10 = dayjs(firstT).add(SAVE_RETENTION_WINDOW_DAYS, "days").toISOString();
			const saves = record.filter(e => e.event === "save item" && e.time <= window10).length;
			if (saves < SAVE_RETENTION_MIN) {
				const cutoff = dayjs(firstT).add(SAVE_RETENTION_CUTOFF_DAYS, "days");
				for (let i = record.length - 1; i >= 0; i--) {
					if (dayjs(record[i].time).isAfter(cutoff) && chance.bool({ likelihood: SAVE_RETENTION_DROP_LIKELIHOOD })) {
						record.splice(i, 1);
					}
				}
			}
		}
	}

	return record.filter(e => !e._drop);
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
	format: "json",
	region: "US",
	hasAnonIds: true,
	avgDevicePerUser: 2,
	hasSessionIds: true,
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
			isStrictEvent: false,
			properties: {
				currency: ["USD", "CAD", "EUR", "BTC", "ETH", "JPY"],
				coupon: weighChoices(["none", "none", "none", "none", "10%OFF", "20%OFF", "10%OFF", "20%OFF", "30%OFF", "40%OFF", "50%OFF"]),
				cart: makeProducts(),
			},
		},
		{
			event: "add to cart",
			weight: 4,
			isStrictEvent: false,
			properties: {
				item: makeProducts(1),
				amount: weighNumRange(1, 100, 0.3),
				quantity: weighNumRange(1, 5, 0.3),
				total_value: weighNumRange(1, 500, 0.3),
				featured: [true, false, false],
				category: productCategories,
				descriptor: productDescriptors,
				slug: ["item"],
				assetPreview: ["https://example.com/assets/item.png"],
				assetType: assetPreview,
			},
		},
		{
			event: "view item",
			weight: 8,
			isStrictEvent: false,
			properties: {
				item: makeProducts(1),
				amount: weighNumRange(1, 100, 0.3),
				quantity: weighNumRange(1, 5, 0.3),
				total_value: weighNumRange(1, 500, 0.3),
				featured: [true, false, false],
				category: productCategories,
				descriptor: productDescriptors,
				slug: ["item"],
				assetPreview: ["https://example.com/assets/item.png"],
				assetType: assetPreview,
			},
		},
		{
			event: "save item",
			weight: 5,
			isStrictEvent: false,
			properties: {
				item: makeProducts(1),
				amount: weighNumRange(1, 100, 0.3),
				quantity: weighNumRange(1, 5, 0.3),
				total_value: weighNumRange(1, 500, 0.3),
				featured: [true, false, false],
				category: productCategories,
				descriptor: productDescriptors,
				slug: ["item"],
				assetPreview: ["https://example.com/assets/item.png"],
				assetType: assetPreview,
			},
		},
		{
			event: "page view",
			weight: 10,
			isStrictEvent: false,
			properties: {
				page: ["/", "/help", "/account", "/watch", "/listen", "/product", "/people", "/peace"],
			},
		},
		{
			event: "watch video",
			weight: 8,
			isStrictEvent: false,
			properties: {
				watchTimeSec: weighNumRange(10, 600, 0.25),
				quality: ["2160p", "1440p", "1080p", "720p", "480p", "360p", "240p"],
				format: ["mp4", "avi", "mov", "mpg"],
				uploader_id: chance.guid.bind(chance),
			},
		},
		{ event: "like video", weight: 6, properties: {} },
		{ event: "dislike video", weight: 4, properties: {} },
		{
			event: "sign up",
			weight: 1,
			isFirstEvent: true,
			isAuthEvent: true,
			properties: {
				signupMethod: ["email", "google", "facebook", "twitter", "linkedin", "github"],
				referral: weighChoices(["none", "none", "none", "friend", "ad", "ad", "ad", "friend", "friend", "friend", "friend"]),
				signup_flow: ["v1"],
			},
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
			name: "Signup Flow",
		},
		{
			sequence: ["watch video", "like video", "watch video", "like video"],
			name: "Video Likes",
			conversionRate: 60,
			props: {
				videoCategory: videoCategories,
				quality: ["2160p", "1440p", "1080p", "720p", "480p", "360p", "240p"],
				format: ["mp4", "avi", "mov", "mpg"],
				uploader_id: chance.guid.bind(chance),
			},
		},
		{
			name: "Video Dislikes",
			sequence: ["watch video", "dislike video", "watch video", "dislike video"],
			conversionRate: 20,
			props: {
				videoCategory: videoCategories,
				quality: ["2160p", "1440p", "1080p", "720p", "480p", "360p", "240p"],
				format: ["mp4", "avi", "mov", "mpg"],
				uploader_id: chance.guid.bind(chance),
			},
		},
		{
			name: "eCommerce Purchase",
			sequence: ["view item", "view item", "add to cart", "view item", "add to cart", "checkout"],
			conversionRate: 15,
			requireRepeats: true,
			weight: 10,
			order: "last-fixed",
			experiment: {
				name: "Express Checkout",
				variants: [
					{ name: "Control" },
					{ name: "Express Checkout", conversionMultiplier: 1.25 },
					{ name: "Social Proof", conversionMultiplier: 1.15, ttcMultiplier: 0.9 },
				],
				startDaysBeforeEnd: 30,
			},
		},
	],
	superProps: {
		theme: ["light", "dark", "custom", "light", "dark"],
	},
	userProps: {
		title: chance.profession.bind(chance),
		luckyNumber: weighNumRange(42, 420, 0.3),
		spiritAnimal: spiritAnimals,
		theme: ["light", "dark", "custom", "light", "dark"],
	},
	scdProps: {
		loyalty_tier: {
			values: ["bronze", "silver", "gold", "platinum"],
			frequency: "month",
			timing: "fuzzy",
			max: 8,
		},
	},
	mirrorProps: {},
	groupKeys: [],
	groupProps: {},
	lookupTables: [],
	hook(record, type, meta) {
		if (type === "funnel-pre") return handleFunnelPreHooks(record, meta);
		if (type === "event") return handleEventHooks(record);
		if (type === "everything") return handleEverythingHooks(record, meta);
		return record;
	},
};

export default config;
