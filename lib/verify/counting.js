/**
 * Counting and aggregation helpers matching Mixpanel's analytics semantics.
 *
 * These primitives differ from naive SQL in important ways. Each helper
 * documents the Mixpanel source file that defines the rule and the
 * specific divergence from `COUNT(*)` / `AVG(x)` / etc.
 *
 * References (from `mixpanel/analytics`):
 *   - `backend/arb/reader/queries/addiction_query.cpp` — distinct-period counting
 *   - `backend/arb/reader/queries/normal_query.cpp` — null-aware AVG/SUM/MIN/MAX
 */

import { toMs } from '../hook-helpers/_internal.js';

const SECONDS_PER_UNIT = {
	hour: 3600,
	day: 86400,
	week: 7 * 86400,
};

/**
 * Count distinct time periods on which a user fired a given event.
 *
 * Two related rules exist in Mixpanel:
 *
 * 1. **Calendar bucket** (default here, `algorithm: 'calendar'`):
 *    `COUNT(DISTINCT date_trunc(unit, time))` in UTC. This is what the
 *    Mixpanel UI presents — frequency distribution charts bucket events
 *    into calendar hours/days/weeks.
 *
 * 2. **Rolling window** (`algorithm: 'rolling'`): the addiction_query.cpp
 *    rule, `qtz_time >= last_counted + seconds_for_unit(unit)`. This is
 *    Mixpanel's internal C++ implementation. It diverges from calendar
 *    bucketing at unit boundaries — events at 23:59 and 00:01 next day
 *    register as 1 rolling-window period (gap 120s < 86400s) but 2
 *    calendar-day periods.
 *
 * The default is `calendar` because:
 *   - It matches what users actually see in Mixpanel reports.
 *   - It aligns with `injectOnNewDays`, which classifies days by
 *     `Math.floor(t / DAY_MS)` to find empty days. Mixing the two
 *     algorithms causes the atom and verifier to disagree at boundaries.
 *
 * Use `algorithm: 'rolling'` only when you're verifying behavior that
 * specifically depends on the C++ rolling-window check.
 *
 * Reference: `mixpanel/analytics`
 *   - calendar bucketing: implicit in the UI / Insights reports
 *   - rolling-window: `backend/arb/reader/queries/addiction_query.cpp`
 *
 * @param {Object[]} events - Events to scan (mixed types OK).
 * @param {string} eventName - Event name to filter for.
 * @param {('hour'|'day'|'week')} [unit='day']
 * @param {Object} [options]
 * @param {('calendar'|'rolling')} [options.algorithm='calendar']
 * @returns {number} Distinct period count.
 */
export function countDistinctPeriods(events, eventName, unit = 'day', options = {}) {
	const seconds = SECONDS_PER_UNIT[unit];
	if (!seconds) throw new Error(`countDistinctPeriods: unsupported unit "${unit}"`);
	if (!Array.isArray(events) || !events.length) return 0;
	const matches = events
		.filter(e => e && e.event === eventName)
		.map(e => toMs(e.time))
		.filter(ms => Number.isFinite(ms));
	if (!matches.length) return 0;
	const unitMs = seconds * 1000;
	const { algorithm = 'calendar' } = options;

	if (algorithm === 'calendar') {
		// Calendar bucket — UTC floor by unit. Matches what Mixpanel's UI
		// shows and what `injectOnNewDays` uses internally.
		const buckets = new Set();
		for (const t of matches) buckets.add(Math.floor(t / unitMs));
		return buckets.size;
	}

	// Rolling window — addiction_query.cpp semantics.
	matches.sort((a, b) => a - b);
	let count = 0;
	let lastCountedMs = -Infinity;
	for (const t of matches) {
		if (t >= lastCountedMs + unitMs) {
			count++;
			lastCountedMs = t;
		}
	}
	return count;
}

/**
 * Null-aware average matching Mixpanel's aggregation semantics.
 *
 * Reference: `backend/arb/reader/queries/normal_query.cpp` ACTION_TYPE_AVERAGE:
 *
 *     if (action_value.type == VALUE_TYPE_NUMBER && !std::isnan(value)) {
 *         v->average.sum += number;
 *         v->average.count += upsampling_factor;
 *     }
 *
 * Skips null, undefined, NaN, and non-numeric values from BOTH numerator
 * and denominator. Returns null when no numeric values exist.
 *
 * Differs from naive `SUM(x) / COUNT(*)` which inflates the denominator
 * by counting rows where x is missing — diluting the average toward 0.
 *
 * @param {*[]} values
 * @returns {number|null}
 */
export function nullAwareAvg(values) {
	if (!Array.isArray(values) || !values.length) return null;
	let sum = 0;
	let count = 0;
	for (const v of values) {
		if (typeof v === 'number' && Number.isFinite(v)) {
			sum += v;
			count++;
		}
	}
	return count ? sum / count : null;
}

/**
 * Null-aware sum. Skips null/undefined/NaN/non-numeric silently.
 *
 * Reference: `normal_query.cpp` ACTION_TYPE_SUM — same numeric guard as AVG.
 * Differs from naive SQL SUM only when missing values are coalesced to 0
 * upstream; in JS arrays missing values are typically `undefined` which
 * produces NaN under `+`.
 *
 * @param {*[]} values
 * @returns {number}
 */
export function nullAwareSum(values) {
	if (!Array.isArray(values) || !values.length) return 0;
	let sum = 0;
	for (const v of values) {
		if (typeof v === 'number' && Number.isFinite(v)) sum += v;
	}
	return sum;
}

/**
 * Null-aware min/max. Returns null when no numeric values exist.
 *
 * Reference: `normal_query.cpp` ACTION_TYPE_EXTREMES — only records numeric
 * values. Mixpanel starts max at -Infinity and min at +Infinity; we return
 * null instead of those sentinels when no values were recorded.
 *
 * @param {*[]} values
 * @param {('min'|'max')} mode
 * @returns {number|null}
 */
export function nullAwareExtreme(values, mode) {
	if (!Array.isArray(values) || !values.length) return null;
	let extreme = mode === 'min' ? Infinity : -Infinity;
	let any = false;
	for (const v of values) {
		if (typeof v === 'number' && Number.isFinite(v)) {
			any = true;
			if (mode === 'min') {
				if (v < extreme) extreme = v;
			} else {
				if (v > extreme) extreme = v;
			}
		}
	}
	return any ? extreme : null;
}

/**
 * Bin a user by their distinct-period count of an event. Combines
 * `countDistinctPeriods` with bin classification for cohort assignment.
 *
 * Each bin entry is `[min, max]` with `min` inclusive, `max` exclusive.
 * Returns the first matching bin name, or `null` if no bin matches.
 *
 * Uses calendar-bucket counting by default (matches Mixpanel UI). Pass
 * `options.algorithm: 'rolling'` to use the addiction_query.cpp rule
 * instead — see `countDistinctPeriods` for the difference.
 *
 * Replaces total-event counting for any analysis that targets Mixpanel's
 * frequency distribution (which counts distinct periods, not total events).
 *
 * @param {Object[]} events
 * @param {string} eventName
 * @param {Object<string, [number, number]>} bins
 * @param {('hour'|'day'|'week')} [unit='day']
 * @param {Object} [options]
 * @param {('calendar'|'rolling')} [options.algorithm='calendar']
 * @returns {string|null}
 */
export function binByDistinctPeriods(events, eventName, bins, unit = 'day', options = {}) {
	const periods = countDistinctPeriods(events, eventName, unit, options);
	if (!bins || typeof bins !== 'object') return null;
	for (const [name, range] of Object.entries(bins)) {
		if (!Array.isArray(range) || range.length !== 2) continue;
		const [min, max] = range;
		if (periods >= min && periods < max) return name;
	}
	return null;
}
