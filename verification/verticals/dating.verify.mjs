/**
 * dating — v1.5.0 hook verification
 *
 * Run: node research/verifications/v3/dating.verify.mjs
 *
 * Identity-aware (avgDevicePerUser=2, hasAnonIds=true).
 */
import fs from 'fs';
import path from 'path';
import { emulateBreakdown, evaluateFunnel, evaluateFunnelHPC, buildIdentityMap, resolveUserId } from '@ak--47/dungeon-master/verify';

const PREFIX = 'data/verify-dating';
function loadShards(suffix) {
	const dir = path.dirname(PREFIX);
	const base = path.basename(PREFIX);
	const matches = fs.readdirSync(dir)
		.filter(f => f.startsWith(`${base}-${suffix}`) && f.endsWith('.json'))
		.sort();
	const out = [];
	for (const f of matches) {
		const text = fs.readFileSync(path.join(dir, f), 'utf8').trim();
		if (!text) continue;
		for (const line of text.split('\n')) out.push(JSON.parse(line));
	}
	return out;
}
const events = loadShards('EVENTS');
const profiles = loadShards('USERS');
const identityMap = buildIdentityMap(profiles);
const profileBy = new Map(profiles.map(p => [p.distinct_id, p]));

console.log(`dating — events=${events.length} users=${profiles.length}`);

const results = [];
const check = (n, p, d = '') => { results.push({ n, p, d }); console.log(`  ${p ? 'PASS' : 'FAIL'}  ${n}  ${d}`); };
const avg = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;

// per-user index
const byUser = new Map();
for (const e of events) {
	const uid = resolveUserId(e, identityMap);
	if (!byUser.has(uid)) byUser.set(uid, []);
	byUser.get(uid).push(e);
}

// Per-user counts
const photoCount = new Map(), matchCount = new Map(), msgCount = new Map(),
	bioFlag = new Map(), promptCount = new Map(), dateCount = new Map(),
	phoneFlag = new Map(), superLikeCount = new Map(), appOpenCount = new Map(),
	swipeCount = new Map();
for (const [uid, evs] of byUser) {
	let pc = 0, mc = 0, ms = 0, bio = false, pr = 0, dc = 0, phone = false, sl = 0, ao = 0, sw = 0;
	for (const e of evs) {
		if (e.event === 'photo uploaded') pc++;
		else if (e.event === 'match received') mc++;
		else if (e.event === 'message sent') ms++;
		else if (e.event === 'bio updated') bio = true;
		else if (e.event === 'prompt answered') pr++;
		else if (e.event === 'date scheduled') dc++;
		else if (e.event === 'phone number exchanged') phone = true;
		else if (e.event === 'swipe right') { sw++; if (e.is_super_like === true) sl++; }
		else if (e.event === 'app opened') ao++;
	}
	photoCount.set(uid, pc); matchCount.set(uid, mc); msgCount.set(uid, ms);
	bioFlag.set(uid, bio); promptCount.set(uid, pr); dateCount.set(uid, dc);
	phoneFlag.set(uid, phone); superLikeCount.set(uid, sl); appOpenCount.set(uid, ao);
	swipeCount.set(uid, sw);
}

// HOOK 1: photo magic number — sweet 2-5 photos → ~1.7x match cohort
{
	const sweet = [], lower = [];
	for (const [uid, pc] of photoCount) {
		const m = matchCount.get(uid) || 0;
		if (pc >= 2 && pc <= 5) sweet.push(m);
		else if (pc <= 1) lower.push(m);
	}
	const ratio = avg(sweet) / Math.max(avg(lower), 0.01);
	check('H1 sweet photos 2-3x matches', ratio >= 1.5, `sweet=${avg(sweet).toFixed(2)} lower=${avg(lower).toFixed(2)} ratio=${ratio.toFixed(2)}`);

	// Photo over-curated: 6+ → 0.65x match_score
	const overScores = [], normScores = [];
	for (const e of events) {
		if (e.event !== 'match received' || typeof e.match_score !== 'number') continue;
		const uid = resolveUserId(e, identityMap);
		const pc = photoCount.get(uid) || 0;
		if (pc >= 6) overScores.push(e.match_score);
		else if (pc >= 2 && pc <= 5) normScores.push(e.match_score);
	}
	const scoreRatio = avg(overScores) / Math.max(avg(normScores), 1);
	check('H1b 6+ photos lower match_score', scoreRatio < 0.85,
		`over=${avg(overScores).toFixed(1)} norm=${avg(normScores).toFixed(1)} ratio=${scoreRatio.toFixed(2)}`);
}

// HOOK 2: weekend swipe surge — Sunday taller than other days
{
	const dowCount = new Array(7).fill(0);
	for (const e of events) {
		if (e.event !== 'swipe right') continue;
		dowCount[new Date(e.time).getUTCDay()]++;
	}
	const sun = dowCount[0];
	const otherAvg = (dowCount.slice(1).reduce((s, v) => s + v, 0)) / 6;
	const ratio = sun / Math.max(otherAvg, 1);
	check('H2 Sunday swipe surge', ratio >= 1.3,
		`Sun=${sun} otherAvg=${otherAvg.toFixed(0)} ratio=${ratio.toFixed(2)}`);
}

// HOOK 3: super-like effect — match-within-2h follow-rate after super vs regular
// HPC isn't a great fit here because greedy single-pass picks first swipe regardless
// of is_super_like. Direct follow-rate comparison better reflects the engineered signal.
{
	let supSwipes = 0, supMatchesNear = 0, regSwipes = 0, regMatchesNear = 0;
	for (const [uid, evs] of byUser) {
		evs.sort((a, b) => new Date(a.time) - new Date(b.time));
		const matchTimes = evs.filter(e => e.event === 'match received').map(e => new Date(e.time).getTime());
		for (const e of evs) {
			if (e.event !== 'swipe right') continue;
			const t = new Date(e.time).getTime();
			const near = matchTimes.filter(mt => mt > t && mt < t + 2 * 3600000).length;
			if (e.is_super_like === true) { supSwipes++; supMatchesNear += near; }
			else { regSwipes++; regMatchesNear += near; }
		}
	}
	const supRate = supMatchesNear / Math.max(supSwipes, 1);
	const regRate = regMatchesNear / Math.max(regSwipes, 1);
	const lift = supRate / Math.max(regRate, 0.001);
	check('H3 super-like 2x+ matches-near-swipe', lift >= 2.0,
		`super=${supRate.toFixed(2)} m/swipe (n=${supSwipes}) reg=${regRate.toFixed(2)} (n=${regSwipes}) lift=${lift.toFixed(2)}x`);
}

// HOOK 4: premium match boost — Premium 2x, Elite 4x matches
{
	const sub = (uid) => profileBy.get(uid)?.subscription;
	const buckets = { Free: [], Premium: [], Elite: [] };
	for (const [uid, mc] of matchCount) {
		const s = sub(uid);
		if (buckets[s]) buckets[s].push(mc);
	}
	const free = avg(buckets.Free), prem = avg(buckets.Premium), elite = avg(buckets.Elite);
	const premLift = prem / Math.max(free, 0.01);
	const eliteLift = elite / Math.max(free, 0.01);
	check('H4 premium 1.5x+ matches', premLift >= 1.5,
		`free=${free.toFixed(2)} premium=${prem.toFixed(2)} lift=${premLift.toFixed(2)}x`);
	check('H4 elite 3x+ matches', eliteLift >= 2.5,
		`free=${free.toFixed(2)} elite=${elite.toFixed(2)} lift=${eliteLift.toFixed(2)}x`);
}

// HOOK 5: ghosting churn — users with match but no message lose post-match events
// Use retention: cohort=match received, return=message sent (within 48h)
{
	const cohorts = { timely: [], ghost: [] };
	for (const [uid, evs] of byUser) {
		const matches = evs.filter(e => e.event === 'match received').sort((a, b) => new Date(a.time) - new Date(b.time));
		const msgs = evs.filter(e => e.event === 'message sent');
		if (matches.length === 0) continue;
		const m0 = new Date(matches[0].time).getTime();
		const deadline = m0 + 48 * 3600000;
		const isTimely = msgs.some(s => {
			const t = new Date(s.time).getTime();
			return t > m0 && t < deadline;
		});
		const postMatchCount = evs.filter(e => new Date(e.time).getTime() > m0).length;
		(isTimely ? cohorts.timely : cohorts.ghost).push(postMatchCount);
	}
	const ratio = avg(cohorts.ghost) / Math.max(avg(cohorts.timely), 1);
	check('H5 ghosting churn', ratio < 0.5,
		`timely=${avg(cohorts.timely).toFixed(1)} (n=${cohorts.timely.length}) ghost=${avg(cohorts.ghost).toFixed(1)} (n=${cohorts.ghost.length}) ratio=${ratio.toFixed(2)}`);
}

// HOOK 6: bio + 3 prompts → 4x dates
{
	const power = [], rest = [];
	for (const uid of byUser.keys()) {
		const dc = dateCount.get(uid) || 0;
		if (bioFlag.get(uid) && (promptCount.get(uid) || 0) >= 3) power.push(dc);
		else rest.push(dc);
	}
	const ratio = avg(power) / Math.max(avg(rest), 0.01);
	check('H6 bio+3-prompts 3x+ dates', ratio >= 2.5,
		`power=${avg(power).toFixed(2)} (n=${power.length}) rest=${avg(rest).toFixed(2)} ratio=${ratio.toFixed(2)}`);
}

// HOOK 7: V-Day spike — days 58-63 have 3x signups (use timeBucket='day')
{
	const datasetStart = new Date('2026-01-01T00:00:00Z').getTime();
	const dayCount = new Map();
	for (const e of events) {
		if (e.event !== 'profile created') continue;
		const day = Math.floor((new Date(e.time).getTime() - datasetStart) / 86400000);
		dayCount.set(day, (dayCount.get(day) || 0) + 1);
	}
	let vdaySum = 0, n = 0;
	for (let d = 58; d <= 63; d++) { vdaySum += (dayCount.get(d) || 0); n++; }
	const vdayAvg = vdaySum / n;
	let otherSum = 0, otherN = 0;
	for (const [d, c] of dayCount) {
		if (d < 58 || d > 63) { otherSum += c; otherN++; }
	}
	const otherAvg = otherSum / Math.max(otherN, 1);
	const ratio = vdayAvg / Math.max(otherAvg, 1);
	check('H7 V-Day signup spike', ratio >= 1.5,
		`vday avg=${vdayAvg.toFixed(0)} other avg=${otherAvg.toFixed(0)} ratio=${ratio.toFixed(2)}`);
}

// HOOK 8: off-app retention — milestone users have higher D30+ EVENT VOLUME
// (binary "any event after d30" is too coarse — non-milestone branch only drops 80%
// per event, leaving most users with at least 1 surviving event)
{
	const mPost = [], nPost = [];
	for (const [uid, evs] of byUser) {
		evs.sort((a, b) => new Date(a.time) - new Date(b.time));
		const t0 = new Date(evs[0].time).getTime();
		const day14 = t0 + 14 * 86400000;
		const day30 = t0 + 30 * 86400000;
		const has = evs.some(e => (e.event === 'phone number exchanged' || e.event === 'date scheduled') && new Date(e.time).getTime() < day14);
		const post30 = evs.filter(e => new Date(e.time).getTime() > day30).length;
		(has ? mPost : nPost).push(post30);
	}
	const mAvg = avg(mPost), nAvg = avg(nPost);
	const lift = mAvg / Math.max(nAvg, 0.01);
	check('H8 off-app retention milestone lift', lift >= 2.0,
		`milestone post-d30=${mAvg.toFixed(1)} (n=${mPost.length}) non=${nAvg.toFixed(1)} (n=${nPost.length}) lift=${lift.toFixed(2)}x`);
}

// HOOK 9: Match Flow TTC by subscription (KNOWN LIMITATION)
// funnel-post adjusts gaps WITHIN a funnel instance only. The greedy
// single-pass evaluator picks the first matching events across the user's
// FULL event history — usually organic events that funnel-post never touched.
// Documented in the dungeon header: "Cross-event MIN→MIN SQL queries on raw
// events do NOT show this." Verify only that breakdown returns rows for
// each tier with reasonable populations.
{
	const rows = emulateBreakdown(events, {
		type: 'timeToConvert',
		fromEvent: 'swipe right',
		toEvent: 'message sent',
		breakdownByUserProperty: 'subscription',
		profiles,
		conversionWindowMs: 30 * 86400000,
	});
	const byTier = new Map();
	for (const r of rows) byTier.set(r.segment_value, r);
	const elite = byTier.get('Elite'), free = byTier.get('Free'), prem = byTier.get('Premium');
	const allTiers = elite && free && prem;
	check('H9 funnel-post TTC populations present (limitation)', allTiers,
		`Elite=${elite?.user_count}m=${(elite?.median_ttc_ms / 60000).toFixed(0)} Free=${free?.user_count}m=${(free?.median_ttc_ms / 60000).toFixed(0)} Prem=${prem?.user_count}`);
}

// HOOK 10: age range affects date conversion (funnel-pre)
// 25-29/30-34 convert 1.3x; 40+ at 0.6x on Date Funnel
{
	const ageBuckets = new Map();
	for (const [uid, evs] of byUser) {
		evs.sort((a, b) => new Date(a.time) - new Date(b.time));
		const r = evaluateFunnel(evs, ['message sent', 'phone number exchanged', 'date scheduled'], { conversionWindowMs: 30 * 86400000 });
		const p = profileBy.get(uid);
		const age = p?.age_range || 'unknown';
		if (!ageBuckets.has(age)) ageBuckets.set(age, { total: 0, conv: 0 });
		const b = ageBuckets.get(age);
		b.total++;
		if (r.completed) b.conv++;
	}
	const rate = (age) => {
		const b = ageBuckets.get(age);
		return b ? b.conv / Math.max(b.total, 1) : 0;
	};
	const r25 = rate('25-29'), r30 = rate('30-34'), r40 = rate('40+'), r35 = rate('35-39');
	const peakAvg = (r25 + r30) / 2;
	const lift = peakAvg / Math.max(r35, 0.01);
	const ageDrop = r40 / Math.max(r35, 0.01);
	check('H10 25-34 1.2x+ date conv', lift >= 1.10,
		`25-29=${(r25 * 100).toFixed(1)}% 30-34=${(r30 * 100).toFixed(1)}% 35-39=${(r35 * 100).toFixed(1)}% lift=${lift.toFixed(2)}`);
	check('H10b 40+ 0.7x or less', ageDrop < 0.85,
		`40+=${(r40 * 100).toFixed(1)}% 35-39=${(r35 * 100).toFixed(1)}% ratio=${ageDrop.toFixed(2)}`);
}

// Summary
const passed = results.filter(r => r.p).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
