// ── IMPORTS ──
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);
import "dotenv/config";
import * as u from "@ak--47/dungeon-master/utils";
import * as v from "ak-tools";
import { findFirstSequence, scaleFunnelTTC } from "@ak--47/dungeon-master/hook-helpers";
/** @typedef  {import("../../../types").Dungeon} Config */

// ── OVERVIEW ──
/*
 * NAME:       QuickBite
 * APP:        Food delivery platform (DoorDash/Uber Eats style). Users browse
 *             restaurants, build carts, place orders, track deliveries, and
 *             rate their experiences. Monetization via delivery fees,
 *             QuickBite+ subscription, and promotional coupons.
 * SCALE:      10,000 users, ~1.0M events, 121 days (2026-01-01 → 2026-05-01)
 * CORE LOOP:  sign up → browse/search → add to cart → checkout → order placed → track → rate → reorder
 *
 * EVENTS (17):
 *   restaurant browsed (18) > restaurant viewed (15) > item added to cart (14)
 *   > order tracked (13) > checkout started (12) > search performed (11)
 *   > order placed (10) > order delivered (9) > promotion viewed (8)
 *   > order rated (7) > reorder initiated (6) > item removed from cart (5)
 *   > coupon applied (4) > support ticket (3) > subscription started (2)
 *   > subscription cancelled (1) > account created (1)
 *
 * FUNNELS (8):
 *   - Onboarding:         account created → restaurant browsed → restaurant viewed (80%)
 *   - Browse Discovery:   restaurant browsed → restaurant viewed → item added to cart (55%)
 *   - Search Ordering:    search performed → restaurant viewed → item added to cart → checkout started (45%)
 *   - Order Lifecycle:    checkout started → order placed → order tracked → order delivered (65%)
 *   - Reorder Loop:       order delivered → order rated → reorder initiated (40%)
 *   - Promo Flow:         promotion viewed → coupon applied → checkout started (50%)
 *   - Support Flow:       support ticket → order rated (45%)
 *   - Subscription Mgmt:  subscription started → order placed → subscription cancelled (20%)
 *
 * USER PROPS:  preferred_cuisine, avg_order_value, orders_per_month, favorite_restaurant_count, Platform, subscription_tier, city
 * SUPER PROPS: Platform, subscription_tier, city
 * SCD PROPS:   subscription_tier (free/trial/monthly/annual, monthly fuzzy, max 6),
 *              restaurant_tier (new/verified/featured/premium, monthly fixed, max 6, type=restaurant_id)
 * GROUPS:      restaurant_id (200 restaurants; restaurant viewed / order placed / order rated)
 */

// ── HOOK STORIES ──
/*
 * NOTE: All cohort effects are HIDDEN — no flag stamping. Discoverable only via
 * behavioral cohorts or raw-prop breakdowns (HOD, day, segment).
 *
 * ───────────────────────────────────────────────────────────────────────────────
 * H1. LUNCH/DINNER RUSH (everything)
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: 30% of "order delivered" events that fall outside meal-hour
 * windows (11-13 UTC and 17-20 UTC) are dropped, depressing non-meal-time
 * completion. Mutation: event drop. Discover via order delivered HOD chart.
 *
 * MEASURABLE SIGNATURE: raw HOD volume is soup-confounded (the engine's hour
 * distribution is not flat), so the clean read is a ratio-of-ratios:
 * delivered-per-placed off-hours ÷ delivered-per-placed rush-hours ≈ 0.70
 * (the keep rate). "order placed" shares the soup HOD and is untouched by
 * H1; H7's drop is hour-independent so it cancels too.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Order Delivered Volume by Hour of Day
 *   - Report type: Insights
 *   - Event: "order delivered"
 *   - Measure: Total
 *   - Breakdown: Hour of day
 *   - Expected: 11-13 and 17-20 stand ~1.4x above neighboring hours
 *
 * REAL-WORLD ANALOGUE: Meal-hour orders convert at higher rates.
 *
 * ───────────────────────────────────────────────────────────────────────────────
 * H2. COUPON INJECTION (everything)
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: Free-tier users get extra "coupon applied" events cloned into the
 * stream near checkout (30% chance per checkout). Cloned with unique offset
 * timestamps. No flag.
 *
 * MEASURABLE SIGNATURE: coupons-per-checkout(Free) − coupons-per-checkout(QB+)
 * ≈ +0.30 — the injection likelihood recovered directly. Organic coupons/user
 * is tier-independent (~3.1); Free users average ~13 checkouts, so total
 * coupons/user lands near 7.0 for Free vs 3.1 for QB+ — a ~2.0-2.5x ratio
 * (NOT the ~1.3x an additive-percentage intuition suggests: 30% of 13
 * checkouts more than doubles the organic coupon count).
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Coupons per User by Tier
 *   - Report type: Insights
 *   - Event: "coupon applied"
 *   - Measure: Total per user
 *   - Breakdown: "subscription_tier"
 *   - Expected: Free ~ 2.0-2.5x QuickBite+
 *
 * REAL-WORLD ANALOGUE: Free-tier users are the target of coupon promos.
 *
 * ───────────────────────────────────────────────────────────────────────────────
 * H3. LATE NIGHT MUNCHIES (everything)
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: 10PM-2AM UTC: 70% of "restaurant viewed" / "item added to cart"
 * events get cuisine_type flipped to American, item_price bumped 1.3x
 * (price bump is unconditional in the window; the flip is the 70% coin).
 * Mutates existing props. No flag — discover via HOD breakdown.
 *
 * MEASURABLE SIGNATURE: organic American share is ~0.16 (engine's pick is
 * not uniform over the 8 cuisines), hour-independent — "restaurant browsed"
 * (never flipped) confirms it at any hour. Late-night viewed share
 * = 0.70 + 0.30 × organic ≈ 0.75. Inverting recovers the knob exactly:
 * (late_share − off_share) / (1 − off_share) ≈ 0.70. Late-night
 * item_price ≈ 1.3x off-hours item_price.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Cuisine Distribution by Hour of Day
 *   - Report type: Insights
 *   - Event: "restaurant viewed"
 *   - Measure: Total
 *   - Breakdown: "cuisine_type"
 *   - Filter: hour 22-02
 *   - Expected: American share ~75% vs ~16% off-hours
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
 * H4. RAINY WEEK SURGE (everything)
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: Days 20-27 (Jan 21-28, inclusive), "order placed" delivery_fee
 * doubled and 40% of in-window order-placed events get a duplicate cloned
 * event with a 5-60 min offset. No flag — discover via line chart by day on
 * order placed volume + delivery_fee average.
 *
 * MEASURABLE SIGNATURE: the cleanest read is the duplicate share itself —
 * in-window (uid, order_id) pairs appearing twice ÷ distinct orders ≈ 0.40
 * (duplicates are byte-identical clones except a 5-60 min time offset).
 * Volume: raw daily counts drift with the soup, so use a ratio-of-ratios
 * against "checkout started" (same soup, untouched by H4):
 * (placed_win/placed_base) ÷ (checkout_win/checkout_base) ≈ 1.40, diluted a
 * few percent by H6-churned users whose window orders were deleted. Fee:
 * window avg ≈ 2.0x baseline avg (±5% wobble from the window's organic fee
 * draw; the `(fee || 5)` fallback is inert in practice — the fee pool
 * bottoms out at 1, never 0). Duplicates share the doubled fee (cloned
 * after the fee pass).
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Order Volume Over Time
 *   - Report type: Insights
 *   - Event: "order placed"
 *   - Measure: Total
 *   - Line chart by day
 *   - Expected: visible ~1.4x spike days 20-27
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
 * H5. REFERRAL POWER USERS (everything)
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: Users with referral_code=true on account-created event (~1/3 of
 * born-in users) get food_rating boosted to 4-5 and ~50% of their reorder
 * events cloned with a 1-7 day offset. Mutates existing prop, no flag.
 *
 * MEASURABLE SIGNATURE: cohort is only identifiable among born-in-dataset
 * users (pre-existing users have no account-created event) — compare within
 * born-ins. Reorders/user referred ÷ non-referred ≈ 1.4 (50% clone chance
 * per visited reorder; clones spliced at idx+1 are re-visited and can
 * re-clone, but tail events shifted past the original loop range are
 * skipped, so the net multiplier sits below a naive 1.5; the referred
 * cohort is ~1/3 of born-ins, so expect ±0.1 sampling wobble). Same range
 * truncation leaves some "order rated" events unboosted: referred avg
 * food_rating ≈ 4.4 (not a full 4.5) vs organic ≈ 2.8.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Reorders per User by Referral Cohort
 *   - Report type: Insights (with cohort)
 *   - Cohort A: users with account-created.referral_code=true
 *   - Cohort B: users with account-created.referral_code=false
 *   - Event: "reorder initiated"
 *   - Measure: Total per user
 *   - Expected: A ~ 1.4-1.5x B
 *
 * REAL-WORLD ANALOGUE: Referred users tend to be more loyal.
 *
 * ───────────────────────────────────────────────────────────────────────────────
 * H6. TRIAL CONVERSION (everything)
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: Users with subscription-started.trial=true who place <3 orders in
 * their first 14 days: 60% of those users (per-user coin, all-or-nothing)
 * have ALL events after day 14 deleted. No flag.
 *
 * MEASURABLE SIGNATURE: the deletion removes the subscription-started event
 * itself whenever it fired after day 14, so churned users with a late trial
 * start VANISH from the visible trial cohort (survivor bias). The honest
 * observable: among visible trial users, share with zero post-day-14
 * activity ≈ 0.25 for non-activated (<3 early orders) vs ≈ 0.04 for
 * activated — a ~5-7x retention divergence. Do NOT read per-user post/pre
 * event ratios: activation (≥3 early orders) selects for front-loaded
 * activity and confounds the comparison.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Retention by Trial Order Count
 *   - Report type: Retention
 *   - Cohort A: trial users with >= 3 orders in first 14 days
 *   - Cohort B: trial users with < 3
 *   - Expected: B shows a sharp cliff after day 14; A retains normally
 *
 * REAL-WORLD ANALOGUE: Trial users who fail to activate churn fast.
 *
 * ───────────────────────────────────────────────────────────────────────────────
 * H7. FIRST ORDER BONUS (everything)
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: ~50% of users (deterministic: first char of user_id has odd
 * char code → "returning") have 30% of their "order delivered" events
 * dropped. No flag — analyst sees segment-level completion gap via cohort
 * builder by hash bucket.
 *
 * MEASURABLE SIGNATURE: delivered-per-placed (odd bucket) ÷
 * delivered-per-placed (even bucket) ≈ 0.70 — the keep rate recovered.
 * "order placed" is untouched by H7 and normalizes engagement; H1's drop is
 * hash-independent and cancels in the ratio.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Order Delivered Conversion by First-Letter-Hash
 *   - Report type: Funnels
 *   - Steps: "checkout started" -> "order placed" -> "order delivered"
 *   - Breakdown: derived hash bucket on distinct_id
 *   - Expected: odd bucket ~ 30% lower conversion on final step
 *
 * REAL-WORLD ANALOGUE: First-order promos lift new-user conversion.
 *
 * ───────────────────────────────────────────────────────────────────────────────
 * H8. ORDER-COUNT MAGIC NUMBER (everything)
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: Users in the 4-8 order-placed sweet spot get +40% on order_total.
 * Users with 9+ orders are over-engaged; their order_total is reduced to
 * 0.65x (basket fatigue). No flag — discover by binning users on order count.
 *
 * MEASURABLE SIGNATURE: the hook buckets on the order count at hook time,
 * BEFORE H4 duplication and H6 deletion — output-count bucketing is
 * contaminated at the edges (an H6-churned 9+ user lands in the 0-3 output
 * bucket carrying 0.65x totals; an H4-duplicated 8-order user lands in 9+
 * carrying 1.4x). Clean read restricts to users unaffected by both: alive
 * past day 14 AND zero rainy-window orders. On that population:
 * sweet/base avg order_total ≈ 1.4, over/sweet ≈ 0.46 (= 0.65/1.4).
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
 *   Report 2: Avg Order Total on Heavy Orderers
 *   - Report type: Insights (with cohort)
 *   - Cohort C: users with >= 9 "order placed"
 *   - Cohort A: users with 4-8
 *   - Event: "order placed"
 *   - Measure: Average of "order_total"
 *   - Expected: C ~ 0.46x order_total vs A (0.65x cut on a 1.4x-boosted
 *     comparison group)
 *
 * REAL-WORLD ANALOGUE: Engaged orderers lift basket size; over-orderers
 * hit fatigue and slow down.
 *
 * ───────────────────────────────────────────────────────────────────────────────
 * H9. ORDER LIFECYCLE TTC (everything)
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: QuickBite+ users get delivery timing properties scaled 0.67x
 * (faster), Free users get 1.4x (slower). Affects actual_delivery_mins,
 * eta_mins, delivery_time_est_mins on every event carrying them, plus a
 * timestamp compression on the user's FIRST checkout→placed→tracked→delivered
 * sequence (visible in Mixpanel's per-instance funnel TTC).
 *
 * MEASURABLE SIGNATURE: property ratio QB+/Free ≈ 0.48 (= 0.67/1.4) on
 * avg actual_delivery_mins and avg eta_mins. The timestamp shift touches
 * only one funnel instance among a user's ~13 checkouts, so cross-event
 * SQL/JS TTC aggregations CANNOT see it — do not assert wall-clock TTC
 * outside Mixpanel's per-instance funnel report.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Avg Delivery Time by Subscription Tier
 *   - Report type: Insights
 *   - Event: "order delivered"
 *   - Measure: Average of "actual_delivery_mins"
 *   - Breakdown: "subscription_tier"
 *   - Expected: QuickBite+ ~ 0.48x Free
 *
 *   Report 2: Avg ETA by Subscription Tier
 *   - Report type: Insights
 *   - Event: "order tracked"
 *   - Measure: Average of "eta_mins"
 *   - Breakdown: "subscription_tier"
 *   - Expected: QuickBite+ ~ 0.48x Free
 *
 * REAL-WORLD ANALOGUE: Premium subscribers get priority dispatch and faster
 * delivery routing.
 *
 * ───────────────────────────────────────────────────────────────────────────────
 * H10. CITY DENSITY REORDER BOOST (funnel-pre)
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: On the reorder funnel (order delivered → order rated → reorder
 * initiated), dense cities (SF, NYC) get conversionRate 40 → 56; sprawl
 * cities (Houston, Phoenix) 40 → 28. Scoped to the funnel containing
 * "reorder initiated".
 *
 * MEASURABLE SIGNATURE: non-converted instances take u.integer(1, steps−1)
 * steps (determineConversion, lib/generators/funnels.js) — the LAST step
 * fires only on conversion, so P(reorder per instance) = conversionRate
 * exactly. Delivered-per-user is city-flat (H1/H7 drops are
 * city-independent), so reorders-per-DELIVERED recovers the knobs exactly:
 * dense/base = 1.40, sprawl/base = 0.70. Plain reorders-per-user shows the
 * same direction but carries per-city engagement noise. H5's referral
 * cloning is city-independent and scales all cities equally.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Reorder Funnel Conversion by City
 *   - Report type: Funnels
 *   - Steps: "order delivered" → "order rated" → "reorder initiated"
 *   - Breakdown: "city"
 *   - Expected: SF / NYC above baseline; Houston / Phoenix below
 *
 * REAL-WORLD ANALOGUE: Dense cities have more restaurant choice and
 * faster delivery, driving higher repeat ordering behavior.
 *
 * ───────────────────────────────────────────────────────────────────────────────
 * EXPECTED METRICS SUMMARY
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * Hook | Metric                                    | Mechanism | Measured (10K)
 * ─────|-------------------------------------------|-----------|---------------
 * H1   | delivered-per-placed off/rush RoR         | 0.70      | 0.701
 * H2   | coupons-per-checkout diff (Free − QB+)    | +0.30     | +0.293
 * H2   | coupons/user Free ÷ QB+                   | ~2.0-2.5  | 2.155
 * H3   | flip-rate inversion (late−off)/(1−off)    | 0.70      | 0.704
 * H3   | late/off item_price ratio                 | 1.30      | 1.290
 * H4   | in-window duplicate share                 | 0.40      | 0.397
 * H4   | placed vol RoR vs checkout (win/base)     | ~1.40     | 1.391
 * H4   | delivery_fee window/baseline avg          | ~2.0      | 1.976
 * H5   | born-in reorders/user ref ÷ non-ref       | ~1.4      | 1.647 (STRONG; 2K iters read 1.34/1.45 — clone-cascade truncation is user-mix-sensitive, cohort n=379)
 * H5   | referred avg food_rating (vs organic ~2.8)| ~4.4      | 4.47 / 2.72
 * H6   | zero-post-day-14 share nonact vs act      | ~0.25/0.04| 0.238 / 0.050 (STRONG; divergence 4.7x — act share is the organic quiet rate, not a knob)
 * H7   | delivered-per-placed odd ÷ even           | 0.70      | 0.703
 * H8   | clean-pop sweet/base order_total          | 1.40      | 1.402
 * H8   | clean-pop over/sweet order_total          | 0.46      | 0.465
 * H9   | actual_delivery_mins QB+ ÷ Free           | 0.48      | 0.479
 * H9   | eta_mins QB+ ÷ Free                       | 0.48      | 0.476
 * H10  | reorders-per-delivered dense ÷ base       | 1.40      | 1.369
 * H10  | reorders-per-delivered sprawl ÷ base      | 0.70      | 0.716
 */

// ── SCALE ──
const SEED = "harness-food";
const NUM_USERS = 10_000;
const DATASET_START = "2026-01-01T00:00:00Z";
const DATASET_END = "2026-05-01T23:59:59Z";
const EVENTS_PER_DAY = 1.2;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── KNOBS (tweak these to reshape stories) ──
const RUSH_DROP_LIKELIHOOD = 30;
const RUSH_LUNCH_START = 11;
const RUSH_LUNCH_END = 13;
const RUSH_DINNER_START = 17;
const RUSH_DINNER_END = 20;

const COUPON_INJECT_LIKELIHOOD = 30;

const LATE_NIGHT_START = 22;
const LATE_NIGHT_END = 2;
const LATE_NIGHT_FLIP_LIKELIHOOD = 70;
const LATE_NIGHT_PRICE_MULT = 1.3;

const RAINY_START_DAY = 20;
const RAINY_END_DAY = 27;
const RAINY_FEE_MULT = 2;
const RAINY_DUP_LIKELIHOOD = 40;

const REFERRAL_CLONE_LIKELIHOOD = 50;
const REFERRAL_RATING_MIN = 4;
const REFERRAL_RATING_MAX = 5;

const TRIAL_EARLY_DAYS = 14;
const TRIAL_MIN_ORDERS = 3;
const TRIAL_DROP_LIKELIHOOD = 60;

const FIRST_ORDER_DROP_LIKELIHOOD = 30;

const ORDER_SWEET_MIN = 4;
const ORDER_SWEET_MAX = 8;
const ORDER_OVER_THRESHOLD = 9;
const ORDER_SWEET_BOOST = 1.4;
const ORDER_OVER_FACTOR = 0.65;

const TTC_QB_PLUS_FACTOR = 0.67;
const TTC_FREE_FACTOR = 1.4;

const CITY_DENSE_MULT = 1.4;
const CITY_SPRAWL_MULT = 0.7;

// ── DATA ARRAYS ──
const restaurantIds = v.range(1, 201).map(n => `rest_${v.uid(6)}`);
const itemIds = v.range(1, 301).map(n => `item_${v.uid(7)}`);
const orderIds = v.range(1, 5001).map(n => `order_${v.uid(8)}`);
const couponCodes = v.range(1, 51).map(n => `QUICK${v.uid(5).toUpperCase()}`);

// ── HELPER FUNCTIONS ──
function handleFunnelPreHooks(record, meta) {
	// H10: CITY DENSITY REORDER BOOST — dense cities 1.4x; sprawl 0.7x
	// on the reorder funnel.
	const isReorderFunnel = meta.funnel?.sequence?.includes("reorder initiated");
	if (isReorderFunnel) {
		const city = meta.profile?.city;
		if (city === "San Francisco" || city === "New York") {
			record.conversionRate = Math.min(95, Math.round(record.conversionRate * CITY_DENSE_MULT));
		} else if (city === "Houston" || city === "Phoenix") {
			record.conversionRate = Math.round(record.conversionRate * CITY_SPRAWL_MULT);
		}
	}
	return record;
}

function handleEverythingHooks(record, meta) {
	// UTC mode is load-bearing: dayjs.unix() returns a LOCAL-mode instance, and
	// local .add(N, "days") does calendar-day arithmetic — it slips 1h across the
	// March-8-2026 DST spring-forward and makes every derived boundary (rainy
	// window, trial day-14 cutoff) depend on the host timezone, breaking the
	// seeded-determinism contract. Same fix as real-estate / insurance.
	const datasetStart = dayjs.unix(meta.datasetStart).utc();
	const RAINY_WEEK_START = datasetStart.add(RAINY_START_DAY, 'days');
	// END_DAY + 1 because the gate below is `isBefore(end)`: with end at the
	// START of day 27, day 27's events fell outside the window and the doc's
	// "days 20-27" only covered 20-26. End at start-of-day-28 makes day 27
	// (the last rainy day) inclusive.
	const RAINY_WEEK_END = datasetStart.add(RAINY_END_DAY + 1, 'days');
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

	// H9: ORDER LIFECYCLE TTC — QuickBite+ 0.67x, Free 1.4x on delivery
	// timing properties + funnel timestamp shift.
	if (profile) {
		const tier = profile.subscription_tier;
		const ttcFactor = (
			tier === "QuickBite+" ? TTC_QB_PLUS_FACTOR :
			tier === "Free" ? TTC_FREE_FACTOR :
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

	// H3: LATE NIGHT MUNCHIES — 22-02 UTC: 70% flip to American, 1.3x price
	userEvents.forEach(e => {
		if (e.event === "restaurant viewed" || e.event === "item added to cart") {
			const hour = new Date(e.time).getUTCHours();
			const isLateNight = hour >= LATE_NIGHT_START || hour <= LATE_NIGHT_END;
			if (isLateNight) {
				if (e.cuisine_type !== undefined && chance.bool({ likelihood: LATE_NIGHT_FLIP_LIKELIHOOD })) {
					e.cuisine_type = "American";
				}
				if (e.item_price !== undefined) {
					e.item_price = Math.round(e.item_price * LATE_NIGHT_PRICE_MULT * 100) / 100;
				}
			}
		}
	});

	// H2: COUPON INJECTION — Free-tier users get coupon-applied events
	// spliced near checkout. Cloned from existing template with unique offset.
	if (profile && profile.subscription_tier === "Free") {
		for (let i = userEvents.length - 1; i >= 1; i--) {
			const evt = userEvents[i];
			if (evt.event === "checkout started" && chance.bool({ likelihood: COUPON_INJECT_LIKELIHOOD })) {
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
				// The checkout-event fallback template carries checkout-only props;
				// strip them so injected coupons match the declared coupon schema.
				delete couponEvent.cart_total;
				delete couponEvent.items_count;
				delete couponEvent.delivery_address_saved;
				userEvents.splice(i, 0, couponEvent);
			}
		}
	}

	// H1: LUNCH/DINNER RUSH — drop 30% of order-delivered events outside
	// meal windows (11-13 UTC and 17-20 UTC).
	for (let i = userEvents.length - 1; i >= 0; i--) {
		const event = userEvents[i];
		if (event.event === "order delivered") {
			const hour = new Date(event.time).getUTCHours();
			const inRush = (hour >= RUSH_LUNCH_START && hour <= RUSH_LUNCH_END) || (hour >= RUSH_DINNER_START && hour <= RUSH_DINNER_END);
			if (!inRush && chance.bool({ likelihood: RUSH_DROP_LIKELIHOOD })) {
				userEvents.splice(i, 1);
			}
		}
	}

	// H7: FIRST ORDER BONUS — hash-based ~50% of users (returning) drop
	// 30% of order delivered events. New users keep all.
	const hashUser = userEvents[0] && userEvents[0].user_id;
	const isNewUser = typeof hashUser === "string" && hashUser.charCodeAt(0) % 2 === 0;
	if (!isNewUser) {
		for (let i = userEvents.length - 1; i >= 0; i--) {
			if (userEvents[i].event === "order delivered" && chance.bool({ likelihood: FIRST_ORDER_DROP_LIKELIHOOD })) {
				userEvents.splice(i, 1);
			}
		}
	}

	// First pass: identify behavioral patterns (no flags written)
	let isReferralUser = false;
	let hasTrialSubscription = false;
	let earlyOrderCount = 0;
	let orderPlacedCount = 0;
	const firstEventTime = userEvents.length > 0 ? dayjs.utc(userEvents[0].time) : null;

	userEvents.forEach((event) => {
		const eventTime = dayjs.utc(event.time);
		const daysSinceStart = firstEventTime ? eventTime.diff(firstEventTime, 'days', true) : 0;
		if (event.event === "account created" && event.referral_code === true) isReferralUser = true;
		if (event.event === "subscription started" && event.trial === true) hasTrialSubscription = true;
		if (event.event === "order placed") {
			orderPlacedCount++;
			if (daysSinceStart <= TRIAL_EARLY_DAYS) earlyOrderCount++;
		}
	});

	// H5: REFERRAL POWER USERS — boost food rating to 4-5, clone reorders.
	userEvents.forEach((event, idx) => {
		if (isReferralUser && event.event === "order rated") {
			event.food_rating = chance.integer({ min: REFERRAL_RATING_MIN, max: REFERRAL_RATING_MAX });
		}
		if (isReferralUser && event.event === "reorder initiated" && chance.bool({ likelihood: REFERRAL_CLONE_LIKELIHOOD })) {
			const eventTime = dayjs.utc(event.time);
			userEvents.splice(idx + 1, 0, {
				...event,
				time: eventTime.add(chance.integer({ min: 1, max: 7 }), 'days').toISOString(),
				user_id: event.user_id,
				order_id: chance.pickone(orderIds),
				original_order_age_days: chance.integer({ min: 3, max: 30 }),
			});
		}
	});

	// H6: TRIAL CONVERSION — trial subs with <3 early orders drop 60% of
	// post-day-14 events.
	if (hasTrialSubscription && earlyOrderCount < TRIAL_MIN_ORDERS && chance.bool({ likelihood: TRIAL_DROP_LIKELIHOOD })) {
		const trialCutoff = firstEventTime ? firstEventTime.add(TRIAL_EARLY_DAYS, 'days') : null;
		if (trialCutoff) {
			for (let i = userEvents.length - 1; i >= 0; i--) {
				if (dayjs.utc(userEvents[i].time).isAfter(trialCutoff)) {
					userEvents.splice(i, 1);
				}
			}
		}
	}

	// H4: RAINY WEEK SURGE — days 20-27, double delivery_fee on order-placed.
	userEvents.forEach(e => {
		if (e.event === "order placed") {
			const t = dayjs.utc(e.time);
			if (t.isAfter(RAINY_WEEK_START) && t.isBefore(RAINY_WEEK_END)) {
				e.delivery_fee = (e.delivery_fee || 5) * RAINY_FEE_MULT;
			}
		}
	});

	// H4 (cont): RAINY WEEK SURGE — duplicate 40% of order-placed events
	// in the rainy window. Cloned with unique offset.
	const rainyDuplicates = [];
	userEvents.forEach((event) => {
		if (event.event === "order placed") {
			const t = dayjs.utc(event.time);
			if (t.isAfter(RAINY_WEEK_START) && t.isBefore(RAINY_WEEK_END) && chance.bool({ likelihood: RAINY_DUP_LIKELIHOOD })) {
				const dup = JSON.parse(JSON.stringify(event));
				dup.time = t.add(chance.integer({ min: 5, max: 60 }), 'minutes').toISOString();
				rainyDuplicates.push(dup);
			}
		}
	});
	if (rainyDuplicates.length > 0) userEvents.push(...rainyDuplicates);

	// H8: ORDER-COUNT MAGIC NUMBER — sweet 4-8 → +40% on order_total;
	// over 9+ → 0.65x order_total (basket fatigue). No flag.
	if (orderPlacedCount >= ORDER_SWEET_MIN && orderPlacedCount <= ORDER_SWEET_MAX) {
		userEvents.forEach(e => {
			if (e.event === "order placed" && typeof e.order_total === "number") {
				e.order_total = Math.round(e.order_total * ORDER_SWEET_BOOST);
			}
		});
	} else if (orderPlacedCount >= ORDER_OVER_THRESHOLD) {
		userEvents.forEach(e => {
			if (e.event === "order placed" && typeof e.order_total === "number") {
				e.order_total = Math.round(e.order_total * ORDER_OVER_FACTOR);
			}
		});
	}

	return userEvents;
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
			isStrictEvent: false,
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
			isStrictEvent: false,
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
			isStrictEvent: false,
			properties: {
				"coupon_code": couponCodes,
				"discount_type": ["percent", "flat", "free_delivery"],
				"discount_value": u.weighNumRange(5, 50, 1.2, 20),
			}
		},
		{
			event: "checkout started",
			weight: 12,
			isStrictEvent: false,
			properties: {
				"cart_total": u.weighNumRange(8, 150, 0.8, 40),
				"items_count": u.weighNumRange(1, 8, 1.2, 20),
				"delivery_address_saved": [false, false, false, true, true, true, true, true, true, true],
			}
		},
		{
			event: "order placed",
			weight: 10,
			isStrictEvent: false,
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
			isStrictEvent: false,
			properties: {
				"order_id": orderIds,
				"actual_delivery_mins": u.weighNumRange(12, 90, 1.0, 40),
				"on_time": [false, false, false, true, true, true, true, true, true, true],
			}
		},
		{
			event: "order rated",
			weight: 7,
			isStrictEvent: false,
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
			isStrictEvent: false,
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
			isStrictEvent: false,
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

	hook(record, type, meta) {
		if (type === "funnel-pre") return handleFunnelPreHooks(record, meta);
		if (type === "everything") return handleEverythingHooks(record, meta);
		return record;
	}
};

export default config;

// ── STORIES ──
// Machine-checkable contract for the 10 numbered hooks above. Evaluated by
// ./food-delivery.verify.mjs (thin wrapper) or scripts/verify-stories.mjs.
// All breakdowns are DuckDB: every read here is a ratio-of-ratios or a
// behavioral-cohort aggregation that the emulator's breakdown types don't
// model. Bands center on MECHANISM numbers derived in each hook's
// MEASURABLE SIGNATURE block; scale guards return WEAK below full fidelity.

const EV_CTE = `
ev AS (SELECT e.user_id::VARCHAR AS uid, e.time::TIMESTAMP AS t,
       hour(e.time::TIMESTAMP) AS hr,
       date_diff('day', TIMESTAMP '2026-01-01 00:00:00', e.time::TIMESTAMP) AS day_idx, e.*
FROM read_json_auto('{{PREFIX}}-EVENTS*.json', sample_size=-1, union_by_name=true) e)`;

/**
 * Band verdict helper: NAILED inside the tight band, STRONG inside the wide
 * band, INVERSE when the caller's inversion predicate fires, else WEAK.
 * @param {number} x
 * @param {[number, number]} nailed
 * @param {[number, number]} strong
 * @param {string} detail
 * @param {boolean} [inverse]
 */
function bandVerdict(x, nailed, strong, detail, inverse = false) {
	if (Number.isFinite(x) && x >= nailed[0] && x <= nailed[1]) return { verdict: "NAILED", detail };
	if (Number.isFinite(x) && x >= strong[0] && x <= strong[1]) return { verdict: "STRONG", detail };
	if (inverse) return { verdict: "INVERSE", detail };
	return { verdict: "WEAK", detail };
}

export const stories = [
	{
		id: "H1-rush-keep-rate",
		hook: "H1",
		archetype: "bespoke",
		narrative:
			"30% of order-delivered events outside 11-13/17-20 UTC are dropped. Raw HOD volume is " +
			"soup-confounded, so the read is delivered-per-placed off-hours ÷ delivered-per-placed " +
			"rush-hours ≈ 0.70 — 'order placed' shares the soup HOD and is untouched by H1, and " +
			"H7's drop is hour-independent, so both cancel. Measured 0.699 at 2K.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${EV_CTE},
agg AS (SELECT (hr BETWEEN 11 AND 13) OR (hr BETWEEN 17 AND 20) AS rush,
  count(*) FILTER (WHERE event='order delivered')::BIGINT AS del,
  count(*) FILTER (WHERE event='order placed')::BIGINT AS placed
FROM ev WHERE event IN ('order delivered','order placed') GROUP BY 1)
SELECT max(CASE WHEN NOT rush THEN del::DOUBLE/placed END) /
       max(CASE WHEN rush THEN del::DOUBLE/placed END) AS ror,
  max(CASE WHEN rush THEN del END)::BIGINT AS del_rush,
  max(CASE WHEN NOT rush THEN del END)::BIGINT AS del_off
FROM agg`,
				},
				assert: (rows) => {
					const r = rows?.[0];
					if (!r || Number(r.del_rush) < 10000 || Number(r.del_off) < 20000) {
						return { verdict: "WEAK", detail: `volume too small: del_rush=${r?.del_rush ?? 0} del_off=${r?.del_off ?? 0}` };
					}
					const x = Number(r.ror);
					return bandVerdict(x, [0.65, 0.75], [0.60, 0.80],
						`delivered-per-placed off/rush RoR=${x.toFixed(3)} (mech 0.70; del_rush=${r.del_rush} del_off=${r.del_off})`,
						x > 1.0);
				},
			},
		],
	},
	{
		id: "H2-coupon-injection",
		hook: "H2",
		archetype: "cohort-count-scale",
		narrative:
			"Free-tier users get a coupon-applied clone spliced before 30% of checkouts. Exact " +
			"knob recovery: coupons-per-checkout(Free) − coupons-per-checkout(QB+) ≈ +0.30. " +
			"Organic coupons/user is tier-independent (~3.1) and Free users average ~13 checkouts, " +
			"so total coupons/user ratio lands at ~2.2 (NOT 1.3x — 30% of 13 checkouts more than " +
			"doubles the organic count). Measured diff 0.296, ratio 2.19 at 2K.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${EV_CTE},
pu AS (SELECT uid, any_value(subscription_tier) AS tier,
  count(*) FILTER (WHERE event='coupon applied') AS coupons,
  count(*) FILTER (WHERE event='checkout started') AS checkouts
FROM ev WHERE event IN ('coupon applied','checkout started') GROUP BY 1)
SELECT tier, count(*)::BIGINT AS users,
  sum(coupons)::DOUBLE/count(*) AS cpu,
  sum(coupons)::DOUBLE/nullif(sum(checkouts),0) AS cpc
FROM pu GROUP BY tier ORDER BY tier`,
				},
				assert: (rows) => {
					const free = rows?.find(r => r.tier === "Free");
					const plus = rows?.find(r => r.tier === "QuickBite+");
					if (!free || !plus || Number(free.users) < 4000 || Number(plus.users) < 900) {
						return { verdict: "WEAK", detail: `cohorts too small: free=${free?.users ?? 0} plus=${plus?.users ?? 0}` };
					}
					const diff = Number(free.cpc) - Number(plus.cpc);
					return bandVerdict(diff, [0.26, 0.34], [0.22, 0.38],
						`coupons-per-checkout diff=${diff.toFixed(3)} (mech +0.30; Free=${Number(free.cpc).toFixed(3)} QB+=${Number(plus.cpc).toFixed(3)})`,
						diff < 0);
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${EV_CTE},
pu AS (SELECT uid, any_value(subscription_tier) AS tier,
  count(*) FILTER (WHERE event='coupon applied') AS coupons
FROM ev WHERE event IN ('coupon applied','checkout started') GROUP BY 1)
SELECT tier, count(*)::BIGINT AS users, sum(coupons)::DOUBLE/count(*) AS cpu
FROM pu GROUP BY tier ORDER BY tier`,
				},
				assert: (rows) => {
					const free = rows?.find(r => r.tier === "Free");
					const plus = rows?.find(r => r.tier === "QuickBite+");
					if (!free || !plus || Number(free.users) < 4000 || Number(plus.users) < 900) {
						return { verdict: "WEAK", detail: `cohorts too small: free=${free?.users ?? 0} plus=${plus?.users ?? 0}` };
					}
					const ratio = Number(free.cpu) / Number(plus.cpu);
					return bandVerdict(ratio, [1.9, 2.6], [1.7, 2.9],
						`coupons/user Free÷QB+=${ratio.toFixed(3)} (mech ~2.2; Free=${Number(free.cpu).toFixed(2)} QB+=${Number(plus.cpu).toFixed(2)})`,
						ratio < 1.0);
				},
			},
		],
	},
	{
		id: "H3-late-night-flip",
		hook: "H3",
		archetype: "composition-drift",
		narrative:
			"22:00-02:59 UTC: 70% of restaurant-viewed/cart events flip cuisine_type to American; " +
			"item_price bumped 1.3x unconditionally in the window. Organic American share is ~0.16 " +
			"(engine's pick is non-uniform), hour-independent — 'restaurant browsed' (never " +
			"flipped) is the control. Inverting the mix equation recovers the knob: " +
			"(late_share − off_share)/(1 − off_share) ≈ 0.70. Measured 0.705 and price 1.281 at 2K.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${EV_CTE}
SELECT avg((cuisine_type='American')::INT) FILTER (WHERE event='restaurant viewed' AND (hr>=22 OR hr<=2)) AS late_share,
  avg((cuisine_type='American')::INT) FILTER (WHERE event='restaurant viewed' AND hr BETWEEN 6 AND 18) AS off_share,
  avg((cuisine_type='American')::INT) FILTER (WHERE event='restaurant browsed') AS organic_share,
  count(*) FILTER (WHERE event='restaurant viewed' AND (hr>=22 OR hr<=2))::BIGINT AS n_late
FROM ev WHERE event IN ('restaurant viewed','restaurant browsed')`,
				},
				assert: (rows) => {
					const r = rows?.[0];
					if (!r || Number(r.n_late) < 10000) {
						return { verdict: "WEAK", detail: `late-night views too few: n_late=${r?.n_late ?? 0}` };
					}
					const off = Number(r.off_share);
					const organic = Number(r.organic_share);
					if (organic < 0.10 || organic > 0.22) {
						return { verdict: "WEAK", detail: `organic American share ${organic.toFixed(3)} outside expected [0.10,0.22] — derivation baseline broken` };
					}
					const flip = (Number(r.late_share) - off) / (1 - off);
					return bandVerdict(flip, [0.65, 0.75], [0.60, 0.80],
						`flip-rate inversion=${flip.toFixed(3)} (mech 0.70; late=${Number(r.late_share).toFixed(3)} off=${off.toFixed(3)} organic=${organic.toFixed(3)})`,
						flip < 0);
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${EV_CTE}
SELECT avg(TRY_CAST(item_price AS DOUBLE)) FILTER (WHERE hr>=22 OR hr<=2) /
       avg(TRY_CAST(item_price AS DOUBLE)) FILTER (WHERE hr BETWEEN 6 AND 18) AS price_ratio,
  count(*) FILTER (WHERE hr>=22 OR hr<=2)::BIGINT AS n_late
FROM ev WHERE event='item added to cart'`,
				},
				assert: (rows) => {
					const r = rows?.[0];
					if (!r || Number(r.n_late) < 10000) {
						return { verdict: "WEAK", detail: `late-night carts too few: n_late=${r?.n_late ?? 0}` };
					}
					const x = Number(r.price_ratio);
					return bandVerdict(x, [1.24, 1.36], [1.18, 1.42],
						`late/off item_price ratio=${x.toFixed(3)} (mech 1.30; n_late=${r.n_late})`,
						x < 1.0);
				},
			},
		],
	},
	{
		id: "H4-rainy-week",
		hook: "H4",
		archetype: "temporal-inflection",
		narrative:
			"Days 20-27: delivery_fee doubled on order-placed, 40% duplicated with 5-60 min offset. " +
			"Duplicate share (in-window (uid, order_id) twins ÷ distinct orders) recovers the 0.40 " +
			"knob directly. Fee window/baseline ≈ 2.0 (fee pool bottoms at 1, the (fee||5) fallback " +
			"is inert). Volume RoR vs checkout ≈ 1.40 diluted a few percent by H6-churned users. " +
			"Measured dup 0.367, fee 1.937, RoR 1.343 at 2K.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${EV_CTE}
SELECT count(*)::BIGINT AS total_win,
  count(DISTINCT uid || '|' || order_id)::BIGINT AS distinct_orders,
  (count(*) - count(DISTINCT uid || '|' || order_id))::DOUBLE /
  count(DISTINCT uid || '|' || order_id) AS dup_share
FROM ev WHERE event='order placed' AND day_idx BETWEEN 20 AND 27`,
				},
				assert: (rows) => {
					const r = rows?.[0];
					if (!r || Number(r.distinct_orders) < 2500) {
						return { verdict: "WEAK", detail: `window orders too few: distinct=${r?.distinct_orders ?? 0}` };
					}
					const x = Number(r.dup_share);
					return bandVerdict(x, [0.33, 0.47], [0.28, 0.52],
						`in-window duplicate share=${x.toFixed(3)} (mech 0.40; ${r.total_win} events over ${r.distinct_orders} orders)`,
						x < 0.02);
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${EV_CTE}
SELECT avg(TRY_CAST(delivery_fee AS DOUBLE)) FILTER (WHERE day_idx BETWEEN 20 AND 27) /
       avg(TRY_CAST(delivery_fee AS DOUBLE)) FILTER (WHERE day_idx BETWEEN 10 AND 19 OR day_idx BETWEEN 28 AND 37) AS fee_ratio,
  count(*) FILTER (WHERE day_idx BETWEEN 20 AND 27)::BIGINT AS n_win
FROM ev WHERE event='order placed'`,
				},
				assert: (rows) => {
					const r = rows?.[0];
					if (!r || Number(r.n_win) < 3000) {
						return { verdict: "WEAK", detail: `window orders too few: n_win=${r?.n_win ?? 0}` };
					}
					const x = Number(r.fee_ratio);
					return bandVerdict(x, [1.85, 2.15], [1.70, 2.30],
						`delivery_fee window/baseline=${x.toFixed(3)} (mech 2.0; n_win=${r.n_win})`,
						x < 1.0);
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${EV_CTE},
agg AS (SELECT CASE WHEN day_idx BETWEEN 20 AND 27 THEN 'win'
  WHEN day_idx BETWEEN 10 AND 19 OR day_idx BETWEEN 28 AND 37 THEN 'base' END AS zone,
  count(*) FILTER (WHERE event='order placed')::BIGINT AS placed,
  count(*) FILTER (WHERE event='checkout started')::BIGINT AS chk
FROM ev WHERE event IN ('order placed','checkout started') AND day_idx BETWEEN 10 AND 37 GROUP BY 1)
SELECT (max(CASE WHEN zone='win' THEN placed END)::DOUBLE / max(CASE WHEN zone='base' THEN placed END)) /
       (max(CASE WHEN zone='win' THEN chk END)::DOUBLE / max(CASE WHEN zone='base' THEN chk END)) AS vol_ror,
  max(CASE WHEN zone='win' THEN placed END)::BIGINT AS placed_win
FROM agg`,
				},
				assert: (rows) => {
					const r = rows?.[0];
					if (!r || Number(r.placed_win) < 3000) {
						return { verdict: "WEAK", detail: `window orders too few: placed_win=${r?.placed_win ?? 0}` };
					}
					const x = Number(r.vol_ror);
					return bandVerdict(x, [1.25, 1.55], [1.15, 1.70],
						`placed vol RoR vs checkout=${x.toFixed(3)} (mech ~1.40 minus churn dilution; placed_win=${r.placed_win})`,
						x < 1.0);
				},
			},
		],
	},
	{
		id: "H5-referral-power",
		hook: "H5",
		archetype: "cohort-count-scale",
		narrative:
			"Born-in users with referral_code=true on account-created (~1/3 of born-ins) get " +
			"food_rating rerolled to 4-5 and ~50% of visited reorders cloned. Cohort only exists " +
			"among born-ins (pre-existing users have no account-created). Reorders/user ratio ≈ 1.4 " +
			"(clones re-visited at idx+1 can re-clone; tail events pushed past the fixed forEach " +
			"range are skipped, so net sits below naive 1.5). Ratings: referred user-mean ≈ 4.4 " +
			"(same truncation leaves some rated events unboosted) vs organic ≈ 2.8. Measured " +
			"1.45/1.34 across 2K iterations; ratings 4.45 vs 2.78.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${EV_CTE},
born AS (SELECT uid, bool_or(referral_code = true) AS referred
  FROM ev WHERE event='account created' GROUP BY 1),
pu AS (SELECT b.uid, b.referred,
  count(*) FILTER (WHERE e.event='reorder initiated') AS reorders,
  avg(TRY_CAST(e.food_rating AS DOUBLE)) FILTER (WHERE e.event='order rated') AS user_rating
FROM born b LEFT JOIN ev e ON e.uid=b.uid GROUP BY 1,2)
SELECT referred, count(*)::BIGINT AS users,
  sum(reorders)::DOUBLE/count(*) AS reorders_pu,
  avg(user_rating) AS mean_rating
FROM pu GROUP BY referred ORDER BY referred`,
				},
				assert: (rows) => {
					const ref = rows?.find(r => r.referred === true);
					const non = rows?.find(r => r.referred === false);
					if (!ref || !non || Number(ref.users) < 250 || Number(non.users) < 500) {
						return { verdict: "WEAK", detail: `born-in cohorts too small: ref=${ref?.users ?? 0} nonref=${non?.users ?? 0}` };
					}
					const ratio = Number(ref.reorders_pu) / Number(non.reorders_pu);
					return bandVerdict(ratio, [1.25, 1.60], [1.12, 1.75],
						`born-in reorders/user ref÷nonref=${ratio.toFixed(3)} (mech ~1.4; ref=${Number(ref.reorders_pu).toFixed(2)} n=${ref.users}, nonref=${Number(non.reorders_pu).toFixed(2)} n=${non.users})`,
						ratio < 1.0);
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${EV_CTE},
born AS (SELECT uid, bool_or(referral_code = true) AS referred
  FROM ev WHERE event='account created' GROUP BY 1),
pu AS (SELECT b.uid, b.referred,
  avg(TRY_CAST(e.food_rating AS DOUBLE)) FILTER (WHERE e.event='order rated') AS user_rating
FROM born b LEFT JOIN ev e ON e.uid=b.uid GROUP BY 1,2)
SELECT referred, count(*) FILTER (WHERE user_rating IS NOT NULL)::BIGINT AS raters,
  avg(user_rating) AS mean_rating
FROM pu GROUP BY referred ORDER BY referred`,
				},
				assert: (rows) => {
					const ref = rows?.find(r => r.referred === true);
					const non = rows?.find(r => r.referred === false);
					if (!ref || !non || Number(ref.raters) < 200 || Number(non.raters) < 400) {
						return { verdict: "WEAK", detail: `rater cohorts too small: ref=${ref?.raters ?? 0} nonref=${non?.raters ?? 0}` };
					}
					const rr = Number(ref.mean_rating), nr = Number(non.mean_rating);
					const detail = `referred mean rating=${rr.toFixed(2)} vs organic=${nr.toFixed(2)} (mech ~4.4 vs ~2.8)`;
					if (rr >= 4.3 && rr <= 4.55 && nr >= 2.6 && nr <= 3.0) return { verdict: "NAILED", detail };
					if (rr >= 4.15 && rr <= 4.65 && nr >= 2.45 && nr <= 3.15) return { verdict: "STRONG", detail };
					if (rr < nr) return { verdict: "INVERSE", detail };
					return { verdict: "WEAK", detail };
				},
			},
		],
	},
	{
		id: "H6-trial-churn",
		hook: "H6",
		archetype: "retention-divergence",
		narrative:
			"Trial subscribers with <3 orders in their first 14 days: 60% (per-user coin) lose ALL " +
			"post-day-14 events. The deletion removes late subscription-started events themselves, " +
			"so churned users with a late trial start vanish from the visible cohort (survivor " +
			"bias) — the visible zero-post share lands near 0.25, not 0.60. Honest observable: " +
			"zero-post-day-14 share non-activated ≈ 0.25 vs activated ≈ 0.04, a 5-7x divergence. " +
			"Per-user post/pre ratios are composition-confounded (activation selects front-loaded " +
			"activity) — deliberately not asserted. Measured 0.245/0.036 at 2K.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${EV_CTE},
fu AS (SELECT uid, min(t) AS first_t FROM ev GROUP BY 1),
trial AS (SELECT uid FROM ev WHERE event='subscription started' AND trial = true GROUP BY 1),
pux AS (SELECT f.uid,
  count(*) FILTER (WHERE e.event='order placed' AND e.t <= f.first_t + INTERVAL '14 days') AS early_orders,
  count(*) FILTER (WHERE e.t > f.first_t + INTERVAL '14 days') AS post_n
FROM fu f JOIN trial tr ON tr.uid=f.uid JOIN ev e ON e.uid=f.uid GROUP BY 1)
SELECT (early_orders >= 3) AS activated, count(*)::BIGINT AS users,
  avg(CASE WHEN post_n = 0 THEN 1.0 ELSE 0 END) AS zero_post_share
FROM pux GROUP BY (early_orders >= 3) ORDER BY 1`,
				},
				assert: (rows) => {
					const non = rows?.find(r => r.activated === false);
					const act = rows?.find(r => r.activated === true);
					if (!non || !act || Number(non.users) < 1200 || Number(act.users) < 1000) {
						return { verdict: "WEAK", detail: `trial cohorts too small: nonact=${non?.users ?? 0} act=${act?.users ?? 0}` };
					}
					const ns = Number(non.zero_post_share), as = Number(act.zero_post_share);
					const ratio = as > 0 ? ns / as : Infinity;
					const detail = `zero-post share nonact=${ns.toFixed(3)} vs act=${as.toFixed(3)} (ratio ${ratio === Infinity ? "inf" : ratio.toFixed(1)}x; survivor-biased vs 0.60 knob by construction)`;
					if (ns >= 0.15 && ns <= 0.35 && as <= 0.06 && ratio >= 5) return { verdict: "NAILED", detail };
					if (ns >= 0.12 && ns <= 0.40 && as <= 0.10 && ratio >= 3) return { verdict: "STRONG", detail };
					if (ns < as) return { verdict: "INVERSE", detail };
					return { verdict: "WEAK", detail };
				},
			},
		],
	},
	{
		id: "H7-hash-bucket-drop",
		hook: "H7",
		archetype: "funnel-conversion-by-segment",
		narrative:
			"Users whose user_id first char has an ODD char code lose 30% of order-delivered " +
			"events. delivered-per-placed(odd) ÷ delivered-per-placed(even) ≈ 0.70 — placed " +
			"normalizes engagement and H1's drop is hash-independent, so both cancel. " +
			"Measured 0.716 at 2K.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${EV_CTE},
pu AS (SELECT uid, (ascii(substr(uid,1,1)) % 2 = 0) AS even_bucket,
  count(*) FILTER (WHERE event='order placed') AS placed,
  count(*) FILTER (WHERE event='order delivered') AS delivered
FROM ev WHERE event IN ('order placed','order delivered') GROUP BY 1,2)
SELECT even_bucket, count(*)::BIGINT AS users,
  sum(delivered)::DOUBLE/nullif(sum(placed),0) AS dpp
FROM pu GROUP BY even_bucket ORDER BY even_bucket`,
				},
				assert: (rows) => {
					const odd = rows?.find(r => r.even_bucket === false);
					const even = rows?.find(r => r.even_bucket === true);
					if (!odd || !even || Number(odd.users) < 2500 || Number(even.users) < 2500) {
						return { verdict: "WEAK", detail: `hash buckets too small: odd=${odd?.users ?? 0} even=${even?.users ?? 0}` };
					}
					const ratio = Number(odd.dpp) / Number(even.dpp);
					return bandVerdict(ratio, [0.65, 0.75], [0.60, 0.80],
						`delivered-per-placed odd÷even=${ratio.toFixed(3)} (mech 0.70; odd=${Number(odd.dpp).toFixed(3)} even=${Number(even.dpp).toFixed(3)})`,
						ratio > 1.0);
				},
			},
		],
	},
	{
		id: "H8-order-count-magic",
		hook: "H8",
		archetype: "frequency-sweet-spot",
		narrative:
			"order_total scaled by hook-time order count: 4-8 orders → 1.4x, 9+ → 0.65x. The hook " +
			"buckets BEFORE H4 duplication and H6 deletion, so output-count bucketing is edge-" +
			"contaminated; the clean population excludes rainy-window orderers and H6-churn " +
			"candidates (users with no post-day-14 activity). On it: sweet/base ≈ 1.40, " +
			"over/sweet ≈ 0.46 (= 0.65/1.4). Measured 1.405 and 0.456 at 2K.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${EV_CTE},
fu AS (SELECT uid, min(t) AS first_t FROM ev GROUP BY 1),
flags AS (SELECT r.uid,
  max(CASE WHEN r.event='order placed' AND r.day_idx BETWEEN 20 AND 27 THEN 1 ELSE 0 END) AS rainy,
  max(CASE WHEN r.t > f.first_t + INTERVAL '14 days' THEN 1 ELSE 0 END) AS alive,
  count(*) FILTER (WHERE r.event='order placed') AS orders,
  sum(TRY_CAST(r.order_total AS DOUBLE)) FILTER (WHERE r.event='order placed') AS spend
FROM ev r JOIN fu f USING(uid) GROUP BY 1)
SELECT CASE WHEN orders BETWEEN 4 AND 8 THEN 'sweet' WHEN orders >= 9 THEN 'over' ELSE 'base' END AS bucket,
  count(*)::BIGINT AS users, sum(spend)/nullif(sum(orders),0) AS aot
FROM flags WHERE rainy = 0 AND alive = 1 AND orders > 0 GROUP BY 1 ORDER BY 1`,
				},
				assert: (rows) => {
					const base = rows?.find(r => r.bucket === "base");
					const sweet = rows?.find(r => r.bucket === "sweet");
					if (!base || !sweet || Number(base.users) < 130 || Number(sweet.users) < 450) {
						return { verdict: "WEAK", detail: `clean-pop buckets too small: base=${base?.users ?? 0} sweet=${sweet?.users ?? 0}` };
					}
					const ratio = Number(sweet.aot) / Number(base.aot);
					return bandVerdict(ratio, [1.25, 1.55], [1.15, 1.70],
						`clean-pop sweet/base order_total=${ratio.toFixed(3)} (mech 1.40; sweet=${Number(sweet.aot).toFixed(1)} n=${sweet.users}, base=${Number(base.aot).toFixed(1)} n=${base.users})`,
						ratio < 1.0);
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${EV_CTE},
fu AS (SELECT uid, min(t) AS first_t FROM ev GROUP BY 1),
flags AS (SELECT r.uid,
  max(CASE WHEN r.event='order placed' AND r.day_idx BETWEEN 20 AND 27 THEN 1 ELSE 0 END) AS rainy,
  max(CASE WHEN r.t > f.first_t + INTERVAL '14 days' THEN 1 ELSE 0 END) AS alive,
  count(*) FILTER (WHERE r.event='order placed') AS orders,
  sum(TRY_CAST(r.order_total AS DOUBLE)) FILTER (WHERE r.event='order placed') AS spend
FROM ev r JOIN fu f USING(uid) GROUP BY 1)
SELECT CASE WHEN orders BETWEEN 4 AND 8 THEN 'sweet' WHEN orders >= 9 THEN 'over' ELSE 'base' END AS bucket,
  count(*)::BIGINT AS users, sum(spend)/nullif(sum(orders),0) AS aot
FROM flags WHERE rainy = 0 AND alive = 1 AND orders > 0 GROUP BY 1 ORDER BY 1`,
				},
				assert: (rows) => {
					const sweet = rows?.find(r => r.bucket === "sweet");
					const over = rows?.find(r => r.bucket === "over");
					if (!sweet || !over || Number(sweet.users) < 450 || Number(over.users) < 1000) {
						return { verdict: "WEAK", detail: `clean-pop buckets too small: sweet=${sweet?.users ?? 0} over=${over?.users ?? 0}` };
					}
					const ratio = Number(over.aot) / Number(sweet.aot);
					return bandVerdict(ratio, [0.40, 0.53], [0.35, 0.58],
						`clean-pop over/sweet order_total=${ratio.toFixed(3)} (mech 0.464 = 0.65/1.4; over=${Number(over.aot).toFixed(1)} n=${over.users})`,
						ratio > 1.0);
				},
			},
		],
	},
	{
		id: "H9-tier-delivery-speed",
		hook: "H9",
		archetype: "cohort-prop-scale",
		narrative:
			"Delivery timing properties scaled by tier: QuickBite+ 0.67x, Free 1.4x → QB+/Free " +
			"property ratio 0.479 on actual_delivery_mins and eta_mins. The companion funnel-" +
			"timestamp compression touches only the FIRST checkout→delivered sequence per user " +
			"(~1 of 13 checkouts) — invisible to cross-event aggregation, so wall-clock TTC is " +
			"deliberately NOT asserted (visible only in Mixpanel's per-instance funnel report). " +
			"Measured 0.476/0.481 at 2K.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${EV_CTE}
SELECT avg(TRY_CAST(actual_delivery_mins AS DOUBLE)) FILTER (WHERE subscription_tier='QuickBite+') /
       avg(TRY_CAST(actual_delivery_mins AS DOUBLE)) FILTER (WHERE subscription_tier='Free') AS adm_ratio,
  count(*) FILTER (WHERE subscription_tier='QuickBite+')::BIGINT AS n_plus
FROM ev WHERE event='order delivered'`,
				},
				assert: (rows) => {
					const r = rows?.[0];
					if (!r || Number(r.n_plus) < 5000) {
						return { verdict: "WEAK", detail: `QB+ delivered too few: n_plus=${r?.n_plus ?? 0}` };
					}
					const x = Number(r.adm_ratio);
					return bandVerdict(x, [0.44, 0.52], [0.41, 0.56],
						`actual_delivery_mins QB+÷Free=${x.toFixed(3)} (mech 0.479 = 0.67/1.4; n_plus=${r.n_plus})`,
						x > 1.0);
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${EV_CTE}
SELECT avg(TRY_CAST(eta_mins AS DOUBLE)) FILTER (WHERE subscription_tier='QuickBite+') /
       avg(TRY_CAST(eta_mins AS DOUBLE)) FILTER (WHERE subscription_tier='Free') AS eta_ratio,
  count(*) FILTER (WHERE subscription_tier='QuickBite+')::BIGINT AS n_plus
FROM ev WHERE event='order tracked'`,
				},
				assert: (rows) => {
					const r = rows?.[0];
					if (!r || Number(r.n_plus) < 5000) {
						return { verdict: "WEAK", detail: `QB+ tracked too few: n_plus=${r?.n_plus ?? 0}` };
					}
					const x = Number(r.eta_ratio);
					return bandVerdict(x, [0.44, 0.52], [0.41, 0.56],
						`eta_mins QB+÷Free=${x.toFixed(3)} (mech 0.479; n_plus=${r.n_plus})`,
						x > 1.0);
				},
			},
		],
	},
	{
		id: "H10-city-density",
		hook: "H10",
		archetype: "funnel-conversion-by-segment",
		narrative:
			"Reorder-funnel conversionRate scaled per city in funnel-pre: SF/NY 40→56, HOU/PHX " +
			"40→28. Non-converted instances take u.integer(1, steps−1) steps (determineConversion, " +
			"lib/generators/funnels.js) — the LAST step fires only on conversion, so P(reorder per " +
			"instance) = conversionRate exactly. Delivered-per-user is city-flat, so reorders-per-" +
			"DELIVERED recovers the knobs: dense/base = 56/40 = 1.40, sprawl/base = 28/40 = 0.70. " +
			"Measured 1.404 and 0.696 at 2K.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${EV_CTE},
pu AS (SELECT uid, any_value(city) AS city,
  count(*) FILTER (WHERE event='order delivered') AS delivered,
  count(*) FILTER (WHERE event='reorder initiated') AS reorders
FROM ev WHERE event IN ('order delivered','reorder initiated') GROUP BY 1),
grp AS (SELECT CASE WHEN city IN ('San Francisco','New York') THEN 'dense'
  WHEN city IN ('Houston','Phoenix') THEN 'sprawl' ELSE 'base' END AS g,
  count(*)::BIGINT AS users, sum(reorders)::DOUBLE/nullif(sum(delivered),0) AS rpd
FROM pu GROUP BY 1)
SELECT g, users, rpd FROM grp ORDER BY g`,
				},
				assert: (rows) => {
					const dense = rows?.find(r => r.g === "dense");
					const base = rows?.find(r => r.g === "base");
					if (!dense || !base || Number(dense.users) < 1800 || Number(base.users) < 1800) {
						return { verdict: "WEAK", detail: `city groups too small: dense=${dense?.users ?? 0} base=${base?.users ?? 0}` };
					}
					const ratio = Number(dense.rpd) / Number(base.rpd);
					return bandVerdict(ratio, [1.30, 1.50], [1.20, 1.60],
						`reorders-per-delivered dense÷base=${ratio.toFixed(3)} (mech 1.40; dense=${Number(dense.rpd).toFixed(3)} base=${Number(base.rpd).toFixed(3)})`,
						ratio < 1.0);
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${EV_CTE},
pu AS (SELECT uid, any_value(city) AS city,
  count(*) FILTER (WHERE event='order delivered') AS delivered,
  count(*) FILTER (WHERE event='reorder initiated') AS reorders
FROM ev WHERE event IN ('order delivered','reorder initiated') GROUP BY 1),
grp AS (SELECT CASE WHEN city IN ('San Francisco','New York') THEN 'dense'
  WHEN city IN ('Houston','Phoenix') THEN 'sprawl' ELSE 'base' END AS g,
  count(*)::BIGINT AS users, sum(reorders)::DOUBLE/nullif(sum(delivered),0) AS rpd
FROM pu GROUP BY 1)
SELECT g, users, rpd FROM grp ORDER BY g`,
				},
				assert: (rows) => {
					const sprawl = rows?.find(r => r.g === "sprawl");
					const base = rows?.find(r => r.g === "base");
					if (!sprawl || !base || Number(sprawl.users) < 1800 || Number(base.users) < 1800) {
						return { verdict: "WEAK", detail: `city groups too small: sprawl=${sprawl?.users ?? 0} base=${base?.users ?? 0}` };
					}
					const ratio = Number(sprawl.rpd) / Number(base.rpd);
					return bandVerdict(ratio, [0.63, 0.77], [0.56, 0.84],
						`reorders-per-delivered sprawl÷base=${ratio.toFixed(3)} (mech 0.70; sprawl=${Number(sprawl.rpd).toFixed(3)} base=${Number(base.rpd).toFixed(3)})`,
						ratio > 1.0);
				},
			},
		],
	},
];
