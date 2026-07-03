import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { emulateBreakdown, evaluateFunnel, buildIdentityMap, resolveUserId } from '@ak--47/dungeon-master/verify';

const PREFIX = 'data/verify-sass';
async function loadShards(suffix) {
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
console.log(`sass — events=${events.length} users=${profiles.length}`);

const results = [];
const check = (n, p, d = '') => { results.push({ n, p, d }); console.log(`  ${p ? 'PASS' : 'FAIL'}  ${n}  ${d}`); };
const avg = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;

const byUser = new Map();
for (const e of events) {
	const uid = resolveUserId(e, identityMap);
	if (!byUser.has(uid)) byUser.set(uid, []);
	byUser.get(uid).push(e);
}

// HOOK 1: end-of-quarter spike (d100-110 plan_upgraded + team invites)
{
	const ds = new Date('2026-01-01T00:00:00Z').getTime();
	const start = ds + 100 * 86400000, end = ds + 110 * 86400000;
	let inUp = 0, outUp = 0, inAll = 0, outAll = 0;
	for (const e of events) {
		if (e.event !== 'billing event') continue;
		const t = new Date(e.time).getTime();
		const isUp = e.event_type === 'plan_upgraded';
		if (t >= start && t < end) { inAll++; if (isUp) inUp++; }
		else { outAll++; if (isUp) outUp++; }
	}
	const inR = inUp / Math.max(inAll, 1), outR = outUp / Math.max(outAll, 1);
	check('H1 EOQ plan_upgraded share elevated', inR > outR * 1.5,
		`in=${(inR * 100).toFixed(1)}% out=${(outR * 100).toFixed(1)}% lift=${(inR / outR).toFixed(2)}x`);
}

// HOOK 2: churned account silencing
{
	const ds = new Date('2026-01-01T00:00:00Z').getTime();
	const day30 = ds + 30 * 86400000;
	const churned = [], normal = [];
	for (const [uid, evs] of byUser) {
		const idHash = String(uid).split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
		const post = evs.filter(e => new Date(e.time).getTime() > day30).length;
		((idHash % 5) === 0 ? churned : normal).push(post);
	}
	const ratio = avg(churned) / Math.max(avg(normal), 0.01);
	check('H2 churned post-d30 < 0.4x normal', ratio < 0.4,
		`churned=${avg(churned).toFixed(1)} (n=${churned.length}) normal=${avg(normal).toFixed(1)} ratio=${ratio.toFixed(2)}x`);
}

// HOOK 3: alert escalation — incident_created emerges
{
	const incidents = events.filter(e => e.event === 'incident created').length;
	check('H3 incidents created > 0', incidents > 0,
		`incidents=${incidents}`);
}

// HOOK 4: integration users (slack+pagerduty) faster ack/resolve
{
	const intU = new Set();
	for (const [uid, evs] of byUser) {
		const ints = new Set(evs.filter(e => e.event === 'integration configured').map(e => e.integration_type));
		if (ints.has('slack') && ints.has('pagerduty')) intU.add(uid);
	}
	const intResp = [], normResp = [];
	for (const e of events) {
		if (e.event !== 'alert acknowledged' || typeof e.response_time_mins !== 'number') continue;
		const uid = resolveUserId(e, identityMap);
		(intU.has(uid) ? intResp : normResp).push(e.response_time_mins);
	}
	const ratio = avg(intResp) / Math.max(avg(normResp), 1);
	check('H4 integration users < 0.85x response time', ratio < 0.85,
		`int=${avg(intResp).toFixed(0)}m (n=${intResp.length}) norm=${avg(normResp).toFixed(0)}m (n=${normResp.length}) ratio=${ratio.toFixed(2)}x`);
}

// HOOK 5+10: docs magic — sweet 4-7 → +deploys; over 8 → -deploys
{
	const sweet = [], lower = [], over = [];
	for (const [uid, evs] of byUser) {
		const dc = evs.filter(e => e.event === 'documentation viewed').length;
		const sd = evs.filter(e => e.event === 'service deployed').length;
		if (dc >= 4 && dc <= 7) sweet.push(sd);
		else if (dc < 4) lower.push(sd);
		else over.push(sd);
	}
	const ratio = avg(sweet) / Math.max(avg(lower), 0.01);
	check('H5/H10 sweet 4-7 docs 1.2x+ deploys', ratio >= 1.2,
		`sweet=${avg(sweet).toFixed(2)} (n=${sweet.length}) lower=${avg(lower).toFixed(2)} (n=${lower.length}) over=${avg(over).toFixed(2)} (n=${over.length}) ratio=${ratio.toFixed(2)}x`);
}

// HOOK 6: cost overrun → infrastructure scale-down
{
	let costOverruns = 0, scaleDownAfter = 0;
	for (const [uid, evs] of byUser) {
		evs.sort((a, b) => new Date(a.time) - new Date(b.time));
		for (let i = 0; i < evs.length; i++) {
			const e = evs[i];
			if (e.event === 'cost report generated' && typeof e.cost_change_percent === 'number' && e.cost_change_percent > 25) {
				costOverruns++;
				const t = new Date(e.time).getTime();
				const nextScale = evs.find((ee, j) => j > i && ee.event === 'infrastructure scaled' && new Date(ee.time).getTime() > t);
				if (nextScale && nextScale.scale_direction === 'down') scaleDownAfter++;
			}
		}
	}
	const rate = scaleDownAfter / Math.max(costOverruns, 1);
	check('H6 cost-overrun → scale-down rate >50%', rate > 0.5,
		`overruns=${costOverruns} scale_down_after=${scaleDownAfter} rate=${(rate * 100).toFixed(1)}%`);
}

// HOOK 7: failed deploy recovery → 1.5x duration
{
	let recoveryCount = 0, recoveryDur = 0, succCount = 0, succDur = 0;
	for (const [uid, evs] of byUser) {
		const pipes = evs.filter(e => e.event === 'deployment pipeline run').sort((a, b) => new Date(a.time) - new Date(b.time));
		for (let i = 1; i < pipes.length; i++) {
			if (pipes[i - 1].status === 'failed' && pipes[i].status === 'success' && typeof pipes[i].duration_sec === 'number') {
				recoveryCount++;
				recoveryDur += pipes[i].duration_sec;
			} else if (pipes[i].status === 'success' && typeof pipes[i].duration_sec === 'number') {
				succCount++;
				succDur += pipes[i].duration_sec;
			}
		}
	}
	const recAvg = recoveryDur / Math.max(recoveryCount, 1);
	const succAvg = succDur / Math.max(succCount, 1);
	check('H7 recovery deploy > regular success duration', recAvg > succAvg,
		`recovery=${recAvg.toFixed(0)}s (n=${recoveryCount}) success=${succAvg.toFixed(0)}s (n=${succCount})`);
}

// HOOK 8: enterprise vs startup company size profile
{
	const ent = profiles.filter(p => p.company_size === 'enterprise');
	const start = profiles.filter(p => p.company_size === 'startup');
	const entSeats = avg(ent.map(p => p.seat_count || 0));
	const startSeats = avg(start.map(p => p.seat_count || 0));
	check('H8 enterprise > startup seat_count', entSeats > startSeats,
		`enterprise=${entSeats.toFixed(0)} startup=${startSeats.toFixed(0)}`);
}

// HOOK 9: incident TTC by company size
{
	const sizeRT = { enterprise: [], smb: [], startup: [] };
	for (const e of events) {
		if (e.event !== 'alert resolved' || typeof e.resolution_time_mins !== 'number') continue;
		const s = profileBy.get(resolveUserId(e, identityMap))?.company_size;
		if (sizeRT[s]) sizeRT[s].push(e.resolution_time_mins);
	}
	const ent = avg(sizeRT.enterprise), start = avg(sizeRT.startup);
	check('H9 enterprise < startup resolution time', ent < start,
		`enterprise=${ent.toFixed(0)}m (n=${sizeRT.enterprise.length}) startup=${start.toFixed(0)}m (n=${sizeRT.startup.length})`);
}

// HOOK 11: deploy pipeline experiment ($experiment_started for "Canary Deploys")
{
	const expEvents = events.filter(e => e.event === '$experiment_started' && e['Experiment name'] === 'Canary Deploys');
	const variants = new Set(expEvents.map(e => e['Variant name']));
	const variantList = [...variants].sort();
	const userVariant = new Map();
	let multiVariant = 0;
	for (const e of expEvents) {
		const uid = resolveUserId(e, identityMap);
		if (userVariant.has(uid) && userVariant.get(uid) !== e['Variant name']) multiVariant++;
		else userVariant.set(uid, e['Variant name']);
	}
	check('H11 Canary Deploys experiment 2+ variants, deterministic', variantList.length >= 2 && multiVariant === 0,
		`variants=[${variantList.join(',')}] exposures=${expEvents.length} multi_variant_users=${multiVariant}`);
}

const passed = results.filter(r => r.p).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
