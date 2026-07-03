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
 *   not dense. Under the defaults — alignment LEFT (flows_query.cpp:664-668
 *   fallback loop) and anchor_position FUNNEL (request_params.proto:58,
 *   FUNNEL = 0 is the proto enum default) — anchor i sits at the fixed slot
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
		|| String(a.userId).localeCompare(String(b.userId)));
	return flows;
}
