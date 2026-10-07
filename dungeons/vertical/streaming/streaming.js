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
 * NAME:       Reelhouse
 * APP:        Subscription streaming service for independent film and prestige
 *             TV (US and Canada): smart-TV, phone, tablet, and web apps; a
 *             catalog of Reelhouse Originals plus licensed series and films.
 *             Every new account starts a 7-day free trial on one of three
 *             plans: Basic with Ads ($6.99/month), Standard ($11.99 → $13.99
 *             for new subscriptions from 2026-08-11), Premium ($17.99).
 * SCALE:      10,000 simulated households (≈4,870 create an account inside the
 *             window), ~0.99M events, 120 days (2026-06-04 → 2026-10-01, UTC)
 * CORE LOOP:  app opened → browse / search → title details viewed → playback
 *             started → playback completed → (rating, watchlist, next episode)
 * VALUE MOMENT: playback completed
 *
 * EVENTS (23):
 *   playback started > app opened > playback completed > ad break completed
 *   > browse > title details viewed > notification received > search performed
 *   > subscription renewed > trailer played > watchlist added > rating submitted
 *   > notification opened > playback error > download started > profile created
 *   > account created > plan selected > trial started > subscription cancelled
 *   > $experiment_started > trial converted > plan changed
 *
 * FUNNELS (5 declared + catch-all):
 *   - Signup (first funnel): account created → plan selected → trial started
 *     (82%). Carries the Smart Start experiment (multipliers 1.0; the hook
 *     applies the effect to trial conversion).
 *   - Watch (weight 12): app opened → browse → title details viewed →
 *     playback started → playback completed
 *   - Binge (weight 9): app opened → playback started → playback completed ×3
 *     (next episodes; the hook lays episodes end to end)
 *   - Search (weight 5): search performed → title details viewed → playback
 *     started (search_id held constant across the three steps)
 *   - Discover (weight 4): app opened → browse → trailer played → watchlist added
 *   - Catch-all: notification received, rating submitted, download started and
 *     single templates the hook rebuilds (billing, profiles, errors, ads)
 *
 * USER PROPS:  plan, subscription_status, acquisition_channel, profile_count,
 *              has_kids_profile, country, member_since,
 *              "Experiment: Smart Start"
 * SUPER PROPS: plan (plan at event time; "none" before a plan is chosen and
 *              after access ends), platform (tv / mobile / tablet / web, from
 *              the device; "server" for billing events), device_family
 * SCD PROPS:   none
 * GROUPS:      none
 * WAREHOUSE:   marketing_spend_daily (paid channels), playback_qos_daily
 *              (streaming quality by platform), subscription_billing_daily
 *              (new paid subscriptions, list price, bookings by plan)
 * LOOKUPS:     none — title attributes are denormalized onto events
 * SOUP:        weekend-heavy dayOfWeekWeights; evening hourOfDayWeights for
 *              US and Canadian time zones (UTC)
 *
 * IDENTITY: a new household is identified at "account created" (isAuthEvent,
 * first event, user_id + device_id). Households use about 2 devices
 * (avgDevicePerUser 2.2); each device_id is one screen with a fixed platform
 * and device_family. Every event carries user_id; there is no anonymous
 * pre-signup activity. "plan selected" and "trial started" (sent by the
 * billing service right after signup) carry user_id only and the signup
 * device's platform; "trial converted" and "subscription renewed" are
 * server-side (user_id only, platform = server). Push notifications go to a
 * phone or tablet; households without one get none.
 *
 * DESIGN NOTES:
 * - Subscriptions are hook-owned. Established households (joined before
 *   June 4) pay on a monthly anniversary (renewals from day 1 of the window).
 *   About 4% of them were mid-trial on June 4 (trial started May 28-Jun 3), so
 *   conversions and trial cancellations run from the first week. A cancellation
 *   lands 1 h to 6 days before the renewal it replaces; access ends at that
 *   renewal date. Trials last exactly 7 days: "trial converted" fires at
 *   trial start + 7 d; a trial that does not convert has a "subscription
 *   cancelled" (during_trial = true) during the trial and access ends at day 7.
 *   User-initiated events stop when access ends; push notifications continue
 *   as win_back campaigns at 30% of the normal volume (the rest of the lapsed
 *   households uninstalled or muted the app).
 * - Premiere joiners (H2): the engine has no knob that concentrates signups
 *   in a date range, so 8% of the households the engine generates as
 *   established members join Jul 17 - Aug 6 instead (join day decays from the
 *   premiere). The hook drops their activity before the join and clones a
 *   signup at the join time from the other households' signup events
 *   (account created with user_id + device_id; plan selected and trial
 *   started with user_id only; the Smart Start exposure 5 s after trial
 *   started; 81.8% / 90.9% reach trial started / plan selected, the Signup
 *   funnel's measured mix). profile.created and member_since are the join
 *   time. Their acquisition_channel keeps the normal mix, so paid signups and
 *   the bid half of paid spend rise in those weeks.
 * - Trial conversion probability = early-binge base (H4) x channel (H7) x
 *   premiere-tourist (H2) x Smart Start variant (H3). The four factors are
 *   drawn independently, so each story's ratio reads its own knob.
 * - Playback units are hook-owned: each "playback started" either fails (a
 *   "playback error" and no completion), completes ("playback completed" at
 *   start + 92-100% of the runtime), or stops part-way (no event). Episodes in
 *   one sitting are laid end to end (next episode starts 5-25 s after the
 *   previous one completes; source = autoplay). Basic with Ads plays carry a
 *   pre-roll and one mid-roll per ~20 watched minutes ("ad break completed").
 * - Titles: 34 titles (9 Reelhouse Originals, 25 licensed or kids). Within a
 *   session, playback follows the title the household opened; sittings
 *   continue a series episode by episode. Kids-profile households watch kids
 *   titles on about a quarter of sessions (profile_type = kids).
 * - Warehouse drift: playback_qos_daily adds plays from app versions that do
 *   not report to analytics (0-16% by day) plus preview autoplays and retries; subscription_billing_daily adds
 *   app-store purchases Mixpanel never received and same-day refunds;
 *   marketing spend is half a paced budget (weekday shape, never zero) and
 *   half bid x delivered signups, with seeded day noise.
 */

// ── HOOK STORIES ──
/*
 * All effects are hidden: no flag properties. Dates live in the TIMELINE
 * constants and are shared by hooks, stories, SQL, warehouse columns, and the
 * timeline guide.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H1. SALTMARSH SEASON 2 PREMIERE (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: all 8 episodes of Saltmarsh season 2 drop 2026-07-17. 35% of
 *   households that joined before the premiere and played anything Jul 17-30
 *   start season 2 in those two weeks (salted delay, most in the first days),
 *   and watch 1-8 episodes in sittings of 1-4. Season 2 plays are added
 *   viewing (clones), so daily plays rise in late July. No season 2 play
 *   exists before the premiere.
 * MIXPANEL: Insights, playback started, Uniques, filter title_name =
 *   Saltmarsh and season_number = 2 / all playback started, Jul 17-30,
 *   excluding a cohort of households with account created on or after
 *   2026-07-17 (equivalently member_since before 2026-07-17).
 * REAL WORLD: a flagship original drives a viewing spike among subscribers.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H2. PREMIERE TOURISTS (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: the premiere brings in new households: accounts created per day
 *   Jul 17 - Aug 6 run 1 + (5,500 x 0.08 / 21) / (4,500 / 120) = 1.56x the
 *   other 99 days (premiere joiners, see DESIGN NOTES; most in the first
 *   week). Accounts created in those 3 weeks come mostly for Saltmarsh (80%
 *   start season 2 within a day; when the H4 72-hour count trims a trial's
 *   completions, the first season 2 start stays as a play stopped part-way)
 *   and convert their trial at 0.6x the rate of other accounts created from
 *   Jul 8 on (about 1,000 trials: the read is the knob target with a
 *   half-effect floor).
 * MIXPANEL: Insights, account created, Totals, daily; Funnels, trial started
 *   → trial converted, Uniques, 8-day window, trials Jul 8 - Sep 23,
 *   breakdown cohort account created Jul 17 - Aug 6 vs other.
 * REAL WORLD: "come for one show, leave after the trial".
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H3. SMART START EXPERIMENT (Signup funnel experiment + everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-07-08 new trials split 50/50 (Control vs Smart Start, a
 *   taste picker after trial start; exposure $experiment_started a few seconds
 *   after trial started). Smart Start multiplies trial conversion by 1.2.
 *   Viewing in the first 3 days is not engineered by variant.
 * MIXPANEL: Funnels, trial started → trial converted, Uniques, 8-day window,
 *   trials Jul 8 - Sep 23, breakdown "Experiment: Smart Start"; or the
 *   Experiments report on $experiment_started.
 * REAL WORLD: a better first session sells the subscription.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H4. THREE EPISODES IN THREE DAYS (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: each trial's playback completed count in the first 72 h after
 *   trial started is drawn from a smooth distribution (0-10) and enforced;
 *   trial conversion base by that count: 0 → 30%, 1 → 38%, 2 → 46%, 3 → 66%,
 *   4+ → 68%. The jump is at 3; above it conversion is flat.
 * MIXPANEL: Funnels, trial started → playback completed ×3, 3-day window →
 *   create cohort from step 4; Funnels trial started → trial converted
 *   (8-day window) breakdown by that cohort; same for 2 and 5 completions.
 * REAL WORLD: a trial that turns into a habit converts.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H5. TV STREAMING INCIDENT (everything + warehouse playback_qos_daily;
 *     external-join)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-08-20 to 2026-08-22 a CDN fault hits the TV apps: 50% of TV
 *   playback starts fail ("playback error", no completion) vs 2% normally.
 *   Other platforms are untouched. playback_qos_daily shows cdn_status =
 *   degraded and playback_failure_rate ≈ 0.5 for tv on those days.
 * MIXPANEL: Insights, playback completed / playback started, daily, breakdown
 *   platform; TV vs other on incident days vs 14 days either side; join the
 *   warehouse cdn_status.
 * REAL WORLD: a CDN edge problem looks like "people stopped finishing shows".
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H6. STANDARD PRICE INCREASE (everything + warehouse
 *     subscription_billing_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: on 2026-08-11 Standard rises from $11.99 to $13.99 for new
 *   subscriptions (existing subscribers keep their price). 35% of new accounts
 *   that would have picked Standard pick Basic with Ads instead: Standard's
 *   share of plan selections is 0.65x, Basic with Ads' share rises to
 *   (30 + 0.35 x 50) / 30 = 1.58x; Premium's share is not engineered.
 * MIXPANEL: Insights, plan selected, breakdown plan, % of total, before vs
 *   after Aug 11; prices from subscription_billing_daily.list_price_usd.
 * REAL WORLD: a price rise on the middle tier pushes buyers to the ad tier.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H7. PAID SOCIAL CAC (warehouse marketing_spend_daily; external-join)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: spend per Mixpanel signup $21 paid_social, $32 paid_search, $48
 *   ctv (half paced budget, half bid x delivered signups, ±12% day noise).
 *   paid_social trials convert at 0.55x the rate of every other channel, so
 *   paid_social is the cheapest channel per signup but costs (21 / 0.55) / 32
 *   = 1.19x paid_search per paid subscriber.
 * MIXPANEL: Insights, account created by acquisition_channel joined to
 *   marketing_spend_daily.spend_usd; Funnels trial started → trial converted
 *   (8-day window) breakdown user property acquisition_channel.
 * REAL WORLD: cheap social installs often never pay.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H8. SHARED HOUSEHOLDS STAY (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: at each monthly renewal a paying subscriber cancels with
 *   probability 6% if the account has one viewer profile and 3% (0.5x) with
 *   2+ profiles; otherwise the renewal goes through. Renewal-time churn
 *   (cancellations / renewals due) is therefore 0.5x for shared households
 *   (about 450 cancellations per group: knob target with a half-effect floor).
 *   profile_count is drawn independently of plan, channel, and activity.
 * MIXPANEL: Insights, A = subscription cancelled (during_trial = false),
 *   B = subscription renewed, formula A / (A + B), breakdown profile_count
 *   (1 vs 2+), whole window.
 * REAL WORLD: a family with several profiles has more to lose by cancelling.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H9. PERSONALIZED PUSHES GET OPENED (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: push open rate by campaign_type: new_episode 15%,
 *   because_you_watched 9%, trending_now 5% (win_back 3%; the one-off
 *   new_season push for Saltmarsh on Jul 17 18%). An open is followed by a
 *   play of the pushed title about half the time.
 * MIXPANEL: Insights, notification opened / notification received (Totals),
 *   breakdown campaign_type.
 * REAL WORLD: "a new episode of your show" beats "what's trending".
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H10. SEARCHING WITH A REMOTE IS SLOW (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: time from search performed to the playback it leads to is 2.2x
 *   on tv vs phone, tablet, and web (median about 75 s off TV, log-normal).
 * MIXPANEL: Funnels, search performed → playback started, hold search_id
 *   constant, 1-hour window, median time to convert, breakdown platform.
 * REAL WORLD: typing with a remote is painful; voice search is the fix.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * EXPECTED METRICS SUMMARY (measured: data/verify-streaming, 2026-10-07, full
 * fidelity, 10,000 households, 986,748 events)
 * ═════════════════════════════════════════════════════════════════════════
 * Hook | Metric                                         | Derivation               | Expected | Measured
 * -----|------------------------------------------------|--------------------------|----------|---------
 * H1   | S2 viewers / active members, Jul 17-30         | SALTMARSH_REACH          | 0.35     | 0.351 (1,625 / 4,632)
 * H1   | season 2 plays before the premiere             | exact purity             | 0        | 0
 * H2   | accounts/day, Jul 17 - Aug 6 / other days      | PREMIERE_LIFT            | 1.559    | 1.510 (56.2 vs 37.2)
 * H2   | premiere trials with S2 start within a day     | TOURIST_S2_SHARE (not asserted) | 0.80 | 0.795
 * H2   | trial conversion, premiere signups / other     | TOURIST_CONV_MULT (≤, floor 0.8) | 0.60 | 0.542 (27.6% vs 50.8%)
 * H3   | trial conversion, Smart Start / Control        | SMART_START_CONV_MULT    | 1.20     | 1.251 (47.3% vs 37.8%)
 * H3   | variant share of exposed trials                | equal 2-arm hash         | 0.50     | 0.486
 * H3   | exposures before the test start                | exact purity             | 0        | 0
 * H3   | early completions, Smart Start / Control       | not engineered           | 1.00     | 0.993 (2.85 vs 2.87)
 * H4   | conversion, 3+ early completions / 0-2         | k-weighted CONV_BY_EARLY | 1.804    | 1.832 (56.8% vs 31.0%)
 * H4   | conversion, 5+ / 3-4 early completions         | plateau                  | 1.017    | 1.023 (57.4% vs 56.1%)
 * H5   | TV/other completion per start, incident / ±14 d| (1-0.5)/(1-0.02)         | 0.510    | 0.490 (TV 38.4% vs 76.8%)
 * H5   | warehouse tv failure rate on degraded days     | INCIDENT_FAIL            | 0.50     | 0.497
 * H6   | Standard share of plan selections, after/before| 1 - PRICE_SWITCH_SHARE   | 0.65     | 0.676 (49.4% → 33.4%)
 * H6   | Basic with Ads share, after/before             | (30 + 0.35 x 50) / 30    | 1.583    | 1.627 (30.1% → 49.0%)
 * H6   | Premium share, after/before                    | not engineered           | 1.00     | 0.859 (20.5% → 17.6%; sampling)
 * H7   | spend per signup, paid_social / paid_search    | 21 / 32                  | 0.656    | 0.677 ($21.35 vs $31.54)
 * H7   | trial conversion, paid_social / other channels | SOCIAL_CONV_MULT         | 0.55     | 0.554 (27.1% vs 48.9%)
 * H7   | spend per paid sub, paid_social / paid_search  | (21 / 0.55) / 32 (not asserted) | 1.193 | 1.288 ($102.42 vs $79.51)
 * H8   | renewal-time churn, 2+ profiles / 1 profile    | MULTI_PROFILE_HAZARD_MULT (≤, floor 0.75) | 0.50 | 0.534 (3.06% vs 5.74%)
 * H9   | open rate, new_episode / trending_now          | 0.15 / 0.05              | 3.00     | 3.171 (15.1% vs 4.77%)
 * H9   | open rate, because_you_watched / trending_now  | 0.09 / 0.05              | 1.80     | 1.936 (9.23% vs 4.77%)
 * H10  | median search → play, tv / other               | TV_SEARCH_TTC_MULT       | 2.20     | 2.159 (162.9 s vs 75.5 s)
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Noise notes: H2's conversion read rests on about 1,000 premiere trials
 * converting near 30% (ratio SE about 5%), so it uses the knob as target
 * with a half-effect floor. H2's signup lift reads a little under the knob:
 * about 431 households joined for the premiere (440 designed), and the
 * engine's own signups in those 21 days drew about 1 SD low (750 vs about
 * 780). H8 rests on about 450 paid
 * cancellations per group (ratio SE about 7%), so it uses the same target +
 * floor form. Premium's share of plan selections is not engineered; its drop
 * across the price change (z ≈ 2.4) is sampling in plan choice, not a design;
 * the designed trade-down alone moves the average list price per new
 * subscription by about -2%.
 * H7's spend per paid subscriber compounds two noisy ratios and is reported,
 * not asserted.
 */

// ── SCALE ──
const SEED = "harness-streaming";
const NUM_USERS = 10_000;
const DATASET_START = "2026-06-04T00:00:00Z";
const DATASET_END = "2026-10-01T23:59:59Z"; // 120 days
const EVENTS_PER_DAY = 1.2;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── TIMELINE (shared by hooks, stories, SQL, warehouse columns, guides) ──
const SMART_START_LAUNCH = "2026-07-08T00:00:00Z";  // Smart Start onboarding test starts for new trials
const SALTMARSH_PREMIERE = "2026-07-17T00:00:00Z";  // Saltmarsh season 2: all 8 episodes
const SALTMARSH_PUSH = "2026-07-17T16:00:00Z";      // new_season push to every household with the app on a phone or tablet
const TOURIST_END = "2026-08-07T00:00:00Z";         // exclusive: accounts created Jul 17 - Aug 6
const REACH_END = "2026-07-31T00:00:00Z";           // exclusive: the premiere fortnight Jul 17-30
const PRICE_CHANGE = "2026-08-11T00:00:00Z";        // Standard $11.99 → $13.99 for new subscriptions
const CDN_INCIDENT_START = "2026-08-20T00:00:00Z";  // TV CDN fault starts
const CDN_INCIDENT_END = "2026-08-23T00:00:00Z";    // exclusive (3 days: Aug 20-22)

const ms = (iso) => dayjs.utc(iso).valueOf();
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;
const BEGIN_MS = ms(DATASET_START);
const END_MS = ms(DATASET_END);
const WINDOW_DAYS = 120;

// ── WEEKLY AND DAILY RHYTHM (soup) ──
// Sun..Sat. Streaming peaks on weekend nights.
const DOW_WEIGHTS = [1.0, 0.78, 0.74, 0.75, 0.8, 0.92, 0.98];
// UTC hours. Households are in US and Canadian time zones: prime time
// (19-23 local) is 23-03 UTC on the East coast and 02-06 UTC on the West coast.
const HOUR_WEIGHTS = [0.94, 1.0, 1.0, 0.97, 0.86, 0.68, 0.48, 0.32, 0.21, 0.15, 0.13, 0.13,
	0.16, 0.2, 0.24, 0.28, 0.32, 0.36, 0.4, 0.46, 0.54, 0.63, 0.73, 0.84];

// ── KNOBS ──
// H1 Saltmarsh season 2 premiere
const SALTMARSH_REACH = 0.35;        // share of members active in the premiere fortnight who start season 2
const S2_EPISODES = 8;
const S2_DELAY_WEIGHTS = { 0: 30, 1: 16, 2: 11, 3: 8, 4: 7, 5: 6, 6: 5, 7: 4, 8: 3, 9: 3, 10: 2, 11: 2, 12: 2, 13: 1 }; // days after the premiere of the first season 2 play
const S2_DEPTH_WEIGHTS = { 1: 16, 2: 13, 3: 11, 4: 10, 5: 9, 6: 8, 7: 8, 8: 25 };  // season 2 episodes a viewer watches

// H2 premiere tourists
const TOURIST_CONV_MULT = 0.6;
const TOURIST_S2_SHARE = 0.8;        // tourists who start Saltmarsh season 2 within a day of trial start
const PREMIERE_JOIN_SHARE = 0.08;    // households the premiere brings in: share of the engine's established pool that joins Jul 17 - Aug 6 instead
const PREMIERE_JOIN_DAYS = 21;       // the join day decays from the premiere across the tourist window
const PREMIERE_JOIN_DAY_WEIGHTS = Object.fromEntries(Array.from({ length: PREMIERE_JOIN_DAYS }, (_, d) => [d, Math.max(1, Math.round(100 * Math.exp(-d / 6)))]));
const SIGNUP_TRIAL_SHARE = 0.818;    // new accounts that reach trial started (matches the Signup funnel's measured mix)
const SIGNUP_PLAN_SHARE = 0.909;     // new accounts that reach plan selected

// H3 Smart Start experiment
const SMART_START_EXPERIMENT = "Smart Start";
const SMART_START_VARIANT = "Smart Start";
const EXP_KEY = `Experiment: ${SMART_START_EXPERIMENT}`;
const SMART_START_CONV_MULT = 1.2;

// H4 early binge magic number
const TRIAL_DAYS = 7;
const EARLY_WINDOW_H = 72;
const EARLY_K_WEIGHTS = { 0: 20, 1: 17, 2: 16, 3: 13, 4: 10, 5: 8, 6: 6, 7: 4, 8: 3, 9: 2, 10: 1 };
const CONV_BY_EARLY = [0.30, 0.38, 0.46, 0.66, 0.68]; // index min(k, 4)
const convBase = (k) => CONV_BY_EARLY[Math.min(k, CONV_BY_EARLY.length - 1)];

// H5 TV CDN incident (warehouse playback_qos_daily)
const BASE_FAIL = 0.02;              // share of playback starts that fail on a normal day
const INCIDENT_FAIL = 0.5;           // share of TV playback starts that fail during the incident
const INCIDENT_PLATFORM = "tv";

// H6 Standard price increase (warehouse subscription_billing_daily)
const PLAN_WEIGHTS_NEW = { basic_ads: 30, standard: 50, premium: 20 };
const PLAN_WEIGHTS_EXISTING = { basic_ads: 25, standard: 52, premium: 23 };
const PRICE_SWITCH_SHARE = 0.35;     // would-be Standard buyers who pick Basic with Ads after the change
const PRICES = { basic_ads: [6.99, 6.99], standard: [11.99, 13.99], premium: [17.99, 17.99] };

// H7 paid acquisition (warehouse marketing_spend_daily)
const PAID_CHANNELS = ["paid_social", "paid_search", "ctv"];
const CHANNEL_WEIGHTS = { organic: 32, referral: 12, paid_social: 26, paid_search: 18, ctv: 12 };
const CPA_USD = { paid_social: 21, paid_search: 32, ctv: 48 }; // window spend per Mixpanel signup
const SOCIAL_CONV_MULT = 0.55;
const BORN_PCT = 45;
const EXPECTED_SIGNUPS = NUM_USERS * (BORN_PCT / 100 + (1 - BORN_PCT / 100) * PREMIERE_JOIN_SHARE);
const DAILY_BUDGET_USD = Object.fromEntries(PAID_CHANNELS.map((ch) => {
	const totalW = Object.values(CHANNEL_WEIGHTS).reduce((a, b) => a + b, 0);
	return [ch, CPA_USD[ch] * EXPECTED_SIGNUPS * (CHANNEL_WEIGHTS[ch] / totalW) / WINDOW_DAYS];
}));
const SPEND_FLAT_SHARE = 0.4;
const SPEND_WEEKDAY = (() => {
	const m = DOW_WEIGHTS.reduce((a, b) => a + b, 0) / DOW_WEIGHTS.length;
	return DOW_WEIGHTS.map((w) => SPEND_FLAT_SHARE + (1 - SPEND_FLAT_SHARE) * w / m);
})();
const SPEND_NOISE = 0.12;
const SPEND_PLAN_SHARE = 0.5;
const PLATFORM_SIGNUP_INFLATION = 1.2; // ad platforms claim more conversions than Mixpanel records
const CPC_USD = { paid_social: 0.85, paid_search: 2.1, ctv: 6.5 };
const CTR = { paid_social: 0.009, paid_search: 0.055, ctv: 0.004 };

// H8 shared households churn less
const CANCEL_HAZARD_SINGLE = 0.06;   // per monthly renewal, one viewer profile
const MULTI_PROFILE_HAZARD_MULT = 0.5;
const CANCEL_LEAD_MAX_DAYS = 6;      // a cancellation lands up to 6 days before the renewal it replaces
const PLAN_SWITCH_PER_RENEWAL = 0.015; // realism: plan changes at a renewal (not a story)
const P_TRIALING = 0.039;            // established households mid-trial on June 4

// H9 push notifications
const OPEN_RATE = { new_episode: 0.15, because_you_watched: 0.09, trending_now: 0.05, new_season: 0.18, win_back: 0.03 };
const PUSH_MIX = { new_episode: 35, because_you_watched: 35, trending_now: 30 };
const PUSH_PLAY_SHARE = 0.5;         // opens followed by a play of the pushed title
const LAPSED_PUSH_KEEP = 0.3;        // share of pushes still delivered after access ends (the rest uninstalled or muted)

// H10 search on TV
const SEARCH_GAP_MEDIAN_S = 75;
const SEARCH_GAP_SIGMA = 0.5;
const TV_SEARCH_TTC_MULT = 2.2;

// realism: playback
const COMPLETE_BASE = { series: 0.72, movie: 0.58 };
const COMPLETE_PLATFORM = { tv: 1.0, tablet: 0.92, web: 0.88, mobile: 0.8 };
const RATING_SHARE = 0.07;
const MIDROLL_EVERY_MIN = 20;        // Basic with Ads: one mid-roll break per ~20 watched minutes
const KIDS_SESSION_SHARE = 0.25;
const UNTRACKED_PLAY_SHARE = 0.08;    // mean share of plays from app versions without analytics (0-16% by day)
const PREVIEW_ATTEMPTS_PER_DAY = { tv: 90, mobile: 40, tablet: 15, web: 25 }; // preview autoplays and retries logged by the player (±90% by day)
const STORE_UNTRACKED_SHARE = 0.16;   // plan-days with app-store purchases Mixpanel never received (a quarter of them two)
const REFUND_SHARE = 0.06;            // plan-days with one same-day refund

// ── DATA ──
const weighted = (obj) => Object.entries(obj).flatMap(([k, w]) => Array(w).fill(isNaN(Number(k)) ? k : Number(k)));
// runtime = minutes per episode or film; seasons = episodes per season
const CATALOG = [
	{ id: "rh_s01", name: "Saltmarsh", type: "series", genre: "thriller", original: true, rating: "TV-MA", runtime: 52, seasons: [8, 8], weight: 5 },
	{ id: "rh_s02", name: "The Quiet Acre", type: "series", genre: "drama", original: true, rating: "TV-14", runtime: 48, seasons: [10], weight: 5 },
	{ id: "rh_s03", name: "Northbound", type: "series", genre: "sci-fi", original: true, rating: "TV-14", runtime: 55, seasons: [8, 8], weight: 4 },
	{ id: "rh_s04", name: "Copperline", type: "series", genre: "crime", original: true, rating: "TV-MA", runtime: 50, seasons: [10], weight: 4 },
	{ id: "rh_s05", name: "Small Hours", type: "series", genre: "comedy", original: true, rating: "TV-14", runtime: 26, seasons: [10, 10], weight: 5 },
	{ id: "rh_s06", name: "Low Tide Diaries", type: "series", genre: "documentary", original: true, rating: "TV-PG", runtime: 42, seasons: [6], weight: 2 },
	{ id: "rh_m01", name: "Paper Lanterns", type: "movie", genre: "drama", original: true, rating: "PG-13", runtime: 112, seasons: null, weight: 3 },
	{ id: "rh_m02", name: "The Glass Orchard", type: "movie", genre: "mystery", original: true, rating: "R", runtime: 104, seasons: null, weight: 3 },
	{ id: "rh_s07", name: "Harbor Lights", type: "series", genre: "drama", original: false, rating: "TV-14", runtime: 44, seasons: [12, 12, 12], weight: 6 },
	{ id: "rh_s08", name: "Second Shift", type: "series", genre: "comedy", original: false, rating: "TV-14", runtime: 22, seasons: [20, 20], weight: 6 },
	{ id: "rh_s09", name: "Wild Province", type: "series", genre: "documentary", original: false, rating: "TV-G", runtime: 50, seasons: [6], weight: 2 },
	{ id: "rh_s10", name: "The Assessor", type: "series", genre: "crime", original: false, rating: "TV-MA", runtime: 47, seasons: [10, 10], weight: 5 },
	{ id: "rh_s11", name: "Fieldwork", type: "series", genre: "comedy", original: false, rating: "TV-14", runtime: 24, seasons: [13], weight: 4 },
	{ id: "rh_s12", name: "Ironwood", type: "series", genre: "western", original: false, rating: "TV-MA", runtime: 58, seasons: [8], weight: 3 },
	{ id: "rh_s13", name: "Kitchen Table", type: "series", genre: "reality", original: false, rating: "TV-PG", runtime: 40, seasons: [12], weight: 3 },
	{ id: "rh_s14", name: "Night Desk", type: "series", genre: "drama", original: false, rating: "TV-14", runtime: 45, seasons: [10], weight: 3 },
	{ id: "rh_s15", name: "Marrow Creek", type: "series", genre: "mystery", original: false, rating: "TV-14", runtime: 46, seasons: [8], weight: 3 },
	{ id: "rh_s16", name: "The Long Table", type: "series", genre: "documentary", original: false, rating: "TV-PG", runtime: 38, seasons: [8], weight: 1 },
	{ id: "rh_m03", name: "Ember Road", type: "movie", genre: "thriller", original: false, rating: "R", runtime: 98, seasons: null, weight: 3 },
	{ id: "rh_m04", name: "The Long Field", type: "movie", genre: "drama", original: false, rating: "PG-13", runtime: 121, seasons: null, weight: 2 },
	{ id: "rh_m05", name: "Pale Signal", type: "movie", genre: "sci-fi", original: false, rating: "PG-13", runtime: 109, seasons: null, weight: 3 },
	{ id: "rh_m06", name: "Midsummer Static", type: "movie", genre: "horror", original: false, rating: "R", runtime: 94, seasons: null, weight: 2 },
	{ id: "rh_m07", name: "The Cartographer's Daughter", type: "movie", genre: "drama", original: false, rating: "PG", runtime: 127, seasons: null, weight: 2 },
	{ id: "rh_m08", name: "Under Lake Ice", type: "movie", genre: "thriller", original: false, rating: "R", runtime: 101, seasons: null, weight: 2 },
	{ id: "rh_m09", name: "A Year of Sundays", type: "movie", genre: "romance", original: false, rating: "PG-13", runtime: 106, seasons: null, weight: 2 },
	{ id: "rh_m10", name: "Four Corners", type: "movie", genre: "comedy", original: false, rating: "PG-13", runtime: 97, seasons: null, weight: 3 },
	{ id: "rh_m11", name: "Signal Fires", type: "movie", genre: "action", original: false, rating: "PG-13", runtime: 118, seasons: null, weight: 3 },
	{ id: "rh_m12", name: "Dust Choir", type: "movie", genre: "documentary", original: false, rating: "PG", runtime: 88, seasons: null, weight: 1 },
	{ id: "rh_m13", name: "Velvet Hours", type: "movie", genre: "romance", original: false, rating: "R", runtime: 103, seasons: null, weight: 2 },
	{ id: "rh_m14", name: "The Ferryman's Wager", type: "movie", genre: "action", original: false, rating: "PG-13", runtime: 115, seasons: null, weight: 2 },
	{ id: "rh_k01", name: "Pip & the Lighthouse", type: "series", genre: "kids", original: true, rating: "TV-Y", runtime: 12, seasons: [26], weight: 5, kids: true },
	{ id: "rh_k02", name: "Moss Meadow", type: "series", genre: "kids", original: false, rating: "TV-Y7", runtime: 22, seasons: [20], weight: 4, kids: true },
	{ id: "rh_k03", name: "Rocket Raccoons", type: "series", genre: "kids", original: false, rating: "TV-Y7", runtime: 11, seasons: [30], weight: 4, kids: true },
	{ id: "rh_k04", name: "The Paper Kite", type: "movie", genre: "kids", original: false, rating: "G", runtime: 84, seasons: null, weight: 2, kids: true },
];
const TITLE_BY_ID = Object.fromEntries(CATALOG.map((t) => [t.id, t]));
const TITLE_BY_NAME = Object.fromEntries(CATALOG.map((t) => [t.name, t]));
const SALTMARSH = TITLE_BY_ID.rh_s01;
const ADULT_TITLES = CATALOG.filter((t) => !t.kids);
const KIDS_TITLES = CATALOG.filter((t) => t.kids);
const ADULT_SERIES = ADULT_TITLES.filter((t) => t.type === "series");
const ORIGINALS = ADULT_TITLES.filter((t) => t.original);
const TRENDING = ["rh_s07", "rh_s10", "rh_s05", "rh_m11", "rh_s02"].map((id) => TITLE_BY_ID[id]);

const PLATFORM_WEIGHTS = { tv: 42, mobile: 33, web: 15, tablet: 10 };
const DEVICE_FAMILIES = {
	tv: { Roku: 30, "Fire TV": 22, "Samsung TV": 16, "LG TV": 10, "Apple TV": 12, "Google TV": 10 },
	mobile: { iPhone: 55, "Android phone": 45 },
	tablet: { iPad: 65, "Android tablet": 20, "Fire tablet": 15 },
	web: { Chrome: 58, Safari: 24, Edge: 12, Firefox: 6 },
};
const PROFILE_COUNT_WEIGHTS = { 1: 36, 2: 25, 3: 18, 4: 13, 5: 8 };

// ── HELPERS ──
const salt = (uid, tag) => hashFloat(`${uid}|${tag}`);
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
const round4 = (n) => Math.round(n * 10000) / 10000;
const T = (e) => dayjs.utc(e.time).valueOf();
const iso = (t) => new Date(Math.floor(t)).toISOString();
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const byT = (a, b) => T(a) - T(b);
const jitter = (key, spread) => 1 + (hashFloat(key) - 0.5) * 2 * spread;
const inIncident = (t) => t >= ms(CDN_INCIDENT_START) && t < ms(CDN_INCIDENT_END);
const price = (plan, t) => (PRICES[plan] ?? [0, 0])[t >= ms(PRICE_CHANGE) ? 1 : 0];
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
const pickTitle = (list, r) => {
	const total = list.reduce((s, t) => s + t.weight, 0);
	let acc = 0;
	for (const t of list) {
		acc += t.weight / total;
		if (r < acc) return t;
	}
	return list[list.length - 1];
};
const rnd = () => chance.random();
const logNormal = (sigma) => Math.exp(chance.normal({ mean: 0, dev: sigma }));
const paidSpend = (date, ch, signups) => round2((SPEND_PLAN_SHARE * DAILY_BUDGET_USD[ch] * SPEND_WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()]
	+ (1 - SPEND_PLAN_SHARE) * CPA_USD[ch] * signups) * jitter(`spend|${date}|${ch}`, SPEND_NOISE));
// an evening-weighted moment inside [lo, hi)
const eveningTime = (lo, hi) => {
	if (hi - lo < 2 * HOUR_MS) return lo + rnd() * Math.max(0, hi - lo);
	for (let i = 0; i < 12; i++) {
		const t = lo + rnd() * (hi - lo);
		if (rnd() < HOUR_WEIGHTS[new Date(t).getUTCHours()]) return t;
	}
	return lo + rnd() * (hi - lo);
};
const platformOf = (deviceId) => (deviceId ? pickWeighted(PLATFORM_WEIGHTS, hashFloat(`${deviceId}|platform`)) : null);
const familyOf = (deviceId, platform) => pickWeighted(DEVICE_FAMILIES[platform], hashFloat(`${deviceId}|family`));

const TITLE_EVENTS = new Set(["title details viewed", "trailer played", "watchlist added", "playback started", "playback completed"]);
// events that do not need streaming access (lifecycle, billing, messaging)
const ACCESS_EXEMPT = new Set(["notification received", "account created", "plan selected", "trial started"]);
// engine copies of these are dropped; the hook builds them
const HOOK_BUILT = new Set(["playback completed", "playback error", "ad break completed", "rating submitted", "trial converted",
	"subscription renewed", "subscription cancelled", "plan changed", "profile created", "notification opened", "$experiment_started"]);
const SERVER_EVENTS = new Set(["trial converted", "subscription renewed"]);
const PLAN_SET_EVENTS = new Set(["plan selected", "trial started", "trial converted", "subscription renewed", "subscription cancelled"]);

// templates seen so far (a household without its own copy borrows one; every
// hook-built field is overwritten, so nothing personal carries over)
const GLOBAL_TEMPLATES = {};

function setTitle(ev, title, season, episode) {
	ev.title_id = title.id;
	ev.title_name = title.name;
	if (TITLE_EVENTS.has(ev.event)) {
		ev.content_type = title.type;
		ev.genre = title.genre;
		ev.is_original = title.original;
		ev.maturity_rating = title.rating;
	}
	if (ev.event === "playback started" || ev.event === "playback completed") {
		ev.season_number = title.type === "series" ? season : null;
		ev.episode_number = title.type === "series" ? episode : null;
	}
}

// plan choice at signup: after the Standard price change some would-be
// Standard buyers pick Basic with Ads (H6)
function choosePlan(uid, t) {
	let p = pickWeighted(PLAN_WEIGHTS_NEW, salt(uid, "new-plan"));
	if (p === "standard" && t >= ms(PRICE_CHANGE) && salt(uid, "price-switch") < PRICE_SWITCH_SHARE) p = "basic_ads";
	return p;
}

function handleUserHook(profile, meta) {
	const uid = profile.distinct_id;
	profile.profile_count = Number(pickWeighted(PROFILE_COUNT_WEIGHTS, salt(uid, "profiles")));
	profile.has_kids_profile = profile.profile_count >= 2 && salt(uid, "kids") < 0.45;
	profile.acquisition_channel = pickWeighted(CHANNEL_WEIGHTS, salt(uid, "channel"));
	profile.country = salt(uid, "country") < 0.84 ? "US" : "CA";
	if (meta.userIsBornInDataset) {
		profile.member_since = dayKey(dayjs.utc(profile.created ?? meta.user.created).valueOf());
		profile.plan = "none";
		profile.subscription_status = "never_subscribed";
		return profile;
	}
	profile.plan = pickWeighted(PLAN_WEIGHTS_EXISTING, salt(uid, "plan"));
	profile.subscription_status = "active";
	if (salt(uid, "trialing") < P_TRIALING) {
		// mid-trial on June 4: trial started May 28 - Jun 3
		profile.member_since = dayKey(BEGIN_MS - Math.floor(salt(uid, "trial-start") * TRIAL_DAYS * DAY_MS));
	} else {
		const tenureDays = Math.floor(salt(uid, "tenure") * (ms("2026-05-27T00:00:00Z") - ms("2023-03-01T00:00:00Z")) / DAY_MS);
		profile.member_since = dayjs.utc("2023-03-01T00:00:00Z").add(tenureDays, "day").format("YYYY-MM-DD");
	}
	return profile;
}

// super props: plan at the time, platform and device family from the device
function stampSuper(events, planAt, signupDevice) {
	for (const e of events) {
		if (SERVER_EVENTS.has(e.event)) {
			delete e.device_id;
			e.platform = "server";
			e.device_family = "server";
		} else {
			const d = e.device_id || signupDevice;
			const plat = platformOf(d) || "web";
			e.platform = plat;
			e.device_family = familyOf(d, plat);
		}
		if (!PLAN_SET_EVENTS.has(e.event)) e.plan = planAt(T(e) - (e.event === "plan changed" ? 1 : 0));
	}
	return events;
}

// H2: the premiere brings in households that had not joined yet. The engine
// has no knob that concentrates signups in a date range, so a share of the
// households it generated as established members join in the premiere weeks
// instead: their activity before the join is dropped and a signup (account
// created → plan selected → trial started, plus the Smart Start exposure) is
// cloned at the join time. Returns null when a template is not available yet.
const SIGNUP_EVENTS = ["account created", "plan selected", "trial started", "$experiment_started"];
function premiereJoin(events, profile, uid) {
	if (SIGNUP_EVENTS.some((n) => !GLOBAL_TEMPLATES[n])) return null;
	const day = Number(pickWeighted(PREMIERE_JOIN_DAY_WEIGHTS, salt(uid, "join-day")));
	const day0 = ms(SALTMARSH_PREMIERE) + day * DAY_MS;
	const y = eveningTime(day0, day0 + DAY_MS);
	const r = salt(uid, "join-funnel");
	const steps = r < SIGNUP_TRIAL_SHARE ? 3 : r < SIGNUP_PLAN_SHARE ? 2 : 1;
	const tPlan = y + (1 + rnd() * 8) * MIN_MS;
	const tTrial = tPlan + (1 + rnd() * 8) * MIN_MS;
	const after = events.filter((e) => T(e) > tTrial + MIN_MS);
	const device = (after.find((e) => e.device_id) || events.find((e) => e.device_id) || {}).device_id;
	if (!device) return null;
	const mk = (name, t) => cloneEvent(GLOBAL_TEMPLATES[name], { time: iso(t), user_id: uid });
	const out = [];
	const a = mk("account created", y);
	a.device_id = device;
	a.signup_method = pickWeighted({ email: 52, apple: 26, google: 22 }, rnd());
	a.acquisition_channel = profile.acquisition_channel;
	out.push(a);
	if (steps >= 2) {
		const p = mk("plan selected", tPlan);
		delete p.device_id;
		out.push(p);
	}
	if (steps >= 3) {
		const t = mk("trial started", tTrial);
		delete t.device_id;
		t.trial_days = TRIAL_DAYS;
		t.payment_method = pickWeighted({ credit_card: 64, paypal: 18, apple_pay: 12, gift_card: 6 }, rnd());
		out.push(t);
		const variant = salt(uid, "join-variant") < 0.5 ? "Control" : SMART_START_VARIANT;
		const x = mk("$experiment_started", tTrial + 5000);
		x.device_id = device;
		x["Experiment name"] = SMART_START_EXPERIMENT;
		x["Variant name"] = variant;
		out.push(x);
		profile[EXP_KEY] = variant;
	}
	profile.created = iso(y);
	profile.member_since = dayKey(y);
	return out.concat(after);
}

function handleEverything(events, meta) {
	if (!events.length) return events;
	const profile = meta.profile;
	const uid = profile.distinct_id;
	let born = !!meta.userIsBornInDataset;

	// ── templates ──
	const tmplLocal = {};
	for (const e of events) {
		if (!tmplLocal[e.event]) tmplLocal[e.event] = { ...e };
		if (!GLOBAL_TEMPLATES[e.event]) GLOBAL_TEMPLATES[e.event] = { ...e };
	}

	// ── H2: households the premiere brings in ──
	if (!born && salt(uid, "premiere-join") < PREMIERE_JOIN_SHARE) {
		const joined = premiereJoin(events, profile, uid);
		if (joined) { events = joined; born = true; }
	}
	const signup = events.find((e) => e.event === "account created") || null;
	const signupT = signup ? T(signup) : null;
	const tmpl = (name) => tmplLocal[name] || GLOBAL_TEMPLATES[name] || null;
	const clone = (name, t) => {
		const tp = tmpl(name);
		return tp ? cloneEvent(tp, { time: iso(t), user_id: uid }) : null;
	};

	// ── devices: each device_id is one screen with a fixed platform ──
	const devices = [];
	for (const e of events) if (e.device_id && !devices.includes(e.device_id)) devices.push(e.device_id);
	const signupDevice = signup?.device_id || devices[0] || null;
	const tvDevices = devices.filter((d) => platformOf(d) === "tv");
	const pushDevices = devices.filter((d) => ["mobile", "tablet"].includes(platformOf(d)));
	const webDevices = devices.filter((d) => platformOf(d) === "web");
	const anyDevice = () => devices[Math.floor(rnd() * devices.length)] || signupDevice;
	const viewingDevice = () => (tvDevices.length && rnd() < 0.7 ? tvDevices[Math.floor(rnd() * tvDevices.length)] : anyDevice());
	const accountDevice = () => (webDevices.length && rnd() < 0.6 ? webDevices[0] : anyDevice());

	// ── born households that never start a trial leave after signing up ──
	const trialStarted = events.find((e) => e.event === "trial started") || null;
	const exposure = events.find((e) => e.event === "$experiment_started") || null;
	if (born && !trialStarted) {
		const p0 = choosePlan(uid, signupT);
		const keep = events.filter((e) => e.event === "account created" || e.event === "plan selected");
		for (const e of keep) if (e.event === "plan selected") e.plan = p0;
		if (profile[EXP_KEY] !== undefined) delete profile[EXP_KEY];
		profile.plan = keep.some((e) => e.event === "plan selected") ? p0 : "none";
		profile.subscription_status = "never_subscribed";
		return stampSuper(keep, () => "none", signupDevice);
	}

	// ── subscription lifecycle ──
	const hazard = CANCEL_HAZARD_SINGLE * (profile.profile_count >= 2 ? MULTI_PROFILE_HAZARD_MULT : 1);
	const k = Number(pickWeighted(EARLY_K_WEIGHTS, salt(uid, "early-k")));
	const lifecycle = []; // { name, t, ... }
	const accessStart = born ? signupT : BEGIN_MS;
	let accessEnd = Infinity;
	let trialStartT = null;
	let tourist = false;
	let variant = null;
	const plan = born ? choosePlan(uid, signupT) : profile.plan;
	const planChanges = []; // { t, plan }

	if (born) {
		trialStartT = T(trialStarted);
		tourist = signupT >= ms(SALTMARSH_PREMIERE) && signupT < ms(TOURIST_END);
		variant = profile[EXP_KEY] !== undefined && exposure ? profile[EXP_KEY] : null;
	} else if (salt(uid, "trialing") < P_TRIALING) {
		trialStartT = BEGIN_MS - Math.floor(salt(uid, "trial-start") * TRIAL_DAYS * DAY_MS);
	}

	const scheduleRenewals = (first) => {
		for (let r = first, j = 0; r <= END_MS; r += 30 * DAY_MS, j++) {
			if (salt(uid, `cancel|${j}`) < hazard) {
				const lead = HOUR_MS + salt(uid, `cancel-lead|${j}`) * (CANCEL_LEAD_MAX_DAYS * DAY_MS - HOUR_MS);
				// a renewal early in June whose cancellation would land before the
				// window: spread it over the part of the lead time inside the window
				const tc = r - lead >= BEGIN_MS ? r - lead
					: BEGIN_MS + salt(uid, `cancel-lead|${j}`) * Math.max(0, (r - HOUR_MS > BEGIN_MS ? r - HOUR_MS : r) - BEGIN_MS);
				lifecycle.push({ name: "subscription cancelled", t: tc, duringTrial: false });
				accessEnd = r;
				return;
			}
			if (salt(uid, `switch|${j}`) < PLAN_SWITCH_PER_RENEWAL) {
				const current = planChanges.length ? planChanges[planChanges.length - 1].plan : plan;
				const options = Object.keys(PLAN_WEIGHTS_EXISTING).filter((x) => x !== current);
				const to = options[Math.floor(salt(uid, `switch-to|${j}`) * options.length)];
				const tsw = r - (HOUR_MS + salt(uid, `switch-lead|${j}`) * 4 * DAY_MS);
				if (tsw > BEGIN_MS && tsw > (trialStartT ?? 0) + TRIAL_DAYS * DAY_MS) {
					lifecycle.push({ name: "plan changed", t: tsw, from: current, to });
					planChanges.push({ t: tsw, plan: to });
				}
			}
			lifecycle.push({ name: "subscription renewed", t: r });
		}
	};

	if (trialStartT !== null) {
		let p = convBase(k) * (profile.acquisition_channel === "paid_social" ? SOCIAL_CONV_MULT : 1);
		if (tourist) p *= TOURIST_CONV_MULT;
		if (variant === SMART_START_VARIANT) p *= SMART_START_CONV_MULT;
		const trialEnd = trialStartT + TRIAL_DAYS * DAY_MS;
		if (salt(uid, "convert") < p) {
			lifecycle.push({ name: "trial converted", t: trialEnd });
			scheduleRenewals(trialEnd + 30 * DAY_MS);
		} else {
			const tc = trialStartT + (0.2 + salt(uid, "trial-cancel") * (TRIAL_DAYS - 0.3)) * DAY_MS;
			lifecycle.push({ name: "subscription cancelled", t: tc, duringTrial: true });
			accessEnd = trialEnd;
		}
	} else {
		// established subscriber: monthly anniversary inside the first 30 days
		scheduleRenewals(BEGIN_MS + salt(uid, "anniversary") * 30 * DAY_MS);
	}

	const planAt = (t) => {
		if (t >= accessEnd) return "none";
		if (born && t <= signupT) return "none";
		let p = plan;
		for (const c of planChanges) if (t >= c.t) p = c.plan;
		return p;
	};

	// ── keep in-access user activity; drop engine copies of hook-built events ──
	events = events.filter((e) => {
		if (HOOK_BUILT.has(e.event)) return false;
		if (ACCESS_EXEMPT.has(e.event)) return true;
		const t = T(e);
		return t >= accessStart && t < accessEnd;
	});
	events.sort(byT);

	// ── titles and playback units ──
	const seriesProgress = {}; // title id → [season, episode] to watch next
	const nextEpisode = (title) => {
		if (title.type !== "series") return [null, null];
		const seasons = title.id === SALTMARSH.id ? [title.seasons[0]] : title.seasons; // organic Saltmarsh plays are season 1
		let pos = seriesProgress[title.id];
		if (!pos) {
			const s = 1 + Math.floor(rnd() * seasons.length);
			pos = [s, 1 + Math.floor(rnd() * seasons[s - 1])];
		}
		const out = [...pos];
		let [s, ep] = pos;
		ep += 1;
		if (ep > seasons[s - 1]) { s = s < seasons.length ? s + 1 : 1; ep = 1; }
		seriesProgress[title.id] = [s, ep];
		return out;
	};
	const inProgress = (kids) => {
		const ids = Object.keys(seriesProgress).filter((id) => !!TITLE_BY_ID[id].kids === !!kids);
		return ids.length && rnd() < 0.7 ? TITLE_BY_ID[ids[Math.floor(rnd() * ids.length)]] : null;
	};
	const units = [];
	let sess, sessTitle = null, sessLastUnit = null, sessKids = false, trailerTitle = null, searchUnit = null;
	for (const e of events) {
		if (e.session_id !== sess) {
			sess = e.session_id;
			sessTitle = null; sessLastUnit = null; trailerTitle = null; searchUnit = null;
			sessKids = !!profile.has_kids_profile && hashFloat(`${uid}|${sess}|kids`) < KIDS_SESSION_SHARE;
		}
		const pool = sessKids ? KIDS_TITLES : ADULT_TITLES;
		if (e.event === "search performed") {
			searchUnit = { search: e, details: null };
		} else if (e.event === "title details viewed") {
			sessTitle = pickTitle(pool, rnd());
			setTitle(e, sessTitle);
			if (searchUnit && e.search_id && e.search_id === searchUnit.search.search_id) searchUnit.details = e;
			else e.search_id = null;
		} else if (e.event === "trailer played") {
			trailerTitle = pickTitle(pool, rnd());
			setTitle(e, trailerTitle);
		} else if (e.event === "watchlist added") {
			setTitle(e, trailerTitle || pickTitle(pool, rnd()));
		} else if (e.event === "download started") {
			const t = pickTitle(pool, rnd());
			e.title_id = t.id; e.title_name = t.name; e.content_type = t.type;
		} else if (e.event === "playback started") {
			let title, source, chainPrev = null;
			const fromSearch = !!(searchUnit && e.search_id && e.search_id === searchUnit.search.search_id);
			if (sessTitle) {
				title = sessTitle; source = fromSearch ? "search" : "home_row"; sessTitle = null;
			} else if (sessLastUnit && sessLastUnit.title.type === "series") {
				title = sessLastUnit.title; source = "autoplay"; chainPrev = sessLastUnit;
			} else {
				title = inProgress(sessKids) || pickTitle(pool, rnd()); source = "continue_watching";
			}
			const [season, episode] = nextEpisode(title);
			const unit = { start: e, startT: null, title, season, episode, source, chainPrev, origin: "organic", kids: sessKids, device: chainPrev ? chainPrev.device : (e.device_id || viewingDevice()) };
			if (fromSearch) {
				// H10: search → play gap, 2.2x on TV
				const st = T(searchUnit.search);
				const dev = searchUnit.search.device_id || unit.device;
				const gap = SEARCH_GAP_MEDIAN_S * 1000 * logNormal(SEARCH_GAP_SIGMA) * (platformOf(dev) === "tv" ? TV_SEARCH_TTC_MULT : 1);
				if (searchUnit.details) searchUnit.details.time = iso(st + gap * (0.35 + 0.3 * rnd()));
				unit.startT = st + gap;
				unit.device = dev;
				searchUnit = null;
			} else {
				e.search_id = null;
			}
			units.push(unit);
			sessLastUnit = unit;
		}
	}

	// ── H1 / H2: who watches Saltmarsh season 2, and when ──
	const premiere = ms(SALTMARSH_PREMIERE);
	const memberAtPremiere = !born || signupT < premiere;
	const activeInFortnight = units.some((x) => { const t = x.startT ?? T(x.start); return t >= premiere && t < ms(REACH_END); });
	let s2Viewer = false, s2FirstT = null, s2Depth = 0, s2FromPush = false;
	if (memberAtPremiere && activeInFortnight && salt(uid, "s2") < SALTMARSH_REACH) {
		s2Viewer = true;
		// the first season 2 play lands in the fortnight and before access ends
		const d = Number(pickWeighted(S2_DELAY_WEIGHTS, salt(uid, "s2-delay")));
		const until = Math.min(ms(REACH_END), accessEnd - HOUR_MS);
		const from = Math.min(premiere + d * DAY_MS, until - DAY_MS);
		s2FirstT = eveningTime(Math.max(premiere, from), Math.min(from + DAY_MS, until));
		s2Depth = Number(pickWeighted(S2_DEPTH_WEIGHTS, salt(uid, "s2-depth")));
	} else if (tourist && salt(uid, "s2") < TOURIST_S2_SHARE) {
		s2Viewer = true;
		s2FirstT = trialStartT + (0.1 + rnd() * 23.9) * HOUR_MS;
		s2Depth = 2 + Math.floor(salt(uid, "s2-depth") * (S2_EPISODES - 1));
	}

	// ── H9: push notifications (plus the one-off new_season push) ──
	const sessionStarts = []; // app opened clones for hook-built sittings
	if (pushDevices.length) {
		const t0 = ms(SALTMARSH_PUSH) + Math.floor(rnd() * 20 * MIN_MS);
		if (t0 >= accessStart && t0 < accessEnd) {
			const n = clone("notification received", t0);
			if (n) { n.campaign_type = "new_season"; n.title_name = SALTMARSH.name; events.push(n); }
		}
	} else {
		events = events.filter((e) => e.event !== "notification received");
	}
	// lapsed households: many uninstall or mute the app, so only some still get pushes
	events = events.filter((e) => e.event !== "notification received" || e.campaign_type === "new_season"
		|| (T(e) >= accessStart && T(e) < accessEnd) || hashFloat(`${e.insert_id}|lapsed-push`) < LAPSED_PUSH_KEEP);
	const opened = [];
	for (const n of events.filter((e) => e.event === "notification received")) {
		const t = T(n);
		n.device_id = pushDevices[0];
		if (n.campaign_type !== "new_season") {
			if (t >= accessEnd || t < accessStart) {
				n.campaign_type = "win_back";
				n.title_name = pickTitle(ORIGINALS, rnd()).name;
			} else {
				n.campaign_type = pickWeighted(PUSH_MIX, rnd());
				const title = n.campaign_type === "new_episode" ? (inProgress(false) || pickTitle(ADULT_SERIES, rnd()))
					: n.campaign_type === "trending_now" ? TRENDING[Math.floor(rnd() * TRENDING.length)]
						: pickTitle(ADULT_TITLES, rnd());
				n.title_name = title.name;
			}
		}
		if (rnd() >= OPEN_RATE[n.campaign_type]) continue;
		const openT = t + Math.min(12 * HOUR_MS, 25 * MIN_MS * logNormal(1.1));
		const o = clone("notification opened", openT);
		if (!o) continue;
		o.device_id = n.device_id;
		o.campaign_type = n.campaign_type;
		o.minutes_to_open = Math.max(0, Math.round((openT - t) / MIN_MS));
		opened.push(o);
		if (openT < accessStart || openT >= accessEnd) continue;
		if (n.campaign_type === "new_season") {
			// a season 2 viewer who opens the push starts episode 1 right away
			if (s2Viewer && openT < s2FirstT) { s2FirstT = openT + (1 + rnd() * 4) * MIN_MS; s2FromPush = true; }
			continue;
		}
		if (rnd() < PUSH_PLAY_SHARE) {
			const title = TITLE_BY_NAME[n.title_name] || pickTitle(ADULT_TITLES, rnd());
			const [season, episode] = nextEpisode(title);
			units.push({ start: null, startT: openT + (0.5 + rnd() * 3) * MIN_MS, title, season, episode, source: "push_notification", chainPrev: null, origin: "push", kids: false, device: o.device_id });
		}
	}
	events = events.concat(opened);

	// season 2 sittings (clones), before access ends
	let s2Next = 1;
	if (s2Viewer) {
		let t = s2FirstT, first = true;
		while (s2Next <= s2Depth && t < Math.min(accessEnd, END_MS)) {
			const sitting = 1 + Math.floor(rnd() * 4);
			const viaPush = first && s2FromPush;
			const device = viaPush ? pushDevices[0] : viewingDevice();
			if (!viaPush) sessionStarts.push({ t: t - (20 + rnd() * 60) * 1000, device });
			let prev = null;
			for (let i = 0; i < sitting && s2Next <= s2Depth; i++, s2Next++) {
				const unit = { start: null, startT: prev ? null : t, title: SALTMARSH, season: 2, episode: s2Next, source: prev ? "autoplay" : viaPush ? "push_notification" : first ? "home_row" : "continue_watching", chainPrev: prev, origin: "s2", kids: false, device };
				units.push(unit);
				prev = unit;
				first = false;
			}
			t = eveningTime(t + (0.6 + rnd()) * DAY_MS, t + (1.6 + 2 * rnd()) * DAY_MS);
		}
	}

	// ── materialize units: chains end to end; completion; failure (H5) ──
	const hasNext = new Set(units.filter((x) => x.chainPrev).map((x) => x.chainPrev));
	const finishUnit = (x) => {
		const plat = platformOf(x.device) || "tv";
		x.platform = plat;
		const f = plat === INCIDENT_PLATFORM && inIncident(x.startT) ? INCIDENT_FAIL : BASE_FAIL;
		x.failed = rnd() < f;
		x.completeT = null;
		const runtime = x.title.runtime * MIN_MS;
		if (x.failed) {
			x.watchMs = 0;
			x.endT = x.startT + (10 + rnd() * 80) * 1000;
			return;
		}
		const pc = hasNext.has(x) ? 1 : (COMPLETE_BASE[x.title.type] ?? 0.65) * (COMPLETE_PLATFORM[plat] ?? 0.9);
		if (rnd() < pc) {
			x.watchMs = runtime * (0.92 + rnd() * 0.08);
			x.completeT = x.startT + x.watchMs;
		} else {
			x.watchMs = runtime * (0.05 + rnd() * 0.8);
		}
		x.endT = x.startT + x.watchMs;
	};
	const sortKey = (x) => x.startT ?? (x.start ? T(x.start) : Infinity);
	units.sort((a, b) => sortKey(a) - sortKey(b));
	const placed = new Set();
	const place = (x) => {
		if (placed.has(x)) return;
		if (x.chainPrev) place(x.chainPrev);
		placed.add(x);
		if (x.chainPrev) {
			const p = x.chainPrev;
			x.startT = p.endT + (5 + rnd() * 20) * 1000;
			if (p.completeT === null && x.source === "autoplay") x.source = "continue_watching";
		} else if (x.startT == null) {
			x.startT = T(x.start);
		}
		finishUnit(x);
	};
	for (const x of [...units]) place(x);

	// ── H4: exactly k completions in the first 72 h of the trial ──
	if (born) {
		const lo = trialStartT, hi = trialStartT + EARLY_WINDOW_H * HOUR_MS;
		const have = units.filter((x) => x.completeT !== null && x.completeT >= lo && x.completeT < hi);
		if (have.length > k) {
			// drop whole units: organic first, then season 2; spare TV plays during the
			// incident. The first season 2 start goes last, and when it must go it
			// stays as a start the viewer stopped part-way (no completion), and the
			// rest of that sitting is dropped.
			const firstS2 = units.find((x) => x.origin === "s2" && x.episode === 1) || null;
			const rank = (x) => (x === firstS2 ? 16 : 0) + (x.origin === "s2" ? 2 : 0) + (x.platform === INCIDENT_PLATFORM && inIncident(x.startT) ? 4 : 0) + (hasNext.has(x) ? 1 : 0) + rnd();
			const order = [...have].sort((a, b) => rank(a) - rank(b));
			for (const x of order.slice(0, have.length - k)) {
				if (x !== firstS2) { x.dropped = true; continue; }
				x.completeT = null;
				x.watchMs = x.title.runtime * MIN_MS * (0.05 + rnd() * 0.8);
				x.endT = x.startT + x.watchMs;
				for (let c = units.find((u2) => u2.chainPrev === x); c; c = units.find((u2) => u2.chainPrev === c)) c.dropped = true;
			}
			for (const x of units) if (x.chainPrev?.dropped && x.source === "autoplay") x.source = "continue_watching";
		} else if (have.length < k) {
			for (let i = have.length; i < k; i++) {
				const s2 = tourist && s2Viewer && s2Next <= S2_EPISODES;
				const title = s2 ? SALTMARSH : (inProgress(false) || pickTitle(ADULT_TITLES, rnd()));
				const [season, episode] = s2 ? [2, s2Next++] : nextEpisode(title);
				const runtime = title.runtime * MIN_MS;
				const latest = Math.min(hi, END_MS, accessEnd) - runtime;
				if (latest <= lo + 10 * MIN_MS) break;
				const st = eveningTime(lo + 10 * MIN_MS, latest);
				let device = viewingDevice();
				if (platformOf(device) === INCIDENT_PLATFORM && inIncident(st)) device = devices.find((d) => platformOf(d) !== INCIDENT_PLATFORM) || device;
				const watchMs = runtime * (0.92 + rnd() * 0.08);
				sessionStarts.push({ t: st - (20 + rnd() * 60) * 1000, device });
				units.push({ start: null, startT: st, title, season, episode, source: "continue_watching", chainPrev: null, origin: "h4", kids: false, device, platform: platformOf(device) || "tv", failed: false, watchMs, completeT: st + watchMs, endT: st + watchMs });
			}
		}
	}

	// build event records for each unit
	const built = [];
	const dropStarts = new Set();
	const limit = Math.min(accessEnd, END_MS + 1);
	for (const x of units) {
		if (x.dropped || x.startT >= limit || x.startT < accessStart) { if (x.start) dropStarts.add(x.start); continue; }
		let s = x.start;
		if (!s) {
			s = clone("playback started", x.startT);
			if (!s) continue;
			built.push(s);
		}
		s.time = iso(x.startT);
		s.device_id = x.device;
		s.source = x.source;
		s.profile_type = x.kids ? "kids" : "adult";
		if (x.source !== "search") s.search_id = null;
		setTitle(s, x.title, x.season, x.episode);
		if (x.failed) {
			const nErr = rnd() < 0.3 ? 2 : 1;
			for (let i = 0; i < nErr; i++) {
				const tErr = x.startT + (5 + rnd() * 30 + i * 40) * 1000;
				if (tErr >= limit) break;
				const er = clone("playback error", tErr);
				if (!er) break;
				er.device_id = x.device;
				er.title_id = x.title.id; er.title_name = x.title.name;
				er.error_code = x.platform === INCIDENT_PLATFORM && inIncident(x.startT)
					? (rnd() < 0.7 ? "segment_timeout" : "manifest_unavailable")
					: pickWeighted({ segment_timeout: 35, drm_license_error: 25, network_lost: 30, decoder_error: 10 }, rnd());
				er.seconds_into_playback = Math.round((T(er) - x.startT) / 1000);
				built.push(er);
			}
			continue;
		}
		// ad breaks only while the household is on Basic with Ads (access ends or
		// a plan change can fall inside a long play)
		const onAds = (t) => t < limit && planAt(t) === "basic_ads";
		const tPre = x.startT + (16 + rnd() * 16) * 1000;
		if (onAds(tPre)) {
			const pre = clone("ad break completed", tPre);
			if (pre) {
				pre.device_id = x.device; pre.title_id = x.title.id; pre.ad_position = "pre_roll"; pre.ad_seconds = rnd() < 0.5 ? 15 : 30;
				built.push(pre);
				for (let m = MIDROLL_EVERY_MIN * MIN_MS; m < x.watchMs - 2 * MIN_MS; m += MIDROLL_EVERY_MIN * MIN_MS) {
					const tMid = x.startT + m + rnd() * MIN_MS;
					if (!onAds(tMid)) break;
					const mid = clone("ad break completed", tMid);
					mid.device_id = x.device; mid.title_id = x.title.id; mid.ad_position = "mid_roll"; mid.ad_seconds = [60, 90, 120][Math.floor(rnd() * 3)];
					built.push(mid);
				}
			}
		}
		if (x.completeT !== null && x.completeT < limit) {
			const d = clone("playback completed", x.completeT);
			if (!d) continue;
			d.device_id = x.device;
			d.profile_type = s.profile_type;
			setTitle(d, x.title, x.season, x.episode);
			d.watch_minutes = round1(x.watchMs / MIN_MS);
			built.push(d);
			const tRate = x.completeT + (8 + rnd() * 80) * 1000;
			if (rnd() < RATING_SHARE && tRate < limit) {
				const r = clone("rating submitted", tRate);
				if (r) {
					r.device_id = x.device; r.title_id = x.title.id; r.title_name = x.title.name;
					r.rating = pickWeighted({ thumbs_up: 62, love_this: 18, thumbs_down: 20 }, rnd());
					built.push(r);
				}
			}
		}
	}
	for (const st of sessionStarts) {
		if (st.t < accessStart || st.t >= limit) continue;
		const a = clone("app opened", st.t);
		if (a) { a.device_id = st.device; a.launch_source = "home_screen"; built.push(a); }
	}
	events = events.filter((e) => !dropStarts.has(e)).concat(built);

	// downloads only on a phone or tablet
	events = events.filter((e) => {
		if (e.event !== "download started") return true;
		if (!pushDevices.length) return false;
		if (!["mobile", "tablet"].includes(platformOf(e.device_id))) e.device_id = pushDevices[0];
		return true;
	});

	// ── lifecycle events ──
	for (const l of lifecycle) {
		if (l.t < BEGIN_MS || l.t > END_MS) continue;
		const ev = clone(l.name, l.t);
		if (!ev) continue;
		if (l.name === "subscription cancelled") {
			const before = planAt(l.t - 1);
			ev.plan = before === "none" ? plan : before;
			ev.during_trial = !!l.duringTrial;
			ev.cancel_reason = l.duringTrial
				? pickWeighted({ not_enough_to_watch: 34, too_expensive: 28, just_trying_it: 26, technical_issues: 4, other: 8 }, rnd())
				: pickWeighted({ too_expensive: 30, not_enough_to_watch: 26, taking_a_break: 22, switching_service: 12, technical_issues: 4, other: 6 }, rnd());
			ev.device_id = accountDevice();
		} else if (l.name === "plan changed") {
			ev.from_plan = l.from; ev.to_plan = l.to;
			ev.device_id = accountDevice();
		} else {
			ev.plan = planAt(l.t);
		}
		events.push(ev);
	}

	// born households: plan choice, viewer profiles, experiment exposure
	if (born) {
		for (const e of events) if (e.event === "plan selected" || e.event === "trial started") e.plan = plan;
		const extra = Math.max(0, (profile.profile_count || 1) - 1);
		for (let i = 0; i < extra; i++) {
			const pt = trialStartT + (2 + rnd() * 2 * 24 * 60) * MIN_MS;
			if (pt > END_MS || pt >= accessEnd) continue;
			const pe = clone("profile created", pt);
			if (!pe) break;
			pe.device_id = signupDevice;
			pe.profile_type = i === 0 && profile.has_kids_profile ? "kids" : "adult";
			events.push(pe);
		}
		if (variant !== null) {
			exposure.time = iso(trialStartT + (3 + rnd() * 17) * 1000);
			exposure.device_id = signupDevice;
			events.push(exposure);
		} else if (profile[EXP_KEY] !== undefined) {
			delete profile[EXP_KEY];
		}
	}
	const lastPlan = planChanges.length ? planChanges[planChanges.length - 1].plan : plan;
	profile.plan = lastPlan;
	profile.subscription_status = accessEnd <= END_MS ? "cancelled" : "active";

	return stampSuper(events.filter((e) => T(e) >= BEGIN_MS), planAt, signupDevice);
}

// warehouse rows: exogenous business facts layered on event-derived volumes
function handleWarehouse(row, meta) {
	if (meta.isBackfill) return row;
	if (meta.metricName === "marketing_spend_daily") {
		const k = `${row.date}|${row.acquisition_channel}`;
		const spend = paidSpend(row.date, row.acquisition_channel, row.spend_usd);
		row.spend_usd = spend;
		row.platform_reported_signups = Math.round(spend * PLATFORM_SIGNUP_INFLATION / CPA_USD[row.acquisition_channel] * jitter(`claim|${k}`, 0.2));
		row.clicks = Math.round(spend / (CPC_USD[row.acquisition_channel] * jitter(`cpc|${k}`, 0.15)));
		row.impressions = Math.round(row.clicks / (CTR[row.acquisition_channel] * jitter(`ctr|${k}`, 0.15)));
		return row;
	}
	if (meta.metricName === "playback_qos_daily") {
		const k = `${row.date}|${row.platform}`;
		// plays from app versions without analytics, plus CDN-side retries and
		// preview autoplays the player logs as attempts
		row.playback_attempts = Math.round(row.playback_attempts * (1 + UNTRACKED_PLAY_SHARE * jitter(`untracked|${k}`, 1))
			+ (PREVIEW_ATTEMPTS_PER_DAY[row.platform] ?? 0) * jitter(`preview|${k}`, 0.9));
		return row;
	}
	if (meta.metricName === "subscription_billing_daily") {
		const k = `${row.date}|${row.plan}`;
		let subs = row.new_paid_subscriptions;
		const store = hashFloat(`store|${k}`);
		if (store < STORE_UNTRACKED_SHARE) subs += store < STORE_UNTRACKED_SHARE / 4 ? 2 : 1;
		if (subs > 0 && hashFloat(`refund|${k}`) < REFUND_SHARE) subs -= 1;
		row.new_paid_subscriptions = subs;
		row.gross_bookings_usd = round2(subs * row.list_price_usd);
		return row;
	}
	return row;
}

const qosHit = (ctx) => ctx.row.platform === INCIDENT_PLATFORM && inIncident(ctx.time);

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
		hasAndroidDevices: false,
		hasIOSDevices: false,
		hasDesktopDevices: false,
		hasBrowser: false,
		hasCampaigns: false,
		isAnonymous: false,
		hasAdSpend: false,
		hasAvatar: false,
	},
	identity: { avgDevicePerUser: 2.2 },

	events: [
		{
			event: "account created",
			weight: 1,
			isFirstEvent: true,
			isAuthEvent: true,
			properties: {
				signup_method: { __weights: { email: 52, apple: 26, google: 22 } },
				acquisition_channel: (ctx) => ctx.profile.acquisition_channel,
			},
		},
		{ event: "plan selected", weight: 1, isStrictEvent: true, properties: { plan: ["standard"] } },
		{
			event: "trial started",
			weight: 1,
			isStrictEvent: true,
			properties: {
				plan: ["standard"],
				trial_days: [TRIAL_DAYS],
				payment_method: { __weights: { credit_card: 64, paypal: 18, apple_pay: 12, gift_card: 6 } },
			},
		},
		{ event: "trial converted", weight: 1, properties: { plan: ["standard"] } },
		{ event: "subscription renewed", weight: 1, properties: { plan: ["standard"] } },
		{
			event: "subscription cancelled",
			weight: 1,
			properties: { plan: ["standard"], cancel_reason: ["other"], during_trial: [false] },
		},
		{ event: "plan changed", weight: 1, properties: { from_plan: ["standard"], to_plan: ["premium"] } },
		{ event: "profile created", weight: 1, properties: { profile_type: ["adult"] } },
		{
			event: "app opened",
			weight: 1,
			isStrictEvent: true,
			properties: { launch_source: { __weights: { home_screen: 80, deep_link: 12, widget: 8 } } },
		},
		{
			event: "browse",
			weight: 1,
			isStrictEvent: true,
			properties: {
				row_name: { __weights: { continue_watching: 24, top_10: 18, new_releases: 16, because_you_watched: 18, reelhouse_originals: 14, trending_now: 10 } },
				rows_scrolled: u.weighNumRange(1, 24, 0.4, 5),
			},
		},
		{
			event: "search performed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				search_id: ["unassigned"],
				query_length: u.weighNumRange(1, 30, 0.4, 7),
				results_count: u.weighNumRange(0, 60, 0.4, 12),
			},
		},
		{
			event: "title details viewed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				title_id: ["rh_s07"], title_name: ["Harbor Lights"], content_type: ["series"], genre: ["drama"], is_original: [false], maturity_rating: ["TV-14"],
				search_id: [null],
			},
		},
		{
			event: "trailer played",
			weight: 1,
			isStrictEvent: true,
			properties: { title_id: ["rh_s07"], title_name: ["Harbor Lights"], content_type: ["series"], genre: ["drama"], is_original: [false], maturity_rating: ["TV-14"] },
		},
		{
			event: "watchlist added",
			weight: 1,
			isStrictEvent: true,
			properties: { title_id: ["rh_s07"], title_name: ["Harbor Lights"], content_type: ["series"], genre: ["drama"], is_original: [false], maturity_rating: ["TV-14"] },
		},
		{
			event: "playback started",
			weight: 1,
			isStrictEvent: true,
			properties: {
				title_id: ["rh_s07"], title_name: ["Harbor Lights"], content_type: ["series"], genre: ["drama"], is_original: [false], maturity_rating: ["TV-14"],
				season_number: [1], episode_number: [1],
				source: ["continue_watching"],
				profile_type: ["adult"],
				search_id: [null],
			},
		},
		{
			event: "playback completed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				title_id: ["rh_s07"], title_name: ["Harbor Lights"], content_type: ["series"], genre: ["drama"], is_original: [false], maturity_rating: ["TV-14"],
				season_number: [1], episode_number: [1],
				watch_minutes: [40],
				profile_type: ["adult"],
			},
		},
		{
			event: "playback error",
			weight: 1,
			properties: { title_id: ["rh_s07"], title_name: ["Harbor Lights"], error_code: ["segment_timeout"], seconds_into_playback: [10] },
		},
		{
			event: "ad break completed",
			weight: 1,
			properties: { title_id: ["rh_s07"], ad_position: ["pre_roll"], ad_seconds: [30] },
		},
		{
			event: "rating submitted",
			weight: 1,
			properties: { title_id: ["rh_s07"], title_name: ["Harbor Lights"], rating: ["thumbs_up"] },
		},
		{
			event: "download started",
			weight: 2,
			properties: {
				title_id: ["rh_s07"], title_name: ["Harbor Lights"], content_type: ["series"],
				download_quality: { __weights: { standard: 55, high: 45 } },
			},
		},
		{
			event: "notification received",
			weight: 30,
			properties: { campaign_type: ["trending_now"], title_name: ["Harbor Lights"] },
		},
		{
			event: "notification opened",
			weight: 1,
			properties: { campaign_type: ["trending_now"], minutes_to_open: [10] },
		},
		{
			event: "$experiment_started",
			weight: 1,
			isStrictEvent: true,
			properties: {
				"Experiment name": [SMART_START_EXPERIMENT],
				"Variant name": ["Control", SMART_START_VARIANT],
			},
		},
	],

	funnels: [
		{
			name: "Signup",
			sequence: ["account created", "plan selected", "trial started"],
			isFirstFunnel: true,
			conversionRate: 82,
			timeToConvert: 0.3,
			order: "sequential",
			weight: 1,
			experiment: {
				name: SMART_START_EXPERIMENT,
				startDaysBeforeEnd: (END_MS - ms(SMART_START_LAUNCH)) / DAY_MS,
				variants: [{ name: "Control" }, { name: SMART_START_VARIANT }],
			},
		},
		{
			name: "Watch",
			sequence: ["app opened", "browse", "title details viewed", "playback started", "playback completed"],
			conversionRate: 70,
			timeToConvert: 0.25,
			order: "sequential",
			weight: 12,
		},
		{
			name: "Binge",
			sequence: ["app opened", "playback started", "playback completed", "playback started", "playback completed", "playback started", "playback completed"],
			conversionRate: 50,
			timeToConvert: 0.3,
			order: "sequential",
			weight: 9,
		},
		{
			name: "Search",
			sequence: ["search performed", "title details viewed", "playback started"],
			conversionRate: 60,
			timeToConvert: 0.1,
			order: "sequential",
			weight: 5,
			props: {
				search_id: () => `srch_${chance.hash({ length: 12 })}`,
			},
		},
		{
			name: "Discover",
			sequence: ["app opened", "browse", "trailer played", "watchlist added"],
			conversionRate: 45,
			timeToConvert: 0.2,
			order: "sequential",
			weight: 4,
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
				// set by the warehouse hook from the day's spend
				platform_reported_signups: 0,
				clicks: 0,
				impressions: 0,
			},
		},
		{
			name: "playback_qos_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "playback started",
				measure: "count",
				groupBy: "platform",
			},
			timeColumn: "date",
			valueColumn: "playback_attempts",
			columns: {
				playback_failure_rate: (ctx) => {
					const j = hashFloat(`fail|${dayKey(ctx.time)}|${ctx.seriesKey}`);
					return qosHit(ctx) ? round2(INCIDENT_FAIL + (j - 0.5) * 0.04) : round4(BASE_FAIL * (0.6 + 0.8 * j));
				},
				rebuffer_ratio: (ctx) => {
					const j = hashFloat(`rebuf|${dayKey(ctx.time)}|${ctx.seriesKey}`);
					return qosHit(ctx) ? round4(0.06 + j * 0.03) : round4(0.004 + j * 0.005);
				},
				avg_bitrate_kbps: (ctx) => {
					const j = hashFloat(`bitrate|${dayKey(ctx.time)}|${ctx.seriesKey}`);
					const base = { tv: 7400, web: 4600, tablet: 3600, mobile: 2500 }[ctx.row.platform] ?? 4000;
					return Math.round(qosHit(ctx) ? base * (0.32 + j * 0.08) : base * (0.95 + j * 0.1));
				},
				p95_startup_ms: (ctx) => {
					const j = hashFloat(`startup|${dayKey(ctx.time)}|${ctx.seriesKey}`);
					return qosHit(ctx) ? Math.round(9500 + j * 5000) : Math.round(1700 + j * 700);
				},
				cdn_status: (ctx) => (qosHit(ctx) ? "degraded" : "healthy"),
			},
		},
		{
			name: "subscription_billing_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "trial converted",
				measure: "count",
				groupBy: "plan",
			},
			timeColumn: "date",
			valueColumn: "new_paid_subscriptions",
			columns: {
				list_price_usd: (ctx) => price(ctx.row.plan, ctx.time),
				gross_bookings_usd: (ctx) => round2(ctx.value * price(ctx.row.plan, ctx.time)),
			},
		},
	],

	superProps: {
		plan: ["standard"],
		platform: ["tv"],
		device_family: ["Roku"],
	},

	userProps: {
		plan: ["standard"],
		subscription_status: ["active"],
		acquisition_channel: weighted(CHANNEL_WEIGHTS),
		profile_count: [1],
		has_kids_profile: [false],
		country: ["US"],
		member_since: ["2025-01-01"],
	},

	personas: [
		{ name: "binge_watcher", weight: 22, eventMultiplier: 1.7 },
		{ name: "regular_viewer", weight: 48, eventMultiplier: 1.0 },
		{ name: "light_viewer", weight: 30, eventMultiplier: 0.5 },
	],

	retentionCurve: { type: "logarithmic", day1: 0.75, day7: 0.6, day30: 0.5 },

	hook(record, type, meta) {
		if (type === "user") return handleUserHook(record, meta);
		if (type === "everything") return handleEverything(record, meta);
		if (type === "warehouse") return handleWarehouse(record, meta);
		return record;
	},
};

// ── STORIES ──────────────────────────────────────────────────────────────
// Machine-checkable contract for hooks H1-H10. Evaluate with:
//   node dungeons/vertical/streaming/streaming.verify.mjs

const EV = `read_json_auto('{{PREFIX}}-EVENTS*.json*', sample_size=-1, union_by_name=true)`;
const US = `read_json_auto('{{PREFIX}}-USERS*.json*', sample_size=-1, union_by_name=true)`;
const WH = (table) => `read_json_auto('{{PREFIX}}-WAREHOUSE-${table}.json*', sample_size=-1, union_by_name=true)`;

// Identity prelude: a device resolves to the household seen with it on any
// event that carries both ids (emitted stitch evidence). Every Reelhouse event
// carries user_id, so the device map only matters for completeness.
const ID_CTE = `dmap AS (SELECT device_id, min(user_id::VARCHAR) AS mapped FROM ${EV}
  WHERE user_id IS NOT NULL AND device_id IS NOT NULL GROUP BY 1),
ev AS (SELECT coalesce(e.user_id::VARCHAR, m.mapped) AS uid, e.time::TIMESTAMP AS t, e.*
  FROM ${EV} e LEFT JOIN dmap m ON e.device_id = m.device_id)`;

const TS = (isoStr) => dayjs.utc(isoStr).format("YYYY-MM-DD HH:mm:ss");
const D = (isoStr) => isoStr.slice(0, 10);
const band = (k) => [Math.round(k * 0.9 * 1000) / 1000, Math.round(k * 1.1 * 1000) / 1000];
const CONV_WINDOW_DAYS = 8;          // trial started → trial converted (a trial converts at day 7)
const TRIAL_READ_END = TS(dayjs.utc(DATASET_END).subtract(CONV_WINDOW_DAYS, "day").add(1, "second").toISOString()); // trials with a full window
const INC_BASE_DAYS = 14;
const INC_BASE_FROM = TS(dayjs.utc(CDN_INCIDENT_START).subtract(INC_BASE_DAYS, "day").toISOString());
const INC_BASE_TO = TS(dayjs.utc(CDN_INCIDENT_END).add(INC_BASE_DAYS, "day").toISOString());
const SEARCH_WINDOW_MIN = 60;
// H4 targets: conversion base averaged over the designed early-completion mix
const kMix = (lo, hi) => {
	let w = 0, s = 0;
	for (const [kk, wt] of Object.entries(EARLY_K_WEIGHTS)) {
		const n = Number(kk);
		if (n >= lo && n <= hi) { w += wt; s += wt * convBase(n); }
	}
	return s / w;
};
const H4_POOLED = Math.round(kMix(3, 99) / kMix(0, 2) * 1000) / 1000;
const H4_PLATEAU = Math.round(kMix(5, 99) / kMix(3, 4) * 1000) / 1000;
const BASIC_RATIO = Math.round((PLAN_WEIGHTS_NEW.basic_ads + PRICE_SWITCH_SHARE * PLAN_WEIGHTS_NEW.standard) / PLAN_WEIGHTS_NEW.basic_ads * 1000) / 1000;
const INCIDENT_DID = Math.round((1 - INCIDENT_FAIL) / (1 - BASE_FAIL) * 1000) / 1000;
// H2 signup lift: premiere joiners per day over the engine's steady signups per day
const PREMIERE_LIFT = Math.round((1 + (NUM_USERS * (1 - BORN_PCT / 100) * PREMIERE_JOIN_SHARE / PREMIERE_JOIN_DAYS) / (NUM_USERS * BORN_PCT / 100 / WINDOW_DAYS)) * 1000) / 1000;

// one row per trial: start, signup, early completions, converted within the window
const TRIALS_CTE = `${ID_CTE},
ts AS (SELECT uid, min(t) AS t0 FROM ev WHERE event = 'trial started' GROUP BY 1),
sg AS (SELECT uid, min(t) AS signup_t FROM ev WHERE event = 'account created' GROUP BY 1),
cv AS (SELECT uid, min(t) AS tc FROM ev WHERE event = 'trial converted' GROUP BY 1),
kc AS (SELECT ts.uid, count(e.uid) AS k FROM ts LEFT JOIN ev e ON e.uid = ts.uid AND e.event = 'playback completed'
  AND e.t >= ts.t0 AND e.t < ts.t0 + INTERVAL ${EARLY_WINDOW_H} HOUR GROUP BY 1),
pr AS (SELECT distinct_id::VARCHAR AS uid, acquisition_channel, "${EXP_KEY}" AS variant FROM ${US}),
tr AS (SELECT ts.uid, ts.t0, sg.signup_t, kc.k, pr.acquisition_channel, pr.variant,
  coalesce(cv.tc >= ts.t0 AND cv.tc < ts.t0 + INTERVAL ${CONV_WINDOW_DAYS} DAY, false) AS conv
  FROM ts JOIN sg USING (uid) JOIN kc USING (uid) LEFT JOIN cv USING (uid) LEFT JOIN pr USING (uid)
  WHERE ts.t0 < TIMESTAMP '${TRIAL_READ_END}')`;

const H1_SQL = `WITH ${ID_CTE},
m AS (SELECT distinct_id::VARCHAR AS uid FROM ${US} WHERE member_since < '${D(SALTMARSH_PREMIERE)}'),
a AS (SELECT DISTINCT ev.uid FROM ev JOIN m USING (uid) WHERE event = 'playback started'
  AND t >= TIMESTAMP '${TS(SALTMARSH_PREMIERE)}' AND t < TIMESTAMP '${TS(REACH_END)}'),
s AS (SELECT DISTINCT uid FROM ev WHERE event = 'playback started' AND title_name = '${SALTMARSH.name}' AND season_number = 2
  AND t >= TIMESTAMP '${TS(SALTMARSH_PREMIERE)}' AND t < TIMESTAMP '${TS(REACH_END)}')
SELECT 'all' AS grp, count(*) AS user_count, count(s.uid)::DOUBLE / count(*) AS reach,
 (SELECT count(*) FROM ev WHERE title_name = '${SALTMARSH.name}' AND season_number = 2 AND t < TIMESTAMP '${TS(SALTMARSH_PREMIERE)}') AS early_s2
FROM a LEFT JOIN s USING (uid)`;

const H2_SQL = `WITH ${TRIALS_CTE}
SELECT CASE WHEN signup_t >= TIMESTAMP '${TS(SALTMARSH_PREMIERE)}' AND signup_t < TIMESTAMP '${TS(TOURIST_END)}' THEN 'premiere' ELSE 'other' END AS grp,
 count(*) AS user_count, avg(conv::INT) AS conv
FROM tr WHERE t0 >= TIMESTAMP '${TS(SMART_START_LAUNCH)}' GROUP BY 1`;

const H2_LIFT_SQL = `WITH ${ID_CTE},
s AS (SELECT t FROM ev WHERE event = 'account created')
SELECT 'all' AS grp, count(*) AS user_count,
 (count(*) FILTER (WHERE t >= TIMESTAMP '${TS(SALTMARSH_PREMIERE)}' AND t < TIMESTAMP '${TS(TOURIST_END)}')::DOUBLE / ${PREMIERE_JOIN_DAYS})
 / (count(*) FILTER (WHERE t < TIMESTAMP '${TS(SALTMARSH_PREMIERE)}' OR t >= TIMESTAMP '${TS(TOURIST_END)}')::DOUBLE / ${WINDOW_DAYS - PREMIERE_JOIN_DAYS}) AS lift
FROM s`;

const H3_SQL = `WITH ${TRIALS_CTE}
SELECT variant AS grp, count(*) AS user_count, avg(conv::INT) AS conv, avg(k) AS early_completions
FROM tr WHERE t0 >= TIMESTAMP '${TS(SMART_START_LAUNCH)}' AND variant IS NOT NULL GROUP BY 1`;

const H4_SQL = `WITH ${TRIALS_CTE}
SELECT CASE WHEN k >= 3 THEN '3+' ELSE '0-2' END AS grp, count(*) AS user_count, avg(conv::INT) AS conv FROM tr GROUP BY 1
UNION ALL
SELECT CASE WHEN k >= 5 THEN '5+' ELSE '3-4' END AS grp, count(*) AS user_count, avg(conv::INT) AS conv FROM tr WHERE k >= 3 GROUP BY 1`;

const H5_SQL = `WITH ${ID_CTE},
o AS (SELECT DISTINCT date::DATE AS d, platform FROM ${WH("playback_qos_daily")} WHERE cdn_status = 'degraded'),
od AS (SELECT DISTINCT d FROM o), op AS (SELECT DISTINCT platform FROM o),
w AS (SELECT t::DATE AS d, uid, event, (platform IN (SELECT platform FROM op)) AS hit FROM ev
  WHERE event IN ('playback started', 'playback completed') AND t >= TIMESTAMP '${INC_BASE_FROM}' AND t < TIMESTAMP '${INC_BASE_TO}'),
g AS (SELECT (d IN (SELECT d FROM od)) AS outage, hit, count(DISTINCT uid) AS users,
  count(*) FILTER (WHERE event = 'playback completed')::DOUBLE / count(*) FILTER (WHERE event = 'playback started') AS cr FROM w GROUP BY 1, 2)
SELECT 'all' AS grp, (SELECT count(*) FROM od) AS outage_days, min(users) AS user_count,
 (max(cr) FILTER (WHERE outage AND hit) / max(cr) FILTER (WHERE outage AND NOT hit))
 / (max(cr) FILTER (WHERE NOT outage AND hit) / max(cr) FILTER (WHERE NOT outage AND NOT hit)) AS did
FROM g`;

const H6_SQL = `WITH ${ID_CTE},
p AS (SELECT CASE WHEN t >= TIMESTAMP '${TS(PRICE_CHANGE)}' THEN 'after' ELSE 'before' END AS per, plan FROM ev WHERE event = 'plan selected'),
s AS (SELECT per, plan, count(*) AS n, count(*)::DOUBLE / sum(count(*)) OVER (PARTITION BY per) AS share FROM p GROUP BY 1, 2)
SELECT plan AS grp, min(n) AS user_count, max(share) FILTER (WHERE per = 'after') / max(share) FILTER (WHERE per = 'before') AS share_ratio
FROM s GROUP BY 1`;

const H7_SQL = `WITH ${TRIALS_CTE},
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM ${WH("marketing_spend_daily")} GROUP BY 1),
su AS (SELECT acquisition_channel AS ch, count(*) AS signups FROM ev WHERE event = 'account created' GROUP BY 1)
SELECT su.ch AS grp, su.signups AS user_count, sp.spend / su.signups AS spend_per_signup, NULL AS conv FROM su LEFT JOIN sp USING (ch)
UNION ALL
SELECT CASE WHEN acquisition_channel = 'paid_social' THEN 'social_trials' ELSE 'other_trials' END AS grp, count(*) AS user_count, NULL, avg(conv::INT) AS conv
FROM tr GROUP BY 1`;

const H8_SQL = `WITH ${ID_CTE},
u AS (SELECT distinct_id::VARCHAR AS uid, profile_count FROM ${US}),
x AS (SELECT CASE WHEN u.profile_count >= 2 THEN 'shared' ELSE 'single' END AS grp, ev.uid, ev.event FROM ev JOIN u USING (uid)
  WHERE ev.event = 'subscription renewed' OR (ev.event = 'subscription cancelled' AND NOT ev.during_trial))
SELECT grp, count(DISTINCT uid) AS user_count, count(*) FILTER (WHERE event = 'subscription cancelled')::DOUBLE / count(*) AS churn_rate
FROM x GROUP BY 1`;

const H9_SQL = `WITH ${ID_CTE}
SELECT campaign_type AS grp, count(DISTINCT uid) FILTER (WHERE event = 'notification received') AS user_count,
 count(*) FILTER (WHERE event = 'notification opened')::DOUBLE / count(*) FILTER (WHERE event = 'notification received') AS open_rate
FROM ev WHERE event IN ('notification received', 'notification opened') GROUP BY 1`;

const H10_SQL = `WITH ${ID_CTE},
s AS (SELECT uid, search_id, t AS ts, platform FROM ev WHERE event = 'search performed'),
p AS (SELECT search_id, min(t) AS tp FROM ev WHERE event = 'playback started' AND search_id IS NOT NULL GROUP BY 1)
SELECT CASE WHEN s.platform = 'tv' THEN 'tv' ELSE 'other' END AS grp, count(DISTINCT s.uid) AS user_count, count(*) AS searches,
 median(date_diff('millisecond', s.ts, p.tp) / 1000.0) AS median_seconds
FROM s JOIN p USING (search_id) WHERE p.tp >= s.ts AND p.tp < s.ts + INTERVAL ${SEARCH_WINDOW_MIN} MINUTE GROUP BY 1`;

/** @type {import("../../../types").DungeonStory[]} */
export const stories = [
	{
		id: "H1-saltmarsh-season-2-premiere",
		hook: "H1",
		archetype: "temporal-inflection",
		narrative: `All ${S2_EPISODES} episodes of Saltmarsh season 2 (Reelhouse's flagship original) drop ${D(SALTMARSH_PREMIERE)}. ${SALTMARSH_REACH * 100}% of households that joined before the premiere and played anything ${D(SALTMARSH_PREMIERE)} to 2026-07-30 start season 2 in that fortnight (most in the first days), watching 1-${S2_EPISODES} episodes in sittings of 1-4; the plays are added viewing, so daily plays rise in late July. A new_season push goes out ${TS(SALTMARSH_PUSH)} UTC. Read: households with a season 2 play over households with any play, Jul 17-30, members who joined before the premiere. No season 2 play exists before the premiere.`,
		mixpanelReport: { type: "Insights", event: "playback started", measure: "Uniques", filter: "title_name = Saltmarsh AND season_number = 2", denominator: "playback started (Uniques)", dateRange: "2026-07-17 to 2026-07-30", cohort: "exclude households with account created on or after 2026-07-17 (member_since before 2026-07-17)" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H1_SQL },
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.reach", op: "between", target: band(SALTMARSH_REACH) },
				minCohort: 2000,
			},
			{
				breakdown: { type: "duckdb", sql: H1_SQL },
				select: { a: { where: { grp: "all" } } },
				// exact: a season 2 play before the premiere is a bug
				expect: { metric: "a.early_s2", op: "between", target: [0, 0] },
			},
		],
	},
	{
		id: "H2-premiere-tourists",
		hook: "H2",
		archetype: "funnel-conversion-by-segment",
		narrative: `The premiere brings in new households: ${PREMIERE_JOIN_SHARE * 100}% of the households that would otherwise have been members already join in the three weeks after the Saltmarsh premiere (${D(SALTMARSH_PREMIERE)} to 2026-08-06) instead, most in the first week, so accounts created per day in those weeks run ${PREMIERE_LIFT}x the rest of the window. Households that create an account in those weeks come for one show: ${TOURIST_S2_SHARE * 100}% start season 2 within a day of starting their trial, and their trials convert at ${TOURIST_CONV_MULT}x the rate of other trials. Reads: account created per day, ${D(SALTMARSH_PREMIERE)} to 2026-08-06 vs the other ${WINDOW_DAYS - PREMIERE_JOIN_DAYS} days; trial started → trial converted within ${CONV_WINDOW_DAYS} days (trials convert at day 7), trials from ${D(SMART_START_LAUNCH)} (both groups had the Smart Start test) to ${TRIAL_READ_END.slice(0, 10)} (complete windows), premiere signups vs every other signup. About 1,000 premiere trials converting near 30%, so the conversion ratio carries roughly ±5% sampling noise; that read uses the knob as target with a half-effect floor.`,
		mixpanelReport: { type: "Funnels", steps: ["trial started", "trial converted"], counting: "uniques", window: `${CONV_WINDOW_DAYS} days`, dateRange: `${D(SMART_START_LAUNCH)} to ${TRIAL_READ_END.slice(0, 10)}`, breakdown: "cohort: account created between 2026-07-17 and 2026-08-06", volume: "Insights, account created, Totals, daily or weekly" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H2_LIFT_SQL },
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.lift", op: "between", target: band(PREMIERE_LIFT) },
				minCohort: 3000,
			},
			{
				breakdown: { type: "duckdb", sql: H2_SQL },
				select: { p: { where: { grp: "premiere" } }, o: { where: { grp: "other" } } },
				// about 1,000 premiere trials converting near 30%: the ratio carries about ±5%
				// sampling noise, so the read uses the knob as target with a half-effect floor
				expect: { metric: "p.conv / o.conv", op: "<=", target: TOURIST_CONV_MULT, floor: Math.round((1 - 0.5 * (1 - TOURIST_CONV_MULT)) * 1000) / 1000 },
				minCohort: 400,
			},
		],
	},
	{
		id: "H3-smart-start-experiment",
		hook: "H3",
		archetype: "experiment-lift",
		narrative: `The "${SMART_START_EXPERIMENT}" test starts ${D(SMART_START_LAUNCH)}: every new trial is split 50/50 (sticky per household; exposure $experiment_started a few seconds after trial started). The "${SMART_START_VARIANT}" arm opens with a taste picker and personalized first rows; it multiplies trial conversion by ${SMART_START_CONV_MULT}. Viewing in the first three days is not engineered by arm (the same early-completion mix in both). Read: trial started → trial converted within ${CONV_WINDOW_DAYS} days, trials ${D(SMART_START_LAUNCH)} to ${TRIAL_READ_END.slice(0, 10)}, by arm.`,
		mixpanelReport: { type: "Funnels", steps: ["trial started", "trial converted"], counting: "uniques", window: `${CONV_WINDOW_DAYS} days`, dateRange: `${D(SMART_START_LAUNCH)} to ${TRIAL_READ_END.slice(0, 10)}`, breakdown: `user property "${EXP_KEY}"`, alt: "Experiments report on $experiment_started" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H3_SQL },
				select: { v: { where: { grp: SMART_START_VARIANT } }, c: { where: { grp: "Control" } } },
				expect: { metric: "v.conv / c.conv", op: "between", target: band(SMART_START_CONV_MULT) },
				minCohort: 800,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 count(DISTINCT uid) FILTER (WHERE "Variant name" = '${SMART_START_VARIANT}')::DOUBLE / count(DISTINCT uid) AS variant_share,
 count(*) FILTER (WHERE t < TIMESTAMP '${TS(SMART_START_LAUNCH)}') AS early
FROM ev WHERE event = '$experiment_started'`,
				},
				select: { a: { where: { grp: "all" } } },
				// equal-weight 2-arm hash → 0.5
				expect: { metric: "a.variant_share", op: "between", target: band(0.5) },
				minCohort: 1500,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count, count(*) FILTER (WHERE t < TIMESTAMP '${TS(SMART_START_LAUNCH)}') AS early
FROM ev WHERE event = '$experiment_started'`,
				},
				select: { a: { where: { grp: "all" } } },
				// exact: no exposure before the test starts
				expect: { metric: "a.early", op: "between", target: [0, 0] },
			},
		],
	},
	{
		id: "H4-three-episodes-in-three-days",
		hook: "H4",
		archetype: "frequency-sweet-spot",
		narrative: `Trials that finish three episodes or films in their first ${EARLY_WINDOW_H} hours convert far more often. Each trial's playback completed count in the first ${EARLY_WINDOW_H} h after trial started follows a smooth distribution (0-10), and the conversion base by that count is ${CONV_BY_EARLY.map((c, i) => `${i}${i === CONV_BY_EARLY.length - 1 ? "+" : ""} → ${Math.round(c * 100)}%`).join(", ")}: a jump at 3, flat above it. Read: trial conversion within ${CONV_WINDOW_DAYS} days for 3+ vs 0-2 early completions (target ${H4_POOLED}, the k-weighted average of the base) and for 5+ vs 3-4 (plateau, target ${H4_PLATEAU}). Channel, premiere, and test multipliers are independent of the count, so they cancel in the ratios.`,
		mixpanelReport: { type: "Funnels", steps: ["trial started", "playback completed", "playback completed", "playback completed"], window: `${EARLY_WINDOW_H / 24} days`, then: "create cohort from step 4; Funnels trial started → trial converted (8-day window) breakdown by that cohort" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H4_SQL },
				select: { hi: { where: { grp: "3+" } }, lo: { where: { grp: "0-2" } } },
				expect: { metric: "hi.conv / lo.conv", op: "between", target: band(H4_POOLED) },
				minCohort: 800,
			},
			{
				breakdown: { type: "duckdb", sql: H4_SQL },
				select: { hi: { where: { grp: "5+" } }, mid: { where: { grp: "3-4" } } },
				expect: { metric: "hi.conv / mid.conv", op: "between", target: band(H4_PLATEAU) },
				minCohort: 500,
			},
		],
	},
	{
		id: "H5-tv-streaming-incident",
		hook: "H5",
		archetype: "external-join",
		narrative: `From ${D(CDN_INCIDENT_START)} to ${D(CDN_INCIDENT_END)} (exclusive) a CDN fault hits the TV apps: ${INCIDENT_FAIL * 100}% of TV playback starts fail (a "playback error", no completion) vs ${BASE_FAIL * 100}% normally; phone, tablet, and web are untouched. The incident days and platform come from warehouse playback_qos_daily (cdn_status = 'degraded', playback_failure_rate ≈ ${INCIDENT_FAIL}). Event read: TV/other ratio of playback completed per playback started on degraded days vs the ${INC_BASE_DAYS} days either side reads (1 - ${INCIDENT_FAIL}) / (1 - ${BASE_FAIL}) = ${INCIDENT_DID}.`,
		mixpanelReport: { type: "Insights", events: ["playback completed", "playback started"], formula: "A / B", breakdown: "platform", chart: "daily line", join: "warehouse playback_qos_daily.cdn_status" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H5_SQL },
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.did", op: "between", target: band(INCIDENT_DID) },
				minCohort: 500,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT 'all' AS grp, count(*) FILTER (WHERE cdn_status = 'degraded') AS degraded_rows,
 avg(playback_failure_rate) FILTER (WHERE cdn_status = 'degraded') AS degraded_fail
FROM ${WH("playback_qos_daily")}`,
				},
				select: { a: { where: { grp: "all" } } },
				// warehouse failure rate during the incident = the failure knob
				expect: { metric: "a.degraded_fail", op: "between", target: band(INCIDENT_FAIL) },
			},
		],
	},
	{
		id: "H6-standard-price-increase",
		hook: "H6",
		archetype: "composition-drift",
		narrative: `On ${D(PRICE_CHANGE)} Standard rises from $${PRICES.standard[0]} to $${PRICES.standard[1]} a month for new subscriptions (existing subscribers keep their price; Basic with Ads and Premium do not change). ${PRICE_SWITCH_SHARE * 100}% of new households that would have picked Standard pick Basic with Ads instead, so Standard's share of plan selections falls to ${1 - PRICE_SWITCH_SHARE}x and Basic with Ads' share rises to (${PLAN_WEIGHTS_NEW.basic_ads} + ${PRICE_SWITCH_SHARE} x ${PLAN_WEIGHTS_NEW.standard}) / ${PLAN_WEIGHTS_NEW.basic_ads} = ${BASIC_RATIO}x. Signup volume does not change. Prices live only in warehouse subscription_billing_daily.`,
		mixpanelReport: { type: "Insights", event: "plan selected", measure: "Totals, % of total", breakdown: "plan", chart: "before vs after 2026-08-11", join: "subscription_billing_daily.list_price_usd" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H6_SQL },
				select: { s: { where: { grp: "standard" } } },
				expect: { metric: "s.share_ratio", op: "between", target: band(1 - PRICE_SWITCH_SHARE) },
				minCohort: 400,
			},
			{
				breakdown: { type: "duckdb", sql: H6_SQL },
				select: { b: { where: { grp: "basic_ads" } } },
				expect: { metric: "b.share_ratio", op: "between", target: band(BASIC_RATIO) },
				minCohort: 400,
			},
		],
	},
	{
		id: "H7-paid-social-cac",
		hook: "H7",
		archetype: "external-join",
		narrative: `Warehouse marketing_spend_daily bills each paid channel as ${SPEND_PLAN_SHARE * 100}% paced budget (weekday shape above a ${SPEND_FLAT_SHARE * 100}% floor) plus ${(1 - SPEND_PLAN_SHARE) * 100}% bid x that day's delivered signups, with ±${SPEND_NOISE * 100}% day noise: $${CPA_USD.paid_social} paid_social, $${CPA_USD.paid_search} paid_search, $${CPA_USD.ctv} ctv per Mixpanel signup over the window. paid_social trials convert at ${SOCIAL_CONV_MULT}x the rate of every other channel, so the cheapest channel per signup costs about (${CPA_USD.paid_social} / ${SOCIAL_CONV_MULT}) / ${CPA_USD.paid_search} = ${(CPA_USD.paid_social / SOCIAL_CONV_MULT / CPA_USD.paid_search).toFixed(2)}x paid_search per paying subscriber. Reads: spend per signup paid_social / paid_search (join) and trial conversion paid_social / all other channels.`,
		mixpanelReport: { type: "Insights + Funnels + warehouse", event: "account created", breakdown: "acquisition_channel", join: "marketing_spend_daily.spend_usd", funnel: `trial started → trial converted, ${CONV_WINDOW_DAYS}-day window, breakdown user property acquisition_channel` },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H7_SQL },
				select: { s: { where: { grp: "paid_social" } }, p: { where: { grp: "paid_search" } } },
				expect: { metric: "s.spend_per_signup / p.spend_per_signup", op: "between", target: band(CPA_USD.paid_social / CPA_USD.paid_search) },
				minCohort: 400,
			},
			{
				breakdown: { type: "duckdb", sql: H7_SQL },
				select: { s: { where: { grp: "social_trials" } }, o: { where: { grp: "other_trials" } } },
				expect: { metric: "s.conv / o.conv", op: "between", target: band(SOCIAL_CONV_MULT) },
				minCohort: 500,
			},
		],
	},
	{
		id: "H8-shared-households-stay",
		hook: "H8",
		archetype: "retention-divergence",
		narrative: `At each monthly renewal a paying subscriber cancels with probability ${CANCEL_HAZARD_SINGLE * 100}% when the account has one viewer profile and ${CANCEL_HAZARD_SINGLE * MULTI_PROFILE_HAZARD_MULT * 100}% (${MULTI_PROFILE_HAZARD_MULT}x) with two or more; otherwise the renewal goes through. A cancellation lands up to ${CANCEL_LEAD_MAX_DAYS} days before the renewal it replaces and access ends on the renewal date. Read: renewal-time churn = paid cancellations (during_trial = false) / (renewals + paid cancellations), shared (2+ profiles) over single-profile accounts. About 400-500 cancellations per group, so the ratio carries roughly ±7% sampling noise.`,
		mixpanelReport: { type: "Insights", events: ["subscription cancelled (during_trial = false)", "subscription renewed"], formula: "A / (A + B)", breakdown: "user property profile_count (1 vs 2+)" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H8_SQL },
				select: { m: { where: { grp: "shared" } }, s: { where: { grp: "single" } } },
				expect: { metric: "m.churn_rate / s.churn_rate", op: "<=", target: MULTI_PROFILE_HAZARD_MULT, floor: Math.round((1 - 0.5 * (1 - MULTI_PROFILE_HAZARD_MULT)) * 1000) / 1000 },
				minCohort: 1000,
			},
		],
	},
	{
		id: "H9-personalized-pushes",
		hook: "H9",
		archetype: "cohort-prop-scale",
		narrative: `Push open rate depends on the campaign: new_episode (a new episode of a series the household is watching) ${OPEN_RATE.new_episode * 100}%, because_you_watched ${OPEN_RATE.because_you_watched * 100}%, trending_now ${OPEN_RATE.trending_now * 100}%; win_back pushes to lapsed households ${OPEN_RATE.win_back * 100}%, and the one-off new_season push for Saltmarsh on ${D(SALTMARSH_PUSH)} ${OPEN_RATE.new_season * 100}%. About half of the opens lead to a play of the pushed title. Read: notification opened / notification received (totals) by campaign_type, against trending_now.`,
		mixpanelReport: { type: "Insights", events: ["notification opened", "notification received"], formula: "A / B", measure: "Totals", breakdown: "campaign_type" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H9_SQL },
				select: { n: { where: { grp: "new_episode" } }, t: { where: { grp: "trending_now" } } },
				expect: { metric: "n.open_rate / t.open_rate", op: "between", target: band(OPEN_RATE.new_episode / OPEN_RATE.trending_now) },
				minCohort: 1000,
			},
			{
				breakdown: { type: "duckdb", sql: H9_SQL },
				select: { b: { where: { grp: "because_you_watched" } }, t: { where: { grp: "trending_now" } } },
				expect: { metric: "b.open_rate / t.open_rate", op: "between", target: band(OPEN_RATE.because_you_watched / OPEN_RATE.trending_now) },
				minCohort: 1000,
			},
		],
	},
	{
		id: "H10-tv-search-is-slow",
		hook: "H10",
		archetype: "funnel-ttc-by-segment",
		narrative: `Searching with a TV remote is slow: the time from search performed to the playback it leads to (same search_id) is ${TV_SEARCH_TTC_MULT}x on tv vs phone, tablet, and web (log-normal, median about ${SEARCH_GAP_MEDIAN_S} s off TV). Read: median seconds from search to play within ${SEARCH_WINDOW_MIN} minutes, per search, tv vs other.`,
		mixpanelReport: { type: "Funnels", steps: ["search performed", "playback started"], holdPropertyConstant: "search_id", window: `${SEARCH_WINDOW_MIN} minutes`, measure: "median time to convert", breakdown: "platform" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H10_SQL },
				select: { tv: { where: { grp: "tv" } }, o: { where: { grp: "other" } } },
				expect: { metric: "tv.median_seconds / o.median_seconds", op: "between", target: band(TV_SEARCH_TTC_MULT) },
				minCohort: 1000,
			},
		],
	},
];

export default config;
