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
 * SCALE:      10,000 users, ~1.4M events, 121 days (2026-01-01 → 2026-05-01)
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
 * PATTERN: Users with <10 total events lose 50% of their events after
 * day 7 of the dataset. Simulates trial users who briefly explore then
 * abandon the platform.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Retention by Event Volume
 *   - Report type: Retention
 *   - Starting event: "account created"
 *   - Return event: Any event
 *   - Breakdown: user property "company_tier"
 *   - Expected: trial users show sharp drop after week 1 (~50% drop)
 *
 *   Report 2: Event Volume Distribution
 *   - Report type: Insights
 *   - Event: All events
 *   - Measure: Total per user
 *   - Breakdown: user property "company_tier"
 *   - Expected: trial users cluster at <5 events
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
 * event gets quantity boosted ~25%. Users with 16 or more inventory
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
 *   - Expected: cohort A ~ 1.25x higher quantity than B
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
 *   NOTE: This effect is visible ONLY in Mixpanel funnel median TTC.
 *   Cross-event MIN->MIN SQL queries on raw events do NOT show this
 *   because funnel-post mutates timestamps after event generation but
 *   before storage.
 *
 * REAL-WORLD ANALOGUE: Enterprise customers have dedicated IT teams
 * and onboarding specialists who move through setup, integration,
 * and first reporting much faster than small businesses configuring
 * the platform themselves.
 *
 * ===================================================================
 * EXPECTED METRICS SUMMARY
 * ===================================================================
 *
 * Hook                        | Metric              | Baseline | Effect  | Ratio
 * ----------------------------|---------------------|----------|---------|------
 * Month-End Reporting         | report_pages        | 20       | 40      | 2x
 * Rush Order Premium          | unit_cost           | $50      | $75     | 1.5x
 * Reorder Accuracy by Tier    | stockout alerts/user| 5        | 4.5     | 0.9x
 * Integration Retention       | reports/user        | 3        | 6       | 2x
 * Alert Fatigue               | response_time_hours | 4h       | 8-12h   | 2-3x
 * Trial Churn                 | events after wk 1   | 5        | 2.5     | 0.5x
 * Enterprise Profiles         | warehouse_count     | 3        | 10      | 3.3x
 * Small-Biz Conversion Drop   | funnel conversion   | 30%      | 20%     | 0.65x
 * Inventory-Check Magic Num   | sweet PO quantity   | 1x       | 1.25x   | 1.25x
 * Inventory-Check Magic Num   | over POs/user       | 1x       | 0.4x    | -60%
 * Onboarding TTC              | funnel median TTC   | 1x       | 0.71x   | 1.4x faster (enterprise)
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

const TRIAL_CHURN_EVENT_THRESHOLD = 10;
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

	// H6: TRIAL CHURN — users with <10 total events lose 50% after day 7.
	if (record.length < TRIAL_CHURN_EVENT_THRESHOLD) {
		const userFirstEvent = record[0];
		if (userFirstEvent) {
			const firstTime = dayjs(userFirstEvent.time);
			const cutoff = firstTime.add(TRIAL_CHURN_CUTOFF_DAYS, "days");
			for (let i = record.length - 1; i >= 0; i--) {
				if (dayjs(record[i].time).isAfter(cutoff) && chance.bool({ likelihood: TRIAL_CHURN_DROP_LIKELIHOOD })) {
					record.splice(i, 1);
				}
			}
		}
	}

	// H9: INVENTORY-CHECK MAGIC NUMBER (no flags) — sweet 5-15 inventory
	// checks → +25% PO quantity (1.4x to overcome dilution); over 16+ →
	// drop 60% of PO created events.
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
