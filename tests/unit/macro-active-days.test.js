//@ts-nocheck
/**
 * v1.5.1: per-macro `avgActiveDaysPerUser` defaults.
 *
 * Macro presets now ship sensible-default active-day concentrations:
 *   flat     → undefined (legacy: every window-day potentially active)
 *   steady   → 15
 *   growth   → 10
 *   viral    → 20
 *   decline  → 5
 *
 * The default applies ONLY when the dungeon doesn't set `avgActiveDaysPerUser`
 * explicitly — top-level user values continue to win.
 */

import { describe, test, expect } from 'vitest';
import { MACRO_PRESETS, resolveMacro } from '../../lib/templates/macro-presets.js';
import { validateDungeonConfig } from '../../lib/core/config-validator.js';
import { initChance, setDatasetNow, setDatasetBegin } from '../../lib/utils/utils.js';

const FIXED_NOW = 1706832000;
const FIXED_BEGIN = FIXED_NOW - 90 * 86400;
setDatasetNow(FIXED_NOW);
setDatasetBegin(FIXED_BEGIN);

describe('v1.5.1 per-macro avgActiveDaysPerUser defaults', () => {
	test('preset table includes expected active-day fields', () => {
		expect(MACRO_PRESETS.flat.avgActiveDaysPerUser).toBeUndefined();
		expect(MACRO_PRESETS.steady.avgActiveDaysPerUser).toBe(15);
		expect(MACRO_PRESETS.growth.avgActiveDaysPerUser).toBe(10);
		expect(MACRO_PRESETS.viral.avgActiveDaysPerUser).toBe(20);
		expect(MACRO_PRESETS.decline.avgActiveDaysPerUser).toBe(5);
	});

	test('resolveMacro returns the preset default when no override', () => {
		expect(resolveMacro('steady').avgActiveDaysPerUser).toBe(15);
		expect(resolveMacro('growth').avgActiveDaysPerUser).toBe(10);
		expect(resolveMacro('viral').avgActiveDaysPerUser).toBe(20);
		expect(resolveMacro('decline').avgActiveDaysPerUser).toBe(5);
		expect(resolveMacro('flat').avgActiveDaysPerUser).toBeUndefined();
	});

	test('resolveMacro override wins via preset+overrides object', () => {
		const resolved = resolveMacro({ preset: 'growth', avgActiveDaysPerUser: 42 });
		expect(resolved.avgActiveDaysPerUser).toBe(42);
	});

	test('flat default macro: no avgActiveDaysPerUser set', () => {
		const resolved = resolveMacro(undefined);
		expect(resolved.avgActiveDaysPerUser).toBeUndefined();
	});
});

describe('v1.5.1 validator merges macro avgActiveDaysPerUser default', () => {
	test('steady macro with no explicit avgActiveDaysPerUser → defaults to 15', () => {
		initChance('macro-active-steady');
		const config = validateDungeonConfig({
			numUsers: 100,
			numDays: 60,
			avgEventsPerUserPerDay: 2,
			macro: 'steady',
			seed: 'macro-active-steady',
		});
		expect(config.avgActiveDaysPerUser).toBe(15);
	});

	test('viral macro defaults to 20', () => {
		initChance('macro-active-viral');
		const config = validateDungeonConfig({
			numUsers: 100,
			numDays: 60,
			avgEventsPerUserPerDay: 2,
			macro: 'viral',
			seed: 'macro-active-viral',
		});
		expect(config.avgActiveDaysPerUser).toBe(20);
	});

	test('explicit avgActiveDaysPerUser wins over macro default', () => {
		initChance('macro-active-override');
		const config = validateDungeonConfig({
			numUsers: 100,
			numDays: 60,
			avgEventsPerUserPerDay: 2,
			macro: 'growth',
			avgActiveDaysPerUser: 7,
			seed: 'macro-active-override',
		});
		expect(config.avgActiveDaysPerUser).toBe(7);
	});

	test('flat macro: no default set (legacy behavior)', () => {
		initChance('macro-active-flat');
		const config = validateDungeonConfig({
			numUsers: 100,
			numDays: 60,
			avgEventsPerUserPerDay: 2,
			macro: 'flat',
			seed: 'macro-active-flat',
		});
		expect(config.avgActiveDaysPerUser).toBeUndefined();
	});

	test('no macro set: stays undefined', () => {
		initChance('macro-active-none');
		const config = validateDungeonConfig({
			numUsers: 100,
			numDays: 60,
			avgEventsPerUserPerDay: 2,
			seed: 'macro-active-none',
		});
		expect(config.avgActiveDaysPerUser).toBeUndefined();
	});

	test('decline macro defaults to 5', () => {
		initChance('macro-active-decline');
		const config = validateDungeonConfig({
			numUsers: 100,
			numDays: 60,
			avgEventsPerUserPerDay: 2,
			macro: 'decline',
			seed: 'macro-active-decline',
		});
		expect(config.avgActiveDaysPerUser).toBe(5);
	});
});
