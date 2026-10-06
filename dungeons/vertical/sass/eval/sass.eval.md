# Tallyboard (sass) — 20-question eval

- **Data:** `data/verify-sass` (full fidelity: 10,000 users, 9,994 with events, 4,488 new signups, 300 companies, 1,114,296 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-06
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query in `dungeons/vertical/sass/sass.sql` on that data.
- **Stories:** ids refer to the `stories` export in `sass.js` (H1-H11).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Does Root Cause Assist shorten incidents?
- **Prompt:** "We launched Root Cause Assist in July. Is it actually making incident resolution faster? By how much?"
- **Type:** trend
- **Answer:** Yes. Since the 2026-07-22 launch, Business and Enterprise resolutions that used Root Cause Assist (`resolution_method = ai_assist`) took **71.4 minutes on average from acknowledgement to resolution vs 130.9 minutes** for manual and runbook resolutions on the same plans, about **0.55x** (median 50.5 vs 93.6 minutes). Blended over all Business and Enterprise resolutions, average resolution time fell from 129.8 minutes before launch to 107.7 after (−17%), while Free and Team (no access) stayed flat (128.5 → 132.0). Accept 0.49x-0.61x.
- **Evidence:** H2-root-cause-assist-launch; Insights, `alert resolved`, average `resolution_time_mins`, breakdown `resolution_method`, filter `plan_tier` in (business, enterprise), after 2026-07-22; `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (launch date, plan scope), 03-event-dictionary.md (`resolution_time_mins`, `resolution_method`).
- **Grading:** must compare AI-assisted to non-assisted resolutions on eligible plans, or use Free/Team as a control for the before/after. Wrong: comparing all resolutions before vs after launch across every plan (dilutes the effect); measuring trigger-to-ack time.

### Q2 — Root Cause Assist adoption
- **Prompt:** "How many incidents are resolved with Root Cause Assist? Is usage growing?"
- **Type:** segmentation
- **Answer:** **About 39%** (39.1%) of Business and Enterprise resolutions since launch use Root Cause Assist, by 1,423 users. Usage was flat from the launch week: weekly share stayed between 37% and 41% (38.5% in the launch week, 40.0% in the week of Sep 21). It did not ramp. Accept 36%-43% and "flat".
- **Evidence:** H2-root-cause-assist-launch; Insights, `alert resolved`, filter plan and date, breakdown `resolution_method`, weekly; `-- EVAL Q2`.
- **Context needed:** 02-timeline.md, 04-metrics-and-tables.md (adoption definition).
- **Grading:** denominator is eligible (Business/Enterprise, post-launch) resolutions. Wrong: share of all resolutions (much lower, because Free and Team cannot use it); claiming steady growth.

### Q3 — Did Root Cause Assist speed up acknowledgement? (null)
- **Prompt:** "Since Root Cause Assist launched, are our Business and Enterprise customers acknowledging alerts faster too?"
- **Type:** null-hypothesis
- **Answer:** **No.** Average time from trigger to acknowledgement on Business and Enterprise plans was **16.6 minutes before launch and 16.3 after** (median 10.8 vs 10.4). Root Cause Assist acts after acknowledgement; it shortens resolution, not response. Accept "no meaningful change" (within ±5%).
- **Evidence:** `-- EVAL Q3`; Insights, `alert acknowledged`, average `response_time_mins`, filter plan, before vs after 2026-07-22.
- **Context needed:** 03-event-dictionary.md (what `response_time_mins` measures), 02-timeline.md.
- **Grading:** must check acknowledgement time directly. Wrong: "yes, incidents got faster" by citing resolution time.

### Q4 — Where do new signups stall in setup?
- **Prompt:** "Too many signups never finish setup. Is it everyone, or is there a segment that struggles?"
- **Type:** funnel
- **Answer:** **Azure companies.** 7-day onboarding completion (account created → cloud account connected → agent installed → dashboard created) is **33.4% for Azure** (439 of 1,316 signups) vs **62.1% for AWS, GCP, and multi-cloud** (AWS 62.2%, GCP 61.8%, multi-cloud 62.5%), about **0.54x**. Azure signups drop at both the cloud-connect step (77.6% vs 87-90%) and the agent-install step (55.9% vs 74-75% cumulative). Azure is 29% of signups; at parity about 378 more Azure signups would have finished setup. Accept a ratio of 0.48-0.60 and naming Azure.
- **Evidence:** H3-azure-onboarding-friction; Funnels, four onboarding steps, 7-day window, breakdown `cloud_provider`; `-- EVAL Q4`.
- **Context needed:** 03-event-dictionary.md (onboarding events), 04-metrics-and-tables.md (onboarding completion).
- **Grading:** must break down by cloud provider and give the gap. Wrong: blaming signup method or company size; reporting only the overall rate (about 54%).

### Q5 — Do GitHub signups onboard worse? (null)
- **Prompt:** "Engineers who sign up with GitHub seem flakier. Do they finish onboarding less often than Google signups?"
- **Type:** null-hypothesis
- **Answer:** **No.** 7-day onboarding completion is **53.6% for GitHub** (1,354 signups) vs **52.9% for Google** (1,554); the 0.7-point gap is noise (z ≈ 0.4). Email (53.2%) and SSO (56.2%, 667 signups) are in the same range. Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q5`; Funnels onboarding steps, breakdown `signup_method`.
- **Context needed:** 03-event-dictionary.md.
- **Grading:** must check the data and treat the small gaps as noise. Wrong: "yes, GitHub is lower"; ranking methods without a significance check.

### Q6 — Do chat and paging integrations matter?
- **Prompt:** "Does connecting Slack and PagerDuty actually speed up incident response?"
- **Type:** segmentation
- **Answer:** Yes, for acknowledgement. Users who configured **both Slack and PagerDuty** acknowledge alerts in **10.9 minutes on average vs 27.3 minutes** for everyone else, about **0.40x** (median 7.7 vs 19.3). Once acknowledged, resolution time is the same (131.1 vs 129.7 minutes for non-AI resolutions). 3,002 users (40% of users who get alerts) have both. Accept 0.36x-0.44x for acknowledgement and "no difference" for resolution.
- **Evidence:** H4-slack-pagerduty-response; Insights, `alert acknowledged`, average `response_time_mins`, breakdown by a cohort "did integration configured where integration_type = slack AND integration configured where integration_type = pagerduty"; `-- EVAL Q6`.
- **Context needed:** 03-event-dictionary.md (integrations, `response_time_mins`).
- **Grading:** must build the both-integrations cohort and separate acknowledgement from resolution. Wrong: "integrated teams resolve incidents faster" (resolution does not change); using only one of the two integrations.

### Q7 — Response time by company size
- **Prompt:** "How quickly do customers acknowledge alerts, and does it differ by company size?"
- **Type:** funnel
- **Answer:** Median time to acknowledge per alert: **enterprise 8.2 minutes, mid-market 13.7, SMB 13.7, startup 20.7**. Enterprise is about **0.60x** and startups about **1.52x** the SMB/mid-market time. Accept enterprise 0.54x-0.66x and startup 1.35x-1.65x.
- **Evidence:** H10-response-time-by-company-size; Funnels, `alert triggered` → `alert acknowledged`, hold `alert_id` constant, median time to convert, breakdown `company_size`; `-- EVAL Q7`.
- **Context needed:** 01-business.md (company sizes), 04-metrics-and-tables.md (MTTA).
- **Grading:** must measure per alert (same `alert_id`), median preferred. Wrong: unique-user funnel time that pairs a trigger with an unrelated later acknowledgement.

### Q8 — Are we paging people too much?
- **Prompt:** "Our SRE advisory board says alert noise is a problem. Is there evidence people ignore alerts when they get a lot of them?"
- **Type:** segmentation
- **Answer:** Yes. Acknowledgement rate by alerts received in the window: **1-6 alerts 85.9%, 7-12 86.2%**, then it falls: 13-18 77.8%, 19-24 64.1%, 25-29 50.6%, and **about 42-43% at 30+** (30-44: 42.3%, 45+: 42.7%). Roughly half of the would-be acknowledgements are lost for the heaviest recipients (0.49x vs the light group). The decline starts above about 12 alerts and levels off at about 30. 998 users (13% of alert recipients) get 30+ alerts and receive 34% of all alerts. Accept a description of a decline starting near 12 and a floor near 30, with rates within ±3 points.
- **Evidence:** H11-alert-fatigue; Funnels, `alert triggered` → `alert acknowledged`, totals, hold `alert_id`, breakdown by a cohort on alert count; `-- EVAL Q8`.
- **Context needed:** 01-business.md (goal 4), 04-metrics-and-tables.md (acknowledgement rate).
- **Grading:** must show the rate by volume band, not just a correlation. Wrong: "a cliff at N alerts"; unique-user funnel rates (most users acknowledge at least one alert).

### Q9 — What predicts new-user retention?
- **Prompt:** "Is there something new users do in their first week that predicts whether they stick around?"
- **Type:** retention
- **Answer:** **Inviting at least 2 teammates in the first 7 days.** Day-30 retention (any activity in days 30-36) is **70.4% for users with 2+ first-week invites vs 33.6%** for users with 0-1 (about **2.1x**). The jump is at 2: 0 invites 32.8%, 1 invite 36.2%, 2 invites 71.0%, 3 invites 71.4%, 4+ 65.9%. 81% of new users (signups through Aug 25) fall below the line. Accept 1.8x-2.4x and the threshold of 2.
- **Evidence:** H5-first-week-team-activation; Retention, `account created` → any event, cohort on first-week `teammate invited` count; `-- EVAL Q9`.
- **Context needed:** 01-business.md (activation goal), 04-metrics-and-tables.md (retention definition).
- **Grading:** must define the behavior from the first week only and name the threshold. Wrong: using invites over the whole window (leaks the outcome); "onboarding completion predicts retention" without checking.

### Q10 — Is Smart Test Selection working?
- **Prompt:** "Should we ship Smart Test Selection to everyone? What did the test show?"
- **Type:** funnel
- **Answer:** Yes. Since 2026-07-15, **81.1% of Smart Selection pipeline runs succeed and deploy vs 67.4% for Control** (about **1.20x**, 26,147 vs 26,938 runs), and the median time from run to deploy is **22.5 vs 30.0 minutes** (0.75x). Users in both arms run the same number of pipelines (7.6 per user), so the gain is per run, not more runs. The split is even (3,460 vs 3,526 users). Accept 1.08x-1.32x for success and 0.68x-0.83x for time.
- **Evidence:** H6-smart-test-selection-experiment; Funnels `deployment pipeline run` → `service deployed`, totals, hold `deploy_id`, 1-day window, breakdown `Experiment: Smart Test Selection` (or Insights share of `pipeline_status = success`); `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (test start and arms), 03-event-dictionary.md (`deploy_id`, `pipeline_status`).
- **Grading:** must compare per run within the test window. Wrong: unique-user funnel conversion (almost every user deploys at least once, which hides the gap); comparing before vs after July 15 for everyone.

### Q11 — Late-August deploy failures
- **Prompt:** "Pipeline failures spiked for a few days in late August. What happened, and how many deploys did customers lose?"
- **Type:** external-join
- **Answer:** The **2026-08-25 to 2026-08-27 hosted CI runner incident in us-east**. `ci_runner_health_daily` shows `runner_status = major_outage` for us-east only, `infra_error_rate` ≈ 0.61 (vs under 1% normally), and p95 queue time near 2,000 seconds (vs under 70). In Mixpanel, us-east pipeline success fell to **28.3%** on those days from 74.1% on the surrounding days, while the other regions stayed at 75.2% (74.5% around). Relative to the other regions, us-east ran at **0.38x** its normal success rate. About **373 deploys** did not happen (800 us-east runs on incident days). Accept 0.32-0.44 and 300-450 lost deploys.
- **Evidence:** H7-ci-runner-incident; Insights `deployment pipeline run`, share `pipeline_status = success`, daily, breakdown `runner_region`; warehouse join on date and `runner_region`; `-- EVAL Q11`.
- **Context needed:** 02-timeline.md (incident dates), 04-metrics-and-tables.md (`ci_runner_health_daily`), 03-event-dictionary.md (`runner_region`).
- **Grading:** must name the incident, the region, the dates, and a size. Wrong: blaming the Smart Test Selection test (both arms were hit alike) or customer code; saying all regions failed.

### Q12 — Was the incident only us-east? (null for the other regions)
- **Prompt:** "Did the August runner incident hurt pipelines in our other regions too?"
- **Type:** external-join
- **Answer:** **No.** During the incident, success rates in the other regions matched the surrounding days: **us-west 75.9% vs 74.8%, eu-west 73.8% vs 73.9%, ap-south 77.4% vs 75.1%**. Only us-east fell (28.3% vs 74.1%). The warehouse agrees: only us-east shows `major_outage`. Accept "only us-east" with other regions within ±3 points.
- **Evidence:** H7-ci-runner-incident; `-- EVAL Q12`.
- **Context needed:** 04-metrics-and-tables.md, 02-timeline.md.
- **Grading:** must check each region. Wrong: "all regions were affected".

### Q13 — What does a signup cost by channel?
- **Prompt:** "What are we paying per signup on each paid channel?"
- **Type:** external-join
- **Answer:** Spend per Mixpanel signup over the window: **LinkedIn Ads $416.92** (931 signups, $388,155), **G2 $209.42** (414 signups, $86,701), **paid search $140.09** (997 signups, $139,673). LinkedIn costs about **3.0x** paid search per signup and takes 63% of the $614,530 paid budget. Daily cost per signup varies about ±12% around those levels. Platform-reported leads overstate signups by about 15%, which understates CAC. Accept LinkedIn/search 2.7x-3.3x and dollar values within ±3%.
- **Evidence:** H8-paid-channel-economics; warehouse `paid_marketing_daily.spend_usd` joined to `account created` by date and `acquisition_channel`; `-- EVAL Q13`.
- **Context needed:** 04-metrics-and-tables.md (CAC definition, spend table), 01-business.md (channels).
- **Grading:** must divide by Mixpanel signups. Wrong: using `platform_reported_leads`; comparing total spend only.

### Q14 — Is LinkedIn worth it?
- **Prompt:** "Marketing says LinkedIn brings our best customers. Is it worth what we pay compared with search?"
- **Type:** attribution
- **Answer:** LinkedIn signups **do convert better**: 24.0% start a paid subscription vs 10.5% for paid search (G2 17.6%, outbound 22.3%, referral 15.8%, organic 14.8%). Comparing signups from the same weeks, LinkedIn converts at **about 2.3x** the paid-search rate. But a LinkedIn signup costs 3x as much, so **cost per paying customer is still higher on LinkedIn: about $1,741 vs $1,330 for paid search and $1,188 for G2**. LinkedIn is not the cheapest way to win a paying customer. Accept a conversion ratio of 1.8x-2.6x and the conclusion that LinkedIn costs more per paying customer.
- **Evidence:** H8-paid-channel-economics; Funnels or Insights `account created` → `subscription started` by `acquisition_channel`; warehouse spend; `-- EVAL Q14`.
- **Context needed:** 01-business.md (channels, goal 2), 04-metrics-and-tables.md (cost per paying customer).
- **Grading:** must combine conversion and cost. Wrong: "LinkedIn is best" from conversion alone, or "LinkedIn is worst" from CAC alone.

### Q15 — Did the Team price rise hurt Team sales?
- **Prompt:** "We raised the Team price on August 17. Did fewer people buy Team after that?"
- **Type:** trend
- **Answer:** **Not in subscription count; yes in seats.** Team's share of new subscriptions was **68.5% before and 66.8% after** (501 of 731 vs 273 of 409); the 1.8-point dip is noise (z ≈ −0.6), and Business is the control. What changed is size: new Team subscriptions start with **8.9 seats on average vs 12.0 before (0.74x)**, while Business stayed at about 12-13 seats (12.9 → 12.3). Accept "no meaningful drop in count" plus a seat ratio of 0.66-0.81.
- **Evidence:** H9-team-price-change; Insights, `subscription started`, total and average `seats`, breakdown `plan`, weekly; `-- EVAL Q15`.
- **Context needed:** 02-timeline.md (price change), 01-business.md (plans).
- **Grading:** must look at seats, not only counts, and use Business as a control. Wrong: "no effect" (misses seats); "Team sales collapsed" (count did not fall relative to Business).

### Q16 — Did the price rise pay off?
- **Prompt:** "Even if seats dipped, did the higher Team price bring in more new Team MRR?"
- **Type:** external-join
- **Answer:** **No.** Joining subscriptions to `list_price_per_seat_usd`, new MRR per Team subscription fell from **$240.88 to $221.79 (0.92x)** despite the 25% price rise, because seats fell about 26%. New Team MRR per day fell from **$1,631 to $1,316 (−19%)**; Business fell less ($1,806 → $1,632 per day, −10%; per subscription $581 → $552). The price rise did not pay off in new MRR. Accept a per-subscription ratio of 0.83-0.97 and "did not pay off".
- **Evidence:** H9-team-price-change; warehouse `subscription_bookings_daily` (or events joined to its prices on date and `plan`); `-- EVAL Q16`.
- **Context needed:** 04-metrics-and-tables.md (bookings table and caveats), 02-timeline.md.
- **Grading:** must use warehouse prices (price is not on events). Wrong: multiplying seats by $25 for the whole window; ignoring the seat drop.

### Q17 — Did the quarter-close promotion work?
- **Prompt:** "Sales ran a seat promotion for the last two weeks of Q3. Did it drive seat expansion?"
- **Type:** trend
- **Answer:** Yes. Teammate invitations per dashboard view rose from **0.385 (Sep 1-15) to 0.576 (Sep 16-30), about 1.50x**; invites went from 6,376 to 9,077 while dashboard views were flat (16,547 vs 15,754). The number of users sending invites did not change (2,685 vs 2,599): existing inviters invited more people. Accept 1.35x-1.65x.
- **Evidence:** H1-quarter-close-seat-push; Insights, `teammate invited` and `dashboard viewed`, daily, formula A/B; `-- EVAL Q17`.
- **Context needed:** 02-timeline.md (promotion dates).
- **Grading:** must normalize by a stable activity measure or compare like periods. Wrong: crediting Labor Day; reporting raw invites without a baseline.

### Q18 — New bookings by month
- **Prompt:** "What did new self-serve bookings look like by month this summer, in new MRR?"
- **Type:** context
- **Answer:** From `subscription_bookings_daily`: **June $87,250 new MRR** (254 subscriptions; window starts June 4), **July $108,670** (309), **August $105,440** (310), **September $87,555** (262), October 1 $1,025 (5). By plan, Team was $39,640 / $52,600 / $48,515 / $39,450 and Business $47,610 / $56,070 / $56,925 / $48,105 for June-September. September is the softest full month, driven by smaller Team deals after the August price change. Accept within ±1%.
- **Evidence:** warehouse `subscription_bookings_daily`; `-- EVAL Q18`.
- **Context needed:** 04-metrics-and-tables.md (bookings table, self-serve only), 02-timeline.md.
- **Grading:** must use the warehouse (prices are not on events) and note the partial June. Wrong: counting Enterprise; reporting ARR as MRR.

### Q19 — Did the runner incident hurt alerting or dashboards? (null)
- **Prompt:** "During the August runner incident, did customers also respond to alerts more slowly or stop using dashboards?"
- **Type:** null-hypothesis
- **Answer:** **No.** On the incident days, average time to acknowledge was **19.1 minutes vs 19.4** on the surrounding days, dashboard views were **1,120 per day vs 1,131**, and alerts were **869 per day vs 881**. Only pipelines were affected. Accept "no meaningful change" (within ±5%).
- **Evidence:** `-- EVAL Q19`; Insights, `alert acknowledged` average `response_time_mins` and `dashboard viewed` total, daily.
- **Context needed:** 02-timeline.md.
- **Grading:** must check the data. Wrong: "the whole platform was down".

### Q20 — What to worry about in Q4
- **Prompt:** "Looking at this data, what should we worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names most of these, with numbers:
  1. **Azure onboarding**: Azure signups finish setup at 33% vs 62% for other clouds; Azure is 29% of signups, about 378 lost setups this window. Fix the connect and agent-install steps for Azure.
  2. **Activation**: 81% of new users invite fewer than 2 teammates in week one, and they retain at 34% vs 70% at day 30. Push team invites in onboarding.
  3. **Team pricing**: the August price rise shrank new Team deals from 12.0 to 8.9 seats; new MRR per Team subscription fell 8% and new Team MRR per day fell 19%. Revisit the price or seat packaging.
  4. **Alert fatigue**: 13% of alert recipients get 30+ alerts (34% of all alerts) and acknowledge only about 42% of them vs 86% for light recipients. Tune alert noise.
  5. **Paid acquisition mix**: LinkedIn takes 63% of the $614,530 paid budget; it converts 2.3x better than search but still costs about $1,741 per paying customer vs $1,330 (search) and $1,188 (G2).
  6. **Runner reliability**: the us-east incident cut success to 28% for three days and cost about 373 deploys.
  Positive signals to keep: Root Cause Assist cuts resolution time to 0.55x for the 39% of eligible incidents that use it; Smart Test Selection lifts pipeline success 1.2x and cuts time to deploy 25% (ship it); Slack + PagerDuty users acknowledge in 0.4x the time; the quarter-close promotion lifted invites 1.5x.
- **Evidence:** H1-H11; `-- EVAL Q20` (headline numbers).
- **Context needed:** all guides.
- **Grading:** full credit for at least four risks with supporting numbers and at least one recommended action. Partial credit for risks without numbers. Wrong: a generic list not grounded in the data.
