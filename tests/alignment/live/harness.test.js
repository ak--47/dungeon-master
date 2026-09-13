import { describe, expect, it } from 'vitest';
import { assertIsolated, eventLimit, isolate, reserveEvents } from './harness.mjs';

describe('live alignment safety', () => {
  it('reserves the entire request before sending and enforces the total ceiling', () => {
    const ledger = { runs: [{ runId: 'old', reserved: eventLimit - 2 }] };
    expect(reserveEvents(ledger, 'new', 2).runs).toHaveLength(2);
    expect(() => reserveEvents(ledger, 'new', 3)).toThrow(/budget/);
    expect(() => reserveEvents(ledger, 'old', 1)).toThrow(/already/);
    expect(ledger.runs).toHaveLength(1);
  });

  it('scopes profile pools and every identity without changing source records', () => {
    const events = [{ event: 'A', user_id: 'user', device_id: 'device', insert_id: 'insert', time: '2026-08-01T12:00:00Z' }];
    const profiles = [{ distinct_id: 'user', device_ids: ['device'] }];
    const output = isolate(events, profiles, 'run');
    expect(() => assertIsolated(output.events, 'run')).not.toThrow();
    expect(output.profiles[0].device_ids).toEqual(['run:device']);
    expect(events[0].user_id).toBe('user');
    expect(() => assertIsolated(events, 'run')).toThrow(/alignment_run_id/);
    expect(() => assertIsolated([{ ...output.events[0], user_id: 'unscoped' }], 'run')).toThrow(/Unscoped/);
  });
});