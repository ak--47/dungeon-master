//@ts-nocheck
/**
 * Unit tests for `emulateBreakdown({ type: 'sessionMetrics' })` and the
 * sessionScoped funnel option.
 *
 * Reference: backend/arb/reader/queries/session_query.cpp — 30-min gap +
 * 24h max model. v1.6.0 (P1.7.2): default `source: 'derived'` re-derives
 * sessions from timestamps via sessionize() (Mixpanel evaluates sessions at
 * query time — stamps are ignored); `source: 'stamped'` keeps the v1.5
 * group-by-(user, session_id) path. Every row reports `stampedDivergence`.
 */

import { describe, test, expect } from 'vitest';
import { emulateBreakdown, evaluateFunnel } from '../../lib/verify/index.js';

const ev = (event, time, props = {}) => ({ event, time, user_id: 'u1', ...props });

describe('emulateBreakdown — sessionMetrics', () => {
	test('count / duration / eventsPerSession (derived default splits on the 83-min gap)', () => {
		// User with 2 sessions — hand-derived: gaps 30s/30s stay (< 30 min),
		// the 60_000 → 5_000_000 gap (~82 min) splits. Stamps agree, so
		// stampedDivergence = 0.
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
		expect(byMetric.count.source).toBe('derived');
		expect(byMetric.count.stampedDivergence).toBe(0);
		expect(byMetric.duration.avg_ms).toBe(30_000); // (60000 + 0) / 2
		expect(byMetric.eventsPerSession.avg).toBe(2); // (3 + 1) / 2
	});

	test('event filter: only sessions containing the event are counted', () => {
		// Derived: all gaps < 30 min → ONE derived session holding all three
		// events, and it contains B → 1 qualifying session. (The stamps split
		// s1/s2, but query-time derivation ignores them for the metric.)
		const events = [
			ev('A', 0,      { user_id: 'u1', session_id: 's1' }),
			ev('B', 1_000,  { user_id: 'u1', session_id: 's1' }),
			ev('A', 10_000, { user_id: 'u1', session_id: 's2' }),
		];
		const rows = emulateBreakdown(events, { type: 'sessionMetrics', event: 'B' });
		const total = rows.find(r => r.metric === 'count');
		expect(total.total_sessions).toBe(1);
		// s1→s2 stamp boundary has no derived counterpart → 1 divergence.
		expect(total.stampedDivergence).toBe(1);
	});

	test("events without session_id are excluded (source: 'stamped' — v1.5 path)", () => {
		const events = [
			ev('A', 0, { user_id: 'u1' }), // no session_id
			ev('A', 1_000, { user_id: 'u1', session_id: 's1' }),
		];
		const rows = emulateBreakdown(events, { type: 'sessionMetrics', source: 'stamped' });
		const total = rows.find(r => r.metric === 'count');
		expect(total.total_sessions).toBe(1);
		expect(total.source).toBe('stamped');
	});

	test('derived default includes unstamped events (v1.6.0 behavior change)', () => {
		// Same fixture as above under the derived default: both events land in
		// one derived session (1s gap) — the missing stamp no longer excludes
		// the first event. Divergence pairs need stamps on BOTH sides → null
		// never; here the only pair has one unstamped side → skipped → 0.
		const events = [
			ev('A', 0, { user_id: 'u1' }),
			ev('A', 1_000, { user_id: 'u1', session_id: 's1' }),
		];
		const rows = emulateBreakdown(events, { type: 'sessionMetrics' });
		const total = rows.find(r => r.metric === 'count');
		expect(total.total_sessions).toBe(1);
		expect(total.source).toBe('derived');
		expect(total.stampedDivergence).toBe(0);
		const perSession = rows.find(r => r.metric === 'eventsPerSession');
		expect(perSession.avg).toBe(2); // both events counted
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
	// with two sessions separated by a >60-min gap. The original py fixture
	// runs a 60-min timeout (gaps of 3599s stay, the 3601s gap splits), so we
	// pass sessionTimeoutMs to match; the derived result agrees with the
	// stamps (divergence 0). Expectations unchanged from v1.5.
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
		const rows = emulateBreakdown(events, { type: 'sessionMetrics', sessionTimeoutMs: 3600_000 });
		const total = rows.find(r => r.metric === 'count');
		expect(total.total_sessions).toBe(2);
		expect(total.stampedDivergence).toBe(0);
		const evCount = rows.find(r => r.metric === 'eventsPerSession');
		expect(evCount.avg).toBe(4); // 4 events per session
	});
});

// ── P1.7.2: derived sessions + stampedDivergence ────────────────────────────

describe('sessionMetrics — derived source (v1.6.0)', () => {
	test('derives sessions from raw timestamps with NO session_id anywhere', () => {
		// Hand-derived at the 30-min default: gaps 10min/10min stay, the
		// 20min → 55min gap (35 min) splits → sessions [A,B,C] and [D].
		const events = [
			ev('A', 0, { user_id: 'u1' }),
			ev('B', 10 * 60_000, { user_id: 'u1' }),
			ev('C', 20 * 60_000, { user_id: 'u1' }),
			ev('D', 55 * 60_000, { user_id: 'u1' }),
		];
		const rows = emulateBreakdown(events, { type: 'sessionMetrics' });
		const byMetric = Object.fromEntries(rows.map(r => [r.metric, r]));
		expect(byMetric.count.total_sessions).toBe(2);
		expect(byMetric.duration.avg_ms).toBe(10 * 60_000); // (20min + 0) / 2
		expect(byMetric.eventsPerSession.avg).toBe(2);      // (3 + 1) / 2
		// No stamps in the dataset → divergence is not computable.
		expect(byMetric.count.stampedDivergence).toBe(null);
	});

	test('sessionTimeoutMs threads into derivation', () => {
		// 15-min gap: one session at the 30-min default, two at a 10-min
		// timeout.
		const events = [
			ev('A', 0, { user_id: 'u1' }),
			ev('B', 15 * 60_000, { user_id: 'u1' }),
		];
		const def = emulateBreakdown(events, { type: 'sessionMetrics', metrics: ['count'] });
		expect(def[0].total_sessions).toBe(1);
		const tight = emulateBreakdown(events, {
			type: 'sessionMetrics', metrics: ['count'], sessionTimeoutMs: 10 * 60_000,
		});
		expect(tight[0].total_sessions).toBe(2);
	});

	test('maxSessionMs threads into derivation (split from FIRST event)', () => {
		// Gaps of 25 min never hit a 30-min timeout, but the third event sits
		// 50 min after the session START — over a 45-min max → split there.
		const events = [
			ev('A', 0, { user_id: 'u1' }),
			ev('B', 25 * 60_000, { user_id: 'u1' }),
			ev('C', 50 * 60_000, { user_id: 'u1' }),
		];
		const def = emulateBreakdown(events, { type: 'sessionMetrics', metrics: ['count'] });
		expect(def[0].total_sessions).toBe(1);
		const capped = emulateBreakdown(events, {
			type: 'sessionMetrics', metrics: ['count'], maxSessionMs: 45 * 60_000,
		});
		expect(capped[0].total_sessions).toBe(2);
	});

	test('stampedDivergence counts boundary disagreements in both directions', () => {
		// u1: one stamped session spanning a 40-min gap — derived splits it
		// (stamped same / derived differ → 1).
		// u2: stamps split at a 5-min gap — derived merges (stamped differ /
		// derived same → 1). Total 2.
		const events = [
			ev('A', 0, { user_id: 'u1', session_id: 's1' }),
			ev('B', 40 * 60_000, { user_id: 'u1', session_id: 's1' }),
			ev('A', 0, { user_id: 'u2', session_id: 't1' }),
			ev('B', 5 * 60_000, { user_id: 'u2', session_id: 't2' }),
		];
		const rows = emulateBreakdown(events, { type: 'sessionMetrics', metrics: ['count'] });
		expect(rows[0].stampedDivergence).toBe(2);
		// Derived metric ignores the stamps entirely: u1 → 2 sessions,
		// u2 → 1 session.
		expect(rows[0].total_sessions).toBe(3);
	});

	test("source: 'stamped' keeps v1.5 metrics but still reports divergence", () => {
		// Same u1 fixture: stamped path sees ONE 40-min session; the derived
		// reference disagrees at that boundary → divergence 1.
		const events = [
			ev('A', 0, { user_id: 'u1', session_id: 's1' }),
			ev('B', 40 * 60_000, { user_id: 'u1', session_id: 's1' }),
		];
		const rows = emulateBreakdown(events, {
			type: 'sessionMetrics', metrics: ['count', 'duration'], source: 'stamped',
		});
		const byMetric = Object.fromEntries(rows.map(r => [r.metric, r]));
		expect(byMetric.count.total_sessions).toBe(1);
		expect(byMetric.duration.avg_ms).toBe(40 * 60_000);
		expect(byMetric.count.source).toBe('stamped');
		expect(byMetric.count.stampedDivergence).toBe(1);
	});

	test('invalid source throws', () => {
		expect(() => emulateBreakdown([], { type: 'sessionMetrics', source: 'bogus' }))
			.toThrow(/derived.*stamped/);
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
