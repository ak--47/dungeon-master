# Forgebench (devtools) — 20-question eval

- **Data:** `data/verify-devtools` (full fidelity: 10,000 developers, 9,994 with events, 4,506 new signups, 500 organizations, 979,405 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query in `dungeons/vertical/devtools/devtools.sql` on that data.
- **Stories:** ids refer to the `stories` export in `devtools.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Does Forge Assist speed up merges?
- **Prompt:** "We launched Forge Assist at the end of July. Is it actually getting pull requests merged faster? By how much?"
- **Type:** trend
- **Answer:** Yes, after review. Since the 2026-07-29 launch, Pro/Team/Enterprise pull requests reviewed by Forge Assist (`review_mode = forge_assist`) went from review to merge in a **median 3.59 hours vs 6.09 hours** for standard pull requests on the same plans, about **0.59x** (average 5.73 vs 10.08 hours). Blended over all eligible pull requests, the median review → merge time fell from 6.05 hours before launch to 5.17 after (−15%), while Free pull requests (no access) stayed flat (6.05 → 6.01). Accept 0.54x-0.66x.
- **Evidence:** H1-forge-assist-launch; Funnels, `review submitted` → `pull request merged`, hold `pr_id` constant, median time to convert, breakdown `review_mode`, filter `plan_tier` in (pro, team, enterprise), from 2026-07-29; `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (launch date, plan scope), 03-event-dictionary.md (`review_mode`, `pr_id`).
- **Grading:** must compare assisted to standard pull requests on eligible plans (or use Free as a control for a before/after). Wrong: measuring open → review wait (it does not change; see Q6 and story notes); comparing all pull requests before vs after launch across every plan without noting the dilution.

### Q2 — Forge Assist adoption
- **Prompt:** "How many pull requests go through Forge Assist now? Is usage still growing?"
- **Type:** segmentation
- **Answer:** Adoption **ramped for about four weeks and then leveled off at about 39-40%** of eligible pull requests. Weekly share of Pro/Team/Enterprise pull requests opened with `review_mode = forge_assist` (Monday weeks): 1.8% (week of Jul 27; launch on Wednesday Jul 29), 10.9% (Aug 3), 20.6% (Aug 10), 30.1% (Aug 17), 40.1% (Aug 24), then 38.6%-40.2% every week through September (38.6% in the last partial week). From Aug 26 on, 39.4% of eligible pull requests use it. 2,381 of 5,042 eligible authors (47%) have used it. It is no longer growing. Accept a ramp through late August and a plateau of 36%-44%.
- **Evidence:** H1-forge-assist-launch; Insights, `pull request opened`, filter `plan_tier` in (pro, team, enterprise), breakdown `review_mode`, weekly, % of total; `-- EVAL Q2`.
- **Context needed:** 02-timeline.md (launch, opt-in per developer), 04-metrics-and-tables.md (adoption definition).
- **Grading:** denominator is eligible pull requests, and the answer must describe the shape (ramp, then plateau). Wrong: share of all pull requests including Free (much lower); "still growing"; quoting only an all-period average.

### Q3 — Are Forge Assist pull requests safer to ship? (null)
- **Prompt:** "Do pull requests reviewed by Forge Assist get rolled back less often in production?"
- **Type:** null-hypothesis
- **Answer:** **No.** Of eligible pull requests opened since launch that reached production, **12.35% of Forge Assist deploys rolled back vs 12.78%** of standard ones (789 of 6,387 vs 1,817 of 14,221; z ≈ −0.9, p ≈ 0.4). By plan: Enterprise 12.45% vs 12.53%, Pro 11.96% vs 12.69%, Team 12.39% vs 12.93% (no plan reaches p < 0.2). Forge Assist shortens the review-to-merge step; it does not change the change failure rate. Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q3`; Insights, `production deployed`, share `deploy_outcome = rolled_back`, breakdown `review_mode`, filter plan and date.
- **Context needed:** 03-event-dictionary.md (`deploy_outcome`, `review_mode`), 04-metrics-and-tables.md (change failure rate).
- **Grading:** must check rollbacks directly and treat the gap as noise. Wrong: "yes, AI review makes deploys safer"; citing merge speed as evidence of quality.

### Q4 — Should we ship the Remote Build Cache?
- **Prompt:** "What did the Remote Build Cache test show? Should we turn it on for everyone?"
- **Type:** segmentation
- **Answer:** Yes. Since 2026-07-08, passed builds in the **Remote Cache arm take a median 235 seconds vs 392 seconds in Control (0.60x**; average 275 vs 458 seconds). Pass/fail is unchanged: 85.2% vs 85.3% of builds succeed. Developers in both arms run about the same number of builds (14.4 vs 14.5 per developer), so the gain is per build. The split is even (3,646 Remote Cache vs 3,673 Control developers exposed). Accept 0.54x-0.66x for build time and "no meaningful change" in success.
- **Evidence:** H2-remote-build-cache-experiment; Insights, `build finished`, median `build_duration_sec`, filter `build_status = success`, from 2026-07-08, breakdown `Experiment: Remote Build Cache`; `-- EVAL Q4`.
- **Context needed:** 02-timeline.md (test start and arms), 03-event-dictionary.md (`build_duration_sec`, exposure event).
- **Grading:** must compare arms within the test window on passed builds (or note that failed builds stop early). Wrong: before/after July 8 for everyone; comparing all builds including failed ones without comment; claiming the cache makes builds pass more often.

### Q5 — Where do new signups stall?
- **Prompt:** "Too many signups never finish setup. Is it everyone, or is a particular group struggling?"
- **Type:** funnel
- **Answer:** **Java and .NET developers.** 7-day setup completion (account created → repository imported → pipeline configured → preview deployed) is **33.4% for Java/.NET** (1,260 signups; Java 34.2%, .NET 32.1%) vs **60.2% for every other stack** (3,246 signups; Node 60.1%, Python 60.2%, Go 60.4%, Ruby 61.8%, Rust 58.9%), about **0.55x**. Java/.NET signups lose ground at every step: 77.1% import a repository (vs 86.2%), 54.9% configure a pipeline (vs 72.6%), 33.4% reach a preview. Java/.NET is 28% of signups; overall completion is 52.7%. Accept a ratio of 0.50-0.62 and naming Java and .NET.
- **Evidence:** H3-jvm-dotnet-onboarding-friction; Funnels, four setup steps, 7-day window, breakdown `primary_stack`; `-- EVAL Q5`.
- **Context needed:** 03-event-dictionary.md (setup events), 04-metrics-and-tables.md (onboarding completion), 01-business.md (DX goal).
- **Grading:** must break down by stack and give the gap. Wrong: blaming signup method or acquisition channel only (paid social is a second, separate gap: see Q12); reporting only the overall rate.

### Q6 — Do bigger organizations wait longer for reviews? (null)
- **Prompt:** "Enterprise teams have more process. Do their pull requests wait longer for a first review than startups'?"
- **Type:** null-hypothesis
- **Answer:** **No.** Median open → first review wait is **4.31 hours at enterprise organizations, 4.33 mid-market, 4.27 SMB, and 4.29 startups**; averages are 9.43, 9.25, 9.30, and 9.44 hours (on log wait time, enterprise vs startup z ≈ 0.7; no pairwise gap reaches p < 0.1). Pull request size is the same across sizes (median 116-121 lines). Organization size does not matter; pull request size does (Q7). Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q6`; Funnels, `pull request opened` → `review submitted`, hold `pr_id`, median time to convert, breakdown user property `org_size`.
- **Context needed:** 01-business.md (organization sizes), 04-metrics-and-tables.md (review wait).
- **Grading:** must check the data and report no difference. Wrong: "enterprise is slower" from intuition.

### Q7 — Which pull requests wait longest for review?
- **Prompt:** "What makes a pull request sit waiting for review?"
- **Type:** funnel
- **Answer:** **Size.** Median open → first review wait by lines changed: **≤100 lines 3.25 h**, 101-399 lines 4.58 h, 400-999 lines 6.93 h, **1,000+ lines 8.15 h**, about **2.5x** for the largest vs the smallest. The wait rises steadily with size (no single cliff). 1,000+ line pull requests are 6.4% of pull requests; ≤100 lines are 45%. Accept 2.25x-2.75x for 1,000+ vs ≤100 and a rising pattern.
- **Evidence:** H4-large-pr-review-wait; Funnels, `pull request opened` → `review submitted`, hold `pr_id`, median time to convert, breakdown `lines_changed` (custom buckets), or Insights average/median `review_wait_hours` by `lines_changed`; `-- EVAL Q7`.
- **Context needed:** 03-event-dictionary.md (`lines_changed`, `review_wait_hours`), 04-metrics-and-tables.md (review wait).
- **Grading:** must measure per pull request and show the size gradient. Wrong: unique-developer funnel time (pairs unrelated pull requests); naming organization size (Q6) or Forge Assist.

### Q8 — What predicts whether a new developer sticks around?
- **Prompt:** "Is there anything in a new developer's first days that predicts whether they're still using Forgebench a month later?"
- **Type:** retention
- **Answer:** **Their first CI build.** For new developers whose first build came within 14 days of signup (signups through Aug 25), day-30 retention (any activity in days 30-36) is **49.9% when the first build passed vs 26.5% when it failed (about 1.9x)**; days 7-13 activity is 88.4% vs 61.9%. The first build fails often: 39.5% of new developers' first builds fail (vs 14.6% for builds overall), and 51% of those failures are configuration errors. For scale, 30.3% of all new signups through Aug 25 are active in days 30-36. Accept 1.7x-2.1x on D30 and mention of the high first-build failure rate.
- **Evidence:** H5-first-build-red-churn; build the cohorts in **Funnels**: `account created` → `build finished`, 14-day window, breakdown `build_status` of step 2 (the first build); save `success` and `failed` as cohorts; then **Retention**, `account created` → any event, custom bracket day 30-36, breakdown by those cohorts; `-- EVAL Q8`.
- **Context needed:** 04-metrics-and-tables.md (retention definition), 03-event-dictionary.md (`build_status`, `failure_stage`), 01-business.md (activation goal).
- **Grading:** must classify by the first build (not all builds) and compare retention. Wrong: "developers with more builds retain better" (circular); using a whole-window build count.

### Q9 — What happened to builds in mid-August?
- **Prompt:** "Build failures spiked for a couple of days in August. What happened, and how many builds did customers lose?"
- **Type:** external-join
- **Answer:** The **2026-08-19 to 2026-08-20 registry mirror incident, npm only.** `build_fleet_daily` shows `registry_mirror_status = degraded` for npm on those two days with `dependency_fetch_error_rate` 0.61-0.62 (normally at most 0.01). In Mixpanel, npm builds passed at **35.5%** on those days (37.0% and 34.0%) vs 86.4% on the surrounding days (Aug 12-18 and Aug 21-27); about half of npm builds failed at `dependency_install`. Other ecosystems stayed at 84.6%. Relative to other ecosystems, npm ran at about **0.42x** its normal success rate. About **554 builds** that would have passed failed (1,089 npm builds on incident days). Accept 0.36-0.46 and 480-630 lost builds.
- **Evidence:** H6-npm-registry-incident; Insights, `build finished`, share `build_status = success`, daily, breakdown `ecosystem`; warehouse join on date and `ecosystem`; `-- EVAL Q9`.
- **Context needed:** 02-timeline.md (incident dates), 04-metrics-and-tables.md (`build_fleet_daily`), 03-event-dictionary.md (`ecosystem`, `failure_stage`).
- **Grading:** must name the incident, npm, the dates, and a size. Wrong: blaming the Remote Build Cache test or customer code; saying every ecosystem failed; using `builds_started` from the warehouse as the Mixpanel build count.

### Q10 — Did the incident hit other ecosystems?
- **Prompt:** "During the August mirror incident, were Python, Java, and other builds failing on dependency downloads too?"
- **Type:** external-join (also a null check: no mirror effect outside npm)
- **Answer:** **No.** Outside npm, the share of builds that failed at `dependency_install` was **1.47% on Aug 19-20 vs 1.53%** on the surrounding days (2,110 vs 11,753 builds; z ≈ −0.2), and every non-npm ecosystem stayed between 0.9% and 1.8%. Their mirrors show `operational` and a normal error rate in `build_fleet_daily`. Pooled non-npm success was 84.6% vs 85.7% (p ≈ 0.2). Maven passed less often on those days (81.5% vs 86.0%, 448 builds), but the extra failures were test and compile failures (15.9% vs 10.4%), not dependency downloads (1.8% vs 1.7%), so they are not the mirror incident. Only npm fell (35.5% vs 86.4%), and only the npm mirror shows `degraded`. Accept "only npm was hit by the mirror".
- **Evidence:** H6-npm-registry-incident; `-- EVAL Q10`.
- **Context needed:** 04-metrics-and-tables.md, 02-timeline.md.
- **Grading:** must check dependency failures (or the warehouse mirror status) in the other ecosystems. Wrong: "all builds were affected"; reading the Maven success dip as an incident effect without checking its failure stage.

### Q11 — What do we pay per signup on each paid channel?
- **Prompt:** "What's our cost per signup on each paid channel?"
- **Type:** external-join
- **Answer:** Spend per Mixpanel signup over the window: **paid social $55.42** (695 signups, $38,516), **paid search $83.96** (896 signups, $75,225), **newsletter $119.02** (532 signups, $63,320). Paid social is about **0.66x** paid search per signup. Total paid spend is $177,061. Spend is billed every day (paid social $115-$632 per day, never zero). Platforms claim more signups than Mixpanel records (2,567 vs 2,123, about +21%), which would understate CAC. Accept social/search 0.59-0.71 and dollar values within ±3%.
- **Evidence:** H7-paid-channel-economics; warehouse `marketing_spend_daily.spend_usd` joined to `account created` by date and `acquisition_channel`; `-- EVAL Q11`.
- **Context needed:** 04-metrics-and-tables.md (CAC definition, spend table), 01-business.md (channels).
- **Grading:** must divide by Mixpanel signups over a period. Wrong: using `platform_reported_signups`; quoting a single day.

### Q12 — Is paid social worth it?
- **Prompt:** "Marketing moved budget into paid social because signups are cheap there. Is it actually our most efficient channel?"
- **Type:** attribution
- **Answer:** **No, not once you look at onboarding.** Paid social signups finish setup at **33.5% vs 56.2%** for every other channel (paid search 58.9%, newsletter 53.0%, organic 56.6%, referral 53.4%, community 57.2%), about **0.60x**. So spend per onboarded developer is **$165.30 on paid social vs $142.47 on paid search** (and $224.54 on newsletter): paid search is the cheapest paid channel per onboarded developer even though paid social is 34% cheaper per signup. Newsletter is the most expensive on both measures. Accept an onboarding ratio of 0.54-0.70 and the conclusion that paid social's signup advantage disappears per onboarded developer.
- **Evidence:** H7-paid-channel-economics; Funnels, setup steps, 7-day window, breakdown `acquisition_channel`; warehouse spend; `-- EVAL Q12`.
- **Context needed:** 01-business.md (channels, goal 2), 04-metrics-and-tables.md (cost per onboarded developer).
- **Grading:** must combine cost and onboarding (or another downstream step). Wrong: "paid social is best" from CAC alone; ignoring onboarding.

### Q13 — Did overage billing change how Team customers use CI?
- **Prompt:** "Team overage billing started September 1. Did Team customers change how they use CI?"
- **Type:** trend
- **Answer:** Yes: **Team customers switched off about half of their scheduled (cron) builds** over the first two weeks of September, and nothing else changed. Scheduled builds per push build on Team went from **0.250 in August to 0.120 on Sep 15-30 (0.48x)**; weekly it was 0.22-0.27 through August, then 0.170 (week of Sep 7), 0.122, 0.116, 0.132 (partial week). Other plans stayed flat (0.252 → 0.243, 0.97x). Team push builds did not fall (299.8 → 337.0 per day), so developers did not build less; they cut cron jobs. Accept 0.43x-0.55x and "push builds unchanged".
- **Evidence:** H8-team-overage-billing; Insights, `build started`, breakdown `trigger` and `plan_tier`, weekly, formula schedule / push; `-- EVAL Q13`.
- **Context needed:** 02-timeline.md (billing dates), 01-business.md (Team plan), 03-event-dictionary.md (`trigger`).
- **Grading:** must look at build triggers on Team with a control or a ratio. Wrong: "no change" from total build counts (they rose with growth); "Team customers stopped building".

### Q14 — What did overage billing bring in?
- **Prompt:** "How much overage revenue did Team billing bring in for September?"
- **Type:** external-join
- **Answer:** **$4,791.19 in September** (319,407 overage minutes at $0.015), plus $144.57 on October 1, from `usage_billing_daily`. There was no overage before September 1 and none on other plans. Team billed runner minutes were 1,077,659 in August and 1,082,398 in September (34.8k vs 36.1k per day: up slightly with growth even after the cron cuts). September overage is about $4.43 per 1,000 Team runner minutes. Accept within ±1%.
- **Evidence:** H8-team-overage-billing; warehouse `usage_billing_daily`; `-- EVAL Q14`.
- **Context needed:** 04-metrics-and-tables.md (billing table and caveats), 02-timeline.md.
- **Grading:** must use the warehouse (overage is not in Mixpanel). Wrong: estimating from `build_duration_sec` × price (billing meters parallel jobs; the table is the source of truth); including October 1 in September.

### Q15 — What drives change failure rate?
- **Prompt:** "Our rollback rate is around 12%. What's driving it?"
- **Type:** segmentation
- **Answer:** **Repository test coverage.** Rollback rate of production deploys by the repository's `test_coverage_pct`: **≤30% coverage 20.0%**, 31-49% 16.4%, 50-74% 9.5%, **≥75% 4.85%**, about **4.1x** from the lowest to the highest band, falling steadily. Overall: 12.3% of 47,363 deploys. Pull request size and Forge Assist do not matter (Q3, Q19). Accept a ratio of 3.6x-4.6x for ≤30% vs ≥75% and a monotonic decline.
- **Evidence:** H9-test-coverage-rollbacks; Insights, `production deployed`, share `deploy_outcome = rolled_back`, breakdown `test_coverage_pct` (custom buckets); `-- EVAL Q15`.
- **Context needed:** 03-event-dictionary.md (`test_coverage_pct`, `deploy_outcome`), 01-business.md (reliability goal).
- **Grading:** must break down by coverage and show the gradient. Wrong: "big pull requests" (no effect); "a cliff at one threshold".

### Q16 — Who buys a paid seat?
- **Prompt:** "Is there something new developers do early that predicts they'll pay?"
- **Type:** retention
- **Answer:** **Using previews.** Of new developers who signed up on Free through Aug 20 (2,226), **23.4% of those with 3+ preview deploys in their first 14 days bought a paid seat within 42 days vs 6.5%** of those with 1-2 previews (about **3.6x**); developers who never finished setup (no preview) never bought. By preview count: 1 preview 5.5%, 2 previews 7.9%, 3 20.2%, 4 22.6%, 5+ 30.2%. The 3+ group is 32% of onboarded Free signups but 89 of 141 buyers (63%). Part of the gap is engagement (heavy users reach the upgrade page more often), so "predicts" is right and "causes the whole 3.6x" overstates it. Accept 3x-5x and a jump at 3 previews.
- **Evidence:** H10-preview-habit-converts; Funnels `account created` → `preview deployed` → `preview deployed` → `preview deployed`, 14-day window (completed = 3+, dropped after step 2 or 3 = 1-2); save cohorts; Funnels `account created` → `subscription started`, 42-day window, filter `account created` `plan_tier = free`, breakdown by cohort; `-- EVAL Q16`.
- **Context needed:** 04-metrics-and-tables.md (paid conversion definition), 01-business.md (growth goal).
- **Grading:** must define the behavior from the first 14 days only and compare purchase rates. Without the Free filter the rates drop (developers who joined a Team or Enterprise workspace cannot buy) but the ratio stays close (17.0% vs 5.1%, 3.3x); accept it if the answer says so. Wrong: counting previews over the whole window (leaks the outcome); including developers whose 42-day window is incomplete.

### Q17 — Why did activity drop on two days?
- **Prompt:** "Our daily build chart has a sharp dip on a Monday in early September and on a Friday in early July. Was something broken?"
- **Type:** context
- **Answer:** **No; US holidays.** Monday **Sep 7 (Labor Day)** had 1,131 builds started vs 1,715, 1,685, and 1,773 on the surrounding Mondays (about −34%); active developers 2,312 vs 2,540-2,699. Friday **Jul 3 (Independence Day observed)** had 911 builds vs 1,303-1,368 on the surrounding Fridays (about −32%). No incident is logged on either day; the timeline lists both as US holidays when many US-based teams are off, and the drop is partial because the base is global (teams elsewhere work as usual). Accept naming both holidays.
- **Evidence:** `-- EVAL Q17`; Insights, `build started`, daily; timeline.
- **Context needed:** 02-timeline.md, 01-business.md (global base).
- **Grading:** must connect the dips to the holidays. Wrong: "an outage" (the only incident was Aug 19-20 and hit npm builds, not volume).

### Q18 — New self-serve revenue by month
- **Prompt:** "How much new MRR did self-serve upgrades add each month this summer?"
- **Type:** context
- **Answer:** At list price (Pro $12 per developer, Team $29 per seat): **June $10,284** (79 subscriptions; the window starts June 4), **July $13,596** (102), **August $9,697** (73), **September $9,244** (85); October 1 adds $227. Team drives most of it: about 10 seats per Team subscription vs 1 for Pro (September: Team 30 subscriptions, 296 seats, $8,584; Pro 55 subscriptions, $660). Monthly new MRR moves between about $9k and $14k with no trend. Accept within ±2%.
- **Evidence:** `-- EVAL Q18`; Insights, `subscription started`, sum of `seats` by `plan`, monthly, × list price.
- **Context needed:** 01-business.md (prices), 04-metrics-and-tables.md (new MRR definition).
- **Grading:** must multiply seats by the plan's list price. Wrong: counting subscriptions without seats; adding Enterprise (not self-serve); multiplying by $29 for Pro.

### Q19 — Do big pull requests break production more? (null)
- **Prompt:** "Engineering leadership wants a cap on pull request size because big PRs break production. Does the data back that up?"
- **Type:** null-hypothesis
- **Answer:** **No.** Rollback rate is **12.2% for ≤100-line pull requests, 12.4% for 101-999 lines, and 11.8% for 1,000+ lines** (21,385 / 22,964 / 3,014 deploys; 1,000+ vs ≤100 z ≈ −0.6, p ≈ 0.5). Coverage is the same across sizes (about 53%). Big pull requests do wait longer for review (Q7), but they do not roll back more; test coverage is what predicts rollbacks (Q15). Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q19`; Insights, `production deployed`, share `deploy_outcome = rolled_back`, breakdown `lines_changed` (custom buckets).
- **Context needed:** 03-event-dictionary.md, 04-metrics-and-tables.md (change failure rate).
- **Grading:** must check the data and report no difference. Wrong: "yes, big PRs roll back more" from intuition or from review-wait data.

### Q20 — What should we worry about going into Q4?
- **Prompt:** "Looking at this data, what should we worry about going into Q4, and what's working?"
- **Type:** open-ended
- **Answer:** A strong answer names most of these, with numbers:
  1. **Java/.NET setup**: 33.4% finish setup vs 60.2% for other stacks; Java/.NET is 28% of signups (Q5). Fix import and pipeline setup for JVM and .NET.
  2. **First-build failures**: 39.5% of new developers' first builds fail (51% configuration errors), and those developers are active in days 30-36 at 26.5% vs 49.9% (Q8). Better starter pipelines and error help. Only 30% of all new signups are still active a month in.
  3. **Rollbacks in low-coverage repositories**: 20.0% rollback rate at ≤30% coverage vs 4.85% at ≥75% (Q15); coverage, not pull request size, is the lever.
  4. **Paid social quality**: cheapest per signup ($55) but only 33.5% finish setup, so it costs more per onboarded developer than paid search ($165 vs $142); newsletter is the most expensive ($225) (Q11-Q12).
  5. **Registry mirror reliability**: the Aug 19-20 npm mirror incident cut npm build success to 36% for two days, about 554 lost builds (Q9).
  6. **Team overage reaction**: Team customers cut cron builds about in half within two weeks; overage brought in about $4.8k in September (Q13-Q14). Watch Team satisfaction and churn.
  7. **Large pull requests** wait 2.5x as long for a first review (Q7).
  Positive signals: Forge Assist cuts review-to-merge time to 0.59x and settled at about 39% of eligible pull requests (Q1-Q2); Remote Build Cache cuts build time to 0.60x with no change in pass rate (ship it, Q4); Free signups with 3+ previews in their first two weeks buy at 3.6x the rate (Q16); weekly active developers grew from about 5,100 to 6,400 over the summer.
- **Evidence:** H1-H10; `-- EVAL Q20` (headline numbers).
- **Context needed:** all guides.
- **Grading:** full credit for at least four risks with supporting numbers and at least one recommended action. Partial credit for risks without numbers. Wrong: a generic list not grounded in the data.
