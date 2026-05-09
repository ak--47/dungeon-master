/**
 * Bunchiness measurement script for engine regression hunt.
 *
 * Runs a dungeon in-memory at controlled scale, computes:
 *   - tail_ratio = mean(events_last_14d) / mean(events_first_14d)
 *   - last7_share, slope_per_day, future_events
 *   - Per-day DOD counts for last 14 days (eyeball)
 *
 * Usage:
 *   node scripts/test-bunchiness.mjs <dungeon-path> [--users N] [--rate R] [--days D] [--macro PRESET]
 *
 * Examples:
 *   node scripts/test-bunchiness.mjs dungeons/technical/foobar.js --users 2000 --rate 3.0 --days 89
 *   node scripts/test-bunchiness.mjs dungeons/technical/foobar.js --macro viral
 */
import path from 'path';
import dayjs from 'dayjs';
import generate from '../index.js';

const args = process.argv.slice(2);
const positional = args.filter(a => !a.startsWith('--'));
const flagMap = new Map();
for (let i = 0; i < args.length; i++) {
	const a = args[i];
	if (a.startsWith('--')) {
		const key = a.slice(2);
		const next = args[i + 1];
		if (next && !next.startsWith('--')) {
			flagMap.set(key, next);
			i++;
		} else {
			flagMap.set(key, true);
		}
	}
}

const dungeonPath = positional[0];
if (!dungeonPath) {
	console.error('Usage: node scripts/test-bunchiness.mjs <dungeon-path> [--users N] [--rate R] [--days D] [--macro PRESET]');
	process.exit(1);
}

const numUsers = Number(flagMap.get('users') || 2000);
const rate = Number(flagMap.get('rate') || 3.0);
const numDays = Number(flagMap.get('days') || 89);
const macroFlag = flagMap.get('macro');

const absolutePath = path.isAbsolute(dungeonPath)
	? dungeonPath
	: path.resolve(process.cwd(), dungeonPath);

const { default: config } = await import(absolutePath);

const override = {
	...config,
	token: '',
	numUsers,
	numDays,
	avgEventsPerUserPerDay: rate,
	numEvents: undefined,
	format: 'json',
	gzip: false,
	writeToDisk: false,
	concurrency: 1,
	verbose: false,
};
if (macroFlag) {
	override.macro = macroFlag;
}

const t0 = Date.now();
const result = await generate(override);
const wallMs = Date.now() - t0;

const events = result.eventData || [];
const totalEvents = events.length;

// Anchor canonical window on the LATEST event timestamp (or today if no datasetEnd
// in dungeon). For dungeons with explicit datasetStart/datasetEnd, the engine pins
// FIXED_NOW to the configured end — so we anchor on the latest observed event time.
const dayCounts = new Map();
let futureEvents = 0;
const nowMs = Date.now();
let maxEventMs = 0;
for (const e of events) {
	if (!e || !e.time) continue;
	const t = typeof e.time === 'string' ? Date.parse(e.time) : Number(e.time);
	if (!Number.isFinite(t)) continue;
	if (t > nowMs) futureEvents++;
	if (t > maxEventMs) maxEventMs = t;
	const day = dayjs(t).format('YYYY-MM-DD');
	dayCounts.set(day, (dayCounts.get(day) || 0) + 1);
}

// Build sorted day list
const sortedDays = Array.from(dayCounts.keys()).sort();
if (sortedDays.length === 0) {
	console.log(JSON.stringify({ error: 'no events', totalEvents, wallMs }));
	process.exit(0);
}

// Canonical window: last `numDays` days ending at the dataset end (= max event time
// rounded up to its UTC day end).
const anchorMs = maxEventMs || Date.now();
const anchorDay = dayjs(anchorMs).startOf('day');
const windowDays = [];
for (let i = numDays - 1; i >= 0; i--) {
	const d = anchorDay.subtract(i, 'day').format('YYYY-MM-DD');
	windowDays.push({ day: d, n: dayCounts.get(d) || 0 });
}

// First 14 vs last 14
const first14 = windowDays.slice(0, 14);
const last14 = windowDays.slice(-14);
const first14Mean = first14.reduce((s, x) => s + x.n, 0) / 14;
const last14Mean = last14.reduce((s, x) => s + x.n, 0) / 14;
const tailRatio = first14Mean > 0 ? last14Mean / first14Mean : Infinity;

// last7 share
const last7 = windowDays.slice(-7);
const last7Sum = last7.reduce((s, x) => s + x.n, 0);
const windowTotal = windowDays.reduce((s, x) => s + x.n, 0);
const last7Share = windowTotal > 0 ? last7Sum / windowTotal : 0;

// Slope per day (simple linear regression over canonical window)
const xs = windowDays.map((_, i) => i);
const ys = windowDays.map(x => x.n);
const meanX = xs.reduce((s, x) => s + x, 0) / xs.length;
const meanY = ys.reduce((s, y) => s + y, 0) / ys.length;
let num = 0, den = 0;
for (let i = 0; i < xs.length; i++) {
	num += (xs[i] - meanX) * (ys[i] - meanY);
	den += (xs[i] - meanX) ** 2;
}
const slope = den > 0 ? num / den : 0;

// Right edge spike
const median = (() => {
	const sorted = ys.slice().sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
})();
const last14Max = Math.max(...last14.map(x => x.n));
const rightEdgeSpike = median > 0 ? last14Max / median : Infinity;

const summary = {
	dungeon: path.basename(dungeonPath),
	macro: macroFlag || '(default)',
	numUsers,
	rate,
	numDays,
	totalEvents,
	tailRatio: Number(tailRatio.toFixed(2)),
	first14Mean: Number(first14Mean.toFixed(0)),
	last14Mean: Number(last14Mean.toFixed(0)),
	last7Share: Number((last7Share * 100).toFixed(1)) + '%',
	slopePerDay: Number(slope.toFixed(2)),
	rightEdgeSpike: Number(rightEdgeSpike.toFixed(2)),
	futureEvents,
	wallMs,
};

console.log(JSON.stringify(summary, null, 2));
console.log('');
console.log('Last 14 days DOD:');
for (const d of last14) {
	const bar = '█'.repeat(Math.min(80, Math.round(d.n / Math.max(1, last14Max) * 50)));
	console.log(`  ${d.day}  ${String(d.n).padStart(6)}  ${bar}`);
}
console.log('');
console.log('First 14 days DOD:');
for (const d of first14) {
	const bar = '█'.repeat(Math.min(80, Math.round(d.n / Math.max(1, last14Max) * 50)));
	console.log(`  ${d.day}  ${String(d.n).padStart(6)}  ${bar}`);
}
