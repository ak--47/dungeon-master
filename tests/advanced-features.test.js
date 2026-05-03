//@ts-nocheck
/**
 * Advanced Feature Tests
 * Tests all 9 features: personas, world events, engagement decay,
 * data quality, subscription, attribution, geo, features, anomalies
 */

import { describe, test, expect, beforeAll } from 'vitest';
import DUNGEON_MASTER from '../index.js';
import { validateDungeonConfig } from '../lib/core/config-validator.js';
import { initChance } from '../lib/utils/utils.js';
import dayjs from 'dayjs';

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
			events: [{ event: 'action' }],
		});
		const baseCount = Array.from(baseResult.eventData).length;
		const result = await DUNGEON_MASTER({
			numUsers: 30, numEvents: 1000, numDays: 30, seed: 'dq-dupes',
			events: [{ event: 'action' }],
			dataQuality: { duplicateRate: 0.1 }
		});
		const events = Array.from(result.eventData);
		expect(events.length).toBeGreaterThan(baseCount);
	}, 30000);
});

// ── Feature 5: Subscription (REMOVED in 1.4) ──
describe.skip('Feature 5: Subscription [removed in 1.4]', () => {
	test('validates subscription config', () => {
		initChance('sub-validate');
		const config = validateDungeonConfig({
			numUsers: 10, numEvents: 100, seed: 'sub-validate',
			subscription: {
				plans: [
					{ name: 'free', price: 0 },
					{ name: 'pro', price: 29.99 }
				]
			}
		});
		expect(config.subscription.plans[0].default).toBe(true); // auto-set
		expect(config.subscription.lifecycle.trialToPayRate).toBe(0.3); // default
		expect(config.subscription.events.subscribed).toBe('subscription started');
	});

	test('rejects subscription without plans', () => {
		initChance('sub-bad');
		expect(() => validateDungeonConfig({
			numUsers: 10, numEvents: 100, seed: 'sub-bad',
			subscription: { plans: [] }
		})).toThrow('plans');
	});

	test('generates subscription lifecycle events', async () => {
		const result = await DUNGEON_MASTER({
			numUsers: 100,
			numEvents: 5000,
			numDays: 180,
			seed: 'sub-lifecycle',
			percentUsersBornInDataset: 80,
			events: [{ event: 'action' }],
			subscription: {
				plans: [
					{ name: 'free', price: 0, default: true },
					{ name: 'starter', price: 9.99, trialDays: 14 },
					{ name: 'pro', price: 29.99 },
					{ name: 'enterprise', price: 99.99 }
				],
				lifecycle: {
					trialToPayRate: 0.5,
					upgradeRate: 0.15,
					churnRate: 0.08,
					winBackRate: 0.1
				}
			}
		});
		const events = Array.from(result.eventData);
		const subEvents = events.filter(e =>
			['trial started', 'subscription started', 'plan upgraded',
				'plan downgraded', 'subscription cancelled', 'subscription renewed',
				'payment failed', 'subscription reactivated'].includes(e.event)
		);
		expect(subEvents.length).toBeGreaterThan(0);

		// Should see trial starts
		const trials = events.filter(e => e.event === 'trial started');
		expect(trials.length).toBeGreaterThan(0);
	}, 30000);
});

// ── Feature 6: Attribution (REMOVED in 1.4 — replaced by EventConfig.isAttributionEvent) ──
describe.skip('Feature 6: Attribution [removed in 1.4]', () => {
	test('validates attribution config', () => {
		initChance('attr-validate');
		const config = validateDungeonConfig({
			numUsers: 10, numEvents: 100, seed: 'attr-validate',
			attribution: {
				campaigns: [
					{ name: 'spring', source: 'google', activeDays: [10, 50] }
				],
				organicRate: 0.3
			}
		});
		expect(config.attribution.model).toBe('last_touch'); // default
		expect(config.attribution.window).toBe(7); // default
		expect(config.attribution.campaigns[0].acquisitionRate).toBe(0.02); // default
	});

	test('assigns campaign attribution to user profiles', async () => {
		const result = await DUNGEON_MASTER({
			numUsers: 100,
			numEvents: 2000,
			numDays: 60,
			seed: 'attr-assign',
			percentUsersBornInDataset: 80,
			events: [{ event: 'action' }],
			attribution: {
				campaigns: [
					{ name: 'summer_sale', source: 'facebook', medium: 'social', activeDays: [0, 60] }
				],
				organicRate: 0.2  // 80% should get campaign
			}
		});
		const users = Array.from(result.userProfilesData);
		const withCampaign = users.filter(u => u.utm_source === 'facebook');
		// A good chunk should have campaign attribution
		expect(withCampaign.length).toBeGreaterThan(0);
	}, 30000);
});

// ── Feature 7: Geographic Intelligence (REMOVED in 1.4) ──
describe.skip('Feature 7: Geographic Intelligence [removed in 1.4]', () => {
	test('validates geo config', () => {
		initChance('geo-validate');
		const config = validateDungeonConfig({
			numUsers: 10, numEvents: 100, seed: 'geo-validate',
			geo: {
				sticky: true,
				regions: [
					{ name: 'us', countries: ['US'], weight: 60, timezoneOffset: -5, properties: { currency: 'USD' } },
					{ name: 'eu', countries: ['GB', 'DE'], weight: 40, timezoneOffset: 1 }
				]
			}
		});
		expect(config.geo.sticky).toBe(true);
		expect(config.geo.regions).toHaveLength(2);
	});

	test('assigns sticky location and region properties', async () => {
		const result = await DUNGEON_MASTER({
			numUsers: 50,
			numEvents: 1000,
			numDays: 30,
			seed: 'geo-sticky',
			hasLocation: true,
			events: [{ event: 'action' }],
			geo: {
				sticky: true,
				regions: [
					{ name: 'us', countries: ['US'], weight: 100, timezoneOffset: -5, properties: { currency: 'USD' } }
				]
			}
		});
		const users = Array.from(result.userProfilesData);
		// All users should have USD currency from region properties
		const withCurrency = users.filter(u => u.currency === 'USD');
		expect(withCurrency.length).toBeGreaterThan(0);

		// Users should have _region set
		const withRegion = users.filter(u => u._region === 'us');
		expect(withRegion.length).toBeGreaterThan(0);
	}, 30000);
});

// ── Feature 8: Progressive Feature Adoption (REMOVED in 1.4) ──
describe.skip('Feature 8: Progressive Feature Adoption [removed in 1.4]', () => {
	test('validates and resolves feature configs', () => {
		initChance('feat-validate');
		global.FIXED_BEGIN = FIXED_NOW - 90 * 86400;
		const config = validateDungeonConfig({
			numUsers: 10, numEvents: 100, numDays: 90, seed: 'feat-validate',
			features: [
				{ name: 'dark_mode', launchDay: 30, property: 'theme', values: ['light', 'dark'], adoptionCurve: 'fast' },
				{ name: 'ai_recs', launchDay: 60, property: 'rec_source', values: ['manual', 'ai'], adoptionCurve: { k: 0.2, midpoint: 10 } }
			]
		});
		expect(config.features).toHaveLength(2);
		expect(config.features[0]._resolvedCurve).toEqual({ k: 0.3, midpoint: 7 }); // fast preset
		expect(config.features[1]._resolvedCurve).toEqual({ k: 0.2, midpoint: 10 }); // custom
	});

	test('rejects features without required fields', () => {
		initChance('feat-bad');
		expect(() => validateDungeonConfig({
			numUsers: 10, numEvents: 100, seed: 'feat-bad',
			features: [{ name: 'test' }]
		})).toThrow('launchDay');
	});

	test('progressive adoption adds feature property to events', async () => {
		const result = await DUNGEON_MASTER({
			numUsers: 100,
			numEvents: 10000,
			numDays: 90,
			seed: 'feat-adopt',
			events: [{ event: 'action', weight: 5 }],
			features: [
				{
					name: 'new_ui',
					launchDay: 0, // launches at start so we get clear signal
					property: 'ui_version',
					values: ['v1', 'v2'],
					defaultBefore: 'v1',
					adoptionCurve: 'fast',
					affectsEvents: '*'
				}
			]
		});
		const events = Array.from(result.eventData);
		// Events should have ui_version property
		const withVersion = events.filter(e => e.ui_version !== undefined);
		expect(withVersion.length).toBeGreaterThan(0);

		// Should see both v1 and v2 values
		const v1 = events.filter(e => e.ui_version === 'v1');
		const v2 = events.filter(e => e.ui_version === 'v2');
		expect(v1.length).toBeGreaterThan(0);
		expect(v2.length).toBeGreaterThan(0);
	}, 30000);
});

// ── Feature 9: Anomalies (REMOVED in 1.4) ──
describe.skip('Feature 9: Anomalies [removed in 1.4]', () => {
	test('validates anomaly configs', () => {
		initChance('anomaly-validate');
		global.FIXED_BEGIN = FIXED_NOW - 90 * 86400;
		const config = validateDungeonConfig({
			numUsers: 10, numEvents: 100, numDays: 90, seed: 'anomaly-validate',
			anomalies: [
				{ type: 'extreme_value', event: 'checkout', property: 'amount', frequency: 0.01, multiplier: 100 },
				{ type: 'burst', event: 'error', day: 45, duration: 0.083, count: 500 }
			]
		});
		expect(config.anomalies).toHaveLength(2);
		expect(config.anomalies[1]._startUnix).toBeDefined();
	});

	test('generates anomaly burst events', async () => {
		const result = await DUNGEON_MASTER({
			numUsers: 30,
			numEvents: 1000,
			numDays: 90,
			seed: 'anomaly-burst',
			events: [{ event: 'action' }],
			anomalies: [
				{
					type: 'burst',
					event: 'server_error',
					day: 45,
					duration: 0.083,
					count: 200,
					properties: { error_code: '500' },
					tag: 'outage_burst'
				}
			]
		});
		const events = Array.from(result.eventData);
		const errorEvents = events.filter(e => e.event === 'server_error');
		expect(errorEvents.length).toBeGreaterThan(100); // should inject ~200

		const tagged = errorEvents.filter(e => e._anomaly === 'outage_burst');
		expect(tagged.length).toBeGreaterThan(0);
	}, 30000);

	test('generates extreme value anomalies', async () => {
		const result = await DUNGEON_MASTER({
			numUsers: 50,
			numEvents: 5000,
			numDays: 30,
			seed: 'anomaly-extreme',
			events: [{ event: 'purchase', properties: { amount: [10, 20, 30, 40, 50] } }],
			anomalies: [
				{ type: 'extreme_value', event: 'purchase', property: 'amount', frequency: 0.05, multiplier: 100, tag: 'whale' }
			]
		});
		const events = Array.from(result.eventData);
		const whales = events.filter(e => e._anomaly === 'whale');
		expect(whales.length).toBeGreaterThan(0);
		// Whale amounts should be very large
		const whaleAmounts = whales.filter(e => typeof e.amount === 'number' && e.amount > 500);
		expect(whaleAmounts.length).toBeGreaterThan(0);
	}, 30000);
});

// ── Audit Fix Tests ──
describe('Audit Fixes', () => {
	test.skip('[removed in 1.4] Fix 1: UTM properties appear on EVENTS not just profiles', async () => {
		const result = await DUNGEON_MASTER({
			numUsers: 100,
			numEvents: 3000,
			numDays: 60,
			seed: 'fix1-utm-events',
			percentUsersBornInDataset: 80,
			events: [{ event: 'page_view', weight: 5 }, { event: 'checkout', weight: 2 }],
			attribution: {
				campaigns: [
					{ name: 'google_ads', source: 'google', medium: 'cpc', activeDays: [0, 60] }
				],
				organicRate: 0.2
			}
		});
		const events = Array.from(result.eventData);
		const eventsWithUtm = events.filter(e => e.utm_source === 'google');
		// Events (not just profiles) must have UTM properties for Mixpanel attribution
		expect(eventsWithUtm.length).toBeGreaterThan(0);
		// Check utm_campaign also present
		const withCampaign = events.filter(e => e.utm_campaign === 'google_ads');
		expect(withCampaign.length).toBeGreaterThan(0);
		// Check utm_medium present
		const withMedium = events.filter(e => e.utm_medium === 'cpc');
		expect(withMedium.length).toBeGreaterThan(0);
	}, 30000);

	test.skip('[removed in 1.4] Fix 1: multi-touch — users have multiple events with UTM', async () => {
		const result = await DUNGEON_MASTER({
			numUsers: 50,
			numEvents: 5000,
			numDays: 60,
			seed: 'fix1-multitouch',
			percentUsersBornInDataset: 90,
			events: [{ event: 'page_view', weight: 8 }, { event: 'checkout', weight: 2 }],
			attribution: {
				campaigns: [
					{ name: 'fb_campaign', source: 'facebook', medium: 'social', activeDays: [0, 60] }
				],
				organicRate: 0.1
			}
		});
		const events = Array.from(result.eventData);
		// Count users with >1 UTM event (multi-touch)
		const userUtmCounts = {};
		for (const ev of events) {
			if (ev.utm_source && ev.user_id) {
				userUtmCounts[ev.user_id] = (userUtmCounts[ev.user_id] || 0) + 1;
			}
		}
		const multiTouchUsers = Object.values(userUtmCounts).filter(c => c > 1).length;
		expect(multiTouchUsers).toBeGreaterThan(0);
	}, 30000);

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

	test.skip('[removed in 1.4] Fix 3: subscription events survive engagement decay', async () => {
		const result = await DUNGEON_MASTER({
			numUsers: 80,
			numEvents: 3000,
			numDays: 120,
			seed: 'fix3-sub-decay',
			percentUsersBornInDataset: 80,
			events: [{ event: 'action' }],
			engagementDecay: { model: 'exponential', halfLife: 15, floor: 0.0 },
			subscription: {
				plans: [
					{ name: 'free', price: 0, default: true },
					{ name: 'pro', price: 19.99, trialDays: 14 }
				],
				lifecycle: { trialToPayRate: 0.5, churnRate: 0.1 }
			}
		});
		const events = Array.from(result.eventData);
		// Even with aggressive decay (halfLife=15, floor=0), subscription events
		// should survive because they're injected AFTER decay filtering
		const subEvents = events.filter(e =>
			['trial started', 'subscription started', 'subscription renewed',
				'subscription cancelled'].includes(e.event)
		);
		expect(subEvents.length).toBeGreaterThan(0);

		// Behavioral events should be heavily reduced by decay
		const actionEvents = events.filter(e => e.event === 'action');
		// With halfLife=15 and floor=0, many action events should be dropped
		// but subscription events should all survive
		expect(subEvents.length).toBeGreaterThan(0);
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

	test.skip('[removed in 1.4] coordinated anomaly generates sign-up burst', async () => {
		const result = await DUNGEON_MASTER({
			numUsers: 20,
			numEvents: 500,
			numDays: 90,
			seed: 'anomaly-coord',
			events: [{ event: 'action' }],
			anomalies: [
				{ type: 'coordinated', event: 'viral_signup', day: 45, window: 0.01, count: 100, tag: 'viral' }
			]
		});
		const events = Array.from(result.eventData);
		const viralEvents = events.filter(e => e.event === 'viral_signup');
		expect(viralEvents.length).toBeGreaterThanOrEqual(90); // ~100, some may exceed MAX_TIME
		// All should have the tag
		const tagged = viralEvents.filter(e => e._anomaly === 'viral');
		expect(tagged.length).toBe(viralEvents.length);
		// All should have unique user_ids (coordinated = different users)
		const uniqueUsers = new Set(viralEvents.map(e => e.user_id));
		expect(uniqueUsers.size).toBe(viralEvents.length);
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
	test.skip('[removed in 1.4] all features compose without errors', async () => {
		initChance('features-all');
		global.FIXED_NOW = FIXED_NOW;
		global.FIXED_BEGIN = FIXED_NOW - 90 * 86400;
		const result = await DUNGEON_MASTER({
			numUsers: 100,
			numEvents: 5000,
			numDays: 90,
			seed: 'features-all',
			events: [
				{ event: 'page_view', weight: 5 },
				{ event: 'checkout', weight: 2, properties: { amount: [10, 20, 50] } },
				{ event: 'sign_up', isFirstEvent: true }
			],
			funnels: [
				{ sequence: ['sign_up', 'page_view', 'checkout'], conversionRate: 60, isFirstFunnel: true }
			],
			hasLocation: true,
			personas: [
				{ name: 'power', weight: 20, eventMultiplier: 3.0, conversionModifier: 1.3, properties: { tier: 'premium' } },
				{ name: 'casual', weight: 60, eventMultiplier: 0.5, properties: { tier: 'free' } },
				{ name: 'churner', weight: 20, eventMultiplier: 0.8, churnRate: 0.5, properties: { tier: 'trial' } }
			],
			worldEvents: [
				{ name: 'sale', startDay: 40, duration: 3, volumeMultiplier: 2.0, injectProps: { sale: true }, affectsEvents: ['checkout'] }
			],
			engagementDecay: { model: 'exponential', halfLife: 45, floor: 0.1 },
			dataQuality: { nullRate: 0.02, duplicateRate: 0.01, botUsers: 2, botEventsPerUser: 50 },
			subscription: {
				plans: [
					{ name: 'free', price: 0, default: true },
					{ name: 'pro', price: 19.99, trialDays: 7 }
				]
			},
			geo: {
				sticky: true,
				regions: [
					{ name: 'us', countries: ['US'], weight: 70, timezoneOffset: -5 },
					{ name: 'eu', countries: ['GB'], weight: 30, timezoneOffset: 0 }
				]
			},
			features: [
				{ name: 'dark_mode', launchDay: 30, property: 'theme', values: ['light', 'dark'], adoptionCurve: 'fast', affectsEvents: '*' }
			],
			anomalies: [
				{ type: 'extreme_value', event: 'checkout', property: 'amount', frequency: 0.02, multiplier: 50, tag: 'whale' },
				{ type: 'burst', event: 'error_spike', day: 60, duration: 0.04, count: 100, tag: 'error_burst' }
			],
			percentUsersBornInDataset: 60
		});

		expect(result.eventCount).toBeGreaterThan(0);
		expect(result.userCount).toBeGreaterThan(0);

		const events = Array.from(result.eventData);
		const users = Array.from(result.userProfilesData);

		// Verify personas assigned
		const personaNames = new Set(users.map(u => u._persona).filter(Boolean));
		expect(personaNames.size).toBeGreaterThan(0);

		// Verify bots injected
		const bots = users.filter(u => u.is_bot);
		expect(bots.length).toBe(2);

		// Verify subscription events generated
		const subEvents = events.filter(e => e.event === 'trial started' || e.event === 'subscription started');
		expect(subEvents.length).toBeGreaterThan(0);

		// Verify anomaly features exist (extreme values or bursts)
		const whaleEvents = events.filter(e => e._anomaly === 'whale');
		const burstEvents = events.filter(e => e.event === 'error_spike');
		// At least one anomaly type should have produced events
		expect(whaleEvents.length + burstEvents.length).toBeGreaterThan(0);

		// Verify some events have theme property from feature adoption
		const themed = events.filter(e => e.theme);
		expect(themed.length).toBeGreaterThan(0);
	}, 60000);

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
