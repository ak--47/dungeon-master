import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import "dotenv/config";
import * as u from "../../lib/utils/utils.js";

const SEED = "dm4-fitness";
dayjs.extend(utc);
const chance = u.initChance(SEED);
const num_users = 5_000;
const days = 100;
const NOW = dayjs();
const DATASET_START = NOW.subtract(days, "days");

/** @typedef  {import("../../types").Dungeon} Config */

/**
 * ═══════════════════════════════════════════════════════════════
 * DATASET OVERVIEW
 * ═══════════════════════════════════════════════════════════════
 *
 * FitQuest — a fitness & wellness app for workout tracking, meal
 * planning, social fitness challenges, and AI coaching.
 *
 * - 5,000 users over 100 days, ~600K events
 * - 5 personas: athlete (10%), casual_exerciser (40%),
 *   new_year_resolver (25%), social_motivator (15%), coach (10%)
 * - Core loop: sign up → plan workout → complete workout → track progress
 * - Revenue: free, monthly ($12.99, 7-day trial), annual ($99.99), family ($149.99)
 *
 * Advanced Features:
 * - Personas: 5 archetypes with distinct engagement and churn profiles
 * - Subscription: 4-tier revenue lifecycle with trial conversion
 * - Attribution: 5 campaign sources with persona biases
 * - Engagement Decay: step model with 30-day half-life
 * - Features: ai_coach (day 35) and group_challenges (day 55)
 *
 * Key entities:
 * - workout_type: strength/cardio/yoga/hiit/running/cycling
 * - fitness_level: beginner/intermediate/advanced/expert
 * - coaching_mode: self_guided vs ai_assisted (driven by Feature rollout)
 * - challenge_mode: solo vs group (driven by Feature rollout)
 */

/**
 * ═══════════════════════════════════════════════════════════════
 * ANALYTICS HOOKS (8 hooks)
 * ═══════════════════════════════════════════════════════════════
 *
 * ───────────────────────────────────────────────────────────────
 * 1. MORNING WORKOUT BOOST (event hook)
 * ───────────────────────────────────────────────────────────────
 *
 * PATTERN: Workouts completed between 5AM-9AM get 1.3x
 * calories_burned. Simulates the metabolic boost from fasted
 * morning exercise.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Morning vs Non-Morning Calorie Burn
 *   • Report type: Insights
 *   • Event: "workout completed"
 *   • Measure: Average of "calories_burned"
 *   • Breakdown: "is_morning_workout"
 *   • Expected: is_morning_workout=true should show ~1.3x avg
 *     calories vs false (true ≈ 390, false ≈ 300)
 *
 * REAL-WORLD ANALOGUE: Fitness apps promote morning workouts
 * as more effective for fat loss, driving engagement.
 *
 * ───────────────────────────────────────────────────────────────
 * 2. POST-LAUNCH AI COACHING LIFT (event hook)
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
 * PATTERN: Users with >10 workout events get streak_days set
 * to their actual workout count on their profile, and receive
 * cloned "achievement unlocked" events for milestone streaks.
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
 * 8. ANNUAL SUBSCRIBER WORKOUT FUNNEL LIFT (funnel-pre hook)
 * ───────────────────────────────────────────────────────────────
 *
 * PATTERN: Users with subscription_tier "annual" or "family"
 * get 1.4x conversion rate through the Workout Loop funnel.
 * Annual commitment correlates with follow-through.
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
 * ═══════════════════════════════════════════════════════════════
 * EXPECTED METRICS SUMMARY
 * ═══════════════════════════════════════════════════════════════
 *
 * Hook                        | Metric              | Baseline | Effect  | Ratio
 * ────────────────────────────|─────────────────────|──────────|─────────|──────
 * Morning Workout Boost       | calories_burned     | 300      | 390     | 1.3x
 * AI Coaching Lift            | duration_minutes    | 40       | 48      | 1.2x
 * Streak Retention            | achievements/user   | 1        | 2-3     | 2-3x
 * Social Challenge Completion | challenges/user     | 1        | 1.5     | 1.5x
 * Resolver Churn Cliff        | events after day 14 | 100%     | 30%     | 0.3x
 * Coach Session Quality       | satisfaction_score   | 3.0      | 4.3     | 1.4x
 * Coach Profile Enrichment    | total_workouts      | 0        | 350     | N/A
 * Annual Funnel Lift          | funnel conversion   | 45%      | 63%     | 1.4x
 */

/** @type {Config} */
const config = {
	token: "",
	seed: SEED,
	numDays: days,
	numEvents: num_users * 120,
	numUsers: num_users,
	hasAnonIds: false,
	hasSessionIds: true,
	format: "json",
	gzip: true,
	alsoInferFunnels: false,
	hasLocation: true,
	hasAndroidDevices: true,
	hasIOSDevices: true,
	hasDesktopDevices: false,
	hasBrowser: false,
	hasCampaigns: false,
	isAnonymous: false,
	hasAdSpend: false,
	percentUsersBornInDataset: 35,
	hasAvatar: true,
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
			properties: {
				referral_source: ["organic", "friend_invite", "app_store", "social_media", "search"],
			},
		},
		{
			event: "workout completed",
			weight: 8,
			properties: {
				duration_minutes: u.weighNumRange(10, 90, 0.5, 40),
				calories_burned: u.weighNumRange(50, 800, 0.4, 300),
				heart_rate_avg: u.weighNumRange(80, 185, 0.5, 130),
				is_morning_workout: [false],
				satisfaction_score: u.weighNumRange(1, 5, 0.7, 3),
				coaching_mode: ["self_guided"],
				challenge_mode: ["solo"],
			},
		},
		{
			event: "workout planned",
			weight: 6,
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
			properties: {
				achievement_type: ["streak_milestone", "weight_goal", "distance_record", "calories_target", "social_champion", "first_workout"],
				streak_days_at_unlock: u.weighNumRange(1, 100, 0.3, 10),
			},
		},
		{
			event: "friend added",
			weight: 2,
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
			properties: {
				metric_viewed: ["weight", "body_fat", "steps", "calories_burned", "workout_count", "streaks"],
				trend_direction: ["improving", "improving", "stable", "declining"],
				time_range: ["week", "month", "3_months", "year"],
			},
		},
		{
			event: "coach session",
			weight: 3,
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
		platform: ["ios", "ios", "android"],
		workout_type: ["strength", "cardio", "yoga", "hiit", "running", "cycling"],
	},

	// ── UserProps ──────────────────────────────────────────
	userProps: {
		fitness_level: ["beginner"],
		segment: ["casual"],
		streak_days: [0],
		total_workouts: u.weighNumRange(0, 0, 0.5),
		preferred_workout: ["strength", "cardio", "yoga", "hiit", "running", "cycling"],
		goal: ["weight_loss", "muscle_gain", "endurance", "flexibility", "general_health"],
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

	// ── Subscription ──────────────────────────────
	subscription: {
		plans: [
			{ name: "free", price: 0, default: true },
			{ name: "monthly", price: 12.99, trialDays: 7 },
			{ name: "annual", price: 99.99 },
			{ name: "family", price: 149.99 },
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

	// ── Attribution ──────────────────────────────
	attribution: {
		model: "last_touch",
		window: 7,
		campaigns: [
			{
				name: "app_store",
				source: "apple",
				medium: "app_store",
				activeDays: [0, 100],
				dailyBudget: [200, 600],
				acquisitionRate: 0.03,
				userPersonaBias: { athlete: 0.5, coach: 0.3 },
			},
			{
				name: "google_play",
				source: "google",
				medium: "app_store",
				activeDays: [0, 100],
				dailyBudget: [150, 500],
				acquisitionRate: 0.02,
			},
			{
				name: "instagram_ads",
				source: "instagram",
				medium: "social",
				activeDays: [5, 90],
				dailyBudget: [200, 800],
				acquisitionRate: 0.03,
				userPersonaBias: { new_year_resolver: 0.5, social_motivator: 0.3 },
			},
			{
				name: "referral_program",
				source: "referral",
				medium: "referral",
				activeDays: [0, 100],
				dailyBudget: [50, 200],
				acquisitionRate: 0.02,
				userPersonaBias: { social_motivator: 0.4 },
			},
		],
		organicRate: 0.30,
	},

	// ── Engagement Decay ──────────────────────────
	engagementDecay: {
		model: "step",
		halfLife: 30,
		floor: 0.1,
		reactivationChance: 0.02,
	},

	// ── Features ──────────────────────────────────
	features: [
		{
			name: "ai_coach",
			launchDay: 35,
			adoptionCurve: "fast",
			property: "coaching_mode",
			values: ["self_guided", "ai_assisted"],
			defaultBefore: "self_guided",
			affectsEvents: ["workout completed", "workout planned"],
		},
		{
			name: "group_challenges",
			launchDay: 55,
			adoptionCurve: { k: 0.1, midpoint: 25 },
			property: "challenge_mode",
			values: ["solo", "group"],
			defaultBefore: "solo",
			affectsEvents: ["challenge joined", "workout completed"],
		},
	],

	// ── Hook Function ──────────────────────────────────────
	hook: function (record, type, meta) {
		// ── HOOK 7: COACH PROFILE ENRICHMENT (user) ──────────
		// Coach segment gets boosted total_workouts and streak_days.
		if (type === "user") {
			if (record.segment === "coach") {
				record.total_workouts = chance.integer({ min: 200, max: 500 });
				record.streak_days = chance.integer({ min: 60, max: 365 });
			}
		}

		// ── HOOK 8: ANNUAL SUBSCRIBER WORKOUT FUNNEL LIFT (funnel-pre) ─
		// Annual and family subscribers convert 1.4x through workout loop.
		if (type === "funnel-pre") {
			if (meta && meta.profile) {
				const tier = meta.profile.subscription_tier;
				if (tier === "annual" || tier === "family") {
					record.conversionRate = Math.min(record.conversionRate * 1.4, 95);
				} else if (tier === "monthly") {
					record.conversionRate = Math.min(record.conversionRate * 1.15, 90);
				}
			}
		}

		// ── HOOK 1: MORNING WORKOUT BOOST (event) ────────────
		// Workouts between 5AM-9AM get 1.3x calories_burned.
		if (type === "event") {
			if (record.event === "workout completed") {
				const hour = dayjs(record.time).hour();
				if (hour >= 5 && hour < 9) {
					record.is_morning_workout = true;
					if (record.calories_burned) {
						record.calories_burned = Math.floor(record.calories_burned * 1.3);
					}
				}
			}

			// ── HOOK 2: POST-LAUNCH AI COACHING LIFT (event) ────
			// After day 35, ai_assisted workouts get 1.2x duration.
			if (record.event === "workout completed" || record.event === "workout planned") {
				const AI_LAUNCH = DATASET_START.add(35, "days");
				const eventTime = dayjs(record.time);
				if (eventTime.isAfter(AI_LAUNCH) && record.coaching_mode === "ai_assisted") {
					if (record.duration_minutes) {
						record.duration_minutes = Math.floor(record.duration_minutes * 1.2);
					}
					if (record.planned_duration_minutes) {
						record.planned_duration_minutes = Math.floor(record.planned_duration_minutes * 1.2);
					}
				}
			}
		}

		// ── EVERYTHING HOOKS ─────────────────────────────────
		if (type === "everything") {
			const events = record;
			if (!events.length) return record;

			// ── HOOK 3: STREAK RETENTION ─────────────────────
			// Users with >10 workouts get streak_days updated and
			// cloned achievement events for milestones.
			const workoutEvents = events.filter(e => e.event === "workout completed");
			if (workoutEvents.length > 10) {
				// Update profile streak_days via a profile update event
				if (meta && meta.profile) {
					meta.profile.streak_days = workoutEvents.length;
				}

				// Clone achievement events for streak milestones
				const templateAchievement = events.find(e => e.event === "achievement unlocked");
				if (templateAchievement) {
					const milestones = [10, 25, 50, 75, 100];
					milestones.forEach(m => {
						if (workoutEvents.length >= m) {
							const sourceEvent = workoutEvents[Math.min(m - 1, workoutEvents.length - 1)];
							events.push({
								...templateAchievement,
								time: dayjs(sourceEvent.time).add(chance.integer({ min: 1, max: 30 }), "minutes").toISOString(),
								user_id: sourceEvent.user_id,
								achievement_type: "streak_milestone",
								streak_days_at_unlock: m,
							});
						}
					});
				}
			}

			// ── HOOK 4: SOCIAL CHALLENGE COMPLETION ──────────
			// Users with friend_added events get 1.5x challenge completions.
			const hasFriends = events.some(e => e.event === "friend added");
			if (hasFriends) {
				const templateChallenge = events.find(e => e.event === "challenge completed");
				if (templateChallenge) {
					const challengeCompletions = events.filter(e => e.event === "challenge completed");
					const extraCount = Math.floor(challengeCompletions.length * 0.5);
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
			// Resolver segment users with <8 events lose 70% after day 14.
			if (meta && meta.profile && meta.profile.segment === "resolver" && events.length < 8) {
				const CHURN_CLIFF = DATASET_START.add(14, "days");
				for (let i = events.length - 1; i >= 0; i--) {
					const eventTime = dayjs(events[i].time);
					if (eventTime.isAfter(CHURN_CLIFF) && chance.bool({ likelihood: 70 })) {
						events.splice(i, 1);
					}
				}
			}

			// ── HOOK 6: COACH SESSION QUALITY ────────────────
			// Users with coach_session events get higher satisfaction.
			const hasCoachSessions = events.some(e => e.event === "coach session");
			if (hasCoachSessions) {
				events.forEach(e => {
					if (e.event === "coach session") {
						e.satisfaction_score = chance.floating({ min: 4.0, max: 5.0, fixed: 1 });
					}
				});
			}

			return record;
		}

		return record;
	},
};

export default config;
