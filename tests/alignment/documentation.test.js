import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, existsSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import ts from 'typescript';
import * as helpers from '../../lib/hook-helpers/index.js';
import * as patterns from '../../lib/hook-patterns/index.js';

vi.mock('node:fs', async importOriginal => ({
  ...await importOriginal(), writeFileSync: vi.fn(), renameSync: vi.fn(),
}));

const root = resolve(import.meta.dirname, '../..');
const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const path = resolve(directory, entry.name);
  return entry.isDirectory() ? walk(path) : [path];
});

describe('alignment documentation', () => {
  it('keeps local Markdown links resolvable in the consolidated docs', () => {
    const files = [
      ...['AGENTS.md', 'README.md', 'HOOKS.md'].map(path => resolve(root, path)),
      ...walk(resolve(root, 'docs')).filter(path => path.endsWith('.md')),
      ...walk(resolve(root, '.claude/skills')).filter(path => path.endsWith('.md')),
    ];
    const broken = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
      for (const match of text.matchAll(/\[[^\]\n]*\]\(([^\s)]+)\)/g)) {
        if (/^(?:[a-z]+:|#|\/)/i.test(match[1])) continue;
        const path = decodeURI(match[1].split(/[?#]/)[0]);
        if (!existsSync(resolve(dirname(file), path))) broken.push(`${file.slice(root.length + 1)} -> ${path}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('preserves measured overview totals and valid public recipe imports', () => {
    const guide = readFileSync(resolve(root, 'docs/alignment/README.md'), 'utf8');
    const evidence = JSON.parse(readFileSync(resolve(root, 'tests/alignment/live/evidence.json'), 'utf8'));
    for (const count of [evidence.imported, evidence.comparisons, evidence.effects]) expect(guide).toContain(count.toLocaleString('en-US'));
    const recipes = readFileSync(resolve(root, 'docs/alignment/story-recipes.md'), 'utf8');
    const blocks = [...recipes.matchAll(/```js\n([\s\S]*?)```/g)];
    expect(blocks).toHaveLength(8);
    for (const block of blocks) {
      const source = ts.createSourceFile('recipe.js', block[1], ts.ScriptTarget.Latest, true);
      expect(source.parseDiagnostics).toHaveLength(0);
      for (const statement of source.statements.filter(ts.isImportDeclaration)) {
        const exported = statement.moduleSpecifier.text.endsWith('hook-patterns') ? patterns : helpers;
        for (const element of statement.importClause.namedBindings.elements) expect(typeof exported[element.name.text]).toBe('function');
      }
    }
  });

  it('writes default sweep prose to docs while preserving custom output prefixes', async () => {
    const { writeReport } = await import('./sweep.mjs');
    const report = () => ({ status: 'partial', budgetMs: 600000, cells: [], scheduledCells: 3 });
    vi.mocked(writeFileSync).mockClear();
    vi.mocked(renameSync).mockClear();
    writeReport(report(), resolve(root, 'tests/alignment/sweep-results'));
    expect(renameSync).toHaveBeenCalledWith(resolve(root, 'docs/alignment/sweep-results.md.tmp'), resolve(root, 'docs/alignment/sweep-results.md'));
    expect(renameSync).toHaveBeenCalledWith(resolve(root, 'tests/alignment/sweep-results.json.tmp'), resolve(root, 'tests/alignment/sweep-results.json'));
    writeReport(report(), resolve(root, 'tmp/custom-sweep'));
    expect(renameSync).toHaveBeenCalledWith(resolve(root, 'tmp/custom-sweep.md.tmp'), resolve(root, 'tmp/custom-sweep.md'));
  });

  it('writes coverage prose into docs with valid relative links', async () => {
    const { writeCoverage } = await import('./coverage-registry.mjs');
    vi.mocked(writeFileSync).mockClear();
    writeCoverage();
    const markdown = vi.mocked(writeFileSync).mock.calls.find(([path]) => String(path).endsWith('/docs/alignment/coverage.md'));
    expect(markdown).toBeDefined();
    expect(markdown[1]).toContain('../../tests/alignment/coverage.json');
    expect(markdown[1]).toContain('archive/1.8.1/generated-failures.md');
    expect(vi.mocked(writeFileSync).mock.calls.some(([path]) => String(path).endsWith('/tests/alignment/COVERAGE.md'))).toBe(false);
  });
});