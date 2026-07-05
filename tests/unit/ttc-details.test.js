//@ts-nocheck
/**
 * P1.6.7 unit tests: TTC details — ARB-aligned funnel time-to-convert.
 *
 * Rules under test (expected values hand-computed from the ARB source, never
 * from running this implementation):
 *   - Per-gap deltas are INTEGER SECONDS, clamped to 0 per gap when
 *     timestamps are non-increasing (`delta = t <= prev ? 0 : (t - prev)/1000`
 *     in int arithmetic — funnel_query.cpp:3374), recorded for every attempt
 *     with reached >= 1, converted or not (:3359 loops `i <= reached`).
 *   - The cumulative track sums the CLAMPED deltas
 *     (`time_from_start += delta`, :3375) — sum-of-floors, NOT
 *     floor-of-difference; the two diverge with fractional-second gaps and
 *     with non-monotonic any-order position times.
 *   - `$ttc` is defined ONLY on full conversion (history.cpp:914-922) and its
 *     end time is history_get_last_time = MAX over the slot array (:843-847),
 *     not the last position — grace-claimed chunks can leave the last
 *     position holding an EARLIER time than a mid-funnel slot.
 */

import { describe, test, expect } from 'vitest';
import { evaluateFunnel } from '../../lib/verify/funnel-engine.js';
import { emulateBreakdown } from '../../lib/verify/emulate-breakdown.js';

const T = Date.UTC(2024, 0, 15);
const SEC = 1000;
const MIN = 60_000;
const HOUR = 3600_000;
const mk = (event, tMs, uid = 'u1') => ({ event, time: tMs, user_id: uid });
const WINDOW = { conversionWindowMs: HOUR };

describe('engine TTC fields (funnel_query.cpp:3355-3380, history.cpp:898-924)', () => {
	test('per-gap floor seconds; cumulative is sum-of-floors, $ttc floors the full span', () => {
		// gaps 1500ms and 1600ms: floor each → [1, 1], cumulative [1, 2].
		// $ttc spans 3100ms → floor 3 ≠ cumulative tail 2 (sum-of-floors).
		const events = [mk('A', T), mk('B', T + 1500), mk('C', T + 3100)];
		const r = evaluateFunnel(events, ['A', 'B', 'C'], WINDOW);
		expect(r.completed).toBe(true);
		expect(r.gapSeconds).toEqual([1, 1]);
		expect(r.gapSecondsFromStart).toEqual([1, 2]);
		expect(r.ttcMs).toBe(3100);
		expect(r.ttcSeconds).toBe(3);
	});

	test('non-increasing position times clamp to 0 per gap; $ttc uses MAX over slots', () => {
		// P1.6.6 grace-claim fixture: [A, {B,C}] with B@T, C@T+500, A@T+1000 →
		// positions [T+1000, T, T+500] (cascade claims the chunk in slot order).
		// Hand-computed per funnel_query.cpp:3374: gap 1 = T - (T+1000) ≤ 0 → 0;
		// gap 2 = 500ms → floor 0. $ttc end = max slot time = T+1000 = position
		// 0's own time → ttc 0. The pre-P1.6.7 position-based ttcMs was -500
		// here (nonsense Mixpanel never reports).
		const events = [mk('B', T), mk('C', T + 500), mk('A', T + 1000)];
		const r = evaluateFunnel(events, ['A', { anyOrder: ['B', 'C'] }], WINDOW);
		expect(r.completed).toBe(true);
		expect(r.stepTimes).toEqual([T + 1000, T, T + 500]);
		expect(r.gapSeconds).toEqual([0, 0]);
		expect(r.gapSecondsFromStart).toEqual([0, 0]);
		expect(r.ttcMs).toBe(0);
		expect(r.ttcSeconds).toBe(0);
	});

	test('$ttc end time can come from a MID position (history_get_last_time)', () => {
		// [{B,C}, A]: B@T, A@T+1000 (buffered anchor), C@T+1500 completes the
		// chunk; cascade claims A within the 2s grace
		// (timestamp_comes_after(T+1000, T+1500)). Positions
		// [T, T+1500, T+1000] — the LAST position holds T+1000 but the max
		// slot time is T+1500 (position 1). $ttc = (T+1500) - T = 1500ms →
		// 1 second. A last-position implementation would report 1000ms.
		const events = [mk('B', T), mk('A', T + 1000), mk('C', T + 1500)];
		const r = evaluateFunnel(events, [{ anyOrder: ['B', 'C'] }, 'A'], WINDOW);
		expect(r.completed).toBe(true);
		expect(r.stepTimes).toEqual([T, T + 1500, T + 1000]);
		expect(r.ttcMs).toBe(1500);
		expect(r.ttcSeconds).toBe(1);
		// gaps: pos1 - pos0 = 1500ms → 1; pos2 - pos1 = -500 → clamp 0.
		expect(r.gapSeconds).toEqual([1, 0]);
		expect(r.gapSecondsFromStart).toEqual([1, 1]);
	});

	test('incomplete attempt still records reached gaps; $ttc stays null', () => {
		const events = [mk('A', T), mk('B', T + 90 * SEC)];
		const r = evaluateFunnel(events, ['A', 'B', 'C'], WINDOW);
		expect(r.completed).toBe(false);
		expect(r.reached).toBe(1);
		expect(r.gapSeconds).toEqual([90]);
		expect(r.gapSecondsFromStart).toEqual([90]);
		expect(r.ttcMs).toBe(null);
		expect(r.ttcSeconds).toBe(null);
	});

	test('unstarted attempt: empty gap arrays, null $ttc', () => {
		const r = evaluateFunnel([mk('B', T)], ['A', 'B'], WINDOW);
		expect(r.reached).toBe(-1);
		expect(r.gapSeconds).toEqual([]);
		expect(r.gapSecondsFromStart).toEqual([]);
		expect(r.ttcSeconds).toBe(null);
	});

	test('completed single-step funnel: $ttc = 0 (last == step 0), not null', () => {
		// history.cpp:914-918 with num_steps 1: reached == 0 == num_steps-1 →
		// $ttc = last - t0 = 0.
		const r = evaluateFunnel([mk('A', T)], ['A']);
		expect(r.completed).toBe(true);
		expect(r.ttcMs).toBe(0);
		expect(r.ttcSeconds).toBe(0);
		expect(r.gapSeconds).toEqual([]);
	});
});

describe('timeToConvert multi-step (emulateBreakdown)', () => {
	test('gap/cumulative averages use per-position denominators (drop-offs included)', () => {
		const events = [
			// u1 converts: gaps [60, 60], cumulative [60, 120].
			mk('A', T, 'u1'), mk('B', T + 60 * SEC, 'u1'), mk('C', T + 120 * SEC, 'u1'),
			// u2 drops off after B: gap [30] recorded (funnel_query.cpp:3359
			// aggregates every history), never converts.
			mk('A', T, 'u2'), mk('B', T + 30 * SEC, 'u2'),
			// u3 never anchors (no A) — contributes nothing.
			mk('B', T, 'u3'),
		];
		const rows = emulateBreakdown(events, {
			type: 'timeToConvert',
			steps: ['A', 'B', 'C'],
			conversionWindowMs: HOUR,
		});
		expect(rows.length).toBe(1);
		const row = rows[0];
		// hand-computed: counts[0]=2 (u1,u2), counts[1]=2, counts[2]=1 (u1).
		expect(row.step_counts).toEqual([2, 2, 1]);
		// gap 1: (60+30)/2 = 45; gap 2: 60/1 = 60.
		expect(row.gap_avg_s).toEqual([45, 60]);
		// cumulative: (60+30)/2 = 45; 120/1 = 120.
		expect(row.cumulative_avg_s).toEqual([45, 120]);
		// converted-user stats: u1 only.
		expect(row.user_count).toBe(1);
		expect(row.avg_ttc_ms).toBe(120 * SEC);
		expect(row.avg_ttc_s).toBe(120);
	});

	test('pair sugar unchanged, rows gain the new fields', () => {
		const events = [mk('A', T, 'u1'), mk('B', T + 90 * SEC + 500, 'u1')];
		const rows = emulateBreakdown(events, {
			type: 'timeToConvert',
			fromEvent: 'A',
			toEvent: 'B',
			conversionWindowMs: HOUR,
		});
		expect(rows.length).toBe(1);
		expect(rows[0].avg_ttc_ms).toBe(90 * SEC + 500);
		// $ttc floors per user BEFORE averaging: floor(90.5) = 90.
		expect(rows[0].avg_ttc_s).toBe(90);
		expect(rows[0].step_counts).toEqual([1, 1]);
		expect(rows[0].gap_avg_s).toEqual([90]);
		expect(rows[0].cumulative_avg_s).toEqual([90]);
	});

	test('segments with zero conversions emit no row (converted-users report)', () => {
		const events = [
			mk('A', T, 'u1'), mk('B', T + 60 * SEC, 'u1'), mk('C', T + 120 * SEC, 'u1'),
			mk('A', T, 'u2'), mk('B', T + 30 * SEC, 'u2'), // free user drops off
		];
		const rows = emulateBreakdown(events, {
			type: 'timeToConvert',
			steps: ['A', 'B', 'C'],
			conversionWindowMs: HOUR,
			breakdownByUserProperty: 'plan',
			profiles: [
				{ distinct_id: 'u1', plan: 'pro' },
				{ distinct_id: 'u2', plan: 'free' },
			],
		});
		expect(rows.map(r => r.segment_value)).toEqual(['pro']);
		// u2 sits in the 'free' bucket — its drop-off gap must NOT leak into
		// the pro denominators.
		expect(rows[0].step_counts).toEqual([1, 1, 1]);
		expect(rows[0].gap_avg_s).toEqual([60, 60]);
	});

	test('steps[] composes with funnelOrder (last-fixed → anyOrder block)', () => {
		// last-fixed maps steps to [{ anyOrder: [A, B] }, L] (P1.6.6). Scrambled
		// block then anchor: B@T fills position 0, A@+60s position 1, L@+120s
		// crosses → gaps [60, 60], ttc 120s.
		const events = [mk('B', T, 'u1'), mk('A', T + 60 * SEC, 'u1'), mk('L', T + 120 * SEC, 'u1')];
		const rows = emulateBreakdown(events, {
			type: 'timeToConvert',
			steps: ['A', 'B', 'L'],
			funnelOrder: 'last-fixed',
			conversionWindowMs: HOUR,
		});
		expect(rows.length).toBe(1);
		expect(rows[0].avg_ttc_s).toBe(120);
		expect(rows[0].gap_avg_s).toEqual([60, 60]);
	});

	test('middle-fixed (set-membership partial) keeps informational TTC, no gap data', () => {
		// middle-fixed never routes through the engine (P1.6.6) — its result
		// carries completionTimeMs only. Row falls back to floor(ttcMs/1000);
		// step_counts stay 0 and gap averages null.
		const events = [mk('B', T, 'u1'), mk('A', T + 90 * SEC + 500, 'u1')];
		const rows = emulateBreakdown(events, {
			type: 'timeToConvert',
			steps: ['A', 'B'],
			funnelOrder: 'middle-fixed',
			conversionWindowMs: HOUR,
		});
		expect(rows.length).toBe(1);
		expect(rows[0].avg_ttc_ms).toBe(90 * SEC + 500);
		expect(rows[0].avg_ttc_s).toBe(90);
		expect(rows[0].step_counts).toEqual([0, 0]);
		expect(rows[0].gap_avg_s).toEqual([null]);
		expect(rows[0].cumulative_avg_s).toEqual([null]);
	});

	test('validation: steps+pair rejected; short steps rejected', () => {
		const events = [mk('A', T, 'u1')];
		expect(() => emulateBreakdown(events, {
			type: 'timeToConvert', steps: ['A', 'B'], fromEvent: 'A', toEvent: 'B',
		})).toThrow(/not both/);
		expect(() => emulateBreakdown(events, {
			type: 'timeToConvert', steps: ['A'],
		})).toThrow(/at least 2/);
	});
});
