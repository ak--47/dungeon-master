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
 * @param {Context} context - Context object containing config, defaults, etc.
 * @param {string} distinct_id - User identifier
 * @param {number} earliestTime - Unix timestamp for earliest possible event time
 * @param {Object} chosenEvent - Event configuration object
 * @param {string[]} [anonymousIds] - Array of anonymous/device IDs
 * @param {string[]} [sessionIds] - Array of session IDs
 * @param {Object} [superProps] - Super properties to add to event
 * @param {Array} [groupKeys] - Group key configurations
 * @param {boolean} [isFirstEvent] - Whether this is the user's first event
 * @param {boolean} [skipDefaults] - Whether to skip adding default properties
 * @returns {Promise<Object>} Generated event object
 */
export async function makeEvent(
    context,
    distinct_id,
    earliestTime,
    chosenEvent,
    anonymousIds = [],
    sessionIds = [],
    superProps = {},
    groupKeys = [],
    isFirstEvent = false,
    skipDefaults = false,
    featureCtx = {}
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

    // Add campaigns with attribution likelihood
    if (hasCampaigns && chance.bool({ likelihood: 25 })) {
        defaultProps.campaigns = u.pickRandom(defaults.campaigns());
    }
    
    // PERFORMANCE: Use pre-computed device pool instead of rebuilding every time
    if (defaults.allDevices.length) {
        defaultProps.device = u.pickRandom(defaults.allDevices);
    }

    // Set event time using TimeSoup for realistic distribution
    if (earliestTime) {
        let shiftedTimestamp;
        if (isFirstEvent) {
            shiftedTimestamp = earliestTime + context.TIME_SHIFT_SECONDS;
        } else {
            // TimeSoup returns unix seconds; shift and convert to ISO once
            const soupTimestamp = u.TimeSoup(earliestTime, context.FIXED_NOW, peaks, deviation, mean, dayOfWeekWeights, hourOfDayWeights, context.TIME_SHIFT_SECONDS);
            shiftedTimestamp = soupTimestamp + context.TIME_SHIFT_SECONDS;
        }
        // Drop events that would land in the future (Mixpanel rewrites these to "now", causing pile-ups)
        if (shiftedTimestamp > context.MAX_TIME) {
            eventTemplate._drop = true;
        }
        eventTemplate.time = dayjs.unix(Math.min(shiftedTimestamp, context.MAX_TIME)).toISOString();
    }

    // Add anonymous and session identifiers
    if (anonymousIds.length) {
        eventTemplate.device_id = u.pickRandom(anonymousIds);
    }
    
    if (sessionIds.length) {
        eventTemplate.session_id = u.pickRandom(sessionIds);
    }

    // Sometimes add user_id (for attribution modeling)
    if (!isFirstEvent && chance.bool({ likelihood: 42 })) {
        eventTemplate.user_id = distinct_id;
    }

    // Ensure we have either user_id or device_id
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
    const { userLocation, persona, worldEventsTimeline, resolvedFeatures, resolvedAnomalies, dataQuality: dq, geo: geoConfig, userCampaign } = featureCtx;

    // Feature 6: Attribution — stamp UTM properties on events as touchpoints
    // Mixpanel attribution analysis needs UTM on EVENTS, not just profiles.
    // Pattern: first events carry acquisition UTM, later events occasionally carry re-engagement UTM.
    if (userCampaign) {
        // ~40% of events carry UTM (simulates page loads, session starts, ad clicks)
        // First events (isFirstEvent) always carry UTM (acquisition touchpoint)
        if (isFirstEvent || chance.bool({ likelihood: 40 })) {
            eventTemplate.utm_source = userCampaign.source;
            eventTemplate.utm_campaign = userCampaign.name;
            if (userCampaign.medium) eventTemplate.utm_medium = userCampaign.medium;
            if (userCampaign.utm_content) eventTemplate.utm_content = userCampaign.utm_content;
            if (userCampaign.utm_term) eventTemplate.utm_term = userCampaign.utm_term;
        }
    }

    // Feature 7: Sticky geo location
    if (userLocation && geoConfig?.sticky) {
        // Override the random location with user's sticky location
        for (const key in userLocation) {
            eventTemplate[key] = userLocation[key];
        }
    }

    // Perf 1: Compute eventUnix once for all time-based checks
    // Subtracts TIME_SHIFT to convert real time back to FIXED time (world events/features use FIXED time)
    let eventUnix = null;
    if ((worldEventsTimeline || resolvedFeatures) && eventTemplate.time) {
        eventUnix = dayjs(eventTemplate.time).subtract(context.TIME_SHIFT_SECONDS, 'seconds').unix();
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

    // Feature 8: Progressive feature adoption
    if (resolvedFeatures && eventUnix !== null) {
        const daysSinceBegin = (eventUnix - global.FIXED_BEGIN) / 86400;
        for (const feat of resolvedFeatures) {
            const affects = feat.affectsEvents;
            if (affects !== "*" && !(Array.isArray(affects) && affects.includes(eventTemplate.event))) continue;
            if (daysSinceBegin < feat.launchDay) {
                if (feat.defaultBefore !== undefined) {
                    eventTemplate[feat.property] = feat.defaultBefore;
                }
            } else {
                const daysSinceLaunch = daysSinceBegin - feat.launchDay;
                const { k, midpoint } = feat._resolvedCurve;
                const adoptionProb = 1 / (1 + Math.exp(-k * (daysSinceLaunch - midpoint)));
                if (chance.bool({ likelihood: Math.min(100, adoptionProb * 100) })) {
                    eventTemplate[feat.property] = u.pickRandom(feat._adoptedValues);
                } else if (feat.defaultBefore !== undefined) {
                    eventTemplate[feat.property] = feat.defaultBefore;
                } else if (feat.values.length > 0) {
                    eventTemplate[feat.property] = feat.values[0];
                }
            }
        }
    }

    // Feature 9: Anomaly extreme values
    if (resolvedAnomalies && eventTemplate.event) {
        for (const a of resolvedAnomalies) {
            if (a.type === 'extreme_value' && a.event === eventTemplate.event && a.property) {
                if (chance.bool({ likelihood: (a.frequency || 0.001) * 100 })) {
                    const currentVal = eventTemplate[a.property];
                    if (typeof currentVal === 'number') {
                        eventTemplate[a.property] = currentVal * (a.multiplier || 10);
                    }
                    if (a.tag) eventTemplate._anomaly = a.tag;
                    if (a.properties) Object.assign(eventTemplate, a.properties);
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
            persona: featureCtx.persona || null
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