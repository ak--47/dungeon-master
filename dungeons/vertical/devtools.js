// ── TWEAK THESE ──
const SEED = "dm4-devtools";
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
const NOW = dayjs();
const DATASET_START = NOW.subtract(num_days, "days");

/** @typedef  {import("../../types").Dungeon} Config */

// Generate consistent pipeline/repo IDs at module level
const pipelineIds = v.range(1, 80).map(() => `PIPE_${v.uid(6)}`);
const repoIds = v.range(1, 150).map(() => `REPO_${v.uid(6)}`);

/**
 * ===============================================================
 * DATASET OVERVIEW
 * ===============================================================
 *
 * CodeForge -- a developer platform for builds, deploys, monitoring,
 * code review, and team collaboration. Think GitHub + Vercel + PagerDuty
 * in a unified CI/CD experience.
 *
 * - 5,000 users over 100 days, ~600K events
 * - Multi-role system: platform engineers (15%), full-stack devs (35%),
 *   junior devs (30%), devops leads (10%), open source users (10%)
 * - Core loop: connect repo -> configure pipeline -> build -> deploy -> monitor
 * - Revenue: free / team ($25, 14-day trial) / business ($75) / enterprise ($200)
 *
 * Advanced Features:
 * - Personas: 5 archetypes with distinct activity, conversion, and churn profiles
 * - World Events: major outage (day 42), conference launch (day 60)
 * - Data Quality: late arrivals, duplicates, bot pollution
 * - Subscription: 4-tier revenue lifecycle with trial conversion
 * - Geo: US/EU/India/rest with timezone-aware activity
 * - Features: copilot_integration (day 30), deployment_preview (day 50)
 * - Anomalies: extreme build durations, alert burst during outage
 *
 * Key entities:
 * - pipeline_id: CI/CD pipeline for a repo
 * - repo_id: source code repository
 * - build_status / deploy_status: success/failed/cancelled
 * - ai_assist: manual vs copilot (driven by Feature rollout)
 */

/**
 * ===============================================================
 * ANALYTICS HOOKS (8 hooks)
 * ===============================================================
 *
 * ---------------------------------------------------------------
 * 1. BUILD FAILURE CASCADE (event hook)
 * ---------------------------------------------------------------
 *
 * PATTERN: Builds with status "failed" get 2x build_duration_sec.
 * Failed builds take longer because the full test suite runs before
 * failing, and retries compound the duration.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Build Duration by Status
 *   - Report type: Insights
 *   - Event: "build completed"
 *   - Measure: Average of "build_duration_sec"
 *   - Breakdown: "build_status"
 *   - Expected: failed ~2x longer than success
 *     (failed ~ 480s, success ~ 240s)
 *
 * REAL-WORLD ANALOGUE: Failed CI builds run full test suites,
 * timeout waiting for flaky tests, and trigger retry cascades
 * that inflate overall build times.
 *
 * ---------------------------------------------------------------
 * 2. NIGHT DEPLOY RISK (event hook)
 * ---------------------------------------------------------------
 *
 * PATTERN: Deployments between 10PM-6AM get status forced to
 * "failed" 40% of the time. Night deploys are risky because
 * fewer engineers are online to catch issues.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Deploy Failure Rate by Hour
 *   - Report type: Insights
 *   - Event: "deployment completed"
 *   - Measure: Total
 *   - Filter: deploy_status = "failed"
 *   - Breakdown: "is_night_deploy"
 *   - Expected: is_night_deploy=true shows ~40% failure vs ~15% baseline
 *
 *   Report 2: Night Deploy Volume
 *   - Report type: Insights
 *   - Event: "deployment completed"
 *   - Measure: Total
 *   - Breakdown: "is_night_deploy"
 *   - Expected: ~15-20% of deploys happen at night
 *
 * REAL-WORLD ANALOGUE: Night and weekend deploys have higher
 * failure rates due to skeleton crews and delayed incident response.
 *
 * ---------------------------------------------------------------
 * 3. COPILOT ADOPTION -> PR VELOCITY (everything hook)
 * ---------------------------------------------------------------
 *
 * PATTERN: Users with ai_assist="copilot" on any PR event get
 * 1.5x more pull_request_created events cloned into their stream.
 * AI-assisted developers ship more PRs.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: PR Volume by AI Assist Mode
 *   - Report type: Insights
 *   - Event: "pull request created"
 *   - Measure: Total per user (average)
 *   - Breakdown: "ai_assist"
 *   - Expected: copilot users ~1.5x more PRs than manual users
 *
 * REAL-WORLD ANALOGUE: AI coding assistants measurably increase
 * developer throughput, particularly for boilerplate and tests.
 *
 * ---------------------------------------------------------------
 * 4. ON-CALL ROTATION FATIGUE (everything hook)
 * ---------------------------------------------------------------
 *
 * PATTERN: Users with >20 alert_triggered events get increasing
 * response_time_minutes on incident events. Alert fatigue causes
 * slower response as on-call rotations grind engineers down.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Response Time vs Alert Volume
 *   - Report type: Insights
 *   - Event: "incident resolved"
 *   - Measure: Average of "response_time_minutes"
 *   - Filter: users with high alert counts
 *   - Expected: heavy on-call users show 2-3x response time
 *     (fatigued ~ 90min, normal ~ 30min)
 *
 * REAL-WORLD ANALOGUE: On-call burnout is a top cause of attrition
 * in SRE/DevOps. Alert fatigue degrades response quality over time.
 *
 * ---------------------------------------------------------------
 * 5. OPEN SOURCE -> PAID CONVERSION (everything hook)
 * ---------------------------------------------------------------
 *
 * PATTERN: OSS users with >15 total events get 30% of their events
 * converted to team-tier behavior (subscription_tier set to "team").
 * Power OSS users eventually hit limits and convert.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Tier Migration for OSS Users
 *   - Report type: Insights
 *   - Event: any event
 *   - Measure: Total
 *   - Filter: segment = "oss_user"
 *   - Breakdown: "subscription_tier"
 *   - Expected: ~30% of active OSS user events show "team" tier
 *
 * REAL-WORLD ANALOGUE: Open source users who exceed free-tier
 * limits (build minutes, private repos) organically convert to
 * paid plans.
 *
 * ---------------------------------------------------------------
 * 6. POST-OUTAGE RECOVERY (everything hook)
 * ---------------------------------------------------------------
 *
 * PATTERN: After the major outage ends (day 42.25), deployment
 * events get a frequency boost -- extra cloned deployment events
 * represent the flurry of hotfixes and rollback-then-redeploy cycles.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Deployment Spike Post-Outage
 *   - Report type: Insights
 *   - Event: "deployment completed"
 *   - Measure: Total
 *   - Line chart by day
 *   - Expected: visible spike in deploy volume days 43-46
 *
 * REAL-WORLD ANALOGUE: After a major outage, teams push a burst
 * of hotfixes, rollbacks, and emergency deploys to stabilize.
 *
 * ---------------------------------------------------------------
 * 7. DEVOPS LEAD PROFILE ENRICHMENT (user hook)
 * ---------------------------------------------------------------
 *
 * PATTERN: Users in the "devops" segment get team_size boosted
 * to 10-50 and repos_connected boosted to 5-20. DevOps leads
 * manage larger teams and more infrastructure.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Team Size by Segment
 *   - Report type: Insights
 *   - Event: any event
 *   - Measure: Average of user property "team_size"
 *   - Breakdown: user property "segment"
 *   - Expected: devops ~ 30 avg, others ~ 10 avg
 *
 * REAL-WORLD ANALOGUE: DevOps leads oversee platform teams and
 * manage organization-wide CI/CD infrastructure.
 *
 * ---------------------------------------------------------------
 * 8. ENTERPRISE BUILD-DEPLOY FUNNEL LIFT (everything hook)
 * ---------------------------------------------------------------
 *
 * PATTERN: Free-tier users drop 35% of final funnel step events
 * ("monitoring dashboard viewed"), creating a visible conversion
 * gap between paid and free users. Enterprise/business users keep
 * all their events.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Build-Deploy Conversion by Tier
 *   - Report type: Funnels
 *   - Steps: "build completed" -> "deployment completed" -> "monitoring dashboard viewed"
 *   - Breakdown: "subscription_tier" (superProp)
 *   - Expected: enterprise ~ 60% vs free ~ 40% conversion
 *
 * REAL-WORLD ANALOGUE: Enterprise CI/CD customers get priority
 * runners, dedicated support, and SLA-backed uptime guarantees
 * that dramatically improve pipeline reliability.
 *
 * ===============================================================
 * EXPECTED METRICS SUMMARY
 * ===============================================================
 *
 * Hook                        | Metric              | Baseline | Effect  | Ratio
 * ----------------------------|---------------------|----------|---------|------
 * Build Failure Cascade       | build_duration_sec  | 240s     | 480s    | 2x
 * Night Deploy Risk           | deploy failure rate | 15%      | 40%     | 2.7x
 * Copilot PR Velocity         | PRs/user            | 3        | 4.5     | 1.5x
 * On-Call Fatigue             | response_time_min   | 30min    | 90min   | 3x
 * OSS -> Paid Conversion      | team tier events    | 0%       | 30%     | -
 * Post-Outage Recovery        | deploys/day         | 50       | 100+    | 2x+
 * DevOps Lead Profiles        | team_size           | 10       | 30      | 3x
 * Enterprise Funnel Lift      | funnel conversion   | 40%      | 60%     | ~1.5x
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
		subscription_tier: {
			values: ["free", "pro", "enterprise"],
			frequency: "month",
			timing: "fuzzy",
			max: 6
		}
	},
	mirrorProps: {},
	lookupTables: [],

	// -- Events (18) ------------------------------------------
	events: [
		{
			event: "account created",
			weight: 1,
			isFirstEvent: true,
			properties: {
				referral_source: ["organic", "github", "conference", "blog_post", "colleague", "search"],
			},
		},
		{
			event: "build completed",
			weight: 8,
			properties: {
				pipeline_id: chance.pickone.bind(chance, pipelineIds),
				repo_id: chance.pickone.bind(chance, repoIds),
				build_status: ["success", "success", "success", "success", "failed", "cancelled"],
				build_duration_sec: u.weighNumRange(10, 600, 0.4, 240),
				branch: ["main", "main", "develop", "feature", "feature", "hotfix"],
				test_count: u.weighNumRange(10, 500, 0.5, 100),
				test_pass_rate: u.weighNumRange(70, 100, 0.8, 95),
			},
		},
		{
			event: "deployment completed",
			weight: 5,
			properties: {
				pipeline_id: chance.pickone.bind(chance, pipelineIds),
				repo_id: chance.pickone.bind(chance, repoIds),
				deploy_status: ["success", "success", "success", "failed", "rolled_back"],
				environment: ["production", "production", "staging", "staging", "dev", "preview"],
				deploy_duration_sec: u.weighNumRange(15, 300, 0.4, 90),
				is_night_deploy: [false],
				preview_enabled: [false],
			},
		},
		{
			event: "pull request created",
			weight: 6,
			properties: {
				repo_id: chance.pickone.bind(chance, repoIds),
				pr_size: ["small", "small", "medium", "medium", "large", "xlarge"],
				files_changed: u.weighNumRange(1, 50, 0.4, 8),
				lines_added: u.weighNumRange(1, 2000, 0.3, 150),
				lines_removed: u.weighNumRange(0, 500, 0.3, 40),
				ai_assist: ["manual"],
			},
		},
		{
			event: "code review completed",
			weight: 5,
			properties: {
				repo_id: chance.pickone.bind(chance, repoIds),
				review_result: ["approved", "approved", "approved", "changes_requested", "commented"],
				review_duration_hours: u.weighNumRange(0.5, 72, 0.3, 8),
				comments_count: u.weighNumRange(0, 20, 0.5, 3),
				ai_assist: ["manual"],
			},
		},
		{
			event: "alert triggered",
			weight: 4,
			properties: {
				alert_type: ["error_rate", "latency", "cpu", "memory", "disk", "custom_metric"],
				severity: ["info", "warning", "warning", "critical", "critical"],
				service: ["api", "web", "worker", "database", "cdn", "auth"],
				acknowledged: [true, true, true, false],
			},
		},
		{
			event: "incident created",
			weight: 2,
			properties: {
				severity: ["sev1", "sev2", "sev2", "sev3", "sev3", "sev3"],
				service: ["api", "web", "worker", "database", "cdn", "auth"],
				response_time_minutes: u.weighNumRange(1, 120, 0.3, 30),
				root_cause: ["deploy", "config_change", "dependency", "traffic_spike", "hardware", "unknown"],
			},
		},
		{
			event: "incident resolved",
			weight: 2,
			properties: {
				severity: ["sev1", "sev2", "sev2", "sev3", "sev3", "sev3"],
				resolution_time_minutes: u.weighNumRange(5, 480, 0.3, 60),
				response_time_minutes: u.weighNumRange(1, 120, 0.3, 30),
				resolution_type: ["hotfix", "rollback", "config_change", "scaling", "restart", "manual"],
			},
		},
		{
			event: "repository connected",
			weight: 2,
			properties: {
				provider: ["github", "github", "github", "gitlab", "bitbucket"],
				repo_visibility: ["private", "private", "private", "public"],
				language: ["javascript", "python", "go", "rust", "java", "typescript"],
			},
		},
		{
			event: "pipeline configured",
			weight: 2,
			properties: {
				pipeline_id: chance.pickone.bind(chance, pipelineIds),
				pipeline_type: ["build_test", "build_test_deploy", "deploy_only", "lint_test"],
				trigger: ["push", "push", "pull_request", "schedule", "manual"],
				runtime: ["docker", "docker", "node", "python", "go"],
			},
		},
		{
			event: "collaboration invited",
			weight: 2,
			properties: {
				invite_role: ["developer", "developer", "admin", "viewer"],
				invite_method: ["email", "email", "link", "github_team"],
			},
		},
		{
			event: "monitoring dashboard viewed",
			weight: 5,
			properties: {
				dashboard_type: ["overview", "performance", "errors", "deploys", "custom"],
				time_range: ["1h", "6h", "24h", "7d", "30d"],
				widgets_count: u.weighNumRange(1, 12, 0.5, 4),
			},
		},
		{
			event: "log searched",
			weight: 4,
			properties: {
				query_type: ["full_text", "structured", "regex"],
				time_range: ["15m", "1h", "6h", "24h", "7d"],
				results_count: u.weighNumRange(0, 500, 0.3, 50),
				service: ["api", "web", "worker", "database", "auth"],
			},
		},
		{
			event: "notification received",
			weight: 6,
			properties: {
				notification_type: ["build_failed", "deploy_completed", "pr_review_requested", "alert_fired", "mention", "billing"],
				channel: ["in_app", "in_app", "email", "slack", "webhook"],
				opened: [true, true, true, false],
			},
		},
		{
			event: "billing updated",
			weight: 1,
			properties: {
				change_type: ["plan_upgrade", "plan_downgrade", "payment_method", "add_seats", "remove_seats"],
				payment_method: ["credit_card", "credit_card", "invoice", "paypal"],
			},
		},
		{
			event: "app session",
			weight: 8,
			properties: {
				session_duration_sec: u.weighNumRange(10, 3600, 0.4, 180),
				pages_viewed: u.weighNumRange(1, 20, 0.5, 4),
			},
		},
		{
			event: "environment created",
			weight: 2,
			properties: {
				env_type: ["production", "staging", "dev", "preview", "test"],
				cloud_provider: ["aws", "aws", "gcp", "azure", "self_hosted"],
				region: ["us-east-1", "us-west-2", "eu-west-1", "ap-south-1"],
			},
		},
		{
			event: "account deactivated",
			weight: 1,
			isChurnEvent: true,
			returnLikelihood: 0.15,
			isStrictEvent: true,
			properties: {
				reason: ["switched_provider", "cost", "no_longer_needed", "poor_experience", "team_dissolved", "acquired"],
			},
		},
	],

	// -- Funnels (5) ------------------------------------------
	funnels: [
		{
			name: "Onboarding",
			sequence: ["account created", "repository connected", "pipeline configured", "build completed"],
			conversionRate: 45,
			order: "sequential",
			isFirstFunnel: true,
			timeToConvert: 72,
			weight: 3,
		},
		{
			name: "Build-Deploy Pipeline",
			sequence: ["build completed", "deployment completed", "monitoring dashboard viewed"],
			conversionRate: 40,
			order: "sequential",
			timeToConvert: 48,
			weight: 5,
		},
		{
			name: "PR Review Flow",
			sequence: ["pull request created", "code review completed", "build completed", "deployment completed"],
			conversionRate: 35,
			order: "sequential",
			timeToConvert: 72,
			weight: 4,
		},
		{
			name: "Incident Response",
			sequence: ["alert triggered", "incident created", "incident resolved"],
			conversionRate: 50,
			order: "sequential",
			timeToConvert: 24,
			weight: 3,
		},
		{
			name: "Upgrade Path",
			sequence: ["app session", "billing updated", "collaboration invited"],
			conversionRate: 20,
			order: "sequential",
			timeToConvert: 168,
			weight: 2,
		},
	],

	// -- SuperProps --------------------------------------------
	superProps: {
		subscription_tier: ["free", "free", "free", "team", "team", "business", "enterprise"],
		Platform: ["web", "web", "desktop_app", "cli"],
		language: ["javascript", "python", "go", "rust", "java", "typescript"],
	},

	// -- UserProps ---------------------------------------------
	userProps: {
		dev_role: ["full_stack"],
		segment: ["full_stack"],
		team_size: u.weighNumRange(1, 50, 0.4, 5),
		repos_connected: [0],
		org_name: ["personal"],
		experience_level: ["junior", "junior", "mid", "mid", "mid", "senior", "senior"],
		subscription_tier: ["free", "free", "free", "team", "team", "business", "enterprise"],
		Platform: ["web", "web", "desktop_app", "cli"],
		language: ["javascript", "python", "go", "rust", "java", "typescript"],
	},

	// -- Phase 2: Personas ------------------------------------
	personas: [
		{
			name: "platform_engineer",
			weight: 15,
			eventMultiplier: 4.0,
			conversionModifier: 1.5,
			churnRate: 0.01,
			properties: {
				dev_role: "platform_engineer",
				segment: "platform_eng",
			},
		},
		{
			name: "full_stack_dev",
			weight: 35,
			eventMultiplier: 1.5,
			conversionModifier: 1.0,
			churnRate: 0.05,
			properties: {
				dev_role: "full_stack",
				segment: "full_stack",
			},
		},
		{
			name: "junior_dev",
			weight: 30,
			eventMultiplier: 0.8,
			conversionModifier: 0.6,
			churnRate: 0.12,
			properties: {
				dev_role: "junior",
				segment: "junior",
			},
		},
		{
			name: "devops_lead",
			weight: 10,
			eventMultiplier: 2.0,
			conversionModifier: 1.3,
			churnRate: 0.02,
			properties: {
				dev_role: "devops_lead",
				segment: "devops",
			},
		},
		{
			name: "open_source_user",
			weight: 10,
			eventMultiplier: 0.5,
			conversionModifier: 0.3,
			churnRate: 0.15,
			properties: {
				dev_role: "open_source",
				segment: "oss_user",
			},
		},
	],

	// -- Phase 2: World Events --------------------------------
	worldEvents: [
		{
			name: "major_outage",
			startDay: 42,
			duration: 0.25,
			volumeMultiplier: 0.05,
			affectsEvents: ["deployment completed", "build completed"],
			injectProps: { outage_window: true },
		},
		{
			name: "conference_launch",
			startDay: 60,
			duration: 3,
			volumeMultiplier: 2.0,
			affectsEvents: ["account created"],
			injectProps: { promo: "devcon2024" },
		},
	],

	// -- Phase 2: Data Quality --------------------------------
	dataQuality: {
		lateArrivingRate: 0.01,
		duplicateRate: 0.005,
		botUsers: 2,
		botEventsPerUser: 300,
	},

	// -- Phase 2: Subscription --------------------------------
	subscription: {
		plans: [
			{ name: "free", price: 0, default: true },
			{ name: "team", price: 25, trialDays: 14 },
			{ name: "business", price: 75 },
			{ name: "enterprise", price: 200 },
		],
		lifecycle: {
			trialToPayRate: 0.30,
			upgradeRate: 0.08,
			downgradeRate: 0.03,
			churnRate: 0.05,
			winBackRate: 0.10,
			winBackDelay: 21,
			paymentFailureRate: 0.02,
		},
	},

	// -- Phase 2: Geo -----------------------------------------
	geo: {
		sticky: true,
		regions: [
			{
				name: "us",
				countries: ["US"],
				weight: 40,
				timezoneOffset: -5,
				properties: { currency: "USD", locale: "en-US" },
			},
			{
				name: "eu",
				countries: ["GB", "DE", "FR", "NL"],
				weight: 30,
				timezoneOffset: 1,
				properties: { currency: "EUR", locale: "en-EU" },
			},
			{
				name: "india",
				countries: ["IN"],
				weight: 15,
				timezoneOffset: 5.5,
				properties: { currency: "INR", locale: "en-IN" },
			},
			{
				name: "rest",
				countries: ["SG", "AU", "JP"],
				weight: 15,
				timezoneOffset: 8,
				properties: { currency: "SGD", locale: "en-SG" },
			},
		],
	},

	// -- Phase 2: Features ------------------------------------
	features: [
		{
			name: "copilot_integration",
			launchDay: 30,
			adoptionCurve: "fast",
			property: "ai_assist",
			values: ["manual", "copilot"],
			defaultBefore: "manual",
			affectsEvents: ["pull request created", "code review completed"],
		},
		{
			name: "deployment_preview",
			launchDay: 50,
			adoptionCurve: { k: 0.08, midpoint: 25 },
			property: "preview_enabled",
			values: [false, true],
			defaultBefore: false,
			affectsEvents: ["deployment completed"],
		},
	],

	// -- Phase 2: Anomalies -----------------------------------
	anomalies: {
		extremeValues: [
			{
				event: "build completed",
				property: "build_duration_sec",
				frequency: 0.003,
				multiplier: 10,
			},
		],
		bursts: [
			{
				event: "alert triggered",
				day: 42,
				duration: 0.08,
				count: 500,
				injectProps: { alert_tag: "outage_alerts" },
			},
		],
	},

	// -- Hook Function ----------------------------------------
	hook: function (record, type, meta) {
		// -- HOOK 7: DEVOPS LEAD PROFILE ENRICHMENT (user) --------
		// DevOps leads get team_size 10-50 and repos_connected 5-20.
		// Platform engineers get moderate boosts. Others stay at defaults.
		if (type === "user") {
			if (record.segment === "devops") {
				record.team_size = chance.integer({ min: 10, max: 50 });
				record.repos_connected = chance.integer({ min: 5, max: 20 });
				record.experience_level = "senior";
			} else if (record.segment === "platform_eng") {
				record.team_size = chance.integer({ min: 5, max: 25 });
				record.repos_connected = chance.integer({ min: 3, max: 15 });
				record.experience_level = chance.pickone(["mid", "senior"]);
			} else if (record.segment === "junior") {
				record.team_size = chance.integer({ min: 1, max: 8 });
				record.repos_connected = chance.integer({ min: 0, max: 3 });
				record.experience_level = "junior";
			}
		}

		// -- HOOK 8: ENTERPRISE BUILD-DEPLOY FUNNEL LIFT
		// Conversion differences handled in everything hook via event filtering.
		// (funnel-pre conversionRate modifications are diluted by organic events)

		// -- HOOK 1: BUILD FAILURE CASCADE (event) ----------------
		// Failed builds get 2x duration (retries take longer).
		if (type === "event") {
			if (record.event === "build completed" && record.build_status === "failed") {
				record.build_duration_sec = Math.floor((record.build_duration_sec || 240) * 2);
			}

			// -- HOOK 2: NIGHT DEPLOY RISK (event) ----------------
			// Deployments between 10PM-6AM get forced to "failed" 40% of the time.
			if (record.event === "deployment completed") {
				const hour = dayjs(record.time).hour();
				if (hour >= 22 || hour < 6) {
					record.is_night_deploy = true;
					if (chance.bool({ likelihood: 40 })) {
						record.deploy_status = "failed";
					}
				}
			}
		}

		// -- EVERYTHING HOOKS -------------------------------------
		if (type === "everything") {
			let events = record;
			if (!events.length) return record;
			const profile = meta && meta.profile ? meta.profile : {};

			// -- SUPERPROP STAMPING -------------------------------
			// Stamp superProp values from profile onto every event so
			// they stay consistent per-user instead of randomizing per-event.
			events.forEach(e => {
				if (profile.subscription_tier) e.subscription_tier = profile.subscription_tier;
				if (profile.Platform) e.Platform = profile.Platform;
				if (profile.language) e.language = profile.language;
			});

			// -- HOOK 8: ENTERPRISE BUILD-DEPLOY FUNNEL LIFT ------
			// Free-tier users drop 35% of final funnel step events to
			// create visible conversion gap vs paid subscribers.
			if (profile.subscription_tier !== "enterprise" && profile.subscription_tier !== "business") {
				events = events.filter(e => {
					if (e.event === "monitoring dashboard viewed" && chance.bool({ likelihood: 35 })) return false;
					return true;
				});
			}

			// -- HOOK 3: COPILOT PR VELOCITY ----------------------
			// Users with ai_assist="copilot" on any PR get 1.5x more PRs.
			const hasCopilot = events.some(e =>
				(e.event === "pull request created" || e.event === "code review completed") && e.ai_assist === "copilot"
			);
			if (hasCopilot) {
				const prEvents = events.filter(e => e.event === "pull request created");
				const extraCount = Math.floor(prEvents.length * 0.5);
				for (let i = 0; i < extraCount; i++) {
					const templateEvent = prEvents[i % prEvents.length];
					if (templateEvent) {
						events.push({
							...templateEvent,
							time: dayjs(templateEvent.time).add(chance.integer({ min: 1, max: 12 }), "hours").toISOString(),
							user_id: templateEvent.user_id,
							ai_assist: "copilot",
							files_changed: chance.integer({ min: 1, max: 30 }),
							lines_added: chance.integer({ min: 10, max: 800 }),
						});
					}
				}
			}

			// -- HOOK 4: ON-CALL ROTATION FATIGUE -----------------
			// Users with >20 alerts get increasing response_time_minutes.
			const alertCount = events.filter(e => e.event === "alert triggered").length;
			if (alertCount > 20) {
				const fatigueMultiplier = 1 + Math.min(alertCount / 20, 3);
				events.forEach(e => {
					if (e.event === "incident resolved" && e.response_time_minutes) {
						e.response_time_minutes = Math.floor(e.response_time_minutes * fatigueMultiplier);
					}
					if (e.event === "incident created" && e.response_time_minutes) {
						e.response_time_minutes = Math.floor(e.response_time_minutes * fatigueMultiplier);
					}
				});
			}

			// -- HOOK 5: OPEN SOURCE -> PAID CONVERSION -----------
			// OSS users with >15 events get 30% of events converted to "team" tier.
			if (profile.segment === "oss_user" && events.length > 15) {
				const conversionPoint = Math.floor(events.length * 0.7);
				for (let i = conversionPoint; i < events.length; i++) {
					events[i].subscription_tier = "team";
				}
			}

			// -- HOOK 6: POST-OUTAGE RECOVERY ---------------------
			// After the outage volume rebound (d44-48), deployment events get
			// aggressively cloned to produce a visible spike above baseline.
			// Shifted later than outage end (d42.25) so natural volume has
			// recovered from the 0.05x suppression before cloning kicks in.
			const RECOVERY_START = DATASET_START.add(44, "days");
			const RECOVERY_END = DATASET_START.add(48, "days");
			const deployEvents = events.filter(e => {
				if (e.event !== "deployment completed") return false;
				const t = dayjs(e.time);
				return t.isAfter(RECOVERY_START) && t.isBefore(RECOVERY_END);
			});
			deployEvents.forEach(dep => {
				// 100% clone rate with 3 copies per event to clearly
				// exceed baseline deploy volume (d35-41)
				for (let c = 0; c < 3; c++) {
					events.push({
						...dep,
						time: dayjs(dep.time).add(chance.integer({ min: 1, max: 8 }), "hours").toISOString(),
						user_id: dep.user_id,
						deploy_status: chance.pickone(["success", "success", "rolled_back"]),
						environment: "production",
					});
				}
			});

			return events;
		}

		return record;
	},
};

export default config;
