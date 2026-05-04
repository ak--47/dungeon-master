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
