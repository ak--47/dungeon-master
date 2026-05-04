/**
 * Configuration validation and enrichment module
 * Extracted from index.js validateDungeonConfig function
 */

/** @typedef {import('../../types.js').Dungeon} Dungeon */
/** @typedef {import('../../types.js').EventConfig} EventConfig */
/** @typedef {import('../../types.js').Context} Context */
/** @typedef {import('../../types.js').Funnel} Funnel */

import dayjs from "dayjs";
import { makeName } from "ak-tools";
import * as u from "../utils/utils.js";
import { resolveSoup } from "../templates/soup-presets.js";
import { resolveMacro } from "../templates/macro-presets.js";

/**
 * Resolve dataset window from config. Returns { datasetStartUnix, datasetEndUnix, numDays }.
 * Three modes:
 *   1. Both `datasetStart` AND `datasetEnd` provided → pin window. Recompute numDays from the
 *      window (ignore any user-supplied numDays — warn on conflict). Bit-exact deterministic.
 *   2. Neither provided → fall back to (today_start - numDays, today_start). Deterministic
 *      within a single calendar day; slides across days. Warn once.
 *   3. Exactly one provided → throw.
 *
 * Accepts ISO strings, unix seconds, or anything dayjs() can parse.
 *
 * @param {*} datasetStart
 * @param {*} datasetEnd
 * @param {number} [userNumDays]
 * @returns {{ datasetStartUnix: number, datasetEndUnix: number, numDays: number }}
 */
function resolveDatasetWindow(datasetStart, datasetEnd, userNumDays, verbose = false) {
	const hasStart = datasetStart !== undefined && datasetStart !== null;
	const hasEnd = datasetEnd !== undefined && datasetEnd !== null;

	if (hasStart !== hasEnd) {
		throw new Error(
			`datasetStart and datasetEnd must be specified together (got datasetStart=${datasetStart}, datasetEnd=${datasetEnd}). ` +
			`Provide both to pin the window, or neither to fall back to numDays.`
		);
	}

	if (hasStart && hasEnd) {
		const startUnix = parseToUnix(datasetStart, 'datasetStart');
		const endUnix = parseToUnix(datasetEnd, 'datasetEnd');
		if (endUnix <= startUnix) {
			throw new Error(`datasetEnd (${datasetEnd}) must be after datasetStart (${datasetStart}).`);
		}
		const derivedNumDays = Math.max(1, Math.round((endUnix - startUnix) / 86400));
		if (verbose && userNumDays !== undefined && userNumDays !== null && userNumDays !== derivedNumDays) {
			console.warn(
				`⚠️  datasetStart/datasetEnd take precedence; user-supplied numDays=${userNumDays} ignored, derived numDays=${derivedNumDays}.`
			);
		}
		return { datasetStartUnix: startUnix, datasetEndUnix: endUnix, numDays: derivedNumDays };
	}

	// Fallback: anchor to today's start-of-day, walk back numDays
	const fallbackNumDays = (typeof userNumDays === 'number' && userNumDays > 0) ? userNumDays : 30;
	const todayStart = dayjs().startOf('day').unix();
	const fallbackStart = todayStart - fallbackNumDays * 86400;
	if (verbose) console.warn(
		`⚠️  No 'datasetStart'/'datasetEnd' set — dataset window anchored to today's date and will shift across runs. Pin both for full determinism.`
	);
	return { datasetStartUnix: fallbackStart, datasetEndUnix: todayStart, numDays: fallbackNumDays };
}

/**
 * Parse a value (ISO string, unix seconds, dayjs-parseable) into unix seconds.
 * Throws if the value can't be parsed into a valid date.
 * @param {*} value
 * @param {string} fieldName
 * @returns {number}
 */
function parseToUnix(value, fieldName) {
	// Treat numbers as unix seconds (or unix milliseconds if too large)
	if (typeof value === 'number') {
		if (!Number.isFinite(value) || value <= 0) {
			throw new Error(`${fieldName} must be a positive finite number (got ${value}).`);
		}
		// Heuristic: > 10^12 means milliseconds, otherwise seconds
		return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
	}
	const parsed = dayjs(value);
	if (!parsed.isValid()) {
		throw new Error(`${fieldName} could not be parsed as a date (got ${JSON.stringify(value)}).`);
	}
	return parsed.unix();
}

/**
 * Infers funnels from the provided events
 * @param {EventConfig[]} events - Array of event configurations
 * @returns {Funnel[]} Array of inferred funnel configurations
 */
function inferFunnels(events) {
	const createdFunnels = [];
	const firstEvents = events.filter((e) => e.isFirstEvent).map((e) => e.event);
	const usageEvents = events
		.filter((e) => !e.isFirstEvent && !e.isStrictEvent)
		.map((e) => e.event);
	const numFunnelsToCreate = Math.ceil(usageEvents.length);

	/** @type {import('../../types.js').Funnel} */
	const funnelTemplate = {
		sequence: [],
		conversionRate: 50,
		order: 'sequential',
		requireRepeats: false,
		props: {},
		timeToConvert: 1,
		isFirstFunnel: false,
		weight: 1
	};

	// Create funnels for first events
	if (firstEvents.length) {
		for (const event of firstEvents) {
			createdFunnels.push({
				...u.deepClone(funnelTemplate),
				sequence: [event],
				isFirstFunnel: true,
				conversionRate: 100
			});
		}
	}

	// At least one funnel with all usage events
	createdFunnels.push({ ...u.deepClone(funnelTemplate), sequence: usageEvents });

	// Create random funnels for the rest
	for (let i = 1; i < numFunnelsToCreate; i++) {
		/** @type {import('../../types.js').Funnel} */
		const funnel = { ...u.deepClone(funnelTemplate) };
		funnel.conversionRate = u.integer(10, 50);
		funnel.timeToConvert = u.integer(24, 72);
		funnel.weight = u.integer(1, 10);
		const sequence = u.shuffleArray(usageEvents).slice(0, u.integer(2, usageEvents.length));
		funnel.sequence = sequence;
		funnel.order = 'random';
		createdFunnels.push(funnel);
	}

	return createdFunnels;
}

/**
 * Config keys removed from the engine in 1.4. Silently stripped by
 * `validateDungeonConfig` with a single warning per dungeon. To recreate any of these
 * patterns, use hooks (see `lib/hook-patterns/*`).
 */
const KILLED_CONFIG_KEYS = ['subscription', 'attribution', 'geo', 'features', 'anomalies'];

/**
 * Strip killed config keys in place, log one deprecation warning per dungeon.
 * @param {Partial<Dungeon>} config
 */
function stripKilledConfigKeys(config) {
	const found = KILLED_CONFIG_KEYS.filter(k => config[k] !== undefined && config[k] !== null);
	if (!found.length) return;
	for (const k of found) delete config[k];
	if (config.verbose) {
		console.warn(
			`⚠️  dungeon-master 1.4 removed engine support for: ${found.join(', ')}. ` +
			`These config keys are silently ignored. Recreate via hooks (see lib/hook-patterns/* once Phase 4 lands).`
		);
	}
}

/**
 * Validate `Funnel.attempts` config in place. Coerces missing/invalid bounds so callers
 * downstream don't have to re-defend. Throws on logically invalid configs (max < min).
 * @param {import('../../types.js').Funnel[]} funnels
 */
function validateAttempts(funnels) {
	for (const f of funnels) {
		if (!f || !f.attempts) continue;
		const a = f.attempts;
		const min = Number.isFinite(a.min) ? Math.max(0, Math.floor(a.min)) : 0;
		const max = Number.isFinite(a.max) ? Math.max(0, Math.floor(a.max)) : min;
		if (max < min) {
			throw new Error(`Funnel "${f.name || f.sequence?.join(' > ')}" attempts.max (${a.max}) must be >= attempts.min (${a.min})`);
		}
		a.min = min;
		a.max = max;
		if (a.conversionRate !== undefined) {
			if (!Number.isFinite(a.conversionRate)) {
				throw new Error(`Funnel "${f.name || f.sequence?.join(' > ')}" attempts.conversionRate must be a finite number 0-100`);
			}
			a.conversionRate = Math.max(0, Math.min(100, a.conversionRate));
		}
	}
}

/**
 * Normalize `Funnel.experiment` in place. `true` → default 3-variant config.
 * Object → validated and resolved. Stores `funnel._experiment` for downstream.
 * @param {import('../../types.js').Funnel[]} funnels
 * @param {number} datasetEndUnix
 */
function normalizeExperiments(funnels, datasetEndUnix) {
	const DEFAULT_VARIANTS = [
		{ name: 'Variant A', conversionMultiplier: 0.7, ttcMultiplier: 1.5, weight: 1 },
		{ name: 'Variant B', conversionMultiplier: 1.3, ttcMultiplier: 0.7, weight: 1 },
		{ name: 'Control', conversionMultiplier: 1.0, ttcMultiplier: 1.0, weight: 1 },
	];
	for (const f of funnels) {
		if (!f || !f.experiment) continue;
		const raw = f.experiment === true ? {} : f.experiment;
		const name = raw.name || (f.name ? f.name + ' Experiment' : 'Unnamed Experiment');
		const variants = (raw.variants && raw.variants.length)
			? raw.variants.map(v => ({
				name: v.name || 'Unnamed Variant',
				conversionMultiplier: Number.isFinite(v.conversionMultiplier) ? Math.max(0.01, v.conversionMultiplier) : 1.0,
				ttcMultiplier: Number.isFinite(v.ttcMultiplier) ? Math.max(0.01, v.ttcMultiplier) : 1.0,
				weight: Number.isFinite(v.weight) && v.weight > 0 ? v.weight : 1,
			}))
			: DEFAULT_VARIANTS;
		const startDays = Number.isFinite(raw.startDaysBeforeEnd) && raw.startDaysBeforeEnd > 0
			? raw.startDaysBeforeEnd : 0;
		const startUnix = startDays > 0 ? datasetEndUnix - startDays * 86400 : null;
		f._experiment = { name, variants, startUnix };
	}
}

/**
 * Resolve `avgDevicePerUser` per Section 3.3 rules. Returns the integer device count
 * the engine should use (0 = no device_id stamping at all, 1+ = pool size).
 *
 * @param {Partial<Dungeon>} config
 * @returns {number}
 */
function resolveDevicesPerUser(config) {
	const raw = config.avgDevicePerUser;
	const hasAnon = config.hasAnonIds === true;
	if (raw === undefined || raw === null) {
		return hasAnon ? 1 : 0;
	}
	if (!Number.isFinite(raw)) {
		return hasAnon ? 1 : 0;
	}
	const n = Math.round(raw);
	if (n <= 0) return hasAnon ? 1 : 0;
	return n;
}

/**
 * Validates and enriches a dungeon configuration object
 * @param {Partial<Dungeon>} config - Raw configuration object
 * @returns {Dungeon} Validated and enriched configuration
 */
export function validateDungeonConfig(config) {
	const chance = u.getChance();

	// Phase 1 — strip killed config keys before anything else reads them.
	stripKilledConfigKeys(config);

	// Transform SCD props to regular props if credentials are missing
	// This MUST happen BEFORE we extract values from the config
	transformSCDPropsWithoutCredentials(config);

	// Extract configuration with defaults
	let {
		seed,
		numEvents,
		numUsers = 1000,
		numDays = 30,
		avgEventsPerUserPerDay,
		epochStart = 0,
		epochEnd = dayjs().unix(),
		events = [{ event: "foo" }, { event: "bar" }, { event: "baz" }],
		superProps = { luckyNumber: [2, 2, 4, 4, 42, 42, 42, 2, 2, 4, 4, 42, 42, 42, 420] },
		funnels = [],
		userProps = {
			spiritAnimal: chance.animal.bind(chance),
		},
		scdProps = {},
		mirrorProps = {},
		groupKeys = [],
		groupProps = {},
		lookupTables = [],
		hasAnonIds = false,
		hasSessionIds = false,
		sessionTimeout = 30,
		format = "csv",
		token = null,
		region = "US",
		writeToDisk = false,
		verbose = false,
		soup = {},
		hook = (record) => record,
		hasAdSpend = false,
		hasCampaigns = false,
		hasLocation = false,
		hasAvatar = false,
		isAnonymous = false,
		hasBrowser = false,
		hasAndroidDevices = false,
		hasDesktopDevices = false,
		hasIOSDevices = false,
		alsoInferFunnels = false,
		name = "",
		batchSize = 2_500_000,
		concurrency = 1,
		strictEventCount = false
	} = config;

	// Allow concurrency override from config (default is now 1)
	if (config.concurrency === undefined || config.concurrency === null) {
		concurrency = 1;
	}

	// Force concurrency to 1 when strictEventCount is enabled
	// This ensures the bailout check works correctly without race conditions
	if (strictEventCount && concurrency !== 1) {
		concurrency = 1;
	}

	// Throw if token is the placeholder and nothing will be written to disk
	if (token === "your-mixpanel-token" && !writeToDisk) {
		throw new Error(
			"No Mixpanel token set and writeToDisk is false — nothing useful will happen.\n" +
			"Either set process.env.MP_TOKEN, change the token in the dungeon file, or set writeToDisk to true."
		);
	}

	// Ensure defaults for deep objects
	if (!config.superProps) config.superProps = superProps;
	if (!config.userProps || Object.keys(config.userProps).length === 0) {
		userProps = { spiritAnimal: chance.animal.bind(chance) };
	}

	// Guard against zero/negative numUsers up front (would produce NaN budgets).
	if (!Number.isFinite(numUsers) || numUsers <= 0) {
		throw new Error(`numUsers must be a positive number (got ${numUsers})`);
	}

	// Reject explicit zero/negative numDays from the caller before falling through
	// to the epoch-derivation branches below (which would otherwise replace 0
	// with a derived value or throw a less-specific message).
	if (config.numDays !== undefined && (!Number.isFinite(config.numDays) || config.numDays <= 0)) {
		throw new Error(`numDays must be a positive number (got ${config.numDays})`);
	}

	// ── Resolve dataset window ──
	// Preferred path: explicit datasetStart + datasetEnd → pinned, deterministic window.
	// Fallback: numDays only → today_start - numDays back (sliding, warn-emitted).
	const windowResolution = resolveDatasetWindow(config.datasetStart, config.datasetEnd, config.numDays, verbose);
	const datasetStartUnix = windowResolution.datasetStartUnix;
	const datasetEndUnix = windowResolution.datasetEndUnix;
	numDays = windowResolution.numDays;

	// Mirror window into legacy epoch* surface (still consumed by inferFunnels callers
	// and any external code that read these from validated config).
	epochStart = datasetStartUnix;
	epochEnd = datasetEndUnix;

	// Resolve event-rate primitive: avgEventsPerUserPerDay is the canonical knob.
	// numEvents is supported as a fallback (legacy + total-volume target). Whichever
	// is set, derive the other so downstream code (batching, progress, mixpanel-sender)
	// can use either.
	if (avgEventsPerUserPerDay !== undefined && numEvents !== undefined) {
		// Both provided: avgEventsPerUserPerDay wins. Recompute numEvents from rate.
		numEvents = Math.round(avgEventsPerUserPerDay * numUsers * numDays);
	} else if (avgEventsPerUserPerDay !== undefined) {
		numEvents = Math.round(avgEventsPerUserPerDay * numUsers * numDays);
	} else if (numEvents !== undefined) {
		avgEventsPerUserPerDay = numEvents / numUsers / numDays;
	} else {
		// Neither set — fall back to legacy default (100K total).
		numEvents = 100_000;
		avgEventsPerUserPerDay = numEvents / numUsers / numDays;
	}

	// Auto-enable batch mode for large datasets to prevent OOM.
	// MUST run after rate→numEvents resolution above, otherwise dungeons that set
	// only avgEventsPerUserPerDay would never trigger auto-batch.
	if (numEvents >= 2_000_000 && config.batchSize === undefined) {
		batchSize = 1_000_000;
		if (verbose) console.warn(`⚠️  Auto-enabling batch mode: numEvents (${numEvents.toLocaleString()}) >= 2M. Using batchSize of ${batchSize.toLocaleString()}.`);
	}

	// Resolve soup presets (intra-week / intra-day shape — must happen after numDays is computed)
	const resolved = resolveSoup(soup, numDays);
	soup = resolved.soup;

	// Resolve macro preset (big-picture trend shape across the window).
	// Default is "flat" — see lib/templates/macro-presets.js. Top-level
	// bornRecentBias / percentUsersBornInDataset / preExistingSpread on the
	// dungeon config win over the macro preset's values, so existing dungeons
	// that set these explicitly continue to render the same way.
	// Resolve into local vars (do NOT mutate input config).
	const macroResolved = resolveMacro(config.macro);
	let bornRecentBias = config.bornRecentBias !== undefined ? config.bornRecentBias : macroResolved.bornRecentBias;
	let percentUsersBornInDataset = config.percentUsersBornInDataset !== undefined ? config.percentUsersBornInDataset : macroResolved.percentUsersBornInDataset;
	let preExistingSpread = config.preExistingSpread !== undefined ? config.preExistingSpread : macroResolved.preExistingSpread;

	// Clamp bornRecentBias to [-1, 1] — values outside this range produce
	// nonsensical exponents (e.g. Math.pow(0, -0.4) = Infinity in user-loop.js).
	if (typeof bornRecentBias === 'number' && Number.isFinite(bornRecentBias)) {
		bornRecentBias = Math.max(-1, Math.min(1, bornRecentBias));
	} else {
		bornRecentBias = 0;
	}

	// Use provided name if non-empty string, otherwise generate one
	if (!name || name === "") {
		name = makeName();
	}

	// Convert string hook to function
	if (typeof hook === 'string') {
		try {
			// Use eval in a controlled manner to convert the string to a function
			// The string should be: function(record, type, meta) { ... }
			// eslint-disable-next-line no-eval
			hook = eval(`(${hook})`);

			// Validate it's actually a function
			if (typeof hook !== 'function') {
				throw new Error('Hook string did not evaluate to a function');
			}
		} catch (error) {
			if (verbose) {
				console.warn(`\u26a0\ufe0f Failed to convert hook string to function: ${error.message}`);
				console.warn('Using default pass-through hook');
			}
			hook = (record) => record;
		}
	}

	// Ensure hook is a function
	if (typeof hook !== 'function') {
		if (verbose) console.warn('\u26a0\ufe0f Hook is not a function, using default pass-through hook');
		hook = (record) => record;
	}

	// Validate events
	if (!events || !events.length) events = [{ event: "foo" }, { event: "bar" }, { event: "baz" }];

	// Convert string events to objects  
	if (typeof events[0] === "string") {
		events = events.map(e => ({ event: /** @type {string} */ (e) }));
	}

	// Validate: if every user is born in dataset, we need either isFirstEvent or isFirstFunnel
	const percentBorn = percentUsersBornInDataset;
	const hasFirstEvent = events.some(e => e.isFirstEvent);
	const hasFirstFunnel = funnels.some(f => f.isFirstFunnel);
	if (percentBorn >= 100 && !hasFirstEvent && !hasFirstFunnel) {
		throw new Error(
			"percentUsersBornInDataset is 100% but no event has isFirstEvent and no funnel has isFirstFunnel. " +
			"Either add isFirstEvent to an event, add a first funnel, or lower percentUsersBornInDataset."
		);
	}

	// Handle funnel inference
	if (alsoInferFunnels) {
		const inferredFunnels = inferFunnels(events);
		funnels = [...funnels, ...inferredFunnels];
	}

	// Create funnel for events not in other funnels
	const eventContainedInFunnels = Array.from(funnels.reduce((acc, f) => {
		const events = f.sequence;
		events.forEach(event => acc.add(event));
		return acc;
	}, new Set()));

	const eventsNotInFunnels = events
		.filter(e => !e.isFirstEvent)
		.filter(e => !e.isStrictEvent)
		.filter(e => !eventContainedInFunnels.includes(e.event))
		.map(e => e.event);

	if (eventsNotInFunnels.length) {
		const sequence = u.shuffleArray(eventsNotInFunnels.flatMap(event => {
			let evWeight;
			// First check the config
			if (config.events) {
				evWeight = config.events.find(e => e.event === event)?.weight || 1;
			}
			// Fallback on default
			else {
				evWeight = 1;
			}
			// Clamp weight to reasonable range (1-10) and ensure integer
			evWeight = Math.max(1, Math.min(Math.floor(evWeight) || 1, 10));
			return Array(evWeight).fill(event);
		}));

		funnels.push({
			sequence,
			conversionRate: 50,
			order: 'random',
			timeToConvert: 24 * 14,
			requireRepeats: false,
		});
	}

	// ensure every event in funnel sequence exists in our eventConfig
	const eventInFunnels = Array.from(new Set(funnels.map(funnel => funnel.sequence).flat()));

	const definedEvents = events.map(e => e.event);
	const missingEvents = eventInFunnels.filter(event => !definedEvents.includes(event));
	if (missingEvents.length) {
		throw new Error(`Funnel sequences contain events that are not defined in the events config:\n\n${missingEvents.join(', ')}\n\nPlease ensure all events in funnel sequences are defined in the events array.`);
	}



	// Event validation 
	const validatedEvents = u.validateEventConfig(events);

	// ── Validate and resolve advanced features ──

	// Feature 1: Personas
	let personas = config.personas || null;
	if (personas) {
		personas = validatePersonas(personas);
	}

	// Feature 2: World Events
	let worldEvents = config.worldEvents || null;
	if (worldEvents) {
		worldEvents = resolveWorldEvents(worldEvents, datasetStartUnix);
	}

	// Feature 3: Engagement Decay
	let engagementDecay = config.engagementDecay || null;
	if (engagementDecay) {
		engagementDecay = validateEngagementDecay(engagementDecay);
	}

	// Feature 4: Data Quality
	let dataQuality = config.dataQuality || null;
	if (dataQuality) {
		dataQuality = validateDataQuality(dataQuality);
	}

	// Phase 1: validate Funnel.attempts on every funnel (additive — most have none).
	validateAttempts(funnels);

	// Normalize experiment configs: true → default 3-variant, object → validated.
	normalizeExperiments(funnels, datasetEndUnix);

	// Phase 1: resolve multi-device config. `avgDevicePerUser` is the canonical knob;
	// `hasAnonIds: true` aliases to 1. Default 0 = no device_id stamping (legacy).
	const avgDevicePerUser = resolveDevicesPerUser(config);
	// Keep hasAnonIds in sync — downstream code (utils.generateUser) still reads it.
	// Setting it true here when avgDevicePerUser >= 1 lets the legacy device-pool
	// generation in `person()` continue to allocate `anonymousIds[]` for the user.
	const hasAnonIdsResolved = avgDevicePerUser >= 1;

	// Warn if isAuthEvent is set but avgDevicePerUser=0 — pre-auth device_only
	// stamping degrades to user_id via the floor guard, defeating the identity model.
	if (verbose && avgDevicePerUser === 0 && validatedEvents.some(e => e.isAuthEvent)) {
		console.warn(
			`⚠️  isAuthEvent requires avgDevicePerUser >= 1 to produce pre-auth anonymous events. ` +
			`Set avgDevicePerUser or hasAnonIds: true.`
		);
	}

	// Precompute whether any event has isAttributionEvent for UTM stamping logic.
	const hasAttributionFlags = validatedEvents.some(e => e.isAttributionEvent);

	// Build final config object
	const validatedConfig = {
		...config,
		concurrency,
		funnels,
		batchSize,
		seed,
		numEvents,
		numUsers,
		numDays,
		avgEventsPerUserPerDay,
		epochStart,
		epochEnd,
		datasetStart: datasetStartUnix,
		datasetEnd: datasetEndUnix,
		events: validatedEvents,
		superProps,
		userProps,
		scdProps,
		mirrorProps,
		groupKeys,
		groupProps,
		lookupTables,
		hasAnonIds: hasAnonIdsResolved,
		avgDevicePerUser,
		hasSessionIds,
		sessionTimeout: (typeof sessionTimeout === 'number' && sessionTimeout > 0) ? sessionTimeout : 30,
		format,
		token,
		region,
		writeToDisk,
		verbose,
		soup,
		hook,
		hasAdSpend,
		hasCampaigns,
		hasAttributionFlags,
		hasLocation,
		hasAvatar,
		isAnonymous,
		hasBrowser,
		hasAndroidDevices,
		hasDesktopDevices,
		hasIOSDevices,
		name,
		strictEventCount,
		// Macro trend (resolved from preset + per-dungeon overrides; clamped)
		macro: config.macro,
		bornRecentBias,
		percentUsersBornInDataset,
		preExistingSpread,
		// Advanced features (kept after 1.4)
		personas,
		worldEvents,
		engagementDecay,
		dataQuality,
		// Killed in 1.4 — set to null so hooks/external code that reads these get a falsy value.
		subscription: null,
		attribution: null,
		geo: null,
		features: null,
		anomalies: null
	};

	return validatedConfig;
}

/**
 * Transforms SCD properties to regular user/group properties when service account credentials are missing
 * ONLY applies to UI jobs - programmatic usage always generates SCD files
 * @param {Partial<Dungeon>} config - Configuration object
 * @returns {void} Modifies config in place
 */
function transformSCDPropsWithoutCredentials(config) {
	const { serviceAccount, projectId, serviceSecret, scdProps, isUIJob, token } = config;

	// If no SCD props configured, nothing to validate
	if (!scdProps || Object.keys(scdProps).length === 0) {
		return;
	}

	// If we have all credentials, SCD import can proceed
	if (serviceAccount && projectId && serviceSecret) {
		return;
	}

	// Missing credentials - handle based on job type
	if (!isUIJob) {
		// For programmatic/CLI usage, throw an error if trying to send SCDs to Mixpanel without credentials
		if (token) {
			throw new Error(
				'Configuration error: SCD properties are configured but service credentials are missing.\n' +
				'To import SCD data to Mixpanel, you must provide:\n' +
				'  - serviceAccount: Your Mixpanel service account username\n' +
				'  - serviceSecret: Your Mixpanel service account secret\n' +
				'  - projectId: Your Mixpanel project ID\n' +
				'Without these credentials, SCD data cannot be imported to Mixpanel.'
			);
		}
		// If not sending to Mixpanel (no token), allow generation for testing
		return;
	}

	// UI job without credentials - convert SCD props to regular props
	if (config.verbose !== false) console.log('\u26a0\ufe0f  Service account credentials missing - converting SCD properties to static properties');

	// Ensure userProps and groupProps exist
	if (!config.userProps) config.userProps = {};
	if (!config.groupProps) config.groupProps = {};

	// Process each SCD property
	for (const [propKey, scdProp] of Object.entries(scdProps)) {
		const { type = "user", values } = scdProp;

		// Skip if no values
		if (!values || JSON.stringify(values) === "{}" || JSON.stringify(values) === "[]") {
			continue;
		}

		// Determine if this is a user or group property
		if (type === "user") {
			// Add to userProps
			config.userProps[propKey] = values;
			if (config.verbose !== false) console.log(`  \u2713 Converted user SCD property: ${propKey}`);
		} else {
			// Add to groupProps for the specific group type
			if (!config.groupProps[type]) {
				config.groupProps[type] = {};
			}
			config.groupProps[type][propKey] = values;
			if (config.verbose !== false) console.log(`  \u2713 Converted group SCD property: ${propKey} (${type})`);
		}
	}

	// Clear out scdProps since we've converted everything
	config.scdProps = {};
	if (config.verbose !== false) console.log('\u2713 SCD properties converted to static properties\n');
}

// ── Advanced Feature Validation Functions ──

/**
 * Validates persona configurations
 * @param {import('../../types').Persona[]} personas
 * @returns {import('../../types').Persona[]}
 */
function validatePersonas(personas) {
	if (!Array.isArray(personas) || personas.length === 0) return null;
	for (const p of personas) {
		if (!p.name) throw new Error('Each persona must have a name');
		if (typeof p.weight !== 'number' || p.weight <= 0) throw new Error(`Persona "${p.name}" must have a positive weight`);
		if (p.eventMultiplier === undefined) p.eventMultiplier = 1.0;
		if (p.conversionModifier === undefined) p.conversionModifier = 1.0;
		if (p.churnRate === undefined) p.churnRate = 0;
		if (p.properties === undefined) p.properties = {};
	}
	return personas;
}

/**
 * Resolves world events to absolute timestamps
 * @param {import('../../types').WorldEvent[]} worldEvents
 * @param {number} beginUnix - Dataset start (unix seconds)
 * @returns {import('../../types').ResolvedWorldEvent[]}
 */
function resolveWorldEvents(worldEvents, beginUnix) {
	if (!Array.isArray(worldEvents) || worldEvents.length === 0) return null;

	return worldEvents.map(we => {
		const startUnix = beginUnix + (we.startDay * 86400);
		let endUnix;
		if (we.duration === null || we.duration === undefined) {
			endUnix = Infinity; // permanent
		} else {
			endUnix = startUnix + (we.duration * 86400);
		}
		const aftermathEndUnix = (we.aftermath && we.aftermath.duration !== undefined)
			? endUnix + (we.aftermath.duration * 86400)
			: undefined;
		const resolved = { ...we, startUnix, endUnix, aftermathEndUnix };
		if (!we.affectsEvents) resolved.affectsEvents = "*";
		if (!we.volumeMultiplier) resolved.volumeMultiplier = 1.0;
		if (!we.conversionModifier) resolved.conversionModifier = 1.0;
		return resolved;
	}).sort((a, b) => a.startUnix - b.startUnix || (a.name || '').localeCompare(b.name || ''));
}

/**
 * Validates engagement decay config
 * @param {import('../../types').EngagementDecay} decay
 * @returns {import('../../types').EngagementDecay}
 */
function validateEngagementDecay(decay) {
	const valid = ['exponential', 'linear', 'step', 'none'];
	if (!valid.includes(decay.model)) throw new Error(`engagementDecay.model must be one of: ${valid.join(', ')}`);
	if (decay.model === 'none') return decay;
	if (decay.halfLife === undefined) decay.halfLife = 45;
	if (decay.halfLife <= 0) throw new Error('engagementDecay.halfLife must be > 0');
	if (decay.floor === undefined) decay.floor = 0.1;
	decay.floor = Math.max(0, Math.min(1, decay.floor));
	if (decay.reactivationChance === undefined) decay.reactivationChance = 0;
	if (decay.reactivationMultiplier === undefined) decay.reactivationMultiplier = 2.0;
	return decay;
}

/**
 * Validates data quality config
 * @param {import('../../types').DataQuality} dq
 * @returns {import('../../types').DataQuality}
 */
function validateDataQuality(dq) {
	if (dq.nullRate === undefined) dq.nullRate = 0;
	if (dq.duplicateRate === undefined) dq.duplicateRate = 0;
	if (dq.lateArrivingRate === undefined) dq.lateArrivingRate = 0;
	if (dq.botUsers === undefined) dq.botUsers = 0;
	if (dq.botEventsPerUser === undefined) dq.botEventsPerUser = 1000;
	if (dq.timezoneConfusion === undefined) dq.timezoneConfusion = 0;
	if (dq.emptyEvents === undefined) dq.emptyEvents = 0;
	if (!dq.nullProps) dq.nullProps = "*";
	// Clamp rates to [0, 1]
	for (const key of ['nullRate', 'duplicateRate', 'lateArrivingRate', 'timezoneConfusion', 'emptyEvents']) {
		dq[key] = Math.max(0, Math.min(1, dq[key]));
	}
	return dq;
}

// validateSubscription / validateAttribution / validateGeo / resolveFeatures /
// resolveAnomalies were removed in 1.4 along with their respective config keys.
// `stripKilledConfigKeys` deletes the inputs before they reach the validator body.

export { inferFunnels, transformSCDPropsWithoutCredentials };