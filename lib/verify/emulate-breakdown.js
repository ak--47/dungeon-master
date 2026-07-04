/**
 * Mixpanel breakdown emulator.
 *
 * Best-effort approximation of the table shapes Mixpanel produces for the
 * five analyses the Phase 4 hook patterns target. Used by `verify-dungeon`
 * to assert that engineered patterns actually produce the expected ratios
 * in the data, AND by consumers who want to validate dungeons against
 * expected business shapes outside of Mixpanel.
 *
 * The counting semantics now match Mixpanel's actual implementation
 * (greedy single-pass funnels, distinct-period frequency, null-aware
 * aggregation, attribution touchpoint cap). See `funnel-engine.js` and
 * `counting.js` for the per-rule references into the
 * `mixpanel/analytics` source tree.
 *
 * Caveats:
 * - Mixpanel applies its own per-account UTC offset and time-bucketing
 *   rules. This emulator uses raw event times; UTC is assumed.
 * - "Users" are unique `user_id` (falling back to `distinct_id`) found
 *   across the events array.
 * - This is not bit-exact — it's the *shape* check verification needs.
 */

import { toMs } from '../hook-helpers/_internal.js';
import { evaluateFunnel, evaluateFunnelHPC, evaluateAnyOrderCompletion } from './funnel-engine.js';
import { buildIdentityMap, resolveUserId } from './identity.js';
import { coerceToBreakdownKey, breakdownSegmentKey, matchesWhere } from './coerce.js';
import { filterFirstTimeEver } from './first-time.js';
import { sessionize } from './sessionize.js';
import { extractFlows, aggregateFlows } from './flows.js';
import {
	countDistinctPeriods,
	countDistinctValues,
	nullAwareAvg,
	nullAwareSum,
	nullAwareExtreme,
	partitionByTimeBucket,
	bucketBoundsMs,
} from './counting.js';

/**
 * v1.5: pick the right per-user funnel evaluator based on the funnel's `order` mode.
 * v1.6.0 (P1.6.6): orders whose scrambled region is CONTIGUOUS map exactly onto
 * the engine's `{ anyOrder: [...] }` step blocks (history.cpp anchor/chunk
 * greedy pass) — full Mixpanel semantics: conversion window, 2s rule,
 * exclusions, reentry, and `anchorRange` all apply.
 *
 *   - `sequential`, `interrupt`, `interrupted` → greedy single-pass
 *   - `first-fixed`          → `[s0, { anyOrder: rest }]`
 *   - `last-fixed`           → `[{ anyOrder: init }, sLast]`
 *   - `first-and-last-fixed` → `[s0, { anyOrder: middle }, sLast]`
 *   - `outside-in`, `random` → `[{ anyOrder: all }]` (full any-order)
 *   - `middle-fixed`         → set-membership completion (partial): the
 *     scrambled slots are the two ENDS (`u.shuffleOutside` — middle stays
 *     fixed), which is non-contiguous; neither the engine nor Mixpanel's
 *     any-order groups can express it.
 *
 * Returns a normalized result `{ completed, reached, ttcMs, mode, verificationKind }`.
 * `verificationKind` is `undefined` for Mixpanel-comparable modes (full
 * PASS/FAIL allowed), `'partial'` for `middle-fixed`'s completion-only check.
 *
 * @param {Array<Object>} userEvents
 * @param {string[]} steps
 * @param {Object} options
 * @param {string} [options.funnelOrder='sequential']
 * @param {number} [options.conversionWindowMs]
 * @param {{unit: 'sessions', n: number}} [options.conversionWindow]
 * @param {boolean} [options.reentry]
 * @param {Array<Object>} [options.exclusionSteps]
 * @param {boolean | string[]} [options.trackStepProperties]
 * @param {boolean} [options.sessionScoped]
 * @param {{fromMs?: number, toMs?: number}} [options.anchorRange] - step-0
 *   anchor bounds (P1.6.5) — honored by every order except `middle-fixed`
 *   (whose set-membership check has no anchor concept).
 */
function evaluateFunnelByOrder(userEvents, steps, options = {}) {
	const order = options.funnelOrder || 'sequential';
	const sequentialOpts = {
		conversionWindowMs: options.conversionWindowMs,
		conversionWindow: options.conversionWindow,
		reentry: options.reentry,
		exclusionSteps: options.exclusionSteps,
		trackStepProperties: options.trackStepProperties,
		sessionScoped: options.sessionScoped,
		anchorRange: options.anchorRange,
	};
	// Degenerate scrambled regions collapse to plain steps: an empty region
	// means the order IS sequential, and a 1-element region shuffles to itself
	// (the generator's shuffle of one element is the identity) — expressing it
	// as a 1-member anyOrder block would change buffering semantics (chunk
	// first-match vs anchor latest-match) for data that is in fact ordered.
	const block = (arr) => arr.length === 1 ? arr[0] : { anyOrder: arr };
	let engineSteps = /** @type {Array<*>} */ (steps);
	switch (order) {
		case 'first-fixed':
			if (steps.length >= 2) engineSteps = [steps[0], block(steps.slice(1))];
			break;
		case 'last-fixed':
			if (steps.length >= 2) engineSteps = [block(steps.slice(0, -1)), steps[steps.length - 1]];
			break;
		case 'first-and-last-fixed':
			if (steps.length >= 3) engineSteps = [steps[0], block(steps.slice(1, -1)), steps[steps.length - 1]];
			break;
		case 'outside-in':
		case 'random':
			// Full any-order group. `random` generation is a full shuffle;
			// `outside-in` has no generator implementation (falls through to
			// sequential order) — the any-order funnel accepts both.
			if (steps.length >= 2) engineSteps = [{ anyOrder: steps.slice() }];
			break;
		case 'middle-fixed': {
			const r = evaluateAnyOrderCompletion(userEvents, steps);
			return {
				completed: r.completed,
				reached: r.completed ? steps.length - 1 : -1,
				stepEvents: [],
				stepTimes: [],
				ttcMs: r.completionTimeMs,
				mode: order,
				verificationKind: 'partial',
			};
		}
		default:
			break; // sequential / interrupt / interrupted / unknown → as-is
	}
	const r = /** @type {*} */ (evaluateFunnel(userEvents, engineSteps, sequentialOpts));
	return { ...r, mode: order, verificationKind: undefined };
}

/**
 * @typedef {Object} EmulateOptions
 * @property {'frequencyByFrequency'|'funnelFrequency'|'aggregatePerUser'|'timeToConvert'|'attributedBy'|'sessionMetrics'|'retention'|'distinctCount'|'eventBreakdown'|'uniques'|'lifecycle'|'topPaths'} type
 *
 * @property {string} [metricEvent]
 * @property {string} [breakdownByFrequencyOf]
 * @property {boolean} [perUser]
 * @property {('hour'|'day'|'week')} [periodUnit]
 *
 * @property {string[]} [steps]
 * @property {number} [conversionWindowMs]
 *
 * @property {string} [event]
 * @property {string} [property]
 * @property {'avg'|'sum'|'count'|'max'|'min'} [agg]
 *
 * @property {string} [fromEvent]
 * @property {string} [toEvent] - timeToConvert pair sugar. v1.6.0 (P1.6.7):
 *   pass `steps` (>= 2 entries) instead for multi-step TTC; rows gain
 *   avg_ttc_s, step_counts, gap_avg_s, cumulative_avg_s
 *   (funnel_query.cpp:3355-3380 arithmetic — integer seconds, per-gap clamp).
 * @property {string} [breakdownByUserProperty]
 * @property {Array<Object>} [profiles]
 *
 * @property {string} [conversionEvent]
 * @property {string} [attributionEvent]
 * @property {string} [attributionProperty]
 * @property {'firstTouch'|'lastTouch'} [model]
 * @property {'first'|'all'} [perConversion] - attributedBy only: 'first' (default) evaluates
 *   only each user's first conversion (v1.5 behavior); 'all' runs attribution per conversion
 *   event (Mixpanel behavior — attributed_value_reader_read takes one
 *   event_time_ms per conversion).
 *
 * v1.6.0 eventBreakdown (Insights: total events segmented by a property):
 * @property {string} [breakdownProperty]
 * @property {number} [topN]
 * @property {'sessions'|'unique'|'general'} [countType] - eventBreakdown +
 *   uniques (P1.7.3) accept 'sessions' only: count once per (user, session,
 *   segment) / distinct (user, session) pairs per bucket, deriving sessions
 *   via sessionize(). topPaths (P1.9) accepts all three (see extractFlows).
 * @property {number} [sessionTimeoutMs]
 *
 * v1.6.0 (P1.7.2) sessionMetrics: `source: 'derived'` (default) re-derives
 * sessions at query time via sessionize(); `'stamped'` keeps the v1.5
 * stamped-session_id path. `sessionTimeoutMs`/`maxSessionMs` thread into
 * sessionize. Every row reports `source` + `stampedDivergence`.
 * @property {('count'|'duration'|'eventsPerSession')[]} [metrics]
 * @property {'derived'|'stamped'} [source]
 * @property {number} [maxSessionMs]
 *
 * v1.6.0 uniques (Insights: unique users per interval / XAU / cumulative):
 * @property {Object<string, *>} [where]
 * @property {('day'|'week'|'month'|'range')} [unit]
 * @property {number} [rollingWindow]
 * @property {boolean} [cumulative]
 * @property {boolean} [firstTimeOnly]
 *
 * v1.6.0 lifecycle (P1.8 — the Lifecycle Cohort Analysis classification;
 * New / Retained / Resurrected / Dormant user counts per tiled period):
 * @property {string} [valueMomentEvent] - The event that defines "active".
 * @property {7|30} [periodDays] - The two LCA template variants.
 *
 * v1.6.0 topPaths (P1.9 — the Flows report; anchored event paths aggregated
 * into a pruned prefix tree; see flows.js for the ARB citations):
 * @property {Array<string|{event: string, where?: Object<string, *>}>} [anchors]
 * @property {number|number[]} [forward] - Steps kept AFTER each anchor
 *   (linear buffer, keeps the FIRST N). Scalar broadcasts; default 4 mirrors
 *   the UI's expansion default (spec contract, not an ARB constant).
 * @property {number|number[]} [reverse] - Steps kept BEFORE each anchor
 *   (ring buffer, keeps the LAST N). Scalar broadcasts; default 0.
 * @property {'list'|'sankey'} [output] - Result shape (default 'list').
 * @property {number} [cardinalityThreshold] - Per-level top-N before
 *   coalescing into $mp_uncommon_flows_events (default 50 list / 3 sankey —
 *   bookmark.py:96/:110).
 * @property {string[]} [hiddenEvents] - Non-anchor steps to drop (anchor
 *   names exempt — query/flows.go filterAnchorEventNames).
 * @property {string[]} [visibleEvents] - Non-anchor allow-list; hidden wins
 *   (query/flows.go filteredVisibleEventSelectors).
 * @property {boolean} [collapseRepeated] - Suppress consecutive repeats
 *   (default false — flows_params_utils.py:37).
 *
 * v1.5.0 funnel extensions (apply to funnelFrequency + timeToConvert sequential modes):
 * @property {boolean} [reentry]
 * @property {Array<Object>} [exclusionSteps]
 * @property {boolean | string[]} [trackStepProperties]
 * @property {boolean} [sessionScoped]
 *
 * v1.6.0 funnel count/window extensions (funnelFrequency, sequential order modes
 * only — findings #15). `countMode` follows evaluateFunnel: 'uniques' (default,
 * one result per user), 'totals' (every attempt counts a conversion row),
 * 'sessions' (Mixpanel's session count type — rewritten to totals +
 * 1-session window per api/version_2_0/arb_funnels/validate.py
 * __validate_sessions). `holdPropertyConstant` splits each user into parallel
 * per-property-value sub-funnels (evaluateFunnelHPC — scalar values only).
 * `conversionWindow` is the session-count window ({ unit: 'sessions', n ≤ 12 });
 * mutually exclusive with `conversionWindowMs`.
 * @property {'uniques'|'totals'|'sessions'} [countMode]
 * @property {string} [holdPropertyConstant]
 * @property {{unit: 'sessions', n: number}} [conversionWindow]
 * @property {string} [funnelOrder] - Funnel step-order mode (see
 *   evaluateFunnelByOrder); defaults to 'sequential'.
 * @property {{from?: number|string, to?: number|string}} [cohortWindow] -
 *   Retention birth window (inclusive bounds — see retention()).
 *
 * @property {Map<string,string>} [identityMap]
 *
 * Cross-cutting time-bucketed output:
 * @property {('day'|'week'|'month')} [timeBucket]
 * @property {{from: number|string, to: number|string}} [timeBucketRange]
 *
 * **timeBucket result-row contract:**
 *   - Buckets WITH events: `{ period, ...originalBreakdownRow }`
 *   - Buckets WITHOUT events (only when `timeBucketRange` set):
 *     `{ period, _empty: true }` — caller MUST filter `r._empty` before any
 *     numerical aggregation. Mixpanel `normal_query.cpp:352-356` emits zero
 *     rows for empty intervals; we use the `_empty` marker instead of
 *     guessing a per-type zero-row template.
 *
 * v1.6.0 (P1.6.5) — step-0-anchored trends: under `timeBucket`, the types
 * `funnelFrequency` and `timeToConvert` and `retention` follow Mixpanel's
 * interval rule "step 0 in [start, stop); steps 1+ in
 * [start, stop + conversion window)" (funnel_query.cpp:1398-1401;
 * history.cpp:437-440 for retention returns): a conversion or return
 * spilling past the bucket edge is credited to the bucket that ANCHORED it.
 * P1.6.6 extended this to every funnel order that routes through the engine's
 * anyOrder blocks (all orders except `middle-fixed`, whose set-membership
 * check keeps plain event partitioning).
 * @property {{fromMs?: number, toMs?: number}} [anchorRange] - Step-0 anchor
 *   bounds for `funnelFrequency`/`timeToConvert` (set automatically by the
 *   timeBucket wrapper; may be passed directly for a single-interval run).
 *   Events outside `[fromMs, toMs)` cannot anchor step 0 or count on the
 *   frequency axis, but can complete later steps.
 */

/**
 * Run a Mixpanel breakdown emulation against an events array.
 * Routes to the type-specific implementation based on `config.type`.
 *
 * @param {Array<Object>} events
 * @param {EmulateOptions} config
 * @returns {Array<Object>|Object} Breakdown table rows (every type except
 *   'topPaths', which returns aggregateFlows' single result object).
 */
export function emulateBreakdown(events, config) {
	if (!Array.isArray(events)) throw new Error('emulateBreakdown: events must be an array');
	if (!config || !config.type) throw new Error('emulateBreakdown: config.type is required');

	// Auto-build identity map ONCE when profiles supplied. Threads through every
	// breakdown type AND every time-bucket recursive call so pre-auth (device_id
	// only) events resolve to the same canonical user as post-auth (user_id)
	// events. Hoisted above the timeBucket dispatch to avoid rebuilding the
	// map per-bucket on large datasets.
	const identityMap = config.identityMap
		|| (Array.isArray(config.profiles)
			&& config.profiles.some(p =>
				p && ((Array.isArray(p.device_ids) && p.device_ids.length)
					|| (Array.isArray(p.anonymousIds) && p.anonymousIds.length)))
			? buildIdentityMap(config.profiles)
			: undefined);

	// v1.5: time-bucketed wrapper. Partition events by UTC bucket, run the
	// underlying breakdown per partition, tag rows with `period`.
	//
	// Empty-bucket backfill: when `timeBucketRange: { from, to }` is supplied,
	// every bucket in the range gets a row, even if the breakdown returned no
	// rows. Empty periods emit a single `{ period, _empty: true }` marker so
	// callers can render a continuous trend axis (Mixpanel `normal_query.cpp`
	// emits zero rows for empty intervals). Consumers MUST filter `r._empty`
	// before any aggregation.
	if (config.timeBucket) {
		if (config.type === 'uniques') {
			// `uniques` produces its own time axis (unit/rollingWindow/cumulative).
			// Pre-partitioning here would break rolling look-back windows and the
			// cumulative running set, which both span bucket boundaries.
			throw new Error('emulateBreakdown: type "uniques" does not compose with timeBucket — use `unit` instead');
		}
		if (config.type === 'lifecycle') {
			// Classification is cross-period by construction (retained/resurrected/
			// dormant all read T−1 and earlier) — pre-partitioning would blind it.
			throw new Error('emulateBreakdown: type "lifecycle" does not compose with timeBucket — it tiles its own period axis');
		}
		if (config.type === 'topPaths') {
			// Flows aggregates ONE path universe over the whole query range (a
			// single prefix tree — flows_query.cpp end-of-data flush); there is
			// no per-interval trend variant to partition into.
			throw new Error('emulateBreakdown: type "topPaths" does not compose with timeBucket — flows aggregate one path universe over the range');
		}
		const range = config.timeBucketRange || {};
		const buckets = partitionByTimeBucket(events, config.timeBucket, range);
		// Pass the pre-built identityMap into recursive calls so the auto-build
		// branch above is a no-op per bucket (would otherwise rebuild N times).
		const inner = { ...config, timeBucket: undefined, timeBucketRange: undefined, identityMap };
		const out = [];

		// v1.6.0 (P1.6.5): step-0-anchored trend types. Mixpanel evaluates each
		// trend interval as "step 0 in [start, stop); steps 1+ in
		// [start, stop + conversion window)" (funnel_query.cpp:1398-1401), and
		// retention's birth-in-interval with returns spilling past the interval
		// edge (history.cpp:437-440). Plain event-partitioning would truncate
		// any window spanning a bucket edge, so:
		//   - retention: run each bucket over the FULL stream, intersecting
		//     `cohortWindow` with the bucket bounds (births anchor in-bucket,
		//     returns spill freely);
		//   - funnelFrequency / timeToConvert: slice to [start, stop + window)
		//     and pass `anchorRange` down so step 0 only anchors in
		//     [start, stop).
		// v1.6.0 (P1.6.6): every funnel order except 'middle-fixed' now routes
		// through the engine (anyOrder blocks honor anchorRange — the funnel's
		// FIRST POSITION, whatever slot fills it, must anchor in [start, stop)).
		// 'middle-fixed' keeps plain partitioning: its scrambled slots are the
		// two ends (non-contiguous), so it stays on the set-membership helper,
		// which has no anchor concept.
		const anchorableOrder = config.funnelOrder !== 'middle-fixed';
		const anchored = config.type === 'retention'
			|| ((config.type === 'funnelFrequency' || config.type === 'timeToConvert') && anchorableOrder);

		if (anchored) {
			for (const { period } of buckets) {
				const { startMs, endMs } = bucketBoundsMs(period, config.timeBucket);
				let rows;
				if (config.type === 'retention') {
					const cw = config.cohortWindow || {};
					const from = Math.max(startMs, cw.from != null ? toMs(cw.from) : -Infinity);
					const to = Math.min(endMs - 1, cw.to != null ? toMs(cw.to) : Infinity); // cohortWindow bounds are inclusive
					rows = from > to ? [] : emulateBreakdown(events, { ...inner, cohortWindow: { from, to } });
				} else {
					const spillMs = typeof config.conversionWindowMs === 'number'
						? config.conversionWindowMs
						: (config.conversionWindow && typeof config.conversionWindow.n === 'number'
							// session windows: ARB's per-step check is ordinal-only, but
							// histories terminate conversion_window_max_length_seconds
							// (n × SECONDS_PER_DAY for sessions, unit.c:14) past the
							// INTERVAL END (funnel_query.cpp:1620) — this slice mirrors that.
							? config.conversionWindow.n * 86400_000
							: Infinity);
					const sliceEnd = endMs + spillMs;
					const slice = events.filter(e => {
						const t = toMs(e && e.time);
						return Number.isFinite(t) && t >= startMs && t < sliceEnd;
					});
					rows = emulateBreakdown(slice, { ...inner, anchorRange: { fromMs: startMs, toMs: endMs } });
				}
				if (rows.length) {
					for (const r of rows) out.push({ period, ...r });
				} else {
					out.push({ period, _empty: true });
				}
			}
			return out;
		}

		// v1.6.0 fix round (B5): firstTimeOnly must see the FULL stream.
		// Mixpanel computes ONE first_event_time per user over the whole
		// lookback (~5y — event_selector.py:125-149). Recursing with the raw
		// per-bucket slice would re-elect a "first" inside every bucket,
		// counting each active user once per bucket instead of exactly once
		// overall. Filter the FULL stream, repartition, clear the flag for
		// the inner calls — the survivor lands in its one true bucket.
		//
		// countType 'sessions' needs NO such hoist: sessions never cross UTC
		// midnight (unconditional daySplit, sessionize.js buildUserSessions —
		// ARB resets session state at the day boundary) and every timeBucket
		// unit (day/week/month) cuts at midnights, so each session's events
		// are wholly inside one bucket and slice re-derivation reproduces the
		// full-stream boundaries exactly (locked by the B5 invariant tests in
		// event-breakdown.test.js).
		let genericBuckets = buckets;
		if (config.type === 'eventBreakdown' && config.firstTimeOnly) {
			const firsts = filterFirstTimeEver(events, { event: config.event, identityMap });
			genericBuckets = partitionByTimeBucket(firsts, config.timeBucket, range);
			inner.firstTimeOnly = false;
		}

		for (const { period, events: evs } of genericBuckets) {
			const rows = emulateBreakdown(evs, inner);
			if (rows.length) {
				for (const r of rows) out.push({ period, ...r });
			} else {
				out.push({ period, _empty: true });
			}
		}
		return out;
	}

	const cfg = identityMap ? { ...config, identityMap } : config;
	switch (config.type) {
		case 'frequencyByFrequency': return frequencyByFrequency(events, /** @type {*} */ (cfg));
		case 'funnelFrequency':      return funnelFrequency(events, /** @type {*} */ (cfg));
		case 'aggregatePerUser':     return aggregatePerUser(events, /** @type {*} */ (cfg));
		case 'timeToConvert':        return timeToConvert(events, /** @type {*} */ (cfg));
		case 'attributedBy':         return attributedBy(events, /** @type {*} */ (cfg));
		case 'sessionMetrics':       return sessionMetrics(events, /** @type {*} */ (cfg));
		case 'retention':            return retention(events, /** @type {*} */ (cfg));
		case 'distinctCount':        return distinctCount(events, /** @type {*} */ (cfg));
		case 'eventBreakdown':       return eventBreakdown(events, /** @type {*} */ (cfg));
		case 'uniques':              return uniques(events, /** @type {*} */ (cfg));
		case 'lifecycle':            return lifecycle(events, /** @type {*} */ (cfg));
		case 'topPaths':             return topPaths(events, /** @type {*} */ (cfg));
		default: throw new Error(`emulateBreakdown: unknown type "${config.type}"`);
	}
}

// ── Frequency × Frequency (Insights, Frequency Distribution by per-user count of B) ──
//
// Both axes are DISTINCT PERIOD counts (default: days), not raw event counts.
// Reference: addiction_query.cpp — see counting.js#countDistinctPeriods for
// the rule and why it matters.

function frequencyByFrequency(events, { metricEvent, breakdownByFrequencyOf, periodUnit = 'day', identityMap }) {
	if (!metricEvent || !breakdownByFrequencyOf) {
		throw new Error('frequencyByFrequency requires metricEvent and breakdownByFrequencyOf');
	}
	const userEvents = groupByUser(events, identityMap);
	const cell = new Map(); // `${m}|${b}` → user_count
	for (const [, evs] of userEvents) {
		const m = countDistinctPeriods(evs, metricEvent, /** @type {*} */ (periodUnit));
		const b = countDistinctPeriods(evs, breakdownByFrequencyOf, /** @type {*} */ (periodUnit));
		const key = `${m}|${b}`;
		cell.set(key, (cell.get(key) || 0) + 1);
	}
	return [...cell.entries()].map(([k, count]) => {
		const [m, b] = k.split('|').map(Number);
		return { metric_freq: m, breakdown_freq: b, user_count: count };
	}).sort((x, y) => x.breakdown_freq - y.breakdown_freq || x.metric_freq - y.metric_freq);
}

// ── Funnel Frequency Breakdown (Funnel report broken down by per-user count of X) ──
//
// Step progression uses the greedy single-pass funnel engine
// (funnel-engine.js → history.cpp). Cohort breakdown axis uses distinct-period
// counting (addiction_query.cpp).
//
// v1.6.0 (P1.6.4): rows carry an `excluded` column — histories terminated by
// an exclusion step tally at step_index = the boundary they failed to cross
// (ARB `fr->excluded[reached + 1]`, funnel_query.cpp:3422; uniques variant
// `fr->excluded_uniques[reached + 1]`, :3337). A boundary with exclusions but
// zero conversions still emits a row.

function funnelFrequency(events, { steps, breakdownByFrequencyOf, conversionWindowMs, conversionWindow, periodUnit = 'day', funnelOrder = 'sequential', identityMap, reentry, exclusionSteps, trackStepProperties, sessionScoped, countMode, holdPropertyConstant, anchorRange }) {
	if (!Array.isArray(steps) || !steps.length) throw new Error('funnelFrequency requires steps[]');
	if (!breakdownByFrequencyOf) throw new Error('funnelFrequency requires breakdownByFrequencyOf');

	// v1.6.0 (findings #15): countMode 'totals'/'sessions' and holdPropertyConstant
	// route to the greedy single-pass primitives directly — attempt histories and
	// HPC sub-funnels have no analog in the any-order completion modes.
	const isSequentialOrder = funnelOrder === 'sequential' || funnelOrder === 'interrupt' || funnelOrder === 'interrupted';
	const isTotalsMode = countMode === 'totals' || countMode === 'sessions';
	if ((isTotalsMode || holdPropertyConstant) && !isSequentialOrder) {
		throw new Error(`funnelFrequency: countMode '${countMode}' / holdPropertyConstant require a sequential funnel order (got '${funnelOrder}')`);
	}
	// HPC buckets events by property value BEFORE evaluation (evaluateFunnelHPC),
	// but Mixpanel derives session boundaries from the user's FULL event stream —
	// sessionizing each bucket independently would merge across the gaps left by
	// removed events and produce wrong ordinals. Refuse rather than mis-count.
	if (holdPropertyConstant && (countMode === 'sessions' || conversionWindow)) {
		throw new Error('funnelFrequency: holdPropertyConstant cannot combine with session-count conversion windows — session boundaries derive from the full event stream, but HPC evaluates per-property-value event subsets');
	}

	const userEvents = groupByUser(events, identityMap);
	const result = [];
	const conversions = new Map(); // `${stepIdx}|${b}` → count
	const excludedCounts = new Map(); // `${stepIdx}|${b}` → count (stepIdx = excludedAtStep)
	const funnelOpts = { conversionWindowMs, conversionWindow, countMode, reentry, exclusionSteps, trackStepProperties, sessionScoped, anchorRange };
	for (const [, evs] of userEvents) {
		// Frequency axis: under a trend interval (anchorRange set by the
		// timeBucket wrapper) count only in-interval events — spill events past
		// the bucket edge exist solely for later-step matching, not the cohort
		// axis (which would otherwise shift users between frequency cohorts
		// depending on the conversion window length).
		const axisEvs = anchorRange
			? evs.filter(e => {
				const t = toMs(e && e.time);
				return Number.isFinite(t)
					&& (anchorRange.fromMs == null || t >= anchorRange.fromMs)
					&& (anchorRange.toMs == null || t < anchorRange.toMs);
			})
			: evs;
		const b = countDistinctPeriods(axisEvs, breakdownByFrequencyOf, /** @type {*} */ (periodUnit));
		// One entry per credited history: uniques = the user's single (or best-
		// across-HPC-values) progression; totals/sessions = every attempt.
		/** @type {number[]} */
		const reachedList = [];
		// v1.6.0 (P1.6.4): exclusion boundary indexes (= reached + 1 of a
		// terminated history) — ARB counts them per step slot:
		// `fr->excluded[reached + 1]` (funnel_query.cpp:3422, totals) /
		// `fr->excluded_uniques[reached + 1]` (funnel_query.cpp:3337, uniques).
		/** @type {number[]} */
		const excludedList = [];
		if (holdPropertyConstant) {
			const perValue = evaluateFunnelHPC(evs, steps, holdPropertyConstant, funnelOpts);
			if (isTotalsMode) {
				// Every attempt in every value bucket counts (totals semantics).
				for (const r of perValue.values()) {
					for (const a of /** @type {Array<*>} */ (r)) {
						reachedList.push(a.reached);
						if (a.terminatedByExclusion) excludedList.push(a.excludedAtStep);
					}
				}
			} else {
				// Uniques: per-step distinct-user counting over parallel histories.
				// A user appears at step s when ANY value thread reached ≥ s, and
				// progression is contiguous from 0 — so the union of credited steps
				// is 0..max(reached). Credit the user ONCE at the furthest thread.
				let best = -1;
				let bestExcluded = false;
				for (const r of perValue.values()) {
					const reached = /** @type {*} */ (r).reached;
					if (reached > best) {
						best = reached;
						bestExcluded = !!(/** @type {*} */ (r).terminatedByExclusion);
					} else if (reached === best && /** @type {*} */ (r).terminatedByExclusion) {
						// ARB-UNCERTAIN: HPC exclusion uniques. Conservative reading —
						// the user counts as excluded when ANY furthest-reaching value
						// thread was terminated by exclusion (each per-value history
						// aggregates independently in ARB; per-user dedup across
						// threads at the same boundary is our distinct-user layer).
						bestExcluded = true;
					}
				}
				if (best >= 0) {
					reachedList.push(best);
					if (bestExcluded) excludedList.push(best + 1);
				}
			}
		} else if (isTotalsMode) {
			const attempts = /** @type {Array<*>} */ (evaluateFunnel(evs, steps, funnelOpts));
			for (const a of attempts) {
				reachedList.push(a.reached);
				if (a.terminatedByExclusion) excludedList.push(a.excludedAtStep);
			}
		} else {
			// v1.5: dispatch on funnel.order so non-sequential modes don't return 0% trivially.
			const r = evaluateFunnelByOrder(evs, steps, { conversionWindowMs, conversionWindow, funnelOrder, reentry, exclusionSteps, trackStepProperties, sessionScoped, anchorRange });
			reachedList.push(r.reached);
			if (/** @type {*} */ (r).terminatedByExclusion) excludedList.push(/** @type {*} */ (r).excludedAtStep);
		}
		for (const reached of reachedList) {
			for (let s = 0; s <= reached; s++) {
				const key = `${s}|${b}`;
				conversions.set(key, (conversions.get(key) || 0) + 1);
			}
		}
		for (const s of excludedList) {
			const key = `${s}|${b}`;
			excludedCounts.set(key, (excludedCounts.get(key) || 0) + 1);
		}
	}
	const rowKeys = new Set([...conversions.keys(), ...excludedCounts.keys()]);
	for (const key of rowKeys) {
		const [s, b] = key.split('|').map(Number);
		result.push({
			step: steps[s], step_index: s, breakdown_freq: b,
			conversions: conversions.get(key) || 0, conversion_pct: 0,
			excluded: excludedCounts.get(key) || 0,
		});
	}
	// Conversion % at each step relative to its own breakdown_freq's step-0 baseline.
	const baseline = new Map();
	for (const r of result) {
		if (r.step_index === 0) baseline.set(r.breakdown_freq, r.conversions);
	}
	for (const r of result) {
		const denom = baseline.get(r.breakdown_freq) || 0;
		r.conversion_pct = denom ? (r.conversions / denom) * 100 : 0;
	}
	return result.sort((a, b) => a.step_index - b.step_index || a.breakdown_freq - b.breakdown_freq);
}

// ── Aggregate per user (Insights, sum/avg of property X by per-user count of B) ──
//
// AVG/SUM/MIN/MAX use null-aware aggregation (normal_query.cpp). The cohort
// breakdown axis uses distinct-period counting.

function aggregatePerUser(events, { event, property, agg = 'avg', breakdownByFrequencyOf, periodUnit = 'day', identityMap }) {
	if (!event) throw new Error('aggregatePerUser requires event');
	if (!breakdownByFrequencyOf) throw new Error('aggregatePerUser requires breakdownByFrequencyOf');
	if (agg !== 'count' && !property) throw new Error('aggregatePerUser requires property unless agg is "count"');
	const userEvents = groupByUser(events, identityMap);
	const userAgg = new Map();
	const userBreakdown = new Map();
	for (const [uid, evs] of userEvents) {
		const matches = evs.filter(e => e && e.event === event);
		let aggValue;
		if (agg === 'count') {
			aggValue = matches.length;
		} else {
			const values = matches.map(e => e[property]);
			aggValue = applyNullAwareAgg(values, agg);
		}
		// Skip users with no aggregate (no matching events for count==0 still
		// counted; numeric agg returning null means no numeric values).
		if (aggValue !== null && aggValue !== undefined) {
			userAgg.set(uid, aggValue);
		}
		userBreakdown.set(uid, countDistinctPeriods(evs, breakdownByFrequencyOf, /** @type {*} */ (periodUnit)));
	}
	const buckets = new Map(); // breakdown_freq → [aggregates]
	for (const [uid, v] of userAgg) {
		const b = userBreakdown.get(uid) || 0;
		if (!buckets.has(b)) buckets.set(b, []);
		buckets.get(b).push(v);
	}
	// Cohort-level rollup: Mixpanel "Aggregate per user" report applies the
	// SAME `agg` mode at the cohort level (e.g. SUM-mode shows sum-of-sums,
	// MAX-mode shows max-of-maxes). We expose all of them so consumers can
	// pick the column that matches the report they're verifying:
	//   - `avg_aggregate` — mean of per-user aggregates (always available)
	//   - `cohort_sum` / `cohort_min` / `cohort_max` — same `agg` applied across users
	return [...buckets.entries()].map(([b, vs]) => {
		const sum = vs.reduce((a, x) => a + x, 0);
		const row = {
			breakdown_freq: b,
			user_count: vs.length,
			avg_aggregate: sum / vs.length,
		};
		if (agg === 'sum' || agg === 'count') {
			row.cohort_sum = sum;
		} else if (agg === 'min') {
			row.cohort_min = vs.reduce((a, x) => x < a ? x : a, Infinity);
		} else if (agg === 'max') {
			row.cohort_max = vs.reduce((a, x) => x > a ? x : a, -Infinity);
		}
		return row;
	}).sort((x, y) => x.breakdown_freq - y.breakdown_freq);
}

// ── Time to Convert (Funnel TTC, broken down by user property) ──
//
// Steps matched via the greedy funnel engine (history.cpp). v1.6.0 (P1.6.7)
// aligns the arithmetic with ARB's funnel aggregation
// (funnel_query.cpp:3355-3380) and extends past 2-step pairs: pass `steps`
// (>= 2 entries, funnelOrder/exclusions apply) or keep the
// `fromEvent`/`toEvent` pair sugar.
//
// Output per segment row (rows are emitted for segments with >= 1 full
// conversion — the TTC chart is a converted-users report):
//   - avg_ttc_ms / median_ttc_ms — over converted users; ttcMs is `$ttc` at
//     ms resolution (MAX over slot times − position-0 time,
//     history.cpp:914-918).
//   - avg_ttc_s — mean of the integer-second `$ttc` values (floor'd per user
//     BEFORE averaging, matching the computed property's resolution).
//   - step_counts[i] — attempts that reached position i, drop-offs included
//     (fr->counts, funnel_query.cpp:3362 — the loop runs for every history).
//   - gap_avg_s[g] / cumulative_avg_s[g] — sum_deltas[i]/counts[i] and
//     sum_deltas_from_start[i]/counts[i] for position i = g+1
//     (funnel_query.cpp:3374-3380): per-gap deltas are integer seconds
//     clamped to 0 per gap; the cumulative track sums the CLAMPED deltas.
//     `null` when no attempt reached that position.

function timeToConvert(events, { fromEvent, toEvent, steps: stepsOpt, breakdownByUserProperty, profiles = [], funnelOrder = 'sequential', conversionWindowMs, identityMap, reentry, exclusionSteps, sessionScoped, anchorRange }) {
	let steps;
	if (Array.isArray(stepsOpt) && stepsOpt.length) {
		if (fromEvent || toEvent) throw new Error('timeToConvert takes either steps[] or fromEvent/toEvent, not both');
		if (stepsOpt.length < 2) throw new Error('timeToConvert steps[] needs at least 2 steps');
		steps = stepsOpt;
	} else {
		if (!fromEvent || !toEvent) throw new Error('timeToConvert requires fromEvent and toEvent (or steps[])');
		steps = [fromEvent, toEvent];
	}
	const numSteps = steps.length;
	const userEvents = groupByUser(events, identityMap);
	const profileByUid = new Map();
	for (const p of profiles) {
		if (!p) continue;
		const uid = p.distinct_id || p.user_id;
		if (uid) profileByUid.set(uid, p);
	}
	// segValue → { ttcs, ttcSecs, counts, sumGap, sumCum }
	const buckets = new Map();
	const acc = (segValue) => {
		if (!buckets.has(segValue)) buckets.set(segValue, {
			ttcs: [], ttcSecs: [],
			counts: new Array(numSteps).fill(0),
			sumGap: new Array(numSteps - 1).fill(0),
			sumCum: new Array(numSteps - 1).fill(0),
		});
		return buckets.get(segValue);
	};
	for (const [uid, evs] of userEvents) {
		// v1.5: respect funnel.order. middle-fixed stays set-membership
		// (verificationKind 'partial') — no gap arrays there.
		const r = evaluateFunnelByOrder(evs, steps, { funnelOrder, conversionWindowMs, reentry, exclusionSteps, sessionScoped, anchorRange });
		const profile = profileByUid.get(uid);
		const segValue = breakdownByUserProperty
			? (profile ? (profile[breakdownByUserProperty] ?? 'unknown') : 'unknown')
			: 'all';
		const a = acc(segValue);
		// funnel_query.cpp:3359-3380 — EVERY attempt (converted or not)
		// records counts[i] for i <= reached and gap sums for 1 <= i <= reached.
		if (typeof r.reached === 'number' && r.reached >= 0 && Array.isArray(r.gapSeconds)) {
			for (let p = 0; p <= r.reached && p < numSteps; p++) a.counts[p]++;
			for (let g = 0; g < r.gapSeconds.length && g < numSteps - 1; g++) {
				a.sumGap[g] += r.gapSeconds[g];
				a.sumCum[g] += r.gapSecondsFromStart[g];
			}
		}
		if (!r.completed || r.ttcMs === null || !Number.isFinite(r.ttcMs) || r.ttcMs < 0) continue;
		a.ttcs.push(r.ttcMs);
		// $ttc is integer seconds (history.cpp:917-918); middle-fixed partial
		// results carry no ttcSeconds — floor their informational ttcMs.
		a.ttcSecs.push(typeof r.ttcSeconds === 'number' ? r.ttcSeconds : Math.floor(r.ttcMs / 1000));
	}
	return [...buckets.entries()]
		.filter(([, a]) => a.ttcs.length > 0)
		.map(([seg, a]) => ({
			segment_value: seg,
			user_count: a.ttcs.length,
			avg_ttc_ms: a.ttcs.reduce((x, y) => x + y, 0) / a.ttcs.length,
			median_ttc_ms: median(a.ttcs),
			avg_ttc_s: a.ttcSecs.reduce((x, y) => x + y, 0) / a.ttcSecs.length,
			step_counts: a.counts,
			gap_avg_s: a.sumGap.map((s, g) => a.counts[g + 1] > 0 ? s / a.counts[g + 1] : null),
			cumulative_avg_s: a.sumCum.map((s, g) => a.counts[g + 1] > 0 ? s / a.counts[g + 1] : null),
		}))
		.sort((x, y) => String(x.segment_value).localeCompare(String(y.segment_value)));
}

// ── Attributed By (first-/last-touch attribution by event property value) ──
//
// NO touchpoint cap for FIRST/LAST models. `TOUCHPOINTS_LIMIT = 10`
// (backend/libquery/properties_over_time/attributed_value_reader.cpp:16)
// rides in whoval_reader_params on every read, but the FIRST/LAST paths
// execute hard-`LIMIT 1` statements (whoval/read.cpp:173-192 first_stmt_,
// :643-655 get_first/last_value) — only `sorted_list_stmt_` (`LIMIT ?4`,
// read.cpp:595, get_list_values :681-685) consumes the cap, and that
// statement serves multi-touch list models (LINEAR/PARTICIPATION/
// TIME_DECAY) this emulator doesn't implement. FIRST = globally first
// touch in the lookback window, however many touches precede it.
//
// Per-conversion semantics: Mixpanel runs attribution once PER conversion
// event — `attributed_value_reader_read` takes a single `event_time_ms` and
// builds a fresh lookback read ending at that conversion.
// `perConversion: 'all'` matches that; the default `'first'` keeps the v1.5
// one-conversion-per-user behavior for back-compat.
//
// ⚠ TOUCHPOINT SEAM (findings #2, closed-as-documented): the GENERATOR
// samples which events get UTM stamps uniformly across a user's lifetime
// (maxTouchpointsPerUser sampling in lib/orchestrators/user-loop.js —
// `sampled across lifetime`), while this verifier and Mixpanel both read
// touchpoints BEFORE each conversion. A user with more eligible events
// than the generator cap can have touches that never got stamped — and
// stamped touches can postdate every conversion. Divergence is
// theoretical below ~10 eligible events per user (the generator cap);
// attribution-engineering hooks should OVERWRITE engine-stamped UTMs near
// the conversion rather than relying on the lifetime-uniform sampling
// (hook rule 10, CLAUDE.md).

function attributedBy(events, {
	conversionEvent,
	attributionEvent,
	attributionProperty,
	model = 'firstTouch',
	perConversion = 'first',
	identityMap,
}) {
	if (!conversionEvent || !attributionEvent || !attributionProperty) {
		throw new Error('attributedBy requires conversionEvent, attributionEvent, attributionProperty');
	}
	if (perConversion !== 'first' && perConversion !== 'all') {
		throw new Error(`attributedBy: unknown perConversion "${perConversion}" — use 'first' or 'all'`);
	}
	const userEvents = groupByUser(events, identityMap);
	const counts = new Map();
	for (const [, evs] of userEvents) {
		const sorted = sortByTime(evs);
		const conversions = perConversion === 'all'
			? sorted.filter(e => e && e.event === conversionEvent)
			: sorted.filter(e => e && e.event === conversionEvent).slice(0, 1);
		for (const conversion of conversions) {
			const conversionTime = toMs(conversion.time);
			const allTouches = sorted.filter(e =>
				e && e.event === attributionEvent && toMs(e.time) <= conversionTime
			);
			if (!allTouches.length) continue;
			const touch = model === 'lastTouch' ? allTouches[allTouches.length - 1] : allTouches[0];
			const v = touch[attributionProperty] ?? 'unknown';
			counts.set(v, (counts.get(v) || 0) + 1);
		}
	}
	return [...counts.entries()].map(([source, count]) => ({
		attribution_value: source,
		conversions: count,
	})).sort((a, b) => b.conversions - a.conversions);
}

// ── Retention (birth-anchored buckets) ───────────────────────────────────────
//
// Reference: backend/arb/reader/queries/retention_query.cpp
//
// Bucketing rule (retention_query.cpp:1258-1262):
//   time_to_retention_event_s = retention_event_time_s - aligned_birth_time_s
//   bucket = floor(time_to_retention_event_s / bucket_seconds)
// Bucket seconds per unit (libquery/time/unit.c:5-16 + libquery/util.h:265-273):
//   hour = 3600s, day = 86400s, week = 7d, month = 31d FIXED ("maximum
//   possible seconds in a month" — NOT calendar months).
//
// Birth-vs-return gate (retention_query.cpp:1120-1139,
// retention_query_event_occurs_after_birth — cites COR-233):
//   `<=` applies ONLY when birthCanRetain AND the return event ALSO matches
//   the birth filter (`matches_first`). Distinct birth/return events at the
//   same ms stay strictly `<` even with birthCanRetain: true. The gate reads
//   the RAW birth time — calendar alignment applies only inside the bucket
//   delta (retention_query_get_aligned_event_time_s at :1260).
//
// Compounded (retention_query.cpp:677-685): `rq->second = rq->first` — the
// return side IS the cohort side, so every cohort event is a return
// candidate ("DAU coming back").
//
// Unbounded modes:
//   carryForward — read-time carry (:1854-1868): retained at N if active in
//     ANY bucket ≤ N.
//   carryBack — reverse-iteration carry (:274-278): retained at N if active
//     in ANY bucket ≥ N.
//   consecutiveForward — gated at WRITE time (:1275-1287): seen_in[N] is
//     written only if seen_in[N−1] is already set (except N = 0). Since a
//     user's returns arrive time-ordered, the surviving marks are exactly
//     the maximal consecutive prefix {0..k} of buckets hit.
//
// calendarStart (retention_query.cpp:312-332, applied to the birth at :1260):
//   ARB steps in fixed unit_s increments from the query interval start;
//   production intervals start on unit boundaries, so the effect is flooring
//   the BIRTH time to the bucket-unit boundary (week = ISO Monday, matching
//   partitionByTimeBucket) before computing deltas. Month alignment floors to
//   the calendar month start while the bucket WIDTH stays 31d fixed.
//
// Internal-event ignore list (retention_query.cpp:2546-2555): when a side has
// no explicit event selector (null / '$any_event'), $campaign_delivery,
// $campaign_bounced, $create_alias, $identify, $merge are ignored for that
// side. Explicit selectors bypass the list.
//
// segmentOn 'return' (SEGMENT_EVENT_SECOND, retention_query.cpp:1421-1444):
// the segment value is read from each RETURN event; a user joins a segment's
// cohort only via a qualifying return in that segment — births are
// unsegmented unless birthCanRetain lets the birth itself qualify as a
// return (:1413-1419). ARB reads profile/SCD-style segment properties as-of
// the BIRTH time even in this mode (:1421-1444); this emulator segments on
// flat event properties only, so that read-path does not arise here.
//
// Unrecognized option keys THROW (1.6.0 behavior change — kills the
// silent-ignore class of bug where e.g. `compounded: true` was dropped).
//
// timeBucket composition caveat: the generic wrapper partitions EVENTS, so
// returns crossing a bucket edge are truncated. P1.6.5 re-anchors retention
// buckets on the BIRTH event time.

const RETENTION_UNIT_MS = {
	hour: 3600 * 1000,
	day: 86400 * 1000,
	week: 7 * 86400 * 1000,
	// "Maximum possible seconds in a month" — libquery/util.h:265-273.
	month: 31 * 86400 * 1000,
};

const RETENTION_IGNORED_INTERNAL = new Set([
	'$campaign_delivery', '$campaign_bounced', '$create_alias', '$identify', '$merge',
]);

const RETENTION_KNOWN_KEYS = new Set([
	'type', 'profiles', 'identityMap', 'timeBucket', 'timeBucketRange',
	'cohortEvent', 'returnEvent', 'cohortWhere', 'returnWhere', 'compounded',
	'dayBuckets', 'bucketUnit', 'unbounded', 'carry_forward', 'bucketAlignment',
	'cohortWindow', 'segmentBy', 'segmentOn', 'birthCanRetain',
]);

/**
 * Does event `e` match one side (cohort or return) of the retention query?
 * `sideEvent` null / '$any_event' = any event EXCEPT the internal ignore
 * list (retention_query.cpp:2546-2555 — only applies when the side has no
 * explicit selectors).
 */
function retentionSideMatches(e, sideEvent, sideWhere) {
	if (sideEvent == null || sideEvent === '$any_event') {
		if (RETENTION_IGNORED_INTERNAL.has(e.event)) return false;
	} else if (e.event !== sideEvent) {
		return false;
	}
	return matchesWhere(e, sideWhere);
}

/**
 * Floor `ms` to the start of its bucket unit (UTC). Week = ISO Monday,
 * matching partitionByTimeBucket; month = calendar month start.
 */
function retentionFloorToUnit(ms, unit) {
	const DAY = RETENTION_UNIT_MS.day;
	switch (unit) {
		case 'hour': return ms - (ms % RETENTION_UNIT_MS.hour);
		case 'day': return ms - (ms % DAY);
		case 'week': {
			const dayStart = ms - (ms % DAY);
			const dow = new Date(dayStart).getUTCDay(); // 0 = Sunday
			return dayStart - ((dow + 6) % 7) * DAY;    // back to ISO Monday
		}
		case 'month': {
			const d = new Date(ms);
			return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
		}
		default: throw new Error(`retention: unknown bucketUnit "${unit}"`);
	}
}

function retention(events, cfg) {
	// Strict option keys — unknown keys were previously silently ignored
	// (declared 1.6.0 behavior change).
	for (const k of Object.keys(cfg)) {
		if (!RETENTION_KNOWN_KEYS.has(k)) {
			throw new Error(`retention: unrecognized option "${k}" (known: ${[...RETENTION_KNOWN_KEYS].join(', ')})`);
		}
	}

	const {
		cohortEvent = null,
		cohortWhere,
		compounded = false,
		dayBuckets = [1, 7, 14, 30],
		bucketUnit = 'day',
		bucketAlignment = 'birth',
		cohortWindow,
		segmentBy,
		segmentOn = 'birth',
		birthCanRetain = false,
		identityMap,
	} = cfg;

	if (!('cohortEvent' in cfg)) {
		throw new Error('retention requires cohortEvent (null or "$any_event" = any event)');
	}

	// Compounded: return side := cohort side (retention_query.cpp:677-685).
	let returnEvent, returnWhere;
	if (compounded) {
		if ('returnEvent' in cfg && cfg.returnEvent !== cohortEvent) {
			throw new Error('retention: compounded sets returnEvent := cohortEvent — remove the conflicting returnEvent');
		}
		// Same guard for returnWhere (fix-round nit 4): `rq->second = rq->first`
		// replaces the WHOLE return side, filters included — a conflicting
		// returnWhere would be silently discarded, the exact silent-ignore bug
		// class the strict-keys throw exists to kill.
		if ('returnWhere' in cfg && cfg.returnWhere !== cohortWhere) {
			throw new Error('retention: compounded sets returnWhere := cohortWhere — remove the conflicting returnWhere');
		}
		returnEvent = cohortEvent;
		returnWhere = cohortWhere;
	} else {
		if (!('returnEvent' in cfg)) {
			throw new Error('retention requires returnEvent (or compounded: true)');
		}
		returnEvent = cfg.returnEvent;
		returnWhere = cfg.returnWhere;
	}

	if (!Array.isArray(dayBuckets) || !dayBuckets.length) {
		throw new Error('retention requires non-empty dayBuckets');
	}
	// Write horizon: the highest queried bucket index (see the bounds check
	// at the mark loop — retention_query.cpp:1264).
	const maxQueriedBucket = Math.max(...dayBuckets);

	const unitMs = RETENTION_UNIT_MS[bucketUnit];
	if (!unitMs) {
		throw new Error(`retention: unknown bucketUnit "${bucketUnit}" (hour|day|week|month)`);
	}

	// `carry_forward` boolean is the deprecated alias for unbounded: 'carryForward'.
	let unbounded = cfg.unbounded;
	if (unbounded === undefined) unbounded = cfg.carry_forward ? 'carryForward' : 'none';
	if (!['none', 'carryForward', 'carryBack', 'consecutiveForward'].includes(unbounded)) {
		throw new Error(`retention: unknown unbounded mode "${unbounded}" (none|carryForward|carryBack|consecutiveForward)`);
	}

	if (bucketAlignment !== 'birth' && bucketAlignment !== 'calendarStart') {
		throw new Error(`retention: unknown bucketAlignment "${bucketAlignment}" (birth|calendarStart)`);
	}
	if (segmentOn !== 'birth' && segmentOn !== 'return') {
		throw new Error(`retention: unknown segmentOn "${segmentOn}" (birth|return)`);
	}

	let windowFromMs = -Infinity, windowToMs = Infinity;
	if (cohortWindow != null) {
		windowFromMs = toMs(cohortWindow.from);
		windowToMs = toMs(cohortWindow.to);
		if (!Number.isFinite(windowFromMs) || !Number.isFinite(windowToMs)) {
			throw new Error('retention: cohortWindow requires { from, to } timestamps');
		}
	}

	const segmentedOnReturn = segmentOn === 'return' && !!segmentBy;
	const userEvents = groupByUser(events, identityMap);

	// segment → cohort users + per-user retained-bucket marks
	const cohorts = new Map();
	const ensureSegment = (seg) => {
		if (!cohorts.has(seg)) cohorts.set(seg, { users: new Set(), markedByUser: new Map() });
		return cohorts.get(seg);
	};

	for (const [uid, evs] of userEvents) {
		// Birth = earliest event matching the cohort side.
		const sorted = sortByTime(evs);
		let birth = null;
		for (const e of sorted) {
			if (retentionSideMatches(e, cohortEvent, cohortWhere)) { birth = e; break; }
		}
		if (!birth) continue;
		const birthMs = toMs(birth.time);
		if (!Number.isFinite(birthMs)) continue;
		// Cohort window: birth must land inside [from, to] (inclusive).
		if (birthMs < windowFromMs || birthMs > windowToMs) continue;

		const alignedBirthMs = bucketAlignment === 'calendarStart'
			? retentionFloorToUnit(birthMs, bucketUnit)
			: birthMs;

		// Collect this user's retained-bucket marks. Under segmentOn 'return'
		// each segment gets its own mark set (returns partition by their own
		// property value); otherwise one set under the birth-derived segment.
		const markedBySeg = new Map();
		const markSetFor = (seg) => {
			if (!markedBySeg.has(seg)) markedBySeg.set(seg, new Set());
			return markedBySeg.get(seg);
		};
		const birthSeg = segmentedOnReturn ? null
			: (segmentBy ? (birth[segmentBy] ?? 'unknown') : 'all');

		for (const e of sorted) {
			if (!retentionSideMatches(e, returnEvent, returnWhere)) continue;
			const evMs = toMs(e.time);
			if (!Number.isFinite(evMs)) continue;
			// COR-233 gate: `<=` only when birthCanRetain AND this return also
			// matches the birth filter; raw (unaligned) birth time.
			const matchesFirst = retentionSideMatches(e, cohortEvent, cohortWhere);
			const passes = (birthCanRetain && matchesFirst) ? (birthMs <= evMs) : (birthMs < evMs);
			if (!passes) continue;
			const bucket = Math.floor((evMs - alignedBirthMs) / unitMs);
			if (bucket < 0) continue;
			// Write horizon (fix-round nit 3): ARB bounds-checks every write
			// against the queried bucket count — `bucket_index <
			// time_duration_buckets_num_buckets` (retention_query.cpp:1264) —
			// so a return past the last queried bucket is never recorded in
			// ANY mode. Without this, carryBack ("active in any bucket ≥ N")
			// would let an out-of-horizon return retro-mark every queried row.
			if (bucket > maxQueriedBucket) continue;
			const marked = markSetFor(segmentedOnReturn ? (e[segmentBy] ?? 'unknown') : birthSeg);
			// consecutiveForward write gate (retention_query.cpp:1275-1287):
			// bucket N marks only if N−1 already marked (except N = 0). Returns
			// arrive time-ordered, so marks form the maximal consecutive prefix.
			if (unbounded === 'consecutiveForward' && bucket !== 0 && !marked.has(bucket - 1)) continue;
			marked.add(bucket);
		}

		if (segmentedOnReturn) {
			// Births are unsegmented under segmentOn 'return' — a user joins a
			// segment's cohort only via a qualifying return in that segment
			// (retention_query.cpp:1413-1419; birthCanRetain lets the birth
			// itself qualify when it matches the return side).
			for (const [seg, marked] of markedBySeg) {
				const sb = ensureSegment(seg);
				sb.users.add(uid);
				sb.markedByUser.set(uid, marked);
			}
		} else {
			const sb = ensureSegment(birthSeg);
			sb.users.add(uid);
			sb.markedByUser.set(uid, markedBySeg.get(birthSeg) || new Set());
		}
	}

	const out = [];
	for (const [seg, sb] of cohorts) {
		const cohortSize = sb.users.size;
		for (const day of dayBuckets) {
			let retained = 0;
			for (const uid of sb.users) {
				const marked = sb.markedByUser.get(uid);
				if (!marked || !marked.size) continue;
				let hit = false;
				if (unbounded === 'carryForward') {
					// Read-time carry (:1854-1868): active in ANY bucket ≤ N.
					for (const b of marked) { if (b <= day) { hit = true; break; } }
				} else if (unbounded === 'carryBack') {
					// Reverse-iteration carry (:274-278): active in ANY bucket ≥ N.
					for (const b of marked) { if (b >= day) { hit = true; break; } }
				} else {
					// 'none' + 'consecutiveForward' (write-gated) read membership.
					hit = marked.has(day);
				}
				if (hit) retained++;
			}
			out.push({
				day,
				retained_count: retained,
				cohort_size: cohortSize,
				retained_pct: cohortSize ? retained / cohortSize : 0,
				segment: seg,
			});
		}
	}
	out.sort((a, b) => String(a.segment).localeCompare(String(b.segment)) || a.day - b.day);
	return out;
}

// ── Session Metrics (Mixpanel session report) ────────────────────────────────
//
// Reference: backend/arb/reader/queries/session_query.cpp.
//
// Mixpanel computes sessions at QUERY TIME (30-min gap default + 24h max +
// UTC day-boundary split) — sessions are never stored. v1.6.0 (P1.7.2)
// aligns: `source: 'derived'` (default) re-derives sessions from timestamps
// via sessionize(); `source: 'stamped'` keeps the v1.5 behavior of trusting
// generator-stamped `session_id` (events without one are excluded there).
// Declared v1.6.0 behavior change: the default no longer reads session_id
// at all, so unstamped events now participate.
//
// When any event carries a stamped session_id, every row also reports
// `stampedDivergence`: the number of events whose stamped session BOUNDARY
// disagrees with the derived one — event i (per user, time-sorted) diverges
// when `stamped(i) === stamped(i-1)` and `derived(i) === derived(i-1)`
// disagree. Pairs where either event lacks a stamp are skipped (no boundary
// to compare). This makes the generator-vs-query-time seam measurable.
//
// Returns an array with one row per requested metric:
//   [{ metric: 'count',           avg, median, p90, total_sessions, source, stampedDivergence }]
//   [{ metric: 'duration',        avg_ms, median_ms, p90_ms, total_sessions, source, stampedDivergence }]
//   [{ metric: 'eventsPerSession',avg, median, p90, total_sessions, source, stampedDivergence }]

// ── COUNT_DISTINCT(property) — v1.5.1 ─────────────────────────────────────
//
// Mixpanel Insights `COUNT_DISTINCT(prop)` aggregator. Returns the count of
// unique values of a flat property across events, plus the top-N most-frequent
// values. Optionally filtered to a single event name.
//
// Schema contract (HOOKS.md §1): properties are FLAT on event records —
// `e.utm_campaign`, not `e.properties.utm_campaign`. Dot-path support deferred.
//
// Returns a single row: `{ distinct_count, top_values: [{ value, count }] }`.

function distinctCount(events, { property, event, topN = 25 }) {
	if (!property) throw new Error('distinctCount requires `property`');
	const result = countDistinctValues(events, property, { event, topN });
	return [result];
}

// ── Event Breakdown (Insights: TOTAL events segmented by a property) ──
//
// The most common Mixpanel report shape: count of EVENTS per property value
// (not per-user grouping — that's aggregatePerUser). Semantics from
// normal_query.cpp ACTION_TYPE_FOR_EACH (:1718-1776) + coerce.js rulebooks:
//
//   - List-valued property → the event counts once PER list item (an event
//     with ["a","b"] increments both segments; recursion in
//     query_record_result over list_cursor items).
//   - Empty list → literal segment "$empty_list" (normal_query.cpp:1762
//     value_create_string("$empty_list")).
//   - null AND undefined both → the "undefined" bucket (string-typecast
//     default, arb_selector.py:889-916; normal_query.cpp:1769-1773 routes
//     VALUE_TYPE_UNDEFINED|NULL to the undefined inner action).
//   - Segment identity is case-SENSITIVE and type-tagged (hash_value.c raw
//     XXH3 string hash + per-type tag mixins; cmp.c arb_strcmp) — "iOS" and
//     "ios" are separate rows; number 1 and string "1" are separate rows.
//   - Sort count desc, keep top `topN` (default 250 — normal_query.cpp
//     :1195-1197 "If no meaningful limit is supplied, set it to 250"), and
//     TRUNCATE: no "other" rollup bucket (query_set_top_results marks the top
//     N leaf results; the rest simply don't render — normal_query.cpp
//     :1865-1905).
//   - v1.6.0 (P1.7.3) `countType: 'sessions'`: an event counts at most once
//     per (user, session, segment) — counted iff the segment has no prior
//     counted event in that session, then stamp
//     (query_record_per_user_session_segment_state, normal_query.cpp
//     :1318-1352 — the per-segment state timestamp is compared against the
//     user's CURRENT session start and updated on count). Sessions are
//     derived via sessionize() from the FULL event stream: ARB updates
//     session state on every event and only gates result RECORDING on the
//     filter (:2271-2280). `sessionTimeoutMs`/`maxSessionMs` thread through.
//     In sessions mode, `total_users` counts users of COUNTED events only.
//
// Returns rows: `{ value, count, total_users }` where total_users is the
// distinct identity-resolved user count within the segment.

function eventBreakdown(events, { event, breakdownProperty, topN = 250, countType, sessionTimeoutMs, maxSessionMs, firstTimeOnly = false, identityMap }) {
	if (!breakdownProperty) throw new Error('eventBreakdown requires `breakdownProperty`');
	// Derive BEFORE any event filtering (normal_query.cpp:2271-2280 — session
	// state updates are unconditional; the name/firstTime filter only gates
	// recording). Safe under the timeBucket wrapper's per-bucket slices:
	// sessions never cross UTC midnight (daySplit, sessionize.js) and bucket
	// units cut at midnights, so slice-derived boundaries equal full-stream
	// boundaries (B5 invariant tests).
	let sessionOf = null;
	if (countType === 'sessions') {
		const { sessions } = sessionize(events, {
			timeoutMs: sessionTimeoutMs ?? 30 * 60_000,
			maxSessionMs: maxSessionMs ?? 24 * 3_600_000,
			identityMap,
		});
		sessionOf = new Map();
		sessions.forEach((s, i) => { for (const e of s.events) sessionOf.set(e, i); });
	}
	if (firstTimeOnly) {
		// P1.4: restrict to each user's first-ever occurrence of `event`
		// before segmenting (the $nth_time_event rewrite — first-time.js).
		events = filterFirstTimeEver(events, { event, identityMap });
	}
	const segments = new Map(); // type-tagged segment key → { value, count, users, sessions }
	const record = (rawValue, e) => {
		const key = breakdownSegmentKey(rawValue);
		let seg = segments.get(key);
		if (!seg) {
			seg = { value: coerceToBreakdownKey(rawValue), count: 0, users: new Set(), sessions: sessionOf ? new Set() : null };
			segments.set(key, seg);
		}
		if (sessionOf) {
			const si = sessionOf.get(e);
			if (si === undefined) return;     // no derived session (unresolvable id / bad time)
			if (seg.sessions.has(si)) return; // already counted this session for this segment
			seg.sessions.add(si);             // stamp (normal_query.cpp:1330-1339)
		}
		seg.count++;
		seg.users.add(userIdOf(e, identityMap));
	};
	for (const e of events) {
		if (!e || (event && e.event !== event)) continue;
		const v = e[breakdownProperty];
		if (Array.isArray(v)) {
			if (v.length === 0) record('$empty_list', e);
			else for (const item of v) record(item, e);
		} else {
			record(v, e);
		}
	}
	return [...segments.values()]
		.sort((a, b) => b.count - a.count)
		.slice(0, topN)
		.map(s => ({ value: s.value, count: s.count, total_users: s.users.size }));
}

// ── Uniques (Insights: unique users per interval / XAU / cumulative) ──
//
// COUNT_TYPE_UNIQUE semantics from normal_query.cpp:
//   - Per-interval dedup is INDEPENDENT per bucket (query_record_per_user_state
//     keeps a per-(segment, interval) user-state container — :1300-1316): a user
//     active on 3 days counts 3 in a daily series. `unit: 'range'` is the same
//     machinery over a single interval (segmentation_arb.py:933 "total uniques").
//   - Rolling look-back window (WAU/MAU — window_length ≠ 0 branch, :1797-1830):
//     an event contributes to every interval whose decision post (interval END
//     for look-back windows) lies within [event_time, event_time + W], i.e. an
//     event on day E lands the user in daily buckets [E, E + W − 1]. XAU is a
//     look-back window over daily intervals — NOT a calendar week/month.
//   - Cumulative (accumulate_uniques_result, :1834-1863): each interval's count
//     becomes the size of the running distinct-id set through that interval.
//   - Events whose resolved user id is EMPTY are skipped (normal_query.cpp
//     :2200-2208 — distinct_id[0] == '\0' → return 0).
//   - v1.6.0 (P1.7.3) `countType: 'sessions'`: the bucket value is the count
//     of distinct (user, session) pairs active in the bucket — NOT distinct
//     users (per-interval result_values each own a user_session_states
//     container, normal_query.cpp:397-417; recording dedups per session via
//     query_record_per_user_session_segment_state, :1318-1352, dispatched at
//     :1462-1464). Sessions derive via sessionize() from the FULL stream
//     (state updates are unconditional, :2271-2280). Composes with
//     `rollingWindow` (the window branch at :1797-1830 routes through the
//     same count-type dispatch) but NOT `cumulative` — ARB expresses
//     cumulative only as the distinct COUNT_TYPE_CUMULATIVE_UNIQUE enum
//     (accumulate_uniques_result gate at :1860), so there is no cumulative
//     sessions count.
//
// Returns rows: `{ period, uniques }` sorted by period.

function uniques(events, {
	event,
	where,
	unit = 'day',
	rollingWindow,
	cumulative = false,
	countType,
	sessionTimeoutMs,
	maxSessionMs,
	firstTimeOnly = false,
	identityMap,
}) {
	let sessionOf = null;
	if (countType === 'sessions') {
		if (cumulative) {
			throw new Error('uniques: cumulative sessions is not supported (ARB has no cumulative sessions count type — normal_query.cpp:1860)');
		}
		// Derive BEFORE the event/where filter (normal_query.cpp:2271-2280).
		const { sessions } = sessionize(events, {
			timeoutMs: sessionTimeoutMs ?? 30 * 60_000,
			maxSessionMs: maxSessionMs ?? 24 * 3_600_000,
			identityMap,
		});
		sessionOf = new Map();
		sessions.forEach((s, i) => { for (const e of s.events) sessionOf.set(e, i); });
	}
	if (rollingWindow != null && cumulative) {
		throw new Error('uniques: rollingWindow and cumulative are mutually exclusive');
	}
	if (rollingWindow != null && (!Number.isInteger(rollingWindow) || rollingWindow < 1)) {
		throw new Error('uniques: rollingWindow must be a positive integer');
	}
	if (!['day', 'week', 'month', 'range'].includes(unit)) {
		throw new Error(`uniques: unknown unit "${unit}"`);
	}

	if (firstTimeOnly) {
		// P1.4: `where` acts as the PRE-filter — it defines the universe the
		// per-user first is picked from. The rewritten query does not re-apply
		// it (see first-time.js header), so the loop below must not either.
		events = filterFirstTimeEver(events, { event, preWhere: where, identityMap });
	}

	// `key` is the per-bucket dedup identity: the resolved user id, or the
	// derived session index in sessions mode (a session belongs to one user,
	// so the index IS the (user, session) pair).
	const filtered = [];
	for (const e of events) {
		if (!e || (event && e.event !== event)) continue;
		if (!firstTimeOnly && !matchesWhere(e, where)) continue;
		const uid = userIdOf(e, identityMap);
		if (uid === undefined || uid === null || uid === '') continue; // :2200-2208
		const key = sessionOf ? sessionOf.get(e) : uid;
		if (key === undefined) continue; // sessions mode: no derived session (bad time)
		filtered.push({ e, key });
	}

	if (rollingWindow != null) {
		// Daily intervals only (unit forced to 'day'); W-day look-back per bucket.
		const W = rollingWindow;
		const DAY = 86400_000;
		let minDay = Infinity, maxDay = -Infinity;
		/** @type {Array<[number, string|number]>} */
		const eventDays = []; // [dayIndex, key]
		for (const { e, key } of filtered) {
			const ms = toMs(e.time);
			if (!Number.isFinite(ms)) continue;
			const d = Math.floor(ms / DAY);
			eventDays.push([d, key]);
			if (d < minDay) minDay = d;
			if (d > maxDay) maxDay = d;
		}
		if (!eventDays.length) return [];
		const perBucket = new Map(); // dayIndex → Set<key>
		for (let d = minDay; d <= maxDay; d++) perBucket.set(d, new Set());
		for (const [d, key] of eventDays) {
			// Event on day E → buckets [E, E + W − 1], clamped to the observed range.
			// Exact-midnight boundary (fix-round nit 6, REFUTED): ARB's decision
			// check is end-post inclusive (normal_query.cpp:1825 `post >= time_min`,
			// and end(E−1) == an exact-midnight event_time), which would admit day
			// E−1 — but the interval scan STARTS at
			// `interval_min = uniform_intervals_for_relaxed(time_min)` (:1801), and
			// a fencepost timestamp maps to the LATER interval (integer division,
			// uniform_intervals.h:57), so day E−1 is never evaluated. Upper edge:
			// end(E+W−1) == time_max for a midnight event → inclusive → included.
			// Net: [E, E+W−1] for every event, midnight or not — exactly this loop.
			const hi = Math.min(d + W - 1, maxDay);
			for (let b = d; b <= hi; b++) perBucket.get(b).add(key);
		}
		return [...perBucket.entries()].map(([d, set]) => ({
			period: new Date(d * DAY).toISOString().slice(0, 10),
			uniques: set.size,
		}));
	}

	if (unit === 'range') {
		const all = new Set(filtered.map(({ key }) => key));
		return [{ period: 'range', uniques: all.size }];
	}

	const buckets = partitionByTimeBucket(filtered.map(({ e }) => e), /** @type {*} */ (unit));
	// Re-resolve key per event inside each bucket via a lookup built above —
	// avoid resolving twice by mapping event object → key.
	const keyOf = new Map(filtered.map(({ e, key }) => [e, key]));
	const running = new Set();
	return buckets.map(({ period, events: evs }) => {
		const set = new Set();
		for (const e of evs) set.add(keyOf.get(e));
		if (cumulative) {
			for (const u of set) running.add(u);
			return { period, uniques: running.size };
		}
		return { period, uniques: set.size };
	});
}

// ── Lifecycle (P1.8 — the LCA board template classification) ──
//
// Mixpanel has NO engine lifecycle query (query_type.cpp:8-30 enumerates
// every query type — nothing lifecycle-shaped). "Lifecycle" ships as the
// Lifecycle Cohort Analysis board template: Insights uniques filtered by
// four behavioral cohorts on a Value Moment event, in 7- and 30-day period
// variants (iron/common/report/dashboards/types.ts:367-390 —
// LifecycleCohortAnalysisTemplateFields.VALUE_MOMENT is the one required
// template field). The canonical in-source cohort definition is
// weeklyResurrectedUserBookmark
// (iron/common/widgets/profile-summary/bookmark_templates.ts:179-320):
// resurrected = value-moment count AtLeast 1 in the last 30d AND EqualTo 0
// in 60→30d ago AND AtLeast 1 in 90→60d ago. Generalized to period P:
// active in T, inactive in T−1, active in some period before T−1.
//
// DECLARED DIVERGENCE (tiled vs rolling): the real template's cohort
// windows are rolling, re-anchored as-of each charting interval
// (api/version_2_0/insights/params.py:1396-1403
// generate_behaviors_as_of_project_times_for_cohorts →
// behaviors/count.py:213-300 behavior_as_of_project_times;
// cohort_count_query.cpp:48-59 — per-interval user-state containers with an
// associated_time). Tiling fixed periods back from the dataset's LAST EVENT
// DAY is the deterministic equivalent for generated fixture data: identical
// classification rules, stable period edges. Rows span from the first
// value-moment event day through the dataset's last event day; the earliest
// tile may be partial, and its actives are all New by dataset-boundedness
// (the real template's ~5y first-time lookback always covers a dungeon
// window — see first-time.js header).
//
// The dormancy test is an EqualTo-0 filter (bookmark_templates.ts) — ONE
// stray value-moment event inside a would-be dormancy window reclassifies
// the user (resurrected → retained). Gap discipline is therefore a
// story-authoring requirement (P2.3 atom).
function lifecycle(events, { valueMomentEvent, periodDays = 7, identityMap }) {
	if (!valueMomentEvent) throw new Error('lifecycle requires valueMomentEvent');
	if (periodDays !== 7 && periodDays !== 30) {
		throw new Error(`lifecycle: periodDays must be 7 or 30 (the LCA template variants), got ${periodDays}`);
	}
	const DAY = 86400_000;
	const P = periodDays;

	// Anchor period edges on the FULL stream's last event day — the dataset
	// boundary, not the value-moment subset: a value moment that stops firing
	// must still be reported dormant through the end of the data.
	let lastDay = -Infinity;
	for (const e of events) {
		const ms = toMs(e && e.time);
		if (Number.isFinite(ms)) {
			const d = Math.floor(ms / DAY);
			if (d > lastDay) lastDay = d;
		}
	}

	// "Active" = did the value-moment event; other events never qualify
	// (the template's cohorts all filter on the one Value Moment —
	// bookmark_templates.ts custom-property behaviors).
	const vm = [];
	let firstDay = Infinity;
	for (const e of events) {
		if (!e || e.event !== valueMomentEvent) continue;
		const uid = userIdOf(e, identityMap);
		if (uid === undefined || uid === null || uid === '') continue; // normal_query.cpp:2200-2208
		const ms = toMs(e.time);
		if (!Number.isFinite(ms)) continue;
		const day = Math.floor(ms / DAY);
		vm.push({ uid, day });
		if (day < firstDay) firstDay = day;
	}
	if (!vm.length) return [];

	// Period i (ascending) covers day indexes (endDay(i) − P, endDay(i)],
	// endDay(i) = lastDay − (numPeriods − 1 − i) · P.
	const numPeriods = Math.ceil((lastDay - firstDay + 1) / P);
	const periodOf = (day) => numPeriods - 1 - Math.floor((lastDay - day) / P);

	const activity = new Map(); // uid → Set<periodIdx>
	for (const { uid, day } of vm) {
		let set = activity.get(uid);
		if (!set) activity.set(uid, set = new Set());
		set.add(periodOf(day));
	}

	// New = first-ever value moment falls in T. LCA's New cohort rides the
	// $nth_time_event rewrite, so reuse P1.4's machinery (first-time.js);
	// its both-pass timestamp-tie edge is harmless here — same user, same
	// timestamp, same period.
	const firstPeriod = new Map(); // uid → periodIdx
	for (const e of filterFirstTimeEver(events, { event: valueMomentEvent, identityMap })) {
		const uid = userIdOf(e, identityMap);
		const ms = toMs(e.time);
		if (uid === undefined || uid === null || uid === '' || !Number.isFinite(ms)) continue;
		if (!firstPeriod.has(uid)) firstPeriod.set(uid, periodOf(Math.floor(ms / DAY)));
	}

	const rows = [];
	for (let i = 0; i < numPeriods; i++) {
		const endDay = lastDay - (numPeriods - 1 - i) * P;
		const row = {
			period: new Date(endDay * DAY).toISOString().slice(0, 10),
			new: 0,
			retained: 0,
			resurrected: 0,
			dormant: 0,
		};
		for (const [uid, set] of activity) {
			const active = set.has(i);
			const activePrev = i > 0 && set.has(i - 1);
			if (active) {
				// New takes precedence: a first-ever event can't retain or
				// resurrect (no prior activity by definition), so the branch
				// order below is belt-and-braces — but explicit per spec.
				if (firstPeriod.get(uid) === i) {
					row.new++;
				} else if (activePrev) {
					row.retained++;
				} else {
					// Resurrected needs activity in some period BEFORE the
					// (inactive) T−1. Non-first active with inactive T−1
					// always has one, so this scan can't miss — kept as a
					// real check rather than an assumption.
					for (const j of set) {
						if (j < i - 1) { row.resurrected++; break; }
					}
				}
			} else if (activePrev) {
				// EqualTo-0 in T, AtLeast-1 in T−1 — dormant counts exactly
				// one period, then the user drops out of every class until
				// (unless) they resurrect. Reported positive; charting it
				// negative is a frontend concern.
				row.dormant++;
			}
		}
		rows.push(row);
	}
	return rows;
}

// ── Top Paths (P1.9 — the Flows report) ──
//
// Thin dispatch over the flows module: extractFlows runs the per-user ARB
// state machine (anchors, buffers, hidden/visible, collapse, count types),
// aggregateFlows builds + prunes the prefix tree and shapes the list/sankey
// output. All ARB citations live in flows.js.
function topPaths(events, {
	anchors, forward, reverse, countType, hiddenEvents, visibleEvents,
	collapseRepeated, breakdownProperty, sessionTimeoutMs, maxSessionMs,
	identityMap, output, cardinalityThreshold,
}) {
	const flows = extractFlows(events, {
		anchors, forward, reverse, countType, hiddenEvents, visibleEvents,
		collapseRepeated, breakdownProperty, sessionTimeoutMs, maxSessionMs,
		identityMap,
	});
	return aggregateFlows(flows, { output, cardinalityThreshold });
}

function sessionMetrics(events, { event, metrics = ['count', 'duration', 'eventsPerSession'], source = 'derived', sessionTimeoutMs, maxSessionMs, identityMap }) {
	if (source !== 'derived' && source !== 'stamped') {
		throw new Error(`sessionMetrics source must be 'derived' or 'stamped', got '${source}'`);
	}
	// Query-time derivation runs in BOTH modes: it is the metric source when
	// source==='derived', and the divergence reference when source==='stamped'.
	const { sessions } = sessionize(events, {
		timeoutMs: sessionTimeoutMs ?? 30 * 60_000,
		maxSessionMs: maxSessionMs ?? 24 * 3_600_000,
		identityMap,
	});

	// stampedDivergence — boundary disagreements between consecutive stamped
	// events (see block comment above). Derived membership is by object
	// reference: sessionize partitions each user's events, so `sidOf` is total
	// over resolvable events.
	const hasStamps = events.some(e => e && e.session_id != null);
	let stampedDivergence = null;
	if (hasStamps) {
		const sidOf = new Map();
		sessions.forEach((s, i) => { for (const e of s.events) sidOf.set(e, i); });
		stampedDivergence = 0;
		for (const [, evs] of groupByUser(events, identityMap)) {
			const sorted = sortByTime(evs);
			for (let i = 1; i < sorted.length; i++) {
				const a = sorted[i - 1], b = sorted[i];
				if (a.session_id == null || b.session_id == null) continue;
				const stampedSame = String(a.session_id) === String(b.session_id);
				const derivedSame = sidOf.get(a) !== undefined && sidOf.get(a) === sidOf.get(b);
				if (stampedSame !== derivedSame) stampedDivergence++;
			}
		}
	}

	const allSessions = []; // { duration_ms, event_count }
	const sessionCountsPerUser = [];
	if (source === 'derived') {
		// Optional event filter: only sessions containing this event qualify
		// (session.events holds references to the original records).
		const qualifying = event
			? sessions.filter(s => s.events.some(e => e && e.event === event))
			: sessions;
		const perUser = new Map();
		for (const s of qualifying) {
			perUser.set(s.userId, (perUser.get(s.userId) || 0) + 1);
			// endMs is stamped at the session's LAST event (idle tail excluded),
			// so endMs - startMs matches $duration_s at ms resolution.
			allSessions.push({ duration_ms: s.endMs - s.startMs, event_count: s.event_count });
		}
		sessionCountsPerUser.push(...perUser.values());
	} else {
		// v1.5 stamped path: one session bucket per (user, session_id); events
		// without session_id are excluded.
		const userEvents = groupByUser(events, identityMap);
		const sessionsByUser = new Map();
		for (const [uid, evs] of userEvents) {
			const buckets = new Map();
			for (const ev of evs) {
				if (ev.session_id == null) continue;
				const sid = String(ev.session_id);
				if (!buckets.has(sid)) buckets.set(sid, []);
				buckets.get(sid).push(ev);
			}
			if (event) {
				for (const [sid, evs2] of [...buckets]) {
					if (!evs2.some(e => e.event === event)) buckets.delete(sid);
				}
			}
			if (buckets.size) sessionsByUser.set(uid, buckets);
		}
		for (const [, buckets] of sessionsByUser) {
			sessionCountsPerUser.push(buckets.size);
			for (const [, evs] of buckets) {
				const sorted = sortByTime(evs);
				const start = toMs(sorted[0].time);
				const end = toMs(sorted[sorted.length - 1].time);
				allSessions.push({ duration_ms: end - start, event_count: sorted.length });
			}
		}
	}
	const out = [];
	const requested = new Set(metrics);
	if (requested.has('count')) {
		out.push({
			metric: 'count',
			avg: avg(sessionCountsPerUser),
			median: median(sessionCountsPerUser),
			p90: percentile(sessionCountsPerUser, 0.9),
			total_sessions: allSessions.length,
			source,
			stampedDivergence,
		});
	}
	if (requested.has('duration')) {
		const durations = allSessions.map(s => s.duration_ms);
		out.push({
			metric: 'duration',
			avg_ms: avg(durations),
			median_ms: median(durations),
			p90_ms: percentile(durations, 0.9),
			total_sessions: allSessions.length,
			source,
			stampedDivergence,
		});
	}
	if (requested.has('eventsPerSession')) {
		const eventCounts = allSessions.map(s => s.event_count);
		out.push({
			metric: 'eventsPerSession',
			avg: avg(eventCounts),
			median: median(eventCounts),
			p90: percentile(eventCounts, 0.9),
			total_sessions: allSessions.length,
			source,
			stampedDivergence,
		});
	}
	return out;
}

// ── shared helpers ──

function userIdOf(ev, identityMap) {
	return resolveUserId(ev, identityMap);
}

function groupByUser(events, identityMap) {
	const userEvents = new Map();
	for (const ev of events) {
		const uid = userIdOf(ev, identityMap);
		if (!uid) continue;
		if (!userEvents.has(uid)) userEvents.set(uid, []);
		userEvents.get(uid).push(ev);
	}
	return userEvents;
}

function sortByTime(evs) {
	return evs.slice().sort((a, b) => toMs(a && a.time) - toMs(b && b.time));
}

function applyNullAwareAgg(values, agg) {
	switch (agg) {
		case 'sum': return nullAwareSum(values);
		case 'max': return nullAwareExtreme(values, 'max');
		case 'min': return nullAwareExtreme(values, 'min');
		case 'avg':
		default: return nullAwareAvg(values);
	}
}

function median(arr) {
	if (!arr.length) return 0;
	const sorted = arr.slice().sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function avg(arr) {
	if (!arr.length) return 0;
	return arr.reduce((a, x) => a + x, 0) / arr.length;
}

function percentile(arr, p) {
	if (!arr.length) return 0;
	const sorted = arr.slice().sort((a, b) => a - b);
	// Linear interpolation method (consistent with d3.quantile).
	const idx = (sorted.length - 1) * p;
	const lo = Math.floor(idx);
	const hi = Math.ceil(idx);
	if (lo === hi) return sorted[lo];
	return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
