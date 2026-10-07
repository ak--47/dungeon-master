# Tallyboard (sass) — 20-question eval

- **Data:** `data/verify-sass` (full fidelity: 10,000 users, 9,990 with events, 4,473 new signups, 300 companies, 982,290 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-06 (second engine-rebase fix round: signup days follow the weekday rhythm, established accounts' health history starts before the window, paid spend paced to the weekday signup rhythm)
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query in `dungeons/vertical/sass/sass.sql` on that data.
- **Stories:** ids refer to the `stories` export in `sass.js` (H1-H11).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Does Root Cause Assist shorten incidents?
- **Prompt:** "We launched Root Cause Assist in July. Is it actually making incident resolution faster? By how much?"
- **Type:** trend
- **Answer:** Yes. Since the 2026-07-22 launch, Business and Enterprise resolutions that used Root Cause Assist (`resolution_method = ai_assist`) took **70.8 minutes on average from acknowledgement to resolution vs 130.1 minutes** for manual and runbook resolutions on the same plans, about **0.54x** (median 52.4 vs 93.6 minutes). Blended over all Business and Enterprise resolutions, average resolution time fell from 131.0 minutes before launch to 110.8 after (−15%), while Free and Team (no access) stayed flat (128.7 → 130.5). Accept 0.49x-0.61x.
- **Evidence:** H2-root-cause-assist-launch; Insights, `alert resolved`, average `resolution_time_mins`, breakdown `resolution_method`, filter `plan_tier` in (business, enterprise), after 2026-07-22; `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (launch date, plan scope), 03-event-dictionary.md (`resolution_time_mins`, `resolution_method`).
- **Grading:** must compare AI-assisted to non-assisted resolutions on eligible plans, or use Free/Team as a control for the before/after. Wrong: comparing all resolutions before vs after launch across every plan (dilutes the effect); measuring trigger-to-ack time.

### Q2 — Root Cause Assist adoption
- **Prompt:** "How many incidents are resolved with Root Cause Assist? Is usage growing?"
- **Type:** segmentation
- **Answer:** Adoption **ramped for about four weeks and then leveled off at about 40%** of Business and Enterprise resolutions. Weekly share (Monday weeks): 2.5% in the launch week (Jul 22-26), 10.3% (week of Jul 27), 22.1% (Aug 3), 32.0% (Aug 10), 40.3% (Aug 17), then 37.8%-42.7% every week through the end of September (38.4% in the last partial week). From Aug 19 on, 39.7% of eligible resolutions use it; over the whole period since launch the share is 32.4%, by 1,454 users. It is no longer growing. Accept a ramp through mid-August and a plateau of 37%-43%.
- **Evidence:** H2-root-cause-assist-launch; Insights, `alert resolved`, filter plan and date, breakdown `resolution_method`, weekly; `-- EVAL Q2`.
- **Context needed:** 02-timeline.md (launch, opt-in), 04-metrics-and-tables.md (adoption definition).
- **Grading:** denominator is eligible (Business/Enterprise, post-launch) resolutions, and the answer must describe the shape (ramp then plateau). Wrong: share of all resolutions (much lower, because Free and Team cannot use it); "still growing steadily"; quoting only the 32.4% all-period average as the current rate.

### Q3 — Did Root Cause Assist speed up acknowledgement? (null)
- **Prompt:** "Since Root Cause Assist launched, are our Business and Enterprise customers acknowledging alerts faster too?"
- **Type:** null-hypothesis
- **Answer:** **No.** Average time from trigger to acknowledgement on Business and Enterprise plans was **19.0 minutes before launch and 19.4 after** (median 13.0 vs 12.9). If anything the average is slightly slower, and the difference is not significant (Welch z ≈ +1.5 on the mean, +0.7 on log minutes). Root Cause Assist acts after acknowledgement; it shortens resolution, not response. Accept "no meaningful change" (within ±5%).
- **Evidence:** `-- EVAL Q3`; Insights, `alert acknowledged`, average `response_time_mins`, filter plan, before vs after 2026-07-22.
- **Context needed:** 03-event-dictionary.md (what `response_time_mins` measures), 02-timeline.md.
- **Grading:** must check acknowledgement time directly. Wrong: "yes, incidents got faster" by citing resolution time.

### Q4 — Where do new signups stall in setup?
- **Prompt:** "Too many signups never finish setup. Is it everyone, or is there a segment that struggles?"
- **Type:** funnel
- **Answer:** **Azure companies.** 7-day onboarding completion (account created → cloud account connected → agent installed → dashboard created) is **31.9% for Azure** (412 of 1,290 signups) vs **63.2% for AWS, GCP, and multi-cloud** (2,010 of 3,183; AWS 63.6%, GCP 62.3%, multi-cloud 62.9%), about **0.51x**. Azure signups drop at both the cloud-connect step (76.3% vs 85-87%) and the agent-install step (53.0% vs 73-76% cumulative). Azure is 29% of signups; at parity about 403 more Azure signups would have finished setup. Accept a ratio of 0.48-0.62 and naming Azure.
- **Evidence:** H3-azure-onboarding-friction; Funnels, four onboarding steps, 7-day window, breakdown `cloud_provider`; `-- EVAL Q4`.
- **Context needed:** 03-event-dictionary.md (onboarding events), 04-metrics-and-tables.md (onboarding completion).
- **Grading:** must break down by cloud provider and give the gap. Wrong: blaming signup method or company size; reporting only the overall rate (about 54%).

### Q5 — Do SSO signups onboard worse? (null)
- **Prompt:** "SSO signups come from bigger companies with IT approval steps. Do they finish onboarding less often than everyone else?"
- **Type:** null-hypothesis
- **Answer:** **No.** 7-day onboarding completion is **54.5% for SSO** (607 signups) vs **54.1% for all other signup methods** (3,866 signups); the 0.4-point gap is noise (z ≈ +0.2). The other methods: email 57.1% (948 signups), Google 53.6% (1,615), GitHub 52.6% (1,303). Email is a little higher than the rest (z ≈ +2.0); with four methods compared, that is borderline and does not bear on the SSO question. Accept "no meaningful difference for SSO".
- **Evidence:** `-- EVAL Q5`; Funnels onboarding steps, 7-day window, breakdown `signup_method`.
- **Context needed:** 03-event-dictionary.md.
- **Grading:** must check the data and treat the SSO gap as noise. Mentioning the slightly higher email rate is fine and not penalized. Wrong: "yes, SSO is lower"; ranking methods without a significance check.

### Q6 — Do chat and paging integrations matter?
- **Prompt:** "Does connecting Slack and PagerDuty actually speed up incident response?"
- **Type:** segmentation
- **Answer:** Yes, for acknowledgement, and the effect starts when the second integration goes live. Users who configured **both Slack and PagerDuty** acknowledge alerts in **11.7 minutes on average vs 27.3 minutes** for everyone else (about 0.43x; median 7.9 vs 19.3). Among customers who joined before June 4 (whose integrations predate the window; their in-window `integration configured` events are reconfigurations) it is **10.8 vs 27.4 minutes (0.40x)**. The within-user test is new signups who connect both during the window: their alerts took **28.4 minutes before the second integration was live and 10.4 minutes after (0.37x)**, and their pre-connection time is close to new signups who never connect both (27.0 minutes). So the gap is caused by the connection, not by which teams connect. Resolution time after acknowledgement does not change (130.7 vs 129.9 minutes for non-AI resolutions). 1,707 users (23% of users who get alerts) have both. Accept 0.34x-0.46x for acknowledgement, a before/after drop for new users, and "no difference" for resolution.
- **Evidence:** H4-slack-pagerduty-response; Insights, `alert acknowledged`, average `response_time_mins`, breakdown by a cohort "did integration configured where integration_type = slack AND integration configured where integration_type = pagerduty", optional filter `customer_since` before 2026-06-04; before/after per new user; `-- EVAL Q6`.
- **Context needed:** 03-event-dictionary.md (integrations, `response_time_mins`), 00-manifest.md (`customer_since`).
- **Grading:** must build the both-integrations cohort and separate acknowledgement from resolution. Full credit also checks before vs after connection (or otherwise addresses selection). Wrong: "integrated teams resolve incidents faster" (resolution does not change); using only one of the two integrations; "it is only selection" (the before/after shows the drop).

### Q7 — Response time by company size
- **Prompt:** "How quickly do customers acknowledge alerts, and does it differ by company size?"
- **Type:** funnel
- **Answer:** Median time to acknowledge per alert: **enterprise 9.8 minutes, mid-market 17.0, SMB 16.7, startup 26.0**. Enterprise is about **0.58x** and startups about **1.54x** the pooled SMB/mid-market median. Accept enterprise 0.54x-0.66x and startup 1.35x-1.65x.
- **Evidence:** H10-response-time-by-company-size; Funnels, `alert triggered` → `alert acknowledged`, hold `alert_id` constant, median time to convert, breakdown `company_size`; `-- EVAL Q7`.
- **Context needed:** 01-business.md (company sizes), 04-metrics-and-tables.md (MTTA).
- **Grading:** must measure per alert (same `alert_id`), median preferred. Wrong: unique-user funnel time that pairs a trigger with an unrelated later acknowledgement.

### Q8 — Are we paging people too much?
- **Prompt:** "Our SRE advisory board says alert noise is a problem. Is there evidence people ignore alerts when they get a lot of them?"
- **Type:** segmentation
- **Answer:** Yes. Acknowledgement rate by alerts received in the window: **1-6 alerts 86.3%, 7-12 86.9%**, then it falls: 13-18 77.7%, 19-24 63.0%, 25-29 49.9%, and **about 43% at 30+** (30-44: 43.1%, 45+: 43.4%). Roughly half of the would-be acknowledgements are lost for the heaviest recipients (0.50x vs the 1-12 group: 43.2% vs 86.7%). The decline starts above about 12 alerts and levels off at about 30. 1,003 users (14% of alert recipients) get 30+ alerts and receive 35% of all alerts. Accept a description of a decline starting near 12 and a floor near 30, with rates within ±3 points.
- **Evidence:** H11-alert-fatigue; Funnels, `alert triggered` → `alert acknowledged`, totals, hold `alert_id`, breakdown by a cohort on alert count; `-- EVAL Q8`.
- **Context needed:** 01-business.md (goal 4), 04-metrics-and-tables.md (acknowledgement rate).
- **Grading:** must show the rate by volume band, not just a correlation. Wrong: "a cliff at N alerts"; unique-user funnel rates (most users acknowledge at least one alert).

### Q9 — What predicts new-user retention?
- **Prompt:** "Is there something new users do in their first week that predicts whether they stick around?"
- **Type:** retention
- **Answer:** **Inviting teammates in the first 7 days, with 2+ invites as the practical bar.** Day-30 retention (any activity in days 30-36) is **59.7% for users with 2+ first-week invites vs 20.4%** for users with 0-1 (about **2.9x**). Retention by first-week invites: 0 invites 19.0%, 1 invite 27.6%, 2 invites 61.2%, 3 invites 60.4%, 4+ 52.4%; the big step is from 1 to 2. Finishing setup also matters: users who reached `dashboard created` retain at 31.1% vs 19.3% at day 30 (88.2% vs 40.0% at day 7), and the invite effect holds within both groups (onboarded: 65.6% vs 25.9%; not onboarded: 53.1% vs 13.7%). Among onboarded users the ramp is 24.5% (0 invites), 47.3% (1, only 91 users), 65.6% (2+). 86% of new users (signups through Aug 25) fall below 2 invites. Accept 2.4x-3.4x for 2+ vs fewer, a rising pattern, and mention of setup completion as a second factor.
- **Evidence:** H5-first-week-team-activation; build the groups in **Funnels**: `account created` → `teammate invited` → `teammate invited`, 7-day conversion window, uniques (completed = 2+ first-week invites, dropped after step 2 = one, dropped after step 1 = none); save each group as a cohort from the funnel; then **Retention**, `account created` → any event, **custom bracket** day 30-36 (day 7-13 for D7; the standard day buckets do not give a 7-day bracket), breakdown by those cohorts, optional filter "did `dashboard created`"; `-- EVAL Q9`.
- **Context needed:** 01-business.md (activation goal), 04-metrics-and-tables.md (retention definition).
- **Grading:** must define the behavior from the first week only and show the invite gradient. Wrong: using invites over the whole window (leaks the outcome); claiming invites are the only factor without checking setup completion; "a hard cliff, nothing below 2 matters". Note for graders: part of the gap is engagement (heavier users both invite more and are likelier to be active in the day-30 week), so "invites predict retention" is correct and "invites alone cause the whole 2.9x" overstates it.

### Q10 — Is Smart Test Selection working?
- **Prompt:** "Should we ship Smart Test Selection to everyone? What did the test show?"
- **Type:** funnel
- **Answer:** Yes. Since 2026-07-15, **81.0% of Smart Selection pipeline runs succeed and deploy vs 67.3% for Control** (about **1.20x**, 28,534 vs 29,155 runs), and the median time from run to deploy is **22.5 vs 30.0 minutes** (0.75x). Users in both arms run about the same number of pipelines (8.3 vs 8.5 per user), so the gain is per run, not more runs. The split is even (3,435 Smart Selection vs 3,430 Control users with runs; the profile property and the `$experiment_started` events agree on both counts). Accept 1.08x-1.32x for success and 0.68x-0.83x for time.
- **Evidence:** H6-smart-test-selection-experiment; Funnels `deployment pipeline run` → `service deployed`, totals, hold `deploy_id`, 1-day window, breakdown `Experiment: Smart Test Selection` (or Insights share of `pipeline_status = success`); `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (test start and arms), 03-event-dictionary.md (`deploy_id`, `pipeline_status`).
- **Grading:** must compare per run within the test window. Wrong: unique-user funnel conversion (almost every user deploys at least once, which hides the gap); comparing before vs after July 15 for everyone.

### Q11 — Late-August deploy failures
- **Prompt:** "Pipeline failures spiked for a few days in late August. What happened, and how many deploys did customers lose?"
- **Type:** external-join
- **Answer:** The **2026-08-25 to 2026-08-27 hosted CI runner incident in us-east**. `ci_runner_health_daily` shows `runner_status = major_outage` for us-east only, `infra_error_rate` ≈ 0.60 (0.59-0.62, vs under 1% normally), and p95 queue time of 1,500-1,740 seconds (vs under 70). In Mixpanel, us-east pipeline success fell to **29.8%** on those days from 74.8% on the surrounding days (Aug 18-24 and Aug 28-Sep 3), while the other regions stayed at 74.4% (75.3% around). Relative to the other regions, us-east ran at **0.40x** its normal success rate. About **498 deploys** did not happen (1,130 us-east runs on incident days). Accept 0.35-0.47 and 420-580 lost deploys.
- **Evidence:** H7-ci-runner-incident; Insights `deployment pipeline run`, share `pipeline_status = success`, daily, breakdown `runner_region`; warehouse join on date and `runner_region`; `-- EVAL Q11`.
- **Context needed:** 02-timeline.md (incident dates), 04-metrics-and-tables.md (`ci_runner_health_daily`), 03-event-dictionary.md (`runner_region`).
- **Grading:** must name the incident, the region, the dates, and a size. Wrong: blaming the Smart Test Selection test (both arms were hit alike) or customer code; saying all regions failed; using `jobs_started` as the Mixpanel run count (it also counts scheduled and API-triggered jobs).

### Q12 — Was the incident only us-east? (null for the other regions)
- **Prompt:** "Did the August runner incident hurt pipelines in our other regions too?"
- **Type:** external-join
- **Answer:** **No.** Pooled, the other three regions succeeded on **74.4% of runs during the incident vs 75.3%** on the surrounding days (z ≈ −0.8). By region: **us-west 74.4% vs 75.4%, eu-west 76.3% vs 74.7%, ap-south 69.3% vs 76.8%**. ap-south has only 270 incident runs, and its 69.3% sits inside its normal range: over the 17 Tuesday-to-Thursday spans in the window (about 285 runs each), ap-south success ran from 65.9% to 80.2% (median 75.2%). Only us-east fell far outside its range (29.8% vs 74.8%). The warehouse agrees: only us-east shows `major_outage`. Accept "only us-east" with no meaningful drop elsewhere.
- **Evidence:** H7-ci-runner-incident; `-- EVAL Q12`.
- **Context needed:** 04-metrics-and-tables.md, 02-timeline.md.
- **Grading:** must check each region or the pooled other regions. Wrong: "all regions were affected"; reading the ap-south dip as an incident effect without checking its normal variation.

### Q13 — What does a signup cost by channel?
- **Prompt:** "What are we paying per signup on each paid channel?"
- **Type:** external-join
- **Answer:** Spend per Mixpanel signup over the window: **LinkedIn Ads $420.28** (903 signups, $379,515), **G2 $207.01** (455 signups, $94,188), **paid search $140.65** (980 signups, $137,833). LinkedIn costs about **3.0x** paid search per signup and takes 62% of the $611,535 paid budget. Spend is a paced daily budget on a weekday schedule (LinkedIn $1,400-$4,395 per day, about half its daily average on weekends; never zero). Weekend signups fall further than weekend spend, and small channels have days with no signups, so daily cost per signup swings; use the window or monthly totals. Platform-reported leads overstate Mixpanel signups by about 15% (2,692 vs 2,338), which understates CAC. Accept LinkedIn/search 2.6x-3.2x and dollar values within ±3%.
- **Evidence:** H8-paid-channel-economics; warehouse `paid_marketing_daily.spend_usd` joined to `account created` by date and `acquisition_channel`; `-- EVAL Q13`.
- **Context needed:** 04-metrics-and-tables.md (CAC definition, spend table), 01-business.md (channels).
- **Grading:** must divide by Mixpanel signups over a period, not quote a single day. Wrong: using `platform_reported_leads`; comparing total spend only.

### Q14 — Is LinkedIn worth it?
- **Prompt:** "Marketing says LinkedIn brings our best customers. Is it worth what we pay compared with search?"
- **Type:** attribution
- **Answer:** LinkedIn signups **do convert better than search**. With the Mixpanel funnel default 30-day conversion window, for signups from June 4 to August 31 (each has its full 30 days in the data), **18.9% of LinkedIn signups start a paid subscription vs 8.5% for paid search** (125 of 662 vs 61 of 715), about **2.2x** (z ≈ 5.6). Other channels: outbound 19.8%, G2 16.6%, referral 15.3%, organic 11.8%. But a LinkedIn signup costs about 3.0x as much, so **cost per paying customer is higher on LinkedIn: about $2,246 vs $1,674 for paid search and $1,257 for G2** (June 4-August 31 spend divided by that period's paying signups). LinkedIn is the most expensive paid channel per paying customer, and G2 the cheapest. Accept a conversion ratio of 1.7x-2.7x and the conclusion that LinkedIn costs more per paying customer.
- **Evidence:** H8-paid-channel-economics; Funnels `account created` → `subscription started`, 30-day conversion window (Mixpanel default), date range Jun 4 - Aug 31, breakdown `acquisition_channel`; warehouse spend for the same days; `-- EVAL Q14`.
- **Context needed:** 01-business.md (channels, goal 2), 04-metrics-and-tables.md (cost per paying customer).
- **Grading:** must combine conversion and cost, with a stated conversion window. Wrong: "LinkedIn is best" from conversion alone, or "LinkedIn is worst" from CAC alone without noting that it converts better; comparing late-September signups that have not had their full window.

### Q15 — Did the Team price rise hurt Team sales?
- **Prompt:** "We raised the Team price on August 17. Did fewer people buy Team after that?"
- **Type:** trend
- **Answer:** **Not in subscription count; yes in seats.** The right test for count is Team's share of new subscriptions, with Business as the control: Team was **66.7% before and 67.1% after** (419 of 628 vs 267 of 398; z ≈ +0.1, no drop). In equal six-week windows Team went from 268 to 242 and Business from 119 to 122. New subscriptions on both plans peaked in July (Mixpanel: Team 216 in July vs 169 in September, Business 98 vs 83), so a monthly Team chart dips after July, but the dip starts before the price change and is not specific to Team. What changed clearly is size: new Team subscriptions start with **8.6 seats on average vs 12.4 before (0.69x)**, while Business seats held (12.5 → 13.1, within noise for 131 post-change subscriptions). Accept "no significant drop in Team count" (or "Team count dipped, but it is not clearly separable from the overall decline in subscriptions") plus a seat ratio of 0.60-0.78.
- **Evidence:** H9-team-price-change; Insights, `subscription started`, total and average `seats`, breakdown `plan`, weekly; `-- EVAL Q15`.
- **Context needed:** 02-timeline.md (price change), 01-business.md (plans).
- **Grading:** must look at seats, not only counts, and use Business (or Team share) as a control. Wrong: "no effect" (misses seats); "Team sales collapsed"; a raw Team-count drop reported as price-driven without checking Business.

### Q16 — Did the price rise pay off?
- **Prompt:** "Even if seats dipped, did the higher Team price bring in more new Team MRR?"
- **Type:** external-join
- **Answer:** **No.** From `subscription_bookings_daily`, new MRR per Team subscription fell from **$254.47 to $221.13 (0.87x)** despite the 25% price rise, because seats per subscription fell about 30%. A 25% higher price at the old seat counts would have given about $318. Business, at an unchanged price, held steady per subscription ($575.18 → $593.21, +3%). Team subscriptions per day held (5.9 before, 6.0 after), so new Team MRR per day also fell, from $1,492 to $1,336 (−10%), while Business rose from $1,710 to $1,767 (+3%). Events joined to the list price give the same picture (Team $247.73 → $215.07 per subscription, 0.87x). The price rise did not pay off in new MRR. Accept a per-subscription ratio of 0.80-0.94 and "did not pay off".
- **Evidence:** H9-team-price-change; warehouse `subscription_bookings_daily` (or events joined to its prices on date and `plan`); `-- EVAL Q16`.
- **Context needed:** 04-metrics-and-tables.md (bookings table and caveats), 02-timeline.md.
- **Grading:** must use warehouse prices (price is not on events) and compare per subscription (or per day with a check that volume held). Wrong: multiplying seats by $25 for the whole window; ignoring the seat drop; "the price rise paid off" from the higher list price alone.

### Q17 — Did the quarter-close promotion work?
- **Prompt:** "Sales ran a seat promotion for the last two weeks of Q3. Did it drive seat expansion?"
- **Type:** trend
- **Answer:** Yes, for the paid workspaces it targeted. On paid plans (Team, Business, Enterprise by `plan_tier` on the event), teammate invitations per dashboard view rose from **0.084 (Sep 1-15) to 0.125 (Sep 16-30), about 1.49x**; invites went from 1,001 to 1,525 while dashboard views were flat (11,963 vs 12,230). Free workspaces, which were not eligible, stayed flat (0.137 → 0.141, 1.03x), which rules out a general September trend. The number of paid users sending invites rose only 5% (779 to 821), while invites per inviting user rose from 1.28 to 1.86: most of the lift is existing inviters inviting more people. Accept 1.30x-1.65x for paid plans and "no change" for Free.
- **Evidence:** H1-quarter-close-seat-push; Insights, `teammate invited` and `dashboard viewed`, daily, formula A/B, breakdown `plan_tier`; `-- EVAL Q17`.
- **Context needed:** 02-timeline.md (promotion dates and eligibility).
- **Grading:** must normalize by a stable activity measure or compare like periods, and should use Free as a control. Wrong: crediting Labor Day; reporting raw invites without a baseline; a blended all-plan lift without noting that Free did not move.

### Q18 — New bookings by month
- **Prompt:** "What did new self-serve bookings look like by month this summer, in new MRR?"
- **Type:** context
- **Answer:** From `subscription_bookings_daily`: **June $80,045 new MRR** (213 subscriptions; window starts June 4), **July $114,860** (323), **August $90,525** (263), **September $91,740** (261), October 1 $2,555 (9). By plan, Team was $33,200 / $55,820 / $41,970 / $39,225 and Business $46,845 / $59,040 / $48,555 / $52,515 for June-September. July is the peak; August and September are about equal, about 20% below July. Both plans had fewer new subscriptions after July (Team 223 in July vs 175 in September, Business 100 vs 86). Team fell further (−30% from July to September vs −11% for Business) because its new deals also carried fewer seats after the August 17 price change (Team new MRR per subscription $250 in July vs $224 in September; Business $590 vs $611). Accept within ±1%.
- **Evidence:** warehouse `subscription_bookings_daily`; `-- EVAL Q18`.
- **Context needed:** 04-metrics-and-tables.md (bookings table, self-serve only), 02-timeline.md.
- **Grading:** must use the warehouse (prices are not on events) and note the partial June. Wrong: counting Enterprise; reporting ARR as MRR; blaming the whole drop from July on the Team price change (it started before August 17, Business fell too, and subscription counts fell on both plans); expecting the table to match Mixpanel subscription counts exactly (billing includes a few checkouts Mixpanel missed and pre-invoice seat edits).

### Q19 — Did the runner incident hurt alerting or dashboards? (null)
- **Prompt:** "During the August runner incident, did customers also respond to alerts more slowly or stop using dashboards?"
- **Type:** null-hypothesis
- **Answer:** **No.** Usage is weekday-heavy, so compare the incident days (Tue Aug 25 to Thu Aug 27) with the same weekdays one week before and one week after (Aug 18-20 and Sep 1-3). Average time to acknowledge was **23.2 minutes vs 22.6** (+3%); daily averages on the six comparison days ranged from 21.0 to 23.5 minutes, and the incident days (22.6 to 23.9) sit at the same level. Dashboard views did not fall meaningfully: **1,415 per day vs 1,460** (−3%; comparison days 1,359-1,537, incident days 1,358-1,474). Alerts were 1,294 per day vs 1,310. Only pipelines were affected. Accept "no meaningful change" (within normal day-to-day range, about ±10%).
- **Evidence:** `-- EVAL Q19`; Insights, `alert acknowledged` average `response_time_mins` and `dashboard viewed` total, daily.
- **Context needed:** 02-timeline.md.
- **Grading:** must check the data against comparable days. Wrong: "the whole platform was down"; "customers got slower"; "usage rose during the incident" (a comparison with all surrounding days, weekends included, shows higher incident-day volume only because Tuesday to Thursday are busy days).

### Q20 — What to worry about in Q4
- **Prompt:** "Looking at this data, what should we worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names most of these, with numbers:
  1. **Azure onboarding**: Azure signups finish setup at 32% vs 63% for other clouds; Azure is 29% of signups, about 403 lost setups this window. Fix the connect and agent-install steps for Azure.
  2. **Activation and setup**: 86% of new users invite fewer than 2 teammates in week one, and they retain at 20% vs 60% at day 30; signups who never finish setup retain at 40% at day 7 vs 88%. Push team invites and setup completion in onboarding.
  3. **Team pricing**: the August price rise shrank new Team deals from 12.4 to 8.6 seats; new MRR per Team subscription fell 13% instead of rising with the 25% price increase. Revisit the price or seat packaging.
  4. **Alert fatigue**: 14% of alert recipients get 30+ alerts (35% of all alerts) and acknowledge only about 43% of them vs 87% for light recipients. Tune alert noise.
  5. **Paid acquisition mix**: LinkedIn takes 62% of the $611,535 paid budget; it converts about 2.2x better than search (30-day window) but costs about $2,246 per paying customer vs $1,674 (search) and $1,257 (G2).
  6. **Runner reliability**: the us-east incident cut success to 30% for three days and cost about 498 deploys.
  7. **Bookings below the July peak**: new self-serve MRR fell from $115k in July to about $91k in each of August and September; Team new MRR fell 30% over that span.
  Positive signals to keep: Root Cause Assist cuts resolution time to 0.54x and settled at about 40% of eligible incidents after a four-week ramp; Smart Test Selection lifts pipeline success 1.20x and cuts time to deploy about 25% (ship it); connecting Slack + PagerDuty cuts acknowledgement time to 0.4x (worth promoting to the 77% of alert recipients without both); the quarter-close promotion lifted paid-plan invites 1.49x.
- **Evidence:** H1-H11; `-- EVAL Q20` (headline numbers).
- **Context needed:** all guides.
- **Grading:** full credit for at least four risks with supporting numbers and at least one recommended action. Partial credit for risks without numbers. Wrong: a generic list not grounded in the data.
