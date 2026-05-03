/**
 * @ak--47/dungeon-master/hook-patterns — Phase 4 pattern barrel.
 *
 * Patterns are higher-level recipes built on Phase 3 atoms. Each one engineers
 * the kind of distribution / table shape Mixpanel surfaces in a specific report.
 * Pair with `verifyDungeon` + `emulateBreakdown` from `../verify` to assert the
 * pattern is producing what you expect.
 */

export { applyFrequencyByFrequency } from './frequency-by-frequency.js';
export { applyFunnelFrequencyBreakdown } from './funnel-frequency-breakdown.js';
export { applyAggregateByBin } from './aggregate-per-user-by-bin.js';
export { applyTTCBySegment } from './time-to-convert-by-segment.js';
export { applyAttributedBySource } from './attributed-by-source.js';
