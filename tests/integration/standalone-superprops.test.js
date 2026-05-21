//@ts-nocheck
/**
 * v1.5.1 (TODO #10 byproduct): standalone events stamp `config.superProps`.
 *
 * Long-standing bug pre-1.5.1: `user-loop.js` standalone makeEvent call passed
 * `{}` for superProps, so superProperties never landed on standalone events.
 * Was masked by the validator's catch-all funnel (which DOES pass superProps).
 * The TODO #10 `useFunnel` budget gate routes some iterations to standalone,
 * exposing the gap. Fix: pass `config.superProps` on standalone call.
 */

import { describe, test, expect } from 'vitest';
import DUNGEON_MASTER from '../../index.js';
import dayjs from 'dayjs';

const FIXED_NOW = dayjs('2024-02-02').unix();

describe('v1.5.1 standalone events get superProps', () => {
	test('every event has the configured superProp', async () => {
		const result = await DUNGEON_MASTER({
			datasetStart: FIXED_NOW - 30 * 86400,
			datasetEnd: FIXED_NOW,
			numUsers: 50,
			avgEventsPerUserPerDay: 3,
			writeToDisk: false,
			verbose: false,
			concurrency: 1,
			seed: 'standalone-superprops',
			percentUsersBornInDataset: 0, // pre-existing only — cleaner identity
			superProps: { tenant_id: ['acme', 'globex', 'initech'] },
			events: [{ event: 'Browse', weight: 5 }, { event: 'Purchase', weight: 2 }],
		});

		const events = Array.from(result.eventData);
		expect(events.length).toBeGreaterThan(0);
		// EVERY event — funnel OR standalone — must carry tenant_id.
		const missing = events.filter(e => e.tenant_id === undefined);
		expect(missing.length).toBe(0);
		// Distinct values match the configured pool (proves superProp pool was used).
		const tenants = new Set(events.map(e => e.tenant_id));
		expect(tenants.size).toBeGreaterThan(0);
		expect([...tenants].every(t => ['acme', 'globex', 'initech'].includes(t))).toBe(true);
	});
});
