import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { artifactRoot, root, readJson, saveJson } from './harness.mjs';

const runId = process.argv[2] || readJson(resolve(artifactRoot, 'latest-patterns.json')).runId;
const patterns = new Set(readJson(resolve(artifactRoot, runId, 'cells.json')).map(cell => cell.pattern));
const query = specification => {
  if (readJson(resolve(artifactRoot, runId, `${specification.name}.json`))?.response) return;
  const path = resolve(artifactRoot, runId, `${specification.name}.spec.json`);
  saveJson(path, { runId, from: '2026-08-01', to: '2026-08-31', ...specification });
  const result = spawnSync(process.execPath, [resolve(root, 'tests/alignment/live/query.mjs'), path], { stdio: 'inherit', timeout: 190000 });
  if (result.status !== 0) throw new Error(`Query failed: ${specification.name}`);
};
for (const pattern of ['frequency', 'aggregate']) {
  if (!patterns.has(pattern)) continue;
  query({ name: pattern, kind: 'insights', filters: { alignment_pattern: pattern },
    metrics: [{ event: 'Browse', math: 'total' }, { event: 'Browse', math: 'unique' },
      { event: 'Browse', math: 'total', property: 'amount' }, { event: 'Browse', math: 'average', property: 'amount' }],
    options: { mode: 'total', group_by: 'alignment_group' } });
}
if (patterns.has('frequency')) query({ name: 'frequency-histogram', kind: 'insights', filters: { alignment_pattern: 'frequency' },
  metrics: [{ event: 'Browse', math: 'total' }], measurement: { math: 'histogram', perUserAggregation: 'total' },
  options: { mode: 'total', group_by: 'alignment_group' } });
for (const pattern of ['funnel-frequency', 'legacy-ttc'].filter(pattern => patterns.has(pattern))) query({ name: pattern, kind: 'funnel',
  filters: { alignment_pattern: pattern }, steps: ['First Entry', 'First Success'],
  options: { math: 'conversion_rate_unique', conversion_window: 30, mode: 'steps', group_by: 'alignment_group' } });
const attributionGroup = {
  dataset: '$mixpanel', value: 'utm_source', resourceType: 'events', propertyType: 'string', typeCast: 'string',
  behavior: { aggregationOperator: 'multi_attribution', event: { label: 'Search', value: 'Search' },
    filters: [], filtersOperator: 'and', property: { dataset: '$mixpanel', value: 'utm_source', resourceType: 'events', type: 'string', propertyDefaultType: 'string' },
    dateRange: { type: 'in the last', window: { unit: 'day', value: 90 } } },
};
if (patterns.has('attribution')) query({ name: 'attribution', kind: 'insights', filters: { alignment_pattern: 'attribution' },
  metrics: [{ event: 'Browse', math: 'total' }], measurement: { multiAttribution: { type: 'first_touch' } },
  options: { mode: 'total' }, group: [{ value: 'alignment_cell', resourceType: 'events', propertyType: 'string' }, attributionGroup] });