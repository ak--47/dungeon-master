//@ts-nocheck
/**
 * P2.3 shape atoms. Fixtures are hand-built event streams with expected
 * outcomes derived from each atom's contract (window arithmetic, gap
 * bounds, session-count formula) — never from running the implementation.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import {
	applyLifecycleWave,
	applyPathBias,
	applySessionShape,
} from '../../lib/hook-helpers/shape.js';
import { initChance } from '../../lib/utils/utils.js';
import { sessionize } from '../../lib/verify/sessionize.js';

const DAY = 86400000;
// 2024-01-01T00:00:00Z is UTC-midnight-aligned, so day indices are exact.
const T0 = Date.parse('2024-01-01T00:00:00Z');
const NOON = 12 * 3600 * 1000;
const iso = ms => new Date(ms).toISOString();

beforeEach(() => initChance('shape-tests'));

describe('applyLifecycleWave', () => {
	// Birth = noon day 0. Window with dormantFromDay=5, dormantDays=7 is
	// [birth+5d, birth+12d] INCLUSIVE = [noon day5, noon day12].
	const mkStream = () => {
		const purchases = [0, 3, 6, 8, 10, 13, 20].map(d => ({
			event: 'purchase', time: iso(T0 + d * DAY + NOON), user_id: 'u1', amount: d, insert_id: `p${d}`,
		}));
		const views = [5, 9, 16].map(d => ({
			event: 'page_view', time: iso(T0 + d * DAY + NOON), user_id: 'u1', insert_id: `v${d}`,
		}));
		return [...purchases, ...views];
	};
	const windowEnd = T0 + 12 * DAY + NOON;

	test('drops value moments inside the window, keeps others, appends burst', () => {
		const events = mkStream(); // 10 events
		const out = applyLifecycleWave(events, 'u1', {
			dormantFromDay: 5, dormantDays: 7, resurrectBurst: 3, valueMomentEvent: 'purchase',
		});
		expect(out).not.toBe(events); // NEW array per contract
		// Dropped: purchases day 6, 8, 10 (in window). Kept: purchases 0,3,13,20
		// + all 3 page_views (day 5 and 9 are in-window but not value moments).
		// Appended: 3 clones. 10 - 3 + 3 = 10.
		expect(out.length).toBe(10);
		const purchases = out.filter(e => e.event === 'purchase');
		const originals = purchases.filter(e => e.insert_id);
		expect(originals.map(e => e.amount).sort((a, b) => a - b)).toEqual([0, 3, 13, 20]);
		// GAP DISCIPLINE: zero value moments inside the window after the call.
		const windowStart = T0 + 5 * DAY + NOON;
		for (const e of purchases) {
			const t = Date.parse(e.time);
			expect(t < windowStart || t > windowEnd).toBe(true);
		}
		// page_views untouched (including the two inside the window).
		expect(out.filter(e => e.event === 'page_view').length).toBe(3);
	});

	test('burst: N clones of the closest surviving value moment, just after the gap', () => {
		const out = applyLifecycleWave(mkStream(), 'u1', {
			dormantFromDay: 5, dormantDays: 7, resurrectBurst: 3, valueMomentEvent: 'purchase',
		});
		const clones = out.filter(e => e.event === 'purchase' && !e.insert_id);
		expect(clones.length).toBe(3);
		// Closest surviving purchase to the window: day 13 (1d after end;
		// day 3 is 2d before start) → clones carry amount 13.
		for (const c of clones) {
			expect(c.amount).toBe(13);
			expect(c.user_id).toBe('u1');
			expect(c.insert_id).toBeUndefined();
		}
		// Burst lands strictly after the window (1-3h + 1-10min gaps), monotonic.
		const times = clones.map(c => Date.parse(c.time)).sort((a, b) => a - b);
		expect(times[0]).toBeGreaterThan(windowEnd);
		expect(times[0]).toBeLessThanOrEqual(windowEnd + 3 * 3600_000);
		for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
	});

	test('dropAll sweeps every event in the window', () => {
		const out = applyLifecycleWave(mkStream(), 'u1', {
			dormantFromDay: 5, dormantDays: 7, resurrectBurst: 2, valueMomentEvent: 'purchase', dropAll: true,
		});
		// In-window: purchases 6,8,10 + page_views 5 (boundary-inclusive), 9 → 5 dropped.
		// 10 - 5 + 2 clones = 7.
		expect(out.length).toBe(7);
		expect(out.filter(e => e.event === 'page_view').length).toBe(1); // day 16 only
	});

	test('no surviving template → filtered result, no burst (never fabricates)', () => {
		const events = mkStream();
		const out = applyLifecycleWave(events, 'u1', {
			dormantFromDay: 5, dormantDays: 7, resurrectBurst: 3, valueMomentEvent: 'signup',
		});
		expect(out.length).toBe(10); // no 'signup' events → nothing dropped, nothing added
	});

	test('invalid opts return the input untouched', () => {
		const events = mkStream();
		expect(applyLifecycleWave(events, 'u1', {})).toBe(events);
		expect(applyLifecycleWave(events, 'u1', { dormantFromDay: 5, dormantDays: 0, valueMomentEvent: 'purchase' })).toBe(events);
		expect(applyLifecycleWave([], 'u1', { dormantFromDay: 5, dormantDays: 7, valueMomentEvent: 'purchase' })).toEqual([]);
	});
});

describe('applyPathBias', () => {
	// First anchor is at T0 even though it appears LATER in array order.
	const mkStream = () => [
		{ event: 'view_item', time: iso(T0 + 2 * DAY), user_id: 'u1', insert_id: 'a2' },
		{ event: 'view_item', time: iso(T0), user_id: 'u1', insert_id: 'a1' },
		{ event: 'add_to_cart', time: iso(T0 + 3600_000), user_id: 'u1', cart: 1, insert_id: 'c1' },
		{ event: 'checkout', time: iso(T0 + 3 * DAY), user_id: 'u1', co: 1, insert_id: 'k1' },
		{ event: 'page_view', time: iso(T0 + DAY), user_id: 'u1', insert_id: 'pv' },
	];

	test('share=1: injects the path after the FIRST anchor with gaps in range', () => {
		const events = mkStream();
		const out = applyPathBias(events, 'u1', {
			anchor: 'view_item', path: ['add_to_cart', 'checkout'], share: 1,
		});
		expect(out).toBe(events); // augmented in place
		expect(out.length).toBe(7);
		const clones = out.filter(e => !e.insert_id);
		expect(clones.map(e => e.event)).toEqual(['add_to_cart', 'checkout']);
		const [atc, co] = clones.map(e => Date.parse(e.time));
		// Anchored on the FIRST view_item (T0), not the array-first one (T0+2d).
		// Default gapSeconds [2, 30]: each step 2-30s after the previous.
		expect(atc - T0).toBeGreaterThanOrEqual(2000);
		expect(atc - T0).toBeLessThanOrEqual(30_000);
		expect(co - atc).toBeGreaterThanOrEqual(2000);
		expect(co - atc).toBeLessThanOrEqual(30_000);
		// Clones carry the template's schema props.
		expect(clones[0].cart).toBe(1);
		expect(clones[1].co).toBe(1);
		expect(clones[0].user_id).toBe('u1');
	});

	test('share=0 skips; hash gate follows the published FNV-1a vector for "a"', () => {
		expect(applyPathBias(mkStream(), 'u1', { anchor: 'view_item', path: ['add_to_cart'], share: 0 }).length).toBe(5);
		// hashFloat('a') = 0xe40c292c / 2^32 ≈ 0.89073 (published vector).
		expect(applyPathBias(mkStream(), 'a', { anchor: 'view_item', path: ['add_to_cart'], share: 0.89 }).length).toBe(5);
		expect(applyPathBias(mkStream(), 'a', { anchor: 'view_item', path: ['add_to_cart'], share: 0.90 }).length).toBe(6);
	});

	test('missing template for ANY step skips the user entirely', () => {
		const events = mkStream();
		const out = applyPathBias(events, 'u1', {
			anchor: 'view_item', path: ['add_to_cart', 'refund'], share: 1,
		});
		expect(out.length).toBe(5); // no partial path
	});

	test('gap floor clamps to ≥1s (sub-second jitter scrambles Flows ordering)', () => {
		const out = applyPathBias(mkStream(), 'u1', {
			anchor: 'view_item', path: ['add_to_cart', 'checkout'], share: 1, gapSeconds: [0, 0],
		});
		const clones = out.filter(e => !e.insert_id);
		const [atc, co] = clones.map(e => Date.parse(e.time));
		expect(atc - T0).toBe(1000); // clamped lo = hi = 1s exactly
		expect(co - atc).toBe(1000);
	});

	test('no anchor occurrence → unchanged', () => {
		const events = mkStream().filter(e => e.event !== 'view_item');
		expect(applyPathBias(events, 'u1', { anchor: 'view_item', path: ['add_to_cart'], share: 1 }).length).toBe(3);
	});
});

describe('applySessionShape', () => {
	// 12 events, 2 week-tiles from first event (noon day 0): week 0 on days
	// 0/2/4, week 1 on days 7/9/11 (2 events per day, near noon).
	const mkStream = () => {
		const events = [];
		for (const d of [0, 2, 4, 7, 9, 11]) {
			for (let i = 0; i < 2; i++) {
				events.push({
					event: 'open app', time: iso(T0 + d * DAY + NOON + i * 3600_000),
					user_id: 'u1', distinct_id: 'u1', insert_id: `e${d}-${i}`,
				});
			}
		}
		return events;
	};

	test('plentiful stream: sessionsPerWeek × weeks sessions, invariants hold', () => {
		const events = mkStream();
		const before = new Set(events);
		const out = applySessionShape(events, 'u1', { sessionsPerWeek: 2, eventsPerSession: 3, sessionMinutes: 30 });
		expect(out).toBe(events);
		expect(out.length).toBe(12);
		for (const e of out) expect(before.has(e)).toBe(true); // retiming only — same objects

		// numSessions = min(2 spw × 2 weeks, ceil(12/3)) = 4, chunks of 3.
		const { sessions } = sessionize(out); // default 30-min timeout
		expect(sessions.length).toBe(4);
		for (const s of sessions) {
			expect(s.event_count).toBe(3);
			expect(s.duration_s).toBeLessThanOrEqual(30 * 60); // within sessionMinutes
			// Never crosses UTC midnight.
			expect(Math.floor(s.startMs / DAY)).toBe(Math.floor(s.endMs / DAY));
		}
		// Week tiling + original-day preference: week-0 sessions land on the
		// user's original week-0 days {0,2,4}, week-1 on {7,9,11}, distinct
		// days within each week (pickset is without replacement).
		const days = sessions.map(s => Math.floor((s.startMs - T0) / DAY));
		expect([0, 2, 4]).toEqual(expect.arrayContaining([days[0], days[1]]));
		expect([7, 9, 11]).toEqual(expect.arrayContaining([days[2], days[3]]));
		expect(new Set(days).size).toBe(4);
	});

	test('long sessionMinutes still keeps intra-gaps under the 30-min timeout', () => {
		const out = applySessionShape(mkStream(), 'u1', { sessionsPerWeek: 2, eventsPerSession: 3, sessionMinutes: 120 });
		// Even spacing is capped at 20min (+ ≤5min jitter < 30min timeout), so a
		// 120-min window still derives as ONE session per cluster.
		const { sessions } = sessionize(out);
		expect(sessions.length).toBe(4);
		for (const s of sessions) {
			const times = s.events.map(e => Date.parse(e.time)).sort((a, b) => a - b);
			for (let i = 1; i < times.length; i++) {
				expect(times[i] - times[i - 1]).toBeLessThan(30 * 60_000);
				expect(times[i]).toBeGreaterThan(times[i - 1]); // monotonic
			}
			expect(s.duration_s).toBeLessThanOrEqual(120 * 60);
		}
	});

	test('scarce stream: session count follows ceil(N / eventsPerSession)', () => {
		// 3 events in one week; spw=5 but only ceil(3/1)=3 sessions materialize.
		const events = [0, 1, 2].map(d => ({
			event: 'open app', time: iso(T0 + d * DAY + NOON), user_id: 'u1', distinct_id: 'u1',
		}));
		const out = applySessionShape(events, 'u1', { sessionsPerWeek: 5, eventsPerSession: 1, sessionMinutes: 15 });
		const { sessions } = sessionize(out);
		expect(sessions.length).toBe(3);
		for (const s of sessions) expect(s.event_count).toBe(1);
	});

	test('eventsPerSession > N collapses to a single session', () => {
		const events = [0, 1, 2, 3].map(d => ({
			event: 'open app', time: iso(T0 + d * DAY + NOON), user_id: 'u1', distinct_id: 'u1',
		}));
		const out = applySessionShape(events, 'u1', { sessionsPerWeek: 3, eventsPerSession: 10, sessionMinutes: 45 });
		const { sessions } = sessionize(out);
		expect(sessions.length).toBe(1);
		expect(sessions[0].event_count).toBe(4);
		expect(sessions[0].duration_s).toBeLessThanOrEqual(45 * 60);
	});

	test('invalid params leave timestamps untouched', () => {
		const events = mkStream();
		const timesBefore = events.map(e => e.time);
		applySessionShape(events, 'u1', { sessionsPerWeek: 0, eventsPerSession: 3, sessionMinutes: 30 });
		applySessionShape(events, 'u1', { sessionsPerWeek: 2, eventsPerSession: 3 });
		expect(events.map(e => e.time)).toEqual(timesBefore);
	});
});
