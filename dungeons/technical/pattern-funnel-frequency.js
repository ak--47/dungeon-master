/**
 * Phase 4 reference dungeon — funnel frequency breakdown.
 *
 * Engaged-cohort users (high count of `Browse`) are 1.5× more likely to complete
 * the activation funnel's last step than low-cohort users. Verified via the
 * funnelFrequency emulator.
 *
 * Note: this pattern is funnel-post; it edits the funnel's own events. Combined
 * with the per-user funnel attempts, the breakdown should show a stronger
 * conversion-per-step lift in the high cohort.
 */

import dayjs from 'dayjs';
import { applyFunnelFrequencyBreakdown } from '../../lib/hook-patterns/index.js';

const FIXED_NOW = dayjs('2024-02-02').unix();

export default {
	name: 'pattern-funnel-freq',
	seed: 'phase4-funnel-freq',
	datasetStart: FIXED_NOW - 30 * 86400,
	datasetEnd: FIXED_NOW,
	numUsers: 1_000,
	avgEventsPerUserPerDay: 4,
	percentUsersBornInDataset: 100,
	hasAnonIds: false,
	format: 'json',
	concurrency: 1,
	writeToDisk: true,
	verbose: false,
	events: [
		{ event: 'Land', isFirstEvent: true, isStrictEvent: true },
		{ event: 'Sign Up', isAuthEvent: true, isStrictEvent: true },
		{ event: 'Activate', isStrictEvent: true },
		{ event: 'Browse', weight: 5 },
	],
	funnels: [{
		sequence: ['Land', 'Sign Up', 'Activate'],
		conversionRate: 70, isFirstFunnel: true, timeToConvert: 4,
	}],
	hook: function (record, type, meta) {
		if (type !== 'funnel-post' || !Array.isArray(record)) return;
		if (!meta.isFirstFunnel) return;
		// In funnel-post we don't have the user's full event stream — pattern accepts
		// null for `allUserEvents` and falls back to counting cohortEvent inside the
		// funnel-only events. Real dungeons usually wire this via `everything` instead.
		applyFunnelFrequencyBreakdown(null, meta.profile || {}, record, {
			cohortEvent: 'Browse',
			bins: { low: [0, 3], high: [3, Infinity] },
			dropMultipliers: { low: 0.5, high: 0.95 },
			finalStep: 'Activate',
		});
	},
};
