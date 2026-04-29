/**
 * Context module - replaces global variables with a context object
 * Provides centralized state management and dependency injection
 */

/** @typedef {import('../../types.js').Dungeon} Dungeon */
/** @typedef {import('../../types.js').Storage} Storage */
/** @typedef {import('../../types.js').Context} Context */
/** @typedef {import('../../types.js').RuntimeState} RuntimeState */
/** @typedef {import('../../types.js').Defaults} Defaults */

import dayjs from "dayjs";
import { campaigns, devices, locations } from '../templates/defaults.js';
import * as u from '../utils/utils.js';

/**
 * Creates a defaults factory function that computes weighted defaults
 * @param {Dungeon} config - Configuration object
 * @param {Array} campaignData - Campaign data array
 * @returns {Defaults} Defaults object with factory functions
 */
function createDefaults(config, campaignData) {
	const { singleCountry } = config;

	// Pre-compute weighted arrays based on configuration
	const locationsUsers = singleCountry ?
		locations.filter(l => l.country === singleCountry) :
		locations;

	const locationsEvents = singleCountry ?
		locations.filter(l => l.country === singleCountry) :
		locations;

	// PERFORMANCE: Pre-calculate weighted arrays to avoid repeated weighArray calls
	const weighedLocationsUsers = u.weighArray(locationsUsers);
	const weighedLocationsEvents = u.weighArray(locationsEvents);
	const weighedIOSDevices = u.weighArray(devices.iosDevices);
	const weighedAndroidDevices = u.weighArray(devices.androidDevices);
	const weighedDesktopDevices = u.weighArray(devices.desktopDevices);
	const weighedBrowsers = u.weighArray(devices.browsers);
	const weighedCampaigns = u.weighArray(campaignData);

	// PERFORMANCE: Pre-compute device pools based on config to avoid rebuilding in makeEvent
	const devicePools = {
		android: config.hasAndroidDevices ? weighedAndroidDevices : [],
		ios: config.hasIOSDevices ? weighedIOSDevices : [],
		desktop: config.hasDesktopDevices ? weighedDesktopDevices : []
	};
	const allDevices = [...devicePools.android, ...devicePools.ios, ...devicePools.desktop];

	return {
		locationsUsers: () => weighedLocationsUsers,
		locationsEvents: () => weighedLocationsEvents,
		iOSDevices: () => weighedIOSDevices,
		androidDevices: () => weighedAndroidDevices,
		desktopDevices: () => weighedDesktopDevices,
		browsers: () => weighedBrowsers,
		campaigns: () => weighedCampaigns,
		
		// PERFORMANCE: Pre-computed device pools
		devicePools,
		allDevices
	};
}

/**
 * Creates a runtime state object for tracking execution state
 * @returns {RuntimeState} Runtime state with counters and flags
 */
function createRuntimeState() {
	return {
		operations: 0,
		eventCount: 0,
		storedEventCount: 0,
		userCount: 0,
		isBatchMode: false,
		verbose: false
	};
}

/**
 * Context factory that creates a complete context object for data generation
 * @param {Dungeon} config - Validated configuration object
 * @param {Storage|null} storage - Storage containers (optional, can be set later)
 * @param {{ fixedNow?: number, fixedBegin?: number }} [timeConstants] - Time constants (avoids globals)
 * @returns {Context} Context object containing all state and dependencies
 */
export function createContext(config, storage = null, timeConstants = {}) {
	// Import campaign data (could be made configurable)
	const campaignData = campaigns;

	// Create computed defaults based on config
	const defaults = createDefaults(config, campaignData);

	// Create runtime state
	const runtime = createRuntimeState();

	// Set runtime flags from config
	runtime.verbose = config.verbose || false;
	runtime.isBatchMode = config.batchSize && config.batchSize < config.numEvents;

	const context = {
		config,
		storage,
		defaults,
		campaigns: campaignData,
		runtime,

		// Helper methods for updating state
		incrementOperations() {
			runtime.operations++;
		},

		incrementEvents() {
			runtime.eventCount++;
		},

		incrementUsers() {
			runtime.userCount++;
		},

		setStorage(storageObj) {
			this.storage = storageObj;
		},

		// Getter methods for runtime state
		getOperations() {
			return runtime.operations;
		},

		getEventCount() {
			return runtime.eventCount;
		},

		getUserCount() {
			return runtime.userCount;
		},

		incrementUserCount() {
			runtime.userCount++;
		},

		incrementEventCount() {
			runtime.eventCount++;
		},

		incrementStoredEvents(count = 1) {
			runtime.storedEventCount += count;
		},

		getStoredEventCount() {
			return runtime.storedEventCount;
		},

		isBatchMode() {
			return runtime.isBatchMode;
		},

		// Dataset window anchors (resolved by config-validator). FIXED_BEGIN and
		// FIXED_NOW are the authoritative window — events are generated directly
		// inside this range, no time-shift step. DATASET_*_SECONDS are aliases
		// kept for the existing `meta.datasetStart`/`meta.datasetEnd` hook surface.
		// Resolution precedence: explicit timeConstants > validated config > global fallback.
		FIXED_NOW: timeConstants.fixedNow || config.datasetEnd || global.FIXED_NOW,
		FIXED_BEGIN: timeConstants.fixedBegin || config.datasetStart || global.FIXED_BEGIN,
		get DATASET_START_SECONDS() { return this.FIXED_BEGIN; },
		get DATASET_END_SECONDS() { return this.FIXED_NOW; },
	};

	return context;
}

/**
 * Updates an existing context with new storage containers
 * @param {Context} context - Existing context object
 * @param {Storage} storage - New storage containers
 * @returns {Context} Updated context object
 */
export function updateContextWithStorage(context, storage) {
	context.storage = storage;
	return context;
}

/**
 * Validates that a context object has all required properties
 * @param {Context} context - Context to validate
 * @throws {Error} If context is missing required properties
 */
export function validateContext(context) {
	const required = ['config', 'defaults', 'campaigns', 'runtime'];
	const missing = required.filter(prop => !context[prop]);

	if (missing.length > 0) {
		throw new Error(`Context is missing required properties: ${missing.join(', ')}`);
	}

	if (!context.config.numUsers || !context.config.numEvents) {
		throw new Error('Context config must have numUsers and numEvents');
	}
}