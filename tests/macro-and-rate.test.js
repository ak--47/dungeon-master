//@ts-nocheck
/**
 * Tests for the new macro preset system + avgEventsPerUserPerDay primitive.
 *
 * These features address the "end-of-dataset blow-up" problem where charts
 * showed meteoric ramps in the final ~14 days. The fix: per-user-per-day rate
 * (so born-late users don't compress events into a tiny window) plus a macro
 * preset system whose default ("flat") removes the legacy growth-bias defaults.
 */

import { describe, test, expect } from 'vitest';
import { validateDungeonConfig } from '../lib/core/config-validator.js';
import { resolveMacro, MACRO_PRESETS, MACRO_PRESET_NAMES } from '../lib/templates/macro-presets.js';
import { initChance } from '../lib/utils/utils.js';

const FIXED_NOW = 1706832000;
global.FIXED_NOW = FIXED_NOW;
global.FIXED_BEGIN = FIXED_NOW - 90 * 86400;

describe('avgEventsPerUserPerDay primitive', () => {
	test('numEvents-only path derives the rate from numEvents/numUsers/numDays', () => {
		initChance('rate-derive');
		const config = validateDungeonConfig({
			numUsers: 100,
			numEvents: 9000,
			numDays: 30,
			seed: 'rate-derive'
		});
		expect(config.avgEventsPerUserPerDay).toBe(9000 / 100 / 30);
		expect(config.numEvents).toBe(9000);
	});

	test('avgEventsPerUserPerDay-only path computes numEvents from rate × users × days', () => {
		initChance('rate-direct');
		const config = validateDungeonConfig({
			numUsers: 100,
			numDays: 30,
			avgEventsPerUserPerDay: 2.5,
			seed: 'rate-direct'
		});
		expect(config.avgEventsPerUserPerDay).toBe(2.5);
		expect(config.numEvents).toBe(Math.round(2.5 * 100 * 30));
	});

	test('when both are set, avgEventsPerUserPerDay wins and numEvents is recomputed', () => {
		initChance('rate-both');
		const config = validateDungeonConfig({
			numUsers: 100,
			numDays: 30,
			numEvents: 1000, // ignored
			avgEventsPerUserPerDay: 4,
			seed: 'rate-both'
		});
		expect(config.avgEventsPerUserPerDay).toBe(4);
		expect(config.numEvents).toBe(Math.round(4 * 100 * 30));
	});

	test('neither set falls back to legacy 100k default', () => {
		initChance('rate-default');
		const config = validateDungeonConfig({
			numUsers: 1000,
			numDays: 30,
			seed: 'rate-default'
		});
		expect(config.numEvents).toBe(100_000);
		expect(config.avgEventsPerUserPerDay).toBeCloseTo(100_000 / 1000 / 30, 6);
	});
});

describe('resolveMacro', () => {
	test('returns "flat" preset values when nothing is provided', () => {
		const result = resolveMacro(undefined);
		expect(result).toEqual(MACRO_PRESETS.flat);
	});

	test('resolves preset name strings to preset values', () => {
		for (const name of MACRO_PRESET_NAMES) {
			expect(resolveMacro(name)).toEqual(MACRO_PRESETS[name]);
		}
	});

	test('throws on unknown preset name', () => {
		expect(() => resolveMacro('not-a-real-preset')).toThrow(/Unknown macro preset/);
	});

	test('preset+overrides object merges fields', () => {
		const result = resolveMacro({ preset: 'growth', bornRecentBias: 0.9 });
		expect(result.bornRecentBias).toBe(0.9);
		expect(result.percentUsersBornInDataset).toBe(MACRO_PRESETS.growth.percentUsersBornInDataset);
		expect(result.preExistingSpread).toBe(MACRO_PRESETS.growth.preExistingSpread);
	});

	test('throws on unknown preset in object form', () => {
		expect(() => resolveMacro({ preset: 'nonexistent' })).toThrow(/Unknown macro preset/);
	});

	test('raw object passes through, filling missing fields from flat default', () => {
		const result = resolveMacro({ bornRecentBias: 0.5 });
		expect(result.bornRecentBias).toBe(0.5);
		expect(result.percentUsersBornInDataset).toBe(MACRO_PRESETS.flat.percentUsersBornInDataset);
		expect(result.preExistingSpread).toBe(MACRO_PRESETS.flat.preExistingSpread);
	});
});

describe('macro integration with config-validator', () => {
	test('default macro is "flat" when not specified', () => {
		initChance('macro-default');
		const config = validateDungeonConfig({
			numUsers: 100,
			numEvents: 1000,
			seed: 'macro-default'
		});
		expect(config.bornRecentBias).toBe(MACRO_PRESETS.flat.bornRecentBias);
		expect(config.percentUsersBornInDataset).toBe(MACRO_PRESETS.flat.percentUsersBornInDataset);
		expect(config.preExistingSpread).toBe(MACRO_PRESETS.flat.preExistingSpread);
	});

	test('macro: "growth" preset is applied', () => {
		initChance('macro-growth');
		const config = validateDungeonConfig({
			numUsers: 100,
			numEvents: 1000,
			macro: 'growth',
			seed: 'macro-growth'
		});
		expect(config.bornRecentBias).toBe(MACRO_PRESETS.growth.bornRecentBias);
		expect(config.percentUsersBornInDataset).toBe(MACRO_PRESETS.growth.percentUsersBornInDataset);
		expect(config.preExistingSpread).toBe(MACRO_PRESETS.growth.preExistingSpread);
	});

	test('explicit dungeon-level fields override the macro preset', () => {
		initChance('macro-override');
		const config = validateDungeonConfig({
			numUsers: 100,
			numEvents: 1000,
			macro: 'growth',
			bornRecentBias: 0.9,           // overrides growth's 0.3
			percentUsersBornInDataset: 80, // overrides growth's 60
			seed: 'macro-override'
		});
		expect(config.bornRecentBias).toBe(0.9);
		expect(config.percentUsersBornInDataset).toBe(80);
		// preExistingSpread came from macro: "growth"
		expect(config.preExistingSpread).toBe(MACRO_PRESETS.growth.preExistingSpread);
	});

	test('macro object form supports preset+overrides at config level', () => {
		initChance('macro-obj');
		const config = validateDungeonConfig({
			numUsers: 100,
			numEvents: 1000,
			macro: { preset: 'viral', percentUsersBornInDataset: 75 },
			seed: 'macro-obj'
		});
		expect(config.bornRecentBias).toBe(MACRO_PRESETS.viral.bornRecentBias);
		expect(config.percentUsersBornInDataset).toBe(75);
	});

	test('all five named macro presets exist and are distinct', () => {
		const names = ['flat', 'steady', 'growth', 'viral', 'decline'];
		for (const n of names) {
			expect(MACRO_PRESETS[n]).toBeDefined();
			expect(typeof MACRO_PRESETS[n].bornRecentBias).toBe('number');
			expect(typeof MACRO_PRESETS[n].percentUsersBornInDataset).toBe('number');
		}
	});

	test('macro preset values are pinned (update test when changing presets)', () => {
		expect(MACRO_PRESETS.flat).toEqual({
			bornRecentBias: 0,
			percentUsersBornInDataset: 50,
			preExistingSpread: 'uniform',
		});
		expect(MACRO_PRESETS.steady).toEqual({
			bornRecentBias: 0.1,
			percentUsersBornInDataset: 35,
			preExistingSpread: 'uniform',
		});
		expect(MACRO_PRESETS.growth).toEqual({
			bornRecentBias: 0.3,
			percentUsersBornInDataset: 60,
			preExistingSpread: 'pinned',
		});
		expect(MACRO_PRESETS.viral).toEqual({
			bornRecentBias: 0.6,
			percentUsersBornInDataset: 95,
			preExistingSpread: 'pinned',
		});
		expect(MACRO_PRESETS.decline).toEqual({
			bornRecentBias: -0.3,
			percentUsersBornInDataset: 25,
			preExistingSpread: 'uniform',
		});
	});

	test('no preset has percentUsersBornInDataset below 25', () => {
		for (const [name, preset] of Object.entries(MACRO_PRESETS)) {
			expect(preset.percentUsersBornInDataset, `${name} preset below 25%`).toBeGreaterThanOrEqual(25);
		}
	});
});

describe('config-validator guards and clamping (1.3.0 hardening)', () => {
	test('throws when numUsers is zero', () => {
		initChance('zero-users');
		expect(() => validateDungeonConfig({
			numUsers: 0,
			numEvents: 1000,
			seed: 'zero-users'
		})).toThrow(/numUsers must be a positive number/);
	});

	test('throws when numUsers is negative', () => {
		initChance('neg-users');
		expect(() => validateDungeonConfig({
			numUsers: -10,
			numEvents: 1000,
			seed: 'neg-users'
		})).toThrow(/numUsers must be a positive number/);
	});

	test('throws when numDays is zero', () => {
		initChance('zero-days');
		expect(() => validateDungeonConfig({
			numUsers: 100,
			numEvents: 1000,
			numDays: 0,
			seed: 'zero-days'
		})).toThrow(/numDays must be a positive number/);
	});

	test('clamps bornRecentBias above 1', () => {
		initChance('clamp-high');
		const config = validateDungeonConfig({
			numUsers: 100,
			numEvents: 1000,
			bornRecentBias: 5,
			seed: 'clamp-high'
		});
		expect(config.bornRecentBias).toBe(1);
	});

	test('clamps bornRecentBias below -1', () => {
		initChance('clamp-low');
		const config = validateDungeonConfig({
			numUsers: 100,
			numEvents: 1000,
			bornRecentBias: -3,
			seed: 'clamp-low'
		});
		expect(config.bornRecentBias).toBe(-1);
	});

	test('coerces non-finite bornRecentBias to 0', () => {
		initChance('clamp-nan');
		const config = validateDungeonConfig({
			numUsers: 100,
			numEvents: 1000,
			bornRecentBias: NaN,
			seed: 'clamp-nan'
		});
		expect(config.bornRecentBias).toBe(0);
	});

	test('does not add macro-resolved fields back onto the input config object', () => {
		// Earlier versions of the validator wrote bornRecentBias / percentUsersBornInDataset
		// / preExistingSpread back onto the caller's config (via `if (config.x === undefined)
		// config.x = macro.x`). The 1.3.0 hardening keeps these in local vars so the
		// caller's object is not silently extended with macro-derived values.
		initChance('no-mutate');
		const input = {
			numUsers: 100,
			numEvents: 1000,
			seed: 'no-mutate'
		};
		validateDungeonConfig(input);
		expect(input.bornRecentBias).toBeUndefined();
		expect(input.percentUsersBornInDataset).toBeUndefined();
		expect(input.preExistingSpread).toBeUndefined();
		expect(input.macro).toBeUndefined();
	});

	test('auto-batch triggers when avgEventsPerUserPerDay implies >= 2M events', () => {
		initChance('auto-batch-rate');
		// 1000 users × 30 days × 70 rate = 2.1M events
		const config = validateDungeonConfig({
			numUsers: 1000,
			numDays: 30,
			avgEventsPerUserPerDay: 70,
			seed: 'auto-batch-rate'
		});
		expect(config.numEvents).toBeGreaterThanOrEqual(2_000_000);
		expect(config.batchSize).toBe(1_000_000);
	});

	test('auto-batch does NOT trigger when explicit batchSize is provided', () => {
		initChance('auto-batch-explicit');
		const config = validateDungeonConfig({
			numUsers: 1000,
			numDays: 30,
			avgEventsPerUserPerDay: 70,
			batchSize: 500_000,
			seed: 'auto-batch-explicit'
		});
		expect(config.batchSize).toBe(500_000);
	});
});

describe('preExistingSpread is exposed on the resolved config', () => {
	test('default macro "flat" gives uniform spread', () => {
		initChance('spread-flat');
		const config = validateDungeonConfig({
			numUsers: 100,
			numEvents: 1000,
			seed: 'spread-flat'
		});
		expect(config.preExistingSpread).toBe('uniform');
	});

	test('macro "growth" gives pinned spread', () => {
		initChance('spread-growth');
		const config = validateDungeonConfig({
			numUsers: 100,
			numEvents: 1000,
			macro: 'growth',
			seed: 'spread-growth'
		});
		expect(config.preExistingSpread).toBe('pinned');
	});

	test('explicit preExistingSpread overrides macro', () => {
		initChance('spread-override');
		const config = validateDungeonConfig({
			numUsers: 100,
			numEvents: 1000,
			macro: 'growth',
			preExistingSpread: 'uniform',
			seed: 'spread-override'
		});
		expect(config.preExistingSpread).toBe('uniform');
	});
});

describe('soup presets no longer carry birth-distribution fields', () => {
	test('resolveSoup output does not include bornRecentBias or percentUsersBornInDataset', async () => {
		const { resolveSoup } = await import('../lib/templates/soup-presets.js');
		for (const name of ['steady', 'growth', 'spiky', 'seasonal', 'global', 'churny', 'chaotic']) {
			const result = resolveSoup(name, 90);
			expect(result.suggestedBornRecentBias).toBeUndefined();
			expect(result.suggestedPercentUsersBornInDataset).toBeUndefined();
		}
	});

	test('macro preset values drive birth distribution, not soup', () => {
		initChance('soup-no-birth');
		// soup: "growth" used to imply bornRecentBias=0.3, percentUsersBornInDataset=15.
		// Now soup is decoupled: the default macro ("flat") wins.
		const config = validateDungeonConfig({
			numUsers: 100,
			numEvents: 1000,
			soup: 'growth',
			seed: 'soup-no-birth'
		});
		expect(config.bornRecentBias).toBe(MACRO_PRESETS.flat.bornRecentBias);
		expect(config.percentUsersBornInDataset).toBe(MACRO_PRESETS.flat.percentUsersBornInDataset);
	});
});
