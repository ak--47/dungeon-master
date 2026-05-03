/**
 * Phase 3 hook-helpers verification fixture.
 *
 * Exercises three atoms inside one `everything` hook:
 *   1. `binUsersByEventCount` — classify users into "casual" / "engaged" / "power"
 *      based on their count of `Browse` events.
 *   2. `scalePropertyValue` — engaged users get 2x `amount` on Purchase events;
 *      power users get 3x.
 *   3. `injectBurst` — power users also get a burst of 5 cloned `Browse` events
 *      around the midpoint of their stream.
 *
 * Verified by DuckDB queries against the events output (see
 * scripts/verify-runner.mjs + the Phase 3 verification gate notes in the plan).
 */

import dayjs from 'dayjs';
import {
	binUsersByEventCount,
	scalePropertyValue,
	injectBurst,
	cloneEvent,
} from '../../lib/hook-helpers/index.js';

const FIXED_NOW = dayjs('2024-02-02').unix();

const BINS = {
	casual: [0, 5],
	engaged: [5, 15],
	power: [15, Infinity],
};

const SCALE_BY_BIN = { casual: 1, engaged: 2, power: 3 };
const BURST_COUNT_BY_BIN = { casual: 0, engaged: 0, power: 5 };

export default {
	name: 'hook-helpers-verify',
	seed: 'phase3-helpers-verify',
	datasetStart: FIXED_NOW - 30 * 86400,
	datasetEnd: FIXED_NOW,
	numUsers: 1_000,
	avgEventsPerUserPerDay: 4,
	percentUsersBornInDataset: 30,
	hasAnonIds: false,
	format: 'json',
	concurrency: 1,
	writeToDisk: true,
	verbose: false,
	events: [
		{ event: 'Browse', weight: 8, properties: { surface: ['home', 'category', 'search'] } },
		{ event: 'Purchase', weight: 2, properties: { amount: [10, 20, 30, 40, 50] } },
	],
	hook: function (record, type, meta) {
		if (type !== 'everything' || !Array.isArray(record)) return record;

		// 1. Classify the user via cohort atom
		const bin = binUsersByEventCount(record, 'Browse', BINS);
		if (!bin) return record;

		// Stamp the bin onto each Purchase so verification queries can group by it
		// without re-deriving. Non-flag-stamping: this property is config-defined when
		// dungeons add `cohort` to Purchase.properties; here we accept the small bend
		// for the verification fixture so DuckDB queries are clean.
		for (const ev of record) {
			if (ev.event === 'Purchase') ev.cohort = bin;
		}

		// 2. Scale Purchase amounts via mutate atom (engaged 2x, power 3x)
		const factor = SCALE_BY_BIN[bin] || 1;
		if (factor !== 1) {
			scalePropertyValue(record, e => e.event === 'Purchase', 'amount', factor);
		}

		// 3. Power users get a Browse burst clustered at the dataset midpoint
		const burstCount = BURST_COUNT_BY_BIN[bin] || 0;
		if (burstCount > 0 && record.length) {
			const midUnixMs = (meta.datasetStart + (meta.datasetEnd - meta.datasetStart) / 2) * 1000;
			// Use the user's first Browse as a clone template so we honor the schema.
			const template = record.find(e => e.event === 'Browse');
			if (template) {
				const tpl = cloneEvent(template, { cohort: bin });
				injectBurst(record, tpl, burstCount, midUnixMs, 60 * 60 * 1000); // ±1h spread
			}
		}

		// Re-sort by time after burst injection so downstream pipeline sees ordered events.
		record.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
		return record;
	},
};
