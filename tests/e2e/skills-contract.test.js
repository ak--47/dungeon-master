import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';

const root = path.resolve(import.meta.dirname, '../..');
const skillsRoot = path.join(root, '.claude/skills');
const readSkill = (name) => fs.readFileSync(path.join(skillsRoot, name, 'SKILL.md'), 'utf8');

describe('1.8.1 skill contracts', () => {
	test('all nine skills share a resolvable proof contract through both aliases', () => {
		const names = fs.readdirSync(skillsRoot, { withFileTypes: true })
			.filter(entry => entry.isDirectory()).map(entry => entry.name);
		expect(names).toHaveLength(9);
		const contract = path.join(skillsRoot, 'verify-dungeon/references/alignment-contract.md');
		for (const name of names) {
			const canonical = path.join(skillsRoot, name, 'SKILL.md');
			const reference = readSkill(name).match(/\]\(([^)]+alignment-contract\.md)\)/);
			expect(reference, name).not.toBeNull();
			expect(fs.realpathSync(path.resolve(path.dirname(canonical), reference[1])), name)
				.toBe(fs.realpathSync(contract));
			for (const alias of ['.agents', '.github']) {
				expect(fs.realpathSync(path.join(root, alias, 'skills', name, 'SKILL.md')), name)
					.toBe(fs.realpathSync(canonical));
			}
		}
		const text = fs.readFileSync(contract, 'utf8').replace(/\s+/g, ' ');
		for (const rule of ['independent report specification', 'including passing assertions',
			'neutral control', 'INSUFFICIENT_EVIDENCE', 'selected source-derived contracts',
			'before HPC partitioning', '24-hour maximum', 'Profile device pools alone',
			'2000ms completion grace', 'append-only', 'actual deployment reports']) {
			expect(text, rule).toContain(rule);
		}
	});

	test('authoring separates generated repetitions from verifier reentry', () => {
		for (const name of ['create-dungeon', 'write-hooks']) {
			const text = readSkill(name).replace(/\s+/g, ' ');
			expect(text, name).toContain('`reentry` is verifier-only');
			expect(text, name).toContain('`reentry: false`');
			expect(text, name).not.toMatch(/engine (?:emits one|produces ONE) (?:funnel )?sequence per user/);
		}
	});

	test('schema authoring uses current retention and profile projection contracts', () => {
		const text = readSkill('create-dungeon').replace(/\s+/g, ' ');
		expect(text).toContain('retentionCurve: {');
		expect(text).toContain("type: 'logarithmic'");
		expect(text).toContain('day7: 0.50');
		expect(text).not.toContain('retentionCurve: [');
		expect(text).toContain("stickyEventProps: ['Plan', 'Region']");
		expect(text).toContain('`hasAttributionFlags` is derived');
		expect(text).not.toContain('hasAdSpend, hasAttributionFlags');
		expect(text).toContain('only to a named preset');
		expect(text).toContain('`attempts` applies only to born-user first funnels');
	});

	test('hook guidance rejects known cursor, cohort, sorting, and schema misconceptions', () => {
		const text = readSkill('write-hooks').replace(/\s+/g, ' ');
		expect(text).toContain('Usage anchors do not accumulate previous funnel TTC');
		expect(text).toContain('This skill never changes schema');
		expect(text).toContain('const isWhale = hashCohort(uid, 2)');
		expect(text).toContain('no manual output sort');
		expect(text).toContain('not exact visible branch share');
		expect(text).not.toContain('Trust pre-stamped');
		expect(text).not.toContain("userEvents.sort((a, b)");
		expect(text).not.toContain('Mixpanel TTC reads each step\'s FIRST occurrence');
		expect(text).not.toContain('Only modify schema if');
	});

	test('verification references retain strict schema gates and independent evidence review', () => {
		const verification = readSkill('verify-dungeon').replace(/\s+/g, ' ');
		expect(verification).toContain('Every story, including passing targets');
		expect(verification).toContain('independent report specification');
		expect(verification).toContain('INSUFFICIENT_EVIDENCE');
		for (const name of ['sql-recipes.md', 'counting-semantics.md', 'report-format.md']) {
			const text = fs.readFileSync(path.join(skillsRoot, 'verify-dungeon/references', name), 'utf8');
			expect(text, name).toContain('(alignment-contract.md)');
			expect(text, name).not.toMatch(/Uniform enrichment is acceptable|Mark as STRONG by code inspection|Trust pre-stamped|cohorts of all sizes should produce clear signal/);
		}
		const sql = fs.readFileSync(path.join(skillsRoot, 'verify-dungeon/references/sql-recipes.md'), 'utf8');
		expect(sql).toContain('any undeclared key, even at 100% coverage');
		expect(sql).not.toContain('WITH step1 AS');
		expect(sql).not.toContain('MIN(time::TIMESTAMP) FILTER');
		expect(sql).not.toContain('implicit baseline');
		expect(sql).not.toContain('events up to 30 days before');
		expect(sql).not.toContain('derive from MAX(time)');
		expect(sql).toContain('Uniform coverage does not make them acceptable');
	});

	test('operational skills preserve offline boundaries and the actual report', () => {
		expect(readSkill('analyze-soup')).toContain('diagnostic heuristics, not alignment acceptance criteria');
		expect(readSkill('create-project')).toContain('never run it automatically during offline verification');
		expect(readSkill('powertools')).toContain('make no network calls');
		expect(readSkill('warehouse-metrics')).toContain('Dry-run is not read-only');
		const headless = readSkill('headless-build');
		expect(headless).toContain('INSUFFICIENT_EVIDENCE');
		expect(headless).toContain('Use each story\'s declared tolerance');
		expect(headless).not.toContain('Use a wider tolerance');
		const release = readSkill('release-check');
		expect(release).toContain('`npm test` excludes alignment');
		expect(release).toContain('node tests/alignment/run.mjs --sweep --timeout-ms=600000');
		expect(release).toContain('report NOT RUN');
	});
});

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