import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mp from 'mixpanel-import';
import { sendToMixpanel } from '../../../lib/orchestrators/mixpanel-sender.js';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const artifactRoot = resolve(root, 'tmp/alignment-1.8.2');
export const projectId = 4063241;
export const eventLimit = 25000000;
export const runProperty = 'alignment_run_id';
const baseUrl = 'https://mixpanel-power-tools-api-lmozz6xkha-uc.a.run.app';

export function readJson(path, fallback) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
}

export function saveJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

export function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function revision() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}

export function newRunId(label) {
  return `dm182-${label}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

export function reserveEvents(ledger, runId, count) {
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid event reservation');
  if (ledger.runs.some(run => run.runId === runId)) throw new Error(`Run already reserved: ${runId}`);
  const total = ledger.runs.reduce((sum, run) => sum + run.reserved, 0);
  if (total + count > eventLimit) throw new Error(`Import budget exceeded: ${total + count} > ${eventLimit}`);
  return { ...ledger, runs: [...ledger.runs, { runId, reserved: count, state: 'reserved', at: new Date().toISOString() }] };
}

export function assertIsolated(events, runId) {
  if (!runId || !Array.isArray(events) || !events.length) throw new Error('Nonempty isolated events required');
  for (const event of events) {
    if (event[runProperty] !== runId) throw new Error('Event missing matching alignment_run_id');
    for (const key of ['user_id', 'device_id', 'distinct_id']) {
      const value = String(event[key] || '').replace(/^\$device:/, '');
      if (value && !value.startsWith(`${runId}:`)) throw new Error(`Unscoped ${key}`);
    }
    if (!event.insert_id || !Number.isFinite(Date.parse(event.time))) throw new Error('Invalid event identity or time');
  }
}

export function isolate(events, profiles, runId) {
  const scoped = value => value == null || value === '' ? value : `${runId}:${value}`;
  return {
    events: events.map(event => {
      const copy = { ...event, [runProperty]: runId };
      for (const key of ['user_id', 'device_id', 'distinct_id']) if (copy[key]) copy[key] = scoped(copy[key]);
      return copy;
    }),
    profiles: profiles.map(profile => {
      const copy = { ...profile, [runProperty]: runId };
      for (const key of ['user_id', 'distinct_id']) if (copy[key]) copy[key] = scoped(copy[key]);
      for (const key of ['device_ids', 'anonymousIds']) if (Array.isArray(copy[key])) copy[key] = copy[key].map(scoped);
      return copy;
    }),
  };
}

async function powerTools(endpoint, body = {}) {
  dotenv.config({ path: resolve(root, '.env') });
  if (!process.env.BEARER_TOKEN) throw new Error('BEARER_TOKEN is required');
  const response = await fetch(baseUrl + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.BEARER_TOKEN}` },
    body: JSON.stringify({ ...body, project_id: projectId, client_id: 'dungeon-master', region: 'US' }),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`Power Tools ${endpoint}: HTTP ${response.status}`);
  return response.json();
}

export async function settings({ configure = false } = {}) {
  if (configure) await powerTools('/crud/setTimezone', { timezone: 'UTC' });
  const result = await powerTools('/crud/getSettings');
  const meta = result.meta || result;
  if (Number(meta.id) !== projectId) throw new Error('Unexpected live project');
  const safe = JSON.parse(JSON.stringify(result, (key, value) => /token|secret|password|email/i.test(key) ? '[redacted]' : value));
  saveJson(resolve(artifactRoot, 'settings.json'), { capturedAt: new Date().toISOString(), settings: safe });
  return result;
}

export async function importRun(runId, events, profiles = [], { v2Compat } = {}) {
  assertIsolated(events, runId);
  const manifestPath = resolve(artifactRoot, runId, 'manifest.json');
  if (existsSync(manifestPath)) throw new Error('Run manifest already exists; use a new run ID');
  const ledgerPath = resolve(artifactRoot, 'imports.json');
  const ledger = reserveEvents(readJson(ledgerPath, { projectId, limit: eventLimit, runs: [] }), runId, events.length);
  saveJson(ledgerPath, ledger);
  saveJson(resolve(artifactRoot, runId, 'events.json'), events);
  saveJson(resolve(artifactRoot, runId, 'profiles.json'), profiles);
  const manifest = { runId, projectId, source: revision(), count: events.length, profiles: profiles.length,
    eventHash: fingerprint(events), startedAt: new Date().toISOString(), state: 'importing' };
  saveJson(manifestPath, manifest);
  await settings();
  dotenv.config({ path: resolve(artifactRoot, 'auth.env') });
  const token = process.env.ALIGNMENT_IMPORT_TOKEN;
  if (!token) throw new Error('ALIGNMENT_IMPORT_TOKEN is required in the ignored local auth.env');
  const receipt = typeof v2Compat === 'boolean' ? { events: await mp({ token }, events, {
    recordType: 'event', region: 'US', fixData: true, matchMixpanelDefaults: true,
    v2_compat: v2Compat, verbose: false, showProgress: false, logs: false,
    strict: false, workers: 1,
  }), users: {} } : await sendToMixpanel({
    config: { token, projectId, region: 'US', format: 'json', writeToDisk: false, verbose: false },
    storage: { eventData: events, userProfilesData: profiles, groupProfilesData: [], scdTableData: {}, groupEventData: [] },
    runtime: { profilesGenerated: profiles.length, profilesDropped: profiles.filter(profile => profile._drop).length },
    isBatchMode: () => false,
  });
  if (typeof v2Compat === 'boolean') await mp.destroy();
  manifest.receipt = { events: { success: receipt.events.success, failed: receipt.events.failed },
    users: { success: receipt.users.success, failed: receipt.users.failed } };
  manifest.state = receipt.events.success === events.length && !receipt.events.failed ? 'imported' : 'failed';
  saveJson(manifestPath, manifest);
  const reservation = ledger.runs.find(run => run.runId === runId);
  reservation.state = manifest.state;
  reservation.success = receipt.events.success;
  saveJson(ledgerPath, ledger);
  if (manifest.state !== 'imported') throw new Error('Import receipt did not reconcile');
  console.log(JSON.stringify({ runId, imported: events.length, profiles: profiles.length }));
  return manifest;
}