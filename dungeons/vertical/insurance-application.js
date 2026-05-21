// ── IMPORTS ──
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);
import "dotenv/config";
import * as u from "../../lib/utils/utils.js";
/** @typedef {import("../../types").Dungeon} Config */

// ── OVERVIEW ──
/*
 * NAME:       SafeHaven Insurance
 * APP:        Modern insurance web application. Users browse coverage options,
 *             request quotes, complete multi-step applications, manage policies,
 *             file claims, and make premium payments. Spans auto / home / life /
 *             health / renters insurance types across web, iOS, and Android.
 * SCALE:      15,000 users, ~1.8M events, 121 days (2026-01-01 → 2026-05-01)
 * CORE LOOP:  account created → quote requested → application submitted → policy activated → payment made
 *
 * EVENTS (18):
 *   page viewed (10) > application step completed (6) > quote requested (5)
 *   > payment made (5) > quote received (4) > application started (4)
 *   > claim status checked (4) > support ticket created (4) > coverage reviewed (4)
 *   > document uploaded (3) > application submitted (3) > support ticket resolved (3)
 *   > application approved (2) > policy activated (2) > claim filed (2)
 *   > profile updated (2) > renewal completed (2) > account created (1)
 *
 * FUNNELS (5):
 *   - Onboarding:             account created → page viewed → quote requested (85%)
 *   - Application Completion: application started → step completed → document uploaded → application submitted (60%)
 *   - Application Approval:   application submitted → application approved → policy activated (70%)
 *   - Claims Process:         claim filed → claim status checked → support ticket created (50%, A/B experiment)
 *   - Policy Renewal:         coverage reviewed → payment made → renewal completed (65%)
 *
 * USER PROPS:  Platform, insurance_type, app_version, age_range, risk_profile, policy_count, lifetime_premium, preferred_contact
 * SUPER PROPS: Platform, insurance_type, app_version
 * SCD PROPS:   policy_status (pending/active/lapsed/renewed, monthly fuzzy, max 8)
 * GROUPS:      none
 */

// ── HOOK STORIES ──
/*
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

// ── SCALE ──
const SEED = "dm4-insurance";
const NUM_USERS = 15_000;
const DATASET_START = "2026-01-01T00:00:00Z";
const DATASET_END = "2026-05-01T23:59:59Z";
const EVENTS_PER_DAY = 1.2;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── KNOBS (tweak these to reshape stories) ──
// H1: Version stamping cutoffs (days from datasetStart / before datasetEnd)
const V211_DAY = 30;
const V212_DAY = 60;
const V213_DAYS_BEFORE_END = 10;

// H2: Support ticket volume
const TICKET_INJECT_MIN = 2;
const TICKET_INJECT_MAX = 3;
const TICKET_REMOVAL_BASE_PCT = 30;
const TICKET_REMOVAL_PER_DAY_PCT = 5.5;
const TICKET_REMOVAL_CAP_PCT = 85;

// H3: Application conversion boost
const PRE_V213_APPROVAL_DROP_LIKELIHOOD = 95;

// H4: Application-step magic number
const STEP_SWEET_MIN = 8;
const STEP_SWEET_MAX = 14;
const STEP_OVER_THRESHOLD = 15;
const STEP_PREMIUM_BOOST = 1.35;
const STEP_OVER_DROP_LIKELIHOOD = 40;

// H5: Application TTC target offsets (hours from first application started)
const TTC_BUSINESS_HOURS = 36;
const TTC_INDIVIDUAL_HOURS = 48;
const TTC_FAMILY_HOURS = 63;

// H7: Risk profile approval multipliers
const RISK_LOW_CONV_MULT = 1.8;
const RISK_HIGH_CONV_MULT = 0.3;
const RISK_CONV_CAP = 95;

// H8: Document upload retention
const DOC_RETENTION_MIN = 3;
const DOC_RETENTION_WINDOW_DAYS = 14;
const DOC_RETENTION_CUTOFF_DAYS = 30;
const DOC_RETENTION_DROP_LIKELIHOOD = 75;

// H9: End-of-quarter renewal spike (days from datasetStart)
const RENEWAL_SPIKE_START_DAY = 85;
const RENEWAL_SPIKE_END_DAY = 95;
const RENEWAL_CLONE_COUNT = 2;       // 2 extra clones per renewal → 3x volume
const COVERAGE_CLONE_COUNT = 1;      // 1 extra clone per coverage review → 2x volume

// H10: Claim-to-premium increase
const POST_CLAIM_PREMIUM_MULT = 2.0;

// ── HOOK STATE ──
// H10 closure: tracks users who filed a claim (one-shot consumption)
const claimFilers = new Map();

// ── HELPER FUNCTIONS ──
function handleFunnelPreHooks(record, meta) {
	// H7: RISK PROFILE AFFECTS APPROVAL — low-risk 1.8x, high-risk 0.3x conversion
	const isApprovalFunnel = meta.funnel?.sequence?.includes("application approved");
	if (isApprovalFunnel) {
		const risk = meta.profile?.risk_profile;
		if (risk === "low") record.conversionRate = Math.min(RISK_CONV_CAP, Math.round(record.conversionRate * RISK_LOW_CONV_MULT));
		else if (risk === "high") record.conversionRate = Math.round(record.conversionRate * RISK_HIGH_CONV_MULT);
	}
	return record;
}

function handleEventHooks(record) {
	// H10: CLAIM-TO-PREMIUM INCREASE — premium doubled on first payment after claim
	if (record.event === "claim filed") {
		claimFilers.set(record.user_id, true);
	}
	if (record.event === "payment made" && claimFilers.has(record.user_id)) {
		record.premium_amount = Math.round((record.premium_amount || 500) * POST_CLAIM_PREMIUM_MULT);
		claimFilers.delete(record.user_id);
	}
	return record;
}

function handleEverythingHooks(record, meta) {
	const datasetStart = dayjs.unix(meta.datasetStart);
	const datasetEnd = dayjs.unix(meta.datasetEnd);
	const V211_DATE = datasetStart.add(V211_DAY, "days");
	const V212_DATE = datasetStart.add(V212_DAY, "days");
	const V213_DATE = datasetEnd.subtract(V213_DAYS_BEFORE_END, "days");
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
				userAccountType === "business" ? TTC_BUSINESS_HOURS :
				userAccountType === "family" ? TTC_FAMILY_HOURS :
				TTC_INDIVIDUAL_HOURS
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
		const extraCount = chance.integer({ min: TICKET_INJECT_MIN, max: TICKET_INJECT_MAX });
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
					TICKET_REMOVAL_CAP_PCT,
					TICKET_REMOVAL_BASE_PCT + daysSinceRelease * TICKET_REMOVAL_PER_DAY_PCT
				);
				if (chance.bool({ likelihood: removalLikelihood })) {
					userEvents.splice(i, 1);
				}
			}
		}
	}

	// ─── Hook #3: APPLICATION CONVERSION BOOST ───
	// PRE-V2.13: Remove ALL application approved + policy activated events
	// for ~95% of users (per-user gating, not per-event). This produces
	// visible funnel completion gap pre-v2.13 vs post-v2.13.
	if (chance.bool({ likelihood: PRE_V213_APPROVAL_DROP_LIKELIHOOD })) {
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
	if (stepCount >= STEP_SWEET_MIN && stepCount <= STEP_SWEET_MAX) {
		userEvents.forEach(e => {
			if (e.event === "application approved" && typeof e.approved_premium === "number") {
				e.approved_premium = Math.round(e.approved_premium * STEP_PREMIUM_BOOST);
			}
		});
	} else if (stepCount >= STEP_OVER_THRESHOLD) {
		for (let i = userEvents.length - 1; i >= 0; i--) {
			if (userEvents[i].event === "application approved" && chance.bool({ likelihood: STEP_OVER_DROP_LIKELIHOOD })) {
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
			const window14 = dayjs(firstT).add(DOC_RETENTION_WINDOW_DAYS, "days").toISOString();
			const docUploads = userEvents.filter(
				(e) => e.event === "document uploaded" && e.time <= window14
			).length;
			if (docUploads < DOC_RETENTION_MIN) {
				const cutoff = dayjs(firstT).add(DOC_RETENTION_CUTOFF_DAYS, "days");
				for (let i = userEvents.length - 1; i >= 0; i--) {
					if (
						dayjs(userEvents[i].time).isAfter(cutoff) &&
						chance.bool({ likelihood: DOC_RETENTION_DROP_LIKELIHOOD })
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
		const spikeStart = datasetStart.add(RENEWAL_SPIKE_START_DAY, "days");
		const spikeEnd = datasetStart.add(RENEWAL_SPIKE_END_DAY, "days");
		const clones = [];
		userEvents.forEach((e) => {
			const t = dayjs(e.time);
			if (t.isAfter(spikeStart) && t.isBefore(spikeEnd)) {
				if (e.event === "renewal completed") {
					for (let c = 0; c < RENEWAL_CLONE_COUNT; c++) {
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
					for (let c = 0; c < COVERAGE_CLONE_COUNT; c++) {
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

// ── CONFIG ──
/** @type {Config} */
const config = {
	version: 2,
	token,
	seed: SEED,
	datasetStart: DATASET_START,
	datasetEnd: DATASET_END,
	avgEventsPerUserPerDay: EVENTS_PER_DAY,
	numUsers: NUM_USERS,
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
			isStrictEvent: false,
			properties: {
				coverage_level: ["basic", "standard", "premium"],
				estimated_premium: u.weighNumRange(30, 800, 0.3, 150),
			},
		},
		{
			event: "application step completed",
			weight: 6,
			isStrictEvent: false,
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
			isStrictEvent: false,
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
			isStrictEvent: false,
			properties: {
				approved_premium: u.weighNumRange(30, 800, 0.3, 150),
				approval_time_hours: u.weighNumRange(1, 72, 0.5, 24),
			},
		},
		{
			event: "policy activated",
			weight: 2,
			isStrictEvent: false,
			properties: {
				policy_term_months: [6, 12, 12, 12, 24],
				effective_date_offset_days: u.weighNumRange(0, 30, 0.5, 7),
			},
		},
		{
			event: "claim filed",
			weight: 2,
			isStrictEvent: false,
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
			isStrictEvent: false,
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
			isStrictEvent: false,
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
			isStrictEvent: false,
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
			isStrictEvent: false,
			properties: {
				renewal_premium: u.weighNumRange(30, 800, 0.3, 150),
				premium_change_pct: u.weighNumRange(-15, 20, 1, 3),
				auto_renewed: [true, true, false],
			},
		},
	],

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

	superProps: {
		Platform: ["web", "ios", "android"],
		insurance_type: ["auto", "home", "life", "health", "renters"],
		app_version: ["2.10"],
	},

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

	hook(record, type, meta) {
		if (type === "funnel-pre") return handleFunnelPreHooks(record, meta);
		if (type === "event") return handleEventHooks(record);
		if (type === "everything") return handleEverythingHooks(record, meta);
		return record;
	},
};

export default config;
