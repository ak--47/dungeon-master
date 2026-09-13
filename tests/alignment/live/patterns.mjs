import { resolve } from 'node:path';
import generate from '../../../index.js';
import { applyFrequencyByFrequency, applyAggregateByBin, applyFunnelFrequencyBreakdown,
  applyTTCBySegment, applyAttributedBySource } from '../../../lib/hook-patterns/index.js';
import { makeFixture } from '../fixtures.mjs';
import { measureReport } from '../measures.mjs';
import { artifactRoot, importRun, isolate, newRunId, saveJson, runProperty } from './harness.mjs';

const runId = newRunId('patterns');
const events = [];
const profiles = [];
const cells = [];
const selectedPatterns = process.argv.slice(2).length ? process.argv.slice(2) : ['frequency', 'aggregate', 'funnel-frequency', 'legacy-ttc', 'attribution'];
for (const pattern of selectedPatterns) for (const seed of [17, 43, 89]) for (const treatment of [false, true]) {
  const cell = `${pattern}-${seed}-${treatment ? 'treatment' : 'neutral'}`;
  const config = makeFixture(`pattern-live-${seed}`, 'dense', 1500);
  config.datasetStart = '2026-08-01T00:00:00Z';
  config.datasetEnd = '2026-08-31T00:00:00Z';
  config.funnels[0].conversionRate = 90;
  config.superProps = { [runProperty]: [runId], alignment_cell: [cell], alignment_pattern: [pattern],
    alignment_arm: [treatment ? 'treatment' : 'neutral'], alignment_group: ['unassigned'], alignment_bin: ['unassigned'],
    alignment_segment: ['unassigned'] };
  config.userProps[runProperty] = [runId];
  config.userProps.alignment_cell = [cell];
  if (pattern === 'attribution') {
    config.switches.hasCampaigns = true;
    config.events.find(event => event.event === 'Search').isAttributionEvent = true;
  }
  const before = [];
  config.hook = (records, type, meta) => {
    if (type === 'funnel-post' && pattern === 'legacy-ttc' && meta.isFirstFunnel) {
      applyTTCBySegment(records, meta.profile, { segmentKey: 'segment', factors: { target: treatment ? 0.5 : 1, control: 1 } });
    }
    if (type !== 'everything') return records;
    if (pattern === 'frequency') {
      const upper = Date.parse(config.datasetEnd) - (records.length + 1) * 1000;
      for (const event of records) if (event.event === 'Browse' && Date.parse(event.time) > upper) {
        event.time = new Date(upper).toISOString();
      }
    }
    if (pattern === 'attribution') {
      const touches = records.filter(event => event.event === 'Search' && event.utm_source != null)
        .sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
      for (let index = touches.length - 2; index >= 0; index--) {
        const latest = Date.parse(touches[index + 1].time) - 1;
        if (Date.parse(touches[index].time) > latest) touches[index].time = new Date(latest).toISOString();
      }
    }
    const bin = records.filter(event => event.event === 'Search').length >= 4 ? 'high' : 'low';
    before.push(...structuredClone(records).map(event => ({ ...event, alignment_bin: bin, alignment_segment: meta.profile.segment })));
    const bins = { low: [0, 4], high: [4, Infinity] };
    if (pattern === 'frequency') applyFrequencyByFrequency(records, meta.profile, { cohortEvent: 'Search', bins,
      targetEvent: 'Browse', multipliers: { low: 1, high: treatment ? 2 : 1 }, binBy: 'events' });
    if (pattern === 'aggregate') applyAggregateByBin(records, meta.profile, { cohortEvent: 'Search', bins,
      event: 'Browse', propertyName: 'amount', deltas: { low: 1, high: treatment ? 2 : 1 }, binBy: 'events' });
    if (pattern === 'funnel-frequency') applyFunnelFrequencyBreakdown(records, meta.profile, records, { cohortEvent: 'Search', bins,
      finalStep: 'First Success', dropMultipliers: { low: treatment ? 0.25 : 1, high: treatment ? 0.9 : 1 }, binBy: 'events' });
    if (pattern === 'attribution' && treatment) applyAttributedBySource(records, meta.profile, { weights: { engineered: 1 }, model: 'firstTouch' });
    for (const event of records) {
      event.alignment_bin = bin;
      event.alignment_segment = meta.profile.segment;
      event.alignment_group = `${cell}:${pattern === 'legacy-ttc' ? meta.profile.segment : bin}`;
    }
    return records;
  };
  const output = await generate(config);
  const scoped = isolate(Array.from(output.eventData), Array.from(output.userProfilesData), `${runId}:${cell}`);
  for (const event of scoped.events) event[runProperty] = runId;
  for (const profile of scoped.profiles) profile[runProperty] = runId;
  const summary = {};
  const report = { steps: ['First Entry', 'First Success'], options: { countMode: 'uniques', conversionWindowMs: 30 * 86400000 } };
  for (const group of pattern === 'legacy-ttc' ? ['target', 'control'] : ['low', 'high']) {
    const rows = scoped.events.filter(event => event.alignment_group === `${cell}:${group}`);
    const original = before.filter(event => event[pattern === 'legacy-ttc' ? 'alignment_segment' : 'alignment_bin'] === group);
    summary[group] = { report: measureReport(rows, report), users: new Set(rows.map(event => event.user_id)).size,
      browse: rows.filter(event => event.event === 'Browse').length,
      amount: rows.filter(event => event.event === 'Browse').reduce((sum, event) => sum + event.amount, 0),
      beforeBrowse: original.filter(event => event.event === 'Browse').length,
      beforeAmount: original.filter(event => event.event === 'Browse').reduce((sum, event) => sum + event.amount, 0) };
  }
  events.push(...scoped.events);
  profiles.push(...scoped.profiles);
  cells.push({ cell, pattern, seed, treatment, summary, report, warnings: output.warnings });
  console.log(JSON.stringify({ generated: cell, events: scoped.events.length }));
}
saveJson(resolve(artifactRoot, runId, 'cells.json'), cells);
await importRun(runId, events, profiles);
saveJson(resolve(artifactRoot, 'latest-patterns.json'), { runId });