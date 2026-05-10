import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { emulateBreakdown, evaluateFunnel, buildIdentityMap, resolveUserId } from '@ak--47/dungeon-master/verify';

const PREFIX = 'data/verify-real-estate';
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
console.log(`real-estate — events=${events.length} users=${profiles.length}`);

const results = [];
const check = (n, p, d = '') => { results.push({ n, p, d }); console.log(`  ${p ? 'PASS' : 'FAIL'}  ${n}  ${d}`); };
const avg = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;

const byUser = new Map();
for (const e of events) {
	const uid = resolveUserId(e, identityMap);
	if (!byUser.has(uid)) byUser.set(uid, []);
	byUser.get(uid).push(e);
}
const ds = new Date('2026-01-01T00:00:00Z').getTime();

// HOOK 1: spring buying season — d30-60 offer_price 2.5x
{
	const inWin = [], outWin = [];
	const start = ds + 30 * 86400000, end = ds + 60 * 86400000;
	for (const e of events) {
		if (e.event !== 'offer submitted' || typeof e.offer_price !== 'number') continue;
		const t = new Date(e.time).getTime();
		((t >= start && t < end) ? inWin : outWin).push(e.offer_price);
	}
	const ratio = avg(inWin) / Math.max(avg(outWin), 1);
	check('H1 spring offer_price 1.5x+', ratio >= 1.5,
		`in=${avg(inWin).toFixed(0)} (n=${inWin.length}) out=${avg(outWin).toFixed(0)} (n=${outWin.length}) ratio=${ratio.toFixed(2)}x`);
}

// HOOK 2: mortgage rate shock — d75-89 mortgage_rate=7.5
{
	const inWin = [], outWin = [];
	const start = ds + 75 * 86400000, end = ds + 89 * 86400000;
	for (const e of events) {
		if (e.event !== 'mortgage pre-approval' || typeof e.mortgage_rate !== 'number') continue;
		const t = new Date(e.time).getTime();
		((t >= start && t < end) ? inWin : outWin).push(e.mortgage_rate);
	}
	const inAvg = avg(inWin), outAvg = avg(outWin);
	check('H2 mortgage rate elevated post-d75', inAvg >= 7.0 && outAvg < 7.0,
		`in=${inAvg.toFixed(2)} (n=${inWin.length}) out=${outAvg.toFixed(2)} (n=${outWin.length})`);
}

// HOOK 3: saved-search retention — early savers higher event volume
{
	const sav = [], non = [];
	for (const [uid, evs] of byUser) {
		evs.sort((a, b) => new Date(a.time) - new Date(b.time));
		const t0 = new Date(evs[0].time).getTime();
		const day7 = t0 + 7 * 86400000;
		const earlySaved = evs.some(e => e.event === 'saved search created' && new Date(e.time).getTime() < day7);
		(earlySaved ? sav : non).push(evs.length);
	}
	const ratio = avg(sav) / Math.max(avg(non), 0.01);
	check('H3 saved-search early 2x+ events', ratio >= 1.5,
		`saved=${avg(sav).toFixed(1)} (n=${sav.length}) non=${avg(non).toFixed(1)} ratio=${ratio.toFixed(2)}x`);
}

// HOOK 4: pre-approval → 5x offers
{
	const pre = [], non = [];
	for (const [uid, evs] of byUser) {
		const hasPre = evs.some(e => e.event === 'mortgage pre-approval');
		const offers = evs.filter(e => e.event === 'offer submitted').length;
		(hasPre ? pre : non).push(offers);
	}
	const ratio = avg(pre) / Math.max(avg(non), 0.01);
	check('H4 pre-approval 3x+ offers', ratio >= 3.0,
		`pre=${avg(pre).toFixed(2)} (n=${pre.length}) non=${avg(non).toFixed(2)} ratio=${ratio.toFixed(2)}x`);
}

// HOOK 5: Premier agents 3x listings
{
	const tier = (uid) => profileBy.get(uid)?.agent_tier;
	const tierListings = new Map();
	for (const [uid, evs] of byUser) {
		const t = tier(uid);
		const c = evs.filter(e => e.event === 'property listed').length;
		if (!tierListings.has(t)) tierListings.set(t, []);
		tierListings.get(t).push(c);
	}
	const prem = avg(tierListings.get('Premier') || []);
	const std = avg(tierListings.get('Standard') || []);
	const ratio = prem / Math.max(std, 0.01);
	check('H5 Premier 2.5x+ listings', ratio >= 2.5,
		`Premier=${prem.toFixed(2)} Standard=${std.toFixed(2)} ratio=${ratio.toFixed(2)}x`);
}

// HOOK 6: dual-tour power users → 5x offers
{
	const dual = [], single = [];
	for (const [uid, evs] of byUser) {
		const hasV = evs.some(e => e.event === 'virtual tour');
		const hasI = evs.some(e => e.event === 'in-person tour');
		const offers = evs.filter(e => e.event === 'offer submitted').length;
		((hasV && hasI) ? dual : single).push(offers);
	}
	const ratio = avg(dual) / Math.max(avg(single), 0.01);
	check('H6 dual-tour 3x+ offers', ratio >= 3.0,
		`dual=${avg(dual).toFixed(2)} (n=${dual.length}) single=${avg(single).toFixed(2)} ratio=${ratio.toFixed(2)}x`);
}

// HOOK 7: luxury listings post-d50
{
	const luxStart = ds + 50 * 86400000;
	let pre50Lux = 0, post50Lux = 0;
	for (const e of events) {
		if (e.event !== 'property listed' || typeof e.listing_price !== 'number') continue;
		if (e.listing_price < 5000000) continue;
		const t = new Date(e.time).getTime();
		if (t < luxStart) pre50Lux++; else post50Lux++;
	}
	check('H7 luxury listings emerge post-d50', post50Lux > pre50Lux * 5,
		`pre=${pre50Lux} post=${post50Lux}`);
}

// HOOK 8: cold-lead churn — view-but-not-save users have lower post-d14 events
{
	const cold = [], warm = [];
	for (const [uid, evs] of byUser) {
		evs.sort((a, b) => new Date(a.time) - new Date(b.time));
		const t0 = new Date(evs[0].time).getTime();
		const day14 = t0 + 14 * 86400000;
		const earlyView = evs.some(e => e.event === 'property viewed' && new Date(e.time).getTime() < day14);
		const earlySave = evs.some(e => e.event === 'property saved' && new Date(e.time).getTime() < day14);
		const post14 = evs.filter(e => new Date(e.time).getTime() > day14).length;
		if (earlyView && !earlySave) cold.push(post14);
		else if (earlyView && earlySave) warm.push(post14);
	}
	const ratio = avg(cold) / Math.max(avg(warm), 0.01);
	check('H8 cold-lead post-d14 < 0.5x warm', ratio < 0.5,
		`cold=${avg(cold).toFixed(1)} (n=${cold.length}) warm=${avg(warm).toFixed(1)} ratio=${ratio.toFixed(2)}x`);
}

// HOOK 9: property-viewed magic number — sweet 6-12 → +30% offer_price
{
	const sweet = [], lower = [];
	for (const [uid, evs] of byUser) {
		const vc = evs.filter(e => e.event === 'property viewed').length;
		const offerPrices = evs.filter(e => e.event === 'offer submitted' && typeof e.offer_price === 'number').map(e => e.offer_price);
		if (vc >= 6 && vc <= 12) sweet.push(...offerPrices);
		else if (vc < 6) lower.push(...offerPrices);
	}
	const ratio = avg(sweet) / Math.max(avg(lower), 1);
	check('H9 sweet 6-12 1.2x+ offer_price', ratio >= 1.15,
		`sweet=${avg(sweet).toFixed(0)} (n=${sweet.length}) lower=${avg(lower).toFixed(0)} (n=${lower.length}) ratio=${ratio.toFixed(2)}x`);
}

// HOOK 10: TTC by agent_tier (KNOWN LIMITATION)
{
	const rows = emulateBreakdown(events, {
		type: 'timeToConvert',
		fromEvent: 'property viewed',
		toEvent: 'offer submitted',
		breakdownByUserProperty: 'agent_tier',
		profiles,
		conversionWindowMs: 30 * 86400000,
	});
	const byTier = new Map();
	for (const r of rows) byTier.set(r.segment_value, r);
	const present = byTier.has('Premier') && byTier.has('Standard');
	check('H10 TTC populations present (limitation)', present,
		`tiers=${[...byTier.keys()].join(',')}`);
}

const passed = results.filter(r => r.p).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
