import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { artifactRoot, root, importRun, isolate, newRunId, saveJson } from './harness.mjs';

const runId = newRunId('boundaries');
const events = [];
const origin = Date.parse('2026-08-01T12:00:00Z');
const add = (owner, event, offset, properties = {}) => events.push({ user_id: owner, event,
  time: new Date(origin + offset).toISOString(), insert_id: randomUUID(), ...properties });
add('list', 'List A', 0, { cart: ['H', 'T'] });
add('list', 'List B', 10000, { cart: ['H'] });
add('list-session', 'List Session A', 0, { cart: ['H'] });
add('list-session', 'List Session B', 1200000, { cart: ['T'] });
add('list-session', 'List Session B', 2400000, { cart: ['H'] });
add('frequency', 'Boundary Frequency', 43140000);
add('frequency', 'Boundary Frequency', 43141000);
add('frequency', 'Boundary Frequency', 43260000);
add('frequency', 'Boundary Frequency', 129600000);
add('touch', 'Attr Touch', 0, { source: 'first' });
add('touch', 'Attr Touch', 60000);
add('touch', 'Attr Buy', 120000);
add('touch', 'Attr Touch', 180000, { source: 'last' });
add('touch', 'Attr Buy', 240000);
add('touch', 'Attr Touch', 300000, { source: 'future' });
add('no-touch', 'Attr Buy', 120000);
const scoped = isolate(events, [], runId);
await importRun(runId, scoped.events);
saveJson(resolve(artifactRoot, 'latest-boundaries.json'), { runId });
const group = { dataset: '$mixpanel', value: '$source', resourceType: 'events', propertyType: 'string', typeCast: 'string',
  behavior: { aggregationOperator: 'multi_attribution', event: { label: 'Attr Touch', value: 'Attr Touch' }, filters: [],
    filtersOperator: 'and', property: { dataset: '$mixpanel', value: '$source', resourceType: 'events', type: 'string', propertyDefaultType: 'string' },
    dateRange: { type: 'in the last', window: { unit: 'day', value: 30 } } } };
const queries = [
  { name: 'list-unique', kind: 'funnel', steps: ['List A', 'List B'], options: { math: 'conversion_rate_unique', holding_constant: 'cart', conversion_window: 30 } },
  { name: 'list-total', kind: 'funnel', steps: ['List A', 'List B'], options: { math: 'conversion_rate_total', holding_constant: 'cart', conversion_window: 30 } },
  { name: 'list-session', kind: 'funnel', steps: ['List Session A', 'List Session B'], options: {
    math: 'conversion_rate_session', holding_constant: 'cart', conversion_window: 1, conversion_window_unit: 'session' } },
  { name: 'rolling-frequency', kind: 'frequency', event: 'Boundary Frequency', unit: 'week', addictionUnit: 'day' },
  ...['first_touch', 'last_touch'].map(model => ({ name: model, kind: 'insights', metrics: [{ event: 'Attr Buy', math: 'total' }],
    measurement: { multiAttribution: { type: model } }, options: { mode: 'total' }, group: [group] })),
];
for (const query of queries) {
  const path = resolve(artifactRoot, runId, `${query.name}.spec.json`);
  saveJson(path, { runId, from: '2026-08-01', to: '2026-08-07', ...query });
  const result = spawnSync(process.execPath, [resolve(root, 'tests/alignment/live/query.mjs'), path], { stdio: 'inherit', timeout: 190000 });
  if (result.status !== 0) { process.exitCode = result.status || 1; break; }
}