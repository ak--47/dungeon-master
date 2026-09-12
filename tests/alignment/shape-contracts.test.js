import { beforeEach, describe, expect, it } from 'vitest';
import { applyPathBias, applySessionShape } from '../../lib/hook-helpers/shape.js';
import { initChance } from '../../lib/utils/utils.js';
import { extractFlows } from '../../lib/verify/flows.js';
import { makeFixture, runFixture, SEEDS } from './fixtures.mjs';

const MINUTE = 60000;
const DAY = 86400000;
const START = Date.parse('2025-01-01T00:00:00Z');
const iso = time => new Date(time).toISOString();
const record = (time, index, event = 'Browse') => ({
  event, time: iso(time), user_id: 'shape-user', insert_id: `original-${index}`, amount: index,
});

function partition(events) {
  const result = [];
  for (const event of [...events].sort((left, right) => Date.parse(left.time) - Date.parse(right.time))) {
    const current = result.at(-1);
    const time = Date.parse(event.time);
    if (!current || time - Date.parse(current.at(-1).time) > 30 * MINUTE ||
      Math.floor(time / DAY) !== Math.floor(Date.parse(current[0].time) / DAY)) result.push([event]);
    else current.push(event);
  }
  return result;
}

beforeEach(() => initChance('shape-contracts'));

describe.sequential('session shape boundary contracts', () => {
  it('preserves legacy full-day placement for a short noon stream without bounds', () => {
    const events = [record(START + 12 * 60 * MINUTE, 0), record(START + (12 * 60 + 20) * MINUTE, 1)];
    const originals = [...events];
    expect(() => applySessionShape(events, 'shape-user', {
      sessionsPerWeek: 2, eventsPerSession: 1, sessionMinutes: 5,
    })).not.toThrow();
    expect(events).toHaveLength(2);
    expect(events.every((event, index) => event === originals[index])).toBe(true);
    expect(events.every(event => Date.parse(event.time) >= START && Date.parse(event.time) < START + DAY)).toBe(true);
    expect(partition(events)).toHaveLength(2);
  });

  it('keeps legacy overfull-day requests nonthrowing without bounds', () => {
    const events = Array.from({ length: 60 }, (_, index) => record(START + 12 * 60 * MINUTE + index * 1000, index));
    const before = events.map(({ time, ...event }) => event);
    expect(() => applySessionShape(events, 'shape-user', {
      sessionsPerWeek: 60, eventsPerSession: 1, sessionMinutes: 5,
    })).not.toThrow();
    expect(events.map(({ time, ...event }) => event)).toEqual(before);
    expect(events.every(event => Date.parse(event.time) >= START && Date.parse(event.time) < START + DAY)).toBe(true);
  });

  it('retains the exact stream at an inclusive midnight endpoint', () => {
    const events = [record(START + DAY / 2, 0), record(START + DAY, 1)];
    const originals = [...events];
    const out = applySessionShape(events, 'shape-user', {
      sessionsPerWeek: 2, eventsPerSession: 1, sessionMinutes: 10,
      datasetStart: START + DAY / 2, datasetEnd: START + DAY,
    });
    expect(out).toBe(events);
    expect(out).toHaveLength(2);
    expect(out.every((event, index) => event === originals[index])).toBe(true);
    expect(out.every(event => Date.parse(event.time) >= START + DAY / 2 && Date.parse(event.time) <= START + DAY)).toBe(true);
    expect(partition(out)).toHaveLength(2);
  });

  it('honors an explicit partial-day window using hook-style unix seconds', () => {
    const end = START + DAY + 5 * MINUTE;
    const events = [record(START + DAY / 2, 0), record(end, 1)];
    applySessionShape(events, 'shape-user', {
      sessionsPerWeek: 2, eventsPerSession: 1, sessionMinutes: 10,
      datasetStart: (START + DAY / 2) / 1000, datasetEnd: end / 1000,
    });
    expect(events.every(event => Date.parse(event.time) >= START + DAY / 2 && Date.parse(event.time) <= end)).toBe(true);
    expect(partition(events)).toHaveLength(2);
  });

  it('reports impossible timeout capacity without mutating or losing records', () => {
    const events = [record(START, 0), record(START + 20 * MINUTE, 1)];
    const before = structuredClone(events);
    expect(() => applySessionShape(events, 'shape-user', {
      sessionsPerWeek: 2, eventsPerSession: 1, sessionMinutes: 10,
      datasetStart: START, datasetEnd: START + 20 * MINUTE,
    })).toThrow(/capacity/i);
    expect(events).toEqual(before);
  });

  it('distinguishes exactly 30 minutes from enough capacity for two sessions', () => {
    for (const extra of [0, 1]) {
      const events = [record(START, 0), record(START + 30 * MINUTE + extra, 1)];
      const shape = () => applySessionShape(events, 'shape-user', {
        sessionsPerWeek: 2, eventsPerSession: 1, sessionMinutes: 10,
        datasetStart: START, datasetEnd: START + 30 * MINUTE + extra,
      });
      if (!extra) expect(shape).toThrow(/capacity/i);
      else {
        shape();
        expect(partition(events)).toHaveLength(2);
        expect(events.map(event => Date.parse(event.time))).toEqual([START, START + 30 * MINUTE + 1]);
      }
    }
  });

  it('fits dense same-day clusters without merging or changing non-time fields', () => {
    for (const sessionCount of [2, 8, 24, 48]) {
      const events = Array.from({ length: sessionCount * 3 }, (_, index) =>
        record(START + index * (DAY - 1) / (sessionCount * 3 - 1), index));
      const before = events.map(({ time, ...event }) => event);
      applySessionShape(events, 'shape-user', {
        sessionsPerWeek: sessionCount, eventsPerSession: 3, sessionMinutes: 120,
        datasetStart: START, datasetEnd: START + DAY - 1,
      });
      expect(events.map(({ time, ...event }) => event)).toEqual(before);
      const sessions = partition(events);
      expect(sessions).toHaveLength(sessionCount);
      for (const session of sessions) {
        expect(session).toHaveLength(3);
        expect(Date.parse(session.at(-1).time) - Date.parse(session[0].time)).toBeLessThanOrEqual(120 * MINUTE);
      }
      expect(events.every(event => Date.parse(event.time) >= START && Date.parse(event.time) < START + DAY)).toBe(true);
    }
  });

  it('rejects invalid bounds atomically and leaves untimed records alone', () => {
    const events = [record(START, 0), record(START + DAY, 1), { event: 'Untimed' }];
    const before = structuredClone(events);
    for (const bounds of [{ datasetEnd: 'invalid' }, { datasetStart: START + DAY, datasetEnd: START }]) {
      expect(() => applySessionShape(events, 'shape-user', {
        sessionsPerWeek: 1, eventsPerSession: 3, sessionMinutes: 10, ...bounds,
      })).toThrow(RangeError);
      expect(events).toEqual(before);
    }
    applySessionShape(events, 'shape-user', { sessionsPerWeek: 1, eventsPerSession: 3, sessionMinutes: 10 });
    expect(events.at(-1)).toEqual({ event: 'Untimed' });
    expect(events).toHaveLength(3);
  });

  for (const ending of ['2025-01-31T00:00:00Z', '2025-01-31T00:05:00Z']) {
    it(`generated stream preserves every record and exact sessions through ${ending}`, async () => {
      for (const seed of SEEDS) {
        const config = makeFixture(seed);
        Object.assign(config, { numUsers: 120, numEvents: 3600, percentUsersBornInDataset: 0, datasetEnd: ending });
        const before = new Map();
        config.hook = (events, type, meta) => {
          if (type !== 'everything' || !events.length) return events;
          const times = events.map(event => Date.parse(event.time));
          const uid = meta.profile.distinct_id;
          before.set(uid, {
            ids: events.map(event => event.insert_id).sort(),
            payload: events.map(({ time, session_id, ...event }) => event).sort((left, right) => left.insert_id.localeCompare(right.insert_id)),
            target: Math.min(2 * Math.max(1, Math.ceil((Math.max(...times) - Math.min(...times) + 1) / (7 * DAY))),
              Math.ceil(events.length / 3)),
          });
          return applySessionShape(events, uid, {
            sessionsPerWeek: 2, eventsPerSession: 3, sessionMinutes: 10,
            datasetStart: meta.datasetStart, datasetEnd: meta.datasetEnd,
          });
        };
        const sample = await runFixture(config);
        const byUser = new Map();
        for (const event of sample.events) {
          expect(Date.parse(event.time)).toBeGreaterThanOrEqual(Date.parse(config.datasetStart));
          expect(Date.parse(event.time)).toBeLessThanOrEqual(Date.parse(ending));
          if (!byUser.has(event.user_id)) byUser.set(event.user_id, []);
          byUser.get(event.user_id).push(event);
        }
        expect(byUser.size).toBe(before.size);
        expect(byUser.size).toBeGreaterThanOrEqual(100);
        for (const [uid, original] of before) {
          const events = byUser.get(uid);
          expect(events.map(event => event.insert_id).sort()).toEqual(original.ids);
          expect(events.map(({ time, session_id, ...event }) => event)
            .sort((left, right) => left.insert_id.localeCompare(right.insert_id))).toEqual(original.payload);
          const sessions = partition(events);
          expect(sessions).toHaveLength(original.target);
          expect(new Set(events.map(event => event.session_id)).size).toBe(original.target);
          for (const session of sessions) expect(new Set(session.map(event => event.session_id)).size).toBe(1);
        }
        console.log('SHAPE_BOUNDARY', JSON.stringify({ seed, ending, users: byUser.size, events: sample.events.length, lost: 0 }));
      }
    }, 90000);
  }
});

describe.sequential('append-only first-anchor Flows contracts', () => {
  const options = { anchor: 'Browse', path: ['Search', 'Help'], share: 1, gapSeconds: [2, 2] };
  const labels = events => extractFlows(events, { anchors: ['Browse'], forward: 2, countType: 'unique', collapseRepeated: false })
    .map(flow => flow.steps.map(step => step.label));

  it('anchors on the first chronological occurrence and preserves intervening traffic', () => {
    const events = [record(START + DAY, 0), record(START, 1), record(START + 1000, 2, 'Other'),
      record(START + MINUTE, 3, 'Search'), record(START + 2 * MINUTE, 4, 'Help')];
    const before = structuredClone(events);
    expect(applyPathBias(events, 'shape-user', options)).toBe(events);
    expect(events.slice(0, before.length)).toEqual(before);
    expect(events.slice(before.length).map(event => [event.event, Date.parse(event.time)]))
      .toEqual([['Search', START + 2000], ['Help', START + 4000]]);
    expect(new Set(events.map(event => event.insert_id)).size).toBe(events.length);
    expect(labels(events)).toEqual([['Browse', 'Other', 'Search']]);
  });

  it('materializes the complete first branch when its injection interval is clear', () => {
    const events = [record(START + DAY, 0), record(START, 1),
      record(START + MINUTE, 2, 'Search'), record(START + 2 * MINUTE, 3, 'Help')];
    applyPathBias(events, 'shape-user', options);
    expect(labels(events)).toEqual([['Browse', 'Search', 'Help']]);
  });

  it('increases measured first-flow branch share on generated competing traffic', async () => {
    for (const seed of SEEDS) {
      const config = makeFixture(seed);
      Object.assign(config, { numUsers: 300, numEvents: 9000, avgEventsPerUserPerDay: 1, percentUsersBornInDataset: 0 });
      let eligible = 0;
      let neutral = 0;
      const eligibleUsers = new Set();
      config.hook = (events, type, meta) => {
        if (type !== 'everything') return events;
        if (!['Browse', 'Search', 'Help'].every(name => events.some(event => event.event === name))) return events;
        eligible++;
        const uid = meta.profile.distinct_id;
        eligibleUsers.add(uid);
        if (labels(events)[0]?.join('>') === 'Browse>Search>Help') neutral++;
        return applyPathBias(events, uid, options);
      };
      const sample = await runFixture(config);
      const flows = extractFlows(sample.events, { anchors: ['Browse'], forward: 2, countType: 'unique', collapseRepeated: false });
      const treatment = flows.filter(flow => eligibleUsers.has(flow.userId) &&
        flow.steps.map(step => step.label).join('>') === 'Browse>Search>Help').length;
      expect(eligible).toBeGreaterThanOrEqual(100);
      expect(treatment / eligible).toBeGreaterThanOrEqual(neutral / eligible + 0.15);
      expect(treatment / eligible).toBeGreaterThanOrEqual(0.95);
      console.log('SHAPE_FLOWS', JSON.stringify({ seed, eligible, neutral, treatment }));
    }
  }, 90000);
});