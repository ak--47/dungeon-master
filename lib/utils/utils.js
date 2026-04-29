import fs from 'fs';
import Chance from 'chance';
import readline from 'readline';
import { comma } from 'ak-tools';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import path from 'path';
import { mkdir, parseGCSUri } from 'ak-tools';
import { existsSync } from 'fs';
import zlib from 'zlib';
dayjs.extend(utc);
import 'dotenv/config';
import { domainSuffix, domainPrefix } from '../templates/defaults.js';
const { NODE_ENV = "unknown" } = process.env;

/** @typedef {import('../../types').Dungeon} Config */
/** @typedef {import('../../types').EventConfig} EventConfig */
/** @typedef {import('../../types').ValueValid} ValueValid */
/** @typedef {import('../../types').HookedArray} hookArray */
/** @typedef {import('../../types').hookArrayOptions} hookArrayOptions */
/** @typedef {import('../../types').Person} Person */
/** @typedef {import('../../types').Funnel} Funnel */

let globalChance;
let chanceInitialized = false;

// Module-scoped memoization cache for weighted-array resolvers in `choose()`.
// Lives for the lifetime of the node process; key is the function source string.
const weightedArrayCache = new Map();

// Reference "now" used by date() and day() factories. Defaults to wall-clock at
// import time; the orchestrator overrides this via setDatasetNow() once the dataset
// window is resolved, so date helpers in dungeon configs produce deterministic
// values relative to the dataset end (not the process start).
let DATASET_NOW = dayjs.utc();

/**
 * Override the reference "now" used by date()/day() factories. Called by the
 * orchestrator with the resolved dataset end so every date helper produces
 * deterministic values relative to the dataset window.
 * @param {number} unixSeconds
 */
function setDatasetNow(unixSeconds) {
	if (typeof unixSeconds === 'number' && Number.isFinite(unixSeconds)) {
		DATASET_NOW = dayjs.unix(unixSeconds).utc();
	}
}


import { Storage as cloudStorage } from '@google-cloud/storage';
const projectId = 'YOUR_PROJECT_ID';
const storage = new cloudStorage({ projectId });


/*
----
RNG
----
*/

/**
 * the random number generator initialization function
 * @param  {string} seed
 * @returns {Chance}
 */
function initChance(seed) {
	// Use env SEED only as fallback when no seed is explicitly passed
	if (!seed && process.env.SEED) seed = process.env.SEED;
	globalChance = new Chance(seed);
	chanceInitialized = true;
	return globalChance;
}

/**
 * the random number generator getter function
 * @returns {Chance}
 */
function getChance() {
	if (!chanceInitialized) {
		const seed = process.env.SEED || "";
		if (!seed) {
			return new Chance(); // this is a new RNG and therefore not deterministic
		}
		return initChance(seed);
	}
	return globalChance;
}

/*
----
PICKERS
----
*/

/**
 * choose a value from an array or a function
 * @param  {ValueValid} items
 */
function pick(items) {
	const chance = getChance();
	if (!Array.isArray(items)) {
		if (typeof items === 'function') {
			const selection = items();
			if (Array.isArray(selection)) {
				return chance.pickone(selection);
			}
			else {
				return selection;
			}
		}
		return items;

	}
	return chance.pickone(items);
};

/**
 * returns a random date in the past or future
 * @param  {number} inTheLast=30
 * @param  {boolean} isPast=true
 * @param  {string} format='YYYY-MM-DD'
 */
function date(inTheLast = 30, isPast = true, format = 'YYYY-MM-DD') {
	const chance = getChance();
	const now = DATASET_NOW;
	if (Math.abs(inTheLast) > 365 * 10) inTheLast = chance.integer({ min: 1, max: 180 });
	return function () {
		const when = chance.integer({ min: 0, max: Math.abs(inTheLast) });
		let then;
		if (isPast) {
			then = now.subtract(when, 'day')
				.subtract(integer(0, 23), 'hour')
				.subtract(integer(0, 59), 'minute')
				.subtract(integer(0, 59), 'second');
		} else {
			then = now.add(when, 'day')
				.add(integer(0, 23), 'hour')
				.add(integer(0, 59), 'minute')
				.add(integer(0, 59), 'second');
		}

		return format ? then.format(format) : then.toISOString();
	};
}

/**
 * returns pairs of random date in the past or future
 * @param  {number} inTheLast=30
 * @param  {number} numPairs=5
 * @param  {string} format='YYYY-MM-DD'
 */
function dates(inTheLast = 30, numPairs = 5, format = 'YYYY-MM-DD') {
	const pairs = [];
	for (let i = 0; i < numPairs; i++) {
		pairs.push([date(inTheLast, true, format), date(inTheLast, true, format)]);
	}
	return pairs;
};

function datesBetween(start, end) {
	const result = [];
	if (typeof start === 'number') start = dayjs.unix(start).utc();
	if (typeof start !== 'number') start = dayjs(start).utc();
	if (typeof end === 'number') end = dayjs.unix(end).utc();
	if (typeof end !== 'number') end = dayjs(end).utc();
	const diff = end.diff(start, 'day');
	for (let i = 0; i < diff; i++) {
		const day = start.add(i, 'day').startOf('day').add(12, 'hour');
		result.push(day.toISOString());
	}

	return result;
}

/**
 * returns a random date
 * @param  {any} start
 * @param  {any} end
 */
function day(start, end) {
	// if (!end) end = global.FIXED_NOW ? global.FIXED_NOW : dayjs().unix();
	if (!start) start = DATASET_NOW.subtract(30, 'd').toISOString();
	if (!end) end = DATASET_NOW.toISOString();
	const chance = getChance();
	const format = 'YYYY-MM-DD';
	return function (min, max) {
		start = dayjs(start);
		end = dayjs(end);
		const diff = end.diff(start, 'day');
		const delta = chance.integer({ min: min, max: diff });
		const day = start.add(delta, 'day');
		return {
			start: start.format(format),
			end: end.format(format),
			day: day.format(format)
		};
	};

};

/**
 * similar to pick
 * @param  {ValueValid} value
 */
function choose(value) {
	const chance = getChance();

	// most of the time this will receive a list of strings; 
	// when that is the case, we need to ensure some 'keywords' like 'variant' or 'test' aren't in the array
	// next we want to see if the array is unweighted ... i.e. no dupe strings and each string only occurs once ['a', 'b', 'c', 'd']
	// if all these are true we will pickAWinner(value)()
	if (Array.isArray(value) && value.length > 2 && value.length < 20 && value.every(item => typeof item === 'string')) {
		// ensure terms 'variant' 'group' 'experiment' or 'population' are NOT in any of the items
		if (!value.some(item => item.includes('variant') || item.includes('group') || item.includes('experiment') || item.includes('population'))) {
			// check to make sure that each element in the array only occurs once...
			const uniqueItems = new Set(value);
			if (uniqueItems.size === value.length) {
				// Array has no duplicates, use pickAWinner
				const quickList = pickAWinner(value, 0)();
				const theChosenOne = chance.pickone(quickList);
				return theChosenOne;
			}

		}

	}

	// if the thing has a .next() method, call that (e.g., generators/iterators)
	try {
		if (value && typeof /** @type {any} */ (value).next === 'function') {
			return /** @type {any} */ (value).next();
		}
	} catch (e) {
		console.error(`Error occurred while calling next(): ${e}`);
	}

	try {
		// Keep resolving the value if it's a function (with caching)
		while (typeof value === 'function') {
			const funcString = value.toString();

			if (weightedArrayCache.has(funcString)) {
				value = weightedArrayCache.get(funcString);
				break;
			}

			const result = value();
			if (Array.isArray(result) && result.length > 10) {
				// Cache large arrays (likely weighted arrays)
				weightedArrayCache.set(funcString, result);
			}
			value = result;
		}

		if (Array.isArray(value) && value.length === 0) {
			return ""; // Return empty string if the array is empty
		}

		// [[],[],[]] should pick one
		if (Array.isArray(value) && Array.isArray(value[0])) {
			return chance.pickone(value);
		}

		// PERFORMANCE: Optimized array handling - check first item type instead of every()
		if (Array.isArray(value) && value.length > 0) {
			const firstType = typeof value[0];
			if (firstType === 'string' || firstType === 'number') {
				return chance.pickone(value);
			}
		}

		if (Array.isArray(value) && value.every(item => typeof item === 'object')) {
			if (hasSameKeys(value)) return value;
			else {
				if (process.env.NODE_ENV === "dev") debugger;
			}
		}

		// ["","",""] should pick-a-winner
		if (Array.isArray(value) && typeof value[0] === "string") {
			value = pickAWinner(value)();
		}

		// [0,1,2] should pick one
		if (Array.isArray(value) && typeof value[0] === "number") {
			return chance.pickone(value);
		}

		if (Array.isArray(value)) {
			return chance.pickone(value);
		}

		if (typeof value === 'string') {
			return value;
		}

		if (typeof value === 'number') {
			return value;
		}

		// If it's not a function or array, return it as is
		return value;
	}
	catch (e) {
		console.error(`\n\nerror on value: ${value};\n\n`, e, '\n\n');
		if (process.env?.NODE_ENV === 'dev') debugger;
		throw e;

	}
}


function hasSameKeys(arr) {
	if (arr.length <= 1) {
		return true; // An empty array or an array with one object always has the same keys
	}

	const firstKeys = Object.keys(arr[0]);

	for (let i = 1; i < arr.length; i++) {
		const currentKeys = Object.keys(arr[i]);

		if (currentKeys.length !== firstKeys.length) {
			return false; // Different number of keys
		}

		for (const key of firstKeys) {
			if (!currentKeys.includes(key)) {
				return false; // Key missing in current object
			}
		}
	}

	return true; // All objects have the same keys
}

/**
 * keeps picking from an array until the array is exhausted
 * @param  {Array} arr
 */
function exhaust(arr) {
	return function () {
		return arr.shift();
	};
};

/**
 * returns a random integer between min and max
 * @param  {number} min=1
 * @param  {number} max=100
 */
function integer(min = 1, max = 100) {
	const chance = getChance();
	if (min === max) {
		return min;
	}

	if (min > max) {
		return chance.integer({
			min: max,
			max: min
		});
	}

	if (min < max) {
		return chance.integer({
			min: min,
			max: max
		});
	}

	return 0;
};


function decimal(min = 0, max = 1, fixed = 2) {
	const chance = getChance();
	return chance.floating({ min, max, fixed });
}


/*
----
GENERATORS
----
*/

/**
 * returns a random float between 0 and 1
 * a substitute for Math.random
 */
function boxMullerRandom() {
	const chance = getChance();
	let u = 0, v = 0;
	while (u === 0) u = chance.floating({ min: 0, max: 1, fixed: 13 });
	while (v === 0) v = chance.floating({ min: 0, max: 1, fixed: 13 });
	return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
};

function optimizedBoxMuller() {
	const chance = getChance();
	const u = Math.max(Math.min(chance.normal({ mean: .5, dev: .25 }), 1), 0);
	const v = Math.max(Math.min(chance.normal({ mean: .5, dev: .25 }), 1), 0);
	const result = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
	//ensure we didn't get infinity
	if (result === Infinity || result === -Infinity) return chance.floating({ min: 0, max: 1 });
	return result;

}

/**
 * applies a skew to a value;
 * Skew=0.5: When the skew is 0.5, the distribution becomes more compressed, with values clustering closer to the mean.
 * Skew=1: With a skew of 1, the distribution remains unchanged, as this is equivalent to applying no skew.
 * Skew=2: When the skew is 2, the distribution spreads out, with values extending further from the mean.
 * @param  {number} value
 * @param  {number} skew
 */
function applySkew(value, skew) {
	if (skew === 1) return value;
	// Adjust the value based on skew
	let sign = value < 0 ? -1 : 1;
	return sign * Math.pow(Math.abs(value), skew);
};

// Map standard normal value to our range
function mapToRange(value, mean, sd) {
	return Math.round(value * sd + mean);
};

/**
 * generate a range of numbers
 * @param  {number} a
 * @param  {number} b
 * @param  {number} step=1
 */
function range(a, b, step = 1) {
	const arr = [];
	step = !step ? 1 : step;
	b = b / step;
	for (var i = a; i <= b; i++) {
		arr.push(i * step);
	}
	return arr;
};


function companyName(words = 2, separator = " ") {
	const industryAdjectives = ["advanced", "premier", "integrated", "optimized", "comprehensive", "expert",
		"visionary", "progressive", "transformative", "pioneering", "streamlined",
		"cutting-edge", "impactful", "purpose-driven", "value-oriented", "future-ready",
		"scalable", "responsive", "data-driven", "cloud-based", "user-friendly",
		"high-performance", "secure", "compliant", "ethical", "inclusive",
		"transparent", "community-focused", "environmentally-conscious", "socially-responsible", "innovative", "dynamic", "global", "leading", "reliable", "trusted",
		"strategic", "efficient", "sustainable", "creative", "agile", "resilient",
		"collaborative", "customer-centric", "forward-thinking", "results-driven", "gizmo", "contraption", "doodle", "whimsy", "quirk", "spark", "zing",
		"zap", "pop", "fizz", "whirl", "twirl", "swirl", "jumble", "tumble",
		"hodgepodge", "mishmash", "kaleidoscope", "labyrinth", "maze", "puzzle",
		"enigma", "conundrum", "paradox", "oxymoron", "chimera", "centaur",
		"griffin", "phoenix", "unicorn", "dragon", "mermaid", "yeti", "bigfoot",
		"loch ness monster", "chupacabra", "kraken", "leviathan", "behemoth",
		"juggernaut", "goliath", "david", "odyssey", "pilgrimage", "crusade",
		"quest", "adventure", "escapade", "frolic", "romp", "lark", "spree",
		"binge", "jag", "bender", "tear", "rampage", "riot", "ruckus", "rumpus",
		"hullabaloo", "brouhaha", "kerfuffle", "shindig", "hootenanny", "jamboree",
		"fiesta", "carnival", "gala", "soiree", "bash", "fete", "jubilee"

	];

	const companyNouns = [
		"solutions", "group", "partners", "ventures", "holdings", "enterprises",
		"systems", "technologies", "innovations", "associates", "corporation", "inc.",
		"ltd.", "plc.", "gmbh", "s.a.", "llc.", "network", "alliance", "consortium", "collective", "foundation", "institute",
		"laboratory", "agency", "bureau", "department", "division", "branch",
		"office", "center", "hub", "platform", "ecosystem", "marketplace",
		"exchange", "clearinghouse", "repository", "archive", "registry",
		"database", "framework", "infrastructure", "architecture", "protocol",
		"standard", "specification", "guideline", "blueprint", "roadmap",
		"strategy", "plan", "initiative", "program", "project", "campaign",
		"operation", "mission", "task", "force", "team", "crew", "squad",
		"unit", "cell", "pod", "cohort", "community", "network", "circle",
		"forum", "council", "board", "committee", "panel", "jury", "tribunal"
	];

	let name = "";
	const cycle = [industryAdjectives, companyNouns];
	for (let i = 0; i < words; i++) {
		const index = i % cycle.length;
		const word = cycle[index][getChance().integer({ min: 0, max: cycle[index].length - 1 })];
		if (name === "") {
			name = word;
		} else {
			name += separator + word;
		}
	}

	return name;
}


/*
----
STREAMERS
----
*/

function streamJSON(filePath, data, options = {}) {
	return new Promise((resolve, reject) => {
		let writeStream;
		const { gzip = false } = options;

		if (filePath?.startsWith('gs://')) {
			const { uri, bucket, file } = parseGCSUri(filePath);
			writeStream = storage.bucket(bucket).file(file).createWriteStream({ gzip: true });
		}
		else {
			writeStream = fs.createWriteStream(filePath, { encoding: 'utf8' });
			if (gzip) {
				const gzipStream = zlib.createGzip();
				gzipStream.pipe(writeStream);
				writeStream = gzipStream;
			}
		}
		data.forEach(item => {
			writeStream.write(JSON.stringify(item) + '\n');
		});
		writeStream.end();
		writeStream.on('finish', () => {
			resolve(filePath);
		});
		writeStream.on('error', reject);
	});
}

function streamCSV(filePath, data, options = {}) {
	return new Promise((resolve, reject) => {
		let writeStream;
		const { gzip = false } = options;

		if (filePath?.startsWith('gs://')) {
			const { uri, bucket, file } = parseGCSUri(filePath);
			writeStream = storage.bucket(bucket).file(file).createWriteStream({ gzip: true });
		}
		else {
			writeStream = fs.createWriteStream(filePath, { encoding: 'utf8' });
			if (gzip) {
				const gzipStream = zlib.createGzip();
				gzipStream.pipe(writeStream);
				writeStream = gzipStream;
			}
		}

		// Extract all unique keys from the data array
		const columns = getUniqueKeys(data);  // Assuming getUniqueKeys properly retrieves all keys

		// Stream the header
		writeStream.write(columns.join(',') + '\n');

		// Stream each data row
		data.forEach(item => {
			for (const key in item) {
				// Ensure all nested objects are properly stringified
				if (typeof item[key] === "object") item[key] = JSON.stringify(item[key]);
			}
			const row = columns.map(col => item[col] ? `"${item[col].toString().replace(/"/g, '""')}"` : "").join(',');
			writeStream.write(row + '\n');
		});

		writeStream.end();
		writeStream.on('finish', () => {
			resolve(filePath);
		});
		writeStream.on('error', reject);
	});
}

async function streamParquet(filePath, data, options = {}) {
	const { gzip = false } = options;

	// Dynamically import hyparquet-writer
	// @ts-ignore
	const { parquetWriteFile, parquetWriteBuffer } = await import('hyparquet-writer');

	if (data.length === 0) {
		throw new Error('Cannot write parquet file with empty data');
	}

	// Extract column names and data from the input array
	const columns = getUniqueKeys(data);
	const columnData = columns.map(columnName => {
		const columnValues = data.map(row => {
			let value = row[columnName];

			// Handle null/undefined values
			if (value === null || value === undefined) {
				return null;
			}

			// Convert objects to strings
			if (typeof value === 'object') {
				value = JSON.stringify(value);
			}

			return value;
		});

		// Determine the type based on the first non-null value
		let type = 'STRING'; // default
		const firstValue = columnValues.find(v => v !== null && v !== undefined);

		if (firstValue !== undefined) {
			if (typeof firstValue === 'boolean') {
				type = 'BOOLEAN';
			} else if (typeof firstValue === 'number') {
				// For parquet compatibility, convert numbers to appropriate types
				if (Number.isInteger(firstValue)) {
					// Use INT32 for smaller integers, convert to BigInt for INT64 if needed
					if (firstValue >= -2147483648 && firstValue <= 2147483647) {
						type = 'INT32';
					} else {
						type = 'INT64';
						// Convert all values to BigInt for INT64
						for (let i = 0; i < columnValues.length; i++) {
							if (columnValues[i] !== null && columnValues[i] !== undefined) {
								columnValues[i] = BigInt(columnValues[i]);
							}
						}
					}
				} else {
					type = 'DOUBLE';
				}
			} else if (firstValue instanceof Date) {
				type = 'TIMESTAMP';
			}
		}

		return {
			name: columnName,
			data: columnValues,
			type: type
		};
	});

	if (filePath?.startsWith('gs://')) {
		// For GCS, write to buffer first, then upload
		// @ts-ignore
		const arrayBuffer = parquetWriteBuffer({ columnData });
		const { bucket, file } = parseGCSUri(filePath);

		const writeStream = storage.bucket(bucket).file(file).createWriteStream({
			gzip: gzip || true // Always gzip for GCS
		});

		return new Promise((resolve, reject) => {
			writeStream.write(Buffer.from(arrayBuffer));
			writeStream.end();
			writeStream.on('finish', () => resolve(filePath));
			writeStream.on('error', reject);
		});
	} else {
		// For local files
		let actualFilePath = filePath;
		if (gzip && !filePath.endsWith('.gz')) {
			actualFilePath = filePath + '.gz';
		}

		if (gzip) {
			// Write to buffer then gzip to disk
			// @ts-ignore
			const arrayBuffer = parquetWriteBuffer({ columnData });
			const buffer = Buffer.from(arrayBuffer);
			const gzippedBuffer = zlib.gzipSync(buffer);

			return new Promise((resolve, reject) => {
				fs.writeFile(actualFilePath, gzippedBuffer, (err) => {
					if (err) reject(err);
					else resolve(actualFilePath);
				});
			});
		} else {
			// Direct write to disk
			parquetWriteFile({
				filename: filePath,
				columnData
			});
			return Promise.resolve(filePath);
		}
	}
}


/*
----
WEIGHERS
----
*/



/**
 * a utility function to generate a range of numbers within a given skew
 * Skew = 0.5: The values are more concentrated towards the extremes (both ends of the range) with a noticeable dip in the middle. The distribution appears more "U" shaped. Larger sizes result in smoother distributions but maintain the overall shape.
 * 
 * Skew = 1: This represents the default normal distribution without skew. The values are normally distributed around the mean. Larger sizes create a clearer bell-shaped curve.
 * 
 * Skew = 2: The values are more concentrated towards the mean, with a steeper drop-off towards the extremes. The distribution appears more peaked, resembling a "sharper" bell curve. Larger sizes enhance the clarity of this peaked distribution.
 * 
 * Size represents the size of the pool to choose from; Larger sizes result in smoother distributions but maintain the overall shape.
 * @param  {number} min
 * @param  {number} max
 * @param  {number} skew=1
 * @param  {number} size=100
 */
function weighNumRange(min, max, skew = 1, size = 50) {
	if (size > 2000) size = 2000;
	const mean = (max + min) / 2;
	const sd = (max - min) / 4;
	const array = [];
	while (array.length < size) {
		// const normalValue = boxMullerRandom();
		const normalValue = optimizedBoxMuller();
		const skewedValue = applySkew(normalValue, skew);
		const mappedValue = mapToRange(skewedValue, mean, sd);
		if (mappedValue >= min && mappedValue <= max) {
			array.push(mappedValue);
		}
	}
	return array;
}

/**
 * arbitrarily weigh an array of values to create repeats
 * @param  {Array<any>} arr
 */
function weighArray(arr) {
	// Calculate the upper bound based on the size of the array with added noise
	const maxCopies = arr.length + integer(1, arr.length);

	// Create an empty array to store the weighted elements
	const weightedArray = [];

	// Iterate over the input array and copy each element a random number of times
	arr.forEach(element => {
		let copies = integer(1, maxCopies);
		for (let i = 0; i < copies; i++) {
			weightedArray.push(element);
		}
	});

	return weightedArray;
}

/**
 * Creates a function that generates a weighted array of values.
 * 
 * @overload
 * @param {Array<{value: string, weight: number}>} items - An array of weighted objects or an array of strings.
 * @returns {function(): Array<string>} A function that returns a weighted array of values when called.
 * 
 * @overload
 * @param {Array<string>} items - An array of strings.
 * @returns {function(): Array<string>} A function that returns a weighted array with automatically assigned random weights to each string.
 */

function weighChoices(items) {
	let weightedItems;

	// If items are strings, assign unique random weights
	if (items.every(item => typeof item === 'string')) {
		const weights = shuffleArray(range(1, items.length));
		weightedItems = items.map((item, index) => ({
			value: item,
			weight: weights[index]
		}));
	} else {
		weightedItems = items;
	}

	return function generateWeightedArray() {
		const weightedArray = [];

		// Add each value to the array the number of times specified by its weight
		weightedItems.forEach(({ value, weight }) => {
			if (!weight) weight = 1;
			for (let i = 0; i < weight; i++) {
				weightedArray.push(value);
			}
		});

		return weightedArray;
	};
}

/**
 * Creates a function that generates a weighted list of items
 * with a higher likelihood of picking a specified index and clear second and third place indices.
 * 
 * @param {Array} items - The list of items to pick from.
 * @param {number} [mostChosenIndex] - The index of the item to be most favored.
 * @returns {function} - A function that returns a weighted list of items.
 */
function pickAWinner(items, mostChosenIndex) {
	const chance = getChance();

	// Ensure mostChosenIndex is within the bounds of the items array
	if (!items) return () => { return ""; };
	if (!items.length) return () => { return ""; };
	if (!mostChosenIndex) mostChosenIndex = chance.integer({ min: 0, max: items.length - 1 });
	if (mostChosenIndex >= items.length) mostChosenIndex = items.length - 1;

	// Calculate second and third most chosen indices
	const secondMostChosenIndex = (mostChosenIndex + 1) % items.length;
	const thirdMostChosenIndex = (mostChosenIndex + 2) % items.length;

	// Return a function that generates a weighted list
	return function () {
		const weighted = [];
		for (let i = 0; i < 10; i++) {
			const rand = chance.d10(); // Random number between 1 and 10

			// 35% chance to favor the most chosen index
			if (chance.bool({ likelihood: 35 })) {
				// 50% chance to slightly alter the index
				if (chance.bool({ likelihood: 50 })) {
					weighted.push(items[mostChosenIndex]);
				} else {
					const addOrSubtract = chance.bool({ likelihood: 50 }) ? -rand : rand;
					let newIndex = mostChosenIndex + addOrSubtract;

					// Ensure newIndex is within bounds
					if (newIndex < 0) newIndex = 0;
					if (newIndex >= items.length) newIndex = items.length - 1;
					weighted.push(items[newIndex]);
				}
			}
			// 25% chance to favor the second most chosen index
			else if (chance.bool({ likelihood: 25 })) {
				weighted.push(items[secondMostChosenIndex]);
			}
			// 15% chance to favor the third most chosen index
			else if (chance.bool({ likelihood: 15 })) {
				weighted.push(items[thirdMostChosenIndex]);
			}
			// Otherwise, pick a random item from the list
			else {
				weighted.push(chance.pickone(items));
			}
		}
		return weighted;
	};
}

function quickHash(str, seed = 0) {
	let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
	for (let i = 0, ch; i < str.length; i++) {
		ch = str.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
	h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
	h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);

	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString();
};

/*
----
SHUFFLERS
----
*/

// Function to shuffle array
function shuffleArray(array) {
	const chance = getChance();
	for (let i = array.length - 1; i > 0; i--) {
		const j = chance.integer({ min: 0, max: i });
		const temp = array[i];
		array[i] = array[j];
		array[j] = temp;
	}
	return array;
}

function pickRandom(array) {
	if (!array || array.length === 0) return undefined;
	const chance = getChance();
	return chance.pickone(array);
}

function shuffleExceptFirst(array) {
	if (array.length <= 1) return array;
	const restShuffled = shuffleArray(array.slice(1));
	return [array[0], ...restShuffled];
}

function shuffleExceptLast(array) {
	if (array.length <= 1) return array;
	const restShuffled = shuffleArray(array.slice(0, -1));
	return [...restShuffled, array[array.length - 1]];
}

function fixFirstAndLast(array) {
	if (array.length <= 2) return array;
	const middleShuffled = shuffleArray(array.slice(1, -1));
	return [array[0], ...middleShuffled, array[array.length - 1]];
}

function shuffleMiddle(array) {
	if (array.length <= 2) return array;
	const middleShuffled = shuffleArray(array.slice(1, -1));
	return [array[0], ...middleShuffled, array[array.length - 1]];
}

function shuffleOutside(array) {
	if (array.length <= 2) return array;
	const middleFixed = array.slice(1, -1);
	const outsideShuffled = shuffleArray([array[0], array[array.length - 1]]);
	return [outsideShuffled[0], ...middleFixed, outsideShuffled[1]];
}

/**
 * given a funnel, shuffle the events in the sequence with random events
 * @param  {EventConfig[]} funnel
 * @param  {EventConfig[]} possibles
 */
function interruptArray(funnel, possibles, percent = 50) {
	if (!Array.isArray(funnel)) return funnel;
	if (!Array.isArray(possibles)) return funnel;
	if (!funnel.length) return funnel;
	if (!possibles.length) return funnel;
	const ignorePositions = [0, funnel.length - 1];
	const chance = getChance();
	loopSteps: for (const [index, event] of funnel.entries()) {
		if (ignorePositions.includes(index)) continue loopSteps;
		if (chance.bool({ likelihood: percent })) {
			funnel[index] = chance.pickone(possibles);
		}
	}

	return funnel;
}

/*
----
VALIDATORS
----
*/


/**
 * @param  {EventConfig[] | string[]} events
 */
function validateEventConfig(events) {
	if (!Array.isArray(events)) throw new Error("events must be an array");
	const cleanEventConfig = [];
	for (const event of events) {
		if (typeof event === "string") {
			/** @type {EventConfig} */
			const eventTemplate = {
				event,
				isFirstEvent: false,
				properties: {},
				weight: integer(1, 5)
			};
			cleanEventConfig.push(eventTemplate);
		}
		if (typeof event === "object") {
			cleanEventConfig.push(event);
		}
	}
	return cleanEventConfig;
}

function validTime(chosenTime, earliestTime, latestTime) {
	if (!earliestTime) earliestTime = global.FIXED_BEGIN ? global.FIXED_BEGIN : dayjs().subtract(30, 'd').unix(); // 30 days ago
	if (!latestTime) latestTime = global.FIXED_NOW ? global.FIXED_NOW : dayjs().unix();

	if (typeof chosenTime === 'number') {
		if (chosenTime > 0) {
			if (chosenTime > earliestTime) {
				if (chosenTime < (latestTime)) {
					return true;
				}

			}
		}
	}
	return false;
}

function validEvent(row) {
	if (!row) return false;
	if (!row.event) return false;
	if (!row.time) return false;
	if (!row.device_id && !row.user_id) return false;
	if (!row.insert_id) return false;
	// if (!row.source) return false;
	if (typeof row.time !== 'string') return false;
	return true;
}


/*
----
META
----
*/



/**
 * @param  {Config} config
 */
function buildFileNames(config) {
	const { format = "csv", groupKeys = [], lookupTables = [] } = config;
	let extension = "";
	extension = format === "csv" ? "csv" : "json";
	// const current = dayjs.utc().format("MM-DD-HH");
	let simName = config.name;
	let writeDir = typeof config.writeToDisk === 'string' ? config.writeToDisk : "./";
	if (config.writeToDisk) {
		const dataFolder = path.resolve("./data");
		if (existsSync(dataFolder)) writeDir = dataFolder;
		else writeDir = path.resolve("./");
	}
	if (typeof writeDir !== "string") throw new Error("writeDir must be a string");
	if (typeof simName !== "string") throw new Error("simName must be a string");

	const writePaths = {
		eventFiles: [path.join(writeDir, `${simName}-EVENTS.${extension}`)],
		userFiles: [path.join(writeDir, `${simName}-USERS.${extension}`)],
		adSpendFiles: [],
		scdFiles: [],
		mirrorFiles: [],
		groupFiles: [],
		lookupFiles: [],
		folder: writeDir,
	};
	//add ad spend files
	if (config?.hasAdSpend) {
		writePaths.adSpendFiles.push(path.join(writeDir, `${simName}-AD-SPEND.${extension}`));
	}

	//add SCD files
	const scdKeys = Object.keys(config?.scdProps || {});
	for (const key of scdKeys) {
		writePaths.scdFiles.push(
			path.join(writeDir, `${simName}-${key}-SCD.${extension}`)
		);
	}

	//add group files
	for (const groupPair of groupKeys) {
		const groupKey = groupPair[0];

		writePaths.groupFiles.push(
			path.join(writeDir, `${simName}-${groupKey}-GROUP.${extension}`)
		);
	}

	//add lookup files
	for (const lookupTable of lookupTables) {
		const { key } = lookupTable;
		writePaths.lookupFiles.push(
			//lookups are always CSVs
			path.join(writeDir, `${simName}-${key}-LOOKUP.csv`)
		);
	}

	//add mirror files
	const mirrorProps = config?.mirrorProps || {};
	if (Object.keys(mirrorProps).length) {
		writePaths.mirrorFiles.push(
			path.join(writeDir, `${simName}-MIRROR.${extension}`)
		);
	}

	return writePaths;
}

/**
 * Human-readable byte size
 * @param {number} bytes
 * @param {number} dp - decimal places
 * @param {boolean} si - use SI units
 * @returns {string}
 */
function bytesHuman(bytes, dp = 2, si = true) {
	const thresh = si ? 1000 : 1024;
	if (Math.abs(bytes) < thresh) {
		return bytes + ' B';
	}
	const units = si ? ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'] : ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
	let u = -1;
	const r = 10 ** dp;
	do {
		bytes /= thresh;
		++u;
	} while (Math.round(Math.abs(bytes) * r) / r >= thresh && u < units.length - 1);
	return bytes.toFixed(dp) + ' ' + units[u];
}

/**
 * Format milliseconds as HH:MM:SS
 * @param {number} ms - Milliseconds
 * @returns {string} Formatted duration string
 */
function formatDuration(ms) {
	const seconds = Math.floor(ms / 1000);
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const secs = seconds % 60;
	return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * @param  {[string, string | number][]} arrayOfArrays
 */
function progress(arrayOfArrays) {
	const terminalWidth = process.stdout.columns || 120;

	// Clear the entire line
	readline.cursorTo(process.stdout, 0);
	readline.clearLine(process.stdout, 0);

	// Build message with better formatting
	const items = arrayOfArrays.map(([thing, p]) => {
		return `${thing}: ${comma(p)}`;
	});

	const message = items.join(' │ ');

	// Ensure we don't exceed terminal width
	const finalMessage = message.length > terminalWidth
		? message.substring(0, terminalWidth - 3) + '...'
		: message.padEnd(terminalWidth, ' ');

	process.stdout.write(finalMessage);
}

function getUniqueKeys(data) {
	const keysSet = new Set();
	data.forEach(item => {
		Object.keys(item).forEach(key => keysSet.add(key));
	});
	return Array.from(keysSet);
};


/*
----
CORE
----
*/

//the function which generates $distinct_id + $anonymous_ids, $session_ids, and created, skewing towards the present
function generateUser(user_id, opts, amplitude = 1, frequency = 1, skew = 1) {
	const chance = getChance();
	const { numDays, isAnonymous, hasAvatar, hasAnonIds, hasSessionIds, datasetEndUnix } = opts;
	// Uniformly distributed `u`, then skew applied
	let u = Math.pow(chance.random(), skew);

	// Sine function for a smoother curve
	const sineValue = (Math.sin(u * Math.PI * frequency - Math.PI / 2) * amplitude + 1) / 2;

	// Scale the sineValue to the range of days
	let daysAgoBorn = Math.round(sineValue * (numDays - 1)) + 1;

	// Clamp values to ensure they are within the desired range
	daysAgoBorn = Math.min(daysAgoBorn, numDays);
	const props = person(user_id, daysAgoBorn, isAnonymous, hasAvatar, hasAnonIds, hasSessionIds, datasetEndUnix);

	const user = {
		distinct_id: user_id,
		...props,
	};


	return user;
}

let soupHits = 0;
/**
 * build sign waves basically
 * @param  {number} [earliestTime]
 * @param  {number} [latestTime]
 * @param  {number} [peaks=5]
 */
/**
 * Generates a timestamp within a time range using clustered normal distributions.
 * Divides the range into `peaks` chunks, picks one randomly, then samples within it.
 * Returns unix seconds (not ISO string) for performance — caller converts once.
 */
// Default day-of-week weights (0=Sun, 1=Mon, ..., 6=Sat) — derived from real Mixpanel data
const DEFAULT_DOW_WEIGHTS = [0.637, 1.0, 0.999, 0.998, 0.966, 0.802, 0.528];

// Default hour-of-day weights (0=midnight, ..., 23=11pm UTC) — derived from real Mixpanel data
const DEFAULT_HOD_WEIGHTS = [
	0.949, 0.992, 0.998, 0.946, 0.895, 0.938, 1.0, 0.997,
	0.938, 0.894, 0.827, 0.786, 0.726, 0.699, 0.688, 0.643,
	0.584, 0.574, 0.554, 0.576, 0.604, 0.655, 0.722, 0.816
];

function TimeSoup(earliestTime, latestTime, peaks = 5, deviation = 2, mean = 0, dayOfWeekWeights = DEFAULT_DOW_WEIGHTS, hourOfDayWeights = DEFAULT_HOD_WEIGHTS) {
	if (!earliestTime) earliestTime = global.FIXED_BEGIN ? global.FIXED_BEGIN : dayjs().subtract(30, 'd').unix();
	if (!latestTime) latestTime = global.FIXED_NOW ? global.FIXED_NOW : dayjs().unix();
	const chance = getChance();
	let totalRange = latestTime - earliestTime;
	if (totalRange <= 0 || earliestTime > latestTime) {
		const temp = latestTime;
		latestTime = earliestTime;
		earliestTime = temp;
		totalRange = latestTime - earliestTime;
	}
	const chunkSize = totalRange / peaks;

	// Phase 1: Gaussian chunk sampling (macro trend across the time range)
	const peakIndex = integer(0, peaks - 1);
	const chunkStart = earliestTime + peakIndex * chunkSize;
	const chunkEnd = chunkStart + chunkSize;
	const chunkMid = (chunkStart + chunkEnd) / 2;
	const maxDeviation = chunkSize / deviation;
	const offset = chance.normal({ mean: mean, dev: maxDeviation });
	const proposedTime = chunkMid + offset;
	const clampedTime = Math.max(chunkStart, Math.min(chunkEnd, proposedTime));
	let candidate = Math.max(earliestTime, Math.min(latestTime, clampedTime));

	// Phase 2: DOW accept/reject — retry if day-of-week doesn't pass weight check
	if (dayOfWeekWeights) {
		for (let attempt = 0; attempt < 50; attempt++) {
			const dow = new Date(candidate * 1000).getUTCDay();
			if (chance.random() < dayOfWeekWeights[dow]) break;
			// Rejected — resample from Gaussian chunks
			const pi = integer(0, peaks - 1);
			const cs = earliestTime + pi * chunkSize;
			const ce = cs + chunkSize;
			const cm = (cs + ce) / 2;
			const md = chunkSize / deviation;
			const off = chance.normal({ mean: mean, dev: md });
			const pt = cm + off;
			candidate = Math.max(earliestTime, Math.min(latestTime, Math.max(cs, Math.min(ce, pt))));
		}
	}

	// Phase 3: Redistribute hour-of-day (changes only hour within same day)
	if (hourOfDayWeights) {
		const d = new Date(candidate * 1000);
		const currentMinute = d.getUTCMinutes();
		const currentSecond = d.getUTCSeconds();

		const totalHodWeight = hourOfDayWeights.reduce((s, w) => s + w, 0);
		let roll = chance.random() * totalHodWeight;
		let newHour = 0;
		for (let h = 0; h < 24; h++) {
			roll -= hourOfDayWeights[h];
			if (roll <= 0) { newHour = h; break; }
		}

		const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000;
		candidate = dayStart + newHour * 3600 + currentMinute * 60 + currentSecond;
		candidate = Math.max(earliestTime, Math.min(latestTime, candidate));
	}

	soupHits++;
	return candidate;
}


/**
 * @param {string} userId
 * @param  {number} bornDaysAgo=30
 * @param {boolean} isAnonymous
 * @param {boolean} hasAvatar
 * @param {boolean} hasAnonIds
 * @param {boolean} hasSessionIds
 * @return {Person}
 */
function person(userId, bornDaysAgo = 30, isAnonymous = false, hasAvatar = false, hasAnonIds = false, hasSessionIds = false, datasetEndUnix) {
	const chance = getChance();
	//names and photos
	const l = chance.letter.bind(chance);
	let gender = chance.pickone(['male', 'female']);
	if (!gender) gender = "female";
	let first = chance.first({ gender });
	let last = chance.last();
	let name = `${first} ${last}`;
	let email = `${first[0]}.${last}@${choose(domainPrefix)}.${choose(domainSuffix)}`;
	let avatarPrefix = `https://randomuser.me/api/portraits`;
	let randomAvatarNumber = integer(1, 99);
	let avPath = gender === 'male' ? `/men/${randomAvatarNumber}.jpg` : `/women/${randomAvatarNumber}.jpg`;
	let avatar = avatarPrefix + avPath;
	// Birth date: anchor to dataset end (post-resolution) so user.created lives inside
	// the configured window, not wall-clock time. Falls back to dayjs() only when
	// person() is called outside the normal generation pipeline (e.g. direct unit tests).
	const anchor = datasetEndUnix ? dayjs.unix(datasetEndUnix) : dayjs();
	let created = anchor.subtract(bornDaysAgo, 'day').format('YYYY-MM-DD');


	// const created = date(bornDaysAgo, true)();


	/** @type {Person} */
	const user = {
		distinct_id: userId,
		name,
		email,
		avatar,
		created,
		anonymousIds: [],
		sessionIds: []
	};

	if (isAnonymous) {
		user.name = "Anonymous User";
		user.email = l() + l() + `*`.repeat(integer(3, 6)) + l() + `@` + l() + `*`.repeat(integer(3, 6)) + l() + `.` + choose(domainSuffix);
		delete user.avatar;
	}

	if (!hasAvatar) delete user.avatar;

	//anon Ids
	if (hasAnonIds) {
		const clusterSize = integer(2, 10);
		for (let i = 0; i < clusterSize; i++) {
			// Use seeded chance, not ak-tools uid() (which uses Math.random).
			const anonId = chance.string({ length: 42, pool: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' });
			user.anonymousIds.push(anonId);
		}
	}

	if (!hasAnonIds) delete user.anonymousIds;

	// Session IDs are now assigned post-hoc in user-loop.js based on temporal gaps
	if (!hasSessionIds) delete user.sessionIds;

	return user;
};


function wrapFunc(obj, func, recursion = 0, parentKey = null, grandParentKey = null, whitelist = [
	"events",
	"superProps",
	"userProps",
	"scdProps",
	"mirrorProps",
	"groupEvents",
	"groupProps"
]) {
	if (recursion === 0) {
		// Only process top-level keys in the whitelist
		for (const key in obj) {
			if (whitelist.includes(key)) {
				obj[key] = wrapFunc(obj[key], func, recursion + 1, key, null, whitelist);
			}
		}
	} else {
		if (Array.isArray(obj) && grandParentKey === 'properties') {
			return func(obj);
		} else if (typeof obj === 'object' && obj !== null) {
			for (const key in obj) {
				if (obj.hasOwnProperty(key)) {
					obj[key] = wrapFunc(obj[key], func, recursion + 1, key, parentKey, whitelist);
				}
			}
		}
	}
	return obj;
}

/**
 * makes a random-sized array of emojis
 * @param  {number} max=10
 * @param  {boolean} array=false
 */
function generateEmoji(max = 10, array = false) {
	const chance = getChance();
	return function () {
		const emojis = ['😀', '😂', '😍', '😎', '😜', '😇', '😡', '😱', '😭', '😴', '🤢', '🤠', '🤡', '👽', '👻', '💩', '👺', '👹', '👾', '🤖', '🤑', '🤗', '🤓', '🤔', '🤐', '😀', '😂', '😍', '😎', '😜', '😇', '😡', '😱', '😭', '😴', '🤢', '🤠', '🤡', '👽', '👻', '💩', '👺', '👹', '👾', '🤖', '🤑', '🤗', '🤓', '🤔', '🤐', '😈', '👿', '👦', '👧', '👨', '👩', '👴', '👵', '👶', '🧒', '👮', '👷', '💂', '🕵', '👩‍⚕️', '👨‍⚕️', '👩‍🌾', '👨‍🌾', '👩‍🍳', '👨‍🍳', '👩‍🎓', '👨‍🎓', '👩‍🎤', '👨‍🎤', '👩‍🏫', '👨‍🏫', '👩‍🏭', '👨‍🏭', '👩‍💻', '👨‍💻', '👩‍💼', '👨‍💼', '👩‍🔧', '👨‍🔧', '👩‍🔬', '👨‍🔬', '👩‍🎨', '👨‍🎨', '👩‍🚒', '👨‍🚒', '👩‍✈️', '👨‍✈️', '👩‍🚀', '👨‍🚀', '👩‍⚖️', '👨‍⚖️', '🤶', '🎅', '👸', '🤴', '👰', '🤵', '👼', '🤰', '🙇', '💁', '🙅', '🙆', '🙋', '🤦', '🤷', '🙎', '🙍', '💇', '💆', '🕴', '💃', '🕺', '🚶', '🏃', '🤲', '👐', '🙌', '👏', '🤝', '👍', '👎', '👊', '✊', '🤛', '🤜', '🤞', '✌️', '🤟', '🤘', '👌', '👈', '👉', '👆', '👇', '☝️', '✋', '🤚', '🖐', '🖖', '👋', '🤙', '💪', '🖕', '✍️', '🤳', '💅', '👂', '👃', '👣', '👀', '👁', '🧠', '👅', '👄', '💋', '👓', '🕶', '👔', '👕', '👖', '🧣', '🧤', '🧥', '🧦', '👗', '👘', '👙', '👚', '👛', '👜', '👝', '🛍', '🎒', '👞', '👟', '👠', '👡', '👢', '👑', '👒', '🎩', '🎓', '🧢', '⛑', '📿', '💄', '💍', '💎', '🔇', '🔈', '🔉', '🔊', '📢', '📣', '📯', '🔔', '🔕', '🎼', '🎵', '🎶', '🎙', '🎚', '🎛', '🎤', '🎧', '📻', '🎷', '🎸', '🎹', '🎺', '🎻', '🥁', '📱', '📲', '💻', '🖥', '🖨', '🖱', '🖲', '🕹', '🗜', '💽', '💾', '💿', '📀', '📼', '📷', '📸', '📹', '🎥', '📽', '🎞', '📞', '☎️', '📟', '📠', '📺', '📻', '🎙', '📡', '🔍', '🔎', '🔬', '🔭', '📡', '💡', '🔦', '🏮', '📔', '📕', '📖', '📗', '📘', '📙', '📚', '📓', '📒', '📃', '📜', '📄', '📰', '🗞', '📑', '🔖', '🏷', '💰', '💴', '💵', '💶', '💷', '💸', '💳', '🧾', '💹', '💱', '💲', '✉️', '📧', '📨', '📩', '📤', '📥', '📦', '📫', '📪', '📬', '📭', '📮', '🗳', '✏️', '✒️', '🖋', '🖊', '🖌', '🖍', '📝', '💼', '📁', '📂', '🗂', '📅', '📆', '🗒', '🗓', '📇', '📈', '📉', '📊', '📋', '📌', '📍', '📎', '🖇', '📏', '📐', '✂️', '🗃', '🗄', '🗑', '🔒', '🔓', '🔏', '🔐', '🔑', '🗝', '🔨', '⛏', '⚒', '🛠', '🗡', '⚔️', '🔫', '🏹', '🛡', '🔧', '🔩', '⚙️', '🗜', '⚖️', '🔗', '⛓', '🧰', '🧲', '⚗️', '🧪', '🧫', '🧬', '🔬', '🔭', '📡', '💉', '💊', '🛏', '🛋', '🚪', '🚽', '🚿', '🛁', '🧴', '🧷', '🧹', '🧺', '🧻', '🧼', '🧽', '🧯', '🚬', '⚰️', '⚱️', '🗿', '🏺', '🧱', '🎈', '🎏', '🎀', '🎁', '🎊', '🎉', '🎎', '🏮', '🎐', '🧧', '✉️', '📩', '📨', '📧'];
		let num = integer(1, max);
		let arr = [];
		for (let i = 0; i < num; i++) {
			arr.push(chance.pickone(emojis));
		}
		if (array) return arr;
		if (!array) return arr.join(', ');
		return "🤷";
	};
};

function deepClone(thing, opts) {
	// Handle primitives first (most common case)
	if (thing === null || thing === undefined) return thing;

	const type = typeof thing;
	if (type !== 'object' && type !== 'function') {
		if (type === 'symbol') {
			return Symbol(thing.description);
		}
		return thing;
	}

	// Handle arrays (common case)
	if (Array.isArray(thing)) {
		const result = new Array(thing.length);
		for (let i = 0; i < thing.length; i++) {
			result[i] = deepClone(thing[i], opts);
		}
		return result;
	}

	// Handle other object types
	if (thing instanceof Date) return new Date(thing.getTime());
	if (thing instanceof RegExp) return new RegExp(thing.source, thing.flags);
	if (thing instanceof Function) {
		return opts && opts.newFns ?
			new Function('return ' + thing.toString())() :
			thing;
	}

	// Handle plain objects
	if (thing.constructor === Object) {
		const newObject = {};
		const keys = Object.keys(thing);
		for (let i = 0; i < keys.length; i++) {
			const key = keys[i];
			newObject[key] = deepClone(thing[key], opts);
		}
		return newObject;
	}

	// Handle other object types
	try {
		return new thing.constructor(thing);
	} catch (e) {
		// Fallback for objects that can't be constructed this way
		const newObject = Object.create(Object.getPrototypeOf(thing));
		const keys = Object.keys(thing);
		for (let i = 0; i < keys.length; i++) {
			const key = keys[i];
			newObject[key] = deepClone(thing[key], opts);
		}
		return newObject;
	}
};


/**
 * Generates a session ID in the standard format. Derives it deterministically
 * from a seed string (first event time + user_id, typically) via quickHash so
 * we don't consume from the main seeded RNG stream — that consumption would
 * cascade into all downstream events whenever the number of sessions changed
 * (e.g. when sessionTimeout differs).
 * @param {string} [seedStr] - Stable input string. If absent, falls back to a
 *   chance.string() pull (only used by tests / direct callers without a seed).
 * @returns {string} Session ID like "xxxxx-xxxxx-xxxxx-xxxxx"
 */
function generateSessionId(seedStr) {
	if (seedStr) {
		// quickHash returns ~16 hex chars; expand to 4×5 segments via re-hashing.
		const h1 = quickHash(seedStr);
		const h2 = quickHash(h1);
		const all = (h1 + h2).replace(/[^a-zA-Z0-9]/g, '').padEnd(20, '0');
		return [all.slice(0, 5), all.slice(5, 10), all.slice(10, 15), all.slice(15, 20)].join('-');
	}
	const c = getChance();
	const seg = () => c.string({ length: 5, pool: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' });
	return [seg(), seg(), seg(), seg()].join("-");
}

/**
 * Redistributes events into temporal clusters (sessions).
 *
 * Algorithm:
 * 1. Sort events by time
 * 2. Determine number of sessions (total events / avg events per session)
 * 3. Generate session anchor times using TimeSoup
 * 4. Assign events round-robin to sessions
 * 5. Within each session, retime events with tight spacing (5-300s apart)
 * 6. Regenerate insert_ids for retimed events
 * 7. Re-sort by time
 *
 * Mutates events in place. Does NOT assign session_id (call assignSessionIds after).
 *
 * @param {Object[]} events - Array of event objects with .time (ISO string)
 * @param {number} timeoutMinutes - Session timeout in minutes (used to determine intra-session spacing)
 * @param {Object} soupParams - Parameters for TimeSoup anchor generation
 */
function bunchIntoSessions(events, timeoutMinutes, soupParams) {
	if (events.length < 2) return;

	const chance = getChance();
	const { earliestTime, latestTime, peaks, deviation, mean,
		dayOfWeekWeights, hourOfDayWeights } = soupParams;

	// Sort by time first
	events.sort((a, b) => a.time < b.time ? -1 : a.time > b.time ? 1 : 0);

	// Determine number of sessions: target 3-8 events per session
	const eventsPerSession = chance.integer({ min: 3, max: 8 });
	const numSessions = Math.max(1, Math.ceil(events.length / eventsPerSession));

	// Generate session anchor times using TimeSoup
	const anchors = [];
	for (let i = 0; i < numSessions; i++) {
		const soupTime = TimeSoup(earliestTime, latestTime, peaks, deviation, mean,
			dayOfWeekWeights, hourOfDayWeights);
		anchors.push(soupTime);
	}
	anchors.sort((a, b) => a - b);

	// Distribute events across sessions round-robin (preserving original order → temporal order)
	const sessionBuckets = anchors.map(() => []);
	for (let i = 0; i < events.length; i++) {
		const bucketIndex = Math.min(i % numSessions, numSessions - 1);
		sessionBuckets[bucketIndex].push(events[i]);
	}

	// Retime events within each session
	for (let s = 0; s < numSessions; s++) {
		const bucket = sessionBuckets[s];
		if (bucket.length === 0) continue;

		let currentTime = anchors[s];
		for (let e = 0; e < bucket.length; e++) {
			const ev = bucket[e];
			const clampedTime = Math.min(currentTime, latestTime);

			ev.time = dayjs.unix(clampedTime).toISOString();
			// Regenerate insert_id to match new time
			const distinctId = ev.user_id || ev.device_id || ev.distinct_id || '';
			ev.insert_id = quickHash(`${ev.event}-${ev.time}-${distinctId}`);

			// Advance time within session: 5-300 seconds (5s to 5min)
			currentTime += chance.integer({ min: 5, max: 300 });
		}
	}

	// Re-sort by time
	events.sort((a, b) => a.time < b.time ? -1 : a.time > b.time ? 1 : 0);
}

/**
 * Assigns session IDs to a chronologically sorted array of events.
 * A new session starts when:
 *   - Gap between consecutive events exceeds timeoutMinutes
 *   - Session duration exceeds 24 hours
 *
 * Events MUST be sorted by time before calling this function.
 * Mutates events in place (adds session_id property).
 *
 * @param {Object[]} events - Sorted array of event objects with .time (ISO string)
 * @param {number} timeoutMinutes - Session timeout in minutes (default 30)
 * @returns {Object[]} Same array, with session_id added to each event
 */
function assignSessionIds(events, timeoutMinutes = 30) {
	if (!events.length) return events;

	const timeoutMs = timeoutMinutes * 60 * 1000;
	const maxSessionMs = 24 * 60 * 60 * 1000;

	// Derive a stable seed from the first event so session IDs are deterministic
	// across runs without consuming the main seeded RNG stream.
	const userKey = events[0].user_id || events[0].device_id || events[0].distinct_id || '';
	let currentSessionId = generateSessionId(`${userKey}-${events[0].time}`);
	let sessionStartMs = new Date(events[0].time).getTime();
	let lastEventMs = sessionStartMs;

	for (const event of events) {
		const eventMs = new Date(event.time).getTime();
		const gapFromLast = eventMs - lastEventMs;
		const sessionDuration = eventMs - sessionStartMs;

		if (gapFromLast > timeoutMs || sessionDuration > maxSessionMs) {
			currentSessionId = generateSessionId(`${userKey}-${event.time}`);
			sessionStartMs = eventMs;
		}

		event.session_id = currentSessionId;
		lastEventMs = eventMs;
	}

	return events;
}

export {
	pick,
	date,
	dates,
	day,
	choose,
	pickRandom,
	exhaust,
	integer,
	TimeSoup,
	companyName,
	generateEmoji,
	hasSameKeys,
	deepClone,
	initChance,
	getChance,
	decimal,
	validTime,
	validEvent,

	boxMullerRandom,
	applySkew,
	mapToRange,
	weighNumRange,
	progress,
	range,
	getUniqueKeys,
	person,
	pickAWinner,
	quickHash,
	weighArray,
	validateEventConfig,
	shuffleArray,
	shuffleExceptFirst,
	shuffleExceptLast,
	fixFirstAndLast,
	shuffleMiddle,
	shuffleOutside,
	interruptArray,
	generateUser,
	optimizedBoxMuller,
	buildFileNames,
	streamJSON,
	streamCSV,
	streamParquet,
	datesBetween,
	weighChoices,
	wrapFunc,
	bytesHuman,
	formatDuration,
	generateSessionId,
	assignSessionIds,
	bunchIntoSessions,
	setDatasetNow,
};