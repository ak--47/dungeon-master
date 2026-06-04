//@ts-nocheck
/**
 * Unit tests for the `dungeonToJSON` export (lib/core/dungeon-to-json.js).
 * Object-input only — pure, no file I/O. File/array input is covered in
 * tests/integration/json-interop.test.js.
 */
import { describe, test, expect } from 'vitest';
import { dungeonToJSON, parseJSONDungeon } from '../../index.js';
import Chance from 'chance';

const chance = new Chance();

function makeConfig() {
	return {
		seed: 'test-seed',
		numUsers: 50,
		token: 'SECRET_TOKEN',
		serviceSecret: 'shh',
		superProps: {
			plan: ['free', 'pro'],
			level: () => chance.integer({ min: 1, max: 10 }),
			tag: () => 'beta',
			vip: () => true,
			scores: () => [1, 2, 3],
		},
		events: [{ event: 'play', weight: 1, properties: { score: [1, 2, 3] } }],
		hook: (record, type, meta) => record,
	};
}

describe('dungeonToJSON (object input)', () => {
	test('returns the { schema, hooks, timestamp, version } wrapper', async () => {
		const json = await dungeonToJSON(makeConfig());
		expect(json).toHaveProperty('schema');
		expect(json).toHaveProperty('hooks');
		expect(typeof json.timestamp).toBe('string');
		expect(json.version).toBe('4.0');
	});

	test('serializes the hook to a string and excludes it from schema', async () => {
		const json = await dungeonToJSON(makeConfig());
		expect(typeof json.hooks).toBe('string');
		expect(json.hooks).toContain('record');
		expect(json.schema).not.toHaveProperty('hook');
	});

	test('strips credentials by default', async () => {
		const json = await dungeonToJSON(makeConfig());
		expect(json.schema).not.toHaveProperty('token');
		expect(json.schema).not.toHaveProperty('serviceSecret');
	});

	test('keeps credentials with includeCredentials: true', async () => {
		const json = await dungeonToJSON(makeConfig(), { includeCredentials: true });
		expect(json.schema.token).toBe('SECRET_TOKEN');
		expect(json.schema.serviceSecret).toBe('shh');
	});

	test('serializes functions to functionName objects', async () => {
		const json = await dungeonToJSON(makeConfig());
		expect(json.schema.superProps.level).toMatchObject({ functionName: 'arrow' });
		expect(typeof json.schema.superProps.level.body).toBe('string');
		// plain arrays pass through unchanged
		expect(json.schema.superProps.plan).toEqual(['free', 'pro']);
	});

	test('records the sampled dataType of each function field', async () => {
		const { schema } = await dungeonToJSON(makeConfig());
		expect(schema.superProps.level.dataType).toBe('number');
		expect(schema.superProps.tag.dataType).toBe('string');
		expect(schema.superProps.vip.dataType).toBe('boolean');
		expect(schema.superProps.scores.dataType).toBe('number[]');
	});

	test('round-trips through parseJSONDungeon', async () => {
		const json = await dungeonToJSON(makeConfig());
		const config = parseJSONDungeon(json);
		expect(config.numUsers).toBe(50);
		expect(config.events[0].event).toBe('play');
		// hook is re-attached as a string (config-validator evals it at run time)
		expect(typeof config.hook).toBe('string');
		// arrow-bodied prop revives to a callable
		expect(typeof config.superProps.level).toBe('function');
	});
});
