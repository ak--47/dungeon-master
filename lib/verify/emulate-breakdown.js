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
import { evaluateFunnel, evaluateAnyOrderCompletion } from './funnel-engine.js';
import { buildIdentityMap, resolveUserId } from './identity.js';
import { coerceToBreakdownKey, breakdownSegmentKey, matchesWhere } from './coerce.js';
import { filterFirstTimeEver } from './first-time.js';
import {
	countDistinctPeriods,
	countDistinctValues,
	nullAwareAvg,
	nullAwareSum,
	nullAwareExtreme,
	partitionByTimeBucket,
} from './counting.js';

/**
 * v1.5: pick the right per-user funnel evaluator based on the funnel's `order` mode.
 *
 *   - `sequential`, `interrupt`, `interrupted` → greedy single-pass (Mixpanel-aligned)
 *   - `first-fixed`                            → step-0 greedy + any-order on rest
 *   - `last-fixed`, `outside-in`, `middle-fixed`, `first-and-last-fixed`
 *                                              → any-order completion (partial verification)
 *   - `random`                                 → any-order, informational only
 *
 * Returns a normalized result `{ completed, reached, ttcMs, mode, verificationKind }`.
 * `verificationKind` is `undefined` for sequential modes (full PASS/FAIL allowed),
 * `'partial'` for completion-only modes, `'informational'` for `random`.
 *
 * @param {Array<Object>} userEvents
 * @param {string[]} steps
 * @param {Object} options
 * @param {string} [options.funnelOrder='sequential']
 * @param {number} [options.conversionWindowMs]
 * @param {boolean} [options.reentry]
 * @param {Array<Object>} [options.exclusionSteps]
 * @param {boolean | string[]} [options.trackStepProperties]
 * @param {boolean} [options.sessionScoped]
 */
function evaluateFunnelByOrder(userEvents, steps, options = {}) {
	const order = options.funnelOrder || 'sequential';
	const sequentialOpts = {
		conversionWindowMs: options.conversionWindowMs,
		reentry: options.reentry,
		exclusionSteps: options.exclusionSteps,
		trackStepProperties: options.trackStepProperties,
		sessionScoped: options.sessionScoped,
	};
	switch (order) {
		case 'sequential':
		case 'interrupt':
		case 'interrupted': {
			const r = /** @type {*} */ (evaluateFunnel(userEvents, steps, sequentialOpts));
			return { ...r, mode: order, verificationKind: undefined };
		}
		case 'first-fixed': {
			const stepZero = /** @type {*} */ (evaluateFunnel(userEvents, [steps[0]], { conversionWindowMs: options.conversionWindowMs }));
			if (!stepZero.completed) {
				return { completed: false, reached: -1, stepEvents: [], stepTimes: [], ttcMs: null, mode: 'first-fixed', verificationKind: 'partial' };
			}
			const rest = evaluateAnyOrderCompletion(userEvents, steps.slice(1));
			const completed = rest.completed;
			const reached = completed ? steps.length - 1 : 0;
			return {
				completed,
				reached,
				stepEvents: [],
				stepTimes: [],
				ttcMs: completed ? rest.completionTimeMs : null,
				mode: 'first-fixed',
				verificationKind: 'partial',
			};
		}
		case 'last-fixed':
		case 'middle-fixed':
		case 'first-and-last-fixed':
		case 'outside-in': {
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
		case 'random': {
			const r = evaluateAnyOrderCompletion(userEvents, steps);
			return {
				completed: r.completed,
				reached: r.completed ? steps.length - 1 : -1,
				stepEvents: [],
				stepTimes: [],
				ttcMs: r.completionTimeMs,
				mode: 'random',
				verificationKind: 'informational',
			};
		}
		default: {
			const r = /** @type {*} */ (evaluateFunnel(userEvents, steps, sequentialOpts));
			return { ...r, mode: order, verificationKind: undefined };
		}
	}
}

/**
 * @typedef {Object} EmulateOptions
 * @property {'frequencyByFrequency'|'funnelFrequency'|'aggregatePerUser'|'timeToConvert'|'attributedBy'|'sessionMetrics'|'retention'|'distinctCount'|'eventBreakdown'|'uniques'} type
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
 * @property {string} [toEvent]
 * @property {string} [breakdownByUserProperty]
 * @property {Array<Object>} [profiles]
 *
 * @property {string} [conversionEvent]
 * @property {string} [attributionEvent]
 * @property {string} [attributionProperty]
 * @property {'firstTouch'|'lastTouch'} [model]
 * @property {number} [touchpointsLimit]
 *
 * v1.6.0 eventBreakdown (Insights: total events segmented by a property):
 * @property {string} [breakdownProperty]
 * @property {number} [topN]
 * @property {'sessions'} [countType]
 * @property {number} [sessionTimeoutMs]
 *
 * v1.6.0 uniques (Insights: unique users per interval / XAU / cumulative):
 * @property {Object<string, *>} [where]
 * @property {('day'|'week'|'month'|'range')} [unit]
 * @property {number} [rollingWindow]
 * @property {boolean} [cumulative]
 * @property {boolean} [firstTimeOnly]
 *
 * v1.5.0 funnel extensions (apply to funnelFrequency + timeToConvert sequential modes):
 * @property {boolean} [reentry]
 * @property {Array<Object>} [exclusionSteps]
 * @property {boolean | string[]} [trackStepProperties]
 * @property {boolean} [sessionScoped]
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
 */

/**
 * Run a Mixpanel breakdown emulation against an events array.
 * Routes to the type-specific implementation based on `config.type`.
 *
 * @param {Array<Object>} events
 * @param {EmulateOptions} config
 * @returns {Array<Object>} Breakdown table rows.
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
		const range = config.timeBucketRange || {};
		const buckets = partitionByTimeBucket(events, config.timeBucket, range);
		// Pass the pre-built identityMap into recursive calls so the auto-build
		// branch above is a no-op per bucket (would otherwise rebuild N times).
		const inner = { ...config, timeBucket: undefined, timeBucketRange: undefined, identityMap };
		const out = [];
		for (const { period, events: evs } of buckets) {
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

function funnelFrequency(events, { steps, breakdownByFrequencyOf, conversionWindowMs, periodUnit = 'day', funnelOrder = 'sequential', identityMap, reentry, exclusionSteps, trackStepProperties, sessionScoped }) {
	if (!Array.isArray(steps) || !steps.length) throw new Error('funnelFrequency requires steps[]');
	if (!breakdownByFrequencyOf) throw new Error('funnelFrequency requires breakdownByFrequencyOf');
	const userEvents = groupByUser(events, identityMap);
	const result = [];
	const conversions = new Map(); // `${stepIdx}|${b}` → count
	for (const [, evs] of userEvents) {
		// v1.5: dispatch on funnel.order so non-sequential modes don't return 0% trivially.
		const r = evaluateFunnelByOrder(evs, steps, { conversionWindowMs, funnelOrder, reentry, exclusionSteps, trackStepProperties, sessionScoped });
		const b = countDistinctPeriods(evs, breakdownByFrequencyOf, /** @type {*} */ (periodUnit));
		for (let s = 0; s <= r.reached; s++) {
			const key = `${s}|${b}`;
			conversions.set(key, (conversions.get(key) || 0) + 1);
		}
	}
	for (const [key, count] of conversions) {
		const [s, b] = key.split('|').map(Number);
		result.push({ step: steps[s], step_index: s, breakdown_freq: b, conversions: count, conversion_pct: 0 });
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
// Step pair matched via the greedy funnel engine (history.cpp). When the
// funnel completes via the engine, ttcMs = stepTimes[1] - stepTimes[0].
// Differs from the old "first occurrence of fromEvent then first occurrence
// of toEvent after it" logic by enforcing the same temporal rules Mixpanel
// uses for funnel matching.

function timeToConvert(events, { fromEvent, toEvent, breakdownByUserProperty, profiles = [], funnelOrder = 'sequential', conversionWindowMs, identityMap, reentry, exclusionSteps, sessionScoped }) {
	if (!fromEvent || !toEvent) throw new Error('timeToConvert requires fromEvent and toEvent');
	const userEvents = groupByUser(events, identityMap);
	const profileByUid = new Map();
	for (const p of profiles) {
		if (!p) continue;
		const uid = p.distinct_id || p.user_id;
		if (uid) profileByUid.set(uid, p);
	}
	const buckets = new Map(); // segValue → [ttcMs]
	for (const [uid, evs] of userEvents) {
		// v1.5: respect funnel.order. For random mode, ttcMs is informational
		// (lastSeenTime - firstSeenTime), not Mixpanel TTC.
		const r = evaluateFunnelByOrder(evs, [fromEvent, toEvent], { funnelOrder, conversionWindowMs, reentry, exclusionSteps, sessionScoped });
		if (!r.completed || r.ttcMs === null || !Number.isFinite(r.ttcMs) || r.ttcMs < 0) continue;
		const profile = profileByUid.get(uid);
		const segValue = breakdownByUserProperty
			? (profile ? (profile[breakdownByUserProperty] ?? 'unknown') : 'unknown')
			: 'all';
		if (!buckets.has(segValue)) buckets.set(segValue, []);
		buckets.get(segValue).push(r.ttcMs);
	}
	return [...buckets.entries()].map(([seg, ttcs]) => ({
		segment_value: seg,
		user_count: ttcs.length,
		avg_ttc_ms: ttcs.reduce((a, x) => a + x, 0) / ttcs.length,
		median_ttc_ms: median(ttcs),
	})).sort((x, y) => String(x.segment_value).localeCompare(String(y.segment_value)));
}

// ── Attributed By (first-/last-touch attribution by event property value) ──
//
// Touchpoint cap: max 10 touchpoints in lookback window
// (`TOUCHPOINTS_LIMIT = 10` in attributed_value_reader.cpp). For first/last
// touch the cap matters when the user has > 10 touches before conversion;
// the cap shifts which touches enter the candidate pool.

function attributedBy(events, {
	conversionEvent,
	attributionEvent,
	attributionProperty,
	model = 'firstTouch',
	touchpointsLimit = 10,
	identityMap,
}) {
	if (!conversionEvent || !attributionEvent || !attributionProperty) {
		throw new Error('attributedBy requires conversionEvent, attributionEvent, attributionProperty');
	}
	const userEvents = groupByUser(events, identityMap);
	const counts = new Map();
	for (const [, evs] of userEvents) {
		const sorted = sortByTime(evs);
		const conversion = sorted.find(e => e && e.event === conversionEvent);
		if (!conversion) continue;
		const conversionTime = toMs(conversion.time);
		const allTouches = sorted.filter(e =>
			e && e.event === attributionEvent && toMs(e.time) <= conversionTime
		);
		if (!allTouches.length) continue;
		// Cap to the last `touchpointsLimit` touches in the lookback window.
		// (When touch count <= cap, this is a no-op.)
		const touches = allTouches.slice(-touchpointsLimit);
		const touch = model === 'lastTouch' ? touches[touches.length - 1] : touches[0];
		const v = touch[attributionProperty] ?? 'unknown';
		counts.set(v, (counts.get(v) || 0) + 1);
	}
	return [...counts.entries()].map(([source, count]) => ({
		attribution_value: source,
		conversions: count,
	})).sort((a, b) => b.conversions - a.conversions);
}

// ── Retention (birth-anchored day buckets) ───────────────────────────────────
//
// Reference: backend/arb/reader/queries/retention_query.cpp
//
// Bucketing rule (retention_query.cpp:1227-1231):
//   time_to_retention_event_s = retention_event_time_s - first_event_time_s
//   bucket = floor(time_to_retention_event_s / bucket_seconds)
//
// We compute bucket = floor((return_ms - birth_ms) / DAY_MS) — a raw ms-delta
// from birth, NOT a UTC-calendar-day-number difference. So a return 23h after
// birth lands in bucket 0; a return 25h after birth lands in bucket 1.
//
// Birth-can-retain (default false; retention_query.cpp:1097-1109):
//   if (birth_can_retain) return first_event_time_ms <= retention_event_time_ms;
//   else                  return first_event_time_ms <  retention_event_time_ms;
// We default to false (return events strictly after birth, ms-precise).
//
// Optional `carry_forward`: once retained on day M, count as retained on
// every later bucket (Mixpanel's CARRY_FORWARD unbounded mode —
// retention_query.cpp:1824-1837).
//
// Optional `segmentBy`: partition the cohort by the birth event's property
// value (Mixpanel's segment_event=FIRST mode — retention_query.cpp:1309).
//
// NOT IMPLEMENTED — these are MORE common than initially documented; treat as
// known scope gaps:
//   - COMPOUNDED retention (retention_query.cpp:670) reuses the first-event
//     filter as the return filter, making EVERY cohort event a retention
//     candidate. Used heavily in Mixpanel's "DAU coming back" reports.
//   - CARRY_BACK / CONSECUTIVE_FORWARD unbounded modes
//   - CALENDAR_START bucket alignment (retention_query.cpp:308-321)
//   - segment_event=SECOND (retention_query.cpp:1310 — return event property)
//   - Cohort window (only users with birth in `from_date..to_date` are in
//     cohort; we use ALL users with the birth event in the dataset)
//   - week / month bucket units (only `day` here)

const DAY_MS_RET = 86400 * 1000;

function retention(events, { cohortEvent, returnEvent, dayBuckets = [1, 7, 14, 30], segmentBy, carry_forward = false, birthCanRetain = false, identityMap }) {
	if (!cohortEvent) throw new Error('retention requires cohortEvent');
	if (!returnEvent) throw new Error('retention requires returnEvent');
	if (!Array.isArray(dayBuckets) || !dayBuckets.length) {
		throw new Error('retention requires non-empty dayBuckets');
	}

	const userEvents = groupByUser(events, identityMap);

	// segment → cohort users + per-user state
	const cohorts = new Map();
	const ensureSegment = (seg) => {
		if (!cohorts.has(seg)) cohorts.set(seg, { users: new Set(), birthMsByUser: new Map(), returnBucketsByUser: new Map() });
		return cohorts.get(seg);
	};

	for (const [uid, evs] of userEvents) {
		// Birth = earliest cohortEvent for this user.
		const sorted = sortByTime(evs);
		const birth = sorted.find(e => e.event === cohortEvent);
		if (!birth) continue;
		const birthMs = toMs(birth.time);
		if (!Number.isFinite(birthMs)) continue;
		const seg = segmentBy ? (birth[segmentBy] ?? 'unknown') : 'all';
		const sb = ensureSegment(seg);
		sb.users.add(uid);
		sb.birthMsByUser.set(uid, birthMs);

		const retBuckets = new Set();
		for (const ev of sorted) {
			if (ev.event !== returnEvent) continue;
			const evMs = toMs(ev.time);
			if (!Number.isFinite(evMs)) continue;
			// Mixpanel ms-strict gate (retention_query.cpp:1097-1109).
			const passes = birthCanRetain ? (birthMs <= evMs) : (birthMs < evMs);
			if (!passes) continue;
			// Bucket by ms-delta — Mixpanel time_to_retention_event_s / bucket_seconds.
			const bucket = Math.floor((evMs - birthMs) / DAY_MS_RET);
			if (bucket >= 0) retBuckets.add(bucket);
		}
		sb.returnBucketsByUser.set(uid, retBuckets);
	}

	const out = [];
	for (const [seg, sb] of cohorts) {
		const cohortSize = sb.users.size;
		for (const day of dayBuckets) {
			let retained = 0;
			for (const uid of sb.users) {
				const buckets = sb.returnBucketsByUser.get(uid);
				if (!buckets) continue;
				if (carry_forward) {
					// Retained on bucket N if hit any bucket in [0, N] (or [1, N] if you exclude bucket 0).
					let hit = false;
					for (const b of buckets) {
						if (b <= day) { hit = true; break; }
					}
					if (hit) retained++;
				} else {
					if (buckets.has(day)) retained++;
				}
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
// Mixpanel computes sessions at query time using a 30-min gap (default) +
// 24h max model and emits synthetic event properties: $duration_s,
// $event_count, $origin_start, $origin_end. Our generator pre-stamps
// `session_id` using the same rules; here we trust that stamping and just
// group → aggregate per session.
//
// Returns an array with one row per requested metric:
//   [{ metric: 'count',           avg, median, p90, total_sessions }]
//   [{ metric: 'duration',        avg_ms, median_ms, p90_ms, total_sessions }]
//   [{ metric: 'eventsPerSession',avg, median, p90, total_sessions }]

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
//
// Returns rows: `{ value, count, total_users }` where total_users is the
// distinct identity-resolved user count within the segment.

function eventBreakdown(events, { event, breakdownProperty, topN = 250, countType, firstTimeOnly = false, identityMap }) {
	if (!breakdownProperty) throw new Error('eventBreakdown requires `breakdownProperty`');
	if (countType === 'sessions') {
		// P1.7.3 wires this to sessionize(); counting once per (user, session, segment).
		throw new Error('eventBreakdown: countType "sessions" requires sessionize support (see P1.7.3)');
	}
	if (firstTimeOnly) {
		// P1.4: restrict to each user's first-ever occurrence of `event`
		// before segmenting (the $nth_time_event rewrite — first-time.js).
		events = filterFirstTimeEver(events, { event, identityMap });
	}
	const segments = new Map(); // type-tagged segment key → { value, count, users }
	const record = (rawValue, e) => {
		const key = breakdownSegmentKey(rawValue);
		let seg = segments.get(key);
		if (!seg) {
			seg = { value: coerceToBreakdownKey(rawValue), count: 0, users: new Set() };
			segments.set(key, seg);
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
//
// Returns rows: `{ period, uniques }` sorted by period.

function uniques(events, {
	event,
	where,
	unit = 'day',
	rollingWindow,
	cumulative = false,
	countType,
	firstTimeOnly = false,
	identityMap,
}) {
	if (countType === 'sessions') {
		// P1.7.3 wires this to sessionize(); counting distinct (user, session) pairs.
		throw new Error('uniques: countType "sessions" requires sessionize support (see P1.7.3)');
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

	const filtered = [];
	for (const e of events) {
		if (!e || (event && e.event !== event)) continue;
		if (!firstTimeOnly && !matchesWhere(e, where)) continue;
		const uid = userIdOf(e, identityMap);
		if (uid === undefined || uid === null || uid === '') continue; // :2200-2208
		filtered.push({ e, uid });
	}

	if (rollingWindow != null) {
		// Daily intervals only (unit forced to 'day'); W-day look-back per bucket.
		const W = rollingWindow;
		const DAY = 86400_000;
		let minDay = Infinity, maxDay = -Infinity;
		const eventDays = []; // [dayIndex, uid]
		for (const { e, uid } of filtered) {
			const ms = toMs(e.time);
			if (!Number.isFinite(ms)) continue;
			const d = Math.floor(ms / DAY);
			eventDays.push([d, uid]);
			if (d < minDay) minDay = d;
			if (d > maxDay) maxDay = d;
		}
		if (!eventDays.length) return [];
		const perBucket = new Map(); // dayIndex → Set<uid>
		for (let d = minDay; d <= maxDay; d++) perBucket.set(d, new Set());
		for (const [d, uid] of eventDays) {
			// Event on day E → buckets [E, E + W − 1], clamped to the observed range.
			const hi = Math.min(d + W - 1, maxDay);
			for (let b = d; b <= hi; b++) perBucket.get(b).add(uid);
		}
		return [...perBucket.entries()].map(([d, set]) => ({
			period: new Date(d * DAY).toISOString().slice(0, 10),
			uniques: set.size,
		}));
	}

	if (unit === 'range') {
		const all = new Set(filtered.map(({ uid }) => uid));
		return [{ period: 'range', uniques: all.size }];
	}

	const buckets = partitionByTimeBucket(filtered.map(({ e }) => e), unit);
	// Re-resolve uid per event inside each bucket via a lookup built above —
	// avoid resolving twice by mapping event object → uid.
	const uidOf = new Map(filtered.map(({ e, uid }) => [e, uid]));
	const running = new Set();
	return buckets.map(({ period, events: evs }) => {
		const set = new Set();
		for (const e of evs) set.add(uidOf.get(e));
		if (cumulative) {
			for (const u of set) running.add(u);
			return { period, uniques: running.size };
		}
		return { period, uniques: set.size };
	});
}

function sessionMetrics(events, { event, metrics = ['count', 'duration', 'eventsPerSession'], identityMap }) {
	const userEvents = groupByUser(events, identityMap);
	const sessionsByUser = new Map();
	for (const [uid, evs] of userEvents) {
		// One session bucket per (user, session_id). Events without session_id
		// are excluded — Mixpanel only emits session reports for events that
		// landed inside an evaluated session.
		const buckets = new Map();
		for (const ev of evs) {
			if (ev.session_id == null) continue;
			const sid = String(ev.session_id);
			if (!buckets.has(sid)) buckets.set(sid, []);
			buckets.get(sid).push(ev);
		}
		// Optional event filter: only sessions containing this event qualify.
		if (event) {
			for (const [sid, evs2] of [...buckets]) {
				if (!evs2.some(e => e.event === event)) buckets.delete(sid);
			}
		}
		if (buckets.size) sessionsByUser.set(uid, buckets);
	}
	const allSessions = []; // { duration_ms, event_count }
	const sessionCountsPerUser = [];
	for (const [, buckets] of sessionsByUser) {
		sessionCountsPerUser.push(buckets.size);
		for (const [, evs] of buckets) {
			const sorted = sortByTime(evs);
			const start = toMs(sorted[0].time);
			const end = toMs(sorted[sorted.length - 1].time);
			allSessions.push({ duration_ms: end - start, event_count: sorted.length });
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
