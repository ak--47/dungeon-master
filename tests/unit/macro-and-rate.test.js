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
import { validateDungeonConfig } from '../../lib/core/config-validator.js';
import { resolveMacro, MACRO_PRESETS, MACRO_PRESET_NAMES } from '../../lib/templates/macro-presets.js';
import { initChance, setDatasetNow, setDatasetBegin } from '../../lib/utils/utils.js';

const FIXED_NOW = 1706832000;
const FIXED_BEGIN = FIXED_NOW - 90 * 86400;
setDatasetNow(FIXED_NOW);
setDatasetBegin(FIXED_BEGIN);

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

	test('explicit dungeon-level fields override the macro preset (within strict clamps)', () => {
		initChance('macro-override');
		const config = validateDungeonConfig({
			numUsers: 100,
			numEvents: 1000,
			macro: 'growth',
			bornRecentBias: 0.4,            // user override (in safe band [-0.5, 0.5])
			percentUsersBornInDataset: 25,  // user override (within growth cap of 30)
			seed: 'macro-override'
		});
		expect(config.bornRecentBias).toBe(0.4);
		expect(config.percentUsersBornInDataset).toBe(25);
		// preExistingSpread came from macro: "growth"
		expect(config.preExistingSpread).toBe(MACRO_PRESETS.growth.preExistingSpread);
	});

	test('strict clamps fire on user-supplied born% above per-macro cap', () => {
		initChance('macro-clamp-born');
		const config = validateDungeonConfig({
			numUsers: 100,
			numEvents: 1000,
			macro: 'flat',
			percentUsersBornInDataset: 90,  // above flat's cap of 12
			seed: 'macro-clamp-born',
		});
		expect(config.percentUsersBornInDataset).toBe(12);
	});

	test('strict clamps fire on user-supplied bornRecentBias above 0.5', () => {
		initChance('macro-clamp-bias');
		const config = validateDungeonConfig({
			numUsers: 100,
			numEvents: 1000,
			bornRecentBias: 0.9,
			seed: 'macro-clamp-bias',
		});
		expect(config.bornRecentBias).toBe(0.5);
	});

	test('macro object form supports preset+overrides at config level (clamped)', () => {
		initChance('macro-obj');
		// macro-object overrides count as user-explicit and are subject to v1.5 strict
		// clamps. Setting percentUsersBornInDataset=75 via macro object on viral
		// (cap=55) clamps down to 55 with a warning. To go above the cap, switch
		// macros (here: viral is already the highest-born preset).
		const config = validateDungeonConfig({
			numUsers: 100,
			numEvents: 1000,
			macro: { preset: 'viral', percentUsersBornInDataset: 75 },
			seed: 'macro-obj'
		});
		expect(config.bornRecentBias).toBe(MACRO_PRESETS.viral.bornRecentBias);
		expect(config.percentUsersBornInDataset).toBe(55);
	});

	test('macro object form respects clamps even when only overriding bias', () => {
		initChance('macro-obj-bias');
		const config = validateDungeonConfig({
			numUsers: 100,
			numEvents: 1000,
			macro: { preset: 'flat', bornRecentBias: 0.9 }, // above [-0.5, 0.5] safe range
			seed: 'macro-obj-bias'
		});
		expect(config.bornRecentBias).toBe(0.5);
	});

	test('macro object form within preset-cap stays as-supplied', () => {
		initChance('macro-obj-noop');
		const config = validateDungeonConfig({
			numUsers: 100,
			numEvents: 1000,
			macro: { preset: 'growth', percentUsersBornInDataset: 25, bornRecentBias: 0.4 },
			seed: 'macro-obj-noop'
		});
		expect(config.percentUsersBornInDataset).toBe(25);
		expect(config.bornRecentBias).toBe(0.4);
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
		// v1.5 engine bunchiness fix (2026-05-09 round 2): preset values tuned with
		// the engine fix's ttc-constrained funnel anchoring + catch-all ttc=1d so
		// the documented expected `tail_ratio` shapes (0.84/0.86/1.13/1.89/0.80) are
		// reachable on the simplest dungeon (foobar) within ±25% per macro.
		// See `plans/ENGINE-BUNCHINESS/FIX.md` round-2 results table.
		// v1.5.1: presets ship `avgActiveDaysPerUser` defaults (except `flat`).
		expect(MACRO_PRESETS.flat).toEqual({
			bornRecentBias: 0,
			percentUsersBornInDataset: 12,
			preExistingSpread: 'uniform',
		});
		expect(MACRO_PRESETS.steady).toEqual({
			bornRecentBias: 0.1,
			percentUsersBornInDataset: 12,
			preExistingSpread: 'uniform',
			avgActiveDaysPerUser: 15,
		});
		expect(MACRO_PRESETS.growth).toEqual({
			bornRecentBias: 0.3,
			percentUsersBornInDataset: 30,
			preExistingSpread: 'pinned',
			avgActiveDaysPerUser: 10,
		});
		expect(MACRO_PRESETS.viral).toEqual({
			bornRecentBias: 0.6,
			percentUsersBornInDataset: 55,
			preExistingSpread: 'pinned',
			avgActiveDaysPerUser: 20,
		});
		expect(MACRO_PRESETS.decline).toEqual({
			bornRecentBias: -0.3,
			percentUsersBornInDataset: 5,
			preExistingSpread: 'uniform',
			avgActiveDaysPerUser: 5,
		});
	});

	test('preset percentUsersBornInDataset values match documented intent', () => {
		// Low-bias presets keep born% small (5-15) so cumulative-acquisition uptrend
		// stays modest; viral/growth carry larger born values to drive intentional
		// hockey-stick / clear-uptrend shape.
		expect(MACRO_PRESETS.flat.percentUsersBornInDataset).toBe(12);
		expect(MACRO_PRESETS.viral.percentUsersBornInDataset).toBe(55);
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

	test('clamps bornRecentBias above 0.5 (v1.5 strict bound)', () => {
		initChance('clamp-high');
		const config = validateDungeonConfig({
			numUsers: 100,
			numEvents: 1000,
			bornRecentBias: 5,
			seed: 'clamp-high'
		});
		expect(config.bornRecentBias).toBe(0.5);
	});

	test('clamps bornRecentBias below -0.5 (v1.5 strict bound)', () => {
		initChance('clamp-low');
		const config = validateDungeonConfig({
			numUsers: 100,
			numEvents: 1000,
			bornRecentBias: -3,
			seed: 'clamp-low'
		});
		expect(config.bornRecentBias).toBe(-0.5);
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
		// 5000 users × 30 days × 20 rate = 3M events (rate stays below v1.5 strict cap of 50)
		const config = validateDungeonConfig({
			numUsers: 5000,
			numDays: 30,
			avgEventsPerUserPerDay: 20,
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
		const { resolveSoup } = await import('../../lib/templates/soup-presets.js');
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

describe('datasetStart / datasetEnd parsing (v1.5.1)', () => {
	test('bare YYYY-MM-DD datasetStart pins to UTC start-of-day', () => {
		initChance('bare-date-start');
		const config = validateDungeonConfig({
			numUsers: 10,
			numEvents: 100,
			datasetStart: '2026-02-19',
			datasetEnd: '2026-05-10',
			seed: 'bare-date-start',
		});
		// datasetStart "2026-02-19" → 2026-02-19T00:00:00.000Z = unix 1771430400
		expect(config.datasetStart).toBe(Date.UTC(2026, 1, 19, 0, 0, 0) / 1000);
	});

	test('bare YYYY-MM-DD datasetEnd pins to UTC end-of-day', () => {
		initChance('bare-date-end');
		const config = validateDungeonConfig({
			numUsers: 10,
			numEvents: 100,
			datasetStart: '2026-02-19',
			datasetEnd: '2026-05-10',
			seed: 'bare-date-end',
		});
		// datasetEnd "2026-05-10" → 2026-05-10T23:59:59.999Z; .unix() rounds to 23:59:59 = unix 1778803199
		expect(config.datasetEnd).toBe(Math.floor(Date.UTC(2026, 4, 10, 23, 59, 59, 999) / 1000));
	});

	test('bare-date window numDays computed from start-of-day → end-of-day span', () => {
		initChance('bare-date-numdays');
		const config = validateDungeonConfig({
			numUsers: 10,
			numEvents: 100,
			datasetStart: '2026-05-01',
			datasetEnd: '2026-05-10',
			seed: 'bare-date-numdays',
		});
		// Span = 9 days + 23h 59m 59s ≈ 10 days when rounded
		expect(config.numDays).toBe(10);
	});

	test('full ISO string with explicit time is trusted as-is (UTC)', () => {
		initChance('iso-full');
		const config = validateDungeonConfig({
			numUsers: 10,
			numEvents: 100,
			datasetStart: '2026-02-19T12:34:56Z',
			datasetEnd: '2026-05-10T12:34:56Z',
			seed: 'iso-full',
		});
		expect(config.datasetStart).toBe(Date.UTC(2026, 1, 19, 12, 34, 56) / 1000);
		expect(config.datasetEnd).toBe(Date.UTC(2026, 4, 10, 12, 34, 56) / 1000);
	});

	test('unix-seconds input passes through unchanged', () => {
		initChance('unix-input');
		const start = 1771430400; // 2026-02-19T00:00:00Z
		const end = 1778803199;   // 2026-05-10T23:59:59Z
		const config = validateDungeonConfig({
			numUsers: 10,
			numEvents: 100,
			datasetStart: start,
			datasetEnd: end,
			seed: 'unix-input',
		});
		expect(config.datasetStart).toBe(start);
		expect(config.datasetEnd).toBe(end);
	});

	test('invalid date string throws with field name', () => {
		initChance('bad-date');
		expect(() => validateDungeonConfig({
			numUsers: 10,
			numEvents: 100,
			datasetStart: 'not a date',
			datasetEnd: '2026-05-10',
			seed: 'bad-date',
		})).toThrow(/datasetStart could not be parsed/);
	});

	test('invalid datasetEnd string throws with field name', () => {
		initChance('bad-date-end');
		expect(() => validateDungeonConfig({
			numUsers: 10,
			numEvents: 100,
			datasetStart: '2026-05-01',
			datasetEnd: 'definitely not a date',
			seed: 'bad-date-end',
		})).toThrow(/datasetEnd could not be parsed/);
	});

	test('bare-date window crosses month boundary correctly', () => {
		initChance('cross-month');
		const config = validateDungeonConfig({
			numUsers: 10,
			numEvents: 100,
			datasetStart: '2026-01-29',
			datasetEnd: '2026-02-04',
			seed: 'cross-month',
		});
		expect(config.datasetStart).toBe(Date.UTC(2026, 0, 29, 0, 0, 0) / 1000);
		expect(config.datasetEnd).toBe(Math.floor(Date.UTC(2026, 1, 4, 23, 59, 59, 999) / 1000));
		expect(config.numDays).toBe(7);
	});

	test('bare-date window crosses year boundary correctly', () => {
		initChance('cross-year');
		const config = validateDungeonConfig({
			numUsers: 10,
			numEvents: 100,
			datasetStart: '2025-12-28',
			datasetEnd: '2026-01-03',
			seed: 'cross-year',
		});
		expect(config.datasetStart).toBe(Date.UTC(2025, 11, 28, 0, 0, 0) / 1000);
		expect(config.datasetEnd).toBe(Math.floor(Date.UTC(2026, 0, 3, 23, 59, 59, 999) / 1000));
		expect(config.numDays).toBe(7);
	});

	test('bare-date window handles leap day (2024-02-29)', () => {
		initChance('leap-day');
		const config = validateDungeonConfig({
			numUsers: 10,
			numEvents: 100,
			datasetStart: '2024-02-28',
			datasetEnd: '2024-03-01',
			seed: 'leap-day',
		});
		expect(config.datasetStart).toBe(Date.UTC(2024, 1, 28, 0, 0, 0) / 1000);
		expect(config.datasetEnd).toBe(Math.floor(Date.UTC(2024, 2, 1, 23, 59, 59, 999) / 1000));
		expect(config.numDays).toBe(3);
	});

	test('single-day window (start === end) produces 1 day', () => {
		initChance('single-day');
		const config = validateDungeonConfig({
			numUsers: 10,
			numEvents: 100,
			datasetStart: '2026-05-10',
			datasetEnd: '2026-05-10',
			seed: 'single-day',
		});
		expect(config.datasetStart).toBe(Date.UTC(2026, 4, 10, 0, 0, 0) / 1000);
		expect(config.datasetEnd).toBe(Math.floor(Date.UTC(2026, 4, 10, 23, 59, 59, 999) / 1000));
		expect(config.numDays).toBe(1);
	});

	test('end-before-start throws', () => {
		initChance('end-before-start');
		expect(() => validateDungeonConfig({
			numUsers: 10,
			numEvents: 100,
			datasetStart: '2026-05-10',
			datasetEnd: '2026-05-01',
			seed: 'end-before-start',
		})).toThrow(/datasetEnd .* must be after datasetStart/);
	});

	test('only datasetStart provided throws', () => {
		initChance('only-start');
		expect(() => validateDungeonConfig({
			numUsers: 10,
			numEvents: 100,
			datasetStart: '2026-05-10',
			seed: 'only-start',
		})).toThrow(/datasetStart and datasetEnd must be specified together/);
	});

	test('only datasetEnd provided throws', () => {
		initChance('only-end');
		expect(() => validateDungeonConfig({
			numUsers: 10,
			numEvents: 100,
			datasetEnd: '2026-05-10',
			seed: 'only-end',
		})).toThrow(/datasetStart and datasetEnd must be specified together/);
	});

	test('ISO with non-UTC timezone offset normalizes to UTC unix', () => {
		initChance('iso-tz');
		const config = validateDungeonConfig({
			numUsers: 10,
			numEvents: 100,
			datasetStart: '2026-02-19T08:00:00-08:00', // = 2026-02-19T16:00:00Z
			datasetEnd: '2026-05-10T08:00:00-08:00',   // = 2026-05-10T16:00:00Z
			seed: 'iso-tz',
		});
		expect(config.datasetStart).toBe(Date.UTC(2026, 1, 19, 16, 0, 0) / 1000);
		expect(config.datasetEnd).toBe(Date.UTC(2026, 4, 10, 16, 0, 0) / 1000);
	});

	test('ISO with millisecond precision is preserved (truncated to seconds)', () => {
		initChance('iso-ms');
		const config = validateDungeonConfig({
			numUsers: 10,
			numEvents: 100,
			datasetStart: '2026-02-19T12:34:56.789Z',
			datasetEnd: '2026-05-10T12:34:56.789Z',
			seed: 'iso-ms',
		});
		// .unix() returns whole seconds — ms truncated
		expect(config.datasetStart).toBe(Date.UTC(2026, 1, 19, 12, 34, 56) / 1000);
		expect(config.datasetEnd).toBe(Date.UTC(2026, 4, 10, 12, 34, 56) / 1000);
	});

	test('unix milliseconds (>1e12) auto-detected and converted to seconds', () => {
		initChance('unix-ms');
		const startMs = Date.UTC(2026, 1, 19, 0, 0, 0); // ms
		const endMs = Date.UTC(2026, 4, 10, 23, 59, 59);
		const config = validateDungeonConfig({
			numUsers: 10,
			numEvents: 100,
			datasetStart: startMs,
			datasetEnd: endMs,
			seed: 'unix-ms',
		});
		expect(config.datasetStart).toBe(Math.floor(startMs / 1000));
		expect(config.datasetEnd).toBe(Math.floor(endMs / 1000));
	});

	test('zero / negative unix throws', () => {
		initChance('zero-unix');
		expect(() => validateDungeonConfig({
			numUsers: 10, numEvents: 100,
			datasetStart: 0, datasetEnd: 1771430400,
			seed: 'zero-unix',
		})).toThrow(/datasetStart must be a positive finite number/);
		expect(() => validateDungeonConfig({
			numUsers: 10, numEvents: 100,
			datasetStart: -1, datasetEnd: 1771430400,
			seed: 'neg-unix',
		})).toThrow(/datasetStart must be a positive finite number/);
	});

	test('NaN unix throws', () => {
		initChance('nan-unix');
		expect(() => validateDungeonConfig({
			numUsers: 10, numEvents: 100,
			datasetStart: NaN, datasetEnd: 1771430400,
			seed: 'nan-unix',
		})).toThrow(/datasetStart must be a positive finite number/);
	});

	test('user-supplied numDays is ignored when datasetStart+End are pinned (warn-only)', () => {
		initChance('numdays-conflict');
		const config = validateDungeonConfig({
			numUsers: 10,
			numEvents: 100,
			datasetStart: '2026-05-01',
			datasetEnd: '2026-05-10',
			numDays: 999, // ignored
			seed: 'numdays-conflict',
		});
		// numDays derived from window, not user-supplied
		expect(config.numDays).toBe(10);
	});

	test('mixed types: bare-date start + ISO-with-time end both parse correctly', () => {
		initChance('mixed-types');
		const config = validateDungeonConfig({
			numUsers: 10,
			numEvents: 100,
			datasetStart: '2026-02-19',                  // bare → start of UTC day
			datasetEnd: '2026-05-10T15:30:45Z',          // explicit time
			seed: 'mixed-types',
		});
		expect(config.datasetStart).toBe(Date.UTC(2026, 1, 19, 0, 0, 0) / 1000);
		expect(config.datasetEnd).toBe(Date.UTC(2026, 4, 10, 15, 30, 45) / 1000);
	});

	test('mixed types: unix start + bare-date end', () => {
		initChance('mixed-unix-bare');
		const startUnix = Date.UTC(2026, 1, 19, 0, 0, 0) / 1000;
		const config = validateDungeonConfig({
			numUsers: 10,
			numEvents: 100,
			datasetStart: startUnix,
			datasetEnd: '2026-05-10', // bare → end of UTC day
			seed: 'mixed-unix-bare',
		});
		expect(config.datasetStart).toBe(startUnix);
		expect(config.datasetEnd).toBe(Math.floor(Date.UTC(2026, 4, 10, 23, 59, 59, 999) / 1000));
	});

	test('bare-date parsing is timezone-independent (deterministic across machines)', () => {
		initChance('tz-indep');
		// This test would FAIL pre-1.5.1 on non-UTC machines because dayjs(value)
		// without .utc() uses local timezone for bare dates.
		const config1 = validateDungeonConfig({
			numUsers: 10, numEvents: 100,
			datasetStart: '2026-05-10', datasetEnd: '2026-05-20',
			seed: 'tz1',
		});
		const config2 = validateDungeonConfig({
			numUsers: 10, numEvents: 100,
			datasetStart: '2026-05-10', datasetEnd: '2026-05-20',
			seed: 'tz2',
		});
		expect(config1.datasetStart).toBe(config2.datasetStart);
		expect(config1.datasetEnd).toBe(config2.datasetEnd);
		// Specifically: start should be exactly midnight UTC, NOT shifted by local TZ offset
		expect(config1.datasetStart % 86400).toBe(0); // multiple of 86400 = aligned to UTC day start
	});

	test('365-day pinned window resolves numDays=365', () => {
		initChance('full-year');
		const config = validateDungeonConfig({
			numUsers: 10, numEvents: 100,
			datasetStart: '2026-01-01',
			datasetEnd: '2026-12-31',
			seed: 'full-year',
		});
		expect(config.numDays).toBe(365);
	});

	test('366-day leap year pinned window resolves numDays=366', () => {
		initChance('leap-year');
		const config = validateDungeonConfig({
			numUsers: 10, numEvents: 100,
			datasetStart: '2024-01-01',
			datasetEnd: '2024-12-31',
			seed: 'leap-year',
		});
		expect(config.numDays).toBe(366);
	});

	test('bare-date end is strictly later than corresponding start (sanity)', () => {
		initChance('end-after-start-sanity');
		// Same date passed to both: end should be later by ~86399 seconds
		const config = validateDungeonConfig({
			numUsers: 10, numEvents: 100,
			datasetStart: '2026-05-10',
			datasetEnd: '2026-05-10',
			seed: 'end-after-start-sanity',
		});
		const delta = config.datasetEnd - config.datasetStart;
		expect(delta).toBeGreaterThanOrEqual(86399); // at least 23h59m59s
		expect(delta).toBeLessThan(86400);            // strictly less than full day
	});

	test('quiet by default: clamp-triggering config emits NO console output when verbose unset', () => {
		initChance('quiet-default');
		const warn = console.warn;
		const log = console.log;
		const messages = [];
		console.warn = (...args) => messages.push(['warn', args.join(' ')]);
		console.log = (...args) => messages.push(['log', args.join(' ')]);
		try {
			validateDungeonConfig({
				numUsers: 100,
				numEvents: 1000,
				macro: 'flat',
				percentUsersBornInDataset: 90, // would trigger clamp 2 if verbose
				bornRecentBias: 0.9,            // would trigger clamp 3 if verbose
				avgEventsPerUserPerDay: 100,    // would trigger clamp 5 if verbose
				avgActiveDaysPerUser: 999,      // would trigger clamp 6 if verbose
				numDays: 5,                     // would trigger numDays<14 warn if verbose
				seed: 'quiet-default',
			});
		} finally {
			console.warn = warn;
			console.log = log;
		}
		expect(messages).toEqual([]);
	});

	test('quiet by default: bare-date pinned window emits NO output when verbose unset', () => {
		initChance('quiet-bare-date');
		const warn = console.warn;
		const log = console.log;
		const messages = [];
		console.warn = (...args) => messages.push(['warn', args.join(' ')]);
		console.log = (...args) => messages.push(['log', args.join(' ')]);
		try {
			validateDungeonConfig({
				numUsers: 100,
				numEvents: 1000,
				datasetStart: '2026-02-19',
				datasetEnd: '2026-05-10',
				numDays: 999, // conflicts with pinned window — warn-on-verbose path
				seed: 'quiet-bare-date',
			});
		} finally {
			console.warn = warn;
			console.log = log;
		}
		expect(messages).toEqual([]);
	});

	test('verbose=true: clamp warnings are emitted', () => {
		initChance('verbose-on');
		const warn = console.warn;
		const messages = [];
		console.warn = (...args) => messages.push(args.join(' '));
		try {
			validateDungeonConfig({
				numUsers: 100,
				numEvents: 1000,
				macro: 'flat',
				percentUsersBornInDataset: 90,
				bornRecentBias: 0.9,
				verbose: true,
				seed: 'verbose-on',
			});
		} finally {
			console.warn = warn;
		}
		// Both clamp warnings should fire
		expect(messages.some(m => /clamped to 12/.test(m))).toBe(true);
		expect(messages.some(m => /clamped to 0\.5/.test(m))).toBe(true);
	});

	test('verbose=true: rate clamp + active-days clamp both warn', () => {
		initChance('verbose-rate-active');
		const warn = console.warn;
		const messages = [];
		console.warn = (...args) => messages.push(args.join(' '));
		try {
			validateDungeonConfig({
				numUsers: 100,
				numEvents: 1000,
				avgEventsPerUserPerDay: 200,
				avgActiveDaysPerUser: 999,
				numDays: 30,
				verbose: true,
				seed: 'verbose-rate-active',
			});
		} finally {
			console.warn = warn;
		}
		expect(messages.some(m => /avgEventsPerUserPerDay=200 clamped to 50/.test(m))).toBe(true);
		expect(messages.some(m => /avgActiveDaysPerUser=999/.test(m))).toBe(true);
	});

	test('quiet by default: isStrictEvent auto-promote does NOT warn unless verbose', () => {
		initChance('quiet-autopromote');
		const warn = console.warn;
		const messages = [];
		console.warn = (...args) => messages.push(args.join(' '));
		try {
			validateDungeonConfig({
				numUsers: 100,
				numEvents: 1000,
				events: [
					{ event: 'View' },          // appears in funnel — would auto-promote
					{ event: 'Sign Up' },        // appears in funnel — would auto-promote
				],
				funnels: [
					{ sequence: ['View', 'Sign Up'], conversionRate: 50, isFirstFunnel: true },
				],
				seed: 'quiet-autopromote',
			});
		} finally {
			console.warn = warn;
		}
		expect(messages.filter(m => /Auto-promoted/.test(m))).toEqual([]);
	});

	test('verbose=true: isStrictEvent auto-promote warns', () => {
		initChance('verbose-autopromote');
		const warn = console.warn;
		const messages = [];
		console.warn = (...args) => messages.push(args.join(' '));
		try {
			validateDungeonConfig({
				numUsers: 100,
				numEvents: 1000,
				events: [
					{ event: 'View' },
					{ event: 'Sign Up' },
				],
				funnels: [
					{ sequence: ['View', 'Sign Up'], conversionRate: 50, isFirstFunnel: true },
				],
				verbose: true,
				seed: 'verbose-autopromote',
			});
		} finally {
			console.warn = warn;
		}
		expect(messages.filter(m => /Auto-promoted/.test(m)).length).toBeGreaterThan(0);
	});

	test('bare-date end on a Wednesday lands at Wednesday 23:59:59 UTC', () => {
		initChance('wed-pin');
		// 2026-05-13 is a Wednesday
		const config = validateDungeonConfig({
			numUsers: 10, numEvents: 100,
			datasetStart: '2026-05-01',
			datasetEnd: '2026-05-13',
			seed: 'wed-pin',
		});
		const endDate = new Date(config.datasetEnd * 1000);
		expect(endDate.getUTCDay()).toBe(3); // Wednesday
		expect(endDate.getUTCHours()).toBe(23);
		expect(endDate.getUTCMinutes()).toBe(59);
		expect(endDate.getUTCSeconds()).toBe(59);
	});
});
