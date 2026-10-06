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

// murmur3 fmix32 reference (Appleby, MurmurHash3.cpp), written out here so the
// expected values do not come from running the implementation under test.
const fmix32 = (h) => {
	h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
	h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
	h ^= h >>> 16;
	return h >>> 0;
};
const pearson = (xs, ys) => {
	const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
	let sxy = 0, sxx = 0, syy = 0;
	for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
	return sxy / Math.sqrt(sxx * syy);
};

describe('hashFloat / hashCohort (FNV-1a + fmix32 full-string)', () => {
	// Expected values are the PUBLISHED FNV-1a 32-bit test vectors from the
	// draft-eastlake-fnv test suite (h = 0x811c9dc5; per byte: h ^= byte;
	// h = (h * 0x01000193) mod 2^32), passed through the murmur3 fmix32
	// finalizer and divided by 2^32.
	test('hashFloat = fmix32(published FNV-1a 32-bit vector) / 2^32', () => {
		expect(hashFloat('')).toBe(fmix32(0x811c9dc5) / 2 ** 32); // empty string = offset basis
		expect(hashFloat('a')).toBe(fmix32(0xe40c292c) / 2 ** 32);
		expect(hashFloat('foobar')).toBe(fmix32(0xbf9cf968) / 2 ** 32);
	});

	test('salted keys that share a prefix are uncorrelated (independent cohort splits)', async () => {
		// Hooks salt one uid per cohort split: `${uid}|shred`, `${uid}|habit`.
		// Raw FNV-1a has no final avalanche, so these splits correlated at
		// |r| 0.05-0.10 over ~9k GUIDs and one cohort leaked into another.
		const { default: Chance } = await import('chance');
		const c = new Chance('hash-salt-independence');
		const uids = Array.from({ length: 9000 }, () => c.guid());
		const salts = ['|shred', '|habit', '|lapse', '|lapse-day', '|coach-use', '|a', '|b'];
		const cols = salts.map(salt => uids.map(u => hashFloat(u + salt)));
		let worst = 0;
		for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) worst = Math.max(worst, Math.abs(pearson(cols[i], cols[j])));
		// independent uniforms at n=9000: sd(r) ≈ 0.0105, so 0.035 is > 3 sd
		expect(worst).toBeLessThan(0.035);
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
		const pctOfA = (fmix32(0xe40c292c) / 2 ** 32) * 100;
		expect(hashCohort('a', Math.floor(pctOfA))).toBe(false);
		expect(hashCohort('a', Math.ceil(pctOfA))).toBe(true);
		expect(hashCohort('a', pctOfA)).toBe(false); // strict <
		expect(hashCohort('a', 0)).toBe(false);
		expect(hashCohort('a', 100)).toBe(true);
		expect(hashCohort('a', NaN)).toBe(false);
		expect(hashCohort('a', /** @type {number} */ (/** @type {unknown} */ ('50')))).toBe(false); // non-number pct
	});

	test('hashCohort: membership nests (pct 5 ⊂ pct 20) and tracks target on GUID ids', async () => {
		// Distribution is asserted on GUID-shaped ids — what the engine stamps
		// as user_id — via an independently seeded Chance. (Short SEQUENTIAL
		// synthetic ids like `usr_1..n` drifted under raw FNV-1a; the fmix32
		// finalizer fixes that, but GUIDs remain the engine's real input.)
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
