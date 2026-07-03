// ── IMPORTS ──
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);
import "dotenv/config";
import * as u from "@ak--47/dungeon-master/utils";
import * as v from "ak-tools";
import { findFirstSequence, scaleFunnelTTC } from "@ak--47/dungeon-master/hook-helpers";
/** @typedef  {import("../../../types").Dungeon} Config */

// ── OVERVIEW ──
/*
 * NAME:       MedConnect
 * APP:        Telehealth platform connecting doctors, nurses, and patients
 *             through virtual consultations, prescriptions, and secure
 *             messaging. Multi-role system; subscription tiers (free/basic/
 *             premium); feature rollouts for video consultation and AI
 *             symptom checker; geo-aware (US/EU/LATAM).
 * SCALE:      10,000 users, ~1.2M events, 121 days (2026-01-01 → 2026-05-01)
 * CORE LOOP:  sign up → symptom search → book appointment → consultation → prescription → follow-up
 *
 * EVENTS (18):
 *   app session (8) > symptom search (7) > appointment booked (6) > notification received (6)
 *   > consultation completed (5) > message sent (5) > prescription issued (4)
 *   > health record accessed (4) > prescription refill (3) > follow up scheduled (3)
 *   > lab results viewed (3) > payment processed (3) > insurance verified (2)
 *   > provider rated (2) > profile updated (2) > account created (1)
 *   > support ticket created (1) > account deactivated (1)
 *
 * FUNNELS (5):
 *   - Onboarding Flow:          account created → insurance verified → symptom search → appointment booked (45%)
 *   - Booking to Consultation:  symptom search → appointment booked → consultation completed (40%)
 *   - Full Care Journey:        appointment booked → consultation completed → prescription issued → follow up scheduled (30%)
 *   - Prescription Lifecycle:   prescription issued → prescription refill → payment processed (55%)
 *   - Patient Satisfaction:     consultation completed → provider rated → follow up scheduled (25%)
 *
 * USER PROPS:  role, specialty, years_experience, preferred_language, has_chronic_condition, age_range, subscription_tier, Platform
 * SUPER PROPS: subscription_tier, Platform
 * SCD PROPS:   care_plan (preventive/routine/chronic/acute, monthly fuzzy, max 8)
 * GROUPS:      none
 */

// ── HOOK STORIES ──
/*
 * NOTE: Cohort effects are HIDDEN — discoverable via raw-prop breakdowns
 * (HOD, day, tier) or behavioral cohorts. One exception: H6 stamps
 * no_show=true on flagged bookings (a realistic appointment-status
 * property, and the only selection-free way to verify per-event thinning
 * on an activity-selected cohort).
 *
 * ───────────────────────────────────────────────────────────────
 * 1. AFTER-HOURS SURGE PRICING (event hook)
 * ───────────────────────────────────────────────────────────────
 *
 * PATTERN: Consultations between 7PM-7AM (after-hours) have 1.5x
 * higher consultation_fee. Simulates urgent care premium pricing.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: After-Hours Fee Premium
 *   • Report type: Insights
 *   • Event: "consultation completed"
 *   • Measure: Average of "consultation_fee"
 *   • Breakdown: hour of day
 *   • Expected: hours 19-06 UTC ~ 1.5x avg fee vs hours 07-18
 *     (after-hours ≈ $112, business ≈ $75)
 *
 * REAL-WORLD ANALOGUE: Telehealth platforms charge premiums for
 * after-hours urgent consultations, a key revenue driver.
 *
 * ───────────────────────────────────────────────────────────────
 * 2. FLU SEASON SPIKE (event hook)
 * ───────────────────────────────────────────────────────────────
 *
 * PATTERN: During days 50-70 (flu season window), appointments
 * with condition_type "respiratory" get 2x the wait_time and the
 * condition is forced to "respiratory" 60% of the time.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Flu Season Volume
 *   • Report type: Insights
 *   • Event: "appointment booked"
 *   • Measure: Total
 *   • Filter: condition_type = "respiratory"
 *   • Line chart by week
 *   • Expected: Clear spike during flu season window (days 50-70)
 *
 *   Report 2: Wait Time During Flu Season
 *   • Report type: Insights
 *   • Event: "appointment booked"
 *   • Measure: Average of "wait_time_hours"
 *   • Breakdown: "condition_type"
 *   • Filter: time within flu season
 *   • Expected: respiratory ~2x wait vs other conditions
 *
 * REAL-WORLD ANALOGUE: Seasonal illness creates predictable surges
 * in appointment demand and wait times.
 *
 * ───────────────────────────────────────────────────────────────
 * 3. EXPERIENCED DOCTOR SATISFACTION (everything hook)
 * ───────────────────────────────────────────────────────────────
 *
 * PATTERN: Users who had >12 consultation events get ALL their
 * satisfaction_scores redrawn uniform 4.0-5.0 (avg 4.5) vs the declared
 * baseline weighNumRange(1,5,mode 3) ≈ 3.0. Simulates experienced
 * doctors earning better reviews.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Satisfaction by Consultation Volume
 *   • Report type: Insights
 *   • Event: "consultation completed"
 *   • Measure: Average of "satisfaction_score"
 *   • Breakdown: behavioral cohort (>12 consultations vs fewer)
 *   • Expected: heavy consulters ~4.5 avg vs ~3.0 baseline; every one
 *     of their scores sits in [4.0, 5.0]
 *
 * REAL-WORLD ANALOGUE: Experienced providers develop better bedside
 * manner and patient communication skills over time.
 *
 * ───────────────────────────────────────────────────────────────
 * 4. VIDEO CONSULTATION FOLLOW-UP LIFT (everything hook)
 * ───────────────────────────────────────────────────────────────
 *
 * PATTERN: Each video-mode consultation has a 60% chance to inject one
 * cloned "follow up scheduled" event 1-7 days later (stamped
 * consultation_mode="video", fresh days_until_followup 3-14). Users
 * without an existing follow-up to clone from are skipped.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Follow-Up Rate by Consultation Mode
 *   • Report type: Insights
 *   • Event: "follow up scheduled"
 *   • Measure: Total per user
 *   • Breakdown: "consultation_mode" (from consultation completed)
 *   • Expected: video-consult users carry ~+0.6 extra follow-ups per
 *     video consultation vs phone-only users
 *
 * REAL-WORLD ANALOGUE: Face-to-face (video) consultations build
 * stronger patient-doctor rapport, increasing follow-up compliance.
 *
 * ───────────────────────────────────────────────────────────────
 * 5. CHRONIC CONDITION REFILL CHAIN (everything hook)
 * ───────────────────────────────────────────────────────────────
 *
 * PATTERN: Patients with condition_type "chronic" on any prescription
 * event get additional cloned prescription_refill events injected
 * every ~30 days after the original. Creates periodic refill cadence.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Refill Volume by Condition
 *   • Report type: Insights
 *   • Event: "prescription refill"
 *   • Measure: Total
 *   • Breakdown: "condition_type"
 *   • Expected: "chronic" should have ~3-4x more refills than others
 *
 * REAL-WORLD ANALOGUE: Chronic conditions (diabetes, hypertension)
 * require ongoing prescriptions creating predictable refill revenue.
 *
 * ───────────────────────────────────────────────────────────────
 * 6. OCCASIONAL PATIENT NO-SHOWS (everything hook)
 * ───────────────────────────────────────────────────────────────
 *
 * PATTERN: Low-activity users (<15 events — overwhelmingly occasional/
 * churner patients; providers generate far more) lose 25% of their
 * "consultation completed" events and get no_show=true stamped on 25%
 * of their "appointment booked" events. Simulates occasional patients
 * who book but don't show up.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: No-Show Rate
 *   • Report type: Insights
 *   • Event: "appointment booked"
 *   • Measure: Total, filtered no_show = true, vs Total overall
 *   • Expected: no-shows concentrate entirely on low-activity users
 *     (~25% of their bookings); zero no-shows on active users
 *
 *   Report 2: Appointment-to-Consultation Ratio
 *   • Report type: Funnels
 *   • Steps: "appointment booked" → "consultation completed"
 *   • Expected: low-activity users convert visibly worse (engineered
 *     25% thinning compounded by their organically lower conversion)
 *
 * REAL-WORLD ANALOGUE: Infrequent patients have higher no-show rates,
 * a major operational cost for healthcare providers.
 *
 * ───────────────────────────────────────────────────────────────
 * 7. DOCTOR PROFILE SPECIALIZATION (user hook)
 * ───────────────────────────────────────────────────────────────
 *
 * PATTERN: Users with role "doctor" get specialty set to a specific
 * value (from the existing array) and years_experience boosted to
 * senior range (15-30). Nurses get years_experience in mid range.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Experience Distribution by Role
 *   • Report type: Insights
 *   • Event: "consultation completed"
 *   • Measure: Average of user property "years_experience"
 *   • Breakdown: user property "role"
 *   • Expected: doctors ≈ 22 years, nurses ≈ 8, patients ≈ 0
 *
 * REAL-WORLD ANALOGUE: Provider profiles have specialized expertise
 * and experience levels that affect patient matching.
 *
 * ───────────────────────────────────────────────────────────────
 * 8. FREE-TIER CONVERSION DROP (everything hook)
 * ───────────────────────────────────────────────────────────────
 *
 * PATTERN: 30% of free-tier users (per-user coin flip) lose ALL their
 * "consultation completed" events — a per-user cliff, not per-event
 * thinning. Surviving free users are statistically identical to paid
 * users, which makes the effect cleanly measurable: the excess
 * zero-consultation share among free users reads the 30% knob directly.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Booking Conversion by Tier
 *   • Report type: Funnels
 *   • Steps: "symptom search" → "appointment booked" → "consultation completed"
 *   • Breakdown: "subscription_tier"
 *   • Expected: free ≈ 28% vs basic/premium ≈ 40% conversion
 *
 * REAL-WORLD ANALOGUE: Free-tier patients face longer wait times
 * and limited scheduling, reducing completed consultations.
 *
 * ───────────────────────────────────────────────────────────────
 * 9. BOOKING FUNNEL TTC BY TIER (everything hook — property scaling)
 *
 * PATTERN: Premium users get shorter wait times and consultation
 * durations (0.67x); Free users get longer (1.4x); Basic at 1.0x.
 * Scales `wait_time_hours` on "appointment booked" and
 * `duration_minutes` on "consultation completed".
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Wait Time by Subscription Tier
 *   - Insights > "appointment booked"
 *   - Measure: Average of "wait_time_hours"
 *   - Breakdown: subscription_tier
 *   - Expected: premium ~ 0.67x baseline; free ~ 1.4x baseline
 *
 *   Report 2: Consultation Duration by Tier
 *   - Insights > "consultation completed"
 *   - Measure: Average of "duration_minutes"
 *   - Breakdown: subscription_tier
 *   - Expected: premium ~ 0.67x baseline; free ~ 1.4x baseline
 *
 * ───────────────────────────────────────────────────────────────
 * 10. CONSULTATION-COUNT MAGIC NUMBER (everything)
 *
 * PATTERN: Sweet 3-6 consultations → +25% on consultation_fee.
 * Over 7+ → days_until_followup multiplied by 1.5 (over-consulted
 * patients wait 50% longer for next visit). No flag.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Avg Consultation Fee by Consult-Count Bucket
 *   - Cohort A: users with 3-6 "consultation completed"
 *   - Cohort B: users with 0-2
 *   - Event: "consultation completed"
 *   - Measure: Average of "consultation_fee"
 *   - Expected: A ~ 1.25x B
 *
 *   Report 2: Follow-Up Wait Time on Heavy Consulters
 *   - Cohort C: users with >= 7 consultations
 *   - Cohort A: users with 3-6
 *   - Event: "follow up scheduled"
 *   - Measure: Average of "days_until_followup"
 *   - Expected: C ~ 1.5x A (longer gap before next visit)
 *
 * REAL-WORLD ANALOGUE: Engaged patients pay more; over-engaged
 * patients hit care-fatigue and stretch the gap to next visit.
 *
 * ═══════════════════════════════════════════════════════════════
 * EXPECTED METRICS SUMMARY
 * ═══════════════════════════════════════════════════════════════
 *
 * Hook                        | Metric                        | Expected        | Measured (full fidelity)
 * ----------------------------|-------------------------------|-----------------|-------------------------
 * H1 After-Hours Pricing      | fee after-hours / business    | 1.5x            | 1.494 (avg = median)
 * H2 Flu Season Spike         | respiratory share in-window   | 0.65 (vs 0.125) | 0.654 (out: 0.125)
 * H2 Flu Season Spike         | resp/other wait in-window     | 2x              | 1.996
 * H3 Experienced Doctor Sat.  | satisfaction >12-consult users| avg+median 4.5  | 4.499 / 4.500 (0 impure)
 * H4 Video Follow-Up Lift     | extra follow-ups per video    | +0.6 within 7d  | +0.588
 *                             |   consult (within-7d diff)    |                 |
 * H5 Chronic Refill Chain     | surviving clones / model      | ~1.0            | 1.001 (placebo 0.048)
 *                             |   expectation (survival-adj)  |                 |
 * H6 Occasional No-Shows      | no_show rate, <15-event users | 0.25 (0 on rest)| 0.248 (0 impure)
 * H7 Doctor Specialization    | years_experience by role      | 22.5 / 9 / 0    | 22.46 / 9.00 / 0 exact
 * H8 Free-Tier Cliff          | excess zero-consult share     | 0.30            | 0.313 (survivors 0.986)
 *                             |   (z_free−z_paid)/(1−z_paid)  |                 |
 * H9 Wait/Duration by Tier    | free/basic, premium/basic     | 1.4x / 0.67x    | 1.40/0.671, 1.40/0.670
 * H9 Funnel TTC by Tier       | median TTC free/basic (emu)   | >1 (diluted 1.4)| 1.157 (prem/basic 0.827)
 * H10 Magic Number            | sweet fee / low fee (median)  | 1.25x           | 1.219
 * H10 Magic Number            | over/sweet days_until_fu      | 1.5x (phone fu) | 1.500
 */

// ── SCALE ──
const SEED = "dm4-healthcare";
const NUM_USERS = 10_000;
const DATASET_START = "2026-01-01T00:00:00Z";
const DATASET_END = "2026-05-01T23:59:59Z";
const EVENTS_PER_DAY = 1.2;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── KNOBS (tweak these to reshape stories) ──
const AFTER_HOURS_START = 19;
const AFTER_HOURS_END = 7;
const AFTER_HOURS_FEE_MULT = 1.5;

const FLU_START_DAY = 50;
const FLU_END_DAY = 70;
const FLU_RESPIRATORY_LIKELIHOOD = 60;
const FLU_WAIT_MULT = 2;

const EXPERIENCED_CONSULT_THRESHOLD = 12;
const EXPERIENCED_SATISFACTION_MIN = 4.0;
const EXPERIENCED_SATISFACTION_MAX = 5.0;

const VIDEO_FOLLOWUP_LIKELIHOOD = 60;

const CHRONIC_REFILL_MIN = 2;
const CHRONIC_REFILL_MAX = 4;
const CHRONIC_REFILL_INTERVAL_DAYS = 30;

const NO_SHOW_EVENT_THRESHOLD = 15;
const NO_SHOW_DROP_LIKELIHOOD = 25;

const DOCTOR_EXPERIENCE_MIN = 15;
const DOCTOR_EXPERIENCE_MAX = 30;
const NURSE_EXPERIENCE_MIN = 3;
const NURSE_EXPERIENCE_MAX = 15;

const FREE_TIER_DROP_LIKELIHOOD = 30;

const TTC_PREMIUM_FACTOR = 0.67;
const TTC_FREE_FACTOR = 1.4;

const CONSULT_SWEET_MIN = 3;
const CONSULT_SWEET_MAX = 6;
const CONSULT_OVER_THRESHOLD = 7;
const CONSULT_FEE_BOOST = 1.25;
const CONSULT_FOLLOWUP_STRETCH = 1.5;

// ── DATA ARRAYS ──
// Generate consistent doctor/clinic IDs at module level
const doctorIds = v.range(1, 120).map(() => `DR_${v.uid(6)}`);
const clinicIds = v.range(1, 25).map(() => `CLINIC_${v.uid(4)}`);

// ── HELPER FUNCTIONS ──
function handleUserHooks(record) {
	// H7: DOCTOR PROFILE SPECIALIZATION — doctors get a real specialty and
	// senior years_experience. Nurses get mid-range experience. Patients
	// stay at defaults.
	if (record.role === "doctor") {
		record.specialty = chance.pickone(["cardiology", "dermatology", "pediatrics", "psychiatry", "general_practice", "pulmonology", "endocrinology"]);
		record.years_experience = chance.integer({ min: DOCTOR_EXPERIENCE_MIN, max: DOCTOR_EXPERIENCE_MAX });
	} else if (record.role === "nurse") {
		record.specialty = chance.pickone(["general_practice", "pediatrics", "emergency"]);
		record.years_experience = chance.integer({ min: NURSE_EXPERIENCE_MIN, max: NURSE_EXPERIENCE_MAX });
	} else {
		record.years_experience = 0;
	}
	return record;
}

function handleEverythingHooks(record, meta) {
	if (!record.length) return record;
	const profile = meta.profile;
	const datasetStart = dayjs.unix(meta.datasetStart).utc();
	const FLU_START = datasetStart.add(FLU_START_DAY, "days");
	const FLU_END = datasetStart.add(FLU_END_DAY, "days");

	// ── SUPER-PROP STAMPING ──────────────────────────
	// Stamp superProps from profile so they are consistent per-user.
	if (profile) {
		const tier = profile.subscription_tier;
		const plat = profile.Platform;
		record.forEach(e => {
			if (tier) e.subscription_tier = tier;
			if (plat) e.Platform = plat;
		});
	}

	// HOOK 9: BOOKING FUNNEL TTC BY TIER (property scaling)
	// Premium users get shorter wait_time_hours (0.67x) and duration_minutes (0.67x).
	// Free users get longer wait_time_hours (1.4x) and duration_minutes (1.4x).
	// Basic users stay at baseline. SQL-measurable via AVG(wait_time_hours) broken by tier.
	if (profile) {
		const userTier = profile.subscription_tier;
		const ttcFactor = userTier === "premium" ? TTC_PREMIUM_FACTOR : userTier === "free" ? TTC_FREE_FACTOR : 1.0;
		if (ttcFactor !== 1.0) {
			// Timestamp shift: affects Mixpanel funnel TTC
			const bookingSeq = findFirstSequence(
				record,
				["appointment booked", "consultation completed", "follow up scheduled"],
				60 * 24 * 30
			);
			if (bookingSeq) scaleFunnelTTC(bookingSeq, ttcFactor);
			// Property scale: affects Insights AVG reports
			record.forEach(e => {
				if (e.event === "appointment booked" && typeof e.wait_time_hours === "number") {
					e.wait_time_hours = Math.round(e.wait_time_hours * ttcFactor * 10) / 10;
				}
				if (e.event === "consultation completed" && typeof e.duration_minutes === "number") {
					e.duration_minutes = Math.round(e.duration_minutes * ttcFactor);
				}
			});
		}
	}

	// HOOK 1: AFTER-HOURS SURGE PRICING — consultations 7PM-7AM
	// UTC get consultation_fee 1.5x. No flag — discover via HOD chart.
	// Only "consultation completed" declares consultation_fee ("appointment
	// booked" was a dead branch — its guard on e.consultation_fee never held).
	// Runs after H9's timestamp shift, so the hour check sees final times.
	record.forEach(e => {
		if (e.event === "consultation completed") {
			const hour = new Date(e.time).getUTCHours();
			if ((hour >= AFTER_HOURS_START || hour < AFTER_HOURS_END) && e.consultation_fee) {
				e.consultation_fee = Math.floor(e.consultation_fee * AFTER_HOURS_FEE_MULT);
			}
		}
	});

	// HOOK 2: FLU SEASON SPIKE — d50-70 respiratory dominates, wait_time doubles.
	// UTC parses throughout — a machine-local dayjs() here would move the
	// window boundaries by the generating machine's TZ offset, breaking the
	// same-seed-same-output determinism promise across machines.
	record.forEach(e => {
		if (e.event !== "appointment booked") return;
		const t = dayjs.utc(e.time);
		if (t.isAfter(FLU_START) && t.isBefore(FLU_END)) {
			if (chance.bool({ likelihood: FLU_RESPIRATORY_LIKELIHOOD })) e.condition_type = "respiratory";
			if (e.condition_type === "respiratory") {
				e.wait_time_hours = Math.floor((e.wait_time_hours || 12) * FLU_WAIT_MULT);
			}
		}
	});

	// ── HOOK 8: FREE-TIER CONVERSION DROP ────────────
	// Free-tier users lose ~30% of "consultation completed" events
	// (last step of Booking to Consultation funnel), simulating
	// lower conversion for non-paying patients.
	if (profile && profile.subscription_tier === "free" && chance.bool({ likelihood: FREE_TIER_DROP_LIKELIHOOD })) {
		record = record.filter(e => e.event !== "consultation completed");
	}

	// ── HOOK 3: EXPERIENCED DOCTOR SATISFACTION ──────
	// Users with >12 consultation events get boosted satisfaction scores.
	let consultCount = 0;
	record.forEach(e => {
		if (e.event === "consultation completed") consultCount++;
	});

	if (consultCount > EXPERIENCED_CONSULT_THRESHOLD) {
		record.forEach(e => {
			if (e.event === "consultation completed") {
				e.satisfaction_score = chance.floating({ min: EXPERIENCED_SATISFACTION_MIN, max: EXPERIENCED_SATISFACTION_MAX, fixed: 1 });
			}
		});
	}

	// ── HOOK 4: VIDEO CONSULTATION FOLLOW-UP LIFT ────
	// Patients with video consultations get 2x follow-up events.
	const hasVideoConsult = record.some(e =>
		e.event === "consultation completed" && e.consultation_mode === "video"
	);
	if (hasVideoConsult) {
		const templateFollowUp = record.find(e => e.event === "follow up scheduled");
		if (templateFollowUp) {
			const videoConsults = record.filter(e =>
				e.event === "consultation completed" && e.consultation_mode === "video"
			);
			videoConsults.forEach(vc => {
				if (chance.bool({ likelihood: VIDEO_FOLLOWUP_LIKELIHOOD })) {
					record.push({
						...templateFollowUp,
						time: dayjs(vc.time).add(chance.integer({ min: 1, max: 7 }), "days").toISOString(),
						user_id: vc.user_id,
						consultation_mode: "video",
						days_until_followup: chance.integer({ min: 3, max: 14 }),
						// fresh insert_id: the engine stamps insert_id at generation
						// (lib/generators/events.js), so a bare spread copies the
						// template's id and Mixpanel's $insert_id dedupe would
						// silently drop every clone after the first
						insert_id: chance.guid(),
					});
				}
			});
		}
	}

	// ── HOOK 5: CHRONIC CONDITION REFILL CHAIN ───────
	// Patients with chronic prescriptions get refills every ~30 days.
	const chronicRxs = record.filter(e =>
		e.event === "prescription issued" && e.condition_type === "chronic"
	);
	if (chronicRxs.length > 0) {
		const templateRefill = record.find(e => e.event === "prescription refill");
		if (templateRefill) {
			chronicRxs.forEach(rx => {
				const rxTime = dayjs(rx.time);
				const refillsToAdd = chance.integer({ min: CHRONIC_REFILL_MIN, max: CHRONIC_REFILL_MAX });
				for (let i = 1; i <= refillsToAdd; i++) {
					record.push({
						...templateRefill,
						// clones past datasetEnd are dropped by the engine's
						// unconditional future-time guard — late-window chronic
						// prescriptions keep fewer of their refills by design
						time: rxTime.add(CHRONIC_REFILL_INTERVAL_DAYS * i + chance.integer({ min: -3, max: 3 }), "days").toISOString(),
						user_id: rx.user_id,
						condition_type: "chronic",
						medication_type: "chronic_maintenance",
						refill_count: i,
						// fresh insert_id — same $insert_id dedupe rationale as H4
						insert_id: chance.guid(),
					});
				}
			});
		}
	}

	// HOOK 6: OCCASIONAL PATIENT NO-SHOWS — low-activity users (< 15 events
	// at this point in the pipeline, clones included) lose 25% of their
	// consultations and get no_show=true stamped on 25% of their bookings
	// (they booked but didn't show). no_show is DECLARED [false] on
	// "appointment booked" (schema-first rule), so flipped rows are the only
	// true values in the dataset. Because the flag is decided before any
	// later deletion and every subsequent step only shrinks a user's stream,
	// users with >= 15 output events provably carry zero no_show=true rows.
	if (record.length < NO_SHOW_EVENT_THRESHOLD) {
		for (let i = record.length - 1; i >= 0; i--) {
			if (record[i].event === "consultation completed" && chance.bool({ likelihood: NO_SHOW_DROP_LIKELIHOOD })) {
				record.splice(i, 1);
			}
		}
		record.forEach(e => {
			if (e.event === "appointment booked" && chance.bool({ likelihood: NO_SHOW_DROP_LIKELIHOOD })) {
				e.no_show = true;
			}
		});
	}

	// HOOK 10: CONSULTATION-COUNT MAGIC NUMBER (no flags)
	// Sweet 3-6 consultations → +25% on consultation_fee. Over 7+ →
	// days_until_followup stretched 1.5x (over-consulted patients wait
	// longer for the next visit). Counts run AFTER all filters (H8/H6)
	// and nothing drops consultations later, so output-side consult
	// counts rebuild these cohorts exactly.
	const consultCt = record.filter(e => e.event === "consultation completed").length;
	if (consultCt >= CONSULT_SWEET_MIN && consultCt <= CONSULT_SWEET_MAX) {
		record.forEach(e => {
			if (e.event === "consultation completed" && typeof e.consultation_fee === "number") {
				e.consultation_fee = Math.round(e.consultation_fee * CONSULT_FEE_BOOST);
			}
		});
	} else if (consultCt >= CONSULT_OVER_THRESHOLD) {
		record.forEach(e => {
			if (e.event === "follow up scheduled" && typeof e.days_until_followup === "number") {
				e.days_until_followup = Math.round(e.days_until_followup * CONSULT_FOLLOWUP_STRETCH);
			}
		});
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
		care_plan: {
			values: ["preventive", "routine", "chronic", "acute"],
			frequency: "month",
			timing: "fuzzy",
			max: 8
		}
	},
	mirrorProps: {},
	lookupTables: [],

	// ── Events (18) ──────────────────────────────────────────
	events: [
		{
			event: "account created",
			weight: 1,
			isFirstEvent: true,
			isAuthEvent: true,
			properties: {
				referral_source: ["organic", "doctor_referral", "insurance_partner", "social_media", "search"],
			},
		},
		{
			event: "symptom search",
			weight: 7,
			properties: {
				search_term: ["headache", "fever", "cough", "back pain", "fatigue", "anxiety", "rash", "nausea", "chest pain", "joint pain"],
				results_count: u.weighNumRange(0, 25, 0.5),
			},
		},
		{
			event: "appointment booked",
			weight: 6,
			isStrictEvent: false,
			properties: {
				doctor_id: chance.pickone.bind(chance, doctorIds),
				clinic_id: chance.pickone.bind(chance, clinicIds),
				condition_type: ["general", "general", "general", "respiratory", "dermatology", "mental_health", "chronic", "pediatric"],
				wait_time_hours: u.weighNumRange(1, 72, 0.4),
				appointment_type: ["new_patient", "follow_up", "follow_up", "urgent", "routine", "routine"],
				// declared false; H6 flips to true on 25% of low-activity users' bookings
				no_show: [false],
			},
		},
		{
			event: "consultation completed",
			weight: 5,
			isStrictEvent: false,
			properties: {
				doctor_id: chance.pickone.bind(chance, doctorIds),
				consultation_mode: ["phone", "phone", "video"],
				duration_minutes: u.weighNumRange(5, 60, 0.6, 15),
				consultation_fee: u.weighNumRange(25, 200, 0.4, 75),
				satisfaction_score: u.weighNumRange(1, 5, 0.8, 3),
				condition_type: ["general", "general", "respiratory", "dermatology", "mental_health", "chronic", "pediatric"],
			},
		},
		{
			event: "prescription issued",
			weight: 4,
			isStrictEvent: false,
			properties: {
				medication_type: ["antibiotic", "antiviral", "painkiller", "anti_inflammatory", "antidepressant", "inhaler", "topical", "chronic_maintenance"],
				quantity: u.weighNumRange(1, 90, 0.3, 30),
				condition_type: ["general", "respiratory", "dermatology", "mental_health", "chronic", "chronic", "pediatric"],
				refill_count: u.weighNumRange(0, 3),
			},
		},
		{
			event: "prescription refill",
			weight: 3,
			isStrictEvent: false,
			properties: {
				medication_type: ["antibiotic", "antiviral", "painkiller", "anti_inflammatory", "antidepressant", "inhaler", "topical", "chronic_maintenance"],
				quantity: u.weighNumRange(1, 90, 0.3, 30),
				condition_type: ["general", "respiratory", "dermatology", "mental_health", "chronic", "chronic", "pediatric"],
				refill_count: u.weighNumRange(1, 6),
			},
		},
		{
			event: "follow up scheduled",
			weight: 3,
			isStrictEvent: false,
			properties: {
				doctor_id: chance.pickone.bind(chance, doctorIds),
				days_until_followup: u.weighNumRange(3, 30, 0.5, 7),
				condition_type: ["general", "respiratory", "dermatology", "mental_health", "chronic", "pediatric"],
				consultation_mode: ["phone", "phone", "video"],
			},
		},
		{
			event: "message sent",
			weight: 5,
			properties: {
				message_type: ["question", "question", "update", "result_inquiry", "prescription_question", "scheduling"],
				recipient_role: ["doctor", "doctor", "nurse", "support"],
				response_time_hours: u.weighNumRange(0.1, 48, 0.3, 4),
			},
		},
		{
			event: "lab results viewed",
			weight: 3,
			properties: {
				test_type: ["blood_panel", "urinalysis", "imaging", "allergy_test", "metabolic_panel", "thyroid"],
				result_status: ["normal", "normal", "normal", "abnormal", "pending"],
			},
		},
		{
			event: "health record accessed",
			weight: 4,
			properties: {
				record_type: ["visit_summary", "lab_results", "prescriptions", "immunizations", "billing"],
				access_method: ["app", "app", "web_portal"],
			},
		},
		{
			event: "insurance verified",
			weight: 2,
			properties: {
				insurance_type: ["private", "private", "employer", "medicare", "medicaid", "self_pay"],
				verification_status: ["approved", "approved", "approved", "pending", "denied"],
				copay_amount: u.weighNumRange(0, 75, 0.5, 20),
			},
		},
		{
			event: "payment processed",
			weight: 3,
			properties: {
				amount: u.weighNumRange(10, 500, 0.3, 75),
				payment_method: ["credit_card", "credit_card", "insurance_claim", "hsa_fsa", "debit"],
				payment_status: ["success", "success", "success", "success", "failed"],
			},
		},
		{
			event: "notification received",
			weight: 6,
			properties: {
				notification_type: ["appointment_reminder", "appointment_reminder", "lab_ready", "prescription_ready", "message_received", "billing"],
				channel: ["push", "push", "email", "sms"],
				opened: [true, true, true, false],
			},
		},
		{
			event: "provider rated",
			weight: 2,
			properties: {
				doctor_id: chance.pickone.bind(chance, doctorIds),
				rating: u.weighNumRange(1, 5, 0.7, 4),
				would_recommend: [true, true, true, true, false],
			},
		},
		{
			event: "support ticket created",
			weight: 1,
			properties: {
				category: ["billing", "technical", "scheduling", "prescription", "insurance", "other"],
				priority: ["low", "low", "medium", "medium", "high"],
				resolution_hours: u.weighNumRange(1, 96, 0.4, 24),
			},
		},
		{
			event: "profile updated",
			weight: 2,
			properties: {
				field_updated: ["insurance", "address", "phone", "emergency_contact", "allergies", "medications"],
			},
		},
		{
			event: "app session",
			weight: 8,
			properties: {
				session_duration_sec: u.weighNumRange(10, 1800, 0.4, 120),
				pages_viewed: u.weighNumRange(1, 15, 0.5, 3),
			},
		},
		{
			event: "account deactivated",
			weight: 1,
			isChurnEvent: true,
			returnLikelihood: 0.15,
			isStrictEvent: true,
			properties: {
				reason: ["switched_provider", "cost", "no_longer_needed", "poor_experience", "insurance_change"],
			},
		},
	],

	// ── Funnels (5) ──────────────────────────────────────────
	funnels: [
		{
			name: "Onboarding Flow",
			sequence: ["account created", "insurance verified", "symptom search", "appointment booked"],
			conversionRate: 45,
			order: "sequential",
			isFirstFunnel: true,
			timeToConvert: 72,
			weight: 3,
		},
		{
			name: "Booking to Consultation",
			sequence: ["symptom search", "appointment booked", "consultation completed"],
			conversionRate: 40,
			order: "sequential",
			timeToConvert: 48,
			weight: 5,
		},
		{
			name: "Full Care Journey",
			sequence: ["appointment booked", "consultation completed", "prescription issued", "follow up scheduled"],
			conversionRate: 30,
			order: "sequential",
			timeToConvert: 168,
			weight: 3,
		},
		{
			name: "Prescription Lifecycle",
			sequence: ["prescription issued", "prescription refill", "payment processed"],
			conversionRate: 55,
			order: "sequential",
			timeToConvert: 720,
			weight: 2,
		},
		{
			name: "Patient Satisfaction",
			sequence: ["consultation completed", "provider rated", "follow up scheduled"],
			conversionRate: 25,
			order: "sequential",
			timeToConvert: 72,
			weight: 2,
		},
	],

	// ── SuperProps ──────────────────────────────────────────
	superProps: {
		subscription_tier: ["free", "free", "free", "basic", "basic", "premium"],
		Platform: ["ios", "android", "web"],
	},

	// ── UserProps ──────────────────────────────────────────
	userProps: {
		role: ["patient", "patient", "patient", "patient", "patient", "patient", "patient", "patient", "nurse", "doctor"],
		specialty: ["none"],
		years_experience: u.weighNumRange(0, 5, 0.5),
		preferred_language: ["en", "en", "en", "en", "es", "pt", "de", "fr"],
		has_chronic_condition: [false, false, false, true],
		age_range: ["18-25", "26-35", "26-35", "36-45", "36-45", "46-55", "56-65", "65+"],
		subscription_tier: ["free", "free", "free", "basic", "basic", "premium"],
		Platform: ["ios", "android", "web"],
	},

	// ── Personas ──────────────────────────────────
	personas: [
		{
			name: "doctor",
			weight: 5,
			eventMultiplier: 5.0,
			conversionModifier: 1.8,
			churnRate: 0.01,
			properties: {
				role: "doctor",
				segment: "provider",
			},
		},
		{
			name: "nurse",
			weight: 10,
			eventMultiplier: 3.0,
			conversionModifier: 1.5,
			churnRate: 0.03,
			properties: {
				role: "nurse",
				segment: "provider",
			},
		},
		{
			name: "patient_active",
			weight: 40,
			eventMultiplier: 1.0,
			conversionModifier: 1.0,
			churnRate: 0.05,
			properties: {
				role: "patient",
				segment: "active_patient",
			},
		},
		{
			name: "patient_occasional",
			weight: 30,
			eventMultiplier: 0.5,
			conversionModifier: 0.7,
			churnRate: 0.12,
			properties: {
				role: "patient",
				segment: "occasional_patient",
			},
		},
		{
			name: "patient_churner",
			weight: 15,
			eventMultiplier: 0.3,
			conversionModifier: 0.3,
			churnRate: 0.4,
			properties: {
				role: "patient",
				segment: "churner",
			},
			activeWindow: { maxDays: 21 },
		},
	],

	// ── Subscription ──────────────────────────────
	subscription: {
		plans: [
			{ name: "free", price: 0, default: true },
			{ name: "basic", price: 9.99, trialDays: 14 },
			{ name: "premium", price: 29.99 },
		],
		lifecycle: {
			trialToPayRate: 0.55,
			upgradeRate: 0.20,
			downgradeRate: 0.03,
			churnRate: 0.05,
			winBackRate: 0.10,
			winBackDelay: 21,
			paymentFailureRate: 0.02,
		},
	},

	// ── Geo ──────────────────────────────────────
	geo: {
		sticky: true,
		regions: [
			{
				name: "us",
				countries: ["US"],
				weight: 50,
				timezoneOffset: -5,
				properties: { currency: "USD", locale: "en-US" },
			},
			{
				name: "eu",
				countries: ["GB", "DE", "FR"],
				weight: 30,
				timezoneOffset: 1,
				properties: { currency: "EUR", locale: "en-EU", gdpr_consent: true },
			},
			{
				name: "latam",
				countries: ["BR", "MX", "AR"],
				weight: 20,
				timezoneOffset: -3,
				properties: { currency: "BRL", locale: "pt-BR" },
			},
		],
	},

	// ── Features ──────────────────────────────────
	features: [
		{
			name: "video_consultation",
			launchDay: 30,
			adoptionCurve: "fast",
			property: "consultation_mode",
			values: ["phone", "video"],
			defaultBefore: "phone",
			affectsEvents: ["consultation completed", "follow up scheduled"],
		},
		{
			name: "ai_symptom_checker",
			launchDay: 60,
			adoptionCurve: { k: 0.08, midpoint: 25 },
			property: "symptom_source",
			values: ["manual", "ai_assisted"],
			defaultBefore: "manual",
			affectsEvents: ["symptom search"],
			conversionLift: 1.12,
		},
	],

	hook(record, type, meta) {
		if (type === "user") return handleUserHooks(record);
		if (type === "everything") return handleEverythingHooks(record, meta);
		return record;
	},
};

// ── STORIES ──────────────────────────────────────────────────────────────
// Machine-checkable contract for the 10 numbered hooks. Evaluate with:
//   node scripts/verify-stories.mjs dungeons/vertical/healthcare/healthcare.js --data-prefix verify-healthcare

const EV = `read_json_auto('{{PREFIX}}-EVENTS*.json', sample_size=-1, union_by_name=true)`;
const US = `read_json_auto('{{PREFIX}}-USERS*.json', sample_size=-1, union_by_name=true)`;

// Identity prelude. account created is both isAuthEvent and isFirstEvent, so
// born users auth on their very first event and user_id should be present on
// every record; the prelude still resolves through the device pool
// (avgDevicePerUser: 2, "anonymousIds" is the legacy USERS-shard key) as
// belt-and-braces for any device-only edge.
const ID_CTE = `dmap AS (SELECT unnest("anonymousIds") AS device_id, distinct_id FROM ${US}),
ev AS (SELECT coalesce(m.distinct_id::VARCHAR, e.user_id::VARCHAR, e.device_id::VARCHAR) AS uid,
  e.time::TIMESTAMP AS t, e.* FROM ${EV} e LEFT JOIN dmap m ON e.device_id = m.device_id)`;

// Temporal boundaries computed from the same knobs the hooks use (the hook
// parses in UTC, so these UTC timestamps are exact window edges)
const FLU_IN_START_TS = dayjs.utc(DATASET_START).add(FLU_START_DAY, "day").format("YYYY-MM-DD HH:mm:ss");
const FLU_IN_END_TS = dayjs.utc(DATASET_START).add(FLU_END_DAY, "day").format("YYYY-MM-DD HH:mm:ss");
const END_TS = dayjs.utc(DATASET_END).format("YYYY-MM-DD HH:mm:ss");
// H4 window guard: consultations in the last 7 days can't be credited with a
// clone that would land past datasetEnd (future-time guard drops it)
const END_MINUS_7_TS = dayjs.utc(DATASET_END).subtract(7, "day").format("YYYY-MM-DD HH:mm:ss");

// Per-user consultation counts. H10 (and H3) classify on counts taken AFTER
// all filters (H8 free-tier cliff, H6 no-show thinning) and nothing drops
// consultations later, so output-side counts rebuild the hook cohorts exactly.
const CONSULT_CTE = `cc AS (SELECT uid, count(*) AS ct FROM ev WHERE event = 'consultation completed' GROUP BY 1)`;

/** @type {import("../../../types").DungeonStory[]} */
export const stories = [
	{
		id: "H1-after-hours-pricing",
		hook: "H1",
		archetype: "temporal-inflection",
		narrative: `consultations between ${AFTER_HOURS_START}:00 and ${AFTER_HOURS_END}:00 UTC carry consultation_fee × ${AFTER_HOURS_FEE_MULT}. H10's sweet-spot fee boost rides both HOD bins equally (consult-count cohorts are hour-independent), so both the avg and median ratios read the ${AFTER_HOURS_FEE_MULT} knob directly (Math.floor bias < 1%)`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT CASE WHEN extract(hour FROM t) >= ${AFTER_HOURS_START} OR extract(hour FROM t) < ${AFTER_HOURS_END} THEN 'after' ELSE 'business' END AS grp,
 count(*) AS event_count, count(DISTINCT uid) AS user_count,
 avg(consultation_fee) AS avg_fee, median(consultation_fee) AS med_fee
FROM ev WHERE event = 'consultation completed' GROUP BY 1`,
				},
				select: { a: { where: { grp: "after" } }, b: { where: { grp: "business" } } },
				expect: { metric: "a.avg_fee / b.avg_fee", op: "between", target: [1.35, 1.65] },
				minCohort: 400,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT CASE WHEN extract(hour FROM t) >= ${AFTER_HOURS_START} OR extract(hour FROM t) < ${AFTER_HOURS_END} THEN 'after' ELSE 'business' END AS grp,
 count(*) AS event_count, count(DISTINCT uid) AS user_count,
 avg(consultation_fee) AS avg_fee, median(consultation_fee) AS med_fee
FROM ev WHERE event = 'consultation completed' GROUP BY 1`,
				},
				select: { a: { where: { grp: "after" } }, b: { where: { grp: "business" } } },
				// scaling a whole bin scales every quantile: median ratio = knob too
				expect: { metric: "a.med_fee / b.med_fee", op: "between", target: [1.35, 1.65] },
				minCohort: 400,
			},
		],
	},
	{
		id: "H2-flu-season",
		hook: "H2",
		archetype: "temporal-inflection",
		narrative: `days ${FLU_START_DAY}-${FLU_END_DAY}: bookings are forced respiratory at ${FLU_RESPIRATORY_LIKELIHOOD}%, and every in-window respiratory booking gets wait_time_hours × ${FLU_WAIT_MULT}. Expected in-window respiratory share = 0.60 + 0.40 × 1/8 = 0.65 (declared mix is 1-in-8 respiratory); out-window share stays at the declared 0.125. H9's tier scaling rides all conditions equally, so the in-window resp/other wait ratio reads the ×${FLU_WAIT_MULT} knob`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT CASE WHEN t > TIMESTAMP '${FLU_IN_START_TS}' AND t < TIMESTAMP '${FLU_IN_END_TS}' THEN 'in' ELSE 'out' END AS grp,
 count(*) AS event_count, count(DISTINCT uid) AS user_count,
 count(*) FILTER (WHERE condition_type = 'respiratory')::DOUBLE / count(*) AS resp_share,
 avg(wait_time_hours) FILTER (WHERE condition_type = 'respiratory') AS resp_wait,
 avg(wait_time_hours) FILTER (WHERE condition_type <> 'respiratory') AS other_wait
FROM ev WHERE event = 'appointment booked' GROUP BY 1`,
				},
				select: { i: { where: { grp: "in" } } },
				expect: { metric: "i.resp_share", op: "between", target: [0.58, 0.72] },
				minCohort: 200,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT CASE WHEN t > TIMESTAMP '${FLU_IN_START_TS}' AND t < TIMESTAMP '${FLU_IN_END_TS}' THEN 'in' ELSE 'out' END AS grp,
 count(*) AS event_count, count(DISTINCT uid) AS user_count,
 count(*) FILTER (WHERE condition_type = 'respiratory')::DOUBLE / count(*) AS resp_share
FROM ev WHERE event = 'appointment booked' GROUP BY 1`,
				},
				select: { o: { where: { grp: "out" } } },
				// purity: forcing happens only inside the window
				expect: { metric: "o.resp_share", op: "between", target: [0.09, 0.16] },
				minCohort: 200,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT CASE WHEN t > TIMESTAMP '${FLU_IN_START_TS}' AND t < TIMESTAMP '${FLU_IN_END_TS}' THEN 'in' ELSE 'out' END AS grp,
 count(*) AS event_count, count(DISTINCT uid) AS user_count,
 avg(wait_time_hours) FILTER (WHERE condition_type = 'respiratory') AS resp_wait,
 avg(wait_time_hours) FILTER (WHERE condition_type <> 'respiratory') AS other_wait
FROM ev WHERE event = 'appointment booked' GROUP BY 1`,
				},
				select: { i: { where: { grp: "in" } } },
				expect: { metric: "i.resp_wait / i.other_wait", op: "between", target: [1.7, 2.35] },
				minCohort: 200,
			},
		],
	},
	{
		id: "H3-experienced-doctor-satisfaction",
		hook: "H3",
		archetype: "cohort-prop-scale",
		narrative: `users with >${EXPERIENCED_CONSULT_THRESHOLD} consultations get every satisfaction_score redrawn uniform [${EXPERIENCED_SATISFACTION_MIN}, ${EXPERIENCED_SATISFACTION_MAX}] (avg AND median 4.5 — both quantile reads of the uniform). Purity is exact: later hooks only DELETE consultations, so any user still >${EXPERIENCED_CONSULT_THRESHOLD} in the output was boosted — all surviving scores sit in the redrawn range. No ratio-vs-baseline assertion: the declared weighNumRange(1, 5, 0.8, 3) baseline is a 3-value seeded pool (the 4th arg is POOL SIZE, not mode), so the organic mean is not derivable from the schema`,
		assertions: [
			{
				// deterministic purity — a single sub-4.0 score on an
				// output->12-consult user is a hook bug, not sampling noise
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${CONSULT_CTE}
SELECT count(*) FILTER (WHERE e.satisfaction_score < ${EXPERIENCED_SATISFACTION_MIN}) AS below_min,
 count(*) AS scores, count(DISTINCT c.uid) AS exp_users
FROM cc c JOIN ev e ON e.uid = c.uid AND e.event = 'consultation completed'
WHERE c.ct > ${EXPERIENCED_CONSULT_THRESHOLD}`,
				},
				assert: (rows) => {
					const r = (rows || [])[0];
					if (!r || Number(r.exp_users) === 0) return { pass: false, verdict: "NONE", detail: "no >12-consult users" };
					const clean = Number(r.below_min) === 0;
					return {
						pass: clean,
						verdict: clean ? "NAILED" : "INVERSE",
						detail: `below-4.0 scores=${r.below_min} of ${r.scores} across ${r.exp_users} experienced users (must be 0)`,
					};
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${CONSULT_CTE},
lab AS (SELECT uid, CASE WHEN ct > ${EXPERIENCED_CONSULT_THRESHOLD} THEN 'exp' WHEN ct <= 9 THEN 'base' ELSE 'mid' END AS grp FROM cc)
SELECT l.grp, count(DISTINCT l.uid) AS user_count, count(*) AS event_count, avg(e.satisfaction_score) AS avg_sat
FROM lab l JOIN ev e ON e.uid = l.uid AND e.event = 'consultation completed' GROUP BY 1`,
				},
				select: { x: { where: { grp: "exp" } } },
				// uniform [4.0, 5.0] → 4.5
				expect: { metric: "x.avg_sat", op: "between", target: [4.35, 4.65] },
				minCohort: 30,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${CONSULT_CTE}
SELECT 'exp' AS grp, count(DISTINCT c.uid) AS user_count, count(*) AS event_count, median(e.satisfaction_score) AS med_sat
FROM cc c JOIN ev e ON e.uid = c.uid AND e.event = 'consultation completed'
WHERE c.ct > ${EXPERIENCED_CONSULT_THRESHOLD}`,
				},
				select: { x: { where: { grp: "exp" } } },
				// median of uniform [4.0, 5.0] = 4.5 — independent quantile read
				expect: { metric: "x.med_sat", op: "between", target: [4.35, 4.65] },
				minCohort: 30,
			},
		],
	},
	{
		id: "H4-video-followup-lift",
		hook: "H4",
		archetype: "cohort-count-scale",
		narrative: `each video consultation has a ${VIDEO_FOLLOWUP_LIKELIHOOD}% chance to inject one cloned follow-up 1-7 days later. Per-consultation attribution: counting follow-ups within 7d after each consultation, video minus phone reads the 0.6 knob with per-EVENT attribution that cancels user-level activity selection (organic near-rates are mode-blind: a consultation's mode is an iid per-event draw, so both bins sample the same users' timelines). Attenuation: a clone can also land within 7d of a neighboring phone consultation of the same user, inflating the phone bin — hence the band floor below 0.6. Cohort restricted to users with ≥1 follow-up (clone requires an organic template) and consultations ≥7d before datasetEnd (clones past the end are future-guard dropped). Deliberately single-assertion: user-level composites (video-users vs phone-only fu-per-consult) were tested and rejected — conditioning on fus>0 inflates the low-activity phone-only group, and tier/persona sampling coupling plus the video_consultation feature's launch-gated mode mix make any user-level band underivable from knobs`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
fu_users AS (SELECT DISTINCT uid FROM ev WHERE event = 'follow up scheduled'),
cons AS (SELECT e.uid, e.t, e.consultation_mode AS mode
  FROM ev e JOIN fu_users f ON f.uid = e.uid
  WHERE e.event = 'consultation completed' AND e.t <= TIMESTAMP '${END_MINUS_7_TS}'),
cnt AS (SELECT c.uid, c.mode, c.t, count(fu.uid) AS fu7
  FROM cons c LEFT JOIN ev fu ON fu.uid = c.uid AND fu.event = 'follow up scheduled'
    AND fu.t > c.t AND fu.t <= c.t + INTERVAL 7 DAY
  GROUP BY 1, 2, 3)
SELECT mode AS grp, count(*) AS consults, count(DISTINCT uid) AS user_count, avg(fu7) AS avg_fu7
FROM cnt GROUP BY 1`,
				},
				select: { v: { where: { grp: "video" } }, p: { where: { grp: "phone" } } },
				expect: { metric: "v.avg_fu7 - p.avg_fu7", op: "between", target: [0.33, 0.78] },
				minCohort: 150,
			},
		],
	},
	{
		id: "H5-chronic-refill-chain",
		hook: "H5",
		archetype: "cohort-count-scale",
		narrative: `each chronic prescription spawns ${CHRONIC_REFILL_MIN}-${CHRONIC_REFILL_MAX} cloned refills at ~${CHRONIC_REFILL_INTERVAL_DAYS}d intervals (condition_type=chronic, medication_type=chronic_maintenance, refill_count=i); clones past datasetEnd are future-guard dropped. The assertion rebuilds the survival model per prescription from its actual date (attempt i at +${CHRONIC_REFILL_INTERVAL_DAYS}·i days; P(n≥3)=2/3, P(n≥4)=1/3 from the uniform 2-4 draw), subtracts the organic chronic∧chronic_maintenance baseline measured on non-chronic-rx users (declared mix: 2/7 × 1/8 ≈ 0.036), and checks measured clones ÷ model expectation ≈ 1. Cohort restricted to chronic-rx users with ≥1 refill (the hook needs an organic template)`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
refill_users AS (SELECT DISTINCT uid FROM ev WHERE event = 'prescription refill'),
crx AS (SELECT e.uid, e.t FROM ev e JOIN refill_users ru ON ru.uid = e.uid
  WHERE e.event = 'prescription issued' AND e.condition_type = 'chronic'),
cohort AS (SELECT uid FROM crx GROUP BY 1),
exp_calc AS (SELECT sum(
   CASE WHEN t + INTERVAL 30 DAY <= TIMESTAMP '${END_TS}' THEN 1.0 ELSE 0 END
 + CASE WHEN t + INTERVAL 60 DAY <= TIMESTAMP '${END_TS}' THEN 1.0 ELSE 0 END
 + (2.0/3) * (CASE WHEN t + INTERVAL 90 DAY <= TIMESTAMP '${END_TS}' THEN 1.0 ELSE 0 END)
 + (1.0/3) * (CASE WHEN t + INTERVAL 120 DAY <= TIMESTAMP '${END_TS}' THEN 1.0 ELSE 0 END)) AS expected_clones
  FROM crx),
r AS (SELECT e.uid, (e.condition_type = 'chronic' AND e.medication_type = 'chronic_maintenance') AS is_cm,
  (c.uid IS NOT NULL) AS in_cohort
  FROM ev e LEFT JOIN cohort c ON c.uid = e.uid WHERE e.event = 'prescription refill'),
agg AS (SELECT count(*) FILTER (WHERE in_cohort) AS t_coh,
  count(*) FILTER (WHERE in_cohort AND is_cm) AS cm_coh,
  count(*) FILTER (WHERE NOT in_cohort) AS t_non,
  count(*) FILTER (WHERE NOT in_cohort AND is_cm) AS cm_non FROM r)
SELECT 'all' AS grp, (SELECT count(*) FROM cohort) AS user_count,
 a.cm_non::DOUBLE / nullif(a.t_non, 0) AS organic_cm_rate,
 ((a.cm_coh - (a.cm_non::DOUBLE / nullif(a.t_non, 0)) * a.t_coh)
   / (1 - (a.cm_non::DOUBLE / nullif(a.t_non, 0)))) / nullif(x.expected_clones, 0) AS clone_yield
FROM agg a, exp_calc x`,
				},
				select: { all: { where: { grp: "all" } } },
				// ±3d jitter and boundary effects keep this near but not at 1.0
				expect: { metric: "all.clone_yield", op: "between", target: [0.7, 1.35] },
				minCohort: 80,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
refill_users AS (SELECT DISTINCT uid FROM ev WHERE event = 'prescription refill'),
crx AS (SELECT e.uid, e.t FROM ev e JOIN refill_users ru ON ru.uid = e.uid
  WHERE e.event = 'prescription issued' AND e.condition_type = 'chronic'),
cohort AS (SELECT uid FROM crx GROUP BY 1)
SELECT 'all' AS grp, count(*) AS event_count, count(DISTINCT e.uid) AS user_count,
 count(*) FILTER (WHERE e.condition_type = 'chronic' AND e.medication_type = 'chronic_maintenance')::DOUBLE / count(*) AS cm_rate
FROM ev e LEFT JOIN cohort c ON c.uid = e.uid
WHERE e.event = 'prescription refill' AND c.uid IS NULL`,
				},
				select: { all: { where: { grp: "all" } } },
				// placebo: non-chronic-rx users' refills carry only the declared
				// organic chronic∧chronic_maintenance mix (2/7 × 1/8 ≈ 0.036)
				expect: { metric: "all.cm_rate", op: "between", target: [0.015, 0.06] },
				minCohort: 200,
			},
		],
	},
	{
		id: "H6-occasional-no-shows",
		hook: "H6",
		archetype: "cohort-count-scale",
		narrative: `users with <${NO_SHOW_EVENT_THRESHOLD} events (at hook time, clones included) lose ${NO_SHOW_DROP_LIKELIHOOD}% of consultations and get no_show=true on ${NO_SHOW_DROP_LIKELIHOOD}% of bookings. The flag gives selection-free verification of a per-event effect on an activity-selected cohort: flagged ⇒ hook-count ≤ 14 ⇒ output count ≤ 14 (everything after only deletes), so users with ≥15 output events provably carry ZERO no_show=true rows (exact purity), and the no_show rate among ≤14-event users reads the knob (diluted slightly by unflagged users who slipped under 15 when future-dated clones were guard-dropped). The consultation-drop side is asserted as a direction-only composite: the flagged cohort is dominated by occasional/churner personas whose conversionModifier (0.7/0.3) organically lowers consult-per-booking, and H8's free-tier cliff skews zero-consult users into the small bin — the engineered 25% thinning is inseparable from that selection, which is exactly why the no_show flag exists`,
		assertions: [
			{
				// deterministic purity
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
tot AS (SELECT uid, count(*) AS ct FROM ev GROUP BY 1)
SELECT count(*) FILTER (WHERE e.no_show = true AND t2.ct >= ${NO_SHOW_EVENT_THRESHOLD}) AS big_noshows,
 count(*) FILTER (WHERE e.no_show = true) AS all_noshows,
 count(DISTINCT t2.uid) FILTER (WHERE t2.ct < ${NO_SHOW_EVENT_THRESHOLD}) AS small_users
FROM ev e JOIN tot t2 ON t2.uid = e.uid WHERE e.event = 'appointment booked'`,
				},
				assert: (rows) => {
					const r = (rows || [])[0];
					if (!r || Number(r.all_noshows) === 0) return { pass: false, verdict: "NONE", detail: "no no_show=true bookings at all" };
					const clean = Number(r.big_noshows) === 0;
					return {
						pass: clean,
						verdict: clean ? "NAILED" : "INVERSE",
						detail: `no_show=true on ≥15-event users: ${r.big_noshows} of ${r.all_noshows} total (must be 0; small-bin users=${r.small_users})`,
					};
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
tot AS (SELECT uid, count(*) AS ct FROM ev GROUP BY 1),
bk AS (SELECT e.uid, count(*) AS bookings, count(*) FILTER (WHERE e.no_show = true) AS noshows
  FROM ev e JOIN tot t2 ON t2.uid = e.uid
  WHERE e.event = 'appointment booked' AND t2.ct < ${NO_SHOW_EVENT_THRESHOLD} GROUP BY 1)
SELECT 'small' AS grp, count(*) AS user_count,
 sum(noshows)::DOUBLE / nullif(sum(bookings), 0) AS ns_rate
FROM bk`,
				},
				select: { s: { where: { grp: "small" } } },
				expect: { metric: "s.ns_rate", op: "between", target: [0.15, 0.3] },
				minCohort: 150,
			},
			{
				// composite direction check (selection + engineered thinning)
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
tot AS (SELECT uid, count(*) AS ct FROM ev GROUP BY 1),
per AS (SELECT t2.uid, (t2.ct >= ${NO_SHOW_EVENT_THRESHOLD}) AS big,
  count(*) FILTER (WHERE e.event = 'appointment booked') AS bk,
  count(*) FILTER (WHERE e.event = 'consultation completed') AS cons
  FROM tot t2 JOIN ev e ON e.uid = t2.uid GROUP BY 1, 2)
SELECT CASE WHEN big THEN 'big' ELSE 'small' END AS grp, count(*) AS user_count,
 sum(cons)::DOUBLE / nullif(sum(bk), 0) AS cons_per_bk
FROM per WHERE bk > 0 GROUP BY 1`,
				},
				select: { s: { where: { grp: "small" } }, b: { where: { grp: "big" } } },
				expect: { metric: "s.cons_per_bk / b.cons_per_bk", op: "between", target: [0.2, 0.85] },
				minCohort: 150,
			},
		],
	},
	{
		id: "H7-doctor-specialization",
		hook: "H7",
		archetype: "cohort-prop-scale",
		narrative: `user hook: doctors get specialty from a real list and years_experience uniform [${DOCTOR_EXPERIENCE_MIN}, ${DOCTOR_EXPERIENCE_MAX}] (avg 22.5); nurses uniform [${NURSE_EXPERIENCE_MIN}, ${NURSE_EXPERIENCE_MAX}] (avg 9); patients pinned to 0. Deterministic per-role ranges — range violations are hook bugs, not noise`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT role AS grp, count(*) AS user_count,
 avg(years_experience) AS avg_yx, min(years_experience) AS min_yx, max(years_experience) AS max_yx,
 count(*) FILTER (WHERE specialty = 'none') AS none_ct
FROM ${US} GROUP BY 1`,
				},
				assert: (rows) => {
					const by = Object.fromEntries((rows || []).map(r => [r.grp, r]));
					const d = by.doctor, n = by.nurse, p = by.patient;
					if (!d || !n || !p) return { pass: false, verdict: "NONE", detail: `missing role rows (${(rows || []).map(r => r.grp).join(",")})` };
					const bad = [];
					if (Number(d.min_yx) < DOCTOR_EXPERIENCE_MIN || Number(d.max_yx) > DOCTOR_EXPERIENCE_MAX) bad.push(`doctor yx [${d.min_yx}, ${d.max_yx}] outside [${DOCTOR_EXPERIENCE_MIN}, ${DOCTOR_EXPERIENCE_MAX}]`);
					if (Number(d.none_ct) !== 0) bad.push(`${d.none_ct} doctors with specialty='none'`);
					if (Number(n.min_yx) < NURSE_EXPERIENCE_MIN || Number(n.max_yx) > NURSE_EXPERIENCE_MAX) bad.push(`nurse yx [${n.min_yx}, ${n.max_yx}] outside [${NURSE_EXPERIENCE_MIN}, ${NURSE_EXPERIENCE_MAX}]`);
					if (Number(p.min_yx) !== 0 || Number(p.max_yx) !== 0) bad.push(`patient yx [${p.min_yx}, ${p.max_yx}] not pinned to 0`);
					return {
						pass: bad.length === 0,
						verdict: bad.length === 0 ? "NAILED" : "INVERSE",
						detail: bad.length ? bad.join("; ") : `ranges exact: doctor [${d.min_yx}, ${d.max_yx}], nurse [${n.min_yx}, ${n.max_yx}], patient pinned 0 (${d.user_count}/${n.user_count}/${p.user_count} users)`,
					};
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT role AS grp, count(*) AS user_count, avg(years_experience) AS avg_yx FROM ${US} GROUP BY 1`,
				},
				select: { d: { where: { grp: "doctor" } } },
				expect: { metric: "d.avg_yx", op: "between", target: [21, 24] },
				minCohort: 40,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT role AS grp, count(*) AS user_count, avg(years_experience) AS avg_yx FROM ${US} GROUP BY 1`,
				},
				select: { n: { where: { grp: "nurse" } } },
				expect: { metric: "n.avg_yx", op: "between", target: [8, 10] },
				minCohort: 80,
			},
		],
	},
	{
		id: "H8-free-tier-cliff",
		hook: "H8",
		archetype: "funnel-conversion-by-segment",
		narrative: `${FREE_TIER_DROP_LIKELIHOOD}% of free-tier users lose ALL consultations (per-user cliff). Estimator: (z_free − z_paid) / (1 − z_paid) where z = zero-consultation user share — the natural-zero baseline z cancels, and tier-blind processes (H6 thinning) cancel too, so the statistic reads the 0.30 knob directly. Sharp discriminator vs per-event thinning: SURVIVING free users are untouched, so their consult counts must match basic users (ratio ≈ 1.0); thinning would read ~0.7. The survivor comparison is SEGMENT-STANDARDIZED: tier and persona are sampled from the same seeded stream and come out measurably correlated (free skews occasional, premium skews provider), and persona eventModifier drives volume — raw cross-tier count comparisons are confounded by composition, standardizing on the persona-stamped segment removes it (thinning would still read ~0.7 within every segment)`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
per AS (SELECT u.distinct_id::VARCHAR AS uid, u.subscription_tier AS tier FROM ${US} u),
cons AS (SELECT uid, count(*) AS ct FROM ev WHERE event = 'consultation completed' GROUP BY 1),
j AS (SELECT p.tier, coalesce(c.ct, 0) AS ct FROM per p LEFT JOIN cons c ON c.uid = p.uid),
z AS (SELECT count(*) AS user_count,
 count(*) FILTER (WHERE tier = 'free' AND ct = 0)::DOUBLE / nullif(count(*) FILTER (WHERE tier = 'free'), 0) AS z_free,
 count(*) FILTER (WHERE tier <> 'free' AND ct = 0)::DOUBLE / nullif(count(*) FILTER (WHERE tier <> 'free'), 0) AS z_paid
 FROM j)
SELECT 'all' AS grp, user_count, z_free, z_paid,
 (z_free - z_paid) / nullif(1 - z_paid, 0) AS cliff_share FROM z`,
				},
				select: { all: { where: { grp: "all" } } },
				expect: { metric: "all.cliff_share", op: "between", target: [0.24, 0.36] },
				minCohort: 500,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
cons AS (SELECT uid, count(*) AS ct FROM ev WHERE event = 'consultation completed' GROUP BY 1),
surv AS (SELECT u.subscription_tier AS tier, u.segment AS seg, c.ct
  FROM ${US} u JOIN cons c ON c.uid = u.distinct_id::VARCHAR),
seg AS (SELECT seg,
  avg(ct) FILTER (WHERE tier = 'free') AS f_avg, count(*) FILTER (WHERE tier = 'free') AS f_n,
  avg(ct) FILTER (WHERE tier = 'basic') AS b_avg, count(*) FILTER (WHERE tier = 'basic') AS b_n
  FROM surv GROUP BY 1)
SELECT 'all' AS grp, sum(f_n + b_n)::BIGINT AS user_count,
 sum(f_n * f_avg / b_avg) / sum(f_n) AS std_ratio
FROM seg WHERE f_avg IS NOT NULL AND b_avg IS NOT NULL AND b_n >= 10`,
				},
				select: { all: { where: { grp: "all" } } },
				// per-user cliff, not thinning: survivors untouched → ratio ≈ 1.0
				// (b_n >= 10 is a stability guard against tiny-segment blowup)
				expect: { metric: "all.std_ratio", op: "between", target: [0.9, 1.1] },
				minCohort: 500,
			},
			{
				// the documented Mixpanel funnel report, through the emulator.
				// Window = funnel's 48h × H9's max stretch 1.4 (the free-tier
				// timestamp scaling rides this funnel's booked→consult gap).
				// Composite: the cliff (×0.7) compounds with H9 window censoring
				// on free — band sits below the pure-cliff 0.70
				breakdown: {
					type: "timeToConvert",
					steps: ["symptom search", "appointment booked", "consultation completed"],
					breakdownByUserProperty: "subscription_tier",
					conversionWindowMs: Math.round(48 * TTC_FREE_FACTOR * 3600 * 1000),
				},
				assert: (rows) => {
					const by = Object.fromEntries((rows || []).map(r => [r.segment_value, r]));
					const f = by.free, b = by.basic;
					if (!f || !b) return { pass: false, verdict: "NONE", detail: `missing tier rows (${(rows || []).map(r => r.segment_value).join(",")})` };
					const cf = f.step_counts[2] / f.step_counts[0];
					const cb = b.step_counts[2] / b.step_counts[0];
					const ratio = cf / cb;
					const pass = ratio >= 0.55 && ratio <= 0.8;
					return {
						pass,
						verdict: pass ? (Math.abs(ratio - 0.7) <= 0.07 ? "NAILED" : "STRONG") : (ratio < 1 ? "WEAK" : "INVERSE"),
						detail: `funnel conversion free=${cf.toFixed(4)} basic=${cb.toFixed(4)} ratio=${ratio.toFixed(3)} (expect ~0.70, band [0.55, 0.80]; entered free=${f.step_counts[0]} basic=${b.step_counts[0]})`,
					};
				},
			},
		],
	},
	{
		id: "H9-ttc-by-tier",
		hook: "H9",
		archetype: "funnel-ttc-by-segment",
		narrative: `premium × ${TTC_PREMIUM_FACTOR} / free × ${TTC_FREE_FACTOR} on (a) wait_time_hours and duration_minutes (iid property scale — avg ratios read the knobs exactly; H2's flu doubling is tier-blind and cancels) and (b) the first booked→consult→follow-up sequence's timestamps (scaleFunnelTTC). The TTC assertions run through the Mixpanel-aligned emulator at a 2016h conversion window = max stretch ${TTC_FREE_FACTOR} × (2 gaps × 30d per-gap cap in findFirstSequence) — the window must cover the stretched support or censoring dilutes the free tier (the ai-platform H9 lesson). Only each user's FIRST sequence is scaled and the emulator's greedy first-conversion aligns with findFirstSequence's greedy scan, but organic re-conversions still dilute the measured ratio toward 1 — bands assume ≥25% of the full effect survives`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT subscription_tier AS grp, count(*) AS event_count, count(DISTINCT uid) AS user_count, avg(wait_time_hours) AS avg_wait
FROM ev WHERE event = 'appointment booked' GROUP BY 1`,
				},
				select: { f: { where: { grp: "free" } }, b: { where: { grp: "basic" } } },
				expect: { metric: "f.avg_wait / b.avg_wait", op: "between", target: [1.26, 1.54] },
				minCohort: 300,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT subscription_tier AS grp, count(*) AS event_count, count(DISTINCT uid) AS user_count, avg(wait_time_hours) AS avg_wait
FROM ev WHERE event = 'appointment booked' GROUP BY 1`,
				},
				select: { p: { where: { grp: "premium" } }, b: { where: { grp: "basic" } } },
				expect: { metric: "p.avg_wait / b.avg_wait", op: "between", target: [0.6, 0.74] },
				minCohort: 300,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT subscription_tier AS grp, count(*) AS event_count, count(DISTINCT uid) AS user_count, avg(duration_minutes) AS avg_dur
FROM ev WHERE event = 'consultation completed' GROUP BY 1`,
				},
				select: { f: { where: { grp: "free" } }, b: { where: { grp: "basic" } } },
				expect: { metric: "f.avg_dur / b.avg_dur", op: "between", target: [1.26, 1.54] },
				minCohort: 300,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT subscription_tier AS grp, count(*) AS event_count, count(DISTINCT uid) AS user_count, avg(duration_minutes) AS avg_dur
FROM ev WHERE event = 'consultation completed' GROUP BY 1`,
				},
				select: { p: { where: { grp: "premium" } }, b: { where: { grp: "basic" } } },
				expect: { metric: "p.avg_dur / b.avg_dur", op: "between", target: [0.6, 0.74] },
				minCohort: 300,
			},
			{
				breakdown: {
					type: "timeToConvert",
					steps: ["appointment booked", "consultation completed", "follow up scheduled"],
					breakdownByUserProperty: "subscription_tier",
					// 2016h = 1.4 × 2 gaps × 30d per-gap cap (covers stretched support)
					conversionWindowMs: 2016 * 60 * 60 * 1000,
				},
				select: { f: { where: { segment_value: "free" } }, b: { where: { segment_value: "basic" } } },
				expect: { metric: "f.median_ttc_ms / b.median_ttc_ms", op: "between", target: [1.04, 1.44] },
				minCohort: 150,
			},
			{
				breakdown: {
					type: "timeToConvert",
					steps: ["appointment booked", "consultation completed", "follow up scheduled"],
					breakdownByUserProperty: "subscription_tier",
					conversionWindowMs: 2016 * 60 * 60 * 1000,
				},
				select: { p: { where: { segment_value: "premium" } }, b: { where: { segment_value: "basic" } } },
				expect: { metric: "p.median_ttc_ms / b.median_ttc_ms", op: "between", target: [0.6, 0.97] },
				minCohort: 150,
			},
		],
	},
	{
		id: "H10-consult-count-magic-number",
		hook: "H10",
		archetype: "frequency-sweet-spot",
		narrative: `sweet ${CONSULT_SWEET_MIN}-${CONSULT_SWEET_MAX} consultations → consultation_fee × ${CONSULT_FEE_BOOST}; over ${CONSULT_OVER_THRESHOLD}+ → days_until_followup × ${CONSULT_FOLLOWUP_STRETCH}. Both are property-only mutations on cohorts the output rebuilds exactly (counts run after all filters). Median ratios are selection-free: scaling a whole cohort's iid draws scales every quantile by the knob. H1's after-hours boost rides all count-cohorts equally (hours are count-independent). The days assertion filters to consultation_mode='phone' follow-ups — H4's injected clones are always video with a different days distribution, and the over-cohort receives more clones`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${CONSULT_CTE},
coh AS (SELECT uid, CASE WHEN ct BETWEEN ${CONSULT_SWEET_MIN} AND ${CONSULT_SWEET_MAX} THEN 'sweet'
  WHEN ct >= ${CONSULT_OVER_THRESHOLD} THEN 'over' ELSE 'low' END AS grp FROM cc)
SELECT c.grp, count(DISTINCT c.uid) AS user_count, count(*) AS event_count, median(e.consultation_fee) AS med_fee
FROM coh c JOIN ev e ON e.uid = c.uid AND e.event = 'consultation completed' GROUP BY 1`,
				},
				select: { s: { where: { grp: "sweet" } }, l: { where: { grp: "low" } } },
				expect: { metric: "s.med_fee / l.med_fee", op: "between", target: [1.12, 1.4] },
				minCohort: 60,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${CONSULT_CTE},
coh AS (SELECT uid, CASE WHEN ct BETWEEN ${CONSULT_SWEET_MIN} AND ${CONSULT_SWEET_MAX} THEN 'sweet'
  WHEN ct >= ${CONSULT_OVER_THRESHOLD} THEN 'over' ELSE 'low' END AS grp FROM cc)
SELECT c.grp, count(DISTINCT c.uid) AS user_count, count(*) AS event_count, median(e.days_until_followup) AS med_days
FROM coh c JOIN ev e ON e.uid = c.uid AND e.event = 'follow up scheduled' AND e.consultation_mode = 'phone'
GROUP BY 1`,
				},
				select: { o: { where: { grp: "over" } }, s: { where: { grp: "sweet" } } },
				// Math.round on small integer days adds up to ~5% bias
				expect: { metric: "o.med_days / s.med_days", op: "between", target: [1.3, 1.75] },
				minCohort: 60,
			},
		],
	},
];

export default config;
