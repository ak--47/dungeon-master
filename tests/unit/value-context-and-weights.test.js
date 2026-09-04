//@ts-nocheck
/**
 * v1.7.0: `choose(value, ctx)` (P1-1), `{ __weights }` + `autoPowerLaw` (P2-1).
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { choose, initChance, resetValueCaches, setAutoPowerLaw, getAutoPowerLaw, isWeightsForm, getChance } from '../../lib/utils/utils.js';

const tally = (n, fn) => {
	const c = {};
	for (let i = 0; i < n; i++) { const v = fn(); c[v] = (c[v] || 0) + 1; }
	return c;
};

beforeEach(() => {
	initChance('value-ctx-test');
	resetValueCaches();
});

describe.sequential('choose(value, ctx) — P1-1', () => {
	test('zero-arity functions still work with no argument', () => {
		let seen = 'unset';
		const fn = function () { seen = arguments.length; return 'ok'; };
		expect(choose(fn, { profile: { a: 1 } })).toBe('ok');
		// zero-arity functions do receive the ctx argument (JS ignores extras), and keep working
		expect(seen).toBe(1);
	});

	test('context-aware function receives ctx and can correlate', () => {
		const fn = (ctx) => (ctx.profile.plan === 'pro' ? 100 : 10);
		expect(choose(fn, { profile: { plan: 'pro' } })).toBe(100);
		expect(choose(fn, { profile: { plan: 'free' } })).toBe(10);
	});

	test('arity guard: a 1-arity function returning a >10-item array is NOT frozen by the source cache', () => {
		const fn = (ctx) => Array.from({ length: 12 }, () => ctx.profile.tag);
		expect(choose(fn, { profile: { tag: 'A' } })).toBe('A');
		expect(choose(fn, { profile: { tag: 'B' } })).toBe('B');
	});

	test('zero-arity function returning a >10-item array IS cached (pre-1.7 behavior)', () => {
		let calls = 0;
		const fn = () => { calls++; return Array.from({ length: 12 }, (_, i) => `v${i}`); };
		choose(fn); choose(fn); choose(fn);
		expect(calls).toBe(1);
	});

	test('bound natives are called without the ctx argument', () => {
		// chance.animal.bind(chance) reports arity 1; ctx must never reach it as `options`
		const chance = getChance();
		const animal = chance.animal.bind(chance);
		const out = choose(animal, { profile: { type: 'zoo' } });
		expect(typeof out).toBe('string');
	});

	test('a function may return the weighted form', () => {
		const fn = () => ({ __weights: { a: 1 } });
		expect(choose(fn)).toBe('a');
	});
});

describe.sequential('{ __weights } — P2-1', () => {
	test('isWeightsForm recognizes the shape and rejects junk', () => {
		expect(isWeightsForm({ __weights: { a: 1, b: 2 } })).toBe(true);
		expect(isWeightsForm({ __weights: {} })).toBe(false);
		expect(isWeightsForm({ __weights: { a: 'x' } })).toBe(false);
		expect(isWeightsForm(['a', 'b'])).toBe(false);
		expect(isWeightsForm({ weights: { a: 1 } })).toBe(false);
	});

	test('draws land within tolerance of the stated distribution (60/30/10 over 10k)', () => {
		const value = { __weights: { free: 60, pro: 30, enterprise: 10 } };
		const c = tally(10_000, () => choose(value));
		expect(c.free / 10_000).toBeGreaterThan(0.56);
		expect(c.free / 10_000).toBeLessThan(0.64);
		expect(c.pro / 10_000).toBeGreaterThan(0.26);
		expect(c.pro / 10_000).toBeLessThan(0.34);
		expect(c.enterprise / 10_000).toBeGreaterThan(0.07);
		expect(c.enterprise / 10_000).toBeLessThan(0.13);
	});

	test('zero-weight keys never draw', () => {
		const c = tally(500, () => choose({ __weights: { a: 1, never: 0 } }));
		expect(c.never).toBeUndefined();
		expect(c.a).toBe(500);
	});
});

describe.sequential('autoPowerLaw — P2-1', () => {
	const tiers = ['free', 'pro', 'enterprise'];

	test('default: 3-item unique string array is power-law (~45/25/15 skew)', () => {
		expect(getAutoPowerLaw()).toBe(true);
		const c = tally(6_000, () => choose(tiers));
		const shares = Object.values(c).map(n => n / 6_000).sort((a, b) => b - a);
		expect(shares[0]).toBeGreaterThan(0.40);
		expect(shares[2]).toBeLessThan(0.22);
	});

	test('setAutoPowerLaw(false): draws are roughly uniform', () => {
		setAutoPowerLaw(false);
		expect(getAutoPowerLaw()).toBe(false);
		const c = tally(6_000, () => choose(tiers));
		for (const t of tiers) {
			expect(c[t] / 6_000).toBeGreaterThan(0.29);
			expect(c[t] / 6_000).toBeLessThan(0.38);
		}
	});

	test('resetValueCaches restores the default', () => {
		setAutoPowerLaw(false);
		resetValueCaches();
		expect(getAutoPowerLaw()).toBe(true);
	});
});
