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
		this.warnedGroupByKeys = new Set();
		this.metrics = new Map();
		this.eventIndex = new Map();

		for (const spec of specs) {
			const state = {
				spec,
				series: new Map(),
				seriesValues: new Map(),
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
				this.observeGroupByValues(spec, event);

				const { key: seriesKey, values: seriesValues } = buildSeriesRef(spec, event);
				observeSeriesValues(metric, seriesKey, seriesValues);
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

	observeGroupByValues(spec, event) {
		for (const key of spec.source.groupBy || []) {
			const stateKey = `${spec.name}:${key}`;
			let values = this.observedGroupByValues?.get(stateKey);
			if (!values) {
				if (!this.observedGroupByValues) this.observedGroupByValues = new Map();
				values = new Set();
				this.observedGroupByValues.set(stateKey, values);
			}
			values.add(String(event?.[key] ?? ''));
			if (values.size > 50 && !this.warnedGroupByKeys.has(stateKey)) {
				this.warnedGroupByKeys.add(stateKey);
				this.warnings.push(`warehouse metric "${spec.name}" source.groupBy "${key}" has ${values.size} observed distinct values (> 50)`);
			}
		}
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

export function materializeWarehouseMetrics({ specs, accumulator, chance, FIXED_BEGIN, FIXED_NOW, configName, config }) {
	if (!Array.isArray(specs)) throw new Error('materializeWarehouseMetrics specs must be an array');
	if (!accumulator || typeof accumulator.getCell !== 'function') {
		throw new Error('materializeWarehouseMetrics requires a WarehouseAccumulator');
	}
	if (!Number.isFinite(FIXED_BEGIN) || !Number.isFinite(FIXED_NOW)) {
		throw new Error('materializeWarehouseMetrics requires finite FIXED_BEGIN and FIXED_NOW');
	}
	if (!chance || typeof chance.normal !== 'function') {
		throw new Error('materializeWarehouseMetrics requires a seeded chance instance');
	}

	const resolvedConfig = config ?? { name: configName };

	return specs.map((spec) => materializeOneMetric({
		spec,
		accumulator,
		chance,
		FIXED_BEGIN,
		FIXED_NOW,
		configName,
		config: resolvedConfig,
	}));
}

export function buildManifest(specs, materialized, configName) {
	return {
		configName,
		tables: specs.map((spec, index) => {
			const entry = materialized[index] || { rows: [] };
			const orderedColumns = [
				spec.timeColumn,
				...(spec.source.groupBy || []),
				spec.valueColumn,
				...Object.keys(spec.columns || {}),
			];
			const firstRow = entry.rows[0] || {};
			return {
				table: spec.name,
				file: `${configName}-WAREHOUSE-${spec.name}`,
				format: spec.format,
				grain: spec.grain,
				type: spec.type,
				timeColumn: spec.timeColumn,
				valueColumn: spec.valueColumn,
				dimensionColumns: [...(spec.source.groupBy || [])],
				columns: orderedColumns.map((columnName) => ({
					name: columnName,
					bqType: inferBqType(spec, columnName, firstRow[columnName]),
				})),
				recommendedAggregation: spec.type === 'point-in-time' ? 'last value' : 'sum',
				sql: `SELECT * FROM \`{{DATASET}}.${spec.name}\` ORDER BY ${spec.timeColumn}`,
				refreshHint: 'hourly',
			};
		}),
	};
}

function materializeOneMetric({ spec, accumulator, chance, FIXED_BEGIN, FIXED_NOW, configName, config }) {
	const metricState = accumulator.metrics.get(spec.name);
	const seriesKeys = resolveSeriesKeys(metricState, spec);
	const historyBuckets = buildBuckets(FIXED_BEGIN, FIXED_NOW, spec.grain, spec.history);
	const windowBuckets = buildBuckets(FIXED_BEGIN, FIXED_NOW, spec.grain, 0);
	const rows = [];
	const metas = [];

	for (const seriesKey of seriesKeys) {
		const windowValues = computeWindowValues({ spec, accumulator, seriesKey, windowBuckets });
		const backfillValues = computeBackfillValues(spec, windowValues);
		let lastEmittedValue;

		for (let bucketIndex = 0; bucketIndex < historyBuckets.length; bucketIndex += 1) {
			const bucketSec = historyBuckets[bucketIndex];
			const isBackfill = bucketIndex < spec.history;
			const rawScaledValue = isBackfill
				? backfillValues[bucketIndex]
				: windowValues[bucketIndex - spec.history];
			const finalValue = applyNoiseAndRound(rawScaledValue, spec.noise, chance);
			if (spec.sparse) {
				if (lastEmittedValue !== undefined && finalValue === lastEmittedValue) continue;
				lastEmittedValue = finalValue;
			}

			const row = buildRow({
				spec,
				bucketSec,
				seriesKey,
				seriesValues: getSeriesValues(metricState, spec, seriesKey),
				value: finalValue,
				bucketIndex,
				bucketCount: historyBuckets.length,
				grain: spec.grain,
				isBackfill,
				config,
			});
			rows.push(row);

			const cell = isBackfill
				? createEmptyCell(spec.source.measure)
				: accumulator.getCell(spec.name, seriesKey, bucketSec);
			metas.push({
				spec,
				config,
				configName,
				metricName: spec.name,
				bucketIndex,
				bucketCount: historyBuckets.length,
				grain: spec.grain,
				seriesKey,
				isBackfill,
				raw: snapshotRaw(cell),
				datasetStart: FIXED_BEGIN,
				datasetEnd: FIXED_NOW,
			});
		}
	}

	return {
		spec,
		rows,
		metas,
		file: `${configName}-WAREHOUSE-${spec.name}`,
	};
}

function resolveSeriesKeys(metricState, spec) {
	const observed = metricState ? Array.from(metricState.series.keys()) : [];
	if (observed.length === 0) {
		return (spec.source.groupBy || []).length === 0 ? [''] : [];
	}
	return observed.sort((left, right) => left.localeCompare(right));
}

function computeWindowValues({ spec, accumulator, seriesKey, windowBuckets }) {
	if (spec.type === 'point-in-time') {
		const values = [];
		let balance = 0;
		for (const bucketSec of windowBuckets) {
			const delta = getBucketMeasureValue(spec, accumulator.getCell(spec.name, seriesKey, bucketSec), bucketSec);
			balance += delta;
			values.push(Math.max(0, spec.baseline + balance) * spec.scale);
		}
		return values;
	}

	return windowBuckets.map((bucketSec) => getBucketMeasureValue(spec, accumulator.getCell(spec.name, seriesKey, bucketSec), bucketSec) * spec.scale);
}

function computeBackfillValues(spec, windowValues) {
	if (spec.history === 0) return [];
	const slope = leastSquaresSlope(windowValues);
	const firstValue = windowValues[0] ?? 0;
	const values = [];
	for (let step = spec.history; step >= 1; step -= 1) {
		values.push(Math.max(0, firstValue - (slope * step)));
	}
	return values;
}

function getBucketMeasureValue(spec, cell, bucketSec) {
	const plus = extractLegMeasure(spec.source.measure, cell, false, spec.grain, bucketSec);
	const minus = extractLegMeasure(spec.source.measure, cell, true, spec.grain, bucketSec);
	return plus - minus;
}

function extractLegMeasure(measure, cell, isMinus, grain, bucketSec) {
	const countKey = isMinus ? 'mCount' : 'count';
	const sumKey = isMinus ? 'mSum' : 'sum';
	const usersKey = isMinus ? 'mUsers' : 'users';
	const userDaysKey = isMinus ? 'mUserDays' : 'userDays';

	switch (measure) {
		case 'count':
			return cell[countKey];
		case 'sum':
			return cell[sumKey];
		case 'avg':
			return cell[countKey] ? (cell[sumKey] / cell[countKey]) : 0;
		case 'users':
			return cell[usersKey]?.size || 0;
		case 'dau':
			return bucketDayLength(bucketSec, grain) ? ((cell[userDaysKey]?.size || 0) / bucketDayLength(bucketSec, grain)) : 0;
		default:
			throw new Error(`Unsupported warehouse measure "${measure}"`);
	}
}

function bucketDayLength(bucketSec, grain) {
	if (!Number.isFinite(bucketSec)) return 0;
	return (nextBucket(bucketSec, grain) - bucketSec) / DAY_SECONDS;
}

function leastSquaresSlope(values) {
	if (!Array.isArray(values) || values.length < 2) return 0;
	const meanIndex = (values.length - 1) / 2;
	const meanValue = values.reduce((sum, value) => sum + value, 0) / values.length;
	let numerator = 0;
	let denominator = 0;
	for (let index = 0; index < values.length; index += 1) {
		const centeredIndex = index - meanIndex;
		numerator += centeredIndex * (values[index] - meanValue);
		denominator += centeredIndex * centeredIndex;
	}
	return denominator === 0 ? 0 : (numerator / denominator);
}

function applyNoiseAndRound(value, noise, chance) {
	if (!noise) return roundTo(value, 2);
	const draw = clamp(chance.normal({ dev: noise }), -2 * noise, 2 * noise);
	return roundTo(value * (1 + draw), 2);
}

function buildRow({ spec, bucketSec, seriesKey, seriesValues, value, bucketIndex, bucketCount, grain, isBackfill, config }) {
	const row = {
		[spec.timeColumn]: new Date(bucketSec * 1000).toISOString().slice(0, 10),
	};
	for (let index = 0; index < (spec.source.groupBy || []).length; index += 1) {
		row[spec.source.groupBy[index]] = seriesValues[index] ?? '';
	}
	row[spec.valueColumn] = value;

	for (const [columnName, columnValue] of Object.entries(spec.columns || {})) {
		row[columnName] = typeof columnValue === 'function'
			? columnValue({
				value,
				row,
				time: bucketSec * 1000,
				bucketIndex,
				bucketCount,
				grain,
				isBackfill,
				seriesKey,
				spec,
				config,
			})
			: columnValue;
	}

	return row;
}

function snapshotRaw(cell) {
	return {
		plus: {
			count: cell.count,
			sum: cell.sum,
			users: cell.users?.size || 0,
		},
		minus: {
			count: cell.mCount,
			sum: cell.mSum,
			users: cell.mUsers?.size || 0,
		},
	};
}


function inferBqType(spec, columnName, value) {
	if (columnName === spec.timeColumn) return 'DATE';
	if (columnName === spec.valueColumn) return 'FLOAT64';
	if (typeof value === 'number') return 'FLOAT64';
	if (typeof value === 'boolean') return 'BOOL';
	return 'STRING';
}

function roundTo(value, decimals) {
	const factor = 10 ** decimals;
	return Math.round((value + Number.EPSILON) * factor) / factor;
}

function buildSeriesRef(spec, record) {
	if (!spec.source.groupBy || spec.source.groupBy.length === 0) {
		return { key: '', values: [] };
	}
	const values = spec.source.groupBy.map((key) => normalizeSeriesValue(record[key]));
	return {
		key: values.map((value) => String(value)).join('|'),
		values,
	};
}

function normalizeSeriesValue(value) {
	return value ?? '';
}

function observeSeriesValues(metric, seriesKey, seriesValues) {
	const existing = metric.seriesValues.get(seriesKey);
	if (!existing) {
		metric.seriesValues.set(seriesKey, [...seriesValues]);
		return;
	}
	if (sameSeriesTuple(existing, seriesValues)) return;
	throw new Error(
		`warehouse metric "${metric.spec.name}" groupBy collision on seriesKey "${seriesKey}": `
		+ `observed ${formatSeriesTuple(metric.spec.source.groupBy || [], existing)} and `
		+ `${formatSeriesTuple(metric.spec.source.groupBy || [], seriesValues)}`,
	);
}

function sameSeriesTuple(left, right) {
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index += 1) {
		if (!Object.is(left[index], right[index])) return false;
	}
	return true;
}

function formatSeriesTuple(groupBy, values) {
	return groupBy.map((key, index) => `${key}=${JSON.stringify(values[index] ?? '')}`).join(', ');
}

function getSeriesValues(metricState, spec, seriesKey) {
	if (!spec.source.groupBy || spec.source.groupBy.length === 0) return [];
	return metricState?.seriesValues.get(seriesKey) || [];
}

function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}