// ── IMPORTS ──
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);
import "dotenv/config";
import * as u from "@ak--47/dungeon-master/utils";
/** @typedef {import("../../../types").Dungeon} Config */

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
 *   - Event: All Events (or "application submitted" — high volume)
 *   - Measure: Total
 *   - Breakdown: "app_version"
 *   - Line chart by day
 *   - Expected: clean cutovers between versions, no overlap
 *   - NOTE: "page viewed" only fires inside the Onboarding funnel
 *     (funnel-member events are excluded from the random-event pool),
 *     so it is rare — use a high-volume event for this chart.
 *
 * REAL-WORLD ANALOGUE: Forced auto-update SaaS apps cut all users over
 * on release day, producing crisp version bands.
 *
 * -------------------------------------------------------------------
 * 2. SUPPORT TICKET VOLUME DROP (everything)
 * -------------------------------------------------------------------
 *
 * PATTERN: Pre-v2.13: each user gets 2-3 extra cloned support-ticket
 * created events stamped with bug-related issue_category values
 * (form_crash, login_error, page_timeout, payment_failure — part of the
 * declared issue_category value list). Post-v2.13: tickets progressively
 * removed (30% day 1 → 85% day 10, capped) AND surviving post-v2.13
 * tickets that carry a bug category are reassigned to a non-bug
 * category — the release fixed the bugs, so bug-category share drops to
 * EXACTLY ZERO after the release. No flag — discover via issue_category
 * breakdown over time.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Ticket Volume Over Time
 *   - Report type: Insights
 *   - Event: "support ticket created"
 *   - Measure: Total
 *   - Breakdown: "app_version"
 *   - Line chart by day
 *   - Expected: high volume on v2.12, sharp drop on v2.13 to ~0.3x the
 *     final-v2.12 rate (injection inflates pre-release ~1.7x organic;
 *     ramped removal keeps ~43% post-release)
 *
 *   Report 2: Bug Category Share Pre vs Post v2.13
 *   - Report type: Insights
 *   - Event: "support ticket created"
 *   - Measure: Total
 *   - Breakdown: "issue_category"
 *   - Compare pre-v2.13 vs v2.13 date ranges
 *   - Expected: form_crash / login_error / page_timeout / payment_failure
 *     hold ~67% share pre-v2.13 (organic 4/9 uniform share plus the
 *     all-bug injections) and are EXACTLY ZERO post-v2.13
 *
 * REAL-WORLD ANALOGUE: A UX-fix release reduces ticket volume overnight.
 *
 * -------------------------------------------------------------------
 * 3. ACTIVATION GAP FIXED BY v2.13 (everything)
 * -------------------------------------------------------------------
 *
 * PATTERN: Pre-v2.13: ~95% of users have ALL their pre-release
 * "policy activated" events dropped (per-user gating). Post-v2.13: kept.
 * Deliberately does NOT touch "application approved": Hook #5 pins every
 * approved event to firstStart + 36-63h, which lands almost all of them
 * early in the dataset regardless of when the funnel instance ran —
 * dropping relocated approvals pre-v2.13 would leave no post-v2.13
 * approvals to step up and starve Hook #5's TTC cohort. The era signal
 * lives on "policy activated" alone: approvals went through the whole
 * time, but the activation step was broken until v2.13 shipped.
 * No flag — discover via volume line chart or per-era conversion.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Activation Volume Over Time
 *   - Report type: Insights
 *   - Event: "policy activated"
 *   - Measure: Total, line chart by day
 *   - Expected: near-flatline pre-v2.13 (~5% survives), then a massive
 *     step-up on release day — ~28x the pre-release daily rate
 *     (1/0.05 = 20x from the gate, amplified by organic late-dataset
 *     activity drift)
 *
 *   Report 2: Submit → Activate Conversion by Era
 *   - Report type: Funnels
 *   - Steps: "application submitted" -> "policy activated"
 *   - Breakdown: "app_version" (or compare date ranges)
 *   - Expected: pre-v2.13 users convert ~4%, post-v2.13 ~50% — a
 *     ~12x step-up (below the 20x volume gate because the 111-day
 *     pre-era gives survivors far more chances to show an activation
 *     than the 10-day post-era window)
 *
 * REAL-WORLD ANALOGUE: Policy issuance succeeded but the activation
 * step silently failed for nearly everyone until the v2.13 fix.
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
 *   Report 2: Approvals per Submitted Application on Heavy Step-Completers
 *   - Report type: Insights (with cohort, formula)
 *   - Cohort C: users with >= 15 "application step completed"
 *   - Cohort A: users with 8-14
 *   - Formula: total "application approved" / total "application submitted"
 *   - Expected: C ~ 0.5x A. The knob is a 40% approval drop (0.6x), but
 *     raw approvals-per-USER hides it: 15+ steppers are hyperactive and
 *     organically earn ~2x the approvals. Normalizing by submitted
 *     applications exposes the drop; the observed ratio sits slightly
 *     below 0.6 because heavy steppers' submit mix skews toward
 *     Application Completion conversions, diluting their denominator.
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
 *   - Expected: business ~37h < individual ~50h < family ~65h medians
 *     (target + 0-4h jitter); ratios ~0.75x / 1.0x / ~1.30x
 *   - NOTE: account_type is stamped only on "account created" events,
 *     which only born-in-dataset users have — pre-existing users' gaps
 *     are engineered identically but show as (not set) in the breakdown.
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
 * OBSERVABLE MAGNITUDE: the Application Approval funnel's base
 * conversionRate is 70%, so per-instance rates land at
 * low = min(95, round(70x1.8)) = 95%, medium = 70%,
 * high = round(70x0.3) = 21%. But non-converting instances still take
 * a uniform 1..(steps-1) partial walk (determineConversion,
 * lib/generators/funnels.js:527-534), so step 2 ("application
 * approved") fires with probability p = c + (1-c)/2 — 0.975 / 0.85 /
 * 0.605 — compressing the visible approvals-per-submit ratios to
 * ~1.15x (low/med) and ~0.71x (high/med) instead of the naive
 * 1.8x / 0.3x knob values.
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
 *   - Expected: ~2x volume during days 85-95 (reads slightly under 2x
 *     against a local-day baseline — the Mar 27-Apr 5 window is
 *     weekend-heavy, depressing the organic in-window rate)
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
 *   - Expected: each DOUBLED payment is 2.0x its organic value, but
 *     only the first payment after each claim doubles — with claims and
 *     payments interleaving, roughly half of a claimant's payments get
 *     doubled, so the cohort-average ratio reads ~1.5x, not 2.0x.
 *   - Signature: organic premium_amount caps at 600, so ANY payment
 *     above 600 is claim-inflated. Non-claimants have exactly zero
 *     payments above 600, up to two rare orphan paths where the claim
 *     is removed AFTER the event hook already consumed the Map:
 *     (a) Hook #8 churn deletion (born non-uploaders), excluded from
 *     the verification population, and (b) the engine's unconditional
 *     future-time guard — the event hook fires in GENERATION order,
 *     not time order, so a claim generated past dataset end doubles
 *     the next-generated payment and is then dropped by the guard
 *     (~1 user in 15K at full fidelity). Claimants have thousands.
 *
 * REAL-WORLD ANALOGUE: Insurance premiums increase after filing a claim.
 *
 * ===================================================================
 * EXPECTED METRICS SUMMARY (mechanism → measured at full fidelity)
 * ===================================================================
 *
 * Story id | Metric                                    | Expected      | Measured (15K users, 1.98M events)
 * ---------|-------------------------------------------|---------------|---------
 * H1       | events with wrong version for timestamp   | 0 (exact)     | 0 of 1,976,808
 * H1       | device-only / null-uid events             | 0 (exact)     | 0 / 0 (born share 0.121)
 * H2       | bug-category ticket share pre-v2.13       | ~0.67         | 0.669
 * H2       | bug-category ticket share post-v2.13      | 0 (exact)     | 0 of 2,660
 * H2       | ticket rate v2.13 / last-10d-of-v2.12     | ~0.25-0.35    | 0.289
 * H3       | activations/day post / pre release        | ~20-30x       | 26.5x
 * H3       | submit→activate user conversion post/pre  | ~9-16x        | 11.2x (0.045 → 0.499)
 * H4       | sweet(8-14) / base(0-7) avg premium       | 1.35x         | 1.339x
 * H4       | over(15+) / sweet approvals-per-submit    | ~0.5-0.6x     | 0.523x
 * H5       | TTC medians biz/indiv/family (hours)      | ~37 / ~50 / ~65 | 37.8 / 49.8 / 64.8
 * H5       | TTC ratios biz/indiv, family/indiv        | ~0.75 / ~1.30 | 0.758 / 1.301
 * H6       | variant split, pre-start exposures        | ~50/50, 0     | 410/371 (0.475), 0
 * H6       | simplified/control claims completion      | ~1.3-1.4x     | 1.382x
 * H7       | low/med approvals-per-submit              | ~1.15x        | 1.166x
 * H7       | high/med approvals-per-submit             | ~0.71x        | 0.697x
 * H8       | churn DiD (nonup post/pre ÷ up post/pre)  | ~0.25-0.30    | 0.321 (sep 3.11x; n=218/40)
 * H9       | renewals in spike / local base            | 3.0x          | 3.059x
 * H9       | coverage reviews in spike / local base    | ~1.8-2.0x     | 1.781x
 * H10      | claimant / non-claimant avg premium       | ~1.5x         | 1.391x
 * H10      | non-claimant payments > 600 (untouched)   | 0 (exact)     | 1 (future-time-guard orphan; ≤2 STRONG)
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

// H2: issue_category split. Bug categories are part of the declared
// issue_category value list (schema rule: hooks only modify existing
// props), so organic tickets pick them ~4/9 of the time. Post-v2.13 the
// hook reassigns surviving tickets' bug categories to non-bug values —
// the release fixed the bugs, so bug-category share drops to exactly 0.
const BUG_CATEGORIES = ["form_crash", "login_error", "page_timeout", "payment_failure"];
const NONBUG_CATEGORIES = ["billing", "claims", "coverage", "technical", "policy_change"];

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
	// UTC mode is load-bearing: dayjs.unix() returns a LOCAL-mode instance, and
	// local .add(N, "days") does calendar-day arithmetic — it slips 1h across the
	// March 8 2026 DST spring-forward, making every derived day boundary past
	// early March (the H9 spike window, H8 per-user retention windows) land an
	// hour off and — worse — depend on the host machine's timezone, breaking the
	// seeded-determinism contract. All day arithmetic below must stay UTC-mode.
	const datasetStart = dayjs.unix(meta.datasetStart).utc();
	const datasetEnd = dayjs.unix(meta.datasetEnd).utc();
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
				issue_category: chance.pickone(BUG_CATEGORIES),
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
				} else if (BUG_CATEGORIES.includes(evt.issue_category)) {
					// v2.13 fixed the bugs: surviving post-release tickets can't
					// be about them. Reassign to a non-bug category so the
					// pre/post issue_category breakdown shows bug categories
					// vanishing to exactly zero (see HOOK STORIES #2).
					evt.issue_category = chance.pickone(NONBUG_CATEGORIES);
				}
			}
		}
	}

	// ─── Hook #3: APPLICATION CONVERSION BOOST (activation gap) ───
	// PRE-V2.13: Remove policy activated events for ~95% of users (per-user
	// gating, not per-event). Produces a visible submitted → activated funnel
	// gap pre-v2.13 vs post-v2.13.
	//
	// Deliberately does NOT touch "application approved": Hook #5 pins every
	// approved event to firstStart + 36-63h, which lands almost all of them
	// pre-v2.13 in time regardless of when the funnel instance ran. Dropping
	// relocated approvals here would (a) leave no post-v2.13 approvals to
	// step up — inverting this story — and (b) starve Hook #5's TTC cohort.
	// The era signal therefore lives on policy activated alone: "approvals
	// went through, but the activation step was broken until v2.13".
	if (chance.bool({ likelihood: PRE_V213_APPROVAL_DROP_LIKELIHOOD })) {
		for (let i = userEvents.length - 1; i >= 0; i--) {
			const evt = userEvents[i];
			if (
				evt.event === "policy activated" &&
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
			// dayjs.utc: local-mode .add(N, "days") slips 1h across the March DST
			// spring-forward for users whose window straddles it (see header note).
			const window14 = dayjs.utc(firstT).add(DOC_RETENTION_WINDOW_DAYS, "days").toISOString();
			const docUploads = userEvents.filter(
				(e) => e.event === "document uploaded" && e.time <= window14
			).length;
			if (docUploads < DOC_RETENTION_MIN) {
				const cutoff = dayjs.utc(firstT).add(DOC_RETENTION_CUTOFF_DAYS, "days");
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
		hasAndroidDevices: true,
		hasIOSDevices: true,
		hasDesktopDevices: true,
		hasBrowser: false,
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

// ── STORIES (machine-checkable contract; evaluate with scripts/verify-stories.mjs) ──
/*
 * STORY DOCTRINE (insurance-application)
 *
 * LITERAL WINDOW: this dungeon pins epochStart/epochEnd to literal dates
 * (2026-01-01 → 2026-05-01T23:59:59Z) with no forward shift, so all
 * day-index arithmetic runs off DATE '2026-01-01' (day_idx 0-120) and
 * version boundaries are exact timestamps:
 *   v2.11 @ 2026-01-31 00:00:00  (start + 30d)
 *   v2.12 @ 2026-03-02 00:00:00  (start + 60d)
 *   v2.13 @ 2026-04-21 23:59:59  (end − 10d — end is 23:59:59, so this
 *                                 boundary is NOT midnight; every era
 *                                 split below uses the exact timestamp)
 * Pre-era = 111.0 days, post-era = 10.0 days, exactly.
 *
 * IDENTITY: "account created" is isFirstEvent + isAuthEvent, so identity
 * stitches on the very first event — every event carries user_id and
 * there are ZERO device-only events (asserted). avgDevicePerUser: 2 only
 * populates profile device pools ("anonymousIds").
 *
 * POPULATION RESTRICTION: H8 deletes 75% of post-day-30 events for
 * born-in non-uploaders, corrupting per-user counts for that cohort.
 * Reads that depend on undistorted per-user tallies (H4 step buckets,
 * H10 exact signature) restrict to the H8-untouched population:
 * (NOT born) OR uploader.
 *
 * H5 RELOCATION CAVEAT: H5 pins every "application approved" to
 * firstStart + {36,48,63}h (+0-4h jitter), so approvals cluster near
 * each user's start regardless of funnel-instance timing. Any read that
 * assumes approvals are era-distributed must account for this (H3
 * deliberately keys its era signal on "policy activated" instead).
 *
 * BAND DOCTRINE: NAILED bands center on mechanism numbers derived from
 * the knobs (with derivations in each narrative); reduced-scale
 * measurements (2K users, iter-ins-2) confirm placement but do not
 * define the centers. Cohort guards sized for full fidelity (15K users,
 * ~2M events) — reduced-scale runs hit scale-cap WEAKs on H6/H8.
 */

const STORY_START_DATE = "2026-01-01";
// Exact era boundaries (see doctrine): derived from DATASET_START/END + knobs.
const V213_TS = "2026-04-21 23:59:59"; // end (2026-05-01 23:59:59) − V213_DAYS_BEFORE_END
const EXP_START_TS = "2026-03-27 23:59:59"; // end − 35d (config-validator normalizeExperiments: startUnix = endUnix − startDays·86400)
const PRE_ERA_DAYS = 111.0;
const POST_ERA_DAYS = 10.0;

const ID_CTE = `
us AS (SELECT distinct_id::VARCHAR AS duid, risk_profile
       FROM read_json_auto('{{PREFIX}}-USERS*.json', sample_size=-1, union_by_name=true)),
ev AS (SELECT e.user_id::VARCHAR AS uid, e.device_id::VARCHAR AS did, e.time::TIMESTAMP AS t,
       date_diff('day', DATE '${STORY_START_DATE}', e.time::TIMESTAMP::DATE) AS day_idx, e.*
FROM read_json_auto('{{PREFIX}}-EVENTS*.json', sample_size=-1, union_by_name=true) e)`;

const PU_CTE = `
pu AS (SELECT uid, min(t) AS first_t,
  count(*) FILTER (WHERE event = 'account created') AS acct_created,
  count(*) FILTER (WHERE event = 'application step completed') AS steps,
  count(*) FILTER (WHERE event = 'application approved') AS approvals,
  count(*) FILTER (WHERE event = 'application submitted') AS submits,
  count(*) FILTER (WHERE event = 'claim filed') AS claims,
  count(*) FILTER (WHERE event = 'payment made') AS payments
FROM ev GROUP BY 1),
puu AS (SELECT p.*, p.acct_created > 0 AS born,
  ((SELECT count(*) FROM ev e WHERE e.uid = p.uid AND e.event = 'document uploaded'
      AND e.t <= p.first_t + INTERVAL '${DOC_RETENTION_WINDOW_DAYS} days') >= ${DOC_RETENTION_MIN}) AS uploader
FROM pu p),
h4pop AS (SELECT * FROM puu WHERE (NOT born) OR uploader)`;

const cellsOf = (rows, key) => Object.fromEntries((rows || []).map((r) => [r[key], r]));

export const stories = [
	{
		id: "H1-version-bands",
		hook: "H1",
		archetype: "composition-drift",
		narrative:
			"Every event's app_version is a pure function of its timestamp (v2.10/2.11/2.12/2.13 " +
			"bands). Exact invariant: ZERO events whose version disagrees with their timestamp's " +
			"band — including the non-midnight v2.13 boundary at 2026-04-21 23:59:59 (t >= boundary " +
			"stamps 2.13, matching the hook's comparison). Also carries the identity invariants: " +
			"auth-on-first-event means user_id on every event, no device-only rows, exactly one " +
			"account created per born user.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT count(*) FILTER (WHERE app_version != CASE
    WHEN t < TIMESTAMP '2026-01-31 00:00:00' THEN '2.10'
    WHEN t < TIMESTAMP '2026-03-02 00:00:00' THEN '2.11'
    WHEN t < TIMESTAMP '${V213_TS}' THEN '2.12'
    ELSE '2.13' END)::BIGINT AS violations,
  count(DISTINCT app_version)::BIGINT AS versions,
  count(*) FILTER (WHERE app_version = '2.13')::BIGINT AS v213_n,
  count(*)::BIGINT AS total
FROM ev`,
				},
				assert: (rows) => {
					const r = rows?.[0];
					if (!r || Number(r.total) < 100000) {
						return { verdict: "WEAK", detail: `event volume too small: total=${r?.total ?? 0}` };
					}
					const v = Number(r.violations);
					const detail = `version/timestamp violations=${v} of ${r.total} (versions=${r.versions}, v2.13 n=${r.v213_n})`;
					if (v === 0 && Number(r.versions) === 4 && Number(r.v213_n) > 0) return { verdict: "NAILED", detail };
					if (v <= Number(r.total) * 0.0005) return { verdict: "STRONG", detail };
					if (v <= Number(r.total) * 0.01) return { verdict: "WEAK", detail };
					return { verdict: "INVERSE", detail };
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${PU_CTE}
SELECT (SELECT count(*) FROM ev WHERE uid IS NULL)::BIGINT AS null_uid,
  (SELECT count(*) FROM ev WHERE uid IS NULL AND did IS NOT NULL)::BIGINT AS device_only,
  (SELECT count(*) FROM pu WHERE acct_created > 1)::BIGINT AS multi_acct,
  (SELECT count(*) FROM pu WHERE acct_created > 0)::BIGINT AS born_users,
  (SELECT count(*) FROM pu)::BIGINT AS total_users`,
				},
				assert: (rows) => {
					const r = rows?.[0];
					if (!r || Number(r.total_users) < 1500) {
						return { verdict: "WEAK", detail: `user volume too small: total_users=${r?.total_users ?? 0}` };
					}
					const share = Number(r.born_users) / Number(r.total_users);
					const clean = Number(r.null_uid) === 0 && Number(r.device_only) === 0 && Number(r.multi_acct) === 0;
					const detail = `null_uid=${r.null_uid} device_only=${r.device_only} multi_acct=${r.multi_acct} born_share=${share.toFixed(3)} (${r.born_users}/${r.total_users})`;
					if (clean && share >= 0.08 && share <= 0.16) return { verdict: "NAILED", detail };
					if (clean && share >= 0.06 && share <= 0.2) return { verdict: "STRONG", detail };
					if (clean) return { verdict: "WEAK", detail };
					return { verdict: "INVERSE", detail };
				},
			},
		],
	},
	{
		id: "H2-ticket-drop",
		hook: "H2",
		archetype: "temporal-inflection",
		narrative:
			"Pre-v2.13 all-bug injections (2-3/user) lift bug-category share from the organic 4/9 " +
			"(0.444, uniform 9-value pool) to (0.444·O + I)/(O + I) ≈ 0.67 at I/O ≈ 0.7. Post-v2.13 " +
			"the hook removes tickets on a 30%→85% ramp AND recategorizes surviving bug-category " +
			"tickets, so post bug share is EXACTLY ZERO. Volume: keep-rate avg ≈ 0.43 over the ramp " +
			"÷ ≈1.7x injection inflation ≈ 0.25 mechanism; organic late-dataset drift lifts the " +
			"observed ratio (0.31 measured at 2K).",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT count(*) FILTER (WHERE issue_category IN ('form_crash','login_error','page_timeout','payment_failure')
    AND t >= TIMESTAMP '${V213_TS}')::BIGINT AS bug_post_n,
  avg((issue_category IN ('form_crash','login_error','page_timeout','payment_failure'))::INT)
    FILTER (WHERE t < TIMESTAMP '${V213_TS}') AS bug_share_pre,
  count(*) FILTER (WHERE t < TIMESTAMP '${V213_TS}')::BIGINT AS n_pre,
  count(*) FILTER (WHERE t >= TIMESTAMP '${V213_TS}')::BIGINT AS n_post
FROM ev WHERE event = 'support ticket created'`,
				},
				assert: (rows) => {
					const r = rows?.[0];
					if (!r || Number(r.n_pre) < 8000 || Number(r.n_post) < 250) {
						return { verdict: "WEAK", detail: `ticket volume too small: pre=${r?.n_pre ?? 0} post=${r?.n_post ?? 0}` };
					}
					const pre = Number(r.bug_share_pre), post = Number(r.bug_post_n);
					const detail = `bug share pre=${pre.toFixed(3)} (mechanism ~0.67), post bug tickets=${post} of ${r.n_post} (expect exactly 0)`;
					if (post === 0 && pre >= 0.62 && pre <= 0.72) return { verdict: "NAILED", detail };
					if (post <= 2 && pre >= 0.55 && pre <= 0.78) return { verdict: "STRONG", detail };
					if (pre > 0.5 && post < Number(r.n_post) * 0.2) return { verdict: "WEAK", detail };
					return { verdict: "INVERSE", detail };
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT count(*) FILTER (WHERE day_idx BETWEEN 101 AND 110)::BIGINT AS n_last10,
  count(*) FILTER (WHERE day_idx BETWEEN 111 AND 120)::BIGINT AS n_v213
FROM ev WHERE event = 'support ticket created'`,
				},
				assert: (rows) => {
					const r = rows?.[0];
					if (!r || Number(r.n_last10) < 700 || Number(r.n_v213) < 200) {
						return { verdict: "WEAK", detail: `ticket volume too small: last10=${r?.n_last10 ?? 0} v213=${r?.n_v213 ?? 0}` };
					}
					const ratio = Number(r.n_v213) / Number(r.n_last10);
					const detail = `ticket rate v2.13/last-10d-of-v2.12=${ratio.toFixed(3)} (mechanism ~0.25 keep÷inflation; n=${r.n_v213}/${r.n_last10})`;
					if (ratio >= 0.22 && ratio <= 0.4) return { verdict: "NAILED", detail };
					if (ratio >= 0.16 && ratio <= 0.5) return { verdict: "STRONG", detail };
					if (ratio < 0.7) return { verdict: "WEAK", detail };
					return { verdict: "INVERSE", detail };
				},
			},
		],
	},
	{
		id: "H3-activation-gap",
		hook: "H3",
		archetype: "temporal-inflection",
		narrative:
			"Pre-v2.13, 95% of users lose ALL pre-release 'policy activated' events; approvals are " +
			"untouched (H5 pins them near each user's start — see doctrine). Volume mechanism: " +
			"1/0.05 = 20x step-up, amplified by organic late-dataset drift (submits drift ~1.13x " +
			"over the final 20 days; whole-era average sits further below the end-state) → ~28x " +
			"measured. Per-user era conversion (submit→activate within era) compresses below 20x " +
			"because the 111-day pre-era gives surviving activations far more exposure than the " +
			"10-day post-era: ~4% pre vs ~50% post ≈ 12x.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT count(*) FILTER (WHERE t < TIMESTAMP '${V213_TS}')::BIGINT AS pre_n,
  count(*) FILTER (WHERE t >= TIMESTAMP '${V213_TS}')::BIGINT AS post_n
FROM ev WHERE event = 'policy activated'`,
				},
				assert: (rows) => {
					const r = rows?.[0];
					if (!r || Number(r.post_n) < 800 || Number(r.pre_n) < 300) {
						return { verdict: "WEAK", detail: `activation volume too small: pre=${r?.pre_n ?? 0} post=${r?.post_n ?? 0}` };
					}
					const ratio = (Number(r.post_n) / POST_ERA_DAYS) / (Number(r.pre_n) / PRE_ERA_DAYS);
					const detail = `activations/day post/pre=${ratio.toFixed(1)}x (mechanism 20x gate x organic drift; n=${r.post_n}/${r.pre_n})`;
					if (ratio >= 20 && ratio <= 36) return { verdict: "NAILED", detail };
					if (ratio >= 14 && ratio <= 48) return { verdict: "STRONG", detail };
					if (ratio >= 5) return { verdict: "WEAK", detail };
					return { verdict: ratio <= 1 ? "INVERSE" : "NONE", detail };
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT
  (SELECT avg((EXISTS (SELECT 1 FROM ev a WHERE a.uid = s.uid AND a.event = 'policy activated' AND a.t < TIMESTAMP '${V213_TS}'))::INT)
   FROM (SELECT DISTINCT uid FROM ev WHERE event = 'application submitted' AND t < TIMESTAMP '${V213_TS}') s) AS pre_conv,
  (SELECT avg((EXISTS (SELECT 1 FROM ev a WHERE a.uid = s.uid AND a.event = 'policy activated' AND a.t >= TIMESTAMP '${V213_TS}'))::INT)
   FROM (SELECT DISTINCT uid FROM ev WHERE event = 'application submitted' AND t >= TIMESTAMP '${V213_TS}') s) AS post_conv,
  (SELECT count(DISTINCT uid) FROM ev WHERE event = 'application submitted' AND t < TIMESTAMP '${V213_TS}')::BIGINT AS pre_submitters,
  (SELECT count(DISTINCT uid) FROM ev WHERE event = 'application submitted' AND t >= TIMESTAMP '${V213_TS}')::BIGINT AS post_submitters`,
				},
				assert: (rows) => {
					const r = rows?.[0];
					if (!r || Number(r.pre_submitters) < 1200 || Number(r.post_submitters) < 1000) {
						return { verdict: "WEAK", detail: `submitter cohorts too small: pre=${r?.pre_submitters ?? 0} post=${r?.post_submitters ?? 0}` };
					}
					const pre = Number(r.pre_conv), post = Number(r.post_conv);
					const ratio = post / pre;
					const detail = `submit→activate user conversion pre=${pre.toFixed(3)} post=${post.toFixed(3)} ratio=${ratio.toFixed(1)}x (era-window compressed; n=${r.pre_submitters}/${r.post_submitters})`;
					if (ratio >= 9 && ratio <= 16) return { verdict: "NAILED", detail };
					if (ratio >= 6 && ratio <= 22) return { verdict: "STRONG", detail };
					if (ratio >= 3) return { verdict: "WEAK", detail };
					return { verdict: ratio <= 1 ? "INVERSE" : "NONE", detail };
				},
			},
		],
	},
	{
		id: "H4-step-magic",
		hook: "H4",
		archetype: "frequency-sweet-spot",
		narrative:
			"Sweet-spot users (8-14 'application step completed') get approved_premium x1.35; " +
			"over-engaged (15+) lose 40% of approvals. Population restricted to H8-untouched users " +
			"(doctrine) so step tallies are undistorted. The over-drop read normalizes approvals by " +
			"submitted applications — raw per-user approvals are activity-confounded (15+ steppers " +
			"organically earn ~2x approvals, measured raw ratio 0.77 vs normalized 0.53). Normalized " +
			"mechanism: 0.6 x selection factor ~0.8-1.0 (heavy steppers' submit mix skews toward " +
			"Application Completion conversions, inflating their denominator).",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${PU_CTE}
SELECT
  (SELECT avg(e.approved_premium) FROM ev e JOIN h4pop p ON e.uid = p.uid
     WHERE e.event = 'application approved' AND p.steps BETWEEN ${STEP_SWEET_MIN} AND ${STEP_SWEET_MAX}) AS sweet_avg,
  (SELECT avg(e.approved_premium) FROM ev e JOIN h4pop p ON e.uid = p.uid
     WHERE e.event = 'application approved' AND p.steps < ${STEP_SWEET_MIN}) AS base_avg,
  (SELECT count(*) FROM h4pop WHERE steps BETWEEN ${STEP_SWEET_MIN} AND ${STEP_SWEET_MAX})::BIGINT AS sweet_users,
  (SELECT count(*) FROM h4pop WHERE steps < ${STEP_SWEET_MIN})::BIGINT AS base_users`,
				},
				assert: (rows) => {
					const r = rows?.[0];
					if (!r || Number(r.sweet_users) < 500 || Number(r.base_users) < 140) {
						return { verdict: "WEAK", detail: `step cohorts too small: sweet=${r?.sweet_users ?? 0} base=${r?.base_users ?? 0}` };
					}
					const ratio = Number(r.sweet_avg) / Number(r.base_avg);
					const detail = `sweet/base avg approved_premium=${ratio.toFixed(3)} (knob ${STEP_PREMIUM_BOOST}x; users=${r.sweet_users}/${r.base_users})`;
					if (ratio >= 1.27 && ratio <= 1.43) return { verdict: "NAILED", detail };
					if (ratio >= 1.18 && ratio <= 1.52) return { verdict: "STRONG", detail };
					if (ratio >= 1.08) return { verdict: "WEAK", detail };
					return { verdict: ratio <= 1 ? "INVERSE" : "NONE", detail };
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${PU_CTE}
SELECT
  (SELECT sum(approvals)::DOUBLE / nullif(sum(submits), 0) FROM h4pop WHERE steps >= ${STEP_OVER_THRESHOLD}) AS over_aps,
  (SELECT sum(approvals)::DOUBLE / nullif(sum(submits), 0) FROM h4pop WHERE steps BETWEEN ${STEP_SWEET_MIN} AND ${STEP_SWEET_MAX}) AS sweet_aps,
  (SELECT sum(submits) FROM h4pop WHERE steps >= ${STEP_OVER_THRESHOLD})::BIGINT AS over_submits,
  (SELECT sum(submits) FROM h4pop WHERE steps BETWEEN ${STEP_SWEET_MIN} AND ${STEP_SWEET_MAX})::BIGINT AS sweet_submits`,
				},
				assert: (rows) => {
					const r = rows?.[0];
					if (!r || Number(r.over_submits) < 10000 || Number(r.sweet_submits) < 8000) {
						return { verdict: "WEAK", detail: `submit volume too small: over=${r?.over_submits ?? 0} sweet=${r?.sweet_submits ?? 0}` };
					}
					const ratio = Number(r.over_aps) / Number(r.sweet_aps);
					const detail = `over/sweet approvals-per-submit=${ratio.toFixed(3)} (mechanism 0.6 x selection ~0.8-1.0; submits=${r.over_submits}/${r.sweet_submits})`;
					if (ratio >= 0.45 && ratio <= 0.66) return { verdict: "NAILED", detail };
					if (ratio >= 0.38 && ratio <= 0.75) return { verdict: "STRONG", detail };
					if (ratio < 0.85) return { verdict: "WEAK", detail };
					return { verdict: "INVERSE", detail };
				},
			},
		],
	},
	{
		id: "H5-ttc-account-type",
		hook: "H5",
		archetype: "funnel-ttc-by-segment",
		narrative:
			"Every 'application approved' is pinned to firstStart + {36,48,63}h by account_type " +
			"(djb2 hash of user_id) + jitter in [0,4h) — support is EXACTLY [target, target+4h). " +
			"Medians land at target + ~1-2h; ratios biz/indiv ≈ (36+j)/(48+j) ≈ 0.75, fam/indiv ≈ " +
			"(63+j)/(48+j) ≈ 1.30. account_type is only visible on born users' 'account created' " +
			"events, so the breakdown covers born users only (pre-existing users are engineered " +
			"identically but unlabeled).",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
acct AS (SELECT uid, min(account_type) AS account_type FROM ev WHERE event = 'account created' GROUP BY 1),
fs AS (SELECT uid, min(t) AS first_started FROM ev WHERE event = 'application started' GROUP BY 1),
gaps AS (SELECT a.account_type, e.uid, date_diff('second', f.first_started, e.t) / 3600.0 AS gap_h
  FROM ev e JOIN fs f ON e.uid = f.uid JOIN acct a ON e.uid = a.uid
  WHERE e.event = 'application approved')
SELECT account_type, count(*)::BIGINT AS n, count(DISTINCT uid)::BIGINT AS users, median(gap_h) AS med
FROM gaps GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "account_type");
					const b = by.business, i = by.individual, f = by.family;
					if (!b || !i || !f || Number(b.users) < 40 || Number(i.users) < 40 || Number(f.users) < 40) {
						return { verdict: "WEAK", detail: `account_type cohorts too small: biz=${b?.users ?? 0} indiv=${i?.users ?? 0} fam=${f?.users ?? 0}` };
					}
					const mb = Number(b.med), mi = Number(i.med), mf = Number(f.med);
					const detail = `median started→approved gap: biz=${mb.toFixed(1)}h indiv=${mi.toFixed(1)}h fam=${mf.toFixed(1)}h (targets ${TTC_BUSINESS_HOURS}/${TTC_INDIVIDUAL_HOURS}/${TTC_FAMILY_HOURS}+jitter; users=${b.users}/${i.users}/${f.users})`;
					const inBand = (m, t) => m >= t && m <= t + 4;
					if (inBand(mb, TTC_BUSINESS_HOURS) && inBand(mi, TTC_INDIVIDUAL_HOURS) && inBand(mf, TTC_FAMILY_HOURS)) {
						return { verdict: "NAILED", detail };
					}
					const near = (m, t) => m >= t - 1 && m <= t + 6;
					if (near(mb, TTC_BUSINESS_HOURS) && near(mi, TTC_INDIVIDUAL_HOURS) && near(mf, TTC_FAMILY_HOURS)) {
						return { verdict: "STRONG", detail };
					}
					if (mb < mi && mi < mf) return { verdict: "WEAK", detail };
					return { verdict: "INVERSE", detail };
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
acct AS (SELECT uid, min(account_type) AS account_type FROM ev WHERE event = 'account created' GROUP BY 1),
fs AS (SELECT uid, min(t) AS first_started FROM ev WHERE event = 'application started' GROUP BY 1),
gaps AS (SELECT a.account_type, e.uid, date_diff('second', f.first_started, e.t) / 3600.0 AS gap_h
  FROM ev e JOIN fs f ON e.uid = f.uid JOIN acct a ON e.uid = a.uid
  WHERE e.event = 'application approved')
SELECT account_type, count(DISTINCT uid)::BIGINT AS users, median(gap_h) AS med
FROM gaps GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "account_type");
					const b = by.business, i = by.individual, f = by.family;
					if (!b || !i || !f || Number(b.users) < 40 || Number(i.users) < 40 || Number(f.users) < 40) {
						return { verdict: "WEAK", detail: `account_type cohorts too small: biz=${b?.users ?? 0} indiv=${i?.users ?? 0} fam=${f?.users ?? 0}` };
					}
					const rb = Number(b.med) / Number(i.med), rf = Number(f.med) / Number(i.med);
					const detail = `TTC ratios biz/indiv=${rb.toFixed(3)} fam/indiv=${rf.toFixed(3)} (mechanism ~0.75 / ~1.30)`;
					if (rb >= 0.72 && rb <= 0.78 && rf >= 1.26 && rf <= 1.35) return { verdict: "NAILED", detail };
					if (rb >= 0.68 && rb <= 0.82 && rf >= 1.2 && rf <= 1.42) return { verdict: "STRONG", detail };
					if (rb < 1 && rf > 1) return { verdict: "WEAK", detail };
					return { verdict: "INVERSE", detail };
				},
			},
		],
	},
	{
		id: "H6-claims-experiment",
		hook: "H6",
		archetype: "experiment-lift",
		narrative:
			"Engine-native A/B on the Claims Process funnel (no hook code): variant = " +
			"quickHash(userId:expName) % 2 (weights default 1 → 50/50), $experiment_started fires " +
			"for every in-window instance and is gated on firstEventTime >= startUnix (end − 35d), " +
			"so ZERO exposures precede the boundary. Simplified Claims: conversionRate " +
			"min(100, round(50x1.3)) = 65 vs Control 50 → completion ratio mechanism 1.3, read via " +
			"ordered 3-step completion within 49h of each post-boundary 'claim filed' (49h ≈ 2x the " +
			"24h funnel TTC, covering the 0.8x-compressed Simplified support with less censoring " +
			"than a 25h read).",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT "Variant name" AS variant, count(*)::BIGINT AS exposures, count(DISTINCT uid)::BIGINT AS users,
  count(*) FILTER (WHERE t < TIMESTAMP '${EXP_START_TS}')::BIGINT AS early_n
FROM ev WHERE event = '$experiment_started' GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "variant");
					const c = by["Control"], s = by["Simplified Claims"];
					if (!c || !s || Number(c.users) + Number(s.users) < 300) {
						return { verdict: "WEAK", detail: `exposed users too few: control=${c?.users ?? 0} simplified=${s?.users ?? 0}` };
					}
					const early = Number(c.early_n) + Number(s.early_n);
					const share = Number(c.users) / (Number(c.users) + Number(s.users));
					const minority = Math.min(share, 1 - share);
					const detail = `variant users control=${c.users} simplified=${s.users} (minority share=${minority.toFixed(3)}); pre-start exposures=${early} (expect exactly 0)`;
					if (early === 0 && minority >= 0.44) return { verdict: "NAILED", detail };
					if (early === 0 && minority >= 0.4) return { verdict: "STRONG", detail };
					if (early === 0) return { verdict: "WEAK", detail };
					return { verdict: "INVERSE", detail };
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
expusers AS (SELECT uid, min("Variant name") AS variant FROM ev WHERE event = '$experiment_started'
  GROUP BY 1 HAVING count(DISTINCT "Variant name") = 1),
claimwin AS (SELECT c.uid,
  (EXISTS (SELECT 1 FROM ev s WHERE s.uid = c.uid AND s.event = 'claim status checked'
      AND s.t > c.t AND s.t <= c.t + INTERVAL 49 HOUR
      AND EXISTS (SELECT 1 FROM ev k WHERE k.uid = c.uid AND k.event = 'support ticket created'
          AND k.t > s.t AND k.t <= c.t + INTERVAL 49 HOUR))) AS completed
  FROM ev c WHERE c.event = 'claim filed' AND c.t >= TIMESTAMP '${EXP_START_TS}')
SELECT x.variant, count(*)::BIGINT AS instances, avg(w.completed::INT) AS completion
FROM claimwin w JOIN expusers x ON w.uid = x.uid GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "variant");
					const c = by["Control"], s = by["Simplified Claims"];
					if (!c || !s || Number(c.instances) < 700 || Number(s.instances) < 700) {
						return { verdict: "WEAK", detail: `claim instances too few: control=${c?.instances ?? 0} simplified=${s?.instances ?? 0}` };
					}
					const ratio = Number(s.completion) / Number(c.completion);
					const detail = `49h claims completion simplified/control=${ratio.toFixed(3)} (mechanism 1.3 = 65/50; instances=${s.instances}/${c.instances})`;
					if (ratio >= 1.15 && ratio <= 1.55) return { verdict: "NAILED", detail };
					if (ratio >= 1.05 && ratio <= 1.75) return { verdict: "STRONG", detail };
					if (ratio > 1) return { verdict: "WEAK", detail };
					return { verdict: "INVERSE", detail };
				},
			},
		],
	},
	{
		id: "H7-risk-approval",
		hook: "H7",
		archetype: "funnel-conversion-by-segment",
		narrative:
			"funnel-pre multiplies the Application Approval funnel's conversionRate (base 70): " +
			"low = min(95, round(70x1.8)) = 95, high = round(70x0.3) = 21, medium 70. " +
			"Non-converting instances still take a uniform 1..(steps-1) partial walk " +
			"(determineConversion, lib/generators/funnels.js:527-534), so step 2 fires with " +
			"p = c + (1-c)/2 → 0.975 / 0.85 / 0.605, compressing observable approvals-per-submit " +
			"ratios to low/med ≈ 1.147 and high/med ≈ 0.712 (NOT the naive 1.8/0.3). Submit " +
			"denominators include Application Completion conversions for all groups equally, " +
			"preserving the ratios.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${PU_CTE}
SELECT u.risk_profile, count(*)::BIGINT AS users,
  sum(p.approvals)::DOUBLE / nullif(sum(p.submits), 0) AS aps
FROM puu p JOIN us u ON p.uid = u.duid GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "risk_profile");
					const lo = by.low, md = by.medium;
					if (!lo || !md || Number(lo.users) < 400 || Number(md.users) < 400) {
						return { verdict: "WEAK", detail: `risk cohorts too small: low=${lo?.users ?? 0} med=${md?.users ?? 0}` };
					}
					const ratio = Number(lo.aps) / Number(md.aps);
					const detail = `low/med approvals-per-submit=${ratio.toFixed(3)} (mechanism 0.975/0.85=1.147; users=${lo.users}/${md.users})`;
					if (ratio >= 1.1 && ratio <= 1.25) return { verdict: "NAILED", detail };
					if (ratio >= 1.04 && ratio <= 1.35) return { verdict: "STRONG", detail };
					if (ratio > 1) return { verdict: "WEAK", detail };
					return { verdict: "INVERSE", detail };
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${PU_CTE}
SELECT u.risk_profile, count(*)::BIGINT AS users,
  sum(p.approvals)::DOUBLE / nullif(sum(p.submits), 0) AS aps
FROM puu p JOIN us u ON p.uid = u.duid GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "risk_profile");
					const hi = by.high, md = by.medium;
					if (!hi || !md || Number(hi.users) < 400 || Number(md.users) < 400) {
						return { verdict: "WEAK", detail: `risk cohorts too small: high=${hi?.users ?? 0} med=${md?.users ?? 0}` };
					}
					const ratio = Number(hi.aps) / Number(md.aps);
					const detail = `high/med approvals-per-submit=${ratio.toFixed(3)} (mechanism 0.605/0.85=0.712; users=${hi.users}/${md.users})`;
					if (ratio >= 0.65 && ratio <= 0.79) return { verdict: "NAILED", detail };
					if (ratio >= 0.57 && ratio <= 0.87) return { verdict: "STRONG", detail };
					if (ratio < 0.95) return { verdict: "WEAK", detail };
					return { verdict: "INVERSE", detail };
				},
			},
		],
	},
	{
		id: "H8-doc-retention",
		hook: "H8",
		archetype: "retention-divergence",
		narrative:
			"Born users with <3 'document uploaded' in their first 14 days lose 75% of events after " +
			"day 30 (post-day-30 keep-rate 0.25). Read as difference-in-differences: " +
			"(non-uploader post/pre event ratio) ÷ (uploader post/pre ratio) — the uploader arm " +
			"cancels organic trajectory. Mechanism 0.25 x organic-DiD ~0.8-1.5 → band [0.20, 0.38]. " +
			"Population: born before 2026-03-02 so a post-window exists. Cohorts are small even at " +
			"15K (~240 non-uploaders / ~45 uploaders): guards sized for full fidelity; reduced-scale " +
			"runs hit scale-cap WEAK.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${PU_CTE},
h8pop AS (SELECT p.*,
  (SELECT count(*) FROM ev e WHERE e.uid = p.uid AND e.t <= p.first_t + INTERVAL '${DOC_RETENTION_CUTOFF_DAYS} days') AS pre_n,
  (SELECT count(*) FROM ev e WHERE e.uid = p.uid AND e.t > p.first_t + INTERVAL '${DOC_RETENTION_CUTOFF_DAYS} days') AS post_n
FROM puu p WHERE p.born AND p.first_t < TIMESTAMP '2026-03-02')
SELECT
  (SELECT sum(post_n)::DOUBLE / nullif(sum(pre_n), 0) FROM h8pop WHERE NOT uploader) AS nonup_pp,
  (SELECT sum(post_n)::DOUBLE / nullif(sum(pre_n), 0) FROM h8pop WHERE uploader) AS up_pp,
  (SELECT count(*) FROM h8pop WHERE NOT uploader)::BIGINT AS nonup_users,
  (SELECT count(*) FROM h8pop WHERE uploader)::BIGINT AS up_users`,
				},
				assert: (rows) => {
					const r = rows?.[0];
					if (!r || Number(r.nonup_users) < 150 || Number(r.up_users) < 25) {
						return { verdict: "WEAK", detail: `retention cohorts too small: nonup=${r?.nonup_users ?? 0} up=${r?.up_users ?? 0}` };
					}
					const did = Number(r.nonup_pp) / Number(r.up_pp);
					const detail = `churn DiD=${did.toFixed(3)} (nonup post/pre=${Number(r.nonup_pp).toFixed(3)} ÷ up=${Number(r.up_pp).toFixed(3)}; mechanism 0.25; n=${r.nonup_users}/${r.up_users})`;
					if (did >= 0.2 && did <= 0.38) return { verdict: "NAILED", detail };
					if (did >= 0.14 && did <= 0.5) return { verdict: "STRONG", detail };
					if (did < 0.7) return { verdict: "WEAK", detail };
					return { verdict: "INVERSE", detail };
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${PU_CTE},
h8pop AS (SELECT p.*,
  (SELECT count(*) FROM ev e WHERE e.uid = p.uid AND e.t <= p.first_t + INTERVAL '${DOC_RETENTION_CUTOFF_DAYS} days') AS pre_n,
  (SELECT count(*) FROM ev e WHERE e.uid = p.uid AND e.t > p.first_t + INTERVAL '${DOC_RETENTION_CUTOFF_DAYS} days') AS post_n
FROM puu p WHERE p.born AND p.first_t < TIMESTAMP '2026-03-02')
SELECT
  (SELECT sum(post_n)::DOUBLE / nullif(sum(pre_n), 0) FROM h8pop WHERE NOT uploader) AS nonup_pp,
  (SELECT sum(post_n)::DOUBLE / nullif(sum(pre_n), 0) FROM h8pop WHERE uploader) AS up_pp,
  (SELECT count(*) FROM h8pop WHERE NOT uploader)::BIGINT AS nonup_users,
  (SELECT count(*) FROM h8pop WHERE uploader)::BIGINT AS up_users`,
				},
				assert: (rows) => {
					const r = rows?.[0];
					if (!r || Number(r.nonup_users) < 150 || Number(r.up_users) < 25) {
						return { verdict: "WEAK", detail: `retention cohorts too small: nonup=${r?.nonup_users ?? 0} up=${r?.up_users ?? 0}` };
					}
					const sep = Number(r.up_pp) / Number(r.nonup_pp);
					const detail = `uploader/non-uploader post-pre separation=${sep.toFixed(2)}x (retention-curve split; n=${r.up_users}/${r.nonup_users})`;
					if (sep >= 2.5) return { verdict: "NAILED", detail };
					if (sep >= 1.8) return { verdict: "STRONG", detail };
					if (sep > 1.2) return { verdict: "WEAK", detail };
					return { verdict: "INVERSE", detail };
				},
			},
		],
	},
	{
		id: "H9-renewal-spike",
		hook: "H9",
		archetype: "temporal-inflection",
		narrative:
			"Days 85-94 (window (2026-03-27, 2026-04-06) strict): each 'renewal completed' gets " +
			"+2 clones (3x), each 'coverage reviewed' +1 (2x). Baseline is LOCAL (days 75-84 ∪ " +
			"96-105) to cancel dataset-level growth; day 95 is excluded because clone jitter " +
			"(+5-120min) bleeds boundary events into Apr 6 early morning. Coverage reads slightly " +
			"under 2x: the window is weekend-heavy (Fri/Sat/Sun = 6 of 10 days vs 3 of 7 baseline), " +
			"depressing the organic in-window rate that the doubling multiplies.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT count(*) FILTER (WHERE t > TIMESTAMP '2026-03-27' AND t < TIMESTAMP '2026-04-06')::BIGINT AS spike_n,
  count(*) FILTER (WHERE (day_idx BETWEEN 75 AND 84) OR (day_idx BETWEEN 96 AND 105))::BIGINT AS local_n
FROM ev WHERE event = 'renewal completed'`,
				},
				assert: (rows) => {
					const r = rows?.[0];
					if (!r || Number(r.spike_n) < 2000 || Number(r.local_n) < 1500) {
						return { verdict: "WEAK", detail: `renewal volume too small: spike=${r?.spike_n ?? 0} local=${r?.local_n ?? 0}` };
					}
					const ratio = (Number(r.spike_n) / 10.0) / (Number(r.local_n) / 20.0);
					const detail = `renewal spike/local=${ratio.toFixed(3)} (mechanism ${1 + RENEWAL_CLONE_COUNT}x; n=${r.spike_n}/${r.local_n})`;
					// Fix-round Q5 (S1): NAILED band is the knob ±10% — 3x → [2.7, 3.3].
					if (ratio >= 2.7 && ratio <= 3.3) return { verdict: "NAILED", detail };
					if (ratio >= 2.3 && ratio <= 3.9) return { verdict: "STRONG", detail };
					if (ratio >= 1.5) return { verdict: "WEAK", detail };
					return { verdict: ratio <= 1 ? "INVERSE" : "NONE", detail };
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT count(*) FILTER (WHERE t > TIMESTAMP '2026-03-27' AND t < TIMESTAMP '2026-04-06')::BIGINT AS spike_n,
  count(*) FILTER (WHERE (day_idx BETWEEN 75 AND 84) OR (day_idx BETWEEN 96 AND 105))::BIGINT AS local_n
FROM ev WHERE event = 'coverage reviewed'`,
				},
				assert: (rows) => {
					const r = rows?.[0];
					if (!r || Number(r.spike_n) < 2000 || Number(r.local_n) < 2000) {
						return { verdict: "WEAK", detail: `coverage volume too small: spike=${r?.spike_n ?? 0} local=${r?.local_n ?? 0}` };
					}
					const ratio = (Number(r.spike_n) / 10.0) / (Number(r.local_n) / 20.0);
					const detail = `coverage spike/local=${ratio.toFixed(3)} (mechanism ${1 + COVERAGE_CLONE_COUNT}x, weekend-heavy window drags low; n=${r.spike_n}/${r.local_n})`;
					// Fix-round Q5 (S1): NAILED band re-derived from the knob (2x ±10% =
					// [1.8, 2.2]), replacing the measurement-wrapped [1.6, 2.1] that let
					// 20%-below-knob read NAILED by construction. The weekend-heavy window
					// genuinely drags the realized ratio below the knob (mechanism in the
					// narrative), so at 2K fidelity this assertion is EXPECTED to land
					// STRONG (~1.78) — the honest verdict for a knob whose realized effect
					// is confounded by DOW weighting.
					if (ratio >= 1.8 && ratio <= 2.2) return { verdict: "NAILED", detail };
					if (ratio >= 1.4 && ratio <= 2.4) return { verdict: "STRONG", detail };
					if (ratio >= 1.2) return { verdict: "WEAK", detail };
					return { verdict: ratio <= 1 ? "INVERSE" : "NONE", detail };
				},
			},
		],
	},
	{
		id: "H10-claim-premium",
		hook: "H10",
		archetype: "cohort-prop-scale",
		narrative:
			"First 'payment made' after each 'claim filed' gets premium_amount x2 (one-shot Map " +
			"consumption). Organic premium_amount caps at 600, so payments > 600 are claim-inflated " +
			"BY CONSTRUCTION: ~zero among H8-untouched non-claimants (the event hook fires in " +
			"generation order, so a claim generated past dataset end can double the next-generated " +
			"payment and then be dropped by the future-time guard — ~1 orphan in 15K users; band " +
			"0=NAILED, ≤2=STRONG sized for exactly this). Cohort-average ratio " +
			"reads ~1.5x, not 2.0x: claims and payments interleave (~7.5 claims / ~9.4 payments per " +
			"claimant), so roughly half of claimant payments get doubled; the 2.0x lives on the " +
			"doubled payments themselves.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${PU_CTE}
SELECT
  (SELECT count(*) FROM ev e JOIN puu p ON e.uid = p.uid
     WHERE e.event = 'payment made' AND e.premium_amount > 600 AND p.claims = 0
       AND ((NOT p.born) OR p.uploader))::BIGINT AS gt600_untouched_nonclaim,
  (SELECT count(*) FROM ev e JOIN puu p ON e.uid = p.uid
     WHERE e.event = 'payment made' AND e.premium_amount > 600 AND p.claims > 0)::BIGINT AS gt600_claimants`,
				},
				assert: (rows) => {
					const r = rows?.[0];
					if (!r || Number(r.gt600_claimants) < 2000) {
						return { verdict: "WEAK", detail: `doubled-payment volume too small: claimant gt600=${r?.gt600_claimants ?? 0}` };
					}
					const orphans = Number(r.gt600_untouched_nonclaim);
					const detail = `payments>600: untouched non-claimants=${orphans} (expect exactly 0), claimants=${r.gt600_claimants}`;
					if (orphans === 0) return { verdict: "NAILED", detail };
					if (orphans <= 2) return { verdict: "STRONG", detail };
					if (orphans <= Number(r.gt600_claimants) * 0.01) return { verdict: "WEAK", detail };
					return { verdict: "INVERSE", detail };
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${PU_CTE}
SELECT
  (SELECT avg(e.premium_amount) FROM ev e JOIN puu p ON e.uid = p.uid WHERE e.event = 'payment made' AND p.claims > 0) AS claimant_avg,
  (SELECT avg(e.premium_amount) FROM ev e JOIN puu p ON e.uid = p.uid WHERE e.event = 'payment made' AND p.claims = 0) AS nonclaim_avg,
  (SELECT count(*) FROM ev e JOIN puu p ON e.uid = p.uid WHERE e.event = 'payment made' AND p.claims > 0)::BIGINT AS claimant_pay_n,
  (SELECT count(*) FROM ev e JOIN puu p ON e.uid = p.uid WHERE e.event = 'payment made' AND p.claims = 0)::BIGINT AS nonclaim_pay_n`,
				},
				assert: (rows) => {
					const r = rows?.[0];
					if (!r || Number(r.claimant_pay_n) < 10000 || Number(r.nonclaim_pay_n) < 200) {
						return { verdict: "WEAK", detail: `payment cohorts too small: claimant=${r?.claimant_pay_n ?? 0} nonclaim=${r?.nonclaim_pay_n ?? 0}` };
					}
					const ratio = Number(r.claimant_avg) / Number(r.nonclaim_avg);
					const detail = `claimant/non-claimant avg premium_amount=${ratio.toFixed(3)} (knob ${POST_CLAIM_PREMIUM_MULT}x per doubled payment, ~half doubled → ~1.5x cohort; n=${r.claimant_pay_n}/${r.nonclaim_pay_n})`;
					if (ratio >= 1.35 && ratio <= 1.6) return { verdict: "NAILED", detail };
					if (ratio >= 1.25 && ratio <= 1.75) return { verdict: "STRONG", detail };
					if (ratio > 1.1) return { verdict: "WEAK", detail };
					return { verdict: "INVERSE", detail };
				},
			},
		],
	},
];
