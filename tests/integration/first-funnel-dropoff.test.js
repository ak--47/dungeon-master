//@ts-nocheck
/**
 * 1.9.0: what a born user does after a first funnel they did not finish.
 *
 * Identity contract (types.d.ts `isAuthEvent`, `avgDevicePerUser`): the
 * `isAuthEvent` step is the stitch; every later event of a stitched user is a
 * normal identified event. A born user who reached the stitch and dropped at a
 * later first-funnel step is a signed-up user, so they run usage funnels like
 * any other user. Before, any first-funnel drop-off left the user with only
 * one-at-a-time standalone events for life.
 *
 * A born user who dropped BEFORE the stitch never signed up: they stay
 * device-only, their profile carries `_drop`, and they run no usage funnels.
 */
import { describe, test, expect } from 'vitest';
import DUNGEON_MASTER from '../../index.js';

const cfg = (firstSequence) => ({
	seed: 'first-funnel-dropoff',
	datasetStart: '2026-01-01T00:00:00.000Z',
	datasetEnd: '2026-01-31T23:59:59.999Z',
	numUsers: 200,
	avgEventsPerUserPerDay: 3,
	percentUsersBornInDataset: 100,
	identity: { avgDevicePerUser: 1 },
	writeToDisk: false,
	verbose: false,
	concurrency: 1,
	events: [
		{ event: 'visit' },
		{ event: 'sign up', isAuthEvent: true },
		{ event: 'onboard' },
		{ event: 'browse', weight: 4 },
		{ event: 'buy', weight: 2 },
		{ event: 'settings', weight: 1 },
	],
	funnels: [
		{ sequence: firstSequence, isFirstFunnel: true, conversionRate: 30, timeToConvert: 1 },
		{ sequence: ['browse', 'buy'], conversionRate: 60, timeToConvert: 1 },
	],
});

function byUser(result) {
	// Device-only rows belong to the user whose stitch carried the device.
	const deviceOwner = new Map();
	const events = Array.from(result.eventData);
	for (const e of events) if (e.user_id && e.device_id) deviceOwner.set(e.device_id, e.user_id);
	const map = new Map();
	for (const e of events) {
		const id = e.user_id || deviceOwner.get(e.device_id) || `device:${e.device_id}`;
		if (!map.has(id)) map.set(id, []);
		map.get(id).push(e);
	}
	return map;
}

describe.sequential('born users after a first-funnel drop-off', () => {
	test('a user who reached the stitch and dropped later runs usage funnels', async () => {
		const result = await DUNGEON_MASTER(cfg(['sign up', 'onboard']));
		const dropped = [...byUser(result).values()]
			.filter(evs => evs.some(e => e.event === 'sign up') && !evs.some(e => e.event === 'onboard'));
		expect(dropped.length).toBeGreaterThan(50);
		const withUsage = dropped.filter(evs => evs.some(e => e.event === 'buy'));
		expect(withUsage.length / dropped.length).toBeGreaterThan(0.8);
		// They are identified users: profile kept, every later event carries user_id.
		const profiles = Array.from(result.userProfilesData);
		const droppedIds = new Set(dropped.map(evs => evs.find(e => e.event === 'sign up').user_id));
		expect(profiles.filter(p => droppedIds.has(p.distinct_id) && p._drop)).toHaveLength(0);
	}, 60000);

	test('a user who dropped before the stitch stays anonymous and runs no usage funnels', async () => {
		const result = await DUNGEON_MASTER(cfg(['visit', 'sign up']));
		const anon = [...byUser(result).entries()].filter(([id]) => id.startsWith('device:')).map(([, evs]) => evs);
		expect(anon.length).toBeGreaterThan(50);
		for (const evs of anon) {
			expect(evs.every(e => !e.user_id)).toBe(true);
			expect(evs.some(e => e.event === 'buy')).toBe(false);
		}
	}, 60000);
});
