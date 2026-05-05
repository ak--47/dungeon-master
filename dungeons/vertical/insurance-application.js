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
 * ANALYTICS HOOKS (5 hooks)
 *
 * Adds 5. APPLICATION COMPLETION TIME-TO-CONVERT: business 0.74x faster,
 * family 1.3x slower (everything hook). Discover via TTC breakdown by account_type.
 * Measured via cross-event SQL (application started → application approved).
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
	 * ARCHITECTED ANALYTICS HOOKS
	 *
	 * This hook function creates 5 deliberate patterns in the data:
	 *
	 * 1. VERSION STAMPING (everything): Every event gets a deterministic app_version
	 *    based on its final timestamp. v2.10 → v2.11 → v2.12 → v2.13.
	 *    All users shift simultaneously on release dates. Uses the everything
	 *    hook (not event hook) because funnel events adjust time after the
	 *    event hook runs.
	 *
	 * 2. SUPPORT TICKET VOLUME (everything): Pre-v2.13 period has inflated
	 *    support ticket volume (2-3 extra tickets per user with bug-related
	 *    categories). Post-v2.13, tickets are progressively removed — creating
	 *    a clear volume drop that trends downward.
	 *
	 * 3. APPLICATION CONVERSION BOOST (everything): Pre-v2.13, ~40% of
	 *    application approved and policy activated events are removed,
	 *    lowering the effective funnel conversion rate. Post-v2.13 events
	 *    are left intact, making the conversion visibly jump up.
	 */
	hook: function (record, type, meta) {
		// =============================================================
		// All hooks run in the "everything" hook. Hook #5 (TTC scaling)
		// runs first since it modifies timestamps; Hook #1 (version
		// stamping) runs LAST so versions reflect final timestamps.
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
