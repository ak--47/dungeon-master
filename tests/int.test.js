import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import fs from 'fs';
import * as u from 'ak-tools';
dayjs.extend(utc);
import 'dotenv/config';
import path from 'path';

/** @typedef {import('../types').Dungeon} Config */
/** @typedef {import('../types').EventConfig} EventConfig */
/** @typedef {import("../types").EventSchema} EventSchema */
/** @typedef {import('../types').ValueValid} ValueValid */
/** @typedef {import('../types').HookedArray} hookArray */
/** @typedef {import('../types').hookArrayOptions} hookArrayOptions */
/** @typedef {import('../types').Person} Person */
/** @typedef {import('../types').Funnel} Funnel */
/** @typedef {import('../types').UserProfile} UserProfile */
/** @typedef {import('../types').SCDSchema} SCDSchema */
/** @typedef {import('../types').Storage} Storage */

// Import main function
import main from '../index.js';

// Import generators directly
import { makeAdSpend } from '../lib/generators/adspend.js';
import { makeEvent } from '../lib/generators/events.js';
import { makeFunnel } from '../lib/generators/funnels.js';
import { makeProfile } from '../lib/generators/profiles.js';
import { makeSCD } from '../lib/generators/scd.js';
import { makeMirror } from '../lib/generators/mirror.js';

// Import orchestrators directly
import { sendToMixpanel } from '../lib/orchestrators/mixpanel-sender.js';
import { userLoop } from '../lib/orchestrators/user-loop.js';
import { validateDungeonConfig } from '../lib/core/config-validator.js';

// Import utilities directly
import { createHookArray } from '../lib/core/storage.js';
import { inferFunnels } from '../lib/core/config-validator.js';
import { validEvent, initChance } from '../lib/utils/utils.js';
import { createContext } from '../lib/core/context.js';
import { validateDungeonConfig } from '../lib/core/config-validator.js';

// Alias for compatibility
const hookArray = createHookArray;

/**
 * Creates a test context object for generator function testing
 * @param {Object} configOverrides - Config overrides for testing
 * @returns {Object} Test context object
 */
function createTestContext(configOverrides = {}) {
    const baseConfig = {
        numEvents: 100,
        numUsers: 10,
        numDays: 30,
        hasAdSpend: false,
        hasLocation: false,
        hasAvatar: false,
        verbose: false,
        writeToDisk: false,
        isAnonymous: false,
        hasAnonIds: false,
        hasSessionIds: false,
        concurrency: 1,
        ...configOverrides
    };
    
    const validatedConfig = validateDungeonConfig(baseConfig);
    const context = createContext(validatedConfig);
    
    return context;
}


// Mock the global variables
let CAMPAIGNS;
let DEFAULTS;
let STORAGE;
let CONFIG;
import { campaigns, devices, locations } from '../lib/templates/defaults.js';

beforeEach(async () => {
	// Reset seeded RNG before each test for isolation
	initChance("test-seed");

	// Reset global variables before each test
	CAMPAIGNS = [
		{ utm_campaign: ["campaign1", "campaign2"], utm_source: ["source1"], utm_medium: ["medium1"], utm_content: ["content1"], utm_term: ["term1"] }
	];
	DEFAULTS = {
		locationsUsers: () => ({ city: 'San Francisco' }),
		locationsEvents: () => ({ city: 'San Francisco' }),
		iOSDevices: () => 'iPhone',
		androidDevices: () => 'Android',
		desktopDevices: () => 'Desktop',
		browsers: () => 'Chrome',
		campaigns: () => 'campaign1'
	};

	/** @type {Storage} */
	STORAGE = {
		eventData: await hookArray([], {}),
		userProfilesData: await hookArray([], {}),
		adSpendData: await hookArray([], {}),
		scdTableData: [await hookArray([], {})],
		groupProfilesData: await hookArray([], {}),
		lookupTableData: await hookArray([], {}),
		mirrorEventData: await hookArray([], {})
	};


	/** @type {Config} */
	CONFIG = {
		numUsers: 10,
		numEvents: 100,
		numDays: 30,
		name: 'TestSimulation',
		hook: (record) => record
	};
	global.CAMPAIGNS = CAMPAIGNS;
	global.DEFAULTS = DEFAULTS;
	global.STORAGE = STORAGE;
	global.CONFIG = CONFIG;
	const FIXED_NOW = dayjs('2024-02-02').unix();
	global.FIXED_NOW = FIXED_NOW;

});

beforeEach(() => {

});

describe.sequential('generators', () => {

	test('adspend: works', async () => {
		const campaigns = [{
			utm_source: ["foo"],
			utm_campaign: ["one"],
			utm_medium: ["two"],
			utm_content: ["three"],
			utm_term: ["four"]
		},
		{
			utm_source: ["bar"],
			utm_campaign: ["five"],
			utm_medium: ["six"],
			utm_content: ["seven"],
			utm_term: ["eight"]
		}];
		const context = createTestContext({ hasAdSpend: true });
		const result = await makeAdSpend(context, dayjs().subtract(30, 'day').toISOString(), campaigns);
		expect(result.length).toBe(2);
		expect(result[0]).toHaveProperty('event', '$ad_spend');
		expect(result[1]).toHaveProperty('event', '$ad_spend');
	});

	test('adspend: empty', async () => {
		const context = createTestContext({ hasAdSpend: true });
		const result = await makeAdSpend(context, dayjs().subtract(30, 'day').toISOString(), []);
		expect(result.length).toBe(0);
	});

	test('adspend: external', async () => {
		const campaigns = [
			{ utm_source: ["source1"], utm_campaign: ["one"], utm_medium: ["two"], utm_content: ["three"], utm_term: ["four"] },
			{ utm_source: ["source2"], utm_campaign: ["two"], utm_medium: ["three"], utm_content: ["four"], utm_term: ["five"] }
		];
		const context = createTestContext({ hasAdSpend: true });
		const result = await makeAdSpend(context, dayjs().subtract(30, 'day').toISOString(), campaigns);
		expect(result.length).toBe(2);
		result.forEach(event => {
			expect(event).toHaveProperty('event', '$ad_spend');
			expect(event).toHaveProperty('utm_campaign');
			expect(event).toHaveProperty('utm_source');
			expect(event).toHaveProperty('cost');
			expect(event).toHaveProperty('clicks');
			expect(event).toHaveProperty('impressions');
			expect(event).toHaveProperty('views');
		});
	});


	test('makeEvent: works', async () => {
		/** @type {EventConfig} */
		const eventConfig = {
			event: "test_event",
			properties: {
				prop1: ["value1", "value2"],
				prop2: ["value3", "value4"],
				prop3: ["value5"]
			},
		};
		const context = createTestContext();
		const result = await makeEvent(context, "known_id", dayjs.unix(global.FIXED_NOW).subtract(30, 'd').unix(), eventConfig, ["anon_id"]);
		expect(result).toHaveProperty('event', 'test_event');
		expect(result).toHaveProperty('device_id', 'anon_id');
		expect(result).not.toHaveProperty('session_id');
		// expect(result).toHaveProperty('source', 'dm4');
		expect(result).toHaveProperty('insert_id');
		expect(result).toHaveProperty('time');
		expect(result).toHaveProperty('prop1');
		expect(result).toHaveProperty('prop2');
		expect(result.prop1 === "value1" || result.prop1 === "value2").toBeTruthy();
		expect(result.prop2 === "value3" || result.prop2 === "value4").toBeTruthy();
		expect(result).toHaveProperty('prop3', 'value5');
	});

	test('makeEvent: opt params', async () => {
		const eventConfig = { event: "test_event", properties: {} };
		const context = createTestContext();
		const result = await makeEvent(context, "known_id", dayjs.unix(global.FIXED_NOW).subtract(30, 'd').unix(), eventConfig);
		expect(result).toHaveProperty('event', 'test_event');
		expect(result).toHaveProperty('user_id', 'known_id');
		// expect(result).toHaveProperty('source', 'dm4');
		expect(result).toHaveProperty('insert_id');
		expect(result).toHaveProperty('time');
	});

	test('makeEvent: correct defaults', async () => {
		const eventConfig = {
			event: "test_event",
			properties: {
				prop1: ["value1", "value2"],
				prop2: ["value3", "value4"]
			},
		};
		const context = createTestContext();
		const result = await makeEvent(context, "known_id", dayjs.unix(global.FIXED_NOW).subtract(30, 'd').unix(), eventConfig, ["anon_id"]);
		expect(result.prop1 === "value1" || result.prop1 === "value2").toBeTruthy();
		expect(result.prop2 === "value3" || result.prop2 === "value4").toBeTruthy();
	});


	test('makeFunnel: works', async () => {
		const funnelConfig = {
			sequence: ["step1", "step2"],
			conversionRate: 100,
			order: 'sequential'
		};
		/** @type {Person} */
		const user = { distinct_id: "user1", name: "test", created: dayjs().toISOString(), anonymousIds: [], sessionIds: [] };
		/** @type {UserProfile} */
		const profile = { created: dayjs().toISOString(), distinct_id: "user1" };
		/** @type {Record<string, SCDSchema[]>} */
		const scd = { "scd_example": [{ distinct_id: "user1", insertTime: dayjs().toISOString(), startTime: dayjs().toISOString() }] };

		const context = createTestContext();
		const [result, converted] = await makeFunnel(context, funnelConfig, user, dayjs.unix(global.FIXED_NOW).subtract(30, 'd').unix(), profile, scd);
		expect(result.length).toBe(2);
		expect(converted).toBe(true);
		expect(result.every(e => validEvent(e))).toBeTruthy();
	});

	test('makeFunnel: conversion rates', async () => {
		const funnelConfig = {
			sequence: ["step1", "step2", "step3"],
			conversionRate: 50,
			order: 'sequential'
		};
		const user = { distinct_id: "user1", name: "test", created: dayjs().toISOString(), anonymousIds: [], sessionIds: [] };
		const profile = { created: dayjs().toISOString(), distinct_id: "user1" };
		const scd = { "scd_example": [{ distinct_id: "user1", insertTime: dayjs().toISOString(), startTime: dayjs().toISOString() }] };

		const context = createTestContext();
		const [result, converted] = await makeFunnel(context, funnelConfig, user, dayjs.unix(global.FIXED_NOW).subtract(30, 'd').unix(), profile, scd);
		expect(result.length).toBeGreaterThanOrEqual(1);
		expect(result.length).toBeLessThanOrEqual(3);
		expect(result.every(e => validEvent(e))).toBeTruthy();
	});

	test('makeFunnel: ordering', async () => {
		const funnelConfig = {
			sequence: ["step1", "step2", "step3"],
			conversionRate: 100,
			order: 'random'
		};
		const user = { distinct_id: "user1", name: "test", created: dayjs().toISOString(), anonymousIds: [], sessionIds: [] };
		const profile = { created: dayjs().toISOString(), distinct_id: "user1" };
		const scd = { "scd_example": [{ distinct_id: "user1", insertTime: dayjs().toISOString(), startTime: dayjs().toISOString() }] };

		const context = createTestContext();
		const [result, converted] = await makeFunnel(context, funnelConfig, user, dayjs.unix(global.FIXED_NOW).subtract(30, 'd').unix(), profile, scd);
		expect(result.length).toBe(3);
		expect(converted).toBe(true);
		expect(result.every(e => validEvent(e))).toBeTruthy();
	});

	test('makeFunnel: experiment mode creates $experiment_started', async () => {
		const funnelConfig = {
			name: 'Test',
			sequence: ["step1", "step2"],
			conversionRate: 100,
			order: 'sequential',
			experiment: true,
			_experiment: { name: 'Test Experiment', variants: [
				{ name: 'Variant A', conversionMultiplier: 0.7, ttcMultiplier: 1.5, weight: 1 },
				{ name: 'Variant B', conversionMultiplier: 1.3, ttcMultiplier: 0.7, weight: 1 },
				{ name: 'Control', conversionMultiplier: 1.0, ttcMultiplier: 1.0, weight: 1 },
			], startUnix: null },
		};
		const user = { distinct_id: "user1", name: "test", created: dayjs.unix(global.FIXED_NOW).subtract(10, 'days').toISOString(), anonymousIds: [] };
		const profile = { created: dayjs.unix(global.FIXED_NOW).subtract(10, 'days').toISOString(), distinct_id: "user1" };
		const scd = {};

		const context = createTestContext();
		const [result, converted] = await makeFunnel(context, funnelConfig, user, dayjs.unix(global.FIXED_NOW).subtract(5, 'd').unix(), profile, scd);

		expect(result.length).toBeGreaterThanOrEqual(2);
		expect(result[0].event).toBe('$experiment_started');
		expect(result[0]['Experiment name']).toBe('Test Experiment');
		expect(['Variant A', 'Variant B', 'Control']).toContain(result[0]['Variant name']);
	});

	test('makeFunnel: experiment mode preserves funnel props', async () => {
		const funnelConfig = {
			name: 'Test Experiment',
			sequence: ["step1", "step2"],
			conversionRate: 100,
			order: 'sequential',
			experiment: true,
			_experiment: { name: 'Test Experiment Experiment', variants: [
				{ name: 'Variant A', conversionMultiplier: 0.7, ttcMultiplier: 1.5, weight: 1 },
				{ name: 'Variant B', conversionMultiplier: 1.3, ttcMultiplier: 0.7, weight: 1 },
				{ name: 'Control', conversionMultiplier: 1.0, ttcMultiplier: 1.0, weight: 1 },
			], startUnix: null },
			props: {
				source: 'test-source',
				campaign: 'test-campaign'
			}
		};
		const user = { distinct_id: "user1", name: "test", created: dayjs.unix(global.FIXED_NOW).subtract(10, 'days').toISOString(), anonymousIds: [] };
		const profile = { created: dayjs.unix(global.FIXED_NOW).subtract(10, 'days').toISOString(), distinct_id: "user1" };
		const scd = {};

		const context = createTestContext();
		const [result, converted] = await makeFunnel(context, funnelConfig, user, dayjs.unix(global.FIXED_NOW).subtract(5, 'd').unix(), profile, scd);

		expect(result[0]).not.toHaveProperty('source');
		expect(result[0]).not.toHaveProperty('campaign');
		expect(result[1].source).toBe('test-source');
		expect(result[1].campaign).toBe('test-campaign');
	});

	test('makeFunnel: experiment mode deterministic variant per user', async () => {
		const funnelConfig = {
			name: 'Distribution Test',
			sequence: ["step1"],
			conversionRate: 100,
			experiment: true,
			_experiment: { name: 'Distribution Test Experiment', variants: [
				{ name: 'Variant A', conversionMultiplier: 0.7, ttcMultiplier: 1.5, weight: 1 },
				{ name: 'Variant B', conversionMultiplier: 1.3, ttcMultiplier: 0.7, weight: 1 },
				{ name: 'Control', conversionMultiplier: 1.0, ttcMultiplier: 1.0, weight: 1 },
			], startUnix: null },
		};
		const context = createTestContext();
		const variantCounts = { 'Variant A': 0, 'Variant B': 0, 'Control': 0 };

		for (let i = 0; i < 90; i++) {
			const user = {
				distinct_id: `user${i}`,
				name: "test",
				created: dayjs.unix(global.FIXED_NOW).subtract(10, 'days').toISOString(),
				anonymousIds: [],
			};
			const [result, converted] = await makeFunnel(context, funnelConfig, user, dayjs.unix(global.FIXED_NOW).subtract(5, 'd').unix());
			const variant = result[0]['Variant name'];
			variantCounts[variant]++;
		}

		// Deterministic assignment should produce all 3 variants
		expect(variantCounts['Variant A']).toBeGreaterThan(10);
		expect(variantCounts['Variant B']).toBeGreaterThan(10);
		expect(variantCounts['Control']).toBeGreaterThan(10);
		expect(variantCounts['Variant A'] + variantCounts['Variant B'] + variantCounts['Control']).toBe(90);

		// Same user should always get same variant
		const user = { distinct_id: 'user0', name: 'test', created: dayjs.unix(global.FIXED_NOW).subtract(10, 'days').toISOString(), anonymousIds: [] };
		const [r1] = await makeFunnel(context, funnelConfig, user, dayjs.unix(global.FIXED_NOW).subtract(5, 'd').unix());
		const [r2] = await makeFunnel(context, funnelConfig, user, dayjs.unix(global.FIXED_NOW).subtract(3, 'd').unix());
		expect(r1[0]['Variant name']).toBe(r2[0]['Variant name']);
	});


	test('makeProfile: works', async () => {
		const context = createTestContext();
		const props = {
			name: ["John", "Jane"],
			age: [25, 30]
		};
		const result = await makeProfile(context, props, { foo: "bar" });
		expect(result).toHaveProperty('name');
		expect(result).toHaveProperty('age');
		expect(result).toHaveProperty('foo', 'bar');
		expect(result.name === "John" || result.name === "Jane").toBeTruthy();
		expect(result.age === 25 || result.age === 30).toBeTruthy();
	});

	test('makeProfile: correct defaults', async () => {
		const context = createTestContext();
		const props = {
			name: ["John", "Jane"],
			age: [25, 30]
		};
		const result = await makeProfile(context, props);
		expect(result).toHaveProperty('name');
		expect(result).toHaveProperty('age');
		expect(result.name === "John" || result.name === "Jane").toBeTruthy();
		expect(result.age === 25 || result.age === 30).toBeTruthy();
	});


	test('makeSCD: works', async () => {
		const context = createTestContext();
		const result = await makeSCD(context, ["value1", "value2"], "prop1", "distinct_id", 5, dayjs().subtract(90, 'day').toISOString());
		expect(result.length).toBeGreaterThan(1);
		const [first, second] = result;
		expect(first).toHaveProperty('prop1');
		expect(second).toHaveProperty('prop1');
		expect(first).toHaveProperty('distinct_id', 'distinct_id');
		expect(second).toHaveProperty('distinct_id', 'distinct_id');
		expect(first).toHaveProperty('startTime');
		expect(second).toHaveProperty('startTime');
		expect(first).toHaveProperty('insertTime');
		expect(second).toHaveProperty('insertTime');
		expect(first.prop1 === "value1" || first.prop1 === "value2").toBeTruthy();
		expect(second.prop1 === "value1" || second.prop1 === "value2").toBeTruthy();
		// Verify monotonic ordering
		expect(second.startTime > first.startTime).toBe(true);
	});

	test('makeSCD: no mutations', async () => {
		const context = createTestContext();
		const result = await makeSCD(context, ["value1", "value2"], "prop1", "distinct_id", 0, dayjs().toISOString());
		expect(result.length).toBe(0);
	});

	test('makeSCD: large mutations', async () => {
		const context = createTestContext();
		const result = await makeSCD(context, ["value1", "value2"], "prop1", "distinct_id", 100, dayjs().subtract(100, 'd').toISOString());
		expect(result.length).toBeGreaterThan(0);
		result.forEach(entry => {
			expect(entry).toHaveProperty('prop1');
			expect(entry).toHaveProperty('distinct_id', 'distinct_id');
			expect(entry).toHaveProperty('startTime');
			expect(entry).toHaveProperty('insertTime');
			expect(entry.prop1 === "value1" || entry.prop1 === "value2").toBeTruthy();
		});
	});

	test('mirror: create', async () => {
		/** @type {EventSchema} */
		const oldEvent = {
			event: "old",
			insert_id: "test",
			source: "test",
			time: dayjs().toISOString(),
			user_id: "test"
		};

		/** @type {Config} */
		const config = {
			mirrorProps: {
				"newProp": {
					events: "*",
					strategy: "create",
					values: ["new"]
				}
			}
		};
		await STORAGE.eventData.hookPush(oldEvent);
		//ugh side fx
		// Create context with the test config and storage
		const context = createTestContext(config);
		context.setStorage(STORAGE);
		await makeMirror(context);
		const [newData] = STORAGE.mirrorEventData;
		expect(newData).toHaveProperty('newProp', "new");
	});

	test('mirror: delete', async () => {
		/** @type {EventSchema} */
		const oldEvent = {
			event: "old",
			insert_id: "test",
			source: "test",
			time: dayjs().toISOString(),
			user_id: "test",
			oldProp: "valueToDelete"
		};

		/** @type {Config} */
		const config = {
			mirrorProps: {
				"oldProp": {
					events: "*",
					strategy: "delete"
				}
			}
		};
		await STORAGE.eventData.hookPush(oldEvent);

		// Create context with the test config and storage
		const context = createTestContext(config);
		context.setStorage(STORAGE);
		await makeMirror(context);
		const [newData] = STORAGE.mirrorEventData;
		expect(newData).not.toHaveProperty('oldProp');
	});

	test('mirror: fill', async () => {
		/** @type {EventSchema} */
		const oldEvent = {
			event: "old",
			insert_id: "test",
			source: "test",
			time: dayjs().subtract(8, 'days').toISOString(),  // Set time to 8 days ago
			user_id: "test",
			fillProp: "initialValue"
		};

		/** @type {Config} */
		const config = {
			mirrorProps: {
				"fillProp": {
					events: "*",
					strategy: "fill",
					values: ["filledValue"],
					daysUnfilled: 7
				}
			}
		};
		await STORAGE.eventData.hookPush(oldEvent);

		// Create context with the test config and storage
		const context = createTestContext(config);
		context.setStorage(STORAGE);
		await makeMirror(context);
		const [newData] = STORAGE.mirrorEventData;
		expect(newData).toHaveProperty('fillProp', "filledValue");
	});

	test('mirror: update', async () => {
		/** @type {EventSchema} */
		const oldEvent = {
			event: "old",
			insert_id: "test",
			source: "test",
			time: dayjs().toISOString(),
			user_id: "test",
			updateProp: "initialValue"
		};

		/** @type {Config} */
		const config = {
			mirrorProps: {
				"updateProp": {
					events: "*",
					strategy: "update",
					values: ["updatedValue"]
				}
			}
		};
		await STORAGE.eventData.hookPush(oldEvent);

		// Create context with the test config and storage
		const context = createTestContext(config);
		context.setStorage(STORAGE);
		await makeMirror(context);
		const [newData] = STORAGE.mirrorEventData;
		expect(newData).toHaveProperty('updateProp', "initialValue");
	});

	test('mirror: update nulls', async () => {
		/** @type {EventSchema} */
		const oldEvent = {
			event: "old",
			insert_id: "test",
			source: "test",
			time: dayjs().toISOString(),
			user_id: "test"
			// updateProp is not set initially
		};

		/** @type {Config} */
		const config = {
			mirrorProps: {
				"updateProp": {
					events: "*",
					strategy: "update",
					values: ["updatedValue"]
				}
			}
		};
		await STORAGE.eventData.hookPush(oldEvent);

		// Create context with the test config and storage
		const context = createTestContext(config);
		context.setStorage(STORAGE);
		await makeMirror(context);
		const [newData] = STORAGE.mirrorEventData;
		expect(newData).toHaveProperty('updateProp', "updatedValue");
	});


	test('mirror: update with no initial value', async () => {
		/** @type {EventSchema} */
		const oldEvent = {
			event: "old",
			insert_id: "test",
			source: "test",
			time: dayjs().toISOString(),
			user_id: "test"
			// updateProp is not set initially
		};

		/** @type {Config} */
		const config = {
			mirrorProps: {
				"updateProp": {
					events: "*",
					strategy: "update",
					values: ["updatedValue"]
				}
			}
		};
		await STORAGE.eventData.hookPush(oldEvent);

		// Create context with the test config and storage
		const context = createTestContext(config);
		context.setStorage(STORAGE);
		await makeMirror(context);
		const [newData] = STORAGE.mirrorEventData;
		expect(newData).toHaveProperty('updateProp', "updatedValue");
	});



});

describe.sequential('orchestrators', () => {

	test('sendToMixpanel: works', async () => {
		CONFIG.token = "test_token";
		const context = createTestContext(CONFIG);
		context.setStorage(STORAGE);
		const result = await sendToMixpanel(context);
		expect(result).toHaveProperty('events');
		expect(result).toHaveProperty('users');
		expect(result).toHaveProperty('groups');
	});

	// test('sendToMixpanel: no token', async () => {
	// 	CONFIG.token = null;
	// 	const context = createTestContext(CONFIG);
	// 	context.setStorage(STORAGE);
	// 	await expect(sendToMixpanel(context)).rejects.toThrow();
	// });

	test('sendToMixpanel: empty storage', async () => {
		CONFIG.token = "test_token";
		STORAGE = {
			eventData: await hookArray([], {}),
			userProfilesData: await hookArray([], {}),
			adSpendData: await hookArray([], {}),
			scdTableData: [await hookArray([], {})],
			groupProfilesData: await hookArray([], {}),
			lookupTableData: await hookArray([], {}),
			mirrorEventData: await hookArray([], {})
		};
		const context = createTestContext(CONFIG);
		context.setStorage(STORAGE);
		const result = await sendToMixpanel(context);
		expect(result.events).toBeDefined();
		expect(result.users).toBeDefined();
		expect(result.groups).toHaveLength(0);
	});


	test('userLoop: works (no funnels; no inference)', async () => {
		/** @type {Config} */
		const config = {
			numUsers: 2,
			numEvents: 40,
			numDays: 30,
			userProps: {},
			scdProps: {},
			funnels: [],
			isAnonymous: false,
			hasAnonIds: false,
			hasSessionIds: false,
			hasLocation: false,
			alsoInferFunnels: false,
			events: [{ event: "foo" }, { event: "bar" }, { event: "baz" }]
		};
		const context = createTestContext(config);
	context.setStorage(STORAGE);
	await userLoop(context);
		expect(STORAGE.userProfilesData.length).toBe(2);
		expect(STORAGE.eventData.length).toBeGreaterThanOrEqual(5);
		expect(STORAGE.eventData.every(e => validEvent(e))).toBeTruthy();
	});


	test('userLoop: works (funnels)', async () => {
		/** @type {Config} */
		const config = {
			numUsers: 2,
			numEvents: 50,
			numDays: 30,
			userProps: {},
			scdProps: {},
			events: [
				{
					"event": "step1",
				},
				{
					"event": "step2"
				}
			],
			funnels: [{ sequence: ["step1", "step2"], conversionRate: 100, order: 'sequential' }],
		};
		const context = createTestContext(config);
		context.setStorage(STORAGE);
		await userLoop(context);
		expect(STORAGE.userProfilesData.length).toBe(2);
		expect(STORAGE.eventData.length).toBeGreaterThanOrEqual(14);
		expect(STORAGE.eventData.every(e => validEvent(e))).toBeTruthy();


	});

	test('userLoop: mixed config', async () => {
		const config = {
			numUsers: 3,
			numEvents: 15,
			numDays: 10,
			userProps: { name: ["Alice", "Bob", "Charlie"] },
			scdProps: { prop1: ["value1", "value2"] },
			funnels: [],
			events: [{ event: "event1" }, { event: "event2" }]
			
		};
		const context = createTestContext(config);
		context.setStorage(STORAGE);
		await userLoop(context);
		expect(STORAGE.userProfilesData.length).toBe(3);
		expect(STORAGE.eventData.length).toBeGreaterThanOrEqual(5);
		expect(STORAGE.scdTableData[0].length).toBeGreaterThan(0);
		expect(STORAGE.eventData.every(e => validEvent(e))).toBeTruthy();
	});

	test('userLoop: no events', async () => {
		const config = {
			numUsers: 2,
			numEvents: 0,
			numDays: 30,
			userProps: {},
			scdProps: {},
			funnels: [],
			isAnonymous: false,
			hasAnonIds: false,
			hasSessionIds: false,
			hasLocation: false,
			events: []
		};
		const context = createTestContext(config);
		context.setStorage(STORAGE);
		await userLoop(context);
		expect(STORAGE.userProfilesData.length).toBe(2);
		expect(STORAGE.eventData.length).toBe(0);
	});



	test('validateDungeonConfig: works', async () => {
		const config = {
			numEvents: 100,
			numUsers: 10,
			numDays: 30
		};
		const result = await validateDungeonConfig(config);
		expect(result).toHaveProperty('numEvents', 100);
		expect(result).toHaveProperty('numUsers', 10);
		expect(result).toHaveProperty('numDays', 30);
		expect(result).toHaveProperty('events');
		expect(result).toHaveProperty('superProps');
	});

	test('validateDungeonConfig: correct defaults', async () => {
		const config = {};
		const result = await validateDungeonConfig(config);
		expect(result).toHaveProperty('numEvents', 100_000);
		expect(result).toHaveProperty('numUsers', 1000);
		expect(result).toHaveProperty('numDays', 30);
		expect(result).toHaveProperty('events');
		expect(result).toHaveProperty('superProps');
	});

	test('validateDungeonConfig: merges', async () => {
		const config = {
			numEvents: 100,
			numUsers: 10,
			numDays: 30,
			events: [{ event: "test_event" }],
			superProps: { luckyNumber: [7] }
		};
		const result = await validateDungeonConfig(config);
		expect(result).toHaveProperty('numEvents', 100);
		expect(result).toHaveProperty('numUsers', 10);
		expect(result).toHaveProperty('numDays', 30);
		expect(result).toHaveProperty('events', [{ event: "test_event" }]);
		expect(result).toHaveProperty('superProps', { luckyNumber: [7] });
	});

	test('auto-batch: numEvents >= 2M auto-sets batchSize to 1M', () => {
		const warnSpy = vi.spyOn(console, 'warn');
		const config = validateDungeonConfig({ numEvents: 2_000_000, numUsers: 1000 });
		expect(config.batchSize).toBe(1_000_000);
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining('Auto-enabling batch mode')
		);
		warnSpy.mockRestore();
	});

	test('auto-batch: explicit batchSize is respected even when numEvents >= 2M', () => {
		const config = validateDungeonConfig({ numEvents: 2_000_000, numUsers: 1000, batchSize: 500_000 });
		expect(config.batchSize).toBe(500_000);
	});

	test('auto-batch: numEvents < 2M does not change default batchSize', () => {
		const config = validateDungeonConfig({ numEvents: 1_999_999, numUsers: 1000 });
		expect(config.batchSize).toBe(2_500_000);
	});

	test('throws when token is placeholder and writeToDisk is false', () => {
		expect(() => validateDungeonConfig({
			token: "your-mixpanel-token",
			writeToDisk: false
		})).toThrowError(/No Mixpanel token set/);
	});

	test('does not throw when token is placeholder but writeToDisk is true', () => {
		expect(() => validateDungeonConfig({
			token: "your-mixpanel-token",
			writeToDisk: true
		})).not.toThrow();
	});

	test('does not throw when token is a real value and writeToDisk is false', () => {
		expect(() => validateDungeonConfig({
			token: "abc123realtoken",
			writeToDisk: false
		})).not.toThrow();
	});

	test('does not throw when token is empty string and writeToDisk is false (programmatic use)', () => {
		expect(() => validateDungeonConfig({
			token: "",
			writeToDisk: false
		})).not.toThrow();
	});

	test('does not throw when token is null and writeToDisk is false (default)', () => {
		expect(() => validateDungeonConfig({
			token: null,
			writeToDisk: false
		})).not.toThrow();
	});

	test('batch mode: writeToDisk=false with low batchSize warns but succeeds', async () => {
		const warnSpy = vi.spyOn(console, 'warn');
		const results = await main({
			numUsers: 10,
			numEvents: 100,
			batchSize: 50,
			writeToDisk: false,
			verbose: false,
			seed: 'batch-warn-test'
		});
		// Should not throw — just warn
		expect(results.eventCount).toBeGreaterThan(0);
		expect(results.userCount).toBe(10);
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining('batchSize')
		);
		warnSpy.mockRestore();
	});

	test('batch mode: tail data flushed when writeToDisk=false', async () => {
		const results = await main({
			numUsers: 10,
			numEvents: 200,
			batchSize: 50,
			writeToDisk: false,
			verbose: false,
			seed: 'flush-tail-test',
			format: 'csv'
		});

		expect(results.eventCount).toBeGreaterThan(20);

		// Batch files should have been written (even though writeToDisk=false)
		const dataFiles = (await u.ls('./data')).filter(f =>
			f.includes('-EVENTS') && f.includes('-part-')
		);
		expect(dataFiles.length).toBeGreaterThanOrEqual(2);
	});

});

describe.sequential('determinism', () => {
	test('seeded runs produce identical events', async () => {
		const config = {
			numUsers: 5,
			numEvents: 50,
			numDays: 30,
			seed: 'determinism-test',
			writeToDisk: false,
			verbose: false
		};
		const r1 = await main(config);
		const r2 = await main(config);

		expect(r1.eventCount).toBe(r2.eventCount);
		expect(r1.userCount).toBe(r2.userCount);

		// Event data (minus insert_id, which is a non-deterministic UUID) must match
		const strip = (e) => { const { insert_id, ...rest } = e; return rest; };
		const events1 = r1.eventData.map(strip);
		const events2 = r2.eventData.map(strip);
		expect(events1).toEqual(events2);
	});

	test('seeded runs produce identical user profiles', async () => {
		const config = {
			numUsers: 10,
			numEvents: 100,
			numDays: 30,
			seed: 'profile-determinism',
			writeToDisk: false,
			verbose: false,
			userProps: { plan: ["free", "pro", "enterprise"] }
		};
		const r1 = await main(config);
		const r2 = await main(config);

		const p1 = r1.userProfilesData.map(p => ({ id: p.distinct_id, plan: p.plan }));
		const p2 = r2.userProfilesData.map(p => ({ id: p.distinct_id, plan: p.plan }));
		expect(p1).toEqual(p2);
	});

	test('different seeds produce different events', async () => {
		const base = { numUsers: 5, numEvents: 50, numDays: 30, writeToDisk: false, verbose: false };
		const r1 = await main({ ...base, seed: 'seed-a' });
		const r2 = await main({ ...base, seed: 'seed-b' });

		const ids1 = r1.eventData.map(e => e.insert_id);
		const ids2 = r2.eventData.map(e => e.insert_id);
		expect(ids1).not.toEqual(ids2);
	});
});

