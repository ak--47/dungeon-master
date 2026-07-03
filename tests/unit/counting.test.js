//@ts-nocheck
/**
 * Unit tests for counting helpers matching Mixpanel's analytics semantics.
 *
 * Reference test cases:
 *   - addiction_query distinct-period semantics (test_qt_addiction.py)
 *   - normal_query null-aware aggregation
 */

import { describe, test, expect } from 'vitest';
import {
	countDistinctPeriods,
	nullAwareAvg,
	nullAwareSum,
	nullAwareExtreme,
	binByDistinctPeriods,
} from '../../lib/verify/counting.js';

const ev = (event, time) => ({ event, time, user_id: 'u1' });
const iso = (s) => new Date(s).toISOString();

describe('countDistinctPeriods', () => {
	test('5 events across 3 days returns 3', () => {
		const events = [
			ev('Buy', iso('2024-02-01T00:00:00Z')),
			ev('Buy', iso('2024-02-01T12:00:00Z')),
			ev('Buy', iso('2024-02-02T00:00:00Z')),
			ev('Buy', iso('2024-02-02T23:00:00Z')),
			ev('Buy', iso('2024-02-03T00:00:00Z')),
		];
		expect(countDistinctPeriods(events, 'Buy', 'day')).toBe(3);
	});

	test('10 events all same day returns 1', () => {
		const events = Array.from({ length: 10 }, (_, i) =>
			ev('Buy', iso(`2024-02-01T${String(i).padStart(2, '0')}:00:00Z`)));
		expect(countDistinctPeriods(events, 'Buy', 'day')).toBe(1);
	});

	test('events at 23:59 and next-day 00:01 UTC count as 2 calendar days (default)', () => {
		const events = [
			ev('Buy', iso('2024-02-01T23:59:00Z')),
			ev('Buy', iso('2024-02-02T00:01:00Z')),
		];
		// Default algorithm is 'calendar' — UTC date_trunc, matches Mixpanel UI.
		expect(countDistinctPeriods(events, 'Buy', 'day')).toBe(2);
	});

	test('rolling-window algorithm: 23:59 + 00:01 next day count as 1 (gap < 86400s)', () => {
		const events = [
			ev('Buy', iso('2024-02-01T23:59:00Z')),
			ev('Buy', iso('2024-02-02T00:01:00Z')),
		];
		// addiction_query.cpp rule: qtz_time >= last_counted + seconds_for_unit.
		expect(countDistinctPeriods(events, 'Buy', 'day', { algorithm: 'rolling' })).toBe(1);
	});

	test('hourly: events at 14:05 and 14:55 within same hour returns 1', () => {
		const events = [
			ev('Buy', iso('2024-02-01T14:05:00Z')),
			ev('Buy', iso('2024-02-01T14:55:00Z')),
		];
		expect(countDistinctPeriods(events, 'Buy', 'hour')).toBe(1);
	});

	test('hourly: events at 14:55 and 15:55 (gap 1h) returns 2', () => {
		const events = [
			ev('Buy', iso('2024-02-01T14:55:00Z')),
			ev('Buy', iso('2024-02-01T15:55:00Z')),
		];
		// Gap is exactly 3600s. `qtz_time >= last_counted + 3600` → true.
		expect(countDistinctPeriods(events, 'Buy', 'hour')).toBe(2);
	});

	test('matches Mixpanel test_qt_addiction.py user1 hourly count = 2', () => {
		// EVENT_DATA from test_qt_addiction.py. user1's events:
		//   00:00:00, 00:00:00, 00:00:01, 01:00:00 — should count 2 (hourly).
		const events = [
			ev('addicted', iso('2012-07-27T00:00:00Z')),
			ev('addicted', iso('2012-07-27T00:00:00Z')),
			ev('addicted', iso('2012-07-27T00:00:01Z')),
			ev('addicted', iso('2012-07-27T01:00:00Z')),
		];
		expect(countDistinctPeriods(events, 'addicted', 'hour')).toBe(2);
	});

	test('events of other names ignored', () => {
		const events = [
			ev('Buy', iso('2024-02-01T00:00:00Z')),
			ev('Click', iso('2024-02-02T00:00:00Z')),
		];
		expect(countDistinctPeriods(events, 'Buy', 'day')).toBe(1);
	});

	test('empty / no matches returns 0', () => {
		expect(countDistinctPeriods([], 'Buy', 'day')).toBe(0);
		expect(countDistinctPeriods([ev('Click', iso('2024-02-01T00:00:00Z'))], 'Buy', 'day')).toBe(0);
	});
});

describe('nullAwareAvg', () => {
	test('skips non-numeric values from numerator and denominator', () => {
		expect(nullAwareAvg([10, null, 20, 'abc', 30])).toBe(20); // (10+20+30)/3
	});

	test('returns null when all values are non-numeric', () => {
		expect(nullAwareAvg([null, undefined, NaN])).toBe(null);
	});

	test('returns null for empty array', () => {
		expect(nullAwareAvg([])).toBe(null);
	});

	test('handles single numeric value', () => {
		expect(nullAwareAvg([42])).toBe(42);
	});

	// v1.6.0 (P1.10): normal_query.cpp:1601-1617 ACTION_TYPE_AVERAGE
	// VALUE_TYPE_LIST — each numeric list item joins numerator AND
	// denominator independently. Hand-computed.
	test('flatten: list items count independently in numerator and denominator', () => {
		// 10 + (2+4) + 30 = 46 over 4 contributions (1 + 2 + 1)
		expect(nullAwareAvg([10, [2, 4], 30], { flatten: true })).toBe(11.5);
	});

	test('flatten: non-numeric items inside lists are skipped; one level only', () => {
		// 6 + (1+2) = 9 over 3 — 'x', null, and the NESTED [50] are skipped
		// (list_cursor items must be VALUE_TYPE_NUMBER; a nested list is not)
		expect(nullAwareAvg([6, ['x', 1, null, [50], 2]], { flatten: true })).toBe(3);
	});

	test('flatten: all-non-numeric list contributes nothing (null result stays null)', () => {
		expect(nullAwareAvg([['a', null]], { flatten: true })).toBe(null);
	});

	test('default (no flatten) skips arrays whole — v1.5 behavior unchanged', () => {
		expect(nullAwareAvg([10, [2, 4], 30])).toBe(20); // (10+30)/2
	});
});

describe('nullAwareSum', () => {
	test('skips non-numeric, sums numeric only', () => {
		expect(nullAwareSum([10, null, 20])).toBe(30);
		expect(nullAwareSum([1, 'x', 2, NaN, 3])).toBe(6);
	});

	test('empty returns 0', () => {
		expect(nullAwareSum([])).toBe(0);
	});

	// v1.6.0 (P1.10): normal_query.cpp:1585-1600 ACTION_TYPE_SUM
	// VALUE_TYPE_LIST branch. Hand-computed.
	test('flatten: numeric list items sum independently; one level; non-numeric skipped', () => {
		expect(nullAwareSum([10, [2, 4], 30], { flatten: true })).toBe(46);
		expect(nullAwareSum([['x', 1, [50], 2]], { flatten: true })).toBe(3);
	});

	test('default (no flatten) skips arrays whole — v1.5 behavior unchanged', () => {
		expect(nullAwareSum([10, [2, 4], 30])).toBe(40);
	});
});

describe('nullAwareExtreme', () => {
	test('min skips non-numeric values', () => {
		expect(nullAwareExtreme([5, null, 15, 'x', 10], 'min')).toBe(5);
	});

	test('max skips non-numeric values', () => {
		expect(nullAwareExtreme([5, null, 15, 'x', 10], 'max')).toBe(15);
	});

	test('returns null when no numeric values', () => {
		expect(nullAwareExtreme([null, 'a'], 'min')).toBe(null);
		expect(nullAwareExtreme([], 'max')).toBe(null);
	});
});

describe('binByDistinctPeriods', () => {
	test('user with events on 3 distinct days, bins {low:[0,3], high:[3,Infinity]} returns "high"', () => {
		const events = [
			ev('Buy', iso('2024-02-01T00:00:00Z')),
			ev('Buy', iso('2024-02-02T00:00:00Z')),
			ev('Buy', iso('2024-02-03T00:00:00Z')),
		];
		expect(binByDistinctPeriods(events, 'Buy', { low: [0, 3], high: [3, Infinity] })).toBe('high');
	});

	test('user with events on 2 distinct days returns "low"', () => {
		const events = [
			ev('Buy', iso('2024-02-01T00:00:00Z')),
			ev('Buy', iso('2024-02-02T00:00:00Z')),
		];
		expect(binByDistinctPeriods(events, 'Buy', { low: [0, 3], high: [3, Infinity] })).toBe('low');
	});

	test('returns null when no bin matches', () => {
		expect(binByDistinctPeriods([], 'Buy', { high: [10, 20] })).toBe(null);
	});
});
