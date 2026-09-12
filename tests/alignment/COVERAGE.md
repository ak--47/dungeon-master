# generated proof coverage

Registry: [coverage.json](coverage.json). Rebuilt with the generated test file using the installed TypeScript parser.

Inventory counts: {"exact":0,"directional":2,"calibrated":9,"structural":5,"gap":1242,"unsupported":3}. Counts include output types and repeated documentation occurrences. They are not a tested-feature percentage.

All declared type members, public package-barrel exports, named macro/soup presets, and README/HOOKS table controls have an entry. Untested entries remain gaps. Removed persona controls are unsupported. Dynamic recipe code and external Chance APIs are not exhaustively enumerated.

Classification describes the intended proof strength, not its pass status. Read [generated-results.json](generated-results.json) and [GENERATED-FAILURES.md](GENERATED-FAILURES.md) for outcomes.

## partial proofs

| API | Class | Scenario | Scope |
|---|---|---|---|
| Dungeon.concurrency | structural | baseline | fixed to one; parallel behavior is a gap |
| Dungeon.datasetEnd | structural | baseline | UTC Jan 2025 fixed window |
| Dungeon.datasetStart | structural | baseline | UTC Jan 2025 fixed window |
| Dungeon.retentionCurve | directional | retention | day-seven bounded elapsed-day ordering only; inspect generated failures |
| Dungeon.seed | structural | baseline | three pinned seeds; no cross-config common-randomness claim |
| ExperimentVariant.conversionMultiplier | calibrated | experiment | exposure-normalized unique conversion |
| ExperimentVariant.ttcMultiplier | calibrated | experiment | exposure-to-outcome TTC ratio |
| Funnel.conditions | calibrated | conditions | eq/in duplicate first funnels; other operators are gaps |
| Funnel.conversionRate | calibrated | baseline | 40% first-funnel entrants only |
| hook-patterns.applyTTCBySegmentV2 | calibrated | hook-ttc | repeated usage stream with competing organic events; inspect generated failures |
| Persona.conversionModifier | calibrated | persona-conversion | first funnel; mixed repeat traffic remains |
| Persona.eventMultiplier | directional | persona-volume | whole-stream per-profile mean volume; fixed first funnel dilutes multiplier |
| Persona.ttcModifier | calibrated | persona-ttc | unique first-funnel completion TTC ratio |
| value.__weights | calibrated | weights | Browse property 80/20 against neutral 50/50 |
| WorldEvent.affectsEvents | structural | world | Browse-only list; wildcard not covered |
| WorldEvent.volumeMultiplier | calibrated | world | 3x Browse within window; Search unaffected control |
