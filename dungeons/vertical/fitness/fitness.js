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
 * NAME:       Stridewell
 * APP:        Consumer fitness app: plan a workout, do it (phone or wearable
 *             tracked), check progress, join solo or team challenges, book
 *             human coach sessions, log meals. Free tier plus Stridewell Plus
 *             (Monthly $12.99 → $14.99 from 2026-09-01, Annual $99.99).
 *             New members get one 7-day trial; Stride Coach (AI coaching) is a
 *             Plus feature from 2026-08-12. Plus includes one human coach
 *             session per billing month; extra sessions are $24.
 *             Company: seed-stage, ≈ 12 employees, ≈ 15 part-time contract
 *             coaches, ≈ 6,400 monthly active members, ≈ 1,850 Plus members by Oct 1.
 * SCALE:      10,000 simulated users → 8,985 member profiles (4,001 join
 *             inside the window; 1,015 would-be joiners are removed by the
 *             Summer Shred baseline thinning, see H5), 1.06M events,
 *             120 days (2026-06-04 → 2026-10-01, UTC)
 * CORE LOOP:  workout planned → workout completed → progress checked
 * VALUE MOMENT: workout completed
 *
 * EVENTS (22):
 *   app opened (20) > workout completed (8) > workout planned (6) > meal logged (6)
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
 *   - Workout Loop: workout planned → workout completed → progress checked (55%, 4 h)
 *   - Upgrade to Plus (trial), trial-eligible free members: paywall viewed → trial started → subscription purchased (26%)
 *       (new members, plus pre-window members who joined shortly before June 4 and
 *       still have a trial to start: the window-start trial pipeline, see below)
 *   - Upgrade to Plus (direct), long-time free members: paywall viewed → subscription purchased (1%;
 *       ≈8% of the long-time free pool buys in the window, so purchases stay ≈flat week to week)
 *   - Team Challenge: challenge joined → challenge completed (60%, challenge_format "team";
 *       shared challenge_id, completion near join + duration_days, see H7)
 *   - Solo Challenge: challenge joined → challenge completed (30%, challenge_format "solo")
 *   - Coaching: coach session → workout planned → workout completed (50%, 6 h)
 *
 * USER PROPS:  segment, fitness_level, primary_goal, acquisition_channel,
 *              wearable_type, subscription_tier, trial_eligible, Platform (the
 *              member's phone os), "Experiment: Guided First Week" (enrolled members)
 * SUPER PROPS: Platform (ios / android, derived from the event's device os, so it
 *              always agrees with os; one phone per member), subscription_tier
 *              (plan at event time: free / trial / monthly / annual; "trial"
 *              during the 7-day trial)
 * SCD PROPS:   fitness_level (beginner/intermediate/advanced/elite, monthly, max 6)
 * GROUPS:      none
 * WAREHOUSE:   paid_acquisition_daily (spend by paid channel),
 *              wearable_sync_daily (partner sync health by device type),
 *              subscription_billing_daily (list price and bookings by plan)
 * LOOKUPS:     none — every attribute is denormalized onto events/profiles
 *
 * IDENTITY: "account created" is the auth event (carries user_id + device_id)
 * and the first real event of every new member; one phone (one device_id)
 * per member, so model / os / carrier are fixed per member (the engine keeps
 * device fields sticky per device_id). A new member's signup time is their profile `created` (UTC; the
 * engine draws the hour from the soup's hour-of-day weights). Every event
 * carries user_id: there is no anonymous pre-signup
 * activity. An enrolled member's $experiment_started sits 1 s before
 * "account created" (engine placement) and also carries user_id. The three
 * onboarding steps after the auth event (goal quiz completed, plan
 * generated, starter workout completed) carry user_id only (no device_id);
 * every other event carries both.
 *
 * DESIGN NOTES:
 * - retentionCurve shapes new members' activity; pre-existing members'
 *   per-member activity is flat across the window (≈ 10 member-initiated events a week).
 * - Signups and SCD rows are engine-placed (no hook moves them): the signup
 *   equals profile `created`, births cover June 4 to October 1, and every
 *   fitness_level SCD row of a new member is at or after their signup.
 *   Birth days follow the soup's day-of-week weights and are uniform across
 *   the window, edge days included.
 * - Rhythm: soup DOW_WEIGHTS (Monday high, Friday-Saturday dip) and
 *   HOUR_WEIGHTS (Europe and North America morning and evening peaks, UTC).
 *   The Workout Loop and Coaching funnels span a few hours, so a completed
 *   workout lands 1-2 h after it was planned and keeps the daily rhythm.
 * - Fall Reset (H9): app visits rise through a world event (volumeMultiplier
 *   clones of app opened). The extra training sessions are whole Workout Loop
 *   units: fallResetSessions copies a linked plan → workout → progress check
 *   (or a lone step) with its own spacing to a uniform time in the program and
 *   re-draws each copy's declared properties at its time (the engine's clone
 *   re-draw: calories through the calorie model), so an extra plan is followed
 *   by its workout 1-2 h later and program workouts do not repeat earlier ones.
 * - App opens: every plan, progress check, meal log, and challenge starts in
 *   the app, so app opened (weight APP_OPEN_WEIGHT = 20) is the most common
 *   event: ≈ 240k app opens vs ≈ 197k workouts planned and ≈ 149k completed.
 * - Platform: derived per event from the engine's device os (platformOf:
 *   iOS and iPadOS → ios, Android → android) and set on the profile from the
 *   member's first event, so Platform never disagrees with os.
 * - Server-side notifications keep arriving after a member lapses (lapseAt):
 *   the lapse cuts member-initiated events only; post-lapse notifications are
 *   unopened and stop at account deactivation. Retention returns and "active"
 *   definitions exclude the passive events (notification received, account
 *   deactivated); H8 reads use members who joined before June 4.
 * - Segments: the engine scales every event by the persona's eventMultiplier,
 *   so shapeSocial keeps a per-segment share of challenge units, friend adds,
 *   and leaderboard views (social 100%, casual and beginner 75%, athlete and
 *   trainer 40%): social members join the most challenges and add the most
 *   friends. Free members can be in at most 3 running challenges (Plus:
 *   unlimited); a join over the limit never happens. Whole units go, so
 *   per-challenge completion rates are unchanged.
 * - Linked units (linkUnits): a challenge's join and completion share a
 *   challenge_id; usage-funnel steps link to the nearest earlier step (plan →
 *   workout within 3 h, paywall view → trial within 6 days, trial → purchase
 *   within 8 days). Thinning (H1) keeps or drops whole units, Fall Reset (H9)
 *   copies whole units, and a planned workout and its completion share one
 *   coaching_mode (H2).
 * - The engine gives usage funnels only to members who finish the first
 *   funnel, so onboarding runs at 100% in the engine and abandonOnboarding()
 *   (H1) decides who finishes. Non-finishers keep a per-member share of their
 *   usage (uniform 30-80%, by whole linked units) and half of their purchases
 *   never happen, so they still reach the paywall, trials, challenges, and
 *   Plus, just less often.
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
 * - Window start: pre-window members have a short engine lead-in, so June 4-7
 *   holds 97.6% of June 11-14's events (the member base grows ≈ 5% a week in June). Challenges:
 *   the engine lead-in covers only joins in the last few days before June 4,
 *   so scheduleChallenges drops its orphan completions and
 *   seedPreWindowChallenges draws each pre-window member's joins in the 30
 *   days before June 4 (their own in-window join rate, same format split,
 *   lengths, types, and 60/30 completion) and emits the completions that land
 *   on or after June 4 (salted per member, cloned from the member's own
 *   challenge event). Weekly completions per join are flat from week 1.
 * - Deactivations: a new member deactivates only if they lapse inside the
 *   window (H6 habit churn or organic lapse) and the engine drew a
 *   deactivation for them before the lapse. The deactivation lands on the
 *   lapse day (time of day from one of their own events, after their last
 *   event), so it keeps landing up to October 1: the lapse marks who left, no
 *   quiet-period rule is needed. Window start: new members only start to lapse
 *   from day 8, so a salted 9% of long-time free casual and beginner members
 *   (no pending trial, no purchase) lapse on a day in the first 40 days
 *   (density falling linearly to zero) and deactivate the same way; one who
 *   lapses before their first in-window event shows only the deactivation.
 *   Deactivations run ≈ 7-11 a day every week from June 4 to October 1.
 * - Human coaching: Plus (and trial) includes PLUS_INCLUDED_SESSIONS (1) a
 *   30-day billing month, renewing on each member's own (salted) billing day;
 *   extra sessions and free members' sessions are paid ($24) and only
 *   PAID_COACH_KEEP (4%) of those would-be sessions happen. Window start: a
 *   pre-window member may have used the current cycle's session before June 4
 *   (probability = share of the cycle already gone). Result: ≈ 4,800 sessions
 *   (≈ 2,240 coach-hours, ≈ 130 a week: ≈ 15 part-time coaches), 84% by Plus or
 *   trial members; weekly sessions per Plus member are flat (≈ 0.2).
 * - The challenge seeding and shaping, the window-start lapse, the
 *   deactivation time, the outage rotation, and the coach allowance use per-member salts only (no shared chance draws), so they leave the other
 *   members' random streams unchanged.
 * - paid_acquisition_daily follows a media plan (expected Mixpanel signups per
 *   day: births × weekday weight × channel share, with the Summer Shred push),
 *   so spend and impressions are never zero on a low-signup day; spend =
 *   platform-reported installs × CPI × day noise.
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
 *   as often as finishers (10.5% vs 21.3%), never zero.
 * MIXPANEL: Funnels, account created → goal quiz completed → plan generated →
 *   starter workout completed, 7-day window, breakdown user property
 *   "Experiment: Guided First Week". Guided ≈ 61% vs Control ≈ 47%; median
 *   time to finish ≈ 12.6 h vs 17.8 h.
 * REAL WORLD: a guided first-week plan reduces choice paralysis for new users.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H2. STRIDE COACH LAUNCH (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-08-12, Plus and trial workouts (event-time
 *   subscription_tier monthly / annual / trial) can run with coaching_mode =
 *   "ai_coach"; a planned workout and its completion share the mode. Adoption
 *   is per member: 60% of Plus members adopt (salted), and each adopter has their
 *   own full-use rate drawn from Beta(3, 1) (mean 75%, so use is spread, not
 *   all-or-nothing). Adopters' use ramps from 40% of their full rate on launch
 *   day to 100% after 21 days, so the Plus-workout share climbs from ≈20% in
 *   launch week to 0.6 × 0.75 = 45% from 2026-09-02 (43.8% measured). Coached sessions last
 *   1.2x longer (calories scale with the longer session). Free and
 *   pre-launch workouts stay self_guided.
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
 *   of smartwatch and fitness-band workouts sync; chest straps and phone
 *   tracking are untouched. The partner fails requests in rotation, so each
 *   owner keeps 1 in 4 of their affected workouts (salted start), not a coin
 *   flip per workout. The warehouse table shows sync_error_rate ≈ 0.75 and
 *   partner_api_status = "major_outage" on those days for those devices.
 * MIXPANEL: Insights, A = workout completed (tracking_source = wearable,
 *   wearable_type in smartwatch, fitness_band), B = workout planned (user
 *   property wearable_type in smartwatch, fitness_band), formula A / B, daily;
 *   outage days vs the 7 days on each side. Join the warehouse
 *   sync_error_rate to explain the dip. The same members on the same days in
 *   A and B cancel their busy and quiet days (planning is untouched).
 * REAL WORLD: third-party health-data integrations fail silently.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H4. PLUS MONTHLY PRICE CHANGE (everything + warehouse subscription_billing_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: on 2026-09-01 Plus Monthly goes from $12.99 to $14.99. 35% of
 *   would-be monthly purchases after that date never happen; Annual is
 *   untouched. Prices exist only in the warehouse table. Only ≈200 members
 *   buy after the change, so the plan-mix DiD is noisy (sd ≈ 0.1, from the
 *   Poisson noise of ≈90 Annual purchases): in the final run the pre-change
 *   mix is 549:270 = 2.03 (declared pool 2:1) and the post-change would-be
 *   mix is 112 / 0.65 : 88 = 1.96, so the DiD reads 0.63 (NAILED). A
 *   knob-derived floor (1 − 0.35/2) backs the band.
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
 *   Paid-social CPI bids double. Warehouse spend follows the media plan:
 *   planned installs × ≈1.08 platform overclaim (±12% day noise) × CPI ×
 *   seeded ±10% CPI noise. Half of all paid-social signups never buy Plus.
 * MIXPANEL: Insights, account created, breakdown acquisition_channel, daily
 *   or weekly; join paid_acquisition_daily.spend_usd for spend per signup and
 *   cost per extra member; Funnels account created → subscription purchased,
 *   uniques, breakdown acquisition_channel, conversion window 120 days (the
 *   whole dataset; the default 30-day window reads 9.8% vs 15.6% instead of
 *   11.4% vs 17.5%). The buy-rate read rests on ≈110 paid-social buyers
 *   (sampling sd of the ratio ≈ 0.06), so it can land on either side of the
 *   0.5 knob; the knob-derived floor (0.75) backs the NAILED ceiling (0.61
 *   in the final run: STRONG).
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
 * MIXPANEL: Retention, birth account created → return a custom event
 *   "Active action" (every event except notification received and account
 *   deactivated: notifications keep arriving after a member stops using the
 *   app), weekly unit, read the Week 4 bucket (days 28-34 after signup). Segment by
 *   first-week workouts with per-signup-week cohorts: members whose account
 *   created falls in week W and who did workout completed N+ times between
 *   the start of W and 7 days after its end (an approximation of each
 *   member's first 7 days; the exact per-member window needs the raw export).
 *   Raw-export values (each member's own first 7 days): Week 4 ≈ 14% for 0
 *   early workouts, ≈ 23% for 1-2, ≈ 40% for 3-4, ≈ 57% for 5+. The
 *   per-signup-week cohort approximation a Mixpanel user can build (workouts
 *   from the start of the signup week to 7 days after its end) reads ≈ 14%,
 *   20%, 32%, 48%. The knob sets a floor of 2.5x for 5+/0; busier members
 *   (and non-finishers' thinned usage, see H1) retain better anyway, so the
 *   ratio sits above it (4.11 in the final run: STRONG, above the NAILED
 *   band). Counting notifications as a return inflates every bucket (25% for
 *   0 early workouts) and shrinks the ratio to 2.68.
 * REAL WORLD: the first week sets the habit; most fitness churn is early.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H7. TEAM VS SOLO CHALLENGES (declarative duplicate funnels)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: team challenges complete at 60% per challenge, solo at 30%. A
 *   challenge runs for its duration_days (7/14/21/30): scheduleChallenges
 *   moves each completion into the last 20% of the challenge (whole days,
 *   keeping the engine's time of day), so a 30-day challenge completes 24-30
 *   days after the join; completions past Oct 1 are dropped. Team challenges
 *   are shared: members joining a team challenge of the same type and length
 *   in the same week land on one of 10 teams (≈7 participants each).
 *   challenge_id identifies each challenge. Challenges joined in the 30 days
 *   before June 4 still complete inside the window (seedPreWindowChallenges),
 *   so weekly completions do not ramp up in June. New members who lapse (H6) before
 *   a challenge ends never complete it, which trims both rates a little but
 *   not their 2x ratio.
 * MIXPANEL: Funnels, challenge joined → challenge completed, totals, hold
 *   challenge_id constant, breakdown challenge_format, date range Jun 4 - Aug
 *   31 (every challenge then ends inside the data), conversion window 31 days.
 * REAL WORLD: social accountability finishes what motivation starts.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H8. PUSH FATIGUE (everything; dose-response decline, no sweet spot)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: fatigue follows recent volume. A notification opens at the organic
 *   20% (declared pool, 1 in 5, typical for fitness-app push) while the member
 *   got at most 4 others in the previous 30 days. From there the chance a
 *   would-be open goes unopened ramps linearly to 60% at 12 recent
 *   notifications (open rate ≈ 8%). Pre-window members carry seeded
 *   pre-June-4 notifications at their own rate, so fatigue is steady from day
 *   1 and the open rate has no calendar trend (≈ 16% every month).
 *   Notifications are server-side and keep reaching new members after they
 *   lapse (H6), unopened; that is a lapse effect, not fatigue, so the reads
 *   use members who joined before June 4 (they do not lapse in the window).
 * MIXPANEL: Insights, notification received, share with opened = true,
 *   filter cohort "did not do account created in the window", breakdown by
 *   cohorts on notification count in the window (<12, 12-23, 24-35, 36+):
 *   ≈ 19.6% → 18.0% → 14.2% → 11.8%. The exact 30-day look-back read (≈ 20%
 *   at 0-4 recent vs ≈ 8% at 12+) needs the raw export. Over all members the
 *   monthly open rate drifts down (16.5% → 14.6%) only because lapsed new
 *   members keep receiving notifications they never open.
 * REAL WORLD: notification overload trains people to ignore the app.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H9. FALL RESET PROGRAM (world event + everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-09-08 for 14 days, training sessions run at 1.5x and app
 *   opens at 1.2x (world event); meal logging is untouched. The extra
 *   sessions are whole Workout Loop units (fallResetSessions: a plan, its
 *   workout 1-2 h later, the progress check after it), so the Workout Loop
 *   keeps its shape: the share of planned workouts followed by a completed
 *   workout within 4 h is the same in the program as in the two weeks before
 *   (pairing each plan with its next completion: 79.2% vs 78.3%; the Mixpanel
 *   totals funnel, which keeps the first plan's clock when a member plans twice,
 *   reads 78.2% vs 77.2%), and progress checks per workout stay at 0.64-0.65. Each
 *   extra session gets its own workout details (re-drawn at its time), so
 *   program workouts do not repeat earlier ones.
 * MIXPANEL: Insights, workout completed, app opened, meal logged, daily;
 *   formula workouts / app opens rises ≈ 1.22x and app opens / meals ≈ 1.19x
 *   during the program. Funnels, workout planned → workout completed, totals,
 *   4-hour window (the Workout Loop's), Sep 8-21 vs Aug 25 - Sep 7: equal
 *   (78.2% vs 77.2%).
 * REAL WORLD: a back-to-routine program after Labor Day brings members back
 *   a bit more often and makes each visit a training session.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * EXPECTED METRICS SUMMARY (measured: data/verify-fitness, 2026-10-07, engine 352f463, fix round 4)
 * ═════════════════════════════════════════════════════════════════════════
 * Hook | Metric                                      | Derivation              | Expected  | Measured
 * -----|---------------------------------------------|-------------------------|-----------|---------
 * H1   | onboarding conversion Guided/Control        | GUIDED_CONV_MULT        | 1.30      | 1.297 (60.6% vs 46.8%)
 * H1   | median onboarding TTC Guided/Control        | GUIDED_TTC_MULT         | 0.70      | 0.709
 * H1   | Guided share of enrolled                    | equal 2-arm hash        | 0.50      | 0.509
 * H1   | Plus buy rate, non-finishers / finishers    | NONFINISH_NO_BUY + thin | ≈ 0.5     | 0.49 (10.5% vs 21.3%)
 * H2   | ai_coach rows pre-launch or free tier       | exact purity            | 0         | 0
 * H2   | post-launch Plus duration ai/self           | AI_DURATION_MULT        | 1.20      | 1.202
 * H2   | Plus ai_coach share after the 21-day ramp   | ADOPTER_SHARE × USE     | 0.45      | 0.438
 * H2   | Plus members (10+ workouts) using it 25-74% | Beta(3,1) use rate      | spread    | 23.4% (40.8% never)
 * H2   | plan → workout pairs with different modes   | shared per linked unit  | 0         | 0 of 64,475
 * H2   | trial workouts run with Stride Coach        | trial has Plus features | > 0       | 284
 * H3   | watch+band synced per owner plan, outage vs ±7 days | OUTAGE_KEEP     | 0.25      | 0.264
 * H3   | same, vs all unaffected workouts            | OUTAGE_KEEP             | 0.25      | 0.250
 * H3   | warehouse sync_error_rate during outage     | 1 − OUTAGE_KEEP         | 0.75      | 0.752
 * H4   | monthly/annual purchases, after vs before   | 1 − MONTHLY_LOSS        | ≤ 0.65    | 0.626 (floor 0.825)
 * H4   | monthly/annual bookings, after vs before    | 0.65 × 14.99/12.99      | ≤ 0.75    | 0.722 (floor 0.952)
 * H4   | long-time free members buying in window     | DIRECT_CONV (realism)   | 3-8%      | 7.6%
 * H5   | paid-social spend per signup, Shred/rest    | SHRED_CPI_MULT          | 2.00      | 2.033
 * H5   | daily signups, Shred/rest (all channels)    | 1/(1 − SHRED_INCREMENTAL)| 1.33     | 1.329
 * H5   | daily signups, Shred/rest (non-paid-social) | control                 | 1.00      | 0.992
 * H5   | paid-social buy rate vs same-week others    | 1 − PAID_SOCIAL_NO_BUY  | ≤ 0.50    | 0.609 (floor 0.75)
 * H5   | paid channel-days with zero spend           | media plan              | 0         | 0 of 360
 * H6   | Week-4 retention, 5+ vs 0 early workouts    | ≥ 1/(1 − 0.6) (floor)   | ≥ 2.5     | 4.114 (56.8% vs 13.8%)
 * H6   | retention rises across 0 / 1-2 / 3-4 / 5+   | monotone churn share    | 3 steps   | 3
 * H7   | per-challenge completion, team (joins ≤ Aug 31) | TEAM_CONV           | 0.60      | 0.566
 * H7   | per-challenge completion, solo (joins ≤ Aug 31) | SOLO_CONV           | 0.30      | 0.279
 * H7   | team / solo completion                      | TEAM_CONV / SOLO_CONV   | 2.00      | 2.030
 * H7   | completions outside the last 20% of the challenge | duration_days      | 0         | 0
 * H7   | median days to complete, 7/14/21/30-day     | ≈ 0.9 × duration        | rising    | 6.0 / 12.5 / 18.5 / 26.4
 * H7   | participants per team challenge_id          | TEAM_SLOTS              | several   | 5.9 avg (7.6% single)
 * H8   | open rate 12+ / 0-4 recent (30 d), from Jul 4 | 1 − PUSH_FATIGUE_FLIP | 0.40      | 0.388
 * H8   | open rate, 0-4 recent notifications         | declared pool 1 of 5    | 0.20      | 0.200
 * H8   | open rate falls across 4 count cohorts      | monotone fatigue        | 3 steps   | 3
 * H8   | pre-window members' open rate, Sep / Jun    | steady-state fatigue    | 1.00      | 1.041
 * H9   | completed per app open, program/before      | 1.5 / 1.2               | 1.25      | 1.220
 * H9   | planned per app open, program/before        | 1.5 / 1.2               | 1.25      | 1.205
 * H9   | app opens per meal logged, program/before   | FALL_RESET_OPEN_MULT    | 1.20      | 1.190
 * H9   | plan → workout within 4 h, program/before   | whole linked units      | 1.00      | 1.011 (79.2% vs 78.3%; 1 day: 86.0% vs 84.7%; funnel 78.2% vs 77.2%)
 * H9   | program workouts duplicating another exactly | re-draw per copy       | ≈ 0       | 0 of 25,205 (10 of 123,742 outside)
 * --   | progress checks per completed workout       | whole linked units      | flat      | 0.648 → 0.640
 * --   | signups == profile created; SCD before signup | engine placement      | all / 0   | 4,001 / 0 of 13,871
 * --   | workouts Mon / Sat (soup DOW)               | DOW_WEIGHTS 1.0 / 0.7   | > 1.3     | 1.60 (24,977 / 15,644)
 * --   | Jun 4-7 events / Jun 11-14 events           | pre-window lead-in      | ≈ 1       | 0.976 (27,546 / 28,233)
 * --   | pre-window members on Plus at window start  | segment plan mix        | 10-20%    | 17.0%
 * --   | June new subscriptions per day, by week     | trial pipeline seeding  | no ramp   | 8.8-11.1 (Jul-Aug 7.7-10.1)
 * --   | challenge completions per join, by week     | pre-window seeding      | flat      | 0.39-0.46 every week (Jun 4-7: 0.46)
 * --   | account deactivated per day, by week        | lapse-day deactivation  | flat to Oct 1 | 6.9-11.1 every week (Jun 4-7: 8.8; Sep 28-Oct 1: 7.3)
 * --   | account deactivated per day, Jun-Aug / Sep  | lapse-day deactivation  | ≈ 1       | 9.4 / 8.7
 * --   | challenge joins per member: social / athlete / trainer | SOCIAL_KEEP  | social top | 6.7 / 5.1 / 4.4 (friends 5.1 / 3.5 / 3.0)
 * --   | most running challenges at a free member's join | FREE_CHALLENGE_LIMIT | ≤ 3      | 3
 * --   | coach sessions; share by Plus / trial members | included session + 4% paid | ≈ 80% | 4,831 (84%; 2,244 coach-hours, ≈ 131 a week)
 * --   | app opens > workouts planned > completed    | APP_OPEN_WEIGHT         | ordered   | 240,450 > 196,719 > 148,947
 * --   | events with Platform ≠ device os; members with 2 Platforms | platformOf | 0 / 0   | 0 / 0
 * --   | notifications > 7 d after last activity (opened) / after deactivation | lapseAt | > 0 / 0 | 6,896 (0 opened) / 0
 * --   | warehouse corr vs events: sync / billing / paid | drift knobs / plan  | 0.9-0.98  | 0.964 / 0.918 / 0.738 (paid follows the media plan)
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
// weekly rhythm [Sun..Sat]: the week starts strong (Sunday planning, Monday
// resolve), tapers through Thursday, and dips Friday-Saturday
const DOW_WEIGHTS = [0.9, 1.0, 0.96, 0.92, 0.87, 0.74, 0.7];
// daily rhythm (UTC hours) for ≈ 60% North America / 40% Europe: European
// mornings (05-07 UTC) and evenings (16-18), US East mornings (10-12) and
// evenings (21-23), US West evenings (00-02); quiet 03-04 UTC. Signups use the
// same profile (the engine draws a new member's signup hour from it).
const HOUR_WEIGHTS = [
	0.8, 0.7, 0.5, 0.25, 0.22, 0.42, 0.52, 0.48,
	0.42, 0.44, 0.6, 0.74, 0.7, 0.64, 0.66, 0.7,
	0.78, 0.8, 0.7, 0.64, 0.72, 0.9, 1.0, 0.88,
];

// usage funnel pacing (hours from first to last step); short spans keep each
// step near its own time of day, so workouts follow the daily rhythm
const WORKOUT_LOOP_TTC_H = 4;
const COACHING_TTC_H = 6;

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
const TRIAL_DAYS = 7;              // trial length: Plus features (subscription_tier "trial") until the trial ends or the member buys
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
// media plan: marketing books each paid channel's daily installs ahead of time
// from the expected signup volume (births per day × weekday rhythm × channel
// share, with the Summer Shred push on paid social), so spend follows the plan,
// not the day's realized signups
const BORN_SHARE = 0.5;            // macro.percentUsersBornInDataset / 100
const CHANNEL_WEIGHTS = { organic: 34, paid_social: 18, paid_search: 14, referral: 16, app_store_ads: 18 };
const PLATFORM_OVERCLAIM = 1.08;   // platforms claim ≈ 8% more installs than product analytics records
const PLATFORM_INSTALL_NOISE = 0.12; // ± day-level swing of platform-reported installs around the plan

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
// the engine places a completion within CHALLENGE_TTC_H of the join; the
// everything hook then moves it to the end of the challenge (scheduleChallenges)
const CHALLENGE_TTC_H = 96;
const CHALLENGE_EARLY_SHARE = 0.2; // a completion lands up to 20% of duration_days before the challenge ends
const TEAM_SLOTS = 10;             // open teams per challenge type, length, and join week
const CHALLENGE_DAYS = [7, 14, 21, 30]; // declared duration_days pool
const CHALLENGE_TYPES = ["steps", "strength", "streak", "distance"]; // declared challenge_type pool
// window-start pipeline: pre-window members' joins in the 30 days before June 4
// (the longest challenge) still complete inside the window
const PRE_CHALLENGE_DAYS = Math.max(...CHALLENGE_DAYS);
// a 30-day challenge joined by this date ends inside the window (Mixpanel read: joins up to Aug 31)
const CHALLENGE_READ_END = "2026-09-01T00:00:00Z";
const CHALLENGE_WINDOW_DAYS = 31;  // funnel conversion window for the challenge read

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

// H9 Fall Reset program: extra training sessions are whole Workout Loop units
// (a plan, the workout 1-2 h later, the progress check after it), so the share
// of planned workouts that are followed through stays the same
const FALL_RESET_MULT = 1.5;
const FALL_RESET_EVENTS = ["workout planned", "workout completed", "progress checked"];
const FALL_RESET_OPEN_MULT = 1.2;  // the program also brings members into the app a bit more (world event)

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
/** minutes × category burn rate × effort, with person-to-person spread */
const workoutKcal = (category, minutes, effort) => {
	const rate = KCAL_PER_MIN[category] || 6;
	const eff = 0.7 + 0.05 * (Number(effort) || 6);
	return Math.max(20, Math.round((Number(minutes) || 30) * rate * eff * chance.normal({ mean: 1, dev: 0.12 })));
};

// lifecycle: a member who lapses (H6 habit churn or organic lapse, or the
// window-start lapse below) deactivates 20-180 min after their last event when
// the engine drew a deactivation for them before the lapse; no one else does
// window-start lapse: a share of long-time free casual and beginner members were
// already drifting away on June 4 (the pre-window counterpart of the new-member
// lapse); each stops on a day in [0, PRE_LAPSE_DAYS) with a density that falls
// linearly to zero, so deactivations do not ramp up from an empty June
const PRE_LAPSE_SHARE = 0.09;
const PRE_LAPSE_SEGMENTS = ["casual", "beginner"];
const PRE_LAPSE_DAYS = 40;

// human coaching: Plus includes one coach session per billing month (trial
// members get the same allowance); further sessions, and every free member's
// session, are paid at COACH_SESSION_PRICE, so only a small share of those
// would-be sessions happen. Sized for a network of ≈ 12 part-time contract coaches.
const PLUS_INCLUDED_SESSIONS = 1;  // included coach sessions per billing month
const COACH_CYCLE_DAYS = 30;       // billing month length; each member's cycle starts on their own (salted) day
const PAID_COACH_KEEP = 0.04;      // share of would-be paid sessions (extra Plus sessions, free members) that happen
const COACH_SESSION_PRICE = 24;    // USD per paid session (guides)

// app opens: every planned workout, progress check, meal log, and challenge
// starts in the app, so app opened is the most common event
const APP_OPEN_WEIGHT = 20;

// Platform follows the member's device: the engine keeps os sticky per device_id
const platformOf = (os) => (os === "Android" ? "android" : "ios");

// challenges and social features by segment: the engine scales every event by
// the persona's eventMultiplier, so heavy trainers would also be the heaviest
// challenge joiners. Each segment keeps this share of its challenge units
// (salted per challenge), friend adds, and leaderboard views; social members
// keep all of theirs.
const SOCIAL_KEEP = { social: 1, casual: 0.75, beginner: 0.75, athlete: 0.4, trainer: 0.4 };
// the Free plan's challenge limit: a free member can be in at most this many
// running challenges at once (Plus: unlimited); a join over the limit never happens
const FREE_CHALLENGE_LIMIT = 3;

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
/** Media-plan installs for a paid channel on a UTC day (expected Mixpanel signups). */
function plannedInstalls(t, channel) {
	const days = (ms(DATASET_END) - ms(DATASET_START)) / DAY;
	const births = (NUM_USERS * BORN_SHARE) / days;
	const dowMean = DOW_WEIGHTS.reduce((a, b) => a + b, 0) / DOW_WEIGHTS.length;
	const dow = DOW_WEIGHTS[new Date(t).getUTCDay()] / dowMean;
	const total = Object.values(CHANNEL_WEIGHTS).reduce((a, b) => a + b, 0);
	const share = CHANNEL_WEIGHTS[channel] / total;
	// outside Summer Shred the baseline is thinned; inside, paid social gains the re-attributed share
	const planShare = inShred(t) && channel === "paid_social"
		? share + (1 - share) * SHRED_INCREMENTAL
		: share * (1 - SHRED_INCREMENTAL);
	return births * dow * planShare;
}
const inOutage = (t) => t >= ms(SYNC_OUTAGE_START) && t < ms(SYNC_OUTAGE_END);
const monthlyPrice = (t) => (t >= ms(PRICE_CHANGE) ? PRICE_MONTHLY_NEW : PRICE_MONTHLY_OLD);
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const T = (e) => dayjs.utc(e.time).valueOf();
const DAY = 86_400_000;
const HOUR = 3_600_000;
const ONBOARDING_STEPS = ["account created", "goal quiz completed", "plan generated", "starter workout completed"];
const ONBOARDING_BLOCK = new Set(["$experiment_started", ...ONBOARDING_STEPS]);
const EXP_KEY = `Experiment: ${GUIDED_EXPERIMENT}`;
/** Pre-window member who joined in the RECENT_JOIN_DAYS before June 4: their age in days, else null. */
const recentJoinAge = (uid) => (salt(uid, "recent-joiner") < RECENT_JOIN_SHARE ? salt(uid, "join-age") * RECENT_JOIN_DAYS : null);
function handleUserHook(profile, meta) {
	// pre-existing members already hold a plan; new signups start on Free
	if (meta.userIsBornInDataset) {
		// ── H5a: Summer Shred adds paid-social members (births are uniform) ──
		const uid = profile.distinct_id;
		const birth = dayjs.utc(meta.user.created).valueOf();
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
	// free / monthly / annual by segment: ≈ 17% of long-time members pay
	const mix = {
		athlete: [60, 15, 25],
		trainer: [55, 15, 30],
		social: [82, 12, 6],
		casual: [88, 8, 4],
		beginner: [94, 4, 2],
	}[profile.segment] || [88, 8, 4];
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

// linked units: [from, to, max gap]. The engine spaces funnel steps by
// timeToConvert / steps (± a third), so a usage-funnel step follows the previous
// one within ≈ 3 h, a trial follows its paywall view within ≈ 5 days, and a
// trial's purchase follows within the trial.
const UNIT_LINKS = [
	["coach session", "workout planned", 3 * HOUR],
	["workout planned", "workout completed", 3 * HOUR],
	["workout completed", "progress checked", 3 * HOUR],
	["paywall viewed", "trial started", 6 * DAY],
	["trial started", "subscription purchased", TRIAL_PAIR_DAYS * DAY],
	["paywall viewed", "subscription purchased", DAY],
];

/**
 * Group a member's events into linked units: a challenge's join and completion
 * (same challenge_id) and funnel chains (coach session → workout planned →
 * workout completed → progress checked; paywall viewed → trial started →
 * subscription purchased): each later step links to the nearest unlinked
 * earlier step within the gap. Every other event is a unit of its own.
 * @returns {Object[][]} units, each in time order
 */
function linkUnits(events) {
	const parent = new Map(events.map((e) => [e, e]));
	const find = (e) => {
		while (parent.get(e) !== e) { parent.set(e, parent.get(parent.get(e))); e = parent.get(e); }
		return e;
	};
	const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra); };
	const sorted = [...events].sort((a, b) => T(a) - T(b));
	const byName = new Map();
	for (const e of sorted) {
		if (!byName.has(e.event)) byName.set(e.event, []);
		byName.get(e.event).push(e);
	}
	const firstOfChallenge = new Map();
	for (const e of sorted) {
		if (e.event !== "challenge joined" && e.event !== "challenge completed") continue;
		const first = firstOfChallenge.get(e.challenge_id);
		if (first) union(first, e);
		else firstOfChallenge.set(e.challenge_id, e);
	}
	// each later step links to the nearest earlier step before it (the plan just
	// before the workout, the paywall view just before the trial)
	for (const [from, to, gap] of UNIT_LINKS) {
		const sources = byName.get(from) || [];
		const taken = new Set();
		let j = 0;
		for (const target of byName.get(to) || []) {
			const t1 = T(target);
			while (j < sources.length && T(sources[j]) < t1) j++;
			for (let k = j - 1; k >= 0 && T(sources[k]) >= t1 - gap; k--) {
				if (taken.has(sources[k])) continue;
				taken.add(sources[k]);
				union(sources[k], target);
				break;
			}
		}
	}
	const units = new Map();
	for (const e of sorted) {
		const r = find(e);
		if (!units.has(r)) units.set(r, []);
		units.get(r).push(e);
	}
	return [...units.values()];
}

/**
 * H7: a challenge runs for its declared duration_days, so a completion lands in
 * the last fifth of the challenge: join + duration minus up to 20% (whole days,
 * keeping the time of day the engine drew). Completions past the window end are
 * dropped (the challenge is still running). Team challenges are shared: members
 * who join a team challenge of the same type and length in the same week land on
 * one of TEAM_SLOTS teams, so a team challenge_id has several participants.
 */
function scheduleChallenges(events, uid) {
	const END = ms(DATASET_END);
	const joins = events.filter((e) => e.event === "challenge joined").sort((a, b) => T(a) - T(b));
	if (!joins.length) return events;
	const completionOf = new Map();
	for (const e of events) if (e.event === "challenge completed") completionOf.set(e.challenge_id, e);
	const late = new Set();
	const perCell = new Map();
	joins.forEach((j, n) => {
		const c = completionOf.get(j.challenge_id);
		const days = Number(j.duration_days) || 7;
		if (c) {
			const lagDays = Math.ceil((T(c) - T(j)) / DAY);
			const early = Math.floor(salt(uid, `ch-early|${n}`) * (Math.floor(CHALLENGE_EARLY_SHARE * days) + 1));
			const t = T(c) + Math.max(0, days - lagDays - early) * DAY;
			if (t > END) late.add(c);
			else c.time = new Date(t).toISOString();
		}
		if (j.challenge_format === "team") {
			const week = Math.floor((T(j) - ms(DATASET_START)) / (7 * DAY));
			const cell = `${j.challenge_type}|${days}|${week}`;
			const seen = perCell.get(cell) || 0;
			perCell.set(cell, seen + 1);
			// distinct teams for one member's joins in the same cell
			const slot = (Math.floor(salt(uid, `team|${cell}`) * TEAM_SLOTS) + seen) % TEAM_SLOTS;
			const id = `ch_${u.hashInsertId(`team|${cell}|${slot}`).replace(/-/g, "").slice(0, 12)}`;
			if (c) c.challenge_id = id;
			j.challenge_id = id;
		}
	});
	// a completion with no join is the engine's spill-in from a lead-in join
	// (only the last few days before June 4): seedPreWindowChallenges replaces
	// these with the full pre-window pipeline
	const joined = new Set(joins.map((j) => j.challenge_id));
	for (const c of events) if (c.event === "challenge completed" && !joined.has(c.challenge_id)) late.add(c);
	return late.size ? events.filter((e) => !late.has(e)) : events;
}

/**
 * Window-start challenge pipeline (H7): a pre-window member was joining
 * challenges before June 4 at the same rate as inside the window, and a
 * challenge joined up to 30 days earlier still ends inside it. Draw those
 * pre-June-4 joins (same team/solo split, types, lengths, and completion
 * rates) and emit only the completions that land on or after June 4, so
 * weekly completions per join are flat from the first week. The completion
 * is a clone of one of the member's challenge events; its time of day comes
 * from one of the member's own events.
 */
function seedPreWindowChallenges(events, uid) {
	const START = ms(DATASET_START), END = ms(DATASET_END);
	const joins = events.filter((e) => e.event === "challenge joined");
	if (!joins.length) return events;
	const template = events.find((e) => e.event === "challenge completed") || joins[0];
	const rate = joins.length / ((END - START) / DAY);
	const n = Math.floor(rate * PRE_CHALLENGE_DAYS + salt(uid, "ch-seed-n"));
	const added = [];
	const used = new Set();
	for (let k = 0; k < n; k++) {
		const format = salt(uid, `ch-seed-format|${k}`) < 0.5 ? "team" : "solo";
		if (salt(uid, `ch-seed-done|${k}`) >= (format === "team" ? TEAM_CONV : SOLO_CONV) / 100) continue;
		const days = CHALLENGE_DAYS[Math.floor(salt(uid, `ch-seed-days|${k}`) * CHALLENGE_DAYS.length)];
		const type = CHALLENGE_TYPES[Math.floor(salt(uid, `ch-seed-type|${k}`) * CHALLENGE_TYPES.length)];
		const joinDay = -1 - Math.floor(salt(uid, `ch-seed-age|${k}`) * PRE_CHALLENGE_DAYS); // day index, June 4 = 0
		const early = Math.floor(salt(uid, `ch-seed-early|${k}`) * (Math.floor(CHALLENGE_EARLY_SHARE * days) + 1));
		const doneDay = joinDay + days - early;
		if (doneDay < 0) continue; // the challenge ended before June 4
		const ref = events[Math.floor(salt(uid, `ch-seed-tod|${k}`) * events.length)];
		const t = START + doneDay * DAY + (T(ref) % DAY);
		if (t > END) continue;
		const week = Math.floor(joinDay / 7);
		const id = format === "team"
			? `ch_${u.hashInsertId(`team|${type}|${days}|${week}|${Math.floor(salt(uid, `ch-seed-slot|${k}`) * TEAM_SLOTS)}`).replace(/-/g, "").slice(0, 12)}`
			: `ch_${u.hashInsertId(`solo|${uid}|pre|${k}`).replace(/-/g, "").slice(0, 12)}`;
		if (used.has(id)) continue; // one completion per team challenge for a member
		used.add(id);
		const c = cloneEvent(template, { event: "challenge completed", time: new Date(t).toISOString(), challenge_id: id, challenge_format: format, challenge_type: type });
		delete c.duration_days;
		if (c.final_rank === undefined) c.final_rank = 1 + Math.floor(59 * salt(uid, `ch-seed-rank|${k}`) ** 1.6);
		added.push(c);
	}
	return added.length ? events.concat(added) : events;
}

/**
 * When a lapsing member deactivates: on the day of their lapse (cut), at the
 * time of day of one of their own events (so deactivations follow the daily
 * rhythm), and always 20-180 min or more after their last event. A member
 * often stops using the app days before they come back to deactivate. `refs`
 * supplies the time of day when no event precedes the lapse. Null past the
 * window end. Per-member salts only.
 */
function deactivationTime(kept, cut, uid, refs = kept) {
	const last = kept.reduce((m, e) => Math.max(m, T(e)), -Infinity);
	const ref = refs[Math.floor(salt(uid, "deact-tod") * refs.length)];
	const onLapseDay = Math.floor(cut / DAY) * DAY + (T(ref) % DAY);
	const when = Math.max(onLapseDay, last + (20 + Math.floor(salt(uid, "deact-gap") * 161)) * 60_000);
	return when <= ms(DATASET_END) ? when : null;
}

/** Server-side lifecycle messages: they keep arriving after a member stops using the app. */
const isPassive = (e) => e.event === "notification received";

/**
 * A member stops using the app at `cut`: every user-initiated event from then
 * on is gone. Server-side notifications keep arriving (unopened: the member no
 * longer comes back to the app) until the account is deactivated.
 */
function lapseAt(events, cut) {
	return events.filter((e) => {
		if (T(e) < cut) return true;
		if (!isPassive(e)) return false;
		e.opened = false;
		return true;
	});
}

/** Re-draw an event's declared properties from the config at the event's own time (the engine's clone re-draw). */
function redrawDeclared(e, profile) {
	const declared = (config.events.find((x) => x.event === e.event) || {}).properties || {};
	const ctx = { profile, event: e, time: T(e), config };
	for (const key of Object.keys(declared)) e[key] = u.choose(declared[key], ctx);
}

/**
 * H9 Fall Reset: members train more often during the program. Each Workout Loop
 * unit (workout planned → workout completed → progress checked, linked by
 * linkUnits; a step with no partner is a unit of one) whose first step falls in
 * the program gets an extra copy with probability FALL_RESET_MULT − 1. The copy
 * keeps the unit's own spacing and starts at a uniform time in the program
 * (never before signup), so an extra plan is still followed by its workout
 * 1-2 h later. Each copied step re-draws its declared properties at its own
 * time (workout details, calories through the calorie model), so program
 * workouts do not repeat earlier ones. A coach session in the unit is not copied.
 */
function fallResetSessions(events, profile, birthMs) {
	const start = ms(FALL_RESET_START);
	const end = start + FALL_RESET_DAYS * DAY;
	const from = Math.ceil(Math.max(start, birthMs ?? start) / 1000);
	const to = Math.floor((end - 1) / 1000);
	if (to <= from) return events;
	const added = [];
	for (const unit of linkUnits(events)) {
		const steps = unit.filter((e) => FALL_RESET_EVENTS.includes(e.event));
		if (!steps.length) continue;
		const t0 = T(steps[0]);
		if (t0 < start || t0 >= end) continue;
		if (!chance.bool({ likelihood: (FALL_RESET_MULT - 1) * 100 })) continue;
		const anchor = chance.integer({ min: from, max: to }) * 1000;
		for (const e of steps) {
			const t = anchor + (T(e) - t0);
			if (t > ms(DATASET_END)) continue;
			const c = cloneEvent(e, { time: new Date(t).toISOString() });
			redrawDeclared(c, profile);
			added.push(c);
		}
	}
	return added.length ? events.concat(added) : events;
}

/**
 * Challenges and social features by segment, and the Free plan's challenge
 * limit. Each segment keeps SOCIAL_KEEP of its friend adds, leaderboard views,
 * and challenge units (a join with its completion); a free member already in
 * FREE_CHALLENGE_LIMIT running challenges cannot join another. Whole units go,
 * so per-challenge completion rates are unchanged. Per-member salts only.
 */
function shapeSocial(events, profile, uid, tierAt) {
	const keep = SOCIAL_KEEP[profile.segment] ?? 1;
	if (keep < 1) {
		events = events.filter((e) => !((e.event === "friend added" || e.event === "leaderboard viewed")
			&& salt(uid, `social|${e.event}|${e.time}`) >= keep));
	}
	const joins = events.filter((e) => e.event === "challenge joined").sort((a, b) => T(a) - T(b));
	if (!joins.length) return events;
	const drop = new Set();
	const running = []; // end times of the member's kept challenges
	joins.forEach((j, n) => {
		const t = T(j);
		if (salt(uid, `ch-keep|${n}`) >= keep) { drop.add(j.challenge_id); return; }
		if (tierAt(t) === "free" && running.filter((x) => x > t).length >= FREE_CHALLENGE_LIMIT) { drop.add(j.challenge_id); return; }
		running.push(t + (Number(j.duration_days) || 7) * DAY);
	});
	return drop.size
		? events.filter((e) => !((e.event === "challenge joined" || e.event === "challenge completed") && drop.has(e.challenge_id)))
		: events;
}

/**
 * H1 abandonment: the engine ran onboarding at 100%. A seeded share of new
 * members finish (Control and not enrolled: ONBOARDING_CONV; Guided Plan: ×
 * GUIDED_CONV_MULT); the rest stop after an earlier step, keep a per-member
 * share of their usage, and buy less often. Usage is thinned by whole linked
 * units, so a kept challenge completion keeps its join, a trial its paywall
 * view, and a workout its plan.
 */
function abandonOnboarding(events, profile, uid) {
	const pFinish = (ONBOARDING_CONV / 100) * (profile[EXP_KEY] === GUIDED_VARIANT ? GUIDED_CONV_MULT : 1);
	if (salt(uid, "onb-finish") < pFinish) return events;
	let r = salt(uid, "onb-stop"), last = 0;
	while (last < ABANDON_AFTER.length - 1 && r >= ABANDON_AFTER[last]) { r -= ABANDON_AFTER[last]; last++; }
	const skipped = new Set(ONBOARDING_STEPS.slice(last + 1));
	events = events.filter((e) => !skipped.has(e.event));
	// the purchase is decided at member level: a kept purchase keeps its whole
	// chain (the paywall view and trial that led to it)
	const buy = events.find((e) => e.event === "subscription purchased");
	const keepBuy = !!buy && salt(uid, "onb-nobuy") >= NONFINISH_NO_BUY;
	const keep = NONFINISH_KEEP_MIN + (NONFINISH_KEEP_MAX - NONFINISH_KEEP_MIN) * salt(uid, "onb-engage");
	const out = [];
	for (const unit of linkUnits(events)) {
		if (unit.some((e) => ONBOARDING_BLOCK.has(e.event))) { out.push(...unit); continue; }
		if (buy && unit.includes(buy)) {
			if (keepBuy) { out.push(...unit); continue; }
			// a lost purchase leaves its paywall view and trial as one unit
			const rest = unit.filter((e) => e !== buy);
			if (rest.length && chance.bool({ likelihood: keep * 100 })) out.push(...rest);
			continue;
		}
		if (chance.bool({ likelihood: keep * 100 })) out.push(...unit);
	}
	return out;
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

	const signup = events.find((e) => e.event === "account created");
	const birthMs = signup ? T(signup) : null;

	// ── H9: Fall Reset adds whole Workout Loop units in the program window ──
	events = fallResetSessions(events, profile, birthMs);

	// ── H7: challenges end after their duration_days; team challenges are shared ──
	events = scheduleChallenges(events, uid);

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
	let lapseCut = null; // when a new member stops using the app (H6 or organic lapse)
	if (signup) {
		const habitEnd = birthMs + HABIT_DAYS * 86_400_000;
		const early = events.filter((e) => e.event === "workout completed" && T(e) >= birthMs && T(e) < habitEnd).length;
		if (salt(uid, "habit") < habitChurnShare(early)) {
			const cut = birthMs + HABIT_CHURN_AFTER_DAYS * 86_400_000;
			events = lapseAt(events, cut);
			if (purchase && T(purchase) >= cut) purchase = null;
			lapseCut = cut;
		}
		// organic lapse: most new members drift away at some point after week one
		if (salt(uid, "lapse") < LAPSE_SHARE) {
			const lapseDay = LAPSE_DAY_MIN + salt(uid, "lapse-day") * (LAPSE_DAY_MAX - LAPSE_DAY_MIN);
			const cut = birthMs + lapseDay * 86_400_000;
			events = lapseAt(events, cut);
			if (purchase && T(purchase) >= cut) purchase = null;
			lapseCut = lapseCut === null ? cut : Math.min(lapseCut, cut);
		}
	}

	// ── H3: partner health-API outage — most smartwatch / band workouts never sync ──
	// The partner fails sync requests in rotation: a member's k-th affected workout
	// syncs when floor((k + 1) · KEEP + o) > floor(k · KEEP + o), o salted per member,
	// so each member keeps OUTAGE_KEEP of them (1 in 4), not a coin flip each.
	const oStart = ms(SYNC_OUTAGE_START), oEnd = ms(SYNC_OUTAGE_END);
	const affected = events.filter((e) => e.event === "workout completed" && e.tracking_source === "wearable"
		&& OUTAGE_TYPES.includes(e.wearable_type) && T(e) >= oStart && T(e) < oEnd).sort((a, b) => T(a) - T(b));
	if (affected.length) {
		const o = salt(uid, "outage-rotation");
		const lost = new Set(affected.filter((e, k) => Math.floor((k + 1) * OUTAGE_KEEP + o) === Math.floor(k * OUTAGE_KEEP + o)));
		events = events.filter((e) => !lost.has(e));
	}

	// ── plan at event time (superProp subscription_tier): free → trial (Plus
	// features for TRIAL_DAYS) → the purchased plan; final profile plan ──
	const initialTier = profile.subscription_tier;
	const buyMs = purchase ? T(purchase) : Infinity;
	const trial = events.find((e) => e.event === "trial started");
	const trialFrom = trial ? T(trial) : Infinity;
	const trialTo = trialFrom + TRIAL_DAYS * DAY;
	const tierAt = (t) => (t >= buyMs ? purchase.plan : t >= trialFrom && t < trialTo ? "trial" : initialTier);
	for (const e of events) e.subscription_tier = tierAt(T(e));
	profile.subscription_tier = tierAt(END);

	// ── challenges and social features by segment; the Free plan's challenge limit ──
	events = shapeSocial(events, profile, uid, tierAt);
	// ── window-start challenge pipeline (pre-window members), at the shaped join rate ──
	if (!signup) {
		events = seedPreWindowChallenges(events, uid);
		for (const e of events) if (e.event === "challenge completed") e.subscription_tier = tierAt(T(e));
	}

	// ── H2: Stride Coach — adopting Plus (and trial) members, ramping up after
	// launch, longer sessions; a planned workout and its completion share the mode ──
	const launch = ms(AI_COACH_LAUNCH);
	const adopter = salt(uid, "coach-adopter") < AI_ADOPTER_SHARE;
	// each adopter has their own use rate: Beta(a, 1) via inverse CDF u^(1/a), mean AI_ADOPTER_USE
	const useRate = salt(uid, "coach-use") ** (1 / AI_USE_SHAPE);
	for (const e of events) {
		if (e.event === "paywall viewed" && e.paywall_trigger === "coach_teaser" && T(e) < launch) {
			// the Stride Coach teaser only exists on the paywall from launch day
			e.paywall_trigger = chance.pickone(["workout_library", "advanced_plans", "challenge_limit", "settings"]);
		}
	}
	if (adopter) {
		const eligible = (e) => T(e) >= launch && e.subscription_tier !== "free";
		for (const unit of linkUnits(events)) {
			const workouts = unit.filter((e) => e.event === "workout planned" || e.event === "workout completed");
			if (!workouts.length || !workouts.every(eligible)) continue;
			const ramp = AI_RAMP_FLOOR + (1 - AI_RAMP_FLOOR) * Math.min(1, (T(workouts[0]) - launch) / (AI_RAMP_DAYS * DAY));
			if (!chance.bool({ likelihood: useRate * ramp * 100 })) continue;
			for (const e of workouts) {
				e.coaching_mode = "ai_coach";
				if (e.event === "workout completed") {
					e.duration_minutes = Math.round(e.duration_minutes * AI_DURATION_MULT);
					e.calories_burned = Math.round(e.calories_burned * AI_DURATION_MULT); // longer session, same intensity
				}
				else e.planned_duration_minutes = Math.round(e.planned_duration_minutes * AI_DURATION_MULT);
			}
		}
	}

	// ── deactivation: one, only for a new member who lapsed inside the window (H6
	// habit churn or organic lapse), on the day they lapse. The lapse itself marks
	// who left, so deactivations keep landing up to October 1 ──
	const deacts = events.filter((e) => e.event === "account deactivated");
	events = events.filter((e) => e.event !== "account deactivated");
	if (deacts.length && events.length && lapseCut !== null && lapseCut <= END) {
		const when = deactivationTime(events.filter((e) => !isPassive(e)), lapseCut, uid);
		if (when !== null) {
			const d = cloneEvent(deacts[0], { time: new Date(when).toISOString() });
			d.subscription_tier = profile.subscription_tier;
			// a deactivated account gets no more notifications
			events = events.filter((e) => !(isPassive(e) && T(e) > when));
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

	// The steps below use per-member salts only (no shared chance draws), so they
	// leave every other member's random stream unchanged.

	// ── human coaching: Plus (and trial) includes PLUS_INCLUDED_SESSIONS a billing
	// month; extra sessions and free members' sessions are paid and rare ──
	const usedThisMonth = new Map();
	const cycleOffset = salt(uid, "coach-cycle") * COACH_CYCLE_DAYS;
	const cycleOf = (t) => Math.floor((t / DAY + cycleOffset) / COACH_CYCLE_DAYS);
	if (!signup) {
		// window start: a member who joined before June 4 may already have used this
		// cycle's session before June 4 (as likely as the share of the cycle already gone)
		const elapsed = ((START / DAY + cycleOffset) % COACH_CYCLE_DAYS) / COACH_CYCLE_DAYS;
		if (salt(uid, "coach-precycle") < elapsed) usedThisMonth.set(cycleOf(START), PLUS_INCLUDED_SESSIONS);
	}
	const droppedCoach = new Set();
	for (const e of events.filter((x) => x.event === "coach session").sort((x, y) => T(x) - T(y))) {
		if (e.subscription_tier !== "free") {
			// the allowance renews on the member's own billing day, not the 1st of the month
			const month = cycleOf(T(e));
			const used = usedThisMonth.get(month) || 0;
			if (used < PLUS_INCLUDED_SESSIONS) { usedThisMonth.set(month, used + 1); continue; }
		}
		if (salt(uid, `coach-paid|${e.time}`) >= PAID_COACH_KEEP) droppedCoach.add(e);
	}
	if (droppedCoach.size) events = events.filter((e) => !droppedCoach.has(e));

	// ── window-start lapse: some long-time free members were already drifting away
	// on June 4. They stop on a day early in the window (density falling to zero at
	// PRE_LAPSE_DAYS, mirroring how new members' lapses build up) and deactivate.
	if (!signup && !PENDING_TRIAL.has(uid) && initialTier === "free" && !purchase && deacts.length
		&& PRE_LAPSE_SEGMENTS.includes(profile.segment) && salt(uid, "pre-lapse") < PRE_LAPSE_SHARE) {
		const lapseDays = PRE_LAPSE_DAYS * (1 - Math.sqrt(1 - salt(uid, "pre-lapse-day")));
		const cut = START + lapseDays * DAY;
		const kept = events.filter((e) => T(e) < cut && !isPassive(e));
		// a member who stops before their first in-window event comes back only to deactivate
		const when = deactivationTime(kept, cut, uid, events);
		if (when !== null) {
			const d = cloneEvent(deacts[0], { time: new Date(when).toISOString() });
			d.subscription_tier = "free";
			// notifications keep arriving until the account is deactivated, unopened after the lapse
			const notes = events.filter((e) => isPassive(e) && T(e) <= when);
			for (const e of notes) if (T(e) >= cut) e.opened = false;
			events = kept.concat(notes, d);
		}
	}

	// ── Platform follows the member's phone: the engine's device os (sticky per device_id) ──
	let firstEvent = null;
	for (const e of events) {
		e.Platform = platformOf(e.os);
		if (!firstEvent || T(e) < T(firstEvent)) firstEvent = e;
	}
	if (firstEvent) profile.Platform = firstEvent.Platform;

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
		// performance channels bill per platform-reported install (CPI) against the
		// media plan; Summer Shred raised paid-social bids
		const channel = row.acquisition_channel;
		const t = dayjs.utc(row.date).valueOf();
		const mult = channel === "paid_social" && inShred(t) ? SHRED_CPI_MULT : 1;
		const noise = 1 + (hashFloat(`cpi|${row.date}|${channel}`) - 0.5) * 2 * CPI_NOISE;
		row.spend_usd = round2(row.platform_reported_installs * CPI_USD[channel] * mult * noise);
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
	macro: { percentUsersBornInDataset: BORN_SHARE * 100, bornRecentBias: 0, preExistingSpread: "uniform" },
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
	// one phone per member: the engine keeps model / os / carrier sticky per
	// device_id, and Platform is derived from that device's os (everything hook)
	identity: { avgDevicePerUser: 1 },
	// weekly and daily rhythm (UTC) for a North America + Europe audience
	soup: { dayOfWeekWeights: DOW_WEIGHTS, hourOfDayWeights: HOUR_WEIGHTS },

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
				calories_burned: (ctx) => {
					const e = ctx.event || {};
					return workoutKcal(e.workout_category, e.duration_minutes, e.perceived_effort);
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
				duration_days: CHALLENGE_DAYS,
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
				trial_days: [TRIAL_DAYS],
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
			weight: APP_OPEN_WEIGHT,
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
				startDaysBeforeEnd: (dayjs.utc(DATASET_END).unix() - dayjs.utc(GUIDED_TEST_START).unix()) / 86400,
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
			// plan, train, then check progress: each step ≈ 1-2 h after the last
			timeToConvert: WORKOUT_LOOP_TTC_H,
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
			timeToConvert: COACHING_TTC_H,
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
				// installs the platform bills: the media plan's installs, plus the ≈ 8% the
				// platform's own attribution claims over product analytics, with day noise
				platform_reported_installs: (ctx) => Math.round(plannedInstalls(ctx.time, ctx.row.acquisition_channel)
					* (PLATFORM_OVERCLAIM + (hashFloat(`pri|${dayKey(ctx.time)}|${ctx.seriesKey}`) - 0.5) * 2 * PLATFORM_INSTALL_NOISE)),
				// click-to-install ≈ 21% and click-through ≈ 1.1%, each with day-level jitter
				clicks: (ctx) => Math.round(ctx.row.platform_reported_installs / (0.21 * (0.85 + 0.3 * hashFloat(`cti|${dayKey(ctx.time)}|${ctx.seriesKey}`)))),
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
		// derived from the event's device os in the everything hook (platformOf)
		Platform: ["ios", "android"],
		subscription_tier: ["free"],
	},

	userProps: {
		segment: ["casual"],
		fitness_level: ["beginner"],
		primary_goal: ["lose_weight", "build_strength", "improve_endurance", "stay_active", "reduce_stress"],
		acquisition_channel: { __weights: CHANNEL_WEIGHTS },
		wearable_type: { __weights: { none: 35, smartwatch: 35, fitness_band: 20, chest_strap: 10 } },
		subscription_tier: ["free"],
		trial_eligible: [true],
		// the member's phone platform: set from their device os in the everything hook
		Platform: ["ios", "android"],
	},

	personas: [
		{ name: "athlete", weight: 12, eventMultiplier: 3.0, properties: { segment: "athlete", fitness_level: "advanced" } },
		{ name: "casual", weight: 40, eventMultiplier: 1.0, properties: { segment: "casual", fitness_level: "intermediate" } },
		{ name: "beginner", weight: 25, eventMultiplier: 0.6, properties: { segment: "beginner", fitness_level: "beginner" } },
		{ name: "social", weight: 15, eventMultiplier: 1.8, properties: { segment: "social", fitness_level: "intermediate" } },
		{ name: "trainer", weight: 8, eventMultiplier: 2.5, properties: { segment: "trainer", fitness_level: "elite" } },
	],

	// Fall Reset: app visits rise through the world event; the extra training
	// sessions are whole Workout Loop units added in the everything hook (H9)
	worldEvents: [
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
// passive events: server-side, they keep arriving after a member stops using
// the app, so they never count as activity (retention returns, "active")
const PASSIVE_EVENTS = ["notification received", "account deactivated"];
const PASSIVE_LIST = PASSIVE_EVENTS.map((x) => `'${x}'`).join(", ");
// members who joined before June 4 (no account created in the window): they do
// not lapse in the window, so their notifications read fatigue without the
// unopened notifications that keep reaching lapsed new members
const PRE_CTE = `pre AS (SELECT uid FROM ev GROUP BY 1 HAVING count(*) FILTER (WHERE event = 'account created') = 0)`;
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
		narrative: `Stride Coach launches ${AI_COACH_LAUNCH.slice(0, 10)} for Plus members (members in their ${TRIAL_DAYS}-day trial have Plus features too; their events carry subscription_tier = 'trial'). A planned workout and its completion share one coaching_mode. Adoption is per member: ${AI_ADOPTER_SHARE * 100}% of Plus members adopt it, and each adopter has their own full-use rate drawn from Beta(${AI_USE_SHAPE}, 1) (mean ${AI_ADOPTER_USE * 100}% of their workouts, so use is spread rather than all-or-nothing). Adopters' use ramps from ${AI_RAMP_FLOOR * 100}% of their full rate on launch day to their full rate after ${AI_RAMP_DAYS} days, so from then on ${AI_ADOPTER_SHARE} × ${AI_ADOPTER_USE} = ${AI_ADOPTION} of Plus and trial workouts run with coaching_mode = 'ai_coach' (adoption is salted independently of workout volume). Those sessions last ${AI_DURATION_MULT}x longer. Free-tier workouts and every pre-launch workout stay self_guided, so purity is exact. subscription_tier on each event is the member's plan at that moment.`,
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
		narrative: `A partner health-API outage (${SYNC_OUTAGE_START.slice(0, 10)} to ${SYNC_OUTAGE_END.slice(0, 10)}, exclusive) stops most smartwatch and fitness-band workouts from syncing: only ${OUTAGE_KEEP * 100}% arrive. Chest-strap, phone-tracked, and manual workouts are untouched. The partner fails requests in rotation, so each watch or band owner keeps ${OUTAGE_KEEP * 100}% of their affected workouts (a member's k-th affected workout syncs when floor((k + 1) × ${OUTAGE_KEEP} + o) passes an integer, o salted per member), not a coin flip per workout. The outage days come from the warehouse table wearable_sync_daily (sync_error_rate > 0.2); the event-side read is a ratio of ratios: smartwatch and fitness-band owners' wearable-tracked workouts per planned workout (planning happens in the app and is untouched), outage days vs the 7 days either side. The same members on the same days in numerator and denominator cancel their busy and quiet days, so the read is the keep rate.`,
		mixpanelReport: { type: "Insights", events: ["workout completed (tracking_source = wearable, wearable_type in smartwatch, fitness_band)", "workout planned (user wearable_type in smartwatch, fitness_band)"], measure: "total, formula A / B", chart: "daily line", join: "warehouse wearable_sync_daily.sync_error_rate" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
od AS (SELECT DISTINCT date::DATE AS d FROM ${WH("wearable_sync_daily")} WHERE sync_error_rate > 0.2),
own AS (SELECT distinct_id::VARCHAR AS uid FROM ${US} WHERE wearable_type IN (${OUTAGE_LIST})),
w AS (SELECT t::DATE AS d, uid, event, tracking_source FROM ev
  WHERE event IN ('workout completed', 'workout planned') AND uid IN (SELECT uid FROM own)
  AND t >= TIMESTAMP '${OUTAGE_BASE_FROM}' AND t < TIMESTAMP '${OUTAGE_BASE_TO}'),
-- control = the same members' planned workouts (planning happens in the app, so
-- the outage cannot touch it; same members and same days cancel their own
-- busy and quiet days)
g AS (SELECT (d IN (SELECT d FROM od)) AS outage,
  count(*) FILTER (WHERE event = 'workout completed' AND tracking_source = 'wearable') AS aff,
  count(*) FILTER (WHERE event = 'workout planned') AS plans, count(DISTINCT uid) AS users
  FROM w GROUP BY 1)
SELECT 'all' AS grp, (SELECT count(*) FROM od) AS outage_days, min(users) AS user_count,
 (max(aff::DOUBLE / plans) FILTER (WHERE outage)) / (max(aff::DOUBLE / plans) FILTER (WHERE NOT outage)) AS did
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
		narrative: `On ${PRICE_CHANGE.slice(0, 10)} Plus Monthly rises from $${PRICE_MONTHLY_OLD} to $${PRICE_MONTHLY_NEW}; Annual stays $${PRICE_ANNUAL}. ${MONTHLY_LOSS * 100}% of would-be monthly purchases after the change never happen. Annual is the control: the monthly/annual purchase ratio after vs before reads the ${1 - MONTHLY_LOSS} keep rate. The prices live only in the warehouse table subscription_billing_daily, so the bookings read needs the join: monthly bookings fall to ${(1 - MONTHLY_LOSS).toFixed(2)} × ${PRICE_MONTHLY_NEW}/${PRICE_MONTHLY_OLD} of trend. Purchases run at ≈30-80 a week (long-time free members rarely buy straight from the paywall), so the post-change month holds ≈200 buyers: the evidence gate is 150 buyers per side. The DiD rests on the realized plan mix on each side, which is a draw from the declared 2:1 pool (sd of the DiD ≈ 0.1, from the Poisson noise of ≈90 post-change Annual purchases): in the final run the pre-change mix is 549:270 = 2.03 and the post-change would-be mix is 112/${1 - MONTHLY_LOSS} : 88 = 1.96, so the DiD reads 0.63. Because the plan draw can move it, a knob-derived floor (1 − ${MONTHLY_LOSS}/2) backs the NAILED band and the story grades STRONG when the draw lands outside the band.`,
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
		narrative: `Summer Shred (${SUMMER_SHRED_START.slice(0, 10)} to ${SUMMER_SHRED_END.slice(0, 10)}, exclusive) buys extra members through paid social: ${SHRED_INCREMENTAL * 100}% of daily signups inside the window are campaign-driven paid-social members on top of the baseline, so total daily signups rise ${SHRED_VOLUME_LIFT.toFixed(2)}x while every other channel keeps its daily volume. Paid-social CPI bids double. The warehouse table paid_acquisition_daily follows the media plan (expected signups per day by channel, with the campaign push) and bills platform-reported installs × CPI with day noise, so spend per Mixpanel signup on paid social reads ${SHRED_CPI_MULT}x inside the campaign, up to the Poisson noise of ≈500 signups on each side. Paid-social signups are also low intent: ${PAID_SOCIAL_NO_BUY * 100}% of them never buy Plus, so their purchase rate is half that of other channels' signups from the same week (channel is drawn independently of persona; the same-week standardization removes the signup-date effect on how long members have had to buy). The read rests on ≈110 paid-social buyers, so sampling noise (sd of the ratio ≈ 0.06) and how active the buying half of paid-social members happens to be can move it to either side of ${1 - PAID_SOCIAL_NO_BUY}; the knob-derived floor ${1 - PAID_SOCIAL_NO_BUY / 2} backs the NAILED ceiling.`,
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
		narrative: `The first week sets the habit. A new member with k workouts in their first ${HABIT_DAYS} days goes completely dark after day ${HABIT_CHURN_AFTER_DAYS} with probability ${HABIT_CHURN_MAX} × (1 − k/${HABIT_SAFE_WORKOUTS}), floored at 0: 0 workouts → ${HABIT_CHURN_MAX * 100}%, ${HABIT_SAFE_WORKOUTS}+ workouts → 0%, so retention climbs with each early workout and has no cliff. Classification uses only first-week activity, so the return window never leaks into the segment. Every new member also faces organic lapse (${LAPSE_SHARE * 100}% stop on a uniform day ${LAPSE_DAY_MIN}-${LAPSE_DAY_MAX}), independent of the split, which sets realistic levels but cancels in the ratio. Week-4 retention (Mixpanel Retention, weekly unit, birth-aligned: any member-initiated event in days 28-34 after signup, signups at least 35 days before the window end; notification received and account deactivated are passive and do not count as a return, because notifications keep arriving after a member stops using the app) for ${HABIT_SAFE_WORKOUTS}+ early workouts vs 0 is at least 1/(1−${HABIT_CHURN_MAX}) = ${1 / (1 - HABIT_CHURN_MAX)}x; organic selection (busier people retain better anyway) can only push it higher, so the knob is a floor. A second read checks the curve is monotone across 0, 1-2, 3-4, and 5+.`,
		mixpanelReport: { type: "Retention", birth: "account created", return: `custom event "Active action" (every event except ${PASSIVE_EVENTS.join(" and ")})`, unit: "week", bucket: "Week 4", breakdown: "cohorts on first-week workout completed count (0 / 5+)" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
s AS (SELECT uid, t AS t0 FROM ev WHERE event = 'account created' AND t < TIMESTAMP '${TS(DATASET_END)}' - INTERVAL 35 DAY),
f AS (SELECT s.uid,
  count(*) FILTER (WHERE e.event = 'workout completed' AND e.t < s.t0 + INTERVAL ${HABIT_DAYS} DAY) AS early,
  count(*) FILTER (WHERE e.t >= s.t0 + INTERVAL 28 DAY AND e.t < s.t0 + INTERVAL 35 DAY AND e.event NOT IN (${PASSIVE_LIST})) AS w4
  FROM s JOIN ev e ON e.uid = s.uid GROUP BY 1)
SELECT CASE WHEN early = 0 THEN 'zero' WHEN early >= ${HABIT_SAFE_WORKOUTS} THEN 'safe' ELSE 'mid' END AS grp, count(*) AS user_count,
 avg((w4 > 0)::INT) AS w4_retention
FROM f GROUP BY 1`,
				},
				select: { h: { where: { grp: "safe" } }, z: { where: { grp: "zero" } } },
				expect: { metric: "h.w4_retention / z.w4_retention", op: ">=", target: 1 / (1 - HABIT_CHURN_MAX), floor: 0.9 / (1 - HABIT_CHURN_MAX) },
				// 5+ first-week workouts is a small group (≈6.5% of new members, ≈190 with a
				// Week-4 read). At ≈50% vs ≈15% retention (≈1,050 members with 0) the ratio's
				// standard error is ≈10%, so 150 members per group is enough evidence for a
				// ratio this far above its floor
				minCohort: 150,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
s AS (SELECT uid, t AS t0 FROM ev WHERE event = 'account created' AND t < TIMESTAMP '${TS(DATASET_END)}' - INTERVAL 35 DAY),
f AS (SELECT s.uid,
  count(*) FILTER (WHERE e.event = 'workout completed' AND e.t < s.t0 + INTERVAL ${HABIT_DAYS} DAY) AS early,
  count(*) FILTER (WHERE e.t >= s.t0 + INTERVAL 28 DAY AND e.t < s.t0 + INTERVAL 35 DAY AND e.event NOT IN (${PASSIVE_LIST})) AS w4
  FROM s JOIN ev e ON e.uid = s.uid GROUP BY 1),
b AS (SELECT CASE WHEN early = 0 THEN 0 WHEN early <= 2 THEN 1 WHEN early < ${HABIT_SAFE_WORKOUTS} THEN 2 ELSE 3 END AS bin, avg((w4 > 0)::INT) AS r, count(*) AS n FROM f GROUP BY 1)
SELECT 'all' AS grp, min(n) AS user_count,
 (SELECT count(*) FROM b b1 JOIN b b2 ON b2.bin = b1.bin + 1 WHERE b2.r > b1.r) AS rising_steps
FROM b`,
				},
				select: { a: { where: { grp: "all" } } },
				// 4 bins → 3 adjacent steps; the churn share falls with every bin
				expect: { metric: "a.rising_steps", op: "between", target: [3, 3] },
				minCohort: 150,
			},
		],
	},
	{
		id: "H7-team-vs-solo-challenges",
		hook: "H7",
		archetype: "funnel-conversion-by-segment",
		narrative: `Team challenges finish at ${TEAM_CONV}% per challenge and solo challenges at ${SOLO_CONV}% (two declared funnels with challenge_format props). A challenge runs for its duration_days (${CHALLENGE_DAYS.join(", ")}), so a completion lands in the last ${CHALLENGE_EARLY_SHARE * 100}% of the challenge: a 30-day challenge completes 24-30 days after the join. Team challenges are shared: members joining a team challenge of the same type and length in the same week land on one of ${TEAM_SLOTS} teams. Every challenge carries a challenge_id, so a totals funnel that holds challenge_id constant measures per-challenge completion. Joins up to ${CHALLENGE_READ_END.slice(0, 10)} (exclusive) with a 31-day conversion window give every challenge time to end inside the data. New members who lapse before a challenge ends never complete it, which trims both rates a little (they hold ≈ 12% of joins) but not their ratio, ${TEAM_CONV / SOLO_CONV}.`,
		mixpanelReport: { type: "Funnels", steps: ["challenge joined", "challenge completed"], counting: "totals", holdPropertyConstant: "challenge_id", breakdown: "challenge_format", dateRange: `${DATASET_START.slice(0, 10)} to 2026-08-31`, window: "31 days" },
		assertions: [
			{
				breakdown: {
					type: "funnelFrequency",
					steps: [{ event: "challenge joined", where: { prop: "challenge_format", op: "eq", value: "team" } }, { event: "challenge completed", where: { prop: "challenge_format", op: "eq", value: "team" } }],
					breakdownByFrequencyOf: "challenge joined",
					countMode: "totals",
					holdPropertyConstant: "challenge_id",
					conversionWindowMs: CHALLENGE_WINDOW_DAYS * DAY_MS,
					anchorRange: { fromMs: ms(DATASET_START), toMs: ms(CHALLENGE_READ_END) },
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
					conversionWindowMs: CHALLENGE_WINDOW_DAYS * DAY_MS,
					anchorRange: { fromMs: ms(DATASET_START), toMs: ms(CHALLENGE_READ_END) },
				},
				select: { c: { where: { step_index: 1 } }, e: { where: { step_index: 0 } } },
				expect: { metric: "c.conversions / e.conversions", op: "between", target: band(SOLO_CONV / 100) },
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
j AS (SELECT uid, challenge_id, challenge_format AS f, duration_days AS d, min(t) AS tj FROM ev WHERE event = 'challenge joined' GROUP BY ALL),
c AS (SELECT uid, challenge_id, min(t) AS tc FROM ev WHERE event = 'challenge completed' GROUP BY ALL),
x AS (SELECT j.*, c.tc IS NOT NULL AND c.tc > j.tj AND c.tc < j.tj + INTERVAL ${CHALLENGE_WINDOW_DAYS} DAY AS done, date_diff('second', j.tj, c.tc) / 86400.0 AS lag_days
  FROM j LEFT JOIN c USING (uid, challenge_id) WHERE j.tj < TIMESTAMP '${TS(CHALLENGE_READ_END)}')
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 avg(done::INT) FILTER (WHERE f = 'team') / avg(done::INT) FILTER (WHERE f = 'solo') AS team_vs_solo,
 count(*) FILTER (WHERE done AND (lag_days > d OR lag_days < d * ${1 - CHALLENGE_EARLY_SHARE} - 1)) AS off_schedule
FROM x`,
				},
				select: { a: { where: { grp: "all" } } },
				// lapsing new members trim both formats alike, so the ratio reads the knobs
				expect: { metric: "a.team_vs_solo", op: "between", target: band(TEAM_CONV / SOLO_CONV) },
				minCohort: 1000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
j AS (SELECT uid, challenge_id, challenge_format AS f, duration_days AS d, min(t) AS tj FROM ev WHERE event = 'challenge joined' GROUP BY ALL),
c AS (SELECT uid, challenge_id, min(t) AS tc FROM ev WHERE event = 'challenge completed' GROUP BY ALL)
SELECT 'all' AS grp, count(DISTINCT j.uid) AS user_count,
 count(*) FILTER (WHERE c.tc IS NOT NULL AND (date_diff('second', j.tj, c.tc) / 86400.0 > j.d OR date_diff('second', j.tj, c.tc) / 86400.0 < j.d * ${1 - CHALLENGE_EARLY_SHARE} - 1)) AS off_schedule
FROM j LEFT JOIN c USING (uid, challenge_id)`,
				},
				select: { a: { where: { grp: "all" } } },
				// exact: every completion lands in the last fifth of its challenge (± the engine's time of day)
				expect: { metric: "a.off_schedule", op: "between", target: [0, 0] },
			},
		],
	},
	{
		id: "H8-push-fatigue",
		hook: "H8",
		archetype: "cohort-prop-scale",
		narrative: `Notification fatigue follows recent volume. A notification opens at the organic ${PUSH_OPEN_RATE * 100}% rate (the declared pool, typical for fitness-app push) while the member received at most ${PUSH_FATIGUE_START} others in the previous ${PUSH_FATIGUE_WINDOW_DAYS} days. Past that, the chance a would-be open goes unopened ramps linearly to ${PUSH_FATIGUE_FLIP * 100}% at ${PUSH_FATIGUE_FULL} recent notifications and stays there. Pre-window members carry seeded pre-June-4 notifications at their own rate, so fatigue is already steady on June 4 and the open rate has no time trend. Notifications are server-side: they keep reaching new members after they lapse (H6), unopened, until the account is deactivated. Those unopened notifications are a lapse effect, not fatigue, so every read uses members who joined before June 4 (no account created in the window; they do not lapse in the window). Raw-export read (exact knob): their notifications sent from ${TS(FATIGUE_OBSERVABLE).slice(0, 10)} (when the whole ${PUSH_FATIGUE_WINDOW_DAYS}-day look-back is inside the data) with ${PUSH_FATIGUE_FULL}+ recent notifications open at 1 − ${PUSH_FATIGUE_FLIP} = ${(1 - PUSH_FATIGUE_FLIP).toFixed(1)} of the rate of those with ${PUSH_FATIGUE_START} or fewer. Mixpanel read: those members bucketed by notification count in the window (${PUSH_COHORTS.label}) show an open rate that falls with every bucket. Time check: pre-window members' open rate in September equals June's.`,
		mixpanelReport: { type: "Insights", event: "notification received", measure: "share with opened = true", filter: "cohort: members who did not do account created in the window", breakdown: `cohorts on notification received count in the window (${PUSH_COHORTS.label})` },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
${PRE_CTE},
n AS (SELECT uid, t, opened, count(*) OVER (PARTITION BY uid ORDER BY t RANGE BETWEEN INTERVAL ${PUSH_FATIGUE_WINDOW_DAYS} DAY PRECEDING AND CURRENT ROW) - 1 AS recent
  FROM ev WHERE event = 'notification received' AND uid IN (SELECT uid FROM pre))
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
${PRE_CTE},
n AS (SELECT uid, t, opened, count(*) OVER (PARTITION BY uid ORDER BY t RANGE BETWEEN INTERVAL ${PUSH_FATIGUE_WINDOW_DAYS} DAY PRECEDING AND CURRENT ROW) - 1 AS recent
  FROM ev WHERE event = 'notification received' AND uid IN (SELECT uid FROM pre))
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
${PRE_CTE},
m AS (SELECT uid, count(*) AS c, sum(opened::INT) AS o FROM ev WHERE event = 'notification received' AND uid IN (SELECT uid FROM pre) GROUP BY 1),
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
${PRE_CTE},
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
		narrative: `The Fall Reset program (${FALL_RESET_START.slice(0, 10)}, ${FALL_RESET_DAYS} days) multiplies training sessions by ${FALL_RESET_MULT} and app opens by ${FALL_RESET_OPEN_MULT} (a world event): members train much more and visit the app somewhat more. The extra sessions are whole Workout Loop units (the everything hook copies a plan with its workout and progress check, keeping their spacing), so follow-through holds: the share of planned workouts followed by a completed workout within ${WORKOUT_LOOP_TTC_H} h (the Workout Loop window) is the same in the program as before it. Meal logging is untouched. Ratios against the ${FALL_RESET_DAYS} days before cancel weekday mix and the overall trend: workouts per app open read ${FALL_RESET_MULT}/${FALL_RESET_OPEN_MULT} = ${(FALL_RESET_MULT / FALL_RESET_OPEN_MULT).toFixed(2)}, app opens per meal logged read ${FALL_RESET_OPEN_MULT}, and plan follow-through reads 1.`,
		mixpanelReport: { type: "Insights + Funnels", events: ["workout completed", "app opened", "meal logged"], measure: "total", chart: "daily line, formulas A/B and B/C", funnel: `workout planned → workout completed, totals, ${WORKOUT_LOOP_TTC_H}-hour window, program vs the ${FALL_RESET_DAYS} days before` },
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
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
p AS (SELECT uid, t FROM ev WHERE event = 'workout planned' AND t >= TIMESTAMP '${RESET_BASE_FROM}' AND t < TIMESTAMP '${RESET_END}'),
c AS (SELECT uid, t FROM ev WHERE event = 'workout completed'),
f AS (SELECT p.uid, (p.t >= TIMESTAMP '${TS(FALL_RESET_START)}') AS prog, coalesce(c.t <= p.t + INTERVAL ${WORKOUT_LOOP_TTC_H} HOUR, false) AS done
  FROM p ASOF LEFT JOIN c ON p.uid = c.uid AND p.t < c.t)
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 avg(done::INT) FILTER (WHERE prog) / avg(done::INT) FILTER (WHERE NOT prog) AS follow_through_ratio
FROM f`,
				},
				select: { a: { where: { grp: "all" } } },
				// extra sessions are whole units: plan → workout follow-through is unchanged (ratio 1)
				expect: { metric: "a.follow_through_ratio", op: "between", target: band(1) },
				minCohort: 2000,
			},
		],
	},
];


export default config;
