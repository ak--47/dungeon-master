# bounded alignment sweep

status: **partial**. elapsed: 43790ms. deadline: 600000ms (includes build and preflight).

completed cells: 69/69. dungeons: 141. events: 1126915. largest single dungeon: 76537 events.

verdict counts: {"supported":21,"insufficient-evidence":48,"diluted":0,"inverse":0,"contractfail":0}. deferred groups: 75.

required coverage missing: focus:persona-conversion/dense/users>=1000, focus:persona-ttc/sparse/users>=1000, focus:persona-ttc/dense/users>=1000, focus:persona-volume/sparse/users>=1000, focus:persona-volume/dense/users>=1000, focus:experiment/sparse/users>=1000, focus:experiment/dense/users>=1000, focus:hook-ttc/sparse/users>=1000, focus:hook-ttc/dense/users>=1000, focus:retention/sparse/users>=1000, focus:retention/dense/users>=1000.

event totals across cells do not establish single-dungeon capacity. intervals use unique users, never event totals. seed spreads are descriptive across three fixed seeds, not population confidence intervals.

a completed schedule can contain diagnostic failures. insufficient evidence is expected at small N. diluted and inverse effects stay visible. contractfail includes strict band misses and broken count invariants. unsupported-envelope labels do not change thresholds.

no universal upper-cliff claim is supported. inspect each tested size and its labels below. memory is bounded by one worker, a 512 MiB V8 heap cap, a 900 MiB sampled RSS kill threshold, and a 300,000 requested-event cap. sampled RSS can overshoot between polls.

| scenario/users/traffic/target% | seeds | effect min | effect mean | effect max | verdicts |
| --- | ---: | ---: | ---: | ---: | --- |
| conditions/300/sparse/50 | 3 | 0.3632 | 0.4471 | 0.5648 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| persona-conversion/300/sparse/50 | 3 | 0.2947 | 0.3028 | 0.3098 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| persona-ttc/300/sparse/50 | 3 | 0.2449 | 0.2553 | 0.2637 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| persona-volume/300/sparse/50 | 3 | 2.4095 | 2.7490 | 3.1061 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| experiment/300/sparse/50 | 3 | 0.2332 | 0.2812 | 0.3056 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| hook-ttc/300/sparse/50 | 3 | 0.0433 | 0.3241 | 0.8657 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| retention/300/sparse/50 | 3 | -0.0111 | 0.0173 | 0.0392 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| conditions/10000/dense/50 | 3 | 0.4466 | 0.4490 | 0.4517 | supported, supported, supported |
| conditions/10000/sparse/50 | 3 | 0.4422 | 0.4569 | 0.4666 | supported, supported, supported |
| conditions/100/dense/50 | 3 | 0.4390 | 0.4971 | 0.5322 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| conditions/100/sparse/50 | 3 | 0.3481 | 0.4160 | 0.5200 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| conditions/1000/dense/50 | 3 | 0.4354 | 0.4556 | 0.4716 | supported, supported, supported |
| conditions/1000/sparse/50 | 3 | 0.3878 | 0.4528 | 0.4993 | supported, supported, supported |
| conditions/3000/dense/50 | 3 | 0.4437 | 0.4556 | 0.4646 | supported, supported, supported |
| conditions/3000/sparse/50 | 3 | 0.4365 | 0.4568 | 0.4718 | supported, supported, supported |
| conditions/300/dense/50 | 3 | 0.4041 | 0.4484 | 0.4733 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| conditions/1000/sparse/5 | 3 | 0.3930 | 0.4408 | 0.5263 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| conditions/1000/dense/5 | 3 | 0.4464 | 0.4777 | 0.5335 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| conditions/1000/sparse/95 | 3 | 0.3833 | 0.4118 | 0.4588 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| conditions/1000/dense/95 | 3 | 0.4261 | 0.4400 | 0.4567 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| persona-conversion/10000/sparse/50 | 3 | 0.3071 | 0.3155 | 0.3280 | supported, supported, supported |
| persona-conversion/100/dense/50 | 3 | 0.2362 | 0.3177 | 0.3939 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| persona-ttc/100/dense/50 | 3 | 0.2285 | 0.2425 | 0.2598 | insufficient-evidence, insufficient-evidence, insufficient-evidence |

failure: Post-run audit found insufficient scheduled focus coverage. Original runner exit 0 was incorrect. Scheduler and completion predicate repaired; no second full sweep executed.
