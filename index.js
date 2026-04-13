/**
 * dungeon-master: Generate realistic Mixpanel data for testing and demos
 * Modular, scalable data generation with support for events, users, funnels, SCDs, and more
 *
 * @author AK <ak@mixpanel.com>
 */

/** @typedef {import('./types').Dungeon} Config */
/** @typedef {import('./types').Storage} Storage */
/** @typedef {import('./types').Result} Result */
/** @typedef {import('./types').Context} Context */

// Core modules
import { createContext, updateContextWithStorage } from './lib/core/context.js';
import { validateDungeonConfig } from './lib/core/config-validator.js';
import { StorageManager } from './lib/core/storage.js';
import { detectInputType, loadFromFile, loadFromText, parseJSONDungeon, validateDungeonShape } from './lib/core/dungeon-loader.js';

// Orchestrators
import { userLoop } from './lib/orchestrators/user-loop.js';
import { sendToMixpanel } from './lib/orchestrators/mixpanel-sender.js';
// Generators
import { makeAdSpend } from './lib/generators/adspend.js';
import { makeMirror } from './lib/generators/mirror.js';
import { makeGroupProfile, makeProfile } from './lib/generators/profiles.js';

// Utilities
import { initChance } from './lib/utils/utils.js';

// External dependencies
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import { timer } from 'ak-tools';
import { dataLogger as logger } from './lib/utils/logger.js';

// Initialize dayjs and time constants
dayjs.extend(utc);
const FIXED_NOW = dayjs('2024-02-02').unix();
global.FIXED_NOW = FIXED_NOW;
let FIXED_BEGIN = dayjs.unix(FIXED_NOW).subtract(90, 'd').unix();
global.FIXED_BEGIN = FIXED_BEGIN;


/**
 * DUNGEON_MASTER: main entry point for generating Mixpanel data
 *
 * accepts multiple input formats:
 * - a dungeon config object (plain JS object with events, funnels, hooks, etc.)
 * - a file path to a .js/.mjs dungeon file on disk
 * - a file path to a .json dungeon file (UI schema format)
 * - an array of file paths (runs each dungeon, returns array of results)
 * - a string of raw JavaScript containing a dungeon (must use `export default`)
 *
 * @param {Config | string | string[]} input - Dungeon config, file path(s), or JS source text
 * @param {Partial<Config>} [overrides] - Optional config overrides merged into every dungeon
 * @returns {Promise<Result | Result[]>} Generated data and metadata
 *
 * @example
 * // config object
 * const result = await DUNGEON_MASTER({ numUsers: 100, numEvents: 10_000, numDays: 30 });
 *
 * @example
 * // file path
 * const result = await DUNGEON_MASTER('./dungeons/technical/simple.js');
 *
 * @example
 * // JSON dungeon (from UI export)
 * const result = await DUNGEON_MASTER('./dungeons/technical/simple-schema.json');
 *
 * @example
 * // multiple dungeons
 * const results = await DUNGEON_MASTER(['./dungeons/vertical/gaming.js', './dungeons/vertical/media.js']);
 *
 * @example
 * // raw JS text
 * const result = await DUNGEON_MASTER(`
 *   export default {
 *     numUsers: 50,
 *     numEvents: 5_000,
 *     events: [{ event: "page view", weight: 5 }, { event: "click", weight: 3 }]
 *   };
 * `);
 *
 * @example
 * // with overrides
 * const result = await DUNGEON_MASTER('./dungeons/technical/simple.js', { writeToDisk: true, verbose: true });
 */
async function DUNGEON_MASTER(input, overrides = {}) {
	const { type, value } = detectInputType(input);

	switch (type) {
		case 'object':
			return await runDungeon({ ...value, ...overrides });

		case 'file':
			const config = await loadFromFile(value);
			return await runDungeon({ ...config, ...overrides });

		case 'files': {
			const results = [];
			for (const filePath of value) {
				const fileConfig = await loadFromFile(filePath);
				results.push(await runDungeon({ ...fileConfig, ...overrides }));
			}
			return results;
		}

		case 'text': {
			const textConfig = await loadFromText(value);
			return await runDungeon({ ...textConfig, ...overrides });
		}
	}
}

/**
 * Run a single dungeon config through the generation pipeline
 * @param {Config} config - Validated/enriched dungeon configuration
 * @returns {Promise<Result>} Generated data and metadata
 */
async function runDungeon(config) {
	const jobTimer = timer('job');
	jobTimer.start();

	if (config.verbose) logger.info({ seed: config.seed }, 'Configuring dungeon');
	let validatedConfig;
	try {
		// Step 1: Validate and enrich configuration
		validatedConfig = validateDungeonConfig(config);

		// Ensure seeded RNG is initialized (dungeons do this at module scope,
		// but npm-module consumers pass seed via config object)
		if (validatedConfig.seed) {
			initChance(validatedConfig.seed);
		}

		// Compute FIXED_BEGIN from validated numDays
		const configNumDays = validatedConfig.numDays || 30;
		const fixedBegin = dayjs.unix(FIXED_NOW).subtract(configNumDays, 'd').unix();

		// Keep globals for backwards compatibility with tests/dungeons that read them
		global.FIXED_BEGIN = fixedBegin;

		// Step 2: Create context with validated config (pass time constants explicitly)
		const context = createContext(validatedConfig, null, { fixedNow: FIXED_NOW, fixedBegin });

		// Step 3: Initialize storage containers
		const storageManager = new StorageManager(context);
		const storage = await storageManager.initializeContainers();
		updateContextWithStorage(context, storage);

		// ! DATA GENERATION STARTS HERE

		// Step 4: Generate ad spend data (if enabled)
		if (validatedConfig.hasAdSpend) {
			await generateAdSpendData(context);
		}

		if (context.config.verbose) logger.info('Starting user and event generation...');
		// Step 5: Main user and event generation
		await userLoop(context);

		// Step 6: Generate group profiles (if configured)
		if (validatedConfig.groupKeys && validatedConfig.groupKeys.length > 0) {
			await generateGroupProfiles(context);
		}

		// Step 7: Generate group SCDs (if configured)
		if (validatedConfig.scdProps && validatedConfig.groupKeys && validatedConfig.groupKeys.length > 0) {
			await generateGroupSCDs(context);
		}

		// Step 8: Generate lookup tables (if configured)
		if (validatedConfig.lookupTables && validatedConfig.lookupTables.length > 0) {
			await generateLookupTables(context);
		}

		// Step 9: Generate mirror datasets (if configured)
		if (validatedConfig.mirrorProps && Object.keys(validatedConfig.mirrorProps).length > 0) {
			await makeMirror(context);
		}

		if (context.config.verbose) logger.info('Data generation completed successfully');

		// ! DATA GENERATION ENDS HERE

		// Flush when writeToDisk is enabled OR batch mode activated (to capture tail data)
		const shouldFlush = validatedConfig.writeToDisk || context.isBatchMode();

		// Step 10: Flush lookup tables to disk (always as CSVs)
		if (shouldFlush) {
			await flushLookupTablesToDisk(storage, validatedConfig);
		}

		// Step 11: Flush other storage containers to disk
		if (shouldFlush) {
			await flushStorageToDisk(storage, validatedConfig);
		}

		// Step 12: Send to Mixpanel (if token provided)
		// Now happens AFTER disk flush so batch files are available for import
		let importResults;
		if (validatedConfig.token) {
			importResults = await sendToMixpanel(context);
		}

		// Step 13: Compile results
		jobTimer.stop(false);
		const { start, end, delta, human } = jobTimer.report(false);

		const extractedData = extractStorageData(storage);

		return {
			...extractedData,
			importResults,
			files: await extractFileInfo(storage, validatedConfig),
			time: { start, end, delta, human },
			operations: context.getOperations(),
			eventCount: context.getEventCount(),
			userCount: context.getUserCount()
		};

	} catch (error) {
		logger.error({ err: error }, `Error: ${error.message}`);
		throw error;
	}
}

/**
 * Generate ad spend data for configured date range
 * @param {Context} context - Context object
 */
async function generateAdSpendData(context) {
	const { config, storage } = context;
	const { numDays } = config;

	const timeShift = context.TIME_SHIFT_SECONDS;
	for (let day = 0; day < numDays; day++) {
		const fixedDay = dayjs.unix(context.FIXED_BEGIN).add(day, 'day').unix();
		const shiftedDay = Math.min(fixedDay + timeShift, context.MAX_TIME);
		const targetDay = dayjs.unix(shiftedDay).toISOString();
		const adSpendEvents = await makeAdSpend(context, targetDay);

		if (adSpendEvents.length > 0) {
			for (const adSpendEvent of adSpendEvents) {
				await storage.adSpendData.hookPush(adSpendEvent);
			}
		}
	}
}

/**
 * Generate group profiles for all configured group keys
 * @param {Context} context - Context object
 */
async function generateGroupProfiles(context) {
	const { config, storage } = context;
	const { groupKeys, groupProps = {} } = config;

	if (config.verbose) {
		logger.info('Generating group profiles...');
	}

	for (let i = 0; i < groupKeys.length; i++) {
		const [groupKey, groupCount] = groupKeys[i];
		const groupContainer = storage.groupProfilesData[i];

		if (!groupContainer) {
			if (config.verbose) console.warn(`Warning: No storage container found for group key: ${groupKey}`);
			continue;
		}

		if (config.verbose) {
			logger.info({ groupKey, groupCount }, `Creating ${groupCount.toLocaleString()} ${groupKey} profiles...`);
		}

		// Get group-specific props if available
		const specificGroupProps = groupProps[groupKey] || {};

		for (let j = 0; j < groupCount; j++) {
			const groupProfile = await makeGroupProfile(context, groupKey, specificGroupProps, {
				[groupKey]: String(j + 1)
			});

			await groupContainer.hookPush(groupProfile);
		}
	}

	if (config.verbose) {
		logger.info('Group profiles generated successfully');
	}
}

/**
 * Generate lookup tables for all configured lookup schemas
 * @param {Context} context - Context object
 */
async function generateLookupTables(context) {
	const { config, storage } = context;
	const { lookupTables } = config;

	if (config.verbose) {
		logger.info('Generating lookup tables...');
	}

	for (let i = 0; i < lookupTables.length; i++) {
		const lookupConfig = lookupTables[i];
		const { key, entries, attributes } = lookupConfig;
		const lookupContainer = storage.lookupTableData[i];

		if (!lookupContainer) {
			if (config.verbose) console.warn(`Warning: No storage container found for lookup table: ${key}`);
			continue;
		}

		if (config.verbose) {
			logger.info({ key, entries }, `Creating ${entries.toLocaleString()} ${key} lookup entries...`);
		}

		for (let j = 0; j < entries; j++) {
			const lookupEntry = await makeProfile(context, attributes, {
				id: j + 1 //primary key is always a number so it joins simply with events
				// [key]: `${key}_${j + 1}` // we don't want to use the lookup name as a prefix here
			});

			await lookupContainer.hookPush(lookupEntry);
		}
	}

	if (config.verbose) {
		logger.info('Lookup tables generated successfully');
	}
}

/**
 * Generate SCDs for group entities
 * @param {Context} context - Context object
 */
async function generateGroupSCDs(context) {
	const { config, storage } = context;
	const { scdProps, groupKeys } = config;

	if (config.verbose) {
		logger.info('Generating group SCDs...');
	}

	// Import utilities and generators
	const { objFilter } = await import('ak-tools');
	const { makeSCD } = await import('./lib/generators/scd.js');
	const u = await import('./lib/utils/utils.js');
	const chance = u.getChance();

	// Get only group SCDs (not user SCDs)
	// @ts-ignore
	const groupSCDProps = objFilter(scdProps, (scd) => scd.type && scd.type !== 'user');

	for (const [groupKey, groupCount] of groupKeys) {
		// Filter SCDs that apply to this specific group key
		// @ts-ignore
		const groupSpecificSCDs = objFilter(groupSCDProps, (scd) => scd.type === groupKey);

		if (Object.keys(groupSpecificSCDs).length === 0) {
			continue; // No SCDs for this group type
		}

		if (config.verbose) {
			logger.info({ groupKey, groupCount }, `Generating SCDs for ${groupCount.toLocaleString()} ${groupKey} entities...`);
		}

		// Generate SCDs for each group entity
		for (let i = 0; i < groupCount; i++) {
			const groupId = String(i + 1);

			// Generate SCDs for this group entity
			for (const [scdKey, scdConfig] of Object.entries(groupSpecificSCDs)) {
				const { max = 10 } = scdConfig;
				const mutations = chance.integer({ min: 1, max });

				// Use a base time for the group entity (similar to user creation time)
				const baseTime = context.FIXED_BEGIN || context.FIXED_NOW;
				let changes = await makeSCD(context, scdConfig, scdKey, groupId, mutations, baseTime);

				// Apply hook if configured
				if (config.hook) {
					const hookResult = await config.hook(changes, "scd-pre", {
						type: 'group',
						groupKey,
						scd: { [scdKey]: scdConfig },
						config
					});
					if (Array.isArray(hookResult)) {
						changes = hookResult;
					}
				}

				// Store SCDs in the appropriate SCD table
				for (const change of changes) {
					try {
						const target = storage.scdTableData.filter(arr => arr.scdKey === scdKey).pop();
						await target.hookPush(change, { type: 'group', groupKey });
					} catch (e) {
						// Fallback for tests
						const target = storage.scdTableData[0];
						await target.hookPush(change, { type: 'group', groupKey });
					}
				}
			}
		}
	}

	if (config.verbose) {
		logger.info('Group SCDs generated successfully');
	}
}

/**
 * Flush lookup tables to disk (always runs, regardless of writeToDisk setting)
 * @param {import('./types').Storage} storage - Storage containers
 * @param {import('./types').Dungeon} config - Configuration object
 */
async function flushLookupTablesToDisk(storage, config) {
	if (!storage.lookupTableData || !Array.isArray(storage.lookupTableData) || storage.lookupTableData.length === 0) {
		return; // No lookup tables to flush
	}

	if (config.verbose) {
		console.log('💾 Writing lookup tables to disk...');
	}

	const flushPromises = [];
	storage.lookupTableData.forEach(container => {
		if (container?.flush) flushPromises.push(container.flush());
	});

	await Promise.all(flushPromises);

	if (config.verbose) {
		console.log('🗂️  Lookup tables flushed to disk successfully');
	}
}

/**
 * Flush all storage containers to disk (excluding lookup tables)
 * @param {import('./types').Storage} storage - Storage containers
 * @param {import('./types').Dungeon} config - Configuration object
 */
async function flushStorageToDisk(storage, config) {
	if (config.verbose) {
		console.log('\n💾 Writing data to disk...');
	}

	const flushPromises = [];

	// Flush single HookedArray containers
	if (storage.eventData?.flush) flushPromises.push(storage.eventData.flush());
	if (storage.userProfilesData?.flush) flushPromises.push(storage.userProfilesData.flush());
	if (storage.adSpendData?.flush) flushPromises.push(storage.adSpendData.flush());
	if (storage.mirrorEventData?.flush) flushPromises.push(storage.mirrorEventData.flush());
	if (storage.groupEventData?.flush) flushPromises.push(storage.groupEventData.flush());

	// Flush arrays of HookedArrays (excluding lookup tables which are handled separately)
	[storage.scdTableData, storage.groupProfilesData].forEach(arrayOfContainers => {
		if (Array.isArray(arrayOfContainers)) {
			arrayOfContainers.forEach(container => {
				if (container?.flush) flushPromises.push(container.flush());
			});
		}
	});

	await Promise.all(flushPromises);

	if (config.verbose) {
		console.log('🙏 Data flushed to disk successfully');
	}
}

/**
 * Extract file information from storage containers
 * @param {import('./types').Storage} storage - Storage object
 * @param {import('./types').Dungeon} config - Configuration object
 * @returns {Promise<string[]>} Array of file paths
 */
async function extractFileInfo(storage, config) {
	const files = [];

	// Try to get paths from containers first
	Object.values(storage).forEach(container => {
		if (Array.isArray(container)) {
			container.forEach(subContainer => {
				if (subContainer?.getWritePath) {
					files.push(subContainer.getWritePath());
				}
			});
		} else if (container?.getWritePath) {
			files.push(container.getWritePath());
		}
	});

	// If no files found from containers and writeToDisk is enabled, scan the data directory
	if (files.length === 0 && config.writeToDisk) {
		try {
			const fs = await import('fs');
			const path = await import('path');
			
			let dataDir = path.resolve("./data");
			if (!fs.existsSync(dataDir)) {
				dataDir = path.resolve("./");
			}
			
			if (fs.existsSync(dataDir)) {
				const allFiles = fs.readdirSync(dataDir);
				const simulationName = config.name;
				
				// Filter files that match our patterns and were likely created by this run
				const relevantFiles = allFiles.filter(file => {
					// Skip system files
					if (file.startsWith('.')) return false;
					
					// If we have a simulation name, only include files with that prefix
					if (simulationName && !file.startsWith(simulationName)) {
						return false;
					}
					
					// Check for common patterns
					const hasEventPattern = file.includes('-EVENTS.');
					const hasUserPattern = file.includes('-USERS.');
					const hasScdPattern = file.includes('-SCD.');
					const hasGroupPattern = file.includes('-GROUPS.');
					const hasLookupPattern = file.includes('-LOOKUP.');
					const hasAdspendPattern = file.includes('-ADSPEND.');
					const hasMirrorPattern = file.includes('-MIRROR.');
					
					return hasEventPattern || hasUserPattern || hasScdPattern || 
						   hasGroupPattern || hasLookupPattern || hasAdspendPattern || hasMirrorPattern;
				});
				
				// Convert to full paths
				relevantFiles.forEach(file => {
					files.push(path.join(dataDir, file));
				});
			}
		} catch (error) {
			// If scanning fails, just return empty array
		}
	}

	return files;
}

/**
 * Extract data from storage containers, preserving array structure for groups/lookups/SCDs
 * @param {import('./types').Storage} storage - Storage object
 * @returns {object} Extracted data in Result format
 */
function extractStorageData(storage) {
	return {
		eventData: storage.eventData || [],
		mirrorEventData: storage.mirrorEventData || [],
		userProfilesData: storage.userProfilesData || [],
		adSpendData: storage.adSpendData || [],
		// Keep arrays of HookedArrays as separate arrays (don't flatten)
		scdTableData: storage.scdTableData || [],
		groupProfilesData: storage.groupProfilesData || [],
		lookupTableData: storage.lookupTableData || []
	};
}

// ES Module exports
export default DUNGEON_MASTER;
export { parseJSONDungeon, validateDungeonShape, loadFromFile, loadFromText };

