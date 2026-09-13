import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { artifactRoot, importRun, newRunId, saveJson } from './harness.mjs';

const runId = newRunId('identity-wire');
const events = [];
for (const mode of ['compat', 'derived', 'prefixed']) {
  const device = `${runId}:${mode}-device`;
  const user = `${runId}:${mode}-user`;
  const rows = [
    { event: 'Wire A', device_id: device },
    { event: 'Wire Login', device_id: device, user_id: user },
    { event: 'Wire B', user_id: user },
  ];
  if (mode === 'compat') rows.forEach(event => { event.distinct_id = event.user_id || event.device_id; });
  if (mode === 'prefixed') rows.forEach(event => { event.distinct_id = event.user_id || `$device:${event.device_id}`; });
  rows.forEach((event, index) => events.push({ ...event, alignment_run_id: runId, mode,
    time: new Date(Date.parse('2026-08-02T12:00:00Z') + index * 10000).toISOString(), insert_id: randomUUID() }));
}
await importRun(runId, events, [], { v2Compat: false });
saveJson(resolve(artifactRoot, 'latest-identity-wire.json'), { runId });
saveJson(resolve(artifactRoot, runId, 'identity-wire.spec.json'), { runId, name: 'identity-wire', kind: 'funnel',
  from: '2026-08-01', to: '2026-08-31', steps: ['Wire A', 'Wire B'], options: {
    math: 'conversion_rate_unique', conversion_window: 30, group_by: 'mode', mode: 'steps' } });