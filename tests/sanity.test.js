//@ts-nocheck
/**
 * Module Integration Tests
 *
 * These tests validate the core data generation functionality by calling
 * DUNGEON_MASTER directly (programmatic API).
 * They ensure proper validation, data quality, file output, and
 * that all input types (object, file, JSON, array, text, overrides) work.
 */

import generate from '../index.js';
import DUNGEON_MASTER, { loadFromFile, loadFromText, parseJSONDungeon, validateDungeonShape } from '../index.js';
import { detectInputType } from '../lib/core/dungeon-loader.js';
import 'dotenv/config';
import * as u from 'ak-tools';
import Papa from 'papaparse';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import simple from '../dungeons/technical/simple.js';

import foobar from '../dungeons/technical/foobar.js';
import scd from '../dungeons/technical/scd.js';

const timeout = 600000;

/** @typedef {import('../types').Dungeon} Dungeon */


// Use sequential execution to prevent tests from interfering with each other
// since they create/modify files in the same directories
describe.sequential('Module Integration Tests', () => {

	test('sanity check - basic data generation', async () => {
		console.log('SANITY TEST');
		/** @type {Dungeon} */
		const config = {
			numEvents: 100,
			numUsers: 10,
			numDays: 7,
			writeToDisk: true,
			format: 'csv',
			seed: 'sanity-test'
		};

		const result = await generate(config);

		// Validate result object
		expect(result.eventCount).toBeGreaterThan(0);
		expect(result.userCount).toBeGreaterThan(0);
		expect(result.files.length).toBeGreaterThan(0);

		// Check files were created
		const files = (await u.ls('./data')).filter(a => a.includes('.csv'));
		expect(files.length).toBe(2);

		const users = files.filter(a => a.includes('USERS'));
		const events = files.filter(a => a.includes('EVENTS'));
		expect(users.length).toBe(1);
		expect(events.length).toBe(1);

		// Validate data quality
		const eventData = (await u.load(events[0])).trim();
		const userProfilesData = (await u.load(users[0])).trim();
		const parsedEvents = Papa.parse(eventData, { header: true }).data;
		const parsedUsers = Papa.parse(userProfilesData, { header: true }).data;

		expect(parsedEvents.length).toBeGreaterThan(10);
		expect(parsedUsers.length).toBeGreaterThan(5);
		expect(parsedUsers.every(u => u.distinct_id)).toBe(true);
		expect(parsedEvents.every(e => e.event)).toBe(true);
		expect(parsedEvents.every(e => e.time)).toBe(true);
		expect(parsedEvents.every(e => e.insert_id)).toBe(true);
		expect(parsedEvents.every(e => e.device_id || e.user_id)).toBe(true);
		expect(parsedUsers.every(u => u.name)).toBe(true);
		expect(parsedUsers.every(u => u.email)).toBe(true);
		expect(parsedUsers.every(u => u.avatar)).toBe(false);
		expect(parsedEvents.every(e => validateEvent(e))).toBe(true);
		expect(parsedUsers.every(u => validateUser(u))).toBe(true);
	}, timeout);

	test('minimal config - default values', async () => {
		console.log('MINIMAL CONFIG TEST');
		/** @type {Dungeon} */
		const config = {
			numEvents: 100,
			numUsers: 10,
			writeToDisk: true,
			seed: 'minimal-test'
		};

		const result = await generate(config);

		expect(result.eventCount).toBeGreaterThan(0);
		expect(result.userCount).toBe(10);
		const csvs = (await u.ls('./data')).filter(a => a.includes('.csv'));
		expect(csvs.length).toBe(2);
	}, timeout);

	test('simple dungeon - basic model', async () => {
		console.log('SIMPLE DUNGEON TEST');
		/** @type {Dungeon} */
		const config = {
			...simple,
			numEvents: 100,
			numUsers: 10,
			seed: "simple-test",
			writeToDisk: true,
			format: 'csv',
			hasAdSpend: false
		
		};

		const result = await generate(config);

		expect(result.eventCount).toBeGreaterThan(0);
		expect(result.userCount).toBe(10);
		const csvs = (await u.ls('./data')).filter(a => a.includes('.csv'));
		expect(csvs.length).toBe(2);
	}, timeout);

	test('parquet format output', async () => {
		console.log('PARQUET FORMAT TEST');
		/** @type {Dungeon} */
		const config = {
			numEvents: 50,
			numUsers: 5,
			writeToDisk: true,
			format: 'parquet',
			seed: 'parquet-test'
		};

		const result = await generate(config);

		expect(result.files.length).toBeGreaterThan(0);
		const parquetFiles = result.files.filter(f => f.includes('.parquet'));
		expect(parquetFiles.length).toBeGreaterThan(0);
	}, timeout);

	test('gzip compression', async () => {
		console.log('GZIP COMPRESSION TEST');
		/** @type {Dungeon} */
		const config = {
			numEvents: 50,
			numUsers: 5,
			writeToDisk: true,
			format: 'json',
			gzip: true,
			seed: 'gzip-test'
		};

		const result = await generate(config);

		expect(result.files.length).toBeGreaterThan(0);
		const gzipFiles = result.files.filter(f => f.endsWith('.gz'));
		expect(gzipFiles.length).toBeGreaterThan(0);
	}, timeout);

	test('in-memory only - no disk writes', async () => {
		console.log('IN-MEMORY TEST');
		/** @type {Dungeon} */
		const config = {
			numEvents: 50,
			numUsers: 5,
			writeToDisk: false,
			batchSize: 100000, // Must be >= numEvents when writeToDisk is false
			seed: 'memory-test'
		};

		const result = await generate(config);

		expect(result.eventCount).toBeGreaterThan(0);
		expect(result.userCount).toBe(5);
		expect(result.eventData).toBeDefined();
		expect(result.userProfilesData).toBeDefined();
		expect(result.eventData.length).toBeGreaterThan(0);
		expect(result.userProfilesData.length).toBe(5);
	}, timeout);

	test('batch mode - writes multiple files and imports correctly', async () => {
		console.log('BATCH MODE TEST');
		/** @type {Dungeon} */
		const config = {
			numEvents: 150,
			numUsers: 10,
			writeToDisk: true,
			format: 'csv',
			batchSize: 50, // Force batch mode with small batch size
			seed: 'batch-test',
			token: process.env.MIXPANEL_TOKEN || 'test-token'
		};

		const result = await generate(config);

		// Verify event and user counts
		expect(result.eventCount).toBeGreaterThan(0);
		expect(result.userCount).toBe(10);

		// Verify batch files were created
		const files = (await u.ls('./data')).filter(a => a.includes('.csv'));
		expect(files.length).toBeGreaterThan(0);

		// If a real token is provided, verify import results
		if (process.env.MIXPANEL_TOKEN && result.importResults) {
			expect(result.importResults.events).toBeDefined();
			expect(result.importResults.users).toBeDefined();
			expect(result.importResults.events.success).toBeGreaterThan(0);
			expect(result.importResults.users.success).toBeGreaterThan(0);
			console.log(`✅ Batch mode imported ${result.importResults.events.success} events and ${result.importResults.users.success} users`);
		} else {
			console.log('⚠️  Skipping import verification (no MIXPANEL_TOKEN provided)');
		}
	}, timeout);

	test('write to disk with import - data persists and imports correctly', async () => {
		console.log('WRITE TO DISK + IMPORT TEST');
		/** @type {Dungeon} */
		const config = {
			numEvents: 75,
			numUsers: 8,
			writeToDisk: true,
			format: 'json',
			seed: 'write-import-test',
			token: process.env.MIXPANEL_TOKEN || 'test-token'
		};

		const result = await generate(config);

		// Verify data was generated
		expect(result.eventCount).toBeGreaterThan(10);
		expect(result.userCount).toBe(8);

		// Verify files were created
		const files = (await u.ls('./data')).filter(a => a.includes('.json'));
		expect(files.length).toBe(2); // events + users

		const eventFiles = files.filter(f => f.includes('EVENTS'));
		const userFiles = files.filter(f => f.includes('USERS'));

		expect(eventFiles.length).toBe(1);
		expect(userFiles.length).toBe(1);

		// Verify files contain data
		const eventData = await u.load(eventFiles[0]);
		const userData = await u.load(userFiles[0]);

		const eventLines = eventData.trim().split('\n');
		const userLines = userData.trim().split('\n');

		expect(eventLines.length).toBeGreaterThan(0);
		expect(userLines.length).toBe(8);

		// Verify each line is valid JSON
		expect(() => JSON.parse(eventLines[0])).not.toThrow();
		expect(() => JSON.parse(userLines[0])).not.toThrow();

		// If a real token is provided, verify import results
		if (process.env.MIXPANEL_TOKEN && result.importResults) {
			expect(result.importResults.events).toBeDefined();
			expect(result.importResults.users).toBeDefined();

			// THIS IS THE KEY TEST: Files were flushed to disk, arrays are empty,
			// but import should still read from disk and succeed
			expect(result.importResults.events.success).toBeGreaterThan(0);
			expect(result.importResults.users.success).toBeGreaterThan(0);

			// Verify imported counts match generated counts
			expect(result.importResults.events.success).toBe(result.eventCount);
			expect(result.importResults.users.success).toBe(result.userCount);

			console.log(`✅ Write-to-disk mode imported ${result.importResults.events.success} events and ${result.importResults.users.success} users from files`);
		} else {
			console.log('⚠️  Skipping import verification (no MIXPANEL_TOKEN provided)');
		}
	}, timeout);
});

describe('DUNGEON_MASTER input types', () => {

	test('accepts a config object', async () => {
		const result = await DUNGEON_MASTER({
			numUsers: 10,
			numEvents: 100,
			numDays: 5,
			seed: 'input-object',
			writeToDisk: false
		});

		expect(result.eventCount).toBeGreaterThan(0);
		expect(result.userCount).toBe(10);
		expect(result.eventData.length).toBeGreaterThan(0);
		expect(result.userProfilesData.length).toBe(10);
	}, timeout);

	test('accepts a .js file path', async () => {
		const dungeonPath = path.resolve(__dirname, '../dungeons/technical/simple.js');
		const result = await DUNGEON_MASTER(dungeonPath, {
			numUsers: 10,
			numEvents: 100,
			seed: 'input-js-file',
			writeToDisk: false,
			token: ""
		});

		expect(result.eventCount).toBeGreaterThan(0);
		expect(result.userCount).toBe(10);
		// simple.js defines specific events like "page view", "checkout", etc.
		const eventNames = [...new Set(result.eventData.map(e => e.event))];
		expect(eventNames.length).toBeGreaterThan(1);
	}, timeout);

	test('accepts a relative .js file path', async () => {
		const result = await DUNGEON_MASTER('./dungeons/technical/foobar.js', {
			numUsers: 5,
			numEvents: 50,
			seed: 'input-relative',
			writeToDisk: false,
			token: ""
		});

		expect(result.eventCount).toBeGreaterThan(0);
		expect(result.userCount).toBe(5);
	}, timeout);

	test('accepts a .json file path', async () => {
		const jsonPath = path.resolve(__dirname, '../dungeons/technical/simplest-schema.json');
		const result = await DUNGEON_MASTER(jsonPath, {
			numUsers: 10,
			numEvents: 100,
			seed: 'input-json-file',
			writeToDisk: false
		});

		expect(result.eventCount).toBeGreaterThan(0);
		expect(result.userCount).toBe(10);
	}, timeout);

	test('accepts an array of file paths', async () => {
		const results = await DUNGEON_MASTER([
			'./dungeons/technical/simple.js',
			'./dungeons/technical/foobar.js'
		], {
			numUsers: 5,
			numEvents: 50,
			seed: 'input-array',
			writeToDisk: false,
			token: ""
		});

		expect(Array.isArray(results)).toBe(true);
		expect(results.length).toBe(2);
		expect(results[0].eventCount).toBeGreaterThan(0);
		expect(results[1].eventCount).toBeGreaterThan(0);
		expect(results[0].userCount).toBe(5);
		expect(results[1].userCount).toBe(5);
	}, timeout);

	test('accepts raw JavaScript text', async () => {
		const code = `
			export default {
				numUsers: 8,
				numEvents: 200,
				numDays: 5,
				seed: 'text-dungeon',
				writeToDisk: false,
				events: [
					{ event: 'alpha', weight: 5 },
					{ event: 'beta', weight: 3 },
					{ event: 'gamma', weight: 2 }
				]
			};
		`;

		const result = await DUNGEON_MASTER(code);

		expect(result.eventCount).toBeGreaterThan(0);
		expect(result.userCount).toBe(8);
		const eventNames = [...new Set(result.eventData.map(e => e.event))];
		expect(eventNames.length).toBeGreaterThanOrEqual(2);
	}, timeout);

	test('accepts raw JS text with imports', async () => {
		const code = `
			import dayjs from 'dayjs';

			export default {
				numUsers: 5,
				numEvents: 50,
				numDays: 10,
				seed: 'text-imports',
				writeToDisk: false,
				events: [
					{ event: 'test event', weight: 5, isFirstEvent: true }
				],
				hook: function(record, type, meta) {
					if (type === 'event') {
						record.hook_ran = true;
					}
					return record;
				}
			};
		`;

		const result = await DUNGEON_MASTER(code);

		expect(result.eventCount).toBeGreaterThan(0);
		// Verify hook ran
		const withHookFlag = result.eventData.filter(e => e.hook_ran === true);
		expect(withHookFlag.length).toBeGreaterThan(0);
	}, timeout);

	test('overrides merge into config from file', async () => {
		const result = await DUNGEON_MASTER('./dungeons/technical/simple.js', {
			numUsers: 3,
			numEvents: 30,
			seed: 'override-test',
			writeToDisk: false,
			token: ""
		});

		expect(result.userCount).toBe(3);
	}, timeout);

	test('overrides merge into config object', async () => {
		const result = await DUNGEON_MASTER(
			{ numUsers: 100, numEvents: 1000, numDays: 30, seed: 'override-obj' },
			{ numUsers: 4, numEvents: 40, writeToDisk: false }
		);

		expect(result.userCount).toBe(4);
	}, timeout);

	test('rejects null/undefined input', async () => {
		await expect(DUNGEON_MASTER(null)).rejects.toThrow(/input is required/);
		await expect(DUNGEON_MASTER(undefined)).rejects.toThrow(/input is required/);
	});

	test('rejects empty array', async () => {
		await expect(DUNGEON_MASTER([])).rejects.toThrow(/empty array/);
	});

	test('rejects non-string array items', async () => {
		await expect(DUNGEON_MASTER([123, 456])).rejects.toThrow(/file path strings/);
	});

	test('rejects missing file', async () => {
		await expect(DUNGEON_MASTER('./does-not-exist.js')).rejects.toThrow(/file not found/i);
	});

	test('config with no dungeon keys still works (config-validator fills defaults)', async () => {
		// objects go straight to the config-validator which fills in defaults
		// this is intentional: users can pass minimal configs
		const result = await DUNGEON_MASTER({ writeToDisk: false });
		expect(result.eventCount).toBeGreaterThan(0);
	}, timeout);
});

describe('detectInputType', () => {
	test('detects object', () => {
		const { type } = detectInputType({ numUsers: 10 });
		expect(type).toBe('object');
	});

	test('detects file path (.js)', () => {
		const { type } = detectInputType('./dungeons/technical/simple.js');
		expect(type).toBe('file');
	});

	test('detects file path (.json)', () => {
		const { type } = detectInputType('./dungeons/technical/simplest-schema.json');
		expect(type).toBe('file');
	});

	test('detects array of paths', () => {
		const { type } = detectInputType(['./a.js', './b.js']);
		expect(type).toBe('files');
	});

	test('detects raw JS text (multiline)', () => {
		const { type } = detectInputType('export default {\n  numUsers: 10\n};');
		expect(type).toBe('text');
	});

	test('detects raw JS text (single line without .js extension)', () => {
		const { type } = detectInputType('export default { numUsers: 10 }');
		expect(type).toBe('text');
	});
});

describe('validateDungeonShape', () => {
	test('passes valid minimal config', () => {
		expect(() => validateDungeonShape({ numUsers: 10 })).not.toThrow();
		expect(() => validateDungeonShape({ events: [{ event: 'test' }] })).not.toThrow();
		expect(() => validateDungeonShape({ numEvents: 100, numDays: 30 })).not.toThrow();
	});

	test('rejects non-object', () => {
		expect(() => validateDungeonShape(null)).toThrow();
		expect(() => validateDungeonShape('string')).toThrow();
		expect(() => validateDungeonShape([1, 2, 3])).toThrow();
	});

	test('rejects object with no dungeon keys', () => {
		expect(() => validateDungeonShape({ foo: 'bar' })).toThrow(/does not look like a dungeon/);
	});

	test('rejects non-array events', () => {
		expect(() => validateDungeonShape({ events: 'not-array' })).toThrow(/must be an array/);
	});

	test('rejects events missing event name', () => {
		expect(() => validateDungeonShape({ events: [{ weight: 5 }] })).toThrow(/missing a required "event" name/);
	});

	test('rejects non-array funnels', () => {
		expect(() => validateDungeonShape({ funnels: 'not-array', numEvents: 10 })).toThrow(/must be an array/);
	});

	test('rejects funnels missing sequence', () => {
		expect(() => validateDungeonShape({ funnels: [{ conversionRate: 50 }], numEvents: 10 })).toThrow(/missing a required "sequence"/);
	});

	test('rejects invalid hook type', () => {
		expect(() => validateDungeonShape({ hook: 42, numEvents: 10 })).toThrow(/must be a function or a string/);
	});

	test('rejects negative numeric fields', () => {
		expect(() => validateDungeonShape({ numEvents: -5 })).toThrow(/positive number/);
		expect(() => validateDungeonShape({ numUsers: -1 })).toThrow(/positive number/);
	});

	test('accepts string events (auto-converted)', () => {
		expect(() => validateDungeonShape({ events: ['page view', 'click'] })).not.toThrow();
	});

	test('accepts hook as string', () => {
		expect(() => validateDungeonShape({
			hook: 'function(r) { return r; }',
			numEvents: 10
		})).not.toThrow();
	});
});

describe('parseJSONDungeon', () => {
	test('parses wrapped format { schema, hooks }', () => {
		const json = {
			schema: {
				numUsers: 10,
				numEvents: 100,
				events: [{ event: 'test' }]
			},
			hooks: 'function(r, t, m) { return r; }',
			version: '4.0'
		};

		const config = parseJSONDungeon(json);
		expect(config.numUsers).toBe(10);
		expect(config.numEvents).toBe(100);
		expect(config.events[0].event).toBe('test');
		expect(typeof config.hook).toBe('string'); // hook string, config-validator evals it
	});

	test('parses plain config object (no wrapper)', () => {
		const json = {
			numUsers: 5,
			numEvents: 50,
			events: [{ event: 'click' }]
		};

		const config = parseJSONDungeon(json);
		expect(config.numUsers).toBe(5);
		expect(config.events[0].event).toBe('click');
	});
});

beforeEach(() => {
	clearData();
});

afterEach(() => {
	clearData();
});

function clearData() {
	try {
		console.log('clearing data files...');
		const { execSync } = require('child_process');
		execSync(`npm run prune`, { stdio: 'ignore' });
		console.log('...files cleared 👍');
	}
	catch (err) {
		console.log('error clearing files (may be expected)');
	}
}

function validateEvent(event) {
	if (!event.event) return false;
	if (!event.device_id && !event.user_id) return false;
	if (!event.time) return false;
	if (!event.insert_id) return false;
	return true;
}

function validateUser(user) {
	if (!user.distinct_id) return false;
	if (!user.name) return false;
	if (!user.email) return false;
	return true;
}

function validTime(str) {
	if (!str) return false;
	if (str.startsWith('-')) return false;
	if (!str.startsWith('20')) return false;
	return true;
}
