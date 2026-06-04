/**
 * dungeon → JSON serialization.
 *
 * The inverse of `parseJSONDungeon` (lib/core/dungeon-loader.js): turns a runnable
 * dungeon into the UI/JSON wrapper format `{ schema, hooks, timestamp, version }`.
 * Functions in the schema are serialized to `{ functionName, body }` / `{ functionName, args }`
 * objects that `reviveJSONConfig` knows how to revive — so the output round-trips:
 *
 *   parseJSONDungeon(await dungeonToJSON(cfg))  →  runnable config
 *
 * This is BEST EFFORT. Arrow functions and bound `chance.*` methods round-trip cleanly;
 * detected utility calls (weighArray, weighNumRange, …) are serialized without their
 * arguments and revive to null, which the config validator handles gracefully.
 *
 * To preserve the field's TYPE even when the generator can't be revived, every function
 * is sampled at serialization time (when its closure is still live) and the inferred
 * output type is recorded as `dataType` (e.g. "number", "string", "boolean", "number[]").
 * So a field that loses its `weighNumRange(1,10)` generator still records `dataType: "number"`.
 */

import { detectInputType, loadFromFile, loadFromText } from './dungeon-loader.js';

/** Credential keys stripped from JSON output unless `includeCredentials` is set. */
const CREDENTIAL_KEYS = ['token', 'serviceAccount', 'serviceSecret', 'projectId', 'secret'];

/**
 * Convert a dungeon into its JSON representation.
 *
 * Accepts the same input flavors as the default export: a config object, a path to a
 * `.js`/`.mjs`/`.json` dungeon file, a raw JS source string (must `export default`), or
 * an array of file paths (returns an array of results).
 *
 * @param {import('../../types').Dungeon | string | string[]} input
 * @param {{ includeCredentials?: boolean }} [options]
 * @returns {Promise<import('../../types').DungeonJSON | import('../../types').DungeonJSON[]>}
 */
export async function dungeonToJSON(input, options = {}) {
	const { includeCredentials = false } = options;
	const { type, value } = detectInputType(input);

	switch (type) {
		case 'object':
			return serializeConfig(value, includeCredentials);
		case 'file':
			return serializeConfig(await loadFromFile(value), includeCredentials);
		case 'text':
			return serializeConfig(await loadFromText(value), includeCredentials);
		case 'files':
			return Promise.all(
				value.map(async (p) => serializeConfig(await loadFromFile(p), includeCredentials))
			);
		default:
			throw new Error(`dungeon-master: dungeonToJSON cannot handle input type "${type}".`);
	}
}

/**
 * Build the `{ schema, hooks, timestamp, version }` wrapper from a runnable config.
 * @param {import('../../types').Dungeon} config
 * @param {boolean} includeCredentials
 * @returns {import('../../types').DungeonJSON}
 */
function serializeConfig(config, includeCredentials) {
	// Hook may be a live function (from .js/text/object) or already a string (from .json).
	const hook = config.hook;
	const hooks = typeof hook === 'function'
		? hook.toString()
		: (typeof hook === 'string' ? hook : null);

	// Strip the hook (serialized separately) and, by default, credentials (don't leak tokens).
	const cleanConfig = { ...config };
	delete cleanConfig.hook;
	if (!includeCredentials) {
		for (const key of CREDENTIAL_KEYS) delete cleanConfig[key];
	}

	return {
		schema: convertToJSON(cleanConfig),
		hooks,
		timestamp: new Date().toISOString(),
		version: '4.0'
	};
}

/**
 * Convert a JavaScript value to a JSON-serializable form, turning functions into
 * `{ functionName, body | args }` objects that `reviveJSONConfig` can revive.
 * @param {any} value
 * @returns {any}
 */
export function convertToJSON(value) {
	// Null/undefined
	if (value === null || value === undefined) {
		return null;
	}

	// Primitives
	if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
		return value;
	}

	// Functions - convert to object representation
	if (typeof value === 'function') {
		return convertFunctionToObject(value);
	}

	// Arrays
	if (Array.isArray(value)) {
		return value.map(item => convertToJSON(item));
	}

	// Objects
	if (typeof value === 'object') {
		const result = {};
		for (const [key, val] of Object.entries(value)) {
			result[key] = convertToJSON(val);
		}
		return result;
	}

	// Fallback
	return null;
}

/**
 * Convert a function to its object representation.
 * Arrow functions and bound `chance.*` methods round-trip cleanly; detected utility
 * functions are stored by name without args (best effort). Every form also carries a
 * sampled `dataType` so the field's output type survives even when the generator can't.
 * @param {Function} func
 * @returns {import('../../types').SerializedFunction}
 */
function convertFunctionToObject(func) {
	const funcString = func.toString();
	// Sample now, while the closure is still live — the only reliable time to learn the type.
	const dataType = inferDataType(func);

	// Arrow function
	if (funcString.startsWith('(') || funcString.startsWith('_') || funcString.includes('=>')) {
		return withDataType({ functionName: 'arrow', body: funcString }, dataType);
	}

	// Bound chance methods (e.g., chance.name.bind(chance))
	if (funcString.includes('.bind(')) {
		const match = funcString.match(/chance\.(\w+)\.bind/);
		if (match) {
			return withDataType({ functionName: `chance.${match[1]}`, args: [] }, dataType);
		}
	}

	// Try to detect common utility functions
	// This is a best-effort approach - some complex functions might not be detected
	const commonFunctions = [
		'weighNumRange',
		'weighArray',
		'weighChoices',
		'pickAWinner',
		'date',
		'integer',
		'uid',
		'comma'
	];

	for (const fnName of commonFunctions) {
		if (funcString.includes(fnName)) {
			// Args can't be recovered from a stringified function, but dataType is captured.
			return withDataType({ functionName: fnName, args: [] }, dataType);
		}
	}

	// Generic function - just store as arrow function
	return withDataType({ functionName: 'arrow', body: funcString }, dataType);
}

/**
 * Attach a `dataType` field if one was inferred (omitted otherwise).
 * @param {import('../../types').SerializedFunction} obj
 * @param {string | undefined} dataType
 * @returns {import('../../types').SerializedFunction}
 */
function withDataType(obj, dataType) {
	if (dataType) obj.dataType = dataType;
	return obj;
}

/**
 * Sample a function (no args) and classify its return type. Best effort — returns
 * undefined if the call throws or yields an indeterminate value.
 * @param {Function} func
 * @returns {string | undefined}
 */
function inferDataType(func) {
	let value;
	try {
		value = func();
	} catch {
		return undefined;
	}
	return classifyValue(value);
}

/**
 * Map a sampled value to a type label: "number" | "string" | "boolean" | "date" |
 * "object" | "<elementType>[]" | "array". Returns undefined for null/undefined/functions.
 * @param {any} value
 * @returns {string | undefined}
 */
function classifyValue(value) {
	if (value === null || value === undefined) return undefined;
	if (Array.isArray(value)) {
		const el = value.find((v) => v !== null && v !== undefined);
		const elType = el === undefined ? undefined : classifyValue(el);
		return elType ? `${elType}[]` : 'array';
	}
	if (value instanceof Date) return 'date';
	const t = typeof value;
	if (t === 'number' || t === 'string' || t === 'boolean') return t;
	if (t === 'object') return 'object';
	return undefined;
}
