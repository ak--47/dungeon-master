import { readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';

const root = new URL('../../', import.meta.url);
const proof = {
  'Funnel.conditions': ['calibrated', 'conditions', 'eq/in conversion contrast; all eight operators also have exact output-subset checks'],
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
  'WeightedValue.__weights': ['calibrated', 'weights', 'Browse property 80/20 against neutral 50/50; separate event-weight contrast'],
  'EventConfig.weight': ['directional', 'direct event weights', 'standalone competitor 5 versus 20; Browse property share stays 80/20'],
  'EventConfig.isStrictEvent': ['structural', 'calibrates a first funnel', 'explicit false for Browse/Search/Help; standalone-only Background Activity is observed'],
  'Dungeon.stickyEventProps': ['exact', 'direct sticky properties', 'every event matches profile segment; two populated segments'],
  'value.contextFunction': ['exact', 'direct sticky properties', 'ctx.profile.segment equals generated profile; event/time/config contexts remain untested'],
  'Dungeon.campaignPerUser': ['exact', 'direct campaignPerUser', 'five UTM fields sticky over repeated eligible Browse touches per user'],
  'Dungeon.maxTouchpointsPerUser': ['exact', 'direct campaignPerUser', 'cap=2 on generated output; other caps untested'],
  'EventConfig.isAttributionEvent': ['exact', 'direct campaignPerUser', 'Browse-only eligibility, nonzero repeated touches'],
  'WorldEvent.injectProps': ['exact', 'direct world injection', 'declared incident flag only on Browse inside window; stable property preserved everywhere'],
};

const INPUT_TYPES = new Set(['Dungeon', 'DungeonCredentials', 'DungeonSwitches', 'DungeonIdentity',
  'WeightedValue', 'GroupKeyObject', 'SCDProp', 'SoupConfig', 'MacroConfig', 'EventConfig', 'Funnel',
  'AttemptsConfig', 'ExperimentConfig', 'FunnelConditionOperators', 'ExperimentVariant', 'MirrorProps',
  'LookupTableSchema', 'Persona', 'WorldEvent', 'EngagementDecay', 'DataQuality', 'StorySelect',
  'StoryExpect', 'StoryAssertion', 'DungeonStory', 'TextKeywordSet', 'TextGeneratorConfig', 'TextBatchOptions',
  'StandaloneEventConfig', 'WarehouseMetricSource', 'WarehouseMetricConfig']);
const FAMILIES = {
  metadata: 'version appName name', reproducibility: 'seed userSeed concurrency',
  'population/window': 'numUsers numEvents avgEventsPerUserPerDay numDays datasetStart datasetEnd',
  'generation limits': 'strictEventCount batchSize',
  'output/operations': 'format writeToDisk cleanup gzip verbose onProgress progressInterval',
  credentials: 'token region serviceAccount serviceSecret projectId',
  identity: 'avgDevicePerUser sessionTimeout hasSessionIds isAnonymous',
  'generated enrichment': 'hasAvatar hasLocation hasIOSDevices hasAndroidDevices hasDesktopDevices hasBrowser singleCountry',
  'attribution/ad spend': 'hasCampaigns campaignPerUser maxTouchpointsPerUser hasAdSpend',
  'schema/value': 'events userProps superProps stickyEventProps autoPowerLaw',
  'funnels/hooks': 'funnels alsoInferFunnels hook autoSortAfterEverything',
  acquisition: 'macro percentUsersBornInDataset bornRecentBias preExistingSpread',
  'cadence/retention': 'soup avgActiveDaysPerUser retentionCurve engagementDecay',
  'segments/incidents': 'personas worldEvents dataQuality',
  'other tables': 'scdProps mirrorProps groupKeys groupProps lookupTables standaloneEvents warehouseMetrics',
};
const EXCLUDED = new Set(['Dungeon.credentials', 'Dungeon.switches', 'Dungeon.identity',
  'Dungeon.hasAttributionFlags', 'Dungeon.isUIJob', 'Dungeon.subscription', 'Dungeon.attribution',
  'Dungeon.geo', 'Dungeon.features', 'Dungeon.anomalies']);

function groupFor(id) {
  if (id.startsWith('hook-')) return 'every helper and pattern export';
  if (!id.startsWith('Dungeon.')) return 'nested author inputs';
  const name = id.split('.')[1];
  return `dungeon controls / ${Object.entries(FAMILIES).find(([, names]) => names.split(' ').includes(name))?.[0] ?? 'other declared inputs'}`;
}

export function buildCoverage() {
  const entries = new Map();
  const add = (id, file, node, source, category) => {
    if (EXCLUDED.has(id) || (id.startsWith('Funnel.') && id.split('.').some(part => part.startsWith('_')))) return;
    const original = id;
    id = id.replace(/^Dungeon(Credentials|Switches|Identity)\./, 'Dungeon.')
      .replace(/^Dungeon\.hasAnonIds$/, 'Dungeon.avgDevicePerUser')
      .replace(/^Dungeon\.epochStart$/, 'Dungeon.datasetStart').replace(/^Dungeon\.epochEnd$/, 'Dungeon.datasetEnd');
    if (entries.has(id)) {
      if (original !== id) entries.get(id).aliases.push(original);
      return;
    }
    const operatorProof = id.startsWith('FunnelConditionOperators.')
      ? ['exact', 'direct condition operators', 'generated First Entry user set equals independently filtered profile set; numeric 1..4 inputs only'] : null;
    const [classification, scenario, scope] = proof[id] ?? operatorProof ?? ['gap', null, 'untested in this generated slice; see INVENTORY.md for other executor evidence'];
    entries.set(id, { id, category, classification, scenario, scope, source: file,
      group: groupFor(id), support: 'declared author input; proof scope is limited to the cited case', aliases: original === id ? [] : [original],
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
  };
  const typesText = readFileSync(new URL('types.d.ts', root), 'utf8');
  const types = ts.createSourceFile('types.d.ts', typesText, ts.ScriptTarget.Latest, true);
  function members(node, prefix) {
    ts.forEachChild(node, child => {
      if (ts.isPropertySignature(child)) {
        const name = child.name?.getText(types).replace(/^['"]|['"]$/g, '');
        const id = `${prefix}.${name}`;
        add(id, 'types.d.ts', child, types, 'type-member');
        if (child.type && ts.isTypeLiteralNode(child.type)) members(child.type, id);
      } else if (ts.isTypeLiteralNode(child)) members(child, prefix);
    });
  }
  function declarations(node, namespace = '') {
    ts.forEachChild(node, child => {
      if (ts.isModuleDeclaration(child)) declarations(child, `${namespace}${child.name.text}.`);
      else if (ts.isInterfaceDeclaration(child) || ts.isTypeAliasDeclaration(child)) {
        const name = `${namespace}${child.name.text}`;
        if (INPUT_TYPES.has(name)) members(child, name);
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
  for (const prefix of ['hook-helpers', 'hook-patterns']) {
    const file = `lib/${prefix}/index.js`;
    const source = ts.createSourceFile(file, readFileSync(new URL(file, root), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
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
  entries.set('value.contextFunction', { id: 'value.contextFunction', group: 'nested author inputs', category: 'value-form',
    classification: 'exact', scenario: 'direct sticky properties', scope: proof['value.contextFunction'][2], source: 'types.d.ts', line: 63 });
  entries.set('value.forms', { id: 'value.forms', group: 'nested author inputs', category: 'value-form', classification: 'gap',
    scenario: null, scope: 'scalars, arrays, records and zero-argument functions: no exhaustive form or nested-value proof', source: 'types.d.ts', line: 63 });
  for (const name of ['Persona.churnRate', 'Persona.activeWindow', 'Persona.soupOverride',
    'Dungeon.subscription', 'Dungeon.attribution', 'Dungeon.geo', 'Dungeon.features', 'Dungeon.anomalies']) {
    entries.set(name, { id: name, category: 'removed-control', classification: 'unsupported', scenario: null,
      group: 'unsupported', support: 'removed control; not an author input',
      scope: 'removed controls listed in INVENTORY.md; no generated claim', source: 'tests/alignment/INVENTORY.md' });
  }
  return [...entries.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function writeCoverage() {
  const entries = buildCoverage();
  const results = JSON.parse(readFileSync(new URL('./generated-results.json', import.meta.url), 'utf8'));
  for (const entry of entries) {
    const names = entry.scenario === 'baseline' ? ['calibrates a first funnel'] : [entry.scenario];
    const matching = results.outcomes.filter(outcome => names.some(name => name && outcome.name.includes(name)));
    entry.latestOutcome = matching.some(outcome => outcome.state === 'fail') ? 'fail'
      : matching.length && matching.every(outcome => outcome.state === 'pass') ? 'pass' : 'untested';
  }
  writeFileSync(new URL('./coverage.json', import.meta.url), JSON.stringify({
    classifications: ['exact', 'directional', 'calibrated', 'structural', 'gap', 'unsupported'],
    scope: 'Actual author inputs grouped like INVENTORY.md, canonicalized credential/switch/identity aliases, named presets, and all 29 helper/pattern exports. No output types or duplicate documentation occurrences.',
    limitations: ['Explicit input-type allowlist; new input types require review.',
      'An input declaration is not proof of runtime support; removed controls are unsupported.',
      'Arbitrary property keys, dayN anchors, callback bodies, dynamic recipes and external Chance APIs are not enumerated.',
      'Report/query APIs, loader forms and serialization have separate contracts; untested here.',
      'Three seeds and two sparse rates are descriptive coverage, not full Cartesian coverage or universal statistical power.',
      'Source parity extends only to explicit local source references in INVENTORY.md and GENERATED-FAILURES.md; no live Mixpanel comparison.'],
    entries,
  }, null, 2) + '\n');
  const totals = Object.fromEntries(['exact', 'directional', 'calibrated', 'structural', 'gap', 'unsupported'].map(label =>
    [label, entries.filter(entry => entry.classification === label).length]));
  writeFileSync(new URL('./COVERAGE.md', import.meta.url), `# generated proof coverage\n\n` +
    `Registry: [coverage.json](coverage.json). Rebuilt with the generated test file using the installed TypeScript parser.\n\n` +
    `Input inventory counts: ${JSON.stringify(totals)}. These are entries, not a tested-feature percentage.\n\n` +
    `Groups match [INVENTORY.md](INVENTORY.md): dungeon controls, nested author inputs, helper/pattern exports. Aliases share one behavior entry. Output records, resolved types, hook metadata, internal fields and duplicate documentation mentions are excluded. All 23 helpers and 6 patterns are listed. Untested inputs remain gaps; removed controls are unsupported.\n\n` +
    `The parser uses an explicit input-type allowlist. New type declarations need review. Arbitrary dayN/property keys, callback bodies, dynamic recipes and external Chance APIs are not exhaustively enumerated. Query/loader/serialization APIs have separate contracts and are untested here. This is not full Cartesian coverage.\n\n` +
    `Source parity is limited to the local references in INVENTORY.md and GENERATED-FAILURES.md. No live Mixpanel equivalence is claimed. Three seeds provide descriptive regression evidence only.\n\n` +
    `Classification describes intended proof strength; latestOutcome records this generated slice only. Other executor evidence remains in INVENTORY.md. Read [generated-results.json](generated-results.json) and [GENERATED-FAILURES.md](GENERATED-FAILURES.md) for red results.\n\n` +
    `## partial proofs\n\n| API | Class | Scenario | Scope |\n|---|---|---|---|\n` +
    entries.filter(entry => entry.scenario).map(entry => `| ${entry.id} | ${entry.classification} (${entry.latestOutcome}) | ${entry.scenario} | ${entry.scope} |`).join('\n') + '\n' +
    '\n## untested author inputs and exports\n\n' +
    [...new Set(entries.filter(entry => !entry.scenario).map(entry => entry.group))].sort().map(group =>
      `### ${group}\n\n` + entries.filter(entry => !entry.scenario && entry.group === group)
        .map(entry => `- ${entry.id}: ${entry.classification}. ${entry.scope}`).join('\n')).join('\n\n') + '\n');
  return entries;
}