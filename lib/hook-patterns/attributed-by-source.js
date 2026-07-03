/**
 * Pattern: Bias attribution by overwriting engine-stamped touches.
 *
 * v1.6 rewrite (recipe 4.26 as code). Under v1.5+ the ENGINE stamps UTMs on
 * up to `maxTouchpointsPerUser` events per user (default 10), sampled across
 * the user's lifetime. Attribution hooks must therefore OVERWRITE the values
 * on already-stamped events, not stamp fresh ones: fresh stamps would push
 * the user past the touchpoint cap and land outside Mixpanel's lookback,
 * where they have no effect on the report.
 *
 * Mechanism: collect the user's engine-stamped touches (events where
 * `property` is non-null), sort by time, and overwrite the touch the chosen
 * attribution model reads — the FIRST touch for `firstTouch`, the LAST for
 * `lastTouch`, or both — with a weighted pick from `weights` (seeded
 * `chance.weighted`, reproducible per run).
 *
 * Schema-first: only events the engine already stamped are touched; the
 * pattern never adds `property` to an unstamped event, so total touch count
 * is unchanged.
 */

import { getChance } from '../utils/utils.js';

/**
 * @param {Array<Object>} events - User's event stream (stamped touches
 *   mutated in place). Call from the `everything` hook — the engine's UTM
 *   stamping has already run by then.
 * @param {Object} _profile
 * @param {Object} opts
 * @param {Record<string, number>} opts.weights - Attribution value → relative
 *   weight (e.g. `{ google: 10, facebook: 5, twitter: 1 }`). The overwrite
 *   value is drawn with probability weight ÷ sum(weights).
 * @param {string} [opts.property='utm_source'] - Engine-stamped property to
 *   overwrite.
 * @param {('firstTouch'|'lastTouch'|'both')} [opts.model='firstTouch'] -
 *   Which stamped touch to overwrite: the one Mixpanel's first-touch model
 *   reads, the last-touch one, or both.
 * @returns {{ overwritten: number, touches: number }} `touches` = stamped
 *   events found; `overwritten` = touches whose value was replaced.
 */
export function applyAttributedBySource(events, _profile, opts) {
	const { weights, property = 'utm_source', model = 'firstTouch' } = opts || {};
	if (!events || !events.length || !weights) return { overwritten: 0, touches: 0 };
	const values = Object.keys(weights).filter(k => typeof weights[k] === 'number' && weights[k] > 0);
	if (!values.length) return { overwritten: 0, touches: 0 };

	const stamped = events
		.filter(e => e && e[property] !== undefined && e[property] !== null)
		.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
	if (!stamped.length) return { overwritten: 0, touches: 0 };

	const chance = getChance();
	const targets = new Set();
	if (model === 'firstTouch' || model === 'both') targets.add(stamped[0]);
	if (model === 'lastTouch' || model === 'both') targets.add(stamped[stamped.length - 1]);

	let overwritten = 0;
	for (const touch of targets) {
		touch[property] = chance.weighted(values, values.map(v => weights[v]));
		overwritten++;
	}
	return { overwritten, touches: stamped.length };
}
