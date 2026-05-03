// ── TWEAK THESE ──
const SEED = "homenest";
const num_days = 120;
const num_users = 10_000;
const avg_events_per_user_per_day = 0.53;
let token = "your-mixpanel-token";

// ── env overrides ──
if (process.env.MP_TOKEN) token = process.env.MP_TOKEN;

import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import "dotenv/config";
import * as u from "../../lib/utils/utils.js";
import * as v from "ak-tools";

dayjs.extend(utc);
const chance = u.initChance(SEED);

/** @typedef  {import("../../types").Dungeon} Config */

/**
 * ===================================================================
 * DATASET OVERVIEW
 * ===================================================================
 *
 * HomeNest — a property listings and agent CRM platform
 * (Zillow meets Compass). Buyers search listings, save properties,
 * schedule tours, get pre-approved for mortgages, and submit offers.
 * Agents list properties, manage clients, and close deals.
 *
 * Scale: 6,000 users · 480K events · 150 days · 17 event types
 * Groups: 200 brokerages
 * User types: Buyer (60%), Agent (20%), Both (20%)
 * Agent tiers: Standard (75%) / Premier (25%)
 *
 * Core loops:
 *   Buyer:  account created → property search → property viewed →
 *           property saved → tour scheduled → offer submitted →
 *           offer accepted / offer rejected
 *
 *   Agent:  account created → property listed → open house attended →
 *           agent contacted → property sold
 *
 * Funnels:
 *   - Buyer journey: account created → property search → property viewed (80%)
 *   - Tour funnel: property viewed → tour scheduled → offer submitted (40%)
 *   - Seller funnel: property listed → open house attended → property sold (35%)
 *
 * ===================================================================
 * ANALYTICS HOOKS (10 hooks)
 *
 * Adds 10. TOUR FUNNEL TIME-TO-CONVERT: Premier agents 0.71x faster, Standard
 * 1.3x slower (funnel-post). Discover via Tour Funnel median TTC by agent_tier.
 * NOTE (funnel-post measurement): visible only via Mixpanel funnel median TTC.
 * Cross-event MIN→MIN SQL queries on raw events do NOT show this.
 * ===================================================================
 *
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
 * dropped. No flag.
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
 *   - Expected: A ~ 5x B
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
 *   - Expected: A ~ 6x B
 *
 * REAL-WORLD ANALOGUE: Dual-tour buyers self-qualify into serious bidders.
 *
 * -------------------------------------------------------------------
 * 7. LUXURY LISTING RELEASE (event + everything)
 * -------------------------------------------------------------------
 *
 * PATTERN: After day 50, 3% of property-listed events get listing_price
 * set to $5M-$15M (raw mutation). ~3% of users (by id hash) get extra
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
 * tire-kickers; 35% of their offer-submitted events drop. No flag.
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
 * ===================================================================
 * EXPECTED METRICS SUMMARY
 * ===================================================================
 *
 * Hook                     | Metric                 | Baseline | Effect  | Ratio
 * -------------------------|------------------------|----------|---------|------
 * Spring Buying Season     | Avg offer_price d30-60 | 1x       | 2.5x    | 2.5x
 * Mortgage Rate Shock      | Offer vol post-day-75  | 1x       | 0.55x   | -45%
 * Saved-Search Retention   | non-saver post-day-30  | 1x       | 0.2x    | -80%
 * Pre-Approved Conversion  | offers/user            | 1x       | ~ 5x    | 5x
 * Premier Agent Advantage  | listings/user          | 1x       | ~ 3x    | 3x
 * Dual-Tour Power Users    | offers/user            | 1x       | ~ 6x    | 6x
 * Luxury Listing Release   | $5M+ listings          | 0%       | ~ 3%    | d50+
 * Cold-Lead Churn          | non-save post-day-14   | 1x       | 0.1x    | -90%
 * View-Count Magic Number  | sweet offer_price      | 1x       | 1.3x    | 1.3x
 * View-Count Magic Number  | over offers/user       | 1x       | 0.65x   | -35%
 */

/** @type {Config} */
const config = {
	version: 2,
	token,
	seed: SEED,
	datasetStart: "2026-01-01T00:00:00Z",
	datasetEnd: "2026-05-01T23:59:59Z",
	// numDays: num_days,
	avgEventsPerUserPerDay: avg_events_per_user_per_day,
	numUsers: num_users,
	hasAnonIds: true,
	avgDevicePerUser: 2,
	hasSessionIds: true,
	format: "json",
	gzip: true,
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
			name: "Tour Funnel"
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

	hook: function (record, type, meta) {
		// HOOK 10 (T2C): TOUR FUNNEL TIME-TO-CONVERT (funnel-post)
		// Premier agents move users through Tour funnel 1.4x faster
		// (factor 0.71); Standard agents 1.3x slower (factor 1.3).
		if (type === "funnel-post") {
			const segment = meta?.profile?.agent_tier;
			if (Array.isArray(record) && record.length > 1) {
				const factor = (
					segment === "Premier" ? 0.71 :
					segment === "Standard" ? 1.3 :
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

		// HOOKS 1, 2, 7 (time-window event-level effects) moved to everything hook —
		// event hook fires before bunchIntoSessions reshuffles timestamps, so day-window
		// tags leak across boundaries.

		if (type === "everything") {
			const datasetStart = dayjs.unix(meta.datasetStart);
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
			const springStart = datasetStart.add(30, "days");
			const springEnd = datasetStart.add(60, "days");
			const shockStart = datasetStart.add(75, "days");
			const shockEnd = datasetStart.add(89, "days");
			const luxuryStart = datasetStart.add(50, "days");
			userEvents.forEach(e => {
				const t = dayjs.utc(e.time);
				const inSpring = (t.isAfter(springStart) || t.isSame(springStart)) && t.isBefore(springEnd);
				if (inSpring && e.event === "tour scheduled" && typeof e.duration_mins === "number") {
					e.duration_mins = Math.round(e.duration_mins * 3);
				}
				// Spring offer_price boost moved to end (after all cloning)
				if (e.event === "mortgage pre-approval") {
					if ((t.isAfter(shockStart) || t.isSame(shockStart)) && t.isBefore(shockEnd)) {
						e.mortgage_rate = 7.5;
					}
				}
				if (e.event === "property listed" && t.isAfter(luxuryStart) && chance.bool({ likelihood: 3 })) {
					e.listing_price = chance.integer({ min: 5000000, max: 15000000 });
				}
			});

			const firstEventTime = userEvents.length > 0 ? dayjs(userEvents[0].time) : null;

			// HOOK 2 (cont): MORTGAGE RATE SHOCK — drop 45% of post-day-75
			// offer-submitted events. No flag.
			const day75 = datasetStart.add(75, "days");
			for (let i = userEvents.length - 1; i >= 0; i--) {
				const evt = userEvents[i];
				if (evt.event === "offer submitted" && dayjs(evt.time).isAfter(day75) && chance.bool({ likelihood: 45 })) {
					userEvents.splice(i, 1);
				}
			}

			// HOOK 3: SAVED-SEARCH RETENTION — early savers (saved-search-created
			// in first 7 days) get extra cloned view + tour events. Non-savers
			// lose 80% of events after day 30. No flag.
			const day7 = firstEventTime ? firstEventTime.add(7, "days") : null;
			const day30 = datasetStart.add(30, "days");
			const hasSavedSearch = day7 ? userEvents.some(e =>
				e.event === "saved search created" && dayjs(e.time).isBefore(day7)
			) : false;

			if (hasSavedSearch) {
				const viewTemplate = userEvents.find(e => e.event === "property viewed");
				const tourTemplate = userEvents.find(e => e.event === "tour scheduled");
				if (viewTemplate) {
					const extras = chance.integer({ min: 3, max: 8 });
					for (let i = 0; i < extras; i++) {
						const offset = chance.integer({ min: 10, max: num_days - 10 });
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
					const extras = chance.integer({ min: 1, max: 3 });
					for (let i = 0; i < extras; i++) {
						const offset = chance.integer({ min: 15, max: num_days - 10 });
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
					if (dayjs(evt.time).isAfter(day30) && chance.bool({ likelihood: 80 })) {
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
					const extras = chance.integer({ min: 4, max: 6 });
					for (let i = 0; i < extras; i++) {
						const offset = chance.integer({ min: 20, max: num_days - 5 });
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
					const extras = existingListings * 2;
					for (let i = 0; i < extras; i++) {
						const offset = chance.integer({ min: 5, max: num_days - 5 });
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
					for (let i = 0; i < existingSales; i++) {
						const offset = chance.integer({ min: 10, max: num_days - 5 });
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
					const extras = chance.integer({ min: 5, max: 7 });
					for (let i = 0; i < extras; i++) {
						const offset = chance.integer({ min: 15, max: num_days - 5 });
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
				const isLuxuryBrowser = typeof userId === "string" && userId.length > 0 && userId.charCodeAt(0) % 33 === 0;
				if (isLuxuryBrowser) {
					const viewTemplate = userEvents.find(e => e.event === "property viewed");
					if (viewTemplate) {
						const extras = chance.integer({ min: 3, max: 6 });
						for (let i = 0; i < extras; i++) {
							const offset = chance.integer({ min: 50, max: num_days - 5 });
							userEvents.push({
								...viewTemplate,
								time: datasetStart.add(offset, "days").add(chance.integer({ min: 9, max: 21 }), "hours").toISOString(),
								user_id: viewTemplate.user_id,
								listing_id: `LST-${chance.integer({ min: 90000, max: 99999 })}`,
								listing_price: chance.integer({ min: 5000000, max: 15000000 }),
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
			const day14 = firstEventTime ? firstEventTime.add(14, "days") : null;
			if (day14) {
				const earlyEvents = userEvents.filter(e => dayjs(e.time).isBefore(day14));
				const hasView = earlyEvents.some(e => e.event === "property viewed");
				const hasSave = earlyEvents.some(e => e.event === "property saved");
				if (hasView && !hasSave) {
					for (let i = userEvents.length - 1; i >= 0; i--) {
						const evt = userEvents[i];
						if (dayjs(evt.time).isAfter(day14) && chance.bool({ likelihood: 90 })) {
							userEvents.splice(i, 1);
						}
					}
				}
			}

			// HOOK 9: PROPERTY-VIEWED MAGIC NUMBER (no flags)
			// Sweet 6-12 views → +30% offer_price on offer submitted events.
			// Over 13+ → drop 35% of offer submitted events (tire-kickers).
			const viewCount = userEvents.filter(e => e.event === "property viewed").length;
			if (viewCount >= 6 && viewCount <= 12) {
				userEvents.forEach(e => {
					if (e.event === "offer submitted" && typeof e.offer_price === "number") {
						e.offer_price = Math.round(e.offer_price * 1.3);
					}
				});
			} else if (viewCount >= 13) {
				for (let i = userEvents.length - 1; i >= 0; i--) {
					if (userEvents[i].event === "offer submitted" && chance.bool({ likelihood: 35 })) {
						userEvents.splice(i, 1);
					}
				}
			}

			// HOOK 1 (cont): Spring offer_price boost — runs AFTER all cloning
			// so cloned offers in the spring window also get the 2.5x boost
			userEvents.forEach(e => {
				if (e.event !== "offer submitted") return;
				const t = dayjs.utc(e.time);
				if ((t.isAfter(springStart) || t.isSame(springStart)) && t.isBefore(springEnd)) {
					e.offer_price = Math.floor((e.offer_price || 400000) * 2.5);
				}
			});
		}

		return record;
	}
};

export default config;
