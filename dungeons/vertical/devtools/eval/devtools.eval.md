# Forgebench (devtools) — 20-question eval

- **Data:** `data/verify-devtools` (full fidelity: 10,000 developers, 9,987 with events, 4,544 new signups, 500 organizations, 981,965 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query in `dungeons/vertical/devtools/devtools.sql` on that data.
- **Stories:** ids refer to the `stories` export in `devtools.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Does Forge Assist speed up merges?
- **Prompt:** "We launched Forge Assist at the end of July. Is it actually getting pull requests merged faster? By how much?"
- **Type:** trend
- **Answer:** Yes, after review. Since the 2026-07-29 launch, Pro/Team/Enterprise pull requests reviewed by Forge Assist (`review_mode = forge_assist`) went from review to merge in a **median 3.58 hours vs 6.03 hours** for standard pull requests on the same plans, about **0.59x** (average 5.68 vs 9.80 hours). Blended over all eligible pull requests, the median review → merge time fell from 6.12 hours before launch to 5.15 after (−16%), while Free pull requests (no access) stayed flat (5.88 → 6.09). Accept 0.54x-0.66x.
- **Evidence:** H1-forge-assist-launch; Funnels, `review submitted` → `pull request merged`, hold `pr_id` constant, median time to convert, breakdown `review_mode`, filter `plan_tier` in (pro, team, enterprise), from 2026-07-29; `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (launch date, plan scope), 03-event-dictionary.md (`review_mode`, `pr_id`).
- **Grading:** must compare assisted to standard pull requests on eligible plans (or use Free as a control for a before/after). Wrong: measuring open → review wait (it does not change; see Q6 and story notes); comparing all pull requests before vs after launch across every plan without noting the dilution.

### Q2 — Forge Assist adoption
- **Prompt:** "How many pull requests go through Forge Assist now? Is usage still growing?"
- **Type:** trend
- **Answer:** Adoption **ramped for about four weeks and then leveled off at about 38-40%** of eligible pull requests. Weekly share of Pro/Team/Enterprise pull requests opened with `review_mode = forge_assist` (Monday weeks): 1.3% (week of Jul 27; launch on Wednesday Jul 29), 10.6% (Aug 3), 19.8% (Aug 10), 29.4% (Aug 17), 39.9% (Aug 24), then 38.1%-38.7% every week through September (38.5% in the last partial week). From Aug 26 on, 38.7% of eligible pull requests use it. 2,592 of 5,554 eligible authors (47%) have used it. It is no longer growing. Accept a ramp through late August and a plateau of 36%-44%.
- **Evidence:** H1-forge-assist-launch; Insights, `pull request opened`, filter `plan_tier` in (pro, team, enterprise), breakdown `review_mode`, weekly, % of total; `-- EVAL Q2`.
- **Context needed:** 02-timeline.md (launch, opt-in per developer), 04-metrics-and-tables.md (adoption definition).
- **Grading:** denominator is eligible pull requests, and the answer must describe the shape (ramp, then plateau). Wrong: share of all pull requests including Free (much lower); "still growing"; quoting only an all-period average.

### Q3 — Are Forge Assist pull requests safer to ship? (null)
- **Prompt:** "Do pull requests reviewed by Forge Assist get rolled back less often in production?"
- **Type:** null-hypothesis
- **Answer:** **No.** Of eligible pull requests opened since launch that reached production, **11.95% of Forge Assist deploys rolled back vs 12.53%** of standard ones (806 of 6,747 vs 1,942 of 15,495; z ≈ −1.2, p ≈ 0.22). By plan: Enterprise 12.14% vs 12.63%, Pro 12.32% vs 12.83%, Team 11.78% vs 12.42% (no plan reaches p < 0.3; the largest gap is Team, z ≈ −1.0). Forge Assist shortens the review-to-merge step; it does not change the change failure rate. Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q3`; Insights, `production deployed`, share `deploy_outcome = rolled_back`, breakdown `review_mode`, filter plan and date.
- **Context needed:** 03-event-dictionary.md (`deploy_outcome`, `review_mode`), 04-metrics-and-tables.md (change failure rate).
- **Grading:** must check rollbacks directly and treat the gap as noise. Wrong: "yes, AI review makes deploys safer"; citing merge speed as evidence of quality.

### Q4 — Should we ship the Remote Build Cache?
- **Prompt:** "What did the Remote Build Cache test show? Should we turn it on for everyone?"
- **Type:** segmentation
- **Answer:** Yes. Since 2026-07-08, passed builds in the **Remote Cache arm take a median 235 seconds vs 389 seconds in Control (0.60x**; average 275 vs 456 seconds). Pass/fail is unchanged: 85.3% vs 85.0% of builds succeed. Developers in both arms run about the same number of builds (14.4 vs 14.1 per developer), so the gain is per build. The split is even (3,819 Remote Cache vs 3,866 Control developers exposed, 49.7%; a sample-ratio check gives p ≈ 0.59). Accept 0.54x-0.66x for build time and "no meaningful change" in success.
- **Evidence:** H2-remote-build-cache-experiment; Insights, `build finished`, median `build_duration_sec`, filter `build_status = success`, from 2026-07-08, breakdown `Experiment: Remote Build Cache`; `-- EVAL Q4`.
- **Context needed:** 02-timeline.md (test start and arms), 03-event-dictionary.md (`build_duration_sec`, exposure event).
- **Grading:** must compare arms within the test window on passed builds (or note that failed builds stop early). Wrong: before/after July 8 for everyone; comparing all builds including failed ones without comment; claiming the cache makes builds pass more often.

### Q5 — Where do new signups stall?
- **Prompt:** "Too many signups never finish setup. Is it everyone, or is a particular group struggling?"
- **Type:** funnel
- **Answer:** **Java and .NET developers.** 7-day setup completion (account created → repository imported → pipeline configured → preview deployed) is **36.2% for Java/.NET** (1,279 signups; Java 35.3%, .NET 37.6%) vs **61.0% for every other stack** (3,265 signups; Node 62.4%, Python 59.2%, Go 63.8%, Ruby 62.5%, Rust 54.5%), about **0.59x**. Java/.NET signups lose ground at every step: 78.6% import a repository (vs 85.5%), 55.8% configure a pipeline (vs 72.1%), 36.2% reach a preview. Java/.NET is 28% of signups; overall completion is 54.1%. Accept a ratio of 0.50-0.62 and naming Java and .NET.
- **Evidence:** H3-jvm-dotnet-onboarding-friction; Funnels, four setup steps, 7-day window, breakdown `primary_stack`; `-- EVAL Q5`.
- **Context needed:** 03-event-dictionary.md (setup events), 04-metrics-and-tables.md (onboarding completion), 01-business.md (DX goal).
- **Grading:** must break down by stack and give the gap. Wrong: blaming signup method or acquisition channel only (paid social is a second, separate gap: see Q12); reporting only the overall rate.

### Q6 — Do bigger organizations wait longer for reviews? (null)
- **Prompt:** "Enterprise teams have more process. Do their pull requests wait longer for a first review than startups'?"
- **Type:** null-hypothesis
- **Answer:** **No.** Median open → first review wait is **4.24 hours at enterprise organizations, 4.20 mid-market, 4.26 SMB, and 4.23 startups**; averages are 8.23, 8.21, 8.22, and 8.32 hours (on log wait time, enterprise vs startup z ≈ −0.7, p ≈ 0.5; mid-market −0.8 and SMB −0.6 vs startup, p ≥ 0.45). The null holds inside each plan: enterprise vs startup z = −0.6 (Free), −0.3 (Pro), −0.8 (Team). Pull request size is the same across sizes (median 118-120 lines). Organization size does not matter; pull request size does (Q7). Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q6`; Funnels, `pull request opened` → `review submitted`, hold `pr_id`, median time to convert, breakdown user property `org_size`.
- **Context needed:** 01-business.md (organization sizes), 04-metrics-and-tables.md (review wait).
- **Grading:** must check the data and report no difference. Wrong: "enterprise is slower" from intuition.

### Q7 — Which pull requests wait longest for review?
- **Prompt:** "What makes a pull request sit waiting for review?"
- **Type:** funnel
- **Answer:** **Size.** Median open → first review wait by lines changed: **≤100 lines 3.21 h**, 101-399 lines 4.52 h, 400-999 lines 6.92 h, **1,000+ lines 8.07 h**, about **2.5x** for the largest vs the smallest. The wait rises steadily with size (no single cliff). 1,000+ line pull requests are 6.6% of pull requests; ≤100 lines are 45%. `review_wait_hours` on `review submitted` gives the same medians (3.2, 5.1, and 8.1 h for ≤100, 101-999, and 1,000+ lines; it is the open → review gap rounded to 0.1 h). Accept 2.25x-2.75x for 1,000+ vs ≤100 and a rising pattern.
- **Evidence:** H4-large-pr-review-wait; Funnels, `pull request opened` → `review submitted`, hold `pr_id`, median time to convert, breakdown `lines_changed` (custom buckets), or Insights average/median `review_wait_hours` by `lines_changed`; `-- EVAL Q7`.
- **Context needed:** 03-event-dictionary.md (`lines_changed`, `review_wait_hours`), 04-metrics-and-tables.md (review wait).
- **Grading:** must measure per pull request and show the size gradient. Wrong: unique-developer funnel time (pairs unrelated pull requests); naming organization size (Q6) or Forge Assist.

### Q8 — What predicts whether a new developer sticks around?
- **Prompt:** "Is there anything in a new developer's first days that predicts whether they're still using Forgebench a month later?"
- **Type:** retention
- **Answer:** **Their first CI build.** For new developers whose first build came within 14 days of signup (signups through Aug 25), day-30 retention (any activity in days 30-36) is **46.1% when the first build passed vs 22.8% when it failed (about 2.03x)**; days 7-13 activity is 68.9% vs 43.8%. The first build fails often: 39.5% of new developers' first builds fail (vs 14.8% for builds overall), and 55% of those failures are configuration errors. For scale, of all new signups through Aug 25, 71.4% are active on day 1, 42.6% in days 7-13, and 27.1% in days 30-36. Accept 1.8x-2.3x on D30 and mention of the high first-build failure rate.
- **Evidence:** H5-first-build-red-churn; build the cohorts in **Funnels**: `account created` → `build finished`, 14-day window, breakdown `build_status` of step 2 (the first build); save `success` and `failed` as cohorts; then **Retention**, `account created` → any event, custom bracket day 30-36, breakdown by those cohorts; `-- EVAL Q8`.
- **Context needed:** 04-metrics-and-tables.md (retention definition), 03-event-dictionary.md (`build_status`, `failure_stage`), 01-business.md (activation goal).
- **Grading:** must classify by the first build (not all builds) and compare retention. Wrong: "developers with more builds retain better" (circular); using a whole-window build count.

### Q9 — What happened to builds in mid-August?
- **Prompt:** "Build failures spiked for a couple of days in August. What happened, and how many builds did customers lose?"
- **Type:** external-join
- **Answer:** The **2026-08-19 to 2026-08-20 registry mirror incident, npm only.** `build_fleet_daily` shows `registry_mirror_status = degraded` for npm on those two days with `dependency_fetch_error_rate` 0.61-0.62 (normally at most 0.01). In Mixpanel, npm builds passed at **37.2%** on those days (37.5% and 36.9%) vs 85.5% on the surrounding days (Aug 12-18 and Aug 21-27); about half of npm builds failed at `dependency_install`. Other ecosystems stayed at 84.7% (vs 85.5%). Relative to other ecosystems, npm ran at about **0.44x** its normal success rate. About **518 builds** that would have passed failed (1,072 npm builds on incident days). Accept 0.36-0.48 and 450-600 lost builds.
- **Evidence:** H6-npm-registry-incident; Insights, `build finished`, share `build_status = success`, daily, breakdown `ecosystem`; warehouse join on date and `ecosystem`; `-- EVAL Q9`.
- **Context needed:** 02-timeline.md (incident dates), 04-metrics-and-tables.md (`build_fleet_daily`), 03-event-dictionary.md (`ecosystem`, `failure_stage`).
- **Grading:** must name the incident, npm, the dates, and a size. Wrong: blaming the Remote Build Cache test or customer code; saying every ecosystem failed; using `builds_started` from the warehouse as the Mixpanel build count.

### Q10 — Did the incident hit other ecosystems?
- **Prompt:** "During the August mirror incident, were Python, Java, and other builds failing on dependency downloads too?"
- **Type:** external-join
- **Answer:** **No; only the npm mirror failed.** In `build_fleet_daily`, every other ecosystem shows `registry_mirror_status = operational` on Aug 19-20 with a normal `dependency_fetch_error_rate` (at most 0.0098, vs 0.61-0.62 for npm). In Mixpanel, the share of non-npm builds that failed at `dependency_install` was **1.52% on Aug 19-20 (33 of 2,173 builds) vs 1.47% on every other day of the window** (z ≈ 0.2, p ≈ 0.86) and 1.42% on the surrounding days (Aug 12-18 and 21-27). Pooled non-npm success was 84.7% vs 85.5%. By ecosystem the incident-day dependency failures are a handful of builds each (PyPI 8 of 591, Maven 10 of 526, NuGet 5 of 380, Go 2 of 282, Cargo 4 of 240, RubyGems 4 of 154), and none differs from its own window rate by more than z ≈ 1.2 (p ≥ 0.2). Only npm fell (37.2% vs 85.5%, half its builds failing at `dependency_install`). Accept "only npm was hit by the mirror".
- **Evidence:** H6-npm-registry-incident; warehouse `build_fleet_daily` by `ecosystem` for Aug 19-20; Insights, `build finished`, filter `failure_stage = dependency_install` share, breakdown `ecosystem`, daily; `-- EVAL Q10`.
- **Context needed:** 04-metrics-and-tables.md, 02-timeline.md.
- **Grading:** must check the mirror status (warehouse) or dependency failures in the other ecosystems. Small ecosystems have only a few hundred builds in two days, so a few extra dependency failures (Maven 10 of 526, RubyGems 4 of 154) are normal day-to-day variation; an answer that flags them should say they are small counts and that their mirrors were operational. Wrong: "all builds were affected"; reading a small ecosystem's few extra failures as a second mirror outage.

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
- **Answer:** **No, not once you look at onboarding.** Paid social signups finish setup at **35.4% vs 57.7%** for every other channel (paid search 56.3%, newsletter 54.3%, organic 60.3%, referral 56.3%, community 59.5%), about **0.61x**. So spend per onboarded developer is **$151.36 on paid social vs $147.59 on paid search** (and $220.58 on newsletter): paid social is 36% cheaper per signup, but per onboarded developer it is no cheaper than paid search (paid search is slightly cheaper). Newsletter is the most expensive on both measures. Accept an onboarding ratio of 0.54-0.68 and the conclusion that paid social's signup advantage disappears per onboarded developer.
- **Evidence:** H7-paid-channel-economics; Funnels, setup steps, 7-day window, breakdown `acquisition_channel`; warehouse spend; `-- EVAL Q12`.
- **Context needed:** 01-business.md (channels, goal 2), 04-metrics-and-tables.md (cost per onboarded developer).
- **Grading:** must combine cost and onboarding (or another downstream step). Wrong: "paid social is best" from CAC alone; ignoring onboarding.

### Q13 — Did overage billing change how Team customers use CI?
- **Prompt:** "Team overage billing started September 1. Did Team customers change how they use CI?"
- **Type:** trend
- **Answer:** Yes: **Team customers switched off about half of their scheduled (cron) builds** over the first two weeks of September, and nothing else changed. Scheduled builds per push build on Team went from **0.261 in August to 0.125 on Sep 15-30 (0.48x)**; weekly it was 0.25-0.26 through August, then 0.247 (week of Aug 31), 0.202 (Sep 7), 0.125, 0.124, 0.122 (partial week). Other plans stayed close to flat (0.272 → 0.250, 0.92x; their weekly ratio moves between 0.24 and 0.28 all summer). Team push builds did not fall (324.7 → 359.1 per day), so developers did not build less; they cut cron jobs. Accept 0.43x-0.55x and "push builds unchanged".
- **Evidence:** H8-team-overage-billing; Insights, `build started`, breakdown `trigger` and `plan_tier`, weekly, formula schedule / push; `-- EVAL Q13`.
- **Context needed:** 02-timeline.md (billing dates), 01-business.md (Team plan), 03-event-dictionary.md (`trigger`).
- **Grading:** must look at build triggers on Team with a control or a ratio. Wrong: "no change" from total build counts (they rose with growth); "Team customers stopped building".

### Q14 — What did overage billing bring in?
- **Prompt:** "How much overage revenue did Team billing bring in for September?"
- **Type:** external-join
- **Answer:** **$4,720.15 in September** (314,672 overage minutes at $0.015), from `usage_billing_daily`. There was no overage before September 1, none on other plans, and none on October 1 (allowances reset on the 1st). Within September it builds up as organizations use up their monthly allowances: nothing on Sep 1-4, $11.31 on Sep 5-6, then $422 (week of Sep 7), $1,031, $1,808, and $1,447 for Sep 28-30 ($355, $597, and $495 a day). Team billed runner minutes were 1,180,501 in August and 1,152,017 in September (flat even with growth, after the cron cuts). September overage is about $4.10 per 1,000 Team runner minutes. Accept within ±1%.
- **Evidence:** H8-team-overage-billing; warehouse `usage_billing_daily`; `-- EVAL Q14`.
- **Context needed:** 04-metrics-and-tables.md (billing table and caveats), 02-timeline.md.
- **Grading:** must use the warehouse (overage is not in Mixpanel) and keep September to Sep 1-30. Credit answers that note the month-start reset and the climb through the month. Wrong: estimating from `build_duration_sec` × price (billing meters parallel jobs; the table is the source of truth); reading the low first week as customers avoiding overage (allowances were not used up yet).

### Q15 — What drives change failure rate?
- **Prompt:** "Our rollback rate is around 12%. What's driving it?"
- **Type:** segmentation
- **Answer:** **Repository test coverage.** Rollback rate of production deploys by the repository's `test_coverage_pct`: **≤30% coverage 19.8%**, 31-49% 16.5%, 50-74% 9.2%, **≥75% 4.70%**, about **4.2x** from the lowest to the highest band, falling steadily. Overall: 12.26% of 48,458 deploys. Pull request size and Forge Assist do not matter (Q3, Q19). Accept a ratio of 3.6x-4.6x for ≤30% vs ≥75% and a monotonic decline.
- **Evidence:** H9-test-coverage-rollbacks; Insights, `production deployed`, share `deploy_outcome = rolled_back`, breakdown `test_coverage_pct` (custom buckets); `-- EVAL Q15`.
- **Context needed:** 03-event-dictionary.md (`test_coverage_pct`, `deploy_outcome`), 01-business.md (reliability goal).
- **Grading:** must break down by coverage and show the gradient. Wrong: "big pull requests" (no effect); "a cliff at one threshold".

### Q16 — Who buys a paid seat?
- **Prompt:** "Is there something new developers do early that predicts they'll pay?"
- **Type:** funnel
- **Answer:** **Using previews.** Of new developers who signed up on Free through Aug 20 (2,134), **29.3% of those with 3+ preview deploys in their first 14 days bought a paid seat within 42 days vs 5.5%** of those with 1-2 previews (about **5.3x**); developers with no preview in their first 14 days almost never bought (0.7%). By preview count: 1 preview 4.3%, 2 previews 7.6%, 3 24.5%, 4 28.8%, 5+ 40.7%. The 3+ group is 27% of onboarded Free signups but 110 of 170 buyers (65%). Part of the gap is engagement: 59.3% of the 3+ group reached the upgrade page within 42 days vs 29.2% of the 1-2 group. Per upgrade-page visit in those 42 days the 3+ group still buys at 2.3x the rate (31.5% vs 13.7% of visits), so the habit matters beyond reach, and "causes the whole 5x" overstates it. Accept 4.5x-6x for the paid rate and a clear step up from 1-2 to 3+ previews.
- **Evidence:** H10-preview-habit-converts; Funnels `account created` → `preview deployed` → `preview deployed` → `preview deployed`, 14-day window (completed = 3+, dropped after step 2 or 3 = 1-2); save cohorts; Funnels `account created` → `subscription started`, 42-day window, filter `account created` `plan_tier = free`, breakdown by cohort; `-- EVAL Q16`.
- **Context needed:** 04-metrics-and-tables.md (paid conversion definition), 01-business.md (growth goal).
- **Grading:** must define the behavior from the first 14 days only and compare purchase rates. Without the Free filter the rates drop (developers who joined a Team or Enterprise workspace cannot buy) but the ratio stays close (21.3% vs 4.0%, 5.3x); accept it if the answer says so. Credit an answer that separates reach (upgrade-page visits) from conversion per visit. Wrong: counting previews over the whole window (leaks the outcome); including developers whose 42-day window is incomplete.

### Q17 — Why did activity drop on two days?
- **Prompt:** "Our daily build chart has a sharp dip on a Monday in early September and on a Friday in early July. Was something broken?"
- **Type:** context
- **Answer:** **No; US holidays.** Monday **Sep 7 (Labor Day)** had 1,241 builds started vs 1,773, 1,756, and 1,749 on the surrounding Mondays (about −29%); active developers 2,385 vs 2,672-2,732. Friday **Jul 3 (Independence Day observed)** had 957 builds vs 1,402-1,456 on the surrounding Fridays (about −33%). The dip is all US developers: their hands-on work (pushes, pull requests opened, non-scheduled builds) fell 60% on Jul 3 and 52% on Sep 7 against the same weekday a week either side, while developers outside the US worked as usual (−2.2% and −1.2%). About 60% of developers are in the US, and scheduled builds run every day, so the total dip is partial. No incident is logged on either day. Accept naming both holidays; full credit needs the size of the dip (about 30% of builds, about 55% of US hands-on work) and a check that it is not an outage.
- **Evidence:** `-- EVAL Q17`; Insights, `build started`, daily; breakdown `country_code` (US vs the rest); timeline.
- **Context needed:** 02-timeline.md, 01-business.md (where developers are).
- **Grading:** must connect the dips to the holidays. Wrong: "an outage" (the only incident was Aug 19-20 and hit npm builds, not volume); "everyone took the day off" (non-US activity did not change). Extra credit for showing the dip is US-only with a `country_code` breakdown.

### Q18 — New self-serve revenue by month
- **Prompt:** "How much new MRR did self-serve upgrades add each month this summer?"
- **Type:** context
- **Answer:** At list price (Pro $12 per developer, Team $29 per seat): **June $8,124** (68 subscriptions; the window starts June 4), **July $9,661** (71), **August $9,333** (92), **September $9,979** (82); October 1 adds $638. Team drives most of it: about 10 seats per Team subscription vs 1 for Pro (August: Team 32 subscriptions, 297 seats, $8,613; Pro 60 subscriptions, $720; September: Team 31 subscriptions, 323 seats, $9,367; Pro 51, $612). New MRR is roughly flat at $9-10k a month from July (June is a partial month at a similar daily pace): monthly counts this small (70-90 subscriptions) move by ±15% on their own, so no month is a peak or a decline. Accept within ±2%.
- **Evidence:** `-- EVAL Q18`; Insights, `subscription started`, sum of `seats` by `plan`, monthly, × list price.
- **Context needed:** 01-business.md (prices), 04-metrics-and-tables.md (new MRR definition).
- **Grading:** must multiply seats by the plan's list price. Credit an answer that calls the monthly totals flat (or within normal variation) and notes June is a partial month. Wrong: counting subscriptions without seats; adding Enterprise (not self-serve); multiplying by $29 for Pro; reading a month-to-month change as a trend or blaming Team overage billing for it.

### Q19 — Do big pull requests break production more? (null)
- **Prompt:** "Engineering leadership wants a cap on pull request size because big PRs break production. Does the data back that up?"
- **Type:** null-hypothesis
- **Answer:** **No.** Rollback rate is **12.37% for ≤100-line pull requests, 12.14% for 101-999 lines, and 12.37% for 1,000+ lines** (21,769 / 23,520 / 3,169 deploys; 1,000+ vs ≤100 z ≈ 0.0, p ≈ 1.0). Coverage is the same across sizes (about 53%). Big pull requests do wait longer for review (Q7), but they do not roll back more; test coverage is what predicts rollbacks (Q15). Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q19`; Insights, `production deployed`, share `deploy_outcome = rolled_back`, breakdown `lines_changed` (custom buckets).
- **Context needed:** 03-event-dictionary.md, 04-metrics-and-tables.md (change failure rate).
- **Grading:** must check the data and report no difference. Wrong: "yes, big PRs roll back more" from intuition or from review-wait data.

### Q20 — What should we worry about going into Q4?
- **Prompt:** "Looking at this data, what should we worry about going into Q4, and what's working?"
- **Type:** open-ended
- **Answer:** A strong answer names most of these, with numbers:
  1. **Java/.NET setup**: 36.2% finish setup vs 61.0% for other stacks; Java/.NET is 28% of signups (Q5). Fix import and pipeline setup for JVM and .NET.
  2. **First-build failures**: 39.5% of new developers' first builds fail (55% configuration errors), and those developers are active in days 30-36 at 22.8% vs 46.1% (Q8). Better starter pipelines and error help. Only 27% of all new signups are still active a month in.
  3. **Rollbacks in low-coverage repositories**: 19.8% rollback rate at ≤30% coverage vs 4.7% at ≥75% (Q15); coverage, not pull request size, is the lever.
  4. **Paid social quality**: cheapest per signup ($54) but only 35.4% finish setup, so per onboarded developer it costs about the same as paid search ($151 vs $148); newsletter is the most expensive ($221) (Q11-Q12).
  5. **Registry mirror reliability**: the Aug 19-20 npm mirror incident cut npm build success to 37% for two days, about 518 lost builds (Q9).
  6. **Team overage reaction**: Team customers cut cron builds about in half within two weeks; overage brought in about $4.7k in September and was still climbing at month end (Q13-Q14). Watch Team satisfaction and churn.
  7. **Large pull requests** wait 2.5x as long for a first review (Q7).
  8. **Self-serve revenue is not growing**: new MRR stayed at about $9-10k a month from July to September (Q18) while weekly active developers grew about 21%; conversion of Free developers is the lever (Q16).
  Positive signals: Forge Assist cuts review-to-merge time to 0.59x and settled at about 38-39% of eligible pull requests (Q1-Q2); Remote Build Cache cuts build time to 0.60x with no change in pass rate (ship it, Q4); Free signups with 3+ previews in their first two weeks buy at 5x the rate (Q16); weekly active developers grew from about 5,000 to 6,100 over the summer.
- **Evidence:** H1-H10; `-- EVAL Q20` (headline numbers).
- **Context needed:** all guides.
- **Grading:** full credit for at least four risks with supporting numbers and at least one recommended action. Partial credit for risks without numbers. Wrong: a generic list not grounded in the data.
