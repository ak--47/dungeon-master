//@ts-nocheck
/**
 * P1.6.3 unit tests: countMode / holdPropertyConstant / conversionWindow
 * threaded through funnelFrequency (findings #15).
 *
 * Every expected value is hand-computed from the primitive rules — NOT
 * derived from running the implementation:
 *   - uniques: one credited progression per user (greedy single-pass)
 *   - totals: every attempt counts; multi-attempt scanning requires
 *     reentry (Mixpanel "Totals" restarts after each conversion); an
 *     incomplete attempt that reached >= 0 still contributes drop-off
 *     counts (funnel_query.cpp aggregates history_get_reached >= 0)
 *   - HPC: per-property-value sub-funnels; step-0 events seed the value
 *     universe (aggregate_hash_get_key_cursor, funnel_query.cpp); in
 *     uniques mode a user appears at step s when ANY value thread
 *     reached >= s — union of contiguous prefixes = 0..max(reached)
 *   - countMode 'sessions': API rewrite to totals + 1-session window,
 *     no re-entry (__validate_sessions, arb_funnels/validate.py)
 *   - session window: ordinal check `o < o0 + n` + n×1-day wall clock
 */

import { describe, test, expect } from 'vitest';
import { emulateBreakdown } from '../../lib/verify/emulate-breakdown.js';

const ev = (uid, event, time, props = {}) => ({ event, time, user_id: uid, ...props });
const row = (rows, step_index, breakdown_freq) =>
	rows.find(r => r.step_index === step_index && r.breakdown_freq === breakdown_freq);

const BASE = { type: 'funnelFrequency', steps: ['A', 'B'], breakdownByFrequencyOf: 'C' };

describe('funnelFrequency countMode', () => {
	// u1 completes A→B twice in one day, one C event → breakdown_freq 1.
	const twoPasses = [
		ev('u1', 'A', '2024-01-15T10:00:00.000Z'),
		ev('u1', 'B', '2024-01-15T10:01:00.000Z'),
		ev('u1', 'A', '2024-01-15T10:02:00.000Z'),
		ev('u1', 'B', '2024-01-15T10:03:00.000Z'),
		ev('u1', 'C', '2024-01-15T10:04:00.000Z'),
	];

	test('default uniques: user counted once regardless of repeat passes', () => {
		const rows = emulateBreakdown(twoPasses, { ...BASE });
		// hand-computed: one user, one credited progression → 1 at both steps
		expect(row(rows, 0, 1).conversions).toBe(1);
		expect(row(rows, 1, 1).conversions).toBe(1);
		expect(row(rows, 1, 1).conversion_pct).toBe(100);
	});

	test('totals + reentry: every attempt counts', () => {
		const rows = emulateBreakdown(twoPasses, { ...BASE, countMode: 'totals', reentry: true });
		// hand-computed: two completed attempts → 2 at both steps
		expect(row(rows, 0, 1).conversions).toBe(2);
		expect(row(rows, 1, 1).conversions).toBe(2);
		expect(row(rows, 1, 1).conversion_pct).toBe(100);
	});

	test('totals without reentry: single attempt (no restart)', () => {
		const rows = emulateBreakdown(twoPasses, { ...BASE, countMode: 'totals' });
		// hand-computed: one greedy pass completes on the FIRST A→B; no restart
		expect(row(rows, 0, 1).conversions).toBe(1);
		expect(row(rows, 1, 1).conversions).toBe(1);
	});

	test('totals + reentry: trailing incomplete attempt contributes drop-off', () => {
		const events = [
			ev('u1', 'A', '2024-01-15T10:00:00.000Z'),
			ev('u1', 'B', '2024-01-15T10:01:00.000Z'),
			ev('u1', 'A', '2024-01-15T10:02:00.000Z'), // second attempt: step 0 only
			ev('u1', 'C', '2024-01-15T10:05:00.000Z'),
		];
		const rows = emulateBreakdown(events, { ...BASE, countMode: 'totals', reentry: true });
		// hand-computed: attempts = [completed, reached 0] → step0 = 2, step1 = 1
		expect(row(rows, 0, 1).conversions).toBe(2);
		expect(row(rows, 1, 1).conversions).toBe(1);
		expect(row(rows, 1, 1).conversion_pct).toBe(50);
	});
});

describe('funnelFrequency holdPropertyConstant', () => {
	test('HPC blocks cross-value conversion the plain funnel allows', () => {
		const events = [
			ev('u1', 'A', '2024-01-15T10:00:00.000Z', { plan: 'x' }),
			ev('u1', 'B', '2024-01-15T10:01:00.000Z', { plan: 'y' }),
			ev('u1', 'C', '2024-01-15T10:02:00.000Z'),
		];
		// plain: A→B converts (property ignored)
		const plain = emulateBreakdown(events, { ...BASE });
		expect(row(plain, 1, 1).conversions).toBe(1);
		// HPC on plan: bucket x = [A(x)] reached 0; B(y) never seeds a bucket
		// (no step-0 event with plan y) → no step-1 row at all
		const hpc = emulateBreakdown(events, { ...BASE, holdPropertyConstant: 'plan' });
		expect(row(hpc, 0, 1).conversions).toBe(1);
		expect(row(hpc, 1, 1)).toBeUndefined();
	});

	test('HPC uniques: user credited ONCE at the furthest value thread', () => {
		const events = [
			ev('u1', 'A', '2024-01-15T10:00:00.000Z', { plan: 'x' }), // thread x: reached 0
			ev('u1', 'A', '2024-01-15T10:01:00.000Z', { plan: 'y' }),
			ev('u1', 'B', '2024-01-15T10:02:00.000Z', { plan: 'y' }), // thread y: reached 1
			ev('u1', 'C', '2024-01-15T10:03:00.000Z'),
		];
		const rows = emulateBreakdown(events, { ...BASE, holdPropertyConstant: 'plan' });
		// hand-computed: max(0, 1) = 1 → steps 0..1 credited once each.
		// Distinct-user union semantics: step 0 must be 1, NOT 2 (two threads).
		expect(row(rows, 0, 1).conversions).toBe(1);
		expect(row(rows, 1, 1).conversions).toBe(1);
	});

	test('HPC + totals: every attempt in every value bucket counts', () => {
		const events = [
			ev('u1', 'A', '2024-01-15T10:00:00.000Z', { plan: 'x' }),
			ev('u1', 'B', '2024-01-15T10:01:00.000Z', { plan: 'x' }),
			ev('u1', 'A', '2024-01-15T10:02:00.000Z', { plan: 'x' }), // x attempt 2: step 0 only
			ev('u1', 'A', '2024-01-15T10:04:00.000Z', { plan: 'y' }),
			ev('u1', 'B', '2024-01-15T10:05:00.000Z', { plan: 'y' }),
			ev('u1', 'C', '2024-01-15T10:06:00.000Z'),
		];
		const rows = emulateBreakdown(events, { ...BASE, countMode: 'totals', reentry: true, holdPropertyConstant: 'plan' });
		// hand-computed: bucket x attempts [reached 1, reached 0], bucket y [reached 1]
		// → step0 = 3, step1 = 2, pct = 200/3
		expect(row(rows, 0, 1).conversions).toBe(3);
		expect(row(rows, 1, 1).conversions).toBe(2);
		expect(row(rows, 1, 1).conversion_pct).toBeCloseTo(200 / 3, 6);
	});
});

describe('funnelFrequency session-count conversion windows', () => {
	test('conversionWindow { sessions, n } threads through the plain path', () => {
		const events = [
			ev('u1', 'A', '2024-01-15T10:00:00.000Z'), // session 0
			ev('u1', 'B', '2024-01-15T11:00:00.000Z'), // 60-min gap → session 1
			ev('u1', 'C', '2024-01-15T11:01:00.000Z'),
		];
		// hand-computed: ordinal(B) = 1; n=1 → 1 < 0+1 fails → step 0 only
		const n1 = emulateBreakdown(events, { ...BASE, conversionWindow: { unit: 'sessions', n: 1 } });
		expect(row(n1, 0, 1).conversions).toBe(1);
		expect(row(n1, 1, 1)).toBeUndefined();
		// n=2 → 1 < 0+2 passes; 1h < 2d wall clock passes
		const n2 = emulateBreakdown(events, { ...BASE, conversionWindow: { unit: 'sessions', n: 2 } });
		expect(row(n2, 1, 1).conversions).toBe(1);
	});

	test("countMode 'sessions' preset: converts in-session, not across sessions", () => {
		const events = [
			ev('u1', 'A', '2024-01-15T10:00:00.000Z'),
			ev('u1', 'B', '2024-01-15T10:10:00.000Z'), // same session → converts
			ev('u1', 'C', '2024-01-15T10:20:00.000Z'),
			ev('u2', 'A', '2024-01-15T10:00:00.000Z'),
			ev('u2', 'B', '2024-01-15T11:00:00.000Z'), // next session → drop-off
			ev('u2', 'C', '2024-01-15T11:05:00.000Z'),
		];
		const rows = emulateBreakdown(events, { ...BASE, countMode: 'sessions' });
		// hand-computed: u1 reached 1, u2 reached 0 → step0 = 2, step1 = 1
		expect(row(rows, 0, 1).conversions).toBe(2);
		expect(row(rows, 1, 1).conversions).toBe(1);
		expect(row(rows, 1, 1).conversion_pct).toBe(50);
	});
});

describe('funnelFrequency excluded counts (P1.6.4)', () => {
	// ARB surfaces exclusion tallies per step slot: `fr->excluded[reached + 1]`
	// (funnel_query.cpp:3422) / `fr->excluded_uniques[reached + 1]` (:3337).
	// Rows carry an `excluded` column at step_index = the boundary the
	// terminated history failed to cross.

	test('uniques: excluded user counted at the boundary it failed to cross', () => {
		const events = [
			// u1: A then exclusion X → reached 0, excluded at boundary 1
			ev('u1', 'A', '2024-01-15T10:00:00.000Z'),
			ev('u1', 'X', '2024-01-15T10:05:00.000Z'),
			ev('u1', 'B', '2024-01-15T10:10:00.000Z'),
			ev('u1', 'C', '2024-01-15T10:11:00.000Z'),
			// u2: clean conversion (C event puts u2 in the same breakdown_freq=1 cohort)
			ev('u2', 'A', '2024-01-15T10:00:00.000Z'),
			ev('u2', 'B', '2024-01-15T10:01:00.000Z'),
			ev('u2', 'C', '2024-01-15T10:02:00.000Z'),
		];
		// breakdown axis: u1 and u2 each have C on exactly 1 distinct day → freq 1
		const rows = emulateBreakdown(events, { ...BASE, exclusionSteps: [{ event: 'X' }] });
		// hand-computed: step0 = both users; step1 = u2 only; u1 excluded at 1
		expect(row(rows, 0, 1).conversions).toBe(2);
		expect(row(rows, 0, 1).excluded).toBe(0);
		expect(row(rows, 1, 1).conversions).toBe(1);
		expect(row(rows, 1, 1).excluded).toBe(1);
	});

	test('excluded-only boundary still gets a row (conversions 0)', () => {
		const events = [
			ev('u1', 'A', '2024-01-15T10:00:00.000Z'),
			ev('u1', 'X', '2024-01-15T10:05:00.000Z'),
			ev('u1', 'C', '2024-01-15T10:06:00.000Z'),
		];
		const rows = emulateBreakdown(events, { ...BASE, exclusionSteps: [{ event: 'X' }] });
		// hand-computed: nobody reaches step 1, but the exclusion tally lives there
		expect(row(rows, 0, 1).conversions).toBe(1);
		expect(row(rows, 1, 1).conversions).toBe(0);
		expect(row(rows, 1, 1).excluded).toBe(1);
	});

	test('totals + reentry: each excluded attempt tallies separately', () => {
		const events = [
			ev('u1', 'A', '2024-01-15T10:00:00.000Z'),
			ev('u1', 'X', '2024-01-15T10:05:00.000Z'), // attempt 1 excluded
			ev('u1', 'A', '2024-01-15T10:10:00.000Z'),
			ev('u1', 'X', '2024-01-15T10:15:00.000Z'), // attempt 2 excluded
			ev('u1', 'A', '2024-01-15T10:20:00.000Z'),
			ev('u1', 'B', '2024-01-15T10:21:00.000Z'), // attempt 3 converts
			ev('u1', 'C', '2024-01-15T10:22:00.000Z'),
		];
		const rows = emulateBreakdown(events, {
			...BASE, countMode: 'totals', reentry: true, exclusionSteps: [{ event: 'X' }],
		});
		// hand-computed: 3 attempts at step 0; 1 reaches step 1; 2 excluded at boundary 1
		expect(row(rows, 0, 1).conversions).toBe(3);
		expect(row(rows, 1, 1).conversions).toBe(1);
		expect(row(rows, 1, 1).excluded).toBe(2);
	});
});

describe('funnelFrequency validation', () => {
	const events = [ev('u1', 'A', '2024-01-15T10:00:00.000Z')];

	test('countMode totals/sessions + non-sequential order throws', () => {
		expect(() => emulateBreakdown(events, { ...BASE, countMode: 'totals', funnelOrder: 'last-fixed' }))
			.toThrow(/sequential/);
		expect(() => emulateBreakdown(events, { ...BASE, countMode: 'sessions', funnelOrder: 'random' }))
			.toThrow(/sequential/);
	});

	test('holdPropertyConstant + non-sequential order throws', () => {
		expect(() => emulateBreakdown(events, { ...BASE, holdPropertyConstant: 'plan', funnelOrder: 'outside-in' }))
			.toThrow(/sequential/);
	});

	test('holdPropertyConstant + session windows refused (full-stream sessionization)', () => {
		expect(() => emulateBreakdown(events, { ...BASE, holdPropertyConstant: 'plan', countMode: 'sessions' }))
			.toThrow(/full event stream/);
		expect(() => emulateBreakdown(events, { ...BASE, holdPropertyConstant: 'plan', conversionWindow: { unit: 'sessions', n: 2 } }))
			.toThrow(/full event stream/);
	});

	test("countMode 'sessions' constraint errors propagate from the primitive", () => {
		expect(() => emulateBreakdown(events, { ...BASE, countMode: 'sessions', reentry: true }))
			.toThrow(/re-entry/);
		expect(() => emulateBreakdown(events, { ...BASE, countMode: 'sessions', conversionWindowMs: 1000 }))
			.toThrow(/1 session/);
	});
});
