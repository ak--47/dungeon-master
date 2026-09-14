import { describe, expect, test } from 'vitest';
import { initChance, TimeSoup } from '../../lib/utils/utils.js';

describe.sequential('TimeSoup boundary distribution', () => {
	test.each([
		['2026-09-01T00:00:00Z', '2026-09-13T12:34:56Z'],
		['2026-09-01T12:34:56Z', '2026-09-13T00:00:00Z'],
		['2026-09-13T00:00:00Z', '2026-09-13T00:15:00Z'],
		['2026-09-13T12:15:00Z', '2026-09-13T12:45:00Z'],
	])('does not clamp hour samples onto %s or %s', (start, end) => {
		initChance('time-soup-hour-boundaries');
		const earliest = Date.parse(start) / 1000;
		const latest = Date.parse(end) / 1000;
		const samples = Array.from({ length: 10000 }, () => TimeSoup(earliest, latest));
		expect(samples.every(time => time >= earliest && time <= latest)).toBe(true);
		expect(samples.filter(time => time === earliest).length).toBeLessThan(10);
		expect(samples.filter(time => time === latest).length).toBeLessThan(10);
		expect(new Set(samples).size).toBeGreaterThan(500);
	});

	test('does not accumulate Gaussian tails at endpoints without hour redistribution', () => {
		initChance('time-soup-gaussian-boundaries');
		const earliest = Date.parse('2026-09-01T00:00:00Z') / 1000;
		const latest = Date.parse('2026-09-13T00:00:00Z') / 1000;
		const samples = Array.from({ length: 10000 }, () => TimeSoup(earliest, latest, 5, 2, 0, null, null));
		expect(samples.every(time => time >= earliest && time <= latest)).toBe(true);
		expect(samples.filter(time => time === earliest).length).toBeLessThan(10);
		expect(samples.filter(time => time === latest).length).toBeLessThan(10);
	});

	test('retains a single instant when no time capacity exists', () => {
		initChance('time-soup-single-instant');
		const instant = Date.parse('2026-09-13T12:34:56Z') / 1000;
		expect(TimeSoup(instant, instant)).toBe(instant);
	});

	test('keeps fractional peak counts within the requested window', () => {
		initChance('time-soup-fractional-peaks');
		const earliest = Date.parse('2026-09-01T00:00:00Z') / 1000;
		const latest = earliest + 100;
		const samples = Array.from({ length: 10000 }, () => TimeSoup(earliest, latest, 2.5, 2, 0, null, null));
		expect(samples.every(time => time >= earliest && time <= latest)).toBe(true);
	});

	test('uses eligible hours on another day when the sampled partial day has none', () => {
		initChance('time-soup-eligible-hours');
		const earliest = Date.parse('2026-09-12T18:00:00Z') / 1000;
		const latest = Date.parse('2026-09-13T18:00:00Z') / 1000;
		const hourWeights = Array.from({ length: 24 }, (_, hour) => hour === 12 ? 1 : 0);
		const samples = Array.from({ length: 1000 }, () => TimeSoup(earliest, latest, 5, 2, 0, null, hourWeights));
		expect(samples.every(time => new Date(time * 1000).getUTCHours() === 12)).toBe(true);
	});

	test('rejects a window with no eligible weighted hours', () => {
		initChance('time-soup-no-eligible-hours');
		const earliest = Date.parse('2026-09-13T18:00:00Z') / 1000;
		const latest = Date.parse('2026-09-13T19:00:00Z') / 1000;
		const hourWeights = Array.from({ length: 24 }, (_, hour) => hour === 12 ? 1 : 0);
		expect(() => TimeSoup(earliest, latest, 5, 2, 0, null, hourWeights)).toThrow(/hour.*weight|weighted.*hour/i);
	});
});