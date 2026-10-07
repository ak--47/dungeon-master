//@ts-nocheck
/**
 * 1.9.0: a user's devices mostly share a platform family. The primary device
 * (first in the pool) is drawn from the whole device pool; each extra device is
 * a phone or tablet of the primary's mobile OS, or a desktop. A small share of
 * extra devices still draws from the whole pool, so cross-OS mobile pairs stay
 * rare instead of absent. Before, every device drew its OS independently: with
 * iOS + Android only and avgDevicePerUser 1.5, ~25% of users had both.
 */
import { describe, test, expect } from 'vitest';
import DUNGEON_MASTER from '../../index.js';

const cfg = (switches) => ({
	seed: 'device-platform-family',
	datasetStart: '2026-01-01T00:00:00Z',
	datasetEnd: '2026-01-30T23:59:59Z',
	numUsers: 300,
	avgEventsPerUserPerDay: 3,
	percentUsersBornInDataset: 0,
	identity: { avgDevicePerUser: 1.5 },
	switches: { hasSessionIds: true, ...switches },
	writeToDisk: false,
	verbose: false,
	concurrency: 1,
	events: [{ event: 'a', weight: 5 }, { event: 'b', weight: 3 }, { event: 'c' }],
	funnels: [{ sequence: ['a', 'b'], conversionRate: 50, timeToConvert: 1 }],
});

const family = (os) => (os === 'iOS' || os === 'iPadOS') ? 'apple' : os === 'Android' ? 'android' : 'desktop';

function devicesByUser(result) {
	const users = new Map();
	for (const e of result.eventData) {
		if (!users.has(e.user_id)) users.set(e.user_id, new Map());
		users.get(e.user_id).set(e.device_id, e.os);
	}
	return users;
}

describe.sequential('device platform family', () => {
	test('mobile-only: few users have both iOS and Android devices', async () => {
		const users = devicesByUser(await DUNGEON_MASTER(cfg({ hasIOSDevices: true, hasAndroidDevices: true })));
		const multi = [...users.values()].filter(d => d.size > 1);
		expect(multi.length).toBeGreaterThan(100);
		const cross = multi.filter(d => new Set([...d.values()].map(family)).size > 1);
		expect(cross.length / users.size).toBeLessThan(0.06);
		expect(cross.length).toBeGreaterThan(0);
	}, 60000);

	test('with desktops: an extra device is the primary mobile OS or a desktop', async () => {
		const users = devicesByUser(await DUNGEON_MASTER(cfg({ hasIOSDevices: true, hasAndroidDevices: true, hasDesktopDevices: true })));
		const mobile = [...users.values()].filter(d => d.size > 1)
			.map(d => new Set([...d.values()].map(family)));
		const cross = mobile.filter(f => f.has('apple') && f.has('android'));
		expect(cross.length / users.size).toBeLessThan(0.04);
	}, 60000);

	test('deterministic for a fixed seed', async () => {
		const a = devicesByUser(await DUNGEON_MASTER(cfg({ hasIOSDevices: true, hasAndroidDevices: true })));
		const b = devicesByUser(await DUNGEON_MASTER(cfg({ hasIOSDevices: true, hasAndroidDevices: true })));
		expect([...b.entries()].map(([k, v]) => [k, [...v.entries()]])).toEqual([...a.entries()].map(([k, v]) => [k, [...v.entries()]]));
	}, 60000);
});
