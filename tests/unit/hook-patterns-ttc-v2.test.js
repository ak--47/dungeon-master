//@ts-nocheck
/**
 * P2.4 applyTTCBySegmentV2 + applyTTCBySegment deprecation. Fixtures are
 * hand-built; expected timestamps derived by hand from the
 * findFirstSequence + scaleFunnelTTC contracts (offsets from the anchor
 * step multiply by the factor; anchor unchanged) — never from running the
 * implementation.
 */
import { describe, test, expect, vi, afterEach } from 'vitest';
import { applyTTCBySegment, applyTTCBySegmentV2 } from '../../lib/hook-patterns/index.js';

const T0 = Date.parse('2024-01-01T09:00:00Z');
const MIN = 60_000;
const mk = (event, ms, extra = {}) => ({ event, time: new Date(ms).toISOString(), ...extra });

// First greedy chain: a@T0 → b@T0+10min → c@T0+30min. The LATER a/b pair
// (T0+2h) must be ignored — Mixpanel's greedy engine reads the first chain.
const mkStream = () => [
	mk('step_a', T0, { insert_id: 'a1' }),
	mk('noise', T0 + 5 * MIN),
	mk('step_b', T0 + 10 * MIN, { insert_id: 'b1' }),
	mk('step_c', T0 + 30 * MIN, { insert_id: 'c1' }),
	mk('step_a', T0 + 120 * MIN, { insert_id: 'a2' }),
	mk('step_b', T0 + 125 * MIN, { insert_id: 'b2' }),
];

afterEach(() => vi.restoreAllMocks());

describe('applyTTCBySegmentV2 (everything hook, greedy first sequence)', () => {
	test('factor 0.5 halves offsets from the anchor; later occurrences untouched', () => {
		const events = mkStream();
		const r = applyTTCBySegmentV2(events, { tier: 'enterprise' }, {
			segmentKey: 'tier',
			factors: { enterprise: 0.5, free: 2 },
			steps: ['step_a', 'step_b', 'step_c'],
		});
		expect(r).toEqual({ segmentValue: 'enterprise', factor: 0.5, shifted: 2 });
		const at = id => Date.parse(events.find(e => e.insert_id === id).time);
		expect(at('a1')).toBe(T0); // anchor unchanged
		expect(at('b1')).toBe(T0 + 5 * MIN); // 10min × 0.5
		expect(at('c1')).toBe(T0 + 15 * MIN); // 30min × 0.5
		expect(at('a2')).toBe(T0 + 120 * MIN); // second chain untouched
		expect(at('b2')).toBe(T0 + 125 * MIN);
		expect(Date.parse(events[1].time)).toBe(T0 + 5 * MIN); // noise untouched
	});

	test('factor 2 doubles offsets', () => {
		const events = mkStream();
		const r = applyTTCBySegmentV2(events, { tier: 'free' }, {
			segmentKey: 'tier',
			factors: { enterprise: 0.5, free: 2 },
			steps: ['step_a', 'step_b', 'step_c'],
		});
		expect(r.shifted).toBe(2);
		const at = id => Date.parse(events.find(e => e.insert_id === id).time);
		expect(at('b1')).toBe(T0 + 20 * MIN);
		expect(at('c1')).toBe(T0 + 60 * MIN);
	});

	test('segment absent from factors → no-op', () => {
		const events = mkStream();
		const before = events.map(e => e.time);
		const r = applyTTCBySegmentV2(events, { tier: 'trial' }, {
			segmentKey: 'tier',
			factors: { enterprise: 0.5 },
			steps: ['step_a', 'step_b', 'step_c'],
		});
		expect(r).toEqual({ segmentValue: 'trial', factor: 1, shifted: 0 });
		expect(events.map(e => e.time)).toEqual(before);
	});

	test('no qualifying sequence within maxGapMinutes → shifted 0, untouched', () => {
		const events = mkStream();
		const before = events.map(e => e.time);
		// a→b gap is 10min in the first chain and 5min in the second, but the
		// second chain has no step_c — maxGap 5min disqualifies both.
		const r = applyTTCBySegmentV2(events, { tier: 'enterprise' }, {
			segmentKey: 'tier',
			factors: { enterprise: 0.5 },
			steps: ['step_a', 'step_b', 'step_c'],
			maxGapMinutes: 5,
		});
		expect(r).toEqual({ segmentValue: 'enterprise', factor: 0.5, shifted: 0 });
		expect(events.map(e => e.time)).toEqual(before);
	});

	test('invalid inputs → no-op result', () => {
		expect(applyTTCBySegmentV2([], {}, { segmentKey: 'tier', factors: {}, steps: ['a', 'b'] }))
			.toEqual({ segmentValue: null, factor: 1, shifted: 0 });
		expect(applyTTCBySegmentV2(mkStream(), { tier: 'free' }, { segmentKey: 'tier', factors: { free: 2 }, steps: ['step_a'] }))
			.toEqual({ segmentValue: null, factor: 1, shifted: 0 }); // <2 steps
	});
});

describe('applyTTCBySegment (deprecated funnel-post variant)', () => {
	test('warns exactly once and still scales the run', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const funnel = [mk('step_a', T0, { insert_id: 'a' }), mk('step_b', T0 + 10 * MIN, { insert_id: 'b' })];
		const r = applyTTCBySegment(funnel, { tier: 'enterprise' }, {
			segmentKey: 'tier', factors: { enterprise: 0.5 },
		});
		expect(r).toEqual({ segmentValue: 'enterprise', factor: 0.5, shifted: 1 });
		expect(Date.parse(funnel[1].time)).toBe(T0 + 5 * MIN);
		const calls1 = warn.mock.calls.filter(c => String(c[0]).includes('applyTTCBySegment is deprecated')).length;
		expect(calls1).toBe(1);
		// Second call: no further warning (module-level once flag).
		applyTTCBySegment(funnel, { tier: 'enterprise' }, { segmentKey: 'tier', factors: { enterprise: 0.5 } });
		const calls2 = warn.mock.calls.filter(c => String(c[0]).includes('applyTTCBySegment is deprecated')).length;
		expect(calls2).toBe(1);
	});
});
