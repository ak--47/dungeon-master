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
 * NAME:       Ledgerline
 * APP:        Retail crypto exchange and wallet (iOS and Android apps). Customers
 *             sign up, verify their identity, fund the account (bank transfer,
 *             debit card, crypto transfer, wire), buy with Simple Buy (one asset,
 *             flat 1.49% fee), trade on Advanced Trade (maker 0.25% / taker 0.40%),
 *             set up recurring buys, stake for rewards (Ledgerline keeps a
 *             commission: 15% → 25% from 2026-08-19), set price alerts, and
 *             withdraw to external wallets on five networks.
 * SCALE:      10,000 users (3,968 sign up inside the window), 1.26M events,
 *             120 days (2026-06-04 → 2026-10-01, UTC)
 * CORE LOOP:  app opened → asset viewed → trade executed / quick buy completed;
 *             deposit completed and withdrawal submitted → withdrawal confirmed move money
 * VALUE MOMENT: first deposit completed (a funded account)
 *
 * EVENTS (22):
 *   app opened (one per session) > asset viewed > portfolio viewed > quick buy started
 *   > trade executed > deposit completed > quick buy completed > withdrawal submitted
 *   > withdrawal confirmed > recurring buy executed > news article viewed
 *   > price alert triggered > price alert created > stake started > $experiment_started
 *   > unstake requested > referral link shared > account created
 *   > identity verification started > identity verified > recurring buy created
 *   > recurring buy cancelled
 *
 * FUNNELS (11):
 *   - Onboarding (first funnel, 4 copies by signup era × channel, H3 + H6):
 *       account created → identity verification started → identity verified → deposit completed
 *       (46% before 2026-07-28, 60% from it; influencer_affiliate at half: 23% / 30%;
 *       time budget 40 h → 14 h)
 *   - Simple Buy: quick buy started → quick buy completed (60%, 15 min, order_id per
 *       order; A/B "One-Tap Buy" from 2026-07-08, H5)
 *   - Advanced Trade: asset viewed → trade executed (70% active traders / crypto
 *       natives with weight 9; 50% casual investors with weight 1)
 *   - Funding: portfolio viewed → deposit completed (70%)
 *   - Earn: asset viewed → stake started (35%); Unstake: portfolio viewed → unstake requested (20%)
 *   - Withdrawal: withdrawal submitted → withdrawal confirmed (97%, withdrawal_id per withdrawal)
 *
 * USER PROPS:  investor_type, acquisition_channel, customer_since, kyc_status,
 *              "Experiment: One-Tap Buy" (enrolled users), engine location
 * SUPER PROPS: none
 * SCD PROPS:   none
 * GROUPS:      none
 * WAREHOUSE:   market_prices_daily (OHLC, return, realized volatility, global volume by asset),
 *              chain_network_daily (withdrawals broadcast, fees, confirmation time, status by network),
 *              paid_marketing_daily (spend, platform signups, clicks, impressions by paid channel)
 * LOOKUPS:     none — every attribute is denormalized onto events/profiles
 * SOUP:        flat week (crypto trades every day), UTC hours weighted to the
 *              European and American afternoon and evening
 *
 * IDENTITY: new users are identified at "account created" (isAuthEvent, first
 * event, carries user_id + device_id); about 2 devices per user (phones and
 * tablets, iOS / iPadOS / Android). Every event carries user_id; there is no
 * anonymous pre-signup activity. The three onboarding steps after signup are
 * sent server-side with user_id only. Recurring-buy events cloned from a
 * device-less first deposit (a plan set up right after it) carry no device_id
 * either; every other event carries device_id.
 *
 * DESIGN NOTES:
 * - Market model: one seeded BTC volatility series (smooth daily noise plus ten
 *   dated market-moving days) drives daily returns for nine assets (beta to the
 *   market plus seeded idiosyncratic moves). The same series writes
 *   market_prices_daily and prices every trade, Simple Buy, and recurring-buy
 *   execution (open → close through the UTC day, ±0.4% noise, clamped to the
 *   day's high/low). Price alerts fire more often on volatile days.
 * - Sessions: every session (30-minute gap between user-initiated events) starts
 *   with an "app opened" cloned from its first event (same device, session id,
 *   location; that event's own properties dropped). The signup session has none.
 *   Server-side events (price alert triggered, recurring buy executed, withdrawal
 *   confirmed) never start a session. A session that begins within 30 minutes
 *   after a price alert has entry_point push_notification. Push opens: each
 *   customer has a salted propensity (0-28%, mean 14%) to open a price alert;
 *   an open adds an "asset viewed" of the alert's coin 1-15 minutes later
 *   (never after a new user has gone quiet). Push opens ≈ 15% of alerts.
 * - Money moves only after a new user is verified and funded: the hook drops any
 *   money event before the onboarding deposit (the engine gives unconverted users
 *   standalone events only, so this is a guard).
 * - Linked units: Simple Buy start/complete share order_id; withdrawal submit/
 *   confirm share withdrawal_id (confirmation time = network median × lognormal,
 *   confirmation_mins is the real gap); a relabeled ONDO trade takes its chart
 *   view with it. Advanced Trade extra fills (H1) are new orders with their own
 *   side and size.
 * - Recurring buys: established customers with a plan that predates the window
 *   (33%) execute from June 4 (warm start); new plans come from H4 planners, a
 *   few later setups, and a few established customers. Every plan has a seeded
 *   lifetime (exponential, mean 180 days) and ends with a "recurring buy
 *   cancelled" in-app; a customer who has gone quiet never cancels, so the plan
 *   keeps executing. Weekly executions are flat (±10%) across the window.
 * - Staking: new users can only unstake after staking in the window;
 *   established customers have pre-window stakes. Net APY = gross APY × (1 −
 *   commission at the stake time) × ±3% daily jitter.
 * - Warehouse drift: chain_network_daily.withdrawals_broadcast adds seeded
 *   institutional API withdrawals that never send a product event (audit corr ≈
 *   0.97 vs the Mixpanel count). paid_marketing_daily spend is a paced daily
 *   budget (CPL × expected signups per day, weekday shape, ±14% seeded noise,
 *   never zero); platform signups, clicks, and impressions follow spend.
 *   market_prices_daily is exogenous (corr ≈ 0 with Ledgerline's trade count).
 * - retentionCurve shapes new users' activity; the engine pins each new user's
 *   signup to profile `created` (UTC) and customer_since is that date.
 * - Low-frequency actions are thinned in the hook (referral link shared kept at
 *   25%, price alert created at 45%) because the engine's minimum event weight
 *   is 1; the experiment exposure is kept once per user (the SDK sends it once).
 */

// ── HOOK STORIES ──
/*
 * All effects are hidden: no flag properties. Each is found by a breakdown, a
 * date comparison, a cohort, or a warehouse join. Dates live in the TIMELINE
 * constants and are shared by hooks, stories, SQL, warehouse columns, and the
 * timeline guide.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H1. VOLATILITY DRIVES TRADING (everything + warehouse market_prices_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: each Advanced Trade fill on a UTC day gets extra fills in
 *   proportion to BTC realized volatility above 2.5% (0.3 extra per volatility
 *   point; new orders with their own side and size). Simple Buy does not react.
 * MIXPANEL: Insights, trade executed total ÷ daily unique active users, daily;
 *   export and join market_prices_daily (asset BTC, realized_vol_pct); compare
 *   days ≥ 4.5% vs < 3.0%.
 * REAL WORLD: active traders trade the moves; casual buyers do not.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H2. ETHEREUM CONGESTION (everything + warehouse chain_network_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-07-20 to 2026-07-22, 60% of ethereum-network withdrawals that
 *   would have confirmed never confirm; fees on them run 6x and the ones that
 *   confirm take 8x longer. The warehouse shows network_status = congested and
 *   failed_broadcast_rate ≈ 0.6 for ethereum on those days.
 * MIXPANEL: Funnels, withdrawal submitted → withdrawal confirmed, totals, hold
 *   withdrawal_id constant, breakdown network, daily; join the warehouse status.
 * REAL WORLD: gas spikes strand withdrawals on one chain while others run fine.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H3. KYC VENDOR SWITCH (declarative duplicate first funnels)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: signups from 2026-07-28 finish onboarding (through first deposit,
 *   7-day window) at 60% instead of 46% (1.30x) and in 0.35x the time.
 * MIXPANEL: Funnels, account created → identity verification started →
 *   identity verified → deposit completed, 7-day window, conversion and median
 *   time to convert, signups before vs from 2026-07-28.
 * REAL WORLD: a faster document and selfie check removes the overnight wait.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H4. RECURRING BUY HABIT (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 40% of funded new users (salted, independent of activity) set up a
 *   recurring buy in their first 10 days. 55% of funded new users without one go
 *   quiet after day 21; 40% of all new users lapse on a uniform day 10-90.
 *   Executions keep running for quiet users. D30 ratio ≈ 1/(1 − 0.55).
 * MIXPANEL: Retention, account created → app opened, custom bracket day 30-36,
 *   breakdown cohort "did recurring buy created within 14 days of signup"
 *   (Funnels account created → recurring buy created, 14-day window), filter
 *   cohort "did deposit completed".
 * REAL WORLD: automated buying builds a habit and a reason to check the app.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H5. ONE-TAP BUY EXPERIMENT (declarative funnel experiment)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-07-08 users split 50/50; "One-Tap" multiplies Simple Buy
 *   order completion by 1.2 and start → complete time by 0.6.
 * MIXPANEL: Funnels, quick buy started → quick buy completed, totals, hold
 *   order_id constant, breakdown user property "Experiment: One-Tap Buy".
 * REAL WORLD: removing the review screen cuts drop-off and time to buy.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H6. PAID CHANNEL QUALITY (declarative first funnels + warehouse paid_marketing_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: spend per Mixpanel signup is $40 influencer_affiliate, $48 app store
 *   ads, $55 paid social, $70 paid search (paced daily budgets); influencer and
 *   affiliate signups finish onboarding at 0.5x the other channels.
 * MIXPANEL: Insights account created by acquisition_channel joined to
 *   paid_marketing_daily.spend_usd; Funnels onboarding by acquisition_channel.
 * REAL WORLD: creator-driven signups are cheap and curious, not committed.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H7. DRAWDOWN PANIC SELLING (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-09-09 to 2026-09-11, new customers turn 50% of the buys they
 *   would have placed into sells; established customers 10%.
 * MIXPANEL: Insights, trade executed, breakdown side and customer_since
 *   (before / from 2026-06-04), daily % of total; compare with the 28 days before.
 * REAL WORLD: first-cycle investors sell into a crash; veterans hold.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H8. STAKING COMMISSION CHANGE (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-08-19 the commission rises 15% → 25%, net APY on new stakes
 *   falls to 0.882x, new stakes run 0.75x, and unstake requests run 1.8x for 21
 *   days.
 * MIXPANEL: Insights, stake started and unstake requested totals, weekly, filter
 *   customer_since before 2026-06-04; average apy_pct on stake started by asset.
 * REAL WORLD: yield-sensitive holders move stake elsewhere after a fee rise.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H9. ANDROID 5.12 SIMPLE BUY BUG (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-08-26 to 2026-08-28, 50% of Android Simple Buy orders that would
 *   have completed never do. iOS and iPadOS are untouched.
 * MIXPANEL: Funnels, quick buy started → quick buy completed, totals, hold
 *   order_id constant, breakdown os, daily.
 * REAL WORLD: a release regression on one platform hides in the blended rate.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H10. ONDO LISTING (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-08-05, 40% of Advanced Trade users (salted) take up ONDO on
 *   a day in the next 10 days and move 10-30% (mean 20%) of their trades into
 *   it: 0.08 of trades after the ramp, none before.
 * MIXPANEL: Insights, trade executed, breakdown asset, daily % of total.
 * REAL WORLD: a new listing takes share from existing pairs.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * EXPECTED METRICS SUMMARY (measured: data/verify-crypto, 2026-10-07)
 * ═════════════════════════════════════════════════════════════════════════
 * Hook | Metric                                         | Derivation                 | Expected | Measured
 * -----|------------------------------------------------|----------------------------|----------|---------
 * H1   | trades per active user, volatile / calm days    | mean tradeMult high / calm | 1.857    | 1.845 (0.569 vs 0.309)
 * H1   | Simple Buy per active user, volatile / calm     | unchanged (control)        | 1.00     | 0.996
 * H2   | ethereum / other confirm rate, congested vs ±7d | 1 − CONGESTION_FAIL        | 0.40     | 0.422 (40.4% vs 97.7%)
 * H2   | warehouse failed_broadcast_rate, congested days | CONGESTION_FAIL            | 0.60     | 0.610
 * H3   | onboarding completion, from / before Jul 28     | 60 / 46                    | 1.304    | 1.414 (56.8% vs 40.1%)
 * H3   | median sign-up → first deposit, from / before   | 14 h / 40 h                | 0.35     | 0.349 (10.4 h vs 29.9 h)
 * H4   | D30 retention, recurring buy / none (funded)    | 1 / (1 − 0.55)             | 2.222    | 2.299 (79.3% vs 34.5%)
 * H4   | D7 retention, recurring buy / none (parity)     | unchanged before day 21    | 1.00     | 0.997
 * H5   | per-order completion, One-Tap / Control         | ONE_TAP_CONV_MULT          | 1.20     | 1.212 (71.7% vs 59.2%)
 * H5   | median start → complete, One-Tap / Control      | ONE_TAP_TTC_MULT           | 0.60     | 0.600 (270 s vs 450 s)
 * H5   | One-Tap share of exposed users                  | equal 2-arm hash           | 0.50     | 0.506
 * H6   | spend per signup, influencer / paid search      | 40 / 70                    | 0.571    | 0.618 ($41.92 vs $67.84)
 * H6   | 7-day funded rate, influencer / paid search     | LOW_QUALITY_MULT           | 0.50     | 0.495 (27.1% vs 54.7%)
 * H7   | sell share Sep 9-11 / prior 28 days, new        | 1 + 0.5 × 0.55 / 0.45      | 1.611    | 1.582 (72.5% vs 45.8%)
 * H7   | same, established                               | 1 + 0.1 × 0.55 / 0.45      | 1.122    | 1.087 (49.2% vs 45.2%)
 * H8   | established stakes, 21 d after / before         | STAKE_KEEP_AFTER           | 0.75     | 0.757 (1,654 vs 2,184)
 * H8   | established unstakes, 21 d after / before       | UNSTAKE_SURGE_MULT         | 1.80     | 1.807 (2,251 vs 1,246)
 * H8   | ETH net APY on new stakes, after / before       | 0.75 / 0.85                | 0.882    | 0.884 (2.71% vs 3.06%)
 * H9   | Android / Apple completion, Aug 26-28 vs ±7d    | 1 − ANDROID_FAIL           | 0.50     | 0.537 (34.2% vs 65.4%)
 * H10  | ONDO rows before the listing                    | exact                      | 0        | 0
 * H10  | ONDO share of trades after the ramp             | 0.4 × 0.2                  | 0.080    | 0.075
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Every assertion lands inside its knob-derived NAILED band (10/10 stories
 * NAILED). Four sit away from the knob for sampling reasons, not a confound:
 * H3's conversion ratio (1.414) rests on two binomial rates from about 1,800
 * sign-ups each (relative SE about 3% per arm): the pre-switch rate is 1.8
 * points under its knob mix (41.9%) and the post-switch rate 2.2 points over
 * (54.6%). H6's spend ratio (0.618) moves with the realized sign-up count
 * per channel, since the budget is paced to the expected count (686
 * influencer sign-ups vs 720 expected). H10's share (0.075) depends on which
 * heavy traders the salted adopter draw picked. H9's ratio (0.537) rests on
 * 1,047 Android orders in the three incident days (relative SE about 4%).
 * H4 uses a knob target with a
 * knob-derived floor (1.61) because the realized dark share in a cohort of
 * about 770 users moves the ratio by several percent.
 */

// ── SCALE ──
const SEED = "coinnest";
const NUM_USERS = 10_000;
const DATASET_START = "2026-06-04T00:00:00Z";
const DATASET_END = "2026-10-01T23:59:59Z"; // 120 days
const EVENTS_PER_DAY = 1.2;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── TIMELINE (shared by hooks, stories, SQL, warehouse columns, guides) ──
const ONE_TAP_START = "2026-07-08T00:00:00Z";          // "One-Tap Buy" Simple Buy experiment starts
const ETH_CONGESTION_START = "2026-07-20T00:00:00Z";   // Ethereum network congestion (withdrawals)
const ETH_CONGESTION_END = "2026-07-23T00:00:00Z";     // exclusive (3 days)
const KYC_VENDOR_SWITCH = "2026-07-28T00:00:00Z";      // new identity verification vendor (signups from this date)
const ONDO_LISTING = "2026-08-05T00:00:00Z";           // ONDO listed on Advanced Trade
const STAKING_COMMISSION_CHANGE = "2026-08-19T00:00:00Z"; // staking commission 15% → 25%
const ANDROID_RELEASE = "2026-08-26T00:00:00Z";        // Android app 5.12 released
const ANDROID_HOTFIX = "2026-08-29T00:00:00Z";         // Android 5.12.1 hotfix (exclusive end)
const CRASH_START = "2026-09-09T00:00:00Z";            // market drawdown
const CRASH_END = "2026-09-12T00:00:00Z";              // exclusive (3 days)

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;
const ms = (iso) => Date.parse(iso);
const D0_MS = ms(DATASET_START);
const END_MS = ms(DATASET_END);
const NUM_DAYS = 120;
const D0 = DATASET_START.slice(0, 10);
const dayIdx = (t) => Math.floor((t - D0_MS) / DAY_MS);
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const T = (e) => Date.parse(e.time);
const iso = (t) => new Date(t).toISOString();

// ── WEEKLY AND DAILY RHYTHM (soup) ──
// Sun..Sat. Crypto trades every day; retail activity dips a little on Friday night and Saturday.
const DOW_WEIGHTS = [0.93, 1.0, 1.0, 1.0, 0.98, 0.95, 0.9];
// UTC hours: North American evenings (00-04 UTC) and the European and US
// daytime overlap (13-21 UTC) are busiest; the quietest hours are 04-09 UTC.
const HOUR_WEIGHTS = [0.8, 0.72, 0.62, 0.52, 0.42, 0.36, 0.36, 0.4, 0.48, 0.56, 0.62, 0.68,
	0.75, 0.84, 0.92, 0.97, 1.0, 1.0, 0.98, 0.96, 0.95, 0.93, 0.9, 0.85];

// ── KNOBS ──
// H1 volatility drives trading: every Advanced Trade fill on a UTC day is
// cloned so the day's trades per active user scale with BTC realized volatility
const VOL_PIVOT = 2.5;              // BTC realized vol (%) at which trading starts to rise
const VOL_TRADE_SENS = 0.3;         // extra trades per trade for each vol point above the pivot
const HIGH_VOL_PCT = 4.5;           // "high volatility" day: BTC realized_vol_pct ≥ 4.5
const CALM_VOL_PCT = 3.0;           // "calm" day: BTC realized_vol_pct < 3.0
const tradeMult = (vol) => 1 + VOL_TRADE_SENS * Math.max(0, vol - VOL_PIVOT);

// H2 Ethereum congestion: withdrawals on the ethereum network fail and cost more
const CONGESTION_NETWORK = "ethereum";
const CONGESTION_FAIL = 0.6;        // share of would-be confirmations that fail during congestion
const CONGESTION_FEE_MULT = 6;      // network fee multiplier during congestion
const CONGESTION_CONF_MULT = 8;     // confirmation time multiplier for withdrawals that do confirm

// H3 KYC vendor switch (declarative duplicate first funnels by signup date)
const ONBOARD_CONV_OLD = 46;        // onboarding completion (through first deposit), signups before the switch
const ONBOARD_CONV_NEW = 60;        // signups from the switch
const ONBOARD_TTC_OLD_H = 40;
const ONBOARD_TTC_NEW_H = 14;

// H4 recurring buy habit → retention (new users who funded their account)
const PLANNER_SHARE = 0.4;          // funded new users who set up a recurring buy in their first days (salted)
const PLAN_EARLY_DAYS = 10;         // planners create the plan within 10 days of signup
const HABIT_WINDOW_DAYS = 14;       // classification window used by the read
const DARK_SHARE = 0.55;            // funded new users with no recurring buy who go dark after day 21
const DARK_AFTER_DAYS = 21;
const LAPSE_SHARE = 0.4;            // organic lapse, every new user, independent of the habit
const LAPSE_DAY_MIN = 10;
const LAPSE_DAY_MAX = 90;
const ABANDON_SHARE = 0.65;         // new users who never fund: share who stop on day 1-6
const LATE_PLAN_KEEP = 0.15;        // non-planners: chance a later recurring buy (after day 14) is kept
const EST_PLANNER_SHARE = 0.33;     // established customers with a recurring buy that predates the window
const PLAN_LIFE_DAYS = 180;         // mean plan lifetime before the customer cancels (exponential)
const PLAN_EXTRA_KEYS = ["price_usd", "fee_usd"]; // execution-only fields
const EST_NEW_PLAN_KEEP = 0.1;      // established customers: chance an in-window plan creation is kept
const PLAN_FREQ = { daily: 8, weekly: 55, biweekly: 17, monthly: 20 };
const PLAN_PERIOD_DAYS = { daily: 1, weekly: 7, biweekly: 14, monthly: 30 };
const PLAN_ASSETS = { BTC: 55, ETH: 30, SOL: 15 };

// H5 One-Tap Buy experiment (declarative funnel experiment on Simple Buy)
const ONE_TAP_EXPERIMENT = "One-Tap Buy";
const ONE_TAP_VARIANT = "One-Tap";
const EXP_KEY = `Experiment: ${ONE_TAP_EXPERIMENT}`;
const ONE_TAP_CONV_MULT = 1.2;
const ONE_TAP_TTC_MULT = 0.6;
const QUICK_BUY_CONV = 60;
const QUICK_BUY_TTC_H = 0.25;      // the engine floors a funnel ttc at 0.1 h, so 0.25 × 0.6 stays above it

// H6 paid channel economics (warehouse paid_marketing_daily) + onboarding quality
const PAID_CHANNELS = ["paid_search", "paid_social", "influencer_affiliate", "app_store_ads"];
const CPL_USD = { paid_search: 70, paid_social: 55, influencer_affiliate: 40, app_store_ads: 48 }; // window cost per Mixpanel signup
const CHANNEL_WEIGHTS = { organic: 28, referral: 12, paid_search: 16, paid_social: 14, influencer_affiliate: 18, app_store_ads: 12 };
const LOW_QUALITY_CHANNEL = "influencer_affiliate";
const LOW_QUALITY_MULT = 0.5;       // onboarding completion multiplier for influencer / affiliate signups
const BORN_PCT = 40;                // percentUsersBornInDataset
const DAILY_BUDGET_USD = Object.fromEntries(PAID_CHANNELS.map((ch) => {
	const totalW = Object.values(CHANNEL_WEIGHTS).reduce((a, b) => a + b, 0);
	return [ch, CPL_USD[ch] * (NUM_USERS * BORN_PCT / 100) * (CHANNEL_WEIGHTS[ch] / totalW) / NUM_DAYS];
}));
const SPEND_WEEKDAY = (() => {
	const m = DOW_WEIGHTS.reduce((a, b) => a + b, 0) / DOW_WEIGHTS.length;
	return DOW_WEIGHTS.map((w) => w / m);
})();
const SPEND_NOISE = 0.14;
const PLATFORM_SIGNUP_INFLATION = { paid_search: 1.1, paid_social: 1.25, influencer_affiliate: 1.4, app_store_ads: 1.15 };
const CPC_USD = { paid_search: 3.2, paid_social: 1.4, influencer_affiliate: 0.9, app_store_ads: 1.8 };
const CTR = { paid_search: 0.04, paid_social: 0.009, influencer_affiliate: 0.015, app_store_ads: 0.03 };
const FUNNEL_WINDOW_DAYS = 7;       // onboarding completion window (KPI definition)
const ONBOARD_COHORT_END = "2026-09-24T00:00:00Z"; // exclusive: signups with a full 7 days of data

// H7 market drawdown: new customers panic-sell
const BASE_SELL_SHARE = 0.45;       // engine side weights: buy 55 / sell 45
const CRASH_FLIP_NEW = 0.5;         // share of new customers' buys that become sells on crash days
const CRASH_FLIP_EST = 0.1;         // established customers

// H8 staking commission change
const COMMISSION_OLD = 0.15;
const COMMISSION_NEW = 0.25;
const STAKE_KEEP_AFTER = 0.75;      // share of would-be new stakes that still happen after the change
const UNSTAKE_SURGE_MULT = 1.8;     // unstake requests in the 21 days after the change
const UNSTAKE_SURGE_DAYS = 21;
const GROSS_APY = { ETH: 3.6, SOL: 7.2, ADA: 3.4, AVAX: 8.1 };

// H9 Android 5.12 Simple Buy bug
const ANDROID_FAIL = 0.5;           // share of would-be Android Simple Buy completions that fail

// H10 ONDO listing on Advanced Trade
const ONDO_ADOPTER_SHARE = 0.4;     // share of Advanced Trade users who trade ONDO (salted)
const ONDO_TRADE_SHARE = 0.2;       // mean share of an adopter's trades in ONDO (per adopter: uniform ±0.1)
const ONDO_RATE_SPREAD = 0.1;
const ONDO_RAMP_DAYS = 10;          // each adopter starts on a salted day in the 10 days after listing
const ONDO_EXPECTED_SHARE = Math.round(ONDO_ADOPTER_SHARE * ONDO_TRADE_SHARE * 1000) / 1000; // 0.08 of trades after the ramp

// ── MARKET MODEL (seeded, shared by events and market_prices_daily) ──
const ASSETS = {
	BTC: { p0: 96500, beta: 1.0 }, ETH: { p0: 3420, beta: 1.25 }, SOL: { p0: 168, beta: 1.6 },
	XRP: { p0: 2.35, beta: 1.4 }, DOGE: { p0: 0.205, beta: 1.8 }, ADA: { p0: 0.71, beta: 1.5 },
	AVAX: { p0: 30.4, beta: 1.7 }, LINK: { p0: 17.9, beta: 1.5 }, ONDO: { p0: 1.12, beta: 2.0 },
};
// market-moving days (BTC realized volatility, %) and their market return
const VOL_SHOCKS = {
	"2026-06-18": 4.7, "2026-07-13": 6.1, "2026-07-14": 4.8, "2026-08-10": 5.6, "2026-08-11": 4.9,
	"2026-08-12": 4.5, "2026-09-09": 8.3, "2026-09-10": 6.6, "2026-09-11": 4.7, "2026-09-24": 5.0,
};
const RETURN_SHOCKS = {
	"2026-06-18": -0.046, "2026-07-13": 0.068, "2026-07-14": 0.031, "2026-08-10": 0.055, "2026-08-11": -0.028,
	"2026-08-12": 0.024, "2026-09-09": -0.112, "2026-09-10": -0.041, "2026-09-11": 0.022, "2026-09-24": 0.049,
};
const round2 = (n) => Math.round(n * 100) / 100;
const round1 = (n) => Math.round(n * 10) / 10;
const roundTo = (n, d) => { const f = 10 ** d; return Math.round(n * f) / f; };
const salt = (uid, tag) => hashFloat(`${uid}|${tag}`);
const jitter = (key, spread) => 1 + (hashFloat(key) - 0.5) * 2 * spread;
const normalOf = (key) => {
	const a = Math.max(1e-9, hashFloat(`${key}|u1`));
	const b = hashFloat(`${key}|u2`);
	return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
};
const BTC_VOL = Array.from({ length: NUM_DAYS }, (_, i) => {
	let s = 0;
	for (let j = i - 1; j <= i + 1; j++) s += hashFloat(`vol|${j}`);
	const base = 1.3 + 2.3 * (s / 3) + 0.5 * (hashFloat(`voln|${i}`) - 0.5);
	const shock = VOL_SHOCKS[dayKey(D0_MS + i * DAY_MS)];
	return round2(Math.max(base, shock ?? 0));
});
const MKT_RET = BTC_VOL.map((v, i) => RETURN_SHOCKS[dayKey(D0_MS + i * DAY_MS)] ?? (0.0007 + (v / 100) * 0.8 * normalOf(`mret|${i}`)));
const MARKET = Object.fromEntries(Object.entries(ASSETS).map(([a, { p0, beta }]) => {
	let open = p0;
	const rows = BTC_VOL.map((v, i) => {
		const shocked = RETURN_SHOCKS[dayKey(D0_MS + i * DAY_MS)] !== undefined;
		const idio = (v / 100) * (a === "BTC" ? 0.15 : shocked ? 0.25 : 0.6) * normalOf(`idio|${a}|${i}`);
		const ret = Math.max(-0.4, beta * MKT_RET[i] + idio);
		const close = open * (1 + ret);
		const vol = a === "BTC" ? v : round2(v * beta * jitter(`avol|${a}|${i}`, 0.08));
		const high = Math.max(open, close) * (1 + (vol / 100) * 0.45 * hashFloat(`hi|${a}|${i}`));
		const low = Math.min(open, close) * (1 - (vol / 100) * 0.45 * hashFloat(`lo|${a}|${i}`));
		const row = { open, close, high, low, ret, vol };
		open = close;
		return row;
	});
	return [a, rows];
}));
const priceDigits = (p) => (p >= 1000 ? 2 : p >= 1 ? 4 : 6);
// intraday price: open → close through the UTC day, plus seeded noise
const priceAt = (asset, t) => {
	const i = Math.min(NUM_DAYS - 1, Math.max(0, dayIdx(t)));
	const m = MARKET[asset]?.[i];
	if (!m) return 0;
	const frac = (t - (D0_MS + i * DAY_MS)) / DAY_MS;
	const p = (m.open + (m.close - m.open) * frac) * (1 + 0.004 * chance.normal());
	return roundTo(Math.min(m.high, Math.max(m.low, p)), priceDigits(p));
};
const volOn = (t) => BTC_VOL[Math.min(NUM_DAYS - 1, Math.max(0, dayIdx(t)))];

// ── NETWORKS (withdrawals; shared by events and chain_network_daily) ──
const NETWORKS = {
	bitcoin: { fee: 2.1, conf: 24 }, ethereum: { fee: 1.6, conf: 3.5 }, solana: { fee: 0.004, conf: 0.3 },
	base: { fee: 0.03, conf: 0.25 }, tron: { fee: 1.1, conf: 1.2 },
};
const WITHDRAW_NETWORKS = {
	BTC: { bitcoin: 1 }, ETH: { ethereum: 70, base: 30 }, SOL: { solana: 1 },
	USDC: { ethereum: 35, solana: 35, base: 30 }, USDT: { tron: 60, ethereum: 40 },
};
const inCongestion = (t, net) => net === CONGESTION_NETWORK && t >= ms(ETH_CONGESTION_START) && t < ms(ETH_CONGESTION_END);
const networkFee = (date, net) => {
	const t = ms(`${date}T12:00:00Z`);
	return roundTo(NETWORKS[net].fee * (inCongestion(t, net) ? CONGESTION_FEE_MULT : 1) * jitter(`fee|${date}|${net}`, 0.2), 4);
};
const networkConfMins = (date, net) => {
	const t = ms(`${date}T12:00:00Z`);
	return NETWORKS[net].conf * (inCongestion(t, net) ? CONGESTION_CONF_MULT : 1) * jitter(`conf|${date}|${net}`, 0.15);
};
// institutional API withdrawals that never send a product event
const API_WITHDRAWALS_PER_DAY = { bitcoin: 9, ethereum: 12, solana: 6, base: 4, tron: 5 };

// H6: paid media spend for one channel-day (paced budget, never zero)
const paidSpend = (date, ch) => round2(DAILY_BUDGET_USD[ch] * SPEND_WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()] * jitter(`spend|${date}|${ch}`, SPEND_NOISE));

// ── HELPERS ──
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
const expand = (weights) => Object.entries(weights).flatMap(([k, w]) => Array(w).fill(k));
const logNormal = (median, sigma) => median * Math.exp(chance.normal({ mean: 0, dev: sigma }));
const commissionAt = (t) => (t >= ms(STAKING_COMMISSION_CHANGE) ? COMMISSION_NEW : COMMISSION_OLD);

const TRADE_ASSETS = { BTC: 30, ETH: 22, SOL: 14, XRP: 8, DOGE: 8, ADA: 5, AVAX: 5, LINK: 8 };
const QUICK_BUY_ASSETS = { BTC: 45, ETH: 28, SOL: 12, DOGE: 8, XRP: 7 };
const STAKE_ASSETS = { ETH: 50, SOL: 30, ADA: 12, AVAX: 8 };
const WITHDRAW_ASSETS = { BTC: 30, ETH: 25, USDC: 25, SOL: 12, USDT: 8 };
const NOTIONAL_MEDIAN = { casual_investor: 90, active_trader: 650, crypto_native: 380 };
const MONEY_EVENTS = new Set(["quick buy started", "quick buy completed", "trade executed", "stake started",
	"unstake requested", "withdrawal submitted", "withdrawal confirmed", "recurring buy created",
	"recurring buy executed", "deposit completed"]);
const SESSION_GAP_MIN = 30;
const DEVICE_KEYS = ["device_id", "model", "screen_height", "screen_width", "os", "carrier", "radio", "session_id"];
const ENTRY_POINTS = { direct: 83, widget: 11, email_link: 6 };
const PUSH_OPEN_RATE = 0.14;        // mean share of price alerts that bring the customer into the app (per-customer 0-28%)
// sent by Ledgerline's servers, not by the user: they keep firing after a user goes quiet
const SERVER_EVENTS = new Set(["price alert triggered", "recurring buy executed", "withdrawal confirmed"]);

function handleUserHook(profile, meta) {
	const uid = profile.distinct_id;
	if (meta.userIsBornInDataset) {
		// the engine pins each new user's "account created" to `created` (UTC)
		profile.customer_since = dayKey(ms(profile.created ?? meta.user.created));
		profile.kyc_status = "not_started";
		return profile;
	}
	// established customers joined between 2020-01 and the window start
	const span = dayIdx(D0_MS) - dayIdx(ms("2020-01-01T00:00:00Z"));
	const tenure = Math.floor(Math.pow(salt(uid, "tenure"), 0.7) * span);
	profile.customer_since = dayjs.utc("2020-01-01T00:00:00Z").add(tenure, "day").format("YYYY-MM-DD");
	profile.kyc_status = "verified";
	return profile;
}

function handleEverything(events, meta) {
	if (!events.length) return events;
	const profile = meta.profile;
	const uid = profile.distinct_id;
	const born = meta.userIsBornInDataset;
	const byTime = (a, b) => T(a) - T(b);
	events.sort(byTime);

	// ── onboarding milestones (new users) ──
	const signup = events.find((e) => e.event === "account created");
	const t0 = signup ? T(signup) : null;
	const started = events.find((e) => e.event === "identity verification started");
	const verified = events.find((e) => e.event === "identity verified" && (!started || T(e) >= T(started)));
	const firstDeposit = verified ? events.find((e) => e.event === "deposit completed" && T(e) >= T(verified)) : null;
	const tf = firstDeposit ? T(firstDeposit) : null;
	const funded = !born || Boolean(firstDeposit);
	// Sign in with Apple is offered on the iOS apps only
	if (signup && signup.os === "Android" && signup.signup_method === "apple") signup.signup_method = "google";
	if (born) {
		profile.kyc_status = verified ? "verified" : started ? "pending" : "not_started";
		// money moves only after the account is verified and funded
		events = events.filter((e) => !MONEY_EVENTS.has(e.event) || (funded && (e === firstDeposit || T(e) > tf)));
	}

	const investor = profile.investor_type || "casual_investor";

	// ── enrichment: amounts, prices, fees, networks (coherent with the market model) ──
	const quickBuys = new Map();
	const withdrawals = new Map();
	for (const e of events) {
		if (e.event === "deposit completed") {
			const med = e === firstDeposit ? 120 : investor === "casual_investor" ? 180 : 600;
			e.amount_usd = Math.max(10, Math.round(logNormal(med, 0.9)));
		} else if (e.event === "trade executed") {
			e.notional_usd = round2(Math.max(5, logNormal(NOTIONAL_MEDIAN[investor] ?? 200, 1.0)));
		} else if (e.event === "stake started" || e.event === "unstake requested") {
			e.amount_usd = Math.max(20, Math.round(logNormal(investor === "casual_investor" ? 250 : 900, 0.9)));
		} else if (e.event === "quick buy started" || e.event === "quick buy completed") {
			if (!quickBuys.has(e.order_id)) quickBuys.set(e.order_id, {});
			quickBuys.get(e.order_id)[e.event] = e;
		} else if (e.event === "withdrawal submitted" || e.event === "withdrawal confirmed") {
			if (!withdrawals.has(e.withdrawal_id)) withdrawals.set(e.withdrawal_id, {});
			withdrawals.get(e.withdrawal_id)[e.event] = e;
		}
	}
	const drop = new Set();
	for (const q of quickBuys.values()) {
		const s = q["quick buy started"], c = q["quick buy completed"];
		if (!s) { if (c) drop.add(c); continue; }
		if (!c) continue;
		c.asset = s.asset;
		c.amount_usd = Math.max(10, Math.round(logNormal(investor === "casual_investor" ? 60 : 150, 0.8)));
		c.fee_usd = round2(Math.max(0.99, c.amount_usd * 0.0149));
		c.price_usd = priceAt(c.asset, T(c));
		// H9: Android 5.12 breaks the Simple Buy confirmation for a share of orders
		if (s.os === "Android" && T(s) >= ms(ANDROID_RELEASE) && T(s) < ms(ANDROID_HOTFIX) && chance.bool({ likelihood: ANDROID_FAIL * 100 })) {
			drop.add(c);
		}
	}
	for (const [wid, w] of withdrawals) {
		const s = w["withdrawal submitted"], c = w["withdrawal confirmed"];
		if (!s) { if (c) drop.add(c); continue; }
		const net = pickWeighted(WITHDRAW_NETWORKS[s.asset] || { ethereum: 1 }, hashFloat(`net|${wid}`));
		const date = dayKey(T(s));
		s.network = net;
		s.amount_usd = Math.max(20, Math.round(logNormal(investor === "casual_investor" ? 220 : 900, 1.0)));
		s.network_fee_usd = roundTo(networkFee(date, net) * Math.exp(0.25 * chance.normal()), 4);
		if (!c) continue;
		// H2: during the congestion window a share of ethereum withdrawals never confirm
		if (inCongestion(T(s), net) && chance.bool({ likelihood: CONGESTION_FAIL * 100 })) {
			drop.add(c);
			continue;
		}
		const confMins = Math.max(0.05, networkConfMins(date, net) * Math.exp(0.5 * chance.normal()));
		c.asset = s.asset;
		c.network = net;
		c.confirmation_mins = round1(Math.max(0.1, confMins));
		c.time = iso(T(s) + confMins * MIN_MS);
		if (T(c) > END_MS) drop.add(c);
	}
	if (drop.size) events = events.filter((e) => !drop.has(e));

	// ── H10: ONDO listing — adopters move part of their Advanced Trade activity into ONDO ──
	const ondoAdopter = salt(uid, "ondo") < ONDO_ADOPTER_SHARE;
	const ondoStart = ms(ONDO_LISTING) + salt(uid, "ondo-start") * ONDO_RAMP_DAYS * DAY_MS;
	const ondoRate = ONDO_TRADE_SHARE + (salt(uid, "ondo-rate") - 0.5) * 2 * ONDO_RATE_SPREAD;
	const crashFlip = born ? CRASH_FLIP_NEW : CRASH_FLIP_EST;
	const trades = events.filter((e) => e.event === "trade executed");
	for (const e of trades) {
		const t = T(e);
		if (ondoAdopter && t >= ondoStart && chance.bool({ likelihood: ondoRate * 100 })) {
			// the chart view that led to the trade switches with it
			const view = events.find((v) => v.event === "asset viewed" && v.asset === e.asset && T(v) <= t && T(v) > t - HOUR_MS);
			if (view) view.asset = "ONDO";
			e.asset = "ONDO";
		}
	}
	// ── H1: volatility drives trading — extra fills on volatile days ──
	const tradeClones = [];
	for (const e of trades) {
		const t = T(e);
		const extra = tradeMult(volOn(t)) - 1;
		let n = Math.floor(extra) + (chance.bool({ likelihood: (extra - Math.floor(extra)) * 100 }) ? 1 : 0);
		const dayStart = D0_MS + dayIdx(t) * DAY_MS;
		while (n-- > 0) {
			const off = chance.integer({ min: 2, max: 150 }) * MIN_MS;
			let tc = t + off;
			if (tc >= dayStart + DAY_MS || tc > END_MS) tc = t - off;
			if (tc < dayStart) continue;
			// an extra fill is its own order: side and size are drawn fresh
			tradeClones.push(cloneEvent(e, {
				time: iso(tc),
				side: chance.bool({ likelihood: (1 - BASE_SELL_SHARE) * 100 }) ? "buy" : "sell",
				notional_usd: round2(Math.max(5, logNormal(NOTIONAL_MEDIAN[investor] ?? 200, 1.0))),
			}));
		}
	}
	if (tradeClones.length) events = events.concat(tradeClones);
	for (const e of events) {
		if (e.event !== "trade executed") continue;
		// ── H7: market drawdown — new customers sell much more of what they trade ──
		if (T(e) >= ms(CRASH_START) && T(e) < ms(CRASH_END) && e.side === "buy" && chance.bool({ likelihood: crashFlip * 100 })) {
			e.side = "sell";
		}
		e.price_usd = priceAt(e.asset, T(e));
		e.fee_usd = round2(e.notional_usd * (e.order_type === "limit" ? 0.0025 : 0.004));
	}

	// ── H8: staking commission change ──
	const changeMs = ms(STAKING_COMMISSION_CHANGE);
	const surgeEnd = changeMs + UNSTAKE_SURGE_DAYS * DAY_MS;
	const firstStake = events.find((e) => e.event === "stake started");
	const unstakeClones = [];
	events = events.filter((e) => {
		if (e.event === "stake started") {
			e.apy_pct = round2(GROSS_APY[e.asset] * (1 - commissionAt(T(e))) * jitter(`apy|${dayKey(T(e))}|${e.asset}`, 0.03));
			if (T(e) >= changeMs && !chance.bool({ likelihood: STAKE_KEEP_AFTER * 100 })) return false;
			return true;
		}
		if (e.event === "unstake requested") {
			// new customers can only unstake what they staked in the window
			if (born && (!firstStake || T(firstStake) > T(e))) return false;
			const t = T(e);
			if (t >= changeMs && t < surgeEnd && chance.bool({ likelihood: (UNSTAKE_SURGE_MULT - 1) * 100 })) {
				const off = chance.integer({ min: 5, max: 360 }) * MIN_MS;
				const tc = t + off < surgeEnd && t + off <= END_MS ? t + off : t - off;
				if (tc >= changeMs) unstakeClones.push(cloneEvent(e, { time: iso(tc), amount_usd: Math.max(20, Math.round(logNormal(investor === "casual_investor" ? 250 : 900, 0.9))) }));
			}
			return true;
		}
		return true;
	});
	if (unstakeClones.length) events = events.concat(unstakeClones);

	// ── recurring buys (H4): who has a plan, and when it was created ──
	const created = events.filter((e) => e.event === "recurring buy created").sort(byTime);
	const execTpl = events.find((e) => e.event === "recurring buy executed");
	events = events.filter((e) => e.event !== "recurring buy created" && e.event !== "recurring buy executed");
	const plans = []; // { tpl, first, frequency, fields? }
	const planFields = (tag) => ({
		plan_id: `rb_${Math.floor(hashFloat(`${uid}|plan|${tag}`) * 1e12).toString(36)}`,
		asset: pickWeighted(PLAN_ASSETS, salt(uid, `plan-asset|${tag}`)),
		frequency: pickWeighted(PLAN_FREQ, salt(uid, `plan-freq|${tag}`)),
		amount_usd: Math.max(10, Math.round(25 * Math.exp(1.0 * normalOf(`${uid}|plan-amt|${tag}`)) / 5) * 5),
	});
	let planner = false;
	if (born && funded && signup) {
		if (salt(uid, "planner") < PLANNER_SHARE) {
			// the plan is set up inside one of the user's sessions in their first days
			// (right after the first deposit when there is no other session)
			const cands = events.filter((e) => !SERVER_EVENTS.has(e.event) && T(e) > tf && T(e) < t0 + PLAN_EARLY_DAYS * DAY_MS);
			const anchor = cands.length ? cands[Math.floor(salt(uid, "plan-session") * cands.length)] : firstDeposit;
			const tc = T(anchor) + chance.integer({ min: 1, max: 12 }) * MIN_MS;
			if (tc < t0 + HABIT_WINDOW_DAYS * DAY_MS && tc <= END_MS) {
				// cloned from the first deposit (every funded user has one); device fields
				// come from the session it happens in
				const dev = {};
				for (const k of DEVICE_KEYS) if (anchor[k] !== undefined) dev[k] = anchor[k];
				const c = cloneEvent(firstDeposit, { event: "recurring buy created", ...dev, ...planFields(0), time: iso(tc) });
				delete c.deposit_method;
				plans.push({ tpl: c, first: tc + 5 * MIN_MS, frequency: c.frequency, start: tc });
				events.push(c);
				planner = true;
			}
		}
		if (!planner) {
			const lateAll = created.filter((c) => T(c) >= t0 + HABIT_WINDOW_DAYS * DAY_MS);
			const late = lateAll.length && salt(uid, "late-plan") < LATE_PLAN_KEEP ? lateAll[Math.floor(salt(uid, "late-pick") * lateAll.length)] : null;
			if (late) {
				Object.assign(late, planFields(1));
				plans.push({ tpl: late, first: T(late) + 5 * MIN_MS, frequency: late.frequency, start: T(late) });
				events.push(late);
			}
		}
	} else if (!born) {
		const tpl = execTpl || created[0];
		if (tpl && salt(uid, "est-planner") < EST_PLANNER_SHARE) {
			const f = planFields("pre");
			const period = PLAN_PERIOD_DAYS[f.frequency] * DAY_MS;
			plans.push({ tpl, fields: f, first: D0_MS + salt(uid, "pre-phase") * period, frequency: f.frequency, start: D0_MS });
		}
		const fresh = created.length && salt(uid, "est-new-plan") < EST_NEW_PLAN_KEEP ? created[Math.floor(salt(uid, "est-pick") * created.length)] : null;
		if (fresh) {
			Object.assign(fresh, planFields(2));
			plans.push({ tpl: fresh, first: T(fresh) + 5 * MIN_MS, frequency: fresh.frequency, start: T(fresh) });
			events.push(fresh);
		}
	}

	// ── H4: lifecycle cuts for new users (user-initiated events only) ──
	let cut = Infinity;
	if (born && signup) {
		const cuts = [];
		if (!funded) {
			if (salt(uid, "abandon") < ABANDON_SHARE) cuts.push(t0 + (1 + salt(uid, "abandon-day") * 5) * DAY_MS);
		} else if (!planner && salt(uid, "dark") < DARK_SHARE) {
			cuts.push(t0 + DARK_AFTER_DAYS * DAY_MS);
		}
		if (salt(uid, "lapse") < LAPSE_SHARE) cuts.push(t0 + (LAPSE_DAY_MIN + salt(uid, "lapse-day") * (LAPSE_DAY_MAX - LAPSE_DAY_MIN)) * DAY_MS);
		if (cuts.length) {
			cut = Math.min(...cuts);
			events = events.filter((e) => T(e) < cut || SERVER_EVENTS.has(e.event));
			// a withdrawal confirmation needs its submission
			const subs = new Set(events.filter((e) => e.event === "withdrawal submitted").map((e) => e.withdrawal_id));
			events = events.filter((e) => e.event !== "withdrawal confirmed" || subs.has(e.withdrawal_id));
			for (let i = plans.length - 1; i >= 0; i--) if (plans[i].tpl.event === "recurring buy created" && !events.includes(plans[i].tpl)) plans.splice(i, 1);
		}
	}

	// ── recurring buy executions: scheduled server-side purchases ──
	// Each plan runs until the customer cancels it (seeded lifetime, mean
	// PLAN_LIFE_DAYS). A customer who has gone quiet never comes back to cancel,
	// so their plan keeps buying through the end of the window.
	for (const [i, p] of plans.entries()) {
		const period = PLAN_PERIOD_DAYS[p.frequency] * DAY_MS;
		const f = p.fields || { plan_id: p.tpl.plan_id, asset: p.tpl.asset, frequency: p.tpl.frequency, amount_usd: p.tpl.amount_usd };
		let end = p.start + -Math.log(1 - salt(uid, `plan-life|${i}`)) * PLAN_LIFE_DAYS * DAY_MS;
		if (end >= cut) end = Infinity;
		for (let t = p.first; t <= Math.min(END_MS, end); t += period) {
			if (t < D0_MS) continue;
			const tx = t + chance.integer({ min: 0, max: 20 }) * MIN_MS;
			if (tx > END_MS || tx > end) break;
			const ex = cloneEvent(p.tpl, {
				event: "recurring buy executed", time: iso(tx), ...f,
				price_usd: priceAt(f.asset, tx), fee_usd: round2(Math.max(0.49, f.amount_usd * 0.0099)),
			});
			events.push(ex);
		}
		if (end <= END_MS && end > p.first) {
			// cancelled in one of the customer's sessions (the plan's own template is the clone source)
			const c = cloneEvent(p.tpl, { event: "recurring buy cancelled", time: iso(end), ...f });
			for (const k of Object.keys(c)) if (PLAN_EXTRA_KEYS.includes(k)) delete c[k];
			events.push(c);
		}
	}

	// low-frequency actions: most sessions do not share a referral link or set a new alert
	events = events.filter((e) => {
		if (e.event === "referral link shared") return chance.bool({ likelihood: 25 });
		if (e.event === "price alert created") return chance.bool({ likelihood: 45 });
		return true;
	});
	// ── price alerts: notifications only reach users who have an alert set ──
	const firstAlert = events.find((e) => e.event === "price alert created");
	const preAlerts = !born && salt(uid, "pre-alerts") < 0.45;
	events = events.filter((e) => {
		if (e.event !== "price alert triggered") return true;
		const t = T(e);
		if (!preAlerts && (!firstAlert || T(firstAlert) > t)) return false;
		// alerts fire more often when markets move
		return chance.bool({ likelihood: Math.min(100, 30 * volOn(t) / VOL_PIVOT) });
	});
	for (const e of events) {
		if (e.event === "price alert triggered") e.move_pct = round1((e.direction === "below" ? -1 : 1) * (3 + Math.abs(chance.normal()) * volOn(T(e))));
	}

	// ── push opens: a share of alerts bring the customer into the app to look at the coin ──
	// (per-customer propensity, mean PUSH_OPEN_RATE; never after a new user has gone quiet)
	const viewTpl = events.find((e) => e.event === "asset viewed");
	if (viewTpl) {
		const propensity = PUSH_OPEN_RATE * 2 * salt(uid, "push-open");
		const pushViews = [];
		for (const a of events) {
			if (a.event !== "price alert triggered" || T(a) >= cut) continue;
			if (hashFloat(`${a.insert_id}|push-open`) >= propensity) continue;
			const tv = T(a) + (1 + Math.floor(hashFloat(`${a.insert_id}|push-lag`) * 15)) * MIN_MS;
			if (tv > END_MS) continue;
			pushViews.push(cloneEvent(viewTpl, { time: iso(tv), asset: a.asset, chart_range: "1D" }));
		}
		if (pushViews.length) events = events.concat(pushViews);
	}

	// ── sessions: the app sends "app opened" when a session starts ──
	// Each open is cloned from the session's first event (same device, session, and
	// location) and keeps only those fields. The signup session has none: the
	// first open is anonymous, before the account exists. A session that starts
	// within 30 minutes after a price alert came from the push notification.
	events = events.filter((e) => e.event !== "app opened");
	events.sort(byTime);
	const alerts = events.filter((e) => e.event === "price alert triggered").map(T);
	const opens = [];
	let last = -Infinity;
	for (const e of events) {
		if (SERVER_EVENTS.has(e.event)) continue;
		const t = T(e);
		if (t - last > SESSION_GAP_MIN * MIN_MS && e.event !== "account created") {
			const to = Math.max(D0_MS, t - (2 + Math.floor(hashFloat(`${e.insert_id}|open-lead`) * 44)) * 1000);
			const fromPush = alerts.some((a) => a <= to && a > to - 30 * MIN_MS);
			const open = cloneEvent(e, { event: "app opened", time: iso(to), entry_point: fromPush ? "push_notification" : pickWeighted(ENTRY_POINTS, hashFloat(`${e.insert_id}|entry`)) });
			for (const k of Object.keys(open)) if (!OPEN_KEEP_KEYS.has(k)) delete open[k];
			// server-side onboarding steps carry no device: the app open is on the signup device
			if (!e.device_id && signup) for (const k of DEVICE_KEYS) if (signup[k] !== undefined) open[k] = signup[k];
			opens.push(open);
		}
		last = t;
	}
	events = events.concat(opens);

	// the SDK sends the experiment exposure once per user (first Simple Buy after the start)
	let exposed = false;
	events = events.filter((e) => {
		if (e.event !== "$experiment_started") return true;
		if (exposed) return false;
		exposed = true;
		return true;
	});
	// experiment assignment lives on the profile only for users with an exposure left
	if (profile[EXP_KEY] !== undefined && !events.some((e) => e.event === "$experiment_started")) delete profile[EXP_KEY];
	return events;
}

// warehouse rows: exogenous business facts layered on the event-derived volumes
function handleWarehouse(row, meta) {
	if (meta.isBackfill) return row;
	if (meta.metricName === "market_prices_daily") {
		const m = MARKET[row.asset]?.[dayIdx(ms(`${row.date}T00:00:00Z`))];
		if (m) row.close_usd = roundTo(m.close, priceDigits(m.close));
		return row;
	}
	if (meta.metricName === "chain_network_daily") {
		// institutional API withdrawals never send a product event
		const k = `${row.date}|${row.network}`;
		row.withdrawals_broadcast = Math.round(row.withdrawals_broadcast + API_WITHDRAWALS_PER_DAY[row.network] * jitter(`api|${k}`, 0.6));
		return row;
	}
	if (meta.metricName === "paid_marketing_daily") {
		row.spend_usd = paidSpend(row.date, row.acquisition_channel);
		return row;
	}
	return row;
}

// identity, device, session, and location fields an "app opened" keeps from its source event
const OPEN_KEEP_KEYS = new Set(["event", "time", "insert_id", "user_id", "device_id", "entry_point", "model", "screen_height",
	"screen_width", "os", "carrier", "radio", "session_id", "country", "country_code", "region", "city", "_persona"]);
const mkt = (ctx) => MARKET[ctx.seriesKey]?.[dayIdx(ctx.time)];

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
	// crypto trades every day: a flat week, evening-heavy in UTC
	soup: { dayOfWeekWeights: DOW_WEIGHTS, hourOfDayWeights: HOUR_WEIGHTS },
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
			event: "account created",
			weight: 1,
			isFirstEvent: true,
			isAuthEvent: true,
			properties: {
				signup_method: { __weights: { email: 40, google: 28, apple: 27, phone: 5 } },
				acquisition_channel: (ctx) => ctx.profile.acquisition_channel,
			},
		},
		{
			event: "identity verification started",
			weight: 1,
			isStrictEvent: true,
			properties: {
				id_document_type: { __weights: { drivers_license: 52, passport: 34, national_id: 14 } },
			},
		},
		{ event: "identity verified", weight: 1, isStrictEvent: true, properties: {} },
		{
			event: "deposit completed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				deposit_method: { __weights: { bank_transfer: 55, debit_card: 25, crypto_transfer: 15, wire: 5 } },
				amount_usd: [100],
			},
		},
		{
			event: "quick buy started",
			weight: 1,
			isStrictEvent: true,
			properties: { order_id: ["unassigned"], asset: ["BTC"] },
		},
		{
			event: "quick buy completed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				order_id: ["unassigned"],
				asset: ["BTC"],
				amount_usd: [0],
				fee_usd: [0],
				price_usd: [0],
				payment_source: { __weights: { cash_balance: 60, debit_card: 25, bank_account: 15 } },
			},
		},
		{
			event: "asset viewed",
			weight: 8,
			isStrictEvent: false,
			properties: {
				asset: expand(TRADE_ASSETS),
				chart_range: ["1D", "1D", "1W", "1W", "1M", "1Y"],
			},
		},
		{
			event: "trade executed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				asset: ["BTC"],
				quote_currency: ["USD", "USD", "USD", "USDC"],
				side: { __weights: { buy: 55, sell: 45 } },
				order_type: { __weights: { market: 62, limit: 38 } },
				notional_usd: [0],
				price_usd: [0],
				fee_usd: [0],
			},
		},
		{
			event: "portfolio viewed",
			weight: 6,
			isStrictEvent: false,
			properties: { view: ["overview", "overview", "asset_detail", "performance"] },
		},
		{
			event: "stake started",
			weight: 1,
			isStrictEvent: true,
			properties: { asset: ["ETH"], amount_usd: [0], apy_pct: [0] },
		},
		{
			event: "unstake requested",
			weight: 1,
			isStrictEvent: true,
			properties: { asset: ["ETH"], amount_usd: [0] },
		},
		{
			event: "withdrawal submitted",
			weight: 1,
			isStrictEvent: true,
			properties: { withdrawal_id: ["unassigned"], asset: ["BTC"], network: ["bitcoin"], amount_usd: [0], network_fee_usd: [0] },
		},
		{
			event: "withdrawal confirmed",
			weight: 1,
			isStrictEvent: true,
			properties: { withdrawal_id: ["unassigned"], asset: ["BTC"], network: ["bitcoin"], confirmation_mins: [0] },
		},
		{
			event: "price alert created",
			weight: 1,
			properties: {
				asset: expand(TRADE_ASSETS),
				direction: ["above", "below"],
				threshold_pct: [3, 5, 5, 10, 10, 15, 20],
			},
		},
		{
			event: "price alert triggered",
			weight: 4,
			properties: {
				asset: expand(TRADE_ASSETS),
				direction: ["above", "below"],
				move_pct: [0],
			},
		},
		{
			event: "recurring buy created",
			weight: 5,
			properties: { plan_id: ["unassigned"], asset: ["BTC"], frequency: ["weekly"], amount_usd: [0] },
		},
		{
			event: "recurring buy executed",
			weight: 1,
			properties: { plan_id: ["unassigned"], asset: ["BTC"], frequency: ["weekly"], amount_usd: [0], price_usd: [0], fee_usd: [0] },
		},
		{
			event: "recurring buy cancelled",
			weight: 1,
			isStrictEvent: true,
			properties: { plan_id: ["unassigned"], asset: ["BTC"], frequency: ["weekly"], amount_usd: [0] },
		},
		{
			event: "app opened",
			weight: 16,
			properties: {
				entry_point: { __weights: { direct: 72, push_notification: 14, widget: 8, email_link: 6 } },
			},
		},
		{
			event: "news article viewed",
			weight: 2,
			properties: {
				topic: ["markets", "markets", "bitcoin", "ethereum", "regulation", "defi", "learn"],
			},
		},
		{
			event: "referral link shared",
			weight: 1,
			isStrictEvent: false,
			properties: { share_channel: ["sms", "whatsapp", "x", "email", "copy_link"] },
		},
		{
			event: "$experiment_started",
			weight: 1,
			isStrictEvent: true,
			properties: {
				"Experiment name": [ONE_TAP_EXPERIMENT],
				"Variant name": ["Control", ONE_TAP_VARIANT],
			},
		},
	],

	funnels: [
		// H3 + H6: onboarding by signup era (KYC vendor) and acquisition quality
		...[
			{ era: { lt: KYC_VENDOR_SWITCH.slice(0, 10) }, conv: ONBOARD_CONV_OLD, ttc: ONBOARD_TTC_OLD_H },
			{ era: { gte: KYC_VENDOR_SWITCH.slice(0, 10) }, conv: ONBOARD_CONV_NEW, ttc: ONBOARD_TTC_NEW_H },
		].flatMap(({ era, conv, ttc }) => [
			{ channel: { nin: [LOW_QUALITY_CHANNEL] }, c: conv },
			{ channel: LOW_QUALITY_CHANNEL, c: Math.round(conv * LOW_QUALITY_MULT) },
		].map(({ channel, c }) => ({
			name: "Onboarding",
			sequence: ["account created", "identity verification started", "identity verified", "deposit completed"],
			isFirstFunnel: true,
			conditions: { customer_since: era, acquisition_channel: channel },
			conversionRate: c,
			timeToConvert: ttc,
			order: "sequential",
			weight: 1,
		}))),
		{
			name: "Simple Buy",
			sequence: ["quick buy started", "quick buy completed"],
			conversionRate: QUICK_BUY_CONV,
			timeToConvert: QUICK_BUY_TTC_H,
			order: "sequential",
			weight: 4,
			props: {
				order_id: () => `qb_${chance.hash({ length: 12 })}`,
				asset: expand(QUICK_BUY_ASSETS),
			},
			experiment: {
				name: ONE_TAP_EXPERIMENT,
				startDaysBeforeEnd: (END_MS / 1000 - ms(ONE_TAP_START) / 1000) / 86400,
				variants: [
					{ name: "Control" },
					{ name: ONE_TAP_VARIANT, conversionMultiplier: ONE_TAP_CONV_MULT, ttcMultiplier: ONE_TAP_TTC_MULT },
				],
			},
		},
		{
			name: "Advanced Trade",
			sequence: ["asset viewed", "trade executed"],
			conditions: { investor_type: { in: ["active_trader", "crypto_native"] } },
			conversionRate: 70,
			timeToConvert: 0.5,
			order: "sequential",
			weight: 9,
			props: { asset: expand(TRADE_ASSETS) },
		},
		{
			name: "Advanced Trade",
			sequence: ["asset viewed", "trade executed"],
			conditions: { investor_type: "casual_investor" },
			conversionRate: 50,
			timeToConvert: 0.5,
			order: "sequential",
			weight: 1,
			props: { asset: expand(TRADE_ASSETS) },
		},
		{
			name: "Funding",
			sequence: ["portfolio viewed", "deposit completed"],
			conversionRate: 70,
			timeToConvert: 0.5,
			order: "sequential",
			weight: 4,
		},
		{
			name: "Earn",
			sequence: ["asset viewed", "stake started"],
			conversionRate: 35,
			timeToConvert: 1,
			order: "sequential",
			weight: 2,
			props: { asset: expand(STAKE_ASSETS) },
		},
		{
			name: "Unstake",
			sequence: ["portfolio viewed", "unstake requested"],
			conversionRate: 20,
			timeToConvert: 0.5,
			order: "sequential",
			weight: 2,
			props: { asset: expand(STAKE_ASSETS) },
		},
		{
			name: "Withdrawal",
			sequence: ["withdrawal submitted", "withdrawal confirmed"],
			conversionRate: 97,
			timeToConvert: 0.5,
			order: "sequential",
			weight: 2,
			props: {
				withdrawal_id: () => `wd_${chance.hash({ length: 12 })}`,
				asset: expand(WITHDRAW_ASSETS),
			},
		},
	],

	warehouseMetrics: [
		{
			name: "market_prices_daily",
			type: "additive",
			grain: "day",
			source: { event: "trade executed", measure: "count", groupBy: "asset" },
			timeColumn: "date",
			valueColumn: "close_usd",
			columns: {
				open_usd: (ctx) => { const m = mkt(ctx); return m ? roundTo(m.open, priceDigits(m.open)) : 0; },
				high_usd: (ctx) => { const m = mkt(ctx); return m ? roundTo(m.high, priceDigits(m.high)) : 0; },
				low_usd: (ctx) => { const m = mkt(ctx); return m ? roundTo(m.low, priceDigits(m.low)) : 0; },
				daily_return_pct: (ctx) => { const m = mkt(ctx); return m ? round2(m.ret * 100) : 0; },
				realized_vol_pct: (ctx) => { const m = mkt(ctx); return m ? m.vol : 0; },
				global_spot_volume_usd_m: (ctx) => {
					const m = mkt(ctx);
					if (!m) return 0;
					const base = { BTC: 21000, ETH: 11000, SOL: 3600, XRP: 2400, DOGE: 1500, ADA: 700, AVAX: 450, LINK: 600, ONDO: 260 }[ctx.seriesKey] || 300;
					return Math.round(base * tradeMult(BTC_VOL[dayIdx(ctx.time)]) * jitter(`gvol|${dayKey(ctx.time)}|${ctx.seriesKey}`, 0.18));
				},
			},
		},
		{
			name: "chain_network_daily",
			type: "additive",
			grain: "day",
			source: { event: "withdrawal submitted", measure: "count", groupBy: "network" },
			timeColumn: "date",
			valueColumn: "withdrawals_broadcast",
			columns: {
				avg_network_fee_usd: (ctx) => networkFee(dayKey(ctx.time), ctx.seriesKey),
				median_confirmation_mins: (ctx) => round1(networkConfMins(dayKey(ctx.time), ctx.seriesKey)),
				failed_broadcast_rate: (ctx) => {
					const j = hashFloat(`fail|${dayKey(ctx.time)}|${ctx.seriesKey}`);
					return inCongestion(ctx.time + 12 * HOUR_MS, ctx.seriesKey) ? round2(CONGESTION_FAIL + (j - 0.5) * 0.04) : roundTo(0.002 + j * 0.008, 4);
				},
				network_status: (ctx) => (inCongestion(ctx.time + 12 * HOUR_MS, ctx.seriesKey) ? "congested" : "normal"),
			},
		},
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
				platform_reported_signups: (ctx) => Math.round(paidSpend(dayKey(ctx.time), ctx.seriesKey) * PLATFORM_SIGNUP_INFLATION[ctx.seriesKey] / CPL_USD[ctx.seriesKey] * jitter(`lead|${dayKey(ctx.time)}|${ctx.seriesKey}`, 0.25)),
				clicks: (ctx) => Math.round(paidSpend(dayKey(ctx.time), ctx.seriesKey) / (CPC_USD[ctx.seriesKey] * jitter(`cpc|${dayKey(ctx.time)}|${ctx.seriesKey}`, 0.15))),
				impressions: (ctx) => Math.round(ctx.row.clicks / (CTR[ctx.seriesKey] * jitter(`ctr|${dayKey(ctx.time)}|${ctx.seriesKey}`, 0.15))),
			},
		},
	],

	superProps: {},

	userProps: {
		investor_type: ["casual_investor"],
		acquisition_channel: { __weights: CHANNEL_WEIGHTS },
		customer_since: ["2025-01-01"],
		kyc_status: ["verified"],
	},

	personas: [
		{ name: "casual_investor", weight: 52, eventMultiplier: 0.6, properties: { investor_type: "casual_investor" } },
		{ name: "active_trader", weight: 28, eventMultiplier: 1.8, properties: { investor_type: "active_trader" } },
		{ name: "crypto_native", weight: 20, eventMultiplier: 1.2, properties: { investor_type: "crypto_native" } },
	],

	// retention shape (also pins each new user's signup to their creation day)
	retentionCurve: { type: "logarithmic", day1: 0.75, day7: 0.62, day30: 0.52 },

	hook(record, type, meta) {
		if (type === "user") return handleUserHook(record, meta);
		if (type === "everything") return handleEverything(record, meta);
		if (type === "warehouse") return handleWarehouse(record, meta);
		return record;
	},
};

// ── STORIES ──────────────────────────────────────────────────────────────
// Machine-checkable contract for hooks H1-H10. Evaluate with:
//   node dungeons/vertical/crypto/crypto.verify.mjs

const EV = `read_json_auto('{{PREFIX}}-EVENTS*.json*', sample_size=-1, union_by_name=true)`;
const US = `read_json_auto('{{PREFIX}}-USERS*.json*', sample_size=-1, union_by_name=true)`;
const WH = (table) => `read_json_auto('{{PREFIX}}-WAREHOUSE-${table}.json*', sample_size=-1, union_by_name=true)`;

// Identity prelude: a device resolves to the user seen with it on any event that
// carries both ids (emitted stitch evidence). Every event here carries user_id.
const ID_CTE = `dmap AS (SELECT device_id, min(user_id::VARCHAR) AS mapped FROM ${EV}
  WHERE user_id IS NOT NULL AND device_id IS NOT NULL GROUP BY 1),
ev AS (SELECT coalesce(e.user_id::VARCHAR, m.mapped) AS uid, e.time::TIMESTAMP AS t, e.*
  FROM ${EV} e LEFT JOIN dmap m ON e.device_id = m.device_id)`;

const TS = (isoStr) => dayjs.utc(isoStr).format("YYYY-MM-DD HH:mm:ss");
const D = (isoStr) => isoStr.slice(0, 10);
const band = (k) => [Math.round(k * 0.9 * 1000) / 1000, Math.round(k * 1.1 * 1000) / 1000];
const SQL_LIST = (xs) => xs.map((x) => `'${x}'`).join(", ");
const PASSIVE = SQL_LIST([...SERVER_EVENTS]);
const ONBOARDING_STEPS = ["account created", "identity verification started", "identity verified", "deposit completed"];

// H1 expected ratio: mean trade multiplier on high-volatility days over calm days
// (same seeded BTC volatility series the hook and market_prices_daily use)
const H1_HIGH = BTC_VOL.filter((v) => v >= HIGH_VOL_PCT);
const H1_CALM = BTC_VOL.filter((v) => v < CALM_VOL_PCT);
const H1_TARGET = Math.round((H1_HIGH.reduce((a, v) => a + tradeMult(v), 0) / H1_HIGH.length) / (H1_CALM.reduce((a, v) => a + tradeMult(v), 0) / H1_CALM.length) * 1000) / 1000;
const H1_SQL = `WITH ${ID_CTE},
v AS (SELECT date::DATE AS d, realized_vol_pct AS vol FROM ${WH("market_prices_daily")} WHERE asset = 'BTC'),
dly AS (SELECT t::DATE AS d, count(*) FILTER (WHERE event = 'trade executed') AS trades, count(*) FILTER (WHERE event = 'quick buy started') AS buys,
  count(DISTINCT uid) FILTER (WHERE event NOT IN (${PASSIVE})) AS dau FROM ev GROUP BY 1)
SELECT CASE WHEN vol >= ${HIGH_VOL_PCT} THEN 'high' WHEN vol < ${CALM_VOL_PCT} THEN 'calm' ELSE 'mid' END AS grp, count(*) AS day_count,
 min(dau) AS user_count, sum(trades)::DOUBLE / sum(dau) AS trades_per_dau, sum(buys)::DOUBLE / sum(dau) AS buys_per_dau
FROM dly JOIN v USING (d) GROUP BY 1`;

const CONG_BASE_FROM = TS(dayjs.utc(ETH_CONGESTION_START).subtract(7, "day"));
const CONG_BASE_TO = TS(dayjs.utc(ETH_CONGESTION_END).add(7, "day"));
const AND_BASE_FROM = TS(dayjs.utc(ANDROID_RELEASE).subtract(7, "day"));
const AND_BASE_TO = TS(dayjs.utc(ANDROID_HOTFIX).add(7, "day"));
const CRASH_BASE_FROM = TS(dayjs.utc(CRASH_START).subtract(28, "day"));
const STAKE_BASE_FROM = TS(dayjs.utc(STAKING_COMMISSION_CHANGE).subtract(UNSTAKE_SURGE_DAYS, "day"));
const STAKE_POST_TO = TS(dayjs.utc(STAKING_COMMISSION_CHANGE).add(UNSTAKE_SURGE_DAYS, "day"));
const ONDO_RAMPED = TS(dayjs.utc(ONDO_LISTING).add(ONDO_RAMP_DAYS, "day"));
const RETENTION_DAY = 30;
const H7_TARGET = {
	new: Math.round((1 + CRASH_FLIP_NEW * (1 - BASE_SELL_SHARE) / BASE_SELL_SHARE) * 1000) / 1000,
	established: Math.round((1 + CRASH_FLIP_EST * (1 - BASE_SELL_SHARE) / BASE_SELL_SHARE) * 1000) / 1000,
};

// onboarding funnel per new user: steps in order, completed inside the 7-day window
const ONBOARD_SQL = `WITH ${ID_CTE},
s AS (SELECT uid, t AS t0, acquisition_channel AS ch FROM ev WHERE event = 'account created' AND t < TIMESTAMP '${TS(ONBOARD_COHORT_END)}'),
a AS (SELECT s.*, (SELECT min(t) FROM ev WHERE ev.uid = s.uid AND event = '${ONBOARDING_STEPS[1]}' AND t >= s.t0) AS t1 FROM s),
b AS (SELECT a.*, (SELECT min(t) FROM ev WHERE ev.uid = a.uid AND event = '${ONBOARDING_STEPS[2]}' AND t >= a.t1) AS t2 FROM a),
c AS (SELECT b.*, (SELECT min(t) FROM ev WHERE ev.uid = b.uid AND event = '${ONBOARDING_STEPS[3]}' AND t >= b.t2) AS t3 FROM b),
f AS (SELECT *, (t3 IS NOT NULL AND t3 < t0 + INTERVAL ${FUNNEL_WINDOW_DAYS} DAY) AS done FROM c)`;

/** @type {import("../../../types").DungeonStory[]} */
export const stories = [
	{
		id: "H1-volatility-drives-trading",
		hook: "H1",
		archetype: "bespoke",
		narrative: `Advanced Trade activity follows the market. On each UTC day, every trade has extra fills in proportion to BTC realized volatility above ${VOL_PIVOT}% (${VOL_TRADE_SENS} extra trades per trade per volatility point). The volatility series lives only in the warehouse table market_prices_daily (asset = BTC, realized_vol_pct), so the read needs the join: trades per daily active user on high-volatility days (realized_vol_pct >= ${HIGH_VOL_PCT}, ${H1_HIGH.length} days) vs calm days (< ${CALM_VOL_PCT}, ${H1_CALM.length} days) is the mean multiplier ratio ${H1_TARGET}. Daily active users count people with any user-initiated event (server-side notifications, recurring-buy executions, and withdrawal confirmations excluded). Simple Buy per active user is the control: casual buyers do not react to volatility.`,
		mixpanelReport: { type: "Insights", events: ["trade executed", "any user event (uniques)"], measure: "total / daily uniques", chart: "daily line", join: "market_prices_daily.realized_vol_pct (asset = BTC)" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: H1_SQL },
				select: { h: { where: { grp: "high" } }, c: { where: { grp: "calm" } } },
				expect: { metric: "h.trades_per_dau / c.trades_per_dau", op: "between", target: band(H1_TARGET) },
				minCohort: 1000,
			},
			{
				breakdown: { type: "duckdb", sql: H1_SQL },
				select: { h: { where: { grp: "high" } }, c: { where: { grp: "calm" } } },
				// control: Simple Buy volume per active user does not follow volatility
				expect: { metric: "h.buys_per_dau / c.buys_per_dau", op: "between", target: band(1) },
				minCohort: 1000,
			},
		],
	},
	{
		id: "H2-ethereum-congestion-withdrawals",
		hook: "H2",
		archetype: "bespoke",
		narrative: `Ethereum mainnet congestion from ${D(ETH_CONGESTION_START)} to ${D(ETH_CONGESTION_END)} (exclusive): ${CONGESTION_FAIL * 100}% of withdrawals on the ethereum network that would have confirmed never confirm, network fees on those withdrawals run ${CONGESTION_FEE_MULT}x, and the ones that confirm take ${CONGESTION_CONF_MULT}x longer. The congested days and network come from the warehouse table chain_network_daily (network_status = 'congested'); the event-side read is a ratio of ratios (ethereum confirmation rate / other networks, congested days vs the 7 days either side, withdrawal_id held constant), which reads the 1 - ${CONGESTION_FAIL} keep rate and cancels weekday and asset mix.`,
		mixpanelReport: { type: "Funnels", steps: ["withdrawal submitted", "withdrawal confirmed"], counting: "totals", holdPropertyConstant: "withdrawal_id", breakdown: "network", chart: "daily", join: "chain_network_daily.network_status" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
o AS (SELECT DISTINCT date::DATE AS d, network FROM ${WH("chain_network_daily")} WHERE network_status = 'congested'),
od AS (SELECT DISTINCT d FROM o), onet AS (SELECT DISTINCT network FROM o),
c AS (SELECT withdrawal_id, min(t) AS tc FROM ev WHERE event = 'withdrawal confirmed' GROUP BY 1),
w AS (SELECT s.uid, s.t::DATE AS d, (s.network IN (SELECT network FROM onet)) AS hit, (c.tc IS NOT NULL) AS ok
  FROM ev s LEFT JOIN c ON c.withdrawal_id = s.withdrawal_id
  WHERE s.event = 'withdrawal submitted' AND s.t >= TIMESTAMP '${CONG_BASE_FROM}' AND s.t < TIMESTAMP '${CONG_BASE_TO}'),
g AS (SELECT (d IN (SELECT d FROM od)) AS outage, avg(ok::INT) FILTER (WHERE hit) / avg(ok::INT) FILTER (WHERE NOT hit) AS rel, count(DISTINCT uid) AS users FROM w GROUP BY 1)
SELECT 'all' AS grp, (SELECT count(*) FROM od) AS outage_days, min(users) AS user_count,
 max(rel) FILTER (WHERE outage) / max(rel) FILTER (WHERE NOT outage) AS did
FROM g`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.did", op: "between", target: band(1 - CONGESTION_FAIL) },
				minCohort: 500,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT 'all' AS grp,
 count(*) FILTER (WHERE network_status = 'congested') AS congested_rows,
 avg(failed_broadcast_rate) FILTER (WHERE network_status = 'congested') AS congested_fail_rate
FROM ${WH("chain_network_daily")}`,
				},
				select: { a: { where: { grp: "all" } } },
				// warehouse failed-broadcast rate during the congestion = the failure knob
				expect: { metric: "a.congested_fail_rate", op: "between", target: band(CONGESTION_FAIL) },
			},
		],
	},
	{
		id: "H3-kyc-vendor-switch",
		hook: "H3",
		archetype: "temporal-inflection",
		narrative: `Ledgerline moves identity verification to a new vendor on ${D(KYC_VENDOR_SWITCH)}. New users who sign up from that date finish onboarding (account created → identity verification started → identity verified → deposit completed, ${FUNNEL_WINDOW_DAYS}-day window) at ${ONBOARD_CONV_NEW}% instead of ${ONBOARD_CONV_OLD}% (x${(ONBOARD_CONV_NEW / ONBOARD_CONV_OLD).toFixed(3)}), and the median time from signup to first deposit falls to ${ONBOARD_TTC_NEW_H}/${ONBOARD_TTC_OLD_H} = ${(ONBOARD_TTC_NEW_H / ONBOARD_TTC_OLD_H).toFixed(2)}x. Declarative: duplicate first funnels conditioned on the signup date (customer_since). ${LOW_QUALITY_CHANNEL} signups (H6) complete at half the rate in both eras (${Math.round(ONBOARD_CONV_OLD * LOW_QUALITY_MULT)}% → ${Math.round(ONBOARD_CONV_NEW * LOW_QUALITY_MULT)}%, the same ratio) and the channel mix does not change at the switch, so the all-signup ratio reads the knob. Signups through ${dayjs.utc(ONBOARD_COHORT_END).subtract(1, "day").format("YYYY-MM-DD")} so every user has the full window.`,
		mixpanelReport: { type: "Funnels", steps: ONBOARDING_STEPS, window: `${FUNNEL_WINDOW_DAYS} days`, measure: "conversion and median time to convert", breakdown: `account created date before / from ${D(KYC_VENDOR_SWITCH)} (or user property customer_since)` },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `${ONBOARD_SQL}
SELECT CASE WHEN t0 >= TIMESTAMP '${TS(KYC_VENDOR_SWITCH)}' THEN 'post' ELSE 'pre' END AS grp, count(*) AS user_count, avg(done::INT) AS conv
FROM f GROUP BY 1`,
				},
				select: { a: { where: { grp: "post" } }, b: { where: { grp: "pre" } } },
				expect: { metric: "a.conv / b.conv", op: "between", target: band(ONBOARD_CONV_NEW / ONBOARD_CONV_OLD) },
				minCohort: 1000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `${ONBOARD_SQL}
SELECT CASE WHEN t0 >= TIMESTAMP '${TS(KYC_VENDOR_SWITCH)}' THEN 'post' ELSE 'pre' END AS grp, count(*) AS user_count,
 median(date_diff('second', t0, t3)) AS med_ttc_s
FROM f WHERE done GROUP BY 1`,
				},
				select: { a: { where: { grp: "post" } }, b: { where: { grp: "pre" } } },
				expect: { metric: "a.med_ttc_s / b.med_ttc_s", op: "between", target: band(ONBOARD_TTC_NEW_H / ONBOARD_TTC_OLD_H) },
				minCohort: 500,
			},
		],
	},
	{
		id: "H4-recurring-buy-retention",
		hook: "H4",
		archetype: "retention-divergence",
		narrative: `New customers who fund their account and set up a recurring buy in their first ${HABIT_WINDOW_DAYS} days keep coming back; funded new customers without one are at risk: ${DARK_SHARE * 100}% of them go quiet after day ${DARK_AFTER_DAYS}. Who sets up a plan is independent of how active a customer is (${PLANNER_SHARE * 100}% of funded new users, inside one of their sessions in the first ${PLAN_EARLY_DAYS} days). Every new user also faces organic lapse (${LAPSE_SHARE * 100}% stop on a uniform day ${LAPSE_DAY_MIN}-${LAPSE_DAY_MAX}). Recurring-buy executions are server-side and keep running for customers who go quiet, so the return event is "app opened" (a session start), not any event. Day-${RETENTION_DAY} retention = an app open in days ${RETENTION_DAY}-${RETENTION_DAY + 6} after signup, signups at least ${RETENTION_DAY + 7} days before the end. Expected ratio 1/(1 - ${DARK_SHARE}) = ${(1 / (1 - DARK_SHARE)).toFixed(3)}; the realized dark share in a cohort of a few hundred users moves it by several percent, so a knob-derived floor backs the band. Day-7 retention (before any cut) is the parity check.`,
		mixpanelReport: { type: "Retention", birth: "account created", return: "app opened", brackets: `custom: day ${RETENTION_DAY}-${RETENTION_DAY + 6}`, breakdown: `cohort: did "recurring buy created" within ${HABIT_WINDOW_DAYS} days of account created (Funnels account created → recurring buy created, ${HABIT_WINDOW_DAYS}-day window, save converters)`, filter: "cohort: did deposit completed" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
s AS (SELECT uid, t AS t0 FROM ev WHERE event = 'account created' AND t < TIMESTAMP '${TS(DATASET_END)}' - INTERVAL ${RETENTION_DAY + 7} DAY
  AND uid IN (SELECT uid FROM ev WHERE event = 'deposit completed')),
f AS (SELECT s.uid,
  count(*) FILTER (WHERE e.event = 'recurring buy created' AND e.t < s.t0 + INTERVAL ${HABIT_WINDOW_DAYS} DAY) AS plans,
  count(*) FILTER (WHERE e.event = 'app opened' AND e.t >= s.t0 + INTERVAL ${RETENTION_DAY} DAY AND e.t < s.t0 + INTERVAL ${RETENTION_DAY + 7} DAY) AS ret,
  count(*) FILTER (WHERE e.event = 'app opened' AND e.t >= s.t0 + INTERVAL 7 DAY AND e.t < s.t0 + INTERVAL 14 DAY) AS ret7
  FROM s JOIN ev e ON e.uid = s.uid GROUP BY 1)
SELECT CASE WHEN plans > 0 THEN 'planner' ELSE 'no_plan' END AS grp, count(*) AS user_count,
 avg((ret > 0)::INT) AS d30, avg((ret7 > 0)::INT) AS d7
FROM f GROUP BY 1`,
				},
				select: { p: { where: { grp: "planner" } }, n: { where: { grp: "no_plan" } } },
				expect: { metric: "p.d30 / n.d30", op: ">=", target: Math.round(1000 / (1 - DARK_SHARE)) / 1000, floor: Math.round((1 + 0.5 * (1 / (1 - DARK_SHARE) - 1)) * 1000) / 1000 },
				minCohort: 400,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
s AS (SELECT uid, t AS t0 FROM ev WHERE event = 'account created' AND t < TIMESTAMP '${TS(DATASET_END)}' - INTERVAL ${RETENTION_DAY + 7} DAY
  AND uid IN (SELECT uid FROM ev WHERE event = 'deposit completed')),
f AS (SELECT s.uid,
  count(*) FILTER (WHERE e.event = 'recurring buy created' AND e.t < s.t0 + INTERVAL ${HABIT_WINDOW_DAYS} DAY) AS plans,
  count(*) FILTER (WHERE e.event = 'app opened' AND e.t >= s.t0 + INTERVAL 7 DAY AND e.t < s.t0 + INTERVAL 14 DAY) AS ret7
  FROM s JOIN ev e ON e.uid = s.uid GROUP BY 1)
SELECT CASE WHEN plans > 0 THEN 'planner' ELSE 'no_plan' END AS grp, count(*) AS user_count, avg((ret7 > 0)::INT) AS d7
FROM f GROUP BY 1`,
				},
				select: { p: { where: { grp: "planner" } }, n: { where: { grp: "no_plan" } } },
				// parity: before day 21 nothing separates the groups (plan setup is salted, not engagement-driven)
				expect: { metric: "p.d7 / n.d7", op: "between", target: band(1) },
				minCohort: 400,
			},
		],
	},
	{
		id: "H5-one-tap-buy-experiment",
		hook: "H5",
		archetype: "experiment-lift",
		narrative: `The "${ONE_TAP_EXPERIMENT}" test on Simple Buy starts ${D(ONE_TAP_START)} and splits users 50/50 (sticky hash). "${ONE_TAP_VARIANT}" multiplies the share of Simple Buy orders that complete by ${ONE_TAP_CONV_MULT} and the start-to-complete time by ${ONE_TAP_TTC_MULT}. Every order's two events share an order_id, so a totals funnel holding order_id constant measures per-order completion. The Android incident (H9) hits both arms alike. Exposure ($experiment_started) is sent once per user, at their first Simple Buy after the start.`,
		mixpanelReport: { type: "Funnels", steps: ["quick buy started", "quick buy completed"], counting: "totals", holdPropertyConstant: "order_id", breakdown: `user property "${EXP_KEY}"`, window: "1 day" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
v AS (SELECT distinct_id::VARCHAR AS uid, "${EXP_KEY}" AS variant FROM ${US} WHERE "${EXP_KEY}" IS NOT NULL),
r AS (SELECT uid, order_id, t AS t0 FROM ev WHERE event = 'quick buy started' AND t >= TIMESTAMP '${TS(ONE_TAP_START)}'),
c AS (SELECT order_id, min(t) AS t1 FROM ev WHERE event = 'quick buy completed' GROUP BY 1),
x AS (SELECT v.variant, r.uid, (c.t1 IS NOT NULL AND c.t1 >= r.t0 AND c.t1 < r.t0 + INTERVAL 1 DAY) AS ok,
  CASE WHEN c.t1 >= r.t0 AND c.t1 < r.t0 + INTERVAL 1 DAY THEN date_diff('millisecond', r.t0, c.t1) END AS ttc_ms
  FROM r JOIN v ON v.uid = r.uid LEFT JOIN c ON c.order_id = r.order_id)
SELECT variant AS grp, count(DISTINCT uid) AS user_count, count(*) AS orders, avg(ok::INT) AS conv, median(ttc_ms) AS med_ttc
FROM x GROUP BY 1`,
				},
				select: { s: { where: { grp: ONE_TAP_VARIANT } }, c: { where: { grp: "Control" } } },
				expect: { metric: "s.conv / c.conv", op: "between", target: band(ONE_TAP_CONV_MULT) },
				minCohort: 1000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
v AS (SELECT distinct_id::VARCHAR AS uid, "${EXP_KEY}" AS variant FROM ${US} WHERE "${EXP_KEY}" IS NOT NULL),
r AS (SELECT uid, order_id, t AS t0 FROM ev WHERE event = 'quick buy started' AND t >= TIMESTAMP '${TS(ONE_TAP_START)}'),
c AS (SELECT order_id, min(t) AS t1 FROM ev WHERE event = 'quick buy completed' GROUP BY 1),
x AS (SELECT v.variant, r.uid, CASE WHEN c.t1 >= r.t0 AND c.t1 < r.t0 + INTERVAL 1 DAY THEN date_diff('millisecond', r.t0, c.t1) END AS ttc_ms
  FROM r JOIN v ON v.uid = r.uid LEFT JOIN c ON c.order_id = r.order_id)
SELECT variant AS grp, count(DISTINCT uid) AS user_count, median(ttc_ms) AS med_ttc FROM x GROUP BY 1`,
				},
				select: { s: { where: { grp: ONE_TAP_VARIANT } }, c: { where: { grp: "Control" } } },
				expect: { metric: "s.med_ttc / c.med_ttc", op: "between", target: band(ONE_TAP_TTC_MULT) },
				minCohort: 1000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 count(DISTINCT uid) FILTER (WHERE "Variant name" = '${ONE_TAP_VARIANT}')::DOUBLE / count(DISTINCT uid) AS variant_share
FROM ev WHERE event = '$experiment_started'`,
				},
				select: { a: { where: { grp: "all" } } },
				// equal-weight 2-arm hash → 0.5
				expect: { metric: "a.variant_share", op: "between", target: band(0.5) },
				minCohort: 2000,
			},
		],
	},
	{
		id: "H6-paid-channel-quality",
		hook: "H6",
		archetype: "attribution-bias",
		narrative: `Influencer and affiliate signups are the cheapest paid signups but the least likely to finish onboarding. Warehouse paid_marketing_daily bills a paced daily budget per channel (cost per signup x expected signups per day, weekday shape, seeded ±${SPEND_NOISE * 100}% day noise, never zero), so spend per Mixpanel signup is $${CPL_USD.influencer_affiliate} for ${LOW_QUALITY_CHANNEL} vs $${CPL_USD.paid_search} for paid_search over the window (${(CPL_USD.influencer_affiliate / CPL_USD.paid_search).toFixed(3)}x). Their 7-day onboarding completion (through first deposit) is ${LOW_QUALITY_MULT}x the other channels' in both KYC eras (declarative first funnels: ${Math.round(ONBOARD_CONV_OLD * LOW_QUALITY_MULT)}% vs ${ONBOARD_CONV_OLD}%, then ${Math.round(ONBOARD_CONV_NEW * LOW_QUALITY_MULT)}% vs ${ONBOARD_CONV_NEW}%), so cost per funded account runs about ${((CPL_USD.influencer_affiliate / CPL_USD.paid_search) / LOW_QUALITY_MULT).toFixed(2)}x paid search: cheapest per signup, most expensive per funded customer.`,
		mixpanelReport: { type: "Insights + Funnels + warehouse", event: "account created", breakdown: "acquisition_channel", join: "paid_marketing_daily.spend_usd", funnel: `${ONBOARDING_STEPS.join(" → ")}, ${FUNNEL_WINDOW_DAYS}-day window, breakdown acquisition_channel` },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
s AS (SELECT acquisition_channel AS ch, count(*) AS signups, count(DISTINCT uid) AS users FROM ev WHERE event = 'account created' GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM ${WH("paid_marketing_daily")} GROUP BY 1)
SELECT s.ch AS grp, s.users AS user_count, sp.spend / s.signups AS spend_per_signup FROM s JOIN sp ON sp.ch = s.ch`,
				},
				select: { i: { where: { grp: LOW_QUALITY_CHANNEL } }, p: { where: { grp: "paid_search" } } },
				expect: { metric: "i.spend_per_signup / p.spend_per_signup", op: "between", target: band(CPL_USD.influencer_affiliate / CPL_USD.paid_search) },
				minCohort: 500,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `${ONBOARD_SQL}
SELECT ch AS grp, count(*) AS user_count, avg(done::INT) AS conv FROM f GROUP BY 1`,
				},
				select: { i: { where: { grp: LOW_QUALITY_CHANNEL } }, p: { where: { grp: "paid_search" } } },
				expect: { metric: "i.conv / p.conv", op: "between", target: band(LOW_QUALITY_MULT) },
				minCohort: 500,
			},
		],
	},
	{
		id: "H7-drawdown-panic-selling",
		hook: "H7",
		archetype: "composition-drift",
		narrative: `During the ${D(CRASH_START)} to ${D(dayjs.utc(CRASH_END).subtract(1, "day").toISOString())} market drawdown (BTC -11% and -4% on the first two days, then a small rebound, in market_prices_daily), new customers (customer_since inside the window) turn ${CRASH_FLIP_NEW * 100}% of the buys they would have placed on Advanced Trade into sells; established customers turn ${CRASH_FLIP_EST * 100}%. Fills have a ${BASE_SELL_SHARE * 100}% sell share in normal times, so the drawdown sell share relative to the same group's sell share in the 28 days before is 1 + f x (1 - ${BASE_SELL_SHARE}) / ${BASE_SELL_SHARE}: ${H7_TARGET.new} for new customers and ${H7_TARGET.established} for established ones.`,
		mixpanelReport: { type: "Insights", event: "trade executed", measure: "total", breakdown: ["side", "user property customer_since (before / from 2026-06-04)"], chart: "daily, % of total" },
		assertions: [
			...["new", "established"].map((grp) => ({
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
u AS (SELECT distinct_id::VARCHAR AS uid, CASE WHEN customer_since >= '${D0}' THEN 'new' ELSE 'established' END AS seg FROM ${US}),
w AS (SELECT u.seg, ev.uid, (ev.t >= TIMESTAMP '${TS(CRASH_START)}') AS crash, (ev.side = 'sell') AS sell
  FROM ev JOIN u ON u.uid = ev.uid WHERE ev.event = 'trade executed' AND ev.t >= TIMESTAMP '${CRASH_BASE_FROM}' AND ev.t < TIMESTAMP '${TS(CRASH_END)}')
SELECT seg AS grp, count(DISTINCT uid) FILTER (WHERE crash) AS user_count,
 avg(sell::INT) FILTER (WHERE crash) AS sell_crash, avg(sell::INT) FILTER (WHERE NOT crash) AS sell_base,
 avg(sell::INT) FILTER (WHERE crash) / avg(sell::INT) FILTER (WHERE NOT crash) AS sell_ratio
FROM w GROUP BY 1`,
				},
				select: { a: { where: { grp } } },
				expect: { metric: "a.sell_ratio", op: "between", target: band(H7_TARGET[grp]) },
				minCohort: grp === "new" ? 100 : 500,
			})),
		],
	},
	{
		id: "H8-staking-commission-change",
		hook: "H8",
		archetype: "temporal-inflection",
		narrative: `On ${D(STAKING_COMMISSION_CHANGE)} Ledgerline raises its staking commission from ${COMMISSION_OLD * 100}% to ${COMMISSION_NEW * 100}% of rewards, so the net APY shown on new stakes falls to ${((1 - COMMISSION_NEW) / (1 - COMMISSION_OLD)).toFixed(3)}x (ETH ${round2(GROSS_APY.ETH * (1 - COMMISSION_OLD))}% → ${round2(GROSS_APY.ETH * (1 - COMMISSION_NEW))}%). New stakes drop to ${STAKE_KEEP_AFTER}x and unstake requests run ${UNSTAKE_SURGE_MULT}x for ${UNSTAKE_SURGE_DAYS} days. Read on established customers (customer_since before ${D0}), whose population is fixed, as totals in the ${UNSTAKE_SURGE_DAYS} days after vs the ${UNSTAKE_SURGE_DAYS} days before (whole weeks both sides).`,
		mixpanelReport: { type: "Insights", events: ["stake started", "unstake requested"], measure: "total", filter: `customer_since before ${D0}`, chart: "weekly line", compare: `${UNSTAKE_SURGE_DAYS} days after vs before ${D(STAKING_COMMISSION_CHANGE)}` },
		assertions: [
			...[["stake started", STAKE_KEEP_AFTER], ["unstake requested", UNSTAKE_SURGE_MULT]].map(([evName, k]) => ({
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
est AS (SELECT distinct_id::VARCHAR AS uid FROM ${US} WHERE customer_since < '${D0}')
SELECT CASE WHEN t >= TIMESTAMP '${TS(STAKING_COMMISSION_CHANGE)}' THEN 'post' ELSE 'pre' END AS grp, count(DISTINCT ev.uid) AS user_count, count(*) AS n
FROM ev JOIN est ON est.uid = ev.uid WHERE event = '${evName}' AND t >= TIMESTAMP '${STAKE_BASE_FROM}' AND t < TIMESTAMP '${STAKE_POST_TO}' GROUP BY 1`,
				},
				select: { a: { where: { grp: "post" } }, b: { where: { grp: "pre" } } },
				expect: { metric: "a.n / b.n", op: "between", target: band(k) },
				minCohort: 400,
			})),
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT CASE WHEN t >= TIMESTAMP '${TS(STAKING_COMMISSION_CHANGE)}' THEN 'post' ELSE 'pre' END AS grp, count(DISTINCT uid) AS user_count, avg(apy_pct) AS apy
FROM ev WHERE event = 'stake started' AND asset = 'ETH' GROUP BY 1`,
				},
				select: { a: { where: { grp: "post" } }, b: { where: { grp: "pre" } } },
				expect: { metric: "a.apy / b.apy", op: "between", target: band((1 - COMMISSION_NEW) / (1 - COMMISSION_OLD)) },
				minCohort: 400,
			},
		],
	},
	{
		id: "H9-android-simple-buy-bug",
		hook: "H9",
		archetype: "funnel-conversion-by-segment",
		narrative: `Android app 5.12 (released ${D(ANDROID_RELEASE)}, hotfixed ${D(ANDROID_HOTFIX)}) breaks the Simple Buy confirmation step: ${ANDROID_FAIL * 100}% of Android Simple Buy orders that would have completed never do. iOS and iPadOS are untouched. Ratio of ratios (Android completion / iOS + iPadOS, incident days vs the 7 days either side, order_id held constant) reads 1 - ${ANDROID_FAIL} and cancels the experiment mix (H5 hits both platforms alike).`,
		mixpanelReport: { type: "Funnels", steps: ["quick buy started", "quick buy completed"], counting: "totals", holdPropertyConstant: "order_id", breakdown: "os", chart: "daily" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
c AS (SELECT order_id, min(t) AS t1 FROM ev WHERE event = 'quick buy completed' GROUP BY 1),
w AS (SELECT s.uid, (s.os = 'Android') AS hit, (s.t >= TIMESTAMP '${TS(ANDROID_RELEASE)}' AND s.t < TIMESTAMP '${TS(ANDROID_HOTFIX)}') AS inc,
  (c.t1 IS NOT NULL AND c.t1 < s.t + INTERVAL 1 DAY) AS ok
  FROM ev s LEFT JOIN c ON c.order_id = s.order_id
  WHERE s.event = 'quick buy started' AND s.t >= TIMESTAMP '${AND_BASE_FROM}' AND s.t < TIMESTAMP '${AND_BASE_TO}'),
g AS (SELECT inc, avg(ok::INT) FILTER (WHERE hit) / avg(ok::INT) FILTER (WHERE NOT hit) AS rel, count(DISTINCT uid) AS users FROM w GROUP BY 1)
SELECT 'all' AS grp, min(users) AS user_count, max(rel) FILTER (WHERE inc) / max(rel) FILTER (WHERE NOT inc) AS did FROM g`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.did", op: "between", target: band(1 - ANDROID_FAIL) },
				minCohort: 1000,
			},
		],
	},
	{
		id: "H10-ondo-listing",
		hook: "H10",
		archetype: "composition-drift",
		narrative: `ONDO is listed on Advanced Trade on ${D(ONDO_LISTING)}. ${ONDO_ADOPTER_SHARE * 100}% of Advanced Trade users take it up, each on a day in the ${ONDO_RAMP_DAYS} days after listing, and move ${(ONDO_TRADE_SHARE - ONDO_RATE_SPREAD) * 100}-${(ONDO_TRADE_SHARE + ONDO_RATE_SPREAD) * 100}% of their trades (mean ${ONDO_TRADE_SHARE * 100}%) into it, so once the ramp is over ONDO holds ${ONDO_ADOPTER_SHARE} x ${ONDO_TRADE_SHARE} = ${ONDO_EXPECTED_SHARE} of trades. There is no ONDO trade before the listing (exact).`,
		mixpanelReport: { type: "Insights", event: "trade executed", measure: "total", breakdown: "asset", chart: "daily, % of total" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count, count(*) FILTER (WHERE asset = 'ONDO' AND t < TIMESTAMP '${TS(ONDO_LISTING)}') AS pre_listing_rows
FROM ev WHERE event IN ('trade executed', 'asset viewed')`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.pre_listing_rows", op: "between", target: [0, 0] },
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'post' AS grp, count(DISTINCT uid) AS user_count, avg((asset = 'ONDO')::INT) AS ondo_share
FROM ev WHERE event = 'trade executed' AND t >= TIMESTAMP '${ONDO_RAMPED}'`,
				},
				select: { a: { where: { grp: "post" } } },
				expect: { metric: "a.ondo_share", op: "between", target: band(ONDO_EXPECTED_SHARE) },
				minCohort: 1000,
			},
		],
	},
];

export default config;
