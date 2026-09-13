import { describe, expect, it } from 'vitest';
import { evaluateFunnelHPC, resolveFunnelSegment } from '../../lib/verify/funnel-engine.js';
import { emulateBreakdown } from '../../lib/verify/emulate-breakdown.js';

const baseMs = Date.parse('2026-08-01T12:00:00.000Z');
const steps = ['Add to Bag', 'Checkout'];

function event(name, seconds, properties = {}) {
  return {
    event: name,
    time: new Date(baseMs + seconds * 1000).toISOString(),
    user_id: 'list-hpc-user',
    insert_id: `${name}-${seconds}`,
    ...properties,
  };
}

function jsonEvents(records) {
  return JSON.parse(JSON.stringify(records));
}

function partialOverlapEvents() {
  return jsonEvents([
    event('Add to Bag', 0, { cart: ['H', 'T'] }),
    event('Checkout', 20, { cart: ['H'] }),
  ]);
}

describe('list HPC: analytics 717286d2 test_funnel_aggregation_with_list_basic', () => {
  it('routes JSON-parsed list elements to independent scalar-keyed histories', () => {
    const events = partialOverlapEvents();
    const results = evaluateFunnelHPC(events, steps, 'cart');
    expect([...results].map(([value, result]) => [value, result.reached]))
      .toEqual([['H', 1], ['T', 0]]);
    expect(results.get('H').stepEvents).toEqual(events);
    expect(results.get('H').ttcSeconds).toBe(20);
  });

  it.each([
    ['uniques', [1, 1]],
    ['totals', [2, 1]],
  ])('reports %s from a generated-like JSON-list stream', (countMode, expected) => {
    const rows = emulateBreakdown(partialOverlapEvents(), {
      type: 'funnelFrequency',
      steps,
      breakdownByFrequencyOf: 'Add to Bag',
      holdPropertyConstant: 'cart',
      countMode,
    });
    expect(rows.map(row => row.conversions)).toEqual(expected);
    expect(rows.map(row => row.breakdown_freq)).toEqual([1, 1]);
  });
});

describe('duplicate cursor visits: aggregate.cpp:36, funnel_query.cpp:1257, history.cpp:387', () => {
  it('shares one history for duplicate labels in the basic source fixture', () => {
    const events = jsonEvents([
      event('Add to Bag', 0, { cart: ['H', 'H'] }),
      event('Checkout', 20, { cart: ['H', 'H'] }),
    ]);
    const results = evaluateFunnelHPC(events, steps, 'cart', { countMode: 'totals', reentry: true });
    expect([...results.keys()]).toEqual(['H']);
    expect(results.get('H').map(attempt => attempt.reached)).toEqual([1]);
  });

  it.each([
    [['H'], 'H', 0],
    [['H', 'H'], 'H', 1],
    [[7, '7'], '7', 1],
    [[null, 'undefined'], 'undefined', 1],
  ])('retains cursor visits for %j through repeated first-step selectors', (cart, key, reached) => {
    const events = jsonEvents([event('Add to Bag', 0, { cart })]);
    const result = evaluateFunnelHPC(events, ['Add to Bag', 'Add to Bag'], 'cart').get(key);
    expect(result.reached).toBe(reached);
    expect(result.stepEvents[0]).toBe(events[0]);
    if (reached === 1) expect(result.stepEvents[1]).toBe(events[0]);
  });

  it('retains duplicate visits on routed later steps', () => {
    const events = jsonEvents([
      event('Add to Bag', 0, { cart: ['H'] }),
      event('Checkout', 20, { cart: ['H', 'H'] }),
    ]);
    const result = evaluateFunnelHPC(events, ['Add to Bag', 'Checkout', 'Checkout'], 'cart').get('H');
    expect(result.reached).toBe(2);
    expect(result.stepEvents).toEqual([events[0], events[1], events[1]]);
    expect(result.ttcSeconds).toBe(20);
  });
});

describe('list HPC history isolation and existing engine contracts', () => {
  it('does not join pairwise overlaps into a value-changing completion', () => {
    const results = evaluateFunnelHPC(jsonEvents([
      event('Add to Bag', 0, { cart: ['H', 'T'] }),
      event('Checkout', 20, { cart: ['T', 'U'] }),
      event('Receipt', 40, { cart: ['H', 'U'] }),
    ]), [...steps, 'Receipt'], 'cart');
    expect([...results].map(([value, result]) => [value, result.reached]))
      .toEqual([['H', 0], ['T', 1]]);
    expect(results.has('U')).toBe(false);
  });

  it('accepts list reordering without treating the whole list as a key', () => {
    const results = evaluateFunnelHPC(jsonEvents([
      event('Add to Bag', 0, { cart: ['H', 'T'] }),
      event('Checkout', 20, { cart: ['T', 'H'] }),
    ]), steps, 'cart');
    expect([...results].map(([value, result]) => [value, result.reached]))
      .toEqual([['H', 1], ['T', 1]]);
  });

  it.each([
    { countMode: 'sessions' },
    { countMode: 'totals', woRepeat: true, conversionWindow: { unit: 'sessions', n: 1 } },
    { countMode: 'totals', reentry: true, conversionWindow: { unit: 'sessions', n: 1 } },
  ])('keeps full-stream session bridges and event identity: %j', (options) => {
    const events = jsonEvents([
      event('Add to Bag', 0, { cart: ['H'] }),
      event('Checkout', 1200, { cart: ['T'] }),
      event('Checkout', 2400, { cart: ['H'] }),
    ]);
    const attempts = evaluateFunnelHPC(events, steps, 'cart', options).get('H');
    expect(attempts.map(attempt => attempt.reached)).toEqual([1]);
    expect(attempts[0].stepEvents[1]).toBe(events[2]);
    expect(evaluateFunnelHPC([events[0], events[2]], steps, 'cart', options).get('H')[0].completed)
      .toBe(false);
    expect(evaluateFunnelHPC(events.slice(0, 2), steps, 'cart', options).get('H')[0].completed)
      .toBe(false);
  });

  it('retains shared-edge restart independently for each value', () => {
    const events = jsonEvents([
      event('Add to Bag', 0, { cart: ['H', 'T'] }),
      event('Checkout', 10, { cart: ['T', 'H'] }),
      event('Add to Bag', 20, { cart: ['H', 'T'] }),
      event('Checkout', 30, { cart: ['T', 'H'] }),
      event('Add to Bag', 40, { cart: ['H', 'T'] }),
    ]);
    const results = evaluateFunnelHPC(events, [...steps, 'Add to Bag'], 'cart', {
      countMode: 'totals', reentry: true,
    });
    for (const attempts of results.values()) {
      expect(attempts.map(attempt => attempt.reached)).toEqual([2, 2, 0]);
      expect(attempts[0].stepEvents[2]).toBe(attempts[1].stepEvents[0]);
      expect(attempts[1].stepEvents[2]).toBe(attempts[2].stepEvents[0]);
    }
  });

  it('keeps step selectors and strict conversion-window boundaries', () => {
    const events = jsonEvents([
      event('Add to Bag', 0, { cart: ['H', 'T'], eligible: false }),
      event('Checkout', 10, { cart: ['H', 'T'] }),
      event('Add to Bag', 20, { cart: ['H'], eligible: true }),
      event('Checkout', 40, { cart: ['H'] }),
    ]);
    const filtered = [{ event: 'Add to Bag', where: { prop: 'eligible', op: 'eq', value: true } }, 'Checkout'];
    const results = evaluateFunnelHPC(events, filtered, 'cart', { conversionWindowMs: 20000 });
    expect(results.get('H').reached).toBe(0);
    expect(results.get('H').stepEvents[0]).toBe(events[2]);
    expect(results.get('T').reached).toBe(-1);
    expect(evaluateFunnelHPC(events, filtered, 'cart', { conversionWindowMs: 20001 }).get('H').completed)
      .toBe(true);
  });

  it('preserves input records and full copy-data lists in reached snapshots', () => {
    const events = jsonEvents([
      event('Add to Bag', 0, { cart: ['H', 'T'], source: null }),
      event('Checkout', 20, { cart: ['T', 'H'], source: 'paid' }),
    ]);
    const before = JSON.stringify(events);
    for (const record of events) {
      Object.freeze(record.cart);
      Object.freeze(record);
    }
    Object.freeze(events);
    const results = evaluateFunnelHPC(events, steps, 'cart', { trackStepProperties: ['cart', 'source'] });
    for (const result of results.values()) {
      expect(result.stepEvents[0]).toBe(events[0]);
      expect(result.stepEvents[1]).toBe(events[1]);
      expect(result.stepProperties).toEqual([
        { cart: ['H', 'T'], source: null },
        { cart: ['T', 'H'], source: 'paid' },
      ]);
      expect(resolveFunnelSegment(result, 'first')).toEqual({ cart: ['H', 'T'], source: 'paid' });
      expect(resolveFunnelSegment(result, 'last')).toEqual({ cart: ['T', 'H'], source: 'paid' });
    }
    expect(JSON.stringify(events)).toBe(before);
  });

  it.each([
    ['uniques', [1, 1, 1]],
    ['totals', [3, 2, 1]],
  ])('credits %s across independently progressing values', (countMode, expected) => {
    const events = jsonEvents([
      event('Add to Bag', 0, { cart: ['H', 'T', 'U'] }),
      event('Checkout', 20, { cart: ['T', 'U'] }),
      event('Receipt', 40, { cart: ['U'] }),
    ]);
    const rows = emulateBreakdown(events, {
      type: 'funnelFrequency',
      steps: [...steps, 'Receipt'],
      breakdownByFrequencyOf: 'Add to Bag',
      holdPropertyConstant: 'cart',
      countMode,
    });
    expect(rows.map(row => row.conversions)).toEqual(expected);
    expect(rows.map(row => row.breakdown_freq)).toEqual([1, 1, 1]);
  });

  it('passes a JSON-list session bridge through the report wrapper', () => {
    const events = jsonEvents([
      event('Add to Bag', 0, { cart: ['H'] }),
      event('Checkout', 1200, { cart: ['T'] }),
      event('Checkout', 2400, { cart: ['H'] }),
    ]);
    const report = {
      type: 'funnelFrequency', steps, breakdownByFrequencyOf: 'Add to Bag',
      holdPropertyConstant: 'cart', countMode: 'sessions',
    };
    expect(emulateBreakdown(events, report).map(row => row.conversions)).toEqual([1, 1]);
    expect(emulateBreakdown([events[0], events[2]], report).map(row => row.conversions)).toEqual([1]);
  });
});

describe('list HPC normalization: aggregate.cpp and value.c at analytics 717286d2', () => {
  it.each([
    ['list to scalar', ['H', 'T'], 'H'],
    ['scalar to list', 'H', ['T', 'H']],
  ])('matches %s without whole-list equality', (_label, first, last) => {
    const results = evaluateFunnelHPC(jsonEvents([
      event('Add to Bag', 0, { cart: first }),
      event('Checkout', 20, { cart: last }),
    ]), steps, 'cart');
    expect(results.get('H').completed).toBe(true);
    expect([...results.keys()].every(value => !Array.isArray(value))).toBe(true);
  });

  it.each([
    [[7], '7', '7', true],
    [['7'], 7, '7', true],
    [[true], 'true', 'true', true],
    [['false'], false, 'false', true],
    [[0], '0', '0', true],
    [[1.25], '1.25', '1.25', true],
    [['07'], 7, '07', false],
    [['H'], 'h', 'H', false],
  ])('uses source string keys for %j followed by %j', (first, last, key, completed) => {
    const results = evaluateFunnelHPC(jsonEvents([
      event('Add to Bag', 0, { cart: first }),
      event('Checkout', 20, { cart: last }),
    ]), steps, 'cart');
    expect([...results.keys()]).toEqual([key]);
    expect(results.get(key).completed).toBe(completed);
  });

  it.each([
    [[null], undefined],
    [[null], null],
    [[null], 'undefined'],
    [undefined, [null]],
    [null, ['undefined']],
    [['undefined'], null],
  ])('uses the undefined key for %j followed by %j', (first, last) => {
    const results = evaluateFunnelHPC(jsonEvents([
      event('Add to Bag', 0, { cart: first }),
      event('Checkout', 20, { cart: last }),
    ]), steps, 'cart');
    expect([...results.keys()]).toEqual(['undefined']);
    expect(results.get('undefined').completed).toBe(true);
  });

  it('does not turn empty lists into an undefined history', () => {
    expect(evaluateFunnelHPC(jsonEvents([
      event('Add to Bag', 0, { cart: [] }),
      event('Checkout', 20, { cart: [null] }),
    ]), steps, 'cart').size).toBe(0);
    const results = evaluateFunnelHPC(jsonEvents([
      event('Add to Bag', 0, { cart: [null, 'H'] }),
      event('Checkout', 20, { cart: [] }),
    ]), steps, 'cart');
    expect([...results].map(([value, result]) => [value, result.reached]))
      .toEqual([['undefined', 0], ['H', 0]]);
  });

  it('preserves raw keys and null omission for all-scalar streams', () => {
    const values = [7, '7', false, true, 0, '', 'H', 'h', null, undefined];
    const records = values.flatMap((cart, index) => [
      event('Add to Bag', index * 60, { cart }),
      event('Checkout', index * 60 + 20, { cart }),
    ]);
    const results = evaluateFunnelHPC(jsonEvents(records), steps, 'cart');
    expect([...results.keys()]).toEqual(values.slice(0, -2));
    expect([...results.values()].every(result => result.completed)).toBe(true);
  });
});