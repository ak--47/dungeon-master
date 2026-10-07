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
 * NAME:       Cortexa
 * APP:        Developer platform for Cortexa's large language models. Developers
 *             sign up in the web console, create an API key, and call the models
 *             over the API (Messages API, Batch API). The console also has a
 *             prompt playground, an evaluation tool, usage dashboards, docs, and
 *             billing. Models: atlas-2 (flagship), swift-2 (fast and cheap), and
 *             atlas-3 (new flagship from 2026-07-28; Free accounts from
 *             2026-09-08). Usage is billed per million tokens; plans are Free
 *             ($100 of list-price usage a month), Build (pay as you go), Scale
 *             (committed monthly spend), and Enterprise (contract).
 * SCALE:      10,000 accounts (4,981 sign up inside the window), ~0.82M events,
 *             120 days (2026-06-04 → 2026-10-01, UTC)
 * CORE LOOP:  account created → api key created → api request (repeat)
 * VALUE MOMENT: first api request
 *
 * EVENTS (14):
 *   api request (sampled request log, the bulk of events) > docs viewed >
 *   playground session > usage dashboard viewed > rate limit hit (made from
 *   the request stream by plan) > member invited > api key rotated > funnel-only: account created,
 *   api key created, batch job submitted / completed, eval run started /
 *   completed, billing page viewed, plan upgraded, $experiment_started
 *
 * FUNNELS (6 declared + the engine catch-all for console events):
 *   - Onboarding (first funnel, A/B "Interactive Quickstart" from 2026-07-01):
 *       account created → api key created → api request (50%, 6 h)
 *   - API Traffic: 8 × api request in a 2 h burst (production traffic)
 *   - Batch Jobs: batch job submitted → batch job completed (batch_id per job;
 *       completion re-timed by the hook, H4)
 *   - Evals (two copies: young accounts, customer_since from 35 days before
 *       June 4, weigh 5; older accounts 1; the hook fades a young account's
 *       extra runs out between day 14 and day 35): eval run started → eval run
 *       completed (eval_id per run)
 *   - Upgrade (Free accounts): billing page viewed → plan upgraded (one pass is
 *       kept and moved by the hook, see below)
 *
 * USER PROPS:  plan_tier, company_size, use_case, sdk_language,
 *              acquisition_channel, inference_region, primary_role,
 *              customer_since, "Experiment: Interactive Quickstart" (enrolled)
 * SUPER PROPS: plan_tier (plan at event time)
 * SCD PROPS:   none
 * GROUPS:      none (an account is one developer's organization seat)
 * WAREHOUSE:   inference_fleet_daily (GPU fleet health by inference region),
 *              model_billing_daily (metered usage, list prices, revenue by model),
 *              developer_marketing_daily (paid developer-marketing spend by channel)
 * LOOKUPS:     none — every attribute is denormalized onto events/profiles
 * SOUP:        weekday-heavy dayOfWeekWeights (console), Americas + EMEA hourOfDayWeights (UTC);
 *              the hook lifts weekend API traffic (production apps run every day)
 *
 * IDENTITY: every event is tracked server-side and carries user_id; there is
 * no device_id (avgDevicePerUser 0) and no anonymous activity. "account
 * created" is each new account's first product event (isAuthEvent); accounts
 * enrolled in the Quickstart experiment get $experiment_started 1 s before it.
 *
 * DESIGN NOTES:
 * - api request is a 1-in-1,000 sample of API traffic (API_SAMPLE_RATE): one
 *   event stands for 1,000 requests. The warehouse meters every request, so
 *   model_billing_daily and inference_fleet_daily are ~1,000x the event
 *   counts, with drift (late-posted usage, steady internal traffic, requests
 *   whose analytics record was lost). Free accounts keep 15% of their request
 *   events (small, throttled workloads) and stop at a $100 monthly allowance of
 *   list-price usage (FREE_MONTHLY_ALLOWANCE_USD: the request that uses it up
 *   completes, later ones are rejected and not logged until the 1st; about $48
 *   of free usage per active Free account a month); Scale and Enterprise accounts send
 *   2x and 3x a Build account's traffic (cloned requests), so per-account
 *   spend fits the plan. Production traffic runs every day: each Saturday and
 *   Sunday request gains a clone with probability WEEKEND_API_LIFT (0.2), so
 *   weekend api request volume is ~0.8-0.85 of a weekday while console events
 *   fall to ~0.7.
 * - Request sizes and speed are drawn per request in the hook: log-normal
 *   input (median 3,200 tokens) and output (median 520) tokens; latency =
 *   time_to_first_token_ms (200 ms + 0.1 ms per prefilled input token) +
 *   decode time (output tokens × model-specific ms per token), each with
 *   log-normal noise. A cached prefix skips 90% of its prefill; decode is
 *   unchanged. So atlas-3's longer answers make its requests slower at the
 *   same per-token speed, and caching shortens time to first token only.
 * - The hook owns every api request attribute that a story reads: model
 *   (H2, H7), cache_hit / cached_input_tokens (H1), tool_use and input_tokens
 *   (H8), latency_ms, status_code / error_type (H6), inference_region (from
 *   the account's location), and sdk_language (from the profile).
 * - Onboarding: an account that never makes its first request in the
 *   onboarding funnel never gets a working integration, so the hook removes
 *   its API-dependent events (requests, rate limits, batches, evals). Most of
 *   those accounts stop within a week; the rest keep reading docs and using
 *   the playground.
 * - Upgrades: the hook decides who upgrades Free → Build and when (a lag
 *   after signup, median 3 days), and moves one engine-generated "plan
 *   upgraded" (with its billing page view) to that moment; other upgrade
 *   passes are dropped. An upgrader with no pass of its own gets a clone of
 *   the first pass any account produced (identity and location re-stamped,
 *   prepaid_credits_usd and billing_section redrawn from the declared
 *   values). Accounts that joined in the 30 days before June 4 use the same
 *   rule, so June upgrades do not start from an empty pipeline.
 * - Batch and eval usage come from a share of accounts (by company size and
 *   role) with a salted per-account intensity; whole linked units (same
 *   batch_id / eval_id) are kept or dropped together. Eval intensity follows
 *   account age: young accounts (in-window signups and accounts that joined in
 *   the 35 days before June 4) keep every run in days 0-13, then fade linearly
 *   to the established rate by day 35. So weekly eval volume is flat from
 *   week 1 and a June joiner evaluates like an older account by its second month.
 *   For new API accounts the number of runs started in days 0-13 is a salted
 *   per-account draw (H5), realized by dropping or cloning whole eval units
 *   on the account's own early activity. A completion lands duration_minutes
 *   after its start.
 * - Rate-limit episodes happen during traffic: each sampled request opens an
 *   episode a few seconds later at a per-request rate by plan at the moment
 *   (RL_PER_1K_REQ; H10). The engine's own episodes are reused as templates,
 *   so every account's episodes track its own request volume.
 * - retentionCurve shapes new accounts' activity; established accounts are
 *   flat across the window. Batch and eval completions are platform-sent and
 *   survive a new account's lifecycle cut; retention reads exclude them.
 * - warehouse: the everything hook records each account's final request log
 *   (per day × model and day × region, with the latency of every successful
 *   request) and its signup channel into module maps keyed by account; the
 *   warehouse hook aggregates them. inference_fleet_daily.p95_latency_ms is the
 *   p95 of the region-day's successful request latencies (±3%); each paid
 *   channel's daily budget is its cost per signup × the signups it brought in,
 *   spread over the window. Deterministic at concurrency 1.
 */

// ── HOOK STORIES ──
/*
 * All effects are hidden: no flag properties. Each is found by a breakdown, a
 * date comparison, or a cohort. Dates live in the TIMELINE constants and are
 * shared by hooks, stories, SQL, warehouse columns, and the timeline guide.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H1. PROMPT CACHING LAUNCH (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: prompt caching is generally available from 2026-07-08 on every
 *   plan. 50% of accounts turn it on, each on a salted day in the 21 days
 *   after launch, with a salted 50-90% hit rate (mean 70%), so the cache-hit
 *   share of requests ramps for three weeks and holds at 35%. A cache hit
 *   skips 90% of the prefill work of its cached prefix (50-90% of the prompt,
 *   cached_input_tokens) and bills that prefix at 10% of the input price.
 *   Decode time is unchanged. Expected time-to-first-token ratio hit / miss on
 *   plain requests = (200 + 0.1 × 4,592 × (1 − 0.7 × 0.9)) / (200 + 0.1 ×
 *   4,592) = 0.561. Total latency falls only a little (decode dominates).
 *   No hits before launch.
 * MIXPANEL: Insights, api request, average time_to_first_token_ms, breakdown
 *   cache_hit, filter status_code = 200 and tool_use = false, after Jul 8;
 *   weekly share of cache_hit = true shows the ramp.
 * REAL WORLD: re-using a cached system prompt skips most of the prefill work;
 *   the answer still has to be generated token by token.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H2. ATLAS-3 LAUNCH (everything, composition drift)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: atlas-3 launches 2026-07-28 for Build, Scale, and Enterprise (plan
 *   at the request) and opens to Free on 2026-09-08. 60% of paid accounts
 *   adopt (salted start over 21 days, salted 45-85% of their flagship
 *   traffic), so atlas-3 holds 39% of paid flagship (atlas-2 + atlas-3)
 *   requests once ramped; 35% of Free accounts adopt after Free access
 *   (22.75%). swift-2 traffic is untouched. atlas-3 answers are 1.3x as long.
 * MIXPANEL: Insights, api request, total, breakdown model, filter model in
 *   (atlas-2, atlas-3) and plan_tier in (build, scale, enterprise), weekly, %.
 * REAL WORLD: a new flagship takes over a slice of each customer's traffic
 *   rather than all of it; teams keep the old model where it is tested.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H3. INTERACTIVE QUICKSTART EXPERIMENT (declarative first-funnel experiment)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: from 2026-07-01 new accounts split 50/50 at signup. The
 *   "Interactive Quickstart" arm reaches its first API request 1.3x as often
 *   (50% → 65%) and in 0.5x the time (median ~4 h → ~2 h). Accounts that never
 *   make their first request send no API traffic (the hook removes it).
 * MIXPANEL: Funnels, account created → api key created → api request, 7-day
 *   window, breakdown user property "Experiment: Interactive Quickstart".
 * REAL WORLD: a guided first call beats a docs page for time to first value.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H4. BATCH TURNAROUND BY PLAN (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: batch job submit → complete time is 0.4x the Build time for Scale
 *   and Enterprise and 1.6x for Free (base median 4 h, log-normal spread,
 *   24 h expiry), by plan at submission.
 * MIXPANEL: Funnels, batch job submitted → batch job completed, hold batch_id
 *   constant, median time to convert, breakdown plan_tier.
 * REAL WORLD: committed-capacity customers get queue priority on shared GPUs.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H5. EARLY EVALS → RETENTION (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: new accounts that made their first API request go dark after day
 *   21 on a ramp by eval runs started in their first 14 days: 55% with none,
 *   30% with one, none with 2+. The early run count is a salted per-account
 *   draw (mixed Poisson, mean 1.1 for evaluating accounts) that does not
 *   depend on how dense the engine made the account's activity, so it does
 *   not select front-loaded, short-lived accounts. 55% of new API accounts
 *   also lapse on a day spread evenly over 7-90 (organic), the same share in
 *   every early-eval group. Dark and lapse shares are exact within each group
 *   (systematic sampling), so retention for 2 runs and for 3+ runs is the
 *   same in expectation. Reads are knob floors: accounts that never evaluate also send fewer
 *   events later (no eval runs), which can only add to the gap.
 *   D30 2+ / 0 ≥ 1/(1−0.55); 1 / 0 ≥ 0.7/0.45.
 * MIXPANEL: Funnels account created → eval run started → eval run started
 *   (14-day window) to build cohorts; Retention account created → custom event
 *   of every event except batch job completed / eval run completed (plain "any
 *   event" gives the same numbers), custom bracket day 30-36.
 * REAL WORLD: teams that measure quality before launch ship to production and
 *   stay; teams that only poke at the API drift away.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H6. US-EAST GPU CAPACITY INCIDENT (everything + warehouse inference_fleet_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-08-26 to 2026-08-27, 35% of would-be successful us-east
 *   requests fail with 529 overloaded_error; successful ones take 2x as long.
 *   The warehouse shows region_status = major_outage, error_rate_5xx ≈ 0.36,
 *   and ~40% fewer GPUs online for us-east on those days.
 * MIXPANEL: Insights, api request, share status_code = 200, daily, breakdown
 *   inference_region; join the warehouse region status.
 * REAL WORLD: a capacity loss in one region looks like "the API got flaky"
 *   until someone checks the status page.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H7. SWIFT-2 PRICE CUT (everything + warehouse model_billing_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: 2026-08-18 the swift-2 list price halves. Build accounts (list
 *   price) move traffic: each account's swift-2 share becomes 1.6x its base
 *   (salted switch day over 10 days). Free, Scale, and Enterprise unchanged.
 *   Prices exist only in the warehouse.
 * MIXPANEL: Insights, api request, breakdown model, filter plan_tier, weekly %.
 * REAL WORLD: price-sensitive pay-as-you-go customers re-route easy requests
 *   to the cheap model; contract customers do not react to list prices.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H8. AGENT TOOL USE (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: tool-use requests carry 2.5x the input tokens of plain requests;
 *   tool use is 60% of requests for agents accounts, 30% coding, 4-6% others.
 * MIXPANEL: Insights, api request, average input_tokens, breakdown tool_use;
 *   share of tool_use = true by user property use_case.
 * REAL WORLD: tool schemas and tool results ride along in every agent turn.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H9. DEVELOPER MARKETING ECONOMICS (everything + warehouse developer_marketing_daily)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: window spend per Mixpanel signup is $140 hackathons, $85 search
 *   ads, $55 newsletter sponsorships (paced daily budget = cost per signup ×
 *   the channel's window signups / 120, weekday shape, ±15% noise, never zero). Share of would-be upgraders kept by channel: search
 *   ads and referral 1.0, newsletters 0.85, github 0.8, organic 0.75,
 *   hackathons 0.35.
 * MIXPANEL: Insights account created by acquisition_channel joined to
 *   spend_usd; Funnels account created → plan upgraded, 30-day window,
 *   signups Jun 4 - Aug 31, breakdown acquisition_channel. Channel is drawn
 *   independently of every other driver; the conversion read is a one-sided
 *   ceiling (knob + 2.25 SE ≈ 0.50, from the expected ~36 hackathon and ~148
 *   search-ads buyers) only because the small buyer count leaves ~19% error.
 * REAL WORLD: hackathon signups come for free credits and rarely pay.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * H10. BUILD RATE LIMITS RAISED (everything)
 * ─────────────────────────────────────────────────────────────────────────
 * PATTERN: rate-limit episodes open from the request stream at a per-request
 *   rate by plan (Free 250, Build 27, Scale 3.8, Enterprise 1.3 per 1,000
 *   sampled requests). From 2026-09-01 the Build rate falls to 0.4x (plan at
 *   the request); Free, Scale, Enterprise unchanged. Because episodes track
 *   each account's own requests, the Free control holds steady month to month.
 * MIXPANEL: Insights, rate limit hit and api request, formula A/B, breakdown
 *   plan_tier, September vs Jun 4 - Aug 31 (Build relative to Free).
 * REAL WORLD: higher limits stop throttling bursty production traffic.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * EXPECTED METRICS SUMMARY (measured: data/verify-ai-platform, 2026-10-07)
 * ═════════════════════════════════════════════════════════════════════════
 * Hook | Metric                                        | Derivation                 | Expected | Measured
 * -----|-----------------------------------------------|----------------------------|----------|---------
 * H1   | cache hits before 2026-07-08                  | exact purity               | 0        | 0
 * H1   | time to first token hit / miss, plain, 200    | CACHE_TTFT_RATIO           | 0.561    | 0.563 (387 vs 687 ms)
 * H1   | cache-hit share of requests after ramp        | 0.5 × 0.7                  | 0.35     | 0.357
 * H2   | atlas-3 before launch / on Free before Sep 8  | exact purity               | 0        | 0
 * H2   | atlas-3 share of paid flagship, ramped        | 0.6 × 0.65                 | 0.39     | 0.390
 * H2   | output tokens atlas-3 / atlas-2, paid         | ATLAS3_OUTPUT_MULT         | 1.30     | 1.297
 * H2   | atlas-3 share of Free flagship, from Sep 18   | 0.35 × 0.65                | 0.2275   | 0.217
 * H3   | first-request rate variant / control (7 d)    | QUICKSTART_CONV_MULT       | 1.30     | 1.382 (65.8% vs 47.6%)
 * H3   | median time to first request variant / ctrl   | QUICKSTART_TTC_MULT        | 0.50     | 0.501 (2.0 vs 4.0 h)
 * H3   | variant share of exposed accounts             | equal 2-arm hash           | 0.50     | 0.489
 * H4   | median batch time Scale+Ent / Build           | BATCH_PLAN_MULT.scale      | 0.40     | 0.415 (1.62 vs 3.91 h)
 * H4   | median batch time Free / Build                | BATCH_PLAN_MULT.free       | 1.60     | 1.641
 * H5   | D30 retention 2+ / 0 early eval runs          | ≥ 1/(1 − 0.55) (floor)     | ≥ 2.22   | 2.453 (69.0% vs 28.1%, STRONG)
 * H5   | D30 retention 1 / 0 early eval runs           | ≥ 0.7/0.45 (floor)         | ≥ 1.56   | 1.702 (NAILED)
 * H5   | D30 retention 3+ vs exactly 2 early runs      | no dark cut for either     | equal    | 72.6% vs 66.5% (z ≈ 1.1)
 * H6   | us-east / other success, incident vs ±7 days  | 1 − INCIDENT_FAIL          | 0.65     | 0.652
 * H6   | warehouse error_rate_5xx during the outage    | INCIDENT_FAIL (+1.3% base) | 0.35     | 0.350
 * H7   | Build swift-2 share Sep / before the cut      | SWIFT_SHIFT_MULT           | 1.60     | 1.604 (30.0% → 48.2%)
 * H7   | Free swift-2 share Sep / before (control)     | unchanged                  | 1.00     | 0.994
 * H8   | input tokens tool / plain                     | TOOL_INPUT_MULT            | 2.50     | 2.486 (11,448 vs 4,606)
 * H8   | tool share of agents requests                 | TOOL_SHARE.agents          | 0.60     | 0.598
 * H9   | spend per signup hackathons / search ads      | 140 / 85                   | 1.647    | 1.622 ($139.46 vs $85.96)
 * H9   | 30-day paid rate hackathons / search ads      | 0.35 / 1.0 (ceiling 0.496) | 0.35     | 0.386 (8.5% vs 22.0%, STRONG)
 * H10  | Build / Free rate-limit rate, Sep vs Jun 4-Aug 31 | RL_RAISE_MULT          | 0.40     | 0.384 (Free 246.5 → 252.4 per 1k)
 * ═════════════════════════════════════════════════════════════════════════
 *
 * H5's reads are knob floors: the early run count is independent of activity
 * density, but accounts that never evaluate also send fewer events later (no
 * eval runs, and a Free account that uses up its monthly allowance stops sending
 * requests), so engagement can only add to the gap. In this run the 1-vs-0 read
 * lands within 10% of its floor (NAILED) and the 2+-vs-0 read 10.4% above it
 * (STRONG). H9's conversion read rests on 46 hackathon and 153 search-ads buyers
 * inside the 30-day window (relative SE of the ratio about 19%). Channel is not
 * confounded; the one-sided ceiling (knob + 2.25 SE, 0.496) exists only to
 * cover that sampling error. The read lands outside the knob's ±10% and
 * grades STRONG. Event volume is ~0.82M (not 1.4M): new accounts that never make a first
 * request stop early, Free accounts keep 15% of their request events and stop at
 * their monthly allowance, and batch, eval, invite, and key-rotation volume is
 * thinned to adopters.
 */

// ── SCALE ──
const SEED = "promptforge";
const NUM_USERS = 10_000;
const DATASET_START = "2026-06-04T00:00:00Z";
const DATASET_END = "2026-10-01T23:59:59Z"; // 120 days
const EVENTS_PER_DAY = 1.2;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

const chance = u.initChance(SEED);

// ── TIMELINE (shared by hooks, stories, SQL, warehouse columns, guides) ──
const QUICKSTART_START = "2026-07-01T00:00:00Z"; // "Interactive Quickstart" onboarding A/B starts
const CACHE_LAUNCH = "2026-07-08T00:00:00Z";     // prompt caching generally available
const ATLAS3_LAUNCH = "2026-07-28T00:00:00Z";    // atlas-3 for Build, Scale, Enterprise
const SWIFT_PRICE_CUT = "2026-08-18T00:00:00Z";  // swift-2 list price halved
const INCIDENT_START = "2026-08-26T00:00:00Z";   // us-east GPU capacity incident
const INCIDENT_END = "2026-08-28T00:00:00Z";     // exclusive (2 days)
const RATE_LIMIT_RAISE = "2026-09-01T00:00:00Z"; // Build tier rate limits raised
const ATLAS3_FREE = "2026-09-08T00:00:00Z";      // atlas-3 opens to Free accounts

const ms = (iso) => dayjs.utc(iso).valueOf();
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;

// ── WEEKLY AND DAILY RHYTHM (soup) ──
// Sun..Sat. Developers build on weekdays (console events follow this shape);
// production API traffic keeps weekends alive (WEEKEND_API_LIFT in the hook).
const DOW_WEIGHTS = [0.6, 1.0, 1.0, 0.98, 0.96, 0.86, 0.56];
// UTC hours: EMEA working hours (07-16 UTC) overlap the Americas (13-01 UTC).
const HOUR_WEIGHTS = [0.5, 0.42, 0.34, 0.28, 0.26, 0.28, 0.36, 0.5, 0.64, 0.74, 0.8, 0.82,
	0.86, 0.94, 1.0, 1.0, 0.98, 0.94, 0.88, 0.8, 0.72, 0.66, 0.6, 0.55];

// ── KNOBS ──
const API_SAMPLE_RATE = 1000; // one api request event = 1,000 metered requests
const FREE_TRAFFIC_KEEP = 0.15; // Free accounts: small, throttled workloads (share of request events kept)
const FREE_MONTHLY_ALLOWANCE_USD = 100; // Free plan: list-price usage included per calendar month; requests past it are rejected (not metered, not logged) until the 1st
const PLAN_TRAFFIC_MULT = { free: 1, build: 1, scale: 2, enterprise: 3 }; // request volume vs a Build account
const API_BURST_LEN = 8;     // sampled requests per traffic burst (usage funnel)
const API_TRAFFIC_WEIGHT = 8;
const WEEKEND_API_LIFT = 0.2; // Sat/Sun: each sampled request gains a clone with this probability (scheduled jobs and live apps run every day; weekend API traffic ≈ 0.8-0.85 of a weekday)

// models and list prices (USD per million tokens)
const MODELS = ["atlas-2", "swift-2", "atlas-3"];
const PRICE_IN = { "atlas-2": 3, "atlas-3": 3, "swift-2": 0.8 };
const PRICE_OUT = { "atlas-2": 15, "atlas-3": 15, "swift-2": 4 };
const SWIFT_PRICE_CUT_FACTOR = 0.5;     // swift-2 list price after the cut
const CACHED_INPUT_PRICE_SHARE = 0.1;   // cached input tokens bill at 10% of the input price
// request size and speed
const INPUT_MEDIAN = 3200, INPUT_SIGMA = 0.85, INPUT_MIN = 20, INPUT_MAX = 180_000;
const OUTPUT_MEDIAN = 520, OUTPUT_SIGMA = 0.75, OUTPUT_MAX = 8192;
const TTFT_BASE_MS = 200, TTFT_MS_PER_INPUT = 0.1; // time to first token: fixed overhead + prefill per input token
const MS_PER_OUTPUT_TOKEN = { "atlas-2": 8, "atlas-3": 8, "swift-2": 3.5 };
const LATENCY_SIGMA = 0.25;

// H1 prompt caching (all plans) from CACHE_LAUNCH
const CACHE_ADOPTER_SHARE = 0.5;   // share of accounts that turn caching on (salted)
const CACHE_RAMP_DAYS = 21;        // each adopter starts on a salted day in the 3 weeks after launch
const CACHE_HIT_MEAN = 0.7;        // per adopter: share of requests served from cache, uniform ±0.2
const CACHE_HIT_SPREAD = 0.2;
const CACHE_HIT_SHARE = CACHE_ADOPTER_SHARE * CACHE_HIT_MEAN; // 0.35 of requests once ramped
const CACHE_PREFILL_SHARE = 0.1;   // a cached input token costs 10% of the normal prefill time (decode is unchanged)
const CACHE_PREFIX_MIN = 0.5;      // cached share of a hit's input tokens, uniform 0.5-0.9
const CACHE_PREFIX_MAX = 0.9;
// expected time-to-first-token ratio hit / miss on plain (no tool) requests: the cached share is drawn
// independently of the prompt size, so E[ttft] = base + k × E[input] × (1 − E[cached share] × (1 − prefill share))
const INPUT_MEAN_PLAIN = INPUT_MEDIAN * Math.exp(INPUT_SIGMA ** 2 / 2);
const CACHE_PREFIX_MEAN = (CACHE_PREFIX_MIN + CACHE_PREFIX_MAX) / 2;
const CACHE_TTFT_RATIO = (TTFT_BASE_MS + TTFT_MS_PER_INPUT * INPUT_MEAN_PLAIN * (1 - CACHE_PREFIX_MEAN * (1 - CACHE_PREFILL_SHARE)))
	/ (TTFT_BASE_MS + TTFT_MS_PER_INPUT * INPUT_MEAN_PLAIN); // ≈ 0.56

// H2 atlas-3 launch (paid plans) and Free access
const ATLAS3_PAID_ADOPTERS = 0.6;  // share of paid accounts that adopt (salted)
const ATLAS3_FREE_ADOPTERS = 0.35; // share of Free accounts that adopt after Free access
const ATLAS3_RAMP_DAYS = 21;
const ATLAS3_FREE_RAMP_DAYS = 10;
const ATLAS3_USE_MEAN = 0.65;      // per adopter: share of flagship requests on atlas-3, uniform ±0.2
const ATLAS3_USE_SPREAD = 0.2;
const ATLAS3_FLAGSHIP_SHARE = ATLAS3_PAID_ADOPTERS * ATLAS3_USE_MEAN; // 0.39 of paid flagship requests
const ATLAS3_OUTPUT_MULT = 1.3;    // atlas-3 answers are longer
const PAID_PLANS = ["build", "scale", "enterprise"];

// H7 swift-2 price cut: Build accounts (list-price customers) move traffic to swift-2
const SWIFT_BASE_MIN = 0.15;       // per account base swift-2 share, uniform 0.15-0.45
const SWIFT_BASE_MAX = 0.45;
const SWIFT_SHIFT_MULT = 1.6;      // Build swift-2 share after the cut
const SWIFT_SHIFT_RAMP_DAYS = 10;  // each Build account switches on a salted day in the 10 days after

// H3 Interactive Quickstart experiment on onboarding
const QUICKSTART_EXPERIMENT = "Interactive Quickstart";
const QUICKSTART_VARIANT = "Interactive Quickstart";
const EXP_KEY = `Experiment: ${QUICKSTART_EXPERIMENT}`;
const ONBOARD_CONV = 50;
const ONBOARD_TTC_H = 6;
const QUICKSTART_CONV_MULT = 1.3;
const QUICKSTART_TTC_MULT = 0.5;

// H4 batch turnaround by plan
const BATCH_MEDIAN_H = 4;          // base median submit → complete (Build)
const BATCH_SIGMA = 0.55;
const BATCH_PLAN_MULT = { free: 1.6, build: 1, scale: 0.4, enterprise: 0.4 };
const BATCH_SLA_H = 24;            // jobs not finished in 24 h expire
const BATCH_SHARE = { individual: 0.15, startup: 0.3, growth: 0.45, enterprise: 0.6 };

// H5 first-two-weeks evals → retention (new API accounts)
const EVAL_DAYS = 14;
const EVAL_MIN = 2;                 // eval runs in the first 14 days that mark an evaluating team
const DARK_SHARE_BY_EVALS = [0.55, 0.3]; // share who go dark after day 21, by early eval runs (0, 1); 2+ → 0
const DARK_AFTER_DAYS = 21;
const EVAL_SHARE = { ml_engineer: 0.7, data_scientist: 0.6, backend_developer: 0.35, founder: 0.25 };
const EVAL_SHARE_NEW_BOOST = 0.1;
const EVAL_WEIGHT_NEW = 5;           // Evals funnel weight for young accounts (joined from EVAL_YOUNG_SINCE on)
const EVAL_FADE_END_DAYS = 35;       // young accounts keep every eval run in days 0-13, fade to 1/EVAL_WEIGHT_NEW by day 35
const EVAL_EARLY_MEAN = 1.1;         // new evaluating accounts: mean eval runs started in days 0-13 (mixed Poisson, salted per account)
const EVAL_COMPLETE_PCT = 92;        // share of eval runs that complete (matches the Evals funnel)
const EVAL_YOUNG_SINCE = dayjs.utc(DATASET_START).subtract(EVAL_FADE_END_DAYS, "day").format("YYYY-MM-DD"); // warm start: recent pre-window accounts too
const LAPSE_SHARE = 0.55;           // organic lapse, every new API account
const LAPSE_DAY_MIN = 7;
const LAPSE_DAY_MAX = 90;
const NO_KEY_ABANDON_SHARE = 0.9;   // accounts that never make a first request: share who stop in day 0.5-7
const NO_KEY_ABANDON_MIN = 0.5;
const NO_KEY_ABANDON_MAX = 7;

// H6 us-east GPU capacity incident (warehouse inference_fleet_daily)
const REGIONS = ["us-east", "us-west", "eu-west"];
const INCIDENT_REGION = "us-east";
const INCIDENT_FAIL = 0.35;         // share of would-be successful us-east requests that fail (529)
const INCIDENT_LATENCY_MULT = 2;    // latency of the us-east requests that still succeed
const BASE_STATUS = { 200: 0.975, 400: 0.012, 500: 0.004, 529: 0.009 };
const REGION_GPUS = { "us-east": 2400, "us-west": 1600, "eu-west": 1400 };
// first-party apps and internal eval pipelines served by the fleet every day (no product event), metered requests per day
const INTERNAL_REQS_PER_DAY = { "us-east": 900_000, "us-west": 640_000, "eu-west": 440_000 };

// H8 tool use (agent workloads)
const TOOL_SHARE_BY_USE_CASE = { agents: 0.6, coding: 0.3, chat_assistant: 0.06, document_processing: 0.05, content_generation: 0.04 };
const TOOL_INPUT_MULT = 2.5;        // tool definitions and tool results ride in the prompt

// H9 developer marketing (warehouse developer_marketing_daily)
const PAID_CHANNELS = ["search_ads", "newsletter_sponsorships", "hackathons"];
const CPL_USD = { search_ads: 85, newsletter_sponsorships: 55, hackathons: 140 }; // window cost per Mixpanel signup
const CHANNEL_WEIGHTS = { organic: 24, github: 14, referral: 12, search_ads: 20, newsletter_sponsorships: 16, hackathons: 14 };
const BORN_PCT = 50;
const WINDOW_DAYS = 120;
const SPEND_FLAT_SHARE = 0.3;
const SPEND_WEEKDAY = (() => {
	const m = DOW_WEIGHTS.reduce((a, b) => a + b, 0) / DOW_WEIGHTS.length;
	return DOW_WEIGHTS.map((w) => SPEND_FLAT_SHARE + (1 - SPEND_FLAT_SHARE) * w / m);
})();
const SPEND_NOISE = 0.15;
const PLATFORM_SIGNUP_INFLATION = 1.2;
const CPC_USD = { search_ads: 6.5, newsletter_sponsorships: 3.2, hackathons: 9 };
const CTR = { search_ads: 0.03, newsletter_sponsorships: 0.012, hackathons: 0.05 };
// self-serve upgrades (Free → Build)
const UPGRADE_BASE = 0.4;           // would-be upgraders among new API accounts, before channel quality
const UPGRADE_KEEP = { search_ads: 1.0, referral: 1.0, newsletter_sponsorships: 0.85, github: 0.8, organic: 0.75, hackathons: 0.35 };
const UPGRADE_LAG_MEDIAN_D = 3;
const UPGRADE_LAG_SIGMA = 1.1;
const UPGRADE_RECENT_DAYS = 30;     // accounts that joined this close before June 4 follow the new-account rule
const UPGRADE_ESTABLISHED = 0.05;   // long-time Free accounts that upgrade in the window
const PAID_FUNNEL_WINDOW_DAYS = 30;
const PAID_COHORT_END = "2026-09-01T00:00:00Z"; // exclusive

// H10 Build rate limits raised
// rate-limit episodes per 1,000 sampled requests, by plan at the request (episodes happen during traffic)
const RL_PER_1K_REQ = { free: 250, build: 27, scale: 3.8, enterprise: 1.3 };
const RL_RAISE_MULT = 0.4;          // Build rate-limit episodes per request after the raise

// realism: collaboration and housekeeping volume
const INVITE_KEEP = { individual: 0.05, startup: 0.3, growth: 0.5, enterprise: 0.6 };
const KEY_ROTATE_KEEP = 0.3;

// ── DATA ARRAYS ──
const SIZE_WEIGHTS_NEW = { individual: 45, startup: 35, growth: 14, enterprise: 6 };
const SIZE_WEIGHTS_EST = { individual: 25, startup: 35, growth: 25, enterprise: 15 };
const PLAN_MIX_EST = {
	individual: { free: 60, build: 38, scale: 2, enterprise: 0 },
	startup: { free: 30, build: 55, scale: 13, enterprise: 2 },
	growth: { free: 12, build: 45, scale: 33, enterprise: 10 },
	enterprise: { free: 5, build: 20, scale: 30, enterprise: 45 },
};
const USE_CASE_WEIGHTS = { chat_assistant: 26, coding: 22, document_processing: 20, agents: 18, content_generation: 14 };
const SDK_WEIGHTS = { python: 50, typescript: 30, java: 8, go: 7, rest: 5 };
const EU_ROUTED = new Set(["GB", "DE", "FR", "IT", "ES", "RU", "TR", "IL", "ZA", "NG", "EG"]);
const WEST_ROUTED = new Set(["CN", "JP", "IN", "AU", "KR"]);
const US_WEST_STATES = new Set(["California", "Washington", "Oregon", "Nevada", "Arizona", "Colorado", "Utah", "Idaho", "Montana", "Wyoming", "New Mexico", "Alaska", "Hawaii"]);
const API_EVENTS = new Set(["api request", "rate limit hit", "batch job submitted", "batch job completed", "eval run started", "eval run completed", "api key rotated"]);

// ── HELPERS ──
const salt = (uid, tag) => hashFloat(`${uid}|${tag}`);
const round2 = (n) => Math.round(n * 100) / 100;
const T = (e) => dayjs.utc(e.time).valueOf();
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const jitter = (key, spread) => 1 + (hashFloat(key) - 0.5) * 2 * spread;
const logNormal = (sigma) => Math.exp(chance.normal({ mean: 0, dev: sigma }));
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
const inIncident = (t) => t >= ms(INCIDENT_START) && t < ms(INCIDENT_END);
const priceIn = (model, t) => PRICE_IN[model] * (model === "swift-2" && t >= ms(SWIFT_PRICE_CUT) ? SWIFT_PRICE_CUT_FACTOR : 1);
const priceOut = (model, t) => PRICE_OUT[model] * (model === "swift-2" && t >= ms(SWIFT_PRICE_CUT) ? SWIFT_PRICE_CUT_FACTOR : 1);
const listValueUsd = (model, t, inTok, cached, outTok) =>
	((inTok - cached) * priceIn(model, t) + cached * priceIn(model, t) * CACHED_INPUT_PRICE_SHARE + outTok * priceOut(model, t)) / 1e6;
// paced daily budget per paid channel: the channel buys signups at its cost per signup, so the
// window budget = CPL × the signups it brought in, spread over the window (weekday shape, day noise)
const dailyBudgetUsd = (ch) => {
	if (!signupAgg) {
		signupAgg = {};
		for (const c of SIGNUP_CHANNEL.values()) signupAgg[c] = (signupAgg[c] ?? 0) + 1;
	}
	return CPL_USD[ch] * (signupAgg[ch] ?? 0) / WINDOW_DAYS;
};
const paidSpend = (date, ch) => round2(dailyBudgetUsd(ch) * SPEND_WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()] * jitter(`spend|${date}|${ch}`, SPEND_NOISE));
// seeded log-normal lag from a uniform salt (inverse normal CDF, Acklam's rational approximation)
const invNorm = (p) => {
	const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
	const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
	const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
	const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
	const q0 = Math.min(Math.max(p, 1e-9), 1 - 1e-9);
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
const upgradeLagMs = (uid) => UPGRADE_LAG_MEDIAN_D * Math.exp(UPGRADE_LAG_SIGMA * invNorm(salt(uid, "upgrade-lag"))) * DAY_MS;
const routeRegion = (profile) => {
	const cc = profile.country_code;
	if (EU_ROUTED.has(cc)) return "eu-west";
	if (WEST_ROUTED.has(cc)) return "us-west";
	if (cc === "US" && US_WEST_STATES.has(profile.region)) return "us-west";
	return "us-east";
};

// warehouse accumulators: per-account usage, rebuilt into day aggregates on demand
// (keyed by account so a repeated generation in one process overwrites, never doubles)
const USAGE_BY_USER = new Map();
let usageAgg = null;
const SIGNUP_CHANNEL = new Map(); // in-window signups: account → acquisition channel (paid media budgets)
let signupAgg = null;
const ONBOARD_REQ_IDS = new Set(); // insert_id of each onboarding funnel's first api request
const UPGRADE_BANK = { upgrade: null, view: null }; // first upgrade pass any account produced
const TEMPLATE_BANK = { evalStart: null, evalDone: null, rateLimit: null }; // first engine-generated eval unit and rate-limit episode any account produced
// H5 systematic sampling state: new API accounts seen so far by early eval runs
const DARK_SEEN = [0, 0];            // 0 and 1 runs
const LAPSE_SEEN = [0, 0, 0, 0];     // 0, 1, 2, 3+ runs
const LAPSER_SEEN = [0, 0, 0, 0];    // lapsers among them
const GOLDEN = (Math.sqrt(5) - 1) / 2;
// true for an exact `share` of consecutive calls k = 0, 1, 2, ... (offset in [0, 1) sets the phase)
const systematic = (k, share, offset) => Math.floor((k + 1) * share + offset) > Math.floor(k * share + offset);
// declared property pools (clones redraw from the same distributions as engine events)
const LIMIT_TYPE_WEIGHTS = { requests_per_minute: 55, input_tokens_per_minute: 30, output_tokens_per_minute: 15 };
const RETRY_AFTER_SECONDS = [1, 2, 5, 10, 15, 20, 30, 60];
const EVAL_TYPES = ["accuracy", "accuracy", "safety", "regression", "latency", "custom_rubric"];
const BILLING_SECTIONS = ["plans", "plans", "credits", "payment_methods"];
const declared = (event, prop) => {
	const pool = config.events.find((e) => e.event === event).properties[prop];
	if (!Array.isArray(pool)) throw new Error(`ai-platform: ${event}.${prop} is not a value array`);
	return pool;
};
const poissonInv = (lambda, p) => {
	let k = 0, term = Math.exp(-lambda), cdf = term;
	while (p > cdf && k < 60) { k++; term *= lambda / k; cdf += term; }
	return k;
};

function buildUsageAgg() {
	const byModel = new Map();
	const byRegion = new Map();
	for (const rec of USAGE_BY_USER.values()) {
		for (const [k, v] of rec.byModel) {
			const a = byModel.get(k) || { ok: 0, inTok: 0, cached: 0, outTok: 0, freeUsd: 0 };
			a.ok += v.ok; a.inTok += v.inTok; a.cached += v.cached; a.outTok += v.outTok; a.freeUsd += v.freeUsd;
			byModel.set(k, a);
		}
		for (const [k, v] of rec.byRegion) {
			const a = byRegion.get(k) || { req: 0, err5xx: 0, lat: [] };
			a.req += v.req; a.err5xx += v.err5xx;
			for (const x of v.lat) a.lat.push(x);
			byRegion.set(k, a);
		}
	}
	return { byModel, byRegion };
}

function handleUserHook(profile, meta) {
	const uid = profile.distinct_id;
	const born = meta.userIsBornInDataset;
	profile.company_size = pickWeighted(born ? SIZE_WEIGHTS_NEW : SIZE_WEIGHTS_EST, salt(uid, "size"));
	profile.use_case = pickWeighted(USE_CASE_WEIGHTS, salt(uid, "use-case"));
	profile.sdk_language = pickWeighted(SDK_WEIGHTS, salt(uid, "sdk"));
	profile.inference_region = routeRegion(profile);
	if (born) {
		profile.plan_tier = "free";
		profile.customer_since = dayKey(ms(profile.created ?? meta.user.created));
		return profile;
	}
	// established accounts: tenure skews recent (the platform is growing), capped at the API launch (2024-03-01)
	const maxTenure = Math.round((ms(DATASET_START) - ms("2024-03-01T00:00:00Z")) / DAY_MS);
	const tenureDays = Math.min(maxTenure, -Math.log(1 - salt(uid, "tenure") * 0.999) * 200);
	const sinceMs = ms(DATASET_START) - tenureDays * DAY_MS;
	profile.customer_since = dayKey(sinceMs);
	if (tenureDays < UPGRADE_RECENT_DAYS) {
		// recent accounts follow the new-account upgrade rule; an upgrade due before June 4 already happened
		const upgrader = salt(uid, "upgrader") < UPGRADE_BASE * (UPGRADE_KEEP[profile.acquisition_channel] ?? 1);
		profile.plan_tier = upgrader && sinceMs + upgradeLagMs(uid) < ms(DATASET_START) ? "build" : "free";
		return profile;
	}
	profile.plan_tier = pickWeighted(PLAN_MIX_EST[profile.company_size], salt(uid, "plan"));
	return profile;
}

function handleFunnelPost(record, meta) {
	if (meta && meta.isFirstFunnel && Array.isArray(record)) {
		const req = record.find((e) => e.event === "api request");
		if (req && req.insert_id) ONBOARD_REQ_IDS.add(req.insert_id);
	}
	return record;
}

// H5: make exactly `target` eval units start in [fromMs, toMs): drop whole units (start + completion,
// same eval_id) in a salted order, or clone units onto the account's own activity in that span
function realizeEarlyEvals(events, target, uid, fromMs, toMs, startTpl, doneTpl, loc) {
	const inSpan = (e) => { const t = T(e); return t >= fromMs && t < toMs; };
	const early = events.filter((e) => e.event === "eval run started" && inSpan(e));
	if (early.length > target) {
		early.sort((a, b) => hashFloat(`${uid}|${a.eval_id}`) - hashFloat(`${uid}|${b.eval_id}`));
		const drop = new Set(early.slice(target).map((e) => e.eval_id));
		return events.filter((e) => !((e.event === "eval run started" || e.event === "eval run completed") && drop.has(e.eval_id)));
	}
	if (early.length === target) return events;
	if (!startTpl || !doneTpl) return events; // only before the run's first engine eval unit exists; the caller reads the realized count
	const anchors = events.filter((e) => inSpan(e) && !e.event.endsWith("completed") && e.event !== "$experiment_started");
	for (let k = early.length; k < target; k++) {
		const a = anchors[Math.floor(hashFloat(`${uid}|eval-anchor|${k}`) * anchors.length)];
		const t = Math.max(fromMs + 1000, Math.min(toMs - 1000, T(a) + (2 + 38 * hashFloat(`${uid}|eval-gap|${k}`)) * MIN_MS));
		const evalId = `eval_${chance.hash({ length: 12 })}`;
		events.push(cloneEvent(startTpl, {
			time: new Date(t).toISOString(), user_id: uid, ...loc, eval_id: evalId,
			eval_type: chance.pickone(EVAL_TYPES),
			test_cases: chance.pickone(declared("eval run started", "test_cases")),
		}));
		// the completion is re-timed from its start at the end of the hook (duration_minutes)
		if (chance.bool({ likelihood: EVAL_COMPLETE_PCT })) {
			events.push(cloneEvent(doneTpl, {
				time: new Date(t).toISOString(), user_id: uid, ...loc, eval_id: evalId,
				pass_rate: chance.pickone(declared("eval run completed", "pass_rate")),
				duration_minutes: chance.pickone(declared("eval run completed", "duration_minutes")),
			}));
		}
	}
	return events;
}

function handleEverything(events, meta) {
	if (!events.length) return events;
	const profile = meta.profile;
	const uid = profile.distinct_id;
	const END = ms(DATASET_END);
	const signup = events.find((e) => e.event === "account created");
	const birthMs = signup ? T(signup) : null;

	// clone templates: the account's own engine-generated eval unit and rate-limit episode, else the
	// first ones any account produced (copied before any filter or mutation below)
	const ownEvalStart = events.find((e) => e.event === "eval run started");
	const ownEvalDone = ownEvalStart && events.find((e) => e.event === "eval run completed" && e.eval_id === ownEvalStart.eval_id);
	const ownRateLimit = events.find((e) => e.event === "rate limit hit");
	if (!TEMPLATE_BANK.evalStart && ownEvalStart && ownEvalDone) { TEMPLATE_BANK.evalStart = { ...ownEvalStart }; TEMPLATE_BANK.evalDone = { ...ownEvalDone }; }
	if (!TEMPLATE_BANK.rateLimit && ownRateLimit) TEMPLATE_BANK.rateLimit = { ...ownRateLimit };
	const evalStartTpl = ownEvalStart && ownEvalDone ? { ...ownEvalStart } : TEMPLATE_BANK.evalStart;
	const evalDoneTpl = ownEvalStart && ownEvalDone ? { ...ownEvalDone } : TEMPLATE_BANK.evalDone;
	const rateLimitTpl = ownRateLimit ? { ...ownRateLimit } : TEMPLATE_BANK.rateLimit;

	// ── onboarding outcome: no first request → no working integration ──
	const onboarded = !signup || events.some((e) => ONBOARD_REQ_IDS.has(e.insert_id));
	if (!onboarded) events = events.filter((e) => !API_EVENTS.has(e.event));

	// ── adoption and volume realism (whole linked units) ──
	const batchUser = salt(uid, "batch") < (BATCH_SHARE[profile.company_size] ?? 0.3);
	const batchIntensity = 0.3 + 0.7 * salt(uid, "batch-int");
	// evals are a young-account behavior: accounts that joined from EVAL_YOUNG_SINCE on run on the
	// weight-5 Evals funnel; they keep every run in their first 14 days, then fade to the established
	// rate (1/EVAL_WEIGHT_NEW of the runs) by day 35, so eval volume follows account age, not the window start
	const sinceMs = signup ? birthMs : ms(`${profile.customer_since}T12:00:00Z`);
	const young = profile.customer_since >= EVAL_YOUNG_SINCE;
	const evalUser = salt(uid, "eval") < (EVAL_SHARE[profile.primary_role] ?? 0.35) + (young ? EVAL_SHARE_NEW_BOOST : 0);
	const evalIntensity = 0.3 + 0.7 * salt(uid, "eval-int");
	const evalAgeKeep = (t) => {
		if (!young) return 1;
		const age = (t - sinceMs) / DAY_MS;
		if (age < EVAL_DAYS) return 1;
		if (age >= EVAL_FADE_END_DAYS) return 1 / EVAL_WEIGHT_NEW;
		return 1 - (1 - 1 / EVAL_WEIGHT_NEW) * (age - EVAL_DAYS) / (EVAL_FADE_END_DAYS - EVAL_DAYS);
	};
	const evalStartMs = new Map();
	for (const e of events) if (e.event === "eval run started" && !evalStartMs.has(e.eval_id)) evalStartMs.set(e.eval_id, T(e));
	const unitKeep = new Map();
	const keepUnit = (id, keepShare) => {
		if (!unitKeep.has(id)) unitKeep.set(id, chance.bool({ likelihood: keepShare * 100 }));
		return unitKeep.get(id);
	};
	events = events.filter((e) => {
		if (e.event === "batch job submitted" || e.event === "batch job completed") return batchUser && keepUnit(e.batch_id, batchIntensity);
		if (e.event === "eval run started" || e.event === "eval run completed") return evalUser && keepUnit(e.eval_id, evalIntensity * evalAgeKeep(evalStartMs.get(e.eval_id) ?? T(e)));
		if (e.event === "member invited") {
			if (signup && T(e) < birthMs + 14 * DAY_MS) return chance.bool({ likelihood: Math.min(1, (INVITE_KEEP[profile.company_size] ?? 0.3) * 2) * 100 });
			return chance.bool({ likelihood: (INVITE_KEEP[profile.company_size] ?? 0.3) * 100 });
		}
		if (e.event === "api key rotated") return chance.bool({ likelihood: KEY_ROTATE_KEEP * 100 });
		return true;
	});

	// upgrade template: the account's first engine-generated upgrade pass and its billing page
	// view, moved to the hook's upgrade moment below. An account with no pass of its own gets a
	// clone of the first pass any account produced (identity and location re-stamped).
	const upgrades = events.filter((e) => e.event === "plan upgraded").sort((a, b) => T(a) - T(b));
	let template = upgrades[0] || null;
	let templateView = null;
	if (template) {
		const tt = T(template);
		for (const e of events) if (e.event === "billing page viewed" && T(e) <= tt && (!templateView || T(e) > T(templateView))) templateView = e;
		if (!UPGRADE_BANK.upgrade) {
			UPGRADE_BANK.upgrade = { ...template };
			UPGRADE_BANK.view = templateView ? { ...templateView } : null;
		}
	}
	events = events.filter((e) => e.event !== "plan upgraded");
	const loc = (({ country, country_code, region, city }) => ({ country, country_code, region, city }))(events[0] || {});

	// ── new-account lifecycle: abandonment, organic lapse, H5 eval-driven retention ──
	let cutMs = Infinity;
	if (signup) {
		if (!onboarded) {
			if (salt(uid, "abandon") < NO_KEY_ABANDON_SHARE) cutMs = birthMs + (NO_KEY_ABANDON_MIN + salt(uid, "abandon-day") * (NO_KEY_ABANDON_MAX - NO_KEY_ABANDON_MIN)) * DAY_MS;
		} else {
			// H5: the number of eval runs started in the first 14 days is a salted per-account draw (mixed
			// Poisson, mean EVAL_EARLY_MEAN for evaluating accounts), independent of how dense the engine
			// made the account's early activity, and its intensity salt is separate from the one that thins
			// later runs (a heavy early evaluator is not also a heavy day-30 evaluator)
			const early = evalUser ? poissonInv(EVAL_EARLY_MEAN * (0.3 + 0.7 * salt(uid, "eval-early-int")) / 0.65, salt(uid, "eval-early-n")) : 0;
			// organic lapse: an exact LAPSE_SHARE of each early-eval group (0, 1, 2, 3+) lapses, on days spread
			// evenly over LAPSE_DAY_MIN-LAPSE_DAY_MAX (systematic sampling + golden-ratio sequence in
			// generation order), so organic lapse adds no group-to-group noise to the H5 read
			const g = Math.min(early, LAPSE_SEEN.length - 1);
			if (systematic(LAPSE_SEEN[g]++, LAPSE_SHARE, hashFloat(`${SEED}|lapse-offset|${g}`))) {
				const spread = (hashFloat(`${SEED}|lapse-day-offset|${g}`) + LAPSER_SEEN[g]++ * GOLDEN) % 1;
				cutMs = birthMs + (LAPSE_DAY_MIN + spread * (LAPSE_DAY_MAX - LAPSE_DAY_MIN)) * DAY_MS;
			}
			// the eval units are realized on the account's own activity before any lapse, by dropping or
			// cloning whole eval units
			const earlyEnd = Math.min(birthMs + EVAL_DAYS * DAY_MS, cutMs);
			events = realizeEarlyEvals(events, early, uid, birthMs, earlyEnd, evalStartTpl, evalDoneTpl, loc);
			const realized = events.filter((e) => e.event === "eval run started" && T(e) >= birthMs && T(e) < earlyEnd).length;
			// the dark share is exact within each group (systematic sampling over the run's accounts in
			// generation order), so the read carries no coin-flip noise on top of organic lapse
			if (realized < EVAL_MIN) {
				if (systematic(DARK_SEEN[realized]++, DARK_SHARE_BY_EVALS[realized], hashFloat(`${SEED}|dark-offset|${realized}`))) cutMs = Math.min(cutMs, birthMs + DARK_AFTER_DAYS * DAY_MS);
			}
		}
		// completions are system-sent: a job or eval started before the account went quiet still finishes
		if (cutMs < Infinity) events = events.filter((e) => T(e) < cutMs || e.event === "batch job completed" || e.event === "eval run completed");
	}
	const lastMs = events.reduce((m, e) => (e.event.endsWith("completed") ? m : Math.max(m, T(e))), 0);

	// ── self-serve upgrade (Free → Build): who and when ──
	const initialPlan = profile.plan_tier;
	let upgradeMs = Infinity;
	if (initialPlan === "free" && (template || UPGRADE_BANK.upgrade)) {
		const recent = signup || sinceMs >= ms(DATASET_START) - UPGRADE_RECENT_DAYS * DAY_MS;
		let target = null;
		if (recent) {
			const upgrader = salt(uid, "upgrader") < UPGRADE_BASE * (UPGRADE_KEEP[profile.acquisition_channel] ?? 1);
			if (upgrader && onboarded) target = sinceMs + upgradeLagMs(uid);
		} else if (salt(uid, "upgrader-est") < UPGRADE_ESTABLISHED) {
			target = ms(DATASET_START) + salt(uid, "upgrade-day") * (END - ms(DATASET_START));
		}
		// an account upgrades while it is still around: before its lapse, within a week of its last activity
		if (target !== null && target >= ms(DATASET_START) && target < cutMs && target <= Math.min(END, lastMs + 7 * DAY_MS)) upgradeMs = Math.floor(target);
	}
	if (upgradeMs < Infinity) {
		if (!template) template = cloneEvent(UPGRADE_BANK.upgrade, { user_id: uid, ...loc, prepaid_credits_usd: chance.pickone([10, 25, 25, 50, 50, 100, 250, 500]) });
		if (!templateView && UPGRADE_BANK.view) templateView = cloneEvent(UPGRADE_BANK.view, { user_id: uid, ...loc, billing_section: chance.pickone(BILLING_SECTIONS) });
		template.time = new Date(upgradeMs).toISOString();
		events.push(template);
		if (templateView) {
			templateView.time = new Date(upgradeMs - chance.integer({ min: 1, max: 25 }) * MIN_MS).toISOString();
			if (!events.includes(templateView)) events.push(templateView);
		}
	}
	const planAt = (t) => (t >= upgradeMs ? "build" : initialPlan);

	// ── per-account traits for the request log ──
	const region = profile.inference_region;
	const swiftBase = SWIFT_BASE_MIN + salt(uid, "swift") * (SWIFT_BASE_MAX - SWIFT_BASE_MIN);
	const swiftSwitch = ms(SWIFT_PRICE_CUT) + salt(uid, "swift-switch") * SWIFT_SHIFT_RAMP_DAYS * DAY_MS;
	const a3Paid = salt(uid, "atlas3") < ATLAS3_PAID_ADOPTERS;
	const a3PaidStart = ms(ATLAS3_LAUNCH) + salt(uid, "atlas3-start") * ATLAS3_RAMP_DAYS * DAY_MS;
	const a3Free = salt(uid, "atlas3-free") < ATLAS3_FREE_ADOPTERS;
	const a3FreeStart = ms(ATLAS3_FREE) + salt(uid, "atlas3-free-start") * ATLAS3_FREE_RAMP_DAYS * DAY_MS;
	const a3Use = ATLAS3_USE_MEAN + (salt(uid, "atlas3-use") - 0.5) * 2 * ATLAS3_USE_SPREAD;
	const cacheAdopter = salt(uid, "cache") < CACHE_ADOPTER_SHARE;
	const cacheStart = ms(CACHE_LAUNCH) + salt(uid, "cache-start") * CACHE_RAMP_DAYS * DAY_MS;
	const cacheHit = CACHE_HIT_MEAN + (salt(uid, "cache-hit") - 0.5) * 2 * CACHE_HIT_SPREAD;
	const toolShare = TOOL_SHARE_BY_USE_CASE[profile.use_case] ?? 0.05;
	const modelAt = (t, plan) => {
		const swiftShare = plan === "build" && t >= swiftSwitch ? swiftBase * SWIFT_SHIFT_MULT : swiftBase;
		if (chance.random() < swiftShare) return "swift-2";
		const a3 = PAID_PLANS.includes(plan) ? a3Paid && t >= a3PaidStart : a3Free && t >= a3FreeStart;
		return a3 && chance.random() < a3Use ? "atlas-3" : "atlas-2";
	};

	// ── traffic volume by plan at the moment: Free accounts run small, throttled workloads;
	// Scale and Enterprise accounts run production traffic at 2-3x a Build account's volume ──
	// rate-limit episodes are re-made from the request stream below (H10); engine episodes become the template pool
	const rlPool = events.filter((e) => e.event === "rate limit hit");
	events = events.filter((e) => e.event !== "rate limit hit");
	const sized = [];
	for (const e of events) {
		if (e.event !== "api request" || ONBOARD_REQ_IDS.has(e.insert_id)) { sized.push(e); continue; }
		const t = T(e);
		const plan = planAt(t);
		if (plan === "free" && !chance.bool({ likelihood: FREE_TRAFFIC_KEEP * 100 })) continue;
		sized.push(e);
		// production traffic runs on weekends too: each Sat/Sun request gains a clone with WEEKEND_API_LIFT
		const base = PLAN_TRAFFIC_MULT[plan] ?? 1;
		let copies = base;
		const dow = new Date(t).getUTCDay();
		if (dow === 0 || dow === 6) for (let k = 0; k < base; k++) if (chance.random() < WEEKEND_API_LIFT) copies++;
		for (let k = 1; k < copies; k++) {
			// tokens and latency are re-drawn for every request in the pass below
			sized.push(cloneEvent(e, { time: new Date(t + chance.integer({ min: 2, max: 600 }) * 1000).toISOString() }));
		}
	}
	events = sized;
	// time order, so the Free allowance below is spent in the order the requests arrive
	events.sort((a, b) => T(a) - T(b));

	const usage = { byModel: new Map(), byRegion: new Map() };
	const freeUsed = new Map(); // calendar month → list-price usage on the Free plan (USD)
	const freeBlocked = new Set();
	const kept = [];
	for (const e of events) {
		const t = T(e);
		const plan = planAt(t);
		e.plan_tier = plan;
		if (e.event === "playground session" || e.event === "eval run started" || e.event === "batch job submitted") {
			e.model = modelAt(t, plan);
		}
		if (e.event === "batch job submitted") e.inference_region = region;
		if (e.event === "api request") {
			e.inference_region = region;
			e.sdk_language = profile.sdk_language;
			const model = modelAt(t, plan);
			e.model = model;
			// status: background error mix
			const r = chance.random();
			let status = r < BASE_STATUS[200] ? 200 : r < BASE_STATUS[200] + BASE_STATUS[400] ? 400 : r < BASE_STATUS[200] + BASE_STATUS[400] + BASE_STATUS[500] ? 500 : 529;
			// token counts: log-normal prompt and response sizes
			e.input_tokens = Math.round(Math.min(INPUT_MAX, Math.max(INPUT_MIN, INPUT_MEDIAN * logNormal(INPUT_SIGMA))));
			let out = OUTPUT_MEDIAN * logNormal(OUTPUT_SIGMA);
			// H8: tool use by use case; tool definitions and results inflate the prompt
			const tool = chance.random() < toolShare;
			e.tool_use = tool;
			if (tool) e.input_tokens = Math.round(e.input_tokens * TOOL_INPUT_MULT);
			// H2: atlas-3 answers run longer
			if (model === "atlas-3") out *= ATLAS3_OUTPUT_MULT;
			e.output_tokens = Math.max(1, Math.round(Math.min(OUTPUT_MAX, out)));
			e.stop_reason = e.output_tokens >= OUTPUT_MAX ? "max_tokens"
				: tool ? (chance.bool({ likelihood: 65 }) ? "tool_use" : "end_turn")
				: chance.weighted(["end_turn", "max_tokens", "stop_sequence"], [90, 5, 5]);
			// H6: us-east capacity incident
			let slow = 1;
			if (status === 200 && region === INCIDENT_REGION && inIncident(t)) {
				if (chance.random() < INCIDENT_FAIL) status = 529;
				else slow = INCIDENT_LATENCY_MULT;
			}
			// H1: prompt caching
			const hit = status === 200 && cacheAdopter && t >= cacheStart && chance.random() < cacheHit;
			e.cache_hit = hit;
			e.cached_input_tokens = hit ? Math.round(e.input_tokens * (CACHE_PREFIX_MIN + chance.random() * (CACHE_PREFIX_MAX - CACHE_PREFIX_MIN))) : 0;
			// latency = time to first token (overhead + prefill; a cached prefix skips most of its prefill)
			// + decode time (grows with the answer, model-specific ms per token; caching does not change it)
			const prefillTokens = e.input_tokens - e.cached_input_tokens * (1 - CACHE_PREFILL_SHARE);
			let ttft = (TTFT_BASE_MS + prefillTokens * TTFT_MS_PER_INPUT) * logNormal(LATENCY_SIGMA) * slow;
			let latency = ttft + e.output_tokens * MS_PER_OUTPUT_TOKEN[model] * logNormal(LATENCY_SIGMA) * slow;
			e.status_code = status;
			e.error_type = status === 200 ? "none" : status === 400 ? "invalid_request_error" : status === 500 ? "api_error" : "overloaded_error";
			if (status !== 200) {
				e.output_tokens = 0;
				e.stop_reason = "error";
				latency = 120 + chance.random() * (status === 529 ? 900 : 400);
				ttft = latency; // failed requests return an error response, no tokens
			}
			e.time_to_first_token_ms = Math.round(ttft);
			e.latency_ms = Math.round(latency);
			// Free allowance: the balance is checked before each request, so the request that uses up the
			// month's allowance completes and later ones are rejected until the 1st (rejected calls are not
			// metered or logged); the onboarding request always goes through
			if (plan === "free") {
				const mo = dayKey(t).slice(0, 7);
				if (freeBlocked.has(mo) && !ONBOARD_REQ_IDS.has(e.insert_id)) continue;
				const used = (freeUsed.get(mo) ?? 0) + (status === 200 ? API_SAMPLE_RATE * listValueUsd(model, t, e.input_tokens, e.cached_input_tokens, e.output_tokens) : 0);
				freeUsed.set(mo, used);
				if (used >= FREE_MONTHLY_ALLOWANCE_USD) freeBlocked.add(mo);
			}
			if (t <= END) {
				const dk = dayKey(t);
				const mk = `${dk}|${model}`;
				const m = usage.byModel.get(mk) || { ok: 0, inTok: 0, cached: 0, outTok: 0, freeUsd: 0 };
				if (status === 200) {
					m.ok++; m.inTok += e.input_tokens; m.cached += e.cached_input_tokens; m.outTok += e.output_tokens;
					if (plan === "free") m.freeUsd += listValueUsd(model, t, e.input_tokens, e.cached_input_tokens, e.output_tokens);
				}
				usage.byModel.set(mk, m);
				const rk = `${dk}|${region}`;
				const g = usage.byRegion.get(rk) || { req: 0, err5xx: 0, lat: [] };
				g.req++;
				if (status >= 500) g.err5xx++;
				if (status === 200) g.lat.push(e.latency_ms);
				usage.byRegion.set(rk, g);
			}
			kept.push(e);
			// H10: rate-limit episodes happen during traffic, at a per-request rate by plan at the moment;
			// Build limits raised on RATE_LIMIT_RAISE
			const rlRate = RL_PER_1K_REQ[plan] / 1000 * (plan === "build" && t >= ms(RATE_LIMIT_RAISE) ? RL_RAISE_MULT : 1);
			if (chance.random() < rlRate) {
				const tr = t + chance.integer({ min: 1, max: 30 }) * 1000;
				if (tr <= END) {
					let rl = rlPool.pop();
					// an account with no engine episode of its own clones the bank's; before the run's first
					// engine episode exists (the first few accounts) there is nothing to clone and the episode is skipped
					if (!rl && rateLimitTpl) {
						rl = cloneEvent(rateLimitTpl, {
							...loc,
							limit_type: pickWeighted(LIMIT_TYPE_WEIGHTS, chance.random()),
							retry_after_seconds: chance.pickone(RETRY_AFTER_SECONDS),
						});
					}
					if (rl) {
						rl.time = new Date(tr).toISOString();
						rl.user_id = uid;
						rl.model = model;
						rl.plan_tier = planAt(tr);
						kept.push(rl);
					}
				}
			}
			continue;
		}
		kept.push(e);
	}
	events = kept;

	// ── H4: batch turnaround by plan (each completion is re-timed from its submission) ──
	const subs = new Map();
	for (const e of events) if (e.event === "batch job submitted") subs.set(e.batch_id, e);
	const dropBatch = new Set();
	for (const e of events) {
		if (e.event !== "batch job completed") continue;
		const s = subs.get(e.batch_id);
		if (!s) { dropBatch.add(e); continue; }
		const plan = s.plan_tier;
		let gapH = BATCH_MEDIAN_H * logNormal(BATCH_SIGMA) * (BATCH_PLAN_MULT[plan] ?? 1);
		e.batch_status = "completed";
		if (gapH > BATCH_SLA_H) { gapH = BATCH_SLA_H; e.batch_status = "expired"; }
		const tc = T(s) + gapH * HOUR_MS;
		e.time = new Date(tc).toISOString();
		e.processing_hours = Math.round(gapH * 100) / 100;
		e.model = s.model;
		e.request_count = s.request_count;
		e.plan_tier = planAt(tc);
		if (tc > END) dropBatch.add(e);
	}
	if (dropBatch.size) events = events.filter((e) => !dropBatch.has(e));

	const evStarts = new Map();
	for (const e of events) if (e.event === "eval run started") evStarts.set(e.eval_id, e);
	// eval runs: a completion lands duration_minutes after its start and carries the run's model
	const dropEval = new Set();
	for (const e of events) {
		if (e.event !== "eval run completed") continue;
		const s = evStarts.get(e.eval_id);
		if (!s) { dropEval.add(e); continue; }
		const tc = T(s) + e.duration_minutes * MIN_MS;
		e.time = new Date(tc).toISOString();
		e.model = s.model;
		e.plan_tier = planAt(tc);
		if (tc > END) dropEval.add(e);
	}
	if (dropEval.size) events = events.filter((e) => !dropEval.has(e));

	if (upgradeMs < Infinity) profile.plan_tier = "build";
	USAGE_BY_USER.set(uid, usage);
	usageAgg = null;
	if (signup) SIGNUP_CHANNEL.set(uid, signup.acquisition_channel);
	signupAgg = null;
	return events;
}

// warehouse rows: metered usage, fleet health, and media spend layered on event-derived volumes
function handleWarehouse(row, meta) {
	// every account is generated before the first warehouse row: reset per-run state so a second
	// generation in the same process starts from scratch (usage stays: the rows below read it)
	DARK_SEEN.fill(0); LAPSE_SEEN.fill(0); LAPSER_SEEN.fill(0);
	UPGRADE_BANK.upgrade = UPGRADE_BANK.view = null;
	TEMPLATE_BANK.evalStart = TEMPLATE_BANK.evalDone = TEMPLATE_BANK.rateLimit = null;
	if (meta.isBackfill) return row;
	if (!usageAgg) usageAgg = buildUsageAgg();
	const date = row.date;
	const prev = dayKey(ms(`${date}T00:00:00Z`) - DAY_MS);
	if (meta.metricName === "developer_marketing_daily") {
		row.spend_usd = paidSpend(date, row.acquisition_channel);
		return row;
	}
	if (meta.metricName === "model_billing_daily") {
		// metering posts each request's usage when the request closes; a varying share of a
		// day's usage lands in the next day's batch, and a few requests never reached analytics
		const model = row.model;
		const zero = { ok: 0, inTok: 0, cached: 0, outTok: 0, freeUsd: 0 };
		const cur = usageAgg.byModel.get(`${date}|${model}`) || zero;
		const before = usageAgg.byModel.get(`${prev}|${model}`) || zero;
		const late = 0.05 + 0.12 * hashFloat(`late|${date}|${model}`);
		const latePrev = 0.05 + 0.12 * hashFloat(`late|${prev}|${model}`);
		const lost = jitter(`lost|${date}|${model}`, 0.04) * 1.03;
		const mixRaw = (k) => API_SAMPLE_RATE * lost * ((1 - late) * cur[k] + latePrev * before[k]);
		const mix = (k) => Math.round(mixRaw(k));
		row.requests_billed = mix("ok");
		row.input_tokens_billed = mix("inTok");
		row.cached_input_tokens_billed = Math.min(row.input_tokens_billed, mix("cached"));
		row.output_tokens_billed = mix("outTok");
		const t = ms(`${date}T00:00:00Z`);
		row.list_price_input_per_mtok = round2(priceIn(model, t));
		row.list_price_output_per_mtok = round2(priceOut(model, t));
		row.usage_value_usd = round2(((row.input_tokens_billed - row.cached_input_tokens_billed) * row.list_price_input_per_mtok
			+ row.cached_input_tokens_billed * row.list_price_input_per_mtok * CACHED_INPUT_PRICE_SHARE
			+ row.output_tokens_billed * row.list_price_output_per_mtok) / 1e6);
		row.free_credit_usd = Math.min(row.usage_value_usd, round2(mixRaw("freeUsd")));
		row.revenue_usd = round2(row.usage_value_usd - row.free_credit_usd);
		return row;
	}
	if (meta.metricName === "inference_fleet_daily") {
		const reg = row.inference_region;
		const g = usageAgg.byRegion.get(`${date}|${reg}`) || { req: 0, err5xx: 0, lat: [] };
		const t = ms(`${date}T00:00:00Z`);
		const hit = reg === INCIDENT_REGION && inIncident(t);
		// first-party apps and internal eval pipelines run every day at a steady volume (no product event): ±8% by region-day, ±5% fleet-wide
		const internal = INTERNAL_REQS_PER_DAY[reg] * jitter(`internal|${date}|${reg}`, 0.08) * jitter(`internal|${date}`, 0.05);
		row.requests_served = Math.round((API_SAMPLE_RATE * g.req + internal) * jitter(`served|${date}|${reg}`, 0.03));
		const err = g.req ? g.err5xx / g.req : 0;
		row.error_rate_5xx = Math.round((err * jitter(`err|${date}|${reg}`, 0.08)) * 10000) / 10000;
		row.gpus_online = Math.round(REGION_GPUS[reg] * (hit ? 0.58 + 0.06 * hashFloat(`gpu|${date}|${reg}`) : 0.97 + 0.03 * hashFloat(`gpu|${date}|${reg}`)));
		row.gpu_utilization = round2(hit ? 0.97 + 0.02 * hashFloat(`util|${date}|${reg}`) : 0.62 + 0.18 * hashFloat(`util|${date}|${reg}`));
		// p95 of successful request latency in the region-day (the sampled request log stands for the
		// full traffic), ±3% for internal traffic and the gateway's own measurement window
		const lat = [...g.lat].sort((a, b) => a - b);
		const p95 = lat.length ? lat[Math.min(lat.length - 1, Math.floor(0.95 * lat.length))] : 0;
		row.p95_latency_ms = Math.round(p95 * jitter(`p95|${date}|${reg}`, 0.03));
		row.region_status = hit ? "major_outage" : "operational";
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
	credentials: { token },
	switches: {
		hasSessionIds: false,
		alsoInferFunnels: false,
		hasLocation: true,
		hasAndroidDevices: false,
		hasIOSDevices: false,
		hasDesktopDevices: false,
		hasBrowser: false,
		hasCampaigns: false,
		isAnonymous: false,
		hasAdSpend: false,
		hasAvatar: true,
	},
	identity: { avgDevicePerUser: 0 },

	events: [
		{
			event: "account created",
			weight: 1,
			isFirstEvent: true,
			isAuthEvent: true,
			properties: {
				signup_method: { __weights: { github: 40, google: 35, email: 18, sso: 7 } },
				acquisition_channel: (ctx) => ctx.profile.acquisition_channel,
			},
		},
		{
			event: "api key created",
			weight: 1,
			isStrictEvent: true,
			properties: {
				key_environment: { __weights: { development: 70, production: 30 } },
			},
		},
		{
			event: "api request",
			weight: 1,
			isStrictEvent: false,
			properties: {
				model: ["atlas-2"],
				input_tokens: [0],
				output_tokens: [0],
				cached_input_tokens: [0],
				cache_hit: [false],
				tool_use: [false],
				stream: [true, true, false],
				latency_ms: [0],
				time_to_first_token_ms: [0],
				status_code: [200],
				error_type: ["none"],
				stop_reason: ["end_turn"],
				inference_region: ["us-east"],
				sdk_language: ["python"],
			},
		},
		{
			event: "rate limit hit",
			weight: 6,
			isStrictEvent: false,
			properties: {
				limit_type: { __weights: LIMIT_TYPE_WEIGHTS },
				retry_after_seconds: RETRY_AFTER_SECONDS,
				model: ["atlas-2"],
			},
		},
		{
			event: "playground session",
			weight: 6,
			isStrictEvent: false,
			properties: {
				model: ["atlas-2"],
				turns: u.weighNumRange(1, 25, 0.4, 300),
				prompt_saved: [false, false, true],
			},
		},
		{
			event: "docs viewed",
			weight: 6,
			isStrictEvent: false,
			properties: {
				doc_section: ["quickstart", "messages_api", "tool_use", "prompt_caching", "batch_api", "models", "rate_limits", "errors", "pricing"],
				time_on_page_sec: u.weighNumRange(5, 600, 0.4, 300),
			},
		},
		{
			event: "usage dashboard viewed",
			weight: 5,
			isStrictEvent: false,
			properties: {
				dashboard_view: ["usage", "usage", "costs", "logs", "limits"],
				date_range: ["24h", "7d", "7d", "30d"],
			},
		},
		{
			event: "member invited",
			weight: 2,
			isStrictEvent: false,
			properties: {
				invitee_role: ["developer", "developer", "admin", "billing", "viewer"],
			},
		},
		{
			event: "api key rotated",
			weight: 1,
			isStrictEvent: false,
			properties: {
				rotation_reason: ["scheduled", "scheduled", "team_change", "suspected_leak"],
			},
		},
		{
			event: "batch job submitted",
			weight: 1,
			isStrictEvent: true,
			properties: {
				batch_id: ["unassigned"],
				model: ["atlas-2"],
				request_count: u.weighNumRange(50, 20000, 0.3, 300),
				inference_region: ["us-east"],
			},
		},
		{
			event: "batch job completed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				batch_id: ["unassigned"],
				model: ["atlas-2"],
				request_count: [0],
				batch_status: ["completed"],
				processing_hours: [0],
			},
		},
		{
			event: "eval run started",
			weight: 1,
			isStrictEvent: true,
			properties: {
				eval_id: ["unassigned"],
				eval_type: EVAL_TYPES,
				test_cases: u.weighNumRange(20, 2000, 0.3, 300),
				model: ["atlas-2"],
			},
		},
		{
			event: "eval run completed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				eval_id: ["unassigned"],
				model: ["atlas-2"],
				pass_rate: u.weighNumRange(40, 100, 0.8, 300),
				duration_minutes: u.weighNumRange(1, 90, 0.3, 300),
			},
		},
		{
			event: "billing page viewed",
			weight: 1,
			isStrictEvent: true,
			properties: {
				billing_section: BILLING_SECTIONS,
			},
		},
		{
			event: "plan upgraded",
			weight: 1,
			isStrictEvent: true,
			properties: {
				from_plan: ["free"],
				to_plan: ["build"],
				prepaid_credits_usd: [10, 25, 25, 50, 50, 100, 250, 500],
			},
		},
		{
			event: "$experiment_started",
			weight: 1,
			isStrictEvent: true,
			properties: {
				"Experiment name": [QUICKSTART_EXPERIMENT],
				"Variant name": ["Control", QUICKSTART_VARIANT],
			},
		},
	],

	funnels: [
		{
			name: "Onboarding",
			sequence: ["account created", "api key created", "api request"],
			isFirstFunnel: true,
			conversionRate: ONBOARD_CONV,
			timeToConvert: ONBOARD_TTC_H,
			order: "sequential",
			weight: 1,
			experiment: {
				name: QUICKSTART_EXPERIMENT,
				startDaysBeforeEnd: (ms(DATASET_END) - ms(QUICKSTART_START)) / DAY_MS,
				variants: [
					{ name: "Control" },
					{ name: QUICKSTART_VARIANT, conversionMultiplier: QUICKSTART_CONV_MULT, ttcMultiplier: QUICKSTART_TTC_MULT },
				],
			},
		},
		{
			// production traffic arrives in bursts: one pass is a run of sampled requests
			name: "API Traffic",
			sequence: Array(API_BURST_LEN).fill("api request"),
			conversionRate: 85,
			timeToConvert: 2,
			order: "sequential",
			weight: API_TRAFFIC_WEIGHT,
		},
		{
			name: "Batch Jobs",
			sequence: ["batch job submitted", "batch job completed"],
			conversionRate: 96,
			timeToConvert: 24,
			order: "sequential",
			weight: 1,
			props: { batch_id: () => `batch_${chance.hash({ length: 12 })}` },
		},
		{
			// teams building a new integration evaluate prompts and models often (young accounts;
			// the hook fades each account's extra runs out between day 14 and day 35)
			name: "Evals",
			sequence: ["eval run started", "eval run completed"],
			conditions: { customer_since: { gte: EVAL_YOUNG_SINCE } },
			conversionRate: 92,
			timeToConvert: 1,
			order: "sequential",
			weight: EVAL_WEIGHT_NEW,
			props: { eval_id: () => `eval_${chance.hash({ length: 12 })}` },
		},
		{
			name: "Evals",
			sequence: ["eval run started", "eval run completed"],
			conditions: { customer_since: { lt: EVAL_YOUNG_SINCE } },
			conversionRate: 92,
			timeToConvert: 1,
			order: "sequential",
			weight: 1,
			props: { eval_id: () => `eval_${chance.hash({ length: 12 })}` },
		},
		{
			name: "Upgrade",
			sequence: ["billing page viewed", "plan upgraded"],
			conditions: { plan_tier: "free" },
			conversionRate: 80,
			timeToConvert: 1,
			order: "sequential",
			weight: 1,
		},
	],

	warehouseMetrics: [
		{
			name: "inference_fleet_daily",
			type: "additive",
			grain: "day",
			source: { event: "api request", measure: "count", groupBy: "inference_region" },
			timeColumn: "date",
			valueColumn: "requests_served",
			columns: {
				error_rate_5xx: 0,
				gpus_online: 0,
				gpu_utilization: 0,
				p95_latency_ms: 0,
				region_status: "operational",
			},
		},
		{
			name: "model_billing_daily",
			type: "additive",
			grain: "day",
			source: { event: "api request", measure: "count", where: (e) => e.status_code === 200, groupBy: "model" },
			timeColumn: "date",
			valueColumn: "requests_billed",
			columns: {
				input_tokens_billed: 0,
				cached_input_tokens_billed: 0,
				output_tokens_billed: 0,
				list_price_input_per_mtok: 0,
				list_price_output_per_mtok: 0,
				usage_value_usd: 0,
				free_credit_usd: 0,
				revenue_usd: 0,
			},
		},
		{
			name: "developer_marketing_daily",
			type: "additive",
			grain: "day",
			source: { event: "account created", measure: "count", where: (e) => PAID_CHANNELS.includes(e.acquisition_channel), groupBy: "acquisition_channel" },
			timeColumn: "date",
			valueColumn: "spend_usd",
			columns: {
				platform_reported_signups: (ctx) => Math.round(paidSpend(dayKey(ctx.time), ctx.seriesKey) * PLATFORM_SIGNUP_INFLATION / CPL_USD[ctx.seriesKey] * jitter(`lead|${dayKey(ctx.time)}|${ctx.seriesKey}`, 0.25)),
				clicks: (ctx) => Math.round(paidSpend(dayKey(ctx.time), ctx.seriesKey) / (CPC_USD[ctx.seriesKey] * jitter(`cpc|${dayKey(ctx.time)}|${ctx.seriesKey}`, 0.15))),
				impressions: (ctx) => Math.round(ctx.row.clicks / (CTR[ctx.seriesKey] * jitter(`ctr|${dayKey(ctx.time)}|${ctx.seriesKey}`, 0.15))),
			},
		},
	],

	superProps: {
		plan_tier: ["free"],
	},

	userProps: {
		plan_tier: ["free"],
		company_size: ["individual"],
		use_case: ["chat_assistant"],
		sdk_language: ["python"],
		acquisition_channel: { __weights: CHANNEL_WEIGHTS },
		inference_region: ["us-east"],
		primary_role: ["backend_developer"],
		customer_since: ["2025-01-01"],
	},

	personas: [
		{ name: "ml_engineer", weight: 25, eventMultiplier: 1.5, properties: { primary_role: "ml_engineer" } },
		{ name: "backend_developer", weight: 35, eventMultiplier: 1.15, properties: { primary_role: "backend_developer" } },
		{ name: "data_scientist", weight: 20, eventMultiplier: 0.85, properties: { primary_role: "data_scientist" } },
		{ name: "founder", weight: 20, eventMultiplier: 0.6, properties: { primary_role: "founder" } },
	],

	retentionCurve: { type: "logarithmic", day1: 0.75, day7: 0.6, day30: 0.5 },

	hook(record, type, meta) {
		if (type === "user") return handleUserHook(record, meta);
		if (type === "funnel-post") return handleFunnelPost(record, meta);
		if (type === "everything") return handleEverything(record, meta);
		if (type === "warehouse") return handleWarehouse(record, meta);
		return record;
	},
};

// ── STORIES ──────────────────────────────────────────────────────────────
// Machine-checkable contract for hooks H1-H10. Evaluate with:
//   node dungeons/vertical/ai-platform/ai-platform.verify.mjs

const EV = `read_json_auto('{{PREFIX}}-EVENTS*.json*', sample_size=-1, union_by_name=true)`;
const US = `read_json_auto('{{PREFIX}}-USERS*.json*', sample_size=-1, union_by_name=true)`;
const WH = (table) => `read_json_auto('{{PREFIX}}-WAREHOUSE-${table}.json*', sample_size=-1, union_by_name=true)`;

// Identity prelude: every event is tracked server-side with user_id and there
// is no device_id, so Mixpanel's distinct_id is the user_id on every event.
const ID_CTE = `ev AS (SELECT user_id::VARCHAR AS uid, time::TIMESTAMP AS t, * FROM ${EV})`;

const TS = (iso) => dayjs.utc(iso).format("YYYY-MM-DD HH:mm:ss");
const D = (iso) => iso.slice(0, 10);
const band = (k) => [Math.round(k * 0.9 * 1000) / 1000, Math.round(k * 1.1 * 1000) / 1000];
const SQL_LIST = (xs) => xs.map((x) => `'${x}'`).join(", ");
const CACHE_RAMPED = TS(dayjs.utc(CACHE_LAUNCH).add(CACHE_RAMP_DAYS, "day"));
const ATLAS3_RAMPED = TS(dayjs.utc(ATLAS3_LAUNCH).add(ATLAS3_RAMP_DAYS, "day"));
const ATLAS3_FREE_RAMPED = TS(dayjs.utc(ATLAS3_FREE).add(ATLAS3_FREE_RAMP_DAYS, "day"));
const SWIFT_SHIFTED = TS(dayjs.utc(SWIFT_PRICE_CUT).add(SWIFT_SHIFT_RAMP_DAYS + 4, "day")); // 2026-09-01
const INC_BASE_FROM = TS(dayjs.utc(INCIDENT_START).subtract(7, "day"));
const INC_BASE_TO = TS(dayjs.utc(INCIDENT_END).add(7, "day"));
const RL_BASE_FROM = TS(DATASET_START);                                    // Jun 4 - Aug 31 (whole pre-period)
const RL_POST_TO = TS(dayjs.utc(RATE_LIMIT_RAISE).add(30, "day"));        // September
const RETENTION_DAY = 30;
const PAID_COHORT_LAST = dayjs.utc(PAID_COHORT_END).subtract(1, "day").format("YYYY-MM-DD");
const ONBOARD_WINDOW_DAYS = 7;
// H9 conversion read: one-sided ceiling = knob + 2.25 standard errors of the paid-rate ratio, from
// the expected buyer counts (signups per channel in the Jun 4 - Aug 31 cohort × the knob-level
// paid rate: would-be upgraders × first-request rate, × the channel's keep share)
const H9_RATIO = UPGRADE_KEEP.hackathons / UPGRADE_KEEP.search_ads;
const H9_COHORT_DAYS = (ms(PAID_COHORT_END) - ms(DATASET_START)) / DAY_MS;
const H9_PAID_RATE = UPGRADE_BASE * ONBOARD_CONV / 100;
const h9Buyers = (ch) => NUM_USERS * (BORN_PCT / 100) * (CHANNEL_WEIGHTS[ch] / Object.values(CHANNEL_WEIGHTS).reduce((a, b) => a + b, 0))
	* (H9_COHORT_DAYS / WINDOW_DAYS) * H9_PAID_RATE * UPGRADE_KEEP[ch];
const H9_REL_SE = Math.sqrt(1 / h9Buyers("hackathons") + 1 / h9Buyers("search_ads"));
const H9_CEILING = H9_RATIO * (1 + 2.25 * H9_REL_SE); // ≈ 0.50 (≈ 36 vs 148 expected buyers)
const SYSTEM_EVENTS = ["batch job completed", "eval run completed"]; // sent by the platform, not the user: not activity

// one row per onboarding signup: did the account make its first request within 7 days, and how fast
const ONBOARD_SQL = `WITH ${ID_CTE},
s AS (SELECT uid, t AS t0 FROM ev WHERE event = 'account created' AND t >= TIMESTAMP '${TS(QUICKSTART_START)}'),
k AS (SELECT uid, min(t) AS tk FROM ev WHERE event = 'api key created' GROUP BY 1),
r AS (SELECT e.uid, min(e.t) AS tr FROM ev e JOIN k ON k.uid = e.uid AND e.t >= k.tk WHERE e.event = 'api request' GROUP BY 1),
v AS (SELECT distinct_id::VARCHAR AS uid, "${EXP_KEY}" AS variant FROM ${US} WHERE "${EXP_KEY}" IS NOT NULL),
x AS (SELECT v.variant, s.uid, (k.tk >= s.t0 AND r.tr IS NOT NULL AND r.tr < s.t0 + INTERVAL ${ONBOARD_WINDOW_DAYS} DAY) AS ok, r.tr, s.t0
  FROM s JOIN v ON v.uid = s.uid LEFT JOIN k ON k.uid = s.uid LEFT JOIN r ON r.uid = s.uid)
SELECT variant AS grp, count(*) AS user_count, avg(ok::INT) AS conv,
 median(date_diff('second', t0, tr)) FILTER (WHERE ok) AS med_ttc_s
FROM x GROUP BY 1`;

// one row per batch job: submission plan, submit → complete time (batch_id pairs the two)
const BATCH_SQL = `WITH ${ID_CTE},
s AS (SELECT batch_id, uid, plan_tier, t AS t0 FROM ev WHERE event = 'batch job submitted'),
c AS (SELECT batch_id, min(t) AS t1 FROM ev WHERE event = 'batch job completed' GROUP BY 1),
x AS (SELECT s.plan_tier, s.uid, date_diff('second', s.t0, c.t1) AS ttc FROM s JOIN c ON c.batch_id = s.batch_id)
SELECT plan_tier AS grp, count(DISTINCT uid) AS user_count, count(*) AS jobs, median(ttc) AS med_ttc FROM x GROUP BY 1
UNION ALL
SELECT 'scale_enterprise' AS grp, count(DISTINCT uid) AS user_count, count(*) AS jobs, median(ttc) AS med_ttc FROM x WHERE plan_tier IN ('scale', 'enterprise')`;

// new API accounts: early eval runs vs day-30 retention (any event in days 30-36 after signup)
const RETENTION_SQL = `WITH ${ID_CTE},
s AS (SELECT uid, t AS t0 FROM ev WHERE event = 'account created' AND t < TIMESTAMP '${TS(DATASET_END)}' - INTERVAL ${RETENTION_DAY + 7} DAY
  AND uid IN (SELECT uid FROM ev WHERE event = 'api request')),
f AS (SELECT s.uid,
  count(*) FILTER (WHERE e.event = 'eval run started' AND e.t < s.t0 + INTERVAL ${EVAL_DAYS} DAY) AS early,
  count(*) FILTER (WHERE e.t >= s.t0 + INTERVAL ${RETENTION_DAY} DAY AND e.t < s.t0 + INTERVAL ${RETENTION_DAY + 7} DAY AND e.event NOT IN (${SQL_LIST(SYSTEM_EVENTS)})) AS ret
  FROM s JOIN ev e ON e.uid = s.uid GROUP BY 1)
SELECT CASE WHEN early >= ${EVAL_MIN} THEN 'two_plus' WHEN early = 1 THEN 'one' ELSE 'zero' END AS grp,
 count(*) AS user_count, avg((ret > 0)::INT) AS retention
FROM f GROUP BY 1`;

// paid-model swift-2 share by plan, before the price cut vs September
const SWIFT_SQL = `WITH ${ID_CTE}
SELECT plan_tier AS grp, count(DISTINCT uid) AS user_count,
 avg((model = 'swift-2')::INT) FILTER (WHERE t >= TIMESTAMP '${SWIFT_SHIFTED}') / avg((model = 'swift-2')::INT) FILTER (WHERE t < TIMESTAMP '${TS(SWIFT_PRICE_CUT)}') AS shift
FROM ev WHERE event = 'api request' GROUP BY 1`;

// spend per Mixpanel signup by paid channel (warehouse join) and 30-day paid conversion by channel
const CAC_SQL = `WITH ${ID_CTE},
s AS (SELECT acquisition_channel AS ch, count(*) AS signups, count(DISTINCT uid) AS users FROM ev WHERE event = 'account created' GROUP BY 1),
sp AS (SELECT acquisition_channel AS ch, sum(spend_usd) AS spend FROM ${WH("developer_marketing_daily")} GROUP BY 1)
SELECT s.ch AS grp, s.users AS user_count, sp.spend / s.signups AS spend_per_signup FROM s JOIN sp ON sp.ch = s.ch`;
const PAID_CONV_SQL = `WITH ${ID_CTE},
s AS (SELECT uid, t AS t0, acquisition_channel AS ch FROM ev WHERE event = 'account created' AND t < TIMESTAMP '${TS(PAID_COHORT_END)}'),
b AS (SELECT DISTINCT s.uid FROM s JOIN ev e ON e.uid = s.uid AND e.event = 'plan upgraded'
  AND e.t >= s.t0 AND e.t < s.t0 + INTERVAL ${PAID_FUNNEL_WINDOW_DAYS} DAY)
SELECT s.ch AS grp, count(*) AS user_count, count(b.uid) AS buyers, count(b.uid)::DOUBLE / count(*) AS paid_rate
FROM s LEFT JOIN b ON b.uid = s.uid GROUP BY 1`;

// rate-limit episodes per sampled request, by plan, Jun 4 - Aug 31 vs September
const RL_SQL = `WITH ${ID_CTE},
w AS (SELECT plan_tier, uid, event, (t >= TIMESTAMP '${TS(RATE_LIMIT_RAISE)}') AS post FROM ev
  WHERE event IN ('rate limit hit', 'api request') AND t >= TIMESTAMP '${RL_BASE_FROM}' AND t < TIMESTAMP '${RL_POST_TO}'),
g AS (SELECT plan_tier, post, count(*) FILTER (WHERE event = 'rate limit hit')::DOUBLE / count(*) FILTER (WHERE event = 'api request') AS r,
  count(DISTINCT uid) AS users FROM w GROUP BY 1, 2)
SELECT plan_tier AS grp, min(users) AS user_count, max(r) FILTER (WHERE post) / max(r) FILTER (WHERE NOT post) AS shift FROM g GROUP BY 1`;

/** @type {import("../../../types").DungeonStory[]} */
export const stories = [
	{
		id: "H1-prompt-caching-launch",
		hook: "H1",
		archetype: "temporal-inflection",
		narrative: `Prompt caching becomes generally available on ${D(CACHE_LAUNCH)} for every plan. ${CACHE_ADOPTER_SHARE * 100}% of accounts turn it on, each on a salted day in the ${CACHE_RAMP_DAYS} days after launch, and each adopter's prompts hit the cache on a salted ${(CACHE_HIT_MEAN - CACHE_HIT_SPREAD) * 100}-${(CACHE_HIT_MEAN + CACHE_HIT_SPREAD) * 100}% of requests (mean ${CACHE_HIT_MEAN * 100}%), so the hit share ramps for three weeks and then holds at ${CACHE_HIT_SHARE * 100}% of requests. A cache hit skips most of the prefill of its cached prefix (a cached token takes ${CACHE_PREFILL_SHARE * 100}% of the normal prefill time; the cached share of a hit's prompt is uniform ${CACHE_PREFIX_MIN * 100}-${CACHE_PREFIX_MAX * 100}%), so time to first token falls while decode time (output tokens × model speed) does not change. Time to first token = ${TTFT_BASE_MS} ms overhead + ${TTFT_MS_PER_INPUT} ms per prefilled input token, with log-normal noise. On plain (no tool) successful requests the input size has a known mean (${Math.round(INPUT_MEAN_PLAIN)} tokens) and is drawn independently of the cache, so the expected hit / miss ratio of average time_to_first_token_ms is ${CACHE_TTFT_RATIO.toFixed(3)}. No request before launch is a cache hit.`,
		mixpanelReport: { type: "Insights", event: "api request", measure: "average time_to_first_token_ms", breakdown: "cache_hit", filter: "status_code = 200, tool_use = false, after 2026-07-08" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 count(*) FILTER (WHERE cache_hit AND t < TIMESTAMP '${TS(CACHE_LAUNCH)}') AS impure_rows
FROM ev WHERE event = 'api request'`,
				},
				select: { a: { where: { grp: "all" } } },
				// exact: a cache hit before general availability is a bug
				expect: { metric: "a.impure_rows", op: "between", target: [0, 0] },
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT CASE WHEN cache_hit THEN 'hit' ELSE 'miss' END AS grp, count(DISTINCT uid) AS user_count, count(*) AS requests, avg(time_to_first_token_ms) AS avg_ttft
FROM ev WHERE event = 'api request' AND status_code = 200 AND NOT tool_use AND t >= TIMESTAMP '${TS(CACHE_LAUNCH)}' GROUP BY 1`,
				},
				select: { h: { where: { grp: "hit" } }, m: { where: { grp: "miss" } } },
				expect: { metric: "h.avg_ttft / m.avg_ttft", op: "between", target: band(CACHE_TTFT_RATIO) },
				minCohort: 1000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'ramped' AS grp, count(DISTINCT uid) AS user_count, avg(cache_hit::INT) AS hit_share
FROM ev WHERE event = 'api request' AND t >= TIMESTAMP '${CACHE_RAMPED}'`,
				},
				select: { r: { where: { grp: "ramped" } } },
				// after the ramp every adopter has started: adopter share × mean hit rate
				// (failed requests are never hits: ~2.5% background errors, below the band)
				expect: { metric: "r.hit_share", op: "between", target: band(CACHE_HIT_SHARE) },
				minCohort: 3000,
			},
		],
	},
	{
		id: "H2-atlas-3-launch",
		hook: "H2",
		archetype: "composition-drift",
		narrative: `atlas-3 launches ${D(ATLAS3_LAUNCH)} for Build, Scale, and Enterprise accounts (plan at the moment of the request) and opens to Free accounts on ${D(ATLAS3_FREE)}. ${ATLAS3_PAID_ADOPTERS * 100}% of paid accounts adopt it, each starting on a salted day in the ${ATLAS3_RAMP_DAYS} days after launch and sending a salted ${(ATLAS3_USE_MEAN - ATLAS3_USE_SPREAD) * 100}-${(ATLAS3_USE_MEAN + ATLAS3_USE_SPREAD) * 100}% (mean ${ATLAS3_USE_MEAN * 100}%) of their flagship traffic to it, so atlas-3 takes ${ATLAS3_FLAGSHIP_SHARE * 100}% of paid flagship (atlas-2 + atlas-3) requests once ramped; swift-2 traffic is untouched. ${ATLAS3_FREE_ADOPTERS * 100}% of Free accounts adopt after Free access (10-day ramp). atlas-3 answers are ${ATLAS3_OUTPUT_MULT}x as long (output_tokens). No atlas-3 request exists before launch, and none on a Free plan before Free access.`,
		mixpanelReport: { type: "Insights", event: "api request", measure: "total", breakdown: "model", filter: "model in (atlas-2, atlas-3), plan_tier in (build, scale, enterprise)", chart: "weekly stacked, % of total" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 count(*) FILTER (WHERE model = 'atlas-3' AND (t < TIMESTAMP '${TS(ATLAS3_LAUNCH)}' OR (plan_tier = 'free' AND t < TIMESTAMP '${TS(ATLAS3_FREE)}'))) AS impure_rows
FROM ev WHERE event = 'api request'`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.impure_rows", op: "between", target: [0, 0] },
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'paid' AS grp, count(DISTINCT uid) AS user_count, avg((model = 'atlas-3')::INT) AS atlas3_share
FROM ev WHERE event = 'api request' AND model IN ('atlas-2', 'atlas-3') AND plan_tier IN (${SQL_LIST(PAID_PLANS)}) AND t >= TIMESTAMP '${ATLAS3_RAMPED}'`,
				},
				select: { p: { where: { grp: "paid" } } },
				expect: { metric: "p.atlas3_share", op: "between", target: band(ATLAS3_FLAGSHIP_SHARE) },
				minCohort: 1500,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT model AS grp, count(DISTINCT uid) AS user_count, avg(output_tokens) AS avg_output
FROM ev WHERE event = 'api request' AND status_code = 200 AND model IN ('atlas-2', 'atlas-3') AND plan_tier IN (${SQL_LIST(PAID_PLANS)}) AND t >= TIMESTAMP '${TS(ATLAS3_LAUNCH)}' GROUP BY 1`,
				},
				select: { n: { where: { grp: "atlas-3" } }, o: { where: { grp: "atlas-2" } } },
				expect: { metric: "n.avg_output / o.avg_output", op: "between", target: band(ATLAS3_OUTPUT_MULT) },
				minCohort: 1000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'free' AS grp, count(DISTINCT uid) AS user_count, avg((model = 'atlas-3')::INT) AS atlas3_share
FROM ev WHERE event = 'api request' AND model IN ('atlas-2', 'atlas-3') AND plan_tier = 'free' AND t >= TIMESTAMP '${ATLAS3_FREE_RAMPED}'`,
				},
				select: { f: { where: { grp: "free" } } },
				expect: { metric: "f.atlas3_share", op: "between", target: band(ATLAS3_FREE_ADOPTERS * ATLAS3_USE_MEAN) },
				minCohort: 500,
			},
		],
	},
	{
		id: "H3-interactive-quickstart-experiment",
		hook: "H3",
		archetype: "experiment-lift",
		narrative: `The "${QUICKSTART_EXPERIMENT}" onboarding test starts ${D(QUICKSTART_START)} and splits new accounts 50/50 at signup (sticky hash; $experiment_started and the profile property "${EXP_KEY}"). Control sees the static quickstart docs; the "${QUICKSTART_VARIANT}" arm gets a guided in-console walkthrough. The variant multiplies the share of signups that make their first API request (account created → api key created → api request) by ${QUICKSTART_CONV_MULT} (${ONBOARD_CONV}% → ${Math.round(ONBOARD_CONV * QUICKSTART_CONV_MULT)}%) and the time from signup to first request by ${QUICKSTART_TTC_MULT}. Declarative funnel experiment on the first funnel. Read with a ${ONBOARD_WINDOW_DAYS}-day conversion window; every onboarding step happens once per account, and an account that never makes its first request in onboarding sends no API traffic, so the unique-user funnel reads the knobs directly.`,
		mixpanelReport: { type: "Funnels", steps: ["account created", "api key created", "api request"], window: "7 days", breakdown: `user property "${EXP_KEY}"`, measure: "conversion and median time to convert" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: ONBOARD_SQL },
				select: { v: { where: { grp: QUICKSTART_VARIANT } }, c: { where: { grp: "Control" } } },
				expect: { metric: "v.conv / c.conv", op: "between", target: band(QUICKSTART_CONV_MULT) },
				minCohort: 1000,
			},
			{
				breakdown: { type: "duckdb", sql: ONBOARD_SQL },
				select: { v: { where: { grp: QUICKSTART_VARIANT } }, c: { where: { grp: "Control" } } },
				expect: { metric: "v.med_ttc_s / c.med_ttc_s", op: "between", target: band(QUICKSTART_TTC_MULT) },
				minCohort: 1000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT 'all' AS grp, count(DISTINCT uid) AS user_count,
 count(DISTINCT uid) FILTER (WHERE "Variant name" = '${QUICKSTART_VARIANT}')::DOUBLE / count(DISTINCT uid) AS variant_share
FROM ev WHERE event = '$experiment_started'`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.variant_share", op: "between", target: band(0.5) },
				minCohort: 2000,
			},
		],
	},
	{
		id: "H4-batch-turnaround-by-plan",
		hook: "H4",
		archetype: "funnel-ttc-by-segment",
		narrative: `Batch API turnaround depends on the account's plan when the job is submitted: Scale and Enterprise jobs finish in ${BATCH_PLAN_MULT.scale}x the Build time and Free jobs in ${BATCH_PLAN_MULT.free}x (base median ${BATCH_MEDIAN_H} h on Build, seeded log-normal spread; jobs not done in ${BATCH_SLA_H} h expire). Each job's submission and completion share a batch_id, so a funnel holding batch_id constant measures each job on its own; the median ratio reads the knob.`,
		mixpanelReport: { type: "Funnels", steps: ["batch job submitted", "batch job completed"], measure: "median time to convert", holdPropertyConstant: "batch_id", breakdown: "plan_tier", window: "1 day" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: BATCH_SQL },
				select: { p: { where: { grp: "scale_enterprise" } }, b: { where: { grp: "build" } } },
				expect: { metric: "p.med_ttc / b.med_ttc", op: "between", target: band(BATCH_PLAN_MULT.scale) },
				minCohort: 300,
			},
			{
				breakdown: { type: "duckdb", sql: BATCH_SQL },
				select: { f: { where: { grp: "free" } }, b: { where: { grp: "build" } } },
				expect: { metric: "f.med_ttc / b.med_ttc", op: "between", target: band(BATCH_PLAN_MULT.free) },
				minCohort: 300,
			},
		],
	},
	{
		id: "H5-early-evals-retention",
		hook: "H5",
		archetype: "retention-divergence",
		narrative: `New accounts that got their integration working (made their first API request) and ran fewer than ${EVAL_MIN} evaluation runs in their first ${EVAL_DAYS} days are at risk, on a ramp: ${DARK_SHARE_BY_EVALS[0] * 100}% of accounts with no early eval run and ${DARK_SHARE_BY_EVALS[1] * 100}% with one go dark after day ${DARK_AFTER_DAYS}; ${EVAL_MIN}+ never do. The early run count is a salted per-account draw (mixed Poisson, mean ${EVAL_EARLY_MEAN} for evaluating accounts), realized by dropping or cloning whole eval units on the account's own early activity, so it does not depend on how dense the account's activity is and does not select front-loaded, short-lived accounts. Every new API account also faces organic lapse (${LAPSE_SHARE * 100}% of each early-eval group stop on a day spread evenly over ${LAPSE_DAY_MIN}-${LAPSE_DAY_MAX}); dark and lapse shares are exact within each group, so 2 runs and 3+ runs retain alike. Day-${RETENTION_DAY} retention = any user activity in days ${RETENTION_DAY}-${RETENTION_DAY + 6} after signup (every event except the system-sent ${SYSTEM_EVENTS.join(" and ")}), signups at least ${RETENTION_DAY + 7} days before the window end. Both reads are knob floors: accounts that never evaluate also send fewer events later (no eval runs in the day-${RETENTION_DAY} week), which can only add to the gap. 2+ vs none ≥ 1/(1−${DARK_SHARE_BY_EVALS[0]}); one vs none ≥ (1−${DARK_SHARE_BY_EVALS[1]})/(1−${DARK_SHARE_BY_EVALS[0]}). Mixpanel: build the groups in Funnels (account created → eval run started → eval run started, ${EVAL_DAYS}-day window, uniques; completed = 2+, dropped after step 2 = one, dropped after step 1 = none), save each as a cohort, filter to accounts that did api request, then Retention (account created → a custom event grouping every event except ${SYSTEM_EVENTS.join(" and ")}; plain \"any event\" gives the same numbers on this data; custom bracket day ${RETENTION_DAY}-${RETENTION_DAY + 6}) broken down by those cohorts.`,
		mixpanelReport: { type: "Funnels → cohorts → Retention", cohortFunnel: `account created → eval run started → eval run started, ${EVAL_DAYS}-day window`, birth: "account created", return: `custom event: every event except ${SYSTEM_EVENTS.join(", ")}`, brackets: `custom: day ${RETENTION_DAY}-${RETENTION_DAY + 6}`, breakdown: "those cohorts", filter: "did api request" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: RETENTION_SQL },
				select: { a: { where: { grp: "two_plus" } }, z: { where: { grp: "zero" } } },
				// non-evaluators are a bit less active later: knob-derived floor, grades STRONG above +10%
				expect: { metric: "a.retention / z.retention", op: ">=", target: 1 / (1 - DARK_SHARE_BY_EVALS[0]), floor: 0.9 / (1 - DARK_SHARE_BY_EVALS[0]) },
				minCohort: 200,
			},
			{
				breakdown: { type: "duckdb", sql: RETENTION_SQL },
				select: { o: { where: { grp: "one" } }, z: { where: { grp: "zero" } } },
				expect: { metric: "o.retention / z.retention", op: ">=", target: (1 - DARK_SHARE_BY_EVALS[1]) / (1 - DARK_SHARE_BY_EVALS[0]), floor: 0.9 * (1 - DARK_SHARE_BY_EVALS[1]) / (1 - DARK_SHARE_BY_EVALS[0]) },
				minCohort: 200,
			},
		],
	},
	{
		id: "H6-us-east-capacity-incident",
		hook: "H6",
		archetype: "external-join",
		narrative: `From ${D(INCIDENT_START)} to ${D(INCIDENT_END)} (exclusive) the ${INCIDENT_REGION} inference region loses GPU capacity: ${INCIDENT_FAIL * 100}% of requests that would have succeeded there fail with 529 overloaded_error, and the ones that succeed take ${INCIDENT_LATENCY_MULT}x as long. The incident days and region come from the warehouse table inference_fleet_daily (region_status = 'major_outage'). The event-side read is a ratio of ratios: ${INCIDENT_REGION} success rate / other regions, incident days vs the 7 days either side, which reads the 1 − ${INCIDENT_FAIL} keep rate while cancelling background errors and weekday mix. The warehouse error_rate_5xx during the outage reads the failure knob (plus the ~1.3% background 5xx).`,
		mixpanelReport: { type: "Insights", event: "api request", measure: "share with status_code = 200", breakdown: "inference_region", chart: "daily line", join: "warehouse inference_fleet_daily.region_status on date + inference_region" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
o AS (SELECT DISTINCT date::DATE AS d, inference_region FROM ${WH("inference_fleet_daily")} WHERE region_status = 'major_outage'),
od AS (SELECT DISTINCT d FROM o), orr AS (SELECT DISTINCT inference_region FROM o),
w AS (SELECT t::DATE AS d, uid, (inference_region IN (SELECT inference_region FROM orr)) AS hit, (status_code = 200) AS ok
  FROM ev WHERE event = 'api request' AND t >= TIMESTAMP '${INC_BASE_FROM}' AND t < TIMESTAMP '${INC_BASE_TO}'),
g AS (SELECT (d IN (SELECT d FROM od)) AS outage, avg(ok::INT) FILTER (WHERE hit) / avg(ok::INT) FILTER (WHERE NOT hit) AS rel, count(DISTINCT uid) AS users FROM w GROUP BY 1)
SELECT 'all' AS grp, (SELECT count(*) FROM od) AS outage_days, min(users) AS user_count,
 max(rel) FILTER (WHERE outage) / max(rel) FILTER (WHERE NOT outage) AS did
FROM g`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.did", op: "between", target: band(1 - INCIDENT_FAIL) },
				minCohort: 1000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT 'all' AS grp,
 count(*) FILTER (WHERE region_status = 'major_outage') AS outage_rows,
 avg(error_rate_5xx) FILTER (WHERE region_status = 'major_outage') AS outage_err,
 count(*) FILTER (WHERE region_status = 'major_outage' AND (date::DATE < DATE '${D(INCIDENT_START)}' OR date::DATE >= DATE '${D(INCIDENT_END)}' OR inference_region <> '${INCIDENT_REGION}')) AS misplaced
FROM ${WH("inference_fleet_daily")}`,
				},
				select: { a: { where: { grp: "all" } } },
				expect: { metric: "a.outage_err", op: "between", target: band(INCIDENT_FAIL) },
			},
		],
	},
	{
		id: "H7-swift-price-cut",
		hook: "H7",
		archetype: "temporal-inflection",
		narrative: `On ${D(SWIFT_PRICE_CUT)} the swift-2 list price halves ($${PRICE_IN["swift-2"]} → $${PRICE_IN["swift-2"] * SWIFT_PRICE_CUT_FACTOR} input, $${PRICE_OUT["swift-2"]} → $${PRICE_OUT["swift-2"] * SWIFT_PRICE_CUT_FACTOR} output per million tokens). Build accounts pay list price, so each moves more traffic to swift-2 (switching on a salted day in the ${SWIFT_SHIFT_RAMP_DAYS} days after the cut): its swift-2 share becomes ${SWIFT_SHIFT_MULT}x its base share (base uniform ${SWIFT_BASE_MIN * 100}-${SWIFT_BASE_MAX * 100}% per account, so no account exceeds 100%). Free accounts run on monthly credits and Scale and Enterprise on contract rates; none of them change. Read: swift-2 share of api requests from ${D(SWIFT_SHIFTED)} vs before the cut, by plan_tier at request time. Prices live only in the warehouse table model_billing_daily.`,
		mixpanelReport: { type: "Insights", event: "api request", measure: "total", breakdown: "model", filter: "plan_tier = build (and free as control)", chart: "weekly, % of total", join: "model_billing_daily.list_price_input_per_mtok" },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: SWIFT_SQL },
				select: { b: { where: { grp: "build" } } },
				expect: { metric: "b.shift", op: "between", target: band(SWIFT_SHIFT_MULT) },
				minCohort: 1000,
			},
			{
				breakdown: { type: "duckdb", sql: SWIFT_SQL },
				select: { f: { where: { grp: "free" } } },
				// control: Free accounts pay nothing per token
				expect: { metric: "f.shift", op: "between", target: band(1) },
				minCohort: 1000,
			},
		],
	},
	{
		id: "H8-agent-tool-use",
		hook: "H8",
		archetype: "cohort-prop-scale",
		narrative: `Requests that use tools carry the tool definitions and tool results in the prompt, so their input_tokens are ${TOOL_INPUT_MULT}x those of plain requests. Tool use depends on what the account builds (profile use_case): agents ${TOOL_SHARE_BY_USE_CASE.agents * 100}% of requests, coding ${TOOL_SHARE_BY_USE_CASE.coding * 100}%, other use cases ${TOOL_SHARE_BY_USE_CASE.content_generation * 100}-${TOOL_SHARE_BY_USE_CASE.chat_assistant * 100}%. The tool flag is drawn per request independently of every other input-token driver, so the ratio of averages reads the knob.`,
		mixpanelReport: { type: "Insights", event: "api request", measure: "average input_tokens", breakdown: "tool_use", filter: "status_code = 200" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE}
SELECT CASE WHEN tool_use THEN 'tool' ELSE 'plain' END AS grp, count(DISTINCT uid) AS user_count, avg(input_tokens) AS avg_input
FROM ev WHERE event = 'api request' AND status_code = 200 GROUP BY 1`,
				},
				select: { t: { where: { grp: "tool" } }, p: { where: { grp: "plain" } } },
				expect: { metric: "t.avg_input / p.avg_input", op: "between", target: band(TOOL_INPUT_MULT) },
				minCohort: 2000,
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH ${ID_CTE},
p AS (SELECT distinct_id::VARCHAR AS uid, use_case FROM ${US})
SELECT p.use_case AS grp, count(DISTINCT ev.uid) AS user_count, avg(tool_use::INT) AS tool_share
FROM ev JOIN p ON p.uid = ev.uid WHERE ev.event = 'api request' GROUP BY 1`,
				},
				select: { a: { where: { grp: "agents" } } },
				expect: { metric: "a.tool_share", op: "between", target: band(TOOL_SHARE_BY_USE_CASE.agents) },
				minCohort: 500,
			},
		],
	},
	{
		id: "H9-developer-marketing-economics",
		hook: "H9",
		archetype: "funnel-conversion-by-segment",
		narrative: `Hackathon sponsorships cost ${(CPL_USD.hackathons / CPL_USD.search_ads).toFixed(2)}x as much per signup as search ads over the window (warehouse developer_marketing_daily bills a paced daily budget per channel = cost per signup × the signups the channel brought in over the window / ${WINDOW_DAYS} days, weekday shape above a ${SPEND_FLAT_SHARE * 100}% flat floor, seeded ±${SPEND_NOISE * 100}% day noise, never zero: $${CPL_USD.hackathons} vs $${CPL_USD.search_ads} per signup at the window level), and hackathon signups upgrade to a paid plan far less often: the share of would-be upgraders kept is ${UPGRADE_KEEP.hackathons} for hackathons vs ${UPGRADE_KEEP.search_ads} for search ads (channel is drawn independently of company size, role, and use case). Spend per signup needs the warehouse join. The conversion read is the Mixpanel funnel account created → plan upgraded with the default ${PAID_FUNNEL_WINDOW_DAYS}-day window, signups ${D(DATASET_START)} through ${PAID_COHORT_LAST}; channel is independent of every other driver, so the paid-rate ratio reads the ${UPGRADE_KEEP.hackathons} knob in expectation, but only about 45 hackathon and about 150 search-ads signups convert inside the window (expected about ${Math.round(h9Buyers("hackathons"))} and ${Math.round(h9Buyers("search_ads"))}; relative standard error of the ratio about ${Math.round(H9_REL_SE * 100)}%). The read is therefore a one-sided ceiling at the knob plus 2.25 standard errors (${H9_CEILING.toFixed(3)}), derived from the expected buyer counts: the ceiling covers sampling error, not a confound, and the read grades STRONG unless it lands inside knob ±10%.`,
		mixpanelReport: { type: "Insights + Funnels + warehouse", event: "account created", breakdown: "acquisition_channel", join: "developer_marketing_daily.spend_usd", funnel: `account created → plan upgraded, ${PAID_FUNNEL_WINDOW_DAYS}-day window (Mixpanel default), signups ${D(DATASET_START)} to ${PAID_COHORT_LAST}, breakdown acquisition_channel` },
		assertions: [
			{
				breakdown: { type: "duckdb", sql: CAC_SQL },
				select: { h: { where: { grp: "hackathons" } }, s: { where: { grp: "search_ads" } } },
				expect: { metric: "h.spend_per_signup / s.spend_per_signup", op: "between", target: band(CPL_USD.hackathons / CPL_USD.search_ads) },
				minCohort: 500,
			},
			{
				breakdown: { type: "duckdb", sql: PAID_CONV_SQL },
				select: { h: { where: { grp: "hackathons" } }, s: { where: { grp: "search_ads" } } },
				// ceiling covers sampling error (about 45 hackathon buyers): knob + 2.25 SE of the ratio
				expect: { metric: "h.paid_rate / s.paid_rate", op: "<=", target: H9_RATIO, floor: H9_CEILING },
				minCohort: 400,
			},
		],
	},
	{
		id: "H10-build-rate-limit-raise",
		hook: "H10",
		archetype: "temporal-inflection",
		narrative: `Rate-limit episodes open from the request stream: each sampled request starts one a few seconds later at a per-request rate by plan at the moment (per 1,000 sampled requests: Free ${RL_PER_1K_REQ.free}, Build ${RL_PER_1K_REQ.build}, Scale ${RL_PER_1K_REQ.scale}, Enterprise ${RL_PER_1K_REQ.enterprise}), so every account's episodes track its own traffic. On ${D(RATE_LIMIT_RAISE)} Cortexa raises Build-tier rate limits: the Build rate falls to ${RL_RAISE_MULT}x; Free, Scale, and Enterprise limits do not change. Read: rate limit hit per api request in September vs the whole pre-period (${D(DATASET_START)} to Aug 31) for Build, divided by the same ratio for Free (difference in differences cancels traffic mix and the weekday calendar; the three-month baseline keeps month-to-month noise in the Free control out of the read).`,
		mixpanelReport: { type: "Insights", events: ["rate limit hit", "api request"], measure: "total, formula A/B", breakdown: "plan_tier", chart: "monthly" },
		assertions: [
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH r AS (${RL_SQL}) SELECT 'did' AS grp, min(user_count) FILTER (WHERE grp IN ('build', 'free')) AS user_count,
 max(shift) FILTER (WHERE grp = 'build') / max(shift) FILTER (WHERE grp = 'free') AS did FROM r`,
				},
				select: { d: { where: { grp: "did" } } },
				expect: { metric: "d.did", op: "between", target: band(RL_RAISE_MULT) },
				minCohort: 1000,
			},
		],
	},
];

export default config;
