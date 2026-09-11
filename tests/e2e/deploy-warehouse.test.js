//@ts-nocheck
import { describe, test, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { pathToFileURL } from 'url';
import generate from '../../index.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const FIXTURE = path.join(ROOT, 'dungeons/technical/warehouse.js');
const CLI = path.join(ROOT, '.claude/skills/warehouse-metrics/deploy.mjs');
const TIMEOUT = 120_000;

function makeTempDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'dm-warehouse-metrics-'));
}

describe.sequential('warehouse-metrics dry-run', () => {
	test('prints the full plan, writes sql artifacts, and renders GAPS without executing live commands', async () => {
		const tmpDir = makeTempDir();
		const dataDir = path.join(tmpDir, 'data');
		const fixturePath = path.join(tmpDir, 'warehouse-fixture.mjs');
		fs.mkdirSync(dataDir, { recursive: true });
		fs.writeFileSync(fixturePath, `import base from ${JSON.stringify(pathToFileURL(FIXTURE).href)};
export default {
	...base,
	name: 'warehouse deploy fixture',
	writeToDisk: false,
	credentials: { ...(base.credentials || {}), region: 'US', token: '' },
};
`);

		const { default: fixture } = await import(`${pathToFileURL(fixturePath).href}?t=${Date.now()}`);
		await generate({
			...fixture,
			name: 'warehouse-deploy-fixture',
			writeToDisk: dataDir,
			format: 'csv',
			gzip: false,
			verbose: false,
			credentials: { ...(fixture.credentials || {}), token: '' },
		});

		const prefix = path.join(dataDir, 'warehouse-deploy-fixture');
		const dryRun = spawnSync(process.execPath, [CLI, fixturePath, '--dry-run', '--data-prefix', prefix], {
			cwd: ROOT,
			encoding: 'utf-8',
			timeout: TIMEOUT,
			env: {
				...process.env,
				BEARER_TOKEN: '',
			},
		});

		expect(dryRun.status).toBe(0);
		expect(dryRun.stdout).toContain('DRY RUN');
		expect(dryRun.stdout).toContain('bq --project_id=mixpanel-gtm-training ls --max_results=1');
		expect(dryRun.stdout).toContain('node .claude/skills/powertools/pt.mjs /crud/getWarehouseMetrics --get');
		expect(dryRun.stdout).toContain('node .claude/skills/powertools/pt.mjs /crud/getWarehouseMetrics');
		expect(dryRun.stdout).toContain('bq --project_id=mixpanel-gtm-training mk --dataset --location=US dm_warehouse_deploy_fixture');
		expect(dryRun.stdout).toContain('bq --project_id=mixpanel-gtm-training load --replace --source_format=CSV --skip_leading_rows=1 dm_warehouse_deploy_fixture.daily_new_bookings');
		expect(dryRun.stdout).toContain('project_id: <project_id>');
		expect(dryRun.stdout).toContain('node .claude/skills/powertools/pt.mjs /macro/setup-bq-warehouse');
		expect(dryRun.stdout).toContain('node .claude/skills/powertools/pt.mjs /crud/previewWarehouseMetric');
		expect(dryRun.stdout).toContain('node .claude/skills/powertools/pt.mjs /crud/createWarehouseMetric');
		expect(dryRun.stdout).toContain('"source_id":"<source_id>"');
		expect(dryRun.stdout).toContain('"project_id":"<project_id>"');
		expect(dryRun.stdout).not.toContain('"source_id":null');
		expect(dryRun.stdout).not.toContain('"source_id":NaN');
		expect(dryRun.stdout).toContain('manual fallback');

		const warehouseDir = path.join(tmpDir, 'warehouse');
		const gapsPath = path.join(warehouseDir, 'GAPS.md');
		const bookingsSqlPath = path.join(warehouseDir, 'daily_new_bookings.sql');
		const arrSqlPath = path.join(warehouseDir, 'monthly_arr_snapshot.sql');

		expect(fs.existsSync(bookingsSqlPath)).toBe(true);
		expect(fs.existsSync(arrSqlPath)).toBe(true);
		expect(fs.existsSync(gapsPath)).toBe(true);
		expect(fs.readFileSync(bookingsSqlPath, 'utf8')).toContain('SELECT * FROM `mixpanel-gtm-training.dm_warehouse_deploy_fixture.daily_new_bookings` ORDER BY date');
		expect(fs.readFileSync(gapsPath, 'utf8')).toContain('createWarehouseMetric');
		expect(fs.readFileSync(gapsPath, 'utf8')).toContain('source connected?');
	});
});