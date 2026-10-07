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
 * NAME:       Penny Harbor
 * APP:        US mobile bank (iOS and Android). Members open a checking account
 *             in the app, verify their identity, fund it, and get a Visa debit
 *             card. Features: direct deposit (payroll lands in Penny Harbor),
 *             Pockets (savings sub-accounts that earn APY), Round-Ups (from
 *             2026-07-14), Send (P2P and external transfers, instant for a fee),
 *             Bill Pay with AutoPay, Float (fee-free cash advance for members
 *             with direct deposit, repaid from the next paycheck), Harbor Invest
 *             (fractional stocks and ETFs), and budgets. Plans: Free, Plus
 *             ($4.99/month), Premium ($11.99/month, priority support).
 * SCALE:      10,000 members (≈4,000 open their account inside the window),
 *             ~1.1M events, 120 days (2026-06-04 → 2026-10-01, UTC)
 * CORE LOOP:  app opened → balance checked; card transaction; direct deposit
 *             received → card spend, bills, Pockets
 * VALUE MOMENT: direct deposit set up (Penny Harbor becomes the primary account)
 *
 * EVENTS (24):
 *   card transaction > app opened > balance checked > savings deposit > bill paid
 *   > transfer sent > direct deposit received > budget created > investment order
 *   placed > plan comparison viewed > biller added > float advance taken / repaid
 *   > card locked > support ticket opened / resolved > account opened > identity
 *   verified > round-ups enabled > $experiment_started > account funded > autopay
 *   enabled > direct deposit set up > plan upgraded
 *   (hook-generated from schedules: bill paid, direct deposit set up / received,
 *   float advance taken / repaid, round-ups enabled, Round-Up savings deposits)
 *
 * FUNNELS (12):
 *   - Onboarding (first funnel, two copies by credit_history, H1):
 *       account opened → identity verified → account funded
 *       (74% established credit file, 41% thin file; median time to fund
 *       3 h vs 30 h, lognormal per member)
 *   - Money check: app opened → balance checked (85%)
 *   - Card spend: card transaction (single step)
 *   - Send money: app opened → transfer sent (60%)
 *   - Save: app opened → savings deposit (55%, source = manual)
 *   - Invest: app opened → investment order placed (40%)
 *   - Budget: app opened → budget created (40%)
 *   - Bill setup: biller added → autopay enabled (35%, biller_id per biller,
 *       A/B "Autopay Default" from 2026-07-21, H6)
 *   - Support: support ticket opened → support ticket resolved (90%, ticket_id;
 *       70% of engine tickets kept)
 *   - Upgrade (Free members): plan comparison viewed → plan upgraded (4%)
 *   - catch-all (engine): app opened, balance checked, card locked
 *
 * USER PROPS:  customer_segment, credit_history, acquisition_channel, plan_tier,
 *              customer_since, age_band, pay_frequency, direct_deposit_active,
 *              round_ups_enabled, "Experiment: Autopay Default" (enrolled)
 * SUPER PROPS: plan_tier (plan at event time: free / plus / premium)
 * SCD PROPS:   none
 * GROUPS:      none
 * WAREHOUSE:   paid_acquisition_daily (spend by paid channel),
 *              card_authorizations_daily (card processor health by payment channel),
 *              pocket_savings_daily (Pocket deposits, withdrawals, APY, interest,
 *              balance by plan)
 * LOOKUPS:     none — merchant, biller, and plan attributes are denormalized
 *              onto events and profiles
 * SOUP:        consumer week (Friday high, Sunday low), US daytime and evening
 *              hours in UTC (quiet 05-10 UTC)
 *
 * IDENTITY: "account opened" is the auth event and the first event of every new
 * member (carries user_id + device_id). Every event carries user_id; there is no
 * anonymous pre-signup activity. The two onboarding steps after it (identity
 * verified, account funded), card transactions (the card processor feed), and
 * every server-side event (direct deposit received, float advance repaid,
 * AutoPay bill payments, Round-Up savings deposits, support ticket resolved)
 * carry user_id only and no device or session fields. App events also carry
 * device_id and session_id (about 2 devices per member: phones and tablets;
 * device fields are sticky per device).
 *
 * DESIGN NOTES:
 * - Server-side money movement is generated in the everything hook from
 *   per-member schedules: payroll paydays (weekly gig payouts Mon-Thu /
 *   biweekly Friday / semimonthly 15th and month-end; a payday on a weekend or
 *   a Federal Reserve holiday posts the business day before), monthly bills per
 *   biller (rent on the 1st, other due days cluster on the 1st and 15th;
 *   AutoPay posts on the next business day), Float advances inside a pay cycle
 *   repaid with the next paycheck, and Round-Up sweeps the morning after a day
 *   with approved card purchases. Each spawned event is a clone of one of the
 *   member's own events with its event-specific keys replaced (spawnEvent):
 *   member-initiated spawns clone the member's nearest event with a device,
 *   server-side spawns drop device fields.
 * - Warm start: established members already have billers, direct deposit,
 *   Float advances in flight, and open support tickets. 11% of established
 *   members opened their account in the 30 days before June 4 (the in-window
 *   rate of funded signups) and follow the new-member direct-deposit path from
 *   their opening day, so June's DD setups and dark cuts start at the steady
 *   rate instead of ramping up.
 * - Onboarding: each new member's time to fund is a salted lognormal (sigma
 *   0.9) around the credit-file median, truncated inside the 7-day window;
 *   no money moves before the account is funded. The engine gives usage
 *   funnels only to members who finish the first funnel. Members who never
 *   fund the account have no money to move: their card and budget events go,
 *   their balance is 0, 75% abandon in their first week, and the rest keep a
 *   salted 20-50% of their app visits.
 * - New members: retentionCurve thins activity over the member's life; on top
 *   of it H2's dark cut hits members without direct deposit, and an organic
 *   lapse (55% of funded new members, truncated exponential day 1-100, scale
 *   20 days) hits everyone. An adopter who lapses early still finishes the
 *   direct deposit switch first, so the lapse is independent of the H2 split.
 *   Lapses cut member-initiated events only; paychecks, AutoPay bills, Float
 *   repayments, and ticket resolutions keep posting.
 * - Card realism: merchant names and amounts follow the merchant category;
 *   online-only categories use the online channel; declines are 2-10% by
 *   segment with reasons that fit the channel. Balances follow the pay cycle
 *   for members with direct deposit (high after payday, low before the next).
 * - Experiment exposure: the engine emits one $experiment_started per member,
 *   1 s before the first bill-setup run after the start date.
 * - Warehouse: paid_acquisition_daily spend comes from automated bidding
 *   against a cost-per-signup target (target × previous 7 days' average
 *   signups, weekday delivery shape, ±14% seeded noise, never zero), so it
 *   tracks signups loosely (audit corr ≈ 0.1) and the window cost per signup
 *   holds at the target. card_authorizations_daily counts processor
 *   authorizations, including incremental, stand-in, and merchant-initiated
 *   ones the app never logs (corr ≈ 0.95). pocket_savings_daily adds ACH pulls
 *   into Pockets made outside the app, subtracts returned deposits, and
 *   accumulates the balance from deposits − withdrawals + interest (corr ≈ 0.96).
 */

// ── HOOK STORIES ──
/*
 * All effects are hidden: no flag properties. Each is found by a breakdown, a
 * date comparison, or a cohort. Dates live in the TIMELINE constants and are
 * shared by hooks, stories, SQL, warehouse columns, and the timeline guide.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H1. THIN-FILE ONBOARDING FRICTION (declarative duplicate first funnels)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: new applicants with a thin credit file (credit_history =
 *   thin_file) need document review, so they finish onboarding at 41% vs 74%
 *   for established files (0.55x), and take about a day to fund instead of
 *   a few hours (median time to fund 30 h vs 3 h; each member's time is a
 *   salted lognormal with sigma 0.9, so review has a tail of several days).
 * MIXPANEL: Funnels, account opened → identity verified → account funded,
 *   7-day window, breakdown user property credit_history.
 * REAL WORLD: database identity checks clear established files instantly;
 *   thin files wait on a document upload and manual review.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H2. DIRECT DEPOSIT IN THE FIRST TWO WEEKS (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: funded new members who do not set up direct deposit within 14 days
 *   of opening: half of them go dark, each on a salted day between day 8 and
 *   day 29 (density rising with time, about 16% before day 14: a gradual
 *   slide, not a cliff). Adoption is salted per
 *   member (rate by acquisition channel), independent of how active the
 *   member is. Day-30 retention (app opened in days 30-36) of DD-in-14-days
 *   members is 1 / (1 − 0.5) = 2x the rest.
 * MIXPANEL: Funnels, account opened → direct deposit set up, 14-day window,
 *   filter did account funded; save converters and non-converters as
 *   cohorts; Retention, account opened → app opened, custom bracket day
 *   30-36, breakdown by those cohorts.
 * REAL WORLD: the paycheck makes a bank the primary account.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H3. ROUND-UPS LAUNCH (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: Round-Ups launch 2026-07-14. 35% of members turn it on, each on a
 *   salted day in the 21 days after launch ("round-ups enabled" at an app
 *   visit; later joiners at their first visit). From then on, every day with
 *   approved card purchases produces a Round-Up sweep the next morning: a
 *   "savings deposit" with source = round_up and amount = the day's spare
 *   change times the member's multiplier. Nothing before launch; manual
 *   Pocket deposits do not change (honest null).
 * MIXPANEL: Insights, savings deposit, uniques, breakdown source, weekly;
 *   share of purchasing members with a round_up deposit after the ramp.
 * REAL WORLD: automatic micro-saving reaches members who never save by hand.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H4. MOBILE WALLET OUTAGE (everything + warehouse card_authorizations_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-08-20 to 2026-08-21 (UTC), the card processor's tokenization
 *   service fails: 65% of would-be approved contactless_wallet transactions
 *   are declined (decline_reason = technical_error). Half the declined
 *   members retry with the chip within minutes; 12% of declines lead to a
 *   support ticket (issue_type = card_declined). The warehouse shows
 *   processor_status = major_outage and tokenization_error_rate ≈ 0.65 for
 *   the wallet channel on those days.
 * MIXPANEL: Insights, card transaction, share authorization_status =
 *   approved, daily, breakdown payment_channel; join the warehouse status.
 * REAL WORLD: a wallet token outage looks like "my card doesn't work" until
 *   someone checks the processor dashboard.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H5. PAID CHANNEL ECONOMICS (everything + warehouse paid_acquisition_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: window spend per Mixpanel signup is $38 paid social, $52 app store
 *   ads, $72 search ads, $115 comparison sites. Share of funded members who
 *   set up direct deposit within 14 days: comparison sites 0.62, referral
 *   0.55, organic 0.45, search 0.45, app store 0.32, paid social 0.18 — the
 *   cheapest signups are the most expensive direct-deposit customers.
 * MIXPANEL: Insights, account opened by acquisition_channel joined to
 *   paid_acquisition_daily.spend_usd; Funnels account opened → direct deposit
 *   set up, 14-day window, date range 2026-06-04 to 2026-09-17 (every signup
 *   has its full 14 days), breakdown acquisition_channel.
 * REAL WORLD: comparison-site shoppers are switching banks on purpose; social
 *   ad installs are curious, not committed.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H6. AUTOPAY DEFAULT EXPERIMENT (declarative funnel experiment)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-07-21 members who add a biller split 50/50; "Autopay On"
 *   pre-selects AutoPay and multiplies the share of new billers with AutoPay
 *   by 1.6 (35% → 56%). Biller adds per member do not change (honest null).
 * MIXPANEL: Funnels, biller added → autopay enabled, totals, hold biller_id
 *   constant, 1-day window, date range 2026-07-21 to 2026-10-01 (billers
 *   added before the test count in both arms otherwise), breakdown user
 *   property "Experiment: Autopay Default".
 * REAL WORLD: defaults decide most settings.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H7. MANUAL BILL PAYERS PAY LATE (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: a bill paid by hand is late 18% of the time; an AutoPay payment
 *   is late 3% of the time (insufficient funds, retried). Every bill payment
 *   comes from a biller's monthly schedule; AutoPay applies from the moment
 *   it is turned on for that biller.
 * MIXPANEL: Insights, bill paid, total, breakdown autopay and payment_status.
 * REAL WORLD: people forget due dates; machines do not.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H8. SUMMER SAVER BOOST (everything + warehouse pocket_savings_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-08-03 to 2026-09-30 Plus and Premium Pockets earn 5.00% APY
 *   (from 3.50% / 4.00%); Free stays 0.50%. Plus and Premium members (plan at
 *   event time) make 1.5x the manual Pocket deposits per app visit; Free is
 *   unchanged. The rates exist only in the warehouse.
 * MIXPANEL: Insights, savings deposit (source = manual) and app opened,
 *   formula A/B, breakdown plan_tier, weekly; 8 boost weeks vs the 8 weeks
 *   before; join pocket_savings_daily.apy_pct.
 * REAL WORLD: a rate bump pulls idle cash into savings.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H9. PREMIUM PRIORITY SUPPORT (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: time from ticket opened to resolved is 0.4x for Premium members
 *   (plan when the ticket was opened) vs Free and Plus.
 * MIXPANEL: Funnels, support ticket opened → support ticket resolved, hold
 *   ticket_id constant, median time to convert, breakdown plan_tier, 30-day
 *   window (the Mixpanel default).
 * REAL WORLD: a dedicated queue with more agents per ticket.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H10. BUDGET MAGIC NUMBER (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: members who create 3 or more budgets in the window put 1.6x as
 *   much into each manual Pocket deposit as members with 0-2 budgets (a step
 *   at 3, flat on either side). It is a member trait (planners save more
 *   across the window), not a change at the moment of the third budget.
 * MIXPANEL: Insights, savings deposit (source = manual), average amount,
 *   breakdown by cohorts on the count of budget created (0-1 / 2 / 3+).
 * REAL WORLD: members who plan their spending know what they can set aside.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * EXPECTED METRICS SUMMARY (measured: data/verify-fintech, 2026-10-07)
 * ═════════════════════════════════════════════════════════════════════════
 * Hook | Metric                                        | Derivation              | Expected | Measured
 * -----|-----------------------------------------------|-------------------------|----------|---------
 * H1   | 7-day onboarding thin_file / established      | 41 / 74                 | 0.554    | 0.558 (40.8% vs 73.0%)
 * H1   | median time to fund thin_file / established   | ONBOARD_TTC_H 30 / 3    | 10.0     | 9.21 (27.5 h vs 3.0 h; p90 78.6 h vs 9.2 h)
 * H2   | D30 retention DD-in-14d / rest, funded new    | 1 / (1 − DARK_SHARE)    | 2.00     | 1.825 (47.5% vs 26.0%)
 * H3   | round_up deposits before launch               | exact purity            | 0        | 0
 * H3   | purchasers with a round_up deposit, post-ramp | ROUNDUP_ADOPT           | 0.35     | 0.340
 * H4   | wallet / other approval, outage vs ±7 days    | 1 − OUTAGE_FAIL         | 0.35     | 0.339 (32.3% vs 94.5% wallet)
 * H4   | warehouse tokenization_error_rate, outage     | OUTAGE_FAIL             | 0.65     | 0.660
 * H5   | spend per signup comparison / paid social     | 115 / 38                | 3.03     | 3.038 ($115.82 vs $38.13)
 * H5   | DD-in-14d per signup comparison / paid social | 0.62 / 0.18 (floor 2.22)| 3.44     | 3.626 (40.7% vs 11.2%)
 * H6   | per-biller AutoPay Autopay On / Control       | AUTOPAY_DEFAULT_MULT    | 1.60     | 1.571 (56.5% vs 36.0%)
 * H6   | Autopay On share of exposed members           | equal 2-arm hash        | 0.50     | 0.508
 * H7   | late share, paid by hand                      | LATE_SHARE.manual       | 0.18     | 0.174
 * H7   | late share, AutoPay                           | LATE_SHARE.autopay      | 0.03     | 0.028
 * H8   | manual deposits per visit Plus+Premium, boost | BOOST_DEPOSIT_MULT      | 1.50     | 1.485
 * H8   | same, Free (control)                          | unchanged               | 1.00     | 0.991
 * H9   | median resolution Premium / Free+Plus         | SUPPORT_PLAN_MULT       | 0.40     | 0.395 (6.6 h vs 16.8 h)
 * H10  | avg manual deposit 3+ budgets / 0-2           | BUDGET_SAVE_MULT        | 1.60     | 1.605 ($165.91 vs $103.36)
 * H10  | avg manual deposit 2 budgets / 0-1 (control)  | flat below threshold    | 1.00     | 0.996
 * ═════════════════════════════════════════════════════════════════════════
 *
 * H5's direct-deposit read uses the knob ratio as target with a floor at
 * half the effect, because paid social has under 100 direct-deposit
 * customers in the 14-day cohort (88 here; relative SE about 12%); this run
 * lands inside the ±10% band. H2's D30 ratio carries a relative SE of about
 * 6.5% (748 vs 1,042 members), so it reads low in this seed while staying
 * inside the band. Every other read is inside its knob ±10% band. Honest
 * nulls the eval checks: Round-Ups did not change manual Pocket deposits
 * (1.00x, z ≈ −0.1), card spending on the Federal Reserve holidays matched
 * the same weekdays (|z| ≤ 1.1), and members hit by the wallet outage did
 * not cut card use afterwards (z ≈ −0.2 against wallet users who also used
 * their card on the outage days).
 */

// ── SCALE ──
const SEED = "harness-fintech";
const NUM_USERS = 10_000;
const DATASET_START = "2026-06-04T00:00:00Z";
const DATASET_END = "2026-10-01T23:59:59Z"; // 120 days
const EVENTS_PER_DAY = 1.2;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── TIMELINE (shared by hooks, stories, SQL, warehouse columns, guides) ──
const ROUNDUPS_LAUNCH = "2026-07-14T00:00:00Z";     // Round-Ups launch
const AUTOPAY_TEST_START = "2026-07-21T00:00:00Z";  // "Autopay Default" A/B starts
const BOOST_START = "2026-08-03T00:00:00Z";         // Summer Saver Boost (Plus/Premium 5.00% APY)
const BOOST_END = "2026-10-01T00:00:00Z";           // exclusive: through Sep 30
const OUTAGE_START = "2026-08-20T00:00:00Z";        // processor tokenization outage (wallet payments)
const OUTAGE_END = "2026-08-22T00:00:00Z";          // exclusive (2 days)
const BANK_HOLIDAYS = ["2026-06-19", "2026-07-03", "2026-09-07"]; // Federal Reserve holidays in the window

const ms = (iso) => dayjs.utc(iso).valueOf();
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;
const START_MS = ms(DATASET_START);
const END_MS = ms(DATASET_END);

// ── WEEKLY AND DAILY RHYTHM (soup) ──
// Sun..Sat: paydays make Friday the busiest day; Sunday is the quietest.
const DOW_WEIGHTS = [0.8, 0.96, 0.95, 0.96, 1.0, 1.12, 0.9];
// UTC hours: US members, so the day starts around 11-12 UTC (7-8am ET) and
// runs into the US evening (00-03 UTC); the quiet hours are the US night.
const HOUR_WEIGHTS = [0.9, 0.78, 0.62, 0.46, 0.32, 0.22, 0.16, 0.13, 0.14, 0.2, 0.3, 0.45,
	0.6, 0.72, 0.8, 0.86, 0.9, 0.93, 0.94, 0.92, 0.92, 0.95, 1.0, 0.97];

// ── KNOBS ──
// segments (personas) and credit files
const SEGMENTS = {
	everyday: { weight: 38, mult: 1.0 },
	tight_budget: { weight: 24, mult: 1.15 },
	saver: { weight: 14, mult: 0.85 },
	gig_worker: { weight: 14, mult: 1.3 },
	student: { weight: 10, mult: 0.8 },
};
const THIN_FILE_SHARE = { student: 0.7, gig_worker: 0.35, everyday: 0.2, tight_budget: 0.25, saver: 0.1 };

// H1 onboarding by credit file (declarative duplicate first funnels)
const ONBOARD_CONV = 74;
const THIN_FILE_MULT = 0.55;
const THIN_ONBOARD_CONV = Math.round(ONBOARD_CONV * THIN_FILE_MULT); // 41
const ONBOARD_TTC_H = { established: 3, thin_file: 30 }; // median time to fund (funnel knob and hook median)
const ONBOARD_TTC_SIGMA = 0.9;     // per-member lognormal spread of time to fund (document review has a long tail)
const ONBOARD_TTC_MAX_DAYS = 6.9;  // truncation: every funded member funds inside the 7-day funnel window
const VERIFY_SHARE = { established: [0.02, 0.15], thin_file: [0.55, 0.9] }; // share of time to fund spent before identity verified
const ONBOARD_STEPS = ["account opened", "identity verified", "account funded"];

// onboarding abandonment for members who never fund the account
const UNFUNDED_ABANDON_SHARE = 0.75;
const UNFUNDED_ABANDON_DAYS = [0.5, 6];
const UNFUNDED_KEEP = [0.2, 0.5];

// H2 direct deposit in the first 14 days → retention
const DD_WINDOW_DAYS = 14;
const DARK_SHARE = 0.5;            // funded new members without DD in 14 days who go dark
const DARK_DAYS = [8, 29.5];       // each dark member's last day: salted, density rising toward day 29.5, all before the day-30 bracket
const DARK_SKEW = 0.7;             // day = lo + (hi - lo) × r^DARK_SKEW: about 16% of dark cuts land before day 14
const LATE_DD_SHARE = 0.12;        // non-adopters who set up DD on day 15-60 (if still active)
const LATE_DD_DAYS = [15, 60];
const LAPSE_SHARE = 0.55;          // organic lapse, every funded new member (early-life decay)
const LAPSE_DAYS = [1, 100];       // truncated exponential on this range
const LAPSE_SCALE_DAYS = 20;       // exponential scale: most lapses come in the first weeks
const RETENTION_DAY = 30;
const PREEXISTING_DD_SHARE = 0.55; // established members with DD from before June 4
const DD_SWITCH_SHARE = 0.04;      // established members without DD who switch it in during the window
const RECENT_JOINER_SHARE = 0.11;  // established members who opened their account in the 30 days before June 4
const RECENT_JOINER_DAYS = 30;     // (the in-window signup rate, so first-weeks pipelines start warm)

// H5 paid channel economics (warehouse paid_acquisition_daily)
const CHANNEL_WEIGHTS = { organic: 24, referral: 16, paid_social: 22, search_ads: 14, app_store_ads: 12, comparison_sites: 12 };
const PAID_CHANNELS = ["paid_social", "search_ads", "app_store_ads", "comparison_sites"];
const DD_ADOPT = { comparison_sites: 0.62, referral: 0.55, organic: 0.45, search_ads: 0.45, app_store_ads: 0.32, paid_social: 0.18 };
const CPL_USD = { paid_social: 38, search_ads: 72, app_store_ads: 52, comparison_sites: 115 };
const BORN_PCT = 40;
const WINDOW_DAYS = 120;

// expected signups per day by paid channel (the media plan)
const PLAN_SIGNUPS_PER_DAY = Object.fromEntries(PAID_CHANNELS.map((ch) => {
	const totalW = Object.values(CHANNEL_WEIGHTS).reduce((a, b) => a + b, 0);
	return [ch, (NUM_USERS * BORN_PCT / 100) * (CHANNEL_WEIGHTS[ch] / totalW) / WINDOW_DAYS];
}));
// Sun..Sat, mean 1: delivery follows the weekly signup rhythm, with a flat floor
const SPEND_FLAT_SHARE = 0.4;
const SPEND_WEEKDAY = (() => {
	const m = DOW_WEIGHTS.reduce((a, b) => a + b, 0) / DOW_WEIGHTS.length;
	return DOW_WEIGHTS.map((w) => SPEND_FLAT_SHARE + (1 - SPEND_FLAT_SHARE) * w / m);
})();
const SPEND_NOISE = 0.14;
// automated bidding against a cost-per-signup target: each day's budget is the
// target × the channel's average daily signups over the previous 7 days (the
// media plan fills the first week), weekday delivery shape, seeded noise
const SPEND_LOOKBACK_DAYS = 7;
const PLATFORM_INSTALL_INFLATION = 1.2;
const CPC_USD = { paid_social: 1.1, search_ads: 3.4, app_store_ads: 1.6, comparison_sites: 6.5 };
const CTR = { paid_social: 0.009, search_ads: 0.045, app_store_ads: 0.03, comparison_sites: 0.02 };

// H3 Round-Ups
const ROUNDUP_ADOPT = 0.35;
const ROUNDUP_RAMP_DAYS = 21;
const ROUNDUP_MULTIPLIERS = [1, 1, 1, 1, 2, 2, 3];

// H4 wallet outage (warehouse card_authorizations_daily)
const OUTAGE_CHANNEL = "contactless_wallet";
const OUTAGE_FAIL = 0.65;          // share of would-be approved wallet transactions declined
const OUTAGE_RETRY = 0.5;          // declined members who retry with the chip
const OUTAGE_TICKET = 0.12;        // declined transactions that lead to a support ticket
const BASE_DECLINE = { tight_budget: 0.1, student: 0.05, gig_worker: 0.05, everyday: 0.035, saver: 0.02 };

// H6 Autopay Default experiment on the bill setup funnel
const AUTOPAY_EXPERIMENT = "Autopay Default";
const AUTOPAY_VARIANT = "Autopay On";
const EXP_KEY = `Experiment: ${AUTOPAY_EXPERIMENT}`;
const AUTOPAY_CONV = 35;
const AUTOPAY_DEFAULT_MULT = 1.6;

// H7 late payments by payment method
const LATE_SHARE = { manual: 0.18, autopay: 0.03 };
const PREEXISTING_AUTOPAY_SHARE = 0.42;
const PREEXISTING_BILLERS = [0.1, 0.22, 0.3, 0.23, 0.15]; // P(0..4 billers) for established members

// H8 Summer Saver Boost (warehouse pocket_savings_daily)
const PAID_PLANS = ["plus", "premium"];
const APY_BASE = { free: 0.5, plus: 3.5, premium: 4.0 };
const APY_BOOST = 5.0;
const BOOST_DEPOSIT_MULT = 1.5;
const BOOST_READ_DAYS = 56;        // story read: first 8 boost weeks vs the 8 weeks before

// H9 support resolution by plan
const SUPPORT_PLAN_MULT = { premium: 0.4, plus: 1, free: 1 };
const RESOLVE_MEDIAN_H = 20;
const CHANNEL_SPEED = { chat: 0.7, phone: 0.5, email: 1.6, in_app: 1.0 };
const TICKET_KEEP = 0.7;           // share of engine support units kept (realistic contact rate)
const CARRYOVER_TICKET_SHARE = 0.003; // established members with a ticket still open on June 4 (≈ open-ticket backlog)
const CARRYOVER_ISSUES = ["card", "card", "transfer", "transfer", "account_access", "fees", "direct_deposit", "dispute"];

// H10 budget magic number
const BUDGET_MAGIC = 3;
const BUDGET_SAVE_MULT = 1.6;

// plans
const PLAN_FEE = { plus: 4.99, premium: 11.99 };
const FLOAT_LIMIT = { free: 50, plus: 150, premium: 250 };
const FLOAT_CYCLE_P = { tight_budget: 0.35, gig_worker: 0.2, student: 0.18, everyday: 0.07, saver: 0.02 };

// ── DATA ARRAYS ──
const MERCHANTS = {
	grocery: ["Greenbasket Market", "FreshWay Foods", "Corner Pantry", "Harvest Fair Grocers", "ValueCart"],
	dining: ["Lucky Noodle", "Burger Barn", "Bean & Brew Coffee", "Taqueria Sol", "Slice House Pizza", "Main Street Diner"],
	gas: ["QuickFuel", "Liberty Gas", "RoadStar Fuel", "Pine Ridge Station"],
	retail: ["Hartwell Department Store", "Thread & Co", "HomeGoods Depot", "Bright Pharmacy"],
	online_shopping: ["ShopStream", "Parcelly", "Crate & Click", "BargainBay Online"],
	subscriptions: ["StreamFlix", "TuneBox Music", "CloudVault Storage", "FitPulse App"],
	travel: ["SkyHop Airlines", "Wayfarer Hotels", "Metro Rideshare", "Coastline Car Rental"],
	entertainment: ["Starlight Cinemas", "Arcade Alley", "TicketHub", "Bowl-a-Rama"],
	health: ["Bright Pharmacy", "Clearview Eye Care", "Wellspring Clinic"],
};
const MERCHANT_MEDIAN = { grocery: 46, dining: 21, gas: 38, retail: 42, online_shopping: 36, subscriptions: 13, travel: 135, entertainment: 31, health: 27 };
const ONLINE_ONLY = new Set(["online_shopping", "subscriptions"]);
const BILLER_TYPES = {
	rent: { w: 10, lo: 850, hi: 2400, vary: 0 },
	utilities: { w: 18, lo: 60, hi: 220, vary: 0.25 },
	mobile_phone: { w: 20, lo: 35, hi: 120, vary: 0.04 },
	internet: { w: 14, lo: 45, hi: 95, vary: 0 },
	insurance: { w: 12, lo: 70, hi: 260, vary: 0 },
	credit_card: { w: 12, lo: 40, hi: 650, vary: 0.5 },
	streaming: { w: 10, lo: 8, hi: 25, vary: 0 },
	loan: { w: 4, lo: 150, hi: 520, vary: 0 },
};
const BILLER_LIST = Object.entries(BILLER_TYPES).flatMap(([k, v]) => Array(v.w).fill(k));
const BALANCE_MEDIAN = { tight_budget: 180, student: 340, gig_worker: 620, everyday: 1400, saver: 4600 };
const PAYCHECK_MEDIAN = { weekly: 520, biweekly: 1650, semimonthly: 1900 };

// ── HELPERS ──
const salt = (uid, tag) => hashFloat(`${uid}|${tag}`);
const round2 = (n) => Math.round(n * 100) / 100;
const round1 = (n) => Math.round(n * 10) / 10;
const T = (e) => dayjs.utc(e.time).valueOf();
const iso = (t) => new Date(t).toISOString();
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const dayStart = (t) => Math.floor(t / DAY_MS) * DAY_MS;
const between = (r, [lo, hi]) => lo + r * (hi - lo);
const logNormal = (median, sigma) => median * Math.exp(chance.normal({ mean: 0, dev: sigma }));
const jitter = (key, spread) => 1 + (hashFloat(key) - 0.5) * 2 * spread;
// inverse standard normal CDF (Acklam's rational approximation, |error| < 1.2e-9)
const probit = (p) => {
	const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
	const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
	const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
	const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
	const q0 = Math.min(Math.max(p, 1e-12), 1 - 1e-12);
	if (q0 < 0.02425) {
		const q = Math.sqrt(-2 * Math.log(q0));
		return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
	}
	if (q0 > 1 - 0.02425) {
		const q = Math.sqrt(-2 * Math.log(1 - q0));
		return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
	}
	const q = q0 - 0.5, r = q * q;
	return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
};
// standard normal CDF (Zelen-Severo, |error| < 7.5e-8)
const normCdf = (z) => {
	const t = 1 / (1 + 0.2316419 * Math.abs(z));
	const pdf = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
	const tail = pdf * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
	return z >= 0 ? 1 - tail : tail;
};
// salted lognormal draw (median, sigma) truncated above at max: inverse CDF on the kept mass
const truncLogNormal = (r, median, sigma, max) => median * Math.exp(sigma * probit(r * normCdf(Math.log(max / median) / sigma)));
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
const HOLIDAYS = new Set(BANK_HOLIDAYS);
const isBusinessDay = (t) => {
	const w = new Date(t).getUTCDay();
	return w !== 0 && w !== 6 && !HOLIDAYS.has(dayKey(t));
};
const prevBusinessDay = (t) => {
	let d = dayStart(t);
	while (!isBusinessDay(d)) d -= DAY_MS;
	return d;
};
const nextBusinessDay = (t) => {
	let d = dayStart(t);
	while (!isBusinessDay(d)) d += DAY_MS;
	return d;
};
// a member-hour time inside the day that starts at d (US daytime/evening, UTC)
const memberTime = (d) => d + (12 + chance.floating({ min: 0, max: 14 })) * HOUR_MS;
const inOutage = (t) => t >= ms(OUTAGE_START) && t < ms(OUTAGE_END);
const inBoost = (t) => t >= ms(BOOST_START) && t < ms(BOOST_END);
const apyFor = (plan, t) => (PAID_PLANS.includes(plan) && inBoost(t) ? APY_BOOST : APY_BASE[plan]);
// H5: paid media spend for one channel-day (see SPEND_LOOKBACK_DAYS); memoized
// because the platform columns and the warehouse hook read the same value
const signupHistory = new Map(); // channel → signups by bucket index
const spendMemo = new Map();
const paidSpend = (ch, bucketIndex, signups, timeMs) => {
	const key = `${ch}|${bucketIndex}|${signups}`;
	if (spendMemo.has(key)) return spendMemo.get(key);
	const hist = signupHistory.get(ch) || [];
	hist[bucketIndex] = signups;
	signupHistory.set(ch, hist);
	let sum = 0;
	for (let i = bucketIndex - SPEND_LOOKBACK_DAYS; i < bucketIndex; i++) sum += i >= 0 && hist[i] !== undefined ? hist[i] : PLAN_SIGNUPS_PER_DAY[ch];
	const basis = Math.max(sum / SPEND_LOOKBACK_DAYS, 0.3 * PLAN_SIGNUPS_PER_DAY[ch]);
	const spend = round2(CPL_USD[ch] * basis * SPEND_WEEKDAY[new Date(timeMs).getUTCDay()] * jitter(`spend|${dayKey(timeMs)}|${ch}`, SPEND_NOISE));
	spendMemo.set(key, spend);
	return spend;
};

// pocket_savings_daily flows for one plan-day, memoized and accumulated in
// bucket order: billed deposits (the app's deposits plus ACH pulls into Pockets
// made outside the app, minus returned deposits), withdrawals, interest, and the
// end-of-day balance
const POCKET_OPENING_USD = { free: 1_600_000, plus: 4_200_000, premium: 5_100_000 };
const POCKET_EXTERNAL_ACH_USD = { free: 900, plus: 2600, premium: 3400 };
const pocketState = new Map(); // plan → { idx, balance }
const pocketMemo = new Map();
const pocketFlows = (plan, bucketIndex, appDeposits, timeMs) => {
	const key = `${plan}|${bucketIndex}|${appDeposits}`;
	if (pocketMemo.has(key)) return pocketMemo.get(key);
	const k = `${dayKey(timeMs)}|${plan}`;
	const deposits = round2(appDeposits + POCKET_EXTERNAL_ACH_USD[plan] * jitter(`ach|${k}`, 0.7) - appDeposits * (0.005 + hashFloat(`ret|${k}`) * 0.025));
	// members keep more of what they move in while the boost rate is live
	const keep = PAID_PLANS.includes(plan) && inBoost(timeMs) ? [0.62, 0.86] : [0.78, 1.02];
	const withdrawals = round2(deposits * between(hashFloat(`wd|${k}`), keep));
	const st = pocketState.get(plan);
	const prior = st && st.idx === bucketIndex - 1 ? st.balance : POCKET_OPENING_USD[plan];
	const interest = round2(prior * apyFor(plan, timeMs) / 100 / 365);
	const balance = round2(prior + deposits - withdrawals + interest);
	pocketState.set(plan, { idx: bucketIndex, balance });
	const out = { deposits, withdrawals, interest, balance };
	pocketMemo.set(key, out);
	return out;
};

// Server-side events carry user_id only and no device fields; a lapse does not stop them.
const DEVICE_FIELDS = ["device_id", "session_id", "model", "os", "screen_height", "screen_width", "carrier", "radio"];
// Every event-specific key in the schema (declared event properties, funnel
// props, experiment fields). A spawned event drops its template's
// event-specific keys and takes its own declared ones.
let EVENT_KEYS = null;
const eventKeys = () => {
	if (EVENT_KEYS) return EVENT_KEYS;
	const keys = new Set(["Experiment name", "Variant name"]);
	for (const ev of config.events) for (const k of Object.keys(ev.properties || {})) keys.add(k);
	for (const f of config.funnels) for (const k of Object.keys(f.props || {})) keys.add(k);
	EVENT_KEYS = keys;
	return keys;
};
function spawnEvent(template, name, timeMs, props, serverSide) {
	const e = cloneEvent(template, { event: name, time: iso(timeMs) });
	for (const k of eventKeys()) delete e[k];
	if (serverSide) for (const k of DEVICE_FIELDS) delete e[k];
	Object.assign(e, props);
	return e;
}

// payroll paydays (day starts) for one member between from and to
function paydays(uid, freq, from, to) {
	const out = [];
	if (freq === "weekly") {
		const wd = 1 + Math.floor(salt(uid, "pay-wd") * 4); // Mon-Thu payouts
		for (let d = dayStart(from); d <= to; d += DAY_MS) {
			if (new Date(d).getUTCDay() === wd) out.push(prevBusinessDay(d));
		}
	} else if (freq === "biweekly") {
		const anchor = ms("2026-06-05T00:00:00Z") + (salt(uid, "pay-parity") < 0.5 ? 0 : 7 * DAY_MS);
		let d = anchor;
		while (d > from) d -= 14 * DAY_MS;
		for (; d <= to; d += 14 * DAY_MS) if (d >= dayStart(from)) out.push(prevBusinessDay(d));
	} else {
		let m = dayjs.utc(from).startOf("month");
		while (m.valueOf() <= to) {
			const mid = m.date(15).valueOf();
			const last = m.endOf("month").startOf("day").valueOf();
			for (const d of [mid, last]) if (d >= dayStart(from) && d <= to) out.push(prevBusinessDay(d));
			m = m.add(1, "month");
		}
	}
	return [...new Set(out)].sort((a, b) => a - b);
}

function handleUserHook(profile, meta) {
	const uid = profile.distinct_id;
	const seg = profile.customer_segment;
	profile.credit_history = salt(uid, "thin") < (THIN_FILE_SHARE[seg] ?? 0.2) ? "thin_file" : "established";
	profile.age_band = seg === "student"
		? (salt(uid, "age") < 0.85 ? "18-24" : "25-34")
		: pickWeighted({ "18-24": 12, "25-34": 34, "35-44": 26, "45-54": 16, "55+": 12 }, salt(uid, "age"));
	if (meta.userIsBornInDataset) {
		profile.plan_tier = "free";
		profile.customer_since = dayKey(ms(profile.created ?? meta.user.created));
		return profile;
	}
	// established members: a recent-joiner slice at the in-window signup rate,
	// the rest spread from March 2023
	const recentFrom = START_MS - RECENT_JOINER_DAYS * DAY_MS;
	const sinceMs = salt(uid, "recent") < RECENT_JOINER_SHARE
		? recentFrom + Math.floor(salt(uid, "tenure") * RECENT_JOINER_DAYS) * DAY_MS
		: ms("2023-03-01T00:00:00Z") + Math.floor(salt(uid, "tenure") * ((recentFrom - ms("2023-03-01T00:00:00Z")) / DAY_MS)) * DAY_MS;
	profile.customer_since = dayKey(sinceMs);
	const mix = {
		everyday: { free: 62, plus: 26, premium: 12 },
		tight_budget: { free: 70, plus: 25, premium: 5 },
		saver: { free: 40, plus: 30, premium: 30 },
		gig_worker: { free: 60, plus: 28, premium: 12 },
		student: { free: 82, plus: 15, premium: 3 },
	}[seg] || { free: 65, plus: 25, premium: 10 };
	profile.plan_tier = pickWeighted(mix, salt(uid, "plan"));
	return profile;
}

// ── field realism on engine events (amounts, merchants, balances) ──
function shapeFields(events, profile) {
	const uid = profile.distinct_id;
	const seg = profile.customer_segment;
	const balanceBase = BALANCE_MEDIAN[seg] * Math.exp((salt(uid, "bal") - 0.5) * 1.6);
	for (const e of events) {
		switch (e.event) {
			case "identity verified":
				e.kyc_method = profile.credit_history === "thin_file" || salt(uid, "kyc") < 0.12 ? "document_scan" : "instant_match";
				break;
			case "account funded":
				e.amount = round2(Math.max(10, logNormal(150, 0.9)));
				break;
			case "balance checked":
				e.available_balance_usd = round2(balanceBase * chance.floating({ min: 0.45, max: 1.55 }));
				break;
			case "card transaction": {
				if (e.transaction_type === "atm_withdrawal") {
					e.payment_channel = "atm";
					e.merchant_category = "cash";
					e.merchant_name = chance.bool({ likelihood: 75 }) ? "HarborLink ATM" : "Out-of-network ATM";
					e.amount = 20 * chance.integer({ min: 2, max: 10 });
				} else {
					const cat = e.merchant_category === "cash" ? "grocery" : e.merchant_category;
					e.merchant_category = cat;
					e.merchant_name = chance.pickone(MERCHANTS[cat]);
					e.amount = round2(Math.max(1.5, logNormal(MERCHANT_MEDIAN[cat], 0.7)));
					if (ONLINE_ONLY.has(cat)) e.payment_channel = "online";
					else if (e.payment_channel === "online" || e.payment_channel === "atm") e.payment_channel = chance.bool({ likelihood: 55 }) ? "chip" : "contactless_wallet";
				}
				const declined = chance.bool({ likelihood: (BASE_DECLINE[seg] ?? 0.04) * 100 });
				e.authorization_status = declined ? "declined" : "approved";
				if (declined) {
					const reasons = { insufficient_funds: 60, suspected_fraud: 12, merchant_blocked: 8, technical_error: 4, card_locked: 6 };
					if (e.payment_channel === "chip" || e.payment_channel === "atm") reasons.incorrect_pin = 10;
					e.decline_reason = pickWeighted(reasons, chance.floating({ min: 0, max: 1 }));
				} else {
					delete e.decline_reason;
				}
				break;
			}
			case "transfer sent": {
				const p2p = e.transfer_type === "p2p";
				e.amount = round2(Math.max(5, logNormal(p2p ? 42 : 310, 0.85)));
				e.speed = chance.bool({ likelihood: seg === "gig_worker" ? 55 : 22 }) ? "instant" : "standard";
				e.instant_fee_usd = e.speed === "instant" ? Math.max(0.25, round2(e.amount * 0.0175)) : 0;
				break;
			}
			case "savings deposit":
				e.source = "manual";
				e.amount = round2(Math.max(5, logNormal(75, 0.8)));
				break;
			case "investment order placed":
				e.amount = round2(Math.max(1, logNormal(e.side === "sell" ? 120 : 50, 0.9)));
				break;
			case "plan upgraded":
				e.monthly_fee = PLAN_FEE[e.new_plan] ?? PLAN_FEE.plus;
				break;
		}
	}
}

function handleEverything(events, meta) {
	if (!events.length) return events;
	const profile = meta.profile;
	const uid = profile.distinct_id;
	const seg = profile.customer_segment;
	const signup = events.find((e) => e.event === "account opened");
	const isNew = Boolean(signup);
	const birthMs = signup ? T(signup) : null;
	const fundedEv = events.find((e) => e.event === "account funded");
	const anyTemplate = signup || events[0];

	shapeFields(events, profile);
	// card transactions arrive from the card processor's feed, not the app: no device fields
	for (const e of events) if (e.event === "card transaction") for (const k of DEVICE_FIELDS) delete e[k];
	// the member's own app events (device, location, plan context), kept as
	// templates for spawned app events even if a later cut removes them
	const withDevice = events.filter((e) => e.device_id);

	// ── H1: onboarding timing — each new member's time to fund is a salted
	// lognormal around the credit-file median (truncated inside the 7-day
	// window); identity verified sits a file-specific share of the way there ──
	if (isNew) {
		const file = profile.credit_history === "thin_file" ? "thin_file" : "established";
		const ttfMs = truncLogNormal(salt(uid, "ttf"), ONBOARD_TTC_H[file], ONBOARD_TTC_SIGMA, ONBOARD_TTC_MAX_DAYS * 24) * HOUR_MS;
		const verifyMs = birthMs + between(salt(uid, "ttf-verify"), VERIFY_SHARE[file]) * ttfMs;
		for (const e of events) {
			if (e.event === "identity verified") e.time = iso(verifyMs);
			else if (e.event === "account funded") e.time = iso(birthMs + ttfMs);
		}
	}
	const SERVER_ENGINE_EVENTS = new Set(["identity verified", "account funded", "support ticket resolved"]);

	// ── support volume: keep a share of engine support units (whole units) ──
	{
		const keepTicket = new Map();
		events = events.filter((e) => {
			if (e.event !== "support ticket opened" && e.event !== "support ticket resolved") return true;
			if (!keepTicket.has(e.ticket_id)) keepTicket.set(e.ticket_id, salt(e.ticket_id, "keep") < TICKET_KEEP);
			return keepTicket.get(e.ticket_id);
		});
	}

	// ── onboarding: members who never fund the account ──
	let cut = Infinity; // member-initiated events stop here
	if (isNew && !fundedEv) {
		events = events.filter((e) => !["card transaction", "card locked", "budget created"].includes(e.event));
		for (const e of events) if (e.event === "balance checked") e.available_balance_usd = 0;
		if (salt(uid, "abandon") < UNFUNDED_ABANDON_SHARE) {
			cut = birthMs + between(salt(uid, "abandon-day"), UNFUNDED_ABANDON_DAYS) * DAY_MS;
		} else {
			const keep = between(salt(uid, "unfunded-keep"), UNFUNDED_KEEP);
			events = events.filter((e) => T(e) < birthMs + 2 * DAY_MS || SERVER_ENGINE_EVENTS.has(e.event) || chance.bool({ likelihood: keep * 100 }));
		}
	}

	// ── H2 / H5: direct deposit adoption, dark cut, organic lapse ──
	let ddMs = null;          // direct deposit setup time (event only when inside the window)
	let ddActiveFrom = null;  // paychecks start from here (-Infinity: long before the window)
	// recent joiners (opened in the 30 days before June 4) follow the new-member
	// path from their opening day, so June's DD setups and dark cuts start warm
	const sinceMs = ms(`${profile.customer_since}T00:00:00Z`) + (12 + salt(uid, "since-h") * 12) * HOUR_MS;
	const recentJoiner = !isNew && sinceMs >= START_MS - RECENT_JOINER_DAYS * DAY_MS;
	if ((isNew && fundedEv) || recentJoiner) {
		const openMs = isNew ? birthMs : sinceMs;
		const fundedMs = isNew ? T(fundedEv) : sinceMs + 3 * HOUR_MS;
		const adopt = salt(uid, "dd") < (DD_ADOPT[profile.acquisition_channel] ?? 0.4);
		if (adopt) {
			ddMs = openMs + (0.3 + salt(uid, "dd-day") * (DD_WINDOW_DAYS - 0.5)) * DAY_MS;
			if (ddMs <= fundedMs) ddMs = fundedMs + (30 + salt(uid, "dd-min") * 150) * MIN_MS;
			if (ddMs >= openMs + DD_WINDOW_DAYS * DAY_MS) ddMs = null; // funded too late to adopt inside 14 days
		} else if (salt(uid, "dd-late") < LATE_DD_SHARE) {
			ddMs = openMs + between(salt(uid, "dd-late-day"), LATE_DD_DAYS) * DAY_MS;
		}
		const ddInWindow = ddMs !== null && ddMs < openMs + DD_WINDOW_DAYS * DAY_MS;
		const cuts = [];
		if (!ddInWindow && salt(uid, "dark") < DARK_SHARE) cuts.push(openMs + between(salt(uid, "dark-day") ** DARK_SKEW, DARK_DAYS) * DAY_MS);
		if (salt(uid, "lapse") < LAPSE_SHARE) {
			// truncated exponential lapse day (early-life decay), never before the
			// member has used the funded account for half a day; an adopter who
			// lapses early still finishes the direct deposit switch first
			const span = LAPSE_DAYS[1] - LAPSE_DAYS[0];
			const day = LAPSE_DAYS[0] - LAPSE_SCALE_DAYS * Math.log(1 - salt(uid, "lapse-day") * (1 - Math.exp(-span / LAPSE_SCALE_DAYS)));
			let lapseMs = Math.max(openMs + day * DAY_MS, fundedMs + 12 * HOUR_MS);
			if (ddInWindow) lapseMs = Math.max(lapseMs, ddMs + between(salt(uid, "lapse-after-dd"), [1, 48]) * HOUR_MS);
			cuts.push(lapseMs);
		}
		if (cuts.length) cut = Math.min(cut, ...cuts);
		if (ddMs !== null && (ddMs >= cut || ddMs > END_MS)) ddMs = null;
		if (ddMs !== null) ddActiveFrom = ddMs;
	} else if (!isNew) {
		if (salt(uid, "dd-pre") < PREEXISTING_DD_SHARE) ddActiveFrom = -Infinity;
		else if (salt(uid, "dd-switch") < DD_SWITCH_SHARE) {
			ddMs = START_MS + salt(uid, "dd-switch-day") * (WINDOW_DAYS - 7) * DAY_MS;
			ddActiveFrom = ddMs;
		}
	}
	// (only the support desk's resolutions are server-side among engine events)
	// (a member who went quiet before June 4 can be left with no app events; the
	// server-side flows below still post paychecks, AutoPay bills, and repayments)
	if (cut < Infinity) events = events.filter((e) => T(e) < cut || SERVER_ENGINE_EVENTS.has(e.event));
	const lastMemberMs = Math.min(cut, END_MS);
	// template for spawned member-initiated events: the member's own app event
	// nearest in time
	const memberTemplate = (t) => {
		let best = withDevice[0] || anyTemplate, bestGap = Infinity;
		for (const e of withDevice) {
			const g = Math.abs(T(e) - t);
			if (g < bestGap) { best = e; bestGap = g; }
		}
		return best;
	};

	// ── plan timeline: one upgrade per member; later upgrade steps vanish ──
	const firstUp = events.filter((e) => e.event === "plan upgraded").sort((a, b) => T(a) - T(b))[0];
	if (firstUp) {
		const t0 = T(firstUp);
		events = events.filter((e) => e === firstUp || (e.event !== "plan upgraded" && !(e.event === "plan comparison viewed" && T(e) > t0)));
	}
	const initialPlan = profile.plan_tier;
	const upMs = firstUp ? T(firstUp) : Infinity;
	const planAt = (t) => (t >= upMs ? firstUp.new_plan : initialPlan);

	// server-side onboarding steps carry no device fields
	for (const e of events) if (e.event === "identity verified" || e.event === "account funded") for (const k of DEVICE_FIELDS) delete e[k];

	const spawned = [];

	// ── direct deposit setup + paychecks (H2) + Float ──
	let payFreq = "none";
	const payTimes = [];
	if (ddActiveFrom !== null) {
		payFreq = seg === "gig_worker" ? "weekly" : salt(uid, "pay-freq") < 0.6 ? "biweekly" : "semimonthly";
		if (ddMs !== null && ddMs >= START_MS) {
			spawned.push(spawnEvent(memberTemplate(ddMs), "direct deposit set up", ddMs, {
				setup_method: salt(uid, "dd-method") < 0.4 ? "payroll_connect" : "form_download",
			}, false));
		}
		const firstPay = ddActiveFrom === -Infinity ? START_MS - 35 * DAY_MS : ddActiveFrom + (3 + salt(uid, "dd-lag") * 7) * DAY_MS;
		const days = paydays(uid, payFreq, firstPay, END_MS);
		const base = PAYCHECK_MEDIAN[payFreq] * Math.exp((salt(uid, "pay-amt") - 0.5) * 1.1) * (seg === "student" ? 0.45 : 1);
		const payer = payFreq === "weekly" ? "gig_platform" : salt(uid, "payer") < 0.06 ? "government_benefit" : "employer_payroll";
		let prevPayMs = null;
		for (const d of days) {
			const payMs = d + (8.5 + chance.floating({ min: 0, max: 3 })) * HOUR_MS;
			payTimes.push(payMs);
			// Float: an advance inside the cycle that ends with this paycheck
			if (prevPayMs !== null && chance.bool({ likelihood: (FLOAT_CYCLE_P[seg] ?? 0.1) * 100 })) {
				const takeMs = payMs - chance.floating({ min: 0.4, max: 3.5 }) * DAY_MS;
				const plan = planAt(Math.max(takeMs, START_MS));
				const amount = Math.max(20, Math.min(FLOAT_LIMIT[plan], 5 * Math.round(logNormal(70, 0.6) / 5)));
				const takeOk = takeMs > prevPayMs + HOUR_MS && takeMs < lastMemberMs;
				if (takeOk && takeMs >= START_MS) {
					spawned.push(spawnEvent(memberTemplate(takeMs), "float advance taken", takeMs, { amount, float_limit_usd: FLOAT_LIMIT[plan] }, false));
				}
				if ((takeOk || takeMs < START_MS) && payMs >= START_MS && payMs <= END_MS) {
					spawned.push(spawnEvent(anyTemplate, "float advance repaid", payMs + (90 + chance.integer({ min: 0, max: 240 })) * 1000, { amount }, true));
				}
			}
			if (payMs >= START_MS && payMs <= END_MS) {
				const amt = base * (payFreq === "weekly" ? chance.floating({ min: 0.6, max: 1.4 }) : chance.floating({ min: 0.94, max: 1.06 }));
				spawned.push(spawnEvent(anyTemplate, "direct deposit received", payMs, {
					amount: round2(amt), pay_frequency: payFreq, payer_type: payer,
				}, true));
			}
			prevPayMs = payMs;
		}
	}
	profile.pay_frequency = payFreq;
	// balances follow the pay cycle: highest right after a paycheck, lowest just before the next
	if (payTimes.length > 1) {
		for (const e of events) {
			if (e.event !== "balance checked") continue;
			const t = T(e);
			let i = 0;
			while (i < payTimes.length && payTimes[i] <= t) i++;
			if (i === 0 || i === payTimes.length) continue;
			const f = (t - payTimes[i - 1]) / (payTimes[i] - payTimes[i - 1]);
			e.available_balance_usd = round2(e.available_balance_usd * (1.45 - 0.9 * f));
		}
	}
	profile.direct_deposit_active = ddActiveFrom !== null;

	// ── billers and bill payments (H6 billers, H7 late payments) ──
	{
		const billers = [];
		const added = new Map();
		for (const e of events) {
			if (e.event === "biller added" && !added.has(e.biller_id)) added.set(e.biller_id, { id: e.biller_id, category: e.biller_category, addedMs: T(e), autopayMs: Infinity });
		}
		for (const e of events) {
			if (e.event === "autopay enabled" && added.has(e.biller_id)) {
				const b = added.get(e.biller_id);
				b.autopayMs = Math.min(b.autopayMs, T(e));
			}
		}
		billers.push(...added.values());
		if (!isNew) {
			const r = salt(uid, "billers");
			let n = 0, acc = 0;
			for (let i = 0; i < PREEXISTING_BILLERS.length; i++) { acc += PREEXISTING_BILLERS[i]; if (r >= acc) n = i + 1; }
			n = Math.min(n, PREEXISTING_BILLERS.length - 1);
			for (let i = 0; i < n; i++) {
				billers.push({
					id: `blr_${Math.floor(salt(uid, `biller-id-${i}`) * 1e12).toString(36)}`,
					category: BILLER_LIST[Math.floor(salt(uid, `biller-cat-${i}`) * BILLER_LIST.length)],
					addedMs: -Infinity,
					autopayMs: salt(uid, `biller-ap-${i}`) < PREEXISTING_AUTOPAY_SHARE ? -Infinity : Infinity,
				});
			}
		}
		for (const b of billers) {
			const type = BILLER_TYPES[b.category] || BILLER_TYPES.utilities;
			const base = between(salt(b.id, "amt"), [type.lo, type.hi]);
			// rent is due on the 1st; other billers cluster on the 1st and 15th
			const rd = salt(b.id, "due");
			const dueDay = b.category === "rent" ? 1 : rd < 0.15 ? 1 : rd < 0.25 ? 15 : 1 + Math.floor((rd - 0.25) / 0.75 * 31);
			let m = dayjs.utc(Math.max(START_MS, b.addedMs === -Infinity ? START_MS : b.addedMs)).startOf("month").subtract(1, "month");
			for (let k = 0; k < 6; k++, m = m.add(1, "month")) {
				const due = m.date(Math.min(dueDay, m.daysInMonth())).valueOf();
				if (b.addedMs !== -Infinity && due < b.addedMs + 5 * DAY_MS) continue;
				const autopay = b.autopayMs <= due;
				const late = chance.bool({ likelihood: (autopay ? LATE_SHARE.autopay : LATE_SHARE.manual) * 100 });
				let t;
				if (autopay) {
					const post = nextBusinessDay(due);
					t = late ? nextBusinessDay(post + chance.integer({ min: 1, max: 3 }) * DAY_MS) : post;
					t += (10 + chance.floating({ min: 0, max: 3 })) * HOUR_MS;
				} else {
					const dd = late ? due + chance.integer({ min: 1, max: 10 }) * DAY_MS : due - chance.integer({ min: 0, max: 4 }) * DAY_MS;
					t = memberTime(dd);
					if (t >= lastMemberMs) continue; // a lapsed member stops paying by hand
				}
				if (t < START_MS || t > END_MS) continue;
				const amount = round2(base * (1 + (chance.floating({ min: -1, max: 1 })) * type.vary));
				spawned.push(spawnEvent(autopay ? anyTemplate : memberTemplate(t), "bill paid", t, {
					biller_id: b.id, biller_category: b.category, amount,
					autopay, payment_status: late ? "late" : "on_time",
				}, autopay));
			}
		}
	}

	// ── H4: wallet outage — declines, chip retries, support tickets ──
	{
		const extra = [];
		for (const e of events) {
			if (e.event !== "card transaction" || e.payment_channel !== OUTAGE_CHANNEL || e.authorization_status !== "approved") continue;
			const t = T(e);
			if (!inOutage(t) || !chance.bool({ likelihood: OUTAGE_FAIL * 100 })) continue;
			e.authorization_status = "declined";
			e.decline_reason = "technical_error";
			if (chance.bool({ likelihood: OUTAGE_RETRY * 100 })) {
				const r = cloneEvent(e, { time: iso(t + chance.integer({ min: 40, max: 300 }) * 1000) });
				r.payment_channel = "chip";
				r.authorization_status = "approved";
				delete r.decline_reason;
				extra.push(r);
			}
			if (chance.bool({ likelihood: OUTAGE_TICKET * 100 })) {
				const tid = `tkt_${Math.floor(hashFloat(`${e.insert_id}|tkt`) * 1e12).toString(36)}`;
				const open = t + chance.integer({ min: 5, max: 90 }) * MIN_MS;
				const ch = chance.bool({ likelihood: 60 }) ? "chat" : "in_app";
				extra.push(spawnEvent(memberTemplate(open), "support ticket opened", open, { ticket_id: tid, issue_type: "card_declined", contact_channel: ch }, false));
				extra.push(spawnEvent(e, "support ticket resolved", open + HOUR_MS, { ticket_id: tid, issue_type: "card_declined", contact_channel: ch, resolution_hours: 1 }, true));
			}
		}
		events = events.concat(extra);
	}

	// ── H3: Round-Ups ──
	let roundUps = false;
	if (salt(uid, "roundup") < ROUNDUP_ADOPT) {
		const startMs = ms(ROUNDUPS_LAUNCH) + salt(uid, "roundup-day") * ROUNDUP_RAMP_DAYS * DAY_MS;
		const visit = events.filter((e) => e.event === "app opened" && T(e) >= startMs).sort((a, b) => T(a) - T(b))[0];
		if (visit) {
			roundUps = true;
			const onMs = T(visit) + chance.integer({ min: 20, max: 120 }) * 1000;
			const mult = ROUNDUP_MULTIPLIERS[Math.floor(salt(uid, "roundup-mult") * ROUNDUP_MULTIPLIERS.length)];
			spawned.push(spawnEvent(visit, "round-ups enabled", onMs, { roundup_multiplier: mult }, false));
			const byDay = new Map();
			for (const e of events) {
				if (e.event !== "card transaction" || e.transaction_type !== "purchase" || e.authorization_status !== "approved") continue;
				const t = T(e);
				if (t < onMs) continue;
				const spare = Math.round((Math.ceil(e.amount) - e.amount) * 100) / 100;
				const d = dayStart(t);
				byDay.set(d, (byDay.get(d) || 0) + spare * mult);
			}
			for (const [d, spare] of byDay) {
				const sweepMs = d + DAY_MS + (7 + chance.floating({ min: 0, max: 2 })) * HOUR_MS;
				if (spare < 0.01 || sweepMs > END_MS) continue;
				spawned.push(spawnEvent(anyTemplate, "savings deposit", sweepMs, { source: "round_up", amount: round2(spare), pocket_type: "round_ups" }, true));
			}
		}
	}
	profile.round_ups_enabled = roundUps;

	events = events.concat(spawned);

	// ── H9: support resolution timing ──
	{
		const tickets = new Map();
		for (const e of events) {
			if (e.event !== "support ticket opened" && e.event !== "support ticket resolved") continue;
			if (!tickets.has(e.ticket_id)) tickets.set(e.ticket_id, {});
			tickets.get(e.ticket_id)[e.event] = e;
		}
		const drop = new Set();
		for (const tk of tickets.values()) {
			const o = tk["support ticket opened"], r = tk["support ticket resolved"];
			if (!r) continue;
			for (const k of DEVICE_FIELDS) delete r[k];
			if (!o) {
				// opened before June 4 (warm start); keep only early resolutions
				if (T(r) > START_MS + 4 * DAY_MS) drop.add(r);
				else r.resolution_hours = round1(Math.max(0.5, (T(r) - START_MS) / HOUR_MS + chance.floating({ min: 2, max: 30 })));
				continue;
			}
			const gap = RESOLVE_MEDIAN_H * HOUR_MS * Math.exp(chance.normal({ mean: 0, dev: 0.9 }))
				* (CHANNEL_SPEED[o.contact_channel] ?? 1) * (SUPPORT_PLAN_MULT[planAt(T(o))] ?? 1);
			const rt = T(o) + Math.max(10 * MIN_MS, gap);
			r.time = iso(rt);
			r.resolution_hours = round1((rt - T(o)) / HOUR_MS);
			if (rt > END_MS) drop.add(r);
		}
		if (drop.size) events = events.filter((e) => !drop.has(e));
		// warm start: a ticket opened before June 4 and still open then resolves
		// in the first days (salted, so the rest of the stream is unchanged)
		if (!isNew && salt(uid, "carry-tkt") < CARRYOVER_TICKET_SHARE) {
			const chs = Object.keys(CHANNEL_SPEED);
			const ch = chs[Math.floor(salt(uid, "carry-ch") * chs.length)];
			// ≈ standard normal; a ticket still open on a given day is length-biased: lognormal median × e^(σ²)
			const z = (salt(uid, "carry-z1") + salt(uid, "carry-z2") - 1) * 2.45;
			const gapMs = Math.max(HOUR_MS, RESOLVE_MEDIAN_H * HOUR_MS * Math.exp(0.81 + 0.9 * z) * CHANNEL_SPEED[ch] * (SUPPORT_PLAN_MULT[planAt(START_MS)] ?? 1));
			const rt = START_MS + gapMs * (0.05 + 0.95 * salt(uid, "carry-left"));
			if (rt <= END_MS) {
				events.push(spawnEvent(anyTemplate, "support ticket resolved", rt, {
					ticket_id: `tkt_${Math.floor(salt(uid, "carry-id") * 1e12).toString(36)}`,
					issue_type: CARRYOVER_ISSUES[Math.floor(salt(uid, "carry-issue") * CARRYOVER_ISSUES.length)],
					contact_channel: ch, resolution_hours: round1(gapMs / HOUR_MS),
				}, true));
			}
		}
	}

	// ── H8: Summer Saver Boost — Plus/Premium add more manual Pocket deposits ──
	{
		const boostEnd = Math.min(ms(BOOST_END), END_MS, lastMemberMs);
		const clones = [];
		for (const e of events) {
			if (e.event !== "savings deposit" || e.source !== "manual") continue;
			const t = T(e);
			if (!inBoost(t) || !PAID_PLANS.includes(planAt(t))) continue;
			if (!chance.bool({ likelihood: (BOOST_DEPOSIT_MULT - 1) * 100 })) continue;
			const tc = t + chance.floating({ min: 2, max: 72 }) * HOUR_MS;
			if (tc >= boostEnd) continue;
			clones.push(cloneEvent(e, {
				time: iso(tc),
				amount: round2(Math.max(5, logNormal(75, 0.8))),
				pocket_type: chance.pickone(["emergency", "vacation", "home", "car", "general"]),
			}));
		}
		events = events.concat(clones);
	}

	// ── H10: budget magic number — 3+ budgets → bigger manual deposits ──
	const budgets = events.filter((e) => e.event === "budget created").length;
	if (budgets >= BUDGET_MAGIC) {
		for (const e of events) {
			if (e.event === "savings deposit" && e.source === "manual") e.amount = round2(e.amount * BUDGET_SAVE_MULT);
		}
	}

	// ── no money moves before the account is funded (a slow document review
	// leaves the member browsing an empty account) ──
	if (isNew && fundedEv) {
		const tf = T(fundedEv);
		const MONEY = new Set(["card transaction", "transfer sent", "savings deposit", "investment order placed", "bill paid", "float advance taken"]);
		events = events.filter((e) => !(MONEY.has(e.event) && T(e) < tf));
		for (const e of events) if (e.event === "balance checked" && T(e) < tf) e.available_balance_usd = 0;
	}

	// ── plan at event time + final profile ──
	for (const e of events) e.plan_tier = planAt(T(e));
	if (firstUp) profile.plan_tier = firstUp.new_plan;
	if (profile[EXP_KEY] !== undefined && !events.some((e) => e.event === "$experiment_started")) delete profile[EXP_KEY];

	return events;
}

function handleWarehouse(row, meta) {
	if (meta.isBackfill) return row;
	if (meta.metricName === "paid_acquisition_daily") {
		// the value column arrives holding the day's Mixpanel signups (the source);
		// billed spend comes from the bidding model
		row.spend_usd = paidSpend(row.acquisition_channel, meta.bucketIndex, row.spend_usd, ms(`${row.date}T00:00:00Z`));
		return row;
	}
	if (meta.metricName === "card_authorizations_daily") {
		// processor counts incremental and stand-in authorizations the app never logs
		const k = `${row.date}|${row.payment_channel}`;
		row.auth_attempts = Math.round(row.auth_attempts * (1.03 + hashFloat(`incr|${k}`) * 0.07) * jitter(`mit|${row.date}`, 0.08) + hashFloat(`standin|${k}`) * 25);
		return row;
	}
	if (meta.metricName === "pocket_savings_daily") {
		row.deposits_usd = pocketFlows(row.plan_tier, meta.bucketIndex, row.deposits_usd, ms(`${row.date}T00:00:00Z`)).deposits;
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
	singleCountry: "US",
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

	events: [
		{
			event: "account opened",
			weight: 1,
			isFirstEvent: true,
			isAuthEvent: true,
			properties: {
				signup_method: { __weights: { email: 45, apple: 35, google: 20 } },
				acquisition_channel: (ctx) => ctx.profile.acquisition_channel,
			},
		},
		{
			event: "identity verified",
			weight: 1,
			isStrictEvent: true,
			properties: { kyc_method: ["instant_match"] },
		},
		{
			event: "account funded",
			weight: 1,
			isStrictEvent: true,
			properties: {
				funding_method: { __weights: { bank_link: 55, debit_card: 25, p2p_in: 12, cash_load: 8 } },
				amount: [100],
			},
		},
		{
			event: "app opened",
			weight: 3,
			isStrictEvent: false,
			properties: { entry_point: { __weights: { icon: 70, widget: 12, notification: 12, deeplink: 6 } } },
		},
		{
			event: "balance checked",
			weight: 2,
			isStrictEvent: false,
			properties: {
				available_balance_usd: [0],
				account_view: ["overview", "overview", "checking", "pockets"],
			},
		},
		{
			event: "card transaction",
			weight: 1,
			isStrictEvent: true,
			properties: {
				transaction_type: { __weights: { purchase: 92, atm_withdrawal: 8 } },
				amount: [10],
				merchant_category: { __weights: { grocery: 22, dining: 20, gas: 11, retail: 11, online_shopping: 13, subscriptions: 7, travel: 4, entertainment: 6, health: 6 } },
				merchant_name: ["unknown"],
				payment_channel: { __weights: { chip: 40, contactless_wallet: 32, online: 28 } },
				authorization_status: ["approved"],
				decline_reason: ["insufficient_funds"],
			},
		},
		{
			event: "transfer sent",
			weight: 1,
			isStrictEvent: true,
			properties: {
				transfer_type: { __weights: { p2p: 70, external_bank: 30 } },
				speed: ["standard"],
				amount: [25],
				instant_fee_usd: [0],
				recipient_type: { __weights: { friend: 40, family: 30, landlord: 6, self: 16, business: 8 } },
			},
		},
		{
			event: "savings deposit",
			weight: 1,
			isStrictEvent: true,
			properties: {
				source: ["manual"],
				amount: [25],
				pocket_type: ["emergency", "emergency", "vacation", "home", "car", "general"],
			},
		},
		{
			event: "budget created",
			weight: 1,
			isStrictEvent: true,
			properties: {
				category: ["groceries", "dining", "transport", "shopping", "entertainment", "bills", "subscriptions"],
				monthly_limit: u.weighNumRange(50, 1500, 0.4, 30),
			},
		},
		{
			event: "investment order placed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				asset_type: { __weights: { etf: 45, stock: 50, bond_fund: 5 } },
				side: { __weights: { buy: 80, sell: 20 } },
				amount: [25],
			},
		},
		{ event: "biller added", weight: 1, isStrictEvent: true, properties: {} },
		{ event: "autopay enabled", weight: 1, isStrictEvent: true, properties: {} },
		{
			event: "bill paid",
			weight: 1,
			isStrictEvent: true, // hook-generated from each biller's monthly schedule
			properties: {
				biller_id: ["unassigned"],
				biller_category: ["utilities"],
				amount: [50],
				autopay: [false],
				payment_status: ["on_time"],
			},
		},
		{ event: "support ticket opened", weight: 1, isStrictEvent: true, properties: {} },
		{
			event: "support ticket resolved",
			weight: 1,
			isStrictEvent: true,
			properties: { resolution_hours: [0] },
		},
		{
			event: "plan comparison viewed",
			weight: 1,
			isStrictEvent: true,
			properties: { trigger: { __weights: { float_limit: 30, pockets_apy: 25, settings: 25, promo_banner: 20 } } },
		},
		{
			event: "plan upgraded",
			weight: 1,
			isStrictEvent: true,
			properties: { new_plan: ["plus", "plus", "premium"], monthly_fee: [4.99] },
		},
		{
			event: "direct deposit set up",
			weight: 1,
			isStrictEvent: true, // hook-generated
			properties: { setup_method: ["form_download"] },
		},
		{
			event: "direct deposit received",
			weight: 1,
			isStrictEvent: true, // hook-generated, server-side
			properties: { amount: [1000], pay_frequency: ["biweekly"], payer_type: ["employer_payroll"] },
		},
		{
			event: "float advance taken",
			weight: 1,
			isStrictEvent: true, // hook-generated
			properties: { amount: [50], float_limit_usd: [50] },
		},
		{
			event: "float advance repaid",
			weight: 1,
			isStrictEvent: true, // hook-generated, server-side
			properties: { amount: [50] },
		},
		{
			event: "round-ups enabled",
			weight: 1,
			isStrictEvent: true, // hook-generated
			properties: { roundup_multiplier: [1] },
		},
		{
			event: "card locked",
			weight: 1,
			isStrictEvent: false,
			properties: { reason: { __weights: { misplaced: 45, lost: 20, suspicious_activity: 20, travel: 15 } } },
		},
		{
			event: "$experiment_started",
			weight: 1,
			isStrictEvent: true,
			properties: {
				"Experiment name": [AUTOPAY_EXPERIMENT],
				"Variant name": ["Control", AUTOPAY_VARIANT],
			},
		},
	],

	funnels: [
		{
			name: "Onboarding",
			sequence: ONBOARD_STEPS,
			isFirstFunnel: true,
			conditions: { credit_history: "established" },
			conversionRate: ONBOARD_CONV,
			timeToConvert: ONBOARD_TTC_H.established,
			order: "sequential",
			weight: 1,
		},
		{
			name: "Onboarding",
			sequence: ONBOARD_STEPS,
			isFirstFunnel: true,
			conditions: { credit_history: "thin_file" },
			conversionRate: THIN_ONBOARD_CONV,
			timeToConvert: ONBOARD_TTC_H.thin_file,
			order: "sequential",
			weight: 1,
		},
		{ name: "Money check", sequence: ["app opened", "balance checked"], conversionRate: 85, timeToConvert: 0.05, order: "sequential", weight: 30 },
		{ name: "Card spend", sequence: ["card transaction"], conversionRate: 100, timeToConvert: 0.1, order: "sequential", weight: 60 },
		{ name: "Send money", sequence: ["app opened", "transfer sent"], conversionRate: 60, timeToConvert: 0.1, order: "sequential", weight: 10 },
		{ name: "Save", sequence: ["app opened", "savings deposit"], conversionRate: 55, timeToConvert: 0.1, order: "sequential", weight: 8 },
		{ name: "Invest", sequence: ["app opened", "investment order placed"], conversionRate: 40, timeToConvert: 0.1, order: "sequential", weight: 4 },
		{ name: "Budget", sequence: ["app opened", "budget created"], conversionRate: 40, timeToConvert: 0.1, order: "sequential", weight: 5 },
		{
			name: "Bill setup",
			sequence: ["biller added", "autopay enabled"],
			conversionRate: AUTOPAY_CONV,
			timeToConvert: 0.1,
			order: "sequential",
			weight: 1,
			props: {
				biller_id: (ctx) => `blr_${chance.hash({ length: 10 })}`,
				biller_category: BILLER_LIST,
			},
			experiment: {
				name: AUTOPAY_EXPERIMENT,
				startDaysBeforeEnd: (END_MS / 1000 - ms(AUTOPAY_TEST_START) / 1000) / 86400,
				variants: [
					{ name: "Control" },
					{ name: AUTOPAY_VARIANT, conversionMultiplier: AUTOPAY_DEFAULT_MULT },
				],
			},
		},
		{
			name: "Support",
			sequence: ["support ticket opened", "support ticket resolved"],
			conversionRate: 90,
			timeToConvert: 36,
			order: "sequential",
			weight: 1,
			props: {
				ticket_id: (ctx) => `tkt_${chance.hash({ length: 10 })}`,
				issue_type: ["card", "card", "transfer", "transfer", "account_access", "fees", "direct_deposit", "dispute", "card_declined"],
				contact_channel: ["chat", "chat", "chat", "in_app", "in_app", "phone", "email"],
			},
		},
		{
			name: "Upgrade",
			sequence: ["plan comparison viewed", "plan upgraded"],
			conditions: { plan_tier: "free" },
			conversionRate: 4,
			timeToConvert: 1,
			order: "sequential",
			weight: 2,
		},
	],

	warehouseMetrics: [
		{
			name: "paid_acquisition_daily",
			type: "additive",
			grain: "day",
			source: {
				event: "account opened",
				measure: "count",
				where: (e) => PAID_CHANNELS.includes(e.acquisition_channel),
				groupBy: "acquisition_channel",
			},
			timeColumn: "date",
			valueColumn: "spend_usd",
			columns: {
				platform_reported_installs: (ctx) => Math.round(paidSpend(ctx.seriesKey, ctx.bucketIndex, ctx.value, ctx.time) * PLATFORM_INSTALL_INFLATION / CPL_USD[ctx.seriesKey] * jitter(`inst|${dayKey(ctx.time)}|${ctx.seriesKey}`, 0.25)),
				clicks: (ctx) => Math.round(paidSpend(ctx.seriesKey, ctx.bucketIndex, ctx.value, ctx.time) / (CPC_USD[ctx.seriesKey] * jitter(`cpc|${dayKey(ctx.time)}|${ctx.seriesKey}`, 0.15))),
				impressions: (ctx) => Math.round(ctx.row.clicks / (CTR[ctx.seriesKey] * jitter(`ctr|${dayKey(ctx.time)}|${ctx.seriesKey}`, 0.15))),
			},
		},
		{
			name: "card_authorizations_daily",
			type: "additive",
			grain: "day",
			source: { event: "card transaction", measure: "count", groupBy: "payment_channel" },
			timeColumn: "date",
			valueColumn: "auth_attempts",
			columns: {
				approval_rate: (ctx) => {
					const j = hashFloat(`appr|${dayKey(ctx.time)}|${ctx.seriesKey}`);
					const base = 0.935 + j * 0.02;
					return ctx.seriesKey === OUTAGE_CHANNEL && inOutage(ctx.time) ? Math.round(base * (1 - OUTAGE_FAIL) * 10000) / 10000 : Math.round(base * 10000) / 10000;
				},
				tokenization_error_rate: (ctx) => {
					if (ctx.seriesKey !== OUTAGE_CHANNEL) return 0;
					const j = hashFloat(`tok|${dayKey(ctx.time)}`);
					return inOutage(ctx.time) ? round2(OUTAGE_FAIL + (j - 0.5) * 0.04) : Math.round((0.001 + j * 0.003) * 10000) / 10000;
				},
				processor_status: (ctx) => (ctx.seriesKey === OUTAGE_CHANNEL && inOutage(ctx.time) ? "major_outage" : "operational"),
				p95_auth_latency_ms: (ctx) => {
					const j = hashFloat(`lat|${dayKey(ctx.time)}|${ctx.seriesKey}`);
					return ctx.seriesKey === OUTAGE_CHANNEL && inOutage(ctx.time) ? Math.round(4200 + j * 2500) : Math.round(({ chip: 620, contactless_wallet: 480, online: 710, atm: 900 }[ctx.seriesKey] || 650) * (0.9 + j * 0.2));
				},
			},
		},
		{
			name: "pocket_savings_daily",
			type: "additive",
			grain: "day",
			source: { event: "savings deposit", measure: "sum", property: "amount", groupBy: "plan_tier" },
			timeColumn: "date",
			valueColumn: "deposits_usd",
			columns: {
				apy_pct: (ctx) => apyFor(ctx.seriesKey, ctx.time),
				promo_code: (ctx) => (PAID_PLANS.includes(ctx.seriesKey) && inBoost(ctx.time) ? "SUMMER_SAVER" : "none"),
				withdrawals_usd: (ctx) => pocketFlows(ctx.seriesKey, ctx.bucketIndex, ctx.value, ctx.time).withdrawals,
				interest_paid_usd: (ctx) => pocketFlows(ctx.seriesKey, ctx.bucketIndex, ctx.value, ctx.time).interest,
				pocket_balance_usd: (ctx) => pocketFlows(ctx.seriesKey, ctx.bucketIndex, ctx.value, ctx.time).balance,
			},
		},
	],

	superProps: {
		plan_tier: ["free"],
	},

	userProps: {
		customer_segment: ["everyday"],
		credit_history: ["established"],
		acquisition_channel: { __weights: CHANNEL_WEIGHTS },
		plan_tier: ["free"],
		customer_since: ["2025-01-01"],
		age_band: ["25-34"],
		pay_frequency: ["none"],
		direct_deposit_active: [false],
		round_ups_enabled: [false],
	},

	personas: Object.entries(SEGMENTS).map(([name, s]) => ({
		name, weight: s.weight, eventMultiplier: s.mult, properties: { customer_segment: name },
	})),

	retentionCurve: { type: "logarithmic", day1: 0.8, day7: 0.65, day30: 0.55 },

	hook(record, type, meta) {
		if (type === "user") return handleUserHook(record, meta);
		if (type === "everything") return handleEverything(record, meta);
		if (type === "warehouse") return handleWarehouse(record, meta);
		return record;
	},
};

// ── STORIES ──────────────────────────────────────────────────────────────
// Machine-checkable contract for hooks H1-H10. Evaluate with:
//   node dungeons/vertical/fintech/fintech.verify.mjs

const EV = `read_json_auto('{{PREFIX}}-EVENTS*.json*', sample_size=-1, union_by_name=true)`;
const US = `read_json_auto('{{PREFIX}}-USERS*.json*', sample_size=-1, union_by_name=true)`;
const WH = (table) => `read_json_auto('{{PREFIX}}-WAREHOUSE-${table}.json*', sample_size=-1, union_by_name=true)`;

// Identity prelude: a device resolves to the user who appears with it on any
// event carrying both ids (emitted stitch evidence). Every event in this
// dataset carries user_id, so uid equals user_id; the prelude keeps the SQL
// honest if that ever changes.
const ID_CTE = `dmap AS (SELECT device_id, min(user_id::VARCHAR) AS mapped FROM ${EV}
  WHERE user_id IS NOT NULL AND device_id IS NOT NULL GROUP BY 1),
ev AS (SELECT coalesce(e.user_id::VARCHAR, m.mapped) AS uid, e.time::TIMESTAMP AS t, e.*
  FROM ${EV} e LEFT JOIN dmap m ON e.device_id = m.device_id)`;

const TS = (isoStr) => dayjs.utc(isoStr).format("YYYY-MM-DD HH:mm:ss");
const D = (isoStr) => isoStr.slice(0, 10);
const band = (k) => [Math.round(k * 0.9 * 1000) / 1000, Math.round(k * 1.1 * 1000) / 1000];
const SQL_LIST = (xs) => xs.map((x) => `'${x}'`).join(", ");
const RAMPED = TS(dayjs.utc(ROUNDUPS_LAUNCH).add(ROUNDUP_RAMP_DAYS, "day"));
const INC_BASE_FROM = TS(dayjs.utc(OUTAGE_START).subtract(7, "day"));
const INC_BASE_TO = TS(dayjs.utc(OUTAGE_END).add(7, "day"));
const DD_COHORT_END = TS(dayjs.utc(DATASET_END).subtract(DD_WINDOW_DAYS, "day"));
const RET_COHORT_END = TS(dayjs.utc(DATASET_END).subtract(RETENTION_DAY + 7, "day"));

/** step_counts conversion for a set of segments from a timeToConvert breakdown. */
const convOf = (rows, segs) => {
	const rs = (rows || []).filter((x) => segs.includes(x.segment_value) && Array.isArray(x.step_counts) && x.step_counts[0]);
	if (!rs.length) return null;
	const entered = rs.reduce((a, r) => a + r.step_counts[0], 0);
	const converted = rs.reduce((a, r) => a + r.step_counts[r.step_counts.length - 1], 0);
	return { entered, converted, rate: converted / entered };
};

// H8: the boost days come from the warehouse (promo_code), the read is the
// first BOOST_READ_DAYS boost days vs the BOOST_READ_DAYS days before
const H8_SQL = `WITH ${ID_CTE},
b AS (SELECT min(date::DATE) AS d0 FROM ${WH("pocket_savings_daily")} WHERE promo_code <> 'none'),
w AS (SELECT CASE WHEN plan_tier IN (${SQL_LIST(PAID_PLANS)}) THEN 'paid' ELSE 'free' END AS grp,
  (t >= (SELECT d0 FROM b)) AS boost, event, uid FROM ev
  WHERE ((event = 'savings deposit' AND source = 'manual') OR event = 'app opened')
  AND t >= (SELECT d0 FROM b) - INTERVAL ${BOOST_READ_DAYS} DAY AND t < (SELECT d0 FROM b) + INTERVAL ${BOOST_READ_DAYS} DAY),
g AS (SELECT grp, boost, count(*) FILTER (WHERE event = 'savings deposit')::DOUBLE / count(*) FILTER (WHERE event = 'app opened') AS r,
  count(DISTINCT uid) AS users FROM w GROUP BY 1, 2)
SELECT grp, min(users) AS user_count, max(r) FILTER (WHERE boost) / max(r) FILTER (WHERE NOT boost) AS did FROM g GROUP BY 1`;

const H7_SQL = `WITH ${ID_CTE}
SELECT CASE WHEN autopay THEN 'autopay' ELSE 'manual' END AS grp, count(DISTINCT uid) AS user_count, count(*) AS payments,
 avg((payment_status = 'late')::INT) AS late_share
FROM ev WHERE event = 'bill paid' GROUP BY 1`;

const H6_SQL = `WITH ${ID_CTE},
v AS (SELECT distinct_id::VARCHAR AS uid, "${EXP_KEY}" AS variant FROM ${US} WHERE "${EXP_KEY}" IS NOT NULL),
b AS (SELECT uid, biller_id, t AS t0 FROM ev WHERE event = 'biller added' AND t >= TIMESTAMP '${TS(AUTOPAY_TEST_START)}'),
a AS (SELECT biller_id, min(t) AS t1 FROM ev WHERE event = 'autopay enabled' GROUP BY 1)
SELECT v.variant AS grp, count(DISTINCT b.uid) AS user_count, count(*) AS billers,
 avg(coalesce(a.t1 >= b.t0 AND a.t1 < b.t0 + INTERVAL 1 DAY, false)::INT) AS conv
FROM b JOIN v ON v.uid = b.uid LEFT JOIN a ON a.biller_id = b.biller_id GROUP BY 1`;

const H10_SQL = `WITH ${ID_CTE},
n AS (SELECT uid, count(*) FILTER (WHERE event = 'budget created') AS budgets FROM ev GROUP BY 1)
SELECT CASE WHEN budgets >= ${BUDGET_MAGIC} THEN 'three_plus' WHEN budgets = ${BUDGET_MAGIC - 1} THEN 'two' ELSE 'zero_one' END AS grp,
 count(DISTINCT ev.uid) AS user_count, count(*) AS deposits, avg(amount) AS avg_amount
FROM ev JOIN n ON n.uid = ev.uid WHERE ev.event = 'savings deposit' AND ev.source = 'manual' GROUP BY 1
UNION ALL
SELECT 'zero_two' AS grp, count(DISTINCT ev.uid) AS user_count, count(*) AS deposits, avg(amount) AS avg_amount
FROM ev JOIN n ON n.uid = ev.uid WHERE ev.event = 'savings deposit' AND ev.source = 'manual' AND n.budgets < ${BUDGET_MAGIC}`;

/** @type {import("../../../types").DungeonStory[]} */
export const stories = [
	{
		id: "H1-thin-file-onboarding",
		hook: "H1",
		archetype: "funnel-conversion-by-segment",
		narrative: `Applicants with a thin credit file (credit_history = thin_file) cannot be verified instantly against credit bureau data, so they upload documents and wait for review. They finish onboarding (account opened → identity verified → account funded, 7-day window) at ${THIN_FILE_MULT}x the rate of established files (${THIN_ONBOARD_CONV}% vs ${ONBOARD_CONV}%). Two declared first funnels with credit_history conditions; every step is an onboarding-only event, so the unique-user funnel reads the knobs directly.`,
		mixpanelReport: { type: "Funnels", steps: ONBOARD_STEPS, breakdown: "user property credit_history", window: "7 days" },
		assertions: [
			{
				breakdown: { type: "timeToConvert", steps: ONBOARD_STEPS, breakdownByUserProperty: "credit_history", conversionWindowMs: 7 * DAY_MS },
				// custom assert: conversion lives in the step_counts ARRAY of each
				// segment row; the expect grammar cannot index arrays
				assert: (rows) => {
					const thin = convOf(rows, ["thin_file"]), est = convOf(rows, ["established"]);
					if (!thin || !est) return { verdict: "NONE", detail: "missing segment rows" };
					if (thin.entered < 500 || est.entered < 1500) return { verdict: "WEAK", detail: `small segments ${thin.entered}/${est.entered}` };
					const ratio = thin.rate / est.rate;
					const [lo, hi] = band(THIN_ONBOARD_CONV / ONBOARD_CONV);
					const detail = `onboarding conversion thin_file ${thin.converted}/${thin.entered}=${thin.rate.toFixed(4)} vs established ${est.converted}/${est.entered}=${est.rate.toFixed(4)}; ratio ${ratio.toFixed(4)} (knob ${THIN_ONBOARD_CONV}/${ONBOARD_CONV}, band [${lo}, ${hi}])`;
					if (ratio >= lo && ratio <= hi) return { verdict: "NAILED", detail };
					return { verdict: ratio < 1 ? "WEAK" : "INVERSE", detail };
				},
			},
		],
	},
	{
		id: "H2-direct-deposit-retention",
		hook: "H2",
		archetype: "retention-divergence",
		narrative: `Funded new members who do not set up direct deposit within ${DD_WINDOW_DAYS} days of opening their account: ${DARK_SHARE * 100}% of them go dark, each on a salted day from day ${DARK_DAYS[0]} to day ${Math.floor(DARK_DAYS[1])} with most of the mass after day ${DD_WINDOW_DAYS} (a gradual slide, all before the day-${RETENTION_DAY} bracket). Whether a member sets up direct deposit is drawn per member (rate by acquisition channel, H5), independently of how active the member is, and every new member also faces the same organic lapse (${LAPSE_SHARE * 100}% stop on a front-loaded day ${LAPSE_DAYS[0]}-${LAPSE_DAYS[1]}; an adopter who lapses early still finishes the direct deposit switch first, so the lapse is independent of the split). Day-${RETENTION_DAY} retention (app opened in days ${RETENTION_DAY}-${RETENTION_DAY + 6} after account opened; members who opened at least ${RETENTION_DAY + 7} days before the window end) of direct-deposit-in-${DD_WINDOW_DAYS}-days members is therefore 1/(1−${DARK_SHARE}) = ${1 / (1 - DARK_SHARE)}x the rest. Mixpanel: Funnels account opened → direct deposit set up (${DD_WINDOW_DAYS}-day window) among members who did account funded; save converted and not-converted users as cohorts; Retention account opened → app opened, custom bracket day ${RETENTION_DAY}-${RETENTION_DAY + 6}, breakdown by those cohorts.`,
		mixpanelReport: { type: "Funnels → cohorts → Retention", cohortFunnel: `account opened → direct deposit set up, ${DD_WINDOW_DAYS}-day window, filter did account funded`, birth: "account opened", return: "app opened", brackets: `custom: day ${RETENTION_DAY}-${RETENTION_DAY + 6}` },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
s AS (SELECT uid, t AS t0 FROM ev WHERE event = 'account opened' AND t < TIMESTAMP '${RET_COHORT_END}'
  AND uid IN (SELECT uid FROM ev WHERE event = 'account funded')),
d AS (SELECT uid, min(t) AS td FROM ev WHERE event = 'direct deposit set up' GROUP BY 1),
f AS (SELECT s.uid, coalesce(d.td < s.t0 + INTERVAL ${DD_WINDOW_DAYS} DAY, false) AS dd,
  count(e.uid) FILTER (WHERE e.event = 'app opened' AND e.t >= s.t0 + INTERVAL ${RETENTION_DAY} DAY AND e.t < s.t0 + INTERVAL ${RETENTION_DAY + 7} DAY) AS ret
  FROM s LEFT JOIN d ON d.uid = s.uid LEFT JOIN ev e ON e.uid = s.uid GROUP BY 1, 2)
SELECT CASE WHEN dd THEN 'dd14' ELSE 'no_dd14' END AS grp, count(*) AS user_count, avg((ret > 0)::INT) AS retention FROM f GROUP BY 1`,
				},
				select: { a: { where: { grp: "dd14" } }, n: { where: { grp: "no_dd14" } } },
				expect: { metric: "a.retention / n.retention", op: "between", target: band(1 / (1 - DARK_SHARE)) },
				minCohort: 500,
			},
		],
	},
	{
		id: "H3-round-ups-launch",
		hook: "H3",
		archetype: "temporal-inflection",
		narrative: `Round-Ups launch ${D(ROUNDUPS_LAUNCH)}. ${ROUNDUP_ADOPT * 100}% of members turn it on, each on a day in the ${ROUNDUP_RAMP_DAYS} days after launch (at their first app visit from that day; members who join later turn it on at their first visit). From then on, each day with approved card purchases produces a Round-Up sweep the next morning: a server-side savings deposit with source = 'round_up' and amount = the day's spare change times the member's multiplier. Read 1: no round_up deposit exists before launch. Read 2: after the ramp, the share of members with an approved card purchase who also have a round_up deposit is the adoption knob (adoption is drawn independently of spending).`,
		mixpanelReport: { type: "Insights", event: "savings deposit", measure: "uniques", breakdown: "source", chart: "weekly line" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 count(*) FILTER (WHERE source = 'round_up' AND t < TIMESTAMP '${TS(ROUNDUPS_LAUNCH)}') AS impure_rows
FROM ev WHERE event = 'savings deposit'`,
				},
				select: { a: { where: { grp: "all" } } },
				// exact: a round_up deposit before launch is a bug
				expect: { metric: "a.impure_rows", op: "between", target: [0, 0] },
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
p AS (SELECT DISTINCT uid FROM ev WHERE event = 'card transaction' AND transaction_type = 'purchase' AND authorization_status = 'approved' AND t >= TIMESTAMP '${RAMPED}'),
r AS (SELECT DISTINCT uid FROM ev WHERE event = 'savings deposit' AND source = 'round_up' AND t >= TIMESTAMP '${RAMPED}')
SELECT 'purchasers' AS grp, count(*) AS user_count, count(r.uid)::DOUBLE / count(*) AS roundup_share FROM p LEFT JOIN r ON r.uid = p.uid`,
				},
				select: { a: { where: { grp: "purchasers" } } },
				expect: { metric: "a.roundup_share", op: "between", target: band(ROUNDUP_ADOPT) },
				minCohort: 2000,
			},
		],
	},
	{
		id: "H4-wallet-outage",
		hook: "H4",
		archetype: "external-join",
		narrative: `Penny Harbor's card processor's tokenization service fails from ${D(OUTAGE_START)} to ${D(OUTAGE_END)} (exclusive): ${OUTAGE_FAIL * 100}% of mobile-wallet (payment_channel = '${OUTAGE_CHANNEL}') transactions that would have been approved are declined. Half the declined members retry with the chip within minutes, and ${OUTAGE_TICKET * 100}% of declines lead to a support ticket. The outage days and channel come from the warehouse table card_authorizations_daily (processor_status = 'major_outage'); the event-side read is a ratio of ratios (wallet approval rate / other channels' approval rate, outage days vs the 7 days either side), which reads the 1 − ${OUTAGE_FAIL} keep rate while cancelling weekday and member mix.`,
		mixpanelReport: { type: "Insights", event: "card transaction", measure: "share with authorization_status = approved", breakdown: "payment_channel", chart: "daily line", join: "warehouse card_authorizations_daily.processor_status" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
o AS (SELECT DISTINCT date::DATE AS d, payment_channel FROM ${WH("card_authorizations_daily")} WHERE processor_status = 'major_outage'),
od AS (SELECT DISTINCT d FROM o), oc AS (SELECT DISTINCT payment_channel FROM o),
w AS (SELECT t::DATE AS d, uid, (payment_channel IN (SELECT payment_channel FROM oc)) AS hit, (authorization_status = 'approved') AS ok
  FROM ev WHERE event = 'card transaction' AND t >= TIMESTAMP '${INC_BASE_FROM}' AND t < TIMESTAMP '${INC_BASE_TO}'),
g AS (SELECT (d IN (SELECT d FROM od)) AS outage, avg(ok::INT) FILTER (WHERE hit) / avg(ok::INT) FILTER (WHERE NOT hit) AS rel, count(DISTINCT uid) AS users FROM w GROUP BY 1)
SELECT 'all' AS grp, (SELECT count(*) FROM od) AS outage_days, min(users) AS user_count,
 max(rel) FILTER (WHERE outage) / max(rel) FILTER (WHERE NOT outage) AS did
FROM g`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.did", op: "between", target: band(1 - OUTAGE_FAIL) },
				minCohort: 1000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT 'all' AS grp,
 count(*) FILTER (WHERE processor_status = 'major_outage') AS outage_rows,
 avg(tokenization_error_rate) FILTER (WHERE processor_status = 'major_outage') AS outage_err
FROM ${WH("card_authorizations_daily")}`,
				},
				select: { a: { where: { grp: "all" } } },
				// warehouse tokenization error rate during the outage = the failure knob
				expect: { metric: "a.outage_err", op: "between", target: band(OUTAGE_FAIL) },
			},
		],
	},
	{
		id: "H5-paid-channel-economics",
		hook: "H5",
		archetype: "attribution-bias",
		narrative: `Comparison-site signups cost ${(CPL_USD.comparison_sites / CPL_USD.paid_social).toFixed(2)}x as much as paid-social signups over the window (warehouse paid_acquisition_daily bills automated bidding against a cost-per-signup target: each channel-day's spend = target cost per signup × the channel's average daily signups over the previous ${SPEND_LOOKBACK_DAYS} days (the media plan fills the first week), weekday shape above a ${SPEND_FLAT_SHARE * 100}% flat floor, seeded ±${SPEND_NOISE * 100}% noise, never zero, so the window cost per signup holds at the target: $${CPL_USD.comparison_sites} vs $${CPL_USD.paid_social} per signup at the window level), but funded comparison-site members set up direct deposit within ${DD_WINDOW_DAYS} days ${(DD_ADOPT.comparison_sites / DD_ADOPT.paid_social).toFixed(2)}x as often (${DD_ADOPT.comparison_sites} vs ${DD_ADOPT.paid_social}; channel is drawn independently of segment and credit file, so per signup the ratio is the same). Spend per signup needs the warehouse join. The direct-deposit read is the Mixpanel funnel account opened → direct deposit set up with a ${DD_WINDOW_DAYS}-day window, date range ${D(DATASET_START)} to ${D(DD_COHORT_END)} (every signup has its full window); paid-social direct-deposit counts are about a hundred, so it uses the knob as target with a knob-derived floor.`,
		mixpanelReport: { type: "Insights + Funnels + warehouse", event: "account opened", breakdown: "acquisition_channel", join: "paid_acquisition_daily.spend_usd", funnel: `account opened → direct deposit set up, ${DD_WINDOW_DAYS}-day window, breakdown acquisition_channel` },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
s AS (SELECT acquisition_channel AS ch, count(*) AS signups, count(DISTINCT uid) AS users FROM ev WHERE event = 'account opened' GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM ${WH("paid_acquisition_daily")} GROUP BY 1)
SELECT s.ch AS grp, s.users AS user_count, sp.spend / s.signups AS spend_per_signup FROM s JOIN sp ON sp.ch = s.ch`,
				},
				select: { c: { where: { grp: "comparison_sites" } }, p: { where: { grp: "paid_social" } } },
				expect: { metric: "c.spend_per_signup / p.spend_per_signup", op: "between", target: band(CPL_USD.comparison_sites / CPL_USD.paid_social) },
				minCohort: 400,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
s AS (SELECT uid, t AS t0, acquisition_channel AS ch FROM ev WHERE event = 'account opened' AND t < TIMESTAMP '${DD_COHORT_END}'),
d AS (SELECT uid, min(t) AS td FROM ev WHERE event = 'direct deposit set up' GROUP BY 1)
SELECT s.ch AS grp, count(*) AS user_count, avg(coalesce(d.td < s.t0 + INTERVAL ${DD_WINDOW_DAYS} DAY, false)::INT) AS dd_rate
FROM s LEFT JOIN d ON d.uid = s.uid GROUP BY 1`,
				},
				select: { c: { where: { grp: "comparison_sites" } }, p: { where: { grp: "paid_social" } } },
				expect: { metric: "c.dd_rate / p.dd_rate", op: ">=", target: DD_ADOPT.comparison_sites / DD_ADOPT.paid_social, floor: 1 + 0.5 * (DD_ADOPT.comparison_sites / DD_ADOPT.paid_social - 1) },
				minCohort: 400,
			},
		],
	},
	{
		id: "H6-autopay-default-experiment",
		hook: "H6",
		archetype: "experiment-lift",
		narrative: `The "${AUTOPAY_EXPERIMENT}" test starts ${D(AUTOPAY_TEST_START)} and splits members who add a biller 50/50 (sticky hash). "${AUTOPAY_VARIANT}" pre-selects AutoPay on the add-biller screen and multiplies the share of new billers that get AutoPay by ${AUTOPAY_DEFAULT_MULT} (${AUTOPAY_CONV}% → ${Math.round(AUTOPAY_CONV * AUTOPAY_DEFAULT_MULT)}%). A biller and its AutoPay event share a biller_id, so a totals funnel holding biller_id constant measures per-biller adoption. Set the date range to ${D(AUTOPAY_TEST_START)} through ${D(DATASET_END)}: billers added before the test carry the member's later variant on the profile and dilute the read.`,
		mixpanelReport: { type: "Funnels", steps: ["biller added", "autopay enabled"], counting: "totals", holdPropertyConstant: "biller_id", breakdown: `user property "${EXP_KEY}"`, window: "1 day" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H6_SQL },
				select: { v: { where: { grp: AUTOPAY_VARIANT } }, c: { where: { grp: "Control" } } },
				expect: { metric: "v.conv / c.conv", op: "between", target: band(AUTOPAY_DEFAULT_MULT) },
				minCohort: 1000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 count(DISTINCT uid) FILTER (WHERE "Variant name" = '${AUTOPAY_VARIANT}')::DOUBLE / count(DISTINCT uid) AS variant_share
FROM ev WHERE event = '$experiment_started'`,
				},
				select: { a: { where: { grp: "all" } } },
				// equal-weight 2-arm hash → 0.5
				expect: { metric: "a.variant_share", op: "between", target: band(0.5) },
				minCohort: 1500,
			},
		],
	},
	{
		id: "H7-manual-payers-pay-late",
		hook: "H7",
		archetype: "cohort-prop-scale",
		narrative: `Every bill payment comes from a biller's monthly schedule (due day per biller; rent on the 1st). A payment the member makes by hand is late ${LATE_SHARE.manual * 100}% of the time; an AutoPay payment is late ${LATE_SHARE.autopay * 100}% of the time (insufficient funds, retried a few business days later). AutoPay applies from the moment it is turned on for that biller, so the autopay flag on bill paid is the payment method at payment time. Both shares are knob reads.`,
		mixpanelReport: { type: "Insights", event: "bill paid", measure: "total", breakdown: ["autopay", "payment_status"] },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H7_SQL },
				select: { m: { where: { grp: "manual" } } },
				expect: { metric: "m.late_share", op: "between", target: band(LATE_SHARE.manual) },
				minCohort: 2000,
			},
			{
				breakdown: { type: "duckdb", sql: H7_SQL },
				select: { a: { where: { grp: "autopay" } } },
				expect: { metric: "a.late_share", op: "between", target: band(LATE_SHARE.autopay) },
				minCohort: 2000,
			},
		],
	},
	{
		id: "H8-summer-saver-boost",
		hook: "H8",
		archetype: "temporal-inflection",
		narrative: `From ${D(BOOST_START)} through Sep 30 the Summer Saver Boost pays ${APY_BOOST.toFixed(2)}% APY on Plus and Premium Pockets (from ${APY_BASE.plus.toFixed(2)}% / ${APY_BASE.premium.toFixed(2)}%); Free stays ${APY_BASE.free.toFixed(2)}%. Members on Plus or Premium (plan_tier at event time) make ${BOOST_DEPOSIT_MULT}x as many manual Pocket deposits; Free members do not change. The boost exists only in the warehouse table pocket_savings_daily (apy_pct, promo_code); the read takes the boost start from it and compares manual deposits per app visit in the first ${BOOST_READ_DAYS} boost days vs the ${BOOST_READ_DAYS} days before, which reads the multiplier for paid plans and 1.0 for Free while cancelling weekday mix and the growing member base. Round-Up sweeps are a separate source and are excluded.`,
		mixpanelReport: { type: "Insights", events: ["savings deposit (source = manual)", "app opened"], measure: "total", formula: "A / B", breakdown: "plan_tier", chart: "weekly line", join: "pocket_savings_daily.apy_pct" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H8_SQL },
				select: { p: { where: { grp: "paid" } } },
				expect: { metric: "p.did", op: "between", target: band(BOOST_DEPOSIT_MULT) },
				minCohort: 1000,
			},
			{
				breakdown: { type: "duckdb", sql: H8_SQL },
				select: { f: { where: { grp: "free" } } },
				// control: Free Pockets earn the same rate throughout
				expect: { metric: "f.did", op: "between", target: band(1) },
				minCohort: 1000,
			},
		],
	},
	{
		id: "H9-premium-priority-support",
		hook: "H9",
		archetype: "funnel-ttc-by-segment",
		narrative: `Premium includes priority support: time from "support ticket opened" to "support ticket resolved" is ${SUPPORT_PLAN_MULT.premium}x for members on Premium when they open the ticket, vs Free and Plus. A ticket's two events share a ticket_id, so a funnel holding ticket_id constant measures each ticket on its own; contact channel speed is independent of plan, so the median ratio reads the knob.`,
		mixpanelReport: { type: "Funnels", steps: ["support ticket opened", "support ticket resolved"], measure: "median time to convert", holdPropertyConstant: "ticket_id", breakdown: "plan_tier", window: "30 days (Mixpanel default)" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
o AS (SELECT ticket_id, any_value(uid) AS uid, min(t) AS t0, any_value(plan_tier) AS plan FROM ev WHERE event = 'support ticket opened' GROUP BY 1),
r AS (SELECT ticket_id, min(t) AS t1 FROM ev WHERE event = 'support ticket resolved' GROUP BY 1),
x AS (SELECT CASE WHEN o.plan = 'premium' THEN 'premium' ELSE 'free_plus' END AS grp, o.uid, date_diff('second', o.t0, r.t1) AS ttc
  FROM o JOIN r ON r.ticket_id = o.ticket_id WHERE r.t1 >= o.t0)
SELECT grp, count(DISTINCT uid) AS user_count, count(*) AS tickets, median(ttc) AS med_ttc FROM x GROUP BY 1`,
				},
				select: { p: { where: { grp: "premium" } }, o: { where: { grp: "free_plus" } } },
				expect: { metric: "p.med_ttc / o.med_ttc", op: "between", target: band(SUPPORT_PLAN_MULT.premium) },
				minCohort: 250,
			},
		],
	},
	{
		id: "H10-budget-magic-number",
		hook: "H10",
		archetype: "cohort-prop-scale",
		narrative: `Members who create ${BUDGET_MAGIC} or more budgets in the window put ${BUDGET_SAVE_MULT}x as much into each manual Pocket deposit as members with fewer. It is a step at ${BUDGET_MAGIC}, flat on either side: members with ${BUDGET_MAGIC - 1} budgets deposit the same as members with 0-1. The base deposit size does not depend on segment or activity, so the ratio of average deposit amounts reads the knob even though heavier users create more budgets. It is a member trait, not a change at the moment of the third budget: a planner deposits more across the whole window, including before the third budget, so a before/after read around the threshold shows no step. Mixpanel: Insights, savings deposit filtered to source = manual, average amount, breakdown by cohort bins on the count of budget created in the window.`,
		mixpanelReport: { type: "Insights", event: "savings deposit (source = manual)", measure: "average amount", breakdown: "cohorts: did budget created ≥3 / exactly 2 / 0-1 times" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H10_SQL },
				select: { h: { where: { grp: "three_plus" } }, l: { where: { grp: "zero_two" } } },
				expect: { metric: "h.avg_amount / l.avg_amount", op: "between", target: band(BUDGET_SAVE_MULT) },
				minCohort: 1000,
			},
			{
				breakdown: { type: "duckdb", sql: H10_SQL },
				select: { t: { where: { grp: "two" } }, z: { where: { grp: "zero_one" } } },
				// below the threshold nothing changes: 2 budgets vs 0-1
				expect: { metric: "t.avg_amount / z.avg_amount", op: "between", target: band(1) },
				minCohort: 1000,
			},
		],
	},
];

export default config;
