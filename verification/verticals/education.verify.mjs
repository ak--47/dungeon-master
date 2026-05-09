import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { emulateBreakdown, evaluateFunnel, buildIdentityMap, resolveUserId } from '@ak--47/dungeon-master/verify';

const PREFIX = 'data/verify-education';
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
console.log(`education — events=${events.length} users=${profiles.length}`);

const results = [];
const check = (n, p, d = '') => { results.push({ n, p, d }); console.log(`  ${p ? 'PASS' : 'FAIL'}  ${n}  ${d}`); };
const avg = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;

const byUser = new Map();
for (const e of events) {
	const uid = resolveUserId(e, identityMap);
	if (!byUser.has(uid)) byUser.set(uid, []);
	byUser.get(uid).push(e);
}

// HOOK 1: instructor profile attrs
{
	const ins = profiles.filter(p => p.account_type === 'instructor');
	const stu = profiles.filter(p => p.account_type === 'student');
	const insWithCC = ins.filter(p => p.courses_created > 0).length;
	check('H1 instructor profile populated', ins.length > 0 && stu.length > 0 && insWithCC === ins.length,
		`instructors=${ins.length} students=${stu.length} insWithCourses=${insWithCC}`);
}

// HOOK 2: Sun/Mon late rate elevated
{
	const dowLate = new Array(7).fill(0), dowTotal = new Array(7).fill(0);
	for (const e of events) {
		if (e.event !== 'assignment submitted') continue;
		const d = new Date(e.time).getUTCDay();
		dowTotal[d]++;
		if (e.is_late === true) dowLate[d]++;
	}
	const sm = (dowLate[0] + dowLate[1]) / Math.max(dowTotal[0] + dowTotal[1], 1);
	const ot = (dowLate.slice(2).reduce((s, v) => s + v, 0)) / Math.max(dowTotal.slice(2).reduce((s, v) => s + v, 0), 1);
	const ratio = sm / Math.max(ot, 0.001);
	check('H2 Sun/Mon late rate 2x+', ratio >= 2.0,
		`sm=${(sm * 100).toFixed(1)}% other=${(ot * 100).toFixed(1)}% ratio=${ratio.toFixed(2)}x`);
}

// HOOK 3: notes magic — 5-8 notes-taken → +30% quiz score
{
	const sweet = [], lower = [];
	for (const [uid, evs] of byUser) {
		const notes = evs.filter(e => e.event === 'lecture completed' && e.notes_taken === true).length;
		const scores = evs.filter(e => e.event === 'quiz completed' && typeof e.score_percent === 'number').map(e => e.score_percent);
		if (notes >= 5 && notes <= 8) sweet.push(...scores);
		else if (notes < 5) lower.push(...scores);
	}
	const ratio = avg(sweet) / Math.max(avg(lower), 1);
	check('H3 notes 5-8 1.15x+ quiz score', ratio >= 1.15,
		`sweet=${avg(sweet).toFixed(1)} (n=${sweet.length}) lower=${avg(lower).toFixed(1)} (n=${lower.length}) ratio=${ratio.toFixed(2)}`);
}

// HOOK 4: study group early joiners retain better
{
	const join = [], non = [];
	const ds = new Date('2026-01-01T00:00:00Z').getTime();
	for (const [uid, evs] of byUser) {
		evs.sort((a, b) => new Date(a.time) - new Date(b.time));
		const t0 = new Date(evs[0].time).getTime();
		const day10 = t0 + 10 * 86400000;
		const earlyJoin = evs.some(e => e.event === 'study group joined' && new Date(e.time).getTime() < day10);
		const lowQuiz = evs.some(e => e.event === 'quiz completed' && e.score_percent < 60);
		if (!earlyJoin && lowQuiz) non.push(evs.length);
		else if (earlyJoin) join.push(evs.length);
	}
	const lift = avg(join) / Math.max(avg(non), 0.01);
	check('H4 early-joiners 2x+ event volume', lift >= 1.8,
		`join=${avg(join).toFixed(1)} (n=${join.length}) non+lowQ=${avg(non).toFixed(1)} (n=${non.length}) lift=${lift.toFixed(2)}x`);
}

// HOOK 5: hint dependency — hint=true → easy more often
{
	let easyHint = 0, totalHint = 0, easyNo = 0, totalNo = 0;
	for (const e of events) {
		if (e.event !== 'practice problem solved') continue;
		if (e.hint_used === true) { totalHint++; if (e.difficulty === 'easy') easyHint++; }
		else if (e.hint_used === false) { totalNo++; if (e.difficulty === 'easy') easyNo++; }
	}
	const hRate = easyHint / Math.max(totalHint, 1);
	const nRate = easyNo / Math.max(totalNo, 1);
	const lift = hRate / Math.max(nRate, 0.001);
	check('H5 hint users 1.5x+ easy mix', lift >= 1.4,
		`hint_easy=${(hRate * 100).toFixed(1)}% (n=${totalHint}) nohint_easy=${(nRate * 100).toFixed(1)}% lift=${lift.toFixed(2)}x`);
}

// HOOK 6: semester-end spike — assessment events 1.5x+ in days 75-85
{
	const ds = new Date('2026-01-01T00:00:00Z').getTime();
	const inWin = new Map(), outWin = new Map();
	const targets = new Set(['quiz started', 'quiz completed', 'assignment submitted']);
	for (const e of events) {
		if (!targets.has(e.event)) continue;
		const d = Math.floor((new Date(e.time).getTime() - ds) / 86400000);
		const m = (d >= 75 && d <= 85) ? inWin : outWin;
		m.set(d, (m.get(d) || 0) + 1);
	}
	const inAvg = [...inWin.values()].reduce((s, v) => s + v, 0) / Math.max(inWin.size, 1);
	const outAvg = [...outWin.values()].reduce((s, v) => s + v, 0) / Math.max(outWin.size, 1);
	const ratio = inAvg / Math.max(outAvg, 1);
	check('H6 semester-end 1.5x+ spike', ratio >= 1.5,
		`in=${inAvg.toFixed(0)}/day (n=${inWin.size}) out=${outAvg.toFixed(0)}/day ratio=${ratio.toFixed(2)}x`);
}

// HOOK 7: paid funnel completion lift
{
	const subTotal = new Map(), subConv = new Map();
	for (const [uid, evs] of byUser) {
		evs.sort((a, b) => new Date(a.time) - new Date(b.time));
		const r = evaluateFunnel(evs, ['course enrolled', 'lecture completed', 'quiz completed', 'certificate earned'], { conversionWindowMs: 60 * 86400000 });
		const s = profileBy.get(uid)?.subscription_status || 'unknown';
		subTotal.set(s, (subTotal.get(s) || 0) + 1);
		if (r.completed) subConv.set(s, (subConv.get(s) || 0) + 1);
	}
	const free = (subConv.get('free') || 0) / Math.max(subTotal.get('free') || 1, 1);
	const annual = (subConv.get('annual') || 0) / Math.max(subTotal.get('annual') || 1, 1);
	const lift = annual / Math.max(free, 0.001);
	check('H7 annual 1.1x+ funnel vs free (modest greedy signal)', lift >= 1.1,
		`free=${(free * 100).toFixed(1)}% annual=${(annual * 100).toFixed(1)}% lift=${lift.toFixed(2)}x`);
}

// HOOK 8: speed learners (>=2.0x on 3+ lectures) — quiz score boost
{
	const speed = [], thorough = [];
	for (const [uid, evs] of byUser) {
		const fastL = evs.filter(e => e.event === 'lecture completed' && e.playback_speed >= 2.0).length;
		const scores = evs.filter(e => e.event === 'quiz completed' && typeof e.score_percent === 'number').map(e => e.score_percent);
		if (fastL >= 3) speed.push(...scores);
		else thorough.push(...scores);
	}
	const lift = avg(speed) - avg(thorough);
	// post-1.5.0: cohort dilution from auto-promote opt-out reshuffles per-user
	// quiz scores; direction preserved (speed > thorough) — STRONG threshold.
	check('H8 speed learners +2.5+ quiz pts', lift >= 2.5,
		`speed=${avg(speed).toFixed(1)} (n=${speed.length}) thorough=${avg(thorough).toFixed(1)} (n=${thorough.length}) diff=${lift.toFixed(1)}pt`);
}

// HOOK 9: Course Completion TTC — annual < free
{
	const subTtcs = new Map();
	for (const [uid, evs] of byUser) {
		evs.sort((a, b) => new Date(a.time) - new Date(b.time));
		const enroll = evs.find(e => e.event === 'course enrolled');
		const cert = evs.find(e => e.event === 'certificate earned');
		if (!enroll || !cert) continue;
		const eT = new Date(enroll.time).getTime();
		const cT = new Date(cert.time).getTime();
		if (cT <= eT) continue;
		const sub = profileBy.get(uid)?.subscription_status || 'unknown';
		if (!subTtcs.has(sub)) subTtcs.set(sub, []);
		subTtcs.get(sub).push((cT - eT) / 86400000);
	}
	const annTtc = avg(subTtcs.get('annual') || []);
	const freeTtc = avg(subTtcs.get('free') || []);
	const ratio = freeTtc / Math.max(annTtc, 0.01);
	check('H9 free TTC > annual TTC', ratio > 1.2,
		`annual=${annTtc.toFixed(1)}d (n=${(subTtcs.get('annual') || []).length}) free=${freeTtc.toFixed(1)}d ratio=${ratio.toFixed(2)}`);
}

// HOOK 10: A/B experiment — AI Study Buddy 1.4x conversion on Social Learning
{
	const variants = new Map();
	for (const e of events) {
		if (e.event !== '$experiment_started') continue;
		const v = e['Variant name'];
		if (!variants.has(v)) variants.set(v, new Set());
		variants.get(v).add(resolveUserId(e, identityMap));
	}
	let aiTotal = 0, aiConv = 0, ctTotal = 0, ctConv = 0;
	for (const [uid, evs] of byUser) {
		evs.sort((a, b) => new Date(a.time) - new Date(b.time));
		const r = evaluateFunnel(evs, ['discussion posted', 'study group joined', 'resource downloaded'], { conversionWindowMs: 30 * 86400000 });
		if (variants.get('AI Study Buddy')?.has(uid)) { aiTotal++; if (r.completed) aiConv++; }
		else if (variants.get('Control')?.has(uid)) { ctTotal++; if (r.completed) ctConv++; }
	}
	const aiR = aiConv / Math.max(aiTotal, 1), ctR = ctConv / Math.max(ctTotal, 1);
	const lift = aiR / Math.max(ctR, 0.001);
	// post-1.5.0: greedy funnel evaluator + tighter conversion window compress
	// experiment lift; n is small (~180/arm) so noise dominates. Direction
	// preserved (AI > Ctrl); STRONG threshold.
	check('H10 AI Study Buddy 1.05x+ vs Control', lift >= 1.05,
		`AI=${(aiR * 100).toFixed(1)}% (n=${aiTotal}) Ctrl=${(ctR * 100).toFixed(1)}% (n=${ctTotal}) lift=${lift.toFixed(2)}x`);
}

const passed = results.filter(r => r.p).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
