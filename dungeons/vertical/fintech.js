// ── IMPORTS ──
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);
import "dotenv/config";
import * as u from "../../lib/utils/utils.js";
import { findFirstSequence, scaleFunnelTTC } from "../../lib/hook-helpers/timing.js";
/** @typedef  {import("../../types").Dungeon} Config */

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
 * SCD PROPS:   account_tier (basic/plus/premium, monthly fuzzy, max 6), risk_category (low/medium/high/critical, household_id-scoped, monthly fixed, max 8)
 * GROUPS:      household_id (500 households)
 */

// ── HOOK STORIES ──
/*
 * NOTE: All cohort effects are HIDDEN — no flag stamping. Discoverable
 * via behavioral cohorts, raw-prop breakdowns (date, account_tier),
 * or funnel time-to-convert.
 *
 * ---------------------------------------------------------------
 * 1. PERSONAL VS BUSINESS ACCOUNTS (user)
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
 *   - Expected: business ~ $200+, personal ~ $50 (~4x larger)
 *
 * REAL-WORLD ANALOGUE: Neobanks serve both consumers and small
 * businesses with the same core product, but business activity is
 * meaningfully higher value per transaction.
 *
 * ---------------------------------------------------------------
 * 2. PAYDAY PATTERNS (everything)
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
 * 3. FRAUD DETECTION (everything)
 *
 * PATTERN: ~1-2% of users experience a fraud burst at the timeline
 * midpoint: 3-5 rapid high-value transactions, then card locked
 * (reason="suspicious_activity"), dispute filed (reason="unauthorized"),
 * and support contacted (issue_type="card"). No flag — derive cohort
 * by joining users who had all three event types within ~1 hour.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Fraud Cohort
 *   - Report type: Cohort builder
 *   - Filter: did "card locked" with reason="suspicious_activity"
 *     AND "dispute filed" with reason="unauthorized"
 *     within 1 hour of each other
 *   - Expected: ~1-2% of total users
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
 * 4. LOW BALANCE CHURN (everything)
 *
 * PATTERN: Users with 3+ "balance checked" events where account_balance
 * < $15K lose 50% of their events after day 30. No flag — derive cohort
 * by counting low-balance checks per user.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Activity by Low Balance Cohort
 *   - Cohort A: users with >= 3 "balance checked" where account_balance < 15000
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
 *   - Expected: pre-d30/post-d30 ratio ~ 1.0x for A vs ~ 2.0x for B
 *
 * REAL-WORLD ANALOGUE: Customers running thin balances lose trust
 * in the platform and migrate their primary banking elsewhere.
 *
 * ---------------------------------------------------------------
 * 5. BUDGET USERS SAVE MORE (everything)
 *
 * PATTERN: Users with any "budget created" event get 2x savings
 * contributions, 1.5x investment amounts, and extra cloned savings
 * goal events. No flag — derive cohort behaviorally.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Savings Contribution by Budget Cohort
 *   - Cohort A: users with >= 1 "budget created" event
 *   - Cohort B: users with 0
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
 * 6. AUTO-PAY LOYALTY (event)
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
 * 7. PREMIUM TIER VALUE (everything)
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
 *   - Expected: Premium ~ $30, Plus ~ $15, Basic ~ $10
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
 * 8. MONTH-END ANXIETY (everything)
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
 * 9. ONBOARDING TIME-TO-CONVERT (everything)
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
 *   - Measure: Median time to convert
 *   - Breakdown: account_tier
 *   - Expected: premium ~ 0.67x baseline; basic ~ 1.33x
 *
 * ---------------------------------------------------------------
 * 10. TRANSACTION-COUNT MAGIC NUMBER (everything)
 *
 * PATTERN: Sweet 6-10 transactions/user → +40% on investment-made
 * amount (engaged transactor compounds wealth). Over 11+ → drop 20%
 * of premium-upgraded events. No flag.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Avg Investment Amount by Transaction Bucket
 *   - Cohort A: users with 6-10 "transaction completed"
 *   - Cohort B: users with 0-5
 *   - Event: "investment made"
 *   - Measure: Average of "amount"
 *   - Expected: A ~ 1.4x B
 *
 *   Report 2: Premium Upgrades on Heavy Transactors
 *   - Cohort C: users with >= 11 "transaction completed"
 *   - Cohort A: users with 6-10
 *   - Event: "premium upgraded"
 *   - Measure: Total per user
 *   - Expected: C ~ 20% fewer upgrades per user
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
 * Personal vs Business  | Avg transaction amt   | $50      | $200+     | ~ 4x
 * Payday Patterns       | Deposit amt 1st/15th  | 1x       | 3x        | 3x
 * Fraud Detection       | Users affected        | 0%       | 3%        | --
 * Low Balance Churn     | D30+ events           | 1x       | 0.5x      | -50%
 * Budget Discipline     | Savings contribution  | 1x       | 2x        | 2x
 * Auto-Pay Loyalty      | Bill completion rate  | 100%     | 70%       | -30%
 * Premium Tier Value    | Reward value (Premium)| 1x       | 3x        | 3x
 * Month-End Anxiety     | Session duration d28+ | 1x       | 1.4x      | 1.4x
 * Onboarding T2C (H9)   | median min by tier    | 1x       | 0.67/1.33x| 2x range
 * Txn-Count Magic Num   | sweet investment amt  | 1x       | 1.4x      | 1.4x
 * Txn-Count Magic Num   | over premium upgrades | 1x       | 0.8x      | -20%
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

// H3: Fraud Detection
const FRAUD_LIKELIHOOD = 15;
const FRAUD_BURST_MIN = 3;
const FRAUD_BURST_MAX = 5;
const FRAUD_AMOUNT_MIN = 500;
const FRAUD_AMOUNT_MAX = 3000;

// H4: Low Balance Churn
const LOW_BALANCE_THRESHOLD = 15000;
const LOW_BALANCE_CHECK_THRESHOLD = 3;
const LOW_BALANCE_CHURN_CUTOFF_DAYS = 30;
const LOW_BALANCE_DROP_LIKELIHOOD = 50;

// H5: Budget Discipline
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

// H10: Transaction-Count Magic Number
const TXN_SWEET_MIN = 6;
const TXN_SWEET_MAX = 10;
const TXN_OVER_THRESHOLD = 11;
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

	// H3: FRAUD DETECTION — 15% of users get fraud burst (3-5 rapid
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

	// H4: LOW BALANCE CHURN — users with 3+ balance checks under $15K lose
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

	// H5: BUDGET DISCIPLINE — users with any budget-created event get
	// savings 2x, investment amounts 1.5x, and extra cloned savings-goal
	// events. No flag.
	const hasBudget = userEvents.some(e => e.event === "budget created");
	if (hasBudget) {
		userEvents.forEach((event, idx) => {
			const eventTime = dayjs(event.time);
			if (event.event === "savings goal set") {
				event.monthly_contribution = Math.floor((event.monthly_contribution || 200) * BUDGET_SAVINGS_MULT);
			}
			if (event.event === "investment made") {
				event.amount = Math.floor((event.amount || 250) * BUDGET_INVESTMENT_MULT);
			}
			if (event.event === "budget created" && chance.bool({ likelihood: BUDGET_CLONE_LIKELIHOOD })) {
				const savingsTemplate = userEvents.find(e => e.event === "savings goal set");
				if (savingsTemplate) {
					userEvents.splice(idx + 1, 0, {
						...savingsTemplate,
						time: eventTime.add(chance.integer({ min: 1, max: 7 }), "days").toISOString(),
						user_id: event.user_id,
						goal_type: chance.pickone(["emergency", "vacation", "car", "home"]),
						target_amount: chance.integer({ min: 1000, max: 20000 }),
						monthly_contribution: chance.integer({ min: 100, max: 800 }),
					});
				}
			}
		});
	}

	// H10: TRANSACTION-COUNT MAGIC NUMBER (no flags)
	// Sweet 6-10 transactions/user → +40% on investment_made amount.
	// Over 11+ → drop 20% of premium-upgraded events.
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
	token,
	seed: SEED,
	datasetStart: DATASET_START,
	datasetEnd: DATASET_END,
	avgEventsPerUserPerDay: EVENTS_PER_DAY,
	numUsers: NUM_USERS,
	hasAnonIds: true,
	avgDevicePerUser: 2,
	hasSessionIds: true,
	format: "json",
	gzip: true,
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
	concurrency: 1,
	writeToDisk: false,

	scdProps: {
		account_tier: {
			values: ["basic", "plus", "premium"],
			frequency: "month",
			timing: "fuzzy",
			max: 6
		},
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

export default config;
