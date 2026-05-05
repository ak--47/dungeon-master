//@ts-nocheck
import { describe, test, expect } from 'vitest';
import { isPreAuthEvent, splitByAuth } from '../lib/hook-helpers/identity.js';

const isoAt = (ms) => new Date(ms).toISOString();

describe('identity atoms', () => {
	test('isPreAuthEvent: true when event time < authTime', () => {
		const auth = Date.parse('2024-02-01T01:00:00Z');
		const before = { time: '2024-02-01T00:30:00Z' };
		const after = { time: '2024-02-01T01:30:00Z' };
		expect(isPreAuthEvent(before, auth)).toBe(true);
		expect(isPreAuthEvent(after, auth)).toBe(false);
	});

	test('isPreAuthEvent: null/undefined authTime → all events pre-auth', () => {
		expect(isPreAuthEvent({ time: 1 }, null)).toBe(true);
		expect(isPreAuthEvent({ time: 1 }, undefined)).toBe(true);
	});

	test('isPreAuthEvent: missing event/time returns false', () => {
		expect(isPreAuthEvent(null, 100)).toBe(false);
		expect(isPreAuthEvent({}, 100)).toBe(false);
	});

	test('splitByAuth: partitions events into preAuth/postAuth and locates the stitch', () => {
		const auth = Date.parse('2024-02-01T01:00:00Z');
		const preEvent = { event: 'land', time: isoAt(auth - 60_000), device_id: 'd1' };
		const stitchEvent = { event: 'sign_up', time: isoAt(auth), user_id: 'u1', device_id: 'd1' };
		const postEvent = { event: 'do', time: isoAt(auth + 60_000), user_id: 'u1' };
		const { preAuth, postAuth, stitch } = splitByAuth([preEvent, stitchEvent, postEvent], auth);
		expect(preAuth).toEqual([preEvent]);
		expect(postAuth).toEqual([stitchEvent, postEvent]);
		expect(stitch).toBe(stitchEvent);
	});

	test('splitByAuth: stitch is null when no event has both stamped', () => {
		const auth = Date.parse('2024-02-01T01:00:00Z');
		const events = [
			{ event: 'land', time: isoAt(auth - 60_000), device_id: 'd1' },
			{ event: 'do', time: isoAt(auth + 60_000), user_id: 'u1' },
		];
		const { stitch } = splitByAuth(events, auth);
		expect(stitch).toBe(null);
	});
});
