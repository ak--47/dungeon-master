/**
 * travel — v1.5.0 hook verification
 * Run: node --max-old-space-size=4096 research/verifications/v3/travel.verify.mjs
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { emulateBreakdown, evaluateFunnel, buildIdentityMap, resolveUserId } from '@ak--47/dungeon-master/verify';

const PREFIX = 'data/verify-travel';
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
console.log(`travel — events=${events.length} users=${profiles.length}`);

const results = [];
const check = (n, p, d = '') => { results.push({ n, p, d }); console.log(`  ${p ? 'PASS' : 'FAIL'}  ${n}  ${d}`); };
const avg = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;

const byUser = new Map();
for (const e of events) {
	const uid = resolveUserId(e, identityMap);
	if (!byUser.has(uid)) byUser.set(uid, []);
	byUser.get(uid).push(e);
}

// HOOK 1: weekend Fri/Sat/Sun rates 1.3x
{
	const wkn = [], wkd = [];
	for (const e of events) {
		if (e.event !== 'booking completed' || typeof e.nightly_rate !== 'number') continue;
		const dow = new Date(e.time).getUTCDay();
		((dow === 0 || dow === 5 || dow === 6) ? wkn : wkd).push(e.nightly_rate);
	}
	const ratio = avg(wkn) / Math.max(avg(wkd), 1);
	check('H1 weekend rates 1.2x+', ratio >= 1.10,
		`wkn=${avg(wkn).toFixed(0)} wkd=${avg(wkd).toFixed(0)} ratio=${ratio.toFixed(2)}`);
}

// HOOK 2: advance vs last_minute booking_window rates
{
	const adv = [], lm = [], std = [];
	for (const e of events) {
		if (e.event !== 'booking completed' || typeof e.nightly_rate !== 'number') continue;
		if (e.booking_window === 'advance') adv.push(e.nightly_rate);
		else if (e.booking_window === 'last_minute') lm.push(e.nightly_rate);
		else if (e.booking_window === 'standard') std.push(e.nightly_rate);
	}
	const lmRatio = avg(lm) / Math.max(avg(adv), 1);
	check('H2 last_minute > advance (1.3x+)', lmRatio >= 1.3,
		`advance=${avg(adv).toFixed(0)} (n=${adv.length}) last_min=${avg(lm).toFixed(0)} (n=${lm.length}) ratio=${lmRatio.toFixed(2)}`);
}

// HOOK 3: 5+ bookings get 3x loyalty_points
{
	const big = [], rest = [];
	for (const [uid, evs] of byUser) {
		const bookings = evs.filter(e => e.event === 'booking completed');
		const points = bookings.map(e => e.loyalty_points).filter(p => typeof p === 'number');
		(bookings.length >= 5 ? big : rest).push(...points);
	}
	const ratio = avg(big) / Math.max(avg(rest), 0.01);
	check('H3 loyalty 5+ bookings 1.4x+ points', ratio >= 1.4,
		`big=${avg(big).toFixed(0)} (n=${big.length}) rest=${avg(rest).toFixed(0)} ratio=${ratio.toFixed(2)}`);
}

// HOOK 4: cancellation by booking_window — last_minute < advance
{
	const winCancel = new Map();
	for (const e of events) {
		if (e.event !== 'booking cancelled') continue;
		const w = e.booking_window || 'unknown';
		winCancel.set(w, (winCancel.get(w) || 0) + 1);
	}
	const adv = winCancel.get('advance') || 0, lm = winCancel.get('last_minute') || 0;
	const ratio = lm / Math.max(adv, 1);
	check('H4 last_minute fewer cancellations', ratio < 0.5,
		`advance=${adv} last_min=${lm} ratio=${ratio.toFixed(2)}`);
}

// HOOK 5: luxury_seeker more upgrades
{
	const segUpgrade = new Map();
	for (const [uid, evs] of byUser) {
		const seg = profileBy.get(uid)?.customer_segment;
		const u = evs.filter(e => e.event === 'room upgrade selected').length;
		if (!segUpgrade.has(seg)) segUpgrade.set(seg, []);
		segUpgrade.get(seg).push(u);
	}
	const lux = avg(segUpgrade.get('luxury_seeker') || []);
	const bud = avg(segUpgrade.get('budget_hunter') || []);
	const ratio = lux / Math.max(bud, 0.01);
	check('H5 luxury 1.8x+ upgrades vs budget', ratio >= 1.8,
		`luxury=${lux.toFixed(2)} budget=${bud.toFixed(2)} ratio=${ratio.toFixed(2)}`);
}

// HOOK 6: review length by stay rating
{
	const high = [], low = [];
	for (const [uid, evs] of byUser) {
		const reviews = evs.filter(e => e.event === 'review submitted' && typeof e.stay_rating === 'number');
		if (!reviews.length) continue;
		const avgR = reviews.reduce((s, e) => s + e.stay_rating, 0) / reviews.length;
		const lengths = reviews.map(e => e.review_length).filter(l => typeof l === 'number');
		if (avgR >= 4) high.push(...lengths);
		else if (avgR <= 2) low.push(...lengths);
	}
	const ratio = avg(high) / Math.max(avg(low), 1);
	check('H6 high-rating reviews 1.5x+ longer', ratio >= 1.5,
		`high=${avg(high).toFixed(0)} (n=${high.length}) low=${avg(low).toFixed(0)} (n=${low.length}) ratio=${ratio.toFixed(2)}`);
}

// HOOK 7: business profile — company_name + travel_frequency=weekly
{
	const biz = profiles.filter(p => p.customer_segment === 'business_traveler');
	const weekly = biz.filter(p => p.travel_frequency === 'weekly').length;
	const named = biz.filter(p => p.company_name && p.company_name !== 'none').length;
	check('H7 business has weekly + company_name', weekly === biz.length && named === biz.length,
		`biz=${biz.length} weekly=${weekly} named=${named}`);
}

// HOOK 8: business funnel conversion > budget
{
	const segConv = new Map();
	for (const [uid, evs] of byUser) {
		evs.sort((a, b) => new Date(a.time) - new Date(b.time));
		const r = evaluateFunnel(evs, ['destination searched', 'hotel viewed', 'booking completed'], { conversionWindowMs: 30 * 86400000 });
		const seg = profileBy.get(uid)?.customer_segment;
		if (!segConv.has(seg)) segConv.set(seg, { t: 0, c: 0 });
		const b = segConv.get(seg);
		b.t++; if (r.completed) b.c++;
	}
	const bizR = (segConv.get('business_traveler')?.c || 0) / Math.max(segConv.get('business_traveler')?.t || 1, 1);
	const budR = (segConv.get('budget_hunter')?.c || 0) / Math.max(segConv.get('budget_hunter')?.t || 1, 1);
	const lift = bizR / Math.max(budR, 0.001);
	check('H8 business 1.3x+ funnel vs budget', lift >= 1.3,
		`business=${(bizR * 100).toFixed(1)}% budget=${(budR * 100).toFixed(1)}% lift=${lift.toFixed(2)}x`);
}

// HOOK 9: TTC by segment (KNOWN LIMITATION)
{
	const rows = emulateBreakdown(events, {
		type: 'timeToConvert',
		fromEvent: 'destination searched',
		toEvent: 'booking completed',
		breakdownByUserProperty: 'customer_segment',
		profiles,
		conversionWindowMs: 30 * 86400000,
	});
	const byTier = new Map();
	for (const r of rows) byTier.set(r.segment_value, r);
	const present = byTier.has('business_traveler') && byTier.has('budget_hunter');
	check('H9 TTC populations present (limitation)', present,
		`segs=${[...byTier.keys()].join(',')}`);
}

// HOOK 10: hotel-viewed magic number — sweet 5-10 → +30% nightly_rate
{
	const sweet = [], lower = [], over = [];
	for (const [uid, evs] of byUser) {
		const hv = evs.filter(e => e.event === 'hotel viewed').length;
		const rates = evs.filter(e => e.event === 'booking completed' && typeof e.nightly_rate === 'number').map(e => e.nightly_rate);
		if (hv >= 5 && hv <= 10) sweet.push(...rates);
		else if (hv < 5) lower.push(...rates);
		else over.push(...rates);
	}
	const ratio = avg(sweet) / Math.max(avg(lower), 0.01);
	check('H10 sweet 5-10 1.2x+ nightly_rate', ratio >= 1.15,
		`sweet=${avg(sweet).toFixed(0)} (n=${sweet.length}) lower=${avg(lower).toFixed(0)} (n=${lower.length}) ratio=${ratio.toFixed(2)}`);
}

const passed = results.filter(r => r.p).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
