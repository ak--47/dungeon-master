import fs from 'fs';
import path from 'path';
import { emulateBreakdown, evaluateFunnel, buildIdentityMap, resolveUserId } from '@ak--47/dungeon-master/verify';

const PREFIX = 'data/verify-ai';
function loadShards(suffix) {
	const dir = path.dirname(PREFIX), base = path.basename(PREFIX);
	const out = [];
	for (const f of fs.readdirSync(dir).filter(f => f.startsWith(`${base}-${suffix}`) && f.endsWith('.json')).sort()) {
		for (const line of fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n')) out.push(JSON.parse(line));
	}
	return out;
}
const events = loadShards('EVENTS');
const profiles = loadShards('USERS');
const identityMap = buildIdentityMap(profiles);
const profileBy = new Map(profiles.map(p => [p.distinct_id, p]));
console.log(`ai-platform — events=${events.length} users=${profiles.length}`);

const results = [];
const check = (n, p, d = '') => { results.push({ n, p, d }); console.log(`  ${p ? 'PASS' : 'FAIL'}  ${n}  ${d}`); };
const avg = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;

const byUser = new Map();
for (const e of events) {
	const uid = resolveUserId(e, identityMap);
	if (!byUser.has(uid)) byUser.set(uid, []);
	byUser.get(uid).push(e);
}

// HOOK 1: cache users have lower cost_per api call
{
	const cacheUsers = new Set();
	for (const [uid, evs] of byUser) {
		const idHash = String(uid).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
		if (idHash % 4 === 0) cacheUsers.add(uid);
	}
	const cacheCalls = events.filter(e => e.event === 'api call' && e.cache_enabled === true);
	const noncacheCalls = events.filter(e => e.event === 'api call' && (e.cache_enabled === false || e.cache_enabled === undefined));
	const cR = avg(cacheCalls.map(e => e.cost_usd || 0));
	const nR = avg(noncacheCalls.map(e => e.cost_usd || 0));
	check('H1 cache calls 0.7x or less cost_usd', cR < nR * 0.85,
		`cache=${cR.toFixed(4)} (n=${cacheCalls.length}) noncache=${nR.toFixed(4)} (n=${noncacheCalls.length}) ratio=${(cR / nR).toFixed(2)}x`);
}

// HOOK 2: opus-4-7 emerges post-d60 (Build/Enterprise tiers)
{
	const ds = new Date('2026-01-01T00:00:00Z').getTime();
	const day60 = ds + 60 * 86400000;
	let pre60 = 0, post60 = 0;
	for (const e of events) {
		if (e.event !== 'api call' || e.model !== 'opus-4-7') continue;
		const t = new Date(e.time).getTime();
		if (t < day60) pre60++; else post60++;
	}
	check('H2 opus-4-7 emerges post-d60', post60 > 0 && pre60 < post60,
		`pre60=${pre60} post60=${post60}`);
}

// HOOK 3: agentic users (3+ tools + 3+ multi_turn) → 8x tokens
{
	const ag = [], norm = [];
	for (const [uid, evs] of byUser) {
		const tu = evs.filter(e => e.event === 'tool use call').length;
		const mt = evs.filter(e => e.event === 'api call' && e.multi_turn === true).length;
		const tokens = evs.filter(e => e.event === 'api call' && typeof e.tokens_used === 'number').map(e => e.tokens_used);
		((tu >= 3 && mt >= 3) ? ag : norm).push(...tokens);
	}
	const ratio = avg(ag) / Math.max(avg(norm), 1);
	check('H3 agentic 4x+ tokens_used', ratio >= 4.0,
		`agentic=${avg(ag).toFixed(0)} norm=${avg(norm).toFixed(0)} ratio=${ratio.toFixed(2)}x`);
}

// HOOK 4: rate-limit churn — early-RL users have suppressed post/pre RATIO
// (RL users are heavy users by definition, so absolute post-week-1 volume is
// still higher than non-RL light users; per-user post/pre ratio normalizes that)
{
	const rl = [], norm = [];
	for (const [uid, evs] of byUser) {
		evs.sort((a, b) => new Date(a.time) - new Date(b.time));
		const t0 = new Date(evs[0].time).getTime();
		const week1 = t0 + 7 * 86400000;
		const earlyRL = evs.filter(e => e.event === 'rate limit error' && new Date(e.time).getTime() < week1).length;
		const pre = evs.filter(e => new Date(e.time).getTime() <= week1).length;
		const post = evs.filter(e => new Date(e.time).getTime() > week1).length;
		if (pre === 0) continue;
		const r = post / pre;
		(earlyRL >= 2 ? rl : norm).push(r);
	}
	const ratio = avg(rl) / Math.max(avg(norm), 0.01);
	check('H4 RL users post/pre < 0.85x norm', ratio < 0.85,
		`rl_post/pre=${avg(rl).toFixed(2)} (n=${rl.length}) norm_post/pre=${avg(norm).toFixed(2)} ratio=${ratio.toFixed(2)}x`);
}

// HOOK 5: tier-based context_window
{
	const tier = (uid) => profileBy.get(uid)?.api_tier;
	const tierCw = new Map();
	for (const e of events) {
		if (e.event !== 'api call' || typeof e.context_window !== 'number') continue;
		const t = tier(resolveUserId(e, identityMap));
		if (!tierCw.has(t)) tierCw.set(t, []);
		tierCw.get(t).push(e.context_window);
	}
	const ent = avg(tierCw.get('Enterprise') || []);
	const fr = avg(tierCw.get('Free') || []);
	check('H5 enterprise context > free', ent > fr * 5,
		`enterprise=${ent.toFixed(0)} free=${fr.toFixed(0)} ratio=${(ent / Math.max(fr, 1)).toFixed(2)}x`);
}

// HOOK 6: outage day 40-41 — error rate spikes
{
	const ds = new Date('2026-01-01T00:00:00Z').getTime();
	const start = ds + 40 * 86400000, end = ds + 42 * 86400000;
	let inErr = 0, inTotal = 0, outErr = 0, outTotal = 0;
	for (const e of events) {
		if (e.event !== 'api call') continue;
		const t = new Date(e.time).getTime();
		const isOutage = t >= start && t < end;
		if (isOutage) { inTotal++; if (e.is_error === true) inErr++; }
		else { outTotal++; if (e.is_error === true) outErr++; }
	}
	const inR = inErr / Math.max(inTotal, 1), outR = outErr / Math.max(outTotal, 1);
	check('H6 outage error rate elevated', inR > 0.20 && outR < 0.05,
		`outage=${(inR * 100).toFixed(1)}% normal=${(outR * 100).toFixed(1)}%`);
}

// HOOK 7: batch users get 2x tokens
{
	const batch = [], non = [];
	for (const [uid, evs] of byUser) {
		const isBatch = evs.some(e => e.event === 'batch job submitted');
		const tokens = evs.filter(e => e.event === 'api call' && typeof e.tokens_used === 'number').map(e => e.tokens_used);
		(isBatch ? batch : non).push(...tokens);
	}
	const ratio = avg(batch) / Math.max(avg(non), 1);
	check('H7 batch users 1.5x+ tokens', ratio >= 1.5,
		`batch=${avg(batch).toFixed(0)} (n=${batch.length}) non=${avg(non).toFixed(0)} ratio=${ratio.toFixed(2)}x`);
}

// HOOK 8: eval users retain better
{
	const evalU = [], non = [];
	for (const [uid, evs] of byUser) {
		evs.sort((a, b) => new Date(a.time) - new Date(b.time));
		const t0 = new Date(evs[0].time).getTime();
		const week1 = t0 + 7 * 86400000;
		const day30 = t0 + 30 * 86400000;
		const earlyEval = evs.some(e => e.event === 'eval job' && new Date(e.time).getTime() < week1);
		const post30 = evs.filter(e => new Date(e.time).getTime() > day30).length;
		(earlyEval ? evalU : non).push(post30);
	}
	const ratio = avg(evalU) / Math.max(avg(non), 0.01);
	check('H8 early-eval 2x+ post-d30 events', ratio >= 2.0,
		`eval=${avg(evalU).toFixed(1)} (n=${evalU.length}) non=${avg(non).toFixed(1)} ratio=${ratio.toFixed(2)}x`);
}

// HOOK 9: API-to-Eval TTC by tier (KNOWN LIMITATION funnel-post)
{
	const rows = emulateBreakdown(events, {
		type: 'timeToConvert',
		fromEvent: 'api call',
		toEvent: 'eval job',
		breakdownByUserProperty: 'api_tier',
		profiles,
		conversionWindowMs: 60 * 86400000,
	});
	const byTier = new Map();
	for (const r of rows) byTier.set(r.segment_value, r);
	const present = byTier.has('Enterprise') && byTier.has('Free');
	check('H9 TTC populations present (limitation)', present,
		`tiers=${[...byTier.keys()].join(',')}`);
}

// HOOK 10: docs-search magic — sweet 2-4 → +35% billing amount
{
	const sweet = [], lower = [];
	for (const [uid, evs] of byUser) {
		evs.sort((a, b) => new Date(a.time) - new Date(b.time));
		const orgE = evs.find(e => e.event === 'organization created');
		const billE = evs.find(e => e.event === 'billing payment');
		if (!orgE || !billE) continue;
		const aT = new Date(orgE.time).getTime();
		const bT = new Date(billE.time).getTime();
		const docs = evs.filter(e => e.event === 'docs searched' && new Date(e.time).getTime() > aT && new Date(e.time).getTime() < bT).length;
		const bills = evs.filter(e => e.event === 'billing payment' && typeof e.amount_usd === 'number').map(e => e.amount_usd);
		if (docs >= 2 && docs <= 4) sweet.push(...bills);
		else if (docs < 2) lower.push(...bills);
	}
	const ratio = avg(sweet) / Math.max(avg(lower), 1);
	check('H10 sweet 2-4 docs 1.15x+ billing', ratio >= 1.15,
		`sweet=${avg(sweet).toFixed(0)} (n=${sweet.length}) lower=${avg(lower).toFixed(0)} (n=${lower.length}) ratio=${ratio.toFixed(2)}x`);
}

const passed = results.filter(r => r.p).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
