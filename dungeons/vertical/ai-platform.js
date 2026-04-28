// ── TWEAK THESE ──
const SEED = "promptforge";
const num_days = 120;
const num_users = 8_000;
const avg_events_per_user_per_day = 0.83;
let token = "your-mixpanel-token";

// ── env overrides ──
if (process.env.MP_TOKEN) token = process.env.MP_TOKEN;

import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import "dotenv/config";
import * as u from "../../lib/utils/utils.js";
import * as v from "ak-tools";

dayjs.extend(utc);
const chance = u.initChance(SEED);
const NOW = dayjs();
const DATASET_START = NOW.subtract(num_days, "days");

/** @typedef  {import("../../types").Dungeon} Config */

/**
 * ===============================================================
 * DATASET OVERVIEW
 * ===============================================================
 *
 * PromptForge -- an LLM API platform (like Anthropic/OpenAI).
 * Customers (developers and companies) send API requests for chat
 * completions, embeddings, evaluations, and tool use. Billing is
 * per input/output token. Key features: prompt caching, tool use,
 * multi-turn conversations, batch API, model selection, and
 * evaluation pipelines.
 *
 * - 8,000 users over 120 days, ~800K events
 * - Three API tiers: Free, Build, Enterprise
 * - Core loop: org created -> api key created -> api call -> iterate
 * - Revenue: token-based billing with tier-based pricing
 *
 * Key entities:
 * - model: LLM model version (sonnet-4, haiku-4, opus-4-6, opus-4-7)
 * - api_tier: Free / Build / Enterprise (determines context window, rate limits)
 * - tokens_used: total tokens consumed per API call (input + output)
 * - cost_usd: dollar cost of a single API call
 * - cache_enabled: prompt caching flag that reduces cost 70%
 * - multi_turn: whether the call is part of a conversation
 *
 * ===============================================================
 * ANALYTICS HOOKS (8 hooks)
 * ===============================================================
 *
 * ---------------------------------------------------------------
 * 1. PROMPT CACHING ADOPTION (CONVERSION — event + everything)
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
 * 3. AGENTIC LOOP POWER USERS (BEHAVIORS TOGETHER — everything)
 * ---------------------------------------------------------------
 *
 * PATTERN: Users who use both "tool use call" AND have multi_turn=true
 * on any api call are agentic loop users. They get 8x tokens_used on
 * all api calls and 3x extra api call events injected.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Token Usage — Agentic vs Standard
 *   - Report type: Insights
 *   - Event: "api call"
 *   - Measure: Average of "tokens_used"
 *   - Breakdown: "is_agentic_user"
 *   - Expected: is_agentic_user=true ~ 8x tokens (agentic ~ 40K, standard ~ 5K)
 *
 *   Report 2: API Call Volume — Agentic vs Standard
 *   - Report type: Insights
 *   - Event: "api call"
 *   - Measure: Total per user (average)
 *   - Breakdown: "is_agentic_user"
 *   - Expected: agentic users ~ 3x more api calls
 *
 * REAL-WORLD ANALOGUE: Agentic workloads (coding agents, research
 * assistants) consume dramatically more tokens via extended tool-use
 * loops and multi-turn conversations.
 *
 * ---------------------------------------------------------------
 * 4. RATE LIMIT CHURN (CHURN — everything)
 * ---------------------------------------------------------------
 *
 * PATTERN: Users hitting "rate limit error" >= 5 times in first
 * 7 days lose 60% of events after week 1. Rate-limited users
 * churn from frustration.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Retention by Early Rate Limiting
 *   - Report type: Retention
 *   - Event A: any event
 *   - Event B: any event
 *   - Breakdown: "hit_rate_limit_early" (user property)
 *   - Expected: hit_rate_limit_early=true ~ 40% D30 retention
 *     vs ~80% for others
 *
 *   Report 2: Event Volume Post Rate-Limit
 *   - Report type: Insights
 *   - Event: any event
 *   - Measure: Total per user (average)
 *   - Breakdown: "hit_rate_limit_early"
 *   - Expected: rate-limited users ~ 40% of normal volume
 *
 * REAL-WORLD ANALOGUE: Developers who get rate-limited early in
 * their evaluation often switch to a competitor platform.
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
 * 7. BATCH API DISCOUNT (PURCHASE VALUE — everything)
 * ---------------------------------------------------------------
 *
 * PATTERN: Users who submit batch jobs get 50% lower cost_per_token
 * on api calls but use 2x tokens_used. Batch processing is cheaper
 * per token but encourages higher volume.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Cost Per Token — Batch vs Interactive
 *   - Report type: Insights
 *   - Event: "api call"
 *   - Measure: Average of "cost_per_token"
 *   - Breakdown: "is_batch_user"
 *   - Expected: is_batch_user=true ~ 50% lower cost per token
 *
 *   Report 2: Token Volume — Batch Users
 *   - Report type: Insights
 *   - Event: "api call"
 *   - Measure: Average of "tokens_used"
 *   - Breakdown: "is_batch_user"
 *   - Expected: batch users ~ 2x token volume
 *
 * REAL-WORLD ANALOGUE: Batch API pricing incentivizes high-volume
 * workloads with discounted per-token rates.
 *
 * ---------------------------------------------------------------
 * 8. EVAL-DRIVEN RETENTION (RETENTION — everything)
 * ---------------------------------------------------------------
 *
 * PATTERN: Users who run "eval job" in the first 7 days have 75%
 * D30 retention vs 25% for non-eval users. Early eval adoption
 * indicates serious platform investment.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Retention by Early Eval Usage
 *   - Report type: Retention
 *   - Event A: any event
 *   - Event B: any event
 *   - Breakdown: "has_early_eval" (user property)
 *   - Expected: has_early_eval=true ~ 75% D30 vs 25% for false
 *
 *   Report 2: Event Volume Over Time
 *   - Report type: Insights
 *   - Event: any event
 *   - Measure: Total per user (average)
 *   - Breakdown: "has_early_eval"
 *   - Line chart by week
 *   - Expected: early eval users sustain volume; non-eval users decay
 *
 * REAL-WORLD ANALOGUE: Teams that set up evaluation pipelines early
 * are deeply invested in prompt quality and stick with the platform.
 *
 * ===============================================================
 * EXPECTED METRICS SUMMARY
 * ===============================================================
 *
 * Hook                        | Metric              | Baseline   | Effect       | Ratio
 * ----------------------------|----------------------|------------|--------------|------
 * Prompt Caching Adoption     | cost_usd             | $0.01      | $0.003       | 0.3x
 * Model Migration Wave        | opus-4-7 share       | 0%         | ~35% (paid)  | new
 * Agentic Loop Power Users    | tokens_used          | 5K         | 40K          | 8x
 * Rate Limit Churn            | D30 retention        | 80%        | 40%          | 0.5x
 * Tier-Based Context Window   | input_tokens         | 2K (Free)  | 8K (Ent)     | 4x
 * Outage Day                  | error rate           | 5%         | 40%          | 8x
 * Batch API Discount          | cost_per_token       | $0.00001   | $0.000005    | 0.5x
 * Eval-Driven Retention       | D30 retention        | 25%        | 75%          | 3x
 */

/** @type {Config} */
const config = {
	token,
	seed: SEED,
	numDays: num_days,
	avgEventsPerUserPerDay: avg_events_per_user_per_day,
	numUsers: num_users,
	hasAnonIds: false,
	hasSessionIds: false,
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

	// -- Events (18) ------------------------------------------
	events: [
		{
			event: "organization created",
			weight: 1,
			isFirstEvent: true,
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
				is_agentic_user: [false],
				is_batch_user: [false],
				stream: [true, true, true, false],
				stop_reason: ["end_turn", "end_turn", "end_turn", "max_tokens", "tool_use"],
			},
		},
		{
			event: "tool use call",
			weight: 4,
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

	// -- Funnels (3) ------------------------------------------
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

	// -- SuperProps --------------------------------------------
	superProps: {
		api_tier: ["Free", "Free", "Build", "Build", "Enterprise"],
		primary_use_case: ["chatbot", "code_generation", "data_extraction", "content_creation", "agents"],
		sdk_language: ["python", "typescript", "java", "go", "curl"],
	},

	// -- UserProps ---------------------------------------------
	userProps: {
		api_tier: ["Free", "Free", "Build", "Build", "Enterprise"],
		primary_use_case: ["chatbot", "code_generation", "data_extraction", "content_creation", "agents"],
		sdk_language: ["python", "typescript", "java", "go", "curl"],
		monthly_spend: u.weighNumRange(0, 50000, 0.2, 200),
		total_api_calls: u.weighNumRange(0, 500000, 0.2, 10000),
		preferred_model: ["sonnet-4", "sonnet-4", "haiku-4", "opus-4-6"],
		has_eval_pipeline: [false],
		hit_rate_limit_early: [false],
		has_early_eval: [false],
	},

	// -- Hook Function ----------------------------------------
	hook: function (record, type, meta) {
		// ─────────────────────────────────────────────────────────
		// Hook #6: OUTAGE DAY (event)
		// Days 40-41: 40% of api calls get is_error=true with
		// service error types
		// ─────────────────────────────────────────────────────────
		if (type === "event") {
			if (record.event === "api call") {
				const eventTime = dayjs(record.time);
				const dayInDataset = eventTime.diff(DATASET_START, "days", true);

				// Hook #6: Outage day errors
				if (dayInDataset >= 40 && dayInDataset < 42) {
					if (chance.bool({ likelihood: 40 })) {
						record.is_error = true;
						record.error_type = chance.pickone([
							"service_overloaded",
							"internal_server_error",
							"gateway_timeout",
						]);
						record.latency_ms = Math.floor((record.latency_ms || 1500) * 3);
					}
				}

				// Hook #2: Model migration wave (event portion)
				// After day 60, 35% of Build/Enterprise users switch to opus-4-7
				if (dayInDataset >= 60) {
					if (
						(record.api_tier === "Build" || record.api_tier === "Enterprise") &&
						chance.bool({ likelihood: 35 })
					) {
						record.model = "opus-4-7";
					}
				}
			}

			return record;
		}

		// ─────────────────────────────────────────────────────────
		// Hook: USER PROFILE ENRICHMENT (user)
		// Tag user profiles for discoverability
		// ─────────────────────────────────────────────────────────
		if (type === "user") {
			// Defaults for hook-driven user properties
			record.hit_rate_limit_early = false;
			record.has_early_eval = false;
			record.has_eval_pipeline = false;
		}

		// ─────────────────────────────────────────────────────────
		// EVERYTHING HOOKS
		// ─────────────────────────────────────────────────────────
		if (type === "everything") {
			let events = record;
			if (!events.length) return record;
			const profile = meta && meta.profile ? meta.profile : {};

			// Stamp superProps from profile for consistency
			events.forEach(e => {
				if (profile.api_tier) e.api_tier = profile.api_tier;
				if (profile.primary_use_case) e.primary_use_case = profile.primary_use_case;
				if (profile.sdk_language) e.sdk_language = profile.sdk_language;
			});

			// Determine first event time for relative day calculations
			const sortedByTime = [...events].sort((a, b) => dayjs(a.time).valueOf() - dayjs(b.time).valueOf());
			const firstEventTime = sortedByTime.length > 0 ? dayjs(sortedByTime[0].time) : DATASET_START;

			// ─────────────────────────────────────────────────────
			// Hook #5: TIER-BASED CONTEXT WINDOW (SUBSCRIPTION TIER)
			// Scale context_window and input_tokens by tier
			// ─────────────────────────────────────────────────────
			const tier = profile.api_tier || "Free";
			const contextWindow = tier === "Enterprise" ? 2000000 : tier === "Build" ? 1000000 : 200000;
			const inputMultiplier = tier === "Enterprise" ? 4 : tier === "Build" ? 2 : 1;

			events.forEach(e => {
				if (e.event === "api call") {
					e.context_window = contextWindow;
					e.input_tokens = Math.floor((e.input_tokens || 2000) * inputMultiplier);
				}
			});

			// ─────────────────────────────────────────────────────
			// Hook #1: PROMPT CACHING ADOPTION (CONVERSION)
			// Users with any cache_enabled=true get 70% cost reduction
			// on all subsequent api calls
			// ─────────────────────────────────────────────────────
			// ~25% of users have caching enabled on at least one event
			const userId = events[0] && events[0].user_id;
			const idHash = String(userId || "").split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
			const isCacheUser = (idHash % 4) === 0;

			if (isCacheUser) {
				let cacheActivated = false;
				// Activate caching on events after the first 20% of user events
				const activationPoint = Math.floor(events.length * 0.2);
				events.forEach((e, idx) => {
					if (e.event === "api call") {
						if (idx >= activationPoint) {
							cacheActivated = true;
						}
						if (cacheActivated) {
							e.cache_enabled = true;
							e.cost_usd = Math.round((e.cost_usd || 0.01) * 0.3 * 10000) / 10000;
						}
					}
				});
			}

			// ─────────────────────────────────────────────────────
			// Hook #2: MODEL MIGRATION WAVE (everything portion)
			// opus-4-7 users get 1.5x tokens_used
			// (model assignment done in event hook above)
			// ─────────────────────────────────────────────────────
			events.forEach(e => {
				if (e.event === "api call" && e.model === "opus-4-7") {
					e.tokens_used = Math.floor((e.tokens_used || 2500) * 1.5);
				}
			});

			// ─────────────────────────────────────────────────────
			// Hook #3: AGENTIC LOOP POWER USERS (BEHAVIORS TOGETHER)
			// Users with tool use + multi_turn get 8x tokens, 3x events
			// ─────────────────────────────────────────────────────
			const hasToolUse = events.some(e => e.event === "tool use call");
			const hasMultiTurn = events.some(e => e.event === "api call" && e.multi_turn === true);
			const isAgenticUser = hasToolUse && hasMultiTurn;

			if (isAgenticUser) {
				// Mark all api calls as agentic and boost tokens
				events.forEach(e => {
					if (e.event === "api call") {
						e.is_agentic_user = true;
						e.tokens_used = Math.floor((e.tokens_used || 2500) * 8);
					}
				});

				// Inject 3x extra api call events by cloning existing ones
				const apiCalls = events.filter(e => e.event === "api call");
				const extraCount = apiCalls.length * 2; // 2 extra per existing = 3x total
				for (let i = 0; i < extraCount; i++) {
					const template = apiCalls[i % apiCalls.length];
					if (template) {
						events.push({
							...template,
							time: dayjs(template.time).add(chance.integer({ min: 1, max: 120 }), "minutes").toISOString(),
							user_id: template.user_id,
							is_agentic_user: true,
							multi_turn: true,
						});
					}
				}
			}

			// ─────────────────────────────────────────────────────
			// Hook #4: RATE LIMIT CHURN
			// >=5 rate limit errors in first 7 days -> remove 60% of
			// events after week 1
			// ─────────────────────────────────────────────────────
			const firstWeekEnd = firstEventTime.add(7, "days");
			const earlyRateLimits = events.filter(e =>
				e.event === "rate limit error" &&
				dayjs(e.time).isBefore(firstWeekEnd)
			).length;

			if (earlyRateLimits >= 5) {
				// Tag the user profile
				if (profile) profile.hit_rate_limit_early = true;

				// Remove 60% of events after week 1
				events = events.filter(e => {
					if (dayjs(e.time).isAfter(firstWeekEnd)) {
						return chance.bool({ likelihood: 40 }); // keep 40% = remove 60%
					}
					return true;
				});
			}

			// ─────────────────────────────────────────────────────
			// Hook #7: BATCH API DISCOUNT (PURCHASE VALUE)
			// Batch users get 50% lower cost_per_token, 2x tokens_used
			// ─────────────────────────────────────────────────────
			const isBatchUser = events.some(e => e.event === "batch job submitted");

			if (isBatchUser) {
				events.forEach(e => {
					if (e.event === "api call") {
						e.is_batch_user = true;
						e.cost_per_token = Math.round((e.cost_per_token || 0.00001) * 0.5 * 10000000) / 10000000;
						e.tokens_used = Math.floor((e.tokens_used || 2500) * 2);
					}
				});
			}

			// ─────────────────────────────────────────────────────
			// Hook #8: EVAL-DRIVEN RETENTION
			// Early eval users (first 7 days) get 75% D30 retention
			// Non-eval users get only 25% D30 retention (remove events)
			// ─────────────────────────────────────────────────────
			const hasEarlyEval = events.some(e =>
				e.event === "eval job" &&
				dayjs(e.time).isBefore(firstWeekEnd)
			);

			if (hasEarlyEval) {
				// Tag user profile
				if (profile) {
					profile.has_early_eval = true;
					profile.has_eval_pipeline = true;
				}
				// Early eval users keep all their events (high retention)
			} else {
				// Non-eval users: remove 75% of events after day 30
				const day30 = firstEventTime.add(30, "days");
				events = events.filter(e => {
					if (dayjs(e.time).isAfter(day30)) {
						return chance.bool({ likelihood: 25 }); // keep 25%
					}
					return true;
				});
			}

			return events;
		}

		return record;
	},
};

export default config;
