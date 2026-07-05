//@ts-nocheck
/**
 * P1.9 unit tests: extractFlows — the per-user flows state machine.
 *
 * Every expected value below is hand-computed from the ARB flows rules — NOT
 * derived from running the implementation:
 *   - next-anchor-only matching (flows_query.cpp:988-994)
 *   - reverse rings keep the LAST N; capacity-0 buffers accept nothing
 *     (flows.cpp:575-600); forward buffers keep the FIRST N
 *   - a full forward buffer hands the active pointer to the next anchor's
 *     reverse ring (flows.cpp:936-943)
 *   - hidden/visible filters bind non-anchor steps only; anchor names are
 *     stripped from hidden, hidden from visible (query/flows.go
 *     filterAnchorEventNames / filteredVisibleEventSelectors)
 *   - collapseRepeated compares against the last ADDED step, anchors
 *     included; anchors themselves never collapse (flows.cpp:849-943)
 *   - capacity-slotted step numbering under LEFT + FUNNEL defaults:
 *     slot(i) = Σ_{j<=i} revCap[j] + Σ_{j<i} fwdCap[j] + i; forward steps
 *     contiguous after the anchor, reverse steps flush against the slot
 *     (flows.cpp:943-1146; flows_query.cpp:664-668; request_params.proto FUNNEL=0)
 *   - converted requires >1 anchors, all reached (flows.cpp:841-847);
 *     $ttc = last reached anchor - first anchor (flows.cpp:828-839)
 *   - end-of-data flushes partial flows; zero-anchor users contribute
 *     nothing (flows_query.cpp:1369-1374, :844-848)
 *   - sessions countType: one flow universe per session, boundaries from the
 *     FULL stream (flows_query.cpp:1156-1161); 'general' ≡ 'unique' for pure
 *     flows (flows.cpp:790-801 — funnel_end always false, no restart)
 */

import { describe, test, expect } from 'vitest';
import { extractFlows } from '../../lib/verify/flows.js';
import { buildIdentityMap } from '../../lib/verify/identity.js';

const T = Date.UTC(2024, 0, 15, 10, 0); // 2024-01-15T10:00:00Z
const MIN = 60_000;
const mk = (event, tMs, uid = 'u1', props = {}) => ({ event, time: tMs, user_id: uid, ...props });

describe('extractFlows — buffers and step numbering', () => {
	test('single anchor, defaults (forward 4, reverse 0): pre-anchor events drop, forward steps follow', () => {
		// B hits the capacity-0 reverse[0] ring → dropped. A anchors at slot 0
		// (rev cap 0), C and D fill forward slots 1 and 2.
		const events = [mk('B', T), mk('A', T + 1 * MIN), mk('C', T + 2 * MIN), mk('D', T + 3 * MIN)];
		const flows = extractFlows(events, { anchors: ['A'] });
		expect(flows).toEqual([{
			userId: 'u1',
			steps: [
				{ label: 'A', timeMs: T + 1 * MIN, stepNumber: 0, isAnchor: true, anchorIndex: 0 },
				{ label: 'C', timeMs: T + 2 * MIN, stepNumber: 1, isAnchor: false },
				{ label: 'D', timeMs: T + 3 * MIN, stepNumber: 2, isAnchor: false },
			],
			reachedAnchor: 0,
			converted: false, // single-anchor flows are NEVER converted (flows.cpp:841-847)
			ttcMs: 0,
		}]);
	});

	test('forward buffer keeps the FIRST N (linear, fills then rejects)', () => {
		const events = [mk('A', T), mk('x1', T + 1 * MIN), mk('x2', T + 2 * MIN), mk('x3', T + 3 * MIN)];
		const flows = extractFlows(events, { anchors: ['A'], forward: 2 });
		expect(flows[0].steps.map(s => [s.label, s.stepNumber])).toEqual([
			['A', 0], ['x1', 1], ['x2', 2],
		]);
	});

	test('reverse ring keeps the LAST N; slots pack flush against the anchor', () => {
		// forward [1,0], reverse [0,2]: x1 fills forward[0] (switch to
		// reverse[1] ring), x2/x3/x4 cycle the cap-2 ring → keeps x3, x4.
		// Slots: anchor0 = 0, anchor1 = 0+2 + 1 + 1 = 4; ring at 2,3.
		const events = [
			mk('A', T), mk('x1', T + 1 * MIN), mk('x2', T + 2 * MIN),
			mk('x3', T + 3 * MIN), mk('x4', T + 4 * MIN), mk('B', T + 5 * MIN),
		];
		const flows = extractFlows(events, { anchors: ['A', 'B'], forward: [1, 0], reverse: [0, 2] });
		expect(flows).toEqual([{
			userId: 'u1',
			steps: [
				{ label: 'A', timeMs: T, stepNumber: 0, isAnchor: true, anchorIndex: 0 },
				{ label: 'x1', timeMs: T + 1 * MIN, stepNumber: 1, isAnchor: false },
				{ label: 'x3', timeMs: T + 3 * MIN, stepNumber: 2, isAnchor: false },
				{ label: 'x4', timeMs: T + 4 * MIN, stepNumber: 3, isAnchor: false },
				{ label: 'B', timeMs: T + 5 * MIN, stepNumber: 4, isAnchor: true, anchorIndex: 1 },
			],
			reachedAnchor: 1,
			converted: true,
			ttcMs: 5 * MIN,
		}]);
	});

	test('capacity-slotted numbering: partial 3-anchor flow leaves anchor slots fixed', () => {
		// Defaults fwd 4 / rev 0 per anchor: slot(0)=0, slot(1)=4+1=5,
		// slot(2)=8+2=10. Reaching only A and B still numbers B at 5 (NOT 1).
		const events = [mk('A', T), mk('B', T + 10 * MIN)];
		const flows = extractFlows(events, { anchors: ['A', 'B', 'C'] });
		expect(flows[0].steps.map(s => [s.label, s.stepNumber])).toEqual([['A', 0], ['B', 5]]);
		expect(flows[0].converted).toBe(false); // needs all 3 anchors
		expect(flows[0].ttcMs).toBe(10 * MIN);
	});

	test('trailing reverse ring of the never-reached next anchor is emitted', () => {
		// forward [1,4], reverse [0,2]: x1 fills forward[0] → active =
		// reverse[1]; x2/x3 wait in the ring for a B that never comes.
		// slot(1) = (0+2) + 1 + 1 = 4 → ring emits at 2,3.
		const events = [mk('A', T), mk('x1', T + 1 * MIN), mk('x2', T + 2 * MIN), mk('x3', T + 3 * MIN)];
		const flows = extractFlows(events, { anchors: ['A', 'B'], forward: [1, 4], reverse: [0, 2] });
		expect(flows[0].steps.map(s => [s.label, s.stepNumber])).toEqual([
			['A', 0], ['x1', 1], ['x2', 2], ['x3', 3],
		]);
		expect(flows[0].reachedAnchor).toBe(0);
		expect(flows[0].converted).toBe(false);
	});
});

describe('extractFlows — anchor matching', () => {
	test('next-anchor-only: an out-of-order B never anchors; zero-anchor users contribute nothing', () => {
		// u1 fires only B → tested against anchor A only → no flow at all.
		// u2's leading B likewise drops (capacity-0 reverse[0]).
		const events = [
			mk('B', T, 'u1'),
			mk('B', T, 'u2'), mk('A', T + 1 * MIN, 'u2'), mk('B', T + 2 * MIN, 'u2'),
		];
		const flows = extractFlows(events, { anchors: ['A', 'B'] });
		expect(flows).toEqual([{
			userId: 'u2',
			steps: [
				{ label: 'A', timeMs: T + 1 * MIN, stepNumber: 0, isAnchor: true, anchorIndex: 0 },
				{ label: 'B', timeMs: T + 2 * MIN, stepNumber: 5, isAnchor: true, anchorIndex: 1 },
			],
			reachedAnchor: 1,
			converted: true,
			ttcMs: 1 * MIN,
		}]);
	});

	test('anchor where filter: non-matching occurrence falls through as a NON-anchor step', () => {
		// Buy(basic) fails the anchor filter → regular event → capacity-0
		// reverse[0] drops it. Buy(pro) anchors.
		const events = [
			mk('Buy', T, 'u1', { plan: 'basic' }),
			mk('Buy', T + 1 * MIN, 'u1', { plan: 'pro' }),
			mk('x', T + 2 * MIN, 'u1'),
		];
		const flows = extractFlows(events, { anchors: [{ event: 'Buy', where: { plan: 'pro' } }] });
		expect(flows[0].steps.map(s => [s.label, s.stepNumber, s.isAnchor])).toEqual([
			['Buy', 0, true], ['x', 1, false],
		]);
		expect(flows[0].steps[0].timeMs).toBe(T + 1 * MIN);
	});

	test('where-failing LATER anchor lands in the forward buffer, then the real one anchors', () => {
		const events = [
			mk('A', T),
			mk('B', T + 1 * MIN, 'u1', { ok: false }),
			mk('B', T + 2 * MIN, 'u1', { ok: true }),
		];
		const flows = extractFlows(events, { anchors: ['A', { event: 'B', where: { ok: true } }] });
		// slots: anchor0 = 0 (fwd 4 follows at 1..4), anchor1 = 4 + 1 = 5
		expect(flows[0].steps.map(s => [s.label, s.stepNumber, s.isAnchor])).toEqual([
			['A', 0, true], ['B', 1, false], ['B', 5, true],
		]);
		expect(flows[0].converted).toBe(true);
		expect(flows[0].ttcMs).toBe(2 * MIN);
	});
});

describe('extractFlows — hidden/visible/collapse', () => {
	test('hiddenEvents drop non-anchor steps; anchor names are exempt', () => {
		// hidden ['x','A'] → 'A' stripped (filterAnchorEventNames): the second
		// A (a non-anchor repeat) still appears.
		const events = [mk('A', T), mk('x', T + 1 * MIN), mk('A', T + 2 * MIN), mk('y', T + 3 * MIN)];
		const flows = extractFlows(events, { anchors: ['A'], hiddenEvents: ['x', 'A'] });
		expect(flows[0].steps.map(s => [s.label, s.stepNumber, s.isAnchor])).toEqual([
			['A', 0, true], ['A', 1, false], ['y', 2, false],
		]);
	});

	test('visibleEvents is a non-anchor allow-list; hidden wins over visible', () => {
		// visible ['y','x'] minus hidden ['x'] → {'y'}: x hidden, z not visible.
		const events = [mk('A', T), mk('x', T + 1 * MIN), mk('y', T + 2 * MIN), mk('z', T + 3 * MIN)];
		const flows = extractFlows(events, {
			anchors: ['A'], visibleEvents: ['y', 'x'], hiddenEvents: ['x'],
		});
		expect(flows[0].steps.map(s => s.label)).toEqual(['A', 'y']);
	});

	test('collapseRepeated suppresses consecutive repeats only; non-adjacent repeats stay', () => {
		const events = [
			mk('A', T), mk('x', T + 1 * MIN), mk('x', T + 2 * MIN),
			mk('y', T + 3 * MIN), mk('x', T + 4 * MIN),
		];
		const flows = extractFlows(events, { anchors: ['A'], collapseRepeated: true });
		expect(flows[0].steps.map(s => [s.label, s.stepNumber])).toEqual([
			['A', 0], ['x', 1], ['y', 2], ['x', 3],
		]);
	});

	test('collapseRepeated compares against the last ADDED step — anchors included', () => {
		// Second A is a non-anchor whose label equals the last added step (the
		// anchor) → suppressed under collapse, kept without.
		const events = [mk('A', T), mk('A', T + 1 * MIN), mk('x', T + 2 * MIN)];
		const collapsed = extractFlows(events, { anchors: ['A'], collapseRepeated: true });
		expect(collapsed[0].steps.map(s => s.label)).toEqual(['A', 'x']);
		const plain = extractFlows(events, { anchors: ['A'] });
		expect(plain[0].steps.map(s => s.label)).toEqual(['A', 'A', 'x']);
	});

	test('collapse is segment-aware: same event, different breakdown values do NOT collapse', () => {
		// flow_is_step_repeated compares every segment value (flows.cpp:849-876).
		const events = [
			mk('A', T, 'u1', { p: 'z' }),
			mk('x', T + 1 * MIN, 'u1', { p: 1 }),
			mk('x', T + 2 * MIN, 'u1', { p: 2 }),
			mk('x', T + 3 * MIN, 'u1', { p: 2 }),
		];
		const flows = extractFlows(events, {
			anchors: ['A'], breakdownProperty: 'p', collapseRepeated: true,
		});
		expect(flows[0].steps).toEqual([
			{ label: 'A', timeMs: T, stepNumber: 0, isAnchor: true, anchorIndex: 0, value: 'z' },
			{ label: 'x', timeMs: T + 1 * MIN, stepNumber: 1, isAnchor: false, value: '1' },
			{ label: 'x', timeMs: T + 2 * MIN, stepNumber: 2, isAnchor: false, value: '2' },
		]);
	});
});

describe('extractFlows — count types', () => {
	test("'general' ≡ 'unique' for pure flows (no funnel end → no restart)", () => {
		// Second A is a forward step, not a new flow, in BOTH modes.
		const events = [mk('A', T), mk('x', T + 1 * MIN), mk('A', T + 2 * MIN)];
		const unique = extractFlows(events, { anchors: ['A'], countType: 'unique' });
		const general = extractFlows(events, { anchors: ['A'], countType: 'general' });
		expect(unique[0].steps.map(s => s.label)).toEqual(['A', 'x', 'A']);
		expect(general).toEqual(unique);
	});

	test("'sessions': one flow universe per session; 'unique' spans the gap", () => {
		// 55-min gap (10:05 → 11:00) splits sessions at the 30-min default.
		const events = [
			mk('A', T), mk('x', T + 5 * MIN),
			mk('A', T + 60 * MIN), mk('x', T + 65 * MIN),
		];
		const sessions = extractFlows(events, { anchors: ['A'], countType: 'sessions' });
		expect(sessions.map(f => f.steps.map(s => [s.label, s.stepNumber]))).toEqual([
			[['A', 0], ['x', 1]],
			[['A', 0], ['x', 1]],
		]);
		expect(sessions.map(f => f.steps[0].timeMs)).toEqual([T, T + 60 * MIN]);
		const unique = extractFlows(events, { anchors: ['A'], countType: 'unique' });
		expect(unique).toHaveLength(1);
		expect(unique[0].steps.map(s => s.label)).toEqual(['A', 'x', 'A', 'x']);
	});

	test("'sessions': boundaries derive from the FULL stream, not the surviving steps", () => {
		// A@10:00, b@10:20, A@10:40 — 20-min gaps → ONE session even though b
		// is hidden. Deriving from the A-only subset (40-min gap) would wrongly
		// split into two flows.
		const events = [mk('A', T), mk('b', T + 20 * MIN), mk('A', T + 40 * MIN)];
		const flows = extractFlows(events, {
			anchors: ['A'], countType: 'sessions', hiddenEvents: ['b'],
		});
		expect(flows).toHaveLength(1);
		expect(flows[0].steps.map(s => [s.label, s.isAnchor])).toEqual([['A', true], ['A', false]]);
	});

	test('sessionTimeoutMs threads into session derivation', () => {
		// 15-min gap: one session at the default, two at a 10-min timeout.
		const events = [mk('A', T), mk('A', T + 15 * MIN)];
		expect(extractFlows(events, { anchors: ['A'], countType: 'sessions' })).toHaveLength(1);
		expect(extractFlows(events, {
			anchors: ['A'], countType: 'sessions', sessionTimeoutMs: 10 * MIN,
		})).toHaveLength(2);
	});
});

describe('extractFlows — identity and guards', () => {
	test('identityMap joins device events into the canonical user', () => {
		const events = [
			{ event: 'A', time: T, device_id: 'd1' },
			{ event: 'x', time: T + 1 * MIN, user_id: 'u9' },
		];
		const identityMap = buildIdentityMap([{ distinct_id: 'u9', device_ids: ['d1'] }]);
		const joined = extractFlows(events, { anchors: ['A'], identityMap });
		expect(joined).toHaveLength(1);
		expect(joined[0].userId).toBe('u9');
		expect(joined[0].steps.map(s => s.label)).toEqual(['A', 'x']);
		// Without the map the device is its OWN user (unmerged $device:
		// identity) and u9 never anchors → single one-step flow for d1.
		const unjoined = extractFlows(events, { anchors: ['A'] });
		expect(unjoined).toHaveLength(1);
		expect(unjoined[0].userId).toBe('d1');
		expect(unjoined[0].steps.map(s => s.label)).toEqual(['A']);
	});

	test('guards: anchors required; countType validated; per-anchor arrays must match', () => {
		expect(() => extractFlows([], {})).toThrow(/anchors/);
		expect(() => extractFlows([], { anchors: [] })).toThrow(/anchors/);
		expect(() => extractFlows([], { anchors: ['A'], countType: 'weird' })).toThrow(/countType/);
		expect(() => extractFlows([], { anchors: ['A', 'B'], forward: [1] })).toThrow(/forward array length/);
		expect(() => extractFlows([], { anchors: ['A'], reverse: -1 })).toThrow(/non-negative/);
		expect(extractFlows([], { anchors: ['A'] })).toEqual([]);
	});
});
