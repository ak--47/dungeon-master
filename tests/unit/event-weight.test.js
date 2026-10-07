//@ts-nocheck
/**
 * Event `weight` (standalone pool and catch-all funnel): whole numbers >= 1,
 * no upper cap. A value the validator changes (0, negatives, fractions) lands
 * in `result.warnings` under `events[<name>].weight`.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { validateDungeonConfig, eventWeight } from '../../lib/core/config-validator.js';
import { initChance } from '../../lib/utils/utils.js';

const base = (events) => ({
	seed: 'event-weight', numUsers: 10, numDays: 30, avgEventsPerUserPerDay: 1, verbose: false, events,
});

beforeEach(() => initChance('event-weight'));

describe('event weight', () => {
	test('eventWeight floors to a whole number >= 1 and has no upper cap', () => {
		expect(eventWeight(26)).toBe(26);
		expect(eventWeight(250)).toBe(250);
		expect(eventWeight(2.7)).toBe(2);
		expect(eventWeight(0)).toBe(1);
		expect(eventWeight(-3)).toBe(1);
		expect(eventWeight(undefined)).toBe(1);
		expect(eventWeight(NaN)).toBe(1);
	});

	test('catch-all funnel repeats an event by its full weight', () => {
		const cfg = validateDungeonConfig(base([{ event: 'app opened', weight: 26 }, { event: 'b', weight: 1 }]));
		const catchAll = cfg.funnels.find(f => f._catchAll);
		expect(catchAll.sequence.filter(e => e === 'app opened').length).toBe(26);
		expect(cfg._warnings.find(w => /^events\[.*\]\.weight$/.test(w.key))).toBeUndefined();
	});

	test('a weight the validator changes is reported with the event name', () => {
		const cfg = validateDungeonConfig(base([{ event: 'never', weight: 0 }, { event: 'half', weight: 2.5 }, { event: 'ok', weight: 4 }]));
		const ws = cfg._warnings.filter(w => /^events\[.*\]\.weight$/.test(w.key));
		expect(ws).toHaveLength(2);
		expect(ws.find(w => w.key === 'events[never].weight')).toMatchObject({ requested: 0, applied: 1, severity: 'clamp' });
		expect(ws.find(w => w.key === 'events[half].weight')).toMatchObject({ requested: 2.5, applied: 2, severity: 'clamp' });
	});
});
