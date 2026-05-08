//@ts-nocheck
/**
 * v1.5 isStrictEvent auto-promote tests.
 *
 * Footgun: if a funnel-step event also lives in `events[]` without
 * `isStrictEvent: true`, Mixpanel's greedy single-pass funnel engine
 * (`history.cpp`) consumes standalone instances as funnel matches —
 * corrupting both the standalone count AND the funnel TTC.
 *
 * v1.5 fix: the validator detects collisions and auto-promotes to
 * `isStrictEvent: true`, with a `console.warn`. Explicit `isStrictEvent: false`
 * opts out (advanced — preserves mixed semantics intentionally).
 */

import { describe, test, expect } from 'vitest';
import { validateDungeonConfig } from '../../lib/core/config-validator.js';

function captureWarnings(fn) {
	const warnings = [];
	const origWarn = console.warn;
	console.warn = (msg) => { warnings.push(String(msg)); };
	try { fn(); } finally { console.warn = origWarn; }
	return warnings;
}

const baseConfig = (overrides = {}) => ({
	seed: 'strict-promote',
	datasetStart: '2025-09-01T00:00:00Z',
	datasetEnd: '2025-10-01T00:00:00Z',
	numUsers: 5,
	avgEventsPerUserPerDay: 1,
	writeToDisk: false,
	verbose: false,
	...overrides,
});

describe('v1.5 isStrictEvent auto-promote', () => {
	test('event listed in events[] AND in a funnel sequence → auto-promoted', () => {
		const cfg = baseConfig({
			events: [
				{ event: 'sign up', weight: 1 },
				{ event: 'onboard', weight: 5 },
				{ event: 'purchase', weight: 1 },
			],
			funnels: [{
				sequence: ['sign up', 'onboard', 'purchase'],
				conversionRate: 50,
				timeToConvert: 1,
			}],
		});
		const warnings = captureWarnings(() => validateDungeonConfig(cfg));
		const hasPromote = warnings.some(w =>
			w.includes('Auto-promoted') && w.includes('isStrictEvent: true')
		);
		expect(hasPromote).toBe(true);
		// All three funnel-step events should now be strict.
		for (const eventName of ['sign up', 'onboard', 'purchase']) {
			const ev = cfg.events.find(e => e.event === eventName);
			expect(ev.isStrictEvent).toBe(true);
		}
	});

	test('explicit isStrictEvent: false opts out (preserved)', () => {
		const cfg = baseConfig({
			events: [
				{ event: 'sign up', weight: 1, isStrictEvent: false },
				{ event: 'purchase', weight: 1 },
			],
			funnels: [{
				sequence: ['sign up', 'purchase'],
				timeToConvert: 1,
			}],
		});
		validateDungeonConfig(cfg);
		const su = cfg.events.find(e => e.event === 'sign up');
		expect(su.isStrictEvent).toBe(false); // opt-out preserved
		const pu = cfg.events.find(e => e.event === 'purchase');
		expect(pu.isStrictEvent).toBe(true); // auto-promoted (no explicit value)
	});

	test('explicit isStrictEvent: true is no-op (no double-warn)', () => {
		const cfg = baseConfig({
			events: [
				{ event: 'sign up', weight: 1, isStrictEvent: true },
				{ event: 'purchase', weight: 1, isStrictEvent: true },
			],
			funnels: [{
				sequence: ['sign up', 'purchase'],
				timeToConvert: 1,
			}],
		});
		const warnings = captureWarnings(() => validateDungeonConfig(cfg));
		// No auto-promote warnings since both already strict.
		const hasPromote = warnings.some(w => w.includes('Auto-promoted'));
		expect(hasPromote).toBe(false);
	});

	test('non-funnel events stay non-strict (auto-promote runs BEFORE catch-all funnel)', () => {
		const cfg = baseConfig({
			events: [
				{ event: 'sign up', weight: 1 }, // funnel step
				{ event: 'page view', weight: 5 }, // NOT in any funnel
			],
			funnels: [{
				sequence: ['sign up'],
				timeToConvert: 1,
			}],
		});
		validateDungeonConfig(cfg);
		const su = cfg.events.find(e => e.event === 'sign up');
		const pv = cfg.events.find(e => e.event === 'page view');
		expect(su.isStrictEvent).toBe(true);
		// v1.5 auto-promote runs BEFORE the catch-all funnel auto-creation. So
		// `page view` is not yet a funnel step when the promote runs → stays
		// non-strict. The catch-all funnel that sweeps up `page view` afterwards
		// uses non-strict events to populate the standalone-event pool.
		expect(pv.isStrictEvent).not.toBe(true);
	});

	test('$experiment_started is NOT auto-promoted (it is engine-prepended, not user-declared)', () => {
		const cfg = baseConfig({
			events: [
				{ event: 'sign up', weight: 1 },
				{ event: '$experiment_started', weight: 1 },
			],
			funnels: [{
				sequence: ['sign up'],
				experiment: true,
			}],
		});
		validateDungeonConfig(cfg);
		const exp = cfg.events.find(e => e.event === '$experiment_started');
		// $experiment_started in events[] is left alone; experiments handle it specially.
		expect(exp.isStrictEvent).toBeUndefined();
	});
});
