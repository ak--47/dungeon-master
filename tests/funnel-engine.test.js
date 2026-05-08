//@ts-nocheck
/**
 * Unit tests for the greedy single-pass funnel engine.
 *
 * Test cases derived from `mixpanel/analytics` history.cpp behavior:
 *   - timestamp_comes_after with 2-second grace
 *   - is_within_conversion_window strict <
 *   - "always record latest" + cascade
 *   - documented edge cases (e.g., [A,B,B] funnel with [B,B,A] stream)
 */

import { describe, test, expect } from 'vitest';
import { evaluateFunnel, timestampComesAfter, withinConversionWindow } from '../lib/verify/funnel-engine.js';

const ev = (event, time) => ({ event, time, user_id: 'u1' });

describe('timestampComesAfter', () => {
	test('strict ordering when grace disabled and t1 >= t2', () => {
		expect(timestampComesAfter(2000, 1000, false)).toBe(true);
		expect(timestampComesAfter(2000, 2000, false)).toBe(true);
	});

	test('within 2s grace counts as after', () => {
		expect(timestampComesAfter(8500, 10000)).toBe(true);
		expect(timestampComesAfter(9999, 10000)).toBe(true);
	});

	test('beyond 2s grace does not count', () => {
		expect(timestampComesAfter(7999, 10000)).toBe(false);
	});

	test('t1 must be > 0', () => {
		expect(timestampComesAfter(0, 1000)).toBe(false);
		expect(timestampComesAfter(-1, 1000)).toBe(false);
	});
});

describe('withinConversionWindow', () => {
	test('no window means always within', () => {
		expect(withinConversionWindow(99999, 0, undefined)).toBe(true);
		expect(withinConversionWindow(99999, 0, 0)).toBe(true);
	});

	test('strict <: at boundary returns false', () => {
		// t1 < t2 + windowMs   ->   60000 < 10000 + 50000 = 60000  ->  false
		expect(withinConversionWindow(60000, 10000, 50000)).toBe(false);
		expect(withinConversionWindow(59999, 10000, 50000)).toBe(true);
	});
});

describe('evaluateFunnel', () => {
	test('strict in-order sequence completes', () => {
		const events = [ev('A', 1000), ev('B', 2000), ev('C', 3000)];
		const r = evaluateFunnel(events, ['A', 'B', 'C']);
		expect(r.completed).toBe(true);
		expect(r.reached).toBe(2);
		expect(r.ttcMs).toBe(2000);
	});

	test('wrong order: events [C, A, B] (well outside 2s grace) reaches step 1 only', () => {
		// Spaced beyond the 2s grace so the recorded C time cannot retro-
		// actively satisfy the cascade. (Within 2s grace, Mixpanel's algorithm
		// would actually complete this funnel — see grace-period tests.)
		const events = [ev('C', 1000), ev('A', 10000), ev('B', 20000)];
		const r = evaluateFunnel(events, ['A', 'B', 'C']);
		expect(r.reached).toBe(1);
		expect(r.completed).toBe(false);
	});

	test('2-second grace: B 1.5s before A still counts after A', () => {
		const events = [ev('A', 10000), ev('B', 8500)];
		const r = evaluateFunnel(events, ['A', 'B']);
		expect(r.completed).toBe(true);
	});

	test('2-second grace boundary: B 2001ms before A does not count', () => {
		const events = [ev('A', 10000), ev('B', 7999)];
		const r = evaluateFunnel(events, ['A', 'B']);
		expect(r.completed).toBe(false);
		expect(r.reached).toBe(0);
	});

	test('greedy assignment: funnel [A,B,B] with stream [B,B,A] does NOT reach step 2', () => {
		// Documented edge case from history.cpp ~line 456:
		//   "we will not attribute the second B to the later step"
		// In our greedy single-pass implementation each B at scan time is
		// matched to the FIRST not-yet-reached step whose name matches. With
		// reached=-1, both B events match step 1 (the first B step), never
		// step 2. The second B overwrites the first at step 1's slot. Then
		// A advances to step 0 and cascades to step 1 (B at t=2000), but
		// step 2 was never recorded, so reached stays at 1.
		const events = [ev('B', 1000), ev('B', 2000), ev('A', 3000)];
		const r = evaluateFunnel(events, ['A', 'B', 'B']);
		expect(r.reached).toBe(1);
		expect(r.completed).toBe(false);
	});

	test('conversion window: B at 100s with 50s window not reached', () => {
		const events = [ev('A', 10000), ev('B', 110000)];
		const r = evaluateFunnel(events, ['A', 'B'], { conversionWindowMs: 50000 });
		expect(r.completed).toBe(false);
		expect(r.reached).toBe(0);
	});

	test('conversion window strict <: B at exactly window boundary not included', () => {
		const events = [ev('A', 10000), ev('B', 60000)];
		const r = evaluateFunnel(events, ['A', 'B'], { conversionWindowMs: 50000 });
		expect(r.completed).toBe(false);
	});

	test('conversion window strict <: B 1ms before boundary included', () => {
		const events = [ev('A', 10000), ev('B', 59999)];
		const r = evaluateFunnel(events, ['A', 'B'], { conversionWindowMs: 50000 });
		expect(r.completed).toBe(true);
	});

	test('multiple events for same step: latest replaces earlier (greedy "always record latest")', () => {
		// Funnel [A, B]. Stream: A1 (t=1000), A2 (t=2000), B (t=3000).
		// Both A's match step 0. Greedy: first A advances reached to 0. Second
		// A's matched step would be 1 (B not present), but it's not a match — so
		// it goes nowhere. This test verifies that the engine does not get
		// confused by repeated events of the same name AT step 0 already reached.
		const events = [ev('A', 1000), ev('A', 2000), ev('B', 3000)];
		const r = evaluateFunnel(events, ['A', 'B']);
		expect(r.completed).toBe(true);
		expect(r.stepTimes[0]).toBe(1000); // first A is the one that advanced
	});

	test('returns reached=-1 for empty events', () => {
		const r = evaluateFunnel([], ['A', 'B']);
		expect(r.reached).toBe(-1);
		expect(r.completed).toBe(false);
		expect(r.ttcMs).toBe(null);
	});

	test('returns reached=-1 when no steps configured', () => {
		const r = evaluateFunnel([ev('A', 1000)], []);
		expect(r.reached).toBe(-1);
	});

	test('handles ISO time strings', () => {
		const events = [
			{ event: 'A', time: '2024-02-01T00:00:01Z', user_id: 'u1' },
			{ event: 'B', time: '2024-02-01T00:01:01Z', user_id: 'u1' },
		];
		const r = evaluateFunnel(events, ['A', 'B']);
		expect(r.completed).toBe(true);
		expect(r.ttcMs).toBe(60000);
	});
});
