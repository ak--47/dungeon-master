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
 * Matches Mixpanel's "addiction" / frequency distribution counting from
 * `backend/arb/reader/queries/addiction_query.cpp`:
 *
 *     if (qtz_time >= interval->last_counted + seconds_for_unit(addiction_unit)) {
 *         interval->last_counted = qtz_time;
 *         interval->count++;
 *     }
 *
 * Walk the user's events sorted by time. For each event, increment the
 * count only if its timestamp is at least `seconds_for_unit` after the
 * previously counted event. This is NOT the same as bucketing by calendar
 * day — two events at 00:00:01 and 23:59:59 of the same UTC day would be
 * counted twice (different calendar day buckets) under naive SQL but only
 * once under Mixpanel's rolling-window check (gap < 86400s).
 *
 * For our generated data the difference is negligible: events on the same
 * calendar day are typically sub-second apart (same session) or hours
 * apart (different sessions but well within 24h). The rule is implemented
 * as Mixpanel implements it.
 *
 * The naive SQL equivalent that comes closest:
 *     COUNT(DISTINCT date_trunc('day', time))
 * which differs at calendar boundaries.
 *
 * @param {Object[]} events - Events to scan (mixed types OK).
 * @param {string} eventName - Event name to filter for.
 * @param {('hour'|'day'|'week')} [unit='day']
 * @returns {number} Distinct period count.
 */
export function countDistinctPeriods(events, eventName, unit = 'day') {
	const seconds = SECONDS_PER_UNIT[unit];
	if (!seconds) throw new Error(`countDistinctPeriods: unsupported unit "${unit}"`);
	if (!Array.isArray(events) || !events.length) return 0;
	const matches = events
		.filter(e => e && e.event === eventName)
		.map(e => toMs(e.time))
		.filter(ms => Number.isFinite(ms))
		.sort((a, b) => a - b);
	if (!matches.length) return 0;
	const unitMs = seconds * 1000;
	let count = 0;
	let lastCountedMs = -Infinity;
	for (const t of matches) {
		// Match `qtz_time >= last_counted + seconds_for_unit`. With
		// last_counted starting at -Infinity, the first event always counts.
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
 * Replaces total-event counting for any analysis that targets Mixpanel's
 * frequency distribution (which counts distinct periods, not total events).
 *
 * @param {Object[]} events
 * @param {string} eventName
 * @param {Object<string, [number, number]>} bins
 * @param {('hour'|'day'|'week')} [unit='day']
 * @returns {string|null}
 */
export function binByDistinctPeriods(events, eventName, bins, unit = 'day') {
	const periods = countDistinctPeriods(events, eventName, unit);
	if (!bins || typeof bins !== 'object') return null;
	for (const [name, range] of Object.entries(bins)) {
		if (!Array.isArray(range) || range.length !== 2) continue;
		const [min, max] = range;
		if (periods >= min && periods < max) return name;
	}
	return null;
}
