//@ts-nocheck
/**
 * v1.5.1: AsyncLocalStorage-scoped dataset window.
 *
 * Replaces the legacy module-scoped `DATASET_NOW` / `DATASET_BEGIN` globals.
 * Tests cover: out-of-scope fallback, scoped values, parallel isolation, and
 * async-boundary propagation.
 */

import { describe, test, expect } from 'vitest';
import {
	runWithDataset,
	getDatasetNow,
	getDatasetBegin,
	hasDatasetScope,
} from '../../lib/utils/dataset-context.js';
import dayjs from 'dayjs';

const A_BEGIN = 1_700_000_000;
const A_NOW = A_BEGIN + 30 * 86400;
const B_BEGIN = 1_600_000_000;
const B_NOW = B_BEGIN + 60 * 86400;

describe('v1.5.1 dataset-context (AsyncLocalStorage)', () => {
	test('out-of-scope: getters return wall-clock fallback', () => {
		expect(hasDatasetScope()).toBe(false);
		const now = getDatasetNow();
		const begin = getDatasetBegin();
		// Should be close to wall-clock now / now-30d (within 5 minutes for slow CI).
		const wallNow = dayjs.utc();
		expect(Math.abs(now.unix() - wallNow.unix())).toBeLessThan(300);
		expect(Math.abs(begin.unix() - wallNow.subtract(30, 'day').unix())).toBeLessThan(300);
	});

	test('runWithDataset scopes the values for sync callers', () => {
		const result = runWithDataset(A_BEGIN, A_NOW, () => {
			expect(hasDatasetScope()).toBe(true);
			return {
				now: getDatasetNow().unix(),
				begin: getDatasetBegin().unix(),
			};
		});
		expect(result.now).toBe(A_NOW);
		expect(result.begin).toBe(A_BEGIN);
		// After the scope ends, getters revert to wall-clock fallback.
		expect(hasDatasetScope()).toBe(false);
	});

	test('runWithDataset propagates across await boundaries', async () => {
		const result = await runWithDataset(A_BEGIN, A_NOW, async () => {
			await Promise.resolve();
			await new Promise(r => setTimeout(r, 1));
			return {
				now: getDatasetNow().unix(),
				begin: getDatasetBegin().unix(),
			};
		});
		expect(result.now).toBe(A_NOW);
		expect(result.begin).toBe(A_BEGIN);
	});

	test('parallel runWithDataset calls do not clobber each other', async () => {
		const [a, b] = await Promise.all([
			runWithDataset(A_BEGIN, A_NOW, async () => {
				await new Promise(r => setTimeout(r, 5));
				return { now: getDatasetNow().unix(), begin: getDatasetBegin().unix() };
			}),
			runWithDataset(B_BEGIN, B_NOW, async () => {
				await new Promise(r => setTimeout(r, 5));
				return { now: getDatasetNow().unix(), begin: getDatasetBegin().unix() };
			}),
		]);
		expect(a.now).toBe(A_NOW);
		expect(a.begin).toBe(A_BEGIN);
		expect(b.now).toBe(B_NOW);
		expect(b.begin).toBe(B_BEGIN);
	});

	test('nested runWithDataset uses innermost scope', () => {
		runWithDataset(A_BEGIN, A_NOW, () => {
			expect(getDatasetNow().unix()).toBe(A_NOW);
			runWithDataset(B_BEGIN, B_NOW, () => {
				expect(getDatasetNow().unix()).toBe(B_NOW);
				expect(getDatasetBegin().unix()).toBe(B_BEGIN);
			});
			// Outer scope restored after inner finishes.
			expect(getDatasetNow().unix()).toBe(A_NOW);
		});
	});
});
