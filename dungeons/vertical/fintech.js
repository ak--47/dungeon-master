// ── TWEAK THESE ──
const SEED = "harness-fintech";
const num_days = 100;
const num_users = 5_000;
const avg_events_per_user_per_day = 1.2;
let token = "your-mixpanel-token";

// ── env overrides ──
if (process.env.MP_TOKEN) token = process.env.MP_TOKEN;

import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import "dotenv/config";
import * as u from "../../lib/utils/utils.js";

dayjs.extend(utc);
const chance = u.initChance(SEED);
/** @typedef  {import("../../types").Dungeon} Config */

/**
 * ===================================================================
 * DATASET OVERVIEW
 * ===================================================================
 *
 * NexBank — a Chime/Revolut-style neobank app. Users open accounts
 * (personal or business), transact across 7 merchant categories,
 * send transfers, pay bills, set budgets, invest, apply for loans,
 * and earn tier-scaled rewards.
 *
 * Scale: 5,000 users · 600K events · 100 days · 18 event types
 * Groups: 500 households
 * Tiers: Basic (free) / Plus ($4.99/mo) / Premium ($14.99/mo)
 *
 * Core loop: onboarding → daily banking → financial planning →
 *   budgets & savings → investments → rewards & monetization
 *
 * Funnels:
 *   - Onboarding: account opened → app session → balance checked
 *   - Daily banking: app session → balance checked → transaction
 *   - Transfers: app session → transfer sent → notification opened
 *   - Bill payment: app session → bill paid → notification opened
 *   - Financial planning: budget created → budget alert → savings goal
 *   - Investment: balance checked → investment made → reward redeemed
 *   - Support: support contacted → card locked → dispute filed
 *   - Lending: loan applied → loan approved → premium upgraded
 */

/**
 * ===================================================================
 * ANALYTICS HOOKS (10 hooks)
 * ===================================================================
 *
 * NOTE: All cohort effects are HIDDEN — no flag stamping. Discoverable
 * via behavioral cohorts, raw-prop breakdowns (date, account_tier),
 * or funnel time-to-convert.
 *
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
 * 15th of the month (payday=true). Transfers are 2x larger on the
 * 1st-3rd and 15th-17th (post_payday_spending=true).
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Direct Deposit Size on Paydays
 *   - Report type: Insights
 *   - Event: "transaction completed"
 *   - Measure: Average of "amount"
 *   - Filter: "transaction_type" = "direct_deposit"
 *   - Breakdown: "payday"
 *   - Expected: payday=true ~ 3x baseline deposit size
 *
 *   Report 2: Post-Payday Transfer Spending
 *   - Report type: Insights
 *   - Event: "transfer sent"
 *   - Measure: Average of "amount"
 *   - Breakdown: "post_payday_spending"
 *   - Expected: post_payday_spending=true ~ 2x baseline transfer size
 *
 * REAL-WORLD ANALOGUE: Bi-monthly payroll cycles drive predictable
 * spikes in deposit and outbound spending volume.
 *
 * ---------------------------------------------------------------
 * 3. FRAUD DETECTION (everything)
 *
 * PATTERN: 3% of users experience a fraud burst at the timeline
 * midpoint: 3-5 rapid high-value transactions, then card locked,
 * dispute filed, and support contacted. All affected events are
 * tagged fraud_sequence=true.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Fraud-Affected Transactions
 *   - Report type: Insights
 *   - Event: "transaction completed"
 *   - Measure: Total
 *   - Filter: "fraud_sequence" = true
 *   - Expected: ~3% of users contribute the fraud-tagged transaction cluster
 *
 *   Report 2: Fraud Resolution Funnel
 *   - Report type: Funnels
 *   - Steps: "card locked" -> "dispute filed" -> "support contacted"
 *   - Filter: "fraud_sequence" = true
 *   - Expected: high completion across all three resolution steps
 *
 * REAL-WORLD ANALOGUE: A small but consistent slice of accounts
 * triggers fraud pipelines every cycle, generating the bulk of
 * dispute and support load.
 *
 * ---------------------------------------------------------------
 * 4. LOW BALANCE CHURN (everything)
 *
 * PATTERN: Users with 3+ balance checks under $15K lose 50% of
 * their events after day 30. Surviving events are tagged
 * low_balance_churn=true.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Retention by Low Balance Cohort
 *   - Report type: Retention
 *   - Event A: any event
 *   - Event B: any event
 *   - Breakdown: "low_balance_churn"
 *   - Expected: low_balance_churn=true users churn sharply after day 30
 *
 *   Report 2: Activity Decline Timeline
 *   - Report type: Insights
 *   - Event: any event
 *   - Measure: Total
 *   - Filter: "low_balance_churn" = true
 *   - Line chart by day
 *   - Expected: visible 50% drop in event volume past day 30
 *
 * REAL-WORLD ANALOGUE: Customers running thin balances lose trust
 * in the platform and migrate their primary banking elsewhere.
 *
 * ---------------------------------------------------------------
 * 5. BUDGET USERS SAVE MORE (everything)
 *
 * PATTERN: Users who create a budget get 2x savings contributions,
 * 1.5x investment amounts, and extra savings goal events. All are
 * tagged budget_discipline=true.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Savings Contribution by Budget Discipline
 *   - Report type: Insights
 *   - Event: "savings goal set"
 *   - Measure: Average of "monthly_contribution"
 *   - Breakdown: "budget_discipline"
 *   - Expected: budget_discipline=true ~ $400, false ~ $200 (2x)
 *
 *   Report 2: Investment Size by Budget Discipline
 *   - Report type: Insights
 *   - Event: "investment made"
 *   - Measure: Average of "amount"
 *   - Breakdown: "budget_discipline"
 *   - Expected: budget_discipline=true ~ 1.5x baseline
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
 *   Report 2: Bill Completion Rate
 *   - Report type: Insights
 *   - Event: "bill paid"
 *   - Measure: Total
 *   - Breakdown: "manual_payment"
 *   - Expected: manual_payment=true ~ 70% completion vs 100% for auto-pay
 *
 * REAL-WORLD ANALOGUE: Auto-pay locks users into a frictionless
 * payment cadence that virtually eliminates missed bills.
 *
 * ---------------------------------------------------------------
 * 7. PREMIUM TIER VALUE (event)
 *
 * PATTERN: Premium-tier users get 3x reward values and 2x sell
 * returns on investments. Plus tier gets 1.5x rewards. Affected
 * events are tagged premium_reward / premium_returns.
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
 *   Report 2: Investment Returns for Premium
 *   - Report type: Insights
 *   - Event: "investment made"
 *   - Measure: Average of "amount"
 *   - Filter: "action" = "sell"
 *   - Breakdown: "premium_returns"
 *   - Expected: premium_returns=true ~ 2x baseline sell amount
 *
 * REAL-WORLD ANALOGUE: Premium subscription tiers justify their
 * price by delivering visibly better cashback and investment perks.
 *
 * ---------------------------------------------------------------
 * 8. MONTH-END ANXIETY (everything)
 *
 * PATTERN: On days >= 28 of the month, app sessions run 40% longer
 * (month_end_anxiety=true) and reported balances are 30% lower
 * (month_end_check=true).
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Session Duration at Month End
 *   - Report type: Insights
 *   - Event: "app session"
 *   - Measure: Average of "session_duration_sec"
 *   - Breakdown: "month_end_anxiety"
 *   - Expected: month_end_anxiety=true ~ 84s, false ~ 60s (1.4x)
 *
 *   Report 2: Balance Drop at Month End
 *   - Report type: Insights
 *   - Event: "balance checked"
 *   - Measure: Average of "account_balance"
 *   - Breakdown: "month_end_check"
 *   - Expected: month_end_check=true ~ 0.7x normal balance
 *
 * REAL-WORLD ANALOGUE: Users obsessively check balances at month
 * end as bills hit and runway tightens.
 *
 * ===================================================================
 * ADVANCED ANALYSIS IDEAS
 * ===================================================================
 *
 * Cross-hook patterns:
 *   - Budget + Low Balance: Do budget creators avoid low-balance churn?
 *   - Premium + Auto-Pay: Do premium users adopt auto-pay more?
 *   - Fraud + Churn: Do fraud victims churn more? Does resolution help?
 *   - Payday + Month-End: Do payday spenders run out by month-end?
 *   - Business vs Personal Fraud: Are business accounts more targeted?
 *
 * Cohort analysis:
 *   - By account_tier: upgrade paths, value realization
 *   - By signup_channel: referral retention vs organic
 *   - By income_bracket: feature adoption by income
 *   - By credit_score_range: loan approvals, tier adoption
 *
 * ---------------------------------------------------------------
 * 9. ONBOARDING TIME-TO-CONVERT (funnel-post)
 *
 * PATTERN: Premium tier users complete the Onboarding funnel 1.5x
 * faster (factor 0.67); Basic users 1.33x slower (factor 1.33).
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
 * Onboarding T2C        | median min by tier    | 1x       | 0.67/1.33x| 2x range
 * Txn-Count Magic Num   | sweet investment amt  | 1x       | 1.4x      | 1.4x
 * Txn-Count Magic Num   | over premium upgrades | 1x       | 0.8x      | -20%
 */

/** @type {Config} */
const config = {
	token,
	seed: SEED,
	datasetStart: "2026-01-01T00:00:00Z",
	datasetEnd: "2026-04-28T23:59:59Z",
	// numDays: num_days,
	avgEventsPerUserPerDay: avg_events_per_user_per_day,
	numUsers: num_users,
	hasAnonIds: false,
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
			properties: {
				"account_type": ["personal", "business", "personal"],
				"signup_channel": ["app", "web", "referral", "branch"],
			}
		},
		{
			event: "app session",
			weight: 20,
			properties: {
				"session_duration_sec": u.weighNumRange(10, 600, 0.3, 60),
				"pages_viewed": u.weighNumRange(1, 15, 0.5, 3),
			}
		},
		{
			event: "balance checked",
			weight: 15,
			properties: {
				"account_balance": u.weighNumRange(0, 50000, 0.8, 2500),
				"account_type": ["checking", "savings", "investment"],
			}
		},
		{
			event: "transaction completed",
			weight: 18,
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
			properties: {
				"transfer_type": ["internal", "external", "p2p", "wire"],
				"amount": u.weighNumRange(10, 10000, 0.3, 200),
				"recipient_type": ["friend", "family", "business", "self"],
			}
		},
		{
			event: "bill paid",
			weight: 6,
			properties: {
				"bill_type": ["rent", "utilities", "phone", "insurance", "subscription", "loan_payment"],
				"amount": u.weighNumRange(20, 3000, 0.5, 150),
				"auto_pay": [false, false, false, true, true],
			}
		},
		{
			event: "bill payment missed",
			weight: 1,
			properties: {
				"bill_type": ["rent", "utilities", "phone", "insurance", "subscription", "loan_payment"],
				"amount": u.weighNumRange(20, 3000, 0.5, 150),
			}
		},
		{
			event: "budget created",
			weight: 3,
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
			properties: {
				"goal_type": ["emergency", "vacation", "car", "home", "education", "retirement"],
				"target_amount": u.weighNumRange(500, 50000, 0.3, 5000),
				"monthly_contribution": u.weighNumRange(25, 2000, 0.5, 200),
			}
		},
		{
			event: "investment made",
			weight: 4,
			properties: {
				"investment_type": ["stocks", "etf", "crypto", "bonds", "mutual_fund"],
				"amount": u.weighNumRange(10, 10000, 0.3, 250),
				"action": ["buy", "sell", "buy"],
			}
		},
		{
			event: "card locked",
			weight: 1,
			properties: {
				"reason": ["lost", "stolen", "suspicious_activity", "travel"],
			}
		},
		{
			event: "dispute filed",
			weight: 1,
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
			properties: {
				"old_tier": ["basic", "plus", "premium"],
				"new_tier": ["plus", "premium", "premium"],
				"monthly_fee": [4.99, 9.99, 14.99],
			}
		},
		{
			event: "support contacted",
			weight: 3,
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

	/**
	 * ARCHITECTED ANALYTICS HOOKS
	 *
	 * This hook function creates 8 deliberate patterns in the data:
	 *
	 * 1. PERSONAL VS BUSINESS: Business accounts get employee_count, revenue; personal get age_range, life_stage
	 * 2. PAYDAY PATTERNS: Transactions spike on 1st/15th with bigger deposits and post-payday spending (everything hook — runs after sessionization)
	 * 3. FRAUD DETECTION: 3% of users experience a fraud burst (rapid high-value txns -> card lock -> dispute -> support)
	 * 4. LOW BALANCE CHURN: Users with chronic low balances (<$15K) lose 50% of activity after day 30
	 * 5. BUDGET DISCIPLINE: Budget creators save 2x more and invest 1.5x more
	 * 6. AUTO-PAY LOYALTY: Auto-pay users never miss bills; manual payers miss 30%
	 * 7. PREMIUM TIER VALUE: Premium users get 3x rewards; Plus users get 1.5x; Premium investors get 2x returns
	 * 8. MONTH-END ANXIETY: Last 3 days of month see 40% longer sessions and 30% lower balances (everything hook — runs after sessionization)
	 */
	hook: function (record, type, meta) {
		// HOOK 1: PERSONAL VS BUSINESS ACCOUNTS (user) — role-based attrs.
		if (type === "user") {
			const isBusiness = chance.bool({ likelihood: 20 });
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
		}

		// HOOK 6: AUTO-PAY LOYALTY (event) — manual bill-paid events have
		// 30% chance of becoming "bill payment missed". Mutates event name.
		if (type === "event") {
			if (record.event === "bill paid" && record.auto_pay !== true && chance.bool({ likelihood: 30 })) {
				record.event = "bill payment missed";
			}
		}

		// HOOK 9 (T2C): ONBOARDING TIME-TO-CONVERT (funnel-post)
		// Premium tier completes Onboarding funnel 1.5x faster (factor 0.67);
		// Basic users 1.33x slower (factor 1.33).
		if (type === "funnel-post") {
			const segment = meta?.profile?.account_tier;
			if (Array.isArray(record) && record.length > 1) {
				const factor = (
					segment === "premium" ? 0.67 :
					segment === "basic" ? 1.33 :
					1.0
				);
				if (factor !== 1.0) {
					for (let i = 1; i < record.length; i++) {
						const prev = dayjs(record[i - 1].time);
						const newGap = Math.round(dayjs(record[i].time).diff(prev) * factor);
						record[i].time = prev.add(newGap, "milliseconds").toISOString();
					}
				}
			}
		}

		if (type === "everything") {
			const datasetStart = dayjs.unix(meta.datasetStart);
			const userEvents = record;
			const profile = meta.profile;

			userEvents.forEach(e => {
				e.account_tier = profile.account_tier;
				e.Platform = profile.Platform;
			});

			// HOOK 2: PAYDAY PATTERNS — 1st & 15th: direct_deposit amount 3x.
			// Days 1-3 and 15-17: 60% of transfers get amount 2x. No flag.
			for (const e of userEvents) {
				const dayOfMonth = new Date(e.time).getUTCDate();
				if (e.event === "transaction completed" && e.transaction_type === "direct_deposit") {
					if (dayOfMonth === 1 || dayOfMonth === 15) {
						e.amount = Math.floor((e.amount || 50) * 3);
					}
				}
				if (e.event === "transfer sent") {
					const isPaydayWindow = (dayOfMonth >= 1 && dayOfMonth <= 3) || (dayOfMonth >= 15 && dayOfMonth <= 17);
					if (isPaydayWindow && chance.bool({ likelihood: 60 })) {
						e.amount = Math.floor((e.amount || 200) * 2.0);
					}
				}
			}

			// HOOK 8: MONTH-END ANXIETY — days >= 28: app_session duration
			// 1.4x; balance_checked account_balance 0.7x. Mutates raw props.
			for (const e of userEvents) {
				const dayOfMonth = new Date(e.time).getUTCDate();
				if (dayOfMonth >= 28) {
					if (e.event === "app session") {
						e.session_duration_sec = Math.floor((e.session_duration_sec || 60) * 1.4);
					}
					if (e.event === "balance checked") {
						e.account_balance = Math.floor((e.account_balance || 2500) * 0.7);
					}
				}
			}

			// HOOK 7: PREMIUM TIER VALUE — Premium 3x reward value + 2x
			// investment-sell amount; Plus 1.5x reward value. Reads tier
			// from profile. No flag.
			const tier = profile.account_tier;
			userEvents.forEach(e => {
				if (e.event === "reward redeemed") {
					if (tier === "premium") e.value = Math.floor((e.value || 10) * 3);
					else if (tier === "plus") e.value = Math.floor((e.value || 10) * 1.5);
				}
				if (e.event === "investment made" && e.action === "sell" && tier === "premium") {
					e.amount = Math.floor((e.amount || 250) * 2);
				}
			});

			// HOOK 3: FRAUD DETECTION — 3% of users get fraud burst
			// (3-5 rapid high-value transactions + card locked + dispute +
			// support contacted) at timeline midpoint. No flag — discover
			// via cohort builder on users with card-locked + dispute-filed.
			if (chance.bool({ likelihood: 3 }) && userEvents.length >= 2) {
				const midIdx = Math.floor(userEvents.length / 2);
				const midEvent = userEvents[midIdx];
				const midTime = dayjs(midEvent.time);
				const distinctId = midEvent.user_id;
				const burstCount = chance.integer({ min: 3, max: 5 });
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
							amount: chance.integer({ min: 500, max: 3000 }),
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
					dispute_amount: chance.integer({ min: 500, max: 3000 }),
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

			// HOOK 4: LOW BALANCE CHURN — users with 3+ balance checks
			// under $15K lose 50% of post-day-30 events. No flag.
			const lowBalanceChecks = userEvents.filter(e =>
				e.event === "balance checked" && (e.account_balance || 0) < 15000
			).length;
			if (lowBalanceChecks >= 3) {
				const day30 = datasetStart.add(30, "days");
				for (let i = userEvents.length - 1; i >= 0; i--) {
					if (dayjs(userEvents[i].time).isAfter(day30) && chance.bool({ likelihood: 50 })) {
						userEvents.splice(i, 1);
					}
				}
			}

			// HOOK 5: BUDGET DISCIPLINE — users with any budget-created event
			// get savings 2x, investment amounts 1.5x, and extra cloned
			// savings-goal events. No flag.
			const hasBudget = userEvents.some(e => e.event === "budget created");
			if (hasBudget) {
				userEvents.forEach((event, idx) => {
					const eventTime = dayjs(event.time);
					if (event.event === "savings goal set") {
						event.monthly_contribution = Math.floor((event.monthly_contribution || 200) * 2);
					}
					if (event.event === "investment made") {
						event.amount = Math.floor((event.amount || 250) * 1.5);
					}
					if (event.event === "budget created" && chance.bool({ likelihood: 50 })) {
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

			// HOOK 10: TRANSACTION-COUNT MAGIC NUMBER (no flags)
			// Sweet 6-10 transactions/user → +40% on investment_made amount
			// (engaged transactor compounds wealth). Over 11+ → drop 20% of
			// premium-upgraded events (already engaged; less upgrade pressure).
			const txnCount = userEvents.filter(e => e.event === "transaction completed").length;
			if (txnCount >= 6 && txnCount <= 10) {
				userEvents.forEach(e => {
					if (e.event === "investment made" && typeof e.amount === "number") {
						e.amount = Math.round(e.amount * 1.4);
					}
				});
			} else if (txnCount >= 11) {
				for (let i = userEvents.length - 1; i >= 0; i--) {
					if (userEvents[i].event === "premium upgraded" && chance.bool({ likelihood: 20 })) {
						userEvents.splice(i, 1);
					}
				}
			}
		}

		return record;
	}
};

export default config;
