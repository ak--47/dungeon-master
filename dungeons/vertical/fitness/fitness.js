// ── IMPORTS ──
// Engine workaround (reported): lib/utils/utils.js person() writes a born
// member's `created` as a local-time 'YYYY-MM-DD' date and user-loop.js parses
// it with local dayjs(), so birth days, the retention-curve day plan, and the
// pinned signup time all depend on the machine's time zone. Pin the process
// to UTC so the output is byte-identical on every machine. (ES imports are
// hoisted, but nothing reads local time until generation starts.)
process.env.TZ = "UTC";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);
import "dotenv/config";
import * as u from "@ak--47/dungeon-master/utils";
import { hashFloat, cloneEvent } from "@ak--47/dungeon-master/hook-helpers";
/** @typedef  {import("../../../types").Dungeon} Config */

// ── OVERVIEW ──
/*
 * NAME:       Stridewell
 * APP:        Consumer fitness app: plan a workout, do it (phone or wearable
 *             tracked), check progress, join solo or team challenges, book
 *             human coach sessions, log meals. Free tier plus Stridewell Plus
 *             (Monthly $12.99 → $14.99 from 2026-09-01, Annual $99.99).
 *             New members get one 7-day trial; Stride Coach (AI coaching) is a
 *             Plus feature from 2026-08-12.
 * SCALE:      10,000 simulated users → 9,097 member profiles (4,074 join
 *             inside the window; ≈900 would-be joiners are removed by the
 *             Summer Shred baseline thinning, see H5), 1.17M events,
 *             120 days (2026-06-04 → 2026-10-01, UTC)
 * CORE LOOP:  workout planned → workout completed → progress checked
 * VALUE MOMENT: workout completed
 *
 * EVENTS (22):
 *   workout completed (8) > app opened (7) > workout planned (6) > meal logged (6)
 *   > progress checked (5) > notification received (5) > leaderboard viewed (3)
 *   > challenge joined (2) > friend added (2) > achievement unlocked (2)
 *   > coach session (2) > profile updated (2) > challenge completed (1)
 *   > paywall viewed (1) > trial started (1) > subscription purchased (1)
 *   > account deactivated (1) > account created / goal quiz completed /
 *   plan generated / starter workout completed / $experiment_started (funnel-only)
 *
 * FUNNELS (7):
 *   - Onboarding (first funnel, A/B "Guided First Week" from 2026-07-01):
 *       account created → goal quiz completed → plan generated → starter workout completed
 *       (engine 100%; the everything hook models abandonment: 45% finish, see H1)
 *   - Workout Loop: workout planned → workout completed → progress checked (55%)
 *   - Upgrade to Plus (trial), trial-eligible free members: paywall viewed → trial started → subscription purchased (26%)
 *       (new members, plus pre-window members who joined shortly before June 4 and
 *       still have a trial to start: the window-start trial pipeline, see below)
 *   - Upgrade to Plus (direct), long-time free members: paywall viewed → subscription purchased (1%;
 *       ≈7% of the long-time free pool buys in the window, so purchases stay ≈flat week to week)
 *   - Team Challenge: challenge joined → challenge completed (60%, challenge_format "team")
 *   - Solo Challenge: challenge joined → challenge completed (30%, challenge_format "solo")
 *   - Coaching: coach session → workout planned → workout completed (50%)
 *
 * USER PROPS:  segment, fitness_level, primary_goal, acquisition_channel,
 *              wearable_type, subscription_tier, trial_eligible, Platform,
 *              "Experiment: Guided First Week" (enrolled members)
 * SUPER PROPS: Platform (sticky per member), subscription_tier (plan at event time)
 * SCD PROPS:   fitness_level (beginner/intermediate/advanced/elite, monthly, max 6)
 * GROUPS:      none
 * WAREHOUSE:   paid_acquisition_daily (spend by paid channel),
 *              wearable_sync_daily (partner sync health by device type),
 *              subscription_billing_daily (list price and bookings by plan)
 * LOOKUPS:     none — every attribute is denormalized onto events/profiles
 *
 * IDENTITY: "account created" is the auth event (carries user_id + device_id)
 * and the first real event of every new member; 2 devices per member on
 * average. Signups spread across the day (seeded hour, see placeSignup). Every event carries user_id: there is no anonymous pre-signup
 * activity. An enrolled member's $experiment_started sits 1 s before
 * "account created" (engine placement) and also carries user_id. The three
 * onboarding steps after the auth event (goal quiz completed, plan
 * generated, starter workout completed) carry user_id only (no device_id);
 * every other event carries both.
 *
 * DESIGN NOTES:
 * - retentionCurve shapes new members' activity; pre-existing members'
 *   per-member activity is flat across the window (≈13 events a week).
 * - Engine workarounds (reported, central fix pending): (1) process.env.TZ is
 *   pinned to UTC at the top of this file, because the engine builds and parses
 *   a born member's `created` in local time; without the pin, birth days and
 *   signup times change with the machine's time zone. (2) The engine pins the
 *   signup (and the experiment exposure 1 s before it) at midnight of
 *   profile.created and never places a birth on the window's last day.
 *   placeSignup() moves each new member's stream to the day after
 *   profile.created (whole days: June 4 to October 1) and puts the onboarding
 *   block at a seeded hour drawn from the real-world hour-of-day weights;
 *   events that would precede the signup move with it. June 4 and October 1
 *   hold about half a day's signups each (the engine's birth draw gives its
 *   end days half weight). Verified byte-identical under America/New_York and
 *   Asia/Tokyo.
 * - The engine gives usage funnels only to members who finish the first
 *   funnel, so onboarding runs at 100% in the engine and abandonOnboarding()
 *   (H1) decides who finishes. Non-finishers keep a per-member share of their
 *   usage (uniform 30-80%) and half of their purchases never happen, so they
 *   still reach the paywall, trials, challenges, and Plus, just less often.
 * - Window-start trial pipeline: 16% of pre-window members joined in the 45
 *   days before June 4 (the in-window join rate, scaled for how much more
 *   often an all-window member reaches a trial). Each draws a join age and a signup-to-trial lag
 *   (lognormal, median 7.8 days, like new members'); when the lag outlasts
 *   the age (minus the 7-day trial) the member is trial_eligible, and the
 *   everything hook moves their first trial (with its paywall view and
 *   in-trial purchase) to that date. June trial starts and purchases run at
 *   the steady rate instead of ramping up from an empty pipeline.
 * - The engine draws births uniformly over the window and has no campaign
 *   acquisition knob. Summer Shred's extra members are produced by thinning
 *   the baseline outside the campaign (user hook returns null, scd-pre and
 *   everything return []) and re-attributing the same share inside it.
 * - Per-member salts use hashFloat(`${uid}|${tag}`) directly: its fmix32
 *   finalizer makes splits that share the member id independent.
 * - Warehouse drift: wearable_sync_daily and subscription_billing_daily
 *   re-count the Mixpanel units the way their source systems see them (the
 *   warehouse hook, seeded per date + series + unit): syncs post to the next
 *   day (18% average, ±60% day to day), some synced workouts never reach the
 *   app analytics (4%), partner retries double-count (2%); billing settles 6%
 *   of purchases the next day, drops 4% (failed or refunded first payment),
 *   and adds 4% store-page purchases with no app event. Audit corr vs the
 *   event count: ≈0.97 (sync) and ≈0.93 (billing), not 1.000.
 * - Engine edge (reported): June 4 holds ≈63% of a normal day's events.
 *   Multi-day usage funnels (Workout Loop 36 h, challenges 96 h, trial 7 d)
 *   spill later steps into the next days, and funnels that would have
 *   started before the window are not generated, so day 1 lacks that
 *   spill-in. The guides call June 4 a partial day.
 */

// ── HOOK STORIES ──
/*
 * All effects are hidden: no flag properties. Each is found by a breakdown,
 * a date comparison, or a cohort. Dates live in the TIMELINE constants and are
 * shared by hooks, stories, SQL, warehouse columns, and the timeline guide.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H1. GUIDED FIRST WEEK EXPERIMENT (declarative funnel experiment)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-07-01 new signups split 50/50. "Guided Plan" gets
 *   onboarding conversion × 1.3 (abandonOnboarding: Control and not-enrolled
 *   members finish at 45%) and onboarding time × 0.7 (declarative
 *   ttcMultiplier). Members who stop early engage less and buy Plus about half
 *   as often as finishers (13% vs 25%), never zero.
 * MIXPANEL: Funnels, account created → goal quiz completed → plan generated →
 *   starter workout completed, 7-day window, breakdown user property
 *   "Experiment: Guided First Week". Guided ≈ 60% vs Control ≈ 46%; median
 *   time to finish ≈ 12.5 h vs 18.0 h.
 * REAL WORLD: a guided first-week plan reduces choice paralysis for new users.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H2. STRIDE COACH LAUNCH (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-08-12, Plus workouts (event-time subscription_tier
 *   monthly/annual) can run with coaching_mode = "ai_coach". Adoption is per
 *   member: 60% of Plus members adopt (salted), and each adopter has their
 *   own full-use rate drawn from Beta(3, 1) (mean 75%, so use is spread, not
 *   all-or-nothing). Adopters' use ramps from 40% of their full rate on launch
 *   day to 100% after 21 days, so the Plus-workout share climbs from ≈22% in
 *   launch week to 0.6 × 0.75 = 45% from 2026-09-02. Coached sessions last
 *   1.2x longer (calories scale with the longer session). Free and pre-launch workouts stay self_guided.
 *   Heart rate, perceived effort, and calories per minute are untouched (an
 *   honest null: longer, not harder).
 * MIXPANEL: Insights, workout completed, average duration_minutes, breakdown
 *   coaching_mode, filter subscription_tier != free, after 2026-08-12; weekly
 *   share of ai_coach for the ramp.
 * REAL WORLD: real-time pacing cues keep people training longer.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H3. WEARABLE SYNC OUTAGE (everything + warehouse wearable_sync_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-08-20 to 2026-08-22, the partner health API fails. Only 25%
 *   of smartwatch and fitness-band workouts sync; chest straps (direct
 *   Bluetooth) and phone tracking are untouched. The warehouse table shows
 *   sync_error_rate ≈ 0.75 and partner_api_status = "major_outage" on those
 *   days for those devices.
 * MIXPANEL: Insights, workout completed, daily, breakdown tracking_source and
 *   wearable_type; join the warehouse sync_error_rate to explain the dip. The
 *   assertion divides watch + band workouts by all unaffected workouts (phone,
 *   manual, chest strap) to keep the 3-day denominator large.
 * REAL WORLD: third-party health-data integrations fail silently.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H4. PLUS MONTHLY PRICE CHANGE (everything + warehouse subscription_billing_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: on 2026-09-01 Plus Monthly goes from $12.99 to $14.99. 35% of
 *   would-be monthly purchases after that date never happen; Annual is
 *   untouched. Prices exist only in the warehouse table. Only ≈195 members
 *   buy after the change, so the plan-mix DiD is noisy (sd ≈ 0.11, from the
 *   Poisson noise of ≈90 Annual purchases): in the final run the pre-change
 *   mix is 605:301 = 2.01 (declared pool 2:1) and the post-change would-be
 *   mix is 107 / 0.65 : 88 = 1.87, so the DiD reads 0.60 (NAILED). A
 *   knob-derived floor backs the band for runs where the plan draw moves it.
 * MIXPANEL: Insights, subscription purchased, weekly, breakdown plan; the
 *   monthly/annual ratio drops after Sep 1. Bookings need the warehouse
 *   list_price_usd joined to purchases.
 * REAL WORLD: a 15% price rise on the entry plan costs more volume than it
 *   gains in price.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H5. SUMMER SHRED PAID SOCIAL (everything + warehouse paid_acquisition_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-06-15 to 2026-07-14, the campaign adds members: 25% of daily
 *   signups inside the window are extra paid-social members, so total daily
 *   signups rise 1.33x and every other channel keeps its daily volume.
 *   Paid-social CPI bids double (warehouse spend = installs × CPI × seeded
 *   ±10% day noise). Half of all paid-social signups never buy Plus.
 * MIXPANEL: Insights, account created, breakdown acquisition_channel, daily
 *   or weekly; join paid_acquisition_daily.spend_usd for spend per signup and
 *   cost per extra member; Funnels or Insights for Plus purchase rate by
 *   acquisition_channel. The buy-rate read rests on ≈120 paid-social buyers
 *   (sampling sd of the ratio ≈ 0.06) and on how active the buying half of
 *   paid-social members happens to be, so it can land on either side of the
 *   0.5 knob; the knob-derived floor (0.75) backs the NAILED ceiling.
 * REAL WORLD: a performance push buys real extra volume, at a higher CPI,
 *   from a lower-intent audience.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H6. FIRST-WEEK HABIT (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: a new member with k workouts in their first 7 days goes dark
 *   after day 14 with probability 0.6 × (1 − k/5), floored at 0 (0 → 60%,
 *   2 → 36%, 4 → 12%, 5+ → 0%). Retention climbs with each early workout;
 *   there is no cliff. Classification uses first-week activity only.
 *   Separately, 80% of all new members lapse on a uniform day in [8, 45]
 *   (organic churn, independent of the habit split), which sets realistic
 *   levels without touching the ratio.
 * MIXPANEL: Retention, birth account created → return any event, weekly
 *   unit, read the Week 4 bucket (days 28-34 after signup). Segment by
 *   first-week workouts with per-signup-week cohorts: members whose account
 *   created falls in week W and who did workout completed N+ times between
 *   the start of W and 7 days after its end (an approximation of each
 *   member's first 7 days; the exact per-member window needs the raw export).
 *   Raw-export values (each member's own first 7 days): Week 4 ≈ 17% for 0
 *   early workouts, ≈ 28% for 1-2, ≈ 43% for 3-4, ≈ 52% for 5+. The
 *   per-signup-week cohort approximation a Mixpanel user can build (workouts
 *   from the start of the signup week to 7 days after its end) reads ≈ 16%,
 *   26%, 33%, 48%. The knob sets a floor of 2.5x for 5+/0; busier members
 *   (and non-finishers' thinned usage, see H1) retain better or worse anyway,
 *   so the ratio sits above it (3.06 in the final run: STRONG, above the
 *   NAILED band).
 * REAL WORLD: the first week sets the habit; most fitness churn is early.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H7. TEAM VS SOLO CHALLENGES (declarative duplicate funnels)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: team challenges complete at 60% per challenge, solo at 30%.
 *   challenge_id identifies each challenge.
 * MIXPANEL: Funnels, challenge joined → challenge completed, totals, hold
 *   challenge_id constant, breakdown challenge_format.
 * REAL WORLD: social accountability finishes what motivation starts.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H8. PUSH FATIGUE (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: fatigue follows recent volume. A notification opens at the organic
 *   20% (declared pool, 1 in 5, typical for fitness-app push) while the member
 *   got at most 4 others in the previous 30 days. From there the chance a
 *   would-be open goes unopened ramps linearly to 60% at 12 recent
 *   notifications (open rate ≈ 8%). Pre-window members carry seeded
 *   pre-June-4 notifications at their own rate, so fatigue is steady from day
 *   1 and the open rate has no calendar trend (≈ 16% every month).
 * MIXPANEL: Insights, notification received, share with opened = true,
 *   breakdown by cohorts on notification count in the window (<12, 12-23,
 *   24-35, 36+): ≈ 19.5% → 17.5% → 14.7% → 11.1%. The exact 30-day look-back
 *   read (≈ 20% at 0-4 recent vs ≈ 8% at 12+) needs the raw export.
 * REAL WORLD: notification overload trains people to ignore the app.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H9. FALL RESET PROGRAM (declarative world event)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-09-08 for 14 days, workout planned, workout completed, and
 *   progress checked run at 1.5x (members log progress after the extra
 *   workouts, so the Workout Loop keeps its shape) and app opens at 1.2x (two
 *   world events); meal logging is untouched.
 * MIXPANEL: Insights, workout completed, app opened, meal logged, daily;
 *   formula workouts / app opens rises ≈ 1.26x and app opens / meals ≈ 1.19x
 *   during the program.
 * REAL WORLD: a back-to-routine program after Labor Day brings members back
 *   a bit more often and makes each visit a training session.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * EXPECTED METRICS SUMMARY (measured: data/verify-fitness, 2026-10-06)
 * ═════════════════════════════════════════════════════════════════════════
 * Hook | Metric                                      | Derivation              | Expected  | Measured
 * -----|---------------------------------------------|-------------------------|-----------|---------
 * H1   | onboarding conversion Guided/Control        | GUIDED_CONV_MULT        | 1.30      | 1.288 (59.7% vs 46.4%)
 * H1   | median onboarding TTC Guided/Control        | GUIDED_TTC_MULT         | 0.70      | 0.696
 * H1   | Guided share of enrolled                    | equal 2-arm hash        | 0.50      | 0.507
 * H1   | Plus buy rate, non-finishers / finishers    | NONFINISH_NO_BUY + thin | ≈ 0.5     | 0.52 (13.0% vs 25.2%)
 * H2   | ai_coach rows pre-launch or free tier       | exact purity            | 0         | 0
 * H2   | post-launch Plus duration ai/self           | AI_DURATION_MULT        | 1.20      | 1.206
 * H2   | Plus ai_coach share after the 21-day ramp   | ADOPTER_SHARE × USE     | 0.45      | 0.444
 * H2   | Plus members (10+ workouts) using it 25-74% | Beta(3,1) use rate      | spread    | 21.0% (42.0% never)
 * H3   | watch+band / unaffected, outage vs ±7 days  | OUTAGE_KEEP             | 0.25      | 0.250
 * H3   | warehouse sync_error_rate during outage     | 1 − OUTAGE_KEEP         | 0.75      | 0.752
 * H4   | monthly/annual purchases, after vs before   | 1 − MONTHLY_LOSS        | ≤ 0.65    | 0.605
 * H4   | monthly/annual bookings, after vs before    | 0.65 × 14.99/12.99      | ≤ 0.75    | 0.698
 * H4   | long-time free members buying in window     | DIRECT_CONV (realism)   | 3-8%      | 8.0%
 * H5   | paid-social spend per signup, Shred/rest    | SHRED_CPI_MULT          | 2.00      | 2.015
 * H5   | daily signups, Shred/rest (all channels)    | 1/(1 − SHRED_INCREMENTAL)| 1.33     | 1.357
 * H5   | daily signups, Shred/rest (non-paid-social) | control                 | 1.00      | 1.006
 * H5   | paid-social buy rate vs same-week others    | 1 − PAID_SOCIAL_NO_BUY  | ≤ 0.50    | 0.516
 * H6   | Week-4 retention, 5+ vs 0 early workouts    | ≥ 1/(1 − 0.6) (floor)   | ≥ 2.5     | 3.062 (51.7% vs 16.9%)
 * H6   | retention rises across 0 / 1-2 / 3-4 / 5+   | monotone churn share    | 3 steps   | 3
 * H7   | per-challenge completion, team              | TEAM_CONV               | 0.60      | 0.578
 * H7   | per-challenge completion, solo              | SOLO_CONV               | 0.30      | 0.291
 * H8   | open rate 12+ / 0-4 recent (30 d), from Jul 4 | 1 − PUSH_FATIGUE_FLIP | 0.40      | 0.393
 * H8   | open rate, 0-4 recent notifications         | declared pool 1 of 5    | 0.20      | 0.201
 * H8   | open rate falls across 4 count cohorts      | monotone fatigue        | 3 steps   | 3
 * H8   | pre-window members' open rate, Sep / Jun    | steady-state fatigue    | 1.00      | 0.991
 * H9   | completed per app open, program/before      | 1.5 / 1.2               | 1.25      | 1.213
 * H9   | planned per app open, program/before        | 1.5 / 1.2               | 1.25      | 1.230
 * H9   | app opens per meal logged, program/before   | FALL_RESET_OPEN_MULT    | 1.20      | 1.203
 * --   | progress checks per completed workout       | Fall Reset 1.5x on both | flat      | 0.641 → 0.644
 * --   | signups: distinct timestamps / hours used   | placeSignup             | spread    | 4,074 / 24 hours
 * --   | June new subscriptions per day vs Jul-Aug   | trial pipeline seeding  | no ramp   | 9.3 vs 10.6 (flat within June)
 * --   | warehouse corr vs events: sync / billing    | drift knobs             | 0.9-0.98  | 0.964 / 0.933
 * ═════════════════════════════════════════════════════════════════════════
 */

// ── SCALE ──
const SEED = "dm4-fitness";
const NUM_USERS = 10_000;
const DATASET_START = "2026-06-04T00:00:00Z";
const DATASET_END = "2026-10-01T23:59:59Z"; // 120 days
const EVENTS_PER_DAY = 1.2;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── TIMELINE (shared by hooks, stories, SQL, warehouse columns, guides) ──
const SUMMER_SHRED_START = "2026-06-15T00:00:00Z"; // paid-social push, CPI bids raised
const SUMMER_SHRED_END = "2026-07-15T00:00:00Z";   // exclusive
const GUIDED_TEST_START = "2026-07-01T00:00:00Z";  // "Guided First Week" onboarding A/B
const AI_COACH_LAUNCH = "2026-08-12T00:00:00Z";    // Stride Coach (AI coaching) for Plus
const SYNC_OUTAGE_START = "2026-08-20T00:00:00Z";  // partner health-API outage
const SYNC_OUTAGE_END = "2026-08-23T00:00:00Z";    // exclusive (3 days)
const PRICE_CHANGE = "2026-09-01T00:00:00Z";       // Plus Monthly $12.99 → $14.99
const FALL_RESET_START = "2026-09-08T00:00:00Z";   // Fall Reset program (14 days)
const FALL_RESET_DAYS = 14;

const ms = (iso) => dayjs.utc(iso).valueOf();
const dayIndex = (iso) => Math.round((ms(iso) - ms(DATASET_START)) / 86_400_000);

// ── KNOBS ──
// signup placement (engine workaround, see placeSignup): a new member's signup
// lands on their birth day at an hour drawn from the app's hour-of-day profile
// (the engine's real-world UTC weights), not at midnight
const SIGNUP_HOUR_WEIGHTS = [
	0.949, 0.992, 0.998, 0.946, 0.895, 0.938, 1.0, 0.997,
	0.938, 0.894, 0.827, 0.786, 0.726, 0.699, 0.688, 0.643,
	0.584, 0.574, 0.554, 0.576, 0.604, 0.655, 0.722, 0.816,
];

// H1 Guided First Week (experiment on the onboarding funnel)
const GUIDED_EXPERIMENT = "Guided First Week";
const GUIDED_VARIANT = "Guided Plan";
const GUIDED_CONV_MULT = 1.3;
const GUIDED_TTC_MULT = 0.7;
// The engine gives usage funnels (paywall, trials, challenges, coaching) only to
// members who finish the first funnel, so it runs onboarding at 100% and the
// everything hook models abandonment: Control (and not-enrolled) members finish
// at ONBOARDING_CONV, Guided Plan at ONBOARDING_CONV × GUIDED_CONV_MULT.
const ONBOARDING_ENGINE_CONV = 100;
const ONBOARDING_CONV = 45;
const ONBOARDING_TTC_H = 24;
// last onboarding step a non-finisher reaches: account created / goal quiz completed / plan generated
const ABANDON_AFTER = [0.45, 0.3, 0.25];
// non-finishers are lower-intent: each keeps a share of the usage the engine drew
// (salted per member, uniform in [MIN, MAX], mean 0.55), and half of their
// would-be purchases never happen. They still reach the paywall, trials, and
// challenges, just less often.
const NONFINISH_KEEP_MIN = 0.3;
const NONFINISH_KEEP_MAX = 0.8;
const NONFINISH_NO_BUY = 0.5;

// H2 Stride Coach: adoption is per member, and ramps up over the first weeks
const AI_ADOPTER_SHARE = 0.6;      // share of Plus members who adopt Stride Coach (salted per member)
const AI_ADOPTER_USE = 0.75;       // mean share of an adopter's workouts run with Stride Coach once the ramp ends
const AI_USE_SHAPE = AI_ADOPTER_USE / (1 - AI_ADOPTER_USE); // per-adopter use rate ~ Beta(3, 1): spread out, mean 0.75
const AI_ADOPTION = Math.round(AI_ADOPTER_SHARE * AI_ADOPTER_USE * 1000) / 1000; // steady-state share of Plus workouts (0.45)
const AI_RAMP_DAYS = 21;           // days after launch until adopters reach full use
const AI_RAMP_FLOOR = 0.4;         // adopters' use on launch day, as a share of full use
const AI_DURATION_MULT = 1.2;

// H3 wearable sync outage
const OUTAGE_TYPES = ["smartwatch", "fitness_band"]; // devices that sync through the partner health API
const OUTAGE_KEEP = 0.25;          // share of affected wearable workouts that still sync

// H4 Plus Monthly price change
const PRICE_MONTHLY_OLD = 12.99;
const PRICE_MONTHLY_NEW = 14.99;
const PRICE_ANNUAL = 99.99;
const MONTHLY_LOSS = 0.35;         // share of post-change monthly purchases lost
// long-time free members (trial already used) rarely buy straight from the
// paywall: ≈ 1% per paywall visit, a few percent of the free pool per quarter
const DIRECT_CONV = 1;
// trial funnel (paywall → trial → purchase): ≈ half of new members start a trial
// and ≈ 40% of trials convert, so ≈ 1 in 5 new members buys Plus
const TRIAL_CONV = 26;
// window-start trial pipeline: this share of pre-window members joined in the
// RECENT_JOIN_DAYS before June 4; those whose signup-to-trial lag outlasts their
// age still have a trial to start (or one still running) in the window (new
// members' lag: median ≈ 7.8 days, lognormal). Sized from the in-window join rate
// (≈ 31 signups a day outside campaigns × 45 days ≈ 1,400 of ≈ 5,000 pre-window
// members, 28%) × ≈ 0.55: a pre-window member is active all window and nearly
// always reaches a trial, while about half of new members do. June trial starts
// and purchases then run at the steady rate.
const RECENT_JOIN_SHARE = 0.16;
const RECENT_JOIN_DAYS = 45;
const TRIAL_LAG_MEDIAN_DAYS = 7.8;
const TRIAL_LAG_SIGMA = 0.7;
const TRIAL_PAIR_DAYS = 8;         // a trial's own purchase lands within the 7-day trial (+1 day)

// H5 Summer Shred paid social
const PAID_CHANNELS = ["paid_social", "paid_search", "app_store_ads"];
const CPI_USD = { paid_social: 9, paid_search: 14, app_store_ads: 6 };
const CPI_NOISE = 0.1;             // ± day-level CPI variation per channel (seeded)
const SHRED_CPI_MULT = 2;          // paid_social CPI bids during Summer Shred
// Summer Shred adds members: inside the campaign window, this share of daily
// signups are extra paid-social members on top of the baseline. Births are
// uniform in the engine, so the baseline outside the window is thinned by the
// same share (those would-be members never exist) and, inside the window, the
// same share of non-paid-social births are re-attributed to paid social. Net:
// every non-paid-social channel keeps its daily volume, total daily signups
// rise 1/(1 − 0.25) = 1.33x, and all of the extra arrives through paid social.
const SHRED_INCREMENTAL = 0.25;
const PAID_SOCIAL_NO_BUY = 0.5;    // share of paid_social signups that never buy Plus

// H6 first-week habit
const HABIT_DAYS = 7;
const HABIT_MIN_WORKOUTS = 3;
const HABIT_CHURN_AFTER_DAYS = 14;
// share of new members who go dark after day 14, by first-week workout count k:
// HABIT_CHURN_MAX × (1 − k / HABIT_SAFE_WORKOUTS), floored at 0 (0 → 60%, 1 → 48%,
// 2 → 36%, 3 → 24%, 4 → 12%, 5+ → 0%): each extra early workout helps, no cliff
const HABIT_CHURN_MAX = 0.6;
const HABIT_SAFE_WORKOUTS = 5;
const habitChurnShare = (k) => HABIT_CHURN_MAX * Math.max(0, 1 - k / HABIT_SAFE_WORKOUTS);
// organic new-member lapse (applies to every new member, independent of H6):
// this share stop using the app on a uniform day in [8, 45] after signup
const LAPSE_SHARE = 0.8;
const LAPSE_DAY_MIN = 8;
const LAPSE_DAY_MAX = 45;

// H7 team vs solo challenges
const TEAM_CONV = 60;
const SOLO_CONV = 30;
const CHALLENGE_TTC_H = 96;

// H8 notification fatigue follows recent volume: k = notifications the member
// received in the PUSH_FATIGUE_WINDOW_DAYS before this one. Up to
// PUSH_FATIGUE_START it opens at the organic rate; from there the chance that a
// would-be open goes unopened ramps linearly to PUSH_FATIGUE_FLIP at
// PUSH_FATIGUE_FULL. Pre-window members carry their pre-June-4 notifications
// (seeded at their own rate), so fatigue is already steady on day 1.
const PUSH_OPEN_POOL = [true, false, false, false, false]; // declared `opened` pool: organic open rate 1 in 5
const PUSH_OPEN_RATE = PUSH_OPEN_POOL.filter(Boolean).length / PUSH_OPEN_POOL.length; // 0.2, industry-typical
const PUSH_FATIGUE_WINDOW_DAYS = 30;
const PUSH_FATIGUE_START = 4;      // ≈ the median notification's trailing-30-day count
const PUSH_FATIGUE_FULL = 12;      // ≈ p90
const PUSH_FATIGUE_FLIP = 0.6;     // share of would-be opens lost once fully fatigued
const pushFlip = (k) => PUSH_FATIGUE_FLIP * Math.min(1, Math.max(0, (k - PUSH_FATIGUE_START) / (PUSH_FATIGUE_FULL - PUSH_FATIGUE_START)));

// H9 Fall Reset program
const FALL_RESET_MULT = 1.5;
// members log progress after their extra workouts too, so the Workout Loop keeps its shape
const FALL_RESET_EVENTS = ["workout planned", "workout completed", "progress checked"];
const FALL_RESET_OPEN_MULT = 1.2;  // the program also brings members into the app a bit more

// warehouse drift: source systems disagree with the Mixpanel count the way real
// pipelines do (each unit draws independently, seeded on date + series + ordinal)
// wearable_sync_daily counts partner-side syncs by sync day:
const SYNC_LATE_SHARE = 0.18;      // average share of a day's workouts that sync after midnight UTC (next day's row)
const SYNC_LATE_SPREAD = 0.6;      // day-to-day swing of that share (± 60%: partner batching, devices reconnecting late)
const SYNC_UNTRACKED_SHARE = 0.04; // synced workouts whose app event never reached analytics (app not reopened)
const SYNC_RETRY_DUP_SHARE = 0.02; // partner retries counted twice
// subscription_billing_daily counts settled first payments by settlement day:
const BILL_LATE_SHARE = 0.06;      // store settlement posts the purchase to the next UTC day
const BILL_FAILED_SHARE = 0.04;    // first payment failed or refunded within 48 h: not booked
const BILL_STORE_ONLY_SHARE = 0.04; // bought from the store's subscription page: billed, no app event

// workout calorie model (kcal per minute at moderate effort)
const KCAL_PER_MIN = { strength: 6, running: 10.5, hiit: 11, yoga: 3.5, cycling: 8.5, walking: 4.5 };

// lifecycle hygiene
const DEACTIVATION_QUIET_DAYS = 21;

// ── HELPERS ──
// members the Summer Shred baseline thinning removes (see SHRED_INCREMENTAL);
// filled by the user hook, read by the scd-pre and everything hooks
const NOT_ACQUIRED = new Set();
// pre-window members still waiting to start their trial → trial start time (ms);
// filled by the user hook, read by the everything hook
const PENDING_TRIAL = new Map();
// hashFloat ends in an fmix32 finalizer, so salts that share the member id are independent
const salt = (uid, tag) => hashFloat(`${uid}|${tag}`);
const round2 = (n) => Math.round(n * 100) / 100;
const inShred = (t) => t >= ms(SUMMER_SHRED_START) && t < ms(SUMMER_SHRED_END);
const inOutage = (t) => t >= ms(SYNC_OUTAGE_START) && t < ms(SYNC_OUTAGE_END);
const monthlyPrice = (t) => (t >= ms(PRICE_CHANGE) ? PRICE_MONTHLY_NEW : PRICE_MONTHLY_OLD);
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const T = (e) => dayjs.utc(e.time).valueOf();
const iso = (t) => new Date(t).toISOString();
const DAY = 86_400_000;
const utcDay = (t) => Math.floor(t / DAY) * DAY;
// engine births span profile.created days [window start − 1, window end − 1]
// (the window-start day is clamped to June 4 00:00); a member's signup day is
// the day after, so signups cover June 4 to October 1
const signupDay = (created) => utcDay(dayjs.utc(created).valueOf()) + DAY;
const ONBOARDING_STEPS = ["account created", "goal quiz completed", "plan generated", "starter workout completed"];
const ONBOARDING_BLOCK = new Set(["$experiment_started", ...ONBOARDING_STEPS]);
const EXP_KEY = `Experiment: ${GUIDED_EXPERIMENT}`;
/** Pre-window member who joined in the RECENT_JOIN_DAYS before June 4: their age in days, else null. */
const recentJoinAge = (uid) => (salt(uid, "recent-joiner") < RECENT_JOIN_SHARE ? salt(uid, "join-age") * RECENT_JOIN_DAYS : null);
/** Seeded time of day (ms after midnight UTC) for a new member's signup. */
function signupOffsetMs(uid) {
	const total = SIGNUP_HOUR_WEIGHTS.reduce((a, b) => a + b, 0);
	let r = salt(uid, "signup-hour") * total, hour = 0;
	while (hour < 23 && r >= SIGNUP_HOUR_WEIGHTS[hour]) { r -= SIGNUP_HOUR_WEIGHTS[hour]; hour++; }
	return hour * 3_600_000 + Math.floor(salt(uid, "signup-second") * 3_600_000);
}

function handleUserHook(profile, meta) {
	// pre-existing members already hold a plan; new signups start on Free
	if (meta.userIsBornInDataset) {
		// ── H5a: Summer Shred adds paid-social members (births are uniform) ──
		const uid = profile.distinct_id;
		const birth = signupDay(meta.user.created);
		if (!inShred(birth) && salt(uid, "shred-base") < SHRED_INCREMENTAL) {
			NOT_ACQUIRED.add(uid);
			return null;
		}
		if (inShred(birth) && profile.acquisition_channel !== "paid_social" && salt(uid, "shred") < SHRED_INCREMENTAL) {
			profile.acquisition_channel = "paid_social";
		}
		profile.subscription_tier = "free";
		profile.trial_eligible = true;
		return profile;
	}
	// ── trial pipeline at window start: some pre-window members joined in the
	// weeks before June 4 and have not started their trial yet. Each draws a join
	// age and a signup-to-trial lag (lognormal, like new members'); a lag longer
	// than the age leaves a trial still to come inside the window.
	const uid = profile.distinct_id;
	const ageDays = recentJoinAge(uid);
	if (ageDays !== null) {
		const z = Math.sqrt(-2 * Math.log(1 - salt(uid, "lag-a"))) * Math.cos(2 * Math.PI * salt(uid, "lag-b"));
		const lagDays = TRIAL_LAG_MEDIAN_DAYS * Math.exp(TRIAL_LAG_SIGMA * z);
		// a trial that started up to TRIAL_PAIR_DAYS before June 4 can still convert inside the window
		if (lagDays > ageDays - TRIAL_PAIR_DAYS) {
			PENDING_TRIAL.set(uid, ms(DATASET_START) + (lagDays - ageDays) * 86_400_000);
			profile.subscription_tier = "free";
			profile.trial_eligible = true;
			return profile;
		}
	}
	profile.trial_eligible = false;
	const mix = {
		athlete: [25, 30, 45],
		trainer: [10, 30, 60],
		social: [50, 35, 15],
		casual: [70, 20, 10],
		beginner: [85, 10, 5],
	}[profile.segment] || [70, 20, 10];
	profile.subscription_tier = chance.weighted(["free", "monthly", "annual"], mix);
	return profile;
}

function seedPendingTrial(events, trial, trialAt) {
	if (!trial) return events;
	const START = ms(DATASET_START), END = ms(DATASET_END);
	const t0 = T(trial);
	// the trial's own purchase converts within the trial (later purchases belong to other passes)
	const buy = events.filter((e) => e.event === "subscription purchased" && T(e) >= t0 && T(e) <= t0 + TRIAL_PAIR_DAYS * 86_400_000)
		.sort((a, b) => T(a) - T(b))[0];
	const wall = events.filter((e) => e.event === "paywall viewed" && T(e) <= t0).sort((a, b) => T(b) - T(a))[0];
	const delta = trialAt - t0;
	for (const e of [wall, trial, buy]) if (e) e.time = new Date(T(e) + delta).toISOString();
	// a trial (or its paywall view) that began before June 4 is outside the window
	return events.filter((e) => {
		if (e.event === "subscription purchased" && e !== buy) return false;
		return T(e) >= START && T(e) <= END;
	});
}

/**
 * Engine workaround (reported): the engine pins a new member's signup (and the
 * experiment exposure 1 s before it) at midnight of profile.created, and births
 * never land on the window's last day. Move the member's stream to their signup
 * day (whole days, so hour-of-day and gaps are kept), then put the onboarding
 * block at a seeded time of day; events that would now precede the signup move
 * with it. profile.created becomes the signup time.
 */
function placeSignup(events, profile, uid) {
	const signup = events.find((e) => e.event === "account created");
	if (!signup || !profile.created) return events;
	const S = T(signup);
	const day = signupDay(profile.created);
	const dayShift = day - utcDay(S);
	if (dayShift) for (const e of events) e.time = iso(T(e) + dayShift);
	const S2 = day + signupOffsetMs(uid);
	const h = S2 - (S + dayShift);
	for (const e of events) if (ONBOARDING_BLOCK.has(e.event) || T(e) < S2) e.time = iso(T(e) + h);
	profile.created = iso(S2);
	const END = ms(DATASET_END);
	return events.filter((e) => T(e) <= END);
}

/** Latest paywall view at or before an event (the view that led to it). */
const paywallBefore = (events, e) => (e ? events.filter((x) => x.event === "paywall viewed" && T(x) <= T(e)).sort((a, b) => T(b) - T(a))[0] : undefined);

/**
 * H1 abandonment: the engine ran onboarding at 100%. A seeded share of new
 * members finish (Control and not enrolled: ONBOARDING_CONV; Guided Plan: ×
 * GUIDED_CONV_MULT); the rest stop after an earlier step, keep a per-member
 * share of their usage, and buy less often.
 */
function abandonOnboarding(events, profile, uid) {
	const pFinish = (ONBOARDING_CONV / 100) * (profile[EXP_KEY] === GUIDED_VARIANT ? GUIDED_CONV_MULT : 1);
	if (salt(uid, "onb-finish") < pFinish) return events;
	let r = salt(uid, "onb-stop"), last = 0;
	while (last < ABANDON_AFTER.length - 1 && r >= ABANDON_AFTER[last]) { r -= ABANDON_AFTER[last]; last++; }
	const skipped = new Set(ONBOARDING_STEPS.slice(last + 1));
	events = events.filter((e) => !skipped.has(e.event));
	// the purchase is decided at member level; a kept purchase keeps the trial and
	// paywall views that led to it, everything else is thinned event by event
	const buy = events.find((e) => e.event === "subscription purchased");
	const keepBuy = !!buy && salt(uid, "onb-nobuy") >= NONFINISH_NO_BUY;
	const chain = new Set();
	if (keepBuy) {
		const trial = events.filter((e) => e.event === "trial started" && T(e) <= T(buy)).sort((a, b) => T(a) - T(b))[0];
		for (const e of [buy, trial, paywallBefore(events, trial), paywallBefore(events, buy)]) if (e) chain.add(e);
	}
	const keep = NONFINISH_KEEP_MIN + (NONFINISH_KEEP_MAX - NONFINISH_KEEP_MIN) * salt(uid, "onb-engage");
	return events.filter((e) => ONBOARDING_BLOCK.has(e.event) || chain.has(e) || (e !== buy && chance.bool({ likelihood: keep * 100 })));
}

/**
 * H8: seeded pre-June-4 notification times for a pre-window member, at the
 * member's own in-window rate, over the fatigue window (or since they joined).
 */
function priorPushTimes(uid, inWindowCount) {
	const START = ms(DATASET_START);
	const age = recentJoinAge(uid);
	const span = age === null ? PUSH_FATIGUE_WINDOW_DAYS : Math.min(PUSH_FATIGUE_WINDOW_DAYS, age);
	const rate = inWindowCount / ((ms(DATASET_END) - START) / DAY);
	const n = Math.floor(rate * span + salt(uid, "push-prior-n"));
	return Array.from({ length: n }, (_, j) => START - salt(uid, `push-prior-${j}`) * span * DAY);
}

function handleEverything(events, meta) {
	if (!events.length) return events;
	const profile = meta.profile;
	const uid = profile.distinct_id;
	if (NOT_ACQUIRED.has(uid)) return [];
	const START = ms(DATASET_START);
	const END = ms(DATASET_END);

	// ── signup placement (engine workaround): birth day + seeded time of day ──
	if (meta.userIsBornInDataset) events = placeSignup(events, profile, uid);
	const signup = events.find((e) => e.event === "account created");
	const birthMs = signup ? T(signup) : null;

	// ── trial hygiene: one free trial per member ──
	const firstTrial = events.filter((e) => e.event === "trial started").sort((a, b) => T(a) - T(b))[0];
	if (firstTrial) events = events.filter((e) => e.event !== "trial started" || e === firstTrial);

	// ── window-start trial pipeline: a pre-window member's pending trial (with its
	// paywall view and, if it converts, its purchase) moves to their trial date ──
	if (PENDING_TRIAL.has(uid)) events = seedPendingTrial(events, firstTrial, PENDING_TRIAL.get(uid));

	// ── purchase hygiene: a member buys Plus once; later upgrade passes vanish ──
	const firstBuy = events.filter((e) => e.event === "subscription purchased").sort((a, b) => T(a) - T(b))[0];
	if (firstBuy) {
		const t0 = T(firstBuy);
		events = events.filter((e) => {
			if (e === firstBuy) return true;
			if (e.event === "subscription purchased") return false;
			if ((e.event === "trial started" || e.event === "paywall viewed") && T(e) > t0) return false;
			return true;
		});
	}

	// ── H1: onboarding abandonment; non-finishers engage and buy less ──
	if (signup) events = abandonOnboarding(events, profile, uid);

	// ── H5b: half of paid-social signups never buy ──
	let purchase = events.find((e) => e.event === "subscription purchased");
	if (purchase && profile.acquisition_channel === "paid_social" && salt(uid, "nobuy") < PAID_SOCIAL_NO_BUY) {
		events = events.filter((e) => e !== purchase);
		purchase = null;
	}

	// ── H4a: Plus Monthly price change loses a share of monthly purchases ──
	if (purchase && purchase.plan === "monthly" && T(purchase) >= ms(PRICE_CHANGE) && chance.bool({ likelihood: MONTHLY_LOSS * 100 })) {
		events = events.filter((e) => e !== purchase);
		purchase = null;
	}

	// ── H6: first-week habit — fewer early workouts, more likely to go dark after day 14 ──
	if (signup) {
		const habitEnd = birthMs + HABIT_DAYS * 86_400_000;
		const early = events.filter((e) => e.event === "workout completed" && T(e) >= birthMs && T(e) < habitEnd).length;
		if (salt(uid, "habit") < habitChurnShare(early)) {
			const cut = birthMs + HABIT_CHURN_AFTER_DAYS * 86_400_000;
			events = events.filter((e) => T(e) < cut);
			if (purchase && T(purchase) >= cut) purchase = null;
		}
		// organic lapse: most new members drift away at some point after week one
		if (salt(uid, "lapse") < LAPSE_SHARE) {
			const lapseDay = LAPSE_DAY_MIN + salt(uid, "lapse-day") * (LAPSE_DAY_MAX - LAPSE_DAY_MIN);
			const cut = birthMs + lapseDay * 86_400_000;
			events = events.filter((e) => T(e) < cut);
			if (purchase && T(purchase) >= cut) purchase = null;
		}
	}

	// ── H3: partner health-API outage — most smartwatch / band workouts never sync ──
	const oStart = ms(SYNC_OUTAGE_START), oEnd = ms(SYNC_OUTAGE_END);
	events = events.filter((e) => !(e.event === "workout completed" && e.tracking_source === "wearable"
		&& OUTAGE_TYPES.includes(e.wearable_type) && T(e) >= oStart && T(e) < oEnd
		&& !chance.bool({ likelihood: OUTAGE_KEEP * 100 })));

	// ── plan at event time (superProp subscription_tier) + final profile plan ──
	const initialTier = profile.subscription_tier;
	const buyMs = purchase ? T(purchase) : Infinity;
	for (const e of events) e.subscription_tier = T(e) >= buyMs ? purchase.plan : initialTier;
	if (purchase) profile.subscription_tier = purchase.plan;

	// ── H2: Stride Coach — adopting Plus members, ramping up after launch, longer sessions ──
	const launch = ms(AI_COACH_LAUNCH);
	const adopter = salt(uid, "coach-adopter") < AI_ADOPTER_SHARE;
	// each adopter has their own use rate: Beta(a, 1) via inverse CDF u^(1/a), mean AI_ADOPTER_USE
	const useRate = salt(uid, "coach-use") ** (1 / AI_USE_SHAPE);
	for (const e of events) {
		if (e.event === "paywall viewed" && e.paywall_trigger === "coach_teaser" && T(e) < launch) {
			// the Stride Coach teaser only exists on the paywall from launch day
			e.paywall_trigger = chance.pickone(["workout_library", "advanced_plans", "challenge_limit", "settings"]);
		}
		if (!adopter) continue;
		const ramp = AI_RAMP_FLOOR + (1 - AI_RAMP_FLOOR) * Math.min(1, (T(e) - launch) / (AI_RAMP_DAYS * 86_400_000));
		if ((e.event === "workout completed" || e.event === "workout planned") && T(e) >= launch && e.subscription_tier !== "free"
			&& chance.bool({ likelihood: useRate * ramp * 100 })) {
			e.coaching_mode = "ai_coach";
			if (e.event === "workout completed") {
				e.duration_minutes = Math.round(e.duration_minutes * AI_DURATION_MULT);
				e.calories_burned = Math.round(e.calories_burned * AI_DURATION_MULT); // longer session, same intensity
			}
			else e.planned_duration_minutes = Math.round(e.planned_duration_minutes * AI_DURATION_MULT);
		}
	}

	// ── deactivation hygiene: one deactivation, only for members who actually went quiet ──
	const deacts = events.filter((e) => e.event === "account deactivated");
	events = events.filter((e) => e.event !== "account deactivated");
	if (deacts.length && events.length) {
		const last = events.reduce((m, e) => Math.max(m, T(e)), 0);
		if (last < END - DEACTIVATION_QUIET_DAYS * 86_400_000) {
			const when = last + chance.integer({ min: 20, max: 180 }) * 60_000;
			const d = cloneEvent(deacts[0], { time: new Date(when).toISOString() });
			d.subscription_tier = profile.subscription_tier;
			events.push(d);
		}
	}

	// ── H8: notification fatigue — the more notifications in the last 30 days, the fewer opens ──
	const pushes = events.filter((e) => e.event === "notification received").sort((a, b) => T(a) - T(b));
	const prior = signup ? [] : priorPushTimes(uid, pushes.length);
	const win = PUSH_FATIGUE_WINDOW_DAYS * DAY;
	let j = 0;
	pushes.forEach((p, i) => {
		const t = T(p);
		while (T(pushes[j]) < t - win) j++;
		const recent = (i - j) + prior.filter((x) => x >= t - win).length;
		const flip = pushFlip(recent);
		if (flip > 0 && p.opened === true && chance.bool({ likelihood: flip * 100 })) p.opened = false;
	});

	return events;
}

// carried-over units per warehouse series (rows arrive in date order per series)
const CARRY = new Map();
/**
 * Re-count a day's Mixpanel units the way a source system sees them: each unit
 * may post to the next day, be dropped, or be joined by a system-only unit.
 * Returns the system-side count for the day (incoming carry included).
 */
function driftCount(key, row, count, { late, lateSpread = 0, drop, extra, dup = 0 }, firstBucket) {
	if (firstBucket) CARRY.set(key, 0);
	let out = CARRY.get(key) || 0, carry = 0;
	const lateToday = late * (1 + (hashFloat(`${key}|${row.date}|late-day`) - 0.5) * 2 * lateSpread);
	for (let i = 0; i < count; i++) {
		const tag = `${key}|${row.date}|${i}`;
		if (hashFloat(`${tag}|drop`) < drop) continue;
		if (hashFloat(`${tag}|late`) < lateToday) carry++;
		else out++;
		if (hashFloat(`${tag}|extra`) < extra) out++;
		if (hashFloat(`${tag}|dup`) < dup) out++;
	}
	CARRY.set(key, carry);
	return out;
}

function handleWarehouse(row, meta) {
	if (meta.isBackfill) return row;
	const count = meta.raw.plus.count;
	const first = meta.bucketIndex === 0;
	if (meta.metricName === "paid_acquisition_daily") {
		// performance channels bill per install (CPI); Summer Shred raised paid-social bids
		const channel = row.acquisition_channel;
		const t = dayjs.utc(row.date).valueOf();
		const mult = channel === "paid_social" && inShred(t) ? SHRED_CPI_MULT : 1;
		const noise = 1 + (hashFloat(`cpi|${row.date}|${channel}`) - 0.5) * 2 * CPI_NOISE;
		row.spend_usd = round2(count * CPI_USD[channel] * mult * noise);
	}
	else if (meta.metricName === "wearable_sync_daily") {
		// partner-side syncs by sync day: late syncs, untracked syncs, retry duplicates
		row.synced_workouts = driftCount(`sync|${row.wearable_type}`, row, count,
			{ late: SYNC_LATE_SHARE, lateSpread: SYNC_LATE_SPREAD, drop: 0, extra: SYNC_UNTRACKED_SHARE, dup: SYNC_RETRY_DUP_SHARE }, first);
		row.sync_requests = Math.round(row.synced_workouts / Math.max(0.05, 1 - row.sync_error_rate));
	}
	else if (meta.metricName === "subscription_billing_daily") {
		// settled first payments by settlement day: late settlement, failed / refunded, store-only purchases
		row.new_subscriptions = driftCount(`bill|${row.plan}`, row, count,
			{ late: BILL_LATE_SHARE, drop: BILL_FAILED_SHARE, extra: BILL_STORE_ONLY_SHARE }, first);
		row.gross_bookings_usd = round2(row.new_subscriptions * row.list_price_usd);
		row.store_fees_usd = round2(row.gross_bookings_usd * 0.15);
		row.net_bookings_usd = round2(row.gross_bookings_usd - row.store_fees_usd);
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
	macro: { percentUsersBornInDataset: 50, bornRecentBias: 0, preExistingSpread: "uniform" },
	credentials: { token },
	switches: {
		hasSessionIds: true,
		alsoInferFunnels: false,
		hasLocation: true,
		hasAndroidDevices: true,
		hasIOSDevices: true,
		hasDesktopDevices: false,
		hasBrowser: false,
		hasCampaigns: false,
		isAnonymous: false,
		hasAdSpend: false,
		hasAvatar: true,
	},
	identity: { avgDevicePerUser: 2 },
	stickyEventProps: ["Platform"],

	scdProps: {
		fitness_level: {
			values: ["beginner", "intermediate", "advanced", "elite"],
			frequency: "month",
			timing: "fuzzy",
			max: 6,
		},
	},

	events: [
		{
			event: "account created",
			weight: 1,
			isFirstEvent: true,
			isAuthEvent: true,
			properties: {
				acquisition_channel: (ctx) => ctx.profile.acquisition_channel,
			},
		},
		{
			event: "goal quiz completed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				primary_goal: (ctx) => ctx.profile.primary_goal,
				days_per_week_target: [2, 3, 3, 4, 4, 5],
			},
		},
		{
			event: "plan generated",
			weight: 1,
			isStrictEvent: true,
			properties: {
				plan_length_weeks: [4, 6, 8, 12],
				workout_category: ["strength", "running", "hiit", "yoga", "cycling", "walking"],
			},
		},
		{
			event: "starter workout completed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				duration_minutes: [8, 10, 10, 12, 15],
			},
		},
		{
			event: "workout planned",
			weight: 6,
			isStrictEvent: false,
			properties: {
				planned_duration_minutes: u.weighNumRange(15, 75, 0.6, 30),
				workout_category: ["strength", "running", "hiit", "yoga", "cycling", "walking"],
				coaching_mode: ["self_guided"],
			},
		},
		{
			event: "workout completed",
			weight: 8,
			isStrictEvent: false,
			properties: {
				workout_category: ["strength", "running", "hiit", "yoga", "cycling", "walking"],
				duration_minutes: u.weighNumRange(10, 90, 0.5, 40),
				avg_heart_rate: u.weighNumRange(90, 175, 0.6, 40),
				perceived_effort: [3, 4, 5, 5, 6, 6, 7, 7, 8, 9],
				// minutes × category burn rate × effort, with person-to-person spread
				calories_burned: (ctx) => {
					const e = ctx.event || {};
					const rate = KCAL_PER_MIN[e.workout_category] || 6;
					const effort = 0.7 + 0.05 * (Number(e.perceived_effort) || 6);
					return Math.max(20, Math.round((Number(e.duration_minutes) || 30) * rate * effort * chance.normal({ mean: 1, dev: 0.12 })));
				},
				coaching_mode: ["self_guided"],
				wearable_type: (ctx) => ctx.profile.wearable_type,
				tracking_source: (ctx) => ctx.profile.wearable_type === "none"
					? chance.pickone(["phone", "phone", "manual"])
					: chance.pickone(["wearable", "wearable", "wearable", "wearable", "wearable", "phone"]),
			},
		},
		{
			event: "progress checked",
			weight: 5,
			isStrictEvent: false,
			properties: {
				metric_viewed: ["weekly_minutes", "workout_streak", "body_weight", "personal_records", "heart_rate_trend"],
				time_range: ["week", "month", "3_months"],
			},
		},
		{
			event: "meal logged",
			weight: 6,
			properties: {
				meal_type: ["breakfast", "lunch", "dinner", "snack"],
				calories: u.weighNumRange(80, 1100, 0.5, 40),
				protein_g: u.weighNumRange(2, 70, 0.5, 30),
			},
		},
		{
			event: "challenge joined",
			weight: 2,
			properties: {
				challenge_id: ["unassigned"],
				challenge_format: ["solo"],
				challenge_type: ["steps", "strength", "streak", "distance"],
				duration_days: [7, 14, 21, 30],
			},
		},
		{
			event: "challenge completed",
			weight: 1,
			properties: {
				challenge_id: ["unassigned"],
				challenge_format: ["solo"],
				challenge_type: ["steps", "strength", "streak", "distance"],
				final_rank: u.weighNumRange(1, 60, 0.3, 30),
			},
		},
		{
			event: "friend added",
			weight: 2,
			properties: {
				source: ["contacts", "search", "challenge", "suggested"],
			},
		},
		{
			event: "leaderboard viewed",
			weight: 3,
			properties: {
				leaderboard_type: ["friends", "challenge", "city", "global"],
			},
		},
		{
			event: "achievement unlocked",
			weight: 2,
			properties: {
				achievement_type: ["streak_7", "streak_30", "personal_record", "first_5k", "challenge_badge", "minutes_milestone"],
			},
		},
		{
			event: "coach session",
			weight: 2,
			properties: {
				session_type: ["live_video", "form_check", "plan_review", "chat"],
				coach_speciality: ["strength", "running", "mobility", "nutrition"],
				session_minutes: [15, 20, 30, 30, 45],
				satisfaction_score: [3, 4, 4, 5, 5],
			},
		},
		{
			event: "paywall viewed",
			weight: 1,
			properties: {
				paywall_trigger: ["workout_library", "advanced_plans", "coach_teaser", "challenge_limit", "settings"],
			},
		},
		{
			event: "trial started",
			weight: 1,
			properties: {
				plan: ["monthly"],
				trial_days: [7],
			},
		},
		{
			event: "subscription purchased",
			weight: 1,
			properties: {
				plan: ["monthly"],
				payment_method: ["apple_pay", "google_pay", "card", "card"],
			},
		},
		{
			event: "notification received",
			weight: 5,
			properties: {
				notification_type: ["workout_reminder", "workout_reminder", "streak_at_risk", "challenge_update", "friend_activity", "weekly_recap"],
				channel: ["push", "push", "push", "email"],
				opened: PUSH_OPEN_POOL,
			},
		},
		{
			event: "app opened",
			weight: 7,
			properties: {
				entry_point: ["home_screen", "push", "widget", "watch_app"],
				session_minutes: u.weighNumRange(1, 40, 0.4, 30),
			},
		},
		{
			event: "profile updated",
			weight: 2,
			properties: {
				field_updated: ["body_weight", "goal", "photo", "units", "notification_settings", "connected_devices"],
			},
		},
		{
			event: "account deactivated",
			weight: 1,
			properties: {
				reason: ["lost_motivation", "switched_apps", "injury", "reached_goal", "too_busy"],
			},
		},
		{
			event: "$experiment_started",
			weight: 1,
			isStrictEvent: true,
			properties: {
				"Experiment name": [GUIDED_EXPERIMENT],
				"Variant name": ["Control", GUIDED_VARIANT],
			},
		},
	],

	funnels: [
		{
			name: "Onboarding",
			sequence: ["account created", "goal quiz completed", "plan generated", "starter workout completed"],
			isFirstFunnel: true,
			conversionRate: ONBOARDING_ENGINE_CONV, // abandonment is modeled in the everything hook (H1)
			timeToConvert: ONBOARDING_TTC_H,
			order: "sequential",
			weight: 1,
			experiment: {
				name: GUIDED_EXPERIMENT,
				// the engine enrolls on its own signup time, one day before placeSignup moves it
				startDaysBeforeEnd: (dayjs.utc(DATASET_END).unix() - dayjs.utc(GUIDED_TEST_START).subtract(1, "day").unix()) / 86400,
				variants: [
					{ name: "Control" },
					// conversion lift lives in the everything hook (abandonOnboarding); time-to-convert stays declarative
					{ name: GUIDED_VARIANT, conversionMultiplier: 1, ttcMultiplier: GUIDED_TTC_MULT },
				],
			},
		},
		{
			name: "Workout Loop",
			sequence: ["workout planned", "workout completed", "progress checked"],
			conversionRate: 55,
			timeToConvert: 36,
			order: "sequential",
			weight: 6,
		},
		{
			// new members get one 7-day free trial
			name: "Upgrade to Plus (trial)",
			sequence: ["paywall viewed", "trial started", "subscription purchased"],
			conditions: { subscription_tier: "free", trial_eligible: true },
			conversionRate: TRIAL_CONV,
			timeToConvert: 168,
			order: "sequential",
			weight: 2,
			props: { plan: ["monthly", "monthly", "annual"] },
		},
		{
			// long-time free members already used their trial
			name: "Upgrade to Plus (direct)",
			sequence: ["paywall viewed", "subscription purchased"],
			conditions: { subscription_tier: "free", trial_eligible: false },
			conversionRate: DIRECT_CONV,
			timeToConvert: 24,
			order: "sequential",
			weight: 2,
			props: { plan: ["monthly", "monthly", "annual"] },
		},
		{
			name: "Team Challenge",
			sequence: ["challenge joined", "challenge completed"],
			conversionRate: TEAM_CONV,
			timeToConvert: CHALLENGE_TTC_H,
			order: "sequential",
			weight: 1,
			props: { challenge_id: (ctx) => `ch_${chance.hash({ length: 12 })}`, challenge_format: "team", challenge_type: ["steps", "strength", "streak", "distance"] },
		},
		{
			name: "Solo Challenge",
			sequence: ["challenge joined", "challenge completed"],
			conversionRate: SOLO_CONV,
			timeToConvert: CHALLENGE_TTC_H,
			order: "sequential",
			weight: 1,
			props: { challenge_id: (ctx) => `ch_${chance.hash({ length: 12 })}`, challenge_format: "solo", challenge_type: ["steps", "strength", "streak", "distance"] },
		},
		{
			name: "Coaching",
			sequence: ["coach session", "workout planned", "workout completed"],
			conversionRate: 50,
			timeToConvert: 48,
			order: "sequential",
			weight: 1,
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
				// ad platforms claim ~8% more installs than product analytics records
				platform_reported_installs: (ctx) => Math.round(ctx.value * (1.05 + 0.06 * hashFloat(`pri|${dayKey(ctx.time)}|${ctx.seriesKey}`))),
				// click-to-install ≈ 21% and click-through ≈ 1.1%, each with day-level jitter
				clicks: (ctx) => Math.round(ctx.value / (0.21 * (0.85 + 0.3 * hashFloat(`cti|${dayKey(ctx.time)}|${ctx.seriesKey}`)))),
				impressions: (ctx) => Math.round(ctx.row.clicks / (0.011 * (0.85 + 0.3 * hashFloat(`ctr|${dayKey(ctx.time)}|${ctx.seriesKey}`)))),
			},
		},
		{
			name: "wearable_sync_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "workout completed",
				measure: "count",
				where: (e) => e.tracking_source === "wearable",
				groupBy: "wearable_type",
			},
			timeColumn: "date",
			valueColumn: "synced_workouts",
			columns: {
				sync_error_rate: (ctx) => {
					const affected = OUTAGE_TYPES.includes(ctx.row.wearable_type) && inOutage(ctx.time);
					const jitter = hashFloat(`${dayKey(ctx.time)}|${ctx.seriesKey}`);
					return affected ? round2(1 - OUTAGE_KEEP + (jitter - 0.5) * 0.04) : Math.round((0.004 + jitter * 0.01) * 10000) / 10000;
				},
				sync_requests: (ctx) => Math.round(ctx.value / Math.max(0.05, 1 - ctx.row.sync_error_rate)),
				partner_api_status: (ctx) => (OUTAGE_TYPES.includes(ctx.row.wearable_type) && inOutage(ctx.time) ? "major_outage" : "operational"),
				p95_sync_latency_ms: (ctx) => {
					const jitter = hashFloat(`lat|${dayKey(ctx.time)}|${ctx.seriesKey}`);
					return OUTAGE_TYPES.includes(ctx.row.wearable_type) && inOutage(ctx.time) ? Math.round(28000 + jitter * 6000) : Math.round(900 + jitter * 500);
				},
			},
		},
		{
			name: "subscription_billing_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "subscription purchased",
				measure: "count",
				groupBy: "plan",
			},
			timeColumn: "date",
			valueColumn: "new_subscriptions",
			columns: {
				list_price_usd: (ctx) => (ctx.row.plan === "annual" ? PRICE_ANNUAL : monthlyPrice(ctx.time)),
				gross_bookings_usd: (ctx) => round2(ctx.value * ctx.row.list_price_usd),
				store_fees_usd: (ctx) => round2(ctx.value * ctx.row.list_price_usd * 0.15),
				net_bookings_usd: (ctx) => round2(ctx.value * ctx.row.list_price_usd * 0.85),
			},
		},
	],

	superProps: {
		Platform: { __weights: { ios: 62, android: 38 } },
		subscription_tier: ["free"],
	},

	userProps: {
		segment: ["casual"],
		fitness_level: ["beginner"],
		primary_goal: ["lose_weight", "build_strength", "improve_endurance", "stay_active", "reduce_stress"],
		acquisition_channel: { __weights: { organic: 34, paid_social: 18, paid_search: 14, referral: 16, app_store_ads: 18 } },
		wearable_type: { __weights: { none: 35, smartwatch: 35, fitness_band: 20, chest_strap: 10 } },
		subscription_tier: ["free"],
		trial_eligible: [true],
		Platform: { __weights: { ios: 62, android: 38 } },
	},

	personas: [
		{ name: "athlete", weight: 12, eventMultiplier: 3.0, properties: { segment: "athlete", fitness_level: "advanced" } },
		{ name: "casual", weight: 40, eventMultiplier: 1.0, properties: { segment: "casual", fitness_level: "intermediate" } },
		{ name: "beginner", weight: 25, eventMultiplier: 0.6, properties: { segment: "beginner", fitness_level: "beginner" } },
		{ name: "social", weight: 15, eventMultiplier: 1.8, properties: { segment: "social", fitness_level: "intermediate" } },
		{ name: "trainer", weight: 8, eventMultiplier: 2.5, properties: { segment: "trainer", fitness_level: "elite" } },
	],

	worldEvents: [
		{
			name: "fall_reset_program",
			type: "campaign",
			startDay: dayIndex(FALL_RESET_START),
			duration: FALL_RESET_DAYS,
			affectsEvents: FALL_RESET_EVENTS,
			volumeMultiplier: FALL_RESET_MULT,
		},
		{
			name: "fall_reset_app_visits",
			type: "campaign",
			startDay: dayIndex(FALL_RESET_START),
			duration: FALL_RESET_DAYS,
			affectsEvents: ["app opened"],
			volumeMultiplier: FALL_RESET_OPEN_MULT,
		},
	],

	// retention shape (also pins each new member's signup to their install day)
	retentionCurve: { type: "logarithmic", day1: 0.8, day7: 0.6, day30: 0.45 },

	hook(record, type, meta) {
		if (type === "user") return handleUserHook(record, meta);
		if (type === "scd-pre") return NOT_ACQUIRED.has(meta.profile.distinct_id) ? [] : record;
		if (type === "everything") return handleEverything(record, meta);
		if (type === "warehouse") return handleWarehouse(record, meta);
		return record;
	},
};

// ── STORIES ──────────────────────────────────────────────────────────────
// Machine-checkable contract for hooks H1-H9. Evaluate with:
//   node dungeons/vertical/fitness/fitness.verify.mjs

const EV = `read_json_auto('{{PREFIX}}-EVENTS*.json*', sample_size=-1, union_by_name=true)`;
const US = `read_json_auto('{{PREFIX}}-USERS*.json*', sample_size=-1, union_by_name=true)`;
const WH = (table) => `read_json_auto('{{PREFIX}}-WAREHOUSE-${table}.json*', sample_size=-1, union_by_name=true)`;

// Identity prelude: a device resolves to the user who appears with it on any
// event carrying both ids (emitted stitch evidence, not the profile pool).
const ID_CTE = `dmap AS (SELECT device_id, min(user_id::VARCHAR) AS mapped FROM ${EV}
  WHERE user_id IS NOT NULL AND device_id IS NOT NULL GROUP BY 1),
ev AS (SELECT coalesce(e.user_id::VARCHAR, m.mapped) AS uid, e.time::TIMESTAMP AS t, e.*
  FROM ${EV} e LEFT JOIN dmap m ON e.device_id = m.device_id)`;

const TS = (iso) => dayjs.utc(iso).format("YYYY-MM-DD HH:mm:ss");
const DAY_MS = 86_400_000;
// Summer Shred volume: total daily signups rise 1/(1 − SHRED_INCREMENTAL);
// non-paid-social channels keep their daily volume (ratio 1.0)
const SHRED_DAYS = (ms(SUMMER_SHRED_END) - ms(SUMMER_SHRED_START)) / 86_400_000;
const WINDOW_DAYS = Math.round((ms(DATASET_END) - ms(DATASET_START)) / 86_400_000);
const SHRED_VOLUME_LIFT = 1 / (1 - SHRED_INCREMENTAL);
const OUTAGE_BASE_FROM = TS(dayjs.utc(SYNC_OUTAGE_START).subtract(7, "day"));
const OUTAGE_BASE_TO = TS(dayjs.utc(SYNC_OUTAGE_END).add(7, "day"));
const RESET_BASE_FROM = TS(dayjs.utc(FALL_RESET_START).subtract(FALL_RESET_DAYS, "day"));
const RESET_END = TS(dayjs.utc(FALL_RESET_START).add(FALL_RESET_DAYS, "day"));
const AI_RAMP_END = TS(dayjs.utc(AI_COACH_LAUNCH).add(AI_RAMP_DAYS, "day"));
const OUTAGE_LIST = OUTAGE_TYPES.map((x) => `'${x}'`).join(", ");
// H8: from this date the whole fatigue look-back window is inside the data
const FATIGUE_OBSERVABLE = dayjs.utc(DATASET_START).add(PUSH_FATIGUE_WINDOW_DAYS, "day").toISOString();
// H8 Mixpanel recipe: cohorts on notification count in the window
const PUSH_COHORTS = (() => {
	const cuts = [12, 24, 36];
	const label = `<${cuts[0]}, ${cuts.slice(0, -1).map((c, i) => `${c}-${cuts[i + 1] - 1}`).join(", ")}, ${cuts[cuts.length - 1]}+`;
	const sqlCase = `CASE ${cuts.map((c, i) => `WHEN c < ${c} THEN ${i}`).join(" ")} ELSE ${cuts.length} END`;
	return { cuts, label, sqlCase };
})();
// one month of post-change purchases at ≈50 a week (see the H4 narrative)
const H4_MIN_BUYERS = 150;
const band = (k) => [Math.round(k * 0.9 * 1000) / 1000, Math.round(k * 1.1 * 1000) / 1000];

/** step_counts conversion by segment from a timeToConvert breakdown. */
const convOf = (rows, seg) => {
	const r = (rows || []).find((x) => x.segment_value === seg);
	if (!r || !Array.isArray(r.step_counts) || !r.step_counts[0]) return null;
	return { entered: r.step_counts[0], converted: r.step_counts[r.step_counts.length - 1], rate: r.step_counts[r.step_counts.length - 1] / r.step_counts[0] };
};

/** @type {import("../../../types").DungeonStory[]} */
export const stories = [
	{
		id: "H1-guided-first-week",
		hook: "H1",
		archetype: "experiment-lift",
		narrative: `The "${GUIDED_EXPERIMENT}" onboarding test starts ${GUIDED_TEST_START.slice(0, 10)} and splits new signups 50/50. "${GUIDED_VARIANT}" multiplies onboarding conversion by ${GUIDED_CONV_MULT} (the everything hook decides who finishes: Control and not-enrolled members at ${ONBOARDING_CONV}%) and onboarding time by ${GUIDED_TTC_MULT} (declarative ttcMultiplier). Every onboarding step is an onboarding-only event, so the funnel conversion and median time-to-convert read the knobs directly. Members who stop early still use the app and can buy Plus, just less often.`,
		mixpanelReport: { type: "Funnels", steps: ONBOARDING_STEPS, breakdown: `user property "${EXP_KEY}"`, window: "7 days" },
		assertions: [
			{
				breakdown: { type: "timeToConvert", steps: ONBOARDING_STEPS, breakdownByUserProperty: EXP_KEY, conversionWindowMs: 7 * DAY_MS },
				// custom assert: conversion lives in the step_counts ARRAY of each
				// segment row; the expect grammar cannot index arrays
				assert: (rows) => {
					const g = convOf(rows, GUIDED_VARIANT), c = convOf(rows, "Control");
					if (!g || !c) return { verdict: "NONE", detail: "missing variant rows" };
					if (g.entered < 800 || c.entered < 800) return { verdict: "WEAK", detail: `small arms ${g.entered}/${c.entered}` };
					const lift = g.rate / c.rate;
					const [lo, hi] = band(GUIDED_CONV_MULT);
					const detail = `onboarding conversion ${g.converted}/${g.entered}=${g.rate.toFixed(4)} vs ${c.converted}/${c.entered}=${c.rate.toFixed(4)}; lift ${lift.toFixed(4)} (knob ${GUIDED_CONV_MULT}, band [${lo}, ${hi}])`;
					if (lift >= lo && lift <= hi) return { verdict: "NAILED", detail };
					return { verdict: lift > 1 ? "WEAK" : "INVERSE", detail };
				},
			},
			{
				breakdown: { type: "timeToConvert", steps: ONBOARDING_STEPS, breakdownByUserProperty: EXP_KEY, conversionWindowMs: 7 * DAY_MS },
				select: { g: { where: { segment_value: GUIDED_VARIANT } }, c: { where: { segment_value: "Control" } } },
				expect: { metric: "g.median_ttc_ms / c.median_ttc_ms", op: "between", target: band(GUIDED_TTC_MULT) },
				minCohort: 400,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 count(DISTINCT uid) FILTER (WHERE "Variant name" = '${GUIDED_VARIANT}')::DOUBLE / count(DISTINCT uid) AS guided_share,
 count(*) FILTER (WHERE t < TIMESTAMP '${TS(GUIDED_TEST_START)}') AS pre_start_exposures
FROM ev WHERE event = '$experiment_started'`,
				},
				select: { a: { where: { grp: "all" } } },
				// equal-weight 2-arm hash → 0.5
				expect: { metric: "a.guided_share", op: "between", target: band(0.5) },
				minCohort: 1000,
			},
		],
	},
	{
		id: "H2-stride-coach-launch",
		hook: "H2",
		archetype: "temporal-inflection",
		narrative: `Stride Coach launches ${AI_COACH_LAUNCH.slice(0, 10)} for Plus members. Adoption is per member: ${AI_ADOPTER_SHARE * 100}% of Plus members adopt it, and each adopter has their own full-use rate drawn from Beta(${AI_USE_SHAPE}, 1) (mean ${AI_ADOPTER_USE * 100}% of their workouts, so use is spread rather than all-or-nothing). Adopters' use ramps from ${AI_RAMP_FLOOR * 100}% of their full rate on launch day to their full rate after ${AI_RAMP_DAYS} days, so from then on ${AI_ADOPTER_SHARE} × ${AI_ADOPTER_USE} = ${AI_ADOPTION} of Plus workouts run with coaching_mode = 'ai_coach' (adoption is salted independently of workout volume). Those sessions last ${AI_DURATION_MULT}x longer. Free-tier workouts and every pre-launch workout stay self_guided, so purity is exact. subscription_tier on each event is the member's plan at that moment.`,
		mixpanelReport: { type: "Insights", event: "workout completed", measure: "average duration_minutes", breakdown: "coaching_mode", filter: "subscription_tier != free, after launch" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 count(*) FILTER (WHERE coaching_mode = 'ai_coach' AND (t < TIMESTAMP '${TS(AI_COACH_LAUNCH)}' OR subscription_tier = 'free')) AS impure_rows
FROM ev WHERE event IN ('workout completed', 'workout planned')`,
				},
				select: { a: { where: { grp: "all" } } },
				// exact: any ai_coach row before launch or on a free-tier event is a bug
				expect: { metric: "a.impure_rows", op: "between", target: [0, 0] },
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT coaching_mode AS grp, count(*) AS event_count, count(DISTINCT uid) AS user_count, avg(duration_minutes) AS avg_dur, avg(calories_burned) AS avg_cal
FROM ev WHERE event = 'workout completed' AND t >= TIMESTAMP '${TS(AI_COACH_LAUNCH)}' AND subscription_tier <> 'free' GROUP BY 1`,
				},
				select: { a: { where: { grp: "ai_coach" } }, s: { where: { grp: "self_guided" } } },
				expect: { metric: "a.avg_dur / s.avg_dur", op: "between", target: band(AI_DURATION_MULT) },
				minCohort: 500,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'plus' AS grp, count(DISTINCT uid) AS user_count,
 count(*) FILTER (WHERE coaching_mode = 'ai_coach')::DOUBLE / count(*) AS ai_share
FROM ev WHERE event = 'workout completed' AND t >= TIMESTAMP '${AI_RAMP_END}' AND subscription_tier <> 'free'`,
				},
				select: { p: { where: { grp: "plus" } } },
				// steady state after the ramp: adopter share × adopter use
				expect: { metric: "p.ai_share", op: "between", target: band(AI_ADOPTION) },
				minCohort: 500,
			},
		],
	},
	{
		id: "H3-wearable-sync-outage",
		hook: "H3",
		archetype: "bespoke",
		narrative: `A partner health-API outage (${SYNC_OUTAGE_START.slice(0, 10)} to ${SYNC_OUTAGE_END.slice(0, 10)}, exclusive) stops most smartwatch and fitness-band workouts from syncing: only ${OUTAGE_KEEP * 100}% arrive. Chest-strap, phone-tracked, and manual workouts are untouched. The outage days come from the warehouse table wearable_sync_daily (sync_error_rate > 0.2); the event-side read is a ratio of ratios (affected wearable / all unaffected workouts, outage days vs the 7 days either side), which cancels weekday and seasonal volume and reads the keep rate. Pooling every unaffected source keeps the 3-day denominator large.`,
		mixpanelReport: { type: "Insights", event: "workout completed", measure: "total", breakdown: "tracking_source, wearable_type", chart: "daily line", join: "warehouse wearable_sync_daily.sync_error_rate" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
od AS (SELECT DISTINCT date::DATE AS d FROM ${WH("wearable_sync_daily")} WHERE sync_error_rate > 0.2),
w AS (SELECT t::DATE AS d, uid,
  CASE WHEN tracking_source = 'wearable' AND wearable_type IN (${OUTAGE_LIST}) THEN 'aff' ELSE 'ctl' END AS arm
  FROM ev WHERE event = 'workout completed' AND t >= TIMESTAMP '${OUTAGE_BASE_FROM}' AND t < TIMESTAMP '${OUTAGE_BASE_TO}'),
g AS (SELECT (d IN (SELECT d FROM od)) AS outage, count(*) FILTER (WHERE arm = 'aff') AS aff, count(*) FILTER (WHERE arm = 'ctl') AS ctl, count(DISTINCT uid) AS users
  FROM w GROUP BY 1)
SELECT 'all' AS grp, (SELECT count(*) FROM od) AS outage_days, min(users) AS user_count,
 (max(aff::DOUBLE / ctl) FILTER (WHERE outage)) / (max(aff::DOUBLE / ctl) FILTER (WHERE NOT outage)) AS did
FROM g`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.did", op: "between", target: band(OUTAGE_KEEP) },
				minCohort: 1000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT 'all' AS grp,
 count(*) FILTER (WHERE partner_api_status = 'major_outage') AS outage_rows,
 avg(sync_error_rate) FILTER (WHERE partner_api_status = 'major_outage') AS outage_err,
 count(*) FILTER (WHERE partner_api_status = 'major_outage' AND (date::DATE < DATE '${SYNC_OUTAGE_START.slice(0, 10)}' OR date::DATE >= DATE '${SYNC_OUTAGE_END.slice(0, 10)}' OR wearable_type NOT IN (${OUTAGE_TYPES.map((x) => `'${x}'`).join(", ")}))) AS misplaced
FROM ${WH("wearable_sync_daily")}`,
				},
				select: { a: { where: { grp: "all" } } },
				// warehouse error rate during the outage = 1 − keep rate
				expect: { metric: "a.outage_err", op: "between", target: band(1 - OUTAGE_KEEP) },
			},
		],
	},
	{
		id: "H4-monthly-price-change",
		hook: "H4",
		archetype: "temporal-inflection",
		narrative: `On ${PRICE_CHANGE.slice(0, 10)} Plus Monthly rises from $${PRICE_MONTHLY_OLD} to $${PRICE_MONTHLY_NEW}; Annual stays $${PRICE_ANNUAL}. ${MONTHLY_LOSS * 100}% of would-be monthly purchases after the change never happen. Annual is the control: the monthly/annual purchase ratio after vs before reads the ${1 - MONTHLY_LOSS} keep rate. The prices live only in the warehouse table subscription_billing_daily, so the bookings read needs the join: monthly bookings fall to ${(1 - MONTHLY_LOSS).toFixed(2)} × ${PRICE_MONTHLY_NEW}/${PRICE_MONTHLY_OLD} of trend. Purchases run at ≈45-70 a week (long-time free members rarely buy straight from the paywall), so the post-change month holds ≈195 buyers: the evidence gate is 150 buyers per side. The DiD rests on the realized plan mix on each side, which is a draw from the declared 2:1 pool (sd of the DiD ≈ 0.11, from the Poisson noise of ≈90 post-change Annual purchases): in the final run the pre-change mix is 605:301 = 2.01 and the post-change would-be mix is 107/${1 - MONTHLY_LOSS} : 88 = 1.87, so the DiD reads 0.60. Because the plan draw can move it, a knob-derived floor backs the NAILED band.`,
		mixpanelReport: { type: "Insights", event: "subscription purchased", measure: "total", breakdown: "plan", chart: "weekly line" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
p AS (SELECT (t >= TIMESTAMP '${TS(PRICE_CHANGE)}') AS post, plan, uid FROM ev WHERE event = 'subscription purchased'),
g AS (SELECT post, count(*) FILTER (WHERE plan = 'monthly')::DOUBLE / count(*) FILTER (WHERE plan = 'annual') AS m_per_a, count(DISTINCT uid) AS users FROM p GROUP BY 1)
SELECT 'all' AS grp, min(users) AS user_count,
 max(m_per_a) FILTER (WHERE post) / max(m_per_a) FILTER (WHERE NOT post) AS did
FROM g`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.did", op: "<=", target: 1 - MONTHLY_LOSS, floor: 1 - MONTHLY_LOSS / 2 },
				minCohort: H4_MIN_BUYERS,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
p AS (SELECT t::DATE AS d, plan, uid FROM ev WHERE event = 'subscription purchased'),
j AS (SELECT p.*, b.list_price_usd FROM p JOIN ${WH("subscription_billing_daily")} b ON b.date::DATE = p.d AND b.plan = p.plan),
g AS (SELECT (d >= DATE '${PRICE_CHANGE.slice(0, 10)}') AS post,
  sum(list_price_usd) FILTER (WHERE plan = 'monthly') / sum(list_price_usd) FILTER (WHERE plan = 'annual') AS m_rev_per_a, count(DISTINCT uid) AS users
  FROM j GROUP BY 1)
SELECT 'all' AS grp, min(users) AS user_count,
 max(m_rev_per_a) FILTER (WHERE post) / max(m_rev_per_a) FILTER (WHERE NOT post) AS did
FROM g`,
				},
				select: { a: { where: { grp: "all" } } },
				// bookings DiD = keep rate × price ratio
				expect: { metric: "a.did", op: "<=", target: Math.round((1 - MONTHLY_LOSS) * PRICE_MONTHLY_NEW / PRICE_MONTHLY_OLD * 1000) / 1000, floor: Math.round((1 - MONTHLY_LOSS / 2) * PRICE_MONTHLY_NEW / PRICE_MONTHLY_OLD * 1000) / 1000 },
				minCohort: H4_MIN_BUYERS,
			},
		],
	},
	{
		id: "H5-summer-shred-paid-social",
		hook: "H5",
		archetype: "attribution-bias",
		narrative: `Summer Shred (${SUMMER_SHRED_START.slice(0, 10)} to ${SUMMER_SHRED_END.slice(0, 10)}, exclusive) buys extra members through paid social: ${SHRED_INCREMENTAL * 100}% of daily signups inside the window are campaign-driven paid-social members on top of the baseline, so total daily signups rise ${SHRED_VOLUME_LIFT.toFixed(2)}x while every other channel keeps its daily volume. Paid-social CPI bids double. The warehouse table paid_acquisition_daily bills spend = installs × CPI, so spend per Mixpanel signup on paid social reads ${SHRED_CPI_MULT}x inside the campaign. Paid-social signups are also low intent: ${PAID_SOCIAL_NO_BUY * 100}% of them never buy Plus, so their purchase rate is half that of other channels' signups from the same week (channel is drawn independently of persona; the same-week standardization removes the signup-date effect on how long members have had to buy). The read rests on ≈120 paid-social buyers, so sampling noise (sd of the ratio ≈ 0.06) and how active the buying half of paid-social members happens to be can move it to either side of ${1 - PAID_SOCIAL_NO_BUY}; the knob-derived floor ${1 - PAID_SOCIAL_NO_BUY / 2} backs the NAILED ceiling.`,
		mixpanelReport: { type: "Insights + warehouse", event: "account created", breakdown: "acquisition_channel", join: "paid_acquisition_daily.spend_usd" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
s AS (SELECT t::DATE AS d, count(*) AS signups, count(DISTINCT uid) AS users FROM ev WHERE event = 'account created' AND acquisition_channel = 'paid_social' GROUP BY 1),
sp AS (SELECT date::DATE AS d, spend_usd FROM ${WH("paid_acquisition_daily")} WHERE acquisition_channel = 'paid_social'),
j AS (SELECT (sp.d >= DATE '${SUMMER_SHRED_START.slice(0, 10)}' AND sp.d < DATE '${SUMMER_SHRED_END.slice(0, 10)}') AS shred, sum(sp.spend_usd) AS spend, sum(coalesce(s.signups, 0)) AS signups, sum(coalesce(s.users, 0))::BIGINT AS users
  FROM sp LEFT JOIN s ON s.d = sp.d GROUP BY 1)
SELECT 'all' AS grp, min(users) AS user_count,
 (max(spend / signups) FILTER (WHERE shred)) / (max(spend / signups) FILTER (WHERE NOT shred)) AS cac_ratio
FROM j`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.cac_ratio", op: "between", target: band(SHRED_CPI_MULT) },
				minCohort: 300,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
s AS (SELECT (t >= TIMESTAMP '${TS(SUMMER_SHRED_START)}' AND t < TIMESTAMP '${TS(SUMMER_SHRED_END)}') AS shred, acquisition_channel AS ch, uid FROM ev WHERE event = 'account created'),
g AS (SELECT shred, count(*)::DOUBLE / (CASE WHEN shred THEN ${SHRED_DAYS} ELSE ${WINDOW_DAYS - SHRED_DAYS} END) AS per_day,
  count(*) FILTER (WHERE ch <> 'paid_social')::DOUBLE / (CASE WHEN shred THEN ${SHRED_DAYS} ELSE ${WINDOW_DAYS - SHRED_DAYS} END) AS other_per_day,
  count(DISTINCT uid) AS users FROM s GROUP BY 1)
SELECT 'all' AS grp, min(users) AS user_count,
 max(per_day) FILTER (WHERE shred) / max(per_day) FILTER (WHERE NOT shred) AS volume_lift,
 max(other_per_day) FILTER (WHERE shred) / max(other_per_day) FILTER (WHERE NOT shred) AS other_lift
FROM g`,
				},
				select: { a: { where: { grp: "all" } } },
				// total daily signups inside vs outside = 1 / (1 − SHRED_INCREMENTAL)
				expect: { metric: "a.volume_lift", op: "between", target: band(SHRED_VOLUME_LIFT) },
				minCohort: 800,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
s AS (SELECT (t >= TIMESTAMP '${TS(SUMMER_SHRED_START)}' AND t < TIMESTAMP '${TS(SUMMER_SHRED_END)}') AS shred, acquisition_channel AS ch, uid FROM ev WHERE event = 'account created'),
g AS (SELECT shred, count(*) FILTER (WHERE ch <> 'paid_social')::DOUBLE / (CASE WHEN shred THEN ${SHRED_DAYS} ELSE ${WINDOW_DAYS - SHRED_DAYS} END) AS other_per_day,
  count(DISTINCT uid) AS users FROM s GROUP BY 1)
SELECT 'all' AS grp, min(users) AS user_count,
 max(other_per_day) FILTER (WHERE shred) / max(other_per_day) FILTER (WHERE NOT shred) AS other_lift
FROM g`,
				},
				select: { a: { where: { grp: "all" } } },
				// control: organic, referral, paid search, app-store ads keep their daily volume
				expect: { metric: "a.other_lift", op: "between", target: band(1) },
				minCohort: 800,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
s AS (SELECT uid, t AS t0, date_trunc('week', t) AS wk, acquisition_channel AS ch FROM ev WHERE event = 'account created'),
b AS (SELECT DISTINCT s.uid FROM s JOIN ev e ON e.uid = s.uid AND e.event = 'subscription purchased'),
w AS (SELECT wk,
  count(*) FILTER (WHERE ch = 'paid_social') AS sn, count(b.uid) FILTER (WHERE ch = 'paid_social') AS sb,
  count(*) FILTER (WHERE ch <> 'paid_social') AS onn, count(b.uid) FILTER (WHERE ch <> 'paid_social') AS ob
  FROM s LEFT JOIN b ON b.uid = s.uid GROUP BY 1)
-- signup-week standardized: time to purchase depends on signup date and paid
-- social is concentrated in Summer Shred weeks, so compare within each week
SELECT 'all' AS grp, LEAST(sum(sn), sum(onn))::BIGINT AS user_count,
 sum(sb)::DOUBLE / sum(sn * ob::DOUBLE / nullif(onn, 0)) AS std_ratio
FROM w WHERE onn > 0`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.std_ratio", op: "<=", target: 1 - PAID_SOCIAL_NO_BUY, floor: 1 - PAID_SOCIAL_NO_BUY / 2 },
				minCohort: 500,
			},
		],
	},
	{
		id: "H6-first-week-habit",
		hook: "H6",
		archetype: "retention-divergence",
		narrative: `The first week sets the habit. A new member with k workouts in their first ${HABIT_DAYS} days goes completely dark after day ${HABIT_CHURN_AFTER_DAYS} with probability ${HABIT_CHURN_MAX} × (1 − k/${HABIT_SAFE_WORKOUTS}), floored at 0: 0 workouts → ${HABIT_CHURN_MAX * 100}%, ${HABIT_SAFE_WORKOUTS}+ workouts → 0%, so retention climbs with each early workout and has no cliff. Classification uses only first-week activity, so the return window never leaks into the segment. Every new member also faces organic lapse (${LAPSE_SHARE * 100}% stop on a uniform day ${LAPSE_DAY_MIN}-${LAPSE_DAY_MAX}), independent of the split, which sets realistic levels but cancels in the ratio. Week-4 retention (Mixpanel Retention, weekly unit, birth-aligned: any event in days 28-34 after signup, signups at least 35 days before the window end) for ${HABIT_SAFE_WORKOUTS}+ early workouts vs 0 is at least 1/(1−${HABIT_CHURN_MAX}) = ${1 / (1 - HABIT_CHURN_MAX)}x; organic selection (busier people retain better anyway) can only push it higher, so the knob is a floor. A second read checks the curve is monotone across 0, 1-2, 3-4, and 5+.`,
		mixpanelReport: { type: "Retention", birth: "account created", return: "any event", unit: "week", bucket: "Week 4", breakdown: "cohorts on first-week workout completed count (0 / 5+)" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
s AS (SELECT uid, t AS t0 FROM ev WHERE event = 'account created' AND t < TIMESTAMP '${TS(DATASET_END)}' - INTERVAL 35 DAY),
f AS (SELECT s.uid,
  count(*) FILTER (WHERE e.event = 'workout completed' AND e.t < s.t0 + INTERVAL ${HABIT_DAYS} DAY) AS early,
  count(*) FILTER (WHERE e.t >= s.t0 + INTERVAL 28 DAY AND e.t < s.t0 + INTERVAL 35 DAY) AS w4
  FROM s JOIN ev e ON e.uid = s.uid GROUP BY 1)
SELECT CASE WHEN early = 0 THEN 'zero' WHEN early >= ${HABIT_SAFE_WORKOUTS} THEN 'safe' ELSE 'mid' END AS grp, count(*) AS user_count,
 avg((w4 > 0)::INT) AS w4_retention
FROM f GROUP BY 1`,
				},
				select: { h: { where: { grp: "safe" } }, z: { where: { grp: "zero" } } },
				expect: { metric: "h.w4_retention / z.w4_retention", op: ">=", target: 1 / (1 - HABIT_CHURN_MAX), floor: 0.9 / (1 - HABIT_CHURN_MAX) },
				// 5+ first-week workouts is a small group (≈7% of new members, ≈210 with a Week-4
				// read); at ≈50% vs ≈16% retention that still gives the ratio a ≈10% standard error
				minCohort: 200,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
s AS (SELECT uid, t AS t0 FROM ev WHERE event = 'account created' AND t < TIMESTAMP '${TS(DATASET_END)}' - INTERVAL 35 DAY),
f AS (SELECT s.uid,
  count(*) FILTER (WHERE e.event = 'workout completed' AND e.t < s.t0 + INTERVAL ${HABIT_DAYS} DAY) AS early,
  count(*) FILTER (WHERE e.t >= s.t0 + INTERVAL 28 DAY AND e.t < s.t0 + INTERVAL 35 DAY) AS w4
  FROM s JOIN ev e ON e.uid = s.uid GROUP BY 1),
b AS (SELECT CASE WHEN early = 0 THEN 0 WHEN early <= 2 THEN 1 WHEN early < ${HABIT_SAFE_WORKOUTS} THEN 2 ELSE 3 END AS bin, avg((w4 > 0)::INT) AS r, count(*) AS n FROM f GROUP BY 1)
SELECT 'all' AS grp, min(n) AS user_count,
 (SELECT count(*) FROM b b1 JOIN b b2 ON b2.bin = b1.bin + 1 WHERE b2.r > b1.r) AS rising_steps
FROM b`,
				},
				select: { a: { where: { grp: "all" } } },
				// 4 bins → 3 adjacent steps; the churn share falls with every bin
				expect: { metric: "a.rising_steps", op: "between", target: [3, 3] },
				minCohort: 200,
			},
		],
	},
	{
		id: "H7-team-vs-solo-challenges",
		hook: "H7",
		archetype: "funnel-conversion-by-segment",
		narrative: `Team challenges finish at ${TEAM_CONV}% per challenge and solo challenges at ${SOLO_CONV}% (two declared funnels with challenge_format props). Every challenge carries a challenge_id, so a totals funnel that holds challenge_id constant measures per-challenge completion without crediting one challenge's finish to another. Late joins that would finish after the window end trim both rates slightly.`,
		mixpanelReport: { type: "Funnels", steps: ["challenge joined", "challenge completed"], counting: "totals", holdPropertyConstant: "challenge_id", breakdown: "challenge_format" },
		assertions: [
			{
				breakdown: {
					type: "funnelFrequency",
					steps: [{ event: "challenge joined", where: { prop: "challenge_format", op: "eq", value: "team" } }, { event: "challenge completed", where: { prop: "challenge_format", op: "eq", value: "team" } }],
					breakdownByFrequencyOf: "challenge joined",
					countMode: "totals",
					holdPropertyConstant: "challenge_id",
					conversionWindowMs: 30 * DAY_MS,
				},
				select: { c: { where: { step_index: 1 } }, e: { where: { step_index: 0 } } },
				expect: { metric: "c.conversions / e.conversions", op: "between", target: band(TEAM_CONV / 100) },
			},
			{
				breakdown: {
					type: "funnelFrequency",
					steps: [{ event: "challenge joined", where: { prop: "challenge_format", op: "eq", value: "solo" } }, { event: "challenge completed", where: { prop: "challenge_format", op: "eq", value: "solo" } }],
					breakdownByFrequencyOf: "challenge joined",
					countMode: "totals",
					holdPropertyConstant: "challenge_id",
					conversionWindowMs: 30 * DAY_MS,
				},
				select: { c: { where: { step_index: 1 } }, e: { where: { step_index: 0 } } },
				expect: { metric: "c.conversions / e.conversions", op: "between", target: band(SOLO_CONV / 100) },
			},
		],
	},
	{
		id: "H8-push-fatigue",
		hook: "H8",
		archetype: "frequency-sweet-spot",
		narrative: `Notification fatigue follows recent volume. A notification opens at the organic ${PUSH_OPEN_RATE * 100}% rate (the declared pool, typical for fitness-app push) while the member received at most ${PUSH_FATIGUE_START} others in the previous ${PUSH_FATIGUE_WINDOW_DAYS} days. Past that, the chance a would-be open goes unopened ramps linearly to ${PUSH_FATIGUE_FLIP * 100}% at ${PUSH_FATIGUE_FULL} recent notifications and stays there. Pre-window members carry seeded pre-June-4 notifications at their own rate, so fatigue is already steady on June 4 and the open rate has no time trend. Raw-export read (exact knob): notifications sent from ${TS(FATIGUE_OBSERVABLE).slice(0, 10)} (when the whole ${PUSH_FATIGUE_WINDOW_DAYS}-day look-back is inside the data) with ${PUSH_FATIGUE_FULL}+ recent notifications open at 1 − ${PUSH_FATIGUE_FLIP} = ${(1 - PUSH_FATIGUE_FLIP).toFixed(1)} of the rate of those with ${PUSH_FATIGUE_START} or fewer. Mixpanel read: members bucketed by notification count in the window (${PUSH_COHORTS.label}) show an open rate that falls with every bucket. Time check: pre-window members' open rate in September equals June's.`,
		mixpanelReport: { type: "Insights", event: "notification received", measure: "share with opened = true", breakdown: `cohorts on notification received count in the window (${PUSH_COHORTS.label})` },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
n AS (SELECT uid, t, opened, count(*) OVER (PARTITION BY uid ORDER BY t RANGE BETWEEN INTERVAL ${PUSH_FATIGUE_WINDOW_DAYS} DAY PRECEDING AND CURRENT ROW) - 1 AS recent
  FROM ev WHERE event = 'notification received')
SELECT 'all' AS grp, count(DISTINCT uid) FILTER (WHERE recent >= ${PUSH_FATIGUE_FULL}) AS user_count,
 avg(opened::INT) FILTER (WHERE recent >= ${PUSH_FATIGUE_FULL}) / avg(opened::INT) FILTER (WHERE recent <= ${PUSH_FATIGUE_START}) AS full_vs_fresh
FROM n WHERE t >= TIMESTAMP '${TS(FATIGUE_OBSERVABLE)}'`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.full_vs_fresh", op: "between", target: band(1 - PUSH_FATIGUE_FLIP) },
				minCohort: 500,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
n AS (SELECT uid, t, opened, count(*) OVER (PARTITION BY uid ORDER BY t RANGE BETWEEN INTERVAL ${PUSH_FATIGUE_WINDOW_DAYS} DAY PRECEDING AND CURRENT ROW) - 1 AS recent
  FROM ev WHERE event = 'notification received')
SELECT 'fresh' AS grp, count(DISTINCT uid) AS user_count, avg(opened::INT) AS open_rate FROM n
WHERE t >= TIMESTAMP '${TS(FATIGUE_OBSERVABLE)}' AND recent <= ${PUSH_FATIGUE_START}`,
				},
				select: { f: { where: { grp: "fresh" } } },
				// untouched control = the declared pool (1 open in 5)
				expect: { metric: "f.open_rate", op: "between", target: band(PUSH_OPEN_RATE) },
				minCohort: 1000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
m AS (SELECT uid, count(*) AS c, sum(opened::INT) AS o FROM ev WHERE event = 'notification received' GROUP BY 1),
b AS (SELECT ${PUSH_COHORTS.sqlCase} AS bin, sum(o)::DOUBLE / sum(c) AS r, count(*) AS n FROM m GROUP BY 1)
SELECT 'all' AS grp, min(n) AS user_count,
 (SELECT count(*) FROM b b1 JOIN b b2 ON b2.bin = b1.bin + 1 WHERE b2.r < b1.r) AS falling_steps
FROM b`,
				},
				select: { a: { where: { grp: "all" } } },
				// Mixpanel cohort breakdown: ${PUSH_COHORTS.cuts.length + 1} count cohorts → ${PUSH_COHORTS.cuts.length} adjacent steps, each one lower
				expect: { metric: "a.falling_steps", op: "between", target: [PUSH_COHORTS.cuts.length, PUSH_COHORTS.cuts.length] },
				minCohort: 200,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
pre AS (SELECT uid FROM ev GROUP BY 1 HAVING count(*) FILTER (WHERE event = 'account created') = 0),
n AS (SELECT strftime(t, '%m') AS mo, opened, uid FROM ev WHERE event = 'notification received' AND uid IN (SELECT uid FROM pre))
SELECT 'pre' AS grp, count(DISTINCT uid) AS user_count,
 avg(opened::INT) FILTER (WHERE mo = '09') / avg(opened::INT) FILTER (WHERE mo = '06') AS sep_vs_jun
FROM n`,
				},
				select: { p: { where: { grp: "pre" } } },
				// steady-state fatigue from day 1: no calendar trend (ratio 1)
				expect: { metric: "p.sep_vs_jun", op: "between", target: band(1) },
				minCohort: 1000,
			},
		],
	},
	{
		id: "H9-fall-reset-program",
		hook: "H9",
		archetype: "temporal-inflection",
		narrative: `The Fall Reset program (${FALL_RESET_START.slice(0, 10)}, ${FALL_RESET_DAYS} days) multiplies workout planning, completion, and progress checks by ${FALL_RESET_MULT} and app opens by ${FALL_RESET_OPEN_MULT} (two world events): members train much more and visit the app somewhat more. Meal logging is untouched. Ratios against the ${FALL_RESET_DAYS} days before cancel weekday mix and the overall trend: workouts per app open read ${FALL_RESET_MULT}/${FALL_RESET_OPEN_MULT} = ${(FALL_RESET_MULT / FALL_RESET_OPEN_MULT).toFixed(2)}, and app opens per meal logged read ${FALL_RESET_OPEN_MULT}.`,
		mixpanelReport: { type: "Insights", events: ["workout completed", "app opened", "meal logged"], measure: "total", chart: "daily line, formulas A/B and B/C" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
w AS (SELECT (t >= TIMESTAMP '${TS(FALL_RESET_START)}') AS prog, event, uid FROM ev
  WHERE event IN ('workout completed', 'app opened') AND t >= TIMESTAMP '${RESET_BASE_FROM}' AND t < TIMESTAMP '${RESET_END}'),
g AS (SELECT prog, count(*) FILTER (WHERE event = 'workout completed')::DOUBLE / count(*) FILTER (WHERE event = 'app opened') AS r, count(DISTINCT uid) AS users FROM w GROUP BY 1)
SELECT 'all' AS grp, min(users) AS user_count, max(r) FILTER (WHERE prog) / max(r) FILTER (WHERE NOT prog) AS did FROM g`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.did", op: "between", target: band(FALL_RESET_MULT / FALL_RESET_OPEN_MULT) },
				minCohort: 2000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
w AS (SELECT (t >= TIMESTAMP '${TS(FALL_RESET_START)}') AS prog, event, uid FROM ev
  WHERE event IN ('workout planned', 'app opened') AND t >= TIMESTAMP '${RESET_BASE_FROM}' AND t < TIMESTAMP '${RESET_END}'),
g AS (SELECT prog, count(*) FILTER (WHERE event = 'workout planned')::DOUBLE / count(*) FILTER (WHERE event = 'app opened') AS r, count(DISTINCT uid) AS users FROM w GROUP BY 1)
SELECT 'all' AS grp, min(users) AS user_count, max(r) FILTER (WHERE prog) / max(r) FILTER (WHERE NOT prog) AS did FROM g`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.did", op: "between", target: band(FALL_RESET_MULT / FALL_RESET_OPEN_MULT) },
				minCohort: 2000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
w AS (SELECT (t >= TIMESTAMP '${TS(FALL_RESET_START)}') AS prog, event, uid FROM ev
  WHERE event IN ('app opened', 'meal logged') AND t >= TIMESTAMP '${RESET_BASE_FROM}' AND t < TIMESTAMP '${RESET_END}'),
g AS (SELECT prog, count(*) FILTER (WHERE event = 'app opened')::DOUBLE / count(*) FILTER (WHERE event = 'meal logged') AS r, count(DISTINCT uid) AS users FROM w GROUP BY 1)
SELECT 'all' AS grp, min(users) AS user_count, max(r) FILTER (WHERE prog) / max(r) FILTER (WHERE NOT prog) AS did FROM g`,
				},
				select: { a: { where: { grp: "all" } } },
				// app opens rise modestly; meal logging is the untouched control
				expect: { metric: "a.did", op: "between", target: band(FALL_RESET_OPEN_MULT) },
				minCohort: 2000,
			},
		],
	},
];


export default config;
