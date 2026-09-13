import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import generate from '../../../index.js';
import { scenarioConfig, SCENARIOS } from '../scenarios.mjs';
import { measureReport } from '../measures.mjs';
import { artifactRoot, importRun, isolate, newRunId, saveJson, runProperty } from './harness.mjs';

const runId = newRunId('generated');
const scenarios = process.argv.slice(2).length ? process.argv.slice(2) :
  ['conditions', 'persona-conversion', 'persona-ttc', 'persona-volume', 'experiment', 'hook-ttc', 'retention', 'weights', 'world'];
const events = [];
const profiles = [];
const cells = [];
for (const scenario of scenarios) for (const seed of [17, 43, 89]) for (const treatment of [false, true]) {
  const cell = `${scenario}-${seed}-${treatment ? 'treatment' : 'neutral'}`;
  const config = scenarioConfig(scenario, `alignment-generated-${seed}`, 'dense', treatment);
  config.name = `live-${cell}`;
  config.datasetStart = '2026-08-01T00:00:00Z';
  config.datasetEnd = '2026-08-31T00:00:00Z';
  config.superProps = { ...config.superProps, [runProperty]: [runId], alignment_cell: [cell],
    alignment_scenario: [scenario], alignment_arm: [treatment ? 'treatment' : 'neutral'], alignment_seed: [seed],
    alignment_segment: ['unassigned'], alignment_group: ['unassigned'] };
  config.userProps = { ...config.userProps, [runProperty]: [runId], alignment_cell: [cell] };
  const hook = config.hook;
  const before = [];
  config.hook = (records, type, meta) => {
    if (type === 'everything') before.push(...structuredClone(records));
    const result = hook ? hook(records, type, meta) : records;
    if (type === 'everything') for (const event of result || records) {
      const segment = scenario === 'experiment' ? meta.profile['Experiment: Generated Trial'] : meta.profile.segment;
      event.alignment_segment = segment || 'unassigned';
      event.alignment_group = `${cell}:${segment || 'unassigned'}`;
    }
    return result;
  };
  const output = await generate(config);
  const scope = isolate(Array.from(output.eventData), Array.from(output.userProfilesData), `${runId}:${cell}`);
  for (const event of scope.events) event[runProperty] = runId;
  for (const profile of scope.profiles) profile[runProperty] = runId;
  const steps = scenario === 'hook-ttc' ? ['Repeat Entry', 'Repeat Success']
    : scenario === 'experiment' ? ['$experiment_started', 'First Success'] : ['First Entry', 'First Success'];
  const report = { steps, options: { countMode: 'uniques', reentry: false, conversionWindowMs: 30 * 86400000 } };
  const summary = {};
  for (const segment of ['target', 'control']) {
    const selected = scope.events.filter(event => event.alignment_segment === segment);
    summary[segment] = measureReport(selected, report);
  }
  const baseline = {};
  if (scenario === 'hook-ttc') for (const segment of ['target', 'control']) {
    const ids = new Set(Array.from(output.userProfilesData).filter(profile => profile.segment === segment).map(profile => profile.distinct_id));
    baseline[segment] = measureReport(before, { ...report, userIds: ids });
  }
  assert.ok(scope.events.some(event => event.event === 'Background Activity'));
  assert.ok(scope.events.some(event => event.event === 'Repeat Entry'));
  events.push(...scope.events);
  profiles.push(...scope.profiles);
  cells.push({ cell, scenario, seed, treatment, events: scope.events.length, profiles: scope.profiles.length,
    report, summary, baseline, warnings: output.warnings, thresholds: SCENARIOS.find(item => item.id === scenario) });
  console.log(JSON.stringify({ generated: cell, events: scope.events.length }));
}
saveJson(resolve(artifactRoot, runId, 'cells.json'), cells);
await importRun(runId, events, profiles);
saveJson(resolve(artifactRoot, 'latest-generated.json'), { runId });