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
 * NAME:       SupplyStack
 * APP:        B2B warehouse/inventory management SaaS for businesses to track
 *             stock levels, purchase orders, suppliers, shipments, and quality
 *             inspections across multiple warehouses. Multi-tier system with
 *             enterprise, mid-market, small business, and trial customers.
 * SCALE:      10,000 users, ~2.0M events, 121 days (2026-01-01 → 2026-05-01)
 * CORE LOOP:  account created → inventory checked → purchase order → order received → shipment tracked
 *
 * EVENTS (17):
 *   inventory checked (8) > app session (7) > shipment tracked (6) > notification received (6)
 *   > stockout alert (5) > purchase order created (5) > order received (4) > report generated (4)
 *   > supplier contacted (3) > warehouse transfer (3) > invoice processed (3)
 *   > integration connected (2) > alert configured (2) > quality inspection (2)
 *   > account created (1) > support ticket (1) > account deactivated (1)
 *
 * FUNNELS (5):
 *   - Onboarding:          account created → inventory checked → integration connected → report generated (40%)
 *   - Order Fulfillment:   inventory checked → purchase order created → order received → shipment tracked (35%, reentry)
 *   - Supplier Management: supplier contacted → purchase order created → invoice processed (45%)
 *   - Integration Setup:   integration connected → report generated → alert configured (30%)
 *   - Alert Response:      stockout alert → purchase order created → order received (50%)
 *
 * USER PROPS:  company_tier, warehouse_count, employee_count, industry, integration_count, Platform, subscription_plan
 * SUPER PROPS: Platform, subscription_plan
 * SCD PROPS:   company_tier (trial/starter/professional/enterprise, monthly fuzzy, max 6)
 * GROUPS:      none
 */

// ── HOOK STORIES ──
/*
 * -------------------------------------------------------------------
 * 1. MONTH-END REPORTING SURGE (event hook)
 * -------------------------------------------------------------------
 *
 * PATTERN: Reports generated on calendar days 28-31 have 2.5x the
 * report_pages. Simulates end-of-month compliance and audit reporting.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Report Volume by Day of Month
 *   - Report type: Insights
 *   - Event: "report generated"
 *   - Measure: Average of "report_pages"
 *   - Breakdown: Day of month (custom formula or daily chart)
 *   - Expected: Days 28-31 should show ~2x avg report_pages vs mid-month
 *     (month-end ~40 pages, mid-month ~20 pages)
 *
 * REAL-WORLD ANALOGUE: Warehouse managers generate larger, more
 * comprehensive reports at month-end for audits and compliance.
 *
 * -------------------------------------------------------------------
 * 2. RUSH ORDER PREMIUM (event hook)
 * -------------------------------------------------------------------
 *
 * PATTERN: Purchase orders with priority "urgent" get 1.5x unit_cost.
 * Simulates expedited shipping and rush fulfillment surcharges.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Unit Cost by Priority
 *   - Report type: Insights
 *   - Event: "purchase order created"
 *   - Measure: Average of "unit_cost"
 *   - Breakdown: "priority"
 *   - Expected: urgent ~$75 vs standard ~$50 (1.5x ratio)
 *
 * REAL-WORLD ANALOGUE: Rush orders from suppliers incur premium
 * pricing for expedited manufacturing and express shipping.
 *
 * -------------------------------------------------------------------
 * 3. REORDER ACCURACY BY TIER (everything hook)
 * -------------------------------------------------------------------
 *
 * PATTERN: Enterprise users have 0.9x stockout rate -- they get 10%
 * of their "stockout alert" events removed. Better forecasting and
 * larger safety stock reduces out-of-stock incidents.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Stockout Rate by Company Tier
 *   - Report type: Insights
 *   - Event: "stockout alert"
 *   - Measure: Total per user
 *   - Breakdown: user property "company_tier"
 *   - Expected: enterprise ~10% fewer stockout alerts per user than
 *     mid_market or small_business
 *
 *   Report 2: Stockout-to-Order Ratio
 *   - Report type: Insights (formula)
 *   - A = "stockout alert" total, B = "purchase order created" total
 *   - Formula: A / B
 *   - Breakdown: user property "company_tier"
 *   - Expected: enterprise ratio ~0.9x vs small_business baseline
 *
 *   Report 3: Stockout-to-Inventory-Check Ratio (NORMALIZED — recommended)
 *   - Report type: Insights (formula)
 *   - A = "stockout alert" total, B = "inventory checked" total
 *   - Formula: A / B
 *   - Breakdown: user property "company_tier"
 *   - Expected: enterprise ratio ~ 0.9x SMB ratio (10% reduction visible)
 *   - WHY THIS METRIC: per-user counts are dominated by persona event multipliers
 *     (enterprise has 5x baseline activity); ratio normalizes that out.
 *
 * REAL-WORLD ANALOGUE: Enterprise operations have dedicated
 * procurement teams and predictive analytics reducing stockouts.
 *
 * -------------------------------------------------------------------
 * 4. INTEGRATION COMPLETION DRIVES RETENTION (everything hook)
 * -------------------------------------------------------------------
 *
 * PATTERN: Users with 3+ "integration connected" events get cloned
 * "report generated" events. Connected integrations produce richer
 * reporting and deeper platform engagement.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Report Volume by Integration Count
 *   - Report type: Insights
 *   - Event: "report generated"
 *   - Measure: Total per user
 *   - Breakdown: user property "integration_count" (or filter by
 *     users who did "integration connected" 3+ times)
 *   - Expected: Users with 3+ integrations ~2x report events
 *
 * REAL-WORLD ANALOGUE: Businesses that integrate their ERP, shipping,
 * and accounting systems generate more automated reports, increasing
 * stickiness and reducing churn.
 *
 * -------------------------------------------------------------------
 * 5. ALERT FATIGUE (everything hook)
 * -------------------------------------------------------------------
 *
 * PATTERN: Users with >30 "stockout alert" events get increasing
 * response_time_hours on their later alerts. The 20th+ alert has
 * response_time scaled up by 1.5-3x based on position.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Alert Response Time Over Time
 *   - Report type: Insights
 *   - Event: "stockout alert"
 *   - Measure: Average of "response_time_hours"
 *   - Line chart by week
 *   - Filter: users with high alert volume
 *   - Expected: Response time trends upward over time for heavy-alert users
 *     (early alerts ~4h, later alerts ~8-12h)
 *
 * REAL-WORLD ANALOGUE: Alert fatigue is a real operational problem --
 * too many alerts desensitize warehouse managers, slowing response.
 *
 * -------------------------------------------------------------------
 * 6. TRIAL CHURN (everything hook)
 * -------------------------------------------------------------------
 *
 * PATTERN: Trial-tier users lose 50% of their events after day 7
 * (measured from their first event). Simulates trial users who briefly
 * explore then abandon the platform.
 *
 * v1.6 BEHAVIOR CHANGE: v1.5 keyed this hook on record.length < 10,
 * which at this dungeon's event rate (~145 events/user; trial persona
 * ~58) matched only ~0.9% of users and never touched actual trial
 * users — the documented retention read below had no engineered signal
 * behind it. Now keyed on company_tier === "trial" so the story and
 * the report line up.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Retention by Company Tier
 *   - Report type: Retention
 *   - Starting event: "account created"
 *   - Return event: Any event
 *   - Breakdown: user property "company_tier"
 *   - Expected: trial users show a sharp extra drop after week 1
 *     (~50% of their post-week-1 activity is removed, on top of the
 *     organic 14-day trial activity window)
 *
 * REAL-WORLD ANALOGUE: SaaS trial users who don't activate within
 * the first week rarely convert to paying customers.
 *
 * -------------------------------------------------------------------
 * 7. ENTERPRISE PROFILES (user hook)
 * -------------------------------------------------------------------
 *
 * PATTERN: Users with company_tier "enterprise" get warehouse_count
 * boosted to 5-15 and employee_count to 200-2000. Enterprise ops
 * manage significantly more infrastructure.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Warehouse Count by Tier
 *   - Report type: Insights
 *   - Measure: Profiles -> Average of "warehouse_count"
 *   - Breakdown: "company_tier"
 *   - Expected: enterprise ~10 warehouses vs small_business ~2
 *
 *   Report 2: Employee Count Distribution
 *   - Report type: Insights
 *   - Measure: Profiles -> Average of "employee_count"
 *   - Breakdown: "company_tier"
 *   - Expected: enterprise ~1100 vs small_business ~50
 *
 * REAL-WORLD ANALOGUE: Enterprise customers operate multi-warehouse
 * networks with large logistics teams, driving higher ACV.
 *
 * -------------------------------------------------------------------
 * 8. SMALL-BUSINESS CONVERSION DROP (everything hook)
 * -------------------------------------------------------------------
 *
 * PATTERN: Small-business users lose ~35% of "alert configured"
 * events (last step of the Integration Setup funnel). This is
 * implemented via event filtering in the everything hook rather
 * than conversionRate modification in funnel-pre, so the effect
 * is not diluted by organic (non-funnel) events.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Integration Funnel by Tier
 *   - Report type: Funnels
 *   - Steps: "integration connected" -> "report generated" -> "alert configured"
 *   - Breakdown: user property "company_tier"
 *   - Expected: small_business ~20% vs enterprise/mid_market ~30% conversion
 *
 * REAL-WORLD ANALOGUE: Small businesses lack dedicated IT teams,
 * leading to incomplete integration setup and lower alert adoption.
 *
 * -------------------------------------------------------------------
 * 9. INVENTORY-CHECK MAGIC NUMBER (everything hook)
 * -------------------------------------------------------------------
 *
 * PATTERN: Users with 5-15 "inventory checked" events sit in the
 * "engaged-but-focused" sweet spot — every "purchase order created"
 * event gets quantity boosted 1.4x. Users with 16 or more inventory
 * checks are over-engaged (paralysis); ~60% of their "purchase order
 * created" events are dropped. No flag is stamped — discoverable only
 * by binning users on inventory-check COUNT and comparing PO totals.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: PO Quantity by Inventory-Check Bucket
 *   - Report type: Insights (with cohort)
 *   - Cohort A: users with 5-15 "inventory checked" events
 *   - Cohort B: users with 0-4 "inventory checked" events
 *   - Event: "purchase order created"
 *   - Measure: Average of "quantity"
 *   - Compare cohort A vs cohort B
 *   - Expected: cohort A ~ 1.4x higher quantity than B
 *
 *   Report 2: POs per User by Browse Intensity
 *   - Report type: Insights (with cohort)
 *   - Cohort C: users with >= 16 "inventory checked" events
 *   - Cohort A: users with 5-15 "inventory checked" events
 *   - Event: "purchase order created"
 *   - Measure: Total events per user
 *   - Compare cohort C vs cohort A
 *   - Expected: cohort C has ~ 60% fewer POs per user
 *
 * REAL-WORLD ANALOGUE: A focused operations team that monitors
 * stock just enough places larger, more confident orders; an
 * obsessive checker is paralysed and orders less.
 *
 * -------------------------------------------------------------------
 * 10. ONBOARDING TIME-TO-CONVERT (funnel-post hook)
 * -------------------------------------------------------------------
 *
 * PATTERN: Enterprise-tier users complete the Onboarding funnel
 * 1.4x faster (time gaps scaled by 0.71). Small-business and trial
 * users complete it 1.3x slower (gaps scaled by 1.3). The hook
 * iterates over the funnel-post event array, compresses or stretches
 * the inter-step time gaps based on the user's company_tier from
 * meta.profile, then rewrites each event's timestamp.
 *
 * v1.6: scoped to the Onboarding funnel via meta.funnel.name — v1.5
 * applied the factor to every funnel's gaps, contradicting this
 * documented story.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Onboarding TTC by Company Tier
 *   - Report type: Funnels
 *   - Steps: "account created" -> "inventory checked" -> "integration connected" -> "report generated"
 *   - Breakdown: user property "company_tier"
 *   - Metric: Median time to convert
 *   - Expected: enterprise median TTC ~ 0.71x of small_business/trial TTC
 *     (e.g., enterprise ~ 36h vs small_business ~ 66h)
 *
 *   NOTE: This effect is visible in Mixpanel funnel median TTC and in
 *   emulateBreakdown's timeToConvert (the H10 story asserts it at a
 *   93.6h window = 72h generative window x the 1.3 small-business
 *   stretch). Cross-event MIN->MIN SQL queries on raw events do NOT
 *   show it — greedy single-pass pairing across funnel instances
 *   buries the signal.
 *
 * REAL-WORLD ANALOGUE: Enterprise customers have dedicated IT teams
 * and onboarding specialists who move through setup, integration,
 * and first reporting much faster than small businesses configuring
 * the platform themselves.
 *
 * ===================================================================
 * EXPECTED METRICS SUMMARY (Measured = full fidelity, 10K users / 2,020,201 events)
 * ===================================================================
 *
 * Story id                  | Metric                                     | Expected      | Measured
 * --------------------------|--------------------------------------------|---------------|---------
 * H1-month-end-pages        | organic month-end / mid-month report_pages | ≈2.47         | 2.476
 *                           | placebo: clone month-end / mid-month pages | ≈1.0          | 1.002
 * H2-rush-order-premium     | urgent / standard unit_cost                | ≈1.5          | 1.495
 *                           | placebo: expedited / standard unit_cost    | ≈1.0          | 0.999
 * H3-stockout-by-tier       | ent / smb stockout-per-inventory-check     | ≈0.89         | 0.905
 *                           | placebo: mid / smb ratio                   | ≈1.0          | 1.010
 * H4-integration-reports    | clones per integration (3+ cohort)         | ≈0.637        | 0.627
 *                           | <3-integration users with any clone        | 0             | 0.0000
 * H5-alert-fatigue          | late-treated / control response_time       | ≈2.0          | 2.002
 *                           | placebo: early-untreated / control         | ≈1.0          | 1.003
 * H6-trial-churn            | DiD trial wk2/wk1 rate vs small_business   | ≈0.5-0.55     | 0.448
 *                           | placebo: mid_market vs small_business      | ≈1.0          | 1.143
 * H7-enterprise-profiles    | per-tier profile ranges in-range share     | 100%          | 100%
 * H8-smb-conversion-drop    | Integration Setup step2→3 smb/mid conv     | ≈0.50         | 0.472
 *                           | placebo: Supplier Mgmt smb/mid conv        | ≈0.73         | 0.711
 * H9-inventory-magic-number | sweet / low PO quantity                    | ≈1.4          | 1.388
 *                           | keep_hat b16-23/b12-15 PO-per-inv (smb)    | ≈0.37         | 0.379
 *                           | placebo: sweet / low unit_cost             | ≈1.0          | 1.005
 * H10-onboarding-ttc        | Onboarding median TTC ent/mid (93.6h win)  | ≈0.62-0.74    | 0.741
 *                           | Onboarding median TTC smb/mid              | ≈1.1-1.2      | 1.107
 */

// ── SCALE ──
const SEED = "dm4-logistics";
const NUM_USERS = 10_000;
const DATASET_START = "2026-01-01T00:00:00Z";
const DATASET_END = "2026-05-01T23:59:59Z";
const EVENTS_PER_DAY = 1.2;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── KNOBS (tweak these to reshape stories) ──
const MONTH_END_DAY_THRESHOLD = 28;
const MONTH_END_PAGES_MULT = 2.5;

const RUSH_ORDER_COST_MULT = 1.5;

const ENTERPRISE_STOCKOUT_DROP_LIKELIHOOD = 10;

const INTEGRATION_THRESHOLD = 3;
const INTEGRATION_REPORT_CLONE_LIKELIHOOD = 65;

const ALERT_FATIGUE_THRESHOLD = 30;
const ALERT_FATIGUE_START_IDX = 20;
const ALERT_FATIGUE_BASE_MULT = 1.5;
const ALERT_FATIGUE_RAMP_MULT = 1.5;

const TRIAL_CHURN_CUTOFF_DAYS = 7;
const TRIAL_CHURN_DROP_LIKELIHOOD = 50;

const SMB_ALERT_DROP_LIKELIHOOD = 35;

const INVENTORY_SWEET_MIN = 5;
const INVENTORY_SWEET_MAX = 15;
const INVENTORY_OVER_THRESHOLD = 16;
const INVENTORY_PO_QUANTITY_BOOST = 1.4;
const INVENTORY_OVER_PO_DROP_LIKELIHOOD = 60;

const TTC_ENTERPRISE_FACTOR = 0.71;
const TTC_SMB_FACTOR = 1.3;

// ── DATA ARRAYS ──
const warehouseIds = v.range(1, 80).map(() => `WH_${v.uid(6)}`);
const supplierIds = v.range(1, 150).map(() => `SUP_${v.uid(6)}`);

// ── HELPER FUNCTIONS ──
function handleUserHooks(record) {
	// H7: ENTERPRISE PROFILES — large warehouse_count + employee_count by tier.
	if (record.company_tier === "enterprise") {
		record.warehouse_count = chance.integer({ min: 5, max: 15 });
		record.employee_count = chance.integer({ min: 200, max: 2000 });
	} else if (record.company_tier === "mid_market") {
		record.warehouse_count = chance.integer({ min: 2, max: 6 });
		record.employee_count = chance.integer({ min: 20, max: 200 });
	} else if (record.company_tier === "small_business") {
		record.warehouse_count = chance.integer({ min: 1, max: 3 });
		record.employee_count = chance.integer({ min: 5, max: 80 });
	} else if (record.company_tier === "trial") {
		record.warehouse_count = 1;
		record.employee_count = chance.integer({ min: 1, max: 10 });
	}
	return record;
}

function handleEventHooks(record) {
	// H2: RUSH ORDER PREMIUM — urgent purchase orders get 1.5x unit_cost.
	if (record.event === "purchase order created" && record.priority === "urgent") {
		record.unit_cost = Math.floor((record.unit_cost || 50) * RUSH_ORDER_COST_MULT);
	}
	return record;
}

function handleFunnelPostHooks(record, meta) {
	// H10: ONBOARDING TIME-TO-CONVERT — enterprise 1.4x faster (0.71);
	// small_business + trial 1.3x slower (1.3).
	// v1.6: scoped to the Onboarding funnel only. v1.5 applied the factor to
	// EVERY funnel's inter-step gaps, contradicting the documented story
	// (Onboarding TTC) and silently stretching/compressing all five funnels.
	if (meta?.funnel?.name !== "Onboarding") return record;
	const segment = meta?.profile?.company_tier;
	if (Array.isArray(record) && record.length > 1) {
		const factor = (
			segment === "enterprise" ? TTC_ENTERPRISE_FACTOR :
			segment === "small_business" || segment === "trial" ? TTC_SMB_FACTOR :
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
	if (!record.length) return record;
	const profile = meta.profile;

	// ── SUPER-PROP STAMPING ──
	// Stamp superProps from profile so they are consistent per-user.
	if (profile) {
		const plat = profile.Platform;
		const plan = profile.subscription_plan;
		record.forEach(e => {
			if (plat) e.Platform = plat;
			if (plan) e.subscription_plan = plan;
		});
	}

	// H1: MONTH-END REPORTING SURGE — reports on calendar days 28-31 get
	// 2.5x report_pages. Runs in everything (post-sessionization) so the
	// day-of-month tag matches the final timestamp.
	for (const e of record) {
		if (e.event === "report generated") {
			const dayOfMonth = new Date(e.time).getUTCDate();
			if (dayOfMonth >= MONTH_END_DAY_THRESHOLD) {
				e.report_pages = Math.floor((e.report_pages || 20) * MONTH_END_PAGES_MULT);
			}
		}
	}

	// H8: SMALL-BUSINESS CONVERSION DROP — small_business users lose
	// ~35% of "alert configured" events (last step of Integration Setup
	// funnel), simulating lower conversion without dedicated IT.
	if (profile && profile.company_tier === "small_business") {
		record = record.filter(e => {
			if (e.event === "alert configured" && chance.bool({ likelihood: SMB_ALERT_DROP_LIKELIHOOD })) {
				return false;
			}
			return true;
		});
	}

	// H3: REORDER ACCURACY BY TIER — enterprise users get 10% of
	// stockout alerts removed (better forecasting + safety stock).
	if (profile && profile.company_tier === "enterprise") {
		for (let i = record.length - 1; i >= 0; i--) {
			if (record[i].event === "stockout alert" && chance.bool({ likelihood: ENTERPRISE_STOCKOUT_DROP_LIKELIHOOD })) {
				record.splice(i, 1);
			}
		}
	}

	// H6: TRIAL CHURN — trial-tier users lose 50% of events after day 7
	// (measured from their first event; account created is isFirstEvent so
	// record[0] is the birth event).
	// v1.6: keyed on company_tier === "trial". v1.5 keyed on
	// record.length < 10, which at this dungeon's event rate (~145
	// events/user; trial persona ~58) matched only ~0.9% of users and never
	// touched actual trial users — the documented retention read (trial
	// drop after week 1, broken down by company_tier) had no engineered
	// signal behind it.
	// Runs BEFORE H4 so the 3+-integration clone cohort is defined on
	// FINAL integration counts — otherwise churned trial users keep clones
	// while their output count falls below the threshold (leakage).
	if (profile && profile.company_tier === "trial" && record.length > 1) {
		const firstTime = dayjs(record[0].time);
		const cutoff = firstTime.add(TRIAL_CHURN_CUTOFF_DAYS, "days");
		for (let i = record.length - 1; i >= 0; i--) {
			if (dayjs(record[i].time).isAfter(cutoff) && chance.bool({ likelihood: TRIAL_CHURN_DROP_LIKELIHOOD })) {
				record.splice(i, 1);
			}
		}
	}

	// H4: INTEGRATION COMPLETION DRIVES RETENTION — users with 3+
	// "integration connected" events get cloned "report generated" events.
	const integrationCount = record.filter(e => e.event === "integration connected").length;
	if (integrationCount >= INTEGRATION_THRESHOLD) {
		const templateReport = record.find(e => e.event === "report generated");
		if (templateReport) {
			const integrationEvents = record.filter(e => e.event === "integration connected");
			integrationEvents.forEach(ie => {
				if (chance.bool({ likelihood: INTEGRATION_REPORT_CLONE_LIKELIHOOD })) {
					record.push({
						...templateReport,
						time: dayjs(ie.time).add(chance.integer({ min: 1, max: 5 }), "days").toISOString(),
						user_id: ie.user_id,
						insert_id: chance.guid(), // clones must not share the template's insert_id (Mixpanel dedup)
						report_type: "integration_summary",
						report_pages: chance.integer({ min: 5, max: 25 }),
					});
				}
			});
		}
	}

	// H5: ALERT FATIGUE — users with >30 stockout alerts get increasing
	// response_time_hours starting at the 20th alert.
	const alertEvents = record.filter(e => e.event === "stockout alert");
	if (alertEvents.length > ALERT_FATIGUE_THRESHOLD) {
		alertEvents.forEach((alert, idx) => {
			if (idx >= ALERT_FATIGUE_START_IDX) {
				const fatigueMultiplier = ALERT_FATIGUE_BASE_MULT + ((idx - ALERT_FATIGUE_START_IDX) / alertEvents.length) * ALERT_FATIGUE_RAMP_MULT;
				alert.response_time_hours = Math.floor((alert.response_time_hours || 4) * fatigueMultiplier);
			}
		});
	}

	// H9: INVENTORY-CHECK MAGIC NUMBER (no flags) — sweet 5-15 inventory
	// checks → PO quantity x1.4; over 16+ → drop 60% of PO created events.
	const invCheckCount = record.filter(e => e.event === "inventory checked").length;
	if (invCheckCount >= INVENTORY_SWEET_MIN && invCheckCount <= INVENTORY_SWEET_MAX) {
		record.forEach(e => {
			if (e.event === "purchase order created" && typeof e.quantity === "number") {
				e.quantity = Math.round(e.quantity * INVENTORY_PO_QUANTITY_BOOST);
			}
		});
	} else if (invCheckCount >= INVENTORY_OVER_THRESHOLD) {
		for (let i = record.length - 1; i >= 0; i--) {
			if (record[i].event === "purchase order created" && chance.bool({ likelihood: INVENTORY_OVER_PO_DROP_LIKELIHOOD })) {
				record.splice(i, 1);
			}
		}
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
		hasAndroidDevices: false,
		hasIOSDevices: false,
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
	scdProps: {
		company_tier: {
			values: ["trial", "starter", "professional", "enterprise"],
			frequency: "month",
			timing: "fuzzy",
			max: 6
		}
	},
	mirrorProps: {},
	lookupTables: [],

	// -- Events (17) --------------------------------------------------
	events: [
		{
			event: "account created",
			weight: 1,
			isFirstEvent: true,
			isAuthEvent: true,
			properties: {
				referral_source: ["organic", "partner_referral", "google_search", "trade_show", "linkedin"],
			},
		},
		{
			event: "inventory checked",
			weight: 8,
			isStrictEvent: false,
			properties: {
				warehouse_id: chance.pickone.bind(chance, warehouseIds),
				sku_category: ["electronics", "apparel", "food_beverage", "pharma", "raw_materials", "packaging", "automotive_parts"],
				stock_level: u.weighNumRange(0, 5000, 0.4, 500),
				reorder_point: u.weighNumRange(10, 500, 0.5, 100),
				reorder_method: ["manual"],
			},
		},
		{
			event: "stockout alert",
			weight: 5,
			isStrictEvent: false,
			properties: {
				warehouse_id: chance.pickone.bind(chance, warehouseIds),
				sku_category: ["electronics", "apparel", "food_beverage", "pharma", "raw_materials", "packaging"],
				items_affected: u.weighNumRange(1, 50, 0.4, 5),
				severity: ["low", "medium", "medium", "high", "critical"],
				response_time_hours: u.weighNumRange(0.5, 48, 0.3, 4),
			},
		},
		{
			event: "purchase order created",
			weight: 5,
			isStrictEvent: false,
			properties: {
				supplier_id: chance.pickone.bind(chance, supplierIds),
				sku_category: ["electronics", "apparel", "food_beverage", "pharma", "raw_materials", "packaging", "automotive_parts"],
				quantity: u.weighNumRange(10, 5000, 0.3, 200),
				unit_cost: u.weighNumRange(5, 200, 0.4, 50),
				priority: ["standard", "standard", "standard", "expedited", "urgent"],
				estimated_delivery_days: u.weighNumRange(1, 30, 0.4, 7),
			},
		},
		{
			event: "order received",
			weight: 4,
			properties: {
				warehouse_id: chance.pickone.bind(chance, warehouseIds),
				supplier_id: chance.pickone.bind(chance, supplierIds),
				quantity_received: u.weighNumRange(10, 5000, 0.3, 200),
				quantity_damaged: u.weighNumRange(0, 20, 0.2),
				receiving_time_hours: u.weighNumRange(0.5, 8, 0.5, 2),
			},
		},
		{
			event: "shipment tracked",
			weight: 6,
			properties: {
				carrier: ["fedex", "ups", "dhl", "usps", "freight_line", "regional_courier"],
				shipment_status: ["in_transit", "in_transit", "in_transit", "delivered", "delayed", "exception"],
				origin_warehouse: chance.pickone.bind(chance, warehouseIds),
				estimated_days: u.weighNumRange(1, 14, 0.4, 3),
				weight_kg: u.weighNumRange(1, 2000, 0.3, 50),
			},
		},
		{
			event: "supplier contacted",
			weight: 3,
			properties: {
				supplier_id: chance.pickone.bind(chance, supplierIds),
				contact_reason: ["price_negotiation", "order_status", "quality_issue", "new_product", "contract_renewal", "returns"],
				contact_method: ["email", "email", "phone", "portal"],
				supplier_access: ["email_only"],
			},
		},
		{
			event: "integration connected",
			weight: 2,
			isStrictEvent: false,
			properties: {
				integration_type: ["erp", "accounting", "shipping", "ecommerce", "crm", "bi_tool"],
				integration_name: ["SAP", "QuickBooks", "ShipStation", "Shopify", "Salesforce", "NetSuite", "Xero"],
				setup_time_minutes: u.weighNumRange(5, 120, 0.4, 30),
			},
		},
		{
			event: "report generated",
			weight: 4,
			isStrictEvent: false,
			properties: {
				report_type: ["inventory_summary", "order_history", "supplier_performance", "cost_analysis", "forecast", "compliance"],
				report_pages: u.weighNumRange(1, 50, 0.4, 20),
				export_format: ["pdf", "csv", "xlsx"],
				time_range_days: [7, 14, 30, 30, 90],
			},
		},
		{
			event: "alert configured",
			weight: 2,
			isStrictEvent: false,
			properties: {
				alert_type: ["low_stock", "delivery_delay", "price_change", "quality_threshold", "expiry_warning"],
				threshold_value: u.weighNumRange(1, 500, 0.4, 50),
				notification_channel: ["email", "email", "sms", "push", "slack"],
			},
		},
		{
			event: "warehouse transfer",
			weight: 3,
			properties: {
				from_warehouse: chance.pickone.bind(chance, warehouseIds),
				to_warehouse: chance.pickone.bind(chance, warehouseIds),
				sku_category: ["electronics", "apparel", "food_beverage", "pharma", "raw_materials"],
				transfer_quantity: u.weighNumRange(10, 1000, 0.4, 100),
				transfer_reason: ["rebalance", "demand_shift", "consolidation", "overflow", "seasonal"],
			},
		},
		{
			event: "quality inspection",
			weight: 2,
			properties: {
				warehouse_id: chance.pickone.bind(chance, warehouseIds),
				inspection_result: ["pass", "pass", "pass", "pass", "minor_issue", "major_issue", "fail"],
				items_inspected: u.weighNumRange(10, 500, 0.4, 50),
				defect_rate_pct: u.weighNumRange(0, 15, 0.3, 2),
			},
		},
		{
			event: "invoice processed",
			weight: 3,
			properties: {
				supplier_id: chance.pickone.bind(chance, supplierIds),
				invoice_amount: u.weighNumRange(100, 50000, 0.3, 2500),
				payment_terms: ["net_30", "net_30", "net_60", "net_15", "on_receipt"],
				payment_status: ["paid", "paid", "paid", "pending", "overdue"],
			},
		},
		{
			event: "notification received",
			weight: 6,
			properties: {
				notification_type: ["low_stock_alert", "low_stock_alert", "delivery_update", "order_confirmation", "invoice_due", "system_update"],
				channel: ["email", "email", "push", "sms"],
				opened: [true, true, true, false],
			},
		},
		{
			event: "support ticket",
			weight: 1,
			properties: {
				category: ["billing", "technical", "integration", "data_import", "feature_request", "training"],
				priority: ["low", "low", "medium", "medium", "high"],
				resolution_hours: u.weighNumRange(1, 72, 0.4, 12),
			},
		},
		{
			event: "app session",
			weight: 7,
			properties: {
				session_duration_sec: u.weighNumRange(30, 3600, 0.4, 300),
				pages_viewed: u.weighNumRange(1, 20, 0.5, 5),
			},
		},
		{
			event: "account deactivated",
			weight: 1,
			isChurnEvent: true,
			returnLikelihood: 0.10,
			isStrictEvent: true,
			properties: {
				reason: ["too_expensive", "switched_competitor", "business_closed", "missing_features", "poor_support"],
			},
		},
	],

	// -- Funnels (5) --------------------------------------------------
	funnels: [
		{
			name: "Onboarding",
			sequence: ["account created", "inventory checked", "integration connected", "report generated"],
			conversionRate: 40,
			order: "sequential",
			isFirstFunnel: true,
			timeToConvert: 72,
			weight: 3,
		},
		{
			name: "Order Fulfillment",
			sequence: ["inventory checked", "purchase order created", "order received", "shipment tracked"],
			conversionRate: 35,
			order: "sequential",
			timeToConvert: 168,
			weight: 5,
			reentry: true,
		},
		{
			name: "Supplier Management",
			sequence: ["supplier contacted", "purchase order created", "invoice processed"],
			conversionRate: 45,
			order: "sequential",
			timeToConvert: 336,
			weight: 3,
		},
		{
			name: "Integration Setup",
			sequence: ["integration connected", "report generated", "alert configured"],
			conversionRate: 30,
			order: "sequential",
			timeToConvert: 48,
			weight: 2,
		},
		{
			name: "Alert Response",
			sequence: ["stockout alert", "purchase order created", "order received"],
			conversionRate: 50,
			order: "sequential",
			timeToConvert: 120,
			weight: 3,
		},
	],

	// -- SuperProps ----------------------------------------------------
	superProps: {
		Platform: ["web", "web", "desktop_app"],
		subscription_plan: ["free_trial", "free_trial", "starter", "starter", "professional", "enterprise"],
	},

	// -- UserProps -----------------------------------------------------
	userProps: {
		company_tier: ["small_business"],
		warehouse_count: u.weighNumRange(1, 10, 0.4, 2),
		employee_count: u.weighNumRange(1, 500, 0.3, 25),
		industry: ["retail", "manufacturing", "food_beverage", "pharma", "electronics"],
		integration_count: [0],
		Platform: ["web", "web", "desktop_app"],
		subscription_plan: ["free_trial", "free_trial", "starter", "starter", "professional", "enterprise"],
	},

	// -- Phase 2: Personas --------------------------------------------
	personas: [
		{
			name: "enterprise_ops",
			weight: 15,
			eventMultiplier: 5.0,
			conversionModifier: 1.5,
			churnRate: 0.01,
			properties: {
				company_tier: "enterprise",
				segment: "enterprise_ops",
			},
		},
		{
			name: "mid_market",
			weight: 35,
			eventMultiplier: 1.5,
			conversionModifier: 1.0,
			churnRate: 0.05,
			properties: {
				company_tier: "mid_market",
				segment: "mid_market",
			},
		},
		{
			name: "small_business",
			weight: 40,
			eventMultiplier: 0.8,
			conversionModifier: 0.7,
			churnRate: 0.10,
			properties: {
				company_tier: "small_business",
				segment: "small_business",
			},
		},
		{
			name: "trial_explorer",
			weight: 10,
			eventMultiplier: 0.4,
			conversionModifier: 0.3,
			churnRate: 0.4,
			properties: {
				company_tier: "trial",
				segment: "trial_explorer",
			},
			activeWindow: { maxDays: 14 },
		},
	],

	// -- Phase 2: World Events ----------------------------------------
	worldEvents: [
		{
			name: "supply_chain_disruption",
			type: "outage",
			startDay: 35,
			duration: 5,
			volumeMultiplier: 3.0,
			affectsEvents: ["stockout alert"],
			injectProps: { disruption: "supply_chain_disruption" },
			aftermath: { duration: 5, volumeMultiplier: 1.5 },
		},
		{
			name: "holiday_surge",
			type: "campaign",
			startDay: 70,
			duration: 7,
			volumeMultiplier: 2.0,
			affectsEvents: ["purchase order created", "order received", "shipment tracked"],
			injectProps: { surge: "holiday_prep" },
		},
	],

	// -- Phase 2: Subscription ----------------------------------------
	subscription: {
		plans: [
			{ name: "free_trial", price: 0, default: true, trialDays: 30 },
			{ name: "starter", price: 49 },
			{ name: "professional", price: 199 },
			{ name: "enterprise", price: 599 },
		],
		lifecycle: {
			trialToPayRate: 0.25,
			upgradeRate: 0.06,
			downgradeRate: 0.03,
			churnRate: 0.05,
			winBackRate: 0.08,
			winBackDelay: 30,
			paymentFailureRate: 0.02,
		},
	},

	// -- Phase 2: Geo -------------------------------------------------
	geo: {
		sticky: true,
		regions: [
			{
				name: "us",
				countries: ["US"],
				weight: 45,
				timezoneOffset: -5,
				properties: { currency: "USD", locale: "en-US" },
			},
			{
				name: "eu",
				countries: ["GB", "DE", "NL"],
				weight: 30,
				timezoneOffset: 1,
				properties: { currency: "EUR", locale: "en-EU", vat_tracking: true },
			},
			{
				name: "apac",
				countries: ["SG", "JP", "AU"],
				weight: 25,
				timezoneOffset: 8,
				properties: { currency: "SGD", locale: "en-APAC" },
			},
		],
	},

	// -- Phase 2: Features --------------------------------------------
	features: [
		{
			name: "predictive_reorder",
			launchDay: 40,
			adoptionCurve: "fast",
			property: "reorder_method",
			values: ["manual", "predictive"],
			defaultBefore: "manual",
			affectsEvents: ["inventory checked"],
		},
		{
			name: "supplier_portal",
			launchDay: 65,
			adoptionCurve: { k: 0.08, midpoint: 25 },
			property: "supplier_access",
			values: ["email_only", "portal"],
			defaultBefore: "email_only",
			affectsEvents: ["supplier contacted"],
		},
	],

	// -- Phase 2: Anomalies -------------------------------------------
	anomalies: [
		{
			type: "extreme_value",
			event: "stockout alert",
			property: "items_affected",
			frequency: 0.005,
			multiplier: 30,
			tag: "mass_stockout",
		},
		{
			type: "coordinated",
			event: "purchase order created",
			day: 72,
			window: 0.08,
			count: 150,
			tag: "holiday_prep",
		},
	],

	hook(record, type, meta) {
		if (type === "user") return handleUserHooks(record);
		if (type === "event") return handleEventHooks(record);
		if (type === "funnel-post") return handleFunnelPostHooks(record, meta);
		if (type === "everything") return handleEverythingHooks(record, meta);
		return record;
	},
};

export default config;

// ═══════════════════════════════════════════════════════════════
// STORIES — v1.6 machine-checkable verification contract
// ═══════════════════════════════════════════════════════════════
//
// Measurement doctrine (why each read is shaped the way it is):
//
// - IDENTITY. avgDevicePerUser: 2, and "account created" is both
//   isAuthEvent and isFirstEvent, so born users auth on their first
//   event. The ID_CTE resolves device-only rows through the profile
//   device pool (stored under the legacy "anonymousIds" key).
//
// - CLONE EXCLUSION (H1 vs H4). H4's cloned reports carry
//   report_type = 'integration_summary' — a value outside the organic
//   pool — and uniform report_pages [5, 25] stamped AFTER H1's
//   month-end multiplier runs. Clones therefore dilute any pooled
//   month-end read; H1 filters them out (and uses them as its placebo
//   arm: their day-of-month page ratio must be ~1.0).
//
// - ONE-SIDED DELETIONS. Stockout alerts are deleted only for
//   enterprise (H3), alert-configured only for small_business (H8),
//   POs only for 16+ inventory checkers (H9), trial events only after
//   day 7 (H6). H6 runs BEFORE both count-threshold hooks (H4, H9), so
//   output integration-connected and inventory-check counts equal the
//   hook-time counts those thresholds keyed on — cohort membership is
//   exactly recoverable from the output.
//
// - ACTIVITY COUPLING (H9 volume read). Inventory-check count is
//   coupled to total activity, so cross-arm PO-per-user levels are
//   meaningless. The read uses PO-per-inventory-check within the
//   small_business tier only (constant conversionModifier), and reads
//   the treated cliff against the adjacent untreated bin, with a
//   flatness guard on the pre-cliff bins (measured organic gradient:
//   1.62 → 1.62 → 1.46 across bins 4-7/8-11/12-15).
//
// - RELATIVE-DAY DiD (H6). Trial users lose 50% of events after day 7
//   from first event. Cross-tier LEVELS differ (activeWindow 14d,
//   multipliers), but each tier's own rate(day 8-13)/rate(day 1-6)
//   cancels its level; small_business is the untreated comparator.
//   Derivation: DiD = 0.5 x (organic trial ratio / organic smb ratio);
//   the organic composition term is bounded [0.9, 1.2] (smb measured
//   0.91, mid 0.96, enterprise 1.06 — flat-to-mild-decline across
//   personas), giving [0.45, 0.60]; band [0.44, 0.62].
//
// - EMULATOR TTC (H8, H10). Funnel-step conversion and TTC reads go
//   through emulateBreakdown's timeToConvert (Mixpanel-aligned greedy
//   in-window pairing). H10's window = 72h generative x 1.3 max
//   stretch = 93.6h so slow-arm conversions are not right-censored
//   into a fake speedup. Only born-in-dataset users (~12%) have
//   "account created" inside the window — cohorts are structurally
//   ~1/8 of numUsers; minCohort reflects that.
//
// - PERSONA CONVERSION GAP (H8). small_business carries an organic
//   conversionModifier gap vs mid_market on EVERY funnel. The placebo
//   assertion pins that organic gap on the untreated Supplier
//   Management funnel (measured 0.73; Alert Response cross-check
//   0.85); the treated Integration Setup ratio must sit at
//   0.65 x organic [0.73, 0.85] x multi-candidate attenuation
//   [1.0, 1.12] = [0.47, 0.62].

const ID_CTE = `
us AS (SELECT * FROM read_json_auto('{{PREFIX}}-USERS*.json', sample_size=-1, union_by_name=true)),
dm AS (SELECT unnest("anonymousIds") AS device_id, distinct_id FROM us),
ev AS (SELECT coalesce(m.distinct_id::VARCHAR, e.user_id::VARCHAR, e.device_id::VARCHAR) AS uid,
       e.time::TIMESTAMP AS t, e.*
FROM read_json_auto('{{PREFIX}}-EVENTS*.json', sample_size=-1, union_by_name=true) e
LEFT JOIN dm m ON e.device_id = m.device_id)`;

const PU_CTE = `
pu AS (SELECT uid, count(*) AS total,
  count(*) FILTER (WHERE event = 'inventory checked') AS inv,
  count(*) FILTER (WHERE event = 'purchase order created') AS po,
  count(*) FILTER (WHERE event = 'stockout alert') AS so,
  count(*) FILTER (WHERE event = 'integration connected') AS ic,
  count(*) FILTER (WHERE event = 'report generated' AND report_type = 'integration_summary') AS clones,
  min(t) AS first_t
FROM ev GROUP BY 1)`;

const cellsOf = (rows, key) => Object.fromEntries((rows || []).map((r) => [r[key], r]));

export const stories = [
	{
		id: "H1-month-end-pages",
		hook: "H1",
		archetype: "temporal-inflection",
		narrative:
			`Reports on calendar days >= ${MONTH_END_DAY_THRESHOLD} get report_pages x${MONTH_END_PAGES_MULT} ` +
			"(floored). The read excludes H4's clones (report_type 'integration_summary' — stamped after " +
			"H1 runs, with uniform [5, 25] pages regardless of day). Organic pool mean ~22 pages, so the " +
			`floor costs ~1%: expected ratio ~${(MONTH_END_PAGES_MULT - 0.03).toFixed(2)}, band [2.25, 2.65]. ` +
			"The clones themselves are the placebo arm: their day-of-month ratio must sit in [0.88, 1.12].",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT CASE WHEN extract(day FROM t) >= ${MONTH_END_DAY_THRESHOLD} THEN 'me' ELSE 'mid' END AS bucket,
  count(*)::BIGINT AS user_count, avg(report_pages) AS pages
FROM ev WHERE event = 'report generated' AND report_type <> 'integration_summary'
GROUP BY 1`,
				},
				select: {
					me: { where: { bucket: "me" } },
					mid: { where: { bucket: "mid" } },
				},
				expect: { metric: "me.pages / mid.pages", op: "between", target: [2.25, 2.65] },
				minCohort: 5000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT CASE WHEN extract(day FROM t) >= ${MONTH_END_DAY_THRESHOLD} THEN 'me' ELSE 'mid' END AS bucket,
  count(*)::BIGINT AS user_count, avg(report_pages) AS pages
FROM ev WHERE event = 'report generated' AND report_type = 'integration_summary'
GROUP BY 1`,
				},
				select: {
					me: { where: { bucket: "me" } },
					mid: { where: { bucket: "mid" } },
				},
				expect: { metric: "me.pages / mid.pages", op: "between", target: [0.88, 1.12] },
				minCohort: 4000,
			},
		],
	},
	{
		id: "H2-rush-order-premium",
		hook: "H2",
		archetype: "cohort-prop-scale",
		narrative:
			`'purchase order created' with priority 'urgent' gets unit_cost x${RUSH_ORDER_COST_MULT}, floored. ` +
			"unit_cost is an iid pool draw (organic mean ~93), priority is an iid 3:1:1 pool, and no other " +
			"hook touches unit_cost — the urgent/standard mean ratio reads the knob within floor loss " +
			"(<1%). Band [1.42, 1.58]. 'expedited' is untreated: placebo band [0.94, 1.06].",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT priority, count(*)::BIGINT AS user_count, avg(unit_cost) AS cost
FROM ev WHERE event = 'purchase order created' AND priority IN ('urgent', 'standard')
GROUP BY 1`,
				},
				select: {
					urg: { where: { priority: "urgent" } },
					std: { where: { priority: "standard" } },
				},
				expect: { metric: "urg.cost / std.cost", op: "between", target: [1.42, 1.58] },
				minCohort: 20000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT priority, count(*)::BIGINT AS user_count, avg(unit_cost) AS cost
FROM ev WHERE event = 'purchase order created' AND priority IN ('expedited', 'standard')
GROUP BY 1`,
				},
				select: {
					exp: { where: { priority: "expedited" } },
					std: { where: { priority: "standard" } },
				},
				expect: { metric: "exp.cost / std.cost", op: "between", target: [0.94, 1.06] },
				minCohort: 20000,
			},
		],
	},
	{
		id: "H3-stockout-by-tier",
		hook: "H3",
		archetype: "cohort-count-scale",
		narrative:
			`Enterprise users get ${ENTERPRISE_STOCKOUT_DROP_LIKELIHOOD}% of stockout alerts removed. ` +
			"Per-user LEVELS are dominated by persona event multipliers (enterprise 5x), so the read is " +
			"the stockout-per-inventory-check ratio — both counts scale with the same multiplier, and " +
			"the supply-chain worldEvent (x3 stockouts, days 35-40) hits all tiers alike and cancels " +
			"cross-tier. Expected enterprise/small_business = 0.90 x organic composition (~0.98 measured), " +
			"band [0.83, 0.95]; mid_market placebo [0.93, 1.07].",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${PU_CTE}
SELECT u.company_tier AS tier, count(*)::BIGINT AS user_count,
  sum(p.so)::DOUBLE / sum(p.inv) AS ratio
FROM pu p JOIN us u ON u.distinct_id::VARCHAR = p.uid
GROUP BY 1`,
				},
				select: {
					ent: { where: { tier: "enterprise" } },
					smb: { where: { tier: "small_business" } },
				},
				expect: { metric: "ent.ratio / smb.ratio", op: "between", target: [0.83, 0.95] },
				minCohort: 1000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${PU_CTE}
SELECT u.company_tier AS tier, count(*)::BIGINT AS user_count,
  sum(p.so)::DOUBLE / sum(p.inv) AS ratio
FROM pu p JOIN us u ON u.distinct_id::VARCHAR = p.uid
GROUP BY 1`,
				},
				select: {
					mid: { where: { tier: "mid_market" } },
					smb: { where: { tier: "small_business" } },
				},
				expect: { metric: "mid.ratio / smb.ratio", op: "between", target: [0.93, 1.07] },
				minCohort: 2500,
			},
		],
	},
	{
		id: "H4-integration-reports",
		hook: "H4",
		archetype: "cohort-count-scale",
		narrative:
			`Users with >= ${INTEGRATION_THRESHOLD} 'integration connected' events get a cloned ` +
			`'report generated' per integration at ${INTEGRATION_REPORT_CLONE_LIKELIHOOD}% likelihood, ` +
			"+1-5 days after the integration, tagged report_type 'integration_summary'. H6 (the only " +
			"hook that deletes integrations) runs BEFORE H4, so output integration counts equal H4's " +
			"hook-time counts exactly — the clone cohort is defined on final counts. Clones landing " +
			"past dataset end are killed by the future-time guard: expected rate = 0.65 x (1 - ~2% " +
			"edge loss) = 0.637 (measured 0.6315 at iteration). Band [0.58, 0.70]. Users below the " +
			"threshold must have ZERO clones — leakage is structural, not statistical.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${PU_CTE}
SELECT count(*)::BIGINT AS users, sum(p.clones)::DOUBLE / sum(p.ic) AS rate
FROM pu p WHERE p.ic >= ${INTEGRATION_THRESHOLD}`,
				},
				assert: (rows) => {
					const r = rows?.[0];
					if (!r || Number(r.users) < 5000) {
						return { verdict: "WEAK", detail: `cohort too small: users=${r?.users ?? 0}` };
					}
					const rate = Number(r.rate);
					const detail = `clones-per-integration=${rate.toFixed(4)} (knob ${INTEGRATION_REPORT_CLONE_LIKELIHOOD}% x ~0.98 future-guard survival; n=${r.users})`;
					if (rate >= 0.58 && rate <= 0.70) return { verdict: "NAILED", detail };
					if (rate >= 0.54 && rate <= 0.74) return { verdict: "STRONG", detail };
					if (rate >= 0.30) return { verdict: "WEAK", detail };
					return { verdict: "NONE", detail };
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${PU_CTE}
SELECT count(*)::BIGINT AS users, avg((p.clones > 0)::INT) AS leak
FROM pu p WHERE p.ic < ${INTEGRATION_THRESHOLD}`,
				},
				assert: (rows) => {
					const r = rows?.[0];
					if (!r || Number(r.users) < 800) {
						return { verdict: "WEAK", detail: `cohort too small: users=${r?.users ?? 0}` };
					}
					const leak = Number(r.leak);
					const detail = `share of <${INTEGRATION_THRESHOLD}-integration users with any clone=${leak.toFixed(4)} (n=${r.users})`;
					if (leak <= 0.01) return { verdict: "NAILED", detail };
					if (leak <= 0.03) return { verdict: "STRONG", detail };
					return { verdict: "NONE", detail };
				},
			},
		],
	},
	{
		id: "H5-alert-fatigue",
		hook: "H5",
		archetype: "temporal-inflection",
		narrative:
			`Users with > ${ALERT_FATIGUE_THRESHOLD} stockout alerts get response_time_hours scaled on ` +
			`alerts from index ${ALERT_FATIGUE_START_IDX} on: x(1.5 + 1.5 x (idx-20)/n). Hook index is ` +
			"record order, read index is time order — iteration showed the alignment is exact (early-arm " +
			"placebo 1.000). Reading indexes >= 25 (margin past the boundary), aggregate multiplier ~2.0 " +
			"for the observed n distribution. Control = users with 20-30 alerts (never treated, same iid " +
			"response_time pool, mean ~25h). Bands: treated-late/control [1.75, 2.25]; treated-early " +
			"(idx <= 14, untreated) placebo [0.88, 1.12].",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
al AS (SELECT uid, response_time_hours AS rt,
  row_number() OVER (PARTITION BY uid ORDER BY t) - 1 AS idx,
  count(*) OVER (PARTITION BY uid) AS n
FROM ev WHERE event = 'stockout alert')
SELECT 'late' AS cell, count(DISTINCT uid)::BIGINT AS user_count, avg(rt) AS rt
FROM al WHERE n > ${ALERT_FATIGUE_THRESHOLD} AND idx >= 25
UNION ALL
SELECT 'ctl', count(DISTINCT uid)::BIGINT, avg(rt)
FROM al WHERE n BETWEEN 20 AND ${ALERT_FATIGUE_THRESHOLD}`,
				},
				select: {
					late: { where: { cell: "late" } },
					ctl: { where: { cell: "ctl" } },
				},
				expect: { metric: "late.rt / ctl.rt", op: "between", target: [1.75, 2.25] },
				minCohort: 500,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
al AS (SELECT uid, response_time_hours AS rt,
  row_number() OVER (PARTITION BY uid ORDER BY t) - 1 AS idx,
  count(*) OVER (PARTITION BY uid) AS n
FROM ev WHERE event = 'stockout alert')
SELECT 'early' AS cell, count(DISTINCT uid)::BIGINT AS user_count, avg(rt) AS rt
FROM al WHERE n > ${ALERT_FATIGUE_THRESHOLD} AND idx <= 14
UNION ALL
SELECT 'ctl', count(DISTINCT uid)::BIGINT, avg(rt)
FROM al WHERE n BETWEEN 20 AND ${ALERT_FATIGUE_THRESHOLD}`,
				},
				select: {
					early: { where: { cell: "early" } },
					ctl: { where: { cell: "ctl" } },
				},
				expect: { metric: "early.rt / ctl.rt", op: "between", target: [0.88, 1.12] },
				minCohort: 500,
			},
		],
	},
	{
		id: "H6-trial-churn",
		hook: "H6",
		archetype: "retention-divergence",
		narrative:
			`Trial-tier users lose ${TRIAL_CHURN_DROP_LIKELIHOOD}% of events after day ` +
			`${TRIAL_CHURN_CUTOFF_DAYS} from their first event (v1.6 behavior change: v1.5 keyed on ` +
			"record.length < 10, which matched ~0.9% of users and never touched trials). Cross-tier " +
			"levels are incomparable (activeWindow 14d, 0.4x multiplier), so the read is a relative-day " +
			"DiD: each tier's own rate(day 8-13)/rate(day 1-6) cancels its level. Derivation: DiD = " +
			"0.5 x (organic trial ratio / organic smb ratio), organic term bounded [0.9, 1.2] from the " +
			"untreated tiers' spread (smb 0.91, mid 0.96, ent 1.06) => band [0.44, 0.62]. Placebo " +
			"mid_market/smb [0.92, 1.15].",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
fe AS (SELECT uid, min(t) AS f FROM ev GROUP BY 1),
rd AS (SELECT e.uid, date_diff('day', fe.f, e.t) AS d FROM ev e JOIN fe ON fe.uid = e.uid)
SELECT u.company_tier AS tier, count(DISTINCT r.uid)::BIGINT AS user_count,
  count(*) FILTER (WHERE d BETWEEN 8 AND 13)::DOUBLE / count(*) FILTER (WHERE d BETWEEN 1 AND 6) AS ratio
FROM rd r JOIN us u ON u.distinct_id::VARCHAR = r.uid
GROUP BY 1`,
				},
				select: {
					trial: { where: { tier: "trial" } },
					smb: { where: { tier: "small_business" } },
				},
				expect: { metric: "trial.ratio / smb.ratio", op: "between", target: [0.44, 0.62] },
				minCohort: 500,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
fe AS (SELECT uid, min(t) AS f FROM ev GROUP BY 1),
rd AS (SELECT e.uid, date_diff('day', fe.f, e.t) AS d FROM ev e JOIN fe ON fe.uid = e.uid)
SELECT u.company_tier AS tier, count(DISTINCT r.uid)::BIGINT AS user_count,
  count(*) FILTER (WHERE d BETWEEN 8 AND 13)::DOUBLE / count(*) FILTER (WHERE d BETWEEN 1 AND 6) AS ratio
FROM rd r JOIN us u ON u.distinct_id::VARCHAR = r.uid
GROUP BY 1`,
				},
				select: {
					mid: { where: { tier: "mid_market" } },
					smb: { where: { tier: "small_business" } },
				},
				expect: { metric: "mid.ratio / smb.ratio", op: "between", target: [0.92, 1.15] },
				minCohort: 2500,
			},
		],
	},
	{
		id: "H7-enterprise-profiles",
		hook: "H7",
		archetype: "cohort-prop-scale",
		narrative:
			"The user hook overwrites warehouse_count and employee_count per tier with disjoint uniform " +
			"ranges: enterprise wh [5, 15] emp [200, 2000]; mid_market wh [2, 6] emp [20, 200]; " +
			"small_business wh [1, 3] emp [5, 80]; trial wh = 1 emp [1, 10]. Personas cover 100% of " +
			"users, so every profile is overwritten and the ranges are EXACT — min/max per tier must sit " +
			"inside the knob ranges with zero out-of-range profiles for NAILED.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT company_tier AS tier, count(*)::BIGINT AS user_count,
  avg((CASE company_tier
    WHEN 'enterprise' THEN (warehouse_count BETWEEN 5 AND 15 AND employee_count BETWEEN 200 AND 2000)
    WHEN 'mid_market' THEN (warehouse_count BETWEEN 2 AND 6 AND employee_count BETWEEN 20 AND 200)
    WHEN 'small_business' THEN (warehouse_count BETWEEN 1 AND 3 AND employee_count BETWEEN 5 AND 80)
    WHEN 'trial' THEN (warehouse_count = 1 AND employee_count BETWEEN 1 AND 10)
  END)::INT) AS in_range
FROM us GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "tier");
					const ent = by.enterprise, mid = by.mid_market, smb = by.small_business, tri = by.trial;
					if (!ent || !mid || !smb || !tri ||
						Number(ent.user_count) < 800 || Number(mid.user_count) < 2000 ||
						Number(smb.user_count) < 2000 || Number(tri.user_count) < 400) {
						return { verdict: "WEAK", detail: `cohort too small: ent=${ent?.user_count ?? 0} mid=${mid?.user_count ?? 0} smb=${smb?.user_count ?? 0} trial=${tri?.user_count ?? 0}` };
					}
					const shares = [ent, mid, smb, tri].map((c) => Number(c.in_range));
					const detail = `in-range shares ent=${shares[0].toFixed(4)} mid=${shares[1].toFixed(4)} smb=${shares[2].toFixed(4)} trial=${shares[3].toFixed(4)}`;
					if (shares.every((s) => s === 1)) return { verdict: "NAILED", detail };
					if (shares.every((s) => s >= 0.99)) return { verdict: "STRONG", detail };
					if (shares.every((s) => s >= 0.9)) return { verdict: "WEAK", detail };
					return { verdict: "NONE", detail };
				},
			},
		],
	},
	{
		id: "H8-smb-conversion-drop",
		hook: "H8",
		archetype: "funnel-conversion-by-segment",
		narrative:
			`small_business users lose ${SMB_ALERT_DROP_LIKELIHOOD}% of 'alert configured' events — the ` +
			"last step of Integration Setup. Read through the emulator's greedy in-window pairing " +
			"(step2->step3 conditional conversion). small_business ALSO carries an organic " +
			"conversionModifier gap vs mid_market on every funnel, so the treated ratio is " +
			"0.65 x organic [0.73, 0.85] x multi-candidate attenuation [1.0, 1.12] = [0.47, 0.62] " +
			"(measured 0.505 at iteration); band [0.44, 0.62]. The untreated Supplier Management funnel " +
			"pins the organic gap itself: [0.68, 0.90] (measured 0.73; Alert Response cross-check 0.85). " +
			"The two bands are disjoint — the gap between them IS the engineered effect.",
		assertions: [
			{
				breakdown: {
					type: "timeToConvert",
					steps: ["integration connected", "report generated", "alert configured"],
					breakdownByUserProperty: "company_tier",
					conversionWindowMs: 48 * 3600 * 1000,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "segment_value");
					const mid = by.mid_market, smb = by.small_business;
					const midAtt = Number(mid?.step_counts?.[1] ?? 0), smbAtt = Number(smb?.step_counts?.[1] ?? 0);
					if (midAtt < 1500 || smbAtt < 1500) {
						return { verdict: "WEAK", detail: `step-2 cohorts too small: mid=${midAtt} smb=${smbAtt}` };
					}
					const convM = Number(mid.step_counts[2]) / midAtt;
					const convS = Number(smb.step_counts[2]) / smbAtt;
					const ratio = convS / convM;
					const detail = `step2->3 conv smb=${convS.toFixed(4)} mid=${convM.toFixed(4)} ratio=${ratio.toFixed(3)} (attempts ${smbAtt}/${midAtt})`;
					if (ratio >= 0.44 && ratio <= 0.62) return { verdict: "NAILED", detail };
					if (ratio >= 0.38 && ratio <= 0.70) return { verdict: "STRONG", detail };
					if (ratio < 0.85) return { verdict: "WEAK", detail };
					return { verdict: ratio >= 1 ? "INVERSE" : "NONE", detail };
				},
			},
			{
				breakdown: {
					type: "timeToConvert",
					steps: ["supplier contacted", "purchase order created", "invoice processed"],
					breakdownByUserProperty: "company_tier",
					conversionWindowMs: 336 * 3600 * 1000,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "segment_value");
					const mid = by.mid_market, smb = by.small_business;
					const midAtt = Number(mid?.step_counts?.[1] ?? 0), smbAtt = Number(smb?.step_counts?.[1] ?? 0);
					if (midAtt < 2000 || smbAtt < 2000) {
						return { verdict: "WEAK", detail: `step-2 cohorts too small: mid=${midAtt} smb=${smbAtt}` };
					}
					const convM = Number(mid.step_counts[2]) / midAtt;
					const convS = Number(smb.step_counts[2]) / smbAtt;
					const ratio = convS / convM;
					const detail = `placebo (untreated funnel) step2->3 conv smb=${convS.toFixed(4)} mid=${convM.toFixed(4)} ratio=${ratio.toFixed(3)} (attempts ${smbAtt}/${midAtt})`;
					if (ratio >= 0.68 && ratio <= 0.90) return { verdict: "NAILED", detail };
					if (ratio >= 0.60 && ratio <= 0.98) return { verdict: "STRONG", detail };
					if (ratio >= 0.50) return { verdict: "WEAK", detail };
					return { verdict: "NONE", detail };
				},
			},
		],
	},
	{
		id: "H9-inventory-magic-number",
		hook: "H9",
		archetype: "frequency-sweet-spot",
		narrative:
			`Sweet spot ${INVENTORY_SWEET_MIN}-${INVENTORY_SWEET_MAX} inventory checks => PO quantity ` +
			`x${INVENTORY_PO_QUANTITY_BOOST}; ${INVENTORY_OVER_THRESHOLD}+ checks => ` +
			`${INVENTORY_OVER_PO_DROP_LIKELIHOOD}% of POs dropped. Output inventory-check counts equal ` +
			"hook-time counts (H9 reads them after H6, nothing later mutates them). Value read: " +
			"quantity is an iid pool draw, so sweet/low mean ratio reads the knob [1.30, 1.50]; " +
			"unit_cost placebo [0.94, 1.07]. Volume read: PO count is activity-coupled, so the read is " +
			"PO-per-inventory-check within small_business only, treated cliff bin 16-23 vs adjacent " +
			"untreated 12-15: keep_hat = 0.4 x organic gradient [0.83, 1.0] => band [0.31, 0.44] " +
			"(measured 0.372), guarded by pre-cliff flatness (8-11 vs 4-7 in [0.85, 1.10]).",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${PU_CTE}
SELECT CASE WHEN p.inv BETWEEN ${INVENTORY_SWEET_MIN} AND ${INVENTORY_SWEET_MAX} THEN 'sweet'
            WHEN p.inv <= ${INVENTORY_SWEET_MIN - 1} THEN 'low' END AS arm,
  count(DISTINCT p.uid)::BIGINT AS user_count, avg(e.quantity) AS qty
FROM pu p JOIN ev e ON e.uid = p.uid AND e.event = 'purchase order created'
WHERE p.inv <= ${INVENTORY_SWEET_MAX}
GROUP BY 1`,
				},
				select: {
					sweet: { where: { arm: "sweet" } },
					low: { where: { arm: "low" } },
				},
				expect: { metric: "sweet.qty / low.qty", op: "between", target: [1.30, 1.50] },
				minCohort: 400,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${PU_CTE}
SELECT CASE WHEN p.inv BETWEEN 4 AND 7 THEN 'b04'
            WHEN p.inv BETWEEN 8 AND 11 THEN 'b08'
            WHEN p.inv BETWEEN 12 AND ${INVENTORY_SWEET_MAX} THEN 'b12'
            WHEN p.inv BETWEEN ${INVENTORY_OVER_THRESHOLD} AND 23 THEN 'b16' END AS bin,
  count(*)::BIGINT AS user_count, sum(p.po)::DOUBLE / sum(p.inv) AS ppi
FROM pu p JOIN us u ON u.distinct_id::VARCHAR = p.uid
WHERE u.company_tier = 'small_business' AND p.inv BETWEEN 4 AND 23
GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "bin");
					const b04 = by.b04, b08 = by.b08, b12 = by.b12, b16 = by.b16;
					if (!b04 || !b08 || !b12 || !b16 ||
						Number(b04.user_count) < 250 || Number(b08.user_count) < 500 ||
						Number(b12.user_count) < 500 || Number(b16.user_count) < 800) {
						return { verdict: "WEAK", detail: `bins too small: ${[b04, b08, b12, b16].map((b) => b?.user_count ?? 0).join("/")}` };
					}
					const flat = Number(b08.ppi) / Number(b04.ppi);
					if (flat < 0.85 || flat > 1.10) {
						return { verdict: "NONE", detail: `pre-cliff gradient assumption broken: b08/b04=${flat.toFixed(3)} outside [0.85, 1.10]` };
					}
					const keep = Number(b16.ppi) / Number(b12.ppi);
					const detail = `keep_hat=${keep.toFixed(3)} (b16-23 ppi ${Number(b16.ppi).toFixed(3)} / b12-15 ppi ${Number(b12.ppi).toFixed(3)}; knob 0.4 x organic gradient [0.83, 1.0]; pre-cliff flat=${flat.toFixed(3)})`;
					if (keep >= 0.31 && keep <= 0.44) return { verdict: "NAILED", detail };
					if (keep >= 0.26 && keep <= 0.50) return { verdict: "STRONG", detail };
					if (keep < 0.70) return { verdict: "WEAK", detail };
					return { verdict: keep >= 1 ? "INVERSE" : "NONE", detail };
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${PU_CTE}
SELECT CASE WHEN p.inv BETWEEN ${INVENTORY_SWEET_MIN} AND ${INVENTORY_SWEET_MAX} THEN 'sweet'
            WHEN p.inv <= ${INVENTORY_SWEET_MIN - 1} THEN 'low' END AS arm,
  count(DISTINCT p.uid)::BIGINT AS user_count, avg(e.unit_cost) AS cost
FROM pu p JOIN ev e ON e.uid = p.uid AND e.event = 'purchase order created'
WHERE p.inv <= ${INVENTORY_SWEET_MAX}
GROUP BY 1`,
				},
				select: {
					sweet: { where: { arm: "sweet" } },
					low: { where: { arm: "low" } },
				},
				expect: { metric: "sweet.cost / low.cost", op: "between", target: [0.94, 1.07] },
				minCohort: 400,
			},
		],
	},
	{
		id: "H10-onboarding-ttc",
		hook: "H10",
		archetype: "funnel-ttc-by-segment",
		narrative:
			`funnel-post scales Onboarding inter-step gaps: enterprise x${TTC_ENTERPRISE_FACTOR}, ` +
			`small_business/trial x${TTC_SMB_FACTOR}, mid_market untouched (v1.6 scopes the hook to ` +
			"Onboarding only). Cross-event SQL cannot see this (greedy single-pass pairing — the " +
			"documented v1.5 limitation), so both reads use the emulator's timeToConvert at " +
			`72h x ${TTC_SMB_FACTOR} = 93.6h — the generative window times the max stretch, so ` +
			"slow-arm conversions are not right-censored into a fake speedup. Only born-in-dataset " +
			"users (~12%) have 'account created' in-window, so converter cohorts are ~1/8 scale: " +
			"minCohort 120. Window censoring and converter selection compress ratios toward 1 " +
			"(iteration: ent/mid 0.62, smb/mid 1.18): bands [0.50, 0.80] and [1.04, 1.40].",
		assertions: [
			{
				breakdown: {
					type: "timeToConvert",
					steps: ["account created", "inventory checked", "integration connected", "report generated"],
					breakdownByUserProperty: "company_tier",
					conversionWindowMs: Math.round(72 * TTC_SMB_FACTOR * 3600 * 1000),
				},
				select: {
					ent: { where: { segment_value: "enterprise" } },
					mid: { where: { segment_value: "mid_market" } },
				},
				expect: { metric: "ent.median_ttc_ms / mid.median_ttc_ms", op: "between", target: [0.50, 0.80] },
				minCohort: 120,
			},
			{
				breakdown: {
					type: "timeToConvert",
					steps: ["account created", "inventory checked", "integration connected", "report generated"],
					breakdownByUserProperty: "company_tier",
					conversionWindowMs: Math.round(72 * TTC_SMB_FACTOR * 3600 * 1000),
				},
				select: {
					smb: { where: { segment_value: "small_business" } },
					mid: { where: { segment_value: "mid_market" } },
				},
				expect: { metric: "smb.median_ttc_ms / mid.median_ttc_ms", op: "between", target: [1.04, 1.40] },
				minCohort: 120,
			},
		],
	},
];
