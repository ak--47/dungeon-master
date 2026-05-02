/**
 * Pattern: Time to Convert, broken down by user segment.
 *
 * Inside a `funnel-post` hook, scale the funnel's time-to-convert by a factor
 * keyed off of a user-profile property value (e.g., trial users convert 3x
 * slower than enterprise). Lets Mixpanel's TTC funnel report — broken down by
 * a profile property — show a deliberate spread.
 *
 * Mechanism: read `profile[segmentKey]`, look up the multiplier in `factors`,
 * and `scaleFunnelTTC(funnelEvents, factor)`. The first event's time is the
 * anchor (unchanged); subsequent steps' offsets from it are scaled.
 *
 * Caveat: Mixpanel's "Time to Convert" funnel report uses the time between the
 * FIRST event of step A and the FIRST event of step B per user, not the actual
 * gap inside any one funnel run. The scaled funnel run will reflect in TTC only
 * when this funnel is the user's first occurrence of those steps — which it is
 * for an `isFirstFunnel`. For usage funnels, document this caveat to authors.
 */

import { scaleFunnelTTC } from '../hook-helpers/timing.js';

/**
 * @param {Array<Object>} funnelEvents - Mutated in place.
 * @param {Object} profile - The user's profile (must contain `segmentKey`).
 * @param {Object} opts
 * @param {string} opts.segmentKey - Profile property name to look up.
 * @param {Record<string, number>} opts.factors - Profile-value → TTC factor.
 * @returns {{ segmentValue: any, factor: number, shifted: number }}
 */
export function applyTTCBySegment(funnelEvents, profile, { segmentKey, factors }) {
	if (!funnelEvents || !funnelEvents.length || !profile || !segmentKey || !factors) {
		return { segmentValue: null, factor: 1, shifted: 0 };
	}
	const segmentValue = profile[segmentKey];
	const factor = factors[segmentValue];
	if (typeof factor !== 'number' || factor === 1) {
		return { segmentValue, factor: 1, shifted: 0 };
	}
	const shifted = scaleFunnelTTC(funnelEvents, factor);
	return { segmentValue, factor, shifted };
}
