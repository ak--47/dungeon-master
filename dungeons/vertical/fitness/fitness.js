// ── IMPORTS ──
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);
import "dotenv/config";
import * as u from "@ak--47/dungeon-master/utils";
import { hashFloat, cloneEvent } from "@ak--47/dungeon-master/hook-helpers";
/** @typedef  {import("../../../types").Dungeon} Config */

// ── OVERVIEW ──
/*
 * NAME:       Stridewell
 * APP:        Consumer fitness app: plan a workout, do it (phone or wearable
 *             tracked), check progress, join solo or team challenges, book
 *             human coach sessions, log meals. Free tier plus Stridewell Plus
 *             (Monthly $12.99 → $14.99 from 2026-09-01, Annual $99.99).
 *             New members get one 7-day trial; Stride Coach (AI coaching) is a
 *             Plus feature from 2026-08-12.
 * SCALE:      10,000 users (≈40% join inside the window), ~1.52M events,
 *             120 days (2026-06-04 → 2026-10-01, UTC)
 * CORE LOOP:  workout planned → workout completed → progress checked
 * VALUE MOMENT: workout completed
 *
 * EVENTS (22):
 *   workout completed (8) > app opened (7) > workout planned (6) > meal logged (6)
 *   > progress checked (5) > notification received (5) > leaderboard viewed (3)
 *   > challenge joined (2) > friend added (2) > achievement unlocked (2)
 *   > coach session (2) > profile updated (2) > challenge completed (1)
 *   > paywall viewed (1) > trial started (1) > subscription purchased (1)
 *   > account deactivated (1) > account created / goal quiz completed /
 *   plan generated / starter workout completed / $experiment_started (funnel-only)
 *
 * FUNNELS (7):
 *   - Onboarding (first funnel, A/B "Guided First Week" from 2026-07-01):
 *       account created → goal quiz completed → plan generated → starter workout completed (45%)
 *   - Workout Loop: workout planned → workout completed → progress checked (55%)
 *   - Upgrade to Plus (trial), new free members: paywall viewed → trial started → subscription purchased (35%)
 *   - Upgrade to Plus (direct), long-time free members: paywall viewed → subscription purchased (10%)
 *   - Team Challenge: challenge joined → challenge completed (60%, challenge_format "team")
 *   - Solo Challenge: challenge joined → challenge completed (30%, challenge_format "solo")
 *   - Coaching: coach session → workout planned → workout completed (50%)
 *
 * USER PROPS:  segment, fitness_level, primary_goal, acquisition_channel,
 *              wearable_type, subscription_tier, trial_eligible, Platform,
 *              "Experiment: Guided First Week" (enrolled members)
 * SUPER PROPS: Platform (sticky per member), subscription_tier (plan at event time)
 * SCD PROPS:   fitness_level (beginner/intermediate/advanced/elite, monthly, max 6)
 * GROUPS:      none
 * WAREHOUSE:   paid_acquisition_daily (spend by paid channel),
 *              wearable_sync_daily (partner sync health by device type),
 *              subscription_billing_daily (list price and bookings by plan)
 * LOOKUPS:     none — every attribute is denormalized onto events/profiles
 *
 * IDENTITY: new members are anonymous until "account created" (isAuthEvent,
 * first event, carries user_id + device_id); 2 devices per member on average.
 *
 * ENGINE NOTES (workarounds, see openProblems in the re-eval report):
 * - retentionCurve instead of engagementDecay: in legacy mode a new member's
 *   first funnel is not pinned to their join time, and engagementDecay can
 *   then delete the signup event itself (orphaned anonymous members).
 * - World-event clones are spread across the whole event window, including
 *   before a new member's signup; the everything hook drops pre-signup rows.
 */

// ── HOOK STORIES ──
/*
 * All effects are hidden: no flag properties. Each is found by a breakdown,
 * a date comparison, or a cohort. Dates live in the TIMELINE constants and are
 * shared by hooks, stories, SQL, warehouse columns, and the timeline guide.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H1. GUIDED FIRST WEEK EXPERIMENT (declarative funnel experiment)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-07-01 new signups split 50/50. "Guided Plan" gets
 *   onboarding conversion × 1.3 and onboarding time × 0.7.
 * MIXPANEL: Funnels, account created → goal quiz completed → plan generated →
 *   starter workout completed, 7-day window, breakdown user property
 *   "Experiment: Guided First Week". Guided ≈ 57% vs Control ≈ 45%; median
 *   time to finish ≈ 12.5 h vs 17.9 h.
 * REAL WORLD: a guided first-week plan reduces choice paralysis for new users.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H2. STRIDE COACH LAUNCH (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-08-12, 45% of Plus workouts (event-time
 *   subscription_tier monthly/annual) run with coaching_mode = "ai_coach" and
 *   last 1.2x longer. Free and pre-launch workouts stay self_guided.
 *   Calories are untouched (an honest null).
 * MIXPANEL: Insights, workout completed, average duration_minutes, breakdown
 *   coaching_mode, filter subscription_tier != free, after 2026-08-12.
 * REAL WORLD: real-time pacing cues keep people training longer.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H3. WEARABLE SYNC OUTAGE (everything + warehouse wearable_sync_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-08-20 to 2026-08-22, the partner health API fails. Only 25%
 *   of smartwatch and fitness-band workouts sync; chest straps (direct
 *   Bluetooth) and phone tracking are untouched. The warehouse table shows
 *   sync_error_rate ≈ 0.75 and partner_api_status = "major_outage" on those
 *   days for those devices.
 * MIXPANEL: Insights, workout completed, daily, breakdown tracking_source and
 *   wearable_type; join the warehouse sync_error_rate to explain the dip.
 * REAL WORLD: third-party health-data integrations fail silently.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H4. PLUS MONTHLY PRICE CHANGE (everything + warehouse subscription_billing_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: on 2026-09-01 Plus Monthly goes from $12.99 to $14.99. 35% of
 *   would-be monthly purchases after that date never happen; Annual is
 *   untouched. Prices exist only in the warehouse table.
 * MIXPANEL: Insights, subscription purchased, weekly, breakdown plan; the
 *   monthly/annual ratio drops after Sep 1. Bookings need the warehouse
 *   list_price_usd joined to purchases.
 * REAL WORLD: a 15% price rise on the entry plan costs more volume than it
 *   gains in price.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H5. SUMMER SHRED PAID SOCIAL (everything + warehouse paid_acquisition_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-06-15 to 2026-07-14, 40% of non-referral signups arrive via
 *   paid_social and paid-social CPI bids double (warehouse spend = installs ×
 *   CPI). Half of all paid-social signups never buy Plus.
 * MIXPANEL: Insights, account created, breakdown acquisition_channel, weekly;
 *   join paid_acquisition_daily.spend_usd for spend per signup; Funnels or
 *   Insights for Plus purchase rate by acquisition_channel.
 * REAL WORLD: a performance push buys volume at a higher CPI from a
 *   lower-intent audience.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H6. FIRST-WEEK HABIT (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: new members with fewer than 3 workouts in their first 7 days:
 *   50% of them go dark after day 14. Classification uses first-week
 *   activity only.
 * MIXPANEL: Retention, account created → any event, cohort "3+ workout
 *   completed in first 7 days" vs the rest; D28 ≈ 96% vs 46%.
 * REAL WORLD: the first week sets the habit; most fitness churn is early.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H7. TEAM VS SOLO CHALLENGES (declarative duplicate funnels)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: team challenges complete at 60% per challenge, solo at 30%.
 *   challenge_id identifies each challenge.
 * MIXPANEL: Funnels, challenge joined → challenge completed, totals, hold
 *   challenge_id constant, breakdown challenge_format.
 * REAL WORLD: social accountability finishes what motivation starts.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H8. PUSH FATIGUE (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: members who receive 20+ notifications in the window stop opening
 *   them: 60% of would-be opens go unopened (open rate ≈ 30% vs 75%).
 * MIXPANEL: Insights, notification received, share with opened = true,
 *   breakdown by a cohort on notification count (bins 15-19 vs 20-24 show the
 *   cliff).
 * REAL WORLD: notification overload trains people to ignore the app.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H9. FALL RESET PROGRAM (declarative world event)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-09-08 for 14 days, workout planned and workout completed run
 *   at 1.5x; app opens are untouched.
 * MIXPANEL: Insights, workout completed and app opened, daily; formula A/B
 *   rises ≈ 1.5x during the program.
 * REAL WORLD: a back-to-routine program after Labor Day lifts training, not
 *   app visits.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * EXPECTED METRICS SUMMARY (measured: data/verify-fitness, 2026-10-06)
 * ═════════════════════════════════════════════════════════════════════════
 * Hook | Metric                                      | Derivation              | Expected  | Measured
 * -----|---------------------------------------------|-------------------------|-----------|---------
 * H1   | onboarding conversion Guided/Control        | GUIDED_CONV_MULT        | 1.30      | 1.262 (57.3% vs 45.4%)
 * H1   | median onboarding TTC Guided/Control        | GUIDED_TTC_MULT         | 0.70      | 0.698
 * H1   | Guided share of enrolled                    | equal 2-arm hash        | 0.50      | 0.511
 * H2   | ai_coach rows pre-launch or free tier       | exact purity            | 0         | 0
 * H2   | post-launch Plus duration ai/self           | AI_DURATION_MULT        | 1.20      | 1.201
 * H2   | post-launch Plus ai_coach share             | AI_ADOPTION             | 0.45      | 0.451
 * H3   | watch+band / phone, outage vs ±7 days       | OUTAGE_KEEP             | 0.25      | 0.260
 * H3   | warehouse sync_error_rate during outage     | 1 − OUTAGE_KEEP         | 0.75      | 0.750
 * H4   | monthly/annual purchases, after vs before   | 1 − MONTHLY_LOSS        | 0.65      | 0.701
 * H4   | monthly/annual bookings, after vs before    | 0.65 × 14.99/12.99      | 0.75      | 0.809
 * H5   | paid-social spend per signup, Shred/rest    | SHRED_CPI_MULT          | 2.00      | 2.000
 * H5   | paid-social signup share, Shred/rest        | (.18+.4×.66)/.18        | 2.47      | 2.261
 * H5   | paid-social buy rate vs same-week others    | 1 − PAID_SOCIAL_NO_BUY  | 0.50      | 0.494
 * H6   | D28 retention habit/low                     | ≥ 1/(1 − 0.5) (floor)   | ≥ 2.0     | 2.102 (96.3% vs 45.8%)
 * H7   | per-challenge completion, team              | TEAM_CONV               | 0.60      | 0.590
 * H7   | per-challenge completion, solo              | SOLO_CONV               | 0.30      | 0.297
 * H8   | open rate heavy (20+) / light               | 1 − PUSH_FATIGUE_FLIP   | 0.40      | 0.400
 * H8   | open rate light (control)                   | declared pool 3 of 4    | 0.75      | 0.748
 * H9   | completed per app open, program/before      | FALL_RESET_MULT         | 1.50      | 1.502
 * H9   | planned per app open, program/before        | FALL_RESET_MULT         | 1.50      | 1.495
 * ═════════════════════════════════════════════════════════════════════════
 */

// ── SCALE ──
const SEED = "dm4-fitness";
const NUM_USERS = 10_000;
const DATASET_START = "2026-06-04T00:00:00Z";
const DATASET_END = "2026-10-01T23:59:59Z"; // 120 days
const EVENTS_PER_DAY = 1.2;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── TIMELINE (shared by hooks, stories, SQL, warehouse columns, guides) ──
const SUMMER_SHRED_START = "2026-06-15T00:00:00Z"; // paid-social push, CPI bids raised
const SUMMER_SHRED_END = "2026-07-15T00:00:00Z";   // exclusive
const GUIDED_TEST_START = "2026-07-01T00:00:00Z";  // "Guided First Week" onboarding A/B
const AI_COACH_LAUNCH = "2026-08-12T00:00:00Z";    // Stride Coach (AI coaching) for Plus
const SYNC_OUTAGE_START = "2026-08-20T00:00:00Z";  // partner health-API outage
const SYNC_OUTAGE_END = "2026-08-23T00:00:00Z";    // exclusive (3 days)
const PRICE_CHANGE = "2026-09-01T00:00:00Z";       // Plus Monthly $12.99 → $14.99
const FALL_RESET_START = "2026-09-08T00:00:00Z";   // Fall Reset program (14 days)
const FALL_RESET_DAYS = 14;

const ms = (iso) => dayjs.utc(iso).valueOf();
const dayIndex = (iso) => Math.round((ms(iso) - ms(DATASET_START)) / 86_400_000);

// ── KNOBS ──
// H1 Guided First Week (experiment on the onboarding funnel)
const GUIDED_EXPERIMENT = "Guided First Week";
const GUIDED_VARIANT = "Guided Plan";
const GUIDED_CONV_MULT = 1.3;
const GUIDED_TTC_MULT = 0.7;
const ONBOARDING_CONV = 45;
const ONBOARDING_TTC_H = 24;

// H2 Stride Coach
const AI_ADOPTION = 0.45;          // share of Plus workouts run with Stride Coach after launch
const AI_DURATION_MULT = 1.2;

// H3 wearable sync outage
const OUTAGE_TYPES = ["smartwatch", "fitness_band"]; // devices that sync through the partner health API
const OUTAGE_KEEP = 0.25;          // share of affected wearable workouts that still sync

// H4 Plus Monthly price change
const PRICE_MONTHLY_OLD = 12.99;
const PRICE_MONTHLY_NEW = 14.99;
const PRICE_ANNUAL = 99.99;
const MONTHLY_LOSS = 0.35;         // share of post-change monthly purchases lost

// H5 Summer Shred paid social
const PAID_CHANNELS = ["paid_social", "paid_search", "app_store_ads"];
const CPI_USD = { paid_social: 9, paid_search: 14, app_store_ads: 6 };
const SHRED_CPI_MULT = 2;          // paid_social CPI bids during Summer Shred
const SHRED_RELABEL = 0.4;         // share of non-referral campaign-window signups that came via paid social
const PAID_SOCIAL_NO_BUY = 0.5;    // share of paid_social signups that never buy Plus

// H6 first-week habit
const HABIT_DAYS = 7;
const HABIT_MIN_WORKOUTS = 3;
const HABIT_CHURN_AFTER_DAYS = 14;
const HABIT_CHURN_SHARE = 0.5;     // share of low-habit new users who go dark after day 14

// H7 team vs solo challenges
const TEAM_CONV = 60;
const SOLO_CONV = 30;
const CHALLENGE_TTC_H = 96;

// H8 notification fatigue
const PUSH_FATIGUE_THRESHOLD = 20; // notifications received in the window (calibrated ≈ p80)
const PUSH_FATIGUE_FLIP = 0.6;     // share of opened pushes that go unopened above the threshold

// H9 Fall Reset program
const FALL_RESET_MULT = 1.5;
const FALL_RESET_EVENTS = ["workout planned", "workout completed"];

// lifecycle hygiene
const DEACTIVATION_QUIET_DAYS = 21;

// ── HELPERS ──
const salt = (uid, tag) => hashFloat(`${uid}|${tag}`);
const round2 = (n) => Math.round(n * 100) / 100;
const inShred = (t) => t >= ms(SUMMER_SHRED_START) && t < ms(SUMMER_SHRED_END);
const inOutage = (t) => t >= ms(SYNC_OUTAGE_START) && t < ms(SYNC_OUTAGE_END);
const monthlyPrice = (t) => (t >= ms(PRICE_CHANGE) ? PRICE_MONTHLY_NEW : PRICE_MONTHLY_OLD);
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const T = (e) => dayjs.utc(e.time).valueOf();

function handleUserHook(profile, meta) {
	// pre-existing members already hold a plan; new signups start on Free
	if (meta.userIsBornInDataset) {
		profile.subscription_tier = "free";
		profile.trial_eligible = true;
		return profile;
	}
	profile.trial_eligible = false;
	const mix = {
		athlete: [25, 30, 45],
		trainer: [10, 30, 60],
		social: [50, 35, 15],
		casual: [70, 20, 10],
		beginner: [85, 10, 5],
	}[profile.segment] || [70, 20, 10];
	profile.subscription_tier = chance.weighted(["free", "monthly", "annual"], mix);
	return profile;
}

function handleEverything(events, meta) {
	if (!events.length) return events;
	const profile = meta.profile;
	const uid = profile.distinct_id;
	const START = ms(DATASET_START);
	const END = ms(DATASET_END);
	const signup = events.find((e) => e.event === "account created");
	const birthMs = signup ? T(signup) : null;
	// engine workaround: world-event clones are spread across the whole event
	// window, including before a new member's signup — nobody trains before install
	if (signup) events = events.filter((e) => T(e) >= birthMs || e.event === "$experiment_started");

	// ── H5a: Summer Shred relabels campaign-window signups to paid social ──
	if (signup && birthMs >= ms(SUMMER_SHRED_START) && birthMs < ms(SUMMER_SHRED_END)
		&& profile.acquisition_channel !== "referral" && profile.acquisition_channel !== "paid_social"
		&& salt(uid, "shred") < SHRED_RELABEL) {
		profile.acquisition_channel = "paid_social";
		signup.acquisition_channel = "paid_social";
	}

	// ── trial hygiene: one free trial per member ──
	const firstTrial = events.filter((e) => e.event === "trial started").sort((a, b) => T(a) - T(b))[0];
	if (firstTrial) events = events.filter((e) => e.event !== "trial started" || e === firstTrial);

	// ── purchase hygiene: a member buys Plus once; later upgrade passes vanish ──
	const firstBuy = events.filter((e) => e.event === "subscription purchased").sort((a, b) => T(a) - T(b))[0];
	if (firstBuy) {
		const t0 = T(firstBuy);
		events = events.filter((e) => {
			if (e === firstBuy) return true;
			if (e.event === "subscription purchased") return false;
			if ((e.event === "trial started" || e.event === "paywall viewed") && T(e) > t0) return false;
			return true;
		});
	}

	// ── H5b: half of paid-social signups never buy ──
	let purchase = events.find((e) => e.event === "subscription purchased");
	if (purchase && profile.acquisition_channel === "paid_social" && salt(uid, "nobuy") < PAID_SOCIAL_NO_BUY) {
		events = events.filter((e) => e !== purchase);
		purchase = null;
	}

	// ── H4a: Plus Monthly price change loses a share of monthly purchases ──
	if (purchase && purchase.plan === "monthly" && T(purchase) >= ms(PRICE_CHANGE) && chance.bool({ likelihood: MONTHLY_LOSS * 100 })) {
		events = events.filter((e) => e !== purchase);
		purchase = null;
	}

	// ── H6: first-week habit — low-habit new users go dark after day 14 ──
	if (signup) {
		const habitEnd = birthMs + HABIT_DAYS * 86_400_000;
		const early = events.filter((e) => e.event === "workout completed" && T(e) >= birthMs && T(e) < habitEnd).length;
		if (early < HABIT_MIN_WORKOUTS && salt(uid, "habit") < HABIT_CHURN_SHARE) {
			const cut = birthMs + HABIT_CHURN_AFTER_DAYS * 86_400_000;
			events = events.filter((e) => T(e) < cut);
			if (purchase && T(purchase) >= cut) purchase = null;
		}
	}

	// ── H3: partner health-API outage — most smartwatch / band workouts never sync ──
	const oStart = ms(SYNC_OUTAGE_START), oEnd = ms(SYNC_OUTAGE_END);
	events = events.filter((e) => !(e.event === "workout completed" && e.tracking_source === "wearable"
		&& OUTAGE_TYPES.includes(e.wearable_type) && T(e) >= oStart && T(e) < oEnd
		&& !chance.bool({ likelihood: OUTAGE_KEEP * 100 })));

	// ── plan at event time (superProp subscription_tier) + final profile plan ──
	const initialTier = profile.subscription_tier;
	const buyMs = purchase ? T(purchase) : Infinity;
	for (const e of events) e.subscription_tier = T(e) >= buyMs ? purchase.plan : initialTier;
	if (purchase) profile.subscription_tier = purchase.plan;

	// ── H2: Stride Coach — Plus workouts after launch, longer sessions ──
	const launch = ms(AI_COACH_LAUNCH);
	for (const e of events) {
		if ((e.event === "workout completed" || e.event === "workout planned") && T(e) >= launch && e.subscription_tier !== "free"
			&& chance.bool({ likelihood: AI_ADOPTION * 100 })) {
			e.coaching_mode = "ai_coach";
			if (e.event === "workout completed") e.duration_minutes = Math.round(e.duration_minutes * AI_DURATION_MULT);
			else e.planned_duration_minutes = Math.round(e.planned_duration_minutes * AI_DURATION_MULT);
		}
	}

	// ── deactivation hygiene: one deactivation, only for members who actually went quiet ──
	const deacts = events.filter((e) => e.event === "account deactivated");
	events = events.filter((e) => e.event !== "account deactivated");
	if (deacts.length && events.length) {
		const last = events.reduce((m, e) => Math.max(m, T(e)), 0);
		if (last < END - DEACTIVATION_QUIET_DAYS * 86_400_000) {
			const when = last + chance.integer({ min: 20, max: 180 }) * 60_000;
			const d = cloneEvent(deacts[0], { time: new Date(when).toISOString() });
			d.subscription_tier = profile.subscription_tier;
			events.push(d);
		}
	}

	// ── H8: notification fatigue — heavy push recipients stop opening ──
	const pushes = events.filter((e) => e.event === "notification received");
	if (pushes.length >= PUSH_FATIGUE_THRESHOLD) {
		for (const p of pushes) {
			if (p.opened === true && chance.bool({ likelihood: PUSH_FATIGUE_FLIP * 100 })) p.opened = false;
		}
	}

	return events;
}

// paid acquisition spend: performance channels bill per install (CPI); Summer
// Shred raised paid-social bids. Spend is the value column, set from the raw
// install count so the row's other columns stay consistent.
function handleWarehouse(row, meta) {
	if (meta.metricName !== "paid_acquisition_daily" || meta.isBackfill) return row;
	const channel = row.acquisition_channel;
	const t = dayjs.utc(row.date).valueOf();
	const mult = channel === "paid_social" && inShred(t) ? SHRED_CPI_MULT : 1;
	row.spend_usd = round2(meta.raw.plus.count * CPI_USD[channel] * mult);
	return row;
}

// ── CONFIG ──
/** @type {Config} */
const config = {
	seed: SEED,
	datasetStart: DATASET_START,
	datasetEnd: DATASET_END,
	numUsers: NUM_USERS,
	avgEventsPerUserPerDay: EVENTS_PER_DAY,
	format: "json",
	gzip: true,
	concurrency: 1,
	writeToDisk: false,
	macro: { percentUsersBornInDataset: 40, bornRecentBias: 0, preExistingSpread: "uniform" },
	credentials: { token },
	switches: {
		hasSessionIds: true,
		alsoInferFunnels: false,
		hasLocation: true,
		hasAndroidDevices: true,
		hasIOSDevices: true,
		hasDesktopDevices: false,
		hasBrowser: false,
		hasCampaigns: false,
		isAnonymous: false,
		hasAdSpend: false,
		hasAvatar: true,
	},
	identity: { avgDevicePerUser: 2 },
	stickyEventProps: ["Platform"],

	scdProps: {
		fitness_level: {
			values: ["beginner", "intermediate", "advanced", "elite"],
			frequency: "month",
			timing: "fuzzy",
			max: 6,
		},
	},

	events: [
		{
			event: "account created",
			weight: 1,
			isFirstEvent: true,
			isAuthEvent: true,
			properties: {
				acquisition_channel: (ctx) => ctx.profile.acquisition_channel,
			},
		},
		{
			event: "goal quiz completed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				primary_goal: (ctx) => ctx.profile.primary_goal,
				days_per_week_target: [2, 3, 3, 4, 4, 5],
			},
		},
		{
			event: "plan generated",
			weight: 1,
			isStrictEvent: true,
			properties: {
				plan_length_weeks: [4, 6, 8, 12],
				workout_category: ["strength", "running", "hiit", "yoga", "cycling", "walking"],
			},
		},
		{
			event: "starter workout completed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				duration_minutes: [8, 10, 10, 12, 15],
			},
		},
		{
			event: "workout planned",
			weight: 6,
			isStrictEvent: false,
			properties: {
				planned_duration_minutes: u.weighNumRange(15, 75, 0.6, 30),
				workout_category: ["strength", "running", "hiit", "yoga", "cycling", "walking"],
				coaching_mode: ["self_guided"],
			},
		},
		{
			event: "workout completed",
			weight: 8,
			isStrictEvent: false,
			properties: {
				workout_category: ["strength", "running", "hiit", "yoga", "cycling", "walking"],
				duration_minutes: u.weighNumRange(10, 90, 0.5, 40),
				calories_burned: u.weighNumRange(60, 900, 0.4, 60),
				avg_heart_rate: u.weighNumRange(90, 175, 0.6, 40),
				perceived_effort: [3, 4, 5, 5, 6, 6, 7, 7, 8, 9],
				coaching_mode: ["self_guided"],
				wearable_type: (ctx) => ctx.profile.wearable_type,
				tracking_source: (ctx) => ctx.profile.wearable_type === "none"
					? chance.pickone(["phone", "phone", "manual"])
					: chance.pickone(["wearable", "wearable", "wearable", "wearable", "wearable", "phone"]),
			},
		},
		{
			event: "progress checked",
			weight: 5,
			isStrictEvent: false,
			properties: {
				metric_viewed: ["weekly_minutes", "workout_streak", "body_weight", "personal_records", "heart_rate_trend"],
				time_range: ["week", "month", "3_months"],
			},
		},
		{
			event: "meal logged",
			weight: 6,
			properties: {
				meal_type: ["breakfast", "lunch", "dinner", "snack"],
				calories: u.weighNumRange(80, 1100, 0.5, 40),
				protein_g: u.weighNumRange(2, 70, 0.5, 30),
			},
		},
		{
			event: "challenge joined",
			weight: 2,
			properties: {
				challenge_id: ["unassigned"],
				challenge_format: ["solo"],
				challenge_type: ["steps", "strength", "streak", "distance"],
				duration_days: [7, 14, 21, 30],
			},
		},
		{
			event: "challenge completed",
			weight: 1,
			properties: {
				challenge_id: ["unassigned"],
				challenge_format: ["solo"],
				challenge_type: ["steps", "strength", "streak", "distance"],
				final_rank: u.weighNumRange(1, 60, 0.3, 30),
			},
		},
		{
			event: "friend added",
			weight: 2,
			properties: {
				source: ["contacts", "search", "challenge", "suggested"],
			},
		},
		{
			event: "leaderboard viewed",
			weight: 3,
			properties: {
				leaderboard_type: ["friends", "challenge", "city", "global"],
			},
		},
		{
			event: "achievement unlocked",
			weight: 2,
			properties: {
				achievement_type: ["streak_7", "streak_30", "personal_record", "first_5k", "challenge_badge", "minutes_milestone"],
			},
		},
		{
			event: "coach session",
			weight: 2,
			properties: {
				session_type: ["live_video", "form_check", "plan_review", "chat"],
				coach_speciality: ["strength", "running", "mobility", "nutrition"],
				session_minutes: [15, 20, 30, 30, 45],
				satisfaction_score: [3, 4, 4, 5, 5],
			},
		},
		{
			event: "paywall viewed",
			weight: 1,
			properties: {
				paywall_trigger: ["workout_library", "advanced_plans", "coach_teaser", "challenge_limit", "settings"],
			},
		},
		{
			event: "trial started",
			weight: 1,
			properties: {
				plan: ["monthly"],
				trial_days: [7],
			},
		},
		{
			event: "subscription purchased",
			weight: 1,
			properties: {
				plan: ["monthly"],
				payment_method: ["apple_pay", "google_pay", "card", "card"],
			},
		},
		{
			event: "notification received",
			weight: 5,
			properties: {
				notification_type: ["workout_reminder", "workout_reminder", "streak_at_risk", "challenge_update", "friend_activity", "weekly_recap"],
				channel: ["push", "push", "push", "email"],
				opened: [true, true, true, false],
			},
		},
		{
			event: "app opened",
			weight: 7,
			properties: {
				entry_point: ["home_screen", "push", "widget", "watch_app"],
				session_minutes: u.weighNumRange(1, 40, 0.4, 30),
			},
		},
		{
			event: "profile updated",
			weight: 2,
			properties: {
				field_updated: ["body_weight", "goal", "photo", "units", "notification_settings", "connected_devices"],
			},
		},
		{
			event: "account deactivated",
			weight: 1,
			properties: {
				reason: ["lost_motivation", "switched_apps", "injury", "reached_goal", "too_busy"],
			},
		},
		{
			event: "$experiment_started",
			weight: 1,
			isStrictEvent: true,
			properties: {
				"Experiment name": [GUIDED_EXPERIMENT],
				"Variant name": ["Control", GUIDED_VARIANT],
			},
		},
	],

	funnels: [
		{
			name: "Onboarding",
			sequence: ["account created", "goal quiz completed", "plan generated", "starter workout completed"],
			isFirstFunnel: true,
			conversionRate: ONBOARDING_CONV,
			timeToConvert: ONBOARDING_TTC_H,
			order: "sequential",
			weight: 1,
			experiment: {
				name: GUIDED_EXPERIMENT,
				startDaysBeforeEnd: (dayjs.utc(DATASET_END).unix() - dayjs.utc(GUIDED_TEST_START).unix()) / 86400,
				variants: [
					{ name: "Control" },
					{ name: GUIDED_VARIANT, conversionMultiplier: GUIDED_CONV_MULT, ttcMultiplier: GUIDED_TTC_MULT },
				],
			},
		},
		{
			name: "Workout Loop",
			sequence: ["workout planned", "workout completed", "progress checked"],
			conversionRate: 55,
			timeToConvert: 36,
			order: "sequential",
			weight: 6,
		},
		{
			// new members get one 7-day free trial
			name: "Upgrade to Plus (trial)",
			sequence: ["paywall viewed", "trial started", "subscription purchased"],
			conditions: { subscription_tier: "free", trial_eligible: true },
			conversionRate: 35,
			timeToConvert: 168,
			order: "sequential",
			weight: 2,
			props: { plan: ["monthly", "monthly", "annual"] },
		},
		{
			// long-time free members already used their trial
			name: "Upgrade to Plus (direct)",
			sequence: ["paywall viewed", "subscription purchased"],
			conditions: { subscription_tier: "free", trial_eligible: false },
			conversionRate: 10,
			timeToConvert: 24,
			order: "sequential",
			weight: 2,
			props: { plan: ["monthly", "monthly", "annual"] },
		},
		{
			name: "Team Challenge",
			sequence: ["challenge joined", "challenge completed"],
			conversionRate: TEAM_CONV,
			timeToConvert: CHALLENGE_TTC_H,
			order: "sequential",
			weight: 1,
			props: { challenge_id: (ctx) => `ch_${chance.hash({ length: 12 })}`, challenge_format: "team", challenge_type: ["steps", "strength", "streak", "distance"] },
		},
		{
			name: "Solo Challenge",
			sequence: ["challenge joined", "challenge completed"],
			conversionRate: SOLO_CONV,
			timeToConvert: CHALLENGE_TTC_H,
			order: "sequential",
			weight: 1,
			props: { challenge_id: (ctx) => `ch_${chance.hash({ length: 12 })}`, challenge_format: "solo", challenge_type: ["steps", "strength", "streak", "distance"] },
		},
		{
			name: "Coaching",
			sequence: ["coach session", "workout planned", "workout completed"],
			conversionRate: 50,
			timeToConvert: 48,
			order: "sequential",
			weight: 1,
		},
	],

	warehouseMetrics: [
		{
			name: "paid_acquisition_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "account created",
				measure: "count",
				where: (e) => PAID_CHANNELS.includes(e.acquisition_channel),
				groupBy: "acquisition_channel",
			},
			timeColumn: "date",
			valueColumn: "spend_usd",
			columns: {
				// ad platforms claim ~8% more installs than product analytics records
				platform_reported_installs: (ctx) => Math.round(ctx.value * 1.08),
				clicks: (ctx) => Math.round(ctx.value / 0.21),
				impressions: (ctx) => Math.round(ctx.value / 0.21 / 0.011),
			},
		},
		{
			name: "wearable_sync_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "workout completed",
				measure: "count",
				where: (e) => e.tracking_source === "wearable",
				groupBy: "wearable_type",
			},
			timeColumn: "date",
			valueColumn: "synced_workouts",
			columns: {
				sync_error_rate: (ctx) => {
					const affected = OUTAGE_TYPES.includes(ctx.row.wearable_type) && inOutage(ctx.time);
					const jitter = hashFloat(`${dayKey(ctx.time)}|${ctx.seriesKey}`);
					return affected ? round2(1 - OUTAGE_KEEP + (jitter - 0.5) * 0.04) : Math.round((0.004 + jitter * 0.01) * 10000) / 10000;
				},
				sync_requests: (ctx) => Math.round(ctx.value / Math.max(0.05, 1 - ctx.row.sync_error_rate)),
				partner_api_status: (ctx) => (OUTAGE_TYPES.includes(ctx.row.wearable_type) && inOutage(ctx.time) ? "major_outage" : "operational"),
				p95_sync_latency_ms: (ctx) => {
					const jitter = hashFloat(`lat|${dayKey(ctx.time)}|${ctx.seriesKey}`);
					return OUTAGE_TYPES.includes(ctx.row.wearable_type) && inOutage(ctx.time) ? Math.round(28000 + jitter * 6000) : Math.round(900 + jitter * 500);
				},
			},
		},
		{
			name: "subscription_billing_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "subscription purchased",
				measure: "count",
				groupBy: "plan",
			},
			timeColumn: "date",
			valueColumn: "new_subscriptions",
			columns: {
				list_price_usd: (ctx) => (ctx.row.plan === "annual" ? PRICE_ANNUAL : monthlyPrice(ctx.time)),
				gross_bookings_usd: (ctx) => round2(ctx.value * ctx.row.list_price_usd),
				store_fees_usd: (ctx) => round2(ctx.value * ctx.row.list_price_usd * 0.15),
				net_bookings_usd: (ctx) => round2(ctx.value * ctx.row.list_price_usd * 0.85),
			},
		},
	],

	superProps: {
		Platform: { __weights: { ios: 62, android: 38 } },
		subscription_tier: ["free"],
	},

	userProps: {
		segment: ["casual"],
		fitness_level: ["beginner"],
		primary_goal: ["lose_weight", "build_strength", "improve_endurance", "stay_active", "reduce_stress"],
		acquisition_channel: { __weights: { organic: 34, paid_social: 18, paid_search: 14, referral: 16, app_store_ads: 18 } },
		wearable_type: { __weights: { none: 35, smartwatch: 35, fitness_band: 20, chest_strap: 10 } },
		subscription_tier: ["free"],
		trial_eligible: [true],
		Platform: { __weights: { ios: 62, android: 38 } },
	},

	personas: [
		{ name: "athlete", weight: 12, eventMultiplier: 3.0, properties: { segment: "athlete", fitness_level: "advanced" } },
		{ name: "casual", weight: 40, eventMultiplier: 1.0, properties: { segment: "casual", fitness_level: "intermediate" } },
		{ name: "beginner", weight: 25, eventMultiplier: 0.6, properties: { segment: "beginner", fitness_level: "beginner" } },
		{ name: "social", weight: 15, eventMultiplier: 1.8, properties: { segment: "social", fitness_level: "intermediate" } },
		{ name: "trainer", weight: 8, eventMultiplier: 2.5, properties: { segment: "trainer", fitness_level: "elite" } },
	],

	worldEvents: [
		{
			name: "fall_reset_program",
			type: "campaign",
			startDay: dayIndex(FALL_RESET_START),
			duration: FALL_RESET_DAYS,
			affectsEvents: FALL_RESET_EVENTS,
			volumeMultiplier: FALL_RESET_MULT,
		},
	],

	// retention shape (also pins each new member's signup to their install day)
	retentionCurve: { type: "logarithmic", day1: 0.8, day7: 0.6, day30: 0.45 },

	hook(record, type, meta) {
		if (type === "user") return handleUserHook(record, meta);
		if (type === "everything") return handleEverything(record, meta);
		if (type === "warehouse") return handleWarehouse(record, meta);
		return record;
	},
};

// ── STORIES ──────────────────────────────────────────────────────────────
// Machine-checkable contract for hooks H1-H9. Evaluate with:
//   node dungeons/vertical/fitness/fitness.verify.mjs

const EV = `read_json_auto('{{PREFIX}}-EVENTS*.json*', sample_size=-1, union_by_name=true)`;
const US = `read_json_auto('{{PREFIX}}-USERS*.json*', sample_size=-1, union_by_name=true)`;
const WH = (table) => `read_json_auto('{{PREFIX}}-WAREHOUSE-${table}.json*', sample_size=-1, union_by_name=true)`;

// Identity prelude: a device resolves to the user who appears with it on any
// event carrying both ids (emitted stitch evidence, not the profile pool).
const ID_CTE = `dmap AS (SELECT device_id, min(user_id::VARCHAR) AS mapped FROM ${EV}
  WHERE user_id IS NOT NULL AND device_id IS NOT NULL GROUP BY 1),
ev AS (SELECT coalesce(e.user_id::VARCHAR, m.mapped) AS uid, e.time::TIMESTAMP AS t, e.*
  FROM ${EV} e LEFT JOIN dmap m ON e.device_id = m.device_id)`;

const TS = (iso) => dayjs.utc(iso).format("YYYY-MM-DD HH:mm:ss");
const DAY_MS = 86_400_000;
const ONBOARDING_STEPS = ["account created", "goal quiz completed", "plan generated", "starter workout completed"];
const EXP_KEY = `Experiment: ${GUIDED_EXPERIMENT}`;
// Summer Shred share of paid-social signups, derived from the declared channel
// weights (paid_social 18, referral 16 of 100) and the relabel knob
const P_SOCIAL = 0.18, P_REFERRAL = 0.16;
const SHRED_SHARE_LIFT = (P_SOCIAL + SHRED_RELABEL * (1 - P_SOCIAL - P_REFERRAL)) / P_SOCIAL;
const OUTAGE_BASE_FROM = TS(dayjs.utc(SYNC_OUTAGE_START).subtract(7, "day"));
const OUTAGE_BASE_TO = TS(dayjs.utc(SYNC_OUTAGE_END).add(7, "day"));
const RESET_BASE_FROM = TS(dayjs.utc(FALL_RESET_START).subtract(FALL_RESET_DAYS, "day"));
const RESET_END = TS(dayjs.utc(FALL_RESET_START).add(FALL_RESET_DAYS, "day"));
const band = (k) => [Math.round(k * 0.9 * 1000) / 1000, Math.round(k * 1.1 * 1000) / 1000];

/** step_counts conversion by segment from a timeToConvert breakdown. */
const convOf = (rows, seg) => {
	const r = (rows || []).find((x) => x.segment_value === seg);
	if (!r || !Array.isArray(r.step_counts) || !r.step_counts[0]) return null;
	return { entered: r.step_counts[0], converted: r.step_counts[r.step_counts.length - 1], rate: r.step_counts[r.step_counts.length - 1] / r.step_counts[0] };
};

/** @type {import("../../../types").DungeonStory[]} */
export const stories = [
	{
		id: "H1-guided-first-week",
		hook: "H1",
		archetype: "experiment-lift",
		narrative: `The "${GUIDED_EXPERIMENT}" onboarding test starts ${GUIDED_TEST_START.slice(0, 10)} and splits new signups 50/50. "${GUIDED_VARIANT}" multiplies onboarding conversion by ${GUIDED_CONV_MULT} and onboarding time by ${GUIDED_TTC_MULT}. Every onboarding step is an onboarding-only event, so the funnel conversion and median time-to-convert read the knobs directly.`,
		mixpanelReport: { type: "Funnels", steps: ONBOARDING_STEPS, breakdown: `user property "${EXP_KEY}"`, window: "7 days" },
		assertions: [
			{
				breakdown: { type: "timeToConvert", steps: ONBOARDING_STEPS, breakdownByUserProperty: EXP_KEY, conversionWindowMs: 7 * DAY_MS },
				// custom assert: conversion lives in the step_counts ARRAY of each
				// segment row; the expect grammar cannot index arrays
				assert: (rows) => {
					const g = convOf(rows, GUIDED_VARIANT), c = convOf(rows, "Control");
					if (!g || !c) return { verdict: "NONE", detail: "missing variant rows" };
					if (g.entered < 800 || c.entered < 800) return { verdict: "WEAK", detail: `small arms ${g.entered}/${c.entered}` };
					const lift = g.rate / c.rate;
					const [lo, hi] = band(GUIDED_CONV_MULT);
					const detail = `onboarding conversion ${g.converted}/${g.entered}=${g.rate.toFixed(4)} vs ${c.converted}/${c.entered}=${c.rate.toFixed(4)}; lift ${lift.toFixed(4)} (knob ${GUIDED_CONV_MULT}, band [${lo}, ${hi}])`;
					if (lift >= lo && lift <= hi) return { verdict: "NAILED", detail };
					return { verdict: lift > 1 ? "WEAK" : "INVERSE", detail };
				},
			},
			{
				breakdown: { type: "timeToConvert", steps: ONBOARDING_STEPS, breakdownByUserProperty: EXP_KEY, conversionWindowMs: 7 * DAY_MS },
				select: { g: { where: { segment_value: GUIDED_VARIANT } }, c: { where: { segment_value: "Control" } } },
				expect: { metric: "g.median_ttc_ms / c.median_ttc_ms", op: "between", target: band(GUIDED_TTC_MULT) },
				minCohort: 400,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 count(DISTINCT uid) FILTER (WHERE "Variant name" = '${GUIDED_VARIANT}')::DOUBLE / count(DISTINCT uid) AS guided_share,
 count(*) FILTER (WHERE t < TIMESTAMP '${TS(GUIDED_TEST_START)}') AS pre_start_exposures
FROM ev WHERE event = '$experiment_started'`,
				},
				select: { a: { where: { grp: "all" } } },
				// equal-weight 2-arm hash → 0.5
				expect: { metric: "a.guided_share", op: "between", target: band(0.5) },
				minCohort: 1000,
			},
		],
	},
	{
		id: "H2-stride-coach-launch",
		hook: "H2",
		archetype: "temporal-inflection",
		narrative: `Stride Coach launches ${AI_COACH_LAUNCH.slice(0, 10)} for Plus members. ${AI_ADOPTION * 100}% of Plus workouts after launch run with coaching_mode = 'ai_coach', and those sessions last ${AI_DURATION_MULT}x longer. Free-tier workouts and every pre-launch workout stay self_guided, so purity is exact. subscription_tier on each event is the member's plan at that moment.`,
		mixpanelReport: { type: "Insights", event: "workout completed", measure: "average duration_minutes", breakdown: "coaching_mode", filter: "subscription_tier != free, after launch" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 count(*) FILTER (WHERE coaching_mode = 'ai_coach' AND (t < TIMESTAMP '${TS(AI_COACH_LAUNCH)}' OR subscription_tier = 'free')) AS impure_rows
FROM ev WHERE event IN ('workout completed', 'workout planned')`,
				},
				select: { a: { where: { grp: "all" } } },
				// exact: any ai_coach row before launch or on a free-tier event is a bug
				expect: { metric: "a.impure_rows", op: "between", target: [0, 0] },
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT coaching_mode AS grp, count(*) AS event_count, count(DISTINCT uid) AS user_count, avg(duration_minutes) AS avg_dur, avg(calories_burned) AS avg_cal
FROM ev WHERE event = 'workout completed' AND t >= TIMESTAMP '${TS(AI_COACH_LAUNCH)}' AND subscription_tier <> 'free' GROUP BY 1`,
				},
				select: { a: { where: { grp: "ai_coach" } }, s: { where: { grp: "self_guided" } } },
				expect: { metric: "a.avg_dur / s.avg_dur", op: "between", target: band(AI_DURATION_MULT) },
				minCohort: 500,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'plus' AS grp, count(DISTINCT uid) AS user_count,
 count(*) FILTER (WHERE coaching_mode = 'ai_coach')::DOUBLE / count(*) AS ai_share
FROM ev WHERE event = 'workout completed' AND t >= TIMESTAMP '${TS(AI_COACH_LAUNCH)}' AND subscription_tier <> 'free'`,
				},
				select: { p: { where: { grp: "plus" } } },
				expect: { metric: "p.ai_share", op: "between", target: band(AI_ADOPTION) },
				minCohort: 500,
			},
		],
	},
	{
		id: "H3-wearable-sync-outage",
		hook: "H3",
		archetype: "bespoke",
		narrative: `A partner health-API outage (${SYNC_OUTAGE_START.slice(0, 10)} to ${SYNC_OUTAGE_END.slice(0, 10)}, exclusive) stops most smartwatch and fitness-band workouts from syncing: only ${OUTAGE_KEEP * 100}% arrive. Chest straps pair directly and phone-tracked workouts are untouched. The outage days come from the warehouse table wearable_sync_daily (sync_error_rate > 0.2); the event-side read is a ratio of ratios (affected wearable / phone workouts, outage days vs the 7 days either side), which cancels weekday and seasonal volume and reads the keep rate.`,
		mixpanelReport: { type: "Insights", event: "workout completed", measure: "total", breakdown: "tracking_source, wearable_type", chart: "daily line", join: "warehouse wearable_sync_daily.sync_error_rate" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
od AS (SELECT DISTINCT date::DATE AS d FROM ${WH("wearable_sync_daily")} WHERE sync_error_rate > 0.2),
w AS (SELECT t::DATE AS d, uid,
  CASE WHEN tracking_source = 'wearable' AND wearable_type IN (${OUTAGE_TYPES.map((x) => `'${x}'`).join(", ")}) THEN 'aff'
       WHEN tracking_source = 'phone' THEN 'phone' END AS arm
  FROM ev WHERE event = 'workout completed' AND t >= TIMESTAMP '${OUTAGE_BASE_FROM}' AND t < TIMESTAMP '${OUTAGE_BASE_TO}'),
g AS (SELECT (d IN (SELECT d FROM od)) AS outage, count(*) FILTER (WHERE arm = 'aff') AS aff, count(*) FILTER (WHERE arm = 'phone') AS phone, count(DISTINCT uid) AS users
  FROM w GROUP BY 1)
SELECT 'all' AS grp, (SELECT count(*) FROM od) AS outage_days, min(users) AS user_count,
 (max(aff::DOUBLE / phone) FILTER (WHERE outage)) / (max(aff::DOUBLE / phone) FILTER (WHERE NOT outage)) AS did
FROM g`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.did", op: "between", target: band(OUTAGE_KEEP) },
				minCohort: 1000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT 'all' AS grp,
 count(*) FILTER (WHERE partner_api_status = 'major_outage') AS outage_rows,
 avg(sync_error_rate) FILTER (WHERE partner_api_status = 'major_outage') AS outage_err,
 count(*) FILTER (WHERE partner_api_status = 'major_outage' AND (date::DATE < DATE '${SYNC_OUTAGE_START.slice(0, 10)}' OR date::DATE >= DATE '${SYNC_OUTAGE_END.slice(0, 10)}' OR wearable_type NOT IN (${OUTAGE_TYPES.map((x) => `'${x}'`).join(", ")}))) AS misplaced
FROM ${WH("wearable_sync_daily")}`,
				},
				select: { a: { where: { grp: "all" } } },
				// warehouse error rate during the outage = 1 − keep rate
				expect: { metric: "a.outage_err", op: "between", target: band(1 - OUTAGE_KEEP) },
			},
		],
	},
	{
		id: "H4-monthly-price-change",
		hook: "H4",
		archetype: "temporal-inflection",
		narrative: `On ${PRICE_CHANGE.slice(0, 10)} Plus Monthly rises from $${PRICE_MONTHLY_OLD} to $${PRICE_MONTHLY_NEW}; Annual stays $${PRICE_ANNUAL}. ${MONTHLY_LOSS * 100}% of would-be monthly purchases after the change never happen. Annual is the control: the monthly/annual purchase ratio after vs before reads the ${1 - MONTHLY_LOSS} keep rate. The prices live only in the warehouse table subscription_billing_daily, so the bookings read needs the join: monthly bookings fall to ${(1 - MONTHLY_LOSS).toFixed(2)} × ${PRICE_MONTHLY_NEW}/${PRICE_MONTHLY_OLD} of trend. Post-change monthly volume is a few hundred purchases, so the NAILED band (knob ±10%) can miss on sampling noise; the floor is a knob-derived ceiling.`,
		mixpanelReport: { type: "Insights", event: "subscription purchased", measure: "total", breakdown: "plan", chart: "weekly line" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
p AS (SELECT (t >= TIMESTAMP '${TS(PRICE_CHANGE)}') AS post, plan, uid FROM ev WHERE event = 'subscription purchased'),
g AS (SELECT post, count(*) FILTER (WHERE plan = 'monthly')::DOUBLE / count(*) FILTER (WHERE plan = 'annual') AS m_per_a, count(DISTINCT uid) AS users FROM p GROUP BY 1)
SELECT 'all' AS grp, min(users) AS user_count,
 max(m_per_a) FILTER (WHERE post) / max(m_per_a) FILTER (WHERE NOT post) AS did
FROM g`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.did", op: "<=", target: 1 - MONTHLY_LOSS, floor: 1 - MONTHLY_LOSS / 2 },
				minCohort: 250,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
p AS (SELECT t::DATE AS d, plan, uid FROM ev WHERE event = 'subscription purchased'),
j AS (SELECT p.*, b.list_price_usd FROM p JOIN ${WH("subscription_billing_daily")} b ON b.date::DATE = p.d AND b.plan = p.plan),
g AS (SELECT (d >= DATE '${PRICE_CHANGE.slice(0, 10)}') AS post,
  sum(list_price_usd) FILTER (WHERE plan = 'monthly') / sum(list_price_usd) FILTER (WHERE plan = 'annual') AS m_rev_per_a, count(DISTINCT uid) AS users
  FROM j GROUP BY 1)
SELECT 'all' AS grp, min(users) AS user_count,
 max(m_rev_per_a) FILTER (WHERE post) / max(m_rev_per_a) FILTER (WHERE NOT post) AS did
FROM g`,
				},
				select: { a: { where: { grp: "all" } } },
				// bookings DiD = keep rate × price ratio
				expect: { metric: "a.did", op: "<=", target: Math.round((1 - MONTHLY_LOSS) * PRICE_MONTHLY_NEW / PRICE_MONTHLY_OLD * 1000) / 1000, floor: Math.round((1 - MONTHLY_LOSS / 2) * PRICE_MONTHLY_NEW / PRICE_MONTHLY_OLD * 1000) / 1000 },
				minCohort: 250,
			},
		],
	},
	{
		id: "H5-summer-shred-paid-social",
		hook: "H5",
		archetype: "attribution-bias",
		narrative: `Summer Shred (${SUMMER_SHRED_START.slice(0, 10)} to ${SUMMER_SHRED_END.slice(0, 10)}, exclusive) pushes paid social: ${SHRED_RELABEL * 100}% of non-referral signups in the window arrive through paid_social, and paid-social CPI bids double. The warehouse table paid_acquisition_daily bills spend = installs × CPI, so spend per Mixpanel signup on paid social reads ${SHRED_CPI_MULT}x inside the campaign. Paid-social signups are also low intent: ${PAID_SOCIAL_NO_BUY * 100}% of them never buy Plus, so their purchase rate is half that of other channels' signups from the same week (channel is drawn independently of persona; the same-week standardization removes the signup-date effect on how long members have had to buy).`,
		mixpanelReport: { type: "Insights + warehouse", event: "account created", breakdown: "acquisition_channel", join: "paid_acquisition_daily.spend_usd" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
s AS (SELECT t::DATE AS d, count(*) AS signups, count(DISTINCT uid) AS users FROM ev WHERE event = 'account created' AND acquisition_channel = 'paid_social' GROUP BY 1),
sp AS (SELECT date::DATE AS d, spend_usd FROM ${WH("paid_acquisition_daily")} WHERE acquisition_channel = 'paid_social'),
j AS (SELECT (sp.d >= DATE '${SUMMER_SHRED_START.slice(0, 10)}' AND sp.d < DATE '${SUMMER_SHRED_END.slice(0, 10)}') AS shred, sum(sp.spend_usd) AS spend, sum(coalesce(s.signups, 0)) AS signups, sum(coalesce(s.users, 0))::BIGINT AS users
  FROM sp LEFT JOIN s ON s.d = sp.d GROUP BY 1)
SELECT 'all' AS grp, min(users) AS user_count,
 (max(spend / signups) FILTER (WHERE shred)) / (max(spend / signups) FILTER (WHERE NOT shred)) AS cac_ratio
FROM j`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.cac_ratio", op: "between", target: band(SHRED_CPI_MULT) },
				minCohort: 300,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
s AS (SELECT (t >= TIMESTAMP '${TS(SUMMER_SHRED_START)}' AND t < TIMESTAMP '${TS(SUMMER_SHRED_END)}') AS shred, acquisition_channel AS ch, uid FROM ev WHERE event = 'account created'),
g AS (SELECT shred, count(*) FILTER (WHERE ch = 'paid_social')::DOUBLE / count(*) AS social_share, count(DISTINCT uid) AS users FROM s GROUP BY 1)
SELECT 'all' AS grp, min(users) AS user_count,
 max(social_share) FILTER (WHERE shred) / max(social_share) FILTER (WHERE NOT shred) AS share_lift
FROM g`,
				},
				select: { a: { where: { grp: "all" } } },
				// (0.18 + 0.4 × (1 − 0.18 − 0.16)) / 0.18 from the declared channel weights
				expect: { metric: "a.share_lift", op: "between", target: band(SHRED_SHARE_LIFT) },
				minCohort: 800,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
s AS (SELECT uid, t AS t0, date_trunc('week', t) AS wk, acquisition_channel AS ch FROM ev WHERE event = 'account created'),
b AS (SELECT DISTINCT s.uid FROM s JOIN ev e ON e.uid = s.uid AND e.event = 'subscription purchased'),
w AS (SELECT wk,
  count(*) FILTER (WHERE ch = 'paid_social') AS sn, count(b.uid) FILTER (WHERE ch = 'paid_social') AS sb,
  count(*) FILTER (WHERE ch <> 'paid_social') AS onn, count(b.uid) FILTER (WHERE ch <> 'paid_social') AS ob
  FROM s LEFT JOIN b ON b.uid = s.uid GROUP BY 1)
-- signup-week standardized: time to purchase depends on signup date and paid
-- social is concentrated in Summer Shred weeks, so compare within each week
SELECT 'all' AS grp, LEAST(sum(sn), sum(onn))::BIGINT AS user_count,
 sum(sb)::DOUBLE / sum(sn * ob::DOUBLE / nullif(onn, 0)) AS std_ratio
FROM w WHERE onn > 0`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.std_ratio", op: "<=", target: 1 - PAID_SOCIAL_NO_BUY, floor: 1 - PAID_SOCIAL_NO_BUY / 2 },
				minCohort: 500,
			},
		],
	},
	{
		id: "H6-first-week-habit",
		hook: "H6",
		archetype: "retention-divergence",
		narrative: `New members who log fewer than ${HABIT_MIN_WORKOUTS} workouts in their first ${HABIT_DAYS} days are at risk: ${HABIT_CHURN_SHARE * 100}% of them go completely dark after day ${HABIT_CHURN_AFTER_DAYS}. Classification uses only first-week activity, so the return window never leaks into the segment. Day-28 retention (any event in days 28-34 after signup, signups at least 35 days before the window end) is at least 1/(1−${HABIT_CHURN_SHARE}) = ${1 / (1 - HABIT_CHURN_SHARE)}x higher for habit formers; organic selection (busier people retain better anyway) can only push it higher, so the knob is a floor and the read grades STRONG when selection adds lift.`,
		mixpanelReport: { type: "Retention", birth: "account created", return: "any event", breakdown: "cohort: ≥3 workout completed in first 7 days" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
s AS (SELECT uid, t AS t0 FROM ev WHERE event = 'account created' AND t < TIMESTAMP '${TS(DATASET_END)}' - INTERVAL 35 DAY),
f AS (SELECT s.uid,
  count(*) FILTER (WHERE e.event = 'workout completed' AND e.t < s.t0 + INTERVAL ${HABIT_DAYS} DAY) AS early,
  count(*) FILTER (WHERE e.t >= s.t0 + INTERVAL 28 DAY AND e.t < s.t0 + INTERVAL 35 DAY) AS d28
  FROM s JOIN ev e ON e.uid = s.uid GROUP BY 1)
SELECT CASE WHEN early >= ${HABIT_MIN_WORKOUTS} THEN 'habit' ELSE 'low' END AS grp, count(*) AS user_count,
 avg((d28 > 0)::INT) AS d28_retention
FROM f GROUP BY 1`,
				},
				select: { h: { where: { grp: "habit" } }, l: { where: { grp: "low" } } },
				expect: { metric: "h.d28_retention / l.d28_retention", op: ">=", target: 1 / (1 - HABIT_CHURN_SHARE), floor: 0.9 / (1 - HABIT_CHURN_SHARE) },
				minCohort: 400,
			},
		],
	},
	{
		id: "H7-team-vs-solo-challenges",
		hook: "H7",
		archetype: "funnel-conversion-by-segment",
		narrative: `Team challenges finish at ${TEAM_CONV}% per challenge and solo challenges at ${SOLO_CONV}% (two declared funnels with challenge_format props). Every challenge carries a challenge_id, so a totals funnel that holds challenge_id constant measures per-challenge completion without crediting one challenge's finish to another. Late joins that would finish after the window end trim both rates slightly.`,
		mixpanelReport: { type: "Funnels", steps: ["challenge joined", "challenge completed"], counting: "totals", holdPropertyConstant: "challenge_id", breakdown: "challenge_format" },
		assertions: [
			{
				breakdown: {
					type: "funnelFrequency",
					steps: [{ event: "challenge joined", where: { prop: "challenge_format", op: "eq", value: "team" } }, { event: "challenge completed", where: { prop: "challenge_format", op: "eq", value: "team" } }],
					breakdownByFrequencyOf: "challenge joined",
					countMode: "totals",
					holdPropertyConstant: "challenge_id",
					conversionWindowMs: 30 * DAY_MS,
				},
				select: { c: { where: { step_index: 1 } }, e: { where: { step_index: 0 } } },
				expect: { metric: "c.conversions / e.conversions", op: "between", target: band(TEAM_CONV / 100) },
			},
			{
				breakdown: {
					type: "funnelFrequency",
					steps: [{ event: "challenge joined", where: { prop: "challenge_format", op: "eq", value: "solo" } }, { event: "challenge completed", where: { prop: "challenge_format", op: "eq", value: "solo" } }],
					breakdownByFrequencyOf: "challenge joined",
					countMode: "totals",
					holdPropertyConstant: "challenge_id",
					conversionWindowMs: 30 * DAY_MS,
				},
				select: { c: { where: { step_index: 1 } }, e: { where: { step_index: 0 } } },
				expect: { metric: "c.conversions / e.conversions", op: "between", target: band(SOLO_CONV / 100) },
			},
		],
	},
	{
		id: "H8-push-fatigue",
		hook: "H8",
		archetype: "frequency-sweet-spot",
		narrative: `Members who receive ${PUSH_FATIGUE_THRESHOLD}+ notifications in the window stop opening them: ${PUSH_FATIGUE_FLIP * 100}% of their would-be opens go unopened, so their open rate is ${(1 - PUSH_FATIGUE_FLIP).toFixed(1)}x that of lighter recipients. Opens are an independent per-notification draw (3 in 4 organically), and the threshold is applied to the final notification count, so the cohort split is exact and the ratio reads the knob.`,
		mixpanelReport: { type: "Insights", event: "notification received", measure: "share with opened = true", breakdown: `cohort: ${PUSH_FATIGUE_THRESHOLD}+ notification received` },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
n AS (SELECT uid, count(*) AS c, avg(opened::INT) AS open_rate, sum(opened::INT) AS opens FROM ev WHERE event = 'notification received' GROUP BY 1)
SELECT CASE WHEN c >= ${PUSH_FATIGUE_THRESHOLD} THEN 'heavy' ELSE 'light' END AS grp, count(*) AS user_count,
 sum(opens)::DOUBLE / sum(c) AS open_rate
FROM n GROUP BY 1`,
				},
				select: { h: { where: { grp: "heavy" } }, l: { where: { grp: "light" } } },
				expect: { metric: "h.open_rate / l.open_rate", op: "between", target: band(1 - PUSH_FATIGUE_FLIP) },
				minCohort: 1000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
n AS (SELECT uid, count(*) AS c, sum(opened::INT) AS opens FROM ev WHERE event = 'notification received' GROUP BY 1)
SELECT 'light' AS grp, count(*) AS user_count, sum(opens)::DOUBLE / sum(c) AS open_rate FROM n WHERE c < ${PUSH_FATIGUE_THRESHOLD}`,
				},
				select: { l: { where: { grp: "light" } } },
				// untouched control = the declared pool [true, true, true, false]
				expect: { metric: "l.open_rate", op: "between", target: band(0.75) },
				minCohort: 1000,
			},
		],
	},
	{
		id: "H9-fall-reset-program",
		hook: "H9",
		archetype: "temporal-inflection",
		narrative: `The Fall Reset program (${FALL_RESET_START.slice(0, 10)}, ${FALL_RESET_DAYS} days) is a world event that multiplies workout planning and completion by ${FALL_RESET_MULT}. App opens are untouched, so (workouts / app opens) during the program vs the ${FALL_RESET_DAYS} days before reads the multiplier while cancelling weekday mix and the overall trend.`,
		mixpanelReport: { type: "Insights", events: ["workout completed", "app opened"], measure: "total", chart: "daily line, formula A/B" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
w AS (SELECT (t >= TIMESTAMP '${TS(FALL_RESET_START)}') AS prog, event, uid FROM ev
  WHERE event IN ('workout completed', 'app opened') AND t >= TIMESTAMP '${RESET_BASE_FROM}' AND t < TIMESTAMP '${RESET_END}'),
g AS (SELECT prog, count(*) FILTER (WHERE event = 'workout completed')::DOUBLE / count(*) FILTER (WHERE event = 'app opened') AS r, count(DISTINCT uid) AS users FROM w GROUP BY 1)
SELECT 'all' AS grp, min(users) AS user_count, max(r) FILTER (WHERE prog) / max(r) FILTER (WHERE NOT prog) AS did FROM g`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.did", op: "between", target: band(FALL_RESET_MULT) },
				minCohort: 2000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
w AS (SELECT (t >= TIMESTAMP '${TS(FALL_RESET_START)}') AS prog, event, uid FROM ev
  WHERE event IN ('workout planned', 'app opened') AND t >= TIMESTAMP '${RESET_BASE_FROM}' AND t < TIMESTAMP '${RESET_END}'),
g AS (SELECT prog, count(*) FILTER (WHERE event = 'workout planned')::DOUBLE / count(*) FILTER (WHERE event = 'app opened') AS r, count(DISTINCT uid) AS users FROM w GROUP BY 1)
SELECT 'all' AS grp, min(users) AS user_count, max(r) FILTER (WHERE prog) / max(r) FILTER (WHERE NOT prog) AS did FROM g`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.did", op: "between", target: band(FALL_RESET_MULT) },
				minCohort: 2000,
			},
		],
	},
];


export default config;
