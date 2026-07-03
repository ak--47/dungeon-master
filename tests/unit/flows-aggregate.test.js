//@ts-nocheck
/**
 * P1.9 unit tests: aggregateFlows + the 'topPaths' emulateBreakdown type.
 *
 * Every expected value below is hand-computed from the ARB flows rules — NOT
 * derived from running the implementation:
 *   - prefix-tree counters: total_count on every node; converted_total_count
 *     on every node of a converted path; drop_off_total_count on the LAST
 *     node of EVERY flow, converted included (flows.cpp:207-311)
 *   - per-level totals sum total_count for a key across the WHOLE tree
 *     (flows_prefix_tree_calculate_counts, flows.cpp:1167-1187)
 *   - pruning keeps the top cardinalityThreshold keys per level; anchors are
 *     exempt; losers rename to $mp_uncommon_flows_events with segments
 *     CLEARED, same-key siblings merge counters and re-parent children
 *     (flows_prefix_tree_trim, flows.cpp:1189-1320)
 *   - thresholds default 50 (list, bookmark.py:96 maxResults) and 3 (sankey,
 *     bookmark.py:110 cardinality)
 *   - ARB breaks count ties by hash order (node_count_compare,
 *     flows.cpp:1329-1337); this emulator uses label-then-value ascending
 *     (codepoint order) for determinism — ties below are pinned to that.
 *
 * Path/edge bookkeeping (emulator output contract, not ARB counters):
 *   - list: one row per terminus node (dropoff > 0); count = dropoff;
 *     converted = converted flows ending exactly there
 *   - sankey: nodes coalesce per (level, label, value, type); edge count =
 *     flows traversing parent→child; from/to are INDICES into the sorted
 *     level arrays with explicit toLevel (edges may skip levels)
 */

import { describe, test, expect } from 'vitest';
import { emulateBreakdown } from '../../lib/verify/emulate-breakdown.js';
import { UNCOMMON_FLOWS_EVENT } from '../../lib/verify/flows.js';

const T = Date.UTC(2024, 0, 15, 10, 0); // 2024-01-15T10:00:00Z
const MIN = 60_000;
const mk = (event, tMs, uid = 'u1', props = {}) => ({ event, time: tMs, user_id: uid, ...props });

describe('topPaths — list output', () => {
	test('terminus rows: count = flows ENDING there; longer shared prefixes stay separate rows', () => {
		// Tree: Signup(4) → Browse(3) → Buy(2). Enders: u4@Signup,
		// u3@Browse, u1+u2@Buy → three rows. Count-1 tie between [Signup]
		// and [Signup,Browse] breaks on joined labels ascending ('Signup' is
		// a strict prefix → sorts first).
		const events = [
			mk('Signup', T, 'u1'), mk('Browse', T + 1 * MIN, 'u1'), mk('Buy', T + 2 * MIN, 'u1'),
			mk('Signup', T, 'u2'), mk('Browse', T + 1 * MIN, 'u2'), mk('Buy', T + 2 * MIN, 'u2'),
			mk('Signup', T, 'u3'), mk('Browse', T + 1 * MIN, 'u3'),
			mk('Signup', T, 'u4'),
		];
		const out = emulateBreakdown(events, { type: 'topPaths', anchors: ['Signup'], forward: 2 });
		expect(out).toEqual({
			paths: [
				{
					steps: [
						{ label: 'Signup', stepNumber: 0, isAnchor: true },
						{ label: 'Browse', stepNumber: 1, isAnchor: false },
						{ label: 'Buy', stepNumber: 2, isAnchor: false },
					],
					count: 2,
					converted: 0,
				},
				{
					steps: [{ label: 'Signup', stepNumber: 0, isAnchor: true }],
					count: 1,
					converted: 0,
				},
				{
					steps: [
						{ label: 'Signup', stepNumber: 0, isAnchor: true },
						{ label: 'Browse', stepNumber: 1, isAnchor: false },
					],
					count: 1,
					converted: 0,
				},
			],
			totalEntered: 4,
			// single-anchor flows are NEVER converted (flows.cpp:841-847)
			overallConversionRate: 0,
		});
	});

	test('converted counting: per-path converted survives; overall rate = converted flows / total', () => {
		// anchors A,B with forward 0 / reverse 0 → slots A@0, B@1.
		// u1 converts (A→B, ends at B); u2 stalls at A. drop_off stamps the
		// last node of BOTH flows — converted u1 included.
		const events = [
			mk('A', T, 'u1'), mk('B', T + 1 * MIN, 'u1'),
			mk('A', T, 'u2'),
		];
		const out = emulateBreakdown(events, {
			type: 'topPaths', anchors: ['A', 'B'], forward: 0, reverse: 0,
		});
		expect(out).toEqual({
			paths: [
				{ steps: [{ label: 'A', stepNumber: 0, isAnchor: true }], count: 1, converted: 0 },
				{
					steps: [
						{ label: 'A', stepNumber: 0, isAnchor: true },
						{ label: 'B', stepNumber: 1, isAnchor: true },
					],
					count: 1,
					converted: 1,
				},
			],
			totalEntered: 2,
			overallConversionRate: 0.5,
		});
	});

	test('pruning: below-threshold keys rename to $mp_uncommon_flows_events, counters merge', () => {
		// Level-1 totals: x=2, y=1. threshold 1 keeps x; y renames.
		const events = [
			mk('A', T, 'u1'), mk('x', T + 1 * MIN, 'u1'),
			mk('A', T, 'u2'), mk('x', T + 1 * MIN, 'u2'),
			mk('A', T, 'u3'), mk('y', T + 1 * MIN, 'u3'),
		];
		const out = emulateBreakdown(events, {
			type: 'topPaths', anchors: ['A'], forward: 1, cardinalityThreshold: 1,
		});
		expect(out.paths).toEqual([
			{
				steps: [
					{ label: 'A', stepNumber: 0, isAnchor: true },
					{ label: 'x', stepNumber: 1, isAnchor: false },
				],
				count: 2,
				converted: 0,
			},
			{
				steps: [
					{ label: 'A', stepNumber: 0, isAnchor: true },
					{ label: UNCOMMON_FLOWS_EVENT, stepNumber: 1, isAnchor: false },
				],
				count: 1,
				converted: 0,
			},
		]);
		expect(out.totalEntered).toBe(3);
	});

	test('anchors are exempt from pruning even at threshold 0', () => {
		// keep-set is empty at threshold 0: the anchor survives by type
		// (flows_prefix_node_merge_into_other anchor check), x renames.
		const events = [mk('A', T, 'u1'), mk('x', T + 1 * MIN, 'u1')];
		const out = emulateBreakdown(events, {
			type: 'topPaths', anchors: ['A'], forward: 1, cardinalityThreshold: 0,
		});
		expect(out.paths).toEqual([{
			steps: [
				{ label: 'A', stepNumber: 0, isAnchor: true },
				{ label: UNCOMMON_FLOWS_EVENT, stepNumber: 1, isAnchor: false },
			],
			count: 1,
			converted: 0,
		}]);
	});

	test('breakdown segments: identity includes the value; uncommon rename CLEARS it; value-asc tiebreak', () => {
		// x·'1' and x·'2' both total 1 at level 1. threshold 1 → tie breaks
		// label-then-VALUE ascending → x·'1' kept, x·'2' renames with its
		// segment cleared (flows_prefix_node_set_uncommon_event_step).
		// Path sort tie (both count 1) breaks on joined labels:
		// '$mp_uncommon…' < 'x' by codepoint → the uncommon path sorts first.
		const events = [
			mk('A', T, 'u1', { p: 'z' }), mk('x', T + 1 * MIN, 'u1', { p: 1 }),
			mk('A', T, 'u2', { p: 'z' }), mk('x', T + 1 * MIN, 'u2', { p: 2 }),
		];
		const out = emulateBreakdown(events, {
			type: 'topPaths', anchors: ['A'], forward: 1,
			breakdownProperty: 'p', cardinalityThreshold: 1,
		});
		expect(out.paths).toEqual([
			{
				steps: [
					{ label: 'A', stepNumber: 0, isAnchor: true, value: 'z' },
					{ label: UNCOMMON_FLOWS_EVENT, stepNumber: 1, isAnchor: false },
				],
				count: 1,
				converted: 0,
			},
			{
				steps: [
					{ label: 'A', stepNumber: 0, isAnchor: true, value: 'z' },
					{ label: 'x', stepNumber: 1, isAnchor: false, value: '1' },
				],
				count: 1,
				converted: 0,
			},
		]);
	});
});

describe('topPaths — sankey output', () => {
	test('levels hold coalesced nodes sorted count-desc; edges reference sorted indices', () => {
		const events = [
			mk('Signup', T, 'u1'), mk('Browse', T + 1 * MIN, 'u1'),
			mk('Signup', T, 'u2'), mk('Browse', T + 1 * MIN, 'u2'),
			mk('Signup', T, 'u3'), mk('Search', T + 1 * MIN, 'u3'),
			mk('Signup', T, 'u4'),
		];
		const out = emulateBreakdown(events, {
			type: 'topPaths', anchors: ['Signup'], forward: 1, output: 'sankey',
		});
		expect(out).toEqual({
			levels: [
				[{ label: 'Signup', isAnchor: true, count: 4, dropoff: 1, converted: 0 }],
				[
					{ label: 'Browse', isAnchor: false, count: 2, dropoff: 2, converted: 0 },
					{ label: 'Search', isAnchor: false, count: 1, dropoff: 1, converted: 0 },
				],
			],
			edges: [
				{ fromLevel: 0, from: 0, toLevel: 1, to: 0, count: 2 },
				{ fromLevel: 0, from: 0, toLevel: 1, to: 1, count: 1 },
			],
			totalEntered: 4,
			overallConversionRate: 0,
		});
	});

	test('sankey default threshold is 3 (bookmark.py:110): 4th key coalesces; count-desc label-asc order', () => {
		// Level-1 totals: x=3, y=2, z=2, w=1 → keep x,y,z; w → uncommon.
		// y/z tie at 2 → label ascending.
		const events = [
			mk('A', T, 'u1'), mk('x', T + 1 * MIN, 'u1'),
			mk('A', T, 'u2'), mk('x', T + 1 * MIN, 'u2'),
			mk('A', T, 'u3'), mk('x', T + 1 * MIN, 'u3'),
			mk('A', T, 'u4'), mk('y', T + 1 * MIN, 'u4'),
			mk('A', T, 'u5'), mk('y', T + 1 * MIN, 'u5'),
			mk('A', T, 'u6'), mk('z', T + 1 * MIN, 'u6'),
			mk('A', T, 'u7'), mk('z', T + 1 * MIN, 'u7'),
			mk('A', T, 'u8'), mk('w', T + 1 * MIN, 'u8'),
		];
		const out = emulateBreakdown(events, {
			type: 'topPaths', anchors: ['A'], forward: 1, output: 'sankey',
		});
		expect(out.levels).toEqual([
			[{ label: 'A', isAnchor: true, count: 8, dropoff: 0, converted: 0 }],
			[
				{ label: 'x', isAnchor: false, count: 3, dropoff: 3, converted: 0 },
				{ label: 'y', isAnchor: false, count: 2, dropoff: 2, converted: 0 },
				{ label: 'z', isAnchor: false, count: 2, dropoff: 2, converted: 0 },
				{ label: UNCOMMON_FLOWS_EVENT, isAnchor: false, count: 1, dropoff: 1, converted: 0 },
			],
		]);
		expect(out.edges).toEqual([
			{ fromLevel: 0, from: 0, toLevel: 1, to: 0, count: 3 },
			{ fromLevel: 0, from: 0, toLevel: 1, to: 1, count: 2 },
			{ fromLevel: 0, from: 0, toLevel: 1, to: 2, count: 2 },
			{ fromLevel: 0, from: 0, toLevel: 1, to: 3, count: 1 },
		]);
	});

	test('capacity slots leave sparse levels; edges skip them with explicit toLevel', () => {
		// anchors A,B with forward [0,0] / reverse [0,1] → slots A@0, ring@1,
		// B@2. u1's m rides B's reverse ring (A's forward cap is 0 → active
		// hands off immediately); u2 goes A→B directly, so its edge SKIPS
		// level 1. Both flows reach both anchors → converted, and both END at
		// B (dropoff 2 with converted still 2 — dropoff is not converted-gated).
		const events = [
			mk('A', T, 'u1'), mk('m', T + 1 * MIN, 'u1'), mk('B', T + 2 * MIN, 'u1'),
			mk('A', T, 'u2'), mk('B', T + 1 * MIN, 'u2'),
		];
		const out = emulateBreakdown(events, {
			type: 'topPaths', anchors: ['A', 'B'],
			forward: [0, 0], reverse: [0, 1], output: 'sankey',
		});
		expect(out).toEqual({
			levels: [
				[{ label: 'A', isAnchor: true, count: 2, dropoff: 0, converted: 2 }],
				[{ label: 'm', isAnchor: false, count: 1, dropoff: 0, converted: 1 }],
				[{ label: 'B', isAnchor: true, count: 2, dropoff: 2, converted: 2 }],
			],
			edges: [
				{ fromLevel: 0, from: 0, toLevel: 1, to: 0, count: 1 },
				{ fromLevel: 0, from: 0, toLevel: 2, to: 0, count: 1 },
				{ fromLevel: 1, from: 0, toLevel: 2, to: 0, count: 1 },
			],
			totalEntered: 2,
			overallConversionRate: 1,
		});
	});
});

describe('topPaths — identity and guards', () => {
	test('profiles thread the identity map through the dispatch', () => {
		// d1 (device-only) anchors, u9 continues. Joined → one flow [A, x].
		const events = [
			{ event: 'A', time: T, device_id: 'd1' },
			{ event: 'x', time: T + 1 * MIN, user_id: 'u9' },
		];
		const out = emulateBreakdown(events, {
			type: 'topPaths', anchors: ['A'],
			profiles: [{ distinct_id: 'u9', device_ids: ['d1'] }],
		});
		expect(out.paths).toEqual([{
			steps: [
				{ label: 'A', stepNumber: 0, isAnchor: true },
				{ label: 'x', stepNumber: 1, isAnchor: false },
			],
			count: 1,
			converted: 0,
		}]);
	});

	test('guards: output validated; threshold non-negative; no timeBucket composition; empty input', () => {
		expect(() => emulateBreakdown([], { type: 'topPaths', anchors: ['A'], output: 'nope' }))
			.toThrow(/output/);
		expect(() => emulateBreakdown([], { type: 'topPaths', anchors: ['A'], cardinalityThreshold: -1 }))
			.toThrow(/non-negative/);
		expect(() => emulateBreakdown([], { type: 'topPaths', anchors: ['A'], timeBucket: 'day' }))
			.toThrow(/timeBucket/);
		expect(emulateBreakdown([], { type: 'topPaths', anchors: ['A'] }))
			.toEqual({ paths: [], totalEntered: 0, overallConversionRate: 0 });
		expect(emulateBreakdown([], { type: 'topPaths', anchors: ['A'], output: 'sankey' }))
			.toEqual({ levels: [], edges: [], totalEntered: 0, overallConversionRate: 0 });
	});
});
