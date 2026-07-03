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
 *   - Any-order step blocks (`is_any_order_step`)
 *   - Selector expressions beyond eq/neq/gt/lt/gte/lte/contains/not_contains
 *
 * @typedef {Object} StepFilter
 * @property {string} prop
 * @property {'eq'|'neq'|'gt'|'lt'|'gte'|'lte'|'contains'|'not_contains'} op
 * @property {*} value
 *
 * @typedef {string | { event: string, where?: StepFilter }} FunnelStep
 *
 * @typedef {Object} ExclusionStep
 * @property {string} event - Event name that terminates the attempt.
 * @property {number} [afterStep] - Exclusion active when `reached >= afterStep`. Mixpanel
 *   `funnel_query.cpp` exclusion `i` fires when user has reached step `i` (between step
 *   `i` and step `i+1`). Default `-Infinity` — fires anywhere in the attempt (including
 *   before step 0), useful for the simple `[{event: 'X'}]` shape used by
 *   `Funnel.exclusionEvents` ("X anywhere kills").
 * @property {number} [beforeStep] - Exclusion active when `reached < beforeStep`.
 *   Default `steps.length` — fires until completion.
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
 * @property {'uniques'|'totals'} [countMode='uniques'] - `'totals'` returns an
 *   ARRAY of FunnelResult — one per attempt (Mixpanel funnel_query.cpp:2055-2100).
 *   Includes incomplete attempts (drop-offs contribute to per-step counts).
 *   Without `reentry: true`, the array has at most one entry (the single attempt).
 * @property {boolean} [sessionScoped=false] - **@deprecated — verifier-only, NOT
 *   Mixpanel-comparable.** Partitions events by generator-stamped `session_id` and runs
 *   the matcher independently per session, returning the best result (or all results
 *   when `countMode: 'totals'`). Mixpanel does NOT partition funnels per session — it
 *   bounds them by session COUNT via `WINDOW_TYPE_SESSIONS` on the conversion window
 *   (`conversion_window.cpp:9-13`). Use `conversionWindow: { unit: 'sessions', n }`
 *   for Mixpanel-comparable results; results from `sessionScoped: true` are NOT
 *   reproducible in the Mixpanel UI.
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
 * `{ event, where }` shape.
 *
 * @param {FunnelStep} step
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
	const r = { completed: false, reached: -1, stepEvents: [], stepTimes: [], ttcMs: null, completions: 0, stepProperties: undefined, sessionId: undefined };
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
	const { windowCheck, graceperiod, trackStepProperties } = options;
	const stepTimes = new Array(steps.length).fill(0);
	const stepEvents = new Array(steps.length).fill(null);
	const stepProps = trackStepProperties ? new Array(steps.length).fill(null) : null;
	let reached = -1;
	let i = startIdx;
	let terminatedByExclusion = false;

	for (; i < sorted.length; i++) {
		const ev = sorted[i];
		const t = toMs(ev.time);
		if (!Number.isFinite(t)) continue;

		// Exclusion check FIRST — if this event matches any active exclusion,
		// terminate the attempt. Mixpanel `funnel_query.cpp` exclusion `i`
		// fires when the user has reached step `i` (between step `i` and step
		// `i+1`). API: `afterStep` is the index of the step that must have
		// been reached; `beforeStep` is the index of the step that must NOT
		// have been reached yet. Range check: `reached >= after && reached < before`.
		// Defaults (afterStep=-Infinity, beforeStep=steps.length) mean
		// "fires anywhere in the attempt" — used by the simple
		// `[{event: 'X'}]` shape that `Funnel.exclusionEvents` produces.
		if (exclusionSteps && exclusionSteps.length) {
			let excluded = false;
			for (const ex of exclusionSteps) {
				if (ev.event !== ex.event) continue;
				const after = typeof ex.afterStep === 'number' ? ex.afterStep : -Infinity;
				const before = typeof ex.beforeStep === 'number' ? ex.beforeStep : steps.length;
				if (reached >= after && reached < before) {
					excluded = true; break;
				}
			}
			if (excluded) { terminatedByExclusion = true; i++; break; }
		}

		// Greedy assignment: this event goes to the first not-yet-reached
		// step whose name + filter matches.
		let matchedStep = -1;
		for (let s = reached + 1; s < steps.length; s++) {
			if (eventMatchesStep(ev, steps[s])) { matchedStep = s; break; }
		}
		if (matchedStep < 0) continue;

		// "Always record the latest matching event for this step" — history.cpp.
		stepTimes[matchedStep] = t;
		stepEvents[matchedStep] = ev;
		if (stepProps) stepProps[matchedStep] = snapshotProperties(ev, trackStepProperties);

		if (matchedStep !== reached + 1) continue;

		if (matchedStep > 0 && !windowCheck(t, stepTimes[0], ev, stepEvents[0])) {
			stepTimes[matchedStep] = 0;
			stepEvents[matchedStep] = null;
			if (stepProps) stepProps[matchedStep] = null;
			continue;
		}

		reached = matchedStep;

		// Cascade through pre-recorded later steps.
		const step0Time = stepTimes[0];
		let lastReachedTime = t;
		let ns = reached + 1;
		while (ns < steps.length) {
			const recorded = stepTimes[ns];
			if (recorded > 0
				&& timestampComesAfter(recorded, lastReachedTime, graceperiod)
				&& windowCheck(recorded, step0Time, stepEvents[ns], stepEvents[0])
			) {
				reached = ns;
				lastReachedTime = recorded;
				ns++;
			} else {
				break;
			}
		}

		if (reached === steps.length - 1) { i++; break; }
	}

	const reachedStepEvents = stepEvents.slice(0, reached + 1);
	const reachedStepTimes = stepTimes.slice(0, reached + 1);
	const completed = reached === steps.length - 1;
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
		stepProperties: stepProps ? stepProps.slice(0, reached + 1).map(p => p || {}) : undefined,
		sessionId: undefined,
	};
	return { result, nextIdx: i, terminatedByExclusion };
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
	if (!Array.isArray(steps) || steps.length === 0) {
		const empty = emptyResult(options.trackStepProperties);
		return options.countMode === 'totals' ? [] : empty;
	}
	const normSteps = steps.map(normalizeStep);
	const {
		conversionWindowMs,
		conversionWindow,
		graceperiod = true,
		reentry = false,
		exclusionSteps,
		trackStepProperties = false,
		countMode = 'uniques',
		sessionScoped = false,
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

	const opts = { windowCheck, graceperiod, trackStepProperties };

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
	const normSteps = steps.map(normalizeStep);
	const step0Name = normSteps[0].event;

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
