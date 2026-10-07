//@ts-nocheck
/**
 * worldEvents volumeMultiplier > 1 clones keep identity and context fields but
 * re-draw their event-level properties like a fresh event of that type,
 * including context-aware `(ctx) => value` properties evaluated at the clone's
 * time.
 */
import { describe, test, expect } from 'vitest';
import DUNGEON_MASTER from '../../index.js';

function config() {
	return {
		seed: 'world-clone-props',
		datasetStart: '2026-06-01T00:00:00Z',
		datasetEnd: '2026-07-30T23:59:59Z',
		numUsers: 200,
		avgEventsPerUserPerDay: 3,
		concurrency: 1,
		writeToDisk: false,
		verbose: false,
		macro: { percentUsersBornInDataset: 0 },
		identity: { avgDevicePerUser: 2 },
		userProps: { plan: ['free', 'pro', 'team'] },
		stickyEventProps: ['plan'],
		superProps: { app_version: ['1.0', '1.1', '1.2', '2.0'] },
		events: [
			{
				event: 'workout completed', weight: 5,
				properties: {
					minutes: [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60],
					calories: [100, 150, 200, 250, 300, 350, 400, 450, 500],
					kind: ['run', 'ride', 'row', 'lift', 'yoga', 'swim'],
					weekday: (ctx) => new Date(ctx.time).getUTCDay(),
				},
			},
			{ event: 'app open', weight: 5 },
		],
		worldEvents: [{ name: 'challenge', startDay: 20, duration: 20, volumeMultiplier: 1.5, affectsEvents: ['workout completed'] }],
	};
}

describe.sequential('world-event clones re-draw event properties', () => {
	test('clones are not verbatim copies; ctx props use the clone time; context fields hold', async () => {
		const r = await DUNGEON_MASTER(config());
		const profiles = new Map(Array.from(r.userProfilesData).map((p) => [p.distinct_id, p]));
		const windowStart = Date.parse('2026-06-21T00:00:00Z');
		const windowEnd = Date.parse('2026-07-11T00:00:00Z');
		const seen = new Map();
		let rows = 0;
		let duplicates = 0;
		for (const e of r.eventData) {
			if (e.event !== 'workout completed') continue;
			expect(e.weekday).toBe(new Date(e.time).getUTCDay());
			expect(e.plan).toBe(profiles.get(e.user_id).plan);
			const t = Date.parse(e.time);
			if (t < windowStart || t >= windowEnd) continue;
			rows++;
			const { time, insert_id, session_id, weekday, ...rest } = e;
			const key = JSON.stringify(Object.keys(rest).sort().map((k) => [k, rest[k]]));
			if (seen.has(key)) duplicates++;
			else seen.set(key, true);
		}
		expect(rows).toBeGreaterThan(500);
		// Independent draws over 11 x 9 x 6 values collide rarely; verbatim clones
		// made ~1/3 of in-window rows exact copies of another row.
		expect(duplicates / rows).toBeLessThan(0.1);
	});
	// 1.9.0: clone times follow the soup hour and weekday weights inside the
	// window. They were uniform, so a 4x world event flattened the hour shape of
	// the affected event inside its window.
	test('clone times follow the soup weights', async () => {
		const HW = [0.95, 0.95, 0.9, 0.8, 0.65, 0.5, 0.38, 0.3, 0.28, 0.3, 0.36, 0.42,
			0.5, 0.56, 0.62, 0.68, 0.74, 0.82, 0.9, 0.95, 1.0, 1.0, 0.98, 0.96];
		const DW = [1.0, 0.5, 0.4, 0.4, 0.45, 0.7, 0.95];
		const r = await DUNGEON_MASTER({
			...config(),
			soup: { hourOfDayWeights: HW, dayOfWeekWeights: DW },
			// 28-day window (4 whole weeks) from 2026-06-21.
			worldEvents: [{ name: 'challenge', startDay: 20, duration: 28, volumeMultiplier: 4, affectsEvents: ['workout completed'] }],
		});
		const windowStart = Date.parse('2026-06-21T00:00:00Z');
		const windowEnd = windowStart + 28 * 86400000;
		const hours = new Array(24).fill(0);
		const days = new Array(7).fill(0);
		for (const e of r.eventData) {
			if (e.event !== 'workout completed') continue;
			const t = Date.parse(e.time);
			if (t < windowStart || t >= windowEnd) continue;
			hours[new Date(t).getUTCHours()]++;
			days[new Date(t).getUTCDay()]++;
		}
		const corr = (a, b) => {
			const ma = a.reduce((x, y) => x + y) / a.length;
			const mb = b.reduce((x, y) => x + y) / b.length;
			let n = 0, da = 0, db = 0;
			for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
			return n / Math.sqrt(da * db);
		};
		const ratio = (xs) => Math.max(...xs) / Math.min(...xs);
		expect(corr(hours, HW)).toBeGreaterThan(0.9);
		expect(ratio(hours)).toBeGreaterThan(3.57 * 0.75);
		expect(corr(days, DW)).toBeGreaterThan(0.9);
		expect(ratio(days)).toBeGreaterThan(2.5 * 0.75);
	}, 120_000);
});
