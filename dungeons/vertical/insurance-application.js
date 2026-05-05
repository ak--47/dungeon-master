// ── TWEAK THESE ──
const SEED = "dm4-insurance";
const num_days = 120;
const num_users = 15_000;
const avg_events_per_user_per_day = 1.2;
let token = "your-mixpanel-token";

// ── env overrides ──
if (process.env.MP_TOKEN) token = process.env.MP_TOKEN;

import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import "dotenv/config";
import * as u from "../../lib/utils/utils.js";

dayjs.extend(utc);
const chance = u.initChance(SEED);

/** @typedef {import("../../types").Dungeon} Config */

/*
 * ===================================================================
 * DATASET OVERVIEW
 * ===================================================================
 *
 * SAFEHAVEN INSURANCE — Web Application Dungeon
 *
 * SafeHaven Insurance is a modern insurance application where users
 * browse coverage options, request quotes, complete multi-step
 * applications, manage policies, file claims, and make premium payments.
 *
 * - 5,000 users over 100 days
 * - 600,000 events across 18 event types
 * - 10 hooks (version stamping, ticket volume, conversion boost, magic number,
 *   TTC scaling, claims experiment, risk approval, doc upload retention,
 *   renewal spike, claim-to-premium)
 * - 5 funnels (onboarding, application, approval, claims, renewal)
 * - 5 insurance types as super property (auto, home, life, health, renters)
 * - Deterministic app versioning (2.10 → 2.11 → 2.12 → 2.13)
 * - Platforms: web, iOS, Android
 *
 * CORE LOOP:
 * Users create an account, browse insurance products, and request quotes.
 * They start multi-step applications (personal info, coverage selection,
 * document upload) and submit for approval. Once approved, they activate
 * a policy, make premium payments, and manage renewals. If something
 * goes wrong, they file claims and create support tickets.
 *
 * KEY DATA STORY — VERSION 2.13 RELEASE:
 * The app has gone through versions 2.10 → 2.11 → 2.12 → 2.13.
 * Version 2.13 was released 10 days ago and fixed critical UX issues.
 * Two effects are visible: support ticket volume drops immediately,
 * and application funnel conversion improves significantly.
 */

/*
 * ===================================================================
 * ANALYTICS HOOKS (10 hooks)
 *
 * Hooks 1-5: Version stamping, support ticket volume drop, application
 * conversion boost, step-count magic number, application TTC by account type.
 *
 * Hooks 6-10: Claims experiment, risk profile approval gating, document
 * upload retention, end-of-quarter renewal spike, claim-to-premium increase.
 * ===================================================================
 *
 * NOTE: All cohort effects are HIDDEN — no flag stamping. Discoverable
 * via raw-prop breakdowns (date, app_version, issue_category) or
 * behavioral cohorts.
 *
 * -------------------------------------------------------------------
 * 1. VERSION STAMPING (everything)
 * -------------------------------------------------------------------
 *
 * PATTERN: Every event gets a deterministic app_version based on its
 * final timestamp. All users shift simultaneously on release dates:
 *   - Days 0-30:    v2.10
 *   - Days 30-60:   v2.11
 *   - Days 60-90:   v2.12
 *   - Last 10 days: v2.13
 * app_version is a real product property already in superProps.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Event Volume by App Version
 *   - Report type: Insights
 *   - Event: "page viewed"
 *   - Measure: Total
 *   - Breakdown: "app_version"
 *   - Line chart by day
 *   - Expected: clean cutovers between versions, no overlap
 *
 * REAL-WORLD ANALOGUE: Forced auto-update SaaS apps cut all users over
 * on release day, producing crisp version bands.
 *
 * -------------------------------------------------------------------
 * 2. SUPPORT TICKET VOLUME DROP (everything)
 * -------------------------------------------------------------------
 *
 * PATTERN: Pre-v2.13: each user gets 2-3 extra cloned support-ticket
 * created events with bug-related issue_category values (form_crash,
 * login_error, page_timeout, payment_failure — added to event config).
 * Post-v2.13: tickets progressively removed (30% day 1 → 85% day 10).
 * No flag — discover via issue_category breakdown over time.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Ticket Volume Over Time
 *   - Report type: Insights
 *   - Event: "support ticket created"
 *   - Measure: Total
 *   - Breakdown: "app_version"
 *   - Line chart by day
 *   - Expected: high volume on v2.12, sharp drop on v2.13
 *
 *   Report 2: Bug Category Share Pre vs Post v2.13
 *   - Report type: Insights
 *   - Event: "support ticket created"
 *   - Measure: Total
 *   - Breakdown: "issue_category"
 *   - Compare pre-v2.13 vs v2.13 date ranges
 *   - Expected: form_crash / login_error / page_timeout / payment_failure
 *     dominate pre-v2.13, vanish post-v2.13
 *
 * REAL-WORLD ANALOGUE: A UX-fix release reduces ticket volume overnight.
 *
 * -------------------------------------------------------------------
 * 3. APPLICATION CONVERSION BOOST (everything)
 * -------------------------------------------------------------------
 *
 * PATTERN: Pre-v2.13: ~95% of users have ALL their application approved +
 * policy activated events dropped (per-user gating). Post-v2.13: kept.
 * No flag — discover via funnel by app_version or volume line chart over time.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Application Funnel by Version
 *   - Report type: Funnels
 *   - Steps: "application submitted" -> "application approved" -> "policy activated"
 *   - Breakdown: "app_version"
 *   - Expected: post-v2.13 ~ 1.3x pre-v2.13 conversion rate
 *     (~58% v2.13 vs ~44% v2.12; some dilution because users span versions)
 *
 * REAL-WORLD ANALOGUE: A buggy multi-step form fixed by release.
 *
 * -------------------------------------------------------------------
 * 4. APPLICATION-STEP MAGIC NUMBER (everything)
 * -------------------------------------------------------------------
 *
 * PATTERN: Users with 8-14 application step completed events sit in the
 * sweet spot — approved_premium boosted +35%. Users with 15+ steps
 * are over-engaged (likely fraud or signal review); 40% of their
 * application approved events drop. No flag.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Avg Approved Premium by Step Bucket
 *   - Report type: Insights (with cohort)
 *   - Cohort A: users with 8-14 "application step completed"
 *   - Cohort B: users with 0-7
 *   - Event: "application approved"
 *   - Measure: Average of "approved_premium"
 *   - Expected: A ~ 1.35x B
 *
 *   Report 2: Approvals per User on Heavy Step-Completers
 *   - Report type: Insights (with cohort)
 *   - Cohort C: users with >= 15 "application step completed"
 *   - Cohort A: users with 8-14
 *   - Event: "application approved"
 *   - Measure: Total per user
 *   - Expected: C ~ 40% fewer approvals per user vs A
 *
 * REAL-WORLD ANALOGUE: Engaged applicants get higher premiums approved;
 * over-engaged ones look like fraud and get flagged.
 *
 * -------------------------------------------------------------------
 * 5. APPLICATION COMPLETION TIME-TO-CONVERT (everything)
 * -------------------------------------------------------------------
 *
 * PATTERN: In the everything hook, place each "application approved"
 * event at a fixed target offset from the first "application started"
 * event, determined by account_type (assigned via deterministic hash):
 *   - business:   ~36h target offset (~0.75x baseline)
 *   - individual: ~48h target offset (baseline)
 *   - family:     ~63h target offset (~1.31x baseline)
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Application Funnel TTC by Account Type
 *   - Report type: Funnels
 *   - Steps: "application started" → "application approved"
 *   - Breakdown: account_type (from account created event)
 *   - Measure: Median time to convert
 *   - Expected: business < individual < family
 *
 * REAL-WORLD ANALOGUE: Business applicants have streamlined processes
 * and pre-filled forms; family policies require more documentation.
 *
 * -------------------------------------------------------------------
 * 6. CLAIMS PROCESS EXPERIMENT (funnel config — no hook code)
 * -------------------------------------------------------------------
 *
 * PATTERN: A/B experiment on the Claims Process funnel. The engine
 * fires $experiment_started events and applies conversion/TTC
 * multipliers automatically. "Simplified Claims" variant gets 1.3x
 * conversion and 0.8x time-to-convert. Experiment runs in the last
 * 35 days of the dataset.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Experiment Results
 *   - Report type: Funnels
 *   - Steps: "claim filed" -> "claim status checked" -> "support ticket created"
 *   - Breakdown: "Variant name"
 *   - Date range: last 35 days of dataset
 *   - Expected: "Simplified Claims" has ~1.3x conversion vs "Control"
 *
 *   Report 2: Experiment Started Events
 *   - Report type: Insights
 *   - Event: "$experiment_started"
 *   - Breakdown: "Variant name"
 *   - Expected: roughly equal distribution between Control and Simplified Claims
 *
 * REAL-WORLD ANALOGUE: A/B testing a simplified claims flow to reduce
 * friction and improve completion rates.
 *
 * -------------------------------------------------------------------
 * 7. RISK PROFILE AFFECTS APPROVAL (funnel-pre)
 * -------------------------------------------------------------------
 *
 * PATTERN: In the funnel-pre hook, low-risk users get 1.8x approval
 * funnel conversion (capped at 95%), high-risk users get 0.3x.
 * Medium-risk users are unchanged.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Application Approval Funnel by Risk Profile
 *   - Report type: Funnels
 *   - Steps: "application submitted" -> "application approved" -> "policy activated"
 *   - Breakdown: "risk_profile" (user property)
 *   - Expected: low >> medium >> high conversion rates
 *
 * REAL-WORLD ANALOGUE: Underwriting engines auto-approve low-risk
 * applicants and require manual review for high-risk ones.
 *
 * -------------------------------------------------------------------
 * 8. DOCUMENT UPLOAD RETENTION (everything — retention magic number)
 * -------------------------------------------------------------------
 *
 * PATTERN: Users who upload 3+ documents in their first 14 days
 * retain normally. Users with fewer uploads lose 75% of events after
 * day 30. Only affects born-in-dataset users.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Retention by Document Upload Cohort
 *   - Report type: Retention
 *   - Starting event: "account created"
 *   - Return event: any event
 *   - Cohort A: users with >= 3 "document uploaded" in first 14 days
 *   - Cohort B: users with < 3 "document uploaded" in first 14 days
 *   - Expected: Cohort A retains well past day 30; Cohort B drops off sharply
 *
 *   Report 2: Post-Day-30 Event Volume
 *   - Report type: Insights
 *   - Event: all events
 *   - Compare doc-uploader cohort vs non-uploader
 *   - Expected: non-uploaders have ~75% fewer events after day 30
 *
 * REAL-WORLD ANALOGUE: Users who complete onboarding paperwork early
 * are invested in the product and retain; those who don't churn.
 *
 * -------------------------------------------------------------------
 * 9. END-OF-QUARTER RENEWAL SPIKE (everything — temporal)
 * -------------------------------------------------------------------
 *
 * PATTERN: Days 85-95 of the dataset get 3x renewal completed events
 * and 2x coverage reviewed events via cloning. Simulates end-of-quarter
 * policy renewal batch processing.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Renewal Volume Over Time
 *   - Report type: Insights
 *   - Event: "renewal completed"
 *   - Measure: Total
 *   - Line chart by day
 *   - Expected: visible spike at days 85-95, ~3x baseline volume
 *
 *   Report 2: Coverage Review Spike
 *   - Report type: Insights
 *   - Event: "coverage reviewed"
 *   - Line chart by day
 *   - Expected: ~2x volume during days 85-95
 *
 * REAL-WORLD ANALOGUE: Insurance companies batch-process renewals at
 * quarter-end, producing predictable volume spikes.
 *
 * -------------------------------------------------------------------
 * 10. CLAIM-TO-PREMIUM INCREASE (event — closure Map)
 * -------------------------------------------------------------------
 *
 * PATTERN: After a user files a claim, their next "payment made" event
 * gets premium_amount doubled (2.0x). Uses a module-level Map to
 * track state across events. The Map entry is consumed (deleted) on
 * the first payment after the claim, so the effect is one-shot.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Average Premium After Claim
 *   - Report type: Insights
 *   - Event: "payment made"
 *   - Measure: Average of "premium_amount"
 *   - Cohort A: users who did "claim filed" before
 *   - Cohort B: users who never filed a claim
 *   - Expected: Cohort A premium_amount ~ 2.0x Cohort B
 *
 * REAL-WORLD ANALOGUE: Insurance premiums increase after filing a claim.
 *
 * ===================================================================
 * EXPECTED METRICS SUMMARY
 * ===================================================================
 *
 * Hook                    | Metric                  | Baseline | Effect  | Ratio
 * ------------------------|-------------------------|----------|---------|------
 * Version Stamping        | Events per version      | n/a      | clean   | bands
 * Support Ticket Volume   | tickets v2.12 -> v2.13  | 1x       | ~ 0.3x  | -70%
 * Application Conversion  | approval rate pre/post  | 1x       | ~ 1.3x  | step-up
 * Step-Count Magic Number | sweet approved_premium  | 1x       | 1.35x   | 1.35x
 * Step-Count Magic Number | over approvals/user     | 1x       | 0.6x    | -40%
 * Application TTC         | business vs individual  | 1x       | 0.74x   | faster
 * Application TTC         | family vs individual    | 1x       | 1.3x    | slower
 * Claims Experiment       | simplified vs control   | 1x       | 1.3x    | +30%
 * Risk Profile Approval   | low vs medium conv rate | 1x       | 1.8x    | +80%
 * Risk Profile Approval   | high vs medium conv rate| 1x       | 0.3x    | -70%
 * Document Upload Ret.    | post-d30 non-uploaders  | 1x       | 0.25x   | -75%
 * Renewal Spike           | renewals d85-95 vs base | 1x       | 3x      | +200%
 * Renewal Spike           | reviews d85-95 vs base  | 1x       | 2x      | +100%
 * Claim-to-Premium        | premium after claim     | 1x       | 2.0x    | +100%
 */

// ── H10 closure state: tracks users who filed a claim ──
const claimFilers = new Map();

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
	hasBrowser: false,
	hasCampaigns: false,
	isAnonymous: false,
	hasAdSpend: false,
	hasAvatar: true,
	concurrency: 1,
	writeToDisk: false,

	scdProps: {
		policy_status: {
			values: ["pending", "active", "lapsed", "renewed"],
			frequency: "month",
			timing: "fuzzy",
			max: 8
		}
	},
	mirrorProps: {},
	lookupTables: [],

	// ── Events ──
	events: [
		{
			event: "account created",
			weight: 1,
			isFirstEvent: true,
			isAuthEvent: true,
			properties: {
				signup_source: ["web", "mobile", "agent_referral", "partner"],
				account_type: ["individual", "family", "business"],
			},
		},
		{
			event: "page viewed",
			weight: 10,
			properties: {
				page_name: [
					"home",
					"quotes",
					"coverage_options",
					"claims",
					"faq",
					"profile",
					"payment",
					"documents",
				],
				referrer: ["direct", "google", "email", "social_media"],
			},
		},
		{
			event: "quote requested",
			weight: 5,
			properties: {
				coverage_level: ["basic", "standard", "premium"],
				deductible: u.weighNumRange(250, 5000, 0.5, 1000),
			},
		},
		{
			event: "quote received",
			weight: 4,
			properties: {
				monthly_premium: u.weighNumRange(30, 800, 0.3, 150),
				coverage_amount: u.weighNumRange(10000, 500000, 0.3, 100000),
				quote_comparison_count: u.weighNumRange(1, 5, 0.5, 2),
			},
		},
		{
			event: "application started",
			weight: 4,
			properties: {
				coverage_level: ["basic", "standard", "premium"],
				estimated_premium: u.weighNumRange(30, 800, 0.3, 150),
			},
		},
		{
			event: "application step completed",
			weight: 6,
			properties: {
				step_name: [
					"personal_info",
					"coverage_selection",
					"medical_history",
					"vehicle_info",
					"beneficiary",
					"review",
				],
				step_number: u.weighNumRange(1, 6),
				time_on_step_sec: u.weighNumRange(15, 600, 0.3, 90),
			},
		},
		{
			event: "document uploaded",
			weight: 3,
			properties: {
				document_type: [
					"drivers_license",
					"proof_of_address",
					"vehicle_registration",
					"medical_records",
					"property_photos",
				],
				file_size_kb: u.weighNumRange(50, 5000, 0.5, 500),
			},
		},
		{
			event: "application submitted",
			weight: 3,
			properties: {
				documents_attached: u.weighNumRange(1, 5, 0.5, 2),
				application_time_min: u.weighNumRange(5, 60, 0.3, 15),
			},
		},
		{
			event: "application approved",
			weight: 2,
			properties: {
				approved_premium: u.weighNumRange(30, 800, 0.3, 150),
				approval_time_hours: u.weighNumRange(1, 72, 0.5, 24),
			},
		},
		{
			event: "policy activated",
			weight: 2,
			properties: {
				policy_term_months: [6, 12, 12, 12, 24],
				effective_date_offset_days: u.weighNumRange(0, 30, 0.5, 7),
			},
		},
		{
			event: "claim filed",
			weight: 2,
			properties: {
				claim_type: [
					"collision",
					"theft",
					"water_damage",
					"fire",
					"medical",
					"liability",
				],
				estimated_amount: u.weighNumRange(100, 50000, 0.3, 3000),
			},
		},
		{
			event: "claim status checked",
			weight: 4,
			properties: {
				claim_status: [
					"submitted",
					"under_review",
					"approved",
					"denied",
					"payment_pending",
				],
				days_since_filed: u.weighNumRange(1, 60, 0.5, 10),
			},
		},
		{
			event: "payment made",
			weight: 5,
			properties: {
				payment_method: ["credit_card", "bank_transfer", "auto_pay", "check"],
				amount: u.weighNumRange(30, 800, 0.3, 150),
				premium_amount: u.weighNumRange(50, 600, 0.3, 150),
				payment_status: ["success", "success", "success", "success", "failed"],
			},
		},
		{
			event: "support ticket created",
			weight: 4,
			properties: {
				issue_category: [
					"billing",
					"claims",
					"coverage",
					"technical",
					"policy_change",
					"form_crash",
					"login_error",
					"page_timeout",
					"payment_failure",
				],
				priority: ["low", "medium", "medium", "high"],
				channel: ["chat", "phone", "email", "web_form"],
			},
		},
		{
			event: "support ticket resolved",
			weight: 3,
			properties: {
				resolution_type: [
					"self_service",
					"agent_assisted",
					"escalated",
					"auto_resolved",
				],
				satisfaction_score: u.weighNumRange(1, 5, 1, 4),
				resolution_time_hours: u.weighNumRange(0.5, 72, 0.3, 8),
			},
		},
		{
			event: "coverage reviewed",
			weight: 4,
			properties: {
				current_premium: u.weighNumRange(30, 800, 0.3, 150),
				coverage_adequate: [true, true, true, false],
			},
		},
		{
			event: "profile updated",
			weight: 2,
			properties: {
				field_updated: [
					"address",
					"phone",
					"email",
					"beneficiary",
					"payment_method",
					"vehicle_info",
				],
			},
		},
		{
			event: "renewal completed",
			weight: 2,
			properties: {
				renewal_premium: u.weighNumRange(30, 800, 0.3, 150),
				premium_change_pct: u.weighNumRange(-15, 20, 1, 3),
				auto_renewed: [true, true, false],
			},
		},
	],

	// ── Funnels ──
	funnels: [
		{
			name: "Onboarding",
			sequence: ["account created", "page viewed", "quote requested"],
			isFirstFunnel: true,
			conversionRate: 85,
			timeToConvert: 0.5,
		},
		{
			name: "Application Completion",
			sequence: [
				"application started",
				"application step completed",
				"document uploaded",
				"application submitted",
			],
			conversionRate: 60,
			timeToConvert: 48,
			weight: 4,
			order: "sequential",
		},
		{
			name: "Application Approval",
			sequence: [
				"application submitted",
				"application approved",
				"policy activated",
			],
			conversionRate: 70,
			timeToConvert: 72,
			weight: 3,
			order: "sequential",
		},
		{
			name: "Claims Process",
			sequence: [
				"claim filed",
				"claim status checked",
				"support ticket created",
			],
			conversionRate: 50,
			timeToConvert: 24,
			weight: 2,
			experiment: {
				name: "Simplified Claims Flow",
				variants: [
					{ name: "Control" },
					{ name: "Simplified Claims", conversionMultiplier: 1.3, ttcMultiplier: 0.8 },
				],
				startDaysBeforeEnd: 35,
			},
		},
		{
			name: "Policy Renewal",
			sequence: ["coverage reviewed", "payment made", "renewal completed"],
			conversionRate: 65,
			timeToConvert: 72,
			weight: 3,
		},
	],

	// ── Super Props (on every event) ──
	superProps: {
		Platform: ["web", "ios", "android"],
		insurance_type: ["auto", "home", "life", "health", "renters"],
		app_version: ["2.10"],
	},

	// ── User Props (set once per user) ──
	userProps: {
		Platform: ["web", "ios", "android"],
		insurance_type: ["auto", "home", "life", "health", "renters"],
		app_version: ["2.10"],
		age_range: ["18-25", "26-35", "36-45", "46-55", "56-65", "65+"],
		risk_profile: ["low", "medium", "high"],
		policy_count: u.weighNumRange(0, 5, 0.5, 1),
		lifetime_premium: u.weighNumRange(0, 50000, 0.3, 5000),
		preferred_contact: ["email", "phone", "app_notification"],
	},

	// ── Hook Function ──
	/**
	 * ARCHITECTED ANALYTICS HOOKS (10 total)
	 *
	 * This hook function creates 10 deliberate patterns in the data:
	 *
	 * 1. VERSION STAMPING (everything): Deterministic app_version based on timestamp.
	 * 2. SUPPORT TICKET VOLUME (everything): Inflated pre-v2.13, progressive drop post.
	 * 3. APPLICATION CONVERSION BOOST (everything): Pre-v2.13 approval drop.
	 * 4. STEP-COUNT MAGIC NUMBER (everything): 8-14 steps = +35% premium; 15+ = -40% approvals.
	 * 5. APPLICATION TTC (everything): Business 0.74x faster, family 1.3x slower.
	 * 6. CLAIMS EXPERIMENT (funnel config): A/B test on claims funnel (engine-handled).
	 * 7. RISK PROFILE APPROVAL (funnel-pre): Low-risk 1.8x, high-risk 0.3x conversion.
	 * 8. DOCUMENT UPLOAD RETENTION (everything): 3+ uploads in 14d = retain; else -75% post-d30.
	 * 9. RENEWAL SPIKE (everything): Days 85-95 get 3x renewals, 2x coverage reviews.
	 * 10. CLAIM-TO-PREMIUM (event): Premium 2.0x on first payment after claim filed.
	 */
	hook: function (record, type, meta) {
		// =============================================================
		// H7: RISK PROFILE AFFECTS APPROVAL (funnel-pre)
		// =============================================================
		if (type === "funnel-pre") {
			const isApprovalFunnel = meta.funnel?.sequence?.includes("application approved");
			if (isApprovalFunnel) {
				const risk = meta.profile?.risk_profile;
				if (risk === "low") record.conversionRate = Math.min(95, Math.round(record.conversionRate * 1.8));
				else if (risk === "high") record.conversionRate = Math.round(record.conversionRate * 0.3);
			}
		}

		// =============================================================
		// H10: CLAIM-TO-PREMIUM INCREASE (event — closure Map)
		// =============================================================
		if (type === "event") {
			if (record.event === "claim filed") {
				claimFilers.set(record.user_id, true);
			}
			if (record.event === "payment made" && claimFilers.has(record.user_id)) {
				record.premium_amount = Math.round((record.premium_amount || 500) * 2.0);
				claimFilers.delete(record.user_id);
			}
		}

		// =============================================================
		// Everything hooks: H5 first (timestamps), then H2-H4, then
		// H8-H9, then H1 (version stamping LAST).
		// =============================================================
		if (type === "everything") {
			const datasetStart = dayjs.unix(meta.datasetStart);
			const datasetEnd = dayjs.unix(meta.datasetEnd);
			const V211_DATE = datasetStart.add(30, "days");
			const V212_DATE = datasetStart.add(60, "days");
			const V213_DATE = datasetEnd.subtract(10, "days");
			const userEvents = record;
			if (userEvents.length === 0) return record;

			// Stamp superProps from profile for consistency
			const profile = meta.profile;
			userEvents.forEach(e => {
				e.Platform = profile.Platform;
				e.insurance_type = profile.insurance_type;
				e.app_version = profile.app_version;
			});

			// Find a user_id from any existing event
			const userId =
				userEvents.find((e) => e.user_id)?.user_id ||
				userEvents[0]?.device_id;

			// ─── Hook #5: APPLICATION COMPLETION TIME-TO-CONVERT ───
			// Runs FIRST: adjusts timestamps before version stamping.
			// Business accounts complete the application funnel faster (0.74x),
			// family accounts slower (1.3x). Individual stays at baseline.
			// Assigns account_type deterministically per user via djb2 hash
			// (independent of engine RNG). Places each "application approved"
			// event at a fixed offset from the first "application started".
			{
				// djb2 hash of userId → deterministic cohort
				let h = 5381;
				for (let i = 0; i < userId.length; i++) {
					h = ((h << 5) + h + userId.charCodeAt(i)) | 0;
				}
				const acctTypes = ["individual", "family", "business"];
				const userAccountType = acctTypes[((h % 3) + 3) % 3];
				// Stamp account created events with the deterministic type
				for (const evt of userEvents) {
					if (evt.event === "account created") {
						evt.account_type = userAccountType;
					}
				}
				userEvents.sort((a, b) => new Date(a.time) - new Date(b.time));
				// Collect all "application started" times
				const startedTimes = [];
				for (const evt of userEvents) {
					if (evt.event === "application started") {
						startedTimes.push(dayjs(evt.time).valueOf());
					}
				}
				if (startedTimes.length > 0) {
					const firstStartTime = startedTimes[0];
					// Target hours: biz=36, indiv=48, family=63
					// Ratios: biz/indiv≈0.75, family/indiv≈1.31
					const targetHours = (
						userAccountType === "business" ? 36 :
						userAccountType === "family" ? 63 :
						48
					);
					const targetMs = targetHours * 3600000;
					for (const evt of userEvents) {
						if (evt.event !== "application approved") continue;
						const evtTime = dayjs(evt.time).valueOf();
						const origGap = evtTime - firstStartTime;
						// Small jitter from original gap (mod 4h) for variance
						const jitter = origGap > 0 ? (origGap % (4 * 3600000)) : 0;
						evt.time = dayjs(firstStartTime + targetMs + jitter).toISOString();
					}
				}
			}

			// ─── Hook #2: SUPPORT TICKET VOLUME ───
			// PRE-V2.13: Inject 2-3 extra support tickets with bug-related categories
			const preV213Tickets = userEvents.filter(
				(e) =>
					e.event === "support ticket created" &&
					dayjs(e.time).isBefore(V213_DATE)
			);

			if (preV213Tickets.length > 0) {
				const extraCount = chance.integer({ min: 2, max: 3 });
				const bugCategories = [
					"form_crash",
					"login_error",
					"page_timeout",
					"payment_failure",
				];

				for (let i = 0; i < extraCount; i++) {
					// Pick a random pre-v2.13 ticket to base timing on
					const sourceTicket = chance.pickone(preV213Tickets);
					const sourceTime = dayjs(sourceTicket.time);
					// Offset by a few hours to days
					const offsetHours = chance.integer({ min: 1, max: 72 });
					let newTime = sourceTime.add(offsetHours, "hours");
					// Ensure it stays before v2.13
					if (newTime.isAfter(V213_DATE)) {
						newTime = V213_DATE.subtract(
							chance.integer({ min: 1, max: 48 }),
							"hours"
						);
					}

					// Compute app_version for injected event
					let injectedVersion;
					if (newTime.isBefore(V211_DATE)) {
						injectedVersion = "2.10";
					} else if (newTime.isBefore(V212_DATE)) {
						injectedVersion = "2.11";
					} else {
						injectedVersion = "2.12"; // always pre-v2.13
					}

					userEvents.push({
						...sourceTicket,
						time: newTime.toISOString(),
						user_id: userId,
						app_version: injectedVersion,
						issue_category: chance.pickone(bugCategories),
						priority: chance.pickone(["medium", "high", "high"]),
						channel: chance.pickone([
							"chat",
							"phone",
							"email",
							"web_form",
						]),
					});
				}
			}

			// POST-V2.13: Remove support tickets with increasing probability
			// Day 1 after release: ~30% removal
			// Day 5: ~60% removal
			// Day 10: ~85% removal
			for (let i = userEvents.length - 1; i >= 0; i--) {
				const evt = userEvents[i];
				if (evt.event === "support ticket created") {
					const evtTime = dayjs(evt.time);
					if (evtTime.isAfter(V213_DATE)) {
						const daysSinceRelease = evtTime.diff(
							V213_DATE,
							"days",
							true
						);
						// Linear ramp: 30% base + 5.5% per day → ~85% at day 10
						const removalLikelihood = Math.min(
							85,
							30 + daysSinceRelease * 5.5
						);
						if (chance.bool({ likelihood: removalLikelihood })) {
							userEvents.splice(i, 1);
						}
					}
				}
			}

			// ─── Hook #3: APPLICATION CONVERSION BOOST ───
			// PRE-V2.13: Remove ALL application approved + policy activated events
			// for ~80% of users (per-user gating, not per-event). This produces
			// visible funnel completion gap pre-v2.13 vs post-v2.13.
			if (chance.bool({ likelihood: 95 })) {
				for (let i = userEvents.length - 1; i >= 0; i--) {
					const evt = userEvents[i];
					if (
						(evt.event === "application approved" ||
							evt.event === "policy activated") &&
						dayjs(evt.time).isBefore(V213_DATE)
					) {
						userEvents.splice(i, 1);
					}
				}
			}

			// Hook 4: APPLICATION-STEP MAGIC NUMBER (no flags)
			// Sweet 8-14 application step completed → +35% on approved_premium
			// for application approved events. Over 15+ → drop 40% of
			// application approved events (fraud filter triggers).
			const stepCount = userEvents.filter(e => e.event === "application step completed").length;
			if (stepCount >= 8 && stepCount <= 14) {
				userEvents.forEach(e => {
					if (e.event === "application approved" && typeof e.approved_premium === "number") {
						e.approved_premium = Math.round(e.approved_premium * 1.35);
					}
				});
			} else if (stepCount >= 15) {
				for (let i = userEvents.length - 1; i >= 0; i--) {
					if (userEvents[i].event === "application approved" && chance.bool({ likelihood: 40 })) {
						userEvents.splice(i, 1);
					}
				}
			}

			// ─── Hook #8: DOCUMENT UPLOAD RETENTION ───
			// Users with 3+ "document uploaded" in first 14 days retain;
			// others lose 75% of events post-day-30.
			if (meta.userIsBornInDataset) {
				const firstT = userEvents[0]?.time;
				if (firstT) {
					const window14 = dayjs(firstT).add(14, "days").toISOString();
					const docUploads = userEvents.filter(
						(e) => e.event === "document uploaded" && e.time <= window14
					).length;
					if (docUploads < 3) {
						const cutoff = dayjs(firstT).add(30, "days");
						for (let i = userEvents.length - 1; i >= 0; i--) {
							if (
								dayjs(userEvents[i].time).isAfter(cutoff) &&
								chance.bool({ likelihood: 75 })
							) {
								userEvents.splice(i, 1);
							}
						}
					}
				}
			}

			// ─── Hook #9: END-OF-QUARTER RENEWAL SPIKE ───
			// Days 85-95 get 3x renewal clones + 2x coverage reviewed clones
			{
				const spikeStart = datasetStart.add(85, "days");
				const spikeEnd = datasetStart.add(95, "days");
				const clones = [];
				userEvents.forEach((e) => {
					const t = dayjs(e.time);
					if (t.isAfter(spikeStart) && t.isBefore(spikeEnd)) {
						if (e.event === "renewal completed") {
							for (let c = 0; c < 2; c++) {
								clones.push({
									...e,
									time: t
										.add(
											chance.integer({ min: 5, max: 240 }),
											"minutes"
										)
										.toISOString(),
									insert_id: chance.guid(),
								});
							}
						}
						if (e.event === "coverage reviewed") {
							clones.push({
								...e,
								time: t
									.add(
										chance.integer({ min: 5, max: 120 }),
										"minutes"
									)
									.toISOString(),
								insert_id: chance.guid(),
							});
						}
					}
				});
				if (clones.length) userEvents.push(...clones);
			}

			// ─── Hook #1: VERSION STAMPING ───
			// Runs LAST: stamps app_version based on FINAL timestamps
			// (after Hook #5 TTC scaling has adjusted event times).
			// v2.10 (days 0-30) → v2.11 (30-60) → v2.12 (60-90) → v2.13 (last 10 days)
			for (const evt of userEvents) {
				const eventTime = dayjs(evt.time);
				if (eventTime.isBefore(V211_DATE)) {
					evt.app_version = "2.10";
				} else if (eventTime.isBefore(V212_DATE)) {
					evt.app_version = "2.11";
				} else if (eventTime.isBefore(V213_DATE)) {
					evt.app_version = "2.12";
				} else {
					evt.app_version = "2.13";
				}
			}

			// Sort events by time after injection/removal/shifting
			userEvents.sort(
				(a, b) => new Date(a.time) - new Date(b.time)
			);

			return record;
		}

		return record;
	},
};

export default config;
