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
		avgDevicePerUser = 0,
		hasSessionIds,
		hasLocation,
		funnels,
		userProps,
		scdProps,
		numDays,
		avgEventsPerUserPerDay,
		percentUsersBornInDataset = 15,
		strictEventCount = false,
		bornRecentBias = 0, // -1..1; positive = births skew toward end of window
		preExistingSpread = 'uniform', // 'pinned' (FIXED_BEGIN ± 1d) | 'uniform' ([FIXED_BEGIN-30d, FIXED_BEGIN])
		personas,
		worldEvents,
		engagementDecay: globalEngagementDecay,
		dataQuality,
	} = config;

	const { eventData, userProfilesData, scdTableData } = storage;
	// Per-user-per-day rate is the canonical event-volume primitive (config-validator
	// guarantees it is set). Each user's event count is rate × their active days, so
	// born-late users don't compress a full per-user budget into a tiny window.
	const ratePerDay = avgEventsPerUserPerDay ?? (numEvents / numUsers / numDays);
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
			const user = u.generateUser(userId, { numDays, isAnonymous, hasAvatar, hasAnonIds, hasSessionIds, datasetEndUnix: context.FIXED_NOW, avgDevicePerUser });
			const { distinct_id, created } = user;
			const userDevicePool = (user.anonymousIds && user.anonymousIds.length) ? user.anonymousIds.slice() : null;
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

			// Apply recency bias to birth dates for users born in dataset.
			// `created` (from generateUser → person) is anchored to the dataset end,
			// so it already lives inside [FIXED_BEGIN, FIXED_NOW]. No shift needed.
			// bornRecentBias: 0 = uniform distribution, 1 = heavily biased toward recent
			let adjustedCreated;
			if (userIsBornInDataset) {
				let biasedCreated = dayjs(created);

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
				// Pre-existing user: choose where their "first ever event" lives.
				// 'pinned' (legacy): exactly at FIXED_BEGIN — all pre-existing users stack
				//   at day 0, which front-loads early-window event density.
				// 'uniform' (default): sample uniformly from [FIXED_BEGIN - 30d, FIXED_BEGIN]
				//   so pre-existing users have varied "born before dataset" timestamps.
				//   Their TimeSoup-distributed events still mostly land in [FIXED_BEGIN, FIXED_NOW].
				if (preExistingSpread === 'uniform') {
					const offsetDays = chance.floating({ min: 0, max: 30 });
					adjustedCreated = dayjs.unix(context.FIXED_BEGIN).subtract(offsetDays, 'day');
				} else {
					adjustedCreated = dayjs.unix(context.FIXED_BEGIN);
				}
			}

			let userLocation = null;
			if (hasLocation) {
				const location = u.pickRandom(u.choose(defaults.locationsUsers));
				for (const key in location) {
					user[key] = location[key];
				}
				userLocation = location;
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

			// Build feature context for event generation
			const featureCtx = {
				persona,
				userLocation,
				worldEventsTimeline: worldEvents,
				dataQuality,
			};

			// Call user hook after profile creation (hooks override persona properties)
			if (config.hook) {
				await config.hook(profile, "user", {
					user,
					config,
					userIsBornInDataset,
					persona,
					datasetStart: context.DATASET_START_SECONDS,
					datasetEnd: context.DATASET_END_SECONDS
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
						allSCDs: userSCD,
						datasetStart: context.DATASET_START_SECONDS,
						datasetEnd: context.DATASET_END_SECONDS
					});
					if (Array.isArray(hookResult)) {
						changes = hookResult;
						userSCD[key] = changes;
					}
				}
			}

			// User's active days = how much of the dataset window they're alive for.
			// Pre-existing users: full window. Born-in-dataset: from birth to FIXED_NOW.
			// Floor at 1 day so users born on the very last day still emit a few events.
			const userActiveDays = userIsBornInDataset
				? Math.max(1, (context.FIXED_NOW - adjustedCreated.unix()) / 86400)
				: numDays;
			const userEventBudget = ratePerDay * userActiveDays;

			let numEventsThisUserWillPreform = Math.floor(chance.normal({
				mean: userEventBudget,
				dev: userEventBudget / u.integer(u.integer(2, 5), u.integer(2, 7))
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

			// Pre-compute weighted events array for standalone event selection.
			// Filter out isStrictEvent events — they only appear inside funnels.
			const weightedEvents = config.events.filter(e => !e.isStrictEvent).reduce((acc, event) => {
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

			// ── Phase 2 identity tracking ──
			// Pre-existing users are considered already-stitched before the dataset window —
			// `userAuthed` starts true. Born-in-dataset users start anonymous and only flip
			// authed once the stitch (`isAuthEvent` step in their `isFirstFunnel`) actually
			// fires. `userAuthTimeMs` is the unix-millisecond timestamp of that stitch event.
			let userAuthed = !userIsBornInDataset;
			let userAuthTimeMs = null;

			// PATH FOR USERS BORN IN DATASET AND PERFORMING FIRST FUNNEL
			if (firstFunnels.length && userIsBornInDataset) {
				const firstFunnel = chance.pickone(firstFunnels, user);
				let cursor = adjustedCreated.subtract(noise(), 'seconds').unix();

				// Resolve attempts plan. `attempts.{min,max}` count FAILED PRIORS; total
				// passes = failedPriors + 1.  Validator coerced bounds; default both 0.
				const attemptsCfg = firstFunnel.attempts || null;
				const minA = attemptsCfg ? (attemptsCfg.min || 0) : 0;
				const maxA = attemptsCfg ? (attemptsCfg.max || 0) : 0;
				const failedPriors = (maxA > 0) ? chance.integer({ min: minA, max: maxA }) : 0;
				const totalAttempts = failedPriors + 1;
				let firstAttemptFirstEventTime = null;

				for (let attemptNum = 1; attemptNum <= totalAttempts; attemptNum++) {
					const isFinal = attemptNum === totalAttempts;
					// On the final attempt, `attempts.conversionRate` (when set) overrides the
					// funnel's normal conversionRate. Clone the funnel object so we don't
					// mutate the shared config.
					const funnelToRun = (isFinal && attemptsCfg && attemptsCfg.conversionRate !== undefined)
						? { ...firstFunnel, conversionRate: attemptsCfg.conversionRate }
						: firstFunnel;
					const attemptMeta = {
						isFirstFunnel: true,
						isBorn: true,
						attemptsConfig: attemptsCfg,
						attemptNumber: attemptNum,
						totalAttempts,
						isFinalAttempt: isFinal,
						truncateBeforeAuth: !isFinal,
						devicePool: userDevicePool,
					};
					const [data, converted, authMs] = await makeFunnel(
						context, funnelToRun, user, cursor, profile, userSCD, persona, featureCtx, attemptMeta
					);
					if (isFinal) userConverted = converted;
					if (data && data.length) {
						if (firstAttemptFirstEventTime === null) {
							firstAttemptFirstEventTime = dayjs(data[0].time).unix();
						}
						// Advance the cursor for the next attempt by a small abandon-and-retry gap.
						const lastTime = dayjs(data[data.length - 1].time).unix();
						cursor = lastTime + chance.integer({ min: 60, max: 30 * 60 }); // 1–30 min later
						numEventsPreformed += data.length;
						usersEvents = usersEvents.concat(data);
					}
					if (authMs) {
						// First time we see a stitch wins — should only happen on the final attempt.
						if (userAuthTimeMs === null) userAuthTimeMs = authMs;
						userAuthed = true;
					}
				}

				userFirstEventTime = firstAttemptFirstEventTime !== null
					? firstAttemptFirstEventTime
					: adjustedCreated.subtract(noise(), 'seconds').unix();
			} else {
				userFirstEventTime = adjustedCreated.subtract(noise(), 'seconds').unix();
			}

			// ALL SUBSEQUENT EVENTS (funnels for converted users, standalone for all)
			let userChurned = false;
			const sessionTimeout = config.sessionTimeout || 30;

			// Standalone identity stamping mode: pre-existing or post-auth users get both
			// user_id + device_id; born-in-dataset users who never authed (final firstFunnel
			// attempt failed) stay device_only forever per the Phase 2 model.
			const standaloneStamping = userAuthed ? 'both' : 'device_only';
			const standaloneIdentityCtx = (userDevicePool || standaloneStamping !== 'both')
				? { stamping: standaloneStamping, devicePool: userDevicePool }
				: null;
			// Usage funnels for converted users: identity already stitched, just default 'both'.
			const usageAttemptMeta = { isFirstFunnel: false, isBorn: userIsBornInDataset, devicePool: userDevicePool };

			while (numEventsPreformed < numEventsThisUserWillPreform && !cancelled) {
				let newEvents;
				if (usageFunnels.length && userConverted) {
					const currentFunnel = chance.pickone(usageFunnels);
					const [data, converted] = await makeFunnel(context, currentFunnel, user, userFirstEventTime, profile, userSCD, persona, featureCtx, usageAttemptMeta);
					numEventsPreformed += data.length;
					newEvents = data;
				} else {
					const data = await makeEvent(context, distinct_id, userFirstEventTime, u.pick(weightedEvents), user.anonymousIds, {}, config.groupKeys, true, false, featureCtx, standaloneIdentityCtx);
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

			// Feature 3: Engagement decay — filter behavioral events
			const userDecay = persona?.engagementDecay || globalEngagementDecay;
			if (userDecay && userDecay.model !== 'none' && usersEvents.length > 0) {
				// adjustedCreated and event times now share the same dataset window — no shift.
				usersEvents = applyEngagementDecay(usersEvents, userDecay, adjustedCreated, context, chance);
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

			// Session clustering: redistribute events into temporal bursts, then assign session IDs
			if (hasSessionIds && usersEvents.length > 0) {
				const soupCfg = /** @type {import('../../types').SoupConfig} */ (config.soup) || {};
				const defaultPeaks = Math.max(5, (config.numDays || 30) * 2);
				const { mean: soupMean = 0, deviation: soupDev = 2, peaks: soupPeaks = defaultPeaks,
					dayOfWeekWeights: soupDOW, hourOfDayWeights: soupHOD } = soupCfg;

				u.bunchIntoSessions(usersEvents, sessionTimeout, {
					earliestTime: userFirstEventTime,
					latestTime: context.FIXED_NOW,
					peaks: soupPeaks, deviation: soupDev, mean: soupMean,
					dayOfWeekWeights: soupDOW, hourOfDayWeights: soupHOD
				});
				u.assignSessionIds(usersEvents, sessionTimeout);

				// Phase 2: per-session sticky device. After session_ids exist, deterministically
				// pick one device per session from the user's pool and overwrite each event's
				// device_id so all events in that session share a device. Skip when there's no
				// pool (avgDevicePerUser=0) or only one device (no choice to make).
				if (userDevicePool && userDevicePool.length > 1) {
					const sessionToDevice = new Map();
					for (const ev of usersEvents) {
						if (!ev || !ev.device_id || !ev.session_id) continue;
						let dev = sessionToDevice.get(ev.session_id);
						if (!dev) {
							dev = userDevicePool[Number(u.quickHash(`${distinct_id}:${ev.session_id}`)) % userDevicePool.length];
							sessionToDevice.set(ev.session_id, dev);
						}
						ev.device_id = dev;
					}
				}
			}

			// Hook for processing all user events (hooks override everything)
			if (config.hook) {
				// `meta.isPreAuth(event)` predicate bound to this user's auth state.
				// - Pre-existing user: authed throughout; never pre-auth.
				// - Born-in-dataset, never converted (userAuthTimeMs===null): all pre-auth.
				// - Born-in-dataset, converted: pre-auth strictly before the stitch event.
				const userAuthTimeMsLocal = userAuthTimeMs;
				const userIsBornLocal = userIsBornInDataset;
				const isPreAuth = (event) => {
					if (!event || !event.time) return false;
					if (userAuthTimeMsLocal === null) return userIsBornLocal;
					const t = typeof event.time === 'string' ? Date.parse(event.time) : Number(event.time);
					return Number.isFinite(t) ? t < userAuthTimeMsLocal : false;
				};
				const newEvents = await config.hook(usersEvents, "everything", {
					profile,
					scd: userSCD,
					config,
					userIsBornInDataset,
					persona,
					datasetStart: context.DATASET_START_SECONDS,
					datasetEnd: context.DATASET_END_SECONDS,
					authTime: userAuthTimeMs,
					isPreAuth,
				});
				if (Array.isArray(newEvents)) usersEvents = newEvents;
			}

			// Defensive guard: drop any events whose timestamp landed past the
			// configured dataset end. Hooks that duplicate events with time offsets
			// (weekend surges, viral spreads) can leak a few past the boundary.
			usersEvents = usersEvents.filter(e => {
				if (!e || !e.time) return true;
				const t = typeof e.time === 'string' ? Date.parse(e.time) / 1000 : Number(e.time);
				return Number.isFinite(t) ? t <= context.FIXED_NOW : true;
			});

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

		// Bots generate events at machine-like intervals across the dataset window
		let currentTime = context.FIXED_BEGIN;
		const interval = Math.floor(((context.FIXED_NOW - currentTime) / botEventsPerUser));

		for (let e = 0; e < botEventsPerUser; e++) {
			const chosenEvent = botEventTypes[e % botEventTypes.length];
			currentTime += interval + chance.integer({ min: 0, max: 10 });
			if (currentTime > context.FIXED_NOW) break;
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
