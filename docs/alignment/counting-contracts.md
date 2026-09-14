# the counting contracts behind the simulation

Start with [the overview](README.md). This page records the 1.8.2 contracts and
their limits. A new report setting may require new source review and live proof;
the familiar name of a chart is not enough to select its counting algorithm.

## funnel probability belongs to an attempt

`conversionRate: 35` is a percent probability for a generated funnel pass. The
generator makes a completion draw; nonconverters receive a partial prefix. It
does not multiply 35% independently at each step. Repeated step names and configured
modifiers can alter the resolved probability before generation.

For a hypothetical independent attempt probability $p$ and $n$ opportunities,
the probability of at least one success is $1-(1-p)^n$. At $p=0.5$, four
opportunities give 93.75%. Real generated attempts can be dependent, clipped,
or selected differently by the report, so this formula explains saturation rather
than predicting every dungeon.

`conditions` controls eligibility for one funnel. Persona modifiers act more
broadly. A 1.2x modifier applied to 50% produces 60%: +10 percentage points or
+20% relative. Saturation at 100% limits the possible lift. Check warnings.

The retry API counts failed priors, followed by a final attempt. Born-in first
funnels with an auth step keep failed priors before that step. A short lifecycle
window or strict event budget can truncate otherwise configured opportunities.
Ordinary repeated usage funnels are a separate source of opportunities.

## funnel reports select histories, not arbitrary pairs

The local funnel engine follows source-derived progression, exclusions, shared
edges, and any-order blocks. Do not replace it with independent `MIN(time)` values
or a SQL join between every A and B. Those checks can credit an outcome to the
wrong attempt or combine incompatible histories.

| setting | contract |
| --- | --- |
| unique counting | credit the report-selected user progression, rather than every event pair |
| totals | repeated histories require local `reentry: true`; the public default is false |
| session counting | one-session window with no reentry; it is not a fixed 30-minute duration window |
| conversion window | whole-funnel elapsed bound; completion is strictly inside the bound |
| completion grace | completed histories consume events through an inclusive two-second grace boundary |
| shared first/last event | the closing event completes the old history; reentry decides whether it also starts another |
| exclusions | evaluate against the report history and boundary, not a user's lifetime presence of that event |
| time trends | the entry anchors the bucket; later steps can finish after the bucket edge within the conversion window |
| property allocation | first/last segmentation uses reached-step properties and defined-value fallbacks; explicit step selection is separate |

`applyFunnelDefaults` threads matching dungeon window/order/filter hints into
verification. An inherited option can verify a different report than intended.
Use explicit options for acceptance. Noncontiguous generator ordering strategies
do not all have an exact native any-order report equivalent.

## time-to-convert has several clocks

`timeToConvert` uses **hours**. The generator distributes this timing budget across
emitted steps with seeded jitter. It is not a literal promise that every selected
completion has that duration. For an ordinary N-step completed sequence, the base
offset scheme has N-1 gaps divided by N; retries, modifiers, and window handling
can further change the realized span.

`conversionWindowDays` uses days. `findFirstSequence` uses a minutes bound between
consecutive matched steps. That per-gap bound does not equal a whole-funnel
conversion window. A three-step sequence can satisfy two 30-day gaps and still
fail a 30-day funnel window.

Native funnel gap statistics use integer seconds. The live acceptance compared
counts exactly and mean TTC within one integer second. Means use the relevant
survivors at each step. Do not compare a local median with a live mean, or average
daily means without weighting their underlying populations.

V2 timing hooks operate on the full stream and can change the history the report
selects. Verify matched event IDs, completion membership, and untouched control
histories. The live 0.25x proof used a paired before/after effect adjusted for the
pre-existing target/control contrast. A raw segment ratio alone can include
baseline imbalance.

## sessions use the full resolved stream

Local defaults: 30-minute inactivity timeout, 24-hour maximum duration, UTC.
A session splits when the idle gap is **greater than** the timeout, duration is
greater than the maximum, or the UTC calendar day changes. A gap exactly equal
to the timeout stays in the session. Duration ends at the last event, not after
the idle timeout, and native duration is truncated to seconds.

Derive sessions before holding a property constant or selecting counted events.
For example, A at 00:00, unrelated activity at 00:20, and B at 00:40 can share
one session. Filtering out the middle event before sessionization falsely splits it.

Generated `session_id` is a diagnostic field. Native Mixpanel sessions are derived
at query time. The `sessionMetrics` explicit stamped mode is retained for legacy
checks; it is not interchangeable with native session reports.

Synthetic session events do not inherit every user event property. A run filter
on `$session_start` can exclude it if the project does not copy that property.
Count sessions on matching real events, or scope synthetic sessions with a trusted,
run-isolated resolved identity set. Non-UTC/DST and custom project exclusions remain
outside the default live proof.

## identity is evidence from emitted records

Raw generated events carry `user_id`, `device_id`, or both. A valid ordinary
both-ID event supplies device-to-user linking evidence, regardless of its event
name. Earlier anonymous rows can resolve retrospectively. A profile device pool
alone does not supply that evidence.

The verifier builds automatic mappings before report filtering and time buckets.
An authenticated event with a conflicting user retains that explicit user;
device-only events retain the established mapping. `buildIdentityMap(profiles)`
still supports explicit caller overrides. Such a map is trusted input, not proof
of successful ingestion.

An input `distinct_id` is treated as an already canonical downstream identifier.
Do not stamp it from a profile onto raw generated events to hide missing stitches.
Original-merge projects, B2B transformations, external mapping history, and every
ingestion validation/conflict policy are not fully reproduced locally.

An import receipt is not an identity-readiness barrier. The live study observed
the same retained stitched fixture change from zero to one conversion later,
without resending. Query-time and ingestion processing delays have no SLA derived
from this experiment. Preserve both snapshots and verify readiness.

## three meanings of frequency

Suppose a user purchases at 23:59:00, 23:59:01, and 00:01:00 the next day.

| report meaning | result | implementation |
| --- | ---: | --- |
| raw event count | 3 | count matching rows per user |
| occupied UTC calendar days | 2 | default `countDistinctPeriods`, algorithm `ui-bucket` |
| rolling one-day activity within one interval | 1 | accept an event only at least a day after the last counted event |

The local `frequencyByFrequency` emulator uses calendar-period axes. It does not
mean native raw-count histograms or the rolling Frequency/Addiction API. Its
existing default remains compatible with older hooks. For native raw-count proof,
reconstruct per-user counts and compare the actual histogram buckets.

`frequencyHistogram` provides rolling counts reset per interval. It omits zero-count
users and returns raw exact-frequency bins indexed by count minus one. The native
API postprocesses those arrays: its first slot represents total active users, and
cumulative mode changes later bins. Compare the same response layer, not raw reader
bins with a presentation response.

The local histogram infers interval bounds from the supplied stream. Native queries
have explicit bounds and can calendar-align weeks/months. Align intervals deliberately;
an unrelated first event can affect the local inferred start. Whole-second time
quantization and timezone settings are additional boundary concerns.

`binBy: 'distinctDays'` on a pattern selects its **cohort axis**. The frequency
pattern still scales raw target-event count. One-second clones usually add neither
days nor sessions. `injectOnNewDays` adds calendar-day activity where capacity and
templates exist; it does not guarantee rolling-period separation across midnight.

## numeric properties have their own population

SUM/AVG/MIN/MAX operate on eligible values. Missing and nonnumeric values do not
become zero. Filling them with zero changes both the denominator and the business
meaning of AVG. If a native report flattens list-valued numeric properties, choose
the corresponding local flattening behavior explicitly.
Explicit null values are skipped too. With no eligible numeric values, local SUM
returns zero; AVG, MIN, and MAX return null. An empty population is different from
a measured zero.

Doubling event count and doubling `amount` can both double revenue but have different
effects on order count and average order value. Decide which behavior the story
claims, then compare counts, sum, average, and the unchanged control independently.

An event-property breakdown allocates records, not necessarily disjoint users.
One user can appear in several segments. Summed segmented uniques can exceed overall
uniques. Only sum disjoint cohorts when the report actually guarantees disjointness.

## retention needs a birth and a mature return window

Choose the birth and return selectors, observation window, alignment, and mode.
For elapsed birth alignment, D7 means the interval from birth +7 days through
birth +8 days, exclusively at the upper edge. Calendar alignment instead anchors
to a calendar boundary. A distinct return normally occurs strictly after birth;
same-time rules depend on whether birth itself is an allowed matching return.

Users can form new entry cohorts in separate report intervals. Compounded retention
uses the cohort-side event as the return event. Exact, carry-back, carry-forward,
and consecutive-return modes answer different questions.

Exclude immature cohorts when calculating an accepted D7 effect: they need the
entire return bucket observed. Report the native pooled chart separately if it
includes younger cohorts. A denominator containing users who cannot yet return
can dilute or misstate the effect.

`retentionCurve` weights a finite active-day plan. Event budget, multi-step funnels,
spill, and decay determine whether an event lands inside the observed bucket.
The measured D7 contrast proves direction and practical magnitude in tested mixed
fixtures. It does not prove literal requested percentages or a universal D1 floor.

## attribution ends at each conversion

First/last-touch reads select defined property values in the eligible history ending
at the conversion timestamp. Finite native lookback bounds are inclusive. Future
touches do not count. First/last reads are uncapped; the generator's default ten
stamped touches is a separate sampling decision. Multi-touch models have other rules.

Local `attributedBy` supports first or all conversions, defaulting to `first` for
compatibility. Use `perConversion: 'all'` for an every-conversion report. Unknown
conversions remain in the denominator. The local label `unknown` corresponds to
an undefined native attribution segment; normalize labels only in comparison code.

The current local API has no finite-lookback option. Preserve full history across
conversion time buckets. Neither a bucket slice nor a lifetime endpoint can stand
in for every native lookback query. The attribution helper retains lifetime endpoint
selection; a hook can pass a deliberately eligible subset using its existing API.

Backend transitions can compress repeated values. Conflicting equal-time sources
also depend on ingestion/write order. Avoid tied touch times for deterministic
engineered stories. The study retained the original tied failures and accepted a
distinct-time follow-up; it did not fix or claim full tie-order equivalence.

## flows observe competing traffic

Unique Flows counting starts from the first eligible flow per user. Use the earliest
chronological anchor, not the first array entry. Forward/reverse slots, hidden events,
repeat collapsing, query windows, and top-N pruning all affect the visible path.

`applyPathBias` appends cloned steps after the anchor. It preserves original traffic.
Its `share` selects recipients, not the final visible branch percentage. Existing
events can intervene; missing source templates skip recipients; future clipping can
remove injected steps. Measure the full emitted path and paired branch lift.

The live proof compared native visible counts at specified levels and the intended
branch effect. Local uncommon-event buckets and deterministic tie ordering are not
complete native Sankey pruning parity.

## evidence levels keep claims honest

| evidence | establishes | does not establish |
| --- | --- | --- |
| helper/unit contract | a transformation or tiny counting rule | practical report lift under competing traffic |
| generated mixed-fixture check | behavior survived generation and final guards | import normalization or native query equivalence |
| source-derived contract | intended analytics semantics at a pinned revision | current server execution on this dataset |
| live differential | selected query matches imported data and local expectations | all settings, rendering, or statistical generality |
| browser/render check | saved chart is usable in the UI | the underlying causal claim |

`minCohort` uses conservative independent-user lower bounds. Repeated periods do
not multiply people. Custom assertions receive the guard; unsupported denominators
remain insufficient. A passing verdict still needs the correct report settings,
an observed neutral intervention, and a practical effect. Keep original failures.