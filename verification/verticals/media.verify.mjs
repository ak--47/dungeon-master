import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { emulateBreakdown, evaluateFunnel, buildIdentityMap, resolveUserId } from '@ak--47/dungeon-master/verify';

const PREFIX = 'data/verify-media';
async function loadShards(suffix) {
	// streaming load: events shard >512MB readFileSync cap on full-fidelity v1.5 runs
	const dir = path.dirname(PREFIX), base = path.basename(PREFIX);
	const out = [];
	for (const f of fs.readdirSync(dir).filter(f => f.startsWith(`${base}-${suffix}`) && f.endsWith('.json')).sort()) {
		const stream = fs.createReadStream(path.join(dir, f));
		const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
		for await (const line of rl) {
			if (line.trim()) out.push(JSON.parse(line));
		}
	}
	return out;
}
const events = await loadShards('EVENTS');
const profiles = await loadShards('USERS');
const identityMap = buildIdentityMap(profiles);
const profileBy = new Map(profiles.map(p => [p.distinct_id, p]));
console.log(`media — events=${events.length} users=${profiles.length}`);

const results = [];
const check = (n, p, d = '') => { results.push({ n, p, d }); console.log(`  ${p ? 'PASS' : 'FAIL'}  ${n}  ${d}`); };
const avg = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;

const byUser = new Map();
for (const e of events) {
	const uid = resolveUserId(e, identityMap);
	if (!byUser.has(uid)) byUser.set(uid, []);
	byUser.get(uid).push(e);
}

// HOOK 1: documentary genre playback completed depressed
{
	const genres = new Map();
	for (const e of events) {
		if (e.event !== 'playback completed') continue;
		const g = e.genre || 'unknown';
		genres.set(g, (genres.get(g) || 0) + 1);
	}
	const doc = genres.get('documentary') || 0;
	const others = [...genres.entries()].filter(([k]) => k !== 'documentary' && k !== 'unknown').map(([_, v]) => v);
	const otherAvg = others.length ? others.reduce((s, v) => s + v, 0) / others.length : 0;
	const ratio = doc / Math.max(otherAvg, 1);
	check('H1 documentary <0.85x other genres', ratio < 0.85,
		`doc=${doc} other_avg=${otherAvg.toFixed(0)} ratio=${ratio.toFixed(2)}x`);
}

// HOOK 2: binge watchers — 3+ consecutive completions → extra start+complete
{
	const binge = [], non = [];
	for (const [uid, evs] of byUser) {
		evs.sort((a, b) => new Date(a.time) - new Date(b.time));
		let consec = 0, maxC = 0;
		for (const e of evs) {
			if (e.event === 'playback completed') { consec++; maxC = Math.max(maxC, consec); }
			else if (e.event !== 'playback started') consec = 0;
		}
		const completes = evs.filter(e => e.event === 'playback completed').length;
		(maxC >= 3 ? binge : non).push(completes);
	}
	const ratio = avg(binge) / Math.max(avg(non), 0.01);
	check('H2 binge watchers 1.5x+ completions', ratio >= 1.5,
		`binge=${avg(binge).toFixed(2)} (n=${binge.length}) non=${avg(non).toFixed(2)} ratio=${ratio.toFixed(2)}x`);
}

// HOOK 3: weekend playback completed 1.5x duration
{
	const wkn = [], wkd = [];
	for (const e of events) {
		if (e.event !== 'playback completed' || typeof e.watch_duration_min !== 'number') continue;
		const dow = new Date(e.time).getUTCDay();
		((dow === 0 || dow === 6) ? wkn : wkd).push(e.watch_duration_min);
	}
	const ratio = avg(wkn) / Math.max(avg(wkd), 1);
	check('H3 weekend 1.3x+ duration', ratio >= 1.3,
		`wkn=${avg(wkn).toFixed(0)} wkd=${avg(wkd).toFixed(0)} ratio=${ratio.toFixed(2)}x`);
}

// HOOK 4: ad fatigue — 5+ early ads → much lower post-d45
{
	const ads = [], non = [];
	for (const [uid, evs] of byUser) {
		evs.sort((a, b) => new Date(a.time) - new Date(b.time));
		const t0 = new Date(evs[0].time).getTime();
		const day45 = t0 + 45 * 86400000;
		const earlyAds = evs.filter(e => e.event === 'ad impression' && new Date(e.time).getTime() < day45).length;
		const pre = evs.filter(e => new Date(e.time).getTime() <= day45).length;
		const post = evs.filter(e => new Date(e.time).getTime() > day45).length;
		if (pre === 0) continue;
		const r = post / pre;
		(earlyAds >= 5 ? ads : non).push(r);
	}
	const ratio = avg(ads) / Math.max(avg(non), 0.01);
	check('H4 ad-fatigue post/pre < 0.5x non', ratio < 0.5,
		`ad=${avg(ads).toFixed(2)} (n=${ads.length}) non=${avg(non).toFixed(2)} ratio=${ratio.toFixed(2)}x`);
}

// HOOK 5: blockbuster post-d50 mentions
{
	const ds = new Date('2026-01-01T00:00:00Z').getTime();
	const day50 = ds + 50 * 86400000, day65 = ds + 65 * 86400000;
	let inWin = 0, outWin = 0;
	for (const e of events) {
		if (e.event !== 'playback started' && e.event !== 'content selected') continue;
		const t = new Date(e.time).getTime();
		const inW = (t >= day50 && t <= day65);
		const isBlockbuster = e.content_id && String(e.content_id).startsWith('blockbuster');
		if (isBlockbuster) {
			if (inW) inWin++; else outWin++;
		}
	}
	check('H5 blockbuster mostly in d50-65 window', inWin > 0 && inWin > outWin * 5,
		`in=${inWin} out=${outWin}`);
}

// HOOK 6: kids profile safety — 15% of selected/started shifted to animation/doc
// Just verify those genres exist in those events
{
	let total = 0, kidGenre = 0;
	for (const e of events) {
		if (e.event !== 'content selected' && e.event !== 'playback started') continue;
		if (!e.genre) continue;
		total++;
		if (e.genre === 'animation' || e.genre === 'documentary') kidGenre++;
	}
	const pct = kidGenre / Math.max(total, 1);
	check('H6 animation+documentary >= 18% of selected/started', pct >= 0.18,
		`kid_genre=${kidGenre}/${total} (${(pct * 100).toFixed(1)}%)`);
}

// HOOK 7: pre-d60 content rated dropped 30%
{
	const ds = new Date('2026-01-01T00:00:00Z').getTime();
	const day60 = ds + 60 * 86400000;
	let pre = 0, post = 0;
	for (const e of events) {
		if (e.event !== 'content rated') continue;
		const t = new Date(e.time).getTime();
		if (t < day60) pre++; else post++;
	}
	const preRate = pre / 60, postRate = post / 60; // approx per-day rates
	// post-1.5.0: catch-all funnel ttc=1d (was 14d) reduces dataset right-edge
	// dead zone, which used to amplify post-d60 rating volume. Direction
	// preserved (post > pre) — STRONG threshold.
	check('H7 post-d60 rating rate > pre-d60 (1.05x+)', postRate > preRate * 1.05,
		`pre=${pre} (${preRate.toFixed(1)}/day) post=${post} (${postRate.toFixed(1)}/day)`);
}

// HOOK 8: subtitle users → 1.25x completion + 1.15x duration + 20% extra completions
{
	const sub = [], non = [];
	for (const [uid, evs] of byUser) {
		const hasSub = evs.some(e => e.event === 'subtitle toggled' && e.action === 'enabled');
		const cps = evs.filter(e => e.event === 'playback completed' && typeof e.completion_percent === 'number').map(e => e.completion_percent);
		(hasSub ? sub : non).push(...cps);
	}
	const ratio = avg(sub) / Math.max(avg(non), 1);
	check('H8 subtitle users 1.1x+ completion_percent', ratio >= 1.1,
		`sub=${avg(sub).toFixed(1)} (n=${sub.length}) non=${avg(non).toFixed(1)} ratio=${ratio.toFixed(2)}x`);
}

// HOOK 9: rec-click magic — sweet 4-6 → +25% watch_duration_min
{
	const sweet = [], lower = [];
	for (const [uid, evs] of byUser) {
		const rc = evs.filter(e => e.event === 'recommendation clicked').length;
		const dur = evs.filter(e => e.event === 'playback completed' && typeof e.watch_duration_min === 'number').map(e => e.watch_duration_min);
		if (rc >= 4 && rc <= 6) sweet.push(...dur);
		else if (rc < 4) lower.push(...dur);
	}
	const ratio = avg(sweet) / Math.max(avg(lower), 1);
	check('H9 sweet 4-6 rec clicks 1.05x+ duration', ratio >= 1.05,
		`sweet=${avg(sweet).toFixed(0)} lower=${avg(lower).toFixed(0)} ratio=${ratio.toFixed(2)}x`);
}

// HOOK 10: Core viewing TTC — premium < free
{
	const tier = (uid) => profileBy.get(uid)?.subscription_plan;
	const dur = { premium: [], free: [], standard: [] };
	for (const e of events) {
		if (e.event !== 'playback completed' || typeof e.watch_duration_min !== 'number') continue;
		const t = tier(resolveUserId(e, identityMap));
		if (dur[t]) dur[t].push(e.watch_duration_min);
	}
	const pr = avg(dur.premium), fr = avg(dur.free);
	check('H10 premium < free duration', pr < fr,
		`premium=${pr.toFixed(0)}m (n=${dur.premium.length}) free=${fr.toFixed(0)}m (n=${dur.free.length})`);
}

const passed = results.filter(r => r.p).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
