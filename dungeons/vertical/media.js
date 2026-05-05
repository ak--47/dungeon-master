// ── TWEAK THESE ──
const SEED = "harness-media";
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

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * DATASET OVERVIEW — STREAMVAULT VIDEO STREAMING PLATFORM
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * StreamVault is a Netflix/Hulu-style video streaming platform where users browse a rich
 * catalog of movies, series, documentaries, and specials. Users manage watchlists, watch
 * content with configurable playback options, rate and share content, and manage family
 * profiles under a single account.
 *
 * - 10,000 users over 120 days
 * - ~600,000 events across 17 event types
 * - 9 funnels (onboarding, content discovery, engagement loop, search, watchlist, etc.)
 * - Subscription tiers: Free (ad-supported), Standard ($9.99/mo), Premium ($14.99/mo)
 * - Device types: Smart TV, Mobile, Tablet, Laptop, Desktop
 * - Content catalog: 500 titles with genres, types, and a blockbuster release event
 *
 * Core loop: onboarding -> discovery -> consumption -> engagement -> monetization.
 * Users land on a personalized home screen, discover content via browse/search/recommendations,
 * watch with quality and subtitle options, rate and share, and manage subscriptions.
 * Profile switching (main, kids, partner, guest) reveals household dynamics.
 */

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ANALYTICS HOOKS (10 hooks)
 *
 * Adds 10. CORE VIEWING LOOP TIME-TO-CONVERT: premium 0.71x faster, free 1.25x
 * slower (funnel-post). Discover via funnel median TTC by subscription_plan.
 * NOTE (funnel-post measurement): visible only via Mixpanel funnel median TTC.
 * Cross-event MIN→MIN SQL queries on raw events do NOT show this.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
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
 */

// Generate consistent content IDs for lookup tables and events
const contentIds = v.range(1, 501).map(n => `content_${v.uid(8)}`);
const blockbusterId = `blockbuster_${v.uid(8)}`;

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
			properties: {
				"content_type": ["movie", "series", "documentary", "special"],
				"genre": ["action", "comedy", "drama", "documentary", "horror", "sci_fi", "animation", "thriller", "romance"],
				"content_id": contentIds,
			}
		},
		{
			event: "playback started",
			weight: 18,
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
			properties: {
				"content_id": contentIds,
				"pause_reason": ["manual", "ad_break", "buffering", "notification"],
			}
		},
		{
			event: "content rated",
			weight: 6,
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

	hook: function (record, type, meta) {
		// Hook #10 (T2C): CORE VIEWING LOOP TIME-TO-CONVERT (funnel-post)
		// Premium subscribers complete browse→play funnel 1.4x faster
		// (factor 0.71); free users 1.25x slower (factor 1.25).
		if (type === "funnel-post") {
			const segment = meta?.profile?.subscription_plan;
			if (Array.isArray(record) && record.length > 1) {
				const factor = (
					segment === "premium" ? 0.71 :
					segment === "free" ? 1.25 :
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

		if (type === "event") {
			// Hook #6: KIDS PROFILE SAFETY — 15% of selections/starts get genre
			// restricted to animation or documentary. Mutates existing genre prop.
			if (chance.bool({ likelihood: 15 })) {
				if (record.event === "content selected" || record.event === "playback started") {
					record.genre = chance.pickone(["animation", "documentary"]);
				}
			}

			return record;
		}

		if (type === "everything") {
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

			// Hook #5: NEW RELEASE SPIKE — days 50-65, 20% of selections/starts
			// switch to the blockbuster id. Mutates existing content_id/content_type props.
			// (Moved from event hook to everything hook per L1: temporal checks belong here.)
			const BLOCKBUSTER_START = datasetStart.add(50, 'days');
			const BLOCKBUSTER_END = datasetStart.add(65, 'days');
			for (const e of userEvents) {
				const eventTime = dayjs(e.time);
				if (eventTime.isAfter(BLOCKBUSTER_START) && eventTime.isBefore(BLOCKBUSTER_END)) {
					if ((e.event === "content selected" || e.event === "playback started") && chance.bool({ likelihood: 20 })) {
						e.content_type = "movie";
						e.content_id = blockbusterId;
					}
					if (e.event === "content rated" && chance.bool({ likelihood: 20 })) {
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
					e.watch_duration_min = Math.round(e.watch_duration_min * 1.5);
				}
			}

			// Hook #1: GENRE FUNNEL CONVERSION — drop 25% of documentary playback
			// completed events to depress documentary funnel conversion. Raw genre check.
			for (let i = userEvents.length - 1; i >= 0; i--) {
				const evt = userEvents[i];
				if (evt.event === "playback completed" && evt.genre === "documentary" && chance.bool({ likelihood: 25 })) {
					userEvents.splice(i, 1);
				}
			}

			// Hook #7: RECOMMENDATION ENGINE IMPROVEMENT — drop 30% of pre-day-60
			// content rated events. Raw time check.
			const IMPROVEMENT_DATE = datasetStart.add(60, 'days');
			for (let i = userEvents.length - 1; i >= 0; i--) {
				const evt = userEvents[i];
				if (evt.event === "content rated" && dayjs(evt.time).isBefore(IMPROVEMENT_DATE) && chance.bool({ likelihood: 30 })) {
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

			const adCutoff = firstEventTime.add(45, 'days');
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

			const isBingeWatcher = maxConsecutiveCompletions >= 3;

			// Hook #2: BINGE-WATCHING — drop pauses, inject extra start+complete pairs.
			// Cloned events use unique offset timestamps. No flag.
			if (isBingeWatcher) {
				for (let i = userEvents.length - 1; i >= 0; i--) {
					const event = userEvents[i];
					const eventTime = dayjs(event.time);

					if (event.event === "playback paused" && chance.bool({ likelihood: 60 })) {
						userEvents.splice(i, 1);
						continue;
					}

					if (event.event === "playback completed" && chance.bool({ likelihood: 40 })) {
						const nextContentId = chance.pickone(contentIds);
						const startTemplate = userEvents.find(e => e.event === "playback started");
						const extraStart = {
							...(startTemplate || event),
							event: "playback started",
							time: eventTime.add(chance.integer({ min: 1, max: 5 }), 'minutes').toISOString(),
							user_id: event.user_id,
							content_id: nextContentId,
							content_type: "series",
							playback_quality: event.playback_quality || "1080p",
						};
						const extraComplete = {
							...event,
							time: eventTime.add(chance.integer({ min: 25, max: 60 }), 'minutes').toISOString(),
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
							event.completion_percent = Math.min(100, Math.round(event.completion_percent * 1.25));
						}
						if (event.watch_duration_min) {
							event.watch_duration_min = Math.round(event.watch_duration_min * 1.15);
						}
					}
				}

				const completionEvents = userEvents.filter(e => e.event === "playback completed");
				const extraCount = Math.floor(completionEvents.length * 0.2);
				for (let j = 0; j < extraCount; j++) {
					const templateEvent = chance.pickone(completionEvents);
					const templateTime = dayjs(templateEvent.time);
					const extraCompletion = {
						...templateEvent,
						time: templateTime.add(chance.integer({ min: 30, max: 180 }), 'minutes').toISOString(),
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
			if (recClickCount >= 4 && recClickCount <= 6) {
				userEvents.forEach(e => {
					if (e.event === 'playback completed' && typeof e.watch_duration_min === 'number') {
						e.watch_duration_min = Math.round(e.watch_duration_min * 1.25);
					}
				});
			} else if (recClickCount >= 7) {
				for (let i = userEvents.length - 1; i >= 0; i--) {
					const evt = userEvents[i];
					if (evt.event === 'playback completed') {
						// Halve watch duration for surviving events
						if (typeof evt.watch_duration_min === 'number') {
							evt.watch_duration_min = Math.round(evt.watch_duration_min * 0.5);
						}
						// Drop 55% of completions
						if (chance.bool({ likelihood: 55 })) {
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
			if (earlyAdCount >= 5) {
				const churnCutoff = firstEventTime.add(45, 'days');
				for (let i = userEvents.length - 1; i >= 0; i--) {
					const evt = userEvents[i];
					if (dayjs(evt.time).isAfter(churnCutoff)) {
						// Keep only ~5% of post-d45 events (drop 95%)
						const keep = (i % 20) === 0;
						if (!keep) {
							userEvents.splice(i, 1);
						}
					}
				}
			}

			return record;
		}

		return record;
	}
};

export default config;
