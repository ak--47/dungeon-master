//@ts-nocheck
import { describe, test, expect } from 'vitest';
import {
	binUsersByEventCount,
	binUsersByEventInRange,
	countEventsBetween,
	userInProfileSegment,
	hashFloat,
	hashCohort,
} from '../../lib/hook-helpers/cohort.js';

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

describe('hashFloat / hashCohort (FNV-1a full-string)', () => {
	// Expected values are the PUBLISHED FNV-1a 32-bit test vectors from the
	// draft-eastlake-fnv test suite (hand-traceable from the FNV-1a rule:
	// h = 0x811c9dc5; per byte: h ^= byte; h = (h * 0x01000193) mod 2^32),
	// divided by 2^32 — NOT derived from running this implementation.
	test('hashFloat matches published FNV-1a 32-bit vectors', () => {
		expect(hashFloat('')).toBe(0x811c9dc5 / 2 ** 32); // empty string = offset basis
		expect(hashFloat('a')).toBe(0xe40c292c / 2 ** 32);
		expect(hashFloat('foobar')).toBe(0xbf9cf968 / 2 ** 32);
	});

	test('hashFloat: [0,1) range, deterministic, full-string sensitive', () => {
		for (const id of ['user-1', 'user-2', 'ffab3', '0x9c', '']) {
			const v = hashFloat(id);
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThan(1);
			expect(hashFloat(id)).toBe(v); // deterministic
		}
		// Differ only in the LAST character — charCodeAt(0)-style hashing
		// cannot tell these apart; full-string FNV-1a must.
		expect(hashFloat('abcdef1')).not.toBe(hashFloat('abcdef2'));
		expect(hashFloat(42)).toBe(hashFloat('42')); // numbers stringify
	});

	test('hashCohort: boundary from the known vector for "a"', () => {
		// hashFloat('a') = 0xe40c292c / 2^32 ≈ 0.890729... → ~89.07 on the pct scale.
		const pctOfA = (0xe40c292c / 2 ** 32) * 100;
		expect(hashCohort('a', 89)).toBe(false); // 89 < 89.07…
		expect(hashCohort('a', 90)).toBe(true); // 90 > 89.07…
		expect(hashCohort('a', pctOfA)).toBe(false); // strict <
		expect(hashCohort('a', 0)).toBe(false);
		expect(hashCohort('a', 100)).toBe(true);
		expect(hashCohort('a', NaN)).toBe(false);
		expect(hashCohort('a', /** @type {number} */ (/** @type {unknown} */ ('50')))).toBe(false); // non-number pct
	});

	test('hashCohort: membership nests (pct 5 ⊂ pct 20) and tracks target on GUID ids', async () => {
		// Distribution is asserted on GUID-shaped ids — what the engine stamps
		// as user_id — via an independently seeded Chance. (Short SEQUENTIAL
		// synthetic ids like `usr_1..n` drift a few points: FNV-1a avalanche
		// is weak on short correlated inputs. Documented in the JSDoc.)
		const { default: Chance } = await import('chance');
		const c = new Chance('hash-cohort-dist');
		let in5 = 0, in20 = 0;
		const N = 5000;
		for (let i = 0; i < N; i++) {
			const uid = c.guid();
			const m5 = hashCohort(uid, 5);
			const m20 = hashCohort(uid, 20);
			if (m5) {
				in5++;
				expect(m20).toBe(true); // nesting
			}
			if (m20) in20++;
		}
		// ±40% relative of target at n=5000.
		expect(in5 / N).toBeGreaterThan(0.03);
		expect(in5 / N).toBeLessThan(0.07);
		expect(in20 / N).toBeGreaterThan(0.14);
		expect(in20 / N).toBeLessThan(0.26);
	});
});
