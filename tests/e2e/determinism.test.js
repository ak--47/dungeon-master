//@ts-nocheck
/**
 * v1.5 determinism: same seed → byte-equal events array.
 *
 * Cross-version byte-equality vs pre-v1.5 is NOT a goal (active-day scheduler
 * intentionally changes timestamp placement). Within v1.5, repeated runs of
 * the same config must produce identical event/profile/SCD arrays.
 */

import { describe, test, expect } from 'vitest';
import DUNGEON_MASTER from '../../index.js';
import { cloneEvent } from '../../lib/hook-helpers/mutate.js';

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
	identity: { avgDevicePerUser: 2 },
	switches: { hasSessionIds: true, hasCampaigns: true },
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

// 1.8.5: `insert_id` is deterministic (hashed, never randomUUID), so it is
// compared with every other field. A seeded re-import must dedupe, not double.
function eventsToString(eventData) {
	return JSON.stringify(Array.from(eventData));
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
		const fixture = (await import('../../dungeons/technical/datagen-v15-verify.js')).default;
		const r1 = await DUNGEON_MASTER(deep(fixture));
		const r2 = await DUNGEON_MASTER(deep(fixture));
		expect(eventsToString(r1.eventData)).toBe(eventsToString(r2.eventData));
	});

	// v1.5 follow-up (`reccomendations-agent-1.md` Fix #3): exercise the
	// engagementDecay × active-day combination. Fix #1 added a pickedDayBuckets
	// check inside applyEngagementDecay — this test fails if that check
	// introduces any non-deterministic behavior (e.g., unseeded RNG).
	test('decay + active-day config is deterministic', async () => {
		const decayActive = () => ({
			seed: 'det-decay-active',
			datasetStart: '2025-09-01T00:00:00Z',
			datasetEnd: '2025-10-01T00:00:00Z',
			numUsers: 30,
			avgEventsPerUserPerDay: 4,
			avgActiveDaysPerUser: 5,
			engagementDecay: { model: 'exponential', halfLife: 7, floor: 0.05 },
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
		const r1 = await DUNGEON_MASTER(deep(decayActive()));
		const r2 = await DUNGEON_MASTER(deep(decayActive()));
		expect(eventsToString(r1.eventData)).toBe(eventsToString(r2.eventData));
	});

	// 1.8.5: every insert_id path — generator, hook clones (helper and raw
	// spread), dataQuality duplicates, worldEvents amplification, the final
	// uniqueness pass, standalone streams — mints the same ids every run, and
	// every id passes Mixpanel's import validation.
	test('insert_id is deterministic and Mixpanel-valid on every clone path', async () => {
		const cloney = () => ({
			seed: 'det-insert-id',
			datasetStart: '2025-09-01T00:00:00Z',
			datasetEnd: '2025-10-01T00:00:00Z',
			numUsers: 30,
			avgEventsPerUserPerDay: 3,
			events: [
				{ event: 'page view', weight: 5 },
				{ event: 'purchase', weight: 1 },
			],
			worldEvents: [{ name: 'sale', startDay: 10, duration: 3, volumeMultiplier: 2.5, affectsEvents: ['purchase'] }],
			dataQuality: { duplicateRate: 0.05 },
			standaloneEvents: [{ event: 'cdn_egress', cadence: 'day', dimensions: { region: ['us', 'eu'] }, distinctIdFrom: 'region', properties: { gb: [1, 2] } }],
			hook: (record, type) => {
				if (type !== 'everything') return record;
				const src = record.find(e => e.event === 'purchase');
				if (!src) return record;
				const later = new Date(Date.parse(src.time) + 60_000).toISOString();
				// helper clone, two same-time helper clones, and a raw spread that keeps the source id
				record.push(cloneEvent(src, { time: later }), cloneEvent(src), cloneEvent(src), { ...src });
				return record;
			},
			writeToDisk: false,
			verbose: false,
		});
		const r1 = await DUNGEON_MASTER(cloney());
		const r2 = await DUNGEON_MASTER(cloney());
		expect(eventsToString(r1.eventData)).toBe(eventsToString(r2.eventData));
		expect(JSON.stringify(Array.from(r1.standaloneEventData))).toBe(JSON.stringify(Array.from(r2.standaloneEventData)));

		const all = [...r1.eventData, ...r1.standaloneEventData];
		const ids = all.map(e => e.insert_id);
		for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9-]{1,36}$/);
		const eventIds = Array.from(r1.eventData).map(e => e.insert_id);
		expect(new Set(eventIds).size).toBe(eventIds.length);
	});
});
