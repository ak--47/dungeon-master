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
		assertKnownEvents([...plusEvents, ...minusEvents], eventMap, label);

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
		if (property && !isDeclaredForAllSources(property, plusEvents, eventMap, superProps)) {
			throw new Error(`${label}.source.property "${property}" must be declared on every source event or in superProps`);
		}

		const groupBy = normalizeOptionalStringArray(source.groupBy, `${label}.source.groupBy`);
		if (groupBy.length > 2) {
			throw new Error(`${label}.source.groupBy may contain at most 2 keys`);
		}
		for (const key of groupBy) {
			assertIdentifier(key, `${label}.source.groupBy`);
			if (!isDeclaredForAllSources(key, plusEvents, eventMap, superProps)) {
				throw new Error(`${label}.source.groupBy "${key}" must be declared on every source event or in superProps`);
			}
			const distinctCount = countObservedDistinctValues(key, plusEvents, eventMap, superProps);
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