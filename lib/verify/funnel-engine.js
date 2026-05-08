/**
 * Greedy single-pass funnel state machine matching Mixpanel's behavior.
 *
 * Mixpanel processes funnel events in chronological order, single pass, with
 * no backtracking. Each event is greedily assigned to the first eligible
 * funnel step. This is a streaming optimization for processing billions of
 * events; it differs from a SQL-style "find best combination" search.
 *
 * Reference: `mixpanel/analytics` backend/arb/reader/funnels/history.cpp
 *
 * Key rules implemented here:
 *   1. Events processed left-to-right after sorting by time.
 *   2. Step N requires step N-1 already reached.
 *   3. `timestamp_comes_after(t1, t2)` allows a 2-second grace window
 *      (`OUT_OF_ORDER_MILLISECONDS = 2000` in history.cpp).
 *   4. Conversion window measured from step 0, strict `<`
 *      (`is_within_conversion_window`: `t1 < t2 + length_seconds * 1000`).
 *   5. "Always record latest matching event for a step" — even before that
 *      step is reached. After advancement we cascade forward through the
 *      already-recorded later steps.
 *
 * Documented edge case (history.cpp ~line 456): For funnel `[A, B, B]` with
 * event stream `[B, B, A]` all within 2 seconds, the engine does NOT
 * attribute the second B to step 2. We match that behavior — when an event
 * matches a step but the prior step has not been reached, we record the
 * event time at that step but cannot advance, and the LATER cascade picks
 * the most recently recorded time, leaving the second B unattributed.
 *
 * NOT implemented (documented for future readers):
 *   - Funnel reentry: Mixpanel can restart the state machine within a single
 *     user (`reentry` flag). Our verifier reports the first run only.
 *   - HPC (High Performance Computing parallel histories): per-key parallel
 *     state machines (`funnel_query.cpp` lines 749-784). Not used by our
 *     dungeons.
 *   - Exclusion steps: negative steps that terminate the funnel. None of
 *     our hook patterns generate them.
 *   - Any-order steps: `is_any_order_step` blocks where steps can fire in
 *     any order. Our funnels are always strictly ordered.
 *   - Segment modes (FIRST_TOUCH / LAST_TOUCH / STEP) for breakdown
 *     property resolution.
 *
 * @typedef {Object} FunnelOptions
 * @property {number} [conversionWindowMs] - Max time from step 0 to last
 *   step (strict `<`). Omit for no window check.
 * @property {boolean} [graceperiod=true] - Enable the 2-second grace window
 *   on ordering checks. Disable only for tests that need strict ordering.
 *
 * @typedef {Object} FunnelResult
 * @property {boolean} completed - Reached every step.
 * @property {number} reached - Highest step index reached (0-based).
 *   `-1` if no steps reached.
 * @property {Array<Object|null>} stepEvents - The event assigned to each
 *   reached step (length === reached + 1).
 * @property {Array<number|null>} stepTimes - Timestamp (ms) of each reached
 *   step (length === reached + 1).
 * @property {number|null} ttcMs - Time-to-convert: stepTimes[last] -
 *   stepTimes[0]. `null` if not completed.
 */

import { toMs } from '../hook-helpers/_internal.js';

const OUT_OF_ORDER_MS = 2000;

/**
 * Returns true if `t1` is "after" `t2` by Mixpanel's funnel rules.
 * Matches `timestamp_comes_after()` in history.cpp.
 *
 *   if (t1 > 0 && t1 >= t2) return true;
 *   if (t1 > 0 && t1 + 2000 >= t2) return true;
 *
 * The `t1 > 0` guard exists because Mixpanel uses 0 as a sentinel for
 * "never recorded." We preserve the guard for parity.
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
 * `is_within_conversion_window()` in conversion_window.cpp:
 *   `t1 < t2 + length_seconds * 1000`  (strict `<`)
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
 * Evaluate a funnel against a user's event stream using Mixpanel's greedy
 * single-pass algorithm.
 *
 * Reference: `backend/arb/reader/funnels/history.cpp` (greedy state machine,
 * 2-second grace, conversion-window check, cascade after advancement).
 *
 * @param {Array<Object>} events - User's events. Sorted internally.
 * @param {string[]} steps - Ordered funnel step event names.
 * @param {FunnelOptions} [options]
 * @returns {FunnelResult}
 */
export function evaluateFunnel(events, steps, options = {}) {
	if (!Array.isArray(steps) || steps.length === 0) {
		return { completed: false, reached: -1, stepEvents: [], stepTimes: [], ttcMs: null };
	}
	const { conversionWindowMs, graceperiod = true } = options;
	const sorted = (events || [])
		.filter(e => e && typeof e.event === 'string')
		.slice()
		.sort((a, b) => toMs(a.time) - toMs(b.time));

	const stepTimes = new Array(steps.length).fill(0);
	const stepEvents = new Array(steps.length).fill(null);
	let reached = -1;

	for (const ev of sorted) {
		const t = toMs(ev.time);
		if (!Number.isFinite(t)) continue;

		// Greedy assignment: this event goes to the first not-yet-reached
		// step whose name matches.
		let matchedStep = -1;
		for (let s = reached + 1; s < steps.length; s++) {
			if (steps[s] === ev.event) { matchedStep = s; break; }
		}
		if (matchedStep < 0) continue;

		// "Always record the latest matching event for this step" — history.cpp:
		// even when we cannot advance yet, recording the latest time gives the
		// cascade a chance to use it once the prior step lands.
		stepTimes[matchedStep] = t;
		stepEvents[matchedStep] = ev;

		// Can only advance when the matched step is exactly the next one.
		if (matchedStep !== reached + 1) continue;

		// Conversion window: any step beyond step 0 must satisfy
		// `event_time < step_0_time + window` (strict <).
		if (matchedStep > 0 && !withinConversionWindow(t, stepTimes[0], conversionWindowMs)) {
			// Reset this recorded time — it's outside the window so it can't
			// be used in a future cascade either (cascade also checks window).
			stepTimes[matchedStep] = 0;
			stepEvents[matchedStep] = null;
			continue;
		}

		reached = matchedStep;

		// Cascade forward through already-recorded later steps that satisfy
		// ordering (timestamp_comes_after) and conversion-window checks.
		const step0Time = stepTimes[0];
		let lastReachedTime = t;
		let ns = reached + 1;
		while (ns < steps.length) {
			const recorded = stepTimes[ns];
			if (recorded > 0
				&& timestampComesAfter(recorded, lastReachedTime, graceperiod)
				&& withinConversionWindow(recorded, step0Time, conversionWindowMs)
			) {
				reached = ns;
				lastReachedTime = recorded;
				ns++;
			} else {
				break;
			}
		}

		if (reached === steps.length - 1) break;
	}

	const reachedStepEvents = stepEvents.slice(0, reached + 1);
	const reachedStepTimes = stepTimes.slice(0, reached + 1);
	const completed = reached === steps.length - 1;
	const ttcMs = completed && reachedStepTimes.length > 1
		? reachedStepTimes[reachedStepTimes.length - 1] - reachedStepTimes[0]
		: null;

	return {
		completed,
		reached,
		stepEvents: reachedStepEvents,
		stepTimes: reachedStepTimes,
		ttcMs,
	};
}

/**
 * Set-membership funnel completion check for non-sequential funnel modes.
 *
 * Returns true when the user fired all `steps` event names at least once,
 * regardless of order. Used for funnels generated with order modes other than
 * `sequential` / `interrupt` where Mixpanel's greedy single-pass doesn't apply.
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
