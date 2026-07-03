//@ts-nocheck
/**
 * P2.5: dead Persona fields (churnRate / activeWindow / soupOverride) are
 * @deprecated no-ops — nothing in lib/ reads them after validation. The
 * validator must emit a ONE-TIME warning when a dungeon sets any of them,
 * and stay silent when none are set.
 *
 * The once-per-process flag is module-level in config-validator.js; vitest
 * isolates module state per test file, so ordering inside this file is the
 * contract: the silence test runs FIRST (before the flag can be tripped),
 * then the warn-once test.
 */
import { describe, test, expect, vi, afterEach } from 'vitest';
import { validateDungeonConfig } from '../../lib/core/config-validator.js';
import { initChance } from '../../lib/utils/utils.js';

const WARN_MARKER = 'deprecated and unimplemented';

const baseConfig = (personas, seed) => ({
	numUsers: 50,
	numDays: 30,
	avgEventsPerUserPerDay: 2,
	seed,
	personas,
});

const deadFieldWarns = (spy) =>
	spy.mock.calls.filter(args => String(args[0]).includes(WARN_MARKER));

afterEach(() => vi.restoreAllMocks());

describe('P2.5 dead persona fields — one-time validator warning', () => {
	test('no warning when none of the dead fields are set', () => {
		const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		initChance('persona-dead-absent');
		const config = validateDungeonConfig(baseConfig(
			[{ name: 'casual', weight: 3 }, { name: 'power', weight: 1, eventMultiplier: 2 }],
			'persona-dead-absent',
		));
		expect(deadFieldWarns(spy)).toHaveLength(0);
		// Legacy default still applied (declared surface unchanged).
		expect(config.personas[0].churnRate).toBe(0);
	});

	test('warns exactly once across repeated validations, listing the set fields', () => {
		const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		initChance('persona-dead-set');
		validateDungeonConfig(baseConfig(
			[
				{ name: 'churner', weight: 1, churnRate: 0.4 },
				{ name: 'trial', weight: 1, soupOverride: { deviation: 2 } },
			],
			'persona-dead-set',
		));
		const warns = deadFieldWarns(spy);
		expect(warns).toHaveLength(1);
		// Message names the fields that were actually set — and only those.
		expect(warns[0][0]).toContain('churnRate');
		expect(warns[0][0]).toContain('soupOverride');
		expect(warns[0][0]).not.toContain('activeWindow');

		// Second validation with dead fields set (activeWindow this time) must
		// NOT warn again — once per process.
		initChance('persona-dead-set-2');
		validateDungeonConfig(baseConfig(
			[{ name: 'trial2', weight: 1, activeWindow: { maxDays: 14 } }],
			'persona-dead-set-2',
		));
		expect(deadFieldWarns(spy)).toHaveLength(1);
	});
});
