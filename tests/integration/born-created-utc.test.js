//@ts-nocheck
/**
 * Born users' `created` is a UTC instant with a seeded time of day, inside the
 * dataset window. Pinned signups (legacy and retentionCurve modes) equal it, and
 * fuzzy SCD rows start at or after it.
 */
import { describe, test, expect } from 'vitest';
import DUNGEON_MASTER from '../../index.js';

const START = '2025-10-15T00:00:00Z';
const END = '2025-11-20T23:59:59Z';

function config(extra = {}) {
	return {
		seed: 'born-created-utc',
		datasetStart: START,
		datasetEnd: END,
		numUsers: 150,
		avgEventsPerUserPerDay: 1,
		concurrency: 1,
		writeToDisk: false,
		verbose: false,
		macro: { percentUsersBornInDataset: 100, bornRecentBias: 0 },
		events: [
			{ event: 'sign up', isFirstEvent: true },
			{ event: 'page view', weight: 5 },
		],
		funnels: [{ sequence: ['sign up', 'page view'], isFirstFunnel: true, conversionRate: 100, timeToConvert: 1 }],
		scdProps: { tier: { values: ['a', 'b', 'c'], frequency: 'week', timing: 'fuzzy', max: 5 } },
		...extra,
	};
}

function signupByUser(events) {
	const out = new Map();
	for (const e of events) {
		if (e.event !== 'sign up') continue;
		const prev = out.get(e.user_id);
		if (!prev || e.time < prev) out.set(e.user_id, e.time);
	}
	return out;
}

describe.sequential('born users: created is a UTC instant inside the window', () => {
	for (const [label, extra] of [['legacy', {}], ['retentionCurve', { retentionCurve: { type: 'logarithmic', day1: 0.6, day7: 0.4, day30: 0.3 } }]]) {
		test(`${label}: created is a full ISO instant, in window, with spread hours; signup equals created`, async () => {
			const r = await DUNGEON_MASTER(config(extra));
			const users = Array.from(r.userProfilesData).filter((u) => u.created);
			expect(users.length).toBeGreaterThan(100);

			const startMs = Date.parse(START);
			const endMs = Date.parse(END);
			const hours = new Set();
			const instants = new Set();
			for (const u of users) {
				expect(u.created).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
				const ms = Date.parse(u.created);
				expect(ms).toBeGreaterThanOrEqual(startMs);
				expect(ms).toBeLessThanOrEqual(endMs);
				hours.add(new Date(ms).getUTCHours());
				instants.add(u.created.slice(11));
			}
			// Signups no longer pile on one time of day.
			expect(hours.size).toBeGreaterThanOrEqual(12);
			expect(instants.size).toBeGreaterThan(users.length * 0.9);

			const signups = signupByUser(Array.from(r.eventData));
			let checked = 0;
			for (const u of users) {
				const t = signups.get(u.distinct_id);
				if (!t) continue;
				expect(t).toBe(u.created);
				checked++;
			}
			expect(checked).toBeGreaterThan(users.length * 0.9);
		});
	}

	test('fuzzy SCD rows start at or after the born user\'s created, at varied times of day', async () => {
		const r = await DUNGEON_MASTER(config({ macro: { percentUsersBornInDataset: 100, bornRecentBias: 0.4 } }));
		const created = new Map(Array.from(r.userProfilesData).map((u) => [u.distinct_id, u.created]));
		const rows = r.scdTableData.flatMap((t) => Array.from(t));
		expect(rows.length).toBeGreaterThan(100);
		const hourMinute = new Set();
		for (const row of rows) {
			const c = created.get(row.distinct_id);
			expect(c).toBeTruthy();
			expect(Date.parse(row.startTime)).toBeGreaterThanOrEqual(Date.parse(c));
			hourMinute.add(row.startTime.slice(11, 16));
		}
		expect(hourMinute.size).toBeGreaterThan(rows.length * 0.3);
	});
});
