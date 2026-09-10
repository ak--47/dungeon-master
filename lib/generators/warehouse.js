/** @typedef {import('../../types').Dungeon} Dungeon */
/** @typedef {import('../../types').WarehouseMetricConfig} WarehouseMetricConfig */
/** @typedef {import('../../types').ResolvedWarehouseMetricConfig} ResolvedWarehouseMetricConfig */

export const VALID_WAREHOUSE_TYPES = Object.freeze(['additive', 'point-in-time']);
export const VALID_WAREHOUSE_GRAINS = Object.freeze(['day', 'week', 'month']);
export const VALID_WAREHOUSE_MEASURES = Object.freeze(['count', 'sum', 'avg', 'dau', 'users']);
export const VALID_WAREHOUSE_FORMATS = Object.freeze(['csv', 'json']);

const METRIC_NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HISTORY_WARN_BY_GRAIN = Object.freeze({ day: 1095, week: 156, month: 36 });
const DAY_SECONDS = 86400;

export function bucketStart(unixSec, grain) {
	if (!Number.isFinite(unixSec)) throw new Error('bucketStart requires a finite unixSec');

	switch (grain) {
		case 'day': {
			return Math.floor(unixSec / DAY_SECONDS) * DAY_SECONDS;
		}
		case 'week': {
			const dayIndex = Math.floor(unixSec / DAY_SECONDS);
			const weekStartIndex = dayIndex - ((dayIndex + 3) % 7);
			return weekStartIndex * DAY_SECONDS;
		}
		case 'month': {
			const date = new Date(unixSec * 1000);
			return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000;
		}
		default:
			throw new Error(`Unsupported warehouse grain "${grain}"`);
	}
}

export function nextBucket(startSec, grain) {
	if (!Number.isFinite(startSec)) throw new Error('nextBucket requires a finite startSec');

	switch (grain) {
		case 'day':
			return startSec + DAY_SECONDS;
		case 'week':
			return startSec + (7 * DAY_SECONDS);
		case 'month': {
			const date = new Date(startSec * 1000);
			return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) / 1000;
		}
		default:
			throw new Error(`Unsupported warehouse grain "${grain}"`);
	}
}

export function buildBuckets(beginSec, endSec, grain, history = 0) {
	if (!Number.isFinite(beginSec) || !Number.isFinite(endSec)) {
		throw new Error('buildBuckets requires finite beginSec and endSec');
	}
	if (!Number.isInteger(history) || history < 0) {
		throw new Error('buildBuckets history must be an integer >= 0');
	}

	const windowStart = bucketStart(beginSec, grain);
	const windowEnd = bucketStart(endSec, grain);
	if (windowEnd < windowStart) return [];

	const buckets = [];
	for (let cursor = windowStart; cursor <= windowEnd; cursor = nextBucket(cursor, grain)) {
		buckets.push(cursor);
	}

	let prepend = windowStart;
	for (let index = 0; index < history; index += 1) {
		prepend = previousBucket(prepend, grain);
		buckets.unshift(prepend);
	}

	return buckets;
}

export class WarehouseAccumulator {
	constructor(specs, { FIXED_BEGIN, FIXED_NOW }) {
		if (!Array.isArray(specs)) throw new Error('WarehouseAccumulator specs must be an array');
		if (!Number.isFinite(FIXED_BEGIN) || !Number.isFinite(FIXED_NOW)) {
			throw new Error('WarehouseAccumulator requires finite FIXED_BEGIN and FIXED_NOW');
		}

		this.FIXED_BEGIN = FIXED_BEGIN;
		this.FIXED_NOW = FIXED_NOW;
		this.warnings = [];
		this.warnedMetrics = new Set();
		this.metrics = new Map();
		this.eventIndex = new Map();

		for (const spec of specs) {
			const state = {
				spec,
				series: new Map(),
			};
			this.metrics.set(spec.name, state);

			for (const eventName of spec.source.event || []) {
				this.addEventIndex(eventName, spec.name, 'plus');
			}
			for (const eventName of spec.source.minus || []) {
				this.addEventIndex(eventName, spec.name, 'minus');
			}
		}
	}

	addEventIndex(eventName, metricName, leg) {
		const refs = this.eventIndex.get(eventName) || [];
		refs.push({ metricName, leg });
		this.eventIndex.set(eventName, refs);
	}

	ingest(events) {
		for (const event of events || []) {
			const refs = this.eventIndex.get(event?.event);
			if (!refs || refs.length === 0) continue;

			const unixSec = Date.parse(event.time) / 1000;
			if (!Number.isFinite(unixSec)) continue;
			if (unixSec < this.FIXED_BEGIN || unixSec > this.FIXED_NOW) continue;

			for (const ref of refs) {
				const metric = this.metrics.get(ref.metricName);
				if (!metric) continue;
				const { spec } = metric;
				if (spec.source.where && !spec.source.where(event)) continue;

				const seriesKey = buildSeriesKey(spec, event);
				const bucketSec = bucketStart(unixSec, spec.grain);
				const cell = this.getOrCreateCell(metric, seriesKey, bucketSec);
				updateCell({
					cell,
					event,
					spec,
					leg: ref.leg,
					unixSec,
					warn: (message) => this.warnOnce(spec.name, message),
				});
			}
		}
	}

	getCell(metricName, seriesKey, bucketStartSec) {
		const metric = this.metrics.get(metricName);
		if (!metric) throw new Error(`Unknown warehouse metric "${metricName}"`);

		const key = seriesKey ?? '';
		const bucketMap = metric.series.get(key);
		if (bucketMap?.has(bucketStartSec)) return bucketMap.get(bucketStartSec);
		return createEmptyCell(metric.spec.source.measure);
	}

	getOrCreateCell(metric, seriesKey, bucketStartSec) {
		const key = seriesKey ?? '';
		let bucketMap = metric.series.get(key);
		if (!bucketMap) {
			bucketMap = new Map();
			metric.series.set(key, bucketMap);
		}

		let cell = bucketMap.get(bucketStartSec);
		if (!cell) {
			cell = createEmptyCell(metric.spec.source.measure);
			bucketMap.set(bucketStartSec, cell);
		}

		return cell;
	}

	warnOnce(metricName, message) {
		if (this.warnedMetrics.has(metricName)) return;
		this.warnedMetrics.add(metricName);
		this.warnings.push(message);
	}
}

/**
 * Validates and normalizes the top-level `warehouseMetrics` config surface.
 * Throws on malformed entries; warnings cover lossy normalization only.
 *
 * @param {Dungeon & { warehouseMetrics?: WarehouseMetricConfig[] | null, format?: string }} config
 * @returns {{ warehouseMetrics: ResolvedWarehouseMetricConfig[], warnings: string[] }}
 */
export function validateWarehouseMetrics(config) {
	const specs = config?.warehouseMetrics;
	if (specs === undefined || specs === null) return { warehouseMetrics: [], warnings: [] };
	if (!Array.isArray(specs)) throw new Error('warehouseMetrics must be an array');

	const warnings = [];
	const seenNames = new Set();
	const eventMap = new Map((config?.events || []).map((event) => [event.event, event]));
	const superProps = config?.superProps && typeof config.superProps === 'object' ? config.superProps : {};

	const warehouseMetrics = specs.map((spec, index) => {
		const label = `warehouseMetrics[${index}]`;
		if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
			throw new Error(`${label} must be an object`);
		}

		const name = spec.name;
		if (typeof name !== 'string' || !METRIC_NAME_RE.test(name)) {
			throw new Error(`${label}.name must match ${METRIC_NAME_RE}`);
		}
		if (seenNames.has(name)) {
			throw new Error(`${label}.name "${name}" must be unique across warehouseMetrics`);
		}
		seenNames.add(name);

		const type = spec.type ?? 'additive';
		if (!VALID_WAREHOUSE_TYPES.includes(type)) {
			throw new Error(`${label}.type must be one of ${VALID_WAREHOUSE_TYPES.join(', ')}`);
		}

		const grain = spec.grain ?? 'day';
		if (!VALID_WAREHOUSE_GRAINS.includes(grain)) {
			throw new Error(`${label}.grain must be one of ${VALID_WAREHOUSE_GRAINS.join(', ')}`);
		}

		const sparse = spec.sparse ?? false;
		if (typeof sparse !== 'boolean') {
			throw new Error(`${label}.sparse must be a boolean`);
		}
		if (sparse && type !== 'point-in-time') {
			throw new Error(`${label}.sparse is only valid with type "point-in-time"`);
		}

		const source = spec.source;
		if (!source || typeof source !== 'object' || Array.isArray(source)) {
			throw new Error(`${label}.source must be an object`);
		}

		const plusEvents = normalizeStringArray(source.event, `${label}.source.event`);
		if (plusEvents.length === 0) {
			throw new Error(`${label}.source.event must list at least one event`);
		}
		const minusEvents = normalizeOptionalStringArray(source.minus, `${label}.source.minus`);
		const sourceEvents = [...plusEvents, ...minusEvents];
		assertKnownEvents(sourceEvents, eventMap, label);

		const measure = source.measure ?? 'count';
		if (!VALID_WAREHOUSE_MEASURES.includes(measure)) {
			throw new Error(`${label}.source.measure must be one of ${VALID_WAREHOUSE_MEASURES.join(', ')}`);
		}
		if (type === 'point-in-time' && (measure === 'avg' || measure === 'dau')) {
			throw new Error(`${label}.source.measure "${measure}" is not valid for point-in-time metrics`);
		}

		const property = source.property ?? null;
		if ((measure === 'sum' || measure === 'avg') && typeof property !== 'string') {
			throw new Error(`${label}.source.property is required when measure is "${measure}"`);
		}
		if (property !== null && typeof property !== 'string') {
			throw new Error(`${label}.source.property must be a string`);
		}
		if (property && !isDeclaredForAllSources(property, sourceEvents, eventMap, superProps)) {
			throw new Error(`${label}.source.property "${property}" must be declared on every source event or in superProps`);
		}

		const groupBy = normalizeOptionalStringArray(source.groupBy, `${label}.source.groupBy`);
		if (groupBy.length > 2) {
			throw new Error(`${label}.source.groupBy may contain at most 2 keys`);
		}
		for (const key of groupBy) {
			assertIdentifier(key, `${label}.source.groupBy`);
			if (!isDeclaredForAllSources(key, sourceEvents, eventMap, superProps)) {
				throw new Error(`${label}.source.groupBy "${key}" must be declared on every source event or in superProps`);
			}
			const distinctCount = countObservedDistinctValues(key, sourceEvents, eventMap, superProps);
			if (distinctCount > 50) {
				warnings.push(`${label}.source.groupBy "${key}" has ${distinctCount} observed distinct values (> 50)`);
			}
		}

		const history = spec.history ?? 0;
		if (!Number.isInteger(history) || history < 0) {
			throw new Error(`${label}.history must be an integer >= 0`);
		}
		if (history > HISTORY_WARN_BY_GRAIN[grain]) {
			warnings.push(`${label}.history exceeds the recommended ~3 year limit for ${grain} grain`);
		}

		let baseline = spec.baseline ?? 0;
		if (baseline !== undefined && baseline !== null && (!Number.isFinite(baseline) || baseline < 0)) {
			throw new Error(`${label}.baseline must be a number >= 0`);
		}
		if (type !== 'point-in-time' && baseline !== 0) {
			warnings.push(`${label}.baseline is ignored for additive metrics`);
			baseline = 0;
		}

		const scale = spec.scale ?? 1;
		if (!Number.isFinite(scale) || scale <= 0) {
			throw new Error(`${label}.scale must be a number > 0`);
		}

		let noise = spec.noise ?? 0;
		if (!Number.isFinite(noise)) {
			throw new Error(`${label}.noise must be a finite number`);
		}
		if (noise < 0 || noise > 0.5) {
			const clamped = Math.min(0.5, Math.max(0, noise));
			warnings.push(`${label}.noise was clamped to ${clamped}`);
			noise = clamped;
		}

		const timeColumn = spec.timeColumn ?? 'date';
		const valueColumn = spec.valueColumn ?? 'value';
		assertIdentifier(timeColumn, `${label}.timeColumn`);
		assertIdentifier(valueColumn, `${label}.valueColumn`);

		const columns = spec.columns ?? {};
		if (!columns || typeof columns !== 'object' || Array.isArray(columns)) {
			throw new Error(`${label}.columns must be an object`);
		}
		for (const key of Object.keys(columns)) {
			assertIdentifier(key, `${label}.columns.${key}`);
		}

		assertDistinctIdentifiers([timeColumn, valueColumn, ...groupBy, ...Object.keys(columns)], label);

		const format = /** @type {'csv' | 'json'} */ (spec.format ?? config?.format ?? 'csv');
		if (!VALID_WAREHOUSE_FORMATS.includes(format)) {
			throw new Error(`${label}.format must be one of ${VALID_WAREHOUSE_FORMATS.join(', ')}`);
		}

		const where = source.where ?? null;
		if (where !== null && typeof where !== 'function') {
			throw new Error(`${label}.source.where must be a function`);
		}

		return {
			name,
			type,
			grain,
			sparse,
			source: {
				event: plusEvents,
				minus: minusEvents,
				measure,
				property,
				where,
				groupBy,
			},
			timeColumn,
			valueColumn,
			baseline: type === 'point-in-time' ? baseline : 0,
			scale,
			noise,
			history,
			columns: { ...columns },
			format,
		};
	});

	return { warehouseMetrics, warnings };
}

function normalizeStringArray(value, label) {
	if (typeof value === 'string') return [value];
	if (Array.isArray(value)) {
		for (const item of value) {
			if (typeof item !== 'string' || !item.trim()) {
				throw new Error(`${label} must contain only non-empty strings`);
			}
		}
		return [...value];
	}
	throw new Error(`${label} must be a string or array of strings`);
}

function normalizeOptionalStringArray(value, label) {
	if (value === undefined || value === null) return [];
	return normalizeStringArray(value, label);
}

function assertKnownEvents(eventNames, eventMap, label) {
	for (const eventName of eventNames) {
		if (!eventMap.has(eventName)) {
			throw new Error(`${label} references unknown source event "${eventName}"`);
		}
	}
}

function isDeclaredForAllSources(key, eventNames, eventMap, superProps) {
	if (Object.prototype.hasOwnProperty.call(superProps, key)) return true;
	return eventNames.every((eventName) => {
		const event = eventMap.get(eventName);
		const properties = event?.properties;
		return !!properties && Object.prototype.hasOwnProperty.call(properties, key);
	});
}

function countObservedDistinctValues(key, eventNames, eventMap, superProps) {
	const values = new Set();
	if (Object.prototype.hasOwnProperty.call(superProps, key) && Array.isArray(superProps[key])) {
		for (const value of superProps[key]) values.add(value);
	}
	for (const eventName of eventNames) {
		const prop = eventMap.get(eventName)?.properties?.[key];
		if (Array.isArray(prop)) {
			for (const value of prop) values.add(value);
		} else if (prop !== undefined) {
			values.add(prop);
		}
	}
	return values.size;
}

function assertIdentifier(value, label) {
	if (typeof value !== 'string' || !IDENTIFIER_RE.test(value)) {
		throw new Error(`${label} must be a valid identifier`);
	}
}

function assertDistinctIdentifiers(values, label) {
	const seen = new Set();
	for (const value of values) {
		if (seen.has(value)) {
			throw new Error(`${label} output column names must be distinct; found collision on "${value}"`);
		}
		seen.add(value);
	}
}

function previousBucket(startSec, grain) {
	switch (grain) {
		case 'day':
			return startSec - DAY_SECONDS;
		case 'week':
			return startSec - (7 * DAY_SECONDS);
		case 'month': {
			const date = new Date(startSec * 1000);
			return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1) / 1000;
		}
		default:
			throw new Error(`Unsupported warehouse grain "${grain}"`);
	}
}

function buildSeriesKey(spec, record) {
	if (!spec.source.groupBy || spec.source.groupBy.length === 0) return '';
	return spec.source.groupBy.map((key) => String(record[key] ?? '')).join('|');
}

function createEmptyCell(measure) {
	return {
		count: 0,
		sum: 0,
		users: measure === 'users' ? new Set() : null,
		userDays: measure === 'dau' ? new Set() : null,
		mCount: 0,
		mSum: 0,
		mUsers: measure === 'users' ? new Set() : null,
		mUserDays: measure === 'dau' ? new Set() : null,
	};
}

function updateCell({ cell, event, spec, leg, unixSec, warn }) {
	const fields = leg === 'minus'
		? { count: 'mCount', sum: 'mSum', users: 'mUsers', userDays: 'mUserDays' }
		: { count: 'count', sum: 'sum', users: 'users', userDays: 'userDays' };
	cell[fields.count] += 1;

	const measure = spec.source.measure;
	if (measure === 'sum' || measure === 'avg') {
		const numeric = Number(event[spec.source.property]);
		if (Number.isFinite(numeric)) {
			cell[fields.sum] += numeric;
		} else {
			warn(`warehouse metric "${spec.name}" encountered a non-numeric value for source.property "${spec.source.property}"; treating it as 0`);
		}
	}

	if (measure === 'users') {
		cell[fields.users].add(String(event.user_id ?? ''));
	}

	if (measure === 'dau') {
		cell[fields.userDays].add(`${String(event.user_id ?? '')}|${toUtcDay(unixSec)}`);
	}
}

function toUtcDay(unixSec) {
	return new Date(bucketStart(unixSec, 'day') * 1000).toISOString().slice(0, 10);
}