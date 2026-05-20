//@ts-nocheck
/**
 * v1.5.1 retention-curve interpolation tests.
 *
 * Covers anchor extraction, logarithmic + linear interpolation, extrapolation
 * past the last anchor, and the `expectedActiveDays` derived sum used by the
 * validator when only the curve is set (no explicit `avgActiveDaysPerUser`).
 */

import { describe, test, expect } from 'vitest';
import { extractAnchors, buildCurveWeightFn, expectedActiveDays } from '../../lib/utils/retention-curve.js';

describe('v1.5.1 retention-curve', () => {
	test('extractAnchors always includes day-0 = 1.0', () => {
		const a = extractAnchors({ day7: 0.5 });
		expect(a[0]).toEqual({ day: 0, weight: 1 });
		expect(a[1]).toEqual({ day: 7, weight: 0.5 });
	});

	test('extractAnchors handles unsorted + invalid keys gracefully', () => {
		const a = extractAnchors({ day30: 0.1, day7: 0.3, day1: 0.5, day0: 999, dayXYZ: 'nope', day7_extra: 'no' });
		const days = a.map(x => x.day);
		expect(days).toEqual([0, 1, 7, 30]); // sorted, day0 ignored from user input
		expect(a[0].weight).toBe(1); // day-0 forced to 1.0
	});

	test('weight at exact anchor matches anchor', () => {
		const fn = buildCurveWeightFn({ day1: 0.4, day7: 0.2, day30: 0.08 });
		expect(fn(0)).toBeCloseTo(1, 5);
		expect(fn(1)).toBeCloseTo(0.4, 5);
		expect(fn(7)).toBeCloseTo(0.2, 5);
		expect(fn(30)).toBeCloseTo(0.08, 5);
	});

	test('logarithmic interpolation monotonic non-increasing', () => {
		const fn = buildCurveWeightFn({ day1: 0.4, day7: 0.2, day30: 0.08 });
		const samples = Array.from({ length: 30 }, (_, i) => fn(i + 1));
		for (let i = 1; i < samples.length; i++) {
			expect(samples[i]).toBeLessThanOrEqual(samples[i - 1] + 1e-9);
		}
	});

	test('linear mode produces straight-line interpolation', () => {
		const fn = buildCurveWeightFn({ type: 'linear', day1: 1, day10: 0 });
		expect(fn(5)).toBeCloseTo(1 - (5 - 1) / 9, 5);
	});

	test('extrapolation past last anchor uses last segment slope', () => {
		const fn = buildCurveWeightFn({ day1: 0.4, day7: 0.2 });
		// Logarithmic extension: at day14, decays further past 0.2.
		expect(fn(14)).toBeLessThan(0.2);
	});

	test('expectedActiveDays sums weights across the window', () => {
		const span = expectedActiveDays({ day1: 0.5, day7: 0.25, day30: 0.1 }, 30);
		// Day 0 contributes 1.0; the rest are decaying values in (0, 1].
		expect(span).toBeGreaterThan(1);
		expect(span).toBeLessThan(30);
	});

	test('no anchors (only day-0) → constant 1 weight', () => {
		const fn = buildCurveWeightFn({});
		expect(fn(0)).toBe(1);
		expect(fn(7)).toBe(1);
		expect(fn(30)).toBe(1);
	});

	test('negative day offsets clamp to 0', () => {
		const fn = buildCurveWeightFn({ day1: 0.5 });
		expect(fn(-1)).toBe(0);
	});
});
