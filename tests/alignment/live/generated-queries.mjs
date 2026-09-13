import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { artifactRoot, root, readJson, saveJson } from './harness.mjs';

const runId = process.argv.find(argument => argument.startsWith('dm182-')) || readJson(resolve(artifactRoot, 'latest-generated.json')).runId;
const cells = readJson(resolve(artifactRoot, runId, 'cells.json'));
const common = { runId, from: '2026-08-01', to: '2026-08-31' };
const query = specification => {
  if (readJson(resolve(artifactRoot, runId, `${specification.name}.json`))?.response) return;
  const path = resolve(artifactRoot, runId, `${specification.name}.spec.json`);
  saveJson(path, { ...common, ...specification });
  const result = spawnSync(process.execPath, [resolve(root, 'tests/alignment/live/query.mjs'), path], { stdio: 'inherit', timeout: 190000 });
  if (result.error || result.status !== 0) throw new Error(`Query failed: ${specification.name}`);
};
for (const arm of ['neutral', 'treatment']) query({ name: `totals-${arm}`, kind: 'insights',
  filters: { alignment_arm: arm }, metrics: [...new Set(readJson(resolve(artifactRoot, runId, 'events.json')).map(event => event.event))]
    .map(event => ({ event, math: 'total' })), options: { mode: 'total', group_by: 'alignment_cell' } });
for (const scenario of [...new Set(cells.map(cell => cell.scenario))]) {
  if (!['conditions', 'persona-conversion', 'persona-ttc', 'experiment', 'hook-ttc'].includes(scenario)) continue;
  query({ name: scenario, kind: 'funnel', steps: cells.find(cell => cell.scenario === scenario).report.steps,
    filters: { alignment_scenario: scenario }, options: { math: 'conversion_rate_unique', conversion_window: 30,
      conversion_window_unit: 'day', group_by: 'alignment_group', mode: 'steps', limit: 1000 } });
}