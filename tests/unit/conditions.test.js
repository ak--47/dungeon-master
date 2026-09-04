//@ts-nocheck
/**
 * v1.7.0 (P0-1): funnel `conditions` operator matrix + validator rejections.
 */
import { describe, test, expect } from 'vitest';
import { matchConditions, CONDITION_OPERATORS } from '../../lib/utils/conditions.js';
import { matchConditions as reExported } from '../../lib/orchestrators/user-loop.js';
import { validateDungeonConfig } from '../../lib/core/config-validator.js';
import { initChance } from '../../lib/utils/utils.js';

const profile = { platform: 'iOS', seats: 10, country: 'US', plan_tier: 'pro', signup: '2026-03-01' };

describe('matchConditions — operators', () => {
	test('re-exported from user-loop for back-compat', () => {
		expect(reExported).toBe(matchConditions);
	});

	test('scalar shorthand is strict equality', () => {
		expect(matchConditions(profile, { platform: 'iOS' })).toBe(true);
		expect(matchConditions(profile, { platform: 'Android' })).toBe(false);
		expect(matchConditions(profile, { seats: '10' })).toBe(false); // no coercion
	});

	test.each([
		['eq', { seats: { eq: 10 } }, true],
		['eq miss', { seats: { eq: 11 } }, false],
		['neq', { country: { neq: 'US' } }, false],
		['neq pass', { country: { neq: 'GB' } }, true],
		['in', { plan_tier: { in: ['pro', 'enterprise'] } }, true],
		['in miss', { plan_tier: { in: ['free'] } }, false],
		['nin', { plan_tier: { nin: ['free'] } }, true],
		['nin miss', { plan_tier: { nin: ['pro'] } }, false],
		['gt', { seats: { gt: 9 } }, true],
		['gt miss', { seats: { gt: 10 } }, false],
		['gte', { seats: { gte: 10 } }, true],
		['lt', { seats: { lt: 11 } }, true],
		['lt miss', { seats: { lt: 10 } }, false],
		['lte', { seats: { lte: 10 } }, true],
		['string ordering (ISO dates)', { signup: { gte: '2026-01-01', lt: '2026-06-01' } }, true],
		['two operators AND within a key', { seats: { gte: 5, lte: 8 } }, false],
		['AND across keys', { platform: 'iOS', seats: { gte: 10 } }, true],
		['AND across keys miss', { platform: 'iOS', seats: { gte: 11 } }, false],
	])('%s', (_label, conditions, expected) => {
		expect(matchConditions(profile, conditions)).toBe(expected);
	});

	test('missing profile key: fails eq/in/ordering, satisfies neq/nin', () => {
		expect(matchConditions(profile, { missing: { eq: 1 } })).toBe(false);
		expect(matchConditions(profile, { missing: { in: [1] } })).toBe(false);
		expect(matchConditions(profile, { missing: { gt: 0 } })).toBe(false);
		expect(matchConditions(profile, { missing: { neq: 1 } })).toBe(true);
		expect(matchConditions(profile, { missing: { nin: [1] } })).toBe(true);
	});

	test('unknown operator never matches (defensive; validator throws first)', () => {
		expect(matchConditions(profile, { seats: { between: [1, 20] } })).toBe(false);
	});

	test('operator list is the documented eight', () => {
		expect([...CONDITION_OPERATORS]).toEqual(['eq', 'neq', 'in', 'nin', 'gt', 'gte', 'lt', 'lte']);
	});
});

describe('validateDungeonConfig — conditions shapes', () => {
	const base = (conditions, extra = {}) => ({
		seed: 'cond-validate',
		numUsers: 10,
		numDays: 20,
		avgEventsPerUserPerDay: 1,
		userProps: { platform: ['iOS', 'Android'], seats: [1, 10] },
		events: [{ event: 'a' }, { event: 'b' }],
		funnels: [{ name: 'F', sequence: ['a', 'b'], conditions }],
		...extra,
	});

	test('function values throw', () => {
		initChance('cond-validate');
		expect(() => validateDungeonConfig(base({ platform: () => 'iOS' }))).toThrow(/is a function/);
	});

	test('bare arrays throw and point at { in }', () => {
		initChance('cond-validate');
		expect(() => validateDungeonConfig(base({ platform: ['iOS', 'Android'] }))).toThrow(/Use \{ in: \["iOS", "Android"\] \}/);
	});

	test('unknown operator throws', () => {
		initChance('cond-validate');
		expect(() => validateDungeonConfig(base({ seats: { between: [1, 5] } }))).toThrow(/unknown operator "between"/);
	});

	test('in / nin without an array throw', () => {
		initChance('cond-validate');
		expect(() => validateDungeonConfig(base({ platform: { in: 'iOS' } }))).toThrow(/requires an array/);
		expect(() => validateDungeonConfig(base({ platform: { nin: 'iOS' } }))).toThrow(/requires an array/);
	});

	test('ordering operators need a number or string', () => {
		initChance('cond-validate');
		expect(() => validateDungeonConfig(base({ seats: { gte: true } }))).toThrow(/requires a number or string/);
	});

	test('valid operator maps pass and undeclared keys warn (not throw)', () => {
		initChance('cond-validate');
		const cfg = validateDungeonConfig(base({ seats: { gte: 10 }, platform: { in: ['iOS'] }, hook_only_key: 'x' }));
		const warn = cfg._warnings.find(w => w.key.includes('hook_only_key'));
		expect(warn).toBeDefined();
		expect(warn.severity).toBe('warn');
		expect(cfg._warnings.some(w => w.key.includes('.seats'))).toBe(false);
	});

	test('persona property keys count as declared', () => {
		initChance('cond-validate');
		const cfg = validateDungeonConfig(base({ tier: 'vip' }, {
			personas: [{ name: 'vip', weight: 1, properties: { tier: 'vip' } }],
		}));
		expect(cfg._warnings.some(w => w.key.includes('.tier'))).toBe(false);
	});
});
