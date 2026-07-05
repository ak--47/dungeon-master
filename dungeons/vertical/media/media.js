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
 * NAME:       StreamVault
 * APP:        Netflix/Hulu-style video streaming platform. Users browse a
 *             catalog of movies, series, documentaries and specials, manage
 *             watchlists, watch with configurable quality/subtitle/speed,
 *             rate and share content, and switch household profiles (main,
 *             kids, partner, guest) under a single account.
 * SCALE:      10,000 users, ~1.24M events, 121 days (2026-01-01 → 2026-05-01)
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
 *   - Expected: documentary ~ 0.75x conversion vs other genres
 *
 * MEASUREMENT CAVEATS: raw per-genre completion counts are confounded by
 * (a) the engine's favored-index property sampling (action/romance selections
 * run ~1.5x the uniform share) and (b) H6, which inflates animation+documentary
 * SELECTION counts without adding completions. The clean read is the
 * completions-per-selection ratio-of-ratios vs animation — animation absorbs
 * the same H6 denominator inflation, so (doc c/s)/(anim c/s) isolates the
 * engineered 0.75 (measured 0.74 @2K). Genre exists on completions only via
 * core-viewing-loop funnel props; other completions carry genre = null.
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
 *   - Expected: A ~ 1.6x more completions per user (1.4x clone mechanism
 *     × ~1.15x activity/streak-selection confound; measured 1.64 @2K)
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
 *   - Expected: Sat/Sun ~ 1.45x weekday avg (engineered 1.5x, diluted by
 *     binge/subtitle clones whose durations are fresh draws, never x1.5)
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
 *   - Expected: heavy_ad post/pre event ratio ~ 0.04x light_ad (engineered
 *     5% keep; measured 0.07 vs 1.67 @2K among users whose lifecycle spans
 *     past day 52 — restrict to those or late-born users dilute cohort B)
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
 *   - Expected: animation + documentary ~ 32% of "content selected" (vs ~20%
 *     un-hooked base; engineered 15% forced + 85% x base). Read on "content
 *     selected" only — "playback started" carries genre solely via
 *     core-viewing-loop funnel props or this hook's stamp, so its
 *     genre-carrying subset over-represents animation/documentary (~48%)
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
 *   - Expected: post-window rated-share-of-all-events ~ 1.43x pre-window
 *     (1/0.7 mechanism; normalizing by total events cancels the user-growth
 *     ramp. Measured 1.50 @2K — H4 thins the post-window denominator)
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
 *   - Expected: A ~ 67% vs B ~ 52% (~1.28x; the raw completion_percent pool
 *     mean is ~52, not the ~68 an 85-peaked weighNumRange suggests — the 1.5
 *     skew leaves substantial low-end mass. watch_duration_min is NOT a clean
 *     read for this cohort: subtitle users skew into the H9 over-bucket,
 *     whose halving cancels the 1.15x almost exactly)
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
 *   - Expected: A ~ 1.23x B (engineered 1.25x; measured 1.23 @2K)
 *
 *   Report 2: Completions per User on Heavy Rec Clickers
 *   - Report type: Insights (with cohort)
 *   - Cohort C: users with >= 7 "recommendation clicked"
 *   - Cohort A: users with 4-6
 *   - Event: "playback completed"
 *   - Measure: Average of "watch_duration_min"
 *   - Expected: C ~ 0.40x A exactly — the over/sweet pair is a clean
 *     mechanism read (0.5 halving / 1.25 sweet boost = 0.40; both buckets
 *     share the high-engagement confound, which cancels. Measured 0.41 @2K)
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
 * Applied ONCE, before weekend/subtitle/rec-click hooks so each subsequent
 * effect amplifies from the plan-adjusted base. Two mechanisms: the
 * watch_duration_min property scale (Insights) and scaleFunnelTTC on each
 * user's first core-viewing sequence (funnel time-to-convert).
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Avg Watch Duration by Subscription Plan
 *   - Report type: Insights
 *   - Event: "playback completed"
 *   - Measure: Average of "watch_duration_min"
 *   - Breakdown: "subscription_plan"
 *   - Expected: premium < standard < free, free/premium ~ 2.0x (engineered
 *     2.09 = 1.4/0.67, diluted slightly by unscaled clone durations)
 *
 *   Report 2: Core Viewing Funnel TTC by Plan
 *   - Report type: Funnels (time to convert)
 *   - Steps: content browsed -> content selected -> playback started -> playback completed
 *   - Breakdown: "subscription_plan"; conversion window 6 HOURS
 *   - Expected: free ~ 1.4x standard median TTC, premium ~ 0.67x standard,
 *     free/premium ~ 2.09x (medians ~2.1h / ~1.5h / ~1.0h)
 *   - The 6-hour window is essential. The hook scales within-session step
 *     gaps; at multi-day windows each plan's TTC distribution is bimodal —
 *     a compressed within-session mode plus a 6-72h cross-session organic
 *     tail — with the median sitting on the ~50% boundary between them,
 *     so it flips between modes on sampling noise (a 3-day window read
 *     0.70 prem/std at 2K and 1.14 at 10K from the same config). At 6h
 *     the distributions are unimodal and the medians are scale-stable.
 *
 * REAL-WORLD ANALOGUE: Premium subscribers binge curated content efficiently;
 * free-tier users browse and linger with ad interruptions.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * EXPECTED METRICS SUMMARY
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Hook                     | Metric                       | Engineered | Measured @2K
 * ─────────────────────────|──────────────────────────────|------------|-------------
 * Genre Funnel Conversion  | doc/anim comp-per-sel RoR    | 0.75       | 0.739
 * Binge-Watching           | binge/rest completions pu    | ~1.6x      | 1.64
 * Weekend vs Weekday       | wkn/wkd avg duration         | ~1.45x     | 1.45
 * Ad Fatigue Churn         | fatigued/rest post-pre ratio | ~0.05      | 0.043
 * New Release Spike        | in-window blockbuster share  | 0.20       | 0.203 (out: 0)
 * Kids Profile Safety      | anim+doc share of selected   | ~0.32      | 0.317
 * Rec Engine Improvement   | post/pre rated share ratio   | 1.43       | 1.497
 * Subtitle Users           | completion_percent ratio     | ~1.28x     | 1.281
 * Rec-Click Magic Number   | sweet/low avg duration       | 1.25x      | 1.227
 * Rec-Click Magic Number   | over/sweet avg duration      | 0.40x      | 0.413
 * Core Viewing Loop        | free/premium avg duration    | 2.09x      | 2.010
 * Core Viewing Loop        | TTC free/premium (6h win)    | 2.09x      | 2.08
 *
 * (Measured column re-checked at full 10K fidelity during verification;
 * @2K values shown where the full-run delta was within band.)
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

	// HOOK 10: CORE VIEWING LOOP — subscription_plan scaling, applied ONCE.
	// Premium 0.67x, free 1.4x, standard 1.0x. Two mechanisms:
	//   1. scaleFunnelTTC on the user's first core-viewing sequence
	//      (visible to Mixpanel funnel time-to-convert)
	//   2. watch_duration_min property scale on playback completed
	//      (visible to Insights AVG; free/premium engineered ratio 2.09)
	// Applied first so weekend/subtitle/rec-click hooks amplify from the
	// plan-adjusted base.
	{
		const plan = stampPlan;
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
					e.watch_duration_min = Math.round(e.watch_duration_min * ttcFactor);
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

// ── STORIES (v1.6 verification) ──
/*
 * Derivation notes (bands centered on knob-derived mechanisms, sized from
 * the 2K reduced-scale measurement pass; scale guards at ~50% of expected
 * 10K populations so reduced runs read WEAK by design):
 *
 * - H1 uses a completions-per-selection ratio-of-ratios vs ANIMATION:
 *   animation absorbs the same H6 selection-count inflation as documentary,
 *   and per-selection normalization cancels the favored-index popularity
 *   skew (action/romance run hot). 0.75 mechanism, 0.739 measured.
 * - H2/H8/H9 cohorts are re-derived from FINAL output; hook-time vs
 *   final-count migration (H4 drops post-d45 events incl. rec clicks /
 *   subtitle toggles) is part of the measured mechanism.
 * - H7 normalizes rated counts by total events pre/post day 60 — cancels
 *   the user-growth ramp. 1/0.7 = 1.43 mechanism; H4 thins the post-window
 *   denominator, nudging the measured value to ~1.50.
 * - H9 over/sweet = 0.5/1.25 = 0.40 exact: both buckets share the
 *   high-engagement confound, which cancels in the pair.
 * - H10 TTC uses a 6-HOUR conversion window — the within-session read.
 *   At multi-day windows each plan's TTC distribution is bimodal
 *   (compressed within-session mode + 6-72h cross-session organic tail)
 *   with the median sitting on the ~50% mode boundary; a 3-day window
 *   read 0.70 prem/std at 2K and 1.14 at 10K from the same config. At 6h
 *   the medians are unimodal and scale-stable (free 2.11h / std 1.52h /
 *   prem 1.01h at both scales; free/prem 2.089 vs 2.0896 mechanism).
 *   Insights read (avg duration by plan) is the primary; 2.09 mechanism
 *   diluted to ~2.0 by fresh-draw clone durations.
 * - H4/H5 windows: hook computes day boundaries via local-mode dayjs from
 *   datasetStart; all fixed windows (day 50/60/65) land before the
 *   2026-03-08 US DST shift, so boundaries are exact UTC midnights. The
 *   per-user +45d ad-fatigue cutoff can drift 1h after March 8 —
 *   immaterial at day granularity.
 */

const EV = `read_json_auto('{{PREFIX}}-EVENTS*.json', sample_size=-1, union_by_name=true)`;

const bandVerdict = (x, nailed, strong, detail, inverse = () => false) => {
	if (x == null || Number.isNaN(Number(x))) return { verdict: "NONE", detail: `${detail} — metric missing` };
	const v = Number(x);
	if (inverse(v)) return { verdict: "INVERSE", detail };
	if (v >= nailed[0] && v <= nailed[1]) return { verdict: "NAILED", detail };
	if (v >= strong[0] && v <= strong[1]) return { verdict: "STRONG", detail };
	return { verdict: "WEAK", detail };
};

const guarded = (ok, detail, inner) => ok ? inner() : { verdict: "WEAK", detail: `${detail} — cohort below scale guard (expected at reduced scale)` };

export const stories = [
	{
		id: "media-h1-genre-funnel",
		hook: "H1",
		archetype: "funnel-conversion-by-segment",
		narrative: "Documentary playback completions are dropped 25%, depressing the documentary core-viewing funnel. Clean read: completions-per-selection vs animation (shared H6 denominator inflation cancels).",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH g AS (
  SELECT genre,
    count(*) FILTER (WHERE event = 'content selected') AS sel_n,
    count(*) FILTER (WHERE event = 'playback completed') AS comp_n
  FROM ${EV}
  WHERE genre IS NOT NULL AND event IN ('content selected', 'playback completed')
  GROUP BY genre
)
SELECT
  max(comp_n) FILTER (WHERE genre = 'documentary') AS doc_comp,
  max(comp_n) FILTER (WHERE genre = 'animation') AS anim_comp,
  (max(comp_n) FILTER (WHERE genre = 'documentary')::DOUBLE / max(sel_n) FILTER (WHERE genre = 'documentary'))
    / (max(comp_n) FILTER (WHERE genre = 'animation')::DOUBLE / max(sel_n) FILTER (WHERE genre = 'animation')) AS ror
FROM g`,
				},
				assert: (rows) => {
					const r = rows[0] || {};
					const detail = `doc/anim comp-per-sel RoR=${Number(r.ror).toFixed(3)} (mechanism 0.75; doc_comp=${r.doc_comp} anim_comp=${r.anim_comp})`;
					return guarded(Number(r.doc_comp) >= 1700 && Number(r.anim_comp) >= 2400, detail,
						() => bandVerdict(r.ror, [0.68, 0.82], [0.60, 0.90], detail, v => v >= 0.95));
				},
			},
		],
	},
	{
		id: "media-h2-binge-watching",
		hook: "H2",
		archetype: "cohort-count-scale",
		narrative: "Users with 3+ consecutive completions get 40% of completions cloned as start+complete pairs and 60% of pauses dropped. Binge cohort shows ~1.6x completions per user (1.4x clones x activity confound).",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH seq AS (
  SELECT user_id::VARCHAR AS uid, event,
    ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY time::TIMESTAMP, event) AS rn
  FROM ${EV} WHERE event != 'playback started'
), runs AS (
  SELECT uid, rn - ROW_NUMBER() OVER (PARTITION BY uid ORDER BY rn) AS grp
  FROM seq WHERE event = 'playback completed'
), streaks AS (
  SELECT uid, max(cnt) AS max_streak
  FROM (SELECT uid, grp, count(*) AS cnt FROM runs GROUP BY uid, grp) GROUP BY uid
), pu AS (
  SELECT user_id::VARCHAR AS uid,
    count(*) FILTER (WHERE event = 'playback completed') AS completions
  FROM ${EV} GROUP BY 1
)
SELECT coalesce(s.max_streak >= 3, false) AS binge, count(*) AS users,
  avg(p.completions) AS completions_pu
FROM pu p LEFT JOIN streaks s USING (uid)
GROUP BY (coalesce(s.max_streak >= 3, false))`,
				},
				assert: (rows) => {
					const binge = rows.find(r => r.binge === true || r.binge === "true");
					const rest = rows.find(r => r.binge === false || r.binge === "false");
					if (!binge || !rest) return { verdict: "NONE", detail: "binge/rest buckets missing" };
					const ratio = Number(binge.completions_pu) / Number(rest.completions_pu);
					const detail = `binge ${Number(binge.completions_pu).toFixed(2)} vs rest ${Number(rest.completions_pu).toFixed(2)} completions/user = ${ratio.toFixed(2)}x (mechanism ~1.6; binge n=${binge.users})`;
					return guarded(Number(binge.users) >= 420 && Number(rest.users) >= 4500, detail,
						() => bandVerdict(ratio, [1.45, 1.85], [1.30, 2.10], detail, v => v <= 1.05));
				},
			},
		],
	},
	{
		id: "media-h3-weekend-duration",
		hook: "H3",
		archetype: "bespoke",
		narrative: "Saturday/Sunday completions get watch_duration_min x1.5. Measured ~1.45 — binge/subtitle clones carry fresh unscaled durations and dilute both buckets asymmetrically.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT
  avg(watch_duration_min) FILTER (WHERE dayofweek(time::TIMESTAMP) IN (0, 6)) AS wkn,
  avg(watch_duration_min) FILTER (WHERE dayofweek(time::TIMESTAMP) NOT IN (0, 6)) AS wkd,
  count(*) FILTER (WHERE dayofweek(time::TIMESTAMP) IN (0, 6)) AS n_wkn
FROM ${EV}
WHERE event = 'playback completed' AND watch_duration_min IS NOT NULL`,
				},
				assert: (rows) => {
					const r = rows[0] || {};
					const ratio = Number(r.wkn) / Number(r.wkd);
					const detail = `weekend ${Number(r.wkn).toFixed(1)} vs weekday ${Number(r.wkd).toFixed(1)} min = ${ratio.toFixed(3)}x (mechanism 1.5 diluted to ~1.45; n_wkn=${r.n_wkn})`;
					return guarded(Number(r.n_wkn) >= 10000, detail,
						() => bandVerdict(ratio, [1.38, 1.55], [1.25, 1.65], detail, v => v <= 1.05));
				},
			},
		],
	},
	{
		id: "media-h4-ad-fatigue",
		hook: "H4",
		archetype: "retention-divergence",
		narrative: "Users with 5+ ad impressions in their first 45 days lose ~95% of events after day 45 of their lifecycle. Post/pre event ratio for the fatigued cohort collapses to ~0.04x the rest.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH pu AS (
  SELECT user_id::VARCHAR AS uid, min(time::TIMESTAMP) AS t0, max(time::TIMESTAMP) AS tlast
  FROM ${EV} GROUP BY 1
), flags AS (
  SELECT p.uid,
    count(*) FILTER (WHERE e.event = 'ad impression' AND e.time::TIMESTAMP < p.t0 + INTERVAL 45 DAY) AS early_ads,
    count(*) FILTER (WHERE e.time::TIMESTAMP > p.t0 + INTERVAL 45 DAY) AS post,
    count(*) FILTER (WHERE e.time::TIMESTAMP <= p.t0 + INTERVAL 45 DAY) AS pre
  FROM ${EV} e JOIN pu p ON e.user_id::VARCHAR = p.uid
  WHERE p.tlast > p.t0 + INTERVAL 52 DAY
  GROUP BY 1
)
SELECT (early_ads >= 5) AS fatigued, count(*) AS users,
  avg(post::DOUBLE / nullif(pre, 0)) AS post_pre
FROM flags WHERE pre > 0
GROUP BY (early_ads >= 5)`,
				},
				assert: (rows) => {
					const fat = rows.find(r => r.fatigued === true || r.fatigued === "true");
					const rest = rows.find(r => r.fatigued === false || r.fatigued === "false");
					if (!fat || !rest) return { verdict: "NONE", detail: "fatigued/rest buckets missing" };
					const ratio = Number(fat.post_pre) / Number(rest.post_pre);
					const detail = `fatigued post/pre ${Number(fat.post_pre).toFixed(3)} vs rest ${Number(rest.post_pre).toFixed(3)} = ${ratio.toFixed(3)}x (mechanism ~0.05; fatigued n=${fat.users})`;
					return guarded(Number(fat.users) >= 400 && Number(rest.users) >= 4000, detail,
						() => bandVerdict(ratio, [0.02, 0.08], [0.01, 0.15], detail, v => v >= 0.5));
				},
			},
		],
	},
	{
		id: "media-h5-blockbuster-spike",
		hook: "H5",
		archetype: "temporal-inflection",
		narrative: "Days 50-65: 20% of content-selected events swap to the blockbuster id; blockbuster ratings are pinned 4-5. Zero blockbuster traffic outside the window.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT
  avg((content_id LIKE 'blockbuster%')::INT) FILTER (WHERE in_win) AS in_share,
  avg((content_id LIKE 'blockbuster%')::INT) FILTER (WHERE NOT in_win) AS out_share,
  count(*) FILTER (WHERE in_win) AS n_in
FROM (
  SELECT content_id,
    date_diff('day', TIMESTAMP '2026-01-01 00:00:00', time::TIMESTAMP) BETWEEN 50 AND 64 AS in_win
  FROM ${EV} WHERE event = 'content selected'
)`,
				},
				assert: (rows) => {
					const r = rows[0] || {};
					const detail = `in-window blockbuster share=${Number(r.in_share).toFixed(4)} (mechanism 0.20), out-window=${Number(r.out_share).toFixed(5)}, n_in=${r.n_in}`;
					return guarded(Number(r.n_in) >= 11000, detail, () => {
						if (Number(r.out_share) > 0.002) return { verdict: "WEAK", detail: `${detail} — blockbuster leaked outside window` };
						return bandVerdict(r.in_share, [0.18, 0.22], [0.15, 0.25], detail, v => v <= 0.02);
					});
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT count(*) AS n, min(rating) AS min_rating
FROM ${EV}
WHERE event = 'content rated' AND content_id LIKE 'blockbuster%'`,
				},
				assert: (rows) => {
					const r = rows[0] || {};
					const detail = `blockbuster ratings n=${r.n}, min=${r.min_rating} (all engineered 4-5)`;
					return guarded(Number(r.n) >= 280, detail, () => {
						if (Number(r.min_rating) >= 4) return { verdict: "NAILED", detail };
						if (Number(r.min_rating) >= 3) return { verdict: "WEAK", detail };
						return { verdict: "NONE", detail };
					});
				},
			},
		],
	},
	{
		id: "media-h6-kids-safety",
		hook: "H6",
		archetype: "composition-drift",
		narrative: "15% of content-selected events get genre forced to animation/documentary. Share rises from ~0.20 organic to ~0.32. Read on content selected only — playback started carries genre solely via funnel-2 props or this hook.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT count(*) AS n,
  avg((genre IN ('animation', 'documentary'))::INT) AS kid_share
FROM ${EV}
WHERE event = 'content selected' AND genre IS NOT NULL`,
				},
				assert: (rows) => {
					const r = rows[0] || {};
					const detail = `animation+documentary share of selected=${Number(r.kid_share).toFixed(4)} (mechanism 0.15 + 0.85 x ~0.20 base = ~0.32; n=${r.n})`;
					return guarded(Number(r.n) >= 96000, detail,
						() => bandVerdict(r.kid_share, [0.29, 0.345], [0.26, 0.38], detail, v => v <= 0.23));
				},
			},
		],
	},
	{
		id: "media-h7-rec-improvement",
		hook: "H7",
		archetype: "temporal-inflection",
		narrative: "30% of pre-day-60 content-rated events dropped. Normalizing rated counts by total events cancels the user-growth ramp: post/pre share ratio = 1/0.7 = 1.43 mechanism.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ev AS (
  SELECT event,
    date_diff('day', TIMESTAMP '2026-01-01 00:00:00', time::TIMESTAMP) < 60 AS pre
  FROM ${EV}
)
SELECT
  count(*) FILTER (WHERE pre AND event = 'content rated') AS pre_rated,
  count(*) FILTER (WHERE NOT pre AND event = 'content rated') AS post_rated,
  (count(*) FILTER (WHERE NOT pre AND event = 'content rated')::DOUBLE / count(*) FILTER (WHERE NOT pre))
    / (count(*) FILTER (WHERE pre AND event = 'content rated')::DOUBLE / count(*) FILTER (WHERE pre)) AS share_ratio
FROM ev`,
				},
				assert: (rows) => {
					const r = rows[0] || {};
					const detail = `post/pre rated-share ratio=${Number(r.share_ratio).toFixed(3)} (mechanism 1.43; pre_rated=${r.pre_rated} post_rated=${r.post_rated})`;
					return guarded(Number(r.pre_rated) >= 4500 && Number(r.post_rated) >= 7400, detail,
						() => bandVerdict(r.share_ratio, [1.35, 1.62], [1.20, 1.80], detail, v => v <= 1.05));
				},
			},
		],
	},
	{
		id: "media-h8-subtitle-cohort",
		hook: "H8",
		archetype: "cohort-prop-scale",
		narrative: "Subtitle-enabled users: completion_percent x1.25 (cap 100) plus 20% cloned completions. completion_percent is the clean read — the duration x1.15 is cancelled by subtitle users skewing into the H9 over-bucket.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH pu AS (
  SELECT user_id::VARCHAR AS uid,
    bool_or(event = 'subtitle toggled' AND action = 'enabled') AS subs
  FROM ${EV} GROUP BY 1
)
SELECT p.subs, count(DISTINCT p.uid) AS users, avg(e.completion_percent) AS avg_cp
FROM ${EV} e JOIN pu p ON e.user_id::VARCHAR = p.uid
WHERE e.event = 'playback completed' AND e.completion_percent IS NOT NULL
GROUP BY p.subs`,
				},
				assert: (rows) => {
					const sub = rows.find(r => r.subs === true || r.subs === "true");
					const non = rows.find(r => r.subs === false || r.subs === "false");
					if (!sub || !non) return { verdict: "NONE", detail: "subtitle buckets missing" };
					const ratio = Number(sub.avg_cp) / Number(non.avg_cp);
					const detail = `subtitle avg completion_percent ${Number(sub.avg_cp).toFixed(1)} vs ${Number(non.avg_cp).toFixed(1)} = ${ratio.toFixed(3)}x (mechanism ~1.28 after cap; subs n=${sub.users})`;
					return guarded(Number(sub.users) >= 3600 && Number(non.users) >= 1300, detail,
						() => bandVerdict(ratio, [1.20, 1.36], [1.10, 1.45], detail, v => v <= 1.03));
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH pu AS (
  SELECT user_id::VARCHAR AS uid,
    bool_or(event = 'subtitle toggled' AND action = 'enabled') AS subs,
    count(*) FILTER (WHERE event = 'playback completed') AS completions
  FROM ${EV} GROUP BY 1
)
SELECT subs, count(*) AS users, avg(completions) AS completions_pu
FROM pu GROUP BY subs`,
				},
				assert: (rows) => {
					const sub = rows.find(r => r.subs === true || r.subs === "true");
					const non = rows.find(r => r.subs === false || r.subs === "false");
					if (!sub || !non) return { verdict: "NONE", detail: "subtitle buckets missing" };
					const ratio = Number(sub.completions_pu) / Number(non.completions_pu);
					const detail = `subtitle ${Number(sub.completions_pu).toFixed(2)} vs ${Number(non.completions_pu).toFixed(2)} completions/user = ${ratio.toFixed(2)}x (1.2x clones x activity; measured 1.53 @2K unweighted-per-user; subs n=${sub.users})`;
					return guarded(Number(sub.users) >= 3600 && Number(non.users) >= 1300, detail,
						() => bandVerdict(ratio, [1.38, 1.68], [1.25, 1.85], detail, v => v <= 1.0));
				},
			},
		],
	},
	{
		id: "media-h9-rec-magic-number",
		hook: "H9",
		archetype: "frequency-sweet-spot",
		narrative: "4-6 rec clicks: watch_duration_min x1.25. 7+: halved plus 55% completions dropped. over/sweet = 0.5/1.25 = 0.40 exact — the engagement confound cancels between the two high-activity buckets.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH pu AS (
  SELECT user_id::VARCHAR AS uid,
    count(*) FILTER (WHERE event = 'recommendation clicked') AS rcs
  FROM ${EV} GROUP BY 1
)
SELECT
  CASE WHEN p.rcs BETWEEN 4 AND 6 THEN 'sweet' WHEN p.rcs >= 7 THEN 'over' ELSE 'low' END AS bucket,
  count(DISTINCT p.uid) AS users, avg(e.watch_duration_min) AS avg_dur
FROM ${EV} e JOIN pu p ON e.user_id::VARCHAR = p.uid
WHERE e.event = 'playback completed' AND e.watch_duration_min IS NOT NULL
GROUP BY (CASE WHEN p.rcs BETWEEN 4 AND 6 THEN 'sweet' WHEN p.rcs >= 7 THEN 'over' ELSE 'low' END)`,
				},
				assert: (rows) => {
					const sweet = rows.find(r => r.bucket === "sweet");
					const low = rows.find(r => r.bucket === "low");
					if (!sweet || !low) return { verdict: "NONE", detail: "sweet/low buckets missing" };
					const ratio = Number(sweet.avg_dur) / Number(low.avg_dur);
					const detail = `sweet ${Number(sweet.avg_dur).toFixed(1)} vs low ${Number(low.avg_dur).toFixed(1)} min = ${ratio.toFixed(3)}x (mechanism 1.25; sweet n=${sweet.users} low n=${low.users})`;
					return guarded(Number(sweet.users) >= 1390 && Number(low.users) >= 700, detail,
						() => bandVerdict(ratio, [1.15, 1.35], [1.05, 1.45], detail, v => v <= 0.98));
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH pu AS (
  SELECT user_id::VARCHAR AS uid,
    count(*) FILTER (WHERE event = 'recommendation clicked') AS rcs
  FROM ${EV} GROUP BY 1
)
SELECT
  CASE WHEN p.rcs BETWEEN 4 AND 6 THEN 'sweet' WHEN p.rcs >= 7 THEN 'over' ELSE 'low' END AS bucket,
  count(DISTINCT p.uid) AS users, avg(e.watch_duration_min) AS avg_dur
FROM ${EV} e JOIN pu p ON e.user_id::VARCHAR = p.uid
WHERE e.event = 'playback completed' AND e.watch_duration_min IS NOT NULL
GROUP BY (CASE WHEN p.rcs BETWEEN 4 AND 6 THEN 'sweet' WHEN p.rcs >= 7 THEN 'over' ELSE 'low' END)`,
				},
				assert: (rows) => {
					const sweet = rows.find(r => r.bucket === "sweet");
					const over = rows.find(r => r.bucket === "over");
					if (!sweet || !over) return { verdict: "NONE", detail: "sweet/over buckets missing" };
					const ratio = Number(over.avg_dur) / Number(sweet.avg_dur);
					const detail = `over ${Number(over.avg_dur).toFixed(1)} vs sweet ${Number(sweet.avg_dur).toFixed(1)} min = ${ratio.toFixed(3)}x (mechanism 0.40 exact; over n=${over.users})`;
					return guarded(Number(over.users) >= 2850 && Number(sweet.users) >= 1390, detail,
						() => bandVerdict(ratio, [0.35, 0.46], [0.28, 0.55], detail, v => v >= 0.90));
				},
			},
		],
	},
	{
		id: "media-h10-plan-scaling",
		hook: "H10",
		archetype: "funnel-ttc-by-segment",
		narrative: "Plan scaling applied once: premium 0.67x, free 1.4x on watch_duration_min AND on the first core-viewing funnel's step gaps. Insights read: free/premium ~2.0x duration. Funnel read: TTC medians at a 6-HOUR window — the within-session read. At multi-day windows every plan's TTC distribution is bimodal (compressed within-session mode vs 6-72h cross-session organic tail) with the median sitting on the ~50% mode boundary; it flips between modes on sampling noise (2K read 0.70 prem/std, 10K read 1.14 from the same config). At 6h the distributions are unimodal and scale-stable: free 2.11h / std 1.52h / prem 1.01h medians at both 2K and 10K. Identity invariants ride along.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT subscription_plan AS plan, count(*) AS n, avg(watch_duration_min) AS avg_dur
FROM ${EV}
WHERE event = 'playback completed' AND watch_duration_min IS NOT NULL AND subscription_plan IS NOT NULL
GROUP BY subscription_plan`,
				},
				assert: (rows) => {
					const free = rows.find(r => r.plan === "free");
					const prem = rows.find(r => r.plan === "premium");
					const std = rows.find(r => r.plan === "standard");
					if (!free || !prem || !std) return { verdict: "NONE", detail: "plan buckets missing" };
					const ratio = Number(free.avg_dur) / Number(prem.avg_dur);
					const ordered = Number(prem.avg_dur) < Number(std.avg_dur) && Number(std.avg_dur) < Number(free.avg_dur);
					const detail = `free ${Number(free.avg_dur).toFixed(1)} / premium ${Number(prem.avg_dur).toFixed(1)} = ${ratio.toFixed(3)}x (mechanism 2.09 diluted; standard ${Number(std.avg_dur).toFixed(1)} ordered=${ordered})`;
					return guarded(Number(prem.n) >= 8300 && Number(free.n) >= 18900, detail, () => {
						if (!ordered) return { verdict: "WEAK", detail: `${detail} — plan ordering broken` };
						return bandVerdict(ratio, [1.85, 2.20], [1.60, 2.40], detail, v => v <= 1.10);
					});
				},
			},
			{
				breakdown: {
					type: "timeToConvert",
					steps: ["content browsed", "content selected", "playback started", "playback completed"],
					breakdownByUserProperty: "subscription_plan",
					conversionWindowMs: 6 * 3600 * 1000,
				},
				assert: (rows) => {
					const cell = Object.fromEntries(rows.map(r => [r.segment_value, r]));
					const med = t => cell[t] ? Number(cell[t].median_ttc_ms) : null;
					if (!med("free") || !med("premium") || !med("standard")) return { verdict: "NONE", detail: "plan TTC cells missing" };
					const freePrem = med("free") / med("premium");
					const premStd = med("premium") / med("standard");
					const detail = `TTC free/premium=${freePrem.toFixed(2)} (mechanism 2.09), premium/standard=${premStd.toFixed(2)} (mechanism 0.67); free n=${cell.free.user_count} premium n=${cell.premium.user_count} (6h window)`;
					return guarded(Number(cell.free.user_count) >= 360 && Number(cell.premium.user_count) >= 170, detail, () => {
						const v1 = bandVerdict(freePrem, [1.90, 2.30], [1.60, 2.60], detail, v => v <= 1.10);
						const v2 = bandVerdict(premStd, [0.61, 0.73], [0.52, 0.85], detail, v => v >= 1.00);
						const order = ["INVERSE", "NONE", "WEAK", "STRONG", "NAILED"];
						const verdict = order.find(o => v1.verdict === o || v2.verdict === o) || "NONE";
						return { verdict, detail };
					});
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT
  avg((user_id IS NOT NULL)::INT) AS uid_share,
  avg((device_id IS NOT NULL)::INT) AS device_share,
  avg((subscription_plan IS NOT NULL)::INT) AS plan_share,
  count(DISTINCT device_id)::DOUBLE / count(DISTINCT user_id) AS devices_per_user
FROM ${EV}`,
				},
				assert: (rows) => {
					const r = rows[0] || {};
					const uid = Number(r.uid_share), dev = Number(r.device_share), plan = Number(r.plan_share), dpu = Number(r.devices_per_user);
					const detail = `uid=${uid.toFixed(4)} device=${dev.toFixed(4)} plan=${plan.toFixed(4)} devices/user=${dpu.toFixed(2)} (avgDevicePerUser=2)`;
					if (uid < 0.9) return { verdict: "INVERSE", detail };
					if (uid === 1 && dev >= 0.99 && plan >= 0.995 && dpu >= 1.6 && dpu <= 2.4) return { verdict: "NAILED", detail };
					if (uid >= 0.999 && dev >= 0.98 && plan >= 0.99) return { verdict: "STRONG", detail };
					return { verdict: "WEAK", detail };
				},
			},
		],
	},
];
