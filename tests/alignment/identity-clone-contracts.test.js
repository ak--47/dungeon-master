import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { engineIdentity } from '../../lib/generators/events.js';
import { amplifyWorldEvents } from '../../lib/orchestrators/user-loop.js';
import { makeFixture, runFixture } from './fixtures.mjs';

function cloneConfig(mode) {
  const config = makeFixture('alignment-generated-17', 'mixed', 1);
  config.numEvents = 30;
  config.avgEventsPerUserPerDay = 1;
  config.identity = { avgDevicePerUser: 1 };
  config.events[1].isAuthEvent = true;
  config.funnels[0].conversionRate = 100;
  config.retentionCurve = { day1: 1, day30: 1 };
  if (mode === 'data-quality') config.dataQuality = { duplicateRate: 1 };
  if (mode === 'world') config.worldEvents = [{ name: 'usage surge', startDay: 0,
    duration: 31, affectsEvents: ['Repeat Entry'], volumeMultiplier: 2 }];
  return config;
}

describe.sequential('engine clone identity contracts', () => {
  for (const mode of ['data-quality', 'world']) {
    it(`${mode} repairs originals and engine clones after auth removal`, async () => {
      const config = cloneConfig(mode);
      const originalIds = new Set();
      const cloneIds = new Set();
      config.hook = (records, type) => {
        if (type === 'event') originalIds.add(records.insert_id);
        if (type !== 'everything') return records;
        for (const event of records) {
          if (event.event === 'Repeat Entry' && !originalIds.has(event.insert_id)) cloneIds.add(event.insert_id);
        }
        return records.filter(event => event.event !== 'First Success');
      };
      const { events, profiles } = await runFixture(config);
      const usage = events.filter(event => event.event === 'Repeat Entry');
      const originals = usage.filter(event => originalIds.has(event.insert_id));
      const clones = usage.filter(event => cloneIds.has(event.insert_id));
      expect(originals.length).toBeGreaterThan(0);
      expect(clones.length).toBeGreaterThan(0);
      expect(events.some(event => event.event === 'First Success')).toBe(false);
      expect(originals.every(event => !event.user_id && event.device_id)).toBe(true);
      expect(clones.filter(event => event.user_id).map(event => ({ event: event.event,
        user_id: event.user_id, device_id: event.device_id }))).toEqual([]);
      expect(clones.every(event => event.device_id)).toBe(true);
      expect(new Set(events.map(event => event.insert_id)).size).toBe(events.length);
      expect(profiles.every(profile => profile._drop)).toBe(true);
      for (const event of clones) {
        expect(Object.getOwnPropertyDescriptor(event, engineIdentity)?.enumerable).toBe(false);
        expect(Object.getOwnPropertySymbols({ ...event })).toEqual([]);
        expect(JSON.stringify(event)).not.toContain('engineIdentity');
      }
    });

    for (const hookType of ['event', 'funnel-post', 'everything']) {
      it(`${mode} preserves explicit ${hookType} identity on engine clones`, async () => {
        const config = cloneConfig(mode);
        const originalIds = new Set();
        config.hook = (records, type) => {
          if (type === 'event') originalIds.add(records.insert_id);
          if (type === hookType) {
            for (const event of Array.isArray(records) ? records : [records]) {
              if (event.event === 'Repeat Entry') {
                event.user_id = 'explicit-hook-user';
                delete event.device_id;
              }
            }
          }
          return type === 'everything' ? records.filter(event => event.event !== 'First Success') : records;
        };
        const { events } = await runFixture(config);
        const clones = events.filter(event => event.event === 'Repeat Entry' && !originalIds.has(event.insert_id));
        expect(clones.length).toBeGreaterThan(0);
        expect(clones.every(event => event.user_id === 'explicit-hook-user' && !event.device_id)).toBe(true);
      });
    }

    it(`${mode} leaves a fresh hook clone outside engine ownership`, async () => {
      const config = cloneConfig(mode);
      let hookClone;
      config.hook = (records, type) => {
        if (type !== 'everything') return records;
        const source = records.find(event => event.event === 'Repeat Entry');
        hookClone = { ...source, insert_id: randomUUID() };
        return [...records.filter(event => event.event !== 'First Success'), hookClone];
      };
      const { events } = await runFixture(config);
      const emitted = events.find(event => event.insert_id === hookClone.insert_id);
      expect(emitted).toBeDefined();
      expect(emitted.user_id).toBe(hookClone.user_id);
      expect(emitted.user_id).toBeTruthy();
      expect(emitted[engineIdentity]).toBeUndefined();
    });
  }

  it('does not claim unmarked hook input when world amplification clones it', () => {
    const source = { event: 'Usage', time: '2025-01-02T00:00:00.000Z',
      insert_id: 'hook-input', user_id: 'hook-user' };
    const startUnix = Date.parse('2025-01-01T00:00:00Z') / 1000;
    const endUnix = Date.parse('2025-01-03T00:00:00Z') / 1000;
    const output = amplifyWorldEvents([source], [{ startUnix, endUnix,
      affectsEvents: '*', volumeMultiplier: 2 }], { integer: ({ min }) => min }, endUnix);
    expect(output).toHaveLength(2);
    expect(output[1].user_id).toBe('hook-user');
    expect(output[1][engineIdentity]).toBeUndefined();
    expect(output[1].insert_id).not.toBe(source.insert_id);
  });

  it('accepts a later ordinary both-ID Login after first-funnel auth removal', async () => {
    const config = cloneConfig('none');
    config.events.find(event => event.event === 'Repeat Entry').event = 'Login';
    config.events.find(event => event.event === 'Login').isAuthEvent = true;
    config.funnels[1].sequence[0] = 'Login';
    config.hook = (records, type) => type === 'everything'
      ? records.filter(event => event.event !== 'First Success') : records;
    const { events, profiles } = await runFixture(config);
    const login = events.find(event => event.event === 'Login' && event.user_id && event.device_id);
    expect(login).toBeDefined();
    const earlier = events.filter(event => Date.parse(event.time) < Date.parse(login.time));
    const later = events.filter(event => Date.parse(event.time) > Date.parse(login.time));
    expect(earlier.length).toBeGreaterThan(0);
    expect(earlier.every(event => !event.user_id && event.device_id)).toBe(true);
    expect(later.some(event => event.user_id === login.user_id)).toBe(true);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]._drop).not.toBe(true);
  });
});