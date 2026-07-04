/**
 * Pattern: Time to Convert, broken down by user segment.
 *
 * Two generations:
 *
 * - `applyTTCBySegmentV2` (v1.6, use this) — `everything` hook. Finds the
 *   user's FIRST in-order occurrence of the funnel steps across their whole
 *   stream and scales those gaps. This is the sequence Mixpanel's greedy
 *   funnel engine actually measures (HOOKS.md §2.2 / recipe 4.14), so the
 *   scaling shows up in the TTC report and in the local verifier.
 *
 * - `applyTTCBySegment` (deprecated) — `funnel-post` hook. Scales one funnel
 *   run's internal gaps. Mixpanel's TTC uses the FIRST occurrence of each
 *   step per user, not the gaps inside any one run — so for usage funnels
 *   (and any run that isn't the user's first) the scaling never reaches the
 *   report. Kept for compatibility; emits a one-time console warning.
 */

import { scaleFunnelTTC, findFirstSequence } from '../hook-helpers/timing.js';

let warnedDeprecated = false;

/**
 * @deprecated since v1.6 — use `applyTTCBySegmentV2` from an `everything`
 * hook. This funnel-post variant scales gaps inside ONE funnel run, but
 * Mixpanel's TTC report measures the FIRST occurrence of each step per user
 * (greedy engine, HOOKS.md §2.2) — so unless the run happens to be the
 * user's first occurrence of those steps (`isFirstFunnel`), the scaling
 * never moves the report.
 *
 * @param {Array<Object>} funnelEvents - Mutated in place.
 * @param {Object} profile - The user's profile (must contain `segmentKey`).
 * @param {Object} opts
 * @param {string} opts.segmentKey - Profile property name to look up.
 * @param {Record<string, number>} opts.factors - Profile-value → TTC factor.
 * @returns {{ segmentValue: any, factor: number, shifted: number }}
 */
export function applyTTCBySegment(funnelEvents, profile, { segmentKey, factors }) {
	if (!warnedDeprecated) {
		warnedDeprecated = true;
		console.warn('[dungeon-master] applyTTCBySegment is deprecated — use applyTTCBySegmentV2 from an `everything` hook (funnel-post scaling only reaches Mixpanel TTC for isFirstFunnel runs). This warning fires once.');
	}
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

/**
 * Scale the user's funnel time-to-convert by a profile-segment factor —
 * operating on the FIRST in-order occurrence of `steps` across the user's
 * whole stream, which is what Mixpanel's greedy funnel engine measures
 * (recipe 4.14). Call from the `everything` hook.
 *
 * Mechanism: `findFirstSequence(events, steps, maxGapMinutes)` locates the
 * greedy first-occurrence chain; `scaleFunnelTTC` multiplies each matched
 * step's offset from the first step by `factors[profile[segmentKey]]`. The
 * anchor step's time is unchanged; only the matched step events move.
 *
 * Conversion-window caveat: a factor > 1 can push the final step past the
 * funnel's `conversionWindowDays` cap, where Mixpanel's strict-`<` rule
 * excludes the conversion entirely — clamp your factors the way recipe 4.28
 * does when scaling up. Timestamp moves are session-safe in v1.6 (P2.1
 * re-derives `session_id` after the everything hook).
 *
 * @param {Array<Object>} events - User's FULL event stream (mutated in place).
 * @param {Object} profile - The user's profile (must contain `segmentKey`).
 * @param {Object} opts
 * @param {string} opts.segmentKey - Profile property name to look up.
 * @param {Record<string, number>} opts.factors - Profile-value → TTC factor
 *   (0.5 halves the TTC, 2 doubles it; 1 or missing = no-op).
 * @param {string[]} opts.steps - Ordered funnel step event names.
 * @param {number} [opts.maxGapMinutes=43200] - Max gap between CONSECUTIVE
 *   matched steps, in minutes (default 30 days). NOTE this is a per-gap
 *   bound, NOT Mixpanel's conversion window: Mixpanel's window caps the
 *   TOTAL time from step 0 to the final step, so a k-step sequence matched
 *   here can span up to (k−1) × maxGapMinutes — well past a same-length
 *   conversion window. When targeting a funnel report, keep total intended
 *   TTC (gaps × factor) under the funnel's `conversionWindowDays`.
 * @returns {{ segmentValue: any, factor: number, shifted: number }} `shifted`
 *   = number of step events whose timestamps moved (0 when the user has no
 *   qualifying sequence or the factor is a no-op).
 */
export function applyTTCBySegmentV2(events, profile, { segmentKey, factors, steps, maxGapMinutes = 43200 }) {
	if (!events || !events.length || !profile || !segmentKey || !factors || !Array.isArray(steps) || steps.length < 2) {
		return { segmentValue: null, factor: 1, shifted: 0 };
	}
	const segmentValue = profile[segmentKey];
	const factor = factors[segmentValue];
	if (typeof factor !== 'number' || factor === 1) {
		return { segmentValue, factor: 1, shifted: 0 };
	}
	const seq = findFirstSequence(events, steps, maxGapMinutes);
	if (!seq) return { segmentValue, factor, shifted: 0 };
	const shifted = scaleFunnelTTC(seq, factor);
	return { segmentValue, factor, shifted };
}
