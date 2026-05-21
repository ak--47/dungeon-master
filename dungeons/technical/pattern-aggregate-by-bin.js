// ── IMPORTS ──
import dayjs from 'dayjs';
import { applyAggregateByBin } from '../../lib/hook-patterns/index.js';

// ── OVERVIEW ──
/*
 * NAME:       pattern-aggregate-by-bin
 * PURPOSE:    Phase 4 reference fixture — aggregate per user, by bin. Users in
 *             the high-Browse cohort have 4× higher Purchase amounts on average;
 *             mid 2×; low 1×. Verified via the aggregatePerUser emulator.
 * SCALE:      1,000 users, ~180K events, 30 days
 * EVENTS (2): Browse (6) > Purchase (2)
 * FUNNELS (0): none
 */

// ── HOOK STORIES ──
/*
 * PATTERN: Bin users by Browse count (low 0-5, mid 5-15, high 15+);
 * scale Purchase `amount` by {low:1, mid:2, high:4}. Verified via
 * the aggregatePerUser emulator.
 */

// ── SCALE ──
const FIXED_NOW = dayjs('2024-02-02').unix();

// ── CONFIG ──
export default {
	name: 'pattern-agg-by-bin',
	seed: 'phase4-aggbybin',
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
		{ event: 'Purchase', weight: 2, properties: { amount: [10, 20, 30] } },
	],
	hook: function (record, type) {
		if (type !== 'everything' || !Array.isArray(record)) return record;
		applyAggregateByBin(record, null, {
			cohortEvent: 'Browse',
			bins: { low: [0, 5], mid: [5, 15], high: [15, Infinity] },
			event: 'Purchase',
			propertyName: 'amount',
			deltas: { low: 1, mid: 2, high: 4 },
		});
		return record;
	},
};
