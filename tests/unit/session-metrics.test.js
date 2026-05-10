//@ts-nocheck
/**
 * Unit tests for `emulateBreakdown({ type: 'sessionMetrics' })` and the
 * sessionScoped funnel option.
 *
 * Reference: backend/arb/reader/queries/session_query.cpp — 30-min gap +
 * 24h max model. We trust the generator's pre-stamped session_id and group
 * by (user, session_id).
 */

import { describe, test, expect } from 'vitest';
import { emulateBreakdown, evaluateFunnel } from '../../lib/verify/index.js';

const ev = (event, time, props = {}) => ({ event, time, user_id: 'u1', ...props });

describe('emulateBreakdown — sessionMetrics', () => {
	test('count / duration / eventsPerSession from pre-stamped session_id', () => {
		// User with 2 sessions:
		//   s1: 3 events spanning 60_000ms
		//   s2: 1 event (single-event session, duration=0)
		const events = [
			ev('A', 0,      { user_id: 'u1', session_id: 's1' }),
			ev('B', 30_000, { user_id: 'u1', session_id: 's1' }),
			ev('C', 60_000, { user_id: 'u1', session_id: 's1' }),
			ev('A', 5_000_000, { user_id: 'u1', session_id: 's2' }),
		];
		const rows = emulateBreakdown(events, { type: 'sessionMetrics' });
		const byMetric = Object.fromEntries(rows.map(r => [r.metric, r]));

		expect(byMetric.count.total_sessions).toBe(2);
		expect(byMetric.count.avg).toBe(2);  // 1 user with 2 sessions
		expect(byMetric.duration.avg_ms).toBe(30_000); // (60000 + 0) / 2
		expect(byMetric.eventsPerSession.avg).toBe(2); // (3 + 1) / 2
	});

	test('event filter: only sessions containing the event are counted', () => {
		const events = [
			ev('A', 0,      { user_id: 'u1', session_id: 's1' }),
			ev('B', 1_000,  { user_id: 'u1', session_id: 's1' }),
			ev('A', 10_000, { user_id: 'u1', session_id: 's2' }),
			// s2 has no B
		];
		const rows = emulateBreakdown(events, { type: 'sessionMetrics', event: 'B' });
		const total = rows.find(r => r.metric === 'count');
		expect(total.total_sessions).toBe(1);
	});

	test('events without session_id are excluded', () => {
		const events = [
			ev('A', 0, { user_id: 'u1' }), // no session_id
			ev('A', 1_000, { user_id: 'u1', session_id: 's1' }),
		];
		const rows = emulateBreakdown(events, { type: 'sessionMetrics' });
		const total = rows.find(r => r.metric === 'count');
		expect(total.total_sessions).toBe(1);
	});

	test('multiple users: aggregates count distribution per user', () => {
		// u1 has 1 session, u2 has 3 sessions → counts = [1, 3]
		const events = [
			ev('A', 0,      { user_id: 'u1', session_id: 'u1-s1' }),
			ev('A', 0,      { user_id: 'u2', session_id: 'u2-s1' }),
			ev('A', 5_000_000, { user_id: 'u2', session_id: 'u2-s2' }),
			ev('A', 10_000_000, { user_id: 'u2', session_id: 'u2-s3' }),
		];
		const rows = emulateBreakdown(events, { type: 'sessionMetrics', metrics: ['count'] });
		const total = rows.find(r => r.metric === 'count');
		expect(total.total_sessions).toBe(4);
		expect(total.avg).toBe(2);     // (1 + 3) / 2
		expect(total.median).toBe(2);  // mid of [1, 3]
	});

	test('selective metrics output', () => {
		const events = [ev('A', 0, { user_id: 'u1', session_id: 's1' })];
		const rows = emulateBreakdown(events, { type: 'sessionMetrics', metrics: ['duration'] });
		expect(rows.length).toBe(1);
		expect(rows[0].metric).toBe('duration');
	});

	test('empty input → zeros', () => {
		const rows = emulateBreakdown([], { type: 'sessionMetrics' });
		expect(rows.every(r => r.total_sessions === 0)).toBe(true);
	});

	// ported from test_qt_sessions.py: test_session_via_timeout — single user
	// with two sessions separated by a 60-min gap should produce two sessions
	// (here we PRE-stamp session_id since the generator already does the
	// 30-min gap + 24h max bucketing).
	test('ported timeout fixture: 2 sessions per user when separated by long gap', () => {
		const events = [
			ev('event_1', Date.UTC(2011,6,6, 0,0,0),  { user_id: 'f1', session_id: 'f1-s1' }),
			ev('event_2', Date.UTC(2011,6,6, 0,59,59), { user_id: 'f1', session_id: 'f1-s1' }),
			ev('event_3', Date.UTC(2011,6,6, 1,0,0),   { user_id: 'f1', session_id: 'f1-s1' }),
			ev('event_4', Date.UTC(2011,6,6, 1,59,59), { user_id: 'f1', session_id: 'f1-s1' }),
			ev('event_5', Date.UTC(2011,6,6, 3,0,0),   { user_id: 'f1', session_id: 'f1-s2' }),
			ev('event_6', Date.UTC(2011,6,6, 3,1,0),   { user_id: 'f1', session_id: 'f1-s2' }),
			ev('event_7', Date.UTC(2011,6,6, 3,2,0),   { user_id: 'f1', session_id: 'f1-s2' }),
			ev('event_8', Date.UTC(2011,6,6, 4,1,0),   { user_id: 'f1', session_id: 'f1-s2' }),
		];
		const rows = emulateBreakdown(events, { type: 'sessionMetrics' });
		const total = rows.find(r => r.metric === 'count');
		expect(total.total_sessions).toBe(2);
		const evCount = rows.find(r => r.metric === 'eventsPerSession');
		expect(evCount.avg).toBe(4); // 4 events per session
	});
});

// ── Generator session day-boundary split (parity with session_query.cpp) ────

describe('assignSessionIds — UTC day boundary splits sessions (Mixpanel parity)', () => {
	test('events crossing UTC midnight produce 2 sessions even with no timeout gap', async () => {
		const { default: utils } = await import('../../lib/utils/utils.js').then(m => ({ default: m }));
		const events = [
			{ time: new Date(Date.UTC(2024, 0, 1, 23, 55)).toISOString(), user_id: 'u1' },
			{ time: new Date(Date.UTC(2024, 0, 1, 23, 59)).toISOString(), user_id: 'u1' },
			{ time: new Date(Date.UTC(2024, 0, 2,  0,  5)).toISOString(), user_id: 'u1' }, // 10min later, but new UTC day
		];
		utils.assignSessionIds(events);
		const sids = new Set(events.map(e => e.session_id));
		expect(sids.size).toBe(2);
		expect(events[0].session_id).toBe(events[1].session_id);
		expect(events[1].session_id).not.toBe(events[2].session_id);
	});

	test('events on same UTC day with short gaps stay in one session', async () => {
		const { default: utils } = await import('../../lib/utils/utils.js').then(m => ({ default: m }));
		const events = [
			{ time: new Date(Date.UTC(2024, 0, 1, 10, 0)).toISOString(), user_id: 'u1' },
			{ time: new Date(Date.UTC(2024, 0, 1, 10, 15)).toISOString(), user_id: 'u1' },
			{ time: new Date(Date.UTC(2024, 0, 1, 10, 25)).toISOString(), user_id: 'u1' },
		];
		utils.assignSessionIds(events);
		const sids = new Set(events.map(e => e.session_id));
		expect(sids.size).toBe(1);
	});
});

// ── Session-scoped funnels ───────────────────────────────────────────────────

describe('evaluateFunnel — sessionScoped (integration with session_id)', () => {
	test('cross-session steps do not complete', () => {
		const events = [
			ev('Sign Up', 1000, { session_id: 's1' }),
			ev('Activate', 2000, { session_id: 's2' }), // different session
		];
		const r = evaluateFunnel(events, ['Sign Up', 'Activate'], { sessionScoped: true });
		expect(r.completed).toBe(false);
	});

	test('within-session steps complete', () => {
		const events = [
			ev('Sign Up', 1000, { session_id: 's1' }),
			ev('Activate', 2000, { session_id: 's1' }),
		];
		const r = evaluateFunnel(events, ['Sign Up', 'Activate'], { sessionScoped: true });
		expect(r.completed).toBe(true);
		expect(r.sessionId).toBe('s1');
	});
});
