//@ts-nocheck
/**
 * P1.7.1 unit tests: sessionize() — query-time session derivation.
 *
 * Every expected value below is hand-computed from the ARB rules — NOT
 * derived from running the implementation:
 *   - split triggers (session_query.cpp, timeout branch of
 *     session_query_params_process_event): gap strictly > timeout measured
 *     from the LAST event; max-length strictly > measured from the session's
 *     FIRST event; UTC day-index change (ms / 86400000)
 *   - session end stamped at the last event's timestamp on split AND at
 *     end-of-scan (finalize_sessions) — idle tail excluded
 *   - the splitting event belongs to the NEW session
 *     (sortable_event_create_session_start resets event_count before the
 *     u->event_count++ that follows the branch)
 *   - $duration_s = integer division (sortable_event_create_session_end)
 *   - copy props FIRST-wins over DEFAULT_COPY_PROPERTIES
 *     (copy_to_property_set_copy; api/version_2_0/segmentation/models.py)
 *   - equal-ms sort tiebreak: session start < session end
 *     (canonical_event_sort_comparer_lazy, libquery/event/event.c)
 */

import { describe, test, expect } from 'vitest';
import { sessionize, SESSION_COPY_PROPERTIES } from '../../lib/verify/sessionize.js';
import { buildIdentityMap } from '../../lib/verify/identity.js';

const ev = (user_id, time, event = 'page view', props = {}) => ({ event, time, user_id, ...props });

describe('sessionize — basic', () => {
	test('single session: bounds, duration, count, origins', () => {
		const events = [
			ev('u1', '2024-01-15T10:00:00.000Z', 'app open'),
			ev('u1', '2024-01-15T10:10:00.000Z', 'page view'),
			ev('u1', '2024-01-15T10:20:00.000Z', 'purchase'),
		];
		const { sessions, syntheticEvents } = sessionize(events);
		// hand-computed: gaps are 10 min each (≤ 30 min), same UTC day → one session
		expect(sessions).toHaveLength(1);
		const s = sessions[0];
		expect(s.userId).toBe('u1');
		expect(s.startMs).toBe(Date.parse('2024-01-15T10:00:00.000Z'));
		expect(s.endMs).toBe(Date.parse('2024-01-15T10:20:00.000Z'));
		expect(s.duration_s).toBe(1200);
		expect(s.event_count).toBe(3);
		expect(s.origin_start).toBe('app open');
		expect(s.origin_end).toBe('purchase');
		expect(syntheticEvents).toHaveLength(2);
	});

	test('empty input and unresolvable/-timed events', () => {
		expect(sessionize([])).toEqual({ sessions: [], syntheticEvents: [] });
		const junk = [
			{ event: 'x', time: '2024-01-15T10:00:00.000Z' },           // no id
			{ event: 'x', time: 'not-a-date', user_id: 'u1' },          // bad time
		];
		expect(sessionize(junk).sessions).toHaveLength(0);
	});

	test('unordered input is time-sorted internally', () => {
		const later = ev('u1', '2024-01-15T10:10:00.000Z');
		const first = ev('u1', '2024-01-15T10:00:00.000Z');
		const { sessions } = sessionize([later, first]);
		expect(sessions).toHaveLength(1);
		expect(sessions[0].startMs).toBe(Date.parse('2024-01-15T10:00:00.000Z'));
		expect(sessions[0].events[0]).toBe(first); // references originals
	});

	test('multiple users sessionize independently (interleaved events never cross-split)', () => {
		const events = [
			ev('u1', '2024-01-15T10:00:00.000Z'),
			ev('u2', '2024-01-15T10:05:00.000Z'),
			ev('u1', '2024-01-15T10:10:00.000Z'),
			ev('u2', '2024-01-15T10:15:00.000Z'),
		];
		const { sessions } = sessionize(events);
		expect(sessions).toHaveLength(2);
		expect(sessions.map(s => s.event_count)).toEqual([2, 2]);
	});
});

describe('sessionize — gap trigger (strict >, measured from LAST event)', () => {
	test('gap exactly == timeout does NOT split', () => {
		const events = [
			ev('u1', '2024-01-15T10:00:00.000Z'),
			ev('u1', '2024-01-15T10:30:00.000Z'), // gap = 1_800_000 ms exactly
		];
		const { sessions } = sessionize(events);
		// hand-computed: ARB condition is `gap > timeout` — equality stays
		expect(sessions).toHaveLength(1);
		expect(sessions[0].duration_s).toBe(1800);
	});

	test('gap of timeout + 1ms splits', () => {
		const events = [
			ev('u1', '2024-01-15T10:00:00.000Z'),
			ev('u1', '2024-01-15T10:30:00.001Z'), // gap = 1_800_001 ms
		];
		const { sessions } = sessionize(events);
		expect(sessions).toHaveLength(2);
		expect(sessions.map(s => s.event_count)).toEqual([1, 1]);
	});

	test('gap measured from the LAST event — chain of sub-timeout gaps spans past the timeout', () => {
		const events = [
			ev('u1', '2024-01-15T10:00:00.000Z'),
			ev('u1', '2024-01-15T10:25:00.000Z'),
			ev('u1', '2024-01-15T10:50:00.000Z'),
			ev('u1', '2024-01-15T11:15:00.000Z'),
		];
		const { sessions } = sessionize(events);
		// hand-computed: each gap is 25 min ≤ 30 min → one 75-min session
		expect(sessions).toHaveLength(1);
		expect(sessions[0].event_count).toBe(4);
		expect(sessions[0].duration_s).toBe(4500);
	});

	test('on split: end stamped at LAST event (idle tail excluded), splitting event goes to the NEW session', () => {
		const e3 = ev('u1', '2024-01-15T11:00:00.000Z', 'comeback');
		const events = [
			ev('u1', '2024-01-15T10:00:00.000Z', 'app open'),
			ev('u1', '2024-01-15T10:05:00.000Z', 'page view'),
			e3, // gap 55 min > 30 min
		];
		const { sessions } = sessionize(events);
		expect(sessions).toHaveLength(2);
		// hand-computed: session 1 ends at 10:05 (NOT 10:35 or 11:00)
		expect(sessions[0].endMs).toBe(Date.parse('2024-01-15T10:05:00.000Z'));
		expect(sessions[0].duration_s).toBe(300);
		expect(sessions[0].event_count).toBe(2);
		expect(sessions[0].origin_end).toBe('page view');
		// splitting event belongs to the NEW session
		expect(sessions[1].event_count).toBe(1);
		expect(sessions[1].events[0]).toBe(e3);
		expect(sessions[1].origin_start).toBe('comeback');
	});

	test('timeoutMs: 0 disables the gap trigger (ARB `> 0` guard)', () => {
		const events = [
			ev('u1', '2024-01-15T10:00:00.000Z'),
			ev('u1', '2024-01-15T12:00:00.000Z'), // 2h gap, same UTC day
		];
		const { sessions } = sessionize(events, { timeoutMs: 0 });
		expect(sessions).toHaveLength(1);
	});
});

describe('sessionize — max-length trigger (strict >, anchored to FIRST event)', () => {
	// isolate from gap/day triggers: 90-min timeout, 2-h max, all same UTC day
	const opts = { timeoutMs: 90 * 60_000, maxSessionMs: 2 * 3_600_000 };

	test('event exactly AT first + max stays; first event past it splits', () => {
		const events = [
			ev('u1', '2024-01-15T01:00:00.000Z'),
			ev('u1', '2024-01-15T02:00:00.000Z'),
			ev('u1', '2024-01-15T03:00:00.000Z'), // == 01:00 + 2h → strict >, stays
			ev('u1', '2024-01-15T03:30:00.000Z'), // > 01:00 + 2h → splits
		];
		const { sessions } = sessionize(events, opts);
		// hand-computed: if max were anchored to the LAST event, 03:30 would be
		// within 03:00 + 2h and nothing would split.
		expect(sessions).toHaveLength(2);
		expect(sessions[0].event_count).toBe(3);
		expect(sessions[0].duration_s).toBe(7200);
		expect(sessions[1].event_count).toBe(1);
		expect(sessions[1].startMs).toBe(Date.parse('2024-01-15T03:30:00.000Z'));
	});
});

describe('sessionize — UTC day-boundary trigger', () => {
	test('splits at midnight even when the gap is under the timeout', () => {
		const events = [
			ev('u1', '2024-01-15T23:50:00.000Z', 'late night'),
			ev('u1', '2024-01-16T00:10:00.000Z', 'early morning'), // gap 20 min < 30 min
		];
		const { sessions } = sessionize(events);
		// hand-computed: day index 19737 → 19738 → split regardless of gap
		expect(sessions).toHaveLength(2);
		expect(sessions[0].endMs).toBe(Date.parse('2024-01-15T23:50:00.000Z'));
		expect(sessions[1].startMs).toBe(Date.parse('2024-01-16T00:10:00.000Z'));
	});
});

describe('sessionize — duration + computed props', () => {
	test('duration_s uses integer division (uint32 semantics)', () => {
		const events = [
			ev('u1', '2024-01-15T10:00:00.000Z'),
			ev('u1', '2024-01-15T10:00:01.999Z'),
		];
		const { sessions } = sessionize(events);
		// hand-computed: floor(1999 / 1000) = 1
		expect(sessions[0].duration_s).toBe(1);
	});

	test('all four computed props stamped on BOTH synthetic events, timed at first/last event', () => {
		const events = [
			ev('u1', '2024-01-15T10:00:00.000Z', 'app open'),
			ev('u1', '2024-01-15T10:05:00.000Z', 'page view'),
		];
		const { syntheticEvents } = sessionize(events);
		expect(syntheticEvents).toHaveLength(2);
		const [start, end] = syntheticEvents;
		expect(start.event).toBe('$session_start');
		expect(end.event).toBe('$session_end');
		expect(start.time).toBe('2024-01-15T10:00:00.000Z');
		expect(end.time).toBe('2024-01-15T10:05:00.000Z');
		for (const s of [start, end]) {
			expect(s.user_id).toBe('u1');
			expect(s.$duration_s).toBe(300);
			expect(s.$event_count).toBe(2);
			expect(s.$origin_start).toBe('app open');
			expect(s.$origin_end).toBe('page view');
		}
	});
});

describe('sessionize — copy props (FIRST-wins over DEFAULT_COPY_PROPERTIES)', () => {
	test('first non-null value wins; nulls never fill; non-listed props never copied', () => {
		const events = [
			ev('u1', '2024-01-15T10:00:00.000Z', 'a', { utm_source: 'google', $browser: null, plan: 'pro' }),
			ev('u1', '2024-01-15T10:05:00.000Z', 'b', { utm_source: 'bing', $browser: 'chrome' }),
		];
		const { sessions, syntheticEvents } = sessionize(events);
		const cp = sessions[0].copyProps;
		// hand-computed: utm_source slot filled by the first event; $browser null
		// does not fill (VALUE_TYPE_UNDEFINED skip) so the second event fills it;
		// `plan` is not in the 18-prop default list.
		expect(cp.utm_source).toBe('google');
		expect(cp.$browser).toBe('chrome');
		expect('plan' in cp).toBe(false);
		for (const s of syntheticEvents) {
			expect(s.utm_source).toBe('google');
			expect(s.$browser).toBe('chrome');
			expect('plan' in s).toBe(false);
		}
	});

	test('the default copy list is the exact 18-prop DEFAULT_COPY_PROPERTIES', () => {
		// api/version_2_0/segmentation/models.py:78-97
		expect(SESSION_COPY_PROPERTIES).toEqual([
			'$app_build_number', '$app_version_string', '$browser', '$city',
			'$country_code', '$current_url', '$device', '$manufacturer', '$os',
			'$region', 'mp_country_code', 'mp_lib', 'mp_platform', 'utm_campaign',
			'utm_content', 'utm_source', '$referring_domain', 'utm_medium',
		]);
	});
});

describe('sessionize — namespace + ordering', () => {
	test('synthetic events live in a separate array and only carry session names', () => {
		const events = [
			ev('u1', '2024-01-15T10:00:00.000Z'),
			ev('u1', '2024-01-15T11:00:00.000Z'), // split → 2 sessions
		];
		const { sessions, syntheticEvents } = sessionize(events);
		expect(syntheticEvents).toHaveLength(sessions.length * 2);
		expect(syntheticEvents.every(s => s.event === '$session_start' || s.event === '$session_end')).toBe(true);
	});

	test('equal-ms tiebreak: session start sorts before session end', () => {
		// hand-computed: A's session is [X−10min, X]; B's is [X, X]. At ms X the
		// canonical comparer puts starts before ends → B's start precedes A's end.
		const X = '2024-01-15T10:10:00.000Z';
		const events = [
			ev('A', '2024-01-15T10:00:00.000Z'),
			ev('A', X),
			ev('B', X),
		];
		const { syntheticEvents } = sessionize(events);
		expect(syntheticEvents.map(s => [s.event, s.user_id])).toEqual([
			['$session_start', 'A'], // 10:00
			['$session_start', 'B'], // X — start before the ends at X
			['$session_end', 'A'],   // X
			['$session_end', 'B'],   // X
		]);
	});
});

describe('sessionize — identity resolution', () => {
	test('pre-auth device events merge into the canonical user\'s session', () => {
		const deviceEvent = { event: 'landing', time: '2024-01-15T10:00:00.000Z', device_id: 'd1' };
		const userEvent = ev('u9', '2024-01-15T10:10:00.000Z', 'signup');
		const identityMap = buildIdentityMap([{ distinct_id: 'u9', device_ids: ['d1'] }]);
		const { sessions } = sessionize([deviceEvent, userEvent], { identityMap });
		// hand-computed: d1 → u9, 10-min gap → ONE session of 2 events
		expect(sessions).toHaveLength(1);
		expect(sessions[0].userId).toBe('u9');
		expect(sessions[0].event_count).toBe(2);
		expect(sessions[0].origin_start).toBe('landing');
	});

	test('without the identityMap the same events form two single-event sessions', () => {
		const deviceEvent = { event: 'landing', time: '2024-01-15T10:00:00.000Z', device_id: 'd1' };
		const userEvent = ev('u9', '2024-01-15T10:10:00.000Z', 'signup');
		const { sessions } = sessionize([deviceEvent, userEvent]);
		expect(sessions).toHaveLength(2);
	});
});
