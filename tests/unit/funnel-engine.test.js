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
import {
	evaluateFunnel,
	evaluateFunnelHPC,
	resolveFunnelSegment,
	normalizeStep,
	matchesStepFilter,
	timestampComesAfter,
	withinConversionWindow,
} from '../../lib/verify/funnel-engine.js';

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

// ─── Step normalization + filters ────────────────────────────────────────────

describe('normalizeStep', () => {
	test('converts string to canonical shape', () => {
		expect(normalizeStep('A')).toEqual({ event: 'A' });
	});
	test('preserves where clause on object steps', () => {
		expect(normalizeStep({ event: 'A', where: { prop: 'x', op: 'eq', value: 1 } }))
			.toEqual({ event: 'A', where: { prop: 'x', op: 'eq', value: 1 } });
	});
	test('strips where when absent', () => {
		expect(normalizeStep({ event: 'A' })).toEqual({ event: 'A' });
	});
	test('throws on invalid', () => {
		expect(() => normalizeStep(null)).toThrow();
		expect(() => normalizeStep({ where: {} })).toThrow();
	});
});

describe('matchesStepFilter', () => {
	test('returns true when filter undefined', () => {
		expect(matchesStepFilter({ x: 1 }, undefined)).toBe(true);
	});
	test('eq / neq', () => {
		expect(matchesStepFilter({ x: 1 }, { prop: 'x', op: 'eq', value: 1 })).toBe(true);
		expect(matchesStepFilter({ x: 1 }, { prop: 'x', op: 'neq', value: 2 })).toBe(true);
		expect(matchesStepFilter({ x: 1 }, { prop: 'x', op: 'eq', value: 2 })).toBe(false);
	});
	test('numeric ops gt/lt/gte/lte', () => {
		expect(matchesStepFilter({ a: 5 }, { prop: 'a', op: 'gt',  value: 3 })).toBe(true);
		expect(matchesStepFilter({ a: 5 }, { prop: 'a', op: 'gte', value: 5 })).toBe(true);
		expect(matchesStepFilter({ a: 5 }, { prop: 'a', op: 'lt',  value: 5 })).toBe(false);
		expect(matchesStepFilter({ a: 5 }, { prop: 'a', op: 'lte', value: 5 })).toBe(true);
	});
	test('string contains / not_contains', () => {
		expect(matchesStepFilter({ p: 'iOS 17' }, { prop: 'p', op: 'contains',     value: 'iOS' })).toBe(true);
		expect(matchesStepFilter({ p: 'iOS 17' }, { prop: 'p', op: 'not_contains', value: 'Android' })).toBe(true);
		expect(matchesStepFilter({ p: 'iOS 17' }, { prop: 'p', op: 'not_contains', value: 'iOS' })).toBe(false);
	});
});

// ─── Step-level filters in evaluateFunnel ────────────────────────────────────

describe('evaluateFunnel — step filters', () => {
	const ev2 = (event, time, props = {}) => ({ event, time, user_id: 'u1', ...props });

	// ported from test_qt_funnel.py: "funnel step filters" with `properties["a"] >= 1`
	test('only events matching step filter advance the step', () => {
		const events = [
			ev2('s2', 1000, { a: 0 }),  // doesn't match `a >= 1`, skipped
			ev2('s1', 1500),
			ev2('s2', 2000, { a: 2 }),  // matches
		];
		const r = evaluateFunnel(events, [
			{ event: 's1' },
			{ event: 's2', where: { prop: 'a', op: 'gte', value: 1 } },
		]);
		expect(r.completed).toBe(true);
		expect(r.stepTimes[1]).toBe(2000);
	});

	test('event matching name but not filter does not advance', () => {
		const events = [
			ev2('s1', 1000),
			ev2('s2', 2000, { plan: 'free' }),
		];
		const r = evaluateFunnel(events, [
			{ event: 's1' },
			{ event: 's2', where: { prop: 'plan', op: 'eq', value: 'pro' } },
		]);
		expect(r.completed).toBe(false);
		expect(r.reached).toBe(0);
	});
});

// ─── Reentry ─────────────────────────────────────────────────────────────────

describe('evaluateFunnel — reentry', () => {
	const ev3 = (event, time) => ({ event, time, user_id: 'u1' });

	// ported from test_qt_funnel.py: reentry / `last_step_starts_next_funnel`.
	// After completing [A, B], reset and continue scanning for another [A, B].
	test('completes twice with reentry: true', () => {
		const events = [
			ev3('A', 1000), ev3('B', 2000),
			ev3('A', 3000), ev3('B', 4000),
		];
		const r = evaluateFunnel(events, ['A', 'B'], { reentry: true });
		expect(r.completed).toBe(true);
		expect(r.completions).toBe(2);
		// Reports LAST completion's step times (history.cpp behavior).
		expect(r.stepTimes[0]).toBe(3000);
		expect(r.stepTimes[1]).toBe(4000);
	});

	test('completions=1 when reentry=false (default) even on repeated sequences', () => {
		const events = [
			ev3('A', 1000), ev3('B', 2000),
			ev3('A', 3000), ev3('B', 4000),
		];
		const r = evaluateFunnel(events, ['A', 'B']);
		expect(r.completed).toBe(true);
		expect(r.completions).toBe(1);
	});

	test('completions=0 when never completed, regardless of reentry', () => {
		const r = evaluateFunnel([ev3('A', 1000)], ['A', 'B'], { reentry: true });
		expect(r.completions).toBe(0);
	});
});

// ─── Simultaneous histories (totals mode) ────────────────────────────────────

describe('evaluateFunnel — totals (simultaneous histories)', () => {
	const ev4 = (event, time) => ({ event, time, user_id: 'u1' });

	// ported from test_qt_funnel.py: count_type="general" with reentry returns
	// one history per completion.
	test('returns array with one FunnelResult per completion', () => {
		const events = [
			ev4('A', 1000), ev4('B', 2000),
			ev4('A', 3000), ev4('B', 4000),
			ev4('A', 5000), ev4('B', 6000),
		];
		const r = evaluateFunnel(events, ['A', 'B'], { reentry: true, countMode: 'totals' });
		expect(Array.isArray(r)).toBe(true);
		expect(r.length).toBe(3);
		expect(r[0].stepTimes).toEqual([1000, 2000]);
		expect(r[1].stepTimes).toEqual([3000, 4000]);
		expect(r[2].stepTimes).toEqual([5000, 6000]);
	});

	test('throws when countMode=totals without reentry', () => {
		expect(() => evaluateFunnel([], ['A', 'B'], { countMode: 'totals' }))
			.toThrow(/reentry/);
	});

	test('returns empty array when never completed', () => {
		const r = evaluateFunnel([ev4('A', 1000)], ['A', 'B'], { reentry: true, countMode: 'totals' });
		expect(r).toEqual([]);
	});
});

// ─── Exclusion steps ─────────────────────────────────────────────────────────

describe('evaluateFunnel — exclusion steps', () => {
	const ev5 = (event, time, props = {}) => ({ event, time, user_id: 'u1', ...props });

	// ported from test_qt_funnel.py: "Standard case" exclusion fixture.
	// Funnel [fs1, fs3], exclusion fs2 between them. d1: fs1→fs2→fs3 (excluded);
	// d2: fs1→fs3 (converts).
	test('exclusion event between steps terminates attempt', () => {
		const events = [
			ev5('fs1', 1000), ev5('fs2', 2000), ev5('fs3', 3000),
		];
		const r = evaluateFunnel(events, ['fs1', 'fs3'], {
			exclusionSteps: [{ event: 'fs2', afterStep: 1, beforeStep: 2 }],
		});
		expect(r.completed).toBe(false);
		expect(r.reached).toBe(0);
	});

	test('no exclusion event → funnel completes', () => {
		const events = [ev5('fs1', 1000), ev5('fs3', 2000)];
		const r = evaluateFunnel(events, ['fs1', 'fs3'], {
			exclusionSteps: [{ event: 'fs2', afterStep: 1, beforeStep: 2 }],
		});
		expect(r.completed).toBe(true);
	});

	// ported from test_qt_funnel.py: "exclusion step just before last step alone"
	test('exclusion only between specific consecutive steps', () => {
		const events = [
			ev5('fs1', 1000), ev5('fs2', 2000), ev5('es2', 3000), ev5('fs3', 4000),
		];
		const r = evaluateFunnel(events, ['fs1', 'fs2', 'fs3'], {
			exclusionSteps: [{ event: 'es2', afterStep: 2, beforeStep: 3 }],
		});
		// Reached fs2 (step 1) but es2 fires before fs3 → terminates at step 1.
		expect(r.reached).toBe(1);
		expect(r.completed).toBe(false);
	});

	test('exclusion + reentry: terminates current attempt only', () => {
		// Times spaced beyond the 2s grace so the orphaned B (from killed
		// attempt 1) cannot retroactively satisfy attempt 2's step 1 cascade.
		const events = [
			ev5('A', 1000), ev5('X', 2000), ev5('B', 3000),    // killed by X
			ev5('A', 10000), ev5('B', 12000),                  // succeeds
		];
		const r = evaluateFunnel(events, ['A', 'B'], {
			reentry: true,
			countMode: 'totals',
			exclusionSteps: [{ event: 'X' }],
		});
		expect(r.length).toBe(1);
		expect(r[0].stepTimes).toEqual([10000, 12000]);
	});
});

// ─── HPC (Hold Property Constant) ────────────────────────────────────────────

describe('evaluateFunnelHPC', () => {
	const ev6 = (event, time, props = {}) => ({ event, time, user_id: 'u1', ...props });

	// ported from test_qt_funnel.py: test_funnel_hpc_group_properties.
	// Two "Viewed report" steps held constant on `prop`; user must hit the same
	// prop value twice. Group A converts on prop=1 (twice) and prop=2 (twice).
	test('groups parallel sub-funnels by step-0 property value', () => {
		const events = [
			ev6('Viewed report', 1000, { prop: '1' }),
			ev6('Viewed report', 2000, { prop: '2' }),
			ev6('Viewed report', 3000, { prop: '1' }),
			ev6('Viewed report', 4000, { prop: '2' }),
		];
		const out = evaluateFunnelHPC(events, ['Viewed report', 'Viewed report'], 'prop');
		expect(out.size).toBe(2);
		expect(out.get('1').completed).toBe(true);
		expect(out.get('2').completed).toBe(true);
	});

	test('user converts in one HPC value and not another', () => {
		const events = [
			ev6('A', 1000, { plan: 'pro' }),
			ev6('A', 1100, { plan: 'free' }),
			ev6('B', 2000, { plan: 'pro' }),
			// no B with plan=free
		];
		const out = evaluateFunnelHPC(events, ['A', 'B'], 'plan');
		expect(out.get('pro').completed).toBe(true);
		expect(out.get('free').completed).toBe(false);
	});

	test('events without HPC property are ignored', () => {
		const events = [
			ev6('A', 1000, { plan: 'pro' }),
			ev6('B', 2000),
			ev6('B', 3000, { plan: 'pro' }),
		];
		const out = evaluateFunnelHPC(events, ['A', 'B'], 'plan');
		expect(out.size).toBe(1);
		expect(out.get('pro').completed).toBe(true);
	});
});

// ─── Step property tracking + segment modes ──────────────────────────────────

describe('evaluateFunnel — trackStepProperties + resolveFunnelSegment', () => {
	const ev7 = (event, time, props = {}) => ({ event, time, user_id: 'u1', ...props });

	test('captures all properties when trackStepProperties=true', () => {
		const events = [
			ev7('A', 1000, { plan: 'pro', country: 'US' }),
			ev7('B', 2000, { plan: 'free', country: 'CA' }),
		];
		const r = evaluateFunnel(events, ['A', 'B'], { trackStepProperties: true });
		expect(r.stepProperties).toHaveLength(2);
		expect(r.stepProperties[0]).toEqual({ plan: 'pro', country: 'US' });
		expect(r.stepProperties[1]).toEqual({ plan: 'free', country: 'CA' });
	});

	test('captures only allowlisted properties when given an array', () => {
		const events = [
			ev7('A', 1000, { plan: 'pro', country: 'US', secret: 'x' }),
			ev7('B', 2000, { plan: 'free', country: 'CA', secret: 'y' }),
		];
		const r = evaluateFunnel(events, ['A', 'B'], { trackStepProperties: ['plan'] });
		expect(r.stepProperties[0]).toEqual({ plan: 'pro' });
		expect(r.stepProperties[1]).toEqual({ plan: 'free' });
	});

	test('resolveFunnelSegment first / last / step', () => {
		const events = [
			ev7('A', 1000, { src: 'organic' }),
			ev7('B', 2000, { src: 'paid' }),
			ev7('C', 3000, { src: 'referral' }),
		];
		const r = evaluateFunnel(events, ['A', 'B', 'C'], { trackStepProperties: true });
		expect(resolveFunnelSegment(r, 'first')).toEqual({ src: 'organic' });
		expect(resolveFunnelSegment(r, 'last')).toEqual({ src: 'referral' });
		expect(resolveFunnelSegment(r, { step: 1 })).toEqual({ src: 'paid' });
	});

	test('resolveFunnelSegment returns undefined when no stepProperties', () => {
		const r = evaluateFunnel([], ['A']);
		expect(resolveFunnelSegment(r, 'first')).toBeUndefined();
	});
});

// ─── Session-scoped funnels ─────────────────────────────────────────────────

describe('evaluateFunnel — sessionScoped', () => {
	const evS = (event, time, session_id) => ({ event, time, user_id: 'u1', session_id });

	test('steps in different sessions do NOT complete', () => {
		const events = [
			evS('A', 1000, 's1'),
			evS('B', 2000, 's2'),
		];
		const r = evaluateFunnel(events, ['A', 'B'], { sessionScoped: true });
		expect(r.completed).toBe(false);
	});

	test('steps in same session DO complete', () => {
		const events = [
			evS('A', 1000, 's1'),
			evS('B', 2000, 's1'),
		];
		const r = evaluateFunnel(events, ['A', 'B'], { sessionScoped: true });
		expect(r.completed).toBe(true);
		expect(r.sessionId).toBe('s1');
	});

	test('sessionScoped + totals mode: each session yields its own completions', () => {
		const events = [
			evS('A', 1000, 's1'), evS('B', 2000, 's1'),
			evS('A', 3000, 's2'), evS('B', 4000, 's2'),
		];
		const r = evaluateFunnel(events, ['A', 'B'], {
			sessionScoped: true,
			reentry: true,
			countMode: 'totals',
		});
		expect(r.length).toBe(2);
		expect(new Set(r.map(x => x.sessionId))).toEqual(new Set(['s1', 's2']));
	});
});
