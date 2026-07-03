/**
 * @ak--47/dungeon-master/verify — Phase 4 verification surface.
 *
 * `emulateBreakdown` produces the table shapes Mixpanel shows for the five
 * supported analyses (frequencyByFrequency, funnelFrequency, aggregatePerUser,
 * timeToConvert, attributedBy). `verifyDungeon` is the higher-level wrapper
 * that runs a dungeon and asserts emulator outputs match expected ratios — wire
 * this into your CI to catch dungeon drift.
 */

export { emulateBreakdown } from './emulate-breakdown.js';
export { verifyDungeon } from './verify-dungeon.js';
export { deriveExpectedSchema, validateSchema } from './schema-validator.js';
export {
	evaluateFunnel,
	evaluateFunnelHPC,
	resolveFunnelSegment,
	normalizeStep,
	matchesStepFilter,
	timestampComesAfter,
	withinConversionWindow,
	evaluateAnyOrderCompletion,
} from './funnel-engine.js';
export { buildIdentityMap, resolveUserId } from './identity.js';
export {
	countDistinctPeriods,
	countDistinctValues,
	countEvents,
	nullAwareAvg,
	nullAwareSum,
	nullAwareExtreme,
	binByDistinctPeriods,
	partitionByTimeBucket,
} from './counting.js';
export {
	coerceToBreakdownKey,
	breakdownSegmentKey,
	filterEquals,
	filterCompare,
	filterContains,
	matchesWhere,
} from './coerce.js';
export { evaluateFormula } from './formula.js';
export { filterFirstTimeEver } from './first-time.js';
export { sessionize, SESSION_COPY_PROPERTIES } from './sessionize.js';
