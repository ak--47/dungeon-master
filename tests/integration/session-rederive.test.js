// @ts-nocheck
/**
 * P2.1 integration: session_ids are re-derived AFTER the everything hook.
 *
 * A time-mutating hook (here: shift each user's last event +2h) historically
 * left stale generator-stamped session_ids that disagreed with what Mixpanel
 * computes from timestamps at query time. The v1.6 fix re-runs
 * assignSessionIds on the final event set, so stamped ids must now agree
 * with a fresh sessionize() pass over the output — threading the dungeon's
 * `sessionTimeout` (minutes) as `timeoutMs`.
 */
import { describe, test, expect } from 'vitest';
import generate from '../../index.js';
import { sessionize, emulateBreakdown } from '../../lib/verify/index.js';
import dayjs from 'dayjs';

const timeout = 60_000;

// Pin the window for determinism (FIXED_NOW anchors to datasetEnd).
const PINNED_DATES = { datasetStart: '2025-09-01T00:00:00Z', datasetEnd: '2025-10-01T00:00:00Z' };
const SESSION_TIMEOUT_MIN = 45; // non-default on purpose — proves the knob threads

const baseConfig = {
	...PINNED_DATES,
	writeToDisk: false,
	verbose: false,
	numUsers: 40,
	numEvents: 2000,
	seed: 'p2.1-rederive',
	sessionTimeout: SESSION_TIMEOUT_MIN,
	switches: { hasSessionIds: true },
};

/**
 * Assert stamped session_ids agree with a fresh derivation: every derived
 * session's events share exactly one stamped id, and per user the stamped-id
 * count equals the derived session count (no splits, no merges).
 */
function assertStampedMatchesDerived(eventData) {
	const { sessions } = sessionize(eventData, { timeoutMs: SESSION_TIMEOUT_MIN * 60_000 });
	expect(sessions.length).toBeGreaterThan(0);

	const stampedPerUser = new Map();
	const derivedPerUser = new Map();
	for (const s of sessions) {
		const ids = new Set(s.events.map(e => e.session_id));
		expect(ids.size).toBe(1); // one derived session ⇒ one stamped id
		if (!stampedPerUser.has(s.userId)) stampedPerUser.set(s.userId, new Set());
		stampedPerUser.get(s.userId).add([...ids][0]);
		derivedPerUser.set(s.userId, (derivedPerUser.get(s.userId) || 0) + 1);
	}
	for (const [uid, count] of derivedPerUser) {
		expect(stampedPerUser.get(uid).size).toBe(count);
	}
}

describe.sequential('P2.1 session re-derivation after everything hook', () => {
	test('time-mutating hook: stamped ids match fresh sessionize; stampedDivergence 0', async () => {
		let shifted = 0;
		const results = await generate({
			...baseConfig,
			hook: (record, type) => {
				if (type !== 'everything' || !Array.isArray(record) || !record.length) return record;
				// Split a session the pre-hook stamping saw as one: find the first
				// same-session pair (gap ≤ 45 min, same UTC day) and shift the later
				// event +2h. Its stale stamped id then disagrees with any fresh
				// derivation — exactly the seam this fix closes.
				const sorted = [...record].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
				for (let i = 1; i < sorted.length; i++) {
					const prev = dayjs(sorted[i - 1].time);
					const cur = dayjs(sorted[i].time);
					if (cur.diff(prev, 'minute') <= 45 && cur.isSame(prev, 'day')) {
						sorted[i].time = cur.add(2, 'hour').toISOString();
						shifted++;
						break;
					}
				}
				return record;
			},
		});
		const { eventData } = results;
		expect(shifted).toBeGreaterThan(0); // hook actually fired
		expect(eventData.length).toBeGreaterThan(0);
		expect(eventData.every(e => e.session_id)).toBe(true);

		assertStampedMatchesDerived(eventData);

		const rows = emulateBreakdown(eventData, {
			type: 'sessionMetrics',
			metrics: ['count'],
			source: 'derived',
			sessionTimeoutMs: SESSION_TIMEOUT_MIN * 60_000,
		});
		expect(rows[0].stampedDivergence).toBe(0);
	}, timeout);

	test('no time-mutating hook: stampedDivergence stays 0', async () => {
		const { eventData } = await generate({ ...baseConfig });
		expect(eventData.length).toBeGreaterThan(0);

		assertStampedMatchesDerived(eventData);

		const rows = emulateBreakdown(eventData, {
			type: 'sessionMetrics',
			metrics: ['count'],
			source: 'derived',
			sessionTimeoutMs: SESSION_TIMEOUT_MIN * 60_000,
		});
		expect(rows[0].stampedDivergence).toBe(0);
	}, timeout);
});
