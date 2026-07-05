//@ts-nocheck
/**
 * P1.2 unit tests: uniques (per-interval dedup / rolling XAU / cumulative).
 *
 * Every expected value below is hand-computed from the ARB rule the
 * implementation cites — NOT derived from running the implementation:
 *   - per-interval INDEPENDENT dedup: normal_query.cpp
 *     query_record_per_user_state (:1290-1360) — per-(segment, interval)
 *     user-state container; a user active 3 days counts 3 in a daily series
 *   - rolling look-back window: normal_query.cpp :1785-1832 — event on day E
 *     lands the user in daily buckets [E, E + W − 1]
 *   - cumulative: accumulate_uniques_result (:1834-1863) — running
 *     distinct-set size through each interval
 *   - empty resolved user id skipped: normal_query.cpp :2200-2208
 *   - 'range' unit: segmentation_arb.py:933 — same machinery, one interval
 */

import { describe, test, expect } from 'vitest';
import { emulateBreakdown } from '../../lib/verify/emulate-breakdown.js';

const ev = (user_id, time, props = {}) => ({ event: 'ping', time, user_id, ...props });

describe('uniques — per-interval dedup (unit: day)', () => {
	test('user active on 3 days counts once PER DAY (3 rows of 1, not 1 of 3)', () => {
		const events = [
			ev('u1', '2024-01-15T10:00:00.000Z'),
			ev('u1', '2024-01-16T10:00:00.000Z'),
			ev('u1', '2024-01-17T10:00:00.000Z'),
		];
		const rows = emulateBreakdown(events, { type: 'uniques', event: 'ping', unit: 'day' });
		// hand-computed: independent dedup per bucket — u1 appears in each
		expect(rows).toEqual([
			{ period: '2024-01-15', uniques: 1 },
			{ period: '2024-01-16', uniques: 1 },
			{ period: '2024-01-17', uniques: 1 },
		]);
	});

	test('within-day repeats dedup; across-day users add', () => {
		const events = [
			ev('u1', '2024-01-15T10:00:00.000Z'),
			ev('u1', '2024-01-15T11:00:00.000Z'), // same user same day → dedup
			ev('u1', '2024-01-16T10:00:00.000Z'),
			ev('u2', '2024-01-16T12:00:00.000Z'),
		];
		const rows = emulateBreakdown(events, { type: 'uniques', unit: 'day' });
		// hand-computed: d15 = {u1} = 1; d16 = {u1, u2} = 2
		expect(rows).toEqual([
			{ period: '2024-01-15', uniques: 1 },
			{ period: '2024-01-16', uniques: 2 },
		]);
	});

	test('unit "week" splits at ISO Monday: Sun Jan 14 vs Mon Jan 15 2024 are different weeks', () => {
		const events = [
			ev('u1', '2024-01-14T23:00:00.000Z'), // Sunday → 2024-W02 (Jan 1 2024 is a Monday)
			ev('u1', '2024-01-15T01:00:00.000Z'), // Monday → 2024-W03
		];
		const rows = emulateBreakdown(events, { type: 'uniques', unit: 'week' });
		expect(rows).toEqual([
			{ period: '2024-W02', uniques: 1 },
			{ period: '2024-W03', uniques: 1 },
		]);
	});

	test('unit "range" collapses to one interval of total distinct users', () => {
		const events = [
			ev('u1', '2024-01-15T10:00:00.000Z'),
			ev('u1', '2024-01-16T10:00:00.000Z'),
			ev('u1', '2024-01-17T10:00:00.000Z'),
			ev('u2', '2024-01-17T11:00:00.000Z'),
		];
		const rows = emulateBreakdown(events, { type: 'uniques', unit: 'range' });
		// hand-computed: {u1, u2} = 2 regardless of how many days u1 was active
		expect(rows).toEqual([{ period: 'range', uniques: 2 }]);
	});
});

describe('uniques — filters and identity', () => {
	test('where equality is case-INSENSITIVE (value.c:285)', () => {
		const events = [
			ev('u1', '2024-01-15T10:00:00.000Z', { platform: 'iOS' }),
			ev('u2', '2024-01-15T11:00:00.000Z', { platform: 'ios' }),
			ev('u3', '2024-01-15T12:00:00.000Z', { platform: 'android' }),
		];
		const rows = emulateBreakdown(events, { type: 'uniques', unit: 'day', where: { platform: 'ios' } });
		// hand-computed: iOS + ios both match → {u1, u2} = 2
		expect(rows).toEqual([{ period: '2024-01-15', uniques: 2 }]);
	});

	test('events with empty resolved user id are DROPPED (normal_query.cpp:2200-2208)', () => {
		const events = [
			ev('u1', '2024-01-15T10:00:00.000Z'),
			ev('', '2024-01-15T11:00:00.000Z'), // empty user_id, no device_id → skipped
		];
		const rows = emulateBreakdown(events, { type: 'uniques', unit: 'day' });
		expect(rows).toEqual([{ period: '2024-01-15', uniques: 1 }]);
	});

	test('identity resolution: device-only event joins its user (no double count)', () => {
		const events = [
			{ event: 'ping', time: '2024-01-15T10:00:00.000Z', device_id: 'd1' }, // pre-auth
			{ event: 'ping', time: '2024-01-15T11:00:00.000Z', user_id: 'u9' },
		];
		const profiles = [{ distinct_id: 'u9', device_ids: ['d1'] }];
		const rows = emulateBreakdown(events, { type: 'uniques', unit: 'day', profiles });
		// hand-computed: d1 resolves to u9 → one distinct user
		expect(rows).toEqual([{ period: '2024-01-15', uniques: 1 }]);
	});

	test('event-name filter restricts the series', () => {
		const events = [
			ev('u1', '2024-01-15T10:00:00.000Z'),
			{ event: 'other', time: '2024-01-15T11:00:00.000Z', user_id: 'u2' },
		];
		const rows = emulateBreakdown(events, { type: 'uniques', event: 'ping', unit: 'day' });
		expect(rows).toEqual([{ period: '2024-01-15', uniques: 1 }]);
	});
});

describe('uniques — rolling window (XAU)', () => {
	test('W=3: event on day E contributes to buckets [E, E+2] (normal_query.cpp:1785-1832)', () => {
		const events = [
			ev('u1', '2024-01-15T10:00:00.000Z'), // → buckets Jan 15, 16, 17
			ev('u2', '2024-01-17T10:00:00.000Z'), // → bucket Jan 17 (18/19 outside observed range)
		];
		const rows = emulateBreakdown(events, { type: 'uniques', rollingWindow: 3 });
		// hand-computed: 15 = {u1}; 16 = {u1}; 17 = {u1, u2}
		expect(rows).toEqual([
			{ period: '2024-01-15', uniques: 1 },
			{ period: '2024-01-16', uniques: 1 },
			{ period: '2024-01-17', uniques: 2 },
		]);
	});

	test('W=2 with a gap day: intermediate day with no active window users emits 0', () => {
		const events = [
			ev('u1', '2024-01-15T10:00:00.000Z'), // → buckets Jan 15, 16
			ev('u1', '2024-01-18T10:00:00.000Z'), // → bucket Jan 18
		];
		const rows = emulateBreakdown(events, { type: 'uniques', rollingWindow: 2 });
		// hand-computed: 15={u1}, 16={u1} (look-back), 17={} → 0, 18={u1}
		expect(rows).toEqual([
			{ period: '2024-01-15', uniques: 1 },
			{ period: '2024-01-16', uniques: 1 },
			{ period: '2024-01-17', uniques: 0 },
			{ period: '2024-01-18', uniques: 1 },
		]);
	});

	test('W=1 degenerates to the plain daily series', () => {
		const events = [
			ev('u1', '2024-01-15T10:00:00.000Z'),
			ev('u2', '2024-01-16T10:00:00.000Z'),
		];
		const rows = emulateBreakdown(events, { type: 'uniques', rollingWindow: 1 });
		expect(rows).toEqual([
			{ period: '2024-01-15', uniques: 1 },
			{ period: '2024-01-16', uniques: 1 },
		]);
	});

	test('rollingWindow must be a positive integer', () => {
		expect(() => emulateBreakdown([ev('u1', '2024-01-15T10:00:00.000Z')], { type: 'uniques', rollingWindow: 0 }))
			.toThrow(/positive integer/);
		expect(() => emulateBreakdown([ev('u1', '2024-01-15T10:00:00.000Z')], { type: 'uniques', rollingWindow: 1.5 }))
			.toThrow(/positive integer/);
	});
});

describe('uniques — cumulative', () => {
	test('running distinct-set size (accumulate_uniques_result)', () => {
		const events = [
			ev('u1', '2024-01-15T10:00:00.000Z'),
			ev('u1', '2024-01-16T10:00:00.000Z'), // u1 again — set unchanged
			ev('u2', '2024-01-17T10:00:00.000Z'),
		];
		const rows = emulateBreakdown(events, { type: 'uniques', unit: 'day', cumulative: true });
		// hand-computed: daily sets {u1},{u1},{u2}; running union sizes 1, 1, 2
		expect(rows).toEqual([
			{ period: '2024-01-15', uniques: 1 },
			{ period: '2024-01-16', uniques: 1 },
			{ period: '2024-01-17', uniques: 2 },
		]);
	});
});

describe('uniques — guards', () => {
	test('rollingWindow + cumulative are mutually exclusive', () => {
		expect(() => emulateBreakdown([], { type: 'uniques', rollingWindow: 7, cumulative: true }))
			.toThrow(/mutually exclusive/);
	});

	test('countType "sessions" rejects cumulative (ARB has no cumulative sessions count type)', () => {
		expect(() => emulateBreakdown([], { type: 'uniques', countType: 'sessions', cumulative: true }))
			.toThrow(/cumulative sessions/);
	});

	test('does not compose with the generic timeBucket wrapper', () => {
		expect(() => emulateBreakdown([], { type: 'uniques', timeBucket: 'day' }))
			.toThrow(/timeBucket/);
	});

	test('unknown unit throws', () => {
		expect(() => emulateBreakdown([], { type: 'uniques', unit: 'hour' }))
			.toThrow(/unknown unit/);
	});

	test('empty input → empty series', () => {
		expect(emulateBreakdown([], { type: 'uniques', unit: 'day' })).toEqual([]);
		expect(emulateBreakdown([], { type: 'uniques', rollingWindow: 7 })).toEqual([]);
	});
});
