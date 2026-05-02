/**
 * Pattern: Attribute conversions by source.
 *
 * For each user, copy a property value from a "touch" event onto a downstream
 * "conversion" event so Mixpanel's "Conversions by Source" attribution analysis
 * shows the configured weighted distribution. The pattern doesn't invent the
 * source distribution — it preserves whatever the touch events already carry —
 * BUT it lets you bias the conversion completion rate per source via `weights`
 * (probability of stamping = weight ÷ max(weight) ).
 *
 * Mechanism: walk the user's event stream; when a `downstreamEvent` event fires,
 * look back at the most-recent (or first) `sourceEvent` and copy
 * `sourceEvent[sourceProperty]` onto the downstream event. Skip stamping
 * probabilistically per `weights[sourceValue]`.
 *
 * Identity & schema: the destination property must already exist on
 * `downstreamEvent` in the dungeon schema (we OVERWRITE the value, not invent it).
 */

/**
 * @param {Array<Object>} events - User's event stream (mutated in place).
 * @param {Object} _profile
 * @param {Object} opts
 * @param {string} opts.sourceEvent - Event whose property we copy from.
 * @param {string} opts.sourceProperty - Property on `sourceEvent` to copy.
 * @param {string} opts.downstreamEvent - Event whose property we overwrite.
 * @param {string} [opts.downstreamProperty] - Defaults to `sourceProperty`.
 * @param {Record<string, number>} opts.weights - Source value → relative weight
 *   (probability of stamping = weight / maxWeight; missing entries = 0).
 * @param {'firstTouch'|'lastTouch'} [opts.model] - Default 'firstTouch'.
 * @returns {{ stamped: number, skipped: number }}
 */
export function applyAttributedBySource(events, _profile, opts) {
	const { sourceEvent, sourceProperty, downstreamEvent, downstreamProperty, weights, model = 'firstTouch' } = opts || {};
	if (!events || !sourceEvent || !sourceProperty || !downstreamEvent || !weights) {
		return { stamped: 0, skipped: 0 };
	}
	const destProp = downstreamProperty || sourceProperty;
	const sorted = events.slice().sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
	const maxWeight = Math.max(...Object.values(weights), 0);
	if (maxWeight <= 0) return { stamped: 0, skipped: 0 };

	let stamped = 0;
	let skipped = 0;
	const touches = []; // accumulated source events in time order
	for (const ev of sorted) {
		if (!ev) continue;
		if (ev.event === sourceEvent && ev[sourceProperty] !== undefined) {
			touches.push(ev);
			continue;
		}
		if (ev.event === downstreamEvent && touches.length) {
			const touch = model === 'lastTouch' ? touches[touches.length - 1] : touches[0];
			const val = touch[sourceProperty];
			const w = weights[val] || 0;
			const prob = w / maxWeight; // 0..1
			// Deterministic per-user pseudo-RNG keyed on the downstream event's
			// insert_id (or time fallback) — keeps verification reproducible.
			const seed = ev.insert_id || ev.time || '';
			const r = simpleHashFloat(String(seed));
			if (r < prob) {
				ev[destProp] = val;
				stamped++;
			} else {
				skipped++;
			}
		}
	}
	return { stamped, skipped };
}

function simpleHashFloat(s) {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return ((h >>> 0) % 1000) / 1000;
}
