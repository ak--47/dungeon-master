import { spawn } from 'node:child_process';
import { writeFileSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const POLICY = '(version 1) (allow default) (deny network*)';
export const SEEDS = ['alignment-generated-17', 'alignment-generated-43', 'alignment-generated-89'];
export const FOCUS = ['conditions', 'persona-conversion', 'persona-ttc', 'persona-volume', 'experiment', 'hook-ttc', 'retention'];
export const MEMORY = { heapMiB: 512, rssMiB: 900, maxRequestedEvents: 300000 };

export function wilson(successes, users) {
  if (!Number.isInteger(users) || users < 1 || !Number.isInteger(successes) || successes < 0 || successes > users) return null;
  const squared = 1.959963984540054 ** 2;
  const rate = successes / users;
  const divisor = 1 + squared / users;
  const center = (rate + squared / (2 * users)) / divisor;
  const radius = Math.sqrt(rate * (1 - rate) / users + squared / (4 * users ** 2)) * Math.sqrt(squared) / divisor;
  return [Math.max(0, center - radius), Math.min(1, center + radius)];
}

export function classify({ effect, neutral, effectBand, neutralBand, users, minimum, nullValue = 0, contractErrors = [] }) {
  if (contractErrors.length) return 'contractfail';
  if (users < minimum || !Number.isFinite(effect) || !Number.isFinite(neutral)) return 'insufficient-evidence';
  const direction = Math.sign(effectBand[0] - nullValue);
  if ((effect - nullValue) * direction < 0) return 'inverse';
  if (neutral < neutralBand[0] || neutral > neutralBand[1]) return 'contractfail';
  if (effect >= effectBand[0] && effect <= effectBand[1]) return 'supported';
  return (direction > 0 && effect < effectBand[0]) || (direction < 0 && effect > effectBand[1]) ? 'diluted' : 'contractfail';
}

export function killGroup(child) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, 'SIGKILL'); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}

export function runCell(cell, { deadline, onChild = () => {}, onStarted = () => {}, probeHang = false } = {}) {
  if (process.platform !== 'darwin') throw new Error('Sweep requires macOS sandbox-exec; no unsandboxed fallback.');
  return new Promise((resolve) => {
    const started = performance.now();
    const child = spawn('/usr/bin/sandbox-exec', ['-p', POLICY, process.execPath,
      `--max-old-space-size=${MEMORY.heapMiB}`, '--expose-gc', fileURLToPath(new URL('./sweep-worker.mjs', import.meta.url))], {
      cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, NODE_OPTIONS: '', VSCODE_INSPECTOR_OPTIONS: '', NODE_ENV: 'test', TZ: 'UTC' },
    });
    onChild(child);
    let result;
    let reason;
    let stderr = '';
    const stop = label => { reason = label; killGroup(child); };
    const timer = setTimeout(() => stop('deadline'), Math.max(1, deadline - Date.now()));
    child.stdout.resume();
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
    child.on('message', message => {
      if (message.type === 'started') onStarted({ pid: child.pid, ...message });
      if (message.type === 'result') result = message.result;
    });
    child.once('spawn', () => child.send({ cell, probeHang, deadline }));
    child.once('error', error => { reason = error.message; });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      killGroup(child);
      onChild(undefined);
      resolve({ ...cell, ...result, elapsedMs: Math.round(performance.now() - started),
        execution: reason ?? (stderr.includes('memory-limit') ? 'memory-limit' : code === 0 && result ? 'complete' : 'worker-failure'),
        ...(reason || code !== 0 || !result ? { error: stderr, exitCode: code, signal } : {}) });
    });
  });
}

export function candidateGroups() {
  const strata = [10000, 100, 1000, 3000, 300].flatMap(users => ['dense', 'sparse'].map(traffic => ({ users, traffic, targetPercent: 50 })));
  strata.push(...[5, 95].flatMap(targetPercent => ['sparse', 'dense'].map(traffic => ({ users: 1000, traffic, targetPercent }))));
  const groups = strata.flatMap(stratum => FOCUS.map(id => ({ id, ...stratum })));
  const priority = group => group.users === 1000 && group.targetPercent === 50 ? 0 : group.id === 'conditions' ? 1 : 2;
  return groups.sort((left, right) => priority(left) - priority(right));
}

export function coverageAudit(cells) {
  const complete = cells.filter(row => row.execution === 'complete');
  const hasGroup = predicate => new Set(complete.filter(predicate).map(row => row.seed)).size === SEEDS.length;
  const missing = [];
  for (const users of [100, 300, 1000, 3000, 10000]) {
    if (!hasGroup(row => row.users === users)) missing.push(`size:${users}`);
  }
  for (const id of FOCUS) for (const traffic of ['sparse', 'dense']) {
    if (!hasGroup(row => row.id === id && row.traffic === traffic && row.users >= 1000 && row.targetPercent === 50)) missing.push(`focus:${id}/${traffic}/users>=1000`);
  }
  for (const targetPercent of [5, 95]) {
    if (!hasGroup(row => row.targetPercent === targetPercent)) missing.push(`rarity:${targetPercent}`);
  }
  return { complete: missing.length === 0, missing };
}

export function estimateGroup(group, pilots) {
  const matching = pilots.filter(row => row.id === group.id && row.execution === 'complete');
  const baseline = Math.max(500, ...matching.map(row => row.elapsedMs));
  const scale = group.users / 300 * (group.traffic === 'dense' ? 3 : 1);
  return Math.ceil(3 * (300 + baseline * Math.max(1, scale) * 1.5));
}

export function seedSpreads(rows) {
  const groups = new Map();
  for (const row of rows.filter(row => row.execution === 'complete')) {
    const key = [row.id, row.users, row.traffic, row.targetPercent].join('/');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups].map(([key, observations]) => {
    const spread = metric => {
      const values = observations.map(row => row.metrics?.[metric]?.effect).filter(Number.isFinite);
      return values.length ? { min: Math.min(...values), max: Math.max(...values), mean: values.reduce((sum, value) => sum + value, 0) / values.length } : null;
    };
    return { key, seeds: observations.length, effect: spread('primary'), ttc: spread('ttc'),
      verdicts: observations.map(row => row.verdict) };
  });
}

export function writeReport(report, output) {
  const completeRows = report.cells.filter(row => row.execution === 'complete');
  report.summary = { cells: report.cells.length, completedCells: completeRows.length,
    dungeons: completeRows.reduce((sum, row) => sum + row.samples.length, 0),
    events: completeRows.reduce((sum, row) => sum + row.samples.reduce((total, sample) => total + sample.events, 0), 0),
    largestSingleDungeonEvents: Math.max(0, ...completeRows.flatMap(row => row.samples.map(sample => sample.events))),
    verdicts: Object.fromEntries(['supported', 'insufficient-evidence', 'diluted', 'inverse', 'contractfail'].map(label => [label, completeRows.filter(row => row.verdict === label).length])) };
  report.spreads = seedSpreads(completeRows);
  const body = JSON.stringify(report, (_key, value) => typeof value === 'number' && !Number.isFinite(value) ? null : value) + '\n';
  writeFileSync(`${output}.json.tmp`, body);
  renameSync(`${output}.json.tmp`, `${output}.json`);
  const lines = ['# bounded alignment sweep', '',
    `status: **${report.status}**. elapsed: ${report.elapsedMs ?? 0}ms. deadline: ${report.budgetMs}ms (includes build and preflight).`, '',
    `completed cells: ${report.summary.completedCells}/${report.scheduledCells ?? 0}. dungeons: ${report.summary.dungeons}. events: ${report.summary.events}. largest single dungeon: ${report.summary.largestSingleDungeonEvents} events.`, '',
    `verdict counts: ${JSON.stringify(report.summary.verdicts)}. deferred groups: ${report.deferred?.length ?? 0}.`, '',
    `required coverage missing: ${report.coverage?.missing?.join(', ') || 'none recorded'}.`, '',
    'event totals across cells do not establish single-dungeon capacity. intervals use unique users, never event totals. seed spreads are descriptive across three fixed seeds, not population confidence intervals.', '',
    'a completed schedule can contain diagnostic failures. insufficient evidence is expected at small N. diluted and inverse effects stay visible. contractfail includes strict band misses and broken count invariants. unsupported-envelope labels do not change thresholds.', '',
    'no universal upper-cliff claim is supported. inspect each tested size and its labels below. memory is bounded by one worker, a 512 MiB V8 heap cap, a 900 MiB sampled RSS kill threshold, and a 300,000 requested-event cap. sampled RSS can overshoot between polls.', '',
    '| scenario/users/traffic/target% | seeds | effect min | effect mean | effect max | verdicts |',
    '| --- | ---: | ---: | ---: | ---: | --- |',
    ...report.spreads.map(row => `| ${row.key} | ${row.seeds} | ${row.effect?.min?.toFixed(4) ?? 'n/a'} | ${row.effect?.mean?.toFixed(4) ?? 'n/a'} | ${row.effect?.max?.toFixed(4) ?? 'n/a'} | ${row.verdicts.join(', ')} |`)];
  if (report.failure) lines.push('', `failure: ${report.failure}`);
  writeFileSync(`${output}.md.tmp`, lines.join('\n') + '\n');
  renameSync(`${output}.md.tmp`, `${output}.md`);
}

export async function runSweep(report, { deadline, onChild, output, probeHang = false }) {
  const persist = () => writeReport(report, output);
  const execute = async cell => {
    report.active = cell;
    persist();
    const result = await runCell(cell, { deadline, onChild, probeHang, onStarted: message => {
      report.active = { ...cell, ...message };
      persist();
      console.log(`Sweep worker started: ${message.pid}${message.descendantPid ? ` descendant=${message.descendantPid}` : ''}`);
    } });
    report.cells.push(result);
    delete report.active;
    persist();
    console.log(`Sweep ${cell.id}/${cell.users}/${cell.traffic}/${cell.targetPercent}/${cell.seed}: ${result.execution} ${result.verdict ?? ''} ${result.elapsedMs}ms`);
    return result.execution === 'complete';
  };
  report.phase = 'pilot';
  const pilots = FOCUS.flatMap(id => SEEDS.map(seed => ({ id, users: 300, traffic: 'sparse', targetPercent: 50, seed, pilot: true })));
  report.scheduledCells = pilots.length;
  for (const cell of pilots) if (!await execute(cell)) return false;
  report.phase = 'sweep';
  report.deferred = [];
  const scheduled = [];
  let available = deadline - Date.now() - 5000;
  for (const group of candidateGroups()) {
    if (group.users === 300 && group.traffic === 'sparse') continue;
    const estimatedMs = estimateGroup(group, report.cells);
    if (estimatedMs > available) report.deferred.push({ ...group, estimatedMs, reason: 'pilot-budget' });
    else {
      available -= estimatedMs;
      scheduled.push(...SEEDS.map(seed => ({ ...group, seed, estimatedGroupMs: estimatedMs })));
    }
  }
  report.scheduledCells += scheduled.length;
  report.schedule = scheduled;
  persist();
  for (const cell of scheduled) if (!await execute(cell)) return false;
  report.coverage = coverageAudit(report.cells);
  report.coverageComplete = report.coverage.complete;
  return true;
}