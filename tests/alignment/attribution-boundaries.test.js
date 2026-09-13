import { describe, expect, test } from 'vitest';
import { emulateBreakdown } from '../../lib/verify/emulate-breakdown.js';

const START = Date.UTC(2024, 0, 15, 10);
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const CONFIG = {
  type: 'attributedBy',
  conversionEvent: 'Buy',
  attributionEvent: 'Ad Click',
  attributionProperty: 'utm_source',
};
const touch = (time, source, userId = 'u1') => ({
  event: 'Ad Click', time, user_id: userId, utm_source: source,
});
const buy = (time, userId = 'u1') => ({ event: 'Buy', time, user_id: userId });
const unstamped = time => ({ event: 'Ad Click', time, user_id: 'u1' });

/*
 * Source: analytics@717286d2d3ed03e9e3f9cb4346e4c6b2e561fb9a.
 * whoval/read.cpp first/last use inclusive timestamps and LIMIT 1.
 * util/behaviors/attribution.py filters for defined properties, excluding null.
 * Expected counts are hand-computed. This covers the existing unbounded model,
 * not finite lookback parity: the public emulator has no lookback option.
 * Keep attribution_value: 'unknown' for unmatched conversions. General breakdown
 * coercion's 'undefined' marker does not replace this existing attribution label.
 */
describe('attribution source boundaries', () => {
  test.each(['firstTouch', 'lastTouch'])('%s ignores absent, undefined and null touches around a valid touch', model => {
    const events = [
      unstamped(START),
      touch(START + MINUTE, null),
      touch(START + 2 * MINUTE, undefined),
      touch(START + 3 * MINUTE, 'google'),
      unstamped(START + 4 * MINUTE),
      touch(START + 5 * MINUTE, null),
      touch(START + 6 * MINUTE, undefined),
      buy(START + 7 * MINUTE),
    ];
    expect(emulateBreakdown(events, { ...CONFIG, model })).toEqual([
      { attribution_value: 'google', conversions: 1 },
    ]);
  });

  test.each(['firstTouch', 'lastTouch'])('%s retains a touchless conversion as unknown', model => {
    expect(emulateBreakdown([buy(START)], { ...CONFIG, model })).toEqual([
      { attribution_value: 'unknown', conversions: 1 },
    ]);
  });

  test.each(['firstTouch', 'lastTouch'])('%s retains a conversion with only undefined or null touches', model => {
    expect(emulateBreakdown([
      unstamped(START),
      touch(START + MINUTE, null),
      touch(START + 2 * MINUTE, undefined),
      buy(START + 3 * MINUTE),
    ], { ...CONFIG, model })).toEqual([
      { attribution_value: 'unknown', conversions: 1 },
    ]);
  });

  test.each(['firstTouch', 'lastTouch'])('%s includes a same-ms touch even when the conversion appears first', model => {
    expect(emulateBreakdown([
      buy(START),
      touch(START, 'same-ms'),
      touch(START + 1, 'future'),
    ], { ...CONFIG, model })).toEqual([
      { attribution_value: 'same-ms', conversions: 1 },
    ]);
  });

  test.each(['firstTouch', 'lastTouch'])('%s excludes touches after the conversion', model => {
    expect(emulateBreakdown([
      touch(START + 1, 'future'),
      buy(START),
    ], { ...CONFIG, model })).toEqual([
      { attribution_value: 'unknown', conversions: 1 },
    ]);
  });

  test.each(['', false, 0])('defined falsy source %j keeps its existing raw output value', source => {
    expect(emulateBreakdown([
      touch(START, source),
      touch(START + MINUTE, null),
      buy(START + 2 * MINUTE),
    ], { ...CONFIG, model: 'lastTouch' })).toEqual([
      { attribution_value: source, conversions: 1 },
    ]);
  });

  test('default first conversion stays unknown even when a later conversion has a touch', () => {
    expect(emulateBreakdown([
      buy(START),
      touch(START + MINUTE, 'google'),
      buy(START + 2 * MINUTE),
    ], CONFIG)).toEqual([
      { attribution_value: 'unknown', conversions: 1 },
    ]);
  });

  test('default firstTouch selects the earliest of multiple touches before the first conversion', () => {
    expect(emulateBreakdown([
      touch(START, 'earliest'),
      touch(START + MINUTE, 'latest'),
      buy(START + 2 * MINUTE),
      buy(START + 3 * MINUTE),
    ], CONFIG)).toEqual([
      { attribution_value: 'earliest', conversions: 1 },
    ]);
  });

  test.each([
    ['firstTouch', 'google'],
    ['lastTouch', 'bing'],
  ])('%s is unchanged by exact repeated values in an unbounded history', (model, source) => {
    expect(emulateBreakdown([
      touch(START, 'google'),
      touch(START + MINUTE, 'google'),
      touch(START + 2 * MINUTE, 'bing'),
      touch(START + 3 * MINUTE, 'bing'),
      buy(START + 4 * MINUTE),
    ], { ...CONFIG, model })).toEqual([
      { attribution_value: source, conversions: 1 },
    ]);
  });
});

describe('existing per-conversion fixtures', () => {
  const twoConversions = [
    touch(START, 'google'),
    buy(START + MINUTE),
    touch(START + 2 * MINUTE, 'facebook'),
    buy(START + 3 * MINUTE),
  ];

  test('default model and perConversion still select first touch for the first conversion', () => {
    expect(emulateBreakdown(twoConversions, CONFIG)).toEqual([
      { attribution_value: 'google', conversions: 1 },
    ]);
  });

  test('all plus firstTouch credits the earliest touch for every conversion', () => {
    expect(emulateBreakdown(twoConversions, { ...CONFIG, model: 'firstTouch', perConversion: 'all' })).toEqual([
      { attribution_value: 'google', conversions: 2 },
    ]);
  });

  test('all plus lastTouch credits each conversion with its latest touch', () => {
    expect(emulateBreakdown(twoConversions, { ...CONFIG, model: 'lastTouch', perConversion: 'all' })).toEqual([
      { attribution_value: 'google', conversions: 1 },
      { attribution_value: 'facebook', conversions: 1 },
    ]);
  });

  test('firstTouch has no ten-touch cap', () => {
    const events = Array.from({ length: 12 }, (_, index) => touch(START + index * MINUTE, `src${index}`));
    events.push(buy(START + 12 * MINUTE), touch(START + 13 * MINUTE, 'src12'), buy(START + 14 * MINUTE));
    expect(emulateBreakdown(events, { ...CONFIG, model: 'firstTouch', perConversion: 'all' })).toEqual([
      { attribution_value: 'src0', conversions: 2 },
    ]);
  });

  test('lastTouch has no ten-touch cap', () => {
    const events = Array.from({ length: 12 }, (_, index) => touch(START + index * MINUTE, `src${index}`));
    events.push(buy(START + 12 * MINUTE));
    expect(emulateBreakdown(events, { ...CONFIG, model: 'lastTouch', perConversion: 'all' })).toEqual([
      { attribution_value: 'src11', conversions: 1 },
    ]);
  });

  test('all retains the formerly dropped conversion and includes the same-ms touch', () => {
    expect(emulateBreakdown([
      buy(START, 'u1'),
      touch(START + MINUTE, 'google', 'u1'),
      buy(START + 2 * MINUTE, 'u1'),
      touch(START + 5 * MINUTE, 'bing', 'u2'),
      buy(START + 5 * MINUTE, 'u2'),
    ], { ...CONFIG, model: 'firstTouch', perConversion: 'all' })).toEqual([
      { attribution_value: 'unknown', conversions: 1 },
      { attribution_value: 'google', conversions: 1 },
      { attribution_value: 'bing', conversions: 1 },
    ]);
  });

  test('unknown perConversion still throws', () => {
    expect(() => emulateBreakdown([], { ...CONFIG, perConversion: 'every' })).toThrow(/perConversion/);
  });
});

describe('attribution conversion buckets', () => {
  test.each(['firstTouch', 'lastTouch'])('%s retains pre-report touches and the full-stream identity map', model => {
    const events = [
      { event: 'Ad Click', time: START, device_id: 'device', utm_source: 'google' },
      { event: 'Identify', time: START + MINUTE, device_id: 'device', user_id: 'u1' },
      buy(START + DAY),
      buy(START + 2 * DAY),
    ];
    expect(emulateBreakdown(events, {
      ...CONFIG, model, timeBucket: 'day',
      timeBucketRange: { from: START + DAY, to: START + 3 * DAY },
    })).toEqual([
      { period: '2024-01-16', attribution_value: 'google', conversions: 1 },
      { period: '2024-01-17', attribution_value: 'google', conversions: 1 },
      { period: '2024-01-18', _empty: true },
    ]);
  });

  test.each([
    ['first', 1],
    ['all', 2],
  ])('%s partitions conversions before applying the per-user conversion limit', (perConversion, conversions) => {
    expect(emulateBreakdown([
      touch(START, 'google'),
      buy(START + MINUTE),
      buy(START + DAY),
      buy(START + DAY + MINUTE),
      buy(START + 2 * DAY),
    ], {
      ...CONFIG, perConversion, timeBucket: 'day',
      timeBucketRange: { from: START + DAY, to: START + DAY },
    })).toEqual([
      { period: '2024-01-15', attribution_value: 'google', conversions: 1 },
      { period: '2024-01-16', attribution_value: 'google', conversions },
      { period: '2024-01-17', attribution_value: 'google', conversions: 1 },
    ]);
  });

  test('conversion buckets are half-open and same-ms touches remain inclusive', () => {
    const midnight = Date.UTC(2024, 0, 16);
    expect(emulateBreakdown([
      touch(midnight - MINUTE, 'earlier'),
      buy(midnight - 1),
      buy(midnight),
      touch(midnight, 'boundary'),
      touch(midnight + 1, 'future'),
    ], { ...CONFIG, model: 'lastTouch', perConversion: 'all', timeBucket: 'day' })).toEqual([
      { period: '2024-01-15', attribution_value: 'earlier', conversions: 1 },
      { period: '2024-01-16', attribution_value: 'boundary', conversions: 1 },
    ]);
  });

  test.each([
    ['week', START + 7 * DAY, '2024-W04'],
    ['month', Date.UTC(2024, 1, 15, 10), '2024-02'],
  ])('%s buckets retain earlier history without emitting touch-only periods', (timeBucket, conversionTime, period) => {
    expect(emulateBreakdown([
      touch(START, 'google'),
      buy(conversionTime),
    ], { ...CONFIG, timeBucket })).toEqual([
      { period, attribution_value: 'google', conversions: 1 },
    ]);
  });
});