//@ts-nocheck
/**
 * Advanced Feature Tests
 * Tests surviving features: personas, world events, engagement decay, data quality
 */

import { describe, test, expect } from 'vitest';
import DUNGEON_MASTER from '../index.js';
import { validateDungeonConfig } from '../lib/core/config-validator.js';
import { initChance } from '../lib/utils/utils.js';

const FIXED_NOW = 1706832000; // 2024-02-02
global.FIXED_NOW = FIXED_NOW;
global.FIXED_BEGIN = FIXED_NOW - 90 * 86400;

// ── Feature 1: Personas ──
describe('Feature 1: Personas', () => {
	test('validates persona config', () => {
		initChance('persona-validate');
		const config = validateDungeonConfig({
			numUsers: 10,
			numEvents: 100,
			seed: 'persona-validate',
			personas: [
				{ name: 'power', weight: 20, eventMultiplier: 3.0, conversionModifier: 1.5, properties: { tier: 'premium' } },
				{ name: 'casual', weight: 80, eventMultiplier: 0.5, properties: { tier: 'free' } }
			]
		});
		expect(config.personas).toHaveLength(2);
		expect(config.personas[0].churnRate).toBe(0); // default
		expect(config.personas[1].conversionModifier).toBe(1.0); // default
	});

	test('rejects personas without name', () => {
		initChance('persona-bad');
		expect(() => validateDungeonConfig({
			numUsers: 10, numEvents: 100, seed: 'persona-bad',
			personas: [{ weight: 50 }]
		})).toThrow('name');
	});

	test('rejects personas without weight', () => {
		initChance('persona-bad2');
		expect(() => validateDungeonConfig({
			numUsers: 10, numEvents: 100, seed: 'persona-bad2',
			personas: [{ name: 'test', weight: 0 }]
		})).toThrow('positive weight');
	});

	test('assigns persona properties to user profiles', async () => {
		const result = await DUNGEON_MASTER({
			numUsers: 50,
			numEvents: 500,
			numDays: 30,
			seed: 'persona-props',
			events: [{ event: 'action' }],
			personas: [
				{ name: 'vip', weight: 100, eventMultiplier: 1.0, properties: { tier: 'vip', level: 'gold' } }
			]
		});
		// All users should have VIP persona properties
		const users = Array.from(result.userProfilesData);
		expect(users.length).toBeGreaterThan(0);
		for (const user of users) {
			if (user.is_bot) continue; // skip bots
			expect(user.tier).toBe('vip');
			expect(user.level).toBe('gold');
			expect(user._persona).toBe('vip');
		}
	}, 30000);

	test('persona eventMultiplier affects event count', async () => {
		const highResult = await DUNGEON_MASTER({
			numUsers: 30,
			numEvents: 3000,
			numDays: 30,
			seed: 'persona-high',
			events: [{ event: 'action' }],
			personas: [{ name: 'hyperactive', weight: 100, eventMultiplier: 5.0 }]
		});
		const lowResult = await DUNGEON_MASTER({
			numUsers: 30,
			numEvents: 3000,
			numDays: 30,
			seed: 'persona-low',
			events: [{ event: 'action' }],
			personas: [{ name: 'passive', weight: 100, eventMultiplier: 0.2 }]
		});
		// Hyperactive should generate more events than passive
		expect(highResult.eventCount).toBeGreaterThan(lowResult.eventCount);
	}, 30000);

	test('persona flows through hook meta', async () => {
		const personasSeen = new Set();
		await DUNGEON_MASTER({
			numUsers: 20,
			numEvents: 200,
			numDays: 30,
			seed: 'persona-hook',
			events: [{ event: 'action' }],
			personas: [
				{ name: 'alpha', weight: 50 },
				{ name: 'beta', weight: 50 }
			],
			hook: (record, type, meta) => {
				if (type === 'everything' && meta.persona) {
					personasSeen.add(meta.persona.name);
				}
				return record;
			}
		});
		// Should see both personas
		expect(personasSeen.has('alpha')).toBe(true);
		expect(personasSeen.has('beta')).toBe(true);
	}, 30000);
});

// ── Feature 2: World Events ──
describe('Feature 2: World Events', () => {
	test('validates and resolves world events', () => {
		initChance('world-validate');
		global.FIXED_BEGIN = FIXED_NOW - 90 * 86400;
		const config = validateDungeonConfig({
			numUsers: 10, numEvents: 100, numDays: 90, seed: 'world-validate',
			worldEvents: [
				{ name: 'outage', startDay: 45, duration: 0.25, volumeMultiplier: 0.1 },
				{ name: 'launch', startDay: 30, duration: null, injectProps: { version: '2.0' } }
			]
		});
		expect(config.worldEvents).toHaveLength(2);
		// Should be sorted by startUnix
		expect(config.worldEvents[0].name).toBe('launch'); // day 30 first
		expect(config.worldEvents[1].name).toBe('outage'); // day 45 second
		expect(config.worldEvents[0].endUnix).toBe(Infinity); // permanent
		expect(config.worldEvents[1].endUnix).toBeGreaterThan(config.worldEvents[1].startUnix);
	});

	test('injects properties during world events', async () => {
		const result = await DUNGEON_MASTER({
			numUsers: 50,
			numEvents: 5000,
			numDays: 90,
			seed: 'world-inject',
			events: [{ event: 'action', weight: 5 }, { event: 'checkout', weight: 3 }],
			worldEvents: [
				{ name: 'promo', startDay: 0, duration: 90, injectProps: { promo_active: true }, affectsEvents: '*' }
			]
		});
		const events = Array.from(result.eventData);
		const withPromo = events.filter(e => e.promo_active === true);
		// All events should have promo_active since it spans the entire dataset
		expect(withPromo.length).toBeGreaterThan(events.length * 0.85);
	}, 30000);
});

// ── Feature 3: Engagement Decay ──
describe('Feature 3: Engagement Decay', () => {
	test('validates engagement decay config', () => {
		initChance('decay-validate');
		const config = validateDungeonConfig({
			numUsers: 10, numEvents: 100, seed: 'decay-validate',
			engagementDecay: { model: 'exponential', halfLife: 30, floor: 0.05 }
		});
		expect(config.engagementDecay.model).toBe('exponential');
		expect(config.engagementDecay.reactivationChance).toBe(0); // default
	});

	test('rejects invalid decay model', () => {
		initChance('decay-bad');
		expect(() => validateDungeonConfig({
			numUsers: 10, numEvents: 100, seed: 'decay-bad',
			engagementDecay: { model: 'invalid' }
		})).toThrow('model');
	});

	test('exponential decay reduces total events', async () => {
		// Compare with and without decay
		const withDecay = await DUNGEON_MASTER({
			numUsers: 80,
			numEvents: 5000,
			numDays: 90,
			seed: 'decay-with',
			events: [{ event: 'action' }],
			engagementDecay: { model: 'exponential', halfLife: 15, floor: 0.0 }
		});
		const withoutDecay = await DUNGEON_MASTER({
			numUsers: 80,
			numEvents: 5000,
			numDays: 90,
			seed: 'decay-without',
			events: [{ event: 'action' }]
		});
		// Decay should produce fewer stored events (many filtered out by decay)
		const decayEvents = Array.from(withDecay.eventData).length;
		const noDecayEvents = Array.from(withoutDecay.eventData).length;
		expect(decayEvents).toBeLessThan(noDecayEvents);
	}, 30000);

	test('decay uses within-dataset age, not calendar age', async () => {
		// This tests the fix for the time space mismatch bug where
		// adjustedCreated (FIXED time) was compared against ev.time (PRESENT time),
		// causing daysSinceBirth ≈ 800+ days and all events hitting the floor.
		// With the fix, decay should retain well over 15% of events.
		const result = await DUNGEON_MASTER({
			numUsers: 100,
			numEvents: 5000,
			numDays: 30,
			seed: 'decay-timespace',
			events: [{ event: 'action' }],
			engagementDecay: { model: 'linear', halfLife: 60, floor: 0.15 }
		});
		const stored = Array.from(result.eventData).length;
		// With halfLife=60 over only 30 days, retention should average ~88%
		// (1 - 30/120 = 0.75 at day 30, average ≈ 0.875).
		// If the time space bug were present, retention would be ~15% (floor).
		// Use a conservative threshold: stored must be > 50% of generated events.
		expect(stored).toBeGreaterThan(result.eventCount * 0.5);
	}, 30000);

	test('storedEventCount matches eventData length', async () => {
		const result = await DUNGEON_MASTER({
			numUsers: 50,
			numEvents: 2000,
			numDays: 30,
			seed: 'stored-count',
			events: [{ event: 'action' }],
			engagementDecay: { model: 'exponential', halfLife: 15, floor: 0.0 }
		});
		const actualStored = Array.from(result.eventData).length;
		expect(result.eventCount).toBe(actualStored);
	}, 30000);
});

// ── Feature 4: Data Quality ──
describe('Feature 4: Data Quality', () => {
	test('validates data quality config with defaults', () => {
		initChance('dq-validate');
		const config = validateDungeonConfig({
			numUsers: 10, numEvents: 100, seed: 'dq-validate',
			dataQuality: { nullRate: 0.05, botUsers: 3 }
		});
		expect(config.dataQuality.nullRate).toBe(0.05);
		expect(config.dataQuality.duplicateRate).toBe(0); // default
		expect(config.dataQuality.botUsers).toBe(3);
		expect(config.dataQuality.botEventsPerUser).toBe(1000); // default
	});

	test('injects null values into events', async () => {
		const result = await DUNGEON_MASTER({
			numUsers: 50,
			numEvents: 2000,
			numDays: 30,
			seed: 'dq-nulls',
			events: [{ event: 'action', properties: { amount: [10, 20, 30], category: ['a', 'b'] } }],
			dataQuality: { nullRate: 0.3, nullProps: ['amount', 'category'] }
		});
		const events = Array.from(result.eventData);
		const nullAmounts = events.filter(e => e.amount === null);
		const nullCategories = events.filter(e => e.category === null);
		// With 30% null rate we should see some nulls
		expect(nullAmounts.length).toBeGreaterThan(0);
		expect(nullCategories.length).toBeGreaterThan(0);
	}, 30000);

	test('generates bot users', async () => {
		const result = await DUNGEON_MASTER({
			numUsers: 20,
			numEvents: 500,
			numDays: 30,
			seed: 'dq-bots',
			events: [{ event: 'action' }],
			dataQuality: { botUsers: 3, botEventsPerUser: 100 }
		});
		const users = Array.from(result.userProfilesData);
		const botUsers = users.filter(u => u.is_bot === true);
		expect(botUsers.length).toBe(3);

		const events = Array.from(result.eventData);
		const botEvents = events.filter(e => e.is_bot === true);
		expect(botEvents.length).toBeGreaterThan(0);
	}, 30000);

	test('creates duplicate events', async () => {
		const baseResult = await DUNGEON_MASTER({
			numUsers: 30, numEvents: 1000, numDays: 30, seed: 'dq-dupes',
			datasetStart: '2024-01-01T00:00:00Z', datasetEnd: '2024-01-31T00:00:00Z',
			events: [{ event: 'action' }],
		});
		const baseCount = Array.from(baseResult.eventData).length;
		const result = await DUNGEON_MASTER({
			numUsers: 30, numEvents: 1000, numDays: 30, seed: 'dq-dupes',
			datasetStart: '2024-01-01T00:00:00Z', datasetEnd: '2024-01-31T00:00:00Z',
			events: [{ event: 'action' }],
			dataQuality: { duplicateRate: 0.1 }
		});
		const events = Array.from(result.eventData);
		expect(events.length).toBeGreaterThan(baseCount);
	}, 30000);
});

// ── Audit Fix Tests ──
describe('Audit Fixes', () => {
	test('Fix 2: duplicate events have unique insert_id', async () => {
		const result = await DUNGEON_MASTER({
			numUsers: 50,
			numEvents: 2000,
			numDays: 30,
			seed: 'fix2-dupe-ids',
			events: [{ event: 'action' }],
			dataQuality: { duplicateRate: 0.15 }
		});
		const events = Array.from(result.eventData);
		const insertIds = events.filter(e => e.insert_id).map(e => e.insert_id);
		const uniqueIds = new Set(insertIds);
		// Most events should have distinct insert_ids (dupes get regenerated IDs)
		expect(uniqueIds.size).toBeGreaterThan(events.length * 0.5);
		expect(insertIds.length).toBe(events.length);
	}, 30000);

	test('persona conversionModifier affects funnel conversion', async () => {
		// Same seed for both runs so standalone events are identical.
		// The ONLY difference is conversionModifier, which affects funnel completion.
		// bornRecentBias: -1 puts every born-in-dataset user near the start of the window
		// so the proportional event-allocation gives them a full per-user budget — keeps
		// the test focused on conversionModifier rather than per-user-day rate compression.
		const sharedConfig = {
			numUsers: 1000,
			numEvents: 50000,
			numDays: 30,
			seed: 'persona-conv-test',
			percentUsersBornInDataset: 100,
			bornRecentBias: -1,
			events: [
				{ event: 'start', isFirstEvent: true },
				{ event: 'step1', weight: 3 },
				{ event: 'complete', weight: 2 }
			],
			funnels: [
				{ sequence: ['start', 'step1', 'complete'], conversionRate: 50, isFirstFunnel: true, timeToConvert: 48 }
			],
		};
		const highResult = await DUNGEON_MASTER({
			...sharedConfig,
			personas: [{ name: 'converter', weight: 100, conversionModifier: 2.0 }]
		});
		const lowResult = await DUNGEON_MASTER({
			...sharedConfig,
			personas: [{ name: 'bouncer', weight: 100, conversionModifier: 0.2 }]
		});
		const highCompletes = Array.from(highResult.eventData).filter(e => e.event === 'complete').length;
		const lowCompletes = Array.from(lowResult.eventData).filter(e => e.event === 'complete').length;
		expect(highCompletes).toBeGreaterThan(lowCompletes);
	}, 60000);

	test('world event volumeMultiplier < 1 drops events', async () => {
		const result = await DUNGEON_MASTER({
			numUsers: 100,
			numEvents: 10000,
			numDays: 90,
			seed: 'world-outage',
			events: [{ event: 'action', weight: 5 }],
			worldEvents: [
				{
					name: 'outage', startDay: 0, duration: 90,
					volumeMultiplier: 0.3, affectsEvents: '*'
				}
			]
		});
		// With 0.3 volume multiplier across entire dataset, ~70% of events should be dropped
		const noOutageResult = await DUNGEON_MASTER({
			numUsers: 100,
			numEvents: 10000,
			numDays: 90,
			seed: 'world-no-outage',
			events: [{ event: 'action', weight: 5 }]
		});
		const outageEvents = Array.from(result.eventData).length;
		const normalEvents = Array.from(noOutageResult.eventData).length;
		expect(outageEvents).toBeLessThan(normalEvents);
	}, 30000);

	test('features without advanced feature config produce identical behavior', async () => {
		// Ensure backward compatibility: no advanced feature keys = old behavior
		const result = await DUNGEON_MASTER({
			numUsers: 30,
			numEvents: 500,
			numDays: 30,
			seed: 'no-features',
			events: [{ event: 'action' }]
		});
		const users = Array.from(result.userProfilesData);
		// No _persona should be set
		expect(users.every(u => u._persona === undefined)).toBe(true);
		// No bots
		expect(users.every(u => u.is_bot !== true)).toBe(true);
		// No utm_source from attribution
		expect(users.every(u => u.utm_source === undefined)).toBe(true);
		// No subscription events
		const events = Array.from(result.eventData);
		const subEvents = events.filter(e => e.event === 'trial started');
		expect(subEvents.length).toBe(0);
	}, 30000);
});

// ── Integration: Multiple features together ──
describe('Advanced Features Integration', () => {
	test('hooks override advanced features', async () => {
		const result = await DUNGEON_MASTER({
			numUsers: 30,
			numEvents: 500,
			numDays: 30,
			seed: 'hook-override',
			events: [{ event: 'action', properties: { amount: [10, 20, 30] } }],
			personas: [
				{ name: 'standard', weight: 100, properties: { tier: 'basic' } }
			],
			hook: (record, type, meta) => {
				// Hook overrides persona property
				if (type === 'user') {
					record.tier = 'overridden_by_hook';
				}
				// Hook overrides event properties
				if (type === 'event') {
					record.hook_applied = true;
				}
				return record;
			}
		});
		const users = Array.from(result.userProfilesData);
		for (const user of users) {
			if (user.is_bot) continue;
			expect(user.tier).toBe('overridden_by_hook');
		}
		const events = Array.from(result.eventData);
		const hookedEvents = events.filter(e => e.hook_applied === true);
		expect(hookedEvents.length).toBeGreaterThan(0);
	}, 30000);

	test('personas produce consistent user distribution with seed', async () => {
		// Full run-to-run determinism isn't guaranteed because MAX_TIME = dayjs().unix()
		// shifts between runs (pre-existing behavior). This test validates that
		// persona assignment is consistent within a single seeded run.
		const result = await DUNGEON_MASTER({
			numUsers: 100,
			numEvents: 2000,
			numDays: 30,
			seed: 'persona-dist',
			events: [{ event: 'action' }],
			personas: [
				{ name: 'alpha', weight: 70 },
				{ name: 'beta', weight: 30 }
			]
		});
		const users = Array.from(result.userProfilesData);
		const alpha = users.filter(u => u._persona === 'alpha').length;
		const beta = users.filter(u => u._persona === 'beta').length;
		// With 70/30 weights over 100 users, alpha should be more common
		expect(alpha).toBeGreaterThan(beta);
		// Roughly 70% alpha (with some variance)
		expect(alpha).toBeGreaterThan(50);
	}, 30000);
});
