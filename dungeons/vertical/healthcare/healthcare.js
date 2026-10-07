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
 * NAME:       Clearwell Health
 * APP:        Virtual care app for adults in the US (iOS, Android). On-demand
 *             urgent care (symptom check → visit request → virtual waiting room
 *             → video or phone visit), scheduled primary care appointments,
 *             therapy with a licensed therapist, and remote monitoring programs
 *             for hypertension and diabetes with a connected blood-pressure cuff
 *             or glucometer. Prescriptions go to the patient's pharmacy. Patients
 *             pay $0 (employer benefit), an insurance copay, or a self-pay price
 *             ($79 per urgent visit → $59 from 2026-08-31). Clearwell Async (a
 *             questionnaire visit for minor conditions) launches 2026-07-15.
 * SCALE:      10,000 patients (≈3,600 sign up inside the window), ~1.1M events,
 *             120 days (2026-06-04 → 2026-10-01, UTC)
 * CORE LOOP:  symptom check completed → visit requested → visit started →
 *             visit completed → prescription sent → prescription picked up
 * VALUE MOMENT: visit completed
 *
 * EVENTS (23):
 *   health record viewed > app opened > lab results viewed > message sent
 *   > reading logged > symptom check completed > visit completed > visit started
 *   > visit requested > appointment booked > prescription sent > reminder sent
 *   > visit rated > prescription picked up > therapy session booked
 *   > therapy session completed > $experiment_started > waiting room left
 *   > account created > coverage added > appointment missed
 *   > therapy intake completed > program enrolled
 *
 * FUNNELS (7 declared; every event is a funnel step, so there is no catch-all):
 *   - Onboarding (first funnel, two copies by chronic_program): account created
 *       → coverage added (→ program enrolled for remote-monitoring patients)
 *   - Check-in (session, weight 12): app opened → health record viewed / lab
 *       results viewed / message sent (first-fixed, 50%)
 *   - Urgent Care (weight 2): a template unit (symptom check → request → waiting
 *       room left → visit started → visit completed → prescription sent →
 *       picked up → reminder sent → visit rated; engine 100%, visit_id per run).
 *       The everything hook rebuilds each visit and decides every step and gap.
 *       Carries the Prescription Pickup Reminders experiment (multipliers 1.0; the hook
 *       applies the effect).
 *   - Primary Care (weight 1): template unit (appointment booked → reminder →
 *       missed / visit started → completed → prescription → pickup → rating),
 *       rebuilt by the hook.
 *   - Readings (remote-monitoring patients only, weight 45): reading logged.
 *   - Therapy (therapy clients only, weight 3): template unit (intake → session
 *       booked → session completed), rebuilt by the hook as a weekly course.
 *
 * USER PROPS:  coverage_type, age_band, gender, preferred_language, state,
 *              chronic_program, device_connectivity, therapy_client,
 *              therapist_preference, acquisition_channel, member_since,
 *              "Experiment: Prescription Pickup Reminders" (patients in the test)
 * SUPER PROPS: coverage_type, preferred_language (stickyEventProps: on every event)
 * SCD PROPS:   none
 * GROUPS:      none
 * WAREHOUSE:   clinician_staffing_daily (clinician hours by service line, incl.
 *              agency and Spanish-speaking hours), visit_revenue_daily (billed
 *              visits, patient and payer revenue by service line and coverage)
 * LOOKUPS:     none — every attribute is denormalized onto events/profiles
 * SOUP:        Monday-heavy dayOfWeekWeights; US daytime/evening hourOfDayWeights
 *              (UTC). Primary care appointments run Monday-Saturday on US clinic
 *              hours; therapy sessions on US afternoons and evenings.
 *
 * IDENTITY: a new patient is identified at "account created" (isAuthEvent, first
 * event, user_id + device_id). One phone per patient (avgDevicePerUser 1). Every
 * event carries user_id; there is no anonymous pre-signup activity. Server-side
 * events (reminder sent, appointment missed) carry user_id only (the hook
 * removes the device fields). The two onboarding steps after signup (coverage
 * added, program enrolled) carry user_id and the device fields but no device_id
 * (engine post-auth stamping). All other events also carry device_id and the
 * engine's sticky device fields (os, model, carrier, screen, radio).
 *
 * DESIGN NOTES:
 * - Visits are rebuilt in the everything hook from the engine's Urgent Care and
 *   Primary Care runs (each run gives a slot: its start time and visit_id;
 *   templates are cloned when more steps are needed). All gaps are real: the
 *   request 2-12 min after the symptom check, a waiting room of
 *   estimated_wait_min (log-normal, longer at busy hours; the actual wait
 *   scatters around it), a video or phone visit of 4-40 min, a prescription
 *   minutes after the visit, a pickup hours to days later. Symptom checks that
 *   triage to self_care or in_person never lead to a request.
 * - Primary care appointments are booked lead_days ahead onto US clinic hours.
 *   The scheduler only offers open days (Monday-Saturday; closed on the Jul 3
 *   and Sep 7 US holidays), so closed days carry no appointments and no pile-up.
 * - Warm start: established patients have urgent and primary visits in the 21
 *   days before June 4 (same weekday and hour as a random in-window visit,
 *   shifted back whole weeks); only their in-window steps remain, so early-June
 *   pickups and appointments do not ramp from zero. Therapy is at steady state:
 *   ongoing clients' remaining sessions follow the equilibrium residual of the
 *   course length (6-16 weekly sessions), and new clients start through the
 *   window, so weekly sessions stay level. Established clients' intakes thin out
 *   through the window (density 1 → 0.35) while new patients' intakes grow, so
 *   weekly intakes and sessions stay level (±10%).
 * - New patients: 55% start their first urgent-care symptom check 5-40 minutes
 *   after signing up (they joined because they were sick). retentionCurve shapes
 *   new patients' activity; established patients are flat across the window.
 * - Repeat visits: a second urgent visit (or primary care booking) within 24 h
 *   of another moves to the patient's nearest active day (an app session with
 *   no visit of that kind within 24 h); 10% of such repeats stay (a patient who
 *   gets worse), so about 2% of symptom checks have another within 12 h.
 * - Ratings are drawn per visit from a salted hash of visit_id (same 1-5 star
 *   mix for every visit type), not from the shared random stream.
 * - Remote monitoring: readings come only from program patients; reading_type
 *   follows the program and sync_method follows device_connectivity. 15% of
 *   program patients on either device stop logging at a random time.
 * - Therapy clients with no therapy activity in the window are reset to
 *   therapy_client = false (the flag means "in therapy with Clearwell").
 * - Warehouse drift: visit_revenue_daily counts claims by posting day (about 18%
 *   of a day's visits post the next day), adds nurse-line encounters that never
 *   reach the app (≈4% ± by day), and nets out voided visits (≈2%);
 *   clinician_staffing_daily hours follow the day's demand with ±10% seeded
 *   noise plus a fixed floor (primary care is 0 on closed days); the agency
 *   share of hours varies ±12% by day around its average, and clinicians on
 *   shift divide hours by a shift length that varies ±12% around 7.5 h.
 * - Prescription Pickup Reminders exposure: the engine sends one $experiment_started per
 *   patient; the hook moves it to 1 s before the patient's first urgent-care
 *   prescription in the test, so the Experiments report counts every in-test
 *   prescription after exposure.
 * - Primary care same-day slots (lead 0) start 1-4 h after booking on the next
 *   clinic-hours quarter hour (rolling to the next day when the clinic is shut).
 * - visit rated carries visit_type, so ratings break down by video / phone / async.
 */

// ── HOOK STORIES ──
/*
 * All effects are hidden: no flag properties. Dates live in the TIMELINE
 * constants and are shared by hooks, stories, SQL, warehouse columns, and the
 * timeline guide.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H1. CLEARWELL ASYNC LAUNCH (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-07-15 urgent-care requests for minor conditions (urinary,
 *   skin_rash, pink_eye, allergy) can be async: a questionnaire a clinician
 *   reviews, no waiting room. Adoption ramps over 14 days to 50% of minor
 *   requests (per request); no async visit exists before launch or for other
 *   reasons. Async visits complete about 2.5 h after the request and never
 *   abandon.
 * MIXPANEL: Insights, visit requested, filter reason_category in the four minor
 *   reasons, breakdown visit_type, weekly; % async from Jul 29.
 * REAL WORLD: async visits take low-acuity demand out of the live queue.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H2. THE TEN-MINUTE WAITING ROOM (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: the chance a live request reaches "visit started" depends on the
 *   estimated wait shown at request: 93% up to 10 minutes, falling linearly to
 *   62% at 20 minutes, flat at 62% beyond. Patients who give up fire "waiting
 *   room left" (minutes_waited).
 * MIXPANEL: Funnels, visit requested → visit started, Totals, hold visit_id
 *   constant, 1-day window, filter visit_type ≠ async, breakdown
 *   estimated_wait_min custom buckets (≤10, 11-19, ≥20).
 * REAL WORLD: on-demand patients tolerate about ten minutes, then leave.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H3. URGENT-CARE STAFFING GAP (everything + warehouse clinician_staffing_daily;
 *     external-table join)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-08-10 to 2026-08-23 the locum agency contract lapsed: urgent
 *   care agency_clinician_hours are 0, so clinician_hours are 0.6x of plan.
 *   Urgent estimated waits are 2.2x on those days, so more patients leave (H2).
 * MIXPANEL: Insights, visit requested (visit_type ≠ async), average
 *   estimated_wait_min, daily; join clinician_staffing_daily on date.
 * REAL WORLD: a contract renewal slipping shows up as a queue, not a headline.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H4. PICKUP REMINDERS EXPERIMENT (Urgent Care funnel experiment + everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-07-28 urgent-care prescriptions are in the test, split
 *   50/50 by patient. "Text Reminders" patients get an SMS 20 h after the
 *   prescription if it is not picked up yet ("reminder sent", reminder_type
 *   rx_pickup). Pickup is 1.25x control (64% → 80%) and the time to pickup is
 *   0.7x. Exposure ($experiment_started) fires once per patient, 1 s before
 *   their first prescription in the test.
 * MIXPANEL: Funnels, prescription sent → prescription picked up, Totals, hold
 *   visit_id constant, 7-day window, filter service_line = urgent_care, Jul 28 -
 *   Sep 24, breakdown "Experiment: Prescription Pickup Reminders"; median time to convert.
 *   The Experiments report on $experiment_started reads the same prescriptions
 *   (every in-test prescription follows the exposure).
 * REAL WORLD: a large share of acute prescriptions are never picked up.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H5. BLUETOOTH DEVICES LAPSE (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 40% of remote-monitoring patients with a bluetooth device stop
 *   logging readings for good at a salted moment between 14 days after their
 *   first in-window reading and 2026-09-02. Cellular devices never lapse this
 *   way (both lose 15% to ordinary dropout).
 * MIXPANEL: cohort "did reading logged Jun 4-17"; Insights uniques of reading
 *   logged Sep 3 - Oct 1 / cohort size, breakdown device_connectivity.
 * REAL WORLD: a device that needs the phone nearby to sync quietly drops out.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H6. NO-SHOWS RISE WITH LEAD TIME (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: a primary care appointment is missed with probability
 *   0.05 + 0.012 x lead_days (5% same day, 22% at two weeks).
 * MIXPANEL: Funnels, appointment booked → appointment missed, Totals, hold
 *   visit_id constant, 30-day window, bookings Jun 4 - Aug 31, breakdown
 *   lead_days (or buckets 0-1, 2-7, 8+).
 * REAL WORLD: the further out the slot, the likelier life gets in the way.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H7. THERAPIST CHOICE SLOWS THE FIRST SESSION (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: time from therapy intake to the first session is log-normal (median
 *   96 h) for clients who take the first available therapist and 2.5x for
 *   clients who ask for a specific therapist.
 * MIXPANEL: Funnels, therapy intake completed → therapy session completed,
 *   30-day window, intakes Jun 4 - Aug 31, median time to convert, breakdown
 *   therapist_preference.
 * REAL WORLD: choice is good for fit and bad for access.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H8. SELF-PAY PRICE CUT (everything + warehouse visit_revenue_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: on 2026-08-31 the self-pay urgent visit price drops $79 → $59.
 *   Self-pay patients request a visit after a virtual-visit triage 1.35x as
 *   often (42% → 57%); insured patients do not change (72%). Revenue per
 *   self-pay symptom check is about flat: 1.35 x 59/79 = 1.01. The revenue read
 *   is confounded (staffing gap and Async ramp before the cut, respiratory
 *   season after, claim posting lag at the boundary), so it asserts >= a
 *   knob-derived floor (0.85 x 1.008) instead of a ±10% band.
 * MIXPANEL: Insights, visit requested / symptom check completed, breakdown
 *   coverage_type, before vs after Aug 31; revenue from visit_revenue_daily.
 * REAL WORLD: a price cut that buys volume, not revenue.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H9. RESPIRATORY SEASON STARTS (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-09-14 respiratory symptom checks ramp up; from 2026-09-21
 *   they run at 2.5x their summer rate relative to all other reasons (extra
 *   respiratory visits, each a full visit flow, drawn in proportion to urgent
 *   activity and placed on another active day of the same patient within 3
 *   days, never within 24 h of another urgent visit).
 * MIXPANEL: Insights, symptom check completed, breakdown reason_category,
 *   weekly; respiratory / non-respiratory, Sep 21 - Oct 1 vs Jun 4 - Sep 13.
 * REAL WORLD: school starts, and the respiratory season follows.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H10. SPANISH-SPEAKING PATIENTS WAIT LONGER (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: patients with preferred_language = es go to the Spanish-speaking
 *   clinician pool (about 8% of urgent clinician hours for about 16% of
 *   patients); their urgent-care estimated waits are 1.6x, so they abandon
 *   more (H2).
 * MIXPANEL: Insights, visit requested (visit_type ≠ async), average
 *   estimated_wait_min, breakdown preferred_language.
 * REAL WORLD: a language-concordant pool that is too small is an access gap.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * EXPECTED METRICS SUMMARY (measured: data/verify-healthcare, 2026-10-07, full fidelity,
 * 10,000 patients, 1,098,588 events)
 * ═════════════════════════════════════════════════════════════════════════
 * Hook | Metric                                         | Derivation               | Expected | Measured
 * -----|------------------------------------------------|--------------------------|----------|---------
 * H1   | async share of minor-reason requests, Jul 29+  | ASYNC_SHARE              | 0.50     | 0.511 (1,886 of 3,690)
 * H1   | async requests before launch / other reasons   | exact purity             | 0 / 0    | 0 / 0
 * H2   | start rate, est wait ≥20 / ≤10 min             | 0.62 / 0.93              | 0.667    | 0.663 (61.8% vs 93.3%)
 * H2   | start rate, est wait ≤10 min                   | START_RATE_SHORT         | 0.93     | 0.933
 * H3   | avg est wait, gap days / ±14 days              | GAP_WAIT_MULT            | 2.20     | 2.206 (23.9 vs 10.8 min)
 * H3   | urgent clinician hours per request, gap / base | 1 − agency share 0.4     | 0.60     | 0.633
 * H4   | pickup within 7 d, Text Reminders / Control    | REMINDER_PICKUP_MULT     | 1.25     | 1.250 (80.3% vs 64.3%)
 * H4   | median hours to pickup, variant / control      | REMINDER_DELAY_MULT      | 0.70     | 0.695 (14.1 vs 20.3 h)
 * H4   | variant share of exposed patients              | equal 2-arm hash         | 0.50     | 0.501 (1,875 of 3,741)
 * H4   | rx_pickup reminders in Control or pre-test     | exact purity             | 0        | 0
 * H5   | still logging Sep 3+, bluetooth / cellular     | 1 − BT_LAPSE_SHARE       | 0.60     | 0.613 (55.4% vs 90.4%)
 * H6   | no-show slope per lead day                     | NOSHOW_PER_DAY           | 0.012    | 0.0121
 * H6   | no-show rate, lead 8+ days                     | LEAD_WEIGHTS mix of line | 0.2013   | 0.2048
 * H7   | median hours to 1st session, specific / first  | SPECIFIC_THERAPIST_MULT  | 2.50     | 2.581 (247 vs 96 h)
 * H7   | median hours to 1st session, first_available   | THERAPY_FIRST_MEDIAN_H   | 96       | 95.8
 * H8   | self-pay requests per check, after / before    | SELF_PAY_LIFT            | 1.35     | 1.400 (49.7% vs 35.5%)
 * H8   | insured requests per check, after / before     | unchanged                | 1.00     | 1.010
 * H8   | self-pay urgent revenue per check (warehouse)  | 1.35 × 59/79, floor 0.857| 1.008    | 1.078 ($26.85 vs $24.90)
 * H9   | respiratory / other checks, Sep 21+ vs summer  | RESP_WAVE_MULT           | 2.50     | 2.455
 * H10  | avg est wait, es / en                          | SPANISH_WAIT_MULT        | 1.60     | 1.572 (17.6 vs 11.2 min)
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Noise notes: H8's after period has about 1,900 self-pay symptom checks
 * (relative SE of the request-rate ratio about 4%); its revenue read also moves
 * with completion (the staffing gap falls in the before period, Async ramps in
 * it) and with claim posting lag at the Aug 31 boundary, hence the floor. H7
 * rests on about 230 specific-therapist first sessions (relative SE of the
 * median ratio about 5%). H4's median-time ratio rests on about 1,400 control
 * and 1,800 variant pickups (SE about 0.03). H6's slope has SE ≈ 0.0007 (the
 * ±10% band is about ±1.7 SE), so its single-ref reads carry a knob-derived
 * floor (0.8 x knob) and a read past the far edge grades STRONG. Repeat
 * symptom checks within 12 h: 2.2% in every period (summer, ramp, peak).
 * Warehouse audits: clinician_staffing_daily corr 0.963, visit_revenue_daily
 * corr 0.963. Null checks (eval Q14, Q15): Async vs live ratings z = −0.67
 * (sub-splits |z| ≤ 1.46); insured requests per check before/after z = 1.05
 * (per coverage |z| ≤ 1.07).
 */

// ── SCALE ──
const SEED = "dm4-healthcare";
const NUM_USERS = 10_000;
const DATASET_START = "2026-06-04T00:00:00Z";
const DATASET_END = "2026-10-01T23:59:59Z"; // 120 days
const EVENTS_PER_DAY = 1.2;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── TIMELINE (shared by hooks, stories, SQL, warehouse columns, guides) ──
const ASYNC_LAUNCH = "2026-07-15T00:00:00Z";          // Clearwell Async launches for minor conditions
const PICKUP_TEST_START = "2026-07-28T00:00:00Z";     // "Prescription Pickup Reminders" A/B test starts
const STAFFING_GAP_START = "2026-08-10T00:00:00Z";    // locum agency contract lapses (urgent care)
const STAFFING_GAP_END = "2026-08-24T00:00:00Z";      // exclusive: new agency live Aug 24
const SELF_PAY_PRICE_CHANGE = "2026-08-31T00:00:00Z"; // self-pay urgent visit $79 → $59
const RESP_WAVE_START = "2026-09-14T00:00:00Z";       // respiratory season ramp begins
const RESP_WAVE_PEAK = "2026-09-21T00:00:00Z";        // respiratory demand at full level
const CLINIC_HOLIDAYS = ["2026-07-03", "2026-09-07"]; // primary care closed (US holidays)

const ms = (iso) => dayjs.utc(iso).valueOf();
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;
const WINDOW_DAYS = 120;

// ── WEEKLY AND DAILY RHYTHM (soup) ──
// Sun..Sat. Monday is the busiest care day (weekend symptoms plus offices
// reopening); Saturday is the quietest.
const DOW_WEIGHTS = [0.92, 1.22, 1.08, 1.02, 1.0, 0.94, 0.82];
// UTC hours. Patients are in US time zones: 7am-11pm local is about 11-07 UTC.
const HOUR_WEIGHTS = [0.85, 0.72, 0.58, 0.42, 0.28, 0.18, 0.13, 0.11, 0.11, 0.15, 0.26, 0.45,
	0.66, 0.86, 1.0, 1.0, 0.97, 0.94, 0.92, 0.9, 0.9, 0.92, 0.95, 0.92];
const HOUR_MAX = Math.max(...HOUR_WEIGHTS);
// primary care appointment start hours (UTC), US clinic day
const APPT_HOURS = { 13: 6, 14: 9, 15: 10, 16: 10, 17: 9, 18: 9, 19: 9, 20: 9, 21: 8, 22: 6, 23: 4 };
// therapy session start hours (UTC), US afternoons and evenings
const THERAPY_HOURS = { 14: 4, 15: 6, 16: 7, 17: 7, 18: 7, 19: 7, 20: 7, 21: 8, 22: 9, 23: 10, 0: 10, 1: 8, 2: 5 };

// ── KNOBS ──
// H1 Clearwell Async
const ASYNC_SHARE = 0.5;             // share of minor-condition requests that go async once adoption is ramped
const ASYNC_RAMP_DAYS = 14;
const MINOR_REASONS = ["urinary", "skin_rash", "pink_eye", "allergy"];
const ASYNC_REVIEW_MEDIAN_H = 2.5;   // request → async visit completed

// H2 waiting-room threshold: start rate by estimated wait (piecewise linear)
const PATIENT_WAIT_MIN = 10;         // up to here patients wait
const GIVE_UP_WAIT_MIN = 20;         // from here the start rate is flat at the low level
const START_RATE_SHORT = 0.93;
const START_RATE_LONG = 0.62;
const WAIT_MEDIAN_MIN = 7;           // urgent-care estimated wait median at an average hour
const WAIT_SIGMA = 0.6;

// H3 staffing gap
const GAP_WAIT_MULT = 2.2;
const AGENCY_HOURS_SHARE = { urgent_care: 0.4, primary_care: 0.1, behavioral_health: 0 };

// H4 Prescription Pickup Reminders experiment
const PICKUP_EXPERIMENT = "Prescription Pickup Reminders";
const PICKUP_VARIANT = "Text Reminders";
const EXP_KEY = `Experiment: ${PICKUP_EXPERIMENT}`;
const PICKUP_BASE = 0.64;            // share of prescriptions picked up (control)
const REMINDER_PICKUP_MULT = 1.25;
const REMINDER_DELAY_MULT = 0.7;     // prescription → pickup time
const PICKUP_MEDIAN_H = 20;
const PICKUP_SIGMA = 0.9;
const PICKUP_MAX_H = 240;
const REMINDER_AFTER_H = 20;

// H5 bluetooth lapse
const BT_LAPSE_SHARE = 0.4;
const LAPSE_FROM_DAYS = 14;
const LAPSE_LAST = "2026-09-02T00:00:00Z";
const CELLULAR_SHARE = 0.45;         // of monitoring-program patients
const PROGRAM_DROPOUT_SHARE = 0.15;  // realism: any device, members who stop logging during the window

// H6 no-shows by lead time
const NOSHOW_BASE = 0.05;
const NOSHOW_PER_DAY = 0.012;
const LEAD_WEIGHTS = [6, 12, 12, 10, 9, 8, 7, 7, 5, 4, 4, 3, 3, 3, 4, 2, 2, 2, 1, 1, 1, 1]; // lead_days 0..21

// H7 therapy first session
const THERAPY_FIRST_MEDIAN_H = 96;
const THERAPY_FIRST_SIGMA = 0.45;
const SPECIFIC_THERAPIST_MULT = 2.5;
const THERAPY_CLIENT_SHARE = 0.18;
const SPECIFIC_THERAPIST_SHARE = 0.35;
const THERAPY_NEW_SHARE = 0.5;        // established therapy clients who start therapy in the window (steady state: ongoing = weekly starts x mean course)
const THERAPY_EST_DECLINE = 0.65;     // established clients' intake density falls from 1 to 0.35 across the window
const THERAPY_COURSE_MIN = 6;
const THERAPY_COURSE_MAX = 16;
const THERAPY_FIRST_NOSHOW = 0.08;
const THERAPY_ATTEND = 0.9;

// H8 self-pay price cut
const SELF_PAY_PRICE = [79, 59];     // urgent visit, before / from the change
const REQUEST_RATE_INSURED = 0.72;   // visit requests per symptom check routed to a virtual visit
const REQUEST_RATE_SELF_PAY = 0.42;
const SELF_PAY_LIFT = 1.35;

// H9 respiratory season
const REASON_WEIGHTS = { respiratory: 20, urinary: 10, skin_rash: 11, pink_eye: 4, allergy: 8, stomach: 11, minor_injury: 7, headache: 10, back_pain: 9, other: 10 };
const S_RESP = REASON_WEIGHTS.respiratory / Object.values(REASON_WEIGHTS).reduce((a, b) => a + b, 0);
const RESP_WAVE_MULT = 2.5;
const RESP_SPREAD_DAYS = 3;         // an extra respiratory visit lands within this many days of the visit it is drawn from

// H10 Spanish-language routing
const SPANISH_WAIT_MULT = 1.6;
const SPANISH_SHARE = 0.16;
const SPANISH_HOURS_SHARE = { urgent_care: 0.08, primary_care: 0.12, behavioral_health: 0.1 };

// realism (not stories)
const TRIAGE_WEIGHTS = { virtual_visit: 86, self_care: 9, in_person: 5 };
const RX_RATE = { respiratory: 0.45, urinary: 0.88, skin_rash: 0.6, pink_eye: 0.8, allergy: 0.55, stomach: 0.4, minor_injury: 0.3, headache: 0.35, back_pain: 0.45, other: 0.3 };
const PRIMARY_RX_RATE = 0.4;
const MEDS = {
	respiratory: ["antibiotic", "antiviral", "inhaler", "cough_suppressant"],
	urinary: ["antibiotic"],
	skin_rash: ["topical_steroid", "antifungal", "antihistamine"],
	pink_eye: ["antibiotic_eye_drops"],
	allergy: ["antihistamine", "nasal_steroid"],
	stomach: ["antiemetic", "acid_reducer"],
	minor_injury: ["nsaid", "muscle_relaxant"],
	headache: ["nsaid", "triptan"],
	back_pain: ["nsaid", "muscle_relaxant"],
	other: ["nsaid", "antihistamine"],
	primary: ["blood_pressure", "diabetes", "cholesterol", "thyroid", "antidepressant", "other_refill"],
};
const RATING_WEIGHTS = { 1: 4, 2: 6, 3: 14, 4: 32, 5: 44 };
const PHARMACY_WEIGHTS = { chain: 65, grocery: 20, independent: 15 };
const PREWINDOW_DAYS = 21;
const BORN_FIRST_VISIT_SHARE = 0.55;
const REPEAT_KEEP = 0.1;             // share of second visits of a kind within 24 h that really happen (the rest move to another day)
const BORN_PCT = 35;

// warehouse economics
const HOURS_PER_DEMAND = { urgent_care: 0.55, primary_care: 0.8, behavioral_health: 1.05 }; // clinician hours per unit of demand (incl. charting, idle)
const HOURS_NOISE = 0.1;
const AGENCY_SHARE_NOISE = 0.12;     // day-level spread of the agency share around its average
const SHIFT_HOURS = 7.5;             // average clinician hours per shift
const NURSE_LINE_SHARE = 0.04;       // billed encounters from the nurse phone line (not in the app)
const VOID_SHARE = 0.02;
const POSTING_LAG_SHARE = 0.18;     // mean share of a day's visits whose claims post the next day
const billingCarry = new Map();      // per series: visits carried to the next posting day
const PAYER_RATE = { // contracted payer reimbursement per visit, USD
	urgent_care: { employer: 0, commercial: 68, medicare: 52, medicaid: 38, self_pay: 0 },
	primary_care: { employer: 0, commercial: 105, medicare: 88, medicaid: 62, self_pay: 0 },
	behavioral_health: { employer: 0, commercial: 95, medicare: 80, medicaid: 60, self_pay: 0 },
};
const SELF_PAY_LIST = { primary_care: 99, behavioral_health: 120 };
const COPAY_BY_PLAN = { commercial: [0, 10, 25, 40], medicare: [0, 0, 15], medicaid: [0], employer: [0] };

// ── DATA ──
const STATES_EN = { CA: 14, TX: 10, FL: 9, NY: 8, IL: 6, PA: 6, OH: 5, GA: 5, NC: 5, MI: 4, WA: 4, AZ: 4, CO: 4, MA: 4, VA: 4, NJ: 4, TN: 4 };
const STATES_ES = { CA: 26, TX: 24, FL: 16, NY: 8, AZ: 7, IL: 6, NJ: 5, CO: 4, GA: 2, NC: 2 };

// ── HELPERS ──
const salt = (uid, tag) => hashFloat(`${uid}|${tag}`);
const T = (e) => dayjs.utc(e.time).valueOf();
const iso = (t) => new Date(Math.round(t)).toISOString();
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const dayStart = (t) => Math.floor(t / DAY_MS) * DAY_MS;
const round2 = (n) => Math.round(n * 100) / 100;
const logNormal = (sigma) => Math.exp(chance.normal({ mean: 0, dev: sigma }));
const jitter = (key, spread) => 1 + (hashFloat(key) - 0.5) * 2 * spread;
const rand = () => chance.floating({ min: 0, max: 1 });
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
const inGap = (t) => t >= ms(STAFFING_GAP_START) && t < ms(STAFFING_GAP_END);
const selfPayPrice = (t) => SELF_PAY_PRICE[t >= ms(SELF_PAY_PRICE_CHANGE) ? 1 : 0];
const startRate = (w) => (w <= PATIENT_WAIT_MIN ? START_RATE_SHORT
	: w >= GIVE_UP_WAIT_MIN ? START_RATE_LONG
		: START_RATE_SHORT + (START_RATE_LONG - START_RATE_SHORT) * (w - PATIENT_WAIT_MIN) / (GIVE_UP_WAIT_MIN - PATIENT_WAIT_MIN));
const asyncShare = (t) => (t < ms(ASYNC_LAUNCH) ? 0 : ASYNC_SHARE * Math.min(1, (t - ms(ASYNC_LAUNCH)) / (ASYNC_RAMP_DAYS * DAY_MS)));
const waveRamp = (t) => (t < ms(RESP_WAVE_START) ? 0 : Math.min(1, (t - ms(RESP_WAVE_START)) / (ms(RESP_WAVE_PEAK) - ms(RESP_WAVE_START))));
const noShowRate = (lead) => NOSHOW_BASE + NOSHOW_PER_DAY * lead;
const isClinicClosed = (t) => CLINIC_HOLIDAYS.includes(dayKey(t)) || new Date(t).getUTCDay() === 0;
const LEAD_TABLE = Object.fromEntries(LEAD_WEIGHTS.map((w, i) => [i, w]));
// sessions left for a client mid-course: P(left = j) ∝ P(course ≥ j) (equilibrium residual)
const RESIDUAL_WEIGHTS = Object.fromEntries(Array.from({ length: THERAPY_COURSE_MAX }, (_, i) => {
	const j = i + 1;
	return [j, Math.round(1000 * Math.min(1, (THERAPY_COURSE_MAX + 1 - j) / (THERAPY_COURSE_MAX - THERAPY_COURSE_MIN + 1)))];
}));
// a time at one of the allowed UTC hours, on the same UTC day as t (quarter-hour starts)
const atHour = (t, hoursObj) => dayStart(t) + Number(pickWeighted(hoursObj, rand())) * HOUR_MS + chance.integer({ min: 0, max: 3 }) * 15 * MIN_MS;
// the allowed half-hour start nearest to t (keeps the gap it was given within a few hours)
const nearestHour = (t, hoursObj) => {
	const allowed = Object.keys(hoursObj).map(Number);
	let best = t, bestD = Infinity;
	for (let d = -1; d <= 1; d++) {
		for (const h of allowed) {
			for (const m of [0, 30]) {
				const c = dayStart(t) + d * DAY_MS + h * HOUR_MS + m * MIN_MS;
				const dist = Math.abs(c - t);
				if (dist < bestD) { bestD = dist; best = c; }
			}
		}
	}
	return best;
};

// the first quarter-hour start at or after t inside the clinic hours (rolls to the next day)
const nextApptStart = (t) => {
	let c = Math.ceil(t / (15 * MIN_MS)) * 15 * MIN_MS;
	while (APPT_HOURS[new Date(c).getUTCHours()] === undefined) c += 15 * MIN_MS;
	return c;
};

const URGENT_STEPS = ["symptom check completed", "visit requested", "waiting room left", "visit started", "visit completed", "prescription sent", "prescription picked up", "reminder sent", "visit rated"];
const PRIMARY_STEPS = ["appointment booked", "reminder sent", "appointment missed", "visit started", "visit completed", "prescription sent", "prescription picked up", "visit rated"];
const UNIT_EVENTS = new Set([...URGENT_STEPS, ...PRIMARY_STEPS]);
const ONBOARDING = new Set(["account created", "coverage added", "program enrolled"]);
const THERAPY_STEPS = new Set(["therapy intake completed", "therapy session booked", "therapy session completed"]);
const DEVICE_KEYS = ["device_id", "os", "model", "screen_height", "screen_width", "carrier", "radio", "wifi", "manufacturer", "brand", "app_version_string"];
const stripDevice = (e) => { if (e) for (const k of DEVICE_KEYS) delete e[k]; };

function handleUserHook(profile, meta) {
	const uid = profile.distinct_id;
	const chronic = profile.chronic_program && profile.chronic_program !== "none";
	// monitoring-program patients skew older
	if (chronic) profile.age_band = pickWeighted({ "26-35": 6, "36-45": 14, "46-55": 26, "56-64": 28, "65+": 26 }, salt(uid, "age"));
	profile.coverage_type = profile.age_band === "65+"
		? pickWeighted({ medicare: 82, commercial: 8, self_pay: 6, medicaid: 4 }, salt(uid, "coverage"))
		: pickWeighted({ employer: 40, commercial: 30, medicaid: 12, self_pay: 18 }, salt(uid, "coverage"));
	profile.preferred_language = salt(uid, "language") < SPANISH_SHARE ? "es" : "en";
	profile.state = pickWeighted(profile.preferred_language === "es" ? STATES_ES : STATES_EN, salt(uid, "state"));
	profile.device_connectivity = chronic ? (salt(uid, "device") < CELLULAR_SHARE ? "cellular" : "bluetooth") : "none";
	profile.therapy_client = salt(uid, "therapy") < THERAPY_CLIENT_SHARE;
	profile.therapist_preference = profile.therapy_client
		? (salt(uid, "therapist") < SPECIFIC_THERAPIST_SHARE ? "specific_therapist" : "first_available")
		: "none";
	profile.acquisition_channel = profile.coverage_type === "employer"
		? pickWeighted({ employer_benefit: 70, organic: 15, google_search: 10, meta_ads: 5 }, salt(uid, "channel"))
		: pickWeighted({ organic: 30, google_search: 30, meta_ads: 18, insurer_referral: 14, clinician_referral: 8 }, salt(uid, "channel"));
	if (meta.userIsBornInDataset) {
		profile.member_since = dayKey(dayjs.utc(profile.created ?? meta.user.created).valueOf());
	} else {
		const tenureDays = Math.floor(salt(uid, "tenure") * (ms("2026-05-01T00:00:00Z") - ms("2023-03-01T00:00:00Z")) / DAY_MS);
		profile.member_since = dayjs.utc("2023-03-01T00:00:00Z").add(tenureDays, "day").format("YYYY-MM-DD");
	}
	return profile;
}

function estimatedWait(t, profile) {
	const h = new Date(t).getUTCHours();
	const hourFactor = 0.7 + 0.6 * HOUR_WEIGHTS[h] / HOUR_MAX;
	let w = WAIT_MEDIAN_MIN * logNormal(WAIT_SIGMA) * hourFactor;
	if (inGap(t)) w *= GAP_WAIT_MULT;
	if (profile.preferred_language === "es") w *= SPANISH_WAIT_MULT;
	return Math.max(1, Math.min(180, Math.round(w)));
}

function patientCost(profile, serviceLine, t) {
	const cov = profile.coverage_type;
	if (cov === "self_pay") return serviceLine === "urgent_care" ? selfPayPrice(t) : SELF_PAY_LIST[serviceLine];
	const plans = COPAY_BY_PLAN[cov] || [0];
	return plans[Math.floor(salt(profile.distinct_id, "copay") * plans.length)];
}

function handleEverything(events, meta) {
	if (!events.length) return events;
	const profile = meta.profile;
	const uid = profile.distinct_id;
	const BEGIN = ms(DATASET_START), END = ms(DATASET_END);
	const signup = events.find((e) => e.event === "account created");
	const birthMs = signup ? T(signup) : null;
	const variant = profile[EXP_KEY] !== undefined ? profile[EXP_KEY] : null;

	// ── templates and engine units ──
	const templates = {};
	const units = new Map(); // visit_id → { kind, src: {event: ev} }
	const exposures = [];
	const therapyRuns = [];
	const readings = [];
	const keep = [];
	for (const e of events) {
		if (!templates[e.event]) templates[e.event] = { ...e };
		if (e.event === "$experiment_started") { exposures.push(e); continue; }
		if (UNIT_EVENTS.has(e.event) && e.visit_id) {
			if (!units.has(e.visit_id)) units.set(e.visit_id, { src: {} });
			const un = units.get(e.visit_id);
			if (!un.src[e.event]) un.src[e.event] = e;
			if (e.event === "symptom check completed") un.kind = "urgent";
			if (e.event === "appointment booked") un.kind = "primary";
			continue;
		}
		if (THERAPY_STEPS.has(e.event)) { if (e.event === "therapy intake completed" && T(e) >= BEGIN) therapyRuns.push(T(e)); continue; }
		if (e.event === "reading logged") { readings.push(e); continue; }
		keep.push(e);
	}

	// ── slots: one per visit ──
	const slots = [];
	for (const [id, un] of units) {
		if (!un.kind) continue;
		const first = un.kind === "urgent" ? un.src["symptom check completed"] : un.src["appointment booked"];
		slots.push({ kind: un.kind, t0: T(first), id, src: un.src, reason: un.kind === "urgent" ? first.reason_category : null });
	}
	slots.sort((a, b) => a.t0 - b.t0);
	const urgentIn = slots.filter((s) => s.kind === "urgent");
	const primaryIn = slots.filter((s) => s.kind === "primary");

	// new patients: many start their first symptom check right after signing up
	if (birthMs && urgentIn.length && salt(uid, "first-visit") < BORN_FIRST_VISIT_SHARE) {
		urgentIn[0].t0 = birthMs + chance.integer({ min: 5, max: 40 }) * MIN_MS;
	}

	// realism: a patient rarely needs two urgent visits, or books two primary care
	// appointments, within a day. A slot within 24 h of another of its kind moves to
	// the nearest active day (an app session with no visit of that kind within
	// 24 h); with no such day the visit does not happen.
	const anchors = keep.filter((e) => !ONBOARDING.has(e.event)).map(T).filter((t) => t >= BEGIN && t <= END - 2 * HOUR_MS).sort((a, b) => a - b);
	const isFree = (t, busy) => busy.every((b) => Math.abs(b - t) >= DAY_MS);
	const nearestFree = (target, lo, hi, busy) => {
		let best = null, bestD = Infinity;
		for (const a of anchors) {
			if (a < lo || a > hi) continue;
			const d = Math.abs(a - target);
			if (d < bestD && isFree(a, busy)) { best = a; bestD = d; }
		}
		return best === null ? null : best + chance.integer({ min: 1, max: 6 }) * MIN_MS;
	};
	const spreadOut = (list, busy) => {
		const kept = [];
		for (const s of list) {
			if (s.t0 < BEGIN || isFree(s.t0, busy) || rand() < REPEAT_KEEP) { busy.push(s.t0); kept.push(s); continue; }
			const t = nearestFree(s.t0, birthMs ?? BEGIN, END - 2 * HOUR_MS, busy);
			if (t === null) { s.drop = true; continue; }
			s.t0 = t;
			busy.push(t);
			kept.push(s);
		}
		return kept;
	};
	const urgentBusy = [];
	const urgentKept = spreadOut(urgentIn, urgentBusy);
	const primaryKept = spreadOut(primaryIn, []);

	// warm start: established patients have visits in the 3 weeks before June 4
	if (!signup) {
		for (const [list, kind] of [[urgentKept, "urgent"], [primaryKept, "primary"]]) {
			if (!list.length) continue;
			const x = list.length * PREWINDOW_DAYS / WINDOW_DAYS;
			const n = Math.floor(x) + (rand() < x % 1 ? 1 : 0);
			for (let i = 0; i < n; i++) {
				const ref = list[chance.integer({ min: 0, max: list.length - 1 })];
				const weeks = Math.floor((ref.t0 - BEGIN) / (7 * DAY_MS)) + chance.integer({ min: 1, max: 3 });
				const t0 = ref.t0 - weeks * 7 * DAY_MS;
				slots.push({ kind, t0, id: null, src: null, reason: kind === "urgent" ? pickWeighted(REASON_WEIGHTS, rand()) : null, pre: true });
			}
		}
	}

	// H9: respiratory season — extra respiratory urgent visits in proportion to
	// urgent activity, each on another active day of the same patient (no urgent
	// visit within 24 h), within a few days of the visit it is drawn from
	for (const s of urgentKept) {
		const r = waveRamp(s.t0);
		if (r <= 0) continue;
		const x = (RESP_WAVE_MULT - 1) * S_RESP * r;
		const n = Math.floor(x) + (rand() < x % 1 ? 1 : 0);
		for (let i = 0; i < n; i++) {
			const lo = Math.max(ms(RESP_WAVE_START), birthMs ?? BEGIN), hi = END - 2 * HOUR_MS;
			const target = s.t0 + chance.floating({ min: -RESP_SPREAD_DAYS, max: RESP_SPREAD_DAYS }) * DAY_MS;
			let t0 = nearestFree(target, lo, hi, urgentBusy);
			if (t0 === null) {
				// no app session on a free day: the patient opens the app to check symptoms
				for (const d of chance.shuffle([-3, -2, -1, 1, 2, 3])) {
					const c = s.t0 + d * DAY_MS;
					if (c >= lo && c <= hi && isFree(c, urgentBusy)) { t0 = c; break; }
				}
			}
			if (t0 === null) continue;
			urgentBusy.push(t0);
			slots.push({ kind: "urgent", t0, id: null, src: null, reason: "respiratory", extra: true });
		}
	}

	// ── materialize visits ──
	const out = [];
	let firstTestRx = Infinity; // H4: the patient's first prescription in the test

	function afterVisit(put, vid, serviceLine, visitType, tDone, reason, tReq) {
		const rxP = serviceLine === "urgent_care" ? RX_RATE[reason] ?? 0.3 : PRIMARY_RX_RATE;
		// ratings are the same for every visit type: salted per visit, so they do not
		// ride on the shared random stream
		if (hashFloat(`${vid}|rated`) < 0.35) {
			put("visit rated", tDone + chance.integer({ min: 2, max: 90 }) * MIN_MS, {
				service_line: serviceLine,
				visit_type: visitType,
				rating: Number(pickWeighted(RATING_WEIGHTS, hashFloat(`${vid}|stars`))),
				would_recommend: hashFloat(`${vid}|recommend`) < 0.82,
			});
		}
		if (rand() >= rxP) return;
		const tRx = tDone + chance.integer({ min: 3, max: 25 }) * MIN_MS;
		const meds = MEDS[serviceLine === "urgent_care" ? reason : "primary"] || MEDS.other;
		const pharmacy = pickWeighted(PHARMACY_WEIGHTS, rand());
		const rxEv = put("prescription sent", tRx, { service_line: serviceLine, medication_class: meds[chance.integer({ min: 0, max: meds.length - 1 })], pharmacy_type: pharmacy });
		// H4: urgent-care prescriptions from requests on or after the test start are in the test
		const inTest = serviceLine === "urgent_care" && variant !== null && tReq >= ms(PICKUP_TEST_START) && exposures.length > 0;
		const isReminder = inTest && variant === PICKUP_VARIANT;
		if (inTest && rxEv) firstTestRx = Math.min(firstTestRx, tRx);
		const picked = rand() < PICKUP_BASE * (isReminder ? REMINDER_PICKUP_MULT : 1);
		const delayH = Math.min(PICKUP_MAX_H, PICKUP_MEDIAN_H * logNormal(PICKUP_SIGMA) * (isReminder ? REMINDER_DELAY_MULT : 1));
		if (isReminder && (!picked || delayH > REMINDER_AFTER_H)) {
			stripDevice(put("reminder sent", tRx + REMINDER_AFTER_H * HOUR_MS, { reminder_type: "rx_pickup", channel: "sms" }));
		}
		if (picked) put("prescription picked up", tRx + delayH * HOUR_MS, { service_line: serviceLine, pharmacy_type: pharmacy });
	}

	function buildUrgent(s, put) {
		const reason = s.reason || "other";
		const triage = pickWeighted(TRIAGE_WEIGHTS, rand());
		put("symptom check completed", s.t0, { reason_category: reason, triage_result: triage });
		if (triage !== "virtual_visit") return;
		const selfPay = profile.coverage_type === "self_pay";
		const pReq = selfPay ? REQUEST_RATE_SELF_PAY * (s.t0 >= ms(SELF_PAY_PRICE_CHANGE) ? SELF_PAY_LIFT : 1) : REQUEST_RATE_INSURED;
		if (rand() >= pReq) return;
		const tReq = s.t0 + chance.integer({ min: 2, max: 12 }) * MIN_MS;
		const isAsync = MINOR_REASONS.includes(reason) && rand() < asyncShare(tReq);
		const visitType = isAsync ? "async" : (rand() < 0.72 ? "video" : "phone");
		const base = { service_line: "urgent_care", visit_type: visitType, reason_category: reason };
		let tDone;
		if (isAsync) {
			put("visit requested", tReq, { ...base, estimated_wait_min: 0, patient_cost_usd: patientCost(profile, "urgent_care", tReq) });
			tDone = tReq + Math.min(20, Math.max(0.5, ASYNC_REVIEW_MEDIAN_H * logNormal(0.6))) * HOUR_MS;
			put("visit completed", tDone, { ...base, duration_min: chance.integer({ min: 3, max: 9 }), clinician_type: pickWeighted({ nurse_practitioner: 70, physician_assistant: 20, physician: 10 }, rand()) });
		} else {
			const est = estimatedWait(tReq, profile);
			put("visit requested", tReq, { ...base, estimated_wait_min: est, patient_cost_usd: patientCost(profile, "urgent_care", tReq) });
			// H2: the start rate depends on the estimated wait
			if (rand() >= startRate(est)) {
				const waited = Math.max(1, Math.round(est * chance.floating({ min: 0.3, max: 1.2 })));
				put("waiting room left", tReq + waited * MIN_MS + chance.integer({ min: 0, max: 59 }) * 1000, { service_line: "urgent_care", minutes_waited: waited });
				return;
			}
			const actual = Math.max(1, Math.round(est * logNormal(0.25)));
			const tStart = tReq + actual * MIN_MS + chance.integer({ min: 0, max: 59 }) * 1000;
			put("visit started", tStart, { service_line: "urgent_care", visit_type: visitType, wait_min: actual });
			const dur = Math.max(4, Math.min(40, Math.round((visitType === "video" ? 11 : 8) * logNormal(0.35))));
			tDone = tStart + dur * MIN_MS;
			put("visit completed", tDone, { ...base, duration_min: dur, clinician_type: pickWeighted({ nurse_practitioner: 45, physician: 35, physician_assistant: 20 }, rand()) });
		}
		afterVisit(put, s.vid, "urgent_care", visitType, tDone, reason, tReq);
	}

	function buildPrimary(s, put) {
		// the scheduler offers open days only (closed Sundays and US holidays):
		// a closed day is never chosen, so the patient picks another lead time
		const pickSlot = () => {
			const l = Number(pickWeighted(LEAD_TABLE, rand()));
			return l === 0
				? nextApptStart(s.t0 + chance.integer({ min: 60, max: 240 }) * MIN_MS)
				: atHour(dayStart(s.t0) + l * DAY_MS, APPT_HOURS);
		};
		let apptT = pickSlot();
		for (let tries = 0; tries < 20 && isClinicClosed(apptT); tries++) apptT = pickSlot();
		while (isClinicClosed(apptT)) apptT += DAY_MS;
		const lead = Math.round((dayStart(apptT) - dayStart(s.t0)) / DAY_MS);
		const visitType = rand() < 0.8 ? "video" : "phone";
		const reason = pickWeighted({ annual_checkup: 22, chronic_followup: 26, medication_review: 20, new_concern: 22, lab_review: 10 }, rand());
		put("appointment booked", s.t0, { service_line: "primary_care", appointment_reason: reason, visit_type: visitType, lead_days: lead, patient_cost_usd: patientCost(profile, "primary_care", s.t0) });
		if (lead >= 1 && apptT - DAY_MS > s.t0) {
			stripDevice(put("reminder sent", apptT - DAY_MS, { reminder_type: "appointment", channel: rand() < 0.6 ? "sms" : "push" }));
		}
		// H6: the no-show chance rises with lead time
		if (rand() < noShowRate(lead)) {
			stripDevice(put("appointment missed", apptT + 15 * MIN_MS, { service_line: "primary_care", lead_days: lead }));
			return;
		}
		const wait = chance.integer({ min: 0, max: 8 });
		const tStart = apptT + wait * MIN_MS + chance.integer({ min: 0, max: 59 }) * 1000;
		put("visit started", tStart, { service_line: "primary_care", visit_type: visitType, wait_min: wait });
		const dur = Math.max(8, Math.min(45, Math.round(18 * logNormal(0.3))));
		const tDone = tStart + dur * MIN_MS;
		put("visit completed", tDone, { service_line: "primary_care", visit_type: visitType, reason_category: reason, duration_min: dur, clinician_type: pickWeighted({ physician: 60, nurse_practitioner: 40 }, rand()) });
		afterVisit(put, s.vid, "primary_care", visitType, tDone, null, s.t0);
	}

	for (const s of slots) {
		if (s.drop) continue;
		const id = s.id || `v_${chance.hash({ length: 12 })}`;
		s.vid = id;
		const put = (step, t, set) => {
			if (t > END) return null;
			let ev = s.src && s.src[step];
			if (ev) s.src[step] = null; // each engine event is used once
			if (!ev) {
				if (!templates[step]) return null;
				ev = cloneEvent(templates[step], { time: iso(t) });
			}
			ev.time = iso(t);
			ev.visit_id = id;
			Object.assign(ev, set);
			out.push(ev);
			return ev;
		};
		if (s.kind === "urgent") buildUrgent(s, put);
		else buildPrimary(s, put);
	}

	// ── therapy: intake, first session, weekly course ──
	const therapyOut = [];
	if (profile.therapy_client && !templates["therapy session completed"]) {
		// no therapy activity in the window at all: not a therapy client
		profile.therapy_client = false;
		profile.therapist_preference = "none";
	} else if (profile.therapy_client) {
		const tput = (step, t, set) => {
			if (t > END || !templates[step]) return;
			const ev = cloneEvent(templates[step], { time: iso(t) });
			ev.time = iso(t);
			Object.assign(ev, { service_line: "behavioral_health" }, set);
			therapyOut.push(ev);
		};
		const course = THERAPY_COURSE_MIN + Math.floor(salt(uid, "course") * (THERAPY_COURSE_MAX - THERAPY_COURSE_MIN + 1));
		const pref = profile.therapist_preference;
		const starter = Boolean(signup) || salt(uid, "therapy-new") < THERAPY_NEW_SHARE;
		let tNext = null;
		let k = 1;
		if (starter && therapyRuns.length) {
			// born clients start at their first therapy visit; established clients at a random one
			// established clients' starts thin out through the window while new patients'
			// starts grow with the patient base, so total weekly intakes stay level
			let tIntake;
			if (signup) tIntake = Math.min(...therapyRuns);
			else {
				const a = THERAPY_EST_DECLINE, f = salt(uid, "therapy-start");
				const u = (1 - Math.sqrt(1 - 2 * a * f * (1 - a / 2))) / a; // inverse CDF of density ∝ 1 - a·u
				const target = BEGIN + u * (END - BEGIN);
				tIntake = therapyRuns.reduce((best, t) => (Math.abs(t - target) < Math.abs(best - target) ? t : best), therapyRuns[0]);
			}
			tput("therapy intake completed", tIntake, { therapist_preference: pref, primary_concern: pickWeighted({ anxiety: 34, depression: 26, stress: 18, relationships: 10, sleep: 7, grief: 5 }, rand()) });
			// H7: time to the first session depends on therapist choice
			const dH = Math.min(45 * 24, THERAPY_FIRST_MEDIAN_H * logNormal(THERAPY_FIRST_SIGMA) * (pref === "specific_therapist" ? SPECIFIC_THERAPIST_MULT : 1));
			let tFirst = nearestHour(tIntake + dH * HOUR_MS, THERAPY_HOURS);
			if (tFirst < tIntake + 2 * HOUR_MS) tFirst += DAY_MS;
			const tBooked = tIntake + chance.integer({ min: 10, max: 180 }) * MIN_MS;
			tput("therapy session booked", tBooked, { session_number: 1, days_until_session: Math.max(0, Math.round((tFirst - tBooked) / DAY_MS)) });
			if (rand() >= THERAPY_FIRST_NOSHOW) tNext = tFirst;
		} else if (starter) {
			// a would-be starter with no therapy visit in the window is not a therapy client
			profile.therapy_client = false;
			profile.therapist_preference = "none";
		} else {
			// ongoing course at the window start: sessions left follow the steady-state
			// residual of the course length, so weekly sessions stay level
			tNext = atHour(BEGIN + Math.floor(salt(uid, "therapy-phase") * 7) * DAY_MS, THERAPY_HOURS);
			const left = Number(pickWeighted(RESIDUAL_WEIGHTS, salt(uid, "therapy-left")));
			k = Math.max(1, course - left + 1);
			if (k === 1) k = 2; // an ongoing client is past the first session
		}
		while (tNext !== null && tNext <= END && k <= course) {
			if (k === 1 || rand() < THERAPY_ATTEND) tput("therapy session completed", tNext, { session_number: k, duration_min: chance.integer({ min: 45, max: 55 }) });
			const nextT = atHour(dayStart(tNext) + chance.integer({ min: 6, max: 8 }) * DAY_MS, THERAPY_HOURS);
			const tBook = tNext + chance.integer({ min: 50, max: 70 }) * MIN_MS;
			k++;
			if (k <= course) tput("therapy session booked", tBook, { session_number: k, days_until_session: Math.round((nextT - tBook) / DAY_MS) });
			tNext = nextT;
		}
	}

	// a client whose only remaining session was missed has no therapy activity in the window
	if (profile.therapy_client && !therapyOut.length) {
		profile.therapy_client = false;
		profile.therapist_preference = "none";
	}

	// ── H5: readings, bluetooth lapse ──
	let readOut = readings;
	if (readings.length) {
		const program = profile.chronic_program;
		const conn = profile.device_connectivity;
		const inWin = readings.map(T).filter((t) => t >= BEGIN);
		const firstR = inWin.length ? Math.min(...inWin) : Infinity;
		let lapseT = Infinity;
		if (conn === "bluetooth" && salt(uid, "lapse") < BT_LAPSE_SHARE && Number.isFinite(firstR)) {
			const from = firstR + LAPSE_FROM_DAYS * DAY_MS;
			if (from < ms(LAPSE_LAST)) lapseT = from + salt(uid, "lapse-day") * (ms(LAPSE_LAST) - from);
		}
		// realism: some members of either device stop logging at any time in the window
		if (salt(uid, "dropout") < PROGRAM_DROPOUT_SHARE && Number.isFinite(firstR)) {
			lapseT = Math.min(lapseT, firstR + salt(uid, "dropout-day") * (END - firstR));
		}
		readOut = readings.filter((e) => T(e) < lapseT);
		for (const e of readOut) {
			e.reading_type = program === "diabetes" ? "glucose" : "blood_pressure";
			e.in_range = rand() < (program === "diabetes" ? 0.58 : 0.64);
			e.sync_method = conn;
		}
	}

	// H4: one exposure per patient, 1 s before their first prescription in the
	// test (the Experiments report counts metric events after exposure)
	const usedExposures = [];
	if (Number.isFinite(firstTestRx)) {
		exposures[0].time = iso(firstTestRx - 1000);
		usedExposures.push(exposures[0]);
	} else if (profile[EXP_KEY] !== undefined) delete profile[EXP_KEY];

	return keep.concat(out, usedExposures, therapyOut, readOut).filter((e) => T(e) >= BEGIN && T(e) <= END);
}

// warehouse rows: exogenous business facts layered on event-derived volumes
function handleWarehouse(row, meta) {
	if (meta.isBackfill) return row;
	if (meta.metricName === "clinician_staffing_daily") {
		// the source count (the day's care demand for the service line) becomes the
		// staffing plan; agency hours lapse during the urgent-care staffing gap
		const sl = row.service_line;
		const k = `${row.date}|${sl}`;
		const t = dayjs.utc(row.date).valueOf();
		const closed = sl === "primary_care" && isClinicClosed(t);
		const plan = closed ? 0 : row.clinician_hours * (HOURS_PER_DEMAND[sl] ?? 0.8) * jitter(`plan|${k}`, HOURS_NOISE) + 6 * jitter(`floor|${k}`, 0.3);
		const agencyShare = (AGENCY_HOURS_SHARE[sl] ?? 0) * jitter(`agency|${k}`, AGENCY_SHARE_NOISE);
		const employed = plan * (1 - agencyShare);
		const agency = sl === "urgent_care" && inGap(t) ? 0 : plan * agencyShare;
		row.employed_clinician_hours = round2(employed);
		row.agency_clinician_hours = round2(agency);
		row.clinician_hours = round2(employed + agency);
		row.spanish_speaking_clinician_hours = round2((employed + agency) * (SPANISH_HOURS_SHARE[sl] ?? 0.1) * jitter(`es|${k}`, 0.15));
		row.clinicians_on_shift = Math.round((employed + agency) / (SHIFT_HOURS * jitter(`shift|${k}`, 0.12)));
		return row;
	}
	if (meta.metricName === "visit_revenue_daily") {
		const k = `${row.date}|${row.service_line}|${row.coverage_type}`;
		// claims post on the day billing closes them: a share of each day's visits
		// posts the next day (rows arrive in date order within a series)
		if (meta.bucketIndex === 0 || !billingCarry.has(meta.seriesKey)) billingCarry.set(meta.seriesKey, 0);
		const app = row.visits_billed;
		const lagged = Math.round(app * POSTING_LAG_SHARE * jitter(`lag|${k}`, 0.8));
		const posted = app - lagged + billingCarry.get(meta.seriesKey);
		billingCarry.set(meta.seriesKey, lagged);
		const nurseLine = Math.round(app * NURSE_LINE_SHARE * jitter(`nurse|${k}`, 1) + (hashFloat(`nl|${k}`) < 0.3 ? 1 : 0));
		const voided = Math.round(app * VOID_SHARE * jitter(`void|${k}`, 1));
		const billed = Math.max(0, posted + nurseLine - voided);
		row.visits_billed = billed;
		row.patient_revenue_usd = round2(billed * row.avg_patient_charge_usd);
		row.payer_revenue_usd = round2(billed * row.payer_rate_usd);
		row.total_revenue_usd = round2(row.patient_revenue_usd + row.payer_revenue_usd);
		return row;
	}
	return row;
}

// average patient charge per visit for a service line and coverage type on a day
function avgPatientCharge(serviceLine, coverage, t) {
	if (coverage === "self_pay") return serviceLine === "urgent_care" ? selfPayPrice(t) : SELF_PAY_LIST[serviceLine];
	const plans = COPAY_BY_PLAN[coverage] || [0];
	return round2(plans.reduce((a, b) => a + b, 0) / plans.length);
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
	stickyEventProps: ["coverage_type", "preferred_language"],

	events: [
		{
			event: "account created",
			weight: 1,
			isFirstEvent: true,
			isAuthEvent: true,
			properties: {
				signup_method: { __weights: { email: 45, apple: 35, google: 20 } },
				acquisition_channel: (ctx) => ctx.profile.acquisition_channel,
			},
		},
		{
			event: "coverage added",
			weight: 1,
			isStrictEvent: true,
			properties: {
				coverage_type: (ctx) => ctx.profile.coverage_type,
				verification_status: (ctx) => (ctx.profile.coverage_type === "self_pay" ? "not_applicable" : hashFloat(`${ctx.profile.distinct_id}|verify`) < 0.9 ? "verified" : "manual_review"),
			},
		},
		{
			event: "program enrolled",
			weight: 1,
			isStrictEvent: true,
			properties: {
				program: (ctx) => ctx.profile.chronic_program,
				device_connectivity: (ctx) => ctx.profile.device_connectivity,
			},
		},
		{
			event: "app opened",
			weight: 1,
			isStrictEvent: true,
			properties: {
				open_source: { __weights: { organic: 52, push_notification: 28, sms_link: 12, email_link: 8 } },
			},
		},
		{
			event: "health record viewed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				record_type: { __weights: { visit_summary: 30, medications: 22, care_plan: 18, immunizations: 12, billing: 18 } },
			},
		},
		{
			event: "lab results viewed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				test_type: { __weights: { basic_metabolic_panel: 24, lipid_panel: 20, a1c: 18, cbc: 16, thyroid_panel: 10, urinalysis: 12 } },
				result_flag: { __weights: { normal: 78, abnormal: 22 } },
			},
		},
		{
			event: "message sent",
			weight: 1,
			isStrictEvent: true,
			properties: {
				message_topic: { __weights: { question_for_clinician: 34, medication_question: 22, scheduling: 18, billing: 12, test_results: 14 } },
			},
		},
		{
			event: "symptom check completed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				visit_id: ["unassigned"],
				reason_category: { __weights: REASON_WEIGHTS },
				triage_result: ["virtual_visit"],
			},
		},
		{
			event: "visit requested",
			weight: 1,
			isStrictEvent: true,
			properties: {
				visit_id: ["unassigned"],
				service_line: ["urgent_care"],
				visit_type: ["video"],
				reason_category: ["other"],
				estimated_wait_min: [0],
				patient_cost_usd: [0],
			},
		},
		{
			event: "waiting room left",
			weight: 1,
			isStrictEvent: true,
			properties: {
				visit_id: ["unassigned"],
				service_line: ["urgent_care"],
				minutes_waited: [0],
			},
		},
		{
			event: "appointment booked",
			weight: 1,
			isStrictEvent: true,
			properties: {
				visit_id: ["unassigned"],
				service_line: ["primary_care"],
				appointment_reason: ["annual_checkup"],
				visit_type: ["video"],
				lead_days: [0],
				patient_cost_usd: [0],
			},
		},
		{
			event: "appointment missed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				visit_id: ["unassigned"],
				service_line: ["primary_care"],
				lead_days: [0],
			},
		},
		{
			event: "reminder sent",
			weight: 1,
			isStrictEvent: true,
			properties: {
				visit_id: ["unassigned"],
				reminder_type: ["appointment"],
				channel: ["sms"],
			},
		},
		{
			event: "visit started",
			weight: 1,
			isStrictEvent: true,
			properties: {
				visit_id: ["unassigned"],
				service_line: ["urgent_care"],
				visit_type: ["video"],
				wait_min: [0],
			},
		},
		{
			event: "visit completed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				visit_id: ["unassigned"],
				service_line: ["urgent_care"],
				visit_type: ["video"],
				reason_category: ["other"],
				duration_min: [10],
				clinician_type: ["physician"],
			},
		},
		{
			event: "prescription sent",
			weight: 1,
			isStrictEvent: true,
			properties: {
				visit_id: ["unassigned"],
				service_line: ["urgent_care"],
				medication_class: ["antibiotic"],
				pharmacy_type: ["chain"],
			},
		},
		{
			event: "prescription picked up",
			weight: 1,
			isStrictEvent: true,
			properties: {
				visit_id: ["unassigned"],
				service_line: ["urgent_care"],
				pharmacy_type: ["chain"],
			},
		},
		{
			event: "visit rated",
			weight: 1,
			isStrictEvent: true,
			properties: {
				visit_id: ["unassigned"],
				service_line: ["urgent_care"],
				visit_type: ["video"],
				rating: [5],
				would_recommend: [true],
			},
		},
		{
			event: "reading logged",
			weight: 1,
			isStrictEvent: true,
			properties: {
				reading_type: ["blood_pressure"],
				in_range: [true],
				sync_method: ["cellular"],
			},
		},
		{
			event: "therapy intake completed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				service_line: ["behavioral_health"],
				therapist_preference: ["first_available"],
				primary_concern: ["anxiety"],
			},
		},
		{
			event: "therapy session booked",
			weight: 1,
			isStrictEvent: true,
			properties: {
				service_line: ["behavioral_health"],
				session_number: [1],
				days_until_session: [7],
			},
		},
		{
			event: "therapy session completed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				service_line: ["behavioral_health"],
				session_number: [1],
				duration_min: [50],
			},
		},
		{
			event: "$experiment_started",
			weight: 1,
			isStrictEvent: true,
			properties: {
				"Experiment name": [PICKUP_EXPERIMENT],
				"Variant name": ["Control", PICKUP_VARIANT],
			},
		},
	],

	funnels: [
		{
			name: "Onboarding",
			sequence: ["account created", "coverage added"],
			isFirstFunnel: true,
			conditions: { chronic_program: "none" },
			conversionRate: 100,
			timeToConvert: 0.2,
			order: "sequential",
			weight: 1,
		},
		{
			name: "Onboarding",
			sequence: ["account created", "coverage added", "program enrolled"],
			isFirstFunnel: true,
			conditions: { chronic_program: { neq: "none" } },
			conversionRate: 100,
			timeToConvert: 0.3,
			order: "sequential",
			weight: 1,
		},
		{
			name: "Check-in",
			sequence: ["app opened", "health record viewed", "lab results viewed", "message sent", "health record viewed"],
			conversionRate: 50,
			timeToConvert: 0.3,
			order: "first-fixed",
			weight: 12,
		},
		{
			name: "Urgent Care",
			sequence: URGENT_STEPS,
			conversionRate: 100,
			timeToConvert: 1,
			order: "sequential",
			weight: 2,
			props: {
				visit_id: () => `v_${chance.hash({ length: 12 })}`,
			},
			experiment: {
				name: PICKUP_EXPERIMENT,
				startDaysBeforeEnd: (ms(DATASET_END) - ms(PICKUP_TEST_START)) / DAY_MS,
				variants: [{ name: "Control" }, { name: PICKUP_VARIANT }],
			},
		},
		{
			name: "Primary Care",
			sequence: PRIMARY_STEPS,
			conversionRate: 100,
			timeToConvert: 1,
			order: "sequential",
			weight: 1,
			props: {
				visit_id: () => `v_${chance.hash({ length: 12 })}`,
			},
		},
		{
			name: "Readings",
			sequence: ["reading logged"],
			conditions: { chronic_program: { neq: "none" } },
			conversionRate: 100,
			timeToConvert: 0.1,
			order: "sequential",
			weight: 45,
		},
		{
			name: "Therapy",
			sequence: ["therapy intake completed", "therapy session booked", "therapy session completed"],
			conditions: { therapy_client: true },
			conversionRate: 100,
			timeToConvert: 1,
			order: "sequential",
			weight: 3,
		},
	],

	warehouseMetrics: [
		{
			name: "clinician_staffing_daily",
			type: "additive",
			grain: "day",
			source: {
				// the day's care demand by service line: urgent requests, primary care
				// appointments that day (attended or missed), therapy sessions held
				event: ["visit requested", "visit started", "appointment missed", "therapy session completed"],
				measure: "count",
				where: (e) => e.event !== "visit started" || e.service_line === "primary_care",
				groupBy: "service_line",
			},
			timeColumn: "date",
			valueColumn: "clinician_hours",
			columns: {
				// set by the warehouse hook from the day's staffing plan
				employed_clinician_hours: 0,
				agency_clinician_hours: 0,
				spanish_speaking_clinician_hours: 0,
				clinicians_on_shift: 0,
			},
		},
		{
			name: "visit_revenue_daily",
			type: "additive",
			grain: "day",
			source: {
				event: ["visit completed", "therapy session completed"],
				measure: "count",
				groupBy: ["service_line", "coverage_type"],
			},
			timeColumn: "date",
			valueColumn: "visits_billed",
			columns: {
				avg_patient_charge_usd: (ctx) => avgPatientCharge(ctx.row.service_line, ctx.row.coverage_type, ctx.time),
				payer_rate_usd: (ctx) => PAYER_RATE[ctx.row.service_line]?.[ctx.row.coverage_type] ?? 0,
				patient_revenue_usd: 0,
				payer_revenue_usd: 0,
				total_revenue_usd: 0,
			},
		},
	],

	superProps: {
		coverage_type: ["employer"],
		preferred_language: ["en"],
	},

	userProps: {
		coverage_type: ["employer"],
		age_band: { __weights: { "18-25": 14, "26-35": 26, "36-45": 22, "46-55": 16, "56-64": 12, "65+": 10 } },
		gender: { __weights: { female: 57, male: 41, nonbinary: 2 } },
		preferred_language: ["en"],
		state: ["CA"],
		chronic_program: ["none"],
		device_connectivity: ["none"],
		therapy_client: [false],
		therapist_preference: ["none"],
		acquisition_channel: ["organic"],
		member_since: ["2025-01-01"],
	},

	personas: [
		{ name: "monitoring_member", weight: 18, eventMultiplier: 2.0, properties: { chronic_program: ["hypertension", "hypertension", "diabetes"] } },
		{ name: "frequent_patient", weight: 16, eventMultiplier: 1.5, properties: { chronic_program: "none" } },
		{ name: "regular_patient", weight: 41, eventMultiplier: 1.0, properties: { chronic_program: "none" } },
		{ name: "occasional_patient", weight: 25, eventMultiplier: 0.45, properties: { chronic_program: "none" } },
	],

	retentionCurve: { type: "logarithmic", day1: 0.55, day7: 0.38, day30: 0.26 },

	hook(record, type, meta) {
		if (type === "user") return handleUserHook(record, meta);
		if (type === "everything") return handleEverything(record, meta);
		if (type === "warehouse") return handleWarehouse(record, meta);
		return record;
	},
};

// ── STORIES ──────────────────────────────────────────────────────────────
// Machine-checkable contract for hooks H1-H10. Evaluate with:
//   node dungeons/vertical/healthcare/healthcare.verify.mjs

const EV = `read_json_auto('{{PREFIX}}-EVENTS*.json*', sample_size=-1, union_by_name=true)`;
const US = `read_json_auto('{{PREFIX}}-USERS*.json*', sample_size=-1, union_by_name=true)`;
const WH = (table) => `read_json_auto('{{PREFIX}}-WAREHOUSE-${table}.json*', sample_size=-1, union_by_name=true)`;

// Identity prelude: a device resolves to the patient seen with it on any event
// that carries both ids (emitted stitch evidence). Every Clearwell event carries
// user_id, so the device map only matters for completeness.
const ID_CTE = `dmap AS (SELECT device_id, min(user_id::VARCHAR) AS mapped FROM ${EV}
  WHERE user_id IS NOT NULL AND device_id IS NOT NULL GROUP BY 1),
ev AS (SELECT coalesce(e.user_id::VARCHAR, m.mapped) AS uid, e.time::TIMESTAMP AS t, e.*
  FROM ${EV} e LEFT JOIN dmap m ON e.device_id = m.device_id)`;

const TS = (isoStr) => dayjs.utc(isoStr).format("YYYY-MM-DD HH:mm:ss");
const D = (isoStr) => isoStr.slice(0, 10);
const addDays = (isoStr, n) => dayjs.utc(isoStr).add(n, "day").toISOString();
const band = (k) => [Number((k * 0.9).toPrecision(4)), Number((k * 1.1).toPrecision(4))]; // knob ±10% (4 significant digits, so small knobs keep their band)
const SQL_LIST = (xs) => xs.map((x) => `'${x}'`).join(", ");
const D0 = D(DATASET_START);

const ASYNC_RAMPED = addDays(ASYNC_LAUNCH, ASYNC_RAMP_DAYS);           // adoption at full level
const PICKUP_WINDOW_DAYS = 7;                                           // H4 read: Funnels conversion window
const PICKUP_READ_END = addDays(DATASET_END, -PICKUP_WINDOW_DAYS);      // prescriptions with a full window
const GAP_BASE_DAYS = 14;                                               // H3 read: baseline days either side
const EARLY_END = addDays(DATASET_START, 14);                           // H5 cohort: readings Jun 4-17
const LATE_START = addDays(LAPSE_LAST, 1);                              // H5 return: readings Sep 3 - Oct 1
const BOOKING_READ_END = "2026-09-01T00:00:00Z";                        // H6/H7 read: full 30-day windows
const FUNNEL_WINDOW_DAYS = 30;
const LEAD_LONG_FROM = 8;
const NOSHOW_FLOOR_SHARE = 0.8;                                          // H6 single-ref reads: floor = 0.8 x knob
// H6: expected no-show rate of appointments booked 8+ days out (lead mix from LEAD_WEIGHTS)
const NOSHOW_LONG = (() => {
	let w = 0, s = 0;
	LEAD_WEIGHTS.forEach((x, l) => { if (l >= LEAD_LONG_FROM) { w += x; s += x * noShowRate(l); } });
	return Math.round(s / w * 10000) / 10000;
})();
const PRICE_RATIO = SELF_PAY_PRICE[1] / SELF_PAY_PRICE[0];
const REVENUE_KNOB = Math.round(SELF_PAY_LIFT * PRICE_RATIO * 1000) / 1000; // H8 revenue per check, after / before
const REVENUE_FLOOR_SHARE = 0.85;                                         // H8 revenue read is confounded: floor = 0.85 x knob

const H1_SQL = `WITH ${ID_CTE}
SELECT CASE WHEN t < TIMESTAMP '${TS(ASYNC_LAUNCH)}' THEN 'before' WHEN t >= TIMESTAMP '${TS(ASYNC_RAMPED)}' THEN 'after' ELSE 'ramp' END AS grp,
 count(DISTINCT uid) AS user_count, count(*) AS requests,
 avg((visit_type = 'async')::INT) AS async_share, count(*) FILTER (WHERE visit_type = 'async') AS async_requests
FROM ev WHERE event = 'visit requested' AND reason_category IN (${SQL_LIST(MINOR_REASONS)}) GROUP BY 1
UNION ALL
SELECT 'not_minor' AS grp, count(DISTINCT uid), count(*), avg((visit_type = 'async')::INT), count(*) FILTER (WHERE visit_type = 'async')
FROM ev WHERE event = 'visit requested' AND reason_category NOT IN (${SQL_LIST(MINOR_REASONS)})`;

const H2_SQL = `WITH ${ID_CTE},
r AS (SELECT visit_id, any_value(uid) AS uid, min(t) AS t0, any_value(estimated_wait_min) AS w FROM ev
  WHERE event = 'visit requested' AND visit_type <> 'async' GROUP BY 1),
s AS (SELECT visit_id, min(t) AS t1 FROM ev WHERE event = 'visit started' GROUP BY 1)
SELECT CASE WHEN r.w <= ${PATIENT_WAIT_MIN} THEN 'short' WHEN r.w >= ${GIVE_UP_WAIT_MIN} THEN 'long' ELSE 'middle' END AS grp,
 count(DISTINCT r.uid) AS user_count, count(*) AS requests,
 avg(coalesce(s.t1 >= r.t0 AND s.t1 < r.t0 + INTERVAL 1 DAY, false)::INT) AS start_rate
FROM r LEFT JOIN s ON s.visit_id = r.visit_id GROUP BY 1`;

const H3_SQL = `WITH ${ID_CTE},
g AS (SELECT DISTINCT date::DATE AS d FROM ${WH("clinician_staffing_daily")} WHERE service_line = 'urgent_care' AND agency_clinician_hours = 0),
w AS (SELECT t::DATE AS d, uid, estimated_wait_min FROM ev WHERE event = 'visit requested' AND visit_type <> 'async'
  AND t >= TIMESTAMP '${TS(addDays(STAFFING_GAP_START, -GAP_BASE_DAYS))}' AND t < TIMESTAMP '${TS(addDays(STAFFING_GAP_END, GAP_BASE_DAYS))}')
SELECT CASE WHEN d IN (SELECT d FROM g) THEN 'gap' ELSE 'baseline' END AS grp, count(DISTINCT d) AS days,
 count(DISTINCT uid) AS user_count, count(*) AS requests, avg(estimated_wait_min) AS avg_wait
FROM w GROUP BY 1`;

const H3_WH_SQL = `WITH ${ID_CTE},
s AS (SELECT date::DATE AS d, clinician_hours, agency_clinician_hours FROM ${WH("clinician_staffing_daily")} WHERE service_line = 'urgent_care'),
r AS (SELECT t::DATE AS d, count(*) AS requests FROM ev WHERE event = 'visit requested' GROUP BY 1)
SELECT CASE WHEN s.agency_clinician_hours = 0 THEN 'gap' ELSE 'baseline' END AS grp, count(*) AS days,
 sum(s.clinician_hours) / sum(r.requests) AS hours_per_request
FROM s JOIN r ON r.d = s.d
WHERE s.d >= DATE '${D(addDays(STAFFING_GAP_START, -GAP_BASE_DAYS))}' AND s.d < DATE '${D(addDays(STAFFING_GAP_END, GAP_BASE_DAYS))}' GROUP BY 1`;

const H4_SQL = `WITH ${ID_CTE},
v AS (SELECT distinct_id::VARCHAR AS uid, "${EXP_KEY}" AS variant FROM ${US} WHERE "${EXP_KEY}" IS NOT NULL),
rx AS (SELECT visit_id, any_value(uid) AS uid, min(t) AS t0 FROM ev WHERE event = 'prescription sent' AND service_line = 'urgent_care'
  AND t >= TIMESTAMP '${TS(PICKUP_TEST_START)}' AND t < TIMESTAMP '${TS(PICKUP_READ_END)}' GROUP BY 1),
p AS (SELECT visit_id, min(t) AS t1 FROM ev WHERE event = 'prescription picked up' GROUP BY 1)
SELECT v.variant AS grp, count(DISTINCT rx.uid) AS user_count, count(*) AS prescriptions,
 avg(coalesce(p.t1 >= rx.t0 AND p.t1 < rx.t0 + INTERVAL ${PICKUP_WINDOW_DAYS} DAY, false)::INT) AS pickup_rate,
 median(date_diff('second', rx.t0, p.t1) / 3600.0) FILTER (WHERE p.t1 >= rx.t0 AND p.t1 < rx.t0 + INTERVAL ${PICKUP_WINDOW_DAYS} DAY) AS med_hours
FROM rx JOIN v ON v.uid = rx.uid LEFT JOIN p ON p.visit_id = rx.visit_id GROUP BY 1`;

const H5_SQL = `WITH ${ID_CTE},
p AS (SELECT distinct_id::VARCHAR AS uid, device_connectivity FROM ${US}),
early AS (SELECT DISTINCT uid FROM ev WHERE event = 'reading logged' AND t < TIMESTAMP '${TS(EARLY_END)}'),
late AS (SELECT DISTINCT uid FROM ev WHERE event = 'reading logged' AND t >= TIMESTAMP '${TS(LATE_START)}')
SELECT p.device_connectivity AS grp, count(*) AS user_count, avg((late.uid IS NOT NULL)::INT) AS retained
FROM early JOIN p ON p.uid = early.uid LEFT JOIN late ON late.uid = early.uid GROUP BY 1`;

const H6_SQL = `WITH ${ID_CTE},
b AS (SELECT visit_id, any_value(uid) AS uid, any_value(lead_days) AS lead FROM ev WHERE event = 'appointment booked' AND t < TIMESTAMP '${TS(BOOKING_READ_END)}' GROUP BY 1),
m AS (SELECT DISTINCT visit_id FROM ev WHERE event = 'appointment missed'),
x AS (SELECT b.uid, b.lead, (m.visit_id IS NOT NULL)::INT AS missed FROM b LEFT JOIN m ON m.visit_id = b.visit_id)
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count, count(*) AS appointments,
 regr_slope(missed, lead) AS slope, regr_intercept(missed, lead) AS intercept,
 avg(missed) FILTER (WHERE lead >= ${LEAD_LONG_FROM}) AS noshow_long, avg(missed) FILTER (WHERE lead <= 1) AS noshow_short
FROM x`;

const H7_SQL = `WITH ${ID_CTE},
i AS (SELECT uid, min(t) AS t0, arg_min(therapist_preference, t) AS pref FROM ev WHERE event = 'therapy intake completed' GROUP BY 1),
s AS (SELECT i.uid, i.pref, min(e.t) AS t1 FROM i JOIN ev e ON e.uid = i.uid AND e.event = 'therapy session completed'
  AND e.t > i.t0 AND e.t < i.t0 + INTERVAL ${FUNNEL_WINDOW_DAYS} DAY
  WHERE i.t0 < TIMESTAMP '${TS(BOOKING_READ_END)}' GROUP BY 1, 2)
SELECT s.pref AS grp, count(*) AS user_count, median(date_diff('second', i.t0, s.t1) / 3600.0) AS med_hours
FROM s JOIN i ON i.uid = s.uid GROUP BY 1`;

const H8_SQL = `WITH ${ID_CTE},
w AS (SELECT CASE WHEN t >= TIMESTAMP '${TS(SELF_PAY_PRICE_CHANGE)}' THEN 'after' ELSE 'before' END AS per,
  CASE WHEN coverage_type = 'self_pay' THEN 'self_pay' ELSE 'insured' END AS cov, event, uid
  FROM ev WHERE event IN ('symptom check completed', 'visit requested'))
SELECT per || '_' || cov AS grp, count(DISTINCT uid) AS user_count,
 count(*) FILTER (WHERE event = 'symptom check completed') AS checks,
 count(*) FILTER (WHERE event = 'visit requested')::DOUBLE / count(*) FILTER (WHERE event = 'symptom check completed') AS request_rate
FROM w GROUP BY 1, per, cov`;

const H8_REV_SQL = `WITH ${ID_CTE},
c AS (SELECT CASE WHEN t >= TIMESTAMP '${TS(SELF_PAY_PRICE_CHANGE)}' THEN 'after' ELSE 'before' END AS grp, count(*) AS checks, count(DISTINCT uid) AS user_count
  FROM ev WHERE event = 'symptom check completed' AND coverage_type = 'self_pay' GROUP BY 1),
r AS (SELECT CASE WHEN date::DATE >= DATE '${D(SELF_PAY_PRICE_CHANGE)}' THEN 'after' ELSE 'before' END AS grp, sum(patient_revenue_usd) AS revenue
  FROM ${WH("visit_revenue_daily")} WHERE service_line = 'urgent_care' AND coverage_type = 'self_pay' GROUP BY 1)
SELECT c.grp, c.user_count, c.checks, r.revenue, r.revenue / c.checks AS revenue_per_check FROM c JOIN r ON r.grp = c.grp`;

const H9_SQL = `WITH ${ID_CTE}
SELECT CASE WHEN t >= TIMESTAMP '${TS(RESP_WAVE_PEAK)}' THEN 'peak' WHEN t < TIMESTAMP '${TS(RESP_WAVE_START)}' THEN 'baseline' ELSE 'ramp' END AS grp,
 count(DISTINCT uid) AS user_count, count(*) AS checks,
 count(*) FILTER (WHERE reason_category = 'respiratory')::DOUBLE / count(*) FILTER (WHERE reason_category <> 'respiratory') AS resp_per_other
FROM ev WHERE event = 'symptom check completed' GROUP BY 1`;

const H10_SQL = `WITH ${ID_CTE}
SELECT preferred_language AS grp, count(DISTINCT uid) AS user_count, count(*) AS requests, avg(estimated_wait_min) AS avg_wait
FROM ev WHERE event = 'visit requested' AND visit_type <> 'async' GROUP BY 1`;

/** @type {import("../../../types").DungeonStory[]} */
export const stories = [
	{
		id: "H1-async-launch",
		hook: "H1",
		archetype: "temporal-inflection",
		narrative: `Clearwell Async launches ${D(ASYNC_LAUNCH)}: urgent-care requests for minor conditions (${MINOR_REASONS.join(", ")}) can be submitted as a questionnaire a clinician reviews, with no waiting room (visit_type = async, estimated_wait_min = 0). Adoption ramps over ${ASYNC_RAMP_DAYS} days to ${ASYNC_SHARE * 100}% of minor-condition requests (per request, each patient's share drawn independently); async visits complete about ${ASYNC_REVIEW_MEDIAN_H} h after the request and never abandon. No async visit exists before launch or for other reasons. Read: async share of minor-condition visit requests from ${D(ASYNC_RAMPED)}.`,
		mixpanelReport: { type: "Insights", event: "visit requested", filter: `reason_category in ${MINOR_REASONS.join(", ")}`, breakdown: "visit_type", measure: "total, % of total", chart: `weekly; from ${D(ASYNC_RAMPED)}` },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H1_SQL },
				select: { a: { where: { grp: "after" } } },
				expect: { metric: "a.async_share", op: "between", target: band(ASYNC_SHARE) },
				minCohort: 1500,
			},
			{
				breakdown: { type: "duckdb", sql: H1_SQL },
				select: { b: { where: { grp: "before" } } },
				// exact: an async visit before launch is a bug
				expect: { metric: "b.async_requests", op: "between", target: [0, 0] },
			},
			{
				breakdown: { type: "duckdb", sql: H1_SQL },
				select: { n: { where: { grp: "not_minor" } } },
				// exact: async is offered only for the minor conditions
				expect: { metric: "n.async_requests", op: "between", target: [0, 0] },
			},
		],
	},
	{
		id: "H2-waiting-room-threshold",
		hook: "H2",
		archetype: "funnel-conversion-by-segment",
		narrative: `On-demand patients tolerate about ${PATIENT_WAIT_MIN} minutes. The chance a live (video or phone) request reaches "visit started" depends on the estimated wait shown at request: ${START_RATE_SHORT * 100}% up to ${PATIENT_WAIT_MIN} minutes, falling linearly to ${START_RATE_LONG * 100}% at ${GIVE_UP_WAIT_MIN} minutes, and flat at ${START_RATE_LONG * 100}% beyond. Patients who give up fire "waiting room left". Read: per request (hold visit_id constant), visit started within 1 day, by estimated_wait_min bucket: ≥ ${GIVE_UP_WAIT_MIN} over ≤ ${PATIENT_WAIT_MIN} reads ${START_RATE_LONG} / ${START_RATE_SHORT}.`,
		mixpanelReport: { type: "Funnels", steps: ["visit requested", "visit started"], counting: "totals", holdPropertyConstant: "visit_id", window: "1 day", filter: "visit_type ≠ async", breakdown: `estimated_wait_min (custom buckets ≤${PATIENT_WAIT_MIN}, ${PATIENT_WAIT_MIN + 1}-${GIVE_UP_WAIT_MIN - 1}, ≥${GIVE_UP_WAIT_MIN})` },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H2_SQL },
				select: { l: { where: { grp: "long" } }, s: { where: { grp: "short" } } },
				expect: { metric: "l.start_rate / s.start_rate", op: "between", target: band(START_RATE_LONG / START_RATE_SHORT) },
				minCohort: 1000,
			},
			{
				breakdown: { type: "duckdb", sql: H2_SQL },
				select: { s: { where: { grp: "short" } } },
				expect: { metric: "s.start_rate", op: "between", target: band(START_RATE_SHORT) },
				minCohort: 1000,
			},
		],
	},
	{
		id: "H3-urgent-care-staffing-gap",
		hook: "H3",
		archetype: "external-join",
		narrative: `From ${D(STAFFING_GAP_START)} to ${D(STAFFING_GAP_END)} (exclusive) the locum agency contract for urgent care lapsed. Warehouse clinician_staffing_daily shows agency_clinician_hours = 0 for urgent_care on those days, so clinician_hours fall to ${1 - AGENCY_HOURS_SHARE.urgent_care} of plan (agency is normally ${AGENCY_HOURS_SHARE.urgent_care * 100}% of urgent hours). Estimated waits for live urgent-care requests are ${GAP_WAIT_MULT}x on those days, so more patients leave the waiting room (H2). The gap days are read from the warehouse (agency hours = 0); event read: average estimated_wait_min on gap days vs the ${GAP_BASE_DAYS} days either side (same weekday mix, same language mix) reads ${GAP_WAIT_MULT}. Warehouse read: urgent clinician hours per visit request, gap / baseline, reads ${1 - AGENCY_HOURS_SHARE.urgent_care}.`,
		mixpanelReport: { type: "Insights + warehouse", event: "visit requested", filter: "visit_type ≠ async", measure: "average estimated_wait_min", chart: "daily line", join: "clinician_staffing_daily (service_line = urgent_care) on date" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H3_SQL },
				select: { g: { where: { grp: "gap" } }, b: { where: { grp: "baseline" } } },
				expect: { metric: "g.avg_wait / b.avg_wait", op: "between", target: band(GAP_WAIT_MULT) },
				minCohort: 1000,
			},
			{
				breakdown: { type: "duckdb", sql: H3_WH_SQL },
				select: { g: { where: { grp: "gap" } }, b: { where: { grp: "baseline" } } },
				expect: { metric: "g.hours_per_request / b.hours_per_request", op: "between", target: band(1 - AGENCY_HOURS_SHARE.urgent_care) },
			},
		],
	},
	{
		id: "H4-pickup-reminders-experiment",
		hook: "H4",
		archetype: "experiment-lift",
		narrative: `The "${PICKUP_EXPERIMENT}" test starts ${D(PICKUP_TEST_START)}: urgent-care prescriptions from requests on or after that date are in the test, split 50/50 by patient (sticky; one exposure $experiment_started per patient, 1 s before their first prescription in the test, so the Experiments report counts every in-test prescription). In the "${PICKUP_VARIANT}" arm the patient gets an SMS ("reminder sent", reminder_type rx_pickup) ${REMINDER_AFTER_H} h after the prescription if it is not picked up yet. Pickup rises ${REMINDER_PICKUP_MULT}x (from ${PICKUP_BASE * 100}%) and the time from prescription to pickup is ${REMINDER_DELAY_MULT}x (log-normal, control median ${PICKUP_MEDIAN_H} h). Primary care prescriptions are not in the test. Read: per prescription (hold visit_id constant), picked up within ${PICKUP_WINDOW_DAYS} days, prescriptions ${D(PICKUP_TEST_START)} to ${D(PICKUP_READ_END)}; median hours to pickup.`,
		mixpanelReport: { type: "Funnels", steps: ["prescription sent", "prescription picked up"], counting: "totals", holdPropertyConstant: "visit_id", window: `${PICKUP_WINDOW_DAYS} days`, filter: "service_line = urgent_care", dateRange: `${D(PICKUP_TEST_START)} to ${D(PICKUP_READ_END)}`, breakdown: `user property "${EXP_KEY}"`, measure: "conversion and median time to convert" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H4_SQL },
				select: { v: { where: { grp: PICKUP_VARIANT } }, c: { where: { grp: "Control" } } },
				expect: { metric: "v.pickup_rate / c.pickup_rate", op: "between", target: band(REMINDER_PICKUP_MULT) },
				minCohort: 1500,
			},
			{
				breakdown: { type: "duckdb", sql: H4_SQL },
				select: { v: { where: { grp: PICKUP_VARIANT } }, c: { where: { grp: "Control" } } },
				expect: { metric: "v.med_hours / c.med_hours", op: "between", target: band(REMINDER_DELAY_MULT) },
				minCohort: 1500,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 count(DISTINCT uid) FILTER (WHERE "Variant name" = '${PICKUP_VARIANT}')::DOUBLE / count(DISTINCT uid) AS variant_share
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
 count(*) FILTER (WHERE t < TIMESTAMP '${TS(PICKUP_TEST_START)}' OR v.variant IS DISTINCT FROM '${PICKUP_VARIANT}') AS impure
FROM ev LEFT JOIN v ON v.uid = ev.uid WHERE event = 'reminder sent' AND reminder_type = 'rx_pickup'`,
				},
				select: { a: { where: { grp: "all" } } },
				// exact: pickup reminders exist only in the variant after the start
				expect: { metric: "a.impure", op: "between", target: [0, 0] },
			},
		],
	},
	{
		id: "H5-bluetooth-cuff-lapse",
		hook: "H5",
		archetype: "retention-divergence",
		narrative: `Remote monitoring patients log readings from a connected device (device_connectivity cellular or bluetooth). ${BT_LAPSE_SHARE * 100}% of bluetooth patients stop logging for good at a salted moment between ${LAPSE_FROM_DAYS} days after their first in-window reading and ${D(LAPSE_LAST)}; cellular devices never lapse this way. Separately, ${PROGRAM_DROPOUT_SHARE * 100}% of patients on either device stop at a random time (realism), which scales both groups alike. Read: patients with a reading in ${D0} to ${D(addDays(EARLY_END, -1))}; retained = any reading ${D(LATE_START)} to ${D(DATASET_END)}; bluetooth / cellular reads 1 - ${BT_LAPSE_SHARE}.`,
		mixpanelReport: { type: "Insights (cohort)", cohort: `did reading logged ${D0} to ${D(addDays(EARLY_END, -1))}`, event: "reading logged", measure: `uniques ${D(LATE_START)} to ${D(DATASET_END)} / cohort size`, breakdown: "user property device_connectivity" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H5_SQL },
				select: { b: { where: { grp: "bluetooth" } }, c: { where: { grp: "cellular" } } },
				expect: { metric: "b.retained / c.retained", op: "between", target: band(1 - BT_LAPSE_SHARE) },
				minCohort: 400,
			},
		],
	},
	{
		id: "H6-no-shows-by-lead-time",
		hook: "H6",
		archetype: "funnel-conversion-by-segment",
		narrative: `Primary care appointments booked further ahead are missed more often: P(missed) = ${NOSHOW_BASE} + ${NOSHOW_PER_DAY} x lead_days (${NOSHOW_BASE * 100}% same day, ${Math.round(noShowRate(14) * 1000) / 10}% at two weeks). lead_days is on "appointment booked"; a missed appointment fires "appointment missed" (server-side) 15 minutes after the slot. Read: per appointment (hold visit_id constant), bookings ${D0} to ${D(addDays(BOOKING_READ_END, -1))}: the linear slope of the no-show rate on lead_days reads ${NOSHOW_PER_DAY}, and the rate for ${LEAD_LONG_FROM}+ days reads ${NOSHOW_LONG} (the LEAD_WEIGHTS mix of the line).`,
		mixpanelReport: { type: "Funnels", steps: ["appointment booked", "appointment missed"], counting: "totals", holdPropertyConstant: "visit_id", window: `${FUNNEL_WINDOW_DAYS} days`, dateRange: `${D0} to ${D(addDays(BOOKING_READ_END, -1))}`, breakdown: "lead_days" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H6_SQL },
				select: { a: { where: { grp: "all" } } },
				// single ref: the knob-derived floor (0.8 x knob) gives the effect side,
				// so a slope past the far edge grades STRONG, not NONE
				expect: { metric: "a.slope", op: "between", target: band(NOSHOW_PER_DAY), floor: Number((NOSHOW_PER_DAY * NOSHOW_FLOOR_SHARE).toPrecision(4)) },
				minCohort: 3000,
			},
			{
				breakdown: { type: "duckdb", sql: H6_SQL },
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.noshow_long", op: "between", target: band(NOSHOW_LONG), floor: Number((NOSHOW_LONG * NOSHOW_FLOOR_SHARE).toPrecision(4)) },
				minCohort: 3000,
			},
		],
	},
	{
		id: "H7-therapist-choice-wait",
		hook: "H7",
		archetype: "funnel-ttc-by-segment",
		narrative: `New therapy clients pick a therapist at intake (therapist_preference on "therapy intake completed"): first_available or specific_therapist. Time from intake to the first session is log-normal (median ${THERAPY_FIRST_MEDIAN_H} h) for first_available and ${SPECIFIC_THERAPIST_MULT}x for specific_therapist; sessions start on US afternoon/evening hours. Read: per client, first "therapy session completed" within ${FUNNEL_WINDOW_DAYS} days of the intake, intakes before ${D(BOOKING_READ_END)}; median hours, specific / first_available reads ${SPECIFIC_THERAPIST_MULT}.`,
		mixpanelReport: { type: "Funnels", steps: ["therapy intake completed", "therapy session completed"], counting: "uniques", window: `${FUNNEL_WINDOW_DAYS} days`, dateRange: `${D0} to ${D(addDays(BOOKING_READ_END, -1))}`, measure: "median time to convert", breakdown: "therapist_preference" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H7_SQL },
				select: { s: { where: { grp: "specific_therapist" } }, f: { where: { grp: "first_available" } } },
				expect: { metric: "s.med_hours / f.med_hours", op: "between", target: band(SPECIFIC_THERAPIST_MULT) },
				minCohort: 200,
			},
			{
				breakdown: { type: "duckdb", sql: H7_SQL },
				select: { f: { where: { grp: "first_available" } } },
				expect: { metric: "f.med_hours", op: "between", target: band(THERAPY_FIRST_MEDIAN_H) },
				minCohort: 300,
			},
		],
	},
	{
		id: "H8-self-pay-price-cut",
		hook: "H8",
		archetype: "temporal-inflection",
		narrative: `On ${D(SELF_PAY_PRICE_CHANGE)} the self-pay urgent visit price drops $${SELF_PAY_PRICE[0]} → $${SELF_PAY_PRICE[1]} (patient_cost_usd on "visit requested"; list price and revenue in warehouse visit_revenue_daily). After a symptom check routed to a virtual visit, self-pay patients request a visit ${REQUEST_RATE_SELF_PAY * 100}% of the time before and ${SELF_PAY_LIFT}x after (${Math.round(REQUEST_RATE_SELF_PAY * SELF_PAY_LIFT * 100)}%); insured patients stay at ${REQUEST_RATE_INSURED * 100}%. Read: visit requests per symptom check, after / before, by coverage. Revenue needs the warehouse: self-pay urgent patient revenue per self-pay symptom check reads ${SELF_PAY_LIFT} x ${SELF_PAY_PRICE[1]}/${SELF_PAY_PRICE[0]} = ${(SELF_PAY_LIFT * PRICE_RATIO).toFixed(3)} (the cut buys volume, not revenue).`,
		mixpanelReport: { type: "Insights + warehouse", events: ["visit requested", "symptom check completed"], formula: "A / B", breakdown: "coverage_type", chart: `before vs after ${D(SELF_PAY_PRICE_CHANGE)}`, join: "visit_revenue_daily (urgent_care, self_pay).patient_revenue_usd on date" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H8_SQL },
				select: { a: { where: { grp: "after_self_pay" } }, b: { where: { grp: "before_self_pay" } } },
				expect: { metric: "a.request_rate / b.request_rate", op: "between", target: band(SELF_PAY_LIFT) },
				minCohort: 500,
			},
			{
				breakdown: { type: "duckdb", sql: H8_SQL },
				select: { a: { where: { grp: "after_insured" } }, b: { where: { grp: "before_insured" } } },
				// control: insured patients' prices did not change
				expect: { metric: "a.request_rate / b.request_rate", op: "between", target: band(1) },
				minCohort: 2000,
			},
			{
				breakdown: { type: "duckdb", sql: H8_REV_SQL },
				select: { a: { where: { grp: "after" } }, b: { where: { grp: "before" } } },
				// confounded (staffing gap and Async ramp in the before period, respiratory
				// season after, claim posting lag at the boundary): knob target with a
				// knob-derived floor, graded STRONG when it is not within ±10%
				expect: { metric: "a.revenue_per_check / b.revenue_per_check", op: ">=", target: REVENUE_KNOB, floor: Math.round(REVENUE_FLOOR_SHARE * REVENUE_KNOB * 1000) / 1000 },
				minCohort: 500,
			},
		],
	},
	{
		id: "H9-respiratory-season",
		hook: "H9",
		archetype: "bespoke",
		narrative: `Respiratory season starts mid-September: from ${D(RESP_WAVE_START)} respiratory symptom checks ramp up, and from ${D(RESP_WAVE_PEAK)} they run at ${RESP_WAVE_MULT}x their summer rate relative to every other reason. Each extra check is a full visit flow (request, waiting room, visit, prescription), drawn in proportion to urgent activity and placed on another active day of the same patient within a few days (never within 24 h of another urgent visit), so the other reasons are untouched and repeat visits stay rare. Read: respiratory / non-respiratory symptom checks, ${D(RESP_WAVE_PEAK)} to ${D(DATASET_END)} vs ${D0} to ${D(addDays(RESP_WAVE_START, -1))}, reads ${RESP_WAVE_MULT} (the ratio cancels the growth of the patient base).`,
		mixpanelReport: { type: "Insights", event: "symptom check completed", breakdown: "reason_category", chart: "weekly line; respiratory / all other reasons" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H9_SQL },
				select: { p: { where: { grp: "peak" } }, b: { where: { grp: "baseline" } } },
				expect: { metric: "p.resp_per_other / b.resp_per_other", op: "between", target: band(RESP_WAVE_MULT) },
				minCohort: 2000,
			},
		],
	},
	{
		id: "H10-spanish-wait-gap",
		hook: "H10",
		archetype: "cohort-prop-scale",
		narrative: `Patients whose preferred_language is es are routed to the Spanish-speaking clinician pool (about ${SPANISH_HOURS_SHARE.urgent_care * 100}% of urgent clinician hours in clinician_staffing_daily, while about ${SPANISH_SHARE * 100}% of patients prefer Spanish). Their estimated waits for live urgent-care visits are ${SPANISH_WAIT_MULT}x, so they leave the waiting room more often (H2). The staffing gap (H3) and busy hours scale both languages alike. Read: average estimated_wait_min, es / en, live requests.`,
		mixpanelReport: { type: "Insights", event: "visit requested", filter: "visit_type ≠ async", measure: "average estimated_wait_min", breakdown: "preferred_language" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H10_SQL },
				select: { s: { where: { grp: "es" } }, e: { where: { grp: "en" } } },
				expect: { metric: "s.avg_wait / e.avg_wait", op: "between", target: band(SPANISH_WAIT_MULT) },
				minCohort: 800,
			},
		],
	},
];

export default config;
