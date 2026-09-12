# public input controls and proof gaps

Sources: [types.d.ts](../../types.d.ts), [README.md](../../README.md), [HOOKS.md](../../HOOKS.md), both helper barrels, and read-only [coverage.json](coverage.json). This inventory groups actual author inputs. Output records, resolved types, hook metadata, internal runtime/storage/context fields, repeated documentation mentions, and arbitrary generated property names are excluded. An arbitrary config index signature does not make every key a supported input.

Evidence: `H` = [helpers-generated.test.js](helpers-generated.test.js), 15 tests / 11 pass / 4 red, three seeds, 102 generated runs. `G` = existing [generated.test.js](generated.test.js) scenario evidence; not rerun here, and its registry classification is not a current pass claim. `gap` means no generated proof in this execution slice. [HELPERS-FAILURES.md](HELPERS-FAILURES.md) records metrics, source references, and red assertions.

## dungeon controls

Canonical nested `credentials`, `switches`, and `identity` share their controls with flat aliases. Count each behavior once. Alias precedence is a gap here. `hasAnonIds` is a deprecated alias; `epochStart/epochEnd` alias the window. `hasAttributionFlags` is derived, `isUIJob` is internal, and Funnel underscore fields are internal; none is an author knob.

| control family | actual inputs | evidence or precise gap |
|---|---|---|
| metadata | version, appName, name | gap: logging/serialization only |
| reproducibility | seed, userSeed, concurrency | H/G: three seeds, concurrency=1; userSeed, parallel identity and cross-run equality gaps |
| population/window | numUsers, numEvents, avgEventsPerUserPerDay, numDays, datasetStart, datasetEnd | H/G fixed configurations; sweeps, precedence, exact count capacity gaps here |
| generation limits | strictEventCount, batchSize | gap: capacity/top-up, batch equivalence |
| output/operations | format, writeToDisk, cleanup, gzip, verbose, onProgress, progressInterval | H: in-memory, no network; all operational behavior gaps |
| credentials | token, region, serviceAccount, serviceSecret, projectId | disabled; imports intentionally outside sandbox audit |
| identity | avgDevicePerUser, sessionTimeout, hasSessionIds, isAnonymous | H: 0/1/4 devices, 5/30-minute full-stream sessions; enabled auth red; anonymous-only mode gap |
| generated enrichment | hasAvatar, hasLocation, hasIOSDevices, hasAndroidDevices, hasDesktopDevices, hasBrowser, singleCountry | gap: distributions and country validation |
| attribution/ad spend | hasCampaigns, campaignPerUser, maxTouchpointsPerUser, hasAdSpend | H engine-touch endpoint preservation; per-user campaign, cap sweep, ad spend gaps |
| schema/value | events, userProps, superProps, stickyEventProps, autoPowerLaw | H declared numeric property and cloned existing events; G weights; sticky projection/power-law/context functions gaps |
| funnels/hooks | funnels, alsoInferFunnels, hook, autoSortAfterEverything | H everything-hook output, final sorting exercised; other hook stages, inference, false-sort option gaps |
| acquisition | macro, percentUsersBornInDataset, bornRecentBias, preExistingSpread | H 0/100 born with custom macro; preset caps and acquisition shape sweeps gaps here |
| cadence/retention | soup, avgActiveDaysPerUser, retentionCurve, engagementDecay | G retention directional evidence only; calibrated retention, day1 spill, precedence, decay gaps |
| segments/incidents | personas, worldEvents, dataQuality | G persona/world scenarios; other members below remain gaps |
| other tables | scdProps, mirrorProps, groupKeys, groupProps, lookupTables, standaloneEvents, warehouseMetrics | gap: no helper-slice generated table proofs |

## nested author inputs

| input | documented members/forms | evidence or precise gap |
|---|---|---|
| ValueValid | scalars, arrays, nested records, WeightedValue.__weights, zero-arg/value-context functions | H numeric constant; G 80/20 versus 50/50 weighted values; other forms gap |
| EventConfig | event, weight, properties, isFirstEvent, isStrictEvent, isAuthEvent, isAttributionEvent, isSessionStartEvent, isChurnEvent, returnLikelihood, relativeTimeMs | H auth red, mixed names/properties exercised; weight calibration, all other flags and relative time gap |
| Funnel | name, description, sequence, weight, isFirstFunnel, conversionRate, timeToConvert, props, order, requireRepeats, bindPropsIndex, attempts, conditions, experiment, conversionWindowDays, exclusionEvents, reentry, stepFilters | G conversion/conditions/TTC; H attempts/auth red; other controls gap |
| AttemptsConfig | min, max, conversionRate | H min=max 0/2, final 70%; no random-range calibration; emitted retries red |
| FunnelConditionOperators | eq, neq, in, nin, gt, gte, lt, lte | G eq/in only; others gap |
| stepFilters | prop, op, value | gap: generated filter truth tables |
| ExperimentConfig | name, stampProfile, startDaysBeforeEnd, sticky, variants | G exposure-based effect; profile/sticky/time boundary gaps |
| ExperimentVariant | name, weight, conversionMultiplier, ttcMultiplier | G multipliers; assignment weight and named variant integrity gaps |
| Persona | name, weight, properties, conversionModifier, eventMultiplier, ttcModifier, engagementDecay | G three modifiers; weight/property/decay gaps |
| WorldEvent | name, type, startDay, duration, affectsEvents, volumeMultiplier, conversionModifier, injectProps, aftermath.duration, aftermath.volumeMultiplier | G affected Browse volume and Search control; wildcard, conversion, aftermath, injected values gaps |
| EngagementDecay | model, halfLife, floor, reactivationChance, reactivationMultiplier | gap: decay/resurrection calibration |
| DataQuality | nullRate, duplicateRate, lateArrivingRate, timezoneConfusion, botUsers, botEventsPerUser, nullProps, emptyEvents | gap: rates and interactions |
| MacroConfig | preset, bornRecentBias, percentUsersBornInDataset, preExistingSpread | presets flat/steady/growth/viral/decline; no preset sweep in H |
| SoupConfig | preset, deviation, peaks, mean, dayOfWeekWeights, hourOfDayWeights | presets steady/growth/spiky/seasonal/global/churny/chaotic; no timing-distribution calibration in H |
| retentionCurve | type, day1/day3/day7/day14/day30/day60/day90, arbitrary dayN anchors | G day7 direction; absolute probability, extrapolation, other anchors gaps |
| GroupKey | [key, cardinality, events?] or {key, cardinality, events?} | gap: normalization and group coverage |
| SCDProp | type, frequency, values, timing, max | gap: temporal mutations and joins |
| MirrorProps | events, strategy, values, daysUnfilled | gap: strategies and propagation |
| LookupTableSchema | key, entries, attributes | gap: table cardinality and join invariants |
| StandaloneEventConfig | event, cadence, dimensions, properties, distinctIdFrom | gap: cadence/product rows and identity-less import |
| WarehouseMetricConfig | name, type, grain, source, history, baseline, scale, noise, columns, sparse, timeColumn, valueColumn, format | gap: source aggregation, backfill, table contracts |
| WarehouseMetricSource | event, measure, property, groupBy, where, minus | gap: plus/minus aggregation and filtering |
| DungeonStory | id, hook, archetype, mixpanelReport, narrative, intentionalDeviations, assertions | verification input; not generation controls; no new story-runner proof |
| StoryAssertion/Expect/Select | breakdown(type/table/sql), select.where, expect(metric/op/target/floor), minCohort, assert callback | gap: assertion selection and verdict thresholds |
| TextGeneratorConfig | style, tone, userPersona, keywords, intensity, formality, specificityLevel, authenticityLevel, keywordDensity, typoRate, typos, mixedSentiment, sentimentDrift, min, max, seed, timestamps, includeMetadata, enableDeduplication, maxAttempts | auxiliary text API; no generated language/style proof |
| text keyword vocabulary | brands, business_impact, categories, comparisons, competitors, credibility, emotions, error_messages, errors, events, features, issues, locations, metrics, products, services, specific_issues, specific_praise, team, technical, user_actions, vendors, versions | content inputs; gap for each vocabulary family |
| TextBatchOptions | n, related, returnType, sharedContext, tone | auxiliary API; gap |

Verifier query controls (`EmulateOptions`, retention/session query options, funnel count modes and predicates) are a separate report API, not dungeon generation knobs. Existing contracts cover portions of that API; H independently derives UTC days, full-stream sessions and emitted stitch maps. Query equivalence beyond the explicit source references is unclaimed. Loader path/array/raw-source input forms and serialization helpers are also gaps in H.

## every helper and pattern export

All **23 helper exports and 6 pattern exports** appear below. Grouped names share the stated scope; helper use inside another helper does not count as a direct proof.

| export | generated evidence or precise gap |
|---|---|
| binUsersByEventCount | H indirect explicit event-bin classification; standalone boundary/null behavior gap |
| binUsersByEventInRange, countEventsBetween | gap: interval endpoints and window populations |
| userInProfileSegment | gap: generated segment matching |
| hashFloat | H indirect path share=1 only; uniformity and partial shares gap |
| hashCohort | gap: stable cohort size and overlap |
| cloneEvent | indirect through helpers; direct overrides and timestamp-form gap |
| dropEventsWhere | gap: removal selectivity and downstream reports |
| scaleEventCount | H exact 2x volume, unchanged days, neutral=1; thinning/spreadDays/boundary clipping gaps |
| scalePropertyValue | H exact 2x numeric sum, unchanged count/days; null/list/non-numeric cases gap |
| shiftEventTime | gap: formats, negative deltas, window crossings |
| scaleTimingBetween, scaleFunnelTTC, findFirstSequence | gap: independent generated proofs; G V2 pattern is separate evidence |
| injectAfterEvent, injectBetween, injectBurst | gap: position, competing events, clipping |
| injectOnNewDays | H exact calendar-day target within lifespan capacity, fresh IDs, competing Search unchanged; rolling-period equivalence unclaimed |
| isPreAuthEvent, splitByAuth | H timestamp partition and actual stitch; generated chronology red; never-auth partition covered |
| applyLifecycleWave | H empty selected-event gap, >=3 burst rows, unaffected Search; dropAll and lifecycle report classification gaps |
| applyPathBias | H exact clone counts; immediate first-branch proof red for seed 89; share calibration/top-N gaps |
| applySessionShape | H full-stream exact session formula and event preservation red at end boundary; timeout sensitivity passes |
| applyAggregateByBin | H exact numeric sum/count implied average by distinct UTC days and explicit events; rolling/report histogram not claimed |
| applyFrequencyByFrequency | H exact target-event volume by both axes; unchanged active days; this does not prove frequency-histogram lift |
| applyFunnelFrequencyBreakdown | gap: generated repeated funnel counts and true report bins |
| applyTTCBySegment | gap: legacy pattern generated proof |
| applyTTCBySegmentV2 | G hook-ttc scenario only; current status in existing generated result/failure artifacts |
| applyAttributedBySource | H firstTouch/lastTouch/both lifetime endpoints, exact touch set, neutral controls; conversion-aware lookback, weighted calibration and multi-touch report gaps |

Removed controls stay unsupported: persona churnRate/activeWindow/soupOverride and legacy subscription/attribution/geo/features/anomalies. No output field count or tested-feature percentage is reported.