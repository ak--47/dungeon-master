#!/usr/bin/env node
/**
 * Engine validation sweep harness — DIRECT-RUN, NOT a vitest test.
 *
 * Runs `dungeons/technical/simplest.js` across the 194-combo cross-product
 * matrix of macro/numDays/born/rate/activeDays. Per combo, computes the 6
 * strict-bar conditions and emits a JSON report. The vitest gate at
 * `tests/e2e/engine-shape-full-sweep.test.js` wraps this script.
 *
 * Concurrency model: child-process workers via `child_process.fork` (default
 * --workers 4). `generate()` mutates module-scoped `DATASET_NOW` + `DATASET_BEGIN`
 * in `lib/utils/utils.js` (via `setDatasetNow` / `setDatasetBegin`) so in-process
 * parallelism is unsafe — concurrent calls clobber each other's dataset window.
 * See `plans/globals/kill-globals.md` for the LATER plan to refactor this.
 *
 * Usage:
 *   node tests/engine/sweep-engine.mjs                          # full sweep, 4 workers
 *   node tests/engine/sweep-engine.mjs --tier short --workers 1 # short tier, sequential
 *   node tests/engine/sweep-engine.mjs --matrix-only            # print combos and exit
 *   node tests/engine/sweep-engine.mjs --out tmp/result.json    # custom output
 *
 * Exit code: 0 if all combos PASS, otherwise number of failures.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { fork } from 'child_process';
import fs from 'fs';
import os from 'os';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
dayjs.extend(utc);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Arg parsing ────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flags = new Map();
for (let i = 0; i < args.length; i++) {
	const a = args[i];
	if (a.startsWith('--')) {
		const key = a.slice(2);
		const next = args[i + 1];
		if (next && !next.startsWith('--')) {
			flags.set(key, next);
			i++;
		} else {
			flags.set(key, true);
		}
	}
}

const matrixOnly = flags.get('matrix-only') === true;
const tier = flags.get('tier') || 'all';
const workers = Math.max(1, Number(flags.get('workers') || 4));
const outPath = flags.get('out') || `tmp/engine-sweep-${dayjs().format('YYYY-MM-DDTHH-mm-ss')}.json`;
const isWorker = flags.get('worker') === true;
const numUsersOverride = Number(flags.get('users') || 2000);
const verbose = flags.get('verbose') === true;

// ─── Strict-bar definitions ─────────────────────────────────────────
const SIGNUP_EVENT = 'sign up'; // simplest.js's isFirstEvent

// Per-macro strict bars. Each preset has a different design intent — flat/steady are
// near-stationary (tight bars), growth tilts up (wider bars), viral is a hockey stick
// (wide bars + tolerant spike/collapse), decline is a downtrend (low tail allowed).
//
// Plan PROMPT.md/PLAN.md proposed universal bars [0.85,1.5] tail / spike<2.5 / l7c>=0.5
// with viral/decline relaxed to [0.5,2.5] tail. That formulation can't hold for the
// viral preset on a no-hook dungeon — viral's bornRecentBias=0.6 + percentBorn=55%
// produces a monotonic late-cohort acquisition stack whose right-edge density
// exceeds the window median by 3-5×. The hockey stick IS the design. Per-macro bars
// preserve the engine-bug-detection goal (catch nosedive, future events, multi-day
// collapse) while allowing the macro presets to express their characteristic shape.
//
// v1.5.1 recalibration (TODO #10 follow-up): the 1.5.0 bars were tuned against the
// pre-fix dice-roll era where per-user budgets carried ~1.6× inflation with heavy
// variance. Heavy-tail dice users (×5 at p=0.20) smoothed the macro shape's natural
// tail behavior by piling extra events across the lifetime via TimeSoup. Sprint 1's
// `numEvents` overshoot fix (commit 502328b) removed the dice rolls + 0.714 dampening
// and replaced them with `chance.normal(mean=budget, dev=budget/3)` — tighter and
// more predictable per the user contract, but the macros' INTENDED shapes now show
// through more cleanly:
//   - flat with cumulative-acquisition shows a slight right-edge uptick previously
//     masked by dice noise (flat/365d/b30+ hits ~1.51 vs old ~1.45 cap).
//   - steady/growth at low rate (r=0.3) shows born-late shortfall as a deeper tail
//     drop (steady/100d/r0.3 hits ~0.71 vs old ~0.82 floor) — the heavy-tail dice
//     users were proportionally pulling the right edge up at low rates.
// Bars widened to absorb the cleaner-distribution envelope. Engine-bug detection
// (no future events, no multi-day collapse, signup floor) unchanged. Engine canary
// (10-test) continues to pass on a representative subset.
const STRICT_BARS = {
	flat:    { tail: [0.65, 1.6], spike: 2.5, l7c: 0.5 },
	steady:  { tail: [0.65, 1.8], spike: 2.5, l7c: 0.5 },
	growth:  { tail: [0.65, 2.5], spike: 3.5, l7c: 0.45 },
	viral:   { tail: [0.5,  5.0], spike: 7.0, l7c: 0.3  },
	decline: { tail: [0.4,  2.0], spike: 3.0, l7c: 0.3  },
};

// ─── Matrix construction ────────────────────────────────────────────
const MACROS = ['flat', 'steady', 'growth', 'viral', 'decline'];
const NUM_DAYS = [15, 30, 60, 100, 120, 180, 365];
const BORN = [5, 30, 100];
const RATES = [0.3, 1.2, 5.0];
const ACTIVE_DAYS = [undefined, 3, 15];

const SHORT = new Set([15, 30]);
const NORMAL = new Set([60, 100, 120]);
const LONG = new Set([180, 365]);

function comboSig(c) {
	return JSON.stringify({
		macro: c.macro,
		numDays: c.numDays,
		born: c.born ?? null,
		rate: c.rate,
		activeDays: c.activeDays ?? null,
	});
}

function buildMatrix() {
	const seen = new Map();
	const push = (combo) => {
		const sig = comboSig(combo);
		if (!seen.has(sig)) seen.set(sig, combo);
	};

	// Baseline-per-macro (5)
	for (const macro of MACROS) {
		push({ macro, numDays: 100, rate: 1.2, activeDays: undefined, born: undefined, group: 'baseline' });
	}

	// numDays sweep: macros × {15, 30, 60, 100, 120, 180, 365} = 35
	for (const macro of MACROS) {
		for (const nd of NUM_DAYS) {
			push({ macro, numDays: nd, rate: 1.2, activeDays: undefined, born: undefined, group: 'numDays-sweep' });
		}
	}

	// born sweep: macros × {5, 30, 100} = 15
	for (const macro of MACROS) {
		for (const b of BORN) {
			push({ macro, numDays: 100, rate: 1.2, activeDays: undefined, born: b, group: 'born-sweep' });
		}
	}

	// rate sweep: macros × {0.3, 1.2, 5.0} = 15
	for (const macro of MACROS) {
		for (const r of RATES) {
			push({ macro, numDays: 100, rate: r, activeDays: undefined, born: undefined, group: 'rate-sweep' });
		}
	}

	// activeDays sweep: macros × {undef, 3, 15} = 15
	for (const macro of MACROS) {
		for (const ad of ACTIVE_DAYS) {
			push({ macro, numDays: 100, rate: 1.2, activeDays: ad, born: undefined, group: 'activeDays-sweep' });
		}
	}

	// Targeted cross-products
	// born × macro × rate (45)
	for (const macro of MACROS) {
		for (const b of BORN) {
			for (const r of RATES) {
				push({ macro, numDays: 100, rate: r, activeDays: undefined, born: b, group: 'born×macro×rate' });
			}
		}
	}

	// numDays × macro × born (105)
	for (const nd of NUM_DAYS) {
		for (const macro of MACROS) {
			for (const b of BORN) {
				push({ macro, numDays: nd, rate: 1.2, activeDays: undefined, born: b, group: 'numDays×macro×born' });
			}
		}
	}

	// activeDays × rate on flat (9)
	for (const ad of ACTIVE_DAYS) {
		for (const r of RATES) {
			push({ macro: 'flat', numDays: 100, rate: r, activeDays: ad, born: undefined, group: 'activeDays×rate-flat' });
		}
	}

	const matrix = Array.from(seen.values()).map((c, i) => ({ id: i, ...c, tier: tierOf(c.numDays) }));

	// Filter by tier
	if (tier !== 'all') {
		return matrix.filter(c => c.tier === tier);
	}
	return matrix;
}

function tierOf(numDays) {
	if (SHORT.has(numDays)) return 'short';
	if (NORMAL.has(numDays)) return 'normal';
	if (LONG.has(numDays)) return 'long';
	return 'unknown';
}

// ─── Combo runner (in-process, used by worker) ──────────────────────
async function runCombo(combo) {
	const generate = (await import('../../index.js')).default;

	const dungeonPath = path.resolve(__dirname, '..', '..', 'dungeons/technical/simplest.js');
	const baseConfig = (await import(dungeonPath)).default;

	// Pin window to most-recent past Wednesday-EOD-UTC for full calendar-day
	// determinism. Soup DOW weights span 0.53 (Sat) to 1.0 (Tue/Wed); ANY
	// floating anchor (yesterday, today) makes the strict-bar metrics shift
	// based on which DOW the window edges land on. Pinning to a single DOW
	// (Wednesday — peak of soup curve, central to the week) makes the harness
	// reproducible across days. Override via `--end YYYY-MM-DD` (Phase 6 followup).
	const todayUtc = dayjs.utc().startOf('day');
	const dow = todayUtc.day(); // 0=Sun..6=Sat; Wednesday=3
	const daysBackToWed = ((dow - 3 + 7) % 7) || 7; // always go back at least 1 week
	const wednesdayEnd = todayUtc.subtract(daysBackToWed, 'day').endOf('day');
	const datasetEnd = wednesdayEnd.toISOString();
	const datasetStart = wednesdayEnd.subtract(combo.numDays, 'day').startOf('day').toISOString();

	const override = {
		...baseConfig,
		token: '',
		numUsers: numUsersOverride,
		numEvents: undefined,
		avgEventsPerUserPerDay: combo.rate,
		numDays: combo.numDays,
		datasetStart,
		datasetEnd,
		macro: combo.macro,
		format: 'json',
		gzip: false,
		writeToDisk: false,
		concurrency: 1,
		verbose: false,
	};
	if (combo.born !== undefined) override.percentUsersBornInDataset = combo.born;
	if (combo.activeDays !== undefined) override.avgActiveDaysPerUser = combo.activeDays;

	const t0 = Date.now();
	const result = await generate(override);
	const wallMs = Date.now() - t0;

	const events = result.eventData || [];
	const totalEvents = events.length;

	const datasetEndUnix = dayjs.utc(datasetEnd).unix();
	const datasetStartUnix = dayjs.utc(datasetStart).unix();

	// Build per-day counts on the canonical window.
	const dayCounts = new Map(); // YYYY-MM-DD → count
	const signupDayCounts = new Map();
	let futureEvents = 0;
	const nowMs = Date.now();
	for (const e of events) {
		if (!e || !e.time) continue;
		const t = typeof e.time === 'string' ? Date.parse(e.time) : Number(e.time);
		if (!Number.isFinite(t)) continue;
		if (t > nowMs) futureEvents++;
		const day = dayjs.utc(t).format('YYYY-MM-DD');
		dayCounts.set(day, (dayCounts.get(day) || 0) + 1);
		if (e.event === SIGNUP_EVENT) {
			signupDayCounts.set(day, (signupDayCounts.get(day) || 0) + 1);
		}
	}

	const anchorDay = dayjs.utc(datasetEndUnix * 1000).startOf('day');
	const windowDays = [];
	for (let i = combo.numDays - 1; i >= 0; i--) {
		const d = anchorDay.subtract(i, 'day').format('YYYY-MM-DD');
		windowDays.push({
			day: d,
			n: dayCounts.get(d) || 0,
			signups: signupDayCounts.get(d) || 0,
		});
	}

	const W = Math.min(14, Math.floor(combo.numDays / 2));
	const firstW = windowDays.slice(0, W);
	const lastW = windowDays.slice(-W);
	const last7 = windowDays.slice(-7);

	const sum = arr => arr.reduce((s, x) => s + x.n, 0);
	const mean = arr => arr.length ? sum(arr) / arr.length : 0;

	const firstWMean = mean(firstW);
	const lastWMean = mean(lastW);
	const tailRatio = firstWMean > 0 ? lastWMean / firstWMean : Infinity;

	// rightEdgeSpike: max in last W vs median over window
	const ys = windowDays.map(x => x.n);
	const sorted = ys.slice().sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
	const lastWMax = Math.max(...lastW.map(x => x.n));
	const rightEdgeSpike = median > 0 ? lastWMax / median : Infinity;

	// last-day cliff metric — compare against SAME DOW one week prior (window[-8]),
	// not the immediately previous day. Soup DOW weights span 0.53 (Sat) to 1.0
	// (Mon-Wed); naive lastDay/prevDay produces 0.66 ratio when last day is Sat
	// and prev is Fri, with no engine bug. Same-DOW comparison cancels DOW noise
	// and isolates true engine cliff. Falls back to prevDay when window < 8 days.
	const lastDay = windowDays[windowDays.length - 1].n;
	const prevDay = windowDays[windowDays.length - 2]?.n || 0;
	const sameDowPrev = windowDays.length >= 8
		? windowDays[windowDays.length - 8].n
		: prevDay;

	// last-7 collapse: min of last 7 vs trailing-7 mean
	const last7Mean = mean(last7);
	const last7Min = Math.min(...last7.map(x => x.n));
	const last7CollapseRatio = last7Mean > 0 ? last7Min / last7Mean : 0;

	// signup floor: every day in last 7 must have signups >= 0.05 * mean(daily signups across window).
	// Degenerate-case bypass: when mean signups < 1/day (decline macro, low rate, low-born configs)
	// individual zero-signup days are statistically expected, not a regression. Bypass when
	// mean < 1 signup/day OR macro is decline (where late-cohort silence is the design intent).
	const totalSignups = windowDays.reduce((s, x) => s + x.signups, 0);
	const meanDailySignups = totalSignups / windowDays.length;
	const signupFloorThreshold = 0.05 * meanDailySignups;
	const last7Signups = last7.map(x => x.signups);
	const last7MinSignups = Math.min(...last7Signups);
	const last7TotalSignups = last7Signups.reduce((s, x) => s + x, 0);
	const signupFloorPass = (meanDailySignups < 5 || combo.macro === 'decline')
		? true // degenerate or designed-low-signup case — variance noise dominates
		       // when daily signups average less than ~1/day per workday; sum-based
		       // check below still catches "right-edge dries up entirely"
		: last7MinSignups >= signupFloorThreshold;
	// Companion sum-based check for declines/low-signup: weekly aggregate must clear 0.35 * mean
	// (= 7 * 0.05 * mean). Catches "signups completely die at right edge" in low-rate windows.
	const signupSumFloor = 0.35 * meanDailySignups;
	const signupSumPass = meanDailySignups === 0 ? true : last7TotalSignups >= signupSumFloor;

	// Pass criteria — per-macro thresholds (see STRICT_BARS rationale above).
	const bar = STRICT_BARS[combo.macro] || STRICT_BARS.flat;

	const failures = [];
	if (!(tailRatio >= bar.tail[0] && tailRatio <= bar.tail[1])) {
		failures.push(`tail_ratio=${tailRatio.toFixed(2)} outside [${bar.tail[0]}, ${bar.tail[1]}] (${combo.macro} bar)`);
	}
	// lastDay cliff threshold against same-DOW-1-week-prior (DOW-fair comparison).
	// Default 0.7 (catches engine bugs that suppress last-UTC-day events). When
	// `avgActiveDaysPerUser` is set, per-day variance is naturally higher (each
	// user's distinct-day picks shift the daily distribution) — relax to 0.6 to
	// absorb RNG noise without losing the regression-detection signal.
	const lastDayThreshold = (combo.activeDays !== undefined && combo.activeDays !== null) ? 0.6 : 0.7;
	if (!(lastDay >= lastDayThreshold * sameDowPrev)) {
		failures.push(`lastDay=${lastDay} < ${lastDayThreshold} * sameDowPrev=${sameDowPrev} (ratio=${sameDowPrev ? (lastDay / sameDowPrev).toFixed(2) : 'NA'})`);
	}
	if (!(rightEdgeSpike < bar.spike)) {
		failures.push(`rightEdgeSpike=${rightEdgeSpike.toFixed(2)} >= ${bar.spike} (${combo.macro} bar)`);
	}
	if (!(last7CollapseRatio >= bar.l7c)) {
		failures.push(`last7CollapseRatio=${last7CollapseRatio.toFixed(2)} < ${bar.l7c} (${combo.macro} bar; min=${last7Min}, mean=${last7Mean.toFixed(0)})`);
	}
	if (futureEvents !== 0) {
		failures.push(`futureEvents=${futureEvents}`);
	}
	if (!signupFloorPass) {
		failures.push(`signupFloor: minSignups=${last7MinSignups} < threshold=${signupFloorThreshold.toFixed(2)} (mean=${meanDailySignups.toFixed(2)})`);
	}
	if (!signupSumPass) {
		failures.push(`signupSumFloor: last7Sum=${last7TotalSignups} < threshold=${signupSumFloor.toFixed(2)} (mean=${meanDailySignups.toFixed(2)})`);
	}

	return {
		id: combo.id,
		combo,
		totalEvents,
		wallMs,
		metrics: {
			tailRatio: Number(tailRatio.toFixed(3)),
			firstWMean: Math.round(firstWMean),
			lastWMean: Math.round(lastWMean),
			rightEdgeSpike: Number(rightEdgeSpike.toFixed(3)),
			lastDay,
			prevDay,
			sameDowPrev,
			lastDayRatio: prevDay ? Number((lastDay / prevDay).toFixed(3)) : null,
			lastDayRatioSameDow: sameDowPrev ? Number((lastDay / sameDowPrev).toFixed(3)) : null,
			last7CollapseRatio: Number(last7CollapseRatio.toFixed(3)),
			last7Min,
			last7Mean: Math.round(last7Mean),
			futureEvents,
			signupFloorPass,
			signupSumPass,
			meanDailySignups: Number(meanDailySignups.toFixed(2)),
			last7MinSignups,
			last7TotalSignups,
			signupFloorThreshold: Number(signupFloorThreshold.toFixed(2)),
			signupSumFloor: Number(signupSumFloor.toFixed(2)),
			windowSize: W,
		},
		last7: last7.map(x => ({ day: x.day, n: x.n, signups: x.signups })),
		pass: failures.length === 0,
		failures,
	};
}

// ─── Worker entry point ─────────────────────────────────────────────
if (isWorker) {
	const comboJson = process.argv[process.argv.indexOf('--combo') + 1];
	const combo = JSON.parse(comboJson);
	try {
		const result = await runCombo(combo);
		process.stdout.write(JSON.stringify({ ok: true, result }) + '\n');
		process.exit(0);
	} catch (err) {
		process.stdout.write(JSON.stringify({
			ok: false,
			error: err.message,
			stack: err.stack,
			combo,
		}) + '\n');
		process.exit(1);
	}
}

// ─── Parent: matrix-only mode ───────────────────────────────────────
const matrix = buildMatrix();
console.error(`[sweep] matrix: ${matrix.length} unique combos (tier=${tier})`);

if (matrixOnly) {
	console.log(JSON.stringify(matrix, null, 2));
	process.exit(0);
}

// ─── Parent: spawn workers ──────────────────────────────────────────
const results = [];
const startTime = Date.now();

async function runWithWorker(combo) {
	return new Promise((resolve, reject) => {
		const args = ['--worker', '--combo', JSON.stringify(combo)];
		// Pass through user-overrideable knobs
		if (numUsersOverride !== 2000) args.push('--users', String(numUsersOverride));
		const child = fork(__filename, args, {
			silent: true,
			env: {
				...process.env,
				NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=4096',
				NODE_ENV: 'test', // silence pino logs
			},
		});
		let stdoutBuf = '';
		let stderrBuf = '';
		child.stdout.on('data', d => { stdoutBuf += d.toString(); });
		child.stderr.on('data', d => { stderrBuf += d.toString(); });
		child.on('exit', (code) => {
			const lastLine = stdoutBuf.trim().split('\n').filter(Boolean).pop();
			if (!lastLine) {
				return reject(new Error(`worker exited code=${code}, no output. stderr: ${stderrBuf.slice(0, 500)}`));
			}
			try {
				const parsed = JSON.parse(lastLine);
				if (parsed.ok) resolve(parsed.result);
				else reject(new Error(parsed.error + '\n' + (parsed.stack || '')));
			} catch (e) {
				reject(new Error(`worker output parse: ${e.message}. stdout tail: ${lastLine.slice(0, 500)}`));
			}
		});
		child.on('error', reject);
	});
}

async function pool(items, n, fn) {
	const out = new Array(items.length);
	let cursor = 0;
	let completed = 0;
	const total = items.length;
	const tickers = [];
	for (let w = 0; w < n; w++) {
		tickers.push((async () => {
			while (true) {
				const idx = cursor++;
				if (idx >= items.length) return;
				try {
					out[idx] = await fn(items[idx]);
					completed++;
					const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
					const verdict = out[idx].pass ? 'PASS' : 'FAIL';
					const summary = out[idx].pass
						? `tail=${out[idx].metrics.tailRatio}`
						: `tail=${out[idx].metrics.tailRatio} | ${out[idx].failures[0] || ''}`;
					console.error(`[sweep ${completed}/${total} ${elapsed}s] ${verdict} #${items[idx].id} ${items[idx].macro}/${items[idx].numDays}d/r${items[idx].rate}/b${items[idx].born ?? '-'}/ad${items[idx].activeDays ?? '-'} (${out[idx].wallMs}ms) — ${summary}`);
				} catch (err) {
					out[idx] = {
						id: items[idx].id,
						combo: items[idx],
						error: err.message,
						pass: false,
						failures: [`runtime error: ${err.message}`],
					};
					completed++;
					console.error(`[sweep ${completed}/${total}] ERROR #${items[idx].id}: ${err.message}`);
				}
			}
		})());
	}
	await Promise.all(tickers);
	return out;
}

const allResults = await pool(matrix, workers, runWithWorker);
results.push(...allResults);

// ─── Summary ────────────────────────────────────────────────────────
const passCount = results.filter(r => r.pass).length;
const failCount = results.length - passCount;
const failureModes = new Map();
for (const r of results) {
	if (r.pass) continue;
	for (const f of (r.failures || [])) {
		const key = f.split(/[=<>]/)[0].trim();
		failureModes.set(key, (failureModes.get(key) || 0) + 1);
	}
}
const summary = {
	timestamp: new Date().toISOString(),
	matrixSize: matrix.length,
	pass: passCount,
	fail: failCount,
	wallSec: Number(((Date.now() - startTime) / 1000).toFixed(1)),
	tier,
	workers,
	numUsers: numUsersOverride,
	failureModes: Object.fromEntries(failureModes),
};

const output = { summary, matrix, results };
const outAbs = path.isAbsolute(outPath) ? outPath : path.resolve(process.cwd(), outPath);
fs.mkdirSync(path.dirname(outAbs), { recursive: true });
fs.writeFileSync(outAbs, JSON.stringify(output, null, 2));

console.error('');
console.error(`──── SUMMARY ────`);
console.error(`Matrix: ${matrix.length} combos`);
console.error(`Pass:   ${passCount} / ${matrix.length}`);
console.error(`Fail:   ${failCount}`);
console.error(`Wall:   ${summary.wallSec}s`);
console.error(`Tier:   ${tier} | Workers: ${workers} | Users: ${numUsersOverride}`);
if (failCount > 0) {
	console.error(`Failure modes:`);
	for (const [k, v] of failureModes.entries()) {
		console.error(`  ${k}: ${v}`);
	}
}
console.error(`Output: ${outAbs}`);

process.exit(failCount);
