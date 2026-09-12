# the first sweep exposed incomplete focus coverage

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