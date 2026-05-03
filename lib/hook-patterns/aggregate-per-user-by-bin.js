/**
 * Pattern: Aggregate per User, by cohort bin.
 *
 * Adjusts the average value of a numeric event property based on the user's
 * cohort bin (derived from `count(cohortEvent)`). Used for "Avg Order Value by
 * per-user count of Sessions" Insights views — engaged users skew avg up.
 *
 * Mechanism: classify, then `scalePropertyValue` with `deltas[bin]` as the
 * multiplier. Property must already be defined on the event in the dungeon
 * schema and carry numeric values.
 */

import { binUsersByEventCount } from '../hook-helpers/cohort.js';
import { scalePropertyValue } from '../hook-helpers/mutate.js';

/**
 * @param {Array<Object>} events - User's event stream (mutated in place).
 * @param {Object} _profile
 * @param {Object} opts
 * @param {string} opts.cohortEvent
 * @param {Record<string, [number, number]>} opts.bins
 * @param {string} opts.event - Event whose property is scaled.
 * @param {string} opts.propertyName
 * @param {Record<string, number>} opts.deltas - Bin name → multiplier (1 = no-op,
 *   1.5 = 50% lift, 0.7 = 30% drop).
 * @returns {{ bin: string|null, scaled: number }}
 */
export function applyAggregateByBin(events, _profile, { cohortEvent, bins, event, propertyName, deltas }) {
	if (!events || !cohortEvent || !bins || !event || !propertyName || !deltas) {
		return { bin: null, scaled: 0 };
	}
	const bin = binUsersByEventCount(events, cohortEvent, bins);
	if (!bin) return { bin: null, scaled: 0 };
	const factor = deltas[bin];
	if (typeof factor !== 'number' || factor === 1) return { bin, scaled: 0 };
	const scaled = scalePropertyValue(events, e => e && e.event === event, propertyName, factor);
	return { bin, scaled };
}
