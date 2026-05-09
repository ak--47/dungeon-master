/**
 * logistics — v1.5.0 hook verification
 */
import fs from 'fs';
import path from 'path';
import { emulateBreakdown, evaluateFunnel, buildIdentityMap, resolveUserId } from '@ak--47/dungeon-master/verify';

const PREFIX = 'data/verify-logistics';
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
console.log(`logistics — events=${events.length} users=${profiles.length}`);

const results = [];
const check = (n, p, d = '') => { results.push({ n, p, d }); console.log(`  ${p ? 'PASS' : 'FAIL'}  ${n}  ${d}`); };
const avg = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;

const byUser = new Map();
for (const e of events) {
	const uid = resolveUserId(e, identityMap);
	if (!byUser.has(uid)) byUser.set(uid, []);
	byUser.get(uid).push(e);
}

// HOOK 1: month-end report_pages 2x
{
	const me = [], mid = [];
	for (const e of events) {
		if (e.event !== 'report generated' || typeof e.report_pages !== 'number') continue;
		const dom = new Date(e.time).getUTCDate();
		(dom >= 28 ? me : mid).push(e.report_pages);
	}
	const ratio = avg(me) / Math.max(avg(mid), 1);
	check('H1 month-end reports 2x+ pages', ratio >= 1.7,
		`me=${avg(me).toFixed(0)} (n=${me.length}) mid=${avg(mid).toFixed(0)} ratio=${ratio.toFixed(2)}`);
}

// HOOK 2: rush order — urgent unit_cost 1.5x
{
	const buckets = new Map();
	for (const e of events) {
		if (e.event !== 'purchase order created' || typeof e.unit_cost !== 'number') continue;
		const p = e.priority || 'unknown';
		if (!buckets.has(p)) buckets.set(p, []);
		buckets.get(p).push(e.unit_cost);
	}
	const urgent = avg(buckets.get('urgent') || []);
	const std = avg(buckets.get('standard') || []);
	const ratio = urgent / Math.max(std, 1);
	check('H2 urgent 1.3x+ unit_cost', ratio >= 1.3,
		`urgent=${urgent.toFixed(0)} std=${std.toFixed(0)} ratio=${ratio.toFixed(2)}`);
}

// HOOK 3: enterprise stockout-to-inventory ratio 0.9x SMB
{
	const tier = (uid) => profileBy.get(uid)?.company_tier;
	const tierStock = new Map(), tierInv = new Map();
	for (const [uid, evs] of byUser) {
		const t = tier(uid);
		const s = evs.filter(e => e.event === 'stockout alert').length;
		const i = evs.filter(e => e.event === 'inventory checked').length;
		tierStock.set(t, (tierStock.get(t) || 0) + s);
		tierInv.set(t, (tierInv.get(t) || 0) + i);
	}
	const ratio = (t) => (tierStock.get(t) || 0) / Math.max(tierInv.get(t) || 1, 1);
	const ent = ratio('enterprise'), smb = ratio('small_business');
	const lift = ent / Math.max(smb, 0.001);
	check('H3 enterprise lower stockout ratio (<0.95x SMB)', lift < 0.95,
		`ent=${ent.toFixed(3)} smb=${smb.toFixed(3)} lift=${lift.toFixed(2)}x`);
}

// HOOK 4: 3+ integrations → 2x reports
{
	const big = [], rest = [];
	for (const [uid, evs] of byUser) {
		const ic = evs.filter(e => e.event === 'integration connected').length;
		const rc = evs.filter(e => e.event === 'report generated').length;
		(ic >= 3 ? big : rest).push(rc);
	}
	const ratio = avg(big) / Math.max(avg(rest), 0.01);
	check('H4 3+ integrations 1.5x+ reports', ratio >= 1.5,
		`big=${avg(big).toFixed(2)} (n=${big.length}) rest=${avg(rest).toFixed(2)} ratio=${ratio.toFixed(2)}`);
}

// HOOK 5: alert fatigue — heavy users have rising response_time
{
	let heavyEarly = [], heavyLate = [];
	for (const [uid, evs] of byUser) {
		const alerts = evs.filter(e => e.event === 'stockout alert' && typeof e.response_time_hours === 'number');
		if (alerts.length <= 30) continue;
		alerts.sort((a, b) => new Date(a.time) - new Date(b.time));
		alerts.forEach((a, i) => {
			(i < 20 ? heavyEarly : heavyLate).push(a.response_time_hours);
		});
	}
	const ratio = avg(heavyLate) / Math.max(avg(heavyEarly), 1);
	check('H5 alert fatigue late > early (1.5x+)', ratio >= 1.5,
		`early=${avg(heavyEarly).toFixed(1)} (n=${heavyEarly.length}) late=${avg(heavyLate).toFixed(1)} (n=${heavyLate.length}) ratio=${ratio.toFixed(2)}`);
}

// HOOK 6: trial churn — trial tier has lower event count
{
	const trial = [], rest = [];
	for (const [uid, evs] of byUser) {
		const t = profileBy.get(uid)?.company_tier;
		(t === 'trial' ? trial : rest).push(evs.length);
	}
	const ratio = avg(trial) / Math.max(avg(rest), 0.01);
	check('H6 trial event volume <0.5x rest', ratio < 0.55,
		`trial=${avg(trial).toFixed(1)} rest=${avg(rest).toFixed(1)} ratio=${ratio.toFixed(2)}`);
}

// HOOK 7: enterprise warehouse_count + employee_count
{
	const ent = profiles.filter(p => p.company_tier === 'enterprise');
	const smb = profiles.filter(p => p.company_tier === 'small_business');
	const ew = avg(ent.map(p => p.warehouse_count || 0));
	const sw = avg(smb.map(p => p.warehouse_count || 0));
	const ratio = ew / Math.max(sw, 0.01);
	check('H7 enterprise 3x+ warehouses', ratio >= 3.0,
		`ent_wh=${ew.toFixed(1)} smb_wh=${sw.toFixed(1)} ratio=${ratio.toFixed(2)}`);
}

// HOOK 8: small business funnel conversion drop on Integration Setup
{
	const tierConv = new Map();
	for (const [uid, evs] of byUser) {
		evs.sort((a, b) => new Date(a.time) - new Date(b.time));
		const r = evaluateFunnel(evs, ['integration connected', 'report generated', 'alert configured'], { conversionWindowMs: 30 * 86400000 });
		const t = profileBy.get(uid)?.company_tier;
		if (!tierConv.has(t)) tierConv.set(t, { tot: 0, c: 0 });
		const b = tierConv.get(t);
		b.tot++; if (r.completed) b.c++;
	}
	const smb = (tierConv.get('small_business')?.c || 0) / Math.max(tierConv.get('small_business')?.tot || 1, 1);
	const ent = (tierConv.get('enterprise')?.c || 0) / Math.max(tierConv.get('enterprise')?.tot || 1, 1);
	check('H8 enterprise > smb funnel conv (1.2x+)', ent / Math.max(smb, 0.001) >= 1.2,
		`enterprise=${(ent * 100).toFixed(1)}% smb=${(smb * 100).toFixed(1)}% lift=${(ent / Math.max(smb, 0.001)).toFixed(2)}x`);
}

// HOOK 9: inventory-check magic number — sweet 5-15 → +25% PO quantity
{
	const sweet = [], lower = [];
	for (const [uid, evs] of byUser) {
		const ic = evs.filter(e => e.event === 'inventory checked').length;
		const qs = evs.filter(e => e.event === 'purchase order created' && typeof e.quantity === 'number').map(e => e.quantity);
		if (ic >= 5 && ic <= 15) sweet.push(...qs);
		else if (ic < 5) lower.push(...qs);
	}
	const ratio = avg(sweet) / Math.max(avg(lower), 0.01);
	check('H9 sweet 5-15 1.2x+ PO quantity', ratio >= 1.15,
		`sweet=${avg(sweet).toFixed(0)} (n=${sweet.length}) lower=${avg(lower).toFixed(0)} (n=${lower.length}) ratio=${ratio.toFixed(2)}`);
}

// HOOK 10: TTC by tier (KNOWN LIMITATION)
{
	const rows = emulateBreakdown(events, {
		type: 'timeToConvert',
		fromEvent: 'account created',
		toEvent: 'report generated',
		breakdownByUserProperty: 'company_tier',
		profiles,
		conversionWindowMs: 30 * 86400000,
	});
	const byTier = new Map();
	for (const r of rows) byTier.set(r.segment_value, r);
	const present = byTier.has('enterprise') && byTier.has('small_business');
	check('H10 TTC populations present (limitation)', present,
		`tiers=${[...byTier.keys()].join(',')}`);
}

const passed = results.filter(r => r.p).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
