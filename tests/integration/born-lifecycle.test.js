//@ts-nocheck
/**
 * Born-in-dataset user lifecycle contracts.
 *
 * 1. Legacy mode (no retentionCurve, no avgActiveDaysPerUser, no attempts):
 *    a born user's first funnel starts at profile.created, not anywhere in
 *    [created, FIXED_NOW].
 * 2. engagementDecay never drops the signup (isFirstEvent / stitch
 *    isAuthEvent) and anchors on the user's first emitted event.
 * 3. worldEvents volumeMultiplier > 1 clones land only inside the user's
 *    lifetime (never before the first event / stitch, never past FIXED_NOW).
 */

import { describe, test, expect } from 'vitest';
import DUNGEON_MASTER from '../../index.js';

const base = (overrides = {}) => ({
	seed: 'born-lifecycle',
	datasetStart: '2025-01-01T00:00:00Z',
	datasetEnd: '2025-04-01T00:00:00Z',
	numUsers: 200,
	avgEventsPerUserPerDay: 1,
	percentUsersBornInDataset: 100,
	avgDevicePerUser: 1,
	events: [
		{ event: 'sign up', isFirstEvent: true, isAuthEvent: true },
		{ event: 'workout', weight: 5 },
		{ event: 'browse', weight: 3 },
	],
	funnels: [
		{ sequence: ['sign up', 'workout'], isFirstFunnel: true, conversionRate: 100, timeToConvert: 1 },
		{ sequence: ['browse', 'workout'], conversionRate: 50, timeToConvert: 2 },
	],
	writeToDisk: false,
	verbose: false,
	...overrides,
});

const ms = (t) => (typeof t === 'string' ? Date.parse(t) : Number(t));

function signupsByUser(events) {
	const map = new Map();
	for (const ev of events) {
		if (ev.event !== 'sign up' || !ev.user_id) continue;
		// Earliest signup: world-event clones of the signup can land later.
		const t = ms(ev.time);
		if (!map.has(ev.user_id) || t < map.get(ev.user_id)) map.set(ev.user_id, t);
	}
	return map;
}

function median(xs) {
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.floor(s.length / 2)];
}

describe.sequential('born-user lifecycle', () => {
	test('legacy mode: first funnel step 0 is pinned to profile.created', async () => {
		const result = await DUNGEON_MASTER(base());
		const events = Array.from(result.eventData);
		const profiles = Array.from(result.userProfilesData);
		const signups = signupsByUser(events);
		const lagsHours = [];
		for (const p of profiles) {
			if (!p.created || !signups.has(p.distinct_id)) continue;
			// Birth can sit a few hours before datasetStart; the engine clamps the
			// lifecycle start to the window.
			const birth = Math.max(ms(p.created), Date.parse('2025-01-01T00:00:00Z'));
			lagsHours.push((signups.get(p.distinct_id) - birth) / 3600000);
		}
		expect(lagsHours.length).toBeGreaterThan(150);
		// Signup never precedes birth, and lands at birth (allow 1s rounding).
		expect(Math.min(...lagsHours)).toBeGreaterThanOrEqual(-1 / 3600);
		expect(Math.max(...lagsHours)).toBeLessThan(1 / 3600 + 1e-9);
		expect(median(lagsHours)).toBeLessThan(1);
	});

	test('engagementDecay never drops the signup stitch (active-day mode)', async () => {
		// Active-day mode anchors the signup on a picked day, often days after
		// adjustedCreated, so the old created-anchored decay could drop it.
		const result = await DUNGEON_MASTER(base({
			numUsers: 300,
			avgActiveDaysPerUser: 10,
			engagementDecay: { model: 'exponential', halfLife: 60, floor: 0.3 },
		}));
		const events = Array.from(result.eventData);
		const profiles = Array.from(result.userProfilesData);
		const signups = signupsByUser(events);
		expect(profiles.filter(p => !signups.has(p.distinct_id))).toHaveLength(0);
		expect(events.filter(ev => !ev.user_id)).toHaveLength(0);
	});

	test('volumeMultiplier clones never land before the stitch or past FIXED_NOW', async () => {
		const result = await DUNGEON_MASTER(base({
			worldEvents: [{ name: 'promo', startDay: 10, duration: 40, volumeMultiplier: 3, affectsEvents: '*' }],
		}));
		const events = Array.from(result.eventData);
		const signups = signupsByUser(events);
		const fixedNow = Date.parse('2025-04-01T00:00:00Z');
		let before = 0;
		let future = 0;
		let deviceOnly = 0;
		for (const ev of events) {
			const t = ms(ev.time);
			if (t > fixedNow) future++;
			if (!ev.user_id) { deviceOnly++; continue; }
			const s = signups.get(ev.user_id);
			if (s !== undefined && t < s) before++;
		}
		expect(future).toBe(0);
		expect(before).toBe(0);
		expect(deviceOnly).toBe(0);
	});
});
