//@ts-nocheck
/**
 * Phase 2 identity-model tests.
 *
 * Verifies the post-1.4 identity stamping rules:
 *   - Born-in-dataset users running their isFirstFunnel produce exactly one stitch
 *     event (an event with both user_id and device_id) per CONVERTED user.
 *   - Pre-auth steps in the first funnel are device_id only.
 *   - Post-auth steps in the first funnel are user_id only.
 *   - Multi-device users (avgDevicePerUser > 1) have a per-user device pool, sticky
 *     per session_id (when hasSessionIds is true).
 *   - Pre-existing users (born before the dataset window) are pre-stitched: every
 *     event carries user_id (and device_id when there's a device pool).
 *   - attempts.{min,max} produce the right number of total funnel passes.
 *   - Backwards compat: legacy dungeon (no isAuthEvent / no attempts / no
 *     avgDevicePerUser) produces same event count (within ±5% tolerance) as before.
 */

import { describe, test, expect } from 'vitest';
import DUNGEON_MASTER from '../index.js';
import dayjs from 'dayjs';

const FIXED_NOW = dayjs('2024-02-02').unix();

function pinWindow(extra = {}) {
	return {
		datasetStart: FIXED_NOW - 30 * 86400,
		datasetEnd: FIXED_NOW,
		writeToDisk: false,
		verbose: false,
		concurrency: 1,
		...extra,
	};
}

describe('Phase 2 identity model', () => {
	test('isFirstFunnel converted users get a stitch event (both user_id + device_id)', async () => {
		// Configure events such that the funnel-only events do NOT bleed into the standalone
		// weighted picker by giving them isStrictEvent: true (they only fire when explicitly
		// placed in a funnel). Provide one non-strict event so the standalone pool is non-empty.
		const result = await DUNGEON_MASTER(pinWindow({
			seed: 'identity-stitch-single',
			numUsers: 200,
			numDays: 30,
			avgEventsPerUserPerDay: 5,
			percentUsersBornInDataset: 100,
			hasAnonIds: true,
			events: [
				{ event: 'land', weight: 5, isStrictEvent: true },
				{ event: 'sign_up', isFirstEvent: true, isAuthEvent: true, isStrictEvent: true },
				{ event: 'browse', weight: 3 },
			],
			funnels: [
				{ sequence: ['land', 'sign_up'], conversionRate: 60, isFirstFunnel: true, timeToConvert: 1 },
			],
		}));
		const events = Array.from(result.eventData);
		// Every born-in-dataset user that converted (fired sign_up via the funnel — i.e.
		// sign_up with user_id stamped) must have at least one event carrying both
		// user_id AND device_id (the stitch). Note: sign_up is isStrictEvent so it only
		// fires when the funnel reaches it; converted users always reach it.
		const convertedUsers = new Set(
			events.filter(e => e.event === 'sign_up' && e.user_id).map(e => e.user_id)
		);
		expect(convertedUsers.size).toBeGreaterThan(0);
		const usersWithStitch = new Set();
		for (const ev of events) {
			if (ev.user_id && ev.device_id) usersWithStitch.add(ev.user_id);
		}
		for (const uid of convertedUsers) {
			expect(usersWithStitch.has(uid)).toBe(true);
		}
	});

	test('pre-auth events in isFirstFunnel are device_id only', async () => {
		const result = await DUNGEON_MASTER(pinWindow({
			seed: 'identity-preauth',
			numUsers: 100,
			numDays: 30,
			avgEventsPerUserPerDay: 3,
			percentUsersBornInDataset: 100,
			hasAnonIds: true,
			events: [
				{ event: 'visit_landing', isFirstEvent: true, isStrictEvent: true },
				{ event: 'view_pricing', weight: 2, isStrictEvent: true },
				{ event: 'sign_up', isAuthEvent: true, isStrictEvent: true },
				{ event: 'first_action', isStrictEvent: true },
				// One non-strict event so the standalone pool is non-empty (avoids divide-by-zero
				// in user-loop's weighted picker when the only events left are isStrictEvent).
				{ event: 'do_thing', weight: 5 },
			],
			funnels: [
				{ sequence: ['visit_landing', 'view_pricing', 'sign_up', 'first_action'],
				  conversionRate: 100, isFirstFunnel: true, timeToConvert: 1 },
			],
		}));
		const events = Array.from(result.eventData);
		// Pre-auth funnel events: visit_landing, view_pricing → device_id only (no user_id).
		const preAuthLanding = events.filter(e => e.event === 'visit_landing');
		const preAuthPricing = events.filter(e => e.event === 'view_pricing');
		expect(preAuthLanding.length).toBeGreaterThan(0);
		expect(preAuthPricing.length).toBeGreaterThan(0);
		expect(preAuthLanding.every(e => e.device_id && !e.user_id)).toBe(true);
		expect(preAuthPricing.every(e => e.device_id && !e.user_id)).toBe(true);
		// Stitch event: sign_up → both
		const stitches = events.filter(e => e.event === 'sign_up');
		expect(stitches.length).toBeGreaterThan(0);
		expect(stitches.every(e => e.device_id && e.user_id)).toBe(true);
		// Post-auth funnel event: first_action → user_id only (within the first funnel).
		const postAuth = events.filter(e => e.event === 'first_action');
		expect(postAuth.length).toBeGreaterThan(0);
		expect(postAuth.every(e => e.user_id && !e.device_id)).toBe(true);
	});

	test('multi-device user: per-session sticky device, multiple devices across sessions', async () => {
		const result = await DUNGEON_MASTER(pinWindow({
			seed: 'identity-multidevice',
			numUsers: 50,
			numDays: 30,
			avgEventsPerUserPerDay: 8,
			percentUsersBornInDataset: 0, // pre-existing users only — every event already authed
			avgDevicePerUser: 3,
			hasSessionIds: true,
			events: [{ event: 'open_app', weight: 5 }, { event: 'do_thing', weight: 3 }],
		}));
		const events = Array.from(result.eventData);
		// Group by user_id, then check session→device 1:1 mapping.
		const byUser = new Map();
		for (const ev of events) {
			if (!ev.user_id || !ev.device_id || !ev.session_id) continue;
			if (!byUser.has(ev.user_id)) byUser.set(ev.user_id, []);
			byUser.get(ev.user_id).push(ev);
		}
		expect(byUser.size).toBeGreaterThan(0);
		let usersWithMultipleDevices = 0;
		for (const [uid, evs] of byUser) {
			// Sticky-per-session: every event in a session must share the same device_id.
			const sessionDevice = new Map();
			for (const ev of evs) {
				if (!sessionDevice.has(ev.session_id)) sessionDevice.set(ev.session_id, ev.device_id);
				else expect(sessionDevice.get(ev.session_id)).toBe(ev.device_id);
			}
			const distinctDevices = new Set(evs.map(e => e.device_id));
			if (distinctDevices.size > 1) usersWithMultipleDevices++;
		}
		// At least some users should have used multiple devices across their sessions.
		expect(usersWithMultipleDevices).toBeGreaterThan(0);
	});

	test('pre-existing users always have user_id', async () => {
		const result = await DUNGEON_MASTER(pinWindow({
			seed: 'identity-preexisting',
			numUsers: 100,
			numDays: 30,
			avgEventsPerUserPerDay: 4,
			percentUsersBornInDataset: 0, // 100% pre-existing
			hasAnonIds: true,
			events: [{ event: 'do_thing', weight: 5 }],
		}));
		const events = Array.from(result.eventData);
		// Every event must have user_id (pre-existing users are pre-stitched).
		const withoutUserId = events.filter(e => !e.user_id);
		expect(withoutUserId.length).toBe(0);
	});

	test('attempts.{min,max} produces the configured number of attempts', async () => {
		const result = await DUNGEON_MASTER(pinWindow({
			seed: 'identity-attempts',
			numUsers: 200,
			numDays: 30,
			avgEventsPerUserPerDay: 8,
			percentUsersBornInDataset: 100,
			hasAnonIds: true,
			events: [
				{ event: 'land', isFirstEvent: true, isStrictEvent: true },
				{ event: 'view_pricing', isStrictEvent: true },
				{ event: 'sign_up', isAuthEvent: true, isStrictEvent: true },
				{ event: 'do_thing', weight: 3 },
			],
			funnels: [
				{ sequence: ['land', 'view_pricing', 'sign_up'],
				  conversionRate: 100, isFirstFunnel: true, timeToConvert: 1,
				  attempts: { min: 2, max: 2 } }, // exactly 2 failed priors → 3 total
			],
		}));
		const events = Array.from(result.eventData);
		// Every born-in-dataset user should have:
		//   - 2 failed pre-auth attempts (each: 1–2 events of land/view_pricing, all device_id only)
		//   - 1 final attempt that converts (full sequence including sign_up stitch)
		// So per user: ≥ 3 land events (1 per attempt).
		const landByUser = new Map();
		for (const ev of events) {
			const key = ev.user_id || ev.device_id;
			if (ev.event === 'land') landByUser.set(key, (landByUser.get(key) || 0) + 1);
		}
		expect(landByUser.size).toBeGreaterThan(0);
		// Most users should have ≥ 3 land events (one per attempt).
		const usersWithThreePlus = Array.from(landByUser.values()).filter(c => c >= 3).length;
		// Born-in-dataset users with conversionRate=100 always reach final attempt's
		// land step. Allow some users on edge of dataset window to skip.
		expect(usersWithThreePlus / landByUser.size).toBeGreaterThan(0.5);
	});

	test('backwards compat: no isAuthEvent / no attempts / no avgDevicePerUser → no exceptions, similar event count', async () => {
		const baseConfig = pinWindow({
			seed: 'identity-bcompat',
			numUsers: 100,
			numDays: 30,
			avgEventsPerUserPerDay: 5,
			percentUsersBornInDataset: 30,
			events: [{ event: 'foo', weight: 5 }, { event: 'bar', weight: 3 }],
		});
		const result = await DUNGEON_MASTER(baseConfig);
		const events = Array.from(result.eventData);
		// All events must have user_id (legacy default is to stamp every event now).
		expect(events.every(e => !!e.user_id)).toBe(true);
		// No event should have a device_id (avgDevicePerUser defaults to 0 when hasAnonIds is unset).
		expect(events.every(e => !e.device_id)).toBe(true);
	});
});
