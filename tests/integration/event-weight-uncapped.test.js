//@ts-nocheck
/**
 * Event weights above 10 change the event mix: weight 30 must yield more of
 * the event than weight 10 (the old silent cap made them identical).
 */
import { describe, test, expect } from 'vitest';
import DUNGEON_MASTER from '../../index.js';

function config(weight) {
	return {
		seed: 'event-weight-uncapped',
		datasetStart: '2026-06-01T00:00:00Z',
		datasetEnd: '2026-06-30T23:59:59Z',
		numUsers: 150,
		avgEventsPerUserPerDay: 4,
		concurrency: 1,
		writeToDisk: false,
		verbose: false,
		macro: { percentUsersBornInDataset: 0 },
		events: [
			{ event: 'app opened', weight },
			{ event: 'workout planned', weight: 4 },
			{ event: 'settings viewed', weight: 1 },
		],
	};
}

describe.sequential('uncapped event weight', () => {
	test('weight 30 gives a larger share than weight 10', async () => {
		const share = async (w) => {
			const ev = Array.from((await DUNGEON_MASTER(config(w))).eventData);
			return ev.filter(e => e.event === 'app opened').length / ev.length;
		};
		const s10 = await share(10);
		const s30 = await share(30);
		expect(s30).toBeGreaterThan(s10 + 0.05);
	}, 120_000);
});
