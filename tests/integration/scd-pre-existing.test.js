//@ts-nocheck
/**
 * SCD history coverage. Pre-existing users' history starts at or before the
 * window start (their adjustedCreated, before the window), so an established
 * account has an SCD value for the whole window. Born users' history starts at
 * created. No row starts after the window end.
 */
import { describe, test, expect } from 'vitest';
import DUNGEON_MASTER from '../../index.js';

const START = '2026-06-15T00:00:00Z';
const END = '2026-09-14T23:59:59Z';

describe.sequential('SCD history coverage', () => {
	test('pre-existing rows start at or before datasetStart; born rows at or after created; none after datasetEnd', async () => {
		const r = await DUNGEON_MASTER({
			seed: 'scd-pre-existing',
			datasetStart: START,
			datasetEnd: END,
			numUsers: 300,
			avgEventsPerUserPerDay: 0.5,
			concurrency: 1,
			writeToDisk: false,
			verbose: false,
			credentials: { serviceAccount: 'x', serviceSecret: 'y', projectId: '1' },
			macro: { percentUsersBornInDataset: 30, preExistingSpread: 'uniform' },
			events: [{ event: 'sign up', isFirstEvent: true }, { event: 'view' }],
			funnels: [{ sequence: ['sign up', 'view'], isFirstFunnel: true, conversionRate: 100, timeToConvert: 1 }],
			scdProps: {
				tier: { values: ['a', 'b', 'c'], frequency: 'week', timing: 'fuzzy', max: 6 },
				plan: { values: ['x', 'y'], frequency: 'month', timing: 'fixed', max: 4 },
			},
		});
		const profiles = Array.from(r.userProfilesData);
		const created = new Map(profiles.filter((p) => p.created).map((p) => [p.distinct_id, p.created]));
		const startMs = Date.parse(START);
		const endMs = Date.parse(END);
		expect(created.size).toBeGreaterThan(50);
		expect(profiles.length - created.size).toBeGreaterThan(150);
		for (const table of r.scdTableData) {
			const first = new Map();
			for (const row of table) {
				expect(Date.parse(row.startTime)).toBeLessThanOrEqual(endMs);
				const cur = first.get(row.distinct_id);
				if (!cur || row.startTime < cur) first.set(row.distinct_id, row.startTime);
			}
			for (const [id, t] of first) {
				const born = created.get(id);
				if (born) expect(Date.parse(t)).toBeGreaterThanOrEqual(Date.parse(born));
				else expect(Date.parse(t)).toBeLessThanOrEqual(startMs);
			}
			// Fuzzy rows start at the pre-existing user's seeded adjustedCreated, not on
			// one time of day.
			if (table.scdKey === 'tier' || table[0]?.tier !== undefined) {
				const times = new Set([...first.values()].map((t) => t.slice(11, 16)));
				expect(times.size).toBeGreaterThan(first.size * 0.5);
			}
		}
	});
});
