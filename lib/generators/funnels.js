/**
 * Funnel generator module
 * Creates conversion sequences with realistic timing and ordering
 */

/** @typedef {import('../../types').Context} Context */

import dayjs from "dayjs";
import * as u from "../utils/utils.js";
import { makeEvent } from "./events.js";
import { dataLogger as logger } from "../utils/logger.js";

/**
 * Creates a funnel (sequence of events) for a user with conversion logic
 * @param {Context} context - Context object containing config, defaults, etc.
 * @param {Object} funnel - Funnel configuration
 * @param {Object} user - User object with distinct_id, created, etc.
 * @param {number} firstEventTime - Unix timestamp for first event
 * @param {Object} profile - User profile object
 * @param {Object} scd - Slowly changing dimensions object
 * @param {Object} [persona] - User's assigned persona
 * @param {Object} [featureCtx] - Persona / world-event / data-quality / etc. context.
 * @param {Object} [attemptMeta] - Phase 2 multi-attempt + identity context. Shape:
 *   `{ isFirstFunnel, isBorn, attemptsConfig, attemptNumber, totalAttempts, isFinalAttempt,
 *      truncateBeforeAuth, devicePool }`. When omitted defaults to a single normal attempt
 *   with no identity stamping overrides (legacy behavior).
 * @returns {Promise<[Array, boolean, number|null]>} Tuple `[events, didConvert, authTimeMs]`
 *   where `authTimeMs` is the unix-millisecond timestamp of the stitch event (the first
 *   `isAuthEvent` step that actually fired in this funnel run), or null if the user did
 *   not reach the stitch step in this run.
 */
export async function makeFunnel(context, funnel, user, firstEventTime, profile = {}, scd = {}, persona = null, featureCtx = {}, attemptMeta = null) {
	if (!funnel) throw new Error("no funnel");
	if (!user) throw new Error("no user");

	const { config } = context;
	const chance = u.getChance();
	const { hook = async (a) => a } = config;

	// ── Phase 2 attempt + identity context ──
	// Resolve a defensive default so legacy callers that don't pass attemptMeta still
	// get a complete shape downstream (hook meta, identity stamping logic).
	const meta = attemptMeta || {};
	const attemptInfo = {
		isFirstFunnel: !!meta.isFirstFunnel,
		isBorn: meta.isBorn === undefined ? false : !!meta.isBorn,
		attemptsConfig: meta.attemptsConfig || null,
		attemptNumber: meta.attemptNumber || 1,
		totalAttempts: meta.totalAttempts || 1,
		isFinalAttempt: meta.isFinalAttempt === undefined ? true : !!meta.isFinalAttempt,
		truncateBeforeAuth: !!meta.truncateBeforeAuth,
	};
	const devicePool = meta.devicePool || null;

	// Get session start events if configured
	const sessionStartEvents = config.events?.filter(a => a.isSessionStartEvent) || [];

	// Clone funnel to avoid mutating the original object
	funnel = { ...funnel };

	// Experiment handling: if funnel.experiment === true, create 3 variants
	let experimentVariant = null;
	let experimentName = null;

	if (funnel.experiment) {
		experimentName = funnel.name + ` Experiment` || "Unnamed Funnel";

		// Evenly distribute across 3 variants (33.33% each) using seeded chance
		const randomValue = chance.floating({ min: 0, max: 1 });
		if (randomValue < 0.333) {
			// Variant A: WORSE conversion, slower
			funnel.conversionRate = Math.max(1, Math.floor(funnel.conversionRate * 0.7));
			funnel.timeToConvert = Math.max(0.1, funnel.timeToConvert * 1.5);
			experimentVariant = "A";
		} else if (randomValue < 0.666) {
			// Variant B: BETTER conversion, faster
			funnel.conversionRate = Math.min(100, Math.ceil(funnel.conversionRate * 1.3));
			funnel.timeToConvert = Math.max(0.1, funnel.timeToConvert * 0.7);
			experimentVariant = "B";
		} else {
			// Variant C: CONTROL - original values (no changes)
			experimentVariant = "C";
		}

		// Mark that this funnel has experiment metadata (used later)
		funnel._experimentName = experimentName;
		funnel._experimentVariant = experimentVariant;

		// Insert $experiment_started at beginning of sequence (clone array to avoid mutation)
		funnel.sequence = ["$experiment_started", ...funnel.sequence];
	}

	// Call pre-funnel hook
	await hook(funnel, "funnel-pre", {
		user, profile, scd, funnel, config, firstEventTime,
		datasetStart: context.DATASET_START_SECONDS,
		datasetEnd: context.DATASET_END_SECONDS,
		isFirstFunnel: attemptInfo.isFirstFunnel,
		isBorn: attemptInfo.isBorn,
		attemptsConfig: attemptInfo.attemptsConfig,
		attemptNumber: attemptInfo.attemptNumber,
		totalAttempts: attemptInfo.totalAttempts,
		isFinalAttempt: attemptInfo.isFinalAttempt,
	});

	// Extract funnel configuration
	let {
		sequence,
		conversionRate = 50,
		order = 'sequential',
		timeToConvert = 1,
		props = {},
		requireRepeats = false,
		_experimentName: expName,
		_experimentVariant: expVariant,
		bindPropsIndex = 0
	} = funnel;

	const { distinct_id, created, anonymousIds = [], sessionIds = [] } = user;
	const { superProps = {}, groupKeys = [] } = config;

	// Choose properties for this funnel instance
	const chosenFunnelProps = { ...props, ...superProps };
	for (const key in props) {
		try {
			chosenFunnelProps[key] = u.choose(chosenFunnelProps[key]);
		} catch (e) {
			logger.error({ err: e, key, funnel: funnel.sequence.join(" > ") }, `Error processing property ${key} in funnel`);
		}
	}

	// Build event specifications for funnel steps
	const funnelPossibleEvents = buildFunnelEvents(context, sequence, chosenFunnelProps, bindPropsIndex, expName, expVariant);

	// Handle repeat logic and conversion rate adjustment
	let { processedEvents, adjustedConversionRate } = processEventRepeats(
		funnelPossibleEvents,
		requireRepeats,
		conversionRate,
		chance
	);

	// Apply persona conversion modifier (before hook, so hook can override via funnel-pre)
	if (persona && persona.conversionModifier) {
		adjustedConversionRate = Math.min(100, Math.max(0, Math.round(adjustedConversionRate * persona.conversionModifier)));
	}

	// Apply world event conversion modifier if active at firstEventTime
	const resolvedWorldEvents = /** @type {import('../../types').ResolvedWorldEvent[]} */ (config.worldEvents);
	if (resolvedWorldEvents && firstEventTime) {
		for (const we of resolvedWorldEvents) {
			if (firstEventTime >= we.startUnix && firstEventTime < we.endUnix && we.conversionModifier !== 1.0) {
				const affects = we.affectsEvents;
				if (affects === "*" || (Array.isArray(affects) && sequence.some(s => affects.includes(s)))) {
					adjustedConversionRate = Math.min(100, Math.max(0, Math.round(adjustedConversionRate * we.conversionModifier)));
				}
			}
		}
	}

	// Apply feature conversion lifts
	const resolvedFeatures = config.features;
	if (resolvedFeatures && firstEventTime) {
		const daysSinceBegin = (firstEventTime - context.FIXED_BEGIN) / 86400;
		for (const feat of resolvedFeatures) {
			if (feat.conversionLift && daysSinceBegin >= feat.launchDay) {
				const daysSinceLaunch = daysSinceBegin - feat.launchDay;
				const { k, midpoint } = feat._resolvedCurve || { k: 0.08, midpoint: 30 };
				const adoptionProb = 1 / (1 + Math.exp(-k * (daysSinceLaunch - midpoint)));
				if (chance.bool({ likelihood: Math.min(100, adoptionProb * 100) })) {
					adjustedConversionRate = Math.min(100, Math.max(0, Math.round(adjustedConversionRate * feat.conversionLift)));
				}
			}
		}
	}

	// Determine if user converts and how many steps they'll take
	// When experiment mode is active, $experiment_started is prepended to sequence
	// but should not count as a funnel step for conversion purposes
	const conversionStepCount = expName ? sequence.length - 1 : sequence.length;
	let { doesUserConvert, numStepsUserWillTake } = determineConversion(
		adjustedConversionRate,
		conversionStepCount,
		chance
	);

	// ── Phase 2 identity helpers ──
	// `firstAuthSeqIdx` is the index in `sequence` (and processedEvents) of the first
	// step whose event config has `isAuthEvent: true`. Used both for truncating failed
	// prior attempts (cap before auth) and for picking per-step identity stamping mode
	// inside isFirstFunnel runs. -1 if no step in this funnel is flagged.
	const eventsByName = (() => {
		const map = new Map();
		for (const e of (config.events || [])) map.set(e.event, e);
		return map;
	})();
	let firstAuthSeqIdx = -1;
	for (let i = 0; i < sequence.length; i++) {
		const ev = eventsByName.get(sequence[i]);
		if (ev && ev.isAuthEvent) { firstAuthSeqIdx = i; break; }
	}
	// When experiment mode prepends $experiment_started, the auth index in
	// `processedEvents` is shifted right by 1.
	const firstAuthProcessedIdx = firstAuthSeqIdx === -1
		? -1
		: (expName ? firstAuthSeqIdx + 1 : firstAuthSeqIdx);

	// Truncated pre-auth attempt: force the user to drop somewhere strictly before the
	// stitch. If there is no auth step in this funnel, truncation is a no-op (default
	// flow runs). When firstAuthSeqIdx === 0 there's no pre-auth room — force 0 steps
	// (the attempt produces nothing for that user).
	if (attemptInfo.truncateBeforeAuth && firstAuthSeqIdx >= 0 && conversionStepCount > 0) {
		if (firstAuthSeqIdx === 0) {
			numStepsUserWillTake = 0;
		} else {
			numStepsUserWillTake = chance.integer({ min: 1, max: firstAuthSeqIdx });
		}
		doesUserConvert = false;
	}

	// Get steps user will actually take
	let funnelStepsUserWillTake;
	if (attemptInfo.truncateBeforeAuth && firstAuthSeqIdx === 0) {
		// Pre-auth truncation with the stitch at index 0 leaves no room before it → no events.
		funnelStepsUserWillTake = [];
	} else if (expName) {
		// $experiment_started always fires; conversion only applies to actual funnel steps.
		// (Pre-Phase 2 behavior: even when numStepsUserWillTake===0, $experiment_started fires.)
		funnelStepsUserWillTake = [processedEvents[0], ...processedEvents.slice(1, 1 + Math.max(0, numStepsUserWillTake))];
	} else {
		funnelStepsUserWillTake = processedEvents.slice(0, Math.max(0, numStepsUserWillTake));
	}

	// Apply ordering strategy
	const funnelActualOrder = applyOrderingStrategy(
		funnelStepsUserWillTake,
		order,
		config,
		sequence
	);

	// Add timing offsets to events
	const funnelEventsWithTiming = addTimingOffsets(
		funnelActualOrder,
		timeToConvert,
		numStepsUserWillTake
	);

	// Add session start event if configured (clone to avoid mutating shared config)
	if (sessionStartEvents.length) {
		const sessionStartEvent = { ...chance.pickone(sessionStartEvents), relativeTimeMs: -15000 };
		funnelEventsWithTiming.push(sessionStartEvent);
	}

	// Build complete feature context: merge passed-in featureCtx with config fallbacks
	const funnelFeatureCtx = {
		persona: featureCtx.persona || persona || null,
		userCampaign: featureCtx.userCampaign || null,
		userLocation: featureCtx.userLocation || null,
		worldEventsTimeline: featureCtx.worldEventsTimeline || context.config.worldEvents || null,
		resolvedFeatures: featureCtx.resolvedFeatures || context.config.features || null,
		resolvedAnomalies: featureCtx.resolvedAnomalies || context.config.anomalies || null,
		dataQuality: featureCtx.dataQuality || context.config.dataQuality || null,
		geo: featureCtx.geo || context.config.geo || null,
	};

	// Pre-compute per-step stamping modes for execution order. For isFirstFunnel + isBorn
	// runs, the first event in execution order whose config has `isAuthEvent: true` is
	// the stitch event; events before it stamp `device_only`, events after stamp
	// `user_only`. For everything else we stamp `both` (current default identity model).
	const stampingByIndex = new Array(funnelEventsWithTiming.length).fill('both');
	let runAuthExecIdx = -1;
	if (attemptInfo.isFirstFunnel && attemptInfo.isBorn) {
		for (let i = 0; i < funnelEventsWithTiming.length; i++) {
			const evName = funnelEventsWithTiming[i].event;
			const cfg = eventsByName.get(evName);
			if (cfg && cfg.isAuthEvent) { runAuthExecIdx = i; break; }
		}
		for (let i = 0; i < funnelEventsWithTiming.length; i++) {
			if (runAuthExecIdx === -1) {
				stampingByIndex[i] = 'device_only';
			} else if (i < runAuthExecIdx) {
				stampingByIndex[i] = 'device_only';
			} else if (i === runAuthExecIdx) {
				stampingByIndex[i] = 'stitch';
			} else {
				stampingByIndex[i] = 'user_only';
			}
		}
	}

	// Generate actual events with timing
	const finalEvents = await generateFunnelEvents(
		context,
		funnelEventsWithTiming,
		distinct_id,
		firstEventTime || dayjs(created).unix(),
		anonymousIds,
		sessionIds,
		groupKeys,
		funnelFeatureCtx,
		{ devicePool, stampingByIndex }
	);

	// Compute the auth-time of the actual stitch event in execution order, if any.
	const authTimeMs = runAuthExecIdx >= 0 && finalEvents[runAuthExecIdx]
		? Date.parse(finalEvents[runAuthExecIdx].time) || null
		: null;

	// Call post-funnel hook
	await hook(finalEvents, "funnel-post", {
		user, profile, scd, funnel, config,
		datasetStart: context.DATASET_START_SECONDS,
		datasetEnd: context.DATASET_END_SECONDS,
		isFirstFunnel: attemptInfo.isFirstFunnel,
		isBorn: attemptInfo.isBorn,
		attemptsConfig: attemptInfo.attemptsConfig,
		attemptNumber: attemptInfo.attemptNumber,
		totalAttempts: attemptInfo.totalAttempts,
		isFinalAttempt: attemptInfo.isFinalAttempt,
	});

	return [finalEvents, doesUserConvert, authTimeMs];
}

/**
 * Builds event specifications for funnel steps
 * @param {Context} context - Context object
 * @param {Array} sequence - Array of event names
 * @param {Object} chosenFunnelProps - Properties to apply to all events
 * @param {number} bindPropsIndex - Index at which to bind properties (if applicable)
 * @param {string} [experimentName] - Name of experiment (if experiment is enabled)
 * @param {string} [experimentVariant] - Variant name (A, B, or C)
 * @returns {Array} Array of event specifications
 */
function buildFunnelEvents(context, sequence, chosenFunnelProps, bindPropsIndex, experimentName, experimentVariant) {
	const { config } = context;

	return sequence.map((eventName, currentIndex) => {
		// Handle $experiment_started event specially
		if (eventName === "$experiment_started" && experimentName && experimentVariant) {
			return {
				event: "$experiment_started",
				properties: {
					"Experiment name": experimentName,
					"Variant name": experimentVariant
				}
			};
		}

		const foundEvent = config.events?.find((e) => e.event === eventName);

		// PERFORMANCE: Shallow copy instead of deepClone for better performance
		// We only need to copy the top-level structure since we're rebuilding properties anyway
		const eventSpec = foundEvent ? {
			event: foundEvent.event,
			properties: { ...foundEvent.properties }
		} : { event: eventName, properties: {} };

		// Process event properties
		for (const key in eventSpec.properties) {
			try {
				eventSpec.properties[key] = u.choose(eventSpec.properties[key]);
			} catch (e) {
				logger.error({ err: e, key, event: eventSpec.event }, `Error processing property ${key} in ${eventSpec.event} event`);
			}
		}

		// Merge funnel properties (no need to delete properties since we're creating a new object)
		eventSpec.properties = { ...eventSpec.properties, ...chosenFunnelProps };


		if (bindPropsIndex && currentIndex < bindPropsIndex) {
			// Remove funnel properties that were added but should not be bound yet
			for (const key in chosenFunnelProps) {
				delete eventSpec.properties[key];
			}
		}

		return eventSpec;
	});
}

/**
 * Processes event repeats and adjusts conversion rate
 * @param {Array} events - Array of event specifications
 * @param {boolean} requireRepeats - Whether repeats are required
 * @param {number} conversionRate - Base conversion rate
 * @param {Object} chance - Chance.js instance
 * @returns {Object} Object with processedEvents and adjustedConversionRate
 */
function processEventRepeats(events, requireRepeats, conversionRate, chance) {
	let adjustedConversionRate = conversionRate;

	const processedEvents = events.reduce((acc, step) => {
		if (!requireRepeats) {
			if (acc.find(e => e.event === step.event)) {
				if (chance.bool({ likelihood: 50 })) {
					adjustedConversionRate = Math.floor(adjustedConversionRate * 1.35); // Increase conversion rate
					acc.push(step);
				} else {
					adjustedConversionRate = Math.floor(adjustedConversionRate * 0.70); // Reduce conversion rate
					return acc; // Skip the step
				}
			} else {
				acc.push(step);
			}
		} else {
			acc.push(step);
		}
		return acc;
	}, []);

	// Clamp conversion rate
	if (adjustedConversionRate > 100) adjustedConversionRate = 100;
	if (adjustedConversionRate < 0) adjustedConversionRate = 0;

	return { processedEvents, adjustedConversionRate };
}

/**
 * Determines if user converts and how many steps they'll take
 * @param {number} conversionRate - Adjusted conversion rate
 * @param {number} totalSteps - Total number of steps in funnel
 * @param {Object} chance - Chance.js instance
 * @returns {Object} Object with doesUserConvert and numStepsUserWillTake
 */
function determineConversion(conversionRate, totalSteps, chance) {
	const doesUserConvert = chance.bool({ likelihood: conversionRate });
	const numStepsUserWillTake = doesUserConvert ?
		totalSteps :
		u.integer(1, totalSteps - 1);

	return { doesUserConvert, numStepsUserWillTake };
}

/**
 * Applies ordering strategy to funnel steps
 * @param {Array} steps - Funnel steps to order
 * @param {string} order - Ordering strategy
 * @param {Object} config - Configuration object
 * @param {Array} sequence - Original sequence for interrupted mode
 * @returns {Array} Ordered funnel steps
 */
function applyOrderingStrategy(steps, order, config, sequence) {
	switch (order) {
		case "sequential":
			return steps;
		case "random":
			return u.shuffleArray(steps);
		case "first-fixed":
			return u.shuffleExceptFirst(steps);
		case "last-fixed":
			return u.shuffleExceptLast(steps);
		case "first-and-last-fixed":
			return u.fixFirstAndLast(steps);
		case "middle-fixed":
			return u.shuffleOutside(steps);
		case "interrupted":
			const potentialSubstitutes = config.events
				?.filter(e => !e.isFirstEvent)
				?.filter(e => !sequence.includes(e.event)) || [];
			return u.interruptArray(steps, potentialSubstitutes);
		default:
			return steps;
	}
}

/**
 * Adds timing offsets to funnel events
 * @param {Array} events - Events to add timing to
 * @param {number} timeToConvert - Total time to convert (in hours)
 * @param {number} numSteps - Number of steps in funnel
 * @returns {Array} Events with timing information
 */
function addTimingOffsets(events, timeToConvert, numSteps) {
	const msInHour = 60000 * 60;
	let lastTimeJump = 0;

	return events.map((event, index) => {
		if (index === 0) {
			event.relativeTimeMs = 0;
			return event;
		}

		// Calculate base increment for each step
		const baseIncrement = (timeToConvert * msInHour) / numSteps;

		// Add random fluctuation
		const fluctuation = u.integer(
			-baseIncrement / u.integer(3, 5),
			baseIncrement / u.integer(3, 5)
		);

		// Ensure increasing timestamps
		const previousTime = lastTimeJump;
		const currentTime = previousTime + baseIncrement + fluctuation;
		const chosenTime = Math.max(currentTime, previousTime + 1);

		lastTimeJump = chosenTime;
		event.relativeTimeMs = chosenTime;

		return event;
	});
}

/**
 * Generates actual events with proper timing
 * @param {Context} context - Context object
 * @param {Array} eventsWithTiming - Events with timing information
 * @param {string} distinct_id - User ID
 * @param {number} earliestTime - Base timestamp
 * @param {Array} anonymousIds - Anonymous IDs
 * @param {Array} sessionIds - Session IDs
 * @param {Array} groupKeys - Group keys
 * @returns {Promise<Array>} Generated events
 */
async function generateFunnelEvents(
	context,
	eventsWithTiming,
	distinct_id,
	earliestTime,
	anonymousIds,
	sessionIds,
	groupKeys,
	featureCtx = {},
	identityArgs = null
) {
	let funnelStartTime;
	const stampingByIndex = (identityArgs && identityArgs.stampingByIndex) || null;
	const devicePool = (identityArgs && identityArgs.devicePool) || null;

	const finalEvents = await Promise.all(eventsWithTiming.map(async (event, index) => {
		const stamping = stampingByIndex ? stampingByIndex[index] : 'both';
		const identityCtx = (devicePool || stamping !== 'both') ? { stamping, devicePool } : null;
		const newEvent = await makeEvent(
			context,
			distinct_id,
			earliestTime,
			event,
			anonymousIds,
			sessionIds,
			{},
			groupKeys,
			false,  // Let all funnel events use TimeSoup for proper time distribution
			false,
			featureCtx,
			identityCtx
		);

		if (index === 0) {
			const parsedTime = dayjs(newEvent.time);
			// Validate the first event's time - if invalid, use TimeSoup-generated time as-is
			funnelStartTime = parsedTime.isValid() ? parsedTime : null;
			delete newEvent.relativeTimeMs;
			return newEvent;
		}

		// If funnelStartTime is invalid, just use the TimeSoup-generated time from makeEvent
		if (!funnelStartTime || !funnelStartTime.isValid()) {
			delete newEvent.relativeTimeMs;
			return newEvent;
		}

		try {
			let computedTime = dayjs(funnelStartTime).add(event.relativeTimeMs, "milliseconds");
			// Drop events that would land past the dataset window
			if (context.FIXED_NOW && computedTime.unix() > context.FIXED_NOW) {
				newEvent._drop = true;
			}
			if (computedTime.isValid()) {
				newEvent.time = computedTime.toISOString();
			}
			// If invalid, keep the TimeSoup-generated time from makeEvent
			delete newEvent.relativeTimeMs;
			return newEvent;
		} catch (e) {
			// Graceful fallback: keep the TimeSoup-generated time from makeEvent
			delete newEvent.relativeTimeMs;
			return newEvent;
		}
	}));

	return finalEvents;
}