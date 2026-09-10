const DAY_SECONDS = 86_400;

export function pearson(left, right) {
	if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || left.length < 2) {
		return 0;
	}
	const a = left.map(Number);
	const b = right.map(Number);
	if (a.some((value) => !Number.isFinite(value)) || b.some((value) => !Number.isFinite(value))) {
		return 0;
	}
	const meanA = a.reduce((sum, value) => sum + value, 0) / a.length;
	const meanB = b.reduce((sum, value) => sum + value, 0) / b.length;
	let numerator = 0;
	let denomA = 0;
	let denomB = 0;
	for (let index = 0; index < a.length; index += 1) {
		const centeredA = a[index] - meanA;
		const centeredB = b[index] - meanB;
		numerator += centeredA * centeredB;
		denomA += centeredA * centeredA;
		denomB += centeredB * centeredB;
	}
	if (denomA === 0 || denomB === 0) {
		return arraysEqual(a, b) ? 1 : 0;
	}
	return numerator / Math.sqrt(denomA * denomB);
}

export function computeWarehouseStats(rows, spec, eventDailyCounts) {
	const timeColumn = spec?.timeColumn || 'date';
	const valueColumn = spec?.valueColumn || 'value';
	const opts = arguments[3] || {};
	const normalizedRows = Array.isArray(rows) ? rows : [];
	const emittedSeries = buildTableSeries(normalizedRows, timeColumn, valueColumn);
	const sourceActualSeries = buildSourceSeries(eventDailyCounts, spec);
	const displayRange = resolveStatsDisplayRange(emittedSeries, sourceActualSeries, spec, opts);
	const windowRange = resolveStatsWindowRange(emittedSeries, sourceActualSeries, spec, opts);
	const reconstruction = spec?.type === 'point-in-time'
		? reconstructPointInTimeSeries(normalizedRows, spec, sourceActualSeries, eventDailyCounts, displayRange)
		: null;
	const tableSeries = reconstruction?.aggregateSeries || emittedSeries;
	const windowedTableSeries = selectTableSeriesWindow(tableSeries, windowRange, spec);
	const sourceSeries = buildSourceSeries(eventDailyCounts, spec, windowRange);
	const comparable = buildComparableSeries(windowedTableSeries, sourceSeries, spec, {
		seriesCount: inferComparableSeriesCount(normalizedRows, spec, eventDailyCounts),
	});
	const windowStart = windowRange?.start ?? null;
	const backfillBuckets = windowStart === null
		? 0
		: tableSeries.filter((entry) => entry.bucketSec < windowStart).length;
	const numericValues = tableSeries.map((entry) => entry.value);
	const numericColumns = resolveNumericColumns(normalizedRows, spec, opts.manifestColumns || []);
	const bySeries = partitionRowsBySeries(normalizedRows, spec);
	const lastBackfillValue = backfillBuckets > 0 ? tableSeries[backfillBuckets - 1]?.value : null;
	const firstWindowValue = tableSeries[backfillBuckets]?.value ?? 0;

	return {
		corr: pearson(comparable.table, comparable.source),
		buckets: tableSeries.length,
		backfillBuckets,
		gaps: countGaps(tableSeries, spec?.grain || 'day'),
		emptyNumericCells: countEmptyNumericCells(normalizedRows, numericColumns),
		nonMonotonicTime: [...bySeries.values()].reduce((sum, seriesRows) => sum + countSeriesNonMonotonic(seriesRows), 0),
		seamJumpPct: computeSeamJumpPct(lastBackfillValue, firstWindowValue),
		tailRatio: computeTailRatio(windowedTableSeries),
		mean: roundTo(mean(numericValues), 6),
		last: tableSeries.length ? tableSeries[tableSeries.length - 1].value : 0,
	};
}

export function computeWarehouseSourceRows(events, spec) {
	const plusEvents = new Set((spec?.source?.event || []).map(String));
	const measure = spec?.source?.measure || 'count';
	const property = spec?.source?.property || null;
	const where = spec?.source?.where;
	const groupKeys = normalizeGroupBy(spec?.source?.groupBy);
	const buckets = new Map();
	for (const event of Array.isArray(events) ? events : []) {
		if (!plusEvents.has(String(event?.event))) continue;
		if (typeof where === 'function' && !where(event)) continue;
		const bucketSec = bucketStart(event?.time, spec?.grain || 'day');
		if (!Number.isFinite(bucketSec)) continue;
		const dimensions = Object.fromEntries(groupKeys.map((key) => [key, event?.[key] ?? '']));
		const seriesKey = makeSeriesKey(dimensions, groupKeys);
		const bucketKey = `${bucketSec}|${seriesKey}`;
		const cell = buckets.get(bucketKey) || createSourceCell(dimensions);
		cell.count += 1;
		if (property) {
			const numeric = Number(event?.[property]);
			if (Number.isFinite(numeric)) cell.sum += numeric;
		}
		if (event?.user_id !== undefined && event?.user_id !== null) cell.users.add(String(event.user_id));
		cell.userDays.add(`${resolveDayKey(event?.time)}|${event?.user_id ?? ''}`);
		buckets.set(bucketKey, cell);
	}
	return [...buckets.entries()]
		.sort((left, right) => compareSourceBucketKeys(left[0], right[0]))
		.map(([bucketKey, cell]) => {
			const [bucketSecText, ...seriesParts] = bucketKey.split('|');
			const bucketSec = Number(bucketSecText);
			return {
				...cell.dimensions,
				__seriesKey: seriesParts.join('|'),
				__t: bucketSec,
				value: sourceCellValue(cell, measure, bucketSec, spec?.grain || 'day'),
			};
		});
}

export function auditWarehouseRows(rows, spec, opts = {}) {
	const normalizedRows = Array.isArray(rows) ? rows : [];
	const expectedColumns = [
		spec?.timeColumn || 'date',
		...normalizeGroupBy(spec?.source?.groupBy),
		spec?.valueColumn || 'value',
		...Object.keys(spec?.columns || {}),
	];
	const bySeries = partitionRowsBySeries(normalizedRows, spec);
	const expectedBucketList = buildExpectedBucketList(opts.datasetStart, opts.datasetEnd, spec);
	const expectedSeriesKeys = inferExpectedSeriesKeys(spec, bySeries, opts.sourceRows || []);
	const seriesKeys = expectedSeriesKeys.length ? expectedSeriesKeys : [...bySeries.keys()];
	const seriesCount = seriesKeys.length || bySeries.size || 1;
	const schemaViolations = countSchemaViolations(normalizedRows, expectedColumns);
	const numericColumns = resolveNumericColumns(normalizedRows, spec, opts.manifestColumns || []);
	const emptyNumericCells = countEmptyNumericCells(normalizedRows, numericColumns);
	const nonMonotonicTime = [...bySeries.values()].reduce((sum, seriesRows) => sum + countSeriesNonMonotonic(seriesRows), 0);
	const denseGaps = spec?.sparse ? 0 : countExpectedSeriesGaps(bySeries, seriesKeys, expectedBucketList);
	const repeatedSparseValues = spec?.sparse
		? [...bySeries.values()].reduce((sum, seriesRows) => sum + countRepeatedSparseValues(seriesRows, spec?.valueColumn || 'value'), 0)
		: 0;
	const missingSeries = countMissingExpectedSeries(bySeries, seriesKeys);
	const missingSparseFirstBuckets = spec?.sparse && expectedBucketList.length
		? countMissingSparseFirstBuckets(bySeries, seriesKeys, expectedBucketList[0])
		: 0;
	const expectedBuckets = expectedBucketCount(opts.datasetStart, opts.datasetEnd, spec);
	const maxRows = expectedBuckets * seriesCount;
	const minRows = spec?.sparse ? seriesCount : maxRows;
	const rowCountViolation = expectedBuckets > 0 && (
		spec?.sparse
			? normalizedRows.length < minRows || normalizedRows.length > maxRows
			: normalizedRows.length !== maxRows
	);

	const failures = [];
	if (schemaViolations > 0) failures.push(`schema mismatch in ${schemaViolations} row(s)`);
	if (!spec?.sparse && denseGaps > 0) failures.push(`dense table has ${denseGaps} bucket gap(s)`);
	if (nonMonotonicTime > 0) failures.push(`time column is non-monotonic in ${nonMonotonicTime} place(s)`);
	if (emptyNumericCells > 0) failures.push(`found ${emptyNumericCells} empty numeric cell(s)`);
	if (repeatedSparseValues > 0) failures.push(`sparse table repeated ${repeatedSparseValues} unchanged consecutive value(s)`);
	if (missingSeries > 0) failures.push(`missing ${missingSeries} expected series`);
	if (missingSparseFirstBuckets > 0) failures.push(`sparse table missed the first bucket for ${missingSparseFirstBuckets} expected series`);
	if (rowCountViolation) failures.push(`row count ${normalizedRows.length} violates ${spec?.sparse ? `range ${minRows}-${maxRows}` : `expected bound ${maxRows}`}`);

	return {
		pass: failures.length === 0,
		failures,
		stats: computeWarehouseStats(normalizedRows, spec, opts.sourceRows || [], opts),
		rowCount: normalizedRows.length,
		seriesCount,
		expectedRows: maxRows,
	};
}

function buildTableSeries(rows, timeColumn, valueColumn) {
	const buckets = new Map();
	for (const row of Array.isArray(rows) ? rows : []) {
		const bucketSec = coerceBucketSec(row, timeColumn);
		if (!Number.isFinite(bucketSec)) continue;
		const numeric = coerceNumericCell(row?.[valueColumn]);
		const current = buckets.get(bucketSec) || { value: 0, comparable: true };
		current.value = roundTo(current.value + numeric.value, 6);
		current.comparable = current.comparable && !numeric.empty;
		buckets.set(bucketSec, current);
	}
	return [...buckets.entries()]
		.sort((left, right) => left[0] - right[0])
		.map(([bucketSec, value]) => ({ bucketSec, ...value }));
}

function buildSourceSeries(rows, spec, bucketRange = null) {
	const minusEvents = new Set((spec?.source?.minus || []).map(String));
	const buckets = new Map();
	for (const row of Array.isArray(rows) ? rows : []) {
		if (minusEvents.size > 0) {
			const sourceName = row?.source ?? row?.event ?? row?.eventName ?? row?.series;
			if (sourceName !== undefined && minusEvents.has(String(sourceName))) continue;
		}
		const rawTime = row?.__t ?? row?.time ?? row?.bucket ?? row?.date ?? row?.month;
		const bucketSec = bucketStart(rawTime, spec?.grain || 'day');
		if (!Number.isFinite(bucketSec)) continue;
		const value = Number(row?.value ?? row?.count ?? row?.sum ?? row?.avg ?? 0);
		if (!Number.isFinite(value)) continue;
		buckets.set(bucketSec, (buckets.get(bucketSec) || 0) + value);
	}
	const series = [...buckets.entries()]
		.sort((left, right) => left[0] - right[0])
		.map(([bucketSec, value]) => ({ bucketSec, value: roundTo(value, 6) }));
	if (!Number.isFinite(bucketRange?.start) || !Number.isFinite(bucketRange?.end)) return series;
	const sourceMap = new Map(series.map((entry) => [entry.bucketSec, entry.value]));
	return enumerateBuckets(bucketRange.start, bucketRange.end, spec?.grain || 'day').map((bucketSec) => ({
		bucketSec,
		value: roundTo(sourceMap.get(bucketSec) || 0, 6),
	}));
}

function buildComparableSeries(tableSeries, sourceSeries, spec, opts = {}) {
	const sourceMap = new Map(sourceSeries.map((entry) => [entry.bucketSec, entry.value]));
	if (spec?.type === 'point-in-time') {
		const table = [];
		const source = [];
		const firstValueBase = Number(spec?.baseline ?? 0) * Number(spec?.scale ?? 1) * Math.max(1, Number(opts.seriesCount) || 1);
		for (const entry of buildWindowDeltaSeries(tableSeries, firstValueBase)) {
			const sourceValue = sourceMap.get(entry.bucketSec);
			if (!Number.isFinite(sourceValue) || entry.comparable === false) continue;
			table.push(entry.value);
			source.push(sourceValue);
		}
		return { table, source };
	}

	const table = [];
	const source = [];
	for (const entry of tableSeries) {
		const sourceValue = sourceMap.get(entry.bucketSec);
		if (!Number.isFinite(sourceValue) || !Number.isFinite(entry.value) || entry.comparable === false) continue;
		table.push(entry.value);
		source.push(sourceValue);
	}
	return { table, source };
}

function coerceBucketSec(row, timeColumn) {
	if (Number.isFinite(row?.__t)) return row.__t;
	return bucketStart(row?.[timeColumn], inferGrainFromTimeColumn(timeColumn));
}

function bucketStart(raw, grain) {
	const sec = coerceTimeSec(raw);
	if (!Number.isFinite(sec)) return NaN;
	if (grain === 'day') return Math.floor(sec / DAY_SECONDS) * DAY_SECONDS;
	if (grain === 'week') {
		const dayIndex = Math.floor(sec / DAY_SECONDS);
		return (dayIndex - ((dayIndex + 3) % 7)) * DAY_SECONDS;
	}
	if (grain === 'month') {
		const date = new Date(sec * 1000);
		return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000;
	}
	return NaN;
}

function coerceTimeSec(raw) {
	if (Number.isFinite(raw)) return Number(raw);
	if (typeof raw !== 'string' || !raw) return NaN;
	const parsed = Date.parse(/T/.test(raw) ? raw : `${raw}T00:00:00Z`);
	return Number.isFinite(parsed) ? parsed / 1000 : NaN;
}

function coerceNumericCell(value) {
	if (value === '' || value === null || value === undefined) {
		return { value: 0, empty: true };
	}
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) {
		return { value: 0, empty: true };
	}
	return { value: numeric, empty: false };
}

function countEmptyNumericCells(rows, numericColumns) {
	const columns = Array.isArray(numericColumns) ? numericColumns : [numericColumns];
	let count = 0;
	for (const row of Array.isArray(rows) ? rows : []) {
		for (const column of columns) {
			if (coerceNumericCell(row?.[column]).empty) count += 1;
		}
	}
	return count;
}

function countNonMonotonicTime(rows, timeColumn) {
	let count = 0;
	let previous = null;
	for (const row of Array.isArray(rows) ? rows : []) {
		const current = coerceBucketSec(row, timeColumn);
		if (!Number.isFinite(current)) continue;
		if (previous !== null && current <= previous) count += 1;
		previous = current;
	}
	return count;
}

function countGaps(series, grain) {
	let gaps = 0;
	for (let index = 1; index < series.length; index += 1) {
		const prev = series[index - 1].bucketSec;
		const curr = series[index].bucketSec;
		const expected = nextBucket(prev, grain);
		let cursor = expected;
		while (Number.isFinite(cursor) && cursor < curr) {
			gaps += 1;
			cursor = nextBucket(cursor, grain);
		}
	}
	return gaps;
}

function partitionRowsBySeries(rows, spec) {
	const grouped = new Map();
	const keys = normalizeGroupBy(spec?.source?.groupBy);
	for (const row of rows) {
		const seriesKey = makeSeriesKey(row, keys);
		const bucketSec = Number.isFinite(row?.__t) ? row.__t : coerceBucketSec(row, spec?.timeColumn || 'date');
		const nextRow = { ...row, __t: bucketSec };
		const list = grouped.get(seriesKey) || [];
		list.push(nextRow);
		grouped.set(seriesKey, list);
	}
	for (const list of grouped.values()) {
		list.sort((left, right) => (left.__t ?? 0) - (right.__t ?? 0));
	}
	return grouped;
}

function countExpectedSeriesGaps(bySeries, expectedSeriesKeys, expectedBucketList) {
	let gaps = 0;
	for (const seriesKey of expectedSeriesKeys) {
		const bucketSet = new Set((bySeries.get(seriesKey) || []).map((row) => row.__t));
		for (const bucketSec of expectedBucketList) {
			if (!bucketSet.has(bucketSec)) gaps += 1;
		}
	}
	return gaps;
}

function countSeriesNonMonotonic(rows) {
	let count = 0;
	for (let index = 1; index < rows.length; index += 1) {
		if (!Number.isFinite(rows[index].__t) || rows[index].__t <= rows[index - 1].__t) count += 1;
	}
	return count;
}

function countRepeatedSparseValues(rows, valueColumn) {
	let count = 0;
	for (let index = 1; index < rows.length; index += 1) {
		if (Number(rows[index][valueColumn]) === Number(rows[index - 1][valueColumn])) count += 1;
	}
	return count;
}

function countMissingExpectedSeries(bySeries, expectedSeriesKeys) {
	let count = 0;
	for (const seriesKey of expectedSeriesKeys) {
		if (!(bySeries.get(seriesKey) || []).length) count += 1;
	}
	return count;
}

function countMissingSparseFirstBuckets(bySeries, expectedSeriesKeys, firstBucketSec) {
	let count = 0;
	for (const seriesKey of expectedSeriesKeys) {
		const rows = bySeries.get(seriesKey) || [];
		if (!rows.some((row) => row.__t === firstBucketSec)) count += 1;
	}
	return count;
}

function countSchemaViolations(rows, expectedColumns) {
	const expected = new Set(expectedColumns);
	let count = 0;
	for (const row of rows) {
		const keys = Object.keys(row).filter((key) => key !== '__t');
		const missing = expectedColumns.some((column) => !keys.includes(column));
		const extra = keys.some((key) => !expected.has(key));
		if (missing || extra) count += 1;
	}
	return count;
}

function expectedBucketCount(datasetStart, datasetEnd, spec) {
	return buildExpectedBucketList(datasetStart, datasetEnd, spec).length;
}

function buildExpectedBucketList(datasetStart, datasetEnd, spec) {
	const startSec = coerceTimeSec(datasetStart);
	const endSec = coerceTimeSec(datasetEnd);
	if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec < startSec) return [];
	const grain = spec?.grain || 'day';
	const startBucket = shiftBucket(bucketStart(startSec, grain), grain, -Number(spec?.history || 0));
	const endBucket = bucketStart(endSec, grain);
	return enumerateBuckets(startBucket, endBucket, grain);
}

function createSourceCell(dimensions = {}) {
	return { count: 0, sum: 0, users: new Set(), userDays: new Set(), dimensions };
}

function sourceCellValue(cell, measure, bucketSec, grain) {
	switch (measure) {
		case 'count':
			return cell.count;
		case 'sum':
			return roundTo(cell.sum, 6);
		case 'avg':
			return cell.count ? roundTo(cell.sum / cell.count, 6) : 0;
		case 'users':
			return cell.users.size;
		case 'dau': {
			const days = bucketDayLength(bucketSec, grain);
			return days ? roundTo(cell.userDays.size / days, 6) : 0;
		}
		default:
			return cell.count;
	}
}

function nextBucket(bucketSec, grain) {
	if (grain === 'day') return bucketSec + DAY_SECONDS;
	if (grain === 'week') return bucketSec + (7 * DAY_SECONDS);
	if (grain === 'month') {
		const date = new Date(bucketSec * 1000);
		return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) / 1000;
	}
	return NaN;
}

function shiftBucket(bucketSec, grain, delta) {
	if (!Number.isFinite(bucketSec) || !Number.isInteger(delta) || delta === 0) return bucketSec;
	if (grain === 'day') return bucketSec + (delta * DAY_SECONDS);
	if (grain === 'week') return bucketSec + (delta * 7 * DAY_SECONDS);
	if (grain === 'month') {
		const date = new Date(bucketSec * 1000);
		return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + delta, 1) / 1000;
	}
	return NaN;
}

function enumerateBuckets(startBucket, endBucket, grain) {
	if (!Number.isFinite(startBucket) || !Number.isFinite(endBucket) || endBucket < startBucket) return [];
	const out = [];
	for (let cursor = startBucket; Number.isFinite(cursor) && cursor <= endBucket; cursor = nextBucket(cursor, grain)) {
		out.push(cursor);
	}
	return out;
}

function bucketDayLength(bucketSec, grain) {
	if (!Number.isFinite(bucketSec)) return 0;
	return (nextBucket(bucketSec, grain) - bucketSec) / DAY_SECONDS;
}

function computeSeamJumpPct(lastBackfillValue, firstSourceValue) {
	if (!Number.isFinite(lastBackfillValue) || !Number.isFinite(firstSourceValue) || firstSourceValue === 0) {
		return 0;
	}
	return (Math.abs(lastBackfillValue - firstSourceValue) / Math.abs(firstSourceValue)) * 100;
}

function computeTailRatio(sourceSeries) {
	if (!sourceSeries.length) return 0;
	const first = sourceSeries[0].value;
	const last = sourceSeries[sourceSeries.length - 1].value;
	if (!Number.isFinite(first) || first === 0) return 0;
	return last / first;
}

function mean(values) {
	if (!Array.isArray(values) || values.length === 0) return 0;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundTo(value, decimals) {
	const factor = 10 ** decimals;
	return Math.round((value + Number.EPSILON) * factor) / factor;
}

function arraysEqual(left, right) {
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index += 1) {
		if (!Object.is(left[index], right[index])) return false;
	}
	return true;
}

function resolveDayKey(raw) {
	const sec = coerceTimeSec(raw);
	if (!Number.isFinite(sec)) return 'invalid';
	return new Date(Math.floor(sec / DAY_SECONDS) * DAY_SECONDS * 1000).toISOString().slice(0, 10);
}

function inferGrainFromTimeColumn(timeColumn) {
	return timeColumn === 'month' ? 'month' : timeColumn === 'week' ? 'week' : 'day';
}

function normalizeGroupBy(groupBy) {
	if (Array.isArray(groupBy)) return groupBy;
	if (groupBy === undefined || groupBy === null || groupBy === '') return [];
	return [groupBy];
}

function makeSeriesKey(rowLike, keys) {
	return keys.map((key) => String(rowLike?.[key] ?? '')).join('|');
}

function compareSourceBucketKeys(left, right) {
	const [leftBucket, ...leftSeries] = String(left).split('|');
	const [rightBucket, ...rightSeries] = String(right).split('|');
	const bucketDiff = Number(leftBucket) - Number(rightBucket);
	if (bucketDiff !== 0) return bucketDiff;
	return leftSeries.join('|').localeCompare(rightSeries.join('|'));
}

function selectTableSeriesWindow(tableSeries, range, spec) {
	if (!range) return tableSeries;
	if (spec?.type === 'point-in-time') {
		return tableSeries.filter((entry) => entry.bucketSec >= range.start && entry.bucketSec <= range.end);
	}
	const tableMap = new Map(tableSeries.map((entry) => [entry.bucketSec, entry]));
	return enumerateBuckets(range.start, range.end, spec?.grain || 'day').map((bucketSec) => {
		const entry = tableMap.get(bucketSec);
		if (entry) return entry;
		return { bucketSec, value: 0, comparable: true };
	});
}

function buildWindowDeltaSeries(tableSeries, firstValueBase = null) {
	const deltas = [];
	let previous = null;
	for (const entry of tableSeries) {
		const value = Number(entry?.value);
		const comparable = entry?.comparable !== false;
		if (!Number.isFinite(value)) continue;
		if (previous === null) {
			deltas.push({
				bucketSec: entry.bucketSec,
				value: roundTo(firstValueBase === null ? 0 : value - firstValueBase, 6),
				comparable,
			});
		} else {
			deltas.push({
				bucketSec: entry.bucketSec,
				value: roundTo(value - previous.value, 6),
				comparable: comparable && previous.comparable,
			});
		}
		previous = { value, comparable };
	}
	return deltas;
}

function inferBucketRange(tableSeries, sourceSeries) {
	const buckets = [
		...tableSeries.map((entry) => entry.bucketSec),
		...sourceSeries.map((entry) => entry.bucketSec),
	].filter(Number.isFinite);
	if (!buckets.length) return null;
	return {
		start: Math.min(...buckets),
		end: Math.max(...buckets),
	};
}

function inferExpectedSeriesKeys(spec, bySeries, sourceRows) {
	const keys = normalizeGroupBy(spec?.source?.groupBy);
	if (!keys.length) return [''];
	const combined = new Set();
	for (const row of Array.isArray(sourceRows) ? sourceRows : []) {
		combined.add(makeSeriesKey(row, keys));
	}
	for (const seriesKey of bySeries.keys()) combined.add(seriesKey);
	return [...combined].sort();
}

function inferComparableSeriesCount(rows, spec, sourceRows) {
	const bySeries = partitionRowsBySeries(rows, spec);
	const expectedSeriesKeys = inferExpectedSeriesKeys(spec, bySeries, sourceRows);
	return expectedSeriesKeys.length || bySeries.size || 1;
}

function resolveNumericColumns(rows, spec, manifestColumns) {
	const numeric = new Set([spec?.valueColumn || 'value']);
	for (const column of Array.isArray(manifestColumns) ? manifestColumns : []) {
		if (column?.bqType === 'FLOAT64' && column?.name) numeric.add(column.name);
	}
	for (const [name, value] of Object.entries(spec?.columns || {})) {
		if (typeof value === 'number') numeric.add(name);
	}
	for (const name of Object.keys(spec?.columns || {})) {
		if (numeric.has(name)) continue;
		for (const row of rows) {
			const cell = row?.[name];
			if (cell === '' || cell === null || cell === undefined) continue;
			if (Number.isFinite(Number(cell))) {
				numeric.add(name);
				break;
			}
		}
	}
	return [...numeric];
}

function reconstructPointInTimeSeries(rows, spec, sourceActualSeries, sourceRows, rangeOverride = null) {
	const bySeries = partitionRowsBySeries(rows, spec);
	const valueColumn = spec?.valueColumn || 'value';
	const timeColumn = spec?.timeColumn || 'date';
	const emittedSeries = buildTableSeries(rows, timeColumn, valueColumn);
	const range = rangeOverride || inferBucketRange(emittedSeries, sourceActualSeries);
	if (!range) return { aggregateSeries: [], deltaSeries: [] };
	const expectedSeriesKeys = inferExpectedSeriesKeys(spec, bySeries, sourceRows);
	const baselineValue = Number(spec?.baseline ?? 0) * Number(spec?.scale ?? 1);
	const rowMaps = new Map();
	for (const seriesKey of expectedSeriesKeys) {
		rowMaps.set(seriesKey, new Map((bySeries.get(seriesKey) || []).map((row) => [row.__t, row])));
	}
	const states = new Map(expectedSeriesKeys.map((seriesKey) => [seriesKey, baselineValue]));
	const aggregateSeries = [];
	const deltaSeries = [];
	for (const bucketSec of enumerateBuckets(range.start, range.end, spec?.grain || 'day')) {
		let total = 0;
		let delta = 0;
		let comparable = true;
		for (const seriesKey of expectedSeriesKeys) {
			const previous = states.get(seriesKey) ?? baselineValue;
			const row = rowMaps.get(seriesKey)?.get(bucketSec);
			let current = previous;
			if (row) {
				const numeric = coerceNumericCell(row?.[valueColumn]);
				if (numeric.empty) {
					comparable = false;
				} else {
					current = numeric.value;
				}
			}
			total += current;
			delta += current - previous;
			states.set(seriesKey, current);
		}
		aggregateSeries.push({ bucketSec, value: roundTo(total, 6), comparable });
		deltaSeries.push({ bucketSec, value: roundTo(delta, 6), comparable });
	}
	return { aggregateSeries, deltaSeries };
}

function resolveStatsDisplayRange(emittedSeries, sourceSeries, spec, opts) {
	const windowRange = resolveStatsWindowRange(emittedSeries, sourceSeries, spec, opts);
	if (!windowRange) return inferBucketRange(emittedSeries, sourceSeries);
	return {
		start: shiftBucket(windowRange.start, spec?.grain || 'day', -Number(spec?.history || 0)),
		end: windowRange.end,
	};
}

function resolveStatsWindowRange(emittedSeries, sourceSeries, spec, opts) {
	const grain = spec?.grain || 'day';
	const datasetStart = coerceTimeSec(opts?.datasetStart);
	const datasetEnd = coerceTimeSec(opts?.datasetEnd);
	if (Number.isFinite(datasetStart) && Number.isFinite(datasetEnd)) {
		return {
			start: bucketStart(datasetStart, grain),
			end: bucketStart(datasetEnd, grain),
		};
	}

	const tableBuckets = emittedSeries.map((entry) => entry.bucketSec).filter(Number.isFinite);
	const sourceBuckets = sourceSeries.map((entry) => entry.bucketSec).filter(Number.isFinite);
	if (tableBuckets.length) {
		const start = shiftBucket(Math.min(...tableBuckets), grain, Number(spec?.history || 0));
		const end = Math.max(
			Math.max(...tableBuckets),
			sourceBuckets.length ? Math.max(...sourceBuckets) : -Infinity,
		);
		return { start: Math.min(start, end), end };
	}
	if (sourceBuckets.length) {
		return {
			start: Math.min(...sourceBuckets),
			end: Math.max(...sourceBuckets),
		};
	}
	return null;
}