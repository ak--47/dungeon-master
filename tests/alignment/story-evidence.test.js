import { describe, expect, test, vi } from 'vitest';
import { emulateBreakdown } from '../../lib/verify/emulate-breakdown.js';
import { evaluateAssertion } from '../../lib/verify/story-runner.js';

const all = { all: { where: {} } };
const frequency = {
	type: 'frequencyByFrequency',
	metricEvent: 'Active',
	breakdownByFrequencyOf: 'Active',
};

function countAssertion(breakdown, column, target, extra = {}) {
	return {
		breakdown,
		select: all,
		expect: { metric: `all.${column}`, op: '>=', target },
		minCohort: 50,
		...extra,
	};
}

function active(userId, dayIndex = 0, extra = {}) {
	return {
		event: 'Active',
		user_id: userId,
		time: new Date(Date.UTC(2026, 0, dayIndex + 1)).toISOString(),
		...extra,
	};
}

describe('story minCohort independent-user evidence', () => {
	test('one user across 100 periods cannot establish a cohort of 50', () => {
		const events = Array.from({ length: 100 }, (_, dayIndex) => active('same-user', dayIndex));
		const breakdown = { ...frequency, timeBucket: 'day' };
		const rows = emulateBreakdown(events, breakdown);
		const result = evaluateAssertion(rows, countAssertion(breakdown, 'user_count', 100));

		expect(rows).toHaveLength(100);
		expect(result.observed).toBe(100);
		expect(result.verdict).toBe('WEAK');
		expect(result.detail).toMatch(/lower bound 1\b.*minCohort 50/);
	});

	test('ordinary disjoint frequency bins still add within one report period', () => {
		const events = Array.from({ length: 60 }, (_, userIndex) => {
			const userId = `user-${userIndex}`;
			return userIndex < 30 ? [active(userId)] : [active(userId), active(userId, 1)];
		}).flat();
		const rows = emulateBreakdown(events, frequency);

		expect(rows).toEqual([
			{ metric_freq: 1, breakdown_freq: 1, user_count: 30 },
			{ metric_freq: 2, breakdown_freq: 2, user_count: 30 },
		]);
		expect(evaluateAssertion(rows, countAssertion(frequency, 'user_count', 60)).verdict).toBe('NAILED');
	});

	test.each(['frequencyByFrequency', 'aggregatePerUser'])('%s uses the maximum per-period disjoint-bin total', (type) => {
		const rows = ['2026-W01', '2026-W02'].flatMap(period => [
			{ period, metric_freq: 1, breakdown_freq: 1, user_count: 30 },
			{ period, metric_freq: 2, breakdown_freq: 2, user_count: 30 },
		]);
		const assertion = countAssertion({ type, timeBucket: 'week' }, 'user_count', 120);

		expect(evaluateAssertion(rows, assertion).verdict).toBe('NAILED');
		const capped = evaluateAssertion(rows, { ...assertion, minCohort: 100 });
		expect(capped.verdict).toBe('WEAK');
		expect(capped.detail).toMatch(/lower bound 60\b/);
	});

	test('duplicate frequency cells do not add independent users', () => {
		const rows = Array.from({ length: 100 }, () => ({ metric_freq: 1, breakdown_freq: 1, user_count: 1 }));
		expect(evaluateAssertion(rows, countAssertion(frequency, 'user_count', 100)).verdict).toBe('WEAK');
	});

	test('event segments can overlap even within one period', () => {
		const breakdown = { type: 'eventBreakdown', event: 'Active', breakdownProperty: 'channel', timeBucket: 'day' };
		const channel = Array.from({ length: 100 }, (_, index) => `channel-${index}`);
		const rows = emulateBreakdown([active('same-user', 0, { channel })], breakdown);
		const result = evaluateAssertion(rows, countAssertion(breakdown, 'count', 100));

		expect(rows).toHaveLength(100);
		expect(result.verdict).toBe('WEAK');
		expect(result.detail).toMatch(/lower bound 1\b/);
	});

	test.each(['general', 'unique', 'sessions'])('eventBreakdown %s uses total_users, not the metric or row count', (countType) => {
		const breakdown = { type: 'eventBreakdown', event: 'Active', breakdownProperty: 'channel', countType };
		const events = Array.from({ length: 60 }, (_, index) => active(`user-${index}`, 0, { channel: 'web' }));
		const rows = emulateBreakdown(events, breakdown);

		expect(rows).toEqual([{ value: 'web', count: 60, total_users: 60 }]);
		expect(evaluateAssertion(rows, countAssertion(breakdown, 'count', 60)).verdict).toBe('NAILED');
	});

	test('segmented user_count rows without a disjoint-bin contract use a maximum', () => {
		const rows = [{ segment: 'first', user_count: 30 }, { segment: 'second', user_count: 30 }];
		const result = evaluateAssertion(rows, countAssertion({ type: 'duckdb', sql: 'select 1' }, 'user_count', 60));
		expect(result.verdict).toBe('WEAK');
		expect(result.detail).toMatch(/lower bound 30\b/);
	});

	test.each(['duckdb', 'warehouse', 'warehouse-stats', 'sessionMetrics'])('%s row counts are not user evidence', (type) => {
		const rows = Array.from({ length: 100 }, (_, index) => ({ metric: `reference-${index}`, count: 1 }));
		const result = evaluateAssertion(rows, countAssertion({ type }, 'count', 100));
		expect(result.verdict).toBe('WEAK');
		expect(result.detail).toMatch(/insufficient[- ]evidence.*minCohort 50/);
	});

	test.each([NaN, Infinity, -1, 50.5, '100'])('invalid user_count %s cannot establish a denominator', (userCount) => {
		const result = evaluateAssertion([{ count: 1, user_count: userCount }], countAssertion(
			{ type: 'aggregatePerUser' }, 'count', 1, { minCohort: 1 },
		));
		expect(result.verdict).toBe('WEAK');
		expect(result.detail).toMatch(/insufficient[- ]evidence/);
	});

	test('a metadata-only selection has no independent-user denominator', () => {
		const rows = Array.from({ length: 100 }, (_, index) => ({ period: `period-${index}`, _empty: true }));
		const result = evaluateAssertion(rows, { breakdown: frequency, minCohort: 50, assert: () => ({ pass: true }) });
		expect(result.verdict).toBe('WEAK');
		expect(result.detail).toMatch(/insufficient[- ]evidence/);
	});

	test('empty-period markers neither add users nor invalidate supported data rows', () => {
		const rows = [
			{ period: '2026-W01', metric_freq: 1, breakdown_freq: 1, user_count: 60 },
			{ period: '2026-W02', _empty: true },
		];
		const result = evaluateAssertion(rows, { breakdown: frequency, minCohort: 50, assert: () => ({ pass: true }) });
		expect(result.verdict).toBe('STRONG');
	});

	test('reference rows alongside valid counts cannot supply an unknown denominator', () => {
		const rows = [{ user_count: 60 }, { metric: 'reference', total: 100 }];
		const result = evaluateAssertion(rows, { breakdown: frequency, minCohort: 50, assert: () => ({ pass: true }) });
		expect(result.verdict).toBe('WEAK');
		expect(result.detail).toMatch(/insufficient[- ]evidence/);
	});

	test('time-bucketed frequency rows without period labels cannot be safely summed', () => {
		const rows = [
			{ metric_freq: 1, breakdown_freq: 1, user_count: 30 },
			{ metric_freq: 2, breakdown_freq: 2, user_count: 30 },
		];
		const result = evaluateAssertion(rows, countAssertion({ ...frequency, timeBucket: 'day' }, 'user_count', 60));
		expect(result.verdict).toBe('WEAK');
		expect(result.detail).toMatch(/lower bound 30\b/);
	});

	test.each([{}, { rollingWindow: 7 }, { cumulative: true }])('uniques %j uses the largest distinct-user interval', (options) => {
		const events = Array.from({ length: 100 }, (_, dayIndex) => active('same-user', dayIndex));
		const breakdown = { type: 'uniques', event: 'Active', ...options };
		const rows = emulateBreakdown(events, breakdown);
		const result = evaluateAssertion(rows, countAssertion(breakdown, 'uniques', 100));
		expect(result.verdict).toBe('WEAK');
		expect(result.detail).toMatch(/lower bound 1\b/);
		expect(evaluateAssertion(rows, countAssertion(breakdown, 'uniques', 100, { minCohort: 1 })).verdict).toBe('NAILED');
	});

	test('session-counted uniques cannot masquerade as unique users', () => {
		const events = Array.from({ length: 100 }, (_, dayIndex) => active('same-user', dayIndex));
		const breakdown = { type: 'uniques', event: 'Active', unit: 'range', countType: 'sessions' };
		const rows = emulateBreakdown(events, breakdown);
		expect(rows).toEqual([{ period: 'range', uniques: 100 }]);
		const result = evaluateAssertion(rows, countAssertion(breakdown, 'uniques', 100, { minCohort: 1 }));
		expect(result.verdict).toBe('WEAK');
		expect(result.detail).toMatch(/insufficient[- ]evidence/);
	});

	test('retention cohort_size does not add across horizons or overlapping return segments', () => {
		const rows = ['first', 'second'].flatMap(segment => [1, 7, 30].map(day => ({
			segment, day, retained_count: 5, cohort_size: 30, retained_pct: 5 / 30,
		})));
		const assertion = countAssertion({ type: 'retention', segmentOn: 'return' }, 'retained_count', 30);
		const result = evaluateAssertion(rows, assertion);
		expect(result.verdict).toBe('WEAK');
		expect(result.detail).toMatch(/lower bound 30\b/);
		expect(evaluateAssertion(rows, { ...assertion, minCohort: 30 }).verdict).toBe('NAILED');
	});
});

describe('story minCohort funnel entrants', () => {
	const breakdown = { type: 'funnelFrequency', steps: ['Start', 'Finish'], breakdownByFrequencyOf: 'Active' };
	const rows = [1, 2].flatMap(breakdownFreq => [
		{ step: 'Start', step_index: 0, breakdown_freq: breakdownFreq, conversions: 30, conversion_pct: 100 },
		{ step: 'Finish', step_index: 1, breakdown_freq: breakdownFreq, conversions: 3, conversion_pct: 10 },
	]);
	const assertion = countAssertion(breakdown, 'conversions', 6, {
		select: { all: { where: { step_index: 1 } } },
	});

	test('selected finish rows use step-zero entrants from their distinct report bins', () => {
		const result = evaluateAssertion(rows, assertion);
		expect(result).toMatchObject({ verdict: 'NAILED', observed: 6 });
	});

	test('the emulator emits unique entrants even when only a few users finish', () => {
		const events = Array.from({ length: 60 }, (_, userIndex) => {
			const userId = `user-${userIndex}`;
			const userEvents = [active(userId), active(userId, 0, { event: 'Start' })];
			if (userIndex >= 30) userEvents.push(active(userId, 1));
			if (userIndex % 10 === 0) userEvents.push(active(userId, 1, { event: 'Finish' }));
			return userEvents;
		}).flat();
		const emitted = emulateBreakdown(events, breakdown);
		expect(emitted.filter(row => row.step_index === 0).map(row => row.conversions)).toEqual([30, 30]);
		expect(evaluateAssertion(emitted, assertion)).toMatchObject({ verdict: 'NAILED', observed: 6 });
	});

	test('selecting multiple steps never counts the same entrant twice', () => {
		const result = evaluateAssertion(rows, countAssertion(breakdown, 'conversions', 66, { minCohort: 65 }));
		expect(result.verdict).toBe('WEAK');
		expect(result.detail).toMatch(/lower bound 60\b/);
	});

	test('other frequency bins cannot supply a selected bin\'s entrants', () => {
		const selected = { all: { where: { step_index: 1, breakdown_freq: 1 } } };
		const result = evaluateAssertion(rows, { ...assertion, select: selected, expect: { metric: 'all.conversions', op: '>=', target: 3 } });
		expect(result.verdict).toBe('WEAK');
		expect(result.detail).toMatch(/lower bound 30\b/);
	});

	test('repeated funnel periods use a maximum, not a sum of entrants', () => {
		const repeated = ['2026-W01', '2026-W02'].flatMap(period => rows.map(row => ({ period, ...row })));
		const result = evaluateAssertion(repeated, { ...assertion, minCohort: 100, expect: { metric: 'all.conversions', op: '>=', target: 12 } });
		expect(result.verdict).toBe('WEAK');
		expect(result.detail).toMatch(/lower bound 60\b/);
	});

	test.each(['totals', 'sessions'])('%s conversions do not prove unique entrants', (countMode) => {
		const result = evaluateAssertion(rows, { ...assertion, breakdown: { ...breakdown, countMode }, minCohort: 1 });
		expect(result.verdict).toBe('WEAK');
		expect(result.detail).toMatch(/insufficient[- ]evidence/);
	});

	test('a missing step-zero denominator cannot be inferred from conversions', () => {
		const result = evaluateAssertion(rows.filter(row => row.step_index === 1), { ...assertion, minCohort: 1 });
		expect(result.verdict).toBe('WEAK');
		expect(result.detail).toMatch(/insufficient[- ]evidence/);
	});

	test('a different period cannot supply the missing entrant denominator', () => {
		const mismatched = rows.map(row => ({ ...row, period: row.step_index === 0 ? '2026-W01' : '2026-W02' }));
		const result = evaluateAssertion(mismatched, { ...assertion, minCohort: 1 });
		expect(result.verdict).toBe('WEAK');
		expect(result.detail).toMatch(/insufficient[- ]evidence/);
	});

	test('duplicate entrant rows are deduplicated by report bin', () => {
		const result = evaluateAssertion([...rows, ...rows.filter(row => row.step_index === 0)], { ...assertion, minCohort: 100 });
		expect(result.verdict).toBe('WEAK');
		expect(result.detail).toMatch(/lower bound 60\b/);
	});

	test('every selected funnel bin needs its own entrant row', () => {
		const incomplete = rows.filter(row => row.step_index !== 0 || row.breakdown_freq !== 2);
		const result = evaluateAssertion(incomplete, { ...assertion, minCohort: 1 });
		expect(result.verdict).toBe('WEAK');
		expect(result.detail).toMatch(/insufficient[- ]evidence/);
	});
});

describe('story minCohort custom assertions and compatibility', () => {
	const rows = [{ segment: 'small', user_count: 1 }, { segment: 'large', user_count: 100 }];
	const breakdown = { type: 'aggregatePerUser' };

	test.each([{ pass: true }, { pass: true, verdict: 'NAILED' }, { pass: true, verdict: 'STRONG' }])('custom result %j cannot bypass selected-cohort evidence', (response) => {
		const callback = vi.fn(() => ({ ...response, detail: 'callback detail' }));
		const ctx = { marker: true };
		const result = evaluateAssertion(rows, {
			breakdown,
			select: { small: { where: { segment: 'small' } } },
			minCohort: 50,
			assert: callback,
		}, ctx);

		expect(callback).toHaveBeenCalledTimes(1);
		expect(callback).toHaveBeenCalledWith(rows, ctx);
		expect(result).toMatchObject({ verdict: 'WEAK', observed: null });
		expect(result.detail).toMatch(/callback detail.*minCohort 50/);
	});

	test('custom assertions without select use the full result rows', () => {
		const repeated = Array.from({ length: 100 }, (_, index) => ({ period: `period-${index}`, user_count: 1 }));
		const result = evaluateAssertion(repeated, { breakdown, minCohort: 50, assert: () => ({ pass: true }) });
		expect(result.verdict).toBe('WEAK');
		expect(evaluateAssertion(rows, { breakdown, minCohort: 50, assert: () => ({ pass: true }) }).verdict).toBe('STRONG');
	});

	test('an explicit empty select cannot turn the cohort minimum into Infinity', () => {
		const result = evaluateAssertion(rows, { breakdown, select: {}, minCohort: 50, assert: () => ({ pass: true }) });
		expect(result.verdict).toBe('WEAK');
		expect(result.detail).toMatch(/insufficient[- ]evidence/);
	});

	test('custom assertions apply the minimum to every named selection', () => {
		const result = evaluateAssertion(rows, {
			breakdown,
			select: { large: { where: { segment: 'large' } }, small: { where: { segment: 'small' } } },
			minCohort: 50,
			assert: () => ({ pass: true }),
		});
		expect(result.verdict).toBe('WEAK');
		expect(result.detail).toMatch(/lower bound 1\b/);
	});

	test('callback mutations cannot increase the captured evidence or lower the floor', () => {
		const mutableRows = [{ user_count: 1 }];
		const assertion = {
			breakdown,
			minCohort: 50,
			assert: () => {
				mutableRows[0].user_count = 100;
				assertion.minCohort = 1;
				return { pass: true, verdict: 'NAILED' };
			},
		};
		const result = evaluateAssertion(mutableRows, assertion);
		expect(result.verdict).toBe('WEAK');
		expect(result.detail).toMatch(/lower bound 1\b.*minCohort 50/);
	});

	test.each(['NONE', 'INVERSE', 'WEAK'])('the cap never promotes a custom %s verdict', (verdict) => {
		expect(evaluateAssertion([], { breakdown, minCohort: 50, assert: () => ({ pass: false, verdict }) }).verdict).toBe(verdict);
	});

	test('missing and empty metric selections retain their errors', () => {
		const assertion = countAssertion(breakdown, 'user_count', 1);
		const missing = evaluateAssertion(rows, { ...assertion, select: {} });
		const empty = evaluateAssertion(rows, { ...assertion, select: { all: { where: { segment: 'absent' } } } });
		expect(missing).toMatchObject({ verdict: 'NONE', observed: null });
		expect(missing.detail).toMatch(/select has no such row-set/);
		expect(empty).toMatchObject({ verdict: 'NONE', observed: null });
		expect(empty.detail).toMatch(/selection "all" is empty/);
	});

	test('assertions without minCohort keep metric and callback behavior', () => {
		const repeated = Array.from({ length: 100 }, (_, index) => ({ period: `period-${index}`, user_count: 1 }));
		const result = evaluateAssertion(repeated, countAssertion(breakdown, 'user_count', 100, { minCohort: undefined }));
		expect(result).toMatchObject({ verdict: 'NAILED', observed: 100 });
		expect(Object.keys(result)).toEqual(['verdict', 'observed', 'detail']);
		expect(evaluateAssertion([{ count: 1 }], {
			breakdown,
			select: { invalid: { where: { count: { op: 'invalid', value: 1 } } } },
			assert: () => ({ pass: true, verdict: 'NAILED' }),
		}).verdict).toBe('NAILED');
	});
});