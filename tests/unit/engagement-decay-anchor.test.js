//@ts-nocheck
/**
 * applyEngagementDecay contracts:
 *   - never drops the signup (isFirstEvent) or the stitch isAuthEvent event;
 *   - for born users, measures days-since-birth from the first emitted event,
 *     not from adjustedCreated.
 */
import { describe, test, expect } from 'vitest';
import Chance from 'chance';
import dayjs from 'dayjs';
import { applyEngagementDecay } from '../../lib/orchestrators/user-loop.js';

const DAY = 86400000;
const created = dayjs('2025-01-01T00:00:00Z');
const at = (days) => new Date(created.valueOf() + days * DAY).toISOString();

const config = {
	events: [
		{ event: 'land' },
		{ event: 'sign up', isFirstEvent: true },
		{ event: 'log in', isAuthEvent: true },
		{ event: 'workout' },
	],
};

describe('applyEngagementDecay', () => {
	test('never drops the isFirstEvent signup or the stitch auth event', () => {
		const authTimeMs = Date.parse(at(10.5));
		const events = [
			{ event: 'land', time: at(0) },
			{ event: 'sign up', time: at(10) },
			{ event: 'log in', time: at(10.5) },
			{ event: 'log in', time: at(20) },
			{ event: 'workout', time: at(20) },
		];
		// step model, halfLife 1 day, floor 0: every event past day 1 drops.
		const decay = { model: 'step', halfLife: 1, floor: 0 };
		const out = applyEngagementDecay(events, decay, created, null, new Chance('decay'), null, {
			config, authTimeMs, anchorOnFirstEvent: false,
		});
		const names = out.map(e => `${e.event}@${e.time}`);
		expect(names).toContain(`sign up@${at(10)}`);
		expect(names).toContain(`log in@${at(10.5)}`);
		// A later, non-stitch auth event still decays.
		expect(names).not.toContain(`log in@${at(20)}`);
		expect(names).not.toContain(`workout@${at(20)}`);
	});

	test('born users anchor decay on the first emitted event, not adjustedCreated', () => {
		const events = [
			{ event: 'workout', time: at(30) },
			{ event: 'workout', time: at(30.2) },
			{ event: 'workout', time: at(30.4) },
		];
		const decay = { model: 'step', halfLife: 5, floor: 0 };
		const out = applyEngagementDecay(events, decay, created, null, new Chance('decay'), null, {
			config, authTimeMs: null, anchorOnFirstEvent: true,
		});
		expect(out).toHaveLength(3);
	});
});
