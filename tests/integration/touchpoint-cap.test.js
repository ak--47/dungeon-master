//@ts-nocheck
/**
 * v1.5 maxTouchpointsPerUser tests.
 *
 * Mirror of Mixpanel's `TOUCHPOINTS_LIMIT = 10` constant from
 * `backend/libquery/properties_over_time/attributed_value_reader.cpp` line 16.
 *
 * v1.5 contract:
 *   - default cap = 10
 *   - sampling is uniform-random across user's lifetime (NOT first-N-chronological)
 *   - sample is sorted chronologically before stamping
 *   - eligibility = events with `isAttributionEvent: true` if any event has the
 *     flag; otherwise all events (legacy fallback)
 *   - cap is deterministic per seed
 */

import { describe, test, expect } from 'vitest';
import DUNGEON_MASTER from '../../index.js';

const baseConfig = (overrides = {}) => ({
	seed: 'touchpoint-cap-test',
	datasetStart: '2025-09-01T00:00:00Z',
	datasetEnd: '2025-10-01T00:00:00Z',
	numUsers: 30,
	avgEventsPerUserPerDay: 8, // produce many eligible events per user
	hasCampaigns: true,
	events: [
		{ event: 'page view', weight: 5, isAttributionEvent: true },
		{ event: 'click', weight: 3 }, // not attribution
	],
	funnels: [{
		sequence: ['page view', 'click'],
		conversionRate: 50,
		timeToConvert: 1,
		order: 'sequential',
	}],
	writeToDisk: false,
	verbose: false,
	...overrides,
});

function userEvents(events) {
	const map = new Map();
	for (const ev of events) {
		const uid = ev.user_id || ev.distinct_id;
		if (!uid) continue;
		if (!map.has(uid)) map.set(uid, []);
		map.get(uid).push(ev);
	}
	return map;
}

const hasUTM = (e) => !!(e.utm_source || e.utm_campaign || e.utm_medium);

// `sequence.concurrent: true` (vitest.config.js) parallelizes tests within a
// file. Chance singleton is process-global, so concurrent tests interleave
// consumption and break determinism + cap-counting assertions.
describe.sequential('v1.5 maxTouchpointsPerUser cap', () => {
	test('default cap = 10: no user has more than 10 stamped events', async () => {
		const result = await DUNGEON_MASTER(baseConfig({ seed: 'cap-default' }));
		const events = Array.from(result.eventData);
		for (const [, evs] of userEvents(events)) {
			const stamped = evs.filter(hasUTM);
			expect(stamped.length).toBeLessThanOrEqual(10);
		}
	});

	test('explicit cap = 5 honored', async () => {
		const result = await DUNGEON_MASTER(baseConfig({
			seed: 'cap-5',
			maxTouchpointsPerUser: 5,
		}));
		const events = Array.from(result.eventData);
		for (const [, evs] of userEvents(events)) {
			const stamped = evs.filter(hasUTM);
			expect(stamped.length).toBeLessThanOrEqual(5);
		}
	});

	test('users with fewer eligible events than cap stamp ALL eligibles', async () => {
		// Tiny dataset: only 1 event per user. Cap=10, so all stamped.
		const result = await DUNGEON_MASTER(baseConfig({
			seed: 'cap-undercap',
			numUsers: 10,
			avgEventsPerUserPerDay: 0.1, // very few events
			maxTouchpointsPerUser: 10,
		}));
		const events = Array.from(result.eventData);
		for (const [, evs] of userEvents(events)) {
			const eligible = evs.filter(e => e.event === 'page view'); // attr-eligible
			const stamped = evs.filter(hasUTM);
			// Stamped count should equal eligible count (cap not hit).
			if (eligible.length > 0 && eligible.length <= 10) {
				expect(stamped.length).toBe(eligible.length);
			}
		}
	});

	test('only isAttributionEvent-flagged events get UTMs (when any event has the flag)', async () => {
		const result = await DUNGEON_MASTER(baseConfig({ seed: 'flag-scope' }));
		const events = Array.from(result.eventData);
		// page view has isAttributionEvent: true. click does not.
		const clickStamped = events.filter(e => e.event === 'click' && hasUTM(e));
		const pageStamped = events.filter(e => e.event === 'page view' && hasUTM(e));
		expect(clickStamped.length).toBe(0);
		expect(pageStamped.length).toBeGreaterThan(0);
	});

	test('lifetime sampling — stamped events do not all bunch at user birth', async () => {
		// Use avgActiveDaysPerUser to spread events across many days so the user has
		// a wide event range. Without this, funnels anchor close together and the
		// "lifetime" range is small.
		const result = await DUNGEON_MASTER(baseConfig({
			seed: 'lifetime-sample',
			numUsers: 50,
			avgEventsPerUserPerDay: 20,
			avgActiveDaysPerUser: 15,
		}));
		const events = Array.from(result.eventData);
		// Verify: stamped events for high-count users span at least multiple distinct days.
		// (First-N-chronological strategy would bunch all 10 stamps in 1-2 days.)
		let usersWithEnoughEvents = 0;
		let usersWithMultiDaySpread = 0;
		for (const [, evs] of userEvents(events)) {
			const eligible = evs.filter(e => e.event === 'page view');
			if (eligible.length <= 10) continue;
			usersWithEnoughEvents++;
			const stamped = evs.filter(hasUTM);
			if (stamped.length === 0) continue;
			const stampedDays = new Set(stamped.map(e => Math.floor(Date.parse(e.time) / 86400000)));
			if (stampedDays.size >= 2) usersWithMultiDaySpread++;
		}
		expect(usersWithEnoughEvents).toBeGreaterThan(0);
		// Most qualifying users should have stamps across multiple days.
		expect(usersWithMultiDaySpread / usersWithEnoughEvents).toBeGreaterThan(0.3);
	});

	test('determinism: same seed produces same number of stamped events', async () => {
		const r1 = await DUNGEON_MASTER(baseConfig({ seed: 'det-1' }));
		const r2 = await DUNGEON_MASTER(baseConfig({ seed: 'det-1' }));
		const ev1 = Array.from(r1.eventData);
		const ev2 = Array.from(r2.eventData);
		expect(ev1.length).toBe(ev2.length);
		// `insert_id` uses crypto.randomUUID (intentionally non-deterministic).
		// Compare stamped count + per-event UTM presence as the deterministic signal.
		const stampedCount1 = ev1.filter(hasUTM).length;
		const stampedCount2 = ev2.filter(hasUTM).length;
		expect(stampedCount1).toBe(stampedCount2);
	});

	test('legacy fallback: no isAttributionEvent flagged → all events eligible, capped at maxTouchpointsPerUser', async () => {
		const result = await DUNGEON_MASTER(baseConfig({
			seed: 'legacy-fallback',
			events: [
				// No isAttributionEvent flags anywhere.
				{ event: 'page view', weight: 5 },
				{ event: 'click', weight: 3 },
			],
			funnels: [{
				sequence: ['page view', 'click'],
				timeToConvert: 1,
				order: 'sequential',
			}],
		}));
		const events = Array.from(result.eventData);
		for (const [, evs] of userEvents(events)) {
			const stamped = evs.filter(hasUTM);
			expect(stamped.length).toBeLessThanOrEqual(10);
		}
	});

	test('throws on negative cap', async () => {
		await expect(DUNGEON_MASTER(baseConfig({ maxTouchpointsPerUser: -1 })))
			.rejects.toThrow(/maxTouchpointsPerUser/);
	});
});
