# bounded alignment sweep

status: **complete**. elapsed: 339097ms. deadline: 600000ms (includes build and preflight).

completed cells: 297/297. dungeons: 594. events: 17083972. largest single dungeon: 281751 events.

verdict counts: {"supported":125,"insufficient-evidence":172,"diluted":0,"inverse":0,"contractfail":0}. deferred groups: 0.

required coverage missing: none recorded.

event totals across cells do not establish single-dungeon capacity. intervals use unique users, never event totals. seed spreads are descriptive across three fixed seeds, not population confidence intervals.

a completed schedule can contain diagnostic failures. insufficient evidence is expected at small N. diluted and inverse effects stay visible. contractfail includes strict band misses and broken count invariants. unsupported-envelope labels do not change thresholds.

no universal upper-cliff claim is supported. inspect each tested size and its labels below. memory is bounded by one worker, a 512 MiB V8 heap cap, a 900 MiB sampled RSS kill threshold, and a 300,000 requested-event cap. sampled RSS can overshoot between polls.

| scenario/users/traffic/target% | seeds | effect min | effect mean | effect max | verdicts |
| --- | ---: | ---: | ---: | ---: | --- |
| conditions/300/sparse/50 | 3 | 0.3711 | 0.4462 | 0.5334 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| persona-conversion/300/sparse/50 | 3 | 0.2884 | 0.3347 | 0.3598 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| persona-ttc/300/sparse/50 | 3 | 0.2532 | 0.2564 | 0.2586 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| persona-volume/300/sparse/50 | 3 | 2.6852 | 2.9325 | 3.1023 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| experiment/300/sparse/50 | 3 | 0.2284 | 0.3001 | 0.3656 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| hook-ttc/300/sparse/50 | 3 | 0.2500 | 0.2500 | 0.2500 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| retention/300/sparse/50 | 3 | 0.1723 | 0.1781 | 0.1883 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| conditions/1000/dense/50 | 3 | 0.3782 | 0.4271 | 0.4557 | supported, supported, supported |
| persona-conversion/1000/dense/50 | 3 | 0.3105 | 0.3315 | 0.3452 | supported, supported, supported |
| persona-ttc/1000/dense/50 | 3 | 0.2467 | 0.2489 | 0.2508 | supported, supported, supported |
| persona-volume/1000/dense/50 | 3 | 2.8514 | 2.8838 | 2.9378 | supported, supported, supported |
| experiment/1000/dense/50 | 3 | 0.2921 | 0.3089 | 0.3190 | supported, supported, supported |
| hook-ttc/1000/dense/50 | 3 | 0.2500 | 0.2500 | 0.2500 | supported, insufficient-evidence, supported |
| retention/1000/dense/50 | 3 | 0.2615 | 0.3015 | 0.3280 | supported, supported, supported |
| conditions/1000/sparse/50 | 3 | 0.3880 | 0.4406 | 0.4705 | supported, supported, supported |
| persona-conversion/1000/sparse/50 | 3 | 0.3056 | 0.3225 | 0.3402 | supported, supported, supported |
| persona-ttc/1000/sparse/50 | 3 | 0.2479 | 0.2492 | 0.2501 | supported, supported, supported |
| persona-volume/1000/sparse/50 | 3 | 2.7963 | 2.9876 | 3.0906 | supported, supported, supported |
| experiment/1000/sparse/50 | 3 | 0.2717 | 0.3055 | 0.3267 | supported, supported, supported |
| hook-ttc/1000/sparse/50 | 3 | 0.2500 | 0.2500 | 0.2500 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| retention/1000/sparse/50 | 3 | 0.1301 | 0.1512 | 0.1693 | supported, supported, supported |
| hook-ttc/3000/dense/50 | 3 | 0.2500 | 0.2500 | 0.2500 | supported, supported, supported |
| hook-ttc/3000/sparse/50 | 3 | 0.2500 | 0.2500 | 0.2500 | supported, supported, supported |
| conditions/10000/dense/50 | 3 | 0.4379 | 0.4479 | 0.4608 | supported, supported, supported |
| conditions/10000/sparse/50 | 3 | 0.4389 | 0.4462 | 0.4515 | supported, supported, supported |
| conditions/100/dense/50 | 3 | 0.4000 | 0.4635 | 0.5483 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| conditions/100/sparse/50 | 3 | 0.4061 | 0.4918 | 0.5920 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| conditions/3000/dense/50 | 3 | 0.4213 | 0.4461 | 0.4670 | supported, supported, supported |
| conditions/3000/sparse/50 | 3 | 0.4256 | 0.4411 | 0.4574 | supported, supported, supported |
| conditions/300/dense/50 | 3 | 0.3891 | 0.4462 | 0.5061 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| conditions/1000/sparse/5 | 3 | 0.3111 | 0.4251 | 0.4865 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| conditions/1000/dense/5 | 3 | 0.3703 | 0.4657 | 0.5381 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| conditions/1000/sparse/95 | 3 | 0.3840 | 0.4427 | 0.4800 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| conditions/1000/dense/95 | 3 | 0.3326 | 0.4429 | 0.5083 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| conditions/11111/dense/50 | 3 | 0.4384 | 0.4483 | 0.4611 | supported, supported, supported |
| persona-conversion/10000/dense/50 | 3 | 0.3186 | 0.3266 | 0.3339 | supported, supported, supported |
| persona-ttc/10000/dense/50 | 3 | 0.2496 | 0.2504 | 0.2508 | supported, supported, supported |
| persona-volume/10000/dense/50 | 3 | 2.9687 | 2.9914 | 3.0324 | supported, supported, supported |
| experiment/10000/dense/50 | 3 | 0.3207 | 0.3232 | 0.3246 | supported, supported, supported |
| hook-ttc/10000/dense/50 | 3 | 0.2500 | 0.2500 | 0.2500 | supported, supported, supported |
| retention/10000/dense/50 | 3 | 0.2968 | 0.3027 | 0.3107 | supported, supported, supported |
| persona-conversion/10000/sparse/50 | 3 | 0.3241 | 0.3359 | 0.3473 | supported, supported, supported |
| persona-ttc/10000/sparse/50 | 3 | 0.2490 | 0.2494 | 0.2499 | supported, supported, supported |
| persona-volume/10000/sparse/50 | 3 | 2.9466 | 2.9524 | 2.9554 | supported, supported, supported |
| experiment/10000/sparse/50 | 3 | 0.3001 | 0.3153 | 0.3245 | supported, supported, supported |
| hook-ttc/10000/sparse/50 | 3 | 0.2500 | 0.2500 | 0.2500 | supported, supported, supported |
| retention/10000/sparse/50 | 3 | 0.1402 | 0.1430 | 0.1482 | supported, supported, supported |
| persona-conversion/100/dense/50 | 3 | 0.2304 | 0.2896 | 0.3750 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| persona-ttc/100/dense/50 | 3 | 0.2292 | 0.2453 | 0.2537 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| persona-volume/100/dense/50 | 3 | 2.3020 | 2.7753 | 3.0762 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| experiment/100/dense/50 | 3 | 0.3237 | 0.3420 | 0.3596 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| hook-ttc/100/dense/50 | 3 | 0.2500 | 0.2500 | 0.2500 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| retention/100/dense/50 | 3 | 0.1474 | 0.2263 | 0.3176 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| persona-conversion/100/sparse/50 | 3 | 0.2252 | 0.3329 | 0.4000 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| persona-ttc/100/sparse/50 | 3 | 0.2523 | 0.2567 | 0.2641 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| persona-volume/100/sparse/50 | 3 | 2.3859 | 3.0094 | 3.5022 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| experiment/100/sparse/50 | 3 | 0.1514 | 0.2299 | 0.2987 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| hook-ttc/100/sparse/50 | 3 | 0.2488 | 0.2496 | 0.2500 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| retention/100/sparse/50 | 3 | 0.1382 | 0.1661 | 0.1853 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| persona-conversion/3000/dense/50 | 3 | 0.3222 | 0.3271 | 0.3319 | supported, supported, supported |
| persona-ttc/3000/dense/50 | 3 | 0.2489 | 0.2506 | 0.2527 | supported, supported, supported |
| persona-volume/3000/dense/50 | 3 | 2.9046 | 2.9763 | 3.0531 | supported, supported, supported |
| experiment/3000/dense/50 | 3 | 0.3199 | 0.3251 | 0.3297 | supported, supported, supported |
| retention/3000/dense/50 | 3 | 0.2966 | 0.3093 | 0.3295 | supported, supported, supported |
| persona-conversion/3000/sparse/50 | 3 | 0.3043 | 0.3239 | 0.3347 | supported, supported, supported |
| persona-ttc/3000/sparse/50 | 3 | 0.2482 | 0.2484 | 0.2488 | supported, supported, supported |
| persona-volume/3000/sparse/50 | 3 | 2.9853 | 3.0538 | 3.0946 | supported, supported, supported |
| experiment/3000/sparse/50 | 3 | 0.3128 | 0.3214 | 0.3297 | supported, supported, supported |
| retention/3000/sparse/50 | 3 | 0.1391 | 0.1425 | 0.1465 | supported, supported, supported |
| persona-conversion/300/dense/50 | 3 | 0.3178 | 0.3349 | 0.3505 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| persona-ttc/300/dense/50 | 3 | 0.2454 | 0.2484 | 0.2517 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| persona-volume/300/dense/50 | 3 | 2.5293 | 2.8477 | 3.1767 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| experiment/300/dense/50 | 3 | 0.1865 | 0.2898 | 0.3672 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| hook-ttc/300/dense/50 | 3 | 0.2500 | 0.2500 | 0.2500 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| retention/300/dense/50 | 3 | 0.2008 | 0.2735 | 0.3141 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| persona-conversion/1000/sparse/5 | 3 | 0.3236 | 0.3337 | 0.3400 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| persona-ttc/1000/sparse/5 | 3 | 0.2424 | 0.2484 | 0.2566 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| persona-volume/1000/sparse/5 | 3 | 2.4694 | 2.8642 | 3.0945 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| experiment/1000/sparse/5 | 3 | 0.3392 | 0.3586 | 0.3944 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| hook-ttc/1000/sparse/5 | 3 | 0.2493 | 0.2496 | 0.2500 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| retention/1000/sparse/5 | 3 | 0.1301 | 0.1512 | 0.1693 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| persona-conversion/1000/dense/5 | 3 | 0.2575 | 0.3474 | 0.4055 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| persona-ttc/1000/dense/5 | 3 | 0.2413 | 0.2508 | 0.2604 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| persona-volume/1000/dense/5 | 3 | 2.5234 | 2.6378 | 2.7276 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| experiment/1000/dense/5 | 3 | 0.2842 | 0.3378 | 0.3811 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| hook-ttc/1000/dense/5 | 3 | 0.2500 | 0.2500 | 0.2500 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| retention/1000/dense/5 | 3 | 0.2615 | 0.3015 | 0.3280 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| persona-conversion/1000/sparse/95 | 3 | 0.2220 | 0.3297 | 0.4148 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| persona-ttc/1000/sparse/95 | 3 | 0.2434 | 0.2497 | 0.2542 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| persona-volume/1000/sparse/95 | 3 | 2.6959 | 2.9441 | 3.1295 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| experiment/1000/sparse/95 | 3 | 0.2518 | 0.3063 | 0.3880 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| hook-ttc/1000/sparse/95 | 3 | 0.2500 | 0.2500 | 0.2500 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| retention/1000/sparse/95 | 3 | 0.1301 | 0.1512 | 0.1693 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| persona-conversion/1000/dense/95 | 3 | 0.2744 | 0.3063 | 0.3385 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| persona-ttc/1000/dense/95 | 3 | 0.2369 | 0.2426 | 0.2458 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| persona-volume/1000/dense/95 | 3 | 2.7497 | 3.0718 | 3.4594 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| experiment/1000/dense/95 | 3 | 0.3933 | 0.4372 | 0.5179 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| hook-ttc/1000/dense/95 | 3 | 0.2500 | 0.2500 | 0.2500 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
| retention/1000/dense/95 | 3 | 0.2615 | 0.3015 | 0.3280 | insufficient-evidence, insufficient-evidence, insufficient-evidence |
