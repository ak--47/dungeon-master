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
 * NAME:       Brightpath Academy
 * APP:        Online learning platform for professional skills (data, software,
 *             business, design, marketing, languages). 68 courses, each either
 *             self-paced or cohort-based (live sessions, weekly deadlines, a
 *             facilitator). Free plan; Brightpath Plus ($29 → $35 per month from
 *             2026-08-10, $239 per year unchanged); Brightpath for Teams seats
 *             paid by employers. Ask Bright (AI tutor) is a Plus and Teams
 *             feature from 2026-07-21. Web plus iOS and Android apps.
 * SCALE:      10,000 learners (3,952 sign up inside the window), ~0.87M events,
 *             120 days (2026-06-04 → 2026-10-01, UTC)
 * CORE LOOP:  course page viewed → course enrolled → lesson started → lesson
 *             completed (→ quiz submitted, assignment submitted) → certificate earned
 * VALUE MOMENT: lesson completed
 *
 * EVENTS (17):
 *   lesson started > lesson completed > home viewed > course page viewed
 *   > course search > quiz submitted > discussion posted > course enrolled
 *   > assignment submitted > paywall viewed > ai tutor question asked
 *   > live session attended > $experiment_started > certificate earned
 *   > account created > learning goals set > subscription started
 *
 * FUNNELS (4 configs):
 *   - Onboarding (first funnel, two copies by account_type, H3):
 *       account created → learning goals set → course enrolled → lesson started
 *       (52% self-pay, 78% employer-sponsored; 36 h vs 18 h)
 *   - Course Enrollment: course page viewed → course enrolled (30%, course_id per
 *       run, A/B "Personalized Course Picks" from 2026-07-08, H2)
 *   - Lesson: lesson started → lesson completed (82%, 1 h, lesson_id and
 *       content_type per run)
 *   Everything else (quizzes, assignments, discussions, live sessions, tutor
 *   questions, home, search, paywall) comes from the engine's standalone pool and
 *   is tied to a course by the everything hook's course model.
 *
 * USER PROPS:  learner_segment, account_type, primary_goal, plan_tier,
 *              customer_since, acquisition_channel, preferred_playback_speed,
 *              "Experiment: Personalized Course Picks" (exposed learners)
 * SUPER PROPS: plan_tier (plan at event time: free / plus / teams),
 *              platform (web / ios / android, from the device OS)
 * SCD PROPS:   none
 * GROUPS:      none
 * WAREHOUSE:   paid_marketing_daily (spend by paid channel),
 *              app_stability_daily (video starts and playback health by platform),
 *              subscription_billing_daily (new Plus subscriptions, list price,
 *              bookings by billing interval)
 * LOOKUPS:     none — the course catalog is denormalized onto course events
 * SOUP:        Sunday-heavy week with a Friday/Saturday dip; evening peaks in
 *              the Americas, India, and Europe (UTC)
 *
 * IDENTITY: new learners are identified at "account created" (isAuthEvent, first
 * event, carries user_id + device_id); about 2 devices per learner. Every event
 * carries user_id; there is no anonymous pre-signup activity. The onboarding
 * steps after signup carry the signup device (they land hours later, so the
 * engine's time-gap sessions usually differ from the signup session).
 * "certificate earned" and "subscription started" are sent by the backend:
 * user_id only, no device_id or platform.
 *
 * DESIGN NOTES:
 * - Course catalog: 68 seeded courses (16 cohort; title, category, format, level, length
 *   4-8 weeks). course page viewed, course enrolled, and certificate earned carry
 *   the catalog fields; lessons, quizzes, assignments, discussions, live sessions,
 *   and tutor questions carry course_id and course_category.
 * - Course model (everything hook): each enrollment is active from its enrollment
 *   until it finishes or is abandoned; learning events are assigned to an active
 *   enrollment (a lesson start and its completion share a course), live sessions
 *   only to active cohort enrollments. A learner never enrolls in the same course
 *   twice. Established learners carry courses they enrolled in before June 4
 *   (0.75 per in-window enrollment, enrolled up to 90 days earlier), so June has
 *   lessons and certificates in flight. lesson_number and quiz_number advance
 *   with the learner's progress through the course.
 * - "Still active at t" (certificates and purchases): before the learner's lapse
 *   cut (new learners) and with an event in the 14 days up to t. The look is
 *   backward only, so the window end does not hide learners whose next visit
 *   falls after Oct 1; near June 4 it looks at the window's first 14 days.
 * - Certificates are issued when a finishing enrollment's course ends (cohort:
 *   on schedule; self-paced: nominal length × a pace with median 1), only if
 *   the learner is still active then; days_to_complete is the real gap.
 * - Purchases are placed by the hook: new self-pay learners (and those who
 *   joined in the 60 days before June 4, at the same rate and with the same
 *   lapse / go-dark / setup-abandon survival drawn from their join time, so
 *   June starts with purchases in flight at the steady-state rate) buy a
 *   lognormal lag after signup (median 6 days);
 *   long-time free learners buy at a uniform moment in the window. A purchase
 *   happens only if the learner is still active at that moment. About 9% of new
 *   self-pay learners buy Plus within 30 days (the certificate upsell); about 5%
 *   of long-time free learners buy during the window. One subscription per
 *   learner; a paywall view precedes each purchase; paywalls are shown to free
 *   learners only. plan_tier on each event is the plan at that moment.
 * - A lesson is finished on the device it was started on: lesson completed
 *   carries its start's device fields.
 * - New learners: retentionCurve shapes activity; 55% lapse on a uniform day
 *   3-60; 60% of learners who never start a lesson stop on day 1-5; 75% finish
 *   their first onboarding lesson in the same sitting.
 * - Ask Bright questions often run to follow-ups (up to 3, 1-7 minutes apart).
 * - Minutes per video lesson follow the playback speed; reading and lab lessons
 *   carry no playback_speed.
 * - Warehouse drift: app_stability_daily.video_starts adds course trailer and
 *   preview plays that send no lesson event; subscription_billing_daily drops
 *   first payments that fail (5%) and adds app-store purchases Mixpanel never
 *   receives. paid_marketing_daily spend is a paced daily budget per channel
 *   (CPL × expected signups per day, a weekday shape above a 35% flat floor,
 *   seeded ±12% noise, never zero); clicks, impressions, and platform-reported
 *   signups follow spend.
 */

// ── HOOK STORIES ──
/*
 * All effects are hidden: no flag properties. Each is found by a breakdown, a
 * date comparison, or a cohort. Dates live in the TIMELINE constants and are
 * shared by hooks, stories, SQL, warehouse columns, and the timeline guide.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H1. ASK BRIGHT AI TUTOR LAUNCH (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-07-21, 45% of Plus and Teams learners (plan at event time)
 *   adopt Ask Bright. Each adopter starts on a salted day in the 21 days after
 *   launch and keeps a salted 35-85% of their would-be questions, so use ramps
 *   for three weeks and then holds. After a learner's first tutor question their
 *   quiz scores rise by 8 points. Free learners never see the tutor.
 * MIXPANEL: Insights, quiz submitted, average score_pct, weekly, report filter
 *   plan_tier in (plus, teams), breakdown cohort "did ai tutor question asked"
 *   (yes / no): the lines match before launch and adopters pull ahead as they
 *   start. The exact before/after-first-question read needs the raw export.
 * REAL WORLD: an always-available tutor helps learners fix misconceptions
 *   before the quiz.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H2. PERSONALIZED COURSE PICKS EXPERIMENT (declarative funnel experiment)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-07-08 learners split 50/50 (the engine's sticky hash) and
 *   are exposed at their first in-test course page view, browse-only views
 *   included (the hook places the one $experiment_started 1 s before it and
 *   stamps the profile, so every in-test viewer is in a variant); "Personalized"
 *   multiplies the share of the funnel's course page views that end in an
 *   enrollment in that course by 1.25 and the view-to-enrollment time by 0.8.
 * MIXPANEL: Funnels, course page viewed → course enrolled, totals, hold course_id
 *   constant, 1-day window, breakdown user property "Experiment: Personalized
 *   Course Picks".
 * REAL WORLD: recommendations matched to a learner's goal turn browsing into
 *   enrollments.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H3. EMPLOYER-SPONSORED ONBOARDING (declarative duplicate first funnels)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: new employer-sponsored learners finish onboarding at 1.5x the self-pay
 *   rate (78% vs 52% at the engine) and in half the time (18 h vs 36 h).
 * MIXPANEL: Funnels, account created → learning goals set → course enrolled →
 *   lesson started, 7-day window, breakdown account_type; conversion and median
 *   time to convert.
 * REAL WORLD: the employer has already picked the course and expects progress.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H4. COHORT VS SELF-PACED COMPLETION (everything, course model)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 70% of cohort enrollments would finish vs 0.3x that (21%) for
 *   self-paced. Certificate timing is format-neutral (nominal length × pace with
 *   median 1), and lapsing hits both formats alike.
 * MIXPANEL: Funnels, course enrolled → certificate earned, totals, hold course_id
 *   constant, 90-day window, breakdown course_format, enrollments Jun 4-30.
 * REAL WORLD: deadlines, live sessions, and peers keep cohort learners going;
 *   MOOC-style self-paced completion is low.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H5. FIRST-WEEK LESSONS → RETENTION (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: new learners who complete fewer than 3 lessons in their first 7 days
 *   go dark (all later events removed) with probability 0.5 on a uniform day
 *   10-21; 3+ lessons → no cut. Organic lapse (55%, day 3-60) and setup
 *   abandonment act on everyone independently of the first week.
 * MIXPANEL: Funnels account created → lesson completed ×3 (7-day window); save
 *   completed and dropped learners as cohorts; Retention, account created → any
 *   event except the backend events certificate earned and subscription started
 *   (exclude them in the return-event filter), on or after day 30, filter "did
 *   lesson started".
 * REAL WORLD: learners who build a study habit in week one stay; a single
 *   lesson is not a habit.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H6. PLUS PRICE CHANGE (everything + warehouse subscription_billing_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: on 2026-08-10 Plus monthly rises from $29 to $35; annual stays $239.
 *   Before: 30% of new subscriptions are annual. After: annual-minded buyers stay
 *   annual, 30% of monthly-minded buyers switch to annual, 20% do not buy. New
 *   subscriptions fall to 0.86x of the would-be volume, annual share rises to
 *   0.593, and the first payment per new subscription (warehouse list price)
 *   rises 1.695x, so bookings per subscription-day rise about 1.46x by design.
 * MIXPANEL: Insights, subscription started, breakdown billing_interval, weekly,
 *   % of total; join subscription_billing_daily.list_price_usd for revenue.
 * REAL WORLD: a monthly price rise next to an unchanged annual price nudges
 *   buyers to annual and prices out some monthly buyers.
 * NOTE: about 4 new subscriptions a day, so the volume read is noise-limited.
 *   Without the price change this seed's would-be volume rises 5% (208 → 218
 *   in the 53-day windows; measured by re-running with MONTHLY_LOST and
 *   MONTHLY_SWITCH_ANNUAL at 0). The price reaction kept 193 of those 218
 *   would-be buyers (0.885 vs the 0.86 knob), so the plain before/after read
 *   is 0.93 (193 vs 208).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H7. PAID CHANNEL ECONOMICS (everything + warehouse paid_marketing_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: daily budgets are set for $38 paid search, $15 paid social, $26
 *   YouTube ads per expected signup. Share of would-be Plus purchases kept by
 *   channel: paid search 1.0, referral 0.9, organic 0.85, YouTube 0.75,
 *   university partnership 0.6, paid social 0.4. Paid social is 0.39x the cost
 *   per signup and 0.4x the purchase rate, so by design cost per paying
 *   subscriber is about the same as search. This run reads $44 / $17 / $27 per
 *   Mixpanel signup (fewer paid-search signups than budgeted), paid social at
 *   0.41x the search purchase rate, and spend per paying subscriber of $378
 *   search, $330 social, $364 YouTube (48 / 23 / 18 buyers).
 * MIXPANEL: Insights, account created by acquisition_channel joined to
 *   paid_marketing_daily.spend_usd; Funnels account created → subscription
 *   started, 30-day window, signups Jun 4 - Aug 31, breakdown acquisition_channel.
 * REAL WORLD: cheap social signups are curious browsers; search signups came
 *   looking for a course.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H8. ANDROID PLAYBACK INCIDENT (everything + warehouse app_stability_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-09-09 to 2026-09-12 (hotfix 2026-09-13), 55% of would-be
 *   completions of video lessons started on Android are lost. Web, iOS, and
 *   reading/lab lessons are unaffected. The warehouse shows
 *   playback_failure_rate ≈ 0.55 and app_version 6.4.0 for Android on those days.
 * MIXPANEL: Insights, lesson completed / lesson started (formula, totals),
 *   filter content_type = video, breakdown platform, daily; join the warehouse.
 *   A completion carries its start's device, so this reads the same as the
 *   per-lesson join (Android 38.7% vs 81.3% in the 7 days either side).
 * REAL WORLD: a video player regression in one app release.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H9. FALL TERM (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: before 2026-08-24 university students keep only 55% of their
 *   learning activity (whole lesson units); from the fall term they study at
 *   their full rate, so their lesson completions per day rise 1/0.55 = 1.82x
 *   relative to other segments.
 * MIXPANEL: Insights, lesson completed, breakdown learner_segment, weekly.
 * REAL WORLD: students take the summer off and return with the term.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H10. DOUBLE-SPEED WATCHERS SCORE LOWER (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: learners whose preferred playback speed is 2x (80% of their videos
 *   play at it) score 7 points lower on quizzes than 1x learners; 1.25x and 1.5x
 *   score like 1x.
 * MIXPANEL: Insights, quiz submitted, average score_pct, breakdown user
 *   property preferred_playback_speed.
 * REAL WORLD: skimming lectures at double speed costs retention of the material.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * EXPECTED METRICS SUMMARY (measured: data/verify-education, 2026-10-07)
 * ═════════════════════════════════════════════════════════════════════════
 * Hook | Metric                                         | Derivation                  | Expected | Measured
 * -----|------------------------------------------------|-----------------------------|----------|---------
 * H1   | tutor questions pre-launch or on Free          | exact purity                | 0        | 0
 * H1   | quiz score DiD, adopters vs eligible others    | AI_SCORE_BOOST              | 8.0      | 7.56 (70.2 → 77.9 vs 70.2 → 70.3)
 * H2   | per-view enrollment, Personalized / Control    | PICKS_CONV_MULT             | 1.25     | 1.226 (35.3% vs 28.8%)
 * H2   | median view → enrollment time                  | PICKS_TTC_MULT              | 0.80     | 0.803 (48.2 vs 60.1 min)
 * H2   | Personalized share of exposed learners         | equal 2-arm hash            | 0.50     | 0.502
 * H3   | onboarding conversion sponsored / self-pay     | 78 / 52                     | 1.50     | 1.592 (78.8% vs 49.5%)
 * H3   | median time to first lesson sponsored / self   | SPONSORED_TTC_MULT          | 0.50     | 0.496 (13.5 vs 27.3 h)
 * H4   | completion self-paced / cohort (Jun enrollments)| SELF_PACED_COMPLETE_MULT   | 0.30     | 0.286 (18.2% vs 63.5%)
 * H5   | retained day 30+, 3+ / <3 first-week lessons   | ≥ 1/(1 − 0.5) (floor)       | ≥ 2.00   | 1.956 (69.2% vs 35.4%)
 * H6   | annual share of new subscriptions after change | (0.3+0.7×0.3)/0.86          | 0.593    | 0.611 (before 0.303)
 * H6   | first payment per subscription after / before  | warehouse list price        | 1.695    | 1.726 ($159.73 vs $92.56)
 * H6   | subscriptions per day, 53 days after / before  | 0.3 + 0.7×0.8 (ceiling)     | ≤ 0.86   | 0.928 (3.64 vs 3.92)
 * H7   | spend per signup paid social / paid search     | 15 / 38                     | 0.395    | 0.383 ($16.85 vs $43.95)
 * H7   | 30-day paid rate paid social / paid search     | 0.4 / 1.0 (ceiling)         | ≤ 0.40   | 0.414 (4.96% vs 11.97%)
 * H8   | Android / other video completion, incident DiD | 1 − INCIDENT_FAIL           | 0.45     | 0.471 (38.1% vs 81.4% around)
 * H8   | warehouse playback_failure_rate in incident    | INCIDENT_FAIL               | 0.55     | 0.558
 * H9   | student / other completions per day, fall DiD  | 1 / STUDENT_SUMMER_KEEP     | 1.818    | 1.782 (students 1.887x, others 1.059x)
 * H10  | quiz score 1x − 2x                              | FAST_SCORE_PENALTY          | 7.0      | 6.96 (71.8 vs 64.8)
 * H10  | quiz score 1.5x / 1x (control)                  | unchanged                   | 1.00     | 0.999
 * ═════════════════════════════════════════════════════════════════════════
 *
 * H5's read is a knob floor: lighter learners are also likelier to show no
 * activity after day 30 even without the cut. H6's volume read is
 * noise-limited (Poisson, about 200 subscriptions per side) and carries a
 * knob-derived ceiling with a floor at half the knob's effect: the
 * no-price-change volume in this seed rises 5% by chance (see H6 NOTE), so the
 * price reaction (193 of 218 would-be buyers kept, 0.885 vs the 0.86 knob)
 * reads 0.93 before/after. H7's purchase-rate read rests on 48 paid-search and
 * 23 paid-social buyers.
 */

// ── SCALE ──
const SEED = "harness-education";
const NUM_USERS = 10_000;
const DATASET_START = "2026-06-04T00:00:00Z";
const DATASET_END = "2026-10-01T23:59:59Z"; // 120 days
const EVENTS_PER_DAY = 1.2;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── TIMELINE (shared by hooks, stories, SQL, warehouse columns, guides) ──
const COURSE_PICKS_START = "2026-07-08T00:00:00Z";  // "Personalized Course Picks" A/B on the course page
const AI_TUTOR_LAUNCH = "2026-07-21T00:00:00Z";     // Ask Bright (AI tutor) for Plus and Teams learners
const PLUS_PRICE_CHANGE = "2026-08-10T00:00:00Z";   // Plus monthly $29 → $35; annual unchanged
const FALL_TERM_START = "2026-08-24T00:00:00Z";     // fall term starts at partner universities
const ANDROID_RELEASE = "2026-09-09T00:00:00Z";     // Android app 6.4.0 released
const ANDROID_HOTFIX = "2026-09-13T00:00:00Z";      // Android app 6.4.1 hotfix (incident end, exclusive)
const IOS_RELEASE = "2026-08-18T00:00:00Z";         // iOS app 6.4.0 released (no incident)

const ms = (iso) => dayjs.utc(iso).valueOf();
const DAY_MS = 86_400_000;
const MIN_MS = 60_000;
const START_MS = ms(DATASET_START);
const END_MS = ms(DATASET_END);

// ── WEEKLY AND DAILY RHYTHM (soup) ──
// Sun..Sat. Learners study around work and school: Sunday is the biggest
// study day (weekly deadlines close Sunday night), Friday and Saturday dip.
const DOW_WEIGHTS = [1.08, 1.0, 1.0, 0.96, 0.9, 0.7, 0.76];
// UTC hours: Americas evenings (00-04 UTC), India evenings (13-17 UTC), and
// European evenings (17-22 UTC); the quietest hours are 04-08 UTC.
const HOUR_WEIGHTS = [0.85, 0.8, 0.66, 0.48, 0.32, 0.26, 0.28, 0.36, 0.46, 0.52, 0.56, 0.6,
	0.64, 0.72, 0.8, 0.82, 0.85, 0.9, 0.95, 1.0, 1.0, 0.98, 0.95, 0.9];

// ── KNOBS ──
// H1 Ask Bright AI tutor (Plus and Teams learners, plan at event time)
const AI_PLANS = ["plus", "teams"];
const AI_ADOPTER_SHARE = 0.45;     // share of eligible learners who adopt the tutor (salted per learner)
const AI_RAMP_DAYS = 21;           // each adopter starts on a salted day in the 3 weeks after launch
const AI_USE_MIN = 0.35;           // per adopter: share of their would-be tutor questions kept (uniform 0.35-0.85)
const AI_USE_MAX = 0.85;
const AI_SCORE_BOOST = 8;          // quiz score points after the learner's first tutor question
const AI_FOLLOWUP_P = 0.55;        // chance a tutor question gets a follow-up (up to 3)
const AI_FOLLOWUP_MAX = 3;
const TUTOR_QUESTION_TYPES = ["explain_concept", "explain_concept", "check_my_answer", "hint", "hint", "summarize_lesson"];

// H2 Personalized Course Picks experiment (course page → enrollment)
const PICKS_EXPERIMENT = "Personalized Course Picks";
const PICKS_VARIANT = "Personalized";
const EXP_KEY = `Experiment: ${PICKS_EXPERIMENT}`;
const PICKS_VARIANTS = ["Control", PICKS_VARIANT]; // equal weights, same order as the funnel experiment
const ENROLL_CONV = 30;
const ENROLL_TTC_H = 2;
const PICKS_CONV_MULT = 1.25;
const PICKS_TTC_MULT = 0.8;

// H3 onboarding by account type (declarative duplicate first funnels)
const ONBOARD_CONV = 52;           // self-pay learners
const SPONSORED_ONBOARD_MULT = 1.5; // employer-sponsored learners: 78%
const ONBOARD_TTC_H = 36;
const SPONSORED_TTC_MULT = 0.5;    // sponsored learners finish setup in half the time

// H4 course completion by format (per enrollment)
const COHORT_COMPLETE = 0.7;       // share of cohort-course enrollments that would finish
const SELF_PACED_COMPLETE_MULT = 0.3; // self-paced: 0.21
const ABANDON_FRAC_MIN = 0.15;     // a non-finisher stops after 15-110% of the nominal length
const ABANDON_FRAC_MAX = 1.1;

// H5 first-week study streak → retention (new learners only)
const STREAK_DAYS = 7;
const STREAK_MIN = 3;              // completed lessons in the first 7 days that mark an activated learner
const DARK_SHARE = 0.5;            // share who go dark with fewer than 3 lessons completed in the first week; 3+ → none
const DARK_AFTER_MIN = 10;         // at-risk learners go dark on a uniform day 10-21
const DARK_AFTER_MAX = 21;
const SETUP_ABANDON_SHARE = 0.6;   // new learners who never start a lesson: share who stop on day 1-5
const SETUP_ABANDON_DAY_MIN = 1;
const SETUP_ABANDON_DAY_MAX = 5;
const LAPSE_SHARE = 0.55;          // organic lapse, every new learner, independent of the streak
const LAPSE_DAY_MIN = 3;
const LAPSE_DAY_MAX = 60;
const NEW_NOT_ACTIVATED_SHARE = 0.79; // new learners with fewer than 3 first-week lessons (this run's rate)
const NEW_NEVER_STARTED_SHARE = 0.44; // new learners who never start a lesson (this run's rate)

// H6 Plus price change (warehouse subscription_billing_daily)
const PLUS_MONTHLY_OLD = 29;
const PLUS_MONTHLY_NEW = 35;
const PLUS_ANNUAL = 239;
const ANNUAL_SHARE_PRE = 0.3;      // share of new Plus subscriptions on annual billing before the change
const MONTHLY_SWITCH_ANNUAL = 0.3; // after the change: share of monthly-minded buyers who choose annual instead
const MONTHLY_LOST = 0.2;          // after the change: share of monthly-minded buyers who do not buy
const POST_VOLUME = ANNUAL_SHARE_PRE + (1 - ANNUAL_SHARE_PRE) * (1 - MONTHLY_LOST); // 0.86 of the would-be subscriptions
const ANNUAL_SHARE_POST = (ANNUAL_SHARE_PRE + (1 - ANNUAL_SHARE_PRE) * MONTHLY_SWITCH_ANNUAL) / POST_VOLUME; // 0.593
// billing drift vs the product event
const BILLING_STORE_SHARE = 0.2;   // interval-days with one app-store purchase Mixpanel never received
const BILLING_FAIL_SHARE = 0.05;   // share of tracked checkouts whose first payment fails (not booked)

// H7 paid acquisition economics (warehouse paid_marketing_daily)
const PAID_CHANNELS = ["paid_search", "paid_social", "youtube_ads"];
const CPL_USD = { paid_search: 38, paid_social: 15, youtube_ads: 26 }; // window cost per Mixpanel signup
const CHANNEL_WEIGHTS = { organic_search: 26, paid_search: 17, paid_social: 18, youtube_ads: 9, referral: 12 };
const PURCHASE_KEEP = { paid_search: 1.0, referral: 0.9, organic_search: 0.85, youtube_ads: 0.75, university_partnership: 0.6, paid_social: 0.4 };
const P_BUY_NEW = 0.18;            // new self-pay learners: share who would buy Plus (before the channel keep)
const P_BUY_EST = 0.08;            // long-time free learners: share who buy during the window
const BUY_LAG_MEDIAN_DAYS = 6;     // signup → purchase lag (lognormal)
const RECENT_JOIN_DAYS = 60;       // pre-window learners who joined in the 60 days before June 4 still convert like new ones
const PAID_FUNNEL_WINDOW_DAYS = 30;
const PAID_COHORT_END = "2026-09-01T00:00:00Z"; // exclusive: signups with a full 30 days
const BORN_PCT = 40;
const WINDOW_DAYS = 120;
const SPEND_SIGNUP_SHARE = 0.78;   // expected share of new learners on a paid-channel-eligible path (self-pay, not university)
const DAILY_BUDGET_USD = Object.fromEntries(PAID_CHANNELS.map((ch) => {
	const totalW = Object.values(CHANNEL_WEIGHTS).reduce((a, b) => a + b, 0);
	return [ch, CPL_USD[ch] * (NUM_USERS * BORN_PCT / 100) * SPEND_SIGNUP_SHARE * (CHANNEL_WEIGHTS[ch] / totalW) / WINDOW_DAYS];
}));
const SPEND_FLAT_SHARE = 0.35;
const SPEND_WEEKDAY = (() => {
	const m = DOW_WEIGHTS.reduce((a, b) => a + b, 0) / DOW_WEIGHTS.length;
	return DOW_WEIGHTS.map((w) => SPEND_FLAT_SHARE + (1 - SPEND_FLAT_SHARE) * w / m);
})();
const SPEND_NOISE = 0.12;
const PLATFORM_SIGNUP_INFLATION = 1.2; // ad platforms claim ~20% more signups than Mixpanel records
const CPC_USD = { paid_search: 2.4, paid_social: 0.9, youtube_ads: 1.6 };
const CTR = { paid_search: 0.04, paid_social: 0.009, youtube_ads: 0.006 };

// H8 Android video playback incident (warehouse app_stability_daily)
const INCIDENT_PLATFORM = "android";
const INCIDENT_FAIL = 0.55;        // share of would-be completions of Android video lessons lost
const PREVIEW_PLAYS_PER_DAY = { web: 260, ios: 120, android: 90 }; // course trailers/previews: no lesson event

// H9 fall term (university students)
const STUDENT_SUMMER_KEEP = 0.55;  // share of students' learning units kept before the fall term

// H10 2x playback and quiz scores
const SPEED_TIERS = { 1: 50, 1.25: 22, 1.5: 14, 2: 14 }; // preferred playback speed share
const SPEED_STICK = 0.8;           // share of a learner's videos at their preferred speed
const FAST_SPEED = 2;
const FAST_SCORE_PENALTY = 7;      // quiz points lost by 2x watchers
const SCORE_MEAN = 71;
const SCORE_SD = 12;
const PASS_MARK = 70;

// ── COURSE CATALOG (seeded; denormalized onto events, no lookup table) ──
const CATEGORIES = {
	data_science: ["Python for Data Analysis", "SQL Foundations", "Machine Learning", "Statistics with R", "Data Visualization", "Deep Learning", "Applied AI Agents", "Excel to Pandas"],
	software_dev: ["JavaScript Essentials", "React Development", "Cloud Fundamentals", "APIs with Node.js", "Git and DevOps", "Mobile Apps with Flutter", "System Design", "Cybersecurity Basics"],
	business: ["Project Management", "Product Management", "Financial Modeling", "Business Analytics", "Negotiation", "Leadership Essentials", "Agile and Scrum", "Accounting Basics"],
	design: ["UX Research", "UI Design", "Figma Masterclass", "Design Systems", "Motion Design", "Accessibility by Design"],
	marketing: ["Digital Marketing", "SEO Foundations", "Content Strategy", "Growth Marketing", "Marketing Analytics", "Brand Storytelling"],
	languages: ["Business English", "Spanish for Work", "Conversational French", "German A1", "Japanese Basics", "Mandarin for Beginners"],
};
const LEVELS = ["beginner", "beginner", "intermediate", "intermediate", "advanced"];
const COURSES = [];
for (const [cat, topics] of Object.entries(CATEGORIES)) {
	for (const topic of topics) {
		for (const variant of ["", " II"]) {
			if (variant && chance.bool({ likelihood: 40 })) continue;
			const format = chance.bool({ likelihood: 26 }) ? "cohort" : "self_paced";
			COURSES.push({
				id: `crs_${chance.hash({ length: 8 })}`,
				title: `${topic}${variant}`,
				category: cat,
				format,
				level: variant ? "intermediate" : chance.pickone(LEVELS),
				weeks: chance.integer({ min: 4, max: 8 }),
			});
		}
	}
}
const COURSE_BY_ID = new Map(COURSES.map((c) => [c.id, c]));
const COURSE_IDS = COURSES.map((c) => c.id);
const LESSONS_PER_WEEK = 4;

// ── HELPERS ──
const salt = (uid, tag) => hashFloat(`${uid}|${tag}`);
const T = (e) => dayjs.utc(e.time).valueOf();
const iso = (t) => new Date(t).toISOString();
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const round2 = (n) => Math.round(n * 100) / 100;
const jitter = (key, spread) => 1 + (hashFloat(key) - 0.5) * 2 * spread;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
// deterministic lognormal from two salted uniforms (Box-Muller)
const lognormal = (median, sigma, r1, r2) => median * Math.exp(sigma * Math.sqrt(-2 * Math.log(Math.max(1e-9, r1))) * Math.cos(2 * Math.PI * r2));
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
const platformOf = (os) => {
	if (!os) return null;
	if (/android/i.test(os)) return "android";
	if (/ios|ipad/i.test(os)) return "ios";
	return "web";
};
const inIncident = (t) => t >= ms(ANDROID_RELEASE) && t < ms(ANDROID_HOTFIX);
const plusMonthlyPrice = (t) => (t >= ms(PLUS_PRICE_CHANGE) ? PLUS_MONTHLY_NEW : PLUS_MONTHLY_OLD);
const paidSpend = (date, ch) => round2(DAILY_BUDGET_USD[ch] * SPEND_WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()] * jitter(`spend|${date}|${ch}`, SPEND_NOISE));

// Learning events tied to a course (course_id assigned by the course model)
const LEARNING_EVENTS = new Set(["lesson started", "lesson completed", "quiz submitted", "assignment submitted", "discussion posted", "live session attended", "ai tutor question asked"]);
// Events the backend sends (no device): certificates and billing
const SERVER_EVENTS = new Set(["certificate earned", "subscription started"]);
const DEVICE_FIELDS = ["device_id", "os", "model", "screen_height", "screen_width", "carrier", "radio", "platform", "session_id"];
const ONBOARDING_SET = new Set(["learning goals set", "course enrolled", "lesson started"]);
const FIRST_LESSON_COMPLETE = 0.75; // share of new learners who finish their first lesson
const ACTIVE_LOOKBACK_DAYS = 14;   // a learner with an event in the last 14 days is still active (certificates, purchases)
const PAYWALL_TRIGGERS = ["enrollment_limit", "certificate_upsell", "ai_tutor", "offline_downloads"];

// ── EVENTS ──
const EVENTS = [
	{
		event: "account created",
		weight: 1,
		isFirstEvent: true,
		isAuthEvent: true,
		properties: {
			signup_method: { __weights: { google: 42, email: 30, apple: 16, sso: 12 } },
			acquisition_channel: (ctx) => ctx.profile.acquisition_channel,
			account_type: (ctx) => ctx.profile.account_type,
		},
	},
	{
		event: "learning goals set",
		weight: 1,
		isStrictEvent: true,
		properties: {
			primary_goal: (ctx) => ctx.profile.primary_goal,
			weekly_hours_target: [2, 3, 3, 5, 5, 8, 10],
		},
	},
	{
		event: "course page viewed",
		weight: 3,
		isStrictEvent: false,
		properties: {
			course_id: COURSE_IDS,
			course_title: ["unassigned"],
			course_category: ["unassigned"],
			course_format: ["self_paced"],
			course_level: ["beginner"],
			course_length_weeks: [4],
		},
	},
	{
		event: "course enrolled",
		weight: 1,
		isStrictEvent: true,
		properties: {
			course_id: COURSE_IDS,
			course_title: ["unassigned"],
			course_category: ["unassigned"],
			course_format: ["self_paced"],
			course_level: ["beginner"],
			course_length_weeks: [4],
			enrollment_source: ["catalog_browse", "search", "search", "recommendation", "learning_path"],
		},
	},
	{
		event: "lesson started",
		weight: 1,
		isStrictEvent: true,
		properties: {
			course_id: ["unassigned"],
			course_category: ["unassigned"],
			lesson_id: ["unassigned"],
			lesson_number: [1],
			content_type: ["video"],
		},
	},
	{
		event: "lesson completed",
		weight: 1,
		isStrictEvent: true,
		properties: {
			course_id: ["unassigned"],
			course_category: ["unassigned"],
			lesson_id: ["unassigned"],
			lesson_number: [1],
			content_type: ["video"],
			minutes_spent: [10],
			playback_speed: [1],
		},
	},
	{
		event: "quiz submitted",
		weight: 3,
		isStrictEvent: false,
		properties: {
			course_id: ["unassigned"],
			course_category: ["unassigned"],
			quiz_number: [1],
			score_pct: [70],
			passed: [true],
			attempt_number: { __weights: { 1: 78, 2: 17, 3: 5 } },
		},
	},
	{
		event: "assignment submitted",
		weight: 1,
		isStrictEvent: false,
		properties: {
			course_id: ["unassigned"],
			course_category: ["unassigned"],
			assignment_type: ["project", "peer_review", "coding_exercise", "written_response"],
			is_late: [false],
		},
	},
	{
		event: "discussion posted",
		weight: 2,
		isStrictEvent: false,
		properties: {
			course_id: ["unassigned"],
			course_category: ["unassigned"],
			post_type: ["question", "question", "answer", "comment", "comment"],
			word_count: u.weighNumRange(8, 400, 0.4, 40),
		},
	},
	{
		event: "live session attended",
		weight: 2,
		isStrictEvent: false,
		properties: {
			course_id: ["unassigned"],
			course_category: ["unassigned"],
			minutes_attended: u.weighNumRange(15, 90, 0.8, 30),
		},
	},
	{
		event: "ai tutor question asked",
		weight: 6,
		isStrictEvent: false,
		properties: {
			course_id: ["unassigned"],
			course_category: ["unassigned"],
			question_type: { __weights: { explain_concept: 38, check_my_answer: 26, hint: 22, summarize_lesson: 14 } },
		},
	},
	{
		event: "certificate earned",
		weight: 1,
		isStrictEvent: true,
		properties: {
			course_id: ["unassigned"],
			course_title: ["unassigned"],
			course_category: ["unassigned"],
			course_format: ["self_paced"],
			course_level: ["beginner"],
			course_length_weeks: [4],
			final_grade: [80],
			days_to_complete: [30],
		},
	},
	{
		event: "home viewed",
		weight: 8,
		isStrictEvent: false,
		properties: {
			entry_point: ["direct", "direct", "push_notification", "email_reminder", "bookmark"],
		},
	},
	{
		event: "course search",
		weight: 3,
		isStrictEvent: false,
		properties: {
			query_topic: Object.keys(CATEGORIES),
			results_count: u.weighNumRange(0, 60, 0.5, 30),
		},
	},
	{
		event: "paywall viewed",
		weight: 1,
		isStrictEvent: false,
		properties: {
			paywall_trigger: PAYWALL_TRIGGERS,
		},
	},
	{
		event: "subscription started",
		weight: 1,
		isStrictEvent: true,
		properties: {
			plan: ["plus"],
			billing_interval: ["monthly"],
		},
	},
	{
		event: "$experiment_started",
		weight: 1,
		isStrictEvent: true,
		properties: {
			"Experiment name": [PICKS_EXPERIMENT],
			"Variant name": ["Control", PICKS_VARIANT],
		},
	},
];
const DECLARED = Object.fromEntries(EVENTS.map((e) => [e.event, new Set(Object.keys(e.properties || {}))]));
const EVENT_PROP_KEYS = new Set(EVENTS.flatMap((e) => Object.keys(e.properties || {})));

/** Clone `template` as another declared event: drop every event-level prop the target does not declare, keep identity and context. */
function makeFrom(template, eventName, overrides) {
	const target = DECLARED[eventName];
	const c = cloneEvent(template, { event: eventName, ...overrides });
	for (const k of Object.keys(c)) if (EVENT_PROP_KEYS.has(k) && !target.has(k) && !(k in overrides)) delete c[k];
	return c;
}

const stampCourse = (e, course, withCatalog) => {
	e.course_id = course.id;
	e.course_category = course.category;
	if (withCatalog) {
		e.course_title = course.title;
		e.course_format = course.format;
		e.course_level = course.level;
		e.course_length_weeks = course.weeks;
	}
};

// ── USER HOOK ──
const SPONSOR_SHARE = { upskiller: 0.45, career_switcher: 0.1, university_student: 0, lifelong_learner: 0.05 };
const GOAL_BY_SEGMENT = { career_switcher: "change_careers", upskiller: "advance_in_role", university_student: "earn_course_credit", lifelong_learner: "personal_interest" };

function handleUserHook(profile, meta) {
	const uid = profile.distinct_id;
	const seg = profile.learner_segment;
	const sponsored = salt(uid, "sponsored") < (SPONSOR_SHARE[seg] ?? 0);
	profile.account_type = sponsored ? "employer_sponsored" : "individual";
	profile.primary_goal = GOAL_BY_SEGMENT[seg] ?? "personal_interest";
	if (sponsored) profile.acquisition_channel = "employer";
	else if (seg === "university_student" && salt(uid, "uni") < 0.45) profile.acquisition_channel = "university_partnership";
	else profile.acquisition_channel = pickWeighted(CHANNEL_WEIGHTS, salt(uid, "channel"));
	profile.preferred_playback_speed = Number(pickWeighted(SPEED_TIERS, salt(uid, "speed")));
	if (meta.userIsBornInDataset) {
		profile.customer_since = dayKey(ms(profile.created ?? meta.user.created));
		profile.plan_tier = sponsored ? "teams" : "free";
		return profile;
	}
	// pre-window learners: a third joined in the 60 days before June 4, the rest from 2024-01
	const recent = salt(uid, "recent") < 1 / 3;
	const lo = recent ? 0 : RECENT_JOIN_DAYS;
	const hi = recent ? RECENT_JOIN_DAYS : (START_MS - ms("2024-01-01T00:00:00Z")) / DAY_MS;
	const ageDays = lo + Math.floor(salt(uid, "tenure") * (hi - lo)) + 1;
	profile.customer_since = dayKey(START_MS - ageDays * DAY_MS);
	if (sponsored) profile.plan_tier = "teams";
	else if (recent) profile.plan_tier = "free"; // their purchase pipeline runs in the everything hook
	else profile.plan_tier = salt(uid, "plan") < 0.36 ? "plus" : "free";
	return profile;
}

/**
 * A recent pre-window joiner's lapse time, drawn the way a new learner's cuts are (H5) from the
 * salted join time. Their first week is before the window, so the go-dark and setup-abandon cuts use
 * the share of new learners who finish fewer than 3 first-week lessons / never start a lesson.
 */
function recentJoinerCut(uid, joinMs) {
	const cuts = [];
	if (salt(uid, "dark") < DARK_SHARE * NEW_NOT_ACTIVATED_SHARE) cuts.push(joinMs + (DARK_AFTER_MIN + salt(uid, "dark-day") * (DARK_AFTER_MAX - DARK_AFTER_MIN)) * DAY_MS);
	if (salt(uid, "lapse") < LAPSE_SHARE) cuts.push(joinMs + (LAPSE_DAY_MIN + salt(uid, "lapse-day") * (LAPSE_DAY_MAX - LAPSE_DAY_MIN)) * DAY_MS);
	if (salt(uid, "abandon") < SETUP_ABANDON_SHARE * NEW_NEVER_STARTED_SHARE) cuts.push(joinMs + (SETUP_ABANDON_DAY_MIN + salt(uid, "abandon-day") * (SETUP_ABANDON_DAY_MAX - SETUP_ABANDON_DAY_MIN)) * DAY_MS);
	return cuts.length ? Math.min(...cuts) : Infinity;
}

// ── EVERYTHING HOOK ──
function handleEverything(events, meta) {
	if (!events.length) return events;
	events.sort((a, b) => T(a) - T(b));
	const profile = meta.profile;
	const uid = profile.distinct_id;
	const signup = events.find((e) => e.event === "account created");
	const birthMs = signup ? T(signup) : null;
	const sponsored = profile.account_type === "employer_sponsored";

	// ── onboarding happens in the signup session: the steps after signup share its device ──
	if (signup) {
		const onboardEnd = birthMs + ONBOARD_TTC_H * 3600_000 * 2;
		for (const e of events) {
			if (e === signup || e.device_id || T(e) > onboardEnd || !ONBOARDING_SET.has(e.event)) continue;
			for (const k of DEVICE_FIELDS) if (signup[k] !== undefined) e[k] = signup[k];
		}
	}

	// ── platform from the device OS; device-less events carry no platform ──
	for (const e of events) {
		const p = platformOf(e.os);
		if (p) e.platform = p;
		else delete e.platform;
	}

	// ── the first lesson of onboarding: most new learners finish it in the same sitting ──
	if (signup) {
		const done = new Set(events.filter((e) => e.event === "lesson completed").map((e) => e.lesson_id));
		const first = events.find((e) => e.event === "lesson started" && !done.has(e.lesson_id));
		if (first && T(first) < birthMs + ONBOARD_TTC_H * 3600_000 * 2 && salt(uid, "first-lesson") < FIRST_LESSON_COMPLETE) {
			const tc = T(first) + (4 + salt(uid, "first-lesson-gap") * 21) * MIN_MS;
			if (tc <= END_MS) {
				events.push(makeFrom(first, "lesson completed", { time: iso(tc), minutes_spent: 10, playback_speed: 1 }));
				events.sort((a, b) => T(a) - T(b));
			}
		}
	}

	// ── a lesson is finished on the device it was started on: the completion carries its start's device ──
	{
		const startOf = new Map();
		for (const e of events) if (e.event === "lesson started" && e.device_id) startOf.set(e.lesson_id, e);
		for (const e of events) {
			if (e.event !== "lesson completed") continue;
			const s = startOf.get(e.lesson_id);
			if (!s) continue;
			for (const k of DEVICE_FIELDS) {
				if (s[k] !== undefined) e[k] = s[k];
				else delete e[k];
			}
		}
	}

	const unitOf = (e) => (e.event === "lesson started" || e.event === "lesson completed") ? e.lesson_id : null;

	// ── H9: university students study less before the fall term (whole lesson units) ──
	if (profile.learner_segment === "university_student") {
		const fall = ms(FALL_TERM_START);
		const dropUnits = new Set();
		for (const e of events) {
			if (e.event === "lesson started" && T(e) < fall && hashFloat(`${uid}|summer|${e.lesson_id}`) >= STUDENT_SUMMER_KEEP) dropUnits.add(e.lesson_id);
		}
		events = events.filter((e) => {
			if (!LEARNING_EVENTS.has(e.event)) return true;
			const unit = unitOf(e);
			if (unit) return !dropUnits.has(unit);
			if (T(e) >= fall) return true;
			return hashFloat(`${uid}|summer|${e.insert_id}`) < STUDENT_SUMMER_KEEP;
		});
	}

	// ── H8: Android video playback incident — would-be completions of video lessons started on Android are lost ──
	{
		const starts = new Map();
		for (const e of events) if (e.event === "lesson started") starts.set(e.lesson_id, e);
		events = events.filter((e) => {
			if (e.event !== "lesson completed" || e.content_type !== "video") return true;
			const s = starts.get(e.lesson_id);
			if (!s || s.platform !== INCIDENT_PLATFORM || !inIncident(T(s))) return true;
			return hashFloat(`${uid}|incident|${e.lesson_id}`) >= INCIDENT_FAIL;
		});
	}

	// ── H5: first-week study streak, setup abandonment (new learners only) ──
	let cut = Infinity; // the learner's lapse / dark / abandonment time; nothing learner-initiated after it
	if (signup) {
		const wkEnd = birthMs + STREAK_DAYS * DAY_MS;
		const firstWeek = events.filter((e) => e.event === "lesson completed" && T(e) >= birthMs && T(e) < wkEnd).length;
		const started = events.some((e) => e.event === "lesson started");
		const cuts = [];
		const dark = firstWeek >= STREAK_MIN ? 0 : DARK_SHARE;
		if (salt(uid, "dark") < dark) cuts.push(birthMs + (DARK_AFTER_MIN + salt(uid, "dark-day") * (DARK_AFTER_MAX - DARK_AFTER_MIN)) * DAY_MS);
		if (salt(uid, "lapse") < LAPSE_SHARE) cuts.push(birthMs + (LAPSE_DAY_MIN + salt(uid, "lapse-day") * (LAPSE_DAY_MAX - LAPSE_DAY_MIN)) * DAY_MS);
		if (!started && salt(uid, "abandon") < SETUP_ABANDON_SHARE) cuts.push(birthMs + (SETUP_ABANDON_DAY_MIN + salt(uid, "abandon-day") * (SETUP_ABANDON_DAY_MAX - SETUP_ABANDON_DAY_MIN)) * DAY_MS);
		if (cuts.length) {
			cut = Math.min(...cuts);
			events = events.filter((e) => T(e) < cut);
		}
	}
	if (!events.length) return events;
	const lastActive = events.reduce((m, e) => Math.max(m, T(e)), 0);
	// still a learner at time t: before any lapse cut and seen in the ACTIVE_LOOKBACK days up to t.
	// The look is backward only, so the window end does not hide learners whose next visit falls after Oct 1;
	// near June 4 (history before the window is not in the data) it looks at the window's first days instead.
	const eventTimes = events.map(T);
	const activeAt = (t) => {
		if (t >= cut) return false;
		const lo = Math.max(START_MS, t - ACTIVE_LOOKBACK_DAYS * DAY_MS);
		const hi = Math.max(t, START_MS + ACTIVE_LOOKBACK_DAYS * DAY_MS);
		return eventTimes.some((x) => x >= lo && x <= hi);
	};

	// ── course model: enrollments, course assignment, completion (H4) ──
	const enrollments = [];
	const usedCourses = new Set();
	// a learner never enrolls in the same course twice: a repeat pick moves to the next unused course
	const freshCourse = (id, key) => {
		let i = COURSE_IDS.indexOf(id);
		if (i < 0) i = Math.floor(hashFloat(`${uid}|course|${key}`) * COURSES.length);
		while (usedCourses.has(COURSES[i].id) && usedCourses.size < COURSES.length) i = (i + 1 + Math.floor(hashFloat(`${uid}|skip|${key}|${i}`) * 7)) % COURSES.length;
		usedCourses.add(COURSES[i].id);
		return COURSES[i];
	};
	const lastPageView = new Map(); // course_id → latest page view (the enrollment funnel's step 1)
	for (const e of events) {
		if (e.event === "course page viewed") {
			stampCourse(e, COURSE_BY_ID.get(e.course_id) || COURSES[0], true);
			lastPageView.set(e.course_id, e);
			continue;
		}
		if (e.event !== "course enrolled") continue;
		const pv = lastPageView.get(e.course_id);
		const course = freshCourse(e.course_id, e.insert_id);
		if (course.id !== e.course_id && pv && T(e) - T(pv) <= ENROLL_TTC_H * 3600_000) stampCourse(pv, course, true);
		stampCourse(e, course, true);
		enrollments.push({ course, t0: T(e), key: e.insert_id, template: e });
	}
	// established learners carry courses they started before June 4 (same pace as their in-window enrollments)
	if (!signup) {
		const nCarry = Math.floor(enrollments.length * 0.75 + salt(uid, "carry-n"));
		for (let i = 0; i < nCarry; i++) {
			const course = freshCourse(COURSE_IDS[Math.floor(salt(uid, `carry-c${i}`) * COURSES.length)], `carry${i}`);
			const t0 = START_MS - (1 + salt(uid, `carry-t${i}`) * 89) * DAY_MS;
			enrollments.push({ course, t0, key: `carry${i}`, template: null });
		}
	}
	for (const en of enrollments) {
		const lenMs = en.course.weeks * 7 * DAY_MS;
		const p = COHORT_COMPLETE * (en.course.format === "self_paced" ? SELF_PACED_COMPLETE_MULT : 1);
		en.completes = salt(uid, `complete|${en.key}`) < p;
		if (en.completes) {
			const pace = en.course.format === "cohort"
				? 1 + salt(uid, `pace|${en.key}`) * 0.04
				: clamp(lognormal(1, 0.18, salt(uid, `pace1|${en.key}`), salt(uid, `pace2|${en.key}`)), 0.6, 1.6);
			en.tStop = en.t0 + lenMs * pace;
		} else {
			en.tStop = en.t0 + lenMs * (ABANDON_FRAC_MIN + salt(uid, `stop|${en.key}`) * (ABANDON_FRAC_MAX - ABANDON_FRAC_MIN));
		}
	}
	enrollments.sort((a, b) => a.t0 - b.t0);
	const activeEnrollments = (t, cohortOnly) => enrollments.filter((en) => en.t0 <= t && t <= en.tStop && (!cohortOnly || en.course.format === "cohort"));
	const dropLearning = new Set();
	const lessonEnrollment = new Map(); // lesson_id → enrollment: a start and its completion share a course
	for (const e of events) {
		if (!LEARNING_EVENTS.has(e.event)) continue;
		const t = T(e);
		let en = e.lesson_id ? lessonEnrollment.get(e.lesson_id) : undefined;
		if (!en) {
			const cands = activeEnrollments(t, e.event === "live session attended");
			if (cands.length) en = cands[Math.floor(hashFloat(`${uid}|pick|${e.insert_id}`) * cands.length)];
			else if (e.event !== "live session attended") {
				const before = enrollments.filter((x) => x.t0 <= t);
				en = before.length ? before[before.length - 1] : enrollments[0];
			}
		}
		if (!en) { dropLearning.add(e); continue; }
		if (e.lesson_id) lessonEnrollment.set(e.lesson_id, en);
		stampCourse(e, en.course, false);
		const frac = clamp((t - en.t0) / Math.max(DAY_MS, en.tStop - en.t0), 0, 1);
		const nLessons = en.course.weeks * LESSONS_PER_WEEK;
		if (e.event === "lesson started") e.lesson_number = clamp(1 + Math.floor(frac * nLessons), 1, nLessons);
		if (e.event === "quiz submitted") e.quiz_number = clamp(1 + Math.floor(frac * en.course.weeks), 1, en.course.weeks);
		if (e.event === "assignment submitted") e.is_late = en.course.format === "cohort" ? hashFloat(`${uid}|late|${e.insert_id}`) < 0.18 : false;
	}
	if (dropLearning.size) events = events.filter((e) => !dropLearning.has(e));
	{
		// a completion carries its start's lesson number
		const startNum = new Map();
		for (const e of events) if (e.event === "lesson started") startNum.set(e.lesson_id, e.lesson_number);
		for (const e of events) if (e.event === "lesson completed" && startNum.has(e.lesson_id)) e.lesson_number = startNum.get(e.lesson_id);
	}

	// certificates: a finishing enrollment issues one when its course ends, if the learner is still active then
	const fallbackTemplate = events.find((e) => e.event === "course enrolled") || events[0];
	const extra = [];
	for (const en of enrollments) {
		if (!en.completes) continue;
		const tc = en.tStop;
		if (tc < START_MS || tc > END_MS || !activeAt(tc)) continue;
		const c = makeFrom(en.template || fallbackTemplate, "certificate earned", {
			time: iso(tc),
			final_grade: Math.round(clamp(78 + (salt(uid, `grade|${en.key}`) - 0.5) * 36, 62, 100)),
			days_to_complete: Math.max(1, Math.round((tc - en.t0) / DAY_MS)),
		});
		stampCourse(c, en.course, true);
		extra.push(c);
	}

	// ── purchases (H6 interval mix, H7 channel quality): at most one Plus subscription per self-pay learner ──
	events = events.filter((e) => e.event !== "subscription started");
	let initialPlan = profile.plan_tier;
	let buyMs = Infinity;
	if (!sponsored && initialPlan === "free") {
		const keep = PURCHASE_KEEP[profile.acquisition_channel] ?? 0.8;
		const joinMs = signup ? birthMs : ms(`${profile.customer_since}T00:00:00Z`) + salt(uid, "join-hour") * DAY_MS;
		const recent = !signup && START_MS - joinMs <= RECENT_JOIN_DAYS * DAY_MS;
		if (signup || recent) {
			// recent pre-window joiners convert like new learners: same lag, same activity gate, and the same
			// survival (lapse, go-dark, setup-abandon cuts drawn from their join time), so June starts with
			// purchases in flight at the steady-state rate, not above it
			const survives = (t) => (signup ? true : t < recentJoinerCut(uid, joinMs));
			if (salt(uid, "buy") < P_BUY_NEW * keep) {
				const lag = clamp(lognormal(BUY_LAG_MEDIAN_DAYS, 0.9, salt(uid, "lag1"), salt(uid, "lag2")), 0.05, 75) * DAY_MS;
				const t = joinMs + lag;
				if (survives(t)) {
					if (t < START_MS) initialPlan = "plus";
					else if (t <= END_MS && activeAt(t)) buyMs = t;
				}
			}
		} else if (salt(uid, "buy-est") < P_BUY_EST) {
			// a uniform moment in the window, kept only if the learner is active then (no window-end bias)
			const t = START_MS + salt(uid, "buy-est-t") * (END_MS - START_MS);
			if (activeAt(t)) buyMs = t;
		}
	}
	// H6: annual-minded buyers always pick annual; after the price change some monthly-minded buyers switch to annual and some walk away
	let interval = null;
	if (buyMs < Infinity) {
		if (salt(uid, "interval") < ANNUAL_SHARE_PRE) interval = "annual";
		else if (buyMs < ms(PLUS_PRICE_CHANGE)) interval = "monthly";
		else {
			const r = salt(uid, "price-reaction");
			interval = r < MONTHLY_SWITCH_ANNUAL ? "annual" : r < MONTHLY_SWITCH_ANNUAL + MONTHLY_LOST ? null : "monthly";
			if (!interval) buyMs = Infinity;
		}
	}
	const planAt = (t) => (t >= buyMs ? "plus" : initialPlan);
	if (buyMs < Infinity) {
		const near = events.reduce((best, e) => (Math.abs(T(e) - buyMs) < Math.abs(T(best) - buyMs) ? e : best), events[0]);
		const pw = makeFrom(near, "paywall viewed", {
			time: iso(buyMs - (2 + salt(uid, "pw-gap") * 18) * MIN_MS),
			paywall_trigger: PAYWALL_TRIGGERS[Math.floor(salt(uid, "pw-trigger") * PAYWALL_TRIGGERS.length)],
		});
		extra.push(pw, makeFrom(near, "subscription started", { time: iso(buyMs), plan: "plus", billing_interval: interval }));
	}
	// paywalls are shown to free learners only; the Ask Bright upsell exists from launch
	events = events.filter((e) => e.event !== "paywall viewed" || planAt(T(e)) === "free");
	const PRE_AI_TRIGGERS = PAYWALL_TRIGGERS.filter((x) => x !== "ai_tutor");
	for (const e of events.concat(extra)) {
		if (e.event === "paywall viewed" && e.paywall_trigger === "ai_tutor" && T(e) < ms(AI_TUTOR_LAUNCH)) {
			e.paywall_trigger = PRE_AI_TRIGGERS[Math.floor(hashFloat(`${uid}|pw|${e.insert_id}`) * PRE_AI_TRIGGERS.length)];
		}
	}

	// ── H1: Ask Bright AI tutor — adopters among Plus/Teams learners, from a salted start in the 3 weeks after launch ──
	const adopter = salt(uid, "ai-adopter") < AI_ADOPTER_SHARE;
	const aiStart = ms(AI_TUTOR_LAUNCH) + salt(uid, "ai-start") * AI_RAMP_DAYS * DAY_MS;
	const aiUse = AI_USE_MIN + salt(uid, "ai-use") * (AI_USE_MAX - AI_USE_MIN);
	events = events.filter((e) => {
		if (e.event !== "ai tutor question asked") return true;
		const t = T(e);
		return adopter && t >= aiStart && AI_PLANS.includes(planAt(t)) && hashFloat(`${uid}|ai|${e.insert_id}`) < aiUse;
	});
	// a tutor conversation often runs to follow-up questions a few minutes apart
	const followUps = [];
	for (const e of events) {
		if (e.event !== "ai tutor question asked") continue;
		let t = T(e);
		for (let k = 1; k <= AI_FOLLOWUP_MAX && hashFloat(`${uid}|followup|${e.insert_id}|${k}`) < AI_FOLLOWUP_P; k++) {
			t += (1 + hashFloat(`${uid}|followup-gap|${e.insert_id}|${k}`) * 6) * MIN_MS;
			if (t > END_MS) break;
			followUps.push(cloneEvent(e, { time: iso(t), question_type: TUTOR_QUESTION_TYPES[Math.floor(hashFloat(`${uid}|followup-type|${e.insert_id}|${k}`) * TUTOR_QUESTION_TYPES.length)] }));
		}
	}
	if (followUps.length) events = events.concat(followUps);
	const firstTutor = events.filter((e) => e.event === "ai tutor question asked").reduce((m, e) => Math.min(m, T(e)), Infinity);

	// ── H10 + lesson details: preferred playback speed; minutes follow speed ──
	const pref = Number(profile.preferred_playback_speed) || 1;
	const speeds = Object.keys(SPEED_TIERS).map(Number);
	for (const e of events) {
		if (e.event !== "lesson completed") continue;
		const base = 6 + hashFloat(`${uid}|len|${e.lesson_id}`) * 16; // lesson length at 1x, minutes
		if (e.content_type === "video") {
			const sp = hashFloat(`${uid}|stick|${e.lesson_id}`) < SPEED_STICK ? pref : speeds[Math.floor(hashFloat(`${uid}|sp|${e.lesson_id}`) * speeds.length)];
			e.playback_speed = sp;
			e.minutes_spent = Math.max(2, Math.round(base / sp + hashFloat(`${uid}|pause|${e.lesson_id}`) * 4));
		} else {
			delete e.playback_speed;
			e.minutes_spent = Math.max(3, Math.round(base * (e.content_type === "lab" ? 2.2 : 0.9)));
		}
	}

	// ── quiz scores: organic draw, H10 2x penalty, H1 tutor boost after the first question ──
	for (const e of events) {
		if (e.event !== "quiz submitted") continue;
		let s = chance.normal({ mean: SCORE_MEAN, dev: SCORE_SD });
		if (pref === FAST_SPEED) s -= FAST_SCORE_PENALTY;
		if (T(e) > firstTutor) s += AI_SCORE_BOOST;
		e.score_pct = Math.round(clamp(s, 5, 100));
		e.passed = e.score_pct >= PASS_MARK;
	}

	events = events.concat(extra);

	// ── server-side events carry no device; plan at event time on every event ──
	for (const e of events) {
		if (SERVER_EVENTS.has(e.event)) for (const k of DEVICE_FIELDS) delete e[k];
		e.plan_tier = sponsored ? "teams" : planAt(T(e));
	}
	profile.plan_tier = sponsored ? "teams" : (buyMs < Infinity ? "plus" : initialPlan);

	// H2 exposure: every learner who views a course page while the test is live is in it, recorded once,
	// 1 s before their first in-test course page view (browse-only views included, not only the funnel's).
	// The variant is the engine's sticky per-learner assignment.
	const testStart = ms(COURSE_PICKS_START);
	const firstPv = events.reduce((m, e) => (e.event === "course page viewed" && T(e) >= testStart && (!m || T(e) < T(m)) ? e : m), null);
	const engineExposure = events.find((e) => e.event === "$experiment_started");
	events = events.filter((e) => e.event !== "$experiment_started");
	if (firstPv) {
		const variant = profile[EXP_KEY] ?? PICKS_VARIANTS[Number(u.quickHash(`${uid}:${PICKS_EXPERIMENT}`)) % PICKS_VARIANTS.length];
		const exposure = makeFrom(firstPv, "$experiment_started", { time: iso(T(firstPv) - 1000), "Experiment name": PICKS_EXPERIMENT, "Variant name": variant });
		if (engineExposure) exposure.insert_id = engineExposure.insert_id;
		events.push(exposure);
		profile[EXP_KEY] = variant;
	} else if (profile[EXP_KEY] !== undefined) delete profile[EXP_KEY];
	return events;
}

// ── WAREHOUSE HOOK: exogenous facts layered on event-derived volumes ──
function handleWarehouse(row, meta) {
	if (meta.isBackfill) return row;
	if (meta.metricName === "paid_marketing_daily") {
		row.spend_usd = paidSpend(row.date, row.acquisition_channel);
		return row;
	}
	if (meta.metricName === "app_stability_daily") {
		// the player also starts course trailers and previews, which send no lesson event
		const k = `${row.date}|${row.platform}`;
		row.video_starts = Math.round(row.video_starts + PREVIEW_PLAYS_PER_DAY[row.platform] * jitter(`prev|${k}`, 0.5) * jitter(`prev|${row.date}`, 0.3));
		return row;
	}
	if (meta.metricName === "subscription_billing_daily") {
		const k = `${row.date}|${row.billing_interval}`;
		let subs = meta.raw.plus.count;
		// first payments that fail are never booked; app-store purchases never reach Mixpanel
		let failed = 0;
		for (let i = 0; i < subs; i++) if (hashFloat(`fail|${k}|${i}`) < BILLING_FAIL_SHARE) failed++;
		subs -= failed;
		if (hashFloat(`store|${k}`) < BILLING_STORE_SHARE) subs += 1;
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
	identity: { avgDevicePerUser: 2 },

	events: EVENTS,

	funnels: [
		{
			name: "Onboarding",
			sequence: ["account created", "learning goals set", "course enrolled", "lesson started"],
			isFirstFunnel: true,
			conditions: { account_type: "individual" },
			conversionRate: ONBOARD_CONV,
			timeToConvert: ONBOARD_TTC_H,
			order: "sequential",
			weight: 1,
			props: {
				course_id: COURSE_IDS,
				lesson_id: () => `les_${chance.hash({ length: 12 })}`,
				content_type: ["video"],
				enrollment_source: ["recommendation", "catalog_browse", "search"],
			},
		},
		{
			name: "Onboarding",
			sequence: ["account created", "learning goals set", "course enrolled", "lesson started"],
			isFirstFunnel: true,
			conditions: { account_type: "employer_sponsored" },
			conversionRate: Math.round(ONBOARD_CONV * SPONSORED_ONBOARD_MULT),
			timeToConvert: ONBOARD_TTC_H * SPONSORED_TTC_MULT,
			order: "sequential",
			weight: 1,
			props: {
				course_id: COURSE_IDS,
				lesson_id: () => `les_${chance.hash({ length: 12 })}`,
				content_type: ["video"],
				enrollment_source: ["learning_path"],
			},
		},
		{
			name: "Course Enrollment",
			sequence: ["course page viewed", "course enrolled"],
			conversionRate: ENROLL_CONV,
			timeToConvert: ENROLL_TTC_H,
			order: "sequential",
			weight: 2,
			props: {
				course_id: COURSE_IDS,
			},
			experiment: {
				name: PICKS_EXPERIMENT,
				startDaysBeforeEnd: (END_MS - ms(COURSE_PICKS_START)) / DAY_MS,
				variants: [
					{ name: "Control" },
					{ name: PICKS_VARIANT, conversionMultiplier: PICKS_CONV_MULT, ttcMultiplier: PICKS_TTC_MULT },
				],
			},
		},
		{
			name: "Lesson",
			sequence: ["lesson started", "lesson completed"],
			conversionRate: 82,
			timeToConvert: 1,
			order: "sequential",
			weight: 6,
			props: {
				lesson_id: () => `les_${chance.hash({ length: 12 })}`,
				content_type: { __weights: { video: 70, reading: 20, lab: 10 } },
			},
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
			name: "app_stability_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "lesson started",
				measure: "count",
				where: (e) => e.content_type === "video" && Boolean(e.platform),
				groupBy: "platform",
			},
			timeColumn: "date",
			valueColumn: "video_starts",
			columns: {
				playback_failure_rate: (ctx) => {
					const hit = ctx.seriesKey === INCIDENT_PLATFORM && inIncident(ctx.time);
					const j = hashFloat(`pf|${dayKey(ctx.time)}|${ctx.seriesKey}`);
					return hit ? round2(INCIDENT_FAIL + (j - 0.5) * 0.06) : Math.round((0.006 + j * 0.012) * 10000) / 10000;
				},
				crash_free_session_rate: (ctx) => {
					const j = hashFloat(`cf|${dayKey(ctx.time)}|${ctx.seriesKey}`);
					if (ctx.seriesKey === "web") return Math.round((0.9985 + j * 0.001) * 10000) / 10000;
					const hit = ctx.seriesKey === INCIDENT_PLATFORM && inIncident(ctx.time);
					return Math.round(((hit ? 0.962 : 0.993) + j * 0.004) * 10000) / 10000;
				},
				app_version: (ctx) => {
					if (ctx.seriesKey === "web") return "web";
					if (ctx.seriesKey === "ios") return ctx.time >= ms(IOS_RELEASE) ? "6.4.0" : "6.3.2";
					if (ctx.time >= ms(ANDROID_HOTFIX)) return "6.4.1";
					if (ctx.time >= ms(ANDROID_RELEASE)) return "6.4.0";
					return "6.3.2";
				},
			},
		},
		{
			name: "subscription_billing_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "subscription started",
				measure: "count",
				groupBy: "billing_interval",
			},
			timeColumn: "date",
			valueColumn: "new_subscriptions",
			columns: {
				list_price_usd: (ctx) => (ctx.row.billing_interval === "annual" ? PLUS_ANNUAL : plusMonthlyPrice(ctx.time)),
				gross_bookings_usd: (ctx) => round2(ctx.value * ctx.row.list_price_usd),
			},
		},
	],

	superProps: {
		plan_tier: ["free"],
		platform: ["web"],
	},

	userProps: {
		learner_segment: ["upskiller"],
		account_type: ["individual"],
		primary_goal: ["advance_in_role"],
		plan_tier: ["free"],
		customer_since: ["2025-01-01"],
		acquisition_channel: ["organic_search"],
		preferred_playback_speed: [1],
	},

	personas: [
		{ name: "career_switcher", weight: 25, eventMultiplier: 1.3, properties: { learner_segment: "career_switcher" } },
		{ name: "upskiller", weight: 32, eventMultiplier: 1.0, properties: { learner_segment: "upskiller" } },
		{ name: "university_student", weight: 23, eventMultiplier: 1.1, properties: { learner_segment: "university_student" } },
		{ name: "lifelong_learner", weight: 20, eventMultiplier: 0.7, properties: { learner_segment: "lifelong_learner" } },
	],

	retentionCurve: { type: "logarithmic", day1: 0.7, day7: 0.5, day30: 0.38 },

	hook(record, type, meta) {
		if (type === "user") return handleUserHook(record, meta);
		if (type === "everything") return handleEverything(record, meta);
		if (type === "warehouse") return handleWarehouse(record, meta);
		return record;
	},
};

// ── STORIES ──────────────────────────────────────────────────────────────
// Machine-checkable contract for hooks H1-H10. Evaluate with:
//   node dungeons/vertical/education/education.verify.mjs

const EV = `read_json_auto('{{PREFIX}}-EVENTS*.json*', sample_size=-1, union_by_name=true)`;
const US = `read_json_auto('{{PREFIX}}-USERS*.json*', sample_size=-1, union_by_name=true)`;
const WH = (table) => `read_json_auto('{{PREFIX}}-WAREHOUSE-${table}.json*', sample_size=-1, union_by_name=true)`;

// Identity prelude: a device resolves to the user seen with it on any event
// that carries both ids (emitted stitch evidence, the way Mixpanel merges).
const ID_CTE = `dmap AS (SELECT device_id, min(user_id::VARCHAR) AS mapped FROM ${EV}
  WHERE user_id IS NOT NULL AND device_id IS NOT NULL GROUP BY 1),
ev AS (SELECT coalesce(e.user_id::VARCHAR, m.mapped) AS uid, e.time::TIMESTAMP AS t, e.*
  FROM ${EV} e LEFT JOIN dmap m ON e.device_id = m.device_id)`;

const TS = (isoStr) => dayjs.utc(isoStr).format("YYYY-MM-DD HH:mm:ss");
const D = (isoStr) => isoStr.slice(0, 10);
const band = (k) => [Math.round(k * 0.9 * 1000) / 1000, Math.round(k * 1.1 * 1000) / 1000];
const SQL_LIST = (xs) => xs.map((x) => `'${x}'`).join(", ");
const ONBOARDING_STEPS = ["account created", "learning goals set", "course enrolled", "lesson started"];
const RETENTION_DAY = 30;
const COMPLETION_COHORT_END = "2026-07-01T00:00:00Z"; // enrollments with at least 92 days to finish (longest course: 8 weeks x 1.6 pace)
const INC_BASE_FROM = TS(dayjs.utc(ANDROID_RELEASE).subtract(7, "day"));
const INC_BASE_TO = TS(dayjs.utc(ANDROID_HOTFIX).add(7, "day"));
const PAID_COHORT_LAST = dayjs.utc(PAID_COHORT_END).subtract(1, "day").format("YYYY-MM-DD");
// first payment per new subscription: annual list price or the monthly price in force
const AVG_PAYMENT = (annualShare, monthly) => annualShare * PLUS_ANNUAL + (1 - annualShare) * monthly;
const VOLUME_DAYS = 53; // days either side of the price change: Jun 18 - Aug 9 vs Aug 10 - Oct 1
const PAYMENT_RATIO = Math.round(AVG_PAYMENT(ANNUAL_SHARE_POST, PLUS_MONTHLY_NEW) / AVG_PAYMENT(ANNUAL_SHARE_PRE, PLUS_MONTHLY_OLD) * 1000) / 1000;

/** step_counts conversion for a set of segments from a timeToConvert breakdown. */
const convOf = (rows, segs) => {
	const rs = (rows || []).filter((x) => segs.includes(x.segment_value) && Array.isArray(x.step_counts) && x.step_counts[0]);
	if (!rs.length) return null;
	const entered = rs.reduce((a, r) => a + r.step_counts[0], 0);
	const converted = rs.reduce((a, r) => a + r.step_counts[r.step_counts.length - 1], 0);
	return { entered, converted, rate: converted / entered };
};

const H1_SQL = `WITH ${ID_CTE},
ft AS (SELECT uid, min(t) AS t1 FROM ev WHERE event = 'ai tutor question asked' GROUP BY 1),
q AS (SELECT ev.uid, ev.t, ev.score_pct, ev.plan_tier, ft.t1 FROM ev LEFT JOIN ft ON ft.uid = ev.uid WHERE ev.event = 'quiz submitted'),
g AS (SELECT CASE WHEN t1 IS NULL THEN 'non' ELSE 'adopter' END AS grp,
  CASE WHEN t1 IS NULL THEN t >= TIMESTAMP '${TS(AI_TUTOR_LAUNCH)}' ELSE t > t1 END AS post,
  avg(score_pct) AS score, count(DISTINCT uid) AS users
  FROM q WHERE t1 IS NOT NULL OR plan_tier IN (${SQL_LIST(AI_PLANS)}) GROUP BY 1, 2)
SELECT 'all' AS grp, min(users) AS user_count,
 (max(score) FILTER (WHERE grp = 'adopter' AND post) - max(score) FILTER (WHERE grp = 'adopter' AND NOT post))
 - (max(score) FILTER (WHERE grp = 'non' AND post) - max(score) FILTER (WHERE grp = 'non' AND NOT post)) AS did
FROM g`;

const H2_SQL = `WITH ${ID_CTE},
v AS (SELECT distinct_id::VARCHAR AS uid, "${EXP_KEY}" AS variant FROM ${US} WHERE "${EXP_KEY}" IS NOT NULL),
pv AS (SELECT uid, course_id, t AS t0 FROM ev WHERE event = 'course page viewed' AND t >= TIMESTAMP '${TS(COURSE_PICKS_START)}'),
en AS (SELECT uid, course_id, t AS t1 FROM ev WHERE event = 'course enrolled'),
x AS (SELECT v.variant, pv.uid, pv.t0, min(en.t1) AS t1 FROM pv JOIN v ON v.uid = pv.uid
  LEFT JOIN en ON en.uid = pv.uid AND en.course_id = pv.course_id AND en.t1 >= pv.t0 AND en.t1 < pv.t0 + INTERVAL 1 DAY GROUP BY 1, 2, 3)
SELECT variant AS grp, count(DISTINCT uid) AS user_count, count(*) AS page_views, avg((t1 IS NOT NULL)::INT) AS conv,
 median(date_diff('second', t0, t1)) AS med_ttc_s
FROM x GROUP BY 1`;

const H4_SQL = `WITH ${ID_CTE},
e AS (SELECT uid, course_id, course_format, t FROM ev WHERE event = 'course enrolled' AND t < TIMESTAMP '${TS(COMPLETION_COHORT_END)}'),
c AS (SELECT uid, course_id, min(t) AS tc FROM ev WHERE event = 'certificate earned' GROUP BY 1, 2)
SELECT e.course_format AS grp, count(DISTINCT e.uid) AS user_count, count(*) AS enrollments, avg((c.tc IS NOT NULL AND c.tc > e.t)::INT) AS completion
FROM e LEFT JOIN c ON c.uid = e.uid AND c.course_id = e.course_id GROUP BY 1`;

const H5_SQL = `WITH ${ID_CTE},
s AS (SELECT uid, t AS t0 FROM ev WHERE event = 'account created' AND t < TIMESTAMP '${TS(DATASET_END)}' - INTERVAL ${RETENTION_DAY + 7} DAY
  AND uid IN (SELECT uid FROM ev WHERE event = 'lesson started')),
f AS (SELECT s.uid,
  count(*) FILTER (WHERE e.event = 'lesson completed' AND e.t < s.t0 + INTERVAL ${STREAK_DAYS} DAY) AS first_week,
  count(*) FILTER (WHERE e.t >= s.t0 + INTERVAL ${RETENTION_DAY} DAY AND e.event NOT IN ('certificate earned', 'subscription started')) AS ret
  FROM s JOIN ev e ON e.uid = s.uid GROUP BY 1)
SELECT CASE WHEN first_week >= ${STREAK_MIN} THEN 'activated' ELSE 'not_activated' END AS grp,
 count(*) AS user_count, avg((ret > 0)::INT) AS retention
FROM f GROUP BY 1`;

const H6_SQL = `WITH ${ID_CTE}
SELECT CASE WHEN t >= TIMESTAMP '${TS(PLUS_PRICE_CHANGE)}' THEN 'post' ELSE 'pre' END AS grp, count(DISTINCT uid) AS user_count,
 avg((billing_interval = 'annual')::INT) AS annual_share
FROM ev WHERE event = 'subscription started' GROUP BY 1`;

const H8_SQL = `WITH ${ID_CTE},
o AS (SELECT DISTINCT date::DATE AS d, platform FROM ${WH("app_stability_daily")} WHERE playback_failure_rate >= 0.2),
od AS (SELECT DISTINCT d FROM o), op AS (SELECT DISTINCT platform FROM o),
s AS (SELECT uid, lesson_id, t, platform FROM ev WHERE event = 'lesson started' AND content_type = 'video' AND platform IS NOT NULL
  AND t >= TIMESTAMP '${INC_BASE_FROM}' AND t < TIMESTAMP '${INC_BASE_TO}'),
c AS (SELECT DISTINCT lesson_id FROM ev WHERE event = 'lesson completed'),
w AS (SELECT s.uid, s.t::DATE AS d, (s.platform IN (SELECT platform FROM op)) AS hit, (c.lesson_id IS NOT NULL) AS ok FROM s LEFT JOIN c ON c.lesson_id = s.lesson_id),
g AS (SELECT (d IN (SELECT d FROM od)) AS outage, avg(ok::INT) FILTER (WHERE hit) / avg(ok::INT) FILTER (WHERE NOT hit) AS rel, count(DISTINCT uid) FILTER (WHERE hit) AS users FROM w GROUP BY 1)
SELECT 'all' AS grp, (SELECT count(*) FROM od) AS outage_days, min(users) AS user_count,
 max(rel) FILTER (WHERE outage) / max(rel) FILTER (WHERE NOT outage) AS did
FROM g`;

const H9_SQL = `WITH ${ID_CTE},
p AS (SELECT distinct_id::VARCHAR AS uid, learner_segment FROM ${US}),
x AS (SELECT CASE WHEN p.learner_segment = 'university_student' THEN 'student' ELSE 'other' END AS seg,
  (ev.t >= TIMESTAMP '${TS(FALL_TERM_START)}') AS fall, ev.uid, ev.t::DATE AS d
  FROM ev JOIN p ON p.uid = ev.uid WHERE ev.event = 'lesson completed'),
g AS (SELECT seg, fall, count(*)::DOUBLE / count(DISTINCT d) AS per_day, count(DISTINCT uid) AS users FROM x GROUP BY 1, 2)
SELECT 'all' AS grp, min(users) AS user_count,
 (max(per_day) FILTER (WHERE seg = 'student' AND fall) / max(per_day) FILTER (WHERE seg = 'student' AND NOT fall))
 / (max(per_day) FILTER (WHERE seg = 'other' AND fall) / max(per_day) FILTER (WHERE seg = 'other' AND NOT fall)) AS did
FROM g`;

const H10_SQL = `WITH ${ID_CTE}
SELECT 'speed_' || replace(u.preferred_playback_speed::VARCHAR, '.', '_') AS grp, count(DISTINCT ev.uid) AS user_count, avg(ev.score_pct) AS score
FROM ev JOIN ${US} u ON u.distinct_id::VARCHAR = ev.uid WHERE ev.event = 'quiz submitted' GROUP BY 1`;

/** @type {import("../../../types").DungeonStory[]} */
export const stories = [
	{
		id: "H1-ask-bright-ai-tutor",
		hook: "H1",
		archetype: "temporal-inflection",
		narrative: `Ask Bright, the AI tutor, launches ${D(AI_TUTOR_LAUNCH)} for Plus and Teams learners (plan at event time). ${AI_ADOPTER_SHARE * 100}% of eligible learners adopt it, each starting on a day in the ${AI_RAMP_DAYS} days after launch and keeping ${AI_USE_MIN * 100}-${AI_USE_MAX * 100}% of their would-be questions, so tutor use ramps for three weeks. After a learner's first tutor question, their quiz scores rise by ${AI_SCORE_BOOST} points. Read: difference-in-differences of average quiz score, adopters after vs before their first question, minus eligible non-adopters after vs before launch (cancels the score level and any time trend; the cap at 100 trims a few tenths). Free learners and every pre-launch day carry no tutor questions (exact purity).`,
		mixpanelReport: { type: "Insights", event: "quiz submitted", measure: "average score_pct", chart: "weekly line", breakdown: "cohort: did ai tutor question asked (yes / no)", filter: "report filter: plan_tier in (plus, teams)", note: "the before/after-first-question difference-in-differences needs the raw export (education.sql)" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 count(*) FILTER (WHERE t < TIMESTAMP '${TS(AI_TUTOR_LAUNCH)}' OR plan_tier NOT IN (${SQL_LIST(AI_PLANS)})) AS impure_rows
FROM ev WHERE event = 'ai tutor question asked'`,
				},
				select: { a: { where: { grp: "all" } } },
				// exact: a tutor question before launch or on a Free plan is a bug
				expect: { metric: "a.impure_rows", op: "between", target: [0, 0] },
			},
			{
				breakdown: { type: "duckdb", sql: H1_SQL },
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.did", op: "between", target: band(AI_SCORE_BOOST) },
				minCohort: 500,
			},
		],
	},
	{
		id: "H2-personalized-course-picks-experiment",
		hook: "H2",
		archetype: "experiment-lift",
		narrative: `The "${PICKS_EXPERIMENT}" test starts ${D(COURSE_PICKS_START)} and splits learners 50/50 at their first course page view in the test, browse-only views included (one $experiment_started per learner, 1 s before that view; variant on the profile; every in-test course page viewer is in a variant). "${PICKS_VARIANT}" multiplies the share of course page views that end in an enrollment in that course by ${PICKS_CONV_MULT} and the view-to-enrollment time by ${PICKS_TTC_MULT}. A page view and its enrollment share course_id, so a totals funnel holding course_id constant reads per-view conversion; browse-only page views dilute both arms alike.`,
		mixpanelReport: { type: "Funnels", steps: ["course page viewed", "course enrolled"], counting: "totals", holdPropertyConstant: "course_id", breakdown: `user property "${EXP_KEY}"`, window: "1 day", dateRange: `${D(COURSE_PICKS_START)} onward` },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H2_SQL },
				select: { p: { where: { grp: PICKS_VARIANT } }, c: { where: { grp: "Control" } } },
				expect: { metric: "p.conv / c.conv", op: "between", target: band(PICKS_CONV_MULT) },
				minCohort: 2000,
			},
			{
				breakdown: { type: "duckdb", sql: H2_SQL },
				select: { p: { where: { grp: PICKS_VARIANT } }, c: { where: { grp: "Control" } } },
				expect: { metric: "p.med_ttc_s / c.med_ttc_s", op: "between", target: band(PICKS_TTC_MULT) },
				minCohort: 2000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count, count(*) AS exposures,
 count(DISTINCT uid) FILTER (WHERE "Variant name" = '${PICKS_VARIANT}')::DOUBLE / count(DISTINCT uid) AS variant_share
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
		id: "H3-sponsored-onboarding",
		hook: "H3",
		archetype: "funnel-conversion-by-segment",
		narrative: `New employer-sponsored learners (Brightpath for Teams seats) finish onboarding (account created → learning goals set → course enrolled → lesson started) at ${SPONSORED_ONBOARD_MULT}x the rate of self-pay learners (${Math.round(ONBOARD_CONV * SPONSORED_ONBOARD_MULT)}% vs ${ONBOARD_CONV}% at the engine) and in ${SPONSORED_TTC_MULT}x the time (their employer has already picked the course). Two declared first funnels with account_type conditions; every step is an onboarding-only event for new learners except course enrolled and lesson started, which the strict sequential funnel reads in order. The 7-day window trims both arms alike.`,
		mixpanelReport: { type: "Funnels", steps: ONBOARDING_STEPS, breakdown: "user property account_type", window: "7 days", measure: "conversion and median time to convert" },
		assertions: [
			{
				breakdown: { type: "timeToConvert", steps: ONBOARDING_STEPS, breakdownByUserProperty: "account_type", conversionWindowMs: 7 * DAY_MS },
				// custom assert: conversion lives in each segment row's step_counts ARRAY
				// (first vs last step); the expect grammar cannot index arrays
				assert: (rows) => {
					const sp = convOf(rows, ["employer_sponsored"]), ind = convOf(rows, ["individual"]);
					if (!sp || !ind) return { verdict: "NONE", detail: "missing segment rows" };
					if (sp.entered < 400 || ind.entered < 1500) return { verdict: "WEAK", detail: `small segments ${sp.entered}/${ind.entered}` };
					const ratio = sp.rate / ind.rate;
					const [lo, hi] = band(Math.round(ONBOARD_CONV * SPONSORED_ONBOARD_MULT) / ONBOARD_CONV);
					const detail = `onboarding conversion sponsored ${sp.converted}/${sp.entered}=${sp.rate.toFixed(4)} vs self-pay ${ind.converted}/${ind.entered}=${ind.rate.toFixed(4)}; ratio ${ratio.toFixed(4)} (knob ${SPONSORED_ONBOARD_MULT}, band [${lo}, ${hi}])`;
					if (ratio >= lo && ratio <= hi) return { verdict: "NAILED", detail };
					return { verdict: ratio > 1 ? "WEAK" : "INVERSE", detail };
				},
			},
			{
				breakdown: { type: "timeToConvert", steps: ONBOARDING_STEPS, breakdownByUserProperty: "account_type", conversionWindowMs: 7 * DAY_MS },
				select: { s: { where: { segment_value: "employer_sponsored" } }, i: { where: { segment_value: "individual" } } },
				expect: { metric: "s.median_ttc_ms / i.median_ttc_ms", op: "between", target: band(SPONSORED_TTC_MULT) },
				minCohort: 400,
			},
		],
	},
	{
		id: "H4-cohort-vs-self-paced-completion",
		hook: "H4",
		archetype: "funnel-conversion-by-segment",
		narrative: `Cohort courses (live sessions, weekly deadlines, a facilitator) are finished far more often than self-paced ones: ${COHORT_COMPLETE * 100}% of cohort enrollments would finish vs ${SELF_PACED_COMPLETE_MULT}x that for self-paced (${Math.round(COHORT_COMPLETE * SELF_PACED_COMPLETE_MULT * 100)}%). A finisher earns the certificate when the course ends (cohort: on schedule; self-paced: the nominal length x a pace with median 1), only if still active then, so lapsing hits both formats alike. Each learner enrolls in a course once, and the certificate carries the course_id. Read: per enrollment, share with a certificate for the same course, enrollments before ${D(COMPLETION_COHORT_END)} (every one has time to finish inside the data).`,
		mixpanelReport: { type: "Funnels", steps: ["course enrolled", "certificate earned"], counting: "totals", holdPropertyConstant: "course_id", breakdown: "course_format", window: "90 days", dateRange: `enrollments ${D(DATASET_START)} to ${dayjs.utc(COMPLETION_COHORT_END).subtract(1, "day").format("YYYY-MM-DD")}` },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H4_SQL },
				select: { s: { where: { grp: "self_paced" } }, c: { where: { grp: "cohort" } } },
				expect: { metric: "s.completion / c.completion", op: "between", target: band(SELF_PACED_COMPLETE_MULT) },
				minCohort: 500,
			},
		],
	},
	{
		id: "H5-first-week-lessons",
		hook: "H5",
		archetype: "retention-divergence",
		narrative: `New learners who complete fewer than ${STREAK_MIN} lessons in their first ${STREAK_DAYS} days are at risk: ${DARK_SHARE * 100}% of them go dark on a day between ${DARK_AFTER_MIN} and ${DARK_AFTER_MAX}; ${STREAK_MIN}+ lessons → no cut. Classification uses first-week activity only. Every new learner also faces organic lapse (${LAPSE_SHARE * 100}% stop on a uniform day ${LAPSE_DAY_MIN}-${LAPSE_DAY_MAX}), and ${SETUP_ABANDON_SHARE * 100}% of new learners who never start a lesson stop on day ${SETUP_ABANDON_DAY_MIN}-${SETUP_ABANDON_DAY_MAX}, so the read keeps learners who started a lesson. Retention = any learner-initiated event (not the backend certificate earned or subscription started) on or after day ${RETENTION_DAY} (Mixpanel unbounded retention), signups at least ${RETENTION_DAY + 7} days before the window end. ${STREAK_MIN}+ lessons vs fewer is at least 1/(1−${DARK_SHARE}) (a knob floor: lighter learners are also likelier to show no activity after day ${RETENTION_DAY} without the cut). Mixpanel: build the groups in Funnels (account created → lesson completed → lesson completed → lesson completed, ${STREAK_DAYS}-day window, uniques; completed = ${STREAK_MIN}+, dropped = fewer), save both as cohorts, then Retention (account created → any event except certificate earned and subscription started, on or after day ${RETENTION_DAY}).`,
		mixpanelReport: { type: "Funnels → cohorts → Retention", cohortFunnel: `account created → lesson completed ×3, ${STREAK_DAYS}-day window; completed vs dropped`, birth: "account created", return: "any event, excluding certificate earned and subscription started", mode: `on or after day ${RETENTION_DAY} (unbounded)`, filter: "did lesson started" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H5_SQL },
				select: { a: { where: { grp: "activated" } }, o: { where: { grp: "not_activated" } } },
				// confounded by engagement: knob-derived floor, NAILED within ±10% of it
				expect: { metric: "a.retention / o.retention", op: ">=", target: 1 / (1 - DARK_SHARE), floor: 0.9 / (1 - DARK_SHARE) },
				minCohort: 300,
			},
		],
	},
	{
		id: "H6-plus-price-change",
		hook: "H6",
		archetype: "composition-drift",
		narrative: `On ${D(PLUS_PRICE_CHANGE)} the Plus monthly price rises from $${PLUS_MONTHLY_OLD} to $${PLUS_MONTHLY_NEW}; annual stays $${PLUS_ANNUAL}. Before the change ${ANNUAL_SHARE_PRE * 100}% of new Plus subscribers pick annual billing. After it, annual-minded buyers still pick annual, ${MONTHLY_SWITCH_ANNUAL * 100}% of monthly-minded buyers switch to annual, and ${MONTHLY_LOST * 100}% of them do not buy: new subscriptions fall to ${POST_VOLUME.toFixed(2)}x of the would-be volume and the annual share rises to ${ANNUAL_SHARE_POST.toFixed(3)}. Prices exist only in the warehouse table subscription_billing_daily, so the first payment per new subscription needs the join: ${ANNUAL_SHARE_POST.toFixed(3)}×${PLUS_ANNUAL} + ${(1 - ANNUAL_SHARE_POST).toFixed(3)}×${PLUS_MONTHLY_NEW} over ${ANNUAL_SHARE_PRE}×${PLUS_ANNUAL} + ${1 - ANNUAL_SHARE_PRE}×${PLUS_MONTHLY_OLD} = ${PAYMENT_RATIO}x. Volume is compared over the ${VOLUME_DAYS} days either side of the change (equal windows). Learners who joined in the 60 days before the window buy on the same lag and survival as new learners, so June starts at the steady-state purchase rate. About 4 subscriptions a day, and the would-be volume itself drifts by several percent between two 53-day windows, so the volume read carries a knob-derived ceiling; the share and payment reads are the tight ones. Purchases happen only while the learner is still active (before any lapse cut, an event in the 14 days before), a backward look that the window end cannot censor.`,
		mixpanelReport: { type: "Insights", event: "subscription started", measure: "total", breakdown: "billing_interval", chart: "weekly stacked, % of total", join: "subscription_billing_daily.list_price_usd" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H6_SQL },
				select: { a: { where: { grp: "post" } } },
				expect: { metric: "a.annual_share", op: "between", target: band(ANNUAL_SHARE_POST) },
				minCohort: 150,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
s AS (SELECT uid, t, t::DATE AS d, billing_interval FROM ev WHERE event = 'subscription started'),
j AS (SELECT s.*, b.list_price_usd FROM s JOIN ${WH("subscription_billing_daily")} b ON b.date::DATE = s.d AND b.billing_interval = s.billing_interval)
SELECT CASE WHEN t >= TIMESTAMP '${TS(PLUS_PRICE_CHANGE)}' THEN 'post' ELSE 'pre' END AS grp, count(DISTINCT uid) AS user_count, avg(list_price_usd) AS first_payment
FROM j GROUP BY 1`,
				},
				select: { a: { where: { grp: "post" } }, b: { where: { grp: "pre" } } },
				expect: { metric: "a.first_payment / b.first_payment", op: "between", target: band(PAYMENT_RATIO) },
				minCohort: 150,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT CASE WHEN t >= TIMESTAMP '${TS(PLUS_PRICE_CHANGE)}' THEN 'post' ELSE 'pre' END AS grp, count(DISTINCT uid) AS user_count,
 count(*)::DOUBLE / ${VOLUME_DAYS} AS per_day
FROM ev WHERE event = 'subscription started'
 AND t >= TIMESTAMP '${TS(PLUS_PRICE_CHANGE)}' - INTERVAL ${VOLUME_DAYS} DAY AND t < TIMESTAMP '${TS(PLUS_PRICE_CHANGE)}' + INTERVAL ${VOLUME_DAYS} DAY GROUP BY 1`,
				},
				select: { a: { where: { grp: "post" } }, b: { where: { grp: "pre" } } },
				// noise-limited (Poisson, ~220 vs ~160 subscriptions): ceiling = half the knob's effect
				expect: { metric: "a.per_day / b.per_day", op: "<=", target: POST_VOLUME, floor: 1 - 0.5 * (1 - POST_VOLUME) },
				minCohort: 150,
			},
		],
	},
	{
		id: "H7-paid-channel-economics",
		hook: "H7",
		archetype: "attribution-bias",
		narrative: `Paid social signups cost ${(CPL_USD.paid_social / CPL_USD.paid_search).toFixed(2)}x as much as paid search signups (daily budgets set at $${CPL_USD.paid_social} vs $${CPL_USD.paid_search} per expected signup; warehouse paid_marketing_daily bills a paced daily budget per channel with a weekday shape above a ${SPEND_FLAT_SHARE * 100}% flat floor and seeded ±${SPEND_NOISE * 100}% day noise, never zero), but they buy Plus ${PURCHASE_KEEP.paid_social / PURCHASE_KEEP.paid_search}x as often (share of would-be purchases kept: ${PURCHASE_KEEP.paid_social} vs ${PURCHASE_KEEP.paid_search}; channel is independent of segment), so cost per paying subscriber is about the same. Spend per signup needs the warehouse join. The purchase read is the Mixpanel funnel account created → subscription started with the default ${PAID_FUNNEL_WINDOW_DAYS}-day window, signups ${D(DATASET_START)} through ${PAID_COHORT_LAST}. Buyer counts per channel are a few dozen, so the purchase ratio uses the knob as target with a knob-derived ceiling.`,
		mixpanelReport: { type: "Insights + Funnels + warehouse", event: "account created", breakdown: "acquisition_channel", join: "paid_marketing_daily.spend_usd", funnel: `account created → subscription started, ${PAID_FUNNEL_WINDOW_DAYS}-day window, signups ${D(DATASET_START)} to ${PAID_COHORT_LAST}, breakdown acquisition_channel` },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
s AS (SELECT acquisition_channel AS ch, count(*) AS signups, count(DISTINCT uid) AS users FROM ev WHERE event = 'account created' GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM ${WH("paid_marketing_daily")} GROUP BY 1)
SELECT s.ch AS grp, s.users AS user_count, sp.spend / s.signups AS spend_per_signup FROM s JOIN sp ON sp.ch = s.ch`,
				},
				select: { so: { where: { grp: "paid_social" } }, se: { where: { grp: "paid_search" } } },
				expect: { metric: "so.spend_per_signup / se.spend_per_signup", op: "between", target: band(CPL_USD.paid_social / CPL_USD.paid_search) },
				minCohort: 400,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
s AS (SELECT uid, t AS t0, acquisition_channel AS ch FROM ev WHERE event = 'account created' AND t < TIMESTAMP '${TS(PAID_COHORT_END)}'),
b AS (SELECT DISTINCT s.uid FROM s JOIN ev e ON e.uid = s.uid AND e.event = 'subscription started'
  AND e.t >= s.t0 AND e.t < s.t0 + INTERVAL ${PAID_FUNNEL_WINDOW_DAYS} DAY)
SELECT s.ch AS grp, count(*) AS user_count, count(b.uid)::DOUBLE / count(*) AS paid_rate FROM s LEFT JOIN b ON b.uid = s.uid GROUP BY 1`,
				},
				select: { so: { where: { grp: "paid_social" } }, se: { where: { grp: "paid_search" } } },
				expect: { metric: "so.paid_rate / se.paid_rate", op: "<=", target: PURCHASE_KEEP.paid_social / PURCHASE_KEEP.paid_search, floor: 1 - 0.5 * (1 - PURCHASE_KEEP.paid_social / PURCHASE_KEEP.paid_search) },
				minCohort: 400,
			},
		],
	},
	{
		id: "H8-android-playback-incident",
		hook: "H8",
		archetype: "bespoke",
		narrative: `Android app 6.4.0 (released ${D(ANDROID_RELEASE)}) ships a video player bug until the 6.4.1 hotfix on ${D(ANDROID_HOTFIX)}: ${INCIDENT_FAIL * 100}% of video lessons started on Android in those ${(ms(ANDROID_HOTFIX) - ms(ANDROID_RELEASE)) / DAY_MS} days that would have been completed are not. Web and iOS are unaffected, and reading and lab lessons are unaffected. A completion carries its start's device, so the Insights formula lesson completed / lesson started by platform reads the same as this per-lesson join. The incident days and platform come from the warehouse table app_stability_daily (playback_failure_rate); the event read is a ratio of ratios (Android completion per video start / other platforms, incident days vs the 7 days either side), which reads 1 − ${INCIDENT_FAIL} while cancelling weekday mix and the fall-term lift.`,
		mixpanelReport: { type: "Insights", events: ["lesson started", "lesson completed"], measure: "formula B/A, totals", filter: "content_type = video", breakdown: "platform", chart: "daily line", join: "app_stability_daily.playback_failure_rate" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H8_SQL },
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.did", op: "between", target: band(1 - INCIDENT_FAIL) },
				minCohort: 300,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT 'all' AS grp,
 count(*) FILTER (WHERE playback_failure_rate >= 0.2) AS incident_rows,
 avg(playback_failure_rate) FILTER (WHERE playback_failure_rate >= 0.2) AS incident_failure_rate,
 count(*) FILTER (WHERE playback_failure_rate >= 0.2 AND (date::DATE < DATE '${D(ANDROID_RELEASE)}' OR date::DATE >= DATE '${D(ANDROID_HOTFIX)}' OR platform <> '${INCIDENT_PLATFORM}')) AS misplaced
FROM ${WH("app_stability_daily")}`,
				},
				select: { a: { where: { grp: "all" } } },
				// warehouse playback failure rate during the incident = the failure knob
				expect: { metric: "a.incident_failure_rate", op: "between", target: band(INCIDENT_FAIL) },
			},
		],
	},
	{
		id: "H9-fall-term-students",
		hook: "H9",
		archetype: "temporal-inflection",
		narrative: `University students study less over the summer: before the fall term (${D(FALL_TERM_START)}) only ${STUDENT_SUMMER_KEEP * 100}% of their learning activity happens (whole lesson units: a start and its completion go together). From the fall term on they study at their full rate, so students' lesson completions per day rise 1/${STUDENT_SUMMER_KEEP} = ${(1 / STUDENT_SUMMER_KEEP).toFixed(3)}x relative to other segments. Read: difference-in-differences of completions per day, students fall/summer over everyone else fall/summer (cancels the growth in new learners and the weekday mix).`,
		mixpanelReport: { type: "Insights", event: "lesson completed", measure: "total", breakdown: "user property learner_segment", chart: "weekly line", compare: `before vs after ${D(FALL_TERM_START)}` },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H9_SQL },
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.did", op: "between", target: band(1 / STUDENT_SUMMER_KEEP) },
				minCohort: 1000,
			},
		],
	},
	{
		id: "H10-double-speed-quiz-scores",
		hook: "H10",
		archetype: "cohort-prop-scale",
		narrative: `Learners whose preferred playback speed is ${FAST_SPEED}x (a profile setting; ${SPEED_STICK * 100}% of their videos play at it) score ${FAST_SCORE_PENALTY} points lower on quizzes than 1x learners; 1.25x and 1.5x learners score the same as 1x. The tutor boost (H1) is independent of speed, so the average-score gap reads the knob (the floor at 5 and cap at 100 barely bind).`,
		mixpanelReport: { type: "Insights", event: "quiz submitted", measure: "average score_pct", breakdown: "user property preferred_playback_speed" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H10_SQL },
				select: { a: { where: { grp: "speed_1_0" } }, f: { where: { grp: "speed_2_0" } } },
				expect: { metric: "a.score - f.score", op: "between", target: band(FAST_SCORE_PENALTY) },
				minCohort: 500,
			},
			{
				breakdown: { type: "duckdb", sql: H10_SQL },
				select: { a: { where: { grp: "speed_1_0" } }, m: { where: { grp: "speed_1_5" } } },
				// control: 1.5x learners score like 1x learners
				expect: { metric: "m.score / a.score", op: "between", target: band(1) },
				minCohort: 500,
			},
		],
	},
];

export default config;
