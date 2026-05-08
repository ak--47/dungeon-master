//@ts-nocheck
/**
 * Identity resolver — device→user map inversion + per-event resolution.
 *
 * Mirrors Mixpanel's ID merge: pre-auth events stamped with `device_id` only
 * collapse onto the same canonical user as the post-auth events (`user_id`).
 */

import { describe, test, expect } from 'vitest';
import { buildIdentityMap, resolveUserId } from '../../lib/verify/identity.js';

describe('buildIdentityMap', () => {
	test('inverts a single profile with multiple devices', () => {
		const map = buildIdentityMap([
			{ distinct_id: 'user-1', device_ids: ['d1', 'd2', 'd3'] },
		]);
		expect(map.size).toBe(3);
		expect(map.get('d1')).toBe('user-1');
		expect(map.get('d2')).toBe('user-1');
		expect(map.get('d3')).toBe('user-1');
	});

	test('handles profiles missing device_ids', () => {
		const map = buildIdentityMap([
			{ distinct_id: 'user-1' },
			{ distinct_id: 'user-2', device_ids: [] },
			{ distinct_id: 'user-3', device_ids: ['d1'] },
		]);
		expect(map.size).toBe(1);
		expect(map.get('d1')).toBe('user-3');
	});

	test('first-profile-wins on duplicate device_ids', () => {
		const map = buildIdentityMap([
			{ distinct_id: 'user-1', device_ids: ['shared'] },
			{ distinct_id: 'user-2', device_ids: ['shared'] },
		]);
		expect(map.get('shared')).toBe('user-1');
	});

	test('falls back to user_id when distinct_id missing', () => {
		const map = buildIdentityMap([
			{ user_id: 'user-1', device_ids: ['d1'] },
		]);
		expect(map.get('d1')).toBe('user-1');
	});

	test('graceful with empty / non-array input', () => {
		expect(buildIdentityMap([]).size).toBe(0);
		expect(buildIdentityMap(null).size).toBe(0);
		expect(buildIdentityMap(undefined).size).toBe(0);
	});

	test('skips profiles with no canonical id', () => {
		const map = buildIdentityMap([
			{ device_ids: ['orphan'] },
			{ distinct_id: 'user-1', device_ids: ['d1'] },
		]);
		expect(map.size).toBe(1);
		expect(map.get('d1')).toBe('user-1');
		expect(map.has('orphan')).toBe(false);
	});
});

describe('resolveUserId', () => {
	const map = buildIdentityMap([
		{ distinct_id: 'user-1', device_ids: ['d1', 'd2'] },
	]);

	test('event.distinct_id wins above all (Mixpanel canonical post-merge)', () => {
		expect(resolveUserId({ distinct_id: 'stitched', device_id: 'd1', user_id: 'u99' }, map)).toBe('stitched');
	});

	test('device_id resolves via map when distinct_id absent', () => {
		expect(resolveUserId({ device_id: 'd1' }, map)).toBe('user-1');
		expect(resolveUserId({ device_id: 'd2' }, map)).toBe('user-1');
	});

	test('user_id resolves when distinct_id + device_id both absent', () => {
		expect(resolveUserId({ user_id: 'user-1' }, map)).toBe('user-1');
	});

	test('falls back to event.user_id when device_id not in map', () => {
		expect(resolveUserId({ device_id: 'unknown', user_id: 'user-99' }, map)).toBe('user-99');
	});

	test('falls back to distinct_id', () => {
		expect(resolveUserId({ distinct_id: 'user-2' }, map)).toBe('user-2');
	});

	test('falls back to device_id (anonymous)', () => {
		expect(resolveUserId({ device_id: 'd-orphan' }, map)).toBe('d-orphan');
	});

	test('returns undefined when event empty', () => {
		expect(resolveUserId({}, map)).toBeUndefined();
		expect(resolveUserId(null, map)).toBeUndefined();
	});

	test('works without identityMap (legacy fallback)', () => {
		expect(resolveUserId({ user_id: 'u1', device_id: 'd1' })).toBe('u1');
		expect(resolveUserId({ device_id: 'd1' })).toBe('d1');
	});
});
