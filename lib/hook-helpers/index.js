/**
 * @ak--47/dungeon-master/hook-helpers — Phase 3 atom barrel export.
 *
 * Atoms are pure-ish primitives that hooks compose to build trends. The five
 * sub-modules (cohort, mutate, timing, inject, identity) cover the moves Mixpanel
 * analyses need: classify users into bins, scale event counts and property values,
 * adjust timings, splice in cloned events, and reason about pre-auth state.
 *
 * Each atom carries full JSDoc on its definition; see the individual files for
 * the contract details. Patterns (Phase 4, lib/hook-patterns) are higher-level
 * recipes built on top of these atoms.
 */

export {
	binUsersByEventCount,
	binUsersByEventInRange,
	countEventsBetween,
	userInProfileSegment,
} from './cohort.js';

export {
	cloneEvent,
	dropEventsWhere,
	scaleEventCount,
	scalePropertyValue,
	shiftEventTime,
} from './mutate.js';

export {
	scaleTimingBetween,
	scaleFunnelTTC,
	findFirstSequence,
} from './timing.js';

export {
	injectAfterEvent,
	injectBetween,
	injectBurst,
} from './inject.js';

export {
	isPreAuthEvent,
	splitByAuth,
} from './identity.js';
