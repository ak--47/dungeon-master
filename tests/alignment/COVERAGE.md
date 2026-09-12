# generated proof coverage

Registry: [coverage.json](coverage.json). Rebuilt with the generated test file using the installed TypeScript parser.

Input inventory counts: {"exact":14,"directional":3,"calibrated":9,"structural":6,"gap":281,"unsupported":8}. These are entries, not a tested-feature percentage.

Groups match [INVENTORY.md](INVENTORY.md): dungeon controls, nested author inputs, helper/pattern exports. Aliases share one behavior entry. Output records, resolved types, hook metadata, internal fields and duplicate documentation mentions are excluded. All 23 helpers and 6 patterns are listed. Untested inputs remain gaps; removed controls are unsupported.

The parser uses an explicit input-type allowlist. New type declarations need review. Arbitrary dayN/property keys, callback bodies, dynamic recipes and external Chance APIs are not exhaustively enumerated. Query/loader/serialization APIs have separate contracts and are untested here. This is not full Cartesian coverage.

Source parity is limited to the local references in INVENTORY.md and GENERATED-FAILURES.md. No live Mixpanel equivalence is claimed. Three seeds provide descriptive regression evidence only.

Classification describes intended proof strength; latestOutcome records this generated slice only. Other executor evidence remains in INVENTORY.md. Read [generated-results.json](generated-results.json) and [GENERATED-FAILURES.md](GENERATED-FAILURES.md) for red results.

## partial proofs

| API | Class | Scenario | Scope |
|---|---|---|---|
| Dungeon.campaignPerUser | exact (pass) | direct campaignPerUser | five UTM fields sticky over repeated eligible Browse touches per user |
| Dungeon.concurrency | structural (pass) | baseline | fixed to one; parallel behavior is a gap |
| Dungeon.datasetEnd | structural (pass) | baseline | UTC Jan 2025 fixed window |
| Dungeon.datasetStart | structural (pass) | baseline | UTC Jan 2025 fixed window |
| Dungeon.maxTouchpointsPerUser | exact (pass) | direct campaignPerUser | cap=2 on generated output; other caps untested |
| Dungeon.retentionCurve | directional (pass) | retention | day-seven bounded elapsed-day ordering only; inspect generated failures |
| Dungeon.seed | structural (pass) | baseline | three pinned seeds; no cross-config common-randomness claim |
| Dungeon.stickyEventProps | exact (pass) | direct sticky properties | every event matches profile segment; two populated segments |
| EventConfig.isAttributionEvent | exact (pass) | direct campaignPerUser | Browse-only eligibility, nonzero repeated touches |
| EventConfig.isStrictEvent | structural (pass) | calibrates a first funnel | explicit false for Browse/Search/Help; standalone-only Background Activity is observed |
| EventConfig.weight | directional (pass) | direct event weights | standalone competitor 5 versus 20; Browse property share stays 80/20 |
| ExperimentVariant.conversionMultiplier | calibrated (pass) | experiment | exposure-normalized unique conversion |
| ExperimentVariant.ttcMultiplier | calibrated (pass) | experiment | exposure-to-outcome TTC ratio |
| Funnel.conditions | calibrated (pass) | conditions | eq/in conversion contrast; all eight operators also have exact output-subset checks |
| Funnel.conversionRate | calibrated (pass) | baseline | 40% first-funnel entrants only |
| FunnelConditionOperators.eq | exact (pass) | direct condition operators | generated First Entry user set equals independently filtered profile set; numeric 1..4 inputs only |
| FunnelConditionOperators.gt | exact (pass) | direct condition operators | generated First Entry user set equals independently filtered profile set; numeric 1..4 inputs only |
| FunnelConditionOperators.gte | exact (pass) | direct condition operators | generated First Entry user set equals independently filtered profile set; numeric 1..4 inputs only |
| FunnelConditionOperators.in | exact (pass) | direct condition operators | generated First Entry user set equals independently filtered profile set; numeric 1..4 inputs only |
| FunnelConditionOperators.lt | exact (pass) | direct condition operators | generated First Entry user set equals independently filtered profile set; numeric 1..4 inputs only |
| FunnelConditionOperators.lte | exact (pass) | direct condition operators | generated First Entry user set equals independently filtered profile set; numeric 1..4 inputs only |
| FunnelConditionOperators.neq | exact (pass) | direct condition operators | generated First Entry user set equals independently filtered profile set; numeric 1..4 inputs only |
| FunnelConditionOperators.nin | exact (pass) | direct condition operators | generated First Entry user set equals independently filtered profile set; numeric 1..4 inputs only |
| hook-patterns.applyTTCBySegmentV2 | calibrated (fail) | hook-ttc | repeated usage stream with competing organic events; inspect generated failures |
| Persona.conversionModifier | calibrated (pass) | persona-conversion | first funnel; mixed repeat traffic remains |
| Persona.eventMultiplier | directional (pass) | persona-volume | whole-stream per-profile mean volume; fixed first funnel dilutes multiplier |
| Persona.ttcModifier | calibrated (pass) | persona-ttc | unique first-funnel completion TTC ratio |
| value.contextFunction | exact (pass) | direct sticky properties | ctx.profile.segment equals generated profile; event/time/config contexts remain untested |
| WeightedValue.__weights | calibrated (pass) | weights | Browse property 80/20 against neutral 50/50; separate event-weight contrast |
| WorldEvent.affectsEvents | structural (pass) | world | Browse-only list; wildcard not covered |
| WorldEvent.injectProps | exact (pass) | direct world injection | declared incident flag only on Browse inside window; stable property preserved everywhere |
| WorldEvent.volumeMultiplier | calibrated (pass) | world | 3x Browse within window; Search unaffected control |

## untested author inputs and exports

### dungeon controls / acquisition

- Dungeon.bornRecentBias: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.macro: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.percentUsersBornInDataset: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.preExistingSpread: gap. untested in this generated slice; see INVENTORY.md for other executor evidence

### dungeon controls / attribution/ad spend

- Dungeon.hasAdSpend: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.hasCampaigns: gap. untested in this generated slice; see INVENTORY.md for other executor evidence

### dungeon controls / cadence/retention

- Dungeon.avgActiveDaysPerUser: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.engagementDecay: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.retentionCurve.day1: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.retentionCurve.day14: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.retentionCurve.day3: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.retentionCurve.day30: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.retentionCurve.day60: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.retentionCurve.day7: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.retentionCurve.day90: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.retentionCurve.type: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.soup: gap. untested in this generated slice; see INVENTORY.md for other executor evidence

### dungeon controls / credentials

- Dungeon.projectId: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.region: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.serviceAccount: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.serviceSecret: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.token: gap. untested in this generated slice; see INVENTORY.md for other executor evidence

### dungeon controls / funnels/hooks

- Dungeon.alsoInferFunnels: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.autoSortAfterEverything: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.funnels: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.hook: gap. untested in this generated slice; see INVENTORY.md for other executor evidence

### dungeon controls / generated enrichment

- Dungeon.hasAndroidDevices: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.hasAvatar: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.hasBrowser: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.hasDesktopDevices: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.hasIOSDevices: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.hasLocation: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.singleCountry: gap. untested in this generated slice; see INVENTORY.md for other executor evidence

### dungeon controls / generation limits

- Dungeon.batchSize: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.strictEventCount: gap. untested in this generated slice; see INVENTORY.md for other executor evidence

### dungeon controls / identity

- Dungeon.avgDevicePerUser: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.hasSessionIds: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.isAnonymous: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.sessionTimeout: gap. untested in this generated slice; see INVENTORY.md for other executor evidence

### dungeon controls / metadata

- Dungeon.appName: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.name: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.version: gap. untested in this generated slice; see INVENTORY.md for other executor evidence

### dungeon controls / other tables

- Dungeon.groupKeys: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.groupProps: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.lookupTables: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.mirrorProps: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.scdProps: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.standaloneEvents: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.warehouseMetrics: gap. untested in this generated slice; see INVENTORY.md for other executor evidence

### dungeon controls / output/operations

- Dungeon.cleanup: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.format: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.gzip: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.onProgress: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.progressInterval: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.verbose: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.writeToDisk: gap. untested in this generated slice; see INVENTORY.md for other executor evidence

### dungeon controls / population/window

- Dungeon.avgEventsPerUserPerDay: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.numDays: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.numEvents: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.numUsers: gap. untested in this generated slice; see INVENTORY.md for other executor evidence

### dungeon controls / reproducibility

- Dungeon.userSeed: gap. untested in this generated slice; see INVENTORY.md for other executor evidence

### dungeon controls / schema/value

- Dungeon.autoPowerLaw: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.events: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.superProps: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.userProps: gap. untested in this generated slice; see INVENTORY.md for other executor evidence

### dungeon controls / segments/incidents

- Dungeon.dataQuality: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.personas: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Dungeon.worldEvents: gap. untested in this generated slice; see INVENTORY.md for other executor evidence

### every helper and pattern export

- hook-helpers.applyLifecycleWave: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- hook-helpers.applyPathBias: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- hook-helpers.applySessionShape: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- hook-helpers.binUsersByEventCount: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- hook-helpers.binUsersByEventInRange: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- hook-helpers.cloneEvent: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- hook-helpers.countEventsBetween: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- hook-helpers.dropEventsWhere: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- hook-helpers.findFirstSequence: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- hook-helpers.hashCohort: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- hook-helpers.hashFloat: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- hook-helpers.injectAfterEvent: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- hook-helpers.injectBetween: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- hook-helpers.injectBurst: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- hook-helpers.injectOnNewDays: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- hook-helpers.isPreAuthEvent: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- hook-helpers.scaleEventCount: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- hook-helpers.scaleFunnelTTC: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- hook-helpers.scalePropertyValue: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- hook-helpers.scaleTimingBetween: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- hook-helpers.shiftEventTime: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- hook-helpers.splitByAuth: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- hook-helpers.userInProfileSegment: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- hook-patterns.applyAggregateByBin: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- hook-patterns.applyAttributedBySource: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- hook-patterns.applyFrequencyByFrequency: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- hook-patterns.applyFunnelFrequencyBreakdown: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- hook-patterns.applyTTCBySegment: gap. untested in this generated slice; see INVENTORY.md for other executor evidence

### nested author inputs

- AttemptsConfig.conversionRate: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- AttemptsConfig.max: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- AttemptsConfig.min: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- DataQuality.botEventsPerUser: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- DataQuality.botUsers: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- DataQuality.duplicateRate: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- DataQuality.emptyEvents: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- DataQuality.lateArrivingRate: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- DataQuality.nullProps: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- DataQuality.nullRate: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- DataQuality.timezoneConfusion: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- DungeonStory.archetype: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- DungeonStory.assertions: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- DungeonStory.hook: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- DungeonStory.id: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- DungeonStory.intentionalDeviations: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- DungeonStory.mixpanelReport: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- DungeonStory.narrative: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- EngagementDecay.floor: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- EngagementDecay.halfLife: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- EngagementDecay.model: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- EngagementDecay.reactivationChance: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- EngagementDecay.reactivationMultiplier: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- EventConfig.event: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- EventConfig.isAuthEvent: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- EventConfig.isChurnEvent: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- EventConfig.isFirstEvent: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- EventConfig.isSessionStartEvent: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- EventConfig.properties: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- EventConfig.relativeTimeMs: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- EventConfig.returnLikelihood: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- ExperimentConfig.name: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- ExperimentConfig.stampProfile: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- ExperimentConfig.startDaysBeforeEnd: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- ExperimentConfig.sticky: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- ExperimentConfig.variants: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- ExperimentVariant.name: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- ExperimentVariant.weight: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Funnel.attempts: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Funnel.bindPropsIndex: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Funnel.conversionWindowDays: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Funnel.description: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Funnel.exclusionEvents: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Funnel.experiment: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Funnel.isFirstFunnel: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Funnel.name: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Funnel.order: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Funnel.props: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Funnel.reentry: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Funnel.requireRepeats: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Funnel.sequence: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Funnel.stepFilters: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Funnel.timeToConvert: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Funnel.weight: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- GroupKeyObject.cardinality: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- GroupKeyObject.events: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- GroupKeyObject.key: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- LookupTableSchema.attributes: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- LookupTableSchema.entries: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- LookupTableSchema.key: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- macro.decline: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- macro.flat: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- macro.growth: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- macro.steady: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- macro.viral: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- MacroConfig.bornRecentBias: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- MacroConfig.percentUsersBornInDataset: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- MacroConfig.preExistingSpread: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- MacroConfig.preset: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- MirrorProps.daysUnfilled: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- MirrorProps.events: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- MirrorProps.strategy: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- MirrorProps.values: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Persona.engagementDecay: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Persona.name: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Persona.properties: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- Persona.weight: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- SCDProp.frequency: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- SCDProp.max: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- SCDProp.timing: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- SCDProp.type: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- SCDProp.values: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- soup.chaotic: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- soup.churny: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- soup.global: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- soup.growth: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- soup.seasonal: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- soup.spiky: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- soup.steady: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- SoupConfig.dayOfWeekWeights: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- SoupConfig.deviation: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- SoupConfig.hourOfDayWeights: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- SoupConfig.mean: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- SoupConfig.peaks: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- SoupConfig.preset: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- StandaloneEventConfig.cadence: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- StandaloneEventConfig.dimensions: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- StandaloneEventConfig.distinctIdFrom: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- StandaloneEventConfig.event: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- StandaloneEventConfig.properties: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- StoryAssertion.assert: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- StoryAssertion.breakdown: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- StoryAssertion.expect: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- StoryAssertion.minCohort: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- StoryAssertion.select: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- StoryExpect.floor: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- StoryExpect.metric: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- StoryExpect.op: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- StoryExpect.target: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextBatchOptions.n: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextBatchOptions.related: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextBatchOptions.returnType: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextBatchOptions.sharedContext: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextBatchOptions.tone: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextGeneratorConfig.authenticityLevel: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextGeneratorConfig.enableDeduplication: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextGeneratorConfig.formality: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextGeneratorConfig.includeMetadata: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextGeneratorConfig.intensity: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextGeneratorConfig.keywordDensity: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextGeneratorConfig.keywords: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextGeneratorConfig.max: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextGeneratorConfig.maxAttempts: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextGeneratorConfig.min: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextGeneratorConfig.mixedSentiment: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextGeneratorConfig.seed: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextGeneratorConfig.sentimentDrift: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextGeneratorConfig.specificityLevel: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextGeneratorConfig.style: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextGeneratorConfig.timestamps: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextGeneratorConfig.tone: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextGeneratorConfig.typoRate: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextGeneratorConfig.typos: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextGeneratorConfig.userPersona: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextKeywordSet.brands: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextKeywordSet.business_impact: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextKeywordSet.categories: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextKeywordSet.comparisons: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextKeywordSet.competitors: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextKeywordSet.credibility: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextKeywordSet.emotions: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextKeywordSet.error_messages: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextKeywordSet.errors: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextKeywordSet.events: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextKeywordSet.features: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextKeywordSet.issues: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextKeywordSet.locations: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextKeywordSet.metrics: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextKeywordSet.products: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextKeywordSet.services: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextKeywordSet.specific_issues: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextKeywordSet.specific_praise: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextKeywordSet.team: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextKeywordSet.technical: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextKeywordSet.user_actions: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextKeywordSet.vendors: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- TextKeywordSet.versions: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- value.forms: gap. scalars, arrays, records and zero-argument functions: no exhaustive form or nested-value proof
- WarehouseMetricConfig.baseline: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- WarehouseMetricConfig.columns: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- WarehouseMetricConfig.format: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- WarehouseMetricConfig.grain: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- WarehouseMetricConfig.history: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- WarehouseMetricConfig.name: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- WarehouseMetricConfig.noise: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- WarehouseMetricConfig.scale: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- WarehouseMetricConfig.source: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- WarehouseMetricConfig.sparse: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- WarehouseMetricConfig.timeColumn: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- WarehouseMetricConfig.type: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- WarehouseMetricConfig.valueColumn: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- WarehouseMetricSource.event: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- WarehouseMetricSource.groupBy: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- WarehouseMetricSource.measure: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- WarehouseMetricSource.minus: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- WarehouseMetricSource.property: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- WarehouseMetricSource.where: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- WorldEvent.aftermath: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- WorldEvent.aftermath.duration: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- WorldEvent.aftermath.volumeMultiplier: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- WorldEvent.conversionModifier: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- WorldEvent.duration: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- WorldEvent.name: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- WorldEvent.startDay: gap. untested in this generated slice; see INVENTORY.md for other executor evidence
- WorldEvent.type: gap. untested in this generated slice; see INVENTORY.md for other executor evidence

### unsupported

- Dungeon.anomalies: unsupported. removed controls listed in INVENTORY.md; no generated claim
- Dungeon.attribution: unsupported. removed controls listed in INVENTORY.md; no generated claim
- Dungeon.features: unsupported. removed controls listed in INVENTORY.md; no generated claim
- Dungeon.geo: unsupported. removed controls listed in INVENTORY.md; no generated claim
- Dungeon.subscription: unsupported. removed controls listed in INVENTORY.md; no generated claim
- Persona.activeWindow: unsupported. removed controls listed in INVENTORY.md; no generated claim
- Persona.churnRate: unsupported. removed controls listed in INVENTORY.md; no generated claim
- Persona.soupOverride: unsupported. removed controls listed in INVENTORY.md; no generated claim
