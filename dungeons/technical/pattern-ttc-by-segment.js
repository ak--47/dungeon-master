// ── IMPORTS ──
import dayjs from 'dayjs';
import { applyTTCBySegment } from '../../lib/hook-patterns/index.js';

// ── OVERVIEW ──
/*
 * NAME:       pattern-ttc-by-segment
 * PURPOSE:    Phase 4 reference fixture — time-to-convert by segment. Trial
 *             users take 4× longer to complete the activation funnel; enterprise
 *             0.5× faster. Verified via the timeToConvert emulator.
 * SCALE:      1,000 users, ~120K events, 30 days
 * EVENTS (4): Browse (5) > Land (1) > Sign Up (1) > Activate (1)
 * FUNNELS (1): Activation: Land → Sign Up → Activate (100%)
 */

// ── HOOK STORIES ──
/*
 * PATTERN: Scale the activation funnel's time-to-convert by user tier:
 * trial users 4× slower, enterprise 0.5× faster. Verified via the
 * timeToConvert emulator.
 */

// ── SCALE ──
const FIXED_NOW = dayjs('2024-02-02').unix();

// ── CONFIG ──
export default {
	name: 'pattern-ttc-by-segment',
	seed: 'phase4-ttc-seg',
	datasetStart: FIXED_NOW - 30 * 86400,
	datasetEnd: FIXED_NOW,
	numUsers: 1_000,
	avgEventsPerUserPerDay: 4,
	percentUsersBornInDataset: 100,
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
