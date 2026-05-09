import fs from 'fs';
import path from 'path';
import { emulateBreakdown, evaluateFunnel, buildIdentityMap, resolveUserId } from '@ak--47/dungeon-master/verify';

const PREFIX = 'data/verify-marketplace';
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
console.log(`marketplace — events=${events.length} users=${profiles.length}`);

const results = [];
const check = (n, p, d = '') => { results.push({ n, p, d }); console.log(`  ${p ? 'PASS' : 'FAIL'}  ${n}  ${d}`); };
const avg = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;

const byUser = new Map();
for (const e of events) {
	const uid = resolveUserId(e, identityMap);
	if (!byUser.has(uid)) byUser.set(uid, []);
	byUser.get(uid).push(e);
}

// HOOK 1: post-d45 listing_fee 1.3x
{
	const ds = new Date('2026-01-01T00:00:00Z').getTime();
	const day45 = ds + 45 * 86400000;
	const post = [], pre = [];
	for (const e of events) {
		if (e.event !== 'listing created' || typeof e.listing_fee !== 'number') continue;
		(new Date(e.time).getTime() > day45 ? post : pre).push(e.listing_fee);
	}
	const ratio = avg(post) / Math.max(avg(pre), 1);
	check('H1 post-d45 listing_fee 1.2x+', ratio >= 1.2,
		`pre=${avg(pre).toFixed(1)} post=${avg(post).toFixed(1)} ratio=${ratio.toFixed(2)}x`);
}

// HOOK 2: weekend purchases total_amount 1.2x
{
	const wkn = [], wkd = [];
	for (const e of events) {
		if (e.event !== 'purchase completed' || typeof e.total_amount !== 'number') continue;
		const dow = new Date(e.time).getUTCDay();
		((dow === 0 || dow === 6) ? wkn : wkd).push(e.total_amount);
	}
	const ratio = avg(wkn) / Math.max(avg(wkd), 1);
	check('H2 weekend purchase 1.1x+ total', ratio >= 1.1,
		`wkn=${avg(wkn).toFixed(0)} wkd=${avg(wkd).toFixed(0)} ratio=${ratio.toFixed(2)}x`);
}

// HOOK 3: power sellers 2x purchases
{
	const seg = (uid) => profileBy.get(uid)?.segment;
	const power = [], rest = [];
	for (const [uid, evs] of byUser) {
		const p = evs.filter(e => e.event === 'purchase completed').length;
		(seg(uid) === 'power_seller' ? power : rest).push(p);
	}
	const ratio = avg(power) / Math.max(avg(rest), 0.01);
	check('H3 power_seller 1.5x+ purchases', ratio >= 1.5,
		`power=${avg(power).toFixed(2)} (n=${power.length}) rest=${avg(rest).toFixed(2)} ratio=${ratio.toFixed(2)}x`);
}

// HOOK 4: electronics search → cloned purchases
{
	const elec = [], non = [];
	for (const [uid, evs] of byUser) {
		const hasElec = evs.some(e => e.event === 'item searched' && e.category === 'electronics');
		const purchases = evs.filter(e => e.event === 'purchase completed').length;
		(hasElec ? elec : non).push(purchases);
	}
	const ratio = avg(elec) / Math.max(avg(non), 0.01);
	check('H4 electronics searchers 1.2x+ purchases', ratio >= 1.2,
		`elec=${avg(elec).toFixed(2)} (n=${elec.length}) non=${avg(non).toFixed(2)} ratio=${ratio.toFixed(2)}x`);
}

// HOOK 5: fast responders → more accepted offers
{
	const fast = [], slow = [];
	for (const [uid, evs] of byUser) {
		const isFast = (uid.charCodeAt(0) + uid.charCodeAt(uid.length - 1)) % 5 < 2;
		const acc = evs.filter(e => e.event === 'offer accepted').length;
		(isFast ? fast : slow).push(acc);
	}
	const ratio = avg(fast) / Math.max(avg(slow), 0.01);
	check('H5 fast responders 1.5x+ accepted offers', ratio >= 1.5,
		`fast=${avg(fast).toFixed(2)} (n=${fast.length}) slow=${avg(slow).toFixed(2)} ratio=${ratio.toFixed(2)}x`);
}

// HOOK 6: new sellers churn — post-d14 lower (per-user post/pre ratio)
{
	const ns = [], rest = [];
	for (const [uid, evs] of byUser) {
		evs.sort((a, b) => new Date(a.time) - new Date(b.time));
		const t0 = new Date(evs[0].time).getTime();
		const day14 = t0 + 14 * 86400000;
		const pre = evs.filter(e => new Date(e.time).getTime() <= day14).length;
		const post = evs.filter(e => new Date(e.time).getTime() > day14).length;
		if (pre === 0) continue;
		const r = post / pre;
		(profileBy.get(uid)?.segment === 'new_seller' ? ns : rest).push(r);
	}
	const ratio = avg(ns) / Math.max(avg(rest), 0.01);
	check('H6 new_seller post/pre < 0.85x rest', ratio < 0.85,
		`ns_post/pre=${avg(ns).toFixed(2)} (n=${ns.length}) rest=${avg(rest).toFixed(2)} ratio=${ratio.toFixed(2)}x`);
}

// HOOK 7: power_seller profile total_transactions
{
	const seg = (s) => profiles.filter(p => p.segment === s);
	const power = seg('power_seller'), newS = seg('new_seller');
	const pT = avg(power.map(p => p.total_transactions || 0));
	const nT = avg(newS.map(p => p.total_transactions || 0));
	check('H7 power_seller 10x+ transactions vs new_seller', pT > nT * 10,
		`power=${pT.toFixed(0)} new=${nT.toFixed(1)} ratio=${(pT / Math.max(nT, 0.1)).toFixed(2)}x`);
}

// HOOK 8: frequent_buyer funnel completion higher
{
	const seg = (uid) => profileBy.get(uid)?.segment;
	let fbT = 0, fbC = 0, restT = 0, restC = 0;
	for (const [uid, evs] of byUser) {
		evs.sort((a, b) => new Date(a.time) - new Date(b.time));
		const r = evaluateFunnel(evs, ['item searched', 'item viewed', 'add to cart', 'purchase completed'], { conversionWindowMs: 30 * 86400000 });
		if (seg(uid) === 'frequent_buyer') { fbT++; if (r.completed) fbC++; }
		else { restT++; if (r.completed) restC++; }
	}
	const fbR = fbC / Math.max(fbT, 1), restR = restC / Math.max(restT, 1);
	const lift = fbR / Math.max(restR, 0.001);
	check('H8 frequent_buyer 1.2x+ funnel vs rest', lift >= 1.2,
		`fb=${(fbR * 100).toFixed(1)}% (n=${fbT}) rest=${(restR * 100).toFixed(1)}% lift=${lift.toFixed(2)}x`);
}

// HOOK 9: TTC by segment (KNOWN LIMITATION)
{
	const rows = emulateBreakdown(events, {
		type: 'timeToConvert',
		fromEvent: 'item searched',
		toEvent: 'purchase completed',
		breakdownByUserProperty: 'segment',
		profiles,
		conversionWindowMs: 30 * 86400000,
	});
	const byTier = new Map();
	for (const r of rows) byTier.set(r.segment_value, r);
	const present = byTier.has('power_seller') && byTier.has('window_shopper');
	check('H9 TTC populations present (limitation)', present,
		`segs=${[...byTier.keys()].join(',')}`);
}

// HOOK 10: message-count magic — sweet 2-5 between view+offer → +35% offer_amount
{
	const sweet = [], lower = [];
	for (const [uid, evs] of byUser) {
		evs.sort((a, b) => new Date(a.time) - new Date(b.time));
		const view = evs.find(e => e.event === 'item viewed');
		const offer = evs.find(e => e.event === 'offer received');
		if (!view || !offer) continue;
		const aT = new Date(view.time).getTime();
		const bT = new Date(offer.time).getTime();
		const msgs = evs.filter(e => e.event === 'message sent' && new Date(e.time).getTime() > aT && new Date(e.time).getTime() < bT).length;
		const offerAmounts = evs.filter(e => e.event === 'offer received' && typeof e.offer_amount === 'number').map(e => e.offer_amount);
		if (msgs >= 2 && msgs <= 5) sweet.push(...offerAmounts);
		else if (msgs < 2) lower.push(...offerAmounts);
	}
	const ratio = avg(sweet) / Math.max(avg(lower), 1);
	check('H10 sweet 2-5 msgs 1.15x+ offer_amount', ratio >= 1.15,
		`sweet=${avg(sweet).toFixed(0)} (n=${sweet.length}) lower=${avg(lower).toFixed(0)} (n=${lower.length}) ratio=${ratio.toFixed(2)}x`);
}

const passed = results.filter(r => r.p).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
