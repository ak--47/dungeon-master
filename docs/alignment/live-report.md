# v1.8.2 live alignment report

This report records pre-publication validation. PR #15 was subsequently merged
as `2810f3b`, and the maintainer published 1.8.2. Statements below about actions
not performed refer to the validation run. Start with the
[alignment reference](README.md) for the accumulated counting knowledge.

## datasets now have live report evidence

The run imported **2,603,397 synthetic events** into project **4063241**. Accepted
sets passed **1,893 local/live comparisons** and **102 effect checks**. These counts
include correlated checks and repeated cohort denominators; they are not independent
experiments or a coverage percentage.

The actual sender imported generated datasets. Native Mixpanel queries measured
them through the local headless client. Counts require exact equality. Funnel mean
TTC permits one second for integer-second report rounding. All accepted responses
are unsampled and untruncated. Three fixed seeds are descriptive regression evidence.

Source of truth: analytics revision `717286d2d3ed03e9e3f9cb4346e4c6b2e561fb9a`.
The source was inspected locally. It was not compiled or executed locally. The live
query service supplied the independent execution evidence.

Machine-readable results, query payloads, response hashes, and historical snapshots
are in [evidence.json](../../tests/alignment/live/evidence.json). Raw event sets remain under the explicit
run IDs in ignored `tmp/alignment-1.8.2/`.

## shipped corrections

| correction | reproduced defect | validated behavior |
| --- | --- | --- |
| automatic identity | profile device pools created a false cross-device conversion | only emitted both-ID records link automatically; explicit maps retain compatibility |
| conflicting identity | a prior device mapping replaced a later explicit authenticated user | automatic mappings preserve that event's user; device-only events keep the established link |
| session report wrapper | supported HPC/session combinations threw; defaults inserted incompatible millisecond windows | wrapper reaches full-stream session-aware counting; implicit one-session window survives |
| list HPC | separately parsed arrays never matched raw Map keys | per-value histories, duplicate cursor visits, and mixed list/scalar source semantics |
| attribution | missing properties displaced valid touches; touchless conversions vanished; buckets lost prior history | defined touches only, unknown conversions retained, full history available to bucketed conversions |
| evidence guard | repeated period rows inflated cohorts; custom callbacks bypassed the guard | conservative independent-user lower bounds; unknown evidence caps passing verdicts |
| exposure properties | synthetic experiment exposures omitted declared global properties | run and segment filters retain exposures and outcomes |
| funnel-frequency determinism | random insertion IDs selected keep/drop outcomes | stable identity/event/time fields select repeatable outcomes |

Public exports, signatures, options, dependencies, and declarations are unchanged.
Corrected results can differ from 1.8.1. The sender's compatibility option and import
ordering were deliberately left unchanged after live diagnostics failed to justify
a change.

## accepted live sets

| set | exact comparisons | effect checks | measured result |
| --- | ---: | ---: | --- |
| exact counts and boundaries | 28 | 0 | totals, uniques, sum/average, repeated funnels, identity, retention, scalar/list HPC sessions, rolling frequency, first/last attribution |
| conditions, persona TTC, V2 TTC | 252 | 18 | conversion lift 43.1-49.3 percentage points; persona TTC about 0.25x; baseline-adjusted V2 TTC about 0.25x |
| persona conversion | 90 | 6 | treatment lift 26.2-32.0 percentage points; neutral differences inside declared band |
| volume, weights, incidents, retention | 1,080 | 18 | volume 2.90-3.12x; weighted common share about 80%; incident volume 2.79-3.15x with controls; mature D7 lift 21.7-23.5 points |
| corrected experiments | 90 | 12 | conversion lift 29.4-31.5 points and TTC 0.247-0.250x; neutral arms passed |
| aggregate, funnel frequency, legacy TTC | 120 | 24 | exact 2x numeric scaling; conversion lift 52.8-57.2 points; first-funnel legacy TTC about 0.5x |
| bounded frequency and distinct-time attribution | 185 | 18 | exact 2x target volume and matching raw-count histograms; eligible first-touch source share 100%, neutral 0% |
| generated sessions and paths | 48 | 6 | session counts exactly match after reshaping; visible path share 99.0-99.3%, lift 25.2-29.0 points |

Session comparisons use full-stream UTC inactivity sessions. Flows compares native
visible level counts plus paired branch effects; this does not prove every Sankey
pruning mode. The funnel-frequency proof applies the existing helper to full user
history in `everything`; it does not prove a partial-history `funnel-post` call can
predict future user activity.

## failures remain in the record

**Query readiness.** Initial totals missed rows even after successful import receipts.
Later queries reconciled without resending. The exact identity fixture first showed
zero stitched conversions and later showed one, while the unstitched control stayed
zero. The final identity query was computed at `2026-09-13T13:27:18Z`. This run does
not establish a readiness SLA. Reconcile before accepting any local/live report.

**Exposure filters.** The first experiment batch had 9,000 exposure records without
declared scenario fields. Its filtered funnel was empty. The generator fix was
tested red/green, then only experiments were regenerated and verified live.

**Attribution ties.** The initial generated attribution set had 26 per-source count
differences. Several different sources shared the earliest timestamp. Backend write
order can select a different tied value. No tolerance was widened. The original
differences remain in `historicalPatternFailures`; a distinct-time follow-up matched
exactly. That follow-up is conditional proof, not a claim that ambiguous ties were fixed.

**Clone capacity.** Initial frequency treatment ratios were about 1.997x rather than
2x because clones crossed the dataset end. The helper return value counts attempted
clones; final output is clipped. The follow-up reserved time capacity and matched
exactly. The original capacity finding remains. No runtime contract was changed to
hide clipping.

**Adapter mistakes.** Flows rejected report-level property filters, retention table
mode returned a headline rather than cohort arrays, and the importer renamed `source`
to `$source`. Those query translations were corrected and rerun. Early empty and
incorrectly scoped responses are not accepted evidence.

## remaining limits

- UTC/default-session contracts only. Non-UTC/DST and project-specific excluded
  session events need their own configured-project matrix.
- Local totals retains `reentry: false`; native general totals comparisons explicitly
  enable repeated histories locally. No silent default migration occurred.
- List HPC covers tested scalar/list expansion. Scalar-only legacy key handling,
  explicit-list-only mode, extreme numeric/structured formatting, and cardinality
  limits are not complete ARB equivalence.
- Calendar activity, rolling Frequency/Addiction, and raw per-user event counts
  remain separate APIs and report meanings. No existing default was redefined.
- Attribution has no public finite-lookback parameter. The local first/all conversion
  default remains unchanged. Lifetime helper endpoints must be made eligible for the
  requested report; tied values and transition compression remain limits.
- Retention knobs weight activity plans; they do not guarantee literal requested
  return probabilities under every event budget. Rare populations can remain insufficient.
- Warehouse deployments, SCD/group/lookup joins, all macro/soup combinations, long
  windows, high-density extremes, arbitrary callbacks, and all project identity modes
  are not covered by this live study.
- Browser rendering was not verified because the integrated browser lacked a logged-in
  project session. Query access worked through bearer auth. No dashboard was required
  for the native report comparisons.

## release gates

- Offline unit/integration regression: 2,022 passed, one existing skip, 93 files.
- Final offline alignment gate: 335 passed across 19 files, including evidence
  integrity, in 75.82 seconds on committed runtime source `d8d2907`.
- Bounded alignment sweep: 297 cells, 594 generations, 17,083,972 cumulative events,
  359.566 seconds. 125 supported and 172 insufficient-evidence cells; no diluted,
  inverse, or contract-failure cells. Largest dungeon: 281,751 events.
- Determinism, skill contracts, and evidence integrity: 19 passed.
- Story CLI disk/in-memory/failure paths and public module E2E: 14 passed.
- Full engine-shape sweep: all 194 configurations passed in 258.2 seconds.
- Typecheck passed. Package dry-run includes the 1.8.2 guide and excludes tests,
  credentials, raw artifacts, plans, and research. No new runtime dependency.

The default full E2E suite and all-vertical smoke script were not run. Focused
E2E gates covered the changed story/module workflows, and the full engine matrix
covered the no-hook generation contract. No GitHub Actions workflow is configured
in this checkout; these are completed local gates, not a claim of remote CI success.

All offline gates used non-pruning configuration and OS network denial where
specified. The default destructive setup was not run. No customer project was
queried, no data deleted, no merge performed, and no npm package published.

## reproduce and inspect

See [README.md](live-validation.md) for opt-in commands and prerequisites. Accepted run IDs
and exact query settings are stored in the snapshot. Run identifiers also exist as
event properties in [the test project](https://mixpanel.com/project/4063241/app/settings/project).
Run all live scripts serially. The ledger reserves 2,603,427 rows, including a
30-row pre-send failure, against the authorized 25-million cap.

The release supports the measured contracts above. It does not claim universal
Mixpanel engine parity or that a local story verdict replaces live verification.