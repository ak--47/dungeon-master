//@ts-nocheck
import { describe, test, expect } from 'vitest';
import {
	binUsersByEventCount,
	binUsersByEventInRange,
	countEventsBetween,
	userInProfileSegment,
} from '../lib/hook-helpers/cohort.js';

const mkEv = (event, time) => ({ event, time });

describe('cohort atoms', () => {
	test('binUsersByEventCount: matches inclusive lower / exclusive upper', () => {
		const events = [mkEv('A', 1), mkEv('A', 2), mkEv('A', 3), mkEv('B', 4)];
		const bins = { low: [0, 2], sweet: [2, 5], over: [5, Infinity] };
		expect(binUsersByEventCount(events, 'A', bins)).toBe('sweet'); // 3 → sweet
		expect(binUsersByEventCount(events, 'B', bins)).toBe('low'); // 1 → low
		expect(binUsersByEventCount(events, 'C', bins)).toBe('low'); // 0 → low
	});

	test('binUsersByEventCount: returns null when no bin matches', () => {
		const events = [mkEv('A', 1), mkEv('A', 2)];
		expect(binUsersByEventCount(events, 'A', { high: [10, 20] })).toBe(null);
	});

	test('binUsersByEventCount: tolerates missing/empty inputs', () => {
		expect(binUsersByEventCount(null, 'A', { x: [0, 1] })).toBe(null);
		expect(binUsersByEventCount([], 'A', { x: [0, 1] })).toBe('x'); // count=0 ∈ [0,1)
		expect(binUsersByEventCount([mkEv('A', 1)], 'A', null)).toBe(null);
	});

	test('binUsersByEventInRange: filters by time window', () => {
		const t0 = Date.parse('2024-02-01T00:00:00Z');
		const events = [
			mkEv('A', new Date(t0 + 0).toISOString()),
			mkEv('A', new Date(t0 + 60_000).toISOString()),
			mkEv('A', new Date(t0 + 3600_000).toISOString()),
		];
		const bins = { low: [0, 2], high: [2, Infinity] };
		// Window covers first two events only
		expect(binUsersByEventInRange(events, 'A', t0, t0 + 70_000, bins)).toBe('high');
		// Window covers first event only
		expect(binUsersByEventInRange(events, 'A', t0, t0 + 30_000, bins)).toBe('low');
	});

	test('countEventsBetween: returns 0 if either anchor is missing', () => {
		const events = [mkEv('A', 1), mkEv('B', 5)];
		expect(countEventsBetween(events, 'X', 'B')).toBe(0);
		expect(countEventsBetween(events, 'A', 'X')).toBe(0);
	});

	test('countEventsBetween: counts strictly between first A and first B after it', () => {
		const t0 = Date.parse('2024-02-01T00:00:00Z');
		const events = [
			mkEv('A', new Date(t0).toISOString()),
			mkEv('X', new Date(t0 + 100).toISOString()),
			mkEv('Y', new Date(t0 + 200).toISOString()),
			mkEv('B', new Date(t0 + 300).toISOString()),
			mkEv('A', new Date(t0 + 400).toISOString()), // a later A — ignored
			mkEv('Z', new Date(t0 + 500).toISOString()),
		];
		expect(countEventsBetween(events, 'A', 'B')).toBe(2); // X, Y between
	});

	test('userInProfileSegment: array and single-value match modes', () => {
		const profile = { tier: 'gold', plan: 'pro' };
		expect(userInProfileSegment(profile, 'tier', ['gold', 'silver'])).toBe(true);
		expect(userInProfileSegment(profile, 'tier', 'gold')).toBe(true);
		expect(userInProfileSegment(profile, 'tier', 'bronze')).toBe(false);
		expect(userInProfileSegment(profile, 'missing', 'whatever')).toBe(false);
		expect(userInProfileSegment(null, 'tier', 'gold')).toBe(false);
	});
});
