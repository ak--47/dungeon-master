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
import { matchesWhere } from './coerce.js';

const SECONDS_PER_UNIT = {
	hour: 3600,
	day: 86400,
	week: 7 * 86400,
};

/**
 * Count distinct time periods on which a user fired a given event.
 *
 * Two related rules exist in Mixpanel — v1.6.0 (P1.10, findings #3) names
 * them for what they are:
 *
 * 1. **`'ui-bucket'`** (default): `COUNT(DISTINCT date_trunc(unit, time))`
 *    in UTC — calendar-bucket counting, the shape the Mixpanel UI presents
 *    in frequency distribution charts.
 *
 * 2. **`'mixpanel-rolling'`**: the addiction_query.cpp rule,
 *    `qtz_time >= interval->last_counted + seconds_for_unit(unit)`
 *    (addiction_query_update_history, addiction_query.cpp:363-374). This
 *    is what Mixpanel's C++ reader actually computes. It diverges from
 *    calendar bucketing at unit boundaries — events at 23:59 and 00:01
 *    next day register as 1 rolling period (gap 120s < 86400s) but 2
 *    calendar days.
 *
 * **The default does NOT match addiction_query.cpp's rolling rule.** It is
 * kept because it matches what users see in report buckets, and because it
 * aligns with `injectOnNewDays` (which classifies days by
 * `Math.floor(t / DAY_MS)`); mixing the two algorithms makes the atom and
 * verifier disagree at boundaries. For the actual Frequency report output
 * shape (per-interval rolling counters + histogram), use
 * `frequencyHistogram` instead.
 *
 * `'calendar'` and `'rolling'` remain accepted as silent back-compat
 * aliases for `'ui-bucket'` / `'mixpanel-rolling'`.
 *
 * @param {Object[]} events - Events to scan (mixed types OK).
 * @param {string} eventName - Event name to filter for.
 * @param {('hour'|'day'|'week')} [unit='day']
 * @param {Object} [options]
 * @param {('ui-bucket'|'mixpanel-rolling'|'calendar'|'rolling')} [options.algorithm='ui-bucket']
 * @returns {number} Distinct period count.
 */
export function countDistinctPeriods(events, eventName, unit = 'day', options = {}) {
	const seconds = SECONDS_PER_UNIT[unit];
	if (!seconds) throw new Error(`countDistinctPeriods: unsupported unit "${unit}"`);
	const algorithm = normalizeDistinctPeriodAlgorithm(options.algorithm);
	if (!Array.isArray(events) || !events.length) return 0;
	const matches = events
		.filter(e => e && e.event === eventName)
		.map(e => toMs(e.time))
		.filter(ms => Number.isFinite(ms));
	if (!matches.length) return 0;
	const unitMs = seconds * 1000;

	if (algorithm === 'ui-bucket') {
		// Calendar bucket — UTC floor by unit. Matches what Mixpanel's UI
		// shows and what `injectOnNewDays` uses internally.
		const buckets = new Set();
		for (const t of matches) buckets.add(Math.floor(t / unitMs));
		return buckets.size;
	}

	// Rolling window — addiction_query.cpp:363-374 semantics.
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
 * Normalize the countDistinctPeriods algorithm name. `'calendar'` and
 * `'rolling'` are silent v1.5 back-compat aliases; unknown names throw
 * (they previously fell through to the rolling branch silently).
 *
 * @param {string} [algorithm]
 * @returns {('ui-bucket'|'mixpanel-rolling')}
 */
function normalizeDistinctPeriodAlgorithm(algorithm) {
	switch (algorithm) {
		case undefined:
		case 'ui-bucket':
		case 'calendar':
			return 'ui-bucket';
		case 'mixpanel-rolling':
		case 'rolling':
			return 'mixpanel-rolling';
		default:
			throw new Error(`countDistinctPeriods: unknown algorithm "${algorithm}" — use 'ui-bucket' or 'mixpanel-rolling'`);
	}
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
 * v1.6.0 (P1.10): `{ flatten: true }` mirrors the ACTION_TYPE_AVERAGE
 * VALUE_TYPE_LIST branch (`normal_query.cpp:1601-1617`): a list-valued
 * property contributes each numeric ITEM independently — every item adds
 * to the numerator AND increments the denominator. One level only
 * (`list_cursor_next` items must themselves be VALUE_TYPE_NUMBER; a
 * nested list item is skipped, not recursed). Non-numeric items inside a
 * list are skipped. Default stays non-flattening: without the opt-in, an
 * array value is non-numeric and is skipped whole — the explicit flag
 * avoids silently changing v1.5 results for 1-item-array data.
 * (ARB's list branch carries no isnan guard — the scalar branch does —
 * but NaN can't arrive via JSON ingestion; we keep the same finite guard
 * on items as on scalars.)
 *
 * @param {*[]} values
 * @param {Object} [options]
 * @param {boolean} [options.flatten=false]
 * @returns {number|null}
 */
export function nullAwareAvg(values, options = {}) {
	if (!Array.isArray(values) || !values.length) return null;
	const { flatten = false } = options;
	let sum = 0;
	let count = 0;
	for (const v of values) {
		if (typeof v === 'number' && Number.isFinite(v)) {
			sum += v;
			count++;
		} else if (flatten && Array.isArray(v)) {
			for (const item of v) {
				if (typeof item === 'number' && Number.isFinite(item)) {
					sum += item;
					count++;
				}
			}
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
 * v1.6.0 (P1.10): `{ flatten: true }` mirrors the ACTION_TYPE_SUM
 * VALUE_TYPE_LIST branch (`normal_query.cpp:1585-1600`): each numeric
 * item of a list-valued property adds to the sum independently, one
 * level only, non-numeric items skipped. Same explicit opt-in rationale
 * as `nullAwareAvg`.
 *
 * @param {*[]} values
 * @param {Object} [options]
 * @param {boolean} [options.flatten=false]
 * @returns {number}
 */
export function nullAwareSum(values, options = {}) {
	if (!Array.isArray(values) || !values.length) return 0;
	const { flatten = false } = options;
	let sum = 0;
	for (const v of values) {
		if (typeof v === 'number' && Number.isFinite(v)) sum += v;
		else if (flatten && Array.isArray(v)) {
			for (const item of v) {
				if (typeof item === 'number' && Number.isFinite(item)) sum += item;
			}
		}
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
 * v1.5.1: count distinct values of a flat property across events.
 *
 * Mixpanel parity: `COUNT_DISTINCT(prop)` aggregator (Insights). Skips
 * null/undefined/empty-string values. Returns the distinct-value count plus
 * the top-N most-frequent values (default 25, matching Mixpanel UI default).
 *
 * Property keys are FLAT on event records per the dungeon-master schema
 * contract (see HOOKS.md §1) — no dot-path support.
 *
 * @param {Object[]} events
 * @param {string} property - Flat property name.
 * @param {Object} [options]
 * @param {string} [options.event] - Optional event-name filter.
 * @param {number} [options.topN=25] - Number of top values to include in the result.
 * @returns {{ distinct_count: number, top_values: Array<{ value: any, count: number }> }}
 */
export function countDistinctValues(events, property, options = {}) {
	if (!Array.isArray(events)) throw new Error('countDistinctValues: events must be an array');
	if (typeof property !== 'string' || !property) throw new Error('countDistinctValues: property is required');
	const topN = Number.isFinite(options.topN) && options.topN > 0 ? Math.floor(options.topN) : 25;
	const filterEvent = typeof options.event === 'string' && options.event ? options.event : null;
	const valueCounts = new Map();
	for (const e of events) {
		if (!e || typeof e !== 'object') continue;
		if (filterEvent && e.event !== filterEvent) continue;
		const v = e[property];
		if (v === null || v === undefined || v === '') continue;
		// Hashable normalization — Map keys distinguish primitives but objects
		// use reference identity. For Mixpanel parity, stringify non-primitives.
		const key = (typeof v === 'object') ? JSON.stringify(v) : v;
		valueCounts.set(key, (valueCounts.get(key) || 0) + 1);
	}
	const sorted = [...valueCounts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, topN)
		.map(([value, count]) => ({ value, count }));
	return { distinct_count: valueCounts.size, top_values: sorted };
}

/**
 * Partition events into time buckets by UTC calendar (`day`, `week`, or
 * `month`). Used by `emulateBreakdown` when `timeBucket` is set to slice any
 * breakdown into a trend over time.
 *
 * Period labels:
 *   - `'day'`   → `YYYY-MM-DD`
 *   - `'week'`  → ISO week `YYYY-Www` (Monday-anchored)
 *   - `'month'` → `YYYY-MM`
 *
 * Mixpanel parity: bucket boundaries are computed in UTC. Production Mixpanel
 * uses query timezone (qtz); pass timestamps already shifted to qtz if you
 * need that behavior. ISO week is Monday-anchored
 * (matches `eval_node.c:3641-3643`).
 *
 * Empty-bucket backfill (Mixpanel `normal_query.cpp:352-356, 310-313` emits
 * zero rows for empty intervals): when `options.from` AND `options.to` are
 * provided, the result enumerates every bucket in `[from, to]` and emits
 * `{ period, events: [] }` for buckets with no events. Without `from`/`to`,
 * only buckets that contain at least one event are returned.
 *
 * @param {Object[]} events
 * @param {('day'|'week'|'month')} bucket
 * @param {Object} [options]
 * @param {number|string} [options.from] - Inclusive range start (ms or ISO).
 * @param {number|string} [options.to] - Inclusive range end (ms or ISO).
 * @returns {Array<{ period: string, events: Object[] }>}
 */
export function partitionByTimeBucket(events, bucket, options = {}) {
	const groups = new Map();
	if (Array.isArray(events)) {
		for (const ev of events) {
			const ms = toMs(ev && ev.time);
			if (!Number.isFinite(ms)) continue;
			const period = formatBucket(ms, bucket);
			if (!groups.has(period)) groups.set(period, []);
			groups.get(period).push(ev);
		}
	}
	const fromMs = options.from != null ? toMs(options.from) : null;
	const toMsBound = options.to != null ? toMs(options.to) : null;
	if (Number.isFinite(fromMs) && Number.isFinite(toMsBound)) {
		// Enumerate every bucket period in [from, to] and seed empties.
		for (const period of enumerateBucketPeriods(fromMs, toMsBound, bucket)) {
			if (!groups.has(period)) groups.set(period, []);
		}
	}
	return [...groups.entries()]
		.map(([period, evs]) => ({ period, events: evs }))
		.sort((a, b) => a.period.localeCompare(b.period));
}

/**
 * Enumerate canonical bucket period labels covering `[fromMs, toMs]` UTC.
 * Used to backfill empty rows when the caller supplies a trend axis.
 *
 * @param {number} fromMs
 * @param {number} toMs
 * @param {('day'|'week'|'month')} bucket
 * @returns {string[]}
 */
function enumerateBucketPeriods(fromMs, toMs, bucket) {
	const out = [];
	if (!(toMs >= fromMs)) return out;
	if (bucket === 'day') {
		const start = Math.floor(fromMs / 86400_000);
		const end = Math.floor(toMs / 86400_000);
		for (let d = start; d <= end; d++) out.push(formatBucket(d * 86400_000, 'day'));
	} else if (bucket === 'week') {
		// Walk by 7 days starting from fromMs; rely on label dedup via Set.
		const seen = new Set();
		for (let t = fromMs; t <= toMs; t += 7 * 86400_000) {
			const p = formatBucket(t, 'week'); if (!seen.has(p)) { seen.add(p); out.push(p); }
		}
		const last = formatBucket(toMs, 'week');
		if (!seen.has(last)) out.push(last);
	} else if (bucket === 'month') {
		const seen = new Set();
		const start = new Date(fromMs);
		const end = new Date(toMs);
		let y = start.getUTCFullYear(), m = start.getUTCMonth();
		const yEnd = end.getUTCFullYear(), mEnd = end.getUTCMonth();
		while (y < yEnd || (y === yEnd && m <= mEnd)) {
			const p = formatBucket(Date.UTC(y, m, 1), 'month');
			if (!seen.has(p)) { seen.add(p); out.push(p); }
			m++; if (m > 11) { m = 0; y++; }
		}
	}
	return out;
}

/**
 * Resolve a bucket period label back to its UTC millisecond bounds.
 * `startMs` inclusive, `endMs` exclusive — the `[start, stop)` convention
 * Mixpanel uses for trend intervals (funnel_query.cpp:1398-1401 anchors
 * step 0 in `[start, stop)`). Inverse of the labels `partitionByTimeBucket`
 * emits: `YYYY-MM-DD` (day), `YYYY-Www` (ISO week, Monday-anchored),
 * `YYYY-MM` (month).
 *
 * @param {string} period
 * @param {('day'|'week'|'month')} bucket
 * @returns {{ startMs: number, endMs: number }}
 */
export function bucketBoundsMs(period, bucket) {
	if (bucket === 'day') {
		const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(period);
		if (!m) throw new Error(`bucketBoundsMs: bad day period "${period}"`);
		const startMs = Date.UTC(+m[1], +m[2] - 1, +m[3]);
		return { startMs, endMs: startMs + 86400_000 };
	}
	if (bucket === 'month') {
		const m = /^(\d{4})-(\d{2})$/.exec(period);
		if (!m) throw new Error(`bucketBoundsMs: bad month period "${period}"`);
		return {
			startMs: Date.UTC(+m[1], +m[2] - 1, 1),
			endMs: Date.UTC(+m[1], +m[2], 1),
		};
	}
	if (bucket === 'week') {
		const m = /^(\d{4})-W(\d{2})$/.exec(period);
		if (!m) throw new Error(`bucketBoundsMs: bad week period "${period}"`);
		// Monday of ISO week w: week 1 contains Jan 4 (same anchor formatBucket uses).
		const year = +m[1], week = +m[2];
		const jan4 = new Date(Date.UTC(year, 0, 4));
		const jan4DayNum = (jan4.getUTCDay() + 6) % 7;
		const week1MonMs = Date.UTC(year, 0, 4 - jan4DayNum);
		const startMs = week1MonMs + (week - 1) * 7 * 86400_000;
		return { startMs, endMs: startMs + 7 * 86400_000 };
	}
	throw new Error(`bucketBoundsMs: unsupported bucket "${bucket}"`);
}

function pad2(n) { return n < 10 ? `0${n}` : `${n}`; }

function formatBucket(ms, bucket) {
	const d = new Date(ms);
	if (bucket === 'day') {
		return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
	}
	if (bucket === 'month') {
		return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
	}
	if (bucket === 'week') {
		// ISO week: Mon-anchored. Algorithm: shift to Thursday of the week,
		// take year of that Thursday + week number relative to Jan-1 of that
		// year's Monday-of-Thursday.
		const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
		const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0..Sun=6
		date.setUTCDate(date.getUTCDate() - dayNum + 3); // Thursday of this week
		const year = date.getUTCFullYear();
		const jan4 = new Date(Date.UTC(year, 0, 4));
		const jan4DayNum = (jan4.getUTCDay() + 6) % 7;
		const week1Mon = new Date(Date.UTC(year, 0, 4 - jan4DayNum));
		const weekNum = Math.floor((date.getTime() - week1Mon.getTime()) / (7 * 86400_000)) + 1;
		return `${year}-W${pad2(weekNum)}`;
	}
	throw new Error(`partitionByTimeBucket: unsupported bucket "${bucket}"`);
}

/**
 * Bin a user by their distinct-period count of an event. Combines
 * `countDistinctPeriods` with bin classification for cohort assignment.
 *
 * Each bin entry is `[min, max]` with `min` inclusive, `max` exclusive.
 * Returns the first matching bin name, or `null` if no bin matches.
 *
 * Uses `'ui-bucket'` (calendar) counting by default — matches Mixpanel's
 * UI buckets, NOT addiction_query.cpp's rolling rule. Pass
 * `options.algorithm: 'mixpanel-rolling'` for the C++ rule — see
 * `countDistinctPeriods` for the difference.
 *
 * Replaces total-event counting for any analysis that targets Mixpanel's
 * frequency distribution (which counts distinct periods, not total events).
 *
 * @param {Object[]} events
 * @param {string} eventName
 * @param {Object<string, [number, number]>} bins
 * @param {('hour'|'day'|'week')} [unit='day']
 * @param {Object} [options]
 * @param {('ui-bucket'|'mixpanel-rolling'|'calendar'|'rolling')} [options.algorithm='ui-bucket']
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

/**
 * Count events, optionally filtered by event name and a `where` object —
 * Mixpanel's plain ACTION_TYPE_COUNT (action.h:14; each qualifying event
 * increments the interval count by one — normal_query.cpp
 * `result->count += q->upsampling_factor`). `where` string comparison is
 * case-INSENSITIVE per the WHERE-filter rulebook (see coerce.js).
 *
 * @param {Object[]} events
 * @param {Object} [options]
 * @param {string} [options.event] restrict to this event name
 * @param {Object<string, *>} [options.where] `{ prop: value | { op, value } }`
 * @returns {number}
 */
export function countEvents(events, options = {}) {
	const { event, where } = options;
	let count = 0;
	for (const e of events) {
		if (!e || (event && e.event !== event)) continue;
		if (!matchesWhere(e, where)) continue;
		count++;
	}
	return count;
}
