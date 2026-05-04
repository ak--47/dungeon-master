//@ts-nocheck
import { describe, test, expect } from 'vitest';
import { deriveExpectedSchema, validateSchema } from '../lib/verify/schema-validator.js';
import generate from '../index.js';

const timeout = 30_000;

function baseConfig(overrides = {}) {
	return {
		seed: 'schema-test',
		numUsers: 20,
		numEvents: 200,
		numDays: 30,
		datasetStart: '2024-01-01T00:00:00Z',
		datasetEnd: '2024-01-31T00:00:00Z',
		format: 'json',
		writeToDisk: false,
		concurrency: 1,
		batchSize: 500_000,
		hasAdSpend: false,
		hasAnonIds: false,
		hasSessionIds: false,
		hasCampaigns: false,
		hasLocation: false,
		hasAvatar: false,
		hasBrowser: false,
		hasAndroidDevices: false,
		hasIOSDevices: false,
		hasDesktopDevices: false,
		percentUsersBornInDataset: 50,
		events: [
			{ event: 'page view', weight: 5, properties: { page: ['home', 'about', 'pricing'] } },
			{ event: 'purchase', weight: 2, properties: { amount: [10, 20, 50], item: ['widget', 'gadget'] } },
		],
		funnels: [],
		superProps: {},
		userProps: {},
		scdProps: {},
		mirrorProps: {},
		lookupTables: [],
		groupKeys: [],
		groupProps: {},
		...overrides
	};
}

describe('deriveExpectedSchema', () => {

	test('minimal config — core keys + event properties', () => {
		const config = baseConfig();
		const schema = deriveExpectedSchema(config);

		expect(schema.has('page view')).toBe(true);
		expect(schema.has('purchase')).toBe(true);

		const pageView = schema.get('page view');
		expect(pageView.has('event')).toBe(true);
		expect(pageView.has('time')).toBe(true);
		expect(pageView.has('insert_id')).toBe(true);
		expect(pageView.has('user_id')).toBe(true);
		expect(pageView.has('page')).toBe(true);
		expect(pageView.has('amount')).toBe(false);

		const purchase = schema.get('purchase');
		expect(purchase.has('amount')).toBe(true);
		expect(purchase.has('item')).toBe(true);
		expect(purchase.has('page')).toBe(false);
	});

	test('super props appear on all event types', () => {
		const config = baseConfig({
			superProps: { platform: ['web', 'mobile'], app_version: ['1.0', '2.0'] }
		});
		const schema = deriveExpectedSchema(config);

		for (const [, keys] of schema) {
			expect(keys.has('platform')).toBe(true);
			expect(keys.has('app_version')).toBe(true);
		}
	});

	test('device properties when hasAndroidDevices', () => {
		const config = baseConfig({ hasAndroidDevices: true });
		const schema = deriveExpectedSchema(config);

		const keys = schema.get('page view');
		expect(keys.has('model')).toBe(true);
		expect(keys.has('os')).toBe(true);
		expect(keys.has('Platform')).toBe(true);
		expect(keys.has('device_id')).toBe(false);
	});

	test('device_id when avgDevicePerUser > 0', () => {
		const config = baseConfig({ avgDevicePerUser: 2 });
		const schema = deriveExpectedSchema(config);

		const keys = schema.get('page view');
		expect(keys.has('device_id')).toBe(true);
		expect(keys.has('model')).toBe(true);
	});

	test('session_id when hasSessionIds', () => {
		const config = baseConfig({ hasSessionIds: true });
		const schema = deriveExpectedSchema(config);

		const keys = schema.get('page view');
		expect(keys.has('session_id')).toBe(true);
	});

	test('campaign keys when hasCampaigns', () => {
		const config = baseConfig({ hasCampaigns: true });
		const schema = deriveExpectedSchema(config);

		const keys = schema.get('page view');
		expect(keys.has('utm_source')).toBe(true);
		expect(keys.has('utm_campaign')).toBe(true);
		expect(keys.has('utm_medium')).toBe(true);
		expect(keys.has('utm_content')).toBe(true);
		expect(keys.has('utm_term')).toBe(true);
	});

	test('location keys when hasLocation', () => {
		const config = baseConfig({ hasLocation: true });
		const schema = deriveExpectedSchema(config);

		const keys = schema.get('page view');
		expect(keys.has('city')).toBe(true);
		expect(keys.has('region')).toBe(true);
		expect(keys.has('country')).toBe(true);
		expect(keys.has('country_code')).toBe(true);
	});

	test('group keys — global vs per-event', () => {
		const config = baseConfig({
			groupKeys: [
				['company_id', 10, []],
				['team_id', 5, ['purchase']],
			]
		});
		const schema = deriveExpectedSchema(config);

		// company_id on all events (empty groupEvents = global)
		expect(schema.get('page view').has('company_id')).toBe(true);
		expect(schema.get('purchase').has('company_id')).toBe(true);

		// team_id only on purchase
		expect(schema.get('purchase').has('team_id')).toBe(true);
		expect(schema.get('page view').has('team_id')).toBe(false);
	});

	test('funnel props added to sequence events', () => {
		const config = baseConfig({
			funnels: [{
				sequence: ['page view', 'purchase'],
				conversionRate: 0.5,
				props: { funnel_step: ['entry', 'exit'] }
			}]
		});
		const schema = deriveExpectedSchema(config);

		expect(schema.get('page view').has('funnel_step')).toBe(true);
		expect(schema.get('purchase').has('funnel_step')).toBe(true);
	});

	test('experiment funnel adds $experiment_started schema', () => {
		const config = baseConfig({
			funnels: [{
				sequence: ['page view', 'purchase'],
				conversionRate: 0.5,
				experiment: { name: 'Test AB', variants: ['A', 'B'] }
			}]
		});
		const schema = deriveExpectedSchema(config);

		expect(schema.has('$experiment_started')).toBe(true);
		const expKeys = schema.get('$experiment_started');
		expect(expKeys.has('Experiment name')).toBe(true);
		expect(expKeys.has('Variant name')).toBe(true);
	});

	test('world event inject props', () => {
		const config = baseConfig({
			worldEvents: [{
				name: 'promo',
				startDay: 5,
				endDay: 10,
				affectsEvents: ['purchase'],
				injectProps: { promo_code: 'SUMMER25' }
			}]
		});
		const schema = deriveExpectedSchema(config);

		expect(schema.get('purchase').has('promo_code')).toBe(true);
		expect(schema.get('page view').has('promo_code')).toBe(false);
	});

	test('world event affects all events (*)', () => {
		const config = baseConfig({
			worldEvents: [{
				name: 'outage',
				startDay: 5,
				endDay: 10,
				affectsEvents: '*',
				injectProps: { during_outage: true }
			}]
		});
		const schema = deriveExpectedSchema(config);

		expect(schema.get('purchase').has('during_outage')).toBe(true);
		expect(schema.get('page view').has('during_outage')).toBe(true);
	});
});


describe('validateSchema', () => {

	test('clean output — no hook, no added columns → PASS', async () => {
		const config = baseConfig({ seed: 'schema-clean' });
		const result = await generate(config);
		const events = Array.from(result.eventData);

		const report = validateSchema(events, config);
		expect(report.pass).toBe(true);
		expect(report.flagStamping).toHaveLength(0);
		expect(report.summary.fail).toBe(0);
	}, timeout);

	test('hook adds column to ALL events of a type → PASS (uniform enrichment)', async () => {
		const config = baseConfig({
			seed: 'schema-uniform',
			hook: function (record, type) {
				if (type === 'event' && record.event === 'purchase') {
					record.enriched_value = record.amount * 1.1;
				}
				return record;
			}
		});
		const result = await generate(config);
		const events = Array.from(result.eventData);

		const report = validateSchema(events, config);
		const purchaseReport = report.eventTypes['purchase'];
		expect(purchaseReport.added).toContain('enriched_value');
		expect(purchaseReport.coverage['enriched_value'].pct).toBe(100);
		expect(purchaseReport.verdict).toBe('PASS');
		expect(report.pass).toBe(true);
	}, timeout);

	test('hook adds column to SOME events of a type → FAIL (flag stamping)', async () => {
		const config = baseConfig({
			seed: 'schema-flagstamp',
			hook: function (record, type) {
				if (type === 'event' && record.event === 'purchase' && record.amount > 30) {
					record.is_whale = true;
				}
				return record;
			}
		});
		const result = await generate(config);
		const events = Array.from(result.eventData);

		const report = validateSchema(events, config);
		const purchaseReport = report.eventTypes['purchase'];
		expect(purchaseReport.added).toContain('is_whale');
		expect(purchaseReport.coverage['is_whale'].pct).toBeLessThan(100);
		expect(purchaseReport.verdict).toBe('FAIL');
		expect(report.pass).toBe(false);
		expect(report.flagStamping.length).toBeGreaterThan(0);
		expect(report.flagStamping.some(f => f.column === 'is_whale')).toBe(true);
	}, timeout);

	test('hook adds column to a different event type (not in schema) → PASS if 100%', async () => {
		const config = baseConfig({
			seed: 'schema-crosstype',
			hook: function (record, type) {
				if (type === 'event' && record.event === 'page view') {
					record.viewport_width = 1920;
				}
				return record;
			}
		});
		const result = await generate(config);
		const events = Array.from(result.eventData);

		const report = validateSchema(events, config);
		const pageViewReport = report.eventTypes['page view'];
		expect(pageViewReport.added).toContain('viewport_width');
		expect(pageViewReport.coverage['viewport_width'].pct).toBe(100);
		expect(pageViewReport.verdict).toBe('PASS');
		// purchase events should have no added columns
		expect(report.eventTypes['purchase'].added).not.toContain('viewport_width');
	}, timeout);

	test('missing columns are informational, not failures', async () => {
		const config = baseConfig({
			seed: 'schema-missing',
			hasCampaigns: true,
		});
		const result = await generate(config);
		const events = Array.from(result.eventData);

		const report = validateSchema(events, config);
		// utm_* only stamps ~25% of events, so some events will be "missing" these columns
		// but that's not a failure
		expect(report.pass).toBe(true);
	}, timeout);
});
