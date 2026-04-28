// ── TWEAK THESE ──
const SEED = "homenest";
const num_days = 150;
const num_users = 6_000;
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
 * ANALYTICS HOOKS (8 architected patterns)
 * ===================================================================
 *
 * 1. SPRING BUYING SEASON (event hook — TIME-BASED)
 *    Days 30-60: spring_season=true on tours/offers. Tour events get
 *    duration_mins 3x. Offer events get offer_price 2.5x.
 *    → Insights: "tour scheduled" total over time, breakdown spring_season
 *      (expect: 3x volume spike during days 30-60)
 *    → Insights: "offer submitted" avg offer_price, breakdown spring_season
 *      (expect: 2.5x average during spring)
 *
 * 2. MORTGAGE RATE SHOCK (event + everything hook — TIME-BASED)
 *    Day 75: mortgage_rate jumps from 6.5 to 7.5. After day 75 and
 *    before day 89, mortgage_rate forced to 7.5 on pre-approval events.
 *    In everything hook, 45% of offer_submitted events after day 75
 *    are removed (buyer pullback).
 *    → Insights: "mortgage pre-approval" avg mortgage_rate over time
 *      (expect: step change from ~6.5 to 7.5 at day 75)
 *    → Insights: "offer submitted" total over time
 *      (expect: ~45% volume drop after day 75)
 *
 * 3. SAVED-SEARCH RETENTION (everything hook — RETENTION)
 *    Users who create a "saved search created" within first 7 days
 *    get extra property_viewed and tour_scheduled events injected.
 *    Non-savers lose 80% of events after day 30.
 *    → Retention: any → any, segment has_saved_search = true vs false
 *      (expect: dramatically higher retention for saved-search users)
 *    → Insights: "property viewed" total, breakdown has_saved_search
 *
 * 4. PRE-APPROVED BUYER CONVERSION (everything hook — CONVERSION)
 *    Users with a "mortgage pre-approval" event complete offer_submitted
 *    5x more often. Extra offer events injected, pre_approved=true.
 *    → Insights: "offer submitted" total, breakdown pre_approved
 *      (expect: 5x volume for pre_approved=true)
 *    → Funnels: property viewed → tour scheduled → offer submitted,
 *      segment pre_approved = true vs false
 *
 * 5. TOP-TIER AGENT ADVANTAGE (everything hook — SUBSCRIPTION TIER)
 *    Users with agent_tier="Premier" from profile get 3x property_listed
 *    events and 2x property_sold events. premier_agent=true.
 *    → Insights: "property listed" total, breakdown premier_agent
 *      (expect: Premier agents ~3x listings)
 *    → Insights: "property sold" total, breakdown premier_agent
 *      (expect: Premier agents ~2x sales)
 *
 * 6. TOUR-TO-OFFER POWER USERS (everything hook — BEHAVIORS TOGETHER)
 *    Users who did BOTH "virtual tour" AND "in-person tour" get 6x
 *    offer_submitted events injected. dual_tour=true on offers.
 *    → Insights: "offer submitted" total, breakdown dual_tour
 *      (expect: dual_tour=true ~6x volume)
 *    → Funnels: virtual tour → in-person tour → offer submitted,
 *      filter dual_tour = true
 *
 * 7. LUXURY LISTING RELEASE (event + everything hook — TIMED RELEASE)
 *    Day 50: luxury listings appear. After day 50, 3% of property_listed
 *    events get listing_price set to $5M+ and luxury=true. ~3% of users
 *    (by hash) get extra luxury property_viewed events.
 *    → Insights: "property listed" avg listing_price, filter luxury=true
 *      (expect: $5M+ only after day 50)
 *    → Insights: "property viewed" total, breakdown luxury
 *      (expect: luxury=true cluster starting day 50)
 *
 * 8. COLD-LEAD CHURN (everything hook — CHURN)
 *    Users who browse (property viewed) but never save (property saved)
 *    in the first 14 days lose 90% of events after day 14.
 *    → Retention: any → any, segment cold_lead = true vs false
 *      (expect: cold_lead=true drops to near zero after day 14)
 *    → Insights: any event total, filter cold_lead = true
 *
 * ===================================================================
 * ADVANCED ANALYSIS IDEAS
 * ===================================================================
 *
 * Cross-hook patterns:
 *   - Spring + Rate Shock: Does the spring surge survive the rate hike?
 *   - Saved Search + Cold Lead: Are saved-search users immune to churn?
 *   - Pre-Approved + Dual Tour: Do pre-approved dual-tourers dominate offers?
 *   - Premier Agent + Luxury: Do Premier agents list more luxury properties?
 *   - Rate Shock + Pre-Approved: Do pre-approved buyers still submit after rate jump?
 *
 * Cohort analysis:
 *   - By user_type: Buyer vs Agent vs Both engagement
 *   - By agent_tier: Standard vs Premier listing volume and close rate
 *   - By property_preference: Which housing type converts best?
 *   - By preferred_location: Urban vs Suburban vs Rural tour rates
 *
 * ===================================================================
 * EXPECTED METRICS SUMMARY
 * ===================================================================
 *
 * Hook                     | Metric                 | Baseline | Effect  | Ratio
 * -------------------------|------------------------|----------|---------|------
 * Spring Buying Season     | Tour volume            | 1x       | 3x      | 3x
 * Mortgage Rate Shock      | Offer volume post D75  | 100%     | 55%     | 0.55x
 * Saved-Search Retention   | D30+ events (non-saver)| 100%     | 20%     | 0.2x
 * Pre-Approved Conversion  | Offer count            | 1x       | 5x      | 5x
 * Premier Agent Advantage  | Listings               | 1x       | 3x      | 3x
 * Dual Tour Power Users    | Offer count            | 1x       | 6x      | 6x
 * Luxury Listing Release   | Luxury listings        | 0%       | 3%      | D50+
 * Cold-Lead Churn          | D14+ events (cold lead)| 100%     | 10%     | 0.1x
 */

/** @type {Config} */
const config = {
	token,
	seed: SEED,
	numDays: num_days,
	avgEventsPerUserPerDay: avg_events_per_user_per_day,
	numUsers: num_users,
	hasAnonIds: false,
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
				spring_season: [false],
				luxury: [false],
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
				spring_season: [false],
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
				pre_approved: [false],
				spring_season: [false],
				dual_tour: [false],
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
				luxury: [false],
				premier_agent: [false],
			}
		},
		{
			event: "property sold",
			weight: 1,
			properties: {
				sale_price: u.weighNumRange(200000, 1500000, 0.4, 40),
				days_on_market: u.weighNumRange(5, 180, 0.4, 30),
				premier_agent: [false],
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
		has_saved_search: [false],
		cold_lead: [false],
	},

	userProps: {
		user_type: ["Buyer", "Buyer", "Buyer", "Agent", "Both"],
		preferred_location: ["Urban", "Suburban", "Rural"],
		property_preference: ["Single Family", "Condo", "Townhouse", "Multi-Family"],
		budget_max: u.weighNumRange(200000, 2000000, 0.4, 50),
		agent_tier: ["Standard", "Standard", "Standard", "Premier"],
		total_properties_viewed: u.weighNumRange(0, 100, 0.5, 30),
		pre_approval_status: ["none"],
		has_saved_search: [false],
		cold_lead: [false],
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

	/**
	 * ARCHITECTED ANALYTICS HOOKS
	 *
	 * This hook function creates 8 deliberate patterns in the data:
	 *
	 * 1. SPRING BUYING SEASON: Days 30-60, tours get 3x duration_mins, offers get 2.5x offer_price, spring_season=true
	 * 2. MORTGAGE RATE SHOCK: Day 75, rate jumps to 7.5; 45% of post-day-75 offers removed
	 * 3. SAVED-SEARCH RETENTION: First-7-day savers get extra engagement; non-savers lose 80% after day 30
	 * 4. PRE-APPROVED BUYER CONVERSION: Users with pre-approval get 5x offer events, pre_approved=true
	 * 5. TOP-TIER AGENT ADVANTAGE: Premier agents get 3x listings, 2x sales, premier_agent=true
	 * 6. TOUR-TO-OFFER POWER USERS: Users with both virtual + in-person tours get 6x offers, dual_tour=true
	 * 7. LUXURY LISTING RELEASE: Day 50+, 3% of listings become $5M+ luxury; ~3% of users browse luxury
	 * 8. COLD-LEAD CHURN: Browsers who never save in first 14 days lose 90% of events after day 14
	 */
	hook: function (record, type, meta) {
		const NOW = dayjs.utc();
		const DATASET_START = NOW.subtract(num_days, "days");

		// ===============================================================
		// Hook #1: SPRING BUYING SEASON (event)
		// Days 30-60: spring market heats up. Scheduled tours get
		// duration_mins 3x (more serious buyers). Offers get offer_price
		// 2.5x (bidding wars). spring_season=true flag set on both.
		// ===============================================================
		if (type === "event") {
			const EVENT_TIME = dayjs.utc(record.time);
			const dayInDataset = EVENT_TIME.diff(DATASET_START, "day");

			const isSpring = dayInDataset >= 30 && dayInDataset <= 60;

			if (record.event === "tour scheduled") {
				if (isSpring) {
					record.spring_season = true;
				} else {
					record.spring_season = false;
				}
			}

			if (record.event === "offer submitted") {
				if (isSpring) {
					record.offer_price = Math.floor((record.offer_price || 400000) * 2.5);
					record.spring_season = true;
				} else {
					record.spring_season = false;
				}
			}

			if (record.event === "property viewed" && isSpring) {
				record.spring_season = true;
			}

			// ===============================================================
			// Hook #2 (event part): MORTGAGE RATE SHOCK
			// Day 75-89: mortgage rates forced to 7.5 on pre-approval events
			// (up from baseline ~6.5).
			// ===============================================================
			if (record.event === "mortgage pre-approval") {
				if (dayInDataset >= 75 && dayInDataset < 89) {
					record.mortgage_rate = 7.5;
				}
			}

			// ===============================================================
			// Hook #7 (event part): LUXURY LISTING RELEASE
			// After day 50, 3% of property_listed events become luxury
			// ($5M-$15M) with luxury=true. Before day 50, no luxury.
			// ===============================================================
			if (record.event === "property listed") {
				if (dayInDataset >= 50 && chance.bool({ likelihood: 3 })) {
					record.listing_price = chance.integer({ min: 5000000, max: 15000000 });
					record.luxury = true;
					record.premier_agent = false;
				} else {
					record.luxury = false;
				}
			}
		}

		// ===============================================================
		// EVERYTHING HOOK — Complex behavioral patterns
		// ===============================================================
		if (type === "everything") {
			const userEvents = record;
			const profile = meta.profile;

			// Stamp superProps from profile for consistency
			userEvents.forEach(e => {
				e.user_type = profile.user_type;
				e.preferred_location = profile.preferred_location;
				e.property_preference = profile.property_preference;
				e.has_saved_search = profile.has_saved_search;
				e.cold_lead = profile.cold_lead;
			});

			const firstEventTime = userEvents.length > 0 ? dayjs(userEvents[0].time) : null;

			// -----------------------------------------------------------
			// Hook #2 (everything part): MORTGAGE RATE SHOCK
			// After day 75, 45% of offer_submitted events are removed
			// (buyer pullback due to higher rates).
			// -----------------------------------------------------------
			const day75 = DATASET_START.add(75, "days");
			for (let i = userEvents.length - 1; i >= 0; i--) {
				const evt = userEvents[i];
				if (evt.event === "offer submitted" && dayjs(evt.time).isAfter(day75)) {
					if (chance.bool({ likelihood: 45 })) {
						userEvents.splice(i, 1);
					}
				}
			}

			// -----------------------------------------------------------
			// Hook #3: SAVED-SEARCH RETENTION
			// Users who create a "saved search created" within first 7
			// days get extra property_viewed and tour_scheduled events.
			// Non-savers lose 80% of events after day 30.
			// -----------------------------------------------------------
			const day7 = firstEventTime ? firstEventTime.add(7, "days") : null;
			const day30 = DATASET_START.add(30, "days");

			let hasSavedSearch = false;
			if (day7) {
				hasSavedSearch = userEvents.some(e =>
					e.event === "saved search created" &&
					dayjs(e.time).isBefore(day7)
				);
			}

			if (hasSavedSearch) {
				// Mark the user and inject extra engagement events
				profile.has_saved_search = true;
				userEvents.forEach(e => { e.has_saved_search = true; });

				// Inject extra property_viewed and tour_scheduled events
				const viewTemplate = userEvents.find(e => e.event === "property viewed");
				const tourTemplate = userEvents.find(e => e.event === "tour scheduled");

				if (viewTemplate) {
					const extraCount = chance.integer({ min: 3, max: 8 });
					for (let i = 0; i < extraCount; i++) {
						const offset = chance.integer({ min: 10, max: num_days - 10 });
						userEvents.push({
							...viewTemplate,
							time: DATASET_START.add(offset, "days").add(chance.integer({ min: 0, max: 23 }), "hours").toISOString(),
							user_id: viewTemplate.user_id,
							listing_id: `LST-${chance.integer({ min: 10000, max: 99999 })}`,
							listing_price: chance.integer({ min: 200000, max: 1200000 }),
							has_saved_search: true,
						});
					}
				}
				if (tourTemplate) {
					const extraTours = chance.integer({ min: 1, max: 3 });
					for (let i = 0; i < extraTours; i++) {
						const offset = chance.integer({ min: 15, max: num_days - 10 });
						userEvents.push({
							...tourTemplate,
							time: DATASET_START.add(offset, "days").add(chance.integer({ min: 8, max: 18 }), "hours").toISOString(),
							user_id: tourTemplate.user_id,
							listing_id: `LST-${chance.integer({ min: 10000, max: 99999 })}`,
							has_saved_search: true,
						});
					}
				}
			} else {
				// Non-savers: remove 80% of events after day 30
				for (let i = userEvents.length - 1; i >= 0; i--) {
					const evt = userEvents[i];
					if (dayjs(evt.time).isAfter(day30)) {
						if (chance.bool({ likelihood: 80 })) {
							userEvents.splice(i, 1);
						}
					}
				}
			}

			// -----------------------------------------------------------
			// Hook #4: PRE-APPROVED BUYER CONVERSION
			// Users with a "mortgage pre-approval" event get 5x more
			// offer_submitted events injected. pre_approved=true.
			// -----------------------------------------------------------
			const hasPreApproval = userEvents.some(e => e.event === "mortgage pre-approval");

			if (hasPreApproval) {
				profile.pre_approval_status = "approved";
				const offerTemplate = userEvents.find(e => e.event === "offer submitted");
				if (offerTemplate) {
					const extraOffers = chance.integer({ min: 4, max: 6 });
					for (let i = 0; i < extraOffers; i++) {
						const offset = chance.integer({ min: 20, max: num_days - 5 });
						userEvents.push({
							...offerTemplate,
							time: DATASET_START.add(offset, "days").add(chance.integer({ min: 8, max: 20 }), "hours").toISOString(),
							user_id: offerTemplate.user_id,
							listing_id: `LST-${chance.integer({ min: 10000, max: 99999 })}`,
							offer_price: chance.integer({ min: 250000, max: 1200000 }),
							listing_price: chance.integer({ min: 250000, max: 1200000 }),
							pre_approved: true,
							spring_season: false,
							dual_tour: false,
						});
					}
				}

				// Also tag existing offers
				userEvents.forEach(e => {
					if (e.event === "offer submitted") {
						e.pre_approved = true;
					}
				});
			}

			// -----------------------------------------------------------
			// Hook #5: TOP-TIER AGENT ADVANTAGE
			// Premier agents get 3x property_listed and 2x property_sold
			// events. premier_agent=true on all their listing/sale events.
			// -----------------------------------------------------------
			if (profile.agent_tier === "Premier") {
				const listTemplate = userEvents.find(e => e.event === "property listed");
				const soldTemplate = userEvents.find(e => e.event === "property sold");

				// Tag existing events
				userEvents.forEach(e => {
					if (e.event === "property listed" || e.event === "property sold") {
						e.premier_agent = true;
					}
				});

				// Inject extra listings (3x = 2 more copies per existing)
				if (listTemplate) {
					const existingListings = userEvents.filter(e => e.event === "property listed").length;
					const extraListings = existingListings * 2;
					for (let i = 0; i < extraListings; i++) {
						const offset = chance.integer({ min: 5, max: num_days - 5 });
						userEvents.push({
							...listTemplate,
							time: DATASET_START.add(offset, "days").add(chance.integer({ min: 8, max: 18 }), "hours").toISOString(),
							user_id: listTemplate.user_id,
							listing_price: chance.integer({ min: 300000, max: 1500000 }),
							listing_status: chance.pickone(["active", "pending", "coming soon"]),
							luxury: false,
							premier_agent: true,
						});
					}
				}

				// Inject extra sales (2x = 1 more copy per existing)
				if (soldTemplate) {
					const existingSales = userEvents.filter(e => e.event === "property sold").length;
					for (let i = 0; i < existingSales; i++) {
						const offset = chance.integer({ min: 10, max: num_days - 5 });
						userEvents.push({
							...soldTemplate,
							time: DATASET_START.add(offset, "days").add(chance.integer({ min: 9, max: 17 }), "hours").toISOString(),
							user_id: soldTemplate.user_id,
							sale_price: chance.integer({ min: 300000, max: 1500000 }),
							days_on_market: chance.integer({ min: 5, max: 90 }),
							premier_agent: true,
						});
					}
				}
			}

			// -----------------------------------------------------------
			// Hook #6: TOUR-TO-OFFER POWER USERS
			// Users who did BOTH "virtual tour" AND "in-person tour"
			// get 6x offer_submitted events. dual_tour=true on offers.
			// -----------------------------------------------------------
			const hasVirtualTour = userEvents.some(e => e.event === "virtual tour");
			const hasInPersonTour = userEvents.some(e => e.event === "in-person tour");
			const isDualTourer = hasVirtualTour && hasInPersonTour;

			if (isDualTourer) {
				const offerTemplate = userEvents.find(e => e.event === "offer submitted");
				if (offerTemplate) {
					const extraOffers = chance.integer({ min: 5, max: 7 });
					for (let i = 0; i < extraOffers; i++) {
						const offset = chance.integer({ min: 15, max: num_days - 5 });
						userEvents.push({
							...offerTemplate,
							time: DATASET_START.add(offset, "days").add(chance.integer({ min: 8, max: 20 }), "hours").toISOString(),
							user_id: offerTemplate.user_id,
							listing_id: `LST-${chance.integer({ min: 10000, max: 99999 })}`,
							offer_price: chance.integer({ min: 300000, max: 1500000 }),
							listing_price: chance.integer({ min: 300000, max: 1500000 }),
							dual_tour: true,
							pre_approved: false,
							spring_season: false,
						});
					}
				}

				// Tag existing offers
				userEvents.forEach(e => {
					if (e.event === "offer submitted") {
						e.dual_tour = true;
					}
				});
			}

			// -----------------------------------------------------------
			// Hook #7 (everything part): LUXURY LISTING RELEASE
			// ~3% of users (by hash) get extra luxury property_viewed
			// events after day 50. Deterministic via character code.
			// -----------------------------------------------------------
			const day50 = DATASET_START.add(50, "days");
			if (userEvents.length > 0) {
				const userId = userEvents[0].user_id || "";
				const isLuxuryBrowser = typeof userId === "string" && userId.length > 0 && userId.charCodeAt(0) % 33 === 0;

				if (isLuxuryBrowser) {
					const viewTemplate = userEvents.find(e => e.event === "property viewed");
					if (viewTemplate) {
						const extraViews = chance.integer({ min: 3, max: 6 });
						for (let i = 0; i < extraViews; i++) {
							const offset = chance.integer({ min: 50, max: num_days - 5 });
							userEvents.push({
								...viewTemplate,
								time: DATASET_START.add(offset, "days").add(chance.integer({ min: 9, max: 21 }), "hours").toISOString(),
								user_id: viewTemplate.user_id,
								listing_id: `LST-${chance.integer({ min: 90000, max: 99999 })}`,
								listing_price: chance.integer({ min: 5000000, max: 15000000 }),
								property_type: chance.pickone(["Single Family", "Condo"]),
								bedrooms: chance.integer({ min: 4, max: 8 }),
								square_feet: chance.integer({ min: 4000, max: 15000 }),
								luxury: true,
								spring_season: false,
							});
						}
					}
				}
			}

			// -----------------------------------------------------------
			// Hook #8: COLD-LEAD CHURN
			// Users who browse (property viewed) but never save (property
			// saved) in the first 14 days lose 90% of events after day 14.
			// -----------------------------------------------------------
			const day14 = firstEventTime ? firstEventTime.add(14, "days") : null;

			if (day14) {
				const earlyEvents = userEvents.filter(e => dayjs(e.time).isBefore(day14));
				const hasView = earlyEvents.some(e => e.event === "property viewed");
				const hasSave = earlyEvents.some(e => e.event === "property saved");

				if (hasView && !hasSave) {
					// Cold lead: remove 90% of events after day 14
					profile.cold_lead = true;
					for (let i = userEvents.length - 1; i >= 0; i--) {
						const evt = userEvents[i];
						if (dayjs(evt.time).isAfter(day14)) {
							if (chance.bool({ likelihood: 90 })) {
								userEvents.splice(i, 1);
							} else {
								evt.cold_lead = true;
							}
						}
					}
					// Tag surviving events
					userEvents.forEach(e => { e.cold_lead = true; });
				}
			}
		}

		return record;
	}
};

export default config;
