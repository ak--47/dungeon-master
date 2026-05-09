import fs from 'fs';
import path from 'path';
import { emulateBreakdown, evaluateFunnel, buildIdentityMap, resolveUserId } from '@ak--47/dungeon-master/verify';

const PREFIX = 'data/verify-devtools';
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
console.log(`devtools — events=${events.length} users=${profiles.length}`);

const results = [];
const check = (n, p, d = '') => { results.push({ n, p, d }); console.log(`  ${p ? 'PASS' : 'FAIL'}  ${n}  ${d}`); };
const avg = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;

const byUser = new Map();
for (const e of events) {
	const uid = resolveUserId(e, identityMap);
	if (!byUser.has(uid)) byUser.set(uid, []);
	byUser.get(uid).push(e);
}

// HOOK 1: failed builds 2x duration
{
	const failed = [], success = [];
	for (const e of events) {
		if (e.event !== 'build completed' || typeof e.build_duration_sec !== 'number') continue;
		if (e.build_status === 'failed') failed.push(e.build_duration_sec);
		else if (e.build_status === 'success') success.push(e.build_duration_sec);
	}
	const ratio = avg(failed) / Math.max(avg(success), 1);
	check('H1 failed build 1.5x+ duration', ratio >= 1.5,
		`failed=${avg(failed).toFixed(0)}s (n=${failed.length}) success=${avg(success).toFixed(0)}s ratio=${ratio.toFixed(2)}x`);
}

// HOOK 2: night deploy failure rate elevated
{
	let nightF = 0, nightT = 0, dayF = 0, dayT = 0;
	for (const e of events) {
		if (e.event !== 'deployment completed') continue;
		const h = new Date(e.time).getUTCHours();
		const isNight = (h >= 22 || h < 6);
		if (isNight) { nightT++; if (e.deploy_status === 'failed') nightF++; }
		else { dayT++; if (e.deploy_status === 'failed') dayF++; }
	}
	const nR = nightF / Math.max(nightT, 1), dR = dayF / Math.max(dayT, 1);
	const lift = nR / Math.max(dR, 0.001);
	check('H2 night deploy failure 2x+', lift >= 2.0,
		`night=${(nR * 100).toFixed(1)}% day=${(dR * 100).toFixed(1)}% lift=${lift.toFixed(2)}x`);
}

// HOOK 3: copilot users 1.5x PRs
{
	const copPRs = [], manualPRs = [];
	for (const [uid, evs] of byUser) {
		const usesCopilot = typeof uid === 'string' && uid.charCodeAt(0) % 10 < 3;
		const prs = evs.filter(e => e.event === 'pull request created').length;
		(usesCopilot ? copPRs : manualPRs).push(prs);
	}
	const ratio = avg(copPRs) / Math.max(avg(manualPRs), 0.01);
	check('H3 copilot users 1.3x+ PRs', ratio >= 1.3,
		`copilot=${avg(copPRs).toFixed(2)} (n=${copPRs.length}) manual=${avg(manualPRs).toFixed(2)} ratio=${ratio.toFixed(2)}x`);
}

// HOOK 4: alert fatigue — heavy alert users have higher response_time
{
	const heavy = [], normal = [];
	for (const [uid, evs] of byUser) {
		const ac = evs.filter(e => e.event === 'alert triggered').length;
		const rt = evs.filter(e => (e.event === 'incident created' || e.event === 'incident resolved') && typeof e.response_time_minutes === 'number').map(e => e.response_time_minutes);
		(ac > 20 ? heavy : normal).push(...rt);
	}
	const ratio = avg(heavy) / Math.max(avg(normal), 1);
	check('H4 alert fatigue 1.5x+ response time', ratio >= 1.5,
		`heavy=${avg(heavy).toFixed(0)}m (n=${heavy.length}) normal=${avg(normal).toFixed(0)}m (n=${normal.length}) ratio=${ratio.toFixed(2)}x`);
}

// HOOK 5: OSS users with >15 events have more builds
{
	const ossActive = [], ossLight = [];
	for (const [uid, evs] of byUser) {
		const seg = profileBy.get(uid)?.segment;
		if (seg !== 'oss_user') continue;
		const builds = evs.filter(e => e.event === 'build completed').length;
		(evs.length > 15 ? ossActive : ossLight).push(builds);
	}
	const ratio = avg(ossActive) / Math.max(avg(ossLight), 0.01);
	check('H5 OSS active 1.5x+ builds vs light', ratio >= 1.5,
		`active=${avg(ossActive).toFixed(2)} (n=${ossActive.length}) light=${avg(ossLight).toFixed(2)} (n=${ossLight.length}) ratio=${ratio.toFixed(2)}x`);
}

// HOOK 6: post-outage recovery — d44-48 deploy spike
{
	const ds = new Date('2026-01-01T00:00:00Z').getTime();
	const inWin = new Map(), outWin = new Map();
	for (const e of events) {
		if (e.event !== 'deployment completed') continue;
		const d = Math.floor((new Date(e.time).getTime() - ds) / 86400000);
		if (d >= 44 && d <= 48) inWin.set(d, (inWin.get(d) || 0) + 1);
		// neighbor days for fair baseline
		else if ((d >= 35 && d < 42) || (d > 49 && d <= 55)) outWin.set(d, (outWin.get(d) || 0) + 1);
	}
	const inAvg = [...inWin.values()].reduce((s, v) => s + v, 0) / Math.max(inWin.size, 1);
	const outAvg = [...outWin.values()].reduce((s, v) => s + v, 0) / Math.max(outWin.size, 1);
	const ratio = inAvg / Math.max(outAvg, 1);
	check('H6 post-outage spike 1.5x+', ratio >= 1.5,
		`in=${inAvg.toFixed(0)}/day out=${outAvg.toFixed(0)}/day ratio=${ratio.toFixed(2)}x`);
}

// HOOK 7: devops profile enrichment
{
	const seg = (s) => profiles.filter(p => p.segment === s);
	const dev = seg('devops'), jr = seg('junior');
	const devTeam = avg(dev.map(p => p.team_size || 0));
	const jrTeam = avg(jr.map(p => p.team_size || 0));
	check('H7 devops 2x+ team_size vs junior', devTeam / Math.max(jrTeam, 0.01) >= 2.0,
		`devops=${devTeam.toFixed(1)} junior=${jrTeam.toFixed(1)} ratio=${(devTeam / jrTeam).toFixed(2)}x`);
}

// HOOK 8: enterprise funnel lift
{
	const tier = (uid) => profileBy.get(uid)?.subscription_tier;
	let entT = 0, entC = 0, freeT = 0, freeC = 0;
	for (const [uid, evs] of byUser) {
		evs.sort((a, b) => new Date(a.time) - new Date(b.time));
		const r = evaluateFunnel(evs, ['build completed', 'deployment completed', 'monitoring dashboard viewed'], { conversionWindowMs: 30 * 86400000 });
		const t = tier(uid);
		if (t === 'enterprise' || t === 'business') { entT++; if (r.completed) entC++; }
		if (t === 'free') { freeT++; if (r.completed) freeC++; }
	}
	const entR = entC / Math.max(entT, 1), freeR = freeC / Math.max(freeT, 1);
	const lift = entR / Math.max(freeR, 0.001);
	check('H8 enterprise 1.2x+ funnel vs free', lift >= 1.2,
		`enterprise=${(entR * 100).toFixed(1)}% (n=${entT}) free=${(freeR * 100).toFixed(1)}% (n=${freeT}) lift=${lift.toFixed(2)}x`);
}

// HOOK 9: build-count magic — sweet 15-30 → +50% deploys
{
	const sweet = [], lower = [];
	for (const [uid, evs] of byUser) {
		const bc = evs.filter(e => e.event === 'build completed').length;
		const dc = evs.filter(e => e.event === 'deployment completed').length;
		if (bc >= 15 && bc <= 30) sweet.push(dc);
		else if (bc < 15) lower.push(dc);
	}
	const ratio = avg(sweet) / Math.max(avg(lower), 0.01);
	check('H9 sweet 15-30 builds → 1.4x+ deploys', ratio >= 1.4,
		`sweet=${avg(sweet).toFixed(2)} (n=${sweet.length}) lower=${avg(lower).toFixed(2)} (n=${lower.length}) ratio=${ratio.toFixed(2)}x`);
}

// HOOK 10: TTC by tier (KNOWN LIMITATION)
{
	const rows = emulateBreakdown(events, {
		type: 'timeToConvert',
		fromEvent: 'build completed',
		toEvent: 'monitoring dashboard viewed',
		breakdownByUserProperty: 'subscription_tier',
		profiles,
		conversionWindowMs: 30 * 86400000,
	});
	const byTier = new Map();
	for (const r of rows) byTier.set(r.segment_value, r);
	const present = byTier.has('enterprise') && byTier.has('free');
	check('H10 TTC populations present (limitation)', present,
		`tiers=${[...byTier.keys()].join(',')}`);
}

const passed = results.filter(r => r.p).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
