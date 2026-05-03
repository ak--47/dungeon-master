/**
 * verifyDungeon — run a dungeon (in-memory) and run a series of emulator checks
 * against its output, returning a structured report. Designed for CI use:
 *
 *   const report = await verifyDungeon(dungeonConfig, [
 *     {
 *       name: 'engaged users do 2x purchases',
 *       breakdown: { type: 'frequencyByFrequency',
 *                    metricEvent: 'Purchase', breakdownByFrequencyOf: 'Browse' },
 *       assert: (rows) => {
 *         // custom assertion against the emulator's output table
 *         return { pass: true, detail: 'looks good' };
 *       }
 *     }
 *   ]);
 *   if (!report.pass) process.exit(1);
 *
 * The dungeon is run via the same default-export entry point external consumers
 * use, so this is a true end-to-end check.
 */

import DUNGEON_MASTER from '../../index.js';
import { emulateBreakdown } from './emulate-breakdown.js';

/**
 * @typedef {Object} VerifyCheck
 * @property {string} name - Human-readable name for the check.
 * @property {Object} breakdown - Argument passed to `emulateBreakdown`.
 * @property {(rows: Array<Object>, ctx: { events: Array<Object>, profiles: Array<Object> }) => { pass: boolean, detail?: string }} assert
 */

/**
 * @param {Object} config - Dungeon config (or path; passed straight to DUNGEON_MASTER).
 * @param {VerifyCheck[]} checks
 * @returns {Promise<{ pass: boolean, results: Array<{ name: string, pass: boolean, detail?: string, rows?: Array<Object> }> }>}
 */
export async function verifyDungeon(config, checks) {
	if (!checks || !checks.length) throw new Error('verifyDungeon: at least one check required');
	let result = await DUNGEON_MASTER(config);
	if (Array.isArray(result)) result = result[0];
	const events = Array.isArray(result.eventData) ? result.eventData : Array.from(result.eventData);
	const profiles = Array.isArray(result.userProfilesData) ? result.userProfilesData : Array.from(result.userProfilesData);
	const ctx = { events, profiles };
	const results = [];
	for (const check of checks) {
		try {
			const breakdownArgs = { ...check.breakdown };
			// timeToConvert + attributedBy may want profiles; auto-inject if not provided.
			if (breakdownArgs.type === 'timeToConvert' && !breakdownArgs.profiles) {
				breakdownArgs.profiles = profiles;
			}
			const rows = emulateBreakdown(events, breakdownArgs);
			const verdict = check.assert(rows, ctx);
			results.push({ name: check.name, pass: !!verdict.pass, detail: verdict.detail, rows });
		} catch (err) {
			results.push({ name: check.name, pass: false, detail: `error: ${err.message}` });
		}
	}
	const pass = results.every(r => r.pass);
	return { pass, results };
}
