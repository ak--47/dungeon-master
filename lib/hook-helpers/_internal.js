import { hashInsertId } from '../utils/utils.js';

/**
 * Give a cloned event its own `insert_id`.
 *
 * Clones MUST NOT inherit their template's id, and stripping the id is not
 * enough either: mixpanel-import runs with `fixData: true`, which synthesizes a
 * missing id by content-hashing the record — so two clones that differ only in
 * ways the hash ignores collapse into one on ingest. Mixpanel then dedupes them
 * server-side and the engineered volume silently disappears from the project
 * while local verification (which never looks at `insert_id`) still passes.
 *
 * The new id hashes the template's id with the clone's event, time, and
 * identity, so it is deterministic under a seeded run. Two clones that land on
 * the same time from the same template hash alike; the engine's final
 * per-user uniqueness pass re-stamps the second one (also deterministically).
 *
 * @template {{insert_id?: string}} T
 * @param {T} clone
 * @returns {T} the same object, with a fresh `insert_id`
 */
export function stampFreshInsertId(clone) {
	const c = /** @type {Record<string, any>} */ (clone);
	clone.insert_id = hashInsertId(`clone|${c.insert_id ?? ''}|${c.event ?? ''}|${c.time ?? ''}|${c.user_id ?? ''}|${c.device_id ?? ''}`);
	return clone;
}

/**
 * Spread a template into a new event, merge `overrides`, and give it a fresh
 * `insert_id` — unless the caller pinned one explicitly.
 *
 * Every clone site should go through this so the override contract is uniform:
 * a caller that passes `insert_id` in `overrides` keeps it, and everyone else
 * gets a unique id rather than a duplicate of the template's.
 *
 * @template {Record<string, any>} T
 * @param {T} template - Event to clone from.
 * @param {Record<string, any>} [overrides] - Fields to merge on top.
 * @param {number} [ms] - Clone time in ms. Written BEFORE the id is stamped, so
 *   the id hashes the clone's final time and sibling clones stay distinct.
 * @returns {T} the new event
 */
export function cloneWithFreshId(template, overrides = {}, ms) {
	const clone = /** @type {T} */ ({ ...template, ...overrides });
	if (ms !== undefined) writeTime(clone, ms);
	if (!(overrides && 'insert_id' in overrides)) stampFreshInsertId(clone);
	return clone;
}

export function toMs(t) {
	if (typeof t === 'number') return t > 1e12 ? t : t > 1e9 ? t * 1000 : t;
	return Date.parse(t);
}

export function writeTime(event, ms) {
	if (typeof event.time === 'string' || event.time === undefined) {
		event.time = new Date(ms).toISOString();
	} else if (event.time > 1e12) {
		event.time = ms;
	} else {
		event.time = ms / 1000;
	}
}

export function simpleHashFloat(s) {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return ((h >>> 0) % 1000) / 1000;
}
