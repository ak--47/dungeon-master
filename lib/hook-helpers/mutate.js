/**
 * Hook helpers — mutation atoms.
 *
 * In-place mutation primitives that hooks call to scale, drop, or modify events.
 * These are deliberately tiny and composable so patterns built on top stay readable.
 *
 * Randomness uses the seeded `chance` instance from `lib/utils/utils.js` — never
 * `Math.random()` — so dungeon runs stay reproducible.
 */

import { toMs, stampFreshInsertId, cloneWithFreshId } from './_internal.js';

import { getChance } from '../utils/utils.js';

/**
 * Returns a new event object built from `template` with `overrides` shallow-merged
 * on top. Mandatory replacement fields (time, user_id, etc.) belong in `overrides`.
 * The schema-first hook rule still applies: only properties that already exist in
 * the dungeon's event config should be set in `overrides`.
 *
 * @template {Record<string, any>} T
 * @param {T} template
 * @param {Partial<T>} [overrides]
 * @returns {T}
 */
export function cloneEvent(template, overrides = {}) {
	if (!template) throw new Error('cloneEvent: template is required');
	// A clone that keeps its template's insert_id is deduped away by Mixpanel on
	// ingest. Callers may still pin one explicitly via overrides.
	return /** @type {T} */ (cloneWithFreshId(template, overrides));
}

/**
 * Drop events where `predicate(event, index)` is truthy. Mutates `events` in place.
 *
 * @param {Array<Object>} events
 * @param {(event: Object, index: number) => boolean} predicate
 * @returns {number} Number of events dropped.
 */
export function dropEventsWhere(events, predicate) {
	if (!events || typeof predicate !== 'function') return 0;
	let dropped = 0;
	for (let i = events.length - 1; i >= 0; i--) {
		if (predicate(events[i], i)) {
			events.splice(i, 1);
			dropped++;
		}
	}
	return dropped;
}

/**
 * Scale the count of events with name `eventName` in `events` by `factor`. Mutates
 * `events` in place.
 *
 * - factor > 1: clones existing matches. Returns positive integer = clones added.
 * - factor < 1: drops matches at random using the seeded RNG. Returns negative
 *   integer = -dropped.
 * - factor === 1 or no matches: no-op, returns 0.
 *
 * ## WARNING — the default spread cannot move frequency or session metrics
 *
 * By default clones land 1 second after their source (monotonic 1s steps). One
 * second is not enough to create a new distinct active day, and not enough to
 * open a new session under Mixpanel's 30-minute inactivity gap. So a default
 * `scaleEventCount` call raises **event volume only**. It does NOT raise:
 *
 *   - active days per user / DAU / stickiness (DAU÷MAU)
 *   - sessions per user or session count
 *   - "days active" or frequency-of-use reports
 *   - retention, which is computed on distinct days
 *
 * If your story claims any of those, pass `{ spreadDays: N }` to scatter clones
 * across the following N days, or use `injectOnNewDays` — the helper built for
 * exactly this.
 *
 * Note: cloned events get a FRESH `insert_id` — they must not inherit the
 * source's, and leaving it blank is not safe either (the importer content-hashes
 * missing ids, so identical clones collide and Mixpanel dedupes them away).
 *
 * @param {Array<{event:string,time:string|number,insert_id?:string}>} events
 * @param {string} eventName
 * @param {number} factor
 * @param {{spreadDays?: number}} [options] - `spreadDays`: scatter clones uniformly
 *   over `[source_time, source_time + spreadDays]` instead of stepping 1s at a time.
 *   Use this when the clones must land on new calendar days or in new sessions.
 *   Clones that land past `FIXED_NOW` are dropped by the engine's future-time guard,
 *   so a large `spreadDays` on late-window events yields fewer surviving clones than
 *   the return value reports.
 * @returns {number}
 */
export function scaleEventCount(events, eventName, factor, options = {}) {
	if (!events || !eventName || typeof factor !== 'number' || factor === 1) return 0;
	const { spreadDays } = options || {};
	const spreadMs = (Number.isFinite(spreadDays) && spreadDays > 0)
		? spreadDays * 86_400_000
		: 0;
	if (factor > 1) {
		const matches = events.filter(e => e && e.event === eventName);
		if (!matches.length) return 0;
		const additionalNeeded = Math.round(matches.length * (factor - 1));
		const chance = spreadMs ? getChance() : null;
		let added = 0;
		for (let i = 0; i < additionalNeeded; i++) {
			const src = matches[i % matches.length];
			const baseMs = toMs(src.time);
			let newTime;
			if (!Number.isFinite(baseMs)) {
				newTime = src.time;
			} else if (spreadMs) {
				// Seeded uniform offset across the spread window. Floor at 1s so a
				// clone never collides exactly with its source's timestamp.
				const offset = Math.max(1000, Math.round(chance.floating({ min: 0, max: spreadMs })));
				newTime = new Date(baseMs + offset).toISOString();
			} else {
				newTime = new Date(baseMs + (i + 1) * 1000).toISOString();
			}
			const clone = stampFreshInsertId({ ...src, time: newTime });
			events.push(clone);
			added++;
		}
		return added;
	}
	// factor < 1 → drop at random
	const chance = getChance();
	const dropProb = Math.max(0, Math.min(1, 1 - factor));
	let dropped = 0;
	for (let i = events.length - 1; i >= 0; i--) {
		const ev = events[i];
		if (ev && ev.event === eventName && chance.bool({ likelihood: dropProb * 100 })) {
			events.splice(i, 1);
			dropped++;
		}
	}
	return -dropped;
}

/**
 * For each event in `events` matching `predicate`, multiply the numeric value at
 * `propertyName` by `factor`. Skips events where the property is missing or non-numeric.
 *
 * @param {Array<Object>} events
 * @param {(event: Object) => boolean} predicate
 * @param {string} propertyName
 * @param {number} factor
 * @returns {number} Number of events whose property was scaled.
 */
export function scalePropertyValue(events, predicate, propertyName, factor) {
	if (!events || typeof predicate !== 'function' || !propertyName || typeof factor !== 'number') return 0;
	let count = 0;
	for (const ev of events) {
		if (!ev || !predicate(ev)) continue;
		const v = ev[propertyName];
		if (typeof v === 'number') {
			ev[propertyName] = v * factor;
			count++;
		}
	}
	return count;
}

/**
 * Shift a single event's `time` by `deltaMs` milliseconds. Mutates the event in place.
 * Accepts ISO string or numeric (unix ms / unix seconds) inputs and writes back in
 * the original format.
 *
 * @param {{time: string|number}} event
 * @param {number} deltaMs
 * @returns {Object} The mutated event.
 */
export function shiftEventTime(event, deltaMs) {
	if (!event || event.time === undefined || event.time === null) return event;
	if (typeof event.time === 'string') {
		const ms = Date.parse(event.time);
		if (Number.isFinite(ms)) {
			event.time = new Date(ms + deltaMs).toISOString();
		}
	} else if (typeof event.time === 'number') {
		// Preserve scale (seconds vs ms).
		if (event.time > 1e12) {
			event.time = event.time + deltaMs;
		} else {
			event.time = event.time + deltaMs / 1000;
		}
	}
	return event;
}
