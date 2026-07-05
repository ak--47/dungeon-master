/**
 * Flows ("Top Paths") — the per-user flow-extraction state machine matching
 * Mixpanel's ARB flows reader (P1.9).
 *
 * This module extracts per-user flows exactly the way the ARB flows query
 * builds them; aggregation into the prefix tree / sankey output lives in the
 * companion aggregation layer wired through emulateBreakdown.
 *
 * ARB semantics implemented here (source: mixpanel/analytics):
 *
 * - NEXT-ANCHOR-ONLY matching: "Regular flows queries are always in order,
 *   so check only against the next anchor step filter" — the candidate is
 *   always `reached_anchor + 1` (flows_query.cpp:988-994, flow_get_reached_anchor).
 *   An event that matches a LATER anchor (or an earlier one again) is a plain
 *   non-anchor step.
 * - BUFFERS: flow_create (flows.cpp:680-717) allocates one anchor buffer, one
 *   linear forward buffer per anchor, one CIRCULAR reverse buffer per anchor;
 *   reached_anchor starts at -1 and the active buffer starts at reverse[0].
 *   Circular buffers are only ever "full" when their capacity is 0 and keep
 *   the LAST N steps (flows.cpp:575-600 flow_buffer_is_full / flow_buffer_add).
 * - ADMISSION: visible/hidden event filters apply ONLY to non-anchor steps
 *   (flows_query.cpp:1019-1036 — both filters sit under `if (!is_anchor)`).
 *   A non-anchor is added iff the active buffer can accept it
 *   (flow_can_accept_non_anchor_step); pure in-order flows are never
 *   out-of-order. Anchor names are stripped from the hidden list
 *   (dqs/query/flows.go filterAnchorEventNames) and hidden names are stripped
 *   from the visible list (dqs/query/flows.go filteredVisibleEventSelectors)
 *   — so hidden wins over visible, and anchors are exempt from both.
 * - ADDING STEPS: flow_add_step (flows.cpp:878-943). Anchors always add
 *   (no collapse check) and switch the active buffer to forward[reached].
 *   Non-anchors are suppressed under collapseRepeated iff equal to the LAST
 *   ADDED step — which may be an anchor — comparing event name and every
 *   segment value (flows.cpp:849-876 flow_is_step_repeated); a suppressed add
 *   does NOT update the last-step pointer. After EVERY flow_add_step call
 *   (even a suppressed one) a full linear forward buffer hands the active
 *   pointer to reverse[reached + 1] unless all anchors are seen
 *   (flows.cpp:936-943) — this also covers capacity-0 forward buffers, which
 *   are full at the moment their anchor lands.
 * - COUNT TYPES:
 *   - 'unique': one flow per user across the whole stream, flushed at end of
 *     data. The started_any_flow ignore-branch (flows_query.cpp:1100-1111)
 *     never fires for pure flows because nothing resets the flow mid-stream.
 *   - 'general': alias of 'unique' here. The restart branch
 *     (flows_query.cpp:1006-1009) is gated on flow_reached_funnel_end, which
 *     "For flows not driven by funnels, always returns false"
 *     (flows.cpp:790-801) — so general and unique coincide for pure flows.
 *   - 'sessions': every session end flushes all flows in progress and resets
 *     (flows_query.cpp:1156-1161) — one flow universe per session. Session
 *     boundaries derive from the user's FULL event stream (session triggers
 *     per session_query.cpp via sessionize/sessionOrdinals — P1.7.1), not
 *     from the filtered steps.
 * - FLUSH: end of data flushes all partial flows (flows_query.cpp:1369-1374
 *   print_results); a flow with zero anchors contributes nothing
 *   (flow_is_empty guard, flows_query.cpp:844-848; flow_is_empty = empty
 *   anchor buffer, flows.cpp:756-761).
 * - $ttc: last reached anchor time minus first anchor time, clamped at 0
 *   (flows.cpp:828-839). converted: `num_anchors > 1 && reached_anchor + 1 ==
 *   num_anchors` (flows.cpp:841-847) — single-anchor flows are NEVER converted.
 * - STEP NUMBERING (flow_aggregate, flows.cpp:943-1146): capacity-slotted,
 *   not dense. Under alignment LEFT (flows_query.cpp:664-668 fallback loop)
 *   and anchor_position FUNNEL — the PROTO enum default
 *   (request_params.proto:59, FUNNEL = 0), which is what the Top Paths list
 *   view sends (set_flows_defaults_for_top_paths_chart_type, bookmark.py:82-96,
 *   never sets anchor_position). NOTE: the product's default SANKEY view
 *   overrides to STEP_AND_FUNNEL = 1 (set_flows_defaults_for_sankey_chart_type,
 *   bookmark.py:109) — this emulator implements FUNNEL numbering ONLY and so
 *   matches the list/Top Paths flavor, not the sankey default —
 *   anchor i sits at the fixed slot
 *   `Σ_{j<=i} reverseCap[j] + Σ_{j<i} forwardCap[j] + i`; forward steps run
 *   contiguously after their anchor (LEFT); reverse steps pack flush AGAINST
 *   their anchor slot (the C++ LEFT-alignment branch for reverse requires
 *   anchor_position != FUNNEL, so FUNNEL takes the packed start
 *   `prev_step_number + fwd_cap[i-1] + available + 1`, i.e. slots
 *   `slot(i) - size .. slot(i) - 1`); there is no relative-anchor duplication
 *   (both duplication blocks require anchor_position != FUNNEL). A non-empty
 *   trailing reverse buffer reverse[reached + 1] is emitted after the last
 *   forward block (the aggregate loop breaks after filling reverse at
 *   i == reached_anchor + 1). Assembly order is chronological:
 *   rev[0], anchor0, fwd[0], rev[1], anchor1, fwd[1], ..., trailing rev.
 * - forward/reverse per-anchor step counts pass through verbatim from the
 *   bookmark (dqs/query/flows.go step.Forward/step.Reverse; bookmark.py
 *   carries per-step "forward"/"reverse" keys with no server default). The
 *   defaults here (forward 4, reverse 0) are this emulator's contract
 *   mirroring the Flows UI's default view — they are NOT ARB constants.
 */

import { toMs } from '../hook-helpers/_internal.js';
import { resolveUserId } from './identity.js';
import { coerceToBreakdownKey, matchesWhere } from './coerce.js';
import { sessionOrdinals } from './sessionize.js';

/**
 * @typedef {Object} FlowAnchor
 * @property {string} event
 * @property {Object<string, *>} [where] step filter (matchesWhere shape)
 */

/**
 * @typedef {Object} FlowStep
 * @property {string} label event name
 * @property {number} timeMs
 * @property {number} stepNumber capacity slot (see header — NOT a dense index)
 * @property {boolean} isAnchor
 * @property {number} [anchorIndex] present on anchor steps
 * @property {string} [value] coerced breakdown segment value (when breakdownProperty set)
 */

/**
 * @typedef {Object} FlowRecord
 * @property {string} userId
 * @property {Array<FlowStep>} steps chronological
 * @property {number} reachedAnchor highest anchor index reached (>= 0)
 * @property {boolean} converted all anchors reached AND more than one anchor
 * @property {number} ttcMs last reached anchor time - first anchor time, >= 0
 */

/**
 * Broadcast a scalar per-anchor knob to an array, or validate a supplied array.
 * @param {number|Array<number>|undefined} v
 * @param {number} defaultValue
 * @param {number} count
 * @param {string} name
 * @returns {Array<number>}
 */
function broadcastCaps(v, defaultValue, count, name) {
	const arr = Array.isArray(v)
		? v.slice()
		: new Array(count).fill(v == null ? defaultValue : v);
	if (arr.length !== count) {
		throw new Error(`extractFlows: ${name} array length ${arr.length} does not match anchors length ${count}`);
	}
	for (const n of arr) {
		if (!Number.isInteger(n) || n < 0) {
			throw new Error(`extractFlows: ${name} entries must be non-negative integers, got ${n}`);
		}
	}
	return arr;
}

/**
 * Extract per-user flows from raw events.
 *
 * @param {Array<Object>} events flat event records
 * @param {Object} options
 * @param {Array<string|FlowAnchor>} options.anchors ordered anchor steps (>= 1)
 * @param {number|Array<number>} [options.forward=4] steps kept AFTER each anchor (per-anchor array or scalar broadcast)
 * @param {number|Array<number>} [options.reverse=0] steps kept BEFORE each anchor (ring — keeps the LAST N)
 * @param {'unique'|'general'|'sessions'} [options.countType='unique']
 * @param {Array<string>} [options.hiddenEvents] dropped from non-anchor steps (anchor names exempt)
 * @param {Array<string>} [options.visibleEvents] when non-empty, non-anchor allow-list (hidden wins)
 * @param {boolean} [options.collapseRepeated=false]
 * @param {string} [options.breakdownProperty] stamps a coerced segment value on every step
 * @param {number} [options.sessionTimeoutMs] sessions countType only (default 30 min)
 * @param {number} [options.maxSessionMs] sessions countType only (default 24 h)
 * @param {Map<string,string>} [options.identityMap] device_id → canonical id
 * @returns {Array<FlowRecord>} deterministic order: first-step time, then userId
 */
export function extractFlows(events, {
	anchors,
	forward,
	reverse,
	countType = 'unique',
	hiddenEvents,
	visibleEvents,
	collapseRepeated = false,
	breakdownProperty,
	sessionTimeoutMs,
	maxSessionMs,
	identityMap,
} = /** @type {*} */ ({})) {
	if (!Array.isArray(events)) throw new Error('extractFlows: events must be an array');
	if (!Array.isArray(anchors) || anchors.length === 0) {
		throw new Error('extractFlows: anchors must be a non-empty array');
	}
	/** @type {Array<FlowAnchor>} */
	const anchorDefs = anchors.map((a) => {
		if (typeof a === 'string') return { event: a };
		if (a && typeof a === 'object' && typeof a.event === 'string') return { event: a.event, where: a.where };
		throw new Error('extractFlows: each anchor must be an event name or { event, where }');
	});
	if (countType !== 'unique' && countType !== 'general' && countType !== 'sessions') {
		throw new Error(`extractFlows: countType must be "unique", "general", or "sessions", got "${countType}"`);
	}

	const A = anchorDefs.length;
	const fwdCaps = broadcastCaps(forward, 4, A, 'forward');
	const revCaps = broadcastCaps(reverse, 0, A, 'reverse');

	// Anchor names are exempt from hiding (query/flows.go filterAnchorEventNames);
	// hidden names are removed from the visible list (filteredVisibleEventSelectors).
	const anchorNames = new Set(anchorDefs.map((a) => a.event));
	const hiddenSet = new Set((hiddenEvents || []).filter((n) => !anchorNames.has(n)));
	const visibleSet = (visibleEvents && visibleEvents.length)
		? new Set(visibleEvents.filter((n) => !hiddenSet.has(n)))
		: null;

	// Capacity slots: slot(i) = Σ_{j<=i} revCaps[j] + Σ_{j<i} fwdCaps[j] + i
	// (flow_aggregate step numbering under LEFT + FUNNEL — see header).
	const anchorSlots = [];
	{
		let acc = 0;
		for (let i = 0; i < A; i++) {
			acc += revCaps[i];
			anchorSlots.push(acc + i);
			acc += fwdCaps[i];
		}
	}

	/** flow_create (flows.cpp:680-717): reached -1, active = reverse[0]. */
	const makeFlow = () => ({
		/** @type {Array<Object|null>} */ anchors: new Array(A).fill(null),
		reached: -1,
		/** @type {Array<Array<Object>>} */ fwd: fwdCaps.map(() => []),
		/** @type {Array<Array<Object>>} */ rev: revCaps.map(() => []),
		active: { kind: 'rev', idx: 0 },
		/** @type {Object|null} */ lastStep: null,
	});

	/** @param {ReturnType<typeof makeFlow>} f */
	const activeCanAccept = (f) => (f.active.kind === 'rev'
		// circular buffers are full only at capacity 0 (flows.cpp:575-600)
		? revCaps[f.active.idx] > 0
		: f.fwd[f.active.idx].length < fwdCaps[f.active.idx]);

	/**
	 * Post-add switch (flows.cpp:936-943): a full linear forward buffer hands
	 * the active pointer to the NEXT anchor's reverse ring — runs after every
	 * flow_add_step, including collapse-suppressed ones.
	 * @param {ReturnType<typeof makeFlow>} f
	 */
	const tailSwitch = (f) => {
		if (f.active.kind === 'fwd'
			&& f.fwd[f.active.idx].length >= fwdCaps[f.active.idx]
			&& f.reached + 1 < A) {
			f.active = { kind: 'rev', idx: f.reached + 1 };
		}
	};

	/** @param {Object} e @param {number} ms */
	const mkStep = (e, ms) => {
		/** @type {Object} */ const s = { label: e.event, timeMs: ms };
		if (breakdownProperty != null) s.value = coerceToBreakdownKey(e[breakdownProperty]);
		return s;
	};

	/** Segment-aware repeat check (flows.cpp:849-876): event name + segment values. */
	const stepEquals = (a, b) => a.label === b.label && a.value === b.value;

	/**
	 * @param {ReturnType<typeof makeFlow>} f
	 * @param {Object} e
	 * @param {number} ms
	 */
	const processEvent = (f, e, ms) => {
		// Next-anchor-only (flows_query.cpp:988-994)
		const cand = f.reached + 1;
		const def = cand < A ? anchorDefs[cand] : null;
		if (def && e.event === def.event && matchesWhere(e, def.where)) {
			const step = mkStep(e, ms);
			f.anchors[cand] = step;
			f.reached = cand;
			f.active = { kind: 'fwd', idx: cand };
			f.lastStep = step; // buffer_of_last_step updates on anchor adds too
			tailSwitch(f);
			return;
		}
		// Non-anchor path: filters apply only here (flows_query.cpp:1019-1036)
		if (hiddenSet.has(e.event)) return;
		if (visibleSet && !visibleSet.has(e.event)) return;
		if (!activeCanAccept(f)) return; // flow_can_accept_non_anchor_step
		const step = mkStep(e, ms);
		if (!(collapseRepeated && f.lastStep && stepEquals(f.lastStep, step))) {
			if (f.active.kind === 'rev') {
				const buf = f.rev[f.active.idx];
				buf.push(step);
				if (buf.length > revCaps[f.active.idx]) buf.shift(); // ring keeps the LAST N
			} else {
				f.fwd[f.active.idx].push(step);
			}
			f.lastStep = step;
		}
		tailSwitch(f);
	};

	/** @type {Array<FlowRecord>} */
	const flows = [];

	/**
	 * @param {ReturnType<typeof makeFlow>} f
	 * @param {string} userId
	 */
	const flush = (f, userId) => {
		// Zero-anchor flows contribute nothing (flows_query.cpp:844-848; flows.cpp:756-761)
		if (f.reached < 0) return;
		/** @type {Array<FlowStep>} */
		const steps = [];
		for (let i = 0; i <= f.reached; i++) {
			const rev = f.rev[i];
			for (let k = 0; k < rev.length; k++) {
				steps.push({ ...rev[k], stepNumber: anchorSlots[i] - rev.length + k, isAnchor: false });
			}
			steps.push({ .../** @type {Object} */ (f.anchors[i]), stepNumber: anchorSlots[i], isAnchor: true, anchorIndex: i });
			const fwd = f.fwd[i];
			for (let k = 0; k < fwd.length; k++) {
				steps.push({ ...fwd[k], stepNumber: anchorSlots[i] + 1 + k, isAnchor: false });
			}
		}
		// Trailing reverse buffer of the never-reached next anchor
		if (f.reached + 1 < A) {
			const trail = f.rev[f.reached + 1];
			for (let k = 0; k < trail.length; k++) {
				steps.push({ ...trail[k], stepNumber: anchorSlots[f.reached + 1] - trail.length + k, isAnchor: false });
			}
		}
		const first = /** @type {Object} */ (f.anchors[0]);
		const last = /** @type {Object} */ (f.anchors[f.reached]);
		flows.push({
			userId,
			steps,
			reachedAnchor: f.reached,
			converted: A > 1 && f.reached === A - 1, // flows.cpp:841-847
			ttcMs: Math.max(0, last.timeMs - first.timeMs), // flows.cpp:828-839
		});
	};

	// Group by resolved user; empty-uid and unparseable-time events are skipped
	// (ARB's per-user state container behavior, matching sessionize).
	/** @type {Map<string, Array<{e: Object, ms: number, idx: number}>>} */
	const byUser = new Map();
	for (let idx = 0; idx < events.length; idx++) {
		const e = events[idx];
		if (!e) continue;
		const uid = resolveUserId(e, identityMap);
		if (!uid) continue;
		const ms = toMs(e.time);
		if (!Number.isFinite(ms)) continue;
		if (!byUser.has(uid)) byUser.set(uid, []);
		byUser.get(uid).push({ e, ms, idx });
	}

	for (const [uid, list] of byUser) {
		list.sort((a, b) => a.ms - b.ms || a.idx - b.idx);
		if (countType === 'sessions') {
			// Session boundaries derive from the user's FULL stream; a session
			// end flushes + resets (flows_query.cpp:1156-1161).
			const ordinals = sessionOrdinals(list.map((x) => x.e), {
				...(sessionTimeoutMs !== undefined ? { timeoutMs: sessionTimeoutMs } : {}),
				...(maxSessionMs !== undefined ? { maxSessionMs } : {}),
			});
			let f = makeFlow();
			let curOrd = null;
			for (const { e, ms } of list) {
				const ord = ordinals.get(e);
				if (ord === undefined) continue;
				if (curOrd !== null && ord !== curOrd) {
					flush(f, uid);
					f = makeFlow();
				}
				curOrd = ord;
				processEvent(f, e, ms);
			}
			flush(f, uid); // end of data flushes partial flows (flows_query.cpp:1369-1374)
		} else {
			// 'unique' and 'general' coincide for pure flows (see header)
			const f = makeFlow();
			for (const { e, ms } of list) processEvent(f, e, ms);
			flush(f, uid);
		}
	}

	flows.sort((a, b) => a.steps[0].timeMs - b.steps[0].timeMs
		|| cmpStr(String(a.userId), String(b.userId)));
	return flows;
}

// ── Aggregation: prefix tree → prune → list / sankey ──────────────────────
//
// ARB packs each step (event + segments + step_number + type, with time
// zeroed first — flows.cpp:230-232) into the prefix-tree node key
// (flows_prefix_tree_add_with_segments, flows.cpp:207-311). Counters:
// total_count on every node, converted_total_count on every node of a
// converted flow's path, drop_off_total_count on the LAST node of EVERY flow
// ("In the last step of this flow the user will drop off" — converted flows
// included). Pruning (flows_prefix_tree_trim, flows.cpp:1189-1320) sums
// total_count per (step_number level, node key) across the WHOLE tree
// (flows_prefix_tree_calculate_counts, flows.cpp:1167-1187 — anchors
// included), keeps the top cardinality_threshold keys per level (count desc,
// node_count_compare at flows.cpp:1329-1337; equal counts tie-break by hash
// order there — this emulator uses label-then-value ascending for
// determinism), and rebuilds: a node survives if its key is top OR its step
// type is ANCHOR (flows_prefix_node_merge_into_other, flows.cpp:1259-1260);
// otherwise it is renamed to $mp_uncommon_flows_events with segments CLEARED
// (flows_prefix_node_set_uncommon_event_step; UNCOMMON_FLOWS_EVENT at
// flows.hpp:14), same-key siblings merge counters
// (flows_prefix_node_merge_counts_from) and their children re-parent under
// the merged node (the trim stack pushes children with the merged
// new_parent).
//
// CAVEAT (fix-round C3): the product SANKEY view never displays
// $mp_uncommon_flows_events — the graph merge path prunes low-cardinality
// branches into a PRUNED node via a separate mechanism, so this bucket is a
// LIST-merge artifact. Top-N kept nodes/edges agree with the product; do NOT
// write dungeon assertions against the "Other"/uncommon bucket on sankey
// output.

/** The coalesced-step rename target (flows.hpp:14 UNCOMMON_FLOWS_EVENT). */
export const UNCOMMON_FLOWS_EVENT = '$mp_uncommon_flows_events';

// NUL separator keeps packed keys collision-free for multi-word event names;
// the SOH sentinel distinguishes "no segment" from a real empty-string value.
/** Codepoint-order compare - localeCompare ignores control chars. @param {string} a @param {string} b */
const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const KEY_SEP = '\u0000';
const NO_VALUE = '\u0001';

/** @param {{stepNumber: number, label: string, value?: string, isAnchor: boolean}} s */
const nodeKey = (s) => [s.stepNumber, s.isAnchor ? 'A' : 'E', s.label, s.value === undefined ? NO_VALUE : s.value].join(KEY_SEP);

/**
 * @typedef {Object} FlowTreeNode
 * @property {string} key
 * @property {number} stepNumber
 * @property {string} label
 * @property {string} [value]
 * @property {boolean} isAnchor
 * @property {number} total total_count
 * @property {number} converted converted_total_count (flows passing through that converted)
 * @property {number} dropoff drop_off_total_count (flows ENDING here — converted included)
 * @property {Map<string, FlowTreeNode>} children
 */

/**
 * Aggregate extracted flows into Mixpanel's Top Paths output.
 *
 * @param {Array<FlowRecord>} flows output of extractFlows
 * @param {Object} [options]
 * @param {'list'|'sankey'} [options.output='list']
 * @param {number} [options.cardinalityThreshold] per-level top-N before
 *   coalescing into $mp_uncommon_flows_events. Defaults follow the API layer:
 *   50 for the list view (`bookmark.get("maxResults", 50)`, bookmark.py:96),
 *   3 for sankey (`bookmark.get("cardinality", 3)`, bookmark.py:110).
 *   In LIST mode the same option is ARB's `cardinality_threshold`, which the
 *   merger reuses as the ROW cap (flows_merger.cpp:406-410) — 0 disables row
 *   truncation (the `> 0` guard there), but still empties the per-level keep
 *   sets (anchors survive on type).
 * @param {'end'|'start'} [options.listSortPriority='end'] list row ordering
 *   (`bookmark.get("list_sort_priority", "end")`, bookmark.py:95): 'end'
 *   sorts by the leaf's total_count, 'start' by the slot-0 step's
 *   total_count (flows_merger.cpp:392-404). List mode only.
 * @returns {Object} list → `{ paths, totalEntered, overallConversionRate,
 *   foundCount, returnedCount }` — ONE row per LEAF of the trimmed prefix
 *   tree (flows_merger.cpp:358-382), each `{ steps, count, converted }`
 *   where steps carry the full root→leaf path with per-step `count`
 *   (total_count, flows_merger.cpp:198), row `count` = the leaf's
 *   total_count (ended_total_count, :174), and `converted` = converted
 *   flows ending at the leaf (emulator bookkeeping — the ARB Flow proto
 *   carries no converted counter). Flows ending at INTERIOR nodes get no
 *   row of their own; they are visible only as per-step count
 *   differentials. `foundCount`/`returnedCount` mirror the response's
 *   found_count/returned_count (:420-421). sankey →
 *   `{ levels, edges, totalEntered, overallConversionRate }` where
 *   `levels[stepNumber]` holds coalesced nodes `{ label, value?, isAnchor,
 *   count, dropoff, converted }` sorted count-desc, and each edge is
 *   `{ fromLevel, from, toLevel, to, count }` with from/to INDICES into the
 *   sorted level arrays (edges may skip levels — capacity slots can be empty
 *   on a given path, so `toLevel` is explicit).
 */
export function aggregateFlows(flows, { output = 'list', cardinalityThreshold, listSortPriority = 'end' } = {}) {
	if (output !== 'list' && output !== 'sankey') {
		throw new Error(`aggregateFlows: output must be "list" or "sankey", got "${output}"`);
	}
	if (listSortPriority !== 'end' && listSortPriority !== 'start') {
		// "invalid result sort priority" (flows_merger.cpp:402-403)
		throw new Error(`aggregateFlows: listSortPriority must be "end" or "start", got "${listSortPriority}"`);
	}
	const threshold = cardinalityThreshold !== undefined
		? cardinalityThreshold
		: (output === 'sankey' ? 3 : 50); // bookmark.py:110 / :96
	if (!Number.isInteger(threshold) || threshold < 0) {
		throw new Error(`aggregateFlows: cardinalityThreshold must be a non-negative integer, got ${threshold}`);
	}

	const totalEntered = flows.length;
	const convertedFlows = flows.reduce((n, f) => n + (f.converted ? 1 : 0), 0);
	const overallConversionRate = totalEntered ? convertedFlows / totalEntered : 0;

	// Build the prefix tree (flows.cpp:207-311).
	/** @type {{children: Map<string, FlowTreeNode>}} */
	const root = { children: new Map() };
	for (const f of flows) {
		let cur = root;
		for (let i = 0; i < f.steps.length; i++) {
			const s = f.steps[i];
			const key = nodeKey(s);
			let node = cur.children.get(key);
			if (!node) {
				node = {
					key, stepNumber: s.stepNumber, label: s.label, value: s.value,
					isAnchor: s.isAnchor, total: 0, converted: 0, dropoff: 0,
					children: new Map(),
				};
				cur.children.set(key, node);
			}
			node.total += 1;
			if (f.converted) node.converted += 1;
			if (i === f.steps.length - 1) node.dropoff += 1;
			cur = node;
		}
	}

	// Per-level totals across the WHOLE tree (flows.cpp:1167-1187), then the
	// per-level keep set (top `threshold` by summed total_count).
	/** @type {Map<number, Map<string, {count: number, label: string, value: string}>>} */
	const levelCounts = new Map();
	(function tally(children) {
		for (const node of children.values()) {
			let lvl = levelCounts.get(node.stepNumber);
			if (!lvl) { lvl = new Map(); levelCounts.set(node.stepNumber, lvl); }
			const entry = lvl.get(node.key);
			if (entry) entry.count += node.total;
			else lvl.set(node.key, { count: node.total, label: node.label, value: node.value === undefined ? NO_VALUE : node.value });
			tally(node.children);
		}
	})(root.children);
	/** @type {Map<number, Set<string>>} */
	const keepSets = new Map();
	for (const [level, lvl] of levelCounts) {
		const ranked = [...lvl.entries()].sort((a, b) => b[1].count - a[1].count
			|| (a[1].label < b[1].label ? -1 : a[1].label > b[1].label ? 1 : 0)
			|| (a[1].value < b[1].value ? -1 : a[1].value > b[1].value ? 1 : 0));
		keepSets.set(level, new Set(ranked.slice(0, threshold).map(([k]) => k)));
	}

	/** @param {FlowTreeNode} dst @param {FlowTreeNode} src */
	const mergeNode = (dst, src) => {
		// flows_prefix_node_merge_counts_from + child re-parenting
		dst.total += src.total;
		dst.converted += src.converted;
		dst.dropoff += src.dropoff;
		for (const child of src.children.values()) {
			const existing = dst.children.get(child.key);
			if (existing) mergeNode(existing, child);
			else dst.children.set(child.key, child);
		}
	};

	/**
	 * Bottom-up rebuild — equivalent to ARB's top-down stack because the keep
	 * sets are computed on the PRE-trim tree and merging only sums counters.
	 * @param {Map<string, FlowTreeNode>} children
	 * @returns {Map<string, FlowTreeNode>}
	 */
	const trim = (children) => {
		/** @type {Map<string, FlowTreeNode>} */
		const out = new Map();
		for (const node of children.values()) {
			node.children = trim(node.children);
			let target = node;
			if (!node.isAnchor && !(keepSets.get(node.stepNumber) || new Set()).has(node.key)) {
				target = {
					...node,
					label: UNCOMMON_FLOWS_EVENT,
					value: undefined, // segments cleared (flows_prefix_node_set_uncommon_event_step)
					key: nodeKey({ stepNumber: node.stepNumber, label: UNCOMMON_FLOWS_EVENT, isAnchor: false }),
				};
			}
			const existing = out.get(target.key);
			if (existing) mergeNode(existing, target);
			else out.set(target.key, target);
		}
		return out;
	};
	const trimmed = trim(root.children);

	/** @param {FlowTreeNode} node */
	const stepOut = (node) => {
		/** @type {Object} */ const s = { label: node.label, stepNumber: node.stepNumber, isAnchor: node.isAnchor };
		if (node.value !== undefined) s.value = node.value;
		return s;
	};

	if (output === 'list') {
		// One row per LEAF of the trimmed tree: the merger DFSes the tree and
		// builds a flow only at `children == nullptr && parent != nullptr`
		// (flows_merger.cpp:358-382, leaf test :362). Each row carries the
		// full root→leaf path with every step's total_count (:198); the row
		// count is the leaf's total_count (ended_total_count, :174) — a leaf
		// has no children, so every flow reaching it ended there and leaf
		// total == leaf dropoff by tree construction (the same holds after
		// uncommon-merging: a trimmed leaf only absorbs other leaves, so
		// `converted` ≡ converted flows ending at the leaf). ARB pads every
		// row to the query's full slot capacity with EMPTY steps
		// (flows_merger.cpp:171, :185-189); the emulator omits the
		// placeholders — slot gaps stay visible through each step's
		// stepNumber.
		/** @type {Array<{steps: Array<Object>, count: number, converted: number}>} */
		const rows = [];
		(function walk(children, prefix) {
			for (const node of children.values()) {
				const steps = [...prefix, { ...stepOut(node), count: node.total }];
				if (node.children.size === 0) {
					rows.push({ steps, count: node.total, converted: node.converted });
				}
				walk(node.children, steps);
			}
		})(trimmed, []);
		// started_total_count is only assigned when a REAL node occupies slot
		// 0 (flows_merger.cpp:249-250) — a path whose shallowest node sits at
		// a deeper slot sorts as 0 under 'start'.
		/** @param {{steps: Array<*>}} r */
		const startedOf = (r) => (r.steps[0].stepNumber === 0 ? r.steps[0].count : 0);
		/** @param {{steps: Array<*>}} r */
		const pathKey = (r) => r.steps.map((s) => s.label + KEY_SEP + (s.value ?? NO_VALUE)).join(KEY_SEP);
		// DL_SORT ties keep DFS/hash insertion order in ARB
		// (flows_merger.cpp:392-404); the emulator tie-breaks on the joined
		// (label, value) path ascending for determinism.
		rows.sort((a, b) => (listSortPriority === 'start'
			? startedOf(b) - startedOf(a)
			: b.count - a.count)
			|| cmpStr(pathKey(a), pathKey(b)));
		// cardinality_threshold doubles as the row cap in list mode
		// (maxResults, bookmark.py:96); 0 disables truncation — the merger
		// only truncates when the threshold is > 0 (flows_merger.cpp:406-410).
		const foundCount = rows.length;
		const paths = threshold > 0 && rows.length > threshold ? rows.slice(0, threshold) : rows;
		return { paths, totalEntered, overallConversionRate, foundCount, returnedCount: paths.length };
	}

	// sankey: coalesce nodes per (level, label, value, type) across branches;
	// outgoing edges come from the coalescing children (finalize_level,
	// flows.cpp:1818+); a node's terminations are its dropoff
	// (total − Σ outgoing = drop_off_total_count by tree construction).
	/** @type {Map<string, {node: Object, level: number}>} */
	const coalesced = new Map();
	/** @type {Map<string, {fromKey: string, toKey: string, count: number}>} */
	const edgeMap = new Map();
	(function walk(children, parentKey) {
		for (const node of children.values()) {
			let c = coalesced.get(node.key);
			if (!c) {
				const obj = { label: node.label, isAnchor: node.isAnchor, count: 0, dropoff: 0, converted: 0 };
				if (node.value !== undefined) /** @type {*} */ (obj).value = node.value;
				c = { node: obj, level: node.stepNumber };
				coalesced.set(node.key, c);
			}
			/** @type {*} */ (c.node).count += node.total;
			/** @type {*} */ (c.node).dropoff += node.dropoff;
			/** @type {*} */ (c.node).converted += node.converted;
			if (parentKey !== null) {
				const ek = parentKey.length + ':' + parentKey + node.key; // length-prefix: collision-free join
				const e = edgeMap.get(ek);
				if (e) e.count += node.total;
				else edgeMap.set(ek, { fromKey: parentKey, toKey: node.key, count: node.total });
			}
			walk(node.children, node.key);
		}
	})(trimmed, null);

	const maxLevel = Math.max(-1, ...[...coalesced.values()].map(c => c.level));
	/** @type {Array<Array<Object>>} */
	const levels = Array.from({ length: maxLevel + 1 }, () => []);
	/** @type {Map<string, {level: number, index: number}>} */
	const position = new Map();
	for (const [key, { node, level }] of coalesced) levels[level].push({ key, node });
	for (let i = 0; i <= maxLevel; i++) {
		levels[i].sort((a, b) => /** @type {*} */ (b).node.count - /** @type {*} */ (a).node.count
			|| cmpStr(String(/** @type {*} */ (a).node.label), String(/** @type {*} */ (b).node.label))
			|| cmpStr(String(/** @type {*} */ (a).node.value ?? ""), String(/** @type {*} */ (b).node.value ?? "")));
		levels[i].forEach((entry, index) => position.set(/** @type {*} */ (entry).key, { level: i, index }));
		levels[i] = levels[i].map(entry => /** @type {*} */ (entry).node);
	}
	const edges = [...edgeMap.values()].map(({ fromKey, toKey, count }) => {
		const from = /** @type {{level: number, index: number}} */ (position.get(fromKey));
		const to = /** @type {{level: number, index: number}} */ (position.get(toKey));
		return { fromLevel: from.level, from: from.index, toLevel: to.level, to: to.index, count };
	});
	edges.sort((a, b) => a.fromLevel - b.fromLevel || a.from - b.from || a.toLevel - b.toLevel || a.to - b.to);
	return { levels, edges, totalEntered, overallConversionRate };
}
