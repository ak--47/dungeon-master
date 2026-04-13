import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import "dotenv/config";
import * as u from "../../lib/utils/utils.js";
import * as v from "ak-tools";

const SEED = "dm4-community";
dayjs.extend(utc);
const chance = u.initChance(SEED);
const num_users = 5_000;
const days = 100;
const NOW = dayjs();
const DATASET_START = NOW.subtract(days, "days");

/** @typedef  {import("../../types").Dungeon} Config */

// Generate consistent wiki/article IDs at module level
const wikiIds = v.range(1, 500).map(() => `WIKI_${v.uid(6)}`);
const communityIds = v.range(1, 30).map(() => `COMM_${v.uid(4)}`);

/**
 * ===================================================================
 * DATASET OVERVIEW
 * ===================================================================
 *
 * FanVerse -- a fan wiki and community discussion platform where
 * users create articles, discuss topics, moderate content, and
 * build collaborative knowledge bases across fandoms.
 *
 * - 5,000 users over 100 days, ~600K events
 * - Multi-role system: power creators (5%), moderators (8%),
 *   active contributors (25%), readers (45%), lurkers (17%)
 * - Core loop: sign up -> search -> read articles -> contribute -> discuss
 * - Revenue: free / supporter ($4.99, ad-free) / pro ($12.99, analytics+badges)
 *
 * Advanced Features:
 * - Personas: 5 archetypes (power_creator, moderator, active_contributor, reader, lurker)
 * - Engagement Decay: linear decline with floor
 * - Subscription: 3-tier with supporter and pro plans
 * - Attribution: google_search, reddit_referral, youtube_link, organic
 * - Features: live_discussions (day 25), interactive_polls (day 55)
 *
 * Key entities:
 * - wiki_id: unique wiki article identifier
 * - community_id: community/fandom grouping
 * - content_hub: topical category (gaming, anime, movies, tv, comics, music)
 * - discussion_mode: classic vs live (driven by Feature rollout)
 */

/**
 * ===================================================================
 * ANALYTICS HOOKS (8 hooks)
 * ===================================================================
 *
 * -------------------------------------------------------------------
 * 1. WEEKEND CONTENT SURGE (event hook)
 * -------------------------------------------------------------------
 *
 * PATTERN: Articles published on weekends (Sat/Sun) have 1.5x
 * word_count. Creators have more time on weekends to write longer,
 * more detailed wiki articles.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Weekend vs Weekday Word Count
 *   - Report type: Insights
 *   - Event: "article published"
 *   - Measure: Average of "word_count"
 *   - Breakdown: "is_weekend"
 *   - Expected: is_weekend=true should show ~1.5x avg word_count vs false
 *     (true ~ 2250, false ~ 1500)
 *
 * REAL-WORLD ANALOGUE: Community wikis see longer, more thoughtful
 * contributions on weekends when creators have uninterrupted time.
 *
 * -------------------------------------------------------------------
 * 2. TRENDING TOPIC WINDOW (event hook)
 * -------------------------------------------------------------------
 *
 * PATTERN: During days 35-50, articles in the "gaming" hub get 2x
 * view_count. Simulates a major game release driving traffic to
 * gaming wiki pages.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Gaming Hub View Spike
 *   - Report type: Insights
 *   - Event: "article viewed"
 *   - Measure: Average of "view_count"
 *   - Filter: content_hub = "gaming"
 *   - Line chart by week
 *   - Expected: Clear spike during days 35-50 (~2x normal)
 *
 *   Report 2: Hub Comparison During Trend Window
 *   - Report type: Insights
 *   - Event: "article viewed"
 *   - Measure: Average of "view_count"
 *   - Breakdown: "content_hub"
 *   - Filter: time within trend window
 *   - Expected: gaming ~2x vs other hubs
 *
 * REAL-WORLD ANALOGUE: Major franchise releases (game launches,
 * movie premieres) drive massive traffic spikes to related wikis.
 *
 * -------------------------------------------------------------------
 * 3. POWER CREATOR ENGAGEMENT LIFT (everything hook)
 * -------------------------------------------------------------------
 *
 * PATTERN: Users who published >20 articles get 3x avg upvote_count
 * on their content events. Prolific creators earn community trust
 * and visibility, amplifying their engagement metrics.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Upvote Count by Creator Volume
 *   - Report type: Insights
 *   - Event: "upvote given"
 *   - Measure: Average of "upvote_count"
 *   - Breakdown: user property "role"
 *   - Expected: creators (high volume) show ~3x upvote_count
 *     (creators ~ 15, others ~ 5)
 *
 * REAL-WORLD ANALOGUE: Power contributors on platforms like Fandom
 * and Wikipedia earn disproportionate engagement due to reputation
 * and content quality.
 *
 * -------------------------------------------------------------------
 * 4. DISCUSSION DEPTH BY CONTRIBUTOR TYPE (everything hook)
 * -------------------------------------------------------------------
 *
 * PATTERN: Active contributors (segment "active_contributor") get
 * cloned comment_posted events to simulate deeper discussion threads.
 * Each existing comment has a 50% chance of spawning a follow-up.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Comments Per User by Segment
 *   - Report type: Insights
 *   - Event: "comment posted"
 *   - Measure: Total per user
 *   - Breakdown: user property "segment"
 *   - Expected: active_contributor ~1.5x comments vs others
 *
 * REAL-WORLD ANALOGUE: Engaged contributors create deeper discussion
 * threads, replying to comments and fostering community dialogue.
 *
 * -------------------------------------------------------------------
 * 5. EDIT WAR DETECTION (everything hook)
 * -------------------------------------------------------------------
 *
 * PATTERN: Users with >5 rapid article_edited events within a short
 * window get reduced edit_quality score (set to 1-2 range vs normal
 * 1-5). Simulates contentious edits degrading quality.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Edit Quality by Volume
 *   - Report type: Insights
 *   - Event: "article edited"
 *   - Measure: Average of "edit_quality"
 *   - Breakdown: user property "segment"
 *   - Expected: Users with many edits show lower avg quality
 *     (high-edit users ~ 1.5 vs normal ~ 3.0)
 *
 * REAL-WORLD ANALOGUE: Wiki edit wars (e.g., Wikipedia) degrade
 * content quality as users repeatedly override each other's changes.
 *
 * -------------------------------------------------------------------
 * 6. LURKER CHURN (everything hook)
 * -------------------------------------------------------------------
 *
 * PATTERN: Users with <5 total events lose 60% of events after
 * day 10 of their activity. Simulates lurkers quickly losing
 * interest and churning out.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Event Volume by Segment Over Time
 *   - Report type: Insights
 *   - Event: Any event
 *   - Measure: Total per user
 *   - Breakdown: user property "segment"
 *   - Line chart by week
 *   - Expected: lurker segment drops off sharply after first 10 days
 *
 * REAL-WORLD ANALOGUE: Most community platforms see >60% of new
 * signups become inactive within the first 2-3 weeks.
 *
 * -------------------------------------------------------------------
 * 7. CREATOR PROFILES (user hook)
 * -------------------------------------------------------------------
 *
 * PATTERN: Users with role "creator" get articles_created set to
 * 50-200 range and reputation_score to 80-100. Moderators get
 * mid-range reputation. Readers/lurkers stay at defaults.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Reputation Distribution by Role
 *   - Report type: Insights
 *   - Event: any event
 *   - Measure: Average of user property "reputation_score"
 *   - Breakdown: user property "role"
 *   - Expected: creator ~ 90, moderator ~ 55, reader ~ 25
 *
 *   Report 2: Articles Created by Role
 *   - Report type: Insights
 *   - Measure: Average of user property "articles_created"
 *   - Breakdown: user property "role"
 *   - Expected: creator ~ 125, others ~ 0
 *
 * REAL-WORLD ANALOGUE: Top wiki contributors have hundreds of
 * articles and high community reputation scores.
 *
 * -------------------------------------------------------------------
 * 8. PRO SUBSCRIBER CONTENT CREATION LIFT (funnel-pre hook)
 * -------------------------------------------------------------------
 *
 * PATTERN: Users with subscription_tier "pro" get 1.5x conversion
 * rate on the Content Creation funnel. Pro users have analytics and
 * tools that help them publish more effectively.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Content Creation Conversion by Tier
 *   - Report type: Funnels
 *   - Steps: "article viewed" -> "article published" -> "comment posted"
 *   - Breakdown: "subscription_tier" (superProp)
 *   - Expected: pro ~ 52% vs free ~ 35% conversion
 *
 * REAL-WORLD ANALOGUE: Premium wiki tools (analytics dashboards,
 * badge systems) incentivize more content creation from subscribers.
 *
 * ===================================================================
 * EXPECTED METRICS SUMMARY
 * ===================================================================
 *
 * Hook                          | Metric              | Baseline | Effect  | Ratio
 * ------------------------------|---------------------|----------|---------|------
 * Weekend Content Surge         | word_count          | 1500     | 2250    | 1.5x
 * Trending Topic Window         | view_count (gaming) | 50       | 100     | 2x
 * Power Creator Engagement      | upvote_count        | 5        | 15      | 3x
 * Discussion Depth              | comments/user       | 3        | 4.5     | 1.5x
 * Edit War Detection            | edit_quality        | 3.0      | 1.5     | 0.5x
 * Lurker Churn                  | events after day 10 | 100%     | 40%     | 0.4x
 * Creator Profiles              | reputation_score    | 25       | 90      | 3.6x
 * Pro Content Creation Lift     | funnel conversion   | 35%      | 52%     | 1.5x
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
	hasDesktopDevices: true,
	hasBrowser: false,
	hasCampaigns: false,
	isAnonymous: false,
	hasAdSpend: false,
	percentUsersBornInDataset: 35,
	hasAvatar: true,
	concurrency: 1,
	writeToDisk: false,
	scdProps: {
		contributor_level: {
			values: ["newcomer", "regular", "trusted", "admin"],
			frequency: "month",
			timing: "fuzzy",
			max: 8
		}
	},
	mirrorProps: {},
	lookupTables: [],

	// -- Events (18) --------------------------------------------------
	events: [
		{
			event: "account created",
			weight: 1,
			isFirstEvent: true,
			properties: {
				referral_source: ["organic", "google_search", "reddit_referral", "youtube_link", "friend_invite"],
			},
		},
		{
			event: "article viewed",
			weight: 9,
			properties: {
				wiki_id: chance.pickone.bind(chance, wikiIds),
				content_hub: ["gaming", "anime", "movies", "tv", "comics", "music"],
				view_count: u.weighNumRange(1, 100, 0.4, 50),
				time_on_page_sec: u.weighNumRange(5, 600, 0.4, 45),
				is_weekend: [false],
			},
		},
		{
			event: "article published",
			weight: 3,
			properties: {
				wiki_id: chance.pickone.bind(chance, wikiIds),
				content_hub: ["gaming", "anime", "movies", "tv", "comics", "music"],
				word_count: u.weighNumRange(200, 5000, 0.4, 1500),
				has_images: [true, true, true, false],
				category: ["lore", "character", "episode_guide", "review", "tutorial", "news"],
				is_weekend: [false],
				poll_enabled: [false],
			},
		},
		{
			event: "article edited",
			weight: 4,
			properties: {
				wiki_id: chance.pickone.bind(chance, wikiIds),
				content_hub: ["gaming", "anime", "movies", "tv", "comics", "music"],
				edit_type: ["content", "formatting", "grammar", "citation", "revert"],
				edit_quality: u.weighNumRange(1, 5, 0.8, 3),
				chars_changed: u.weighNumRange(5, 2000, 0.3, 150),
			},
		},
		{
			event: "discussion posted",
			weight: 5,
			properties: {
				community_id: chance.pickone.bind(chance, communityIds),
				content_hub: ["gaming", "anime", "movies", "tv", "comics", "music"],
				topic_type: ["theory", "question", "news", "review", "recommendation", "debate"],
				reply_count: u.weighNumRange(0, 50, 0.3, 5),
				discussion_mode: ["classic"],
			},
		},
		{
			event: "comment posted",
			weight: 6,
			properties: {
				community_id: chance.pickone.bind(chance, communityIds),
				content_hub: ["gaming", "anime", "movies", "tv", "comics", "music"],
				comment_length: u.weighNumRange(10, 500, 0.4, 80),
				is_reply: [true, true, false],
				discussion_mode: ["classic"],
			},
		},
		{
			event: "upvote given",
			weight: 7,
			properties: {
				content_type: ["article", "article", "discussion", "comment"],
				content_hub: ["gaming", "anime", "movies", "tv", "comics", "music"],
				upvote_count: u.weighNumRange(1, 10, 0.5, 5),
			},
		},
		{
			event: "search performed",
			weight: 6,
			properties: {
				search_term: ["walkthrough", "character list", "ending explained", "tier list", "release date", "easter eggs", "best builds", "lore timeline", "voice actors", "soundtrack"],
				results_count: u.weighNumRange(0, 50, 0.5, 12),
				content_hub: ["gaming", "anime", "movies", "tv", "comics", "music"],
			},
		},
		{
			event: "wiki page created",
			weight: 2,
			properties: {
				wiki_id: chance.pickone.bind(chance, wikiIds),
				content_hub: ["gaming", "anime", "movies", "tv", "comics", "music"],
				page_type: ["character", "location", "item", "episode", "concept", "organization"],
				word_count: u.weighNumRange(100, 3000, 0.4, 500),
			},
		},
		{
			event: "media uploaded",
			weight: 2,
			properties: {
				media_type: ["image", "image", "image", "gif", "video_clip", "screenshot"],
				file_size_kb: u.weighNumRange(50, 5000, 0.3, 500),
				content_hub: ["gaming", "anime", "movies", "tv", "comics", "music"],
			},
		},
		{
			event: "moderation action",
			weight: 2,
			properties: {
				action_type: ["warn", "edit_revert", "content_removal", "user_mute", "spam_flag", "lock_thread"],
				severity: ["low", "low", "medium", "medium", "high"],
				content_hub: ["gaming", "anime", "movies", "tv", "comics", "music"],
				resolution_time_hours: u.weighNumRange(0.1, 48, 0.3, 2),
			},
		},
		{
			event: "user followed",
			weight: 3,
			properties: {
				follow_source: ["profile", "article", "discussion", "recommendation"],
			},
		},
		{
			event: "notification received",
			weight: 6,
			properties: {
				notification_type: ["reply", "reply", "mention", "upvote", "follow", "article_update", "moderation"],
				channel: ["push", "push", "email", "in_app"],
				opened: [true, true, true, false],
			},
		},
		{
			event: "support ticket created",
			weight: 1,
			properties: {
				category: ["bug_report", "content_dispute", "account_issue", "feature_request", "abuse_report", "other"],
				priority: ["low", "low", "medium", "medium", "high"],
				resolution_hours: u.weighNumRange(1, 96, 0.4, 24),
			},
		},
		{
			event: "profile updated",
			weight: 2,
			properties: {
				field_updated: ["avatar", "bio", "display_name", "preferred_hub", "notification_settings", "badges"],
			},
		},
		{
			event: "app session",
			weight: 8,
			properties: {
				session_duration_sec: u.weighNumRange(10, 3600, 0.4, 180),
				pages_viewed: u.weighNumRange(1, 30, 0.5, 5),
			},
		},
		{
			event: "report submitted",
			weight: 1,
			properties: {
				report_type: ["spam", "harassment", "misinformation", "vandalism", "copyright", "other"],
				content_type: ["article", "comment", "discussion", "media"],
			},
		},
		{
			event: "account deactivated",
			weight: 1,
			isChurnEvent: true,
			returnLikelihood: 0.15,
			isStrictEvent: true,
			properties: {
				reason: ["lost_interest", "toxicity", "no_time", "switched_platform", "privacy_concern"],
			},
		},
	],

	// -- Funnels (5) --------------------------------------------------
	funnels: [
		{
			name: "Onboarding Flow",
			sequence: ["account created", "search performed", "article viewed", "discussion posted"],
			conversionRate: 40,
			order: "sequential",
			isFirstFunnel: true,
			timeToConvert: 72,
			weight: 3,
		},
		{
			name: "Content Creation",
			sequence: ["article viewed", "article published", "comment posted"],
			conversionRate: 35,
			order: "sequential",
			timeToConvert: 48,
			weight: 5,
		},
		{
			name: "Engagement Loop",
			sequence: ["article viewed", "upvote given", "comment posted", "discussion posted"],
			conversionRate: 30,
			order: "sequential",
			timeToConvert: 96,
			weight: 4,
		},
		{
			name: "Creator to Supporter",
			sequence: ["article published", "profile updated", "notification received"],
			conversionRate: 45,
			order: "sequential",
			timeToConvert: 168,
			weight: 2,
		},
		{
			name: "Moderation Pipeline",
			sequence: ["report submitted", "moderation action"],
			conversionRate: 60,
			order: "sequential",
			timeToConvert: 48,
			weight: 2,
		},
	],

	// -- SuperProps ----------------------------------------------------
	superProps: {
		subscription_tier: ["free", "free", "free", "free", "supporter", "pro"],
		platform: ["ios", "android", "web"],
		content_hub: ["gaming", "anime", "movies", "tv", "comics", "music"],
	},

	// -- UserProps -----------------------------------------------------
	userProps: {
		role: ["reader", "reader", "reader", "reader", "reader", "reader", "contributor", "contributor", "moderator", "creator"],
		contributor_level: ["newcomer"],
		articles_created: [0],
		reputation_score: u.weighNumRange(0, 100, 0.3, 25),
		preferred_hub: ["gaming", "anime", "movies", "tv", "comics", "music"],
	},

	// -- Phase 2: Personas --------------------------------------------
	personas: [
		{
			name: "power_creator",
			weight: 5,
			eventMultiplier: 8.0,
			conversionModifier: 2.0,
			churnRate: 0.01,
			properties: {
				role: "creator",
				segment: "power_creator",
			},
		},
		{
			name: "moderator",
			weight: 8,
			eventMultiplier: 3.0,
			conversionModifier: 1.5,
			churnRate: 0.02,
			properties: {
				role: "moderator",
				segment: "moderator",
			},
		},
		{
			name: "active_contributor",
			weight: 25,
			eventMultiplier: 1.5,
			conversionModifier: 1.0,
			churnRate: 0.05,
			properties: {
				role: "contributor",
				segment: "active_contributor",
			},
		},
		{
			name: "reader",
			weight: 45,
			eventMultiplier: 0.3,
			conversionModifier: 0.5,
			churnRate: 0.12,
			properties: {
				role: "reader",
				segment: "reader",
			},
		},
		{
			name: "lurker",
			weight: 17,
			eventMultiplier: 0.1,
			conversionModifier: 0.2,
			churnRate: 0.5,
			properties: {
				role: "reader",
				segment: "lurker",
			},
			activeWindow: { maxDays: 21 },
		},
	],

	// -- Phase 2: Subscription ----------------------------------------
	subscription: {
		plans: [
			{ name: "free", price: 0, default: true },
			{ name: "supporter", price: 4.99 },
			{ name: "pro", price: 12.99 },
		],
		lifecycle: {
			trialToPayRate: 0.25,
			upgradeRate: 0.06,
			downgradeRate: 0.04,
			churnRate: 0.06,
			winBackRate: 0.08,
			winBackDelay: 21,
			paymentFailureRate: 0.02,
		},
	},

	// -- Phase 2: Attribution -----------------------------------------
	attribution: {
		model: "last_touch",
		window: 7,
		campaigns: [
			{
				name: "google_search",
				source: "google",
				medium: "organic",
				activeDays: [0, 100],
				dailyBudget: [100, 400],
				acquisitionRate: 0.03,
				userPersonaBias: { reader: 0.5, lurker: 0.3 },
			},
			{
				name: "reddit_referral",
				source: "reddit",
				medium: "referral",
				activeDays: [0, 100],
				dailyBudget: [50, 200],
				acquisitionRate: 0.02,
				userPersonaBias: { active_contributor: 0.5, moderator: 0.3 },
			},
			{
				name: "youtube_link",
				source: "youtube",
				medium: "referral",
				activeDays: [0, 100],
				dailyBudget: [75, 250],
				acquisitionRate: 0.02,
				userPersonaBias: { lurker: 0.5, reader: 0.3 },
			},
		],
		organicRate: 0.35,
	},

	// -- Phase 2: Engagement Decay ------------------------------------
	engagementDecay: {
		model: "linear",
		halfLife: 60,
		floor: 0.15,
	},

	// -- Phase 2: Features --------------------------------------------
	features: [
		{
			name: "live_discussions",
			launchDay: 25,
			adoptionCurve: "fast",
			property: "discussion_mode",
			values: ["classic", "live"],
			defaultBefore: "classic",
			affectsEvents: ["discussion posted", "comment posted"],
		},
		{
			name: "interactive_polls",
			launchDay: 55,
			adoptionCurve: { k: 0.1, midpoint: 20 },
			property: "poll_enabled",
			values: [false, true],
			defaultBefore: false,
			affectsEvents: ["article published"],
		},
	],

	// -- Hook Function ------------------------------------------------
	hook: function (record, type, meta) {
		// -- HOOK 7: CREATOR PROFILES (user) --------------------------
		// Creators get high articles_created and reputation. Moderators
		// get mid-range reputation. Readers/lurkers stay at defaults.
		if (type === "user") {
			if (record.role === "creator") {
				record.articles_created = chance.integer({ min: 50, max: 200 });
				record.reputation_score = chance.integer({ min: 80, max: 100 });
				record.contributor_level = "admin";
			} else if (record.role === "moderator") {
				record.articles_created = chance.integer({ min: 10, max: 50 });
				record.reputation_score = chance.integer({ min: 40, max: 70 });
				record.contributor_level = "trusted";
			} else if (record.role === "contributor") {
				record.articles_created = chance.integer({ min: 1, max: 15 });
				record.reputation_score = chance.integer({ min: 15, max: 50 });
				record.contributor_level = "regular";
			} else {
				record.articles_created = 0;
				record.reputation_score = chance.integer({ min: 0, max: 20 });
				record.contributor_level = "newcomer";
			}
		}

		// -- HOOK 8: PRO SUBSCRIBER CONTENT CREATION LIFT (funnel-pre)
		// Pro subscribers convert 1.5x better through content creation.
		if (type === "funnel-pre") {
			if (meta && meta.profile) {
				const tier = meta.profile.subscription_tier;
				if (tier === "pro") {
					record.conversionRate = Math.min(record.conversionRate * 1.5, 95);
				} else if (tier === "supporter") {
					record.conversionRate = Math.min(record.conversionRate * 1.2, 90);
				}
			}
		}

		// -- HOOK 1: WEEKEND CONTENT SURGE (event) --------------------
		// Articles published on weekends get 1.5x word_count.
		if (type === "event") {
			if (record.event === "article published" || record.event === "article viewed") {
				const dow = dayjs(record.time).day();
				if (dow === 0 || dow === 6) {
					record.is_weekend = true;
					if (record.word_count) {
						record.word_count = Math.floor(record.word_count * 1.5);
					}
				}
			}

			// -- HOOK 2: TRENDING TOPIC WINDOW (event) ----------------
			// Days 35-50: gaming hub articles get 2x view_count.
			const TREND_START = DATASET_START.add(35, "days");
			const TREND_END = DATASET_START.add(50, "days");
			const eventTime = dayjs(record.time);
			if (record.event === "article viewed" && eventTime.isAfter(TREND_START) && eventTime.isBefore(TREND_END)) {
				if (record.content_hub === "gaming") {
					record.view_count = Math.floor((record.view_count || 50) * 2);
				}
			}
		}

		// -- EVERYTHING HOOKS -----------------------------------------
		if (type === "everything") {
			const events = record;
			if (!events.length) return record;

			// -- HOOK 3: POWER CREATOR ENGAGEMENT LIFT ----------------
			// Users with >20 article_published events get 3x upvote_count.
			let publishCount = 0;
			events.forEach(e => {
				if (e.event === "article published") publishCount++;
			});

			if (publishCount > 20) {
				events.forEach(e => {
					if (e.event === "upvote given" && e.upvote_count) {
						e.upvote_count = Math.floor(e.upvote_count * 3);
					}
				});
			}

			// -- HOOK 4: DISCUSSION DEPTH BY CONTRIBUTOR TYPE ---------
			// Active contributors get cloned comment_posted events.
			if (meta && meta.profile && meta.profile.segment === "active_contributor") {
				const templateComment = events.find(e => e.event === "comment posted");
				if (templateComment) {
					const existingComments = events.filter(e => e.event === "comment posted");
					existingComments.forEach(c => {
						if (chance.bool({ likelihood: 50 })) {
							events.push({
								...templateComment,
								time: dayjs(c.time).add(chance.integer({ min: 1, max: 120 }), "minutes").toISOString(),
								user_id: c.user_id,
								is_reply: true,
								comment_length: chance.integer({ min: 20, max: 300 }),
							});
						}
					});
				}
			}

			// -- HOOK 5: EDIT WAR DETECTION ---------------------------
			// Users with >5 article_edited events get reduced edit_quality.
			const editEvents = events.filter(e => e.event === "article edited");
			if (editEvents.length > 5) {
				editEvents.forEach(e => {
					e.edit_quality = chance.floating({ min: 1.0, max: 2.0, fixed: 1 });
				});
			}

			// -- HOOK 6: LURKER CHURN ---------------------------------
			// Users with <5 total events lose 60% after day 10.
			if (events.length < 5 && events.length > 0) {
				const firstEventTime = dayjs(events[0].time);
				const cutoff = firstEventTime.add(10, "days");
				for (let i = events.length - 1; i >= 0; i--) {
					if (dayjs(events[i].time).isAfter(cutoff) && chance.bool({ likelihood: 60 })) {
						events.splice(i, 1);
					}
				}
			}

			return record;
		}

		return record;
	},
};

export default config;
