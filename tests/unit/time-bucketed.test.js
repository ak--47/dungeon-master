//@ts-nocheck
/**
 * Unit tests for `partitionByTimeBucket` + cross-cutting `timeBucket` option
 * on `emulateBreakdown`.
 *
 * Period labels: `YYYY-MM-DD` (day), `YYYY-Www` (ISO week), `YYYY-MM` (month).
 */

import { describe, test, expect } from 'vitest';
import { partitionByTimeBucket, emulateBreakdown } from '../../lib/verify/index.js';

const ev = (event, time, props = {}) => ({ event, time, user_id: 'u1', ...props });

describe('partitionByTimeBucket', () => {
	test('day buckets', () => {
		const events = [
			ev('A', Date.UTC(2024, 0, 1, 5, 0, 0)),  // 2024-01-01
			ev('A', Date.UTC(2024, 0, 1, 23, 0, 0)), // 2024-01-01
			ev('A', Date.UTC(2024, 0, 2, 0, 0, 0)),  // 2024-01-02
		];
		const out = partitionByTimeBucket(events, 'day');
		expect(out.map(b => b.period)).toEqual(['2024-01-01', '2024-01-02']);
		expect(out[0].events.length).toBe(2);
		expect(out[1].events.length).toBe(1);
	});

	test('month buckets', () => {
		const events = [
			ev('A', Date.UTC(2024, 0, 31, 12, 0, 0)),  // Jan
			ev('A', Date.UTC(2024, 1, 1, 0, 0, 0)),    // Feb
			ev('A', Date.UTC(2024, 1, 28, 0, 0, 0)),   // Feb
		];
		const out = partitionByTimeBucket(events, 'month');
		expect(out.map(b => b.period)).toEqual(['2024-01', '2024-02']);
		expect(out[1].events.length).toBe(2);
	});

	test('ISO week buckets (Monday-anchored)', () => {
		// 2024-01-01 was a Monday → week 01 of 2024.
		// 2024-01-08 → week 02.
		const events = [
			ev('A', Date.UTC(2024, 0, 1, 12)),  // 2024-W01
			ev('A', Date.UTC(2024, 0, 7, 12)),  // 2024-W01 (Sunday of W01)
			ev('A', Date.UTC(2024, 0, 8, 12)),  // 2024-W02
		];
		const out = partitionByTimeBucket(events, 'week');
		expect(out.map(b => b.period)).toEqual(['2024-W01', '2024-W02']);
		expect(out[0].events.length).toBe(2);
	});

	test('events without valid time are dropped', () => {
		const events = [
			ev('A', Date.UTC(2024, 0, 1)),
			ev('B', null),
			ev('C', 'not a date'),
		];
		const out = partitionByTimeBucket(events, 'day');
		expect(out.length).toBe(1);
		expect(out[0].events.length).toBe(1);
	});

	test('throws on unsupported bucket', () => {
		expect(() => partitionByTimeBucket([ev('A', 0)], 'year')).toThrow(/year/);
	});

	test('empty input → empty output', () => {
		expect(partitionByTimeBucket([], 'day')).toEqual([]);
	});
});

describe('emulateBreakdown — timeBucket cross-cutting', () => {
	test('frequencyByFrequency split into weekly trend', () => {
		const events = [
			ev('A', Date.UTC(2024, 0, 1, 12), { user_id: 'u1' }),
			ev('B', Date.UTC(2024, 0, 1, 12), { user_id: 'u1' }),
			ev('A', Date.UTC(2024, 0, 8, 12), { user_id: 'u2' }),
			ev('B', Date.UTC(2024, 0, 8, 12), { user_id: 'u2' }),
		];
		const rows = emulateBreakdown(events, {
			type: 'frequencyByFrequency',
			metricEvent: 'A',
			breakdownByFrequencyOf: 'B',
			timeBucket: 'week',
		});
		const periods = new Set(rows.map(r => r.period));
		expect(periods).toEqual(new Set(['2024-W01', '2024-W02']));
		expect(rows.every(r => r.user_count >= 1)).toBe(true);
	});

	test('retention split into monthly cohorts', () => {
		const day = (n) => Date.UTC(2024, 0, 1 + n);
		const events = [
			// Jan cohort
			ev('Sign Up', day(0),  { user_id: 'u1' }),
			ev('Login',   day(1),  { user_id: 'u1' }),
			// Feb cohort (same property test pattern)
			ev('Sign Up', day(31), { user_id: 'u2' }),
			ev('Login',   day(32), { user_id: 'u2' }),
		];
		const rows = emulateBreakdown(events, {
			type: 'retention',
			cohortEvent: 'Sign Up',
			returnEvent: 'Login',
			dayBuckets: [1],
			timeBucket: 'month',
		});
		const periods = new Set(rows.map(r => r.period));
		expect(periods).toEqual(new Set(['2024-01', '2024-02']));
	});

	test('single-day data with timeBucket=day → one period', () => {
		const events = [
			ev('A', Date.UTC(2024, 5, 1, 0)),
			ev('B', Date.UTC(2024, 5, 1, 23)),
		];
		const rows = emulateBreakdown(events, {
			type: 'frequencyByFrequency',
			metricEvent: 'A',
			breakdownByFrequencyOf: 'B',
			timeBucket: 'day',
		});
		const periods = new Set(rows.map(r => r.period));
		expect(periods).toEqual(new Set(['2024-06-01']));
	});

	test('without timeBucket: behavior unchanged (no period field)', () => {
		const events = [
			ev('A', Date.UTC(2024, 0, 1, 12), { user_id: 'u1' }),
			ev('B', Date.UTC(2024, 0, 1, 12), { user_id: 'u1' }),
		];
		const rows = emulateBreakdown(events, {
			type: 'frequencyByFrequency',
			metricEvent: 'A',
			breakdownByFrequencyOf: 'B',
		});
		expect(rows.every(r => !('period' in r))).toBe(true);
	});

	test('timeBucketRange backfills empty days with { period, _empty: true }', () => {
		// Events on Jan 1 and Jan 5; range Jan 1..Jan 7 → 7 day periods, 5 empty.
		const events = [
			ev('A', Date.UTC(2024, 0, 1, 12), { user_id: 'u1' }),
			ev('B', Date.UTC(2024, 0, 1, 12), { user_id: 'u1' }),
			ev('A', Date.UTC(2024, 0, 5, 12), { user_id: 'u2' }),
			ev('B', Date.UTC(2024, 0, 5, 12), { user_id: 'u2' }),
		];
		const rows = emulateBreakdown(events, {
			type: 'frequencyByFrequency',
			metricEvent: 'A',
			breakdownByFrequencyOf: 'B',
			timeBucket: 'day',
			timeBucketRange: { from: Date.UTC(2024, 0, 1), to: Date.UTC(2024, 0, 7) },
		});
		const periods = rows.map(r => r.period);
		expect(periods).toEqual([
			'2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04',
			'2024-01-05', '2024-01-06', '2024-01-07',
		]);
		expect(rows.find(r => r.period === '2024-01-02')._empty).toBe(true);
		expect(rows.find(r => r.period === '2024-01-01')._empty).toBeUndefined();
	});
});
