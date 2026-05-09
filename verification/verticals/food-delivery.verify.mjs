import fs from 'fs';
import path from 'path';
import { emulateBreakdown, evaluateFunnel, buildIdentityMap, resolveUserId } from '@ak--47/dungeon-master/verify';

const PREFIX = 'data/verify-food-delivery';
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
console.log(`food-delivery — events=${events.length} users=${profiles.length}`);

const results = [];
const check = (n, p, d = '') => { results.push({ n, p, d }); console.log(`  ${p ? 'PASS' : 'FAIL'}  ${n}  ${d}`); };
const avg = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;

const byUser = new Map();
for (const e of events) {
	const uid = resolveUserId(e, identityMap);
	if (!byUser.has(uid)) byUser.set(uid, []);
	byUser.get(uid).push(e);
}

// HOOK 1: lunch/dinner rush — meal hours dominate
{
	const hod = new Array(24).fill(0);
	for (const e of events) {
		if (e.event !== 'order delivered') continue;
		hod[new Date(e.time).getUTCHours()]++;
	}
	const meal = (hod.slice(11, 14).reduce((s, v) => s + v, 0) + hod.slice(17, 21).reduce((s, v) => s + v, 0)) / 7;
	const off = (hod.reduce((s, v) => s + v, 0) - meal * 7) / 17;
	const ratio = meal / Math.max(off, 1);
	check('H1 meal hours 1.3x+ off-hours', ratio >= 1.3,
		`meal=${meal.toFixed(0)}/hr off=${off.toFixed(0)}/hr ratio=${ratio.toFixed(2)}x`);
}

// HOOK 2: Free tier coupons — Free > QuickBite+
{
	const tier = (uid) => profileBy.get(uid)?.subscription_tier;
	const freeC = [], qbpC = [];
	for (const [uid, evs] of byUser) {
		const c = evs.filter(e => e.event === 'coupon applied').length;
		if (tier(uid) === 'Free') freeC.push(c);
		else if (tier(uid) === 'QuickBite+') qbpC.push(c);
	}
	const ratio = avg(freeC) / Math.max(avg(qbpC), 0.01);
	check('H2 Free 1.1x+ coupons vs QB+', ratio >= 1.1,
		`Free=${avg(freeC).toFixed(2)} QB+=${avg(qbpC).toFixed(2)} ratio=${ratio.toFixed(2)}x`);
}

// HOOK 3: late night munchies — American share spikes 22-02
{
	const late = new Map(), normal = new Map();
	for (const e of events) {
		if (e.event !== 'restaurant viewed' || !e.cuisine_type) continue;
		const h = new Date(e.time).getUTCHours();
		const m = ((h >= 22) || (h <= 2)) ? late : normal;
		m.set(e.cuisine_type, (m.get(e.cuisine_type) || 0) + 1);
	}
	const lateAm = (late.get('American') || 0) / [...late.values()].reduce((s, v) => s + v, 1);
	const normAm = (normal.get('American') || 0) / [...normal.values()].reduce((s, v) => s + v, 1);
	const ratio = lateAm / Math.max(normAm, 0.01);
	check('H3 late-night American share 2x+', ratio >= 2.0,
		`late=${(lateAm * 100).toFixed(1)}% normal=${(normAm * 100).toFixed(1)}% ratio=${ratio.toFixed(2)}x`);
}

// HOOK 4: rainy week d20-27 surge — delivery_fee 2x and order vol 1.4x
{
	const ds = new Date('2026-01-01T00:00:00Z').getTime();
	const inWin = [], outWin = [];
	const inCount = new Map(), outCount = new Map();
	for (const e of events) {
		if (e.event !== 'order placed') continue;
		const d = Math.floor((new Date(e.time).getTime() - ds) / 86400000);
		if (d >= 20 && d <= 27) {
			if (typeof e.delivery_fee === 'number') inWin.push(e.delivery_fee);
			inCount.set(d, (inCount.get(d) || 0) + 1);
		} else {
			if (typeof e.delivery_fee === 'number') outWin.push(e.delivery_fee);
			outCount.set(d, (outCount.get(d) || 0) + 1);
		}
	}
	const feeRatio = avg(inWin) / Math.max(avg(outWin), 1);
	const inAvg = [...inCount.values()].reduce((s, v) => s + v, 0) / Math.max(inCount.size, 1);
	const outAvg = [...outCount.values()].reduce((s, v) => s + v, 0) / Math.max(outCount.size, 1);
	const volRatio = inAvg / Math.max(outAvg, 1);
	check('H4 rainy week delivery_fee 1.5x+', feeRatio >= 1.5,
		`in=${avg(inWin).toFixed(1)} out=${avg(outWin).toFixed(1)} ratio=${feeRatio.toFixed(2)}x`);
	// H4b volume: compare to NEIGHBORING days (15-19 + 28-32) to control for
	// born-in-dataset growth ramp. The "out=142/day" includes much later, busier days.
	const neighborCount = new Map();
	for (const e of events) {
		if (e.event !== 'order placed') continue;
		const d = Math.floor((new Date(e.time).getTime() - ds) / 86400000);
		if ((d >= 15 && d < 20) || (d > 27 && d <= 32)) neighborCount.set(d, (neighborCount.get(d) || 0) + 1);
	}
	const nbAvg = [...neighborCount.values()].reduce((s, v) => s + v, 0) / Math.max(neighborCount.size, 1);
	const volRatioNB = inAvg / Math.max(nbAvg, 1);
	check('H4b rainy week volume 1.2x+ (vs neighbors)', volRatioNB >= 1.2,
		`in=${inAvg.toFixed(0)}/day neighbors=${nbAvg.toFixed(0)}/day ratio=${volRatioNB.toFixed(2)}x`);
}

// HOOK 5: referral users — food_rating 4-5 + 1.5x reorders
{
	const refUsers = new Set();
	for (const e of events) {
		if (e.event === 'account created' && e.referral_code === true) {
			refUsers.add(resolveUserId(e, identityMap));
		}
	}
	const refReord = [], nonReord = [];
	for (const [uid, evs] of byUser) {
		const r = evs.filter(e => e.event === 'reorder initiated').length;
		(refUsers.has(uid) ? refReord : nonReord).push(r);
	}
	const ratio = avg(refReord) / Math.max(avg(nonReord), 0.01);
	check('H5 referral users 1.4x+ reorders', ratio >= 1.4,
		`ref=${avg(refReord).toFixed(2)} (n=${refReord.length}) non=${avg(nonReord).toFixed(2)} ratio=${ratio.toFixed(2)}x`);

	// food rating
	let refRating = [], nonRating = [];
	for (const e of events) {
		if (e.event !== 'order rated' || typeof e.food_rating !== 'number') continue;
		const uid = resolveUserId(e, identityMap);
		(refUsers.has(uid) ? refRating : nonRating).push(e.food_rating);
	}
	const ra = avg(refRating), na = avg(nonRating);
	check('H5b referral users food_rating > non', ra > na && ra >= 4.0,
		`ref=${ra.toFixed(2)} non=${na.toFixed(2)}`);
}

// HOOK 6: trial users with <3 early orders churn
{
	const trial3 = [], trialNon = [];
	for (const [uid, evs] of byUser) {
		evs.sort((a, b) => new Date(a.time) - new Date(b.time));
		const t0 = new Date(evs[0].time).getTime();
		const day14 = t0 + 14 * 86400000;
		const trial = evs.some(e => e.event === 'subscription started' && e.trial === true);
		if (!trial) continue;
		const earlyOrders = evs.filter(e => e.event === 'order placed' && new Date(e.time).getTime() < day14).length;
		const post14 = evs.filter(e => new Date(e.time).getTime() > day14).length;
		(earlyOrders >= 3 ? trial3 : trialNon).push(post14);
	}
	const ratio = avg(trialNon) / Math.max(avg(trial3), 0.01);
	check('H6 trial-fail post-d14 < 0.5x trial-success', ratio < 0.5,
		`trial3+=${avg(trial3).toFixed(1)} (n=${trial3.length}) trial<3=${avg(trialNon).toFixed(1)} (n=${trialNon.length}) ratio=${ratio.toFixed(2)}x`);
}

// HOOK 7: hash-based first-order bonus — half users have lower delivered/placed ratio
{
	const newU = { d: 0, p: 0 }, retU = { d: 0, p: 0 };
	for (const [uid, evs] of byUser) {
		const isNew = typeof uid === 'string' && uid.charCodeAt(0) % 2 === 0;
		const d = evs.filter(e => e.event === 'order delivered').length;
		const p = evs.filter(e => e.event === 'order placed').length;
		const target = isNew ? newU : retU;
		target.d += d; target.p += p;
	}
	const newR = newU.d / Math.max(newU.p, 1), retR = retU.d / Math.max(retU.p, 1);
	const ratio = retR / Math.max(newR, 0.001);
	check('H7 returning users <0.95x deliver/place', ratio < 0.95,
		`new=${(newR * 100).toFixed(1)}% ret=${(retR * 100).toFixed(1)}% ratio=${ratio.toFixed(2)}x`);
}

// HOOK 8: order-count magic — sweet 4-8 → +40% order_total
{
	const sweet = [], lower = [];
	for (const [uid, evs] of byUser) {
		const oc = evs.filter(e => e.event === 'order placed').length;
		const totals = evs.filter(e => e.event === 'order placed' && typeof e.order_total === 'number').map(e => e.order_total);
		if (oc >= 4 && oc <= 8) sweet.push(...totals);
		else if (oc < 4) lower.push(...totals);
	}
	const ratio = avg(sweet) / Math.max(avg(lower), 1);
	check('H8 sweet 4-8 1.2x+ order_total', ratio >= 1.2,
		`sweet=${avg(sweet).toFixed(0)} lower=${avg(lower).toFixed(0)} ratio=${ratio.toFixed(2)}x`);
}

// HOOK 9: TTC — QB+ delivery_mins shorter than Free
{
	const tier = (uid) => profileBy.get(uid)?.subscription_tier;
	const qb = [], fr = [];
	for (const e of events) {
		if (e.event !== 'order delivered' || typeof e.actual_delivery_mins !== 'number') continue;
		const t = tier(resolveUserId(e, identityMap));
		if (t === 'QuickBite+') qb.push(e.actual_delivery_mins);
		else if (t === 'Free') fr.push(e.actual_delivery_mins);
	}
	const ratio = avg(qb) / Math.max(avg(fr), 1);
	check('H9 QB+ <0.7x Free delivery_mins', ratio < 0.7,
		`QB+=${avg(qb).toFixed(1)}m (n=${qb.length}) Free=${avg(fr).toFixed(1)}m (n=${fr.length}) ratio=${ratio.toFixed(2)}x`);
}

// HOOK 10: city density reorder — SF/NYC > Houston/Phoenix
{
	const cityConv = new Map();
	for (const [uid, evs] of byUser) {
		evs.sort((a, b) => new Date(a.time) - new Date(b.time));
		const r = evaluateFunnel(evs, ['order delivered', 'order rated', 'reorder initiated'], { conversionWindowMs: 30 * 86400000 });
		const c = profileBy.get(uid)?.city;
		if (!cityConv.has(c)) cityConv.set(c, { t: 0, c: 0 });
		const b = cityConv.get(c);
		b.t++; if (r.completed) b.c++;
	}
	const denseRate = (
		((cityConv.get('San Francisco')?.c || 0) + (cityConv.get('New York')?.c || 0)) /
		Math.max((cityConv.get('San Francisco')?.t || 0) + (cityConv.get('New York')?.t || 0), 1)
	);
	const sprawlRate = (
		((cityConv.get('Houston')?.c || 0) + (cityConv.get('Phoenix')?.c || 0)) /
		Math.max((cityConv.get('Houston')?.t || 0) + (cityConv.get('Phoenix')?.t || 0), 1)
	);
	const lift = denseRate / Math.max(sprawlRate, 0.001);
	check('H10 dense city 1.3x+ reorder vs sprawl', lift >= 1.3,
		`dense=${(denseRate * 100).toFixed(1)}% sprawl=${(sprawlRate * 100).toFixed(1)}% lift=${lift.toFixed(2)}x`);
}

const passed = results.filter(r => r.p).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
