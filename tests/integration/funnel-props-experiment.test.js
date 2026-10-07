//@ts-nocheck
/**
 * Funnel `props` apply to every funnel step (README: "constant props on all
 * funnel events"), from `bindPropsIndex` on. The engine-prepended
 * `$experiment_started` is not a funnel step: it never carries funnel props, and
 * it does not shift `bindPropsIndex` (1.9.0; the prepended exposure made the
 * props bind one real step early).
 */
import { describe, test, expect } from 'vitest';
import DUNGEON_MASTER from '../../index.js';

const run = (experiment) => DUNGEON_MASTER({
	seed: 'funnel-props-experiment',
	datasetStart: '2026-01-01T00:00:00Z',
	datasetEnd: '2026-01-30T23:59:59Z',
	numUsers: 100,
	avgEventsPerUserPerDay: 2,
	percentUsersBornInDataset: 0,
	writeToDisk: false,
	verbose: false,
	concurrency: 1,
	events: [
		{ event: 'view', properties: { search_id: ['unassigned'] } },
		{ event: 'cart', properties: { search_id: ['unassigned'] } },
		{ event: 'buy', properties: { search_id: ['unassigned'] } },
		{ event: 'other', weight: 2 },
	],
	funnels: [{
		name: 'Search',
		sequence: ['view', 'cart', 'buy'],
		conversionRate: 80,
		timeToConvert: 1,
		order: 'sequential',
		bindPropsIndex: 1,
		props: { search_id: ['S-1', 'S-2', 'S-3'] },
		...(experiment ? { experiment: true } : {}),
	}],
});

describe.sequential('funnel props and the experiment exposure', () => {
	test.each([['no experiment', false], ['experiment', true]])('%s: bindPropsIndex counts real steps; exposure has no funnel props', async (_label, experiment) => {
		const events = Array.from((await run(experiment)).eventData);
		const by = (name) => events.filter(e => e.event === name);
		expect(by('view').length).toBeGreaterThan(50);
		expect(by('view').every(e => e.search_id === 'unassigned')).toBe(true);
		expect(by('cart').every(e => e.search_id.startsWith('S-'))).toBe(true);
		expect(by('buy').every(e => e.search_id.startsWith('S-'))).toBe(true);
		if (experiment) {
			expect(by('$experiment_started').length).toBeGreaterThan(0);
			expect(by('$experiment_started').every(e => e.search_id === undefined)).toBe(true);
		}
	}, 60000);
});
