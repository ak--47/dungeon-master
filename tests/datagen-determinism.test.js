//@ts-nocheck
/**
 * v1.5 determinism: same seed → byte-equal events array.
 *
 * Cross-version byte-equality vs pre-v1.5 is NOT a goal (active-day scheduler
 * intentionally changes timestamp placement). Within v1.5, repeated runs of
 * the same config must produce identical event/profile/SCD arrays.
 */

import { describe, test, expect } from 'vitest';
import DUNGEON_MASTER from '../index.js';

const minimal = () => ({
	seed: 'det-minimal',
	datasetStart: '2025-09-01T00:00:00Z',
	datasetEnd: '2025-10-01T00:00:00Z',
	numUsers: 50,
	avgEventsPerUserPerDay: 3,
	avgActiveDaysPerUser: 4,
	events: [
		{ event: 'page view', weight: 5 },
		{ event: 'click', weight: 3 },
	],
	funnels: [{
		sequence: ['page view', 'click'],
		timeToConvert: 1,
		order: 'sequential',
	}],
	writeToDisk: false,
	verbose: false,
});

const identityModel = () => ({
	seed: 'det-identity',
	datasetStart: '2025-09-01T00:00:00Z',
	datasetEnd: '2025-10-01T00:00:00Z',
	numUsers: 30,
	avgEventsPerUserPerDay: 3,
	avgDevicePerUser: 2,
	hasSessionIds: true,
	hasCampaigns: true,
	maxTouchpointsPerUser: 5,
	events: [
		{ event: 'sign up', isFirstEvent: true, isAuthEvent: true, isAttributionEvent: true },
		{ event: 'page view', weight: 5, isAttributionEvent: true },
		{ event: 'purchase', weight: 1 },
	],
	funnels: [{
		sequence: ['sign up', 'page view', 'purchase'],
		isFirstFunnel: true,
		conversionRate: 50,
		timeToConvert: 6,
		conversionWindowDays: 14,
		order: 'sequential',
	}],
	writeToDisk: false,
	verbose: false,
});

// `insert_id` is generated via crypto.randomUUID() per event — intentionally
// non-deterministic. Strip it before comparing so determinism is asserted on
// the seeded fields (event, time, properties, user_id, etc.).
function stripInsertId(events) {
	return Array.from(events).map(e => {
		const { insert_id, ...rest } = e;
		return rest;
	});
}

function eventsToString(eventData) {
	return JSON.stringify(stripInsertId(eventData));
}

function profilesToString(profilesData) {
	return JSON.stringify(Array.from(profilesData));
}

// `validateDungeonConfig` mutates input (auto-promotes isStrictEvent, pushes
// catch-all funnels, sets conversionWindowDays). Determinism requires each
// run to start from a pristine config — deep-clone before each call.
function deep(obj) { return JSON.parse(JSON.stringify(obj)); }

// `sequence.concurrent: true` (vitest.config.js) parallelizes tests within a
// file. The seeded chance singleton is process-global, so concurrent tests
// interleave consumption and break determinism. Force this suite sequential.
describe.sequential('v1.5 determinism — same seed → byte-equal output', () => {
	test('minimal config produces byte-equal events across two runs', async () => {
		const r1 = await DUNGEON_MASTER(deep(minimal()));
		const r2 = await DUNGEON_MASTER(deep(minimal()));
		expect(eventsToString(r1.eventData)).toBe(eventsToString(r2.eventData));
	});

	test('minimal config produces byte-equal profiles', async () => {
		const r1 = await DUNGEON_MASTER(deep(minimal()));
		const r2 = await DUNGEON_MASTER(deep(minimal()));
		expect(profilesToString(r1.userProfilesData)).toBe(profilesToString(r2.userProfilesData));
	});

	test('identity-model config (with funnels + UTMs + multi-device) is deterministic', async () => {
		const r1 = await DUNGEON_MASTER(deep(identityModel()));
		const r2 = await DUNGEON_MASTER(deep(identityModel()));
		expect(eventsToString(r1.eventData)).toBe(eventsToString(r2.eventData));
		expect(profilesToString(r1.userProfilesData)).toBe(profilesToString(r2.userProfilesData));
	});

	test('different seeds → different events (sanity)', async () => {
		const a = await DUNGEON_MASTER(deep({ ...minimal(), seed: 'seed-A' }));
		const b = await DUNGEON_MASTER(deep({ ...minimal(), seed: 'seed-B' }));
		expect(eventsToString(a.eventData)).not.toBe(eventsToString(b.eventData));
	});

	test('canonical fixture (datagen-v1.5-verify.js) is deterministic', async () => {
		const fixture = (await import('../dungeons/technical/datagen-v15-verify.js')).default;
		const r1 = await DUNGEON_MASTER(deep(fixture));
		const r2 = await DUNGEON_MASTER(deep(fixture));
		expect(eventsToString(r1.eventData)).toBe(eventsToString(r2.eventData));
	});
});
