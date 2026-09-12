# generated helper findings

Command (local installed Vitest; no global setup, installs, or network):

```sh
sandbox-exec -p '(version 1) (allow default) (deny network*)' ./node_modules/.bin/vitest run --config tests/alignment/vitest.config.js tests/alignment/helpers-generated.test.js 2>&1 | tail -50
```

Result: **15 tests, 11 passed, 4 failed**, final repeat 11.91s total / 11.53s tests (previous run 12.30s / 11.92s, same outcomes). All three seeds completed: `alignment-generated-17`, `alignment-generated-43`, `alignment-generated-89`. 102 actual generation runs: 36 bin/scaling, 30 session/shape, 18 attribution, 18 identity. Each config requests 300 users and 9,000 events across January 2025 UTC. Competing Browse/Search/Help and repeated funnels remain present. No production edits. Red assertions remain normal failing tests.

Thresholds preceded the first output: 100 eligible users for helpers, 100 stitched and 30 anonymous users for enabled identity, 250 identity owners, 100 multi-device owners for average 4; 10 users with divergent event/day bin membership; 60 affected users; exact integer/property invariants; timeout session ratio >1.3; new-day lift >=1.5; path share=1 requires every eligible first branch. Neutral runs use the same measured metric. RNG-consuming hooks can change later users' draws, so paired runs are not claimed to share identical streams; exact per-user controls come from the pre-hook stream.

## FOUND 1: session retiming loses events at the dataset end

`applySessionShape` promises retiming without additions or drops. The final emitted stream violates event preservation and the helper's exact cluster formula.

| seed | neutral lost events | treatment lost events | treatment missing sessions | emitted treatment sessions |
|---|---:|---:|---:|---:|
| 17 | 0 | 18 | 7 | 2382 |
| 43 | 0 | 29 | 9 | 2386 |
| 89 | 0 | 29 | 10 | 2305 |

Source: [shape.js](../../lib/hook-helpers/shape.js#L173) states the preservation contract. Its session placement floors the last event to a day and places clusters within that entire day. It has no dataset-end clamp. [user-loop.js](../../lib/orchestrators/user-loop.js#L901) then unconditionally removes future timestamps. A window ending at midnight permits an original event at that instant but cannot contain the later same-day cluster. The counts above measure loss directly; the boundary mechanism is source-supported, not a separately instrumented per-clone trace.

The timeout proof passes independently: full-stream derived sessions at 5 versus 30 minutes are **8598/2899, 9057/2983, 8896/2951**. Both timeout runs have identical emitted timestamps and counts. Browse-session totals are computed only AFTER full-stream sessionization. Stamped IDs agree with derived partitions. Source: local `analytics/backend/arb/reader/queries/session_query.cpp:906` uses strict gap `>` and day-index change; [utils.js](../../lib/utils/utils.js#L1879) implements the same predicates.

## FOUND 2: injected paths do not guarantee the immediate first branch

At `share: 1`, path `Search -> Help` immediately following the first Browse appears for **298/298, 300/300, 298/300** eligible treatment users. Neutral first-branch counts are **211/299, 217/298, 216/299**. Both injected event counts are exact; seed 89 still has two nonmatching first branches.

Source: [shape.js](../../lib/hook-helpers/shape.js#L111) documents first-anchor Flows intent. `applyPathBias` appends clones at +2s/+4s in this test and does not remove, move, or reserve space against intervening original traffic. [HOOKS.md](../../HOOKS.md) section 2.17 documents first-flow semantics. This is a strict intended-branch proof failure, not proof that the helper fails its narrower append contract. Arbitrary-share calibration, top-N Sankey visibility, and collapsed-repeat Flows remain gaps.

## FOUND 3: chronological pre-auth records can already carry user identity

Both device-enabled tests fail. Ownership uses a test-side `insert_id -> meta.profile.distinct_id` ledger, never a `user_id` filter. The actual merge map contains only emitted events carrying BOTH IDs. Unstitched devices stay unresolved; profile device pools are not treated as evidence of a real stitch.

| devices | failed priors | seed | stitched / no emitted auth | pre-auth user_id leaks | no-auth invalid rows | entry-count mismatches |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 0 | 17 | 213 / 87 | 180 | 10 | 0 |
| 1 | 0 | 43 | 216 / 84 | 133 | 3 | 0 |
| 1 | 0 | 89 | 210 / 90 | 164 | 2 | 0 |
| 1 | 2 | 17 | 212 / 88 | 1727 | 21 | 2 |
| 1 | 2 | 43 | 206 / 94 | 1934 | 53 | 5 |
| 1 | 2 | 89 | 193 / 107 | 1539 | 59 | 8 |
| 4 | 0 | 17 | 207 / 93 | 202 | 27 | 0 |
| 4 | 0 | 43 | 215 / 85 | 169 | 0 | 0 |
| 4 | 0 | 89 | 212 / 88 | 131 | 1 | 0 |
| 4 | 2 | 17 | 217 / 83 | 1863 | 106 | 3 |
| 4 | 2 | 43 | 195 / 105 | 1397 | 34 | 1 |
| 4 | 2 | 89 | 205 / 95 | 1563 | 33 | 4 |

Source: [user-loop.js](../../lib/orchestrators/user-loop.js#L824) defines pre-auth by timestamp before `authTime`. But [user-loop.js](../../lib/orchestrators/user-loop.js#L635) generates usage after conversion using a cursor anchored at the first attempt, and [funnels.js](../../lib/generators/funnels.js#L337) stamps non-first-funnel traffic as `both`. Execution order therefore does not guarantee chronological post-auth order. The test observes 131-202 pre-auth leaks without retries and 1397-1934 with two retries.

The additional no-emitted-auth and missing-entry invariants also remain red. [user-loop.js](../../lib/orchestrators/user-loop.js#L504) defines failed priors plus one final attempt; [funnels.js](../../lib/generators/funnels.js#L245) truncates priors before auth. Final future filtering can remove auth or retry rows. These are emitted-data findings, not a claim that every no-auth user was internally a nonconverter. Distinguishing clipped conversion from true nonconversion requires another diagnostic slice.

Device zero passes with user-only pre-existing traffic. Device one stays single-device; average four produces 153-177 multi-device owners without retries and 243-250 with retries. Session-sticky device consistency AFTER timestamp-mutating hooks is not covered.

## passed evidence and corrected fixture assumptions

- Aggregate and frequency patterns: distinct-day bins and explicit event-count bins each pass exact per-user changes on three seeds. 137/142/142 users have divergent axes. Neutral ratios are exactly 1. Aggregate/scaled-volume ratios are 1.454/1.458/1.486 for day bins and 1.964/1.965/1.980 for event bins. `scaleEventCount` and `scalePropertyValue` each produce exactly 2x their target metric; active days remain unchanged.
- `injectOnNewDays`: summed Browse active days rise from within-run baselines 2280/2289/2301 to 4487/4462/4436. Exact per-user target respects lifespan capacity. Search counts remain unchanged.
- Lifecycle: all eligible treatment gaps contain zero Browse events; neutral gaps contain 744/715/751. Each eligible treatment has at least three resurrection events within four hours. Eligibility requires a surviving template outside the gap, as the source requires.
- Attribution: all three models preserve the exact engine touch-ID list and nonselected values. Selected lifetime endpoint share changes from zero to 100% with deterministic weights; each run has 298-300 users with at least two touches. This proves lifetime endpoints only. Local `analytics/backend/libquery/whoval/read.cpp:173` bounds FIRST by query range; `:650` bounds LAST by lookback end. Conversion-aware last touch and stochastic weight calibration remain gaps, explicitly documented by [attributed-by-source.js](../../lib/hook-patterns/attributed-by-source.js#L48).

Initial fixture failures are retained here for audit. Natural traffic supplied only four divergent-axis users against the predeclared minimum ten. Half the generated users now have their existing Search events concentrated on one day, without deleting competing traffic or changing the threshold. A default scale clone initially crossed the dataset end (29 emitted versus 30 expected); [mutate.js](../../lib/hook-helpers/mutate.js#L86) documents future clipping. Bin/scaling fixtures now reserve two minutes of timestamp headroom. The lifecycle fixture initially included users whose only Browse templates were inside the removed gap; eligibility now follows the documented surviving-template requirement. No production failure assertion was relaxed.