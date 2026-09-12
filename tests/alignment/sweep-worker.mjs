import { spawn } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { scenarioConfig, measureScenario, SCENARIOS } from './scenarios.mjs';
import { runFixture } from './fixtures.mjs';
import { validateDungeonConfig } from '../../lib/core/config-validator.js';
import { initChance, resetValueCaches } from '../../lib/utils/utils.js';
import { classify, wilson, MEMORY } from './sweep.mjs';

export function cellConfig(cell, treatment) {
  const config = scenarioConfig(cell.id, cell.seed, cell.traffic === 'dense' ? 'dense' : 'mixed', treatment);
  config.numUsers = cell.users;
  config.avgEventsPerUserPerDay = cell.traffic === 'dense' ? 0.9 : 0.3;
  config.numEvents = Math.round(cell.users * config.numDays * config.avgEventsPerUserPerDay);
  if (config.numEvents > MEMORY.maxRequestedEvents) throw new Error('Requested events exceed worker envelope');
  config.userProps.segment = { __weights: { target: cell.targetPercent, control: 100 - cell.targetPercent } };
  for (const persona of config.personas ?? []) persona.weight = persona.name === 'target' ? cell.targetPercent : 100 - cell.targetPercent;
  for (const funnel of config.funnels) for (const variant of funnel.experiment?.variants ?? []) variant.weight = variant.name === 'target' ? cell.targetPercent : 100 - cell.targetPercent;
  config.credentials = { token: '', serviceAccount: '', serviceSecret: '', projectId: '' };
  config.writeToDisk = false;
  config.concurrency = 1;
  return config;
}

export function compactConfig(config) {
  const keys = ['seed', 'numUsers', 'numEvents', 'numDays', 'datasetStart', 'datasetEnd', 'avgEventsPerUserPerDay', 'percentUsersBornInDataset', 'bornRecentBias', 'concurrency', 'autoPowerLaw', 'retentionCurve', 'macro'];
  return { ...Object.fromEntries(keys.filter(key => config[key] !== undefined).map(key => [key, config[key]])),
    segment: config.userProps?.segment,
    personas: config.personas?.map(({ name, weight, conversionModifier, ttcModifier, eventMultiplier }) => ({ name, weight, conversionModifier, ttcModifier, eventMultiplier })),
    funnels: config.funnels.map(({ name, conversionRate, timeToConvert, conditions, experiment }) => ({ name, conversionRate, timeToConvert, conditions, experiment })),
    hook: typeof config.hook === 'function' };
}

async function sampleCell(cell, treatment) {
  const config = cellConfig(cell, treatment);
  const requested = compactConfig(config);
  resetValueCaches();
  initChance(config.seed);
  const resolved = compactConfig(validateDungeonConfig(cellConfig(cell, treatment)));
  const started = performance.now();
  const sample = await runFixture(config);
  const generationMs = performance.now() - started;
  const measured = measureScenario(cell.id, sample);
  const countErrors = [];
  for (const group of ['target', 'control']) {
    const counts = measured[group];
    if (counts.converted > counts.entrants || counts.entrants > measured[`${group}Users`]) countErrors.push(`${group}: unique counts violated`);
  }
  if (sample.profiles.length !== cell.users) countErrors.push('profile count differs from requested users');
  if (sample.events.some(event => !event.user_id || !Number.isFinite(Date.parse(event.time)))) countErrors.push('invalid event identity/time');
  if (measured.retention.returned > measured.retention.entrants) countErrors.push('retention count invariant');
  const counts = group => ({ ...measured[group], interval95: wilson(measured[group].converted, measured[group].entrants) });
  return { treatment, requested, resolved, warnings: sample.warnings, events: sample.events.length,
    generationMs: Math.round(generationMs), elapsedMs: Math.round(performance.now() - started),
    eventsPerSecond: Math.round(sample.events.length / (generationMs / 1000)),
    target: counts('target'), control: counts('control'), targetUsers: measured.targetUsers, controlUsers: measured.controlUsers,
    retention: { ...measured.retention, interval95: wilson(measured.retention.returned, measured.retention.entrants) },
    conversionDifference: measured.conversionDifference, ttcRatio: measured.ttcRatio, volumeRatio: measured.volumeRatio, countErrors };
}

export async function executeCell(cell) {
  const samples = [];
  for (const treatment of [true, false]) {
    samples.push(await sampleCell(cell, treatment));
    global.gc?.();
  }
  const [treatment, neutral] = samples;
  const scenario = SCENARIOS.find(entry => entry.id === cell.id);
  const isRatio = ['ttc', 'volume'].includes(scenario.kind);
  const statistic = scenario.kind === 'ttc' ? 'ttcRatio' : scenario.kind === 'volume' ? 'volumeRatio' : 'conversionDifference';
  const users = scenario.kind === 'retention' ? Math.min(...samples.map(sample => sample.retention.entrants)) :
    Math.min(...samples.flatMap(sample => [sample.target, sample.control].map(group => scenario.kind === 'ttc' ? group.converted : group.entrants)));
  const contractErrors = samples.flatMap(sample => sample.countErrors);
  const primary = { effect: scenario.kind === 'retention' ? treatment.retention.rate - neutral.retention.rate : treatment[statistic],
    neutral: scenario.kind === 'retention' ? null : neutral[statistic],
    effectBand: scenario.effect, neutralBand: scenario.neutral, users, minimum: scenario.minimum, nullValue: isRatio ? 1 : 0, contractErrors };
  if (scenario.kind === 'retention') {
    const replay = await sampleCell(cell, false);
    primary.neutral = replay.retention.rate - neutral.retention.rate;
    samples.push(replay);
    primary.contractErrors.push(...replay.countErrors);
    global.gc?.();
  }
  primary.verdict = classify(primary);
  const metrics = { primary };
  if (scenario.kind === 'experiment') {
    metrics.ttc = { effect: treatment.ttcRatio, neutral: neutral.ttcRatio, effectBand: scenario.ttcEffect,
      neutralBand: scenario.ttcNeutral, users: Math.min(...samples.flatMap(sample => [sample.target.converted, sample.control.converted])),
      minimum: 70, nullValue: 1, contractErrors };
    metrics.ttc.verdict = classify(metrics.ttc);
  }
  const severity = ['supported', 'insufficient-evidence', 'diluted', 'inverse', 'contractfail'];
  const verdict = severity[Math.max(...Object.values(metrics).map(metric => severity.indexOf(metric.verdict)))];
  return { samples, metrics, verdict, peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024),
    envelope: users < scenario.minimum ? 'below-evidence-minimum' : scenario.kind === 'retention' || cell.traffic === 'sparse' || cell.targetPercent !== 50 ? 'diagnostic-unsupported-envelope' : 'scenario-band-check' };
}

if (process.send) process.once('message', async ({ cell, probeHang }) => {
  const monitor = new Worker(`
    const { writeSync } = require('node:fs');
    setInterval(() => {
      if (process.memoryUsage.rss() > ${MEMORY.rssMiB} * 1024 * 1024) {
        writeSync(2, 'sweep memory-limit exceeded\\n');
        process.kill(-process.pid, 'SIGKILL');
      }
    }, 100);
  `, { eval: true, resourceLimits: { maxOldGenerationSizeMb: 16 } });
  monitor.on('error', error => { console.error(error); process.exit(1); });
  monitor.unref();
  if (probeHang) {
    const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    process.send({ type: 'started', descendantPid: descendant.pid });
    setInterval(() => {}, 1000);
    return;
  }
  process.send({ type: 'started' });
  try {
    const result = await executeCell(cell);
    process.send({ type: 'result', result }, () => process.exit(0));
  } catch (error) {
    console.error(error.stack);
    process.exit(1);
  }
});