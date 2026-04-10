/**
 * Dungeon loader: resolves dungeon input from multiple formats
 * Supports: config objects, file paths (.js/.mjs/.json), arrays of paths, and raw JS text
 */

import path from 'path';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import Chance from 'chance';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Detect what kind of input was passed and normalize it
 * @param {any} input - The raw input to DUNGEON_MASTER
 * @returns {{ type: 'object' | 'file' | 'files' | 'text', value: any }}
 */
export function detectInputType(input) {
	if (input === null || input === undefined) {
		throw new Error('dungeon-master: input is required. pass a config object, file path, array of paths, or javascript string.');
	}

	// Array of file paths
	if (Array.isArray(input)) {
		if (input.length === 0) {
			throw new Error('dungeon-master: empty array. pass at least one dungeon file path.');
		}
		for (const item of input) {
			if (typeof item !== 'string') {
				throw new Error(`dungeon-master: array items must be file path strings. got ${typeof item}.`);
			}
		}
		return { type: 'files', value: input };
	}

	// Plain config object
	if (typeof input === 'object') {
		return { type: 'object', value: input };
	}

	// String: file path or raw JS text
	if (typeof input === 'string') {
		const trimmed = input.trim();

		// Check if it looks like a file path (short, has file extension, no newlines)
		if (!trimmed.includes('\n') && looksLikeFilePath(trimmed)) {
			return { type: 'file', value: trimmed };
		}

		// Otherwise treat as raw JavaScript text
		return { type: 'text', value: trimmed };
	}

	throw new Error(`dungeon-master: unsupported input type "${typeof input}". expected object, string, or array.`);
}

/**
 * Check if a string looks like a file path vs JavaScript code
 * @param {string} str
 * @returns {boolean}
 */
function looksLikeFilePath(str) {
	const ext = path.extname(str);
	if (['.js', '.mjs', '.cjs', '.json'].includes(ext)) return true;
	// Could be a path without extension - check if file exists
	if (!str.includes('{') && !str.includes('(') && !str.includes('=')) {
		try {
			return existsSync(str) || existsSync(path.resolve(str));
		} catch {
			return false;
		}
	}
	return false;
}

/**
 * Load a dungeon config from a file path (.js, .mjs, or .json)
 * @param {string} filePath - Path to the dungeon file
 * @returns {Promise<import('../../types').Dungeon>}
 */
export async function loadFromFile(filePath) {
	const absolutePath = path.isAbsolute(filePath)
		? filePath
		: path.resolve(process.cwd(), filePath);

	if (!existsSync(absolutePath)) {
		throw new Error(`dungeon-master: file not found: ${absolutePath}`);
	}

	const ext = path.extname(absolutePath).toLowerCase();

	if (ext === '.json') {
		return loadFromJSONFile(absolutePath);
	}

	// Dynamic import for .js/.mjs files
	const module = await import(`file://${absolutePath}`);
	const config = module.default;

	if (!config || typeof config !== 'object') {
		throw new Error(`dungeon-master: ${path.basename(absolutePath)} must have a default export that is a config object.`);
	}

	validateDungeonShape(config);
	return config;
}

/**
 * Load a dungeon config from a JSON file (UI schema format)
 * JSON dungeons use { schema: {...}, hooks: "function string", version: "4.0" }
 * @param {string} jsonPath - Path to the JSON file
 * @returns {Promise<import('../../types').Dungeon>}
 */
async function loadFromJSONFile(jsonPath) {
	const raw = readFileSync(jsonPath, 'utf-8');
	const parsed = JSON.parse(raw);
	return parseJSONDungeon(parsed);
}

/**
 * Parse a JSON dungeon object (the UI schema format) into a runnable config
 * Handles { schema, hooks, ... } wrapper format and plain objects
 * @param {object} json - The parsed JSON object
 * @returns {import('../../types').Dungeon}
 */
export function parseJSONDungeon(json) {
	// Support both wrapped format { schema: {...}, hooks: "..." } and plain config
	const schema = json.schema || json;
	const hooksString = json.hooks || null;

	// Reconstruct the config from the JSON schema
	const config = reviveJSONConfig(schema);

	// Attach hook if present
	if (hooksString && typeof hooksString === 'string') {
		config.hook = hooksString; // config-validator.js will eval string hooks
	}

	validateDungeonShape(config);
	return config;
}

/**
 * Revive JSON config by converting function-call objects back to functions
 * JSON dungeons store functions as { functionName: "...", body: "...", args: [...] }
 * @param {any} value
 * @returns {any}
 */
function reviveJSONConfig(value) {
	if (value === null || value === undefined) return value;

	// Primitives
	if (typeof value !== 'object') return value;

	// Function-call objects → actual functions
	if (value.functionName) {
		return reviveFunctionObject(value);
	}

	// Arrays
	if (Array.isArray(value)) {
		return value.map(item => reviveJSONConfig(item));
	}

	// Objects
	const result = {};
	for (const [key, val] of Object.entries(value)) {
		result[key] = reviveJSONConfig(val);
	}
	return result;
}

/**
 * Convert a function-call object { functionName, body, args } back to a function
 * JSON dungeons store functions as { functionName: "arrow", body: "function() {...}" }
 * or { functionName: "chance.profession", args: [] }
 *
 * Note: many JSON-serialized function bodies reference closure variables (items,
 * mostChosenIndex, etc.) that don't exist at revival time. These will fail to eval
 * and fall back to null, which is handled gracefully by the config validator.
 *
 * @param {{ functionName: string, body?: string, args?: any[] }} obj
 * @returns {Function|any[]|null}
 */
function reviveFunctionObject(obj) {
	const { functionName, body, args = [] } = obj;

	if (body) {
		// Skip native code placeholders (e.g., "function () { [native code] }")
		if (body.includes('[native code]')) return null;

		try {
			// Create a function factory that provides common dungeon dependencies in scope.
			// JSON-serialized function bodies frequently reference `chance` as a free variable.
			// eslint-disable-next-line no-new-func
			const factory = new Function('chance', `return (${body})`);
			const chance = new Chance();
			const fn = factory(chance);
			if (typeof fn === 'function') {
				// Smoke-test: call it once to verify it doesn't reference other missing variables.
				// If it throws (e.g., referencing `items` from a lost closure), discard it.
				try { fn(); } catch { return null; }
				return fn;
			}
		} catch {
			// Function body can't be parsed - expected for some JSON revival edge cases
		}
	}

	// If we can't revive it, return the args as a static array (or null)
	return args.length > 0 ? args : null;
}

/**
 * Load a dungeon from raw JavaScript text
 * Writes to a temp file within the package so that imports resolve correctly,
 * dynamically imports it, then cleans up
 * @param {string} code - Raw JavaScript source code
 * @returns {Promise<import('../../types').Dungeon>}
 */
export async function loadFromText(code) {
	const tmpDir = path.join(PACKAGE_ROOT, '.dungeon-tmp');
	const tmpId = randomBytes(8).toString('hex');
	const tmpFile = path.join(tmpDir, `dungeon-${tmpId}.mjs`);

	try {
		// Ensure tmp directory exists
		mkdirSync(tmpDir, { recursive: true });

		// Write the code to a temp file
		writeFileSync(tmpFile, code, 'utf-8');

		// Dynamic import
		const module = await import(`file://${tmpFile}`);
		const config = module.default;

		if (!config || typeof config !== 'object') {
			throw new Error('dungeon-master: text dungeon must export a default config object (use "export default { ... }").');
		}

		validateDungeonShape(config);
		return config;

	} finally {
		// Clean up temp file
		try {
			unlinkSync(tmpFile);
			// Try to remove the tmp dir if empty
			const { readdirSync, rmdirSync } = await import('fs');
			const remaining = readdirSync(tmpDir);
			if (remaining.length === 0) rmdirSync(tmpDir);
		} catch {
			// cleanup is best-effort
		}
	}
}

/**
 * Validate that a config object has the minimum shape of a dungeon
 * This is a pre-flight check before passing to the full config validator
 * @param {any} config
 * @throws {Error} if the config is clearly not a valid dungeon
 */
export function validateDungeonShape(config) {
	if (!config || typeof config !== 'object' || Array.isArray(config)) {
		throw new Error('dungeon-master: config must be a plain object.');
	}

	// Must have at least one recognizable dungeon property
	const dungeonKeys = [
		'events', 'numEvents', 'numUsers', 'numDays', 'funnels',
		'userProps', 'superProps', 'hook', 'token', 'seed',
		'scdProps', 'groupKeys', 'lookupTables', 'mirrorProps',
		'hasAdSpend', 'soup', 'format', 'writeToDisk'
	];

	const hasAnyDungeonKey = dungeonKeys.some(key => key in config);
	if (!hasAnyDungeonKey) {
		throw new Error(
			'dungeon-master: config does not look like a dungeon. ' +
			'expected at least one of: events, numEvents, numUsers, numDays, funnels, userProps, hook, etc.'
		);
	}

	// Validate events if present
	if (config.events !== undefined) {
		if (!Array.isArray(config.events)) {
			throw new Error('dungeon-master: "events" must be an array.');
		}
		for (let i = 0; i < config.events.length; i++) {
			const ev = config.events[i];
			if (typeof ev === 'string') continue; // string events are auto-converted
			if (!ev || typeof ev !== 'object') {
				throw new Error(`dungeon-master: events[${i}] must be an object or string.`);
			}
			if (!ev.event || typeof ev.event !== 'string') {
				throw new Error(`dungeon-master: events[${i}] is missing a required "event" name string.`);
			}
		}
	}

	// Validate funnels if present
	if (config.funnels !== undefined) {
		if (!Array.isArray(config.funnels)) {
			throw new Error('dungeon-master: "funnels" must be an array.');
		}
		for (let i = 0; i < config.funnels.length; i++) {
			const f = config.funnels[i];
			if (!f || typeof f !== 'object') {
				throw new Error(`dungeon-master: funnels[${i}] must be an object.`);
			}
			if (!f.sequence || !Array.isArray(f.sequence)) {
				throw new Error(`dungeon-master: funnels[${i}] is missing a required "sequence" array.`);
			}
		}
	}

	// Validate hook if present
	if (config.hook !== undefined) {
		const hookType = typeof config.hook;
		if (hookType !== 'function' && hookType !== 'string') {
			throw new Error('dungeon-master: "hook" must be a function or a string containing a function.');
		}
	}

	// Validate numeric fields
	const numericFields = ['numEvents', 'numUsers', 'numDays', 'batchSize', 'concurrency'];
	for (const field of numericFields) {
		if (config[field] !== undefined) {
			if (typeof config[field] !== 'number' || config[field] < 0) {
				throw new Error(`dungeon-master: "${field}" must be a positive number.`);
			}
		}
	}
}
