//@ts-nocheck
/**
 * v1.5.1 (TODO #8): Config API restructure.
 *
 * Three sub-objects — `credentials`, `switches`, `identity` — group related
 * top-level keys. Old top-level keys still honored for back-compat.
 * Precedence:
 *   sub-object only          → use sub-object value
 *   top-level only           → use top-level value (back-compat)
 *   both set                 → top-level wins + verbose warn
 *
 * `identity.hasAnonIds` is the one deprecated path: maps to
 * `avgDevicePerUser: 1` with a verbose warning.
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
		seed: 'restructure-test',
		...extra,
	};
}

describe('v1.5.1 config sub-object normalization', () => {
	test('credentials sub-object hoists into top-level', () => {
		initChance('creds-sub');
		const cfg = validateDungeonConfig(base({
			credentials: {
				token: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
				region: 'EU',
				projectId: '12345',
			},
		}));
		expect(cfg.token).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
		expect(cfg.region).toBe('EU');
	});

	test('switches sub-object hoists into top-level', () => {
		initChance('switches-sub');
		const cfg = validateDungeonConfig(base({
			switches: {
				hasLocation: true,
				hasCampaigns: true,
				hasSessionIds: true,
				hasAvatar: true,
			},
		}));
		expect(cfg.hasLocation).toBe(true);
		expect(cfg.hasCampaigns).toBe(true);
		expect(cfg.hasSessionIds).toBe(true);
		expect(cfg.hasAvatar).toBe(true);
	});

	test('identity sub-object hoists avgDevicePerUser + sessionTimeout', () => {
		initChance('identity-sub');
		const cfg = validateDungeonConfig(base({
			identity: { avgDevicePerUser: 3, sessionTimeout: 60 },
		}));
		expect(cfg.avgDevicePerUser).toBe(3);
		expect(cfg.sessionTimeout).toBe(60);
	});

	test('top-level wins when both top-level and sub-object set', () => {
		initChance('both-set');
		const cfg = validateDungeonConfig(base({
			region: 'US',
			credentials: { region: 'EU' }, // ignored — top-level wins
		}));
		expect(cfg.region).toBe('US');
	});

	test('back-compat: old top-level keys still work without sub-objects', () => {
		initChance('legacy-flat');
		const cfg = validateDungeonConfig(base({
			hasLocation: true,
			hasCampaigns: false,
			avgDevicePerUser: 2,
		}));
		expect(cfg.hasLocation).toBe(true);
		expect(cfg.avgDevicePerUser).toBe(2);
	});

	test('identity.hasAnonIds (deprecated) maps to avgDevicePerUser: 1', () => {
		initChance('deprecated-anonids');
		const cfg = validateDungeonConfig(base({
			identity: { hasAnonIds: true },
		}));
		expect(cfg.avgDevicePerUser).toBe(1);
	});

	test('identity.hasAnonIds does NOT clobber explicit avgDevicePerUser', () => {
		initChance('anonids-vs-avg');
		const cfg = validateDungeonConfig(base({
			identity: { hasAnonIds: true, avgDevicePerUser: 5 },
		}));
		expect(cfg.avgDevicePerUser).toBe(5);
	});

	test('alsoInferFunnels switch routes correctly', () => {
		initChance('alsoInfer');
		const cfg = validateDungeonConfig(base({
			switches: { alsoInferFunnels: true },
			events: [{ event: 'a' }, { event: 'b' }],
		}));
		expect(cfg).toBeDefined();
		// At minimum, the validator should not throw — full effect of
		// alsoInferFunnels is tested elsewhere.
	});

	test('mergeConfigSubObjects does not mutate the input config', () => {
		initChance('no-mutate');
		const input = base({
			credentials: { token: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', region: 'EU' },
			switches: { hasLocation: true },
			identity: { avgDevicePerUser: 2 },
		});
		// Snapshot before
		const snapshot = JSON.parse(JSON.stringify(input));
		validateDungeonConfig(input);
		// Input should be unchanged — sub-object hoisting only mutates the
		// validator's internal copy, never the caller's reference.
		expect(input.credentials).toEqual(snapshot.credentials);
		expect(input.switches).toEqual(snapshot.switches);
		expect(input.identity).toEqual(snapshot.identity);
		expect(input.token).toBeUndefined();
		expect(input.hasLocation).toBeUndefined();
		expect(input.avgDevicePerUser).toBeUndefined();
	});
});
