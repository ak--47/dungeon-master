// ── IMPORTS ──
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);
import "dotenv/config";
import * as u from "@ak--47/dungeon-master/utils";
import { findFirstSequence, scaleFunnelTTC } from "@ak--47/dungeon-master/hook-helpers";
/** @typedef  {import("../../../types").Dungeon} Config */

// ── OVERVIEW ──
/*
 * NAME:       NexBank
 * APP:        Chime/Revolut-style neobank app. Users open accounts (personal or
 *             business), transact across 7 merchant categories, send transfers,
 *             pay bills, set budgets, invest, apply for loans, and earn
 *             tier-scaled rewards. Core loop runs from onboarding through daily
 *             banking, financial planning, investments, and rewards.
 * SCALE:      10,000 users, ~1.4M events, 121 days (2026-01-01 → 2026-05-01)
 * CORE LOOP:  account opened → app session → balance checked → transaction completed
 *
 * EVENTS (19):
 *   app session (20) > transaction completed (18) > balance checked (15)
 *   > notification opened (10) > transfer sent (8) > bill paid (6)
 *   > investment made (4) > reward redeemed (4) > budget alert (4)
 *   > budget created (3) > savings goal set (3) > support contacted (3)
 *   > card locked (2) > dispute filed (2) > loan applied (2) > premium upgraded (2)
 *   > account opened (1) > loan approved (1) > bill payment missed (1)
 *
 * FUNNELS (8):
 *   - Onboarding:          account opened → app session → balance checked (85%)
 *   - Daily Banking:       app session → balance checked → transaction completed (80%)
 *   - Transfers:           app session → transfer sent → notification opened (50%)
 *   - Bill Payment:        app session → bill paid → notification opened (60%)
 *   - Financial Planning:  budget created → budget alert → savings goal set (40%)
 *   - Investment:          balance checked → investment made → reward redeemed (30%)
 *   - Support:             support contacted → card locked → dispute filed (35%)
 *   - Lending:             loan applied → loan approved → premium upgraded (25%)
 *
 * USER PROPS:  account_tier, Platform, credit_score_range, income_bracket, account_age_months, total_balance, has_direct_deposit, account_segment, employee_count, annual_revenue, industry, age_range, life_stage
 * SUPER PROPS: account_tier, Platform
 * SCD PROPS:   risk_category (low/medium/high/critical, household_id-scoped, monthly fixed, max 8)
 *              (account_tier is deliberately NOT an SCD: the everything hook pins
 *              each event's account_tier to the user's profile tier so H7/H9
 *              breakdowns are coherent — a changing tier would contradict that.)
 * GROUPS:      household_id (500 households)
 */

// ── HOOK STORIES ──
/*
 * NOTE: All cohort effects are HIDDEN — no flag stamping. Discoverable
 * via behavioral cohorts, raw-prop breakdowns (date, account_tier),
 * or funnel time-to-convert.
 *
 * ---------------------------------------------------------------
 * Hook 1 — PERSONAL VS BUSINESS ACCOUNTS (user)
 *
 * PATTERN: 20% of accounts are business (employee_count, revenue,
 * industry attached) and 80% are personal (age_range, life_stage).
 * Account segment shapes downstream transaction sizes.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Account Segment Mix
 *   - Report type: Insights
 *   - Event: any event
 *   - Measure: Unique users
 *   - Breakdown: "account_segment"
 *   - Expected: ~80% personal, ~20% business
 *
 *   Report 2: Transaction Size by Segment
 *   - Report type: Insights
 *   - Event: "transaction completed"
 *   - Measure: Average of "amount"
 *   - Breakdown: "account_segment"
 *   - Expected: business avg amount ~ 4x personal avg amount
 *
 * REAL-WORLD ANALOGUE: Neobanks serve both consumers and small
 * businesses with the same core product, but business activity is
 * meaningfully higher value per transaction.
 *
 * ---------------------------------------------------------------
 * Hook 2 — PAYDAY PATTERNS (everything)
 *
 * PATTERN: Direct deposit transactions are 3x larger on the 1st and
 * 15th of the month. Transfers are ~1.6x larger on the 1st-3rd and
 * 15th-17th (60% likelihood × 2x boost). No flag — discover via day-of-month
 * breakdown on raw amount.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Direct Deposit Size by Day of Month
 *   - Report type: Insights
 *   - Event: "transaction completed"
 *   - Measure: Average of "amount"
 *   - Filter: "transaction_type" = "direct_deposit"
 *   - Breakdown: day of month
 *   - Expected: 1st and 15th avg ~ 3x other days
 *
 *   Report 2: Post-Payday Transfer Spending by Day of Month
 *   - Report type: Insights
 *   - Event: "transfer sent"
 *   - Measure: Average of "amount"
 *   - Breakdown: day of month
 *   - Expected: 1-3 and 15-17 avg ~ 1.6x other days
 *
 * REAL-WORLD ANALOGUE: Bi-monthly payroll cycles drive predictable
 * spikes in deposit and outbound spending volume.
 *
 * ---------------------------------------------------------------
 * Hook 3 — FRAUD DETECTION (everything)
 *
 * PATTERN: ~3% of users experience a fraud burst at the timeline
 * midpoint: 3-5 rapid high-value transactions, then card locked
 * (reason="suspicious_activity"), dispute filed (reason="unauthorized"),
 * and support contacted (issue_type="card"). No flag — derive cohort
 * by joining users who had all three event types within ~1 hour.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Fraud Cohort
 *   - Report type: Cohort builder
 *   - Filter: did 3+ "transaction completed" (purchase, credit) inside one
 *     hour, THEN "card locked" with reason="suspicious_activity" AND
 *     "dispute filed" with reason="unauthorized" within 1 hour
 *   - Expected: ~3% of SUPPORT-HISTORY users (users with card-locked +
 *     dispute-filed events). The lock+dispute pair alone is NOT a fraud
 *     signature — the organic Support funnel (support contacted → card
 *     locked → dispute filed) emits adjacent lock/dispute pairs whose
 *     random reasons collide ~4x more often than the hook fires. The
 *     preceding txn burst is what organic funnels cannot produce. The
 *     denominator is support-history users because the hook clones its
 *     lock/dispute from the user's own organic events — users without
 *     both templates are picked but leave no signature (~38% at this
 *     schema, measured; the factor cancels when you scope the cohort
 *     to support-history users).
 *
 *   Report 2: Fraud Resolution Funnel
 *   - Report type: Funnels
 *   - Steps: "card locked" -> "dispute filed" -> "support contacted"
 *   - Filter: card locked.reason = "suspicious_activity"
 *   - Expected: high completion across all three resolution steps
 *
 * REAL-WORLD ANALOGUE: A small but consistent slice of accounts
 * triggers fraud pipelines every cycle, generating the bulk of
 * dispute and support load.
 *
 * ---------------------------------------------------------------
 * Hook 4 — LOW BALANCE CHURN (everything)
 *
 * PATTERN: Users with 3+ "balance checked" events where account_balance
 * < $8K lose 50% of their events after day 30. No flag — derive cohort
 * by counting low-balance checks per user. (account_balance centers ~$25K
 * — weighNumRange(0, 50000) mean — so the $8K threshold puts ~10% of
 * checks under it and the 3+-check cohort at a minority of users; a $15K
 * threshold would sweep in the majority and erase the contrast.)
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Activity by Low Balance Cohort
 *   - Cohort A: users with >= 3 "balance checked" where account_balance < 8000
 *   - Cohort B: users with < 3
 *   - Event: any event
 *   - Measure: Total per user, line chart by day
 *   - Expected: A growth post-d30 ~ 0.5x B's growth (suppressed)
 *
 *   Report 2: Activity Decline Timeline
 *   - Report type: Insights (with cohort A above)
 *   - Event: any event
 *   - Measure: Total
 *   - Line chart by day
 *   - Expected: post-d30/pre-d30 event ratio ~ 3.0 for B (91 post days /
 *     30 pre days) vs ~ 1.5 for A (post-d30 events halved) — A/B ~ 0.5.
 *     Cohorts are classified from OUTPUT counts, so some churned users whose
 *     dropped events took them under 3 visible low checks land in B,
 *     pulling the observed A/B slightly above 0.5.
 *
 * REAL-WORLD ANALOGUE: Customers running thin balances lose trust
 * in the platform and migrate their primary banking elsewhere.
 *
 * ---------------------------------------------------------------
 * Hook 5 — BUDGET DISCIPLINE (everything)
 *
 * PATTERN: Disciplined budgeters — users with 3+ "budget created"
 * events (~77% of users; median is ~6 budgets) — get 2x savings
 * contributions, 1.5x investment amounts, and extra cloned savings
 * goal events. No flag — derive cohort behaviorally. (The gate is 3+,
 * not 1+: nearly every user creates at least one budget, so a 1+ gate
 * leaves a ~0.4% control cohort — unmeasurable. The 0-2 band is ~14%
 * of users: a real comparison group.)
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Savings Contribution by Budget Cohort
 *   - Cohort A: users with >= 3 "budget created" events
 *   - Cohort B: users with 0-2
 *   - Event: "savings goal set"
 *   - Measure: Average of "monthly_contribution"
 *   - Expected: A ~ 2x B
 *
 *   Report 2: Investment Size by Budget Cohort
 *   - Cohort A vs B (as above)
 *   - Event: "investment made"
 *   - Measure: Average of "amount"
 *   - Expected: A ~ 1.5x B
 *
 * REAL-WORLD ANALOGUE: Active budget tooling correlates strongly
 * with healthier savings rates and broader product adoption.
 *
 * ---------------------------------------------------------------
 * Hook 6 — AUTO-PAY LOYALTY (event)
 *
 * PATTERN: Manual payers (auto_pay=false) miss 30% of their bill
 * payments — those events are renamed to "bill payment missed".
 * Auto-pay users never miss.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Bill Outcomes by Manual vs Auto-Pay
 *   - Report type: Insights
 *   - Events: "bill paid" and "bill payment missed"
 *   - Measure: Total
 *   - Expected: missed events appear only for manual payers, ~30% rate
 *
 *   Report 2: Bill Completion Rate by Auto-Pay
 *   - Report type: Insights
 *   - Event: "bill paid"
 *   - Measure: Total
 *   - Breakdown: "auto_pay"
 *   - Expected: auto_pay=false ~ 70% completion vs auto_pay=true ~ 100%
 *
 * REAL-WORLD ANALOGUE: Auto-pay locks users into a frictionless
 * payment cadence that virtually eliminates missed bills.
 *
 * ---------------------------------------------------------------
 * Hook 7 — PREMIUM TIER VALUE (everything)
 *
 * PATTERN: Premium-tier users get 3x reward values and 2x sell
 * returns on investments. Plus tier gets 1.5x rewards. No flag —
 * mutates raw "value"/"amount" properties; discover via account_tier breakdown.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Reward Value by Tier
 *   - Report type: Insights
 *   - Event: "reward redeemed"
 *   - Measure: Average of "value"
 *   - Breakdown: "account_tier"
 *   - Expected: Premium ~ 3x Basic avg, Plus ~ 1.5x Basic avg
 *
 *   Report 2: Investment Sell Amount by Tier
 *   - Report type: Insights
 *   - Event: "investment made"
 *   - Measure: Average of "amount"
 *   - Filter: "action" = "sell"
 *   - Breakdown: "account_tier"
 *   - Expected: Premium ~ 2x baseline; Basic/Plus baseline
 *
 * REAL-WORLD ANALOGUE: Premium subscription tiers justify their
 * price by delivering visibly better cashback and investment perks.
 *
 * ---------------------------------------------------------------
 * Hook 8 — MONTH-END ANXIETY (everything)
 *
 * PATTERN: On days >= 28 of the calendar month, app sessions run
 * 40% longer and reported balances are 30% lower. No flag — discover
 * via day-of-month breakdown.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Session Duration by Day of Month
 *   - Report type: Insights
 *   - Event: "app session"
 *   - Measure: Average of "session_duration_sec"
 *   - Breakdown: day of month
 *   - Expected: days >= 28 ~ 1.4x other days
 *
 *   Report 2: Balance by Day of Month
 *   - Report type: Insights
 *   - Event: "balance checked"
 *   - Measure: Average of "account_balance"
 *   - Breakdown: day of month
 *   - Expected: days >= 28 ~ 0.7x other days
 *
 * REAL-WORLD ANALOGUE: Users obsessively check balances at month
 * end as bills hit and runway tightens.
 *
 * ---------------------------------------------------------------
 * Hook 9 — ONBOARDING TIME-TO-CONVERT (everything)
 *
 * PATTERN: Premium tier users complete the Onboarding funnel 1.5x
 * faster (factor 0.67); Basic users 1.33x slower (factor 1.33).
 * Applied in the everything hook via findFirstSequence + scaleFunnelTTC,
 * so the effect is visible in both Mixpanel funnels and cross-event
 * MIN→MIN SQL queries.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Onboarding Median Time-to-Convert by Tier
 *   - Funnels > "account opened" -> "app session" -> "balance checked"
 *   - Measure: MEDIAN time to convert (not average — TTC is heavy-tailed
 *     with a 30-day window, and converter cohorts are small enough that a
 *     single multi-day straggler dominates the mean; the median ratio
 *     recovers the exact engineered factors)
 *   - Breakdown: account_tier
 *   - Expected: median basic/premium ~ 1.33/0.67 ≈ 2x; plus sits between
 *
 * ---------------------------------------------------------------
 * Hook 10 — TRANSACTION-COUNT MAGIC NUMBER (everything)
 *
 * PATTERN: Sweet 12-19 transactions/user → +40% on investment-made
 * amount (engaged transactor compounds wealth). Over 20+ → drop 20%
 * of premium-upgraded events. No flag. (Bands measured from the actual
 * per-user txn distribution: median 12, p75 17, p90 20, max ~33 —
 * sweet brackets the median-to-p85 mass ~40%, over is the top ~12%;
 * the pre-calibration 20-35/36+ bands left the over band EMPTY.)
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Avg Investment Amount by Transaction Bucket
 *   - Cohort A: users with 12-19 "transaction completed"
 *   - Cohort B: users with 1-11
 *   - Event: "investment made"
 *   - Measure: Average of "amount"
 *   - Expected: A ~ 1.4x B
 *
 *   Report 2: Premium Upgrade RATE on Heavy Transactors
 *   - Cohort C: users with >= 20 "transaction completed"
 *   - Cohort A: users with 12-19
 *   - Formula: total "premium upgraded" / total NON-TRANSACTION events,
 *     per cohort
 *   - Expected: C's upgrade share ~ 0.8x A's. (Raw upgrades-per-user RISES
 *     with activity — heavier users emit more of every event — and the
 *     over band is SELECTED for high txn counts, which mechanically tilts
 *     its event mix toward transactions. Normalizing by non-transaction
 *     events removes both distortions; what remains is the 20% drop.)
 *
 * REAL-WORLD ANALOGUE: Engaged transactors invest more; over-active
 * already extract value without upgrading.
 *
 * ===================================================================
 * EXPECTED METRICS SUMMARY
 * ===================================================================
 *
 * Hook                  | Metric                | Baseline | Effect    | Ratio
 * ----------------------|-----------------------|----------|-----------|------
 * Personal vs Business  | Avg transaction amt   | 1x       | 4x        | 4x
 * Payday Patterns       | Deposit amt 1st/15th  | 1x       | 3x        | 3x
 * Fraud Detection       | Burst-sig users /     | 0%       | ~3%       | --
 *                       |  support-history users|          |           |
 * Low Balance Churn     | D30+ events (cohort)  | 1x       | 0.5x      | -50%
 * Budget Discipline     | Savings contribution  | 1x       | 2x        | 2x
 *                       |  (3+ budgets vs 0-2)  |          |           |
 * Auto-Pay Loyalty      | missed/paid ratio     | 0        | ~0.22     | 0.18/0.82
 * Premium Tier Value    | Reward value (Premium)| 1x       | 3x        | 3x
 * Month-End Anxiety     | Session duration d28+ | 1x       | 1.4x      | 1.4x
 * Onboarding T2C (H9)   | MEDIAN TTC basic/prem | 1x       | 1.33/0.67 | ~2x
 * Txn-Count Magic Num   | sweet investment amt  | 1x       | 1.4x      | 1.4x
 * Txn-Count Magic Num   | over upgrade share    | 1x       | 0.8x      | -20%
 */

// ── SCALE ──
const SEED = "harness-fintech";
const NUM_USERS = 10_000;
const DATASET_START = "2026-01-01T00:00:00Z";
const DATASET_END = "2026-05-01T23:59:59Z";
const EVENTS_PER_DAY = 1.2;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── KNOBS (tweak these to reshape stories) ──
// H1: Personal vs Business
const BUSINESS_LIKELIHOOD = 20;
const BUSINESS_TXN_MULT = 4;

// H2: Payday Patterns
const PAYDAY_DEPOSIT_MULT = 3;
const PAYDAY_TRANSFER_MULT = 2.0;
const PAYDAY_TRANSFER_LIKELIHOOD = 60;

// H3: Fraud Detection — fires for ~3% of users, but only leaves a signature
// when the user has organic card-locked AND dispute-filed template events to
// clone (~62% of users, measured — they come from the Support funnel). The
// honest detectable rate is therefore ~3% of SUPPORT-HISTORY users, which is
// what the story asserts (the template factor cancels in that denominator).
// The bare lock+dispute pair is NOT usable as the detector: organic Support
// funnels emit adjacent pairs whose random reasons collide ~4x more often
// than the hook fires. The preceding 3-txn burst is the discriminator.
const FRAUD_LIKELIHOOD = 3;
const FRAUD_BURST_MIN = 3;
const FRAUD_BURST_MAX = 5;
const FRAUD_AMOUNT_MIN = 500;
const FRAUD_AMOUNT_MAX = 3000;

// H4: Low Balance Churn — account_balance is weighNumRange(0, 50000), a
// normal centered ~$25K (sd ≈ $12.5K). $8K ≈ 10th percentile per check, so
// the 3+-low-check cohort stays a minority with real contrast against the
// rest. ($15K would capture ~22% per check and sweep in most active users.)
const LOW_BALANCE_THRESHOLD = 8000;
const LOW_BALANCE_CHECK_THRESHOLD = 3;
const LOW_BALANCE_CHURN_CUTOFF_DAYS = 30;
const LOW_BALANCE_DROP_LIKELIHOOD = 50;

// H5: Budget Discipline — gate is 3+ budgets, not 1+: budget-created lands
// ~5.6 events/user (median 6, measured), so only ~0.4% of users have ZERO
// budgets — no control group. The 0-2 band is ~14% of users (measured at
// 1500-user iteration), a real comparison cohort.
const BUDGET_DISCIPLINE_MIN = 3;
const BUDGET_SAVINGS_MULT = 2;
const BUDGET_INVESTMENT_MULT = 1.5;
const BUDGET_CLONE_LIKELIHOOD = 50;

// H6: Auto-Pay Loyalty
const MISSED_BILL_LIKELIHOOD = 30;

// H7: Premium Tier Value
const PREMIUM_REWARD_MULT = 3;
const PLUS_REWARD_MULT = 1.5;
const PREMIUM_INVEST_SELL_MULT = 2;

// H8: Month-End Anxiety
const MONTH_END_DAY_THRESHOLD = 28;
const MONTH_END_SESSION_MULT = 1.4;
const MONTH_END_BALANCE_MULT = 0.7;

// H9: Onboarding TTC
const TTC_PREMIUM_FACTOR = 0.67;
const TTC_BASIC_FACTOR = 1.33;
const TTC_MAX_GAP_MINUTES = 60 * 24 * 30; // 30-day max gap between steps

// H10: Transaction-Count Magic Number — bands MEASURED from the per-user txn
// distribution at the 1500-user iteration (per-user density is independent
// of numUsers): median 12, p75 17, p90 20, max ~33. Sweet 12-19 brackets the
// median-to-p85 mass (~40% of users); over 20+ is the top ~12%. The earlier
// weight-arithmetic estimate (~24 median → 20-35/36+ bands) left the over
// band EMPTY — bands must come from the measured distribution, not from
// event-weight arithmetic.
const TXN_SWEET_MIN = 12;
const TXN_SWEET_MAX = 19;
const TXN_OVER_THRESHOLD = 20;
const TXN_INVESTMENT_BOOST = 1.4;
const TXN_PREMIUM_DROP_LIKELIHOOD = 20;

// ── HELPER FUNCTIONS ──
function handleUserHooks(record) {
	// H1: PERSONAL VS BUSINESS ACCOUNTS — role-based attrs.
	const isBusiness = chance.bool({ likelihood: BUSINESS_LIKELIHOOD });
	if (isBusiness) {
		record.account_segment = "business";
		record.employee_count = chance.integer({ min: 5, max: 500 });
		record.annual_revenue = chance.integer({ min: 100000, max: 10000000 });
		record.industry = chance.pickone(["tech", "retail", "food", "services", "healthcare"]);
	} else {
		record.account_segment = "personal";
		record.age_range = `${chance.pickone([18, 25, 35, 45, 55])}-${chance.pickone([24, 34, 44, 54, 65])}`;
		record.life_stage = chance.pickone(["student", "early_career", "established", "pre_retirement", "retired"]);
	}
	return record;
}

function handleEventHooks(record) {
	// H6: AUTO-PAY LOYALTY — manual bill-paid events have 30% chance of
	// becoming "bill payment missed". Mutates event name.
	if (record.event === "bill paid" && record.auto_pay !== true && chance.bool({ likelihood: MISSED_BILL_LIKELIHOOD })) {
		record.event = "bill payment missed";
	}
	return record;
}

function handleEverythingHooks(record, meta) {
	const datasetStart = dayjs.unix(meta.datasetStart);
	const userEvents = record;
	const profile = meta.profile;

	userEvents.forEach(e => {
		e.account_tier = profile.account_tier;
		e.Platform = profile.Platform;
	});

	// H9: ONBOARDING TIME-TO-CONVERT — Premium 1.5x faster (factor 0.67);
	// Basic 1.33x slower (factor 1.33). Finds first onboarding sequence
	// and scales the inter-step gaps.
	{
		const ttcFactor = (
			profile.account_tier === "premium" ? TTC_PREMIUM_FACTOR :
			profile.account_tier === "basic" ? TTC_BASIC_FACTOR :
			1.0
		);
		if (ttcFactor !== 1.0) {
			const onboardingSeq = findFirstSequence(
				userEvents,
				["account opened", "app session", "balance checked"],
				TTC_MAX_GAP_MINUTES
			);
			if (onboardingSeq) {
				scaleFunnelTTC(onboardingSeq, ttcFactor);
			}
		}
	}

	// H1B: PERSONAL VS BUSINESS — business segment txns 4x larger
	// (per Report 2 in JSDoc: business ~ $200, personal ~ $50).
	if (profile.account_segment === "business") {
		userEvents.forEach(e => {
			if (e.event === "transaction completed" && typeof e.amount === "number") {
				e.amount = Math.floor(e.amount * BUSINESS_TXN_MULT);
			}
		});
	}

	// H2: PAYDAY PATTERNS — 1st & 15th: direct_deposit amount 3x.
	// Days 1-3 and 15-17: 60% of transfers get amount 2x. No flag.
	for (const e of userEvents) {
		const dayOfMonth = new Date(e.time).getUTCDate();
		if (e.event === "transaction completed" && e.transaction_type === "direct_deposit") {
			if (dayOfMonth === 1 || dayOfMonth === 15) {
				e.amount = Math.floor((e.amount || 50) * PAYDAY_DEPOSIT_MULT);
			}
		}
		if (e.event === "transfer sent") {
			const isPaydayWindow = (dayOfMonth >= 1 && dayOfMonth <= 3) || (dayOfMonth >= 15 && dayOfMonth <= 17);
			if (isPaydayWindow && chance.bool({ likelihood: PAYDAY_TRANSFER_LIKELIHOOD })) {
				e.amount = Math.floor((e.amount || 200) * PAYDAY_TRANSFER_MULT);
			}
		}
	}

	// H8: MONTH-END ANXIETY — days >= 28: app_session duration 1.4x;
	// balance_checked account_balance 0.7x. Mutates raw props.
	for (const e of userEvents) {
		const dayOfMonth = new Date(e.time).getUTCDate();
		if (dayOfMonth >= MONTH_END_DAY_THRESHOLD) {
			if (e.event === "app session") {
				e.session_duration_sec = Math.floor((e.session_duration_sec || 60) * MONTH_END_SESSION_MULT);
			}
			if (e.event === "balance checked") {
				e.account_balance = Math.floor((e.account_balance || 2500) * MONTH_END_BALANCE_MULT);
			}
		}
	}

	// H7: PREMIUM TIER VALUE — Premium 3x reward value + 2x investment-sell
	// amount; Plus 1.5x reward value. Reads tier from profile. No flag.
	const tier = profile.account_tier;
	userEvents.forEach(e => {
		if (e.event === "reward redeemed") {
			if (tier === "premium") e.value = Math.floor((e.value || 10) * PREMIUM_REWARD_MULT);
			else if (tier === "plus") e.value = Math.floor((e.value || 10) * PLUS_REWARD_MULT);
		}
		if (e.event === "investment made" && e.action === "sell" && tier === "premium") {
			e.amount = Math.floor((e.amount || 250) * PREMIUM_INVEST_SELL_MULT);
		}
	});

	// H3: FRAUD DETECTION — ~3% of users get fraud burst (3-5 rapid
	// high-value transactions + card locked + dispute + support contacted)
	// at timeline midpoint. No flag — discover via cohort builder on users
	// with card-locked + dispute-filed.
	if (chance.bool({ likelihood: FRAUD_LIKELIHOOD }) && userEvents.length >= 2) {
		const midIdx = Math.floor(userEvents.length / 2);
		const midEvent = userEvents[midIdx];
		const midTime = dayjs(midEvent.time);
		const distinctId = midEvent.user_id;
		const burstCount = chance.integer({ min: FRAUD_BURST_MIN, max: FRAUD_BURST_MAX });
		const fraudEvents = [];
		const txnTemplate = userEvents.find(e => e.event === "transaction completed");
		const cardTemplate = userEvents.find(e => e.event === "card locked");
		const disputeTemplate = userEvents.find(e => e.event === "dispute filed");
		const supportTemplate = userEvents.find(e => e.event === "support contacted");

		for (let i = 0; i < burstCount; i++) {
			if (txnTemplate) {
				fraudEvents.push({
					...txnTemplate,
					time: midTime.add(i * 10, "minutes").toISOString(),
					user_id: distinctId,
					transaction_type: "purchase",
					amount: chance.integer({ min: FRAUD_AMOUNT_MIN, max: FRAUD_AMOUNT_MAX }),
					merchant_category: chance.pickone(["online", "retail"]),
					payment_method: "credit",
				});
			}
		}
		if (cardTemplate) fraudEvents.push({
			...cardTemplate,
			time: midTime.add(burstCount * 10 + 5, "minutes").toISOString(),
			user_id: distinctId,
			reason: "suspicious_activity",
		});
		if (disputeTemplate) fraudEvents.push({
			...disputeTemplate,
			time: midTime.add(burstCount * 10 + 30, "minutes").toISOString(),
			user_id: distinctId,
			dispute_amount: chance.integer({ min: FRAUD_AMOUNT_MIN, max: FRAUD_AMOUNT_MAX }),
			reason: "unauthorized",
		});
		if (supportTemplate) fraudEvents.push({
			...supportTemplate,
			time: midTime.add(burstCount * 10 + 45, "minutes").toISOString(),
			user_id: distinctId,
			channel: "phone",
			issue_type: "card",
			resolved: true,
		});
		userEvents.splice(midIdx + 1, 0, ...fraudEvents);
	}

	// H4: LOW BALANCE CHURN — users with 3+ balance checks under $8K lose
	// 50% of post-day-30 events. No flag.
	const lowBalanceChecks = userEvents.filter(e =>
		e.event === "balance checked" && (e.account_balance || 0) < LOW_BALANCE_THRESHOLD
	).length;
	if (lowBalanceChecks >= LOW_BALANCE_CHECK_THRESHOLD) {
		const dayCutoff = datasetStart.add(LOW_BALANCE_CHURN_CUTOFF_DAYS, "days");
		for (let i = userEvents.length - 1; i >= 0; i--) {
			if (dayjs(userEvents[i].time).isAfter(dayCutoff) && chance.bool({ likelihood: LOW_BALANCE_DROP_LIKELIHOOD })) {
				userEvents.splice(i, 1);
			}
		}
	}

	// H5: BUDGET DISCIPLINE — users with 3+ budget-created events get
	// savings 2x, investment amounts 1.5x, and extra cloned savings-goal
	// events. No flag. Clones are collected first and pushed BEFORE the
	// mutate pass (splicing at idx+1 inside forEach would revisit the clone
	// and double-mutate it). Clones inherit the template's raw
	// monthly_contribution so the single ×2 pass applies uniformly and the
	// cohort ratio stays an exact 2x against light-budget (0-2) users.
	const budgetCount = userEvents.filter(e => e.event === "budget created").length;
	if (budgetCount >= BUDGET_DISCIPLINE_MIN) {
		const savingsTemplate = userEvents.find(e => e.event === "savings goal set");
		if (savingsTemplate) {
			const clones = [];
			for (const event of userEvents) {
				if (event.event === "budget created" && chance.bool({ likelihood: BUDGET_CLONE_LIKELIHOOD })) {
					clones.push({
						...savingsTemplate,
						time: dayjs(event.time).add(chance.integer({ min: 1, max: 7 }), "days").toISOString(),
						user_id: event.user_id,
						goal_type: chance.pickone(["emergency", "vacation", "car", "home"]),
						target_amount: chance.integer({ min: 1000, max: 20000 }),
					});
				}
			}
			userEvents.push(...clones); // engine auto-sorts by time after `everything`
		}
		for (const event of userEvents) {
			if (event.event === "savings goal set") {
				event.monthly_contribution = Math.floor((event.monthly_contribution || 200) * BUDGET_SAVINGS_MULT);
			}
			if (event.event === "investment made") {
				event.amount = Math.floor((event.amount || 250) * BUDGET_INVESTMENT_MULT);
			}
		}
	}

	// H10: TRANSACTION-COUNT MAGIC NUMBER (no flags)
	// Sweet 12-19 transactions/user → +40% on investment_made amount.
	// Over 20+ → drop 20% of premium-upgraded events.
	const txnCount = userEvents.filter(e => e.event === "transaction completed").length;
	if (txnCount >= TXN_SWEET_MIN && txnCount <= TXN_SWEET_MAX) {
		userEvents.forEach(e => {
			if (e.event === "investment made" && typeof e.amount === "number") {
				e.amount = Math.round(e.amount * TXN_INVESTMENT_BOOST);
			}
		});
	} else if (txnCount >= TXN_OVER_THRESHOLD) {
		for (let i = userEvents.length - 1; i >= 0; i--) {
			if (userEvents[i].event === "premium upgraded" && chance.bool({ likelihood: TXN_PREMIUM_DROP_LIKELIHOOD })) {
				userEvents.splice(i, 1);
			}
		}
	}

	return record;
}

// ── CONFIG ──
/** @type {Config} */
const config = {
	version: 2,
	seed: SEED,
	datasetStart: DATASET_START,
	datasetEnd: DATASET_END,
	avgEventsPerUserPerDay: EVENTS_PER_DAY,
	numUsers: NUM_USERS,
	format: "json",
	gzip: true,
	credentials: {
		token,
	},
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
	identity: {
		avgDevicePerUser: 2,
	},
	concurrency: 1,
	writeToDisk: false,

	scdProps: {
		// account_tier is deliberately NOT an SCD — the everything hook stamps
		// every event with the user's profile tier (H7/H9 depend on a stable
		// per-user tier), which an SCD timeline would silently contradict.
		risk_category: {
			values: ["low", "medium", "high", "critical"],
			frequency: "month",
			timing: "fixed",
			max: 8,
			type: "household_id"
		}
	},

	funnels: [
		{
			sequence: ["account opened", "app session", "balance checked"],
			isFirstFunnel: true,
			conversionRate: 85,
			timeToConvert: 0.25,
		},
		{
			// Daily banking: check balance, view transactions - most common activity
			sequence: ["app session", "balance checked", "transaction completed"],
			conversionRate: 80,
			timeToConvert: 0.5,
			weight: 5,
		},
		{
			// Transfers and notifications
			sequence: ["app session", "transfer sent", "notification opened"],
			conversionRate: 50,
			timeToConvert: 1,
			weight: 3,
		},
		{
			// Bill payment flow
			sequence: ["app session", "bill paid", "notification opened"],
			conversionRate: 60,
			timeToConvert: 1,
			weight: 3,
		},
		{
			// Financial planning: budgets and savings
			sequence: ["budget created", "budget alert", "savings goal set"],
			conversionRate: 40,
			timeToConvert: 12,
			weight: 2,
		},
		{
			// Investment and rewards
			sequence: ["balance checked", "investment made", "reward redeemed"],
			conversionRate: 30,
			timeToConvert: 5,
			weight: 2,
		},
		{
			// Support and account management
			sequence: ["support contacted", "card locked", "dispute filed"],
			conversionRate: 35,
			timeToConvert: 2,
			weight: 1,
		},
		{
			// Lending flow
			sequence: ["loan applied", "loan approved", "premium upgraded"],
			conversionRate: 25,
			timeToConvert: 10,
			weight: 1,
		},
	],

	events: [
		{
			event: "account opened",
			weight: 1,
			isFirstEvent: true,
			isAuthEvent: true,
			properties: {
				"account_type": ["personal", "business", "personal"],
				"signup_channel": ["app", "web", "referral", "branch"],
			}
		},
		{
			event: "app session",
			weight: 20,
			isStrictEvent: false,
			properties: {
				"session_duration_sec": u.weighNumRange(10, 600, 0.3, 60),
				"pages_viewed": u.weighNumRange(1, 15, 0.5, 3),
			}
		},
		{
			event: "balance checked",
			weight: 15,
			isStrictEvent: false,
			properties: {
				"account_balance": u.weighNumRange(0, 50000, 0.8, 2500),
				"account_type": ["checking", "savings", "investment"],
			}
		},
		{
			event: "transaction completed",
			weight: 18,
			isStrictEvent: false,
			properties: {
				"transaction_type": ["purchase", "atm", "direct_deposit", "refund"],
				"amount": u.weighNumRange(1, 5000, 0.3, 50),
				"merchant_category": ["grocery", "restaurant", "gas", "retail", "online", "subscription", "utilities"],
				"payment_method": ["debit", "credit", "contactless", "online"],
			}
		},
		{
			event: "transfer sent",
			weight: 8,
			isStrictEvent: false,
			properties: {
				"transfer_type": ["internal", "external", "p2p", "wire"],
				"amount": u.weighNumRange(10, 10000, 0.3, 200),
				"recipient_type": ["friend", "family", "business", "self"],
			}
		},
		{
			event: "bill paid",
			weight: 6,
			isStrictEvent: false,
			properties: {
				"bill_type": ["rent", "utilities", "phone", "insurance", "subscription", "loan_payment"],
				"amount": u.weighNumRange(20, 3000, 0.5, 150),
				"auto_pay": [false, false, false, true, true],
			}
		},
		{
			event: "bill payment missed",
			weight: 1,
			isStrictEvent: true, // hook-only: created by Hook 6 from manual bill-paid events
			properties: {
				"bill_type": ["rent", "utilities", "phone", "insurance", "subscription", "loan_payment"],
				"amount": u.weighNumRange(20, 3000, 0.5, 150),
				"auto_pay": [false], // carried over from the renamed "bill paid" event; always false (auto-pay never misses)
			}
		},
		{
			event: "budget created",
			weight: 3,
			isStrictEvent: false,
			properties: {
				"category": ["food", "transport", "entertainment", "shopping", "bills", "savings"],
				"monthly_limit": u.weighNumRange(50, 2000, 0.5, 300),
			}
		},
		{
			event: "budget alert",
			weight: 4,
			properties: {
				"alert_type": ["approaching_limit", "exceeded", "on_track"],
				"percent_used": u.weighNumRange(50, 150, 1, 90),
			}
		},
		{
			event: "savings goal set",
			weight: 3,
			isStrictEvent: false,
			properties: {
				"goal_type": ["emergency", "vacation", "car", "home", "education", "retirement"],
				"target_amount": u.weighNumRange(500, 50000, 0.3, 5000),
				"monthly_contribution": u.weighNumRange(25, 2000, 0.5, 200),
			}
		},
		{
			event: "investment made",
			weight: 4,
			isStrictEvent: false,
			properties: {
				"investment_type": ["stocks", "etf", "crypto", "bonds", "mutual_fund"],
				"amount": u.weighNumRange(10, 10000, 0.3, 250),
				"action": ["buy", "sell", "buy"],
			}
		},
		{
			event: "card locked",
			weight: 2,
			isStrictEvent: false,
			properties: {
				"reason": ["lost", "stolen", "suspicious_activity", "travel"],
			}
		},
		{
			event: "dispute filed",
			weight: 2,
			isStrictEvent: false,
			properties: {
				"dispute_amount": u.weighNumRange(10, 2000, 0.5, 100),
				"reason": ["unauthorized", "duplicate", "not_received", "damaged", "wrong_amount"],
			}
		},
		{
			event: "loan applied",
			weight: 2,
			properties: {
				"loan_type": ["personal", "auto", "home", "student", "business"],
				"requested_amount": u.weighNumRange(1000, 100000, 0.3, 10000),
			}
		},
		{
			event: "loan approved",
			weight: 1,
			properties: {
				"loan_type": ["personal", "auto", "home", "student", "business"],
				"approved_amount": u.weighNumRange(1000, 100000, 0.3, 10000),
				"interest_rate": u.weighNumRange(3, 25, 1, 8),
			}
		},
		{
			event: "premium upgraded",
			weight: 2,
			isStrictEvent: false,
			properties: {
				"old_tier": ["basic", "plus", "premium"],
				"new_tier": ["plus", "premium", "premium"],
				"monthly_fee": [4.99, 9.99, 14.99],
			}
		},
		{
			event: "support contacted",
			weight: 3,
			isStrictEvent: false,
			properties: {
				"channel": ["chat", "phone", "email", "in_app"],
				"issue_type": ["transaction", "account", "card", "transfer", "technical"],
				"resolved": [false, true, true, true, true],
			}
		},
		{
			event: "notification opened",
			weight: 10,
			properties: {
				"notification_type": ["transaction", "low_balance", "bill_due", "reward", "security", "promo"],
				"action_taken": [false, false, true, true, true],
			}
		},
		{
			event: "reward redeemed",
			weight: 4,
			isStrictEvent: false,
			properties: {
				"reward_type": ["cashback", "points", "discount", "partner_offer"],
				"value": u.weighNumRange(1, 100, 0.5, 10),
			}
		}
	],

	superProps: {
		account_tier: ["basic", "basic", "basic", "plus", "plus", "premium"],
		Platform: ["ios", "android", "web"],
	},

	userProps: {
		account_tier: ["basic", "basic", "basic", "plus", "plus", "premium"],
		Platform: ["ios", "android", "web"],
		"credit_score_range": ["300-579", "580-669", "670-739", "740-799", "800-850"],
		"income_bracket": ["under_30k", "30k_50k", "50k_75k", "75k_100k", "100k_150k", "over_150k"],
		"account_age_months": u.weighNumRange(1, 60, 0.5, 12),
		"total_balance": u.weighNumRange(0, 100000, 0.3, 5000),
		"has_direct_deposit": [false, false, true, true, true],
		"account_segment": ["personal"],
		"employee_count": [0],
		"annual_revenue": [0],
		"industry": [""],
		"age_range": [""],
		"life_stage": [""],
	},

	groupKeys: [
		["household_id", 500, ["transaction completed", "transfer sent", "bill paid", "savings goal set"]],
	],

	groupProps: {
		household_id: {
			"household_size": u.weighNumRange(1, 6),
			"combined_income": u.weighNumRange(20000, 300000, 0.3, 75000),
			"financial_health_score": u.weighNumRange(1, 100, 1, 65),
			"primary_bank": ["NexBank_only", "multi_bank", "NexBank_only"],
		}
	},

	lookupTables: [],

	hook(record, type, meta) {
		if (type === "user") return handleUserHooks(record);
		if (type === "event") return handleEventHooks(record);
		if (type === "everything") return handleEverythingHooks(record, meta);
		return record;
	}
};

// ── STORIES ──
// Machine-checkable contract for the 10 hooks above. Thresholds derive from
// the knob constants (and the declared property distributions), never from
// observed output. duckdb assertions run in disk mode only
// (scripts/verify-stories.mjs after scripts/verify-runner.mjs).

const EV = `read_json_auto('{{PREFIX}}-EVENTS*.json', sample_size=-1, union_by_name=true)`;
const US = `read_json_auto('{{PREFIX}}-USERS*.json', sample_size=-1, union_by_name=true)`;

/**
 * Five-tier verdict for a cohort ratio measured by a custom assert:
 * NAILED within ±10% of target, STRONG past floor, WEAK direction-correct,
 * INVERSE wrong side of 1, NONE exactly neutral. Mirrors verdictFor() for
 * op '>=' — needed because avg_aggregate is value-like and the select
 * grammar can't sum it across the multi-row freq>=1 selection.
 */
function ratioVerdict(ratio, target, floor, detail, smallestCohort, minCohort) {
	if (!Number.isFinite(ratio)) return { pass: false, verdict: "NONE", detail: `ratio not computable — ${detail}` };
	let verdict;
	if (Math.abs(ratio - target) <= 0.1 * target) verdict = "NAILED";
	else if (ratio >= floor) verdict = "STRONG";
	else if (ratio > 1) verdict = "WEAK";
	else if (ratio < 1) verdict = "INVERSE";
	else verdict = "NONE";
	if ((verdict === "NAILED" || verdict === "STRONG") && smallestCohort < minCohort) {
		verdict = "WEAK";
		detail += ` — capped: smallest cohort ${smallestCohort} < minCohort ${minCohort}`;
	}
	return { pass: verdict === "NAILED" || verdict === "STRONG", verdict, detail };
}

/** @type {import("../../../types").DungeonStory[]} */
export const stories = [
	{
		id: "H1-business-txn-4x",
		hook: "H1",
		archetype: "cohort-prop-scale",
		narrative: `${BUSINESS_LIKELIHOOD}% of accounts are business; their transaction amounts run ${BUSINESS_TXN_MULT}x personal (H1 user attrs + H1B everything-mult)`,
		assertions: [
			{
				// user mix: 20/80 → business/personal user ratio 0.25
				breakdown: {
					type: "duckdb",
					sql: `SELECT account_segment AS seg, count(*) AS user_count FROM ${US} GROUP BY 1`,
				},
				select: {
					business: { where: { seg: "business" } },
					personal: { where: { seg: "personal" } },
				},
				expect: { metric: "business.user_count / personal.user_count", op: "between", target: [0.22, 0.28] },
				minCohort: 200,
			},
			{
				// amount ratio: BUSINESS_TXN_MULT = 4 exactly; floor 3 absorbs the
				// H3 fraud-burst txns (fresh $500-3000 amounts spliced AFTER the
				// H1B multiply, so they dilute the business avg slightly)
				breakdown: {
					type: "duckdb",
					sql: `WITH seg AS (SELECT distinct_id AS user_id, account_segment FROM ${US})
SELECT s.account_segment AS seg, avg(e.amount) AS avg_amount, count(DISTINCT e.user_id) AS user_count
FROM ${EV} e JOIN seg s USING (user_id)
WHERE e.event = 'transaction completed' AND e.amount IS NOT NULL GROUP BY 1`,
				},
				select: {
					business: { where: { seg: "business" } },
					personal: { where: { seg: "personal" } },
				},
				expect: { metric: "business.avg_amount / personal.avg_amount", op: ">=", target: BUSINESS_TXN_MULT, floor: 3 },
				minCohort: 200,
			},
		],
	},
	{
		id: "H2-payday-amounts",
		hook: "H2",
		archetype: "temporal-inflection",
		narrative: `direct deposits ${PAYDAY_DEPOSIT_MULT}x on the 1st/15th; transfers avg ${(PAYDAY_TRANSFER_LIKELIHOOD / 100) * PAYDAY_TRANSFER_MULT + (1 - PAYDAY_TRANSFER_LIKELIHOOD / 100)}x in the 1-3/15-17 windows (${PAYDAY_TRANSFER_LIKELIHOOD}% of transfers x${PAYDAY_TRANSFER_MULT})`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT CASE WHEN EXTRACT(DAY FROM time::TIMESTAMP) IN (1, 15) THEN 'payday' ELSE 'other' END AS bucket,
avg(amount) AS avg_amount, count(*) AS event_count
FROM ${EV} WHERE event = 'transaction completed' AND transaction_type = 'direct_deposit' AND amount IS NOT NULL GROUP BY 1`,
				},
				select: {
					payday: { where: { bucket: "payday" } },
					other: { where: { bucket: "other" } },
				},
				// PAYDAY_DEPOSIT_MULT = 3 exactly (every 1st/15th deposit tripled)
				expect: { metric: "payday.avg_amount / other.avg_amount", op: ">=", target: PAYDAY_DEPOSIT_MULT, floor: 2.5 },
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT CASE WHEN EXTRACT(DAY FROM time::TIMESTAMP) IN (1, 2, 3, 15, 16, 17) THEN 'payday_window' ELSE 'other' END AS bucket,
avg(amount) AS avg_amount, count(*) AS event_count
FROM ${EV} WHERE event = 'transfer sent' AND amount IS NOT NULL GROUP BY 1`,
				},
				select: {
					window: { where: { bucket: "payday_window" } },
					other: { where: { bucket: "other" } },
				},
				// E[mult] = 0.6*2 + 0.4*1 = 1.6
				expect: { metric: "window.avg_amount / other.avg_amount", op: ">=", target: 1.6, floor: 1.4 },
			},
		],
	},
	{
		id: "H3-fraud-cohort-share",
		hook: "H3",
		archetype: "bespoke",
		narrative: `~${FRAUD_LIKELIHOOD}% of SUPPORT-HISTORY users (those with organic card-locked + dispute-filed templates) carry the full fraud signature: ${FRAUD_BURST_MIN}+ rapid credit purchases, then a suspicious-activity lock and an unauthorized dispute within 1h. The bare lock+dispute pair is NOT the detector — organic Support-funnel pairs with colliding reasons outnumber the hook ~4:1. Scoping the denominator to support-history users cancels the template-availability factor (~0.62), so the target is FRAUD_LIKELIHOOD itself`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					// Numerator: users with >= FRAUD_BURST_MIN credit purchases in the
					// 65 min before a suspicious lock, plus an unauthorized dispute
					// within 1h after it (hook stamps lock at burst+5..55 min, dispute
					// 25 min later). Denominator: users with both template event types
					// (any reason) — the only users the hook can leave a signature on.
					sql: `WITH locks AS (SELECT user_id, epoch(time::TIMESTAMP) AS t FROM ${EV} WHERE event = 'card locked' AND reason = 'suspicious_activity'),
disputes AS (SELECT user_id, epoch(time::TIMESTAMP) AS t FROM ${EV} WHERE event = 'dispute filed' AND reason = 'unauthorized'),
txns AS (SELECT user_id, epoch(time::TIMESTAMP) AS t FROM ${EV} WHERE event = 'transaction completed' AND transaction_type = 'purchase' AND payment_method = 'credit'),
burst_locks AS (
  SELECT l.user_id, l.t FROM locks l JOIN txns x ON x.user_id = l.user_id AND x.t BETWEEN l.t - 3900 AND l.t
  GROUP BY 1, 2 HAVING count(*) >= ${FRAUD_BURST_MIN}
),
sig AS (SELECT DISTINCT b.user_id FROM burst_locks b JOIN disputes d ON d.user_id = b.user_id AND d.t - b.t BETWEEN 0 AND 3600),
hist AS (SELECT count(*) AS n FROM (
  SELECT user_id FROM ${EV} WHERE event = 'card locked' GROUP BY 1
  INTERSECT
  SELECT user_id FROM ${EV} WHERE event = 'dispute filed' GROUP BY 1
))
SELECT 'fraud' AS grp, (SELECT count(*) FROM sig) AS user_count, (SELECT count(*) FROM sig)::DOUBLE / (SELECT n FROM hist) AS fraction`,
				},
				select: { fraud: { where: { grp: "fraud" } } },
				// Target = FRAUD_LIKELIHOOD/100 = 0.03. At full fidelity (10K users,
				// ~300 picks x 0.62 templates x ~0.91 surviving H4 churn ≈ 170 sig
				// users / ~6200 support-history users ≈ 0.027; binomial sd ~0.002)
				// the band is ±3-4sd. At 1500-user iteration sd is ~3x wider —
				// an iteration miss on a low draw is expected; judge at full scale.
				expect: { metric: "fraud.fraction", op: "between", target: [0.02, 0.04] },
				minCohort: 100,
			},
		],
	},
	{
		id: "H4-lowbal-churn-suppression",
		hook: "H4",
		archetype: "retention-divergence",
		narrative: `users with ${LOW_BALANCE_CHECK_THRESHOLD}+ balance checks under $${LOW_BALANCE_THRESHOLD} lose ${LOW_BALANCE_DROP_LIKELIHOOD}% of post-day-${LOW_BALANCE_CHURN_CUTOFF_DAYS} events — their post/pre event ratio runs ~0.5x the healthy cohort's. Band [0.4, 0.65]: cohorts are classified from OUTPUT counts, so churned users whose dropped events fell under 3 visible low checks dilute the healthy side, pulling the ratio above the raw 0.5`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ev AS (SELECT user_id, event, time::TIMESTAMP AS t, TRY_CAST(account_balance AS DOUBLE) AS bal FROM ${EV}),
cutoff AS (SELECT min(t) + INTERVAL ${LOW_BALANCE_CHURN_CUTOFF_DAYS} DAY AS c FROM ev),
low AS (SELECT user_id, count(*) FILTER (WHERE event = 'balance checked' AND bal < ${LOW_BALANCE_THRESHOLD}) AS low_checks FROM ev GROUP BY 1)
SELECT CASE WHEN l.low_checks >= ${LOW_BALANCE_CHECK_THRESHOLD} THEN 'lowbal' ELSE 'healthy' END AS grp,
count(DISTINCT e.user_id) AS user_count,
(count(*) FILTER (WHERE e.t >= (SELECT c FROM cutoff)))::DOUBLE / nullif(count(*) FILTER (WHERE e.t < (SELECT c FROM cutoff)), 0) AS post_pre
FROM ev e JOIN low l USING (user_id) GROUP BY 1`,
				},
				select: {
					lowbal: { where: { grp: "lowbal" } },
					healthy: { where: { grp: "healthy" } },
				},
				expect: { metric: "lowbal.post_pre / healthy.post_pre", op: "between", target: [0.4, 0.65] },
				minCohort: 300,
			},
		],
	},
	{
		id: "H5-budget-discipline",
		hook: "H5",
		archetype: "cohort-prop-scale",
		narrative: `disciplined budgeters (${BUDGET_DISCIPLINE_MIN}+ budget-created events, ~77% of users) get ${BUDGET_SAVINGS_MULT}x savings contributions and ${BUDGET_INVESTMENT_MULT}x investment amounts vs light budgeters (0-${BUDGET_DISCIPLINE_MIN - 1}, ~14% — measured; a 1+ gate would leave a ~0.4% control group, unmeasurable)`,
		assertions: [
			{
				// avg_aggregate is value-like → custom assert does the user_count-
				// weighted mean on each side of the discipline gate (select grammar
				// can't aggregate a value-like column across rows).
				breakdown: { type: "aggregatePerUser", event: "savings goal set", property: "monthly_contribution", agg: "avg", breakdownByFrequencyOf: "budget created" },
				assert: (rows) => {
					const lo = (rows || []).filter(r => r.breakdown_freq < BUDGET_DISCIPLINE_MIN);
					const hi = (rows || []).filter(r => r.breakdown_freq >= BUDGET_DISCIPLINE_MIN);
					if (!lo.length || !hi.length) return { pass: false, verdict: "NONE", detail: `missing cohort: light=${lo.length} disciplined=${hi.length} rows` };
					const wmean = rs => rs.reduce((s, r) => s + r.avg_aggregate * r.user_count, 0) / rs.reduce((s, r) => s + r.user_count, 0);
					const usersLo = lo.reduce((s, r) => s + r.user_count, 0);
					const usersHi = hi.reduce((s, r) => s + r.user_count, 0);
					const ratio = wmean(hi) / wmean(lo);
					return ratioVerdict(ratio, BUDGET_SAVINGS_MULT, 1.7,
						`disciplined avg=${wmean(hi).toFixed(0)} (${usersHi}u) vs light=${wmean(lo).toFixed(0)} (${usersLo}u) ratio=${ratio.toFixed(2)}`,
						Math.min(usersLo, usersHi), 100);
				},
			},
			{
				breakdown: { type: "aggregatePerUser", event: "investment made", property: "amount", agg: "avg", breakdownByFrequencyOf: "budget created" },
				assert: (rows) => {
					const lo = (rows || []).filter(r => r.breakdown_freq < BUDGET_DISCIPLINE_MIN);
					const hi = (rows || []).filter(r => r.breakdown_freq >= BUDGET_DISCIPLINE_MIN);
					if (!lo.length || !hi.length) return { pass: false, verdict: "NONE", detail: `missing cohort: light=${lo.length} disciplined=${hi.length} rows` };
					const wmean = rs => rs.reduce((s, r) => s + r.avg_aggregate * r.user_count, 0) / rs.reduce((s, r) => s + r.user_count, 0);
					const usersLo = lo.reduce((s, r) => s + r.user_count, 0);
					const usersHi = hi.reduce((s, r) => s + r.user_count, 0);
					const ratio = wmean(hi) / wmean(lo);
					// H7 sell-mult and H10 sweet-band boost hit both cohorts alike
					// (tier and txn count are independent of budget count) —
					// floor 1.3 absorbs the residual mix noise
					return ratioVerdict(ratio, BUDGET_INVESTMENT_MULT, 1.3,
						`disciplined avg=${wmean(hi).toFixed(0)} (${usersHi}u) vs light=${wmean(lo).toFixed(0)} (${usersLo}u) ratio=${ratio.toFixed(2)}`,
						Math.min(usersLo, usersHi), 100);
				},
			},
		],
	},
	{
		id: "H6-autopay-missed-share",
		hook: "H6",
		archetype: "composition-drift",
		narrative: `manual payers (60% of bills, auto_pay enum 3/5 false) miss ${MISSED_BILL_LIKELIHOOD}% of payments → missed/paid = (0.6*0.3)/(1-0.18) ~ 0.22`,
		assertions: [
			{
				breakdown: { type: "eventBreakdown", breakdownProperty: "event" },
				select: {
					missed: { where: { value: "bill payment missed" } },
					paid: { where: { value: "bill paid" } },
				},
				expect: { metric: "missed.count / paid.count", op: "between", target: [0.19, 0.25] },
			},
		],
	},
	{
		id: "H7-premium-tier-value",
		hook: "H7",
		archetype: "cohort-prop-scale",
		narrative: `premium gets ${PREMIUM_REWARD_MULT}x reward value and ${PREMIUM_INVEST_SELL_MULT}x investment-sell amounts; plus gets ${PLUS_REWARD_MULT}x rewards. account_tier is hook-pinned per user, so event-property breakdowns are clean`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT account_tier AS tier, avg(TRY_CAST("value" AS DOUBLE)) AS avg_value, count(DISTINCT user_id) AS user_count
FROM ${EV} WHERE event = 'reward redeemed' AND "value" IS NOT NULL GROUP BY 1`,
				},
				select: {
					premium: { where: { tier: "premium" } },
					basic: { where: { tier: "basic" } },
				},
				expect: { metric: "premium.avg_value / basic.avg_value", op: ">=", target: PREMIUM_REWARD_MULT, floor: 2.5 },
				minCohort: 150,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT account_tier AS tier, avg(TRY_CAST("value" AS DOUBLE)) AS avg_value, count(DISTINCT user_id) AS user_count
FROM ${EV} WHERE event = 'reward redeemed' AND "value" IS NOT NULL GROUP BY 1`,
				},
				select: {
					plus: { where: { tier: "plus" } },
					basic: { where: { tier: "basic" } },
				},
				expect: { metric: "plus.avg_value / basic.avg_value", op: ">=", target: PLUS_REWARD_MULT, floor: 1.3 },
				minCohort: 150,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT account_tier AS tier, avg(amount) AS avg_amount, count(DISTINCT user_id) AS user_count
FROM ${EV} WHERE event = 'investment made' AND action = 'sell' AND amount IS NOT NULL GROUP BY 1`,
				},
				select: {
					premium: { where: { tier: "premium" } },
					basic: { where: { tier: "basic" } },
				},
				// H5 (x1.5) and H10 (x1.4) investment boosts are tier-independent —
				// they multiply both cohorts alike; floor 1.6 absorbs the noise
				expect: { metric: "premium.avg_amount / basic.avg_amount", op: ">=", target: PREMIUM_INVEST_SELL_MULT, floor: 1.6 },
				minCohort: 150,
			},
		],
	},
	{
		id: "H8-month-end-anxiety",
		hook: "H8",
		archetype: "temporal-inflection",
		narrative: `days >= ${MONTH_END_DAY_THRESHOLD}: session durations ${MONTH_END_SESSION_MULT}x, reported balances ${MONTH_END_BALANCE_MULT}x`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT CASE WHEN EXTRACT(DAY FROM time::TIMESTAMP) >= ${MONTH_END_DAY_THRESHOLD} THEN 'monthEnd' ELSE 'other' END AS bucket,
avg(session_duration_sec) AS avg_duration, count(*) AS event_count
FROM ${EV} WHERE event = 'app session' AND session_duration_sec IS NOT NULL GROUP BY 1`,
				},
				select: {
					monthEnd: { where: { bucket: "monthEnd" } },
					other: { where: { bucket: "other" } },
				},
				expect: { metric: "monthEnd.avg_duration / other.avg_duration", op: ">=", target: MONTH_END_SESSION_MULT, floor: 1.25 },
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT CASE WHEN EXTRACT(DAY FROM time::TIMESTAMP) >= ${MONTH_END_DAY_THRESHOLD} THEN 'monthEnd' ELSE 'other' END AS bucket,
avg(TRY_CAST(account_balance AS DOUBLE)) AS avg_balance, count(*) AS event_count
FROM ${EV} WHERE event = 'balance checked' AND account_balance IS NOT NULL GROUP BY 1`,
				},
				select: {
					monthEnd: { where: { bucket: "monthEnd" } },
					other: { where: { bucket: "other" } },
				},
				expect: { metric: "monthEnd.avg_balance / other.avg_balance", op: "<=", target: MONTH_END_BALANCE_MULT, floor: 0.8 },
			},
		],
	},
	{
		id: "H9-onboarding-ttc-by-tier",
		hook: "H9",
		archetype: "funnel-ttc-by-segment",
		narrative: `onboarding TTC scaled per tier: basic x${TTC_BASIC_FACTOR}, premium x${TTC_PREMIUM_FACTOR} → basic/premium MEDIAN TTC ratio = ${(TTC_BASIC_FACTOR / TTC_PREMIUM_FACTOR).toFixed(3)}, plus (x1.0) between them. Median, not avg: TTC is heavy-tailed under a 30-day window and converter cohorts are small (only born-in users run onboarding) — at iteration scale a single straggler made plus's AVG exceed basic's; the median ratio recovers the exact factors`,
		assertions: [
			{
				breakdown: {
					type: "timeToConvert",
					steps: ["account opened", "app session", "balance checked"],
					breakdownByUserProperty: "account_tier",
					conversionWindowMs: 30 * 86400000, // funnel default conversionWindowDays
				},
				select: {
					basic: { where: { segment_value: "basic" } },
					premium: { where: { segment_value: "premium" } },
				},
				// multiplicative gap scaling multiplies the median exactly →
				// median ratio = TTC_BASIC_FACTOR / TTC_PREMIUM_FACTOR ≈ 1.985
				expect: { metric: "basic.median_ttc_ms / premium.median_ttc_ms", op: ">=", target: TTC_BASIC_FACTOR / TTC_PREMIUM_FACTOR, floor: 1.5 },
				minCohort: 100,
			},
			{
				breakdown: {
					type: "timeToConvert",
					steps: ["account opened", "app session", "balance checked"],
					breakdownByUserProperty: "account_tier",
					conversionWindowMs: 30 * 86400000,
				},
				select: {
					plus: { where: { segment_value: "plus" } },
					premium: { where: { segment_value: "premium" } },
				},
				// plus is unscaled (factor 1.0) → plus/premium = 1/0.67 ≈ 1.49;
				// ordering check that premium is genuinely fastest
				expect: { metric: "plus.median_ttc_ms / premium.median_ttc_ms", op: ">=", target: 1 / TTC_PREMIUM_FACTOR, floor: 1.2 },
				minCohort: 100,
			},
		],
	},
	{
		id: "H10-txn-magic-number",
		hook: "H10",
		archetype: "frequency-sweet-spot",
		narrative: `sweet-band users (${TXN_SWEET_MIN}-${TXN_SWEET_MAX} txns) invest ${TXN_INVESTMENT_BOOST}x vs the 1-${TXN_SWEET_MIN - 1} band; over-band (${TXN_OVER_THRESHOLD}+) loses ${TXN_PREMIUM_DROP_LIKELIHOOD}% of premium upgrades — visible as upgrade share of NON-TXN events (raw upgrades-per-user rises with activity, and the over band is selected for high txn counts, tilting its event mix toward txns; normalizing by non-txn events removes both distortions)`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH txn AS (SELECT user_id, count(*) AS n FROM ${EV} WHERE event = 'transaction completed' GROUP BY 1),
bands AS (SELECT user_id, CASE WHEN n BETWEEN ${TXN_SWEET_MIN} AND ${TXN_SWEET_MAX} THEN 'sweet' WHEN n < ${TXN_SWEET_MIN} THEN 'low' ELSE 'over' END AS band FROM txn)
SELECT b.band, avg(e.amount) AS avg_amount, count(DISTINCT e.user_id) AS user_count
FROM ${EV} e JOIN bands b USING (user_id)
WHERE e.event = 'investment made' AND e.amount IS NOT NULL GROUP BY 1`,
				},
				select: {
					sweet: { where: { band: "sweet" } },
					low: { where: { band: "low" } },
				},
				// TXN_INVESTMENT_BOOST = 1.4; floor 1.2 absorbs band-mix noise
				// (H5's x1.5 is near-universal in both bands)
				expect: { metric: "sweet.avg_amount / low.avg_amount", op: ">=", target: TXN_INVESTMENT_BOOST, floor: 1.2 },
				minCohort: 300,
			},
			{
				breakdown: {
					type: "duckdb",
					// share of NON-TXN events: the over band is selected for high txn
					// counts, which mechanically tilts its mix toward txns — dividing
					// by non-txn events removes the tilt so only the 20% drop remains
					sql: `WITH txn AS (SELECT user_id, count(*) AS n FROM ${EV} WHERE event = 'transaction completed' GROUP BY 1),
bands AS (SELECT user_id, CASE WHEN n BETWEEN ${TXN_SWEET_MIN} AND ${TXN_SWEET_MAX} THEN 'sweet' WHEN n < ${TXN_SWEET_MIN} THEN 'low' ELSE 'over' END AS band FROM txn)
SELECT b.band, (count(*) FILTER (WHERE e.event = 'premium upgraded'))::DOUBLE / (count(*) FILTER (WHERE e.event != 'transaction completed')) AS upgrade_share, count(DISTINCT e.user_id) AS user_count
FROM ${EV} e JOIN bands b USING (user_id) GROUP BY 1`,
				},
				select: {
					over: { where: { band: "over" } },
					sweet: { where: { band: "sweet" } },
				},
				// drop knob = 20% → share ratio 0.8; STRONG bound 0.9
				expect: { metric: "over.upgrade_share / sweet.upgrade_share", op: "<=", target: 1 - TXN_PREMIUM_DROP_LIKELIHOOD / 100, floor: 0.9 },
				minCohort: 300,
			},
		],
	},
];

export default config;
