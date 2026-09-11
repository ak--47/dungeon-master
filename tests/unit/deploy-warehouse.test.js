//@ts-nocheck
import { describe, test, expect } from 'vitest';

import {
	buildBigQueryLoadArgs,
	buildCreateMetricPayload,
	extractSourceId,
	findPreviewBlockedToken,
	normalizeDatasetName,
	parseArgs,
	parseWarehouseMetricListResponse,
	renderCommand,
	resolveProjectId,
	resolveMetricActions,
	runLiveDeploy,
	validateDatasetName,
} from '../../.claude/skills/warehouse-metrics/deploy.mjs';

function sampleTables() {
	return [
		{
			table: 'daily_new_bookings',
			sql: 'SELECT * FROM `{{DATASET}}.daily_new_bookings` ORDER BY date',
			timeColumn: 'date',
			valueColumn: 'bookings',
			recommendedAggregation: 'sum',
			refreshHint: 'hourly',
			filePath: '/tmp/daily_new_bookings.csv',
			format: 'csv',
			columns: [
				{ name: 'date', bqType: 'DATE' },
				{ name: 'bookings', bqType: 'FLOAT64' },
			],
		},
		{
			table: 'daily_active_subscriptions',
			sql: 'SELECT * FROM `{{DATASET}}.daily_active_subscriptions` ORDER BY date',
			timeColumn: 'date',
			valueColumn: 'active_subscriptions',
			recommendedAggregation: 'last value',
			refreshHint: 'manual',
			filePath: '/tmp/daily_active_subscriptions.csv',
			format: 'csv',
			columns: [
				{ name: 'date', bqType: 'DATE' },
				{ name: 'active_subscriptions', bqType: 'FLOAT64' },
			],
		},
	];
}

describe('warehouse-metrics helpers', () => {
	test('normalizes dataset names per dungeon name', () => {
		expect(normalizeDatasetName('My Buddy')).toBe('dm_my_buddy');
		expect(normalizeDatasetName('Already__clean')).toBe('dm_already_clean');
		expect(normalizeDatasetName('123 bad name')).toBe('dm_123_bad_name');
	});

	test('builds explicit bq load args for csv and ndjson manifests', () => {
		const csvArgs = buildBigQueryLoadArgs({
			projectId: 'mixpanel-gtm-training',
			dataset: 'dm_demo',
			table: {
				table: 'daily_new_bookings',
				format: 'csv',
				columns: [
					{ name: 'date', bqType: 'DATE' },
					{ name: 'bookings', bqType: 'FLOAT64' },
				],
			},
			filePath: '/tmp/daily_new_bookings.csv',
		});

		expect(csvArgs).toEqual([
			'--project_id=mixpanel-gtm-training',
			'load',
			'--replace',
			'--source_format=CSV',
			'--skip_leading_rows=1',
			'dm_demo.daily_new_bookings',
			'/tmp/daily_new_bookings.csv',
			'date:DATE,bookings:FLOAT64',
		]);

		const jsonArgs = buildBigQueryLoadArgs({
			projectId: 'mixpanel-gtm-training',
			dataset: 'dm_demo',
			table: {
				table: 'monthly_arr_snapshot',
				format: 'json',
				columns: [
					{ name: 'month', bqType: 'DATE' },
					{ name: 'arr_usd', bqType: 'FLOAT64' },
				],
			},
			filePath: '/tmp/monthly_arr_snapshot.json',
		});

		expect(jsonArgs).toEqual([
			'--project_id=mixpanel-gtm-training',
			'load',
			'--replace',
			'--source_format=NEWLINE_DELIMITED_JSON',
			'dm_demo.monthly_arr_snapshot',
			'/tmp/monthly_arr_snapshot.json',
			'month:DATE,arr_usd:FLOAT64',
		]);
	});

	test('builds create payloads from the manifest contract', () => {
		const payload = buildCreateMetricPayload({
			projectId: '4023151',
			sourceId: 7514,
			dataset: 'dm_demo',
			table: {
				table: 'monthly_arr_snapshot',
				sql: 'SELECT * FROM `{{DATASET}}.monthly_arr_snapshot` ORDER BY month',
				valueColumn: 'arr_usd',
				timeColumn: 'month',
				recommendedAggregation: 'last value',
				refreshHint: 'hourly',
			},
		});

		expect(payload).toEqual({
			project_id: '4023151',
			source_id: 7514,
			name: 'monthly_arr_snapshot',
			metric_type: 'timeseries',
			sql: 'SELECT * FROM `mixpanel-gtm-training.dm_demo.monthly_arr_snapshot` ORDER BY month',
			value_column: 'arr_usd',
			time_column: 'month',
			aggregation: 'last_value',
			refresh: 'hourly',
		});
	});

	test('extracts source_id from the setup-bq-warehouse macro response', () => {
		const response = {
			result: {
				source_id: 12345,
				steps: [
					{ step: 'prepare-bigquery', status: 'ok' },
					{ step: 'create-source', status: 'ok', source_id: 12345 },
				],
			},
			summary: { source_id: 12345 },
		};

		expect(extractSourceId(response)).toBe(12345);
	});

	test('list-dedupes by metric name and schedules preview before create', () => {
		const actions = resolveMetricActions({
			tables: [
				{ table: 'daily_new_bookings', sql: 'SELECT * FROM `{{DATASET}}.daily_new_bookings` ORDER BY date', timeColumn: 'date', valueColumn: 'bookings', recommendedAggregation: 'sum', refreshHint: 'hourly' },
				{ table: 'daily_active_subscriptions', sql: 'SELECT * FROM `{{DATASET}}.daily_active_subscriptions` ORDER BY date', timeColumn: 'date', valueColumn: 'active_subscriptions', recommendedAggregation: 'last value', refreshHint: 'manual' },
			],
			existingMetrics: [
				{ name: 'daily_new_bookings' },
			],
			dataset: 'dm_demo',
			projectId: '4023151',
			sourceId: 7514,
		});

		expect(actions).toEqual([
			{
				table: 'daily_new_bookings',
				action: 'skip-existing',
				reason: 'metric already exists',
			},
			{
				table: 'daily_active_subscriptions',
				action: 'preview-and-create',
				previewPayload: {
					project_id: '4023151',
					source_id: 7514,
					sql: 'SELECT * FROM `mixpanel-gtm-training.dm_demo.daily_active_subscriptions` ORDER BY date',
				},
				createPayload: {
					project_id: '4023151',
					source_id: 7514,
					name: 'daily_active_subscriptions',
					metric_type: 'timeseries',
					sql: 'SELECT * FROM `mixpanel-gtm-training.dm_demo.daily_active_subscriptions` ORDER BY date',
					value_column: 'active_subscriptions',
					time_column: 'date',
					aggregation: 'last_value',
					refresh: 'manual',
				},
			},
		]);
	});

	test('fails clearly on preview-blocked created_at and updated_at substrings', () => {
		expect(findPreviewBlockedToken('SELECT * FROM `dm_demo.metric` ORDER BY created_at')).toEqual({
			token: 'CREATE',
			column: 'created_at',
		});
		expect(findPreviewBlockedToken('SELECT updated_at AS updated_at_day FROM `dm_demo.metric` ORDER BY updated_at_day')).toEqual({
			token: 'UPDATE',
			column: 'updated_at',
		});
		expect(findPreviewBlockedToken('SELECT day FROM `dm_demo.metric` ORDER BY day')).toBe(null);
	});

	test('renders argv safely for dry-run output', () => {
		expect(renderCommand(process.execPath, ['.claude/skills/powertools/pt.mjs', '/crud/getWarehouseMetrics', '--get'])).toContain('/crud/getWarehouseMetrics --get');
		expect(renderCommand('bq', ['--project_id=mixpanel-gtm-training', 'mk', '--dataset', '--location=US', 'dm_demo'])).toBe('bq --project_id=mixpanel-gtm-training mk --dataset --location=US dm_demo');
	});

	test('supports numeric-keyed warehouse metric list responses and timing-only empties', () => {
		expect(parseWarehouseMetricListResponse([
			{ name: 'daily_new_bookings' },
		])).toEqual([{ name: 'daily_new_bookings' }]);

		expect(parseWarehouseMetricListResponse({
			results: [{ name: 'daily_new_bookings' }],
		})).toEqual([{ name: 'daily_new_bookings' }]);

		expect(parseWarehouseMetricListResponse({
			0: { name: 'daily_new_bookings' },
			1: { name: 'daily_active_subscriptions' },
			duration_ms: 31,
			duration_human: '31ms',
		})).toEqual([
			{ name: 'daily_new_bookings' },
			{ name: 'daily_active_subscriptions' },
		]);

		expect(parseWarehouseMetricListResponse({
			duration_ms: 0,
			duration_human: '0ms',
		})).toEqual([]);
	});

	test('rejects malformed warehouse metric list payloads', () => {
		expect(() => parseWarehouseMetricListResponse({ error: 'boom' })).toThrow(/unexpected shape|malformed|error/i);
		expect(() => parseWarehouseMetricListResponse({ nope: [] })).toThrow(/unexpected shape|malformed/i);
		expect(() => parseWarehouseMetricListResponse({ 0: null, duration_ms: 10 })).toThrow(/unexpected shape|malformed/i);
	});

	test('resolves project id with flat keys taking precedence over nested credentials', () => {
		expect(resolveProjectId({
			projectId: 'top-level-camel',
			project_id: 'top-level-snake',
			credentials: { projectId: 'nested-camel', project_id: 'nested-snake' },
		})).toBe('top-level-camel');

		expect(resolveProjectId({
			project_id: 'top-level-snake',
			credentials: { projectId: 'nested-camel', project_id: 'nested-snake' },
		})).toBe('top-level-snake');

		expect(resolveProjectId({
			credentials: { projectId: 'nested-camel', project_id: 'nested-snake' },
		})).toBe('nested-camel');
	});

	test('requires project id for live deploy config resolution', () => {
		expect(() => resolveProjectId({ credentials: { token: '' } })).toThrow(/credentials\.projectId is required/i);
	});

	test('validates dataset overrides and CLI options before any writes', () => {
		expect(validateDatasetName('dm_valid_name')).toBe('dm_valid_name');
		expect(() => validateDatasetName('bad-name')).toThrow(/dataset/i);
		expect(() => parseArgs(['dungeons/technical/warehouse.js', '--dataset'])).toThrow(/--dataset/i);
		expect(() => parseArgs(['dungeons/technical/warehouse.js', '--bogus'])).toThrow(/unknown option/i);
	});

	test('preserves dry-run source_id placeholders and project-qualifies SQL', () => {
		const actions = resolveMetricActions({
			tables: sampleTables(),
			existingMetrics: [],
			dataset: 'dm_demo',
			projectId: '4023151',
			sourceId: '<source_id>',
		});

		expect(actions[0].previewPayload).toEqual({
			project_id: '4023151',
			source_id: '<source_id>',
			sql: 'SELECT * FROM `mixpanel-gtm-training.dm_demo.daily_new_bookings` ORDER BY date',
		});
		expect(actions[0].createPayload.source_id).toBe('<source_id>');
		expect(actions[0].createPayload.sql).toBe('SELECT * FROM `mixpanel-gtm-training.dm_demo.daily_new_bookings` ORDER BY date');
	});

	test('live deploy uses docs404 fallback after preflight, loads, and source setup', () => {
		const calls = [];
		const summary = runLiveDeploy({
			projectId: '4023151',
			dataset: 'dm_demo',
			tables: sampleTables(),
			dungeonPath: '/tmp/warehouse.js',
			warehouseDir: '/tmp/warehouse',
			sqlFiles: ['/tmp/warehouse/daily_new_bookings.sql'],
		}, {
			runBigQueryLs: () => calls.push('ls'),
			probeWarehouseMetricDocs: () => {
				calls.push('docs');
				return { available: false, reason: 'HTTP 404 missing docs' };
			},
			listWarehouseMetrics: () => {
				calls.push('list');
				return [];
			},
			runBigQueryMk: () => calls.push('mk'),
			runBigQueryLoad: (_dataset, table) => calls.push(`load:${table.table}`),
			setupWarehouseSource: () => {
				calls.push('source');
				return { result: { source_id: 7514 } };
			},
			renderGaps: () => {
				calls.push('gaps');
				return '/tmp/warehouse/GAPS.md';
			},
			staleGapsPath: null,
		});

		expect(calls).toEqual([
			'ls',
			'docs',
			'mk',
			'load:daily_new_bookings',
			'load:daily_active_subscriptions',
			'source',
			'gaps',
		]);
		expect(summary).toMatchObject({
			dataset: 'dm_demo',
			sourceId: 7514,
			loaded: ['daily_new_bookings', 'daily_active_subscriptions'],
			saved: [],
			skipped: [],
			gapsPath: '/tmp/warehouse/GAPS.md',
		});
	});

	test('live deploy fails early on docs probe 500 before writes', () => {
		const calls = [];
		expect(() => runLiveDeploy({
			projectId: '4023151',
			dataset: 'dm_demo',
			tables: sampleTables(),
			dungeonPath: '/tmp/warehouse.js',
			warehouseDir: '/tmp/warehouse',
			sqlFiles: [],
		}, {
			runBigQueryLs: () => calls.push('ls'),
			probeWarehouseMetricDocs: () => {
				calls.push('docs');
				throw new Error('HTTP 500 upstream');
			},
			runBigQueryMk: () => calls.push('mk'),
			runBigQueryLoad: () => calls.push('load'),
			setupWarehouseSource: () => calls.push('source'),
		})).toThrow(/500/);
		expect(calls).toEqual(['ls', 'docs']);
	});

	test('live deploy lists early, previews before create, and skips existing metrics', () => {
		const calls = [];
		const summary = runLiveDeploy({
			projectId: '4023151',
			dataset: 'dm_demo',
			tables: sampleTables(),
			dungeonPath: '/tmp/warehouse.js',
			warehouseDir: '/tmp/warehouse',
			sqlFiles: [],
		}, {
			runBigQueryLs: () => calls.push('ls'),
			probeWarehouseMetricDocs: () => {
				calls.push('docs');
				return { available: true, docs: {} };
			},
			listWarehouseMetrics: () => {
				calls.push('list');
				return [{ name: 'daily_new_bookings' }];
			},
			runBigQueryMk: () => calls.push('mk'),
			runBigQueryLoad: (_dataset, table) => calls.push(`load:${table.table}`),
			setupWarehouseSource: () => {
				calls.push('source');
				return { result: { source_id: 7514 } };
			},
			previewWarehouseMetric: (payload) => calls.push(`preview:${payload.sql.includes('daily_active_subscriptions') ? 'daily_active_subscriptions' : 'daily_new_bookings'}`),
			createWarehouseMetric: (payload) => calls.push(`create:${payload.name}`),
			staleGapsPath: '/tmp/warehouse/GAPS.md',
		});

		expect(calls).toEqual([
			'ls',
			'docs',
			'list',
			'mk',
			'load:daily_new_bookings',
			'load:daily_active_subscriptions',
			'source',
			'preview:daily_active_subscriptions',
			'create:daily_active_subscriptions',
		]);
		expect(summary.saved).toEqual(['daily_active_subscriptions']);
		expect(summary.skipped).toEqual(['daily_new_bookings']);
		expect(summary.staleGapsPath).toBe('/tmp/warehouse/GAPS.md');
	});

	test('live deploy surfaces bq load failures and source IAM failures without pretending success', () => {
		expect(() => runLiveDeploy({
			projectId: '4023151',
			dataset: 'dm_demo',
			tables: sampleTables(),
			dungeonPath: '/tmp/warehouse.js',
			warehouseDir: '/tmp/warehouse',
			sqlFiles: [],
		}, {
			runBigQueryLs: () => {},
			probeWarehouseMetricDocs: () => ({ available: true, docs: {} }),
			listWarehouseMetrics: () => [],
			runBigQueryMk: () => {},
			runBigQueryLoad: (_dataset, table) => {
				throw new Error(`bq load failed for ${table.table}`);
			},
			setupWarehouseSource: () => ({ result: { source_id: 7514 } }),
		})).toThrow(/bq load failed/i);

		expect(() => runLiveDeploy({
			projectId: '4023151',
			dataset: 'dm_demo',
			tables: sampleTables(),
			dungeonPath: '/tmp/warehouse.js',
			warehouseDir: '/tmp/warehouse',
			sqlFiles: [],
		}, {
			runBigQueryLs: () => {},
			probeWarehouseMetricDocs: () => ({ available: true, docs: {} }),
			listWarehouseMetrics: () => [],
			runBigQueryMk: () => {},
			runBigQueryLoad: () => {},
			setupWarehouseSource: () => {
				throw new Error('IAM grant failed');
			},
		})).toThrow(/IAM grant failed/);
	});
});