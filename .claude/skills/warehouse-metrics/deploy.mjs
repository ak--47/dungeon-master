#!/usr/bin/env node

import fs from 'fs';
import path, { dirname, resolve } from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import dotenv from 'dotenv';

import { loadFromFile } from '../../../index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../../');
const PT_PATH = resolve(REPO_ROOT, '.claude/skills/powertools/pt.mjs');
const TEMPLATE_PATH = resolve(__dirname, 'GAPS-template.md');
const BQ_PROJECT = 'mixpanel-gtm-training';
const BQ_LOCATION = 'US';
const DRY_RUN_PROJECT_ID = '<project_id>';
const PREVIEW_BLOCKLIST = ['DROP', 'DELETE', 'TRUNCATE', 'ALTER', 'CREATE', 'INSERT', 'UPDATE'];
const TIMING_ONLY_KEYS = new Set(['duration_ms', 'duration_human']);
const DATASET_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

dotenv.config({ path: resolve(REPO_ROOT, '.env') });

export function normalizeDatasetName(name) {
	const normalized = String(name || 'dungeon')
		.toLowerCase()
		.replace(/[^a-z0-9_]+/g, '_')
		.replace(/_+/g, '_')
		.replace(/^_+|_+$/g, '');
	return `dm_${normalized || 'dungeon'}`;
}

export function validateDatasetName(dataset) {
	const text = String(dataset || '');
	if (!DATASET_IDENTIFIER_PATTERN.test(text)) {
		throw new Error(`dataset must be a valid BigQuery identifier using letters, numbers, and underscores: ${text || '<empty>'}`);
	}
	return text;
}

export function buildSchemaString(columns) {
	return columns.map((column) => `${column.name}:${column.bqType}`).join(',');
}

export function buildBigQueryLoadArgs({ projectId = BQ_PROJECT, dataset, table, filePath }) {
	const args = [
		`--project_id=${projectId}`,
		'load',
		'--replace',
	];
	if (table.format === 'json') {
		args.push('--source_format=NEWLINE_DELIMITED_JSON');
	} else {
		args.push('--source_format=CSV', '--skip_leading_rows=1');
	}
	args.push(`${dataset}.${table.table}`, filePath, buildSchemaString(table.columns || []));
	return args;
}

export function replaceDatasetPlaceholder(sql, dataset) {
	return String(sql).replaceAll('{{DATASET}}', dataset);
}

export function qualifyDataset(dataset) {
	return `${BQ_PROJECT}.${dataset}`;
}

export function buildWarehouseMetricSql(sql, dataset) {
	return replaceDatasetPlaceholder(sql, qualifyDataset(dataset));
}

export function mapAggregation(aggregation) {
	if (aggregation === 'last value') return 'last_value';
	if (aggregation === 'average') return 'average';
	return String(aggregation || 'none').replace(/\s+/g, '_');
}

export function buildCreateMetricPayload({ projectId, sourceId, dataset, table }) {
	return {
		project_id: String(projectId),
		source_id: sourceId,
		name: table.table,
		metric_type: 'timeseries',
		sql: buildWarehouseMetricSql(table.sql, dataset),
		value_column: table.valueColumn,
		time_column: table.timeColumn,
		aggregation: mapAggregation(table.recommendedAggregation),
		refresh: table.refreshHint,
	};
}

export function buildPreviewPayload({ projectId, sourceId, dataset, table }) {
	const sql = buildWarehouseMetricSql(table.sql, dataset);
	const blocked = findPreviewBlockedToken(sql);
	if (blocked) {
		throw new Error(
			`previewWarehouseMetric cannot run for table "${table.table}": query contains identifier "${blocked.column}" which trips the raw ${blocked.token} substring block. Rename the time column or use a manual saved-metric flow. Aliasing only works if the blocked text does not appear anywhere in the query.`,
		);
	}
	return {
		project_id: String(projectId),
		source_id: sourceId,
		sql,
	};
}

export function findPreviewBlockedToken(sql) {
	const text = String(sql || '');
	const lower = text.toLowerCase();
	const matches = lower.match(/\b[a-z0-9_]+\b/g) || [];
	for (const identifier of matches) {
		for (const token of PREVIEW_BLOCKLIST) {
			if (identifier.includes(token.toLowerCase())) {
				return { token, column: identifier };
			}
		}
	}
	return null;
}

export function extractSourceId(response) {
	const candidates = [
		response?.result?.source_id,
		response?.summary?.source_id,
		...(Array.isArray(response?.result?.steps)
			? response.result.steps.map((step) => step?.source_id)
			: []),
	];
	for (const candidate of candidates) {
		if (candidate === undefined || candidate === null || `${candidate}` === '') continue;
		if (typeof candidate === 'number') return candidate;
		if (/^\d+$/.test(String(candidate))) return Number(candidate);
		return String(candidate);
	}
	throw new Error('setup-bq-warehouse response did not include source_id in result.source_id, summary.source_id, or result.steps[].source_id');
}

export function parseWarehouseMetricListResponse(response) {
	if (Array.isArray(response)) return response;
	if (Array.isArray(response?.results)) return response.results;
	if (!response || typeof response !== 'object') {
		throw new Error(`getWarehouseMetrics returned an unexpected shape: ${JSON.stringify(response, null, 2)}`);
	}
	if (response.error) {
		throw new Error(`getWarehouseMetrics returned an error payload: ${JSON.stringify(response, null, 2)}`);
	}
	const entries = Object.entries(response);
	const numericEntries = entries.filter(([key]) => /^\d+$/.test(key));
	const nonNumericKeys = entries
		.map(([key]) => key)
		.filter((key) => !/^\d+$/.test(key));
	const unexpectedKeys = nonNumericKeys.filter((key) => !TIMING_ONLY_KEYS.has(key));
	if (numericEntries.length > 0) {
		if (unexpectedKeys.length > 0) {
			throw new Error(`getWarehouseMetrics returned an unexpected shape: ${JSON.stringify(response, null, 2)}`);
		}
		return numericEntries
			.sort((left, right) => Number(left[0]) - Number(right[0]))
			.map(([, value]) => {
				if (!value || typeof value !== 'object' || Array.isArray(value)) {
					throw new Error(`getWarehouseMetrics returned a malformed metric row: ${JSON.stringify(response, null, 2)}`);
				}
				return value;
			});
	}
	if (entries.length > 0 && unexpectedKeys.length === 0) return [];
	throw new Error(`getWarehouseMetrics returned an unexpected shape: ${JSON.stringify(response, null, 2)}`);
}

export function resolveMetricActions({ tables, existingMetrics, dataset, projectId, sourceId }) {
	const existingNames = new Set((existingMetrics || []).map((metric) => metric?.name).filter(Boolean));
	return tables.map((table) => {
		if (existingNames.has(table.table)) {
			return {
				table: table.table,
				action: 'skip-existing',
				reason: 'metric already exists',
			};
		}
		return {
			table: table.table,
			action: 'preview-and-create',
			previewPayload: buildPreviewPayload({ projectId, sourceId, dataset, table }),
			createPayload: buildCreateMetricPayload({ projectId, sourceId, dataset, table }),
		};
	});
}

export function renderCommand(file, args = []) {
	return [file, ...args].map(shellEscape).join(' ');
}

function shellEscape(value) {
	const text = String(value);
	if (/^[A-Za-z0-9_./:=@{}\-]+$/.test(text)) return text;
	return `'${text.replace(/'/g, `'\\''`)}'`;
}

export function parseArgs(argv) {
	const args = [...argv];
	const flags = {
		dryRun: pullFlag(args, '--dry-run'),
		dataset: pullOption(args, '--dataset'),
		dataPrefix: pullOption(args, '--data-prefix'),
	};
	const unknownOption = args.find((arg) => arg.startsWith('--'));
	if (unknownOption) {
		throw new Error(`unknown option: ${unknownOption}`);
	}
	const positional = args.filter((arg) => !arg.startsWith('--'));
	const [dungeonArg, extraArg] = positional;
	if (!dungeonArg) {
		throw new Error('Usage: node .claude/skills/warehouse-metrics/deploy.mjs <dungeon-path> [--dataset dm_name] [--data-prefix path/prefix] [--dry-run]');
	}
	if (extraArg) {
		throw new Error(`unexpected extra argument: ${extraArg}`);
	}
	if (flags.dataset !== undefined) validateDatasetName(flags.dataset);
	return { dungeonArg, ...flags };
}

function pullFlag(args, name) {
	const index = args.indexOf(name);
	if (index === -1) return false;
	args.splice(index, 1);
	return true;
}

function pullOption(args, name) {
	const index = args.indexOf(name);
	if (index === -1) return undefined;
	const value = args[index + 1];
	if (value === undefined || value.startsWith('--')) {
		throw new Error(`${name} requires a value`);
	}
	args.splice(index, 2);
	return value;
}

function ensureFile(filePath, label) {
	if (!fs.existsSync(filePath)) throw new Error(`${label} not found: ${filePath}`);
}

export function resolveProjectId(config) {
	const projectId = config?.projectId
		?? config?.project_id
		?? config?.credentials?.projectId
		?? config?.credentials?.project_id;
	if (!projectId) throw new Error('dungeon credentials.projectId is required. Run /create-project first or add credentials.projectId to the dungeon.');
	return String(projectId);
}

function resolveWarehouseDir(dungeonPath) {
	return path.join(path.dirname(dungeonPath), 'warehouse');
}

function resolveArtifactSet({ dungeonPath, configName, dataPrefix }) {
	if (dataPrefix) {
		return buildArtifactSet(resolve(process.cwd(), dataPrefix));
	}

	const dataDir = path.join(REPO_ROOT, 'data');
	if (!fs.existsSync(dataDir)) {
		throw new Error(`no data directory found at ${dataDir}. Run node scripts/run-dungeon.mjs ${path.relative(REPO_ROOT, dungeonPath)} first.`);
	}
	const manifestSuffix = '-WAREHOUSE-MANIFEST.json';
	const candidates = fs.readdirSync(dataDir)
		.filter((name) => name.startsWith(`${configName}-`) && name.endsWith(manifestSuffix))
		.map((name) => ({
			prefix: path.join(dataDir, name.slice(0, -manifestSuffix.length)),
			mtimeMs: fs.statSync(path.join(dataDir, name)).mtimeMs,
		}))
		.sort((left, right) => right.mtimeMs - left.mtimeMs);
	if (!candidates.length) {
		throw new Error(`no warehouse manifest found for ${configName} under ${dataDir}. Run node scripts/run-dungeon.mjs ${path.relative(REPO_ROOT, dungeonPath)} first, or pass --data-prefix.`);
	}
	return buildArtifactSet(candidates[0].prefix);
}

function buildArtifactSet(prefixPath) {
	const manifestPath = `${prefixPath}-WAREHOUSE-MANIFEST.json`;
	ensureFile(manifestPath, 'warehouse manifest');
	const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
	const tables = (manifest.tables || []).map((table) => {
		const ext = table.format === 'json' ? 'json' : 'csv';
		const filePath = `${prefixPath}-WAREHOUSE-${table.table}.${ext}`;
		ensureFile(filePath, `warehouse table ${table.table}`);
		return { ...table, filePath };
	});
	return { prefixPath, manifestPath, manifest, tables };
}

function writeSqlFiles({ warehouseDir, tables, dataset }) {
	fs.mkdirSync(warehouseDir, { recursive: true });
	const sqlFiles = [];
	for (const table of tables) {
		const sqlPath = path.join(warehouseDir, `${table.table}.sql`);
		fs.writeFileSync(sqlPath, `${buildWarehouseMetricSql(table.sql, dataset)}\n`);
		sqlFiles.push(sqlPath);
	}
	return sqlFiles;
}

function renderGaps({ dungeonPath, warehouseDir, dataset, sourceId, tables, note }) {
	fs.mkdirSync(warehouseDir, { recursive: true });
	const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
	const checklist = tables.map((table) => [
		`## ${table.table}`,
		'',
		`- source connected? ${sourceId ? `yes (${sourceId})` : 'pending'}`,
		`- sql pasted? ${path.join(warehouseDir, `${table.table}.sql`)}`,
		`- aggregation set per recommendedAggregation? ${table.recommendedAggregation}`,
		`- refresh set per refreshHint? ${table.refreshHint}`,
		`- value_column set? ${table.valueColumn}`,
		`- time_column set? ${table.timeColumn}`,
	].join('\n')).join('\n\n');
	const content = template
		.replaceAll('{{DUNGEON_PATH}}', dungeonPath)
		.replaceAll('{{WAREHOUSE_DIR}}', warehouseDir)
		.replaceAll('{{DATASET}}', dataset)
		.replaceAll('{{SOURCE_ID}}', sourceId ? String(sourceId) : 'pending')
		.replaceAll('{{NOTE}}', note || 'warehouse metric CRUD endpoint unavailable at deploy time')
		.replaceAll('{{TABLE_CHECKLIST}}', checklist);
	const gapsPath = path.join(warehouseDir, 'GAPS.md');
	if (fs.existsSync(gapsPath)) {
		console.error(`warning: overwriting existing ${gapsPath}`);
	}
	fs.writeFileSync(gapsPath, content);
	return gapsPath;
}

function commandPlan({ projectId, dataset, tables, sourceId = '<source_id>' }) {
	const listBody = { project_id: String(projectId) };
	const mkArgs = [`--project_id=${BQ_PROJECT}`, 'mk', '--dataset', `--location=${BQ_LOCATION}`, dataset];
	const commands = [{ label: 'preflight:ls', command: `bq --project_id=${BQ_PROJECT} ls --max_results=1` }];
	commands.push({
		label: 'docs:getWarehouseMetrics',
		command: `node .claude/skills/powertools/pt.mjs /crud/getWarehouseMetrics --get`,
	});
	commands.push({
		label: 'list:getWarehouseMetrics',
		command: `node .claude/skills/powertools/pt.mjs /crud/getWarehouseMetrics ${shellEscape(JSON.stringify(listBody))}`,
	});
	commands.push({ label: 'dataset', command: `bq ${mkArgs.join(' ')}` });
	for (const table of tables) {
		commands.push({
			label: `load:${table.table}`,
			command: `bq ${buildBigQueryLoadArgs({ projectId: BQ_PROJECT, dataset, table, filePath: table.filePath }).join(' ')}`,
		});
	}
	commands.push({
		label: 'source:setup-bq-warehouse',
		command: `node .claude/skills/powertools/pt.mjs /macro/setup-bq-warehouse ${shellEscape(JSON.stringify({ project_id: String(projectId), dataset, mirror: false }))}`,
	});
	for (const table of tables) {
		commands.push({
			label: `preview:${table.table}`,
			command: `node .claude/skills/powertools/pt.mjs /crud/previewWarehouseMetric ${shellEscape(JSON.stringify({ project_id: String(projectId), source_id: sourceId, sql: buildWarehouseMetricSql(table.sql, dataset) }))}`,
		});
		commands.push({
			label: `create:${table.table}`,
			command: `node .claude/skills/powertools/pt.mjs /crud/createWarehouseMetric ${shellEscape(JSON.stringify(buildCreateMetricPayload({ projectId, sourceId, dataset, table })) )}`,
		});
	}
	return commands;
}

function printDryRunSummary({ projectId, dataset, artifactSet, sqlFiles, gapsPath }) {
	console.log('DRY RUN');
	console.log(`dungeon manifest: ${artifactSet.manifestPath}`);
	console.log(`project_id: ${projectId}`);
	console.log(`dataset: ${dataset}`);
	console.log('');
	console.log('planned commands');
	for (const entry of commandPlan({ projectId, dataset, tables: artifactSet.tables })) {
		console.log(`- ${entry.command}`);
	}
	console.log('');
	console.log('artifacts');
	for (const sqlFile of sqlFiles) console.log(`- sql: ${sqlFile}`);
	console.log(`- manual fallback: ${gapsPath}`);
	console.log('');
	console.log('notes');
	console.log('- no commands were executed');
	console.log('- no bearer token or gcloud credentials were required');
	console.log('- preview/create steps are shown as the live plan; manual fallback was rendered for review');
}

function runCommand(file, args, options = {}) {
	const result = spawnSync(file, args, {
		cwd: REPO_ROOT,
		encoding: 'utf-8',
		env: process.env,
		...options,
	});
	return {
		status: result.status ?? 1,
		stdout: result.stdout || '',
		stderr: result.stderr || '',
		error: result.error || null,
		result,
	};
}

function formatSpawnError(file, exec) {
	if (!exec?.error) return null;
	return `failed to spawn ${file}: ${exec.error.message}`;
}

function parseJsonOutput(output, label) {
	try {
		return JSON.parse(output);
	} catch (error) {
		throw new Error(`${label} returned non-JSON output:\n${output || error.message}`);
	}
}

function runPt(pathname, body, { get = false } = {}) {
	const args = [PT_PATH, pathname];
	if (get) {
		args.push('--get');
	} else {
		args.push(JSON.stringify(body || {}));
	}
	const exec = runCommand(process.execPath, args);
	const spawnError = formatSpawnError(process.execPath, exec);
	if (spawnError) {
		throw new Error(`${spawnError}\n${exec.stdout}${exec.stderr}`.trim());
	}
	if (exec.status !== 0) {
		throw new Error(`pt.mjs ${pathname} failed:\n${exec.stdout}${exec.stderr}`.trim());
	}
	return parseJsonOutput(exec.stdout, `pt.mjs ${pathname}`);
}

function probeWarehouseMetricDocs() {
	const exec = runCommand(process.execPath, [PT_PATH, '/crud/getWarehouseMetrics', '--get']);
	const spawnError = formatSpawnError(process.execPath, exec);
	if (spawnError) {
		throw new Error(`${spawnError}\n${exec.stdout}${exec.stderr}`.trim());
	}
	if (exec.status === 0) return { available: true, docs: parseJsonOutput(exec.stdout, 'getWarehouseMetrics docs') };
	const combined = `${exec.stdout}\n${exec.stderr}`;
	if (/\b404\b/.test(combined)) return { available: false, reason: combined.trim() };
	throw new Error(`warehouse metric docs probe failed:\n${combined}`.trim());
}

function listWarehouseMetrics(projectId) {
	const response = runPt('/crud/getWarehouseMetrics', { project_id: String(projectId) });
	return parseWarehouseMetricListResponse(response);
}

function runBigQueryLs() {
	const exec = runCommand('bq', [`--project_id=${BQ_PROJECT}`, 'ls', '--max_results=1']);
	const spawnError = formatSpawnError('bq', exec);
	if (spawnError) {
		throw new Error(`${spawnError}\n${exec.stdout}${exec.stderr}`.trim());
	}
	if (exec.status !== 0) {
		throw new Error(`bq ls preflight failed:\n${exec.stdout}${exec.stderr}`.trim());
	}
}

function runBigQueryMk(dataset) {
	const exec = runCommand('bq', [`--project_id=${BQ_PROJECT}`, 'mk', '--dataset', `--location=${BQ_LOCATION}`, dataset]);
	const spawnError = formatSpawnError('bq', exec);
	if (spawnError) {
		throw new Error(`${spawnError}\n${exec.stdout}${exec.stderr}`.trim());
	}
	if (exec.status === 0) return;
	const combined = `${exec.stdout}\n${exec.stderr}`;
	if (/already exists/i.test(combined)) return;
	throw new Error(`bq mk failed:\n${combined}`.trim());
}

function runBigQueryLoad(dataset, table) {
	const exec = runCommand('bq', buildBigQueryLoadArgs({ projectId: BQ_PROJECT, dataset, table, filePath: table.filePath }));
	const spawnError = formatSpawnError('bq', exec);
	if (spawnError) {
		throw new Error(`${spawnError}\n${exec.stdout}${exec.stderr}`.trim());
	}
	if (exec.status !== 0) {
		throw new Error(`bq load failed for ${table.table}:\n${exec.stdout}${exec.stderr}`.trim());
	}
}

function setupWarehouseSource(projectId, dataset) {
	return runPt('/macro/setup-bq-warehouse', {
		project_id: String(projectId),
		dataset,
		mirror: false,
	});
}

function previewWarehouseMetric(payload) {
	return runPt('/crud/previewWarehouseMetric', payload);
}

function createWarehouseMetric(payload) {
	return runPt('/crud/createWarehouseMetric', payload);
}

export function runLiveDeploy({ projectId, dataset, tables, dungeonPath, warehouseDir, sqlFiles }, overrides = {}) {
	const staleGapsPath = overrides.staleGapsPath !== undefined
		? overrides.staleGapsPath
		: (fs.existsSync(path.join(warehouseDir, 'GAPS.md')) ? path.join(warehouseDir, 'GAPS.md') : null);
	const deps = {
		runBigQueryLs,
		probeWarehouseMetricDocs,
		listWarehouseMetrics,
		runBigQueryMk,
		runBigQueryLoad,
		setupWarehouseSource,
		previewWarehouseMetric,
		createWarehouseMetric,
		renderGaps,
		extractSourceId,
		resolveMetricActions,
		...overrides,
	};

	deps.runBigQueryLs(dataset);
	const docsProbe = deps.probeWarehouseMetricDocs();
	const existingMetrics = docsProbe.available ? deps.listWarehouseMetrics(projectId) : [];

	deps.runBigQueryMk(dataset);
	for (const table of tables) deps.runBigQueryLoad(dataset, table);

	const sourceResponse = deps.setupWarehouseSource(projectId, dataset);
	const sourceId = deps.extractSourceId(sourceResponse);

	if (!docsProbe.available) {
		const gapsPath = deps.renderGaps({
			dungeonPath,
			warehouseDir,
			dataset,
			sourceId,
			tables,
			note: `docs probe returned 404 for /crud/getWarehouseMetrics. ${docsProbe.reason}`,
		});
		return {
			dataset,
			sourceId,
			loaded: tables.map((table) => table.table),
			saved: [],
			skipped: [],
			sqlFiles,
			gapsPath,
			staleGapsPath: null,
		};
	}

	const actions = deps.resolveMetricActions({
		tables,
		existingMetrics,
		dataset,
		projectId,
		sourceId,
	});
	const saved = [];
	const skipped = [];
	for (const action of actions) {
		if (action.action === 'skip-existing') {
			skipped.push(action.table);
			continue;
		}
		deps.previewWarehouseMetric(action.previewPayload);
		deps.createWarehouseMetric(action.createPayload);
		saved.push(action.table);
	}

	return {
		dataset,
		sourceId,
		loaded: tables.map((table) => table.table),
		saved,
		skipped,
		sqlFiles,
		gapsPath: null,
		staleGapsPath,
	};
}

function printLiveSummary(summary) {
	console.log('deploy summary');
	console.log(`dataset: ${summary.dataset}`);
	console.log(`source_id: ${summary.sourceId}`);
	for (const table of summary.loaded) console.log(`- loaded: ${table}`);
	for (const table of summary.saved) console.log(`- metric saved: ${table}`);
	for (const table of summary.skipped) console.log(`- metric skipped: ${table}`);
	if (summary.gapsPath) console.log(`- manual fallback: ${summary.gapsPath}`);
	for (const sqlFile of summary.sqlFiles) console.log(`- sql: ${sqlFile}`);
	if (summary.staleGapsPath) console.log(`- existing gaps left in place: ${summary.staleGapsPath}`);
}

async function main() {
	const { dungeonArg, dryRun, dataset: datasetOverride, dataPrefix } = parseArgs(process.argv.slice(2));
	const dungeonPath = resolve(process.cwd(), dungeonArg);
	ensureFile(dungeonPath, 'dungeon file');
	const config = await loadFromFile(dungeonPath);
	if (!Array.isArray(config.warehouseMetrics) || config.warehouseMetrics.length === 0) {
		throw new Error('dungeon does not declare warehouseMetrics');
	}
	const artifactSet = resolveArtifactSet({ dungeonPath, configName: config.name, dataPrefix });
	const projectId = dryRun
		? String(
			config?.projectId
			?? config?.project_id
			?? config?.credentials?.projectId
			?? config?.credentials?.project_id
			?? DRY_RUN_PROJECT_ID,
		)
		: resolveProjectId(config);
	const dataset = validateDatasetName(datasetOverride || normalizeDatasetName(config.name));
	const warehouseDir = resolveWarehouseDir(dungeonPath);
	const sqlFiles = writeSqlFiles({ warehouseDir, tables: artifactSet.tables, dataset });

	if (dryRun) {
		const gapsPath = renderGaps({
			dungeonPath,
			warehouseDir,
			dataset,
			sourceId: null,
			tables: artifactSet.tables,
			note: 'dry-run rendered the manual fallback plan without probing live endpoints',
		});
		printDryRunSummary({ projectId, dataset, artifactSet, sqlFiles, gapsPath });
		return;
	}

	if (!process.env.BEARER_TOKEN) {
		throw new Error('BEARER_TOKEN missing from .env. Live deploy requires powertools auth.');
	}
	const summary = runLiveDeploy({
		projectId,
		dataset,
		tables: artifactSet.tables,
		dungeonPath,
		warehouseDir,
		sqlFiles,
	});
	printLiveSummary(summary);
}

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isEntrypoint) {
	main().catch((error) => {
		console.error(error.message);
		process.exit(1);
	});
}