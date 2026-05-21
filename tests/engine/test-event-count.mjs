#!/usr/bin/env node
// v1.5.1 (TODO #10): assert `numEvents` overshoot stays inside ±15% per macro.
//
// Pre-TODO #10, the engine overshot by 1.6-2.0x via:
//   - 0.714 magic dampening + ×5/×0.333 dice rolls (E[mult]=1.16x)
//   - funnel-chunk overshoot at the budget ceiling (~5-15% additional)
// Post-TODO #10:
//   - dice rolls + dampening removed (pure normal distribution)
//   - `useFunnel` gate redirects budget-boundary iterations to standalone
//     (avoids funnel `(len-1)` overshoot per terminal iteration)
//
// Run: `node tests/engine/test-event-count.mjs [--target 100000]`

import DUNGEON_MASTER from '../../index.js';
import dayjs from 'dayjs';

const TARGET = (() => {
	const idx = process.argv.indexOf('--target');
	if (idx >= 0 && process.argv[idx + 1]) return Number(process.argv[idx + 1]);
	return 50_000; // smaller default for fast iteration; raise via --target.
})();
const MACROS = ['flat', 'steady', 'growth', 'viral', 'decline'];
const TOLERANCE = 0.15; // ±15% per resolution (e).

const FIXED_NOW = dayjs('2024-02-02').unix();
const DATASET_BEGIN = FIXED_NOW - 60 * 86400;

const results = [];
for (const macro of MACROS) {
	const result = await DUNGEON_MASTER({
		datasetStart: DATASET_BEGIN,
		datasetEnd: FIXED_NOW,
		writeToDisk: false,
		verbose: false,
		concurrency: 1,
		seed: `numEvents-${macro}`,
		numUsers: 1_000,
		numDays: 60,
		numEvents: TARGET,
		macro,
		// Pin pre-existing only so the test measures the BUDGET MATH in
		// isolation — born-in users get less active time which produces a
		// macro-dependent undershoot (`rate × numDays` assumes full-window
		// activity per user, but born-late users have less time). Real-world
		// dungeons accept that undershoot; this test asserts the math fix.
		percentUsersBornInDataset: 0,
		events: [{ event: 'view', weight: 5 }, { event: 'click', weight: 3 }, { event: 'convert', weight: 1 }],
	});
	const actual = Array.from(result.eventData).length;
	const delta = (actual - TARGET) / TARGET;
	const pass = Math.abs(delta) <= TOLERANCE;
	results.push({ macro, target: TARGET, actual, delta, pass });
}

const W_MACRO = 10, W_NUM = 10, W_PCT = 8;
console.log('');
console.log(`numEvents overshoot test — target ${TARGET.toLocaleString()}, tolerance ±${(TOLERANCE * 100).toFixed(0)}%`);
console.log('');
console.log(`${'macro'.padEnd(W_MACRO)} ${'target'.padStart(W_NUM)} ${'actual'.padStart(W_NUM)} ${'delta'.padStart(W_PCT)} verdict`);
console.log('-'.repeat(W_MACRO + W_NUM * 2 + W_PCT + 12));
let passed = 0;
for (const r of results) {
	const pct = `${(r.delta * 100).toFixed(1)}%`;
	const verdict = r.pass ? 'PASS' : 'FAIL';
	console.log(
		`${r.macro.padEnd(W_MACRO)} ${r.target.toLocaleString().padStart(W_NUM)} ${r.actual.toLocaleString().padStart(W_NUM)} ${pct.padStart(W_PCT)} ${verdict}`
	);
	if (r.pass) passed++;
}
console.log('');
console.log(`${passed}/${results.length} macros within tolerance`);
process.exit(passed === results.length ? 0 : 1);
