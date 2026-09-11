import { describe, expect, it, vi } from 'vitest';
import { buildContext } from '../../.claude/skills/create-project/context.mjs';

describe('create-project business context', () => {
	it('preserves the legacy schema and comment fallback exactly', () => {
		const context = buildContext('Shop', {
			events: [{ event: 'order', weight: 0, properties: { amount: [10] } }, { event: 'visit' }],
			funnels: [{ name: 'Buy', sequence: ['visit', 'order'], conversionRate: 25 }, { sequence: [] }],
		}, { overview: 'Shop overview', hookStories: 'Legacy behavior' }, [
			{ property_name: 'account_id', display_name: 'Account Id' },
		], null);
		expect(context).toBe([
			'# Shop', '', 'Shop overview', '', '## Engineered Behaviors', '', 'Legacy behavior', '',
			'## Schema', '', '### Events (2)', '- order (weight 0) — amount', '- visit', '',
			'### Funnels (2)', '- Buy: visit → order (25%)', '- (unnamed): ', '',
			'### Group keys', '- account_id (Account Id)', '',
		].join('\n'));
	});

	it('preserves story narratives, report hints and deviations ahead of the fallback', () => {
		const context = buildContext('Shop', {}, { hookStories: 'Ignored fallback' }, [], [{
			id: 'H1', archetype: 'temporal-inflection', narrative: '  Orders rise.  ',
			mixpanelReport: { type: 'Insights', events: ['order'], options: { unit: 'day' } },
			intentionalDeviations: ['Tail exceeds the engine bar.'],
		}]);
		expect(context).toBe([
			'# Shop', '', '## Engineered Behaviors', '',
			"1 machine-verified story patterns (from the dungeon's `stories` export):", '',
			'### H1 — temporal-inflection', '', 'Orders rise.', '', 'How to see it in Mixpanel:',
			'- **type**: Insights', '- **events**: ["order"]', '- **options**: {"unit":"day"}', '',
			'Notes:', '- Tail exceeds the engine bar.', '', '## Schema', '', '### Events (0)', '',
		].join('\n'));
	});

	it('keeps the empty-stories fallback and tolerates absent optional schema', () => {
		expect(buildContext('Empty', {}, {}, [], [])).toBe('# Empty\n\n## Schema\n\n### Events (0)\n');
		expect(buildContext('Empty', {}, { hookStories: 'Fallback' }, [], [])).toContain('Fallback');
	});

	it('retains the 50,000-character cap and truncation marker', () => {
		const context = buildContext('Long', {}, { overview: 'x'.repeat(51000) }, [], null);
		expect(context.length).toBeLessThanOrEqual(50000);
		expect(context).toBe(('# Long\n\n' + 'x'.repeat(51000)).slice(0, 49900) + '\n\n…(truncated to 50,000 chars)');
	});

	it('summarizes standalone cadence, dimensions, properties and synthetic identity without evaluating values', () => {
		const value = vi.fn(() => { throw new Error('FUNCTION_SECRET'); });
		const context = buildContext('Metrics', {
			events: [{ event: 'order', properties: { amount: value } }],
			credentials: { token: 'TOKEN_SECRET', serviceSecret: 'SERVICE_SECRET' },
			token: 'FLAT_TOKEN_SECRET',
			standaloneEvents: [
				{ event: 'usage', cadence: 'hour', dimensions: { region: ['us', 'eu'], tier: ['paid'] }, distinctIdFrom: 'region', properties: { cost: value } },
				{ event: 'heartbeat' },
			],
		}, {}, [], null);
		expect(context).toContain('### Events (1)\n- order — amount');
		expect(context).toContain('### Standalone events (2)');
		expect(context).toContain('- usage: cadence hour; dimensions region (2 values), tier (1 values); properties cost; synthetic distinct_id from dimension region');
		expect(context).toContain('- heartbeat: cadence day; dimensions (none); properties (none); synthetic distinct_id from event name');
		expect(context).toContain('never people counts or identity-model evidence');
		expect(context).toContain('normal event send path');
		expect(context).not.toMatch(/TOKEN_SECRET|SERVICE_SECRET|FUNCTION_SECRET/);
		expect(value).not.toHaveBeenCalled();
	});

	it('summarizes warehouse sources, defaults, columns, aggregation and separate deployment without executing functions', () => {
		const value = vi.fn(() => { throw new Error('FUNCTION_SECRET'); });
		const context = buildContext('Metrics', {
			credentials: { serviceSecret: 'SERVICE_SECRET' },
			warehouseMetrics: [
				{ name: 'bookings', source: { event: 'order', measure: 'sum', property: 'amount', where: value, groupBy: 'region' }, columns: { currency: value } },
				{ name: 'arr', type: 'point-in-time', grain: 'month', baseline: 40, sparse: true, history: 18, timeColumn: 'month', valueColumn: 'arr_usd',
					source: { event: ['start', 'expand'], minus: ['cancel', 'shrink'], measure: 'sum', property: 'mrr', where: value, groupBy: ['region', 'tier'] } },
				{ name: 'active', type: 'point-in-time', source: { event: 'start', minus: 'cancel' } },
				{ name: 'normalized', type: 'additive', grain: 'week', history: 0, sparse: false,
					source: { event: ['order'], minus: [], measure: 'count', property: null, where: null, groupBy: [] }, columns: {} },
			],
		}, {}, [], null);
		expect(context).toContain('### Warehouse metrics (4)');
		expect(context).toContain('- bookings: type additive; grain day; history 0 periods before the event window; sparse false; Mixpanel aggregation Sum');
		expect(context).toContain('source events order; minus (none); measure sum; property amount; where present (function, not evaluated)');
		expect(context).toContain('columns: time date; value value; groupBy region; extra currency');
		expect(context).toContain('- arr: type point-in-time; grain month; history 18 periods before the event window; sparse true; Mixpanel aggregation LastValue');
		expect(context).toContain('source events start, expand; minus cancel, shrink; measure sum; property mrr; where present (function, not evaluated)');
		expect(context).toContain('columns: time month; value arr_usd; groupBy region, tier; extra (none)');
		expect(context).toContain('baseline 40 (point-in-time starting level)');
		expect(context).toContain('baseline 0 (point-in-time starting level)');
		expect(context).toContain('source events start; minus cancel; measure count; property (none); where (none)');
		expect(context).toContain('source events order; minus (none); measure count; property (none); where (none)');
		expect(context).toContain('groupBy (none); extra (none)');
		expect(context).toContain('Sum adds buckets; LastValue reads the latest snapshot');
		expect(context).toContain('Separate /warehouse-metrics deployment is required');
		expect(context).toContain('provisioning and sendToMixpanel do not load warehouse tables or save warehouse metrics');
		expect(context).not.toMatch(/SERVICE_SECRET|FUNCTION_SECRET/);
		expect(value).not.toHaveBeenCalled();
	});
});