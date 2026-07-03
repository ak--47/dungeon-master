// ── IMPORTS ──
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);
import { uid } from "ak-tools";
import { weighNumRange, integer, weighChoices, decimal, initChance } from "@ak--47/dungeon-master/utils";
import { scaleFunnelTTC } from "@ak--47/dungeon-master/hook-helpers";
/** @typedef {import("../../../types").Dungeon} Config */

// ── OVERVIEW ──
/*
 * NAME:       ShopStream
 * APP:        eCommerce marketplace with integrated video content. Users browse
 *             products, watch videos, build carts, and check out. A signup
 *             funnel converts anonymous browsers into registered users; video
 *             engagement (like/dislike) runs alongside the shopping flow.
 * SCALE:      42,000 users, ~2M events, 121 days (2026-01-01 → 2026-05-01)
 * CORE LOOP:  page view → view item → save/add to cart → checkout (+ video like/dislike side loop)
 *
 * EVENTS (9):
 *   page view (10) = save item (10) > view item (8) > watch video (8) > like video (6)
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
 *   - Expected: v1 disappears at day -7 with ZERO v2 before the fix and zero
 *     v1 after (tag purity is exact — the hook branches on the boundary)
 *
 *   Report 2: Pre vs Post Volume
 *   - Report type: Insights
 *   - Event: "sign up"
 *   - Measure: Total, daily average pre vs post fix date
 *   - Expected: post-fix daily rate ~5-7x the pre-fix average. The hook
 *     contributes exactly 2x (50% of pre-fix signups dropped); the rest is
 *     the acquisition ramp — births skew heavily late in the window
 *     (measured 6.9x at iteration scale), so the jump reads as "fix landed
 *     during a growth phase"
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
 *   - Expected: clear upward inflection ~ 30 days ago
 *
 *   Report 2: Watch Time Distribution Pre vs Post
 *   - Report type: Insights
 *   - Event: "watch video"
 *   - Measure: Average of "watchTimeSec"
 *   - Compare date ranges (last 30 days vs prior 91 days)
 *   - Expected: post/pre avg ratio = E[1+f]/E[1-f] with f uniform on
 *     [0.25, 0.79] → 1.52/0.48 ≈ 3.17 (measured 3.19 at iteration scale)
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
 *   - Expected: P(shoes | toys in cart) ≈ 0.64 predicted (baseline ~0.29
 *     organic + injection succeeding ~49% of the time — the injected item
 *     comes from a random 1-20-item cart that must contain a shoe), vs
 *     P(shoes | no toys) ≈ 0.11 — reciprocal toy-injection drains
 *     shoes-without-toys carts. Measured 0.71 vs 0.11 → ~6.4x lift
 *
 *   Report 2: Cart Value by Category Mix
 *   - Report type: Insights
 *   - Event: "checkout"
 *   - Measure: Average of "amount"
 *   - Breakdown: "category"
 *   - Expected: neither-cart avg item amount = mean(uniform 0.75-0.9)
 *     ≈ 0.825x carts holding toys or shoes (measured 0.824)
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
 *   - Expected: strictly monotonic increase from 240p to 2160p;
 *     2160p/240p avg ratio = 1.5/0.7 ≈ 2.14 (measured 2.07 — H2's
 *     inflection factor composes multiplicatively but is quality-blind,
 *     so it cancels in the ratio)
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
 * PATTERN: Events with an item array property (view item, add to cart,
 * save item) get the first item's fields (category, amount, slug, etc.)
 * flattened onto the event record as top-level properties, and the nested
 * "item" array is deleted. Checkout's "cart" array stays nested. The
 * discriminating signal vs the schema defaults: without the hook, every
 * item-event would carry slug="item" and the placeholder assetPreview;
 * after flattening, slug is always the "<descriptor>-<suffix>" compound
 * of the actual product (100% of item-events, no "item" column left).
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
 * COUNT and comparing avg cart item amount or add-to-cart rate.
 *
 * MEASUREMENT CAVEAT: view-item count is dominated by eCommerce Purchase
 * funnel passes (3 views per pass, weight 10), so the "over" bin holds
 * ~89% of users and is mechanically funnel-heavy — raw checkouts-per-user
 * INCREASES with view count despite the drop. The clean signals are
 * per-item and per-ratio, not per-user counts:
 *   - sweet/over avg cart item amount ≈ 1.25x (the boost, exact knob;
 *     measured 1.248 — H3's discount hits both bins equally and cancels)
 *   - sweet/over add-to-carts-per-view-item ≈ 1.37x (the 1.45x clone
 *     inflation punching through the over bin's funnel-heavier cart mix)
 *   - over/sweet checkouts-per-add-to-cart ≈ 0.54 (composite: the 30%
 *     drop, plus failed funnel attempts leaving cart-without-checkout
 *     prefixes disproportionately in the over bin)
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Avg Cart Item Amount by View-Item Bucket
 *   - Report type: Insights (with cohort)
 *   - Cohort A: users with 3-8 "view item" events
 *   - Cohort C: users with >= 9 "view item" events
 *   - Event: "checkout"
 *   - Measure: Average of cart item "amount"
 *   - Compare cohort A vs cohort C
 *   - Expected: cohort A ~ 1.25x higher cart item amounts than C
 *
 *   Report 2: Add-to-Cart Rate by Browse Intensity
 *   - Report type: Insights (with cohort)
 *   - Cohorts A (3-8 views) vs C (9+ views)
 *   - Event: "add to cart" normalized by "view item"
 *   - Expected: cohort A ~ 1.37x adds-per-view; checkouts-per-add for C
 *     ~ 0.54x of A
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
 *   - Expected: gold/platinum ~ 0.67x median TTC vs silver; bronze ~ 1.33x.
 *     bronze/gold ratio ceiling = 1.33/0.67 ≈ 1.99; measured 1.85 —
 *     organic (non-funnel) events inside the 2-day lookback window get
 *     scaled too, and pre-auth funnel steps carry device_id only, so
 *     identity must be resolved through the profile's device pool
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
 *   - Expected: roughly equal user split (deterministic hash thirds).
 *     "Variant name" / "Experiment name" are stamped ONLY on
 *     $experiment_started, not on the funnel step events
 *
 *   Report 2: Purchase Funnel Conversion by Variant
 *   - Report type: Funnels
 *   - Funnel: view item → add to cart → checkout
 *   - Breakdown: "$experiment_variant"
 *   - Expected: Express Checkout > Social Proof > Control. Effective
 *     per-attempt rates compose with H9's theme multiplier (engine applies
 *     experiment first, funnel-pre after): Control ≈ 16.2%, Express ≈
 *     20.2%, Social ≈ 17.8% theme-weighted → Express/Control ≈ 1.25,
 *     Social/Control ≈ 1.10. Social Proof also converts 0.9x faster
 *     (funnel timeToConvert defaults to 1h)
 *   - MEASUREMENT CAVEAT: checkout is also a weight-2 organic event that
 *     clusters in the same session as the funnel pass (~48K organic vs
 *     ~2K funnel checkouts). Naive "checkout within 75min" pairing adds a
 *     variant-independent floor that compresses the observable ratio to
 *     ~1.06 and mean TTC from ~60min to ~34min. Verification pairs
 *     STRICTLY — checkout in-window AND >= 5 view/add steps between
 *     $experiment_started and checkout (a converted pass always emits its
 *     5 steps; failed passes emit 1-5). Mixpanel's Funnels report handles
 *     this natively via ordered-sequence matching, so the report ratios
 *     land near the composed rates above. Engine effect verified by an
 *     isolated no-hook repro (Express lift present; Social/Control TTC
 *     0.888 ≈ knob 0.9)
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
 *   - Expected: dark > custom > light conversion rate. Effective funnel
 *     rates (base 15): dark round(15*1.3)=20, light round(15*0.85)=13,
 *     custom 15 → dark/light per-attempt ratio ≈ 1.54
 *
 *   Report 2: Checkout Count by Theme
 *   - Report type: Insights
 *   - Event: "checkout"
 *   - Measure: Total per user
 *   - Breakdown: "theme"
 *   - Expected: dark/light checkouts-per-user ≈ 1.48 (the 1.54 funnel
 *     ratio diluted by theme-blind organic checkouts, weight 2);
 *     custom/light ≈ 1.13
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
 * comparing retention or late-period activity. NOTE: the Signup Flow
 * funnel includes a "save item" step, so every signer has exactly one
 * guaranteed save — the threshold is really "made a 2nd, organic save".
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Retention by Early Save Count
 *   - Report type: Retention
 *   - First event: any event
 *   - Return event: any event
 *   - Cohort A: users with >= 2 "save item" in first 10 days
 *   - Cohort B: users with < 2 "save item" in first 10 days
 *   - Expected: Cohort A retains at 4+ weeks; Cohort B drops sharply after
 *     week 3. Applies to BORN-IN users only (~4% of users sign up in the
 *     window; savers are ~15-20% of eligible born users — a small,
 *     engineered cohort by design)
 *
 *   Report 2: Post-Day-25 Activity
 *   - Report type: Insights
 *   - Event: any event
 *   - Filter: time > first_event + 25 days
 *   - Cohort A: >= 2 early saves; Cohort B: < 2 early saves
 *   - Expected: (B post/pre rate) / (A post/pre rate) ≈ 0.30 — the drop
 *     knob exactly, since the ratio-of-ratios cancels window lengths and
 *     the acquisition ramp (measured 0.24 at iteration scale)
 *
 * REAL-WORLD ANALOGUE: Saving items signals purchase intent and product
 * engagement; users who curate a wishlist early are more likely to return.
 *
 * ============================================================================
 * EXPECTED METRICS SUMMARY
 * ============================================================================
 *
 * Hook | Metric                                   | Derivation          | Expected | Measured (full)
 * -----|------------------------------------------|---------------------|----------|----------------
 * H1   | v2-pre-fix + v1-post-fix count           | boundary branch     | 0 + 0    | 0 + 0
 * H1   | daily signup rate post/pre               | 2x drop x ramp      | 5-9x     | 8.25x
 * H2   | avg watchTimeSec post/pre                | 1.52/0.48           | 3.17x    | 3.19x
 * H3   | P(shoes|toys) / P(shoes|no toys)         | injection composite | ~6x      | 6.45x
 * H3   | neither-cart avg amount vs either        | mean(0.75..0.9)     | 0.825x   | 0.828x
 * H4   | avg watchTimeSec 2160p/240p              | 1.5/0.7             | 2.14x    | 2.17x
 * H5   | item-events flattened (no nested item)   | deterministic       | 100%     | 100%
 * H6   | sweet/over avg cart item amount          | SWEET_CART_BOOST    | 1.25x    | 1.233x
 * H6   | sweet/over add-to-carts per view         | 1.45 clone, diluted | ~1.37x   | 1.372x
 * H6   | over/sweet checkouts per add-to-cart     | 0.7 drop composite  | ~0.54x   | 0.521x
 * H7   | signup TTC bronze/gold+plat median       | 1.33/0.67 diluted   | ~1.9x    | 1.982x
 * H8   | Express/Control strict-paired conversion | 20.2/16.2 composed  | ~1.25x   | 1.19x (1.07-1.53 across seeds)
 * H8   | Social/Control strict-paired mean TTC    | ttcMultiplier       | ~0.9x    | 0.902x
 * H9   | dark/light checkouts per user            | 20/13 diluted       | ~1.48x   | 1.412x
 * H10  | (nonsaver post/pre) / (saver post/pre)   | drop knob           | ~0.30x   | 0.289x
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
// MIN must be 2: the Signup Flow funnel includes a "save item" step, so every
// signer carries exactly one funnel-guaranteed save — the magic number is a
// SECOND, organic save (MIN 1 makes the hook a no-op: zero-save cohort is
// empty). Cohort support comes from save item's event weight (10), which puts
// the saver cohort at ~100 of ~585 eligible born users at full fidelity —
// comfortably above the stories' minCohort 50 gate.
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

	// H7: Signup-flow TTC scaled by loyalty tier (gold/plat fast, bronze slow).
	// MUST run before H1: scaleFunnelTTC anchors on the cluster's earliest step
	// and rescales every later offset — including the sign up event itself — so
	// H1's version stamp has to read the FINAL timestamp. With the old H1-first
	// order, boundary-adjacent sign ups drifted across the fix instant after
	// stamping (3/1719 purity violations at full fidelity). This block consumes
	// no RNG, so the reorder does not perturb the seeded chance stream.
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
	seed: SEED,
	datasetStart: DATASET_START,
	datasetEnd: DATASET_END,
	avgEventsPerUserPerDay: EVENTS_PER_DAY,
	numUsers: NUM_USERS,
	format: "json",
	credentials: {
		token,
		region: "US",
	},
	switches: {
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
	},
	identity: {
		avgDevicePerUser: 2,
	},
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
			// weight 10 (not 5): H10's saver cohort = born users with a 2nd,
			// ORGANIC save in their first 10 days (the Signup Flow funnel
			// guarantees the 1st). At weight 5 the organic save rate left only
			// ~48-67 savers at full fidelity, straddling the stories'
			// minCohort 50 support gate; weight 10 doubles the organic rate.
			weight: 10,
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

// ── STORIES ──
// Machine-checkable contract for the 10 hooks above. Thresholds derive from
// the knob constants (and the engine's experiment/theme composition rules),
// never from observed output. duckdb assertions run in disk mode only
// (scripts/verify-stories.mjs after scripts/verify-runner.mjs).

const EV = `read_json_auto('{{PREFIX}}-EVENTS*.json', sample_size=-1, union_by_name=true)`;
const US = `read_json_auto('{{PREFIX}}-USERS*.json', sample_size=-1, union_by_name=true)`;
const SCDT = `read_json_auto('{{PREFIX}}-loyalty_tier-SCD*.json', sample_size=-1, union_by_name=true)`;

// Identity prelude: avgDevicePerUser: 2 + sign up isAuthEvent → born-in
// users' pre-auth Signup Flow steps carry device_id ONLY. Any per-user
// aggregation touching signup-funnel steps (H6 bins, H7 TTC, H10 born
// cohorts) must resolve through the profile's device pool ("anonymousIds"
// is the legacy USERS-shard key; buildIdentityMap reads the same field).
const ID_CTE = `dmap AS (SELECT unnest("anonymousIds") AS device_id, distinct_id FROM ${US}),
ev AS (SELECT coalesce(m.distinct_id::VARCHAR, e.user_id::VARCHAR, e.device_id::VARCHAR) AS uid,
  e.time::TIMESTAMP AS t, e.* FROM ${EV} e LEFT JOIN dmap m ON e.device_id = m.device_id)`;

// Temporal boundaries computed from the same knobs the hooks use.
const FIX_TS = dayjs.utc(DATASET_END).subtract(SIGNUP_FIX_DAYS_AGO, "day").format("YYYY-MM-DD HH:mm:ss");
const WATCH_TS = dayjs.utc(DATASET_END).subtract(WATCH_INFLECTION_DAYS_AGO, "day").format("YYYY-MM-DD HH:mm:ss");
const END_TS = dayjs.utc(DATASET_END).format("YYYY-MM-DD HH:mm:ss");
const WINDOW_DAYS = Math.round(dayjs.utc(DATASET_END).diff(dayjs.utc(DATASET_START), "day", true));
const PRE_FIX_DAYS = WINDOW_DAYS - SIGNUP_FIX_DAYS_AGO;

// Per-user view-item bins shared by the three H6 assertions. LEFT JOIN from
// profiles so zero-view users land in the low bin; uid comes through the
// identity prelude so device-only signup-funnel views count.
const BIN_CTE = `vc AS (SELECT u.distinct_id::VARCHAR AS duid,
  count(e.uid) FILTER (WHERE e.event = 'view item') AS views,
  count(e.uid) FILTER (WHERE e.event = 'add to cart') AS carts,
  count(e.uid) FILTER (WHERE e.event = 'checkout') AS cks
FROM ${US} u LEFT JOIN ev e ON e.uid = u.distinct_id::VARCHAR GROUP BY 1),
bins AS (SELECT duid, views, carts, cks,
  CASE WHEN views BETWEEN ${VIEW_SWEET_MIN} AND ${VIEW_SWEET_MAX} THEN 'sweet'
       WHEN views < ${VIEW_SWEET_MIN} THEN 'low' ELSE 'over' END AS bin FROM vc)`;

// Strict-paired experiment conversion. Naive time-window pairing (any
// checkout within 75min of $experiment_started) is POLLUTED here: checkout
// is also a weight-2 organic event that clusters in the same TimeSoup
// session as the attempt (~48K organic vs ~2K funnel checkouts at full
// fidelity), which adds a variant-independent conversion floor and pulls
// mean TTC from ~60min (full timeToConvert, addTimingOffsets in
// lib/generators/funnels.js accumulates to ttc on the last step) down to
// ~34min — compressing both variant ratios toward 1. A converted purchase
// pass ALWAYS emits its 5 view/add steps between $experiment_started and
// checkout (applyOrderingStrategy pins checkout last); a failed pass emits
// integer(1, totalSteps-1) = 1-5 steps (determineConversion), so only ~1/5
// of failures even have 5 steps to combine with a same-session organic
// checkout (<1% false-pair rate vs an 11-14% signal). Requiring >= 5
// intermediate view/add steps therefore isolates true funnel conversions.
// H6's over-bin checkout drop removes conversions uniformly across variants
// and cancels in the Express/Control ratio.
const EXP_CTE = `att AS (SELECT user_id::VARCHAR AS uid, time::TIMESTAMP AS t, "Variant name" AS variant
  FROM ${EV} WHERE event = '$experiment_started'),
ck AS (SELECT user_id::VARCHAR AS uid, time::TIMESTAMP AS t FROM ${EV} WHERE event = 'checkout'),
naive AS (SELECT a.uid, a.variant, a.t, min(c.t) AS ct
  FROM att a LEFT JOIN ck c ON c.uid = a.uid AND c.t > a.t AND c.t <= a.t + INTERVAL 75 MINUTE
  GROUP BY 1, 2, 3),
mids AS (SELECT n.uid, n.t, count(*) AS steps
  FROM naive n JOIN ${EV} s ON s.user_id::VARCHAR = n.uid
    AND s.event IN ('view item', 'add to cart')
    AND s.time::TIMESTAMP > n.t AND s.time::TIMESTAMP < n.ct
  WHERE n.ct IS NOT NULL GROUP BY 1, 2),
paired AS (SELECT n.uid, n.variant, n.t,
  CASE WHEN m.steps >= 5 THEN n.ct ELSE NULL END AS ct
  FROM naive n LEFT JOIN mids m ON m.uid = n.uid AND m.t = n.t),
by_variant AS (SELECT variant, count(*) AS attempts, count(ct) AS conversions,
  count(ct)::DOUBLE / count(*) AS rate,
  avg(epoch(ct - t)) FILTER (WHERE ct IS NOT NULL) / 60.0 AS mean_ttc_min,
  count(DISTINCT uid) AS user_count FROM paired GROUP BY 1)`;

/**
 * Five-tier verdict for a ratio measured inside a custom assert: NAILED
 * within ±10% of target, STRONG past floor, WEAK direction-correct, INVERSE
 * wrong side of 1, NONE not computable. Mirrors verdictFor() for op '>=' —
 * needed where the select grammar can't express the comparison (exact-zero
 * purity, strict orderings).
 */
function ratioVerdict(ratio, target, floor, detail, smallestCohort, minCohort) {
	if (!Number.isFinite(ratio)) return { pass: false, verdict: "NONE", detail: `ratio not computable — ${detail}` };
	let verdict;
	if (Math.abs(ratio - target) <= 0.1 * target) verdict = "NAILED";
	else if (ratio >= floor) verdict = "STRONG";
	else if (ratio > 1) verdict = "WEAK";
	else if (ratio < 1) verdict = "INVERSE";
	else verdict = "NONE";
	if ((verdict === "NAILED" || verdict === "STRONG") && smallestCohort < minCohort) {
		verdict = "WEAK";
		detail += ` — capped: smallest cohort ${smallestCohort} < minCohort ${minCohort}`;
	}
	return { pass: verdict === "NAILED" || verdict === "STRONG", verdict, detail };
}

/** @type {import("../../../types").DungeonStory[]} */
export const stories = [
	{
		id: "H1-signup-fix",
		hook: "H1",
		archetype: "temporal-inflection",
		narrative: `signup_flow flips v1 → v2 at datasetEnd - ${SIGNUP_FIX_DAYS_AGO}d and 50% of pre-fix signups are dropped. Tag purity is exact (the hook branches on the boundary); the daily-rate jump is a composite of the 2x drop and the late-skewed acquisition ramp (measured 6.9x at iteration scale)`,
		assertions: [
			{
				// deterministic purity: zero v2 before the fix, zero v1 strictly
				// after it. Exact-boundary events legitimately stay v1 (the hook
				// uses isBefore/isAfter), hence < and > not <=/>=.
				breakdown: {
					type: "duckdb",
					sql: `SELECT 'purity' AS grp,
 count(*) FILTER (WHERE signup_flow = 'v2' AND time::TIMESTAMP < TIMESTAMP '${FIX_TS}') AS v2_pre,
 count(*) FILTER (WHERE signup_flow = 'v1' AND time::TIMESTAMP > TIMESTAMP '${FIX_TS}') AS v1_post,
 count(*) AS signups
FROM ${EV} WHERE event = 'sign up'`,
				},
				assert: (rows) => {
					const r = (rows || [])[0];
					if (!r) return { pass: false, verdict: "NONE", detail: "no signup rows" };
					const clean = Number(r.v2_pre) === 0 && Number(r.v1_post) === 0;
					return {
						pass: clean,
						verdict: clean ? "NAILED" : "INVERSE",
						detail: `v2_pre=${r.v2_pre} v1_post=${r.v1_post} of ${r.signups} signups`,
					};
				},
			},
			{
				// daily-rate jump: the hook alone guarantees 2x (50% pre-fix drop);
				// the acquisition ramp multiplies on top. Band floor is the pure
				// knob effect, ceiling bounds the ramp composite.
				breakdown: {
					type: "duckdb",
					sql: `SELECT 'all' AS grp,
 (count(*) FILTER (WHERE time::TIMESTAMP >= TIMESTAMP '${FIX_TS}') / ${SIGNUP_FIX_DAYS_AGO}.0)
   / nullif(count(*) FILTER (WHERE time::TIMESTAMP < TIMESTAMP '${FIX_TS}') / ${PRE_FIX_DAYS}.0, 0) AS daily_ratio,
 count(*) AS user_count
FROM ${EV} WHERE event = 'sign up'`,
				},
				select: { all: { where: { grp: "all" } } },
				expect: { metric: "all.daily_ratio", op: "between", target: [2.0, 12.0] },
				minCohort: 300,
			},
		],
	},
	{
		id: "H2-watch-inflection",
		hook: "H2",
		archetype: "temporal-inflection",
		narrative: `watchTimeSec scaled by (1-f) before datasetEnd - ${WATCH_INFLECTION_DAYS_AGO}d and (1+f) after, f uniform on [${WATCH_FACTOR_MIN}, ${WATCH_FACTOR_MAX}]. Expected post/pre avg ratio = E[1+f]/E[1-f] = 1.52/0.48 ≈ 3.17 (measured 3.19)`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT 'all' AS grp,
 avg(watchTimeSec) FILTER (WHERE time::TIMESTAMP > TIMESTAMP '${WATCH_TS}')
   / nullif(avg(watchTimeSec) FILTER (WHERE time::TIMESTAMP < TIMESTAMP '${WATCH_TS}'), 0) AS ratio,
 count(*) AS event_count
FROM ${EV} WHERE event = 'watch video'`,
				},
				select: { all: { where: { grp: "all" } } },
				// band = knob prediction 3.17 ± sampling/quality-mix noise
				expect: { metric: "all.ratio", op: "between", target: [2.6, 3.75] },
			},
		],
	},
	{
		id: "H3-toys-shoes-basket",
		hook: "H3",
		archetype: "bespoke",
		narrative: `checkout carts with toys get a shoes item injected when the donor cart contains one (~49% success — makeProducts(20) must roll a shoe) and vice versa; carts with neither get all amounts scaled by uniform [0.75, 0.9] (mean 0.825). Predicted P(shoes|toys) ≈ 0.64 vs P(shoes|no toys) ≈ 0.11 (reciprocal injection drains the complement) → ~6x lift`,
		assertions: [
			{
				// carts keyed by insert_id (one row per checkout event)
				breakdown: {
					type: "duckdb",
					sql: `WITH x AS (SELECT insert_id, unnest(cart) AS item FROM ${EV} WHERE event = 'checkout' AND cart IS NOT NULL),
flags AS (SELECT insert_id, bool_or(item.category = 'toys') AS has_toys, bool_or(item.category = 'shoes') AS has_shoes,
  avg(item.amount) AS avg_amt FROM x GROUP BY 1)
SELECT 'all' AS grp,
 (count(*) FILTER (WHERE has_toys AND has_shoes)::DOUBLE / nullif(count(*) FILTER (WHERE has_toys), 0))
   / nullif(count(*) FILTER (WHERE has_shoes AND NOT has_toys)::DOUBLE / nullif(count(*) FILTER (WHERE NOT has_toys), 0), 0) AS lift,
 count(*) AS cart_count
FROM flags`,
				},
				select: { all: { where: { grp: "all" } } },
				expect: { metric: "all.lift", op: "between", target: [3.5, 10.5] },
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH x AS (SELECT insert_id, unnest(cart) AS item FROM ${EV} WHERE event = 'checkout' AND cart IS NOT NULL),
flags AS (SELECT insert_id, bool_or(item.category = 'toys') AS has_toys, bool_or(item.category = 'shoes') AS has_shoes,
  avg(item.amount) AS avg_amt FROM x GROUP BY 1)
SELECT 'all' AS grp,
 avg(avg_amt) FILTER (WHERE NOT has_toys AND NOT has_shoes)
   / nullif(avg(avg_amt) FILTER (WHERE has_toys OR has_shoes), 0) AS discount,
 count(*) AS cart_count
FROM flags`,
				},
				select: { all: { where: { grp: "all" } } },
				// mean(uniform 0.75..0.9) = 0.825; H6's sweet boost hits both
				// sides in proportion to bin mix and mostly cancels
				expect: { metric: "all.discount", op: "between", target: [0.76, 0.89] },
			},
		],
	},
	{
		id: "H4-quality-watchtime",
		hook: "H4",
		archetype: "cohort-prop-scale",
		narrative: `watchTimeSec multiplied by quality factor (240p 0.7 … 2160p 1.5). H2's temporal factor is quality-blind and cancels in ratios. Expected 2160p/240p = ${QUALITY_FACTORS["2160p"]}/${QUALITY_FACTORS["240p"]} ≈ 2.14 with strict monotonicity across all 7 tiers`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT quality AS grp, avg(watchTimeSec) AS avg_watch, count(*) AS event_count
FROM ${EV} WHERE event = 'watch video' GROUP BY 1`,
				},
				select: {
					uhd: { where: { grp: "2160p" } },
					sd: { where: { grp: "240p" } },
				},
				expect: { metric: "uhd.avg_watch / sd.avg_watch", op: "between", target: [1.85, 2.45] },
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT quality AS grp, avg(watchTimeSec) AS avg_watch, count(*) AS event_count
FROM ${EV} WHERE event = 'watch video' GROUP BY 1`,
				},
				assert: (rows) => {
					const order = ["240p", "360p", "480p", "720p", "1080p", "1440p", "2160p"];
					const by = Object.fromEntries((rows || []).map((r) => [r.grp, r]));
					const means = order.map((q) => by[q]?.avg_watch);
					if (means.some((m) => !Number.isFinite(m))) return { pass: false, verdict: "NONE", detail: `missing tiers (${Object.keys(by).join(",")})` };
					let inversions = 0;
					for (let i = 1; i < means.length; i++) if (means[i] <= means[i - 1]) inversions++;
					const detail = order.map((q, i) => `${q}=${means[i].toFixed(0)}`).join(" ");
					const verdict = inversions === 0 ? "NAILED" : inversions === 1 ? "WEAK" : "INVERSE";
					return { pass: verdict === "NAILED", verdict, detail: `${detail} (${inversions} inversions)` };
				},
			},
		],
	},
	{
		id: "H5-item-flattening",
		hook: "H5",
		archetype: "bespoke",
		narrative: `view item / add to cart / save item get item[0]'s fields spread top-level and the nested item array deleted; checkout's cart stays nested. Discriminator vs schema defaults: flattened slug is always the "<descriptor>-<suffix>" compound (schema default is the literal "item"), and no "item" column survives in the shards`,
		assertions: [
			{
				// the item column must not exist at all — DESCRIBE the shard schema
				breakdown: {
					type: "duckdb",
					sql: `SELECT 'schema' AS grp,
 (SELECT count(*) FROM (DESCRIBE SELECT * FROM ${EV}) WHERE column_name = 'item') AS item_cols,
 (SELECT count(*) FROM (DESCRIBE SELECT * FROM ${EV}) WHERE column_name = 'cart') AS cart_cols`,
				},
				assert: (rows) => {
					const r = (rows || [])[0];
					if (!r) return { pass: false, verdict: "NONE", detail: "no schema rows" };
					const ok = Number(r.item_cols) === 0 && Number(r.cart_cols) === 1;
					return {
						pass: ok,
						verdict: ok ? "NAILED" : "INVERSE",
						detail: `item columns=${r.item_cols} (want 0), cart columns=${r.cart_cols} (want 1)`,
					};
				},
			},
			{
				// 100% of item-events carry the flattened compound slug + category;
				// 100% of checkouts keep the nested cart
				breakdown: {
					type: "duckdb",
					sql: `SELECT event AS grp, count(*) AS n,
 count(*) FILTER (WHERE slug LIKE '%-%') AS compound_slug,
 count(*) FILTER (WHERE category IS NOT NULL) AS with_category,
 count(*) FILTER (WHERE cart IS NOT NULL) AS with_cart
FROM ${EV} WHERE event IN ('view item', 'add to cart', 'save item', 'checkout') GROUP BY 1`,
				},
				assert: (rows) => {
					const by = Object.fromEntries((rows || []).map((r) => [r.grp, r]));
					const itemEvents = ["view item", "add to cart", "save item"];
					const bad = [];
					for (const evName of itemEvents) {
						const r = by[evName];
						if (!r) { bad.push(`${evName}: missing`); continue; }
						if (Number(r.compound_slug) !== Number(r.n)) bad.push(`${evName}: slug ${r.compound_slug}/${r.n}`);
						if (Number(r.with_category) !== Number(r.n)) bad.push(`${evName}: category ${r.with_category}/${r.n}`);
					}
					const ck = by["checkout"];
					if (!ck) bad.push("checkout: missing");
					else if (Number(ck.with_cart) !== Number(ck.n)) bad.push(`checkout: cart ${ck.with_cart}/${ck.n}`);
					return {
						pass: bad.length === 0,
						verdict: bad.length === 0 ? "NAILED" : "INVERSE",
						detail: bad.length === 0 ? `100% flattened across ${itemEvents.length} item-events; checkout cart nested` : bad.join("; "),
					};
				},
			},
		],
	},
	{
		id: "H6-view-magic-number",
		hook: "H6",
		archetype: "frequency-sweet-spot",
		narrative: `3-8 view items → cart amounts x${SWEET_CART_BOOST} + ${SWEET_CLONE_LIKELIHOOD}% add-to-cart clones; 9+ views → ${OVER_CHECKOUT_DROP_LIKELIHOOD}% of checkouts dropped. View count is funnel-dominated (over bin ≈ 89% of users), so signals are per-item and per-ratio: amount ratio is the clean knob, the two rate ratios are documented composites`,
		assertions: [
			{
				// the boost itself: sweet/over avg cart item amount = 1.25 exactly
				// (H3's neither-discount hits both bins equally and cancels)
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${BIN_CTE},
items AS (SELECT e.uid, unnest(e.cart) AS item FROM ev e WHERE e.event = 'checkout' AND e.cart IS NOT NULL)
SELECT b.bin AS grp, avg(i.item.amount) AS avg_amt, count(*) AS item_count, count(DISTINCT i.uid) AS user_count
FROM items i JOIN bins b ON i.uid = b.duid GROUP BY 1`,
				},
				select: {
					sweet: { where: { grp: "sweet" } },
					over: { where: { grp: "over" } },
				},
				expect: { metric: "sweet.avg_amt / over.avg_amt", op: "between", target: [1.12, 1.38] },
				minCohort: 200,
			},
			{
				// clone inflation: 1.45x on sweet's add-to-carts, partially offset
				// by the over bin's funnel-heavier cart mix → ~1.37 measured
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${BIN_CTE}
SELECT bin AS grp, count(*) AS user_count,
 sum(carts)::DOUBLE / nullif(sum(views), 0) AS carts_per_view,
 sum(cks)::DOUBLE / nullif(sum(carts), 0) AS ck_per_cart
FROM bins GROUP BY 1`,
				},
				select: {
					sweet: { where: { grp: "sweet" } },
					over: { where: { grp: "over" } },
				},
				expect: { metric: "sweet.carts_per_view / over.carts_per_view", op: "between", target: [1.15, 1.6] },
				minCohort: 1000,
			},
			{
				// checkout suppression composite: the 30% drop plus failed funnel
				// attempts parking cart-without-checkout prefixes in the over bin
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${BIN_CTE}
SELECT bin AS grp, count(*) AS user_count,
 sum(carts)::DOUBLE / nullif(sum(views), 0) AS carts_per_view,
 sum(cks)::DOUBLE / nullif(sum(carts), 0) AS ck_per_cart
FROM bins GROUP BY 1`,
				},
				select: {
					sweet: { where: { grp: "sweet" } },
					over: { where: { grp: "over" } },
				},
				expect: { metric: "over.ck_per_cart / sweet.ck_per_cart", op: "between", target: [0.35, 0.75] },
				minCohort: 1000,
			},
		],
	},
	{
		id: "H7-loyalty-signup-ttc",
		hook: "H7",
		archetype: "funnel-ttc-by-segment",
		narrative: `Signup Flow TTC scaled by latest SCD loyalty_tier: gold/platinum x${LOYALTY_TTC_FAST}, bronze x${LOYALTY_TTC_SLOW}, silver untouched. Pure-scale ratio bronze/(gold+plat) = ${(LOYALTY_TTC_SLOW / LOYALTY_TTC_FAST).toFixed(2)}; measured 1.85-2.04 across seeds — organic events inside the ${LOYALTY_LOOKBACK_DAYS}d lookback dilute, while re-windowing on scaled times censors tails, so the median hovers near the pure ratio. Pre-auth steps are device-only → identity prelude required`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
latest AS (SELECT distinct_id, loyalty_tier FROM (
  SELECT distinct_id, loyalty_tier, row_number() OVER (PARTITION BY distinct_id ORDER BY time DESC) AS rn FROM ${SCDT}) WHERE rn = 1),
su AS (SELECT uid, min(t) AS st FROM ev WHERE event = 'sign up' GROUP BY 1),
steps AS (SELECT s.uid, s.st, min(e.t) AS first_step FROM su s JOIN ev e ON e.uid = s.uid
  WHERE e.event IN ('page view', 'view item', 'save item')
    AND e.t >= s.st - INTERVAL ${LOYALTY_LOOKBACK_DAYS} DAY AND e.t <= s.st GROUP BY 1, 2)
SELECT CASE WHEN l.loyalty_tier IN ('gold', 'platinum') THEN 'fast'
            WHEN l.loyalty_tier = 'bronze' THEN 'slow' ELSE 'silver' END AS grp,
 count(*) AS user_count, median(epoch(st - first_step)) / 60.0 AS med_ttc_min
FROM steps s JOIN latest l ON l.distinct_id = s.uid GROUP BY 1`,
				},
				select: {
					slow: { where: { grp: "slow" } },
					fast: { where: { grp: "fast" } },
				},
				expect: { metric: "slow.med_ttc_min / fast.med_ttc_min", op: "between", target: [1.5, 2.3] },
				minCohort: 200,
			},
			{
				// strict ordering: fast < silver < slow median TTC
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
latest AS (SELECT distinct_id, loyalty_tier FROM (
  SELECT distinct_id, loyalty_tier, row_number() OVER (PARTITION BY distinct_id ORDER BY time DESC) AS rn FROM ${SCDT}) WHERE rn = 1),
su AS (SELECT uid, min(t) AS st FROM ev WHERE event = 'sign up' GROUP BY 1),
steps AS (SELECT s.uid, s.st, min(e.t) AS first_step FROM su s JOIN ev e ON e.uid = s.uid
  WHERE e.event IN ('page view', 'view item', 'save item')
    AND e.t >= s.st - INTERVAL ${LOYALTY_LOOKBACK_DAYS} DAY AND e.t <= s.st GROUP BY 1, 2)
SELECT CASE WHEN l.loyalty_tier IN ('gold', 'platinum') THEN 'fast'
            WHEN l.loyalty_tier = 'bronze' THEN 'slow' ELSE 'silver' END AS grp,
 count(*) AS user_count, median(epoch(st - first_step)) / 60.0 AS med_ttc_min
FROM steps s JOIN latest l ON l.distinct_id = s.uid GROUP BY 1`,
				},
				assert: (rows) => {
					const by = Object.fromEntries((rows || []).map((r) => [r.grp, r]));
					const f = by.fast, s = by.silver, sl = by.slow;
					if (!f || !s || !sl) return { pass: false, verdict: "NONE", detail: `missing tier groups (${Object.keys(by).join(",")})` };
					const ordered = f.med_ttc_min < s.med_ttc_min && s.med_ttc_min < sl.med_ttc_min;
					const smallest = Math.min(f.user_count, s.user_count, sl.user_count);
					let detail = `fast=${f.med_ttc_min.toFixed(1)}m silver=${s.med_ttc_min.toFixed(1)}m slow=${sl.med_ttc_min.toFixed(1)}m`;
					let verdict = ordered ? "NAILED" : (f.med_ttc_min < sl.med_ttc_min ? "WEAK" : "INVERSE");
					if (verdict === "NAILED" && smallest < 100) {
						verdict = "WEAK";
						detail += ` — capped: smallest cohort ${smallest} < minCohort 100`;
					}
					return { pass: verdict === "NAILED", verdict, detail };
				},
			},
		],
	},
	{
		id: "H8-checkout-experiment",
		hook: "H8",
		archetype: "experiment-lift",
		narrative: `engine experiment on eCommerce Purchase: variants assigned by deterministic per-user hash (equal thirds); effective conversionRate = round(base x multiplier), theme-composed (H9 applies after) → Control ≈ 16.2%, Express ≈ 20.2%, Social ≈ 17.8% per attempt; Social also gets ttcMultiplier 0.9 on the funnel's 1h window. "Variant name" lives only on $experiment_started. Conversions measured by STRICT pairing (checkout within 75min AND >= 5 view/add steps in between) — naive time-window pairing is diluted toward ratio 1 by same-session organic checkouts (engine correctness cross-checked by an isolated no-hook repro: Express lift present, Social/Control TTC 0.888 ≈ knob 0.9)`,
		assertions: [
			{
				// hash thirds: each variant's share of experiment users in [0.28, 0.39]
				breakdown: {
					type: "duckdb",
					sql: `WITH ${EXP_CTE} SELECT variant AS grp, attempts, conversions, rate, mean_ttc_min, user_count FROM by_variant`,
				},
				assert: (rows) => {
					const by = Object.fromEntries((rows || []).map((r) => [r.grp, r]));
					const names = ["Control", "Express Checkout", "Social Proof"];
					if (names.some((n) => !by[n])) return { pass: false, verdict: "NONE", detail: `missing variants (${Object.keys(by).join(",")})` };
					const total = names.reduce((acc, n) => acc + Number(by[n].user_count), 0);
					const shares = names.map((n) => Number(by[n].user_count) / total);
					const ok = shares.every((s) => s >= 0.28 && s <= 0.39);
					const smallest = Math.min(...names.map((n) => Number(by[n].user_count)));
					let detail = names.map((n, i) => `${n}=${(shares[i] * 100).toFixed(1)}%`).join(" ");
					let verdict = ok ? "NAILED" : shares.every((s) => s >= 0.2 && s <= 0.5) ? "WEAK" : "INVERSE";
					if (verdict === "NAILED" && smallest < 200) {
						verdict = "WEAK";
						detail += ` — capped: smallest cohort ${smallest} < minCohort 200`;
					}
					return { pass: verdict === "NAILED", verdict, detail };
				},
			},
			{
				// Express/Control strict-paired conversion. Point 1.25
				// (20.2/16.2 theme-composed; H6's uniform checkout drop cancels
				// in the ratio); band [1.05, 1.55] covers ~1.4 sigma of counting
				// noise at ~100 strict conversions per variant.
				breakdown: {
					type: "duckdb",
					sql: `WITH ${EXP_CTE} SELECT variant AS grp, attempts, conversions, rate, mean_ttc_min, user_count FROM by_variant`,
				},
				select: {
					express: { where: { grp: "Express Checkout" } },
					control: { where: { grp: "Control" } },
				},
				expect: { metric: "express.rate / control.rate", op: "between", target: [1.05, 1.55] },
				minCohort: 200,
			},
			{
				// Social Proof ttcMultiplier 0.9 on strict-paired mean TTC —
				// true conversions land at ~ttc (Control ~60min, Social ~54min),
				// so the ratio reads the knob directly; band [0.84, 0.96].
				breakdown: {
					type: "duckdb",
					sql: `WITH ${EXP_CTE} SELECT variant AS grp, attempts, conversions, rate, mean_ttc_min, user_count FROM by_variant`,
				},
				select: {
					social: { where: { grp: "Social Proof" } },
					control: { where: { grp: "Control" } },
				},
				expect: { metric: "social.mean_ttc_min / control.mean_ttc_min", op: "between", target: [0.84, 0.96] },
				minCohort: 200,
			},
		],
	},
	{
		id: "H9-dark-theme-power",
		hook: "H9",
		archetype: "funnel-conversion-by-segment",
		narrative: `funnel-pre multiplies purchase-funnel conversionRate: dark round(15x1.3)=20, light round(15x0.85)=13, custom 15 → per-attempt dark/light ≈ 1.54, diluted to ≈ 1.48 checkouts-per-user by theme-blind organic checkouts (weight 2). Theme is stamped on every event by the everything hook`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH uc AS (SELECT theme, count(*) AS users FROM ${US} GROUP BY 1),
ec AS (SELECT theme, count(*) AS cks FROM ${EV} WHERE event = 'checkout' GROUP BY 1)
SELECT uc.theme AS grp, uc.users AS user_count, ec.cks AS checkouts, ec.cks::DOUBLE / uc.users AS per_user
FROM uc JOIN ec ON uc.theme = ec.theme`,
				},
				select: {
					dark: { where: { grp: "dark" } },
					light: { where: { grp: "light" } },
				},
				expect: { metric: "dark.per_user / light.per_user", op: "between", target: [1.25, 1.7] },
				minCohort: 2000,
			},
			{
				// strict ordering dark > custom > light (custom/light knob 15/13 ≈ 1.15)
				breakdown: {
					type: "duckdb",
					sql: `WITH uc AS (SELECT theme, count(*) AS users FROM ${US} GROUP BY 1),
ec AS (SELECT theme, count(*) AS cks FROM ${EV} WHERE event = 'checkout' GROUP BY 1)
SELECT uc.theme AS grp, uc.users AS user_count, ec.cks::DOUBLE / uc.users AS per_user
FROM uc JOIN ec ON uc.theme = ec.theme`,
				},
				assert: (rows) => {
					const by = Object.fromEntries((rows || []).map((r) => [r.grp, r]));
					const d = by.dark, c = by.custom, l = by.light;
					if (!d || !c || !l) return { pass: false, verdict: "NONE", detail: `missing themes (${Object.keys(by).join(",")})` };
					const ordered = d.per_user > c.per_user && c.per_user > l.per_user;
					const smallest = Math.min(d.user_count, c.user_count, l.user_count);
					let detail = `dark=${d.per_user.toFixed(3)} custom=${c.per_user.toFixed(3)} light=${l.per_user.toFixed(3)}`;
					let verdict = ordered ? "NAILED" : (d.per_user > l.per_user ? "WEAK" : "INVERSE");
					if (verdict === "NAILED" && smallest < 2000) {
						verdict = "WEAK";
						detail += ` — capped: smallest cohort ${smallest} < minCohort 2000`;
					}
					return { pass: verdict === "NAILED", verdict, detail };
				},
			},
		],
	},
	{
		id: "H10-save-retention",
		hook: "H10",
		archetype: "retention-divergence",
		narrative: `born-in users with fewer than ${SAVE_RETENTION_MIN} save items in their first ${SAVE_RETENTION_WINDOW_DAYS} days lose ${SAVE_RETENTION_DROP_LIKELIHOOD}% of events after day ${SAVE_RETENTION_CUTOFF_DAYS}. The ratio-of-ratios (nonsaver post/pre) / (saver post/pre) cancels window lengths and the acquisition ramp → ≈ ${(1 - SAVE_RETENTION_DROP_LIKELIHOOD / 100).toFixed(2)} by knob. Every signer has one funnel-guaranteed save (Signup Flow includes the step) — savers made a 2nd, organic save (~15-20% of eligible born users)`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
born AS (SELECT uid, min(t) AS t0 FROM ev WHERE event = 'sign up' GROUP BY 1),
eligible AS (SELECT uid, t0 FROM born
  WHERE t0 <= TIMESTAMP '${END_TS}' - INTERVAL ${SAVE_RETENTION_CUTOFF_DAYS + SAVE_RETENTION_WINDOW_DAYS} DAY),
per AS (SELECT b.uid,
  count(e.uid) FILTER (WHERE e.event = 'save item' AND e.t <= b.t0 + INTERVAL ${SAVE_RETENTION_WINDOW_DAYS} DAY) AS early_saves,
  count(e.uid) FILTER (WHERE e.t <= b.t0 + INTERVAL ${SAVE_RETENTION_CUTOFF_DAYS} DAY) AS pre_ev,
  count(e.uid) FILTER (WHERE e.t > b.t0 + INTERVAL ${SAVE_RETENTION_CUTOFF_DAYS} DAY) AS post_ev
FROM eligible b JOIN ev e ON e.uid = b.uid GROUP BY 1)
SELECT CASE WHEN early_saves >= ${SAVE_RETENTION_MIN} THEN 'saver' ELSE 'nonsaver' END AS grp,
 count(*) AS user_count, avg(post_ev)::DOUBLE / nullif(avg(pre_ev), 0) AS post_pre
FROM per GROUP BY 1`,
				},
				select: {
					nonsaver: { where: { grp: "nonsaver" } },
					saver: { where: { grp: "saver" } },
				},
				// knob 0.30; band absorbs saver-cohort sampling noise (~85
				// savers at full fidelity: ~1.8K born signups x ~31% with 35d
				// runway x ~14% making a 2nd organic save in the 10d window at
				// save-item weight 10 — measured 21/148 at 12K iteration scale)
				expect: { metric: "nonsaver.post_pre / saver.post_pre", op: "between", target: [0.15, 0.45] },
				minCohort: 50,
			},
			{
				// control: savers are untouched — their post/pre rate stays ~flat
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
born AS (SELECT uid, min(t) AS t0 FROM ev WHERE event = 'sign up' GROUP BY 1),
eligible AS (SELECT uid, t0 FROM born
  WHERE t0 <= TIMESTAMP '${END_TS}' - INTERVAL ${SAVE_RETENTION_CUTOFF_DAYS + SAVE_RETENTION_WINDOW_DAYS} DAY),
per AS (SELECT b.uid,
  count(e.uid) FILTER (WHERE e.event = 'save item' AND e.t <= b.t0 + INTERVAL ${SAVE_RETENTION_WINDOW_DAYS} DAY) AS early_saves,
  count(e.uid) FILTER (WHERE e.t <= b.t0 + INTERVAL ${SAVE_RETENTION_CUTOFF_DAYS} DAY) AS pre_ev,
  count(e.uid) FILTER (WHERE e.t > b.t0 + INTERVAL ${SAVE_RETENTION_CUTOFF_DAYS} DAY) AS post_ev
FROM eligible b JOIN ev e ON e.uid = b.uid GROUP BY 1)
SELECT CASE WHEN early_saves >= ${SAVE_RETENTION_MIN} THEN 'saver' ELSE 'nonsaver' END AS grp,
 count(*) AS user_count, avg(post_ev)::DOUBLE / nullif(avg(pre_ev), 0) AS post_pre
FROM per GROUP BY 1`,
				},
				select: { saver: { where: { grp: "saver" } } },
				expect: { metric: "saver.post_pre", op: "between", target: [0.8, 1.35] },
				minCohort: 50,
			},
		],
	},
];
