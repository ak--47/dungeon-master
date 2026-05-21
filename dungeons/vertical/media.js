// ── IMPORTS ──
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);
import "dotenv/config";
import * as u from "../../lib/utils/utils.js";
import * as v from "ak-tools";
import { findFirstSequence, scaleFunnelTTC } from "../../lib/hook-helpers/timing.js";
/** @typedef  {import("../../types").Dungeon} Config */

// ── OVERVIEW ──
/*
 * NAME:       StreamVault
 * APP:        Netflix/Hulu-style video streaming platform. Users browse a
 *             catalog of movies, series, documentaries and specials, manage
 *             watchlists, watch with configurable quality/subtitle/speed,
 *             rate and share content, and switch household profiles (main,
 *             kids, partner, guest) under a single account.
 * SCALE:      10,000 users, ~600K events, 121 days (2026-01-01 → 2026-05-01)
 * CORE LOOP:  account created → content browsed → content selected → playback started → playback completed
 *
 * EVENTS (17):
 *   content browsed (20) > playback started (18) > content selected (15)
 *   > playback completed (12) > playback paused (10) > recommendation clicked (9)
 *   > watchlist added (8) > ad impression (8) > search performed (7)
 *   > content rated (6) > download started (5) > profile switched (4)
 *   > subtitle toggled (4) > watchlist removed (3) > share content (3)
 *   > subscription changed (2) > account created (1)
 *
 * FUNNELS (9):
 *   - Account to Playback:   account created → content browsed → playback started (80%)
 *   - Core Viewing Loop:     content browsed → content selected → playback started → playback completed (55%)
 *   - Recommendation Driven: recommendation clicked → playback started → playback completed → content rated (35%)
 *   - Search Discovery:      search performed → content selected → playback started (50%)
 *   - Watchlist Management:  content browsed → watchlist added → content selected → playback started (40%)
 *   - Profile + Subtitle:    profile switched → subtitle toggled → playback started → playback completed (45%)
 *   - Ad Experience:         ad impression → playback started → playback paused (60%)
 *   - Share + Download:      playback completed → share content → download started (25%)
 *   - Subscription Change:   content browsed → subscription changed (15%)
 *
 * USER PROPS:  preferred_genre, avg_session_duration_min, total_watch_hours, profiles_count, downloads_enabled, subscription_plan, device_type
 * SUPER PROPS: subscription_plan, device_type
 * SCD PROPS:   subscription_plan (free/basic/standard/premium, monthly fuzzy, max 6)
 * GROUPS:      none
 */

// ── HOOK STORIES ──
/*
 * NOTE: All cohort effects are HIDDEN — discoverable only via behavioral cohorts
 * (count an event per user, then measure downstream). No cohort flag is stamped
 * on events. Time-window patterns mutate config-defined props or drop events.
 *
 * ───────────────────────────────────────────────────────────────────────────────
 * 1. GENRE FUNNEL CONVERSION (everything)
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: 25% of "playback completed" events on documentary genre are dropped,
 * depressing the documentary funnel completion rate. No flag — discover via
 * funnel breakdown by genre.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Discovery Funnel by Genre
 *   - Report type: Funnels
 *   - Steps: "content browsed" -> "content selected" -> "playback started" -> "playback completed"
 *   - Breakdown: "genre"
 *   - Expected: documentary ~ 0.7x conversion vs other genres
 *
 * REAL-WORLD ANALOGUE: Heavier content gets started but abandoned more often
 * than light comedy or animation.
 *
 * ───────────────────────────────────────────────────────────────────────────────
 * 2. BINGE-WATCHING PATTERN (everything)
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: Users with 3+ consecutive playback-completed events get extra
 * cloned playback-started + playback-completed pairs (with unique offset
 * timestamps). 60% of their pause events are dropped. No flag — discover by
 * binning users on completion-streak length and comparing per-user completions.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Completions per User by Streak Cohort
 *   - Report type: Insights (with cohort)
 *   - Cohort A: users with >= 3 consecutive "playback completed"
 *   - Cohort B: rest
 *   - Event: "playback completed"
 *   - Measure: Total per user
 *   - Expected: A ~ 1.5x more completions per user
 *
 * REAL-WORLD ANALOGUE: Autoplay and cliffhangers push hooked viewers through
 * entire seasons in a sitting.
 *
 * ───────────────────────────────────────────────────────────────────────────────
 * 3. WEEKEND VS WEEKDAY PATTERNS (everything)
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: Saturday/Sunday "playback completed" events get watch_duration_min
 * boosted 1.5x. Mutates the existing watch_duration_min prop. No flag —
 * discover via day-of-week breakdown.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Avg Watch Duration by Day of Week
 *   - Report type: Insights
 *   - Event: "playback completed"
 *   - Measure: Average of "watch_duration_min"
 *   - Breakdown: Day of week
 *   - Expected: Sat/Sun ~ 1.5x weekday avg
 *
 * REAL-WORLD ANALOGUE: Weekend viewing stretches into multi-hour marathons.
 *
 * ───────────────────────────────────────────────────────────────────────────────
 * 4. AD FATIGUE CHURN (everything)
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: Users with 5+ ad impressions in first 45 days lose 95% of events
 * after day 45 of their lifecycle. Applies to all tiers (not just free).
 * No flag — discover via cohort retention. The very high drop rate overcomes
 * the inherent ~3x activity confound (heavy-ad users are naturally much more
 * active). Runs last in the hook chain so event-adding hooks (binge-watching,
 * subtitle) can't re-inflate the post-d45 count.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Retention by Ad Exposure Cohort
 *   - Report type: Retention
 *   - Cohort A: users with >= 5 "ad impression" in first 45 days
 *   - Cohort B: users with < 5 ads
 *   - Expected: heavy_ad avg_post_d45_events < light_ad
 *
 * REAL-WORLD ANALOGUE: Ad-supported tiers carry a tolerance ceiling.
 *
 * ───────────────────────────────────────────────────────────────────────────────
 * 5. NEW RELEASE SPIKE (event)
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: Days 50-65, 20% of "content selected" / "playback started" events
 * have content_id swapped to the blockbuster id and content_type to "movie".
 * 20% of "content rated" in the window get a 4-5 star rating on the blockbuster.
 * Mutates existing props — no flag.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Selections by content_id Over Time
 *   - Report type: Insights
 *   - Event: "content selected"
 *   - Measure: Total
 *   - Filter: content_id = "<blockbuster id>"
 *   - Line chart by day
 *   - Expected: zero before day 50, ~ 20% of selections days 50-65
 *
 * REAL-WORLD ANALOGUE: Tentpole releases dominate traffic.
 *
 * ───────────────────────────────────────────────────────────────────────────────
 * 6. KIDS PROFILE SAFETY (event)
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: 15% of "content selected" / "playback started" events get genre
 * restricted to "animation" or "documentary". Mutates the existing genre prop.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Genre Distribution Over Time
 *   - Report type: Insights
 *   - Event: "content selected"
 *   - Measure: Total
 *   - Breakdown: "genre"
 *   - Expected: animation + documentary share is elevated above pure random
 *
 * REAL-WORLD ANALOGUE: Kids profiles enforce age-appropriate content.
 *
 * ───────────────────────────────────────────────────────────────────────────────
 * 7. RECOMMENDATION ENGINE IMPROVEMENT (everything)
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: Pre-day-60 "content rated" events get 30% dropped, depressing the
 * recommendation funnel conversion in the first 60 days. No flag — discover
 * via funnel/insights line chart by day.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Content Rated Volume Over Time
 *   - Report type: Insights
 *   - Event: "content rated"
 *   - Measure: Total
 *   - Line chart by day
 *   - Expected: visible step-up at day 60
 *
 *   Report 2: Recommendation Funnel Conversion Over Time
 *   - Report type: Funnels
 *   - Steps: "recommendation clicked" -> "playback started" -> "content rated"
 *   - Compare date ranges (days 0-59 vs 60-100)
 *   - Expected: post-improvement window ~ 1.5x conversion
 *
 * REAL-WORLD ANALOGUE: Rec model upgrades produce a step-change in CTR.
 *
 * ───────────────────────────────────────────────────────────────────────────────
 * 8. SUBTITLE USERS WATCH MORE (everything)
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: Users who toggle subtitles enabled get 1.25x completion_percent
 * (cap 100), 1.15x watch_duration_min, plus 20% extra cloned playback-completed
 * events. No flag — discover via cohort builder on subtitle-toggled-enabled.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Completion by Subtitle Cohort
 *   - Report type: Insights (with cohort)
 *   - Cohort A: users with >= 1 "subtitle toggled" with action="enabled"
 *   - Cohort B: rest
 *   - Event: "playback completed"
 *   - Measure: Average of "completion_percent"
 *   - Expected: A ~ 85% vs B ~ 68%
 *
 * REAL-WORLD ANALOGUE: Subtitle adoption correlates with attentive viewers.
 *
 * ───────────────────────────────────────────────────────────────────────────────
 * 9. RECOMMENDATION-CLICKED MAGIC NUMBER (everything)
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: Users in the 4-6 recommendation-clicked sweet spot get 1.25x
 * watch_duration_min on playback-completed events. Users with 7+ rec clicks
 * are over-engaged (decision fatigue); watch_duration_min is halved and 55%
 * of their playback-completed events are dropped. The aggressive suppression
 * overcomes the inherent engagement confound. No flag — discover by binning
 * users on rec-click count.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Avg Watch Duration by Rec-Click Bucket
 *   - Report type: Insights (with cohort)
 *   - Cohort A: users with 4-6 "recommendation clicked"
 *   - Cohort B: users with 0-3 "recommendation clicked"
 *   - Event: "playback completed"
 *   - Measure: Average of "watch_duration_min"
 *   - Expected: A ~ 1.25x B
 *
 *   Report 2: Completions per User on Heavy Rec Clickers
 *   - Report type: Insights (with cohort)
 *   - Cohort C: users with >= 7 "recommendation clicked"
 *   - Cohort A: users with 4-6
 *   - Event: "playback completed"
 *   - Measure: Average of "watch_duration_min"
 *   - Expected: C (over) has lower avg watch_duration_min than A (sweet)
 *
 * REAL-WORLD ANALOGUE: A few good recs surface a watchworthy title; too many
 * clicks signals indecision and drives abandonment.
 *
 * ───────────────────────────────────────────────────────────────────────────────
 * 10. CORE VIEWING LOOP — SUBSCRIPTION PLAN PROPERTY SCALING (everything)
 * ───────────────────────────────────────────────────────────────────────────────
 *
 * PATTERN: Premium subscribers have 0.67x watch_duration_min on "playback
 * completed" (efficient viewers), free users have 1.4x (lingering viewers).
 * Scales the existing watch_duration_min property — no flag. Applied BEFORE
 * weekend/subtitle/rec-click hooks so each subsequent effect amplifies from
 * the plan-adjusted base.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Avg Watch Duration by Subscription Plan
 *   - Report type: Insights
 *   - Event: "playback completed"
 *   - Measure: Average of "watch_duration_min"
 *   - Breakdown: "subscription_plan"
 *   - Expected: premium < standard < free, free/premium ratio >= 2x
 *
 * REAL-WORLD ANALOGUE: Premium subscribers binge curated content efficiently;
 * free-tier users browse and linger with ad interruptions.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * EXPECTED METRICS SUMMARY
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Hook                     | Metric                  | Baseline | Hook Effect | Ratio
 * ─────────────────────────|─────────────────────────|----------|-------------|------
 * Genre Funnel Conversion  | documentary funnel conv | 1x       | 0.7x        | -30%
 * Binge-Watching           | completions per streak  | 1x       | ~ 1.5x      | 1.5x
 * Weekend vs Weekday       | weekend watch_duration  | 1x       | ~ 1.5x      | 1.5x
 * Ad Fatigue Churn         | heavy_ad post_d45 events| 1x       | < light_ad  | -93%
 * New Release Spike        | blockbuster id share    | 0%       | ~ 20%       | n/a
 * Kids Profile Safety      | animation/doc share     | baseline | + 15%       | n/a
 * Rec Engine Improvement   | content-rated post day60| 1x       | ~ 1.5x      | 1.5x
 * Subtitle Users           | completion %            | 68%      | 85%         | 1.25x
 * Rec-Click Magic Number   | sweet watch duration    | 1x       | 1.25x       | 1.25x
 * Rec-Click Magic Number   | over watch_duration_min | 1x       | 0.5x        | -50%
 * Core Viewing Loop        | free/premium duration   | 1x       | >= 2x       | 2.09x
 */

// ── SCALE ──
const SEED = "harness-media";
const NUM_USERS = 10_000;
const DATASET_START = "2026-01-01T00:00:00Z";
const DATASET_END = "2026-05-01T23:59:59Z";
const EVENTS_PER_DAY = 1.2;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── KNOBS (tweak these to reshape stories) ──
const KIDS_RESTRICT_LIKELIHOOD = 15;

const PLAN_TTC_PREMIUM = 0.67;
const PLAN_TTC_FREE = 1.4;

const BLOCKBUSTER_START_DAY = 50;
const BLOCKBUSTER_END_DAY = 65;
const BLOCKBUSTER_SWAP_LIKELIHOOD = 20;
const BLOCKBUSTER_RATING_LIKELIHOOD = 20;

const WEEKEND_WATCH_MULT = 1.5;

const DOC_DROP_LIKELIHOOD = 25;

const REC_IMPROVEMENT_DAY = 60;
const REC_IMPROVEMENT_DROP_LIKELIHOOD = 30;

const BINGE_STREAK_THRESHOLD = 3;
const BINGE_PAUSE_DROP_LIKELIHOOD = 60;
const BINGE_CLONE_LIKELIHOOD = 40;

const SUBTITLE_COMPLETION_MULT = 1.25;
const SUBTITLE_DURATION_MULT = 1.15;
const SUBTITLE_CLONE_FACTOR = 0.2;

const REC_SWEET_MIN = 4;
const REC_SWEET_MAX = 6;
const REC_OVER_THRESHOLD = 7;
const REC_SWEET_DURATION_MULT = 1.25;
const REC_OVER_DURATION_MULT = 0.5;
const REC_OVER_DROP_LIKELIHOOD = 55;

const AD_FATIGUE_THRESHOLD = 5;
const AD_FATIGUE_CUTOFF_DAYS = 45;
const AD_FATIGUE_KEEP_MODULO = 20;

// ── DATA ARRAYS ──
const contentIds = v.range(1, 501).map(n => `content_${v.uid(8)}`);
const blockbusterId = `blockbuster_${v.uid(8)}`;

// ── HELPER FUNCTIONS ──
function handleEventHooks(record) {
	// H6: KIDS PROFILE SAFETY — 15% of selections/starts get genre restricted
	// to animation or documentary. Mutates existing genre prop.
	if (chance.bool({ likelihood: KIDS_RESTRICT_LIKELIHOOD })) {
		if (record.event === "content selected" || record.event === "playback started") {
			record.genre = chance.pickone(["animation", "documentary"]);
		}
	}
	return record;
}

function handleEverythingHooks(record, meta) {
	const datasetStart = dayjs.unix(meta.datasetStart);
	const userEvents = record;
	if (!userEvents || userEvents.length === 0) return record;

	const profile = meta.profile;

	// Stamp superProps from profile (consistent per user)
	const stampPlan = profile && profile.subscription_plan ? profile.subscription_plan : undefined;
	const stampDevice = profile && profile.device_type ? profile.device_type : undefined;
	if (stampPlan || stampDevice) {
		userEvents.forEach(e => {
			if (stampPlan) e.subscription_plan = stampPlan;
			if (stampDevice) e.device_type = stampDevice;
		});
	}

	// HOOK 10: CORE VIEWING LOOP TTC — premium 0.67x, free 1.4x.
	// Timestamp shift for Mixpanel funnel TTC + property scale for
	// Insights. Applied first so weekend/subtitle/rec-click hooks
	// amplify from the plan-adjusted base.
	{
		const plan = profile ? profile.subscription_plan : "free";
		const ttcFactor = plan === "premium" ? PLAN_TTC_PREMIUM : plan === "free" ? PLAN_TTC_FREE : 1.0;
		if (ttcFactor !== 1.0) {
			// Timestamp shift: affects Mixpanel funnel TTC
			const viewSeq = findFirstSequence(
				userEvents,
				["content browsed", "content selected", "playback started", "playback completed"],
				60 * 24 * 7
			);
			if (viewSeq) scaleFunnelTTC(viewSeq, ttcFactor);
			// Property scale: affects Insights AVG reports
			for (const e of userEvents) {
				if (e.event === "playback completed" && typeof e.watch_duration_min === "number") {
					e.watch_duration_min = Math.round(e.watch_duration_min * ttcFactor * 10) / 10;
				}
			}
		}
	}

	// Hook #5: NEW RELEASE SPIKE — days 50-65, 20% of selections/starts
	// switch to the blockbuster id. Mutates existing content_id/content_type props.
	const BLOCKBUSTER_START = datasetStart.add(BLOCKBUSTER_START_DAY, "days");
	const BLOCKBUSTER_END = datasetStart.add(BLOCKBUSTER_END_DAY, "days");
	for (const e of userEvents) {
		const eventTime = dayjs(e.time);
		if (eventTime.isAfter(BLOCKBUSTER_START) && eventTime.isBefore(BLOCKBUSTER_END)) {
			if ((e.event === "content selected" || e.event === "playback started") && chance.bool({ likelihood: BLOCKBUSTER_SWAP_LIKELIHOOD })) {
				e.content_type = "movie";
				e.content_id = blockbusterId;
			}
			if (e.event === "content rated" && chance.bool({ likelihood: BLOCKBUSTER_RATING_LIKELIHOOD })) {
				e.rating = chance.integer({ min: 4, max: 5 });
				e.content_id = blockbusterId;
			}
		}
	}

	// Hook #10: CORE VIEWING LOOP — subscription_plan property scaling.
	// Premium users watch more efficiently (shorter durations), free users
	// linger (longer durations). Scales watch_duration_min on playback
	// completed events BEFORE H3/H8/H9 so each subsequent hook amplifies
	// from the plan-adjusted base.
	// Discover via: Insights → playback completed → Avg watch_duration_min → breakdown subscription_plan.
	{
		const plan = stampPlan;
		const factor = (
			plan === "premium" ? PLAN_TTC_PREMIUM :
			plan === "free" ? PLAN_TTC_FREE :
			1.0
		);
		if (factor !== 1.0) {
			for (const e of userEvents) {
				if (e.event === "playback completed" && typeof e.watch_duration_min === "number") {
					e.watch_duration_min = Math.round(e.watch_duration_min * factor);
				}
			}
		}
	}

	// Hook #3: WEEKEND VS WEEKDAY — 1.5x watch_duration_min on weekends.
	// No flag — analyst breaks down by day of week.
	for (const e of userEvents) {
		const dow = new Date(e.time).getUTCDay();
		if ((dow === 0 || dow === 6) && e.event === "playback completed" && typeof e.watch_duration_min === "number") {
			e.watch_duration_min = Math.round(e.watch_duration_min * WEEKEND_WATCH_MULT);
		}
	}

	// Hook #1: GENRE FUNNEL CONVERSION — drop 25% of documentary playback
	// completed events to depress documentary funnel conversion. Raw genre check.
	for (let i = userEvents.length - 1; i >= 0; i--) {
		const evt = userEvents[i];
		if (evt.event === "playback completed" && evt.genre === "documentary" && chance.bool({ likelihood: DOC_DROP_LIKELIHOOD })) {
			userEvents.splice(i, 1);
		}
	}

	// Hook #7: RECOMMENDATION ENGINE IMPROVEMENT — drop 30% of pre-day-60
	// content rated events. Raw time check.
	const IMPROVEMENT_DATE = datasetStart.add(REC_IMPROVEMENT_DAY, "days");
	for (let i = userEvents.length - 1; i >= 0; i--) {
		const evt = userEvents[i];
		if (evt.event === "content rated" && dayjs(evt.time).isBefore(IMPROVEMENT_DATE) && chance.bool({ likelihood: REC_IMPROVEMENT_DROP_LIKELIHOOD })) {
			userEvents.splice(i, 1);
		}
	}

	const firstEventTime = dayjs(userEvents[0].time);

	// Identify behavioral patterns (no flags written)
	let consecutiveCompletions = 0;
	let maxConsecutiveCompletions = 0;
	let earlyAdCount = 0;
	let hasSubtitlesEnabled = false;
	let recClickCount = 0;

	const adCutoff = firstEventTime.add(AD_FATIGUE_CUTOFF_DAYS, "days");
	userEvents.forEach((event, idx) => {
		if (event.event === "playback completed") {
			consecutiveCompletions++;
			if (consecutiveCompletions > maxConsecutiveCompletions) {
				maxConsecutiveCompletions = consecutiveCompletions;
			}
		} else if (event.event !== "playback started") {
			consecutiveCompletions = 0;
		}
		if (event.event === "ad impression" && dayjs(event.time).isBefore(adCutoff)) earlyAdCount++;
		if (event.event === "subtitle toggled" && event.action === "enabled") hasSubtitlesEnabled = true;
		if (event.event === "recommendation clicked") recClickCount++;
	});

	const isBingeWatcher = maxConsecutiveCompletions >= BINGE_STREAK_THRESHOLD;

	// Hook #2: BINGE-WATCHING — drop pauses, inject extra start+complete pairs.
	// Cloned events use unique offset timestamps. No flag.
	if (isBingeWatcher) {
		for (let i = userEvents.length - 1; i >= 0; i--) {
			const event = userEvents[i];
			const eventTime = dayjs(event.time);

			if (event.event === "playback paused" && chance.bool({ likelihood: BINGE_PAUSE_DROP_LIKELIHOOD })) {
				userEvents.splice(i, 1);
				continue;
			}

			if (event.event === "playback completed" && chance.bool({ likelihood: BINGE_CLONE_LIKELIHOOD })) {
				const nextContentId = chance.pickone(contentIds);
				const startTemplate = userEvents.find(e => e.event === "playback started");
				const extraStart = {
					...(startTemplate || event),
					event: "playback started",
					time: eventTime.add(chance.integer({ min: 1, max: 5 }), "minutes").toISOString(),
					user_id: event.user_id,
					content_id: nextContentId,
					content_type: "series",
					playback_quality: event.playback_quality || "1080p",
				};
				const extraComplete = {
					...event,
					time: eventTime.add(chance.integer({ min: 25, max: 60 }), "minutes").toISOString(),
					user_id: event.user_id,
					content_id: nextContentId,
					content_type: "series",
					watch_duration_min: chance.integer({ min: 20, max: 55 }),
					completion_percent: chance.integer({ min: 90, max: 100 }),
				};
				userEvents.splice(i + 1, 0, extraStart, extraComplete);
			}
		}
	}

	// Hook #8: SUBTITLE USERS WATCH MORE — 1.25x completion_percent (cap 100),
	// 1.15x watch_duration_min, plus 20% extra cloned playback completions.
	// No flag — discover via cohort builder on subtitle-toggled-enabled.
	if (hasSubtitlesEnabled) {
		for (let i = 0; i < userEvents.length; i++) {
			const event = userEvents[i];
			if (event.event === "playback completed") {
				if (event.completion_percent) {
					event.completion_percent = Math.min(100, Math.round(event.completion_percent * SUBTITLE_COMPLETION_MULT));
				}
				if (event.watch_duration_min) {
					event.watch_duration_min = Math.round(event.watch_duration_min * SUBTITLE_DURATION_MULT);
				}
			}
		}

		const completionEvents = userEvents.filter(e => e.event === "playback completed");
		const extraCount = Math.floor(completionEvents.length * SUBTITLE_CLONE_FACTOR);
		for (let j = 0; j < extraCount; j++) {
			const templateEvent = chance.pickone(completionEvents);
			const templateTime = dayjs(templateEvent.time);
			const extraCompletion = {
				...templateEvent,
				time: templateTime.add(chance.integer({ min: 30, max: 180 }), "minutes").toISOString(),
				user_id: templateEvent.user_id,
				content_id: chance.pickone(contentIds),
				content_type: chance.pickone(["movie", "series", "documentary"]),
				watch_duration_min: chance.integer({ min: 25, max: 120 }),
				completion_percent: chance.integer({ min: 80, max: 100 }),
			};
			userEvents.push(extraCompletion);
		}
	}

	// Hook #9: RECOMMENDATION-CLICKED MAGIC NUMBER (no flags)
	// Sweet 4-6 rec clicks → +25% watch_duration_min on playback completed.
	// Over 7+ → halve watch_duration_min AND drop 55% of playback completed
	// events (rec fatigue). Aggressive suppression overcomes the inherent
	// engagement confound (high-rec-click users are naturally more active).
	if (recClickCount >= REC_SWEET_MIN && recClickCount <= REC_SWEET_MAX) {
		userEvents.forEach(e => {
			if (e.event === "playback completed" && typeof e.watch_duration_min === "number") {
				e.watch_duration_min = Math.round(e.watch_duration_min * REC_SWEET_DURATION_MULT);
			}
		});
	} else if (recClickCount >= REC_OVER_THRESHOLD) {
		for (let i = userEvents.length - 1; i >= 0; i--) {
			const evt = userEvents[i];
			if (evt.event === "playback completed") {
				// Halve watch duration for surviving events
				if (typeof evt.watch_duration_min === "number") {
					evt.watch_duration_min = Math.round(evt.watch_duration_min * REC_OVER_DURATION_MULT);
				}
				// Drop 55% of completions
				if (chance.bool({ likelihood: REC_OVER_DROP_LIKELIHOOD })) {
					userEvents.splice(i, 1);
				}
			}
		}
	}

	// Hook #4: AD FATIGUE CHURN — users w/ 5+ early ad impressions lose
	// nearly all events after day 45. Runs LAST so event-adding hooks
	// (binge-watching, subtitle) can't re-inflate the post-d45 count.
	// Applies to ALL tiers (ad fatigue affects anyone exposed to heavy ads,
	// regardless of plan). 95% drop overcomes the ~3x activity confound.
	if (earlyAdCount >= AD_FATIGUE_THRESHOLD) {
		const churnCutoff = firstEventTime.add(AD_FATIGUE_CUTOFF_DAYS, "days");
		for (let i = userEvents.length - 1; i >= 0; i--) {
			const evt = userEvents[i];
			if (dayjs(evt.time).isAfter(churnCutoff)) {
				// Keep only ~5% of post-d45 events (drop 95%)
				const keep = (i % AD_FATIGUE_KEEP_MODULO) === 0;
				if (!keep) {
					userEvents.splice(i, 1);
				}
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
			sequence: ["account created", "content browsed", "playback started"],
			isFirstFunnel: true,
			conversionRate: 80,
			timeToConvert: 0.25,
		},
		{
			// Core viewing loop: browse → select → watch → finish (most common)
			sequence: ["content browsed", "content selected", "playback started", "playback completed"],
			conversionRate: 55,
			timeToConvert: 2,
			weight: 5,
			props: {
				genre: ["action", "comedy", "drama", "documentary", "horror", "sci_fi", "animation", "thriller", "romance"],
			},
		},
		{
			// Recommendation-driven viewing
			sequence: ["recommendation clicked", "playback started", "playback completed", "content rated"],
			conversionRate: 35,
			timeToConvert: 1,
			weight: 3,
		},
		{
			// Search-driven discovery
			sequence: ["search performed", "content selected", "playback started"],
			conversionRate: 50,
			timeToConvert: 0.5,
			weight: 3,
		},
		{
			// Watchlist management
			sequence: ["content browsed", "watchlist added", "content selected", "playback started"],
			conversionRate: 40,
			timeToConvert: 12,
			weight: 2,
		},
		{
			// Profile and subtitle management
			sequence: ["profile switched", "subtitle toggled", "playback started", "playback completed"],
			conversionRate: 45,
			timeToConvert: 1,
			weight: 2,
		},
		{
			// Ad experience (free tier)
			sequence: ["ad impression", "playback started", "playback paused"],
			conversionRate: 60,
			timeToConvert: 0.5,
			weight: 2,
		},
		{
			// Content sharing and downloads
			sequence: ["playback completed", "share content", "download started"],
			conversionRate: 25,
			timeToConvert: 1,
			weight: 1,
		},
		{
			// Subscription changes
			sequence: ["content browsed", "subscription changed"],
			conversionRate: 15,
			timeToConvert: 24,
			weight: 1,
		},
	],

	events: [
		{
			event: "account created",
			weight: 1,
			isFirstEvent: true,
			isAuthEvent: true,
			properties: {
				"signup_source": ["organic", "referral", "trial_offer", "ad"],
				"plan_selected": ["free", "standard", "premium"],
			}
		},
		{
			event: "content browsed",
			weight: 20,
			properties: {
				"browse_section": ["home", "trending", "new_releases", "genre", "continue_watching"],
				"genre": ["action", "comedy", "drama", "documentary", "horror", "sci_fi", "animation", "thriller", "romance"],
			}
		},
		{
			event: "content selected",
			weight: 15,
			isStrictEvent: false,
			properties: {
				"content_type": ["movie", "series", "documentary", "special"],
				"genre": ["action", "comedy", "drama", "documentary", "horror", "sci_fi", "animation", "thriller", "romance"],
				"content_id": contentIds,
			}
		},
		{
			event: "playback started",
			weight: 18,
			isStrictEvent: false,
			properties: {
				"content_id": contentIds,
				"content_type": ["movie", "series", "documentary", "special"],
				"playback_quality": ["480p", "720p", "1080p", "4k"],
				"subtitle_language": ["none", "english", "spanish", "french", "japanese", "korean"],
				"playback_speed": ["0.5x", "1x", "1x", "1x", "1.25x", "1.5x", "2x"],
			}
		},
		{
			event: "playback completed",
			weight: 12,
			isStrictEvent: false,
			properties: {
				"content_id": contentIds,
				"content_type": ["movie", "series", "documentary", "special"],
				"watch_duration_min": u.weighNumRange(5, 180, 0.5, 45),
				"completion_percent": u.weighNumRange(10, 100, 1.5, 85),
			}
		},
		{
			event: "playback paused",
			weight: 10,
			isStrictEvent: false,
			properties: {
				"content_id": contentIds,
				"pause_reason": ["manual", "ad_break", "buffering", "notification"],
			}
		},
		{
			event: "content rated",
			weight: 6,
			isStrictEvent: false,
			properties: {
				"content_id": contentIds,
				"rating": u.weighNumRange(1, 5, 2, 4),
				"review_text_length": u.weighNumRange(0, 500, 0.2, 0),
			}
		},
		{
			event: "watchlist added",
			weight: 8,
			properties: {
				"content_id": contentIds,
				"content_type": ["movie", "series", "documentary", "special"],
				"genre": ["action", "comedy", "drama", "documentary", "horror", "sci_fi", "animation", "thriller", "romance"],
			}
		},
		{
			event: "watchlist removed",
			weight: 3,
			properties: {
				"content_id": contentIds,
				"reason": ["watched", "not_interested", "expired"],
			}
		},
		{
			event: "search performed",
			weight: 7,
			properties: {
				"search_term": () => chance.word(),
				"results_count": u.weighNumRange(0, 50, 0.5, 15),
				"search_type": ["title", "actor", "director", "genre"],
			}
		},
		{
			event: "recommendation clicked",
			weight: 9,
			isStrictEvent: false,
			properties: {
				"algorithm": ["collaborative_filtering", "content_based", "trending", "editorial"],
				"position": u.weighNumRange(1, 20),
			}
		},
		{
			event: "profile switched",
			weight: 4,
			properties: {
				"profile_type": ["main", "kids", "partner", "guest"],
			}
		},
		{
			event: "ad impression",
			weight: 8,
			isStrictEvent: false,
			properties: {
				"ad_type": ["pre_roll", "mid_roll", "banner", "interstitial"],
				"ad_duration_sec": u.weighNumRange(5, 30),
				"skipped": [false, false, false, true, true],
			}
		},
		{
			event: "subscription changed",
			weight: 2,
			properties: {
				"old_plan": ["free", "standard", "premium"],
				"new_plan": ["free", "standard", "premium"],
				"change_reason": ["upgrade", "downgrade", "cancel", "resubscribe"],
			}
		},
		{
			event: "download started",
			weight: 5,
			properties: {
				"content_id": contentIds,
				"content_type": ["movie", "series", "documentary", "special"],
				"download_quality": ["720p", "1080p", "4k"],
			}
		},
		{
			event: "share content",
			weight: 3,
			properties: {
				"share_method": ["link", "social", "dm", "email"],
				"content_type": ["movie", "series", "documentary", "special"],
			}
		},
		{
			event: "subtitle toggled",
			weight: 4,
			isStrictEvent: false,
			properties: {
				"subtitle_language": ["none", "english", "spanish", "french", "japanese", "korean"],
				"action": ["enabled", "disabled", "changed"],
			}
		},
	],

	superProps: {
		subscription_plan: ["free", "free", "standard", "standard", "standard", "premium"],
		device_type: ["smart_tv", "mobile", "tablet", "laptop", "desktop"],
	},

	scdProps: {
		subscription_plan: {
			values: ["free", "basic", "standard", "premium"],
			frequency: "month",
			timing: "fuzzy",
			max: 6
		}
	},

	userProps: {
		"preferred_genre": ["action", "comedy", "drama", "documentary", "horror", "sci_fi", "animation"],
		"avg_session_duration_min": u.weighNumRange(10, 180, 0.5, 45),
		"total_watch_hours": u.weighNumRange(0, 500, 0.8, 50),
		"profiles_count": u.weighNumRange(1, 5),
		"downloads_enabled": [false, false, false, true, true],
		"subscription_plan": ["free", "free", "standard", "standard", "standard", "premium"],
		"device_type": ["smart_tv", "mobile", "tablet", "laptop", "desktop"],
	},

	lookupTables: [],

	hook(record, type, meta) {
		if (type === "event") return handleEventHooks(record);
		if (type === "everything") return handleEverythingHooks(record, meta);
		return record;
	},
};

export default config;
