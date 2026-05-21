/**
 * v1.5.1: AsyncLocalStorage-scoped dataset-window context.
 *
 * Replaces the legacy module-scoped `DATASET_NOW` / `DATASET_BEGIN` mutable
 * state in `lib/utils/utils.js`. Each `generate()` call wraps the pipeline in
 * `runWithDataset(begin, now, fn)`, and the factory thunks (`date`, `day`,
 * `dateRange`, `TimeSoup`, `validTime`) read from the ALS store via
 * `getDatasetNow()` / `getDatasetBegin()` instead of module globals.
 *
 * This makes concurrent in-process `generate()` calls safe with respect to
 * the dataset-window dimension. RNG scoping is a SEPARATE concurrency hole
 * — see TODOs.md "Considered but punted" for the follow-up plan.
 *
 * Trip-ups (see plans/archived/globals-killplan-1.5.1/kill-globals.md §7):
 *   - ALS does NOT propagate across child_process.fork / worker_threads.
 *   - Tests that import dungeon configs at top-level evaluate thunks at
 *     import time — those thunks fall back to wall-clock if invoked outside
 *     a `runWithDataset` scope.
 *   - Callbacks scheduled via setImmediate / setTimeout / native event
 *     emitters MAY lose context. Audit at the orchestrator level.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
dayjs.extend(utc);

/** @type {AsyncLocalStorage<{ begin: number, now: number }>} */
const datasetALS = new AsyncLocalStorage();

/**
 * Legacy fallback — written by the deprecated `setDatasetNow` / `setDatasetBegin`
 * shims in `lib/utils/utils.js`. Used ONLY when no ALS scope is active. This
 * keeps existing tests that call the setters directly (instead of wrapping in
 * `runWithDataset`) functional through v1.5.1. v1.6 may remove the shims.
 *
 * @type {{ begin: number|null, now: number|null }}
 */
const legacyFallback = { begin: null, now: null };

/** @internal — used by `setDatasetNow` / `setDatasetBegin` shims. */
export function _setLegacyDatasetNow(unixSeconds) {
	if (typeof unixSeconds === 'number' && Number.isFinite(unixSeconds)) {
		legacyFallback.now = unixSeconds;
	}
}

/** @internal — used by `setDatasetNow` / `setDatasetBegin` shims. */
export function _setLegacyDatasetBegin(unixSeconds) {
	if (typeof unixSeconds === 'number' && Number.isFinite(unixSeconds)) {
		legacyFallback.begin = unixSeconds;
	}
}

/**
 * Run `fn` inside a dataset-window scope. Factory thunks invoked anywhere in
 * the async call chain (sync or via `await`) will read the scoped window
 * instead of the module fallback.
 *
 * @template T
 * @param {number} datasetBeginUnix
 * @param {number} datasetNowUnix
 * @param {() => T} fn
 * @returns {T}
 */
export function runWithDataset(datasetBeginUnix, datasetNowUnix, fn) {
	return datasetALS.run({ begin: datasetBeginUnix, now: datasetNowUnix }, fn);
}

/**
 * Read the scoped dataset-now value. Resolution order:
 *   1. ALS store (active `runWithDataset` scope) — production pipeline path.
 *   2. Legacy fallback (set via deprecated `setDatasetNow` shim) — for tests.
 *   3. Wall-clock `dayjs.utc()` — last-resort default.
 *
 * @returns {dayjs.Dayjs}
 */
export function getDatasetNow() {
	const store = datasetALS.getStore();
	if (store) return dayjs.unix(store.now).utc();
	if (legacyFallback.now !== null) return dayjs.unix(legacyFallback.now).utc();
	return dayjs.utc();
}

/**
 * Read the scoped dataset-begin value. Same resolution as `getDatasetNow`,
 * falling back to wall-clock minus 30 days.
 *
 * @returns {dayjs.Dayjs}
 */
export function getDatasetBegin() {
	const store = datasetALS.getStore();
	if (store) return dayjs.unix(store.begin).utc();
	if (legacyFallback.begin !== null) return dayjs.unix(legacyFallback.begin).utc();
	return dayjs.utc().subtract(30, 'day');
}

/**
 * @returns {boolean} true when called inside a runWithDataset scope.
 */
export function hasDatasetScope() {
	return datasetALS.getStore() !== undefined;
}
