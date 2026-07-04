// ── IMPORTS ──
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);
import "dotenv/config";
import * as u from "@ak--47/dungeon-master/utils";
import * as v from "ak-tools";
/** @typedef  {import("../../../types").Dungeon} Config */

// ── OVERVIEW ──
/*
 * NAME:       LearnPath
 * APP:        Online learning platform modeled after Coursera, Khan Academy,
 *             and Udemy. Self-paced and cohort-based courses with quizzes,
 *             assignments, certificates, and a social study layer. Two-sided
 *             marketplace: ~89% students, ~11% instructors.
 * SCALE:      10,000 users, ~760K events, 121 days (2026-01-01 → 2026-05-01)
 * CORE LOOP:  account registered → course enrolled → lecture started/completed → quiz → certificate
 *
 * EVENTS (17):
 *   lecture started (18) > lecture completed (14) > practice problem solved (12)
 *   > quiz started (10) > resource downloaded (9) > course enrolled (8)
 *   > quiz completed (8) > discussion posted (7) > assignment submitted (6)
 *   > assignment graded (5) > help requested (4) > study group joined (4)
 *   > instructor feedback given (3) > course reviewed (3) > certificate earned (2)
 *   > subscription purchased (2) > account registered (1)
 *
 * FUNNELS (7):
 *   - Onboarding:               account registered → course enrolled → lecture started (75%)
 *   - Learning Loop:            lecture started → lecture completed → practice problem solved (70%, reentry)
 *   - Assessment:               quiz started → quiz completed → assignment submitted (55%, reentry)
 *   - Course Completion:        course enrolled → lecture completed → quiz completed → certificate earned (30%)
 *   - Social Learning:          discussion posted → study group joined → resource downloaded (50%, AI Study Buddy A/B)
 *   - Instructor Interaction:   assignment submitted → assignment graded → instructor feedback given (45%)
 *   - Support/Monetization:     help requested → subscription purchased → course reviewed (35%)
 *
 * USER PROPS:  account_type, subscription_status, learning_style, education_level, timezone, courses_created, teaching_experience_years, instructor_rating, learning_goal, study_hours_per_week, Platform
 * SUPER PROPS: Platform
 * SCD PROPS:   enrollment_status (enrolled/active/completed/dropped, monthly fuzzy, max 6), course_status (draft/published/archived/deprecated, monthly fixed, max 6, type: course_id)
 * GROUPS:      course_id (150 courses), group_id (300 study groups)
 */

// ── HOOK STORIES ──
/*
 * ---------------------------------------------------------------
 * 1. STUDENT VS INSTRUCTOR PROFILES (user)
 * ---------------------------------------------------------------
 *
 * PATTERN: Instructor profiles get teaching attributes
 * (courses_created, teaching_experience_years, instructor_rating).
 * Students get learning attributes (learning_goal,
 * study_hours_per_week). Two-sided marketplace at ~89% students,
 * ~11% instructors. The everything hook also stamps account_type on
 * 'account registered' events from the user's profile (the engine
 * draws event-level pool props independently of profile props), so
 * the event breakdown agrees with the profile breakdown exactly.
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
 * ---------------------------------------------------------------
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
 *   - Expected: Sun/Mon ~ 26, other days ~ 50 (-25 knob; the clamp at 0
 *     attenuates the observed gap to ~24 pts since organic sub-25 scores
 *     can't drop the full amount)
 *
 * REAL-WORLD ANALOGUE: Procrastination clusters submissions at the
 * deadline weekend and hammers performance.
 *
 * ---------------------------------------------------------------
 * 3. NOTES MAGIC NUMBER (everything, in-funnel)
 * ---------------------------------------------------------------
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
 * ---------------------------------------------------------------
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
 *   - Expected: A ~ 100% vs B ~ 1%. The churn is near-deterministic:
 *     it fires for non-joiners with ANY raw sub-60 quiz, and at the
 *     organic score mean (~40) virtually every quizzing non-joiner
 *     has one. Non-joiners who never quiz survive, but they are rare
 *     among 20d+-tenure users.
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
 * ---------------------------------------------------------------
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
 *   - Expected: ~73% easy (60% forced + 40% x 1/3 organic; vs ~33% baseline)
 *
 *   Report 2: Hard Problem Mix for Independent Solvers
 *   - Report type: Insights
 *   - Event: "practice problem solved"
 *   - Measure: Total
 *   - Filter: "hint_used" = false
 *   - Breakdown: "difficulty"
 *   - Expected: ~60% hard (40% forced + 60% x 1/3 organic; vs ~33% baseline)
 *
 * REAL-WORLD ANALOGUE: Learners who lean on hints get nudged toward
 * easier work, while those who push through unaided self-select
 * into harder material.
 *
 * ---------------------------------------------------------------
 * 6. SEMESTER-END SPIKE (everything)
 * ---------------------------------------------------------------
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
 *   - Expected: ~1.8x volume spike on days 75-84 (80% duplication rate;
 *     the hook's continuous [75, 85) day-index window fully treats
 *     calendar days 75-84)
 *
 * REAL-WORLD ANALOGUE: Semester-end deadlines reliably produce a
 * massive last-minute surge in student activity.
 *
 * ---------------------------------------------------------------
 * 7. FREE VS PAID COURSES (funnel-pre + everything)
 * ---------------------------------------------------------------
 *
 * PATTERN: Free users get 0.5x funnel conversion rate on the cert funnel only
 * (30% -> 15% generative); paid subscribers get 1.5x (30% -> 45%). Free users
 * ALSO lose 55% of their certificates post-generation, so the observed
 * completion gap compounds both treatments: paid/free certificates per user
 * lands well above the 3x conversion-only gap (v1.5 doc said "~2.2x" — that
 * figure ignored the 55% cert removal AND understated the paid factor).
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Course Completion Funnel by Subscription
 *   - Report type: Funnels
 *   - Steps: "course enrolled" -> "lecture completed" -> "quiz completed" -> "certificate earned"
 *   - Breakdown: "subscription_status"
 *   - Expected: paid arms convert several-fold more than free (conversion
 *     gating 3x, further widened in-report by the 55% free cert removal)
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
 * 8. PLAYBACK SPEED CORRELATION (event + everything)
 * ---------------------------------------------------------------
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
 * 9. COURSE COMPLETION TIME-TO-CONVERT (everything)
 * ---------------------------------------------------------------
 *
 * PATTERN: Annual subscribers complete the course-completion funnel
 * 2x faster (factor 0.5); Free users 1.8x slower (factor 1.8).
 * Applied in the everything hook by scaling the enrolled-to-cert
 * gap on the raw events. Stronger factors compensate for the
 * composition effect from H7's conversion-rate gating.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Course Completion Median Time-to-Convert by Subscription
 *   - Funnels > "course enrolled" -> "lecture completed" -> "quiz completed" -> "certificate earned"
 *   - Measure: Median time to convert
 *   - Breakdown: subscription_status
 *   - Expected: annual < monthly < free (direction)
 *
 *   Also visible via cross-event SQL: MIN("course enrolled" time) to
 *   MIN("certificate earned" time) per user, broken down by
 *   subscription_status. Annual < monthly < free.
 *
 * REAL-WORLD ANALOGUE: Paid commitment accelerates throughput.
 *
 * ---------------------------------------------------------------
 * 10. SOCIAL LEARNING EXPERIMENT (funnel experiment)
 * ---------------------------------------------------------------
 *
 * PATTERN: A/B experiment on the Social Learning funnel (discussion
 * posted → study group joined → resource downloaded). "AI Study
 * Buddy" variant boosts conversion 1.4x and speeds TTC to 0.85x.
 * Activates 30 days before dataset end.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: $experiment_started by Variant
 *   - Report type: Insights
 *   - Event: "$experiment_started"
 *   - Measure: Total
 *   - Breakdown: "$experiment_name" and "Variant"
 *   - Expected: ~50% Control, ~50% AI Study Buddy
 *
 *   Report 2: Social Learning Funnel by Variant
 *   - Report type: Funnels
 *   - Steps: "discussion posted" → "study group joined" → "resource downloaded"
 *   - Breakdown: Variant
 *   - Expected: AI Study Buddy ~ 1.35-1.4x conversion vs Control
 *     (generative multiplier is 1.4; organic pollution — failed
 *     experiment passes completed by organic downloads at a ~0.035
 *     base rate in both arms — mildly attenuates the measured lift)
 *
 * REAL-WORLD ANALOGUE: AI-powered study companions boost social
 * engagement and resource discovery in cohort-based courses.
 *
 * ===============================================================
 * EXPECTED METRICS SUMMARY
 * (Measured = full fidelity, 10K users / 760,795 events)
 * ===============================================================
 *
 * Story id | Metric                                      | Expected      | Measured
 * ---------|---------------------------------------------|---------------|---------
 * H1       | instructor profile share                    | 1/9 = 0.111   | 0.1121
 * H1       | role-attribute purity (both roles)          | 1.0           | 1.0000
 * H1       | event account_type = profile (registered)   | 1.0           | 1.0000
 * H2       | Sun/Mon late rate vs rest                   | 0.60 / 0.20   | 0.6038 / 0.1986
 * H2       | quiz score diff rest - Sun/Mon              | ~24 (clamp)   | 24.13
 * H3       | sweet/low quiz score (isolated read)        | ~1.3          | 1.270
 * H3       | certs-per-enroll over/sweet                 | ~0.65 keep    | 0.6398
 * H3       |   placebo: over/low score                   | ~1.0          | 0.9837
 * H4       | D14+ activity early-join vs non             | ~1.0 / ~0.01  | 0.9988 / 0.0035
 * H4       | discussions per user early/non              | ~18x          | 18.91
 * H5       | P(easy | hint)                              | 0.745         | 0.7469
 * H5       | P(hard | no hint)                           | 0.610         | 0.6141
 * H6       | spikable volume window/flank (days 75-84)   | ~1.8-1.9      | 1.908
 * H6       |   placebo: non-spikable window/flank        | ~1.0-1.1      | 1.067
 * H7       | emulator conv monthly/free (86.4h, 2-step)  | 6.67 compound | 6.73
 * H7       | certs-per-enroll monthly/free               | ~6 (diluted)  | 6.037
 * H7       |   placebo: annual/monthly certs-per-enroll  | ~1.0          | 1.057
 * H8       | watch time fast/mid                         | ~0.59         | 0.5857
 * H8       | watch time slow/mid                         | 1.40          | 1.388
 * H8       | quiz score diff speedy - rest               | ~+8           | +7.91
 * H9       | median TTC free/monthly (emulator 86.4h)    | ~1.8          | 1.760
 * H9       | median TTC annual/monthly                   | ~0.5          | 0.510
 * H10      | strict-paired conversion lift AI/Control    | ~1.37 (p.035) | 1.377
 * H10      | paired median TTC AI/Control                | ~0.85         | 0.857
 */

// ── SCALE ──
const SEED = "harness-education";
const NUM_USERS = 10_000;
const DATASET_START = "2026-01-01T00:00:00Z";
const DATASET_END = "2026-05-01T23:59:59Z";
const EVENTS_PER_DAY = 1.2;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── KNOBS (tweak these to reshape stories) ──
const HINT_EASY_LIKELIHOOD = 60;
const HINT_HARD_LIKELIHOOD = 40;

const SPEED_FAST_THRESHOLD = 2.0;
const SPEED_FAST_WATCH_FACTOR = 0.6;
const SPEED_FAST_WATCH_MIN = 3;
const SPEED_SLOW_THRESHOLD = 1.0;
const SPEED_SLOW_WATCH_FACTOR = 1.4;
const SPEED_SLOW_WATCH_MAX = 90;
const SPEED_LECTURE_COUNT_THRESHOLD = 3;
const SPEED_QUIZ_BOOST_POINTS = 8;

const FREE_FUNNEL_CONV_FACTOR = 0.5;
const PAID_FUNNEL_CONV_FACTOR = 1.5;
const FREE_CERT_DROP_LIKELIHOOD = 55;

const NOTES_SWEET_MIN = 5;
const NOTES_SWEET_MAX = 8;
const NOTES_OVER_THRESHOLD = 9;
const NOTES_QUIZ_BOOST = 1.3;
const NOTES_BONUS_CERT_LIKELIHOOD = 40;
const NOTES_OVER_CERT_DROP_LIKELIHOOD = 35;

const SEMESTER_SPIKE_START_DAY = 75;
const SEMESTER_SPIKE_END_DAY = 85;
const SEMESTER_SPIKE_LIKELIHOOD = 80;

const TTC_ANNUAL_FACTOR = 0.5;
const TTC_FREE_FACTOR = 1.8;

const STUDY_GROUP_EARLY_DAYS = 10;
const STUDY_GROUP_LOW_QUIZ_THRESHOLD = 60;
const STUDY_GROUP_CHURN_CUTOFF_DAYS = 14;
const STUDY_GROUP_DISCUSSION_CLONE_LIKELIHOOD = 60;

const DEADLINE_LATE_LIKELIHOOD = 60;
const DEADLINE_QUIZ_PENALTY = 25;

// ── DATA ARRAYS ──
// Generate consistent IDs for lookup tables and event properties
const courseIds = v.range(1, 151).map(n => `course_${v.uid(6)}`);
const quizIds = v.range(1, 401).map(n => `quiz_${v.uid(6)}`);
const groupIds = v.range(1, 301).map(n => `group_${v.uid(6)}`);
const lectureIds = v.range(1, 501).map(n => `lecture_${v.uid(6)}`);
const assignmentIds = v.range(1, 201).map(n => `assignment_${v.uid(6)}`);
const problemIds = v.range(1, 601).map(n => `problem_${v.uid(6)}`);

// ── HELPER FUNCTIONS ──
function handleUserHooks(record) {
	// H1: STUDENT VS INSTRUCTOR PROFILES — role-based attributes.
	if (record.account_type === "instructor") {
		record.courses_created = chance.integer({ min: 1, max: 15 });
		record.teaching_experience_years = chance.integer({ min: 1, max: 20 });
		record.instructor_rating = Math.round((chance.floating({ min: 3.0, max: 5.0 }) + Number.EPSILON) * 100) / 100;
	} else {
		record.learning_goal = chance.pickone(["career_change", "skill_upgrade", "hobby", "degree_requirement"]);
		record.study_hours_per_week = chance.integer({ min: 2, max: 30 });
	}
	return record;
}

function handleEventHooks(record) {
	// H5: HINT DEPENDENCY — hint users get 60% easy problems; non-hint
	// users get 40% hard problems. Mutates difficulty (raw).
	if (record.event === "practice problem solved") {
		if (record.hint_used === true && chance.bool({ likelihood: HINT_EASY_LIKELIHOOD })) {
			record.difficulty = "easy";
		} else if (record.hint_used === false && chance.bool({ likelihood: HINT_HARD_LIKELIHOOD })) {
			record.difficulty = "hard";
		}
	}
	// H8 (event): PLAYBACK SPEED — speed learners (>= 2.0x) get
	// watch_time_mins compressed 0.6x; thorough learners (<= 1.0x) get 1.4x.
	if (record.event === "lecture completed") {
		const speed = record.playback_speed;
		if (speed >= SPEED_FAST_THRESHOLD && record.watch_time_mins !== undefined) {
			record.watch_time_mins = Math.max(SPEED_FAST_WATCH_MIN, Math.floor(record.watch_time_mins * SPEED_FAST_WATCH_FACTOR));
		} else if (speed !== undefined && speed <= SPEED_SLOW_THRESHOLD && record.watch_time_mins !== undefined) {
			record.watch_time_mins = Math.min(SPEED_SLOW_WATCH_MAX, Math.floor(record.watch_time_mins * SPEED_SLOW_WATCH_FACTOR));
		}
	}
	return record;
}

function handleFunnelPreHooks(record, meta) {
	// H7: FREE VS PAID — free users get 0.5x conversion rate; paid
	// subscribers get 1.5x. Scoped to the course-completion funnel ONLY
	// (sequence ending in "certificate earned") to avoid displacing standalone
	// events for paid users and triggering unintended churn in H4.
	const isCertFunnel = Array.isArray(meta?.funnel?.sequence) &&
		meta.funnel.sequence.includes("certificate earned");
	if (isCertFunnel) {
		const subStatus = meta?.profile?.subscription_status;
		if (subStatus === "free") {
			record.conversionRate = Math.round(record.conversionRate * FREE_FUNNEL_CONV_FACTOR);
		} else if (subStatus === "monthly" || subStatus === "annual") {
			record.conversionRate = Math.min(100, Math.round(record.conversionRate * PAID_FUNNEL_CONV_FACTOR));
		}
	}
	return record;
}

function handleEverythingHooks(record, meta) {
	const datasetStart = dayjs.unix(meta.datasetStart);
	const userEvents = record;
	const profile = meta.profile;
	const firstEventTime = userEvents.length > 0 ? dayjs(userEvents[0].time) : null;

	if (profile) {
		userEvents.forEach((event) => {
			if (profile.Platform !== undefined) event.Platform = profile.Platform;
			// H1: event-level account_type must agree with the profile —
			// the engine draws event props independently of user props, so
			// without this stamp the 'account registered' breakdown would
			// contradict the profile mix
			if (event.event === "account registered" && profile.account_type !== undefined) {
				event.account_type = profile.account_type;
			}
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
		if (event.event === "study group joined" && daysSinceStart <= STUDY_GROUP_EARLY_DAYS) joinedStudyGroupEarly = true;
		if (event.event === "quiz completed" && event.score_percent < STUDY_GROUP_LOW_QUIZ_THRESHOLD) hasLowQuizScore = true;
		if (event.event === "lecture completed" && event.playback_speed >= SPEED_FAST_THRESHOLD) speedLectureCount++;
	});

	// H3 + H10: NOTES MAGIC NUMBER (in-funnel, no flags)
	// Sweet 5-8 notes-taken lectures → +30% quiz score_percent (cap 100).
	// Over 9+ → drop 35% of certificate-earned events (over-noted but
	// can't synthesize; gets stuck in "study mode").
	if (notesTakenCount >= NOTES_SWEET_MIN && notesTakenCount <= NOTES_SWEET_MAX) {
		userEvents.forEach((event) => {
			if (event.event === "quiz completed" && event.score_percent !== undefined) {
				event.score_percent = Math.min(100, Math.round(event.score_percent * NOTES_QUIZ_BOOST));
			}
		});
		if (chance.bool({ likelihood: NOTES_BONUS_CERT_LIKELIHOOD })) {
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
	} else if (notesTakenCount >= NOTES_OVER_THRESHOLD) {
		// Over-noters: drop 35% of certificates (stuck in study mode)
		for (let i = userEvents.length - 1; i >= 0; i--) {
			if (userEvents[i].event === "certificate earned" && chance.bool({ likelihood: NOTES_OVER_CERT_DROP_LIKELIHOOD })) {
				userEvents.splice(i, 1);
			}
		}
	}

	// H8 (cont): Speed learners (3+ lectures at 2.0x) score +8 on quizzes.
	if (speedLectureCount >= SPEED_LECTURE_COUNT_THRESHOLD) {
		userEvents.forEach((event) => {
			if (event.event === "quiz completed" && event.score_percent !== undefined) {
				event.score_percent = Math.min(100, event.score_percent + SPEED_QUIZ_BOOST_POINTS);
			}
		});
	}

	// H6: SEMESTER-END SPIKE — duplicate quiz/assignment events
	// in days 75-85 window. No flag — discover via line chart.
	const duplicates = [];
	const spikableEvents = ["quiz started", "quiz completed", "assignment submitted"];
	userEvents.forEach((event) => {
		if (spikableEvents.includes(event.event) && event.time) {
			const dayInDataset = dayjs.utc(event.time).diff(datasetStart, 'days', true);
			if (dayInDataset >= SEMESTER_SPIKE_START_DAY && dayInDataset <= SEMESTER_SPIKE_END_DAY && chance.bool({ likelihood: SEMESTER_SPIKE_LIKELIHOOD })) {
				const dup = JSON.parse(JSON.stringify(event));
				dup.time = dayjs(event.time).add(chance.integer({ min: 5, max: 120 }), 'minutes').toISOString();
				duplicates.push(dup);
			}
		}
	});
	if (duplicates.length > 0) userEvents.push(...duplicates);

	const subStatus = profile ? profile.subscription_status : "free";

	// H9 (T2C): COURSE COMPLETION TIME-TO-CONVERT (everything)
	// Annual subscribers complete the cert funnel 2x faster (factor 0.5);
	// Free users 1.8x slower (factor 1.8). For each "certificate earned"
	// event, find the nearest preceding "course enrolled" and scale the gap.
	// Runs BEFORE cert-dropping (H7) so TTC adjustments aren't masked by
	// survivorship bias from the 55% free cert removal.
	{
		const ttcFactor = (
			subStatus === "annual" ? TTC_ANNUAL_FACTOR :
			subStatus === "free" ? TTC_FREE_FACTOR :
			1.0
		);
		if (ttcFactor !== 1.0) {
			// Collect all "course enrolled" times (sorted) for binary lookup
			const enrolledTimes = userEvents
				.filter(e => e.event === "course enrolled")
				.map(e => dayjs(e.time))
				.sort((a, b) => a.valueOf() - b.valueOf());

			if (enrolledTimes.length > 0) {
				for (const event of userEvents) {
					if (event.event === "certificate earned") {
						const certTime = dayjs(event.time);
						// Find the latest enrolled time before this cert
						let anchor = null;
						for (let k = enrolledTimes.length - 1; k >= 0; k--) {
							if (enrolledTimes[k].isBefore(certTime)) {
								anchor = enrolledTimes[k];
								break;
							}
						}
						if (anchor) {
							const gap = certTime.diff(anchor);
							const newGap = Math.round(gap * ttcFactor);
							event.time = anchor.add(newGap, "milliseconds").toISOString();
						}
					}
				}
			}
		}
	}

	// H7: FREE VS PAID — free users lose 55% of certificates.
	if (subStatus === "free") {
		for (let i = userEvents.length - 1; i >= 0; i--) {
			if (userEvents[i].event === "certificate earned" && chance.bool({ likelihood: FREE_CERT_DROP_LIKELIHOOD })) {
				userEvents.splice(i, 1);
			}
		}
	}

	// H4: STUDY GROUP RETENTION — non-joiners with low scores lose
	// all post-day-14 events. Joiners get extra cloned discussion events.
	if (!joinedStudyGroupEarly && hasLowQuizScore) {
		const churnCutoff = firstEventTime ? firstEventTime.add(STUDY_GROUP_CHURN_CUTOFF_DAYS, 'days') : null;
		for (let i = userEvents.length - 1; i >= 0; i--) {
			if (churnCutoff && dayjs(userEvents[i].time).isAfter(churnCutoff)) {
				userEvents.splice(i, 1);
			}
		}
	} else if (joinedStudyGroupEarly) {
		const lastEvent = userEvents[userEvents.length - 1];
		const discussionTemplate = userEvents.find(e => e.event === "discussion posted");
		if (lastEvent && discussionTemplate && chance.bool({ likelihood: STUDY_GROUP_DISCUSSION_CLONE_LIKELIHOOD })) {
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

	// H2: DEADLINE CRAMMING — Sun/Mon assignment_submitted events
	// flip is_late to true 60% of the time and quiz_completed score_percent
	// drops 25 points. Mutates raw is_late + score_percent.
	for (const event of userEvents) {
		if (event.event === "assignment submitted" && event.time) {
			const dow = new Date(event.time).getUTCDay();
			if (dow === 0 || dow === 1) {
				event.is_late = chance.bool({ likelihood: DEADLINE_LATE_LIKELIHOOD });
			}
		}
	}
	userEvents.forEach((event) => {
		if (event.event === "quiz completed" && event.time) {
			const dow = new Date(event.time).getUTCDay();
			if ((dow === 0 || dow === 1) && event.score_percent !== undefined) {
				event.score_percent = Math.max(0, event.score_percent - DEADLINE_QUIZ_PENALTY);
			}
		}
	});

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
			reentry: true,
		},
		{
			// Assessment flow: quizzes and assignments after studying
			sequence: ["quiz started", "quiz completed", "assignment submitted"],
			conversionRate: 55,
			timeToConvert: 8,
			weight: 3,
			reentry: true,
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
			experiment: {
				name: "AI Study Buddy",
				variants: [
					{ name: "Control" },
					{ name: "AI Study Buddy", conversionMultiplier: 1.4, ttcMultiplier: 0.85 },
				],
				startDaysBeforeEnd: 30,
			},
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
			isAuthEvent: true,
			properties: {
				// pool matches the 8:1 student profile mix; the everything hook then
				// overwrites from the profile so the event-level breakdown is EXACT
				"account_type": ["student", "student", "student", "student", "student", "student", "student", "student", "instructor"],
				"signup_source": ["organic", "referral", "school_partnership", "social_ad"],
			}
		},
		{
			event: "course enrolled",
			weight: 8,
			isStrictEvent: false,
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
			isStrictEvent: false,
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
			isStrictEvent: false,
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
			isStrictEvent: false,
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
			isStrictEvent: false,
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
			isStrictEvent: false,
			properties: {
				"course_id": courseIds,
				"post_type": ["question", "answer", "comment"],
				"word_count": u.weighNumRange(10, 500, 0.6, 80),
			}
		},
		{
			event: "certificate earned",
			weight: 2,
			isStrictEvent: false,
			properties: {
				"course_id": courseIds,
				"completion_time_days": u.weighNumRange(7, 180, 0.5, 45),
				"final_grade": u.weighNumRange(60, 100, 1.2, 30),
			}
		},
		{
			event: "study group joined",
			weight: 4,
			isStrictEvent: false,
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
			isStrictEvent: false,
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

	hook(record, type, meta) {
		if (type === "user") return handleUserHooks(record);
		if (type === "event") return handleEventHooks(record);
		if (type === "funnel-pre") return handleFunnelPreHooks(record, meta);
		if (type === "everything") return handleEverythingHooks(record, meta);
		return record;
	}
};

export default config;

// ── STORIES (v1.6 verification contract) ──
/*
 * MEASUREMENT DOCTRINE — how these reads stay honest
 *
 * IDENTITY: avgDevicePerUser: 2, but 'account registered' is both
 * isFirstEvent and isAuthEvent, so born users auth on their very first
 * event. The device-map resolve through the profiles' "anonymousIds"
 * pool is belt-and-braces for any device-only edge.
 *
 * CHURN RECOVERY (H4): the churn hook deletes ALL events after
 * firstEvent + 14d for non-early-joiners with any raw sub-60 quiz.
 * Deletion is the ONLY event-removal that touches lectures/quizzes
 * (H3/H7 remove certificates only), so a user's OUTPUT lifespan
 * exceeding 14.5d identifies the not-churned population exactly, and
 * within it output note/speed-lecture counts equal the hook-time
 * counts the treatments keyed on. H3/H8 score reads filter on it.
 *
 * SCORE TREATMENT LEDGER: score_percent is touched by THREE hooks —
 * H3 (x1.3 for 5-8-notes users), H8 (+8 for 3+-fast-lecture users),
 * H2 (-25 on Sun/Mon, runs LAST, hits duplicates too). Every score
 * read excludes Sun/Mon quizzes (removes H2) and conditions on the
 * OTHER treatment's cohort (H3 reads exclude speed learners; H8 reads
 * exclude sweet-notes users), so each knob is read in isolation.
 * Empirical organic score mean is ~40 in these restricted reads (the
 * pool's nominal mean 50 is inflated by the treatments themselves).
 *
 * ORGANIC DIFFICULTY IS NOT UNIFORM: the difficulty pool is a 3-value
 * array but measured organic shares are easy 0.362 / medium 0.287 /
 * hard 0.351 (7+ sigma off uniform — engine-level draw skew).
 * H5 bands derive from the MEASURED organic composition:
 * P(easy|hint) = 0.60 + 0.40 x 0.362 = 0.745; P(hard|no-hint) =
 * 0.40 + 0.60 x 0.351 = 0.610.
 *
 * EMULATOR TTC (H7/H9): 2-step read ['course enrolled','certificate
 * earned'] — the 4-step doc funnel would break because H9's annual
 * x0.5 compression can move a certificate BEFORE the interior
 * quiz-completed step. Window 86.4h = 48h generative x 1.8 free
 * stretch, covering the stretched support. Sensitivity check at 48h:
 * free conversion collapses 0.063 -> 0.002 (censoring confirms the
 * stretch is real); annual/monthly barely move.
 *
 * EXPERIMENT PAIRING (H10): $experiment_started fires BEFORE funnel
 * entry with an arm-dependent lag (the AI arm's ttcMultiplier
 * compresses even the exp->step1 gap), so pairing anchors at the
 * funnel ENTRY: first 'discussion posted' >= exp time, conversion =
 * 'resource downloaded' within 12h of entry with >= 1 'study group
 * joined' strictly between. Organic pollution (partial failed passes
 * completed by organic downloads, ~0.035 base rate — implied
 * consistently by both arms at full fidelity) mildly attenuates the
 * generative 1.4x lift to ~1.37 observed; both arms carry the same
 * pollution so direction is preserved.
 *
 * ACTIVITY COUPLING: certificate counts scale with user activity, so
 * cross-cohort cert reads normalize per enrollment (certs/enrolls),
 * and the H3 volume read carries a pre-cliff flatness precondition.
 */

const ID_CTE = `
us AS (SELECT * FROM read_json_auto('{{PREFIX}}-USERS*.json', sample_size=-1, union_by_name=true)),
dm AS (SELECT unnest("anonymousIds") AS device_id, distinct_id FROM us),
ev AS (SELECT coalesce(m.distinct_id::VARCHAR, e.user_id::VARCHAR, e.device_id::VARCHAR) AS uid,
       e.time::TIMESTAMP AS t, e.*
FROM read_json_auto('{{PREFIX}}-EVENTS*.json', sample_size=-1, union_by_name=true) e
LEFT JOIN dm m ON e.device_id = m.device_id)`;

const PU_CTE = `
pu AS (SELECT e.uid, min(e.t) AS first_t, max(e.t) AS last_t,
  count(*) FILTER (WHERE event = 'lecture completed' AND notes_taken) AS notes,
  count(*) FILTER (WHERE event = 'lecture completed' AND playback_speed >= ${SPEED_FAST_THRESHOLD}) AS fast_lex,
  count(*) FILTER (WHERE event = 'quiz completed') AS quizzes,
  count(*) FILTER (WHERE event = 'certificate earned') AS certs,
  count(*) FILTER (WHERE event = 'course enrolled') AS enrolls,
  count(*) FILTER (WHERE event = 'discussion posted') AS discussions,
  min(CASE WHEN event = 'study group joined' THEN e.t END) AS first_join_t
FROM ev e GROUP BY 1),
puu AS (SELECT p.*, u.subscription_status, u.account_type,
  (p.first_join_t IS NOT NULL AND date_diff('hour', p.first_t, p.first_join_t) <= ${STUDY_GROUP_EARLY_DAYS * 24}) AS early_join,
  (p.last_t > p.first_t + INTERVAL '14 days 12 hours') AS retained
FROM pu p JOIN us u ON p.uid = u.distinct_id::VARCHAR)`;

const cellsOf = (rows, key) => Object.fromEntries((rows || []).map((r) => [r[key], r]));

export const stories = [
	{
		id: "H1-role-profiles",
		hook: "H1",
		archetype: "cohort-prop-scale",
		narrative:
			"Two-sided marketplace: profile pool is 8:1 student (expected instructor share 1/9 = 0.111). " +
			"The user hook stamps role-exclusive attributes (instructors: courses_created/experience/rating; " +
			"students: learning_goal/study_hours) — purity is structural, asserted at 1.0. The everything " +
			"hook also overwrites account_type on 'account registered' events from the profile (the engine " +
			"draws event props independently), so event-level agreement is structural too.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT count(*)::BIGINT AS users,
  count(*) FILTER (WHERE account_type = 'instructor')::DOUBLE / count(*) AS share
FROM us`,
				},
				assert: (rows) => {
					const r = rows?.[0];
					if (!r || Number(r.users) < 5000) {
						return { verdict: "WEAK", detail: `population too small: users=${r?.users ?? 0}` };
					}
					const share = Number(r.share);
					const detail = `instructor share=${share.toFixed(4)} (pool 1/9 = 0.1111; n=${r.users})`;
					if (share >= 0.095 && share <= 0.125) return { verdict: "NAILED", detail };
					if (share >= 0.085 && share <= 0.14) return { verdict: "STRONG", detail };
					return { verdict: "NONE", detail };
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT account_type, count(*)::BIGINT AS users,
  avg(CASE WHEN account_type = 'instructor'
    THEN (courses_created >= 1 AND teaching_experience_years >= 1 AND instructor_rating >= 3
          AND learning_goal = 'none' AND study_hours_per_week = 0)::INT
    ELSE (courses_created = 0 AND instructor_rating = 0 AND learning_goal <> 'none'
          AND study_hours_per_week BETWEEN 2 AND 30)::INT END) AS purity
FROM us GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "account_type");
					const inst = by.instructor, stu = by.student;
					if (!inst || !stu || Number(inst.users) < 500 || Number(stu.users) < 4000) {
						return { verdict: "WEAK", detail: `cohorts too small: inst=${inst?.users ?? 0} stu=${stu?.users ?? 0}` };
					}
					const pi = Number(inst.purity), ps = Number(stu.purity);
					const detail = `role-attribute purity: instructor=${pi.toFixed(4)} (n=${inst.users}) student=${ps.toFixed(4)} (n=${stu.users})`;
					if (pi === 1 && ps === 1) return { verdict: "NAILED", detail };
					if (pi >= 0.995 && ps >= 0.995) return { verdict: "STRONG", detail };
					if (pi >= 0.9 && ps >= 0.9) return { verdict: "WEAK", detail };
					return { verdict: "NONE", detail };
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT count(*)::BIGINT AS n, avg((e.account_type = u.account_type)::INT) AS agree
FROM ev e JOIN us u ON e.uid = u.distinct_id::VARCHAR
WHERE e.event = 'account registered'`,
				},
				assert: (rows) => {
					const r = rows?.[0];
					if (!r || Number(r.n) < 800) {
						return { verdict: "WEAK", detail: `too few 'account registered' events: n=${r?.n ?? 0}` };
					}
					const agree = Number(r.agree);
					const detail = `event-level account_type = profile account_type on ${agree.toFixed(4)} of ${r.n} events (hook-stamped)`;
					if (agree === 1) return { verdict: "NAILED", detail };
					if (agree >= 0.99) return { verdict: "STRONG", detail };
					return { verdict: "NONE", detail };
				},
			},
		],
	},
	{
		id: "H2-deadline-cramming",
		hook: "H2",
		archetype: "bespoke",
		narrative:
			`Sun/Mon 'assignment submitted' events get is_late REDRAWN at ${DEADLINE_LATE_LIKELIHOOD}% ` +
			"(replacing the organic 1-in-5 pool draw, ~20%); Sun/Mon 'quiz completed' scores drop " +
			`${DEADLINE_QUIZ_PENALTY} points, clamped at 0. H2 runs LAST in the everything hook, so the ` +
			"penalty hits H6 duplicates and boosted scores alike — the DOW score DIFFERENCE reads the " +
			"knob minus clamp loss (organic sub-25 scores can't drop the full 25; measured 23.85). " +
			"Bands: rates Sun/Mon [0.56, 0.64] vs rest [0.17, 0.23]; score diff [21.5, 25.5].",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT (dayofweek(t) IN (0, 1)) AS sun_mon, count(*)::BIGINT AS n, avg(is_late::INT) AS late_rate
FROM ev WHERE event = 'assignment submitted' GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "sun_mon");
					const sm = by.true, rest = by.false;
					if (!sm || !rest || Number(sm.n) < 10000 || Number(rest.n) < 25000) {
						return { verdict: "WEAK", detail: `cohorts too small: sunmon=${sm?.n ?? 0} rest=${rest?.n ?? 0}` };
					}
					const rs = Number(sm.late_rate), rr = Number(rest.late_rate);
					const detail = `late rate Sun/Mon=${rs.toFixed(4)} vs rest=${rr.toFixed(4)} (knob ${DEADLINE_LATE_LIKELIHOOD}% vs organic ~20%)`;
					if (rs >= 0.56 && rs <= 0.64 && rr >= 0.17 && rr <= 0.23) return { verdict: "NAILED", detail };
					if (rs >= 0.52 && rs <= 0.68 && rr >= 0.15 && rr <= 0.26) return { verdict: "STRONG", detail };
					if (rs > rr + 0.1) return { verdict: "WEAK", detail };
					return { verdict: rs <= rr ? "INVERSE" : "NONE", detail };
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT CASE WHEN dayofweek(t) IN (0, 1) THEN 'sm' ELSE 'rest' END AS bucket,
  count(*)::BIGINT AS user_count, avg(score_percent) AS score
FROM ev WHERE event = 'quiz completed' GROUP BY 1`,
				},
				select: {
					sm: { where: { bucket: "sm" } },
					rest: { where: { bucket: "rest" } },
				},
				expect: { metric: "rest.score - sm.score", op: "between", target: [21.5, 25.5] },
				minCohort: 10000,
			},
		],
	},
	{
		id: "H3-notes-magic-number",
		hook: "H3",
		archetype: "frequency-sweet-spot",
		narrative:
			`${NOTES_SWEET_MIN}-${NOTES_SWEET_MAX} notes-taken lectures => quiz scores x${NOTES_QUIZ_BOOST} ` +
			`(cap 100) + ${NOTES_BONUS_CERT_LIKELIHOOD}% chance of one bonus cloned certificate; ` +
			`${NOTES_OVER_THRESHOLD}+ notes => ${NOTES_OVER_CERT_DROP_LIKELIHOOD}% of certificates dropped. ` +
			"Score read: retained non-speed-learner users, non-Sun/Mon quizzes (see doctrine ledger) — " +
			"sweet/low ratio reads the knob with mild cap-100 loss at organic mean ~40 (measured 1.309); " +
			"9+-notes scores are untreated, so b9p/low is the placebo [0.92, 1.12]. Volume read follows " +
			"the doc's C-vs-A comparison: certs-per-enrollment 9+/sweet [0.62, 0.78] (measured 0.702 — " +
			"the 0.65 keep knob, mildly diluted by the sweet arm's bonus certs), guarded by sweet/low " +
			"flatness in [0.85, 1.10] (bounds activity-coupling drift).",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${PU_CTE}
SELECT CASE WHEN p.notes BETWEEN ${NOTES_SWEET_MIN} AND ${NOTES_SWEET_MAX} THEN 'sweet'
            WHEN p.notes <= ${NOTES_SWEET_MIN - 1} THEN 'low' END AS bin,
  count(DISTINCT e.uid)::BIGINT AS user_count, avg(e.score_percent) AS score
FROM puu p JOIN ev e ON e.uid = p.uid AND e.event = 'quiz completed'
WHERE p.retained AND p.fast_lex < ${SPEED_LECTURE_COUNT_THRESHOLD}
  AND p.notes <= ${NOTES_SWEET_MAX} AND dayofweek(e.t) NOT IN (0, 1)
GROUP BY 1`,
				},
				select: {
					sweet: { where: { bin: "sweet" } },
					low: { where: { bin: "low" } },
				},
				expect: { metric: "sweet.score / low.score", op: "between", target: [1.20, 1.40] },
				minCohort: 300,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${PU_CTE}
SELECT CASE WHEN p.notes <= ${NOTES_SWEET_MIN - 1} THEN 'low'
            WHEN p.notes BETWEEN ${NOTES_SWEET_MIN} AND ${NOTES_SWEET_MAX} THEN 'sweet'
            ELSE 'over' END AS bin,
  count(*)::BIGINT AS users, sum(p.certs)::DOUBLE / nullif(sum(p.enrolls), 0) AS cpe
FROM puu p WHERE p.retained GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "bin");
					const low = by.low, sweet = by.sweet, over = by.over;
					if (!low || !sweet || !over ||
						Number(low.users) < 500 || Number(sweet.users) < 1200 || Number(over.users) < 1200) {
						return { verdict: "WEAK", detail: `bins too small: low=${low?.users ?? 0} sweet=${sweet?.users ?? 0} over=${over?.users ?? 0}` };
					}
					const flat = Number(sweet.cpe) / Number(low.cpe);
					if (flat < 0.85 || flat > 1.10) {
						return { verdict: "NONE", detail: `flatness precondition failed: sweet/low certs-per-enroll=${flat.toFixed(3)} outside [0.85, 1.10] — activity coupling swamps the read` };
					}
					const keep = Number(over.cpe) / Number(sweet.cpe);
					const detail = `certs-per-enroll over/sweet=${keep.toFixed(4)} (keep knob 0.65; flatness sweet/low=${flat.toFixed(3)}; n=${low.users}/${sweet.users}/${over.users})`;
					if (keep >= 0.62 && keep <= 0.78) return { verdict: "NAILED", detail };
					if (keep >= 0.55 && keep <= 0.86) return { verdict: "STRONG", detail };
					if (keep < 0.95) return { verdict: "WEAK", detail };
					return { verdict: keep >= 1 ? "INVERSE" : "NONE", detail };
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${PU_CTE}
SELECT CASE WHEN p.notes >= ${NOTES_OVER_THRESHOLD} THEN 'over'
            WHEN p.notes <= ${NOTES_SWEET_MIN - 1} THEN 'low' END AS bin,
  count(DISTINCT e.uid)::BIGINT AS user_count, avg(e.score_percent) AS score
FROM puu p JOIN ev e ON e.uid = p.uid AND e.event = 'quiz completed'
WHERE p.retained AND p.fast_lex < ${SPEED_LECTURE_COUNT_THRESHOLD}
  AND (p.notes >= ${NOTES_OVER_THRESHOLD} OR p.notes <= ${NOTES_SWEET_MIN - 1})
  AND dayofweek(e.t) NOT IN (0, 1)
GROUP BY 1`,
				},
				select: {
					over: { where: { bin: "over" } },
					low: { where: { bin: "low" } },
				},
				expect: { metric: "over.score / low.score", op: "between", target: [0.92, 1.12] },
				minCohort: 250,
			},
		],
	},
	{
		id: "H4-study-group-retention",
		hook: "H4",
		archetype: "retention-divergence",
		narrative:
			`Non-early-joiners (no 'study group joined' within ${STUDY_GROUP_EARLY_DAYS}d of first event) ` +
			`with ANY raw sub-${STUDY_GROUP_LOW_QUIZ_THRESHOLD} quiz lose ALL events after day ` +
			`${STUDY_GROUP_CHURN_CUTOFF_DAYS} — and at organic score mean ~40, virtually every quizzing ` +
			"non-joiner qualifies, so the divergence is near-deterministic: early-joiner D14+ activity " +
			">= 0.98 vs non-joiner <= 0.03 (measured 0.9988 vs 0.0057). Restricted to users with >= 20d " +
			"of possible tenure (first event >= 20d before dataset end) so short-tenure users can't " +
			"dilute either arm. Early joiners also get one cloned discussion at " +
			`${STUDY_GROUP_DISCUSSION_CLONE_LIKELIHOOD}%, but the discussion-volume gap is dominated by ` +
			"the churn truncation itself: early/non ratio [13, 25] (measured 18.2).",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${PU_CTE}
SELECT early_join, count(*)::BIGINT AS users, avg(retained::INT) AS retention, avg(discussions) AS dpu
FROM puu WHERE first_t <= (SELECT max(t) - INTERVAL 20 DAY FROM ev)
GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "early_join");
					const early = by.true, non = by.false;
					if (!early || !non || Number(early.users) < 2000 || Number(non.users) < 2500) {
						return { verdict: "WEAK", detail: `cohorts too small: early=${early?.users ?? 0} non=${non?.users ?? 0}` };
					}
					const re = Number(early.retention), rn = Number(non.retention);
					const detail = `D14+ activity: early-join=${re.toFixed(4)} (n=${early.users}) vs non=${rn.toFixed(4)} (n=${non.users})`;
					if (re >= 0.98 && rn <= 0.03) return { verdict: "NAILED", detail };
					if (re >= 0.95 && rn <= 0.06) return { verdict: "STRONG", detail };
					if (re > rn + 0.3) return { verdict: "WEAK", detail };
					return { verdict: re <= rn ? "INVERSE" : "NONE", detail };
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${PU_CTE}
SELECT early_join, count(*)::BIGINT AS users, avg(discussions) AS dpu
FROM puu WHERE first_t <= (SELECT max(t) - INTERVAL 20 DAY FROM ev)
GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "early_join");
					const early = by.true, non = by.false;
					if (!early || !non || Number(early.users) < 2000 || Number(non.users) < 2500) {
						return { verdict: "WEAK", detail: `cohorts too small: early=${early?.users ?? 0} non=${non?.users ?? 0}` };
					}
					const ratio = Number(early.dpu) / Number(non.dpu);
					const detail = `discussions per user early/non=${ratio.toFixed(2)} (${Number(early.dpu).toFixed(2)} vs ${Number(non.dpu).toFixed(2)}; churn truncation + ${STUDY_GROUP_DISCUSSION_CLONE_LIKELIHOOD}% clone)`;
					if (ratio >= 13 && ratio <= 25) return { verdict: "NAILED", detail };
					if (ratio >= 8 && ratio <= 32) return { verdict: "STRONG", detail };
					if (ratio > 2) return { verdict: "WEAK", detail };
					return { verdict: ratio <= 1 ? "INVERSE" : "NONE", detail };
				},
			},
		],
	},
	{
		id: "H5-hint-dependency",
		hook: "H5",
		archetype: "cohort-prop-scale",
		narrative:
			`hint_used=true problems get difficulty forced to 'easy' at ${HINT_EASY_LIKELIHOOD}%; ` +
			`hint_used=false forced to 'hard' at ${HINT_HARD_LIKELIHOOD}%. Bands derive from the MEASURED ` +
			"organic composition (easy 0.362 / hard 0.351 — the engine's pool draw is not uniform, see " +
			"doctrine): P(easy|hint) = 0.60 + 0.40 x 0.362 = 0.745, band [0.71, 0.77]; P(hard|no-hint) " +
			"= 0.40 + 0.60 x 0.351 = 0.610, band [0.58, 0.64]. The v1.5 doc quoted the raw knobs " +
			"(60%/40%) — those ignore the unforced organic remainder.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT hint_used, count(*)::BIGINT AS user_count, avg((difficulty = 'easy')::INT) AS p_easy
FROM ev WHERE event = 'practice problem solved' GROUP BY 1`,
				},
				select: {
					hint: { where: { hint_used: true } },
				},
				expect: { metric: "hint.p_easy", op: "between", target: [0.71, 0.77] },
				minCohort: 15000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT hint_used, count(*)::BIGINT AS user_count, avg((difficulty = 'hard')::INT) AS p_hard
FROM ev WHERE event = 'practice problem solved' GROUP BY 1`,
				},
				select: {
					nohint: { where: { hint_used: false } },
				},
				expect: { metric: "nohint.p_hard", op: "between", target: [0.58, 0.64] },
				minCohort: 30000,
			},
		],
	},
	{
		id: "H6-semester-spike",
		hook: "H6",
		archetype: "temporal-inflection",
		narrative:
			`Days ${SEMESTER_SPIKE_START_DAY}-${SEMESTER_SPIKE_END_DAY} (from dataset start): quiz started / ` +
			`quiz completed / assignment submitted duplicated at ${SEMESTER_SPIKE_LIKELIHOOD}% => x1.8 volume. ` +
			"The hook's continuous day-index window [75.0, 85.0] fully treats calendar days 75-84 (day 85 " +
			"is a measure-zero boundary), so the read uses days 75-84 vs flanks 60-74 + 85-100. Duplicates " +
			"of churned users die with their originals (H4 deletes post-cutoff wholesale), preserving the " +
			"ratio. Spikable window/flank [1.70, 2.02] (measured 1.862 = 1.8 x mild organic drift); " +
			"non-spikable placebo [0.95, 1.20] (measured 1.085 — organic mid-dataset ramp).",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
d AS (SELECT date_diff('day', (SELECT min(t)::DATE FROM ev), t::DATE) AS day_idx
FROM ev WHERE event IN ('quiz started', 'quiz completed', 'assignment submitted'))
SELECT CASE WHEN day_idx BETWEEN ${SEMESTER_SPIKE_START_DAY} AND ${SEMESTER_SPIKE_END_DAY - 1} THEN 'window'
            WHEN day_idx BETWEEN 60 AND ${SEMESTER_SPIKE_START_DAY - 1} OR day_idx BETWEEN ${SEMESTER_SPIKE_END_DAY} AND 100 THEN 'flank' END AS zone,
  count(*)::BIGINT AS user_count, count(*)::DOUBLE / count(DISTINCT day_idx) AS per_day
FROM d WHERE day_idx BETWEEN 60 AND 100 GROUP BY 1`,
				},
				select: {
					win: { where: { zone: "window" } },
					flank: { where: { zone: "flank" } },
				},
				expect: { metric: "win.per_day / flank.per_day", op: "between", target: [1.70, 2.02] },
				minCohort: 15000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
d AS (SELECT date_diff('day', (SELECT min(t)::DATE FROM ev), t::DATE) AS day_idx
FROM ev WHERE event NOT IN ('quiz started', 'quiz completed', 'assignment submitted'))
SELECT CASE WHEN day_idx BETWEEN ${SEMESTER_SPIKE_START_DAY} AND ${SEMESTER_SPIKE_END_DAY - 1} THEN 'window'
            WHEN day_idx BETWEEN 60 AND ${SEMESTER_SPIKE_START_DAY - 1} OR day_idx BETWEEN ${SEMESTER_SPIKE_END_DAY} AND 100 THEN 'flank' END AS zone,
  count(*)::BIGINT AS user_count, count(*)::DOUBLE / count(DISTINCT day_idx) AS per_day
FROM d WHERE day_idx BETWEEN 60 AND 100 GROUP BY 1`,
				},
				select: {
					win: { where: { zone: "window" } },
					flank: { where: { zone: "flank" } },
				},
				expect: { metric: "win.per_day / flank.per_day", op: "between", target: [0.95, 1.20] },
				minCohort: 30000,
			},
		],
	},
	{
		id: "H7-free-vs-paid",
		hook: "H7",
		archetype: "funnel-conversion-by-segment",
		narrative:
			`Cert-funnel conversion gated x${FREE_FUNNEL_CONV_FACTOR} for free / x${PAID_FUNNEL_CONV_FACTOR} ` +
			`for paid (funnel-pre), THEN free users lose ${FREE_CERT_DROP_LIKELIHOOD}% of certificates ` +
			"(everything). The two treatments compound: 3x conversion gap x 1/0.45 drop survival = 6.67x. " +
			"The emulator funnel read measures the compound directly (6.73 at full fidelity); the " +
			"certs-per-enrollment read is diluted by standalone (non-funnel) certs (6.04). " +
			"annual vs monthly is the placebo: " +
			"both arms get identical conversion treatment and keep all certs (H9 moves times, not counts) " +
			"=> certs-per-enrollment ratio [0.88, 1.20].",
		assertions: [
			{
				breakdown: {
					type: "timeToConvert",
					steps: ["course enrolled", "certificate earned"],
					breakdownByUserProperty: "subscription_status",
					conversionWindowMs: Math.round(48 * TTC_FREE_FACTOR * 3600 * 1000),
				},
				assert: (rows) => {
					const by = cellsOf(rows, "segment_value");
					const mon = by.monthly, free = by.free;
					const monAtt = Number(mon?.step_counts?.[0] ?? 0), freeAtt = Number(free?.step_counts?.[0] ?? 0);
					if (monAtt < 800 || freeAtt < 2500) {
						return { verdict: "WEAK", detail: `attempt cohorts too small: monthly=${monAtt} free=${freeAtt}` };
					}
					const convM = Number(mon.step_counts[1]) / monAtt;
					const convF = Number(free.step_counts[1]) / freeAtt;
					const ratio = convM / convF;
					// band centers on the mechanism compound 3 x 1/0.45 = 6.67, NOT on the
					// 2K iteration point (5.6) — that measurement had free attempts below
					// this assertion's own guard and was noisy-low
					const detail = `emulator 86.4h conv monthly=${convM.toFixed(4)} free=${convF.toFixed(4)} ratio=${ratio.toFixed(2)} (attempts ${monAtt}/${freeAtt}; mechanism 6.67)`;
					// Fix-round Q5 (S2): this band moved [4.6, 6.6] → [5.7, 7.7] after
					// the full-fidelity run (observed 6.73). The re-derivation above is
					// real knob math — but a band produced with the observation in hand
					// cannot claim NAILED this round. Verdict capped at STRONG inside
					// the knob band; NAILED eligibility returns when the band is
					// pre-registered ahead of a fresh full-fidelity run.
					if (ratio >= 5.7 && ratio <= 7.7) return { verdict: "STRONG", detail: `${detail} — capped (S2: band re-derived post-output)` };
					if (ratio >= 4.7 && ratio <= 8.7) return { verdict: "STRONG", detail };
					if (ratio > 1.5) return { verdict: "WEAK", detail };
					return { verdict: ratio <= 1 ? "INVERSE" : "NONE", detail };
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${PU_CTE}
SELECT subscription_status, count(*)::BIGINT AS user_count,
  sum(certs)::DOUBLE / nullif(sum(enrolls), 0) AS cpe
FROM puu GROUP BY 1`,
				},
				select: {
					mon: { where: { subscription_status: "monthly" } },
					free: { where: { subscription_status: "free" } },
				},
				expect: { metric: "mon.cpe / free.cpe", op: "between", target: [4.8, 6.5] },
				minCohort: 1500,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${PU_CTE}
SELECT subscription_status, count(*)::BIGINT AS user_count,
  sum(certs)::DOUBLE / nullif(sum(enrolls), 0) AS cpe
FROM puu GROUP BY 1`,
				},
				select: {
					ann: { where: { subscription_status: "annual" } },
					mon: { where: { subscription_status: "monthly" } },
				},
				expect: { metric: "ann.cpe / mon.cpe", op: "between", target: [0.88, 1.20] },
				minCohort: 1500,
			},
		],
	},
	{
		id: "H8-playback-speed",
		hook: "H8",
		archetype: "cohort-prop-scale",
		narrative:
			`'lecture completed' at speed >= ${SPEED_FAST_THRESHOLD}: watch_time x${SPEED_FAST_WATCH_FACTOR} ` +
			`(floor ${SPEED_FAST_WATCH_MIN}); at speed <= ${SPEED_SLOW_THRESHOLD}: x${SPEED_SLOW_WATCH_FACTOR} ` +
			`(cap ${SPEED_SLOW_WATCH_MAX} — never binds: organic max 60 x 1.4 = 84). Mid speeds (1.25/1.5) ` +
			"are untreated: fast/mid reads the knob at [0.55, 0.62] (Math.floor costs ~2%), slow/mid at " +
			`[1.33, 1.46]. Users with ${SPEED_LECTURE_COUNT_THRESHOLD}+ fast lectures also get quiz scores ` +
			`+${SPEED_QUIZ_BOOST_POINTS} (cap 100): read as a DIFFERENCE among retained non-sweet-notes ` +
			"users on non-Sun/Mon quizzes (doctrine ledger) — band [7.0, 10.4] (measured +8.76; the point " +
			"boost sits on a ~40-mean score, so cap loss is negligible).",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT CASE WHEN playback_speed >= ${SPEED_FAST_THRESHOLD} THEN 'fast'
            WHEN playback_speed <= ${SPEED_SLOW_THRESHOLD} THEN 'slow' ELSE 'mid' END AS bucket,
  count(*)::BIGINT AS user_count, avg(watch_time_mins) AS watch
FROM ev WHERE event = 'lecture completed' GROUP BY 1`,
				},
				select: {
					fast: { where: { bucket: "fast" } },
					mid: { where: { bucket: "mid" } },
				},
				expect: { metric: "fast.watch / mid.watch", op: "between", target: [0.55, 0.62] },
				minCohort: 10000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT CASE WHEN playback_speed >= ${SPEED_FAST_THRESHOLD} THEN 'fast'
            WHEN playback_speed <= ${SPEED_SLOW_THRESHOLD} THEN 'slow' ELSE 'mid' END AS bucket,
  count(*)::BIGINT AS user_count, avg(watch_time_mins) AS watch
FROM ev WHERE event = 'lecture completed' GROUP BY 1`,
				},
				select: {
					slow: { where: { bucket: "slow" } },
					mid: { where: { bucket: "mid" } },
				},
				expect: { metric: "slow.watch / mid.watch", op: "between", target: [1.33, 1.46] },
				minCohort: 10000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${PU_CTE}
SELECT (p.fast_lex >= ${SPEED_LECTURE_COUNT_THRESHOLD}) AS speedy,
  count(DISTINCT e.uid)::BIGINT AS user_count, avg(e.score_percent) AS score
FROM puu p JOIN ev e ON e.uid = p.uid AND e.event = 'quiz completed'
WHERE p.retained AND p.notes NOT BETWEEN ${NOTES_SWEET_MIN} AND ${NOTES_SWEET_MAX}
  AND dayofweek(e.t) NOT IN (0, 1)
GROUP BY 1`,
				},
				select: {
					spd: { where: { speedy: true } },
					rest: { where: { speedy: false } },
				},
				expect: { metric: "spd.score - rest.score", op: "between", target: [7.0, 10.4] },
				minCohort: 500,
			},
		],
	},
	{
		id: "H9-completion-ttc",
		hook: "H9",
		archetype: "funnel-ttc-by-segment",
		narrative:
			`The everything hook rescales each certificate's gap to its nearest preceding enrollment: ` +
			`annual x${TTC_ANNUAL_FACTOR}, free x${TTC_FREE_FACTOR} (monthly untouched). Read through the ` +
			"emulator's 2-step timeToConvert ['course enrolled' -> 'certificate earned'] at 86.4h " +
			`(48h generative x ${TTC_FREE_FACTOR} — covers the stretched free support; at 48h the free arm ` +
			"censors to ~nothing, see doctrine). Median TTC ratios read the knobs almost exactly: " +
			"free/monthly [1.65, 2.00] (measured 1.834, knob 1.8); annual/monthly [0.44, 0.57] " +
			"(measured 0.505, knob 0.5).",
		assertions: [
			{
				breakdown: {
					type: "timeToConvert",
					steps: ["course enrolled", "certificate earned"],
					breakdownByUserProperty: "subscription_status",
					conversionWindowMs: Math.round(48 * TTC_FREE_FACTOR * 3600 * 1000),
				},
				assert: (rows) => {
					const by = cellsOf(rows, "segment_value");
					const free = by.free, mon = by.monthly;
					const fc = Number(free?.user_count ?? 0), mc = Number(mon?.user_count ?? 0);
					if (fc < 150 || mc < 400) {
						return { verdict: "WEAK", detail: `converter cohorts too small: free=${fc} monthly=${mc}` };
					}
					const ratio = Number(free.median_ttc_ms) / Number(mon.median_ttc_ms);
					const detail = `median TTC free/monthly=${ratio.toFixed(3)} (knob ${TTC_FREE_FACTOR}; converters ${fc}/${mc})`;
					if (ratio >= 1.65 && ratio <= 2.00) return { verdict: "NAILED", detail };
					if (ratio >= 1.45 && ratio <= 2.20) return { verdict: "STRONG", detail };
					if (ratio > 1.15) return { verdict: "WEAK", detail };
					return { verdict: ratio <= 1 ? "INVERSE" : "NONE", detail };
				},
			},
			{
				breakdown: {
					type: "timeToConvert",
					steps: ["course enrolled", "certificate earned"],
					breakdownByUserProperty: "subscription_status",
					conversionWindowMs: Math.round(48 * TTC_FREE_FACTOR * 3600 * 1000),
				},
				assert: (rows) => {
					const by = cellsOf(rows, "segment_value");
					const ann = by.annual, mon = by.monthly;
					const ac = Number(ann?.user_count ?? 0), mc = Number(mon?.user_count ?? 0);
					if (ac < 400 || mc < 400) {
						return { verdict: "WEAK", detail: `converter cohorts too small: annual=${ac} monthly=${mc}` };
					}
					const ratio = Number(ann.median_ttc_ms) / Number(mon.median_ttc_ms);
					const detail = `median TTC annual/monthly=${ratio.toFixed(3)} (knob ${TTC_ANNUAL_FACTOR}; converters ${ac}/${mc})`;
					if (ratio >= 0.44 && ratio <= 0.57) return { verdict: "NAILED", detail };
					if (ratio >= 0.38 && ratio <= 0.66) return { verdict: "STRONG", detail };
					if (ratio < 0.85) return { verdict: "WEAK", detail };
					return { verdict: ratio >= 1 ? "INVERSE" : "NONE", detail };
				},
			},
		],
	},
	{
		id: "H10-ai-study-buddy",
		hook: "H10",
		archetype: "experiment-lift",
		narrative:
			"'AI Study Buddy' A/B on the Social Learning funnel (last 30 days): conversionMultiplier 1.4 " +
			"(50% -> 70% generative), ttcMultiplier 0.85. Strict pairing anchors at funnel ENTRY (first " +
			"'discussion posted' at/after $experiment_started — the exp event fires before entry with an " +
			"arm-dependent lag), conversion = 'resource downloaded' within 12h of entry with a 'study " +
			"group joined' strictly between. Organic pollution (p ~ 0.035, consistent across both arms' " +
			"implied rates at full fidelity) attenuates the generative lift to (0.70+0.30p)/(0.50+0.50p) " +
			"~ 1.37 observed; paired median TTC reads the ttcMultiplier at [0.78, 0.92] (measured 0.857, " +
			"knob 0.85).",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
exp AS (SELECT uid, t, "Variant name" AS variant FROM ev WHERE event = '$experiment_started'),
a AS (SELECT exp.uid, exp.variant, exp.t,
  (SELECT min(x.t) FROM ev x WHERE x.uid = exp.uid AND x.event = 'discussion posted'
   AND x.t >= exp.t - INTERVAL 1 MINUTE) AS s1
FROM exp),
c AS (SELECT a.*, (
    SELECT min(r.t) FROM ev r
    WHERE r.uid = a.uid AND r.event = 'resource downloaded'
      AND r.t > a.s1 AND r.t <= a.s1 + INTERVAL 12 HOUR
      AND EXISTS (SELECT 1 FROM ev s WHERE s.uid = a.uid AND s.event = 'study group joined'
                  AND s.t > a.s1 AND s.t < r.t)
  ) AS conv_t
FROM a WHERE a.s1 IS NOT NULL AND a.s1 <= a.t + INTERVAL 24 HOUR)
SELECT variant, count(*)::BIGINT AS attempts, count(conv_t)::BIGINT AS conv,
  count(conv_t)::DOUBLE / count(*) AS rate,
  median(date_diff('minute', s1, conv_t)) AS med_ttc_min
FROM c GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "variant");
					const ai = by["AI Study Buddy"], ctl = by.Control;
					const aa = Number(ai?.attempts ?? 0), ca = Number(ctl?.attempts ?? 0);
					if (aa < 400 || ca < 400) {
						return { verdict: "WEAK", detail: `attempt cohorts too small: ai=${aa} control=${ca}` };
					}
					const split = aa / (aa + ca);
					if (split < 0.40 || split > 0.60) {
						return { verdict: "NONE", detail: `variant split broken: AI share=${split.toFixed(3)}` };
					}
					const lift = Number(ai.rate) / Number(ctl.rate);
					// band spans the pollution-attenuated mechanism for p in [0, 0.15]:
					// lift = (0.70+0.30p)/(0.50+0.50p) in [1.30, 1.40], +/- sampling noise.
					// The 2K iteration point (1.25, implied p 0.14) came from attempt
					// counts below this assertion's own guard; full-fidelity implied
					// pollution is ~0.035 from both arms independently
					const detail = `strict-paired conv AI=${Number(ai.rate).toFixed(4)} Control=${Number(ctl.rate).toFixed(4)} lift=${lift.toFixed(3)} (attempts ${aa}/${ca}; generative 1.4 minus pollution)`;
					// Fix-round Q5 (S2): this band moved [1.14, 1.37] → [1.20, 1.45]
					// after the full-fidelity run (observed 1.377). The pollution math
					// above is real knob math — but a band produced with the observation
					// in hand cannot claim NAILED this round. Verdict capped at STRONG
					// inside the knob band; NAILED eligibility returns when the band is
					// pre-registered ahead of a fresh full-fidelity run.
					if (lift >= 1.20 && lift <= 1.45) return { verdict: "STRONG", detail: `${detail} — capped (S2: band re-derived post-output)` };
					if (lift >= 1.08 && lift <= 1.55) return { verdict: "STRONG", detail };
					if (lift > 1.0) return { verdict: "WEAK", detail };
					return { verdict: "INVERSE", detail };
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
exp AS (SELECT uid, t, "Variant name" AS variant FROM ev WHERE event = '$experiment_started'),
a AS (SELECT exp.uid, exp.variant, exp.t,
  (SELECT min(x.t) FROM ev x WHERE x.uid = exp.uid AND x.event = 'discussion posted'
   AND x.t >= exp.t - INTERVAL 1 MINUTE) AS s1
FROM exp),
c AS (SELECT a.*, (
    SELECT min(r.t) FROM ev r
    WHERE r.uid = a.uid AND r.event = 'resource downloaded'
      AND r.t > a.s1 AND r.t <= a.s1 + INTERVAL 12 HOUR
      AND EXISTS (SELECT 1 FROM ev s WHERE s.uid = a.uid AND s.event = 'study group joined'
                  AND s.t > a.s1 AND s.t < r.t)
  ) AS conv_t
FROM a WHERE a.s1 IS NOT NULL AND a.s1 <= a.t + INTERVAL 24 HOUR)
SELECT variant, count(conv_t)::BIGINT AS conv,
  median(date_diff('minute', s1, conv_t)) AS med_ttc_min
FROM c GROUP BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "variant");
					const ai = by["AI Study Buddy"], ctl = by.Control;
					const ac = Number(ai?.conv ?? 0), cc = Number(ctl?.conv ?? 0);
					if (ac < 250 || cc < 250) {
						return { verdict: "WEAK", detail: `converter cohorts too small: ai=${ac} control=${cc}` };
					}
					const ratio = Number(ai.med_ttc_min) / Number(ctl.med_ttc_min);
					const detail = `paired median TTC AI/Control=${ratio.toFixed(3)} (knob 0.85; converters ${ac}/${cc})`;
					if (ratio >= 0.78 && ratio <= 0.92) return { verdict: "NAILED", detail };
					if (ratio >= 0.70 && ratio <= 0.99) return { verdict: "STRONG", detail };
					if (ratio < 1.05) return { verdict: "WEAK", detail };
					return { verdict: "INVERSE", detail };
				},
			},
		],
	},
];
