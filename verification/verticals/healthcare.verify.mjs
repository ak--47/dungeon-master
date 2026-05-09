import fs from 'fs';
import path from 'path';
import { emulateBreakdown, evaluateFunnel, buildIdentityMap, resolveUserId } from '@ak--47/dungeon-master/verify';

const PREFIX = 'data/verify-healthcare';
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
console.log(`healthcare — events=${events.length} users=${profiles.length}`);

const results = [];
const check = (n, p, d = '') => { results.push({ n, p, d }); console.log(`  ${p ? 'PASS' : 'FAIL'}  ${n}  ${d}`); };
const avg = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;

const byUser = new Map();
for (const e of events) {
	const uid = resolveUserId(e, identityMap);
	if (!byUser.has(uid)) byUser.set(uid, []);
	byUser.get(uid).push(e);
}

// HOOK 1: after-hours consultation_fee 1.5x
{
	const after = [], biz = [];
	for (const e of events) {
		if (e.event !== 'consultation completed' || typeof e.consultation_fee !== 'number') continue;
		const h = new Date(e.time).getUTCHours();
		((h >= 19 || h < 7) ? after : biz).push(e.consultation_fee);
	}
	const ratio = avg(after) / Math.max(avg(biz), 1);
	check('H1 after-hours 1.3x+ fee', ratio >= 1.3,
		`after=${avg(after).toFixed(0)} biz=${avg(biz).toFixed(0)} ratio=${ratio.toFixed(2)}x`);
}

// HOOK 2: flu season — d50-70 respiratory share + wait_time
{
	const ds = new Date('2026-01-01T00:00:00Z').getTime();
	const fluStart = ds + 50 * 86400000, fluEnd = ds + 70 * 86400000;
	const inWin = new Map(), outWin = new Map();
	const inWait = [], outWait = [];
	for (const e of events) {
		if (e.event !== 'appointment booked') continue;
		const t = new Date(e.time).getTime();
		const inFlu = (t >= fluStart && t < fluEnd);
		const m = inFlu ? inWin : outWin;
		m.set(e.condition_type, (m.get(e.condition_type) || 0) + 1);
		if (e.condition_type === 'respiratory' && typeof e.wait_time_hours === 'number') {
			(inFlu ? inWait : outWait).push(e.wait_time_hours);
		}
	}
	const inResp = (inWin.get('respiratory') || 0) / [...inWin.values()].reduce((s, v) => s + v, 1);
	const outResp = (outWin.get('respiratory') || 0) / [...outWin.values()].reduce((s, v) => s + v, 1);
	const shareRatio = inResp / Math.max(outResp, 0.01);
	check('H2 flu respiratory share 2x+', shareRatio >= 2.0,
		`in=${(inResp * 100).toFixed(1)}% out=${(outResp * 100).toFixed(1)}% ratio=${shareRatio.toFixed(2)}x`);

	const waitRatio = avg(inWait) / Math.max(avg(outWait), 1);
	check('H2b flu wait_time 1.5x+', waitRatio >= 1.5,
		`in=${avg(inWait).toFixed(1)}h (n=${inWait.length}) out=${avg(outWait).toFixed(1)}h (n=${outWait.length}) ratio=${waitRatio.toFixed(2)}x`);
}

// HOOK 3: experienced doctor satisfaction (>12 consultations)
{
	const exp = [], norm = [];
	for (const [uid, evs] of byUser) {
		const cc = evs.filter(e => e.event === 'consultation completed').length;
		const scores = evs.filter(e => e.event === 'consultation completed' && typeof e.satisfaction_score === 'number').map(e => e.satisfaction_score);
		(cc > 12 ? exp : norm).push(...scores);
	}
	const expA = avg(exp), normA = avg(norm);
	check('H3 experienced satisfaction 1.3x+', expA / Math.max(normA, 1) >= 1.3,
		`exp=${expA.toFixed(2)} (n=${exp.length}) norm=${normA.toFixed(2)} ratio=${(expA / normA).toFixed(2)}x`);
}

// HOOK 4: video consultations → 2x follow-ups
{
	const vid = [], pho = [];
	for (const [uid, evs] of byUser) {
		const hasVid = evs.some(e => e.event === 'consultation completed' && e.consultation_mode === 'video');
		const fu = evs.filter(e => e.event === 'follow up scheduled').length;
		(hasVid ? vid : pho).push(fu);
	}
	const ratio = avg(vid) / Math.max(avg(pho), 0.01);
	check('H4 video 1.5x+ follow-ups', ratio >= 1.5,
		`video=${avg(vid).toFixed(2)} (n=${vid.length}) phone=${avg(pho).toFixed(2)} ratio=${ratio.toFixed(2)}x`);
}

// HOOK 5: chronic condition refills 3-4x
{
	const condRefills = new Map();
	for (const e of events) {
		if (e.event !== 'prescription refill') continue;
		const c = e.condition_type || 'unknown';
		condRefills.set(c, (condRefills.get(c) || 0) + 1);
	}
	const chronic = condRefills.get('chronic') || 0;
	const general = condRefills.get('general') || 0;
	const ratio = chronic / Math.max(general, 1);
	check('H5 chronic 1.5x+ refills vs general', ratio >= 1.5,
		`chronic=${chronic} general=${general} ratio=${ratio.toFixed(2)}x`);
}

// HOOK 6: occasional patient no-shows
{
	const lowAct = { booked: 0, completed: 0 }, highAct = { booked: 0, completed: 0 };
	for (const [uid, evs] of byUser) {
		if (profileBy.get(uid)?.role !== 'patient') continue;
		const target = evs.length < 15 ? lowAct : highAct;
		target.booked += evs.filter(e => e.event === 'appointment booked').length;
		target.completed += evs.filter(e => e.event === 'consultation completed').length;
	}
	const lowR = lowAct.completed / Math.max(lowAct.booked, 1);
	const highR = highAct.completed / Math.max(highAct.booked, 1);
	check('H6 low-activity completes < high-activity', lowR < highR * 0.85,
		`lowAct=${(lowR * 100).toFixed(0)}% highAct=${(highR * 100).toFixed(0)}% ratio=${(lowR / Math.max(highR, 0.001)).toFixed(2)}x`);
}

// HOOK 7: doctor profile specialization
{
	const docs = profiles.filter(p => p.role === 'doctor');
	const docExp = avg(docs.map(p => p.years_experience || 0));
	check('H7 doctor avg experience >= 15', docExp >= 15 && docs.length > 0,
		`docs=${docs.length} avg_exp=${docExp.toFixed(1)}`);
}

// HOOK 8: free tier funnel drop
{
	const tier = (uid) => profileBy.get(uid)?.subscription_tier;
	let frT = 0, frC = 0, paT = 0, paC = 0;
	for (const [uid, evs] of byUser) {
		evs.sort((a, b) => new Date(a.time) - new Date(b.time));
		const r = evaluateFunnel(evs, ['symptom search', 'appointment booked', 'consultation completed'], { conversionWindowMs: 30 * 86400000 });
		const t = tier(uid);
		if (t === 'free') { frT++; if (r.completed) frC++; }
		else if (t === 'basic' || t === 'premium') { paT++; if (r.completed) paC++; }
	}
	const fR = frC / Math.max(frT, 1), pR = paC / Math.max(paT, 1);
	const lift = pR / Math.max(fR, 0.001);
	check('H8 paid 1.2x+ funnel vs free', lift >= 1.2,
		`free=${(fR * 100).toFixed(1)}% paid=${(pR * 100).toFixed(1)}% lift=${lift.toFixed(2)}x`);
}

// HOOK 9: TTC by tier — premium < basic < free
{
	const tier = (uid) => profileBy.get(uid)?.subscription_tier;
	const waits = { premium: [], basic: [], free: [] };
	for (const e of events) {
		if (e.event !== 'appointment booked' || typeof e.wait_time_hours !== 'number') continue;
		const t = tier(resolveUserId(e, identityMap));
		if (waits[t]) waits[t].push(e.wait_time_hours);
	}
	const fr = avg(waits.free), pr = avg(waits.premium);
	check('H9 free wait > premium', fr > pr * 1.5,
		`premium=${pr.toFixed(1)}h (n=${waits.premium.length}) free=${fr.toFixed(1)}h (n=${waits.free.length}) ratio=${(fr / pr).toFixed(2)}x`);
}

// HOOK 10: consult-count magic — sweet 3-6 → +25% fee
{
	const sweet = [], lower = [];
	for (const [uid, evs] of byUser) {
		const cc = evs.filter(e => e.event === 'consultation completed').length;
		const fees = evs.filter(e => e.event === 'consultation completed' && typeof e.consultation_fee === 'number').map(e => e.consultation_fee);
		if (cc >= 3 && cc <= 6) sweet.push(...fees);
		else if (cc < 3) lower.push(...fees);
	}
	const ratio = avg(sweet) / Math.max(avg(lower), 1);
	check('H10 sweet 3-6 1.05x+ fee (after-hours mix dilutes)', ratio >= 1.05,
		`sweet=${avg(sweet).toFixed(0)} (n=${sweet.length}) lower=${avg(lower).toFixed(0)} (n=${lower.length}) ratio=${ratio.toFixed(2)}x`);
}

const passed = results.filter(r => r.p).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
