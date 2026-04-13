#!/usr/bin/env node

/**
 * Extracts a complete schema from a JavaScript dungeon file.
 *
 * Output contains everything about the dungeon EXCEPT:
 *   - hook function (runtime logic, not schema)
 *   - credentials (token, serviceAccount, serviceSecret, projectId)
 *   - execution params (seed, format, gzip, verbose, concurrency, batchSize, writeToDisk, region)
 *
 * Property values are simplified:
 *   - Plain arrays → deduplicated
 *   - weighNumRange(min,max) arrays → { "$range": [min, max] }
 *   - Functions (pickAWinner, weighChoices, etc.) → sampled and deduplicated
 *   - High-cardinality / complex values → type hint
 *
 * Usage:
 *   node scripts/extract-dungeon-schema.mjs <input.js> [output.json]
 *   node scripts/extract-dungeon-schema.mjs dungeons/vertical/*.js   # batch mode
 */

import { writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initChance } from '../lib/utils/utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

if (args.length === 0) {
	console.error('Usage: node scripts/extract-dungeon-schema.mjs <dungeon.js> [output.json]');
	console.error('       node scripts/extract-dungeon-schema.mjs dungeons/vertical/*.js');
	process.exit(1);
}

// Batch mode: multiple files
if (args.length > 2 || (args.length > 1 && args[1].endsWith('.js'))) {
	for (const file of args) {
		if (!file.endsWith('.js') && !file.endsWith('.mjs')) continue;
		try {
			await processOne(file);
		} catch (e) {
			console.error(`  ❌ ${path.basename(file)}: ${e.message}`);
		}
	}
} else {
	await processOne(args[0], args[1]);
}

async function processOne(inputFile, outputFile) {
	const inputPath = path.resolve(inputFile);
	const baseName = path.basename(inputPath, '.js');
	const outputPath = outputFile
		? path.resolve(outputFile)
		: path.join(path.dirname(inputPath), `${baseName}-schema.json`);

	// Seed RNG for deterministic sampling of function-based properties
	initChance('schema-extraction');

	const mod = await import(`file://${inputPath}`);
	const config = mod.default;
	if (!config) throw new Error('No default export');

	const schema = {};

	// ── Events ──────────────────────────────────────────────────────
	if (config.events?.length) {
		schema.events = config.events.map(evt => {
			const entry = { event: evt.event };
			if (evt.weight && evt.weight !== 1) entry.weight = evt.weight;
			if (evt.isFirstEvent) entry.isFirstEvent = true;
			if (evt.isChurnEvent) entry.isChurnEvent = true;
			if (evt.returnLikelihood !== undefined) entry.returnLikelihood = evt.returnLikelihood;
			if (evt.isStrictEvent) entry.isStrictEvent = true;
			if (evt.isSessionStartEvent) entry.isSessionStartEvent = true;
			if (evt.properties && Object.keys(evt.properties).length) {
				const props = extractProps(evt.properties);
				if (Object.keys(props).length) entry.properties = props;
			}
			return entry;
		});
	}

	// ── Funnels ─────────────────────────────────────────────────────
	if (config.funnels?.length) {
		schema.funnels = config.funnels.map(f => {
			const entry = { sequence: f.sequence };
			if (f.name) entry.name = f.name;
			if (f.isFirstFunnel) entry.isFirstFunnel = true;
			if (f.conversionRate !== undefined) entry.conversionRate = f.conversionRate;
			if (f.timeToConvert !== undefined) entry.timeToConvert = f.timeToConvert;
			if (f.order && f.order !== 'sequential') entry.order = f.order;
			if (f.weight && f.weight !== 1) entry.weight = f.weight;
			if (f.requireRepeats) entry.requireRepeats = true;
			if (f.experiment) entry.experiment = true;
			if (f.bindPropsIndex !== undefined) entry.bindPropsIndex = f.bindPropsIndex;
			if (f.conditions) entry.conditions = f.conditions;
			if (f.props && Object.keys(f.props).length) {
				const fp = extractProps(f.props);
				if (Object.keys(fp).length) entry.props = fp;
			}
			return entry;
		});
	}

	// ── Super props ─────────────────────────────────────────────────
	if (config.superProps && Object.keys(config.superProps).length) {
		const sp = extractProps(config.superProps);
		if (Object.keys(sp).length) schema.superProps = sp;
	}

	// ── User props ──────────────────────────────────────────────────
	if (config.userProps && Object.keys(config.userProps).length) {
		const up = extractProps(config.userProps);
		if (Object.keys(up).length) schema.userProps = up;
	}

	// ── Group keys ──────────────────────────────────────────────────
	if (config.groupKeys?.length) {
		schema.groupKeys = config.groupKeys.map(gk => {
			if (Array.isArray(gk)) {
				const entry = { key: gk[0], count: gk[1] };
				if (gk[2]) entry.affectsEvents = gk[2];
				return entry;
			}
			return gk;
		});
	}

	// ── Group props ─────────────────────────────────────────────────
	if (config.groupProps && Object.keys(config.groupProps).length) {
		schema.groupProps = {};
		for (const [groupKey, props] of Object.entries(config.groupProps)) {
			schema.groupProps[groupKey] = extractProps(props);
		}
	}

	// ── SCD props ───────────────────────────────────────────────────
	if (config.scdProps && Object.keys(config.scdProps).length) {
		schema.scdProps = {};
		for (const [key, scd] of Object.entries(config.scdProps)) {
			const entry = {};
			entry.type = scd.type || "user";
			if (scd.frequency) entry.frequency = scd.frequency;
			if (scd.timing) entry.timing = scd.timing;
			if (scd.max !== undefined) entry.max = scd.max;
			if (scd.values) {
				const simplified = simplifyValue(scd.values);
				if (simplified) entry.values = simplified;
			}
			schema.scdProps[key] = entry;
		}
	}

	writeFileSync(outputPath, JSON.stringify(schema, null, 2) + '\n', 'utf-8');
	console.log(`  ✅ ${baseName}-schema.json`);
}

// ── Property extraction ──────────────────────────────────────────────

/**
 * Extracts a simplified property map from a dungeon properties object.
 * Returns { key: simplifiedValue } for each property.
 * Keys are always preserved — complex values get a type hint instead of being omitted.
 */
function extractProps(propsObj) {
	const result = {};
	for (const [key, value] of Object.entries(propsObj)) {
		const simplified = simplifyValue(value);
		if (simplified !== null) {
			result[key] = simplified;
		} else {
			// Always keep the key — use a type hint for unresolvable values
			result[key] = inferTypeHint(value);
		}
	}
	return result;
}

/**
 * Infer a type hint for a value we can't fully resolve.
 * Tries calling the function first; falls back to string analysis.
 */
function inferTypeHint(value) {
	if (typeof value === 'function') {
		// Try calling to detect actual output type
		try {
			const result = value();
			if (typeof result === 'function') {
				try {
					const inner = result();
					if (Array.isArray(inner)) {
						// Drill through nested arrays to find the first object
						let sample = inner;
						while (Array.isArray(sample) && sample.length > 0 && Array.isArray(sample[0])) {
							sample = sample[0];
						}
						if (sample.length > 0 && typeof sample[0] === 'object' && sample[0] !== null && !Array.isArray(sample[0])) {
							return { "$type": "object[]", "$keys": Object.keys(sample[0]) };
						}
						return { "$type": "array" };
					}
					return { "$type": typeof inner };
				} catch { return { "$type": "function" }; }
			}
			if (typeof result === 'string') return { "$type": "string" };
			if (typeof result === 'number') return { "$type": "number" };
			if (typeof result === 'boolean') return { "$type": "boolean" };
			if (Array.isArray(result)) return { "$type": "array" };
			return { "$type": typeof result };
		} catch { /* can't call — fall through to string analysis */ }

		// String analysis fallback
		const fnStr = value.toString();
		if (fnStr.includes('guid') || fnStr.includes('uuid')) return { "$type": "string" };
		if (fnStr.includes('integer')) return { "$type": "number" };
		return { "$type": "unknown" };
	}
	if (Array.isArray(value)) {
		if (value.length > 0 && typeof value[0] === 'object') return { "$type": "object[]" };
		return { "$type": "array" };
	}
	return { "$type": typeof value };
}

/**
 * Simplify a property value to its schema representation.
 * Returns null if the value is too complex or high-cardinality to represent.
 */
function simplifyValue(value) {
	// Primitives
	if (typeof value === 'string' || typeof value === 'boolean') return [value];
	if (typeof value === 'number') return [value];

	// Arrays (plain values or weighNumRange output)
	if (Array.isArray(value)) {
		return simplifyArray(value);
	}

	// Functions: pickAWinner, weighChoices, chance bindings, custom generators
	if (typeof value === 'function') {
		return simplifyFunction(value);
	}

	return null;
}

/**
 * Simplify an array value. Detects numeric ranges vs categorical arrays.
 */
function simplifyArray(arr) {
	if (arr.length === 0) return null;

	// Check element types
	const types = new Set(arr.map(v => typeof v));

	// All numbers — likely weighNumRange output if large, or small explicit list
	if (types.size === 1 && types.has('number')) {
		if (arr.length > 10) {
			// Numeric range (weighNumRange produces 50 elements)
			const min = Math.min(...arr);
			const max = Math.max(...arr);
			// Round to clean integers if values are close to integers
			const roundedMin = Number.isInteger(min) ? min : Math.round(min * 100) / 100;
			const roundedMax = Number.isInteger(max) ? max : Math.round(max * 100) / 100;
			return { "$range": [roundedMin, roundedMax] };
		}
		// Small explicit numeric list — deduplicate
		return [...new Set(arr)];
	}

	// All strings — deduplicate
	if (types.size === 1 && types.has('string')) {
		return [...new Set(arr)];
	}

	// All booleans — deduplicate
	if (types.size === 1 && types.has('boolean')) {
		return [...new Set(arr)];
	}

	// Mixed primitives (e.g. [true, false, 0.75, 1.0]) — deduplicate
	if ([...types].every(t => t === 'string' || t === 'number' || t === 'boolean')) {
		return [...new Set(arr)];
	}

	// Contains objects/arrays (nested items like makeProducts)
	if (arr.some(v => typeof v === 'object' && v !== null && !Array.isArray(v))) {
		// Extract keys from first object to show the shape
		const firstObj = arr.find(v => typeof v === 'object' && v !== null);
		if (firstObj) {
			const keys = Object.keys(firstObj);
			return { "$type": "object[]", "$keys": keys };
		}
	}
	return null;
}

/**
 * Simplify a function-based value by sampling it.
 * Tries calling first; string analysis only for bound methods.
 */
function simplifyFunction(fn) {
	try {
		// Try calling the function first
		const result = fn();

		// Double-wrapped function (e.g. makeProducts returns fn → fn → array)
		if (typeof result === 'function') {
			try {
				const inner = result();
				if (Array.isArray(inner)) {
					if (inner.some(v => typeof v === 'object' && v !== null)) return null;
					return simplifyArray(inner);
				}
			} catch { /* inner call failed */ }
			return null;
		}

		// Function returned an array (pickAWinner, weighChoices)
		if (Array.isArray(result)) {
			return simplifyArray(result);
		}

		// Function returned a primitive (chance.animal, chance.profession, etc.)
		if (typeof result === 'string') {
			// Sample a few times to see if it's low-cardinality
			const samples = new Set([result]);
			for (let i = 0; i < 30; i++) {
				samples.add(fn());
			}
			// If < 15 unique values in 30 samples, it's low cardinality — include
			if (samples.size < 15) {
				return [...samples].sort();
			}
			return null; // high cardinality
		}

		return null;
	} catch {
		return null; // function can't be called standalone — skip
	}
}
