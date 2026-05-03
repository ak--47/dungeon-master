// ── TWEAK THESE ──
const SEED = "dm4-healthcare";
const num_days = 120;
const num_users = 10_000;
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

// Generate consistent doctor/clinic IDs at module level
const doctorIds = v.range(1, 120).map(() => `DR_${v.uid(6)}`);
const clinicIds = v.range(1, 25).map(() => `CLINIC_${v.uid(4)}`);

/**
 * ═══════════════════════════════════════════════════════════════
 * DATASET OVERVIEW
 * ═══════════════════════════════════════════════════════════════
 *
 * MedConnect — a telehealth platform connecting doctors, nurses,
 * and patients through virtual consultations, prescriptions,
 * and secure messaging.
 *
 * - 5,000 users over 100 days, ~600K events
 * - Multi-role system: doctors (5%), nurses (10%), patients (85%)
 * - Core loop: sign up → book appointment → consultation → prescription → follow-up
 * - Revenue: free (2 visits/month), basic ($9.99, 14-day trial), premium ($29.99 unlimited)
 *
 * Advanced Features:
 * - Personas: 5 archetypes (doctor, nurse, patient_active, patient_occasional, patient_churner)
 * - Subscription: 3-tier revenue lifecycle with trial conversion
 * - Geo: US/EU/LATAM with timezone-aware scheduling and regional compliance
 * - Features: video_consultation (day 30) and ai_symptom_checker (day 60)
 *
 * Key entities:
 * - doctor_id: assigned doctor for a consultation
 * - clinic_id: virtual clinic grouping
 * - condition_type: medical specialty area
 * - consultation_mode: phone vs video (driven by Feature rollout)
 */

/**
 * ═══════════════════════════════════════════════════════════════
 * ANALYTICS HOOKS (10 hooks)
 *
 * NOTE: All cohort effects are HIDDEN — no flag stamping. Discoverable
 * via raw-prop breakdowns (HOD, day, tier) or behavioral cohorts.
 * ═══════════════════════════════════════════════════════════════
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
 * PATTERN: Users who had >50 consultation events get higher avg
 * satisfaction_score (boosted to 4.0-5.0 range) vs baseline 1-5.
 * Simulates experienced doctors earning better reviews.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Satisfaction by Consultation Volume
 *   • Report type: Insights
 *   • Event: "consultation completed"
 *   • Measure: Average of "satisfaction_score"
 *   • Breakdown: user property "role"
 *   • Expected: Doctors (high volume users) show ~4.2 avg vs ~3.5 baseline
 *
 * REAL-WORLD ANALOGUE: Experienced providers develop better bedside
 * manner and patient communication skills over time.
 *
 * ───────────────────────────────────────────────────────────────
 * 4. VIDEO CONSULTATION FOLLOW-UP LIFT (everything hook)
 * ───────────────────────────────────────────────────────────────
 *
 * PATTERN: Patients whose consultations used video mode (vs phone)
 * get 2x more follow-up appointment events injected. Cloned from
 * existing "follow up scheduled" events.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Follow-Up Rate by Consultation Mode
 *   • Report type: Insights
 *   • Event: "follow up scheduled"
 *   • Measure: Total per user
 *   • Breakdown: "consultation_mode" (from consultation completed)
 *   • Expected: video users ~2x more follow-ups than phone users
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
 * PATTERN: Users with role "patient" and low event count (<15 events)
 * have 25% of their "appointment booked" events dropped. Simulates
 * occasional patients who book but don't show up.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Appointment-to-Consultation Ratio
 *   • Report type: Funnels
 *   • Steps: "appointment booked" → "consultation completed"
 *   • Breakdown: user property "role"
 *   • Expected: patients with fewer events convert ~75% vs ~95% for active
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
 * PATTERN: Free-tier users lose ~30% of "consultation completed"
 * events (last step of the Booking to Consultation funnel).
 * This is implemented via event filtering in the everything hook
 * rather than conversionRate modification in funnel-pre, so the
 * effect is not diluted by organic (non-funnel) events.
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
 * 9. BOOKING FUNNEL TIME-TO-CONVERT (funnel-post)
 *
 * PATTERN: Premium tier completes Booking funnel 1.35x faster
 * (factor 0.74); Free tier 1.33x slower (factor 1.33).
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Booking Funnel Median Time-to-Convert by Tier
 *   - Funnels > "symptom search" -> "appointment booked" -> "consultation completed"
 *   - Measure: Median time to convert
 *   - Breakdown: subscription_tier
 *   - Expected: premium ~ 0.74x; free ~ 1.33x
 *
 *   NOTE (funnel-post measurement): visible only via Mixpanel funnel
 *   median TTC. Cross-event MIN→MIN SQL queries on raw events do NOT
 *   show this — funnel-post adjusts gaps within funnel instances, not
 *   across the user's full event history.
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
 * Hook                        | Metric              | Baseline | Effect    | Ratio
 * ----------------------------|---------------------|----------|-----------|------
 * After-Hours Pricing         | consultation_fee    | 1x       | 1.5x      | 1.5x
 * Flu Season Spike            | respiratory share   | ~ 15%    | ~ 60%     | 4x
 * Experienced Doctor Sat.     | satisfaction_score  | 3.5      | 4.2       | 1.2x
 * Video Follow-Up Lift        | follow-ups/user     | 1x       | 2x        | 2x
 * Chronic Refill Chain        | refills (chronic)   | 1        | 3-4       | 3-4x
 * Occasional No-Shows         | booking→consult     | 95%      | 75%       | -20%
 * Doctor Specialization       | years_experience    | 5        | 22        | 4.4x
 * Free-Tier Conversion Drop   | funnel conversion   | 40%      | 28%       | -30%
 * Booking T2C                 | median min by tier  | 1x       | 0.74/1.33x| ~ 1.8x range
 * Consult-Count Magic Number  | sweet consult fee   | 1x       | 1.25x     | 1.25x
 * Consult-Count Magic Number  | over days_until_fu  | 1x       | 1.5x      | +50%
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
			properties: {
				doctor_id: chance.pickone.bind(chance, doctorIds),
				clinic_id: chance.pickone.bind(chance, clinicIds),
				condition_type: ["general", "general", "general", "respiratory", "dermatology", "mental_health", "chronic", "pediatric"],
				wait_time_hours: u.weighNumRange(1, 72, 0.4),
				appointment_type: ["new_patient", "follow_up", "follow_up", "urgent", "routine", "routine"],
			},
		},
		{
			event: "consultation completed",
			weight: 5,
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

	// ── Hook Function ──────────────────────────────────────
	hook: function (record, type, meta) {
		// ── HOOK 7: DOCTOR PROFILE SPECIALIZATION (user) ─────
		// Doctors get a real specialty and senior years_experience.
		// Nurses get mid-range experience. Patients stay at defaults.
		if (type === "user") {
			if (record.role === "doctor") {
				record.specialty = chance.pickone(["cardiology", "dermatology", "pediatrics", "psychiatry", "general_practice", "pulmonology", "endocrinology"]);
				record.years_experience = chance.integer({ min: 15, max: 30 });
			} else if (record.role === "nurse") {
				record.specialty = chance.pickone(["general_practice", "pediatrics", "emergency"]);
				record.years_experience = chance.integer({ min: 3, max: 15 });
			} else {
				record.years_experience = 0;
			}
		}

		// HOOK 9 (T2C): BOOKING FUNNEL TIME-TO-CONVERT (funnel-post)
		// Premium tier completes Booking funnel 1.35x faster (factor 0.74);
		// Free tier 1.33x slower (factor 1.33).
		if (type === "funnel-post") {
			const segment = meta?.profile?.subscription_tier;
			if (Array.isArray(record) && record.length > 1) {
				const factor = (
					segment === "premium" ? 0.74 :
					segment === "free" ? 1.33 :
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

		// (HOOK 1: AFTER-HOURS SURGE PRICING moved to everything hook — hour checks
		// must run after bunchIntoSessions redistributes timestamps)
		// (HOOK 2: FLU SEASON SPIKE moved to everything hook — same reason)

		// ── EVERYTHING HOOKS ─────────────────────────────────
		if (type === "everything") {
			if (!record.length) return record;
			const profile = meta.profile;
			const datasetStart = dayjs.unix(meta.datasetStart);
			const FLU_START = datasetStart.add(50, "days");
			const FLU_END = datasetStart.add(70, "days");

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

			// HOOK 1: AFTER-HOURS SURGE PRICING — consultations 7PM-7AM
			// UTC get consultation_fee 1.5x. No flag — discover via HOD chart.
			record.forEach(e => {
				if (e.event === "consultation completed" || e.event === "appointment booked") {
					const hour = new Date(e.time).getUTCHours();
					if ((hour >= 19 || hour < 7) && e.consultation_fee) {
						e.consultation_fee = Math.floor(e.consultation_fee * 1.5);
					}
				}
			});

			// HOOK 2: FLU SEASON SPIKE — d50-70 respiratory dominates, wait_time doubles.
			// Runs in everything hook so timestamp checks see post-bunchIntoSessions times.
			record.forEach(e => {
				if (e.event !== "appointment booked") return;
				const t = dayjs(e.time);
				if (t.isAfter(FLU_START) && t.isBefore(FLU_END)) {
					if (chance.bool({ likelihood: 60 })) e.condition_type = "respiratory";
					if (e.condition_type === "respiratory") {
						e.wait_time_hours = Math.floor((e.wait_time_hours || 12) * 2);
					}
				}
			});

			// ── HOOK 8: FREE-TIER CONVERSION DROP ────────────
			// Free-tier users lose ~30% of "consultation completed" events
			// (last step of Booking to Consultation funnel), simulating
			// lower conversion for non-paying patients.
			if (profile && profile.subscription_tier === "free" && chance.bool({ likelihood: 30 })) {
				record = record.filter(e => e.event !== "consultation completed");
			}

			// ── HOOK 3: EXPERIENCED DOCTOR SATISFACTION ──────
			// Users with >50 consultation events get boosted satisfaction scores.
			let consultCount = 0;
			record.forEach(e => {
				if (e.event === "consultation completed") consultCount++;
			});

			if (consultCount > 50) {
				record.forEach(e => {
					if (e.event === "consultation completed") {
						e.satisfaction_score = chance.floating({ min: 4.0, max: 5.0, fixed: 1 });
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
						if (chance.bool({ likelihood: 60 })) {
							record.push({
								...templateFollowUp,
								time: dayjs(vc.time).add(chance.integer({ min: 1, max: 7 }), "days").toISOString(),
								user_id: vc.user_id,
								consultation_mode: "video",
								days_until_followup: chance.integer({ min: 3, max: 14 }),
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
						const refillsToAdd = chance.integer({ min: 2, max: 4 });
						for (let i = 1; i <= refillsToAdd; i++) {
							record.push({
								...templateRefill,
								time: rxTime.add(30 * i + chance.integer({ min: -3, max: 3 }), "days").toISOString(),
								user_id: rx.user_id,
								condition_type: "chronic",
								medication_type: "chronic_maintenance",
								refill_count: i,
							});
						}
					});
				}
			}

			// HOOK 6: OCCASIONAL PATIENT NO-SHOWS — low-activity patients
			// (< 15 events) lose 25% of consultations (they booked but didn't show).
			if (record.length < 15) {
				for (let i = record.length - 1; i >= 0; i--) {
					if (record[i].event === "consultation completed" && chance.bool({ likelihood: 25 })) {
						record.splice(i, 1);
					}
				}
			}

			// HOOK 10: CONSULTATION-COUNT MAGIC NUMBER (no flags)
			// Sweet 3-6 consultations → +25% on consultation_fee. Over 7+ →
			// drop 30% of "follow up scheduled" events (over-consulted →
			// follow-up fatigue).
			const consultCt = record.filter(e => e.event === "consultation completed").length;
			if (consultCt >= 3 && consultCt <= 6) {
				record.forEach(e => {
					if (e.event === "consultation completed" && typeof e.consultation_fee === "number") {
						e.consultation_fee = Math.round(e.consultation_fee * 1.25);
					}
				});
			} else if (consultCt >= 7) {
				record.forEach(e => {
					if (e.event === "follow up scheduled" && typeof e.days_until_followup === "number") {
						e.days_until_followup = Math.round(e.days_until_followup * 1.5);
					}
				});
			}

			return record;
		}

		return record;
	},
};

export default config;
