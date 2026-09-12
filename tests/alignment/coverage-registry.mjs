import { readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';

const root = new URL('../../', import.meta.url);
const proof = {
  'Funnel.conditions': ['calibrated', 'conditions', 'eq/in duplicate first funnels; other operators are gaps'],
  'Funnel.conversionRate': ['calibrated', 'baseline', '40% first-funnel entrants only'],
  'Persona.conversionModifier': ['calibrated', 'persona-conversion', 'first funnel; mixed repeat traffic remains'],
  'Persona.ttcModifier': ['calibrated', 'persona-ttc', 'unique first-funnel completion TTC ratio'],
  'Persona.eventMultiplier': ['directional', 'persona-volume', 'whole-stream per-profile mean volume; fixed first funnel dilutes multiplier'],
  'ExperimentVariant.conversionMultiplier': ['calibrated', 'experiment', 'exposure-normalized unique conversion'],
  'ExperimentVariant.ttcMultiplier': ['calibrated', 'experiment', 'exposure-to-outcome TTC ratio'],
  'WorldEvent.volumeMultiplier': ['calibrated', 'world', '3x Browse within window; Search unaffected control'],
  'WorldEvent.affectsEvents': ['structural', 'world', 'Browse-only list; wildcard not covered'],
  'Dungeon.retentionCurve': ['directional', 'retention', 'day-seven bounded elapsed-day ordering only; inspect generated failures'],
  'Dungeon.seed': ['structural', 'baseline', 'three pinned seeds; no cross-config common-randomness claim'],
  'Dungeon.concurrency': ['structural', 'baseline', 'fixed to one; parallel behavior is a gap'],
  'Dungeon.datasetStart': ['structural', 'baseline', 'UTC Jan 2025 fixed window'],
  'Dungeon.datasetEnd': ['structural', 'baseline', 'UTC Jan 2025 fixed window'],
  'hook-patterns.applyTTCBySegmentV2': ['calibrated', 'hook-ttc', 'repeated usage stream with competing organic events; inspect generated failures'],
  'value.__weights': ['calibrated', 'weights', 'Browse property 80/20 against neutral 50/50'],
};

export function buildCoverage() {
  const entries = new Map();
  const add = (id, file, node, source, category) => {
    if (entries.has(id)) return;
    const [classification, scenario, scope] = proof[id] ?? ['gap', null, 'inventoried; no generated proof in this slice'];
    entries.set(id, { id, category, classification, scenario, scope, source: file,
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
  };
  const typesText = readFileSync(new URL('types.d.ts', root), 'utf8');
  const types = ts.createSourceFile('types.d.ts', typesText, ts.ScriptTarget.Latest, true);
  function members(node, prefix) {
    ts.forEachChild(node, child => {
      if (ts.isPropertySignature(child) || ts.isMethodSignature(child)) {
        const name = child.name?.getText(types).replace(/^['"]|['"]$/g, '');
        const id = `${prefix}.${name}`;
        add(id, 'types.d.ts', child, types, 'type-member');
        if (child.type) members(child.type, id);
      } else members(child, prefix);
    });
  }
  function declarations(node, namespace = '') {
    ts.forEachChild(node, child => {
      if (ts.isModuleDeclaration(child)) declarations(child, `${namespace}${child.name.text}.`);
      else if (ts.isInterfaceDeclaration(child) || ts.isTypeAliasDeclaration(child)) {
        const name = `${namespace}${child.name.text}`;
        add(name, 'types.d.ts', child, types, 'type');
        members(child, name);
      } else declarations(child, namespace);
    });
  }
  declarations(types);
  for (const file of ['lib/templates/macro-presets.js', 'lib/templates/soup-presets.js']) {
    const source = ts.createSourceFile(file, readFileSync(new URL(file, root), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!['MACRO_PRESETS', 'SOUP_PRESETS'].includes(declaration.name.getText(source)) ||
          !declaration.initializer || !ts.isObjectLiteralExpression(declaration.initializer)) continue;
        const prefix = declaration.name.getText(source) === 'MACRO_PRESETS' ? 'macro' : 'soup';
        for (const preset of declaration.initializer.properties) {
          if (preset.name) add(`${prefix}.${preset.name.getText(source)}`, file, preset, source, 'named-preset');
        }
      }
    }
  }
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  for (const [exportPath, target] of Object.entries(pkg.exports)) {
    const file = typeof target === 'string' ? target : target.import;
    const source = ts.createSourceFile(file, readFileSync(new URL(file, root), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const prefix = exportPath === '.' ? 'main' : exportPath.slice(2);
    for (const statement of source.statements) {
      if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) add(`${prefix}.${element.name.text}`, file, element, source, 'export');
      } else if (statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
        if (statement.name) add(`${prefix}.${statement.name.text}`, file, statement, source, 'export');
        if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations)
          add(`${prefix}.${declaration.name.getText(source)}`, file, declaration, source, 'export');
      }
    }
  }
  for (const file of ['README.md', 'HOOKS.md']) {
    const lines = readFileSync(new URL(file, root), 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (!/^\|/.test(line)) return;
      const firstCell = line.split('|')[1];
      for (const match of firstCell.matchAll(/`([^`]+)`/g)) {
        const id = `${file}:${match[1]}`;
        entries.set(id, { id, category: 'documented-table-entry', classification: 'gap', scenario: null,
          scope: 'documentation occurrence; see matching qualified type/export entry for partial proofs', source: file, line: index + 1 });
      }
    });
  }
  entries.set('value.__weights', { id: 'value.__weights', category: 'value-form', classification: 'calibrated',
    scenario: 'weights', scope: proof['value.__weights'][2], source: 'README.md', line: 165 });
  for (const name of ['Persona.churnRate', 'Persona.activeWindow', 'Persona.soupOverride']) {
    entries.set(name, { id: name, category: 'removed-control', classification: 'unsupported', scenario: null,
      scope: 'documented removed no-op controls; no generated claim', source: 'types.d.ts', line: 1784 });
  }
  return [...entries.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function writeCoverage() {
  const entries = buildCoverage();
  writeFileSync(new URL('./coverage.json', import.meta.url), JSON.stringify({
    classifications: ['exact', 'directional', 'calibrated', 'structural', 'gap', 'unsupported'],
    scope: 'All declared type members, package-barrel exports, named macro/soup presets, and README/HOOKS table controls. Inventory is not proof completeness. Dynamic recipe code and external Chance APIs are not exhaustively enumerated.',
    entries,
  }, null, 2) + '\n');
  const totals = Object.fromEntries(['exact', 'directional', 'calibrated', 'structural', 'gap', 'unsupported'].map(label =>
    [label, entries.filter(entry => entry.classification === label).length]));
  writeFileSync(new URL('./COVERAGE.md', import.meta.url), `# generated proof coverage\n\n` +
    `Registry: [coverage.json](coverage.json). Rebuilt with the generated test file using the installed TypeScript parser.\n\n` +
    `Inventory counts: ${JSON.stringify(totals)}. Counts include output types and repeated documentation occurrences. They are not a tested-feature percentage.\n\n` +
    `All declared type members, public package-barrel exports, named macro/soup presets, and README/HOOKS table controls have an entry. Untested entries remain gaps. Removed persona controls are unsupported. Dynamic recipe code and external Chance APIs are not exhaustively enumerated.\n\n` +
    `Classification describes the intended proof strength, not its pass status. Read [generated-results.json](generated-results.json) and [GENERATED-FAILURES.md](GENERATED-FAILURES.md) for outcomes.\n\n` +
    `## partial proofs\n\n| API | Class | Scenario | Scope |\n|---|---|---|---|\n` +
    entries.filter(entry => entry.scenario).map(entry => `| ${entry.id} | ${entry.classification} | ${entry.scenario} | ${entry.scope} |`).join('\n') + '\n');
  return entries;
}