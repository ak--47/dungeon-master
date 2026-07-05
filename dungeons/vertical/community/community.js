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
 * NAME:       FanVerse
 * APP:        Fan wiki and community discussion platform where users create
 *             articles, discuss topics, moderate content, and build collaborative
 *             knowledge bases across fandoms. Core loop: sign up → search → read
 *             articles → contribute → discuss. Revenue: free / supporter ($4.99,
 *             ad-free) / pro ($12.99, analytics + badges).
 * SCALE:      10,000 users, ~617K events, 121 days (2026-01-01 → 2026-05-01)
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
 *   - Report type: Insights (with cohorts)
 *   - Cohort A: users who did "article published" 21+ times
 *   - Cohort B: users who did "article published" 0-1 times
 *   - Event: "upvote given"
 *   - Measure: Average of "upvote_count"
 *   - Expected: cohort A ~3x avg upvote_count (~15 vs ~5). Because the
 *     multiplier is an exact integer x3 on integer draws, every treated
 *     upvote_count is divisible by 3 — a structural signature.
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
 *   - Breakdown: user property "role" (contributor = active_contributor)
 *   - Expected: ~1.5x comments ACTIVITY-NORMALIZED (comments per app
 *     session) vs readers — the raw per-user ratio is dominated by the
 *     persona event multipliers (1.5x vs 0.3x/0.1x), not the clones.
 *     Secondary signature: contributor is_reply share ~0.78 vs the
 *     organic ~0.67 (clones are always replies).
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
 * PATTERN: Free-tier users drop 65% of ALL "comment posted" events
 * (not just funnel-final instances), creating a visible conversion gap
 * between paid and free users. Pro/supporter users keep all their
 * events. Comments-per-session for free users therefore reads ~0.35x
 * of paid — the exact keep rate.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Content Creation Conversion by Tier
 *   - Report type: Funnels
 *   - Steps: "article viewed" -> "article published" -> "comment posted"
 *   - Breakdown: "subscription_tier" (superProp)
 *   - Expected: pro/supporter ~1.5-2.5x the free published→comment
 *     step conversion (nonlinear in the 0.35 keep rate — depends on
 *     per-window comment density)
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
 * meta.profile, then rewrites each event's timestamp. v1.6: scoped to
 * the Content Creation funnel only — the v1.5 hook stretched every
 * funnel's gaps, which this block never claimed.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Content Creation TTC by Subscription Tier
 *   - Report type: Funnels
 *   - Steps: "article viewed" -> "article published" -> "comment posted"
 *   - Breakdown: "subscription_tier" (superProp)
 *   - Metric: Median time to convert
 *   - Expected: pro/supporter median TTC below free-tier TTC. The raw
 *     knob distance is 0.77/1.25 = 0.62; organic cross-instance
 *     pairings mask part of it, so the visible ratio reads ~0.7-0.9.
 *
 *   NOTE (funnel-post measurement): visible via Mixpanel funnel median
 *   TTC and via emulateBreakdown's timeToConvert (the H9 story asserts
 *   the delta itself at a 60h conversion window = 48h generative
 *   window x 1.25 max stretch). Cross-event MIN->MIN SQL queries on
 *   raw events do NOT show this — funnel-post adjusts gaps within
 *   funnel instances, not across the user's full event history.
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
 * by +35% (factor 1.35). Users who published 6+ articles hit creator
 * burnout: from day 60 (ARTICLE_FATIGUE_START_DAY), 40% of their
 * "upvote given" events are dropped. No flag is stamped --
 * discoverable only by binning users on article-published COUNT.
 *
 * WHY THE DROP IS CALENDAR-SCOPED: publish count is intrinsically
 * coupled to activity level (E[pubs] grows with total events), so a
 * uniform drop cannot be recovered from output -- every cross-arm
 * rate comparison (per session, per discussion, per non-publish
 * event) is confounded by activity composition; measured organic
 * upvotes-per-session differs 23-58% across publish bands and
 * activity-band matching leaves the arms with materially different
 * event mixes. The calendar edge turns recovery into a
 * difference-in-differences: each arm's own before/after
 * upvotes-per-session ratio cancels its activity composition
 * (measured arm-invariant to ~0.1% on untreated data), so
 * (over after/before) / (sweet after/before) reads the 0.60 keep
 * rate directly.
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
 *   Report 2: Upvote Volume Collapse After Day 60 (2026-03-02)
 *   - Report type: Insights (with cohorts), line chart over time
 *   - Cohort C: users who did "article published" 6+ times
 *   - Cohort A: users who did "article published" 2-5 times
 *   - Event: "upvote given", Measure: Total events, weekly buckets
 *   - Expected: cohort C's upvote volume drops ~40% relative to its
 *     own pre-March trend at 2026-03-02; cohort A shows no break.
 *     (Levels differ across cohorts for organic activity reasons --
 *     compare each cohort to its own history, not to each other.)
 *
 * REAL-WORLD ANALOGUE: Creators who publish a handful of quality
 * articles earn outsized community engagement; prolific publishers
 * burn out mid-quarter and disengage from curating others' work.
 *
 * =====================================================================================
 * EXPECTED METRICS SUMMARY (Measured = full fidelity, 10K users / 616,718 events)
 * =====================================================================================
 *
 * Story id                      | Metric                              | Expected      | Measured
 * ------------------------------|-------------------------------------|---------------|---------
 * H1-weekend-word-count[0]      | published weekend/weekday word_count| [1.40, 1.60]  | 1.491
 * H1-weekend-word-count[1]      | wiki placebo weekend/weekday        | [0.92, 1.08]  | 0.999
 * H2-trending-gaming-window[0]  | gaming in/out-window view_count     | [1.80, 2.20]  | 1.985
 * H2-trending-gaming-window[1]  | other-hub placebo in/out            | [0.92, 1.08]  | 0.998
 * H3-power-creator-upvotes[0]   | power/low avg upvote_count          | [2.70, 3.30]  | 3.028
 * H3-power-creator-upvotes[1]   | power mod-3 share (low placebo)     | ≥0.995 (≤0.9) | 1.000 (0.620)
 * H4-discussion-depth[0]        | bracket: corrected DD ≤ 1.5 ≤ raw DD| [1.10,1.60]/[1.50,2.80] | 1.285 / 2.057
 * H4-discussion-depth[1]        | contributor reply share (reader)    | [0.75, 0.81]  | 0.780 (0.672)
 * H5-edit-war[0]                | war avg edit_quality; calm gap      | [1.40,1.60]; ≥0.4 | 1.501; 0.840
 * H6-lurker-churn[0]            | pre-calibrated keep r (corrected/0.4)| [0.60, 1.40] | 1.104
 * H7-creator-profiles[0]        | role ranges exact; creator avg rep  | 0 violations; [88,92] | exact; 90.26
 * H8-pro-content-lift[0]        | free/paid comments-per-session      | [0.30, 0.40]  | 0.346
 * H8-pro-content-lift[1]        | paid/free published→comment conv    | [1.35, 2.60]  | 2.458
 * H9-content-ttc[0]             | pro/free median TTC (emulator)      | [0.65, 0.92]  | 0.765
 * H9-content-ttc[1]             | supporter/pro median TTC (placebo)  | [0.85, 1.15]  | 0.995
 * H10-article-magic-number[0]   | sweet/low avg upvote_count          | [1.25, 1.50]  | 1.377
 * H10-article-magic-number[1]   | day-60 DiD upvotes-per-session      | [0.50, 0.70]  | 0.579
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
// creator-burnout drop is calendar-scoped: publish count is intrinsically
// coupled to activity level, so a uniform drop is unrecoverable from output
// (any cross-arm rate comparison is confounded by activity composition —
// measured organic upvotes-per-session differs 23-58% across publish bands).
// A calendar edge makes it a difference-in-differences: each arm's own
// before/after upvotes-per-session ratio cancels its activity composition
// (measured arm-invariant to 0.1% on untreated data).
const ARTICLE_FATIGUE_START_DAY = 60;
const ARTICLE_UPVOTE_DROP_LIKELIHOOD = 40;

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
	// v1.6: scoped to the Content Creation funnel only — the v1.5 hook
	// stretched EVERY funnel's gaps (Onboarding, Engagement Loop, Creator
	// to Supporter, Moderation), which the doc block never claimed.
	if (meta?.funnel?.name !== "Content Creation") return record;
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
	// word_count 1.5x. Mutates raw prop. No flag. Only 'article published'
	// carries word_count among touched events; 'wiki page created' also has
	// word_count but is deliberately untouched — it is the placebo arm the
	// H1 story uses to cancel any weekend-composition drift.
	for (const e of events) {
		if (e.event === 'article published') {
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
						// engine stamps insert_id at generation — clones need fresh
						// ids or Mixpanel's $insert_id dedupe silently eats them
						insert_id: chance.guid(),
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
	// upvote-given events. Over 6+ → creator burnout: from day 60,
	// 40% of their upvote-given events are dropped. The calendar edge
	// (see ARTICLE_FATIGUE_START_DAY) is what makes the drop
	// recoverable from output. No flag.
	const articleCount = events.filter(e => e.event === "article published").length;
	if (articleCount >= ARTICLE_SWEET_MIN && articleCount <= ARTICLE_SWEET_MAX) {
		events.forEach(e => {
			if (e.event === "upvote given" && typeof e.upvote_count === "number") {
				e.upvote_count = Math.round(e.upvote_count * ARTICLE_UPVOTE_BOOST);
			}
		});
	} else if (articleCount >= ARTICLE_OVER_THRESHOLD) {
		const fatigueCutoff = datasetStart.add(ARTICLE_FATIGUE_START_DAY, "days");
		for (let i = events.length - 1; i >= 0; i--) {
			if (
				events[i].event === "upvote given" &&
				dayjs(events[i].time).isAfter(fatigueCutoff) &&
				chance.bool({ likelihood: ARTICLE_UPVOTE_DROP_LIKELIHOOD })
			) {
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
			properties: {
				role: "reader",
				segment: "lurker",
			},
		},
	],

	// -- Phase 2: Engagement Decay ------------------------------------
	engagementDecay: {
		model: "linear",
		halfLife: 60,
		floor: 0.15,
	},

	hook(record, type, meta) {
		if (type === "user") return handleUserHooks(record);
		if (type === "funnel-post") return handleFunnelPostHooks(record, meta);
		if (type === "everything") return handleEverythingHooks(record, meta);
		return record;
	},
};

// ── STORIES (v1.6 machine-checkable contract — one story per numbered hook) ──
// Generate:  node scripts/verify-runner.mjs dungeons/vertical/community/community.js verify-community
// Evaluate:  node scripts/verify-stories.mjs dungeons/vertical/community/community.js --data-prefix verify-community
//
// Measurement doctrine for this dungeon:
// - Deletions-only logic (H6 lurker churn, H8 free-tier comment drop, H10
//   over-publisher upvote drop, the silent future-time guard) means hook-time
//   cohort classification is only ONE-SIDED recoverable from output counts:
//   hook-time count >= output count. Cohorts below are chosen so output-side
//   membership IMPLIES hook-time membership (e.g. output publishes >= 21
//   proves the H3 power-creator branch fired); reverse contamination lands in
//   the control arm and biases toward null.
// - Persona event multipliers (8x power creators ... 0.1x lurkers) make every
//   count-per-user comparison activity-confounded BY CONSTRUCTION. Count
//   assertions are activity-normalized (per app-session — untouched by all
//   hooks) and, where the arms span personas with different funnel
//   conversionModifiers, restricted to a single role stratum.
// - Value mutations (word_count, view_count, upvote_count, edit_quality) are
//   iid per-event draws, so cross-cohort VALUE ratios are clean without
//   normalization; exact integer multipliers additionally leave structural
//   signatures (x3 on integers => divisible by 3).

const EV = `read_json_auto('{{PREFIX}}-EVENTS*.json', sample_size=-1, union_by_name=true)`;
const US = `read_json_auto('{{PREFIX}}-USERS*.json', sample_size=-1, union_by_name=true)`;
// identity prelude: avgDevicePerUser 2 + account created is isAuthEvent+isFirstEvent,
// so born users auth on their first event; the device-pool resolve is
// belt-and-braces for any device-only edge. ::VARCHAR casts — user_id sniffs
// as UUID, device_id as VARCHAR; DuckDB refuses to coalesce mixed types.
const ID_CTE = `
us AS (SELECT * FROM ${US}),
dm AS (SELECT unnest("anonymousIds") AS device_id, distinct_id FROM us),
ev AS (
  SELECT coalesce(m.distinct_id::VARCHAR, e.user_id::VARCHAR, e.device_id::VARCHAR) AS uid,
         e.time::TIMESTAMP AS t, e.*
  FROM ${EV} e
  LEFT JOIN dm m ON e.device_id = m.device_id
)`;

// knob-derived timestamps (dataset starts ${DATASET_START})
const DS = dayjs.utc(DATASET_START);
const TS = (d) => d.format("YYYY-MM-DD HH:mm:ss");
// H2 window bounds are EXCLUSIVE on both sides (the hook uses isAfter/isBefore)
const TREND_START_TS = TS(DS.add(TREND_START_DAY, "day"));
const TREND_END_TS = TS(DS.add(TREND_END_DAY, "day"));
// H6 clean-birth cutoff: users born within ~16d of datasetEnd lack a full
// post-cutoff observation window (10d cutoff + room for a post period)
const H6_LATEBORN_TS = TS(dayjs.utc(DATASET_END).subtract(16, "day"));
const FATIGUE_TS = TS(DS.add(ARTICLE_FATIGUE_START_DAY, "day"));

const cellsOf = (rows, key) => Object.fromEntries((rows || []).map((r) => [r[key], r]));

export const stories = [
	{
		id: "H1-weekend-word-count",
		hook: "H1",
		archetype: "temporal-inflection",
		narrative:
			`Sat/Sun 'article published' word_count is multiplied by ${WEEKEND_WORD_COUNT_MULT} (floored; draws are ` +
			"large integers so floor bias is negligible). word_count is an iid per-event draw, so the weekend/weekday " +
			"avg ratio reads the knob directly: band [1.40, 1.60]. 'wiki page created' also carries word_count but " +
			"is deliberately untouched by the hook — it is the placebo arm, and its weekend/weekday ratio must sit " +
			"at 1 within sampling noise [0.92, 1.08].",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT e.event || CASE WHEN dayofweek(e.t) IN (0, 6) THEN '|we' ELSE '|wd' END AS cell,
  count(DISTINCT e.uid)::BIGINT AS user_count, count(*)::BIGINT AS n_events, avg(e.word_count) AS avg_wc
FROM ev e WHERE e.event IN ('article published', 'wiki page created')
GROUP BY 1`,
				},
				select: {
					pwe: { where: { cell: "article published|we" } },
					pwd: { where: { cell: "article published|wd" } },
				},
				expect: { metric: "pwe.avg_wc / pwd.avg_wc", op: "between", target: [1.4, 1.6] },
				minCohort: 300,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT e.event || CASE WHEN dayofweek(e.t) IN (0, 6) THEN '|we' ELSE '|wd' END AS cell,
  count(DISTINCT e.uid)::BIGINT AS user_count, count(*)::BIGINT AS n_events, avg(e.word_count) AS avg_wc
FROM ev e WHERE e.event IN ('article published', 'wiki page created')
GROUP BY 1`,
				},
				select: {
					wwe: { where: { cell: "wiki page created|we" } },
					wwd: { where: { cell: "wiki page created|wd" } },
				},
				expect: { metric: "wwe.avg_wc / wwd.avg_wc", op: "between", target: [0.92, 1.08] },
				minCohort: 300,
			},
		],
	},
	{
		id: "H2-trending-gaming-window",
		hook: "H2",
		archetype: "temporal-inflection",
		narrative:
			`Days ${TREND_START_DAY}-${TREND_END_DAY} (exclusive bounds — the hook uses isAfter/isBefore): users ` +
			`whose profile content_hub is 'gaming' get view_count x${TREND_VIEW_MULT} on 'article viewed'. The hook ` +
			"runs AFTER superProp stamping, so the event-level content_hub equals the profile value and selects " +
			"exactly the treated users. view_count is an iid integer draw and the multiplier is exact, so " +
			"in-window/out-of-window avg reads the knob: gaming band [1.80, 2.20], non-gaming placebo [0.92, 1.08].",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT CASE WHEN e.content_hub = 'gaming' THEN 'g' ELSE 'o' END ||
  CASE WHEN e.t > TIMESTAMP '${TREND_START_TS}' AND e.t < TIMESTAMP '${TREND_END_TS}' THEN 'in' ELSE 'out' END AS cell,
  count(DISTINCT e.uid)::BIGINT AS user_count, count(*)::BIGINT AS n_events, avg(e.view_count) AS avg_vc
FROM ev e WHERE e.event = 'article viewed' GROUP BY 1`,
				},
				select: {
					gin: { where: { cell: "gin" } },
					gout: { where: { cell: "gout" } },
				},
				expect: { metric: "gin.avg_vc / gout.avg_vc", op: "between", target: [1.8, 2.2] },
				minCohort: 400,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT CASE WHEN e.content_hub = 'gaming' THEN 'g' ELSE 'o' END ||
  CASE WHEN e.t > TIMESTAMP '${TREND_START_TS}' AND e.t < TIMESTAMP '${TREND_END_TS}' THEN 'in' ELSE 'out' END AS cell,
  count(DISTINCT e.uid)::BIGINT AS user_count, count(*)::BIGINT AS n_events, avg(e.view_count) AS avg_vc
FROM ev e WHERE e.event = 'article viewed' GROUP BY 1`,
				},
				select: {
					oin: { where: { cell: "oin" } },
					oout: { where: { cell: "oout" } },
				},
				expect: { metric: "oin.avg_vc / oout.avg_vc", op: "between", target: [0.92, 1.08] },
				minCohort: 400,
			},
		],
	},
	{
		id: "H3-power-creator-upvotes",
		hook: "H3",
		archetype: "cohort-prop-scale",
		narrative:
			`Users with more than ${POWER_CREATOR_PUBLISH_THRESHOLD} 'article published' events get upvote_count ` +
			`x${POWER_CREATOR_UPVOTE_MULT} on every 'upvote given'. Publishes are never deleted (only the future ` +
			"guard trims the tail), so output publishes >= 21 IMPLIES the branch fired. upvote_count is an iid " +
			"integer draw in [1,10]; floor(3w) = 3w exactly, so the power/low value ratio reads 3.0 [2.70, 3.30] " +
			"AND every treated value is divisible by 3 (share ~1.0; H10's over-drop removes events but never " +
			"changes surviving values). The 0-1-publish placebo arm's mod-3 share is the organic pool share — " +
			"upvote_count draws uniformly from a 5-value weighNumRange pool, so the placebo share is whatever " +
			"fraction of those 5 values happens to divide by 3 (measured ~0.63); the 0.9 cap still separates it " +
			"cleanly from the exact-1.0 treated signature.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
pu AS (SELECT uid, count(*) FILTER (WHERE event = 'article published') AS pubs FROM ev GROUP BY 1),
arms AS (SELECT uid, CASE WHEN pubs > ${POWER_CREATOR_PUBLISH_THRESHOLD} THEN 'pw' WHEN pubs <= 1 THEN 'lo' END AS arm FROM pu)
SELECT a.arm, count(DISTINCT a.uid)::BIGINT AS user_count,
  avg(e.upvote_count) AS avg_uc,
  count(*) FILTER (WHERE e.upvote_count % 3 = 0)::DOUBLE / count(*) AS mod3_share
FROM arms a JOIN ev e ON e.uid = a.uid AND e.event = 'upvote given'
WHERE a.arm IS NOT NULL GROUP BY 1`,
				},
				select: {
					pw: { where: { arm: "pw" } },
					lo: { where: { arm: "lo" } },
				},
				expect: { metric: "pw.avg_uc / lo.avg_uc", op: "between", target: [2.7, 3.3] },
				minCohort: 200,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
pu AS (SELECT uid, count(*) FILTER (WHERE event = 'article published') AS pubs FROM ev GROUP BY 1),
arms AS (SELECT uid, CASE WHEN pubs > ${POWER_CREATOR_PUBLISH_THRESHOLD} THEN 'pw' WHEN pubs <= 1 THEN 'lo' END AS arm FROM pu)
SELECT a.arm, count(DISTINCT a.uid)::BIGINT AS user_count,
  count(*) FILTER (WHERE e.upvote_count % 3 = 0)::DOUBLE / count(*) AS mod3_share
FROM arms a JOIN ev e ON e.uid = a.uid AND e.event = 'upvote given'
WHERE a.arm IS NOT NULL GROUP BY 1`,
				},
				// mod-3 structural signature needs a two-arm comparison with a
				// placebo floor — not expressible as a single-metric band
				assert: (rows) => {
					const by = cellsOf(rows, "arm");
					const p = by.pw, l = by.lo;
					if (!p || !l || Number(p.user_count) < 150 || Number(l.user_count) < 150) {
						return { verdict: "WEAK", detail: `cohort too small: power=${p?.user_count ?? 0} low=${l?.user_count ?? 0}` };
					}
					const ps = Number(p.mod3_share), ls = Number(l.mod3_share);
					const detail = `power mod-3 share ${ps.toFixed(4)} (n=${p.user_count}) vs low placebo ${ls.toFixed(4)} (n=${l.user_count})`;
					// placebo cap 0.9, not ~0.3: upvote_count's 5-value pool makes the
					// organic divisible-by-3 share pool-dependent (see narrative); the
					// signature is the treated arm's EXACT 1.0, placebo merely < 1
					if (ps >= 0.995 && ls <= 0.9) return { verdict: "NAILED", detail };
					if (ps >= 0.95 && ls <= 0.95) return { verdict: "STRONG", detail };
					return { verdict: ps > ls ? "WEAK" : "INVERSE", detail };
				},
			},
		],
	},
	{
		id: "H4-discussion-depth",
		hook: "H4",
		archetype: "cohort-count-scale",
		narrative:
			`active_contributor users (role 'contributor' — the only persona with that role) spawn a clone for ` +
			`${DISCUSSION_CLONE_LIKELIHOOD}% of their surviving comments, an exact x1.5 in expectation that is ` +
			"MULTIPLICATIVE with H8's free-tier drop (clones run after the drop), so the effect survives the tier " +
			"mixture. Raw comments-per-user is dominated by persona event multipliers (1.5x vs 0.3x/0.1x for " +
			"readers), and per-session normalization alone is NOT enough: comments are conversion-gated funnel " +
			"steps (Content Creation step 3, Engagement Loop step 3) and contributors' funnel conversionModifier " +
			"is 1.0 vs readers' 0.5, so the raw comments-per-session DD runs ~2.1. Calibrating with 'discussion " +
			"posted' — a conversion-gated funnel step NO hook touches — over-corrects, because discussions sit " +
			"DEEPER in their funnel (Engagement Loop step 4 vs comment step 3) and deeper steps amplify the " +
			"conversionModifier gap more. The two estimators therefore bracket the knob with sign-known biases: " +
			"raw DD (no correction) is an over-estimate, discussion-corrected DD an under-estimate, and 1.5 must " +
			"sit inside [corrected, raw] — asserted as corrected in [1.10, 1.60] AND raw in [1.50, 2.80] " +
			"(NAILED). Secondary signature: clones are always is_reply=true, shifting the contributor reply " +
			"share from the organic 2/3 to (2/3 + 0.5)/1.5 = 0.778.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
pr AS (SELECT distinct_id::VARCHAR AS puid, role FROM us WHERE role IN ('contributor', 'reader'))
SELECT pr.role, count(DISTINCT pr.puid)::BIGINT AS user_count,
  count(*) FILTER (WHERE e.event = 'comment posted')::BIGINT AS comments,
  count(*) FILTER (WHERE e.event = 'app session')::BIGINT AS sessions,
  count(*) FILTER (WHERE e.event = 'discussion posted')::BIGINT AS discussions
FROM pr JOIN ev e ON e.uid = pr.puid GROUP BY 1`,
				},
				// two-estimator bracket with sign-known biases (raw over-estimates,
				// discussion-corrected under-estimates) — beyond the one-operator grammar
				assert: (rows) => {
					const by = cellsOf(rows, "role");
					const c = by.contributor, r = by.reader;
					if (!c || !r || Number(c.user_count) < 500 || Number(r.user_count) < 500) {
						return { verdict: "WEAK", detail: `cohort too small: contributor=${c?.user_count ?? 0} reader=${r?.user_count ?? 0}` };
					}
					if (!(Number(c.sessions) > 0 && Number(r.sessions) > 0 && Number(r.comments) > 0 && Number(c.discussions) > 0 && Number(r.discussions) > 0)) {
						return { verdict: "NONE", detail: "degenerate baseline (zero sessions, comments, or discussions in an arm)" };
					}
					const ddRaw = (Number(c.comments) / Number(c.sessions)) / (Number(r.comments) / Number(r.sessions));
					const ddCal = (Number(c.discussions) / Number(c.sessions)) / (Number(r.discussions) / Number(r.sessions));
					const dd = ddRaw / ddCal;
					const detail = `bracket for knob 1.5: corrected DD=${dd.toFixed(3)} (under-estimate; discussion calib ${ddCal.toFixed(3)} over-corrects) <= 1.5 <= raw DD=${ddRaw.toFixed(3)} (over-estimate; conversionModifier composition) — contributor n=${c.user_count}, reader n=${r.user_count}`;
					if (dd >= 1.1 && dd <= 1.6 && ddRaw >= 1.5 && ddRaw <= 2.8) return { verdict: "NAILED", detail };
					if (dd >= 1.05 && ddRaw >= 1.35) return { verdict: "STRONG", detail };
					return { verdict: dd > 1.0 ? "WEAK" : "INVERSE", detail };
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
pr AS (SELECT distinct_id::VARCHAR AS puid, role FROM us WHERE role IN ('contributor', 'reader'))
SELECT pr.role, count(DISTINCT pr.puid)::BIGINT AS user_count,
  count(*) FILTER (WHERE e.event = 'comment posted')::BIGINT AS comments,
  count(*) FILTER (WHERE e.event = 'comment posted' AND e.is_reply = true)::BIGINT AS replies
FROM pr JOIN ev e ON e.uid = pr.puid GROUP BY 1`,
				},
				// reply-share composition: two shares with a cross-arm gap floor —
				// not a single-metric band
				assert: (rows) => {
					const by = cellsOf(rows, "role");
					const c = by.contributor, r = by.reader;
					if (!c || !r || Number(c.comments) < 500 || Number(r.comments) < 500) {
						return { verdict: "WEAK", detail: `too few comments: contributor=${c?.comments ?? 0} reader=${r?.comments ?? 0}` };
					}
					const cs = Number(c.replies) / Number(c.comments);
					const rs = Number(r.replies) / Number(r.comments);
					const detail = `is_reply share: contributor ${cs.toFixed(4)} vs reader ${rs.toFixed(4)} (expected 0.778 vs 0.667)`;
					if (cs >= 0.75 && cs <= 0.81 && rs >= 0.63 && rs <= 0.70) return { verdict: "NAILED", detail };
					if (cs >= rs + 0.05) return { verdict: "STRONG", detail };
					return { verdict: cs > rs ? "WEAK" : "INVERSE", detail };
				},
			},
		],
	},
	{
		id: "H5-edit-war",
		hook: "H5",
		archetype: "cohort-prop-scale",
		narrative:
			`Users with more than ${EDIT_WAR_THRESHOLD} 'article edited' events get EVERY edit_quality redrawn ` +
			`U[${EDIT_WAR_QUALITY_MIN}, ${EDIT_WAR_QUALITY_MAX}] (1 decimal). Edits are never deleted, so output ` +
			"edits >= 6 IMPLIES treatment — which makes the redraw EXACT on the war arm: avg = 1.5 [1.40, 1.60] and " +
			`no surviving edit_quality above ${EDIT_WAR_QUALITY_MAX} (a zero-violation purity check). The 1-4-edit ` +
			"calm arm keeps the organic edit_quality — a 3-value weighNumRange pool whose mean is pool-dependent " +
			"(measured ~2.3), so separation is asserted as a calm-minus-war gap (>= 0.4), not an absolute calm " +
			"floor.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
eu AS (SELECT uid, count(*) AS edits FROM ev WHERE event = 'article edited' GROUP BY 1),
arms AS (SELECT uid, CASE WHEN edits > ${EDIT_WAR_THRESHOLD} THEN 'war' WHEN edits BETWEEN 1 AND 4 THEN 'calm' END AS arm FROM eu)
SELECT a.arm, count(DISTINCT a.uid)::BIGINT AS user_count,
  avg(e.edit_quality) AS avg_q,
  count(*) FILTER (WHERE e.edit_quality > ${EDIT_WAR_QUALITY_MAX})::BIGINT AS over_cap
FROM arms a JOIN ev e ON e.uid = a.uid AND e.event = 'article edited'
WHERE a.arm IS NOT NULL GROUP BY 1`,
				},
				// combines an exact redraw average, a zero-violation purity count,
				// and a control-arm separation floor
				assert: (rows) => {
					const by = cellsOf(rows, "arm");
					const w = by.war, c = by.calm;
					if (!w || !c || Number(w.user_count) < 100 || Number(c.user_count) < 300) {
						return { verdict: "WEAK", detail: `cohort too small: war=${w?.user_count ?? 0} calm=${c?.user_count ?? 0}` };
					}
					const wq = Number(w.avg_q), cq = Number(c.avg_q), oc = Number(w.over_cap);
					const detail = `war avg_q=${wq.toFixed(3)} (redraw mean 1.5), over-cap violations=${oc}, calm avg_q=${cq.toFixed(3)} (war n=${w.user_count}, calm n=${c.user_count})`;
					if (oc > 0) return { verdict: "WEAK", detail: `${detail} — purity violated: one-sided recovery derivation says war-arm quality cannot exceed ${EDIT_WAR_QUALITY_MAX}` };
					// gap, not absolute calm floor: organic edit_quality is a 3-value
					// pool whose mean varies with the pool draw (see narrative)
					if (wq >= 1.4 && wq <= 1.6 && cq - wq >= 0.4) return { verdict: "NAILED", detail };
					if (wq >= 1.3 && wq <= 1.7 && cq - wq >= 0.25) return { verdict: "STRONG", detail };
					return { verdict: wq < cq ? "WEAK" : "INVERSE", detail };
				},
			},
		],
	},
	{
		id: "H6-lurker-churn",
		hook: "H6",
		archetype: "retention-divergence",
		narrative:
			`Users with fewer than ${LURKER_EVENT_THRESHOLD} events at hook time lose ` +
			`${LURKER_DROP_LIKELIHOOD}% of events after day ${LURKER_CHURN_CUTOFF_DAYS} of their own activity ` +
			"(keep 0.4). Deletions-only recovery: output n in [2,4] implies treatment (untreated output equals " +
			"hook n >= 5), and output n in [5,8] implies NO treatment (treated hook n <= 4 can only shrink), " +
			"giving a clean control arm. n=1 users are EXCLUDED from the treated arm: a single-event user has " +
			"post=0 and days-5-10=0 by construction, so they carry no churn information while dragging both the " +
			"raw ratio and the calibrator toward 0. The raw post/pre-day-10 ratio between arms is confounded by " +
			"organic front-loading (tiny users have mechanically shorter activity spans), so the story " +
			"self-calibrates on the PRE-cutoff half-split (days 0-5 vs 5-10 — H6 never touches pre-cutoff " +
			"events): corrected DD = (rho_tiny/rho_small) / (rho_pre_tiny/rho_pre_small), and r = DD/0.4 must " +
			"land in [0.6, 1.4] (NAILED) / [0.45, 1.75] (STRONG); INVERSE if the raw ratio is not even below 1. " +
			"The control band [5,8] is ADJACENT to the treated band (not [6,10]) because calibration transfers " +
			"better between closer activity levels — the estimator is sensitive to this choice (r moved 1.9 -> " +
			"1.3 between [6,10] and [5,8] at reduced scale), which is honest evidence the residual " +
			"self-similarity assumption carries real uncertainty; the STRONG band prices that in. Both arms are " +
			"restricted to role 'reader' (the reader + lurker personas — where nearly all sub-5-event users " +
			"live) so the control arm is not polluted by low-output contributors/moderators whose funnel " +
			"conversionModifier gives them a different organic event-spacing shape. Users born within 16d of " +
			"datasetEnd are excluded (no post-cutoff observation window).",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
rd AS (SELECT distinct_id::VARCHAR AS puid FROM us WHERE role = 'reader'),
n AS (SELECT e.uid, count(*) AS n, min(e.t) AS f FROM ev e JOIN rd ON rd.puid = e.uid GROUP BY 1),
arms AS (
  SELECT uid, f, CASE WHEN n BETWEEN 2 AND 4 THEN 'tiny' WHEN n BETWEEN 5 AND 8 THEN 'small' END AS arm
  FROM n WHERE f < TIMESTAMP '${H6_LATEBORN_TS}'
)
SELECT a.arm, count(DISTINCT a.uid)::BIGINT AS user_count,
  count(*) FILTER (WHERE e.t <= a.f + INTERVAL ${LURKER_CHURN_CUTOFF_DAYS} DAY)::BIGINT AS pre,
  count(*) FILTER (WHERE e.t > a.f + INTERVAL ${LURKER_CHURN_CUTOFF_DAYS} DAY)::BIGINT AS post,
  count(*) FILTER (WHERE e.t <= a.f + INTERVAL ${LURKER_CHURN_CUTOFF_DAYS / 2} DAY)::BIGINT AS pre_a,
  count(*) FILTER (WHERE e.t > a.f + INTERVAL ${LURKER_CHURN_CUTOFF_DAYS / 2} DAY AND e.t <= a.f + INTERVAL ${LURKER_CHURN_CUTOFF_DAYS} DAY)::BIGINT AS pre_b
FROM arms a JOIN ev e ON e.uid = a.uid
WHERE a.arm IS NOT NULL GROUP BY 1`,
				},
				// self-calibrated double ratio with an INVERSE guard on the raw
				// direction — beyond the declarative grammar
				assert: (rows) => {
					const by = cellsOf(rows, "arm");
					const t = by.tiny, c = by.small;
					if (!t || !c || Number(t.user_count) < 100 || Number(c.user_count) < 100) {
						return { verdict: "WEAK", detail: `cohort too small: tiny=${t?.user_count ?? 0} small=${c?.user_count ?? 0}` };
					}
					if (!(Number(t.pre) > 0 && Number(c.pre) > 0 && Number(c.post) > 0 && Number(t.pre_a) > 0 && Number(c.pre_a) > 0 && Number(c.pre_b) > 0)) {
						return { verdict: "NONE", detail: "degenerate pooled counts (zero pre/post cell)" };
					}
					const keep = 1 - LURKER_DROP_LIKELIHOOD / 100;
					const raw = (Number(t.post) / Number(t.pre)) / (Number(c.post) / Number(c.pre));
					const calib = (Number(t.pre_b) / Number(t.pre_a)) / (Number(c.pre_b) / Number(c.pre_a));
					const corrected = raw / calib;
					const r = corrected / keep;
					const detail = `raw ratio ${raw.toFixed(4)}, pre-trajectory calib ${calib.toFixed(4)}, corrected keep ${corrected.toFixed(4)} vs knob ${keep} (r=${r.toFixed(3)}; tiny n=${t.user_count}, small n=${c.user_count})`;
					if (raw >= 1) return { verdict: "INVERSE", detail };
					if (r >= 0.6 && r <= 1.4) return { verdict: "NAILED", detail };
					if (r >= 0.45 && r <= 1.75) return { verdict: "STRONG", detail };
					return { verdict: "WEAK", detail };
				},
			},
		],
	},
	{
		id: "H7-creator-profiles",
		hook: "H7",
		archetype: "cohort-prop-scale",
		narrative:
			"The user hook deterministically overwrites articles_created and reputation_score per role: creator " +
			"art U[50,200] rep U[80,100], moderator art U[10,50] rep U[40,70], contributor art U[1,15] rep " +
			"U[15,50], reader art 0 rep U[0,20]. Every profile hits exactly one branch and nothing else touches " +
			"these props, so the ranges are EXACT (zero violations) and the creator average sits at the uniform " +
			"midpoint 90 [88, 92] (~500 creators, se ~0.26).",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH us AS (SELECT * FROM ${US})
SELECT role, count(*)::BIGINT AS user_count,
  avg(reputation_score) AS avg_rep,
  min(reputation_score) AS min_rep, max(reputation_score) AS max_rep,
  min(articles_created) AS min_art, max(articles_created) AS max_art
FROM us GROUP BY 1`,
				},
				// per-role exact range purity across four roles — a table of
				// zero-violation checks, not a single metric
				assert: (rows) => {
					const by = cellsOf(rows, "role");
					const RANGES = {
						creator: { rep: [80, 100], art: [50, 200], minUsers: 200 },
						moderator: { rep: [40, 70], art: [10, 50], minUsers: 300 },
						contributor: { rep: [15, 50], art: [1, 15], minUsers: 300 },
						reader: { rep: [0, 20], art: [0, 0], minUsers: 300 },
					};
					const problems = [];
					for (const [role, spec] of Object.entries(RANGES)) {
						const r = by[role];
						if (!r) { problems.push(`${role}: missing`); continue; }
						if (Number(r.user_count) < spec.minUsers) problems.push(`${role}: only ${r.user_count} users`);
						if (Number(r.min_rep) < spec.rep[0] || Number(r.max_rep) > spec.rep[1]) {
							problems.push(`${role}: rep [${r.min_rep}, ${r.max_rep}] outside [${spec.rep}]`);
						}
						if (Number(r.min_art) < spec.art[0] || Number(r.max_art) > spec.art[1]) {
							problems.push(`${role}: articles [${r.min_art}, ${r.max_art}] outside [${spec.art}]`);
						}
					}
					const cAvg = Number(by.creator?.avg_rep ?? 0);
					const detail = problems.length
						? `range violations: ${problems.join("; ")}`
						: `all four role ranges exact; creator avg rep ${cAvg.toFixed(2)} (n=${by.creator.user_count})`;
					if (problems.length) return { verdict: "WEAK", detail };
					if (cAvg >= 88 && cAvg <= 92) return { verdict: "NAILED", detail };
					if (cAvg >= 85 && cAvg <= 95) return { verdict: "STRONG", detail };
					return { verdict: "WEAK", detail };
				},
			},
		],
	},
	{
		id: "H8-pro-content-lift",
		hook: "H8",
		archetype: "funnel-conversion-by-segment",
		narrative:
			`Non-pro/supporter users drop ${PRO_LIFT_FREE_DROP_LIKELIHOOD}% of ALL 'comment posted' events. ` +
			"Mechanism read: comments-per-app-session free/paid = the exact keep rate 0.35 [0.30, 0.40] — H4's " +
			"clone factor applies to active contributors in BOTH tiers (tier is independent of persona) and " +
			"cancels in the pooled ratio. Mixpanel-visible read: the emulator's Content Creation published→comment " +
			"step conversion, paid/free, at the 60h window (48h generative x 1.25 H9 free stretch so the free arm " +
			"is not right-censored). The conversion lift is NONLINEAR in the keep rate (P(>=1 surviving comment in " +
			"window)); bracketing the per-window comment density over [0.5, 3] gives paid/free in [1.35, 2.60].",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT CASE WHEN e.subscription_tier IN ('pro', 'supporter') THEN 'paid' ELSE 'fr' END AS arm,
  count(DISTINCT e.uid)::BIGINT AS user_count,
  count(*) FILTER (WHERE e.event = 'comment posted')::DOUBLE
    / nullif(count(*) FILTER (WHERE e.event = 'app session'), 0) AS cps
FROM ev e GROUP BY 1`,
				},
				select: {
					fr: { where: { arm: "fr" } },
					paid: { where: { arm: "paid" } },
				},
				expect: { metric: "fr.cps / paid.cps", op: "between", target: [0.30, 0.40] },
				minCohort: 1000,
			},
			{
				breakdown: {
					type: "timeToConvert",
					steps: ["article viewed", "article published", "comment posted"],
					breakdownByUserProperty: "subscription_tier",
					conversionWindowMs: Math.round(48 * TTC_FREE_FACTOR * 3600 * 1000),
				},
				// pools pro+supporter step_counts and takes a published→comment
				// step-conversion double ratio — beyond a single-metric band
				assert: (rows) => {
					const by = cellsOf(rows, "segment_value");
					const pooled = (names) => {
						const cs = names.map((n) => by[n]).filter(Boolean);
						const pub = cs.reduce((s, c) => s + (c.step_counts?.[1] ?? 0), 0);
						const com = cs.reduce((s, c) => s + (c.step_counts?.[2] ?? 0), 0);
						return pub > 0 ? { rate: com / pub, pub } : null;
					};
					const paid = pooled(["pro", "supporter"]);
					const free = pooled(["free"]);
					if (!paid || !free) return { verdict: "NONE", detail: "missing tier segments in emulator rows" };
					if (paid.pub < 300 || free.pub < 300) {
						return { verdict: "WEAK", detail: `too few published-step entries: paid=${paid.pub} free=${free.pub}` };
					}
					const r = paid.rate / free.rate;
					const detail = `published→comment step conversion paid ${paid.rate.toFixed(4)} vs free ${free.rate.toFixed(4)} (ratio ${r.toFixed(3)}; entries ${paid.pub}/${free.pub})`;
					if (r >= 1.35 && r <= 2.6) return { verdict: "NAILED", detail };
					if (r >= 1.2) return { verdict: "STRONG", detail };
					return { verdict: r > 1 ? "WEAK" : "INVERSE", detail };
				},
			},
		],
	},
	{
		id: "H9-content-ttc",
		hook: "H9",
		archetype: "funnel-ttc-by-segment",
		narrative:
			`funnel-post scales Content Creation inter-step gaps by tier: pro/supporter x${TTC_PRO_FACTOR}, free ` +
			`x${TTC_FREE_FACTOR} (v1.6: scoped to Content Creation only). Cross-event SQL cannot see this (greedy ` +
			"single-pass pairing — the documented limitation), so the assertion goes through the emulator's " +
			`timeToConvert at 48h x ${TTC_FREE_FACTOR} = 60h, covering the stretched support so the free arm is ` +
			"not right-censored. There is NO untouched tier, so the primary read is the cross ratio pro/free " +
			"(knob distance 0.77/1.25 = 0.62, masked asymmetrically by organic cross-instance pairings — " +
			"compression survives ~45-85% of its log distance, stretch only ~15-50%, per the fitness/dating " +
			"measurements — giving [0.65, 0.92]); the consistency read is supporter/pro, identically scaled " +
			"tiers whose ratio must sit at 1 [0.85, 1.15].",
		assertions: [
			{
				breakdown: {
					type: "timeToConvert",
					steps: ["article viewed", "article published", "comment posted"],
					breakdownByUserProperty: "subscription_tier",
					conversionWindowMs: Math.round(48 * TTC_FREE_FACTOR * 3600 * 1000),
				},
				select: {
					pr: { where: { segment_value: "pro" } },
					fr: { where: { segment_value: "free" } },
				},
				expect: { metric: "pr.median_ttc_ms / fr.median_ttc_ms", op: "between", target: [0.65, 0.92] },
				// pro and supporter are each 1/6 of the tier draw (~1,667 of 10K
				// users); ~250 pro converters expected at full fidelity, and a
				// median over 200+ is statistically solid
				minCohort: 200,
			},
			{
				breakdown: {
					type: "timeToConvert",
					steps: ["article viewed", "article published", "comment posted"],
					breakdownByUserProperty: "subscription_tier",
					conversionWindowMs: Math.round(48 * TTC_FREE_FACTOR * 3600 * 1000),
				},
				select: {
					sup: { where: { segment_value: "supporter" } },
					pr: { where: { segment_value: "pro" } },
				},
				expect: { metric: "sup.median_ttc_ms / pr.median_ttc_ms", op: "between", target: [0.85, 1.15] },
				minCohort: 200,
			},
		],
	},
	{
		id: "H10-article-magic-number",
		hook: "H10",
		archetype: "frequency-sweet-spot",
		narrative:
			`Sweet-spot publishers (${ARTICLE_SWEET_MIN}-${ARTICLE_SWEET_MAX} articles at hook time) get ` +
			`upvote_count x${ARTICLE_UPVOTE_BOOST} (rounded); over-publishers (${ARTICLE_OVER_THRESHOLD}+) lose ` +
			`${ARTICLE_UPVOTE_DROP_LIKELIHOOD}% of 'upvote given' events from day ${ARTICLE_FATIGUE_START_DAY} ` +
			"(creator burnout — the drop is calendar-scoped BY DESIGN, see the knob comment). The VALUE read is " +
			"clean across personas (iid draw): sweet/low avg upvote_count reads ~1.35 with integer-rounding " +
			"drift [1.25, 1.50]. The VOLUME read cannot be a cross-arm level comparison: within contributors, " +
			"publish count is intrinsically coupled to activity, and the organic upvote share of events varies " +
			"23-58% across publish bands no matter the denominator (sessions scale sublinearly, discussions " +
			"carry a once-per-user Onboarding component, activity-band matching leaves different event mixes). " +
			"Instead the story runs a difference-in-differences at the day-60 edge: each arm's own after/before " +
			"upvotes-per-session ratio cancels its activity composition (measured arm-invariant to ~0.1% on " +
			"untreated data — over 1.1137 vs sweet 1.1126), so DiD = (over after/before) / (sweet after/before) " +
			`reads the ${1 - ARTICLE_UPVOTE_DROP_LIKELIHOOD / 100} keep rate: [0.50, 0.70] NAILED, [0.42, 0.80] ` +
			"STRONG. Arms are role 'contributor' only; sessions are untouched by every hook; H3's x3 (at 21+ " +
			"publishes) changes values, never counts, so it cannot touch the volume read.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
pu AS (SELECT uid, count(*) FILTER (WHERE event = 'article published') AS pubs FROM ev GROUP BY 1),
arms AS (SELECT uid, CASE WHEN pubs BETWEEN ${ARTICLE_SWEET_MIN} AND ${ARTICLE_SWEET_MAX} THEN 'sw' WHEN pubs <= 1 THEN 'lo' END AS arm FROM pu)
SELECT a.arm, count(DISTINCT a.uid)::BIGINT AS user_count, avg(e.upvote_count) AS avg_uc
FROM arms a JOIN ev e ON e.uid = a.uid AND e.event = 'upvote given'
WHERE a.arm IS NOT NULL GROUP BY 1`,
				},
				select: {
					sw: { where: { arm: "sw" } },
					lo: { where: { arm: "lo" } },
				},
				expect: { metric: "sw.avg_uc / lo.avg_uc", op: "between", target: [1.25, 1.5] },
				minCohort: 300,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
pr AS (SELECT distinct_id::VARCHAR AS puid FROM us WHERE role = 'contributor'),
pu AS (SELECT uid, count(*) FILTER (WHERE event = 'article published') AS pubs FROM ev GROUP BY 1),
arms AS (
  SELECT pu.uid, CASE WHEN pubs BETWEEN ${ARTICLE_SWEET_MIN} AND ${ARTICLE_SWEET_MAX} THEN 'sw'
                      WHEN pubs >= ${ARTICLE_OVER_THRESHOLD} THEN 'ov' END AS arm
  FROM pu JOIN pr ON pr.puid = pu.uid
)
SELECT a.arm || '_' || CASE WHEN e.t >= TIMESTAMP '${FATIGUE_TS}' THEN 'after' ELSE 'before' END AS cell,
  count(DISTINCT a.uid)::BIGINT AS user_count,
  count(*) FILTER (WHERE e.event = 'upvote given')::BIGINT AS ups,
  count(*) FILTER (WHERE e.event = 'app session')::BIGINT AS sessions
FROM arms a JOIN ev e ON e.uid = a.uid
WHERE a.arm IS NOT NULL GROUP BY 1`,
				},
				// difference-in-differences across the day-60 fatigue edge — a
				// four-cell double ratio the one-operator grammar can't express
				assert: (rows) => {
					const by = cellsOf(rows, "cell");
					const ob = by.ov_before, oa = by.ov_after, sb = by.sw_before, sa = by.sw_after;
					const cells = { ov_before: ob, ov_after: oa, sw_before: sb, sw_after: sa };
					for (const [name, c] of Object.entries(cells)) {
						if (!c || Number(c.ups) < 300 || Number(c.sessions) < 200) {
							return { verdict: "WEAK", detail: `cell ${name} too small: ups=${c?.ups ?? 0} sessions=${c?.sessions ?? 0} (needs 300/200)` };
						}
					}
					const keep = 1 - ARTICLE_UPVOTE_DROP_LIKELIHOOD / 100;
					const rOv = (Number(oa.ups) / Number(oa.sessions)) / (Number(ob.ups) / Number(ob.sessions));
					const rSw = (Number(sa.ups) / Number(sa.sessions)) / (Number(sb.ups) / Number(sb.sessions));
					const did = rOv / rSw;
					const detail = `upvotes-per-session after/before: over ${rOv.toFixed(4)}, sweet ${rSw.toFixed(4)}, DiD=${did.toFixed(4)} vs keep ${keep} (over n=${ob.user_count}/${oa.user_count}, sweet n=${sb.user_count}/${sa.user_count})`;
					if (did >= 0.5 && did <= 0.7) return { verdict: "NAILED", detail };
					if (did >= 0.42 && did <= 0.8) return { verdict: "STRONG", detail };
					return { verdict: did < 1 ? "WEAK" : "INVERSE", detail };
				},
			},
		],
	},
];

export default config;
