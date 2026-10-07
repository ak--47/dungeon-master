//@ts-nocheck
/**
 * Default device fields (model, os, screen size, carrier) and browser are
 * sticky: one value set per device_id when the user has a device pool, one
 * per user when events carry no device_id. A user with several devices may
 * show several device models (one per device). `radio` stays per event.
 */
import { describe, test, expect } from 'vitest';
import DUNGEON_MASTER from '../../index.js';

const STICKY_KEYS = ['model', 'os', 'screen_height', 'screen_width', 'carrier', 'browser'];

function config(overrides = {}) {
	return {
		seed: 'sticky-device-fields',
		datasetStart: '2026-06-01T00:00:00Z',
		datasetEnd: '2026-07-15T23:59:59Z',
		numUsers: 150,
		avgEventsPerUserPerDay: 3,
		concurrency: 1,
		writeToDisk: false,
		verbose: false,
		macro: { percentUsersBornInDataset: 40 },
		switches: {
			hasSessionIds: true,
			hasAndroidDevices: true,
			hasIOSDevices: true,
			hasDesktopDevices: true,
			hasBrowser: true,
			hasLocation: false,
		},
		identity: { avgDevicePerUser: 3 },
		events: [
			{ event: 'sign up', isFirstEvent: true, isAuthEvent: true },
			{ event: 'landing', weight: 1 },
			{ event: 'workout completed', weight: 5, properties: { minutes: [10, 20, 30] } },
			{ event: 'app open', weight: 5 },
		],
		funnels: [
			{ sequence: ['landing', 'sign up'], isFirstFunnel: true, conversionRate: 70, timeToConvert: 1 },
			{ sequence: ['app open', 'workout completed'], conversionRate: 60, timeToConvert: 1, weight: 3 },
		],
		worldEvents: [{ name: 'challenge', startDay: 10, duration: 10, volumeMultiplier: 1.5, affectsEvents: ['workout completed'] }],
		dataQuality: { duplicateRate: 0.02 },
		...overrides,
	};
}

function tuple(e) {
	return JSON.stringify(STICKY_KEYS.map(k => e[k] ?? null));
}

function groupTuples(events, keyFn) {
	const out = new Map();
	for (const e of events) {
		const key = keyFn(e);
		if (!key) continue;
		if (!out.has(key)) out.set(key, new Set());
		out.get(key).add(tuple(e));
	}
	return out;
}

describe.sequential('sticky device fields', () => {
	test('one device field set per device_id; users keep device variety', async () => {
		const r = await DUNGEON_MASTER(config());
		const events = Array.from(r.eventData);
		const withDevice = events.filter(e => e.device_id);
		expect(withDevice.length).toBeGreaterThan(1000);
		expect(withDevice.every(e => e.model && e.os)).toBe(true);

		const byDevice = groupTuples(withDevice, e => e.device_id);
		const multi = [...byDevice.values()].filter(s => s.size > 1).length;
		expect(multi).toBe(0);

		// Events without a device_id carry one device field set per user.
		const byUserNoDevice = groupTuples(events.filter(e => !e.device_id), e => e.user_id);
		expect([...byUserNoDevice.values()].filter(s => s.size > 1).length).toBe(0);

		// A multi-device user can own different devices; the population is diverse.
		const modelsByUser = new Map();
		for (const e of withDevice) {
			if (!e.user_id) continue;
			if (!modelsByUser.has(e.user_id)) modelsByUser.set(e.user_id, new Set());
			modelsByUser.get(e.user_id).add(e.model);
		}
		expect([...modelsByUser.values()].some(s => s.size > 1)).toBe(true);
		expect(new Set(withDevice.map(e => e.model)).size).toBeGreaterThan(15);
		expect(new Set(withDevice.map(e => e.browser)).size).toBeGreaterThan(5);
		// Network radio still varies per event.
		const radioPerDevice = new Map();
		for (const e of withDevice) {
			if (!radioPerDevice.has(e.device_id)) radioPerDevice.set(e.device_id, new Set());
			radioPerDevice.get(e.device_id).add(e.radio);
		}
		expect([...radioPerDevice.values()].some(s => s.size > 1)).toBe(true);
	}, 120_000);

	test('one device field set per user when there is no device pool', async () => {
		const r = await DUNGEON_MASTER(config({ identity: { avgDevicePerUser: 0 }, macro: { percentUsersBornInDataset: 0 } }));
		const events = Array.from(r.eventData);
		expect(events.some(e => e.device_id)).toBe(false);
		const byUser = groupTuples(events, e => e.user_id);
		expect(byUser.size).toBeGreaterThan(100);
		expect([...byUser.values()].filter(s => s.size > 1).length).toBe(0);
		expect(new Set(events.map(e => e.model)).size).toBeGreaterThan(15);
	}, 120_000);

	test('an event hook value for a device field survives the session device pass', async () => {
		const hook = (record, type) => {
			if (type === 'event' && record.event === 'workout completed') record.os = 'HookOS';
			return record;
		};
		const r = await DUNGEON_MASTER(config({ hook, worldEvents: [], dataQuality: undefined }));
		const workouts = Array.from(r.eventData).filter(e => e.event === 'workout completed');
		expect(workouts.length).toBeGreaterThan(100);
		expect(workouts.every(e => e.os === 'HookOS')).toBe(true);
	}, 120_000);
	// 1.9.0: the browser comes from a pool valid for the device's OS. Before, it
	// was drawn from one mixed list (Mobile Safari on Windows, Edge on iOS).
	test('the browser is valid for the device OS', async () => {
		const MOBILE_IOS = ['Mobile Safari', 'Chrome iOS', 'Firefox iOS', 'Microsoft Edge iOS', 'DuckDuckGo Mobile', 'Brave Mobile', 'Opera Mini'];
		const ANDROID = ['Chrome Mobile', 'Samsung Internet', 'Firefox Mobile', 'Microsoft Edge Mobile', 'Opera Mobile', 'DuckDuckGo Mobile', 'Brave Mobile', 'UC Browser', 'Opera Mini'];
		const DESKTOP_COMMON = ['Chrome', 'Firefox', 'Microsoft Edge', 'Opera', 'Brave', 'Vivaldi'];
		const ALLOWED = {
			iOS: MOBILE_IOS,
			iPadOS: MOBILE_IOS,
			Android: ANDROID,
			Windows: [...DESKTOP_COMMON, 'Opera GX'],
			macOS: [...DESKTOP_COMMON, 'Safari', 'Arc'],
			Linux: DESKTOP_COMMON,
			'Pop!_OS': DESKTOP_COMMON,
			PureOS: DESKTOP_COMMON,
		};
		const r = await DUNGEON_MASTER(config({ worldEvents: [], dataQuality: undefined }));
		const events = Array.from(r.eventData);
		const seen = new Map();
		for (const e of events) {
			expect(ALLOWED[e.os], `unknown os ${e.os}`).toBeDefined();
			expect(ALLOWED[e.os], `${e.os} with ${e.browser}`).toContain(e.browser);
			if (!seen.has(e.os)) seen.set(e.os, new Set());
			seen.get(e.os).add(e.browser);
		}
		for (const os of ['iOS', 'Android', 'Windows', 'macOS']) {
			expect(seen.get(os)?.size ?? 0, os).toBeGreaterThan(1);
		}
	}, 120_000);
});
