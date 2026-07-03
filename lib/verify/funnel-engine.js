/**
 * Greedy single-pass funnel state machine matching Mixpanel's behavior, plus
 * v1.5.0 extensions: reentry, exclusion steps, HPC (hold property constant),
 * step-level property filters, step property tracking, segment modes,
 * simultaneous histories (totals mode), and session-scoped evaluation.
 *
 * Mixpanel processes funnel events in chronological order, single pass, with
 * no backtracking. Each event is greedily assigned to the first eligible
 * funnel step. This is a streaming optimization for processing billions of
 * events; it differs from a SQL-style "find best combination" search.
 *
 * Reference: `mixpanel/analytics`
 *   - Greedy single-pass: backend/arb/reader/funnels/history.cpp
 *   - 2s grace + conversion window: history.cpp + conversion_window.cpp
 *   - Reentry: history.cpp `last_step_starts_next_funnel`
 *   - Exclusion: backend/arb/reader/queries/funnel_query.cpp
 *   - HPC: funnel_query.cpp lines 749-784 `aggregate_hash_get_key_cursor`
 *   - Step properties: history.cpp `property_set_buffer`
 *   - Segment modes: backend/arb/reader/options.hpp `funnel_segment_mode`
 *   - Totals vs uniques: funnel_query.cpp
 *
 * Documented edge case (history.cpp ~line 456): For funnel `[A, B, B]` with
 * event stream `[B, B, A]` all within 2 seconds, the engine does NOT
 * attribute the second B to step 2.
 *
 * NOT implemented:
 *   - Aggressive/optimized reentry (`enable_early_reentry`)
 *   - Selector expressions beyond eq/neq/gt/lt/gte/lte/contains/not_contains
 *
 * @typedef {Object} StepFilter
 * @property {string} prop
 * @property {'eq'|'neq'|'gt'|'lt'|'gte'|'lte'|'contains'|'not_contains'} op
 * @property {*} value
 *
 * @typedef {string | { event: string, where?: StepFilter } | AnyOrderBlock} FunnelStep
 *
 * @typedef {Object} AnyOrderBlock
 * @property {Array<string | { event: string, where?: StepFilter }>} anyOrder -
 *   v1.6.0 (P1.6.6): a contiguous block of steps the user may complete in ANY
 *   internal order, mixed freely with ordered "anchor" steps. Mixpanel's
 *   any-order is an anchor/chunk greedy pass, not a permutation search
 *   (history.cpp:490-519 advance, :538-589 cascade, :926-963
 *   can_record_any_order_step):
 *     - Anchor steps sit at fixed positions; a chunk of N any-order steps
 *       between two anchors fills its N positions in event-arrival order.
 *     - Within the ACTIVE chunk, the FIRST eligible match per step wins — no
 *       latest-match overwrite (history.cpp:951-957).
 *     - Steps in chunks past a not-yet-seen anchor buffer the LATEST match
 *       (:958-962), credited when the anchor is crossed — and only if the
 *       buffered time comes after the anchor per the 2-second rule.
 *     - The cascade advances through anchors and fully-satisfied chunks in
 *       one pass; a partially-satisfied chunk claims its present members and
 *       stops (:559-587).
 *   Blocks cannot nest and must not be empty.
 *
 * @typedef {Object} ExclusionStep
 * @property {string} event - Event name that terminates the attempt when it
 *   fires in a qualifying gap. ARB semantics (history.cpp
 *   history_record_exclusion_step + funnel_query_is_step_terminated):
 *   exclusions live in the GAPS between consecutive steps — one slot per gap
 *   g = (step g, step g+1). They can never terminate an attempt before step 0
 *   or more than 2s after completion, must fall within the conversion window
 *   from step 0, and ties within the 2-second grace are resolved AGAINST the
 *   user (anti-conversion bias). Termination keeps `reached` (clamping it
 *   back to the killed gap when a buffered exclusion fires late) and freezes
 *   the attempt — no restart from the exclusion event.
 * @property {number} [afterStep] - First gap index this exclusion applies to.
 *   Default 0. `{ afterStep: 1, beforeStep: 2 }` = "between step 1 and step 2" only.
 * @property {number} [beforeStep] - Exclusive upper bound on applicable gap
 *   indexes. Default `steps.length` (every gap).
 *
 * @typedef {Object} SessionConversionWindow
 * @property {'sessions'} unit - Only 'sessions' is supported here; time-based
 *   windows use `conversionWindowMs`.
 * @property {number} n - Session count, 1–12. `n = 1` means "same session";
 *   `n = 2` means "same or next session". Mixpanel's API caps session windows
 *   at 12 (`_MAX_LENGTHS["session"]`, api/version_2_0/arb_funnels/validate.py).
 *
 * @typedef {Object} FunnelOptions
 * @property {number} [conversionWindowMs] - Max time from step 0 to last
 *   step (strict `<`). Omit for no window check.
 * @property {SessionConversionWindow} [conversionWindow] - Session-count
 *   conversion window (Mixpanel funnel "conversion window: N sessions").
 *   Mutually exclusive with `conversionWindowMs`. Semantics
 *   (conversion_window.cpp WINDOW_TYPE_SESSIONS + funnel_query.cpp session_id
 *   plumbing): each event gets a per-user session ordinal (count of session
 *   ENDS before it, seeded 0 — see `sessionOrdinals`); a step passes iff
 *   `ordinal(step) < ordinal(step0) + n` AND `t_step < t_step0 + n × 1 day`
 *   (a "session unit" is one day wide — seconds_per_unit[QUERY_UNIT_SESSION]
 *   = SECONDS_PER_DAY, libquery/time/unit.c).
 * @property {boolean} [graceperiod=true] - Enable the 2-second grace window
 *   on ordering checks. Disable only for tests that need strict ordering.
 * @property {boolean} [reentry=false] - When true, after completing all steps,
 *   reset to step 0 and continue scanning. Increments `completions`.
 * @property {ExclusionStep[]} [exclusionSteps] - Exclusion events that
 *   terminate the current attempt when fired between specified steps.
 * @property {boolean | string[]} [trackStepProperties=false] - When truthy,
 *   `result.stepProperties[i]` contains the matched event's properties at
 *   each step. Pass an array to filter to specific property names.
 * @property {'uniques'|'totals'|'sessions'} [countMode='uniques'] - `'totals'` returns an
 *   ARRAY of FunnelResult — one per attempt (Mixpanel funnel_query.cpp:2055-2100).
 *   Includes incomplete attempts (drop-offs contribute to per-step counts).
 *   Without `reentry: true`, the array has at most one entry (the single attempt).
 *   `'sessions'` is Mixpanel's "count by Sessions" — a documented API-rewrite
 *   preset, NOT an engine mode: expands to exactly `countMode: 'totals'` +
 *   re-entry disabled (the `general_wo_repeat` rewrite — no restart after a
 *   completed pass) + `conversionWindow: { unit: 'sessions', n: 1 }`
 *   (__validate_sessions in api/version_2_0/arb_funnels/validate.py). Throws
 *   if combined with `reentry: true` or any other conversion window.
 * @property {boolean} [sessionScoped=false] - **@deprecated — verifier-only, NOT
 *   Mixpanel-comparable.** Partitions events by generator-stamped `session_id` and runs
 *   the matcher independently per session, returning the best result (or all results
 *   when `countMode: 'totals'`). Mixpanel does NOT partition funnels per session — it
 *   bounds them by session COUNT via `WINDOW_TYPE_SESSIONS` on the conversion window
 *   (`conversion_window.cpp:9-13`). Use `conversionWindow: { unit: 'sessions', n }`
 *   for Mixpanel-comparable results; results from `sessionScoped: true` are NOT
 *   reproducible in the Mixpanel UI.
 * @property {{fromMs?: number, toMs?: number}} [anchorRange] - v1.6.0 (P1.6.5):
 *   step-0 anchor bounds for trend intervals. Mixpanel funnel trends evaluate
 *   each interval as "step 0 in [start, stop); steps 1+ in
 *   [start, stop + conversion window)" (funnel_query.cpp:1398-1401 — the
 *   query scans the extended range but only anchors histories whose step-0
 *   event falls inside the interval proper). Events outside
 *   `[fromMs, toMs)` cannot record step 0 (a new attempt can never anchor
 *   there, including under `reentry`); they remain eligible for steps 1+,
 *   exclusion gaps, and session-ordinal derivation. Callers are expected to
 *   pre-slice the stream to [fromMs, toMs + window) — the engine only
 *   enforces the anchor bound.
 *
 * @typedef {Object} FunnelResult
 * @property {boolean} completed - Reached every step.
 * @property {number} reached - Highest step index reached (0-based). `-1` if no steps reached.
 * @property {Array<Object|null>} stepEvents - The event assigned to each reached step.
 * @property {Array<number|null>} stepTimes - Timestamp (ms) of each reached step.
 * @property {number|null} ttcMs - Time-to-convert: stepTimes[last] - stepTimes[0]. `null` if not completed.
 * @property {number} completions - Total completions (1 if no reentry; 0 if not completed).
 * @property {Array<Object>|undefined} stepProperties - Per-step property snapshots when `trackStepProperties` set.
 * @property {string|undefined} sessionId - Set when result came from a session-scoped slice.
 * @property {boolean} terminatedByExclusion - Attempt was DISQUALIFIED by an
 *   exclusion event. `reached` is kept (possibly clamped back to the killed
 *   gap): the user still counts at steps 0..reached AND in the excluded
 *   bucket at step reached+1 (funnel_query.cpp `fr->excluded[reached + 1]`).
 * @property {number|null} excludedAtStep - `reached + 1` when terminated by
 *   exclusion — the index ARB's `excluded[]` aggregation uses — else null.
 */

import { toMs } from '../hook-helpers/_internal.js';
import { sessionOrdinals } from './sessionize.js';

const OUT_OF_ORDER_MS = 2000;
const DAY_MS = 86400 * 1000;

/**
 * Returns true if `t1` is "after" `t2` by Mixpanel's funnel rules.
 * Matches `timestamp_comes_after()` in history.cpp.
 *
 * @param {number} t1
 * @param {number} t2
 * @param {boolean} [graceperiod=true]
 * @returns {boolean}
 */
export function timestampComesAfter(t1, t2, graceperiod = true) {
	if (!(t1 > 0)) return false;
	if (t1 >= t2) return true;
	if (graceperiod && t1 + OUT_OF_ORDER_MS >= t2) return true;
	return false;
}

/**
 * Returns true if `eventTime` is within `windowMs` of `step0Time`. Matches
 * `is_within_conversion_window()` (strict `<`).
 *
 * @param {number} eventTime
 * @param {number} step0Time
 * @param {number|undefined} windowMs
 * @returns {boolean}
 */
export function withinConversionWindow(eventTime, step0Time, windowMs) {
	if (typeof windowMs !== 'number' || windowMs <= 0) return true;
	return eventTime < step0Time + windowMs;
}

/**
 * Normalize a funnel step (string OR `{ event, where? }`) into the canonical
 * `{ event, where }` shape. AnyOrder blocks are NOT accepted here — flatten
 * them with `normalizeFunnelSteps` first.
 *
 * @param {string | { event: string, where?: StepFilter }} step
 * @returns {{ event: string, where?: StepFilter }}
 */
export function normalizeStep(step) {
	if (typeof step === 'string') return { event: step };
	if (step && typeof step === 'object' && typeof step.event === 'string') {
		return step.where ? { event: step.event, where: step.where } : { event: step.event };
	}
	throw new Error(`normalizeStep: invalid step ${JSON.stringify(step)}`);
}

/**
 * v1.6.0 (P1.6.6): flatten a step list that may contain `{ anyOrder: [...] }`
 * blocks into per-slot arrays plus the anchor topology ARB precomputes per
 * history (history.cpp:214-228): `prevAnchor[i]` = nearest anchor slot ≤ i
 * (−1 if none), `nextAnchor[i]` = nearest anchor slot > i (numSteps if none).
 *
 * @param {FunnelStep[]} steps
 * @returns {{
 *   flat: Array<{ event: string, where?: StepFilter }>,
 *   isAnyOrder: boolean[],
 *   prevAnchor: number[],
 *   nextAnchor: number[],
 *   hasAnyOrder: boolean,
 * }}
 */
export function normalizeFunnelSteps(steps) {
	const flat = [];
	const isAnyOrder = [];
	for (const s of steps) {
		if (s && typeof s === 'object' && 'anyOrder' in s) {
			const block = /** @type {AnyOrderBlock} */ (s).anyOrder;
			if (!Array.isArray(block) || !block.length) {
				throw new Error('normalizeFunnelSteps: anyOrder block must be a non-empty array');
			}
			for (const inner of block) {
				if (inner && typeof inner === 'object' && 'anyOrder' in inner) {
					throw new Error('normalizeFunnelSteps: anyOrder blocks cannot nest');
				}
				flat.push(normalizeStep(inner));
				isAnyOrder.push(true);
			}
		} else {
			flat.push(normalizeStep(/** @type {string | { event: string, where?: StepFilter }} */ (s)));
			isAnyOrder.push(false);
		}
	}
	const n = flat.length;
	const prevAnchor = new Array(n);
	const nextAnchor = new Array(n);
	// Single loop walking both directions — history.cpp:214-228.
	let prev = -1;
	let next = n;
	for (let i = 0; i < n; i++) {
		if (!isAnyOrder[i]) prev = i;
		prevAnchor[i] = prev;
		const rev = n - 1 - i;
		nextAnchor[rev] = next;
		if (!isAnyOrder[rev]) next = rev;
	}
	return { flat, isAnyOrder, prevAnchor, nextAnchor, hasAnyOrder: isAnyOrder.includes(true) };
}

/**
 * Apply a step filter against a candidate event's flat property map.
 * Supports eq / neq / gt / lt / gte / lte / contains / not_contains.
 *
 * @param {Object} ev
 * @param {StepFilter | undefined} where
 * @returns {boolean}
 */
export function matchesStepFilter(ev, where) {
	if (!where || !where.prop) return true;
	const v = ev ? ev[where.prop] : undefined;
	const target = where.value;
	switch (where.op) {
		case 'eq':           return v === target;
		case 'neq':          return v !== target;
		case 'gt':           return typeof v === 'number' && v > target;
		case 'lt':           return typeof v === 'number' && v < target;
		case 'gte':          return typeof v === 'number' && v >= target;
		case 'lte':          return typeof v === 'number' && v <= target;
		case 'contains':     return typeof v === 'string' && v.includes(String(target));
		case 'not_contains': return !(typeof v === 'string' && v.includes(String(target)));
		default: throw new Error(`matchesStepFilter: unsupported op "${where.op}"`);
	}
}

/**
 * Test whether an event qualifies for a (normalized) step.
 *
 * @param {Object} ev
 * @param {{ event: string, where?: StepFilter }} step
 * @returns {boolean}
 */
function eventMatchesStep(ev, step) {
	return ev.event === step.event && matchesStepFilter(ev, step.where);
}

/**
 * Snapshot of an event's properties for `stepProperties` tracking.
 *
 * @param {Object} ev
 * @param {boolean | string[]} mode
 * @returns {Object}
 */
function snapshotProperties(ev, mode) {
	if (!ev) return {};
	if (mode === true) {
		const { event: _e, time: _t, user_id: _u, distinct_id: _d, device_id: _v, session_id: _s, ...rest } = ev;
		return rest;
	}
	if (Array.isArray(mode)) {
		const out = {};
		for (const k of mode) if (k in ev) out[k] = ev[k];
		return out;
	}
	return {};
}

/**
 * Build an empty FunnelResult for failed attempts.
 *
 * @param {boolean | string[]} [trackStepProperties]
 * @returns {FunnelResult}
 */
function emptyResult(trackStepProperties) {
	const r = { completed: false, reached: -1, stepEvents: [], stepTimes: [], ttcMs: null, completions: 0, stepProperties: undefined, sessionId: undefined, terminatedByExclusion: false, excludedAtStep: null };
	if (trackStepProperties) r.stepProperties = [];
	return r;
}

/**
 * Run one greedy single-pass funnel attempt over a pre-sorted event list.
 * Internal helper used by `evaluateFunnel` for both basic and reentry modes.
 *
 * @param {Array<Object>} sorted - Pre-sorted-by-time events.
 * @param {number} startIdx - Index to begin scanning from.
 * @param {{ event: string, where?: StepFilter }[]} steps
 * @param {ExclusionStep[]} exclusionSteps
 * @param {Object} options
 * @returns {{ result: FunnelResult, nextIdx: number, terminatedByExclusion: boolean }}
 */
function runOneAttempt(sorted, startIdx, steps, exclusionSteps, options) {
	const { windowCheck, graceperiod, trackStepProperties, anchorOk, isAnyOrder, prevAnchor, nextAnchor } = options;
	const numSteps = steps.length;
	// Per-SLOT recorded candidates (history->steps): the latest match for
	// anchors, the first eligible match for active any-order chunk members.
	const slotTimes = new Array(numSteps).fill(0);
	const slotEvents = new Array(numSteps).fill(null);
	const slotProps = trackStepProperties ? new Array(numSteps).fill(null) : null;
	// Per-POSITION path (history->step_loc_idx): which slot filled position p.
	// Anchor slots always land at position === slot; an any-order chunk fills
	// its slot range in event-arrival order (history.cpp:929-945). For
	// anchor-only funnels positions and slots coincide throughout.
	const stepLocIdx = new Array(numSteps).fill(-1);
	// history_get_time_at_step (history.cpp:839-841) — 0 when unfilled.
	const timeAtPos = (p) => stepLocIdx[p] === -1 ? 0 : slotTimes[stepLocIdx[p]];
	const eventAtPos = (p) => stepLocIdx[p] === -1 ? null : slotEvents[stepLocIdx[p]];

	// Exclusion state — one slot per GAP g between step g and step g+1
	// (`history->exclusion_steps[]`). ARB: "Exclusion steps can only exist
	// between first and last step (and not before or after the funnel)"
	// (funnel_query_is_step_terminated, history.cpp) — so an exclusion can
	// never terminate an attempt that hasn't reached step 0, and there are
	// no gaps at all for a single-step funnel.
	const hasExclusions = !!(exclusionSteps && exclusionSteps.length && numSteps > 1);
	const excTimes = hasExclusions ? new Array(numSteps - 1).fill(0) : null;
	const excEvents = hasExclusions ? new Array(numSteps - 1).fill(null) : null;

	let reached = -1;
	let terminatedByExclusion = false;
	let tailAnchorMs = 0; // terminating exclusion time, or last-step time on completion
	let endIdx = -1;      // consumption boundary — frozen the moment the attempt is decided
	let i = startIdx;

	// Does exclusion `ex` apply to gap g? afterStep/beforeStep bound the
	// applicable gap range [afterStep, beforeStep); default = every gap.
	const gapApplies = (ex, g) => {
		const after = typeof ex.afterStep === 'number' ? ex.afterStep : 0;
		const before = typeof ex.beforeStep === 'number' ? ex.beforeStep : numSteps;
		return g >= after && g < before;
	};
	const excludesAtGap = (ev, g) => {
		for (const ex of exclusionSteps) {
			if (ev.event === ex.event && gapApplies(ex, g)) return true;
		}
		return false;
	};
	// funnel_query_is_step_terminated (history.cpp): the exclusion recorded in
	// gap g kills the attempt iff it is (a) within the conversion window from
	// step 0, (b) at/after step g per the 2-second rule — the grace that
	// forgives step ordering CONDEMNS exclusion ties ("we assume they were
	// ordered in such a way as to prevent the conversion") — and (c) still in
	// the open gap: the user sits exactly at step g, or reached is past it and
	// step g+1 does not come more than 2s before the exclusion. Gaps sit
	// between POSITIONS (history_get_time_at_step reads through step_loc_idx),
	// so with any-order blocks the gap bounds are the claimed positions'
	// times, not the slot-declaration order.
	const gapTerminates = (g) => {
		if (reached < 0 || g < 0 || g >= numSteps - 1) return false;
		const et = excTimes[g];
		if (!et) return false;
		if (!windowCheck(et, timeAtPos(0), excEvents[g], eventAtPos(0))) return false;
		if (!timestampComesAfter(et, timeAtPos(g), graceperiod)) return false;
		return reached === g
			|| (reached > g && timestampComesAfter(timeAtPos(g + 1), et, graceperiod));
	};
	// history_record_exclusion_step (history.cpp): record the event into gap
	// g, unless reached is past the gap and the event falls more than 2s
	// after position g+1 — the gap closed cleanly, and the event "may be
	// useful for a future exclusion step". Returns true when the event was
	// consumed. Callers interleave this per gap index with positive-step
	// records (funnel_query.cpp:1307-1385 — positive step g before exclusion
	// gap g; first use consumes the event).
	const tryExclusionAtGap = (g, ev, t) => {
		if (!excludesAtGap(ev, g)) return false;
		if (reached > g && !timestampComesAfter(timeAtPos(g + 1), t, graceperiod)) return false;
		excTimes[g] = t;
		excEvents[g] = ev;
		if (gapTerminates(g)) {
			terminatedByExclusion = true;
			reached = g; // DISQUALIFY-and-freeze: clamp back to the killed gap
			tailAnchorMs = t;
		}
		return true;
	};

	// can_record_any_order_step (history.cpp:926-963). Assumes slot s is an
	// any-order step.
	const prevAnchorTimeMs = () => {
		// previous_anchor_time_ms (history.cpp:967-970): time at the last
		// anchor POSITION at/below reached; 0 when the active chunk has no
		// anchor below it. Anchors always claim position === slot, and a
		// chunk's position range equals its slot range, so indexing the
		// slot-built topology by the position `reached` is exact.
		const pa = prevAnchor[reached];
		return pa >= 0 ? timeAtPos(pa) : 0;
	};
	const canRecordAnyOrderSlot = (s, t) => {
		if (reached >= 0 && s < prevAnchor[reached]) {
			// Chunk already sealed behind a crossed anchor.
			return false;
		}
		if (reached >= 0 && s < nextAnchor[reached]) {
			// Active chunk: FIRST eligible match wins — no latest overwrite
			// (history.cpp:951-957).
			const eligible = slotTimes[s] !== 0
				&& timestampComesAfter(slotTimes[s], prevAnchorTimeMs(), graceperiod);
			return !eligible && timestampComesAfter(t, prevAnchorTimeMs(), graceperiod);
		}
		// Chunk past a not-yet-seen anchor: always buffer the latest
		// (history.cpp:958-962).
		return true;
	};

	// history_record_step (history.cpp:413-628): record the slot, maybe
	// advance the position pointer, then cascade. Returns true (consumed).
	const recordSlot = (s, ev, t, i) => {
		slotTimes[s] = t;
		slotEvents[s] = ev;
		if (slotProps) slotProps[s] = snapshotProperties(ev, trackStepProperties);

		let canAdvanceStep = false;
		if (isAnyOrder[s]) {
			// Direct advance (history.cpp:490-519): an any-order record claims
			// the next position when it lands in the OPEN chunk — the first
			// chunk before anything anchored, or the active chunk within the
			// conversion window from position 0.
			if ((reached === -1 && isAnyOrder[0] && s < nextAnchor[0])
				|| (reached >= 0 && s < nextAnchor[reached]
					&& windowCheck(slotTimes[s], timeAtPos(0), slotEvents[s], eventAtPos(0)))
			) {
				reached++;
				stepLocIdx[reached] = s;
				// Cascade only once the chunk is closed: this record filled the
				// funnel's last position, or the next position is an anchor
				// (history.cpp:509-517 — earlier chunk members already advanced
				// the funnel when they recorded).
				canAdvanceStep = reached + 1 === numSteps || !isAnyOrder[reached + 1];
			}
		} else if (s > 0 && reached !== s - 1) {
			// Future anchor: latest recorded, no advance (history.cpp:519-523).
		} else {
			canAdvanceStep = true;
		}

		// ARB captures original_reached AFTER the direct advance (:525) — the
		// exclusion second pass starts at the just-claimed position's gap.
		const originalReached = reached;

		if (canAdvanceStep) {
			// Cascade (history.cpp:534-589): claim anchors one at a time; claim
			// an any-order chunk's present members in slot order against the
			// PRE-CHUNK time (members need not order among themselves), and
			// cross to the next anchor only when the chunk fully filled. A
			// partially-filled chunk claims its present members and stops.
			let reachedTimeMs = reached >= 0 ? timeAtPos(reached) : 0;
			let ns = originalReached + 1;
			while (ns < numSteps) {
				if (!isAnyOrder[ns]) {
					if (timestampComesAfter(slotTimes[ns], reachedTimeMs, graceperiod)
						&& (ns === 0 || windowCheck(slotTimes[ns], timeAtPos(0), slotEvents[ns], eventAtPos(0)))
					) {
						reached++;
						stepLocIdx[reached] = ns; // anchors: position === slot
						reachedTimeMs = slotTimes[ns];
						ns++;
					} else {
						break;
					}
				} else {
					const na = nextAnchor[ns];
					let missing = false;
					let latestTimeMs = reachedTimeMs;
					for (; ns < na; ns++) {
						if (timestampComesAfter(slotTimes[ns], reachedTimeMs, graceperiod)
							&& windowCheck(slotTimes[ns], timeAtPos(0), slotEvents[ns], eventAtPos(0))
						) {
							reached++;
							stepLocIdx[reached] = ns;
							if (timestampComesAfter(slotTimes[ns], latestTimeMs, graceperiod)) {
								latestTimeMs = slotTimes[ns];
							}
						} else {
							missing = true;
						}
					}
					if (!missing) {
						reachedTimeMs = latestTimeMs;
					} else {
						break;
					}
				}
			}
		}

		// Buffered-exclusion second pass over [originalReached, reached]
		// (history.cpp:608-618 "Second pass: Check if early termination funnel
		// based on -ve steps are possible"): an exclusion recorded BEFORE its
		// gap opened can retroactively kill steps the cascade just claimed.
		// `reached` is clamped back to the killed gap.
		if (hasExclusions) {
			for (let r = originalReached; r <= reached; r++) {
				if (gapTerminates(r)) {
					terminatedByExclusion = true;
					reached = r;
					tailAnchorMs = excTimes[r];
					endIdx = i + 1;
					break;
				}
			}
		}

		if (reached === numSteps - 1 && !terminatedByExclusion) {
			tailAnchorMs = timeAtPos(numSteps - 1);
			endIdx = i + 1;
			// No break — the 2s tail may still kill the completion.
		}
		return true;
	};

	for (; i < sorted.length; i++) {
		const ev = sorted[i];
		const t = toMs(ev.time);
		if (!Number.isFinite(t)) continue;

		if (terminatedByExclusion || reached === numSteps - 1) {
			// Attempt decided. Keep scanning ONLY the 2-second out-of-order
			// tail, and only for exclusions that terminate (even) earlier —
			// funnel_query.cpp: "If terminated (for any reason) or reached the
			// last step AND current event_time is further than 2 seconds from
			// the termination step time or last step time, do not do this
			// processing." (Positive slots refuse the event on their own:
			// anchors need reached < slot; claimed any-order chunk members are
			// first-match-sealed — so exclusions-only here matches ARB.)
			if (endIdx < 0) endIdx = i;
			if (!hasExclusions || !graceperiod || t > tailAnchorMs + OUT_OF_ORDER_MS) break;
			for (let g = 0; g < numSteps - 1; g++) {
				if (tryExclusionAtGap(g, ev, t)) break;
			}
			continue;
		}

		// v1.6.0 (P1.6.5): trend-interval anchor — an event outside
		// [fromMs, toMs) can never record step 0. ARB drops ALL positive
		// records for out-of-range events while the funnel is unstarted
		// (history.cpp:436-440 `is_outside_first_event_range && reached < 0`);
		// exclusion gaps still see the event (funnel_query.cpp:1360-1362 runs
		// whenever the positive step didn't consume it). Once reached >= 0,
		// no record can move position 0 (anchors need reached < slot; the
		// position-0 chunk member is first-match-sealed), so no gate is
		// needed there.
		const positiveBlocked = reached === -1 && anchorOk && !anchorOk(t);

		// Interleaved per-index scan (funnel_query.cpp:1307-1385): positive
		// slot g is checked before exclusion gap g, which is checked before
		// slot g+1; the first use consumes the event. Anchors record the
		// latest match while unclaimed (reached < slot — positions and slots
		// coincide for anchors); any-order slots go through
		// can_record_any_order_step. A slot BELOW the current position can
		// still record when it's an unfilled active-chunk member, so the scan
		// starts at 0 (for anchor-only funnels this degenerates to the old
		// reached+1 start).
		for (let s = 0; s < numSteps; s++) {
			if (!positiveBlocked && eventMatchesStep(ev, steps[s])) {
				const recordable = isAnyOrder[s]
					? canRecordAnyOrderSlot(s, t)
					: reached < s;
				if (recordable && recordSlot(s, ev, t, i)) break;
			}
			if (hasExclusions && s < numSteps - 1 && tryExclusionAtGap(s, ev, t)) {
				if (terminatedByExclusion) endIdx = i + 1; // no restart FROM the exclusion event
				break;
			}
		}
	}

	// Result surfaces the PATH (positions), not the slot table: position p was
	// filled by slot stepLocIdx[p] (history_get_time_at_step reads through the
	// same indirection). Anchor-only funnels: identity mapping.
	const reachedStepEvents = [];
	const reachedStepTimes = [];
	for (let p = 0; p <= reached; p++) {
		reachedStepEvents.push(eventAtPos(p));
		reachedStepTimes.push(timeAtPos(p));
	}
	const completed = reached === numSteps - 1;
	const ttcMs = completed && reachedStepTimes.length > 1
		? reachedStepTimes[reachedStepTimes.length - 1] - reachedStepTimes[0]
		: null;
	const result = {
		completed,
		reached,
		stepEvents: reachedStepEvents,
		stepTimes: reachedStepTimes,
		ttcMs,
		completions: completed ? 1 : 0,
		stepProperties: slotProps
			? reachedStepTimes.map((_, p) => (stepLocIdx[p] === -1 ? {} : slotProps[stepLocIdx[p]]) || {})
			: undefined,
		sessionId: undefined,
		terminatedByExclusion,
		excludedAtStep: terminatedByExclusion ? reached + 1 : null,
	};
	return { result, nextIdx: endIdx >= 0 ? endIdx : i, terminatedByExclusion };
}

/**
 * Evaluate a funnel against a user's event stream.
 *
 * Returns a `FunnelResult` (uniques mode, default) or an Array<FunnelResult>
 * (totals mode with `reentry: true`). When `sessionScoped: true`, partitions
 * by `session_id` and reports the best per-session result (or aggregates all
 * with totals mode).
 *
 * @param {Array<Object>} events
 * @param {FunnelStep[]} steps
 * @param {FunnelOptions} [options]
 * @returns {FunnelResult | FunnelResult[]}
 */
export function evaluateFunnel(events, steps, options = {}) {
	if (options.countMode === 'sessions') {
		// Mixpanel's funnel "count by Sessions" is an API rewrite, not an
		// engine mode: count_type session REQUIRES window (session, 1) and
		// rewrites to general_wo_repeat — totals counting with no restart
		// after a completed pass (__validate_sessions,
		// api/version_2_0/arb_funnels/validate.py "Cannot use count_type
		// session without length = 1 session"; get_default_conversion_window,
		// arb_funnels/util.py; no COUNT_TYPE_SESSIONS branch exists in
		// funnel_query.cpp — grep-confirmed).
		if (options.reentry) {
			throw new Error("evaluateFunnel: countMode 'sessions' disables re-entry (general_wo_repeat rewrite)");
		}
		const cw = options.conversionWindow;
		if (typeof options.conversionWindowMs === 'number' || (cw != null && !(cw.unit === 'sessions' && cw.n === 1))) {
			throw new Error("evaluateFunnel: cannot use countMode 'sessions' without conversion window = 1 session");
		}
		return evaluateFunnel(events, steps, {
			...options,
			countMode: 'totals',
			reentry: false,
			conversionWindowMs: undefined,
			conversionWindow: { unit: 'sessions', n: 1 },
		});
	}
	if (!Array.isArray(steps) || steps.length === 0) {
		const empty = emptyResult(options.trackStepProperties);
		return options.countMode === 'totals' ? [] : empty;
	}
	// v1.6.0 (P1.6.6): flatten { anyOrder: [...] } blocks and build the anchor
	// topology (history.cpp:214-228). Anchor-only funnels get an all-false
	// isAnyOrder mask and behave exactly as before.
	const { flat: normSteps, isAnyOrder, prevAnchor, nextAnchor } = normalizeFunnelSteps(steps);
	const {
		conversionWindowMs,
		conversionWindow,
		graceperiod = true,
		reentry = false,
		exclusionSteps,
		trackStepProperties = false,
		countMode = 'uniques',
		sessionScoped = false,
		anchorRange,
	} = options;

	const sorted = (events || [])
		.filter(e => e && typeof e.event === 'string')
		.slice()
		.sort((a, b) => toMs(a.time) - toMs(b.time));

	// Window predicate: (t, step0Time, event, step0Event) → boolean.
	let windowCheck;
	if (conversionWindow != null) {
		if (typeof conversionWindowMs === 'number') {
			throw new Error('evaluateFunnel: conversionWindow and conversionWindowMs are mutually exclusive');
		}
		if (typeof conversionWindow !== 'object' || conversionWindow.unit !== 'sessions') {
			throw new Error(`evaluateFunnel: unsupported conversionWindow unit "${conversionWindow && conversionWindow.unit}" — only { unit: 'sessions', n } (use conversionWindowMs for time windows)`);
		}
		const n = conversionWindow.n;
		if (!Number.isInteger(n) || n < 1) {
			throw new Error('evaluateFunnel: conversionWindow.n must be a positive integer');
		}
		if (n > 12) {
			// _MAX_LENGTHS["session"] = 12, api/version_2_0/arb_funnels/validate.py
			throw new Error(`evaluateFunnel: conversionWindow.n = ${n} exceeds Mixpanel's 12-session API cap`);
		}
		// Session ordinals over this user's stream (count of session ENDS
		// before each event — funnel_query.cpp's per-user session_id counter).
		// Step check per conversion_window.cpp WINDOW_TYPE_SESSIONS:
		// `session_id1 < session_id2 + length_sessions`, plus the n×1-day
		// wall-clock outer bound (seconds_per_unit[QUERY_UNIT_SESSION] =
		// SECONDS_PER_DAY, libquery/time/unit.c).
		// ARB-UNCERTAIN: the reader's per-step check is ordinal-only
		// (history.cpp → is_within_conversion_window); the day-width bound
		// appears as is_within_max_conversion_window_seconds against the
		// interval end (funnel_query.cpp:1620 region) and as the DQS
		// data-pull cap (_MAX_LENGTHS comment in validate.py). Spec P1.6.1
		// mandates the dual per-step condition; we follow the spec — the
		// stricter reading, divergent only when consecutive sessions sit
		// more than a day apart.
		const ordinals = sessionOrdinals(sorted);
		windowCheck = (t, t0, ev, step0Ev) => {
			const o = ordinals.get(ev);
			const o0 = ordinals.get(step0Ev);
			if (o === undefined || o0 === undefined) return false;
			return o < o0 + n && t < t0 + n * DAY_MS;
		};
	} else {
		windowCheck = (t, t0) => withinConversionWindow(t, t0, conversionWindowMs);
	}

	if (sessionScoped) {
		const bySession = new Map();
		for (const ev of sorted) {
			const sid = ev.session_id != null ? String(ev.session_id) : '__no_session__';
			if (!bySession.has(sid)) bySession.set(sid, []);
			bySession.get(sid).push(ev);
		}
		const allResults = [];
		for (const [sid, evs] of bySession) {
			const sub = evaluateFunnel(evs, steps, { ...options, sessionScoped: false });
			if (Array.isArray(sub)) {
				for (const r of sub) { r.sessionId = sid; allResults.push(r); }
			} else {
				sub.sessionId = sid; allResults.push(sub);
			}
		}
		if (countMode === 'totals') return allResults;
		// Uniques: return the best (highest reached, then earliest) session result.
		if (!allResults.length) return emptyResult(trackStepProperties);
		allResults.sort((a, b) => b.reached - a.reached || (a.stepTimes[0] || 0) - (b.stepTimes[0] || 0));
		return allResults[0];
	}

	// v1.6.0 (P1.6.5): trend-interval anchor bound — step 0 only in
	// [fromMs, toMs) (funnel_query.cpp:1398-1401). Later steps / exclusions
	// are unaffected: the window check from step 0 already bounds them.
	const anchorOk = anchorRange
		? (t) => (anchorRange.fromMs == null || t >= anchorRange.fromMs)
			&& (anchorRange.toMs == null || t < anchorRange.toMs)
		: null;

	const opts = { windowCheck, graceperiod, trackStepProperties, anchorOk, isAnyOrder, prevAnchor, nextAnchor };

	if (!reentry) {
		const { result } = runOneAttempt(sorted, 0, normSteps, exclusionSteps, opts);
		// Totals mode: ALWAYS return the attempt (including incomplete) so per-step
		// drop-off counts are preserved. Mixpanel funnel_query.cpp:1747 aggregates
		// `history_get_reached >= 0`, not "completed".
		return countMode === 'totals' ? [result] : result;
	}

	// Reentry: keep running attempts after each completion or exclusion.
	const allAttempts = [];
	const completedAttempts = [];
	let idx = 0;
	let lastResult = emptyResult(trackStepProperties);
	while (idx < sorted.length) {
		const { result, nextIdx, terminatedByExclusion } = runOneAttempt(sorted, idx, normSteps, exclusionSteps, opts);
		// Always advance — runOneAttempt returns nextIdx > idx when it processed an event.
		const advanced = nextIdx > idx ? nextIdx : idx + 1;
		idx = advanced;
		if (result.completed) {
			allAttempts.push(result);
			completedAttempts.push(result);
			lastResult = result;
		} else if (!terminatedByExclusion && result.reached < 0) {
			// Nothing matched in this slice — break to avoid infinite loop.
			break;
		} else {
			// Failed/excluded attempt that DID reach >= 0 contributes to totals.
			if (result.reached >= 0) allAttempts.push(result);
			lastResult = result;
		}
	}

	if (countMode === 'totals') return allAttempts;
	// Uniques mode with reentry: report aggregate `completions` on the LAST completion
	// (consistent with Mixpanel's stepEvents/stepTimes reporting LAST completion).
	if (completedAttempts.length) {
		const last = completedAttempts[completedAttempts.length - 1];
		last.completions = completedAttempts.length;
		return last;
	}
	lastResult.completions = 0;
	return lastResult;
}

/**
 * Hold Property Constant (HPC) — split a funnel into parallel sub-funnels per
 * unique value of `holdProperty` on the step-0 event. Returns
 * `Map<propertyValue, FunnelResult>`.
 *
 * Each sub-funnel runs independently (a user CAN convert in one HPC value
 * group and drop off in another simultaneously).
 *
 * Reference: `funnel_query.cpp` lines 749-784 (`aggregate_hash_get_key_cursor`).
 *
 * **Limitation (v1.5.0):** scalar HPC values only. Mixpanel's
 * `aggregate_hash_get_key_cursor` iterates *each value* of a list-valued
 * property, exploding into N sub-funnels per event. List-valued HPC keys are
 * not supported here — events with non-scalar `holdProperty` values will
 * stringify and bucket incorrectly.
 *
 * @param {Array<Object>} events
 * @param {FunnelStep[]} steps
 * @param {string} holdProperty
 * @param {FunnelOptions} [options]
 * @returns {Map<string|number, FunnelResult | FunnelResult[]>}
 */
export function evaluateFunnelHPC(events, steps, holdProperty, options = {}) {
	if (!holdProperty) throw new Error('evaluateFunnelHPC: holdProperty is required');
	if (!Array.isArray(steps) || !steps.length) return new Map();
	const { flat, isAnyOrder } = normalizeFunnelSteps(steps);
	if (isAnyOrder[0]) {
		// HPC keys off the step-0 event's property value; with an any-order
		// first chunk any member can claim position 0, so there is no single
		// seeding event name to bucket by.
		throw new Error('evaluateFunnelHPC: an anyOrder block cannot be the first funnel step');
	}
	const step0Name = flat[0].event;

	// Bucket events by HPC value. The step-0 events define the universe of
	// HPC values for this user; later events only populate buckets whose
	// value matches.
	const valueBuckets = new Map();
	for (const ev of events || []) {
		if (!ev || typeof ev.event !== 'string') continue;
		// Step-0 events seed the bucket on their own value.
		if (ev.event === step0Name) {
			const v = ev[holdProperty];
			if (v === undefined || v === null) continue;
			if (!valueBuckets.has(v)) valueBuckets.set(v, []);
			valueBuckets.get(v).push(ev);
		}
	}
	// Now route every event with a known HPC value into its bucket.
	for (const ev of events || []) {
		if (!ev || typeof ev.event !== 'string' || ev.event === step0Name) continue;
		const v = ev[holdProperty];
		if (v === undefined || v === null) continue;
		if (valueBuckets.has(v)) valueBuckets.get(v).push(ev);
	}

	const out = new Map();
	for (const [v, evs] of valueBuckets) {
		out.set(v, evaluateFunnel(evs, steps, options));
	}
	return out;
}

/**
 * Resolve the property snapshot for a given segment mode against a result's
 * `stepProperties`. Use to mimic Mixpanel's FIRST_TOUCH / LAST_TOUCH / STEP
 * funnel segment modes.
 *
 * @param {FunnelResult} result
 * @param {'first'|'last' | { step: number }} mode
 * @returns {Object | undefined}
 */
export function resolveFunnelSegment(result, mode) {
	if (!result || !Array.isArray(result.stepProperties) || !result.stepProperties.length) return undefined;
	if (mode === 'first') return result.stepProperties[0];
	if (mode === 'last')  return result.stepProperties[result.reached >= 0 ? result.reached : result.stepProperties.length - 1];
	if (mode && typeof mode === 'object' && typeof mode.step === 'number') {
		return result.stepProperties[mode.step];
	}
	throw new Error(`resolveFunnelSegment: invalid mode ${JSON.stringify(mode)}`);
}

/**
 * Set-membership funnel completion check for non-sequential funnel modes.
 *
 * @deprecated v1.6.0 (P1.6.6) — NOT Mixpanel semantics. Mixpanel's any-order
 * is an anchor/chunk greedy pass, not a set-membership check: use
 * `evaluateFunnel(events, [{ anyOrder: [...] }], options)` for
 * Mixpanel-comparable results (conversion window, 2s rule, exclusions, and
 * reentry all apply). This helper ignores all of those. Kept for callers that
 * want a cheap "did the user ever fire all of these" signal.
 *
 * Returns true when the user fired all `steps` event names at least once,
 * regardless of order.
 *
 * `completionTimeMs` = `lastSeenTime - firstSeenTime` (proxy for "how long to
 * hit all steps in any order"). Mixpanel's funnel TTC analog doesn't exist for
 * non-sequential funnels — this is informational only.
 *
 * @param {Array<Object>} events
 * @param {string[]} steps
 * @returns {{
 *   completed: boolean,
 *   eventsFired: string[],
 *   firstSeenTime: number,
 *   lastSeenTime: number,
 *   completionTimeMs: number | null
 * }}
 */
export function evaluateAnyOrderCompletion(events, steps) {
	const empty = { completed: false, eventsFired: [], firstSeenTime: 0, lastSeenTime: 0, completionTimeMs: null };
	if (!Array.isArray(steps) || steps.length === 0) return empty;
	if (!Array.isArray(events) || events.length === 0) return empty;
	const stepSet = new Set(steps);
	const earliestByEvent = new Map();
	let firstSeenTime = Infinity, lastSeenTime = -Infinity;
	for (const ev of events) {
		if (!ev || typeof ev.event !== 'string' || !stepSet.has(ev.event)) continue;
		const t = toMs(ev.time);
		if (!Number.isFinite(t)) continue;
		const prev = earliestByEvent.get(ev.event);
		if (prev === undefined || t < prev) earliestByEvent.set(ev.event, t);
		if (t < firstSeenTime) firstSeenTime = t;
		if (t > lastSeenTime) lastSeenTime = t;
	}
	const completed = earliestByEvent.size === stepSet.size;
	if (!completed) {
		return { ...empty, eventsFired: [...earliestByEvent.keys()] };
	}
	return {
		completed: true,
		eventsFired: [...earliestByEvent.keys()],
		firstSeenTime,
		lastSeenTime,
		completionTimeMs: lastSeenTime - firstSeenTime,
	};
}
