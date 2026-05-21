// ── IMPORTS ──
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);
import "dotenv/config";
import * as u from "../../lib/utils/utils.js";
/** @typedef {import("../../types").Dungeon} Config */

// ── OVERVIEW ──
/*
 * NAME:       PromptForge
 * APP:        LLM API platform (Anthropic/OpenAI-style). Customers send API
 *             requests for chat completions, embeddings, evaluations, and tool
 *             use. Billing is per input/output token. Features: prompt caching,
 *             tool use, multi-turn conversations, batch API, model selection,
 *             eval pipelines.
 * SCALE:      10,000 users, ~800K events, 121 days (2026-01-01 → 2026-05-01)
 * CORE LOOP:  organization created → api key created → api call → iterate
 *
 * EVENTS (18):
 *   api call (10) > dashboard viewed (5) > tool use call (4) > docs searched (4)
 *   > playground session (4) > eval job (3) > eval result (3) > rate limit error (3)
 *   > model selected (3) > api key created (2) > batch job submitted (2)
 *   > batch job completed (2) > billing payment (2) > member invited (2)
 *   > organization created (1) > api key rotated (1) > webhook configured (1)
 *   > account deactivated (1)
 *
 * FUNNELS (3):
 *   - Onboarding:           organization created → api key created → api call (70%)
 *   - API to Eval Pipeline: api call → tool use call → eval job (45%)
 *   - Usage to Billing:     api call → billing payment (30%)
 *
 * USER PROPS:  api_tier, primary_use_case, sdk_language, monthly_spend, total_api_calls, preferred_model
 * SUPER PROPS: api_tier, primary_use_case, sdk_language
 * SCD PROPS:   monthly_api_usage (weekly fuzzy, max 20), api_tier_history (Free/Build/Enterprise, monthly fixed, max 6)
 * GROUPS:      none
 */

// ── HOOK STORIES ──
/*
 * ---------------------------------------------------------------
 * 1. PROMPT CACHING ADOPTION (CONVERSION — everything)
 * ---------------------------------------------------------------
 *
 * PATTERN: Customers who enable prompt caching see 70% lower
 * cost_per_call. Once any api call has cache_enabled=true, all
 * subsequent calls for that user get cost_usd reduced by 70%.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Cost Per Call by Cache Status
 *   - Report type: Insights
 *   - Event: "api call"
 *   - Measure: Average of "cost_usd"
 *   - Breakdown: "cache_enabled"
 *   - Expected: cache_enabled=true ~ $0.003, false ~ $0.01 (70% cheaper)
 *
 *   Report 2: Cache Adoption Over Time
 *   - Report type: Insights
 *   - Event: "api call"
 *   - Measure: Total
 *   - Filter: cache_enabled = true
 *   - Line chart by week
 *   - Expected: steady growth in cached calls over the dataset
 *
 * REAL-WORLD ANALOGUE: Prompt caching avoids re-processing long
 * system prompts on every call, dramatically reducing cost and latency.
 *
 * ---------------------------------------------------------------
 * 2. MODEL MIGRATION WAVE (TIMED RELEASE — event)
 * ---------------------------------------------------------------
 *
 * PATTERN: At day 60, new model "opus-4-7" releases. After day 60,
 * 35% of api calls from Build/Enterprise users switch model to
 * "opus-4-7". These calls use 1.5x tokens (smarter model, longer
 * responses).
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Model Distribution Over Time
 *   - Report type: Insights
 *   - Event: "api call"
 *   - Measure: Total
 *   - Breakdown: "model"
 *   - Line chart by week
 *   - Expected: opus-4-7 appears at day 60, ramps to ~35% of paid calls
 *
 *   Report 2: Tokens Per Model
 *   - Report type: Insights
 *   - Event: "api call"
 *   - Measure: Average of "tokens_used"
 *   - Breakdown: "model"
 *   - Expected: opus-4-7 ~ 1.5x tokens vs other models
 *
 * REAL-WORLD ANALOGUE: New flagship model launches cause migration
 * waves among power users who want improved capabilities.
 *
 * ---------------------------------------------------------------
 * 3. AGENTIC LOOP POWER USERS (everything)
 * ---------------------------------------------------------------
 *
 * PATTERN: Users with 3+ "tool use call" AND 3+ api-call events with
 * multi_turn=true get 8x tokens_used on api calls plus 2 extra cloned
 * api-call events per existing (3x rate). Cloned events with unique
 * offset timestamps. No flag — discover via cohort builder.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Tokens per User — Agentic Cohort
 *   - Report type: Insights (with cohort)
 *   - Cohort A: users with >= 3 "tool use call" AND >= 3 api-call with multi_turn=true
 *   - Cohort B: rest
 *   - Event: "api call"
 *   - Measure: Average of "tokens_used"
 *   - Expected: A ~ 8x B
 *
 * REAL-WORLD ANALOGUE: Agentic workloads consume dramatically more
 * tokens via extended tool-use loops.
 *
 * ---------------------------------------------------------------
 * 4. RATE LIMIT CHURN (everything)
 * ---------------------------------------------------------------
 *
 * PATTERN: Users with >= 2 "rate limit error" events in first 7 days
 * lose 60% of events after week 1. No flag — discover via cohort.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Retention by Early Rate-Limit Cohort
 *   - Report type: Retention
 *   - Cohort A: users with >= 2 "rate limit error" in first 7 days
 *   - Cohort B: rest
 *   - Expected: A retention ~ 40% vs B ~ 80%
 *
 * REAL-WORLD ANALOGUE: Developers who get rate-limited early often
 * switch to a competitor.
 *
 * ---------------------------------------------------------------
 * 5. TIER-BASED CONTEXT WINDOW (SUBSCRIPTION TIER — everything)
 * ---------------------------------------------------------------
 *
 * PATTERN: Free users have context_window=200000, Build=1000000,
 * Enterprise=2000000. Enterprise users send 4x larger input_tokens.
 * Context window and input tokens are scaled by tier.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Input Tokens by Tier
 *   - Report type: Insights
 *   - Event: "api call"
 *   - Measure: Average of "input_tokens"
 *   - Breakdown: "api_tier" (superProp)
 *   - Expected: Enterprise ~ 4x Free (Enterprise ~ 8K, Free ~ 2K)
 *
 *   Report 2: Context Window by Tier
 *   - Report type: Insights
 *   - Event: "api call"
 *   - Measure: Average of "context_window"
 *   - Breakdown: "api_tier"
 *   - Expected: Free=200K, Build=1M, Enterprise=2M
 *
 * REAL-WORLD ANALOGUE: Enterprise customers pay for larger context
 * windows and use them for long-document analysis and code review.
 *
 * ---------------------------------------------------------------
 * 6. OUTAGE DAY (TIME-BASED — event)
 * ---------------------------------------------------------------
 *
 * PATTERN: Days 40-41, is_error is set to true on 40% of api call
 * events. error_type is set to service errors. Simulates a major
 * platform outage.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Error Rate Over Time
 *   - Report type: Insights
 *   - Event: "api call"
 *   - Measure: Total
 *   - Filter: is_error = true
 *   - Line chart by day
 *   - Expected: massive spike on days 40-41 (8x baseline error rate)
 *
 *   Report 2: Error Types During Outage
 *   - Report type: Insights
 *   - Event: "api call"
 *   - Filter: is_error = true
 *   - Breakdown: "error_type"
 *   - Date range: days 40-41
 *   - Expected: service_overloaded and internal_server_error dominate
 *
 * REAL-WORLD ANALOGUE: API platforms experience periodic outages
 * that spike error rates across all customers.
 *
 * ---------------------------------------------------------------
 * 7. BATCH API DISCOUNT (everything)
 * ---------------------------------------------------------------
 *
 * PATTERN: Users with any "batch job submitted" event get 50% lower
 * cost_per_token on api calls + 2x tokens_used. Mutates raw props.
 * No flag — discover via cohort builder.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Cost per Token by Batch Cohort
 *   - Report type: Insights (with cohort)
 *   - Cohort A: users with >= 1 "batch job submitted"
 *   - Cohort B: rest
 *   - Event: "api call"
 *   - Measure: Average of "cost_per_token"
 *   - Expected: A ~ 0.5x B
 *
 * REAL-WORLD ANALOGUE: Batch API pricing rewards high-volume workloads.
 *
 * ---------------------------------------------------------------
 * 8. EVAL-DRIVEN RETENTION (everything)
 * ---------------------------------------------------------------
 *
 * PATTERN: Users with any "eval job" in first 7 days keep all events.
 * Non-eval users lose 75% of post-day-30 events. No flag — discover
 * via retention cohort.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Retention by Early Eval Cohort
 *   - Report type: Retention
 *   - Cohort A: users with >= 1 "eval job" in first 7 days
 *   - Cohort B: rest
 *   - Expected: A ~ 75% D30 vs B ~ 25%
 *
 * REAL-WORLD ANALOGUE: Teams that set up eval pipelines stick around.
 *
 * ---------------------------------------------------------------
 * 9. API-TO-EVAL TIME-TO-CONVERT (funnel-post)
 * ---------------------------------------------------------------
 *
 * PATTERN: Enterprise users complete the "API to Eval Pipeline" funnel
 * 1.5x faster than baseline (factor 0.67 on inter-event gaps); Free
 * users 1.4x slower (factor 1.4). Mutates funnel event timestamps.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: API to Eval — Median Time-to-Convert by Tier
 *   - Report type: Funnels
 *   - Steps: "api call" -> "tool use call" -> "eval job"
 *   - Measure: Median time to convert
 *   - Breakdown: "api_tier"
 *   - Expected: Enterprise ~ 0.67x Build; Free ~ 1.4x Build
 *
 *   NOTE (funnel-post measurement): visible only via Mixpanel funnel
 *   median TTC. Cross-event MIN→MIN SQL queries on raw events do NOT
 *   show this — funnel-post adjusts gaps within funnel instances, not
 *   across the user's full event history.
 *
 * REAL-WORLD ANALOGUE: Enterprise teams have dedicated platform engineers
 * who execute end-to-end pipelines faster.
 *
 * ---------------------------------------------------------------
 * 10. DOCS-SEARCHED MAGIC NUMBER (in-funnel, everything)
 * ---------------------------------------------------------------
 *
 * PATTERN: Count "docs searched" events between organization-created and
 * first billing-payment. Sweet 2-4 → +35% on amount_usd of billing
 * payment events. Over 5+ → drop 30% of billing payment events. No flag.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Avg Billing Amount by Docs-Searched Bucket
 *   - Report type: Insights (with cohort)
 *   - Cohort A: users with 2-4 "docs searched" between sign-up and first billing
 *   - Cohort B: users with 0-1
 *   - Event: "billing payment"
 *   - Measure: Average of "amount_usd"
 *   - Expected: A ~ 1.35x B
 *
 *   Report 2: Billing Payments per User on Heavy Searchers
 *   - Report type: Insights (with cohort)
 *   - Cohort C: users with >= 5 "docs searched" between sign-up and billing
 *   - Cohort A: users with 2-4
 *   - Event: "billing payment"
 *   - Measure: Total per user
 *   - Expected: C ~ 30% fewer billing payments per user
 *
 * REAL-WORLD ANALOGUE: Reading the docs lifts willingness to pay; doc
 * obsession signals stuck on integration and never paying.
 *
 * ===============================================================
 * EXPECTED METRICS SUMMARY
 * ===============================================================
 *
 * Hook                        | Metric              | Baseline   | Effect       | Ratio
 * ----------------------------|----------------------|------------|--------------|------
 * Prompt Caching Adoption     | cost_usd             | $0.01      | $0.003       | 0.3x
 * Model Migration Wave        | opus-4-7 share paid  | 0%         | ~ 35%        | new
 * Agentic Loop Power Users    | tokens/api-call      | 1x         | 8x           | 8x
 * Rate Limit Churn            | D30 retention        | 80%        | 40%          | 0.5x
 * Tier-Based Context Window   | input_tokens         | 2K (Free)  | 8K (Ent)     | 4x
 * Outage Day                  | error rate days 40-41| 5%         | 40%          | 8x
 * Batch API Discount          | cost_per_token       | 1x         | 0.5x         | -50%
 * Eval-Driven Retention       | D30 retention        | 25%        | 75%          | 3x
 * API-to-Eval T2C             | median min by tier   | 1x (Build) | 0.67x / 1.4x | 1.5x range
 * Docs Magic Number           | sweet billing amount | 1x         | 1.35x        | 1.35x
 * Docs Magic Number           | over billing/user    | 1x         | 0.7x         | -30%
 */

// ── SCALE ──
const SEED = "promptforge";
const NUM_USERS = 10_000;
const DATASET_START = "2026-01-01T00:00:00Z";
const DATASET_END = "2026-05-01T23:59:59Z";
const EVENTS_PER_DAY = 0.83;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── KNOBS (tweak these to reshape stories) ──
const OUTAGE_START_DAY = 40;
const OUTAGE_END_DAY = 42;
const OUTAGE_ERROR_LIKELIHOOD = 40;
const OUTAGE_LATENCY_MULT = 3;

const TIER_CONTEXT_WINDOW = { Free: 200000, Build: 1000000, Enterprise: 2000000 };
const TIER_INPUT_MULT = { Free: 1, Build: 2, Enterprise: 4 };

const CACHE_USER_HASH_MOD = 4;
const CACHE_COST_FACTOR = 0.3;
const CACHE_ACTIVATION_PCT = 0.2;

const MODEL_MIGRATION_DAY = 60;
const MODEL_MIGRATION_LIKELIHOOD = 35;
const MODEL_MIGRATION_TOKEN_MULT = 1.5;

const AGENTIC_TOOL_THRESHOLD = 3;
const AGENTIC_MULTITURN_THRESHOLD = 3;
const AGENTIC_TOKEN_MULT = 8;
const AGENTIC_CLONE_MULT = 2;

const RATE_LIMIT_THRESHOLD = 2;
const RATE_LIMIT_KEEP_LIKELIHOOD = 40;

const BATCH_COST_FACTOR = 0.5;
const BATCH_TOKEN_MULT = 2;

const EVAL_NON_USER_KEEP_LIKELIHOOD = 25;
const EVAL_CUTOFF_DAYS = 30;

const DOCS_SWEET_MIN = 2;
const DOCS_SWEET_MAX = 4;
const DOCS_OVER_THRESHOLD = 5;
const DOCS_BILLING_BOOST = 1.35;
const DOCS_BILLING_DROP_LIKELIHOOD = 30;

const FUNNEL_TTC_ENTERPRISE = 0.67;
const FUNNEL_TTC_FREE = 1.4;

// ── HELPER FUNCTIONS ──
function handleFunnelPostHooks(record, meta) {
	// H9: API-to-Eval TTC scaled by tier
	const segment = meta?.profile?.api_tier;
	if (Array.isArray(record) && record.length > 1) {
		const factor = (
			segment === "Enterprise" ? FUNNEL_TTC_ENTERPRISE :
			segment === "Free" ? FUNNEL_TTC_FREE :
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
	return record;
}

function handleEverythingHooks(record, meta) {
	const datasetStart = dayjs.unix(meta.datasetStart);
	let events = record;
	if (!events.length) return record;
	const profile = meta && meta.profile ? meta.profile : {};

	events.forEach(e => {
		if (profile.api_tier) e.api_tier = profile.api_tier;
		if (profile.primary_use_case) e.primary_use_case = profile.primary_use_case;
		if (profile.sdk_language) e.sdk_language = profile.sdk_language;
	});

	// H6: Outage day (days 40-41) — 40% of api calls flipped to errors
	events.forEach(e => {
		if (e.event !== "api call") return;
		const dayInDataset = dayjs(e.time).diff(datasetStart, "days", true);
		if (dayInDataset >= OUTAGE_START_DAY && dayInDataset < OUTAGE_END_DAY) {
			if (chance.bool({ likelihood: OUTAGE_ERROR_LIKELIHOOD })) {
				e.is_error = true;
				e.error_type = chance.pickone(["service_overloaded", "internal_server_error", "gateway_timeout"]);
				e.latency_ms = Math.floor((e.latency_ms || 1500) * OUTAGE_LATENCY_MULT);
			}
		}
	});

	const sortedByTime = [...events].sort((a, b) => dayjs(a.time).valueOf() - dayjs(b.time).valueOf());
	const firstEventTime = sortedByTime.length > 0 ? dayjs(sortedByTime[0].time) : datasetStart;

	// H5: Tier-based context window & input tokens
	const tier = profile.api_tier || "Free";
	const contextWindow = TIER_CONTEXT_WINDOW[tier] ?? TIER_CONTEXT_WINDOW.Free;
	const inputMultiplier = TIER_INPUT_MULT[tier] ?? TIER_INPUT_MULT.Free;
	events.forEach(e => {
		if (e.event === "api call") {
			e.context_window = contextWindow;
			e.input_tokens = Math.floor((e.input_tokens || 2000) * inputMultiplier);
		}
	});

	// H1: Prompt caching adoption — ~25% of users; activates 20% into stream
	const userId = events[0] && events[0].user_id;
	const idHash = String(userId || "").split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
	const isCacheUser = (idHash % CACHE_USER_HASH_MOD) === 0;
	if (isCacheUser) {
		let cacheActivated = false;
		const activationPoint = Math.floor(events.length * CACHE_ACTIVATION_PCT);
		events.forEach((e, idx) => {
			if (e.event === "api call") {
				if (idx >= activationPoint) cacheActivated = true;
				if (cacheActivated) {
					e.cache_enabled = true;
					e.cost_usd = Math.round((e.cost_usd || 0.01) * CACHE_COST_FACTOR * 10000) / 10000;
				}
			}
		});
	}

	// H2: Model migration wave — post-day-60 Build/Enterprise calls migrate to opus-4-7
	const migrationCutoff = datasetStart.add(MODEL_MIGRATION_DAY, "days");
	if (tier === "Build" || tier === "Enterprise") {
		events.forEach(e => {
			if (e.event === "api call" && dayjs(e.time).isAfter(migrationCutoff)) {
				if (chance.bool({ likelihood: MODEL_MIGRATION_LIKELIHOOD })) {
					e.model = "opus-4-7";
					e.tokens_used = Math.floor((e.tokens_used || 2500) * MODEL_MIGRATION_TOKEN_MULT);
				}
			}
		});
	}

	// H3: Agentic loop power users — 3+ tool calls + 3+ multi_turn → 8x tokens, 3x events
	const toolUseCount = events.filter(e => e.event === "tool use call").length;
	const multiTurnCount = events.filter(e => e.event === "api call" && e.multi_turn === true).length;
	const isAgenticUser = toolUseCount >= AGENTIC_TOOL_THRESHOLD && multiTurnCount >= AGENTIC_MULTITURN_THRESHOLD;
	if (isAgenticUser) {
		events.forEach(e => {
			if (e.event === "api call") {
				e.tokens_used = Math.floor((e.tokens_used || 2500) * AGENTIC_TOKEN_MULT);
			}
		});
		const apiCalls = events.filter(e => e.event === "api call");
		const extraCount = apiCalls.length * AGENTIC_CLONE_MULT;
		for (let i = 0; i < extraCount; i++) {
			const template = apiCalls[i % apiCalls.length];
			if (template) {
				events.push({
					...template,
					time: dayjs(template.time).add(chance.integer({ min: 1, max: 120 }), "minutes").toISOString(),
					user_id: template.user_id,
					multi_turn: true,
				});
			}
		}
	}

	// H4: Rate-limit churn — 2+ early rate-limit errors → drop 60% of post-week-1 events
	const firstWeekEnd = firstEventTime.add(7, "days");
	const earlyRateLimits = events.filter(e =>
		e.event === "rate limit error" && dayjs(e.time).isBefore(firstWeekEnd)
	).length;
	if (earlyRateLimits >= RATE_LIMIT_THRESHOLD) {
		events = events.filter(e => {
			if (dayjs(e.time).isAfter(firstWeekEnd)) {
				return chance.bool({ likelihood: RATE_LIMIT_KEEP_LIKELIHOOD });
			}
			return true;
		});
	}

	// H7: Batch API discount — any batch job submitted → 50% cost, 2x tokens
	const isBatchUser = events.some(e => e.event === "batch job submitted");
	if (isBatchUser) {
		events.forEach(e => {
			if (e.event === "api call") {
				e.cost_per_token = Math.round((e.cost_per_token || 0.00001) * BATCH_COST_FACTOR * 10000000) / 10000000;
				e.tokens_used = Math.floor((e.tokens_used || 2500) * BATCH_TOKEN_MULT);
			}
		});
	}

	// H8: Eval-driven retention — non-eval users lose 75% post-day-30
	const hasEarlyEval = events.some(e =>
		e.event === "eval job" && dayjs(e.time).isBefore(firstWeekEnd)
	);
	if (!hasEarlyEval) {
		const cutoff = firstEventTime.add(EVAL_CUTOFF_DAYS, "days");
		events = events.filter(e => {
			if (dayjs(e.time).isAfter(cutoff)) {
				return chance.bool({ likelihood: EVAL_NON_USER_KEEP_LIKELIHOOD });
			}
			return true;
		});
	}

	// H10: Docs-searched magic number — count between org-created and first billing
	const orgEvent = events.find(e => e.event === "organization created");
	const firstBilling = events.find(e => e.event === "billing payment");
	if (orgEvent && firstBilling) {
		const aTime = dayjs(orgEvent.time);
		const bTime = dayjs(firstBilling.time);
		const docsBetween = events.filter(e =>
			e.event === "docs searched" &&
			dayjs(e.time).isAfter(aTime) &&
			dayjs(e.time).isBefore(bTime)
		).length;
		if (docsBetween >= DOCS_SWEET_MIN && docsBetween <= DOCS_SWEET_MAX) {
			events.forEach(e => {
				if (e.event === "billing payment" && typeof e.amount_usd === "number") {
					e.amount_usd = Math.round(e.amount_usd * DOCS_BILLING_BOOST);
				}
			});
		} else if (docsBetween >= DOCS_OVER_THRESHOLD) {
			for (let i = events.length - 1; i >= 0; i--) {
				if (events[i].event === "billing payment" && chance.bool({ likelihood: DOCS_BILLING_DROP_LIKELIHOOD })) {
					events.splice(i, 1);
				}
			}
		}
	}

	return events;
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
	hasAndroidDevices: false,
	hasIOSDevices: false,
	hasDesktopDevices: true,
	hasBrowser: true,
	hasCampaigns: false,
	isAnonymous: false,
	hasAdSpend: false,
	hasAvatar: true,
	concurrency: 1,
	writeToDisk: false,
	soup: "growth",
	scdProps: {
		monthly_api_usage: {
			values: u.weighNumRange(0, 1000000, 0.3, 50),
			frequency: "week",
			timing: "fuzzy",
			max: 20,
		},
		api_tier_history: {
			values: ["Free", "Build", "Enterprise"],
			frequency: "month",
			timing: "fixed",
			max: 6,
		},
	},
	events: [
		{
			event: "organization created",
			weight: 1,
			isFirstEvent: true,
			isAuthEvent: true,
			properties: {
				org_size: ["solo", "startup", "growth", "enterprise"],
				referral_source: ["docs", "blog", "github", "word_of_mouth", "search", "conference"],
			},
		},
		{
			event: "api key created",
			weight: 2,
			properties: {
				key_type: ["development", "production", "staging"],
				key_scope: ["full_access", "read_only", "completions_only"],
			},
		},
		{
			event: "api key rotated",
			weight: 1,
			properties: {
				rotation_reason: ["scheduled", "compromised", "policy", "manual"],
			},
		},
		{
			event: "api call",
			weight: 10,
			isStrictEvent: false,
			properties: {
				model: ["sonnet-4", "sonnet-4", "sonnet-4", "haiku-4", "haiku-4", "opus-4-6"],
				input_tokens: u.weighNumRange(50, 8000, 0.4, 2000),
				output_tokens: u.weighNumRange(10, 4000, 0.4, 500),
				tokens_used: u.weighNumRange(100, 12000, 0.4, 2500),
				cost_usd: [0.001, 0.002, 0.003, 0.003, 0.005, 0.005, 0.005, 0.008, 0.008, 0.01, 0.01, 0.01, 0.01, 0.015, 0.015, 0.02, 0.025, 0.03, 0.04, 0.05],
				cost_per_token: [0.000002, 0.000003, 0.000005, 0.000005, 0.000008, 0.000008, 0.00001, 0.00001, 0.00001, 0.000012, 0.000015, 0.00002, 0.000025, 0.00003],
				latency_ms: u.weighNumRange(100, 15000, 0.4, 1500),
				cache_enabled: [false],
				is_error: [false],
				error_type: ["none"],
				multi_turn: [false, false, false, true],
				context_window: [200000],
				stream: [true, true, true, false],
				stop_reason: ["end_turn", "end_turn", "end_turn", "max_tokens", "tool_use"],
			},
		},
		{
			event: "tool use call",
			weight: 4,
			isStrictEvent: false,
			properties: {
				tool_name: ["web_search", "code_interpreter", "file_reader", "calculator", "database_query", "api_connector"],
				execution_time_ms: u.weighNumRange(50, 10000, 0.4, 800),
				success: [true, true, true, true, false],
				tool_input_tokens: u.weighNumRange(50, 2000, 0.4, 300),
				tool_output_tokens: u.weighNumRange(20, 5000, 0.4, 500),
			},
		},
		{
			event: "batch job submitted",
			weight: 2,
			properties: {
				batch_size: u.weighNumRange(10, 10000, 0.3, 500),
				model: ["sonnet-4", "haiku-4", "opus-4-6"],
				estimated_tokens: u.weighNumRange(10000, 5000000, 0.3, 500000),
				priority: ["standard", "standard", "standard", "express"],
			},
		},
		{
			event: "batch job completed",
			weight: 2,
			properties: {
				batch_size: u.weighNumRange(10, 10000, 0.3, 500),
				processing_time_sec: u.weighNumRange(60, 7200, 0.4, 900),
				total_tokens: u.weighNumRange(10000, 5000000, 0.3, 500000),
				success_rate: u.weighNumRange(90, 100, 0.8, 98),
			},
		},
		{
			event: "eval job",
			weight: 3,
			isStrictEvent: false,
			properties: {
				eval_type: ["accuracy", "relevance", "safety", "latency", "cost", "custom"],
				num_test_cases: u.weighNumRange(10, 1000, 0.3, 100),
				model: ["sonnet-4", "haiku-4", "opus-4-6"],
				dataset_name: ["prod_prompts", "safety_suite", "regression_set", "benchmark_v2", "custom_eval"],
			},
		},
		{
			event: "eval result",
			weight: 3,
			properties: {
				eval_type: ["accuracy", "relevance", "safety", "latency", "cost", "custom"],
				score: u.weighNumRange(0, 100, 0.6, 75),
				pass_rate: u.weighNumRange(50, 100, 0.7, 85),
				model: ["sonnet-4", "haiku-4", "opus-4-6"],
				regression_detected: [false, false, false, false, true],
			},
		},
		{
			event: "rate limit error",
			weight: 3,
			properties: {
				error_code: [429],
				retry_after_ms: u.weighNumRange(1000, 60000, 0.3, 5000),
				requests_per_minute: u.weighNumRange(50, 2000, 0.4, 500),
				tier_limit: ["Free", "Build", "Enterprise"],
			},
		},
		{
			event: "billing payment",
			weight: 2,
			isStrictEvent: false,
			properties: {
				amount_usd: u.weighNumRange(5, 50000, 0.2, 500),
				payment_method: ["credit_card", "credit_card", "credit_card", "invoice", "wire_transfer"],
				billing_period: ["monthly", "monthly", "annual"],
				tokens_consumed: u.weighNumRange(100000, 50000000, 0.3, 5000000),
			},
		},
		{
			event: "model selected",
			weight: 3,
			properties: {
				model: ["sonnet-4", "sonnet-4", "haiku-4", "opus-4-6"],
				is_default: [true, true, false],
				selection_context: ["playground", "api_config", "eval_setup", "batch_config"],
			},
		},
		{
			event: "dashboard viewed",
			weight: 5,
			properties: {
				dashboard_section: ["usage", "billing", "api_keys", "models", "evals", "logs"],
				time_range: ["1h", "24h", "7d", "30d"],
			},
		},
		{
			event: "docs searched",
			weight: 4,
			properties: {
				search_query_category: ["api_reference", "quickstart", "pricing", "models", "tool_use", "batch_api", "caching", "errors"],
				results_found: u.weighNumRange(0, 50, 0.5, 8),
				clicked_result: [true, true, true, false],
			},
		},
		{
			event: "member invited",
			weight: 2,
			properties: {
				invite_role: ["admin", "developer", "developer", "billing", "viewer"],
				invite_method: ["email", "email", "sso", "link"],
			},
		},
		{
			event: "webhook configured",
			weight: 1,
			properties: {
				webhook_event: ["usage_alert", "rate_limit", "batch_complete", "eval_complete", "billing_threshold"],
				delivery_method: ["https", "https", "slack", "email"],
			},
		},
		{
			event: "playground session",
			weight: 4,
			properties: {
				model: ["sonnet-4", "sonnet-4", "haiku-4", "opus-4-6"],
				turns: u.weighNumRange(1, 30, 0.4, 5),
				shared: [false, false, false, true],
				tokens_used: u.weighNumRange(100, 20000, 0.3, 3000),
			},
		},
		{
			event: "account deactivated",
			weight: 1,
			isChurnEvent: true,
			returnLikelihood: 0.1,
			isStrictEvent: true,
			properties: {
				reason: ["cost", "switched_provider", "project_ended", "rate_limits", "no_longer_needed", "performance"],
			},
		},
	],
	funnels: [
		{
			name: "Onboarding",
			sequence: ["organization created", "api key created", "api call"],
			conversionRate: 70,
			order: "sequential",
			isFirstFunnel: true,
			timeToConvert: 48,
			weight: 3,
		},
		{
			name: "API to Eval Pipeline",
			sequence: ["api call", "tool use call", "eval job"],
			conversionRate: 45,
			order: "sequential",
			timeToConvert: 168,
			weight: 5,
		},
		{
			name: "Usage to Billing",
			sequence: ["api call", "billing payment"],
			conversionRate: 30,
			order: "sequential",
			timeToConvert: 336,
			weight: 2,
		},
	],
	superProps: {
		api_tier: ["Free", "Free", "Build", "Build", "Enterprise"],
		primary_use_case: ["chatbot", "code_generation", "data_extraction", "content_creation", "agents"],
		sdk_language: ["python", "typescript", "java", "go", "curl"],
	},
	userProps: {
		api_tier: ["Free", "Free", "Build", "Build", "Enterprise"],
		primary_use_case: ["chatbot", "code_generation", "data_extraction", "content_creation", "agents"],
		sdk_language: ["python", "typescript", "java", "go", "curl"],
		monthly_spend: u.weighNumRange(0, 50000, 0.2, 200),
		total_api_calls: u.weighNumRange(0, 500000, 0.2, 10000),
		preferred_model: ["sonnet-4", "sonnet-4", "haiku-4", "opus-4-6"],
	},
	hook(record, type, meta) {
		if (type === "funnel-post") return handleFunnelPostHooks(record, meta);
		if (type === "everything") return handleEverythingHooks(record, meta);
		return record;
	},
};

export default config;
