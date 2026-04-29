// ── TWEAK THESE ──
const SEED = "dm4-logistics";
const num_days = 100;
const num_users = 5_000;
const avg_events_per_user_per_day = 1.2;
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

// Generate consistent warehouse/supplier IDs at module level
const warehouseIds = v.range(1, 80).map(() => `WH_${v.uid(6)}`);
const supplierIds = v.range(1, 150).map(() => `SUP_${v.uid(6)}`);

/**
 * ===================================================================
 * DATASET OVERVIEW
 * ===================================================================
 *
 * SupplyStack -- a B2B warehouse/inventory management SaaS for
 * businesses to track stock levels, purchase orders, suppliers,
 * shipments, and quality inspections across multiple warehouses.
 *
 * - 5,000 users over 100 days, ~600K events
 * - Multi-tier system: enterprise (15%), mid-market (35%), small business (40%), trial (10%)
 * - Core loop: sign up -> check inventory -> create PO -> receive order -> track shipment
 * - Revenue: free_trial / starter ($49) / professional ($199) / enterprise ($599)
 *
 * Advanced Features:
 * - Personas: 4 archetypes (enterprise_ops, mid_market, small_business, trial_explorer)
 * - World Events: supply_chain_disruption (day 35), holiday_surge (day 70)
 * - Subscription: 4-tier revenue lifecycle with 30-day trial
 * - Geo: US/EU/APAC with currency and regional properties
 * - Features: predictive_reorder (day 40) and supplier_portal (day 65)
 * - Anomalies: extreme stockout spikes, coordinated holiday prep burst
 *
 * Key entities:
 * - warehouse_id: specific warehouse location
 * - supplier_id: vendor supplying goods
 * - sku_category: product category being managed
 * - priority: urgency level for orders and alerts
 */

/**
 * ===================================================================
 * ANALYTICS HOOKS (10 hooks)
 *
 * Adds 10. ONBOARDING TIME-TO-CONVERT: enterprise 0.71x faster, small_business
 * 1.3x slower (funnel-post). Discover via Onboarding funnel median TTC by company_tier.
 * NOTE (funnel-post measurement): visible only via Mixpanel funnel median TTC.
 * Cross-event MIN→MIN SQL queries on raw events do NOT show this.
 * ===================================================================
 *
 * -------------------------------------------------------------------
 * 1. MONTH-END REPORTING SURGE (event hook)
 * -------------------------------------------------------------------
 *
 * PATTERN: Reports generated on calendar days 28-31 have 2x the
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
 * checks are over-engaged (paralysis); ~30% of their "purchase order
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
 *   - Expected: cohort C has ~ 30% fewer POs per user
 *
 * REAL-WORLD ANALOGUE: A focused operations team that monitors
 * stock just enough places larger, more confident orders; an
 * obsessive checker is paralysed and orders less.
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
 * Inventory-Check Magic Num   | over POs/user       | 1x       | 0.7x    | -30%
 */

/** @type {Config} */
const config = {
	token,
	seed: SEED,
	datasetStart: "2026-01-01T00:00:00Z",
	datasetEnd: "2026-04-28T23:59:59Z",
	// numDays: num_days,
	avgEventsPerUserPerDay: avg_events_per_user_per_day,
	numUsers: num_users,
	hasAnonIds: false,
	hasSessionIds: true,
	format: "json",
	gzip: true,
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
			properties: {
				referral_source: ["organic", "partner_referral", "google_search", "trade_show", "linkedin"],
			},
		},
		{
			event: "inventory checked",
			weight: 8,
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
			properties: {
				integration_type: ["erp", "accounting", "shipping", "ecommerce", "crm", "bi_tool"],
				integration_name: ["SAP", "QuickBooks", "ShipStation", "Shopify", "Salesforce", "NetSuite", "Xero"],
				setup_time_minutes: u.weighNumRange(5, 120, 0.4, 30),
			},
		},
		{
			event: "report generated",
			weight: 4,
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

	// -- Hook Function ------------------------------------------------
	hook: function (record, type, meta) {
		// HOOK 10 (T2C): ONBOARDING TIME-TO-CONVERT (funnel-post)
		// Enterprise tier completes Onboarding funnel 1.4x faster (factor 0.71);
		// small_business 1.3x slower (factor 1.3).
		if (type === "funnel-post") {
			const segment = meta?.profile?.company_tier;
			if (Array.isArray(record) && record.length > 1) {
				const factor = (
					segment === "enterprise" ? 0.71 :
					segment === "small_business" || segment === "trial" ? 1.3 :
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

		// -- HOOK 7: ENTERPRISE PROFILES (user) -----------------------
		// Enterprise ops get large warehouse_count and employee_count.
		if (type === "user") {
			if (record.company_tier === "enterprise") {
				record.warehouse_count = chance.integer({ min: 5, max: 15 });
				record.employee_count = chance.integer({ min: 200, max: 2000 });
			} else if (record.company_tier === "mid_market") {
				record.warehouse_count = chance.integer({ min: 2, max: 6 });
				record.employee_count = chance.integer({ min: 20, max: 200 });
			} else if (record.company_tier === "trial") {
				record.warehouse_count = 1;
				record.employee_count = chance.integer({ min: 1, max: 10 });
			}
		}

		// -- HOOK 8: ENTERPRISE INTEGRATION FUNNEL LIFT (funnel-pre) --
		// (conversionRate boost removed — filtering applied in everything hook instead)
		if (type === "funnel-pre") {
			// no-op: conversion differentiation handled via event filtering below
		}

		// -- HOOK 1: MONTH-END REPORTING SURGE ------------------------
		// Moved to everything hook (after sessionization) so day-of-month
		// tags match final timestamps. See everything hook below.

		// -- HOOK 2: RUSH ORDER PREMIUM (event) -------------------
		// Urgent purchase orders get 1.5x unit_cost.
		if (type === "event") {
			if (record.event === "purchase order created" && record.priority === "urgent") {
				record.unit_cost = Math.floor((record.unit_cost || 50) * 1.5);
			}
		}

		// -- EVERYTHING HOOKS -----------------------------------------
		if (type === "everything") {
			if (!record.length) return record;
			const profile = meta.profile;

			// -- SUPER-PROP STAMPING ----------------------------------
			// Stamp superProps from profile so they are consistent per-user.
			if (profile) {
				const plat = profile.Platform;
				const plan = profile.subscription_plan;
				record.forEach(e => {
					if (plat) e.Platform = plat;
					if (plan) e.subscription_plan = plan;
				});
			}

			// -- HOOK 1: MONTH-END REPORTING SURGE --------------------
			// Reports on days 28-31 get 2x report_pages.
			// Runs after sessionization so day-of-month matches final timestamps.
			for (const e of record) {
				if (e.event === 'report generated') {
					const dayOfMonth = new Date(e.time).getUTCDate();
					if (dayOfMonth >= 28) {
						e.report_pages = Math.floor((e.report_pages || 20) * 2);
					}
				}
			}

			// -- HOOK 8: SMALL-BUSINESS CONVERSION DROP ---------------
			// Small-business users lose ~35% of "alert configured" events
			// (last step of Integration Setup funnel), simulating lower
			// conversion for smaller teams without dedicated IT resources.
			if (profile && profile.company_tier === "small_business") {
				record = record.filter(e => {
					if (e.event === "alert configured" && chance.bool({ likelihood: 35 })) {
						return false;
					}
					return true;
				});
			}

			// -- HOOK 3: REORDER ACCURACY BY TIER ---------------------
			// Enterprise users get 10% of stockout alerts removed.
			if (profile && profile.company_tier === "enterprise") {
				for (let i = record.length - 1; i >= 0; i--) {
					if (record[i].event === "stockout alert" && chance.bool({ likelihood: 10 })) {
						record.splice(i, 1);
					}
				}
			}

			// -- HOOK 4: INTEGRATION COMPLETION DRIVES RETENTION ------
			// Users with 3+ integration events get cloned report events.
			const integrationCount = record.filter(e => e.event === "integration connected").length;
			if (integrationCount >= 3) {
				const templateReport = record.find(e => e.event === "report generated");
				if (templateReport) {
					const integrationEvents = record.filter(e => e.event === "integration connected");
					integrationEvents.forEach(ie => {
						if (chance.bool({ likelihood: 65 })) {
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

			// -- HOOK 5: ALERT FATIGUE --------------------------------
			// Users with >30 stockout alerts get increasing response times.
			const alertEvents = record.filter(e => e.event === "stockout alert");
			if (alertEvents.length > 30) {
				alertEvents.forEach((alert, idx) => {
					if (idx >= 20) {
						const fatigueMultiplier = 1.5 + ((idx - 20) / alertEvents.length) * 1.5;
						alert.response_time_hours = Math.floor((alert.response_time_hours || 4) * fatigueMultiplier);
					}
				});
			}

			// -- HOOK 6: TRIAL CHURN ----------------------------------
			// Users with <10 events lose 50% after day 7.
			if (record.length < 10) {
				const userFirstEvent = record[0];
				if (userFirstEvent) {
					const firstTime = dayjs(userFirstEvent.time);
					const cutoff = firstTime.add(7, "days");
					for (let i = record.length - 1; i >= 0; i--) {
						if (dayjs(record[i].time).isAfter(cutoff) && chance.bool({ likelihood: 50 })) {
							record.splice(i, 1);
						}
					}
				}
			}

			// -- HOOK 9: INVENTORY-CHECK MAGIC NUMBER (no flags) ------
			// Sweet 5-15 inventory checks → +25% PO quantity.
			// Over 16+ → drop 30% of PO created events.
			const invCheckCount = record.filter(e => e.event === 'inventory checked').length;
			if (invCheckCount >= 5 && invCheckCount <= 15) {
				record.forEach(e => {
					if (e.event === 'purchase order created' && typeof e.quantity === 'number') {
						e.quantity = Math.round(e.quantity * 1.25);
					}
				});
			} else if (invCheckCount >= 16) {
				for (let i = record.length - 1; i >= 0; i--) {
					if (record[i].event === 'purchase order created' && chance.bool({ likelihood: 30 })) {
						record.splice(i, 1);
					}
				}
			}

			return record;
		}

		return record;
	},
};

export default config;
