// ── IMPORTS ──
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
dayjs.extend(utc);
import "dotenv/config";
import * as u from "@ak--47/dungeon-master/utils";
/** @typedef {import("../../../types").Dungeon} Config */

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
 * responses). "opus-4-7" is part of the DECLARED model enum
 * (schema-first: hooks only write declared values); the hook rewrites
 * engine-sampled opus-4-7 back to the pre-release mix, so the model
 * exists ONLY after day 60 and ONLY on Build/Enterprise api calls —
 * exact purity, asserted in the story.
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
 *   - Expected: opus-4-7 ~ 1.5x tokens vs other models. Clean on
 *     non-agentic/non-batch users — Hooks 3 and 7 multiply tokens_used
 *     on their cohorts and blur the comparison if left in.
 *
 * REAL-WORLD ANALOGUE: New flagship model launches cause migration
 * waves among power users who want improved capabilities.
 *
 * ---------------------------------------------------------------
 * 3. AGENTIC LOOP POWER USERS (everything)
 * ---------------------------------------------------------------
 *
 * PATTERN: Users with 3+ "tool use call" AND 3+ api-call events with
 * multi_turn=true — counted on the post-churn stream (Hooks 4 and 8 run
 * first, so the cohort is exactly rebuildable from the output) — get 8x
 * tokens_used on api calls plus 2 extra cloned api-call events per
 * existing (3x volume). Clones carry fresh insert_ids (Mixpanel dedupes
 * on $insert_id — spread-cloning the template id would silently drop
 * every clone at import), unique offset timestamps, and multi_turn=true,
 * which pushes the cohort's multi-turn share to (0.25n + 2n)/3n ≈ 75%
 * vs ~25% baseline — a verifier-visible signature of the 3x volume.
 * COMPOUNDS with Hook 7 (deliberate): agentic ∩ batch users get
 * 8x × 2x = 16x tokens_used — agentic batch workloads are the
 * platform's whales. No flag — discover via cohort builder.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Tokens per User — Agentic Cohort
 *   - Report type: Insights (with cohort)
 *   - Cohort A: users with >= 3 "tool use call" AND >= 3 api-call with multi_turn=true
 *   - Cohort B: rest
 *   - Event: "api call"
 *   - Measure: Average of "tokens_used"
 *   - Expected: A ~ 8x B (16x for the batch overlap — exclude users
 *     with a "batch job submitted" from both cohorts for the clean 8x)
 *
 * REAL-WORLD ANALOGUE: Agentic workloads consume dramatically more
 * tokens via extended tool-use loops.
 *
 * ---------------------------------------------------------------
 * 4. RATE LIMIT CHURN (everything)
 * ---------------------------------------------------------------
 *
 * PATTERN: Users with >= 2 "rate limit error" events in first 7 days
 * churn at 60%: a churned user's ENTIRE post-week-1 stream is dropped
 * (retention cliff), the surviving 40% keep everything. Per-user, not
 * per-event thinning — thinning is unverifiable on a burst-selected
 * cohort (any pre/post ratio inherits the selection week's decay; any
 * cross-user ratio inherits activity selection; measured RoR landed at
 * 0.17 vs the 0.4 knob even stratified on week-1 activity). The cliff
 * gives a selection-free proportion instead: share of flagged users
 * with ZERO post-week-1 events ≈ 0.60 (minus a tiny natural-quiet
 * baseline, which the story cancels by differencing against the
 * unflagged share). Classification basis is pre-week-1 and survives
 * every drop in the file, so the cohort is exactly rebuildable from
 * output. No flag — discover via cohort.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Retention by Early Rate-Limit Cohort
 *   - Report type: Retention
 *   - Cohort A: users with >= 2 "rate limit error" in first 7 days
 *   - Cohort B: rest
 *   - Expected: cohort A's retention collapses to ~40% of cohort B's
 *     from week 2 onward — a hard cliff, not a gradual decay. ~60% of
 *     cohort A never appears again after their first week.
 *
 * REAL-WORLD ANALOGUE: Developers who get rate-limited early often
 * switch to a competitor — and when they go, they go completely.
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
 * events, error_type is set to a service error, latency_ms is tripled.
 * Baseline api-call error rate is 0% BY SCHEMA (is_error declares
 * [false]; "rate limit error" is a separate event) — the outage is the
 * only source of api-call errors, so the window is exact: ~40% error
 * share inside days 40-41, exactly zero outside.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Error Rate Over Time
 *   - Report type: Insights
 *   - Event: "api call"
 *   - Measure: Total
 *   - Filter: is_error = true
 *   - Line chart by day
 *   - Expected: two-day spike at days 40-41 (~40% of api calls),
 *     flat zero everywhere else
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
 * PATTERN: Users with any "batch job submitted" event (on the
 * post-churn stream — Hooks 4 and 8 run first) get 50% lower
 * cost_per_token on api calls + 2x tokens_used. Mutates raw props.
 * cost_per_token is touched by NO other hook — clean 0.5x.
 * tokens_used COMPOUNDS with Hook 3 (deliberate): agentic ∩ batch
 * users get 2x × 8x = 16x — verified as its own cohort cell.
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
 * Non-eval users lose 75% of post-day-30 events (25% keep-rate). The
 * classification basis is pre-week-1 and survives every drop in the
 * file, so the cohort is exactly rebuildable from output. No flag —
 * discover via retention cohort.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Retention by Early Eval Cohort
 *   - Report type: Retention
 *   - Cohort A: users with >= 1 "eval job" in first 7 days
 *   - Cohort B: rest
 *   - Expected: cohort B's post-day-30 event volume (relative to its
 *     own first-30-day volume) runs ~0.25x cohort A's — a hard drop in
 *     B's retention curve after day 30. The engineered constant is the
 *     0.25 volume ratio-of-ratios, not a specific D30 percentage.
 *
 * REAL-WORLD ANALOGUE: Teams that set up eval pipelines stick around.
 *
 * ---------------------------------------------------------------
 * 9. API-TO-EVAL TIME-TO-CONVERT (funnel-post)
 * ---------------------------------------------------------------
 *
 * PATTERN: Enterprise users complete the "API to Eval Pipeline" funnel
 * 2x faster than baseline (factor 0.5 on inter-event gaps); Free users
 * 2x slower (factor 2.0). Mutates funnel event timestamps.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: API to Eval — Median Time-to-Convert by Tier
 *   - Report type: Funnels
 *   - Steps: "api call" -> "tool use call" -> "eval job"
 *   - Measure: Median time to convert
 *   - Breakdown: "api_tier"
 *   - Expected: Enterprise < Build < Free, Enterprise well under
 *     Build's median, Free well over. The measured ratios sit between
 *     the pure factors (0.5x / 2.0x) and 1: greedy first-match funnel
 *     evaluation (Mixpanel's and the emulator's) pairs organic events
 *     into instances, diluting toward 1 — and dilution is asymmetric
 *     (stretched Free gaps intercept more organic events than
 *     compressed Enterprise gaps). The factors are 0.5/2.0 precisely
 *     so the report-visible signal survives that dilution.
 *
 *   NOTE (funnel-post measurement): visible via funnel median TTC
 *   (Mixpanel report or emulateBreakdown timeToConvert). Cross-event
 *   MIN→MIN SQL on raw events does NOT show this — funnel-post adjusts
 *   gaps within funnel instances, not across the user's full history.
 *
 * REAL-WORLD ANALOGUE: Enterprise teams have dedicated platform engineers
 * who execute end-to-end pipelines faster.
 *
 * ---------------------------------------------------------------
 * 10. DOCS-SEARCHED MAGIC NUMBER (in-funnel, everything)
 * ---------------------------------------------------------------
 *
 * PATTERN: Count "docs searched" events strictly between the EARLIEST
 * organization-created and the EARLIEST billing-payment (by time, not
 * array order). Sweet 1-2 → amount_usd × 1.35 on ALL billing payments.
 * Over 3+ → amount_usd × 0.75 on ALL billing payments. Zero docs →
 * untouched baseline. Only born-in-dataset users have an organization
 * created event AND a billing payment (~4.6% of users), so thresholds
 * are calibrated to the real docs_ct distribution in that segment
 * (measured 0/1/2/3/4/5+ ≈ 43/19/14/12/10/2 per-cent — the old 5+
 * "over" bin held ~7 users at full fidelity, a dead branch). Both
 * effects are amount mutations, deliberately: amount_usd draws iid
 * from the declared distribution regardless of user activity, so
 * median ratios recover the knobs selection-free — count effects on
 * ~100-user cohorts drown in activity-selection bias (a placebo test
 * on the untouched 3+ cohort read 1.22-1.30 under the best count
 * normalizer we found). No flag.
 *
 * HOW TO FIND IT IN MIXPANEL:
 *
 *   Report 1: Median Billing Amount by Docs-Searched Bucket
 *   - Report type: Insights (with cohort)
 *   - Cohort A: users with 1-2 "docs searched" between org creation and
 *     first billing; Cohort B: users with 0; Cohort C: users with 3+
 *   - Event: "billing payment"
 *   - Measure: Median of "amount_usd"
 *   - Expected: A ~ 1.35x B; C ~ 0.75x B
 *
 * REAL-WORLD ANALOGUE: A little docs reading lifts willingness to pay;
 * doc obsession signals a team stuck on integration that downgrades.
 *
 * ===============================================================
 * EXPECTED METRICS SUMMARY
 * ===============================================================
 *
 * Hook                        | Metric                                   | Expected      | Measured (full)
 * ----------------------------|-------------------------------------------|---------------|----------------
 * H1 Prompt Caching           | avg cost_usd cached/uncached              | 0.3x          | 0.3005
 * H1 Prompt Caching           | share of users with any cached call       | ~25%          | 0.2297
 * H2 Model Migration          | opus-4-7 pre-day-60 / Free / non-api-call | 0 (exact)     | 0 of 35975
 * H2 Model Migration          | opus-4-7 share, paid calls post-day-60    | ~35%          | 0.3484
 * H2 Model Migration          | tokens opus/other (non-agentic/non-batch) | 1.5x          | 1.461
 * H3 Agentic Power Users      | avg tokens agentic-only / neither         | 8x            | 7.875
 * H3 Agentic Power Users      | avg tokens agentic∩batch / neither        | 16x (with H7) | 15.97
 * H3 Agentic Power Users      | multi-turn share of agentic api calls     | ~75% (3x vol) | 0.7644
 * H4 Rate Limit Churn         | zero-post-week-1 share, flagged − rest    | ~+0.60 diff   | +0.6072 (flagged 0.6079)
 * H5 Tier Context Window      | avg input_tokens Enterprise / Free        | 4x            | 3.984
 * H5 Tier Context Window      | context_window per tier                   | 200K/1M/2M    | exact (min=max per tier)
 * H6 Outage Day               | api-call error share, days 40-41          | ~40% (0% out) | 0.3996 (0 out-of-window)
 * H7 Batch Discount           | avg cost_per_token batch / rest           | 0.5x          | 0.4968
 * H7 Batch Discount           | avg tokens batch-only / neither           | 2x            | 2.159
 * H8 Eval Retention           | post/pre day-30 volume, noneval vs eval   | 0.25x RoR     | 0.2552
 * H9 API-to-Eval TTC          | funnel median TTC: Ent/Build, Free/Build  | <1 / >1 (0.5, 2.0 pure; diluted) | 0.6606 / 1.263 (emulator, 336h window)
 * H10 Docs Magic Number       | median amount_usd sweet(1-2) / zero       | 1.35x         | 1.456
 * H10 Docs Magic Number       | median amount_usd over(3+) / zero         | 0.75x         | 0.8371
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
// pre-release model mix — the declared api-call enum minus opus-4-7. H2
// rewrites engine-sampled opus-4-7 back to this mix so the model exists only
// after release day (schema-first requires opus-4-7 in the declared enum).
const PRE_RELEASE_MODELS = ["sonnet-4", "sonnet-4", "sonnet-4", "haiku-4", "haiku-4", "opus-4-6"];

const AGENTIC_TOOL_THRESHOLD = 3;
const AGENTIC_MULTITURN_THRESHOLD = 3;
const AGENTIC_TOKEN_MULT = 8;
const AGENTIC_CLONE_MULT = 2;

const RATE_LIMIT_THRESHOLD = 2;
// per-USER churn probability: a churned user loses ALL post-week-1 events
const RATE_LIMIT_CHURN_LIKELIHOOD = 60;

const BATCH_COST_FACTOR = 0.5;
const BATCH_TOKEN_MULT = 2;

const EVAL_NON_USER_KEEP_LIKELIHOOD = 25;
const EVAL_CUTOFF_DAYS = 30;

// bins calibrated to the measured docs_ct distribution among org∩billing
// users (~4.6% of users): 0 ≈ 43%, 1-2 ≈ 33%, 3+ ≈ 24% — every cohort
// clears ~100 users at full fidelity (the old 5+ bin held ~7: dead branch)
const DOCS_SWEET_MIN = 1;
const DOCS_SWEET_MAX = 2;
const DOCS_OVER_THRESHOLD = 3;
const DOCS_BILLING_BOOST = 1.35;
const DOCS_OVER_PENALTY = 0.75;

// 0.5/2.0 (not the 1.5 file's 0.67/1.4): greedy first-match funnel pairing
// dilutes measured TTC ratios toward 1 — these factors keep the report-
// visible signal clear of noise after dilution
const FUNNEL_TTC_ENTERPRISE = 0.5;
const FUNNEL_TTC_FREE = 2.0;

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

	// ── ORDERING ──
	// types.d.ts (HookMetaEverything) recommends stamp → mutate/clone → filter →
	// temporal. This file deliberately diverges in ONE spot, documented here: the
	// cohort-classified mutators (H3 agentic, H7 batch, H10 docs) run AFTER the
	// filters (H4, H8) so each cohort's classification basis is exactly the
	// surviving event stream. Classifying pre-drop makes the cohort unrecoverable
	// from the output (the verifier cannot see dropped events) — the 1.5 file
	// classified H3 before H4/H8's drops and its verifier "confirmed" 8x against
	// a leaky cohort at 1.5x. None of H3/H7/H10 anchors on a dataset-day window,
	// so post-filter classification costs nothing temporally. H6 (outage window)
	// runs LAST per the types.d.ts rule so H3's clones landing inside days 40-41
	// get error-stamped like every other call.

	// ── PHASE 1: stamps ──
	events.forEach(e => {
		if (profile.api_tier) e.api_tier = profile.api_tier;
		if (profile.primary_use_case) e.primary_use_case = profile.primary_use_case;
		if (profile.sdk_language) e.sdk_language = profile.sdk_language;
	});

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

	// H1: Prompt caching adoption — ~25% of users; activates ~20% into stream.
	// Hash the PROFILE distinct_id, not events[0].user_id: the 1.5 file hashed
	// events[0].user_id, which is undefined on device-only records —
	// String(undefined || "") reduces to 0 and 0 % 4 === 0, silently classifying
	// every such user as a cache user.
	const hashBasis = String(profile.distinct_id || (events.find(e => e.user_id) || {}).user_id || "");
	const idHash = hashBasis.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
	const isCacheUser = hashBasis.length > 0 && (idHash % CACHE_USER_HASH_MOD) === 0;
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

	// H2: Model migration wave.
	// "opus-4-7" is in the DECLARED model enum (schema-first: hooks only write
	// declared values), which means the engine samples it uniformly across the
	// whole window — but the story needs zero opus-4-7 before release day.
	// Rewrite every engine-sampled opus-4-7 back to the pre-release mix first;
	// opus-4-7 in the output therefore comes from the migration stamp alone
	// (post-day-60, Build/Enterprise api calls only — exact purity, asserted).
	events.forEach(e => {
		if (e.event === "api call" && e.model === "opus-4-7") {
			e.model = chance.pickone(PRE_RELEASE_MODELS);
		}
	});
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

	// First-event anchor for both churn filters. Computed pre-filter, but always
	// verifier-recoverable: the filters only drop events STRICTLY after
	// t0 + 7d / t0 + 30d, so min(time) in the output still equals t0.
	const firstEventTime = events.reduce((min, e) => {
		const t = dayjs(e.time);
		return t.isBefore(min) ? t : min;
	}, dayjs(events[0].time));
	const firstWeekEnd = firstEventTime.add(7, "days");

	// ── PHASE 2: filters ──
	// H4: Rate-limit churn — 2+ early rate-limit errors → 60% of flagged users
	// lose their ENTIRE post-week-1 stream. Per-USER cliff, not per-event
	// thinning: thinning is unverifiable on a burst-selected cohort (pre/post
	// ratios inherit the selection week's decay; cross-user ratios inherit
	// activity selection), while the cliff yields a selection-free proportion —
	// share of flagged users with zero post-week-1 events ≈ 0.6. Classification
	// basis is pre-week-1 and survives every drop.
	const earlyRateLimits = events.filter(e =>
		e.event === "rate limit error" && dayjs(e.time).isBefore(firstWeekEnd)
	).length;
	if (earlyRateLimits >= RATE_LIMIT_THRESHOLD && chance.bool({ likelihood: RATE_LIMIT_CHURN_LIKELIHOOD })) {
		events = events.filter(e => !dayjs(e.time).isAfter(firstWeekEnd));
	}

	// H8: Eval-driven retention — non-eval users lose 75% of post-day-30 events
	// (classification basis is pre-week-1 and survives every drop)
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

	// ── PHASE 3: cohort mutators + clones (classified on the SURVIVING stream) ──
	// H3: Agentic loop power users — 3+ tool calls + 3+ multi_turn → 8x tokens,
	// 2 clones per surviving api call (3x volume). Clones need FRESH insert_ids:
	// the engine stamps insert_id at generation (lib/generators/events.js), so a
	// bare spread copies the template's id and Mixpanel's $insert_id dedupe
	// silently drops every clone at import — the 1.5 file shipped that bug.
	// Clones stamp multi_turn: true, pushing the cohort's multi-turn share to
	// (0.25n + 2n)/3n ≈ 75% — the verifier-visible signature of the 3x volume.
	// Classification stays exactly recoverable from output: clones only ADD
	// multi-turn api calls to users already at/above both thresholds.
	// COMPOUND (deliberate): H7 below also multiplies tokens_used on these same
	// events, clones included — agentic ∩ batch users land at 8 × 2 = 16x. The
	// story verifies all four cells (neither/agentic/batch/both = 1x/8x/2x/16x).
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
					insert_id: chance.guid(),
					time: dayjs(template.time).add(chance.integer({ min: 1, max: 120 }), "minutes").toISOString(),
					user_id: template.user_id,
					multi_turn: true,
				});
			}
		}
	}

	// H7: Batch API discount — any surviving batch job submitted → 0.5x
	// cost_per_token (touched by NO other hook — clean), 2x tokens_used
	// (COMPOUNDS with H3, see above). Runs after H3 so the clones get the
	// discount too — a batch user's api calls are uniformly discounted.
	const isBatchUser = events.some(e => e.event === "batch job submitted");
	if (isBatchUser) {
		events.forEach(e => {
			if (e.event === "api call") {
				e.cost_per_token = Math.round((e.cost_per_token || 0.00001) * BATCH_COST_FACTOR * 10000000) / 10000000;
				e.tokens_used = Math.floor((e.tokens_used || 2500) * BATCH_TOKEN_MULT);
			}
		});
	}

	// H10: Docs-searched magic number — docs strictly between the EARLIEST
	// org-created and the EARLIEST billing payment (by time — the 1.5 file used
	// Array.find, i.e. array order, on a not-yet-sorted stream). Both branches
	// mutate amount_usd only (sweet ×1.35, over ×0.75): amounts draw iid from
	// the declared distribution, so median ratios recover the knobs selection-
	// free, and nothing is dropped — the classification window is always fully
	// reconstructable from output.
	const orgEvent = events.reduce((min, e) =>
		e.event === "organization created" && (!min || dayjs(e.time).isBefore(dayjs(min.time))) ? e : min, null);
	const firstBilling = events.reduce((min, e) =>
		e.event === "billing payment" && (!min || dayjs(e.time).isBefore(dayjs(min.time))) ? e : min, null);
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
			events.forEach(e => {
				if (e.event === "billing payment" && typeof e.amount_usd === "number") {
					e.amount_usd = Math.round(e.amount_usd * DOCS_OVER_PENALTY);
				}
			});
		}
	}

	// ── PHASE 4: temporal mutation LAST (clones in the window get stamped too) ──
	// H6: Outage window [day 40, day 42) — 40% of api calls flagged is_error
	// with a service error_type and 3x latency. Baseline is_error is 0% by
	// schema (declared [false]), so the outage is the ONLY source of api-call
	// errors: ~40% share inside the window, exactly zero outside.
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

	return events;
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
		hasAndroidDevices: false,
		hasIOSDevices: false,
		hasDesktopDevices: true,
		hasBrowser: true,
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
				// opus-4-7 is declared so the H2 hook only writes declared values
				// (schema-first); the hook scrubs engine-sampled opus-4-7 back to
				// the pre-release mix, so it appears ONLY via the day-60 migration
				model: ["sonnet-4", "sonnet-4", "sonnet-4", "haiku-4", "haiku-4", "opus-4-6", "opus-4-7"],
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

// ── STORIES ──────────────────────────────────────────────────────────────
// Machine-checkable contract for the 10 numbered hooks. Evaluate with:
//   node scripts/verify-stories.mjs dungeons/vertical/ai-platform/ai-platform.js --data-prefix verify-ai-platform

const EV = `read_json_auto('{{PREFIX}}-EVENTS*.json', sample_size=-1, union_by_name=true)`;
const US = `read_json_auto('{{PREFIX}}-USERS*.json', sample_size=-1, union_by_name=true)`;

// Identity prelude. organization created is both isAuthEvent and isFirstEvent,
// so born users auth on their very first event and user_id should be present
// on every record; the prelude still resolves through the device pool
// (avgDevicePerUser: 2, "anonymousIds" is the legacy USERS-shard key) as
// belt-and-braces for any device-only edge.
const ID_CTE = `dmap AS (SELECT unnest("anonymousIds") AS device_id, distinct_id FROM ${US}),
ev AS (SELECT coalesce(m.distinct_id::VARCHAR, e.user_id::VARCHAR, e.device_id::VARCHAR) AS uid,
  e.time::TIMESTAMP AS t, e.* FROM ${EV} e LEFT JOIN dmap m ON e.device_id = m.device_id)`;

// Temporal boundaries computed from the same knobs the hooks use
const MIG_TS = dayjs.utc(DATASET_START).add(MODEL_MIGRATION_DAY, "day").format("YYYY-MM-DD HH:mm:ss");
const OUTAGE_START_TS = dayjs.utc(DATASET_START).add(OUTAGE_START_DAY, "day").format("YYYY-MM-DD HH:mm:ss");
const OUTAGE_END_TS = dayjs.utc(DATASET_START).add(OUTAGE_END_DAY, "day").format("YYYY-MM-DD HH:mm:ss");
// H4 eligibility: users must have ≥14d of post-week-1 runway, else a natural
// short tail is indistinguishable from the engineered cliff
const H4_ELIGIBLE_TS = dayjs.utc(DATASET_END).subtract(21, "day").format("YYYY-MM-DD HH:mm:ss");

// H3/H7 cohort cells — EXACTLY the hook's classification. The filters (H4/H8)
// run before the cohort mutators, so thresholds applied to the output
// reproduce the hook's cohorts 1:1 (H3's clones only add multi-turn api calls
// to users already at/above both agentic thresholds; non-members are untouched).
const CELL_CTE = `coh AS (SELECT e.uid,
  (count(*) FILTER (WHERE e.event = 'tool use call') >= ${AGENTIC_TOOL_THRESHOLD}
   AND count(*) FILTER (WHERE e.event = 'api call' AND e.multi_turn = true) >= ${AGENTIC_MULTITURN_THRESHOLD}) AS agentic,
  bool_or(e.event = 'batch job submitted') AS batch
  FROM ev e GROUP BY 1),
cells AS (SELECT uid, CASE WHEN agentic AND batch THEN 'both' WHEN agentic THEN 'agentic'
  WHEN batch THEN 'batch' ELSE 'neither' END AS cell FROM coh)`;

// Per-user first-event anchor (H4/H8). min(time) in the output equals the
// hook's anchor because both filters only drop strictly-later events.
const T0_CTE = `t0 AS (SELECT uid, min(t) AS t0 FROM ev GROUP BY 1)`;

// H10 cohorts: docs strictly between earliest org-created and earliest billing
// payment. Both hook branches are amount-only mutations (nothing dropped, no
// events injected), so every event the hook classified on survives to the
// output — the window is exactly rebuildable. The else-bin is 'zero' (docs_ct
// = 0, the modal case at ~43% of org∩billing users).
const DOCS_CTE = `org AS (SELECT uid, min(t) AS org_t FROM ev WHERE event = 'organization created' GROUP BY 1),
bill AS (SELECT uid, min(t) AS bill_t FROM ev WHERE event = 'billing payment' GROUP BY 1),
docs AS (SELECT o.uid, count(e.uid) AS docs_ct
  FROM org o JOIN bill b ON b.uid = o.uid
  LEFT JOIN ev e ON e.uid = o.uid AND e.event = 'docs searched' AND e.t > o.org_t AND e.t < b.bill_t
  GROUP BY 1, o.org_t, b.bill_t),
dcoh AS (SELECT uid, CASE WHEN docs_ct BETWEEN ${DOCS_SWEET_MIN} AND ${DOCS_SWEET_MAX} THEN 'sweet'
  WHEN docs_ct >= ${DOCS_OVER_THRESHOLD} THEN 'over' ELSE 'zero' END AS grp FROM docs)`;

/** @type {import("../../../types").DungeonStory[]} */
export const stories = [
	{
		id: "H1-prompt-caching",
		hook: "H1",
		archetype: "cohort-prop-scale",
		narrative: `~25% of users (profile distinct_id charcode-sum % ${CACHE_USER_HASH_MOD} === 0) activate prompt caching ~${CACHE_ACTIVATION_PCT * 100}% into their stream; from then on api calls carry cache_enabled=true and cost_usd × ${CACHE_COST_FACTOR}. The flag is stamped, so the breakdown is direct`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT CASE WHEN cache_enabled = true THEN 'cached' ELSE 'uncached' END AS grp,
 avg(cost_usd) AS avg_cost, count(*) AS event_count
FROM ${EV} WHERE event = 'api call' GROUP BY 1`,
				},
				select: { c: { where: { grp: "cached" } }, u: { where: { grp: "uncached" } } },
				// knob 0.3; both sides draw from the same declared cost distribution
				expect: { metric: "c.avg_cost / u.avg_cost", op: "between", target: [0.24, 0.36] },
			},
			{
				// hash cohort share: charcode-sum % 4 of GUID-ish ids ≈ uniform → ~25%
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
per AS (SELECT uid, bool_or(cache_enabled = true) AS is_cache FROM ev WHERE event = 'api call' GROUP BY 1)
SELECT 'all' AS grp, count(*) AS user_count,
 count(*) FILTER (WHERE is_cache)::DOUBLE / count(*) AS cache_share
FROM per`,
				},
				select: { all: { where: { grp: "all" } } },
				expect: { metric: "all.cache_share", op: "between", target: [0.17, 0.33] },
			},
		],
	},
	{
		id: "H2-model-migration",
		hook: "H2",
		archetype: "temporal-inflection",
		narrative: `opus-4-7 releases at day ${MODEL_MIGRATION_DAY}: ${MODEL_MIGRATION_LIKELIHOOD}% of post-release Build/Enterprise api calls migrate, at ${MODEL_MIGRATION_TOKEN_MULT}x tokens. The hook scrubs engine-sampled opus-4-7 back to the pre-release mix, so purity is exact: zero opus-4-7 before the release instant, on Free users, or on any non-api-call event`,
		assertions: [
			{
				// deterministic purity — the scrub + tier/date-gated stamp make
				// any impure row a hook bug, not sampling noise
				breakdown: {
					type: "duckdb",
					sql: `SELECT 'all' AS grp,
 count(*) FILTER (WHERE model = 'opus-4-7' AND (time::TIMESTAMP < TIMESTAMP '${MIG_TS}' OR api_tier = 'Free' OR event <> 'api call')) AS impure,
 count(*) FILTER (WHERE model = 'opus-4-7') AS opus_calls
FROM ${EV} WHERE model IS NOT NULL`,
				},
				assert: (rows) => {
					const r = (rows || [])[0];
					if (!r) return { pass: false, verdict: "NONE", detail: "no rows" };
					if (Number(r.opus_calls) === 0) return { pass: false, verdict: "NONE", detail: "no opus-4-7 calls at all" };
					const clean = Number(r.impure) === 0;
					return {
						pass: clean,
						verdict: clean ? "NAILED" : "INVERSE",
						detail: `impure=${r.impure} of ${r.opus_calls} opus-4-7 rows (pre-release / Free / non-api-call must all be 0)`,
					};
				},
			},
			{
				// per-call migration is Bernoulli(0.35) — share of paid post-release calls
				breakdown: {
					type: "duckdb",
					sql: `SELECT 'all' AS grp, count(*) AS event_count,
 count(*) FILTER (WHERE model = 'opus-4-7')::DOUBLE / count(*) AS share
FROM ${EV} WHERE event = 'api call' AND api_tier IN ('Build', 'Enterprise')
  AND time::TIMESTAMP >= TIMESTAMP '${MIG_TS}'`,
				},
				select: { all: { where: { grp: "all" } } },
				expect: { metric: "all.share", op: "between", target: [0.3, 0.4] },
			},
			{
				// tokens 1.5x — restricted to non-agentic/non-batch users so H3's 8x
				// and H7's 2x (which hit opus and non-opus calls of their cohorts
				// alike) can't blur the comparison
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${CELL_CTE}
SELECT CASE WHEN e.model = 'opus-4-7' THEN 'opus' ELSE 'other' END AS grp,
 avg(e.tokens_used) AS avg_tokens, count(*) AS event_count, count(DISTINCT e.uid) AS user_count
FROM ev e JOIN cells c ON c.uid = e.uid AND c.cell = 'neither'
WHERE e.event = 'api call' AND e.api_tier IN ('Build', 'Enterprise')
  AND e.t >= TIMESTAMP '${MIG_TS}'
GROUP BY 1`,
				},
				select: { o: { where: { grp: "opus" } }, x: { where: { grp: "other" } } },
				expect: { metric: "o.avg_tokens / x.avg_tokens", op: "between", target: [1.3, 1.7] },
				minCohort: 100,
			},
		],
	},
	{
		id: "H3-agentic-power-users",
		hook: "H3",
		archetype: "cohort-prop-scale",
		narrative: `users with ${AGENTIC_TOOL_THRESHOLD}+ tool use calls AND ${AGENTIC_MULTITURN_THRESHOLD}+ multi-turn api calls (classified post-filter — exactly rebuildable) get ${AGENTIC_TOKEN_MULT}x tokens_used and ${AGENTIC_CLONE_MULT} clones per api call. Four-cell design with H7: neither/agentic/batch/both = 1x/${AGENTIC_TOKEN_MULT}x/${BATCH_TOKEN_MULT}x/${AGENTIC_TOKEN_MULT * BATCH_TOKEN_MULT}x. Clones stamp multi_turn=true → agentic multi-turn share ≈ 75% (the 3x-volume signature)`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${CELL_CTE}
SELECT c.cell AS grp, avg(e.tokens_used) AS avg_tokens,
 count(*) FILTER (WHERE e.multi_turn = true)::DOUBLE / count(*) AS mt_share,
 count(*) AS event_count, count(DISTINCT e.uid) AS user_count
FROM cells c JOIN ev e ON e.uid = c.uid
WHERE e.event = 'api call' GROUP BY 1`,
				},
				select: { a: { where: { grp: "agentic" } }, n: { where: { grp: "neither" } } },
				// knob 8x; H2's 1.5x rides both cells (tier ⊥ cohort) and cancels
				expect: { metric: "a.avg_tokens / n.avg_tokens", op: "between", target: [6.4, 9.6] },
				minCohort: 50,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${CELL_CTE}
SELECT c.cell AS grp, avg(e.tokens_used) AS avg_tokens,
 count(*) AS event_count, count(DISTINCT e.uid) AS user_count
FROM cells c JOIN ev e ON e.uid = c.uid
WHERE e.event = 'api call' GROUP BY 1`,
				},
				select: { b: { where: { grp: "both" } }, n: { where: { grp: "neither" } } },
				// the deliberate H3×H7 compound: 8 × 2 = 16x
				expect: { metric: "b.avg_tokens / n.avg_tokens", op: "between", target: [12.8, 19.2] },
				minCohort: 40,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${CELL_CTE}
SELECT c.cell AS grp,
 count(*) FILTER (WHERE e.multi_turn = true)::DOUBLE / count(*) AS mt_share,
 count(*) AS event_count, count(DISTINCT e.uid) AS user_count
FROM cells c JOIN ev e ON e.uid = c.uid
WHERE e.event = 'api call' GROUP BY 1`,
				},
				select: { a: { where: { grp: "agentic" } } },
				// (0.25n + 2n)/3n = 0.75 — clone-volume signature; the declared
				// multi_turn mix is 1-in-4
				expect: { metric: "a.mt_share", op: "between", target: [0.62, 0.85] },
				minCohort: 50,
			},
		],
	},
	{
		id: "H4-rate-limit-churn",
		hook: "H4",
		archetype: "retention-divergence",
		narrative: `${RATE_LIMIT_CHURN_LIKELIHOOD}% of users with ${RATE_LIMIT_THRESHOLD}+ rate limit errors in their first 7 days lose ALL post-week-1 events (per-user cliff). The signal is the share of flagged users with zero post-week-1 events, DIFFERENCED against the unflagged share to cancel the natural-quiet baseline — selection-free, unlike volume ratios on a burst-selected cohort. Restricted to users with ≥14d of post-week-1 runway`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${T0_CTE},
rl AS (SELECT e.uid FROM ev e JOIN t0 ON t0.uid = e.uid
  WHERE e.event = 'rate limit error' AND e.t < t0.t0 + INTERVAL 7 DAY
  GROUP BY 1 HAVING count(*) >= ${RATE_LIMIT_THRESHOLD}),
per AS (SELECT t0.uid, (t0.uid IN (SELECT uid FROM rl)) AS flagged,
  count(*) FILTER (WHERE e.t > t0.t0 + INTERVAL 7 DAY) AS post_ct
  FROM t0 JOIN ev e ON e.uid = t0.uid
  WHERE t0.t0 <= TIMESTAMP '${H4_ELIGIBLE_TS}' GROUP BY 1, 2)
SELECT CASE WHEN flagged THEN 'flagged' ELSE 'rest' END AS grp,
 count(*) AS user_count,
 count(*) FILTER (WHERE post_ct = 0)::DOUBLE / count(*) AS zero_share
FROM per GROUP BY 1`,
				},
				select: { f: { where: { grp: "flagged" } }, r: { where: { grp: "rest" } } },
				// knob 0.6 churn probability; differencing cancels the baseline
				expect: { metric: "f.zero_share - r.zero_share", op: "between", target: [0.45, 0.7] },
				minCohort: 50,
			},
			{
				// direct knob readout: flagged zero-post share ≈ 0.6 + tiny baseline
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${T0_CTE},
rl AS (SELECT e.uid FROM ev e JOIN t0 ON t0.uid = e.uid
  WHERE e.event = 'rate limit error' AND e.t < t0.t0 + INTERVAL 7 DAY
  GROUP BY 1 HAVING count(*) >= ${RATE_LIMIT_THRESHOLD}),
per AS (SELECT t0.uid,
  count(*) FILTER (WHERE e.t > t0.t0 + INTERVAL 7 DAY) AS post_ct
  FROM t0 JOIN ev e ON e.uid = t0.uid
  WHERE t0.uid IN (SELECT uid FROM rl) AND t0.t0 <= TIMESTAMP '${H4_ELIGIBLE_TS}'
  GROUP BY 1)
SELECT 'flagged' AS grp, count(*) AS user_count,
 count(*) FILTER (WHERE post_ct = 0)::DOUBLE / count(*) AS zero_share
FROM per`,
				},
				select: { f: { where: { grp: "flagged" } } },
				expect: { metric: "f.zero_share", op: "between", target: [0.5, 0.75] },
				minCohort: 50,
			},
		],
	},
	{
		id: "H5-tier-context-window",
		hook: "H5",
		archetype: "cohort-prop-scale",
		narrative: `input_tokens scaled ${TIER_INPUT_MULT.Free}/${TIER_INPUT_MULT.Build}/${TIER_INPUT_MULT.Enterprise}x and context_window pinned to ${TIER_CONTEXT_WINDOW.Free}/${TIER_CONTEXT_WINDOW.Build}/${TIER_CONTEXT_WINDOW.Enterprise} by api_tier. No other hook touches either prop — clean stamp-phase constants`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT api_tier AS grp, avg(input_tokens) AS avg_in, avg(context_window) AS avg_cw,
 count(*) AS event_count
FROM ${EV} WHERE event = 'api call' GROUP BY 1`,
				},
				select: { e: { where: { grp: "Enterprise" } }, f: { where: { grp: "Free" } } },
				// knob 4x (Math.floor truncation is sub-1% at these magnitudes)
				expect: { metric: "e.avg_in / f.avg_in", op: "between", target: [3.5, 4.5] },
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT api_tier AS grp, avg(context_window) AS avg_cw, min(context_window) AS min_cw,
 max(context_window) AS max_cw, count(*) AS event_count
FROM ${EV} WHERE event = 'api call' GROUP BY 1`,
				},
				assert: (rows) => {
					const want = { Free: TIER_CONTEXT_WINDOW.Free, Build: TIER_CONTEXT_WINDOW.Build, Enterprise: TIER_CONTEXT_WINDOW.Enterprise };
					const by = Object.fromEntries((rows || []).map((r) => [r.grp, r]));
					const bad = Object.entries(want).filter(([tier, cw]) =>
						!by[tier] || Number(by[tier].min_cw) !== cw || Number(by[tier].max_cw) !== cw);
					const detail = Object.keys(want).map((tr) => `${tr}=${by[tr] ? `${by[tr].min_cw}..${by[tr].max_cw}` : "missing"}`).join(" ");
					return {
						pass: bad.length === 0,
						verdict: bad.length === 0 ? "NAILED" : "INVERSE",
						detail: `${detail} (every api call must carry its tier's exact constant)`,
					};
				},
			},
		],
	},
	{
		id: "H6-outage-day",
		hook: "H6",
		archetype: "temporal-inflection",
		narrative: `days ${OUTAGE_START_DAY}-${OUTAGE_END_DAY - 1}: ${OUTAGE_ERROR_LIKELIHOOD}% of api calls flagged is_error with a service error_type and ${OUTAGE_LATENCY_MULT}x latency. is_error declares [false], so the outage is the only error source — the window boundary is exact`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT 'all' AS grp,
 count(*) FILTER (WHERE is_error = true AND time::TIMESTAMP >= TIMESTAMP '${OUTAGE_START_TS}' AND time::TIMESTAMP < TIMESTAMP '${OUTAGE_END_TS}')::DOUBLE
   / nullif(count(*) FILTER (WHERE time::TIMESTAMP >= TIMESTAMP '${OUTAGE_START_TS}' AND time::TIMESTAMP < TIMESTAMP '${OUTAGE_END_TS}'), 0) AS in_share,
 count(*) FILTER (WHERE time::TIMESTAMP >= TIMESTAMP '${OUTAGE_START_TS}' AND time::TIMESTAMP < TIMESTAMP '${OUTAGE_END_TS}') AS in_calls,
 count(*) FILTER (WHERE is_error = true AND (time::TIMESTAMP < TIMESTAMP '${OUTAGE_START_TS}' OR time::TIMESTAMP >= TIMESTAMP '${OUTAGE_END_TS}')) AS out_errors
FROM ${EV} WHERE event = 'api call'`,
				},
				select: { all: { where: { grp: "all" } } },
				// knob 40% (Bernoulli per in-window call)
				expect: { metric: "all.in_share", op: "between", target: [0.35, 0.45] },
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT 'all' AS grp,
 count(*) FILTER (WHERE is_error = true AND (time::TIMESTAMP < TIMESTAMP '${OUTAGE_START_TS}' OR time::TIMESTAMP >= TIMESTAMP '${OUTAGE_END_TS}')) AS out_errors,
 count(*) FILTER (WHERE is_error = true) AS total_errors
FROM ${EV} WHERE event = 'api call'`,
				},
				assert: (rows) => {
					const r = (rows || [])[0];
					if (!r) return { pass: false, verdict: "NONE", detail: "no rows" };
					if (Number(r.total_errors) === 0) return { pass: false, verdict: "NONE", detail: "no errors at all — outage never fired" };
					const clean = Number(r.out_errors) === 0;
					return {
						pass: clean,
						verdict: clean ? "NAILED" : "INVERSE",
						detail: `out-of-window errors=${r.out_errors} of ${r.total_errors} total (baseline is 0% by schema)`,
					};
				},
			},
		],
	},
	{
		id: "H7-batch-discount",
		hook: "H7",
		archetype: "cohort-prop-scale",
		narrative: `users with any surviving batch job submitted get cost_per_token × ${BATCH_COST_FACTOR} (touched by no other hook) and tokens_used × ${BATCH_TOKEN_MULT} (compounds with H3 — the 'both' cell is verified in the H3 story)`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${CELL_CTE}
SELECT CASE WHEN c.cell IN ('batch', 'both') THEN 'batch' ELSE 'rest' END AS grp,
 avg(e.cost_per_token) AS avg_cpt, count(*) AS event_count, count(DISTINCT e.uid) AS user_count
FROM cells c JOIN ev e ON e.uid = c.uid
WHERE e.event = 'api call' GROUP BY 1`,
				},
				select: { b: { where: { grp: "batch" } }, r: { where: { grp: "rest" } } },
				// knob 0.5; cost_per_token has no other mutator
				expect: { metric: "b.avg_cpt / r.avg_cpt", op: "between", target: [0.42, 0.58] },
				minCohort: 100,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${CELL_CTE}
SELECT c.cell AS grp, avg(e.tokens_used) AS avg_tokens,
 count(*) AS event_count, count(DISTINCT e.uid) AS user_count
FROM cells c JOIN ev e ON e.uid = c.uid
WHERE e.event = 'api call' GROUP BY 1`,
				},
				select: { b: { where: { grp: "batch" } }, n: { where: { grp: "neither" } } },
				// batch-only cell: clean 2x (agentic users are in their own cells)
				expect: { metric: "b.avg_tokens / n.avg_tokens", op: "between", target: [1.7, 2.3] },
				minCohort: 100,
			},
		],
	},
	{
		id: "H8-eval-retention",
		hook: "H8",
		archetype: "retention-divergence",
		narrative: `users without an eval job in their first 7 days keep only ${EVAL_NON_USER_KEEP_LIKELIHOOD}% of post-day-${EVAL_CUTOFF_DAYS} events. Ratio-of-ratios (noneval post/pre vs eval post/pre) cancels window lengths and the growth soup; H4's independent drop rides both cohorts`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${T0_CTE},
ev_users AS (SELECT e.uid FROM ev e JOIN t0 ON t0.uid = e.uid
  WHERE e.event = 'eval job' AND e.t < t0.t0 + INTERVAL 7 DAY GROUP BY 1),
per AS (SELECT t0.uid, (t0.uid IN (SELECT uid FROM ev_users)) AS eval_user,
  count(*) FILTER (WHERE e.t <= t0.t0 + INTERVAL ${EVAL_CUTOFF_DAYS} DAY) AS pre_ct,
  count(*) FILTER (WHERE e.t > t0.t0 + INTERVAL ${EVAL_CUTOFF_DAYS} DAY) AS post_ct
  FROM t0 JOIN ev e ON e.uid = t0.uid GROUP BY 1, 2)
SELECT CASE WHEN eval_user THEN 'eval' ELSE 'noneval' END AS grp,
 count(*) AS user_count, avg(post_ct) AS avg_post, avg(pre_ct) AS avg_pre,
 avg(post_ct) / nullif(avg(pre_ct), 0) AS post_pre
FROM per GROUP BY 1`,
				},
				select: { n: { where: { grp: "noneval" } }, e: { where: { grp: "eval" } } },
				// knob keep-rate 0.25
				expect: { metric: "n.post_pre / e.post_pre", op: "between", target: [0.17, 0.34] },
				minCohort: 50,
			},
		],
	},
	{
		id: "H9-api-to-eval-ttc",
		hook: "H9",
		archetype: "funnel-ttc-by-segment",
		narrative: `funnel-post scales API-to-Eval step gaps by tier: Enterprise × ${FUNNEL_TTC_ENTERPRISE}, Free × ${FUNNEL_TTC_FREE}, Build 1x. Measured with the Mixpanel-aligned funnel emulator (greedy step pairing), NOT raw SQL: nearest-preceding-pair SQL is censored by the fixed lookback window — stretching Free gaps pushes true pairs past the window edge and intercepts more organic events, which INVERTS the measured direction. The emulator window is 336h = max scale factor (${FUNNEL_TTC_FREE}) × the funnel's 168h generative window, so the stretched support fits — at 168h any Free instance whose original TTC exceeded 84h fails the window and the longest (most-stretched) pairs censor out. Greedy pairing still dilutes toward 1 (organic same-window events get picked as steps), asymmetrically — stretch (Free) dilutes harder than compress (Enterprise). Bands reflect the diluted effect, not the pure knobs`,
		assertions: [
			{
				breakdown: {
					type: "timeToConvert",
					steps: ["api call", "tool use call", "eval job"],
					breakdownByUserProperty: "api_tier",
					// 336h = FUNNEL_TTC_FREE × generative 168h window (covers stretched support)
					conversionWindowMs: 336 * 60 * 60 * 1000,
				},
				select: { e: { where: { segment_value: "Enterprise" } }, b: { where: { segment_value: "Build" } } },
				// knob 0.5 pure; greedy-pairing dilution pulls toward 1
				expect: { metric: "e.median_ttc_ms / b.median_ttc_ms", op: "between", target: [0.55, 0.92] },
				minCohort: 300,
			},
			{
				breakdown: {
					type: "timeToConvert",
					steps: ["api call", "tool use call", "eval job"],
					breakdownByUserProperty: "api_tier",
					// 336h = FUNNEL_TTC_FREE × generative 168h window (covers stretched support)
					conversionWindowMs: 336 * 60 * 60 * 1000,
				},
				select: { f: { where: { segment_value: "Free" } }, b: { where: { segment_value: "Build" } } },
				// knob 2.0 pure; stretch dilutes harder than compress
				expect: { metric: "f.median_ttc_ms / b.median_ttc_ms", op: "between", target: [1.1, 2.2] },
				minCohort: 300,
			},
		],
	},
	{
		id: "H10-docs-magic-number",
		hook: "H10",
		archetype: "frequency-sweet-spot",
		narrative: `docs searched between org-created and first billing: ${DOCS_SWEET_MIN}-${DOCS_SWEET_MAX} (sweet) → amount_usd × ${DOCS_BILLING_BOOST} on all billing payments; ${DOCS_OVER_THRESHOLD}+ (over) → amount_usd × ${DOCS_OVER_PENALTY} on all billing payments. Both branches mutate an iid-drawn property — selection-free, unlike count effects which drown in activity-selection bias at ~100-user cohorts (placebo on an untouched cohort read 1.22-1.30 under the best normalizer). Median ratios against the untouched zero-docs cohort read the knobs directly (amount_usd draw is docs-count-independent; ×k is monotone so median scales by k; Math.round is sub-1% at these medians)`,
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${DOCS_CTE}
SELECT d.grp AS grp, median(e.amount_usd) AS med_amt, count(*) AS payment_count,
 count(DISTINCT d.uid) AS user_count
FROM dcoh d JOIN ev e ON e.uid = d.uid AND e.event = 'billing payment'
GROUP BY 1`,
				},
				select: { s: { where: { grp: "sweet" } }, z: { where: { grp: "zero" } } },
				// knob 1.35 ±15%
				expect: { metric: "s.med_amt / z.med_amt", op: "between", target: [1.15, 1.55] },
				minCohort: 60,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}, ${DOCS_CTE}
SELECT d.grp AS grp, median(e.amount_usd) AS med_amt, count(*) AS payment_count,
 count(DISTINCT d.uid) AS user_count
FROM dcoh d JOIN ev e ON e.uid = d.uid AND e.event = 'billing payment'
GROUP BY 1`,
				},
				select: { o: { where: { grp: "over" } }, z: { where: { grp: "zero" } } },
				// knob 0.75 ±15%
				expect: { metric: "o.med_amt / z.med_amt", op: "between", target: [0.64, 0.86] },
				minCohort: 60,
			},
		],
	},
];

export default config;
