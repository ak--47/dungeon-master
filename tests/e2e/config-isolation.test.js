/**
 * Config isolation regression tests (v1.6.2)
 *
 * `validateDungeonConfig` used to enrich its input in place — stamping
 * `isStrictEvent` on funnel-step events and `conversionWindowDays` /
 * `_experiment` on funnels — and `DUNGEON_MASTER` handed it a SHALLOW spread of
 * the caller's config, so those stamps landed on the caller's own `events` /
 * `funnels` arrays. For a file input that array belongs to the ESM module cache,
 * so a second run of the same dungeon in one process was fed a config already
 * enriched by the first: every event pre-promoted to strict, the catch-all
 * funnel swept nothing, and event volume collapsed to near zero.
 *
 * The validator now clones its input and enriches only the returned object,
 * which is exposed as `result.validatedConfig`. These tests pin both halves:
 * the input is left alone, and consumers can still reach the enriched values.
 */

import { describe, test, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import DUNGEON_MASTER from '../../index.js';
import { validateDungeonConfig } from '../../lib/core/config-validator.js';
import { verifyDungeon, applyFunnelDefaults, emulateBreakdown } from '../../lib/verify/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const simplePath = path.resolve(__dirname, '../../dungeons/technical/simple.js');
const experimentsPath = path.resolve(__dirname, '../../dungeons/technical/experiments.js');

const timeout = 60_000;

/** A config whose single funnel resolves to a finite conversion window. */
const funnelConfig = () => ({
	numUsers: 40,
	numEvents: 400,
	numDays: 30,
	seed: 'verify-window',
	writeToDisk: false,
	token: '',
	events: [
		{ event: 'sign up', weight: 5 },
		{ event: 'onboard', weight: 4 },
		{ event: 'purchase', weight: 3 }
	],
	funnels: [{
		sequence: ['sign up', 'onboard', 'purchase'],
		conversionRate: 60,
		timeToConvert: 4,
		isFirstFunnel: true
	}]
});

describe('config isolation', () => {

	test('validateDungeonConfig does not mutate its input', () => {
		const config = funnelConfig();
		const before = JSON.stringify(config);

		const validated = validateDungeonConfig(config);

		expect(JSON.stringify(config)).toBe(before);
		expect(config.events[0]).not.toHaveProperty('isStrictEvent');
		expect(config.funnels[0]).not.toHaveProperty('conversionWindowDays');
		// ...but the returned object IS enriched
		expect(validated.events.find(e => e.event === 'sign up').isStrictEvent).toBe(true);
		expect(Number.isFinite(validated.funnels[0].conversionWindowDays)).toBe(true);
	});

	test('validateDungeonConfig is safe to call twice on the same object', () => {
		const config = funnelConfig();
		const a = validateDungeonConfig(config);
		const b = validateDungeonConfig(config);

		// pre-fix the second pass saw already-strict events and rebuilt a
		// degenerate funnel set (including a zero-length sequence)
		expect(b.funnels.length).toBe(a.funnels.length);
		expect(b.funnels.every(f => f.sequence.length > 0)).toBe(true);
		expect(b.events.map(e => e.event)).toEqual(a.events.map(e => e.event));
	});

	test('a run does not mutate a caller-supplied config object', async () => {
		const config = funnelConfig();
		const before = JSON.stringify(config);

		await DUNGEON_MASTER(config);

		expect(JSON.stringify(config)).toBe(before);
	}, timeout);

	test('a run does not mutate the ESM module cache for a file input', async () => {
		const mod = await import(simplePath);
		const stringify = (o) => JSON.stringify(o, (k, v) => typeof v === 'function' ? '[fn]' : v);
		const before = stringify(mod.default);

		await DUNGEON_MASTER(simplePath, {
			numUsers: 5, numEvents: 50, seed: 'isolation-file', writeToDisk: false, token: ''
		});

		expect(stringify(mod.default)).toBe(before);
	}, timeout);

	test('running the same dungeon file twice does not collapse event volume', async () => {
		const opts = { numUsers: 5, numEvents: 50, seed: 'isolation-twice', writeToDisk: false, token: '' };

		const first = await DUNGEON_MASTER(simplePath, opts);
		const second = await DUNGEON_MASTER(simplePath, opts);

		// Pre-fix, run 2 collapsed to single digits (and to 0 once run 1 or any
		// earlier test in this worker had already poisoned the module cache).
		// An absolute floor is used deliberately: a ratio against `first` is
		// vacuous when `first` is itself the collapsed run. `simple.js` at these
		// parameters produces low hundreds of events.
		expect(first.eventCount).toBeGreaterThan(100);
		expect(second.eventCount).toBeGreaterThan(100);
	}, timeout);

	test('array input runs every dungeon at full volume', async () => {
		const results = await DUNGEON_MASTER([simplePath, simplePath], {
			numUsers: 5, numEvents: 50, seed: 'isolation-array', writeToDisk: false, token: ''
		});

		expect(results).toHaveLength(2);
		expect(results[0].eventCount).toBeGreaterThan(100);
		expect(results[1].eventCount).toBeGreaterThan(100);
	}, timeout);

	test('cloning preserves hook and onProgress function references', async () => {
		// Guards against a future switch to `structuredClone` or a JSON round-trip,
		// either of which would drop or throw on the function-valued config keys.
		const seen = [];
		const result = await DUNGEON_MASTER({
			numUsers: 3,
			numEvents: 20,
			numDays: 10,
			seed: 'isolation-fns',
			writeToDisk: false,
			token: '',
			events: [{ event: 'page view', weight: 5, properties: { touched: [false] } }],
			hook: (record, type) => {
				if (type === 'event') record.touched = true;
				return record;
			},
			onProgress: (update) => { seen.push(update.phase); }
		});

		expect(result.eventCount).toBeGreaterThan(0);
		expect(result.eventData.every(e => e.touched === true)).toBe(true);
		expect(seen.length).toBeGreaterThan(0);
	}, timeout);
});

describe('validatedConfig threading', () => {

	// `verifyDungeon` used to read `conversionWindowDays` back off the CALLER's
	// config, relying on the in-place enrichment. Once the validator stopped
	// mutating its input that read yielded undefined, and every funnel check
	// silently ran with an UNBOUNDED conversion window — more permissive
	// verdicts, and not one failing test. It now reads the run's
	// `validatedConfig`, which these tests pin end to end.

	const steps = ['sign up', 'onboard', 'purchase'];
	const breakdown = { type: 'funnelFrequency', steps, breakdownByFrequencyOf: 'purchase' };

	test('a run result exposes the enriched validatedConfig', async () => {
		const config = funnelConfig();
		const result = await DUNGEON_MASTER(config);

		expect(result.validatedConfig).toBeDefined();
		expect(Number.isFinite(result.validatedConfig.funnels[0].conversionWindowDays)).toBe(true);
		expect(config.funnels[0]).not.toHaveProperty('conversionWindowDays');
	}, timeout);

	test('applyFunnelDefaults injects a bounded window from validatedConfig, not from the raw config', async () => {
		const config = funnelConfig();
		const result = await DUNGEON_MASTER(config);

		const fromValidated = applyFunnelDefaults(breakdown, result.validatedConfig.funnels);
		const fromRawConfig = applyFunnelDefaults(breakdown, config.funnels);

		// the source `verifyDungeon` reads now
		expect(Number.isFinite(fromValidated.conversionWindowMs)).toBe(true);
		expect(fromValidated.conversionWindowMs).toBe(
			result.validatedConfig.funnels[0].conversionWindowDays * 86_400_000
		);
		// the source it read before 1.6.2 — unbounded, i.e. the silent regression
		expect(fromRawConfig.conversionWindowMs).toBeUndefined();
	}, timeout);

	test('verifyDungeon applies funnel config for a PATH input', async () => {
		// The load-bearing case. A path input is a STRING — it has no `.funnels` to
		// read back off — so pre-1.6.2 `verifyDungeon` threaded an empty funnel list
		// and every funnel check silently ran with default order and an unbounded
		// window. `experiments.js` funnel 3 is `order: 'random'`, which the emulator
		// evaluates differently from the sequential default, so the threading is
		// directly observable in the rows.
		const steps = ['feature viewed', 'action taken', 'help viewed', 'action taken'];
		const bd = { type: 'funnelFrequency', steps, breakdownByFrequencyOf: 'action taken' };

		let threaded = null;
		const report = await verifyDungeon(experimentsPath, [{
			name: 'random-order funnel reaches the emulator',
			breakdown: bd,
			assert: (rows, ctx) => {
				// Same events, same breakdown, no funnel config applied — i.e. exactly
				// what the pre-1.6.2 empty funnel list produced.
				const unthreaded = emulateBreakdown(ctx.events, bd);
				threaded = JSON.stringify(rows) !== JSON.stringify(unthreaded);
				return { pass: threaded, detail: threaded ? 'order applied' : 'funnel config was NOT applied' };
			}
		}], { numUsers: 60, numEvents: 1200, seed: 'verify-order', writeToDisk: false, token: '' });

		expect(threaded).toBe(true);
		expect(report.results[0].pass).toBe(true);
		expect(Number.isFinite(report.validatedConfig.funnels[2].conversionWindowDays)).toBe(true);
		// The schema report was derived from the raw input too. A path input is a
		// string with no fields, and `hasAndroidDevices` / `hasBrowser` live under
		// `switches` on a v1.5.1 dungeon — together that produced a wall of phantom
		// `flagStamping` findings and a permanently false `report.pass`.
		expect(report.schemaReport.flagStamping).toHaveLength(0);
		expect(report.schemaReport.summary.fail).toBe(0);
		expect(report.pass).toBe(true);
	}, timeout);

	test('validatedConfig carries no credentials', async () => {
		// A Result gets logged and attached to CI artifacts; before 1.6.2 it held no
		// credentials at all and surfacing the resolved config must not change that.
		const result = await DUNGEON_MASTER({
			...funnelConfig(),
			token: 'TOKEN-LEAK',
			serviceAccount: 'SA-LEAK',
			serviceSecret: 'SECRET-LEAK',
			projectId: 'PROJECT-LEAK'
		});

		const serialized = JSON.stringify(result.validatedConfig);
		for (const secret of ['TOKEN-LEAK', 'SA-LEAK', 'SECRET-LEAK', 'PROJECT-LEAK']) {
			expect(serialized).not.toContain(secret);
		}
		// still the enriched config, just without the keys
		expect(Number.isFinite(result.validatedConfig.funnels[0].conversionWindowDays)).toBe(true);
	}, timeout);
});
