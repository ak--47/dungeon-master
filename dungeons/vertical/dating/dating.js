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
 * NAME:       Kindred
 * APP:        Mobile dating app (iOS, Android) for people who want a
 *             relationship: build a profile with photos and prompts, like or
 *             pass on profiles, match, open a chat, plan a date in the app, and
 *             rate the date afterwards ("date feedback"). Free plan plus
 *             Kindred+ ($29.99/month → $34.99 from 2026-08-18) and Kindred
 *             Premier ($49.99/month). Sparks are premium likes with a note.
 *             Verified Profiles (video selfie check) launches 2026-07-14.
 * SCALE:      10,000 simulated members (≈4,500 sign up inside the window;
 *             ≈1,700 of those never finish their profile and leave), ~0.70M
 *             events, 120 days (2026-06-04 → 2026-10-01, UTC)
 * CORE LOOP:  like sent → match created → conversation started → date planned
 *             → date feedback submitted
 * VALUE MOMENT: date planned
 *
 * EVENTS (21):
 *   app opened > like sent > profile passed > message sent > profile viewed
 *   > match created > paywall viewed > prompt edited > filters updated
 *   > boost activated > conversation started > $experiment_started
 *   > profile reported > account created > selfie verified > photos uploaded
 *   > date planned > profile completed > date feedback submitted
 *   > subscription started > subscription cancelled
 *
 * FUNNELS (7 declared):
 *   - Onboarding (first funnel, two copies by acquisition_channel, H6):
 *       account created → photos uploaded → profile completed (70%; TikTok 35%)
 *   - Discover (session, weight 16): app opened → selfie verified / like sent /
 *       profile passed / profile viewed (first-fixed; selfie verified is a
 *       template the hook keeps at most once per member, after launch, so
 *       adoption does not depend on how active a member is)
 *   - Chat (session, weight 14): app opened → message sent ×6 (first-fixed; a
 *       message with no open conversation never happens)
 *   - Conversation (weight 4): match created → conversation started → date
 *       planned → date feedback submitted (engine 100%; the everything hook builds every match
 *       from a like and decides each step, see below). Carries the Icebreakers
 *       experiment (multipliers 1.0; the hook applies the effect)
 *   - Upgrade (free members, weight 5): paywall viewed → subscription started (9%)
 *
 * USER PROPS:  market, age_band, gender, seeking, relationship_goal,
 *              photo_count, subscription_plan, acquisition_channel,
 *              member_since, verified, "Experiment: Icebreakers"
 * SUPER PROPS: subscription_plan (plan at event time), platform (ios/android,
 *              from the member's phone), market (sticky per member)
 * SCD PROPS:   none
 * GROUPS:      none
 * WAREHOUSE:   paid_acquisition_daily (spend by paid channel),
 *              chat_delivery_daily (message delivery health by platform),
 *              subscription_bookings_daily (new subscriptions, list price,
 *              bookings by plan and billing period)
 * LOOKUPS:     none — every attribute is denormalized onto events/profiles
 * SOUP:        Sunday-heavy dayOfWeekWeights; evening hourOfDayWeights for US
 *              time zones plus London and Toronto (UTC)
 *
 * IDENTITY: a new member is identified at "account created" (isAuthEvent, first
 * event, user_id + device_id). One device per member (avgDevicePerUser 1).
 * Every event carries user_id; there is no anonymous pre-signup activity. The
 * two onboarding steps after signup (photos uploaded, profile completed) carry
 * user_id only; every other event also carries device_id. platform agrees with
 * the engine's os field (iOS and iPadOS → ios, Android → android).
 *
 * DESIGN NOTES:
 * - Matches come from likes. For each like the hook draws a match with
 *   p = BASE_MATCH_RATE x photo keep (H2) x Spark multiplier (H3); a match lands
 *   2-40 s after the like (25%, the other member had already liked you) or a
 *   log-normal gap (median 6 h). Each match takes an engine Conversation unit
 *   (or a clone whose opener_type / venue_type are re-drawn) with its own
 *   match_id; unused units are dropped. The opener,
 *   the date plan, and the feedback are drawn per match (H4, H9, H10), with
 *   real gaps: opener after the match (hours_since_match), date plan days after
 *   the opener, feedback 1-7 days after the plan (days_until_date) plus 10-40 h.
 * - Matches per like also depend on gender (realism, not a story): x0.7 for
 *   men, x1.45 for women, x1.0 for nonbinary members. photo_count, Sparks, and
 *   plan are drawn independently of gender, so H2 and H3 reads are unaffected.
 * - Messages: "message sent" carries the match_id of an open conversation (the
 *   latest opener in the past 28 days); a message with no open conversation
 *   never happens. chat_delivery_daily counts "message sent" only (openers are
 *   not in it), which matches the H7 fault (openers were unaffected).
 * - Window start: established members have conversations already running.
 *   Each gets likes in the 28 days before June 4 at their in-window match
 *   rate, matched with the same gap as in-window likes (so some matches land
 *   on June 4-10); only the in-window steps remain, so June matches, openers,
 *   messages, and dates do not ramp from zero.
 * - Members who never finish their profile keep only their setup steps (they
 *   cannot like or chat before the profile is complete) and leave.
 * - Subscriptions: one purchase per member (the first would-be purchase
 *   decides, H8); paywall visits stop at that moment. 35% of paid members
 *   cancel during the window at a random moment (members paid before June 4
 *   from day one, new subscribers after 10 days); the plan reverts to free at
 *   the cancellation. The cancel event itself carries the plan being
 *   cancelled (subscription_plan = plan at t - 1 ms) on every cancel path.
 * - Reports: 80% of engine report events are kept (about 1 report per 40
 *   profile decisions before launch), then H1 thins fake-profile and scam reports.
 * - Warehouse drift: chat_delivery_daily adds messages from members who opted
 *   out of analytics (0-16% by day) and automated greetings / safety tips
 *   (about 115 a day per platform, ±60%); subscription_bookings_daily adds store
 *   purchases Mixpanel never received and same-day refunds; paid spend is a
 *   half paced budget (weekday shape, never zero) and half bid x the day's
 *   delivered signups, with seeded day noise.
 * - retentionCurve shapes new members' activity; established members' activity
 *   is flat across the window (DOW weights). Session funnels keep an active
 *   day's events to a few sessions.
 */

// ── HOOK STORIES ──
/*
 * All effects are hidden: no flag properties. Dates live in the TIMELINE
 * constants and are shared by hooks, stories, SQL, warehouse columns, and the
 * timeline guide.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H1. VERIFIED PROFILES LAUNCH (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: Verified Profiles launches 2026-07-14. 55% of members are adopters
 *   and verify in their next app session after a salted moment (existing
 *   members within 21 days of launch, new members within 48 h of signup), so
 *   about half of the members active after launch verify.
 *   Reports with reason fake_profile or scam fall on a 21-day ramp to 0.4x
 *   their pre-launch rate per profile decision; other reasons do not change.
 * MIXPANEL: Insights, profile reported (report_reason in fake_profile, scam)
 *   per 1,000 (like sent + profile passed), weekly; before Jul 14 vs from Aug 4.
 * REAL WORLD: verification deters catfish accounts and romance scammers.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H2. PHOTO COUNT SWEET SPOT (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: share of would-be matches kept by profile photo_count: 1-2 photos
 *   0.45, 3 photos 0.75, 4-6 photos 1.0, 7-9 photos 0.8.
 * MIXPANEL: Insights, match created / like sent, breakdown user property
 *   photo_count.
 * REAL WORLD: a few good photos earn trust; a long gallery reads as curated.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H3. SPARKS MATCH AT 3X (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: a Spark (like_type = spark) becomes a match 3x as often as a
 *   standard like; the match carries match_source = spark.
 * MIXPANEL: Insights, (match created where match_source = spark / like sent
 *   where like_type = spark) vs the same for standard likes.
 * REAL WORLD: a like with a note signals real interest.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H4. ICEBREAKERS EXPERIMENT (Conversation funnel experiment + everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-07-22 matched members split 50/50. Icebreakers (suggested
 *   openers) multiply the share of matches with an opener by 1.25 (60% →
 *   75%) and the match → opener time by 0.6; 45% of variant openers have
 *   opener_type = icebreaker.
 * MIXPANEL: Funnels, match created → conversation started, Totals counting,
 *   hold match_id constant, 7-day window, date range 2026-07-22 to 2026-09-24
 *   (matches with a full window), breakdown "Experiment: Icebreakers"; median
 *   time to convert. Or the Experiments report on $experiment_started.
 * REAL WORLD: a blank chat box is the hardest message to write.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H5. SUCCESS CHURN (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: after each date rated 4-5 stars, the member leaves the app with
 *   probability 0.45, 2-10 days later (paid members cancel, reason
 *   met_someone).
 * MIXPANEL: Retention, birth date feedback submitted (first time), breakdown
 *   rating, return app opened, custom bracket day 14-27.
 * REAL WORLD: a dating app that works loses the people it works for.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H6. PAID CHANNEL ECONOMICS (first funnels + warehouse paid_acquisition_daily;
 *     external-table join)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: spend per Mixpanel signup $7 TikTok, $14 Meta, $22 Apple Search
 *   Ads (half paced daily budget, half bid x delivered signups); TikTok signups finish their profile at 0.5x the
 *   rate of every other channel, so spend per completed profile is level
 *   between TikTok and Meta (1.0).
 * MIXPANEL: Insights, account created by acquisition_channel joined to
 *   paid_acquisition_daily.spend_usd; Funnels, account created → photos
 *   uploaded → profile completed, 7-day window, breakdown acquisition_channel.
 * REAL WORLD: cheap installs from a swipe-happy feed often never set up.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H7. ANDROID CHAT INCIDENT (everything + warehouse chat_delivery_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-08-24 to 2026-08-28, 60% of Android message sends in open
 *   conversations fail and never fire "message sent". Openers and iOS are
 *   untouched. The warehouse (which counts message sends) shows
 *   service_status = major_outage and delivery_failure_rate ≈ 0.6 for android
 *   on those days.
 * MIXPANEL: Insights, message sent, daily, breakdown platform; Android/iOS
 *   ratio on incident days vs 14 days either side; join the warehouse status.
 * REAL WORLD: a bad Android release looks like "people stopped talking".
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H8. KINDRED+ PRICE CHANGE (everything + warehouse subscription_bookings_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: on 2026-08-18 Kindred+ prices rise ~17%; Premier is unchanged.
 *   30% of would-be Kindred+ buyers decline, so Kindred+ purchases per paywall
 *   view are 0.7x and Kindred+ list-price bookings per view are 0.7 x 1.167 =
 *   0.817x.
 * MIXPANEL: Insights, subscription started (plan = plus) / paywall viewed,
 *   before vs after Aug 18; bookings need list_price_usd from the warehouse.
 * REAL WORLD: a price rise that loses more buyers than it gains per buyer.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H9. DATE SPEED BY RELATIONSHIP GOAL (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: opener → date plan time is 1.5x for long_term and 0.6x for
 *   short_term_fun, vs long_term_open and figuring_it_out (median 72 h).
 * MIXPANEL: Funnels, conversation started → date planned, Totals counting,
 *   hold match_id constant, 30-day window, date range 2026-06-04 to 2026-08-31,
 *   median time to convert, breakdown relationship_goal.
 * REAL WORLD: people looking for a partner take longer to commit to a first date.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H10. FAST OPENERS PLAN MORE DATES (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: the chance that an opener leads to a planned date declines
 *   smoothly (logistic, centered at 24 h, scale 6 h) with hours_since_match:
 *   about 34% for openers in the first hours, about 14% after two days.
 *   Averaged over the opener-delay distribution, openers within 24 h plan a
 *   date 32% of the time vs 16% for slower openers (0.5x).
 * MIXPANEL: Funnels, conversation started → date planned, Totals counting,
 *   hold match_id constant, 30-day window, date range 2026-06-04 to
 *   2026-08-31, breakdown hours_since_match (custom buckets ≤ 24, > 24).
 * REAL WORLD: momentum matters; a match that waits goes cold.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * EXPECTED METRICS SUMMARY (measured: data/verify-dating, 2026-10-07, full fidelity,
 * 10,000 members, 698,075 events)
 * ═════════════════════════════════════════════════════════════════════════
 * Hook | Metric                                        | Derivation              | Expected | Measured
 * -----|-----------------------------------------------|-------------------------|----------|---------
 * H1   | fake+scam reports / 1k decisions, after/before| FAKE_REPORT_KEEP        | 0.40     | 0.437 (10.60 → 4.63)
 * H1   | other reasons / 1k decisions (control)        | unchanged               | 1.00     | 1.035 (13.09 → 13.55)
 * H1   | selfie verified before launch                 | exact purity            | 0        | 0
 * H2   | matches per like, 1-2 photos / 4-6 photos     | PHOTO_MATCH_KEEP[1]     | 0.45     | 0.447 (9.4% vs 21.0%)
 * H2   | matches per like, 7-9 photos / 4-6 photos     | PHOTO_MATCH_KEEP[7]     | 0.80     | 0.783 (16.4% vs 21.0%)
 * H3   | Spark match rate / standard like match rate   | SPARK_MATCH_MULT        | 3.00     | 2.994 (49.2% vs 16.4%)
 * H4   | opener within 7 d per match, variant/control  | ICEBREAKER_CONV_MULT    | 1.25     | 1.268 (75.1% vs 59.2%)
 * H4   | median hours match → opener, variant/control  | ICEBREAKER_DELAY_MULT   | 0.60     | 0.590 (8.2 vs 13.9 h)
 * H4   | variant share of exposed members              | equal 2-arm hash        | 0.50     | 0.506
 * H4   | icebreaker openers in Control or pre-test     | exact purity            | 0        | 0
 * H5   | D14-27 retention, first date 4-5★ / 1-3★      | 1 − SUCCESS_CHURN_SHARE | 0.55     | 0.519 (46.6% vs 89.8%)
 * H6   | spend per signup, TikTok / Apple Search Ads   | 7 / 22                  | 0.318    | 0.296 ($6.71 vs $22.70)
 * H6   | 7-day profile completion, TikTok / others     | 35 / 70                 | 0.50     | 0.472 (33.5% vs 71.1%)
 * H6   | spend per completed profile, TikTok / Meta    | (7 / 0.5) / 14          | 1.00     | 0.981 ($20.01 vs $20.40)
 * H7   | Android/iOS message sends, incident / ±14 d   | 1 − CHAT_FAIL           | 0.40     | 0.370
 * H7   | warehouse delivery_failure_rate, incident     | CHAT_FAIL               | 0.60     | 0.598
 * H8   | Kindred+ purchases per paywall view, after/before | PLUS_KEEP_AFTER (≤, floor 0.85) | 0.70 | 0.655 (6.52% → 4.27%)
 * H8   | Kindred+ list-price bookings per view, after/before | 0.7 × 34.99/29.99 (≤, floor 0.908) | 0.817 | 0.762
 * H9   | median opener → date hours, long_term / base  | GOAL_TTC_MULT.long_term | 1.50     | 1.560 (109.7 h)
 * H9   | median opener → date hours, short_term_fun / base | GOAL_TTC_MULT.short_term_fun | 0.60 | 0.629 (44.3 h)
 * H10  | date planned within 30 d per opener, >24 h / ≤24 h | 0.16 / 0.32 (bucket averages of the logistic) | 0.50 | 0.477 (15.2% vs 31.9%)
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Noise notes: H8 rests on about 280 Kindred+ purchases after the change, so
 * its reads use the knob as target with a half-effect floor (STRONG above the
 * ±10% band, which can happen on other seeds); its bookings read also moves
 * with the billing-period mix. H7 rests on about 800 Android sends on incident
 * days (relative SE about 5%). H10's slow arm has about 450 dates (relative SE
 * about 5%). H6 spend per signup also moves with how many members each channel
 * delivered (half of spend is a fixed plan). Premier purchases per paywall view
 * are not engineered (2.42% → 2.45% across the price change, z = 0.15).
 */

// ── SCALE ──
const SEED = "meetcute";
const NUM_USERS = 10_000;
const DATASET_START = "2026-06-04T00:00:00Z";
const DATASET_END = "2026-10-01T23:59:59Z"; // 120 days
const EVENTS_PER_DAY = 1.2;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── TIMELINE (shared by hooks, stories, SQL, warehouse columns, guides) ──
const VERIFY_LAUNCH = "2026-07-14T00:00:00Z";       // Verified Profiles (video selfie check) launches
const ICEBREAKERS_START = "2026-07-22T00:00:00Z";   // "Icebreakers" A/B test starts in new-match chats
const PLUS_PRICE_CHANGE = "2026-08-18T00:00:00Z";   // Kindred+ list prices rise
const CHAT_INCIDENT_START = "2026-08-24T00:00:00Z"; // Android chat incident starts (replies in open chats fail)
const CHAT_INCIDENT_END = "2026-08-29T00:00:00Z";   // exclusive (5 days: Aug 24-28)

const ms = (iso) => dayjs.utc(iso).valueOf();
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;
const D0 = DATASET_START.slice(0, 10);
const WINDOW_DAYS = 120;

// ── WEEKLY AND DAILY RHYTHM (soup) ──
// Sun..Sat. Sunday evening is the busiest dating hour of the week; Friday and
// Saturday nights people are out, not swiping.
const DOW_WEIGHTS = [1.25, 1.08, 1.0, 1.0, 0.96, 0.8, 0.84];
// UTC hours. Members are mostly in US time zones (evening 19-23 local = 23-07
// UTC across ET..PT), with London and Toronto adding 17-23 UTC.
const HOUR_WEIGHTS = [1.0, 1.0, 0.96, 0.9, 0.78, 0.6, 0.42, 0.3, 0.22, 0.18, 0.18, 0.2,
	0.25, 0.3, 0.36, 0.42, 0.48, 0.55, 0.62, 0.68, 0.74, 0.8, 0.88, 0.95];

// ── KNOBS ──
// H1 Verified Profiles: fake-profile and scam reports fall as verification spreads
const VERIFY_ADOPT_SHARE = 0.55;    // share of members who adopt verification (salted per member)
const VERIFY_RAMP_DAYS = 21;        // existing members verify on a salted day in the 3 weeks after launch
const VERIFY_NEW_MEMBER_HOURS = 48; // members who join after launch verify within 2 days of signup
const FAKE_REPORT_KEEP = 0.4;       // share of fake-profile/scam reports left once the ramp is done
const FAKE_REASONS = ["fake_profile", "scam"];
const REPORT_KEEP = 0.8;            // realism: share of standalone report events kept (report rate per profile decision)

// H2 photo count sweet spot: share of would-be matches kept, by profile photo_count
const PHOTO_MATCH_KEEP = { 1: 0.45, 2: 0.45, 3: 0.75, 4: 1, 5: 1, 6: 1, 7: 0.8, 8: 0.8, 9: 0.8 };
const BASE_MATCH_RATE = 0.2;       // chance a standard like becomes a match (4-6 photos)
// realism (not a story): men's likes are returned less often than women's
const GENDER_MATCH_MULT = { man: 0.7, woman: 1.45, nonbinary: 1.0 };

// H3 Sparks (premium likes) match at 3x a standard like
const SPARK_MATCH_MULT = 3;
const SPARK_SHARE = { free: 0.03, plus: 0.07, premier: 0.12 }; // share of a member's likes sent as Sparks, by plan at the time

// match timing: some likes land on someone who already liked you (instant match)
const INSTANT_MATCH_SHARE = 0.25;
const MATCH_GAP_MEDIAN_H = 6;

// H4 Icebreakers experiment (new-match chat shows suggested openers)
const ICEBREAKERS_EXPERIMENT = "Icebreakers";
const ICEBREAKERS_VARIANT = "Icebreakers";
const EXP_KEY = `Experiment: ${ICEBREAKERS_EXPERIMENT}`;
const CONV_BASE = 0.6;              // share of matches where the member sends an opener
const ICEBREAKER_CONV_MULT = 1.25;
const ICEBREAKER_DELAY_MULT = 0.6;  // match → opener time
const ICEBREAKER_OPENER_SHARE = 0.45; // variant openers that use a suggested icebreaker
const OPENER_MEDIAN_H = 14;
const OPENER_SIGMA = 1.25;

// H5 success churn: a good first date takes members off the app
const SUCCESS_CHURN_SHARE = 0.45;   // chance a 4-5 star date takes the member off the app
const SUCCESS_CHURN_DAY_MIN = 2;
const SUCCESS_CHURN_DAY_MAX = 10;
const POSITIVE_RATING = 4;

// H6 paid acquisition (warehouse paid_acquisition_daily) + onboarding by channel
const PAID_CHANNELS = ["meta_ads", "tiktok_ads", "apple_search_ads"];
const CPI_USD = { meta_ads: 14, tiktok_ads: 7, apple_search_ads: 22 }; // window spend per Mixpanel signup
const CHANNEL_WEIGHTS = { organic: 30, referral: 12, meta_ads: 22, tiktok_ads: 22, apple_search_ads: 14 };
const ONBOARD_CONV = 70;
const TIKTOK_ONBOARD_MULT = 0.5;
const ONBOARD_TTC_H = 2;
const BORN_PCT = 45;
const DAILY_BUDGET_USD = Object.fromEntries(PAID_CHANNELS.map((ch) => {
	const totalW = Object.values(CHANNEL_WEIGHTS).reduce((a, b) => a + b, 0);
	return [ch, CPI_USD[ch] * (NUM_USERS * BORN_PCT / 100) * (CHANNEL_WEIGHTS[ch] / totalW) / WINDOW_DAYS];
}));
const SPEND_FLAT_SHARE = 0.4;
const SPEND_WEEKDAY = (() => {
	const m = DOW_WEIGHTS.reduce((a, b) => a + b, 0) / DOW_WEIGHTS.length;
	return DOW_WEIGHTS.map((w) => SPEND_FLAT_SHARE + (1 - SPEND_FLAT_SHARE) * w / m);
})();
const SPEND_NOISE = 0.12;
// install-optimized campaigns: half of each day's spend is the paced plan, half
// follows the installs the network delivered that day (bid x delivered signups)
const SPEND_PLAN_SHARE = 0.5;
const PLATFORM_INSTALL_INFLATION = 1.18; // ad networks claim more installs than Mixpanel signups
const CPC_USD = { meta_ads: 1.6, tiktok_ads: 0.9, apple_search_ads: 2.4 };
const CTR = { meta_ads: 0.011, tiktok_ads: 0.008, apple_search_ads: 0.06 };

// H7 Android chat incident (warehouse chat_delivery_daily)
const CHAT_FAIL = 0.6;              // share of Android sends that fail during the incident
const UNTRACKED_MESSAGE_SHARE = 0.08; // mean share of delivered messages from members who opted out of analytics (varies 0-16% by day)
const SYSTEM_MESSAGES_PER_DAY = { ios: 120, android: 110 }; // automated match greetings and safety tips (±60% by day)

// H8 Kindred+ price change (warehouse subscription_bookings_daily)
const PRICES = {
	plus: { "1_month": [29.99, 34.99], "3_month": [74.99, 86.99], "6_month": [119.99, 139.99] },
	premier: { "1_month": [49.99, 49.99], "3_month": [119.99, 119.99], "6_month": [179.99, 179.99] },
};
const PLUS_KEEP_AFTER = 0.7;        // share of would-be Kindred+ purchases kept after the change
const UPGRADE_CONV = 9;            // share of free members' paywall visits that end in a purchase
const CANCEL_SHARE = 0.35;          // paid members who cancel during the window (first eligible cancel event)
const CANCEL_MIN_DAYS = 10;
const STORE_UNTRACKED_SHARE = 0.12; // plan-days with one store purchase Mixpanel never received
const REFUND_SHARE = 0.05;          // plan-days with one same-day refund

// H9 time from first message to a planned date, by relationship goal
const DATE_GAP_MEDIAN_H = 72;
const DATE_GAP_SIGMA = 0.5;
const GOAL_TTC_MULT = { long_term: 1.5, long_term_open: 1, figuring_it_out: 1, short_term_fun: 0.6 };

// H10 fast openers plan more dates: the date rate declines smoothly (logistic)
// around FAST_OPENER_HOURS. DATE_RATE_FAST / DATE_RATE_SLOW are the average rates
// of openers within / after FAST_OPENER_HOURS (the knob, ratio 0.5); the curve's
// plateaus are solved from the opener-delay distribution so the bucket averages
// land on them.
const FAST_OPENER_HOURS = 24;
const DATE_RATE_FAST = 0.32;
const DATE_RATE_SLOW = 0.16;
const DATE_RATE_SOFTNESS_H = 6;     // logistic scale: most of the decline happens between ~12 h and ~36 h
const OPENER_MAX_H = 14 * 24;
const dateCurveShape = (h) => 1 / (1 + Math.exp((h - FAST_OPENER_HOURS) / DATE_RATE_SOFTNESS_H));
const [DATE_RATE_EARLY, DATE_RATE_LATE] = (() => {
	// integrate the curve shape over the log-normal opener delay (Control arm; the
	// Icebreakers arm's shorter delays move the plateaus by < 0.003)
	let nF = 0, sF = 0, nS = 0, sS = 0;
	const N = 4000;
	for (let i = 0; i < N; i++) {
		const z = -6 + 12 * (i + 0.5) / N;
		const w = Math.exp(-z * z / 2);
		const h = Math.min(OPENER_MAX_H, OPENER_MEDIAN_H * Math.exp(OPENER_SIGMA * z));
		if (h <= FAST_OPENER_HOURS) { nF += w; sF += w * dateCurveShape(h); } else { nS += w; sS += w * dateCurveShape(h); }
	}
	const span = (DATE_RATE_FAST - DATE_RATE_SLOW) / (sF / nF - sS / nS);
	const late = DATE_RATE_SLOW - span * (sS / nS);
	return [late + span, late];
})();
const dateRate = (h) => DATE_RATE_LATE + (DATE_RATE_EARLY - DATE_RATE_LATE) * dateCurveShape(h);
const FEEDBACK_RATE = 0.8;
const CONV_OPEN_DAYS = 28;          // a conversation takes follow-up messages for 4 weeks

// window start: established members have conversations already running
const PREWINDOW_DAYS = 28;
const NONCOMPLETER_DAYS = 4;        // members who never finish their profile browse for a few days, then leave

// ── DATA ──
const weighted = (obj) => Object.entries(obj).flatMap(([k, w]) => Array(w).fill(isNaN(Number(k)) ? k : Number(k)));
const MARKETS = { "New York": 20, "Los Angeles": 14, Chicago: 10, Austin: 7, "San Francisco": 7, "Washington DC": 7, Boston: 6, Miami: 6, Seattle: 6, Denver: 5, London: 7, Toronto: 5 };
const PHOTO_WEIGHTS = { 1: 4, 2: 8, 3: 14, 4: 20, 5: 20, 6: 16, 7: 8, 8: 6, 9: 4 };
const GOAL_WEIGHTS = { long_term: 32, long_term_open: 25, figuring_it_out: 23, short_term_fun: 20 };
const RATING_WEIGHTS = { 1: 6, 2: 10, 3: 22, 4: 34, 5: 28 };
const OPENER_TYPE_WEIGHTS = { text: 55, prompt_reply: 35, voice_note: 10 };
const VENUE_WEIGHTS = { drinks: 38, coffee: 26, dinner: 16, activity: 14, video_call: 6 };

// ── HELPERS ──
const salt = (uid, tag) => hashFloat(`${uid}|${tag}`);
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
const T = (e) => dayjs.utc(e.time).valueOf();
const iso = (t) => new Date(t).toISOString();
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const byT = (a, b) => T(a) - T(b);
const logNormal = (sigma) => Math.exp(chance.normal({ mean: 0, dev: sigma }));
const jitter = (key, spread) => 1 + (hashFloat(key) - 0.5) * 2 * spread;
const inChatIncident = (t) => t >= ms(CHAT_INCIDENT_START) && t < ms(CHAT_INCIDENT_END);
const price = (plan, period, t) => (PRICES[plan]?.[period] ?? [0, 0])[t >= ms(PLUS_PRICE_CHANGE) ? 1 : 0];
const paidSpend = (date, ch, signups) => round2((SPEND_PLAN_SHARE * DAILY_BUDGET_USD[ch] * SPEND_WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()]
	+ (1 - SPEND_PLAN_SHARE) * CPI_USD[ch] * signups) * jitter(`spend|${date}|${ch}`, SPEND_NOISE));
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
const UNIT_STEPS = ["match created", "conversation started", "date planned", "date feedback submitted"];
const ONBOARDING = new Set(["account created", "photos uploaded", "profile completed"]);
const BROWSE_ONLY = new Set(["app opened", "profile viewed"]);

function handleUserHook(profile, meta) {
	const uid = profile.distinct_id;
	const g = profile.gender;
	profile.seeking = g === "man"
		? (salt(uid, "seek") < 0.93 ? "women" : salt(uid, "seek2") < 0.5 ? "men" : "everyone")
		: g === "woman"
			? (salt(uid, "seek") < 0.88 ? "men" : salt(uid, "seek2") < 0.5 ? "women" : "everyone")
			: "everyone";
	if (meta.userIsBornInDataset) {
		profile.subscription_plan = "free";
		profile.member_since = dayKey(dayjs.utc(profile.created ?? meta.user.created).valueOf());
		return profile;
	}
	const tenureDays = Math.floor(salt(uid, "tenure") * (ms(DATASET_START) - ms("2024-01-01T00:00:00Z")) / DAY_MS);
	profile.member_since = dayjs.utc("2024-01-01T00:00:00Z").add(tenureDays, "day").format("YYYY-MM-DD");
	profile.subscription_plan = pickWeighted({ free: 76, plus: 17, premier: 7 }, salt(uid, "plan"));
	return profile;
}

function handleEverything(events, meta) {
	if (!events.length) return events;
	const profile = meta.profile;
	const uid = profile.distinct_id;
	const BEGIN = ms(DATASET_START), END = ms(DATASET_END);
	const signup = events.find((e) => e.event === "account created");
	const birthMs = signup ? T(signup) : null;

	// ── platform: the member's phone (one device per member) ──
	const osEv = events.find((e) => e.device_id && e.os) || events.find((e) => e.os);
	const platform = osEv && osEv.os === "Android" ? "android" : "ios";
	// a cancellation carries the plan being cancelled; events after it carry free
	const stampPlan = (evs, planAt) => {
		for (const e of evs) {
			e.platform = platform;
			const t = T(e);
			e.subscription_plan = planAt(e.event === "subscription cancelled" ? t - 1 : t);
		}
	};

	// ── members who never finish their profile browse briefly, then leave ──
	if (signup && !events.some((e) => e.event === "profile completed")) {
		const lim = birthMs + NONCOMPLETER_DAYS * DAY_MS;
		events = events.filter((e) => ONBOARDING.has(e.event) || (BROWSE_ONLY.has(e.event) && T(e) < lim));
		if (profile[EXP_KEY] !== undefined) delete profile[EXP_KEY];
		profile.subscription_plan = "free";
		profile.verified = false;
		stampPlan(events, () => "free");
		return events;
	}

	// ── subscriptions: one purchase; H8 Kindred+ price change; cancellations ──
	const initialPlan = profile.subscription_plan || "free";
	// the member's first would-be purchase decides: after the Kindred+ price
	// change, a share of would-be Plus buyers decline and do not buy in the window.
	// Paywall visits stop at that moment either way, so paywall traffic is the
	// same with or without the price change.
	const firstBuy = events.filter((e) => e.event === "subscription started").sort(byT)[0] || null;
	const decideT = firstBuy ? T(firstBuy) : Infinity;
	let purchase = firstBuy;
	if (firstBuy && firstBuy.plan === "plus" && decideT >= ms(PLUS_PRICE_CHANGE) && salt(uid, "plus-price") >= PLUS_KEEP_AFTER) purchase = null;
	const cancelEvents = events.filter((e) => e.event === "subscription cancelled").sort(byT);
	const cancelTemplate = cancelEvents[0] || null;
	const paidFrom = initialPlan !== "free" ? BEGIN : purchase ? T(purchase) : null;
	let cancel = null;
	if (paidFrom !== null && salt(uid, "cancel") < CANCEL_SHARE) {
		// a steady hazard: any of the member's eligible cancel moments, not the first
		// (members paid before the window can cancel from day one; new subscribers after a first stretch)
		const eligible = cancelEvents.filter((e) => T(e) >= (paidFrom === BEGIN ? BEGIN : paidFrom + CANCEL_MIN_DAYS * DAY_MS));
		cancel = eligible.length ? eligible[Math.floor(salt(uid, "cancel-pick") * eligible.length)] : null;
	}
	const buyT = purchase ? T(purchase) : Infinity;
	events = events.filter((e) => {
		if (e.event === "subscription started") return e === purchase;
		if (e.event === "subscription cancelled") return e === cancel;
		if (e.event === "paywall viewed" && T(e) > decideT) return false;
		return true;
	});
	let cancelT = cancel ? T(cancel) : Infinity;
	const planAt = (t) => (t >= cancelT ? "free" : t >= buyT ? purchase.plan : initialPlan);

	// ── like types: Sparks by plan at the time ──
	// each member's own Spark habit scatters around their plan's allowance (x0.5-1.5)
	const likes = events.filter((e) => e.event === "like sent").sort(byT);
	const sparkHabit = 0.5 + salt(uid, "spark-habit");
	for (const l of likes) {
		l.like_type = hashFloat(`${l.insert_id}|spark`) < (SPARK_SHARE[planAt(T(l))] ?? SPARK_SHARE.free) * sparkHabit ? "spark" : "standard";
	}

	// ── conversation units (match → opener → date → feedback), one per match ──
	const pool = new Map();
	const templates = {};
	const exposures = [];
	for (const e of events) {
		if (e.event === "$experiment_started") { exposures.push(e); continue; }
		if (!UNIT_STEPS.includes(e.event)) continue;
		if (!templates[e.event]) templates[e.event] = { ...e }; // a copy: pool events are mutated below
		if (!pool.has(e.match_id)) pool.set(e.match_id, {});
		pool.get(e.match_id)[e.event] = e;
	}
	const poolUnits = [...pool.values()];
	const haveTemplates = UNIT_STEPS.every((s) => templates[s]);
	const variant = (exposures.length && profile[EXP_KEY] !== undefined) ? profile[EXP_KEY] : null;

	// H2 + H3: which likes become matches
	const photoKeep = PHOTO_MATCH_KEEP[profile.photo_count] ?? 1;
	const genderMult = GENDER_MATCH_MULT[profile.gender] ?? 1;
	const slots = [];
	if (haveTemplates) {
		const matchGap = () => (chance.bool({ likelihood: INSTANT_MATCH_SHARE * 100 })
			? chance.integer({ min: 2, max: 40 }) * 1000
			: Math.floor(Math.min(7 * DAY_MS, MATCH_GAP_MEDIAN_H * HOUR_MS * logNormal(1.0))));
		for (const l of likes) {
			const spark = l.like_type === "spark";
			const p = Math.min(0.95, BASE_MATCH_RATE * genderMult * photoKeep * (spark ? SPARK_MATCH_MULT : 1));
			if (!chance.bool({ likelihood: p * 100 })) continue;
			slots.push({ matchT: T(l) + matchGap(), source: spark ? "spark" : "like" });
		}
		// established members: likes sent in the 4 weeks before the window keep
		// matching (some land in the first days of June), so matches and the
		// conversations behind them are already running at the window start
		if (!signup && slots.length) {
			const nIn = slots.length;
			const x = nIn * PREWINDOW_DAYS / WINDOW_DAYS;
			const n = Math.floor(x) + (chance.bool({ likelihood: (x % 1) * 100 }) ? 1 : 0);
			for (let i = 0; i < n; i++) {
				const likeT = BEGIN - Math.floor(chance.floating({ min: 0, max: PREWINDOW_DAYS }) * DAY_MS);
				const source = slots[chance.integer({ min: 0, max: nIn - 1 })].source;
				slots.push({ matchT: likeT + matchGap(), source, pre: true });
			}
		}
	}

	// per-match pipeline
	const goalMult = GOAL_TTC_MULT[profile.relationship_goal] ?? 1;
	const plans = slots.map((s) => {
		const isIce = variant === ICEBREAKERS_VARIANT && s.matchT >= ms(ICEBREAKERS_START);
		const enrolled = variant !== null && s.matchT >= ms(ICEBREAKERS_START);
		const delayH = Math.min(OPENER_MAX_H, OPENER_MEDIAN_H * logNormal(OPENER_SIGMA) * (isIce ? ICEBREAKER_DELAY_MULT : 1));
		const convT = s.matchT + delayH * HOUR_MS;
		const hasConv = chance.bool({ likelihood: CONV_BASE * (isIce ? ICEBREAKER_CONV_MULT : 1) * 100 });
		const opener = isIce && chance.bool({ likelihood: ICEBREAKER_OPENER_SHARE * 100 }) ? "icebreaker" : null;
		const hasDate = hasConv && chance.bool({ likelihood: dateRate(delayH) * 100 });
		const dateGapH = DATE_GAP_MEDIAN_H * logNormal(DATE_GAP_SIGMA) * goalMult;
		const dateT = convT + dateGapH * HOUR_MS;
		const daysUntil = chance.integer({ min: 1, max: 7 });
		const hasFb = hasDate && chance.bool({ likelihood: FEEDBACK_RATE * 100 });
		const fbT = dateT + daysUntil * DAY_MS + chance.integer({ min: 10 * 60, max: 40 * 60 }) * MIN_MS;
		const rating = Number(chance.weighted(Object.keys(RATING_WEIGHTS), Object.values(RATING_WEIGHTS)));
		const again = rating >= POSITIVE_RATING ? chance.bool({ likelihood: 80 }) : chance.bool({ likelihood: 8 });
		return { ...s, isIce, enrolled, delayH, convT, hasConv, opener, hasDate, dateT, daysUntil, hasFb, fbT, rating, again };
	});

	// H5: success churn — after each good date (4-5 stars) the member leaves the
	// app with probability SUCCESS_CHURN_SHARE, 2-10 days later. The earliest
	// such date ends their activity.
	let cut = Infinity;
	for (const p of plans.filter((x) => x.hasFb && x.fbT >= BEGIN && x.fbT <= END).sort((a, b) => a.fbT - b.fbT)) {
		if (p.fbT >= cut) break;
		if (p.rating >= POSITIVE_RATING && chance.bool({ likelihood: SUCCESS_CHURN_SHARE * 100 })) {
			// whole milliseconds: event times are ISO strings with ms precision
			cut = Math.floor(p.fbT + chance.floating({ min: SUCCESS_CHURN_DAY_MIN, max: SUCCESS_CHURN_DAY_MAX }) * DAY_MS);
			break;
		}
	}

	// materialize units
	const unitEvents = [];
	const conversations = []; // { id, convT }
	let poolIdx = 0;
	for (const p of plans) {
		if (p.matchT >= cut) continue;
		const src = poolUnits[poolIdx++] || null;
		const id = src && src["match created"] ? src["match created"].match_id : `m_${chance.hash({ length: 12 })}`;
		const put = (step, t, set) => {
			if (t >= cut) return;
			const base = src && src[step];
			let ev = base;
			if (!ev) {
				// more matches than engine units: clone a template and re-draw its free-form props
				ev = cloneEvent(templates[step], { time: iso(t) });
				if (step === "conversation started") ev.opener_type = pickWeighted(OPENER_TYPE_WEIGHTS, chance.floating({ min: 0, max: 1 }));
				if (step === "date planned") ev.venue_type = pickWeighted(VENUE_WEIGHTS, chance.floating({ min: 0, max: 1 }));
			}
			ev.time = iso(t);
			ev.match_id = id;
			Object.assign(ev, set);
			unitEvents.push(ev);
		};
		put("match created", p.matchT, { match_source: p.source });
		if (!p.hasConv) continue;
		const convSet = { hours_since_match: round1(p.delayH) };
		if (p.opener) convSet.opener_type = p.opener;
		put("conversation started", p.convT, convSet);
		if (p.convT < cut) conversations.push({ id, convT: p.convT });
		if (!p.hasDate) continue;
		put("date planned", p.dateT, { days_until_date: p.daysUntil });
		if (!p.hasFb) continue;
		put("date feedback submitted", p.fbT, { rating: p.rating, would_meet_again: p.again });
	}
	events = events.filter((e) => !UNIT_STEPS.includes(e.event) && e.event !== "$experiment_started");

	// H5 cut on everything else; a paid member cancels when they leave
	if (cut < Infinity) {
		events = events.filter((e) => T(e) < cut || ONBOARDING.has(e.event));
		if (planAt(cut) !== "free" && cancelTemplate) {
			let tc = cut - chance.integer({ min: 30, max: 24 * 60 }) * MIN_MS;
			// a member who bought in the last day before leaving cancels after the purchase
			if (buyT < cut && tc <= buyT) tc = buyT + Math.floor((cut - buyT) / 2);
			events = events.filter((e) => e.event !== "subscription cancelled");
			const c = cancel || cloneEvent(cancelTemplate, { time: iso(tc) });
			c.time = iso(tc);
			c.cancel_reason = "met_someone";
			events.push(c);
			cancel = c;
			cancelT = T(c);
		}
	}

	// ── messages: follow-ups in open conversations (a message with no open
	// conversation never happens) ──
	conversations.sort((a, b) => a.convT - b.convT);
	events = events.filter((e) => {
		if (e.event !== "message sent") return true;
		const t = T(e);
		if (t >= cut) return false;
		let hit = null;
		for (let i = conversations.length - 1; i >= 0; i--) {
			const c = conversations[i];
			if (c.convT <= t && t < c.convT + CONV_OPEN_DAYS * DAY_MS) { hit = c; break; }
		}
		if (!hit) return false;
		e.match_id = hit.id;
		// H7: Android sends fail during the incident
		if (platform === "android" && inChatIncident(t) && chance.bool({ likelihood: CHAT_FAIL * 100 })) return false;
		return true;
	});

	// ── H1: reports; fake-profile and scam reports fall after Verified Profiles ──
	const launch = ms(VERIFY_LAUNCH);
	events = events.filter((e) => {
		if (e.event !== "profile reported") return true;
		if (!chance.bool({ likelihood: REPORT_KEEP * 100 })) return false;
		const t = T(e);
		if (FAKE_REASONS.includes(e.report_reason) && t >= launch) {
			const keep = 1 - (1 - FAKE_REPORT_KEEP) * Math.min(1, (t - launch) / (VERIFY_RAMP_DAYS * DAY_MS));
			return chance.bool({ likelihood: keep * 100 });
		}
		return true;
	});

	// ── Verified Profiles adoption: one selfie check per adopter, after launch ──
	const selfies = events.filter((e) => e.event === "selfie verified");
	let verifiedEv = null;
	if (selfies.length && salt(uid, "verify") < VERIFY_ADOPT_SHARE) {
		const adoptT = birthMs && birthMs >= launch
			? birthMs + salt(uid, "verify-day") * VERIFY_NEW_MEMBER_HOURS * HOUR_MS
			: launch + salt(uid, "verify-day") * VERIFY_RAMP_DAYS * DAY_MS;
		// verified in the next app session after the adoption moment
		const session = events.filter((e) => e.event === "app opened" && T(e) >= adoptT && T(e) < adoptT + VERIFY_RAMP_DAYS * DAY_MS).sort(byT)[0];
		if (session) {
			verifiedEv = selfies[0];
			verifiedEv.time = iso(T(session) + chance.integer({ min: 20, max: 600 }) * 1000);
		}
	}
	events = events.filter((e) => e.event !== "selfie verified" || e === verifiedEv);
	profile.verified = Boolean(verifiedEv);

	// ── experiment exposure: one per match after the test starts, 1 s before it ──
	const exposed = [];
	if (variant !== null) {
		const matches = unitEvents.filter((e) => e.event === "match created" && T(e) >= ms(ICEBREAKERS_START)).sort(byT);
		matches.forEach((m, i) => {
			const t = T(m) - 1000;
			const ex = exposures[i] || cloneEvent(exposures[0], { time: iso(t) });
			ex.time = iso(t);
			exposed.push(ex);
		});
	}
	if (!exposed.length && profile[EXP_KEY] !== undefined) delete profile[EXP_KEY];

	// conversations already running at the window start keep only their in-window steps
	events = events.concat(unitEvents, exposed).filter((e) => T(e) >= BEGIN);
	stampPlan(events, planAt);
	profile.subscription_plan = planAt(END);
	return events;
}

// warehouse rows: exogenous business facts layered on event-derived volumes
function handleWarehouse(row, meta) {
	if (meta.isBackfill) return row;
	if (meta.metricName === "paid_acquisition_daily") {
		// the source count (Mixpanel paid signups that day) becomes spend; network
		// clicks, impressions, and claimed installs follow the spend
		const k = `${row.date}|${row.acquisition_channel}`;
		const spend = paidSpend(row.date, row.acquisition_channel, row.spend_usd);
		row.spend_usd = spend;
		row.installs_reported = Math.round(spend * PLATFORM_INSTALL_INFLATION / CPI_USD[row.acquisition_channel] * jitter(`inst|${k}`, 0.2));
		row.clicks = Math.round(spend / (CPC_USD[row.acquisition_channel] * jitter(`cpc|${k}`, 0.15)));
		row.impressions = Math.round(row.clicks / (CTR[row.acquisition_channel] * jitter(`ctr|${k}`, 0.15)));
		return row;
	}
	if (meta.metricName === "chat_delivery_daily") {
		const k = `${row.date}|${row.platform}`;
		row.messages_delivered = Math.round(row.messages_delivered * (1 + UNTRACKED_MESSAGE_SHARE * jitter(`untracked|${k}`, 1))
			+ (SYSTEM_MESSAGES_PER_DAY[row.platform] ?? 0) * jitter(`system|${k}`, 0.6));
		row.messages_attempted = Math.round(row.messages_delivered / (1 - row.delivery_failure_rate));
		return row;
	}
	if (meta.metricName === "subscription_bookings_daily") {
		const k = `${row.date}|${row.plan}|${row.billing_period}`;
		let subs = row.new_subscriptions;
		if (hashFloat(`store|${k}`) < STORE_UNTRACKED_SHARE) subs += 1;
		if (subs > 0 && hashFloat(`refund|${k}`) < REFUND_SHARE) subs -= 1;
		row.new_subscriptions = subs;
		row.gross_bookings_usd = round2(subs * row.list_price_usd);
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
	stickyEventProps: ["market"],

	events: [
		{
			event: "account created",
			weight: 1,
			isFirstEvent: true,
			isAuthEvent: true,
			properties: {
				signup_method: { __weights: { apple: 40, phone: 35, google: 25 } },
				acquisition_channel: (ctx) => ctx.profile.acquisition_channel,
			},
		},
		{
			event: "photos uploaded",
			weight: 1,
			isStrictEvent: true,
			properties: {
				photo_count: (ctx) => ctx.profile.photo_count,
			},
		},
		{
			event: "profile completed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				photo_count: (ctx) => ctx.profile.photo_count,
				prompts_answered: [1, 2, 3, 3, 3, 3],
				relationship_goal: (ctx) => ctx.profile.relationship_goal,
			},
		},
		{
			event: "app opened",
			weight: 1,
			isStrictEvent: true,
			properties: {
				open_source: { __weights: { organic: 55, push_notification: 35, widget: 10 } },
			},
		},
		{
			event: "profile viewed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				view_source: { __weights: { discover: 60, likes_you: 25, standouts: 15 } },
			},
		},
		{
			event: "like sent",
			weight: 1,
			isStrictEvent: true,
			properties: {
				like_type: ["standard"],
				liked_content: { __weights: { photo: 50, prompt: 40, voice_prompt: 10 } },
			},
		},
		{
			event: "profile passed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				view_source: { __weights: { discover: 75, likes_you: 15, standouts: 10 } },
			},
		},
		{
			event: "match created",
			weight: 1,
			isStrictEvent: true,
			properties: {
				match_id: ["unassigned"],
				match_source: ["like"],
			},
		},
		{
			event: "conversation started",
			weight: 1,
			isStrictEvent: true,
			properties: {
				match_id: ["unassigned"],
				hours_since_match: [0],
				opener_type: { __weights: OPENER_TYPE_WEIGHTS },
			},
		},
		{
			event: "message sent",
			weight: 1,
			isStrictEvent: true,
			properties: {
				match_id: ["unassigned"],
				message_type: { __weights: { text: 82, photo: 7, voice_note: 6, gif: 5 } },
			},
		},
		{
			event: "date planned",
			weight: 1,
			isStrictEvent: true,
			properties: {
				match_id: ["unassigned"],
				venue_type: { __weights: VENUE_WEIGHTS },
				days_until_date: [1],
			},
		},
		{
			event: "date feedback submitted",
			weight: 1,
			isStrictEvent: true,
			properties: {
				match_id: ["unassigned"],
				rating: [3],
				would_meet_again: [false],
			},
		},
		{
			event: "paywall viewed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				paywall_trigger: { __weights: { out_of_likes: 40, likes_you: 30, spark: 15, boost: 10, profile_tab: 5 } },
			},
		},
		{
			event: "subscription started",
			weight: 1,
			isStrictEvent: true,
			properties: {
				plan: ["plus"],
				billing_period: ["1_month"],
			},
		},
		{
			event: "subscription cancelled",
			weight: 1,
			properties: {
				cancel_reason: { __weights: { too_expensive: 30, not_enough_matches: 28, taking_a_break: 22, bad_experience: 10, met_someone: 10 } },
			},
		},
		{
			event: "selfie verified",
			weight: 1,
			isStrictEvent: true,
			properties: {
				verification_method: ["video_selfie"],
				attempts: [1, 1, 1, 1, 2, 2, 3],
			},
		},
		{
			event: "profile reported",
			weight: 2,
			properties: {
				report_reason: { __weights: { fake_profile: 28, scam: 17, harassment: 20, inappropriate_photos: 15, spam: 12, offline_behavior: 8 } },
			},
		},
		{
			event: "boost activated",
			weight: 2,
			properties: {
				boost_source: { __weights: { purchased: 60, included_in_plan: 40 } },
				boost_minutes: [30, 30, 60],
			},
		},
		{
			event: "filters updated",
			weight: 2,
			properties: {
				filter_changed: ["age_range", "distance", "distance", "height", "religion", "family_plans", "drinking"],
			},
		},
		{
			event: "prompt edited",
			weight: 2,
			properties: {
				prompt_category: ["about_me", "my_type", "getting_personal", "date_vibes", "self_care"],
			},
		},
		{
			event: "$experiment_started",
			weight: 1,
			isStrictEvent: true,
			properties: {
				"Experiment name": [ICEBREAKERS_EXPERIMENT],
				"Variant name": ["Control", ICEBREAKERS_VARIANT],
			},
		},
	],

	funnels: [
		{
			name: "Onboarding",
			sequence: ["account created", "photos uploaded", "profile completed"],
			isFirstFunnel: true,
			conditions: { acquisition_channel: { neq: "tiktok_ads" } },
			conversionRate: ONBOARD_CONV,
			timeToConvert: ONBOARD_TTC_H,
			order: "sequential",
			weight: 1,
		},
		{
			name: "Onboarding",
			sequence: ["account created", "photos uploaded", "profile completed"],
			isFirstFunnel: true,
			conditions: { acquisition_channel: "tiktok_ads" },
			conversionRate: Math.round(ONBOARD_CONV * TIKTOK_ONBOARD_MULT),
			timeToConvert: ONBOARD_TTC_H,
			order: "sequential",
			weight: 1,
		},
		{
			// a swiping session: open the app, like and pass on profiles
			name: "Discover",
			// (selfie verified rides along as a template so nearly every member has
			// one; the hook keeps at most one per member, after launch, and drops the rest)
			sequence: ["app opened", "selfie verified", "like sent", "profile passed", "like sent", "profile viewed", "profile passed", "profile passed"],
			conversionRate: 55,
			timeToConvert: 0.4,
			order: "first-fixed",
			weight: 16,
		},
		{
			// a chat session: open the app, reply in open conversations
			name: "Chat",
			sequence: ["app opened", "message sent", "message sent", "message sent", "message sent", "message sent", "message sent"],
			conversionRate: 60,
			timeToConvert: 0.6,
			order: "first-fixed",
			weight: 14,
		},
		{
			name: "Conversation",
			sequence: UNIT_STEPS,
			conversionRate: 100,
			timeToConvert: 1,
			order: "sequential",
			weight: 4,
			props: {
				match_id: () => `m_${chance.hash({ length: 12 })}`,
			},
			experiment: {
				name: ICEBREAKERS_EXPERIMENT,
				startDaysBeforeEnd: (ms(DATASET_END) - ms(ICEBREAKERS_START)) / DAY_MS,
				variants: [{ name: "Control" }, { name: ICEBREAKERS_VARIANT }],
			},
		},
		{
			name: "Upgrade",
			sequence: ["paywall viewed", "subscription started"],
			conditions: { subscription_plan: "free" },
			conversionRate: UPGRADE_CONV,
			timeToConvert: 0.5,
			order: "sequential",
			weight: 5,
			props: {
				plan: { __weights: { plus: 72, premier: 28 } },
				billing_period: { __weights: { "1_month": 58, "3_month": 27, "6_month": 15 } },
			},
		},
	],

	warehouseMetrics: [
		{
			name: "paid_acquisition_daily",
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
				// set by the warehouse hook from the day's spend
				installs_reported: 0,
				clicks: 0,
				impressions: 0,
			},
		},
		{
			name: "chat_delivery_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "message sent",
				measure: "count",
				groupBy: "platform",
			},
			timeColumn: "date",
			valueColumn: "messages_delivered",
			columns: {
				messages_attempted: 0,
				delivery_failure_rate: (ctx) => {
					const hit = ctx.row.platform === "android" && inChatIncident(ctx.time);
					const j = hashFloat(`fail|${dayKey(ctx.time)}|${ctx.seriesKey}`);
					return hit ? round2(CHAT_FAIL + (j - 0.5) * 0.04) : Math.round((0.002 + j * 0.008) * 10000) / 10000;
				},
				p95_send_latency_ms: (ctx) => {
					const hit = ctx.row.platform === "android" && inChatIncident(ctx.time);
					const j = hashFloat(`lat|${dayKey(ctx.time)}|${ctx.seriesKey}`);
					return hit ? Math.round(9000 + j * 6000) : Math.round(380 + j * 260);
				},
				service_status: (ctx) => (ctx.row.platform === "android" && inChatIncident(ctx.time) ? "major_outage" : "operational"),
			},
		},
		{
			name: "subscription_bookings_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "subscription started",
				measure: "count",
				groupBy: ["plan", "billing_period"],
			},
			timeColumn: "date",
			valueColumn: "new_subscriptions",
			columns: {
				list_price_usd: (ctx) => price(ctx.row.plan, ctx.row.billing_period, ctx.time),
				gross_bookings_usd: (ctx) => round2(ctx.value * price(ctx.row.plan, ctx.row.billing_period, ctx.time)),
			},
		},
	],

	superProps: {
		subscription_plan: ["free"],
		platform: ["ios"],
		market: ["New York"],
	},

	userProps: {
		market: weighted(MARKETS),
		age_band: { __weights: { "18-24": 22, "25-29": 30, "30-34": 24, "35-39": 13, "40-49": 9, "50+": 2 } },
		gender: { __weights: { man: 54, woman: 43, nonbinary: 3 } },
		seeking: ["women"],
		relationship_goal: weighted(GOAL_WEIGHTS),
		photo_count: weighted(PHOTO_WEIGHTS),
		subscription_plan: ["free"],
		acquisition_channel: weighted(CHANNEL_WEIGHTS),
		member_since: ["2025-01-01"],
		verified: [false],
	},

	personas: [
		{ name: "serial_swiper", weight: 25, eventMultiplier: 1.8 },
		{ name: "intentional_dater", weight: 45, eventMultiplier: 1.0 },
		{ name: "casual_browser", weight: 30, eventMultiplier: 0.5 },
	],

	retentionCurve: { type: "logarithmic", day1: 0.65, day7: 0.45, day30: 0.3 },

	hook(record, type, meta) {
		if (type === "user") return handleUserHook(record, meta);
		if (type === "everything") return handleEverything(record, meta);
		if (type === "warehouse") return handleWarehouse(record, meta);
		return record;
	},
};

// ── STORIES ──────────────────────────────────────────────────────────────
// Machine-checkable contract for hooks H1-H10. Evaluate with:
//   node dungeons/vertical/dating/dating.verify.mjs

const EV = `read_json_auto('{{PREFIX}}-EVENTS*.json*', sample_size=-1, union_by_name=true)`;
const US = `read_json_auto('{{PREFIX}}-USERS*.json*', sample_size=-1, union_by_name=true)`;
const WH = (table) => `read_json_auto('{{PREFIX}}-WAREHOUSE-${table}.json*', sample_size=-1, union_by_name=true)`;

// Identity prelude: a device resolves to the member seen with it on any event
// that carries both ids (emitted stitch evidence). Every Kindred event carries
// user_id, so the device map only matters for completeness.
const ID_CTE = `dmap AS (SELECT device_id, min(user_id::VARCHAR) AS mapped FROM ${EV}
  WHERE user_id IS NOT NULL AND device_id IS NOT NULL GROUP BY 1),
ev AS (SELECT coalesce(e.user_id::VARCHAR, m.mapped) AS uid, e.time::TIMESTAMP AS t, e.*
  FROM ${EV} e LEFT JOIN dmap m ON e.device_id = m.device_id)`;

const TS = (iso) => dayjs.utc(iso).format("YYYY-MM-DD HH:mm:ss");
const D = (iso) => iso.slice(0, 10);
const band = (k) => [Math.round(k * 0.9 * 1000) / 1000, Math.round(k * 1.1 * 1000) / 1000];
const SQL_LIST = (xs) => xs.map((x) => `'${x}'`).join(", ");
const VERIFY_RAMPED = TS(dayjs.utc(VERIFY_LAUNCH).add(VERIFY_RAMP_DAYS, "day").toISOString());
const EXP_WINDOW_DAYS = 7;           // H4 read: Funnels conversion window match → opener
const EXP_READ_END = TS(dayjs.utc(DATASET_END).subtract(EXP_WINDOW_DAYS, "day").toISOString()); // matches with a full window
const DATE_WINDOW_DAYS = 30;         // H9/H10 read: Funnels conversion window opener → date (Mixpanel default)
const DATE_READ_END = "2026-09-01 00:00:00"; // conversations through Aug 31 have their full window
const RET_FROM = 14, RET_TO = 28;    // H5 read: app opened on day 14-27 after the first date feedback
const RET_BIRTH_END = TS(dayjs.utc(DATASET_END).subtract(RET_TO, "day").toISOString());
const INC_BASE_DAYS = 14;           // H7 read: baseline days either side of the incident
const INC_BASE_FROM = TS(dayjs.utc(CHAT_INCIDENT_START).subtract(INC_BASE_DAYS, "day").toISOString());
const INC_BASE_TO = TS(dayjs.utc(CHAT_INCIDENT_END).add(INC_BASE_DAYS, "day").toISOString());
const PLUS_PRICE_RATIO = PRICES.plus["1_month"][1] / PRICES.plus["1_month"][0];
const BASE_GOALS = ["long_term_open", "figuring_it_out"];
const photoBand = (col) => `CASE WHEN ${col} <= 2 THEN '1-2' WHEN ${col} = 3 THEN '3' WHEN ${col} <= 6 THEN '4-6' ELSE '7-9' END`;

const H1_SQL = `WITH ${ID_CTE},
w AS (SELECT CASE WHEN t < TIMESTAMP '${TS(VERIFY_LAUNCH)}' THEN 'before' WHEN t >= TIMESTAMP '${VERIFY_RAMPED}' THEN 'after' END AS per, event, report_reason, uid FROM ev
  WHERE event IN ('profile reported', 'like sent', 'profile passed')),
g AS (SELECT per, count(DISTINCT uid) AS users,
  1000.0 * count(*) FILTER (WHERE event = 'profile reported' AND report_reason IN (${SQL_LIST(FAKE_REASONS)})) / count(*) FILTER (WHERE event <> 'profile reported') AS fake_rate,
  1000.0 * count(*) FILTER (WHERE event = 'profile reported' AND report_reason NOT IN (${SQL_LIST(FAKE_REASONS)})) / count(*) FILTER (WHERE event <> 'profile reported') AS other_rate
  FROM w WHERE per IS NOT NULL GROUP BY 1)
SELECT 'all' AS grp, min(users) AS user_count,
 max(fake_rate) FILTER (WHERE per = 'after') / max(fake_rate) FILTER (WHERE per = 'before') AS fake_ratio,
 max(other_rate) FILTER (WHERE per = 'after') / max(other_rate) FILTER (WHERE per = 'before') AS other_ratio
FROM g`;

const H2_SQL = `WITH ${ID_CTE},
u AS (SELECT distinct_id::VARCHAR AS uid, photo_count FROM ${US})
SELECT ${photoBand("u.photo_count")} AS grp, count(DISTINCT ev.uid) AS user_count,
 count(*) FILTER (WHERE event = 'match created')::DOUBLE / count(*) FILTER (WHERE event = 'like sent') AS match_rate
FROM ev JOIN u ON u.uid = ev.uid WHERE event IN ('match created', 'like sent') GROUP BY 1`;

const H4_SQL = `WITH ${ID_CTE},
v AS (SELECT distinct_id::VARCHAR AS uid, "${EXP_KEY}" AS variant FROM ${US} WHERE "${EXP_KEY}" IS NOT NULL),
m AS (SELECT uid, match_id, t AS t0 FROM ev WHERE event = 'match created' AND t >= TIMESTAMP '${TS(ICEBREAKERS_START)}' AND t < TIMESTAMP '${EXP_READ_END}'),
c AS (SELECT match_id, min(t) AS t1, any_value(hours_since_match) AS h FROM ev WHERE event = 'conversation started' GROUP BY 1)
SELECT v.variant AS grp, count(DISTINCT m.uid) AS user_count, count(*) AS matches,
 avg(coalesce(c.t1 >= m.t0 AND c.t1 < m.t0 + INTERVAL ${EXP_WINDOW_DAYS} DAY, false)::INT) AS conv,
 median(c.h) FILTER (WHERE c.t1 >= m.t0 AND c.t1 < m.t0 + INTERVAL ${EXP_WINDOW_DAYS} DAY) AS med_hours
FROM m JOIN v ON v.uid = m.uid LEFT JOIN c ON c.match_id = m.match_id GROUP BY 1`;

const H6_SQL = `WITH ${ID_CTE},
s AS (SELECT uid, t AS t0, acquisition_channel AS ch FROM ev WHERE event = 'account created'),
c AS (SELECT s.uid FROM s JOIN ev e ON e.uid = s.uid AND e.event = 'profile completed' AND e.t >= s.t0 AND e.t < s.t0 + INTERVAL 7 DAY GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM ${WH("paid_acquisition_daily")} GROUP BY 1),
g AS (SELECT s.ch, count(*) AS signups, count(c.uid) AS completed FROM s LEFT JOIN c ON c.uid = s.uid GROUP BY 1)
SELECT g.ch AS grp, g.signups AS user_count, g.completed::DOUBLE / g.signups AS completion,
 sp.spend / g.signups AS spend_per_signup, sp.spend / g.completed AS spend_per_completed
FROM g LEFT JOIN sp ON sp.ch = g.ch
UNION ALL
SELECT 'non_tiktok' AS grp, sum(signups)::BIGINT AS user_count, sum(completed)::DOUBLE / sum(signups) AS completion, NULL, NULL FROM g WHERE ch <> 'tiktok_ads'`;

const H8_SQL = `WITH ${ID_CTE},
p AS (SELECT DISTINCT date::DATE AS d, plan, billing_period, list_price_usd FROM ${WH("subscription_bookings_daily")}),
w AS (SELECT CASE WHEN t >= TIMESTAMP '${TS(PLUS_PRICE_CHANGE)}' THEN 'after' ELSE 'before' END AS per, ev.event, ev.plan, ev.uid, p.list_price_usd
  FROM ev LEFT JOIN p ON ev.event = 'subscription started' AND p.d = ev.t::DATE AND p.plan = ev.plan AND p.billing_period = ev.billing_period
  WHERE ev.event IN ('paywall viewed', 'subscription started'))
SELECT per AS grp, count(DISTINCT uid) AS user_count, count(*) FILTER (WHERE event = 'paywall viewed') AS paywall_views,
 count(*) FILTER (WHERE event = 'subscription started' AND plan = 'plus')::DOUBLE / count(*) FILTER (WHERE event = 'paywall viewed') AS plus_rate,
 count(*) FILTER (WHERE event = 'subscription started' AND plan = 'premier')::DOUBLE / count(*) FILTER (WHERE event = 'paywall viewed') AS premier_rate,
 sum(list_price_usd) FILTER (WHERE event = 'subscription started' AND plan = 'plus') / count(*) FILTER (WHERE event = 'paywall viewed') AS plus_bookings_per_view
FROM w GROUP BY 1`;

const H9_SQL = `WITH ${ID_CTE},
c AS (SELECT match_id, any_value(uid) AS uid, min(t) AS t1 FROM ev WHERE event = 'conversation started' AND t < TIMESTAMP '${DATE_READ_END}' GROUP BY 1),
d AS (SELECT match_id, min(t) AS t2 FROM ev WHERE event = 'date planned' GROUP BY 1),
x AS (SELECT u.relationship_goal AS goal, c.uid, date_diff('second', c.t1, d.t2) / 3600.0 AS hours
  FROM c JOIN d ON d.match_id = c.match_id JOIN ${US} u ON u.distinct_id::VARCHAR = c.uid
  WHERE d.t2 >= c.t1 AND d.t2 < c.t1 + INTERVAL ${DATE_WINDOW_DAYS} DAY)
SELECT goal AS grp, count(DISTINCT uid) AS user_count, count(*) AS dates, median(hours) AS med_hours FROM x GROUP BY 1
UNION ALL
SELECT 'baseline' AS grp, count(DISTINCT uid) AS user_count, count(*) AS dates, median(hours) AS med_hours FROM x WHERE goal IN (${SQL_LIST(BASE_GOALS)})`;

/** @type {import("../../../types").DungeonStory[]} */
export const stories = [
	{
		id: "H1-verified-profiles-launch",
		hook: "H1",
		archetype: "temporal-inflection",
		narrative: `Verified Profiles (a video-selfie check) launches ${D(VERIFY_LAUNCH)}. ${VERIFY_ADOPT_SHARE * 100}% of members are adopters and verify in their next app session after a salted moment (existing members within ${VERIFY_RAMP_DAYS} days of launch, members who join later within ${VERIFY_NEW_MEMBER_HOURS} hours of signup), so about half of the members active after launch verify. As verification spreads, reports with reason fake_profile or scam fall on a ${VERIFY_RAMP_DAYS}-day ramp to ${FAKE_REPORT_KEEP}x their pre-launch rate per profile decision (like sent + profile passed); harassment, inappropriate photos, spam, and offline-behavior reports do not change. Read: fake/scam reports per 1,000 decisions after the ramp (from ${VERIFY_RAMPED.slice(0, 10)}) vs before launch; the other reasons are the control. No selfie verified event exists before launch.`,
		mixpanelReport: { type: "Insights", events: ["profile reported (report_reason in fake_profile, scam)", "like sent", "profile passed"], formula: "1000 * A / (B + C)", chart: "weekly line; before Jul 14 vs from Aug 4" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H1_SQL },
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.fake_ratio", op: "between", target: band(FAKE_REPORT_KEEP) },
				minCohort: 2000,
			},
			{
				breakdown: { type: "duckdb", sql: H1_SQL },
				select: { a: { where: { grp: "all" } } },
				// control: report reasons verification does not address
				expect: { metric: "a.other_ratio", op: "between", target: band(1) },
				minCohort: 2000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count, count(*) FILTER (WHERE t < TIMESTAMP '${TS(VERIFY_LAUNCH)}') AS early FROM ev WHERE event = 'selfie verified'`,
				},
				select: { a: { where: { grp: "all" } } },
				// exact: a verification before the launch is a bug
				expect: { metric: "a.early", op: "between", target: [0, 0] },
			},
		],
	},
	{
		id: "H2-photo-count-sweet-spot",
		hook: "H2",
		archetype: "cohort-prop-scale",
		narrative: `Profiles with 4-6 photos get the most matches per like. The share of would-be matches kept by profile photo_count: 1-2 photos ${PHOTO_MATCH_KEEP[1]}, 3 photos ${PHOTO_MATCH_KEEP[3]}, 4-6 photos 1.0, 7-9 photos ${PHOTO_MATCH_KEEP[7]} (too many photos reads as over-curated). photo_count is drawn independently of activity, plan, and Sparks, so matches per like by photo band reads the keep share directly.`,
		mixpanelReport: { type: "Insights", events: ["match created", "like sent"], formula: "A / B", breakdown: "user property photo_count" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H2_SQL },
				select: { lo: { where: { grp: "1-2" } }, s: { where: { grp: "4-6" } } },
				expect: { metric: "lo.match_rate / s.match_rate", op: "between", target: band(PHOTO_MATCH_KEEP[1]) },
				minCohort: 800,
			},
			{
				breakdown: { type: "duckdb", sql: H2_SQL },
				select: { hi: { where: { grp: "7-9" } }, s: { where: { grp: "4-6" } } },
				expect: { metric: "hi.match_rate / s.match_rate", op: "between", target: band(PHOTO_MATCH_KEEP[7]) },
				minCohort: 800,
			},
		],
	},
	{
		id: "H3-sparks-match-rate",
		hook: "H3",
		archetype: "cohort-prop-scale",
		narrative: `A Spark (a premium like with a note; like_type = spark) becomes a match ${SPARK_MATCH_MULT}x as often as a standard like. Members get Sparks by plan (about ${SPARK_SHARE.free * 100}% of a Free member's likes, ${SPARK_SHARE.plus * 100}% on Kindred+, ${SPARK_SHARE.premier * 100}% on Premier); the match carries match_source = spark when the like was a Spark. Read: matches from Sparks per Spark sent over matches from standard likes per standard like.`,
		mixpanelReport: { type: "Insights", events: ["match created (match_source = spark)", "like sent (like_type = spark)", "match created (match_source = like)", "like sent (like_type = standard)"], formula: "(A / B) / (C / D)" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) FILTER (WHERE event = 'like sent' AND like_type = 'spark') AS user_count,
 count(*) FILTER (WHERE event = 'match created' AND match_source = 'spark')::DOUBLE / count(*) FILTER (WHERE event = 'like sent' AND like_type = 'spark') AS spark_rate,
 count(*) FILTER (WHERE event = 'match created' AND match_source = 'like')::DOUBLE / count(*) FILTER (WHERE event = 'like sent' AND like_type = 'standard') AS standard_rate
FROM ev WHERE event IN ('match created', 'like sent')`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.spark_rate / a.standard_rate", op: "between", target: band(SPARK_MATCH_MULT) },
				minCohort: 1500,
			},
		],
	},
	{
		id: "H4-icebreakers-experiment",
		hook: "H4",
		archetype: "experiment-lift",
		narrative: `The "${ICEBREAKERS_EXPERIMENT}" test starts ${D(ICEBREAKERS_START)}: members who get a match are split 50/50 (sticky per member; exposure $experiment_started 1 s before each new match). In the "${ICEBREAKERS_VARIANT}" arm the new-match chat suggests openers: the share of matches where the member sends an opener rises ${ICEBREAKER_CONV_MULT}x (from ${CONV_BASE * 100}%), the time from match to opener is ${ICEBREAKER_DELAY_MULT}x, and about ${ICEBREAKER_OPENER_SHARE * 100}% of variant openers use a suggestion (opener_type = icebreaker, which never appears in Control or before the test). Read: per-match conversion match created → conversation started within ${EXP_WINDOW_DAYS} days (matches ${D(ICEBREAKERS_START)} to ${EXP_READ_END.slice(0, 10)}, so every match has its full window), and median hours_since_match on the opener.`,
		mixpanelReport: { type: "Funnels", steps: ["match created", "conversation started"], counting: "totals", holdPropertyConstant: "match_id", window: `${EXP_WINDOW_DAYS} days`, dateRange: `${D(ICEBREAKERS_START)} to ${EXP_READ_END.slice(0, 10)}`, breakdown: `user property "${EXP_KEY}"`, measure: "conversion and median time to convert" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H4_SQL },
				select: { v: { where: { grp: ICEBREAKERS_VARIANT } }, c: { where: { grp: "Control" } } },
				expect: { metric: "v.conv / c.conv", op: "between", target: band(ICEBREAKER_CONV_MULT) },
				minCohort: 1500,
			},
			{
				breakdown: { type: "duckdb", sql: H4_SQL },
				select: { v: { where: { grp: ICEBREAKERS_VARIANT } }, c: { where: { grp: "Control" } } },
				expect: { metric: "v.med_hours / c.med_hours", op: "between", target: band(ICEBREAKER_DELAY_MULT) },
				minCohort: 1500,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 count(DISTINCT uid) FILTER (WHERE "Variant name" = '${ICEBREAKERS_VARIANT}')::DOUBLE / count(DISTINCT uid) AS variant_share
FROM ev WHERE event = '$experiment_started'`,
				},
				select: { a: { where: { grp: "all" } } },
				// equal-weight 2-arm hash → 0.5
				expect: { metric: "a.variant_share", op: "between", target: band(0.5) },
				minCohort: 2000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
v AS (SELECT distinct_id::VARCHAR AS uid, "${EXP_KEY}" AS variant FROM ${US})
SELECT 'all' AS grp, count(DISTINCT ev.uid) AS user_count,
 count(*) FILTER (WHERE opener_type = 'icebreaker' AND (t < TIMESTAMP '${TS(ICEBREAKERS_START)}' OR v.variant IS DISTINCT FROM '${ICEBREAKERS_VARIANT}')) AS impure
FROM ev LEFT JOIN v ON v.uid = ev.uid WHERE event = 'conversation started'`,
				},
				select: { a: { where: { grp: "all" } } },
				// exact: suggested openers exist only in the variant after the start
				expect: { metric: "a.impure", op: "between", target: [0, 0] },
			},
		],
	},
	{
		id: "H5-success-churn",
		hook: "H5",
		archetype: "retention-divergence",
		narrative: `Kindred's best outcome looks like churn: after each date rated ${POSITIVE_RATING}-5 stars in "date feedback submitted", the member leaves the app with probability ${SUCCESS_CHURN_SHARE} (met someone), ${SUCCESS_CHURN_DAY_MIN}-${SUCCESS_CHURN_DAY_MAX} days later; a paid member cancels with reason met_someone. Read: members grouped by the rating on their FIRST date feedback (in the window, on or before ${RET_BIRTH_END.slice(0, 10)} so the return bracket is complete); retained = any "app opened" on day ${RET_FROM}-${RET_TO - 1} after it. Later dates can take either group off the app the same way, so the ratio of retention (4-5 stars over 1-3 stars) reads 1 - ${SUCCESS_CHURN_SHARE}.`,
		mixpanelReport: { type: "Retention", birth: "date feedback submitted (first time)", return: "app opened", breakdown: "birth-event property rating (4-5 vs 1-3)", brackets: `custom: day ${RET_FROM}-${RET_TO - 1}`, dateRange: `births ${D0} to ${RET_BIRTH_END.slice(0, 10)}` },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
f AS (SELECT uid, t AS f0, rating, row_number() OVER (PARTITION BY uid ORDER BY t, insert_id) AS rn FROM ev WHERE event = 'date feedback submitted'),
f1 AS (SELECT * FROM f WHERE rn = 1 AND f0 <= TIMESTAMP '${RET_BIRTH_END}'),
r AS (SELECT f1.uid, bool_or(e.event = 'app opened' AND e.t >= f1.f0 + INTERVAL ${RET_FROM} DAY AND e.t < f1.f0 + INTERVAL ${RET_TO} DAY) AS ret
  FROM f1 LEFT JOIN ev e ON e.uid = f1.uid GROUP BY 1)
SELECT CASE WHEN f1.rating >= ${POSITIVE_RATING} THEN 'positive' ELSE 'negative' END AS grp, count(*) AS user_count, avg(coalesce(r.ret, false)::INT) AS retention
FROM f1 JOIN r ON r.uid = f1.uid GROUP BY 1`,
				},
				select: { p: { where: { grp: "positive" } }, n: { where: { grp: "negative" } } },
				expect: { metric: "p.retention / n.retention", op: "between", target: band(1 - SUCCESS_CHURN_SHARE) },
				minCohort: 400,
			},
		],
	},
	{
		id: "H6-paid-channel-economics",
		hook: "H6",
		archetype: "funnel-conversion-by-segment",
		narrative: `TikTok is Kindred's cheapest paid channel per signup and its weakest at onboarding. Warehouse paid_acquisition_daily bills install-optimized campaigns: each day ${SPEND_PLAN_SHARE * 100}% of spend is a paced budget (cost per signup x expected signups per day, a weekday shape above a ${SPEND_FLAT_SHARE * 100}% flat floor) and ${(1 - SPEND_PLAN_SHARE) * 100}% is the bid x that day's delivered signups, with seeded ±${SPEND_NOISE * 100}% day noise: $${CPI_USD.tiktok_ads} TikTok, $${CPI_USD.meta_ads} Meta, $${CPI_USD.apple_search_ads} Apple Search Ads per Mixpanel signup over the window. TikTok signups finish their profile (account created → photos uploaded → profile completed, 7 days) at ${TIKTOK_ONBOARD_MULT}x the rate of every other channel (${Math.round(ONBOARD_CONV * TIKTOK_ONBOARD_MULT)}% vs ${ONBOARD_CONV}%; two declared first funnels with acquisition_channel conditions). Spend per completed profile therefore comes out level between TikTok and Meta: (${CPI_USD.tiktok_ads} / ${TIKTOK_ONBOARD_MULT}) / ${CPI_USD.meta_ads} = ${(CPI_USD.tiktok_ads / TIKTOK_ONBOARD_MULT / CPI_USD.meta_ads).toFixed(2)}.`,
		mixpanelReport: { type: "Insights + Funnels + warehouse", event: "account created", breakdown: "acquisition_channel", join: "paid_acquisition_daily.spend_usd", funnel: "account created → photos uploaded → profile completed, 7-day window, breakdown acquisition_channel" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H6_SQL },
				select: { t: { where: { grp: "tiktok_ads" } }, a: { where: { grp: "apple_search_ads" } } },
				expect: { metric: "t.spend_per_signup / a.spend_per_signup", op: "between", target: band(CPI_USD.tiktok_ads / CPI_USD.apple_search_ads) },
				minCohort: 400,
			},
			{
				breakdown: { type: "duckdb", sql: H6_SQL },
				select: { t: { where: { grp: "tiktok_ads" } }, o: { where: { grp: "non_tiktok" } } },
				expect: { metric: "t.completion / o.completion", op: "between", target: band(Math.round(ONBOARD_CONV * TIKTOK_ONBOARD_MULT) / ONBOARD_CONV) },
				minCohort: 400,
			},
			{
				breakdown: { type: "duckdb", sql: H6_SQL },
				select: { t: { where: { grp: "tiktok_ads" } }, m: { where: { grp: "meta_ads" } } },
				expect: { metric: "t.spend_per_completed / m.spend_per_completed", op: "between", target: band(Math.round(CPI_USD.tiktok_ads / TIKTOK_ONBOARD_MULT / CPI_USD.meta_ads * 1000) / 1000) },
				minCohort: 400,
			},
		],
	},
	{
		id: "H7-android-chat-incident",
		hook: "H7",
		archetype: "bespoke",
		narrative: `From ${D(CHAT_INCIDENT_START)} to ${D(CHAT_INCIDENT_END)} (exclusive) a fault in the Android app makes ${CHAT_FAIL * 100}% of Android message sends in open conversations fail; a failed send never fires "message sent". Openers (conversation started) and iOS are untouched. The incident days and platform come from warehouse chat_delivery_daily (service_status = 'major_outage', delivery_failure_rate ≈ ${CHAT_FAIL}). Event read: Android/iOS ratio of "message sent" on incident days vs the ${INC_BASE_DAYS} days either side (cancels weekday mix and the trend) reads 1 - ${CHAT_FAIL}.`,
		mixpanelReport: { type: "Insights", event: "message sent", measure: "total", breakdown: "platform", chart: "daily line", join: "warehouse chat_delivery_daily.service_status" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
o AS (SELECT DISTINCT date::DATE AS d, platform FROM ${WH("chat_delivery_daily")} WHERE service_status = 'major_outage'),
od AS (SELECT DISTINCT d FROM o), op AS (SELECT DISTINCT platform FROM o),
w AS (SELECT t::DATE AS d, uid, (platform IN (SELECT platform FROM op)) AS hit FROM ev
  WHERE event = 'message sent' AND t >= TIMESTAMP '${INC_BASE_FROM}' AND t < TIMESTAMP '${INC_BASE_TO}'),
g AS (SELECT (d IN (SELECT d FROM od)) AS outage, count(*) FILTER (WHERE hit)::DOUBLE / count(*) FILTER (WHERE NOT hit) AS rel, count(DISTINCT uid) AS users FROM w GROUP BY 1)
SELECT 'all' AS grp, (SELECT count(*) FROM od) AS outage_days, min(users) AS user_count,
 max(rel) FILTER (WHERE outage) / max(rel) FILTER (WHERE NOT outage) AS did
FROM g`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.did", op: "between", target: band(1 - CHAT_FAIL) },
				minCohort: 300,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT 'all' AS grp, count(*) FILTER (WHERE service_status = 'major_outage') AS outage_rows,
 avg(delivery_failure_rate) FILTER (WHERE service_status = 'major_outage') AS outage_fail
FROM ${WH("chat_delivery_daily")}`,
				},
				select: { a: { where: { grp: "all" } } },
				// warehouse failure rate during the incident = the failure knob
				expect: { metric: "a.outage_fail", op: "between", target: band(CHAT_FAIL) },
			},
		],
	},
	{
		id: "H8-plus-price-change",
		hook: "H8",
		archetype: "temporal-inflection",
		narrative: `On ${D(PLUS_PRICE_CHANGE)} Kindred+ list prices rise (1 month $${PRICES.plus["1_month"][0]} → $${PRICES.plus["1_month"][1]}; 3 and 6 months by the same ~${Math.round((PLUS_PRICE_RATIO - 1) * 100)}%); Premier prices do not change. Each free member's first would-be purchase decides: after the change, ${(1 - PLUS_KEEP_AFTER) * 100}% of would-be Kindred+ buyers decline and do not buy in the window, so Kindred+ purchases per paywall view fall to ${PLUS_KEEP_AFTER}x. Paywall traffic and Premier conversion per view have no engineered change. Prices exist only in warehouse subscription_bookings_daily, so Kindred+ bookings per paywall view need the join: ${PLUS_KEEP_AFTER} x ${PLUS_PRICE_RATIO.toFixed(3)} = ${(PLUS_KEEP_AFTER * PLUS_PRICE_RATIO).toFixed(3)} of before (the price rise does not pay for the lost buyers). Kindred+ purchases after the change number in the low hundreds, so the reads use the knob as target with a half-effect floor.`,
		mixpanelReport: { type: "Insights + warehouse", events: ["subscription started (plan = plus)", "paywall viewed"], formula: "A / B", chart: "before vs after Aug 18", join: "subscription_bookings_daily.list_price_usd on date, plan, billing_period" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H8_SQL },
				select: { a: { where: { grp: "after" } }, b: { where: { grp: "before" } } },
				expect: { metric: "a.plus_rate / b.plus_rate", op: "<=", target: PLUS_KEEP_AFTER, floor: 1 - 0.5 * (1 - PLUS_KEEP_AFTER) },
				minCohort: 1500,
			},
			{
				breakdown: { type: "duckdb", sql: H8_SQL },
				select: { a: { where: { grp: "after" } }, b: { where: { grp: "before" } } },
				expect: { metric: "a.plus_bookings_per_view / b.plus_bookings_per_view", op: "<=", target: Math.round(PLUS_KEEP_AFTER * PLUS_PRICE_RATIO * 1000) / 1000, floor: Math.round((1 - 0.5 * (1 - PLUS_KEEP_AFTER * PLUS_PRICE_RATIO)) * 1000) / 1000 },
				minCohort: 1500,
			},
		],
	},
	{
		id: "H9-date-speed-by-goal",
		hook: "H9",
		archetype: "funnel-ttc-by-segment",
		narrative: `How fast a conversation turns into a planned date depends on what the member is looking for (profile relationship_goal): the gap from "conversation started" to "date planned" is ${GOAL_TTC_MULT.long_term}x for long_term and ${GOAL_TTC_MULT.short_term_fun}x for short_term_fun, vs long_term_open and figuring_it_out (base median ${DATE_GAP_MEDIAN_H} h, log-normal). Every step of a match shares match_id. Read: median hours from opener to date plan, per match, within a ${DATE_WINDOW_DAYS}-day window, conversations through ${DATE_READ_END.slice(0, 10)} (complete windows).`,
		mixpanelReport: { type: "Funnels", steps: ["conversation started", "date planned"], counting: "totals", holdPropertyConstant: "match_id", window: `${DATE_WINDOW_DAYS} days`, dateRange: `${D0} to 2026-08-31`, measure: "median time to convert", breakdown: "user property relationship_goal" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H9_SQL },
				select: { l: { where: { grp: "long_term" } }, b: { where: { grp: "baseline" } } },
				expect: { metric: "l.med_hours / b.med_hours", op: "between", target: band(GOAL_TTC_MULT.long_term) },
				minCohort: 400,
			},
			{
				breakdown: { type: "duckdb", sql: H9_SQL },
				select: { s: { where: { grp: "short_term_fun" } }, b: { where: { grp: "baseline" } } },
				expect: { metric: "s.med_hours / b.med_hours", op: "between", target: band(GOAL_TTC_MULT.short_term_fun) },
				minCohort: 200,
			},
		],
	},
	{
		id: "H10-fast-openers",
		hook: "H10",
		archetype: "funnel-conversion-by-segment",
		narrative: `Momentum matters: the chance that an opener leads to "date planned" declines smoothly with hours_since_match (logistic centered at ${FAST_OPENER_HOURS} h, scale ${DATE_RATE_SOFTNESS_H} h; about ${Math.round(DATE_RATE_EARLY * 100)}% for the fastest openers, about ${Math.round(DATE_RATE_LATE * 100)}% after two days). Averaged over the opener-delay distribution, ${DATE_RATE_FAST * 100}% of openers within ${FAST_OPENER_HOURS} h vs ${DATE_RATE_SLOW * 100}% of slower ones plan a date (0.5x). The opener carries hours_since_match (hours from the match). Read: per conversation, date planned within ${DATE_WINDOW_DAYS} days, conversations through ${DATE_READ_END.slice(0, 10)}, slow (> ${FAST_OPENER_HOURS} h) over fast (≤ ${FAST_OPENER_HOURS} h).`,
		mixpanelReport: { type: "Funnels", steps: ["conversation started", "date planned"], counting: "totals", holdPropertyConstant: "match_id", window: `${DATE_WINDOW_DAYS} days`, dateRange: `${D0} to 2026-08-31`, breakdown: `hours_since_match (custom buckets ≤ ${FAST_OPENER_HOURS}, > ${FAST_OPENER_HOURS})` },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
c AS (SELECT match_id, any_value(uid) AS uid, min(t) AS t1, any_value(hours_since_match) AS h FROM ev WHERE event = 'conversation started' AND t < TIMESTAMP '${DATE_READ_END}' GROUP BY 1),
d AS (SELECT match_id, min(t) AS t2 FROM ev WHERE event = 'date planned' GROUP BY 1)
SELECT CASE WHEN c.h <= ${FAST_OPENER_HOURS} THEN 'fast' ELSE 'slow' END AS grp, count(DISTINCT c.uid) AS user_count, count(*) AS conversations,
 avg(coalesce(d.t2 >= c.t1 AND d.t2 < c.t1 + INTERVAL ${DATE_WINDOW_DAYS} DAY, false)::INT) AS date_rate
FROM c LEFT JOIN d ON d.match_id = c.match_id GROUP BY 1`,
				},
				select: { s: { where: { grp: "slow" } }, f: { where: { grp: "fast" } } },
				expect: { metric: "s.date_rate / f.date_rate", op: "between", target: band(DATE_RATE_SLOW / DATE_RATE_FAST) },
				minCohort: 600,
			},
		],
	},
];

export default config;
