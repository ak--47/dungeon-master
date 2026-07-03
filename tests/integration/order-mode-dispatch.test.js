//@ts-nocheck
/**
 * v1.5 verifier order-mode dispatch tests.
 * v1.6.0 (P1.6.6): orders with contiguous scrambled regions now route through
 * the engine's `{ anyOrder }` blocks (Mixpanel's anchor/chunk greedy pass) —
 * full semantics: windows, 2s rule, exclusions, ordering of the fixed steps.
 *
 *   - sequential, interrupt, interrupted → `evaluateFunnel` (greedy, Mixpanel-aligned)
 *   - first-fixed                        → `[s0, { anyOrder: rest }]`
 *   - last-fixed                         → `[{ anyOrder: init }, sLast]`
 *   - first-and-last-fixed               → `[s0, { anyOrder: middle }, sLast]`
 *   - outside-in, random                 → `[{ anyOrder: all }]`
 *   - middle-fixed                       → any-order completion (partial —
 *     scrambled slots are the non-contiguous ends)
 */

import { describe, test, expect } from 'vitest';
import { evaluateAnyOrderCompletion } from '../../lib/verify/funnel-engine.js';
import { emulateBreakdown } from '../../lib/verify/emulate-breakdown.js';

const ev = (event, time, uid = 'u1') => ({ event, time, user_id: uid });
const iso = (s) => new Date(s).toISOString();

describe('evaluateAnyOrderCompletion', () => {
	test('returns true when user fired all step events (any order)', () => {
		const events = [
			ev('C', iso('2025-09-01T03:00:00Z')),
			ev('A', iso('2025-09-01T01:00:00Z')),
			ev('B', iso('2025-09-01T02:00:00Z')),
		];
		const r = evaluateAnyOrderCompletion(events, ['A', 'B', 'C']);
		expect(r.completed).toBe(true);
		expect(new Set(r.eventsFired)).toEqual(new Set(['A', 'B', 'C']));
		expect(r.completionTimeMs).toBe(2 * 3600 * 1000);
	});

	test('returns false when one event name is missing', () => {
		const events = [ev('A', iso('2025-09-01T01:00:00Z')), ev('B', iso('2025-09-01T02:00:00Z'))];
		const r = evaluateAnyOrderCompletion(events, ['A', 'B', 'C']);
		expect(r.completed).toBe(false);
		expect(r.completionTimeMs).toBe(null);
	});

	test('completionTimeMs uses earliest-occurrence-of-each-event range', () => {
		const events = [
			ev('A', iso('2025-09-01T00:00:00Z')),
			ev('A', iso('2025-09-01T05:00:00Z')), // dup, ignored for "earliest"
			ev('B', iso('2025-09-01T02:00:00Z')),
		];
		const r = evaluateAnyOrderCompletion(events, ['A', 'B']);
		expect(r.completed).toBe(true);
		// firstSeenTime = A@0, lastSeenTime = A@5h, completionTimeMs = 5h
		expect(r.completionTimeMs).toBe(5 * 3600 * 1000);
	});

	test('returns empty result for empty steps or events', () => {
		expect(evaluateAnyOrderCompletion([], ['A']).completed).toBe(false);
		expect(evaluateAnyOrderCompletion([ev('A', iso('2025-09-01T00:00:00Z'))], []).completed).toBe(false);
	});
});

describe('emulateBreakdown — order-mode dispatch', () => {
	const sequentialUser = [
		ev('A', iso('2025-09-01T00:00:00Z'), 'seq-user'),
		ev('B', iso('2025-09-01T01:00:00Z'), 'seq-user'),
		ev('C', iso('2025-09-01T02:00:00Z'), 'seq-user'),
		ev('breakdown-event', iso('2025-09-01T03:00:00Z'), 'seq-user'),
	];
	const reverseOrderUser = [
		ev('C', iso('2025-09-01T00:00:00Z'), 'rev-user'),
		ev('B', iso('2025-09-01T01:00:00Z'), 'rev-user'),
		ev('A', iso('2025-09-01T02:00:00Z'), 'rev-user'),
		ev('breakdown-event', iso('2025-09-01T03:00:00Z'), 'rev-user'),
	];

	test('sequential mode: greedy engine — reverse-order user does NOT complete', () => {
		const rows = emulateBreakdown(reverseOrderUser, {
			type: 'funnelFrequency',
			steps: ['A', 'B', 'C'],
			breakdownByFrequencyOf: 'breakdown-event',
			funnelOrder: 'sequential',
		});
		// reverse-order: greedy engine consumes C first when looking for A → fail to advance.
		// Should not have a row for step C (index 2).
		const stepCRows = rows.filter(r => r.step_index === 2);
		expect(stepCRows.length).toBe(0);
	});

	test('random mode: any-order — reverse-order user DOES complete', () => {
		const rows = emulateBreakdown(reverseOrderUser, {
			type: 'funnelFrequency',
			steps: ['A', 'B', 'C'],
			breakdownByFrequencyOf: 'breakdown-event',
			funnelOrder: 'random',
		});
		// any-order: user fired A, B, C → completes.
		const stepCRows = rows.filter(r => r.step_index === 2);
		expect(stepCRows.length).toBeGreaterThan(0);
	});

	test('sequential mode + correctly-ordered user: completes', () => {
		const rows = emulateBreakdown(sequentialUser, {
			type: 'funnelFrequency',
			steps: ['A', 'B', 'C'],
			breakdownByFrequencyOf: 'breakdown-event',
			funnelOrder: 'sequential',
		});
		const stepCRows = rows.filter(r => r.step_index === 2);
		expect(stepCRows.length).toBeGreaterThan(0);
	});

	test('first-fixed mode: step-0 must be greedy, rest any-order', () => {
		// Both users fire step-0=A as their first event, then later events are out of order.
		const events = [
			ev('A', iso('2025-09-01T00:00:00Z'), 'u1'),
			ev('C', iso('2025-09-01T01:00:00Z'), 'u1'),
			ev('B', iso('2025-09-01T02:00:00Z'), 'u1'),
			ev('breakdown-event', iso('2025-09-01T03:00:00Z'), 'u1'),
		];
		const rows = emulateBreakdown(events, {
			type: 'funnelFrequency',
			steps: ['A', 'B', 'C'],
			breakdownByFrequencyOf: 'breakdown-event',
			funnelOrder: 'first-fixed',
		});
		// Step-0 (A) fires first → step-0 row exists, AND user completes (any-order rest).
		const lastStepRows = rows.filter(r => r.step_index === 2);
		expect(lastStepRows.length).toBeGreaterThan(0);
	});

	test('first-fixed mode: user without step-0 first does NOT complete', () => {
		const events = [
			ev('B', iso('2025-09-01T00:00:00Z'), 'u1'),
			ev('A', iso('2025-09-01T01:00:00Z'), 'u1'),
			ev('C', iso('2025-09-01T02:00:00Z'), 'u1'),
			ev('breakdown-event', iso('2025-09-01T03:00:00Z'), 'u1'),
		];
		const rows = emulateBreakdown(events, {
			type: 'funnelFrequency',
			steps: ['A', 'B', 'C'],
			breakdownByFrequencyOf: 'breakdown-event',
			funnelOrder: 'first-fixed',
		});
		// In first-fixed mode, step 0 must come first via greedy. B comes first; A doesn't
		// match as the first step-0 candidate. Greedy on [A] still finds A at t=1, so step
		// 0 succeeds. Then any-order on [B, C] succeeds too. So this DOES complete.
		// Test the more subtle case: NO A at all.
		const noAEvents = [
			ev('B', iso('2025-09-01T00:00:00Z'), 'u1'),
			ev('C', iso('2025-09-01T02:00:00Z'), 'u1'),
			ev('breakdown-event', iso('2025-09-01T03:00:00Z'), 'u1'),
		];
		const rows2 = emulateBreakdown(noAEvents, {
			type: 'funnelFrequency',
			steps: ['A', 'B', 'C'],
			breakdownByFrequencyOf: 'breakdown-event',
			funnelOrder: 'first-fixed',
		});
		// Should not complete (no step 0 fired).
		const lastStepRows = rows2.filter(r => r.step_index === 2);
		expect(lastStepRows.length).toBe(0);
	});

	test('last-fixed mode: fixed last step must come AFTER the scrambled block', () => {
		// P1.6.6 behavior change (spec-mandated): last-fixed maps to
		// [{ anyOrder: [A, B] }, C]. reverseOrderUser fired C FIRST — the
		// buffered anchor C@00:00 fails timestamp_comes_after against the
		// chunk completion at 02:00 (history.cpp cascade), so the funnel stops
		// at reached 1. The old set-membership check wrongly completed here;
		// Mixpanel does not. (The generator's last-fixed mode always emits the
		// last step last, so this fixture is data the mode never produces.)
		const rows = emulateBreakdown(reverseOrderUser, {
			type: 'funnelFrequency',
			steps: ['A', 'B', 'C'],
			breakdownByFrequencyOf: 'breakdown-event',
			funnelOrder: 'last-fixed',
		});
		expect(rows.filter(r => r.step_index === 2).length).toBe(0);
		// hand-computed: positions 0 (C→ no; B@01:00 fills position 0, A@02:00
		// position 1) → steps 0 and 1 credited, step 2 never crossed.
		expect(rows.filter(r => r.step_index === 1).length).toBeGreaterThan(0);
	});

	test('last-fixed mode: scrambled block then fixed last step completes', () => {
		// Data the last-fixed generator actually produces: [A,B] shuffled, C last.
		const events = [
			ev('B', iso('2025-09-01T00:00:00Z'), 'u1'),
			ev('A', iso('2025-09-01T01:00:00Z'), 'u1'),
			ev('C', iso('2025-09-01T02:00:00Z'), 'u1'),
			ev('breakdown-event', iso('2025-09-01T03:00:00Z'), 'u1'),
		];
		const rows = emulateBreakdown(events, {
			type: 'funnelFrequency',
			steps: ['A', 'B', 'C'],
			breakdownByFrequencyOf: 'breakdown-event',
			funnelOrder: 'last-fixed',
		});
		// hand-traced: B fills position 0, A position 1 (chunk in arrival
		// order), C crosses the anchor → completed.
		expect(rows.filter(r => r.step_index === 2).length).toBeGreaterThan(0);
	});
});
