# sweep history

## final sweep completed all 99 three-seed groups

command: `sandbox-exec -p '(version 1) (allow default) (deny network*)' node tests/alignment/run.mjs --sweep --timeout-ms=600000`

run commit: `012931ea2fa53a9893f937a2e43c96566015028c`. the final run followed the last infrastructure edit and commit. status: `complete`. elapsed: 337.638 seconds, including build, offline preflight, selected infrastructure tests, all generation, measurement, and report writes. all 297 cells completed. no groups were deferred. all mandatory size, focus, rarity, 3,000-user hook, and near-cap strata have three seeds. the 600-second deadline stayed unchanged.

594 dungeon generations emitted 17,083,972 events, including 2,598,510 observed Background Activity standalone rows. the smallest arm had 82 standalone rows at diagnostic small N. 125 cells met their unchanged strict bands; 172 lacked sufficient user evidence. no sufficiently powered cell was diluted, inverse, or contractfail. those findings would have remained visible as `complete-with-findings`; this run did not produce them.

the report records requested and validator-resolved knobs, warnings, compiler 5.8.3, Node v24.11.1, and start/end SHA-256 hashes for 77 compiler, engine, and harness files. all hashes match. all reported numeric quantities are finite; no null substitution paths were needed. 42 warning records report persona conversion saturation in the competing Organic funnel. its requested 112% becomes 100%; the warnings retain affected counts. the primary first-funnel measurements still meet their bands.

### capacity is the largest observed dungeon

the largest single dungeon emitted 281,751 events for the 10,000-user persona-volume treatment at rate 0.9, seed 43. it requested and resolved 270,000 events. persona multipliers can produce more than the requested count; the cap governs requests, not exact emitted totals.

the explicit near-cap conditions group requested and resolved 299,997 events per dungeon for 11,111 users at rate 0.9. its six treatment/neutral dungeons emitted 155,313 to 156,484 events. all three conditions differences met [0.25, 0.55], with observed differences 0.4384 to 0.4611. no upper cliff appeared at these tested sizes. cumulative output does not establish 17-million-event single-dungeon capacity.

peak worker RSS was 591 MiB. the unchanged controls were a 512 MiB V8 heap cap and 900 MiB RSS kill threshold sampled every 100ms. RSS includes memory outside the V8 heap; the sampled guard can overshoot between polls. no memory or deadline kill occurred in the final sweep.

### paired TTC and retention retain their original guards

hook TTC at 3,000 users passed every seed at both rates. Q ranged from 0.2499919002 to 0.25 against [0.15, 0.40]. N was exactly 1 against [0.75, 1.30]. baseline target/control ratios ranged from 0.5263652 to 1.3899900; raw treatment ratios ranged from 0.1315870 to 0.3474975. full-stream pairing assertions passed. the smallest converted target/control cohort across both generated arms was 128, above the unchanged 70 minimum.

the sampled small-N boundary remains visible. at 1,000 users and rate 0.5, hook minima were 50, 45, and 45 converted users. all three seeds were insufficient. at rate 0.9, minima were 94, 69, and 80; the 69-user seed stayed insufficient. 3,000 users was the first tested balanced size where every seed passed both rates. this brackets the sampled evidence boundary; it does not locate an exact threshold between tested sizes.

balanced retention at 1,000, 3,000, and 10,000 users produced D7 high-minus-low differences 0.1300866 to 0.3294817 against [0.10, 0.65]. neutral target-minus-control differences inside each low-curve run ranged from -0.0476695 to 0.0680412 against [-0.12, 0.12]. the smallest global eligible cohort was 759 against 250; the smallest neutral segment was 369 against 100. rarity cells retain the same minima and remain insufficient where the minority segment is too small. no replay supplies neutral evidence.

### intervals describe sampled users

JSON retains 95% Wilson intervals for every unique-user conversion and retention estimate. for the seed-17 near-cap conditions treatment, target conversion is [0.73897, 0.76158] and control is [0.29315, 0.31752]. neutral intervals are [0.38310, 0.40865] and [0.38208, 0.40794]. these are separate user-rate intervals, not a confidence interval for their difference. TTC ranges are descriptive across three fixed seeds, not inferential intervals. repeated events never increase an independent-user denominator.

all 11 sweep tests passed before the final run. they include real paired hook/retention cells, dynamic-budget updates, retention cohort minima, strict classification, and a real 12-second hanging-worker test. that test completes preflight, starts a worker and descendant, then requires exit 124 and both PIDs gone. every generation and test child runs under inherited OS network denial. the final command also passed its build, offline preflight, and selected infrastructure tests. the generated regression suite was not run or weakened.

the current artifacts are [sweep-results.json](sweep-results.json) and [sweep-results.md](sweep-results.md). the original partial run remains below as history, including its original single-run restriction. that restriction was superseded by explicit authorization for this repaired final run.

## historical appendix: the first sweep exposed incomplete focus coverage

command: `node tests/alignment/run.mjs --sweep --timeout-ms=600000`

run commit: `2adb3ec`, branch `alignment/knob-story-proof`. one full sweep was executed. runner time was 43.790 seconds; measured command wall time was 43.818 seconds. build, offline preflight, and selected infrastructure tests completed. no full regression gate ran. no deadline or memory limit fired.

69 scheduled cells completed, with 141 single-dungeon generations and 1,126,915 total events. 21 cells met their strict bands. 48 had insufficient user evidence. no sufficiently powered cell was labeled diluted, inverse, or contractfail. 75 candidate groups were deferred by conservative scheduling estimates.

the original runner exited 0. inspection found that this was an incorrect success: the scheduler favored conditions and large cells, leaving most focus scenarios at 300-user pilot size. the tracked report preserves `originalExitCode: 0`, changes the audited status to `partial`, and lists 11 missing practical-size scenario/traffic strata. no observations were regenerated or changed.

## what the run measured

- all five sizes appeared: 100, 300, 1,000, 3,000, and 10,000 users. both sparse and dense traffic appeared.
- 5% and 95% target cohorts appeared at 1,000 users. all those cells had insufficient minority-user evidence.
- the largest single dungeon emitted 76,537 events for 10,000 users. that cell requested and resolved 270,000 events. cumulative output is not a single-dungeon capacity test.
- all three 10,000-user dense conditions cells met their bands. conversion differences ranged from 0.4466 to 0.4517. neutral differences ranged from -0.0118 to 0.0182. no upper cliff was observed for these tested conditions cells.
- peak worker RSS was 355 MiB. nine warning records appear in the compact JSON. the run stayed below the 512 MiB heap and 900 MiB sampled RSS limits.
- retention D7 differences were 0.0392, -0.0111, and 0.0238. minimum eligible counts were 51, 56, and 51 against a required 250. these are insufficient evidence, including the negative seed. they do not clear the known retention gate failure.

persona TTC, persona volume, experiment, hook TTC, and retention lack practical-size coverage in both traffic strata. persona conversion lacks practical-size dense coverage. none receives a scaling claim.

## the coverage fix has focused validation

the scheduler now gives every focus scenario first claim at 1,000 users under both traffic levels, then expands size and rarity coverage. completion requires all three seeds for every required focus/traffic stratum. missing coverage returns a nonzero partial result. a regression test rejects the exact low-N-only coverage mistake found in this run.

14 independent checks passed under the OS network-denied sandbox after the repair. they include user-level Wilson intervals, strict labels, partial persistence, required coverage, real worker execution, inherited network denial, and hard process-group termination. the deadline test records both a started worker and its descendant after build/preflight, then confirms both PIDs are gone.

the repaired scheduler has not received a second full sweep, honoring the single-run instruction. the JSON and Markdown results describe the first run, not a hypothetical repaired run. full required coverage remains unverified.