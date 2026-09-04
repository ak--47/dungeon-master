//@ts-nocheck
/**
 * v1.7.0: R2-1 macro object overrides, R2-2 singleCountry, P2-2 warnings on the
 * validated config, P1-2 stickyEventProps schema check, P0-3 volumeMultiplier check.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { validateDungeonConfig, resolveSingleCountry } from '../../lib/core/config-validator.js';
import { initChance } from '../../lib/utils/utils.js';

const base = (extra = {}) => ({
	seed: 'warn-test',
	numUsers: 10,
	numDays: 30,
	avgEventsPerUserPerDay: 1,
	verbose: false,
	events: [{ event: 'a' }, { event: 'b' }],
	userProps: { plan: ['free', 'pro'] },
	...extra,
});

beforeEach(() => initChance('warn-test'));

describe('R2-1 — MacroConfig object overrides', () => {
	test('preset + born above the cap: clamped AND reported (flat → 12)', () => {
		const cfg = validateDungeonConfig(base({ macro: { preset: 'flat', percentUsersBornInDataset: 50 } }));
		expect(cfg.percentUsersBornInDataset).toBe(12);
		const w = cfg._warnings.find(x => x.key === 'percentUsersBornInDataset');
		expect(w).toMatchObject({ requested: 50, applied: 12, severity: 'clamp' });
	});

	test('object WITHOUT preset is a custom macro: no cap, overrides honored', () => {
		const cfg = validateDungeonConfig(base({ macro: { bornRecentBias: 0.3, percentUsersBornInDataset: 50 } }));
		expect(cfg.percentUsersBornInDataset).toBe(50);
		expect(cfg.bornRecentBias).toBe(0.3);
		expect(cfg._warnings.find(x => x.key === 'percentUsersBornInDataset')).toBeUndefined();
	});

	test('preset string + top-level born above the cap still clamps (growth → 30)', () => {
		const cfg = validateDungeonConfig(base({ macro: 'growth', percentUsersBornInDataset: 80 }));
		expect(cfg.percentUsersBornInDataset).toBe(30);
		expect(cfg._warnings.find(x => x.key === 'percentUsersBornInDataset')).toMatchObject({ requested: 80, applied: 30 });
	});

	test('top-level born with no macro at all: untouched (legacy path)', () => {
		const cfg = validateDungeonConfig(base({ percentUsersBornInDataset: 50 }));
		expect(cfg.percentUsersBornInDataset).toBe(50);
	});
});

describe('R2-2 — singleCountry', () => {
	test('accepts ISO code, full name, any case → canonical name', () => {
		expect(resolveSingleCountry('US')).toBe('United States');
		expect(resolveSingleCountry('us')).toBe('United States');
		expect(resolveSingleCountry('United States')).toBe('United States');
		expect(resolveSingleCountry('gb')).toBe('United Kingdom');
		expect(resolveSingleCountry(undefined)).toBeUndefined();
		expect(resolveSingleCountry('')).toBeUndefined();
	});

	test('a miss throws and lists the valid values', () => {
		expect(() => resolveSingleCountry('Narnia')).toThrow(/matches no country.*US \(United States\)/);
		expect(() => validateDungeonConfig(base({ singleCountry: 'Narnia', hasLocation: true }))).toThrow(/Narnia/);
	});

	test('validated config carries the canonical name; switches form hoists', () => {
		expect(validateDungeonConfig(base({ singleCountry: 'us' })).singleCountry).toBe('United States');
		expect(validateDungeonConfig(base({ switches: { hasLocation: true, singleCountry: 'DE' } })).singleCountry).toBe('Germany');
	});
});

describe('P2-2 — clamp warnings on validatedConfig._warnings', () => {
	test('bornRecentBias out of band', () => {
		const cfg = validateDungeonConfig(base({ bornRecentBias: 0.9 }));
		expect(cfg.bornRecentBias).toBe(0.5);
		expect(cfg._warnings).toContainEqual(expect.objectContaining({ key: 'bornRecentBias', requested: 0.9, applied: 0.5, severity: 'clamp' }));
	});

	test('avgEventsPerUserPerDay above 50', () => {
		const cfg = validateDungeonConfig(base({ avgEventsPerUserPerDay: 80 }));
		expect(cfg.avgEventsPerUserPerDay).toBe(50);
		expect(cfg._warnings).toContainEqual(expect.objectContaining({ key: 'avgEventsPerUserPerDay', requested: 80, applied: 50 }));
	});

	test('avgActiveDaysPerUser above numDays/2', () => {
		const cfg = validateDungeonConfig(base({ avgActiveDaysPerUser: 25 }));
		expect(cfg.avgActiveDaysPerUser).toBe(15);
		expect(cfg._warnings).toContainEqual(expect.objectContaining({ key: 'avgActiveDaysPerUser', requested: 25, applied: 15 }));
	});

	test('numDays below 14 is a warn (applied === requested)', () => {
		const cfg = validateDungeonConfig(base({ numDays: 7 }));
		expect(cfg._warnings).toContainEqual(expect.objectContaining({ key: 'numDays', requested: 7, applied: 7, severity: 'warn' }));
	});

	test('clean config has no warnings', () => {
		expect(validateDungeonConfig(base())._warnings).toEqual([]);
	});
});

describe('P1-2 — stickyEventProps schema-first', () => {
	test('undeclared key throws', () => {
		expect(() => validateDungeonConfig(base({ stickyEventProps: ['nope'] }))).toThrow(/not declared/);
	});

	test('profile keys, persona keys and superProps keys are accepted; superProps-only keys are tracked', () => {
		const cfg = validateDungeonConfig(base({
			superProps: { platform: ['web', 'ios'] },
			personas: [{ name: 'p', weight: 1, properties: { tier: 'vip' } }],
			stickyEventProps: ['plan', 'tier', 'platform'],
		}));
		expect(cfg.stickyEventProps).toEqual(['plan', 'tier', 'platform']);
		expect(cfg._stickySuperOnly).toEqual(['platform']);
	});

	test('non-array throws', () => {
		expect(() => validateDungeonConfig(base({ stickyEventProps: 'plan' }))).toThrow(/array/);
	});
});

describe('P0-3 / P1-3 / P1-4 field validation', () => {
	test('volumeMultiplier must be a non-negative finite number', () => {
		expect(() => validateDungeonConfig(base({ worldEvents: [{ name: 'x', startDay: 1, duration: 1, volumeMultiplier: -1 }] }))).toThrow(/volumeMultiplier/);
		expect(validateDungeonConfig(base({ worldEvents: [{ name: 'x', startDay: 1, duration: 1, volumeMultiplier: 2.5 }] })).worldEvents[0].volumeMultiplier).toBe(2.5);
	});

	test('ttcModifier defaults to 1 and rejects non-positive', () => {
		expect(validateDungeonConfig(base({ personas: [{ name: 'p', weight: 1 }] })).personas[0].ttcModifier).toBe(1.0);
		expect(() => validateDungeonConfig(base({ personas: [{ name: 'p', weight: 1, ttcModifier: 0 }] }))).toThrow(/ttcModifier/);
	});

	test('campaignPerUser without hasCampaigns warns', () => {
		const cfg = validateDungeonConfig(base({ campaignPerUser: true }));
		expect(cfg._warnings).toContainEqual(expect.objectContaining({ key: 'campaignPerUser', severity: 'warn' }));
	});
});
