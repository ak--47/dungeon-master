#!/usr/bin/env node
/**
 * Targeted bornRecentBias exploration — DIRECT-RUN, NOT a vitest test.
 *
 * Usage: node tests/engine/sweep-bias.mjs
 *
 * Tests TWO things:
 *
 *  1. PRE-CLAMP shape — bypasses validator by setting bias via macro override
 *     object (preset values exempt from clamp). What does each bias × born
 *     combination ACTUALLY produce?
 *
 *  2. POST-CLAMP shape — uses the user-explicit path (which DOES trigger
 *     clamps). Verifies clamps rescue the dangerous combos.
 *
 * Output: tmp/bias-sweep-<ISO>.json + console table.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { fork } from 'child_process';
import fs from 'fs';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
dayjs.extend(utc);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
const isWorker = args.includes('--worker');

// Bar from main sweep — flat preset baseline
const FLAT_BAR = { tail: [0.85, 1.5], spike: 2.5, l7c: 0.5 };

// Per-macro relaxations match scripts/sweep-engine.mjs
const STRICT_BARS = {
	flat:    { tail: [0.85, 1.5], spike: 2.5, l7c: 0.5  },
	steady:  { tail: [0.85, 1.7], spike: 2.5, l7c: 0.5  },
	growth:  { tail: [0.85, 2.5], spike: 3.5, l7c: 0.45 },
	viral:   { tail: [0.5,  5.0], spike: 7.0, l7c: 0.3  },
	decline: { tail: [0.4,  2.0], spike: 3.0, l7c: 0.3  },
};

async function runCombo(combo) {
	const generate = (await import('../../index.js')).default;
	const baseConfig = (await import(path.resolve(__dirname, '..', '..', 'dungeons/technical/simplest.js'))).default;

	const datasetEnd = dayjs.utc().subtract(1, 'day').endOf('day').toISOString();
	const datasetStart = dayjs.utc(datasetEnd).subtract(combo.numDays, 'day').startOf('day').toISOString();

	const override = {
		...baseConfig,
		token: '',
		numUsers: 2000,
		numEvents: undefined,
		avgEventsPerUserPerDay: 1.2,
		numDays: combo.numDays,
		datasetStart,
		datasetEnd,
		format: 'json',
		gzip: false,
		writeToDisk: false,
		concurrency: 1,
		verbose: false,
	};

	if (combo.mode === 'preset-bypass') {
		// Use macro object form — pass bias/born as preset overrides.
		// resolveMacro merges them as { ...preset, ...overrides } — these come
		// from "the macro" not "the user", so my user-explicit clamp gates
		// (`userBornExplicit`, `userBiasExplicit`) do NOT fire. This isolates
		// raw engine behavior from validator clamping.
		override.macro = {
			preset: combo.macro,
			bornRecentBias: combo.bias,
			percentUsersBornInDataset: combo.born,
		};
	} else if (combo.mode === 'user-explicit') {
		// Top-level fields — userBornExplicit/userBiasExplicit fire, clamps engage.
		override.macro = combo.macro;
		override.bornRecentBias = combo.bias;
		override.percentUsersBornInDataset = combo.born;
	}

	const result = await generate(override);
	const events = result.eventData || [];

	// Compute metrics
	const dayCounts = new Map();
	for (const e of events) {
		if (!e?.time) continue;
		const t = typeof e.time === 'string' ? Date.parse(e.time) : Number(e.time);
		if (!Number.isFinite(t)) continue;
		const d = dayjs.utc(t).format('YYYY-MM-DD');
		dayCounts.set(d, (dayCounts.get(d) || 0) + 1);
	}
	const anchor = dayjs.utc(datasetEnd).startOf('day');
	const window = [];
	for (let i = combo.numDays - 1; i >= 0; i--) {
		window.push(dayCounts.get(anchor.subtract(i, 'day').format('YYYY-MM-DD')) || 0);
	}
	const W = Math.min(14, Math.floor(combo.numDays / 2));
	const firstWMean = window.slice(0, W).reduce((s, x) => s + x, 0) / W;
	const lastWMean = window.slice(-W).reduce((s, x) => s + x, 0) / W;
	const tail = firstWMean > 0 ? lastWMean / firstWMean : Infinity;
	const sorted = window.slice().sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
	const spike = median > 0 ? Math.max(...window.slice(-W)) / median : Infinity;
	const last7 = window.slice(-7);
	const last7Mean = last7.reduce((s, x) => s + x, 0) / 7;
	const l7c = last7Mean > 0 ? Math.min(...last7) / last7Mean : 0;

	const bar = STRICT_BARS[combo.macro];
	const inBand = tail >= bar.tail[0] && tail <= bar.tail[1] && spike < bar.spike && l7c >= bar.l7c;

	// Capture resolved (post-clamp) values
	return {
		combo,
		resolvedBias: result.config?.bornRecentBias ?? null,
		resolvedBorn: result.config?.percentUsersBornInDataset ?? null,
		tail: Number(tail.toFixed(3)),
		spike: Number(spike.toFixed(3)),
		l7c: Number(l7c.toFixed(3)),
		lastDay: window[window.length - 1],
		prevDay: window[window.length - 2] || 0,
		inBand,
	};
}

if (isWorker) {
	const comboJson = process.argv[process.argv.indexOf('--combo') + 1];
	try {
		const result = await runCombo(JSON.parse(comboJson));
		process.stdout.write(JSON.stringify({ ok: true, result }) + '\n');
		process.exit(0);
	} catch (err) {
		process.stdout.write(JSON.stringify({ ok: false, error: err.message, stack: err.stack }) + '\n');
		process.exit(1);
	}
}

// ─── Build matrix ─────────────────────────────────────────────────────
function buildMatrix() {
	const combos = [];

	// Test 1: PRE-CLAMP — what does raw engine do across bias values?
	// Pin born=30 (typical user explicit value). macro=growth (preset bias=0.3, born=30).
	// Override bias to span the range [-0.7, 0.7]. Use macro-object form to bypass clamp.
	for (const bias of [-0.7, -0.5, -0.3, -0.1, 0, 0.1, 0.3, 0.5, 0.7]) {
		combos.push({ mode: 'preset-bypass', macro: 'growth', born: 30, bias, numDays: 100, label: `pre-clamp` });
	}

	// Test 2: PRE-CLAMP — bias × numDays interaction (does longer window amplify?)
	for (const nd of [60, 180, 365]) {
		for (const bias of [-0.5, 0, 0.5]) {
			combos.push({ mode: 'preset-bypass', macro: 'growth', born: 30, bias, numDays: nd, label: `pre-clamp-nd` });
		}
	}

	// Test 3: PRE-CLAMP — compound stress (high born + high bias) WITHOUT clamp
	for (const born of [40, 60, 80]) {
		for (const bias of [0.3, 0.5, 0.7]) {
			combos.push({ mode: 'preset-bypass', macro: 'growth', born, bias, numDays: 100, label: `pre-clamp-compound` });
		}
	}

	// Test 4: POST-CLAMP — same compound stress via user-explicit path (clamps fire)
	for (const born of [40, 60, 80]) {
		for (const bias of [0.3, 0.5, 0.7]) {
			combos.push({ mode: 'user-explicit', macro: 'growth', born, bias, numDays: 100, label: `post-clamp-compound` });
		}
	}

	// Test 5: POST-CLAMP — out-of-range bias on flat (should clamp)
	for (const bias of [0.6, 0.7, -0.6, -0.7]) {
		combos.push({ mode: 'user-explicit', macro: 'flat', born: 12, bias, numDays: 100, label: `post-clamp-bias-extreme` });
	}

	return combos.map((c, i) => ({ id: i, ...c }));
}

const matrix = buildMatrix();
console.error(`[bias-sweep] ${matrix.length} combos`);

async function runWithWorker(combo) {
	return new Promise((resolve, reject) => {
		const child = fork(__filename, ['--worker', '--combo', JSON.stringify(combo)], {
			silent: true,
			env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=4096', NODE_ENV: 'test' },
		});
		let out = '', err = '';
		child.stdout.on('data', d => { out += d.toString(); });
		child.stderr.on('data', d => { err += d.toString(); });
		child.on('exit', () => {
			const last = out.trim().split('\n').filter(Boolean).pop();
			if (!last) return reject(new Error(`worker no output. stderr: ${err.slice(0, 500)}`));
			try {
				const p = JSON.parse(last);
				if (p.ok) resolve(p.result); else reject(new Error(p.error));
			} catch (e) { reject(new Error(`parse: ${e.message}: ${last.slice(0, 300)}`)); }
		});
	});
}

const results = [];
const start = Date.now();
const workers = 4;
let cursor = 0, done = 0;
async function workerLoop() {
	while (true) {
		const idx = cursor++;
		if (idx >= matrix.length) return;
		try {
			results[idx] = await runWithWorker(matrix[idx]);
		} catch (e) {
			results[idx] = { combo: matrix[idx], error: e.message, inBand: false };
		}
		done++;
		const elapsed = ((Date.now() - start) / 1000).toFixed(0);
		const r = results[idx];
		console.error(`[${done}/${matrix.length} ${elapsed}s] ${r.inBand ? 'IN-BAND' : 'OUT'} ${r.combo.label} bias=${r.combo.bias} born=${r.combo.born} nd=${r.combo.numDays} → tail=${r.tail} spike=${r.spike} l7c=${r.l7c}`);
	}
}
await Promise.all(Array.from({ length: workers }, workerLoop));

const out = `tmp/bias-sweep-${dayjs().format('YYYY-MM-DDTHH-mm-ss')}.json`;
fs.writeFileSync(out, JSON.stringify({ matrix, results }, null, 2));
console.error(`\nOutput: ${out}`);

// Summary table
console.log('\n=== PRE-CLAMP: bias sweep at born=30, growth, 100d ===');
console.log('bias   | tail   spike  l7c    | in-band?');
for (const r of results) {
	if (r.combo.label !== 'pre-clamp') continue;
	console.log(`${String(r.combo.bias).padStart(6)} | ${String(r.tail).padEnd(6)} ${String(r.spike).padEnd(6)} ${String(r.l7c).padEnd(6)} | ${r.inBand ? '✓' : '✗'}`);
}

console.log('\n=== PRE-CLAMP: bias × numDays at born=30, growth ===');
console.log('nd  | bias   | tail   spike  l7c');
for (const r of results) {
	if (r.combo.label !== 'pre-clamp-nd') continue;
	console.log(`${String(r.combo.numDays).padStart(3)} | ${String(r.combo.bias).padStart(6)} | ${String(r.tail).padEnd(6)} ${String(r.spike).padEnd(6)} ${String(r.l7c).padEnd(6)} | ${r.inBand ? '✓' : '✗'}`);
}

console.log('\n=== PRE-CLAMP: compound stress (born × bias) growth, 100d ===');
console.log('born | bias  | tail   spike  l7c');
for (const r of results) {
	if (r.combo.label !== 'pre-clamp-compound') continue;
	console.log(`${String(r.combo.born).padStart(4)} | ${String(r.combo.bias).padStart(5)} | ${String(r.tail).padEnd(6)} ${String(r.spike).padEnd(6)} ${String(r.l7c).padEnd(6)} | ${r.inBand ? '✓' : '✗'}`);
}

console.log('\n=== POST-CLAMP: same compound via user-explicit (clamps fire) ===');
console.log('born | bias  | resolved-born | resolved-bias | tail   spike  l7c');
for (const r of results) {
	if (r.combo.label !== 'post-clamp-compound') continue;
	console.log(`${String(r.combo.born).padStart(4)} | ${String(r.combo.bias).padStart(5)} | ${String(r.resolvedBorn).padEnd(13)} | ${String(r.resolvedBias).padEnd(13)} | ${String(r.tail).padEnd(6)} ${String(r.spike).padEnd(6)} ${String(r.l7c).padEnd(6)} | ${r.inBand ? '✓' : '✗'}`);
}

console.log('\n=== POST-CLAMP: bias extremes on flat ===');
console.log('bias  | resolved-bias | tail   spike  l7c');
for (const r of results) {
	if (r.combo.label !== 'post-clamp-bias-extreme') continue;
	console.log(`${String(r.combo.bias).padStart(5)} | ${String(r.resolvedBias).padEnd(13)} | ${String(r.tail).padEnd(6)} ${String(r.spike).padEnd(6)} ${String(r.l7c).padEnd(6)} | ${r.inBand ? '✓' : '✗'}`);
}

const outOfBand = results.filter(r => !r.inBand);
console.log(`\n${outOfBand.length} / ${results.length} out-of-band`);
process.exit(0);
