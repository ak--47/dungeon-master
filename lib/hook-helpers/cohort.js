/**
 * Hook helpers — cohort atoms.
 *
 * Pure functions used inside `everything` / `event` hooks to classify users into
 * behavioral cohorts. None of these mutate the input. They derive a label from a
 * user's events or profile and return it; the caller decides what to do with the
 * label (typically: feed into a `mutate` or `inject` atom).
 */

/**
 * Classify a user into a named bin based on the count of a specific event in their stream.
 * Bin definitions use inclusive lower bound, exclusive upper bound (`[lo, hi)`).
 *
 * @example
 * const tier = binUsersByEventCount(events, 'Complete Action Item', {
 *   low:   [0, 5],
 *   sweet: [5, 20],
 *   over:  [20, Infinity],
 * });
 *
 * @param {Array<{event:string,time?:string|number}>} events - User's event stream.
 * @param {string} eventName - Event to count.
 * @param {Record<string, [number, number]>} bins - Map of bin name → [lo, hi).
 * @returns {string|null} Matching bin name, or null if no bin matches.
 */
export function binUsersByEventCount(events, eventName, bins) {
	if (!events || !eventName || !bins) return null;
	let count = 0;
	for (const ev of events) {
		if (ev && ev.event === eventName) count++;
	}
	for (const [name, range] of Object.entries(bins)) {
		if (!Array.isArray(range) || range.length !== 2) continue;
		const [lo, hi] = range;
		if (count >= lo && count < hi) return name;
	}
	return null;
}

/**
 * Like `binUsersByEventCount` but only counts events whose timestamp falls inside
 * `[startTime, endTime]` (inclusive). Times can be unix milliseconds, unix seconds,
 * ISO strings, or anything `Date.parse` accepts.
 *
 * @param {Array<{event:string,time:string|number}>} events
 * @param {string} eventName
 * @param {string|number} startTime
 * @param {string|number} endTime
 * @param {Record<string, [number, number]>} bins
 * @returns {string|null}
 */
export function binUsersByEventInRange(events, eventName, startTime, endTime, bins) {
	if (!events || !eventName || !bins) return null;
	const startMs = toMs(startTime);
	const endMs = toMs(endTime);
	if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
	let count = 0;
	for (const ev of events) {
		if (!ev || ev.event !== eventName || ev.time === undefined) continue;
		const t = toMs(ev.time);
		if (Number.isFinite(t) && t >= startMs && t <= endMs) count++;
	}
	for (const [name, range] of Object.entries(bins)) {
		if (!Array.isArray(range) || range.length !== 2) continue;
		const [lo, hi] = range;
		if (count >= lo && count < hi) return name;
	}
	return null;
}

/**
 * Count events that occur strictly between the FIRST `eventA` and the FIRST `eventB`
 * after it in the stream. Useful for "how many ${X} did the user do between landing
 * and converting" measurements that hooks then condition on.
 *
 * @param {Array<{event:string,time:string|number}>} events
 * @param {string} eventA
 * @param {string} eventB
 * @returns {number} Count, or 0 if either anchor is missing.
 */
export function countEventsBetween(events, eventA, eventB) {
	if (!events || !eventA || !eventB) return 0;
	const sorted = sortByTime(events);
	const a = sorted.find(e => e && e.event === eventA);
	if (!a) return 0;
	const aIdx = sorted.indexOf(a);
	const b = sorted.slice(aIdx + 1).find(e => e && e.event === eventB);
	if (!b) return 0;
	const aT = toMs(a.time);
	const bT = toMs(b.time);
	let n = 0;
	for (const ev of sorted) {
		if (!ev || ev.time === undefined) continue;
		const t = toMs(ev.time);
		if (Number.isFinite(t) && t > aT && t < bT) n++;
	}
	return n;
}

/**
 * Profile-based cohort check. Returns true if `profile[segmentKey]` matches one of
 * `segmentValues` (array) or equals the single value passed.
 *
 * @param {Object} profile
 * @param {string} segmentKey
 * @param {*|Array<*>} segmentValues
 * @returns {boolean}
 */
export function userInProfileSegment(profile, segmentKey, segmentValues) {
	if (!profile || !segmentKey) return false;
	const v = profile[segmentKey];
	if (Array.isArray(segmentValues)) return segmentValues.includes(v);
	return v === segmentValues;
}

// ── internal helpers ──

function toMs(t) {
	if (typeof t === 'number') {
		// Heuristic: small numbers are unix seconds.
		return t > 1e12 ? t : t > 1e9 ? t * 1000 : t;
	}
	return Date.parse(t);
}

function sortByTime(events) {
	const copy = events.slice();
	copy.sort((a, b) => toMs(a && a.time) - toMs(b && b.time));
	return copy;
}
