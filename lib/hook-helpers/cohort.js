/**
 * Hook helpers — cohort atoms.
 *
 * Pure functions used inside `everything` / `event` hooks to classify users into
 * behavioral cohorts. None of these mutate the input. They derive a label from a
 * user's events or profile and return it; the caller decides what to do with the
 * label (typically: feed into a `mutate` or `inject` atom).
 */

import { toMs } from './_internal.js';

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
 * FNV-1a 32-bit hash of the FULL id string, mapped to [0, 1).
 *
 * The determinism primitive for hidden cohorts (v1.6). Hashing the whole id
 * matters: the `uid.charCodeAt(0) % N` idiom taught in older recipes biases
 * cohort rates because id alphabets don't cover charcode space uniformly —
 * hex-ish first chars (0-9, a-f) reach only ~2 of 50 residues under `% 50`,
 * so a "2% whale cohort" lands anywhere from 0% to ~12% depending on the id
 * format. FNV-1a diffuses every character, so bucket shares track the target
 * closely regardless of id alphabet.
 *
 * Published FNV-1a 32-bit vectors (draft-eastlake-fnv test suite):
 * `''` → 0x811c9dc5, `'a'` → 0xe40c292c, `'foobar'` → 0xbf9cf968.
 *
 * Uniformity caveat: shares track the target tightly on high-entropy ids —
 * engine-stamped GUIDs measure 5.0% / 19.7% for 5 / 20 targets at n=10k.
 * Short SEQUENTIAL synthetic ids (`usr_1`, `usr_2`, …) can drift a few
 * points (FNV-1a has weak avalanche on short correlated inputs); that's
 * fine for hook use, where ids are GUIDs.
 *
 * @param {string|number} id - User id. Numbers are stringified; null/undefined hash as ''.
 * @returns {number} Deterministic float in [0, 1).
 */
export function hashFloat(id) {
	const s = String(id ?? '');
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0) / 4294967296; // 2^32 → [0, 1)
}

/**
 * Deterministic percent-based cohort membership: true for ~`pct`% of ids.
 * Same id + same pct always agree, and membership nests — every member of
 * `hashCohort(id, 5)` is also a member of `hashCohort(id, 20)`, so tiered
 * cohorts (whale ⊂ engaged) come free.
 *
 * @example
 * // In an everything hook:
 * const isWhale = hashCohort(uid, 2);        // ~2% of users
 * if (isWhale && e.event === 'swap') e.trade_amount_usd *= 50;
 *
 * @param {string|number} id - User id.
 * @param {number} pct - Cohort share as a PERCENTAGE in [0, 100].
 * @returns {boolean}
 */
export function hashCohort(id, pct) {
	if (typeof pct !== 'number' || !Number.isFinite(pct)) return false;
	return hashFloat(id) * 100 < pct;
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

function sortByTime(events) {
	const copy = events.slice();
	copy.sort((a, b) => toMs(a && a.time) - toMs(b && b.time));
	return copy;
}
