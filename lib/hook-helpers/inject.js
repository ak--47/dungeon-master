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

const DAY_MS = 86400000;

/**
 * Inject cloned events on days where the user had no activity for this event
 * type. Increases distinct-day frequency without disturbing existing event
 * ordering or inflating same-day counts.
 *
 * Designed for use in `everything` hooks to move users between frequency bins
 * in Mixpanel's frequency distribution reports — which count DISTINCT DAYS
 * (not total events). See `lib/verify/counting.js#countDistinctPeriods` and
 * `mixpanel/analytics` `addiction_query.cpp` for the counting rule.
 *
 * Behavior:
 *   1. Collect all existing distinct UTC days for `eventName`.
 *   2. If the user already has >= `targetDays` distinct days, return unchanged.
 *   3. Restrict candidate days to the user's active window (first event time
 *      to last event time, by default).
 *   4. Pick `targetDays - existing` random days that have no `eventName`
 *      activity (uses seeded RNG).
 *   5. Find a template event of `eventName`; if none exist for this user,
 *      return unchanged (we honor schema-first: don't fabricate events).
 *   6. Clone the template onto each picked day at a random hour within the
 *      day. `insert_id` is stripped (Mixpanel re-deduplicates on import).
 *   7. Append clones to the array. Caller's downstream sort handles ordering.
 *
 * @param {Object[]} events - Full user event array (from `everything` hook).
 * @param {string} eventName - Event name to inject.
 * @param {number} targetDays - Desired absolute count of distinct active days.
 * @param {Object} [options]
 * @param {('active')} [options.timeRange='active'] - 'active' = user's
 *   first-to-last event window. Reserved for future range modes.
 * @param {Object} [options.overrides] - Property overrides applied via spread
 *   on top of the cloned template.
 * @returns {Object[]} The (possibly mutated) events array. Same reference as
 *   the input — convenient to return from an `everything` hook.
 */
export function injectOnNewDays(events, eventName, targetDays, options = {}) {
	if (!Array.isArray(events) || !eventName || typeof targetDays !== 'number' || targetDays <= 0) return events;
	const overrides = options.overrides || {};

	// Collect timestamps for the named event + global window for the user.
	const matches = [];
	const allTimes = [];
	let template = null;
	for (const ev of events) {
		if (!ev) continue;
		const t = toMs(ev.time);
		if (Number.isFinite(t)) allTimes.push(t);
		if (ev.event === eventName && Number.isFinite(t)) {
			matches.push(t);
			template = template || ev;
		}
	}
	if (!template) return events;
	if (!allTimes.length) return events;

	// Distinct UTC days that already have an event of `eventName`.
	const existingDays = new Set();
	for (const t of matches) existingDays.add(Math.floor(t / DAY_MS));
	if (existingDays.size >= targetDays) return events;

	const minMs = Math.min(...allTimes);
	const maxMs = Math.max(...allTimes);
	const firstDay = Math.floor(minMs / DAY_MS);
	const lastDay = Math.floor(maxMs / DAY_MS);

	const candidateDays = [];
	for (let d = firstDay; d <= lastDay; d++) {
		if (!existingDays.has(d)) candidateDays.push(d);
	}
	const need = targetDays - existingDays.size;
	if (candidateDays.length === 0 || need <= 0) return events;

	const chance = getChance();
	// Use chance.pickset for a unique-without-replacement sample from the
	// candidate day pool. If `need` exceeds candidates, fall back to all.
	const pickCount = Math.min(need, candidateDays.length);
	const picked = chance.pickset(candidateDays, pickCount);

	for (const day of picked) {
		// Pick a random ms within this UTC day. Clamp to active window.
		const dayStart = day * DAY_MS;
		const dayEnd = dayStart + DAY_MS - 1;
		const lo = Math.max(dayStart, minMs);
		const hi = Math.min(dayEnd, maxMs);
		const newMs = lo >= hi ? lo : chance.integer({ min: lo, max: hi });
		const clone = { ...template, ...overrides };
		writeTime(clone, newMs);
		delete clone.insert_id;
		events.push(clone);
	}

	return events;
}

