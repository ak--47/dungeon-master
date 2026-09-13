import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import mp from 'mixpanel-import';
import dotenv from 'dotenv';
import { artifactRoot, newRunId, saveJson, readJson, reserveEvents, assertIsolated, revision } from './harness.mjs';

dotenv.config({ path: resolve(artifactRoot, 'auth.env') });
const runId = newRunId('identity-ordered');
const events = [];
for (let index = 0; index < 10; index++) {
  const device = `${runId}:device-${index}`;
  const user = `${runId}:user-${index}`;
  const base = Date.parse('2026-08-03T12:00:00Z');
  for (const [offset, event] of [
    [0, { event: 'Ordered A', device_id: device }],
    [10, { event: 'Ordered Login', device_id: device, user_id: user }],
    [20, { event: 'Ordered B', user_id: user }],
  ]) events.push({ ...event, time: new Date(base + offset * 1000).toISOString(), alignment_run_id: runId, insert_id: randomUUID() });
}
assertIsolated(events, runId);
const ledgerPath = resolve(artifactRoot, 'imports.json');
const ledger = reserveEvents(readJson(ledgerPath, { runs: [] }), runId, events.length);
saveJson(ledgerPath, ledger);
saveJson(resolve(artifactRoot, runId, 'events.json'), events);
const options = { recordType: 'event', region: 'US', fixData: true, matchMixpanelDefaults: true,
  v2_compat: true, verbose: false, showProgress: false, strict: false, workers: 1, logs: false };
const creds = { token: process.env.ALIGNMENT_IMPORT_TOKEN };
const stitches = events.filter(event => event.user_id && event.device_id);
const rest = events.filter(event => !(event.user_id && event.device_id));
const first = await mp(creds, stitches, options);
const second = await mp(creds, rest, options);
await mp.destroy();
const success = first.success + second.success;
if (success !== events.length) throw new Error('Ordered import failed reconciliation');
ledger.runs.at(-1).state = 'imported';
ledger.runs.at(-1).success = success;
saveJson(ledgerPath, ledger);
saveJson(resolve(artifactRoot, runId, 'manifest.json'), { runId, source: revision(), count: events.length,
  phases: [{ count: stitches.length, success: first.success }, { count: rest.length, success: second.success }] });
saveJson(resolve(artifactRoot, 'latest-identity-ordered.json'), { runId });
saveJson(resolve(artifactRoot, runId, 'identity-ordered.spec.json'), { runId, name: 'identity-ordered', kind: 'funnel',
  from: '2026-08-01', to: '2026-08-31', steps: ['Ordered A', 'Ordered B'],
  options: { math: 'conversion_rate_unique', conversion_window: 30, mode: 'steps' } });
console.log(JSON.stringify({ runId, imported: success }));