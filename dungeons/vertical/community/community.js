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
 * NAME:       Hearthside
 * APP:        Fan community platform: members join hobby communities in six
 *             hubs (gaming, anime, movies & TV, books, tabletop, music), read
 *             and edit community wikis, start and reply to discussion threads,
 *             upvote, upload fan art, and report bad content to volunteer
 *             moderators. Free with ads; Hearthside Plus ($4.99/month or
 *             $49.99/year) removes ads and adds flair, badges, and larger uploads.
 * SCALE:      10,000 members (≈4,500 join inside the window), ~0.84M events,
 *             120 days (2026-06-04 → 2026-10-01, UTC), 48 communities
 * CORE LOOP:  article viewed / search performed → discussion viewed → comment posted
 * VALUE MOMENT: comment posted (a member takes part, not only reads)
 *
 * EVENTS (21):
 *   article viewed (24) > notification received (7) > upvote given (7)
 *   > search performed (5) > article edited (3) > user followed (1)
 *   > community joined (1) > article published (1) > media uploaded (1)
 *   > discussion posted (1, half kept) > moderation action (1, moderators only)
 *   > funnel-only: account created, interests selected, intro posted,
 *   discussion viewed, comment posted, report submitted, report resolved,
 *   plus page viewed, plus subscribed, $experiment_started
 *
 * FUNNELS (4):
 *   - Onboarding (first funnel): account created → interests selected → intro posted
 *       (engine 100%; the everything hook decides who finishes by acquisition channel, H2)
 *   - Thread Reply: discussion viewed → comment posted (40%, 30 min; thread_id,
 *       content_hub, community per thread; A/B "Reply Nudges" from 2026-07-08, H3)
 *   - Report: report submitted → report resolved (85%; report_id, report_type,
 *       content_hub per report; resolution timing rebuilt in the hook, H4)
 *   - Upgrade to Plus (free members): plus page viewed → plus subscribed (8%, 2 h)
 *
 * USER PROPS:  role (lurker/reader/contributor/creator/moderator), home_hub,
 *              membership, member_since, acquisition_channel, karma,
 *              "Experiment: Reply Nudges" (enrolled members)
 * SUPER PROPS: membership (free / plus at event time)
 * SCD PROPS:   none
 * GROUPS:      community_id (48 communities, 8 per hub; events with a hub carry
 *              a community in that hub)
 * WAREHOUSE:   paid_marketing_daily (spend by paid channel),
 *              trust_safety_daily (reports, spam removals, raid alerts by hub),
 *              ad_revenue_daily (ad impressions, eCPM, revenue by hub)
 * LOOKUPS:     none — every attribute is denormalized onto events/profiles/groups
 * SOUP:        weekend-heavy dayOfWeekWeights, evening hourOfDayWeights for the
 *              Americas and Europe (UTC)
 *
 * IDENTITY: "account created" is the auth event and each new member's first
 * event (user_id + device_id); 2 devices per member on average. Every event
 * carries user_id: there is no anonymous pre-signup activity. The two
 * onboarding steps after signup (interests selected, intro posted) carry
 * user_id only; every other event also carries device_id.
 *
 * DESIGN NOTES:
 * - retentionCurve shapes new members' activity and pins each signup to the
 *   profile `created` instant (UTC, hour from the soup). member_since is that
 *   date for new members and a 2021-03..2026-06 date for established ones.
 * - Roles: personas scale each member's whole event budget, so the hook keeps
 *   only 20% of a reader's and 5% of a lurker's contributions (articles,
 *   edits, threads, comments, uploads); only moderators take moderation
 *   actions; half of all "discussion posted" are kept (starting a thread is
 *   rarer than replying). Reporting and upgrade browsing come from a minority
 *   of members (35% and 30%, whole funnel units).
 * - Hubs: 55% of a member's activity is in their home hub. Wiki pages and
 *   communities are hub-consistent (a page id and a community id always belong
 *   to the event's hub); a thread's view and reply share one community.
 * - Experiment exposure: the engine logs $experiment_started before every
 *   enrolled thread view; the hook keeps the first per member, which is how
 *   the client SDK logs exposure.
 * - New members' fate is decided in one pass: onboarding (H2), first reply
 *   (H6), setup abandonment (50% of non-finishers stop on day 0.5-4), and an
 *   organic lapse (60% stop on a uniform day 5-75). A cut stops what the
 *   member does; notifications keep arriving at 35% of the rate and report
 *   resolutions still post.
 * - Reports: resolution time is a seeded log-normal (median 16 h) scaled by
 *   type and by Hearth Guard (H4); resolution_hours is the real gap. Reports
 *   filed in the engine's 3-day lead-in before June 4 keep their resolution
 *   when its implied filing time is before the window, so June starts with a
 *   queue in flight.
 * - Warehouse drift: trust_safety_daily.reports_received adds email and
 *   logged-out reports (~20%, seeded per hub-day) to the Mixpanel count;
 *   ad_revenue_daily counts every ad-serving page view (logged-in free members
 *   × ~15 for logged-out search readers, ±12% per hub-day) × ad slots × fill
 *   rate; paid_marketing_daily spend is a paced budget, never derived from the
 *   day's signups.
 */

// ── HOOK STORIES ──
/*
 * All effects are hidden: no flag properties. Each is found by a breakdown, a
 * date comparison, a cohort, or a warehouse join. Dates live in the TIMELINE
 * constants and are shared by hooks, stories, SQL, warehouse columns, and the
 * timeline guide.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H1. STARFALL LAUNCH SURGE (everything, clones)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-08-06 to 2026-08-19, gaming-hub article views and searches run
 *   2.6x normal on release day, decaying evenly to 1.4x (mean 2.0x). Clones are
 *   new page views (fresh wiki page, community, time on page) 2-240 min after
 *   the source. Other hubs are untouched.
 * MIXPANEL: Insights, article viewed (and search performed), total, breakdown
 *   content_hub, daily; Aug 6-19 vs Jul 23-Aug 5.
 * REAL WORLD: a big game release sends players to the wiki for walkthroughs.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H2. ONBOARDING BY ACQUISITION CHANNEL (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: share of signups who post their intro: friend_invite 72%, reddit
 *   55%, organic 52%, app_store 50%, youtube_creators 50%, tiktok_ads 25%.
 *   40% of non-finishers also skip the interests step.
 * MIXPANEL: Funnels, account created → interests selected → intro posted,
 *   7-day window, breakdown acquisition_channel.
 * REAL WORLD: invited members arrive with a friend already inside; short-video
 *   ad clicks are curious, not committed.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H3. REPLY NUDGES EXPERIMENT (declarative funnel experiment)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-07-08 members split 50/50; "Nudges On" multiplies the share
 *   of thread views that lead to a comment by 1.2 and view → comment time by 0.8.
 * MIXPANEL: Funnels, discussion viewed → comment posted, totals, hold thread_id
 *   constant, 1-day window, breakdown "Experiment: Reply Nudges".
 * REAL WORLD: a reply prompt under the thread lowers the effort to answer.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H4. HEARTH GUARD REPORT TRIAGE (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-07-22, community by community over 10 days, spam,
 *   harassment, and vandalism reports resolve in 0.35x the time; misinformation,
 *   copyright, and other reports do not change.
 * MIXPANEL: Funnels, report submitted → report resolved, hold report_id
 *   constant, median time to convert, breakdown report_type, before Jul 22 vs
 *   from Aug 1 (or Insights average resolution_hours).
 * REAL WORLD: AI triage clears clear-cut abuse; judgment calls still wait for
 *   a volunteer.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H5. ANIME SPAM RAID (everything + warehouse trust_safety_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-08-19 to 2026-08-21, 45% of would-be anime comments, threads,
 *   upvotes, and uploads never happen; 25% of reporting members active in anime
 *   file a spam report. Warehouse: raid_alert_level = raid, spam_accounts_removed
 *   ~14x, automod and volunteer hours up, for anime on those days only.
 * MIXPANEL: Insights, comment posted / discussion posted / upvote given / media
 *   uploaded, breakdown content_hub, daily; join the warehouse raid days.
 * REAL WORLD: a bot raid buries real threads and members wait it out.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H6. FIRST REPLY WITHIN 24 HOURS (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 55% of new members' intros get a reply notification within 24 h
 *   (member hash). Of the others, 50% go quiet 7 days after the intro.
 * MIXPANEL: Funnels intro posted → notification received (notification_type =
 *   reply), 24-hour window, save converters as a cohort; Retention account
 *   created → custom event "member action" (every event except notification
 *   received and report resolved), on or after day 30, filter did intro
 *   posted, breakdown that cohort.
 * REAL WORLD: a newcomer who is greeted comes back; one who posts into silence
 *   often does not.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H7. REVERTED FIRST EDIT (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 35% of new members' first wiki edits are reverted (edit_reverted
 *   notification 1-30 h later); 60% of those never edit again.
 * MIXPANEL: Funnels article edited → notification received (edit_reverted),
 *   2-day window, cohort; Funnels article edited → article edited, 30-day
 *   window, new members, breakdown that cohort.
 * REAL WORLD: the classic wiki newcomer problem: a revert reads as rejection.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H8. AD LOAD CHANGE (everything + warehouse ad_revenue_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-09-02 free pages carry 2.4 ad slots per page view instead
 *   of 1.5 (1.6x impressions per page view); free members read 0.9x as many
 *   articles per search; Plus checkout conversion per upgrade-page visit
 *   doubles, ramping in over 7 days.
 * MIXPANEL: Insights formula article viewed / search performed, breakdown
 *   membership, before vs after; Funnels plus page viewed → plus subscribed,
 *   totals, 1-day window, before vs after; warehouse impressions per free view.
 * REAL WORLD: more ads earn more per page, cost some reading, and push the
 *   most annoyed readers to pay for ad-free.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H9. PAID CHANNEL ECONOMICS (everything + warehouse paid_marketing_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: window spend per Mixpanel signup $5 TikTok, $8 Reddit, $12 YouTube
 *   creators (paced daily budgets, weekday shape, ±12% noise, never zero).
 *   With H2's onboarding rates, TikTok is 0.625x Reddit per signup but 1.375x
 *   per onboarded member.
 * MIXPANEL: account created by acquisition_channel joined to spend_usd; the
 *   onboarding funnel by acquisition_channel.
 * REAL WORLD: cheap clicks are not cheap members.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H10. FANDOM FEST (declarative worldEvents)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-09-17 to 2026-09-20, comments, new threads, upvotes, and
 *   uploads run 1.6x (engine clones, fresh insert_ids). Reading is unchanged.
 * MIXPANEL: Insights, those four events, daily; fest Thu-Sun vs the same days a
 *   week before and after.
 * REAL WORLD: a themed community event lifts participation, not traffic.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * EXPECTED METRICS SUMMARY (measured: data/verify-community, 2026-10-07, 825,919 events)
 * ═════════════════════════════════════════════════════════════════════════
 * Hook | Metric                                         | Derivation                 | Expected | Measured
 * -----|------------------------------------------------|----------------------------|----------|---------
 * H1   | gaming/other reading+search, launch / before   | mean of 2.6 → 1.4 ramp     | 2.00     | 2.023
 * H1   | other hubs, launch fortnight / fortnight before| untouched                  | 1.00     | 1.035
 * H2   | onboarding friend_invite / organic             | 0.72 / 0.52                | 1.385    | 1.327 (68.4% vs 51.5%)
 * H3   | reply rate per thread view, Nudges / Control   | NUDGE_CONV_MULT            | 1.20     | 1.216 (31.8% vs 26.1%)
 * H3   | median view → reply time, Nudges / Control     | NUDGE_TTC_MULT             | 0.80     | 0.800 (12.0 vs 15.0 min)
 * H3   | Nudges share of exposed members                | equal 2-arm hash           | 0.50     | 0.497
 * H4   | median resolve time DiD, triaged / other types | GUARD_RESOLVE_MULT         | 0.35     | 0.327 (12.2 → 4.0 h vs 25.4 → 25.6 h)
 * H4   | other types, after / before (control)          | untouched                  | 1.00     | 1.006
 * H5   | anime share of participation, raid / base      | RAID_KEEP                  | 0.55     | 0.596
 * H5   | other hubs' participation, raid / base         | untouched                  | 1.00     | 0.997
 * H6   | D30 on-or-after, replied / not replied         | 1/(1 − 0.5), floor 1.333   | 2.00     | 2.035 (65.6% vs 32.2%)
 * H6   | intros with a reply within 24 h                | FAST_REPLY_SHARE           | 0.55     | 0.563
 * H7   | edited again in 30 d, reverted / kept          | 1 − 0.6, ceiling 0.7       | 0.40     | 0.384 (25.2% vs 65.6%)
 * H7   | first edits reverted                           | REVERT_SHARE               | 0.35     | 0.351
 * H8   | impressions per free article view, after/before| 2.4 / 1.5 slots            | 1.60     | 1.610 (19.3 → 31.1)
 * H8   | views per search, free DiD vs Plus             | AD_READING_KEEP            | 0.90     | 0.901
 * H8   | Plus conversion per visit, after / before      | UPGRADE_LIFT, floor 1.5    | 2.00     | 1.900 (8.4% vs 4.4%)
 * H9   | spend per signup, TikTok / Reddit              | 5 / 8                      | 0.625    | 0.601 ($5.07 vs $8.45)
 * H9   | spend per onboarded member, TikTok / Reddit    | 0.625 × 0.55/0.25          | 1.375    | 1.300 ($20.86 vs $16.05)
 * H10  | participation, fest / neighbor Thu-Sun         | FEST_MULT                  | 1.60     | 1.612
 * H10  | article reading, fest / neighbor Thu-Sun       | untouched                  | 1.00     | 1.007
 * ═════════════════════════════════════════════════════════════════════════
 *
 * All 10 stories grade NAILED. H6, H7, and H8's upgrade read are
 * noise-limited (a few hundred retained members, about 300 reverted editors,
 * about 100 post-change subscriptions; relative SE 6-11%), so they carry a
 * knob target plus a knob-derived floor or ceiling (half the effect) and
 * would grade STRONG rather than fail if a reseed moved them outside ±10%.
 * H4 excludes reports filed during the H5 raid (spam floods the triaged mix)
 * and requires a week of resolution time (censoring). H9's onboarded-member
 * read inherits H2's binomial noise (224 TikTok onboarded members).
 */

// ── SCALE ──
const SEED = "dm4-community";
const NUM_USERS = 10_000;
const DATASET_START = "2026-06-04T00:00:00Z";
const DATASET_END = "2026-10-01T23:59:59Z"; // 120 days
const EVENTS_PER_DAY = 1.2;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── TIMELINE (shared by hooks, stories, SQL, warehouse columns, guides) ──
const REPLY_NUDGES_START = "2026-07-08T00:00:00Z"; // "Reply Nudges" thread A/B starts
const GUARD_LAUNCH = "2026-07-22T00:00:00Z";       // Hearth Guard (AI report triage) rollout starts
const GUARD_ROLLOUT_DAYS = 10;                     // communities switched on over 10 days (through Jul 31)
const STARFALL_RELEASE = "2026-08-06T00:00:00Z";   // Starfall (open-world game) releases
const STARFALL_DAYS = 14;                          // launch fortnight, Aug 6-19
const RAID_START = "2026-08-19T00:00:00Z";         // coordinated spam raid on the anime hub
const RAID_END = "2026-08-22T00:00:00Z";           // exclusive (3 days, Aug 19-21)
const AD_LOAD_CHANGE = "2026-09-02T00:00:00Z";     // more ad slots per page for free members
const FEST_START = "2026-09-17T00:00:00Z";         // Hearthside Fandom Fest (Thu-Sun)
const FEST_DAYS = 4;

const ms = (iso) => dayjs.utc(iso).valueOf();
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;
const dayIndex = (iso) => Math.round((ms(iso) - ms(DATASET_START)) / DAY_MS);
const WINDOW_DAYS = 120;

// ── WEEKLY AND DAILY RHYTHM (soup) ──
// Sun..Sat: a hobby community is busiest on weekends and quietest midweek.
const DOW_WEIGHTS = [1.0, 0.84, 0.8, 0.8, 0.83, 0.9, 0.98];
// UTC hours: North American evenings (00-04 UTC) and European evenings
// (17-22 UTC) peak; the quietest hours are the European early morning.
const HOUR_WEIGHTS = [0.95, 0.95, 0.9, 0.8, 0.65, 0.5, 0.38, 0.3, 0.28, 0.3, 0.36, 0.42,
	0.5, 0.56, 0.62, 0.68, 0.74, 0.82, 0.9, 0.95, 1.0, 1.0, 0.98, 0.96];

// ── KNOBS ──
const HUBS = ["gaming", "anime", "movies_tv", "books", "tabletop", "music"];
const HUB_WEIGHTS = { gaming: 26, anime: 18, movies_tv: 20, books: 12, tabletop: 10, music: 14 };
const HOME_HUB_SHARE = 55; // % of a member's activity in their home hub

// Contribution volume by role (realism, not a story): readers and lurkers
// mostly read; only moderators take moderation actions.
const CONTRIBUTION_EVENTS = ["article published", "article edited", "discussion posted", "comment posted", "media uploaded"];
const CONTRIB_KEEP = { lurker: 0.05, reader: 0.2, contributor: 1, creator: 1, moderator: 1 };
const NEW_THREAD_KEEP = 0.5;        // starting a thread is rarer than replying (applies to everyone)

// H2 onboarding by acquisition channel (share of signups who post their intro)
const CHANNEL_WEIGHTS = { organic: 28, friend_invite: 13, reddit_ads: 18, tiktok_ads: 21, youtube_creators: 10, app_store: 10 };
const ONBOARD_FINISH = { friend_invite: 0.72, organic: 0.52, app_store: 0.5, reddit_ads: 0.55, youtube_creators: 0.5, tiktok_ads: 0.25 };
const ONBOARD_EARLY_DROP = 0.4;     // non-finishers who stop before picking interests
const ONBOARD_WINDOW_DAYS = 7;
const SETUP_ABANDON_SHARE = 0.5;    // non-finishers who stop all activity on day 0.5-4
const SETUP_ABANDON_DAY_MIN = 0.5;
const SETUP_ABANDON_DAY_MAX = 4;

// H6 first reply within 24 h of the intro post (new members who posted an intro)
const FAST_REPLY_SHARE = 0.55;
const FAST_REPLY_HOURS = 24;
const DARK_SHARE_NO_REPLY = 0.5;    // intro without a reply in 24 h: share who go dark after day 7
const DARK_AFTER_DAYS = 7;
const RETENTION_DAY = 30;
const LAPSE_SHARE = 0.6;            // organic lapse, every new member, independent of everything else
const LAPSE_DAY_MIN = 5;
const LAPSE_DAY_MAX = 75;
const LAPSED_NOTIFICATION_KEEP = 0.35; // notifications a member keeps receiving after going quiet

// H7 newcomer's first wiki edit reverted
const REVERT_SHARE = 0.35;          // new members whose first edit is reverted
const QUIT_AFTER_REVERT = 0.6;      // reverted newcomers who never edit again
const REVERT_FOLLOWUP_DAYS = 30;

// H3 Reply Nudges experiment on the thread funnel
const NUDGE_EXPERIMENT = "Reply Nudges";
const NUDGE_VARIANT = "Nudges On";
const EXP_KEY = `Experiment: ${NUDGE_EXPERIMENT}`;
const NUDGE_CONV_MULT = 1.2;
const NUDGE_TTC_MULT = 0.8;
const THREAD_CONV = 40;
const THREAD_TTC_H = 0.5;

// H4 Hearth Guard report triage
const REPORT_TYPES = { spam: 34, harassment: 20, vandalism: 14, misinformation: 14, copyright: 8, other: 10 };
const TRIAGED_TYPES = ["spam", "harassment", "vandalism"];
const GUARD_RESOLVE_MULT = 0.35;    // report → resolution time for triaged types once the community has Guard
const REPORT_MEDIAN_H = 16;
const TYPE_SPEED = { spam: 0.6, harassment: 1.0, vandalism: 0.8, misinformation: 1.6, copyright: 2.2, other: 1.2 };
const REPORT_TTC_H = 72;

// Who reports and who considers Plus (realism, not a story): reporting and
// upgrade browsing come from a minority of members (whole funnel units).
const REPORTER_SHARE = 0.35;
const UPGRADE_CURIOUS_SHARE = 0.3;

// H5 anime spam raid
const RAID_HUB = "anime";
const RAID_KEEP = 0.55;             // share of would-be anime participation (comments, threads, upvotes, uploads) during the raid
const PARTICIPATION_EVENTS = ["comment posted", "discussion posted", "upvote given", "media uploaded"];
const RAID_REPORTER_SHARE = 0.25;   // members active in anime during the raid who file one extra spam report
const SPAM_REMOVED_PER_DAY = { gaming: 9, anime: 7, movies_tv: 7, books: 3, tabletop: 3, music: 4 };
const RAID_SPAM_MULT = 14;

// H1 Starfall launch fortnight: gaming reading and search volume, decaying from 2.6x to 1.4x (mean 2.0x)
const STARFALL_MULT_START = 2.6;
const STARFALL_MULT_END = 1.4;
const STARFALL_MULT = (STARFALL_MULT_START + STARFALL_MULT_END) / 2;
const starfallMult = (t) => {
	const d = (t - ms(STARFALL_RELEASE)) / DAY_MS;
	if (d < 0 || d >= STARFALL_DAYS) return 1;
	return STARFALL_MULT_START + (STARFALL_MULT_END - STARFALL_MULT_START) * (Math.floor(d) / (STARFALL_DAYS - 1));
};

// H8 ad load change for free members
const AD_SLOTS_OLD = 1.5;           // ad slots per page view before (one in-feed slot every other screen)
const AD_SLOTS_NEW = 2.4;           // after
const AD_IMPRESSION_MULT = AD_SLOTS_NEW / AD_SLOTS_OLD;
const AD_READING_KEEP = 0.9;        // free members read 10% fewer articles after the change
const UPGRADE_LIFT = 2.0;           // Plus checkout conversion per upgrade-page visit, after vs before
const UPGRADE_RAMP_DAYS = 7;
const UPGRADE_CONV = 8;
const ESTABLISHED_PLUS_SHARE = 0.08;
const UNTRACKED_REPORT_SHARE = 0.2;  // reports by email / logged-out readers on top of Mixpanel's count (average)
const LOGGED_OUT_FACTOR = 15;       // ad-serving page views per logged-in free page view (logged-out search readers dominate wiki traffic)
const ECPM_USD = { gaming: 3.4, anime: 2.6, movies_tv: 3.9, books: 2.2, tabletop: 2.8, music: 2.4 };

// H9 paid channel economics
const PAID_CHANNELS = ["reddit_ads", "tiktok_ads", "youtube_creators"];
const CPL_USD = { reddit_ads: 8, tiktok_ads: 5, youtube_creators: 12 }; // window cost per Mixpanel signup
const BORN_PCT = 45;
const DAILY_BUDGET_USD = Object.fromEntries(PAID_CHANNELS.map((ch) => {
	const totalW = Object.values(CHANNEL_WEIGHTS).reduce((a, b) => a + b, 0);
	return [ch, CPL_USD[ch] * (NUM_USERS * BORN_PCT / 100) * (CHANNEL_WEIGHTS[ch] / totalW) / WINDOW_DAYS];
}));
const SPEND_FLAT_SHARE = 0.4;
const SPEND_WEEKDAY = (() => {
	const m = DOW_WEIGHTS.reduce((a, b) => a + b, 0) / DOW_WEIGHTS.length;
	return DOW_WEIGHTS.map((w) => SPEND_FLAT_SHARE + (1 - SPEND_FLAT_SHARE) * w / m);
})();
const SPEND_NOISE = 0.12;
const PLATFORM_SIGNUP_INFLATION = 1.25;
const CPC_USD = { reddit_ads: 0.9, tiktok_ads: 0.45, youtube_creators: 1.6 };
const CTR = { reddit_ads: 0.008, tiktok_ads: 0.011, youtube_creators: 0.014 };

// H10 Fandom Fest: themed threads and a fan-art contest
const FEST_MULT = 1.6;
const FEST_EVENTS = ["media uploaded", "discussion posted", "comment posted", "upvote given"];

// ── DATA ARRAYS (seeded) ──
const COMMUNITY_SUFFIX = ["Guild", "Archive", "Commons", "Den", "Circle", "Hall", "Lounge", "Society"];
const HUB_TOPICS = {
	gaming: ["Starfall", "Ironvale", "Pixel Dynasty", "Neon Drift", "Hollow Crown", "Ashen Tide", "Kart League", "Deepcore"],
	anime: ["Moonblade", "Sakura Station", "Mecha Vanguard", "Spirit Ledger", "Tide Runner", "Ember Academy", "Paper Lanterns", "Star Courier"],
	movies_tv: ["Northwind Saga", "The Long Watch", "Harbor Lights", "Crimson Bureau", "Orbit Nine", "Glass City", "Old Roads", "Quiet Planet"],
	books: ["Fable Keepers", "Ink and Ember", "The Ninth Shelf", "Mystery Hour", "Starward Novels", "Poetry Nook", "Saga Readers", "Grim Chapters"],
	tabletop: ["Dice Tavern", "Hexcrawl", "Meeple Market", "Dungeon Scribes", "Card Table", "Miniature Forge", "Campaign Notes", "Rules Lawyers"],
	music: ["Synth Garden", "Vinyl Vault", "Chiptune Union", "Indie Signal", "Choir Loft", "Bassline", "Lo-Fi Porch", "Score Club"],
};
const COMMUNITIES = HUBS.flatMap((hub, hi) => HUB_TOPICS[hub].map((topic, i) => ({
	id: String(hi * 8 + i + 1),
	hub,
	name: `${topic} ${COMMUNITY_SUFFIX[(hi + i) % COMMUNITY_SUFFIX.length]}`,
	// popularity falls with index inside the hub
	members: Math.round((2600 / (1 + i * 0.9)) * (HUB_WEIGHTS[hub] / 20) * (0.8 + chance.floating({ min: 0, max: 0.4 }))),
	founded: chance.integer({ min: 2017, max: 2025 }),
	official: i === 0 || chance.bool({ likelihood: 20 }),
})));
const COMMUNITIES_BY_HUB = Object.fromEntries(HUBS.map((h) => [h, COMMUNITIES.filter((c) => c.hub === h)]));
const WIKI_PAGES_PER_HUB = 600;
const THREADS_PER_COMMUNITY = 1200;
const HUB_CODE = { gaming: "gm", anime: "an", movies_tv: "tv", books: "bk", tabletop: "tt", music: "mu" };

// ── HELPERS ──
const salt = (uid, tag) => hashFloat(`${uid}|${tag}`);
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
const T = (e) => dayjs.utc(e.time).valueOf();
const iso = (t) => new Date(t).toISOString();
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const jitter = (key, spread) => 1 + (hashFloat(key) - 0.5) * 2 * spread;
const logNormal = (sigma) => Math.exp(chance.normal({ mean: 0, dev: sigma }));
const pickWeighted = (weights, r) => {
	const entries = Object.entries(weights);
	const total = entries.reduce((s, [, w]) => s + w, 0);
	let acc = 0;
	for (const [k, w] of entries) {
		acc += w / total;
		if (r < acc) return k;
	}
	return entries[entries.length - 1][0];
};
const hubForMember = (ctx) => (chance.bool({ likelihood: HOME_HUB_SHARE }) && ctx?.profile?.home_hub
	? ctx.profile.home_hub
	: chance.weighted(HUBS, HUBS.map((h) => HUB_WEIGHTS[h])));
const communityFor = (hub, key) => {
	const list = COMMUNITIES_BY_HUB[hub] || COMMUNITIES_BY_HUB.gaming;
	return list[Math.min(list.length - 1, Math.floor(list.length * Math.pow(hashFloat(`${key}|community`), 1.7)))].id;
};
const wikiFor = (hub, key) => `wk_${HUB_CODE[hub] || "gm"}_${String(Math.floor(WIKI_PAGES_PER_HUB * Math.pow(hashFloat(`${key}|wiki`), 1.8))).padStart(4, "0")}`;
const inRaid = (t) => t >= ms(RAID_START) && t < ms(RAID_END);
const guardOnFor = (communityId) => ms(GUARD_LAUNCH) + hashFloat(`guard|${communityId}`) * GUARD_ROLLOUT_DAYS * DAY_MS;
const adSlots = (t) => (t >= ms(AD_LOAD_CHANGE) ? AD_SLOTS_NEW : AD_SLOTS_OLD);
const PASSIVE = new Set(["notification received", "report resolved"]);
// clone a user's event as another declared event type: identity, device, and
// location context stay; the source event's own properties are removed
const OWN_PROPS = ["signup_method", "acquisition_channel", "hubs_selected", "word_count", "content_hub", "wiki_id", "article_type",
	"time_on_page_sec", "search_term", "results_count", "content_type", "thread_id", "topic_type", "reply_count", "comment_length",
	"is_reply", "edit_type", "chars_changed", "category", "media_type", "file_size_kb", "join_source", "follow_source",
	"notification_type", "channel", "opened", "report_id", "report_type", "outcome", "resolution_hours", "action_type", "severity",
	"upgrade_trigger", "plan", "community_id", "Experiment name", "Variant name"];
const asEvent = (template, event, props) => {
	const c = cloneEvent(template, { event });
	for (const k of OWN_PROPS) delete c[k];
	return Object.assign(c, props);
};
// H9: paid media spend for one channel-day (paced budget, never zero)
const paidSpend = (date, ch) => round2(DAILY_BUDGET_USD[ch] * SPEND_WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()] * jitter(`spend|${date}|${ch}`, SPEND_NOISE));
// report resolution gap (ms) for a report submitted at t
const reportGap = (type, t, communityId) => {
	const base = REPORT_MEDIAN_H * HOUR_MS * logNormal(0.75) * (TYPE_SPEED[type] ?? 1);
	return TRIAGED_TYPES.includes(type) && t >= guardOnFor(communityId) ? base * GUARD_RESOLVE_MULT : base;
};

function handleUserHook(profile, meta) {
	const uid = profile.distinct_id;
	profile.home_hub = pickWeighted(HUB_WEIGHTS, salt(uid, "home-hub"));
	const role = profile.role;
	const karmaRange = { lurker: [0, 25], reader: [5, 180], contributor: [120, 2600], creator: [2400, 22000], moderator: [1500, 14000] }[role] || [0, 50];
	profile.karma = Math.round(karmaRange[0] + Math.pow(salt(uid, "karma"), 1.6) * (karmaRange[1] - karmaRange[0]));
	if (meta.userIsBornInDataset) {
		profile.membership = "free";
		profile.member_since = dayKey(ms(profile.created ?? meta.user.created));
		return profile;
	}
	// established members joined between 2021-03 and the window start
	const span = dayIndex(DATASET_START) - dayIndex("2021-03-01T00:00:00Z");
	profile.member_since = dayjs.utc("2021-03-01T00:00:00Z").add(Math.floor(salt(uid, "tenure") * span), "day").format("YYYY-MM-DD");
	const plusShare = ESTABLISHED_PLUS_SHARE * ({ creator: 2.2, moderator: 1.8, contributor: 1.3, reader: 0.8, lurker: 0.3 }[role] ?? 1);
	profile.membership = salt(uid, "plus") < plusShare ? "plus" : "free";
	return profile;
}

function handleEverything(events, meta) {
	if (!events.length) return events;
	const profile = meta.profile;
	const uid = profile.distinct_id;
	const END = ms(DATASET_END);
	const role = profile.role;

	// ── hub-consistent wiki pages and communities ──
	for (const e of events) {
		if (!e.content_hub) continue;
		if (e.wiki_id !== undefined) e.wiki_id = wikiFor(e.content_hub, `${e.wiki_id}|${e.insert_id}`);
		if (e.community_id !== undefined) e.community_id = communityFor(e.content_hub, e.thread_id || e.report_id || e.insert_id);
	}
	// article published creates a page: its id is new, not a popular page
	for (const e of events) {
		if (e.event === "article published") e.wiki_id = `wk_${HUB_CODE[e.content_hub]}_${String(WIKI_PAGES_PER_HUB + Math.floor(hashFloat(`${e.insert_id}|new`) * 9000)).padStart(4, "0")}`;
	}
	// threads are shared: a thread view and its reply land on one thread from the
	// community's pool (popular threads get most views); a new thread gets a new id
	for (const e of events) {
		if (e.event === "discussion viewed" || e.event === "comment posted") {
			const n = Math.floor(THREADS_PER_COMMUNITY * Math.pow(hashFloat(`${e.thread_id}|thread`), 1.6));
			const tid = `thr_${e.community_id}_${String(n).padStart(4, "0")}`;
			if (e.event === "discussion viewed") {
				const pop = Math.pow(1 - n / THREADS_PER_COMMUNITY, 4);
				const day = (T(e) - ms(DATASET_START)) / DAY_MS;
				e.reply_count = Math.round((3 + 300 * pop) * (0.8 + 0.4 * hashFloat(`${tid}|replies`)) + (0.05 + 2 * pop) * day);
			}
			e.thread_id = tid;
		} else if (e.event === "discussion posted") {
			e.thread_id = `thr_${e.community_id}_${String(THREADS_PER_COMMUNITY + Math.floor(hashFloat(`${e.insert_id}|new-thread`) * 90000)).padStart(5, "0")}`;
		}
	}

	// ── contribution volume by role (readers mostly read; only moderators moderate) ──
	const keepShare = CONTRIB_KEEP[role] ?? 1;
	events = events.filter((e) => {
		if (e.event === "moderation action") return role === "moderator";
		if (e.event === "discussion posted" && !chance.bool({ likelihood: NEW_THREAD_KEEP * 100 })) return false;
		if (keepShare < 1 && CONTRIBUTION_EVENTS.includes(e.event)) return chance.bool({ likelihood: keepShare * 100 });
		return true;
	});

	// ── reporting and upgrade browsing come from a minority of members ──
	const reporter = salt(uid, "reporter") < REPORTER_SHARE;
	const curious = salt(uid, "upgrade-curious") < UPGRADE_CURIOUS_SHARE;
	const firstExposure = events.filter((e) => e.event === "$experiment_started").sort((x, y) => T(x) - T(y))[0];
	events = events.filter((e) => {
		if (e.event === "report submitted" || e.event === "report resolved") return reporter;
		if (e.event === "plus page viewed" || e.event === "plus subscribed") return curious;
		// the experiment SDK logs one exposure per member (their first enrolled thread view)
		if (e.event === "$experiment_started") return e === firstExposure;
		return true;
	});

	// ── H8: before the ad load change fewer upgrade-page visits convert (ramps up over a week) ──
	const upgradeKeep = (t) => {
		const pos = (t - ms(AD_LOAD_CHANGE)) / (UPGRADE_RAMP_DAYS * DAY_MS);
		return pos < 0 ? 1 / UPGRADE_LIFT : pos >= 1 ? 1 : 1 / UPGRADE_LIFT + (1 - 1 / UPGRADE_LIFT) * pos;
	};
	events = events.filter((e) => e.event !== "plus subscribed" || chance.bool({ likelihood: upgradeKeep(T(e)) * 100 }));

	// ── purchase hygiene: one Plus subscription per member; later upgrade visits vanish ──
	const firstBuy = events.filter((e) => e.event === "plus subscribed").sort((a, b) => T(a) - T(b))[0];
	if (firstBuy) {
		const t0 = T(firstBuy);
		events = events.filter((e) => {
			if (e === firstBuy) return true;
			if (e.event === "plus subscribed") return false;
			if (e.event === "plus page viewed" && T(e) > t0) return false;
			return true;
		});
	}
	let purchase = firstBuy || null;

	// ── new members: onboarding (H2), first reply (H6), abandonment and lapse ──
	const signup = events.find((e) => e.event === "account created");
	if (signup) {
		const birthMs = T(signup);
		const finish = salt(uid, "onboard") < (ONBOARD_FINISH[profile.acquisition_channel] ?? 0.5);
		const intro = events.find((e) => e.event === "intro posted");
		const cuts = [];
		if (!finish) {
			const early = salt(uid, "onboard-early") < ONBOARD_EARLY_DROP;
			events = events.filter((e) => e.event !== "intro posted" && !(early && e.event === "interests selected"));
			if (salt(uid, "abandon") < SETUP_ABANDON_SHARE) {
				cuts.push(birthMs + (SETUP_ABANDON_DAY_MIN + salt(uid, "abandon-day") * (SETUP_ABANDON_DAY_MAX - SETUP_ABANDON_DAY_MIN)) * DAY_MS);
			}
		} else if (intro) {
			// H6: did anyone reply to the intro within 24 h?
			const ti = T(intro);
			const replyEnd = ti + FAST_REPLY_HOURS * HOUR_MS;
			const fast = salt(uid, "fast-reply") < FAST_REPLY_SHARE;
			// organic reply notifications inside the first 24 h belong to the replied-to intro only
			events = events.filter((e) => !(e.event === "notification received" && e.notification_type === "reply" && T(e) > ti && T(e) <= replyEnd));
			if (fast) {
				const tr = ti + (0.2 + salt(uid, "reply-at") * (FAST_REPLY_HOURS - 1)) * HOUR_MS;
				if (tr <= END) {
					events.push(asEvent(signup, "notification received", {
						time: iso(tr),
						notification_type: "reply",
						channel: salt(uid, "reply-ch") < 0.6 ? "push" : "in_app",
						opened: salt(uid, "reply-open") < 0.35,
					}));
				}
			} else if (salt(uid, "dark") < DARK_SHARE_NO_REPLY) {
				cuts.push(ti + DARK_AFTER_DAYS * DAY_MS);
			}
		}
		if (salt(uid, "lapse") < LAPSE_SHARE) cuts.push(birthMs + (LAPSE_DAY_MIN + salt(uid, "lapse-day") * (LAPSE_DAY_MAX - LAPSE_DAY_MIN)) * DAY_MS);
		if (cuts.length) {
			const cut = Math.min(...cuts);
			// churn stops what the member does; server-side messages keep arriving,
			// though a quiet member gets fewer of them (digests, no replies to their posts)
			events = events.filter((e) => T(e) < cut || e.event === "report resolved"
				|| (e.event === "notification received" && chance.bool({ likelihood: LAPSED_NOTIFICATION_KEEP * 100 })));
			if (purchase && T(purchase) >= cut) purchase = null;
		}

		// ── H7: a newcomer's first wiki edit gets reverted ──
		const edits = events.filter((e) => e.event === "article edited").sort((a, b) => T(a) - T(b));
		if (edits.length && salt(uid, "revert") < REVERT_SHARE) {
			const t1 = T(edits[0]);
			const tr = t1 + (1 + salt(uid, "revert-at") * 29) * HOUR_MS;
			if (tr <= END) {
				events.push(asEvent(edits[0], "notification received", {
					time: iso(tr),
					notification_type: "edit_reverted",
					channel: "in_app",
					opened: salt(uid, "revert-open") < 0.45,
				}));
				if (salt(uid, "quit-editing") < QUIT_AFTER_REVERT) {
					const later = new Set(edits.slice(1));
					events = events.filter((e) => !later.has(e));
				}
			}
		}
	}

	// ── H5: anime spam raid — members post less, and some report the spam ──
	const raidActivity = events.filter((e) => e.content_hub === RAID_HUB && inRaid(T(e)) && !PASSIVE.has(e.event));
	events = events.filter((e) => !(PARTICIPATION_EVENTS.includes(e.event) && e.content_hub === RAID_HUB && inRaid(T(e)) && !chance.bool({ likelihood: RAID_KEEP * 100 })));
	const repTemplate = events.find((e) => e.event === "report submitted");
	const resTemplate = events.find((e) => e.event === "report resolved");
	if (raidActivity.length && repTemplate && resTemplate && salt(uid, "raid-report") < RAID_REPORTER_SHARE) {
		const anchor = raidActivity[Math.floor(salt(uid, "raid-anchor") * raidActivity.length)];
		const tr = Math.min(T(anchor) + (1 + salt(uid, "raid-gap") * 29) * MIN_MS, ms(RAID_END) - MIN_MS);
		if (tr <= END) {
			const rid = `rep_${Math.floor(hashFloat(`${uid}|raid-rid`) * 1e12).toString(36)}`;
			const community = communityFor(RAID_HUB, rid);
			events.push(cloneEvent(repTemplate, { time: iso(tr), report_id: rid, report_type: "spam", content_hub: RAID_HUB, community_id: community }));
			events.push(cloneEvent(resTemplate, { time: iso(tr + HOUR_MS), report_id: rid, report_type: "spam", content_hub: RAID_HUB, community_id: community }));
		}
	}

	// ── H4: report resolution timing (Hearth Guard triage) ──
	const reports = new Map();
	for (const e of events) {
		if (e.event !== "report submitted" && e.event !== "report resolved") continue;
		if (!reports.has(e.report_id)) reports.set(e.report_id, {});
		reports.get(e.report_id)[e.event] = e;
	}
	const dropReport = new Set();
	for (const r of reports.values()) {
		const sub = r["report submitted"], res = r["report resolved"];
		if (!res) continue;
		if (!sub) {
			// submitted before June 4 (engine lead-in): keep the resolution only if
			// its implied submission falls before the window
			const gap = reportGap(res.report_type, ms(DATASET_START) - DAY_MS, res.community_id);
			if (T(res) - gap < ms(DATASET_START)) res.resolution_hours = round1(gap / HOUR_MS);
			else dropReport.add(res);
			continue;
		}
		const gap = reportGap(sub.report_type, T(sub), sub.community_id);
		const tr = T(sub) + gap;
		res.time = iso(tr);
		res.resolution_hours = round1(gap / HOUR_MS);
		if (tr > END) dropReport.add(res);
	}
	if (dropReport.size) events = events.filter((e) => !dropReport.has(e));

	// ── H1: Starfall launch fortnight — more gaming reading and search ──
	const lastMs = events.reduce((m, e) => (PASSIVE.has(e.event) ? m : Math.max(m, T(e))), 0);
	const starfallClones = [];
	for (const e of events) {
		if ((e.event !== "article viewed" && e.event !== "search performed") || e.content_hub !== "gaming") continue;
		const t = T(e);
		const m = starfallMult(t);
		if (m <= 1) continue;
		const extra = Math.floor(m - 1) + (chance.bool({ likelihood: ((m - 1) % 1) * 100 }) ? 1 : 0);
		for (let k = 0; k < extra; k++) {
			const tc = t + chance.integer({ min: 2, max: 240 }) * MIN_MS;
			if (tc > END || tc > lastMs || starfallMult(tc) <= 1) continue;
			const over = { time: iso(tc) };
			if (e.event === "article viewed") {
				over.wiki_id = wikiFor("gaming", `${e.insert_id}|sf${k}`);
				over.community_id = communityFor("gaming", `${e.insert_id}|sf${k}`);
				over.time_on_page_sec = Math.max(5, Math.round(e.time_on_page_sec * (0.5 + chance.floating({ min: 0, max: 1 }))));
			} else {
				over.results_count = chance.integer({ min: 0, max: 60 });
			}
			starfallClones.push(cloneEvent(e, over));
		}
	}
	if (starfallClones.length) events = events.concat(starfallClones);

	// ── membership at event time (superProp) + final profile membership ──
	const initial = profile.membership;
	const buyMs = purchase ? T(purchase) : Infinity;
	const planAt = (t) => (t >= buyMs ? "plus" : initial);
	for (const e of events) e.membership = planAt(T(e));
	if (purchase) profile.membership = "plus";

	// ── H8: free members read fewer articles once pages carry more ads ──
	events = events.filter((e) => !(e.event === "article viewed" && e.membership === "free" && T(e) >= ms(AD_LOAD_CHANGE) && !chance.bool({ likelihood: AD_READING_KEEP * 100 })));

	// experiment assignment lives on the profile only for members with an exposure left
	if (profile[EXP_KEY] !== undefined && !events.some((e) => e.event === "$experiment_started")) delete profile[EXP_KEY];

	return events;
}

// warehouse rows: exogenous business facts layered on event-derived volumes
function handleWarehouse(row, meta) {
	if (meta.isBackfill) return row;
	if (meta.metricName === "paid_marketing_daily") {
		row.spend_usd = paidSpend(row.date, row.acquisition_channel);
		return row;
	}
	if (meta.metricName === "trust_safety_daily") {
		// reports also arrive by email and from logged-out readers, which Mixpanel never sees
		const k = `${row.date}|${row.content_hub}`;
		row.reports_received = Math.round(row.reports_received * (1 + UNTRACKED_REPORT_SHARE * jitter(`untracked|${k}`, 0.9)) + (hashFloat(`untracked-n|${k}`) < 0.5 ? 1 : 0));
		return row;
	}
	if (meta.metricName === "ad_revenue_daily") {
		// the ad server counts every page view that served ads: logged-in free
		// members (the Mixpanel count) plus logged-out readers, times the ad slots
		// per page in force that day and the fill rate
		const k = `${row.date}|${row.content_hub}`;
		const pageViews = row.ad_impressions * LOGGED_OUT_FACTOR * jitter(`logged-out|${k}`, 0.12);
		row.ad_impressions = Math.round(pageViews * adSlots(ms(`${row.date}T00:00:00Z`)) * row.fill_rate);
		row.ad_revenue_usd = round2(row.ad_impressions / 1000 * row.ecpm_usd);
		return row;
	}
	return row;
}

function handleGroup(record) {
	const c = COMMUNITIES[Number(record.community_id) - 1];
	if (!c) return record;
	record.name = c.name;
	record.content_hub = c.hub;
	record.member_count = c.members;
	record.founded_year = c.founded;
	record.is_official = c.official;
	return record;
}

const HUB_PROP = (ctx) => hubForMember(ctx);
const COMMUNITY_EVENTS = ["intro posted", "article viewed", "upvote given", "discussion posted", "discussion viewed", "comment posted",
	"article edited", "article published", "media uploaded", "community joined", "report submitted", "report resolved", "moderation action"];

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
	autoPowerLaw: false,
	macro: { percentUsersBornInDataset: BORN_PCT, bornRecentBias: 0, preExistingSpread: "uniform" },
	// consumer hobby community: weekend-heavy, evening peaks in the Americas and Europe (UTC)
	soup: { dayOfWeekWeights: DOW_WEIGHTS, hourOfDayWeights: HOUR_WEIGHTS },
	credentials: { token },
	switches: {
		hasSessionIds: true,
		alsoInferFunnels: false,
		hasLocation: true,
		hasAndroidDevices: true,
		hasIOSDevices: true,
		hasDesktopDevices: true,
		hasBrowser: true,
		hasCampaigns: false,
		isAnonymous: false,
		hasAdSpend: false,
		hasAvatar: true,
	},
	identity: { avgDevicePerUser: 2 },

	events: [
		{
			event: "account created",
			weight: 1,
			isFirstEvent: true,
			isAuthEvent: true,
			properties: {
				signup_method: { __weights: { google: 38, apple: 24, email: 26, discord: 12 } },
				acquisition_channel: (ctx) => ctx.profile.acquisition_channel,
			},
		},
		{
			event: "interests selected",
			weight: 1,
			isStrictEvent: true,
			properties: {
				hubs_selected: { __weights: { 1: 14, 2: 26, 3: 28, 4: 18, 5: 9, 6: 5 } },
			},
		},
		{
			event: "intro posted",
			weight: 1,
			isStrictEvent: true,
			properties: {
				content_hub: (ctx) => ctx.profile.home_hub,
				word_count: u.weighNumRange(8, 400, 0.4, 40),
			},
		},
		{
			event: "article viewed",
			weight: 24,
			properties: {
				content_hub: HUB_PROP,
				wiki_id: ["unassigned"],
				article_type: { __weights: { character: 24, walkthrough: 16, episode_guide: 16, lore: 18, location: 10, review: 10, news: 6 } },
				time_on_page_sec: u.weighNumRange(5, 900, 0.35, 60),
			},
		},
		{
			event: "search performed",
			weight: 5,
			properties: {
				content_hub: HUB_PROP,
				search_term: { __weights: { "character list": 14, "ending explained": 12, "tier list": 12, "release date": 10, "walkthrough": 14, "lore timeline": 9, "best builds": 9, "fan theories": 8, "voice cast": 6, "soundtrack": 6 } },
				results_count: u.weighNumRange(0, 60, 0.5, 40),
			},
		},
		{
			event: "upvote given",
			weight: 7,
			properties: {
				content_hub: HUB_PROP,
				content_type: { __weights: { article: 35, discussion: 30, comment: 35 } },
			},
		},
		{
			event: "discussion posted",
			weight: 2,
			properties: {
				content_hub: HUB_PROP,
				thread_id: (ctx) => `thr_${chance.hash({ length: 10 })}`,
				topic_type: { __weights: { theory: 20, question: 26, news: 12, review: 14, recommendation: 16, debate: 12 } },
			},
		},
		{
			event: "discussion viewed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				thread_id: ["unassigned"],
				content_hub: ["gaming"],
				reply_count: u.weighNumRange(0, 200, 0.3, 40),
			},
		},
		{
			event: "comment posted",
			weight: 1,
			isStrictEvent: true,
			properties: {
				thread_id: ["unassigned"],
				content_hub: ["gaming"],
				comment_length: u.weighNumRange(5, 900, 0.35, 40),
				is_reply: { __weights: { true: 62, false: 38 } },
			},
		},
		{
			event: "article edited",
			weight: 3,
			properties: {
				content_hub: HUB_PROP,
				wiki_id: ["unassigned"],
				edit_type: { __weights: { content: 40, formatting: 18, citation: 14, grammar: 18, image: 10 } },
				chars_changed: u.weighNumRange(3, 3000, 0.3, 40),
			},
		},
		{
			event: "article published",
			weight: 1,
			properties: {
				content_hub: HUB_PROP,
				wiki_id: ["unassigned"],
				category: { __weights: { character: 26, lore: 20, episode_guide: 18, walkthrough: 14, review: 12, news: 10 } },
				word_count: u.weighNumRange(150, 6000, 0.4, 40),
			},
		},
		{
			event: "media uploaded",
			weight: 1,
			properties: {
				content_hub: HUB_PROP,
				media_type: { __weights: { fan_art: 34, screenshot: 30, gif: 20, video_clip: 16 } },
				file_size_kb: u.weighNumRange(40, 20000, 0.3, 40),
			},
		},
		{
			event: "community joined",
			weight: 1,
			properties: {
				content_hub: HUB_PROP,
				join_source: { __weights: { recommendation: 34, search: 22, browse: 26, invite: 18 } },
			},
		},
		{
			event: "user followed",
			weight: 1,
			properties: {
				follow_source: { __weights: { profile: 30, article: 20, discussion: 35, recommendation: 15 } },
			},
		},
		{
			event: "notification received",
			weight: 7,
			properties: {
				notification_type: { __weights: { reply: 26, mention: 12, upvote_digest: 22, new_follower: 10, weekly_digest: 22, community_update: 8 } },
				channel: { __weights: { push: 50, email: 25, in_app: 25 } },
				opened: { __weights: { true: 14, false: 86 } },
			},
		},
		{
			event: "report submitted",
			weight: 1,
			isStrictEvent: true,
			properties: {
				report_id: ["unassigned"],
				report_type: ["other"],
				content_hub: ["gaming"],
			},
		},
		{
			event: "report resolved",
			weight: 1,
			isStrictEvent: true,
			properties: {
				report_id: ["unassigned"],
				report_type: ["other"],
				content_hub: ["gaming"],
				outcome: { __weights: { content_removed: 52, user_warned: 18, no_violation: 30 } },
				resolution_hours: [0],
			},
		},
		{
			event: "moderation action",
			weight: 1,
			properties: {
				content_hub: HUB_PROP,
				action_type: { __weights: { remove_post: 30, warn_member: 20, lock_thread: 12, mute_member: 10, approve_post: 20, ban_member: 8 } },
				severity: { __weights: { low: 45, medium: 38, high: 17 } },
			},
		},
		{
			event: "plus page viewed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				upgrade_trigger: { __weights: { ad_free: 40, custom_flair: 20, profile_badges: 15, larger_uploads: 25 } },
			},
		},
		{
			event: "plus subscribed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				plan: { __weights: { plus_monthly: 70, plus_annual: 30 } },
			},
		},
		{
			event: "$experiment_started",
			weight: 1,
			isStrictEvent: true,
			properties: {
				"Experiment name": [NUDGE_EXPERIMENT],
				"Variant name": ["Control", NUDGE_VARIANT],
			},
		},
	],

	funnels: [
		{
			name: "Onboarding",
			sequence: ["account created", "interests selected", "intro posted"],
			isFirstFunnel: true,
			conversionRate: 100, // the everything hook decides who finishes (H2)
			timeToConvert: 6,
			order: "sequential",
			weight: 1,
		},
		{
			name: "Thread Reply",
			sequence: ["discussion viewed", "comment posted"],
			conversionRate: THREAD_CONV,
			timeToConvert: THREAD_TTC_H,
			order: "sequential",
			weight: 5,
			props: {
				thread_id: (ctx) => `thr_${chance.hash({ length: 10 })}`,
				content_hub: HUB_PROP,
				community_id: ["0"],
			},
			experiment: {
				name: NUDGE_EXPERIMENT,
				startDaysBeforeEnd: (ms(DATASET_END) - ms(REPLY_NUDGES_START)) / DAY_MS,
				variants: [
					{ name: "Control" },
					{ name: NUDGE_VARIANT, conversionMultiplier: NUDGE_CONV_MULT, ttcMultiplier: NUDGE_TTC_MULT },
				],
			},
		},
		{
			name: "Report",
			sequence: ["report submitted", "report resolved"],
			conversionRate: 85,
			timeToConvert: REPORT_TTC_H,
			order: "sequential",
			weight: 1,
			props: {
				report_id: (ctx) => `rep_${chance.hash({ length: 12 })}`,
				report_type: { __weights: REPORT_TYPES },
				content_hub: HUB_PROP,
				community_id: ["0"],
			},
		},
		{
			name: "Upgrade to Plus",
			sequence: ["plus page viewed", "plus subscribed"],
			conditions: { membership: "free" },
			conversionRate: UPGRADE_CONV,
			timeToConvert: 2,
			order: "sequential",
			weight: 1,
		},
	],

	worldEvents: [
		{
			name: "fandom_fest",
			type: "campaign",
			startDay: dayIndex(FEST_START),
			duration: FEST_DAYS,
			volumeMultiplier: FEST_MULT,
			affectsEvents: FEST_EVENTS,
		},
	],

	warehouseMetrics: [
		{
			name: "paid_marketing_daily",
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
				platform_reported_signups: (ctx) => Math.round(paidSpend(dayKey(ctx.time), ctx.seriesKey) * PLATFORM_SIGNUP_INFLATION / CPL_USD[ctx.seriesKey] * jitter(`lead|${dayKey(ctx.time)}|${ctx.seriesKey}`, 0.25)),
				clicks: (ctx) => Math.round(paidSpend(dayKey(ctx.time), ctx.seriesKey) / (CPC_USD[ctx.seriesKey] * jitter(`cpc|${dayKey(ctx.time)}|${ctx.seriesKey}`, 0.15))),
				impressions: (ctx) => Math.round(ctx.row.clicks / (CTR[ctx.seriesKey] * jitter(`ctr|${dayKey(ctx.time)}|${ctx.seriesKey}`, 0.15))),
			},
		},
		{
			name: "trust_safety_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "report submitted",
				measure: "count",
				groupBy: "content_hub",
			},
			timeColumn: "date",
			valueColumn: "reports_received",
			columns: {
				spam_accounts_removed: (ctx) => {
					const hub = ctx.seriesKey;
					const base = SPAM_REMOVED_PER_DAY[hub] * jitter(`spam|${dayKey(ctx.time)}|${hub}`, 0.35);
					return Math.round(hub === RAID_HUB && inRaid(ctx.time) ? base * RAID_SPAM_MULT : base);
				},
				automod_removals: (ctx) => {
					const hub = ctx.seriesKey;
					// Hearth Guard auto-removes clear-cut spam once a community has it
					const share = COMMUNITIES_BY_HUB[hub].filter((c) => guardOnFor(c.id) <= ctx.time + DAY_MS).length / COMMUNITIES_BY_HUB[hub].length;
					const base = SPAM_REMOVED_PER_DAY[hub] * (1.5 + 3 * share) * jitter(`automod|${dayKey(ctx.time)}|${hub}`, 0.3);
					return Math.round(hub === RAID_HUB && inRaid(ctx.time) ? base * 6 : base);
				},
				raid_alert_level: (ctx) => (ctx.seriesKey === RAID_HUB && inRaid(ctx.time) ? "raid" : "normal"),
				volunteer_mod_hours: (ctx) => round1(SPAM_REMOVED_PER_DAY[ctx.seriesKey] * 4 * jitter(`modh|${dayKey(ctx.time)}|${ctx.seriesKey}`, 0.25) * (ctx.seriesKey === RAID_HUB && inRaid(ctx.time) ? 3.2 : 1)),
			},
		},
		{
			name: "ad_revenue_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "article viewed",
				measure: "count",
				where: (e) => e.membership === "free",
				groupBy: "content_hub",
			},
			timeColumn: "date",
			valueColumn: "ad_impressions",
			columns: {
				ecpm_usd: (ctx) => round2(ECPM_USD[ctx.seriesKey] * jitter(`ecpm|${dayKey(ctx.time)}|${ctx.seriesKey}`, 0.1)),
				ad_revenue_usd: 0,
				fill_rate: (ctx) => round2(0.86 + (hashFloat(`fill|${dayKey(ctx.time)}|${ctx.seriesKey}`) - 0.5) * 0.08),
			},
		},
	],

	superProps: {
		membership: ["free"],
	},

	userProps: {
		role: ["reader"],
		home_hub: ["gaming"],
		membership: ["free"],
		member_since: ["2025-01-01"],
		acquisition_channel: { __weights: CHANNEL_WEIGHTS },
		karma: [0],
	},

	personas: [
		{ name: "lurker", weight: 25, eventMultiplier: 0.35, properties: { role: "lurker" } },
		{ name: "reader", weight: 40, eventMultiplier: 0.8, properties: { role: "reader" } },
		{ name: "contributor", weight: 24, eventMultiplier: 1.5, properties: { role: "contributor" } },
		{ name: "creator", weight: 5, eventMultiplier: 2.4, properties: { role: "creator" } },
		{ name: "moderator", weight: 6, eventMultiplier: 2.0, properties: { role: "moderator" } },
	],

	groupKeys: [["community_id", COMMUNITIES.length, COMMUNITY_EVENTS]],
	groupProps: {
		community_id: {
			name: ["unknown"],
			content_hub: ["gaming"],
			member_count: [0],
			founded_year: [2020],
			is_official: [false],
		},
	},

	retentionCurve: { type: "logarithmic", day1: 0.65, day7: 0.5, day30: 0.38 },

	hook(record, type, meta) {
		if (type === "user") return handleUserHook(record, meta);
		if (type === "everything") return handleEverything(record, meta);
		if (type === "warehouse") return handleWarehouse(record, meta);
		if (type === "group") return handleGroup(record);
		return record;
	},
};

// ── STORIES ──────────────────────────────────────────────────────────────
// Machine-checkable contract for hooks H1-H10. Evaluate with:
//   node dungeons/vertical/community/community.verify.mjs

const EV = `read_json_auto('{{PREFIX}}-EVENTS*.json*', sample_size=-1, union_by_name=true)`;
const US = `read_json_auto('{{PREFIX}}-USERS*.json*', sample_size=-1, union_by_name=true)`;
const WH = (table) => `read_json_auto('{{PREFIX}}-WAREHOUSE-${table}.json*', sample_size=-1, union_by_name=true)`;

// Identity prelude: a device resolves to the member seen with it on any event
// that carries both ids (emitted stitch evidence, the way Mixpanel merges).
// Every event in this dungeon carries user_id, so uid is user_id.
const ID_CTE = `dmap AS (SELECT device_id, min(user_id::VARCHAR) AS mapped FROM ${EV}
  WHERE user_id IS NOT NULL AND device_id IS NOT NULL GROUP BY 1),
ev AS (SELECT coalesce(e.user_id::VARCHAR, m.mapped) AS uid, e.time::TIMESTAMP AS t, e.*
  FROM ${EV} e LEFT JOIN dmap m ON e.device_id = m.device_id)`;

const TS = (isoStr) => dayjs.utc(isoStr).format("YYYY-MM-DD HH:mm:ss");
const D = (isoStr) => isoStr.slice(0, 10);
const plusDays = (isoStr, n) => dayjs.utc(isoStr).add(n, "day").toISOString();
const band = (k) => [Math.round(k * 0.9 * 1000) / 1000, Math.round(k * 1.1 * 1000) / 1000];
const SQL_LIST = (xs) => xs.map((x) => `'${x}'`).join(", ");
const ONBOARDING_STEPS = ["account created", "interests selected", "intro posted"];
const NON_ACTIVITY = SQL_LIST([...PASSIVE]);
const SF_END = plusDays(STARFALL_RELEASE, STARFALL_DAYS);
const SF_BASE_FROM = plusDays(STARFALL_RELEASE, -STARFALL_DAYS);
const GUARD_DONE = plusDays(GUARD_LAUNCH, GUARD_ROLLOUT_DAYS);
const REPORT_MATURE_END = plusDays(DATASET_END, -7).slice(0, 10) + "T00:00:00Z"; // reports with a full week to resolve
// raid baseline: the same weekdays one week before and one week after
const RAID_BASE_SQL = `((t >= TIMESTAMP '${TS(plusDays(RAID_START, -7))}' AND t < TIMESTAMP '${TS(plusDays(RAID_END, -7))}')
    OR (t >= TIMESTAMP '${TS(plusDays(RAID_START, 7))}' AND t < TIMESTAMP '${TS(plusDays(RAID_END, 7))}'))`;
const FEST_END = plusDays(FEST_START, FEST_DAYS);
const UPGRADE_RAMPED = plusDays(AD_LOAD_CHANGE, UPGRADE_RAMP_DAYS);
const RET_COHORT_END = plusDays(DATASET_END, -RETENTION_DAY).slice(0, 10) + "T00:00:00Z"; // signups with day 30 inside the data
const REVERT_COHORT_END = plusDays(DATASET_END, -REVERT_FOLLOWUP_DAYS).slice(0, 10) + "T00:00:00Z";
const ONBOARD_TARGET_FRIEND = ONBOARD_FINISH.friend_invite / ONBOARD_FINISH.organic;
const CPS_TARGET = CPL_USD.tiktok_ads / CPL_USD.reddit_ads;
const CPO_TARGET = CPS_TARGET * ONBOARD_FINISH.reddit_ads / ONBOARD_FINISH.tiktok_ads;

/** step_counts conversion for a set of segments from a timeToConvert breakdown. */
const convOf = (rows, segs) => {
	const rs = (rows || []).filter((x) => segs.includes(x.segment_value) && Array.isArray(x.step_counts) && x.step_counts[0]);
	if (!rs.length) return null;
	const entered = rs.reduce((a, r) => a + r.step_counts[0], 0);
	const converted = rs.reduce((a, r) => a + r.step_counts[r.step_counts.length - 1], 0);
	return { entered, converted, rate: converted / entered };
};

// shared SQL
const H3_SQL = `WITH ${ID_CTE},
v AS (SELECT distinct_id::VARCHAR AS uid, "${EXP_KEY}" AS variant FROM ${US} WHERE "${EXP_KEY}" IS NOT NULL),
r AS (SELECT uid, thread_id, t AS t0 FROM ev WHERE event = 'discussion viewed' AND t >= TIMESTAMP '${TS(REPLY_NUDGES_START)}'),
c AS (SELECT uid, thread_id, t AS t1 FROM ev WHERE event = 'comment posted'),
m AS (SELECT r.uid, r.thread_id, r.t0, min(c.t1) AS t1 FROM r LEFT JOIN c ON c.uid = r.uid AND c.thread_id = r.thread_id
  AND c.t1 >= r.t0 AND c.t1 < r.t0 + INTERVAL 1 DAY GROUP BY 1, 2, 3),
x AS (SELECT v.variant, m.uid, (m.t1 IS NOT NULL) AS ok, date_diff('second', m.t0, m.t1) AS ttc_s
  FROM m JOIN v ON v.uid = m.uid)
SELECT variant AS grp, count(DISTINCT uid) AS user_count, count(*) AS thread_views, avg(ok::INT) AS conv, median(ttc_s) AS med_ttc
FROM x GROUP BY 1`;
const H4_SQL = `WITH ${ID_CTE},
s AS (SELECT report_id, uid, t AS t0, report_type FROM ev WHERE event = 'report submitted'),
r AS (SELECT report_id, min(t) AS t1 FROM ev WHERE event = 'report resolved' GROUP BY 1),
x AS (SELECT s.uid, CASE WHEN s.report_type IN (${SQL_LIST(TRIAGED_TYPES)}) THEN 'triaged' ELSE 'other' END AS kind,
  CASE WHEN s.t0 < TIMESTAMP '${TS(GUARD_LAUNCH)}' THEN 'before' WHEN s.t0 >= TIMESTAMP '${TS(GUARD_DONE)}' AND s.t0 < TIMESTAMP '${TS(REPORT_MATURE_END)}' THEN 'after' END AS period,
  date_diff('second', s.t0, r.t1) AS ttc_s
  FROM s JOIN r ON r.report_id = s.report_id
  WHERE NOT (s.t0 >= TIMESTAMP '${TS(RAID_START)}' AND s.t0 < TIMESTAMP '${TS(RAID_END)}'))
SELECT kind AS grp, count(DISTINCT uid) AS user_count, count(*) AS reports,
 median(ttc_s) FILTER (WHERE period = 'after') / median(ttc_s) FILTER (WHERE period = 'before') AS after_before
FROM x WHERE period IS NOT NULL GROUP BY 1`;
const H5_SQL = `WITH ${ID_CTE},
o AS (SELECT DISTINCT date::DATE AS d, content_hub FROM ${WH("trust_safety_daily")} WHERE raid_alert_level = 'raid'),
od AS (SELECT DISTINCT d FROM o), oh AS (SELECT DISTINCT content_hub FROM o),
w AS (SELECT t::DATE AS d, uid, (content_hub IN (SELECT content_hub FROM oh)) AS hit FROM ev
  WHERE event IN (${SQL_LIST(PARTICIPATION_EVENTS)}) AND ((t >= TIMESTAMP '${TS(RAID_START)}' AND t < TIMESTAMP '${TS(RAID_END)}') OR ${RAID_BASE_SQL})),
g AS (SELECT (d IN (SELECT d FROM od)) AS raid, count(*) FILTER (WHERE hit)::DOUBLE / count(*) FILTER (WHERE NOT hit) AS share,
  count(*) FILTER (WHERE NOT hit)::DOUBLE / count(DISTINCT d) AS other_per_day, count(DISTINCT uid) FILTER (WHERE hit) AS users FROM w GROUP BY 1)
SELECT 'all' AS grp, (SELECT count(*) FROM od) AS raid_days, min(users) AS user_count,
 max(share) FILTER (WHERE raid) / max(share) FILTER (WHERE NOT raid) AS did,
 max(other_per_day) FILTER (WHERE raid) / max(other_per_day) FILTER (WHERE NOT raid) AS other_ratio
FROM g`;
const H6_SQL = `WITH ${ID_CTE},
s AS (SELECT uid, t AS t0 FROM ev WHERE event = 'account created' AND t < TIMESTAMP '${TS(RET_COHORT_END)}'),
i AS (SELECT uid, min(t) AS ti FROM ev WHERE event = 'intro posted' GROUP BY 1),
f AS (SELECT i.uid, bool_or(e.event = 'notification received' AND e.notification_type = 'reply' AND e.t > i.ti AND e.t <= i.ti + INTERVAL ${FAST_REPLY_HOURS} HOUR) AS fast
  FROM i JOIN ev e ON e.uid = i.uid GROUP BY 1),
r AS (SELECT s.uid, bool_or(e.event NOT IN (${NON_ACTIVITY}) AND e.t >= s.t0 + INTERVAL ${RETENTION_DAY} DAY) AS ret FROM s JOIN ev e ON e.uid = s.uid GROUP BY 1)
SELECT CASE WHEN f.fast THEN 'replied' ELSE 'no_reply' END AS grp, count(*) AS user_count, avg(r.ret::INT) AS retention
FROM s JOIN f ON f.uid = s.uid JOIN r ON r.uid = s.uid GROUP BY 1`;
const H7_SQL = `WITH ${ID_CTE},
s AS (SELECT DISTINCT uid FROM ev WHERE event = 'account created'),
f AS (SELECT uid, min(t) AS t1 FROM ev WHERE event = 'article edited' GROUP BY 1),
rv AS (SELECT DISTINCT e.uid FROM ev e JOIN f ON f.uid = e.uid WHERE e.event = 'notification received' AND e.notification_type = 'edit_reverted'
  AND e.t >= f.t1 AND e.t < f.t1 + INTERVAL 2 DAY),
a AS (SELECT f.uid, f.t1, count(e.uid) AS later FROM f LEFT JOIN ev e ON e.uid = f.uid AND e.event = 'article edited'
  AND e.t > f.t1 AND e.t <= f.t1 + INTERVAL ${REVERT_FOLLOWUP_DAYS} DAY GROUP BY 1, 2)
SELECT CASE WHEN rv.uid IS NOT NULL THEN 'reverted' ELSE 'kept' END AS grp, count(*) AS user_count, avg((later > 0)::INT) AS edited_again
FROM a JOIN s ON s.uid = a.uid LEFT JOIN rv ON rv.uid = a.uid WHERE a.t1 < TIMESTAMP '${TS(REVERT_COHORT_END)}' GROUP BY 1`;
const H9_SQL = `WITH ${ID_CTE},
s AS (SELECT uid, t AS t0, acquisition_channel AS ch FROM ev WHERE event = 'account created'),
i AS (SELECT uid, min(t) AS ti FROM ev WHERE event = 'intro posted' GROUP BY 1),
x AS (SELECT s.ch, count(*) AS signups, count(DISTINCT s.uid) AS users,
  sum(coalesce(i.ti >= s.t0 AND i.ti < s.t0 + INTERVAL ${ONBOARD_WINDOW_DAYS} DAY, false)::INT) AS onboarded
  FROM s LEFT JOIN i ON i.uid = s.uid GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM ${WH("paid_marketing_daily")} GROUP BY 1)
SELECT x.ch AS grp, x.users AS user_count, sp.spend / x.signups AS spend_per_signup, sp.spend / x.onboarded AS spend_per_onboarded
FROM x JOIN sp ON sp.ch = x.ch`;

/** @type {import("../../../types").DungeonStory[]} */
export const stories = [
	{
		id: "H1-starfall-launch-surge",
		hook: "H1",
		archetype: "temporal-inflection",
		narrative: `Starfall, an open-world game, releases ${D(STARFALL_RELEASE)}. For its launch fortnight (through ${D(plusDays(SF_END, -1))}) gaming-hub reading and search ("article viewed" and "search performed" with content_hub = gaming) run ${STARFALL_MULT_START}x the normal volume on release day, decaying evenly to ${STARFALL_MULT_END}x on day ${STARFALL_DAYS} (mean ${STARFALL_MULT}x). Other hubs are untouched. The gaming-vs-other ratio during the fortnight over the same ratio in the ${STARFALL_DAYS} days before reads the mean multiplier and cancels member growth and weekday mix; the other hubs' own volume is the control.`,
		mixpanelReport: { type: "Insights", events: ["article viewed", "search performed"], measure: "total", breakdown: "content_hub", chart: "daily line", compare: `${D(STARFALL_RELEASE)} to ${D(plusDays(SF_END, -1))} vs the 14 days before` },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
w AS (SELECT (content_hub = 'gaming') AS g, (t >= TIMESTAMP '${TS(STARFALL_RELEASE)}') AS launch, uid FROM ev
  WHERE event IN ('article viewed', 'search performed') AND t >= TIMESTAMP '${TS(SF_BASE_FROM)}' AND t < TIMESTAMP '${TS(SF_END)}')
SELECT 'all' AS grp, count(DISTINCT uid) FILTER (WHERE g AND launch) AS user_count,
 (count(*) FILTER (WHERE g AND launch)::DOUBLE / count(*) FILTER (WHERE NOT g AND launch))
   / (count(*) FILTER (WHERE g AND NOT launch)::DOUBLE / count(*) FILTER (WHERE NOT g AND NOT launch)) AS did,
 count(*) FILTER (WHERE NOT g AND launch)::DOUBLE / count(*) FILTER (WHERE NOT g AND NOT launch) AS other_ratio
FROM w`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.did", op: "between", target: band(STARFALL_MULT) },
				minCohort: 1000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
w AS (SELECT (content_hub = 'gaming') AS g, (t >= TIMESTAMP '${TS(STARFALL_RELEASE)}') AS launch, uid FROM ev
  WHERE event IN ('article viewed', 'search performed') AND t >= TIMESTAMP '${TS(SF_BASE_FROM)}' AND t < TIMESTAMP '${TS(SF_END)}')
SELECT 'all' AS grp, count(DISTINCT uid) FILTER (WHERE NOT g AND launch) AS user_count,
 count(*) FILTER (WHERE NOT g AND launch)::DOUBLE / count(*) FILTER (WHERE NOT g AND NOT launch) AS other_ratio
FROM w`,
				},
				select: { a: { where: { grp: "all" } } },
				// control: other hubs' volume, launch fortnight vs the fortnight before (equal lengths)
				expect: { metric: "a.other_ratio", op: "between", target: band(1) },
				minCohort: 1000,
			},
		],
	},
	{
		id: "H2-onboarding-by-channel",
		hook: "H2",
		archetype: "funnel-conversion-by-segment",
		narrative: `New members who join through a friend's invite finish onboarding (account created → interests selected → intro posted, ${ONBOARD_WINDOW_DAYS}-day window) at ${ONBOARD_FINISH.friend_invite * 100}% vs ${ONBOARD_FINISH.organic * 100}% for organic signups (${ONBOARD_TARGET_FRIEND.toFixed(3)}x); TikTok ad signups finish at only ${ONBOARD_FINISH.tiktok_ads * 100}% (see H9). The everything hook decides per member, by acquisition channel, whether the intro is posted (${ONBOARD_EARLY_DROP * 100}% of non-finishers also skip the interests step). The three steps are onboarding-only events, so the unique-member funnel reads the knobs directly.`,
		mixpanelReport: { type: "Funnels", steps: ONBOARDING_STEPS, breakdown: "user property acquisition_channel", window: `${ONBOARD_WINDOW_DAYS} days` },
		assertions: [
			{
				breakdown: { type: "timeToConvert", steps: ONBOARDING_STEPS, breakdownByUserProperty: "acquisition_channel", conversionWindowMs: ONBOARD_WINDOW_DAYS * DAY_MS },
				// custom assert: conversion lives in each segment row's step_counts
				// ARRAY; the expect grammar cannot index arrays
				assert: (rows) => {
					const fr = convOf(rows, ["friend_invite"]), org = convOf(rows, ["organic"]);
					if (!fr || !org) return { verdict: "NONE", detail: "missing segment rows" };
					if (fr.entered < 300 || org.entered < 600) return { verdict: "WEAK", detail: `small segments ${fr.entered}/${org.entered}` };
					const ratio = fr.rate / org.rate;
					const [lo, hi] = band(ONBOARD_TARGET_FRIEND);
					const detail = `onboarding friend_invite ${fr.converted}/${fr.entered}=${fr.rate.toFixed(4)} vs organic ${org.converted}/${org.entered}=${org.rate.toFixed(4)}; ratio ${ratio.toFixed(4)} (knob ${ONBOARD_TARGET_FRIEND.toFixed(3)}, band [${lo}, ${hi}])`;
					if (ratio >= lo && ratio <= hi) return { verdict: "NAILED", detail };
					return { verdict: ratio > 1 ? "WEAK" : "INVERSE", detail };
				},
			},
		],
	},
	{
		id: "H3-reply-nudges-experiment",
		hook: "H3",
		archetype: "experiment-lift",
		narrative: `The "${NUDGE_EXPERIMENT}" thread test starts ${D(REPLY_NUDGES_START)} and splits members 50/50 (sticky hash). "${NUDGE_VARIANT}" shows a reply prompt under each thread: it multiplies the share of thread views that lead to a comment by ${NUDGE_CONV_MULT} and the view-to-comment time by ${NUDGE_TTC_MULT}. A thread view and the member's reply share a thread_id (threads are shared by many members), so a totals funnel holding thread_id constant measures each member's per-thread reply rate; exposure is logged once per member (their first enrolled thread view).`,
		mixpanelReport: { type: "Funnels", steps: ["discussion viewed", "comment posted"], counting: "totals", holdPropertyConstant: "thread_id", breakdown: `user property "${EXP_KEY}"`, window: "1 day" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H3_SQL },
				select: { n: { where: { grp: NUDGE_VARIANT } }, c: { where: { grp: "Control" } } },
				expect: { metric: "n.conv / c.conv", op: "between", target: band(NUDGE_CONV_MULT) },
				minCohort: 1500,
			},
			{
				breakdown: { type: "duckdb", sql: H3_SQL },
				select: { n: { where: { grp: NUDGE_VARIANT } }, c: { where: { grp: "Control" } } },
				expect: { metric: "n.med_ttc / c.med_ttc", op: "between", target: band(NUDGE_TTC_MULT) },
				minCohort: 1500,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 count(DISTINCT uid) FILTER (WHERE "Variant name" = '${NUDGE_VARIANT}')::DOUBLE / count(DISTINCT uid) AS variant_share
FROM ev WHERE event = '$experiment_started'`,
				},
				select: { a: { where: { grp: "all" } } },
				// equal-weight 2-arm hash → 0.5
				expect: { metric: "a.variant_share", op: "between", target: band(0.5) },
				minCohort: 3000,
			},
		],
	},
	{
		id: "H4-hearth-guard-triage",
		hook: "H4",
		archetype: "funnel-ttc-by-segment",
		narrative: `Hearth Guard, an AI triage for member reports, rolls out community by community from ${D(GUARD_LAUNCH)} over ${GUARD_ROLLOUT_DAYS} days. Once a community has it, spam, harassment, and vandalism reports are resolved in ${GUARD_RESOLVE_MULT}x the time (report submitted → report resolved, same report_id); misinformation, copyright, and other reports still need a human read and do not change. Read: median resolution time after the rollout completes (reports filed ${D(GUARD_DONE)} to ${D(plusDays(REPORT_MATURE_END, -1))}, each with a full week to resolve) over before launch, triaged types over the other types (difference in differences, cancelling queue load; reports filed during the H5 raid are left out because the raid floods one hub with spam reports); control: the other types alone stay at 1. resolution_hours on the resolution equals the real gap.`,
		mixpanelReport: { type: "Funnels", steps: ["report submitted", "report resolved"], measure: "median time to convert", holdPropertyConstant: "report_id", breakdown: "report_type", compare: `before ${D(GUARD_LAUNCH)} vs from ${D(GUARD_DONE)}` },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H4_SQL },
				select: { t: { where: { grp: "triaged" } }, o: { where: { grp: "other" } } },
				expect: { metric: "t.after_before / o.after_before", op: "between", target: band(GUARD_RESOLVE_MULT) },
				minCohort: 300,
			},
			{
				breakdown: { type: "duckdb", sql: H4_SQL },
				select: { o: { where: { grp: "other" } } },
				// control: types Hearth Guard does not triage keep their resolution time
				expect: { metric: "o.after_before", op: "between", target: band(1) },
				minCohort: 300,
			},
		],
	},
	{
		id: "H5-anime-spam-raid",
		hook: "H5",
		archetype: "bespoke",
		narrative: `A coordinated spam raid hits the ${RAID_HUB} hub from ${D(RAID_START)} to ${D(RAID_END)} (exclusive). Members there participate less: ${(1 - RAID_KEEP) * 100}% of would-be comments, new threads, upvotes, and uploads in ${RAID_HUB} never happen (keep ${RAID_KEEP}), and ${RAID_REPORTER_SHARE * 100}% of reporting members active in ${RAID_HUB} file a spam report. The raid days and hub come from the warehouse table trust_safety_daily (raid_alert_level = 'raid', with spam_accounts_removed ~${RAID_SPAM_MULT}x normal); the event-side read is the ${RAID_HUB} share of participation on raid days (Wed-Fri) over the same weekdays one week before and after, which reads the keep rate. Control: participation in the other hubs is unchanged.`,
		mixpanelReport: { type: "Insights", events: PARTICIPATION_EVENTS, measure: "total", breakdown: "content_hub", chart: "daily line", join: "warehouse trust_safety_daily.raid_alert_level on date and content_hub" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H5_SQL },
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.did", op: "between", target: band(RAID_KEEP) },
				minCohort: 200,
			},
			{
				breakdown: { type: "duckdb", sql: H5_SQL },
				select: { a: { where: { grp: "all" } } },
				// control: other hubs' participation per day, raid days vs the same weekdays a week before and after
				expect: { metric: "a.other_ratio", op: "between", target: band(1) },
				minCohort: 200,
			},
		],
	},
	{
		id: "H6-first-reply-retention",
		hook: "H6",
		archetype: "retention-divergence",
		narrative: `New members who post an intro and get a reply within ${FAST_REPLY_HOURS} hours stick around. ${FAST_REPLY_SHARE * 100}% of intros get a reply notification within ${FAST_REPLY_HOURS} h (assigned by member hash, independent of activity). Of the rest, ${DARK_SHARE_NO_REPLY * 100}% go quiet ${DARK_AFTER_DAYS} days after the intro. Everyone also faces the organic lapse (${LAPSE_SHARE * 100}% stop on a uniform day ${LAPSE_DAY_MIN}-${LAPSE_DAY_MAX}). Day-${RETENTION_DAY} unbounded retention (any member action on or after day ${RETENTION_DAY}; notifications and report resolutions are server-side and do not count), for signups before ${D(RET_COHORT_END)}: replied / not replied = 1/(1−${DARK_SHARE_NO_REPLY}) in expectation. The read is noise-limited (a few hundred retained members per group), so the knob is the target with a knob-derived floor (half the dark share).`,
		mixpanelReport: { type: "Funnels → cohort → Retention", cohortFunnel: `intro posted → notification received (notification_type = reply), ${FAST_REPLY_HOURS}-hour window; save converters as a cohort`, birth: "account created", return: "custom event \"member action\" = every event except notification received and report resolved", mode: `on or after day ${RETENTION_DAY}`, filter: "did intro posted", breakdown: "that cohort" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H6_SQL },
				select: { r: { where: { grp: "replied" } }, n: { where: { grp: "no_reply" } } },
				expect: { metric: "r.retention / n.retention", op: ">=", target: 1 / (1 - DARK_SHARE_NO_REPLY), floor: 1 / (1 - DARK_SHARE_NO_REPLY / 2) },
				minCohort: 400,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
i AS (SELECT uid, min(t) AS ti FROM ev WHERE event = 'intro posted' GROUP BY 1),
f AS (SELECT i.uid, bool_or(e.event = 'notification received' AND e.notification_type = 'reply' AND e.t > i.ti AND e.t <= i.ti + INTERVAL ${FAST_REPLY_HOURS} HOUR) AS fast
  FROM i JOIN ev e ON e.uid = i.uid WHERE i.ti < TIMESTAMP '${TS(plusDays(DATASET_END, -1))}' GROUP BY 1)
SELECT 'all' AS grp, count(*) AS user_count, avg(fast::INT) AS replied_share FROM f`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.replied_share", op: "between", target: band(FAST_REPLY_SHARE) },
				minCohort: 1000,
			},
		],
	},
	{
		id: "H7-reverted-first-edit",
		hook: "H7",
		archetype: "retention-divergence",
		narrative: `When a new member's first wiki edit is reverted, most stop editing. ${REVERT_SHARE * 100}% of new members' first edits are reverted (member hash; an "edit_reverted" notification 1-30 h after the edit), and ${QUIT_AFTER_REVERT * 100}% of those never edit again. Read: share of new editors (first edit before ${D(REVERT_COHORT_END)}) who edit again within ${REVERT_FOLLOWUP_DAYS} days, reverted / not reverted = 1 − ${QUIT_AFTER_REVERT}. Reverts are assigned independently of activity, so the ratio reads the knob; it rests on a few hundred reverted editors, so the target carries a knob-derived ceiling (half the effect).`,
		mixpanelReport: { type: "Funnels → cohort → Funnels", cohortFunnel: "article edited → notification received (notification_type = edit_reverted), 2-day window; save converters as a cohort", funnel: `article edited → article edited, ${REVERT_FOLLOWUP_DAYS}-day window`, filter: "did account created (new members)", breakdown: "that cohort" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H7_SQL },
				select: { r: { where: { grp: "reverted" } }, k: { where: { grp: "kept" } } },
				expect: { metric: "r.edited_again / k.edited_again", op: "<=", target: 1 - QUIT_AFTER_REVERT, floor: 1 - QUIT_AFTER_REVERT / 2 },
				minCohort: 200,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
s AS (SELECT DISTINCT uid FROM ev WHERE event = 'account created'),
f AS (SELECT uid, min(t) AS t1 FROM ev WHERE event = 'article edited' GROUP BY 1),
rv AS (SELECT DISTINCT e.uid FROM ev e JOIN f ON f.uid = e.uid WHERE e.event = 'notification received' AND e.notification_type = 'edit_reverted'
  AND e.t >= f.t1 AND e.t < f.t1 + INTERVAL 2 DAY)
SELECT 'all' AS grp, count(*) AS user_count, avg((rv.uid IS NOT NULL)::INT) AS reverted_share
FROM f JOIN s ON s.uid = f.uid LEFT JOIN rv ON rv.uid = f.uid WHERE f.t1 < TIMESTAMP '${TS(plusDays(DATASET_END, -2))}'`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.reverted_share", op: "between", target: band(REVERT_SHARE) },
				minCohort: 500,
			},
		],
	},
	{
		id: "H8-ad-load-change",
		hook: "H8",
		archetype: "temporal-inflection",
		narrative: `On ${D(AD_LOAD_CHANGE)} Hearthside raises the ad load on pages seen by free members and logged-out readers from ${AD_SLOTS_OLD} to ${AD_SLOTS_NEW} ad slots per page view. Three effects: (1) the ad server's impressions per page view rise ${AD_IMPRESSION_MULT}x — impressions live only in the warehouse table ad_revenue_daily, so impressions per Mixpanel free-member article view needs the join; (2) free members read ${AD_READING_KEEP}x as many articles per search (Plus members, who see no ads, are the control; searches are untouched); (3) Plus checkout conversion per upgrade-page visit doubles (${UPGRADE_LIFT}x), ramping in over ${UPGRADE_RAMP_DAYS} days. Upgrades are few (about a hundred after the ramp), so read 3 uses the knob as target with a knob-derived floor (half the lift).`,
		mixpanelReport: { type: "Insights + Funnels + warehouse", reading: "Insights formula article viewed / search performed, breakdown membership, before vs after", upgrade: "Funnels plus page viewed → plus subscribed, totals, 1-day window, before vs after", join: "ad_revenue_daily.ad_impressions by date vs article viewed where membership = free" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
v AS (SELECT t::DATE AS d, count(*) AS page_views FROM ev WHERE event = 'article viewed' AND membership = 'free' GROUP BY 1),
w AS (SELECT date::DATE AS d, sum(ad_impressions) AS imp FROM ${WH("ad_revenue_daily")} GROUP BY 1)
SELECT 'all' AS grp, (SELECT count(DISTINCT uid) FROM ev WHERE event = 'article viewed' AND membership = 'free') AS user_count,
 (sum(imp) FILTER (WHERE d >= DATE '${D(AD_LOAD_CHANGE)}') / sum(page_views) FILTER (WHERE d >= DATE '${D(AD_LOAD_CHANGE)}'))
   / (sum(imp) FILTER (WHERE d < DATE '${D(AD_LOAD_CHANGE)}') / sum(page_views) FILTER (WHERE d < DATE '${D(AD_LOAD_CHANGE)}')) AS ratio
FROM v JOIN w USING (d)`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.ratio", op: "between", target: band(AD_IMPRESSION_MULT) },
				minCohort: 500,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
x AS (SELECT membership AS m, (t >= TIMESTAMP '${TS(AD_LOAD_CHANGE)}') AS post, event, uid FROM ev WHERE event IN ('article viewed', 'search performed')),
g AS (SELECT m, post, count(*) FILTER (WHERE event = 'article viewed')::DOUBLE / count(*) FILTER (WHERE event = 'search performed') AS r, count(DISTINCT uid) AS users FROM x GROUP BY 1, 2)
SELECT 'all' AS grp, min(users) AS user_count,
 (max(r) FILTER (WHERE m = 'free' AND post) / max(r) FILTER (WHERE m = 'free' AND NOT post))
   / (max(r) FILTER (WHERE m = 'plus' AND post) / max(r) FILTER (WHERE m = 'plus' AND NOT post)) AS did
FROM g`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.did", op: "between", target: band(AD_READING_KEEP) },
				minCohort: 300,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
p AS (SELECT uid, t AS t0 FROM ev WHERE event = 'plus page viewed'),
b AS (SELECT uid, min(t) AS t1 FROM ev WHERE event = 'plus subscribed' GROUP BY 1),
x AS (SELECT p.uid, p.t0, coalesce(b.t1 >= p.t0 AND b.t1 < p.t0 + INTERVAL 1 DAY, false) AS ok FROM p LEFT JOIN b ON b.uid = p.uid)
SELECT CASE WHEN t0 < TIMESTAMP '${TS(AD_LOAD_CHANGE)}' THEN 'before' WHEN t0 >= TIMESTAMP '${TS(UPGRADE_RAMPED)}' THEN 'after' ELSE 'ramp' END AS grp,
 count(DISTINCT uid) AS user_count, count(*) AS visits, avg(ok::INT) AS conv
FROM x GROUP BY 1`,
				},
				select: { a: { where: { grp: "after" } }, b: { where: { grp: "before" } } },
				expect: { metric: "a.conv / b.conv", op: ">=", target: UPGRADE_LIFT, floor: 1 + (UPGRADE_LIFT - 1) / 2 },
				minCohort: 300,
			},
		],
	},
	{
		id: "H9-paid-channel-economics",
		hook: "H9",
		archetype: "attribution-bias",
		narrative: `TikTok ad signups are the cheapest paid signups but the most expensive onboarded members. Warehouse paid_marketing_daily bills a paced daily budget per channel (cost per signup × expected signups per day, a weekday shape that follows the signup rhythm above a ${SPEND_FLAT_SHARE * 100}% flat floor, seeded ±${SPEND_NOISE * 100}% day noise, never zero): $${CPL_USD.tiktok_ads} per TikTok signup vs $${CPL_USD.reddit_ads} per Reddit signup at the window level (${CPS_TARGET}x). But only ${ONBOARD_FINISH.tiktok_ads * 100}% of TikTok signups post an intro within ${ONBOARD_WINDOW_DAYS} days vs ${ONBOARD_FINISH.reddit_ads * 100}% from Reddit (H2's onboarding knobs), so spend per onboarded member is ${CPS_TARGET} × ${ONBOARD_FINISH.reddit_ads}/${ONBOARD_FINISH.tiktok_ads} = ${CPO_TARGET.toFixed(3)}x Reddit's. Both reads need the warehouse join.`,
		mixpanelReport: { type: "Insights + Funnels + warehouse", event: "account created", breakdown: "acquisition_channel", join: "paid_marketing_daily.spend_usd", funnel: `account created → interests selected → intro posted, ${ONBOARD_WINDOW_DAYS}-day window, breakdown acquisition_channel` },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H9_SQL },
				select: { t: { where: { grp: "tiktok_ads" } }, r: { where: { grp: "reddit_ads" } } },
				expect: { metric: "t.spend_per_signup / r.spend_per_signup", op: "between", target: band(CPS_TARGET) },
				minCohort: 500,
			},
			{
				breakdown: { type: "duckdb", sql: H9_SQL },
				select: { t: { where: { grp: "tiktok_ads" } }, r: { where: { grp: "reddit_ads" } } },
				expect: { metric: "t.spend_per_onboarded / r.spend_per_onboarded", op: "between", target: band(Math.round(CPO_TARGET * 1000) / 1000) },
				minCohort: 500,
			},
		],
	},
	{
		id: "H10-fandom-fest",
		hook: "H10",
		archetype: "temporal-inflection",
		narrative: `Hearthside Fandom Fest runs ${D(FEST_START)} (Thu) to ${D(plusDays(FEST_END, -1))} (Sun) with themed threads and a fan-art contest. Declarative world event: comments, new threads, upvotes, and uploads run ${FEST_MULT}x their normal volume (engine clones with fresh insert_ids, spread over the four days). Read: fest-days participation over the mean of the same Thursday-Sunday in the week before and the week after (cancels weekday mix and trend). Control: article reading is not part of the fest and stays at 1.`,
		mixpanelReport: { type: "Insights", events: FEST_EVENTS, measure: "total", chart: "daily line", compare: "Thu-Sun of the fest vs the same days one week before and after" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
x AS (SELECT CASE WHEN event = 'article viewed' THEN 'reading' ELSE 'participation' END AS grp, uid,
  CASE WHEN t >= TIMESTAMP '${TS(FEST_START)}' AND t < TIMESTAMP '${TS(FEST_END)}' THEN 'fest'
       WHEN (t >= TIMESTAMP '${TS(plusDays(FEST_START, -7))}' AND t < TIMESTAMP '${TS(plusDays(FEST_END, -7))}')
         OR (t >= TIMESTAMP '${TS(plusDays(FEST_START, 7))}' AND t < TIMESTAMP '${TS(plusDays(FEST_END, 7))}') THEN 'base' END AS p
  FROM ev WHERE event IN (${SQL_LIST([...FEST_EVENTS, "article viewed"])}))
SELECT grp, count(DISTINCT uid) FILTER (WHERE p = 'fest') AS user_count,
 count(*) FILTER (WHERE p = 'fest')::DOUBLE / (count(*) FILTER (WHERE p = 'base') / 2.0) AS lift
FROM x WHERE p IS NOT NULL GROUP BY 1`,
				},
				select: { p: { where: { grp: "participation" } } },
				expect: { metric: "p.lift", op: "between", target: band(FEST_MULT) },
				minCohort: 1000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
x AS (SELECT uid,
  CASE WHEN t >= TIMESTAMP '${TS(FEST_START)}' AND t < TIMESTAMP '${TS(FEST_END)}' THEN 'fest'
       WHEN (t >= TIMESTAMP '${TS(plusDays(FEST_START, -7))}' AND t < TIMESTAMP '${TS(plusDays(FEST_END, -7))}')
         OR (t >= TIMESTAMP '${TS(plusDays(FEST_START, 7))}' AND t < TIMESTAMP '${TS(plusDays(FEST_END, 7))}') THEN 'base' END AS p
  FROM ev WHERE event = 'article viewed')
SELECT 'reading' AS grp, count(DISTINCT uid) FILTER (WHERE p = 'fest') AS user_count,
 count(*) FILTER (WHERE p = 'fest')::DOUBLE / (count(*) FILTER (WHERE p = 'base') / 2.0) AS lift
FROM x WHERE p IS NOT NULL`,
				},
				select: { r: { where: { grp: "reading" } } },
				// control: reading is not part of the fest
				expect: { metric: "r.lift", op: "between", target: band(1) },
				minCohort: 1000,
			},
		],
	},
];

export default config;
