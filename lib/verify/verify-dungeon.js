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
import { validateSchema } from './schema-validator.js';

/**
 * @typedef {Object} VerifyCheck
 * @property {string} name - Human-readable name for the check.
 * @property {Object} breakdown - Argument passed to `emulateBreakdown`.
 * @property {(rows: Array<Object>, ctx: { events: Array<Object>, profiles: Array<Object> }) => { pass: boolean, detail?: string }} assert
 */

/**
 * Try to find the dungeon funnel whose `sequence` matches the breakdown's funnel
 * steps. Used to auto-apply v1.5 `conversionWindowDays` + `order`-mode dispatch
 * without forcing every check author to thread these args by hand.
 * @param {Array<Object>} funnels
 * @param {string[]} steps
 * @returns {Object | null}
 */
function findMatchingFunnel(funnels, steps) {
	if (!Array.isArray(funnels) || !Array.isArray(steps) || !steps.length) return null;
	for (const f of funnels) {
		if (!f || !Array.isArray(f.sequence)) continue;
		if (f.sequence.length !== steps.length) continue;
		let same = true;
		for (let i = 0; i < steps.length; i++) {
			if (f.sequence[i] !== steps[i]) { same = false; break; }
		}
		if (same) return f;
	}
	return null;
}

/**
 * Auto-apply funnel-level dungeon config (conversion window, order mode,
 * reentry, exclusion steps, step filters) plus the profiles arg to a breakdown
 * args object, so check/story authors don't thread them by hand. Returns a NEW
 * args object — the input is not mutated. Extracted from `verifyDungeon` in
 * v1.6 so the story runner (P3.3) reuses the exact same threading.
 * @param {Object} breakdownArgs - Args destined for `emulateBreakdown`.
 * @param {Array<Object>} funnels - VALIDATED dungeon funnels (`validateDungeonConfig`
 *   mutates funnels in place, so post-run `config.funnels` carries resolved
 *   `conversionWindowDays` / `order`).
 * @param {Array<Object>} [profiles] - User profiles, threaded into `timeToConvert`.
 * @returns {Object}
 */
export function applyFunnelDefaults(breakdownArgs, funnels, profiles) {
	const args = { ...breakdownArgs };
	if (args.type === 'timeToConvert' && !args.profiles && profiles) {
		args.profiles = profiles;
	}
	// v1.5: auto-apply funnel-level config when the check targets a funnel.
	if (args.type === 'funnelFrequency' || args.type === 'timeToConvert') {
		const targetSteps = args.steps
			|| (args.fromEvent && args.toEvent
				? [args.fromEvent, args.toEvent]
				: null);
		const matched = findMatchingFunnel(Array.isArray(funnels) ? funnels : [], targetSteps);
		if (matched) {
			// An explicit session-count window (`conversionWindow: { unit: 'sessions', n }`)
			// is the author choosing a window — injecting conversionWindowMs on top
			// would trip evaluateFunnel's mutual-exclusion throw. Only inject when
			// NEITHER window form is present.
			if (args.conversionWindowMs === undefined && args.conversionWindow === undefined && Number.isFinite(matched.conversionWindowDays)) {
				args.conversionWindowMs = matched.conversionWindowDays * 86400000;
			}
			if (args.funnelOrder === undefined && matched.order) {
				args.funnelOrder = matched.order;
			}
			// v1.5.0: thread Funnel-level extension hints through to the verifier.
			if (args.reentry === undefined && matched.reentry !== undefined) {
				args.reentry = matched.reentry;
			}
			if (args.exclusionSteps === undefined && Array.isArray(matched.exclusionEvents) && matched.exclusionEvents.length) {
				args.exclusionSteps = matched.exclusionEvents.map(name => ({ event: name }));
			}
			// stepFilters: Record<number, { prop, op, value }> → mutate steps to attach where-clause.
			if (matched.stepFilters && args.steps && Array.isArray(args.steps)) {
				args.steps = args.steps.map((s, i) => {
					const filter = matched.stepFilters[i];
					if (!filter) return s;
					const stepObj = typeof s === 'string' ? { event: s } : { ...s };
					if (!stepObj.where) stepObj.where = filter;
					return stepObj;
				});
			}
		}
	}
	return args;
}

/**
 * @param {Object} config - Dungeon config (or path; passed straight to DUNGEON_MASTER).
 * @param {VerifyCheck[]} checks
 * @returns {Promise<{ pass: boolean, results: Array<{ name: string, pass: boolean, detail?: string, rows?: Array<Object> }>, schemaReport: Object }>}
 */
export async function verifyDungeon(config, checks) {
	if (!checks || !checks.length) throw new Error('verifyDungeon: at least one check required');
	let result = await DUNGEON_MASTER(config);
	if (Array.isArray(result)) result = result[0];
	const events = Array.isArray(result.eventData) ? result.eventData : Array.from(result.eventData);
	const profiles = Array.isArray(result.userProfilesData) ? result.userProfilesData : Array.from(result.userProfilesData);
	const schemaReport = validateSchema(events, config);
	const ctx = { events, profiles, schemaReport };
	const results = [];
	// `validateDungeonConfig` mutates funnels in place — by the time we read here,
	// `conversionWindowDays` is populated and `order` is the validated value.
	const validatedFunnels = (config && Array.isArray(config.funnels)) ? config.funnels : [];
	for (const check of checks) {
		try {
			const breakdownArgs = applyFunnelDefaults(check.breakdown, validatedFunnels, profiles);
			const rows = emulateBreakdown(events, breakdownArgs);
			const verdict = check.assert(rows, ctx);
			results.push({ name: check.name, pass: !!verdict.pass, detail: verdict.detail, rows });
		} catch (err) {
			results.push({ name: check.name, pass: false, detail: `error: ${err.message}` });
		}
	}
	const pass = results.every(r => r.pass) && schemaReport.pass;
	return { pass, results, schemaReport };
}
