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
 * to their actual workout count on their profile, and receive
 * achievement clones with super-linear scaling: 1 per workout
 * for workouts 2-4, then 4 per workout beyond that. This
 * amplifies the gap so athlete/casual ratio reaches 2x+.
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
 * PATTERN: Users with "friend added" events complete 1.5x more
 * "challenge completed" events (cloned from existing ones).
 * Social users are more accountable.
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
 * PATTERN: Users in the "resolver" segment with <8 events
 * lose 70% of their events after day 14. Simulates the classic
 * New Year's resolution drop-off.
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
 *   • Expected: ≈ 4.3 avg (vs baseline 3.0 for non-coached)
 *
 * REAL-WORLD ANALOGUE: Personal coaching sessions have higher
 * satisfaction scores because of personalized attention.
 *
 * ───────────────────────────────────────────────────────────────
 * 7. COACH PROFILE ENRICHMENT (user hook)
 * ───────────────────────────────────────────────────────────────
 *
 * PATTERN: Users in the "coach" segment get total_workouts
 * boosted to 200-500 and streak_days to 60-365. Coaches are
 * power users who lead by example.
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
 *   Report 2: Streak Distribution by Segment
 *   • Report type: Insights
 *   • Measure: Average of user property "streak_days"
 *   • Breakdown: user property "segment"
 *   • Expected: coach ≈ 200 vs others ≈ 0 (pre-hook default)
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
 * PATTERN: Annual + family subscribers complete the Workout Loop
 * funnel 1.3x faster (factor 0.77); Free users 1.25x slower (factor 1.25).
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Workout Loop Median Time-to-Convert by Subscription
 *   - Funnels > "workout planned" -> "workout completed" -> "progress checked"
 *   - Measure: Median time to convert
 *   - Breakdown: subscription_plan
 *   - Expected: annual ~ 0.77x; free ~ 1.25x
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
 * Hook                        | Metric              | Baseline | Effect    | Ratio
 * ----------------------------|---------------------|----------|-----------|------
 * Morning Workout Boost       | calories_burned 5-9 | 1x       | 1.3x      | 1.3x
 * AI Coaching Lift            | duration_minutes    | 1x       | 1.2x      | 1.2x
 * Streak Retention            | achievements/user   | 1x       | 2-3x      | 2-3x
 * Social Challenge Completion | challenges/user     | 1x       | 1.5x      | 1.5x
 * Resolver Churn Cliff        | events after day 14 | 1x       | 0.3x      | -70%
 * Coach Session Quality       | satisfaction_score  | 3.0      | 4.3       | 1.4x
 * Coach Profile Enrichment    | total_workouts      | 0        | 350       | n/a
 * Annual Funnel Lift          | funnel conversion   | 45%      | 63%       | 1.4x
 * Workout Loop T2C            | median min by tier  | 1x       | 0.77/1.25x| ~ 1.6x range
 * Workout Magic Number        | sweet duration_min  | 1x       | 1.35x     | 1.35x
 * Workout Magic Number        | over D30+ post/pre  | 1x       | 0.29x     | -71%
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
	const datasetStart = dayjs.unix(meta.datasetStart);
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
			churnRate: 0.02,
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
			churnRate: 0.08,
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
			churnRate: 0.4,
			properties: {
				fitness_level: "beginner",
				segment: "resolver",
			},
			activeWindow: { maxDays: 30 },
		},
		{
			name: "social_motivator",
			weight: 15,
			eventMultiplier: 2.0,
			conversionModifier: 1.2,
			churnRate: 0.05,
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
			churnRate: 0.01,
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

export default config;
