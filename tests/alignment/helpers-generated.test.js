import { describe, expect, it } from 'vitest';
import { makeFixture, runFixture, SEEDS } from './fixtures.mjs';
import { applyAggregateByBin, applyFrequencyByFrequency, applyAttributedBySource } from '../../lib/hook-patterns/index.js';
import { scaleEventCount, scalePropertyValue, injectOnNewDays, applySessionShape,
  applyLifecycleWave, applyPathBias, splitByAuth, isPreAuthEvent } from '../../lib/hook-helpers/index.js';

const DAY = 86400000;
const names = ['Browse', 'Search', 'Help'];
const count = (events, name) => events.filter(event => event.event === name).length;
const days = (events, name) => new Set(events.filter(event => event.event === name)
  .map(event => Math.floor(Date.parse(event.time) / DAY))).size;
const sum = events => events.filter(event => event.event === 'Browse')
  .reduce((total, event) => total + event.amount, 0);
const snapshot = events => ({ browse: count(events, 'Browse'), search: count(events, 'Search'),
  help: count(events, 'Help'), days: days(events, 'Browse'), cohortDays: days(events, 'Search'), sum: sum(events) });

function configFor(seed) {
  const config = makeFixture(seed);
  config.numUsers = 300;
  config.numEvents = 9000;
  config.avgEventsPerUserPerDay = 1;
  config.percentUsersBornInDataset = 0;
  return config;
}

function streams(events) {
  const result = new Map();
  for (const event of events) {
    expect(event.user_id).toBeTruthy();
    if (!result.has(event.user_id)) result.set(event.user_id, []);
    result.get(event.user_id).push(event);
  }
  return result;
}

function integrity(events) {
  expect(new Set(events.map(event => event.insert_id)).size).toBe(events.length);
  expect(events.every(event => event.insert_id && Number.isFinite(Date.parse(event.time)))).toBe(true);
  expect(events.filter(event => names.includes(event.event)).length).toBeGreaterThan(600);
  expect(events.filter(event => event.event === 'Repeat Entry').length).toBeGreaterThan(100);
}

function sessions(events, timeout) {
  const sorted = [...events].sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
  const result = [];
  for (const event of sorted) {
    const current = result.at(-1);
    const time = Date.parse(event.time);
    if (!current || time - Date.parse(current.at(-1).time) > timeout * 60000 ||
      Math.floor(time / DAY) !== Math.floor(Date.parse(current[0].time) / DAY)) result.push([event]);
    else current.push(event);
  }
  return result;
}

describe.sequential('generated session and shape proofs', () => {
  it('sessionTimeout: emitted full-stream gaps change actual session count', async () => {
    for (const seed of SEEDS) {
      const observations = [];
      for (const timeout of [5, 30]) {
        const config = configFor(seed);
        config.identity = { sessionTimeout: timeout };
        config.hook = (records, type) => type === 'everything'
          ? applySessionShape(records, '', { sessionsPerWeek: 3, eventsPerSession: 3, sessionMinutes: 20 }) : records;
        const sample = await runFixture(config);
        integrity(sample.events);
        let actual = 0;
        let filteredAfter = 0;
        for (const events of streams(sample.events).values()) {
          const derived = sessions(events, timeout);
          actual += derived.length;
          filteredAfter += derived.filter(session => session.some(event => event.event === 'Browse')).length;
          expect(new Set(events.map(event => event.session_id)).size).toBe(derived.length);
          for (const session of derived) expect(new Set(session.map(event => event.session_id)).size).toBe(1);
        }
        observations.push({ timeout, actual, filteredAfter, events: sample.events.length,
          times: sample.events.map(event => event.time) });
      }
      expect(observations[0].events).toBe(observations[1].events);
      expect(observations[0].times).toEqual(observations[1].times);
      expect(observations[0].actual).toBeGreaterThan(observations[1].actual * 1.3);
      expect(observations[1].filteredAfter).toBeGreaterThan(300);
      console.log('HELPERS_METRIC', JSON.stringify({ mode: 'sessionTimeout', seed,
        observations: observations.map(({ times, ...observation }) => observation) }));
    }
  }, 90000);

  for (const mode of ['session-shape', 'new-days', 'lifecycle', 'path']) {
    it(`${mode}: exact target and neutral metrics on competing traffic`, async () => {
      for (const seed of SEEDS) for (const treatment of [false, true]) {
        const config = configFor(seed);
        const before = new Map();
        config.hook = (records, type) => {
          if (type !== 'everything') return records;
          const uid = records.find(event => event.user_id)?.user_id;
          const times = records.map(event => Date.parse(event.time));
          const first = Math.min(...times);
          const last = Math.max(...times);
          before.set(uid, { ...snapshot(records), count: records.length, first, last,
            sessionCount: sessions(records, 30).length,
            survivingTemplate: records.some(event => event.event === 'Browse' &&
              (Date.parse(event.time) < first + 3 * DAY || Date.parse(event.time) > first + 12 * DAY)) });
          if (!treatment) return records;
          if (mode === 'session-shape') return applySessionShape(records, uid,
            { sessionsPerWeek: 2, eventsPerSession: 3, sessionMinutes: 10 });
          if (mode === 'new-days') return injectOnNewDays(records, 'Browse', 15);
          if (mode === 'lifecycle' && first + 13 * DAY < Date.parse(config.datasetEnd)) return applyLifecycleWave(records, uid,
            { dormantFromDay: 3, dormantDays: 9, resurrectBurst: 3, valueMomentEvent: 'Browse' });
          if (mode === 'path') return applyPathBias(records, uid,
            { anchor: 'Browse', path: ['Search', 'Help'], share: 1, gapSeconds: [2, 2] });
          return records;
        };
        const sample = await runFixture(config);
        integrity(sample.events);
        let eligible = 0;
        let metric = 0;
        let neutralMetric = 0;
        let lostEvents = 0;
        let missingSessions = 0;
        for (const [uid, events] of streams(sample.events)) {
          const original = before.get(uid);
          const final = snapshot(events);
          if (mode === 'session-shape') {
            eligible++;
            const expected = Math.min(2 * Math.max(1, Math.ceil((original.last - original.first + 1) / (7 * DAY))),
              Math.ceil(original.count / 3));
            const actual = sessions(events, 30).length;
            expect.soft(events.length).toBe(original.count);
            expect.soft(actual).toBe(treatment ? expected : original.sessionCount);
            lostEvents += original.count - events.length;
            missingSessions += (treatment ? expected : original.sessionCount) - actual;
            metric += actual;
            neutralMetric += original.sessionCount;
          }
          if (mode === 'new-days' && original.browse) {
            eligible++;
            const capacity = Math.floor(original.last / DAY) - Math.floor(original.first / DAY) + 1;
            const expected = treatment ? Math.max(original.days, Math.min(15, capacity)) : original.days;
            expect.soft(final.days).toBe(expected);
            expect.soft(final.browse).toBe(original.browse + expected - original.days);
            expect.soft(final.search).toBe(original.search);
            metric += final.days;
            neutralMetric += original.days;
          }
          if (mode === 'lifecycle' && original.survivingTemplate && original.first + 13 * DAY < Date.parse(config.datasetEnd)) {
            const start = original.first + 3 * DAY;
            const end = original.first + 12 * DAY;
            const inGap = events.filter(event => event.event === 'Browse' && Date.parse(event.time) >= start && Date.parse(event.time) <= end).length;
            const burst = events.filter(event => event.event === 'Browse' && Date.parse(event.time) > end && Date.parse(event.time) <= end + 4 * 3600000).length;
            eligible++;
            if (treatment) {
              expect.soft(inGap).toBe(0);
              expect.soft(burst).toBeGreaterThanOrEqual(3);
            }
            expect.soft(final.search).toBe(original.search);
            metric += inGap;
          }
          if (mode === 'path' && original.browse && original.search && original.help) {
            const sorted = [...events].sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
            const first = sorted.findIndex(event => event.event === 'Browse');
            eligible++;
            if (sorted[first + 1]?.event === 'Search' && sorted[first + 2]?.event === 'Help') metric++;
            expect.soft(final.search).toBe(original.search + (treatment ? 1 : 0));
            expect.soft(final.help).toBe(original.help + (treatment ? 1 : 0));
          }
        }
        expect(eligible).toBeGreaterThanOrEqual(100);
        if (mode === 'new-days') expect(metric).toBeGreaterThanOrEqual(neutralMetric * (treatment ? 1.5 : 1));
        if (mode === 'lifecycle' && !treatment) expect(metric).toBeGreaterThan(100);
        if (mode === 'path' && treatment) expect.soft(metric / eligible).toBe(1);
        if (mode === 'path' && !treatment) expect(metric / eligible).toBeLessThan(0.9);
        console.log('HELPERS_METRIC', JSON.stringify({ mode, seed, treatment, eligible, metric, neutralMetric, lostEvents, missingSessions }));
      }
    }, 90000);
  }
});

describe.sequential('generated attribution and identity proofs', () => {
  it('attribution: first/last touch overwrites preserve engine touch population', async () => {
    for (const seed of SEEDS) for (const model of ['firstTouch', 'lastTouch', 'both']) for (const treatment of [false, true]) {
      const config = configFor(seed);
      config.switches.hasCampaigns = true;
      config.superProps.utm_source = [null];
      const before = new Map();
      config.hook = (records, type) => {
        if (type !== 'everything') return records;
        const uid = records.find(event => event.user_id)?.user_id;
        const touches = records.filter(event => event.utm_source != null)
          .sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
        before.set(uid, touches.map(event => ({ id: event.insert_id, source: event.utm_source })));
        if (treatment) applyAttributedBySource(records, {}, { weights: { audited: 1 }, model });
        return records;
      };
      const sample = await runFixture(config);
      integrity(sample.events);
      let eligible = 0;
      let audited = 0;
      for (const [uid, events] of streams(sample.events)) {
        const original = before.get(uid);
        const touches = events.filter(event => event.utm_source != null)
          .sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
        expect(touches.map(event => event.insert_id)).toEqual(original.map(event => event.id));
        if (touches.length < 2) continue;
        eligible++;
        for (const [index, touch] of touches.entries()) {
          const selected = (index === 0 && model !== 'lastTouch') || (index === touches.length - 1 && model !== 'firstTouch');
          expect(touch.utm_source).toBe(treatment && selected ? 'audited' : original[index].source);
        }
        if (touches[model === 'lastTouch' ? touches.length - 1 : 0].utm_source === 'audited') audited++;
      }
      expect(eligible).toBeGreaterThanOrEqual(100);
      expect(audited).toBe(treatment ? eligible : 0);
      console.log('HELPERS_METRIC', JSON.stringify({ mode: 'attribution', seed, model, treatment, eligible, audited }));
    }
  }, 90000);

  for (const devices of [0, 1, 4]) {
    it(`identity: avgDevicePerUser=${devices}, real stitches and failed-prior attempts`, async () => {
      for (const seed of SEEDS) for (const attempts of [0, 2]) {
        const config = configFor(seed);
        config.identity = { avgDevicePerUser: devices };
        config.percentUsersBornInDataset = devices ? 100 : 0;
        config.events[1].isAuthEvent = true;
        config.funnels[0].conversionRate = 70;
        config.funnels[0].attempts = { min: attempts, max: attempts, conversionRate: 70 };
        const owners = new Map();
        config.hook = (records, type, meta) => {
          if (type === 'everything') for (const event of records) owners.set(event.insert_id, meta.profile.distinct_id);
          return records;
        };
        const sample = await runFixture(config);
        integrity(sample.events);
        const emitted = new Map();
        const merge = new Map();
        for (const event of sample.events) {
          const owner = owners.get(event.insert_id);
          expect(owner).toBeTruthy();
          if (!emitted.has(owner)) emitted.set(owner, []);
          emitted.get(owner).push(event);
          if (event.user_id && event.device_id) {
            expect(merge.get(event.device_id) ?? event.user_id).toBe(event.user_id);
            merge.set(event.device_id, event.user_id);
          }
        }
        let stitched = 0;
        let anonymous = 0;
        let multiDevice = 0;
        let unresolved = 0;
        let preAuthLeaks = 0;
        let anonymousLeaks = 0;
        let attemptMismatches = 0;
        for (const [owner, events] of emitted) {
          const auth = events.filter(event => event.event === 'First Success');
          const pool = new Set(events.map(event => event.device_id).filter(Boolean));
          if (pool.size > 1) multiDevice++;
          if (!devices) {
            expect(pool.size).toBe(0);
            expect(events.every(event => event.user_id === owner)).toBe(true);
            continue;
          }
          if (count(events, 'First Entry') !== attempts + 1) attemptMismatches++;
          expect(auth.length).toBeLessThanOrEqual(1);
          if (auth.length) {
            stitched++;
            expect(auth[0].user_id).toBe(owner);
            expect(auth[0].device_id).toBeTruthy();
            const split = splitByAuth(events, Date.parse(auth[0].time));
            expect(split.stitch).toBe(auth[0]);
            for (const event of split.preAuth) {
              if (event.user_id) preAuthLeaks++;
              expect(event.device_id).toBeTruthy();
              expect(isPreAuthEvent(event, Date.parse(auth[0].time))).toBe(true);
            }
          } else {
            anonymous++;
            anonymousLeaks += events.filter(event => event.user_id || !event.device_id).length;
            expect(splitByAuth(events, null).preAuth.length).toBe(events.length);
          }
          for (const event of events) if (!event.user_id) {
            const canonical = merge.get(event.device_id);
            if (canonical) expect(canonical).toBe(owner);
            else unresolved++;
          }
          if (devices === 1) expect(pool.size).toBe(1);
        }
        expect(emitted.size).toBeGreaterThanOrEqual(250);
        if (devices) {
          expect(stitched).toBeGreaterThanOrEqual(100);
          expect(anonymous).toBeGreaterThanOrEqual(30);
          expect(unresolved).toBeGreaterThan(0);
        }
        if (devices === 4) expect(multiDevice).toBeGreaterThanOrEqual(100);
        expect.soft(preAuthLeaks).toBe(0);
        expect.soft(anonymousLeaks).toBe(0);
        expect.soft(attemptMismatches).toBe(0);
        console.log('HELPERS_METRIC', JSON.stringify({ mode: 'identity', seed, devices, attempts,
          users: emitted.size, stitched, anonymous, multiDevice, unresolved, preAuthLeaks, anonymousLeaks, attemptMismatches }));
      }
    }, 90000);
  }
});

describe.sequential('generated helper proofs: declared thresholds, three seeds', () => {
  for (const mode of ['aggregate-days', 'aggregate-events', 'frequency-days', 'frequency-events', 'scale-count', 'scale-value']) {
    it(`${mode}: emitted metric agrees with full-stream bin and neutral control`, async () => {
      for (const seed of SEEDS) {
        const observations = [];
        for (const treatment of [false, true]) {
          const before = new Map();
          const config = configFor(seed);
          let ordinal = 0;
          config.hook = (records, type) => {
            if (type !== 'everything') return records;
            ordinal++;
            const firstDay = Math.min(...records.map(event => Math.floor(Date.parse(event.time) / DAY)));
            for (const event of records) {
              const time = Date.parse(event.time);
              event.time = new Date(Math.min(time, Math.floor(time / DAY) * DAY + DAY - 120000,
                Date.parse(config.datasetEnd) - 120000)).toISOString();
              if (ordinal % 2 === 0 && event.event === 'Search') event.time = new Date(firstDay * DAY + 43200000).toISOString();
            }
            const uid = records.find(event => event.user_id)?.user_id;
            before.set(uid, snapshot(records));
            const factor = treatment ? 2 : 1;
            const binBy = mode.endsWith('events') ? 'events' : 'distinctDays';
            const bins = { low: [0, 4], high: [4, Infinity] };
            if (mode.startsWith('aggregate')) applyAggregateByBin(records, {}, {
              cohortEvent: 'Search', bins, event: 'Browse', propertyName: 'amount',
              deltas: { low: 1, high: factor }, binBy });
            if (mode.startsWith('frequency')) applyFrequencyByFrequency(records, {}, {
              cohortEvent: 'Search', bins, targetEvent: 'Browse',
              multipliers: { low: 1, high: factor }, binBy });
            if (mode === 'scale-count') scaleEventCount(records, 'Browse', factor);
            if (mode === 'scale-value') scalePropertyValue(records, event => event.event === 'Browse', 'amount', factor);
            return records;
          };
          const sample = await runFixture(config);
          integrity(sample.events);
          let eligible = 0;
          let divergentAxes = 0;
          let affected = 0;
          let metricBefore = 0;
          let metricAfter = 0;
          for (const [uid, events] of streams(sample.events)) {
            const original = before.get(uid);
            const final = snapshot(events);
            if (!original.browse) continue;
            eligible++;
            if ((original.search >= 4) !== (original.cohortDays >= 4)) divergentAxes++;
            const high = mode.endsWith('events') ? original.search >= 4 : original.cohortDays >= 4;
            const factor = treatment && (mode.startsWith('scale') || high) ? 2 : 1;
            if (factor === 2) affected++;
            const volume = mode.startsWith('frequency') || mode === 'scale-count';
            expect(final.browse).toBe(original.browse * (volume ? factor : 1));
            expect(final.sum).toBe(original.sum * factor);
            expect(final.search).toBe(original.search);
            expect(final.help).toBe(original.help);
            expect(final.days).toBe(original.days);
            metricBefore += volume ? original.browse : original.sum;
            metricAfter += volume ? final.browse : final.sum;
          }
          expect(eligible).toBeGreaterThanOrEqual(100);
          if (mode.includes('-days') || mode.includes('-events')) expect(divergentAxes).toBeGreaterThanOrEqual(10);
          if (treatment) expect(affected).toBeGreaterThanOrEqual(60);
          else expect(metricAfter / metricBefore).toBe(1);
          observations.push({ treatment, eligible, affected, divergentAxes, metricBefore, metricAfter,
            ratio: metricAfter / metricBefore, events: sample.events.length });
        }
        console.log('HELPERS_METRIC', JSON.stringify({ mode, seed, observations }));
      }
    }, 90000);
  }
});