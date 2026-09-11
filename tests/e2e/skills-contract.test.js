import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';

const root = path.resolve(import.meta.dirname, '../..');
const skillsRoot = path.join(root, '.claude/skills');
const readSkill = (name) => fs.readFileSync(path.join(skillsRoot, name, 'SKILL.md'), 'utf8');

describe('1.8.0 skill contracts', () => {
	test('release-check is shared and keeps publishing explicitly gated', () => {
		const canonical = path.join(skillsRoot, 'release-check/SKILL.md');
		const text = readSkill('release-check');
		for (const directory of ['.agents', '.github']) {
			expect(fs.realpathSync(path.join(root, directory, 'skills/release-check/SKILL.md'))).toBe(fs.realpathSync(canonical));
		}
		for (const command of ['npm test', 'npm run typecheck', 'npm pack --dry-run', 'git diff --check']) {
			expect(text).toContain(command);
		}
		expect(text).toContain('Never publish to npm');
		expect(text).toContain('explicit');
	});

	test('every shipped skill has valid discoverable YAML frontmatter', () => {
		for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const text = readSkill(entry.name);
			const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
			expect(frontmatter, entry.name).not.toBeNull();
			const metadata = parse(frontmatter[1]);
			expect(metadata.name, entry.name).toBe(entry.name);
			expect(typeof metadata.description, entry.name).toBe('string');
			expect(typeof metadata['argument-hint'], entry.name).toBe('string');
			expect(frontmatter[1], entry.name).toMatch(/^argument-hint: (?:'[^\n]*'|"[^\n]*")$/m);
		}
	});

	test('warehouse-metrics is the canonical skill and executable location', () => {
		expect(fs.existsSync(path.join(skillsRoot, 'warehouse-metrics/deploy.mjs'))).toBe(true);
		expect(fs.existsSync(path.join(skillsRoot, 'deploy-warehouse'))).toBe(false);
		for (const name of ['README.md', 'AGENTS.md', 'CHANGELOG.md', 'docs/guides/1.8.0-upgrade-guide.md']) {
			const text = fs.readFileSync(path.join(root, name), 'utf8');
			expect(text, name).toContain('/warehouse-metrics');
			expect(text, name).not.toContain('/deploy-warehouse');
		}
	});

	test('authoring and verification distinguish both metric data surfaces', () => {
		for (const name of ['create-dungeon', 'write-hooks', 'verify-dungeon']) {
			const text = readSkill(name);
			expect(text, name).toContain('standaloneEvents');
			expect(text, name).toContain('warehouseMetrics');
		}
		for (const name of ['create-dungeon', 'create-project', 'headless-build', 'powertools']) {
			expect(readSkill(name), name).toContain('/warehouse-metrics');
		}
		const authoring = readSkill('create-dungeon');
		expect(authoring).toContain('../../../lib/utils/utils.js');
		expect(authoring).toContain('type: \'additive\'');
		expect(authoring).not.toContain('type: \'range\'');
		expect(authoring).toContain('source.minus');
		expect(authoring).toContain('every plus and minus event');
		expect(authoring).toContain('cannot be a warehouse source');
		expect(authoring).toContain('tickCount <= 1');
		for (const name of ['write-hooks', 'verify-dungeon']) {
			const text = readSkill(name).replace(/\s+/g, ' ');
			expect(text, name).toContain('before the user loop');
			expect(text, name).toMatch(/after (?:the user loop|user generation)/);
			expect(text, name).toMatch(/(?:Returning|returning|;) `undefined`\s+drops/);
			expect(text, name).toMatch(/return value is ignored/i);
			expect(text, name).toContain('{{PREFIX}}-STANDALONE*.json');
			expect(text, name).toContain('warehouse-stats');
		}
		const verification = readSkill('verify-dungeon');
		expect(verification).toContain('even if the dungeon exports no `stories`');
		expect(verification).toContain('warehouseAudits');
		for (const name of ['verify-dungeon', 'analyze-soup']) {
			const text = readSkill(name);
			expect(text, name).not.toContain('npm run prune');
			expect(text, name).not.toContain('rm -f');
			expect(text, name).toContain('consent');
			expect(text, name).toContain('gzip: false');
		}
		expect(readSkill('headless-build')).toContain('refreshWarehouseMetric');
		expect(readSkill('warehouse-metrics')).toContain('--data-prefix <verified-prefix>');
		expect(readSkill('warehouse-metrics')).toContain('roles/resourcemanager.projectIamAdmin');
	});

	test('internal session artifacts are ignored by the repository', () => {
		const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
		expect(ignore).toMatch(/^\/\.superpowers\/$/m);
		const output = execFileSync('git', ['check-ignore', '--no-index', '.superpowers/skill-audit-probe.md'], { cwd: root, encoding: 'utf8' });
		expect(output.trim()).toBe('.superpowers/skill-audit-probe.md');
	});
});