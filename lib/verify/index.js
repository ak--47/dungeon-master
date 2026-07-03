/**
 * @ak--47/dungeon-master/verify — Phase 4 verification surface.
 *
 * `emulateBreakdown` produces the table shapes Mixpanel shows for the
 * supported analyses (frequencyByFrequency, funnelFrequency, aggregatePerUser,
 * timeToConvert, attributedBy, sessionMetrics, retention, distinctCount,
 * eventBreakdown, uniques, lifecycle, topPaths). `verifyDungeon` is the
 * higher-level wrapper that runs a dungeon and asserts emulator outputs match
 * expected ratios — wire this into your CI to catch dungeon drift.
 */

export { emulateBreakdown } from './emulate-breakdown.js';
export { verifyDungeon } from './verify-dungeon.js';
export { deriveExpectedSchema, validateSchema } from './schema-validator.js';
export {
	evaluateFunnel,
	evaluateFunnelHPC,
	resolveFunnelSegment,
	normalizeStep,
	normalizeFunnelSteps,
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
	frequencyHistogram,
} from './counting.js';
export { extractFlows, aggregateFlows, UNCOMMON_FLOWS_EVENT } from './flows.js';
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
export { sessionize, sessionOrdinals, SESSION_COPY_PROPERTIES } from './sessionize.js';
export { applyFunnelDefaults } from './verify-dungeon.js';
export {
	STORY_ARCHETYPES,
	VERDICT_RANK,
	parseMetric,
	selectRows,
	verdictFor,
	evaluateAssertion,
	validateStories,
	storiesToChecks,
	evaluateStories,
} from './story-runner.js';
