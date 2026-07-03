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

	// Experiment handling: resolved by config-validator into funnel._experiment.
	// Variant assignment is deterministic per-user (hash of userId + experiment name).
	let experimentVariant = null;
	let experimentName = null;
	let experimentMeta = null;

	let expCfg = funnel._experiment;
	if (!expCfg && funnel.experiment) {
		const DEFAULT_VARIANTS = [
			{ name: 'Variant A', conversionMultiplier: 0.7, ttcMultiplier: 1.5, weight: 1 },
			{ name: 'Variant B', conversionMultiplier: 1.3, ttcMultiplier: 0.7, weight: 1 },
			{ name: 'Control', conversionMultiplier: 1.0, ttcMultiplier: 1.0, weight: 1 },
		];
		expCfg = { name: (funnel.name ? funnel.name + ' Experiment' : 'Unnamed Experiment'), variants: DEFAULT_VARIANTS, startUnix: null };
	}
	if (expCfg) {
		const isActive = !expCfg.startUnix || firstEventTime >= expCfg.startUnix;
		if (isActive) {
			experimentName = expCfg.name;
			const userId = user.distinct_id || '';
			const totalWeight = expCfg.variants.reduce((s, v) => s + v.weight, 0);
			const hashVal = Number(u.quickHash(`${userId}:${experimentName}`)) % totalWeight;
			let cumWeight = 0;
			let chosenVariant = expCfg.variants[0];
			let chosenIdx = 0;
			for (let vi = 0; vi < expCfg.variants.length; vi++) {
				cumWeight += expCfg.variants[vi].weight;
				if (hashVal < cumWeight) { chosenVariant = expCfg.variants[vi]; chosenIdx = vi; break; }
			}
			experimentVariant = chosenVariant.name;
			funnel.conversionRate = Math.min(100, Math.max(1,
				Math.round((funnel.conversionRate || 50) * chosenVariant.conversionMultiplier)));
			funnel.timeToConvert = Math.max(0.1,
				(funnel.timeToConvert || 1) * chosenVariant.ttcMultiplier);
			funnel._experimentName = experimentName;
			funnel._experimentVariant = experimentVariant;
			funnel.sequence = ["$experiment_started", ...funnel.sequence];
			experimentMeta = {
				name: experimentName,
				variantName: experimentVariant,
				variantIndex: chosenIdx,
				conversionMultiplier: chosenVariant.conversionMultiplier,
				ttcMultiplier: chosenVariant.ttcMultiplier,
				startDate: expCfg.startUnix,
			};
		}
	}

	// Apply persona and world-event modifiers to the funnel BEFORE the hook fires,
	// so funnel-pre sees the effective rate and has final authority.
	if (persona && persona.conversionModifier) {
		funnel.conversionRate = Math.min(100, Math.max(0, Math.round((funnel.conversionRate || 50) * persona.conversionModifier)));
	}
	const resolvedWorldEvents = /** @type {import('../../types').ResolvedWorldEvent[]} */ (config.worldEvents);
	if (resolvedWorldEvents && firstEventTime) {
		for (const we of resolvedWorldEvents) {
			if (firstEventTime >= we.startUnix && firstEventTime < we.endUnix && we.conversionModifier !== 1.0) {
				const seq = funnel.sequence || [];
				const affects = we.affectsEvents;
				if (affects === "*" || (Array.isArray(affects) && seq.some(s => affects.includes(s)))) {
					funnel.conversionRate = Math.min(100, Math.max(0, Math.round((funnel.conversionRate || 50) * we.conversionModifier)));
				}
			}
		}
	}

	// funnel-pre hook fires AFTER modifiers — hook has final authority on conversionRate,
	// props, timeToConvert, and sequence.
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
		persona,
		experiment: experimentMeta,
	});

	// Extract funnel configuration (post-hook — hook's mutations are the final word)
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

	const { distinct_id, created, anonymousIds = [] } = user;
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

	// Apply ordering strategy. When experiment mode prepended $experiment_started,
	// shuffle only the real funnel steps: the exposure event must precede every
	// step it governs (Mixpanel experiment semantics — variant lift is measured
	// exposure → outcome), and strategies like first-fixed should pin the true
	// first step, not the synthetic exposure marker. Pre-v1.6 the whole array was
	// shuffled, which landed $experiment_started mid-funnel for non-sequential
	// orders and truncated the measured exposure→conversion TTC.
	let funnelActualOrder;
	if (expName && funnelStepsUserWillTake.length > 1) {
		const [exposureEvent, ...realSteps] = funnelStepsUserWillTake;
		funnelActualOrder = [exposureEvent, ...applyOrderingStrategy(realSteps, order, config, sequence)];
	} else {
		funnelActualOrder = applyOrderingStrategy(
			funnelStepsUserWillTake,
			order,
			config,
			sequence
		);
	}

	// Add timing offsets to events
	const funnelEventsWithTiming = addTimingOffsets(
		funnelActualOrder,
		timeToConvert,
		numStepsUserWillTake
	);

	// v1.5: cap the funnel's total span at conversionWindowDays * 86400000 - 1 ms
	// (1ms slack to clear Mixpanel's strict-`<` boundary in conversion_window.cpp).
	// When a funnel's `timeToConvert` would push the last step past the window, scale
	// all relative offsets proportionally to fit. Validator already auto-bumped
	// `conversionWindowDays` for long-TTC funnels, so this rarely fires — but it
	// makes the contract explicit at generation time.
	const conversionWindowDays = funnel.conversionWindowDays;
	if (Number.isFinite(conversionWindowDays) && conversionWindowDays > 0 && funnelEventsWithTiming.length > 1) {
		const maxSpanMs = conversionWindowDays * 86400000 - 1;
		const lastEvent = funnelEventsWithTiming[funnelEventsWithTiming.length - 1];
		if (Number.isFinite(lastEvent.relativeTimeMs) && lastEvent.relativeTimeMs > maxSpanMs) {
			const scale = maxSpanMs / lastEvent.relativeTimeMs;
			for (let i = 1; i < funnelEventsWithTiming.length; i++) {
				if (Number.isFinite(funnelEventsWithTiming[i].relativeTimeMs)) {
					funnelEventsWithTiming[i].relativeTimeMs = Math.floor(funnelEventsWithTiming[i].relativeTimeMs * scale);
				}
			}
		}
	}

	// Add session start event if configured (clone to avoid mutating shared config)
	if (sessionStartEvents.length) {
		const sessionStartEvent = { ...chance.pickone(sessionStartEvents), relativeTimeMs: -15000 };
		funnelEventsWithTiming.push(sessionStartEvent);
	}

	// Build complete feature context: merge passed-in featureCtx with config fallbacks.
	// v1.5: preserve `latestTime` if active-day mode is in effect, so makeEvent's
	// TimeSoup constrains the funnel's first event to the picked day.
	const funnelFeatureCtx = {
		persona: featureCtx.persona || persona || null,
		userCampaign: featureCtx.userCampaign || null,
		userLocation: featureCtx.userLocation || null,
		worldEventsTimeline: featureCtx.worldEventsTimeline || context.config.worldEvents || null,
		dataQuality: featureCtx.dataQuality || context.config.dataQuality || null,
		latestTime: Number.isFinite(featureCtx.latestTime) ? featureCtx.latestTime : undefined,
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

	// $experiment_started is a synthetic experiment-assignment marker, NOT a real
	// pre-auth UI event. Mixpanel keys experiment exposure on the user (distinct_id),
	// so it must carry user_id even when prepended to an isFirstFunnel (born-in,
	// pre-auth) sequence — otherwise the exposure is device-only and shows zero
	// users in experiment reports. Force `both` regardless of auth position.
	if (expName) {
		for (let i = 0; i < funnelEventsWithTiming.length; i++) {
			if (funnelEventsWithTiming[i].event === "$experiment_started") stampingByIndex[i] = 'both';
		}
	}

	// Generate actual events with timing
	const finalEvents = await generateFunnelEvents(
		context,
		funnelEventsWithTiming,
		distinct_id,
		firstEventTime || dayjs(created).unix(),
		anonymousIds,
		groupKeys,
		funnelFeatureCtx,
		{ devicePool, stampingByIndex }
	);

	// Compute the auth-time of the actual stitch event in execution order, if any.
	// Skip when the stitch event itself is _drop'd (e.g. born-late users whose auth
	// event lands past FIXED_NOW and gets filtered out): the user has no real auth
	// event, so userAuthTimeMs must stay null to keep downstream stamping consistent.
	const authTimeMs = runAuthExecIdx >= 0 && finalEvents[runAuthExecIdx] && !finalEvents[runAuthExecIdx]._drop
		? Date.parse(finalEvents[runAuthExecIdx].time) || null
		: null;

	// v1.5.0: inject exclusion events for non-converters. When `funnel.exclusionEvents`
	// is set and the user dropped off mid-funnel (≥1 step completed but < sequence.length),
	// stamp 1-2 cloned events bearing one of the listed exclusion event names between the
	// last completed step and where the next step would have been. The verifier reads
	// `funnel.exclusionEvents` and applies them as exclusionSteps to terminate the attempt.
	//
	// Schema-first: copy ONLY identity + super props + group keys from the source event,
	// plus props declared on the exclusion event's own config. Source-event-specific
	// props (e.g. `cart_value` on `Add to Cart`) MUST NOT bleed onto a different event
	// type or the schema validator will flag undeclared columns.
	if (Array.isArray(funnel.exclusionEvents) && funnel.exclusionEvents.length
		&& !doesUserConvert && finalEvents.length > 0 && finalEvents.length < sequence.length) {
		const lastEvent = finalEvents[finalEvents.length - 1];
		const lastTimeMs = Date.parse(lastEvent.time);
		if (Number.isFinite(lastTimeMs)) {
			const IDENTITY_KEYS = ['user_id', 'device_id', 'distinct_id', 'session_id', 'insert_id'];
			const superPropKeys = Object.keys(superProps || {});
			const groupKeyNames = (groupKeys || []).map(gk => Array.isArray(gk) ? gk[0] : gk).filter(Boolean);
			const numToInject = chance.integer({ min: 1, max: 2 });
			for (let i = 0; i < numToInject; i++) {
				const excName = chance.pickone(funnel.exclusionEvents);
				const excConfig = (config.events || []).find(e => e.event === excName);
				const offsetMs = (i + 1) * chance.integer({ min: 30_000, max: 300_000 });
				const cloned = {
					event: excName,
					time: new Date(lastTimeMs + offsetMs).toISOString(),
				};
				// Identity from source event (correct user/device/session attribution).
				for (const k of IDENTITY_KEYS) {
					if (k in lastEvent) cloned[k] = lastEvent[k];
				}
				// Super props + group keys carry over (user-stable values).
				for (const k of superPropKeys) if (k in lastEvent) cloned[k] = lastEvent[k];
				for (const k of groupKeyNames) if (k in lastEvent) cloned[k] = lastEvent[k];
				// Resolve declared props on the exclusion event's config.
				if (excConfig && excConfig.properties) {
					for (const k of Object.keys(excConfig.properties)) {
						try { cloned[k] = u.choose(excConfig.properties[k]); }
						catch (e) { cloned[k] = null; }
					}
				}
				// Fresh insert_id so the new event isn't a duplicate of the source.
				cloned.insert_id = `${excName}-${cloned.time}-${chance.string({ length: 10, alpha: true })}`;
				finalEvents.push(cloned);
			}
		}
	}

	// Call post-funnel hook
	await hook(finalEvents, "funnel-post", {
		user, profile, scd, funnel, config,
		firstEventTime,
		datasetStart: context.DATASET_START_SECONDS,
		datasetEnd: context.DATASET_END_SECONDS,
		isFirstFunnel: attemptInfo.isFirstFunnel,
		isBorn: attemptInfo.isBorn,
		attemptsConfig: attemptInfo.attemptsConfig,
		attemptNumber: attemptInfo.attemptNumber,
		totalAttempts: attemptInfo.totalAttempts,
		isFinalAttempt: attemptInfo.isFinalAttempt,
		persona,
		experiment: experimentMeta,
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
 * @param {Context} context
 * @param {Array} eventsWithTiming
 * @param {string} distinct_id
 * @param {number} earliestTime
 * @param {Array} anonymousIds
 * @param {Array} groupKeys
 * @param {Object} [featureCtx] - Feature context (persona, worldEvents, dataQuality)
 * @param {Object} [identityArgs] - Phase 2 identity args ({ stampingByIndex, devicePool })
 * @returns {Promise<Array>}
 */
async function generateFunnelEvents(
	context,
	eventsWithTiming,
	distinct_id,
	earliestTime,
	anonymousIds,
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
			{},
			groupKeys,
			false,
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