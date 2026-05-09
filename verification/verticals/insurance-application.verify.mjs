import fs from 'fs';
import path from 'path';
import { emulateBreakdown, evaluateFunnel, buildIdentityMap, resolveUserId } from '@ak--47/dungeon-master/verify';

const PREFIX = 'data/verify-insurance';
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
console.log(`insurance — events=${events.length} users=${profiles.length}`);

const results = [];
const check = (n, p, d = '') => { results.push({ n, p, d }); console.log(`  ${p ? 'PASS' : 'FAIL'}  ${n}  ${d}`); };
const avg = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;

const byUser = new Map();
for (const e of events) {
	const uid = resolveUserId(e, identityMap);
	if (!byUser.has(uid)) byUser.set(uid, []);
	byUser.get(uid).push(e);
}

// HOOK 1: version stamping clean bands
{
	const versionDays = new Map();
	for (const e of events) {
		const v = e.app_version;
		const d = e.time.slice(0, 10);
		const key = `${v}|${d}`;
		versionDays.set(key, (versionDays.get(key) || 0) + 1);
	}
	const v210 = events.filter(e => e.app_version === '2.10').length;
	const v213 = events.filter(e => e.app_version === '2.13').length;
	check('H1 version bands present', v210 > 0 && v213 > 0,
		`v2.10=${v210} v2.13=${v213}`);
}

// HOOK 2: support tickets drop in v2.13
{
	const v212 = events.filter(e => e.event === 'support ticket created' && e.app_version === '2.12').length;
	const v213 = events.filter(e => e.event === 'support ticket created' && e.app_version === '2.13').length;
	const days212 = 30; // v2.12 spans 30 days
	const days213 = 10; // v2.13 spans 10 days
	const r212 = v212 / days212, r213 = v213 / days213;
	const ratio = r213 / Math.max(r212, 0.01);
	check('H2 v2.13 ticket rate <0.6x v2.12', ratio < 0.6,
		`v2.12=${r212.toFixed(0)}/day v2.13=${r213.toFixed(0)}/day ratio=${ratio.toFixed(2)}x`);
}

// HOOK 3: application conversion boost in v2.13
{
	let v213T = 0, v213C = 0, v212T = 0, v212C = 0;
	for (const [uid, evs] of byUser) {
		evs.sort((a, b) => new Date(a.time) - new Date(b.time));
		const submit = evs.find(e => e.event === 'application submitted');
		const approve = evs.find(e => e.event === 'application approved' && new Date(e.time) > new Date(submit?.time || 0));
		const policy = evs.find(e => e.event === 'policy activated' && new Date(e.time) > new Date(approve?.time || 0));
		const v = approve?.app_version;
		if (!submit) continue;
		if (v === '2.13' || (submit.app_version === '2.13')) {
			v213T++;
			if (approve && policy) v213C++;
		} else if (submit.app_version === '2.12') {
			v212T++;
			if (approve && policy) v212C++;
		}
	}
	const r213 = v213C / Math.max(v213T, 1), r212 = v212C / Math.max(v212T, 1);
	const lift = r213 / Math.max(r212, 0.001);
	check('H3 v2.13 funnel 1.2x+ vs v2.12', lift >= 1.2,
		`v2.12=${(r212 * 100).toFixed(1)}% (n=${v212T}) v2.13=${(r213 * 100).toFixed(1)}% (n=${v213T}) lift=${lift.toFixed(2)}x`);
}

// HOOK 4: app step magic — sweet 8-14 → +35% approved_premium
{
	const sweet = [], lower = [];
	for (const [uid, evs] of byUser) {
		const sc = evs.filter(e => e.event === 'application step completed').length;
		const aps = evs.filter(e => e.event === 'application approved' && typeof e.approved_premium === 'number').map(e => e.approved_premium);
		if (sc >= 8 && sc <= 14) sweet.push(...aps);
		else if (sc < 8) lower.push(...aps);
	}
	const ratio = avg(sweet) / Math.max(avg(lower), 1);
	check('H4 sweet 8-14 1.2x+ approved_premium', ratio >= 1.2,
		`sweet=${avg(sweet).toFixed(0)} (n=${sweet.length}) lower=${avg(lower).toFixed(0)} (n=${lower.length}) ratio=${ratio.toFixed(2)}x`);
}

// HOOK 5: TTC by account_type — business < individual < family
{
	const byAcct = new Map();
	for (const [uid, evs] of byUser) {
		const acctEvent = evs.find(e => e.event === 'account created');
		const acct = acctEvent?.account_type;
		const start = evs.find(e => e.event === 'application started');
		const approve = evs.find(e => e.event === 'application approved' && new Date(e.time) > new Date(start?.time || 0));
		if (!start || !approve || !acct) continue;
		const ttcH = (new Date(approve.time) - new Date(start.time)) / 3600000;
		if (!byAcct.has(acct)) byAcct.set(acct, []);
		byAcct.get(acct).push(ttcH);
	}
	const biz = avg(byAcct.get('business') || []);
	const indiv = avg(byAcct.get('individual') || []);
	const fam = avg(byAcct.get('family') || []);
	check('H5 TTC business < individual < family', biz < indiv && indiv < fam,
		`biz=${biz.toFixed(1)}h (n=${(byAcct.get('business') || []).length}) indiv=${indiv.toFixed(1)}h fam=${fam.toFixed(1)}h`);
}

// HOOK 6: A/B claims experiment — Simplified > Control
{
	const variants = new Map();
	for (const e of events) {
		if (e.event !== '$experiment_started') continue;
		const v = e['Variant name'];
		if (!variants.has(v)) variants.set(v, new Set());
		variants.get(v).add(resolveUserId(e, identityMap));
	}
	let simT = 0, simC = 0, ctT = 0, ctC = 0;
	for (const [uid, evs] of byUser) {
		evs.sort((a, b) => new Date(a.time) - new Date(b.time));
		const r = evaluateFunnel(evs, ['claim filed', 'claim status checked', 'support ticket created'], { conversionWindowMs: 30 * 86400000 });
		if (variants.get('Simplified Claims')?.has(uid)) { simT++; if (r.completed) simC++; }
		else if (variants.get('Control')?.has(uid)) { ctT++; if (r.completed) ctC++; }
	}
	const simR = simC / Math.max(simT, 1), ctR = ctC / Math.max(ctT, 1);
	const lift = simR / Math.max(ctR, 0.001);
	check('H6 Simplified Claims 1.1x+ vs Control', lift >= 1.1,
		`Sim=${(simR * 100).toFixed(1)}% (n=${simT}) Ctrl=${(ctR * 100).toFixed(1)}% lift=${lift.toFixed(2)}x`);
}

// HOOK 7: risk_profile approval funnel — low > medium > high
{
	const byRisk = new Map();
	for (const [uid, evs] of byUser) {
		evs.sort((a, b) => new Date(a.time) - new Date(b.time));
		const r = evaluateFunnel(evs, ['application submitted', 'application approved', 'policy activated'], { conversionWindowMs: 30 * 86400000 });
		const risk = profileBy.get(uid)?.risk_profile;
		if (!byRisk.has(risk)) byRisk.set(risk, { t: 0, c: 0 });
		const b = byRisk.get(risk);
		b.t++; if (r.completed) b.c++;
	}
	const low = (byRisk.get('low')?.c || 0) / Math.max(byRisk.get('low')?.t || 1, 1);
	const high = (byRisk.get('high')?.c || 0) / Math.max(byRisk.get('high')?.t || 1, 1);
	const lift = low / Math.max(high, 0.001);
	check('H7 low risk 2x+ approval vs high', lift >= 2.0,
		`low=${(low * 100).toFixed(1)}% high=${(high * 100).toFixed(1)}% lift=${lift.toFixed(2)}x`);
}

// HOOK 8: doc upload retention — 3+ docs → higher post-d30 events
{
	const upload = [], non = [];
	for (const [uid, evs] of byUser) {
		evs.sort((a, b) => new Date(a.time) - new Date(b.time));
		const t0 = new Date(evs[0].time).getTime();
		const day14 = t0 + 14 * 86400000;
		const day30 = t0 + 30 * 86400000;
		const docs = evs.filter(e => e.event === 'document uploaded' && new Date(e.time).getTime() < day14).length;
		const post30 = evs.filter(e => new Date(e.time).getTime() > day30).length;
		(docs >= 3 ? upload : non).push(post30);
	}
	const ratio = avg(upload) / Math.max(avg(non), 0.01);
	check('H8 doc uploaders 1.5x+ post-d30 events', ratio >= 1.5,
		`uploaders=${avg(upload).toFixed(1)} (n=${upload.length}) non=${avg(non).toFixed(1)} ratio=${ratio.toFixed(2)}x`);
}

// HOOK 9: end-of-quarter renewal spike d85-95
{
	const ds = new Date('2026-01-01T00:00:00Z').getTime();
	const inWin = new Map(), outWin = new Map();
	for (const e of events) {
		if (e.event !== 'renewal completed') continue;
		const d = Math.floor((new Date(e.time).getTime() - ds) / 86400000);
		const m = (d >= 85 && d <= 95) ? inWin : outWin;
		m.set(d, (m.get(d) || 0) + 1);
	}
	const inAvg = [...inWin.values()].reduce((s, v) => s + v, 0) / Math.max(inWin.size, 1);
	const outAvg = [...outWin.values()].reduce((s, v) => s + v, 0) / Math.max(outWin.size, 1);
	const ratio = inAvg / Math.max(outAvg, 1);
	check('H9 d85-95 renewal spike 2x+', ratio >= 2.0,
		`in=${inAvg.toFixed(0)}/day (n=${inWin.size}) out=${outAvg.toFixed(0)}/day ratio=${ratio.toFixed(2)}x`);
}

// HOOK 10: claim filers → 2x premium on next payment
{
	let claimPrems = [], nonPrems = [];
	for (const [uid, evs] of byUser) {
		evs.sort((a, b) => new Date(a.time) - new Date(b.time));
		const claim = evs.find(e => e.event === 'claim filed');
		const payments = evs.filter(e => e.event === 'payment made' && typeof e.premium_amount === 'number');
		if (claim) {
			const claimT = new Date(claim.time).getTime();
			const post = payments.find(p => new Date(p.time).getTime() > claimT);
			if (post) claimPrems.push(post.premium_amount);
		} else if (payments.length) {
			nonPrems.push(...payments.map(p => p.premium_amount));
		}
	}
	const ratio = avg(claimPrems) / Math.max(avg(nonPrems), 1);
	check('H10 post-claim premium 1.5x+', ratio >= 1.5,
		`claim=${avg(claimPrems).toFixed(0)} (n=${claimPrems.length}) non=${avg(nonPrems).toFixed(0)} ratio=${ratio.toFixed(2)}x`);
}

const passed = results.filter(r => r.p).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
