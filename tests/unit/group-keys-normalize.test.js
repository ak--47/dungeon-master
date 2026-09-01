//@ts-nocheck
/**
 * v1.6.4 (P3-5): `groupKeys` accepts a named-object form alongside the legacy
 * positional tuple. The validator normalizes everything to tuples, so the
 * generators, hooks, and verifier only ever see one shape.
 *
 *   ["company_id", 50]                          → unchanged
 *   ["team_id", 200, ["Deploy"]]                → unchanged
 *   { key: "org_id", cardinality: 25 }          → ["org_id", 25]
 *   { key, cardinality, events: [...] }         → [key, cardinality, events]
 */

import { describe, test, expect } from 'vitest';
import { validateDungeonConfig } from '../../lib/core/config-validator.js';
import { initChance, setDatasetNow, setDatasetBegin } from '../../lib/utils/utils.js';

const FIXED_NOW = 1706832000;
const FIXED_BEGIN = FIXED_NOW - 30 * 86400;
setDatasetNow(FIXED_NOW);
setDatasetBegin(FIXED_BEGIN);

function base(extra = {}) {
	return {
		numUsers: 50,
		numDays: 14,
		avgEventsPerUserPerDay: 2,
		seed: 'group-keys-test',
		...extra,
	};
}

describe('v1.6.4 groupKeys normalization', () => {
	test('tuple form passes through unchanged', () => {
		initChance('gk-tuple');
		const cfg = validateDungeonConfig(base({
			groupKeys: [['company_id', 50], ['team_id', 200, ['Deploy']]],
		}));
		expect(cfg.groupKeys).toEqual([['company_id', 50], ['team_id', 200, ['Deploy']]]);
	});

	test('named form normalizes to a 2-tuple when events is omitted', () => {
		initChance('gk-named');
		const cfg = validateDungeonConfig(base({
			groupKeys: [{ key: 'org_id', cardinality: 25 }],
		}));
		expect(cfg.groupKeys).toEqual([['org_id', 25]]);
	});

	test('named form normalizes to a 3-tuple when events is present', () => {
		initChance('gk-named-events');
		const cfg = validateDungeonConfig(base({
			groupKeys: [{ key: 'workspace_id', cardinality: 80, events: ['Save', 'Share'] }],
		}));
		expect(cfg.groupKeys).toEqual([['workspace_id', 80, ['Save', 'Share']]]);
	});

	test('an empty events array collapses to the 2-tuple form (all events)', () => {
		initChance('gk-empty-events');
		const cfg = validateDungeonConfig(base({
			groupKeys: [{ key: 'org_id', cardinality: 25, events: [] }],
		}));
		expect(cfg.groupKeys).toEqual([['org_id', 25]]);
	});

	test('both forms may be mixed in one array', () => {
		initChance('gk-mixed');
		const cfg = validateDungeonConfig(base({
			groupKeys: [['company_id', 50], { key: 'org_id', cardinality: 25 }],
		}));
		expect(cfg.groupKeys).toEqual([['company_id', 50], ['org_id', 25]]);
	});

	test('omitted groupKeys stays an empty array', () => {
		initChance('gk-absent');
		const cfg = validateDungeonConfig(base({}));
		expect(cfg.groupKeys).toEqual([]);
	});

	test('named form throws on a missing or empty key', () => {
		initChance('gk-bad-key');
		expect(() => validateDungeonConfig(base({
			groupKeys: [{ cardinality: 25 }],
		}))).toThrow(/non-empty string "key"/);
		expect(() => validateDungeonConfig(base({
			groupKeys: [{ key: '', cardinality: 25 }],
		}))).toThrow(/non-empty string "key"/);
	});

	test('named form throws on a missing or non-positive cardinality', () => {
		initChance('gk-bad-card');
		expect(() => validateDungeonConfig(base({
			groupKeys: [{ key: 'org_id' }],
		}))).toThrow(/"cardinality" >= 1/);
		expect(() => validateDungeonConfig(base({
			groupKeys: [{ key: 'org_id', cardinality: 0 }],
		}))).toThrow(/"cardinality" >= 1/);
	});

	test('named form throws when events is present but not an array', () => {
		initChance('gk-bad-events');
		expect(() => validateDungeonConfig(base({
			groupKeys: [{ key: 'org_id', cardinality: 5, events: 'Save' }],
		}))).toThrow(/"events" must be an array/);
	});

	test('a non-array, non-object entry throws with its index', () => {
		initChance('gk-garbage');
		expect(() => validateDungeonConfig(base({
			groupKeys: [['company_id', 50], 'org_id'],
		}))).toThrow(/groupKeys\[1\]/);
	});
});
