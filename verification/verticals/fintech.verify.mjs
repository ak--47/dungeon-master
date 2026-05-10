import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { emulateBreakdown, evaluateFunnel, buildIdentityMap, resolveUserId } from '@ak--47/dungeon-master/verify';

const PREFIX = 'data/verify-fintech';
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
console.log(`fintech — events=${events.length} users=${profiles.length}`);

const results = [];
const check = (n, p, d = '') => { results.push({ n, p, d }); console.log(`  ${p ? 'PASS' : 'FAIL'}  ${n}  ${d}`); };
const avg = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;

const byUser = new Map();
for (const e of events) {
	const uid = resolveUserId(e, identityMap);
	if (!byUser.has(uid)) byUser.set(uid, []);
	byUser.get(uid).push(e);
}

// HOOK 1: business segment txn 4x larger
{
	const seg = (uid) => profileBy.get(uid)?.account_segment;
	const biz = [], pers = [];
	for (const e of events) {
		if (e.event !== 'transaction completed' || typeof e.amount !== 'number') continue;
		const s = seg(resolveUserId(e, identityMap));
		if (s === 'business') biz.push(e.amount);
		else if (s === 'personal') pers.push(e.amount);
	}
	const ratio = avg(biz) / Math.max(avg(pers), 1);
	check('H1 business 2x+ txn amount', ratio >= 2.0,
		`biz=${avg(biz).toFixed(0)} pers=${avg(pers).toFixed(0)} ratio=${ratio.toFixed(2)}x`);
}

// HOOK 2: payday — 1st/15th direct_deposit 3x
{
	const payday = [], normal = [];
	for (const e of events) {
		if (e.event !== 'transaction completed' || e.transaction_type !== 'direct_deposit' || typeof e.amount !== 'number') continue;
		const dom = new Date(e.time).getUTCDate();
		((dom === 1 || dom === 15) ? payday : normal).push(e.amount);
	}
	const ratio = avg(payday) / Math.max(avg(normal), 1);
	check('H2 payday direct_deposit 2x+', ratio >= 2.0,
		`payday=${avg(payday).toFixed(0)} (n=${payday.length}) normal=${avg(normal).toFixed(0)} (n=${normal.length}) ratio=${ratio.toFixed(2)}x`);
}

// HOOK 3: fraud cohort exists (card locked + dispute filed within 1h)
{
	let fraudUsers = 0;
	for (const [uid, evs] of byUser) {
		evs.sort((a, b) => new Date(a.time) - new Date(b.time));
		const cardLock = evs.filter(e => e.event === 'card locked' && e.reason === 'suspicious_activity');
		const dispute = evs.filter(e => e.event === 'dispute filed' && e.reason === 'unauthorized');
		if (cardLock.length === 0 || dispute.length === 0) continue;
		// within 1 hour of each other
		for (const c of cardLock) {
			const cT = new Date(c.time).getTime();
			if (dispute.some(d => Math.abs(new Date(d.time).getTime() - cT) < 3600000)) {
				fraudUsers++;
				break;
			}
		}
	}
	const pct = fraudUsers / profiles.length;
	check('H3 fraud cohort 0.5%-15%', pct >= 0.005 && pct <= 0.15,
		`fraud_users=${fraudUsers} (${(pct * 100).toFixed(2)}%)`);
}

// HOOK 4: low balance churn — chronic-low users have suppressed POST/PRE event ratio
// (per-user post30/pre30 ratio comparison, not absolute volume — low-balance users
// naturally have many more balance-check events overall)
{
	const ds = new Date('2026-01-01T00:00:00Z').getTime();
	const day30 = ds + 30 * 86400000;
	const lowR = [], highR = [];
	for (const [uid, evs] of byUser) {
		const lowChecks = evs.filter(e => e.event === 'balance checked' && (e.account_balance || 0) < 15000).length;
		const pre30 = evs.filter(e => new Date(e.time).getTime() <= day30).length;
		const post30 = evs.filter(e => new Date(e.time).getTime() > day30).length;
		if (pre30 === 0) continue;
		const r = post30 / pre30;
		(lowChecks >= 3 ? lowR : highR).push(r);
	}
	const ratio = avg(lowR) / Math.max(avg(highR), 0.01);
	check('H4 low-balance post30/pre30 ratio < 0.90x high', ratio < 0.90,
		`low_post/pre=${avg(lowR).toFixed(2)} (n=${lowR.length}) high_post/pre=${avg(highR).toFixed(2)} ratio=${ratio.toFixed(2)}x`);
}

// HOOK 5: budget creators save more
{
	const bud = [], non = [];
	for (const [uid, evs] of byUser) {
		const hasBudget = evs.some(e => e.event === 'budget created');
		const sgs = evs.filter(e => e.event === 'savings goal set' && typeof e.monthly_contribution === 'number').map(e => e.monthly_contribution);
		(hasBudget ? bud : non).push(...sgs);
	}
	const ratio = avg(bud) / Math.max(avg(non), 1);
	check('H5 budget users 1.15x+ savings (cloning dilutes)', ratio >= 1.15,
		`bud=${avg(bud).toFixed(0)} (n=${bud.length}) non=${avg(non).toFixed(0)} (n=${non.length}) ratio=${ratio.toFixed(2)}x`);
}

// HOOK 6: auto-pay loyalty
{
	const auto = events.filter(e => e.event === 'bill paid' && e.auto_pay === true).length;
	const manual = events.filter(e => e.event === 'bill paid' && e.auto_pay === false).length;
	const missed = events.filter(e => e.event === 'bill payment missed').length;
	const missedRate = missed / Math.max(missed + manual, 1);
	check('H6 manual payers 20%+ miss rate', missedRate >= 0.20,
		`auto=${auto} manual_paid=${manual} missed=${missed} miss_rate=${(missedRate * 100).toFixed(1)}%`);
}

// HOOK 7: premium 3x reward
{
	const tier = (uid) => profileBy.get(uid)?.account_tier;
	const tierRewards = { basic: [], plus: [], premium: [] };
	for (const e of events) {
		if (e.event !== 'reward redeemed' || typeof e.value !== 'number') continue;
		const t = tier(resolveUserId(e, identityMap));
		if (tierRewards[t]) tierRewards[t].push(e.value);
	}
	const b = avg(tierRewards.basic), pr = avg(tierRewards.premium);
	const ratio = pr / Math.max(b, 1);
	check('H7 premium 2x+ reward value vs basic', ratio >= 2.0,
		`basic=${b.toFixed(1)} premium=${pr.toFixed(1)} ratio=${ratio.toFixed(2)}x`);
}

// HOOK 8: month-end anxiety — d28+ session 1.4x and balance 0.7x
{
	const me = [], norm = [];
	const meBal = [], normBal = [];
	for (const e of events) {
		const dom = new Date(e.time).getUTCDate();
		const isMe = dom >= 28;
		if (e.event === 'app session' && typeof e.session_duration_sec === 'number') {
			(isMe ? me : norm).push(e.session_duration_sec);
		}
		if (e.event === 'balance checked' && typeof e.account_balance === 'number') {
			(isMe ? meBal : normBal).push(e.account_balance);
		}
	}
	const sessionRatio = avg(me) / Math.max(avg(norm), 1);
	check('H8 month-end session 1.2x+', sessionRatio >= 1.2,
		`me=${avg(me).toFixed(0)}s norm=${avg(norm).toFixed(0)}s ratio=${sessionRatio.toFixed(2)}x`);
	const balRatio = avg(meBal) / Math.max(avg(normBal), 1);
	check('H8b month-end balance < 0.85x', balRatio < 0.85,
		`me=${avg(meBal).toFixed(0)} norm=${avg(normBal).toFixed(0)} ratio=${balRatio.toFixed(2)}x`);
}

// HOOK 9: TTC by tier (Onboarding) — premium < basic
{
	const tier = (uid) => profileBy.get(uid)?.account_tier;
	const ttcs = { premium: [], plus: [], basic: [] };
	for (const [uid, evs] of byUser) {
		evs.sort((a, b) => new Date(a.time) - new Date(b.time));
		const opened = evs.find(e => e.event === 'account opened');
		const checked = evs.find(e => e.event === 'balance checked' && new Date(e.time) > new Date(opened?.time || 0));
		if (!opened || !checked) continue;
		const ttcMs = new Date(checked.time) - new Date(opened.time);
		const t = tier(uid);
		if (ttcs[t]) ttcs[t].push(ttcMs);
	}
	const pr = avg(ttcs.premium) / 60000, ba = avg(ttcs.basic) / 60000;
	check('H9 premium TTC < basic TTC', pr < ba,
		`premium=${pr.toFixed(0)}m (n=${ttcs.premium.length}) basic=${ba.toFixed(0)}m (n=${ttcs.basic.length})`);
}

// HOOK 10: txn-count magic — sweet 6-10 → +40% investment amount
{
	const sweet = [], lower = [];
	for (const [uid, evs] of byUser) {
		const tc = evs.filter(e => e.event === 'transaction completed').length;
		const inv = evs.filter(e => e.event === 'investment made' && typeof e.amount === 'number').map(e => e.amount);
		if (tc >= 6 && tc <= 10) sweet.push(...inv);
		else if (tc < 6) lower.push(...inv);
	}
	const ratio = avg(sweet) / Math.max(avg(lower), 1);
	check('H10 sweet 6-10 1.2x+ investment amount', ratio >= 1.2,
		`sweet=${avg(sweet).toFixed(0)} (n=${sweet.length}) lower=${avg(lower).toFixed(0)} (n=${lower.length}) ratio=${ratio.toFixed(2)}x`);
}

const passed = results.filter(r => r.p).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
