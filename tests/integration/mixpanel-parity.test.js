//@ts-nocheck
/**
 * Mixpanel-parity tests: replay fixtures from `mixpanel/analytics` to verify
 * the verifier's counting/funnel primitives match Mixpanel's actual semantics.
 *
 * v1.5 generation parity tests live in the per-feature test files
 * (`active-days.test.js`, `conversion-window.test.js`, etc.). This file holds
 * the dedicated fixture-replay layer.
 *
 * Note: the verifier-side parity for `addiction_query.cpp` distinct-period
 * counting is already covered by `tests/counting.test.js` ("matches Mixpanel
 * test_qt_addiction.py user1 hourly count = 2"). We re-assert that pattern
 * here and add fixture parity for `evaluateFunnel` (greedy single-pass).
 */

import { describe, test, expect } from 'vitest';
import { countDistinctPeriods, nullAwareAvg, nullAwareSum } from '../../lib/verify/counting.js';
import { evaluateFunnel, withinConversionWindow, timestampComesAfter } from '../../lib/verify/funnel-engine.js';

const ev = (event, time, uid = 'u1', extra = {}) => ({ event, time, user_id: uid, ...extra });
const iso = (s) => new Date(s).toISOString();

describe('Mixpanel parity — addiction_query.cpp distinct-period counting', () => {
	test('user1 hourly count = 2 (test_qt_addiction.py fixture)', () => {
		// Per `mixpanel/analytics/backend/arb/test/test_qt_addiction.py`:
		// user1 fires 4 "addicted" events at:
		//   00:00:00, 00:00:00, 00:00:01, 01:00:00
		// Hourly distinct period count = 2 (hour 0 + hour 1).
		const events = [
			ev('addicted', iso('2012-07-27T00:00:00Z')),
			ev('addicted', iso('2012-07-27T00:00:00Z')),
			ev('addicted', iso('2012-07-27T00:00:01Z')),
			ev('addicted', iso('2012-07-27T01:00:00Z')),
		];
		expect(countDistinctPeriods(events, 'addicted', 'hour')).toBe(2);
	});

	test('rolling-window algorithm: 23:59 + 00:01 next day = 1 period (gap < 86400s)', () => {
		// Mixpanel's C++ rule: qtz_time >= last_counted + seconds_for_unit(unit).
		// With gap=120s < 86400s, the second event does NOT advance the count.
		const events = [
			ev('Buy', iso('2024-02-01T23:59:00Z')),
			ev('Buy', iso('2024-02-02T00:01:00Z')),
		];
		expect(countDistinctPeriods(events, 'Buy', 'day', { algorithm: 'rolling' })).toBe(1);
		// Calendar (default): 2 distinct UTC dates.
		expect(countDistinctPeriods(events, 'Buy', 'day')).toBe(2);
	});
});

describe('Mixpanel parity — normal_query.cpp null-aware aggregation', () => {
	test('AVG skips null/undefined/NaN/non-numeric from numerator AND denominator', () => {
		// If naive SQL averaged [10, null, 20, undefined, 30, NaN, 'foo'], it would
		// compute 60/7 ≈ 8.57 (with nulls coalesced to 0) or throw.
		// Mixpanel's null-aware AVG: 60 / 3 = 20.
		const values = [10, null, 20, undefined, 30, NaN, 'foo'];
		expect(nullAwareAvg(values)).toBe(20);
	});

	test('SUM ignores non-numeric — does not propagate NaN', () => {
		expect(nullAwareSum([10, null, 20, undefined, 'x', NaN, 5])).toBe(35);
	});

	test('AVG of empty / all-null returns null (not NaN, not 0)', () => {
		expect(nullAwareAvg([])).toBe(null);
		expect(nullAwareAvg([null, undefined, NaN])).toBe(null);
	});
});

describe('Mixpanel parity — history.cpp greedy funnel engine', () => {
	test('out-of-order [C, A, B] beyond 2s grace: only step 1 reached', () => {
		// Per history.cpp doc: out-of-order events get assigned to first matching step.
		// The recorded C is at t=1000, but step 1 (B) lands at 20000 — beyond 2s
		// grace from C — so the cascade can't pull C forward.
		const events = [ev('C', 1000), ev('A', 10000), ev('B', 20000)];
		const r = evaluateFunnel(events, ['A', 'B', 'C']);
		expect(r.completed).toBe(false);
		expect(r.reached).toBe(1);
	});

	test('within 2-second grace: B 1.5s before A still completes', () => {
		// timestamp_comes_after with OUT_OF_ORDER_MS = 2000.
		const events = [ev('A', 10000), ev('B', 8500)];
		const r = evaluateFunnel(events, ['A', 'B']);
		expect(r.completed).toBe(true);
	});

	test('strict-< conversion window: at boundary returns false', () => {
		// is_within_conversion_window: t1 < t2 + length_seconds * 1000.
		// At exactly the boundary: not within.
		expect(withinConversionWindow(60000, 10000, 50000)).toBe(false); // 60000 < 60000 = false
		expect(withinConversionWindow(59999, 10000, 50000)).toBe(true);
	});

	test('timestamp_comes_after: t1 must be > 0 (sentinel guard)', () => {
		// history.cpp uses 0 as "never recorded" sentinel.
		expect(timestampComesAfter(0, 1000)).toBe(false);
		expect(timestampComesAfter(-1, 1000)).toBe(false);
	});
});
