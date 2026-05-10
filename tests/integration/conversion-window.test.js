//@ts-nocheck
/**
 * v1.5 Funnel.conversionWindowDays tests.
 *
 * Mixpanel funnel rule (`backend/arb/reader/funnels/conversion_window.cpp`):
 *   `is_within_conversion_window(t1, t2, length)` returns
 *   `t1 < t2 + length_seconds * 1000`  (strict `<`)
 *
 * Generation contract:
 *   - default 30 days (Mixpanel UI default)
 *   - auto-bump to `min(180, ceil(timeToConvert/24 * 1.5))` if `timeToConvert` ≥ 30d
 *   - hard cap 180 days (Mixpanel max)
 *   - generated funnel runs satisfy `lastStep - firstStep < windowMs - 1`
 *
 * Verifier auto-application: `verifyDungeon` reads `conversionWindowDays` from
 * the matching funnel config and applies it to `evaluateFunnel`.
 */

import { describe, test, expect } from 'vitest';
import DUNGEON_MASTER from '../../index.js';
import { validateDungeonConfig } from '../../lib/core/config-validator.js';

const baseConfig = (overrides = {}) => ({
	seed: 'conv-window-test',
	datasetStart: '2025-09-01T00:00:00Z',
	datasetEnd: '2025-10-01T00:00:00Z',
	numUsers: 50,
	avgEventsPerUserPerDay: 3,
	events: [
		{ event: 'sign up', isFirstEvent: true },
		{ event: 'onboard' },
		{ event: 'purchase' },
	],
	funnels: [{
		sequence: ['sign up', 'onboard', 'purchase'],
		isFirstFunnel: true,
		conversionRate: 80,
		timeToConvert: 4, // 4 hours
		order: 'sequential',
	}],
	writeToDisk: false,
	verbose: false,
	...overrides,
});

describe('v1.5 Funnel.conversionWindowDays — validator defaults', () => {
	test('default = 30 days when timeToConvert is short', () => {
		const cfg = baseConfig();
		const validated = validateDungeonConfig(JSON.parse(JSON.stringify({ ...cfg })));
		const f = validated.funnels.find(f => f.sequence?.[0] === 'sign up');
		expect(f.conversionWindowDays).toBe(30);
	});

	test('auto-bump when timeToConvert (hours/24) exceeds 30 days', () => {
		// timeToConvert = 720 hours = 30 days. ceil(30 * 1.5) = 45.
		const cfg = baseConfig({
			funnels: [{
				sequence: ['sign up', 'onboard', 'purchase'],
				isFirstFunnel: true,
				timeToConvert: 720,
			}],
		});
		const validated = validateDungeonConfig(cfg);
		const f = validated.funnels[0];
		expect(f.conversionWindowDays).toBe(45);
	});

	test('auto-bump caps at 180 days (Mixpanel max)', () => {
		// timeToConvert = 200 days * 24 hours = 4800h. ceil(200 * 1.5) = 300, capped at 180.
		const cfg = baseConfig({
			funnels: [{
				sequence: ['sign up', 'onboard', 'purchase'],
				isFirstFunnel: true,
				timeToConvert: 200 * 24,
			}],
		});
		const validated = validateDungeonConfig(cfg);
		const f = validated.funnels[0];
		expect(f.conversionWindowDays).toBe(180);
	});

	test('throws when explicit conversionWindowDays > 180', () => {
		expect(() => validateDungeonConfig(baseConfig({
			funnels: [{
				sequence: ['sign up', 'onboard', 'purchase'],
				conversionWindowDays: 200,
			}],
		}))).toThrow(/180/);
	});

	test('throws on negative conversionWindowDays', () => {
		expect(() => validateDungeonConfig(baseConfig({
			funnels: [{
				sequence: ['sign up', 'onboard', 'purchase'],
				conversionWindowDays: -1,
			}],
		}))).toThrow(/positive/);
	});

	test('explicit conversionWindowDays preserved (not auto-bumped)', () => {
		const cfg = baseConfig({
			funnels: [{
				sequence: ['sign up', 'onboard', 'purchase'],
				timeToConvert: 100, // 100 hours = ~4d (under default 30d)
				conversionWindowDays: 7, // explicit shorter window
			}],
		});
		const validated = validateDungeonConfig(cfg);
		expect(validated.funnels[0].conversionWindowDays).toBe(7);
	});
});

describe('v1.5 Funnel.conversionWindowDays — generation cap', () => {
	test('generated funnel runs satisfy lastStep - firstStep < windowMs - 1', async () => {
		// Use a 1-day conversion window with timeToConvert that would naturally
		// exceed it. The generator must scale down the funnel span to fit.
		const result = await DUNGEON_MASTER(baseConfig({
			seed: 'gen-cap',
			funnels: [{
				sequence: ['sign up', 'onboard', 'purchase'],
				isFirstFunnel: true,
				conversionRate: 100,
				timeToConvert: 48, // 48h = 2 days
				conversionWindowDays: 1, // window forces compression
				order: 'sequential',
			}],
		}));
		const events = Array.from(result.eventData);
		// Group by user
		const byUser = new Map();
		for (const e of events) {
			if (!byUser.has(e.user_id)) byUser.set(e.user_id, []);
			byUser.get(e.user_id).push(e);
		}
		const windowMs = 1 * 86400000;
		// Verify: within each user, the gap between sign up and purchase is < window - 1ms.
		let convertedUsers = 0;
		for (const [, evs] of byUser) {
			evs.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
			const su = evs.find(e => e.event === 'sign up');
			const pu = evs.find(e => e.event === 'purchase');
			if (!su || !pu) continue;
			const gap = Date.parse(pu.time) - Date.parse(su.time);
			expect(gap).toBeLessThan(windowMs);
			convertedUsers++;
		}
		expect(convertedUsers).toBeGreaterThan(0);
	});
});
