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
import { evaluateFunnel } from './funnel-engine.js';
import {
	countDistinctPeriods,
	nullAwareAvg,
	nullAwareSum,
	nullAwareExtreme,
} from './counting.js';

/**
 * @typedef {Object} EmulateOptions
 * @property {'frequencyByFrequency'|'funnelFrequency'|'aggregatePerUser'|'timeToConvert'|'attributedBy'} type
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
	switch (config.type) {
		case 'frequencyByFrequency': return frequencyByFrequency(events, /** @type {*} */ (config));
		case 'funnelFrequency':      return funnelFrequency(events, /** @type {*} */ (config));
		case 'aggregatePerUser':     return aggregatePerUser(events, /** @type {*} */ (config));
		case 'timeToConvert':        return timeToConvert(events, /** @type {*} */ (config));
		case 'attributedBy':         return attributedBy(events, /** @type {*} */ (config));
		default: throw new Error(`emulateBreakdown: unknown type "${config.type}"`);
	}
}

// ── Frequency × Frequency (Insights, Frequency Distribution by per-user count of B) ──
//
// Both axes are DISTINCT PERIOD counts (default: days), not raw event counts.
// Reference: addiction_query.cpp — see counting.js#countDistinctPeriods for
// the rule and why it matters.

function frequencyByFrequency(events, { metricEvent, breakdownByFrequencyOf, periodUnit = 'day' }) {
	if (!metricEvent || !breakdownByFrequencyOf) {
		throw new Error('frequencyByFrequency requires metricEvent and breakdownByFrequencyOf');
	}
	const userEvents = groupByUser(events);
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

function funnelFrequency(events, { steps, breakdownByFrequencyOf, conversionWindowMs, periodUnit = 'day' }) {
	if (!Array.isArray(steps) || !steps.length) throw new Error('funnelFrequency requires steps[]');
	if (!breakdownByFrequencyOf) throw new Error('funnelFrequency requires breakdownByFrequencyOf');
	const userEvents = groupByUser(events);
	const result = [];
	const conversions = new Map(); // `${stepIdx}|${b}` → count
	for (const [, evs] of userEvents) {
		const r = evaluateFunnel(evs, steps, { conversionWindowMs });
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

function aggregatePerUser(events, { event, property, agg = 'avg', breakdownByFrequencyOf, periodUnit = 'day' }) {
	if (!event) throw new Error('aggregatePerUser requires event');
	if (!breakdownByFrequencyOf) throw new Error('aggregatePerUser requires breakdownByFrequencyOf');
	if (agg !== 'count' && !property) throw new Error('aggregatePerUser requires property unless agg is "count"');
	const userEvents = groupByUser(events);
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
	return [...buckets.entries()].map(([b, vs]) => ({
		breakdown_freq: b,
		user_count: vs.length,
		// Mean of per-user aggregates within this cohort. Numeric values only;
		// `vs` already excludes null aggregates by construction above.
		avg_aggregate: vs.reduce((a, x) => a + x, 0) / vs.length,
	})).sort((x, y) => x.breakdown_freq - y.breakdown_freq);
}

// ── Time to Convert (Funnel TTC, broken down by user property) ──
//
// Step pair matched via the greedy funnel engine (history.cpp). When the
// funnel completes via the engine, ttcMs = stepTimes[1] - stepTimes[0].
// Differs from the old "first occurrence of fromEvent then first occurrence
// of toEvent after it" logic by enforcing the same temporal rules Mixpanel
// uses for funnel matching.

function timeToConvert(events, { fromEvent, toEvent, breakdownByUserProperty, profiles = [] }) {
	if (!fromEvent || !toEvent) throw new Error('timeToConvert requires fromEvent and toEvent');
	const userEvents = groupByUser(events);
	const profileByUid = new Map();
	for (const p of profiles) {
		if (!p) continue;
		const uid = p.distinct_id || p.user_id;
		if (uid) profileByUid.set(uid, p);
	}
	const buckets = new Map(); // segValue → [ttcMs]
	for (const [uid, evs] of userEvents) {
		const r = evaluateFunnel(evs, [fromEvent, toEvent]);
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
}) {
	if (!conversionEvent || !attributionEvent || !attributionProperty) {
		throw new Error('attributedBy requires conversionEvent, attributionEvent, attributionProperty');
	}
	const userEvents = groupByUser(events);
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

// ── shared helpers ──

function userIdOf(ev) {
	return ev && (ev.user_id || ev.distinct_id || ev.device_id);
}

function groupByUser(events) {
	const userEvents = new Map();
	for (const ev of events) {
		const uid = userIdOf(ev);
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
