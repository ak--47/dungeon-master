// ── TWEAK THESE ──
const SEED = "harness-sass";
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

/*
 * ═══════════════════════════════════════════════════════════════════════════════
 * DATASET OVERVIEW
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * CLOUDFORGE - B2B Cloud Infrastructure Monitoring & Deployment Platform
 *
 * CloudForge is a B2B SaaS platform that combines infrastructure monitoring (like Datadog)
 * with deployment automation (like Terraform). It serves engineering teams across companies
 * of all sizes - from startups deploying their first microservice to enterprises managing
 * thousands of services across multi-cloud environments.
 *
 * - 5,000 users over 100 days
 * - 600K events across 18 event types (+ 1 hook-created event type)
 * - 8 funnels (onboarding, monitoring, incident response, deployment, infra, team, docs, billing)
 * - Group analytics (companies)
 * - Desktop/browser only (B2B SaaS - no mobile devices)
 *
 * CORE PLATFORM:
 * Teams create workspaces, deploy services across AWS/GCP/Azure, and monitor everything
 * from a unified dashboard. The platform tracks uptime, latency, error rates, CPU/memory
 * usage, and costs. When things go wrong, CloudForge triggers alerts that route through
 * PagerDuty/Slack integrations, and on-call engineers acknowledge and resolve incidents
 * using automated runbooks.
 *
 * PRICING MODEL:
 * Four tiers: Free, Team, Business, Enterprise. Enterprise customers get dedicated
 * customer success managers and annual contracts. Pricing based on seat count and
 * resource usage.
 */

/*
 * ═══════════════════════════════════════════════════════════════════════════════
 * ANALYTICS HOOKS (10 hooks)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * 10 deliberately architected patterns hidden in the data. NOTE: All cohort
 * effects are HIDDEN — no flag stamping. Discoverable via behavioral cohorts
 * or raw-prop breakdowns (company_size, day, doc_section). Adds:
 *   9. INCIDENT RESPONSE TIME-TO-CONVERT (Enterprise 1.4x faster vs Startup)
 *   10. DOCS MAGIC NUMBER (sweet 4-7 docs → +40% deploys; over 8+ → drop 25%)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. END-OF-QUARTER SPIKE (event)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: Days 80-90 billing events shift event_type toward "plan_upgraded"
 * 40% of the time and team member invitations are duplicated 50% of the time.
 * No flag — discover via line chart by day.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Plan Upgrades Over Time
 *   - Report type: Insights
 *   - Event: "billing event"
 *   - Measure: Total
 *   - Filter: event_type = "plan_upgraded"
 *   - Line chart by day
 *   - Expected: ~4x normal upgrade volume during days 80-90
 *
 *   Report 2: Team Expansion Surge
 *   - Report type: Insights
 *   - Event: "team member invited"
 *   - Measure: Total
 *   - Line chart by day
 *   - Expected: clear volume spike in the final 10 days from duplicated invites
 *
 * REAL-WORLD ANALOGUE: B2B SaaS revenue clusters at quarter-close as sales
 * teams pull deals forward and customers expand seats to lock in pricing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 2. CHURNED ACCOUNT SILENCING (everything)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: ~10-20% of users (deterministic via distinct_id char hash) go
 * completely silent after day 30. All post-d30 events are removed via splice().
 * No flag — derive cohort via behavioral retention bucket (users with zero
 * activity past d30 vs the rest).
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Retention Cliff
 *   - Cohort A: users with at least 1 event AFTER day 30
 *   - Cohort B: users with events ONLY in days 1-30
 *   - Compare cohort sizes — B should be ~10-20% of total
 *
 *   Report 2: Activity Volume Pre/Post Day 30
 *   - Report type: Insights
 *   - Event: any event
 *   - Measure: Total per user
 *   - Line chart by day
 *   - Expected: a visible drop after d30 driven by the silent cohort
 *
 * REAL-WORLD ANALOGUE: Most SaaS churn happens silently — accounts simply
 * stop logging in long before the formal cancellation lands.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 3. ALERT ESCALATION REPLACEMENT (event)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: 30% of critical/emergency "alert triggered" events are REPLACED
 * with a hook-only "incident created" event (not in the events array). The
 * new event carries escalation_level (P1/P2), teams_paged, and incident_id.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Incident Created Discovery
 *   - Report type: Insights
 *   - Event: "incident created"
 *   - Measure: Total
 *   - Breakdown: "escalation_level"
 *   - Expected: P1 and P2 incidents, ~30% of critical/emergency alert volume
 *
 *   Report 2: Alert vs Incident Ratio
 *   - Report type: Insights
 *   - Events: "alert triggered" AND "incident created"
 *   - Measure: Total
 *   - Expected: incident count ~ 30% of critical+emergency alert count
 *
 * REAL-WORLD ANALOGUE: Severe alerts get auto-promoted into incident
 * tickets that page on-call engineers and trigger customer comms.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 4. INTEGRATION USERS SUCCEED (everything)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: Users with BOTH "slack" AND "pagerduty" "integration configured"
 * events resolve alerts faster: response_time_mins reduced 60%, resolution_time_mins
 * reduced 50%. No flag — derive cohort behaviorally.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Response Time by Integration Cohort
 *   - Cohort A: users who configured BOTH slack AND pagerduty integrations
 *   - Cohort B: rest
 *   - Event: "alert acknowledged"
 *   - Measure: Average of "response_time_mins"
 *   - Expected: A ~ 60% lower response time
 *
 *   Report 2: Resolution Time by Integration Cohort
 *   - Cohort A vs B (as above)
 *   - Event: "alert resolved"
 *   - Measure: Average of "resolution_time_mins"
 *   - Expected: A ~ 50% faster resolution
 *
 * REAL-WORLD ANALOGUE: Teams that wire alerting into their existing comms
 * stack respond minutes faster — the alert literally finds the human.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 5. DOCS READERS DEPLOY MORE (everything)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: Users with 3+ "documentation viewed" events where doc_section
 * (or equivalent prop) indicates best-practices reading get 2-3 extra
 * production deploys spliced in. No flag — derive cohort by counting
 * doc views per user.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Per-User Deploy Volume by Docs Cohort
 *   - Cohort A: users with >= 3 "documentation viewed" events
 *   - Cohort B: users with < 3
 *   - Event: "service deployed"
 *   - Measure: Total per user
 *   - Expected: A ~ 1.8x B
 *
 * REAL-WORLD ANALOGUE: Engineers who read the docs ship more confidently
 * and more often than those who guess at the platform.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 6. COST OVERRUN PATTERN (event — closure state)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: When cost_change_percent > 25 on a "cost report generated" event,
 * the user is stored in a module-level Map. Their next "infrastructure scaled"
 * event is forced to scale_direction = "down". No flag — discover by
 * sequencing cost-report → infrastructure-scaled per user.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Scale Direction Distribution
 *   - Report type: Insights
 *   - Event: "infrastructure scaled"
 *   - Measure: Total
 *   - Breakdown: "scale_direction"
 *   - Expected: "down" share is elevated above the configured baseline
 *
 *   Report 2: Sequencing Check
 *   - Inspect users with cost_change_percent > 25 on cost report;
 *     their next "infrastructure scaled" should be scale_direction="down"
 *   - Expected: ~100% match for the next-scale event after a cost spike
 *
 * REAL-WORLD ANALOGUE: A surprise cloud bill triggers an immediate
 * downscale; no engineer ignores a 25% month-over-month cost jump.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 7. FAILED DEPLOYMENT RECOVERY (event — closure state)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: After a failed pipeline run, the user's next successful deploy has
 * duration_sec * 1.5 (recovery deploys are slower). Uses a module-level Map
 * for cross-call state. No flag — discover by sequencing failed → next-success
 * pipeline events per user and comparing duration.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Pipeline Duration After Failure (sequencing query)
 *   - For each user, find runs where prior run was status="failed"
 *   - Compare avg duration_sec of those "next" runs vs all other successful runs
 *   - Expected: post-failure runs ~ 1.5x longer duration
 *
 * REAL-WORLD ANALOGUE: After a bad deploy, teams add manual gates and
 * extra verification steps that slow the very next release.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 8. ENTERPRISE VS STARTUP (user)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: Company size determines seat_count, annual_contract_value, and
 * customer_success_manager (enterprise only). All users get a
 * customer_health_score on the profile.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: ACV by Company Size
 *   - Report type: Insights
 *   - Event: any event
 *   - Measure: Unique users
 *   - Breakdown: "company_size" (user property)
 *   - Expected: startup ($0-3.6K), smb ($3.6K-12K), mid_market ($12K-50K),
 *     enterprise ($50K-500K)
 *
 *   Report 2: Seat Count by Company Size
 *   - Report type: Insights
 *   - Event: any event
 *   - Measure: Average of "seat_count" (user property)
 *   - Breakdown: "company_size"
 *   - Expected: monotonic ramp from startup to enterprise
 *
 * REAL-WORLD ANALOGUE: B2B SaaS pricing scales orders of magnitude across
 * customer segments — from a $99/mo startup to a $500K Fortune 500 contract.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EXPECTED METRICS SUMMARY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Hook                     | Metric                   | Baseline  | Hook Effect    | Ratio
 * -------------------------|--------------------------|-----------|----------------|------
 * End-of-Quarter Spike     | Plan upgrades/day        | ~2/day    | ~8/day         | 4x
 * Churned Accounts         | Users active month 2     | 100%      | 90%            | 0.9x
 * Alert Escalation         | Incidents from alerts    | 0%        | ~30% of crit   | new
 * Integration Users        | MTTR (minutes)           | ~300      | ~150           | 0.5x
 * Docs Readers             | Prod deploys/user        | ~3        | ~5-6           | 1.8x
 * Cost Overrun             | Scale-down after overrun | 50%       | 100%           | 2x
 * Failed Deploy Recovery   | Deploy duration (sec)    | ~500      | ~750           | 1.5x
 * Enterprise vs Startup    | ACV range                | $0-3.6K   | $50K-500K      | 100x+
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ADVANCED ANALYSIS IDEAS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * CROSS-HOOK PATTERNS:
 * - Churned + Enterprise: Do churned accounts skew toward startups or are
 *   enterprise accounts also silenced?
 * - Integration + Cost: Do teams with full integrations manage costs better?
 * - Docs + Deploys + Failures: Do docs readers have fewer failed deployments?
 * - Quarter Spike + Churn: Are quarter-end upgrades correlated with later churn?
 * - Enterprise Recovery: Do enterprise customers recover from failed deploys
 *   differently than startups?
 *
 * COHORT ANALYSIS:
 * - By company_size: Compare all metrics across startup/smb/mid_market/enterprise
 * - By plan_tier: Free vs. Team vs. Business vs. Enterprise engagement
 * - By cloud_provider: AWS vs. GCP vs. Azure deployment and alert patterns
 * - By primary_role: Engineer vs. SRE vs. DevOps vs. Manager behaviors
 *
 * KEY METRICS:
 * - MTTR: alert triggered → alert resolved duration
 * - Deployment Frequency: service deployed per user per week
 * - Deployment Success Rate: pipeline success vs. failure ratio
 * - Cost Efficiency: total_cost trend over time per company
 * - Feature Adoption: integration configured events by type
 * - Documentation Engagement: documentation viewed by section
 */

// Generate consistent IDs for lookup tables and event properties
const serviceIds = v.range(1, 201).map(() => `svc_${v.uid(8)}`);
const alertIds = v.range(1, 501).map(() => `alert_${v.uid(6)}`);
const pipelineIds = v.range(1, 101).map(() => `pipe_${v.uid(6)}`);
const runbookIds = v.range(1, 51).map(() => `rb_${v.uid(6)}`);
const companyIds = v.range(1, 301).map(() => `comp_${v.uid(8)}`);

// Module-level Maps for closure-based state tracking across hook calls
const costOverrunUsers = new Map();
const failedDeployUsers = new Map();

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
		primary_role: {
			values: ["viewer", "editor", "admin", "owner"],
			frequency: "month",
			timing: "fuzzy",
			max: 6
		},
		plan_tier: {
			values: ["starter", "growth", "enterprise", "scale"],
			frequency: "month",
			timing: "fixed",
			max: 6,
			type: "company_id"
		}
	},

	funnels: [
		{
			sequence: ["workspace created", "service deployed", "dashboard viewed"],
			isFirstFunnel: true,
			conversionRate: 70,
			timeToConvert: 2,
		},
		{
			// Daily monitoring: dashboards, queries, API calls (most common)
			sequence: ["dashboard viewed", "query executed", "api call"],
			conversionRate: 80,
			timeToConvert: 0.5,
			weight: 5,
		},
		{
			// Incident response pipeline
			sequence: ["alert triggered", "alert acknowledged", "alert resolved"],
			conversionRate: 55,
			timeToConvert: 6,
			weight: 4,
		},
		{
			// Deployment cycle
			sequence: ["deployment pipeline run", "service deployed", "dashboard viewed"],
			conversionRate: 65,
			timeToConvert: 1,
			weight: 3,
		},
		{
			// Infrastructure management
			sequence: ["cost report generated", "infrastructure scaled", "security scan"],
			conversionRate: 50,
			timeToConvert: 4,
			weight: 2,
		},
		{
			// Team and config management
			sequence: ["team member invited", "integration configured", "feature flag toggled"],
			conversionRate: 40,
			timeToConvert: 8,
			weight: 2,
		},
		{
			// Documentation and runbook usage
			sequence: ["documentation viewed", "runbook executed", "service deployed"],
			conversionRate: 45,
			timeToConvert: 2,
			weight: 2,
		},
		{
			// Billing and account management
			sequence: ["billing event", "dashboard viewed"],
			conversionRate: 60,
			timeToConvert: 1,
			weight: 1,
		},
	],

	events: [
		{
			event: "workspace created",
			weight: 1,
			isFirstEvent: true,
			properties: {
				company_size: ["startup", "smb", "mid_market", "enterprise"],
				industry: ["tech", "finance", "healthcare", "retail", "media"],
			}
		},
		{
			event: "service deployed",
			weight: 10,
			properties: {
				service_id: serviceIds,
				service_type: ["web_app", "api", "database", "cache", "queue", "ml_model"],
				environment: ["production", "staging", "dev"],
				cloud_provider: ["aws", "gcp", "azure"],
			}
		},
		{
			event: "dashboard viewed",
			weight: 20,
			properties: {
				dashboard_type: ["overview", "cost", "performance", "security", "custom"],
				time_range: ["1h", "6h", "24h", "7d", "30d"],
			}
		},
		{
			event: "alert triggered",
			weight: 12,
			properties: {
				alert_id: alertIds,
				severity: ["info", "warning", "critical", "emergency"],
				alert_type: ["cpu", "memory", "latency", "error_rate", "disk", "network"],
				service_id: serviceIds,
			}
		},
		{
			event: "incident created",
			weight: 1,
			properties: {
				escalation_level: ["P1", "P2"],
				teams_paged: u.weighNumRange(1, 5),
				incident_id: () => `inc_${v.uid(8)}`,
				original_severity: ["critical", "emergency"],
				original_alert_type: ["cpu", "memory", "latency", "error_rate", "disk", "network"],
				service_id: serviceIds,
				auto_escalated: [true],
			}
		},
		{
			event: "alert acknowledged",
			weight: 8,
			properties: {
				alert_id: alertIds,
				response_time_mins: u.weighNumRange(1, 120),
				acknowledged_by_role: ["engineer", "sre", "manager", "oncall"],
			}
		},
		{
			event: "alert resolved",
			weight: 7,
			properties: {
				alert_id: alertIds,
				resolution_time_mins: u.weighNumRange(5, 1440),
				root_cause: ["config_change", "capacity", "bug", "dependency", "network"],
			}
		},
		{
			event: "deployment pipeline run",
			weight: 9,
			properties: {
				pipeline_id: pipelineIds,
				status: ["success", "failed", "cancelled"],
				duration_sec: u.weighNumRange(30, 1800),
				commit_count: u.weighNumRange(1, 20),
			}
		},
		{
			event: "infrastructure scaled",
			weight: 5,
			properties: {
				service_id: serviceIds,
				scale_direction: ["down", "down", "down", "down", "down", "down", "up"],
				previous_capacity: u.weighNumRange(1, 100),
				new_capacity: u.weighNumRange(1, 100),
				auto_scaled: [false, false, false, false, false, false, true],
			}
		},
		{
			event: "cost report generated",
			weight: 4,
			properties: {
				report_period: ["daily", "weekly", "monthly"],
				total_cost: u.weighNumRange(100, 50000),
				cost_change_percent: u.weighNumRange(-30, 50),
			}
		},
		{
			event: "team member invited",
			weight: 3,
			properties: {
				role: ["admin", "editor", "viewer", "billing"],
				invitation_method: ["email", "sso", "slack"],
			}
		},
		{
			event: "integration configured",
			weight: 4,
			properties: {
				integration_type: ["slack", "pagerduty", "jira", "github", "datadog", "terraform"],
				status: ["active", "paused", "error"],
			}
		},
		{
			event: "query executed",
			weight: 15,
			properties: {
				query_type: ["metrics", "logs", "traces"],
				time_range_hours: u.weighNumRange(1, 720),
				result_count: u.weighNumRange(0, 10000),
			}
		},
		{
			event: "runbook executed",
			weight: 3,
			properties: {
				runbook_id: runbookIds,
				trigger: ["manual", "automated", "alert_triggered"],
				success: [false, false, false, false, false, false, true],
			}
		},
		{
			event: "billing event",
			weight: 3,
			properties: {
				event_type: ["invoice_generated", "payment_received", "payment_failed", "plan_upgraded", "plan_downgraded"],
				amount: u.weighNumRange(99, 25000),
			}
		},
		{
			event: "security scan",
			weight: 6,
			properties: {
				scan_type: ["vulnerability", "compliance", "access_audit"],
				findings_count: u.weighNumRange(0, 50),
				critical_findings: u.weighNumRange(0, 10),
			}
		},
		{
			event: "api call",
			weight: 16,
			properties: {
				endpoint: ["/deploy", "/status", "/metrics", "/alerts", "/config", "/billing"],
				method: ["GET", "POST", "PUT", "DELETE"],
				response_time_ms: u.weighNumRange(10, 5000),
				status_code: [200, 201, 400, 401, 403, 500, 503],
			}
		},
		{
			event: "documentation viewed",
			weight: 7,
			properties: {
				doc_section: ["getting_started", "api_reference", "best_practices", "troubleshooting", "changelog"],
				time_on_page_sec: u.weighNumRange(5, 600),
			}
		},
		{
			event: "feature flag toggled",
			weight: 4,
			properties: {
				flag_name: () => `flag_${chance.word()}`,
				new_state: ["disabled", "disabled", "disabled", "disabled", "disabled", "disabled", "enabled"],
				environment: ["production", "staging", "dev"],
			}
		},
	],

	superProps: {
		plan_tier: ["free", "free", "team", "team", "business", "enterprise"],
		cloud_provider: ["aws", "gcp", "azure", "multi_cloud"],
	},

	userProps: {
		company_size: ["startup", "startup", "smb", "mid_market", "enterprise"],
		primary_role: ["engineer", "sre", "devops", "manager", "executive"],
		team_name: ["Platform", "Backend", "Frontend", "Data", "Security", "Infrastructure"],
		seat_count: [1],
		annual_contract_value: [0],
		customer_success_manager: [false],
		customer_health_score: u.weighNumRange(1, 100),
		plan_tier: ["free", "free", "team", "team", "business", "enterprise"],
		cloud_provider: ["aws", "gcp", "azure", "multi_cloud"],
	},

	groupKeys: [
		["company_id", 300, ["workspace created", "service deployed", "billing event", "team member invited"]],
	],

	groupProps: {
		company_id: {
			name: () => `${chance.word({ capitalize: true })} ${chance.pickone(["Systems", "Technologies", "Labs", "Cloud", "Digital", "Networks", "Solutions"])}`,
			industry: ["tech", "finance", "healthcare", "retail", "media", "manufacturing", "logistics"],
			employee_count: ["1-10", "11-50", "51-200", "201-1000", "1001-5000", "5000+"],
			arr_bucket: ["<10k", "10k-50k", "50k-200k", "200k-1M", "1M+"],
		}
	},

	lookupTables: [],

	/**
	 * ARCHITECTED ANALYTICS HOOKS
	 *
	 * This hook function creates 8 deliberate patterns in the data:
	 *
	 * 1. END-OF-QUARTER SPIKE: Days 80-90 drive plan upgrades and team expansion
	 * 2. CHURNED ACCOUNT SILENCING: ~10% of users go completely silent after month 1
	 * 3. ALERT ESCALATION REPLACEMENT: Critical alerts become "incident created" events
	 * 4. INTEGRATION USERS SUCCEED: Slack+PagerDuty users resolve incidents 50-60% faster
	 * 5. DOCS READERS DEPLOY MORE: Best practices readers get extra production deploys
	 * 6. COST OVERRUN PATTERN: Budget-exceeded users react by scaling down infrastructure
	 * 7. FAILED DEPLOYMENT RECOVERY: Recovery deploys take 1.5x longer, tracked across calls
	 * 8. ENTERPRISE VS STARTUP: Company size determines seat count, ACV, and health score
	 */
	hook: function (record, type, meta) {
		// HOOK 1: END-OF-QUARTER SPIKE — days 80-90, 40% of billing events
		// flip event_type to plan_upgraded; team-member-invited events get
		// 50% chance of duplicate clone with unique time. No flag.
		if (type === "event") {
			const datasetStart = dayjs.unix(meta.datasetStart);
			const EVENT_TIME = dayjs(record.time);
			const dayInDataset = EVENT_TIME.diff(datasetStart, "days", true);

			if (record.event === "billing event") {
				if (dayInDataset >= 80 && dayInDataset <= 90 && chance.bool({ likelihood: 40 })) {
					record.event_type = "plan_upgraded";
				}
			}

			if (record.event === "team member invited" && dayInDataset >= 80 && dayInDataset <= 90 && chance.bool({ likelihood: 50 })) {
				return {
					...record,
					time: EVENT_TIME.add(chance.integer({ min: 1, max: 60 }), "minutes").toISOString(),
					role: chance.pickone(["editor", "viewer"]),
					invitation_method: chance.pickone(["email", "sso", "slack"]),
				};
			}
		}

		// HOOK 3: ALERT ESCALATION REPLACEMENT (event) — critical/emergency
		// alerts sometimes become incident-created events. Real product flow.
		if (type === "event") {
			if (record.event === "alert triggered") {
				const severity = record.severity;
				if ((severity === "critical" || severity === "emergency") && chance.bool({ likelihood: 30 })) {
					return {
						...record,
						event: "incident created",
						escalation_level: chance.pickone(["P1", "P2"]),
						teams_paged: chance.integer({ min: 1, max: 5 }),
						incident_id: `inc_${v.uid(8)}`,
						original_severity: severity,
						original_alert_type: record.alert_type,
						auto_escalated: true,
					};
				}
			}
		}

		// HOOK 6: COST OVERRUN PATTERN (event) — cost reports with cost_change
		// > 25% record user, then next infrastructure-scaled event from that
		// user gets scale_direction = "down". No flag.
		if (type === "event") {
			if (record.event === "cost report generated" && record.cost_change_percent > 25) {
				costOverrunUsers.set(record.user_id, true);
			}
			if (record.event === "infrastructure scaled" && costOverrunUsers.has(record.user_id)) {
				record.scale_direction = "down";
				costOverrunUsers.delete(record.user_id);
			}
		}

		// HOOK 7: FAILED DEPLOYMENT RECOVERY (event) — failed deploy records
		// user, then next successful deploy gets duration_sec * 1.5. No flag.
		if (type === "event") {
			if (record.event === "deployment pipeline run") {
				if (record.status === "failed") {
					failedDeployUsers.set(record.user_id, true);
				} else if (record.status === "success" && failedDeployUsers.has(record.user_id)) {
					record.duration_sec = Math.floor((record.duration_sec || 300) * 1.5);
					failedDeployUsers.delete(record.user_id);
				}
			}
		}

		// HOOK 9 (T2C): INCIDENT RESPONSE TIME-TO-CONVERT (funnel-post)
		// Enterprise tier completes Incident Response funnel 1.4x faster
		// (factor 0.71); Startup 1.25x slower (factor 1.25).
		if (type === "funnel-post") {
			const segment = meta?.profile?.company_size;
			if (Array.isArray(record) && record.length > 1) {
				const factor = (
					segment === "enterprise" ? 0.71 :
					segment === "startup" ? 1.25 :
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

		if (type === "everything") {
			const datasetStart = dayjs.unix(meta.datasetStart);
			const userEvents = record;
			const profile = meta.profile;

			userEvents.forEach(e => {
				e.plan_tier = profile.plan_tier;
				e.cloud_provider = profile.cloud_provider;
			});

			// HOOK 2: CHURNED ACCOUNT SILENCING — ~20% of users (hash %5)
			// have post-day-30 events removed. No flag.
			if (userEvents && userEvents.length > 0) {
				const firstEvent = userEvents[0];
				const idHash = String(firstEvent.user_id || firstEvent.device_id).split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
				if ((idHash % 5) === 0) {
					for (let i = userEvents.length - 1; i >= 0; i--) {
						const dayInDataset = dayjs(userEvents[i].time).diff(datasetStart, "days", true);
						if (dayInDataset > 30) {
							userEvents.splice(i, 1);
						}
					}
				}
			}

			// HOOK 4: INTEGRATION USERS SUCCEED — Slack+PagerDuty users get
			// alert response_time_mins 0.4x and resolution_time_mins 0.5x.
			// Mutates raw props. No flag.
			let hasSlack = false;
			let hasPagerduty = false;
			userEvents.forEach((event) => {
				if (event.event === "integration configured") {
					if (event.integration_type === "slack") hasSlack = true;
					if (event.integration_type === "pagerduty") hasPagerduty = true;
				}
			});
			if (hasSlack && hasPagerduty) {
				userEvents.forEach((event) => {
					if (event.event === "alert acknowledged" && event.response_time_mins) {
						event.response_time_mins = Math.floor(event.response_time_mins * 0.4);
					}
					if (event.event === "alert resolved" && event.resolution_time_mins) {
						event.resolution_time_mins = Math.floor(event.resolution_time_mins * 0.5);
					}
				});
			}

			// HOOK 5 + HOOK 10: DOCS MAGIC NUMBER (in-funnel, no flags)
			// Sweet 4-7 documentation-viewed events → +40% extra cloned
			// service-deployed events. Over 8+ → drop 25% of service-deployed
			// events (over-reading; no shipping). No flag.
			const docsCount = userEvents.filter(e => e.event === "documentation viewed").length;
			const deployTemplate = userEvents.find(e => e.event === "service deployed");
			if (docsCount >= 4 && docsCount <= 7 && deployTemplate) {
				const lastEvent = userEvents[userEvents.length - 1];
				const extraDeploys = chance.integer({ min: 2, max: 3 });
				for (let i = 0; i < extraDeploys; i++) {
					userEvents.push({
						...deployTemplate,
						time: dayjs(lastEvent.time).add(chance.integer({ min: 1, max: 48 }), "hours").toISOString(),
						user_id: lastEvent.user_id,
						service_id: chance.pickone(serviceIds),
						service_type: chance.pickone(["web_app", "api", "database", "cache", "queue", "ml_model"]),
						environment: "production",
						cloud_provider: profile.cloud_provider,
					});
				}
			} else if (docsCount >= 8) {
				for (let i = userEvents.length - 1; i >= 0; i--) {
					if (userEvents[i].event === "service deployed" && chance.bool({ likelihood: 25 })) {
						userEvents.splice(i, 1);
					}
				}
			}
		}

		// HOOK 8: ENTERPRISE VS STARTUP (user) — company size determines
		// seat count, ACV, and CSM. Real profile attrs.
		if (type === "user") {
			const companySize = record.company_size;
			if (companySize === "enterprise") {
				record.seat_count = chance.integer({ min: 50, max: 500 });
				record.annual_contract_value = chance.integer({ min: 50000, max: 500000 });
				record.customer_success_manager = true;
			} else if (companySize === "mid_market") {
				record.seat_count = chance.integer({ min: 10, max: 50 });
				record.annual_contract_value = chance.integer({ min: 12000, max: 50000 });
				record.customer_success_manager = false;
			} else if (companySize === "smb") {
				record.seat_count = chance.integer({ min: 3, max: 10 });
				record.annual_contract_value = chance.integer({ min: 3600, max: 12000 });
				record.customer_success_manager = false;
			} else if (companySize === "startup") {
				record.seat_count = chance.integer({ min: 1, max: 5 });
				record.annual_contract_value = chance.integer({ min: 0, max: 3600 });
				record.customer_success_manager = false;
			}
			record.customer_health_score = chance.integer({ min: 1, max: 100 });
		}

		return record;
	}
};

export default config;
