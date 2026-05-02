/**
 * Hook helpers — injection atoms.
 *
 * Splice cloned events into a user's event stream. CRITICAL: per Phase 1 schema-first
 * rules, `templateEvent` should be an existing event from the stream (not a
 * fabricated one), so the injected event carries the dungeon's defined schema. Use
 * `cloneEvent` from `mutate.js` if you want the override semantics explicit.
 *
 * Randomness uses the seeded `chance` instance from utils so dungeons stay reproducible.
 */

import { getChance } from '../utils/utils.js';
import { toMs, writeTime } from './_internal.js';

/**
 * Splice a cloned event into `events` immediately after `sourceEvent`. Time is
 * `sourceEvent.time + gapMs`; `overrides` are shallow-merged on top of `templateEvent`.
 * If `sourceEvent` is not in `events` (caller passed a stale ref), the new event is
 * pushed to the end instead. Returns the newly created event.
 *
 * @param {Array<Object>} events
 * @param {{time: string|number}} sourceEvent
 * @param {Object} templateEvent
 * @param {number} gapMs
 * @param {Object} [overrides]
 * @returns {Object|null}
 */
export function injectAfterEvent(events, sourceEvent, templateEvent, gapMs, overrides = {}) {
	if (!events || !sourceEvent || !templateEvent) return null;
	const baseT = toMs(sourceEvent.time);
	if (!Number.isFinite(baseT)) return null;
	const newEv = { ...templateEvent, ...overrides };
	writeTime(newEv, baseT + gapMs);
	const idx = events.indexOf(sourceEvent);
	if (idx >= 0) events.splice(idx + 1, 0, newEv);
	else events.push(newEv);
	return newEv;
}

/**
 * Splice a cloned event between the first `eventA` and the first `eventB` after
 * it (in time order), at the midpoint of the gap. Returns the new event, or null
 * if either anchor is missing.
 *
 * @param {Array<{event:string,time:string|number}>} events
 * @param {string} eventA
 * @param {string} eventB
 * @param {Object} templateEvent
 * @param {Object} [overrides]
 * @returns {Object|null}
 */
export function injectBetween(events, eventA, eventB, templateEvent, overrides = {}) {
	if (!events || !eventA || !eventB || !templateEvent) return null;
	const sorted = events.slice().sort((x, y) => toMs(x && x.time) - toMs(y && y.time));
	const aIdx = sorted.findIndex(e => e && e.event === eventA);
	if (aIdx < 0) return null;
	const a = sorted[aIdx];
	const b = sorted.slice(aIdx + 1).find(e => e && e.event === eventB);
	if (!b) return null;
	const aT = toMs(a.time);
	const bT = toMs(b.time);
	if (!Number.isFinite(aT) || !Number.isFinite(bT)) return null;
	const newEv = { ...templateEvent, ...overrides };
	writeTime(newEv, (aT + bT) / 2);
	const bIdxOrig = events.indexOf(b);
	if (bIdxOrig >= 0) events.splice(bIdxOrig, 0, newEv);
	else events.push(newEv);
	return newEv;
}

/**
 * Inject `count` clones of `templateEvent` into `events`, distributed uniformly at
 * random within `[anchorTime - spreadMs, anchorTime + spreadMs]`. Uses the seeded
 * RNG. Returns the array of newly created events.
 *
 * @param {Array<Object>} events
 * @param {Object} templateEvent
 * @param {number} count
 * @param {string|number} anchorTime
 * @param {number} spreadMs
 * @param {Object} [overrides]
 * @returns {Object[]}
 */
export function injectBurst(events, templateEvent, count, anchorTime, spreadMs, overrides = {}) {
	if (!events || !templateEvent || count <= 0 || typeof spreadMs !== 'number') return [];
	const anchorMs = toMs(anchorTime);
	if (!Number.isFinite(anchorMs)) return [];
	const chance = getChance();
	const created = [];
	for (let i = 0; i < count; i++) {
		const offset = chance.floating({ min: -spreadMs, max: spreadMs });
		const newEv = { ...templateEvent, ...overrides };
		writeTime(newEv, anchorMs + offset);
		events.push(newEv);
		created.push(newEv);
	}
	return created;
}

