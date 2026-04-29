// ── TWEAK THESE ──
const SEED = "harness-education";
const num_days = 100;
const num_users = 5_000;
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

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * DATASET OVERVIEW — LearnPath eLearning Platform
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * An online learning platform modeled after Coursera, Khan Academy, and Udemy.
 * Supports self-paced and cohort-based learning with courses, quizzes,
 * assignments, and social study features.
 *
 * Scale: 5,000 users / 600K events / 100 days / 17 event types
 *
 * CORE LOOP:
 * Register → browse/enroll in courses → watch lectures → practice problems →
 * quizzes/assignments → certificate earned. Social layer (study groups,
 * discussions) drives retention. Subscription tiers (free/monthly/annual)
 * gate completion rates.
 *
 * FUNNELS:
 * - Onboarding: account registered → course enrolled → lecture started
 * - Learning loop: lecture started → lecture completed → practice problem solved
 * - Assessment: quiz started → quiz completed → assignment submitted
 * - Course completion: course enrolled → lecture completed → quiz completed → certificate earned
 * - Social learning: discussion posted → study group joined → resource downloaded
 * - Instructor interaction: assignment submitted → assignment graded → instructor feedback given
 * - Support/monetization: help requested → subscription purchased → course reviewed
 *
 * GROUPS: course_id (150 courses), group_id (300 study groups)
 * SUBSCRIPTIONS: free (~60%), monthly, annual
 * ACCOUNT TYPES: ~89% students, ~11% instructors (two-sided marketplace)
 */

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ANALYTICS HOOKS (9 hooks)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * NOTE: All cohort effects are HIDDEN — no flag stamping. Discoverable via
 * behavioral cohorts, raw-prop breakdowns, or funnel time-to-convert.
 *
 * 1. STUDENT VS INSTRUCTOR PROFILES (user)
 *
 * PATTERN: Instructor profiles get teaching attributes
 * (courses_created, teaching_experience_years, instructor_rating).
 * Students get learning attributes (learning_goal,
 * study_hours_per_week). Two-sided marketplace at ~89% students,
 * ~11% instructors.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Account Mix
 *   - Report type: Insights
 *   - Event: any event
 *   - Measure: Unique users
 *   - Breakdown: "account_type"
 *   - Expected: ~89% students, ~11% instructors
 *
 *   Report 2: Instructor-Driven Feedback
 *   - Report type: Insights
 *   - Event: "instructor feedback given"
 *   - Measure: Total per user (average)
 *   - Breakdown: "account_type"
 *   - Expected: instructors dominate feedback volume; students rarely emit
 *
 * REAL-WORLD ANALOGUE: Two-sided learning marketplaces have
 * fundamentally different role personas — teachers create supply,
 * learners consume it.
 *
 * ---------------------------------------------------------------
 * 2. DEADLINE CRAMMING (everything)
 *
 * PATTERN: Assignments submitted on Sun/Mon are rushed — 60% are late
 * (raw is_late prop set true at 60% likelihood) vs ~20% baseline. Quiz
 * scores on Sun/Mon drop by 25 points. No flag — discover via Day of Week
 * breakdown.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Late Submission Rate by Day of Week
 *   - Report type: Insights
 *   - Event: "assignment submitted"
 *   - Measure: count where is_late=true / total
 *   - Breakdown: Day of Week
 *   - Expected: Sun/Mon ~ 60% late vs other days ~ 20%
 *
 *   Report 2: Quiz Score by Day of Week
 *   - Report type: Insights
 *   - Event: "quiz completed"
 *   - Measure: Average of "score_percent"
 *   - Breakdown: Day of Week
 *   - Expected: Sun/Mon ~ 25, other days ~ 49 (-25 pts)
 *
 * REAL-WORLD ANALOGUE: Procrastination clusters submissions at the
 * deadline weekend and hammers performance.
 *
 * ---------------------------------------------------------------
 * 3. NOTES MAGIC NUMBER (everything, in-funnel)
 *
 * PATTERN: Sweet 5-8 lectures with notes_taken=true → +30% quiz
 * score_percent (cap 100) and 40% chance of bonus cloned certificate.
 * Over 9+ → 35% of certificate-earned events drop (over-noted but
 * stuck in study mode). No flag.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Quiz Score by Notes-Taken Bucket
 *   - Cohort A: users with 5-8 "lecture completed" where notes_taken=true
 *   - Cohort B: users with 0-4
 *   - Event: "quiz completed"
 *   - Measure: Average of "score_percent"
 *   - Expected: A ~ 1.3x B
 *
 *   Report 2: Certificates per User on Heavy Note-Takers
 *   - Cohort C: users with >= 9 notes-taken lectures
 *   - Cohort A: users with 5-8
 *   - Event: "certificate earned"
 *   - Measure: Total per user
 *   - Expected: C ~ 35% fewer certificates per user vs A
 *
 * REAL-WORLD ANALOGUE: Active note-taking lifts quiz performance, but
 * obsessive note-taking signals "stuck in study mode" without finishing.
 *
 * ---------------------------------------------------------------
 * 4. STUDY GROUP RETENTION (everything)
 *
 * PATTERN: Users who join a study group within 10 days get bonus
 * discussion events. Non-joiners with low quiz scores (<60) churn
 * hard at day 14 — all later events are removed.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: D14 Retention by Early Group Join Cohort
 *   - Cohort A: users who fired "study group joined" within first 10 days
 *   - Cohort B: users with no early study group joined
 *   - Compare D14 retention (any event past d14) per cohort
 *   - Expected: A ~ 90%+ vs B (with low quiz scores) ~ 30%
 *
 *   Report 2: Discussion Volume by Group Cohort
 *   - Cohort A vs B (as above)
 *   - Event: "discussion posted"
 *   - Measure: Total per user
 *   - Expected: A posts substantially more
 *
 * REAL-WORLD ANALOGUE: Social learning ties create accountability
 * and dramatically reduce drop-off in cohort-based courses.
 *
 * ---------------------------------------------------------------
 * 5. HINT DEPENDENCY (event)
 *
 * PATTERN: On "practice problem solved", hint_used=true gets difficulty
 * forced to "easy" 60% of the time. hint_used=false gets difficulty forced
 * to "hard" 40% of the time. No flag — discover via difficulty breakdown
 * filtered by hint_used.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Easy Problem Mix for Hint Users
 *   - Report type: Insights
 *   - Event: "practice problem solved"
 *   - Measure: Total
 *   - Filter: "hint_used" = true
 *   - Breakdown: "difficulty"
 *   - Expected: ~60% easy (vs ~33% baseline)
 *
 *   Report 2: Hard Problem Mix for Independent Solvers
 *   - Report type: Insights
 *   - Event: "practice problem solved"
 *   - Measure: Total
 *   - Filter: "hint_used" = false
 *   - Breakdown: "difficulty"
 *   - Expected: ~40% hard (vs ~33% baseline)
 *
 * REAL-WORLD ANALOGUE: Learners who lean on hints get nudged toward
 * easier work, while those who push through unaided self-select
 * into harder material.
 *
 * ---------------------------------------------------------------
 * 6. SEMESTER-END SPIKE (everything)
 *
 * PATTERN: Days 75-85 simulate semester crunch. quiz_started, quiz_completed,
 * and assignment_submitted events are duplicated at an 80% rate. No flag —
 * discover via line chart of those event volumes by day.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Assessment Volume Over Time
 *   - Report type: Insights
 *   - Events: "quiz started" + "quiz completed" + "assignment submitted"
 *   - Measure: Total
 *   - Line chart by day
 *   - Expected: ~2x volume spike on days 75-85
 *
 * REAL-WORLD ANALOGUE: Semester-end deadlines reliably produce a
 * massive last-minute surge in student activity.
 *
 * ---------------------------------------------------------------
 * 7. FREE VS PAID COURSES (funnel-pre + everything)
 *
 * PATTERN: Free users get 0.5x funnel conversion rate; paid
 * subscribers get 1.5x. Free users also lose 55% of their
 * certificates, producing a ~2.2x completion gap.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Course Completion Funnel by Subscription
 *   - Report type: Funnels
 *   - Steps: "course enrolled" -> "lecture completed" -> "quiz completed" -> "certificate earned"
 *   - Breakdown: "subscription_status"
 *   - Expected: free ~ 15% completion, paid ~ 33% (~2.2x gap)
 *
 *   Report 2: Certificates Earned per User
 *   - Report type: Insights
 *   - Event: "certificate earned"
 *   - Measure: Total per user (average)
 *   - Breakdown: "subscription_status"
 *   - Expected: paid subscribers earn substantially more certificates
 *
 * REAL-WORLD ANALOGUE: Paid commitment correlates strongly with
 * follow-through; free learners drop off long before completion.
 *
 * ---------------------------------------------------------------
 * 8. PLAYBACK SPEED CORRELATION (everything)
 *
 * PATTERN: Speed learners (>=2.0x speed on 3+ lectures) get 0.6x
 * watch_time and a paradoxical +8 quiz score boost. Thorough
 * learners (<=1.0x) get 1.4x watch_time.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Watch Time by Playback Speed
 *   - Report type: Insights
 *   - Event: "lecture completed"
 *   - Measure: Average of "watch_time_mins"
 *   - Breakdown: "playback_speed"
 *   - Expected: speed >= 2.0 ~ 0.6x baseline; speed <= 1.0 ~ 1.4x baseline
 *
 *   Report 2: Quiz Score by Speed Learner Cohort
 *   - Cohort A: users with 3+ "lecture completed" events at playback_speed >= 2.0
 *   - Cohort B: rest
 *   - Event: "quiz completed"
 *   - Measure: Average of "score_percent"
 *   - Expected: A ~ +8 pts vs B
 *
 * REAL-WORLD ANALOGUE: Power users who watch lectures at 2x speed
 * tend to be domain-confident and outperform on assessments
 * despite spending less time.
 *
 * ---------------------------------------------------------------
 * 9. COURSE COMPLETION TIME-TO-CONVERT (funnel-post)
 *
 * PATTERN: Annual subscribers complete the course-completion funnel
 * 1.4x faster (factor 0.71); Free users 1.4x slower (factor 1.4).
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Course Completion Median Time-to-Convert by Subscription
 *   - Funnels > "course enrolled" -> "lecture completed" -> "quiz completed" -> "certificate earned"
 *   - Measure: Median time to convert
 *   - Breakdown: subscription_status
 *   - Expected: annual ~ 0.71x baseline; free ~ 1.4x baseline
 *
 * REAL-WORLD ANALOGUE: Paid commitment accelerates throughput.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * EXPECTED METRICS SUMMARY
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Hook                    | Metric                | Baseline | Hook Effect  | Ratio
 * ------------------------|-----------------------|----------|--------------|------
 * Student vs Instructor   | Profile attributes    | generic  | role-specific| n/a
 * Deadline Cramming       | Sun/Mon quiz score    | 1x       | -25 pt       | -38%
 * Notes Magic Number      | sweet quiz score      | 1x       | 1.3x         | 1.3x
 * Notes Magic Number      | over certificates/user| 1x       | 0.65x        | -35%
 * Study Group Retention   | D14 retention         | ~ 40%    | ~ 90%        | 2.3x
 * Hint Dependency         | easy problem rate (hint) | 33%   | ~ 60%        | 1.8x
 * Semester-End Spike      | Assessment volume     | 1x       | ~ 2x         | 2x
 * Free vs Paid            | Course completion     | 15%      | 33%          | 2.2x
 * Playback Speed          | Quiz score (speed)    | ~ 65     | ~ 73         | +8 pt
 * Course Completion T2C   | median min by tier    | 1x       | 0.71x/1.4x   | ~ 2x range
 */

// Generate consistent IDs for lookup tables and event properties
const courseIds = v.range(1, 151).map(n => `course_${v.uid(6)}`);
const quizIds = v.range(1, 401).map(n => `quiz_${v.uid(6)}`);
const groupIds = v.range(1, 301).map(n => `group_${v.uid(6)}`);
const lectureIds = v.range(1, 501).map(n => `lecture_${v.uid(6)}`);
const assignmentIds = v.range(1, 201).map(n => `assignment_${v.uid(6)}`);
const problemIds = v.range(1, 601).map(n => `problem_${v.uid(6)}`);

/** @type {Config} */
const config = {
	token,
	seed: SEED,
	datasetStart: "2026-01-01T00:00:00Z",
	datasetEnd: "2026-04-28T23:59:59Z",
	// numDays: num_days,
	avgEventsPerUserPerDay: avg_events_per_user_per_day,
	numUsers: num_users,
	hasAnonIds: false,
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

	funnels: [
		{
			sequence: ["account registered", "course enrolled", "lecture started"],
			isFirstFunnel: true,
			conversionRate: 75,
			timeToConvert: 1,
		},
		{
			// Core learning loop: students watch lectures and do practice problems constantly
			sequence: ["lecture started", "lecture completed", "practice problem solved"],
			conversionRate: 70,
			timeToConvert: 4,
			weight: 5,
		},
		{
			// Assessment flow: quizzes and assignments after studying
			sequence: ["quiz started", "quiz completed", "assignment submitted"],
			conversionRate: 55,
			timeToConvert: 8,
			weight: 3,
		},
		{
			// Course completion journey: enroll → complete → earn certificate
			sequence: ["course enrolled", "lecture completed", "quiz completed", "certificate earned"],
			conversionRate: 30,
			timeToConvert: 48,
			weight: 2,
		},
		{
			// Social learning: discussions and study groups
			sequence: ["discussion posted", "study group joined", "resource downloaded"],
			conversionRate: 50,
			timeToConvert: 12,
			weight: 2,
		},
		{
			// Instructor interaction loop
			sequence: ["assignment submitted", "assignment graded", "instructor feedback given"],
			conversionRate: 45,
			timeToConvert: 24,
			weight: 2,
		},
		{
			// Support and monetization
			sequence: ["help requested", "subscription purchased", "course reviewed"],
			conversionRate: 35,
			timeToConvert: 24,
			weight: 1,
		},
	],

	events: [
		{
			event: "account registered",
			weight: 1,
			isFirstEvent: true,
			properties: {
				"account_type": ["instructor", "instructor", "instructor", "instructor", "instructor", "instructor", "student"],
				"signup_source": ["organic", "referral", "school_partnership", "social_ad"],
			}
		},
		{
			event: "course enrolled",
			weight: 8,
			properties: {
				"course_id": courseIds,
				"course_category": ["CS", "Math", "Science", "Business", "Arts", "Languages"],
				"difficulty": ["beginner", "intermediate", "advanced"],
				"is_free": [false, false, false, true, true],
			}
		},
		{
			event: "lecture started",
			weight: 18,
			properties: {
				"course_id": courseIds,
				"lecture_id": lectureIds,
				"lecture_duration_mins": u.weighNumRange(5, 60, 0.8, 20),
				"module_number": u.weighNumRange(1, 12),
			}
		},
		{
			event: "lecture completed",
			weight: 14,
			properties: {
				"course_id": courseIds,
				"lecture_id": lectureIds,
				"watch_time_mins": u.weighNumRange(3, 60, 0.8, 20),
				"playback_speed": [0.75, 1.0, 1.0, 1.0, 1.25, 1.5, 2.0],
				"notes_taken": [false, false, true],
			}
		},
		{
			event: "quiz started",
			weight: 10,
			properties: {
				"course_id": courseIds,
				"quiz_id": quizIds,
				"quiz_type": ["practice", "graded", "final_exam"],
				"question_count": u.weighNumRange(5, 50, 0.7, 15),
			}
		},
		{
			event: "quiz completed",
			weight: 8,
			properties: {
				"course_id": courseIds,
				"quiz_id": quizIds,
				"score_percent": u.weighNumRange(0, 100, 1.2, 50),
				"time_spent_mins": u.weighNumRange(3, 120, 0.6, 25),
				"attempts": u.weighNumRange(1, 5, 0.5, 3),
			}
		},
		{
			event: "assignment submitted",
			weight: 6,
			properties: {
				"course_id": courseIds,
				"assignment_id": assignmentIds,
				"submission_type": ["text", "code", "file", "project"],
				"word_count": u.weighNumRange(100, 5000, 0.6, 500),
				"is_late": [false, false, false, false, true],
			}
		},
		{
			event: "assignment graded",
			weight: 5,
			properties: {
				"course_id": courseIds,
				"assignment_id": assignmentIds,
				"grade": ["A", "B", "C", "D", "F"],
				"feedback_length": u.weighNumRange(0, 500, 0.5, 100),
				"grader": ["instructor", "peer", "auto"],
			}
		},
		{
			event: "discussion posted",
			weight: 7,
			properties: {
				"course_id": courseIds,
				"post_type": ["question", "answer", "comment"],
				"word_count": u.weighNumRange(10, 500, 0.6, 80),
			}
		},
		{
			event: "certificate earned",
			weight: 2,
			properties: {
				"course_id": courseIds,
				"completion_time_days": u.weighNumRange(7, 180, 0.5, 45),
				"final_grade": u.weighNumRange(60, 100, 1.2, 30),
			}
		},
		{
			event: "study group joined",
			weight: 4,
			properties: {
				"group_id": groupIds,
				"group_size": u.weighNumRange(3, 20, 0.7, 8),
				"group_type": ["study_circle", "project_team", "tutoring"],
			}
		},
		{
			event: "resource downloaded",
			weight: 9,
			properties: {
				"resource_type": ["pdf", "slides", "code_sample", "dataset", "cheat_sheet"],
				"course_id": courseIds,
			}
		},
		{
			event: "instructor feedback given",
			weight: 3,
			properties: {
				"course_id": courseIds,
				"feedback_type": ["written", "video", "rubric"],
				"response_time_hours": u.weighNumRange(1, 72, 0.5, 15),
			}
		},
		{
			event: "course reviewed",
			weight: 3,
			properties: {
				"course_id": courseIds,
				"rating": u.weighNumRange(1, 5, 1.5, 3),
				"review_length": u.weighNumRange(10, 1000, 0.5, 100),
				"would_recommend": [false, false, false, true, true, true, true, true, true, true],
			}
		},
		{
			event: "subscription purchased",
			weight: 2,
			properties: {
				"plan": ["monthly", "annual", "lifetime"],
				"price": [19.99, 149.99, 499.99],
			}
		},
		{
			event: "help requested",
			weight: 4,
			properties: {
				"topic": ["technical", "content", "billing", "accessibility"],
				"channel": ["chat", "email", "forum"],
			}
		},
		{
			event: "practice problem solved",
			weight: 12,
			properties: {
				"course_id": courseIds,
				"problem_id": problemIds,
				"difficulty": ["easy", "medium", "hard"],
				"time_to_solve_sec": u.weighNumRange(10, 3600, 0.5, 300),
				"hint_used": [false, false, true],
			}
		},
	],

	superProps: {
		Platform: ["Web", "iOS", "Android", "iPad"],
	},

	scdProps: {
		enrollment_status: {
			values: ["enrolled", "active", "completed", "dropped"],
			frequency: "month",
			timing: "fuzzy",
			max: 6
		},
		course_status: {
			values: ["draft", "published", "archived", "deprecated"],
			frequency: "month",
			timing: "fixed",
			max: 6,
			type: "course_id"
		}
	},

	userProps: {
		"account_type": ["student", "student", "student", "student", "student", "student", "student", "student", "instructor"],
		"subscription_status": ["free", "free", "free", "monthly", "annual"],
		"learning_style": ["visual", "reading", "hands_on", "auditory"],
		"education_level": ["high_school", "bachelors", "masters", "phd", "self_taught"],
		"timezone": ["US_Eastern", "US_Pacific", "US_Central", "Europe", "Asia"],
		"courses_created": [0],
		"teaching_experience_years": [0],
		"instructor_rating": [0],
		"learning_goal": ["none"],
		"study_hours_per_week": [0],
		"Platform": ["Web", "iOS", "Android", "iPad"],
	},

	groupKeys: [
		["course_id", 150, ["course enrolled", "lecture started", "lecture completed", "quiz completed", "certificate earned"]],
		["group_id", 300, ["study group joined", "discussion posted"]],
	],

	groupProps: {
		course_id: {
			"title": () => `${chance.pickone(["Introduction to", "Advanced", "Mastering", "Fundamentals of", "Applied"])} ${chance.pickone(["Algorithms", "Data Science", "Machine Learning", "Statistics", "Web Development", "Calculus", "Biology", "Economics", "Design Thinking", "Creative Writing"])}`,
			"instructor_count": u.weighNumRange(1, 5, 0.5, 2),
			"total_enrolled": u.weighNumRange(50, 5000, 0.6, 500),
			"avg_rating": u.weighNumRange(3, 5, 1.5, 1),
		},
		group_id: {
			"name": () => `${chance.pickone(["Study", "Learning", "Focus", "Peer", "Cohort"])} ${chance.pickone(["Circle", "Squad", "Team", "Hub", "Group"])} ${chance.character({ alpha: true, casing: "upper" })}${chance.integer({ min: 1, max: 99 })}`,
			"member_count": u.weighNumRange(3, 20, 0.7, 8),
			"focus_area": ["CS", "Math", "Science", "Business", "Arts", "Languages"],
		}
	},

	lookupTables: [],

	/**
	 * ARCHITECTED ANALYTICS HOOKS
	 *
	 * This hook function creates 8 deliberate patterns in the data:
	 *
	 * 1. STUDENT VS INSTRUCTOR PROFILES: Instructor profiles get teaching attributes; students get learning attributes
	 * 2. DEADLINE CRAMMING: Assignments submitted on Sun/Mon are rushed and lower quality
	 * 3. NOTES-TAKERS SUCCEED: Students who take notes during lectures score higher on quizzes
	 * 4. STUDY GROUP RETENTION: Early study group joiners retain; non-joiners with low scores churn
	 * 5. HINT DEPENDENCY: Hint users get locked into easy problems; non-hint users tackle harder ones
	 * 6. SEMESTER-END SPIKE: Days 75-85 see doubled assessment activity (cramming period)
	 * 7. FREE VS PAID COURSES: Paid subscribers convert through Course Completion funnel at ~2.2x rate
	 * 8. PLAYBACK SPEED CORRELATION: Speed learners paradoxically score higher; thorough learners get extended time
	 */
	hook: function (record, type, meta) {
		// HOOK 1: STUDENT VS INSTRUCTOR PROFILES (user) — role-based attributes.
		if (type === "user") {
			if (record.account_type === "instructor") {
				record.courses_created = chance.integer({ min: 1, max: 15 });
				record.teaching_experience_years = chance.integer({ min: 1, max: 20 });
				record.instructor_rating = Math.round((chance.floating({ min: 3.0, max: 5.0 }) + Number.EPSILON) * 100) / 100;
			} else {
				record.learning_goal = chance.pickone(["career_change", "skill_upgrade", "hobby", "degree_requirement"]);
				record.study_hours_per_week = chance.integer({ min: 2, max: 30 });
			}
		}

		// HOOK 5 (event): HINT DEPENDENCY — hint users get 60% easy problems;
		// non-hint users get 40% hard problems. Mutates difficulty (raw).
		// HOOK 8 (event): PLAYBACK SPEED — speed learners (>= 2.0x) get
		// watch_time_mins compressed 0.6x; thorough learners (<= 1.0x) get 1.4x.
		if (type === "event") {
			if (record.event === "practice problem solved") {
				if (record.hint_used === true && chance.bool({ likelihood: 60 })) {
					record.difficulty = "easy";
				} else if (record.hint_used === false && chance.bool({ likelihood: 40 })) {
					record.difficulty = "hard";
				}
			}
			if (record.event === "lecture completed") {
				const speed = record.playback_speed;
				if (speed >= 2.0 && record.watch_time_mins !== undefined) {
					record.watch_time_mins = Math.max(3, Math.floor(record.watch_time_mins * 0.6));
				} else if (speed !== undefined && speed <= 1.0 && record.watch_time_mins !== undefined) {
					record.watch_time_mins = Math.min(90, Math.floor(record.watch_time_mins * 1.4));
				}
			}
		}

		// HOOK 9 (T2C): COURSE COMPLETION TIME-TO-CONVERT (funnel-post)
		// Annual subscribers complete the Course Completion funnel 1.4x
		// faster (factor 0.71); Free users 1.4x slower (factor 1.4).
		if (type === "funnel-post") {
			const segment = meta?.profile?.subscription_status;
			if (Array.isArray(record) && record.length > 1) {
				const factor = (
					segment === "annual" ? 0.71 :
					segment === "free" ? 1.4 :
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

		if (type === "everything") {
			const datasetStart = dayjs.unix(meta.datasetStart);
			const userEvents = record;
			const profile = meta.profile;
			const firstEventTime = userEvents.length > 0 ? dayjs(userEvents[0].time) : null;

			if (profile) {
				userEvents.forEach((event) => {
					if (profile.Platform !== undefined) event.Platform = profile.Platform;
				});
			}

			let notesTakenCount = 0;
			let joinedStudyGroupEarly = false;
			let hasLowQuizScore = false;
			let speedLectureCount = 0;

			userEvents.forEach((event) => {
				const eventTime = dayjs(event.time);
				const daysSinceStart = firstEventTime ? eventTime.diff(firstEventTime, 'days', true) : 0;
				if (event.event === "lecture completed" && event.notes_taken === true) notesTakenCount++;
				if (event.event === "study group joined" && daysSinceStart <= 10) joinedStudyGroupEarly = true;
				if (event.event === "quiz completed" && event.score_percent < 60) hasLowQuizScore = true;
				if (event.event === "lecture completed" && event.playback_speed >= 2.0) speedLectureCount++;
			});

			// HOOK 3 + HOOK 10: NOTES MAGIC NUMBER (in-funnel, no flags)
			// Sweet 5-8 notes-taken lectures → +30% quiz score_percent (cap 100).
			// Over 9+ → drop 35% of certificate-earned events (over-noted but
			// can't synthesize; gets stuck in "study mode").
			if (notesTakenCount >= 5 && notesTakenCount <= 8) {
				userEvents.forEach((event) => {
					if (event.event === "quiz completed" && event.score_percent !== undefined) {
						event.score_percent = Math.min(100, Math.round(event.score_percent * 1.3));
					}
				});
				if (chance.bool({ likelihood: 40 })) {
					const lastEvent = userEvents[userEvents.length - 1];
					const certTemplate = userEvents.find(e => e.event === "certificate earned");
					if (lastEvent && certTemplate) {
						userEvents.push({
							...certTemplate,
							time: dayjs(lastEvent.time).add(chance.integer({ min: 1, max: 5 }), 'days').toISOString(),
							user_id: lastEvent.user_id,
							course_id: chance.pickone(courseIds),
							completion_time_days: chance.integer({ min: 14, max: 90 }),
							final_grade: chance.integer({ min: 80, max: 100 }),
						});
					}
				}
			} else if (notesTakenCount >= 9) {
				for (let i = userEvents.length - 1; i >= 0; i--) {
					if (userEvents[i].event === "certificate earned" && chance.bool({ likelihood: 35 })) {
						userEvents.splice(i, 1);
					}
				}
			}

			// HOOK 8 (cont): Speed learners (3+ lectures at 2.0x) score +8 on quizzes.
			if (speedLectureCount >= 3) {
				userEvents.forEach((event) => {
					if (event.event === "quiz completed" && event.score_percent !== undefined) {
						event.score_percent = Math.min(100, event.score_percent + 8);
					}
				});
			}

			// HOOK 6: SEMESTER-END SPIKE — duplicate quiz/assignment events
			// in days 75-85 window. No flag — discover via line chart.
			const duplicates = [];
			const spikableEvents = ["quiz started", "quiz completed", "assignment submitted"];
			userEvents.forEach((event) => {
				if (spikableEvents.includes(event.event) && event.time) {
					const dayInDataset = dayjs.utc(event.time).diff(datasetStart, 'days', true);
					if (dayInDataset >= 75 && dayInDataset <= 85 && chance.bool({ likelihood: 80 })) {
						const dup = JSON.parse(JSON.stringify(event));
						dup.time = dayjs(event.time).add(chance.integer({ min: 5, max: 120 }), 'minutes').toISOString();
						duplicates.push(dup);
					}
				}
			});
			if (duplicates.length > 0) userEvents.push(...duplicates);

			// HOOK 7: FREE VS PAID — free users lose 55% of certificates.
			const subStatus = profile ? profile.subscription_status : "free";
			if (subStatus === "free") {
				for (let i = userEvents.length - 1; i >= 0; i--) {
					if (userEvents[i].event === "certificate earned" && chance.bool({ likelihood: 55 })) {
						userEvents.splice(i, 1);
					}
				}
			}

			// HOOK 4: STUDY GROUP RETENTION — non-joiners with low scores lose
			// all post-day-14 events. Joiners get extra cloned discussion events.
			if (!joinedStudyGroupEarly && hasLowQuizScore) {
				const churnCutoff = firstEventTime ? firstEventTime.add(14, 'days') : null;
				for (let i = userEvents.length - 1; i >= 0; i--) {
					if (churnCutoff && dayjs(userEvents[i].time).isAfter(churnCutoff)) {
						userEvents.splice(i, 1);
					}
				}
			} else if (joinedStudyGroupEarly) {
				const lastEvent = userEvents[userEvents.length - 1];
				const discussionTemplate = userEvents.find(e => e.event === "discussion posted");
				if (lastEvent && discussionTemplate && chance.bool({ likelihood: 60 })) {
					userEvents.push({
						...discussionTemplate,
						time: dayjs(lastEvent.time).add(chance.integer({ min: 1, max: 3 }), 'days').toISOString(),
						user_id: lastEvent.user_id,
						course_id: chance.pickone(courseIds),
						post_type: chance.pickone(["question", "answer", "comment"]),
						word_count: chance.integer({ min: 20, max: 400 }),
					});
				}
			}

			// HOOK 2: DEADLINE CRAMMING — Sun/Mon assignment_submitted events
			// flip is_late to true 60% of the time and quiz_completed score_percent
			// drops 25 points. Mutates raw is_late + score_percent.
			for (const event of userEvents) {
				if (event.event === "assignment submitted" && event.time) {
					const dow = new Date(event.time).getUTCDay();
					if (dow === 0 || dow === 1) {
						event.is_late = chance.bool({ likelihood: 60 });
					}
				}
			}
			userEvents.forEach((event) => {
				if (event.event === "quiz completed" && event.time) {
					const dow = new Date(event.time).getUTCDay();
					if ((dow === 0 || dow === 1) && event.score_percent !== undefined) {
						event.score_percent = Math.max(0, event.score_percent - 25);
					}
				}
			});
		}

		return record;
	}
};

export default config;
