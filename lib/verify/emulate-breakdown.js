/**
 * Mixpanel breakdown emulator.
 *
 * Best-effort approximation of the table shapes Mixpanel produces for the five
 * analyses the Phase 4 hook patterns target. Used by `verify-hooks` to assert
 * that engineered patterns actually produce the expected ratios in the data, AND
 * by consumers who want to validate dungeons against expected business shapes
 * outside of Mixpanel.
 *
 * Reference: Mixpanel Insights / Funnels / Flows reports, as of 2026-05.
 *
 * Caveats:
 * - Mixpanel applies its own per-account UTC offset and time-bucketing rules. This
 *   emulator uses raw event times unless the breakdown explicitly involves a window.
 * - Mixpanel "users" are typically distinct profiles with at least one event in
 *   the date range; this emulator counts unique `user_id` (falling back to
 *   `distinct_id`) found across the events array.
 * - This is not bit-exact — it's the *shape* check Phase 4 verification needs.
 */

/**
 * @typedef {Object} EmulateOptions
 * @property {'frequencyByFrequency'|'funnelFrequency'|'aggregatePerUser'|'timeToConvert'|'attributedBy'} type
 *
 * @property {string} [metricEvent]
 * @property {string} [breakdownByFrequencyOf]
 * @property {boolean} [perUser]
 *
 * @property {string[]} [steps]
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
		case 'frequencyByFrequency': return frequencyByFrequency(events, config);
		case 'funnelFrequency':      return funnelFrequency(events, config);
		case 'aggregatePerUser':     return aggregatePerUser(events, config);
		case 'timeToConvert':        return timeToConvert(events, config);
		case 'attributedBy':         return attributedBy(events, config);
		default: throw new Error(`emulateBreakdown: unknown type "${config.type}"`);
	}
}

// ── Frequency × Frequency (Insights, Frequency Distribution by per-user count of B) ──

function frequencyByFrequency(events, { metricEvent, breakdownByFrequencyOf }) {
	if (!metricEvent || !breakdownByFrequencyOf) {
		throw new Error('frequencyByFrequency requires metricEvent and breakdownByFrequencyOf');
	}
	const userMetric = new Map();
	const userBreakdown = new Map();
	const uids = new Set();
	for (const ev of events) {
		const uid = userIdOf(ev);
		if (!uid) continue;
		uids.add(uid);
		if (ev.event === metricEvent) userMetric.set(uid, (userMetric.get(uid) || 0) + 1);
		if (ev.event === breakdownByFrequencyOf) userBreakdown.set(uid, (userBreakdown.get(uid) || 0) + 1);
	}
	const cell = new Map(); // `${m}|${b}` → user_count
	for (const uid of uids) {
		const m = userMetric.get(uid) || 0;
		const b = userBreakdown.get(uid) || 0;
		const key = `${m}|${b}`;
		cell.set(key, (cell.get(key) || 0) + 1);
	}
	return [...cell.entries()].map(([k, count]) => {
		const [m, b] = k.split('|').map(Number);
		return { metric_freq: m, breakdown_freq: b, user_count: count };
	}).sort((x, y) => x.breakdown_freq - y.breakdown_freq || x.metric_freq - y.metric_freq);
}

// ── Funnel Frequency Breakdown (Funnel report broken down by per-user count of X) ──

function funnelFrequency(events, { steps, breakdownByFrequencyOf }) {
	if (!Array.isArray(steps) || !steps.length) throw new Error('funnelFrequency requires steps[]');
	if (!breakdownByFrequencyOf) throw new Error('funnelFrequency requires breakdownByFrequencyOf');
	const userEvents = groupByUser(events);
	const userBreakdown = new Map();
	for (const [uid, evs] of userEvents) {
		const c = evs.filter(e => e && e.event === breakdownByFrequencyOf).length;
		userBreakdown.set(uid, c);
	}
	const result = [];
	for (let s = 0; s < steps.length; s++) {
		const stepName = steps[s];
		const conversions = new Map(); // breakdown_freq → count
		for (const [uid, evs] of userEvents) {
			const sorted = sortByTime(evs);
			let stepIdx = 0;
			for (const ev of sorted) {
				if (ev.event === steps[stepIdx]) stepIdx++;
				if (stepIdx > s) break;
			}
			if (stepIdx > s) {
				const b = userBreakdown.get(uid) || 0;
				conversions.set(b, (conversions.get(b) || 0) + 1);
			}
		}
		for (const [b, c] of conversions) {
			result.push({ step: stepName, step_index: s, breakdown_freq: b, conversions: c });
		}
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

function aggregatePerUser(events, { event, property, agg = 'avg', breakdownByFrequencyOf }) {
	if (!event) throw new Error('aggregatePerUser requires event');
	if (!breakdownByFrequencyOf) throw new Error('aggregatePerUser requires breakdownByFrequencyOf');
	if (agg !== 'count' && !property) throw new Error('aggregatePerUser requires property unless agg is "count"');
	const userVals = new Map();
	const userBreakdown = new Map();
	for (const ev of events) {
		const uid = userIdOf(ev);
		if (!uid) continue;
		if (ev.event === event) {
			// `agg: 'count'` → count occurrences of the event regardless of property type.
			// All other aggs only consider numeric property values.
			if (agg === 'count') {
				if (!userVals.has(uid)) userVals.set(uid, []);
				userVals.get(uid).push(1);
			} else if (property && typeof ev[property] === 'number') {
				if (!userVals.has(uid)) userVals.set(uid, []);
				userVals.get(uid).push(ev[property]);
			}
		}
		if (ev.event === breakdownByFrequencyOf) userBreakdown.set(uid, (userBreakdown.get(uid) || 0) + 1);
	}
	const userAgg = new Map();
	for (const [uid, vals] of userVals) userAgg.set(uid, applyAgg(vals, agg));
	const buckets = new Map(); // breakdown_freq → [aggregates]
	for (const [uid, v] of userAgg) {
		const b = userBreakdown.get(uid) || 0;
		if (!buckets.has(b)) buckets.set(b, []);
		buckets.get(b).push(v);
	}
	return [...buckets.entries()].map(([b, vs]) => ({
		breakdown_freq: b,
		user_count: vs.length,
		avg_aggregate: vs.reduce((a, x) => a + x, 0) / vs.length,
	})).sort((x, y) => x.breakdown_freq - y.breakdown_freq);
}

// ── Time to Convert (Funnel TTC, broken down by user property) ──

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
		const sorted = sortByTime(evs);
		const a = sorted.find(e => e && e.event === fromEvent);
		if (!a) continue;
		const aIdx = sorted.indexOf(a);
		const b = sorted.slice(aIdx + 1).find(e => e && e.event === toEvent);
		if (!b) continue;
		const ttcMs = toMs(b.time) - toMs(a.time);
		if (!Number.isFinite(ttcMs) || ttcMs < 0) continue;
		const profile = profileByUid.get(uid);
		const segValue = breakdownByUserProperty
			? (profile ? (profile[breakdownByUserProperty] ?? 'unknown') : 'unknown')
			: 'all';
		if (!buckets.has(segValue)) buckets.set(segValue, []);
		buckets.get(segValue).push(ttcMs);
	}
	return [...buckets.entries()].map(([seg, ttcs]) => ({
		segment_value: seg,
		user_count: ttcs.length,
		avg_ttc_ms: ttcs.reduce((a, x) => a + x, 0) / ttcs.length,
		median_ttc_ms: median(ttcs),
	})).sort((x, y) => String(x.segment_value).localeCompare(String(y.segment_value)));
}

// ── Attributed By (first-/last-touch attribution by event property value) ──

function attributedBy(events, { conversionEvent, attributionEvent, attributionProperty, model = 'firstTouch' }) {
	if (!conversionEvent || !attributionEvent || !attributionProperty) {
		throw new Error('attributedBy requires conversionEvent, attributionEvent, attributionProperty');
	}
	const userEvents = groupByUser(events);
	const counts = new Map();
	for (const [uid, evs] of userEvents) {
		const sorted = sortByTime(evs);
		const conversion = sorted.find(e => e && e.event === conversionEvent);
		if (!conversion) continue;
		const conversionTime = toMs(conversion.time);
		const touches = sorted.filter(e =>
			e && e.event === attributionEvent && toMs(e.time) <= conversionTime
		);
		if (!touches.length) continue;
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

function toMs(t) {
	if (typeof t === 'number') return t > 1e12 ? t : t > 1e9 ? t * 1000 : t;
	return Date.parse(t);
}

function applyAgg(vals, agg) {
	if (!vals || !vals.length) return 0;
	switch (agg) {
		case 'sum': return vals.reduce((a, b) => a + b, 0);
		case 'count': return vals.length;
		case 'max': return Math.max(...vals);
		case 'min': return Math.min(...vals);
		case 'avg':
		default: return vals.reduce((a, b) => a + b, 0) / vals.length;
	}
}

function median(arr) {
	if (!arr.length) return 0;
	const sorted = arr.slice().sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
