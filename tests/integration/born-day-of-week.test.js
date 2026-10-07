//@ts-nocheck
/**
 * Born users' signup day follows the soup's day-of-week weights, on top of
 * bornRecentBias. Flat (null) weights keep born days uniform.
 */
import { describe, test, expect } from 'vitest';
import DUNGEON_MASTER from '../../index.js';

const WEEKDAY_HEAVY = [0.28, 1, 1, 0.98, 0.95, 0.82, 0.24];

function config(soup, extra = {}) {
	return {
		seed: 'born-dow',
		datasetStart: '2026-06-01T00:00:00Z', // a Monday
		datasetEnd: '2026-08-23T23:59:59Z', // a Sunday: 12 whole weeks
		numUsers: 300,
		avgEventsPerUserPerDay: 0.3,
		concurrency: 1,
		writeToDisk: false,
		verbose: false,
		soup,
		macro: { percentUsersBornInDataset: 100, bornRecentBias: 0 },
		events: [{ event: 'sign up', isFirstEvent: true }, { event: 'view' }],
		funnels: [{ sequence: ['sign up', 'view'], isFirstFunnel: true, conversionRate: 100, timeToConvert: 1 }],
		...extra,
	};
}

function byWeekday(users) {
	const counts = new Array(7).fill(0);
	for (const u of users) counts[new Date(u.created).getUTCDay()]++;
	return counts;
}

describe.sequential('born day of week', () => {
	test('weekday-heavy soup: weekend signups follow the weights', async () => {
		const r = await DUNGEON_MASTER(config({ dayOfWeekWeights: WEEKDAY_HEAVY }));
		const c = byWeekday(Array.from(r.userProfilesData));
		const weekend = (c[0] + c[6]) / 2;
		const midweek = (c[2] + c[3]) / 2;
		// Expected ratio (0.28 + 0.24) / 2 / 0.99 = 0.26; uniform days give 1.0.
		expect(weekend / midweek).toBeLessThan(0.45);
		expect(weekend / midweek).toBeGreaterThan(0.12);
	});

	test('null day-of-week weights keep born days uniform by weekday', async () => {
		const r = await DUNGEON_MASTER(config({ dayOfWeekWeights: null, hourOfDayWeights: null }, { numUsers: 300 }));
		const c = byWeekday(Array.from(r.userProfilesData));
		for (const n of c) {
			expect(n).toBeGreaterThan(300 / 7 * 0.5);
			expect(n).toBeLessThan(300 / 7 * 1.5);
		}
	});

	test('bornRecentBias still skews births late and keeps the weekday rhythm', async () => {
		const r = await DUNGEON_MASTER(config({ dayOfWeekWeights: WEEKDAY_HEAVY }, { macro: { percentUsersBornInDataset: 100, bornRecentBias: 0.4 } }));
		const users = Array.from(r.userProfilesData);
		const start = Date.parse('2026-06-01T00:00:00Z');
		const span = Date.parse('2026-08-23T23:59:59Z') - start;
		const firstThird = users.filter((u) => Date.parse(u.created) - start < span / 3).length;
		const lastThird = users.filter((u) => Date.parse(u.created) - start >= (2 * span) / 3).length;
		expect(lastThird / firstThird).toBeGreaterThan(1.3);
		const c = byWeekday(users);
		expect(((c[0] + c[6]) / 2) / ((c[2] + c[3]) / 2)).toBeLessThan(0.45);
	});
});
