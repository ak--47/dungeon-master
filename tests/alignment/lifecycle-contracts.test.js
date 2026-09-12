import { describe, expect, it } from 'vitest';
import { makeFixture, runFixture } from './fixtures.mjs';

function configFor(users = 1) {
  const config = makeFixture('alignment-generated-17');
  config.numUsers = users;
  config.numEvents = users * 30;
  config.avgEventsPerUserPerDay = 1;
  return config;
}

describe.sequential('lifecycle chronology contracts', () => {
  it('fails explicitly when a first funnel cannot fit its lifecycle', async () => {
    const config = configFor();
    config.funnels[0].conversionRate = 100;
    config.hook = (records, type, meta) => {
      if (type === 'funnel-pre' && meta.isFirstFunnel) records.timeToConvert = 10000;
      return records;
    };
    await expect(runFixture(config)).rejects.toThrow(/Lifecycle capacity/);
  });

  it('fails explicitly when promised failed priors have no pre-auth step', async () => {
    const config = configFor();
    config.events[0].isAuthEvent = true;
    config.identity = { avgDevicePerUser: 1 };
    config.funnels[0].attempts = { min: 2, max: 2, conversionRate: 100 };
    await expect(runFixture(config)).rejects.toThrow(/Lifecycle capacity.*promised/);
  });

  it('keeps born users user-only when devices are disabled', async () => {
    const config = configFor(10);
    config.events[1].isAuthEvent = true;
    config.identity = { avgDevicePerUser: 0 };
    const { events } = await runFixture(config);
    expect(events.length).toBeGreaterThan(10);
    expect(events.every(event => event.user_id && !event.device_id)).toBe(true);
  });

  it('rejects a strict event budget that cannot keep promised attempts', async () => {
    const config = configFor();
    config.numEvents = 1;
    delete config.avgEventsPerUserPerDay;
    config.strictEventCount = true;
    config.events[1].isAuthEvent = true;
    config.funnels[0].attempts = { min: 2, max: 2, conversionRate: 100 };
    await expect(runFixture(config)).rejects.toThrow(/Lifecycle capacity.*promised/);
  });

  for (const mutation of ['remove-auth', 'move-usage-before-auth', 'clip-auth']) {
    it(`reconciles final identity after ${mutation}`, async () => {
      const config = configFor();
      config.identity = { avgDevicePerUser: 1 };
      config.events[1].isAuthEvent = true;
      config.funnels[0].conversionRate = 100;
      config.retentionCurve = { day1: 1, day30: 1 };
      let changedId;
      let changedTime;
      config.hook = (records, type) => {
        if (type !== 'everything') return records;
        const auth = records.find(event => event.event === 'First Success');
        if (mutation === 'remove-auth') return records.filter(event => event !== auth);
        if (mutation === 'clip-auth') auth.time = '2025-02-01T00:00:00.000Z';
        if (mutation === 'move-usage-before-auth') {
          const usage = records.find(event => event.event === 'Repeat Entry');
          usage.time = new Date(Date.parse(auth.time) - 1).toISOString();
          changedId = usage.insert_id;
          changedTime = usage.time;
        }
        return records;
      };
      const { events } = await runFixture(config);
      if (mutation === 'move-usage-before-auth') {
        const changed = events.find(event => event.insert_id === changedId);
        expect(changed.time).toBe(changedTime);
        expect(changed.user_id).toBeUndefined();
        expect(changed.device_id).toBeTruthy();
      } else {
        expect(events.some(event => event.event === 'First Success')).toBe(false);
        expect(events.every(event => !event.user_id && event.device_id)).toBe(true);
      }
    });
  }

  it('preserves seeded generation after stripping insert_id', async () => {
    const run = async () => {
      const config = configFor(10);
      config.identity = { avgDevicePerUser: 4 };
      config.events[1].isAuthEvent = true;
      config.funnels[0].attempts = { min: 2, max: 2, conversionRate: 70 };
      config.retentionCurve = { day1: 0.9, day7: 0.8, day30: 0.6 };
      const { events } = await runFixture(config);
      return events.map(({ insert_id, ...event }) => event);
    };
    expect(await run()).toEqual(await run());
  });

  it('anchors observed retention birth to creation and usage after onboarding', async () => {
    const config = configFor();
    config.retentionCurve = { day1: 1, day30: 1 };
    config.funnels[0].conversionRate = 100;
    let created;
    config.hook = (records, type, meta) => {
      if (type === 'funnel-pre' && meta.isFirstFunnel) created = Date.parse(meta.user.created);
      return records;
    };
    const { events } = await runFixture(config);
    const entry = events.find(event => event.event === 'First Entry');
    const success = events.find(event => event.event === 'First Success');
    expect(Date.parse(entry.time)).toBe(created);
    expect(events.filter(event => !['First Entry', 'First Success'].includes(event.event))
      .every(event => Date.parse(event.time) > Date.parse(success.time))).toBe(true);
  });

  it('emits every promised retry and no chronological pre-auth user identity', async () => {
    const config = configFor(40);
    config.identity = { avgDevicePerUser: 4 };
    config.events[1].isAuthEvent = true;
    config.funnels[0].attempts = { min: 2, max: 2, conversionRate: 70 };
    const owners = new Map();
    const attempts = new Map();
    config.hook = (records, type, meta) => {
      if (type === 'everything') for (const event of records) owners.set(event.insert_id, meta.profile.distinct_id);
      if (type === 'funnel-post' && meta.isFirstFunnel) {
        if (!attempts.has(meta.profile.distinct_id)) attempts.set(meta.profile.distinct_id, []);
        attempts.get(meta.profile.distinct_id).push(records.map(event => ({ id: event.insert_id, time: Date.parse(event.time) })));
      }
      return records;
    };
    const { events } = await runFixture(config);
    for (const owner of new Set(owners.values())) {
      const stream = events.filter(event => owners.get(event.insert_id) === owner);
      const priors = attempts.get(owner);
      expect(priors).toHaveLength(3);
      for (let index = 1; index < priors.length; index++) {
        expect(Math.min(...priors[index].map(event => event.time)))
          .toBeGreaterThan(Math.max(...priors[index - 1].map(event => event.time)));
      }
      const firstIds = new Set(priors.flat().map(event => event.id));
      const completed = Math.max(...priors.flat().map(event => event.time));
      expect(stream.filter(event => !firstIds.has(event.insert_id)).every(event => Date.parse(event.time) > completed)).toBe(true);
      expect(stream.every(event => Date.parse(event.time) >= Date.parse(config.datasetStart) &&
        Date.parse(event.time) <= Date.parse(config.datasetEnd))).toBe(true);
      expect(stream.filter(event => event.event === 'First Entry')).toHaveLength(3);
      const auth = stream.find(event => event.event === 'First Success');
      const anonymous = stream.filter(event => !auth || Date.parse(event.time) < Date.parse(auth.time));
      expect(anonymous.every(event => !event.user_id && event.device_id)).toBe(true);
    }
  });
});