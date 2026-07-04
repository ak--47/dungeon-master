// ── IMPORTS ──
import "dotenv/config";
import * as u from "@ak--47/dungeon-master/utils";
import { hashFloat, applyPathBias, applySessionShape } from "@ak--47/dungeon-master/hook-helpers";
/** @typedef  {import("../../../types").Dungeon} Config */

// ── OVERVIEW ──
/*
 * NAME:       DeskHero
 * APP:        B2B SaaS support-desk: requesters file and track tickets,
 *             agents work queues in long daily sessions, a knowledge base
 *             deflects, escalations route to tier 2/3.
 * SCALE:      5,000 users, ~1.7M events, 84 days (2026-03-01 → 2026-05-23)
 * CORE LOOP:  ticket created → reply sent → ticket resolved (→ csat)
 *
 * PURPOSE:    v1.6 FLOWS + SESSIONS SHOWCASE. This dungeon exists to
 *             demonstrate the `applyPathBias` and `applySessionShape` atoms
 *             and the topPaths / funnelFrequency (session conversion
 *             windows) / sessionMetrics / uniques-sessions emulator
 *             families. Everything else is deliberately plain: no SCDs, no
 *             campaigns, no group keys, no lifecycle waves.
 *
 * EVENTS (10):
 *   ticket viewed (20) > dashboard viewed (14) > kb article viewed (12)
 *   > search (10) > ticket created (8) > reply sent (2) > csat submitted (2)
 *   > ticket resolved (1) > ticket escalated (1) > account created (1)
 *
 * FUNNELS (4):
 *   - Onboarding: account created → dashboard viewed → ticket created (70%, isFirstFunnel)
 *   - Resolution: ticket created → reply sent → ticket resolved (50%)
 *   - Deflection: search → kb article viewed (60%)
 *   - CSAT:       ticket resolved → csat submitted (40%)
 *
 * USER PROPS:  role, team_size, industry, support_plan
 * SUPER PROPS: role, plan_tier
 *
 * IDENTITY:   avgDevicePerUser: 2; account created is isFirstEvent +
 *             isAuthEvent, so every event carries user_id and ~all carry
 *             device_id.
 *
 * ═══════════════════════════════════════════════════════════════════
 * ENGINEERED PATTERNS (hooks) — 3 hooks, disjoint hashFloat cohorts
 * ═══════════════════════════════════════════════════════════════════
 *
 * Cohort gating uses disjoint hashFloat(uid) bands (NOT nested hashCohort
 * calls — hashCohort(id, 45) ⊂ hashCohort(id, 70), so bands gated that way
 * would overlap). The `role` super prop is pinned by the hook on EVERY
 * event from the same band (the engine stamps super props randomly per
 * event), and mirrored onto the profile in the `user` hook, so event
 * cohorts, profile cohorts, and hashFloat bands all agree.
 *
 * ORDERING RULE (HOOKS.md §2.13/§2.17): `applySessionShape` retimes the
 * whole stream, so it runs FIRST; `applyPathBias` injections go in AFTER
 * shaping so their engineered gaps survive. H1's tight gaps glue its path
 * into the anchor's derived session; H2's 1-4h gaps deliberately cross
 * derived session boundaries (inter-session > 30 min).
 *
 * 1. ONE-TOUCH RESOLUTION PATH (everything) — hashFloat band [0.00, 0.45)
 * PATTERN: applyPathBias injects `reply sent → ticket resolved` 5-20s
 * after the user's FIRST `ticket created` — a canned-macro instant
 * resolution, inside the same session as the ticket. Together with H2 the
 * hook makes Flows BIMODAL: a one-touch resolve branch pinned to this
 * band's share, and H2's reply-grind branch beside it. (The label-only
 * Flows read is NOT "hooked > organic": organic F2 passes eventually
 * produce the same labels for ~62% of users — the hook's signature is the
 * split, and the fact that this band resolves in ONE session.)
 *   Discovery: Flows on "ticket created" shows two dominant branches;
 *   Funnels with a 1-session conversion window shows in-session resolution.
 *
 *   Report 1: Flows, anchor "ticket created", hide all but reply/resolve/
 *   escalate steps, unique count type
 *   - Measure: share of entered users on created→reply→resolved
 *   - Expected (2K reduced run, hooked | organic): 0.425 (= the band,
 *     892/2000 with ~95% template capture) | 0.618 (diffuse, label-only)
 *
 *   Report 2: Funnels "created → reply → resolved", conversion window
 *   1 SESSION, breakdown by frequency of "ticket created"
 *   - Measure: converters / entered at the 1-session window
 *   - Expected (2K, hooked | organic): 0.689 | 0.0015. The hooked mass is
 *     this band (0.464 of entered) plus organic F2 passes that H3's
 *     session shaping compressed into single sessions; organic streams
 *     average ~1.2 events per derived session so nothing converts
 *     in-session there.
 *
 * 2. ESCALATION CROSS-SESSION PATH (everything) — hashFloat band [0.45, 0.70)
 * PATTERN: after shaping, applyPathBias injects `ticket escalated → reply
 * sent → ticket resolved` with 1-4h gaps after the FIRST ticket created,
 * then the hook drops the band's ORGANIC ticket resolved events (the
 * injected chain becomes the band's only resolution route). Each 1-4h gap
 * exceeds the 30-min session timeout, so the chain lands in three extra
 * derived sessions: the Resolution funnel does NOT convert in 1 session
 * (resolved sits at session ordinal +3) but DOES at a 4-session window —
 * the session-count conversion contrast funnelFrequency exists to read.
 *   Discovery: Funnels conversion at 1-session vs 4-session windows.
 *
 *   Report 1: Funnels "created → reply → resolved", conversion window
 *   swept over 1/3/4 SESSIONS
 *   - Measure: converters/entered at each window. The band converts only
 *     at ≥4 sessions, so the sweep is FLAT from n=1 to n=3 and jumps at
 *     n=4 by exactly the band's entered-share.
 *   - Expected (2K, hooked | organic): n1 0.689 → n3 0.712 → n4 0.982.
 *     Jump n4−n3 = 0.271 ≈ band entered-share 0.268; flatness n3−n1 =
 *     0.023. | Organic: n1 0.0015 → n3 0.475 → n4 0.585 — a smooth ramp
 *     (n3−n1 = 0.473, n4−n3 = 0.111), no cliff at any ordinal.
 *
 *   Report 2: Flows, anchor "ticket created", visible reply/resolve/
 *   escalate — the REPLY-GRIND branch
 *   - Measure: share of entered on created→reply→reply (the band's organic
 *     resolved events are dropped, so its flows end in the grind; NOT the
 *     escalated-anchor path — organic F2 reply→resolved pairs follow any
 *     escalation closely enough that that read shows no contrast).
 *   - Expected (2K, hooked | organic): 0.418 | 0.171
 *
 * 3. AGENT vs REQUESTER SESSION SHAPE (everything) — role split at 0.90
 * PATTERN: applySessionShape retimes agents ([0.90, 1.00), ~10%) into ~5
 * long sessions/week (6 events over 45 min) and requesters ([0.00, 0.90))
 * into ~1 short session/week (28 events over 10 min). Derived sessions
 * (30-min timeout) reproduce the cadence exactly: agents live in the
 * product, requesters drop in weekly.
 *   Discovery: Session metrics (duration bimodality) + weekly unique
 *   sessions split by role.
 *
 *   Report 1: Insights, session duration distribution
 *   - Measure: p90 / median session duration (two modes: the 10-min
 *     requester mass at the median, the 45-min agent mass at p90). Both
 *     modes are near-deterministic: applySessionShape spreads events
 *     evenly across exactly sessionMinutes, so median = 600000 ms and
 *     p90 = 2700000 ms.
 *   - Expected (2K, hooked | organic): ratio 4.50 (600000 → 2700000 ms)
 *     | organic median 0 ms (~1.2 events per derived session — mostly
 *     singletons, ratio undefined). eventsPerSession median 26 | 1.
 *
 *   Report 2: Insights, unique sessions per week filtered by role
 *   - Measure: median weekly unique sessions / cohort size (per-capita
 *     cadence)
 *   - Expected (2K, hooked | organic): agents 3.92/wk | 25.8; requesters
 *     0.85/wk | 22.3. Per-user sessionize medians: agents 4.58
 *     sessions/wk @ 45.0 min, requesters 1.00/wk @ 10.0 min (cadence
 *     ratio 4.58x, duration ratio 4.50x | organic ratio 1.04x). The
 *     uniques per-capita runs slightly under the per-user cadence because
 *     splitEvenly hands remainder sessions to the EARLIEST weeks —
 *     low-budget users thin out in later calendar weeks.
 *
 * NOTE: engine shape guarantees apply to no-hook configs; this dungeon
 * retimes 100% of user streams into engineered session cadences. Daily
 * event totals stay flat but intraday/DOW soup structure is intentionally
 * replaced. That is the point of the dungeon.
 */

// ── SCALE ──
const SEED = "harness-support-desk";
const NUM_USERS = 5_000;
const DATASET_START = "2026-03-01T00:00:00Z";
const DATASET_END = "2026-05-23T23:59:59Z"; // 84 days = 12 whole weeks
const EVENTS_PER_DAY = 4;
const token = process.env.MP_TOKEN || "your-mixpanel-token";

// ── KNOBS (tweak these to reshape stories) ──
// Disjoint hashFloat(uid) cohort bands — see OVERVIEW for why not hashCohort.
const H1_BAND = [0.00, 0.45];   // one-touch resolution path, ~45%
const H2_BAND = [0.45, 0.70];   // cross-session escalation path, ~25%
const AGENT_BAND = [0.90, 1.00]; // session-shape cohort, ~10% ([0.70, 0.90) = untouched tail)

const ANCHOR = "ticket created";
// H1 gaps sit UNDER the requester in-session spacing (~21s between events:
// 28 events over 10 min) so no organic step cuts into the injected path.
const H1_GAP_SECONDS = [5, 20];
// H2 gaps sit OVER the 30-min session timeout so every step of the chain
// lands in its own derived session (resolved at session ordinal +3).
const H2_GAP_SECONDS = [3600, 14400];

const AGENT_SHAPE = { sessionsPerWeek: 5, eventsPerSession: 6, sessionMinutes: 45 };
const REQUESTER_SHAPE = { sessionsPerWeek: 1, eventsPerSession: 28, sessionMinutes: 10 };

const inBand = (x, [lo, hi]) => x >= lo && x < hi;

// ── HOOK ──
function hook(record, type, meta) {
	if (type === "user") {
		// Mirror the event-level role pin onto the profile (same hashFloat
		// band) so profile cohorts agree with event cohorts.
		if (record?.distinct_id) {
			record.role = inBand(hashFloat(record.distinct_id), AGENT_BAND) ? "agent" : "requester";
		}
		return record;
	}
	if (type !== "everything") return record;

	const userEvents = record;
	if (!Array.isArray(userEvents) || userEvents.length === 0) return record;
	const uid = meta?.user?.distinct_id || userEvents.find(e => e?.user_id)?.user_id;
	if (!uid) return record;
	const h = hashFloat(uid);
	const isAgent = inBand(h, AGENT_BAND);

	// Role pin: the engine stamps super props randomly per event — overwrite
	// on every event so the role cohort is deterministic (= hashFloat band).
	const role = isAgent ? "agent" : "requester";
	for (const e of userEvents) if (e) e.role = role;

	// H3: SESSION SHAPE — retime the whole stream first (see ORDERING RULE).
	applySessionShape(userEvents, uid, isAgent ? AGENT_SHAPE : REQUESTER_SHAPE);

	// H1: ONE-TOUCH RESOLUTION — in-session path after the first ticket.
	// share: 1 because the band gate is external (applyPathBias's internal
	// hashFloat gate would nest, not compose, with the band).
	if (inBand(h, H1_BAND)) {
		return applyPathBias(userEvents, uid, {
			anchor: ANCHOR,
			path: ["reply sent", "ticket resolved"],
			share: 1,
			gapSeconds: H1_GAP_SECONDS,
		});
	}

	// H2: ESCALATION CROSS-SESSION — inject the chain, then drop the band's
	// organic resolutions so the injected chain is the ONLY route to
	// "ticket resolved" (the 1-vs-4 session funnel contrast is then true by
	// construction). Injection first: applyPathBias clones from the user's
	// OWN stream, so the organic events must still be present as templates.
	if (inBand(h, H2_BAND)) {
		const before = userEvents.length;
		const organicResolved = new Set();
		for (const e of userEvents) if (e?.event === "ticket resolved") organicResolved.add(e);
		applyPathBias(userEvents, uid, {
			anchor: ANCHOR,
			path: ["ticket escalated", "reply sent", "ticket resolved"],
			share: 1,
			gapSeconds: H2_GAP_SECONDS,
		});
		// Skipped user (no anchor or missing template) → keep organic
		// resolutions; dropping them without the injected replacement would
		// leave the band resolution-less instead of slow-to-resolve.
		if (userEvents.length === before) return userEvents;
		return userEvents.filter(e => !(e?.event === "ticket resolved" && organicResolved.has(e)));
	}

	return userEvents;
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
		hasAvatar: false,
	},
	identity: {
		avgDevicePerUser: 2,
	},
	concurrency: 1,
	writeToDisk: false,

	funnels: [
		{
			sequence: ["account created", "dashboard viewed", "ticket created"],
			isFirstFunnel: true,
			conversionRate: 70,
			timeToConvert: 1,
		},
		{
			sequence: ["ticket created", "reply sent", "ticket resolved"],
			conversionRate: 50,
			timeToConvert: 4,
			weight: 3,
		},
		{
			sequence: ["search", "kb article viewed"],
			conversionRate: 60,
			timeToConvert: 0.5,
			weight: 2,
		},
		{
			sequence: ["ticket resolved", "csat submitted"],
			conversionRate: 40,
			timeToConvert: 1,
			weight: 1,
		},
	],

	events: [
		{
			event: "account created",
			weight: 1,
			isFirstEvent: true,
			isAuthEvent: true,
			properties: {
				signup_method: ["email", "google", "sso"],
				company_size_bucket: ["1-10", "11-50", "11-50", "51-200", "201-1000", "1000+"],
			},
		},
		{
			event: "ticket viewed",
			weight: 20,
			properties: {
				source: ["inbox", "inbox", "search", "notification", "direct_link"],
				unread: [true, false, false],
			},
		},
		{
			event: "dashboard viewed",
			weight: 14,
			properties: {
				view: ["inbox", "inbox", "my_tickets", "reports", "overview"],
				widget_count: u.weighNumRange(1, 12, 0.3, 4),
			},
		},
		{
			event: "kb article viewed",
			weight: 12,
			properties: {
				article_category: ["getting_started", "billing", "integrations", "troubleshooting", "troubleshooting"],
				helpful_vote: ["none", "none", "none", "up", "down"],
			},
		},
		{
			event: "search",
			weight: 10,
			properties: {
				query_length: u.weighNumRange(2, 40, 0.3, 12),
				results_count: u.weighNumRange(0, 80, 0.3, 9),
			},
		},
		{
			event: "ticket created",
			weight: 8,
			properties: {
				channel: ["email", "web_form", "web_form", "chat", "api"],
				priority: ["low", "normal", "normal", "high", "urgent"],
				category: ["billing", "bug", "bug", "how_to", "feature_request", "account"],
			},
		},
		{
			event: "reply sent",
			weight: 2,
			properties: {
				is_first_response: [true, false, false],
				response_length_chars: u.weighNumRange(40, 4000, 0.3, 320),
				has_attachment: [false, false, false, true],
			},
		},
		{
			event: "csat submitted",
			weight: 2,
			properties: {
				score: [5, 5, 4, 4, 3, 2, 1],
				comment_left: [false, false, true],
			},
		},
		{
			event: "ticket resolved",
			weight: 1,
			properties: {
				resolution: ["solved", "solved", "workaround", "duplicate", "no_response"],
				reopened: [false, false, false, false, true],
			},
		},
		{
			event: "ticket escalated",
			weight: 1,
			properties: {
				escalation_reason: ["sla_breach", "complexity", "complexity", "vip_customer", "wrong_queue"],
				tier: ["tier_2", "tier_2", "tier_3"],
			},
		},
	],

	superProps: {
		role: ["requester", "requester", "requester", "agent"],
		plan_tier: ["starter", "growth", "growth", "enterprise"],
	},

	userProps: {
		role: ["requester", "requester", "requester", "agent"],
		team_size: u.weighNumRange(1, 500, 0.3, 25),
		industry: ["software", "software", "ecommerce", "finance", "healthcare", "education"],
		support_plan: ["standard", "standard", "priority", "premium"],
	},

	hook,
};

export default config;

// ── STORIES ──
/*
 * Derivation notes (2K reduced run iter-support-desk-1 vs organic
 * counterfactual iter-support-desk-0, hook overridden to identity; full
 * fidelity = 5K users, expected populations ≈ 2.5x the 2K numbers; scale
 * guards at ~50% of that). The hook makes chance draws, so the hooked and
 * organic runs have DIFFERENT downstream user populations — organic
 * numbers are a statistical counterfactual, not per-user paired.
 *
 *  - bands at 2K: h1 892, h2 537, tail 401, agent 170 (profile role pin
 *    agrees exactly: 170 agents).
 *  - H1 flows (topPaths anchor created, forward 2, visible reply/resolve/
 *    escalate, unique): totalEntered 1924; created→reply→resolved 817 =
 *    0.4246 (the H1 band with ~95% template capture); created→reply→reply
 *    804 = 0.418 (H2's grind); created→reply→escalated 170 = 0.088.
 *    Re-derived for fix-round B1 (leaf-row list semantics,
 *    flows_merger.cpp:362/:174): list rows are now one-per-leaf with
 *    count = leaf total_count. All three paths above sit at slot 2 — the
 *    full forward-2 capacity — so their nodes are max-depth leaves where
 *    leaf total == the old terminus dropoff: the counts and shares are
 *    UNCHANGED. Short-prefix terminus rows (e.g. bare 'ticket created')
 *    no longer appear as rows; pathShare's exact label match never
 *    referenced them.
 *    ORGANIC: target 0.618 (any converting F2 pass eventually yields the
 *    same labels — the label-only read INVERTS), grind 0.171. So H1
 *    asserts the share is PINNED to the band (INVERSE = organic-diffuse
 *    high side), not "hooked > organic".
 *  - funnelFrequency created→reply→resolved, session windows (entered
 *    1924 hooked / 1945 organic): hooked n1 0.6887, n2 0.7053, n3 0.7115,
 *    n4 0.9823, n6 0.9875 — flat n1→n3 (+0.023), cliff at n4 (+0.2708 ≈
 *    H2 entered-share 0.268, resolved at session ordinal +3 exactly).
 *    ORGANIC: n1 0.0015 (3/1945 — ~1.2 events per derived session, nothing
 *    converts in-session), n3 0.4746, n4 0.5851 — smooth ramp, no cliff.
 *    Honest attribution for n1: H1's band is 0.464 of entered; the rest of
 *    the hooked 0.689 is organic F2 passes that H3's session shaping glued
 *    into single derived sessions (requesters get ~28-event sessions).
 *  - sessionMetrics (30-min timeout): hooked total_sessions 27552;
 *    duration median_ms 600000 / p90_ms 2700000 (ratio 4.50 — both modes
 *    near-deterministic: applySessionShape spreads events evenly across
 *    exactly sessionMinutes); eventsPerSession median 26. ORGANIC: 530359
 *    sessions, duration median_ms 0 (singletons), eventsPerSession avg 1.2.
 *  - uniques weekly sessions by role (per-capita = median weekly uniques /
 *    profile cohort): agents 667/170 = 3.924/wk, requesters 1561/1830 =
 *    0.853/wk. Weekly requester counts DECLINE 1645→1214 across the
 *    window: splitEvenly hands remainder sessions to the earliest weeks,
 *    so low-budget users thin out late — bands widened below the 2K
 *    median to absorb the alignment shift when generation moves the
 *    window to the present. ORGANIC: agents 25.845/wk, requesters
 *    22.288/wk (ratio 1.04x).
 *  - sessionize per-user medians (cross-check, duckdb LAG >30min): agents
 *    4.583 sessions/wk @ 45.00 min, requesters 1.000/wk @ 10.00 min —
 *    cadence ratio 4.58x, duration ratio 4.50x (organic 1.04x / n/a).
 *  - identity: uid_share 1.0, device_share 0.9994, devices/user 2.05
 *    (avgDevicePerUser: 2).
 */

const EV = `read_json_auto('{{PREFIX}}-EVENTS*.json', sample_size=-1, union_by_name=true)`;

const bandVerdict = (x, nailed, strong, detail, inverse = () => false) => {
	if (x == null || Number.isNaN(Number(x))) return { verdict: "NONE", detail: `${detail} — metric missing` };
	const v = Number(x);
	if (inverse(v)) return { verdict: "INVERSE", detail };
	if (v >= nailed[0] && v <= nailed[1]) return { verdict: "NAILED", detail };
	if (v >= strong[0] && v <= strong[1]) return { verdict: "STRONG", detail };
	return { verdict: "WEAK", detail };
};

const guarded = (ok, detail, inner) => ok ? inner() : { verdict: "WEAK", detail: `${detail} — cohort below scale guard (expected at reduced scale)` };

const worstOf = (...verdicts) => {
	const order = ["INVERSE", "NONE", "WEAK", "STRONG", "NAILED"];
	const worst = order.find(o => verdicts.some(v => v.verdict === o)) || "NONE";
	return { verdict: worst, detail: verdicts.map(v => v.detail).join("; ") };
};

const medianOf = (arr) => {
	const s = [...arr].sort((a, b) => a - b);
	const m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// funnelFrequency rows are keyed (step_index, breakdown_freq); conversions
// are COUNT_LIKE — entered = sum at step 0, converters = sum at max step.
const freqRate = (rows) => {
	if (!Array.isArray(rows) || !rows.length) return null;
	const maxStep = Math.max(...rows.map(r => r.step_index));
	const entered = rows.filter(r => r.step_index === 0).reduce((a, r) => a + r.conversions, 0);
	const converted = rows.filter(r => r.step_index === maxStep).reduce((a, r) => a + r.conversions, 0);
	return { entered, converted, rate: entered ? converted / entered : null };
};

const RESOLUTION_STEPS = ["ticket created", "reply sent", "ticket resolved"];
const FLOWS_ARGS = {
	type: "topPaths",
	anchors: [ANCHOR],
	forward: 2,
	reverse: 0,
	countType: "unique",
	visibleEvents: ["reply sent", "ticket resolved", "ticket escalated"],
};
const pathShare = (tp, labels) => {
	if (!tp || !Array.isArray(tp.paths) || !tp.totalEntered) return null;
	const hit = tp.paths.find(p => p.steps.map(s => s.label).join("|") === labels.join("|"));
	return (hit?.count ?? 0) / tp.totalEntered;
};

export const stories = [
	{
		id: "support-desk-h1-one-touch-resolution",
		hook: "H1",
		archetype: "path-share",
		narrative: "The [0, 0.45) band gets a canned-macro resolution injected 5-20s after its first ticket: Flows on 'ticket created' splits bimodally — the one-touch branch share is PINNED to the band (~0.42; organically the label-only read is a diffuse 0.62, so too-high is the failure mode) — and the Resolution funnel converts in ONE derived session for ~0.69 of entered (organic 0.0015: ~1.2 events per organic session, nothing converts in-session).",
		assertions: [
			{
				breakdown: FLOWS_ARGS,
				assert: (tp) => {
					const share = pathShare(tp, RESOLUTION_STEPS);
					if (share == null) return { verdict: "NONE", detail: `topPaths returned no paths (totalEntered=${tp?.totalEntered})` };
					return guarded(tp.totalEntered >= 2400, `${tp.totalEntered} entered`,
						() => bandVerdict(share, [0.36, 0.49], [0.32, 0.53],
							`created→reply→resolved share ${share.toFixed(3)} of ${tp.totalEntered} entered (expect ~0.42 pinned to band; organic 0.618 diffuse)`,
							v => v > 0.55));
				},
			},
			{
				breakdown: {
					type: "funnelFrequency",
					steps: RESOLUTION_STEPS,
					breakdownByFrequencyOf: ANCHOR,
					conversionWindow: { unit: "sessions", n: 1 },
				},
				assert: (rows) => {
					const f = freqRate(rows);
					if (!f || f.rate == null) return { verdict: "NONE", detail: "funnelFrequency returned no rows" };
					return guarded(f.entered >= 2400, `${f.entered} entered`,
						() => bandVerdict(f.rate, [0.60, 0.78], [0.50, 0.85],
							`1-session conversion ${f.converted}/${f.entered} = ${f.rate.toFixed(4)} (expect ~0.69, organic 0.0015)`,
							v => v < 0.05));
				},
			},
		],
	},
	{
		id: "support-desk-h2-cross-session-escalation",
		hook: "H2",
		archetype: "frequency-sweet-spot",
		narrative: "The [0.45, 0.70) band's organic resolutions are dropped and replaced by an injected escalated→reply→resolved chain with 1-4h gaps — resolved lands at session ordinal +3, so the Resolution funnel is FLAT from 1- to 3-session windows (~0.71 floor) and jumps to ~0.98 at 4 sessions (the +0.27 cliff = the band's entered-share; organic ramps smoothly 0.47→0.59 with no cliff). In Flows the band's paths end in the reply grind (created→reply→reply ~0.42 vs organic 0.17).",
		assertions: [
			{
				breakdown: {
					type: "funnelFrequency",
					steps: RESOLUTION_STEPS,
					breakdownByFrequencyOf: ANCHOR,
					conversionWindow: { unit: "sessions", n: 3 },
				},
				assert: (rows) => {
					const f = freqRate(rows);
					if (!f || f.rate == null) return { verdict: "NONE", detail: "funnelFrequency returned no rows" };
					return guarded(f.entered >= 2400, `${f.entered} entered`,
						() => bandVerdict(f.rate, [0.63, 0.79], [0.55, 0.85],
							`3-session conversion ${f.rate.toFixed(4)} — the pre-cliff floor (expect ~0.71: H2's band still unconverted; organic 0.475)`,
							v => v < 0.25));
				},
			},
			{
				breakdown: {
					type: "funnelFrequency",
					steps: RESOLUTION_STEPS,
					breakdownByFrequencyOf: ANCHOR,
					conversionWindow: { unit: "sessions", n: 4 },
				},
				assert: (rows) => {
					const f = freqRate(rows);
					if (!f || f.rate == null) return { verdict: "NONE", detail: "funnelFrequency returned no rows" };
					return guarded(f.entered >= 2400, `${f.entered} entered`,
						() => bandVerdict(f.rate, [0.94, 1.0], [0.88, 1.0],
							`4-session conversion ${f.rate.toFixed(4)} — past the cliff (expect ~0.98; organic 0.585). With the 3-session floor ≤0.79 this pins the ordinal-+3 jump`,
							v => v < 0.70));
				},
			},
			{
				breakdown: FLOWS_ARGS,
				assert: (tp) => {
					const share = pathShare(tp, ["ticket created", "reply sent", "reply sent"]);
					if (share == null) return { verdict: "NONE", detail: `topPaths returned no paths (totalEntered=${tp?.totalEntered})` };
					return guarded(tp.totalEntered >= 2400, `${tp.totalEntered} entered`,
						() => bandVerdict(share, [0.34, 0.49], [0.28, 0.53],
							`created→reply→reply grind share ${share.toFixed(3)} (expect ~0.42: H1's band + H2's resolved-drop; organic 0.171)`,
							v => v < 0.20));
				},
			},
		],
	},
	{
		id: "support-desk-h3-agent-requester-session-shape",
		hook: "H3",
		archetype: "session-shape",
		narrative: "applySessionShape retimes agents ([0.90, 1.00), ~10%, role pinned on profile + every event) into ~5 long 45-min sessions/week and requesters into ~1 short 10-min session/week of ~28 events: session duration is bimodal (median 600000 ms = the requester mode, p90 2700000 ms = the agent mode, ratio 4.5), eventsPerSession median ~26, and weekly unique sessions per capita split ~3.9/wk (agents) vs ~0.85/wk (requesters) — organic sessions are ~1.2-event singletons (median duration 0) at ~22-26 sessions/user/wk for BOTH roles.",
		assertions: [
			{
				breakdown: { type: "sessionMetrics", metrics: ["count", "duration", "eventsPerSession"] },
				assert: (rows) => {
					if (!Array.isArray(rows) || !rows.length) return { verdict: "NONE", detail: "sessionMetrics returned no rows" };
					const count = rows.find(r => r.metric === "count");
					const dur = rows.find(r => r.metric === "duration");
					const eps = rows.find(r => r.metric === "eventsPerSession");
					if (!count || !dur || !eps) return { verdict: "NONE", detail: "missing sessionMetrics rows" };
					return guarded(count.total_sessions >= 34000, `${count.total_sessions} sessions`, () => {
						const legMedian = bandVerdict(dur.median_ms, [480000, 660000], [360000, 720000],
							`duration median ${dur.median_ms}ms (expect 600000 — the 10-min requester mode; organic 0)`,
							v => v < 120000);
						const ratio = dur.median_ms > 0 ? dur.p90_ms / dur.median_ms : null;
						const legRatio = bandVerdict(ratio, [3.8, 5.2], [3.0, 6.5],
							`duration p90/median ${ratio == null ? "n/a" : ratio.toFixed(2)} (expect 4.50 — 45-min agent mode over 10-min requester mode)`,
							v => v < 1.5);
						const legEps = bandVerdict(eps.median, [23, 28], [19, 28],
							`eventsPerSession median ${eps.median} (expect ~26; organic ~1)`,
							v => v <= 3);
						return worstOf(legMedian, legRatio, legEps);
					});
				},
			},
			{
				breakdown: { type: "uniques", unit: "week", countType: "sessions", where: { role: "agent" } },
				assert: (rows, ctx) => {
					if (!Array.isArray(rows) || !rows.length) return { verdict: "NONE", detail: "uniques returned no rows" };
					const cohort = (ctx?.profiles || []).filter(p => p.role === "agent").length;
					if (!cohort) return { verdict: "NONE", detail: "no agent profiles in ctx" };
					const perCapita = medianOf(rows.map(r => r.uniques)) / cohort;
					return guarded(cohort >= 210, `${cohort} agents`,
						() => bandVerdict(perCapita, [3.2, 4.6], [2.8, 5.2],
							`agent weekly sessions per capita ${perCapita.toFixed(2)} (expect ~3.9; organic ~25.8)`,
							v => v > 8));
				},
			},
			{
				breakdown: { type: "uniques", unit: "week", countType: "sessions", where: { role: "requester" } },
				assert: (rows, ctx) => {
					if (!Array.isArray(rows) || !rows.length) return { verdict: "NONE", detail: "uniques returned no rows" };
					const cohort = (ctx?.profiles || []).filter(p => p.role === "requester").length;
					if (!cohort) return { verdict: "NONE", detail: "no requester profiles in ctx" };
					const perCapita = medianOf(rows.map(r => r.uniques)) / cohort;
					return guarded(cohort >= 2250, `${cohort} requesters`,
						() => bandVerdict(perCapita, [0.62, 1.10], [0.55, 1.30],
							`requester weekly sessions per capita ${perCapita.toFixed(2)} (expect ~0.85, sagging late from splitEvenly's early-week remainder; organic ~22.3)`,
							v => v > 3));
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `WITH e AS (
  SELECT user_id::VARCHAR AS uid, role, time::TIMESTAMP AS t,
    CASE WHEN LAG(time::TIMESTAMP) OVER (PARTITION BY user_id::VARCHAR ORDER BY time::TIMESTAMP) IS NULL
      OR time::TIMESTAMP - LAG(time::TIMESTAMP) OVER (PARTITION BY user_id::VARCHAR ORDER BY time::TIMESTAMP) > INTERVAL 30 MINUTE
      THEN 1 ELSE 0 END AS is_start
  FROM ${EV} WHERE user_id IS NOT NULL
), s AS (
  SELECT uid, role, t, SUM(is_start) OVER (PARTITION BY uid ORDER BY t) AS sid FROM e
), sess AS (
  SELECT uid, ANY_VALUE(role) AS role, sid, EXTRACT(EPOCH FROM MAX(t) - MIN(t))::DOUBLE / 60.0 AS dur_min
  FROM s GROUP BY uid, sid
), per_user AS (
  SELECT uid, ANY_VALUE(role) AS role, COUNT(*)::DOUBLE / 12.0 AS spw FROM sess GROUP BY uid
)
SELECT
  (SELECT COUNT(*) FROM per_user WHERE role = 'agent') AS agent_users,
  (SELECT MEDIAN(spw) FROM per_user WHERE role = 'agent') AS agent_spw,
  (SELECT MEDIAN(spw) FROM per_user WHERE role = 'requester') AS req_spw,
  (SELECT MEDIAN(dur_min) FROM sess WHERE role = 'agent') AS agent_dur,
  (SELECT MEDIAN(dur_min) FROM sess WHERE role = 'requester') AS req_dur`,
				},
				assert: (rows) => {
					const r = rows?.[0];
					if (!r) return { verdict: "NONE", detail: "session cadence query returned no rows" };
					return guarded(Number(r.agent_users) >= 210, `${r.agent_users} agent users`, () => {
						const cadence = Number(r.agent_spw) / Number(r.req_spw);
						const durRatio = Number(r.agent_dur) / Number(r.req_dur);
						const legCadence = bandVerdict(cadence, [3.6, 5.6], [3.0, 6.5],
							`per-user cadence ratio ${Number(r.agent_spw).toFixed(2)}/${Number(r.req_spw).toFixed(2)} = ${cadence.toFixed(2)}x (expect ~4.6x; organic 1.04x)`,
							v => v < 1.5);
						const legDur = bandVerdict(durRatio, [3.5, 5.5], [2.8, 6.5],
							`median session duration ratio ${Number(r.agent_dur).toFixed(1)}min/${Number(r.req_dur).toFixed(1)}min = ${durRatio.toFixed(2)}x (expect 4.5x)`,
							v => v < 1.5);
						return worstOf(legCadence, legDur);
					});
				},
			},
			{
				breakdown: {
					type: "duckdb",
					sql: `SELECT COUNT(*) AS n,
  AVG((user_id IS NOT NULL)::INT) AS uid_share,
  AVG((device_id IS NOT NULL)::INT) AS device_share,
  COUNT(DISTINCT device_id)::DOUBLE / COUNT(DISTINCT user_id) AS dpu
FROM ${EV}`,
				},
				assert: (rows) => {
					const r = rows?.[0];
					if (!r) return { verdict: "NONE", detail: "identity query returned no rows" };
					const legUid = bandVerdict(Number(r.uid_share), [1, 1], [0.999, 1],
						`uid_share ${Number(r.uid_share).toFixed(4)} (every event carries user_id)`, v => v < 0.99);
					const legDev = bandVerdict(Number(r.device_share), [0.99, 1], [0.97, 1],
						`device_share ${Number(r.device_share).toFixed(4)} (avgDevicePerUser: 2)`, v => v < 0.9);
					const legDpu = bandVerdict(Number(r.dpu), [1.6, 2.4], [1.4, 2.6],
						`devices/user ${Number(r.dpu).toFixed(2)} (expect ~2.05)`, v => v < 1.05);
					return worstOf(legUid, legDev, legDpu);
				},
			},
		],
	},
];
