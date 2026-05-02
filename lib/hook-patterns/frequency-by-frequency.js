/**
 * Pattern: Frequency × Frequency.
 *
 * Engineers the joint distribution of `count(metricEvent)` × `count(cohortEvent)`
 * per user, so Mixpanel's "Frequency Distribution of A by per-user count of B"
 * Insights view shows a deliberate shape (e.g., users with 5–20 cohort events
 * have 2x the metric event count of users with <5).
 *
 * Mechanism: classify the user into a bin based on their `cohortEvent` count,
 * then `scaleEventCount(events, targetEvent, multipliers[bin])` to scale that
 * user's count of the target event up or down.
 *
 * Identity & schema constraints:
 * - Operates on the user's full event stream — call from the `everything` hook.
 * - Does NOT add new properties; uses existing event names defined in the dungeon
 *   schema.
 * - Cloned events have their `insert_id` stripped (mutate.scaleEventCount handles
 *   that), so the engine's batch writer can re-stamp them downstream.
 */

import { binUsersByEventCount } from '../hook-helpers/cohort.js';
import { scaleEventCount } from '../hook-helpers/mutate.js';

/**
 * @param {Array<Object>} events - User's event stream (mutated in place).
 * @param {Object} _profile - User profile (unused, kept for API symmetry).
 * @param {Object} opts
 * @param {string} opts.cohortEvent - Event whose per-user count classifies the user.
 * @param {Record<string, [number, number]>} opts.bins - Bin name → [lo, hi).
 * @param {string} opts.targetEvent - Event whose count is scaled per bin.
 * @param {Record<string, number>} opts.multipliers - Bin name → multiplier (1 = no-op,
 *   2 = double, 0.5 = halve). Bins absent from this map use multiplier 1.
 * @returns {{ bin: string|null, delta: number }} Bin assigned + signed delta from
 *   scaleEventCount (positive = clones added; negative = events dropped).
 */
export function applyFrequencyByFrequency(events, _profile, { cohortEvent, bins, targetEvent, multipliers }) {
	if (!events || !cohortEvent || !bins || !targetEvent || !multipliers) {
		return { bin: null, delta: 0 };
	}
	const bin = binUsersByEventCount(events, cohortEvent, bins);
	if (!bin) return { bin: null, delta: 0 };
	const factor = multipliers[bin];
	if (typeof factor !== 'number' || factor === 1) return { bin, delta: 0 };
	const delta = scaleEventCount(events, targetEvent, factor);
	return { bin, delta };
}
