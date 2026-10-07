# Forgebench (devtools) — 20-question eval

- **Data:** `data/verify-devtools` (full fidelity: 10,000 developers, 9,987 with events, 4,544 new signups, 500 organizations, 969,210 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query in `dungeons/vertical/devtools/devtools.sql` on that data.
- **Stories:** ids refer to the `stories` export in `devtools.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Does Forge Assist speed up merges?
- **Prompt:** "We launched Forge Assist at the end of July. Is it actually getting pull requests merged faster? By how much?"
- **Type:** trend
- **Answer:** Yes, after review. Since the 2026-07-29 launch, Pro/Team/Enterprise pull requests reviewed by Forge Assist (`review_mode = forge_assist`) went from review to merge in a **median 3.58 hours vs 6.03 hours** for standard pull requests on the same plans, about **0.59x** (average 5.68 vs 9.80 hours). Blended over all eligible pull requests, the median review → merge time fell from 6.12 hours before launch to 5.15 after (−16%), while Free pull requests (no access) stayed flat (5.89 → 6.10). Accept 0.54x-0.66x.
- **Evidence:** H1-forge-assist-launch; Funnels, `review submitted` → `pull request merged`, hold `pr_id` constant, median time to convert, breakdown `review_mode`, filter `plan_tier` in (pro, team, enterprise), from 2026-07-29; `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (launch date, plan scope), 03-event-dictionary.md (`review_mode`, `pr_id`).
- **Grading:** must compare assisted to standard pull requests on eligible plans (or use Free as a control for a before/after). Wrong: measuring open → review wait (it does not change; see Q6 and story notes); comparing all pull requests before vs after launch across every plan without noting the dilution.

### Q2 — Forge Assist adoption
- **Prompt:** "How many pull requests go through Forge Assist now? Is usage still growing?"
- **Type:** trend
- **Answer:** Adoption **ramped for about four weeks and then leveled off at about 38-40%** of eligible pull requests. Weekly share of Pro/Team/Enterprise pull requests opened with `review_mode = forge_assist` (Monday weeks): 1.3% (week of Jul 27; launch on Wednesday Jul 29), 10.6% (Aug 3), 19.8% (Aug 10), 29.5% (Aug 17), 39.9% (Aug 24), then 38.1%-38.7% every week through September (38.7% in the last partial week). From Aug 26 on, 38.7% of eligible pull requests use it. 2,557 of 5,448 eligible authors (47%) have used it. It is no longer growing. Accept a ramp through late August and a plateau of 36%-44%.
- **Evidence:** H1-forge-assist-launch; Insights, `pull request opened`, filter `plan_tier` in (pro, team, enterprise), breakdown `review_mode`, weekly, % of total; `-- EVAL Q2`.
- **Context needed:** 02-timeline.md (launch, opt-in per developer), 04-metrics-and-tables.md (adoption definition).
- **Grading:** denominator is eligible pull requests, and the answer must describe the shape (ramp, then plateau). Wrong: share of all pull requests including Free (much lower); "still growing"; quoting only an all-period average.

### Q3 — Are Forge Assist pull requests safer to ship? (null)
- **Prompt:** "Do pull requests reviewed by Forge Assist get rolled back less often in production?"
- **Type:** null-hypothesis
- **Answer:** **No.** Of eligible pull requests opened since launch that reached production, **12.42% of Forge Assist deploys rolled back vs 12.43%** of standard ones (833 of 6,705 vs 1,910 of 15,371; z ≈ 0.0, p ≈ 0.99). By plan: Enterprise 12.55% vs 12.65%, Pro 13.38% vs 12.67%, Team 12.21% vs 12.24% (no plan reaches p < 0.6; the largest gap is Pro, z ≈ 0.4, on 538 assisted deploys). Forge Assist shortens the review-to-merge step; it does not change the change failure rate. Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q3`; Insights, `production deployed`, share `deploy_outcome = rolled_back`, breakdown `review_mode`, filter plan and date.
- **Context needed:** 03-event-dictionary.md (`deploy_outcome`, `review_mode`), 04-metrics-and-tables.md (change failure rate).
- **Grading:** must check rollbacks directly and treat the gap as noise. Wrong: "yes, AI review makes deploys safer"; citing merge speed as evidence of quality.

### Q4 — Should we ship the Remote Build Cache?
- **Prompt:** "What did the Remote Build Cache test show? Should we turn it on for everyone?"
- **Type:** segmentation
- **Answer:** Yes. Since 2026-07-08, passed builds in the **Remote Cache arm take a median 235 seconds vs 389 seconds in Control (0.60x**; average 275 vs 456 seconds). Pass/fail is unchanged: 85.4% vs 85.1% of builds succeed. Developers in both arms run about the same number of builds (15.0 vs 14.7 per developer), so the gain is per build. The split is even (3,610 Remote Cache vs 3,668 Control developers exposed, 49.6%; a sample-ratio check gives p ≈ 0.50). Accept 0.54x-0.66x for build time and "no meaningful change" in success.
- **Evidence:** H2-remote-build-cache-experiment; Insights, `build finished`, median `build_duration_sec`, filter `build_status = success`, from 2026-07-08, breakdown `Experiment: Remote Build Cache`; `-- EVAL Q4`.
- **Context needed:** 02-timeline.md (test start and arms), 03-event-dictionary.md (`build_duration_sec`, exposure event).
- **Grading:** must compare arms within the test window on passed builds (or note that failed builds stop early). Wrong: before/after July 8 for everyone; comparing all builds including failed ones without comment; claiming the cache makes builds pass more often.

### Q5 — Where do new signups stall?
- **Prompt:** "Too many signups never finish setup. Is it everyone, or is a particular group struggling?"
- **Type:** funnel
- **Answer:** **Java and .NET developers.** 7-day setup completion (account created → repository imported → pipeline configured → preview deployed) is **31.7% for Java/.NET** (1,279 signups; Java 30.1%, .NET 34.1%) vs **58.9% for every other stack** (3,265 signups; Node 59.9%, Python 57.5%, Go 61.4%, Ruby 59.4%, Rust 54.1%), about **0.54x**. Java/.NET signups lose ground at every step: 78.6% import a repository (vs 85.5%), 55.8% configure a pipeline (vs 72.1%), 31.7% reach a preview. Java/.NET is 28% of signups; overall completion is 51.3%. Accept a ratio of 0.48-0.60 and naming Java and .NET.
- **Evidence:** H3-jvm-dotnet-onboarding-friction; Funnels, four setup steps, 7-day window, breakdown `primary_stack`; `-- EVAL Q5`.
- **Context needed:** 03-event-dictionary.md (setup events), 04-metrics-and-tables.md (onboarding completion), 01-business.md (DX goal).
- **Grading:** must break down by stack and give the gap. Wrong: blaming signup method or acquisition channel only (paid social is a second, separate gap: see Q12); reporting only the overall rate.

### Q6 — Do bigger organizations wait longer for reviews? (null)
- **Prompt:** "Enterprise teams have more process. Do their pull requests wait longer for a first review than startups'?"
- **Type:** null-hypothesis
- **Answer:** **No.** Median open → first review wait is **4.25 hours at enterprise organizations, 4.20 mid-market, 4.25 SMB, and 4.22 startups**; averages are 8.24, 8.22, 8.22, and 8.36 hours (on log wait time, enterprise vs startup z ≈ −0.7, p ≈ 0.46; mid-market −0.8 and SMB −0.7 vs startup, p ≥ 0.41). The null holds inside each plan: enterprise vs startup z = −0.5 (Free), −0.4 (Pro), −0.8 (Team). Pull request size is the same across sizes (median 118-120 lines). Organization size does not matter; pull request size does (Q7). Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q6`; Funnels, `pull request opened` → `review submitted`, hold `pr_id`, median time to convert, breakdown user property `org_size`.
- **Context needed:** 01-business.md (organization sizes), 04-metrics-and-tables.md (review wait).
- **Grading:** must check the data and report no difference. Wrong: "enterprise is slower" from intuition.

### Q7 — Which pull requests wait longest for review?
- **Prompt:** "What makes a pull request sit waiting for review?"
- **Type:** funnel
- **Answer:** **Size.** Median open → first review wait by lines changed: **≤100 lines 3.22 h**, 101-399 lines 4.53 h, 400-999 lines 6.92 h, **1,000+ lines 8.08 h**, about **2.5x** for the largest vs the smallest. The wait rises steadily with size (no single cliff). 1,000+ line pull requests are 6.6% of pull requests; ≤100 lines are 45%. `review_wait_hours` on `review submitted` gives the same medians (3.2, 5.1, and 8.1 h for ≤100, 101-999, and 1,000+ lines; it is the open → review gap rounded to 0.1 h). Accept 2.25x-2.75x for 1,000+ vs ≤100 and a rising pattern.
- **Evidence:** H4-large-pr-review-wait; Funnels, `pull request opened` → `review submitted`, hold `pr_id`, median time to convert, breakdown `lines_changed` (custom buckets), or Insights average/median `review_wait_hours` by `lines_changed`; `-- EVAL Q7`.
- **Context needed:** 03-event-dictionary.md (`lines_changed`, `review_wait_hours`), 04-metrics-and-tables.md (review wait).
- **Grading:** must measure per pull request and show the size gradient. Wrong: unique-developer funnel time (pairs unrelated pull requests); naming organization size (Q6) or Forge Assist.

### Q8 — What predicts whether a new developer sticks around?
- **Prompt:** "Is there anything in a new developer's first days that predicts whether they're still using Forgebench a month later?"
- **Type:** retention
- **Answer:** **Their first CI build.** For new developers whose first build came within 14 days of signup (signups through Aug 25), day-30 retention (any activity in days 30-36) is **51.1% when the first build passed vs 26.1% when it failed (about 1.96x)**; days 7-13 activity is 77.1% vs 50.4% (926 and 591 developers). The first build fails often: 38.8% of new developers' first builds fail (vs 14.7% for builds overall), and 55% of those failures are configuration errors. For scale, of all new signups through Aug 25 (3,154), 65.0% are active on day 1, 40.6% in days 7-13, and 25.6% in days 30-36; developers who never configured a pipeline run no builds and are outside this comparison. Accept 1.75x-2.25x on D30 and mention of the high first-build failure rate.
- **Evidence:** H5-first-build-red-churn; build the cohorts in **Funnels**: `account created` → `build finished`, 14-day window, breakdown `build_status` of step 2 (the first build); save `success` and `failed` as cohorts; then **Retention**, `account created` → any event, custom bracket day 30-36, breakdown by those cohorts; `-- EVAL Q8`.
- **Context needed:** 04-metrics-and-tables.md (retention definition), 03-event-dictionary.md (`build_status`, `failure_stage`), 01-business.md (activation goal).
- **Grading:** must classify by the first build (not all builds) and compare retention. Wrong: "developers with more builds retain better" (circular); using a whole-window build count.

### Q9 — What happened to builds in mid-August?
- **Prompt:** "Build failures spiked for a couple of days in August. What happened, and how many builds did customers lose?"
- **Type:** external-join
- **Answer:** The **2026-08-19 to 2026-08-20 registry mirror incident, npm only.** `build_fleet_daily` shows `registry_mirror_status = degraded` for npm on those two days with `dependency_fetch_error_rate` 0.61-0.62 (normally at most 0.01). In Mixpanel, npm builds passed at **34.7%** on those days (35.1% and 34.3%) vs 85.7% on the surrounding days (Aug 12-18 and Aug 21-27); 54% of npm builds failed at `dependency_install`. Other ecosystems stayed at 84.8% (vs 85.7%). Relative to other ecosystems, npm ran at about **0.41x** its normal success rate. About **538 builds** that would have passed failed (1,055 npm builds on incident days). npm preview deploys were hit too: 0.31 previews per push from Node developers on those days vs 0.71 on the surrounding days (other stacks 0.71 vs 0.72). Accept 0.35-0.47 and 470-610 lost builds.
- **Evidence:** H6-npm-registry-incident; Insights, `build finished`, share `build_status = success`, daily, breakdown `ecosystem`; warehouse join on date and `ecosystem`; `-- EVAL Q9`.
- **Context needed:** 02-timeline.md (incident dates), 04-metrics-and-tables.md (`build_fleet_daily`), 03-event-dictionary.md (`ecosystem`, `failure_stage`).
- **Grading:** must name the incident, npm, the dates, and a size. Wrong: blaming the Remote Build Cache test or customer code; saying every ecosystem failed; using `builds_started` from the warehouse as the Mixpanel build count.

### Q10 — Did the incident hit other ecosystems?
- **Prompt:** "During the August mirror incident, were Python, Java, and other builds failing on dependency downloads too?"
- **Type:** external-join
- **Answer:** **No; only the npm mirror failed.** In `build_fleet_daily`, every other ecosystem shows `registry_mirror_status = operational` on Aug 19-20 with a normal `dependency_fetch_error_rate` (at most 0.0098, vs 0.61-0.62 for npm). In Mixpanel, the share of non-npm builds that failed at `dependency_install` was **1.42% on Aug 19-20 (30 of 2,116 builds) vs 1.45% on every other day of the window** (z ≈ −0.1, p ≈ 0.9) and 1.38% on the surrounding days (Aug 12-18 and 21-27). Pooled non-npm success was 84.8% vs 85.7%. By ecosystem the incident-day dependency failures are a handful of builds each (PyPI 8 of 588, Maven 9 of 504, NuGet 4 of 367, Go 1 of 274, Cargo 4 of 230, RubyGems 4 of 153), and none is above its own window rate by more than z ≈ 1.2 (p ≥ 0.2). One small ecosystem does show a lower success rate: RubyGems passed 79.1% of 153 builds on Aug 19-20 vs 86.8% on the surrounding days (z ≈ −2.8, p ≈ 0.005), but the extra failures are test and compile failures (16.3% vs 10.6%), not dependency installs (4 builds), and its mirror was operational. Only npm fell (34.7% vs 85.7%, 54% of its builds failing at `dependency_install`). Accept "only npm was hit by the mirror".
- **Evidence:** H6-npm-registry-incident; warehouse `build_fleet_daily` by `ecosystem` for Aug 19-20; Insights, `build finished`, filter `failure_stage = dependency_install` share, breakdown `ecosystem`, daily; `-- EVAL Q10`.
- **Context needed:** 04-metrics-and-tables.md, 02-timeline.md.
- **Grading:** must check the mirror status (warehouse) or dependency failures in the other ecosystems. Small ecosystems have only a few hundred builds in two days, so a few extra dependency failures (Maven 9 of 504, RubyGems 4 of 153) are normal day-to-day variation. An answer that breaks success rate down by ecosystem will see the RubyGems dip; accept it when the answer reads it as small-sample test/compile noise with an operational mirror (or says it is unexplained but not a dependency problem). Wrong: "all builds were affected"; reading a small ecosystem's few extra failures, or the RubyGems test/compile dip, as a second mirror outage.

### Q11 — What do we pay per signup on each paid channel?
- **Prompt:** "What's our cost per signup on each paid channel?"
- **Type:** external-join
- **Answer:** Spend per Mixpanel signup over the window: **paid social $53.51** (744 signups, $39,808), **paid search $83.05** (933 signups, $77,486), **newsletter $119.84** (543 signups, $65,072). Paid social is about **0.64x** paid search per signup. Total paid spend is $182,366. Spend is billed every day (paid social $49-$656 per day, never zero) and moves with each channel's weekly budget. Platforms claim more signups than Mixpanel records (2,637 vs 2,220, about +19%), which would understate CAC. Accept social/search 0.59-0.72 and dollar values within ±3%.
- **Evidence:** H7-paid-channel-economics; warehouse `marketing_spend_daily.spend_usd` joined to `account created` by date and `acquisition_channel`; `-- EVAL Q11`.
- **Context needed:** 04-metrics-and-tables.md (CAC definition, spend table), 01-business.md (channels).
- **Grading:** must divide by Mixpanel signups over a period. Wrong: using `platform_reported_signups`; quoting a single day.

### Q12 — Is paid social worth it?
- **Prompt:** "Marketing moved budget into paid social because signups are cheap there. Is it actually our most efficient channel?"
- **Type:** attribution
- **Answer:** **No, not once you look at onboarding.** Paid social signups finish setup at **32.4% vs 55.0%** for every other channel (paid search 53.4%, newsletter 50.6%, organic 57.7%, referral 53.3%, community 58.1%), about **0.59x**. So spend per onboarded developer is **$165.18 on paid social vs $155.59 on paid search** (and $236.62 on newsletter): paid social is 36% cheaper per signup, but per onboarded developer it is no cheaper than paid search (about 6% more expensive; a gap this small on 241 onboarded developers is not a clear reversal). Newsletter is the most expensive on both measures. Accept an onboarding ratio of 0.53-0.66 and the conclusion that paid social's signup advantage disappears per onboarded developer.
- **Evidence:** H7-paid-channel-economics; Funnels, setup steps, 7-day window, breakdown `acquisition_channel`; warehouse spend; `-- EVAL Q12`.
- **Context needed:** 01-business.md (channels, goal 2), 04-metrics-and-tables.md (cost per onboarded developer).
- **Grading:** must combine cost and onboarding (or another downstream step). Wrong: "paid social is best" from CAC alone; ignoring onboarding.

### Q13 — Did overage billing change how Team customers use CI?
- **Prompt:** "Team overage billing started September 1. Did Team customers change how they use CI?"
- **Type:** trend
- **Answer:** Yes: **Team customers switched off about half of their scheduled (cron) builds** over the first two weeks of September, and nothing else changed. Comparing whole Monday weeks (scheduled builds run every day, push builds follow the working week), scheduled builds per push build on Team went from **0.252 on Aug 3-30 to 0.123 on Sep 14-27 (0.49x)**; weekly it was 0.25-0.26 through August, then 0.245 (week of Aug 31), 0.191 (Sep 7), 0.123, 0.123, 0.122 (partial week). Other plans stayed close to flat (0.265 → 0.246, 0.93x; their weekly ratio moves between 0.23 and 0.29 all summer), so against the other plans Team fell to about **0.53x**. By plan: Enterprise 0.99x, Free 0.87x, Pro 0.79x; Pro and Free run on small counts (Pro 335 → 156 scheduled builds) and their four-week ratios moved as much before billing (Pro 0.24 in June, 0.29 in August). Team push builds did not fall (334 → 343 per day), so developers did not build less; they cut cron jobs. Accept 0.43x-0.58x (raw or against other plans) and "push builds unchanged".
- **Evidence:** H8-team-overage-billing; Insights, `build started`, breakdown `trigger` and `plan_tier`, weekly, formula schedule / push; `-- EVAL Q13`.
- **Context needed:** 02-timeline.md (billing dates), 01-business.md (Team plan), 03-event-dictionary.md (`trigger`).
- **Grading:** must look at build triggers on Team with a control or a ratio. Accept answers that compare calendar months (August vs Sep 15-30 gives about 0.48x for Team and 0.92x for other plans, because the partial-month windows hold different weekday mixes); credit an answer that compares whole weeks or uses other plans as a control. Wrong: "no change" from total build counts (they rose with growth); "Team customers stopped building"; "Pro customers cut cron builds too" (Pro is not metered and its ratio moves this much on its own).

### Q14 — What did overage billing bring in?
- **Prompt:** "How much overage revenue did Team billing bring in for September?"
- **Type:** external-join
- **Answer:** **$4,679.31 in September** (311,953 overage minutes at $0.015), from `usage_billing_daily`. There was no overage before September 1, none on other plans, and none on October 1 (allowances reset on the 1st). Within September it builds up as organizations use up their monthly allowances: nothing on Sep 1-4, $11.18 on Sep 5-6, then $415 (week of Sep 7), $1,023, $1,791, and $1,439 for Sep 28-30 ($352, $594, and $493 a day). Team billed runner minutes were 1,171,936 in August and 1,141,399 in September (flat even with growth, after the cron cuts). September overage is about $4.10 per 1,000 Team runner minutes. Accept within ±1%.
- **Evidence:** H8-team-overage-billing; warehouse `usage_billing_daily`; `-- EVAL Q14`.
- **Context needed:** 04-metrics-and-tables.md (billing table and caveats), 02-timeline.md.
- **Grading:** must use the warehouse (overage is not in Mixpanel) and keep September to Sep 1-30. Credit answers that note the month-start reset and the climb through the month. Wrong: estimating from `build_duration_sec` × price (billing meters parallel jobs; the table is the source of truth); reading the low first week as customers avoiding overage (allowances were not used up yet).

### Q15 — What drives change failure rate?
- **Prompt:** "Our rollback rate is around 12%. What's driving it?"
- **Type:** segmentation
- **Answer:** **Repository test coverage.** Rollback rate of production deploys by the repository's `test_coverage_pct`: **≤30% coverage 19.7%**, 31-49% 16.6%, 50-74% 9.2%, **≥75% 4.75%**, about **4.1x** from the lowest to the highest band, falling steadily. Overall: 12.27% of 47,618 deploys. Pull request size and Forge Assist do not matter (Q3, Q19). Accept a ratio of 3.6x-4.6x for ≤30% vs ≥75% and a monotonic decline.
- **Evidence:** H9-test-coverage-rollbacks; Insights, `production deployed`, share `deploy_outcome = rolled_back`, breakdown `test_coverage_pct` (custom buckets); `-- EVAL Q15`.
- **Context needed:** 03-event-dictionary.md (`test_coverage_pct`, `deploy_outcome`), 01-business.md (reliability goal).
- **Grading:** must break down by coverage and show the gradient. Wrong: "big pull requests" (no effect); "a cliff at one threshold".

### Q16 — Who buys a paid seat?
- **Prompt:** "Is there something new developers do early that predicts they'll pay?"
- **Type:** funnel
- **Answer:** **Using previews.** Of new developers who signed up on Free through Aug 20 (2,134), **28.9% of those with 3+ preview deploys in their first 14 days bought a paid seat within 42 days vs 5.7%** of those with 1-2 previews (about **5.1x**); developers with no preview in their first 14 days (they never finished setup) rarely bought (2.4%). By preview count: 1 preview 4.2%, 2 previews 7.8%, 3 24.0%, 4 29.1%, 5+ 39.5%. The 3+ group is 31% of Free signups with a preview but 100 of 168 buyers (60%). Part of the gap is engagement: 60.4% of the 3+ group reached the upgrade page within 42 days vs 31.7% of the 1-2 group. Per upgrade-page visit in those 42 days the 3+ group still buys at 2.4x the rate (30.8% vs 12.8% of visits), so the habit matters beyond reach, and "causes the whole 5x" overstates it. Accept 4.3x-6x for the paid rate and a clear step up from 1-2 to 3+ previews.
- **Evidence:** H10-preview-habit-converts; Funnels `account created` → `preview deployed` → `preview deployed` → `preview deployed`, 14-day window (completed = 3+, dropped after step 2 or 3 = 1-2); save cohorts; Funnels `account created` → `subscription started`, 42-day window, filter `account created` `plan_tier = free`, breakdown by cohort; `-- EVAL Q16`.
- **Context needed:** 04-metrics-and-tables.md (paid conversion definition), 01-business.md (growth goal).
- **Grading:** must define the behavior from the first 14 days only and compare purchase rates. Without the Free filter the rates drop (developers who joined a Team or Enterprise workspace cannot buy) but the ratio stays close (20.9% vs 4.1%, 5.1x); accept it if the answer says so. Credit an answer that separates reach (upgrade-page visits) from conversion per visit. Wrong: counting previews over the whole window (leaks the outcome); including developers whose 42-day window is incomplete.

### Q17 — Why did activity drop on two days?
- **Prompt:** "Our daily build chart has a sharp dip on a Monday in early September and on a Friday in early July. Was something broken?"
- **Type:** context
- **Answer:** **No; US holidays.** Monday **Sep 7 (Labor Day)** had 1,219 builds started vs 1,738, 1,734, and 1,702 on the surrounding Mondays (about −29%); active developers 2,360 vs 2,629-2,699. Friday **Jul 3 (Independence Day observed)** had 949 builds vs 1,383-1,440 on the surrounding Fridays (about −33%). The dip is all US developers: their hands-on work (pushes, pull requests opened, non-scheduled builds) fell 59% on Jul 3 and 52% on Sep 7 against the same weekday a week either side, while developers outside the US worked as usual (−1.9% and −0.8%). About 60% of developers are in the US, and scheduled builds run every day, so the total dip is partial. No incident is logged on either day. Accept naming both holidays; full credit needs the size of the dip (about 30% of builds, about 55% of US hands-on work) and a check that it is not an outage.
- **Evidence:** `-- EVAL Q17`; Insights, `build started`, daily; breakdown `country_code` (US vs the rest); timeline.
- **Context needed:** 02-timeline.md, 01-business.md (where developers are).
- **Grading:** must connect the dips to the holidays. Wrong: "an outage" (the only incident was Aug 19-20 and hit npm builds, not volume); "everyone took the day off" (non-US activity did not change). Extra credit for showing the dip is US-only with a `country_code` breakdown.

### Q18 — New self-serve revenue by month
- **Prompt:** "How much new MRR did self-serve upgrades add each month this summer?"
- **Type:** context
- **Answer:** At list price (Pro $12 per developer, Team $29 per seat): **June $8,339** (70 subscriptions; the window starts June 4), **July $9,980** (72), **August $8,364** (87), **September $10,315** (82); October 1 adds $348. Team drives most of it: about 10 seats per Team subscription vs 1 for Pro (August: Team 28 subscriptions, 264 seats, $7,656; Pro 59 subscriptions, $708; September: Team 32 subscriptions, 335 seats, $9,715; Pro 50, $600). New MRR is roughly flat at $8-10k a month (June is a partial month at a similar daily pace): monthly counts this small (70-90 subscriptions, about 30 of them Team with 3-20 seats each) move by ±15% on their own, so no month is a peak or a decline. Accept within ±2%.
- **Evidence:** `-- EVAL Q18`; Insights, `subscription started`, sum of `seats` by `plan`, monthly, × list price.
- **Context needed:** 01-business.md (prices), 04-metrics-and-tables.md (new MRR definition).
- **Grading:** must multiply seats by the plan's list price. Credit an answer that calls the monthly totals flat (or within normal variation) and notes June is a partial month. Wrong: counting subscriptions without seats; adding Enterprise (not self-serve); multiplying by $29 for Pro; reading a month-to-month change as a trend or blaming Team overage billing for it.

### Q19 — Do big pull requests break production more? (null)
- **Prompt:** "Engineering leadership wants a cap on pull request size because big PRs break production. Does the data back that up?"
- **Type:** null-hypothesis
- **Answer:** **No.** Rollback rate is **12.24% for ≤100-line pull requests, 12.30% for 101-999 lines, and 12.37% for 1,000+ lines** (21,388 / 23,109 / 3,121 deploys; 1,000+ vs ≤100 z ≈ 0.2, p ≈ 0.84). Coverage is the same across sizes (about 53%). Big pull requests do wait longer for review (Q7), but they do not roll back more; test coverage is what predicts rollbacks (Q15). Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q19`; Insights, `production deployed`, share `deploy_outcome = rolled_back`, breakdown `lines_changed` (custom buckets).
- **Context needed:** 03-event-dictionary.md, 04-metrics-and-tables.md (change failure rate).
- **Grading:** must check the data and report no difference. Wrong: "yes, big PRs roll back more" from intuition or from review-wait data.

### Q20 — What should we worry about going into Q4?
- **Prompt:** "Looking at this data, what should we worry about going into Q4, and what's working?"
- **Type:** open-ended
- **Answer:** A strong answer names most of these, with numbers:
  1. **Java/.NET setup**: 31.7% finish setup vs 58.9% for other stacks; Java/.NET is 28% of signups (Q5). Fix import and pipeline setup for JVM and .NET.
  2. **First-build failures**: 38.8% of new developers' first builds fail (55% configuration errors), and those developers are active in days 30-36 at 26.1% vs 51.1% (Q8). Better starter pipelines and error help. Only 26% of all new signups are still active a month in.
  3. **Rollbacks in low-coverage repositories**: 19.7% rollback rate at ≤30% coverage vs 4.75% at ≥75% (Q15); coverage, not pull request size, is the lever.
  4. **Paid social quality**: cheapest per signup ($54) but only 32.4% finish setup, so per onboarded developer it costs about the same as paid search ($165 vs $156); newsletter is the most expensive ($237) (Q11-Q12).
  5. **Registry mirror reliability**: the Aug 19-20 npm mirror incident cut npm build success to 35% for two days, about 538 lost builds, and npm previews failed too (Q9).
  6. **Team overage reaction**: Team customers cut cron builds about in half within two weeks; overage brought in about $4.7k in September and was still climbing at month end (Q13-Q14). Watch Team satisfaction and churn.
  7. **Large pull requests** wait 2.5x as long for a first review (Q7).
  8. **Self-serve revenue is not growing**: new MRR stayed at about $8-10k a month from June to September (Q18) while weekly active developers grew about 20%; conversion of Free developers is the lever (Q16).
  Positive signals: Forge Assist cuts review-to-merge time to 0.59x and settled at about 38-39% of eligible pull requests (Q1-Q2); Remote Build Cache cuts build time to 0.60x with no change in pass rate (ship it, Q4); Free signups with 3+ previews in their first two weeks buy at 5x the rate (Q16); weekly active developers grew from about 5,000 to 6,100 over the summer.
- **Evidence:** H1-H10; `-- EVAL Q20` (headline numbers).
- **Context needed:** all guides.
- **Grading:** full credit for at least four risks with supporting numbers and at least one recommended action. Partial credit for risks without numbers. Wrong: a generic list not grounded in the data.
