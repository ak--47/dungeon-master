/**
 * Pattern: Funnel Frequency Breakdown.
 *
 * Inside a `funnel-post` hook, vary the user's completion of the funnel by their
 * `cohortEvent` activity (anywhere in the dataset, not just the funnel) —
 * distinct calendar days by default (v1.6), or total events with
 * `binBy: 'events'`. Used when you want Mixpanel's funnel report — broken down
 * by per-user frequency of an activity event — to show e.g. "users active 5+
 * days with X are 1.4x as likely to complete this funnel."
 *
 * Mechanism: for users in a "drop-prone" bin, drop the funnel's final step
 * event(s) per the `dropMultipliers` config (1 = drop none, 0 = drop all).
 *
 * Schema-first: does not add new event properties or invent events. Operates on
 * the funnelEvents array passed by the funnel-post hook.
 */

import { binUsersByEventCount } from '../hook-helpers/cohort.js';
import { binByDistinctPeriods } from '../verify/counting.js';
import { dropEventsWhere } from '../hook-helpers/mutate.js';

/**
 * @param {Array<Object>} allUserEvents - Full per-user event history (read-only;
 *   used to count `cohortEvent`). When called inside `funnel-post`, derive this
 *   from `meta.profile` or pass the user's accumulated events from a closure.
 *   When `null`, falls back to counting cohortEvent inside `funnelEvents` —
 *   note the fallback makes the default `'distinctDays'` axis degenerate (a
 *   single funnel run rarely spans more than one calendar day); pass
 *   `binBy: 'events'` when only funnel events are available.
 * @param {Object} _profile
 * @param {Array<Object>} funnelEvents - Funnel events produced by `makeFunnel`
 *   (mutated in place).
 * @param {Object} opts
 * @param {string} opts.cohortEvent
 * @param {Record<string, [number, number]>} opts.bins
 * @param {Record<string, number>} opts.dropMultipliers - Bin name → keep-rate (0..1)
 *   for the FINAL step event. 1 = always keep, 0 = always drop.
 * @param {string} [opts.finalStep] - Event name of the final step. Defaults to the
 *   last event in `funnelEvents` (in time order).
 * @param {('events'|'distinctDays')} [opts.binBy='distinctDays'] - Cohort axis.
 *   `'distinctDays'` (default since v1.6) bins by distinct calendar days with
 *   `cohortEvent` via `binByDistinctPeriods` — the axis Mixpanel's funnel
 *   frequency breakdown and the local emulator use. `'events'` restores the
 *   pre-1.6 total-event-count axis.
 * @returns {{ bin: string|null, droppedFinal: boolean }}
 */
export function applyFunnelFrequencyBreakdown(allUserEvents, _profile, funnelEvents, opts) {
	const { cohortEvent, bins, dropMultipliers, finalStep, binBy = 'distinctDays' } = opts || {};
	if (!funnelEvents || !cohortEvent || !bins || !dropMultipliers) {
		return { bin: null, droppedFinal: false };
	}
	const sourceForBin = allUserEvents || funnelEvents;
	const bin = binBy === 'events'
		? binUsersByEventCount(sourceForBin, cohortEvent, bins)
		: binByDistinctPeriods(sourceForBin, cohortEvent, bins, 'day');
	if (!bin) return { bin: null, droppedFinal: false };
	const keepRate = dropMultipliers[bin];
	if (typeof keepRate !== 'number' || keepRate >= 1) return { bin, droppedFinal: false };

	// Identify the final step. If finalStep is named, use it; otherwise pick the
	// latest-in-time event in the funnel as the final step.
	let stepName = finalStep;
	if (!stepName) {
		const sorted = funnelEvents.slice().sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
		stepName = sorted.length ? sorted[sorted.length - 1].event : null;
	}
	if (!stepName) return { bin, droppedFinal: false };

	// Coin-flip drop using a deterministic-ish heuristic — this is called from a
	// non-RNG context (funnel-post), so use Math.random would break determinism.
	// Instead, use a hash on the funnel's first event's insert_id (deterministic
	// per-call) modulo 1000 / 1000 vs. (1 - keepRate). For simplicity we use
	// chance from utils when available.
	const dropProb = 1 - keepRate;
	const seed = funnelEvents[0] && (funnelEvents[0].insert_id || funnelEvents[0].time) || '';
	const det = simpleHashFloat(String(seed));
	if (det < dropProb) {
		const before = funnelEvents.length;
		dropEventsWhere(funnelEvents, e => e && e.event === stepName);
		return { bin, droppedFinal: funnelEvents.length < before };
	}
	return { bin, droppedFinal: false };
}

import { simpleHashFloat } from '../hook-helpers/_internal.js';
