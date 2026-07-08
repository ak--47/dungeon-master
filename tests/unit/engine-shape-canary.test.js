//@ts-nocheck
/**
 * Engine-shape canary — fast regression guard for the v1.5 engine validation
 * sweep (see plans/ENGINE-VALIDATION/PLAN.md). 10 known-good combos run on
 * `dungeons/technical/simplest.js` at canary scale (numUsers=500). Total wall
 * time < 5s. Catches the obvious regression cases on every commit; the full
 * 194-combo sweep lives at tests/e2e/engine-shape-full-sweep.test.js (gated).
 *
 * Pinned dataset window (NOT wall-clock-relative) for determinism — these
 * tests must produce the same metrics regardless of when CI runs.
 */
import { describe, test, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
dayjs.extend(utc);
import generate from '../../index.js';
import simplest from '../../dungeons/technical/simplest.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Fixed window — same every run.
const DATASET_END = '2026-04-30T23:59:59.000Z';

// Per-macro strict bars (must match scripts/sweep-engine.mjs STRICT_BARS).
// v1.5.1 recalibration (TODO #10 follow-up): widened to absorb the cleaner
// `chance.normal(dev=budget/3)` event-count distribution from the numEvents
// overshoot fix. See sweep-engine.mjs STRICT_BARS comment for full rationale.
const BARS = {
	flat:    { tail: [0.65, 1.6], spike: 2.5, l7c: 0.5  },
	steady:  { tail: [0.65, 1.8], spike: 2.5, l7c: 0.5  },
	growth:  { tail: [0.65, 2.5], spike: 3.5, l7c: 0.45 },
	viral:   { tail: [0.5,  5.0], spike: 7.0, l7c: 0.3  },
	decline: { tail: [0.4,  2.0], spike: 3.0, l7c: 0.3  },
};

async function runCombo({ macro, numDays, rate = 1.2, born, activeDays, numUsers = 500 }) {
	const datasetEnd = DATASET_END;
	const datasetStart = dayjs.utc(datasetEnd).subtract(numDays, 'day').startOf('day').toISOString();
	const override = {
		...simplest,
		token: '',
		numUsers,
		numEvents: undefined,
		avgEventsPerUserPerDay: rate,
		numDays,
		datasetStart,
		datasetEnd,
		macro,
		format: 'json',
		gzip: false,
		writeToDisk: false,
		concurrency: 1,
		verbose: false,
	};
	if (born !== undefined) override.percentUsersBornInDataset = born;
	if (activeDays !== undefined) override.avgActiveDaysPerUser = activeDays;
	const result = await generate(override);
	return { events: result.eventData || [], numDays, macro };
}

function metricsFor(events, numDays, datasetEndIso) {
	const dayCounts = new Map();
	for (const e of events) {
		if (!e || !e.time) continue;
		const t = typeof e.time === 'string' ? Date.parse(e.time) : Number(e.time);
		if (!Number.isFinite(t)) continue;
		const day = dayjs.utc(t).format('YYYY-MM-DD');
		dayCounts.set(day, (dayCounts.get(day) || 0) + 1);
	}
	const anchorDay = dayjs.utc(datasetEndIso).startOf('day');
	const window = [];
	for (let i = numDays - 1; i >= 0; i--) {
		const d = anchorDay.subtract(i, 'day').format('YYYY-MM-DD');
		window.push({ day: d, n: dayCounts.get(d) || 0 });
	}
	const W = Math.min(14, Math.floor(numDays / 2));
	const firstW = window.slice(0, W);
	const lastW = window.slice(-W);
	const sum = a => a.reduce((s, x) => s + x.n, 0);
	const mean = a => a.length ? sum(a) / a.length : 0;
	const ys = window.map(x => x.n);
	const sorted = ys.slice().sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
	return {
		tail: median > 0 ? mean(lastW) / Math.max(1e-9, mean(firstW)) : 0,
		spike: median > 0 ? Math.max(...lastW.map(x => x.n)) / median : 0,
		l7c: (() => {
			const last7 = window.slice(-7);
			const m = mean(last7);
			return m > 0 ? Math.min(...last7.map(x => x.n)) / m : 0;
		})(),
	};
}

// NOTE: describe.sequential — vitest.config sets sequence.concurrent, but these
// tests share the module-scoped seeded chance (initChance per generate()). Run
// concurrently, their RNG draws interleave at await points and the metrics are
// only "deterministic" for one lucky interleaving; any change to per-event draw
// counts reshuffles it. Sequential = true per-seed determinism.
describe.sequential('engine-shape canary — per-macro baselines pass strict bar', () => {
	for (const macro of ['flat', 'steady', 'growth', 'viral', 'decline']) {
		test(`${macro} baseline (60d, rate=1.2, 500 users) clears ${macro} strict bar`, async () => {
			const { events, numDays } = await runCombo({ macro, numDays: 60 });
			const m = metricsFor(events, numDays, DATASET_END);
			const bar = BARS[macro];
			expect(m.tail).toBeGreaterThanOrEqual(bar.tail[0]);
			expect(m.tail).toBeLessThanOrEqual(bar.tail[1]);
			expect(m.spike).toBeLessThan(bar.spike);
			expect(m.l7c).toBeGreaterThanOrEqual(bar.l7c);
		}, 30000);
	}
});

describe.sequential('engine-shape canary — strict-bar invariants', () => {
	test('flat baseline produces no future-time events (storage guard intact)', async () => {
		const { events } = await runCombo({ macro: 'flat', numDays: 60 });
		const nowMs = Date.now();
		const future = events.filter(e => {
			if (!e || !e.time) return false;
			const t = typeof e.time === 'string' ? Date.parse(e.time) : Number(e.time);
			return Number.isFinite(t) && t > nowMs;
		});
		expect(future.length).toBe(0);
	}, 30000);

	test('flat baseline has no last-day cliff vs same-DOW-1-week-prior (engine future-time guard works without dead zone)', async () => {
		const { events, numDays } = await runCombo({ macro: 'flat', numDays: 60 });
		const dayCounts = new Map();
		for (const e of events) {
			if (!e?.time) continue;
			const t = typeof e.time === 'string' ? Date.parse(e.time) : Number(e.time);
			if (!Number.isFinite(t)) continue;
			const day = dayjs.utc(t).format('YYYY-MM-DD');
			dayCounts.set(day, (dayCounts.get(day) || 0) + 1);
		}
		const anchor = dayjs.utc(DATASET_END).startOf('day');
		const window = [];
		for (let i = numDays - 1; i >= 0; i--) {
			window.push(dayCounts.get(anchor.subtract(i, 'day').format('YYYY-MM-DD')) || 0);
		}
		const lastDay = window[window.length - 1];
		// Compare against same DOW one week prior to cancel soup-DOW noise (Sat/Sun
		// have weights 0.53/0.64 vs Tue=1.0; naive lastDay/prevDay is DOW-coupled).
		const sameDowPrev = window[window.length - 8];
		expect(lastDay).toBeGreaterThanOrEqual(0.7 * sameDowPrev);
	}, 30000);
});

describe('engine-shape canary — validator strict clamps', () => {
	test('user-supplied born=90 with macro=flat clamps to 12 with warning', async () => {
		const { validateDungeonConfig } = await import('../../lib/core/config-validator.js');
		const warn = console.warn;
		const messages = [];
		console.warn = (...args) => messages.push(args.join(' '));
		try {
			const config = validateDungeonConfig({
				numUsers: 100,
				numEvents: 1000,
				macro: 'flat',
				percentUsersBornInDataset: 90,
				verbose: true,  // v1.5.1: warnings now gated on verbose
				seed: 'canary-clamp',
			});
			expect(config.percentUsersBornInDataset).toBe(12);
			expect(messages.some(m => /clamped to 12/.test(m))).toBe(true);
		} finally {
			console.warn = warn;
		}
	});

	test('user-supplied bornRecentBias=0.9 clamps to 0.5 with warning', async () => {
		const { validateDungeonConfig } = await import('../../lib/core/config-validator.js');
		const warn = console.warn;
		const messages = [];
		console.warn = (...args) => messages.push(args.join(' '));
		try {
			const config = validateDungeonConfig({
				numUsers: 100,
				numEvents: 1000,
				bornRecentBias: 0.9,
				verbose: true,  // v1.5.1: warnings now gated on verbose
				seed: 'canary-clamp-bias',
			});
			expect(config.bornRecentBias).toBe(0.5);
			expect(messages.some(m => /clamped to 0\.5/.test(m))).toBe(true);
		} finally {
			console.warn = warn;
		}
	});

	test('macro=viral preset (born=55, bias=0.6) is NOT clamped — preset values are allowed', async () => {
		const { validateDungeonConfig } = await import('../../lib/core/config-validator.js');
		const warn = console.warn;
		const messages = [];
		console.warn = (...args) => messages.push(args.join(' '));
		try {
			const config = validateDungeonConfig({
				numUsers: 100,
				numEvents: 1000,
				macro: 'viral',
				seed: 'canary-viral-preset',
			});
			expect(config.percentUsersBornInDataset).toBe(55);
			expect(config.bornRecentBias).toBe(0.6);
			expect(messages.some(m => /clamped/.test(m))).toBe(false);
		} finally {
			console.warn = warn;
		}
	});
});
