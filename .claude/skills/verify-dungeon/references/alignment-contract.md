# 1.8.1 verification contract

For the consolidated human/AI reference, read
[simulation and counting alignment](../../../../docs/alignment/README.md).

## 1.8.2 live verification update

The [1.8.2 guide](../../../../docs/guides/1.8.2-upgrade-guide.md) and
[live report](../../../../docs/alignment/live-report.md) extend this contract with retained live comparisons.
The 1.8.1 audit below remains historical. It used selected source-derived contracts;
1.8.2 also imports isolated datasets and compares native Mixpanel query results.
Public options and defaults remain unchanged.

Automatic verifier identity now derives from emitted both-ID events. Explicit
`buildIdentityMap(profiles)` overrides retain their compatibility behavior.
List-valued held-property expansion and supported HPC/session report combinations
have source and live fixtures. Non-UTC/DST and custom session-exclusion variants
still need separate verification.

Import success is not query readiness. Reconcile totals and identity before
accepting comparisons. Historical anonymous events can join later without another
import. Every live test must use a run property and disjoint run identities.
Retain incomplete responses and do other work before a bounded retry.

Distinguish raw per-user count histograms, UTC calendar activity, and rolling
Frequency/Addiction. The default local calendar algorithm is not a universal
Mixpanel frequency rule. Lifetime attribution endpoints require conversion/lookback
eligibility; conflicting values with tied timestamps are not stable across ingest.
`minCohort` now enforces conservative independent-user lower bounds, including
custom callbacks. Unknown evidence caps a passing verdict instead of counting rows.

Use this contract when authoring, verifying, provisioning, or presenting a dungeon.
The [1.8.1 guide](../../../../docs/guides/1.8.1-upgrade-guide.md) describes the
release. The [archived report](../../../../docs/alignment/archive/1.8.1/report.md) and
[compatibility record](../../../../docs/alignment/archive/1.8.1/api-compatibility.md) retain historical prose.
Documentation ships in npm; machine-readable evidence and runnable tests remain
repository-only under `tests/alignment`.

## Define the report before measuring

Write an independent report specification before choosing assertions. Record
events, filters, identity rules, cohort definition, denominator, statistic,
window, timezone, ordering, reentry, session settings, and property selection.
Compare every assertion with that specification, including passing assertions.
An inherited default can pass the wrong report. Do not replace funnel TTC with
a numeric property, a mean with a median, or conversion with event volume to
rescue a failed story. Supplementary diagnostics must keep their own labels.

Local checks prove selected source-derived contracts, not universal Mixpanel
parity. The 1.8.1 audit read analytics source without compiling or executing it.
That audit did not run live differential queries. Macro/soup interactions, table surfaces,
arbitrary hooks, parallel execution, and several counting variants remain gaps.

## Separate a measured effect from enough evidence

Retain the story runner's computed verdict. Report semantic correctness and
evidence sufficiency separately. Full-fidelity scale does not guarantee enough
independent eligible users, mature retention cohorts, or converters. Inspect the
actual denominator on each side; event count is not independent user count.
`minCohort` checks supported selected-row population fields, not every bespoke
denominator. Meeting it alone is not full proof. Label unresolved acceptance
`INSUFFICIENT_EVIDENCE`; do not count it as a pass or a measured effect failure.

For engineered effects, measure a paired baseline with the same seed, window,
and report options. Add a neutral control (factor one, zero injection, or hook
disabled) and an unaffected control cohort where applicable. A factor-one
control must be measured, not inferred from two differently modified groups.
Report baseline, treatment, eligible users/converters, and paired lift. Keep
targets and tolerances fixed before the run; disclose any revised criterion
and preserve its original failed evidence.

## Preserve the local counting boundaries

- `Funnel.reentry` is verifier-only. Generated repetitions depend on usage
  selection and event budget. Local `reentry` defaults to `false`, including
  `countMode: 'totals'`; repeated histories require explicit `reentry: true`.
- Funnel histories include ordered restart/shared-edge behavior and inclusive
  2000ms completion grace. TTC uses completed histories under the requested
  options, not independent first occurrences of each event. First/last segment
  selection merges reached-step properties with defined fallback values;
  explicit-step selection is separate.
- Derive sessions from the full resolved user stream before HPC partitioning.
  Local defaults are UTC, a 30-minute idle timeout, and a 24-hour maximum.
  `session_id` is a diagnostic or explicit legacy mode, not the default truth.
  Non-UTC projects and project-specific hidden/excluded session events remain
  outside the live proof. List-valued HPC has 1.8.2 source and live fixtures.
- Profile device pools alone establish no identity mapping evidence. The public
  `buildIdentityMap(profiles)` helper retains profile-based compatibility behavior.
  For emitted-identity proof, derive links from valid ordinary both-ID events,
  including later Login events, and pass that explicit `identityMap` to the
  verifier. Earlier device-only rows can resolve retrospectively. Report ID
  conflicts and validation limits; generator auth policy is not ingestion parity.
- `applyPathBias` is append-only. `share` selects eligible injection recipients;
  it does not promise exact visible branch share. Measure appended payloads,
  competing events, observed path share, and paired lift separately.
- `applySessionShape` preserves records. Pass known `datasetStart`/`datasetEnd`
  bounds when clipping matters. Explicit bounds reject insufficient capacity
  before mutation; unbounded placement can cross an unknown dataset end.
- `retentionCurve` weights active-day plans. Budget, funnel spill, and observation
  horizon can prevent literal requested retention percentages. Usage anchors do
  not accumulate previous funnel TTC; retries belong to born-user first funnels.

## Keep schema and operational gates independent

Undeclared output properties fail schema review even at 100% coverage. Accept
only config-declared properties or recognized engine/SDK fields enabled for that
stream. A permissive runtime schema summary cannot override this authorship rule.
Keep user events, standalone cadence, and warehouse schemas separate.

Offline verification stops at local evidence and a deployment handoff. Do not
automatically provision, import, probe endpoints, deploy warehouse tables, or run
headless builds. Retain exact artifact prefixes and actual deployment reports.
Dry-run output is a plan, not evidence of a live outcome; preserve existing reports
before a dry run writes local files. Live work requires separate authorization.