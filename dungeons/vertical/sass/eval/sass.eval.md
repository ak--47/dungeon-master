# Tallyboard (sass) — 20-question eval

- **Data:** `data/verify-sass` (full fidelity: 10,000 users, 9,994 with events, 4,524 new signups, 300 companies, 977,563 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-06 (fix round on the engine rebase: engine-built signup times and SCD rows, weekday-heavy rhythm, believable invite and integration rates, 30-day funnel window for paid conversion)
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query in `dungeons/vertical/sass/sass.sql` on that data.
- **Stories:** ids refer to the `stories` export in `sass.js` (H1-H11).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Does Root Cause Assist shorten incidents?
- **Prompt:** "We launched Root Cause Assist in July. Is it actually making incident resolution faster? By how much?"
- **Type:** trend
- **Answer:** Yes. Since the 2026-07-22 launch, Business and Enterprise resolutions that used Root Cause Assist (`resolution_method = ai_assist`) took **71.6 minutes on average from acknowledgement to resolution vs 128.7 minutes** for manual and runbook resolutions on the same plans, about **0.56x** (median 51.1 vs 90.9 minutes). Blended over all Business and Enterprise resolutions, average resolution time fell from 132.8 minutes before launch to 110.1 after (−17%), while Free and Team (no access) stayed flat (130.1 → 129.9). Accept 0.49x-0.61x.
- **Evidence:** H2-root-cause-assist-launch; Insights, `alert resolved`, average `resolution_time_mins`, breakdown `resolution_method`, filter `plan_tier` in (business, enterprise), after 2026-07-22; `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (launch date, plan scope), 03-event-dictionary.md (`resolution_time_mins`, `resolution_method`).
- **Grading:** must compare AI-assisted to non-assisted resolutions on eligible plans, or use Free/Team as a control for the before/after. Wrong: comparing all resolutions before vs after launch across every plan (dilutes the effect); measuring trigger-to-ack time.

### Q2 — Root Cause Assist adoption
- **Prompt:** "How many incidents are resolved with Root Cause Assist? Is usage growing?"
- **Type:** segmentation
- **Answer:** Adoption **ramped for about four weeks and then leveled off at about 40%** of Business and Enterprise resolutions. Weekly share (Monday weeks): 3.3% in the launch week (Jul 22-26), 11.8% (week of Jul 27), 21.6% (Aug 3), 29.7% (Aug 10), 41.1% (Aug 17), then 39.6%-41.2% every week through the end of September (39.9% in the last partial week). From Aug 19 on, 40.6% of eligible resolutions use it; over the whole period since launch the share is 32.6%, by 1,412 users. It is no longer growing. Accept a ramp through mid-August and a plateau of 37%-43%.
- **Evidence:** H2-root-cause-assist-launch; Insights, `alert resolved`, filter plan and date, breakdown `resolution_method`, weekly; `-- EVAL Q2`.
- **Context needed:** 02-timeline.md (launch, opt-in), 04-metrics-and-tables.md (adoption definition).
- **Grading:** denominator is eligible (Business/Enterprise, post-launch) resolutions, and the answer must describe the shape (ramp then plateau). Wrong: share of all resolutions (much lower, because Free and Team cannot use it); "still growing steadily"; quoting only the 32.6% all-period average as the current rate.

### Q3 — Did Root Cause Assist speed up acknowledgement? (null)
- **Prompt:** "Since Root Cause Assist launched, are our Business and Enterprise customers acknowledging alerts faster too?"
- **Type:** null-hypothesis
- **Answer:** **No.** Average time from trigger to acknowledgement on Business and Enterprise plans was **19.4 minutes before launch and 19.2 after** (median 12.9 vs 12.7). Root Cause Assist acts after acknowledgement; it shortens resolution, not response. Accept "no meaningful change" (within ±5%).
- **Evidence:** `-- EVAL Q3`; Insights, `alert acknowledged`, average `response_time_mins`, filter plan, before vs after 2026-07-22.
- **Context needed:** 03-event-dictionary.md (what `response_time_mins` measures), 02-timeline.md.
- **Grading:** must check acknowledgement time directly. Wrong: "yes, incidents got faster" by citing resolution time.

### Q4 — Where do new signups stall in setup?
- **Prompt:** "Too many signups never finish setup. Is it everyone, or is there a segment that struggles?"
- **Type:** funnel
- **Answer:** **Azure companies.** 7-day onboarding completion (account created → cloud account connected → agent installed → dashboard created) is **33.3% for Azure** (427 of 1,283 signups) vs **61.8% for AWS, GCP, and multi-cloud** (AWS 62.3%, GCP 62.6%, multi-cloud 58.4%), about **0.54x**. Azure signups drop at both the cloud-connect step (76.6% vs 85-88%) and the agent-install step (54.3% vs 71-75% cumulative). Azure is 28% of signups; at parity about 366 more Azure signups would have finished setup. Accept a ratio of 0.48-0.62 and naming Azure.
- **Evidence:** H3-azure-onboarding-friction; Funnels, four onboarding steps, 7-day window, breakdown `cloud_provider`; `-- EVAL Q4`.
- **Context needed:** 03-event-dictionary.md (onboarding events), 04-metrics-and-tables.md (onboarding completion).
- **Grading:** must break down by cloud provider and give the gap. Wrong: blaming signup method or company size; reporting only the overall rate (about 54%).

### Q5 — Do SSO signups onboard worse? (null)
- **Prompt:** "SSO signups come from bigger companies with IT approval steps. Do they finish onboarding less often than everyone else?"
- **Type:** null-hypothesis
- **Answer:** **No.** 7-day onboarding completion is **54.7% for SSO** (680 signups) vs **53.6% for all other signup methods** (3,844 signups); the 1.1-point gap is noise (z ≈ +0.55). Email is also 54.7% (912 signups) and Google 55.6% (1,600). GitHub signups finish less often in this window (50.3% of 1,332 vs 55.2% for all other methods, z ≈ −3.0, and lower within both Azure and non-Azure signups); that gap is in the data and worth watching, but it does not bear on the SSO question. Accept "no meaningful difference for SSO".
- **Evidence:** `-- EVAL Q5`; Funnels onboarding steps, 7-day window, breakdown `signup_method`.
- **Context needed:** 03-event-dictionary.md.
- **Grading:** must check the data and treat the SSO gap as noise. Mentioning the lower GitHub rate is fine and not penalized. Wrong: "yes, SSO is lower"; ranking methods without a significance check.

### Q6 — Do chat and paging integrations matter?
- **Prompt:** "Does connecting Slack and PagerDuty actually speed up incident response?"
- **Type:** segmentation
- **Answer:** Yes, for acknowledgement, and the effect starts when the second integration goes live. Users who configured **both Slack and PagerDuty** acknowledge alerts in **11.5 minutes on average vs 27.2 minutes** for everyone else (about 0.42x; median 7.9 vs 19.3). Among customers who joined before June 4 (whose integrations predate the window; their in-window `integration configured` events are reconfigurations) it is **10.8 vs 27.3 minutes (0.39x)**. The within-user test is new signups who connect both during the window: their alerts took **26.8 minutes before the second integration was live and 10.8 minutes after (0.41x)**, and their pre-connection time matches new signups who never connect both (26.5 minutes). So the gap is caused by the connection, not by which teams connect. Resolution time after acknowledgement does not change (130.3 vs 130.3 minutes for non-AI resolutions). 1,755 users (24% of users who get alerts) have both. Accept 0.36x-0.46x for acknowledgement, a before/after drop for new users, and "no difference" for resolution.
- **Evidence:** H4-slack-pagerduty-response; Insights, `alert acknowledged`, average `response_time_mins`, breakdown by a cohort "did integration configured where integration_type = slack AND integration configured where integration_type = pagerduty", optional filter `customer_since` before 2026-06-04; before/after per new user; `-- EVAL Q6`.
- **Context needed:** 03-event-dictionary.md (integrations, `response_time_mins`), 00-manifest.md (`customer_since`).
- **Grading:** must build the both-integrations cohort and separate acknowledgement from resolution. Full credit also checks before vs after connection (or otherwise addresses selection). Wrong: "integrated teams resolve incidents faster" (resolution does not change); using only one of the two integrations; "it is only selection" (the before/after shows the drop).

### Q7 — Response time by company size
- **Prompt:** "How quickly do customers acknowledge alerts, and does it differ by company size?"
- **Type:** funnel
- **Answer:** Median time to acknowledge per alert: **enterprise 10.0 minutes, mid-market 16.5, SMB 16.6, startup 25.5**. Enterprise is about **0.60x** and startups about **1.54x** the pooled SMB/mid-market median. Accept enterprise 0.54x-0.66x and startup 1.35x-1.65x.
- **Evidence:** H10-response-time-by-company-size; Funnels, `alert triggered` → `alert acknowledged`, hold `alert_id` constant, median time to convert, breakdown `company_size`; `-- EVAL Q7`.
- **Context needed:** 01-business.md (company sizes), 04-metrics-and-tables.md (MTTA).
- **Grading:** must measure per alert (same `alert_id`), median preferred. Wrong: unique-user funnel time that pairs a trigger with an unrelated later acknowledgement.

### Q8 — Are we paging people too much?
- **Prompt:** "Our SRE advisory board says alert noise is a problem. Is there evidence people ignore alerts when they get a lot of them?"
- **Type:** segmentation
- **Answer:** Yes. Acknowledgement rate by alerts received in the window: **1-6 alerts 85.7%, 7-12 85.8%**, then it falls: 13-18 78.2%, 19-24 63.8%, 25-29 50.2%, and **about 43% at 30+** (30-44: 42.9%, 45+: 42.1%). Roughly half of the would-be acknowledgements are lost for the heaviest recipients (0.50x vs the 1-12 group: 42.6% vs 85.8%). The decline starts above about 12 alerts and levels off at about 30. 997 users (13% of alert recipients) get 30+ alerts and receive 34% of all alerts. Accept a description of a decline starting near 12 and a floor near 30, with rates within ±3 points.
- **Evidence:** H11-alert-fatigue; Funnels, `alert triggered` → `alert acknowledged`, totals, hold `alert_id`, breakdown by a cohort on alert count; `-- EVAL Q8`.
- **Context needed:** 01-business.md (goal 4), 04-metrics-and-tables.md (acknowledgement rate).
- **Grading:** must show the rate by volume band, not just a correlation. Wrong: "a cliff at N alerts"; unique-user funnel rates (most users acknowledge at least one alert).

### Q9 — What predicts new-user retention?
- **Prompt:** "Is there something new users do in their first week that predicts whether they stick around?"
- **Type:** retention
- **Answer:** **Inviting teammates in the first 7 days, with 2+ invites as the practical bar.** Day-30 retention (any activity in days 30-36) is **57.8% for users with 2+ first-week invites vs 20.0%** for users with 0-1 (about **2.9x**). Retention by first-week invites: 0 invites 19.0%, 1 invite 25.0%, 2 invites 56.3%, 3 invites 63.8%, 4+ 53.9%; the big step is from 1 to 2. Finishing setup also matters: users who reached `dashboard created` retain at 31.2% vs 17.8% at day 30 (86.5% vs 41.6% at day 7), and the invite effect holds within both groups (onboarded: 64.5% vs 25.8%; not onboarded: 49.2% vs 13.2%). Among onboarded users the ramp is 25.1% (0 invites), 35.5% (1, only 93 users), 64.5% (2+). 86% of new users (signups through Aug 25) fall below 2 invites. Accept 2.4x-3.4x for 2+ vs fewer, a rising pattern, and mention of setup completion as a second factor.
- **Evidence:** H5-first-week-team-activation; build the groups in **Funnels**: `account created` → `teammate invited` → `teammate invited`, 7-day conversion window, uniques (completed = 2+ first-week invites, dropped after step 2 = one, dropped after step 1 = none); save each group as a cohort from the funnel; then **Retention**, `account created` → any event, **custom bracket** day 30-36 (day 7-13 for D7; the standard day buckets do not give a 7-day bracket), breakdown by those cohorts, optional filter "did `dashboard created`"; `-- EVAL Q9`.
- **Context needed:** 01-business.md (activation goal), 04-metrics-and-tables.md (retention definition).
- **Grading:** must define the behavior from the first week only and show the invite gradient. Wrong: using invites over the whole window (leaks the outcome); claiming invites are the only factor without checking setup completion; "a hard cliff, nothing below 2 matters". Note for graders: part of the gap is engagement (heavier users both invite more and are likelier to be active in the day-30 week), so "invites predict retention" is correct and "invites alone cause the whole 2.9x" overstates it.

### Q10 — Is Smart Test Selection working?
- **Prompt:** "Should we ship Smart Test Selection to everyone? What did the test show?"
- **Type:** funnel
- **Answer:** Yes. Since 2026-07-15, **81.2% of Smart Selection pipeline runs succeed and deploy vs 67.4% for Control** (about **1.21x**, 28,411 vs 29,324 runs), and the median time from run to deploy is **22.6 vs 30.1 minutes** (0.75x). Users in both arms run the same number of pipelines (8.4 per user in each), so the gain is per run, not more runs. The split is even (3,386 Smart Selection vs 3,475 Control users with runs; the profile property and the `$experiment_started` events agree on both counts). Accept 1.08x-1.32x for success and 0.68x-0.83x for time.
- **Evidence:** H6-smart-test-selection-experiment; Funnels `deployment pipeline run` → `service deployed`, totals, hold `deploy_id`, 1-day window, breakdown `Experiment: Smart Test Selection` (or Insights share of `pipeline_status = success`); `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (test start and arms), 03-event-dictionary.md (`deploy_id`, `pipeline_status`).
- **Grading:** must compare per run within the test window. Wrong: unique-user funnel conversion (almost every user deploys at least once, which hides the gap); comparing before vs after July 15 for everyone.

### Q11 — Late-August deploy failures
- **Prompt:** "Pipeline failures spiked for a few days in late August. What happened, and how many deploys did customers lose?"
- **Type:** external-join
- **Answer:** The **2026-08-25 to 2026-08-27 hosted CI runner incident in us-east**. `ci_runner_health_daily` shows `runner_status = major_outage` for us-east only, `infra_error_rate` ≈ 0.60 (0.59-0.62, vs under 1% normally), and p95 queue time of 1,500-1,740 seconds (vs under 70). In Mixpanel, us-east pipeline success fell to **31.9%** on those days from 75.7% on the surrounding days (Aug 18-24 and Aug 28-Sep 3), while the other regions stayed at 76.0% (75.0% around). Relative to the other regions, us-east ran at **0.42x** its normal success rate. About **557 deploys** did not happen (1,242 us-east runs on incident days). Accept 0.35-0.47 and 480-640 lost deploys.
- **Evidence:** H7-ci-runner-incident; Insights `deployment pipeline run`, share `pipeline_status = success`, daily, breakdown `runner_region`; warehouse join on date and `runner_region`; `-- EVAL Q11`.
- **Context needed:** 02-timeline.md (incident dates), 04-metrics-and-tables.md (`ci_runner_health_daily`), 03-event-dictionary.md (`runner_region`).
- **Grading:** must name the incident, the region, the dates, and a size. Wrong: blaming the Smart Test Selection test (both arms were hit alike) or customer code; saying all regions failed; using `jobs_started` as the Mixpanel run count (it also counts scheduled and API-triggered jobs).

### Q12 — Was the incident only us-east? (null for the other regions)
- **Prompt:** "Did the August runner incident hurt pipelines in our other regions too?"
- **Type:** external-join
- **Answer:** **No.** Pooled, the other three regions succeeded on **76.0% of runs during the incident vs 75.0%** on the surrounding days (z ≈ +0.9). By region: **us-west 75.0% vs 75.3%, eu-west 75.9% vs 75.1%, ap-south 78.6% vs 73.8%** (ap-south has only 331 incident runs; its small rise is noise). Only us-east fell (31.9% vs 75.7%). The warehouse agrees: only us-east shows `major_outage`. Accept "only us-east" with no meaningful drop elsewhere.
- **Evidence:** H7-ci-runner-incident; `-- EVAL Q12`.
- **Context needed:** 04-metrics-and-tables.md, 02-timeline.md.
- **Grading:** must check each region or the pooled other regions. Wrong: "all regions were affected"; reading the small ap-south rise as an effect.

### Q13 — What does a signup cost by channel?
- **Prompt:** "What are we paying per signup on each paid channel?"
- **Type:** external-join
- **Answer:** Spend per Mixpanel signup over the window: **LinkedIn Ads $410.37** (925 signups, $379,593), **G2 $214.61** (439 signups, $94,214), **paid search $139.78** (984 signups, $137,544). LinkedIn costs about **2.9x** paid search per signup and takes 62% of the $611,352 paid budget. Spend is a steady daily budget (LinkedIn $1,981-$3,950 per day, about 30% below its daily average on weekends; never zero), so daily cost per signup swings with that day's signups; use the window or monthly totals. Platform-reported leads overstate Mixpanel signups by about 15% (2,695 vs 2,348), which understates CAC. Accept LinkedIn/search 2.6x-3.2x and dollar values within ±3%.
- **Evidence:** H8-paid-channel-economics; warehouse `paid_marketing_daily.spend_usd` joined to `account created` by date and `acquisition_channel`; `-- EVAL Q13`.
- **Context needed:** 04-metrics-and-tables.md (CAC definition, spend table), 01-business.md (channels).
- **Grading:** must divide by Mixpanel signups over a period, not quote a single day. Wrong: using `platform_reported_leads`; comparing total spend only.

### Q14 — Is LinkedIn worth it?
- **Prompt:** "Marketing says LinkedIn brings our best customers. Is it worth what we pay compared with search?"
- **Type:** attribution
- **Answer:** LinkedIn signups **do convert better than search**. With the Mixpanel funnel default 30-day conversion window, for signups from June 4 to August 31 (each has its full 30 days in the data), **19.0% of LinkedIn signups start a paid subscription vs 12.0% for paid search** (130 of 684 vs 89 of 742), about **1.6x** (z ≈ 3.7). Other channels: referral 16.3%, outbound 15.2%, organic 12.7%, G2 11.4%. But a LinkedIn signup costs about 2.9x as much, so **cost per paying customer is much higher on LinkedIn: about $2,166 vs $1,149 for paid search and $1,779 for G2** (June 4-August 31 spend divided by that period's paying signups). LinkedIn is the most expensive paid channel per paying customer. Accept a conversion ratio of 1.3x-2.2x and the conclusion that LinkedIn costs more per paying customer.
- **Evidence:** H8-paid-channel-economics; Funnels `account created` → `subscription started`, 30-day conversion window (Mixpanel default), date range Jun 4 - Aug 31, breakdown `acquisition_channel`; warehouse spend for the same days; `-- EVAL Q14`.
- **Context needed:** 01-business.md (channels, goal 2), 04-metrics-and-tables.md (cost per paying customer).
- **Grading:** must combine conversion and cost, with a stated conversion window. Wrong: "LinkedIn is best" from conversion alone, or "LinkedIn is worst" from CAC alone without noting that it converts better; comparing late-September signups that have not had their full window.

### Q15 — Did the Team price rise hurt Team sales?
- **Prompt:** "We raised the Team price on August 17. Did fewer people buy Team after that?"
- **Type:** trend
- **Answer:** **Not in subscription count; yes in seats.** The right test for count is Team's share of new subscriptions, with Business as the control: Team was **68.4% before and 69.6% after** (436 of 637 vs 275 of 395; z ≈ +0.4, no drop). In equal six-week windows Team went from 268 to 252 and Business from 125 to 112. New subscriptions on both plans fell in September (Mixpanel: Team 190 in July vs 157 in September, Business 93 vs 77), so a monthly Team chart dips, but the dip is not specific to Team. What changed clearly is size: new Team subscriptions start with **8.5 seats on average vs 12.1 before (0.70x)**, while Business moved much less (12.6 → 11.6 seats, within noise for about 120 post-change subscriptions). Accept "no significant drop in Team count" (or "Team count dipped, but it is not clearly separable from the overall decline in subscriptions") plus a seat ratio of 0.60-0.78.
- **Evidence:** H9-team-price-change; Insights, `subscription started`, total and average `seats`, breakdown `plan`, weekly; `-- EVAL Q15`.
- **Context needed:** 02-timeline.md (price change), 01-business.md (plans).
- **Grading:** must look at seats, not only counts, and use Business (or Team share) as a control. Wrong: "no effect" (misses seats); "Team sales collapsed"; a raw Team-count drop reported as price-driven without checking Business.

### Q16 — Did the price rise pay off?
- **Prompt:** "Even if seats dipped, did the higher Team price bring in more new Team MRR?"
- **Type:** external-join
- **Answer:** **No.** From `subscription_bookings_daily`, new MRR per Team subscription fell from **$248.87 to $217.31 (0.87x)** despite the 25% price rise, because seats per subscription fell about 30%. A 25% higher price at the old seat counts would have given about $311. Business, at an unchanged price, moved less per subscription ($579.91 → $532.86, −8%, mostly seat-count noise). Per day, new Team MRR fell from $1,517 to $1,351 (−11%) and Business from $1,661 to $1,460 (−12%), because fewer subscriptions started per day late in the quarter on both plans, so compare per subscription, not per day. Events joined to the list price give the same picture (Team $242.20 → $211.27 per subscription, 0.87x). The price rise did not pay off in new MRR. Accept a per-subscription ratio of 0.80-0.94 and "did not pay off".
- **Evidence:** H9-team-price-change; warehouse `subscription_bookings_daily` (or events joined to its prices on date and `plan`); `-- EVAL Q16`.
- **Context needed:** 04-metrics-and-tables.md (bookings table and caveats), 02-timeline.md.
- **Grading:** must use warehouse prices (price is not on events) and separate the per-subscription change from the overall volume decline. Wrong: multiplying seats by $25 for the whole window; ignoring the seat drop; crediting the whole per-day drop to the price change.

### Q17 — Did the quarter-close promotion work?
- **Prompt:** "Sales ran a seat promotion for the last two weeks of Q3. Did it drive seat expansion?"
- **Type:** trend
- **Answer:** Yes, for the paid workspaces it targeted. On paid plans (Team, Business, Enterprise by `plan_tier` on the event), teammate invitations per dashboard view rose from **0.081 (Sep 1-15) to 0.115 (Sep 16-30), about 1.42x**; invites went from 945 to 1,384 while dashboard views were flat (11,711 vs 12,086). Free workspaces, which were not eligible, stayed flat (0.138 → 0.141, 1.03x), which rules out a general September trend. The number of paid users sending invites did not change (752 vs 758): existing inviters invited more people. Accept 1.30x-1.65x for paid plans and "no change" for Free.
- **Evidence:** H1-quarter-close-seat-push; Insights, `teammate invited` and `dashboard viewed`, daily, formula A/B, breakdown `plan_tier`; `-- EVAL Q17`.
- **Context needed:** 02-timeline.md (promotion dates and eligibility).
- **Grading:** must normalize by a stable activity measure or compare like periods, and should use Free as a control. Wrong: crediting Labor Day; reporting raw invites without a baseline; a blended all-plan lift without noting that Free did not move.

### Q18 — New bookings by month
- **Prompt:** "What did new self-serve bookings look like by month this summer, in new MRR?"
- **Type:** context
- **Answer:** From `subscription_bookings_daily`: **June $79,165 new MRR** (213 subscriptions; window starts June 4), **July $100,615** (292), **August $103,920** (313), **September $76,725** (243), October 1 $4,045 (14). By plan, Team was $36,100 / $48,100 / $52,215 / $35,550 and Business $43,065 / $52,515 / $51,705 / $41,175 for June-September. August is the peak and September the softest full month (below even the partial June). Both plans fell from August to September (Team −32%, Business −20%), and both had fewer new subscriptions in September than in July or August (Team 163 vs 197 in July, Business 80 vs 95). Team fell further because its new deals carried fewer seats after the August 17 price change (Team new MRR per subscription $244 in July vs $218 in September; Business $553 vs $515). Accept within ±1%.
- **Evidence:** warehouse `subscription_bookings_daily`; `-- EVAL Q18`.
- **Context needed:** 04-metrics-and-tables.md (bookings table, self-serve only), 02-timeline.md.
- **Grading:** must use the warehouse (prices are not on events) and note the partial June. Wrong: counting Enterprise; reporting ARR as MRR; blaming the whole September dip on the Team price change (Business fell too, and subscription counts fell on both plans); expecting the table to match Mixpanel subscription counts exactly (billing includes a few checkouts Mixpanel missed and pre-invoice seat edits).

### Q19 — Did the runner incident hurt alerting or dashboards? (null)
- **Prompt:** "During the August runner incident, did customers also respond to alerts more slowly or stop using dashboards?"
- **Type:** null-hypothesis
- **Answer:** **No.** Usage is weekday-heavy, so compare the incident days (Tue Aug 25 to Thu Aug 27) with the same weekdays one week before and one week after (Aug 18-20 and Sep 1-3). Average time to acknowledge was **23.1 minutes vs 22.7** (+2%); daily averages on the six comparison days ranged from 21.8 to 24.0 minutes, and the incident days (22.4 to 24.1) sit at the same level. Dashboard views did not fall: **1,417 per day vs 1,447** (comparison days 1,386-1,502). Alerts were 1,307 per day vs 1,304. Only pipelines were affected. Accept "no meaningful change" (within normal day-to-day range, about ±10%).
- **Evidence:** `-- EVAL Q19`; Insights, `alert acknowledged` average `response_time_mins` and `dashboard viewed` total, daily.
- **Context needed:** 02-timeline.md.
- **Grading:** must check the data against comparable days. Wrong: "the whole platform was down"; "customers got slower"; "usage rose during the incident" (a comparison with all surrounding days, weekends included, shows higher incident-day volume only because Tuesday to Thursday are busy days).

### Q20 — What to worry about in Q4
- **Prompt:** "Looking at this data, what should we worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names most of these, with numbers:
  1. **Azure onboarding**: Azure signups finish setup at 33% vs 62% for other clouds; Azure is 28% of signups, about 366 lost setups this window. Fix the connect and agent-install steps for Azure.
  2. **Activation and setup**: 86% of new users invite fewer than 2 teammates in week one, and they retain at 20% vs 58% at day 30; signups who never finish setup retain at 42% at day 7 vs 87%. Push team invites and setup completion in onboarding.
  3. **Team pricing**: the August price rise shrank new Team deals from 12.1 to 8.5 seats; new MRR per Team subscription fell 13% instead of rising with the 25% price increase. Revisit the price or seat packaging.
  4. **Alert fatigue**: 13% of alert recipients get 30+ alerts (34% of all alerts) and acknowledge only about 43% of them vs 86% for light recipients. Tune alert noise.
  5. **Paid acquisition mix**: LinkedIn takes 62% of the $611,352 paid budget; it converts about 1.6x better than search (30-day window) but costs about $2,166 per paying customer vs $1,149 (search) and $1,779 (G2).
  6. **Runner reliability**: the us-east incident cut success to 32% for three days and cost about 557 deploys.
  7. **Softer September bookings**: new self-serve MRR fell from about $104k in August to $77k in September, on both plans.
  Positive signals to keep: Root Cause Assist cuts resolution time to 0.56x and settled at about 40% of eligible incidents after a four-week ramp; Smart Test Selection lifts pipeline success 1.21x and cuts time to deploy about 25% (ship it); connecting Slack + PagerDuty cuts acknowledgement time to 0.4x (worth promoting to the 76% of alert recipients without both); the quarter-close promotion lifted paid-plan invites 1.42x.
- **Evidence:** H1-H11; `-- EVAL Q20` (headline numbers).
- **Context needed:** all guides.
- **Grading:** full credit for at least four risks with supporting numbers and at least one recommended action. Partial credit for risks without numbers. Wrong: a generic list not grounded in the data.
