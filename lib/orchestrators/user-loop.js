/**
 * User Loop Orchestrator module
 * Manages user generation and event creation workflow
 */

/** @typedef {import('../../types').Context} Context */

import dayjs from "dayjs";
import pLimit from 'p-limit';
import os from 'os';
import * as u from "../utils/utils.js";
import * as t from 'ak-tools';
import { makeEvent } from "../generators/events.js";
import { makeFunnel } from "../generators/funnels.js";
import { makeUserProfile } from "../generators/profiles.js";
import { makeSCD } from "../generators/scd.js";

/**
 * Main user generation loop that creates users, their profiles, events, and SCDs
 * @param {Context} context - Context object containing config, defaults, storage, etc.
 * @returns {Promise<void>}
 */
export async function userLoop(context) {
	const { config, storage, defaults } = context;
	const chance = u.getChance();
	const concurrency = config?.concurrency ?? 1;
	const USER_CONN = pLimit(concurrency);

	const {
		verbose,
		numUsers,
		numEvents,
		isAnonymous,
		hasAvatar,
		hasAnonIds,
		hasSessionIds,
		hasLocation,
		funnels,
		userProps,
		scdProps,
		numDays,
		percentUsersBornInDataset = 15,
		strictEventCount = false,
		bornRecentBias = 0.3, // 0 = uniform distribution, 1 = heavily biased toward recent births
		personas,
		worldEvents,
		engagementDecay: globalEngagementDecay,
		dataQuality,
		subscription,
		attribution,
		geo,
		features,
		anomalies
	} = config;

	const { eventData, userProfilesData, scdTableData } = storage;
	const avgEvPerUser = numEvents / numUsers;
	const startTime = Date.now();

	// Create batches for parallel processing
	const batchSize = Math.max(1, Math.ceil(numUsers / concurrency));
	const userPromises = [];

	// Track if we've already logged the strict event count message
	let hasLoggedStrictCountReached = false;

	// Handle graceful shutdown on SIGINT (Ctrl+C)
	let cancelled = false;
	const onSigint = () => {
		cancelled = true;
		USER_CONN.clearQueue();
		if (verbose) console.log(`\n\nStopping generation (Ctrl+C)...\n`);
	};
	process.on('SIGINT', onSigint);

	for (let i = 0; i < numUsers; i++) {
		const userPromise = USER_CONN(async () => {
			// Bail out if cancelled
			if (cancelled) return;

			// Bail out early if strictEventCount is enabled and we've hit numEvents
			if (strictEventCount && context.getEventCount() >= numEvents) {
				if (verbose && !hasLoggedStrictCountReached) {
					console.log(`\n\u2713 Reached target of ${numEvents.toLocaleString()} events with strict event count enabled. Stopping user generation.`);
					hasLoggedStrictCountReached = true;
				}
				return;
			}

			context.incrementUserCount();
			const eps = Math.floor(context.getEventCount() / ((Date.now() - startTime) / 1000));
			const memUsed = u.bytesHuman(process.memoryUsage().heapUsed);
			const duration = u.formatDuration(Date.now() - startTime);

			if (verbose) {
				u.progress([
					["users", context.getUserCount()],
					["events", context.getEventCount()],
					["eps", eps],
					["mem", memUsed],
					["time", duration]
				]);
			}

			const userId = chance.guid();
			const user = u.generateUser(userId, { numDays, isAnonymous, hasAvatar, hasAnonIds, hasSessionIds });
			const { distinct_id, created } = user;
			const userIsBornInDataset = chance.bool({ likelihood: percentUsersBornInDataset });

			// Feature 1: Assign persona
			let persona = null;
			if (personas && personas.length > 0) {
				const weights = personas.map(p => p.weight);
				const totalWeight = weights.reduce((a, b) => a + b, 0);
				let roll = chance.floating({ min: 0, max: totalWeight });
				for (const p of personas) {
					roll -= p.weight;
					if (roll <= 0) { persona = p; break; }
				}
				if (!persona) persona = personas[personas.length - 1];
			}
			let numEventsPreformed = 0;

			if (!userIsBornInDataset) delete user.created;

			// Calculate time adjustments
			const daysShift = context.getDaysShift();

			// Apply recency bias to birth dates for users born in dataset
			// bornRecentBias: 0 = uniform distribution, 1 = heavily biased toward recent
			let adjustedCreated;
			if (userIsBornInDataset) {
				let biasedCreated = dayjs(created).subtract(daysShift, 'd');

				if (bornRecentBias !== 0) {
					// Calculate how far into the dataset this user was born (0 = start, 1 = end/recent)
					const datasetStart = dayjs.unix(context.FIXED_BEGIN);
					const datasetEnd = dayjs.unix(context.FIXED_NOW);
					const totalDuration = datasetEnd.diff(datasetStart);
					// Clamp userPosition to [0, 1] to handle edge cases from rounding in time calculations
					const userPosition = Math.max(0, Math.min(1, biasedCreated.diff(datasetStart) / totalDuration));

					let biasedPosition;
					if (bornRecentBias > 0) {
						// Positive bias: exponent < 1 shifts distribution toward 1 (recent)
						const exponent = 1 - (bornRecentBias * 0.7); // 0.3 bias -> 0.79 exponent (gentle nudge)
						biasedPosition = Math.pow(userPosition, exponent);
					} else {
						// Negative bias: mirror the power function to shift toward 0 (early)
						// -0.3 bias -> 0.79 exponent applied to (1 - position), then mirrored back
						const exponent = 1 - (Math.abs(bornRecentBias) * 0.7);
						biasedPosition = 1 - Math.pow(1 - userPosition, exponent);
					}

					// Convert back to timestamp
					biasedCreated = datasetStart.add(biasedPosition * totalDuration, 'millisecond');
				}

				adjustedCreated = biasedCreated;
				// Update user.created to match biased timestamp for profile consistency
				user.created = adjustedCreated.toISOString();
			} else {
				adjustedCreated = dayjs.unix(context.FIXED_BEGIN);
			}

			// Feature 7: Geographic intelligence — assign sticky location
			let userLocation = null;
			let userRegion = null;
			let userTimezoneOffset = 0;
			if (geo && geo.sticky && geo.regions && geo.regions.length > 0) {
				// Assign region using weighted selection
				const regionWeights = geo.regions.map(r => r.weight);
				const totalRegionWeight = regionWeights.reduce((a, b) => a + b, 0);
				let regionRoll = chance.floating({ min: 0, max: totalRegionWeight });
				for (const r of geo.regions) {
					regionRoll -= r.weight;
					if (regionRoll <= 0) { userRegion = r; break; }
				}
				if (!userRegion) userRegion = geo.regions[geo.regions.length - 1];
				userTimezoneOffset = userRegion.timezoneOffset || 0;

				// Pick a location matching one of this region's countries
				const regionLocations = u.choose(defaults.locationsUsers).filter(
					loc => userRegion.countries.includes(loc.country_code || loc.country)
				);
				if (regionLocations.length > 0) {
					userLocation = u.pickRandom(regionLocations);
				} else {
					userLocation = u.pickRandom(u.choose(defaults.locationsUsers));
				}
				for (const key in userLocation) {
					user[key] = userLocation[key];
				}
				// Inject region properties
				if (userRegion.properties) {
					for (const [k, v] of Object.entries(userRegion.properties)) {
						user[k] = v;
					}
				}
			} else if (hasLocation) {
				const location = u.pickRandom(u.choose(defaults.locationsUsers));
				for (const key in location) {
					user[key] = location[key];
				}
				userLocation = location;
			}

			// Feature 6: Attribution — assign campaign to users born in dataset
			let userCampaign = null;
			if (attribution && userIsBornInDataset) {
				// adjustedCreated is in the internal FIXED time range
				const birthUnix = adjustedCreated.unix();
				const birthDay = Math.max(0, (birthUnix - context.FIXED_BEGIN) / 86400);
				const isOrganic = chance.bool({ likelihood: (attribution.organicRate || 0.4) * 100 });
				if (!isOrganic) {
					// Find active campaigns at birth day
					const activeCampaigns = attribution.campaigns.filter(c =>
						birthDay >= c.activeDays[0] && birthDay <= c.activeDays[1]
					);
					if (activeCampaigns.length > 0) {
						userCampaign = chance.pickone(activeCampaigns);
					}
				}
			}

			// Profile creation
			const profile = await makeUserProfile(context, userProps, user);

			// Feature 1: Merge persona properties into profile (before hook, so hook can override)
			if (persona && persona.properties) {
				for (const [key, value] of Object.entries(persona.properties)) {
					profile[key] = u.choose(value);
				}
				profile._persona = persona.name;
			}

			// Feature 6: Add attribution to profile
			if (userCampaign) {
				profile.utm_source = userCampaign.source;
				profile.utm_campaign = userCampaign.name;
				if (userCampaign.medium) profile.utm_medium = userCampaign.medium;
			}

			// Feature 7: Add region to profile
			if (userRegion) {
				profile._region = userRegion.name;
			}

			// Build feature context for event generation
			const featureCtx = {
				persona,
				userLocation,
				worldEventsTimeline: worldEvents,
				resolvedFeatures: features,
				resolvedAnomalies: anomalies,
				dataQuality,
				geo,
				userCampaign,
				userRegion,
				userTimezoneOffset
			};

			// Call user hook after profile creation (hooks override persona properties)
			if (config.hook) {
				await config.hook(profile, "user", {
					user,
					config,
					userIsBornInDataset,
					persona
				});
			}

			// SCD creation
			// @ts-ignore
			const scdUserTables = t.objFilter(scdProps, (scd) => scd.type === 'user' || !scd.type);
			const scdTableKeys = Object.keys(scdUserTables);

			const userSCD = {};
			for (const [index, key] of scdTableKeys.entries()) {
				const { max = 10 } = scdProps[key];
				const mutations = chance.integer({ min: 1, max });
				let changes = await makeSCD(context, scdProps[key], key, distinct_id, mutations, created);
				userSCD[key] = changes;

				if (config.hook) {
					const hookResult = await config.hook(changes, "scd-pre", {
						profile,
						type: 'user',
						scd: { [key]: scdProps[key] },
						config,
						allSCDs: userSCD
					});
					if (Array.isArray(hookResult)) {
						changes = hookResult;
						userSCD[key] = changes;
					}
				}
			}

			let numEventsThisUserWillPreform = Math.floor(chance.normal({
				mean: avgEvPerUser,
				dev: avgEvPerUser / u.integer(u.integer(2, 5), u.integer(2, 7))
			}) * 0.714159265359);

			// Power users and low-activity users logic
			if (persona) {
				// Persona-driven event multiplier replaces the old dice rolls
				numEventsThisUserWillPreform *= persona.eventMultiplier;
			} else {
				// Legacy behavior when no personas configured
				chance.bool({ likelihood: 20 }) ? numEventsThisUserWillPreform *= 5 : null;
				chance.bool({ likelihood: 15 }) ? numEventsThisUserWillPreform *= 0.333 : null;
			}
			numEventsThisUserWillPreform = Math.round(numEventsThisUserWillPreform);

			let userFirstEventTime;

			const firstFunnels = funnels.filter((f) => f.isFirstFunnel)
				.filter((f) => !f.conditions || matchConditions(profile, f.conditions))
				.reduce(weighFunnels, []);
			const usageFunnels = funnels.filter((f) => !f.isFirstFunnel)
				.filter((f) => !f.conditions || matchConditions(profile, f.conditions))
				.reduce(weighFunnels, []);

			const secondsInDay = 86400;
			const noise = () => chance.integer({ min: 0, max: secondsInDay });
			let usersEvents = [];
			let userConverted = true;

			// Pre-compute weighted events array for standalone event selection
			const weightedEvents = config.events.reduce((acc, event) => {
				const w = Math.max(1, Math.min(Math.floor(event.weight) || 1, 10));
				for (let i = 0; i < w; i++) acc.push(event);
				return acc;
			}, []);

			// Build churn event lookup: { eventName: returnLikelihood }
			const churnEvents = new Map();
			for (const ev of config.events) {
				if (ev.isChurnEvent) {
					churnEvents.set(ev.event, ev.returnLikelihood ?? 0);
				}
			}

			// PATH FOR USERS BORN IN DATASET AND PERFORMING FIRST FUNNEL
			if (firstFunnels.length && userIsBornInDataset) {
				const firstFunnel = chance.pickone(firstFunnels, user);
				const firstTime = adjustedCreated.subtract(noise(), 'seconds').unix();
				const [data, converted] = await makeFunnel(context, firstFunnel, user, firstTime, profile, userSCD, persona, featureCtx);
				userConverted = converted;

				const timeShift = context.getTimeShift();
				userFirstEventTime = dayjs(data[0].time).subtract(timeShift, 'seconds').unix();
				numEventsPreformed += data.length;
				usersEvents = usersEvents.concat(data);
			} else {
				userFirstEventTime = adjustedCreated.subtract(noise(), 'seconds').unix();
			}

			// ALL SUBSEQUENT EVENTS (funnels for converted users, standalone for all)
			let userChurned = false;
			while (numEventsPreformed < numEventsThisUserWillPreform && !cancelled) {
				let newEvents;
				if (usageFunnels.length && userConverted) {
					const currentFunnel = chance.pickone(usageFunnels);
					const [data, converted] = await makeFunnel(context, currentFunnel, user, userFirstEventTime, profile, userSCD, persona, featureCtx);
					numEventsPreformed += data.length;
					newEvents = data;
				} else {
					const data = await makeEvent(context, distinct_id, userFirstEventTime, u.pick(weightedEvents), user.anonymousIds, user.sessionIds, {}, config.groupKeys, true, false, featureCtx);
					numEventsPreformed++;
					newEvents = [data];
				}
				usersEvents = usersEvents.concat(newEvents);

				// Check for churn events — if user churned, they may stop generating
				if (churnEvents.size > 0) {
					const eventsToCheck = Array.isArray(newEvents[0]) ? newEvents.flat() : newEvents;
					for (const ev of eventsToCheck) {
						if (ev.event && churnEvents.has(ev.event)) {
							const returnLikelihood = churnEvents.get(ev.event);
							const userReturns = returnLikelihood > 0 && chance.bool({ likelihood: returnLikelihood * 100 });
							if (!userReturns) {
								userChurned = true;
								break;
							}
						}
					}
					if (userChurned) break;
				}
			}

			// Remove events flagged as future timestamps (before dungeon hooks see them)
			usersEvents = usersEvents.filter(e => !e._drop);

			// Feature 3: Engagement decay — filter behavioral events BEFORE subscription injection
			// Subscription events (trial, upgrade, cancel) must not be randomly dropped by decay
			const userDecay = persona?.engagementDecay || globalEngagementDecay;
			if (userDecay && userDecay.model !== 'none' && usersEvents.length > 0) {
				// adjustedCreated is in FIXED time space, but ev.time is in PRESENT time (shifted).
				// Shift adjustedCreated to present so daysSinceBirth reflects within-dataset age.
				const adjustedCreatedPresent = adjustedCreated.add(context.TIME_SHIFT_SECONDS, 'seconds');
				usersEvents = applyEngagementDecay(usersEvents, userDecay, adjustedCreatedPresent, context, chance);
			}

			// Feature 5: Subscription lifecycle — inject after decay (exempt from decay filtering)
			if (subscription && userIsBornInDataset) {
				const subEvents = generateSubscriptionEvents(
					subscription, user, persona, adjustedCreated, context, chance
				);
				if (subEvents.length > 0) {
					usersEvents = usersEvents.concat(subEvents);
					// Perf 3: ISO strings sort lexicographically — avoid Date() allocation
					usersEvents.sort((a, b) => a.time < b.time ? -1 : a.time > b.time ? 1 : 0);
				}
				// Set current plan on profile
				if (subEvents.length > 0) {
					const lastSubEvent = subEvents[subEvents.length - 1];
					if (lastSubEvent._currentPlan) {
						profile.subscription_plan = lastSubEvent._currentPlan;
						profile.subscription_status = lastSubEvent._subStatus || 'active';
					}
				}
			}

			// Feature 4: Data quality — duplicates and late-arriving
			if (dataQuality) {
				if (dataQuality.duplicateRate > 0) {
					const dupes = [];
					for (const ev of usersEvents) {
						if (chance.bool({ likelihood: dataQuality.duplicateRate * 100 })) {
							const dupe = { ...ev };
							dupe.time = dayjs(ev.time).add(chance.integer({ min: 1, max: 60 }), 'seconds').toISOString();
							// Fix 2: Regenerate insert_id so Mixpanel doesn't silently deduplicate
							const dupeId = dupe.user_id || dupe.device_id || '';
							dupe.insert_id = u.quickHash(`${dupe.event}-${dupe.time}-${dupeId}-dupe`);
							dupes.push(dupe);
						}
					}
					usersEvents = usersEvents.concat(dupes);
				}
				if (dataQuality.lateArrivingRate > 0) {
					for (const ev of usersEvents) {
						if (chance.bool({ likelihood: dataQuality.lateArrivingRate * 100 })) {
							ev.time = dayjs(ev.time).subtract(chance.integer({ min: 1, max: 7 }), 'days').toISOString();
						}
					}
				}
			}

			// Hook for processing all user events (hooks override everything)
			if (config.hook) {
				const newEvents = await config.hook(usersEvents, "everything", {
					profile,
					scd: userSCD,
					config,
					userIsBornInDataset,
					persona
				});
				if (Array.isArray(newEvents)) usersEvents = newEvents;
			}

			// Store all user data
			await userProfilesData.hookPush(profile);

			if (Object.keys(userSCD).length) {
				for (const [key, changesArray] of Object.entries(userSCD)) {
					for (const changes of changesArray) {
						try {
							const target = scdTableData.filter(arr => arr.scdKey === key).pop();
							await target.hookPush(changes, { profile, type: 'user' });
						}
						catch (e) {
							// This is probably a test
							const target = scdTableData[0];
							await target.hookPush(changes, { profile, type: 'user' });
						}
					}
				}
			}

			await eventData.hookPush(usersEvents, { profile });
		});

		userPromises.push(userPromise);
	}

	// Wait for all users to complete
	await Promise.all(userPromises);

	// Feature 4: Generate bot users (after regular users)
	if (dataQuality && dataQuality.botUsers > 0) {
		await generateBotUsers(context, dataQuality, storage);
	}

	// Feature 9: Anomaly burst/coordinated injection (after all users)
	if (anomalies) {
		await generateAnomalyBursts(context, anomalies, storage);
	}

	// Clean up SIGINT handler
	process.removeListener('SIGINT', onSigint);
}


export function weighFunnels(acc, funnel) {
	const weight = funnel?.weight || 1;
	for (let i = 0; i < weight; i++) {
		acc.push(funnel);
	}
	return acc;
}

export function matchConditions(profile, conditions) {
	for (const [key, value] of Object.entries(conditions)) {
		if (profile[key] !== value) return false;
	}
	return true;
}

// ── Advanced Feature Helper Functions ──

/**
 * Feature 3: Apply engagement decay to a user's events
 */
function applyEngagementDecay(events, decay, userCreated, context, chance) {
	if (!events.length) return events;
	// Perf 2: Use Date.parse instead of dayjs for hot loop
	const userStartUnix = new Date(userCreated.toISOString ? userCreated.toISOString() : userCreated).getTime() / 1000;
	const halfLifeDays = decay.halfLife || 45;
	const floor = decay.floor ?? 0.1;
	const reactivationChance = decay.reactivationChance || 0;
	const reactivationMult = decay.reactivationMultiplier || 2.0;

	return events.filter(ev => {
		const evUnix = new Date(ev.time).getTime() / 1000;
		const daysSinceBirth = Math.max(0, (evUnix - userStartUnix) / 86400);

		let retention;
		switch (decay.model) {
			case 'exponential':
				retention = Math.max(floor, Math.pow(0.5, daysSinceBirth / halfLifeDays));
				break;
			case 'linear':
				retention = Math.max(floor, 1 - (daysSinceBirth / (halfLifeDays * 2)));
				break;
			case 'step':
				retention = daysSinceBirth < halfLifeDays ? 1.0 : floor;
				break;
			default:
				return true;
		}

		// Reactivation chance can spike retention back up
		if (reactivationChance > 0 && retention < 0.5 && chance.bool({ likelihood: reactivationChance * 100 })) {
			retention = Math.min(1.0, retention * reactivationMult);
		}

		return chance.bool({ likelihood: retention * 100 });
	});
}

/**
 * Feature 5: Generate subscription lifecycle events for a user
 */
function generateSubscriptionEvents(subscription, user, persona, userCreated, context, chance) {
	const { plans, lifecycle, events: eventNames } = subscription;
	const lc = lifecycle;
	const subEvents = [];

	const defaultPlan = plans.find(p => p.default) || plans[0];
	let currentPlan = defaultPlan;
	let currentStatus = 'active';
	const paidPlans = plans.filter(p => p.price > 0);

	const userStartUnix = dayjs(userCreated).unix();
	const endUnix = context.MAX_TIME;
	const timeShift = context.TIME_SHIFT_SECONDS;

	// Persona modifiers for subscription behavior
	const personaChurnMod = persona?.churnRate ? (1 + persona.churnRate) : 1.0;
	const personaUpgradeMod = persona?.conversionModifier || 1.0;

	let currentUnix = userStartUnix;
	const monthSeconds = 30 * 86400;

	// If the default plan has a trial, start a trial
	const firstPaidPlan = paidPlans[0];
	if (firstPaidPlan && firstPaidPlan.trialDays) {
		const trialStart = currentUnix + chance.integer({ min: 0, max: 86400 });
		if (trialStart + timeShift < endUnix) {
			subEvents.push(makeSubEvent(eventNames.trialStarted, trialStart + timeShift, user, firstPaidPlan.name, 'trial'));
			currentUnix = trialStart + (firstPaidPlan.trialDays * 86400);

			// Trial to paid conversion
			if (chance.bool({ likelihood: lc.trialToPayRate * personaUpgradeMod * 100 })) {
				if (currentUnix + timeShift < endUnix) {
					subEvents.push(makeSubEvent(eventNames.subscribed, currentUnix + timeShift, user, firstPaidPlan.name, 'active'));
					currentPlan = firstPaidPlan;
					currentStatus = 'active';
				}
			} else {
				currentStatus = 'expired_trial';
				return subEvents; // didn't convert, no more sub events
			}
		}
	}

	// Monthly lifecycle loop
	while (currentUnix + timeShift < endUnix) {
		currentUnix += monthSeconds + chance.integer({ min: -86400, max: 86400 });
		if (currentUnix + timeShift >= endUnix) break;
		if (currentStatus === 'cancelled') {
			// Win-back check
			if (chance.bool({ likelihood: lc.winBackRate * 100 })) {
				currentUnix += lc.winBackDelay * 86400;
				if (currentUnix + timeShift >= endUnix) break;
				subEvents.push(makeSubEvent(eventNames.wonBack, currentUnix + timeShift, user, currentPlan.name, 'active'));
				currentStatus = 'active';
			}
			break;
		}

		// Payment failure
		if (currentPlan.price > 0 && chance.bool({ likelihood: lc.paymentFailureRate * 100 })) {
			subEvents.push(makeSubEvent(eventNames.paymentFailed, currentUnix + timeShift, user, currentPlan.name, 'payment_issue'));
		}

		// Churn
		if (chance.bool({ likelihood: lc.churnRate * personaChurnMod * 100 })) {
			subEvents.push(makeSubEvent(eventNames.cancelled, currentUnix + timeShift, user, currentPlan.name, 'cancelled'));
			currentStatus = 'cancelled';
			continue;
		}

		// Upgrade
		const currentPlanIndex = plans.indexOf(currentPlan);
		if (currentPlanIndex < plans.length - 1 && chance.bool({ likelihood: lc.upgradeRate * personaUpgradeMod * 100 })) {
			const newPlan = plans[currentPlanIndex + 1];
			subEvents.push(makeSubEvent(eventNames.upgraded, currentUnix + timeShift, user, newPlan.name, 'active', currentPlan.name));
			currentPlan = newPlan;
			continue;
		}

		// Downgrade
		if (currentPlanIndex > 0 && currentPlan.price > 0 && chance.bool({ likelihood: lc.downgradeRate * 100 })) {
			const newPlan = plans[currentPlanIndex - 1];
			subEvents.push(makeSubEvent(eventNames.downgraded, currentUnix + timeShift, user, newPlan.name, 'active', currentPlan.name));
			currentPlan = newPlan;
			continue;
		}

		// Renewal
		if (currentPlan.price > 0) {
			subEvents.push(makeSubEvent(eventNames.renewed, currentUnix + timeShift, user, currentPlan.name, 'active'));
		}
	}

	return subEvents;
}

function makeSubEvent(eventName, unixTime, user, planName, status, previousPlan) {
	const ev = {
		event: eventName,
		time: dayjs.unix(Math.min(unixTime, dayjs().unix())).toISOString(),
		user_id: user.distinct_id,
		insert_id: u.quickHash(`${eventName}-${unixTime}-${user.distinct_id}`),
		subscription_plan: planName,
		_currentPlan: planName,
		_subStatus: status
	};
	if (previousPlan) ev.previous_plan = previousPlan;
	return ev;
}

/**
 * Feature 4: Generate bot users with repetitive patterns
 */
async function generateBotUsers(context, dataQuality, storage) {
	const { botUsers, botEventsPerUser } = dataQuality;
	const chance = u.getChance();
	const { config } = context;
	const events = config.events || [{ event: 'page_view' }];
	// Bots use only 1-2 event types repetitively
	const botEventTypes = events.slice(0, Math.min(2, events.length));

	for (let b = 0; b < botUsers; b++) {
		const botId = `bot_${chance.guid().slice(0, 8)}`;
		const botEvents = [];

		// Bots generate events at machine-like intervals
		let currentTime = context.FIXED_BEGIN + context.TIME_SHIFT_SECONDS;
		const interval = Math.floor(((context.MAX_TIME - currentTime) / botEventsPerUser));

		for (let e = 0; e < botEventsPerUser; e++) {
			const chosenEvent = botEventTypes[e % botEventTypes.length];
			currentTime += interval + chance.integer({ min: 0, max: 10 });
			if (currentTime > context.MAX_TIME) break;
			botEvents.push({
				event: chosenEvent.event,
				time: dayjs.unix(currentTime).toISOString(),
				user_id: botId,
				device_id: botId,
				insert_id: u.quickHash(`${chosenEvent.event}-${currentTime}-${botId}`),
				is_bot: true
			});
		}

		// Store bot profile
		await storage.userProfilesData.hookPush({
			distinct_id: botId,
			name: `Bot ${b + 1}`,
			is_bot: true
		});

		// Store bot events
		await storage.eventData.hookPush(botEvents, { profile: { distinct_id: botId, is_bot: true } });
	}
}

/**
 * Feature 9: Generate anomaly burst and coordinated events
 */
async function generateAnomalyBursts(context, anomalies, storage) {
	const chance = u.getChance();
	const timeShift = context.TIME_SHIFT_SECONDS;

	for (const a of anomalies) {
		if (a.type !== 'burst' && a.type !== 'coordinated') continue;
		if (!a._startUnix || !a.count) continue;

		const burstEvents = [];
		const startUnix = a._startUnix + timeShift;
		const endUnix = a._endUnix + timeShift;
		const windowSeconds = endUnix - startUnix;

		for (let i = 0; i < a.count; i++) {
			const eventTime = startUnix + chance.integer({ min: 0, max: Math.max(1, windowSeconds) });
			if (eventTime > context.MAX_TIME) continue;
			const userId = a.type === 'coordinated'
				? `anomaly_${chance.guid().slice(0, 8)}`
				: `burst_${chance.integer({ min: 1, max: 100 })}`;

			const ev = {
				event: a.event,
				time: dayjs.unix(eventTime).toISOString(),
				user_id: userId,
				insert_id: u.quickHash(`${a.event}-${eventTime}-${userId}-${i}`),
			};
			if (a.tag) ev._anomaly = a.tag;
			if (a.properties) Object.assign(ev, a.properties);
			burstEvents.push(ev);
		}

		await storage.eventData.hookPush(burstEvents, {});
	}
}
