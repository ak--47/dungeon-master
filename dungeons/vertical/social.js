// ── TWEAK THESE ──
const SEED = "harness-social";
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

/*
 * =====================================================================================
 * DATASET OVERVIEW
 * =====================================================================================
 *
 * Chirp — A Twitter+Instagram-style social media platform with algorithmic feed,
 * creator monetization, communities, and direct messaging.
 *
 * CORE LOOP:
 * Users sign up, build a profile, follow people, consume content in their feed,
 * create their own posts/stories, and engage via likes, shares, and comments.
 * Power users become "creators" with subscriber tiers. Monetization through
 * native ads woven into feed and story placements.
 *
 * - 5,000 users over 100 days
 * - 600,000 base events across 18 event types
 * - 8 funnels (onboarding, engagement, discovery, creator journey, ads)
 * - Group analytics (100 communities)
 * - Account types: personal, creator, business
 * =====================================================================================
 */

/*
 * =====================================================================================
 * ANALYTICS HOOKS (10 hooks)
 *
 * Adds 10. ONBOARDING TIME-TO-CONVERT: creator/business 0.71x faster, personal
 * 1.25x slower (funnel-post). Discover via Onboarding funnel median TTC by account_type.
 * =====================================================================================
 *
 * NOTE: All cohort effects are HIDDEN — discoverable only via behavioral cohorts
 * (count an event per user, then measure downstream). No cohort flag is stamped
 * on events. Algorithm-change source flips and engagement-bait short durations
 * are raw mutations of config-defined props.
 *
 * -------------------------------------------------------------------------------------
 * 1. VIRAL CONTENT CASCADE (everything)
 * -------------------------------------------------------------------------------------
 *
 * PATTERN: 5% of users with 10+ "post created" events become viral creators.
 * Each of their posts triggers 10-20 cloned post-viewed, post-liked, and
 * post-shared events with unique offset timestamps.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Engagement per Post Created (cohort)
 *   - Report type: Insights (with cohort)
 *   - Cohort A: users with >= 10 "post created"
 *   - Cohort B: users with < 10 "post created"
 *   - Event: "post viewed"
 *   - Measure: Total per user
 *   - Compare A vs B
 *   - Expected: cohort A ~ 10-20x more views per user than B
 *
 *   Report 2: Likes per User by Post-Created Bucket
 *   - Report type: Insights (with cohort)
 *   - Same cohorts
 *   - Event: "post liked"
 *   - Measure: Total per user
 *   - Expected: A ~ 10-20x more likes per user than B
 *
 * REAL-WORLD ANALOGUE: A small share of creators drive a disproportionate
 * fraction of all platform engagement.
 *
 * -------------------------------------------------------------------------------------
 * 2. FOLLOW-BACK SNOWBALL (everything)
 * -------------------------------------------------------------------------------------
 *
 * PATTERN: Users with 5+ "user followed" events have 50% of their posts
 * duplicated with a 30-240 minute offset, plus an extra comment cloned.
 * No flag — discover by binning users on user-followed count.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Posts per User by Follow Activity
 *   - Report type: Insights (with cohort)
 *   - Cohort A: users with >= 5 "user followed"
 *   - Cohort B: users with < 5 "user followed"
 *   - Event: "post created"
 *   - Measure: Total per user
 *   - Expected: A ~ 1.5x posts per user vs B
 *
 * REAL-WORLD ANALOGUE: Users who actively follow many people tend to
 * receive follow-backs and post more frequently.
 *
 * -------------------------------------------------------------------------------------
 * 3. ALGORITHM CHANGE (event)
 * -------------------------------------------------------------------------------------
 *
 * PATTERN: On day 45, the dominant `source` for "post viewed" flips from
 * "feed" (70% pre) to "explore" (70% post). Mutates an existing config-
 * defined prop — no flag.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Source Distribution Over Time
 *   - Report type: Insights
 *   - Event: "post viewed"
 *   - Measure: Total
 *   - Breakdown: "source"
 *   - Line chart by day
 *   - Expected: feed dominates pre-day-45; explore dominates post-day-45
 *
 * REAL-WORLD ANALOGUE: Algorithmic feed redesigns shift content discovery
 * from chronological to interest-based.
 *
 * -------------------------------------------------------------------------------------
 * 4. ENGAGEMENT BAIT (event)
 * -------------------------------------------------------------------------------------
 *
 * PATTERN: 20% of "post viewed" events get view_duration_sec collapsed
 * to 1-5 seconds. No flag — analyst sees a bimodal duration distribution.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: View Duration Distribution
 *   - Report type: Insights
 *   - Event: "post viewed"
 *   - Measure: Distribution of "view_duration_sec"
 *   - Expected: ~ 20% of values cluster at 1-5 sec; rest at 5-120 sec
 *
 * REAL-WORLD ANALOGUE: Clickbait posts collect impressions but bounce
 * quality is awful, dragging down avg watch time.
 *
 * -------------------------------------------------------------------------------------
 * 5. NOTIFICATION RE-ENGAGEMENT (event)
 * -------------------------------------------------------------------------------------
 *
 * PATTERN: After day 30, 30% of "post viewed" events have source flipped
 * to "notification". Mutates the existing config-defined `source` prop.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Notification-Sourced Views Over Time
 *   - Report type: Insights
 *   - Event: "post viewed"
 *   - Measure: Total
 *   - Filter: source = "notification"
 *   - Line chart by day
 *   - Expected: near-zero before day 30, then ~ 30% of views
 *
 * REAL-WORLD ANALOGUE: Push notifications about trending content are a
 * primary lever for waking up dormant users.
 *
 * -------------------------------------------------------------------------------------
 * 6. CREATOR MONETIZATION (everything)
 * -------------------------------------------------------------------------------------
 *
 * PATTERN: Users with any "creator subscription started" event get 2 extra
 * cloned posts and stories per original (3x rate), plus 25% extra cloned
 * post-viewed events from `source="profile"`. No flag — discover via
 * cohort builder.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Posts per User — Subscribers vs Not
 *   - Report type: Insights (with cohort)
 *   - Cohort A: users with >= 1 "creator subscription started"
 *   - Cohort B: users with 0
 *   - Event: "post created"
 *   - Measure: Total per user
 *   - Expected: A ~ 3x posts per user
 *
 * REAL-WORLD ANALOGUE: Creators with paying subscribers publish more often.
 *
 * -------------------------------------------------------------------------------------
 * 7. TOXICITY CHURN (everything)
 * -------------------------------------------------------------------------------------
 *
 * PATTERN: Users with 3+ "report submitted" events lose 60% of activity
 * after day 30. No flag — discover via retention or per-user activity drop.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Retention by Toxicity
 *   - Report type: Retention
 *   - Cohort A: users with >= 3 "report submitted"
 *   - Cohort B: rest
 *   - Expected: A ~ 40% retention vs B ~ 80%
 *
 * REAL-WORLD ANALOGUE: Repeated reporters are signaling dissatisfaction
 * and often quietly churn.
 *
 * -------------------------------------------------------------------------------------
 * 8. WEEKEND CONTENT SURGE (everything)
 * -------------------------------------------------------------------------------------
 *
 * PATTERN: 30% of Sat/Sun "post created" and "story created" events get a
 * duplicate cloned 1-3 hours later. No flag — discover via day-of-week chart.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Posts by Day of Week
 *   - Report type: Insights
 *   - Event: "post created"
 *   - Measure: Total
 *   - Breakdown: Day of week
 *   - Expected: Sat/Sun ~ 1.3x weekday bars
 *
 * REAL-WORLD ANALOGUE: Weekend leisure time produces a natural creation surge.
 *
 * -------------------------------------------------------------------------------------
 * 9. POST-CREATED MAGIC NUMBER (everything)
 * -------------------------------------------------------------------------------------
 *
 * PATTERN: Users in the 3-7 post-created sweet spot get +40% comment_length
 * on their comment-posted events (richer engagement). Users with 8+ posts
 * are over-engaged (burnout); ~30% of their post-liked and comment-posted
 * events are dropped. No flag — discover by binning users on post count.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Comment Length by Post Bucket
 *   - Report type: Insights (with cohort)
 *   - Cohort A: users with 3-7 "post created"
 *   - Cohort B: users with 0-2 "post created"
 *   - Event: "comment posted"
 *   - Measure: Average of "comment_length"
 *   - Expected: A ~ 1.4x B
 *
 *   Report 2: Engagement Drop on Heavy Posters
 *   - Report type: Insights (with cohort)
 *   - Cohort C: users with >= 8 "post created"
 *   - Cohort A: users with 3-7 "post created"
 *   - Event: "post liked" + "comment posted" (combined per user)
 *   - Measure: Total per user
 *   - Expected: C ~ 30% fewer engagement events per user vs A
 *
 * REAL-WORLD ANALOGUE: Moderate posters write thoughtful comments; the
 * over-prolific tend to spam and burn through audience patience.
 *
 * =====================================================================================
 * EXPECTED METRICS SUMMARY
 * =====================================================================================
 *
 * Hook                      | Metric                  | Baseline | Hook Effect | Ratio
 * --------------------------|-------------------------|----------|-------------|------
 * Viral Content Cascade     | Engagement per user     | 1x       | ~ 15x       | ~ 15x
 * Follow-Back Snowball      | Posts per user           | 1x       | ~ 1.5x      | 1.5x
 * Algorithm Change          | feed vs explore (post)   | 70/15    | 15/70       | flip
 * Engagement Bait           | View duration distrib    | unimodal | bimodal     | n/a
 * Notification Re-engage    | source=notification %    | ~ 10%    | ~ 30%       | 3x
 * Creator Monetization      | Content rate (sub vs not)| 1x       | ~ 3x        | 3x
 * Toxicity Churn            | Post-day-30 activity     | 1x       | ~ 0.4x      | -60%
 * Weekend Surge             | Weekend vs weekday       | 1x       | ~ 1.3x      | 1.3x
 * Post-Created Magic Number | sweet comment_length     | 1x       | ~ 1.4x      | 1.4x
 * Post-Created Magic Number | over engagement/user     | 1x       | ~ 0.7x      | -30%
 * =====================================================================================
 */

// Generate consistent post IDs for lookup tables
const postIds = v.range(1, 1001).map(n => `post_${v.uid(8)}`);

/** @type {Config} */
const config = {
	token,
	seed: SEED,
	datasetStart: "2026-01-01T00:00:00Z",
	datasetEnd: "2026-04-28T23:59:59Z",
	soup: { dayOfWeekWeights: [1.0, 1.0, 1.0, 1.0, 1.0, 1.2, 1.2] },
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
	scdProps: {
		account_type: {
			values: ["personal", "creator", "business", "verified"],
			frequency: "month",
			timing: "fuzzy",
			max: 6
		},
		community_status: {
			values: ["new", "growing", "established", "featured"],
			frequency: "month",
			timing: "fixed",
			max: 6,
			type: "community_id"
		}
	},

	funnels: [
		{
			sequence: ["account created", "profile updated", "post created"],
			isFirstFunnel: true,
			conversionRate: 70,
			timeToConvert: 0.5,
		},
		{
			// Feed consumption: view → like → comment (most common loop)
			sequence: ["post viewed", "post liked", "comment posted"],
			conversionRate: 45,
			timeToConvert: 0.5,
			weight: 6,
		},
		{
			// Content creation cycle: create → views → engagement
			sequence: ["post created", "post viewed", "post liked", "post shared"],
			conversionRate: 30,
			timeToConvert: 3,
			weight: 3,
		},
		{
			// Stories engagement
			sequence: ["story created", "story viewed", "dm sent"],
			conversionRate: 40,
			timeToConvert: 1,
			weight: 3,
		},
		{
			// Discovery and follow loop
			sequence: ["search performed", "post viewed", "user followed"],
			conversionRate: 35,
			timeToConvert: 1,
			weight: 2,
		},
		{
			// Notifications driving re-engagement
			sequence: ["notification received", "post viewed", "post liked"],
			conversionRate: 50,
			timeToConvert: 0.5,
			weight: 2,
		},
		{
			// Profile management and creator monetization
			sequence: ["profile updated", "creator subscription started", "post created"],
			conversionRate: 15,
			timeToConvert: 24,
			weight: 1,
		},
		{
			// Ad interaction and moderation
			sequence: ["ad viewed", "ad clicked", "report submitted"],
			conversionRate: 20,
			timeToConvert: 2,
			weight: 1,
		},
	],

	events: [
		{
			event: "account created",
			weight: 1,
			isFirstEvent: true,
			properties: {
				"signup_method": ["email", "google", "apple", "sso"],
				"referred_by": ["organic", "friend", "ad", "influencer"],
			}
		},
		{
			event: "post created",
			weight: 12,
			properties: {
				"post_type": ["text", "image", "video", "poll", "link"],
				"character_count": u.weighNumRange(1, 280),
				"has_media": [false, false, false, true, true],
				"hashtag_count": u.weighNumRange(0, 10, 0.5),
			}
		},
		{
			event: "post viewed",
			weight: 30,
			properties: {
				"post_type": ["text", "image", "video", "poll", "link"],
				"view_duration_sec": u.weighNumRange(1, 120, 0.3, 5),
				"source": ["feed", "explore", "search", "profile", "notification"],
			}
		},
		{
			event: "post liked",
			weight: 18,
			properties: {
				"post_type": ["text", "image", "video", "poll", "link"],
			}
		},
		{
			event: "post shared",
			weight: 6,
			properties: {
				"share_destination": ["repost", "dm", "external", "copy_link"],
			}
		},
		{
			event: "comment posted",
			weight: 10,
			properties: {
				"comment_length": u.weighNumRange(1, 500, 0.3, 20),
				"has_mention": [true, false, false],
			}
		},
		{
			event: "user followed",
			weight: 8,
			properties: {
				"discovery_source": ["suggested", "search", "post", "profile", "mutual"],
			}
		},
		{
			event: "user unfollowed",
			weight: 2,
			properties: {
				"reason": ["content_quality", "too_frequent", "lost_interest", "offensive"],
			}
		},
		{
			event: "story viewed",
			weight: 15,
			properties: {
				"story_type": ["photo", "video", "text"],
				"view_duration_sec": u.weighNumRange(1, 30, 0.5, 5),
				"completed": [false, false, true, true, true],
			}
		},
		{
			event: "story created",
			weight: 5,
			properties: {
				"story_type": ["photo", "video", "text"],
				"has_filter": [true, false],
				"has_sticker": [false, false, true],
			}
		},
		{
			event: "search performed",
			weight: 7,
			properties: {
				"search_type": ["users", "hashtags", "posts"],
				"results_count": u.weighNumRange(0, 50, 0.5, 10),
			}
		},
		{
			event: "notification received",
			weight: 12,
			properties: {
				"notification_type": ["like", "follow", "comment", "mention", "trending"],
				"clicked": [false, false, false, true, true],
			}
		},
		{
			event: "dm sent",
			weight: 8,
			properties: {
				"message_type": ["text", "image", "voice", "link"],
				"conversation_length": u.weighNumRange(1, 100),
			}
		},
		{
			event: "ad viewed",
			weight: 10,
			properties: {
				"ad_format": ["feed_native", "story", "banner", "video"],
				"ad_category": ["retail", "tech", "food", "finance", "entertainment"],
				"view_duration_sec": u.weighNumRange(1, 30, 0.3),
			}
		},
		{
			event: "ad clicked",
			weight: 2,
			properties: {
				"ad_format": ["feed_native", "story", "banner", "video"],
				"ad_category": ["retail", "tech", "food", "finance", "entertainment"],
			}
		},
		{
			event: "report submitted",
			weight: 1,
			properties: {
				"report_type": ["spam", "harassment", "misinformation", "hate_speech", "other"],
				"content_type": ["post", "comment", "user", "dm"],
			}
		},
		{
			event: "profile updated",
			weight: 3,
			properties: {
				"field_updated": ["bio", "avatar", "display_name", "privacy_settings", "interests"],
			}
		},
		{
			event: "creator subscription started",
			weight: 2,
			properties: {
				"tier": ["basic", "premium", "vip"],
				"price_usd": [4.99, 9.99, 19.99],
			}
		},
	],

	superProps: {
		app_version: ["4.0", "4.1", "4.2", "4.3", "5.0"],
		account_type: ["personal", "creator", "business"],
	},

	userProps: {
		app_version: ["4.0", "4.1", "4.2", "4.3", "5.0"],
		account_type: ["personal", "creator", "business"],
		"follower_count": u.weighNumRange(0, 10000, 0.2, 50),
		"following_count": u.weighNumRange(0, 5000, 0.3, 100),
		"bio_length": u.weighNumRange(0, 160),
		"verified": [false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false, true],
		"content_niche": ["lifestyle", "tech", "food", "fitness", "travel", "comedy", "news", "art"],
	},

	groupKeys: [
		["community_id", 100, ["post created", "comment posted", "post liked", "post shared"]],
	],

	groupProps: {
		community_id: {
			"name": () => `${chance.word()} ${chance.pickone(["Hub", "Circle", "Squad", "Zone", "Space"])}`,
			"member_count": u.weighNumRange(50, 5000, 0.3, 200),
			"category": ["technology", "entertainment", "sports", "politics", "art", "science"],
			"is_moderated": [false, false, false, true, true, true, true, true, true, true],
		}
	},

	lookupTables: [],

	hook: function (record, type, meta) {
		// Hook #10 (T2C): ONBOARDING TIME-TO-CONVERT (funnel-post)
		// Creator/business account_type users complete onboarding 1.4x
		// faster (factor 0.71); personal accounts 1.25x slower (factor 1.25).
		if (type === "funnel-post") {
			const segment = meta?.profile?.account_type;
			if (Array.isArray(record) && record.length > 1) {
				const factor = (
					segment === "creator" || segment === "business" ? 0.71 :
					segment === "personal" ? 1.25 :
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


		// ─── EVENT-LEVEL HOOKS ───────────────────────────────────────────

		if (type === "event") {
			const datasetStart = dayjs.unix(meta.datasetStart);
			const ALGORITHM_CHANGE_DAY = datasetStart.add(45, 'days');
			const REENGAGEMENT_START = datasetStart.add(30, 'days');
			const EVENT_TIME = dayjs(record.time);

			// Hook #3: ALGORITHM CHANGE - Day 45 flips feed -> explore.
			// Mutates the existing config-defined `source` prop.
			if (record.event === "post viewed") {
				if (EVENT_TIME.isAfter(ALGORITHM_CHANGE_DAY)) {
					if (chance.bool({ likelihood: 70 })) {
						record.source = "explore";
					}
				} else {
					if (chance.bool({ likelihood: 70 })) {
						record.source = "feed";
					}
				}
			}

			// Hook #4: ENGAGEMENT BAIT - 20% of post views get crushed view duration.
			// No flag — analyst sees bimodal duration distribution + low-tail share.
			if (record.event === "post viewed") {
				if (chance.bool({ likelihood: 20 })) {
					record.view_duration_sec = chance.integer({ min: 1, max: 5 });
				}

				// Hook #5: NOTIFICATION RE-ENGAGEMENT — after day 30, 30% of views
				// flip source to "notification". Mutates existing source prop.
				if (EVENT_TIME.isAfter(REENGAGEMENT_START) && chance.bool({ likelihood: 30 })) {
					record.source = "notification";
				}
			}
		}

		// ─── EVERYTHING-LEVEL HOOKS ──────────────────────────────────────

		if (type === "everything") {
			const datasetStart = dayjs.unix(meta.datasetStart);
			const userEvents = record;
			if (!userEvents || userEvents.length === 0) return record;

			// Stamp superProps from profile for consistency
			const profile = meta.profile;
			userEvents.forEach(e => {
				e.app_version = profile.app_version;
				e.account_type = profile.account_type;
			});

			// First pass: identify behavioral patterns (no flags written)
			let postCreatedCount = 0;
			let followReceivedCount = 0;
			let reportSubmittedCount = 0;
			let hasCreatorSubscription = false;
			let isViralCreator = false;

			userEvents.forEach((event) => {
				if (event.event === "post created") postCreatedCount++;
				if (event.event === "user followed") followReceivedCount++;
				if (event.event === "report submitted") reportSubmittedCount++;
				if (event.event === "creator subscription started") hasCreatorSubscription = true;
			});

			if (postCreatedCount >= 10 && chance.bool({ likelihood: 5 })) {
				isViralCreator = true;
			}

			// Second pass: inject cloned events (no behavioral cohort flags)
			for (let idx = userEvents.length - 1; idx >= 0; idx--) {
				const event = userEvents[idx];
				const eventTime = dayjs(event.time);

				// Hook #1: VIRAL CONTENT CASCADE — clone 10-20 view/like/share per post.
				// Discovery: bin users by post-created count, observe per-user view/like/share volume.
				if (isViralCreator && event.event === "post created") {
					const viralViews = chance.integer({ min: 60, max: 120 });
					const viralLikes = chance.integer({ min: 60, max: 120 });
					const viralShares = chance.integer({ min: 60, max: 120 });
					const injected = [];

					const viewTemplate = userEvents.find(e => e.event === "post viewed");
					const likeTemplate = userEvents.find(e => e.event === "post liked");
					const shareTemplate = userEvents.find(e => e.event === "post shared");

					for (let i = 0; i < viralViews; i++) {
						injected.push({
							...(viewTemplate || event),
							event: "post viewed",
							time: eventTime.add(chance.integer({ min: 1, max: 180 }), 'minutes').toISOString(),
							user_id: event.user_id,
							post_type: event.post_type || "text",
							source: chance.pickone(["feed", "explore", "search"]),
							view_duration_sec: chance.integer({ min: 5, max: 90 }),
						});
					}
					for (let i = 0; i < viralLikes; i++) {
						injected.push({
							...(likeTemplate || event),
							event: "post liked",
							time: eventTime.add(chance.integer({ min: 2, max: 240 }), 'minutes').toISOString(),
							user_id: event.user_id,
							post_type: event.post_type || "text",
						});
					}
					for (let i = 0; i < viralShares; i++) {
						injected.push({
							...(shareTemplate || event),
							event: "post shared",
							time: eventTime.add(chance.integer({ min: 5, max: 300 }), 'minutes').toISOString(),
							user_id: event.user_id,
							share_destination: chance.pickone(["repost", "dm", "external", "copy_link"]),
						});
					}

					userEvents.splice(idx + 1, 0, ...injected);
				}

				// Hook #2: FOLLOW-BACK SNOWBALL — extra post + comment per user-followed cluster.
				// Discovery: cohort users with >=5 user-followed events, compare posts/user.
				if (followReceivedCount >= 5 && event.event === "post created") {
					if (chance.bool({ likelihood: 50 })) {
						const commentTemplate = userEvents.find(e => e.event === "comment posted");
						const duplicatePost = {
							...event,
							time: eventTime.add(chance.integer({ min: 30, max: 240 }), 'minutes').toISOString(),
							user_id: event.user_id,
							post_type: chance.pickone(["text", "image", "video"]),
							character_count: chance.integer({ min: 10, max: 280 }),
							has_media: chance.bool({ likelihood: 60 }),
							hashtag_count: chance.integer({ min: 0, max: 5 }),
						};
						const extraComment = {
							...(commentTemplate || event),
							event: "comment posted",
							time: eventTime.add(chance.integer({ min: 10, max: 120 }), 'minutes').toISOString(),
							user_id: event.user_id,
							comment_length: chance.integer({ min: 5, max: 200 }),
							has_mention: chance.bool({ likelihood: 40 }),
						};
						userEvents.splice(idx + 1, 0, duplicatePost, extraComment);
					}
				}

				// Hook #6: CREATOR MONETIZATION — 3x post/story rate for subscribers.
				// Discovery: cohort users with creator-subscription-started event, compare posts/user.
				if (hasCreatorSubscription && event.event === "post created") {
					for (let i = 0; i < 2; i++) {
						const extraPost = {
							...event,
							time: eventTime.add(chance.integer({ min: 1, max: 12 }), 'hours').toISOString(),
							user_id: event.user_id,
							post_type: chance.pickone(["text", "image", "video", "link"]),
							character_count: chance.integer({ min: 20, max: 280 }),
							has_media: chance.bool({ likelihood: 70 }),
							hashtag_count: chance.integer({ min: 1, max: 8 }),
						};
						userEvents.splice(idx + 1, 0, extraPost);
					}
				}
				if (hasCreatorSubscription && event.event === "story created") {
					for (let i = 0; i < 2; i++) {
						const extraStory = {
							...event,
							time: eventTime.add(chance.integer({ min: 1, max: 8 }), 'hours').toISOString(),
							user_id: event.user_id,
							story_type: chance.pickone(["photo", "video", "text"]),
							has_filter: chance.bool({ likelihood: 60 }),
							has_sticker: chance.bool({ likelihood: 40 }),
						};
						userEvents.splice(idx + 1, 0, extraStory);
					}
				}
				if (hasCreatorSubscription && event.event === "post viewed") {
					if (chance.bool({ likelihood: 25 })) {
						const analyticsView = {
							...event,
							time: eventTime.add(chance.integer({ min: 1, max: 30 }), 'minutes').toISOString(),
							user_id: event.user_id,
							post_type: event.post_type || "text",
							source: "profile",
							view_duration_sec: chance.integer({ min: 10, max: 60 }),
						};
						userEvents.splice(idx + 1, 0, analyticsView);
					}
				}
			}

			// Hook #8: WEEKEND CONTENT SURGE — duplicate weekend posts/stories with offset.
			// Discovery: line chart by day-of-week shows Sat/Sun bump.
			for (let idx = userEvents.length - 1; idx >= 0; idx--) {
				const event = userEvents[idx];
				if (event.event === "post created" || event.event === "story created") {
					const dow = new Date(event.time).getUTCDay();
					if ((dow === 0 || dow === 6) && chance.bool({ likelihood: 30 })) {
						const etime = dayjs(event.time);
						const dup = {
							...event,
							time: etime.add(chance.integer({ min: 1, max: 3 }), 'hours').toISOString(),
						};
						userEvents.splice(idx + 1, 0, dup);
					}
				}
			}

			// Hook #7: TOXICITY CHURN — drop 60% of activity after day 30 for high reporters.
			// Discovery: cohort users with >=3 report-submitted events, observe retention drop.
			if (reportSubmittedCount >= 3) {
				const churnCutoff = datasetStart.add(30, 'days');
				for (let i = userEvents.length - 1; i >= 0; i--) {
					const evt = userEvents[i];
					if (dayjs(evt.time).isAfter(churnCutoff) && chance.bool({ likelihood: 60 })) {
						userEvents.splice(i, 1);
					}
				}
			}

			// Hook #9: POST-CREATED MAGIC NUMBER (no flags)
			// Sweet 3-7 posts → +40% on comment_length on the user's comment events.
			// Over 8+ → drop 30% of like/comment events (engagement burnout).
			if (postCreatedCount >= 3 && postCreatedCount <= 7) {
				userEvents.forEach(e => {
					if (e.event === 'comment posted' && typeof e.comment_length === 'number') {
						e.comment_length = Math.round(e.comment_length * 1.4);
					}
				});
			} else if (postCreatedCount >= 8) {
				userEvents.forEach(e => {
					if (e.event === 'comment posted' && typeof e.comment_length === 'number') {
						e.comment_length = Math.round(e.comment_length * 0.7);
					}
				});
			}
		}

		return record;
	}
};

export default config;
