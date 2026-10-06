//@ts-nocheck
/**
 * amplifyWorldEvents clones must stay inside the user's lifetime: not before
 * the first event, not before the stitch for user_id-bearing events, not after
 * the lifetime end (churn or FIXED_NOW).
 */
import { describe, test, expect } from 'vitest';
import Chance from 'chance';
import { amplifyWorldEvents } from '../../lib/orchestrators/user-loop.js';

const DAY = 86400;
const start = Date.parse('2025-01-01T00:00:00Z') / 1000;
const iso = (unix) => new Date(unix * 1000).toISOString();
const we = [{ startUnix: start, endUnix: start + 40 * DAY, affectsEvents: '*', volumeMultiplier: 5 }];

describe('amplifyWorldEvents lifetime bounds', () => {
	test('clones never land before the stitch, before the first event, or after the lifetime end', () => {
		const firstUnix = start + 20 * DAY;
		const authUnix = start + 25 * DAY;
		const endUnix = start + 30 * DAY;
		const events = [
			{ event: 'land', time: iso(firstUnix), device_id: 'd1', insert_id: 'a' },
			{ event: 'sign up', time: iso(authUnix), device_id: 'd1', user_id: 'u1', insert_id: 'b' },
			{ event: 'workout', time: iso(authUnix + DAY), user_id: 'u1', insert_id: 'c' },
		];
		const out = amplifyWorldEvents(events, we, new Chance('amp'), start + 90 * DAY,
			{ startUnix: firstUnix, authUnix, endUnix });
		const clones = out.slice(events.length);
		expect(clones.length).toBe(12);
		for (const c of clones) {
			const t = Date.parse(c.time) / 1000;
			expect(t).toBeGreaterThanOrEqual(firstUnix);
			expect(t).toBeLessThan(endUnix);
			if (c.user_id) expect(t).toBeGreaterThanOrEqual(authUnix);
		}
	});
});
