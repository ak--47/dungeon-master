/**
 * Phase 4 reference dungeon — time to convert by segment.
 *
 * Trial users take 4× longer to complete the activation funnel than enterprise
 * users (0.5× faster). Verified via the timeToConvert emulator.
 */

import dayjs from 'dayjs';
import { applyTTCBySegment } from '../../lib/hook-patterns/index.js';

const FIXED_NOW = dayjs('2024-02-02').unix();

export default {
	name: 'pattern-ttc-by-segment',
	seed: 'phase4-ttc-seg',
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
	userProps: { tier: ['trial', 'trial', 'enterprise'] },
	events: [
		{ event: 'Land', isFirstEvent: true, isStrictEvent: true },
		{ event: 'Sign Up', isAuthEvent: true, isStrictEvent: true },
		{ event: 'Activate', isStrictEvent: true },
		{ event: 'Browse', weight: 5 },
	],
	funnels: [{
		sequence: ['Land', 'Sign Up', 'Activate'],
		conversionRate: 100, isFirstFunnel: true, timeToConvert: 4,
	}],
	hook: function (record, type, meta) {
		if (type !== 'funnel-post' || !Array.isArray(record)) return;
		if (!meta.isFirstFunnel) return;
		applyTTCBySegment(record, meta.profile || {}, {
			segmentKey: 'tier',
			factors: { trial: 4, enterprise: 0.5 },
		});
	},
};
