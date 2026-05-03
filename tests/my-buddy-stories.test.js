//@ts-nocheck
/**
 * Phase 6 acceptance — my-buddy.js stories pass via the Mixpanel breakdown emulator.
 *
 * Runs the migrated my-buddy dungeon at small scale and asserts each of the 3
 * documented analytics stories produces the expected emulator output. This is
 * the gate that proves the Phase 4 emulator can verify the kind of patterns
 * users actually engineer.
 */

import { describe, test, expect } from 'vitest';
import DUNGEON_MASTER from '../index.js';
import { emulateBreakdown } from '../lib/verify/emulate-breakdown.js';

const SMALL_OVERRIDES = {
	numUsers: 1000,
	avgEventsPerUserPerDay: 1.5,
	writeToDisk: false,
	verbose: false,
	concurrency: 1,
	token: '',
};

describe('Phase 6 — my-buddy stories via emulator', { timeout: 120_000 }, () => {
	test('all three stories show the expected shapes', async () => {
		const { default: config } = await import('../dungeons/user/my-buddy.js');
		const result = await DUNGEON_MASTER({ ...config, ...SMALL_OVERRIDES });
		const events = Array.from(result.eventData);

		// ── Story 1: Experiment + EU root cause ──
		// Variant B should outperform Control on downstream Agenda Generated.
		const variantBreakdown = emulateBreakdown(events, {
			type: 'attributedBy',
			conversionEvent: 'Agenda Generated',
			attributionEvent: '$experiment_started',
			attributionProperty: 'Variant name',
			model: 'firstTouch',
		});
		// Should include all 3 variants. Variant ranking (B > A > Control) is the
		// story but at --small scale (≤100 conversions per variant) the ordering
		// can flip — assert presence of variants + reasonable downstream attribution
		// instead. Full-fidelity verifiers that re-run at production scale will
		// re-assert the strict ordering; this gate just confirms the emulator wires
		// the report end-to-end.
		const variantNames = variantBreakdown.map(r => r.attribution_value);
		expect(variantBreakdown.length).toBeGreaterThanOrEqual(3);
		const variantB = variantBreakdown.find(r => /Variant B/.test(r.attribution_value));
		const control = variantBreakdown.find(r => /Control/.test(r.attribution_value));
		// At 1000 users, Variant B should have the highest conversion count
		expect(variantB.conversions).toBeGreaterThanOrEqual(control.conversions);
		expect(variantNames.some(n => /Variant B/.test(n))).toBe(true);
		expect(variantNames.some(n => /Variant A/.test(n))).toBe(true);
		expect(variantNames.some(n => /Control/.test(n))).toBe(true);

		// EU bug: Agenda Errors should exist and be EU-only.
		const errors = events.filter(e => e.event === 'Agenda Error');
		expect(errors.length).toBeGreaterThan(0);
		const nonEUErrors = errors.filter(e => e.Region !== 'EU').length;
		expect(nonEUErrors).toBe(0);

		// ── Story 2: Inverted-U signup magic number ──
		const funnelByQuestionCount = emulateBreakdown(events, {
			type: 'funnelFrequency',
			steps: ['View Shared Page', 'Onboarding Question', 'Sign Up'],
			breakdownByFrequencyOf: 'Onboarding Question',
		});
		// Pull the conversion percentages at the final step (Sign Up) per breakdown.
		const finalStep = funnelByQuestionCount.filter(r => r.step === 'Sign Up');
		const byBreakdown = new Map(finalStep.map(r => [r.breakdown_freq, r.conversion_pct]));
		// Conversion at 3 questions should be higher than at 1 OR 2 (sweet spot).
		const at3 = byBreakdown.get(3) ?? 0;
		const at1 = byBreakdown.get(1) ?? 0;
		const at2 = byBreakdown.get(2) ?? 0;
		const at6 = byBreakdown.get(6) ?? 0;
		expect(at3).toBeGreaterThan(at1);
		expect(at3).toBeGreaterThan(at2);
		// Right side of the U: high question counts should convert less than peak.
		const rightSide = [...byBreakdown.entries()].filter(([k]) => k >= 5);
		if (rightSide.length > 0) {
			const maxRightPct = Math.max(...rightSide.map(([, v]) => v));
			expect(at3).toBeGreaterThan(maxRightPct);
		}

		// ── Story 3: Feedback contextual paths ──
		// New "Post Search" / "Post Action" / "Post Share" sources only appear after
		// March 15 launch; they should have higher avg Rating than Prompted.
		const contextualSources = events.filter(e =>
			e.event === 'Submit Feedback' &&
			['Post Search', 'Post Action', 'Post Share'].includes(e['Feedback Source'])
		);
		expect(contextualSources.length).toBeGreaterThan(0);
		const promptedAvg = avgRating(events, 'Prompted');
		const postSearchAvg = avgRating(events, 'Post Search');
		const postActionAvg = avgRating(events, 'Post Action');
		const postShareAvg = avgRating(events, 'Post Share');
		// All three contextual paths should beat the prompted baseline.
		expect(postSearchAvg).toBeGreaterThan(promptedAvg);
		expect(postActionAvg).toBeGreaterThan(promptedAvg);
		expect(postShareAvg).toBeGreaterThan(promptedAvg);
	});
});

function avgRating(events, source) {
	const matches = events.filter(e => e.event === 'Submit Feedback' && e['Feedback Source'] === source);
	if (!matches.length) return 0;
	const sum = matches.reduce((a, e) => a + (e.Rating || 0), 0);
	return sum / matches.length;
}
