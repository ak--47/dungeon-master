// Sweep dungeons for end-of-window "nosedive" pattern.
// Reports last 7 days per-dungeon + nosedive metric:
//   nosedive = (mean of days[-3:]) / (mean of days[-7:-3])
// nosedive > 0.85 = healthy. nosedive < 0.7 = visible drop. < 0.5 = bad.
import path from 'path';
import dayjs from 'dayjs';
import generate from '/Users/ak/code/dungeon-master/index.js';
import fs from 'fs';

const args = process.argv.slice(2);
const dungeonPath = args[0];
const users = Number(args[1] || 2000);
const rate = Number(args[2] || 1.2);
const days = Number(args[3] || 120);

const cfg = (await import(path.resolve(process.cwd(), dungeonPath))).default;
const override = {
	...cfg,
	token: '',
	numUsers: users,
	numDays: days,
	avgEventsPerUserPerDay: rate,
	numEvents: undefined,
	format: 'json',
	gzip: false,
	writeToDisk: false,
	concurrency: 1,
	verbose: false,
};

const r = await generate(override);
const events = r.eventData || [];
const dayCounts = new Map();
let maxMs = 0;
for (const e of events) {
	if (!e?.time) continue;
	const t = typeof e.time === 'string' ? Date.parse(e.time) : Number(e.time);
	if (!Number.isFinite(t)) continue;
	if (t > maxMs) maxMs = t;
	const d = dayjs(t).format('YYYY-MM-DD');
	dayCounts.set(d, (dayCounts.get(d) || 0) + 1);
}
const anchor = dayjs(maxMs).startOf('day');
const window = [];
for (let i = days - 1; i >= 0; i--) {
	const d = anchor.subtract(i, 'day').format('YYYY-MM-DD');
	window.push({ d, n: dayCounts.get(d) || 0 });
}
const last7 = window.slice(-7);
const last3 = last7.slice(-3);
const prior4 = last7.slice(0, 4);
const last3Avg = last3.reduce((s, x) => s + x.n, 0) / 3;
const prior4Avg = prior4.reduce((s, x) => s + x.n, 0) / 4;
const nosedive = prior4Avg ? last3Avg / prior4Avg : 0;
const ratioLastVsPrev = window[window.length - 2].n
	? window[window.length - 1].n / window[window.length - 2].n : 0;
console.log(JSON.stringify({
	dungeon: path.basename(dungeonPath),
	totalEvents: events.length,
	last3Avg: Math.round(last3Avg),
	prior4Avg: Math.round(prior4Avg),
	nosedive: +nosedive.toFixed(2),
	lastDay: window[window.length - 1].n,
	prevDay: window[window.length - 2].n,
	lastDayRatio: +ratioLastVsPrev.toFixed(2),
}));
console.log('\nLast 7 days:');
for (const d of last7) {
	const max = Math.max(...last7.map(x => x.n));
	const bar = '█'.repeat(Math.min(50, Math.round(d.n / Math.max(1, max) * 50)));
	console.log(`  ${d.d}  ${String(d.n).padStart(7)}  ${bar}`);
}
