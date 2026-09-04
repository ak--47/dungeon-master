//@ts-nocheck
/**
 * v1.7.0: `{ __weights }` and `(ctx) => …` survive dungeon-to-json → json-to-dungeon.
 */
import { describe, test, expect } from 'vitest';
import { dungeonToJSON } from '../../lib/core/dungeon-to-json.js';
import { parseJSONDungeon } from '../../lib/core/dungeon-loader.js';
import { evaluateFunctionCall } from '../../lib/utils/json-evaluator.js';
import { choose, initChance } from '../../lib/utils/utils.js';

const config = {
	numUsers: 20,
	numDays: 20,
	avgEventsPerUserPerDay: 1,
	events: [{ event: 'a', properties: { total: (ctx) => ctx.event.price * 2, price: [1, 2, 3] } }],
	userProps: {
		plan_tier: { __weights: { free: 60, pro: 30, enterprise: 10 } },
		revenue: (ctx) => (ctx.profile.plan_tier === 'pro' ? 100 : 10),
	},
	funnels: [{ name: 'F', sequence: ['a'], conditions: { plan_tier: { in: ['pro', 'enterprise'] } } }],
};

describe('json round-trip — v1.7.0 forms', () => {
	test('__weights survives as a plain object', async () => {
		const json = await dungeonToJSON(config);
		expect(json.schema.userProps.plan_tier).toEqual({ __weights: { free: 60, pro: 30, enterprise: 10 } });
		const revived = parseJSONDungeon(json);
		expect(revived.userProps.plan_tier).toEqual({ __weights: { free: 60, pro: 30, enterprise: 10 } });
		initChance('rt');
		expect(['free', 'pro', 'enterprise']).toContain(choose(revived.userProps.plan_tier));
	});

	test('(ctx) arrow revives to a context-aware function, not a thunk returning one', async () => {
		const json = await dungeonToJSON(config);
		expect(json.schema.userProps.revenue).toMatchObject({ functionName: 'arrow' });
		const revived = parseJSONDungeon(json);
		expect(typeof revived.userProps.revenue).toBe('function');
		expect(revived.userProps.revenue.length).toBe(1);
		expect(revived.userProps.revenue({ profile: { plan_tier: 'pro' } })).toBe(100);
		expect(choose(revived.userProps.revenue, { profile: { plan_tier: 'free' } })).toBe(10);
	});

	test('operator-map conditions survive untouched', async () => {
		const json = await dungeonToJSON(config);
		const revived = parseJSONDungeon(json);
		expect(revived.funnels[0].conditions).toEqual({ plan_tier: { in: ['pro', 'enterprise'] } });
	});

	test('expression bodies still get the (ctx) wrapper', () => {
		expect(evaluateFunctionCall({ functionName: 'arrow', body: 'Math.random() * 100' })).toBe('(ctx) => Math.random() * 100');
		expect(evaluateFunctionCall({ functionName: 'arrow', body: '(ctx) => ctx.profile.plan' })).toBe('((ctx) => ctx.profile.plan)');
		expect(evaluateFunctionCall({ functionName: 'arrow', body: 'function () { return 1; }' })).toBe('(function () { return 1; })');
	});
});
