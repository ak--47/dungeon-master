//@ts-nocheck
/**
 * 1.9.0: a config with no `isAuthEvent` anywhere has no stitch step, so a born
 * user is identified from their first event (every event gets `user_id` by
 * default). Their profile is not `_drop`. Before, every born profile was marked
 * `_drop` (never sent to /engage) while the events carried `user_id`, and with a
 * device pool the first-funnel and standalone events were device-only.
 * Configs with an `isAuthEvent` keep the stitch contract (anonymous-non-convert).
 */
import { describe, test, expect } from 'vitest';
import DUNGEON_MASTER from '../../index.js';

const cfg = (devices) => ({
	seed: 'no-auth-event-identity',
	datasetStart: '2026-01-01T00:00:00Z',
	datasetEnd: '2026-01-30T23:59:59Z',
	numUsers: 200,
	avgEventsPerUserPerDay: 3,
	percentUsersBornInDataset: 100,
	identity: { avgDevicePerUser: devices },
	writeToDisk: false,
	verbose: false,
	concurrency: 1,
	events: [{ event: 'visit' }, { event: 'sign_up' }, { event: 'browse', weight: 5 }, { event: 'buy' }],
	funnels: [
		{ sequence: ['visit', 'sign_up'], conversionRate: 50, isFirstFunnel: true, timeToConvert: 1 },
		{ sequence: ['browse', 'buy'], conversionRate: 50, timeToConvert: 1 },
	],
});

describe.sequential('born users in a config without isAuthEvent', () => {
	test.each([[0], [1], [2]])('avgDevicePerUser %i: profiles kept, every event identified', async (devices) => {
		const result = await DUNGEON_MASTER(cfg(devices));
		const profiles = Array.from(result.userProfilesData);
		expect(profiles.length).toBe(200);
		expect(profiles.filter(p => p._drop)).toHaveLength(0);
		const events = Array.from(result.eventData);
		expect(events.length).toBeGreaterThan(1000);
		expect(events.filter(e => !e.user_id)).toHaveLength(0);
	}, 60000);
});
