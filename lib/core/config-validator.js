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

/** Fixed reference point for time calculations (2024-02-02) */
const FIXED_NOW = dayjs('2024-02-02').unix();

/**
 * Infers funnels from the provided events
 * @param {EventConfig[]} events - Array of event configurations
 * @returns {Funnel[]} Array of inferred funnel configurations
 */
function inferFunnels(events) {
	const createdFunnels = [];
	const firstEvents = events.filter((e) => e.isFirstEvent).map((e) => e.event);
	const strictEvents = events.filter((e) => e.isStrictEvent).map((e) => e.event);
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
 * Validates and enriches a dungeon configuration object
 * @param {Partial<Dungeon>} config - Raw configuration object
 * @returns {Dungeon} Validated and enriched configuration
 */
export function validateDungeonConfig(config) {
	const chance = u.getChance();

	// Transform SCD props to regular props if credentials are missing
	// This MUST happen BEFORE we extract values from the config
	transformSCDPropsWithoutCredentials(config);

	// Extract configuration with defaults
	let {
		seed,
		numEvents = 100_000,
		numUsers = 1000,
		numDays = 30,
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

	// Auto-enable batch mode for large datasets to prevent OOM
	if (numEvents >= 2_000_000 && config.batchSize === undefined) {
		batchSize = 1_000_000;
		console.warn(`⚠️  Auto-enabling batch mode: numEvents (${numEvents.toLocaleString()}) >= 2M. Using batchSize of ${batchSize.toLocaleString()}.`);
	}

	// Ensure defaults for deep objects
	if (!config.superProps) config.superProps = superProps;
	if (!config.userProps || Object.keys(config?.userProps || {})) config.userProps = userProps;

	// Setting up "TIME"
	if (epochStart && !numDays) numDays = dayjs.unix(epochEnd).diff(dayjs.unix(epochStart), "day");
	if (!epochStart && numDays) epochStart = dayjs.unix(epochEnd).subtract(numDays, "day").unix();
	if (epochStart && numDays) { } // noop
	if (!epochStart && !numDays) {
		throw new Error("Either epochStart or numDays must be provided");
	}

	// Resolve soup presets (must happen after numDays is computed)
	const resolved = resolveSoup(soup, numDays);
	soup = resolved.soup;
	// Apply suggested birth distribution params if not explicitly set by the dungeon
	if (resolved.suggestedBornRecentBias !== undefined && config.bornRecentBias === undefined) {
		config.bornRecentBias = resolved.suggestedBornRecentBias;
	}
	if (resolved.suggestedPercentUsersBornInDataset !== undefined && config.percentUsersBornInDataset === undefined) {
		config.percentUsersBornInDataset = resolved.suggestedPercentUsersBornInDataset;
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
			if (config.verbose !== false) {
				console.warn(`\u26a0\ufe0f Failed to convert hook string to function: ${error.message}`);
				console.warn('Using default pass-through hook');
			}
			hook = (record) => record;
		}
	}

	// Ensure hook is a function
	if (typeof hook !== 'function') {
		if (config.verbose !== false) console.warn('\u26a0\ufe0f Hook is not a function, using default pass-through hook');
		hook = (record) => record;
	}

	// Validate events
	if (!events || !events.length) events = [{ event: "foo" }, { event: "bar" }, { event: "baz" }];

	// Convert string events to objects  
	if (typeof events[0] === "string") {
		events = events.map(e => ({ event: /** @type {string} */ (e) }));
	}

	// Validate: if every user is born in dataset, we need either isFirstEvent or isFirstFunnel
	const percentBorn = config.percentUsersBornInDataset ?? 15;
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
		worldEvents = resolveWorldEvents(worldEvents, numDays);
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

	// Feature 5: Subscription
	let subscription = config.subscription || null;
	if (subscription) {
		subscription = validateSubscription(subscription);
	}

	// Feature 6: Attribution
	let attribution = config.attribution || null;
	if (attribution) {
		attribution = validateAttribution(attribution, numDays);
	}

	// Feature 7: Geo
	let geo = config.geo || null;
	if (geo) {
		geo = validateGeo(geo);
	}

	// Feature 8: Features (progressive adoption)
	let features = config.features || null;
	if (features) {
		features = resolveFeatures(features, numDays);
	}

	// Feature 9: Anomalies
	let anomalies = config.anomalies || null;
	if (anomalies) {
		anomalies = resolveAnomalies(anomalies, numDays);
	}

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
		epochStart,
		epochEnd,
		events: validatedEvents,
		superProps,
		userProps,
		scdProps,
		mirrorProps,
		groupKeys,
		groupProps,
		lookupTables,
		hasAnonIds,
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
		hasLocation,
		hasAvatar,
		isAnonymous,
		hasBrowser,
		hasAndroidDevices,
		hasDesktopDevices,
		hasIOSDevices,
		name,
		strictEventCount,
		// Advanced features
		personas,
		worldEvents,
		engagementDecay,
		dataQuality,
		subscription,
		attribution,
		geo,
		features,
		anomalies
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
 * @param {number} numDays
 * @returns {import('../../types').ResolvedWorldEvent[]}
 */
function resolveWorldEvents(worldEvents, numDays) {
	if (!Array.isArray(worldEvents) || worldEvents.length === 0) return null;
	const beginUnix = dayjs.unix(FIXED_NOW).subtract(numDays, 'day').unix();

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

/**
 * Validates subscription config
 * @param {import('../../types').Subscription} sub
 * @returns {import('../../types').Subscription}
 */
function validateSubscription(sub) {
	if (!sub.plans || !Array.isArray(sub.plans) || sub.plans.length === 0) {
		throw new Error('subscription.plans must be a non-empty array');
	}
	const hasDefault = sub.plans.some(p => p.default);
	if (!hasDefault) sub.plans[0].default = true;
	if (!sub.lifecycle) sub.lifecycle = {};
	const lc = sub.lifecycle;
	if (lc.trialToPayRate === undefined) lc.trialToPayRate = 0.3;
	if (lc.upgradeRate === undefined) lc.upgradeRate = 0.1;
	if (lc.downgradeRate === undefined) lc.downgradeRate = 0.03;
	if (lc.churnRate === undefined) lc.churnRate = 0.05;
	if (lc.winBackRate === undefined) lc.winBackRate = 0.1;
	if (lc.winBackDelay === undefined) lc.winBackDelay = 30;
	if (lc.paymentFailureRate === undefined) lc.paymentFailureRate = 0.02;
	if (!sub.events) sub.events = {};
	const ev = sub.events;
	if (!ev.trialStarted) ev.trialStarted = "trial started";
	if (!ev.subscribed) ev.subscribed = "subscription started";
	if (!ev.upgraded) ev.upgraded = "plan upgraded";
	if (!ev.downgraded) ev.downgraded = "plan downgraded";
	if (!ev.renewed) ev.renewed = "subscription renewed";
	if (!ev.cancelled) ev.cancelled = "subscription cancelled";
	if (!ev.paymentFailed) ev.paymentFailed = "payment failed";
	if (!ev.wonBack) ev.wonBack = "subscription reactivated";
	return sub;
}

/**
 * Validates attribution config
 * @param {import('../../types').Attribution} attr
 * @param {number} numDays
 * @returns {import('../../types').Attribution}
 */
function validateAttribution(attr, numDays) {
	if (!attr.campaigns || !Array.isArray(attr.campaigns)) {
		throw new Error('attribution.campaigns must be an array');
	}
	if (attr.model === undefined) attr.model = "last_touch";
	if (attr.window === undefined) attr.window = 7;
	if (attr.organicRate === undefined) attr.organicRate = 0.4;
	for (const c of attr.campaigns) {
		if (!c.name) throw new Error('Each attribution campaign must have a name');
		if (!c.source) throw new Error(`Attribution campaign "${c.name}" must have a source`);
		if (!c.activeDays) throw new Error(`Attribution campaign "${c.name}" must have activeDays [start, end]`);
		if (!c.dailyBudget) c.dailyBudget = [50, 200];
		if (c.acquisitionRate === undefined) c.acquisitionRate = 0.02;
	}
	return attr;
}

/**
 * Validates geo config
 * @param {import('../../types').GeoConfig} geo
 * @returns {import('../../types').GeoConfig}
 */
function validateGeo(geo) {
	if (geo.sticky === undefined) geo.sticky = false;
	if (geo.regions && !Array.isArray(geo.regions)) throw new Error('geo.regions must be an array');
	if (geo.regionalLaunches && !Array.isArray(geo.regionalLaunches)) throw new Error('geo.regionalLaunches must be an array');
	return geo;
}

/**
 * Resolves feature configs with logistic curve parameters
 * @param {import('../../types').FeatureConfig[]} features
 * @param {number} numDays
 * @returns {import('../../types').FeatureConfig[]}
 */
function resolveFeatures(features, numDays) {
	if (!Array.isArray(features) || features.length === 0) return null;
	const curvePresets = {
		fast: { k: 0.3, midpoint: 7 },
		slow: { k: 0.08, midpoint: 30 },
		instant: { k: 10, midpoint: 0 }
	};
	return features.map(f => {
		if (!f.name) throw new Error('Each feature must have a name');
		if (f.launchDay === undefined) throw new Error(`Feature "${f.name}" must have a launchDay`);
		if (!f.property) throw new Error(`Feature "${f.name}" must have a property`);
		if (!f.values || !Array.isArray(f.values) || f.values.length === 0) {
			throw new Error(`Feature "${f.name}" must have a non-empty values array`);
		}
		if (!f.affectsEvents) f.affectsEvents = "*";
		if (!f.adoptionCurve) f.adoptionCurve = "slow";
		if (typeof f.adoptionCurve === 'string') {
			f._resolvedCurve = curvePresets[f.adoptionCurve] || curvePresets.slow;
		} else {
			f._resolvedCurve = f.adoptionCurve;
		}
		// Pre-compute adopted values to avoid array allocation in hot loop
		f._adoptedValues = f.values.length > 1 ? f.values.slice(1) : f.values;
		return f;
	});
}

/**
 * Resolves anomaly configs with absolute timestamps
 * @param {import('../../types').AnomalyConfig[]} anomalies
 * @param {number} numDays
 * @returns {import('../../types').AnomalyConfig[]}
 */
function resolveAnomalies(anomalies, numDays) {
	if (!Array.isArray(anomalies) || anomalies.length === 0) return null;
	const beginUnix = dayjs.unix(FIXED_NOW).subtract(numDays, 'day').unix();
	return anomalies.map(a => {
		if (!a.type) throw new Error('Each anomaly must have a type');
		if (!a.event) throw new Error('Each anomaly must have an event name');
		const resolved = { ...a };
		if (a.day !== undefined) {
			resolved._startUnix = beginUnix + (a.day * 86400);
			if (a.duration) {
				resolved._endUnix = resolved._startUnix + (a.duration * 86400);
			} else if (a.window) {
				resolved._endUnix = resolved._startUnix + (a.window * 86400);
			} else {
				resolved._endUnix = resolved._startUnix + 86400; // default 1 day
			}
		}
		return resolved;
	});
}

export { inferFunnels, transformSCDPropsWithoutCredentials };