//@ts-nocheck
/**
 * P1.6.6 unit tests: any-order step blocks in evaluateFunnel.
 *
 * Mixpanel's any-order is an anchor/chunk greedy pass, not a permutation
 * search (history.cpp:490-519 direct advance, :538-589 cascade, :926-963
 * can_record_any_order_step). Fixtures below are hand-traced through those
 * rules — expected values derive from the ARB source, never from running
 * this implementation:
 *   - Within the ACTIVE chunk the FIRST eligible match per slot wins
 *     (history.cpp:951-957) — sealing happens even when the conversion
 *     window later refuses the advance.
 *   - Slots in chunks past a not-yet-seen anchor buffer the LATEST match
 *     (:958-962), credited at anchor-crossing only if the buffered time
 *     comes after the anchor per the 2-second rule (timestamp_comes_after).
 *   - The cascade claims a chunk's present members against the PRE-chunk
 *     time and crosses to the next anchor only when the chunk fully fills;
 *     a partial chunk claims its present members and stops (:559-587).
 *   - Exclusion gaps sit between POSITIONS (history_get_time_at_step reads
 *     through step_loc_idx), so they compose with any-order paths.
 */

import { describe, test, expect } from 'vitest';
import {
	evaluateFunnel,
	evaluateFunnelHPC,
	normalizeFunnelSteps,
	evaluateAnyOrderCompletion,
} from '../../lib/verify/funnel-engine.js';

const T = Date.UTC(2024, 0, 15);
const MIN = 60_000;
const HOUR = 3600_000;
const mk = (event, tMs, props = {}) => ({ event, time: tMs, user_id: 'u1', ...props });
const WINDOW = { conversionWindowMs: HOUR };

describe('normalizeFunnelSteps', () => {
	test('anchor/chunk topology matches history.cpp:214-228', () => {
		// [A, {B,C}, D]: anchors at slots 0 and 3, chunk at 1-2. Hand-computed:
		// prevAnchor[i] = nearest anchor ≤ i; nextAnchor[i] = nearest anchor > i
		// (numSteps when none).
		const { flat, isAnyOrder, prevAnchor, nextAnchor, hasAnyOrder } =
			normalizeFunnelSteps(['A', { anyOrder: ['B', 'C'] }, 'D']);
		expect(flat.map(s => s.event)).toEqual(['A', 'B', 'C', 'D']);
		expect(isAnyOrder).toEqual([false, true, true, false]);
		expect(prevAnchor).toEqual([0, 0, 0, 3]);
		expect(nextAnchor).toEqual([3, 3, 3, 4]);
		expect(hasAnyOrder).toBe(true);
	});

	test('leading chunk has prevAnchor -1; trailing chunk has nextAnchor numSteps', () => {
		const { prevAnchor, nextAnchor } = normalizeFunnelSteps([{ anyOrder: ['A', 'B'] }, 'L']);
		expect(prevAnchor).toEqual([-1, -1, 2]);
		expect(nextAnchor).toEqual([2, 2, 3]);
	});

	test('anchor-only funnel: identity topology, hasAnyOrder false', () => {
		const { isAnyOrder, prevAnchor, nextAnchor, hasAnyOrder } = normalizeFunnelSteps(['A', 'B']);
		expect(isAnyOrder).toEqual([false, false]);
		expect(prevAnchor).toEqual([0, 1]);
		expect(nextAnchor).toEqual([1, 2]);
		expect(hasAnyOrder).toBe(false);
	});

	test('throws on empty and nested blocks', () => {
		expect(() => normalizeFunnelSteps([{ anyOrder: [] }])).toThrow(/non-empty/);
		expect(() => normalizeFunnelSteps([{ anyOrder: ['A', { anyOrder: ['B'] }] }]))
			.toThrow(/cannot nest/);
	});
});

describe('full any-order funnel [{ anyOrder: [A, B, C] }]', () => {
	const STEPS = [{ anyOrder: ['A', 'B', 'C'] }];

	test('completes in arrival order; positions record the path, not slot order', () => {
		const events = [mk('B', T), mk('A', T + 10 * MIN), mk('C', T + 20 * MIN)];
		const r = evaluateFunnel(events, STEPS, WINDOW);
		// hand-traced: B fills position 0 (direct advance, no window check for
		// the first chunk record — history.cpp:490-496), A position 1, C
		// position 2. stepEvents surface the PATH.
		expect(r.completed).toBe(true);
		expect(r.reached).toBe(2);
		expect(r.stepTimes).toEqual([T, T + 10 * MIN, T + 20 * MIN]);
		expect(r.stepEvents.map(e => e.event)).toEqual(['B', 'A', 'C']);
	});

	test('active chunk: first match per slot wins — no latest overwrite', () => {
		const STEPS2 = [{ anyOrder: ['A', 'B'] }];
		const events = [mk('A', T), mk('A', T + 10 * MIN), mk('B', T + 20 * MIN)];
		const r = evaluateFunnel(events, STEPS2, WINDOW);
		// hand-traced: A@T seals slot A (eligible per history.cpp:951-957); the
		// second A cannot re-record. B completes. Position 0 time is T, NOT
		// T+10min — a latest-match overwrite would report T+10min.
		expect(r.completed).toBe(true);
		expect(r.stepTimes).toEqual([T, T + 20 * MIN]);
	});

	test('window-refused advance still seals the slot (first-match, no un-record)', () => {
		const STEPS2 = [{ anyOrder: ['A', 'B'] }];
		const events = [mk('A', T), mk('B', T + 2 * HOUR), mk('B', T + 2 * HOUR + 10 * MIN)];
		const r = evaluateFunnel(events, STEPS2, WINDOW);
		// hand-traced: B@+2h records slot B (can_record checks eligibility, not
		// the window) but the direct advance fails the 1h window
		// (history.cpp:497-507) — recorded, consumed, no advance. The second B
		// finds slot B eligible → refused. Funnel stuck at position 0.
		expect(r.completed).toBe(false);
		expect(r.reached).toBe(0);
		expect(r.stepTimes).toEqual([T]);
	});
});

describe('mixed anchors and chunks', () => {
	test('[A, {B,C}]: chunk fills in arrival order after the anchor', () => {
		const events = [mk('A', T), mk('C', T + 10 * MIN), mk('B', T + 20 * MIN)];
		const r = evaluateFunnel(events, ['A', { anyOrder: ['B', 'C'] }], WINDOW);
		expect(r.completed).toBe(true);
		expect(r.stepTimes).toEqual([T, T + 10 * MIN, T + 20 * MIN]);
		expect(r.stepEvents.map(e => e.event)).toEqual(['A', 'C', 'B']);
	});

	test('stale pre-anchor buffers do not satisfy the chunk; fresh events re-record', () => {
		const events = [
			mk('B', T),               // buffered while unstarted (reached -1)
			mk('B', T + 10 * MIN),    // latest-match overwrite in the buffer
			mk('A', T + 20 * MIN),    // anchor crosses — buffered B@+10m is BEFORE it
			mk('C', T + 30 * MIN),
			mk('B', T + 40 * MIN),    // fresh post-anchor B re-records the stale slot
		];
		const r = evaluateFunnel(events, ['A', { anyOrder: ['B', 'C'] }], WINDOW);
		// hand-traced: at A's cascade the chunk loop finds B@+10m NOT after the
		// anchor time (timestamp_comes_after(+10m, +20m) fails) → missing →
		// no claim (history.cpp:559-587). C then advances position 1; the
		// stale B slot is NOT eligible (its time predates the previous anchor,
		// history.cpp:951-955) so B@+40m re-records it and completes.
		expect(r.completed).toBe(true);
		expect(r.stepTimes).toEqual([T + 20 * MIN, T + 30 * MIN, T + 40 * MIN]);
	});

	test('2s grace lets a just-before-anchor buffer be claimed at the crossing', () => {
		const events = [
			mk('B', T),          // 1000ms before the anchor — inside the 2s grace
			mk('C', T + 500),
			mk('A', T + 1000),
		];
		const r = evaluateFunnel(events, ['A', { anyOrder: ['B', 'C'] }], WINDOW);
		// hand-traced: cascade at A claims B (timestamp_comes_after(T, T+1000)
		// true within 2s grace) and C — full chunk → completed. Positions
		// carry the claim order (slot order), so stepTimes are NOT monotonic.
		expect(r.completed).toBe(true);
		expect(r.stepTimes).toEqual([T + 1000, T, T + 500]);
	});

	test('partial chunk claim: cascade claims present members and stops at the gap', () => {
		const events = [mk('B', T), mk('A', T + 1000)];
		const r = evaluateFunnel(events, ['A', { anyOrder: ['B', 'C'] }, 'D'], WINDOW);
		// hand-traced: A's cascade claims buffered B via the 2s grace, C is
		// missing → chunk partially claimed, D not crossed (history.cpp:585-587
		// breaks without advancing past the chunk).
		expect(r.completed).toBe(false);
		expect(r.reached).toBe(1);
		expect(r.stepTimes).toEqual([T + 1000, T]);
	});

	test('buffered future anchor is only credited with a post-chunk timestamp', () => {
		const events = [
			mk('A', T),
			mk('B', T + 10 * MIN),
			mk('D', T + 20 * MIN),  // buffered — chunk not complete yet
			mk('C', T + 30 * MIN),  // chunk completes AFTER the buffered D
			mk('D', T + 40 * MIN),  // fresh D converts
		];
		const r = evaluateFunnel(events, ['A', { anyOrder: ['B', 'C'] }, 'D'], WINDOW);
		// hand-traced: C's cascade finds D@+20m NOT after the chunk-completion
		// time +30m → refused; the later D@+40m records latest and converts.
		// Position 3 time must be +40m, not the buffered +20m.
		expect(r.completed).toBe(true);
		expect(r.stepTimes).toEqual([T, T + 10 * MIN, T + 30 * MIN, T + 40 * MIN]);
	});
});

describe('exclusions across any-order positions', () => {
	test('exclusion in the open gap between chunk positions terminates', () => {
		const events = [mk('A', T), mk('B', T + 10 * MIN), mk('X', T + 15 * MIN), mk('C', T + 20 * MIN)];
		const r = evaluateFunnel(events, ['A', { anyOrder: ['B', 'C'] }], {
			...WINDOW,
			exclusionSteps: [{ event: 'X', afterStep: 1, beforeStep: 2 }],
		});
		// hand-traced: positions 0 (A) and 1 (B) filled; X lands in open gap 1
		// (reached === g, within window, after position 1) → DISQUALIFY-and-
		// freeze. Gap indexes are POSITION-based, valid under any-order paths.
		expect(r.terminatedByExclusion).toBe(true);
		expect(r.reached).toBe(1);
		expect(r.excludedAtStep).toBe(2);
	});

	test('exclusion scoped to an already-closed gap is ignored', () => {
		const events = [mk('A', T), mk('B', T + 10 * MIN), mk('X', T + 15 * MIN), mk('C', T + 20 * MIN)];
		const r = evaluateFunnel(events, ['A', { anyOrder: ['B', 'C'] }], {
			...WINDOW,
			exclusionSteps: [{ event: 'X', afterStep: 0, beforeStep: 1 }],
		});
		// hand-traced: gap 0 closed >2s before X (position 1 at +10m) —
		// history_record_exclusion_step skips it → conversion survives.
		expect(r.terminatedByExclusion).toBe(false);
		expect(r.completed).toBe(true);
	});
});

describe('reentry and anchorRange with any-order blocks', () => {
	test('reentry: each completion restarts a fresh attempt', () => {
		const events = [mk('A', T), mk('B', T + 10 * MIN), mk('A', T + 20 * MIN), mk('B', T + 30 * MIN)];
		const attempts = evaluateFunnel(events, [{ anyOrder: ['A', 'B'] }], {
			...WINDOW, reentry: true, countMode: 'totals',
		});
		expect(attempts.length).toBe(2);
		expect(attempts.map(a => a.completed)).toEqual([true, true]);
		expect(attempts[0].stepTimes).toEqual([T, T + 10 * MIN]);
		expect(attempts[1].stepTimes).toEqual([T + 20 * MIN, T + 30 * MIN]);
	});

	test('anchorRange: pre-range event cannot buffer/seal a first-chunk slot', () => {
		const events = [
			mk('A', T - 10 * MIN),  // before the interval — must not record ANY slot
			mk('B', T + 10 * MIN),
			mk('A', T + 20 * MIN),
		];
		const r = evaluateFunnel(events, [{ anyOrder: ['A', 'B'] }], {
			...WINDOW,
			anchorRange: { fromMs: T, toMs: T + 86400_000 },
		});
		// hand-traced: ARB drops all positive records while the funnel is
		// unstarted and the event is outside the interval (history.cpp:436-440).
		// Had the pre-range A recorded, first-match would seal slot A and the
		// in-range A@+20m could never fill position 1.
		expect(r.completed).toBe(true);
		expect(r.stepTimes).toEqual([T + 10 * MIN, T + 20 * MIN]);
	});
});

describe('guards and the deprecated alias', () => {
	test('evaluateFunnelHPC refuses an anyOrder block at step 0', () => {
		expect(() => evaluateFunnelHPC([mk('A', T)], [{ anyOrder: ['A', 'B'] }, 'C'], 'plan'))
			.toThrow(/anyOrder block cannot be the first funnel step/);
	});

	test('evaluateFunnelHPC accepts a non-leading anyOrder block', () => {
		const events = [mk('C', T, { plan: 'pro' }), mk('A', T + MIN, { plan: 'pro' }), mk('B', T + 2 * MIN, { plan: 'pro' })];
		const out = evaluateFunnelHPC(events, ['C', { anyOrder: ['A', 'B'] }], 'plan', WINDOW);
		expect(out.get('pro').completed).toBe(true);
	});

	test('evaluateAnyOrderCompletion (deprecated) still answers set membership', () => {
		const r = evaluateAnyOrderCompletion([mk('B', T), mk('A', T + 10 * MIN)], ['A', 'B']);
		expect(r.completed).toBe(true);
		expect(r.completionTimeMs).toBe(10 * MIN);
	});
});
