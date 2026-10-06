# Tallyboard (sass) — 20-question eval

- **Data:** `data/verify-sass` (full fidelity: 10,000 users, 9,995 with events, 4,547 new signups, 300 companies, 1,067,548 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-06
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query in `dungeons/vertical/sass/sass.sql` on that data.
- **Stories:** ids refer to the `stories` export in `sass.js` (H1-H11).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Does Root Cause Assist shorten incidents?
- **Prompt:** "We launched Root Cause Assist in July. Is it actually making incident resolution faster? By how much?"
- **Type:** trend
- **Answer:** Yes. Since the 2026-07-22 launch, Business and Enterprise resolutions that used Root Cause Assist (`resolution_method = ai_assist`) took **70.7 minutes on average from acknowledgement to resolution vs 129.7 minutes** for manual and runbook resolutions on the same plans, about **0.55x** (median 50.4 vs 92.8 minutes). Blended over all Business and Enterprise resolutions, average resolution time fell from 130.0 minutes before launch to 111.7 after (−14%), while Free and Team (no access) stayed flat (130.0 → 128.3). Accept 0.49x-0.61x.
- **Evidence:** H2-root-cause-assist-launch; Insights, `alert resolved`, average `resolution_time_mins`, breakdown `resolution_method`, filter `plan_tier` in (business, enterprise), after 2026-07-22; `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (launch date, plan scope), 03-event-dictionary.md (`resolution_time_mins`, `resolution_method`).
- **Grading:** must compare AI-assisted to non-assisted resolutions on eligible plans, or use Free/Team as a control for the before/after. Wrong: comparing all resolutions before vs after launch across every plan (dilutes the effect); measuring trigger-to-ack time.

### Q2 — Root Cause Assist adoption
- **Prompt:** "How many incidents are resolved with Root Cause Assist? Is usage growing?"
- **Type:** segmentation
- **Answer:** Adoption **ramped for about four weeks and then leveled off at about 39%** of Business and Enterprise resolutions. Weekly share: 3.5% in the launch week (Jul 22-26), 12.2% (week of Jul 27), 21.6% (Aug 3), 30.9% (Aug 10), 37.4% (Aug 17), then 37-40% every week through the end of September (40.4% in the last partial week). From Aug 19 on, 38.7% of eligible resolutions use it; over the whole period since launch the share is 30.5%, by 1,322 users. It is no longer growing. Accept a ramp through mid-August and a plateau of 36%-42%.
- **Evidence:** H2-root-cause-assist-launch; Insights, `alert resolved`, filter plan and date, breakdown `resolution_method`, weekly; `-- EVAL Q2`.
- **Context needed:** 02-timeline.md (launch, opt-in), 04-metrics-and-tables.md (adoption definition).
- **Grading:** denominator is eligible (Business/Enterprise, post-launch) resolutions, and the answer must describe the shape (ramp then plateau). Wrong: share of all resolutions (much lower, because Free and Team cannot use it); "still growing steadily"; quoting only the 30.5% all-period average as the current rate.

### Q3 — Did Root Cause Assist speed up acknowledgement? (null)
- **Prompt:** "Since Root Cause Assist launched, are our Business and Enterprise customers acknowledging alerts faster too?"
- **Type:** null-hypothesis
- **Answer:** **No.** Average time from trigger to acknowledgement on Business and Enterprise plans was **16.6 minutes before launch and 16.4 after** (median 10.5 vs 10.4). Root Cause Assist acts after acknowledgement; it shortens resolution, not response. Accept "no meaningful change" (within ±5%).
- **Evidence:** `-- EVAL Q3`; Insights, `alert acknowledged`, average `response_time_mins`, filter plan, before vs after 2026-07-22.
- **Context needed:** 03-event-dictionary.md (what `response_time_mins` measures), 02-timeline.md.
- **Grading:** must check acknowledgement time directly. Wrong: "yes, incidents got faster" by citing resolution time.

### Q4 — Where do new signups stall in setup?
- **Prompt:** "Too many signups never finish setup. Is it everyone, or is there a segment that struggles?"
- **Type:** funnel
- **Answer:** **Azure companies.** 7-day onboarding completion (account created → cloud account connected → agent installed → dashboard created) is **32.2% for Azure** (406 of 1,263 signups) vs **62.8% for AWS, GCP, and multi-cloud** (AWS 62.1%, GCP 63.1%, multi-cloud 65.2%), about **0.51x**. Azure signups drop at both the cloud-connect step (76.3% vs 87-89%) and the agent-install step (53.1% vs 75-77% cumulative). Azure is 28% of signups; at parity about 387 more Azure signups would have finished setup. Accept a ratio of 0.45-0.60 and naming Azure.
- **Evidence:** H3-azure-onboarding-friction; Funnels, four onboarding steps, 7-day window, breakdown `cloud_provider`; `-- EVAL Q4`.
- **Context needed:** 03-event-dictionary.md (onboarding events), 04-metrics-and-tables.md (onboarding completion).
- **Grading:** must break down by cloud provider and give the gap. Wrong: blaming signup method or company size; reporting only the overall rate (about 54%).

### Q5 — Do GitHub signups onboard worse? (null)
- **Prompt:** "Engineers who sign up with GitHub seem flakier. Do they finish onboarding less often than Google signups?"
- **Type:** null-hypothesis
- **Answer:** **No.** 7-day onboarding completion is **54.6% for GitHub** (1,377 signups) vs **55.2% for Google** (1,579); the 0.6-point gap is noise (z ≈ −0.3). Email (53.5%, 941 signups) and SSO (52.6%, 650) are in the same range. Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q5`; Funnels onboarding steps, breakdown `signup_method`.
- **Context needed:** 03-event-dictionary.md.
- **Grading:** must check the data and treat the small gaps as noise. Wrong: "yes, GitHub is lower"; ranking methods without a significance check.

### Q6 — Do chat and paging integrations matter?
- **Prompt:** "Does connecting Slack and PagerDuty actually speed up incident response?"
- **Type:** segmentation
- **Answer:** Yes, for acknowledgement, and the effect starts when the second integration goes live. Users who configured **both Slack and PagerDuty** acknowledge alerts in **11.4 minutes on average vs 27.4 minutes** for everyone else (about 0.42x; median 7.9 vs 19.3). Among customers who joined before June 4 (whose integrations predate the window; their in-window `integration configured` events are reconfigurations) it is **10.9 vs 27.3 minutes (0.40x)**. The within-user test is new signups who connect both during the window: their alerts took **25.9 minutes before the second integration was live and 10.4 minutes after (0.40x)**, and their pre-connection time matches new signups who never connect both (27.5 minutes). So the gap is caused by the connection, not by which teams connect. Resolution time after acknowledgement does not change (128.5 vs 130.2 minutes for non-AI resolutions). 2,825 users (38% of users who get alerts) have both. Accept 0.36x-0.46x for acknowledgement, a before/after drop for new users, and "no difference" for resolution.
- **Evidence:** H4-slack-pagerduty-response; Insights, `alert acknowledged`, average `response_time_mins`, breakdown by a cohort "did integration configured where integration_type = slack AND integration configured where integration_type = pagerduty", optional filter `customer_since` before 2026-06-04; before/after per new user; `-- EVAL Q6`.
- **Context needed:** 03-event-dictionary.md (integrations, `response_time_mins`), 00-manifest.md (`customer_since`).
- **Grading:** must build the both-integrations cohort and separate acknowledgement from resolution. Full credit also checks before vs after connection (or otherwise addresses selection). Wrong: "integrated teams resolve incidents faster" (resolution does not change); using only one of the two integrations; "it is only selection" (the before/after shows the drop).

### Q7 — Response time by company size
- **Prompt:** "How quickly do customers acknowledge alerts, and does it differ by company size?"
- **Type:** funnel
- **Answer:** Median time to acknowledge per alert: **enterprise 8.3 minutes, mid-market 14.0, SMB 13.8, startup 20.7**. Enterprise is about **0.60x** and startups about **1.49x** the SMB/mid-market time. Accept enterprise 0.54x-0.66x and startup 1.35x-1.65x.
- **Evidence:** H10-response-time-by-company-size; Funnels, `alert triggered` → `alert acknowledged`, hold `alert_id` constant, median time to convert, breakdown `company_size`; `-- EVAL Q7`.
- **Context needed:** 01-business.md (company sizes), 04-metrics-and-tables.md (MTTA).
- **Grading:** must measure per alert (same `alert_id`), median preferred. Wrong: unique-user funnel time that pairs a trigger with an unrelated later acknowledgement.

### Q8 — Are we paging people too much?
- **Prompt:** "Our SRE advisory board says alert noise is a problem. Is there evidence people ignore alerts when they get a lot of them?"
- **Type:** segmentation
- **Answer:** Yes. Acknowledgement rate by alerts received in the window: **1-6 alerts 86.4%, 7-12 86.0%**, then it falls: 13-18 77.5%, 19-24 64.1%, 25-29 49.6%, and **about 43% at 30+** (30-44: 43.2%, 45+: 43.1%). Roughly half of the would-be acknowledgements are lost for the heaviest recipients (0.50x vs the light group). The decline starts above about 12 alerts and levels off at about 30. 1,051 users (14% of alert recipients) get 30+ alerts and receive 36% of all alerts. Accept a description of a decline starting near 12 and a floor near 30, with rates within ±3 points.
- **Evidence:** H11-alert-fatigue; Funnels, `alert triggered` → `alert acknowledged`, totals, hold `alert_id`, breakdown by a cohort on alert count; `-- EVAL Q8`.
- **Context needed:** 01-business.md (goal 4), 04-metrics-and-tables.md (acknowledgement rate).
- **Grading:** must show the rate by volume band, not just a correlation. Wrong: "a cliff at N alerts"; unique-user funnel rates (most users acknowledge at least one alert).

### Q9 — What predicts new-user retention?
- **Prompt:** "Is there something new users do in their first week that predicts whether they stick around?"
- **Type:** retention
- **Answer:** **Inviting teammates in the first 7 days, with 2+ invites as the practical bar.** Day-30 retention (any activity in days 30-36) is **57.6% for users with 2+ first-week invites vs 21.0%** for users with 0-1 (about **2.7x**). Retention rises with each invite: 0 invites 19.8%, 1 invite 25.8%, 2 invites 51.9%, 3 invites 65.3%, 4+ 69.2%; the biggest step is from 1 to 2. Finishing setup also matters: users who reached `dashboard created` retain at 32.5% vs 20.5% at day 30 (90.0% vs 41.3% at day 7), and the invite effect holds within both groups (onboarded: 68.2% vs 26.1%; not onboarded: 47.0% vs 14.7%). Among onboarded users the ramp is 25.1% (0 invites), 37.9% (1), 68.2% (2+). 84% of new users (signups through Aug 25) fall below 2 invites. Accept 2.2x-3.2x for 2+ vs fewer, a rising pattern, and mention of setup completion as a second factor.
- **Evidence:** H5-first-week-team-activation; Retention, `account created` → any event, cohort on first-week `teammate invited` count, optional filter "did dashboard created"; `-- EVAL Q9`.
- **Context needed:** 01-business.md (activation goal), 04-metrics-and-tables.md (retention definition).
- **Grading:** must define the behavior from the first week only and show the invite gradient. Wrong: using invites over the whole window (leaks the outcome); claiming invites are the only factor without checking setup completion; "a hard cliff, nothing below 2 matters".

### Q10 — Is Smart Test Selection working?
- **Prompt:** "Should we ship Smart Test Selection to everyone? What did the test show?"
- **Type:** funnel
- **Answer:** Yes. Since 2026-07-15, **81.0% of Smart Selection pipeline runs succeed and deploy vs 68.1% for Control** (about **1.19x**, 26,570 vs 26,313 runs), and the median time from run to deploy is **22.6 vs 29.9 minutes** (0.75x). Users in both arms run the same number of pipelines (7.6 vs 7.7 per user), so the gain is per run, not more runs. The split is even (3,486 vs 3,423 users). Accept 1.08x-1.32x for success and 0.68x-0.83x for time.
- **Evidence:** H6-smart-test-selection-experiment; Funnels `deployment pipeline run` → `service deployed`, totals, hold `deploy_id`, 1-day window, breakdown `Experiment: Smart Test Selection` (or Insights share of `pipeline_status = success`); `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (test start and arms), 03-event-dictionary.md (`deploy_id`, `pipeline_status`).
- **Grading:** must compare per run within the test window. Wrong: unique-user funnel conversion (almost every user deploys at least once, which hides the gap); comparing before vs after July 15 for everyone.

### Q11 — Late-August deploy failures
- **Prompt:** "Pipeline failures spiked for a few days in late August. What happened, and how many deploys did customers lose?"
- **Type:** external-join
- **Answer:** The **2026-08-25 to 2026-08-27 hosted CI runner incident in us-east**. `ci_runner_health_daily` shows `runner_status = major_outage` for us-east only, `infra_error_rate` ≈ 0.61 (vs under 1% normally), and p95 queue time near 2,000 seconds (vs under 70). In Mixpanel, us-east pipeline success fell to **31.2%** on those days from 75.2% on the surrounding days, while the other regions stayed at 75.7% (75.0% around). Relative to the other regions, us-east ran at **0.41x** its normal success rate. About **335 deploys** did not happen (750 us-east runs on incident days). Accept 0.35-0.47 and 280-400 lost deploys.
- **Evidence:** H7-ci-runner-incident; Insights `deployment pipeline run`, share `pipeline_status = success`, daily, breakdown `runner_region`; warehouse join on date and `runner_region`; `-- EVAL Q11`.
- **Context needed:** 02-timeline.md (incident dates), 04-metrics-and-tables.md (`ci_runner_health_daily`), 03-event-dictionary.md (`runner_region`).
- **Grading:** must name the incident, the region, the dates, and a size. Wrong: blaming the Smart Test Selection test (both arms were hit alike) or customer code; saying all regions failed.

### Q12 — Was the incident only us-east? (null for the other regions)
- **Prompt:** "Did the August runner incident hurt pipelines in our other regions too?"
- **Type:** external-join
- **Answer:** **No.** During the incident, success rates in the other regions matched the surrounding days: **us-west 74.8% vs 74.5%, eu-west 77.1% vs 75.2%, ap-south 74.4% vs 76.0%**. Only us-east fell (31.2% vs 75.2%). The warehouse agrees: only us-east shows `major_outage`. Accept "only us-east" with other regions within ±3 points.
- **Evidence:** H7-ci-runner-incident; `-- EVAL Q12`.
- **Context needed:** 04-metrics-and-tables.md, 02-timeline.md.
- **Grading:** must check each region. Wrong: "all regions were affected".

### Q13 — What does a signup cost by channel?
- **Prompt:** "What are we paying per signup on each paid channel?"
- **Type:** external-join
- **Answer:** Spend per Mixpanel signup over the window: **LinkedIn Ads $413.85** (924 signups, $382,402), **G2 $204.70** (462 signups, $94,573), **paid search $143.89** (963 signups, $138,571). LinkedIn costs about **2.9x** paid search per signup and takes 62% of the $615,546 paid budget. Spend is a steady daily budget (LinkedIn $1,949-$3,950 per day, about 30% lower on weekends; never zero), so daily cost per signup swings with that day's signups; use the window or monthly totals. Platform-reported leads overstate Mixpanel signups by about 14% (2,682 vs 2,349), which understates CAC. Accept LinkedIn/search 2.6x-3.2x and dollar values within ±3%.
- **Evidence:** H8-paid-channel-economics; warehouse `paid_marketing_daily.spend_usd` joined to `account created` by date and `acquisition_channel`; `-- EVAL Q13`.
- **Context needed:** 04-metrics-and-tables.md (CAC definition, spend table), 01-business.md (channels).
- **Grading:** must divide by Mixpanel signups over a period, not quote a single day. Wrong: using `platform_reported_leads`; comparing total spend only.

### Q14 — Is LinkedIn worth it?
- **Prompt:** "Marketing says LinkedIn brings our best customers. Is it worth what we pay compared with search?"
- **Type:** attribution
- **Answer:** LinkedIn signups **do convert better**: 20.7% start a paid subscription vs 11.1% for paid search (G2 14.1%, outbound 17.5%, referral 16.0%, organic 15.0%). Comparing signups from the same weeks, LinkedIn converts at **about 1.8x** the paid-search rate. But a LinkedIn signup costs about 2.9x as much, so **cost per paying customer is still higher on LinkedIn: about $2,002 vs $1,295 for paid search and $1,455 for G2**. LinkedIn is not the cheapest way to win a paying customer. Accept a conversion ratio of 1.5x-2.3x and the conclusion that LinkedIn costs more per paying customer.
- **Evidence:** H8-paid-channel-economics; Funnels or Insights `account created` → `subscription started` by `acquisition_channel`; warehouse spend; `-- EVAL Q14`.
- **Context needed:** 01-business.md (channels, goal 2), 04-metrics-and-tables.md (cost per paying customer).
- **Grading:** must combine conversion and cost. Wrong: "LinkedIn is best" from conversion alone, or "LinkedIn is worst" from CAC alone.

### Q15 — Did the Team price rise hurt Team sales?
- **Prompt:** "We raised the Team price on August 17. Did fewer people buy Team after that?"
- **Type:** trend
- **Answer:** **Not clearly in subscription count; yes in seats.** Team's share of new subscriptions was **68.3% before and 64.1% after** (475 of 696 vs 239 of 373); the 4.2-point dip is not statistically significant (z ≈ −1.4), and in equal six-week windows Team went from 281 to 225 while Business stayed at 128, a dip inside normal variation at these volumes. What changed clearly is size: new Team subscriptions start with **8.6 seats on average vs 11.8 before (0.73x)**, while Business stayed at about 12 seats (12.3 → 12.2). Accept "no significant drop in count" (or "a small, inconclusive dip") plus a seat ratio of 0.65-0.80.
- **Evidence:** H9-team-price-change; Insights, `subscription started`, total and average `seats`, breakdown `plan`, weekly; `-- EVAL Q15`.
- **Context needed:** 02-timeline.md (price change), 01-business.md (plans).
- **Grading:** must look at seats, not only counts, and use Business as a control. Wrong: "no effect" (misses seats); "Team sales collapsed" (the count dip is not significant).

### Q16 — Did the price rise pay off?
- **Prompt:** "Even if seats dipped, did the higher Team price bring in more new Team MRR?"
- **Type:** external-join
- **Answer:** **No.** Joining subscriptions to `list_price_per_seat_usd`, new MRR per Team subscription fell from **$235.79 to $214.12 (0.91x)** despite the 25% price rise, because seats fell about 27%. New Team MRR per day fell from **$1,514 to $1,113 (−26%)**; Business barely moved ($1,656 → $1,597 per day, −4%; per subscription $554 → $548). The price rise did not pay off in new MRR. Accept a per-subscription ratio of 0.83-0.97 and "did not pay off".
- **Evidence:** H9-team-price-change; warehouse `subscription_bookings_daily` (or events joined to its prices on date and `plan`); `-- EVAL Q16`.
- **Context needed:** 04-metrics-and-tables.md (bookings table and caveats), 02-timeline.md.
- **Grading:** must use warehouse prices (price is not on events). Wrong: multiplying seats by $25 for the whole window; ignoring the seat drop.

### Q17 — Did the quarter-close promotion work?
- **Prompt:** "Sales ran a seat promotion for the last two weeks of Q3. Did it drive seat expansion?"
- **Type:** trend
- **Answer:** Yes, for the paid workspaces it targeted. On paid plans (Team, Business, Enterprise by `plan_tier` on the event), teammate invitations per dashboard view rose from **0.398 (Sep 1-15) to 0.588 (Sep 16-30), about 1.48x**; invites went from 4,006 to 5,751 while dashboard views were flat (10,069 vs 9,786). Free workspaces, which were not eligible, stayed flat (0.359 → 0.373, 1.04x), which rules out a general September trend. The number of paid users sending invites did not change (1,612 vs 1,552): existing inviters invited more people. Accept 1.35x-1.65x for paid plans and "no change" for Free.
- **Evidence:** H1-quarter-close-seat-push; Insights, `teammate invited` and `dashboard viewed`, daily, formula A/B, breakdown `plan_tier`; `-- EVAL Q17`.
- **Context needed:** 02-timeline.md (promotion dates and eligibility).
- **Grading:** must normalize by a stable activity measure or compare like periods, and should use Free as a control. Wrong: crediting Labor Day; reporting raw invites without a baseline; a blended all-plan lift without noting that Free did not move.

### Q18 — New bookings by month
- **Prompt:** "What did new self-serve bookings look like by month this summer, in new MRR?"
- **Type:** context
- **Answer:** From `subscription_bookings_daily`: **June $84,680 new MRR** (239 subscriptions; window starts June 4), **July $105,375** (331), **August $87,460** (257), **September $78,695** (235), October 1 $2,940 (7). By plan, Team was $40,580 / $51,600 / $37,645 / $32,075 and Business $44,100 / $53,775 / $49,815 / $46,620 for June-September. September is the softest full month. Both plans fell from July to September (Business −13%, Team −38%); Team fell more because new Team deals carried fewer seats after the August 17 price change, on top of fewer Team subscriptions. Accept within ±1%.
- **Evidence:** warehouse `subscription_bookings_daily`; `-- EVAL Q18`.
- **Context needed:** 04-metrics-and-tables.md (bookings table, self-serve only), 02-timeline.md.
- **Grading:** must use the warehouse (prices are not on events) and note the partial June. Wrong: counting Enterprise; reporting ARR as MRR; blaming the whole September dip on the Team price change (Business fell too).

### Q19 — Did the runner incident hurt alerting or dashboards? (null)
- **Prompt:** "During the August runner incident, did customers also respond to alerts more slowly or stop using dashboards?"
- **Type:** null-hypothesis
- **Answer:** **No.** On the incident days, average time to acknowledge was **18.7 minutes vs 20.0** on the surrounding days (daily averages ranged from 18.2 to 20.9 minutes outside the incident, so the incident days are inside normal variation), dashboard views were **1,018 per day vs 1,014**, and alerts were **903 per day vs 872**. Only pipelines were affected. Accept "no meaningful change" (within normal day-to-day range, about ±10%).
- **Evidence:** `-- EVAL Q19`; Insights, `alert acknowledged` average `response_time_mins` and `dashboard viewed` total, daily.
- **Context needed:** 02-timeline.md.
- **Grading:** must check the data. Wrong: "the whole platform was down"; "acknowledgement got faster during the incident" (noise).

### Q20 — What to worry about in Q4
- **Prompt:** "Looking at this data, what should we worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names most of these, with numbers:
  1. **Azure onboarding**: Azure signups finish setup at 32% vs 63% for other clouds; Azure is 28% of signups, about 387 lost setups this window. Fix the connect and agent-install steps for Azure.
  2. **Activation and setup**: 84% of new users invite fewer than 2 teammates in week one, and they retain at 21% vs 58% at day 30; signups who never finish setup retain at 41% at day 7 vs 90%. Push team invites and setup completion in onboarding.
  3. **Team pricing**: the August price rise shrank new Team deals from 11.8 to 8.6 seats; new MRR per Team subscription fell 9% and new Team MRR per day fell 26%. Revisit the price or seat packaging.
  4. **Alert fatigue**: 14% of alert recipients get 30+ alerts (36% of all alerts) and acknowledge only about 43% of them vs 86% for light recipients. Tune alert noise.
  5. **Paid acquisition mix**: LinkedIn takes 62% of the $615,546 paid budget; it converts 1.8x better than search but still costs about $2,002 per paying customer vs $1,295 (search) and $1,455 (G2).
  6. **Runner reliability**: the us-east incident cut success to 31% for three days and cost about 335 deploys.
  Positive signals to keep: Root Cause Assist cuts resolution time to 0.55x and settled at about 39% of eligible incidents after a four-week ramp; Smart Test Selection lifts pipeline success 1.19x and cuts time to deploy 25% (ship it); connecting Slack + PagerDuty cuts acknowledgement time to 0.4x (worth promoting to the 62% of alert recipients without both); the quarter-close promotion lifted paid-plan invites 1.48x.
- **Evidence:** H1-H11; `-- EVAL Q20` (headline numbers).
- **Context needed:** all guides.
- **Grading:** full credit for at least four risks with supporting numbers and at least one recommended action. Partial credit for risks without numbers. Wrong: a generic list not grounded in the data.
