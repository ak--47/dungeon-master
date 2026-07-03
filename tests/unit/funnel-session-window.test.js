//@ts-nocheck
/**
 * P1.6.1 unit tests: session-count conversion windows.
 *
 * Every expected value below is hand-computed from the ARB rules — NOT
 * derived from running the implementation:
 *   - ordinal check: `session_id1 < session_id2 + length_sessions`
 *     (conversion_window.cpp WINDOW_TYPE_SESSIONS)
 *   - ordinal = count of session ENDS before the event, seeded 0
 *     (per_user_funnel_state_increment_session_id sits AFTER
 *     funnel_query_process_event in funnel_query.cpp — the closing event
 *     belongs to the session it closes)
 *   - wall-clock outer bound: t_step < t_step0 + n × 1 day
 *     (seconds_per_unit[QUERY_UNIT_SESSION] = SECONDS_PER_DAY, unit.c)
 *   - n capped at 12 (_MAX_LENGTHS["session"],
 *     api/version_2_0/arb_funnels/validate.py)
 *   - session boundaries: 30-min gap (strict >), UTC day change
 */

import { describe, test, expect } from 'vitest';
import { evaluateFunnel } from '../../lib/verify/funnel-engine.js';
import { sessionOrdinals } from '../../lib/verify/sessionize.js';

const ev = (event, time, props = {}) => ({ event, time, user_id: 'u1', ...props });

describe('sessionOrdinals', () => {
	test('ordinal = session index; the closing event belongs to the session it closes', () => {
		const events = [
			ev('a', '2024-01-15T10:00:00.000Z'), // session 0
			ev('b', '2024-01-15T10:10:00.000Z'), // session 0 — closes it
			ev('c', '2024-01-15T11:00:00.000Z'), // 50-min gap → session 1
			ev('d', '2024-01-16T09:00:00.000Z'), // new UTC day → session 2
		];
		const ords = sessionOrdinals(events);
		// hand-computed: [0, 0, 1, 2]
		expect(events.map(e => ords.get(e))).toEqual([0, 0, 1, 2]);
	});

	test('unparseable times are absent from the map', () => {
		const good = ev('a', '2024-01-15T10:00:00.000Z');
		const bad = ev('b', 'not-a-date');
		const ords = sessionOrdinals([good, bad]);
		expect(ords.get(good)).toBe(0);
		expect(ords.has(bad)).toBe(false);
	});
});

describe('evaluateFunnel — conversionWindow { unit: sessions }', () => {
	test('n = 1: same-session conversion passes (30-min-exact gap stays in session)', () => {
		const events = [
			ev('signup', '2024-01-15T10:00:00.000Z'),
			ev('purchase', '2024-01-15T10:30:00.000Z'), // gap == timeout → same session
		];
		const r = evaluateFunnel(events, ['signup', 'purchase'], { conversionWindow: { unit: 'sessions', n: 1 } });
		expect(r.completed).toBe(true);
		expect(r.ttcMs).toBe(30 * 60_000);
	});

	test('n = 1: next-session step fails; n = 2 passes', () => {
		const events = [
			ev('signup', '2024-01-15T10:00:00.000Z'),   // session 0
			ev('purchase', '2024-01-15T11:00:00.000Z'), // 60-min gap → session 1
		];
		// hand-computed: ordinal(purchase)=1; n=1 → 1 < 0+1 false
		const r1 = evaluateFunnel(events, ['signup', 'purchase'], { conversionWindow: { unit: 'sessions', n: 1 } });
		expect(r1.completed).toBe(false);
		expect(r1.reached).toBe(0);
		// n=2 → 1 < 0+2 true; wall-clock 1h < 2d true
		const r2 = evaluateFunnel(events, ['signup', 'purchase'], { conversionWindow: { unit: 'sessions', n: 2 } });
		expect(r2.completed).toBe(true);
	});

	test('wall-clock outer bound: ordinal passes but t ≥ t0 + n×1day kills the step (strict <)', () => {
		const events = [
			ev('signup', '2024-01-15T10:00:00.000Z'),   // session 0
			ev('purchase', '2024-01-17T10:00:00.000Z'), // session 1 (one gap), exactly +2 days
		];
		// hand-computed: ordinal 1 < 0+2 ✓ but t == t0 + 2×86400000 → strict < fails
		const rAt = evaluateFunnel(events, ['signup', 'purchase'], { conversionWindow: { unit: 'sessions', n: 2 } });
		expect(rAt.completed).toBe(false);
		expect(rAt.reached).toBe(0);
		// one second inside the bound → passes
		const eventsIn = [
			ev('signup', '2024-01-15T10:00:00.000Z'),
			ev('purchase', '2024-01-17T09:59:59.000Z'),
		];
		const rIn = evaluateFunnel(eventsIn, ['signup', 'purchase'], { conversionWindow: { unit: 'sessions', n: 2 } });
		expect(rIn.completed).toBe(true);
	});

	test('3-step funnel: every step bounds against STEP 0\'s ordinal, not the previous step\'s', () => {
		const events = [
			ev('a', '2024-01-15T10:00:00.000Z'), // session 0
			ev('b', '2024-01-15T10:40:00.000Z'), // 40-min gap → session 1
			ev('c', '2024-01-15T11:20:00.000Z'), // 40-min gap → session 2
		];
		// hand-computed n=2: b ordinal 1 < 0+2 ✓; c ordinal 2 < 0+2 ✗ → reached 1.
		// If the bound were previous-step-relative, c (1 session after b) would pass.
		const r2 = evaluateFunnel(events, ['a', 'b', 'c'], { conversionWindow: { unit: 'sessions', n: 2 } });
		expect(r2.completed).toBe(false);
		expect(r2.reached).toBe(1);
		// n=3: c ordinal 2 < 0+3 ✓ → completes
		const r3 = evaluateFunnel(events, ['a', 'b', 'c'], { conversionWindow: { unit: 'sessions', n: 3 } });
		expect(r3.completed).toBe(true);
	});

	test('cascade path honors the session window (pre-recorded later step within grace)', () => {
		// b lands 1s before a (2s grace forgives ordering); both session 0.
		const b = ev('b', '2024-01-15T10:00:00.000Z');
		const a = ev('a', '2024-01-15T10:00:01.000Z');
		const r = evaluateFunnel([b, a], ['a', 'b'], { conversionWindow: { unit: 'sessions', n: 1 } });
		expect(r.completed).toBe(true);
	});

	test('validation: n > 12 (API cap), n < 1, non-integer n, unknown unit, both windows', () => {
		const events = [ev('a', '2024-01-15T10:00:00.000Z')];
		expect(() => evaluateFunnel(events, ['a', 'b'], { conversionWindow: { unit: 'sessions', n: 13 } }))
			.toThrow(/12/);
		expect(() => evaluateFunnel(events, ['a', 'b'], { conversionWindow: { unit: 'sessions', n: 12 } }))
			.not.toThrow();
		expect(() => evaluateFunnel(events, ['a', 'b'], { conversionWindow: { unit: 'sessions', n: 0 } }))
			.toThrow(/positive integer/);
		expect(() => evaluateFunnel(events, ['a', 'b'], { conversionWindow: { unit: 'sessions', n: 1.5 } }))
			.toThrow(/positive integer/);
		expect(() => evaluateFunnel(events, ['a', 'b'], { conversionWindow: { unit: 'days', n: 2 } }))
			.toThrow(/unit/);
		expect(() => evaluateFunnel(events, ['a', 'b'], { conversionWindow: { unit: 'sessions', n: 1 }, conversionWindowMs: 1000 }))
			.toThrow(/mutually exclusive/);
	});

	test('time-based conversionWindowMs path unchanged by the refactor', () => {
		const events = [
			ev('signup', '2024-01-15T10:00:00.000Z'),
			ev('purchase', '2024-01-15T10:10:00.000Z'),
		];
		const pass = evaluateFunnel(events, ['signup', 'purchase'], { conversionWindowMs: 11 * 60_000 });
		expect(pass.completed).toBe(true);
		const fail = evaluateFunnel(events, ['signup', 'purchase'], { conversionWindowMs: 10 * 60_000 });
		// strict <: t == t0 + window fails
		expect(fail.completed).toBe(false);
	});
});
