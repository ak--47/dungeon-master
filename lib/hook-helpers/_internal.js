import { randomUUID } from 'crypto';

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
 * `insert_id` is already assigned via `randomUUID()` in the event generator, so
 * it sits outside the seeded byte-identical-output guarantee; using it here
 * keeps clone ids consistent with engine-generated ones.
 *
 * @template {{insert_id?: string}} T
 * @param {T} clone
 * @returns {T} the same object, with a fresh `insert_id`
 */
export function stampFreshInsertId(clone) {
	clone.insert_id = randomUUID();
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
