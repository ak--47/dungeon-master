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
 *   - the per-step check is ordinal-ONLY (conversion_window.cpp:50) — the
 *     SESSIONS branch never reads the timestamps. ARB's n×1-day bound
 *     (conversion_window_max_length_seconds = n × SECONDS_PER_DAY, unit.c:14)
 *     binds only against the trend interval end (funnel_query.cpp:1620) and
 *     the data-pull range — never per step.
 *   - n capped at 12 (_MAX_LENGTHS["session"],
 *     api/version_2_0/arb_funnels/validate.py)
 *   - session boundaries: 30-min gap (strict >), UTC day change
 *   - restart machinery (fix-round B2+C5): an event past the conversion
 *     window from step 0 finalizes the born history and a fresh history
 *     processes that same event (funnel_query.cpp:1608-1617 termination,
 *     :1663-1680 re-birth). GENERAL_WO_REPEAT (the count-by-sessions
 *     rewrite) terminates ONLY on expiry — completed/excluded histories
 *     idle until the window expires, so at most one attempt per window
 *     span (:1611-1613); GENERAL (reentry) also restarts right after each
 *     completion/exclusion.
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
		// n=2 → 1 < 0+2 true
		const r2 = evaluateFunnel(events, ['signup', 'purchase'], { conversionWindow: { unit: 'sessions', n: 2 } });
		expect(r2.completed).toBe(true);
	});

	test('ordinal-only: wall-clock distance is irrelevant — next session 2 days later converts with n=2 (conversion_window.cpp:50)', () => {
		const events = [
			ev('signup', '2024-01-15T10:00:00.000Z'),   // session 0
			ev('purchase', '2024-01-17T10:00:00.000Z'), // session 1 (one boundary), +2 days
		];
		// hand-computed: ordinal(purchase)=1 < 0+2 ✓. The SESSIONS branch of
		// is_within_conversion_window never reads t1_ms/t2_ms — the +2 days
		// is invisible to the step check.
		const r = evaluateFunnel(events, ['signup', 'purchase'], { conversionWindow: { unit: 'sessions', n: 2 } });
		expect(r.completed).toBe(true);
		expect(r.ttcMs).toBe(2 * 86400_000);
		// n=1: 1 < 0+1 ✗ — the ordinal check alone gates it
		const r1 = evaluateFunnel(events, ['signup', 'purchase'], { conversionWindow: { unit: 'sessions', n: 1 } });
		expect(r1.completed).toBe(false);
		expect(r1.reached).toBe(0);
		// 30 days out, still the very next session → n=2 still converts
		const far = [
			ev('signup', '2024-01-15T10:00:00.000Z'),
			ev('purchase', '2024-02-14T10:00:00.000Z'),
		];
		expect(evaluateFunnel(far, ['signup', 'purchase'], { conversionWindow: { unit: 'sessions', n: 2 } }).completed).toBe(true);
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

	test("countMode 'sessions' preset: totals shape + 1-session window (general_wo_repeat rewrite)", () => {
		// P1.6.2 — __validate_sessions rewrite, api/version_2_0/arb_funnels/validate.py
		const sameSession = [
			ev('signup', '2024-01-15T10:00:00.000Z'),
			ev('purchase', '2024-01-15T10:10:00.000Z'),
		];
		const r = evaluateFunnel(sameSession, ['signup', 'purchase'], { countMode: 'sessions' });
		// hand-computed: totals shape (array), one attempt, completed in-session
		expect(Array.isArray(r)).toBe(true);
		expect(r).toHaveLength(1);
		expect(r[0].completed).toBe(true);

		const crossSession = [
			ev('signup', '2024-01-15T10:00:00.000Z'),
			ev('purchase', '2024-01-15T11:00:00.000Z'), // 60-min gap → next session
		];
		const r2 = evaluateFunnel(crossSession, ['signup', 'purchase'], { countMode: 'sessions' });
		expect(r2).toHaveLength(1);
		expect(r2[0].completed).toBe(false);
		expect(r2[0].reached).toBe(0);
	});

	test("countMode 'sessions': no restart WITHIN the window — two passes in one session credit ONE (wo_repeat)", () => {
		// hand-computed (funnel_query.cpp:1611-1613): the completed history
		// idles until window expiry, absorbing the second pass — no new
		// history is created inside the same window span.
		const events = [
			ev('signup', '2024-01-15T10:00:00.000Z'),
			ev('purchase', '2024-01-15T10:01:00.000Z'),
			ev('signup', '2024-01-15T10:02:00.000Z'),
			ev('purchase', '2024-01-15T10:03:00.000Z'),
		];
		const r = evaluateFunnel(events, ['signup', 'purchase'], { countMode: 'sessions' });
		expect(r).toHaveLength(1);
		expect(r[0].completed).toBe(true);
	});

	test("countMode 'sessions' validation: re-entry and conflicting windows throw; explicit (sessions, 1) tolerated", () => {
		const events = [ev('signup', '2024-01-15T10:00:00.000Z')];
		expect(() => evaluateFunnel(events, ['signup', 'purchase'], { countMode: 'sessions', reentry: true }))
			.toThrow(/re-entry/);
		expect(() => evaluateFunnel(events, ['signup', 'purchase'], { countMode: 'sessions', conversionWindowMs: 1000 }))
			.toThrow(/1 session/);
		expect(() => evaluateFunnel(events, ['signup', 'purchase'], { countMode: 'sessions', conversionWindow: { unit: 'sessions', n: 2 } }))
			.toThrow(/1 session/);
		expect(() => evaluateFunnel(events, ['signup', 'purchase'], { countMode: 'sessions', conversionWindow: { unit: 'sessions', n: 1 } }))
			.not.toThrow();
		// empty steps under the preset keep the totals shape
		expect(evaluateFunnel(events, [], { countMode: 'sessions' })).toEqual([]);
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

describe('restart machinery — window expiry re-birth (fix-round B2+C5)', () => {
	test('B2: count-by-sessions credits a conversion PER SESSION — cross-session double convert = 2', () => {
		// hand-computed against funnel_query.cpp:1608-1617 + :1663-1680:
		// H1 births signup@10:00, completes purchase@10:01 (ordinal 0 < 0+1),
		// then IDLES. signup@12:00 (ordinal 1, past window) finalizes H1 —
		// completion #1 — and the fresh history processes that same event,
		// birthing H2; purchase@12:01 (ordinal 1 < 1+1) completes it.
		// Stream end finalizes H2 — completion #2.
		const events = [
			ev('signup', '2024-01-15T10:00:00.000Z'),   // session 0
			ev('purchase', '2024-01-15T10:01:00.000Z'), // session 0
			ev('signup', '2024-01-15T12:00:00.000Z'),   // 1h59m gap → session 1
			ev('purchase', '2024-01-15T12:01:00.000Z'), // session 1
		];
		const r = evaluateFunnel(events, ['signup', 'purchase'], { countMode: 'sessions' });
		expect(r).toHaveLength(2);
		expect(r[0].completed).toBe(true);
		expect(r[1].completed).toBe(true);
	});

	test('wo_repeat: failed attempt finalizes at expiry as a drop-off; next attempt births AT the expiring event', () => {
		// hand-computed: H1 births signup@10:00 (session 0, no purchase
		// follows in-window) → drop-off at step 0 when signup@11:00
		// (ordinal 1) expires it; the SAME signup@11:00 births H2, which
		// completes at purchase@11:01 (ordinal 1 < 1+1).
		const events = [
			ev('signup', '2024-01-15T10:00:00.000Z'),   // session 0
			ev('signup', '2024-01-15T11:00:00.000Z'),   // 59m gap → session 1
			ev('purchase', '2024-01-15T11:01:00.000Z'), // session 1
		];
		const r = evaluateFunnel(events, ['signup', 'purchase'], { countMode: 'sessions' });
		expect(r).toHaveLength(2);
		expect(r[0].completed).toBe(false);
		expect(r[0].reached).toBe(0);
		expect(r[1].completed).toBe(true);
	});

	test('wo_repeat vs GENERAL discriminator: after an exclusion, wo_repeat does NOT re-enter within the window; reentry does', () => {
		// hand-computed. wo_repeat (funnel_query.cpp:1611-1613 — expiry is
		// the ONLY termination): H1 births signup@10:00, refund@10:01 kills
		// it (gap 0, in-window, ties condemn), then it IDLES over
		// signup@10:02/purchase@10:03; signup@11:00 (session 1) expires it
		// and births H2 → purchase@11:01 completes. 1 completion.
		// GENERAL (reentry): restarts right after the exclusion → converts
		// signup@10:02→purchase@10:03 in-window, then again in session 1.
		// 2 completions.
		const events = [
			ev('signup', '2024-01-15T10:00:00.000Z'),   // session 0
			ev('refund', '2024-01-15T10:01:00.000Z'),   // session 0 — exclusion
			ev('signup', '2024-01-15T10:02:00.000Z'),   // session 0
			ev('purchase', '2024-01-15T10:03:00.000Z'), // session 0
			ev('signup', '2024-01-15T11:00:00.000Z'),   // 57m gap → session 1
			ev('purchase', '2024-01-15T11:01:00.000Z'), // session 1
		];
		const exclusionSteps = [{ event: 'refund' }];
		const wr = evaluateFunnel(events, ['signup', 'purchase'], { countMode: 'sessions', exclusionSteps });
		expect(wr).toHaveLength(2); // excluded drop-off + session-1 completion
		expect(wr[0].terminatedByExclusion).toBe(true);
		expect(wr[0].reached).toBe(0);
		expect(wr[1].completed).toBe(true);
		expect(wr.filter(a => a.completed)).toHaveLength(1);

		const gen = evaluateFunnel(events, ['signup', 'purchase'], {
			countMode: 'totals', reentry: true, conversionWindow: { unit: 'sessions', n: 1 }, exclusionSteps,
		});
		expect(gen.filter(a => a.completed)).toHaveLength(2);
		expect(gen.filter(a => a.terminatedByExclusion)).toHaveLength(1);
	});

	test('C5: reentry (GENERAL) restarts after a live attempt\'s window expires — the expiring event can birth the next attempt', () => {
		// hand-computed: H1 births signup@d1 10:00; signup@d2 10:00 is past
		// the 1h window → H1 finalizes as a drop-off at step 0 and the SAME
		// signup births H2 (funnel_query.cpp:1663-1680); purchase@d2 10:30
		// (within 1h of H2's step 0) completes H2. ARB GENERAL total = 1
		// conversion; the pre-fix engine reported 0 (the first attempt
		// scanned to stream end with no restart).
		const events = [
			ev('signup', '2024-01-15T10:00:00.000Z'),
			ev('signup', '2024-01-16T10:00:00.000Z'),
			ev('purchase', '2024-01-16T10:30:00.000Z'),
		];
		const r = evaluateFunnel(events, ['signup', 'purchase'], {
			countMode: 'totals', reentry: true, conversionWindowMs: 3600_000,
		});
		expect(r).toHaveLength(2);
		expect(r[0].completed).toBe(false);
		expect(r[0].reached).toBe(0);
		expect(r[1].completed).toBe(true);

		// Uniques (default, no reentry) is UNCHANGED: first attempt only —
		// ARB's allow_record_multiple_history is false for plain uniques
		// (funnel_query.cpp:592-610), and post-window events cannot advance
		// the frozen attempt.
		const u = evaluateFunnel(events, ['signup', 'purchase'], { conversionWindowMs: 3600_000 });
		expect(u.completed).toBe(false);
		expect(u.reached).toBe(0);
	});

	test('C5: expiring event that does NOT match step 0 restarts scanning without double-counting', () => {
		// hand-computed: H1 births signup@10:00; purchase@12:00 expires it
		// (past 1h) and processes against the fresh history — but purchase
		// is not step 0, so H2 never births. One drop-off row, no phantom
		// attempts.
		const events = [
			ev('signup', '2024-01-15T10:00:00.000Z'),
			ev('purchase', '2024-01-15T12:00:00.000Z'),
		];
		const r = evaluateFunnel(events, ['signup', 'purchase'], {
			countMode: 'totals', reentry: true, conversionWindowMs: 3600_000,
		});
		expect(r).toHaveLength(1);
		expect(r[0].reached).toBe(0);
		expect(r[0].completed).toBe(false);
	});

	test('woRepeat validation: requires totals, excludes reentry and sessionScoped', () => {
		const events = [ev('signup', '2024-01-15T10:00:00.000Z')];
		expect(() => evaluateFunnel(events, ['signup', 'purchase'], { woRepeat: true }))
			.toThrow(/totals/);
		expect(() => evaluateFunnel(events, ['signup', 'purchase'], { woRepeat: true, countMode: 'totals', reentry: true }))
			.toThrow(/mutually exclusive/);
		expect(() => evaluateFunnel(events, ['signup', 'purchase'], { woRepeat: true, countMode: 'totals', sessionScoped: true }))
			.toThrow(/sessionScoped/);
	});
});
