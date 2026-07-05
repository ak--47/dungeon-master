/**
 * applyFunnelDefaults — funnel-level config auto-threading for breakdown args.
 *
 * The session-window suppression case (P4.4 regression): when a story
 * assertion sets an explicit `conversionWindow: { unit: 'sessions', n }`,
 * the matched funnel's `conversionWindowDays` must NOT be injected as
 * `conversionWindowMs` — evaluateFunnel throws on both being present.
 */
import { describe, it, expect } from 'vitest';
import { applyFunnelDefaults } from '../../lib/verify/verify-dungeon.js';

const FUNNELS = [
	{
		sequence: ['ticket created', 'reply sent', 'ticket resolved'],
		conversionWindowDays: 30, // what the validator defaults every funnel to
		order: 'sequential',
	},
];

describe('applyFunnelDefaults', () => {
	it('injects conversionWindowMs from the matched funnel when no window is set', () => {
		const out = applyFunnelDefaults(
			{ type: 'funnelFrequency', steps: ['ticket created', 'reply sent', 'ticket resolved'], breakdownByFrequencyOf: 'ticket created' },
			FUNNELS,
		);
		// 30 days × 86,400,000 ms/day = 2,592,000,000
		expect(out.conversionWindowMs).toBe(2_592_000_000);
	});

	it('does NOT inject conversionWindowMs when an explicit session-count window is set', () => {
		const out = applyFunnelDefaults(
			{
				type: 'funnelFrequency',
				steps: ['ticket created', 'reply sent', 'ticket resolved'],
				breakdownByFrequencyOf: 'ticket created',
				conversionWindow: { unit: 'sessions', n: 1 },
			},
			FUNNELS,
		);
		expect(out.conversionWindowMs).toBeUndefined();
		expect(out.conversionWindow).toEqual({ unit: 'sessions', n: 1 });
	});

	it('does NOT overwrite an explicit conversionWindowMs', () => {
		const out = applyFunnelDefaults(
			{ type: 'funnelFrequency', steps: ['ticket created', 'reply sent', 'ticket resolved'], breakdownByFrequencyOf: 'ticket created', conversionWindowMs: 3_600_000 },
			FUNNELS,
		);
		expect(out.conversionWindowMs).toBe(3_600_000);
	});

	it('leaves args untouched when steps match no funnel', () => {
		const out = applyFunnelDefaults(
			{ type: 'funnelFrequency', steps: ['a', 'b'], breakdownByFrequencyOf: 'a', conversionWindow: { unit: 'sessions', n: 2 } },
			FUNNELS,
		);
		expect(out.conversionWindowMs).toBeUndefined();
		expect(out.funnelOrder).toBeUndefined();
	});

	it('does not mutate the input args object', () => {
		const args = { type: 'funnelFrequency', steps: ['ticket created', 'reply sent', 'ticket resolved'], breakdownByFrequencyOf: 'ticket created' };
		applyFunnelDefaults(args, FUNNELS);
		expect(args.conversionWindowMs).toBeUndefined();
	});
});
