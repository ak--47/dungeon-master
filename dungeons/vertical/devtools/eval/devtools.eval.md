# Forgebench (devtools) — 20-question eval

- **Data:** `data/verify-devtools` (full fidelity: 10,000 developers, 9,993 with events, 4,484 new signups, 500 organizations, 967,797 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query in `dungeons/vertical/devtools/devtools.sql` on that data.
- **Stories:** ids refer to the `stories` export in `devtools.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Does Forge Assist speed up merges?
- **Prompt:** "We launched Forge Assist at the end of July. Is it actually getting pull requests merged faster? By how much?"
- **Type:** trend
- **Answer:** Yes, after review. Since the 2026-07-29 launch, Pro/Team/Enterprise pull requests reviewed by Forge Assist (`review_mode = forge_assist`) went from review to merge in a **median 3.66 hours vs 6.12 hours** for standard pull requests on the same plans, about **0.60x** (average 5.83 vs 10.10 hours). Blended over all eligible pull requests, the median review → merge time fell from 6.05 hours before launch to 5.24 after (−13%), while Free pull requests (no access) stayed flat (6.18 → 5.98). Accept 0.54x-0.66x.
- **Evidence:** H1-forge-assist-launch; Funnels, `review submitted` → `pull request merged`, hold `pr_id` constant, median time to convert, breakdown `review_mode`, filter `plan_tier` in (pro, team, enterprise), from 2026-07-29; `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (launch date, plan scope), 03-event-dictionary.md (`review_mode`, `pr_id`).
- **Grading:** must compare assisted to standard pull requests on eligible plans (or use Free as a control for a before/after). Wrong: measuring open → review wait (it does not change; see Q6 and story notes); comparing all pull requests before vs after launch across every plan without noting the dilution.

### Q2 — Forge Assist adoption
- **Prompt:** "How many pull requests go through Forge Assist now? Is usage still growing?"
- **Type:** trend
- **Answer:** Adoption **ramped for about four weeks and then leveled off at about 39-40%** of eligible pull requests. Weekly share of Pro/Team/Enterprise pull requests opened with `review_mode = forge_assist` (Monday weeks): 2.0% (week of Jul 27; launch on Wednesday Jul 29), 11.7% (Aug 3), 20.9% (Aug 10), 29.9% (Aug 17), 39.4% (Aug 24), then 38.9%-39.7% every week through September (39.7% in the last partial week). From Aug 26 on, 39.3% of eligible pull requests use it. 2,533 of 5,353 eligible authors (47%) have used it. It is no longer growing. Accept a ramp through late August and a plateau of 36%-44%.
- **Evidence:** H1-forge-assist-launch; Insights, `pull request opened`, filter `plan_tier` in (pro, team, enterprise), breakdown `review_mode`, weekly, % of total; `-- EVAL Q2`.
- **Context needed:** 02-timeline.md (launch, opt-in per developer), 04-metrics-and-tables.md (adoption definition).
- **Grading:** denominator is eligible pull requests, and the answer must describe the shape (ramp, then plateau). Wrong: share of all pull requests including Free (much lower); "still growing"; quoting only an all-period average.

### Q3 — Are Forge Assist pull requests safer to ship? (null)
- **Prompt:** "Do pull requests reviewed by Forge Assist get rolled back less often in production?"
- **Type:** null-hypothesis
- **Answer:** **No.** Of eligible pull requests opened since launch that reached production, **12.91% of Forge Assist deploys rolled back vs 13.07%** of standard ones (877 of 6,794 vs 1,981 of 15,152; z ≈ −0.3, p ≈ 0.7). By plan: Enterprise 12.66% vs 13.18%, Pro 12.27% vs 11.69%, Team 13.14% vs 13.18% (no plan reaches p < 0.2; the largest gap is Enterprise, z ≈ −0.6). Forge Assist shortens the review-to-merge step; it does not change the change failure rate. Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q3`; Insights, `production deployed`, share `deploy_outcome = rolled_back`, breakdown `review_mode`, filter plan and date.
- **Context needed:** 03-event-dictionary.md (`deploy_outcome`, `review_mode`), 04-metrics-and-tables.md (change failure rate).
- **Grading:** must check rollbacks directly and treat the gap as noise. Wrong: "yes, AI review makes deploys safer"; citing merge speed as evidence of quality.

### Q4 — Should we ship the Remote Build Cache?
- **Prompt:** "What did the Remote Build Cache test show? Should we turn it on for everyone?"
- **Type:** segmentation
- **Answer:** Yes. Since 2026-07-08, passed builds in the **Remote Cache arm take a median 233 seconds vs 392 seconds in Control (0.59x**; average 274 vs 457 seconds). Pass/fail is unchanged: 85.3% vs 85.5% of builds succeed. Developers in both arms run about the same number of builds (14.7 vs 14.6 per developer), so the gain is per build. The split is close to even (3,478 Remote Cache vs 3,633 Control developers exposed, 48.9%; a sample-ratio check gives p ≈ 0.07, inside normal variation). Accept 0.54x-0.66x for build time and "no meaningful change" in success.
- **Evidence:** H2-remote-build-cache-experiment; Insights, `build finished`, median `build_duration_sec`, filter `build_status = success`, from 2026-07-08, breakdown `Experiment: Remote Build Cache`; `-- EVAL Q4`.
- **Context needed:** 02-timeline.md (test start and arms), 03-event-dictionary.md (`build_duration_sec`, exposure event).
- **Grading:** must compare arms within the test window on passed builds (or note that failed builds stop early). Wrong: before/after July 8 for everyone; comparing all builds including failed ones without comment; claiming the cache makes builds pass more often.

### Q5 — Where do new signups stall?
- **Prompt:** "Too many signups never finish setup. Is it everyone, or is a particular group struggling?"
- **Type:** funnel
- **Answer:** **Java and .NET developers.** 7-day setup completion (account created → repository imported → pipeline configured → preview deployed) is **32.1% for Java/.NET** (1,245 signups; Java 32.5%, .NET 31.5%) vs **57.7% for every other stack** (3,239 signups; Node 55.5%, Python 59.1%, Go 60.8%, Ruby 62.4%, Rust 56.0%), about **0.56x**. Java/.NET signups lose ground at every step: 77.7% import a repository (vs 85.5%), 54.5% configure a pipeline (vs 71.5%), 32.1% reach a preview. Java/.NET is 28% of signups; overall completion is 50.6%. Accept a ratio of 0.50-0.62 and naming Java and .NET.
- **Evidence:** H3-jvm-dotnet-onboarding-friction; Funnels, four setup steps, 7-day window, breakdown `primary_stack`; `-- EVAL Q5`.
- **Context needed:** 03-event-dictionary.md (setup events), 04-metrics-and-tables.md (onboarding completion), 01-business.md (DX goal).
- **Grading:** must break down by stack and give the gap. Wrong: blaming signup method or acquisition channel only (paid social is a second, separate gap: see Q12); reporting only the overall rate.

### Q6 — Do bigger organizations wait longer for reviews? (null)
- **Prompt:** "Enterprise teams have more process. Do their pull requests wait longer for a first review than startups'?"
- **Type:** null-hypothesis
- **Answer:** **No.** Median open → first review wait is **4.25 hours at enterprise organizations, 4.34 mid-market, 4.30 SMB, and 4.29 startups**; averages are 9.25, 9.37, 9.42, and 9.67 hours (on log wait time, enterprise vs startup z ≈ −1.2, p ≈ 0.24; mid-market and SMB vs startup |z| ≤ 0.2). The null holds inside each plan: enterprise vs startup z = +0.8 (Free), −0.7 (Pro), −1.2 (Team). Pull request size is the same across sizes (median 120-124 lines). Organization size does not matter; pull request size does (Q7). Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q6`; Funnels, `pull request opened` → `review submitted`, hold `pr_id`, median time to convert, breakdown user property `org_size`.
- **Context needed:** 01-business.md (organization sizes), 04-metrics-and-tables.md (review wait).
- **Grading:** must check the data and report no difference. Wrong: "enterprise is slower" from intuition.

### Q7 — Which pull requests wait longest for review?
- **Prompt:** "What makes a pull request sit waiting for review?"
- **Type:** funnel
- **Answer:** **Size.** Median open → first review wait by lines changed: **≤100 lines 3.21 h**, 101-399 lines 4.58 h, 400-999 lines 7.18 h, **1,000+ lines 7.92 h**, about **2.5x** for the largest vs the smallest. The wait rises steadily with size (no single cliff). 1,000+ line pull requests are 6.5% of pull requests; ≤100 lines are 45%. `review_wait_hours` on `review submitted` gives the same medians (3.2, 5.1, and 7.9 h for ≤100, 101-999, and 1,000+ lines; it is the open → review gap rounded to 0.1 h). Accept 2.25x-2.75x for 1,000+ vs ≤100 and a rising pattern.
- **Evidence:** H4-large-pr-review-wait; Funnels, `pull request opened` → `review submitted`, hold `pr_id`, median time to convert, breakdown `lines_changed` (custom buckets), or Insights average/median `review_wait_hours` by `lines_changed`; `-- EVAL Q7`.
- **Context needed:** 03-event-dictionary.md (`lines_changed`, `review_wait_hours`), 04-metrics-and-tables.md (review wait).
- **Grading:** must measure per pull request and show the size gradient. Wrong: unique-developer funnel time (pairs unrelated pull requests); naming organization size (Q6) or Forge Assist.

### Q8 — What predicts whether a new developer sticks around?
- **Prompt:** "Is there anything in a new developer's first days that predicts whether they're still using Forgebench a month later?"
- **Type:** retention
- **Answer:** **Their first CI build.** For new developers whose first build came within 14 days of signup (signups through Aug 25), day-30 retention (any activity in days 30-36) is **57.1% when the first build passed vs 26.7% when it failed (about 2.14x)**; days 7-13 activity is 84.1% vs 49.4%. The first build fails often: 40.2% of new developers' first builds fail (vs 14.5% for builds overall), and 57% of those failures are configuration errors. For scale, of all new signups through Aug 25, 70.4% are active on day 1, 44.1% in days 7-13, and 28.8% in days 30-36. Accept 1.8x-2.4x on D30 and mention of the high first-build failure rate.
- **Evidence:** H5-first-build-red-churn; build the cohorts in **Funnels**: `account created` → `build finished`, 14-day window, breakdown `build_status` of step 2 (the first build); save `success` and `failed` as cohorts; then **Retention**, `account created` → any event, custom bracket day 30-36, breakdown by those cohorts; `-- EVAL Q8`.
- **Context needed:** 04-metrics-and-tables.md (retention definition), 03-event-dictionary.md (`build_status`, `failure_stage`), 01-business.md (activation goal).
- **Grading:** must classify by the first build (not all builds) and compare retention. Wrong: "developers with more builds retain better" (circular); using a whole-window build count.

### Q9 — What happened to builds in mid-August?
- **Prompt:** "Build failures spiked for a couple of days in August. What happened, and how many builds did customers lose?"
- **Type:** external-join
- **Answer:** The **2026-08-19 to 2026-08-20 registry mirror incident, npm only.** `build_fleet_daily` shows `registry_mirror_status = degraded` for npm on those two days with `dependency_fetch_error_rate` 0.61-0.62 (normally at most 0.01). In Mixpanel, npm builds passed at **35.3%** on those days (33.0% and 37.7%) vs 85.8% on the surrounding days (Aug 12-18 and Aug 21-27); about half of npm builds failed at `dependency_install`. Other ecosystems stayed at 85.8% (vs 86.1%). Relative to other ecosystems, npm ran at about **0.41x** its normal success rate. About **522 builds** that would have passed failed (1,034 npm builds on incident days). Accept 0.36-0.46 and 450-600 lost builds.
- **Evidence:** H6-npm-registry-incident; Insights, `build finished`, share `build_status = success`, daily, breakdown `ecosystem`; warehouse join on date and `ecosystem`; `-- EVAL Q9`.
- **Context needed:** 02-timeline.md (incident dates), 04-metrics-and-tables.md (`build_fleet_daily`), 03-event-dictionary.md (`ecosystem`, `failure_stage`).
- **Grading:** must name the incident, npm, the dates, and a size. Wrong: blaming the Remote Build Cache test or customer code; saying every ecosystem failed; using `builds_started` from the warehouse as the Mixpanel build count.

### Q10 — Did the incident hit other ecosystems?
- **Prompt:** "During the August mirror incident, were Python, Java, and other builds failing on dependency downloads too?"
- **Type:** external-join
- **Answer:** **No; only the npm mirror failed.** In `build_fleet_daily`, every other ecosystem shows `registry_mirror_status = operational` on Aug 19-20 with a normal `dependency_fetch_error_rate` (at most 0.0098, vs 0.61-0.62 for npm). In Mixpanel, the share of non-npm builds that failed at `dependency_install` was **1.66% on Aug 19-20 (33 of 1,985 builds) vs 1.41% on every other day of the window** (z ≈ 1.0, p ≈ 0.3); against only the surrounding days (Aug 12-18 and 21-27, 1.21%) the gap is p ≈ 0.1. Pooled non-npm success was 85.8% vs 86.1%. By ecosystem the incident-day dependency failures are a handful of builds each (PyPI 8 of 584, Maven 5 of 452, NuGet 5 of 303, Go 6 of 258, Cargo 4 of 217, RubyGems 5 of 171), and none differs from its own window rate by more than z ≈ 1.7. Only npm fell (35.3% vs 85.8%, half its builds failing at `dependency_install`). Accept "only npm was hit by the mirror".
- **Evidence:** H6-npm-registry-incident; warehouse `build_fleet_daily` by `ecosystem` for Aug 19-20; Insights, `build finished`, filter `failure_stage = dependency_install` share, breakdown `ecosystem`, daily; `-- EVAL Q10`.
- **Context needed:** 04-metrics-and-tables.md, 02-timeline.md.
- **Grading:** must check the mirror status (warehouse) or dependency failures in the other ecosystems. Small ecosystems have only a few hundred builds in two days, so a few extra dependency failures (Go 6 of 258, RubyGems 5 of 171) are normal day-to-day variation; an answer that flags them should say they are small counts and that their mirrors were operational. Wrong: "all builds were affected"; reading a small ecosystem's few extra failures as a second mirror outage.

### Q11 — What do we pay per signup on each paid channel?
- **Prompt:** "What's our cost per signup on each paid channel?"
- **Type:** external-join
- **Answer:** Spend per Mixpanel signup over the window: **paid social $55.11** (761 signups, $41,942), **paid search $84.25** (856 signups, $72,115), **newsletter $120.74** (540 signups, $65,197). Paid social is about **0.65x** paid search per signup. Total paid spend is $179,255. Spend is billed every day (paid social $120-$603 per day, never zero). Platforms claim more signups than Mixpanel records (2,616 vs 2,157, about +21%), which would understate CAC. Accept social/search 0.59-0.72 and dollar values within ±3%.
- **Evidence:** H7-paid-channel-economics; warehouse `marketing_spend_daily.spend_usd` joined to `account created` by date and `acquisition_channel`; `-- EVAL Q11`.
- **Context needed:** 04-metrics-and-tables.md (CAC definition, spend table), 01-business.md (channels).
- **Grading:** must divide by Mixpanel signups over a period. Wrong: using `platform_reported_signups`; quoting a single day.

### Q12 — Is paid social worth it?
- **Prompt:** "Marketing moved budget into paid social because signups are cheap there. Is it actually our most efficient channel?"
- **Type:** attribution
- **Answer:** **No, not once you look at onboarding.** Paid social signups finish setup at **30.0% vs 54.8%** for every other channel (paid search 53.4%, newsletter 57.0%, organic 56.2%, referral 52.3%, community 54.1%), about **0.55x**. So spend per onboarded developer is **$183.96 on paid social vs $157.80 on paid search** (and $211.68 on newsletter): paid search is the cheapest paid channel per onboarded developer even though paid social is 35% cheaper per signup. Newsletter is the most expensive on both measures. Accept an onboarding ratio of 0.49-0.66 and the conclusion that paid social's signup advantage disappears per onboarded developer.
- **Evidence:** H7-paid-channel-economics; Funnels, setup steps, 7-day window, breakdown `acquisition_channel`; warehouse spend; `-- EVAL Q12`.
- **Context needed:** 01-business.md (channels, goal 2), 04-metrics-and-tables.md (cost per onboarded developer).
- **Grading:** must combine cost and onboarding (or another downstream step). Wrong: "paid social is best" from CAC alone; ignoring onboarding.

### Q13 — Did overage billing change how Team customers use CI?
- **Prompt:** "Team overage billing started September 1. Did Team customers change how they use CI?"
- **Type:** trend
- **Answer:** Yes: **Team customers switched off about half of their scheduled (cron) builds** over the first two weeks of September, and nothing else changed. Scheduled builds per push build on Team went from **0.257 in August to 0.130 on Sep 15-30 (0.50x)**; weekly it was 0.24-0.26 through August, then 0.218 (week of Aug 31), 0.185 (Sep 7), 0.130, 0.121, 0.133 (partial week). Other plans stayed flat (0.257 → 0.268, 1.04x). Team push builds did not fall (315.1 → 351.1 per day), so developers did not build less; they cut cron jobs. Accept 0.43x-0.57x and "push builds unchanged".
- **Evidence:** H8-team-overage-billing; Insights, `build started`, breakdown `trigger` and `plan_tier`, weekly, formula schedule / push; `-- EVAL Q13`.
- **Context needed:** 02-timeline.md (billing dates), 01-business.md (Team plan), 03-event-dictionary.md (`trigger`).
- **Grading:** must look at build triggers on Team with a control or a ratio. Wrong: "no change" from total build counts (they rose with growth); "Team customers stopped building".

### Q14 — What did overage billing bring in?
- **Prompt:** "How much overage revenue did Team billing bring in for September?"
- **Type:** external-join
- **Answer:** **$4,681.70 in September** (312,110 overage minutes at $0.015), from `usage_billing_daily`. There was no overage before September 1, none on other plans, and none on October 1 (allowances reset on the 1st). Within September it builds up as organizations use up their monthly allowances: nothing on Sep 1-3, $18.35 on Sep 4-6, then $480 (week of Sep 7), $1,057, $1,727, and $1,400 for Sep 28-30, ending above $500 a day. Team billed runner minutes were 1,157,750 in August and 1,155,382 in September (flat even with growth, after the cron cuts). September overage is about $4.05 per 1,000 Team runner minutes. Accept within ±1%.
- **Evidence:** H8-team-overage-billing; warehouse `usage_billing_daily`; `-- EVAL Q14`.
- **Context needed:** 04-metrics-and-tables.md (billing table and caveats), 02-timeline.md.
- **Grading:** must use the warehouse (overage is not in Mixpanel) and keep September to Sep 1-30. Credit answers that note the month-start reset and the climb through the month. Wrong: estimating from `build_duration_sec` × price (billing meters parallel jobs; the table is the source of truth); reading the low first week as customers avoiding overage (allowances were not used up yet).

### Q15 — What drives change failure rate?
- **Prompt:** "Our rollback rate is around 12%. What's driving it?"
- **Type:** segmentation
- **Answer:** **Repository test coverage.** Rollback rate of production deploys by the repository's `test_coverage_pct`: **≤30% coverage 20.0%**, 31-49% 17.1%, 50-74% 9.4%, **≥75% 5.15%**, about **3.9x** from the lowest to the highest band, falling steadily. Overall: 12.74% of 47,156 deploys. Pull request size and Forge Assist do not matter (Q3, Q19). Accept a ratio of 3.4x-4.4x for ≤30% vs ≥75% and a monotonic decline.
- **Evidence:** H9-test-coverage-rollbacks; Insights, `production deployed`, share `deploy_outcome = rolled_back`, breakdown `test_coverage_pct` (custom buckets); `-- EVAL Q15`.
- **Context needed:** 03-event-dictionary.md (`test_coverage_pct`, `deploy_outcome`), 01-business.md (reliability goal).
- **Grading:** must break down by coverage and show the gradient. Wrong: "big pull requests" (no effect); "a cliff at one threshold".

### Q16 — Who buys a paid seat?
- **Prompt:** "Is there something new developers do early that predicts they'll pay?"
- **Type:** funnel
- **Answer:** **Using previews.** Of new developers who signed up on Free through Aug 20 (2,136), **15.7% of those with 3+ preview deploys in their first 14 days bought a paid seat within 42 days vs 3.9%** of those with 1-2 previews (about **4.0x**); developers who never finished setup (no preview) never bought. By preview count: 1 preview 2.7%, 2 previews 6.2%, 3 13.3%, 4 11.5%, 5+ 27.9%. The 3+ group is 31% of onboarded Free signups but 53 of 83 buyers (64%). Part of the gap is engagement (heavy users reach the upgrade page more often), so "predicts" is right and "causes the whole 4x" overstates it. Accept 3x-5.5x and a clear step up from 1-2 to 3+ previews.
- **Evidence:** H10-preview-habit-converts; Funnels `account created` → `preview deployed` → `preview deployed` → `preview deployed`, 14-day window (completed = 3+, dropped after step 2 or 3 = 1-2); save cohorts; Funnels `account created` → `subscription started`, 42-day window, filter `account created` `plan_tier = free`, breakdown by cohort; `-- EVAL Q16`.
- **Context needed:** 04-metrics-and-tables.md (paid conversion definition), 01-business.md (growth goal).
- **Grading:** must define the behavior from the first 14 days only and compare purchase rates. Without the Free filter the rates drop (developers who joined a Team or Enterprise workspace cannot buy) but the ratio stays close (11.2% vs 2.9%, 3.9x); accept it if the answer says so. Wrong: counting previews over the whole window (leaks the outcome); including developers whose 42-day window is incomplete.

### Q17 — Why did activity drop on two days?
- **Prompt:** "Our daily build chart has a sharp dip on a Monday in early September and on a Friday in early July. Was something broken?"
- **Type:** context
- **Answer:** **No; US holidays.** Monday **Sep 7 (Labor Day)** had 1,228 builds started vs 1,682, 1,734, and 1,586 on the surrounding Mondays (about −26%); active developers 2,274 vs 2,573-2,654. Friday **Jul 3 (Independence Day observed)** had 910 builds vs 1,316-1,365 on the surrounding Fridays (about −32%). The dip is all US developers: their hands-on work (pushes, pull requests opened, non-scheduled builds) fell 56% on Jul 3 and 50% on Sep 7 against the same weekday a week either side, while developers outside the US worked as usual (−1.5% and +2.7%). About 60% of developers are in the US, and scheduled builds run every day, so the total dip is partial. No incident is logged on either day. Accept naming both holidays; full credit for showing the dip is US-only.
- **Evidence:** `-- EVAL Q17`; Insights, `build started`, daily; breakdown `country_code` (US vs the rest); timeline.
- **Context needed:** 02-timeline.md, 01-business.md (where developers are).
- **Grading:** must connect the dips to the holidays. Wrong: "an outage" (the only incident was Aug 19-20 and hit npm builds, not volume); "everyone took the day off" (non-US activity did not change).

### Q18 — New self-serve revenue by month
- **Prompt:** "How much new MRR did self-serve upgrades add each month this summer?"
- **Type:** context
- **Answer:** At list price (Pro $12 per developer, Team $29 per seat): **June $4,643** (38 subscriptions; the window starts June 4), **July $6,110** (44), **August $6,532** (52), **September $5,235** (42); October 1 adds $290. Team drives most of it: about 10 seats per Team subscription vs 1 for Pro (August: Team 20 subscriptions, 212 seats, $6,148; Pro 32 subscriptions, $384; September: Team 19 subscriptions, 171 seats, $4,959; Pro 23, $276). New MRR is roughly flat at $5-6.5k a month from July: monthly counts this small (42-52 subscriptions) move by ±15% on their own, so August is not a peak and September is not a decline. Accept within ±2%.
- **Evidence:** `-- EVAL Q18`; Insights, `subscription started`, sum of `seats` by `plan`, monthly, × list price.
- **Context needed:** 01-business.md (prices), 04-metrics-and-tables.md (new MRR definition).
- **Grading:** must multiply seats by the plan's list price. Credit an answer that calls the monthly totals flat (or within normal variation) and notes June is a partial month. Wrong: counting subscriptions without seats; adding Enterprise (not self-serve); multiplying by $29 for Pro; reading the Aug-to-Sep change as a trend or blaming Team overage billing for it.

### Q19 — Do big pull requests break production more? (null)
- **Prompt:** "Engineering leadership wants a cap on pull request size because big PRs break production. Does the data back that up?"
- **Type:** null-hypothesis
- **Answer:** **No.** Rollback rate is **12.73% for ≤100-line pull requests, 12.79% for 101-999 lines, and 12.44% for 1,000+ lines** (21,043 / 23,082 / 3,031 deploys; 1,000+ vs ≤100 z ≈ −0.5, p ≈ 0.7). Coverage is the same across sizes (about 52%). Big pull requests do wait longer for review (Q7), but they do not roll back more; test coverage is what predicts rollbacks (Q15). Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q19`; Insights, `production deployed`, share `deploy_outcome = rolled_back`, breakdown `lines_changed` (custom buckets).
- **Context needed:** 03-event-dictionary.md, 04-metrics-and-tables.md (change failure rate).
- **Grading:** must check the data and report no difference. Wrong: "yes, big PRs roll back more" from intuition or from review-wait data.

### Q20 — What should we worry about going into Q4?
- **Prompt:** "Looking at this data, what should we worry about going into Q4, and what's working?"
- **Type:** open-ended
- **Answer:** A strong answer names most of these, with numbers:
  1. **Java/.NET setup**: 32.1% finish setup vs 57.7% for other stacks; Java/.NET is 28% of signups (Q5). Fix import and pipeline setup for JVM and .NET.
  2. **First-build failures**: 40.2% of new developers' first builds fail (57% configuration errors), and those developers are active in days 30-36 at 26.7% vs 57.1% (Q8). Better starter pipelines and error help. Only 29% of all new signups are still active a month in.
  3. **Rollbacks in low-coverage repositories**: 20.0% rollback rate at ≤30% coverage vs 5.15% at ≥75% (Q15); coverage, not pull request size, is the lever.
  4. **Paid social quality**: cheapest per signup ($55) but only 30.0% finish setup, so it costs more per onboarded developer than paid search ($184 vs $158); newsletter is the most expensive ($212) (Q11-Q12).
  5. **Registry mirror reliability**: the Aug 19-20 npm mirror incident cut npm build success to 35% for two days, about 522 lost builds (Q9).
  6. **Team overage reaction**: Team customers cut cron builds about in half within two weeks; overage brought in about $4.7k in September and was still climbing at month end (Q13-Q14). Watch Team satisfaction and churn.
  7. **Large pull requests** wait 2.5x as long for a first review (Q7).
  8. **Self-serve revenue is not growing**: new MRR stayed at about $5-6.5k a month from July to September (Q18) while weekly active developers grew about 22%; conversion of Free developers is the lever (Q16).
  Positive signals: Forge Assist cuts review-to-merge time to 0.60x and settled at about 39% of eligible pull requests (Q1-Q2); Remote Build Cache cuts build time to 0.59x with no change in pass rate (ship it, Q4); Free signups with 3+ previews in their first two weeks buy at 4x the rate (Q16); weekly active developers grew from about 5,100 to 6,200 over the summer.
- **Evidence:** H1-H10; `-- EVAL Q20` (headline numbers).
- **Context needed:** all guides.
- **Grading:** full credit for at least four risks with supporting numbers and at least one recommended action. Partial credit for risks without numbers. Wrong: a generic list not grounded in the data.
