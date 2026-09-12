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
    config.hook = (records, type, meta) => {
      if (type === 'everything') for (const event of records) owners.set(event.insert_id, meta.profile.distinct_id);
      return records;
    };
    const { events } = await runFixture(config);
    for (const owner of new Set(owners.values())) {
      const stream = events.filter(event => owners.get(event.insert_id) === owner);
      expect(stream.filter(event => event.event === 'First Entry')).toHaveLength(3);
      const auth = stream.find(event => event.event === 'First Success');
      const anonymous = stream.filter(event => !auth || Date.parse(event.time) < Date.parse(auth.time));
      expect(anonymous.every(event => !event.user_id && event.device_id)).toBe(true);
    }
  });
});