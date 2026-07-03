// ── IMPORTS ──
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);
import "dotenv/config";
import * as u from "@ak--47/dungeon-master/utils";
import * as v from "ak-tools";
/** @typedef  {import("../../../types").Dungeon} Config */

// ── OVERVIEW ──
/*
 * NAME:       TradeNest
 * APP:        Two-sided marketplace connecting sellers who list products with
 *             buyers who search, purchase, and review. Sellers list items;
 *             buyers browse, message, negotiate, and buy. Revenue from
 *             marketplace fees and listing fees.
 * SCALE:      10,000 users, ~1.4M events, 121 days (2026-01-01 → 2026-05-01)
 * CORE LOOP:  search → view → add to cart → purchase → review
 *             (seller side: create listing → receive offers → accept → ship)
 *
 * EVENTS (18):
 *   item searched (8) > app session (8) > item viewed (7) > notification received (6)
 *   > add to cart (5) > message sent (5) > listing created (4) > purchase completed (3)
 *   > listing updated (3) > offer received (3) > shipping updated (3) > offer accepted (2)
 *   > review submitted (2) > seller rated (2) > profile updated (2) > account created (1)
 *   > refund requested (1) > account deactivated (1)
 *
 * FUNNELS (5):
 *   - Buyer Onboarding:      account created → item searched → item viewed → add to cart (40%)
 *   - Browse to Purchase:    item searched → item viewed → add to cart → purchase completed (30%)
 *   - Seller Listing Flow:   listing created → listing updated → offer received → offer accepted (25%)
 *   - Offer Negotiation:     offer received → message sent → offer accepted (35%)
 *   - Review After Purchase: purchase completed → shipping updated → review submitted (20%)
 *
 * USER PROPS:  user_type, segment, seller_rating, total_transactions, response_time_hours,
 *              store_name, Platform, category
 * SUPER PROPS: Platform, category
 * SCD PROPS:   seller_tier (new/verified/power/featured, monthly fuzzy, max 8)
 * GROUPS:      none
 */

// ── HOOK STORIES ──
/*
 * NOTE: All cohort effects are HIDDEN — no flag stamping. Discoverable via
 * raw-prop breakdowns (segment, day, category) or behavioral cohorts.
 *
 * ───────────────────────────────────────────────────────────────
 * 1. FEE CHANGE IMPACT (everything hook)
 * ───────────────────────────────────────────────────────────────
 *
 * PATTERN: After day 45 (permanent marketplace fee increase), all
 * "listing created" events get listing_fee multiplied by 1.3x.
 * Simulates the revenue impact of a platform fee adjustment. No flag —
 * discover via line chart of avg listing_fee over time.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Listing Fee Over Time
 *   • Report type: Insights
 *   • Event: "listing created"
 *   • Measure: Average of "listing_fee"
 *   • Line chart by week
 *   • Expected: Clear step-up around day 45 from ~$14 avg to ~$17.5
 *     avg (x1.26 — the floor() on the x1.3 multiply shaves ~4%)
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
 *   • Expected: Sat/Sun avg ≈ $248 vs Mon-Fri avg ≈ $206 (x1.2)
 *
 * REAL-WORLD ANALOGUE: E-commerce platforms see higher average
 * order values on weekends when buyers browse leisurely.
 *
 * ───────────────────────────────────────────────────────────────
 * 3. SELLER SUCCESS → BUYER TRUST (everything hook)
 * ───────────────────────────────────────────────────────────────
 *
 * PATTERN: Users with segment "power_seller" (from meta.profile) get
 * each "purchase completed" event cloned with 65% likelihood — an
 * expected x1.65 on purchase counts. Power sellers attract more
 * transactions due to trust/reputation.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Purchases per User by Segment
 *   • Report type: Insights
 *   • Event: "purchase completed"
 *   • Measure: Total per user
 *   • Breakdown: user property "segment"
 *   • Expected: power_seller ≈ 6x purchases vs casual_seller — the
 *     x1.65 clone mechanism stacks on the persona activity gap
 *     (eventMultiplier 5.0 vs 1.5). The clone lift alone is isolated
 *     by normalizing: purchases ÷ add-to-carts per segment
 *     (Insights formula A/B) ≈ 1.65-1.7x power vs casual.
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
 *   • Expected: electronics ≈ 1.5-2x more purchases than clothing/home.
 *     Raw counts also carry the engine's seeded favored-index skew on
 *     category population shares — the clean verification read is
 *     purchases per user: electronics-category users ≈ 1.2x others
 *     (up to ~1.2 expected clone purchases on a ~9.5/user baseline).
 *
 * REAL-WORLD ANALOGUE: Electronics shoppers have higher purchase
 * intent — they research, decide, and buy with less browsing.
 *
 * ───────────────────────────────────────────────────────────────
 * 5. RESPONSE TIME → CONVERSION (everything hook)
 * ───────────────────────────────────────────────────────────────
 *
 * PATTERN: A deterministic ~40% hash cohort of message-senders are
 * "fast responders": their "message sent" events get
 * response_time_hours 0.5-4 (avg ~2.25h), existing "offer accepted"
 * events are cloned 2x each (x3 total), and 60% of "offer received"
 * events spawn an extra accept. The other ~60% are slow responders:
 * response_time_hours 8-36 (avg ~22h) and 60% of their accepts are
 * dropped. Net mechanism: fast = 3A + 0.6R, slow = 0.4A (A = organic
 * accepts, R = offers received) ≈ 10x accepts per user.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Offer Accepted Count vs Response Time
 *   • Report type: Insights
 *   • Event: "offer accepted"
 *   • Measure: Total per user
 *   • Breakdown: event property "response_time_hours" (bucketed <4h vs >8h)
 *   • Expected: fast responders ≈ 10x offer accepts per user
 *
 * REAL-WORLD ANALOGUE: Sellers who respond quickly to inquiries
 * close significantly more deals on marketplace platforms.
 *
 * ───────────────────────────────────────────────────────────────
 * 6. NEW SELLER CHURN (everything hook)
 * ───────────────────────────────────────────────────────────────
 *
 * PATTERN: Users with segment "new_seller" lose 50% of events after
 * their first-event + 14 days. Stacks on the persona's activeWindow
 * (maxDays: 28), which already truncates their lifetime — the hook
 * halves what remains. Simulates new sellers who try the platform
 * and abandon it quickly.
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
 *   Report 2: Post/Pre Event Ratio by Segment
 *   • Per-user events after (first-event + 14d) ÷ events before
 *   • Expected: new_seller ratio ≈ half of everyone else's
 *     (~0.5 relative — activeWindow and the drop combined)
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
 * conversion. Frequent buyers retain all purchase events — an
 * effective 4/3 purchase-count edge over everyone else.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Purchases per Add-to-Cart by Segment
 *   • Report type: Insights (formula A/B)
 *   • A: "purchase completed" Total; B: "add to cart" Total
 *   • Breakdown: user property "segment"
 *   • Expected: frequent_buyer ≈ 1.33x casual_seller (the 4/3
 *     retention edge; casual_seller shares frequent_buyer's
 *     conversionModifier-neutral baseline). Unique-user funnel
 *     conversion is near ceiling for both — the count-normalized
 *     read is the visible one.
 *
 * REAL-WORLD ANALOGUE: Returning buyers have established trust
 * and familiarity with the platform, converting at higher rates.
 *
 * ───────────────────────────────────────────────────────────────
 * 9. BROWSE TO PURCHASE TIME-TO-CONVERT (funnel-post)
 * ───────────────────────────────────────────────────────────────
 *
 * PATTERN: Power_seller and frequent_buyer users complete the
 * Browse to Purchase funnel 2.5x faster (factor 0.4); window_shopper
 * 1.4x slower (factor 1.4). Applies ONLY to Browse-to-Purchase
 * instances (1.6 fix — scaling all five funnels diluted the read:
 * Buyer Onboarding emits the same search→view→cart prefix, so the
 * greedy evaluator assembled chains across unscaled instances and the
 * measured ratio collapsed to ~0.87/1.13).
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Browse to Purchase Median Time-to-Convert by Segment
 *   - Funnels > "item searched" -> "item viewed" -> "add to cart" -> "purchase completed"
 *   - Measure: Median time to convert, conversion window 2 days (48h —
 *     matches the funnel's timeToConvert; longer windows admit slow
 *     cross-instance chains: power's p75 blows from ~27h to ~47h at 72h)
 *   - Breakdown: segment
 *   - Expected: frequent_buyer/power_seller medians ~22-23h vs
 *     casual_seller ~36h (ratio ~0.61); window_shopper ~40h (~1.12x
 *     casual — right-censoring at the window trims its slow tail)
 *
 *   NOTE (funnel-post measurement): visible only via Mixpanel funnel
 *   median TTC. Cross-event MIN→MIN SQL queries on raw events do NOT
 *   show this — funnel-post adjusts gaps within funnel instances, not
 *   across the user's full event history. The verify stories use
 *   emulateBreakdown's timeToConvert (same greedy ARB semantics as
 *   Mixpanel) — measured ratios sit above the raw 0.4 factor because
 *   chains can still borrow steps from adjacent organic instances.
 *
 * ───────────────────────────────────────────────────────────────
 * 10. MESSAGE-COUNT MAGIC NUMBER (in-funnel, everything)
 * ───────────────────────────────────────────────────────────────
 *
 * PATTERN: Cohort by TOTAL "message sent" count per user. Sweet spot
 * (2-5 messages) → offer_amount x1.35 on all "offer received" events.
 * Over-messagers (6+) → offer_amount x0.85 (haggling deadlock — buyers
 * lowball sellers who drag out negotiation). No flag.
 *
 * Both legs are property effects on an iid base (offer_amount is drawn
 * independently per event), so the cohort ratios are clean at any scale.
 * A purchase-DROP leg was removed in 1.6: message count correlates with
 * activity, so raw per-user purchase reads stay positive at any drop
 * rate — the story was structurally undiscoverable.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Avg Offer Amount by Message Bucket
 *   - Cohort A: users who did "message sent" 2-5 times
 *   - Cohort B: users with 0-1 messages
 *   - Cohort C: users with >= 6 messages
 *   - Event: "offer received"
 *   - Measure: Average of "offer_amount"
 *   - Expected: A ~ 1.35x B; C ~ 0.85x B; A ~ 1.59x C
 *
 * REAL-WORLD ANALOGUE: A few quick clarifying messages close deals at
 * better prices; extended haggling signals a lowball buyer.
 *
 * ═══════════════════════════════════════════════════════════════
 * EXPECTED METRICS SUMMARY (mechanism → measured @2K reduced run)
 * ═══════════════════════════════════════════════════════════════
 *
 * Hook | Report read                                 | Mechanism | Measured
 * -----|----------------------------------------------|-----------|---------
 * H1   | avg listing_fee post/pre day 45              | x1.26     | 1.259
 * H2   | avg total_amount Sat-Sun vs Mon-Fri          | x1.20     | 1.208
 * H3   | purchases-per-cart RoR, power/casual         | x1.65     | 1.670
 * H3   | raw purchases per user, power/casual         | ~6x       | 5.98
 * H4   | purchases/user, elec-searchers vs rest       | ~x1.2     | 1.221
 * H5   | offer accepts/user, fast vs slow responders  | ~10x      | 10.35
 * H5   | avg response_time_hours, slow/fast           | ~9.8x     | 9.99
 * H6   | post/pre +14d event ratio, new_seller/rest   | ~0.5x     | 0.504
 * H7   | power_seller tx (100-500) / rating (4.5-5.0) | exact     | 299 / 4.75
 * H8   | purchases-per-cart RoR, frequent/casual      | x1.33     | 1.335
 * H9   | B2P median TTC @48h win, frequent/casual     | <1        | 0.61
 * H9   | B2P median TTC @48h win, window/casual       | >1        | 1.12
 * H10  | avg offer_amount, sweet(2-5 msgs)/low(0-1)   | x1.35     | 1.302
 * H10  | avg offer_amount, over(6+)/low               | x0.85     | 0.834
 *
 * MEASUREMENT CAVEATS
 * - Activity confounds: raw per-user counts mix hook effects with persona
 *   eventMultiplier gaps (H3's raw ~6x = the x1.65 clone lift stacked on
 *   the 5.0-vs-1.5 activity gap). Normalized reads (per-cart RoR, per-user
 *   ratios) are the clean verification signals.
 * - Favored-index skew: property sampling favors a seeded index per run,
 *   so raw category population shares are confounded (automotive ran hot
 *   at 2K). H4's clean read is per-user purchases, not raw counts.
 * - Dead config keys: `anomalies`, `attribution`, and `geo` are 1.4
 *   KILLED_CONFIG_KEYS — the validator strips them with a warning
 *   (lib/core/config-validator.js). No whale purchases (max total_amount
 *   ~$490), no day-68 signup spike, no UTM stamping (hasCampaigns is
 *   false anyway). Blocks kept for cross-dungeon config consistency.
 * - floor() shaving: H1's Math.floor turns x1.3 into ~x1.26 measured;
 *   H2's floor costs <1% on x1.2.
 * - Clone property draws: H3/H4 clones draw fresh total_amount
 *   (chance.integer), diluting avg-amount reads; count reads unaffected.
 * - H9: emulated funnel medians sit above the raw 0.4 gap factor because
 *   greedy chains still borrow steps from adjacent organic instances;
 *   the measured ratios (0.61/1.12) are the Mixpanel-visible numbers.
 */

// ── SCALE ──
const SEED = "dm4-marketplace";
const NUM_USERS = 10_000;
const DATASET_START = "2026-01-01T00:00:00Z";
const DATASET_END = "2026-05-01T23:59:59Z";
const EVENTS_PER_DAY = 1.2;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── KNOBS (tweak these to reshape stories) ──
const FEE_CHANGE_DAY = 45;
const FEE_CHANGE_MULT = 1.3;

const WEEKEND_SPEND_MULT = 1.2;

const POWER_SELLER_CLONE_LIKELIHOOD = 65;

const ELECTRONICS_CLONE_LIKELIHOOD = 40;
const ELECTRONICS_MAX_CLONES = 3;

const FAST_RESPONDER_HASH_MOD = 5;
const FAST_RESPONDER_HASH_THRESHOLD = 2;
const FAST_OFFER_CLONE_COUNT = 2;
const FAST_OFFER_FROM_RECEIVED_LIKELIHOOD = 60;
const SLOW_OFFER_DROP_LIKELIHOOD = 60;

const NEW_SELLER_CUTOFF_DAYS = 14;
const NEW_SELLER_DROP_LIKELIHOOD = 50;

const FREQUENT_BUYER_DROP_LIKELIHOOD = 25;

const TTC_FAST_FACTOR = 0.4;
const TTC_SLOW_FACTOR = 1.4;

const MSG_SWEET_MIN = 2;
const MSG_SWEET_MAX = 5;
const MSG_OVER_THRESHOLD = 6;
const MSG_OFFER_BOOST = 1.35;
const MSG_OVER_PENALTY = 0.85;

// ── DATA ARRAYS ──
// Generate consistent seller store and listing IDs at module level
const storeIds = v.range(1, 150).map(() => `STORE_${v.uid(6)}`);
const listingIds = v.range(1, 500).map(() => `LST_${v.uid(8)}`);

// ── HELPER FUNCTIONS ──
function handleUserHooks(record) {
	// H7: Power seller profiles — enrich segment-tagged profiles
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
	return record;
}

function handleFunnelPostHooks(record, meta) {
	// H9: Browse-to-Purchase TTC scaled by segment — THIS funnel only.
	// Scaling all five funnels (pre-1.6 behavior) diluted the greedy funnel
	// read: Buyer Onboarding emits the same search→view→cart prefix, so the
	// evaluator assembles chains across unscaled instances and the measured
	// median ratio collapsed to ~0.87/1.13 (vs 0.71/1.4 engineered).
	if (meta?.funnel?.name !== "Browse to Purchase") return record;
	const segment = meta?.profile?.segment;
	if (Array.isArray(record) && record.length > 1) {
		const factor = (
			segment === "power_seller" || segment === "frequent_buyer" ? TTC_FAST_FACTOR :
			segment === "window_shopper" ? TTC_SLOW_FACTOR :
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
	return record;
}

function handleEverythingHooks(record, meta) {
	const datasetStart = dayjs.unix(meta.datasetStart);
	const FEE_CHANGE_CUTOFF = datasetStart.add(FEE_CHANGE_DAY, "days");
	let events = record;
	if (!events.length) return record;

	const profile = meta.profile;

	// Stamp superProps from profile so they are consistent per user.
	if (profile) {
		events.forEach(e => {
			if (profile.Platform) e.Platform = profile.Platform;
			if (profile.category) e.category = profile.category;
		});
	}

	// H1: Fee change impact — listings after d45 get listing_fee 1.3x.
	// In everything hook so timestamp comparison sees post-bunchIntoSessions times.
	events.forEach(e => {
		if (e.event === "listing created" && dayjs(e.time).isAfter(FEE_CHANGE_CUTOFF)) {
			e.listing_fee = Math.floor((e.listing_fee || 15) * FEE_CHANGE_MULT);
		}
	});

	// H8: Frequent buyer conversion filter — non-frequent-buyer users
	// drop ~25% of "purchase completed" events.
	if (profile && profile.segment !== "frequent_buyer") {
		record = record.filter(e => {
			if (e.event === "purchase completed" && chance.bool({ likelihood: FREQUENT_BUYER_DROP_LIKELIHOOD })) return false;
			return true;
		});
		events = record;
	}

	// H3: Seller success → buyer trust — power sellers get 2x purchase events cloned.
	if (profile && profile.segment === "power_seller") {
		const purchases = events.filter(e => e.event === "purchase completed");
		const templatePurchase = purchases[0];
		if (templatePurchase && purchases.length > 0) {
			purchases.forEach(p => {
				if (chance.bool({ likelihood: POWER_SELLER_CLONE_LIKELIHOOD })) {
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

	// H4: Search-to-purchase by category — electronics gets cloned purchase events.
	const hasElectronicsSearch = events.some(e =>
		e.event === "item searched" && e.category === "electronics"
	);
	if (hasElectronicsSearch) {
		const templatePurchase = events.find(e => e.event === "purchase completed");
		if (templatePurchase) {
			const electronicsSearches = events.filter(e =>
				e.event === "item searched" && e.category === "electronics"
			);
			electronicsSearches.slice(0, ELECTRONICS_MAX_CLONES).forEach(search => {
				if (chance.bool({ likelihood: ELECTRONICS_CLONE_LIKELIHOOD })) {
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

	// H5: Response time → conversion — deterministic fast/slow cohorts via user hash.
	// Fast (~40%): set response_time_hours 1-4, clone offer_accepted.
	// Slow (~60%): set 8-36, drop 60% of offer_accepted events.
	const msgEvents = events.filter(e => e.event === "message sent");
	if (msgEvents.length > 0) {
		const uid = msgEvents[0].user_id || "";
		const isFast = (uid.charCodeAt(0) + uid.charCodeAt(uid.length - 1)) % FAST_RESPONDER_HASH_MOD < FAST_RESPONDER_HASH_THRESHOLD;
		msgEvents.forEach(m => {
			m.response_time_hours = isFast
				? chance.floating({ min: 0.5, max: 4, fixed: 1 })
				: chance.floating({ min: 8, max: 36, fixed: 1 });
		});
		const templateOffer = events.find(e => e.event === "offer accepted");
		if (isFast && templateOffer) {
			// Fast responders: clone existing offer_accepted 2x each
			const existingAccepts = events.filter(e => e.event === "offer accepted");
			existingAccepts.forEach(accept => {
				for (let c = 0; c < FAST_OFFER_CLONE_COUNT; c++) {
					events.push({
						...accept,
						time: dayjs(accept.time).add(chance.integer({ min: 1, max: 8 }), "hours").toISOString(),
						user_id: accept.user_id,
						response_time_hours: chance.floating({ min: 0.1, max: 2, fixed: 1 }),
					});
				}
			});
			// Also clone from offer_received → offer_accepted
			const offers = events.filter(e => e.event === "offer received");
			offers.forEach(offer => {
				if (chance.bool({ likelihood: FAST_OFFER_FROM_RECEIVED_LIKELIHOOD })) {
					events.push({
						...templateOffer,
						time: dayjs(offer.time).add(chance.integer({ min: 1, max: 6 }), "hours").toISOString(),
						user_id: offer.user_id,
						response_time_hours: chance.floating({ min: 0.1, max: 3, fixed: 1 }),
					});
				}
			});
		} else if (!isFast) {
			// Slow responders: drop 60% of offer_accepted events
			for (let i = events.length - 1; i >= 0; i--) {
				if (events[i].event === "offer accepted" && chance.bool({ likelihood: SLOW_OFFER_DROP_LIKELIHOOD })) {
					events.splice(i, 1);
				}
			}
		}
	}

	// H6: New seller churn — drop 50% of events after user's first 14 days.
	if (profile && profile.segment === "new_seller") {
		const firstEventTime = events.length > 0 ? dayjs(events[0].time) : null;
		if (firstEventTime) {
			const userCutoff = firstEventTime.add(NEW_SELLER_CUTOFF_DAYS, "days");
			for (let i = events.length - 1; i >= 0; i--) {
				if (dayjs(events[i].time).isAfter(userCutoff) && chance.bool({ likelihood: NEW_SELLER_DROP_LIKELIHOOD })) {
					events.splice(i, 1);
				}
			}
		}
	}

	// H2: Weekend shopping surge — Sat/Sun purchases get total_amount 1.2x.
	events.forEach(e => {
		if (e.event === "purchase completed") {
			const dow = new Date(e.time).getUTCDay();
			if (dow === 0 || dow === 6) {
				e.total_amount = Math.floor((e.total_amount || 60) * WEEKEND_SPEND_MULT);
			}
		}
	});

	// H10: Message-count magic number (no flags). Cohort = TOTAL "message
	// sent" count per user — H10 runs last and nothing after it drops
	// messages, so the output-side count reproduces the cohort exactly
	// (the pre-1.6 between-first-view-and-first-offer window yielded a
	// near-empty over-cohort: ~2 users per 2K).
	// Sweet 2-5 → offer_amount x1.35 on all "offer received" events.
	// Over 6+ → offer_amount x0.85 (haggling deadlock; buyers lowball).
	// Property-only by design: a purchase-drop leg is structurally
	// unverifiable on this cohort — message count correlates with activity,
	// so raw per-user purchase reads stay positive at any drop rate, and
	// the pooled purchases-per-cart read lands at drop x segment-composition
	// (== 1.0 at the old 25%). offer_amount is iid per event, so cohort
	// ratios are clean at any scale. Recount fresh here: H6 may have
	// spliced messages out after H5 captured msgEvents.
	const msgCount = events.reduce((n, e) => n + (e.event === "message sent" ? 1 : 0), 0);
	if (msgCount >= MSG_SWEET_MIN && msgCount <= MSG_SWEET_MAX) {
		events.forEach(e => {
			if (e.event === "offer received" && typeof e.offer_amount === "number") {
				e.offer_amount = Math.round(e.offer_amount * MSG_OFFER_BOOST);
			}
		});
	} else if (msgCount >= MSG_OVER_THRESHOLD) {
		events.forEach(e => {
			if (e.event === "offer received" && typeof e.offer_amount === "number") {
				e.offer_amount = Math.round(e.offer_amount * MSG_OVER_PENALTY);
			}
		});
	}

	return record;
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
	gzip: true,
	credentials: {
		token,
	},
	switches: {
		hasSessionIds: true,
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
	},
	identity: {
		avgDevicePerUser: 2,
	},
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

	events: [
		{
			event: "account created",
			weight: 1,
			isFirstEvent: true,
			isAuthEvent: true,
			properties: {
				signup_source: ["organic", "google_shopping", "tiktok", "seller_referral", "email_campaign", "word_of_mouth"],
			},
		},
		{
			event: "item searched",
			weight: 8,
			isStrictEvent: false,
			properties: {
				search_query: ["laptop", "vintage jacket", "sneakers", "headphones", "phone case", "gaming console", "watch", "sunglasses", "backpack", "camera"],
				results_count: u.weighNumRange(0, 50, 0.5),
				sort_by: ["relevance", "relevance", "price_low", "price_high", "newest", "best_selling"],
			},
		},
		{
			event: "item viewed",
			weight: 7,
			isStrictEvent: false,
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
			isStrictEvent: false,
			properties: {
				listing_id: chance.pickone.bind(chance, listingIds),
				total_amount: u.weighNumRange(10, 500, 0.3, 60),
				item_count: u.weighNumRange(1, 5, 0.3),
				payment_method: ["credit_card", "credit_card", "paypal", "apple_pay", "debit"],
				shipping_method: ["standard", "standard", "express", "pickup"],
			},
		},
		{
			event: "listing created",
			weight: 4,
			isStrictEvent: false,
			properties: {
				listing_id: chance.pickone.bind(chance, listingIds),
				store_id: chance.pickone.bind(chance, storeIds),
				asking_price: u.weighNumRange(5, 500, 0.3, 50),
				condition: ["new", "new", "like_new", "good", "fair"],
				listing_fee: u.weighNumRange(5, 30, 0.5, 15),
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
			isStrictEvent: false,
			properties: {
				listing_id: chance.pickone.bind(chance, listingIds),
				offer_amount: u.weighNumRange(5, 400, 0.3, 40),
				offer_pct_of_asking: u.weighNumRange(50, 100, 0.5, 80),
			},
		},
		{
			event: "offer accepted",
			weight: 2,
			isStrictEvent: false,
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
			isStrictEvent: false,
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

	superProps: {
		Platform: ["ios", "android", "web"],
		category: ["electronics", "clothing", "home_garden", "collectibles", "sports", "toys", "automotive"],
	},

	userProps: {
		user_type: ["buyer"],
		segment: ["window_shopper"],
		seller_rating: u.weighNumRange(0, 5, 0.5),
		total_transactions: [0],
		response_time_hours: u.weighNumRange(0, 48, 0.3),
		store_name: ["none"],
		Platform: ["ios", "android", "web"],
		category: ["electronics", "clothing", "home_garden", "collectibles", "sports", "toys", "automotive"],
	},

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

	engagementDecay: {
		model: "exponential",
		halfLife: 75,
		floor: 0.1,
	},

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

	hook(record, type, meta) {
		if (type === "user") return handleUserHooks(record);
		if (type === "funnel-post") return handleFunnelPostHooks(record, meta);
		if (type === "everything") return handleEverythingHooks(record, meta);
		return record;
	},
};

export default config;

// ── STORY VERIFICATION (v1.6) ──
/*
 * Machine-checkable stories for the 10 numbered hooks. Evaluate with
 *   node scripts/verify-stories.mjs dungeons/vertical/marketplace/marketplace.js --data-prefix verify-marketplace
 * or the thin wrapper marketplace.verify.mjs.
 *
 * Derivation notes:
 * - Bands are centered on the 2K reduced-run measurements (iter-mkt-2)
 *   with the hook mechanism as the sanity anchor; scale guards are sized
 *   at ~60-70% of expected full-fidelity (10K) cell counts so reduced
 *   runs read WEAK (guarded) instead of false-failing.
 * - H1 uses the hook's exact cutoff (time > 2026-02-15T00:00:00Z), not
 *   date_diff day bucketing — day-45 events straddle the boundary.
 * - H3/H8 read purchases-per-add-to-cart ratio-of-ratios: normalizing by
 *   carts cancels the persona activity gap; the residual is the
 *   engineered clone lift (H3 x1.65) or retention edge (H8 4/3).
 * - H5's cohort split replicates the hook's charCode hash in SQL:
 *   (ascii(first char) + ascii(last char)) % 5 < 2.
 * - H9 asserts through emulateBreakdown's timeToConvert at a 48h window
 *   (matches the funnel's timeToConvert). Cross-event SQL cannot see
 *   funnel-post gap scaling. Window choice: at 48h each segment's TTC
 *   distribution is unimodal enough (frequent_buyer's fast mode holds
 *   69% mass, median well inside); at 72h+ cross-instance chains
 *   contaminate the fast tail (power_seller p75 blows ~27h → ~47h).
 * - H10's cohort is total message-sent count — exactly reproducible from
 *   the output because H10 runs last and nothing after it drops
 *   messages. Read is per-user avg offer_amount, then averaged across
 *   the cohort (matches the band-derivation measurement; offer_amount is
 *   iid per event so pooled and per-user weightings converge).
 */

const EV = `read_json_auto('{{PREFIX}}-EVENTS*.json', sample_size=-1, union_by_name=true)`;
const US = `read_json_auto('{{PREFIX}}-USERS*.json', sample_size=-1, union_by_name=true)`;

const bandVerdict = (x, nailed, strong, detail, inverse = () => false) => {
	if (x == null || Number.isNaN(Number(x))) return { verdict: "NONE", detail: `${detail} — metric missing` };
	const v = Number(x);
	if (inverse(v)) return { verdict: "INVERSE", detail };
	if (v >= nailed[0] && v <= nailed[1]) return { verdict: "NAILED", detail };
	if (v >= strong[0] && v <= strong[1]) return { verdict: "STRONG", detail };
	return { verdict: "WEAK", detail };
};

const guarded = (ok, detail, inner) => ok ? inner() : { verdict: "WEAK", detail: `${detail} — cohort below scale guard (expected at reduced scale)` };

const worstOf = (...verdicts) => {
	const order = ["INVERSE", "NONE", "WEAK", "STRONG", "NAILED"];
	return order.find(o => verdicts.some(v => v.verdict === o)) || "NONE";
};

export const stories = [
	{
		id: "marketplace-h1-fee-change",
		hook: "H1",
		archetype: "temporal-inflection",
		narrative: "Listings after day 45 get listing_fee x1.3 (Math.floor shaves it to ~x1.26). Post/pre avg listing_fee steps from ~$14 to ~$17.5.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT
  avg(listing_fee) FILTER (WHERE time::TIMESTAMP <= TIMESTAMP '2026-02-15 00:00:00') AS pre_avg,
  avg(listing_fee) FILTER (WHERE time::TIMESTAMP > TIMESTAMP '2026-02-15 00:00:00') AS post_avg,
  count(*) FILTER (WHERE time::TIMESTAMP <= TIMESTAMP '2026-02-15 00:00:00') AS pre_n,
  count(*) FILTER (WHERE time::TIMESTAMP > TIMESTAMP '2026-02-15 00:00:00') AS post_n
FROM ${EV}
WHERE event = 'listing created' AND listing_fee IS NOT NULL`,
				},
				assert: (rows) => {
					const r = rows[0] || {};
					const ratio = Number(r.post_avg) / Number(r.pre_avg);
					const detail = `post/pre avg listing_fee ${Number(r.post_avg).toFixed(2)}/${Number(r.pre_avg).toFixed(2)} = ${ratio.toFixed(3)}x (mechanism x1.26 after floor; pre_n=${r.pre_n} post_n=${r.post_n})`;
					return guarded(Number(r.pre_n) >= 25000 && Number(r.post_n) >= 28000, detail,
						() => bandVerdict(ratio, [1.21, 1.31], [1.14, 1.40], detail, v => v <= 1.02));
				},
			},
		],
	},
	{
		id: "marketplace-h2-weekend-surge",
		hook: "H2",
		archetype: "bespoke",
		narrative: "Sat/Sun purchases get total_amount x1.2 (floor costs <1%). Weekend/weekday avg total_amount ~1.21x.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT
  avg(total_amount) FILTER (WHERE dayofweek(time::TIMESTAMP) IN (0, 6)) AS wkn,
  avg(total_amount) FILTER (WHERE dayofweek(time::TIMESTAMP) NOT IN (0, 6)) AS wkd,
  count(*) FILTER (WHERE dayofweek(time::TIMESTAMP) IN (0, 6)) AS n_wkn
FROM ${EV}
WHERE event = 'purchase completed' AND total_amount IS NOT NULL`,
				},
				assert: (rows) => {
					const r = rows[0] || {};
					const ratio = Number(r.wkn) / Number(r.wkd);
					const detail = `weekend ${Number(r.wkn).toFixed(1)} vs weekday ${Number(r.wkd).toFixed(1)} avg total_amount = ${ratio.toFixed(3)}x (mechanism 1.2; n_wkn=${r.n_wkn})`;
					return guarded(Number(r.n_wkn) >= 14000, detail,
						() => bandVerdict(ratio, [1.15, 1.26], [1.08, 1.33], detail, v => v <= 1.00));
				},
			},
		],
	},
	{
		id: "marketplace-h3-seller-trust",
		hook: "H3",
		archetype: "cohort-count-scale",
		narrative: "Power sellers get purchases cloned at 65% likelihood (x1.65 counts). Clean read: purchases-per-cart RoR vs casual_seller (cancels the 5.0-vs-1.5 activity gap). Raw per-user ratio ~6x is the Mixpanel headline.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH pu AS (
  SELECT e.user_id::VARCHAR AS uid, any_value(u.segment) AS segment,
    count(*) FILTER (WHERE e.event = 'purchase completed') AS purch,
    count(*) FILTER (WHERE e.event = 'add to cart') AS carts
  FROM ${EV} e
  JOIN ${US} u ON e.user_id::VARCHAR = u.distinct_id::VARCHAR
  GROUP BY 1
)
SELECT segment, count(*) AS users,
  sum(purch)::DOUBLE / nullif(sum(carts), 0) AS purch_per_cart
FROM pu WHERE segment IN ('power_seller', 'casual_seller') GROUP BY segment`,
				},
				assert: (rows) => {
					const pow = rows.find(r => r.segment === "power_seller");
					const cas = rows.find(r => r.segment === "casual_seller");
					if (!pow || !cas) return { verdict: "NONE", detail: "power/casual segments missing" };
					const ror = Number(pow.purch_per_cart) / Number(cas.purch_per_cart);
					const detail = `purch-per-cart RoR power/casual = ${ror.toFixed(3)} (mechanism 1.65; power n=${pow.users} casual n=${cas.users})`;
					return guarded(Number(pow.users) >= 550 && Number(cas.users) >= 1450, detail,
						() => bandVerdict(ror, [1.53, 1.82], [1.35, 2.00], detail, v => v <= 1.10));
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH pu AS (
  SELECT e.user_id::VARCHAR AS uid, any_value(u.segment) AS segment,
    count(*) FILTER (WHERE e.event = 'purchase completed') AS purch
  FROM ${EV} e
  JOIN ${US} u ON e.user_id::VARCHAR = u.distinct_id::VARCHAR
  GROUP BY 1
)
SELECT segment, count(*) AS users, avg(purch) AS purch_pu
FROM pu WHERE segment IN ('power_seller', 'casual_seller') GROUP BY segment`,
				},
				assert: (rows) => {
					const pow = rows.find(r => r.segment === "power_seller");
					const cas = rows.find(r => r.segment === "casual_seller");
					if (!pow || !cas) return { verdict: "NONE", detail: "power/casual segments missing" };
					const ratio = Number(pow.purch_pu) / Number(cas.purch_pu);
					const detail = `raw purchases/user power ${Number(pow.purch_pu).toFixed(2)} vs casual ${Number(cas.purch_pu).toFixed(2)} = ${ratio.toFixed(2)}x (clone x activity ~6x)`;
					return guarded(Number(pow.users) >= 550 && Number(cas.users) >= 1450, detail,
						() => bandVerdict(ratio, [5.0, 7.0], [3.8, 8.5], detail, v => v <= 1.5));
				},
			},
		],
	},
	{
		id: "marketplace-h4-electronics-lift",
		hook: "H4",
		archetype: "cohort-count-scale",
		narrative: "Users who searched electronics get up to 3 cloned purchases at 40% each (~1.2 expected on a ~9.5/user baseline). Per-user read cancels the favored-index category skew.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH pu AS (
  SELECT user_id::VARCHAR AS uid,
    bool_or(event = 'item searched' AND category = 'electronics') AS elec,
    count(*) FILTER (WHERE event = 'purchase completed') AS purch
  FROM ${EV} GROUP BY 1
)
SELECT elec, count(*) AS users, avg(purch) AS purch_pu
FROM pu GROUP BY elec`,
				},
				assert: (rows) => {
					const el = rows.find(r => r.elec === true || r.elec === "true");
					const rest = rows.find(r => r.elec === false || r.elec === "false");
					if (!el || !rest) return { verdict: "NONE", detail: "electronics/rest buckets missing" };
					const ratio = Number(el.purch_pu) / Number(rest.purch_pu);
					const detail = `elec-searchers ${Number(el.purch_pu).toFixed(2)} vs rest ${Number(rest.purch_pu).toFixed(2)} purchases/user = ${ratio.toFixed(3)}x (mechanism ~1.2; elec n=${el.users})`;
					return guarded(Number(el.users) >= 1200 && Number(rest.users) >= 5500, detail,
						() => bandVerdict(ratio, [1.13, 1.32], [1.05, 1.45], detail, v => v <= 0.98));
				},
			},
		],
	},
	{
		id: "marketplace-h5-response-time",
		hook: "H5",
		archetype: "cohort-count-scale",
		narrative: "Deterministic ~40% hash cohort of message-senders: response_time_hours 0.5-4 + accepts tripled + 60% of offers spawn an accept. Slow cohort: 8-36h + 60% of accepts dropped. Net ~10x accepts/user; avg rt 2.25h vs 22h.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH pu AS (
  SELECT user_id::VARCHAR AS uid,
    (ascii(substr(user_id::VARCHAR, 1, 1)) + ascii(substr(user_id::VARCHAR, -1, 1))) % 5 < 2 AS is_fast,
    bool_or(event = 'message sent') AS has_msg,
    count(*) FILTER (WHERE event = 'offer accepted') AS accepts
  FROM ${EV} GROUP BY 1
)
SELECT is_fast, count(*) AS users, avg(accepts) AS accepts_pu
FROM pu WHERE has_msg GROUP BY is_fast`,
				},
				assert: (rows) => {
					const fast = rows.find(r => r.is_fast === true || r.is_fast === "true");
					const slow = rows.find(r => r.is_fast === false || r.is_fast === "false");
					if (!fast || !slow) return { verdict: "NONE", detail: "fast/slow buckets missing" };
					const ratio = Number(fast.accepts_pu) / Number(slow.accepts_pu);
					const detail = `fast ${Number(fast.accepts_pu).toFixed(2)} vs slow ${Number(slow.accepts_pu).toFixed(2)} accepts/user = ${ratio.toFixed(2)}x (mechanism ~10x; fast n=${fast.users} slow n=${slow.users})`;
					return guarded(Number(fast.users) >= 2300 && Number(slow.users) >= 3500, detail,
						() => bandVerdict(ratio, [8.5, 12.5], [6.5, 15.0], detail, v => v <= 1.5));
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT
  (ascii(substr(user_id::VARCHAR, 1, 1)) + ascii(substr(user_id::VARCHAR, -1, 1))) % 5 < 2 AS is_fast,
  avg(response_time_hours) AS avg_rt, count(*) AS n
FROM ${EV}
WHERE event = 'message sent' AND response_time_hours IS NOT NULL
GROUP BY 1`,
				},
				assert: (rows) => {
					const fast = rows.find(r => r.is_fast === true || r.is_fast === "true");
					const slow = rows.find(r => r.is_fast === false || r.is_fast === "false");
					if (!fast || !slow) return { verdict: "NONE", detail: "fast/slow rt buckets missing" };
					const ratio = Number(slow.avg_rt) / Number(fast.avg_rt);
					const detail = `avg rt slow ${Number(slow.avg_rt).toFixed(2)}h vs fast ${Number(fast.avg_rt).toFixed(2)}h = ${ratio.toFixed(2)}x (mechanism 22/2.25 = 9.8; n=${Number(fast.n) + Number(slow.n)})`;
					return guarded(Number(fast.n) >= 12000 && Number(slow.n) >= 18000, detail, () => {
						const vRatio = bandVerdict(ratio, [8.5, 11.5], [7.0, 13.0], detail, v => v <= 1.5);
						const vFast = bandVerdict(fast.avg_rt, [2.0, 2.5], [1.8, 2.8], detail, v => v > 8);
						const vSlow = bandVerdict(slow.avg_rt, [21, 23.5], [19, 25], detail, v => v < 4);
						return { verdict: worstOf(vRatio, vFast, vSlow), detail };
					});
				},
			},
		],
	},
	{
		id: "marketplace-h6-new-seller-churn",
		hook: "H6",
		archetype: "retention-divergence",
		narrative: "new_seller users lose 50% of events after first-event+14d, stacked on the persona's 28-day activeWindow. Per-user post/pre ratio lands at ~0.5x everyone else's.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH pu AS (
  SELECT e.user_id::VARCHAR AS uid, any_value(u.segment) AS segment, min(e.time::TIMESTAMP) AS t0
  FROM ${EV} e
  JOIN ${US} u ON e.user_id::VARCHAR = u.distinct_id::VARCHAR
  GROUP BY 1
), flags AS (
  SELECT p.uid, p.segment,
    count(*) FILTER (WHERE e.time::TIMESTAMP <= p.t0 + INTERVAL 14 DAY) AS pre,
    count(*) FILTER (WHERE e.time::TIMESTAMP > p.t0 + INTERVAL 14 DAY) AS post
  FROM ${EV} e JOIN pu p ON e.user_id::VARCHAR = p.uid
  GROUP BY 1, 2
)
SELECT (segment = 'new_seller') AS is_new, count(*) AS users,
  avg(post::DOUBLE / nullif(pre, 0)) AS post_pre
FROM flags WHERE pre > 0 GROUP BY 1`,
				},
				assert: (rows) => {
					const ns = rows.find(r => r.is_new === true || r.is_new === "true");
					const rest = rows.find(r => r.is_new === false || r.is_new === "false");
					if (!ns || !rest) return { verdict: "NONE", detail: "new_seller/rest buckets missing" };
					const ratio = Number(ns.post_pre) / Number(rest.post_pre);
					const detail = `new_seller post/pre ${Number(ns.post_pre).toFixed(3)} vs rest ${Number(rest.post_pre).toFixed(3)} = ${ratio.toFixed(3)}x (mechanism ~0.5; new n=${ns.users})`;
					return guarded(Number(ns.users) >= 850 && Number(rest.users) >= 5800, detail,
						() => bandVerdict(ratio, [0.42, 0.58], [0.34, 0.70], detail, v => v >= 0.95));
				},
			},
		],
	},
	{
		id: "marketplace-h7-power-profiles",
		hook: "H7",
		archetype: "cohort-prop-scale",
		narrative: "user-hook enrichment: power_seller tx 100-500 (mean 300) + rating 4.5-5.0; casual_seller tx 5-50 + rating 3.0-4.5; new_seller tx 0-3 + rating exactly 0; buyers keep the [0] default tx.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT segment, count(*) AS users,
  avg(total_transactions) AS avg_tx,
  avg(seller_rating) AS avg_rating
FROM ${US} GROUP BY segment`,
				},
				assert: (rows) => {
					const seg = Object.fromEntries(rows.map(r => [r.segment, r]));
					const pow = seg.power_seller, cas = seg.casual_seller, ns = seg.new_seller;
					if (!pow || !cas || !ns) return { verdict: "NONE", detail: "segments missing" };
					const detail = `power tx=${Number(pow.avg_tx).toFixed(0)} rating=${Number(pow.avg_rating).toFixed(2)}; casual tx=${Number(cas.avg_tx).toFixed(1)} rating=${Number(cas.avg_rating).toFixed(2)}; new tx=${Number(ns.avg_tx).toFixed(2)} rating=${Number(ns.avg_rating).toFixed(2)} (means engineered 300/4.75, 27.5/3.75, 1.5/0)`;
					return guarded(Number(pow.users) >= 550 && Number(cas.users) >= 1450 && Number(ns.users) >= 850, detail, () => {
						const legs = [
							bandVerdict(pow.avg_tx, [280, 320], [255, 345], detail, v => v < 60),
							bandVerdict(pow.avg_rating, [4.68, 4.82], [4.55, 4.95], detail, v => v < 3.8),
							bandVerdict(cas.avg_tx, [24.5, 30.5], [20, 35], detail, v => v > 90),
							bandVerdict(cas.avg_rating, [3.65, 3.85], [3.5, 4.0], detail, v => v > 4.55),
							bandVerdict(ns.avg_tx, [1.2, 1.8], [0.8, 2.2], detail, v => v > 4.5),
							Number(ns.avg_rating) === 0
								? { verdict: "NAILED", detail }
								: { verdict: "WEAK", detail: `${detail} — new_seller rating not pinned to 0` },
						];
						return { verdict: worstOf(...legs), detail };
					});
				},
			},
		],
	},
	{
		id: "marketplace-h8-frequent-buyer",
		hook: "H8",
		archetype: "funnel-conversion-by-segment",
		narrative: "Non-frequent-buyer users drop ~25% of purchases — frequent_buyer keeps a 4/3 purchase-count edge. Read as purchases-per-cart RoR vs casual_seller (Insights formula A/B); unique-user funnel conversion is near ceiling for both.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH pu AS (
  SELECT e.user_id::VARCHAR AS uid, any_value(u.segment) AS segment,
    count(*) FILTER (WHERE e.event = 'purchase completed') AS purch,
    count(*) FILTER (WHERE e.event = 'add to cart') AS carts
  FROM ${EV} e
  JOIN ${US} u ON e.user_id::VARCHAR = u.distinct_id::VARCHAR
  GROUP BY 1
)
SELECT segment, count(*) AS users,
  sum(purch)::DOUBLE / nullif(sum(carts), 0) AS purch_per_cart
FROM pu WHERE segment IN ('frequent_buyer', 'casual_seller') GROUP BY segment`,
				},
				assert: (rows) => {
					const fb = rows.find(r => r.segment === "frequent_buyer");
					const cas = rows.find(r => r.segment === "casual_seller");
					if (!fb || !cas) return { verdict: "NONE", detail: "frequent/casual segments missing" };
					const ror = Number(fb.purch_per_cart) / Number(cas.purch_per_cart);
					const detail = `purch-per-cart RoR frequent/casual = ${ror.toFixed(3)} (mechanism 4/3; frequent n=${fb.users} casual n=${cas.users})`;
					return guarded(Number(fb.users) >= 1800 && Number(cas.users) >= 1450, detail,
						() => bandVerdict(ror, [1.26, 1.41], [1.15, 1.52], detail, v => v <= 1.02));
				},
			},
		],
	},
	{
		id: "marketplace-h9-b2p-ttc",
		hook: "H9",
		archetype: "funnel-ttc-by-segment",
		narrative: "Browse-to-Purchase funnel-post gap scaling: power_seller/frequent_buyer x0.4, window_shopper x1.4, B2P instances only (1.6 fix — scaling all funnels let the greedy evaluator dilute the read to ~0.87/1.13 via unscaled Buyer-Onboarding prefixes). Asserted via timeToConvert at a 48h window: frequent/casual ~0.61, window/casual ~1.12 (window's slow tail right-censors), power/casual ~0.64.",
		assertions: [
			{
				breakdown: {
					type: "timeToConvert",
					steps: ["item searched", "item viewed", "add to cart", "purchase completed"],
					breakdownByUserProperty: "segment",
					conversionWindowMs: 48 * 3600 * 1000,
				},
				assert: (rows) => {
					const cell = Object.fromEntries(rows.map(r => [r.segment_value, r]));
					const med = s => cell[s] ? Number(cell[s].median_ttc_ms) : null;
					if (!med("frequent_buyer") || !med("casual_seller") || !med("window_shopper") || !med("power_seller")) {
						return { verdict: "NONE", detail: "segment TTC cells missing" };
					}
					const freqCas = med("frequent_buyer") / med("casual_seller");
					const winCas = med("window_shopper") / med("casual_seller");
					const powCas = med("power_seller") / med("casual_seller");
					const h = ms => (ms / 3600000).toFixed(1);
					const detail = `TTC medians @48h: frequent ${h(med("frequent_buyer"))}h / power ${h(med("power_seller"))}h / casual ${h(med("casual_seller"))}h / window ${h(med("window_shopper"))}h; frequent/casual=${freqCas.toFixed(3)} (measured 0.615) window/casual=${winCas.toFixed(3)} (1.120) power/casual=${powCas.toFixed(3)} (0.639); n=${cell.frequent_buyer.user_count}/${cell.power_seller.user_count}/${cell.casual_seller.user_count}/${cell.window_shopper.user_count}`;
					return guarded(
						Number(cell.frequent_buyer.user_count) >= 500 && Number(cell.power_seller.user_count) >= 200 &&
						Number(cell.casual_seller.user_count) >= 175 && Number(cell.window_shopper.user_count) >= 110,
						detail, () => {
							const v1 = bandVerdict(freqCas, [0.55, 0.68], [0.45, 0.80], detail, v => v >= 0.95);
							const v2 = bandVerdict(winCas, [1.05, 1.20], [0.98, 1.32], detail, v => v <= 0.93);
							const v3 = bandVerdict(powCas, [0.52, 0.76], [0.45, 0.90], detail, v => v >= 1.00);
							return { verdict: worstOf(v1, v2, v3), detail };
						});
				},
			},
		],
	},
	{
		id: "marketplace-h10-message-magic",
		hook: "H10",
		archetype: "frequency-sweet-spot",
		narrative: "Total message-count cohorts: 2-5 messages → offer_amount x1.35; 6+ → x0.85 (haggling deadlock). Property-only on an iid base — clean cohort ratios at any scale (a purchase-drop leg was structurally unverifiable on this activity-correlated cohort). Identity invariants ride along.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH pu AS (
  SELECT user_id::VARCHAR AS uid,
    count(*) FILTER (WHERE event = 'message sent') AS msgs,
    avg(offer_amount) FILTER (WHERE event = 'offer received') AS avg_offer
  FROM ${EV} GROUP BY 1
)
SELECT
  CASE WHEN msgs BETWEEN 2 AND 5 THEN 'sweet' WHEN msgs >= 6 THEN 'over' ELSE 'low' END AS bucket,
  count(*) FILTER (WHERE avg_offer IS NOT NULL) AS users,
  avg(avg_offer) AS avg_offer
FROM pu GROUP BY 1`,
				},
				assert: (rows) => {
					const sweet = rows.find(r => r.bucket === "sweet");
					const low = rows.find(r => r.bucket === "low");
					const over = rows.find(r => r.bucket === "over");
					if (!sweet || !low || !over) return { verdict: "NONE", detail: "message buckets missing" };
					const sweetLow = Number(sweet.avg_offer) / Number(low.avg_offer);
					const overLow = Number(over.avg_offer) / Number(low.avg_offer);
					const detail = `avg offer_amount sweet ${Number(sweet.avg_offer).toFixed(1)} / over ${Number(over.avg_offer).toFixed(1)} / low ${Number(low.avg_offer).toFixed(1)}; sweet/low=${sweetLow.toFixed(3)} (mechanism 1.35) over/low=${overLow.toFixed(3)} (0.85); n=${sweet.users}/${over.users}/${low.users}`;
					return guarded(Number(sweet.users) >= 2700 && Number(over.users) >= 1600 && Number(low.users) >= 2200, detail, () => {
						const v1 = bandVerdict(sweetLow, [1.24, 1.37], [1.15, 1.45], detail, v => v <= 1.02);
						const v2 = bandVerdict(overLow, [0.79, 0.88], [0.72, 0.94], detail, v => v >= 1.02);
						return { verdict: worstOf(v1, v2), detail };
					});
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT
  avg((user_id IS NOT NULL)::INT) AS uid_share,
  avg((device_id IS NOT NULL)::INT) AS device_share,
  count(DISTINCT device_id)::DOUBLE / count(DISTINCT user_id) AS devices_per_user
FROM ${EV}`,
				},
				assert: (rows) => {
					const r = rows[0] || {};
					const uid = Number(r.uid_share), dev = Number(r.device_share), dpu = Number(r.devices_per_user);
					const detail = `uid=${uid.toFixed(4)} device=${dev.toFixed(4)} devices/user=${dpu.toFixed(2)} (avgDevicePerUser=2; auth event is Buyer Onboarding step 1, so no device-only prefix)`;
					if (uid < 0.9) return { verdict: "INVERSE", detail };
					if (uid === 1 && dev >= 0.99 && dpu >= 1.7 && dpu <= 2.4) return { verdict: "NAILED", detail };
					if (uid >= 0.999 && dev >= 0.98) return { verdict: "STRONG", detail };
					return { verdict: "WEAK", detail };
				},
			},
		],
	},
];
