/**
 * Event generator module
 * Creates individual Mixpanel events with realistic properties and timing
 */

/** @typedef {import('../../types').Dungeon} Config */
/** @typedef {import('../../types').EventConfig} EventConfig */
/** @typedef {import('../../types').ValueValid} ValueValid */
/** @typedef {import('../../types').EventSchema} EventSchema */
/** @typedef {import('../../types').Context} Context */

import dayjs from "dayjs";
import * as u from "../utils/utils.js";
import { dataLogger as logger } from "../utils/logger.js";

// Keys that must never be nulled by data quality gremlins
const NULL_EXEMPT_KEYS = new Set(['event', 'time', 'insert_id', 'user_id', 'device_id', 'distinct_id', '_drop', '_anomaly', '_persona']);

/**
 * Creates a Mixpanel event with a flat shape
 * @param {Context} context
 * @param {string} distinct_id
 * @param {number} earliestTime - Unix timestamp for earliest possible event time
 * @param {Object} chosenEvent - Event configuration object
 * @param {string[]} [anonymousIds] - Array of anonymous/device IDs
 * @param {Object} [superProps] - Super properties to add to event
 * @param {Array} [groupKeys] - Group key configurations
 * @param {boolean} [isFirstEvent]
 * @param {boolean} [skipDefaults]
 * @param {Object} [featureCtx] - Feature context (persona, worldEvents, dataQuality)
 * @param {Object} [identityCtx] - Phase 2 identity context ({ stamping, devicePool })
 * @returns {Promise<Object>}
 */
export async function makeEvent(
    context,
    distinct_id,
    earliestTime,
    chosenEvent,
    anonymousIds = [],
    superProps = {},
    groupKeys = [],
    isFirstEvent = false,
    skipDefaults = false,
    featureCtx = {},
    identityCtx = null
) {
    // Validate required parameters
    if (!distinct_id) throw new Error("no distinct_id");
    if (!earliestTime) throw new Error("no earliestTime");
    if (!chosenEvent) throw new Error("no chosenEvent");

    // Update context metrics
    context.incrementOperations();
    context.incrementEvents();

    const { config, defaults } = context;
    const chance = u.getChance();
    
    // Extract soup configuration for time distribution
    // Dynamic peaks: enough to flatten DOW interference from chunk boundaries
    const defaultPeaks = Math.max(5, (config.numDays || 30) * 2);
    const { mean = 0, deviation = 2, peaks = defaultPeaks, dayOfWeekWeights, hourOfDayWeights } = /** @type {import('../../types').SoupConfig} */ (config.soup) || {};
    
    // Extract feature flags from config
    const {
        hasAndroidDevices = false,
        hasBrowser = false,
        hasCampaigns = false,
        hasDesktopDevices = false,
        hasIOSDevices = false,
        hasLocation = false
    } = config;

    // Create base event template
    const eventTemplate = {
        event: chosenEvent.event,
        // source: "dm4",
        time: "",
        insert_id: "",
    };

    let defaultProps = {};

    // Add default properties based on configuration
    if (hasLocation) {
        defaultProps.location = u.pickRandom(defaults.locationsEvents());
    }
    
    if (hasBrowser) {
        defaultProps.browser = u.choose(defaults.browsers());
    }

    // Add campaigns with attribution likelihood.
    // When any event has isAttributionEvent, only stamp UTMs on those events (25% chance).
    // Otherwise, backwards-compat: ~25% of all events get UTMs.
    if (hasCampaigns) {
        const shouldStamp = config.hasAttributionFlags
            ? (chosenEvent.isAttributionEvent && chance.bool({ likelihood: 25 }))
            : chance.bool({ likelihood: 25 });
        if (shouldStamp) {
            defaultProps.campaigns = u.pickRandom(defaults.campaigns());
        }
    }
    
    // PERFORMANCE: Use pre-computed device pool instead of rebuilding every time
    if (defaults.allDevices.length) {
        defaultProps.device = u.pickRandom(defaults.allDevices);
    }

    // Set event time using TimeSoup for realistic distribution
    if (earliestTime) {
        let unixTime;
        if (isFirstEvent) {
            unixTime = earliestTime;
        } else {
            unixTime = u.TimeSoup(earliestTime, context.FIXED_NOW, peaks, deviation, mean, dayOfWeekWeights, hourOfDayWeights);
        }
        eventTemplate.time = dayjs.unix(unixTime).toISOString();
    }

    // ── Phase 2 identity stamping ──
    // `identityCtx.stamping` modes:
    //   "both"        → user_id + device_id (when pool non-empty). DEFAULT.
    //   "user_only"   → user_id only (post-auth funnel events).
    //   "device_only" → device_id only (pre-auth funnel events).
    //   "stitch"      → both (the one stitch event per converted born-in-dataset user).
    // Callers (funnels.js / user-loop.js) compute the mode based on the user's auth state
    // and the funnel's `isAuthEvent` placement. Default "both" preserves backwards-compat
    // for dungeons that don't flag auth events. The legacy 42%-per-event user_id dice is
    // gone — every event now gets user_id by default.
    const stamping = (identityCtx && identityCtx.stamping) || 'both';
    const wantsUser = stamping === 'both' || stamping === 'user_only' || stamping === 'stitch';
    const wantsDevice = stamping === 'both' || stamping === 'device_only' || stamping === 'stitch';
    const devicePool = (identityCtx && identityCtx.devicePool) || anonymousIds || [];

    if (wantsDevice && devicePool && devicePool.length) {
        eventTemplate.device_id = u.pickRandom(devicePool);
    }
    if (wantsUser) {
        eventTemplate.user_id = distinct_id;
    }
    // Session IDs are assigned post-hoc in user-loop.js based on temporal gaps

    // Floor: every event must carry at least one of user_id / device_id (storage layer
    // rejects events lacking both). If the stamping mode is "device_only" but there's no
    // device pool, fall back to user_id rather than producing an invalid event.
    if (!eventTemplate.user_id && !eventTemplate.device_id) {
        eventTemplate.user_id = distinct_id;
    }

    // PERFORMANCE: Process properties directly without creating intermediate object
    // Add custom properties from event configuration
    if (chosenEvent.properties) {
        const eventKeys = Object.keys(chosenEvent.properties);
        for (let i = 0; i < eventKeys.length; i++) {
            const key = eventKeys[i];
            try {
                eventTemplate[key] = u.choose(chosenEvent.properties[key]);
            } catch (e) {
                logger.error({ err: e, key, event: chosenEvent.event }, `Error processing property ${key} in ${chosenEvent.event} event`);
                // Continue processing other properties
            }
        }
    }
    
    // Add super properties (override event properties if needed)
    if (superProps) {
        const superKeys = Object.keys(superProps);
        for (let i = 0; i < superKeys.length; i++) {
            const key = superKeys[i];
            try {
                eventTemplate[key] = u.choose(superProps[key]);
            } catch (e) {
                logger.error({ err: e, key }, `Error processing super property ${key}`);
                // Continue processing other properties
            }
        }
    }

    // Add default properties if not skipped
    if (!skipDefaults) {
        addDefaultProperties(eventTemplate, defaultProps);
    }

    // Add group properties
    addGroupProperties(eventTemplate, groupKeys);

    // ── Event-level features (applied before hooks, so hooks can override) ──
    const { userLocation, persona, worldEventsTimeline, dataQuality: dq } = featureCtx;

    // Perf 1: Compute eventUnix once for all time-based checks. World events
    // were resolved against the dataset window (no shift), and event times now
    // also live in that same window — direct unix conversion works.
    let eventUnix = null;
    if (worldEventsTimeline && eventTemplate.time) {
        eventUnix = dayjs(eventTemplate.time).unix();
    }

    // Feature 2: World events — inject props for active events at this timestamp
    if (worldEventsTimeline && eventUnix !== null) {
        for (const we of worldEventsTimeline) {
            const inMainWindow = eventUnix >= we.startUnix && eventUnix < we.endUnix;
            const inAftermath = we.aftermathEndUnix && eventUnix >= we.endUnix && eventUnix < we.aftermathEndUnix;
            if (inMainWindow || inAftermath) {
                const affects = we.affectsEvents;
                if (affects === "*" || (Array.isArray(affects) && affects.includes(eventTemplate.event))) {
                    // Inject properties
                    if (we.injectProps && inMainWindow) {
                        for (const [k, v] of Object.entries(we.injectProps)) {
                            eventTemplate[k] = v;
                        }
                    }
                    // Volume modulation via accept/reject: if volumeMultiplier < 1, randomly drop
                    const volMult = inAftermath ? (we.aftermath?.volumeMultiplier || 1.0) : we.volumeMultiplier;
                    if (volMult < 1.0 && !chance.bool({ likelihood: volMult * 100 })) {
                        eventTemplate._drop = true;
                    }
                }
            }
        }
    }

    // Feature 4: Data quality — null injection and timezone confusion
    if (dq) {
        // Null injection
        if (dq.nullRate > 0) {
            const propsToNull = dq.nullProps === "*"
                ? Object.keys(eventTemplate).filter(k => !NULL_EXEMPT_KEYS.has(k))
                : (Array.isArray(dq.nullProps) ? dq.nullProps : []);
            for (const prop of propsToNull) {
                if (eventTemplate[prop] !== undefined && chance.bool({ likelihood: dq.nullRate * 100 })) {
                    eventTemplate[prop] = null;
                }
            }
        }
        // Timezone confusion
        if (dq.timezoneConfusion > 0 && chance.bool({ likelihood: dq.timezoneConfusion * 100 })) {
            const offsetHours = chance.integer({ min: -12, max: 12 });
            eventTemplate.time = dayjs(eventTemplate.time).add(offsetHours, 'hours').toISOString();
        }
        // Empty events
        if (dq.emptyEvents > 0 && chance.bool({ likelihood: dq.emptyEvents * 100 })) {
            eventTemplate.event = "";
        }
    }

    // Generate unique insert_id
	const distinctId = eventTemplate.user_id || eventTemplate.device_id || eventTemplate.distinct_id || distinct_id;
	const tuple = `${eventTemplate.event}-${eventTemplate.time}-${distinctId}`;
    eventTemplate.insert_id = u.quickHash(tuple);

    // Call hook if configured (hooks override everything — they are the final authority)
    const { hook } = config;
    if (hook) {
        const hookedEvent = await hook(eventTemplate, "event", {
            user: { distinct_id },
            config,
            persona: featureCtx.persona || null,
            datasetStart: context.DATASET_START_SECONDS,
            datasetEnd: context.DATASET_END_SECONDS
        });
        // If hook returns a modified event, use it; otherwise use original
        if (hookedEvent && typeof hookedEvent === 'object') {
            return hookedEvent;
        }
    }

    // Note: Time shift already applied above during timestamp calculation

    return eventTemplate;
}

/**
 * Adds default properties to an event template
 * Handles complex nested property structures
 * @param {Object} eventTemplate - Event object to modify
 * @param {Object} defaultProps - Default properties to add
 */
function addDefaultProperties(eventTemplate, defaultProps) {
    for (const key in defaultProps) {
        if (Array.isArray(defaultProps[key])) {
            const choice = u.choose(defaultProps[key]);
            
            if (typeof choice === "string") {
                if (!eventTemplate[key]) eventTemplate[key] = choice;
            }
            else if (Array.isArray(choice)) {
                for (const subChoice of choice) {
                    if (!eventTemplate[key]) eventTemplate[key] = subChoice;
                }
            }
            else if (typeof choice === "object") {
                addNestedObjectProperties(eventTemplate, choice);
            }
        }
        else if (typeof defaultProps[key] === "object") {
            addNestedObjectProperties(eventTemplate, defaultProps[key]);
        }
        else {
            if (!eventTemplate[key]) eventTemplate[key] = defaultProps[key];
        }
    }
}

/**
 * Adds nested object properties to event template
 * @param {Object} eventTemplate - Event object to modify
 * @param {Object} obj - Object with properties to add
 */
function addNestedObjectProperties(eventTemplate, obj) {
    for (const subKey in obj) {
        if (typeof obj[subKey] === "string") {
            if (!eventTemplate[subKey]) eventTemplate[subKey] = obj[subKey];
        }
        else if (Array.isArray(obj[subKey])) {
            const subChoice = u.choose(obj[subKey]);
            if (!eventTemplate[subKey]) eventTemplate[subKey] = subChoice;
        }
        else if (typeof obj[subKey] === "object") {
            for (const subSubKey in obj[subKey]) {
                if (!eventTemplate[subSubKey]) {
                    eventTemplate[subSubKey] = obj[subKey][subSubKey];
                }
            }
        }
    }
}

/**
 * Adds group properties to event based on group key configuration
 * @param {Object} eventTemplate - Event object to modify
 * @param {Array} groupKeys - Array of group key configurations
 */
function addGroupProperties(eventTemplate, groupKeys) {
    for (const groupPair of groupKeys) {
        const groupKey = groupPair[0];
        const groupCardinality = groupPair[1];
        const groupEvents = groupPair[2] || [];

        // Empty array for group events means all events get the group property
        if (!groupEvents.length) {
            eventTemplate[groupKey] = String(u.pick(u.weighNumRange(1, groupCardinality)));
        }

        // Only add group property if event is in the specified group events
        if (groupEvents.includes(eventTemplate.event)) {
            eventTemplate[groupKey] = String(u.pick(u.weighNumRange(1, groupCardinality)));
        }
    }
}