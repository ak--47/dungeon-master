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
 * NAME:       Chirp
 * APP:        Twitter+Instagram-style social media platform with algorithmic
 *             feed, creator monetization, communities, and direct messaging.
 *             Power users become "creators" with subscriber tiers; native ads
 *             woven into feed and story placements.
 * SCALE:      10,000 users, ~1.4M events, 121 days (2026-01-01 → 2026-05-01)
 * CORE LOOP:  account created → profile updated → post created → consume + engage
 *
 * EVENTS (18):
 *   post viewed (30) > post liked (18) > story viewed (15) > post created (12)
 *   > notification received (12) > comment posted (10) > ad viewed (10)
 *   > user followed (8) > dm sent (8) > search performed (7) > post shared (6)
 *   > story created (5) > profile updated (3) > user unfollowed (2)
 *   > ad clicked (2) > creator subscription started (2) > report submitted (1)
 *   > account created (1)
 *
 * FUNNELS (8):
 *   - Onboarding:       account created → profile updated → post created (70%)
 *   - Feed Engagement:  post viewed → post liked → comment posted (45%)
 *   - Content Cycle:    post created → post viewed → post liked → post shared (30%)
 *   - Stories:          story created → story viewed → dm sent (40%)
 *   - Discovery:        search performed → post viewed → user followed (35%)
 *   - Notifications:    notification received → post viewed → post liked (50%)
 *   - Creator Monetize: profile updated → creator subscription started → post created (15%)
 *   - Ad Moderation:    ad viewed → ad clicked → report submitted (20%)
 *
 * USER PROPS:  app_version, account_type, follower_count, following_count,
 *              bio_length, verified, content_niche
 * SUPER PROPS: app_version, account_type
 * SCD PROPS:   account_type (personal/creator/business/verified, monthly fuzzy, max 6),
 *              community_status (new/growing/established/featured, monthly fixed,
 *              max 6, community_id-scoped)
 * GROUPS:      community_id (100 communities)
 */

// ── HOOK STORIES ──
/*
 * NOTE: All cohort effects are HIDDEN — discoverable only via behavioral cohorts
 * (count an event per user, then measure downstream). No cohort flag is stamped
 * on events. Algorithm-change source flips and engagement-bait short durations
 * are raw mutations of config-defined props.
 *
 * -------------------------------------------------------------------------------------
 * 1. VIRAL CONTENT CASCADE (everything)
 * -------------------------------------------------------------------------------------
 *
 * PATTERN: Among users with 10+ pre-injection "post created" events, 5%
 * become viral creators. Each of their posts triggers 60-120 cloned
 * post-viewed, 60-120 post-liked, AND 60-120 post-shared events with
 * offset timestamps (VIRAL_CLONES_MIN/MAX knobs).
 *
 * MEASUREMENT NOTE: the old "cohort A = 10+ post created" read is dead.
 * At 1.2 events/user/day over 121 days the organic median is ~10 posts,
 * and clone injections (H2/H6/H8) push ~85% of users past 10 final posts
 * — binning on 10+ measures activity, not virality. The analyst-visible
 * signal is CONCENTRATION: viral creators are ~3% of users but hold the
 * bulk of all engagement events.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Engagement Concentration
 *   - Report type: Insights
 *   - Events: "post viewed" + "post liked" + "post shared"
 *   - Measure: Total per user, sorted descending
 *   - Expected: top 3% of users hold ~55-68% of all engagement events
 *     (measured 62% at reduced scale; organic counterfactual: 5.7%).
 *     Viral creators show 500+ engagement events vs a ~45 median.
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
 *   - Expected: A ~ 1.5x posts per user vs B (measured 1.50 at reduced
 *     scale)
 *
 *   MEASUREMENT NOTE: the 1.5x cohort ratio decomposes as ~1.24x activity
 *   confound (high-follow users are simply more active — organic
 *   counterfactual ratio) x ~1.21x true hook increment. The hook's +50%
 *   applies to pre-injection posts only, so H6's +2-clones-per-post
 *   stacking dilutes the incremental share for subscriber users. The
 *   headline number still lands on ~1.5x because both factors compound.
 *
 * REAL-WORLD ANALOGUE: Users who actively follow many people tend to
 * receive follow-backs and post more frequently.
 *
 * -------------------------------------------------------------------------------------
 * 3. ALGORITHM CHANGE (everything)
 * -------------------------------------------------------------------------------------
 *
 * PATTERN: On day 45 (2026-02-15), the dominant `source` for "post viewed"
 * flips: before day 45, 70% of views are forced to "feed"; after, 70% are
 * forced to "explore". Mutates an existing config-defined prop — no flag.
 *
 * INTERPLAY: H5 runs AFTER this flip and steals 30% of all post-day-30
 * views for source="notification", so the post-day-45 explore share tops
 * out near ~54%, not 70%. Three visible regimes (measured, reduced scale):
 *   - pre-day-30:  feed 78%, notification 3%, explore 6%
 *   - day 30-45:   feed 54%, notification 32%
 *   - post-day-45: explore 54%, notification 32%, feed 5%
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Source Distribution Over Time
 *   - Report type: Insights
 *   - Event: "post viewed"
 *   - Measure: Total
 *   - Breakdown: "source"
 *   - Line chart by day
 *   - Expected: feed dominates pre-day-45 (~78% before day 30, ~54%
 *     day 30-45); explore dominates post-day-45 (~54%); feed collapses
 *     to ~5% after the flip
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
 * Runs after all injection passes, so cloned views (H1/H6) are crushed at
 * the same rate.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: View Duration Distribution
 *   - Report type: Insights
 *   - Event: "post viewed"
 *   - Measure: Distribution of "view_duration_sec"
 *   - Expected: ~ 20% of values cluster at 1-5 sec; rest at 5+ sec
 *     (measured 20.4% at reduced scale; the organic generator floors
 *     durations above 5s, so the low mode is 100% hook-made)
 *
 * REAL-WORLD ANALOGUE: Clickbait posts collect impressions but bounce
 * quality is awful, dragging down avg watch time.
 *
 * -------------------------------------------------------------------------------------
 * 5. NOTIFICATION RE-ENGAGEMENT (everything)
 * -------------------------------------------------------------------------------------
 *
 * PATTERN: After day 30 (2026-01-31), 30% of "post viewed" events have
 * source flipped to "notification". Runs after H3, so it wins on the
 * overlap. Mutates the existing config-defined `source` prop.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Notification-Sourced Views Over Time
 *   - Report type: Insights
 *   - Event: "post viewed"
 *   - Measure: Total
 *   - Filter: source = "notification"
 *   - Line chart by day
 *   - Expected: ~3% before day 30 (organic 20% share diluted by H3's
 *     70% feed-force and by H1/H6 clones that never stamp notification),
 *     then ~32% after (measured 3.3% -> 32.2% at reduced scale, ~10x)
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
 * post-viewed events stamped `source="profile"`. No flag — discover via
 * cohort builder.
 *
 * SCALE NOTE: "creator subscription started" is a weight-2 event over 121
 * days, so ~78% of users have at least one — the cohort is an engagement
 * marker, not an elite-creator flag. The 3x contrast still reads cleanly
 * because the clone multiplier applies per-post. The `source="profile"`
 * stamp is mostly overwritten by H3/H5 (which run later): only ~21% of
 * the stamps survive, showing as a mild profile-share elevation
 * (subscribers ~4.4% vs non ~2.3% of views), not a dominant source.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Posts per User — Subscribers vs Not
 *   - Report type: Insights (with cohort)
 *   - Cohort A: users with >= 1 "creator subscription started"
 *   - Cohort B: users with 0
 *   - Event: "post created"
 *   - Measure: Total per user
 *   - Expected: A ~ 3.3x posts per user (3x knob compounded with a mild
 *     activity confound; measured 3.32 at reduced scale)
 *
 *   Report 2: Stories per User — Subscribers vs Not
 *   - Same cohorts, event "story created"
 *   - Expected: A ~ 3.8x stories per user — a purer read than posts:
 *     H2's snowball dupes lift non-subscriber POSTS (denominator) but
 *     never stories, so the story contrast runs higher (measured 3.82)
 *
 * REAL-WORLD ANALOGUE: Creators with paying subscribers publish more often.
 *
 * -------------------------------------------------------------------------------------
 * 7. TOXICITY CHURN (everything)
 * -------------------------------------------------------------------------------------
 *
 * PATTERN: Users with 2+ "report submitted" events lose 60% of ALL
 * activity after day 30 (2026-01-31) — each post-cutoff event dropped at
 * 60% likelihood, including injected clones and the reports themselves.
 * No flag — discover via retention or per-user activity drop.
 *
 * MEASUREMENT NOTE: compare each cohort's post-day-30 / pre-day-30 event
 * ratio, not absolute counts — the dataset is growth-shaped (born-in
 * users make post/pre ~3.2x for everyone), and reporters are heavy users
 * whose absolute counts stay high even after the drop. Measured (reduced
 * scale): reporters 1.27 post/pre vs normal 3.21 — a 0.40x relative
 * contrast, matching the 60% drop knob. The organic counterfactual
 * confirms the paired per-user drop is 0.42x exactly.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Retention by Toxicity
 *   - Report type: Retention (or Insights: post/pre day-30 event ratio)
 *   - Cohort A: users with >= 2 "report submitted"
 *   - Cohort B: rest
 *   - Expected: A's post-day-30 activity ~ 0.4x of B's, relative to
 *     each cohort's own pre-day-30 baseline
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
 * BASELINE NOTE: the config's soup dayOfWeekWeights are all >= 1.0, which
 * TimeSoup treats as accept-always (see lib/utils/utils.js TimeSoup phase
 * 2) — the organic DOW distribution is FLAT (measured 0.98 weekend/weekday
 * on the organic counterfactual). The 1.25x hooked ratio is therefore
 * pure hook signal, slightly under the 1.3 knob because late-Sunday dupes
 * (+1-3h) can roll into Monday and H7 drops some weekend clones.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Posts by Day of Week
 *   - Report type: Insights
 *   - Events: "post created" + "story created"
 *   - Measure: Total
 *   - Breakdown: Day of week
 *   - Expected: Sat/Sun ~ 1.25x weekday bars (measured 1.25 at reduced
 *     scale)
 *
 * REAL-WORLD ANALOGUE: Weekend leisure time produces a natural creation surge.
 *
 * -------------------------------------------------------------------------------------
 * 9. POST-CREATED MAGIC NUMBER (everything)
 * -------------------------------------------------------------------------------------
 *
 * PATTERN: Users in the 3-7 pre-injection post-created sweet spot get
 * +40% comment_length on their comment-posted events (richer engagement).
 * Users with 8+ pre-injection posts get comment_length x0.7 (burnout —
 * shorter, lazier comments). NO events are dropped; the effect is purely
 * on the comment_length property. No flag — discover by binning users on
 * post count.
 *
 * MEASUREMENT NOTE: the hook buckets on PRE-injection post counts;
 * analysts see POST-injection counts inflated by H2/H6/H8 clones. With an
 * organic median of ~10 posts, 73% of users are hook-"over" (burnout is
 * the norm), and clone inflation pushes most boosted sweet-organic users
 * into the 8+ final bucket, diluting it. The contrast survives because
 * the final 3-7 bucket is dominated by boosted users who dodged clone
 * inflation (non-subscribers). Paired-counterfactual per-user lifts are
 * exact: low 1.00, sweet 1.40, over 0.68.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Comment Length by Post Bucket
 *   - Report type: Insights (with cohort)
 *   - Cohort A: users with 3-7 "post created" (final counts)
 *   - Cohort C: users with >= 8 "post created"
 *   - Event: "comment posted"
 *   - Measure: Average of "comment_length"
 *   - Expected: A ~ 1.7x C (measured 250 vs 145 at reduced scale)
 *
 *   Report 2: Bucket Ordering
 *   - Add Cohort B: users with 0-2 "post created" (small population —
 *     unmutated users with almost no comments)
 *   - Expected ordering: A (sweet, ~250) > B (low, ~200) > C (over, ~145)
 *
 * REAL-WORLD ANALOGUE: Moderate posters write thoughtful comments; the
 * over-prolific burn out and leave short, low-effort replies.
 *
 * -------------------------------------------------------------------------------------
 * 10. ONBOARDING TIME-TO-CONVERT (funnel-post)
 * -------------------------------------------------------------------------------------
 *
 * PATTERN: Creator and business account_type users complete funnels
 * 1.4x faster (gap factor 0.71); personal users 1.25x slower (factor
 * 1.25). The hook intercepts EVERY funnel-post array (all 8 funnels, not
 * just onboarding), computes the gap between consecutive steps, and
 * scales each gap by the account-type factor before rewriting the step
 * timestamps. The onboarding funnel (account created -> profile updated
 * -> post created) is where the effect is cleanly measurable: "account
 * created" is unique per user (isFirstEvent), so the funnel evaluation
 * anchors on the scaled instance instead of racing organic standalones.
 *
 * MEASURED (reduced scale, emulateBreakdown timeToConvert, stable across
 * 1h-24h windows): personal median ~23min, creator/business ~16min —
 * fast/personal = 0.71. Per-leg attenuation vs the organic counterfactual
 * (baseline ratio 0.96, medians ~20min): fast leg 0.71 knob -> 0.81
 * realized, slow leg 1.25 -> 1.11; greedy step-matching occasionally
 * substitutes organic standalone events for scaled ones, pulling both
 * legs toward 1 (same mechanism as sass H9, milder here thanks to the
 * unique first-step anchor).
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Onboarding Funnel Median TTC by Account Type
 *   - Report type: Funnels
 *   - Steps: "account created" -> "profile updated" -> "post created"
 *   - Measure: Median time to convert
 *   - Breakdown: "account_type" (superProp)
 *   - Expected: creator/business median ~ 0.71x of personal
 *
 *   NOTE (funnel-post measurement): visible via Mixpanel funnel median
 *   TTC. Cross-event MIN->MIN SQL queries on raw events do NOT show this.
 *
 * REAL-WORLD ANALOGUE: Creators and businesses arrive with clear intent
 * and complete profile setup faster; personal users browse casually and
 * take longer to commit to their first post.
 *
 * =====================================================================================
 * EXPECTED METRICS SUMMARY (measured at reduced scale, 2K users; see stories
 * export below for the NAILED/STRONG bands asserted at full fidelity)
 * =====================================================================================
 *
 * Hook                      | Analyst-visible metric            | Measured
 * --------------------------|-----------------------------------|------------------
 * H1 Viral Content Cascade  | top-3% share of engagement events | 0.62 (organic 0.06)
 * H2 Follow-Back Snowball   | posts/user, 5+ follows vs rest    | 1.50x
 * H3 Algorithm Change       | post-d45 explore share            | 0.54 (pre-d30 feed 0.78)
 * H4 Engagement Bait        | share of views <= 5 sec           | 0.204 (organic 0.00)
 * H5 Notification Re-engage | source=notification share         | 0.033 pre-d30 -> 0.322 post
 * H6 Creator Monetization   | posts/user sub vs non             | 3.32x (stories 3.82x)
 * H7 Toxicity Churn         | post/pre-d30 ratio, rep vs norm   | 1.27 vs 3.21 (0.40x)
 * H8 Weekend Surge          | weekend/weekday daily creations   | 1.25x (organic 0.98)
 * H9 Magic Number           | comment_length sweet vs over      | 1.72x (250 vs 145)
 * H10 Onboarding TTC        | funnel median TTC fast/personal   | 0.71 (organic 0.96)
 *
 * MEASUREMENT CAVEATS:
 * - Paired organic counterfactual (hook: r => r, same seed) gives exact
 *   per-user baselines: H9 lifts land on the knobs (1.00/1.40/0.68), H7's
 *   drop is 0.42x paired, and the engagement-concentration jump (0.06 ->
 *   0.62) is entirely injection-made.
 * - Post-count cohorts use FINAL counts (analyst view). Clone injections
 *   inflate these: 85% of users clear 10 final posts, 73% are hook-"over".
 * - H10 is invisible to cross-event MIN->MIN SQL; use funnel median TTC
 *   (emulateBreakdown timeToConvert) as in the stories export.
 * =====================================================================================
 */

// ── SCALE ──
const SEED = "harness-social";
const NUM_USERS = 10_000;
const DATASET_START = "2026-01-01T00:00:00Z";
const DATASET_END = "2026-05-01T23:59:59Z";
const EVENTS_PER_DAY = 1.2;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── KNOBS (tweak these to reshape stories) ──
const VIRAL_POST_THRESHOLD = 10;
const VIRAL_USER_LIKELIHOOD = 5;
const VIRAL_CLONES_MIN = 60;
const VIRAL_CLONES_MAX = 120;

const FOLLOW_SNOWBALL_THRESHOLD = 5;
const FOLLOW_SNOWBALL_LIKELIHOOD = 50;

const ALGORITHM_CHANGE_DAY = 45;
const ALGORITHM_FLIP_LIKELIHOOD = 70;

const ENGAGEMENT_BAIT_LIKELIHOOD = 20;

const REENGAGEMENT_START_DAY = 30;
const REENGAGEMENT_LIKELIHOOD = 30;

const CREATOR_POST_CLONES = 2;
const CREATOR_STORY_CLONES = 2;
const CREATOR_VIEW_CLONE_LIKELIHOOD = 25;

const TOXICITY_THRESHOLD = 2;
const TOXICITY_CUTOFF_DAYS = 30;
const TOXICITY_DROP_LIKELIHOOD = 60;

const WEEKEND_CLONE_LIKELIHOOD = 30;

const POST_SWEET_MIN = 3;
const POST_SWEET_MAX = 7;
const POST_OVER_THRESHOLD = 8;
const POST_SWEET_COMMENT_BOOST = 1.4;
const POST_OVER_COMMENT_FACTOR = 0.7;

const ONBOARDING_TTC_FAST = 0.71;
const ONBOARDING_TTC_SLOW = 1.25;

// ── DATA ARRAYS ──
// Generate consistent post IDs for lookup tables
const postIds = v.range(1, 1001).map(n => `post_${v.uid(8)}`);

// ── HELPER FUNCTIONS ──
function handleFunnelPostHooks(record, meta) {
	// H10: ONBOARDING TIME-TO-CONVERT — creator/business 0.71x faster,
	// personal 1.25x slower. Scales inter-step gaps via timestamp rewrite.
	const segment = meta?.profile?.account_type;
	if (Array.isArray(record) && record.length > 1) {
		const factor = (
			segment === "creator" || segment === "business" ? ONBOARDING_TTC_FAST :
			segment === "personal" ? ONBOARDING_TTC_SLOW :
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

	if (postCreatedCount >= VIRAL_POST_THRESHOLD && chance.bool({ likelihood: VIRAL_USER_LIKELIHOOD })) {
		isViralCreator = true;
	}

	// Second pass: inject cloned events (no behavioral cohort flags)
	for (let idx = userEvents.length - 1; idx >= 0; idx--) {
		const event = userEvents[idx];
		const eventTime = dayjs(event.time);

		// H1: VIRAL CONTENT CASCADE — clone 60-120 view/like/share per post.
		// Discovery: bin users by post-created count, observe per-user view/like/share volume.
		if (isViralCreator && event.event === "post created") {
			const viralViews = chance.integer({ min: VIRAL_CLONES_MIN, max: VIRAL_CLONES_MAX });
			const viralLikes = chance.integer({ min: VIRAL_CLONES_MIN, max: VIRAL_CLONES_MAX });
			const viralShares = chance.integer({ min: VIRAL_CLONES_MIN, max: VIRAL_CLONES_MAX });
			const injected = [];

			// Clone only from a real same-type template. The old
			// `...(viewTemplate || event)` fallback would bleed post-created
			// props (character_count, has_media, hashtag_count) onto
			// view/like/share records — undeclared columns on those event
			// types (schema rule 1). Viral users virtually always carry all
			// three templates, so skipping is behavior-neutral in practice.
			const viewTemplate = userEvents.find(e => e.event === "post viewed");
			const likeTemplate = userEvents.find(e => e.event === "post liked");
			const shareTemplate = userEvents.find(e => e.event === "post shared");

			if (viewTemplate) for (let i = 0; i < viralViews; i++) {
				injected.push({
					...viewTemplate,
					event: "post viewed",
					time: eventTime.add(chance.integer({ min: 1, max: 180 }), 'minutes').toISOString(),
					user_id: event.user_id,
					post_type: event.post_type || "text",
					source: chance.pickone(["feed", "explore", "search"]),
					view_duration_sec: chance.integer({ min: 5, max: 90 }),
				});
			}
			if (likeTemplate) for (let i = 0; i < viralLikes; i++) {
				injected.push({
					...likeTemplate,
					event: "post liked",
					time: eventTime.add(chance.integer({ min: 2, max: 240 }), 'minutes').toISOString(),
					user_id: event.user_id,
					post_type: event.post_type || "text",
				});
			}
			if (shareTemplate) for (let i = 0; i < viralShares; i++) {
				injected.push({
					...shareTemplate,
					event: "post shared",
					time: eventTime.add(chance.integer({ min: 5, max: 300 }), 'minutes').toISOString(),
					user_id: event.user_id,
					share_destination: chance.pickone(["repost", "dm", "external", "copy_link"]),
				});
			}

			userEvents.splice(idx + 1, 0, ...injected);
		}

		// H2: FOLLOW-BACK SNOWBALL — extra post + comment per user-followed cluster.
		// Discovery: cohort users with >=5 user-followed events, compare posts/user.
		if (followReceivedCount >= FOLLOW_SNOWBALL_THRESHOLD && event.event === "post created") {
			if (chance.bool({ likelihood: FOLLOW_SNOWBALL_LIKELIHOOD })) {
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

		// H6: CREATOR MONETIZATION — 3x post/story rate for subscribers.
		// Discovery: cohort users with creator-subscription-started event, compare posts/user.
		if (hasCreatorSubscription && event.event === "post created") {
			for (let i = 0; i < CREATOR_POST_CLONES; i++) {
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
			for (let i = 0; i < CREATOR_STORY_CLONES; i++) {
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
			if (chance.bool({ likelihood: CREATOR_VIEW_CLONE_LIKELIHOOD })) {
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

	// H8: WEEKEND CONTENT SURGE — duplicate weekend posts/stories with offset.
	// Discovery: line chart by day-of-week shows Sat/Sun bump.
	for (let idx = userEvents.length - 1; idx >= 0; idx--) {
		const event = userEvents[idx];
		if (event.event === "post created" || event.event === "story created") {
			const dow = new Date(event.time).getUTCDay();
			if ((dow === 0 || dow === 6) && chance.bool({ likelihood: WEEKEND_CLONE_LIKELIHOOD })) {
				const etime = dayjs(event.time);
				const dup = {
					...event,
					time: etime.add(chance.integer({ min: 1, max: 3 }), 'hours').toISOString(),
				};
				userEvents.splice(idx + 1, 0, dup);
			}
		}
	}

	// H3: ALGORITHM CHANGE — day 45 flips feed → explore on post viewed.
	// H4: ENGAGEMENT BAIT — 20% of post-viewed events get crushed duration.
	// H5: NOTIFICATION RE-ENGAGEMENT — after day 30, 30% of views → notification.
	// All three run AFTER injection passes so they apply to cloned events too.
	const algorithmChangeDay = datasetStart.add(ALGORITHM_CHANGE_DAY, 'days');
	const reengagementStart = datasetStart.add(REENGAGEMENT_START_DAY, 'days');
	userEvents.forEach(e => {
		if (e.event === "post viewed") {
			const eventTime = dayjs(e.time);

			// H3: Algorithm Change
			if (eventTime.isAfter(algorithmChangeDay)) {
				if (chance.bool({ likelihood: ALGORITHM_FLIP_LIKELIHOOD })) {
					e.source = "explore";
				}
			} else {
				if (chance.bool({ likelihood: ALGORITHM_FLIP_LIKELIHOOD })) {
					e.source = "feed";
				}
			}

			// H4: Engagement Bait — 20% crushed view duration
			if (chance.bool({ likelihood: ENGAGEMENT_BAIT_LIKELIHOOD })) {
				e.view_duration_sec = chance.integer({ min: 1, max: 5 });
			}

			// H5: Notification Re-engagement (runs after #3 so can override)
			if (eventTime.isAfter(reengagementStart) && chance.bool({ likelihood: REENGAGEMENT_LIKELIHOOD })) {
				e.source = "notification";
			}
		}
	});

	// H7: TOXICITY CHURN — drop 60% of activity after day 30 for high reporters.
	// Discovery: cohort users with >=2 report-submitted events, observe retention drop.
	if (reportSubmittedCount >= TOXICITY_THRESHOLD) {
		const churnCutoff = datasetStart.add(TOXICITY_CUTOFF_DAYS, 'days');
		for (let i = userEvents.length - 1; i >= 0; i--) {
			const evt = userEvents[i];
			if (dayjs(evt.time).isAfter(churnCutoff) && chance.bool({ likelihood: TOXICITY_DROP_LIKELIHOOD })) {
				userEvents.splice(i, 1);
			}
		}
	}

	// H9: POST-CREATED MAGIC NUMBER (no flags)
	// Sweet 3-7 posts → +40% on comment_length on the user's comment events.
	// Over 8+ → -30% comment_length (engagement burnout).
	if (postCreatedCount >= POST_SWEET_MIN && postCreatedCount <= POST_SWEET_MAX) {
		userEvents.forEach(e => {
			if (e.event === 'comment posted' && typeof e.comment_length === 'number') {
				e.comment_length = Math.round(e.comment_length * POST_SWEET_COMMENT_BOOST);
			}
		});
	} else if (postCreatedCount >= POST_OVER_THRESHOLD) {
		userEvents.forEach(e => {
			if (e.event === 'comment posted' && typeof e.comment_length === 'number') {
				e.comment_length = Math.round(e.comment_length * POST_OVER_COMMENT_FACTOR);
			}
		});
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
	// All weights >= 1.0 are accept-always in TimeSoup's rejection sampler →
	// flat organic DOW. Load-bearing: removing this key re-activates
	// DEFAULT_DOW_WEIGHTS (weekend-suppressed), which would fight H8.
	soup: { dayOfWeekWeights: [1.0, 1.0, 1.0, 1.0, 1.0, 1.2, 1.2] },
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
			isAuthEvent: true,
			properties: {
				"signup_method": ["email", "google", "apple", "sso"],
				"referred_by": ["organic", "friend", "ad", "influencer"],
			}
		},
		{
			event: "post created",
			weight: 12,
			isStrictEvent: false,
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
			isStrictEvent: false,
			properties: {
				"post_type": ["text", "image", "video", "poll", "link"],
				"view_duration_sec": u.weighNumRange(1, 120, 0.3, 5),
				"source": ["feed", "explore", "search", "profile", "notification"],
			}
		},
		{
			event: "post liked",
			weight: 18,
			isStrictEvent: false,
			properties: {
				"post_type": ["text", "image", "video", "poll", "link"],
			}
		},
		{
			event: "post shared",
			weight: 6,
			isStrictEvent: false,
			properties: {
				"share_destination": ["repost", "dm", "external", "copy_link"],
			}
		},
		{
			event: "comment posted",
			weight: 10,
			isStrictEvent: false,
			properties: {
				"comment_length": u.weighNumRange(1, 500, 0.3, 20),
				"has_mention": [true, false, false],
			}
		},
		{
			event: "user followed",
			weight: 8,
			isStrictEvent: false,
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
			isStrictEvent: false,
			properties: {
				"story_type": ["photo", "video", "text"],
				"view_duration_sec": u.weighNumRange(1, 30, 0.5, 5),
				"completed": [false, false, true, true, true],
			}
		},
		{
			event: "story created",
			weight: 5,
			isStrictEvent: false,
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
			isStrictEvent: false,
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

	hook(record, type, meta) {
		if (type === "funnel-post") return handleFunnelPostHooks(record, meta);
		if (type === "everything") return handleEverythingHooks(record, meta);
		return record;
	}
};

export default config;

// ── STORIES (verification contract — consumed by social.verify.mjs) ──
/*
 * DERIVATION NOTES (all numbers measured at 2K reduced scale, seed
 * harness-social, plus an exact organic counterfactual run — same seed,
 * identity hook — used to separate engineered effects from the organic
 * activity curve):
 *
 *   - H1: top-3% of users hold 0.623 of all post viewed/liked/shared
 *     events (organic counterfactual: 0.057). 59 users show 500+
 *     engagement events vs a 45 median among 10+ posters. The old
 *     "10+ post created cohort" read is dead: 85% of users clear 10
 *     final posts (organic median ~10, clones inflate further).
 *   - H2: big-follower (5+ user followed) posts/user 42.30 vs 28.19 =
 *     1.50x. Decomposition via counterfactual: 1.24x activity confound
 *     x 1.21x true hook increment (H6's +2-clones-per-post dilutes
 *     H2's +50%-of-organic-posts for subscriber users).
 *   - H3+H5 regimes (post viewed source shares): pre-d30 feed 0.779,
 *     notification 0.033; day 30-45 feed 0.545, notification 0.320;
 *     post-d45 explore 0.539, notification 0.322, feed 0.055.
 *   - H4: share of views <= 5 sec = 0.204 (organic 0.000 — generator
 *     floors organic durations above 5s; the low mode is 100% hook-made).
 *   - H6: subscribers = 78% of users (weight-2 event over 121 days).
 *     posts/user sub vs non 35.34/10.63 = 3.32; stories/user 32.32/8.47
 *     = 3.82 (purer read: H2 dupes lift non-sub posts but not stories).
 *     Paired lifts: sub posts 3.07x, stories 3.00x; non posts 1.24x.
 *   - H7: post/pre-day-30 event ratio reporters (2+ final reports) 1.27
 *     vs normal 3.21 → 0.395 contrast. Paired per-user drop 0.419
 *     (60% knob). Growth shape makes the raw post/pre ~3.2 for everyone.
 *   - H8: weekend/weekday daily creations hooked 1.2545, organic 0.9802
 *     (soup weights >= 1.0 are accept-always → flat DOW; the old "soup
 *     dampens weekends ~0.55x" claim in the v1.5 verifier was wrong).
 *   - H9 (final-count buckets — analyst view): sweet(3-7) avg
 *     comment_length 250.09 (162 users), low(0-2) 200.28 (33 users),
 *     over(8+) 145.43 (1768 users) → sweet/over 1.72, ordering
 *     sweet > low > over. Paired per-user lifts land on the knobs:
 *     low 0.998, sweet 1.397, over 0.681.
 *   - H10 (emulateBreakdown timeToConvert @6h, stable 1h-24h): personal
 *     median 22.9min (n=64), creator 16.3 (51), business 16.2 (47) →
 *     fast/personal 0.709. Organic counterfactual: 0.963 baseline ratio,
 *     medians ~20min. Per-leg attenuation: 0.71 knob → 0.81 realized,
 *     1.25 → 1.11 (greedy step-matching, unique first-step anchor).
 *   - Identity: uid share 1.0 (auth on first event), device share
 *     0.9989, devices/user 2.07 (avgDevicePerUser: 2).
 *
 * Scale guards sit at ~50% of expected 10K populations, so 2K runs trip
 * WEAK by design; verdicts ship only from full-fidelity runs.
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
const worstOf = (...verdicts) => { const order = ["INVERSE", "NONE", "WEAK", "STRONG", "NAILED"]; return order.find(o => verdicts.some(v => v.verdict === o)) || "NONE"; };
const cellsOf = (rows, key) => Object.fromEntries((rows || []).map(r => [r[key], r]));

const DAY30 = `TIMESTAMP '2026-01-31 00:00:00'`;
const DAY45 = `TIMESTAMP '2026-02-15 00:00:00'`;

const SOURCE_WINDOWS_SQL = `SELECT
  CASE WHEN time::TIMESTAMP < ${DAY30} THEN 'pre_d30'
       WHEN time::TIMESTAMP < ${DAY45} THEN 'd30_45'
       ELSE 'post_d45' END AS win,
  COUNT(*) AS n,
  AVG((source = 'feed')::INT) AS feed,
  AVG((source = 'explore')::INT) AS explore,
  AVG((source = 'notification')::INT) AS notif
FROM ${EV} WHERE event = 'post viewed' GROUP BY 1 ORDER BY 1`;

export const stories = [
	{
		id: "social-h1-viral-concentration",
		hook: "H1",
		archetype: "cohort-count-scale",
		narrative: "Viral creators (~3% of users) hold ~62% of all engagement events; organic concentration is ~6%.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH pu AS (
  SELECT user_id::VARCHAR AS uid,
    COUNT(*) FILTER (WHERE event IN ('post viewed', 'post liked', 'post shared')) AS eng
  FROM ${EV} WHERE user_id IS NOT NULL GROUP BY 1
), ranked AS (
  SELECT eng, ROW_NUMBER() OVER (ORDER BY eng DESC) AS rn,
    COUNT(*) OVER () AS n, SUM(eng) OVER () AS tot
  FROM pu
)
SELECT SUM(eng)::DOUBLE / MAX(tot) AS top3_share, MAX(n) AS users
FROM ranked WHERE rn <= CEIL(n * 0.03)`,
				},
				assert: (rows) => {
					const r = rows?.[0] || {};
					return guarded(Number(r.users) >= 5000, `users=${r.users ?? 0}`, () => {
						const share = Number(r.top3_share);
						const detail = `top-3% share of engagement events=${share.toFixed(3)} (measured 0.623; organic counterfactual 0.057)`;
						return bandVerdict(share, [0.55, 0.68], [0.45, 0.75], detail, v => v <= 0.15);
					});
				},
			},
		],
	},
	{
		id: "social-h2-followback-snowball",
		hook: "H2",
		archetype: "cohort-count-scale",
		narrative: "Users with 5+ user-followed events post ~1.5x more (1.24x activity confound x 1.21x hook increment).",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH pu AS (
  SELECT user_id::VARCHAR AS uid,
    COUNT(*) FILTER (WHERE event = 'user followed') AS fc,
    COUNT(*) FILTER (WHERE event = 'post created') AS pc
  FROM ${EV} WHERE user_id IS NOT NULL GROUP BY 1
)
SELECT (fc >= 5) AS big, COUNT(*) AS users, AVG(pc) AS posts
FROM pu GROUP BY 1 ORDER BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "big");
					const big = by.true, small = by.false;
					return guarded(Number(big?.users) >= 570 && Number(small?.users) >= 4000, `cohorts: big=${big?.users ?? 0} small=${small?.users ?? 0}`, () => {
						const ratio = Number(big.posts) / Number(small.posts);
						const detail = `posts/user 5+ follows vs rest=${ratio.toFixed(3)} (measured 1.501; ${Number(big.posts).toFixed(1)} vs ${Number(small.posts).toFixed(1)})`;
						return bandVerdict(ratio, [1.40, 1.62], [1.28, 1.80], detail, v => v <= 1.0);
					});
				},
			},
		],
	},
	{
		id: "social-h3-algorithm-change",
		hook: "H3",
		archetype: "temporal-inflection",
		narrative: "Day-45 feed→explore flip: pre-d30 feed 78% of views; post-d45 explore 54%, feed collapses to 5%.",
		assertions: [
			{
				breakdown: { type: "duckdb", sql: SOURCE_WINDOWS_SQL },
				assert: (rows) => {
					const by = cellsOf(rows, "win");
					const pre = by.pre_d30, post = by.post_d45;
					return guarded(Number(pre?.n) >= 90000 && Number(post?.n) >= 230000, `views: pre_d30=${pre?.n ?? 0} post_d45=${post?.n ?? 0}`, () => {
						const preFeed = Number(pre.feed), postExplore = Number(post.explore), postFeed = Number(post.feed);
						const detail = `pre-d30 feed=${preFeed.toFixed(3)} (measured 0.779); post-d45 explore=${postExplore.toFixed(3)} (0.539), feed=${postFeed.toFixed(3)} (0.055)`;
						const legs = [
							bandVerdict(preFeed, [0.74, 0.82], [0.70, 0.86], detail, v => v <= 0.30),
							bandVerdict(postExplore, [0.50, 0.58], [0.45, 0.63], detail, v => v <= 0.15),
							bandVerdict(postFeed, [0.03, 0.08], [0.02, 0.12], detail, v => v >= 0.30),
						];
						return { verdict: worstOf(...legs), detail };
					});
				},
			},
		],
	},
	{
		id: "social-h4-engagement-bait",
		hook: "H4",
		archetype: "composition-drift",
		narrative: "20% of post-viewed events get view_duration_sec crushed to 1-5s — a bimodal low mode that is 100% hook-made.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT COUNT(*) AS n, AVG((view_duration_sec <= 5)::INT) AS crushed_share
FROM ${EV} WHERE event = 'post viewed' AND view_duration_sec IS NOT NULL`,
				},
				assert: (rows) => {
					const r = rows?.[0] || {};
					return guarded(Number(r.n) >= 375000, `views=${r.n ?? 0}`, () => {
						const share = Number(r.crushed_share);
						const detail = `share of views <= 5 sec=${share.toFixed(4)} (measured 0.204; organic 0.000, generator floors durations above 5s)`;
						return bandVerdict(share, [0.18, 0.23], [0.15, 0.26], detail, v => v <= 0.05);
					});
				},
			},
		],
	},
	{
		id: "social-h5-notification-reengagement",
		hook: "H5",
		archetype: "temporal-inflection",
		narrative: "After day 30, ~32% of post-viewed events carry source=notification, up from ~3% before (~10x).",
		assertions: [
			{
				breakdown: { type: "duckdb", sql: SOURCE_WINDOWS_SQL },
				assert: (rows) => {
					const by = cellsOf(rows, "win");
					const pre = by.pre_d30, mid = by.d30_45, post = by.post_d45;
					const postN = Number(mid?.n ?? 0) + Number(post?.n ?? 0);
					return guarded(Number(pre?.n) >= 90000 && postN >= 280000, `views: pre_d30=${pre?.n ?? 0} post_d30=${postN}`, () => {
						const preNotif = Number(pre.notif);
						const postNotif = (Number(mid.notif) * Number(mid.n) + Number(post.notif) * Number(post.n)) / postN;
						const detail = `notification share pre-d30=${preNotif.toFixed(4)} (measured 0.033) → post-d30=${postNotif.toFixed(4)} (measured 0.322)`;
						const legs = [
							bandVerdict(preNotif, [0.02, 0.05], [0.01, 0.07], detail, v => v >= 0.15),
							bandVerdict(postNotif, [0.29, 0.35], [0.26, 0.38], detail, v => v <= 0.08),
						];
						return { verdict: worstOf(...legs), detail };
					});
				},
			},
		],
	},
	{
		id: "social-h6-creator-monetization",
		hook: "H6",
		archetype: "cohort-count-scale",
		narrative: "Subscribers (~78% of users) post 3.3x and story 3.8x more per user than non-subscribers.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH pu AS (
  SELECT user_id::VARCHAR AS uid,
    BOOL_OR(event = 'creator subscription started') AS sub,
    COUNT(*) FILTER (WHERE event = 'post created') AS pc,
    COUNT(*) FILTER (WHERE event = 'story created') AS sc
  FROM ${EV} WHERE user_id IS NOT NULL GROUP BY 1
)
SELECT sub, COUNT(*) AS users, AVG(pc) AS posts, AVG(sc) AS stories
FROM pu GROUP BY 1 ORDER BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "sub");
					const s = by.true, n = by.false;
					return guarded(Number(s?.users) >= 3800 && Number(n?.users) >= 1100, `cohorts: sub=${s?.users ?? 0} non=${n?.users ?? 0}`, () => {
						const postRatio = Number(s.posts) / Number(n.posts);
						const storyRatio = Number(s.stories) / Number(n.stories);
						const detail = `sub vs non posts/user=${postRatio.toFixed(3)} (measured 3.32); stories/user=${storyRatio.toFixed(3)} (measured 3.82)`;
						const legs = [
							bandVerdict(postRatio, [3.00, 3.65], [2.70, 4.00], detail, v => v <= 1.5),
							bandVerdict(storyRatio, [3.45, 4.20], [3.10, 4.60], detail, v => v <= 1.5),
						];
						return { verdict: worstOf(...legs), detail };
					});
				},
			},
		],
	},
	{
		id: "social-h7-toxicity-churn",
		hook: "H7",
		archetype: "retention-divergence",
		narrative: "Users with 2+ reports lose 60% of post-day-30 activity: post/pre ratio 1.27 vs 3.21 for the rest (0.40x contrast).",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH pu AS (
  SELECT user_id::VARCHAR AS uid,
    COUNT(*) FILTER (WHERE event = 'report submitted') AS rep,
    COUNT(*) FILTER (WHERE time::TIMESTAMP <= ${DAY30}) AS pre,
    COUNT(*) FILTER (WHERE time::TIMESTAMP > ${DAY30}) AS post
  FROM ${EV} WHERE user_id IS NOT NULL GROUP BY 1
)
SELECT (rep >= 2) AS reporter, COUNT(*) AS users, AVG(post::DOUBLE / pre) AS ratio
FROM pu WHERE pre > 0 GROUP BY 1 ORDER BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "reporter");
					const rep = by.true, norm = by.false;
					return guarded(Number(rep?.users) >= 310 && Number(norm?.users) >= 4000, `cohorts: reporters=${rep?.users ?? 0} normal=${norm?.users ?? 0}`, () => {
						const contrast = Number(rep.ratio) / Number(norm.ratio);
						const detail = `post/pre-d30 ratio reporters=${Number(rep.ratio).toFixed(2)} vs normal=${Number(norm.ratio).toFixed(2)} → contrast=${contrast.toFixed(3)} (measured 0.395; 60% drop knob)`;
						return bandVerdict(contrast, [0.34, 0.46], [0.28, 0.55], detail, v => v >= 0.85);
					});
				},
			},
		],
	},
	{
		id: "social-h8-weekend-surge",
		hook: "H8",
		archetype: "bespoke",
		narrative: "Sat/Sun creations run ~1.25x weekday daily rate on a flat organic DOW baseline (0.98 counterfactual).",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH d AS (
  SELECT time::DATE AS dt, COUNT(*) AS n FROM ${EV}
  WHERE event IN ('post created', 'story created') GROUP BY 1
)
SELECT
  AVG(n) FILTER (WHERE EXTRACT(DOW FROM dt) IN (0, 6)) AS wkn,
  AVG(n) FILTER (WHERE EXTRACT(DOW FROM dt) NOT IN (0, 6)) AS wkd
FROM d`,
				},
				assert: (rows) => {
					const r = rows?.[0] || {};
					return guarded(Number(r.wkd) >= 2300, `weekday creations/day=${r.wkd ? Number(r.wkd).toFixed(0) : 0}`, () => {
						const ratio = Number(r.wkn) / Number(r.wkd);
						const detail = `weekend/weekday daily creations=${ratio.toFixed(3)} (measured 1.254; organic counterfactual 0.980 — flat DOW)`;
						return bandVerdict(ratio, [1.19, 1.32], [1.10, 1.42], detail, v => v <= 1.02);
					});
				},
			},
		],
	},
	{
		id: "social-h9-magic-number",
		hook: "H9",
		archetype: "frequency-sweet-spot",
		narrative: "Sweet-spot posters (3-7 final posts) average 1.7x the comment_length of 8+ posters; ordering sweet > low > over.",
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH pu AS (
  SELECT user_id::VARCHAR AS uid, COUNT(*) FILTER (WHERE event = 'post created') AS pc
  FROM ${EV} WHERE user_id IS NOT NULL GROUP BY 1
)
SELECT CASE WHEN pu.pc >= 8 THEN 'over' WHEN pu.pc >= 3 THEN 'sweet' ELSE 'low' END AS bucket,
  COUNT(DISTINCT pu.uid) AS users, COUNT(*) AS n_comments, AVG(e.comment_length) AS len
FROM ${EV} e JOIN pu ON e.user_id::VARCHAR = pu.uid
WHERE e.event = 'comment posted' AND e.comment_length IS NOT NULL
GROUP BY 1 ORDER BY 1`,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "bucket");
					const sweet = by.sweet, low = by.low, over = by.over;
					return guarded(
						Number(sweet?.users) >= 400 && Number(low?.users) >= 80 && Number(over?.n_comments) >= 44000,
						`buckets: sweet=${sweet?.users ?? 0}u low=${low?.users ?? 0}u over=${over?.n_comments ?? 0}c`,
						() => {
							const sweetOver = Number(sweet.len) / Number(over.len);
							const sl = Number(sweet.len), ll = Number(low.len), ol = Number(over.len);
							const detail = `comment_length sweet/over=${sweetOver.toFixed(3)} (measured 1.720); ordering sweet=${sl.toFixed(0)} low=${ll.toFixed(0)} over=${ol.toFixed(0)} (measured 250/200/145)`;
							const legRatio = bandVerdict(sweetOver, [1.55, 1.90], [1.40, 2.10], detail, v => v <= 1.05);
							let legOrder;
							if (sl < ol) legOrder = { verdict: "INVERSE", detail };
							else if (sl >= 1.15 * ll && ll >= 1.15 * ol) legOrder = { verdict: "NAILED", detail };
							else if (sl > ll && ll > ol) legOrder = { verdict: "STRONG", detail };
							else legOrder = { verdict: "WEAK", detail };
							return { verdict: worstOf(legRatio, legOrder), detail };
						}
					);
				},
			},
		],
	},
	{
		id: "social-h10-onboarding-ttc",
		hook: "H10",
		archetype: "funnel-ttc-by-segment",
		narrative: "Creator/business complete onboarding at 0.71x personal's median TTC (funnel-post gap scaling; window-stable 1h-24h).",
		assertions: [
			{
				breakdown: {
					type: "timeToConvert",
					steps: ["account created", "profile updated", "post created"],
					breakdownByUserProperty: "account_type",
					conversionWindowMs: 6 * 3600 * 1000,
				},
				assert: (rows) => {
					const by = cellsOf(rows, "segment_value");
					const p = by.personal, c = by.creator, b = by.business;
					const counts = `personal=${p?.user_count ?? 0} creator=${c?.user_count ?? 0} business=${b?.user_count ?? 0}`;
					return guarded(
						Number(p?.user_count) >= 160 && Number(c?.user_count) >= 125 && Number(b?.user_count) >= 115,
						`converters: ${counts}`,
						() => {
							const fast = (Number(c.median_ttc_ms) + Number(b.median_ttc_ms)) / 2;
							const ratio = fast / Number(p.median_ttc_ms);
							const detail = `funnel median TTC @6h fast(creator/business)/personal=${ratio.toFixed(3)} (measured 0.709; medians ${(fast / 60000).toFixed(1)}min vs ${(Number(p.median_ttc_ms) / 60000).toFixed(1)}min; knobs 0.71/1.25 attenuate to 0.81/1.11 per leg)`;
							return bandVerdict(ratio, [0.66, 0.76], [0.60, 0.83], detail, v => v >= 0.95);
						}
					);
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT COUNT(*) AS n,
  AVG((user_id IS NOT NULL)::INT) AS uid_share,
  AVG((device_id IS NOT NULL)::INT) AS device_share,
  COUNT(DISTINCT device_id)::DOUBLE / COUNT(DISTINCT user_id) AS devices_per_user
FROM ${EV}`,
				},
				assert: (rows) => {
					const r = rows?.[0] || {};
					return guarded(Number(r.n) >= 1300000, `events=${r.n ?? 0}`, () => {
						const uid = Number(r.uid_share), dev = Number(r.device_share), dpu = Number(r.devices_per_user);
						const detail = `identity invariants: uid_share=${uid} device_share=${dev.toFixed(4)} devices/user=${dpu.toFixed(2)} over ${r.n} events (auth on first event; avgDevicePerUser: 2)`;
						if (uid === 1 && dev >= 0.99 && dpu >= 1.6 && dpu <= 2.4) return { verdict: "NAILED", detail };
						if (uid >= 0.999 && dev >= 0.98) return { verdict: "STRONG", detail };
						if (uid < 0.9) return { verdict: "INVERSE", detail };
						return { verdict: "WEAK", detail };
					});
				},
			},
		],
	},
];
