// ── IMPORTS ──
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);
import "dotenv/config";
import * as u from "@ak--47/dungeon-master/utils";
/** @typedef  {import("../../../types").Dungeon} Config */

// ── OVERVIEW ──
/*
 * NAME:       HomeNest
 * APP:        Property listings and agent CRM platform (Zillow meets
 *             Compass). Buyers search listings, save properties, schedule
 *             tours, get pre-approved for mortgages, and submit offers.
 *             Agents list properties, manage clients, and close deals.
 * SCALE:      10,000 users, 121 days (2026-01-01 → 2026-05-01)
 * CORE LOOP:  account created → property search → property viewed → property saved → tour scheduled → offer submitted (buyer) | property listed → open house attended → property sold (agent)
 *
 * EVENTS (17):
 *   property viewed (12) > property search (10) > property saved (5) > virtual tour (4)
 *   > tour scheduled (4) > agent contacted (4) > saved search created (3) > in-person tour (3)
 *   > property listed (3) > mortgage pre-approval (2) > offer submitted (2) > open house attended (2)
 *   > review submitted (2) > account created (1) > offer accepted (1) > offer rejected (1)
 *   > property sold (1)
 *
 * FUNNELS (3):
 *   - Buyer Journey:  account created → property search → property viewed (80%)
 *   - Tour Funnel:    property viewed → tour scheduled → offer submitted (40%, reentry)
 *   - Seller Funnel:  property listed → open house attended → property sold (35%)
 *
 * USER PROPS:  user_type, preferred_location, property_preference, budget_max, agent_tier, total_properties_viewed, pre_approval_status
 * SUPER PROPS: user_type, preferred_location, property_preference
 * SCD PROPS:   agent_tier (Standard/Premier, monthly fuzzy, max 4)
 * GROUPS:      brokerage_id (200 brokerages — property listed, property sold, agent contacted, open house attended)
 */

// ── HOOK STORIES ──
/*
 * NOTE: All cohort effects are HIDDEN — no flag stamping. Discoverable
 * only via behavioral cohorts (count event per user, then measure
 * downstream) or raw-prop breakdowns (date, agent_tier).
 *
 * -------------------------------------------------------------------
 * 1. SPRING BUYING SEASON (event)
 * -------------------------------------------------------------------
 *
 * PATTERN: Days 30-60, tour-scheduled duration_mins boosted 3x and
 * offer-submitted offer_price boosted 2.5x. Mutates raw props. No flag.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Avg Offer Price by Day
 *   - Report type: Insights
 *   - Event: "offer submitted"
 *   - Measure: Average of "offer_price"
 *   - Line chart by day
 *   - Expected: visible bulge days 30-60 (~ 2.5x baseline)
 *
 * REAL-WORLD ANALOGUE: Spring buying season elevates prices and tour intent.
 *
 * -------------------------------------------------------------------
 * 2. MORTGAGE RATE SHOCK (event + everything)
 * -------------------------------------------------------------------
 *
 * PATTERN: Days 75-89, mortgage_rate forced to 7.5 on pre-approval
 * events. In everything hook, 45% of post-day-75 offer-submitted events
 * dropped (runs after all offer cloning so the drop is visible against
 * the pre-approved/dual-tour clone volume). No flag.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Mortgage Rate Step Change
 *   - Report type: Insights
 *   - Event: "mortgage pre-approval"
 *   - Measure: Average of "mortgage_rate"
 *   - Line chart by day
 *   - Expected: clear step change from ~ 6.5 to 7.5 at day 75
 *
 *   Report 2: Offer Volume Drop After Rate Hike
 *   - Report type: Insights
 *   - Event: "offer submitted"
 *   - Measure: Total
 *   - Line chart by day
 *   - Expected: ~ 45% volume drop after day 75
 *
 * REAL-WORLD ANALOGUE: Buyer demand is sensitive to mortgage rates.
 *
 * -------------------------------------------------------------------
 * 3. SAVED-SEARCH RETENTION (everything)
 * -------------------------------------------------------------------
 *
 * PATTERN: Users who create saved-search-created in first 7 days get
 * extra cloned property-viewed + tour-scheduled events. Non-savers lose
 * 80% of post-day-30 events. No flag — discover via cohort builder.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Retention by Saved-Search Cohort
 *   - Report type: Retention
 *   - Cohort A: users with >= 1 "saved search created" in first 7 days
 *   - Cohort B: rest
 *   - Expected: A sustains higher retention through dataset
 *
 * REAL-WORLD ANALOGUE: Saved searches indicate buyer intent.
 *
 * -------------------------------------------------------------------
 * 4. PRE-APPROVED BUYER CONVERSION (everything)
 * -------------------------------------------------------------------
 *
 * PATTERN: Users with a mortgage-pre-approval event get 4-6 extra
 * cloned offer-submitted events. No flag — discover via cohort.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Offers per User by Pre-Approval
 *   - Report type: Insights (with cohort)
 *   - Cohort A: users with >= 1 "mortgage pre-approval"
 *   - Cohort B: rest
 *   - Event: "offer submitted"
 *   - Measure: Total per user
 *   - Expected: A ~ 4.5x B (mean 5 clones diluted by churn deletions
 *     and the H9 over-bucket offer drop, which skews pre-approved)
 *
 * REAL-WORLD ANALOGUE: Pre-approval is the strongest buyer indicator.
 *
 * -------------------------------------------------------------------
 * 5. TOP-TIER AGENT ADVANTAGE (everything)
 * -------------------------------------------------------------------
 *
 * PATTERN: Premier-tier agents get 2 extra cloned listings per existing
 * (3x rate) and 1 extra cloned sale per existing (2x rate). Mutates
 * cloned events with raw values; reads agent_tier from profile (existing
 * SCD prop). Discover via agent_tier breakdown.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Listings per Agent by Tier
 *   - Report type: Insights
 *   - Event: "property listed"
 *   - Measure: Total per user
 *   - Breakdown: user "agent_tier"
 *   - Expected: Premier ~ 3x Standard
 *
 * REAL-WORLD ANALOGUE: Top producers list and close more.
 *
 * -------------------------------------------------------------------
 * 6. TOUR-TO-OFFER POWER USERS (everything)
 * -------------------------------------------------------------------
 *
 * PATTERN: Users with both virtual-tour AND in-person-tour events get
 * 5-7 extra cloned offer-submitted events. No flag — discover via
 * compound cohort builder.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Offers per User by Dual-Tour Cohort
 *   - Report type: Insights (with cohort)
 *   - Cohort A: users with both >= 1 "virtual tour" AND >= 1 "in-person tour"
 *   - Cohort B: rest
 *   - Event: "offer submitted"
 *   - Measure: Total per user
 *   - Expected: A ~ 5x B (mean 6 clones diluted by the same churn/H9/H2
 *     deletion ledger as pattern 4)
 *
 * REAL-WORLD ANALOGUE: Dual-tour buyers self-qualify into serious bidders.
 *
 * -------------------------------------------------------------------
 * 7. LUXURY LISTING RELEASE (event + everything)
 * -------------------------------------------------------------------
 *
 * PATTERN: After day 50, 3% of property-listed events get listing_price
 * set to $5M-$15M (raw mutation). ~6% of users (uuid first-char hash:
 * charCodeAt(0) % 33 === 0 hits only 'c', 1 of 16 hex chars) get extra
 * luxury cloned property-viewed events. No flag — discover via line
 * chart by day on listing_price.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Listing Price Distribution Over Time
 *   - Report type: Insights
 *   - Event: "property listed"
 *   - Measure: Distribution of "listing_price"
 *   - Line chart by week
 *   - Expected: $5M+ outliers appear only after day 50
 *
 * REAL-WORLD ANALOGUE: Luxury inventory drop attracts HNW shoppers.
 *
 * -------------------------------------------------------------------
 * 8. COLD-LEAD CHURN (everything)
 * -------------------------------------------------------------------
 *
 * PATTERN: Users who view (property viewed) but never save (property
 * saved) in the first 14 days lose 90% of events after day 14. No flag.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Cold-Lead Retention
 *   - Report type: Retention
 *   - Cohort A: users with >= 1 "property viewed" but 0 "property saved" in first 14 days
 *   - Cohort B: rest
 *   - Expected: A retention drops to near-zero after day 14
 *
 * REAL-WORLD ANALOGUE: Browsers who never save are window-shoppers.
 *
 * -------------------------------------------------------------------
 * 9. PROPERTY-VIEWED MAGIC NUMBER (everything)
 * -------------------------------------------------------------------
 *
 * PATTERN: Users in the 6-12 property-viewed sweet spot get +30% on
 * offer_price for offer-submitted events. Users with 13+ views are
 * tire-kickers; 60% of their offer-submitted events drop (the bucket
 * is dominated by pre-approved/dual-tour power cloners, so 60% deletion
 * nets the visible ~35%-fewer-offers cohort read). No flag.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Avg Offer Price by View Bucket
 *   - Report type: Insights (with cohort)
 *   - Cohort A: users with 6-12 "property viewed"
 *   - Cohort B: users with 0-5
 *   - Event: "offer submitted"
 *   - Measure: Average of "offer_price"
 *   - Expected: A ~ 1.3x B
 *
 *   Report 2: Offers per User on Heavy Viewers
 *   - Report type: Insights (with cohort)
 *   - Cohort C: users with >= 13 "property viewed"
 *   - Cohort A: users with 6-12
 *   - Event: "offer submitted"
 *   - Measure: Total per user
 *   - Expected: C ~ 35% fewer offers per user vs A
 *
 * REAL-WORLD ANALOGUE: Focused buyers commit; obsessive browsers
 * tire-kick and never make the leap.
 *
 * -------------------------------------------------------------------
 * 10. TOUR FUNNEL TIME-TO-CONVERT (funnel-post)
 * -------------------------------------------------------------------
 *
 * PATTERN: Premier-tier agents move users through the Tour funnel
 * (property viewed -> tour scheduled -> offer submitted) 1.4x faster
 * (factor 0.71). Standard-tier agents complete it 1.3x slower
 * (factor 1.3). The hook intercepts funnel-post arrays, computes the
 * time gap between consecutive steps, and scales each gap by the
 * tier-specific factor before rewriting the step timestamps.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Tour Funnel Median TTC by Agent Tier
 *   - Report type: Funnels
 *   - Steps: "property viewed" -> "tour scheduled" -> "offer submitted"
 *   - Measure: Median time to convert
 *   - Breakdown: "agent_tier" (user property / SCD)
 *   - Expected: Premier ~ 0.71x baseline; Standard ~ 1.3x baseline
 *
 *   NOTE (funnel-post measurement): visible via Mixpanel funnel median
 *   TTC and via the emulator's timeToConvert read (stories H10) at a
 *   31.2h window = 24h generative x 1.3 Standard stretch. Cross-event
 *   MIN→MIN SQL queries on raw events do NOT show this — funnel-post
 *   adjusts gaps within funnel instances, not across the user's full
 *   event history. The 2-step view→tour pair is the primary read; the
 *   3-step read attenuates toward 1 because H4/H6 offer clones collide
 *   with the greedy third-step pick.
 *
 * REAL-WORLD ANALOGUE: Premier agents have larger networks, faster
 * scheduling workflows, and prioritized showing slots, translating
 * to shorter tour-to-offer cycles.
 *
 * ===================================================================
 * EXPECTED METRICS SUMMARY
 * (Measured = full fidelity, 10K users / 269,067 events)
 * ===================================================================
 *
 * Story id | Metric                                      | Expected      | Measured
 * ---------|---------------------------------------------|---------------|---------
 * H1       | spring/outside avg offer_price              | ~2.6 (2.5 knob + sweet-spot mix) | 2.611
 * H1       | spring/outside avg tour duration            | ~2.6 (3x knob, clone leak)       | 2.543
 * H2       | shock-window mortgage_rate pin              | min=max=7.5   | 7.5 / 7.5
 * H2       | offer share-of-volume post/pre d75          | ~0.77 (0.55 x clone drift) | 0.758
 * H3       | post-d30 events/user savers/non             | ~6.5          | 6.55
 * H3       | active-in-April savers / non (born pre-Mar) | ~0.98 / ~0.55 | 0.9870 / 0.5561
 * H4       | offers/user pre-approved/rest               | ~4.5          | 4.47
 * H4       | profile-flag purity on event cohort         | 1.0           | 1.0000
 * H5       | listings/user Premier/Standard              | ~2.8          | 2.736
 * H5       | sales/user Premier/Standard                 | ~1.9          | 1.899
 * H6       | offers/user dual-tour/rest                  | ~5x           | 5.05
 * H6       |   decomposition: dual-only/neither          | ~4.5          | 4.28
 * H7       | $2M+ listings strictly pre-d50 / post share | 0 / ~1.9%     | 0 / 2.19%
 * H7       | luxury views: browser pu / non-browser      | ~2 / 0        | 2.07 / 0
 * H8       | post-first-14d events/user cold/rest        | ~0.13         | 0.134
 * H8       |   trajectory: cold post/pre vs rest         | <0.85 vs >1.6 | 0.706 vs 2.246
 * H9       | non-spring offer_price sweet/low            | ~1.34         | 1.343
 * H9       |   placebo: over/low price                   | ~1.0          | 1.022
 * H9       | offers/user over/sweet                      | ~0.65         | 0.647
 * H10      | emulator 2-step TTC Premier/Standard (31.2h)| 0.546 mech    | 0.555
 * H10      |   secondary: 3-step TTC ratio               | ~0.75 (attenuated) | 0.746
 * H10      | identity: uid resolution / stamp agreement  | 1.0 / 1.0     | 1.0 / 1.0
 */

// ── SCALE ──
const SEED = "homenest";
const NUM_USERS = 10_000;
const NUM_DAYS = 120;
const DATASET_START = "2026-01-01T00:00:00Z";
const DATASET_END = "2026-05-01T23:59:59Z";
const EVENTS_PER_DAY = 0.53;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── KNOBS (tweak these to reshape stories) ──
const SPRING_START_DAY = 30;
const SPRING_END_DAY = 60;
const SPRING_TOUR_DURATION_MULT = 3;
const SPRING_OFFER_PRICE_MULT = 2.5;

const SHOCK_START_DAY = 75;
const SHOCK_END_DAY = 89;
const SHOCK_MORTGAGE_RATE = 7.5;
const SHOCK_OFFER_DROP_LIKELIHOOD = 45;

const SAVED_SEARCH_WINDOW_DAYS = 7;
const SAVED_SEARCH_VIEW_CLONES_MIN = 3;
const SAVED_SEARCH_VIEW_CLONES_MAX = 8;
const SAVED_SEARCH_TOUR_CLONES_MIN = 1;
const SAVED_SEARCH_TOUR_CLONES_MAX = 3;
const NON_SAVER_CUTOFF_DAY = 30;
const NON_SAVER_DROP_LIKELIHOOD = 80;

const PRE_APPROVAL_OFFER_CLONES_MIN = 4;
const PRE_APPROVAL_OFFER_CLONES_MAX = 6;

const PREMIER_LISTING_CLONE_MULT = 2;
const PREMIER_SALE_CLONE_MULT = 1;

const DUAL_TOUR_OFFER_CLONES_MIN = 5;
const DUAL_TOUR_OFFER_CLONES_MAX = 7;

const LUXURY_RELEASE_DAY = 50;
const LUXURY_LISTING_LIKELIHOOD = 3;
const LUXURY_PRICE_MIN = 5_000_000;
const LUXURY_PRICE_MAX = 15_000_000;
const LUXURY_USER_HASH_MOD = 33;
const LUXURY_VIEW_CLONES_MIN = 3;
const LUXURY_VIEW_CLONES_MAX = 6;

const COLD_LEAD_WINDOW_DAYS = 14;
const COLD_LEAD_DROP_LIKELIHOOD = 90;

const VIEW_SWEET_MIN = 6;
const VIEW_SWEET_MAX = 12;
const VIEW_OVER_THRESHOLD = 13;
const VIEW_OFFER_PRICE_BOOST = 1.3;
// 60 (not 35): the 13+-view bucket is ~97% pre-approved/dual-tour power
// cloners whose higher underlying offer volume offsets the deletion — a
// 35% drop left over/sweet at ~1.06 (invisible). 60% deletion nets the
// documented "~35% fewer offers per user" in the plain cohort read.
const VIEW_OVER_OFFER_DROP_LIKELIHOOD = 60;

const TTC_PREMIER_FACTOR = 0.71;
const TTC_STANDARD_FACTOR = 1.3;

// ── HELPER FUNCTIONS ──
function handleFunnelPostHooks(record, meta) {
	// H10: Tour Funnel TTC — Premier 0.71x, Standard 1.3x.
	const segment = meta?.profile?.agent_tier;
	if (Array.isArray(record) && record.length > 1) {
		const factor = (
			segment === "Premier" ? TTC_PREMIER_FACTOR :
			segment === "Standard" ? TTC_STANDARD_FACTOR :
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
	// UTC mode is load-bearing: dayjs.unix() returns a LOCAL-mode instance,
	// and local .add(N, "days") does calendar-day arithmetic — it slips 1h
	// across the March DST spring-forward, making every day-boundary window
	// (and therefore the generated data) depend on the host timezone. The
	// H2 rate pin visibly cut off at 23:00 UTC on its last day before this.
	const datasetStart = dayjs.unix(meta.datasetStart).utc();
	const userEvents = record;
	const profile = meta.profile;

	// Stamp superProps from profile for consistency
	userEvents.forEach(e => {
		e.user_type = profile.user_type;
		e.preferred_location = profile.preferred_location;
		e.property_preference = profile.property_preference;
	});

	// HOOK 1: SPRING BUYING SEASON — d30-60 tour duration 3x, offer_price 2.5x
	// HOOK 2: MORTGAGE RATE SHOCK — d75-89 mortgage_rate pinned 7.5
	// HOOK 7: LUXURY LISTING RELEASE — post-d50, 3% of listings priced $5M-$15M
	const springStart = datasetStart.add(SPRING_START_DAY, "days");
	const springEnd = datasetStart.add(SPRING_END_DAY, "days");
	const shockStart = datasetStart.add(SHOCK_START_DAY, "days");
	const shockEnd = datasetStart.add(SHOCK_END_DAY, "days");
	const luxuryStart = datasetStart.add(LUXURY_RELEASE_DAY, "days");
	userEvents.forEach(e => {
		const t = dayjs.utc(e.time);
		const inSpring = (t.isAfter(springStart) || t.isSame(springStart)) && t.isBefore(springEnd);
		if (inSpring && e.event === "tour scheduled" && typeof e.duration_mins === "number") {
			e.duration_mins = Math.round(e.duration_mins * SPRING_TOUR_DURATION_MULT);
		}
		// Spring offer_price boost moved to end (after all cloning)
		if (e.event === "mortgage pre-approval") {
			if ((t.isAfter(shockStart) || t.isSame(shockStart)) && t.isBefore(shockEnd)) {
				e.mortgage_rate = SHOCK_MORTGAGE_RATE;
			}
		}
		if (e.event === "property listed" && t.isAfter(luxuryStart) && chance.bool({ likelihood: LUXURY_LISTING_LIKELIHOOD })) {
			e.listing_price = chance.integer({ min: LUXURY_PRICE_MIN, max: LUXURY_PRICE_MAX });
		}
	});

	const firstEventTime = userEvents.length > 0 ? dayjs.utc(userEvents[0].time) : null;

	// HOOK 3: SAVED-SEARCH RETENTION — early savers (saved-search-created
	// in first 7 days) get extra cloned view + tour events. Non-savers
	// lose 80% of events after day 30. No flag.
	const day7 = firstEventTime ? firstEventTime.add(SAVED_SEARCH_WINDOW_DAYS, "days") : null;
	const day30 = datasetStart.add(NON_SAVER_CUTOFF_DAY, "days");
	const hasSavedSearch = day7 ? userEvents.some(e =>
		e.event === "saved search created" && dayjs.utc(e.time).isBefore(day7)
	) : false;

	if (hasSavedSearch) {
		const viewTemplate = userEvents.find(e => e.event === "property viewed");
		const tourTemplate = userEvents.find(e => e.event === "tour scheduled");
		if (viewTemplate) {
			const extras = chance.integer({ min: SAVED_SEARCH_VIEW_CLONES_MIN, max: SAVED_SEARCH_VIEW_CLONES_MAX });
			for (let i = 0; i < extras; i++) {
				const offset = chance.integer({ min: 10, max: NUM_DAYS - 10 });
				userEvents.push({
					...viewTemplate,
					time: datasetStart.add(offset, "days").add(chance.integer({ min: 0, max: 23 }), "hours").toISOString(),
					user_id: viewTemplate.user_id,
					listing_id: `LST-${chance.integer({ min: 10000, max: 99999 })}`,
					listing_price: chance.integer({ min: 200000, max: 1200000 }),
				});
			}
		}
		if (tourTemplate) {
			const extras = chance.integer({ min: SAVED_SEARCH_TOUR_CLONES_MIN, max: SAVED_SEARCH_TOUR_CLONES_MAX });
			for (let i = 0; i < extras; i++) {
				const offset = chance.integer({ min: 15, max: NUM_DAYS - 10 });
				userEvents.push({
					...tourTemplate,
					time: datasetStart.add(offset, "days").add(chance.integer({ min: 8, max: 18 }), "hours").toISOString(),
					user_id: tourTemplate.user_id,
					listing_id: `LST-${chance.integer({ min: 10000, max: 99999 })}`,
				});
			}
		}
	} else {
		for (let i = userEvents.length - 1; i >= 0; i--) {
			const evt = userEvents[i];
			if (dayjs.utc(evt.time).isAfter(day30) && chance.bool({ likelihood: NON_SAVER_DROP_LIKELIHOOD })) {
				userEvents.splice(i, 1);
			}
		}
	}

	// HOOK 4: PRE-APPROVED BUYER CONVERSION — clone 4-6 extra
	// offer-submitted events for users with a mortgage pre-approval
	// event. No flag.
	const hasPreApproval = userEvents.some(e => e.event === "mortgage pre-approval");
	if (hasPreApproval) {
		profile.pre_approval_status = "approved";
		const offerTemplate = userEvents.find(e => e.event === "offer submitted");
		if (offerTemplate) {
			const extras = chance.integer({ min: PRE_APPROVAL_OFFER_CLONES_MIN, max: PRE_APPROVAL_OFFER_CLONES_MAX });
			for (let i = 0; i < extras; i++) {
				const offset = chance.integer({ min: 20, max: NUM_DAYS - 5 });
				userEvents.push({
					...offerTemplate,
					time: datasetStart.add(offset, "days").add(chance.integer({ min: 8, max: 20 }), "hours").toISOString(),
					user_id: offerTemplate.user_id,
					listing_id: `LST-${chance.integer({ min: 10000, max: 99999 })}`,
					offer_price: chance.integer({ min: 250000, max: 1200000 }),
					listing_price: chance.integer({ min: 250000, max: 1200000 }),
				});
			}
		}
	}

	// HOOK 5: TOP-TIER AGENT ADVANTAGE — Premier agents get 2 extra
	// cloned listings per existing (3x rate) and 1 extra clone per
	// sale (2x rate). Reads agent_tier from profile. No flag.
	if (profile.agent_tier === "Premier") {
		const listTemplate = userEvents.find(e => e.event === "property listed");
		const soldTemplate = userEvents.find(e => e.event === "property sold");

		if (listTemplate) {
			const existingListings = userEvents.filter(e => e.event === "property listed").length;
			const extras = existingListings * PREMIER_LISTING_CLONE_MULT;
			for (let i = 0; i < extras; i++) {
				const offset = chance.integer({ min: 5, max: NUM_DAYS - 5 });
				userEvents.push({
					...listTemplate,
					time: datasetStart.add(offset, "days").add(chance.integer({ min: 8, max: 18 }), "hours").toISOString(),
					user_id: listTemplate.user_id,
					listing_price: chance.integer({ min: 300000, max: 1500000 }),
					listing_status: chance.pickone(["active", "pending", "coming soon"]),
				});
			}
		}
		if (soldTemplate) {
			const existingSales = userEvents.filter(e => e.event === "property sold").length;
			const extras = existingSales * PREMIER_SALE_CLONE_MULT;
			for (let i = 0; i < extras; i++) {
				const offset = chance.integer({ min: 10, max: NUM_DAYS - 5 });
				userEvents.push({
					...soldTemplate,
					time: datasetStart.add(offset, "days").add(chance.integer({ min: 9, max: 17 }), "hours").toISOString(),
					user_id: soldTemplate.user_id,
					sale_price: chance.integer({ min: 300000, max: 1500000 }),
					days_on_market: chance.integer({ min: 5, max: 90 }),
				});
			}
		}
	}

	// HOOK 6: TOUR-TO-OFFER POWER USERS — users with both virtual
	// tour AND in-person tour get 5-7 extra cloned offers. No flag.
	const hasVirtualTour = userEvents.some(e => e.event === "virtual tour");
	const hasInPersonTour = userEvents.some(e => e.event === "in-person tour");
	if (hasVirtualTour && hasInPersonTour) {
		const offerTemplate = userEvents.find(e => e.event === "offer submitted");
		if (offerTemplate) {
			const extras = chance.integer({ min: DUAL_TOUR_OFFER_CLONES_MIN, max: DUAL_TOUR_OFFER_CLONES_MAX });
			for (let i = 0; i < extras; i++) {
				const offset = chance.integer({ min: 15, max: NUM_DAYS - 5 });
				userEvents.push({
					...offerTemplate,
					time: datasetStart.add(offset, "days").add(chance.integer({ min: 8, max: 20 }), "hours").toISOString(),
					user_id: offerTemplate.user_id,
					listing_id: `LST-${chance.integer({ min: 10000, max: 99999 })}`,
					offer_price: chance.integer({ min: 300000, max: 1500000 }),
					listing_price: chance.integer({ min: 300000, max: 1500000 }),
				});
			}
		}
	}

	// HOOK 7 (cont): LUXURY LISTING RELEASE — ~3% of users (by hash)
	// get 3-6 extra luxury property-viewed events after day 50. No flag.
	if (userEvents.length > 0) {
		const userId = userEvents[0].user_id || "";
		const isLuxuryBrowser = typeof userId === "string" && userId.length > 0 && userId.charCodeAt(0) % LUXURY_USER_HASH_MOD === 0;
		if (isLuxuryBrowser) {
			const viewTemplate = userEvents.find(e => e.event === "property viewed");
			if (viewTemplate) {
				const extras = chance.integer({ min: LUXURY_VIEW_CLONES_MIN, max: LUXURY_VIEW_CLONES_MAX });
				for (let i = 0; i < extras; i++) {
					const offset = chance.integer({ min: LUXURY_RELEASE_DAY, max: NUM_DAYS - 5 });
					userEvents.push({
						...viewTemplate,
						time: datasetStart.add(offset, "days").add(chance.integer({ min: 9, max: 21 }), "hours").toISOString(),
						user_id: viewTemplate.user_id,
						listing_id: `LST-${chance.integer({ min: 90000, max: 99999 })}`,
						listing_price: chance.integer({ min: LUXURY_PRICE_MIN, max: LUXURY_PRICE_MAX }),
						property_type: chance.pickone(["Single Family", "Condo"]),
						bedrooms: chance.integer({ min: 4, max: 8 }),
						square_feet: chance.integer({ min: 4000, max: 15000 }),
					});
				}
			}
		}
	}

	// HOOK 8: COLD-LEAD CHURN — users who view but never save in
	// first 14 days lose 90% of post-day-14 events. No flag.
	const day14 = firstEventTime ? firstEventTime.add(COLD_LEAD_WINDOW_DAYS, "days") : null;
	if (day14) {
		const earlyEvents = userEvents.filter(e => dayjs.utc(e.time).isBefore(day14));
		const hasView = earlyEvents.some(e => e.event === "property viewed");
		const hasSave = earlyEvents.some(e => e.event === "property saved");
		if (hasView && !hasSave) {
			for (let i = userEvents.length - 1; i >= 0; i--) {
				const evt = userEvents[i];
				if (dayjs.utc(evt.time).isAfter(day14) && chance.bool({ likelihood: COLD_LEAD_DROP_LIKELIHOOD })) {
					userEvents.splice(i, 1);
				}
			}
		}
	}

	// HOOK 9: PROPERTY-VIEWED MAGIC NUMBER (no flags)
	// Sweet 6-12 views → +30% offer_price on offer submitted events.
	// Over 13+ → drop 60% of offer submitted events (tire-kickers).
	const viewCount = userEvents.filter(e => e.event === "property viewed").length;
	if (viewCount >= VIEW_SWEET_MIN && viewCount <= VIEW_SWEET_MAX) {
		userEvents.forEach(e => {
			if (e.event === "offer submitted" && typeof e.offer_price === "number") {
				e.offer_price = Math.round(e.offer_price * VIEW_OFFER_PRICE_BOOST);
			}
		});
	} else if (viewCount >= VIEW_OVER_THRESHOLD) {
		for (let i = userEvents.length - 1; i >= 0; i--) {
			if (userEvents[i].event === "offer submitted" && chance.bool({ likelihood: VIEW_OVER_OFFER_DROP_LIKELIHOOD })) {
				userEvents.splice(i, 1);
			}
		}
	}

	// HOOK 2 (cont): MORTGAGE RATE SHOCK — drop 45% of post-day-75
	// offer-submitted events. Runs AFTER all offer cloning (H4/H6) so the
	// drop hits clones too: pre-approved/dual-tour clones spread uniformly
	// to day 115 and would otherwise flood post-d75 volume and invert the
	// documented drop (measured share RISING 0.132 -> 0.154 when the drop
	// ran pre-clone). No flag.
	const day75 = datasetStart.add(SHOCK_START_DAY, "days");
	for (let i = userEvents.length - 1; i >= 0; i--) {
		const evt = userEvents[i];
		if (evt.event === "offer submitted" && dayjs.utc(evt.time).isAfter(day75) && chance.bool({ likelihood: SHOCK_OFFER_DROP_LIKELIHOOD })) {
			userEvents.splice(i, 1);
		}
	}

	// HOOK 1 (cont): Spring offer_price boost — runs AFTER all cloning
	// so cloned offers in the spring window also get the 2.5x boost
	userEvents.forEach(e => {
		if (e.event !== "offer submitted") return;
		const t = dayjs.utc(e.time);
		if ((t.isAfter(springStart) || t.isSame(springStart)) && t.isBefore(springEnd)) {
			e.offer_price = Math.floor((e.offer_price || 400000) * SPRING_OFFER_PRICE_MULT);
		}
	});

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
		hasBrowser: true,
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

	soup: "growth",

	scdProps: {
		agent_tier: {
			values: ["Standard", "Standard", "Standard", "Premier"],
			frequency: "month",
			timing: "fuzzy",
			max: 4
		}
	},

	funnels: [
		{
			sequence: ["account created", "property search", "property viewed"],
			isFirstFunnel: true,
			conversionRate: 80,
			timeToConvert: 0.5,
			name: "Buyer Journey"
		},
		{
			sequence: ["property viewed", "tour scheduled", "offer submitted"],
			conversionRate: 40,
			timeToConvert: 24,
			weight: 5,
			name: "Tour Funnel",
			reentry: true,
		},
		{
			sequence: ["property listed", "open house attended", "property sold"],
			conversionRate: 35,
			timeToConvert: 48,
			weight: 3,
			name: "Seller Funnel"
		}
	],

	events: [
		{
			event: "account created",
			weight: 1,
			isFirstEvent: true,
			isAuthEvent: true,
			properties: {
				signup_method: ["email", "google", "apple", "facebook"],
			}
		},
		{
			event: "property search",
			weight: 10,
			properties: {
				location: ["Manhattan", "Brooklyn", "Austin", "Miami", "San Francisco", "Denver", "Seattle", "Chicago", "Nashville", "Portland"],
				price_range_min: u.weighNumRange(100000, 500000, 0.5, 40),
				price_range_max: u.weighNumRange(300000, 2000000, 0.5, 40),
				bedrooms: [1, 2, 2, 3, 3, 3, 4, 4, 5],
				property_type: ["Single Family", "Condo", "Townhouse", "Multi-Family"],
			}
		},
		{
			event: "property viewed",
			weight: 12,
			isStrictEvent: false,
			properties: {
				listing_id: () => `LST-${chance.integer({ min: 10000, max: 99999 })}`,
				listing_price: u.weighNumRange(150000, 1500000, 0.4, 60),
				property_type: ["Single Family", "Condo", "Townhouse", "Multi-Family"],
				bedrooms: [1, 2, 2, 3, 3, 3, 4, 4, 5],
				square_feet: u.weighNumRange(600, 5000, 0.5, 50),
			}
		},
		{
			event: "property saved",
			weight: 5,
			properties: {
				listing_id: () => `LST-${chance.integer({ min: 10000, max: 99999 })}`,
				listing_price: u.weighNumRange(150000, 1500000, 0.4, 40),
			}
		},
		{
			event: "saved search created",
			weight: 3,
			properties: {
				location: ["Manhattan", "Brooklyn", "Austin", "Miami", "San Francisco", "Denver", "Seattle", "Chicago", "Nashville", "Portland"],
				criteria_count: u.weighNumRange(2, 8, 0.8, 10),
			}
		},
		{
			event: "virtual tour",
			weight: 4,
			properties: {
				listing_id: () => `LST-${chance.integer({ min: 10000, max: 99999 })}`,
				duration_mins: u.weighNumRange(5, 45, 0.5, 30),
			}
		},
		{
			event: "in-person tour",
			weight: 3,
			properties: {
				listing_id: () => `LST-${chance.integer({ min: 10000, max: 99999 })}`,
				agent_id: () => `AGT-${chance.integer({ min: 1000, max: 9999 })}`,
			}
		},
		{
			event: "tour scheduled",
			weight: 4,
			isStrictEvent: false,
			properties: {
				listing_id: () => `LST-${chance.integer({ min: 10000, max: 99999 })}`,
				agent_id: () => `AGT-${chance.integer({ min: 1000, max: 9999 })}`,
				duration_mins: u.weighNumRange(5, 90, 0.5, 30),
			}
		},
		{
			event: "mortgage pre-approval",
			weight: 2,
			properties: {
				lender: ["Chase", "Wells Fargo", "Bank of America", "Rocket Mortgage", "United Wholesale", "loanDepot"],
				approved_amount: u.weighNumRange(200000, 1500000, 0.4, 40),
				mortgage_rate: u.weighNumRange(5.5, 7.5, 0.8, 20),
			}
		},
		{
			event: "offer submitted",
			weight: 2,
			isStrictEvent: false,
			properties: {
				listing_id: () => `LST-${chance.integer({ min: 10000, max: 99999 })}`,
				offer_price: u.weighNumRange(200000, 1500000, 0.4, 40),
				listing_price: u.weighNumRange(200000, 1500000, 0.4, 40),
			}
		},
		{
			event: "offer accepted",
			weight: 1,
			properties: {
				listing_id: () => `LST-${chance.integer({ min: 10000, max: 99999 })}`,
				final_price: u.weighNumRange(200000, 1500000, 0.4, 40),
			}
		},
		{
			event: "offer rejected",
			weight: 1,
			properties: {
				listing_id: () => `LST-${chance.integer({ min: 10000, max: 99999 })}`,
				reason: ["price too low", "competing offer", "seller changed mind", "inspection issues", "financing fell through"],
			}
		},
		{
			event: "property listed",
			weight: 3,
			isStrictEvent: false,
			properties: {
				listing_price: u.weighNumRange(200000, 1500000, 0.4, 50),
				property_type: ["Single Family", "Condo", "Townhouse", "Multi-Family"],
				bedrooms: [1, 2, 2, 3, 3, 3, 4, 4, 5],
				listing_status: ["active", "pending", "coming soon"],
			}
		},
		{
			event: "property sold",
			weight: 1,
			isStrictEvent: false,
			properties: {
				sale_price: u.weighNumRange(200000, 1500000, 0.4, 40),
				days_on_market: u.weighNumRange(5, 180, 0.4, 30),
			}
		},
		{
			event: "agent contacted",
			weight: 4,
			properties: {
				contact_method: ["phone", "email", "in-app message", "text"],
			}
		},
		{
			event: "open house attended",
			weight: 2,
			properties: {
				listing_id: () => `LST-${chance.integer({ min: 10000, max: 99999 })}`,
				attendees: u.weighNumRange(2, 30, 0.5, 15),
			}
		},
		{
			event: "review submitted",
			weight: 2,
			properties: {
				rating: [1, 2, 3, 3, 4, 4, 4, 5, 5, 5],
				review_type: ["agent", "property", "platform"],
			}
		}
	],

	superProps: {
		user_type: ["Buyer", "Buyer", "Buyer", "Agent", "Both"],
		preferred_location: ["Urban", "Suburban", "Rural"],
		property_preference: ["Single Family", "Condo", "Townhouse", "Multi-Family"],
	},

	userProps: {
		user_type: ["Buyer", "Buyer", "Buyer", "Agent", "Both"],
		preferred_location: ["Urban", "Suburban", "Rural"],
		property_preference: ["Single Family", "Condo", "Townhouse", "Multi-Family"],
		budget_max: u.weighNumRange(200000, 2000000, 0.4, 50),
		agent_tier: ["Standard", "Standard", "Standard", "Premier"],
		total_properties_viewed: u.weighNumRange(0, 100, 0.5, 30),
		pre_approval_status: ["none"],
	},

	groupKeys: [
		["brokerage_id", 200, ["property listed", "property sold", "agent contacted", "open house attended"]],
	],

	groupProps: {
		brokerage_id: {
			brokerage_name: ["Compass", "RE/MAX", "Keller Williams", "Coldwell Banker", "Century 21", "Sotheby's", "eXp Realty", "Redfin"],
			agent_count: u.weighNumRange(5, 200, 0.4, 30),
			region: ["Northeast", "Southeast", "Midwest", "Southwest", "West Coast", "Pacific Northwest"],
			avg_listing_price: u.weighNumRange(200000, 1500000, 0.4, 30),
		}
	},

	lookupTables: [],

	hook(record, type, meta) {
		if (type === "funnel-post") return handleFunnelPostHooks(record, meta);
		if (type === "everything") return handleEverythingHooks(record, meta);
		return record;
	}
};

export default config;

// ── STORIES (v1.6 verification contract) ──
/*
 * MEASUREMENT DOCTRINE — how these reads stay honest
 *
 * LITERAL WINDOW: datasetStart/datasetEnd are explicit (2026-01-01 →
 * 2026-05-01), no forward shift — day_idx = date_diff('day',
 * DATE '2026-01-01', t::DATE) matches the hook's datasetStart offsets
 * exactly. Day-50/75 boundaries are STRICT dayjs isAfter(midnight), so
 * structural "before day N" reads use day_idx < N (day-N events after
 * midnight are legitimately treated).
 *
 * IDENTITY: avgDevicePerUser: 2, but 'account created' is both
 * isFirstEvent and isAuthEvent — every user auths on their very first
 * event, so 0 device-only events exist and uid resolution through the
 * profiles' "anonymousIds" device map is total (asserted structurally
 * in H10). The everything hook stamps user_type/preferred_location/
 * property_preference from the profile onto every event (agreement 1.0).
 *
 * OFFER LEDGER: 'offer submitted' is touched by FIVE hooks, in hook
 * order: H4 clones (4-6, pre-approved users), H6 clones (5-7,
 * dual-tour users), H9 sweet +30% price / over 60% deletion, H2 45%
 * post-d75 deletion (moved AFTER all cloning — v1.6 surgery: when it
 * ran pre-clone, uniform-in-time clones flooded post-d75 and the
 * documented drop INVERTED, share 0.132→0.154), then H1 spring 2.5x
 * price boost LAST. Price reads therefore exclude the spring window;
 * volume reads use share-of-total-volume to cancel the growth soup.
 *
 * OUTPUT-COHORT EXACTNESS: H8 classifies cold leads AFTER H3/H7 view
 * clones and H3 deletions are in the array, and nothing after H8
 * touches views/saves in a user's first 14 days — so output first-14d
 * view/save cohorts equal the hook-time cohorts. Same for H9's view
 * count (H8 runs before H9; only offer deletions follow). H3's
 * saved-search-in-first-7d cohort survives all later deletions (they
 * only remove post-d14/post-d30 events).
 *
 * COUPLED COHORTS: pre-approved (56% of users) and dual-tour (33%)
 * overlap heavily and both clone offers, and the 13+-view bucket is
 * ~97% power-cloners. The H9 over-bucket deletion knob is 60% so the
 * plain cohort read nets the documented ~35%-fewer-offers (activity
 * coupling offsets ~25 points). H4/H6 reads follow the doc's plain
 * all-users cohort comparison; the narrative carries the overlap
 * decomposition.
 *
 * EMULATOR TTC (H10): primary read is the 2-step
 * ['property viewed','tour scheduled'] pair — the 3-step read's
 * offer-submitted anchor collides with H4/H6 offer clones at random
 * timestamps (greedy pairing attenuates the ratio toward 1: measured
 * 0.74 vs 2-step 0.56 against mechanism 0.71/1.3 = 0.546). Window
 * 31.2h = 24h generative x 1.3 Standard stretch, covering the
 * stretched support. The 3-step read stays as a directional secondary.
 */

const DATASET_START_DATE = "2026-01-01";

const ID_CTE = `
us AS (SELECT * FROM read_json_auto('{{PREFIX}}-USERS*.json', sample_size=-1, union_by_name=true)),
dm AS (SELECT unnest("anonymousIds") AS device_id, distinct_id FROM us),
ev AS (SELECT coalesce(m.distinct_id::VARCHAR, e.user_id::VARCHAR, e.device_id::VARCHAR) AS uid,
       e.time::TIMESTAMP AS t,
       date_diff('day', DATE '${DATASET_START_DATE}', e.time::TIMESTAMP::DATE) AS day_idx, e.*
FROM read_json_auto('{{PREFIX}}-EVENTS*.json', sample_size=-1, union_by_name=true) e
LEFT JOIN dm m ON e.device_id = m.device_id)`;

const PU_CTE = `
pu AS (SELECT e.uid, min(e.t) AS first_t, max(e.t) AS last_t,
  count(*) AS total_ev,
  count(*) FILTER (WHERE event = 'property viewed') AS views,
  count(*) FILTER (WHERE event = 'offer submitted') AS offers,
  count(*) FILTER (WHERE event = 'property listed') AS listings,
  count(*) FILTER (WHERE event = 'property sold') AS solds,
  count(*) FILTER (WHERE event = 'virtual tour') AS vtours,
  count(*) FILTER (WHERE event = 'in-person tour') AS iptours,
  count(*) FILTER (WHERE event = 'mortgage pre-approval') AS preapps
FROM ev e GROUP BY 1),
puu AS (SELECT p.*, u.agent_tier, u.user_type, u.pre_approval_status,
  EXISTS (SELECT 1 FROM ev s WHERE s.uid = p.uid AND s.event = 'saved search created'
          AND s.t < p.first_t + INTERVAL '${SAVED_SEARCH_WINDOW_DAYS} days') AS saver,
  EXISTS (SELECT 1 FROM ev v WHERE v.uid = p.uid AND v.event = 'property viewed'
          AND v.t < p.first_t + INTERVAL '${COLD_LEAD_WINDOW_DAYS} days') AS viewed14,
  EXISTS (SELECT 1 FROM ev sv WHERE sv.uid = p.uid AND sv.event = 'property saved'
          AND sv.t < p.first_t + INTERVAL '${COLD_LEAD_WINDOW_DAYS} days') AS saved14,
  (p.vtours >= 1 AND p.iptours >= 1) AS dual_tour,
  (p.preapps >= 1) AS preapproved
FROM pu p JOIN us u ON p.uid = u.distinct_id::VARCHAR)`;

const cellsOf = (rows, key) => Object.fromEntries((rows || []).map((r) => [r[key], r]));

export const stories = [
	{
		id: "H1-spring-season",
		hook: "H1",
		archetype: "temporal-inflection",
		narrative:
			`Days ${SPRING_START_DAY}-${SPRING_END_DAY}: offer_price x${SPRING_OFFER_PRICE_MULT} (runs LAST, ` +
			`hits clones in-window too) and tour duration_mins x${SPRING_TOUR_DURATION_MULT}. Price ratio reads ` +
			"slightly above the knob (2.64 measured) because sweet-spot +30% boosts distribute evenly across " +
			"zones. Duration ratio reads BELOW its 3x knob (~2.65): the duration boost runs before H3's " +
			"tour cloning, so boosted spring templates leak boosted durations outside the window and " +
			"unboosted templates leak in — a known dilution, bounded in the band.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT CASE WHEN day_idx BETWEEN ${SPRING_START_DAY} AND ${SPRING_END_DAY - 1} THEN 'spring' ELSE 'outside' END AS zone,
  count(*)::BIGINT AS n, count(DISTINCT uid)::BIGINT AS user_count, avg(offer_price) AS price
FROM ev WHERE event = 'offer submitted' GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "zone");
					const s = by.spring, o = by.outside;
					if (!s || !o || Number(s.n) < 3000 || Number(o.n) < 8000) {
						return { verdict: "WEAK", detail: `offer volume too small: spring=${s?.n ?? 0} outside=${o?.n ?? 0}` };
					}
					const ratio = Number(s.price) / Number(o.price);
					const detail = `spring/outside avg offer_price=${ratio.toFixed(3)} (knob ${SPRING_OFFER_PRICE_MULT}x; n=${s.n}/${o.n})`;
					if (ratio >= 2.35 && ratio <= 2.95) return { verdict: "NAILED", detail };
					if (ratio >= 2.1 && ratio <= 3.2) return { verdict: "STRONG", detail };
					if (ratio >= 1.5) return { verdict: "WEAK", detail };
					return { verdict: ratio <= 1 ? "INVERSE" : "NONE", detail };
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT CASE WHEN day_idx BETWEEN ${SPRING_START_DAY} AND ${SPRING_END_DAY - 1} THEN 'spring' ELSE 'outside' END AS zone,
  count(*)::BIGINT AS n, avg(duration_mins) AS dur
FROM ev WHERE event = 'tour scheduled' GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "zone");
					const s = by.spring, o = by.outside;
					if (!s || !o || Number(s.n) < 1500 || Number(o.n) < 8000) {
						return { verdict: "WEAK", detail: `tour volume too small: spring=${s?.n ?? 0} outside=${o?.n ?? 0}` };
					}
					const ratio = Number(s.dur) / Number(o.dur);
					const detail = `spring/outside avg tour duration=${ratio.toFixed(3)} (knob ${SPRING_TOUR_DURATION_MULT}x diluted by H3 clone leak; n=${s.n}/${o.n})`;
					if (ratio >= 2.3 && ratio <= 3.05) return { verdict: "NAILED", detail };
					if (ratio >= 2.0 && ratio <= 3.3) return { verdict: "STRONG", detail };
					if (ratio >= 1.5) return { verdict: "WEAK", detail };
					return { verdict: ratio <= 1 ? "INVERSE" : "NONE", detail };
				},
			},
		],
	},
	{
		id: "H2-rate-shock",
		hook: "H2",
		archetype: "temporal-inflection",
		narrative:
			`Days ${SHOCK_START_DAY}-${SHOCK_END_DAY}: mortgage_rate PINNED to ${SHOCK_MORTGAGE_RATE} on every ` +
			"pre-approval event in-window (structural: min=max=7.5). Post-d75 offers face a " +
			`${SHOCK_OFFER_DROP_LIKELIHOOD}% deletion that runs AFTER all cloning (v1.6 surgery — see doctrine). ` +
			"Volume read uses offer share-of-total-volume post/pre to cancel the growth soup: visible ratio = " +
			"0.55 knob x ~1.40 clone-flood drift (uniform-in-time clones raise the counterfactual post-window " +
			"share) = ~0.77 measured.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT CASE WHEN day_idx BETWEEN ${SHOCK_START_DAY} AND ${SHOCK_END_DAY - 1} THEN 'shock' ELSE 'outside' END AS zone,
  count(*)::BIGINT AS n, avg(mortgage_rate) AS rate, min(mortgage_rate) AS mn, max(mortgage_rate) AS mx
FROM ev WHERE event = 'mortgage pre-approval' GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "zone");
					const s = by.shock, o = by.outside;
					if (!s || !o || Number(s.n) < 200 || Number(o.n) < 3000) {
						return { verdict: "WEAK", detail: `pre-approval volume too small: shock=${s?.n ?? 0} outside=${o?.n ?? 0}` };
					}
					const pinned = Number(s.mn) === SHOCK_MORTGAGE_RATE && Number(s.mx) === SHOCK_MORTGAGE_RATE;
					const outsideRate = Number(o.rate);
					const detail = `shock rate min=${s.mn} max=${s.mx} (pin ${SHOCK_MORTGAGE_RATE}); outside avg=${outsideRate.toFixed(3)} (n=${s.n}/${o.n})`;
					if (pinned && outsideRate >= 6.2 && outsideRate <= 6.5) return { verdict: "NAILED", detail };
					if (Number(s.rate) >= 7.45 && outsideRate < 7.0) return { verdict: "STRONG", detail };
					if (Number(s.rate) > outsideRate + 0.5) return { verdict: "WEAK", detail };
					return { verdict: "NONE", detail };
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT (day_idx > ${SHOCK_START_DAY}) AS post,
  count(*) FILTER (WHERE event = 'offer submitted')::BIGINT AS offers,
  count(*)::BIGINT AS all_ev,
  count(*) FILTER (WHERE event = 'offer submitted')::DOUBLE / count(*) AS offer_share
FROM ev GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "post");
					const pre = by.false, post = by.true;
					if (!pre || !post || Number(post.offers) < 2500 || Number(pre.offers) < 8000) {
						return { verdict: "WEAK", detail: `offer volume too small: pre=${pre?.offers ?? 0} post=${post?.offers ?? 0}` };
					}
					const ratio = Number(post.offer_share) / Number(pre.offer_share);
					const detail = `offer share-of-volume post/pre d${SHOCK_START_DAY}=${ratio.toFixed(3)} (0.55 knob x ~1.40 clone drift; shares ${Number(pre.offer_share).toFixed(4)}→${Number(post.offer_share).toFixed(4)})`;
					if (ratio >= 0.66 && ratio <= 0.87) return { verdict: "NAILED", detail };
					if (ratio >= 0.55 && ratio <= 0.95) return { verdict: "STRONG", detail };
					if (ratio < 1) return { verdict: "WEAK", detail };
					return { verdict: "INVERSE", detail };
				},
			},
		],
	},
	{
		id: "H3-saved-search-retention",
		hook: "H3",
		archetype: "retention-divergence",
		narrative:
			`Savers (saved search created within ${SAVED_SEARCH_WINDOW_DAYS}d of first event, ~14% of users) get ` +
			`${SAVED_SEARCH_VIEW_CLONES_MIN}-${SAVED_SEARCH_VIEW_CLONES_MAX} view + ${SAVED_SEARCH_TOUR_CLONES_MIN}-${SAVED_SEARCH_TOUR_CLONES_MAX} ` +
			`tour clones spread to day ~110; non-savers lose ${NON_SAVER_DROP_LIKELIHOOD}% of post-day-${NON_SAVER_CUTOFF_DAY} ` +
			"events (calendar). Post-d30 events/user ratio compounds clones x deletion x the cold-lead overlap " +
			"(97% of savers are NOT cold leads — property saved co-occurs); April-activity split is the doc's " +
			"retention read: savers ~0.98 active (clones guarantee late events), non-savers ~0.55.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${PU_CTE}
SELECT saver, count(*)::BIGINT AS user_count,
  avg((SELECT count(*) FROM ev e WHERE e.uid = puu.uid AND e.day_idx > ${NON_SAVER_CUTOFF_DAY})) AS ev_post30
FROM puu GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "saver");
					const sv = by.true, non = by.false;
					if (!sv || !non || Number(sv.user_count) < 600 || Number(non.user_count) < 3000) {
						return { verdict: "WEAK", detail: `cohorts too small: savers=${sv?.user_count ?? 0} non=${non?.user_count ?? 0}` };
					}
					const ratio = Number(sv.ev_post30) / Number(non.ev_post30);
					const detail = `post-d${NON_SAVER_CUTOFF_DAY} events/user savers/non=${ratio.toFixed(2)} (${Number(sv.ev_post30).toFixed(1)} vs ${Number(non.ev_post30).toFixed(1)}; n=${sv.user_count}/${non.user_count})`;
					if (ratio >= 5.2 && ratio <= 8.5) return { verdict: "NAILED", detail };
					if (ratio >= 4.0 && ratio <= 10.5) return { verdict: "STRONG", detail };
					if (ratio >= 2.0) return { verdict: "WEAK", detail };
					return { verdict: ratio <= 1 ? "INVERSE" : "NONE", detail };
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${PU_CTE}
SELECT saver, count(*)::BIGINT AS user_count,
  avg((last_t >= TIMESTAMP '2026-04-01')::INT) AS active_apr
FROM puu WHERE first_t < TIMESTAMP '2026-03-01' GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "saver");
					const sv = by.true, non = by.false;
					if (!sv || !non || Number(sv.user_count) < 550 || Number(non.user_count) < 2800) {
						return { verdict: "WEAK", detail: `cohorts too small: savers=${sv?.user_count ?? 0} non=${non?.user_count ?? 0}` };
					}
					const a = Number(sv.active_apr), b = Number(non.active_apr);
					const detail = `active-in-April (born pre-Mar): savers=${a.toFixed(4)} non-savers=${b.toFixed(4)} (n=${sv.user_count}/${non.user_count})`;
					if (a >= 0.96 && b >= 0.45 && b <= 0.66) return { verdict: "NAILED", detail };
					if (a >= 0.92 && b >= 0.38 && b <= 0.72) return { verdict: "STRONG", detail };
					if (a > b + 0.1) return { verdict: "WEAK", detail };
					return { verdict: a <= b ? "INVERSE" : "NONE", detail };
				},
			},
		],
	},
	{
		id: "H4-preapproval-conversion",
		hook: "H4",
		archetype: "cohort-prop-scale",
		narrative:
			`Users with a mortgage pre-approval event get ${PRE_APPROVAL_OFFER_CLONES_MIN}-${PRE_APPROVAL_OFFER_CLONES_MAX} ` +
			"cloned offers (needs an existing offer template) and profile pre_approval_status flipped to " +
			"'approved'. Doc read is the plain all-users cohort (>=1 pre-approval event in output): 4.44 " +
			"measured — mean 5 clones diluted by churn (H3/H8 delete clones for churned users), the H9 60% " +
			"over-bucket deletion (the bucket is preapproval-heavy), and the post-d75 H2 drop. The profile " +
			"flag is a strict superset of the output-event cohort (H8 can delete the pre-approval event " +
			"after H4 ran) — subset relation asserted structurally.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${PU_CTE}
SELECT preapproved, count(*)::BIGINT AS user_count, avg(offers) AS offers_pu
FROM puu GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "preapproved");
					const a = by.true, b = by.false;
					if (!a || !b || Number(a.user_count) < 1500 || Number(b.user_count) < 2500) {
						return { verdict: "WEAK", detail: `cohorts too small: preapproved=${a?.user_count ?? 0} rest=${b?.user_count ?? 0}` };
					}
					const ratio = Number(a.offers_pu) / Number(b.offers_pu);
					const detail = `offers/user preapproved/rest=${ratio.toFixed(2)} (${Number(a.offers_pu).toFixed(2)} vs ${Number(b.offers_pu).toFixed(2)}; n=${a.user_count}/${b.user_count})`;
					if (ratio >= 3.7 && ratio <= 5.3) return { verdict: "NAILED", detail };
					if (ratio >= 3.0 && ratio <= 6.2) return { verdict: "STRONG", detail };
					if (ratio >= 1.5) return { verdict: "WEAK", detail };
					return { verdict: ratio <= 1 ? "INVERSE" : "NONE", detail };
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${PU_CTE}
SELECT count(*)::BIGINT AS n,
  avg((pre_approval_status = 'approved')::INT) AS flagged
FROM puu WHERE preapproved`,
				},
				assert: (rows) => {
					const r = rows?.[0];
					if (!r || Number(r.n) < 1500) {
						return { verdict: "WEAK", detail: `cohort too small: n=${r?.n ?? 0}` };
					}
					const f = Number(r.flagged);
					const detail = `profile pre_approval_status='approved' on ${f.toFixed(4)} of ${r.n} users with a surviving pre-approval event (hook flips the profile whenever the event existed at hook time)`;
					if (f === 1) return { verdict: "NAILED", detail };
					if (f >= 0.995) return { verdict: "STRONG", detail };
					return { verdict: "NONE", detail };
				},
			},
		],
	},
	{
		id: "H5-premier-agents",
		hook: "H5",
		archetype: "cohort-prop-scale",
		narrative:
			`Premier-tier profiles (pool 3:1 Standard) get ${PREMIER_LISTING_CLONE_MULT} extra cloned listings per ` +
			`existing (3x rate) and ${PREMIER_SALE_CLONE_MULT} extra sale per existing (2x rate), cloned AFTER the ` +
			"H3 non-saver deletion (clones multiply the surviving count) but BEFORE the H8 cold-lead deletion " +
			"(which prunes clones tier-independently, uniform-in-time clones slightly more exposed than " +
			"soup-shaped organics — measured 2.77 vs the 3x knob, 1.90 vs the 2x).",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${PU_CTE}
SELECT agent_tier, count(*)::BIGINT AS user_count, avg(listings) AS listings_pu, avg(solds) AS solds_pu
FROM puu GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "agent_tier");
					const p = by.Premier, s = by.Standard;
					if (!p || !s || Number(p.user_count) < 1100 || Number(s.user_count) < 2800) {
						return { verdict: "WEAK", detail: `tiers too small: Premier=${p?.user_count ?? 0} Standard=${s?.user_count ?? 0}` };
					}
					const ratio = Number(p.listings_pu) / Number(s.listings_pu);
					const detail = `listings/user Premier/Standard=${ratio.toFixed(3)} (${Number(p.listings_pu).toFixed(2)} vs ${Number(s.listings_pu).toFixed(2)}; knob 3x minus churn asymmetry; n=${p.user_count}/${s.user_count})`;
					if (ratio >= 2.45 && ratio <= 3.10) return { verdict: "NAILED", detail };
					if (ratio >= 2.2 && ratio <= 3.35) return { verdict: "STRONG", detail };
					if (ratio >= 1.5) return { verdict: "WEAK", detail };
					return { verdict: ratio <= 1 ? "INVERSE" : "NONE", detail };
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${PU_CTE}
SELECT agent_tier, count(*)::BIGINT AS user_count, avg(solds) AS solds_pu
FROM puu GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "agent_tier");
					const p = by.Premier, s = by.Standard;
					if (!p || !s || Number(p.user_count) < 1100 || Number(s.user_count) < 2800) {
						return { verdict: "WEAK", detail: `tiers too small: Premier=${p?.user_count ?? 0} Standard=${s?.user_count ?? 0}` };
					}
					const ratio = Number(p.solds_pu) / Number(s.solds_pu);
					const detail = `sales/user Premier/Standard=${ratio.toFixed(3)} (${Number(p.solds_pu).toFixed(3)} vs ${Number(s.solds_pu).toFixed(3)}; knob 2x minus churn asymmetry; n=${p.user_count}/${s.user_count})`;
					if (ratio >= 1.65 && ratio <= 2.15) return { verdict: "NAILED", detail };
					if (ratio >= 1.5 && ratio <= 2.35) return { verdict: "STRONG", detail };
					if (ratio >= 1.2) return { verdict: "WEAK", detail };
					return { verdict: ratio <= 1 ? "INVERSE" : "NONE", detail };
				},
			},
		],
	},
	{
		id: "H6-dual-tour-buyers",
		hook: "H6",
		archetype: "cohort-prop-scale",
		narrative:
			`Users with BOTH virtual tour AND in-person tour events (~33%) get ${DUAL_TOUR_OFFER_CLONES_MIN}-${DUAL_TOUR_OFFER_CLONES_MAX} ` +
			"cloned offers. Doc read is the plain all-users compound cohort: 4.98 measured (mean 6 clones " +
			"diluted by the same churn/H9/H2 ledger as H4; 87% of dual-tour users are also pre-approved). " +
			"The overlap decomposition re-reads the effect on the pre-approval-free margin: dual-only vs " +
			"neither ~4.8x. Exclusion uses the profile flag (exact hook-time cohort, set unconditionally " +
			"at H4) — the event-cohort proxy under-excludes users whose pre-approval event H8 later " +
			"deleted but who kept their H4 clones, contaminating the baseline (~3.5x).",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${PU_CTE}
SELECT dual_tour, count(*)::BIGINT AS user_count, avg(offers) AS offers_pu
FROM puu GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "dual_tour");
					const a = by.true, b = by.false;
					if (!a || !b || Number(a.user_count) < 1300 || Number(b.user_count) < 2600) {
						return { verdict: "WEAK", detail: `cohorts too small: dual=${a?.user_count ?? 0} rest=${b?.user_count ?? 0}` };
					}
					const ratio = Number(a.offers_pu) / Number(b.offers_pu);
					const detail = `offers/user dual-tour/rest=${ratio.toFixed(2)} (${Number(a.offers_pu).toFixed(2)} vs ${Number(b.offers_pu).toFixed(2)}; n=${a.user_count}/${b.user_count})`;
					if (ratio >= 4.2 && ratio <= 5.9) return { verdict: "NAILED", detail };
					if (ratio >= 3.5 && ratio <= 6.8) return { verdict: "STRONG", detail };
					if (ratio >= 1.5) return { verdict: "WEAK", detail };
					return { verdict: ratio <= 1 ? "INVERSE" : "NONE", detail };
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${PU_CTE}
SELECT dual_tour, count(*)::BIGINT AS user_count, avg(offers) AS offers_pu
FROM puu WHERE pre_approval_status != 'approved' GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "dual_tour");
					const a = by.true, b = by.false;
					if (!a || !b || Number(a.user_count) < 110 || Number(b.user_count) < 1500) {
						return { verdict: "WEAK", detail: `cohorts too small: dual-only=${a?.user_count ?? 0} neither=${b?.user_count ?? 0}` };
					}
					const ratio = Number(a.offers_pu) / Number(b.offers_pu);
					const detail = `offers/user dual-only/neither (profile-flag pre-approved excluded)=${ratio.toFixed(2)} (${Number(a.offers_pu).toFixed(2)} vs ${Number(b.offers_pu).toFixed(2)}; n=${a.user_count}/${b.user_count})`;
					if (ratio >= 3.9 && ratio <= 5.8) return { verdict: "NAILED", detail };
					if (ratio >= 3.2 && ratio <= 6.6) return { verdict: "STRONG", detail };
					if (ratio >= 1.5) return { verdict: "WEAK", detail };
					return { verdict: ratio <= 1 ? "INVERSE" : "NONE", detail };
				},
			},
		],
	},
	{
		id: "H7-luxury-release",
		hook: "H7",
		archetype: "temporal-inflection",
		narrative:
			`Post-day-${LUXURY_RELEASE_DAY}, ${LUXURY_LISTING_LIKELIHOOD}% of ORGANIC listings get price ` +
			`$${LUXURY_PRICE_MIN / 1e6}M-$${LUXURY_PRICE_MAX / 1e6}M (the mutation runs before H5's Premier clones, whose ` +
			"prices cap at $1.5M — visible share = 3% x organic share of listings 0.643 (tier mix: " +
			"1/(1+2x0.2775)) = 1.93%). Organic prices cap at $1.5M so ANY $2M+ listing is engineered — " +
			"strictly-before-day-50 count is structurally 0. Luxury-browser cohort: uuid first char 'c' " +
			"(charCodeAt%33==0, 1/16 of users) gets " +
			`${LUXURY_VIEW_CLONES_MIN}-${LUXURY_VIEW_CLONES_MAX} $5M+ view clones — non-browsers have exactly 0.`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT count(*) FILTER (WHERE day_idx < ${LUXURY_RELEASE_DAY} AND listing_price >= 2000000)::BIGINT AS lux_pre,
  count(*) FILTER (WHERE day_idx >= ${LUXURY_RELEASE_DAY})::BIGINT AS post_n,
  count(*) FILTER (WHERE day_idx >= ${LUXURY_RELEASE_DAY} AND listing_price >= 2000000)::BIGINT AS post_lux,
  min(listing_price) FILTER (WHERE listing_price >= 2000000) AS lux_floor
FROM ev WHERE event = 'property listed'`,
				},
				assert: (rows) => {
					const r = rows?.[0];
					if (!r || Number(r.post_n) < 5000) {
						return { verdict: "WEAK", detail: `too few post-d${LUXURY_RELEASE_DAY} listings: ${r?.post_n ?? 0}` };
					}
					const share = Number(r.post_lux) / Number(r.post_n);
					const pre = Number(r.lux_pre);
					const detail = `$2M+ listings strictly pre-d${LUXURY_RELEASE_DAY}=${pre}; post share=${(share * 100).toFixed(2)}% (mechanism 3% x 0.643 organic = 1.93%; floor $${(Number(r.lux_floor) / 1e6).toFixed(1)}M; post n=${r.post_n})`;
					if (pre === 0 && share >= 0.015 && share <= 0.025) return { verdict: "NAILED", detail };
					if (pre === 0 && share >= 0.012 && share <= 0.029) return { verdict: "STRONG", detail };
					if (pre === 0 && share > 0.005) return { verdict: "WEAK", detail };
					return { verdict: "NONE", detail };
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${PU_CTE}
SELECT (left(puu.uid, 1) = 'c') AS browser, count(*)::BIGINT AS user_count,
  avg((SELECT count(*) FROM ev e WHERE e.uid = puu.uid AND e.event = 'property viewed' AND e.listing_price >= ${LUXURY_PRICE_MIN})) AS luxviews_pu,
  sum((SELECT count(*) FROM ev e WHERE e.uid = puu.uid AND e.event = 'property viewed' AND e.listing_price >= ${LUXURY_PRICE_MIN} AND e.day_idx < ${LUXURY_RELEASE_DAY})) AS luxviews_pre
FROM puu GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "browser");
					const br = by.true, non = by.false;
					if (!br || !non || Number(br.user_count) < 240) {
						return { verdict: "WEAK", detail: `browser cohort too small: ${br?.user_count ?? 0}` };
					}
					const total = Number(br.user_count) + Number(non.user_count);
					const shr = Number(br.user_count) / total;
					const nonPu = Number(non.luxviews_pu), brPu = Number(br.luxviews_pu);
					const pre = Number(br.luxviews_pre) + Number(non.luxviews_pre);
					const detail = `luxury ($5M+) views: browsers=${brPu.toFixed(2)}/user (share ${(shr * 100).toFixed(2)}% of users, 1/16 hash), non-browsers=${nonPu}, strictly pre-d50=${pre}`;
					if (nonPu === 0 && pre === 0 && brPu >= 1.4 && brPu <= 2.4 && shr >= 0.045 && shr <= 0.075) return { verdict: "NAILED", detail };
					if (nonPu === 0 && pre === 0 && brPu >= 1.1 && brPu <= 2.8) return { verdict: "STRONG", detail };
					if (nonPu === 0 && brPu > 0.5) return { verdict: "WEAK", detail };
					return { verdict: "NONE", detail };
				},
			},
		],
	},
	{
		id: "H8-cold-lead-churn",
		hook: "H8",
		archetype: "retention-divergence",
		narrative:
			`Cold leads (viewed but never saved a property within ${COLD_LEAD_WINDOW_DAYS}d of first event — ` +
			`~58% of users; 'property saved' is a different event from H3's 'saved search created') lose ` +
			`${COLD_LEAD_DROP_LIKELIHOOD}% of post-day-14 events. Classification from output is exact (H8 runs ` +
			"after every hook that adds/removes first-14d views/saves — see doctrine). Absolute post-14 ratio " +
			"~0.13 (the 0.1 keep knob x composition: cold leads are lighter users pre-treatment too, so the " +
			"within-user decay pair — cold post/pre vs rest post/pre — carries the causal read.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${PU_CTE}
SELECT (viewed14 AND NOT saved14) AS cold, count(*)::BIGINT AS user_count,
  avg((SELECT count(*) FROM ev e WHERE e.uid = puu.uid AND e.t > puu.first_t + INTERVAL '${COLD_LEAD_WINDOW_DAYS} days')) AS post14,
  avg((SELECT count(*) FROM ev e WHERE e.uid = puu.uid AND e.t <= puu.first_t + INTERVAL '${COLD_LEAD_WINDOW_DAYS} days')) AS pre14
FROM puu WHERE first_t < TIMESTAMP '2026-04-01' GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "cold");
					const c = by.true, r = by.false;
					if (!c || !r || Number(c.user_count) < 2200 || Number(r.user_count) < 1500) {
						return { verdict: "WEAK", detail: `cohorts too small: cold=${c?.user_count ?? 0} rest=${r?.user_count ?? 0}` };
					}
					const ratio = Number(c.post14) / Number(r.post14);
					const detail = `post-first-14d events/user cold/rest=${ratio.toFixed(3)} (${Number(c.post14).toFixed(1)} vs ${Number(r.post14).toFixed(1)}; n=${c.user_count}/${r.user_count})`;
					if (ratio >= 0.09 && ratio <= 0.17) return { verdict: "NAILED", detail };
					if (ratio >= 0.06 && ratio <= 0.22) return { verdict: "STRONG", detail };
					if (ratio < 0.5) return { verdict: "WEAK", detail };
					return { verdict: ratio >= 1 ? "INVERSE" : "NONE", detail };
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${PU_CTE}
SELECT (viewed14 AND NOT saved14) AS cold, count(*)::BIGINT AS user_count,
  avg((SELECT count(*) FROM ev e WHERE e.uid = puu.uid AND e.t > puu.first_t + INTERVAL '${COLD_LEAD_WINDOW_DAYS} days')) AS post14,
  avg((SELECT count(*) FROM ev e WHERE e.uid = puu.uid AND e.t <= puu.first_t + INTERVAL '${COLD_LEAD_WINDOW_DAYS} days')) AS pre14
FROM puu WHERE first_t < TIMESTAMP '2026-04-01' GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "cold");
					const c = by.true, r = by.false;
					if (!c || !r || Number(c.user_count) < 2200 || Number(r.user_count) < 1500) {
						return { verdict: "WEAK", detail: `cohorts too small: cold=${c?.user_count ?? 0} rest=${r?.user_count ?? 0}` };
					}
					const decay = Number(c.post14) / Number(c.pre14);
					const growth = Number(r.post14) / Number(r.pre14);
					const detail = `within-user trajectory: cold post/pre=${decay.toFixed(3)} vs rest post/pre=${growth.toFixed(3)} (cold collapse vs organic growth)`;
					if (decay >= 0.5 && decay <= 0.85 && growth >= 1.6) return { verdict: "NAILED", detail };
					if (decay <= 1.0 && growth >= 1.3) return { verdict: "STRONG", detail };
					if (decay < growth) return { verdict: "WEAK", detail };
					return { verdict: "INVERSE", detail };
				},
			},
		],
	},
	{
		id: "H9-view-magic-number",
		hook: "H9",
		archetype: "frequency-sweet-spot",
		narrative:
			`${VIEW_SWEET_MIN}-${VIEW_SWEET_MAX} output views (exact hook-time count — see doctrine) => offer_price ` +
			`x${VIEW_OFFER_PRICE_BOOST}; ${VIEW_OVER_THRESHOLD}+ views => ${VIEW_OVER_OFFER_DROP_LIKELIHOOD}% of the user's ` +
			"offers deleted. Price read excludes the spring window (H1's 2.5x runs last and would swamp it); " +
			"over-bucket prices are untreated (placebo vs low ~1.04). Volume read is the doc's plain cohort " +
			"comparison over/sweet: the 60% deletion knob nets ~0.65 visible because the over bucket's " +
			"power-cloner composition (97% pre-approved/dual-tour) offsets ~25 points — knob raised from 35 " +
			"in v1.6 precisely so the documented '~35% fewer offers' materializes in the plain read.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${PU_CTE}
SELECT CASE WHEN p.views BETWEEN ${VIEW_SWEET_MIN} AND ${VIEW_SWEET_MAX} THEN 'sweet'
            WHEN p.views < ${VIEW_SWEET_MIN} THEN 'low' ELSE 'over' END AS bucket,
  count(*)::BIGINT AS n, count(DISTINCT e.uid)::BIGINT AS user_count, avg(e.offer_price) AS price
FROM puu p JOIN ev e ON e.uid = p.uid AND e.event = 'offer submitted'
WHERE e.day_idx NOT BETWEEN ${SPRING_START_DAY} AND ${SPRING_END_DAY - 1}
GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "bucket");
					const sw = by.sweet, lo = by.low, ov = by.over;
					if (!sw || !lo || Number(sw.n) < 2500 || Number(lo.n) < 4000) {
						return { verdict: "WEAK", detail: `offer volume too small: sweet=${sw?.n ?? 0} low=${lo?.n ?? 0}` };
					}
					const ratio = Number(sw.price) / Number(lo.price);
					const placebo = ov ? Number(ov.price) / Number(lo.price) : NaN;
					const detail = `non-spring avg offer_price sweet/low=${ratio.toFixed(3)} (knob ${VIEW_OFFER_PRICE_BOOST}x); over/low placebo=${placebo.toFixed(3)} (n=${sw.n}/${lo.n}/${ov?.n ?? 0})`;
					if (ratio >= 1.25 && ratio <= 1.45) return { verdict: "NAILED", detail };
					if (ratio >= 1.18 && ratio <= 1.55) return { verdict: "STRONG", detail };
					if (ratio > 1.05) return { verdict: "WEAK", detail };
					return { verdict: ratio <= 1 ? "INVERSE" : "NONE", detail };
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${PU_CTE}
SELECT CASE WHEN p.views BETWEEN ${VIEW_SWEET_MIN} AND ${VIEW_SWEET_MAX} THEN 'sweet'
            WHEN p.views < ${VIEW_SWEET_MIN} THEN 'low' ELSE 'over' END AS bucket,
  count(*)::BIGINT AS n, count(DISTINCT e.uid)::BIGINT AS user_count, avg(e.offer_price) AS price
FROM puu p JOIN ev e ON e.uid = p.uid AND e.event = 'offer submitted'
WHERE e.day_idx NOT BETWEEN ${SPRING_START_DAY} AND ${SPRING_END_DAY - 1}
GROUP BY 1`,
				},
				select: {
					over: { where: { bucket: "over" } },
					low: { where: { bucket: "low" } },
				},
				expect: { metric: "over.price / low.price", op: "between", target: [0.92, 1.15] },
				minCohort: 400,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${PU_CTE}
SELECT CASE WHEN views BETWEEN ${VIEW_SWEET_MIN} AND ${VIEW_SWEET_MAX} THEN 'sweet'
            WHEN views >= ${VIEW_OVER_THRESHOLD} THEN 'over' ELSE 'low' END AS bucket,
  count(*)::BIGINT AS user_count, avg(offers) AS offers_pu
FROM puu GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "bucket");
					const ov = by.over, sw = by.sweet;
					if (!ov || !sw || Number(ov.user_count) < 430 || Number(sw.user_count) < 500) {
						return { verdict: "WEAK", detail: `buckets too small: over=${ov?.user_count ?? 0} sweet=${sw?.user_count ?? 0}` };
					}
					const ratio = Number(ov.offers_pu) / Number(sw.offers_pu);
					const detail = `offers/user over/sweet=${ratio.toFixed(3)} (${Number(ov.offers_pu).toFixed(2)} vs ${Number(sw.offers_pu).toFixed(2)}; 60% knob nets ~0.65 visible; n=${ov.user_count}/${sw.user_count})`;
					if (ratio >= 0.52 && ratio <= 0.78) return { verdict: "NAILED", detail };
					if (ratio >= 0.42 && ratio <= 0.90) return { verdict: "STRONG", detail };
					if (ratio < 1) return { verdict: "WEAK", detail };
					return { verdict: "INVERSE", detail };
				},
			},
		],
	},
	{
		id: "H10-tour-ttc-by-tier",
		hook: "H10",
		archetype: "funnel-conversion-by-segment",
		narrative:
			`funnel-post scales step gaps by agent_tier: Premier x${TTC_PREMIER_FACTOR}, Standard x${TTC_STANDARD_FACTOR} ` +
			`(mechanism ratio ${(TTC_PREMIER_FACTOR / TTC_STANDARD_FACTOR).toFixed(3)}) — applied to ALL three funnels; the read ` +
			"targets the Tour Funnel. Primary: emulator 2-step view→tour-scheduled median TTC at 31.2h " +
			"(24h generative x 1.3 stretch) — measured 0.56, on-mechanism. Secondary: the doc's 3-step read, " +
			"attenuated toward 1 (~0.74) by H4/H6 offer clones colliding with the greedy third-step pick — " +
			"kept directional. v1.6 graduation: real-estate previously carried the funnel-post limitation " +
			"flag ('populations present' only); the emulator read asserts the TTC delta itself. Identity " +
			"invariants ride here: total uid resolution and profile-stamp agreement are structural.",
		assertions: [
			{
				breakdown: {
					type: "timeToConvert",
					steps: ["property viewed", "tour scheduled"],
					breakdownByUserProperty: "agent_tier",
					conversionWindowMs: Math.round(24 * TTC_STANDARD_FACTOR * 3600 * 1000),
				},
				assert: (rows) => {
					const by = cellsOf(rows, "segment_value");
					const p = by.Premier, s = by.Standard;
					if (!p || !s || Number(p.user_count) < 600 || Number(s.user_count) < 1600) {
						return { verdict: "WEAK", detail: `converters too small: Premier=${p?.user_count ?? 0} Standard=${s?.user_count ?? 0}` };
					}
					const ratio = Number(p.median_ttc_ms) / Number(s.median_ttc_ms);
					const detail = `2-step view→tour median TTC Premier/Standard=${ratio.toFixed(3)} (mechanism 0.71/1.3=0.546; medians ${(Number(p.median_ttc_ms) / 3600000).toFixed(2)}h vs ${(Number(s.median_ttc_ms) / 3600000).toFixed(2)}h; converters=${p.user_count}/${s.user_count})`;
					if (ratio >= 0.48 && ratio <= 0.63) return { verdict: "NAILED", detail };
					if (ratio >= 0.42 && ratio <= 0.70) return { verdict: "STRONG", detail };
					if (ratio < 0.9) return { verdict: "WEAK", detail };
					return { verdict: ratio >= 1 ? "INVERSE" : "NONE", detail };
				},
			},
			{
				breakdown: {
					type: "timeToConvert",
					steps: ["property viewed", "tour scheduled", "offer submitted"],
					breakdownByUserProperty: "agent_tier",
					conversionWindowMs: Math.round(24 * TTC_STANDARD_FACTOR * 3600 * 1000),
				},
				assert: (rows) => {
					const by = cellsOf(rows, "segment_value");
					const p = by.Premier, s = by.Standard;
					if (!p || !s || Number(p.user_count) < 300 || Number(s.user_count) < 850) {
						return { verdict: "WEAK", detail: `converters too small: Premier=${p?.user_count ?? 0} Standard=${s?.user_count ?? 0}` };
					}
					const ratio = Number(p.median_ttc_ms) / Number(s.median_ttc_ms);
					const detail = `3-step median TTC Premier/Standard=${ratio.toFixed(3)} (clone-pollution attenuates 0.546 toward 1; converters=${p.user_count}/${s.user_count})`;
					if (ratio >= 0.62 && ratio <= 0.86) return { verdict: "NAILED", detail };
					if (ratio >= 0.55 && ratio <= 0.95) return { verdict: "STRONG", detail };
					if (ratio < 1) return { verdict: "WEAK", detail };
					return { verdict: "INVERSE", detail };
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT count(*)::BIGINT AS n,
  avg((u.distinct_id IS NOT NULL)::INT) AS uid_resolved,
  avg(CASE WHEN u.distinct_id IS NOT NULL THEN (e2.user_type = u.user_type)::INT END) AS stamp_agree
FROM ev e2 LEFT JOIN us u ON e2.uid = u.distinct_id::VARCHAR`,
				},
				assert: (rows) => {
					const r = rows?.[0];
					if (!r || Number(r.n) < 100000) {
						return { verdict: "WEAK", detail: `too few events: n=${r?.n ?? 0}` };
					}
					const res = Number(r.uid_resolved), agree = Number(r.stamp_agree);
					const detail = `identity invariants: uid resolution=${res} profile-stamp agreement=${agree} over ${r.n} events (auth-on-first-event; superProps stamped from profile)`;
					if (res === 1 && agree === 1) return { verdict: "NAILED", detail };
					if (res >= 0.999 && agree >= 0.999) return { verdict: "STRONG", detail };
					return { verdict: "NONE", detail };
				},
			},
		],
	},
];
