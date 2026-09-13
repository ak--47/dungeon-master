import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { artifactRoot, importRun, isolate, newRunId, saveJson, settings } from './harness.mjs';

const runId = newRunId('exact');
const origin = Date.parse('2026-08-01T12:00:00Z');
const events = [];
const add = (owner, name, seconds, properties = {}) => events.push({
  event: name, user_id: owner, time: new Date(origin + seconds * 1000).toISOString(), insert_id: randomUUID(), ...properties,
});

for (let owner = 0; owner < 4; owner++) {
  add(`person-${owner}`, 'Align A', owner * 100, { case: 'basic', amount: owner + 1 });
  if (owner < 3) add(`person-${owner}`, 'Align B', owner * 100 + 10, { case: 'basic', amount: (owner + 1) * 10 });
  if (owner < 2) add(`person-${owner}`, 'Align A', owner * 100 + 30, { case: 'basic' });
  if (owner < 2) add(`person-${owner}`, 'Align B', owner * 100 + 40, { case: 'basic' });
}
add(undefined, 'Align Identity A', 0, { case: 'unstitched', device_id: 'unlinked-a' });
add(undefined, 'Align Identity B', 10, { case: 'unstitched', device_id: 'unlinked-b' });
add(undefined, 'Align Identity A', 20, { case: 'stitched', device_id: 'linked' });
add('linked-user', 'Align Login', 25, { case: 'stitched', device_id: 'linked' });
add('linked-user', 'Align Identity B', 30, { case: 'stitched' });
add('session-user', 'Align Session A', 0, { case: 'hpc', plan: 'x' });
add('session-user', 'Align Session B', 1200, { case: 'hpc', plan: 'y' });
add('session-user', 'Align Session B', 2400, { case: 'hpc', plan: 'x' });
for (let owner = 0; owner < 3; owner++) {
  add(`retained-${owner}`, 'Align Birth', 0, { case: 'retention' });
  add(`retained-${owner}`, 'Align Return', 86400 + 60, { case: 'retention' });
  if (owner < 2) add(`retained-${owner}`, 'Align Return', 7 * 86400 + 60, { case: 'retention' });
}
for (const seconds of [43140, 43260, 129600]) add('frequency-user', 'Align Frequency', seconds, { case: 'frequency' });
const profiles = [
  { distinct_id: 'unlinked-user', device_ids: ['unlinked-a', 'unlinked-b'], case: 'unstitched' },
  { distinct_id: 'linked-user', device_ids: ['linked'], case: 'stitched' },
];
const scoped = isolate(events, profiles, runId);
await settings({ configure: true });
await importRun(runId, scoped.events, scoped.profiles);
saveJson(resolve(artifactRoot, 'latest-exact.json'), { runId });
saveJson(resolve(artifactRoot, runId, 'totals.spec.json'), {
  runId, name: 'totals', kind: 'insights', from: '2026-08-01', to: '2026-08-31',
  metrics: [...new Set(events.map(event => event.event))].map(event => ({ event, math: 'total' })),
  options: { mode: 'total' },
});