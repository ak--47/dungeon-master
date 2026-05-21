// ── IMPORTS ──
import dayjs from 'dayjs';
import { applyFrequencyByFrequency } from '../../lib/hook-patterns/index.js';

// ── OVERVIEW ──
/*
 * NAME:       pattern-frequency-by-frequency
 * PURPOSE:    Phase 4 reference fixture — frequency × frequency. Engages users
 *             into low/mid/high "Browse" cohorts; high-cohort users get 3×
 *             Purchase events. Verified by the Phase 4 patterns test + verify-runner.
 * SCALE:      1,000 users, ~180K events, 30 days
 * EVENTS (2): Browse (6) > Purchase (2)
 * FUNNELS (0): none
 */

// ── HOOK STORIES ──
/*
 * PATTERN: Bin users by Browse count (low 0-5, mid 5-15, high 15+);
 * scale Purchase event count by {low:1, mid:2, high:3}. Verified via
 * the frequencyByFrequency emulator.
 */

// ── SCALE ──
const FIXED_NOW = dayjs('2024-02-02').unix();

// ── CONFIG ──
export default {
	name: 'pattern-freq-by-freq',
	seed: 'phase4-freqxfreq',
	datasetStart: FIXED_NOW - 30 * 86400,
	datasetEnd: FIXED_NOW,
	numUsers: 1_000,
	avgEventsPerUserPerDay: 6,
	percentUsersBornInDataset: 30,
	format: 'json',
	concurrency: 1,
	writeToDisk: true,
	verbose: false,
	events: [
		{ event: 'Browse', weight: 6 },
		{ event: 'Purchase', weight: 2, properties: { amount: [10, 20, 30, 40, 50] } },
	],
	hook: function (record, type) {
		if (type !== 'everything' || !Array.isArray(record)) return record;
		applyFrequencyByFrequency(record, null, {
			cohortEvent: 'Browse',
			bins: { low: [0, 5], mid: [5, 15], high: [15, Infinity] },
			targetEvent: 'Purchase',
			multipliers: { low: 1, mid: 2, high: 3 },
		});
		return record;
	},
};
