//@ts-nocheck
/**
 * The window's first and last day carry normal event volume.
 *
 * Pre-existing users were active before the window opened. A funnel that
 * started before FIXED_BEGIN spills steps into day 0, the same way a funnel
 * that starts on the last day spills past FIXED_NOW. Without that spill-in,
 * day 0 of every multi-step funnel (the catch-all spans 24h) ran ~20% light.
 */
import { describe, test, expect } from 'vitest';
import DUNGEON_MASTER from '../../index.js';

const DAY_MS = 86400000;

function config(mode, seed) {
	return {
		seed: `window-edge-${mode}-${seed}`,
		datasetStart: '2026-06-04T00:00:00Z',
		datasetEnd: '2026-07-01T23:59:59Z',
		numUsers: 300,
		avgEventsPerUserPerDay: 8,
		concurrency: 1,
		writeToDisk: false,
		verbose: false,
		soup: { dayOfWeekWeights: null },
		macro: { percentUsersBornInDataset: 0, preExistingSpread: 'uniform' },
		...(mode === 'activeDays' ? { avgActiveDaysPerUser: 14 } : {}),
		...(mode === 'retentionCurve' ? { retentionCurve: { type: 'logarithmic', day1: 0.8, day7: 0.6, day30: 0.45 } } : {}),
		// No author funnels: every event lands in the engine catch-all (24h, random order).
		events: [
			{ event: 'app open', weight: 5 },
			{ event: 'meal', weight: 3 },
			{ event: 'notification', weight: 2 },
		],
	};
}

function dailyRatios(events) {
	const counts = new Map();
	for (const e of events) {
		const d = Math.floor(Date.parse(e.time) / DAY_MS);
		counts.set(d, (counts.get(d) || 0) + 1);
	}
	const days = [...counts.keys()].sort((a, b) => a - b);
	const interior = days.slice(1, -1).map((d) => counts.get(d));
	const mean = interior.reduce((a, b) => a + b, 0) / interior.length;
	return { days: days.length, first: counts.get(days[0]) / mean, last: counts.get(days.at(-1)) / mean };
}

describe.sequential('window edge days carry normal volume (pre-existing users)', () => {
	for (const mode of ['legacy', 'activeDays', 'retentionCurve']) {
		test(`${mode}: day 0 and the last day match the interior mean`, async () => {
			// Five seeds: active-day modes concentrate each user's events on a few
			// days, so one 300-user run has ~10% day-to-day noise. At 3000 users the
			// edge ratios read 0.96-1.03 in every mode.
			let first = 0;
			let last = 0;
			const seeds = ['a', 'b', 'c', 'd', 'e'];
			for (const seed of seeds) {
				const r = await DUNGEON_MASTER(config(mode, seed));
				const events = Array.from(r.eventData);
				for (const e of events) {
					expect(Date.parse(e.time)).toBeGreaterThanOrEqual(Date.parse('2026-06-04T00:00:00Z'));
				}
				const ratios = dailyRatios(events);
				expect(ratios.days).toBe(28);
				first += ratios.first / seeds.length;
				last += ratios.last / seeds.length;
			}
			// Before the lead-in fix day 0 read 0.63-0.78 here.
			expect(first).toBeGreaterThan(0.88);
			expect(first).toBeLessThan(1.12);
			expect(last).toBeGreaterThan(0.88);
			expect(last).toBeLessThan(1.12);
		}, 90000);
	}
});

describe.sequential('born users in activeDays mode start at birth', () => {
	test('signup equals created, and per-alive-user volume does not ramp across the window', async () => {
		const r = await DUNGEON_MASTER({
			seed: 'born-active-days',
			datasetStart: '2026-06-04T00:00:00Z',
			datasetEnd: '2026-07-31T23:59:59Z',
			numUsers: 300,
			avgEventsPerUserPerDay: 6,
			avgActiveDaysPerUser: 10,
			concurrency: 1,
			writeToDisk: false,
			verbose: false,
			soup: { dayOfWeekWeights: null },
			macro: { percentUsersBornInDataset: 100, bornRecentBias: 0 },
			events: [
				{ event: 'sign up', isFirstEvent: true },
				{ event: 'app open', weight: 5 },
				{ event: 'meal', weight: 3 },
			],
			funnels: [{ sequence: ['sign up', 'app open'], isFirstFunnel: true, conversionRate: 100, timeToConvert: 1 }],
		});
		const users = Array.from(r.userProfilesData);
		const signup = new Map();
		for (const e of r.eventData) if (e.event === 'sign up' && !signup.has(e.user_id)) signup.set(e.user_id, e.time);
		let pinned = 0;
		for (const u of users) if (signup.get(u.distinct_id) === u.created) pinned++;
		expect(pinned / users.length).toBeGreaterThan(0.95);

		// Events per alive user, first half of the window vs second half. Before the
		// fix the signup landed on a random planned day and every planned day before
		// it was skipped, so volume per alive user rose ~10x across the window.
		const born = users.map((u) => Date.parse(u.created));
		const startMs = Date.parse('2026-06-04T00:00:00Z');
		const midMs = startMs + 29 * DAY_MS;
		const endMs = Date.parse('2026-07-31T23:59:59Z');
		const aliveDays = (from, to) => born.reduce((sum, b) => sum + Math.max(0, to - Math.max(from, b)) / DAY_MS, 0);
		let firstHalf = 0;
		let secondHalf = 0;
		for (const e of r.eventData) (Date.parse(e.time) < midMs ? firstHalf++ : secondHalf++);
		const ratio = (secondHalf / aliveDays(midMs, endMs)) / (firstHalf / aliveDays(startMs, midMs));
		expect(ratio).toBeGreaterThan(0.75);
		expect(ratio).toBeLessThan(1.33);
	}, 60000);
});
