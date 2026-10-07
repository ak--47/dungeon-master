// ── IMPORTS ──
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);
import "dotenv/config";
import * as u from "@ak--47/dungeon-master/utils";
import { hashFloat, cloneEvent } from "@ak--47/dungeon-master/hook-helpers";
/** @typedef  {import("../../../types").Dungeon} Config */

// ── OVERVIEW ──
/*
 * NAME:       Murmur
 * APP:        Mobile social app (iOS, Android): a feed of posts from people you
 *             follow (Following) and a ranked For You feed, Stories, DMs,
 *             communities, and creator Circles (paid fan subscriptions:
 *             Supporter / Insider / VIP; Murmur keeps a platform fee, 20% → 10%
 *             from 2026-08-12). Clips (short vertical video) launches
 *             2026-07-08. Revenue: ads in the feed, Stories, and Clips plus the
 *             Circles fee. Paid acquisition on Meta, TikTok, and creator
 *             partnerships.
 * SCALE:      10,000 members (≈4,970 sign up inside the window), ~1.12M events,
 *             120 days (2026-06-04 → 2026-10-01, UTC)
 * CORE LOOP:  app opened → post viewed → post liked / comment posted; post
 *             created; story viewed → dm sent
 * VALUE MOMENT: post viewed in a session that ends in a like or comment
 *
 * EVENTS (24):
 *   post viewed > app opened > story viewed > post liked > push notification
 *   sent > dm sent > ad viewed > post created > user followed > comment posted
 *   > circle paywall viewed > post shared > search performed > story posted >
 *   $experiment_started > push notification opened > account created >
 *   interests selected > community joined > user unfollowed > content reported
 *   > profile updated > circle subscription started > ad clicked
 *
 * FUNNELS (12 declared):
 *   - Onboarding (first funnel, two copies by acquisition_channel): account
 *       created → interests selected → user followed (suggested accounts
 *       screen) — 90%; TikTok signups 72%
 *   - Feed session (weight 14): app opened → post viewed ×11 with likes, an ad
 *       slot, a comment (65%)
 *   - Stories session (6): app opened → story viewed ×7, an ad slot → dm sent (60%)
 *   - Chat session (5): app opened → dm sent ×5 (60%)
 *   - Create (creator 70 / business 30 / personal 6, by account_type
 *       conditions): app opened → post created → post viewed ×2
 *   - Discover (4): search performed → post viewed → user followed (40%)
 *   - Push (30): push notification sent → push notification opened (engine
 *       100%; the hook decides opens) — carries the Smart Digest experiment
 *   - Circle join (locked post 4 / profile button 6): circle paywall viewed →
 *       circle subscription started (9% / 3%), paywall_trigger via funnel props
 *
 * USER PROPS:  account_type (personal / creator / business, from persona),
 *              circle_enabled (creators who run a paid Circle), acquisition_channel,
 *              joined_date, age_band, country, follower_count, following_count,
 *              "Experiment: Smart Digest" (members who got a push after the start)
 * SUPER PROPS: platform (ios / android, from the event's device OS)
 * SCD PROPS:   none
 * GROUPS:      community_id (240 communities; each member belongs to 1-3, power-law
 *              popularity; about 35% of posts and 25% of comments are in a community)
 * WAREHOUSE:   marketing_spend_daily (spend by paid channel),
 *              for_you_feed_health_daily (For You feed API health by platform),
 *              ad_revenue_daily (impressions served, eCPM, revenue by placement)
 * LOOKUPS:     none — every attribute is denormalized onto events/profiles
 * SOUP:        weekend-leaning dayOfWeekWeights; US-evening-heavy hourOfDayWeights (UTC)
 *
 * IDENTITY: a new member is identified at "account created" (isAuthEvent, first
 * event, user_id + device_id). One device per member (an iPhone, an iPad, or an
 * Android phone; avgDevicePerUser 1). Every event carries user_id; there is no anonymous
 * pre-signup activity. The two onboarding steps after signup (interests selected,
 * the suggested-accounts follows) carry user_id only; every other event also
 * carries device_id. platform agrees with the engine's os field (iOS and iPadOS →
 * ios, Android → android).
 *
 * DESIGN NOTES:
 * - Event-level coherence: a like carries the post type of the post just viewed;
 *   an ad slot after a Clip is placement "clips", after a story "stories",
 *   otherwise "feed"; a post viewed right after a search is feed = search; ad
 *   clicks are cloned from impressions (1.1% CTR, same placement and category).
 * - Pushes are server-side: when a new member leaves (H2) their pushes and
 *   experiment assignment keep arriving; member-initiated events stop. Members
 *   differ in push-open habit (x0.25-1.75 of the average), and Circle creators in
 *   how much the fee cut moves them (x0.5-1.5 of the average lift).
 * - Communities are pinned per member (1-3 home communities); the engine's random
 *   group stamp is replaced.
 * - Warehouse drift: ad_revenue_daily impressions include members who opted out
 *   of analytics (0-14% a day) and an invalid-traffic / late-log factor (±12%);
 *   for_you_feed_health_daily requests are page loads (about 0.19 per view, with
 *   prefetch noise and opted-out members) and include failed requests; paid spend
 *   is half a paced weekday budget (never zero) and half bid x delivered signups.
 * - retentionCurve shapes new members' activity; established members are flat
 *   across the window. With ≈4,970 signups the active base grows through the
 *   window (weekly active members ≈3,700 in early June → ≈5,275 in late September).
 * - Personas: heavy scroller 22, regular 40, lurker 21 (personal accounts),
 *   creator 14, business 3; half of creators run a paid Circle.
 */

// ── HOOK STORIES ──
/*
 * All effects are hidden: no flag properties. Dates live in the TIMELINE
 * constants and are shared by hooks, stories, SQL, warehouse columns, and the
 * timeline guide.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H1. CLIPS LAUNCH (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: Clips launches 2026-07-08 and ramps in linearly over 21 days until
 *   35% of post views and 20% of new posts are post_type = clip (from Jul 29).
 *   No clip exists before launch. Total views are unchanged; the mix shifts.
 * MIXPANEL: Insights, post viewed, breakdown post_type, weekly, % of total.
 * REAL WORLD: a new short-video format takes a third of feed attention fast.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H2. ONBOARDING FOLLOWS PREDICT RETENTION (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: the number of accounts a new member follows on the onboarding
 *   suggestions screen (user followed, discovery_source = onboarding_suggestions)
 *   sets the chance they leave 3.5-8 days after signup: 0 → 0.70, 1 → 0.66,
 *   2 → 0.60, 3 → 0.50, 4 → 0.38, 5 → 0.26, 6 → 0.17, 7+ → 0.10.
 * MIXPANEL: Retention, birth account created, return any event except push
 *   notification sent, custom bracket day 14-27, cohorts by onboarding follows
 *   0-2 / 3-6 / 7+.
 * REAL WORLD: a new member with an empty feed has nothing to come back to.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H3. SMART DIGEST EXPERIMENT (Push funnel experiment + everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-08-05 members who get pushes split 50/50. Digest sends
 *   0.6x the pushes (about half as daily_digest) and each push is opened 1.6x as
 *   often (Control about 8% before members leave).
 * MIXPANEL: Insights, push notification opened / push notification sent and
 *   sends per member, breakdown "Experiment: Smart Digest", Aug 5 - Oct 1.
 * REAL WORLD: fewer, better notifications get opened more.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H4. ANDROID FOR YOU FEED INCIDENT (everything + warehouse
 *     for_you_feed_health_daily; external-join)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-08-26 to 2026-08-29, 60% of Android For You feed loads fail; a
 *   failed load is never viewed (its like and ad slot go too). Following feed and
 *   iOS untouched. The warehouse shows service_status = major_outage and
 *   error_rate ≈ 0.6 for android on those days.
 * MIXPANEL: Insights, post viewed, filter feed in (for_you, following),
 *   breakdown platform and feed, daily; For You per Following view on Android,
 *   outage days vs 14 days either side.
 * REAL WORLD: a bad release of the ranked feed looks like "Android users
 *   stopped scrolling".
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H5. PAID CHANNEL ECONOMICS (first funnels + H2 + warehouse
 *     marketing_spend_daily; external-join)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: spend per Mixpanel signup $5.00 creator partnerships, $3.80 Meta,
 *   $2.40 TikTok. Creator-referred and friend-invited members follow more
 *   suggested accounts (warm follow distribution), so through H2 they retain
 *   better; TikTok signups finish onboarding 72% vs 90%. Creator partnerships
 *   cost 1.32x Meta per signup but about the same per retained member (1.05x);
 *   TikTok stays cheapest per retained member.
 * MIXPANEL: Insights, account created by acquisition_channel joined to
 *   marketing_spend_daily.spend_usd; Retention by acquisition_channel.
 * REAL WORLD: the pricier channel brings members who already have a reason
 *   to stay, which closes most of its cost gap.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H6. CREATOR FAIR SHARE (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-08-12 the Circles fee falls from 20% to 10%. Creators who run a
 *   Circle post 1.35x as often after a 10-day ramp (each creator x0.5-1.5 of the
 *   average lift); creators without a Circle are the control.
 * MIXPANEL: Insights, post created, filter account_type = creator and joined
 *   before Jun 4, breakdown circle_enabled, weekly; before vs from Aug 22.
 * REAL WORLD: a bigger revenue share makes paid creators invest more.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H7. MURMUR SOUND AWARDS (worldEvents)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: Saturday 2026-09-12, posts, comments, shares, and stories run at
 *   2.5x for the UTC day (volumeMultiplier); feed views are not affected.
 * MIXPANEL: Insights, (post created + comment posted + post shared + story
 *   posted) per daily active member, daily; Sep 12 vs the Saturdays around it.
 * REAL WORLD: a live tentpole event fills the app with reactions.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H8. AD LOAD INCREASE (everything + warehouse ad_revenue_daily; external-join)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-09-09 feed and Clips ad impressions per post view rise 1.6x
 *   (Stories unchanged); eCPM drops to 0.85x for every placement, so ad revenue
 *   per 1,000 post views (feed + Clips) is 1.6 x 0.85 = 1.36x.
 * MIXPANEL: Insights, ad viewed (feed, clips) / post viewed, weekly; join
 *   ad_revenue_daily.ad_revenue_usd per 1,000 post views.
 * REAL WORLD: more ad slots earn less per slot.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H9. CREATORS POST FIRST, FAST (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: a new member's first post comes a log-normal time after signup
 *   (median 20 h for personal accounts, sigma 0.6, capped at 72 h) scaled by
 *   account type: creator 0.35x, business 0.6x.
 * MIXPANEL: Funnels, account created → post created, 7-day window, median time
 *   to convert, breakdown account_type, signups Jun 4 - Sep 24.
 * REAL WORLD: creators arrive with something to say.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H10. CIRCLE PAYWALL BY TRIGGER (two declared funnels)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: a Circle paywall opened from a locked post converts 9% vs 3% from
 *   the profile Join button (3x); the subscription carries paywall_trigger.
 * MIXPANEL: Insights, circle subscription started / circle paywall viewed,
 *   breakdown paywall_trigger.
 * REAL WORLD: fans pay when they hit content they want, not on a profile page.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * EXPECTED METRICS SUMMARY (measured: data/verify-social, 2026-10-07, full fidelity,
 * 10,000 members, 1,117,887 events)
 * ═════════════════════════════════════════════════════════════════════════
 * Hook | Metric                                         | Derivation                 | Expected | Measured
 * -----|------------------------------------------------|----------------------------|----------|---------
 * H1   | clip share of post views, from Jul 29          | CLIP_VIEW_SHARE            | 0.35     | 0.349
 * H1   | clip share of new posts, from Jul 29           | CLIP_POST_SHARE            | 0.20     | 0.197
 * H1   | clips before launch                            | exact purity               | 0        | 0
 * H2   | D14-27 retention, 0-2 / 7+ onboarding follows  | CHURN_BY_K x follow mix    | 0.367    | 0.377 (28.5% vs 75.6%)
 * H2   | D14-27 retention, 3-6 / 7+ onboarding follows  | CHURN_BY_K x follow mix    | 0.744    | 0.777 (58.7% vs 75.6%)
 * H3   | push open rate, Digest / Control               | DIGEST_OPEN_MULT           | 1.60     | 1.605 (11.6% vs 7.2%)
 * H3   | pushes sent per exposed member, Digest / Control | DIGEST_SEND_KEEP         | 0.60     | 0.590 (3.40 vs 5.76)
 * H3   | Digest share of exposed members                | equal 2-arm hash           | 0.50     | 0.495
 * H3   | daily_digest pushes in Control or pre-test     | exact purity               | 0        | 0
 * H4   | Android For You per Following view, outage / ±14 d | 1 − FEED_FAIL          | 0.40     | 0.400 (0.74 vs 1.85)
 * H4   | iOS For You per Following view, outage / ±14 d | control                    | 1.00     | 1.033 (1.94 vs 1.88)
 * H4   | warehouse error_rate, android outage days      | FEED_FAIL                  | 0.60     | 0.603
 * H5   | spend per signup, creator partnerships / Meta  | 5.00 / 3.80                | 1.316    | 1.328 ($5.06 vs $3.81)
 * H5   | D14-27 retention, creator partnerships / Meta  | 1 − churn by follow mix    | 1.249    | 1.297 (61.8% vs 47.7%)
 * H5   | spend per retained member, creator / Meta      | 1.316 / 1.249              | 1.053    | 1.024 ($8.18 vs $7.99)
 * H6   | posts per creator-day after/before, Circle / no Circle | CIRCLE_POST_LIFT   | 1.35     | 1.306 (1.385 vs 1.061)
 * H7   | award-type events per DAU, Sep 12 / Saturdays  | AWARDS_MULT                | 2.50     | 2.333
 * H7   | post views per DAU, Sep 12 / Saturdays         | control                    | 1.00     | 0.992
 * H8   | feed + Clips ads per post view, after / before | AD_LOAD_MULT               | 1.60     | 1.606 (0.076 → 0.122)
 * H8   | ad revenue per 1k post views, after / before   | 1.6 x ECPM_AFTER_MULT      | 1.36     | 1.358 ($0.434 → $0.589)
 * H9   | median hours to first post, creator / personal | FIRST_POST_FACTOR.creator  | 0.35     | 0.349 (7.0 vs 20.0 h)
 * H10  | Circle conversion, locked post / profile button | 9 / 3                     | 3.00     | 2.921 (8.79% vs 3.01%)
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Noise notes: H5 rests on about 840 creator-partnership and 1,030 Meta
 * signups with a full day 14-27 window (retention ratio relative SE about 5%).
 * H6 rests on about 360 Circle and 360 other established creators. H10 rests on
 * about 490 profile-button subscriptions. Per-active-day engagement is lower for
 * members who joined in the window (about 2.5-2.7 post views per active day vs
 * about 3.5 for established members), so all-member per-DAU metrics drift down
 * as the new-member share grows; no hook targets that.
 */

// ── SCALE ──
const SEED = "harness-social";
const NUM_USERS = 10_000;
const DATASET_START = "2026-06-04T00:00:00Z";
const DATASET_END = "2026-10-01T23:59:59Z"; // 120 days
const EVENTS_PER_DAY = 1.2;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── TIMELINE (shared by hooks, stories, SQL, warehouse columns, guides) ──
const CLIPS_LAUNCH = "2026-07-08T00:00:00Z";        // Clips (short vertical video) launches in the app
const DIGEST_START = "2026-08-05T00:00:00Z";        // "Smart Digest" push experiment starts
const FEE_CUT = "2026-08-12T00:00:00Z";             // Creator Fair Share: Circles platform fee 20% → 10%
const FEED_INCIDENT_START = "2026-08-26T00:00:00Z"; // Android For You feed incident starts
const FEED_INCIDENT_END = "2026-08-30T00:00:00Z";   // exclusive (4 days: Aug 26-29)
const AD_LOAD_CHANGE = "2026-09-09T00:00:00Z";      // feed and Clips ad load raised
const AWARDS_DAY = "2026-09-12T00:00:00Z";          // Murmur Sound Awards livestream (Saturday)

const ms = (iso) => dayjs.utc(iso).valueOf();
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;
const WINDOW_DAYS = 120;

// ── WEEKLY AND DAILY RHYTHM (soup) ──
// Sun..Sat. Consumer social: weekends a little busier than weekdays.
const DOW_WEIGHTS = [1.0, 0.86, 0.84, 0.85, 0.87, 0.92, 0.98];
// UTC hours. Most members are in US time zones: the evening peak (19-23 local)
// lands at 23-06 UTC; UK and EU evenings add 18-22 UTC; lunch scrolling 16-18 UTC.
const HOUR_WEIGHTS = [1.0, 1.0, 0.96, 0.88, 0.74, 0.56, 0.4, 0.28, 0.22, 0.2, 0.24, 0.3,
	0.36, 0.42, 0.46, 0.5, 0.56, 0.6, 0.64, 0.68, 0.74, 0.8, 0.88, 0.95];

// ── KNOBS ──
// H1 Clips launch: share of feed views and new posts that are Clips, ramping in over 3 weeks
const CLIPS_RAMP_DAYS = 21;
const CLIP_VIEW_SHARE = 0.35;
const CLIP_POST_SHARE = 0.2;

// H2 onboarding follows: chance a new member leaves 3.5-8 days after signup,
// by the number of accounts followed on the "suggested accounts" onboarding screen
const CHURN_BY_K = [0.7, 0.66, 0.6, 0.5, 0.38, 0.26, 0.17, 0.1]; // index = follows (7 = 7+)
const CHURN_DAY_MIN = 3.5;
const CHURN_DAY_MAX = 8;
// accounts followed from the suggestions screen: cold channels vs warm (invited / creator-referred)
const COLD_K = { 0: 12, 1: 10, 2: 12, 3: 13, 4: 12, 5: 11, 6: 9, 7: 7, 8: 5, 9: 3, 10: 3, 12: 2, 15: 1 };
const WARM_K = { 0: 3, 1: 3, 2: 5, 3: 7, 4: 9, 5: 11, 6: 12, 7: 12, 8: 11, 9: 9, 10: 8, 12: 6, 15: 4 };
const WARM_CHANNELS = ["friend_invite", "creator_partnerships"];
const SERVER_EVENTS = new Set(["push notification sent", "$experiment_started"]);

// H3 Smart Digest experiment (pushes batched into a daily digest)
const DIGEST_EXPERIMENT = "Smart Digest";
const DIGEST_VARIANT = "Digest";
const EXP_KEY = `Experiment: ${DIGEST_EXPERIMENT}`;
const PUSH_OPEN_RATE = 0.08;     // share of pushes opened (Control and before the test)
const DIGEST_OPEN_MULT = 1.6;    // Digest arm open rate multiplier
const DIGEST_SEND_KEEP = 0.6;    // Digest arm sends this share of the pushes Control would get
const DIGEST_LABEL_SHARE = 0.5;  // Digest-arm pushes sent as the daily digest notification

// H4 Android For You feed incident (warehouse for_you_feed_health_daily)
const FEED_FAIL = 0.6;           // share of Android For You feed loads that fail during the incident

// H5 paid acquisition (warehouse marketing_spend_daily)
const PAID_CHANNELS = ["meta_ads", "tiktok_ads", "creator_partnerships"];
const CPI_USD = { meta_ads: 3.8, tiktok_ads: 2.4, creator_partnerships: 5.0 }; // window spend per Mixpanel signup
const CHANNEL_WEIGHTS = { organic: 20, friend_invite: 12, meta_ads: 26, tiktok_ads: 20, creator_partnerships: 22 };
const ONBOARD_CONV = 90;         // onboarding (interests → suggested accounts) completion
const TIKTOK_ONBOARD_CONV = 72;
const BORN_PCT = 50;
const SPEND_PLAN_SHARE = 0.5;    // half of each day's spend is the paced plan, half bid x delivered signups
const SPEND_NOISE = 0.12;
const SPEND_FLAT_SHARE = 0.4;
const PLATFORM_INSTALL_INFLATION = 1.15;
const CPC_USD = { meta_ads: 0.55, tiktok_ads: 0.32, creator_partnerships: 0.9 };
const CTR = { meta_ads: 0.012, tiktok_ads: 0.009, creator_partnerships: 0.02 };

// H6 Creator Fair Share: Circles creators post more after the fee cut
const FEE_BEFORE = 0.2;
const FEE_AFTER = 0.1;
const FEE_RAMP_DAYS = 10;
const CIRCLE_POST_LIFT = 1.35;
const CIRCLE_ENABLED_SHARE = 0.5; // share of creators who run a paid Circle

// H7 Murmur Sound Awards livestream (worldEvents volume multiplier)
const AWARDS_MULT = 2.5;
const AWARDS_EVENTS = ["post created", "comment posted", "post shared", "story posted"];

// H8 ad load increase (warehouse ad_revenue_daily)
const AD_LOAD_MULT = 1.6;        // ad impressions per feed view after the change
const ECPM_AFTER_MULT = 0.85;    // eCPM after the change (more supply)
const ECPM_USD = { feed: 6.2, stories: 4.8, clips: 3.9 };
const AD_CTR = 0.011;
const UNTRACKED_IMPRESSION_SHARE = 0.07; // ad server counts impressions from members who opted out of analytics

// H9 time to first post by account type
const FIRST_POST_MEDIAN_H = 20;
const FIRST_POST_SIGMA = 0.6;
const FIRST_POST_MAX_H = 72;
const FIRST_POST_FACTOR = { personal: 1, creator: 0.35, business: 0.6 };

// H10 Circle paywall conversion by trigger (two declared funnels)
const LOCKED_POST_CONV = 9;
const PROFILE_BUTTON_CONV = 3;

// For You feed API (warehouse)
const FEED_REQUESTS_PER_VIEW = 0.19; // one feed page holds ~5 posts; prefetches add requests
const UNTRACKED_VIEW_SHARE = 0.06;

// ── DATA ──
const weighted = (obj) => Object.entries(obj).flatMap(([k, w]) => Array(w).fill(isNaN(Number(k)) ? k : Number(k)));
const COMMUNITY_COUNT = 240;
// group profile ids are "1".."240" (engine group keys)
const COMMUNITY_IDS = Array.from({ length: COMMUNITY_COUNT }, (_, i) => String(i + 1));
const COMMUNITY_TOPICS = ["music", "gaming", "sports", "food", "fashion", "tech", "film_tv", "fitness", "travel", "comedy", "books", "art"];

// ── HELPERS ──
const salt = (uid, tag) => hashFloat(`${uid}|${tag}`);
const round2 = (n) => Math.round(n * 100) / 100;
const T = (e) => dayjs.utc(e.time).valueOf();
const iso = (t) => new Date(t).toISOString();
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const byT = (a, b) => T(a) - T(b);
const logNormal = (sigma) => Math.exp(chance.normal({ mean: 0, dev: sigma }));
const jitter = (key, spread) => 1 + (hashFloat(key) - 0.5) * 2 * spread;
const pickWeighted = (obj, r) => {
	const entries = Object.entries(obj);
	const total = entries.reduce((s, [, w]) => s + w, 0);
	let acc = 0;
	for (const [k, w] of entries) {
		acc += w / total;
		if (r < acc) return k;
	}
	return entries[entries.length - 1][0];
};
const platformOf = (os) => (os === "Android" ? "android" : "ios");
const inFeedIncident = (t) => t >= ms(FEED_INCIDENT_START) && t < ms(FEED_INCIDENT_END);
const clipRamp = (t) => (t < ms(CLIPS_LAUNCH) ? 0 : Math.min(1, (t - ms(CLIPS_LAUNCH)) / (CLIPS_RAMP_DAYS * DAY_MS)));
const feeRamp = (t) => (t < ms(FEE_CUT) ? 0 : Math.min(1, (t - ms(FEE_CUT)) / (FEE_RAMP_DAYS * DAY_MS)));
const churnFor = (k) => CHURN_BY_K[Math.min(k, CHURN_BY_K.length - 1)];
const feeRate = (t) => (t >= ms(FEE_CUT) ? FEE_AFTER : FEE_BEFORE);
const ecpm = (placement, t, key) => round2((ECPM_USD[placement] ?? 5) * (t >= ms(AD_LOAD_CHANGE) ? ECPM_AFTER_MULT : 1) * jitter(`ecpm|${key}`, 0.06));

// spend plan: paced daily budget (weekday shape above a flat floor) + bid x delivered signups
const TOTAL_CHANNEL_W = Object.values(CHANNEL_WEIGHTS).reduce((a, b) => a + b, 0);
const DAILY_BUDGET_USD = Object.fromEntries(PAID_CHANNELS.map((ch) => [ch, CPI_USD[ch] * (NUM_USERS * BORN_PCT / 100) * (CHANNEL_WEIGHTS[ch] / TOTAL_CHANNEL_W) / WINDOW_DAYS]));
const SPEND_WEEKDAY = (() => {
	const m = DOW_WEIGHTS.reduce((a, b) => a + b, 0) / DOW_WEIGHTS.length;
	return DOW_WEIGHTS.map((w) => SPEND_FLAT_SHARE + (1 - SPEND_FLAT_SHARE) * w / m);
})();
const paidSpend = (date, ch, signups) => round2((SPEND_PLAN_SHARE * DAILY_BUDGET_USD[ch] * SPEND_WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()]
	+ (1 - SPEND_PLAN_SHARE) * CPI_USD[ch] * signups) * jitter(`spend|${date}|${ch}`, SPEND_NOISE));

// expected churn (H2/H5) from the knobs: completion share, follow distribution, churn table
const kStats = (dist) => {
	const tot = Object.values(dist).reduce((a, b) => a + b, 0);
	return Object.entries(dist).map(([k, w]) => ({ k: Number(k), p: w / tot }));
};
const channelMix = Object.entries(CHANNEL_WEIGHTS).map(([ch, w]) => ({
	ch, w: w / TOTAL_CHANNEL_W,
	comp: (ch === "tiktok_ads" ? TIKTOK_ONBOARD_CONV : ONBOARD_CONV) / 100,
	dist: kStats(WARM_CHANNELS.includes(ch) ? WARM_K : COLD_K),
}));
/** expected churn among members of `channels` whose onboarding follows fall in [lo, hi] */
const expectedChurn = (lo, hi, channels = null) => {
	let mass = 0, churn = 0;
	for (const c of channelMix) {
		if (channels && !channels.includes(c.ch)) continue;
		if (lo === 0) { mass += c.w * (1 - c.comp); churn += c.w * (1 - c.comp) * churnFor(0); }
		for (const { k, p } of c.dist) {
			if (k < lo || k > hi) continue;
			mass += c.w * c.comp * p;
			churn += c.w * c.comp * p * churnFor(k);
		}
	}
	return churn / mass;
};

function handleUser(profile, meta) {
	const uid = profile.distinct_id;
	profile.circle_enabled = profile.account_type === "creator" && salt(uid, "circle") < CIRCLE_ENABLED_SHARE;
	if (meta.userIsBornInDataset) {
		profile.joined_date = dayKey(dayjs.utc(profile.created ?? meta.user?.created).valueOf());
	} else {
		const span = (ms(DATASET_START) - ms("2023-03-01T00:00:00Z")) / DAY_MS;
		profile.joined_date = dayjs.utc("2023-03-01T00:00:00Z").add(Math.floor(salt(uid, "tenure") * span), "day").format("YYYY-MM-DD");
	}
	const base = profile.account_type === "creator" ? 3500 : profile.account_type === "business" ? 1200 : 160;
	profile.follower_count = Math.max(0, Math.round(base * Math.exp((salt(uid, "followers") - 0.5) * 3.2)));
	profile.following_count = Math.round(80 + salt(uid, "following") * 700);
	return profile;
}

function handleEverything(events, meta) {
	if (!events.length) return events;
	const profile = meta.profile;
	const uid = profile.distinct_id;
	const END = ms(DATASET_END);
	const signup = events.find((e) => e.event === "account created");
	const birthMs = signup ? T(signup) : null;

	// ── platform: the device the event came from (iOS and iPadOS → ios) ──
	for (const e of events) e.platform = platformOf(e.os);

	// ── H2 + H5: accounts followed from the onboarding suggestions screen ──
	let k = 0;
	if (signup) {
		const ob = events.find((e) => e.event === "user followed" && !e.device_id && T(e) - birthMs < 2 * HOUR_MS);
		if (ob) {
			ob.discovery_source = "onboarding_suggestions";
			k = Number(pickWeighted(WARM_CHANNELS.includes(profile.acquisition_channel) ? WARM_K : COLD_K, salt(uid, "ob-follows")));
			if (k === 0) events = events.filter((e) => e !== ob);
			let t = T(ob);
			for (let i = 1; i < k; i++) {
				t += chance.integer({ min: 2, max: 9 }) * 1000;
				events.push(cloneEvent(ob, { time: iso(t) }));
			}
		}
	}

	// ── H9: time to first post (new members), by account type ──
	if (signup) {
		const posts = events.filter((e) => e.event === "post created").sort(byT);
		const gapH = Math.min(FIRST_POST_MAX_H, FIRST_POST_MEDIAN_H * (FIRST_POST_FACTOR[profile.account_type] ?? 1) * logNormal(FIRST_POST_SIGMA));
		const t1 = Math.floor(birthMs + gapH * HOUR_MS);
		if (posts.length && t1 <= END) {
			const first = posts.find((p) => T(p) >= t1) || posts[0];
			const early = new Set(posts.filter((p) => T(p) < t1 && p !== first));
			// the first post's Create session moves with it: the app open just before
			// it and the post views just after it (never the onboarding steps)
			const delta = t1 - T(first);
			const sid = first.session_id;
			const firstT = T(first);
			const moves = (e) => e === first || (sid && e.session_id === sid && (
				(e.event === "app opened" && T(e) <= firstT && firstT - T(e) < 15 * MIN_MS) ||
				(e.event === "post viewed" && T(e) >= firstT && T(e) - firstT < 30 * MIN_MS)));
			for (const e of events) {
				if (moves(e)) e.time = iso(Math.max(birthMs + 1000, T(e) + delta));
			}
			events = events.filter((e) => !early.has(e));
		}
	}

	// ── H1 Clips + coherent post types, ad placements; H4 incident ──
	events.sort(byT);
	// search results: the post viewed that follows a search in the Discover flow
	for (let i = 1; i < events.length; i++) {
		if (events[i].event === "post viewed" && events[i - 1].event === "search performed" && T(events[i]) - T(events[i - 1]) < HOUR_MS) events[i].feed = "search";
	}
	let lastView = null;      // last post viewed in this stream (post type, dropped?)
	let lastContent = null;   // "post viewed" | "story viewed"
	const dropped = new Set();
	for (const e of events) {
		const t = T(e);
		if (e.event === "post viewed") {
			if (hashFloat(`${e.insert_id}|clip`) < CLIP_VIEW_SHARE * clipRamp(t)) {
				e.post_type = "clip";
				e.view_duration_sec = chance.integer({ min: 4, max: 58 });
			}
			// H4: Android For You feed loads fail during the incident; a failed load is never viewed
			const fail = e.platform === "android" && e.feed === "for_you" && inFeedIncident(t) && chance.bool({ likelihood: FEED_FAIL * 100 });
			if (fail) dropped.add(e);
			lastView = { type: e.post_type, dropped: fail };
			lastContent = "post viewed";
		} else if (e.event === "post liked") {
			if (lastView) {
				e.post_type = lastView.type;
				if (lastView.dropped) dropped.add(e);
			} else if (hashFloat(`${e.insert_id}|clip`) < CLIP_VIEW_SHARE * clipRamp(t)) e.post_type = "clip";
		} else if (e.event === "story viewed") {
			lastContent = "story viewed";
		} else if (e.event === "ad viewed") {
			if (lastContent === "story viewed") e.ad_placement = "stories";
			else {
				e.ad_placement = lastView && lastView.type === "clip" ? "clips" : "feed";
				if (lastView && lastView.dropped) dropped.add(e); // the ad slot of a feed page that never loaded
			}
		} else if (e.event === "post created") {
			if (hashFloat(`${e.insert_id}|clip`) < CLIP_POST_SHARE * clipRamp(t)) e.post_type = "clip";
			e.has_media = e.post_type === "photo" || e.post_type === "clip";
		} else if (e.event === "search performed") {
			lastContent = null;
			lastView = null;
		}
	}
	if (dropped.size) events = events.filter((e) => !dropped.has(e));
	// ── H6: Circle creators post more after the fee cut (10-day ramp) ──
	if (profile.circle_enabled) {
		// each Circle creator's response scatters around the average lift (x0.5-1.5 of it)
		const lift = (CIRCLE_POST_LIFT - 1) * (0.5 + salt(uid, "fee-response"));
		const extra = [];
		for (const p of events) {
			if (p.event !== "post created") continue;
			const r = feeRamp(T(p));
			if (r > 0 && chance.bool({ likelihood: lift * r * 100 })) {
				const t = T(p) + chance.integer({ min: 2 * 60, max: 20 * 60 }) * MIN_MS;
				if (t <= END) extra.push(cloneEvent(p, { time: iso(t) }));
			}
		}
		events = events.concat(extra);
	}

	// ── H3: push notifications and the Smart Digest experiment ──
	const variant = profile[EXP_KEY];
	const units = new Map();
	for (const e of events) {
		if (e.event !== "push notification sent" && e.event !== "push notification opened") continue;
		if (!units.has(e.notification_id)) units.set(e.notification_id, {});
		units.get(e.notification_id)[e.event === "push notification sent" ? "sent" : "opened"] = e;
	}
	const pushDrop = new Set();
	// members differ in how often they open pushes (x0.25-1.75 of the average, mean 1)
	const openHabit = 0.25 + 1.5 * salt(uid, "push-open");
	for (const unit of units.values()) {
		const { sent, opened } = unit;
		if (!sent) { if (opened) pushDrop.add(opened); continue; }
		const inDigest = variant === DIGEST_VARIANT && T(sent) >= ms(DIGEST_START);
		if (inDigest && !chance.bool({ likelihood: DIGEST_SEND_KEEP * 100 })) {
			pushDrop.add(sent);
			if (opened) pushDrop.add(opened);
			continue;
		}
		if (inDigest && chance.bool({ likelihood: DIGEST_LABEL_SHARE * 100 })) sent.notification_type = "daily_digest";
		if (!opened) continue;
		opened.notification_type = sent.notification_type;
		if (!chance.bool({ likelihood: PUSH_OPEN_RATE * openHabit * (inDigest ? DIGEST_OPEN_MULT : 1) * 100 })) pushDrop.add(opened);
	}
	// one exposure per member: the first assignment
	const exposures = events.filter((e) => e.event === "$experiment_started").sort(byT);
	for (const x of exposures.slice(1)) pushDrop.add(x);
	if (exposures[0]) delete exposures[0].notification_id;
	if (pushDrop.size) events = events.filter((e) => !pushDrop.has(e));

	// ── H8: ad load raised (more impressions per feed page); ad clicks follow impressions ──
	const adExtra = [];
	for (const a of events) {
		if (a.event !== "ad viewed") continue;
		if (T(a) >= ms(AD_LOAD_CHANGE) && a.ad_placement !== "stories" && chance.bool({ likelihood: (AD_LOAD_MULT - 1) * 100 })) {
			const t = T(a) + chance.integer({ min: 15, max: 90 }) * 1000;
			if (t <= END) adExtra.push(cloneEvent(a, { time: iso(t) }));
		}
	}
	events = events.concat(adExtra);
	const clicks = [];
	for (const a of events) {
		if (a.event !== "ad viewed" || !chance.bool({ likelihood: AD_CTR * 100 })) continue;
		const t = T(a) + chance.integer({ min: 2, max: 14 }) * 1000;
		if (t <= END) clicks.push(cloneEvent(a, { event: "ad clicked", time: iso(t) }));
	}
	events = events.concat(clicks);

	// ── communities: each member belongs to a few; posts and comments land in them ──
	const nHome = 1 + Math.floor(salt(uid, "communities") * 3);
	const home = Array.from({ length: nHome }, (_, i) => COMMUNITY_IDS[Math.floor(Math.pow(salt(uid, `community-${i}`), 1.8) * COMMUNITY_COUNT)]);
	for (const e of events) {
		if (e.event === "post created" || e.event === "comment posted") {
			const r = hashFloat(`${e.insert_id}|community`);
			if (r < (e.event === "post created" ? 0.35 : 0.25)) e.community_id = home[Math.floor(r * 1000) % nHome];
			else delete e.community_id;
		} else if (e.event === "community joined") {
			e.community_id = home[Math.floor(hashFloat(`${e.insert_id}|join`) * nHome)];
		}
	}

	// ── H2: new members who follow few accounts at onboarding leave in their first week ──
	if (signup && salt(uid, "churn") < churnFor(k)) {
		const cut = birthMs + (CHURN_DAY_MIN + salt(uid, "churn-day") * (CHURN_DAY_MAX - CHURN_DAY_MIN)) * DAY_MS;
		// pushes and experiment assignment are server-side and keep coming
		events = events.filter((e) => T(e) < cut || SERVER_EVENTS.has(e.event));
	}
	return events;
}

// warehouse rows: exogenous business facts layered on event-derived volumes
function handleWarehouse(row, meta) {
	if (meta.isBackfill) return row;
	if (meta.metricName === "marketing_spend_daily") {
		const ch = row.acquisition_channel;
		const k = `${row.date}|${ch}`;
		const spend = paidSpend(row.date, ch, row.spend_usd);
		row.spend_usd = spend;
		row.installs_reported = Math.round(spend * PLATFORM_INSTALL_INFLATION / CPI_USD[ch] * jitter(`inst|${k}`, 0.2));
		row.clicks = Math.round(spend / (CPC_USD[ch] * jitter(`cpc|${k}`, 0.15)));
		row.impressions = Math.round(row.clicks / (CTR[ch] * jitter(`ctr|${k}`, 0.15)));
		return row;
	}
	if (meta.metricName === "for_you_feed_health_daily") {
		const k = `${row.date}|${row.platform}`;
		const served = row.feed_requests * FEED_REQUESTS_PER_VIEW * (1 + UNTRACKED_VIEW_SHARE * jitter(`untracked|${k}`, 1)) * jitter(`prefetch|${k}`, 0.08);
		row.feed_requests = Math.round(served / (1 - row.error_rate));
		row.failed_requests = Math.round(row.feed_requests * row.error_rate);
		return row;
	}
	if (meta.metricName === "ad_revenue_daily") {
		const k = `${row.date}|${row.ad_placement}`;
		// the ad server also counts members who opted out of analytics, and its
		// invalid-traffic filter and late-arriving logs move each day's count
		row.impressions_served = Math.round(row.impressions_served * (1 + UNTRACKED_IMPRESSION_SHARE * jitter(`untracked|${k}`, 1)) * jitter(`ivt|${k}`, 0.12));
		row.ad_revenue_usd = round2(row.impressions_served * row.ecpm_usd / 1000);
		return row;
	}
	return row;
}

// ── CONFIG ──
/** @type {Config} */
const config = {
	seed: SEED,
	datasetStart: DATASET_START,
	datasetEnd: DATASET_END,
	numUsers: NUM_USERS,
	avgEventsPerUserPerDay: EVENTS_PER_DAY,
	format: "json",
	gzip: true,
	concurrency: 1,
	writeToDisk: false,
	macro: { percentUsersBornInDataset: BORN_PCT, bornRecentBias: 0, preExistingSpread: "uniform" },
	soup: { dayOfWeekWeights: DOW_WEIGHTS, hourOfDayWeights: HOUR_WEIGHTS },
	credentials: { token },
	switches: {
		hasSessionIds: true,
		alsoInferFunnels: false,
		hasLocation: false,
		hasAndroidDevices: true,
		hasIOSDevices: true,
		hasDesktopDevices: false,
		hasBrowser: false,
		hasCampaigns: false,
		isAnonymous: false,
		hasAdSpend: false,
		hasAvatar: true,
	},
	identity: { avgDevicePerUser: 1 },

	events: [
		{
			event: "account created",
			weight: 1,
			isFirstEvent: true,
			isAuthEvent: true,
			properties: {
				signup_method: { __weights: { apple: 44, google: 30, phone: 26 } },
				acquisition_channel: (ctx) => ctx.profile.acquisition_channel,
			},
		},
		{
			event: "interests selected",
			weight: 1,
			isStrictEvent: true,
			properties: {
				interest_count: [3, 3, 4, 4, 5, 5, 6, 7, 8],
			},
		},
		{
			event: "app opened",
			weight: 1,
			isStrictEvent: true,
			properties: {
				open_source: { __weights: { home_screen: 82, link: 10, widget: 8 } },
			},
		},
		{
			event: "post viewed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				post_type: { __weights: { photo: 50, text: 38, link: 7, poll: 5 } },
				feed: { __weights: { for_you: 56, following: 30, community: 10, profile: 4 } },
				view_duration_sec: u.weighNumRange(1, 45, 0.4, 6),
			},
		},
		{
			event: "post liked",
			weight: 1,
			isStrictEvent: true,
			properties: {
				post_type: { __weights: { photo: 50, text: 38, link: 7, poll: 5 } },
			},
		},
		{
			event: "comment posted",
			weight: 1,
			isStrictEvent: true,
			properties: {
				comment_length: u.weighNumRange(2, 280, 0.35, 40),
				has_mention: [false, false, false, true],
			},
		},
		{
			event: "post shared",
			weight: 6,
			properties: {
				share_destination: { __weights: { repost: 45, dm: 35, external_link: 20 } },
			},
		},
		{
			event: "post created",
			weight: 1,
			isStrictEvent: true,
			properties: {
				post_type: { __weights: { photo: 52, text: 38, link: 6, poll: 4 } },
				has_media: [false],
				character_count: u.weighNumRange(0, 500, 0.4, 80),
				hashtag_count: [0, 0, 0, 1, 1, 2, 3],
			},
		},
		{
			event: "story viewed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				story_type: { __weights: { photo: 55, video: 40, text: 5 } },
				completed: [true, true, true, false],
			},
		},
		{
			event: "story posted",
			weight: 4,
			properties: {
				story_type: { __weights: { photo: 60, video: 35, text: 5 } },
			},
		},
		{
			event: "dm sent",
			weight: 1,
			isStrictEvent: true,
			properties: {
				message_type: { __weights: { text: 70, photo: 12, post_share: 10, voice: 8 } },
			},
		},
		{
			event: "search performed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				search_type: { __weights: { people: 45, topics: 35, communities: 20 } },
			},
		},
		{
			event: "user followed",
			weight: 14,
			isStrictEvent: false,
			properties: {
				discovery_source: { __weights: { for_you: 40, search: 20, profile: 25, suggested_for_you: 15 } },
			},
		},
		{
			event: "user unfollowed",
			weight: 1,
			properties: {
				reason: { __weights: { posts_too_often: 35, lost_interest: 40, offensive: 10, other: 15 } },
			},
		},
		{
			event: "community joined",
			weight: 1,
			properties: {
				join_source: { __weights: { search: 35, for_you: 40, invite: 25 } },
			},
		},
		{
			event: "profile updated",
			weight: 1,
			properties: {
				field_updated: { __weights: { bio: 30, avatar: 30, display_name: 15, privacy: 15, links: 10 } },
			},
		},
		{
			event: "content reported",
			weight: 1,
			properties: {
				report_reason: { __weights: { spam: 40, harassment: 22, misinformation: 14, nudity: 10, hate_speech: 8, other: 6 } },
			},
		},
		{
			event: "ad viewed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				ad_placement: ["feed"],
				ad_category: { __weights: { retail: 30, entertainment: 20, food: 14, tech: 14, finance: 10, travel: 12 } },
			},
		},
		{
			event: "ad clicked",
			weight: 1,
			isStrictEvent: true,
			properties: {
				ad_placement: ["feed"],
				ad_category: ["retail"],
			},
		},
		{
			event: "push notification sent",
			weight: 1,
			isStrictEvent: true,
			properties: {
				notification_type: { __weights: { like: 30, comment: 18, new_follower: 14, mention: 10, trending: 16, dm: 12 } },
			},
		},
		{
			event: "push notification opened",
			weight: 1,
			isStrictEvent: true,
			properties: {
				notification_type: ["like"],
			},
		},
		{
			event: "circle paywall viewed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				paywall_trigger: ["locked_post"],
			},
		},
		{
			event: "circle subscription started",
			weight: 1,
			isStrictEvent: true,
			properties: {
				paywall_trigger: ["locked_post"],
				circle_tier: { __weights: { supporter: 60, insider: 30, vip: 10 } },
			},
		},
		{
			event: "$experiment_started",
			weight: 1,
			isStrictEvent: true,
			properties: {
				"Experiment name": [DIGEST_EXPERIMENT],
				"Variant name": ["Control", DIGEST_VARIANT],
			},
		},
	],

	funnels: [
		{
			name: "Onboarding",
			sequence: ["account created", "interests selected", "user followed"],
			isFirstFunnel: true,
			conditions: { acquisition_channel: { neq: "tiktok_ads" } },
			conversionRate: ONBOARD_CONV,
			timeToConvert: 0.15,
			order: "sequential",
		},
		{
			name: "Onboarding",
			sequence: ["account created", "interests selected", "user followed"],
			isFirstFunnel: true,
			conditions: { acquisition_channel: "tiktok_ads" },
			conversionRate: TIKTOK_ONBOARD_CONV,
			timeToConvert: 0.15,
			order: "sequential",
		},
		{
			name: "Feed session",
			sequence: ["app opened", "post viewed", "post viewed", "post liked", "post viewed", "post viewed", "post viewed", "ad viewed",
				"post viewed", "post liked", "post viewed", "comment posted", "post viewed", "post viewed", "post viewed", "post liked", "post viewed"],
			conversionRate: 65,
			timeToConvert: 0.45,
			order: "sequential",
			requireRepeats: true,
			weight: 14,
		},
		{
			name: "Stories session",
			sequence: ["app opened", "story viewed", "story viewed", "story viewed", "story viewed", "story viewed", "ad viewed", "story viewed", "story viewed", "dm sent"],
			conversionRate: 60,
			timeToConvert: 0.25,
			order: "sequential",
			requireRepeats: true,
			weight: 6,
		},
		{
			name: "Chat session",
			sequence: ["app opened", "dm sent", "dm sent", "dm sent", "dm sent", "dm sent"],
			conversionRate: 60,
			timeToConvert: 0.5,
			order: "sequential",
			requireRepeats: true,
			weight: 5,
		},
		{
			name: "Create (creator)",
			sequence: ["app opened", "post created", "post viewed", "post viewed"],
			conditions: { account_type: "creator" },
			conversionRate: 85,
			timeToConvert: 0.4,
			order: "sequential",
			requireRepeats: true,
			weight: 70,
		},
		{
			name: "Create (business)",
			sequence: ["app opened", "post created", "post viewed", "post viewed"],
			conditions: { account_type: "business" },
			conversionRate: 85,
			timeToConvert: 0.4,
			order: "sequential",
			requireRepeats: true,
			weight: 30,
		},
		{
			name: "Create (personal)",
			sequence: ["app opened", "post created", "post viewed", "post viewed"],
			conditions: { account_type: "personal" },
			conversionRate: 80,
			timeToConvert: 0.4,
			order: "sequential",
			requireRepeats: true,
			weight: 6,
		},
		{
			name: "Discover",
			sequence: ["search performed", "post viewed", "user followed"],
			conversionRate: 40,
			timeToConvert: 0.3,
			order: "sequential",
			weight: 4,
		},
		{
			name: "Push",
			sequence: ["push notification sent", "push notification opened"],
			conversionRate: 100,
			timeToConvert: 0.75,
			order: "sequential",
			weight: 30,
			props: {
				notification_id: () => `ntf_${chance.hash({ length: 12 })}`,
			},
			experiment: {
				name: DIGEST_EXPERIMENT,
				startDaysBeforeEnd: (ms(DATASET_END) - ms(DIGEST_START)) / DAY_MS,
				variants: [{ name: "Control" }, { name: DIGEST_VARIANT }],
			},
		},
		{
			name: "Circle join (locked post)",
			sequence: ["circle paywall viewed", "circle subscription started"],
			conversionRate: LOCKED_POST_CONV,
			timeToConvert: 0.3,
			order: "sequential",
			weight: 4,
			props: { paywall_trigger: "locked_post" },
		},
		{
			name: "Circle join (profile button)",
			sequence: ["circle paywall viewed", "circle subscription started"],
			conversionRate: PROFILE_BUTTON_CONV,
			timeToConvert: 0.3,
			order: "sequential",
			weight: 6,
			props: { paywall_trigger: "profile_button" },
		},
	],

	worldEvents: [
		{
			name: "murmur_sound_awards",
			type: "campaign",
			startDay: Math.round((ms(AWARDS_DAY) - ms(DATASET_START)) / DAY_MS),
			duration: 1,
			volumeMultiplier: AWARDS_MULT,
			affectsEvents: AWARDS_EVENTS,
		},
	],

	warehouseMetrics: [
		{
			name: "marketing_spend_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "account created",
				measure: "count",
				where: (e) => PAID_CHANNELS.includes(e.acquisition_channel),
				groupBy: "acquisition_channel",
			},
			timeColumn: "date",
			valueColumn: "spend_usd",
			columns: {
				impressions: 0,
				clicks: 0,
				installs_reported: 0,
			},
		},
		{
			name: "for_you_feed_health_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "post viewed",
				measure: "count",
				where: (e) => e.feed === "for_you",
				groupBy: "platform",
			},
			timeColumn: "date",
			valueColumn: "feed_requests",
			columns: {
				failed_requests: 0,
				error_rate: (ctx) => {
					const hit = ctx.row.platform === "android" && inFeedIncident(ctx.time);
					const j = hashFloat(`err|${dayKey(ctx.time)}|${ctx.seriesKey}`);
					return hit ? round2(FEED_FAIL + (j - 0.5) * 0.04) : Math.round((0.002 + j * 0.009) * 10000) / 10000;
				},
				p95_latency_ms: (ctx) => {
					const hit = ctx.row.platform === "android" && inFeedIncident(ctx.time);
					const j = hashFloat(`lat|${dayKey(ctx.time)}|${ctx.seriesKey}`);
					return hit ? Math.round(7000 + j * 5000) : Math.round(420 + j * 240);
				},
				service_status: (ctx) => (ctx.row.platform === "android" && inFeedIncident(ctx.time) ? "major_outage" : "operational"),
			},
		},
		{
			name: "ad_revenue_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "ad viewed",
				measure: "count",
				groupBy: "ad_placement",
			},
			timeColumn: "date",
			valueColumn: "impressions_served",
			columns: {
				// Clips ads are not sold before Clips launches
				ecpm_usd: (ctx) => (ctx.row.ad_placement === "clips" && ctx.time < ms(CLIPS_LAUNCH) ? 0 : ecpm(ctx.row.ad_placement, ctx.time, `${dayKey(ctx.time)}|${ctx.row.ad_placement}`)),
				ad_revenue_usd: 0,
			},
		},
	],

	superProps: {
		platform: ["ios"],
	},

	userProps: {
		account_type: ["personal"],
		circle_enabled: [false],
		acquisition_channel: { __weights: CHANNEL_WEIGHTS },
		joined_date: ["2025-01-01"],
		age_band: { __weights: { "18-24": 34, "25-34": 36, "35-44": 18, "45-54": 8, "55+": 4 } },
		country: { __weights: { US: 58, GB: 10, CA: 8, AU: 5, DE: 5, BR: 7, IN: 7 } },
		follower_count: [0],
		following_count: [0],
	},

	groupKeys: [
		["community_id", COMMUNITY_COUNT, ["post created", "comment posted", "community joined"]],
	],

	groupProps: {
		community_id: {
			community_name: () => `${chance.pickone(["The", "Daily", "Late Night", "Weekend", "Local", "Indie", "Retro", "Pro"])} ${chance.pickone(["Crate Diggers", "Film Club", "Runners", "Home Cooks", "Gamers", "Bookworms", "Thrifters", "Plant People", "Sneakerheads", "Photo Walk", "Comedy Corner", "Tech Talk"])}`,
			topic: COMMUNITY_TOPICS,
			is_moderated: [true, true, true, false],
			created_year: [2022, 2023, 2024, 2025],
		},
	},

	personas: [
		{ name: "heavy_scroller", weight: 22, eventMultiplier: 1.7, properties: { account_type: "personal" } },
		{ name: "regular", weight: 40, eventMultiplier: 1.0, properties: { account_type: "personal" } },
		{ name: "lurker", weight: 21, eventMultiplier: 0.5, properties: { account_type: "personal" } },
		{ name: "creator", weight: 14, eventMultiplier: 1.8, properties: { account_type: "creator" } },
		{ name: "business", weight: 3, eventMultiplier: 1.2, properties: { account_type: "business" } },
	],

	retentionCurve: { type: "logarithmic", day1: 0.62, day7: 0.45, day30: 0.32 },

	hook(record, type, meta) {
		if (type === "user") return handleUser(record, meta);
		if (type === "everything") return handleEverything(record, meta);
		if (type === "warehouse") return handleWarehouse(record, meta);
		return record;
	},
};

// ── STORIES ──────────────────────────────────────────────────────────────
// Machine-checkable contract for hooks H1-H10. Evaluate with:
//   node dungeons/vertical/social/social.verify.mjs

const EV = `read_json_auto('{{PREFIX}}-EVENTS*.json*', sample_size=-1, union_by_name=true)`;
const US = `read_json_auto('{{PREFIX}}-USERS*.json*', sample_size=-1, union_by_name=true)`;
const WH = (table) => `read_json_auto('{{PREFIX}}-WAREHOUSE-${table}.json*', sample_size=-1, union_by_name=true)`;

// Identity prelude: a device resolves to the member seen with it on any event
// that carries both ids (emitted stitch evidence). Every Murmur event carries
// user_id, so the device map only matters for completeness.
const ID_CTE = `dmap AS (SELECT device_id, min(user_id::VARCHAR) AS mapped FROM ${EV}
  WHERE user_id IS NOT NULL AND device_id IS NOT NULL GROUP BY 1),
ev AS (SELECT coalesce(e.user_id::VARCHAR, m.mapped) AS uid, e.time::TIMESTAMP AS t, e.*
  FROM ${EV} e LEFT JOIN dmap m ON e.device_id = m.device_id)`;

const TS = (iso) => dayjs.utc(iso).format("YYYY-MM-DD HH:mm:ss");
const D = (iso) => iso.slice(0, 10);
const addDays = (iso, n) => dayjs.utc(iso).add(n, "day").toISOString();
const band = (k) => [Math.round(k * 0.9 * 1000) / 1000, Math.round(k * 1.1 * 1000) / 1000];
const r3 = (x) => Math.round(x * 1000) / 1000;
const SQL_LIST = (xs) => xs.map((x) => `'${x}'`).join(", ");
const PASSIVE = SQL_LIST([...SERVER_EVENTS]);
const CLIPS_RAMPED = addDays(CLIPS_LAUNCH, CLIPS_RAMP_DAYS);
const RET_FROM = 14, RET_TO = 28;   // H2/H5 read: any member-initiated event on day 14-27 after signup
const RET_BIRTH_END = TS(dayjs.utc(DATASET_END).subtract(RET_TO, "day").toISOString());
const INC_BASE_DAYS = 14;           // H4 read: baseline days either side of the incident
const INC_BASE_FROM = TS(addDays(FEED_INCIDENT_START, -INC_BASE_DAYS));
const INC_BASE_TO = TS(addDays(FEED_INCIDENT_END, INC_BASE_DAYS));
const FEE_RAMPED = addDays(FEE_CUT, FEE_RAMP_DAYS);
const AD_BEFORE_FROM = addDays(AD_LOAD_CHANGE, -28); // H8 read: 4 weeks before vs the rest of the window
const TTC_WINDOW_DAYS = 7;          // H9 read: Funnels conversion window account created → post created
const TTC_BIRTH_END = TS(dayjs.utc(DATASET_END).subtract(TTC_WINDOW_DAYS, "day").toISOString());
const AWARDS_CONTROL_DAYS = [-21, -7, 7, 14].map((n) => D(addDays(AWARDS_DAY, n))); // the Saturdays around it

// expected retention ratios from the knobs (organic return cancels in the ratio)
const RET_0_2 = 1 - expectedChurn(0, 2);
const RET_3_6 = 1 - expectedChurn(3, 6);
const RET_7P = 1 - expectedChurn(7, 99);
const RET_CREATOR = 1 - expectedChurn(0, 99, ["creator_partnerships"]);
const RET_META = 1 - expectedChurn(0, 99, ["meta_ads"]);

const H2_SQL = `WITH ${ID_CTE},
s AS (SELECT uid, t AS t0, acquisition_channel AS ch FROM ev WHERE event = 'account created' AND t <= TIMESTAMP '${RET_BIRTH_END}'),
k AS (SELECT uid, count(*) AS k FROM ev WHERE event = 'user followed' AND discovery_source = 'onboarding_suggestions' GROUP BY 1),
r AS (SELECT s.uid, bool_or(e.t >= s.t0 + INTERVAL ${RET_FROM} DAY AND e.t < s.t0 + INTERVAL ${RET_TO} DAY) AS ret
  FROM s JOIN ev e ON e.uid = s.uid AND e.event NOT IN (${PASSIVE}) GROUP BY 1),
x AS (SELECT s.uid, s.ch, coalesce(k.k, 0) AS k, coalesce(r.ret, false) AS ret FROM s LEFT JOIN k ON k.uid = s.uid LEFT JOIN r ON r.uid = s.uid)
SELECT CASE WHEN k <= 2 THEN '0-2' WHEN k <= 6 THEN '3-6' ELSE '7+' END AS grp, count(*) AS user_count, avg(ret::INT) AS retention FROM x GROUP BY 1`;

const H3_SQL = `WITH ${ID_CTE},
v AS (SELECT distinct_id::VARCHAR AS uid, "${EXP_KEY}" AS variant FROM ${US} WHERE "${EXP_KEY}" IS NOT NULL),
s AS (SELECT uid, notification_id FROM ev WHERE event = 'push notification sent' AND t >= TIMESTAMP '${TS(DIGEST_START)}'),
o AS (SELECT DISTINCT notification_id FROM ev WHERE event = 'push notification opened')
SELECT v.variant AS grp, count(DISTINCT v.uid) AS user_count, count(s.notification_id) AS sends,
 count(s.notification_id)::DOUBLE / count(DISTINCT v.uid) AS sends_per_member,
 avg((o.notification_id IS NOT NULL)::INT) FILTER (WHERE s.notification_id IS NOT NULL) AS open_rate
FROM v LEFT JOIN s ON s.uid = v.uid LEFT JOIN o ON o.notification_id = s.notification_id GROUP BY 1`;

// For You views per Following view, by platform: outage days vs the baseline days.
// The Following feed shares sessions and members with For You, so the ratio
// cancels day-to-day swings in who is active.
const H4_SQL = `WITH ${ID_CTE},
o AS (SELECT DISTINCT date::DATE AS d FROM ${WH("for_you_feed_health_daily")} WHERE service_status = 'major_outage'),
w AS (SELECT t::DATE AS d, uid, platform, feed FROM ev WHERE event = 'post viewed' AND feed IN ('for_you', 'following') AND t >= TIMESTAMP '${INC_BASE_FROM}' AND t < TIMESTAMP '${INC_BASE_TO}'),
g AS (SELECT platform, (d IN (SELECT d FROM o)) AS outage, count(*) FILTER (WHERE feed = 'for_you')::DOUBLE / count(*) FILTER (WHERE feed = 'following') AS rel, count(DISTINCT uid) AS users FROM w GROUP BY 1, 2)
SELECT platform AS grp, (SELECT count(*) FROM o) AS outage_days, min(users) AS user_count,
 max(rel) FILTER (WHERE outage) / max(rel) FILTER (WHERE NOT outage) AS did FROM g GROUP BY 1`;

const H5_SQL = `WITH ${ID_CTE},
s AS (SELECT uid, t AS t0, acquisition_channel AS ch FROM ev WHERE event = 'account created'),
r AS (SELECT s.uid, bool_or(e.t >= s.t0 + INTERVAL ${RET_FROM} DAY AND e.t < s.t0 + INTERVAL ${RET_TO} DAY) AS ret
  FROM s JOIN ev e ON e.uid = s.uid AND e.event NOT IN (${PASSIVE}) WHERE s.t0 <= TIMESTAMP '${RET_BIRTH_END}' GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM ${WH("marketing_spend_daily")} GROUP BY 1),
g AS (SELECT s.ch, count(*) AS signups, count(r.uid) AS mature, avg(coalesce(r.ret, false)::INT) FILTER (WHERE r.uid IS NOT NULL) AS retention
  FROM s LEFT JOIN r ON r.uid = s.uid GROUP BY 1)
SELECT g.ch AS grp, g.mature AS user_count, g.signups, g.retention, sp.spend / g.signups AS spend_per_signup,
 sp.spend / g.signups / g.retention AS spend_per_retained
FROM g LEFT JOIN sp ON sp.ch = g.ch`;

const H6_SQL = `WITH ${ID_CTE},
c AS (SELECT distinct_id::VARCHAR AS uid, circle_enabled FROM ${US} WHERE account_type = 'creator' AND joined_date < '${D(DATASET_START)}'),
p AS (SELECT uid, CASE WHEN t < TIMESTAMP '${TS(FEE_CUT)}' THEN 'before' WHEN t >= TIMESTAMP '${TS(FEE_RAMPED)}' THEN 'after' END AS per FROM ev WHERE event = 'post created')
SELECT CASE WHEN c.circle_enabled THEN 'circle' ELSE 'no_circle' END AS grp, count(DISTINCT c.uid) AS user_count,
 count(*) FILTER (WHERE per = 'before') / ${(ms(FEE_CUT) - ms(DATASET_START)) / DAY_MS}.0 AS posts_per_day_before,
 count(*) FILTER (WHERE per = 'after') / ${Math.round((ms(DATASET_END) + 1000 - ms(FEE_RAMPED)) / DAY_MS)}.0 AS posts_per_day_after
FROM c LEFT JOIN p ON p.uid = c.uid GROUP BY 1`;
const H6_DID_SQL = `WITH g AS (${H6_SQL})
SELECT 'all' AS grp, min(user_count) AS user_count,
 (max(posts_per_day_after) FILTER (WHERE grp = 'circle') / max(posts_per_day_before) FILTER (WHERE grp = 'circle'))
 / (max(posts_per_day_after) FILTER (WHERE grp = 'no_circle') / max(posts_per_day_before) FILTER (WHERE grp = 'no_circle')) AS did
FROM g`;

// Award-type events (posts, comments, shares, stories) per daily active member,
// the awards Saturday vs the Saturdays two and one weeks either side. Clones
// come from members already active that day, so active members do not move.
const H7_SQL = `WITH ${ID_CTE},
d AS (SELECT t::DATE AS d, count(*) FILTER (WHERE event IN (${SQL_LIST(AWARDS_EVENTS)})) AS award_events,
  count(*) FILTER (WHERE event = 'post viewed') AS post_views, count(DISTINCT uid) FILTER (WHERE event NOT IN (${PASSIVE})) AS dau
  FROM ev WHERE t::DATE IN (DATE '${D(AWARDS_DAY)}', ${AWARDS_CONTROL_DAYS.map((x) => `DATE '${x}'`).join(", ")}) GROUP BY 1)
SELECT 'all' AS grp, min(dau) AS user_count,
 max(award_events / dau) FILTER (WHERE d = DATE '${D(AWARDS_DAY)}') / avg(award_events / dau) FILTER (WHERE d <> DATE '${D(AWARDS_DAY)}') AS post_lift,
 max(post_views / dau) FILTER (WHERE d = DATE '${D(AWARDS_DAY)}') / avg(post_views / dau) FILTER (WHERE d <> DATE '${D(AWARDS_DAY)}') AS view_lift
FROM d`;

const H8_SQL = `WITH ${ID_CTE},
w AS (SELECT CASE WHEN t >= TIMESTAMP '${TS(AD_LOAD_CHANGE)}' THEN 'after' WHEN t >= TIMESTAMP '${TS(AD_BEFORE_FROM)}' THEN 'before' END AS per, event, ad_placement, uid
  FROM ev WHERE event IN ('ad viewed', 'post viewed')),
r AS (SELECT CASE WHEN date::DATE >= DATE '${D(AD_LOAD_CHANGE)}' THEN 'after' WHEN date::DATE >= DATE '${D(AD_BEFORE_FROM)}' THEN 'before' END AS per,
  sum(ad_revenue_usd) AS revenue FROM ${WH("ad_revenue_daily")} WHERE ad_placement IN ('feed', 'clips') GROUP BY 1)
SELECT w.per AS grp, count(DISTINCT uid) AS user_count,
 count(*) FILTER (WHERE event = 'ad viewed' AND ad_placement IN ('feed', 'clips'))::DOUBLE / count(*) FILTER (WHERE event = 'post viewed') AS ads_per_view,
 1000.0 * max(r.revenue) / count(*) FILTER (WHERE event = 'post viewed') AS revenue_per_1k_views
FROM w JOIN r ON r.per = w.per WHERE w.per IS NOT NULL GROUP BY 1`;

const H9_SQL = `WITH ${ID_CTE},
s AS (SELECT uid, t AS t0 FROM ev WHERE event = 'account created' AND t <= TIMESTAMP '${TTC_BIRTH_END}'),
f AS (SELECT s.uid, min(p.t) AS t1 FROM s JOIN ev p ON p.uid = s.uid AND p.event = 'post created' AND p.t > s.t0 AND p.t < s.t0 + INTERVAL ${TTC_WINDOW_DAYS} DAY GROUP BY 1)
SELECT u.account_type AS grp, count(*) AS user_count, median(date_diff('second', s.t0, f.t1) / 3600.0) AS med_hours
FROM s JOIN f ON f.uid = s.uid JOIN ${US} u ON u.distinct_id::VARCHAR = s.uid GROUP BY 1`;

const H10_SQL = `WITH ${ID_CTE}
SELECT paywall_trigger AS grp, count(DISTINCT uid) AS user_count,
 count(*) FILTER (WHERE event = 'circle subscription started')::DOUBLE / count(*) FILTER (WHERE event = 'circle paywall viewed') AS conversion
FROM ev WHERE event IN ('circle paywall viewed', 'circle subscription started') GROUP BY 1`;

/** @type {import("../../../types").DungeonStory[]} */
export const stories = [
	{
		id: "H1-clips-launch",
		hook: "H1",
		archetype: "composition-drift",
		narrative: `Clips (short vertical video) launches ${D(CLIPS_LAUNCH)}. Over the next ${CLIPS_RAMP_DAYS} days Clips ramps in linearly until ${CLIP_VIEW_SHARE * 100}% of "post viewed" events and ${CLIP_POST_SHARE * 100}% of "post created" events have post_type = clip; total feed views do not change, the mix does. Likes carry the post type of the post just viewed, and an ad slot next to a Clip is a "clips" ad placement. Read: clip share of post views and of new posts from ${D(CLIPS_RAMPED)} on; no clip exists before launch.`,
		mixpanelReport: { type: "Insights", event: "post viewed", measure: "total", breakdown: "post_type", chart: "weekly stacked, % of total" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 avg((post_type = 'clip')::INT) FILTER (WHERE event = 'post viewed' AND t >= TIMESTAMP '${TS(CLIPS_RAMPED)}') AS view_share,
 avg((post_type = 'clip')::INT) FILTER (WHERE event = 'post created' AND t >= TIMESTAMP '${TS(CLIPS_RAMPED)}') AS post_share,
 count(*) FILTER (WHERE post_type = 'clip' AND t < TIMESTAMP '${TS(CLIPS_LAUNCH)}') AS early
FROM ev WHERE event IN ('post viewed', 'post created', 'post liked')`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.view_share", op: "between", target: band(CLIP_VIEW_SHARE) },
				minCohort: 5000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 avg((post_type = 'clip')::INT) FILTER (WHERE t >= TIMESTAMP '${TS(CLIPS_RAMPED)}') AS post_share
FROM ev WHERE event = 'post created'`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.post_share", op: "between", target: band(CLIP_POST_SHARE) },
				minCohort: 2000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count, count(*) FILTER (WHERE post_type = 'clip' AND t < TIMESTAMP '${TS(CLIPS_LAUNCH)}') AS early
FROM ev WHERE event IN ('post viewed', 'post created', 'post liked')`,
				},
				select: { a: { where: { grp: "all" } } },
				// exact: a clip before the launch is a bug
				expect: { metric: "a.early", op: "between", target: [0, 0] },
			},
		],
	},
	{
		id: "H2-onboarding-follows",
		hook: "H2",
		archetype: "retention-divergence",
		narrative: `New members who follow more accounts on the onboarding "suggested accounts" screen (user followed with discovery_source = onboarding_suggestions) stay. The chance a new member leaves the app 3.5-8 days after signup falls with that count: ${CHURN_BY_K.map((p, i) => `${i}${i === CHURN_BY_K.length - 1 ? "+" : ""}: ${p}`).join(", ")}; members who quit before the screen count as 0. Server-side pushes keep arriving after a member leaves, so retention counts member-initiated events only. Read: retained = any event other than push notification sent / $experiment_started on day ${RET_FROM}-${RET_TO - 1} after signup, signups through ${RET_BIRTH_END.slice(0, 10)}; buckets 0-2, 3-6, 7+ follows. Expected retention ratios from the knobs and the follow-count mix (organic return cancels): 0-2 / 7+ = ${r3(RET_0_2 / RET_7P)}, 3-6 / 7+ = ${r3(RET_3_6 / RET_7P)}.`,
		mixpanelReport: { type: "Retention", birth: "account created", return: "any event except push notification sent", cohorts: "did user followed (discovery_source = onboarding_suggestions) 0-2 / 3-6 / 7+ times", brackets: `custom: day ${RET_FROM}-${RET_TO - 1}`, dateRange: `signups ${D(DATASET_START)} to ${RET_BIRTH_END.slice(0, 10)}` },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H2_SQL },
				select: { lo: { where: { grp: "0-2" } }, hi: { where: { grp: "7+" } } },
				expect: { metric: "lo.retention / hi.retention", op: "between", target: band(r3(RET_0_2 / RET_7P)) },
				minCohort: 500,
			},
			{
				breakdown: { type: "duckdb", sql: H2_SQL },
				select: { mid: { where: { grp: "3-6" } }, hi: { where: { grp: "7+" } } },
				expect: { metric: "mid.retention / hi.retention", op: "between", target: band(r3(RET_3_6 / RET_7P)) },
				minCohort: 500,
			},
		],
	},
	{
		id: "H3-smart-digest-experiment",
		hook: "H3",
		archetype: "experiment-lift",
		narrative: `The "${DIGEST_EXPERIMENT}" test starts ${D(DIGEST_START)}: members who receive pushes are split 50/50 (sticky per member; one $experiment_started at the first push after the start). The "${DIGEST_VARIANT}" arm batches notifications, so it sends ${DIGEST_SEND_KEEP}x the pushes Control gets (about half as a daily_digest notification) and each push is opened ${DIGEST_OPEN_MULT}x as often (Control ${PUSH_OPEN_RATE * 100}% before members leave). Read: per arm after the start, pushes sent per exposed member and opens per push sent (push notification opened shares notification_id with its send).`,
		mixpanelReport: { type: "Insights", events: ["push notification opened", "push notification sent"], formula: "A / B", breakdown: `user property "${EXP_KEY}"`, dateRange: `${D(DIGEST_START)} to ${D(DATASET_END)}` },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H3_SQL },
				select: { v: { where: { grp: DIGEST_VARIANT } }, c: { where: { grp: "Control" } } },
				expect: { metric: "v.open_rate / c.open_rate", op: "between", target: band(DIGEST_OPEN_MULT) },
				minCohort: 2000,
			},
			{
				breakdown: { type: "duckdb", sql: H3_SQL },
				select: { v: { where: { grp: DIGEST_VARIANT } }, c: { where: { grp: "Control" } } },
				expect: { metric: "v.sends_per_member / c.sends_per_member", op: "between", target: band(DIGEST_SEND_KEEP) },
				minCohort: 2000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 count(DISTINCT uid) FILTER (WHERE "Variant name" = '${DIGEST_VARIANT}')::DOUBLE / count(DISTINCT uid) AS variant_share,
 count(*)::DOUBLE / count(DISTINCT uid) AS exposures_per_member
FROM ev WHERE event = '$experiment_started'`,
				},
				select: { a: { where: { grp: "all" } } },
				// equal-weight 2-arm hash → 0.5
				expect: { metric: "a.variant_share", op: "between", target: band(0.5) },
				minCohort: 4000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
v AS (SELECT distinct_id::VARCHAR AS uid, "${EXP_KEY}" AS variant FROM ${US})
SELECT 'all' AS grp, count(DISTINCT ev.uid) AS user_count,
 count(*) FILTER (WHERE notification_type = 'daily_digest' AND (t < TIMESTAMP '${TS(DIGEST_START)}' OR v.variant IS DISTINCT FROM '${DIGEST_VARIANT}')) AS impure
FROM ev LEFT JOIN v ON v.uid = ev.uid WHERE event = 'push notification sent'`,
				},
				select: { a: { where: { grp: "all" } } },
				// exact: the daily digest exists only in the Digest arm after the start
				expect: { metric: "a.impure", op: "between", target: [0, 0] },
			},
		],
	},
	{
		id: "H4-android-for-you-incident",
		hook: "H4",
		archetype: "external-join",
		narrative: `From ${D(FEED_INCIDENT_START)} to ${D(FEED_INCIDENT_END)} (exclusive) a fault in the Android app's For You feed makes ${FEED_FAIL * 100}% of Android For You feed loads fail; a failed load is never viewed (no "post viewed", no like on it, no ad in its slot). The Following feed, community and profile views, and iOS are untouched. The incident days come from warehouse for_you_feed_health_daily (service_status = 'major_outage', error_rate ≈ ${FEED_FAIL} for android). Event read: on Android, For You "post viewed" per Following-feed "post viewed" on outage days vs the ${INC_BASE_DAYS} days either side reads 1 - ${FEED_FAIL} (the Following feed shares the sessions, so it cancels swings in who is active); the same ratio on iOS is the control (1.0).`,
		mixpanelReport: { type: "Insights", event: "post viewed", measure: "total", filter: "feed in (for_you, following)", breakdown: "platform, feed", chart: "daily line, Aug 12 - Sep 12", join: "warehouse for_you_feed_health_daily.service_status / error_rate" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H4_SQL },
				select: { a: { where: { grp: "android" } } },
				expect: { metric: "a.did", op: "between", target: band(1 - FEED_FAIL) },
				minCohort: 600,
			},
			{
				breakdown: { type: "duckdb", sql: H4_SQL },
				select: { a: { where: { grp: "ios" } } },
				// control: iOS was unaffected
				expect: { metric: "a.did", op: "between", target: band(1) },
				minCohort: 600,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT 'all' AS grp, count(*) FILTER (WHERE service_status = 'major_outage') AS outage_rows,
 avg(error_rate) FILTER (WHERE service_status = 'major_outage') AS outage_error_rate
FROM ${WH("for_you_feed_health_daily")}`,
				},
				select: { a: { where: { grp: "all" } } },
				// warehouse error rate during the incident = the failure knob
				expect: { metric: "a.outage_error_rate", op: "between", target: band(FEED_FAIL) },
			},
		],
	},
	{
		id: "H5-paid-channel-economics",
		hook: "H5",
		archetype: "external-join",
		narrative: `Creator partnerships are Murmur's most expensive paid channel per signup, but their members retain better, so per retained member they cost about what Meta does. Warehouse marketing_spend_daily bills each paid channel: half a paced daily budget (cost per signup x expected signups, weekday shape) and half the bid x that day's delivered signups, with ±${SPEND_NOISE * 100}% day noise: $${CPI_USD.creator_partnerships} creator partnerships, $${CPI_USD.meta_ads} Meta, $${CPI_USD.tiktok_ads} TikTok per Mixpanel signup over the window. Members referred by a creator (or invited by a friend) follow more suggested accounts at onboarding, so through H2 they retain better; TikTok signups also finish onboarding less often (${TIKTOK_ONBOARD_CONV}% vs ${ONBOARD_CONV}%) yet stay cheapest per retained member. Expected from the knobs: spend per signup creator/Meta = ${r3(CPI_USD.creator_partnerships / CPI_USD.meta_ads)}; day ${RET_FROM}-${RET_TO - 1} retention creator/Meta = ${r3(RET_CREATOR / RET_META)}; spend per retained member creator/Meta = ${r3(CPI_USD.creator_partnerships / CPI_USD.meta_ads / (RET_CREATOR / RET_META))}.`,
		mixpanelReport: { type: "Insights + Retention + warehouse", event: "account created", breakdown: "acquisition_channel", join: "marketing_spend_daily.spend_usd by acquisition_channel", retention: `birth account created, return any member-initiated event, day ${RET_FROM}-${RET_TO - 1}, breakdown acquisition_channel` },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H5_SQL },
				select: { c: { where: { grp: "creator_partnerships" } }, m: { where: { grp: "meta_ads" } } },
				expect: { metric: "c.spend_per_signup / m.spend_per_signup", op: "between", target: band(r3(CPI_USD.creator_partnerships / CPI_USD.meta_ads)) },
				minCohort: 300,
			},
			{
				breakdown: { type: "duckdb", sql: H5_SQL },
				select: { c: { where: { grp: "creator_partnerships" } }, m: { where: { grp: "meta_ads" } } },
				expect: { metric: "c.retention / m.retention", op: "between", target: band(r3(RET_CREATOR / RET_META)) },
				minCohort: 300,
			},
			{
				breakdown: { type: "duckdb", sql: H5_SQL },
				select: { c: { where: { grp: "creator_partnerships" } }, m: { where: { grp: "meta_ads" } } },
				expect: { metric: "c.spend_per_retained / m.spend_per_retained", op: "between", target: band(r3(CPI_USD.creator_partnerships / CPI_USD.meta_ads / (RET_CREATOR / RET_META))) },
				minCohort: 300,
			},
		],
	},
	{
		id: "H6-creator-fair-share",
		hook: "H6",
		archetype: "temporal-inflection",
		narrative: `On ${D(FEE_CUT)} Murmur cuts its fee on Circles (paid creator subscriptions) from ${FEE_BEFORE * 100}% to ${FEE_AFTER * 100}% ("Creator Fair Share"). Creators who run a Circle (profile circle_enabled = true) post ${CIRCLE_POST_LIFT}x as often once a ${FEE_RAMP_DAYS}-day ramp is done; creators without a Circle are the control. Read: posts per day before the cut vs from ${D(FEE_RAMPED)}, creators who joined before ${D(DATASET_START)} (flat baseline activity), Circle creators' after/before over non-Circle creators' after/before = ${CIRCLE_POST_LIFT}.`,
		mixpanelReport: { type: "Insights", event: "post created", measure: "total", breakdown: "user property circle_enabled", filter: `user property account_type = creator, joined_date before ${D(DATASET_START)}`, chart: `weekly; before ${D(FEE_CUT)} vs from ${D(FEE_RAMPED)}` },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H6_DID_SQL },
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.did", op: "between", target: band(CIRCLE_POST_LIFT) },
				minCohort: 150,
			},
		],
	},
	{
		id: "H7-sound-awards-livestream",
		hook: "H7",
		archetype: "bespoke",
		narrative: `On Saturday ${D(AWARDS_DAY)} Murmur streams the Murmur Sound Awards. For that UTC day, posting, commenting, sharing, and story posting run at ${AWARDS_MULT}x (worldEvents volumeMultiplier, clones re-draw their properties); feed views are not part of the effect. Read: those four events per daily active member (any member-initiated event) on ${D(AWARDS_DAY)} over the mean of the Saturdays ${AWARDS_CONTROL_DAYS.join(", ")} = ${AWARDS_MULT}; "post viewed" per active member on the same days is the control (1.0).`,
		mixpanelReport: { type: "Insights", events: ["post created + comment posted + post shared + story posted", "any member-initiated event (uniques)"], formula: "A / B", chart: "daily line, August 15 - October 1" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H7_SQL },
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.post_lift", op: "between", target: band(AWARDS_MULT) },
				minCohort: 1000,
			},
			{
				breakdown: { type: "duckdb", sql: H7_SQL },
				select: { a: { where: { grp: "all" } } },
				// control: feed views were not part of the effect
				expect: { metric: "a.view_lift", op: "between", target: band(1) },
				minCohort: 1000,
			},
		],
	},
	{
		id: "H8-ad-load-increase",
		hook: "H8",
		archetype: "external-join",
		narrative: `On ${D(AD_LOAD_CHANGE)} Murmur raises ad load in the feed and in Clips: ${AD_LOAD_MULT}x the feed/Clips ad impressions per post viewed (Stories ads unchanged). The extra inventory sells for less: warehouse ad_revenue_daily shows eCPM at ${ECPM_AFTER_MULT}x its earlier level for every placement. Ad impressions exist in events; eCPM and revenue exist only in the warehouse, so revenue per 1,000 post views needs the join: ${AD_LOAD_MULT} x ${ECPM_AFTER_MULT} = ${r3(AD_LOAD_MULT * ECPM_AFTER_MULT)} of before. Read: the 4 weeks before (${D(AD_BEFORE_FROM)} to ${D(addDays(AD_LOAD_CHANGE, -1))}) vs ${D(AD_LOAD_CHANGE)} to ${D(DATASET_END)}, feed and Clips placements.`,
		mixpanelReport: { type: "Insights + warehouse", events: ["ad viewed (ad_placement in feed, clips)", "post viewed"], formula: "A / B", join: "ad_revenue_daily.ad_revenue_usd (feed, clips) per 1,000 post viewed", chart: "weekly; before vs after Sep 9" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H8_SQL },
				select: { a: { where: { grp: "after" } }, b: { where: { grp: "before" } } },
				expect: { metric: "a.ads_per_view / b.ads_per_view", op: "between", target: band(AD_LOAD_MULT) },
				minCohort: 3000,
			},
			{
				breakdown: { type: "duckdb", sql: H8_SQL },
				select: { a: { where: { grp: "after" } }, b: { where: { grp: "before" } } },
				expect: { metric: "a.revenue_per_1k_views / b.revenue_per_1k_views", op: "between", target: band(r3(AD_LOAD_MULT * ECPM_AFTER_MULT)) },
				minCohort: 3000,
			},
		],
	},
	{
		id: "H9-creator-first-post",
		hook: "H9",
		archetype: "funnel-ttc-by-segment",
		narrative: `Creators publish their first post fast. A new member's first "post created" comes a log-normal time after signup (median ${FIRST_POST_MEDIAN_H} h for personal accounts, capped at ${FIRST_POST_MAX_H} h) scaled by account type: creator ${FIRST_POST_FACTOR.creator}x, business ${FIRST_POST_FACTOR.business}x. Read: median hours from "account created" to the first "post created" within ${TTC_WINDOW_DAYS} days, signups through ${TTC_BIRTH_END.slice(0, 10)}, creator over personal = ${FIRST_POST_FACTOR.creator}.`,
		mixpanelReport: { type: "Funnels", steps: ["account created", "post created"], counting: "uniques", window: `${TTC_WINDOW_DAYS} days`, measure: "median time to convert", breakdown: "user property account_type", dateRange: `${D(DATASET_START)} to ${TTC_BIRTH_END.slice(0, 10)}` },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H9_SQL },
				select: { c: { where: { grp: "creator" } }, p: { where: { grp: "personal" } } },
				expect: { metric: "c.med_hours / p.med_hours", op: "between", target: band(FIRST_POST_FACTOR.creator) },
				minCohort: 250,
			},
		],
	},
	{
		id: "H10-circle-paywall-trigger",
		hook: "H10",
		archetype: "funnel-conversion-by-segment",
		narrative: `Fans meet a creator's Circle paywall in two places: tapping a locked (subscriber-only) post, or the Join button on the creator's profile. A locked-post paywall converts to "circle subscription started" ${LOCKED_POST_CONV}% of the time vs ${PROFILE_BUTTON_CONV}% from the profile button (two declared funnels; the subscription carries the paywall_trigger that led to it). Read: subscriptions per paywall view by paywall_trigger, locked_post over profile_button = ${r3(LOCKED_POST_CONV / PROFILE_BUTTON_CONV)}.`,
		mixpanelReport: { type: "Insights", events: ["circle subscription started", "circle paywall viewed"], formula: "A / B", breakdown: "paywall_trigger" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H10_SQL },
				select: { l: { where: { grp: "locked_post" } }, p: { where: { grp: "profile_button" } } },
				expect: { metric: "l.conversion / p.conversion", op: "between", target: band(r3(LOCKED_POST_CONV / PROFILE_BUTTON_CONV)) },
				minCohort: 1500,
			},
		],
	},
];

export default config;
