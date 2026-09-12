import { applyTTCBySegmentV2 } from '../../lib/hook-patterns/index.js';
import { makeFixture, runFixture, WINDOW } from './fixtures.mjs';
import { measureReport, profileIds, volumePerUser, measureRetention, measurePairedTtc } from './measures.mjs';

const hookCaptures = new WeakMap();

export const REPORTS = {
  first: { steps: ['First Entry', 'First Success'], options: { countMode: 'uniques', reentry: false, graceperiod: true, conversionWindowMs: 30 * 86400000 } },
  exposure: { steps: [{ event: '$experiment_started', where: { prop: 'Experiment name', op: 'eq', value: 'Generated Trial' } }, 'First Success'],
    options: { countMode: 'uniques', reentry: false, graceperiod: true, conversionWindowMs: 30 * 86400000 } },
  repeat: { steps: ['Repeat Entry', 'Repeat Success'], options: { countMode: 'uniques', reentry: false, graceperiod: true, conversionWindowMs: 86400000 } },
  repeatTotals: { steps: ['Repeat Entry', 'Repeat Success'], options: { countMode: 'totals', reentry: true, graceperiod: true, conversionWindowMs: 86400000 } },
};

export const SCENARIOS = [
  { id: 'conditions', kind: 'conversion', effect: [0.25, 0.55], neutral: [-0.12, 0.12], minimum: 200 },
  { id: 'persona-conversion', kind: 'conversion', effect: [0.15, 0.48], neutral: [-0.12, 0.12], minimum: 200 },
  { id: 'persona-ttc', kind: 'ttc', effect: [0.15, 0.40], neutral: [0.75, 1.30], minimum: 70 },
  { id: 'persona-volume', kind: 'volume', effect: [1.7, 3.8], neutral: [0.70, 1.40], minimum: 200 },
  { id: 'experiment', kind: 'experiment', effect: [0.15, 0.48], neutral: [-0.12, 0.12], minimum: 200,
    ttcEffect: [0.15, 0.40], ttcNeutral: [0.75, 1.30] },
  { id: 'weights', kind: 'weights', effect: [0.74, 0.86], neutral: [0.44, 0.56], minimum: 300 },
  { id: 'world', kind: 'world', effect: [2.0, 4.1], neutral: [0.70, 1.40], minimum: 80 },
  { id: 'hook-ttc', kind: 'ttc', effect: [0.15, 0.40], neutral: [0.75, 1.30], minimum: 70, numUsers: 3000 },
  { id: 'retention', kind: 'retention', effect: [0.10, 0.65], neutral: [-0.12, 0.12], minimum: 250 },
];

export function scenarioConfig(id, seed, strength, treatment, numUsers = SCENARIOS.find(scenario => scenario.id === id)?.numUsers ?? 1500) {
  const config = makeFixture(seed, strength, numUsers);
  const first = config.funnels[0];
  if (id === 'conditions') {
    config.funnels.splice(0, 1,
      { ...first, conditions: { segment: { eq: 'target' } }, conversionRate: treatment ? 75 : 40 },
      { ...first, conditions: { segment: { in: ['control'] } }, conversionRate: treatment ? 30 : 40 });
  }
  if (id.startsWith('persona-')) {
    config.personas = ['target', 'control'].map(segment => ({ name: segment, weight: 1,
      properties: { segment: [segment] },
      conversionModifier: treatment && id === 'persona-conversion' ? (segment === 'target' ? 1.6 : 0.8) : 1,
      ttcModifier: treatment && id === 'persona-ttc' && segment === 'target' ? 0.25 : 1,
      eventMultiplier: treatment && id === 'persona-volume' && segment === 'target' ? 3 : 1 }));
  }
  if (id === 'experiment') {
    first.experiment = { name: 'Generated Trial', sticky: true, stampProfile: true,
      variants: [{ name: 'target', weight: 1, conversionMultiplier: treatment ? 1.6 : 1, ttcMultiplier: treatment ? 0.25 : 1 },
        { name: 'control', weight: 1, conversionMultiplier: treatment ? 0.8 : 1, ttcMultiplier: 1 }] };
  }
  if (id === 'weights') config.events.find(event => event.event === 'Browse').properties.choice =
    { __weights: { common: treatment ? 80 : 50, rare: treatment ? 20 : 50 } };
  if (id === 'world') config.worldEvents = [{ name: 'Browse boost', startDay: 5, duration: 15,
    affectsEvents: ['Browse'], volumeMultiplier: treatment ? 3 : 1 }];
  if (id === 'hook-ttc') config.hook = (record, type, meta) => {
    if (type === 'everything') {
      const capture = hookCaptures.get(config);
      const options = { segmentKey: 'segment', factors: { target: treatment ? 0.25 : 1, control: 1 },
        steps: ['Repeat Entry', 'Repeat Success'], maxGapMinutes: 30 * 1440 };
      if (capture) {
        capture.before.push(...structuredClone(record));
        const neutral = structuredClone(record);
        applyTTCBySegmentV2(neutral, meta.profile, { ...options, factors: { target: 1, control: 1 } });
        capture.neutral.push(...neutral);
      }
      applyTTCBySegmentV2(record, meta.profile, options);
      if (capture) capture.after.push(...structuredClone(record));
    }
    return record;
  };
  if (id === 'retention') config.retentionCurve = treatment
    ? { type: 'linear', day1: 0.9, day7: 0.8, day14: 0.7, day30: 0.6 }
    : { type: 'linear', day1: 0.4, day7: 0.2, day14: 0.1, day30: 0.05 };
  return config;
}

export function measureScenario(id, sample, reports = REPORTS) {
  const key = id === 'experiment' ? 'Experiment: Generated Trial' : 'segment';
  const targetIds = profileIds(sample.profiles, key, 'target');
  const controlIds = profileIds(sample.profiles, key, 'control');
  const report = id === 'experiment' ? reports.exposure : id === 'hook-ttc'
    ? { ...reports.repeat, options: { ...reports.repeat.options, conversionWindowMs: 30 * 86400000 } } : reports.first;
  const target = measureReport(sample.events, { ...report, userIds: targetIds });
  const control = measureReport(sample.events, { ...report, userIds: controlIds });
  const browse = sample.events.filter(event => event.event === 'Browse');
  const start = Date.parse(WINDOW.datasetStart) + 5 * 86400000;
  const stop = start + 15 * 86400000;
  const countWindow = name => sample.events.filter(event => event.event === name && Date.parse(event.time) >= start && Date.parse(event.time) < stop).length;
  return { target, control, targetUsers: targetIds.size, controlUsers: controlIds.size,
    conversionDifference: target.rate - control.rate, ttcRatio: target.meanHours / control.meanHours,
    volumeRatio: volumePerUser(sample.events, targetIds) / volumePerUser(sample.events, controlIds),
    weightedCount: browse.length, commonShare: browse.filter(event => event.choice === 'common').length / browse.length,
    affected: countWindow('Browse'), unaffected: countWindow('Search'),
    retention: measureRetention(sample.events, { birthEvent: 'First Entry', day: 7, datasetEnd: WINDOW.datasetEnd }),
    neutralRetentionCohorts: [targetIds, controlIds].map(userIds => measureRetention(sample.events,
      { birthEvent: 'First Entry', day: 7, datasetEnd: WINDOW.datasetEnd, userIds })),
    standaloneCount: sample.events.filter(event => event.event === 'Background Activity').length,
    repeat: measureReport(sample.events, reports.repeat), repeatTotals: measureReport(sample.events, reports.repeatTotals),
    events: sample.events.length, warnings: sample.warnings };
}

export async function runScenario({ id, seed, strength = 'mixed', treatment = true, reports = REPORTS, numUsers }) {
  if (id === 'hook-ttc') {
    const pair = await runHookTtcPair({ seed, strength, treatment, reports, numUsers });
    return treatment ? pair.treatment : pair.neutral;
  }
  const config = scenarioConfig(id, seed, strength, treatment, numUsers);
  const sample = await runFixture(config);
  return { ...measureScenario(id, sample, reports), requestedUsers: config.numUsers };
}

export async function runHookTtcPair({ seed, strength = 'mixed', treatment = true, reports = REPORTS, numUsers }) {
  const config = scenarioConfig('hook-ttc', seed, strength, treatment, numUsers);
  const capture = { before: [], neutral: [], after: [] };
  hookCaptures.set(config, capture);
  const sample = await runFixture(config);
  const report = { ...reports.repeat, options: { ...reports.repeat.options, conversionWindowMs: 30 * 86400000 } };
  const paired = measurePairedTtc({ ...capture, emitted: sample.events, profiles: sample.profiles, report, window: WINDOW });
  const baseline = measureScenario('hook-ttc', { ...sample, events: capture.before }, reports);
  const neutral = measureScenario('hook-ttc', { ...sample, events: capture.neutral }, reports);
  const measured = measureScenario('hook-ttc', sample, reports);
  return { baseline: { ...baseline, requestedUsers: config.numUsers }, treatment: { ...measured, ...paired, requestedUsers: config.numUsers }, neutral: { ...neutral, ...paired, requestedUsers: config.numUsers,
    baselineAdjustedTtcRatio: paired.interventionNeutralTtcRatio } };
}