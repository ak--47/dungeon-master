// ── IMPORTS ──
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);
import "dotenv/config";
import * as u from "@ak--47/dungeon-master/utils";
/** @typedef  {import("../../../types").Dungeon} Config */

// ── OVERVIEW ──
/*
 * NAME:       FitQuest
 * APP:        Fitness & wellness app for workout tracking, meal planning,
 *             social fitness challenges, and AI coaching. Core loop: sign
 *             up → plan workout → complete workout → track progress.
 *             Revenue: free / monthly ($12.99, 7-day trial) / annual
 *             ($99.99) / family ($149.99).
 * SCALE:      10,000 users, ~1.4M events, 121 days (2026-01-01 → 2026-05-01)
 * CORE LOOP:  account created → workout planned → workout completed → progress checked
 *
 * EVENTS (18):
 *   workout completed (8) > app session (8) > meal logged (7) > workout planned (6)
 *   > progress checked (5) > notification received (5) > leaderboard viewed (4)
 *   > nutrition plan viewed (4) > challenge joined (3) > coach session (3)
 *   > heart rate recorded (3) > achievement unlocked (2) > friend added (2)
 *   > challenge completed (2) > subscription managed (2) > profile updated (2)
 *   > account created (1) > account deactivated (1)
 *
 * FUNNELS (5):
 *   - Onboarding:           account created → profile updated → workout planned → workout completed (45%)
 *   - Workout Loop:         workout planned → workout completed → progress checked (45%, reentry)
 *   - Social Engagement:    friend added → leaderboard viewed → challenge joined (35%)
 *   - Challenge Completion: challenge joined → workout completed → challenge completed → achievement unlocked (30%)
 *   - Coaching Path:        coach session → workout planned → workout completed → progress checked (50%)
 *
 * USER PROPS:  fitness_level, segment, streak_days, total_workouts, preferred_workout, goal, Platform, workout_type, subscription_tier
 * SUPER PROPS: Platform, workout_type, subscription_tier
 * SCD PROPS:   fitness_level (beginner/intermediate/advanced/elite, monthly fuzzy, max 8)
 * GROUPS:      none
 */

// ── HOOK STORIES ──
/*
 * NOTE: All cohort effects are HIDDEN — no flag stamping. Discoverable
 * via raw-prop breakdowns (HOD, day, segment) or behavioral cohorts.
 *
 * ───────────────────────────────────────────────────────────────
 * 1. MORNING WORKOUT BOOST (everything)
 * ───────────────────────────────────────────────────────────────
 *
 * PATTERN: Workouts in 5-9 UTC get calories_burned 1.3x. Mutates
 * raw prop. No flag.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Avg Calories Burned by Hour of Day
 *   - Event: "workout completed"
 *   - Measure: Average of "calories_burned"
 *   - Breakdown: hour of day
 *   - Expected: 5-9 hours show ~ 1.3x baseline
 *
 * REAL-WORLD ANALOGUE: Morning workouts get a metabolic boost.
 *
 * ───────────────────────────────────────────────────────────────
 * 2. POST-LAUNCH AI COACHING LIFT (everything hook)
 * ───────────────────────────────────────────────────────────────
 *
 * PATTERN: After day 35 (ai_coach feature launch), workouts
 * with coaching_mode="ai_assisted" get 1.2x duration_minutes.
 * AI coaching helps users push through longer sessions.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: AI Coaching Duration Lift
 *   • Report type: Insights
 *   • Event: "workout completed"
 *   • Measure: Average of "duration_minutes"
 *   • Breakdown: "coaching_mode"
 *   • Filter: time after day 35
 *   • Expected: ai_assisted ≈ 48 min vs self_guided ≈ 40 min
 *
 *   Report 2: AI Coaching Adoption Over Time
 *   • Report type: Insights
 *   • Event: "workout completed"
 *   • Measure: Total
 *   • Breakdown: "coaching_mode"
 *   • Line chart by week
 *   • Expected: ai_assisted grows from 0 after day 35
 *
 * REAL-WORLD ANALOGUE: AI-powered coaching features increase
 * session duration as users get real-time form and pacing guidance.
 *
 * ───────────────────────────────────────────────────────────────
 * 3. STREAK RETENTION (everything hook)
 * ───────────────────────────────────────────────────────────────
 *
 * PATTERN: Users with >=2 workout events get streak_days set
 * to their actual workout count on their profile (this OVERWRITES
 * H7's coach initialization for any coach with >=2 workouts), and
 * receive achievement clones with super-linear scaling:
 * C(w) = min(w-1, 3) + 4*max(w-4, 0) — 1 per workout for
 * workouts 2-4, then 4 per workout beyond that. This amplifies
 * the gap so athlete/casual ratio reaches 2x+.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Achievement Events by Workout Volume
 *   • Report type: Insights
 *   • Event: "achievement unlocked"
 *   • Measure: Total per user
 *   • Breakdown: user property "segment"
 *   • Expected: athlete and coach segments show 2-3x more
 *     achievements than casual and resolver segments
 *
 *   Report 2: Streak Days Distribution
 *   • Report type: Insights
 *   • Event: "profile updated"
 *   • Measure: Average of user property "streak_days"
 *   • Breakdown: user property "segment"
 *   • Expected: athlete/coach ≈ 30-50 streaks, casual ≈ 10-15
 *
 * REAL-WORLD ANALOGUE: Gamification streaks are the #1 retention
 * driver in fitness apps — users who hit milestones stay longer.
 *
 * ───────────────────────────────────────────────────────────────
 * 4. SOCIAL CHALLENGE COMPLETION (everything hook)
 * ───────────────────────────────────────────────────────────────
 *
 * PATTERN: Users with >=3 "friend added" events receive
 * max(1, floor(0.5 × completions)) cloned "challenge completed"
 * events (≈1.5x total). Social users are more accountable.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Challenge Completion Rate by Social Activity
 *   • Report type: Insights
 *   • Event: "challenge completed"
 *   • Measure: Total per user
 *   • Filter: users who did "friend added" at least once
 *   • Compare to: users who never did "friend added"
 *   • Expected: social users ≈ 1.5x more challenge completions
 *
 * REAL-WORLD ANALOGUE: Social accountability is a proven
 * motivator — users with friends complete more challenges.
 *
 * ───────────────────────────────────────────────────────────────
 * 5. RESOLVER CHURN CLIFF (everything hook)
 * ───────────────────────────────────────────────────────────────
 *
 * PATTERN: Users in the "resolver" segment with <30 events
 * (at hook time) lose 70% of their post-day-14 events — the classic
 * New Year's resolution drop-off. The cliff is engineered entirely
 * by this hook (persona churnRate/activeWindow fields are deprecated
 * engine no-ops). Because deletions are the only mutation, the
 * treated cohort is output-identifiable: eligible ⟺ output events
 * < 30 (treated users can only shrink; untreated keep ≥ 30).
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Resolver Retention Drop
 *   • Report type: Insights
 *   • Event: All events
 *   • Measure: Total
 *   • Filter: segment = "resolver"
 *   • Line chart by week
 *   • Expected: Sharp cliff after week 2, ~70% drop in volume
 *
 *   Report 2: Segment Retention Comparison
 *   • Report type: Retention
 *   • Starting event: "account created"
 *   • Return event: Any active event
 *   • Breakdown: user property "segment"
 *   • Expected: resolver retention drops to <30% by week 3
 *
 * REAL-WORLD ANALOGUE: 80% of New Year's gym memberships are
 * abandoned by mid-February — the "resolution cliff."
 *
 * ───────────────────────────────────────────────────────────────
 * 6. COACH SESSION QUALITY (everything hook)
 * ───────────────────────────────────────────────────────────────
 *
 * PATTERN: Users with "coach session" events get higher
 * satisfaction_score (4.0-5.0) on those events. Coached users
 * rate their experience higher.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Satisfaction by Session Type
 *   • Report type: Insights
 *   • Event: "coach session"
 *   • Measure: Average of "satisfaction_score"
 *   • Expected: ≈ 4.5 avg (uniform [4.0, 5.0] redraw)
 *
 * REAL-WORLD ANALOGUE: Personal coaching sessions have higher
 * satisfaction scores because of personalized attention.
 *
 * ───────────────────────────────────────────────────────────────
 * 7. COACH PROFILE ENRICHMENT (user hook)
 * ───────────────────────────────────────────────────────────────
 *
 * PATTERN: Users in the "coach" segment get total_workouts
 * boosted to 200-500 (uniform, avg 350). Coaches are power users
 * who lead by example. (The hook also seeds streak_days 60-365,
 * but H3 overwrites streak_days with the actual workout count for
 * any user with >=2 workouts — which is nearly every coach — so
 * total_workouts is the durable coach signature.)
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Workout Volume by Segment
 *   • Report type: Insights
 *   • Event: "workout completed"
 *   • Measure: Average of user property "total_workouts"
 *   • Breakdown: user property "segment"
 *   • Expected: coach ≈ 350 vs athlete ≈ 0 (default) vs casual ≈ 0
 *
 * REAL-WORLD ANALOGUE: Fitness coaches maintain extreme workout
 * consistency to build credibility with their clients.
 *
 * ───────────────────────────────────────────────────────────────
 * 8. ANNUAL SUBSCRIBER WORKOUT FUNNEL LIFT (everything hook)
 * ───────────────────────────────────────────────────────────────
 *
 * PATTERN: Free/monthly-tier users lose ~30% of "progress checked"
 * events (last step of the Workout Loop funnel), simulating lower
 * follow-through. Annual/family subscribers retain all events.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Workout Funnel Conversion by Tier
 *   • Report type: Funnels
 *   • Steps: "workout planned" → "workout completed" → "progress checked"
 *   • Breakdown: "subscription_tier" (superProp)
 *   • Expected: annual ≈ 63% vs free ≈ 45% conversion
 *
 * REAL-WORLD ANALOGUE: Annual gym memberships have higher
 * utilization — sunk cost + commitment drives consistency.
 *
 * ───────────────────────────────────────────────────────────────
 * 9. WORKOUT LOOP TIME-TO-CONVERT (funnel-post)
 * ───────────────────────────────────────────────────────────────
 *
 * PATTERN: Annual + family subscribers complete funnels 1.3x
 * faster (factor 0.77); Free users 1.25x slower (factor 1.25).
 * The funnel-post hook scales EVERY funnel instance's gaps by the
 * tier factor (not only Workout Loop) — the story is measured on
 * the Workout Loop funnel, where volume is highest.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Workout Loop Median Time-to-Convert by Subscription
 *   - Funnels > "workout planned" -> "workout completed" -> "progress checked"
 *   - Measure: Median time to convert
 *   - Breakdown: subscription_tier
 *   - Expected: annual ~ 0.77x; free ~ 1.25x (vs monthly = 1.0)
 *
 *   NOTE (funnel-post measurement): visible only via Mixpanel funnel
 *   median TTC. Cross-event MIN→MIN SQL queries on raw events do NOT
 *   show this — funnel-post adjusts gaps within funnel instances, not
 *   across the user's full event history.
 *
 * ───────────────────────────────────────────────────────────────
 * 10. WORKOUT-COUNT MAGIC NUMBER (everything)
 * ───────────────────────────────────────────────────────────────
 *
 * PATTERN: Sweet 12-14 workouts/user → +35% on workout
 * duration_minutes (peak progression). Over 15+ → drop 65% of
 * post-day-30 non-workout, non-progress events (overtraining
 * churn). Preserves workout + progress events so H8 funnel
 * lift isn't diluted. No flag.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Avg Workout Duration by Workout-Count Bucket
 *   - Cohort A: users with 12-14 "workout completed"
 *   - Cohort B: users with 0-11
 *   - Event: "workout completed"
 *   - Measure: Average of "duration_minutes"
 *   - Expected: A ~ 1.35x B
 *
 *   Report 2: D30+ Activity on Heavy Workout Cohort
 *   - Cohort C: users with >= 15 "workout completed"
 *   - Cohort A: users with 12-14
 *   - Event: any event
 *   - Measure: post-d30/pre-d30 ratio per user
 *   - Expected: C ~ 70% lower post/pre ratio than A (overtraining churn)
 *
 * REAL-WORLD ANALOGUE: Sweet-spot training drives progression;
 * over-training causes injury and burnout.
 *
 * ═══════════════════════════════════════════════════════════════
 * EXPECTED METRICS SUMMARY
 * ═══════════════════════════════════════════════════════════════
 *
 * Hook                        | Metric                       | Expected      | Measured (10K full fidelity)
 * ----------------------------|------------------------------|---------------|------------------------------
 * Morning Workout Boost       | calories 5-9h / other        | 1.30          | 1.304 avg / 1.303 med
 * AI Coaching Lift            | post-launch dur ai/self      | 1.20          | 1.192 (pre-launch ai rows: 0)
 * AI Coaching Lift            | post-launch ai share         | 0.40          | 0.4004
 * Streak Retention            | streak_days ≥ workouts (1-s) | 0 violations  | 0 (6602 streak users)
 * Streak Retention            | streak_days == workouts share| ≥0.99         | 0.9961
 * Streak Retention            | ach − C(w) ≥ 1 share         | ≥0.995        | 0.9967 (med organic = 1)
 * Social Challenge Completion | count-fingerprint gap hits   | ~0            | 0 of 1681
 * Social Challenge Completion | social hi/lo challenges/user | 1.5-4x        | 3.348
 * Resolver Churn Cliff        | birth-pinned DD (lo/hi ÷ cas)| 0.30 keep-rate| 0.2968
 * Resolver Churn Cliff        | casual lo/hi placebo         | ~1 (sel. only)| 1.370
 * Coach Session Quality       | satisfaction avg (median)    | 4.5           | 4.498 (4.500); sub-4.0 rows: 0
 * Coach Profile Enrichment    | coach total_workouts         | [200,500]/350 | [200, 500] exact / avg 350
 * Annual Follow-Through       | std zero-share cliff         | 0.30          | 0.3003
 * Annual Follow-Through       | std survivor ratio           | 1.0           | 0.9360
 * Workout Loop T2C            | median TTC free/monthly      | ≤1.25         | 1.079
 * Workout Loop T2C            | median TTC annual/monthly    | ≥0.77         | 0.8847
 * Workout Magic Number        | sweet/low pre-d35 avg dur    | 1.35          | 1.362
 * Workout Magic Number        | over/sweet d30 post-pre      | ~0.35×τ       | 0.3710
 */

// ── SCALE ──
const SEED = "dm4-fitness";
const NUM_USERS = 10_000;
const DATASET_START = "2026-01-01T00:00:00Z";
const DATASET_END = "2026-05-01T23:59:59Z";
const EVENTS_PER_DAY = 1.2;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── KNOBS (tweak these to reshape stories) ──
const MORNING_HOUR_START = 5;
const MORNING_HOUR_END = 9;
const MORNING_CALORIE_MULT = 1.3;

const AI_LAUNCH_DAY = 35;
const AI_ADOPTION_LIKELIHOOD = 40;
const AI_DURATION_MULT = 1.2;

const GROUP_LAUNCH_DAY = 55;
const GROUP_ADOPTION_LIKELIHOOD = 30;

const STREAK_MIN_WORKOUTS = 2;
const STREAK_LINEAR_CAP = 3;     // workouts 2-4 (count - 1 capped to 3) → 1 achievement each
const STREAK_SUPER_LINEAR_MULT = 4; // workouts 5+ → 4 achievements each

const SOCIAL_FRIEND_THRESHOLD = 3;
const SOCIAL_CHALLENGE_CLONE_FACTOR = 0.5;

const RESOLVER_EVENT_THRESHOLD = 30;
const RESOLVER_CLIFF_DAYS = 14;
const RESOLVER_DROP_LIKELIHOOD = 70;

const COACH_SESSION_SATISFACTION_MIN = 4.0;
const COACH_SESSION_SATISFACTION_MAX = 5.0;

const COACH_TOTAL_WORKOUTS_MIN = 200;
const COACH_TOTAL_WORKOUTS_MAX = 500;
const COACH_STREAK_DAYS_MIN = 60;
const COACH_STREAK_DAYS_MAX = 365;

const ANNUAL_FUNNEL_FREE_DROP_LIKELIHOOD = 30;

const TTC_ANNUAL_FACTOR = 0.77;
const TTC_FREE_FACTOR = 1.25;

const WORKOUT_SWEET_MIN = 12;
const WORKOUT_SWEET_MAX = 14;
const WORKOUT_OVER_THRESHOLD = 15;
const WORKOUT_DURATION_BOOST = 1.35;
const WORKOUT_OVER_CUTOFF_DAYS = 30;
const WORKOUT_OVER_DROP_LIKELIHOOD = 65;

// ── HELPER FUNCTIONS ──
function handleUserHooks(record) {
	// H7: COACH PROFILE ENRICHMENT — coach segment users get high
	// total_workouts + streak_days. Also assign subscription_tier by segment.
	if (record.segment === "coach") {
		record.total_workouts = chance.integer({ min: COACH_TOTAL_WORKOUTS_MIN, max: COACH_TOTAL_WORKOUTS_MAX });
		record.streak_days = chance.integer({ min: COACH_STREAK_DAYS_MIN, max: COACH_STREAK_DAYS_MAX });
	}
	// Subscription tier: athletes/coaches → annual/family; social → monthly; casual/resolver → mostly free
	if (record.segment === "athlete") {
		record.subscription_tier = chance.pickone(["annual", "annual", "family", "monthly"]);
	} else if (record.segment === "coach") {
		record.subscription_tier = chance.pickone(["annual", "family", "family"]);
	} else if (record.segment === "social") {
		record.subscription_tier = chance.pickone(["monthly", "monthly", "annual", "free"]);
	} else if (record.segment === "resolver") {
		record.subscription_tier = chance.pickone(["free", "free", "free", "monthly"]);
	} else {
		record.subscription_tier = chance.pickone(["free", "free", "monthly"]);
	}
	return record;
}

function handleFunnelPostHooks(record, meta) {
	// H9: WORKOUT LOOP TIME-TO-CONVERT — Annual/family complete 1.3x faster
	// (factor 0.77); Free 1.25x slower (factor 1.25).
	const tier = meta?.profile?.subscription_tier;
	if (Array.isArray(record) && record.length > 1) {
		const factor = (
			tier === "annual" || tier === "family" ? TTC_ANNUAL_FACTOR :
			tier === "free" ? TTC_FREE_FACTOR :
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
	return record;
}

function handleEverythingHooks(record, meta) {
	// UTC anchor: the day-offset cutoffs below (day 35/55/14/30) must not
	// depend on the generating machine's timezone/DST rules
	const datasetStart = dayjs.unix(meta.datasetStart).utc();
	let events = record;
	if (!events.length) return record;

	// ── SUPERPROP STAMPING ──────────────────────────
	// Stamp superProps from profile so they are consistent per user.
	if (meta && meta.profile) {
		const p = meta.profile;
		events.forEach(e => {
			if (p.Platform) e.Platform = p.Platform;
			if (p.workout_type) e.workout_type = p.workout_type;
			if (p.subscription_tier) e.subscription_tier = p.subscription_tier;
		});
	}

	// HOOK 1: MORNING WORKOUT BOOST — 5AM-9AM UTC workouts get
	// calories_burned 1.3x. No flag — analyst breaks down by HOD.
	events.forEach(e => {
		if (e.event === "workout completed") {
			const hour = new Date(e.time).getUTCHours();
			if (hour >= MORNING_HOUR_START && hour < MORNING_HOUR_END && e.calories_burned) {
				e.calories_burned = Math.floor(e.calories_burned * MORNING_CALORIE_MULT);
			}
		}
	});

	// ── HOOK 2: POST-LAUNCH AI COACHING LIFT ────────────
	// After day 35, ~40% of workouts switch to ai_assisted coaching,
	// then ai_assisted workouts get 1.2x duration.
	const AI_LAUNCH = datasetStart.add(AI_LAUNCH_DAY, "days");
	events.forEach(e => {
		if ((e.event === "workout completed" || e.event === "workout planned") &&
			dayjs(e.time).isAfter(AI_LAUNCH)) {
			// Adopt ai_assisted for ~40% of post-launch workouts
			if (chance.bool({ likelihood: AI_ADOPTION_LIKELIHOOD })) {
				e.coaching_mode = "ai_assisted";
			}
			// AI-assisted workouts get 1.2x duration
			if (e.coaching_mode === "ai_assisted") {
				if (e.duration_minutes) {
					e.duration_minutes = Math.floor(e.duration_minutes * AI_DURATION_MULT);
				}
				if (e.planned_duration_minutes) {
					e.planned_duration_minutes = Math.floor(e.planned_duration_minutes * AI_DURATION_MULT);
				}
			}
		}
	});

	// ── GROUP CHALLENGES ADOPTION ────────────────────
	// After day 55, ~30% of challenge events switch to group mode.
	const GROUP_LAUNCH = datasetStart.add(GROUP_LAUNCH_DAY, "days");
	events.forEach(e => {
		if ((e.event === "challenge joined" || e.event === "workout completed") &&
			dayjs(e.time).isAfter(GROUP_LAUNCH) &&
			chance.bool({ likelihood: GROUP_ADOPTION_LIKELIHOOD })) {
			e.challenge_mode = "group";
		}
	});

	// ── HOOK 8: ANNUAL SUBSCRIBER CONVERSION FILTER ─
	// Free/monthly-tier users drop ~30% of "progress checked"
	// (last step of Workout Loop funnel) to simulate lower conversion.
	if (meta && meta.profile) {
		const tier = meta.profile.subscription_tier;
		if (tier !== "annual" && tier !== "family" && chance.bool({ likelihood: ANNUAL_FUNNEL_FREE_DROP_LIKELIHOOD })) {
			record = record.filter(e => e.event !== "progress checked");
			events = record;
		}
	}

	// ── HOOK 3: STREAK RETENTION ─────────────────────
	// Users with >=2 workouts get streak_days updated and
	// cloned achievement events. Achievements scale super-
	// linearly: 1 per workout for workouts 2-4, then 4 per
	// workout beyond that.
	const workoutEvents = events.filter(e => e.event === "workout completed");
	if (workoutEvents.length >= STREAK_MIN_WORKOUTS) {
		// Update profile streak_days via a profile update event
		if (meta && meta.profile) {
			meta.profile.streak_days = workoutEvents.length;
		}

		// Super-linear achievement scaling:
		// workouts 2-4: 1 achievement each
		// workouts 5+: 4 achievements each
		const templateAchievement = events.find(e => e.event === "achievement unlocked");
		if (templateAchievement) {
			let achievementCount = Math.min(workoutEvents.length - 1, STREAK_LINEAR_CAP); // 1 each for workouts 2-4
			if (workoutEvents.length > 4) {
				achievementCount += (workoutEvents.length - 4) * STREAK_SUPER_LINEAR_MULT; // 4 each for workouts 5+
			}
			for (let a = 0; a < achievementCount; a++) {
				const srcIdx = Math.min(a, workoutEvents.length - 1);
				const sourceEvent = workoutEvents[srcIdx];
				events.push({
					...templateAchievement,
					time: dayjs(sourceEvent.time).add(chance.integer({ min: 1, max: 60 }), "minutes").toISOString(),
					user_id: sourceEvent.user_id,
					// engine stamps insert_id at generation — clones need fresh
					// ids or Mixpanel dedups them against the template
					insert_id: chance.guid(),
					achievement_type: "streak_milestone",
					streak_days_at_unlock: a + 2,
				});
			}
		}
	}

	// ── HOOK 4: SOCIAL CHALLENGE COMPLETION ──────────
	// Users with >=3 friend_added events get 1.5x challenge completions.
	const friendCount = events.filter(e => e.event === "friend added").length;
	if (friendCount >= SOCIAL_FRIEND_THRESHOLD) {
		const templateChallenge = events.find(e => e.event === "challenge completed");
		if (templateChallenge) {
			const challengeCompletions = events.filter(e => e.event === "challenge completed");
			const extraCount = Math.max(1, Math.floor(challengeCompletions.length * SOCIAL_CHALLENGE_CLONE_FACTOR));
			for (let i = 0; i < extraCount; i++) {
				const source = challengeCompletions[i % challengeCompletions.length];
				events.push({
					...templateChallenge,
					time: dayjs(source.time).add(chance.integer({ min: 1, max: 48 }), "hours").toISOString(),
					user_id: source.user_id,
					insert_id: chance.guid(),
					challenge_type: source.challenge_type,
					completion_pct: chance.integer({ min: 80, max: 100 }),
				});
			}
		}
	}

	// ── HOOK 5: RESOLVER CHURN CLIFF ─────────────────
	// Resolver segment users with <30 events lose 70% after day 14.
	if (meta && meta.profile && meta.profile.segment === "resolver" && events.length < RESOLVER_EVENT_THRESHOLD) {
		const CHURN_CLIFF = datasetStart.add(RESOLVER_CLIFF_DAYS, "days");
		for (let i = events.length - 1; i >= 0; i--) {
			const eventTime = dayjs(events[i].time);
			if (eventTime.isAfter(CHURN_CLIFF) && chance.bool({ likelihood: RESOLVER_DROP_LIKELIHOOD })) {
				events.splice(i, 1);
			}
		}
	}

	// HOOK 6: COACH SESSION QUALITY — coach-session satisfaction 4-5.
	const hasCoachSessions = events.some(e => e.event === "coach session");
	if (hasCoachSessions) {
		events.forEach(e => {
			if (e.event === "coach session") {
				e.satisfaction_score = chance.floating({ min: COACH_SESSION_SATISFACTION_MIN, max: COACH_SESSION_SATISFACTION_MAX, fixed: 1 });
			}
		});
	}

	// HOOK 10: WORKOUT-COUNT MAGIC NUMBER (no flags)
	// Sweet 12-14 workouts → +35% on workout duration_minutes (peak
	// progression). Over 15+ → drop 65% of post-day-30 non-workout
	// events (overtraining → churn). Workout events are preserved
	// so the bucket categorization stays consistent.
	const workoutCount = events.filter(e => e.event === "workout completed").length;
	if (workoutCount >= WORKOUT_SWEET_MIN && workoutCount <= WORKOUT_SWEET_MAX) {
		events.forEach(e => {
			if (e.event === "workout completed" && typeof e.duration_minutes === "number") {
				e.duration_minutes = Math.round(e.duration_minutes * WORKOUT_DURATION_BOOST);
			}
		});
	} else if (workoutCount >= WORKOUT_OVER_THRESHOLD) {
		const day30 = datasetStart.add(WORKOUT_OVER_CUTOFF_DAYS, "days");
		const preserveEvents = new Set(["workout completed", "progress checked"]);
		for (let i = events.length - 1; i >= 0; i--) {
			if (!preserveEvents.has(events[i].event) &&
				dayjs(events[i].time).isAfter(day30) && chance.bool({ likelihood: WORKOUT_OVER_DROP_LIKELIHOOD })) {
				events.splice(i, 1);
			}
		}
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
		hasDesktopDevices: false,
		hasBrowser: false,
		hasCampaigns: false,
		isAnonymous: false,
		hasAdSpend: false,
		hasAvatar: true,
	},
	identity: {
		avgDevicePerUser: 3,
	},
	concurrency: 1,
	writeToDisk: false,
	scdProps: {
		fitness_level: {
			values: ["beginner", "intermediate", "advanced", "elite"],
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
				referral_source: ["organic", "friend_invite", "app_store", "social_media", "search"],
			},
		},
		{
			event: "workout completed",
			weight: 8,
			isStrictEvent: false,
			properties: {
				duration_minutes: u.weighNumRange(10, 90, 0.5, 40),
				calories_burned: u.weighNumRange(50, 800, 0.4, 300),
				heart_rate_avg: u.weighNumRange(80, 185, 0.5, 130),
				satisfaction_score: u.weighNumRange(1, 5, 0.7, 3),
				coaching_mode: ["self_guided"],
				challenge_mode: ["solo"],
			},
		},
		{
			event: "workout planned",
			weight: 6,
			isStrictEvent: false,
			properties: {
				planned_duration_minutes: u.weighNumRange(15, 90, 0.5, 45),
				day_of_week: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
				coaching_mode: ["self_guided"],
			},
		},
		{
			event: "meal logged",
			weight: 7,
			properties: {
				meal_type: ["breakfast", "lunch", "dinner", "snack"],
				calories: u.weighNumRange(50, 1200, 0.5, 400),
				protein_g: u.weighNumRange(0, 60, 0.5, 20),
				meal_quality: ["healthy", "healthy", "balanced", "balanced", "indulgent"],
			},
		},
		{
			event: "challenge joined",
			weight: 3,
			isStrictEvent: false,
			properties: {
				challenge_type: ["steps", "calories", "streak", "strength", "team_relay"],
				duration_days: [7, 14, 21, 30],
				participants: u.weighNumRange(2, 50, 0.3, 10),
				challenge_mode: ["solo"],
			},
		},
		{
			event: "challenge completed",
			weight: 2,
			isStrictEvent: false,
			properties: {
				challenge_type: ["steps", "calories", "streak", "strength", "team_relay"],
				final_rank: u.weighNumRange(1, 50, 0.3, 10),
				completion_pct: u.weighNumRange(50, 100, 0.7, 85),
				challenge_mode: ["solo"],
			},
		},
		{
			event: "achievement unlocked",
			weight: 2,
			isStrictEvent: false,
			properties: {
				achievement_type: ["streak_milestone", "weight_goal", "distance_record", "calories_target", "social_champion", "first_workout"],
				streak_days_at_unlock: u.weighNumRange(1, 100, 0.3, 10),
			},
		},
		{
			event: "friend added",
			weight: 2,
			isStrictEvent: false,
			properties: {
				source: ["search", "contacts", "challenge", "suggestion", "qr_code"],
			},
		},
		{
			event: "leaderboard viewed",
			weight: 4,
			properties: {
				leaderboard_type: ["friends", "global", "challenge", "local"],
				user_rank: u.weighNumRange(1, 500, 0.3, 50),
			},
		},
		{
			event: "progress checked",
			weight: 5,
			isStrictEvent: false,
			properties: {
				metric_viewed: ["weight", "body_fat", "steps", "calories_burned", "workout_count", "streaks"],
				trend_direction: ["improving", "improving", "stable", "declining"],
				time_range: ["week", "month", "3_months", "year"],
			},
		},
		{
			event: "coach session",
			weight: 3,
			isStrictEvent: false,
			properties: {
				session_type: ["live_video", "chat", "plan_review", "form_check"],
				duration_minutes: u.weighNumRange(10, 60, 0.5, 30),
				satisfaction_score: u.weighNumRange(1, 5, 0.6, 3),
				coach_speciality: ["strength", "cardio", "nutrition", "yoga", "general"],
			},
		},
		{
			event: "nutrition plan viewed",
			weight: 4,
			properties: {
				plan_type: ["weight_loss", "muscle_gain", "maintenance", "custom"],
				adherence_pct: u.weighNumRange(0, 100, 0.5, 60),
			},
		},
		{
			event: "heart rate recorded",
			weight: 3,
			properties: {
				bpm: u.weighNumRange(50, 200, 0.5, 110),
				activity_state: ["resting", "warmup", "active", "peak", "cooldown"],
				device: ["watch", "chest_strap", "phone_sensor"],
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
			event: "notification received",
			weight: 5,
			properties: {
				notification_type: ["workout_reminder", "workout_reminder", "challenge_update", "friend_activity", "streak_warning", "coaching_tip"],
				channel: ["push", "push", "email", "sms"],
				opened: [true, true, true, false],
			},
		},
		{
			event: "subscription managed",
			weight: 2,
			properties: {
				action: ["viewed_plans", "started_trial", "upgraded", "downgraded", "cancelled", "renewed"],
				plan_viewed: ["free", "monthly", "annual", "family"],
			},
		},
		{
			event: "profile updated",
			weight: 2,
			isStrictEvent: false,
			properties: {
				field_updated: ["weight", "height", "goal", "avatar", "workout_preferences", "notification_settings"],
			},
		},
		{
			event: "account deactivated",
			weight: 1,
			isChurnEvent: true,
			returnLikelihood: 0.15,
			isStrictEvent: true,
			properties: {
				reason: ["lost_motivation", "cost", "switched_app", "injury", "achieved_goal"],
			},
		},
	],

	// ── Funnels (5) ──────────────────────────────────────────
	funnels: [
		{
			name: "Onboarding",
			sequence: ["account created", "profile updated", "workout planned", "workout completed"],
			conversionRate: 45,
			order: "sequential",
			isFirstFunnel: true,
			timeToConvert: 72,
			weight: 3,
		},
		{
			name: "Workout Loop",
			sequence: ["workout planned", "workout completed", "progress checked"],
			conversionRate: 45,
			order: "sequential",
			timeToConvert: 48,
			weight: 5,
			reentry: true,
		},
		{
			name: "Social Engagement",
			sequence: ["friend added", "leaderboard viewed", "challenge joined"],
			conversionRate: 35,
			order: "sequential",
			timeToConvert: 96,
			weight: 3,
		},
		{
			name: "Challenge Completion",
			sequence: ["challenge joined", "workout completed", "challenge completed", "achievement unlocked"],
			conversionRate: 30,
			order: "sequential",
			timeToConvert: 336,
			weight: 2,
		},
		{
			name: "Coaching Path",
			sequence: ["coach session", "workout planned", "workout completed", "progress checked"],
			conversionRate: 50,
			order: "sequential",
			timeToConvert: 72,
			weight: 2,
		},
	],

	// ── SuperProps ──────────────────────────────────────────
	superProps: {
		Platform: ["ios", "ios", "android"],
		workout_type: ["strength", "cardio", "yoga", "hiit", "running", "cycling"],
		subscription_tier: ["free"],
	},

	// ── UserProps ──────────────────────────────────────────
	userProps: {
		fitness_level: ["beginner"],
		segment: ["casual"],
		streak_days: [0],
		total_workouts: u.weighNumRange(0, 0, 0.5),
		preferred_workout: ["strength", "cardio", "yoga", "hiit", "running", "cycling"],
		goal: ["weight_loss", "muscle_gain", "endurance", "flexibility", "general_health"],
		Platform: ["ios", "ios", "android"],
		workout_type: ["strength", "cardio", "yoga", "hiit", "running", "cycling"],
		subscription_tier: ["free"],
	},

	// ── Personas ──────────────────────────────────
	personas: [
		{
			name: "athlete",
			weight: 10,
			eventMultiplier: 4.0,
			conversionModifier: 1.5,
			properties: {
				fitness_level: "advanced",
				segment: "athlete",
			},
		},
		{
			name: "casual_exerciser",
			weight: 40,
			eventMultiplier: 1.0,
			conversionModifier: 0.8,
			properties: {
				fitness_level: "intermediate",
				segment: "casual",
			},
		},
		{
			name: "new_year_resolver",
			weight: 25,
			eventMultiplier: 0.6,
			conversionModifier: 0.5,
			// churn/activeWindow persona fields are deprecated no-ops in the
			// engine — the resolver cliff is engineered entirely by hook H5
			properties: {
				fitness_level: "beginner",
				segment: "resolver",
			},
		},
		{
			name: "social_motivator",
			weight: 15,
			eventMultiplier: 2.0,
			conversionModifier: 1.2,
			properties: {
				fitness_level: "intermediate",
				segment: "social",
			},
		},
		{
			name: "coach",
			weight: 10,
			eventMultiplier: 3.0,
			conversionModifier: 1.5,
			properties: {
				fitness_level: "expert",
				segment: "coach",
			},
		},
	],

	// ── Engagement Decay ──────────────────────────
	engagementDecay: {
		model: "step",
		halfLife: 30,
		floor: 0.1,
		reactivationChance: 0.02,
	},

	hook(record, type, meta) {
		if (type === "user") return handleUserHooks(record);
		if (type === "funnel-post") return handleFunnelPostHooks(record, meta);
		if (type === "everything") return handleEverythingHooks(record, meta);
		return record;
	},
};

// ── STORIES ──────────────────────────────────────────────────────────────
// Machine-checkable contract for the 10 numbered hooks. Evaluate with:
//   node scripts/verify-stories.mjs dungeons/vertical/fitness/fitness.js --data-prefix verify-fitness

const EV = `read_json_auto('{{PREFIX}}-EVENTS*.json', sample_size=-1, union_by_name=true)`;
const US = `read_json_auto('{{PREFIX}}-USERS*.json', sample_size=-1, union_by_name=true)`;

// Identity prelude. account created is both isAuthEvent and isFirstEvent, so
// born users auth on their very first event and user_id should be present on
// every record; the prelude still resolves through the device pool
// (avgDevicePerUser: 3, "anonymousIds" is the legacy USERS-shard key) as
// belt-and-braces for any device-only edge.
const ID_CTE = `dmap AS (SELECT unnest("anonymousIds") AS device_id, distinct_id FROM ${US}),
ev AS (SELECT coalesce(m.distinct_id::VARCHAR, e.user_id::VARCHAR, e.device_id::VARCHAR) AS uid,
  e.time::TIMESTAMP AS t, e.* FROM ${EV} e LEFT JOIN dmap m ON e.device_id = m.device_id)`;

// Temporal boundaries computed from the same knobs the hook uses (the hook
// anchors day offsets in UTC, so these UTC timestamps are exact cutoffs)
const AI_LAUNCH_TS = dayjs.utc(DATASET_START).add(AI_LAUNCH_DAY, "day").format("YYYY-MM-DD HH:mm:ss");
const D14_TS = dayjs.utc(DATASET_START).add(RESOLVER_CLIFF_DAYS, "day").format("YYYY-MM-DD HH:mm:ss");
const D30_TS = dayjs.utc(DATASET_START).add(WORKOUT_OVER_CUTOFF_DAYS, "day").format("YYYY-MM-DD HH:mm:ss");
// birth-pin cutoff for H5's double-difference: users whose first event lands in
// the window's first two days (mostly pre-existing users; birth ⊥ persona)
const D2_TS = dayjs.utc(DATASET_START).add(2, "day").format("YYYY-MM-DD HH:mm:ss");

// Per-user workout counts. H3/H4/H10 classify on counts taken after H8's
// progress-checked drop and H5's resolver thinning; for NON-resolver users no
// later hook deletes "workout completed" (H10's over-drop preserves it), so
// output-side counts rebuild those hook cohorts exactly. Resolver users can
// lose workouts to H5 AFTER H3 classified them — resolver-sensitive stories
// exclude that segment.
const WORKOUT_CTE = `wc AS (SELECT uid, count(*) AS w FROM ev WHERE event = 'workout completed' GROUP BY 1)`;

/** @type {import("../../../types").DungeonStory[]} */
export const stories = [
	{
		id: "H1-morning-calorie-boost",
		hook: "H1",
		archetype: "temporal-inflection",
		narrative: `workouts between ${MORNING_HOUR_START}:00 and ${MORNING_HOUR_END}:00 UTC carry calories_burned × ${MORNING_CALORIE_MULT}. calories_burned is an iid per-event draw independent of the event's hour, and no other hook touches it (H2/H10 scale duration_minutes), so both the avg and the median morning/other ratios read the ${MORNING_CALORIE_MULT} knob directly (Math.floor bias < 1%). TimeSoup's hour-of-day volume shape cancels: it moves event COUNTS across bins, not the property distribution within a bin`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT CASE WHEN extract(hour FROM t) >= ${MORNING_HOUR_START} AND extract(hour FROM t) < ${MORNING_HOUR_END} THEN 'morning' ELSE 'other' END AS grp,
 count(*) AS event_count, count(DISTINCT uid) AS user_count,
 avg(calories_burned) AS avg_cal, median(calories_burned) AS med_cal
FROM ev WHERE event = 'workout completed' GROUP BY 1`,
				},
				select: { m: { where: { grp: "morning" } }, o: { where: { grp: "other" } } },
				expect: { metric: "m.avg_cal / o.avg_cal", op: "between", target: [1.22, 1.38] },
				minCohort: 400,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT CASE WHEN extract(hour FROM t) >= ${MORNING_HOUR_START} AND extract(hour FROM t) < ${MORNING_HOUR_END} THEN 'morning' ELSE 'other' END AS grp,
 count(*) AS event_count, count(DISTINCT uid) AS user_count,
 avg(calories_burned) AS avg_cal, median(calories_burned) AS med_cal
FROM ev WHERE event = 'workout completed' GROUP BY 1`,
				},
				select: { m: { where: { grp: "morning" } }, o: { where: { grp: "other" } } },
				// scaling a whole bin scales every quantile: median ratio = knob too
				expect: { metric: "m.med_cal / o.med_cal", op: "between", target: [1.2, 1.4] },
				minCohort: 400,
			},
		],
	},
	{
		id: "H2-ai-coaching-lift",
		hook: "H2",
		archetype: "temporal-inflection",
		narrative: `after day ${AI_LAUNCH_DAY}, each workout (planned or completed) flips to coaching_mode='ai_assisted' at ${AI_ADOPTION_LIKELIHOOD}% (per-event Bernoulli — the post-launch ai share reads the knob), and ai_assisted workouts get duration × ${AI_DURATION_MULT}. Purity is exact: the declared coaching_mode pool is the single value 'self_guided' and the hook only stamps strictly after the launch instant, so ANY pre-launch ai_assisted row is a hook bug. H10's sweet-spot ×${WORKOUT_DURATION_BOOST} boost is mode-blind (applies to all of a sweet user's workouts), so it cancels in the ai/self avg ratio in expectation`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT count(*) FILTER (WHERE coaching_mode = 'ai_assisted' AND t <= TIMESTAMP '${AI_LAUNCH_TS}') AS pre_launch_ai,
 count(*) FILTER (WHERE coaching_mode = 'ai_assisted') AS ai_total,
 count(DISTINCT uid) AS user_count
FROM ev WHERE event IN ('workout completed', 'workout planned')`,
				},
				assert: (rows) => {
					const r = (rows || [])[0];
					if (!r || Number(r.ai_total) === 0) return { pass: false, verdict: "NONE", detail: "no ai_assisted workouts at all" };
					const clean = Number(r.pre_launch_ai) === 0;
					return {
						pass: clean,
						verdict: clean ? "NAILED" : "INVERSE",
						detail: `pre-launch ai_assisted rows=${r.pre_launch_ai} of ${r.ai_total} total (must be 0)`,
					};
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT coaching_mode AS grp, count(*) AS event_count, count(DISTINCT uid) AS user_count, avg(duration_minutes) AS avg_dur
FROM ev WHERE event = 'workout completed' AND t > TIMESTAMP '${AI_LAUNCH_TS}' GROUP BY 1`,
				},
				select: { a: { where: { grp: "ai_assisted" } }, s: { where: { grp: "self_guided" } } },
				expect: { metric: "a.avg_dur / s.avg_dur", op: "between", target: [1.1, 1.32] },
				minCohort: 300,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'post' AS grp, count(*) AS event_count, count(DISTINCT uid) AS user_count,
 count(*) FILTER (WHERE coaching_mode = 'ai_assisted')::DOUBLE / count(*) AS ai_share
FROM ev WHERE event = 'workout completed' AND t > TIMESTAMP '${AI_LAUNCH_TS}'`,
				},
				select: { p: { where: { grp: "post" } } },
				// per-event Bernoulli at 40% over tens of thousands of draws
				expect: { metric: "p.ai_share", op: "between", target: [0.35, 0.45] },
				minCohort: 300,
			},
		],
	},
	{
		id: "H3-streak-achievements",
		hook: "H3",
		archetype: "cohort-count-scale",
		narrative: `users with ≥${STREAK_MIN_WORKOUTS} workouts get profile streak_days OVERWRITTEN to their exact workout count (the everything hook mutates meta.profile before storage pushes it), plus C(w) = min(w−1, ${STREAK_LINEAR_CAP}) + ${STREAK_SUPER_LINEAR_MULT}·max(w−4, 0) cloned achievements (template = the user's first organic achievement — no organic achievement, no clones). The streak_days contract for non-resolvers is ONE-SIDED EXACT: after H3 runs, nothing ever ADDS a workout, so output w ≤ hook-time w = streak_days — a single sd < w row (or an unreachable sd = 1 on a non-coach) is a hook bug. Full equality is NOT exact: the future-time guard runs after the everything hook and silently deletes events past datasetEnd (engine end-of-window funnel spillover is filtered at storage by design, and H9's free-tier 1.25× stretch pushes borderline steps out), so ~0.5% of users lose a counted workout post-classification — equality share floor 0.99 (measured 0.6% violators at iter scale, all sd = w+1, all free-tier). The structural check total_ach − C(w) ≥ 1 holds for every non-resolver user with 2 ≤ w ≤ 14 and ≥1 achievement (w ≤ 14 excludes H10's over-drop, which deletes achievements): organic ≥ 1 forced the template, clones are exactly C(w), and only the same future-guard (clone lands past datasetEnd, or its source workout was guard-dropped) can break it — hence the 99.5% floor. The median of total_ach − C(w) sandwiches from above: it recovers the ORGANIC achievement count (weight 2 of 68 ≈ 3% of a user's events → median ∈ [1, 6]); a drifted clone formula would push it negative or huge`,
		assertions: [
			{
				// one-sided purity — deletions-only pipeline makes sd < w
				// impossible; sd = 1 is unreachable (H3 assigns ≥2, default 0,
				// H7 coaches 60-365)
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${WORKOUT_CTE},
j AS (SELECT u.distinct_id::VARCHAR AS uid, u.segment AS seg, u.streak_days AS sd, coalesce(w.w, 0) AS w
  FROM ${US} u LEFT JOIN wc w ON w.uid = u.distinct_id::VARCHAR
  WHERE u.segment <> 'resolver')
SELECT count(*) FILTER (WHERE w >= ${STREAK_MIN_WORKOUTS} AND sd < w) AS below_w,
 count(*) FILTER (WHERE seg <> 'coach' AND sd = 1) AS unreachable_one,
 count(*) FILTER (WHERE w >= ${STREAK_MIN_WORKOUTS}) AS streak_users, count(*) AS user_count
FROM j`,
				},
				assert: (rows) => {
					const r = (rows || [])[0];
					if (!r || Number(r.streak_users) === 0) return { pass: false, verdict: "NONE", detail: "no ≥2-workout users" };
					const bad = Number(r.below_w) + Number(r.unreachable_one);
					return {
						pass: bad === 0,
						verdict: bad === 0 ? "NAILED" : "INVERSE",
						detail: `streak_days < workout-count rows: ${r.below_w}; unreachable sd=1 rows: ${r.unreachable_one} (both must be 0; ${r.streak_users} streak users of ${r.user_count} non-resolvers)`,
					};
				},
			},
			{
				// equality share — bounded below by the silent future-guard
				// drop rate (post-hook deletions of counted workouts)
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${WORKOUT_CTE},
j AS (SELECT u.distinct_id::VARCHAR AS uid, u.streak_days AS sd, coalesce(w.w, 0) AS w
  FROM ${US} u LEFT JOIN wc w ON w.uid = u.distinct_id::VARCHAR
  WHERE u.segment <> 'resolver')
SELECT 'all' AS grp, count(*) AS user_count,
 count(*) FILTER (WHERE sd = w)::DOUBLE / count(*) AS eq_share
FROM j WHERE w >= ${STREAK_MIN_WORKOUTS}`,
				},
				select: { all: { where: { grp: "all" } } },
				expect: { metric: "all.eq_share", op: "between", target: [0.99, 1.0] },
				minCohort: 200,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${WORKOUT_CTE},
ac AS (SELECT uid, count(*) AS a FROM ev WHERE event = 'achievement unlocked' GROUP BY 1),
j AS (SELECT u.distinct_id::VARCHAR AS uid, coalesce(w.w, 0) AS w, coalesce(a.a, 0) AS a
  FROM ${US} u LEFT JOIN wc w ON w.uid = u.distinct_id::VARCHAR LEFT JOIN ac a ON a.uid = u.distinct_id::VARCHAR
  WHERE u.segment <> 'resolver'),
coh AS (SELECT *, LEAST(w - 1, ${STREAK_LINEAR_CAP}) + GREATEST(w - 4, 0) * ${STREAK_SUPER_LINEAR_MULT} AS clones
  FROM j WHERE w BETWEEN ${STREAK_MIN_WORKOUTS} AND ${WORKOUT_OVER_THRESHOLD - 1} AND a >= 1)
SELECT 'all' AS grp, count(*) AS user_count,
 count(*) FILTER (WHERE a - clones >= 1)::DOUBLE / count(*) AS ok_share,
 median(a - clones) AS med_organic
FROM coh`,
				},
				select: { all: { where: { grp: "all" } } },
				expect: { metric: "all.ok_share", op: "between", target: [0.995, 1.0] },
				minCohort: 200,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${WORKOUT_CTE},
ac AS (SELECT uid, count(*) AS a FROM ev WHERE event = 'achievement unlocked' GROUP BY 1),
j AS (SELECT u.distinct_id::VARCHAR AS uid, coalesce(w.w, 0) AS w, coalesce(a.a, 0) AS a
  FROM ${US} u LEFT JOIN wc w ON w.uid = u.distinct_id::VARCHAR LEFT JOIN ac a ON a.uid = u.distinct_id::VARCHAR
  WHERE u.segment <> 'resolver'),
coh AS (SELECT *, LEAST(w - 1, ${STREAK_LINEAR_CAP}) + GREATEST(w - 4, 0) * ${STREAK_SUPER_LINEAR_MULT} AS clones
  FROM j WHERE w BETWEEN ${STREAK_MIN_WORKOUTS} AND ${WORKOUT_OVER_THRESHOLD - 1} AND a >= 1)
SELECT 'all' AS grp, count(*) AS user_count, median(a - clones) AS med_organic
FROM coh`,
				},
				select: { all: { where: { grp: "all" } } },
				// implied organic achievements — clone over-injection would blow this up
				expect: { metric: "all.med_organic", op: "between", target: [1, 6] },
				minCohort: 200,
			},
		],
	},
	{
		id: "H4-social-challenge-completion",
		hook: "H4",
		archetype: "cohort-count-scale",
		narrative: `users with ≥${SOCIAL_FRIEND_THRESHOLD} friend-added events get max(1, floor(cc × ${SOCIAL_CHALLENGE_CLONE_FACTOR})) cloned challenge completions (cc = organic count; no organic completion → no template → no clones). The output total is then out = cc + max(1, floor(cc/2)), whose image skips exactly {5, 8, 11, …} = {n ≥ 5 : n ≡ 2 (mod 3)} — a count FINGERPRINT: for the clean cohort (non-resolver, ≤14 workouts so H10's over-drop never fires, output friends ≥ ${SOCIAL_FRIEND_THRESHOLD}, ≥2 completions) no later hook deletes challenge events, so landing in a gap is impossible except via the future-time guard (clone lands ≤48h past datasetEnd), bounded ≲2% of the cohort. The companion gradient (friend-heavy vs friend-light challenge counts WITHIN the social segment) is a composite: the ≥1.5× clone lift compounds with organic activity correlation (more friends ⇒ more events ⇒ more completions), so its band is wide and bounded away from 1 rather than pinned`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${WORKOUT_CTE},
fr AS (SELECT uid, count(*) AS f FROM ev WHERE event = 'friend added' GROUP BY 1),
ch AS (SELECT uid, count(*) AS c FROM ev WHERE event = 'challenge completed' GROUP BY 1),
j AS (SELECT u.distinct_id::VARCHAR AS uid, coalesce(w.w, 0) AS w, coalesce(f.f, 0) AS f, coalesce(c.c, 0) AS c
  FROM ${US} u LEFT JOIN wc w ON w.uid = u.distinct_id::VARCHAR
  LEFT JOIN fr f ON f.uid = u.distinct_id::VARCHAR LEFT JOIN ch c ON c.uid = u.distinct_id::VARCHAR
  WHERE u.segment <> 'resolver'),
coh AS (SELECT * FROM j WHERE w <= ${WORKOUT_OVER_THRESHOLD - 1} AND f >= ${SOCIAL_FRIEND_THRESHOLD} AND c >= 2)
SELECT 'all' AS grp, count(*) AS user_count,
 count(*) FILTER (WHERE c >= 5 AND c % 3 = 2) AS gap_hits
FROM coh`,
				},
				assert: (rows) => {
					const r = (rows || [])[0];
					const n = Number(r?.user_count || 0);
					if (n < 50) return { pass: false, verdict: "NONE", detail: `clean cohort too small (${n})` };
					const share = Number(r.gap_hits) / n;
					const pass = share <= 0.02;
					return {
						pass,
						verdict: pass ? (share <= 0.005 ? "NAILED" : "STRONG") : "INVERSE",
						detail: `unreachable challenge totals (n≥5, n≡2 mod 3): ${r.gap_hits} of ${n} clean-cohort users (${(share * 100).toFixed(2)}% — future-guard bound ~2%)`,
					};
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
fr AS (SELECT uid, count(*) AS f FROM ev WHERE event = 'friend added' GROUP BY 1),
ch AS (SELECT uid, count(*) AS c FROM ev WHERE event = 'challenge completed' GROUP BY 1),
j AS (SELECT u.distinct_id::VARCHAR AS uid, coalesce(f.f, 0) AS f, coalesce(c.c, 0) AS c
  FROM ${US} u LEFT JOIN fr f ON f.uid = u.distinct_id::VARCHAR LEFT JOIN ch c ON c.uid = u.distinct_id::VARCHAR
  WHERE u.segment = 'social')
SELECT CASE WHEN f >= ${SOCIAL_FRIEND_THRESHOLD} THEN 'hi' ELSE 'lo' END AS grp,
 count(*) AS user_count, avg(c) AS avg_cc
FROM j WHERE f >= ${SOCIAL_FRIEND_THRESHOLD} OR f <= 1 GROUP BY 1`,
				},
				select: { h: { where: { grp: "hi" } }, l: { where: { grp: "lo" } } },
				expect: { metric: "h.avg_cc / l.avg_cc", op: "between", target: [1.35, 4.5] },
				minCohort: 100,
			},
		],
	},
	{
		id: "H5-resolver-churn-cliff",
		hook: "H5",
		archetype: "cohort-count-scale",
		narrative: `resolver-segment users with <${RESOLVER_EVENT_THRESHOLD} events (at hook time) lose ${RESOLVER_DROP_LIKELIHOOD}% of post-day-${RESOLVER_CLIFF_DAYS} events. The cliff is engineered ENTIRELY by this hook — the persona's churnRate/activeWindow fields are deprecated engine no-ops (the engine warns so at generation), so the estimator targets the ${(100 - RESOLVER_DROP_LIKELIHOOD) / 100} keep-rate directly. Deletions-only pipeline makes the treated cohort output-identifiable: eligible ⟺ output events < ${RESOLVER_EVENT_THRESHOLD} (treated users only shrink below the threshold they were already under; untreated resolvers keep their ≥${RESOLVER_EVENT_THRESHOLD} count). Two composition traps force the double-difference design: (1) birth time dominates raw post/pre mass, so both cells pin birth to the window's first two days (first event < day 2 — mostly pre-existing users, and birth ⊥ persona); (2) splitting on total volume tilts post/pre by itself (low-n users' realized timing differs — measured 1.22 inside casual where NO hook fires), so the resolver lo/hi contrast is normalized by the identical lo/hi split inside casual, which measures pure selection. DD = (ρ_res_lo/ρ_res_hi) ÷ (ρ_cas_lo/ρ_cas_hi) then reads the keep-rate: iter-scale measured 0.314 vs knob 0.30. The placebo asserts the casual split itself sits near 1 — nowhere near the 0.3 keep-rate — or the normalizer would be absorbing treatment`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
tot AS (SELECT uid, count(*) AS n, min(t) AS first_t,
  count(*) FILTER (WHERE t < TIMESTAMP '${D14_TS}') AS pre,
  count(*) FILTER (WHERE t >= TIMESTAMP '${D14_TS}') AS post
  FROM ev GROUP BY 1),
j AS (SELECT u.segment AS seg, CASE WHEN t.n < ${RESOLVER_EVENT_THRESHOLD} THEN 'lo' ELSE 'hi' END AS arm, t.pre, t.post
  FROM ${US} u JOIN tot t ON t.uid = u.distinct_id::VARCHAR
  WHERE t.first_t < TIMESTAMP '${D2_TS}' AND u.segment IN ('resolver', 'casual')),
g AS (SELECT seg, arm, count(*)::BIGINT AS user_count, sum(post)::DOUBLE / nullif(sum(pre), 0) AS rho FROM j GROUP BY 1, 2)
SELECT seg || '_' || arm AS grp, user_count, rho FROM g`,
				},
				// DD is a 4-cell statistic (two ops) — parseMetric caps at one, so
				// the ratio-of-ratios is computed in a custom assert. Band [0.2,
				// 0.42]: knob 0.30 + headroom for the second-order multiplier-depth
				// mismatch (0.6× res vs 1.0× cas at the same n=30 cut); STRONG
				// buffer [0.15, 0.5] absorbs smallest-cell sampling noise
				// (resolver_hi ≈ 30 at 1500 users, ≈ 200 at 10K).
				assert: (rows) => {
					const cell = (g) => (rows || []).find((r) => r.grp === g);
					const rl = cell("resolver_lo"), rh = cell("resolver_hi"), cl = cell("casual_lo"), ch = cell("casual_hi");
					const cells = { rl, rh, cl, ch };
					for (const [k, c] of Object.entries(cells)) {
						if (!c || Number(c.user_count) < 15 || !Number(c.rho)) {
							return { pass: false, verdict: "NONE", detail: `cell ${k} missing or too small (${c ? c.user_count : 0} users)` };
						}
					}
					const dd = (Number(rl.rho) / Number(rh.rho)) / (Number(cl.rho) / Number(ch.rho));
					const inBand = dd >= 0.2 && dd <= 0.42;
					const inBuffer = dd >= 0.15 && dd <= 0.5;
					return {
						pass: inBuffer,
						verdict: inBand ? "NAILED" : inBuffer ? "STRONG" : "INVERSE",
						detail: `DD = (${Number(rl.rho).toFixed(4)}/${Number(rh.rho).toFixed(4)}) ÷ (${Number(cl.rho).toFixed(4)}/${Number(ch.rho).toFixed(4)}) = ${dd.toFixed(4)} (keep-rate knob 0.30, band [0.2, 0.42]; cells rl=${rl.user_count} rh=${rh.user_count} cl=${cl.user_count} ch=${ch.user_count})`,
					};
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
tot AS (SELECT uid, count(*) AS n, min(t) AS first_t,
  count(*) FILTER (WHERE t < TIMESTAMP '${D14_TS}') AS pre,
  count(*) FILTER (WHERE t >= TIMESTAMP '${D14_TS}') AS post
  FROM ev GROUP BY 1),
j AS (SELECT CASE WHEN t.n < ${RESOLVER_EVENT_THRESHOLD} THEN 'lo' ELSE 'hi' END AS arm, t.pre, t.post
  FROM ${US} u JOIN tot t ON t.uid = u.distinct_id::VARCHAR
  WHERE t.first_t < TIMESTAMP '${D2_TS}' AND u.segment = 'casual')
SELECT arm AS grp, count(*)::BIGINT AS user_count, sum(post)::DOUBLE / nullif(sum(pre), 0) AS rho
FROM j GROUP BY 1`,
				},
				select: { l: { where: { grp: "lo" } }, h: { where: { grp: "hi" } } },
				// placebo: no hook fires on casual — volume split alone must stay
				// near 1 (measured 1.22 at iter scale), far from the 0.3 keep-rate
				expect: { metric: "l.rho / h.rho", op: "between", target: [0.7, 1.8] },
				minCohort: 150,
			},
		],
	},
	{
		id: "H6-coach-session-quality",
		hook: "H6",
		archetype: "cohort-prop-scale",
		narrative: `every coach-session event gets satisfaction_score redrawn uniform [${COACH_SESSION_SATISFACTION_MIN}, ${COACH_SESSION_SATISFACTION_MAX}] (fixed to 1 decimal — avg AND median 4.5, both quantile reads of the uniform). The redraw is unconditional on all coach sessions, so purity is exact: a single sub-${COACH_SESSION_SATISFACTION_MIN} score is a hook bug. No ratio-vs-baseline assertion: the declared weighNumRange(1, 5, 0.6, 3) baseline is a 3-value seeded pool (the 4th arg is POOL SIZE, not mode), so the organic mean is not derivable from the schema`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT count(*) FILTER (WHERE satisfaction_score < ${COACH_SESSION_SATISFACTION_MIN}) AS below_min,
 count(*) AS scores, count(DISTINCT uid) AS user_count
FROM ev WHERE event = 'coach session'`,
				},
				assert: (rows) => {
					const r = (rows || [])[0];
					if (!r || Number(r.scores) === 0) return { pass: false, verdict: "NONE", detail: "no coach sessions" };
					const clean = Number(r.below_min) === 0;
					return {
						pass: clean,
						verdict: clean ? "NAILED" : "INVERSE",
						detail: `below-${COACH_SESSION_SATISFACTION_MIN} scores=${r.below_min} of ${r.scores} coach sessions (must be 0)`,
					};
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(*) AS event_count, count(DISTINCT uid) AS user_count,
 avg(satisfaction_score) AS avg_sat, median(satisfaction_score) AS med_sat
FROM ev WHERE event = 'coach session'`,
				},
				select: { x: { where: { grp: "all" } } },
				expect: { metric: "x.avg_sat", op: "between", target: [4.4, 4.6] },
				minCohort: 200,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(*) AS event_count, count(DISTINCT uid) AS user_count,
 avg(satisfaction_score) AS avg_sat, median(satisfaction_score) AS med_sat
FROM ev WHERE event = 'coach session'`,
				},
				select: { x: { where: { grp: "all" } } },
				expect: { metric: "x.med_sat", op: "between", target: [4.4, 4.6] },
				minCohort: 200,
			},
		],
	},
	{
		id: "H7-coach-profile-enrichment",
		hook: "H7",
		archetype: "cohort-prop-scale",
		narrative: `user hook: coach-segment users get total_workouts uniform [${COACH_TOTAL_WORKOUTS_MIN}, ${COACH_TOTAL_WORKOUTS_MAX}] (avg 350); every other segment keeps the declared default 0. Deterministic ranges — violations are hook bugs, not noise. (The hook also seeds streak_days 60-365, but H3 overwrites streak_days for ≥2-workout users, so total_workouts is the durable signature — see the H3 story for the streak_days contract)`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT CASE WHEN segment = 'coach' THEN 'coach' ELSE 'other' END AS grp,
 count(*) AS user_count, min(total_workouts) AS min_tw, max(total_workouts) AS max_tw, avg(total_workouts) AS avg_tw
FROM ${US} GROUP BY 1`,
				},
				assert: (rows) => {
					const by = Object.fromEntries((rows || []).map(r => [r.grp, r]));
					const c = by.coach, o = by.other;
					if (!c || !o) return { pass: false, verdict: "NONE", detail: `missing segment rows (${(rows || []).map(r => r.grp).join(",")})` };
					const bad = [];
					if (Number(c.min_tw) < COACH_TOTAL_WORKOUTS_MIN || Number(c.max_tw) > COACH_TOTAL_WORKOUTS_MAX) bad.push(`coach total_workouts [${c.min_tw}, ${c.max_tw}] outside [${COACH_TOTAL_WORKOUTS_MIN}, ${COACH_TOTAL_WORKOUTS_MAX}]`);
					if (Number(o.min_tw) !== 0 || Number(o.max_tw) !== 0) bad.push(`non-coach total_workouts [${o.min_tw}, ${o.max_tw}] not pinned to 0`);
					return {
						pass: bad.length === 0,
						verdict: bad.length === 0 ? "NAILED" : "INVERSE",
						detail: bad.length ? bad.join("; ") : `ranges exact: coach [${c.min_tw}, ${c.max_tw}], non-coach pinned 0 (${c.user_count}/${o.user_count} users)`,
					};
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT CASE WHEN segment = 'coach' THEN 'coach' ELSE 'other' END AS grp,
 count(*) AS user_count, avg(total_workouts) AS avg_tw
FROM ${US} GROUP BY 1`,
				},
				select: { c: { where: { grp: "coach" } } },
				// uniform [200, 500] → 350
				expect: { metric: "c.avg_tw", op: "between", target: [330, 370] },
				minCohort: 400,
			},
		],
	},
	{
		id: "H8-annual-follow-through",
		hook: "H8",
		archetype: "funnel-conversion-by-segment",
		narrative: `free/monthly users have a ${ANNUAL_FUNNEL_FREE_DROP_LIKELIHOOD}% chance to lose ALL progress-checked events (per-user cliff; annual/family untouched). Tier is assigned BY segment in the user hook, and personas' eventMultiplier/conversionModifier drive volume — so any raw cross-tier comparison is confounded by composition BY CONSTRUCTION. Both estimators are SEGMENT-STANDARDIZED over the two segments that contain both an affected and a control tier (athlete: monthly vs annual+family; social: free+monthly vs annual). Within a segment, tier is an independent pickone draw, so the natural-zero baseline and volume distribution are tier-blind: (z_aff − z_ctl)/(1 − z_ctl) reads the 0.30 knob, and SURVIVING affected users' progress-checked counts must match controls (ratio ≈ 1.0 — per-user cliff, not per-event thinning; thinning would read ~0.7 in every segment). H10's over-drop preserves progress checked and H5 only touches resolvers, so no other hook moves this event for these segments. The doc's funnel-conversion read (annual 63% vs free 45%) is the analyst-facing composite of this cliff plus persona conversionModifier — deliberately not machine-asserted, since no knob-derived band exists for the composite`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
pc AS (SELECT uid, count(*) AS ct FROM ev WHERE event = 'progress checked' GROUP BY 1),
u AS (SELECT u.distinct_id::VARCHAR AS uid, u.segment AS seg, u.subscription_tier AS tier
  FROM ${US} u WHERE u.segment IN ('athlete', 'social')),
j AS (SELECT u.seg, CASE WHEN u.tier IN ('annual', 'family') THEN 'ctl' ELSE 'aff' END AS arm, coalesce(p.ct, 0) AS ct
  FROM u LEFT JOIN pc p ON p.uid = u.uid),
seg AS (SELECT seg,
  count(*) FILTER (WHERE arm = 'aff') AS n_aff, count(*) FILTER (WHERE arm = 'ctl') AS n_ctl,
  count(*) FILTER (WHERE arm = 'aff' AND ct = 0)::DOUBLE / nullif(count(*) FILTER (WHERE arm = 'aff'), 0) AS z_aff,
  count(*) FILTER (WHERE arm = 'ctl' AND ct = 0)::DOUBLE / nullif(count(*) FILTER (WHERE arm = 'ctl'), 0) AS z_ctl
  FROM j GROUP BY 1)
SELECT 'all' AS grp, sum(n_aff + n_ctl)::BIGINT AS user_count,
 sum(n_aff * (z_aff - z_ctl) / nullif(1 - z_ctl, 0)) / sum(n_aff) AS cliff_share
FROM seg WHERE n_ctl >= 25`,
				},
				select: { all: { where: { grp: "all" } } },
				expect: { metric: "all.cliff_share", op: "between", target: [0.22, 0.38] },
				minCohort: 500,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
pc AS (SELECT uid, count(*) AS ct FROM ev WHERE event = 'progress checked' GROUP BY 1),
surv AS (SELECT u.segment AS seg, CASE WHEN u.subscription_tier IN ('annual', 'family') THEN 'ctl' ELSE 'aff' END AS arm, p.ct
  FROM ${US} u JOIN pc p ON p.uid = u.distinct_id::VARCHAR
  WHERE u.segment IN ('athlete', 'social')),
g AS (SELECT seg,
  avg(ct) FILTER (WHERE arm = 'aff') AS aff_avg, count(*) FILTER (WHERE arm = 'aff') AS aff_n,
  avg(ct) FILTER (WHERE arm = 'ctl') AS ctl_avg, count(*) FILTER (WHERE arm = 'ctl') AS ctl_n
  FROM surv GROUP BY 1)
SELECT 'all' AS grp, sum(aff_n + ctl_n)::BIGINT AS user_count,
 sum(aff_n * aff_avg / ctl_avg) / sum(aff_n) AS std_ratio
FROM g WHERE ctl_n >= 25 AND aff_avg IS NOT NULL AND ctl_avg IS NOT NULL`,
				},
				select: { all: { where: { grp: "all" } } },
				// per-user cliff, not thinning: survivors untouched → ratio ≈ 1.0
				expect: { metric: "all.std_ratio", op: "between", target: [0.85, 1.15] },
				minCohort: 500,
			},
		],
	},
	{
		id: "H9-workout-loop-ttc",
		hook: "H9",
		archetype: "funnel-ttc-by-segment",
		narrative: `funnel-post scales every funnel instance's inter-step gaps by tier: annual/family × ${TTC_ANNUAL_FACTOR}, free × ${TTC_FREE_FACTOR}, monthly = 1.0 control. Measured on the Workout Loop through the Mixpanel-aligned emulator at a ${Math.round(48 * TTC_FREE_FACTOR)}h conversion window = the funnel's 48h generative window × the max stretch ${TTC_FREE_FACTOR} (the window must cover the stretched support or censoring dilutes the free tier — the ai-platform H9 lesson). Every instance of an affected user is scaled (the hook fires per funnel-post record), but the emulator's greedy matching can pair steps across neighboring instances of high-frequency events, diluting the measured ratio toward 1 — bands assume ≥25% of the effect survives on the slow side and cap attenuation at ~90% on the fast side`,
		assertions: [
			{
				breakdown: {
					type: "timeToConvert",
					steps: ["workout planned", "workout completed", "progress checked"],
					breakdownByUserProperty: "subscription_tier",
					// 60h = 48h generative window × 1.25 max stretch
					conversionWindowMs: Math.round(48 * TTC_FREE_FACTOR * 3600 * 1000),
				},
				select: { f: { where: { segment_value: "free" } }, m: { where: { segment_value: "monthly" } } },
				expect: { metric: "f.median_ttc_ms / m.median_ttc_ms", op: "between", target: [1.05, 1.35] },
				minCohort: 100,
			},
			{
				breakdown: {
					type: "timeToConvert",
					steps: ["workout planned", "workout completed", "progress checked"],
					breakdownByUserProperty: "subscription_tier",
					conversionWindowMs: Math.round(48 * TTC_FREE_FACTOR * 3600 * 1000),
				},
				select: { a: { where: { segment_value: "annual" } }, m: { where: { segment_value: "monthly" } } },
				expect: { metric: "a.median_ttc_ms / m.median_ttc_ms", op: "between", target: [0.7, 0.97] },
				minCohort: 100,
			},
		],
	},
	{
		id: "H10-workout-magic-number",
		hook: "H10",
		archetype: "frequency-sweet-spot",
		narrative: `sweet ${WORKOUT_SWEET_MIN}-${WORKOUT_SWEET_MAX} workouts → ALL the user's workout duration_minutes × ${WORKOUT_DURATION_BOOST}; over ${WORKOUT_OVER_THRESHOLD}+ → ${WORKOUT_OVER_DROP_LIKELIHOOD}% of post-day-${WORKOUT_OVER_CUTOFF_DAYS} non-workout non-progress events dropped. Cohort counts are output-exact for every user (H10 runs after H5's resolver thinning and preserves workouts itself). The duration read restricts to PRE-day-${AI_LAUNCH_DAY} workouts, where H2's ai_assisted ×${AI_DURATION_MULT} never fired — the AVG ratio reads the ${WORKOUT_DURATION_BOOST} knob exactly (whole-cohort scaling: E[kX]/E[X] = k for any pool). Median deliberately NOT used: duration_minutes draws from a discrete weighNumRange atom pool, so the scaled cohort's median snaps to an atom quotient, not the knob (iter-scale median read 1.476 while avg read 1.395). The over-drop read is a within-user-normalized double ratio: (over post-d30/pre-d30 non-preserved volume) ÷ (sweet same) = 0.35 × τ, where τ captures residual timing composition (over-users' longer lifetimes skew τ ≥ 1) — band [0.25, 0.6]`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${WORKOUT_CTE},
coh AS (SELECT uid, CASE WHEN w BETWEEN ${WORKOUT_SWEET_MIN} AND ${WORKOUT_SWEET_MAX} THEN 'sweet'
  WHEN w BETWEEN ${STREAK_MIN_WORKOUTS} AND ${WORKOUT_SWEET_MIN - 1} THEN 'low' END AS grp FROM wc)
SELECT c.grp, count(DISTINCT c.uid) AS user_count, count(*) AS event_count, avg(e.duration_minutes) AS avg_dur
FROM coh c JOIN ev e ON e.uid = c.uid AND e.event = 'workout completed' AND e.t <= TIMESTAMP '${AI_LAUNCH_TS}'
WHERE c.grp IS NOT NULL GROUP BY 1`,
				},
				select: { s: { where: { grp: "sweet" } }, l: { where: { grp: "low" } } },
				expect: { metric: "s.avg_dur / l.avg_dur", op: "between", target: [1.25, 1.45] },
				minCohort: 40,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${WORKOUT_CTE},
coh AS (SELECT uid, CASE WHEN w >= ${WORKOUT_OVER_THRESHOLD} THEN 'over'
  WHEN w BETWEEN ${WORKOUT_SWEET_MIN} AND ${WORKOUT_SWEET_MAX} THEN 'sweet' END AS grp FROM wc WHERE w >= ${WORKOUT_SWEET_MIN}),
per AS (SELECT c.grp, c.uid,
  count(*) FILTER (WHERE e.event NOT IN ('workout completed', 'progress checked') AND e.t < TIMESTAMP '${D30_TS}') AS pre,
  count(*) FILTER (WHERE e.event NOT IN ('workout completed', 'progress checked') AND e.t >= TIMESTAMP '${D30_TS}') AS post
  FROM coh c JOIN ev e ON e.uid = c.uid GROUP BY 1, 2)
SELECT grp, count(*) AS user_count, sum(post)::DOUBLE / nullif(sum(pre), 0) AS post_pre
FROM per GROUP BY 1`,
				},
				select: { o: { where: { grp: "over" } }, s: { where: { grp: "sweet" } } },
				expect: { metric: "o.post_pre / s.post_pre", op: "between", target: [0.25, 0.6] },
				minCohort: 40,
			},
		],
	},
];

export default config;
