// ── IMPORTS ──
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);
import "dotenv/config";
import * as u from "../../lib/utils/utils.js";
import * as v from "ak-tools";
/** @typedef  {import("../../types").Dungeon} Config */

// ── OVERVIEW ──
/*
 * NAME:       FanVerse
 * APP:        Fan wiki and community discussion platform where users create
 *             articles, discuss topics, moderate content, and build collaborative
 *             knowledge bases across fandoms. Core loop: sign up → search → read
 *             articles → contribute → discuss. Revenue: free / supporter ($4.99,
 *             ad-free) / pro ($12.99, analytics + badges).
 * SCALE:      10,000 users, ~1.4M events, 121 days (2026-01-01 → 2026-05-01)
 * CORE LOOP:  account created → search performed → article viewed → article published → comment posted
 *
 * EVENTS (18):
 *   article viewed (9) > app session (8) > upvote given (7) > comment posted (6)
 *   > search performed (6) > notification received (6) > discussion posted (5)
 *   > article edited (4) > article published (3) > user followed (3)
 *   > wiki page created (2) > media uploaded (2) > moderation action (2)
 *   > profile updated (2) > account created (1) > support ticket created (1)
 *   > report submitted (1) > account deactivated (1)
 *
 * FUNNELS (5):
 *   - Onboarding Flow:     account created → search performed → article viewed → discussion posted (40%)
 *   - Content Creation:    article viewed → article published → comment posted (35%)
 *   - Engagement Loop:     article viewed → upvote given → comment posted → discussion posted (30%)
 *   - Creator to Supporter: article published → profile updated → notification received (45%)
 *   - Moderation Pipeline: report submitted → moderation action (60%)
 *
 * USER PROPS:  role, contributor_level, articles_created, reputation_score, preferred_hub, subscription_tier, Platform, content_hub
 * SUPER PROPS: subscription_tier, Platform, content_hub
 * SCD PROPS:   contributor_level (newcomer/regular/trusted/admin, monthly fuzzy, max 8)
 * GROUPS:      none
 */

// ── HOOK STORIES ──
/*
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
 *   - Breakdown: Day of Week
 *   - Expected: Sat/Sun ~ 1.5x avg word_count vs weekdays
 *     (weekend ~ 3325, weekday ~ 2218)
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
 * 8. PRO SUBSCRIBER CONTENT CREATION LIFT (everything hook)
 * -------------------------------------------------------------------
 *
 * PATTERN: Free-tier users drop 50% of final funnel step events
 * ("comment posted"), creating a visible conversion gap between
 * paid and free users. Pro/supporter users keep all their events.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Content Creation Conversion by Tier
 *   - Report type: Funnels
 *   - Steps: "article viewed" -> "article published" -> "comment posted"
 *   - Breakdown: "subscription_tier" (superProp)
 *   - Expected: pro ~ 52% vs free ~ 26% conversion (~2x gap)
 *
 * REAL-WORLD ANALOGUE: Premium wiki tools (analytics dashboards,
 * badge systems) incentivize more content creation from subscribers.
 *
 * -------------------------------------------------------------------
 * 9. CONTENT CREATION TIME-TO-CONVERT (funnel-post hook)
 * -------------------------------------------------------------------
 *
 * PATTERN: Pro/supporter subscribers complete the Content Creation
 * funnel 1.3x faster (time gaps scaled by 0.77). Free-tier users
 * complete it 1.25x slower (gaps scaled by 1.25). The hook iterates
 * over the funnel-post event array, compresses or stretches the
 * inter-step time gaps based on the user's subscription_tier from
 * meta.profile, then rewrites each event's timestamp.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Content Creation TTC by Subscription Tier
 *   - Report type: Funnels
 *   - Steps: "article viewed" -> "article published" -> "comment posted"
 *   - Breakdown: "subscription_tier" (superProp)
 *   - Metric: Median time to convert
 *   - Expected: pro/supporter median TTC ~ 0.77x of free-tier TTC
 *     (e.g., pro ~ 27h vs free ~ 45h)
 *
 *   NOTE: This effect is visible ONLY in Mixpanel funnel median TTC.
 *   Cross-event MIN->MIN SQL queries on raw events do NOT show this
 *   because funnel-post mutates timestamps after event generation but
 *   before storage.
 *
 * REAL-WORLD ANALOGUE: Premium wiki contributors with analytics
 * dashboards and streamlined tools move from reading to publishing
 * faster; free users hesitate longer without feedback loops.
 *
 * -------------------------------------------------------------------
 * 10. ARTICLE-PUBLISHED MAGIC NUMBER (everything hook)
 * -------------------------------------------------------------------
 *
 * PATTERN: Users who published 2-5 articles sit in a "sweet spot" --
 * all their upvote_count values on "upvote given" events are boosted
 * by +35% (factor 1.35). Users who published 6+ articles trigger
 * over-publishing fatigue: 25% of their "upvote given" events are
 * dropped entirely. No flag is stamped -- discoverable only by
 * binning users on article-published COUNT and comparing upvote
 * totals or upvote event volume.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Upvote Count by Article Volume Cohort
 *   - Report type: Insights (with cohorts)
 *   - Cohort A: users who did "article published" 2-5 times
 *   - Cohort B: users who did "article published" 0-1 times
 *   - Event: "upvote given"
 *   - Measure: Average of "upvote_count"
 *   - Compare cohort A vs cohort B
 *   - Expected: cohort A ~ 1.35x higher avg upvote_count
 *
 *   Report 2: Upvote Events per User by Article Volume
 *   - Report type: Insights (with cohorts)
 *   - Cohort C: users who did "article published" 6+ times
 *   - Cohort A: users who did "article published" 2-5 times
 *   - Event: "upvote given"
 *   - Measure: Total events per user
 *   - Compare cohort C vs cohort A
 *   - Expected: cohort C ~ 25% fewer upvote events per user
 *
 * REAL-WORLD ANALOGUE: Creators who publish a handful of quality
 * articles earn outsized community engagement; over-publishers
 * dilute their signal and get less traction per piece.
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
 * Pro Content Creation Lift     | funnel conversion   | ~26%     | 52%     | ~2.0x
 * Content Creation TTC          | funnel median TTC   | 1x       | 0.77x   | 1.3x faster (pro)
 * Article-Published Magic Num   | sweet upvote_count  | 1x       | 1.35x   | +35%
 * Article-Published Magic Num   | over upvote events  | 1x       | 0.75x   | -25%
 */

// ── SCALE ──
const SEED = "dm4-community";
const NUM_USERS = 10_000;
const DATASET_START = "2026-01-01T00:00:00Z";
const DATASET_END = "2026-05-01T23:59:59Z";
const EVENTS_PER_DAY = 1.2;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── KNOBS (tweak these to reshape stories) ──
const WEEKEND_WORD_COUNT_MULT = 1.5;

const TREND_START_DAY = 35;
const TREND_END_DAY = 50;
const TREND_VIEW_MULT = 2;

const POWER_CREATOR_PUBLISH_THRESHOLD = 20;
const POWER_CREATOR_UPVOTE_MULT = 3;

const DISCUSSION_CLONE_LIKELIHOOD = 50;

const EDIT_WAR_THRESHOLD = 5;
const EDIT_WAR_QUALITY_MIN = 1.0;
const EDIT_WAR_QUALITY_MAX = 2.0;

const LURKER_EVENT_THRESHOLD = 5;
const LURKER_CHURN_CUTOFF_DAYS = 10;
const LURKER_DROP_LIKELIHOOD = 60;

const PRO_LIFT_FREE_DROP_LIKELIHOOD = 65;

const TTC_PRO_FACTOR = 0.77;
const TTC_FREE_FACTOR = 1.25;

const ARTICLE_SWEET_MIN = 2;
const ARTICLE_SWEET_MAX = 5;
const ARTICLE_OVER_THRESHOLD = 6;
const ARTICLE_UPVOTE_BOOST = 1.35;
const ARTICLE_UPVOTE_DROP_LIKELIHOOD = 25;

// ── DATA ARRAYS ──
// Generate consistent wiki/article IDs at module level
const wikiIds = v.range(1, 500).map(() => `WIKI_${v.uid(6)}`);
const communityIds = v.range(1, 30).map(() => `COMM_${v.uid(4)}`);

// ── HELPER FUNCTIONS ──
function handleUserHooks(record) {
	// H7: CREATOR PROFILES — creators get high articles_created and reputation.
	// Moderators get mid-range reputation. Readers/lurkers stay at defaults.
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
	return record;
}

function handleFunnelPostHooks(record, meta) {
	// H9: CONTENT CREATION TIME-TO-CONVERT — Pro/supporter complete 1.3x
	// faster (factor 0.77); Free 1.25x slower (factor 1.25).
	const segment = meta?.profile?.subscription_tier;
	if (Array.isArray(record) && record.length > 1) {
		const factor = (
			segment === "pro" || segment === "supporter" ? TTC_PRO_FACTOR :
			segment === "free" ? TTC_FREE_FACTOR :
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
	const profile = meta && meta.profile ? meta.profile : {};

	// -- SUPERPROP STAMPING -----------------------------------
	// Stamp superProp values from profile onto every event so
	// they stay consistent per-user instead of randomizing per-event.
	events.forEach(e => {
		if (profile.subscription_tier) e.subscription_tier = profile.subscription_tier;
		if (profile.Platform) e.Platform = profile.Platform;
		if (profile.content_hub) e.content_hub = profile.content_hub;
	});

	// HOOK 1: WEEKEND CONTENT SURGE — articles on Sat/Sun get
	// word_count 1.5x. Mutates raw prop. No flag.
	for (const e of events) {
		if (e.event === 'article published' || e.event === 'article viewed') {
			const dow = new Date(e.time).getUTCDay();
			if ((dow === 0 || dow === 6) && e.word_count) {
				e.word_count = Math.floor(e.word_count * WEEKEND_WORD_COUNT_MULT);
			}
		}
	}

	// -- HOOK 2: TRENDING TOPIC WINDOW -------------------------
	// Days 35-50: gaming hub articles get 2x view_count.
	// Runs after superProp stamping so content_hub is the
	// profile's consistent value, not the random event-level one.
	const TREND_START = datasetStart.add(TREND_START_DAY, "days");
	const TREND_END = datasetStart.add(TREND_END_DAY, "days");
	if (profile.content_hub === "gaming") {
		events.forEach(e => {
			if (e.event === "article viewed") {
				const eventTime = dayjs(e.time);
				if (eventTime.isAfter(TREND_START) && eventTime.isBefore(TREND_END)) {
					e.view_count = Math.floor((e.view_count || 50) * TREND_VIEW_MULT);
				}
			}
		});
	}

	// -- HOOK 8: PRO SUBSCRIBER CONTENT CREATION LIFT ---------
	// Free-tier users drop 65% of comment events to widen the funnel
	// conversion gap to ~2x vs paid subscribers.
	if (profile.subscription_tier !== "pro" && profile.subscription_tier !== "supporter") {
		events = events.filter(e => {
			if (e.event === "comment posted" && chance.bool({ likelihood: PRO_LIFT_FREE_DROP_LIKELIHOOD })) return false;
			return true;
		});
	}

	// -- HOOK 3: POWER CREATOR ENGAGEMENT LIFT ----------------
	// Users with >20 article_published events get 3x upvote_count.
	let publishCount = 0;
	events.forEach(e => {
		if (e.event === "article published") publishCount++;
	});

	if (publishCount > POWER_CREATOR_PUBLISH_THRESHOLD) {
		events.forEach(e => {
			if (e.event === "upvote given" && e.upvote_count) {
				e.upvote_count = Math.floor(e.upvote_count * POWER_CREATOR_UPVOTE_MULT);
			}
		});
	}

	// -- HOOK 4: DISCUSSION DEPTH BY CONTRIBUTOR TYPE ---------
	// Active contributors get cloned comment_posted events.
	if (profile.segment === "active_contributor") {
		const templateComment = events.find(e => e.event === "comment posted");
		if (templateComment) {
			const existingComments = events.filter(e => e.event === "comment posted");
			existingComments.forEach(c => {
				if (chance.bool({ likelihood: DISCUSSION_CLONE_LIKELIHOOD })) {
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
	if (editEvents.length > EDIT_WAR_THRESHOLD) {
		editEvents.forEach(e => {
			e.edit_quality = chance.floating({ min: EDIT_WAR_QUALITY_MIN, max: EDIT_WAR_QUALITY_MAX, fixed: 1 });
		});
	}

	// HOOK 6: LURKER CHURN — users with <5 events lose 60% after
	// day 10. No flag.
	if (events.length < LURKER_EVENT_THRESHOLD && events.length > 0) {
		const firstEventTime = dayjs(events[0].time);
		const cutoff = firstEventTime.add(LURKER_CHURN_CUTOFF_DAYS, "days");
		for (let i = events.length - 1; i >= 0; i--) {
			if (dayjs(events[i].time).isAfter(cutoff) && chance.bool({ likelihood: LURKER_DROP_LIKELIHOOD })) {
				events.splice(i, 1);
			}
		}
	}

	// HOOK 10: ARTICLE-PUBLISHED MAGIC NUMBER (no flags)
	// Sweet 2-5 articles published → +35% on upvote_count for
	// upvote-given events. Over 6+ → drop 25% of upvote-given events
	// (over-publishing dilutes signal). No flag.
	const articleCount = events.filter(e => e.event === "article published").length;
	if (articleCount >= ARTICLE_SWEET_MIN && articleCount <= ARTICLE_SWEET_MAX) {
		events.forEach(e => {
			if (e.event === "upvote given" && typeof e.upvote_count === "number") {
				e.upvote_count = Math.round(e.upvote_count * ARTICLE_UPVOTE_BOOST);
			}
		});
	} else if (articleCount >= ARTICLE_OVER_THRESHOLD) {
		for (let i = events.length - 1; i >= 0; i--) {
			if (events[i].event === "upvote given" && chance.bool({ likelihood: ARTICLE_UPVOTE_DROP_LIKELIHOOD })) {
				events.splice(i, 1);
			}
		}
	}

	return events;
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
			isAuthEvent: true,
			properties: {
				referral_source: ["organic", "google_search", "reddit_referral", "youtube_link", "friend_invite"],
			},
		},
		{
			event: "article viewed",
			weight: 9,
			isStrictEvent: false,
			properties: {
				wiki_id: chance.pickone.bind(chance, wikiIds),
				content_hub: ["gaming", "anime", "movies", "tv", "comics", "music"],
				view_count: u.weighNumRange(1, 100, 0.4, 50),
				time_on_page_sec: u.weighNumRange(5, 600, 0.4, 45),
			},
		},
		{
			event: "article published",
			weight: 3,
			isStrictEvent: false,
			properties: {
				wiki_id: chance.pickone.bind(chance, wikiIds),
				content_hub: ["gaming", "anime", "movies", "tv", "comics", "music"],
				word_count: u.weighNumRange(200, 5000, 0.4, 1500),
				has_images: [true, true, true, false],
				category: ["lore", "character", "episode_guide", "review", "tutorial", "news"],
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
			isStrictEvent: false,
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
			isStrictEvent: false,
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
			isStrictEvent: false,
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
			reentry: true,
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
		Platform: ["ios", "android", "web"],
		content_hub: ["gaming", "anime", "movies", "tv", "comics", "music"],
	},

	// -- UserProps -----------------------------------------------------
	userProps: {
		role: ["reader", "reader", "reader", "reader", "reader", "reader", "contributor", "contributor", "moderator", "creator"],
		contributor_level: ["newcomer"],
		articles_created: [0],
		reputation_score: u.weighNumRange(0, 100, 0.3, 25),
		preferred_hub: ["gaming", "anime", "movies", "tv", "comics", "music"],
		subscription_tier: ["free", "free", "free", "free", "supporter", "pro"],
		Platform: ["ios", "android", "web"],
		content_hub: ["gaming", "anime", "movies", "tv", "comics", "music"],
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
				activeDays: [0, 120],
				dailyBudget: [100, 400],
				acquisitionRate: 0.03,
				userPersonaBias: { reader: 0.5, lurker: 0.3 },
			},
			{
				name: "reddit_referral",
				source: "reddit",
				medium: "referral",
				activeDays: [0, 120],
				dailyBudget: [50, 200],
				acquisitionRate: 0.02,
				userPersonaBias: { active_contributor: 0.5, moderator: 0.3 },
			},
			{
				name: "youtube_link",
				source: "youtube",
				medium: "referral",
				activeDays: [0, 120],
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

	hook(record, type, meta) {
		if (type === "user") return handleUserHooks(record);
		if (type === "funnel-post") return handleFunnelPostHooks(record, meta);
		if (type === "everything") return handleEverythingHooks(record, meta);
		return record;
	},
};

export default config;
