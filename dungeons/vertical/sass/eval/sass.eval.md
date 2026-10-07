# Tallyboard (sass) — 20-question eval

- **Data:** `data/verify-sass` (full fidelity: 10,000 users, 9,988 with events, 4,410 new signups, 3,669 companies, 968,269 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07 (final engine: one experiment exposure per user, soup hour and weekday shapes honored, identity-resolved warehouse measures; company-level plans with at most one self-serve subscription per company; about 300 long-standing customers and 3,365 newer workspaces; Team price change on 2026-08-03; 19% of new workspaces pay inside the window; fix round: per-channel and per-block purchase rotations, new inviters in the quarter-close promotion)
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query in `dungeons/vertical/sass/sass.sql` on that data.
- **Stories:** ids refer to the `stories` export in `sass.js` (H1-H11).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Does Root Cause Assist shorten incidents?
- **Prompt:** "We launched Root Cause Assist in July. Is it actually making incident resolution faster? By how much?"
- **Type:** trend
- **Answer:** Yes. Since the 2026-07-22 launch, Business and Enterprise resolutions that used Root Cause Assist (`resolution_method = ai_assist`) took **72.0 minutes on average from acknowledgement to resolution vs 131.9 minutes** for manual and runbook resolutions on the same plans, about **0.55x** (median 51.6 vs 93.5 minutes). Blended over all Business and Enterprise resolutions, average resolution time fell from 131.2 minutes before launch to 112.6 after (−14%), while Free and Team (no access) did not fall (127.1 → 131.5). Accept 0.50x-0.61x.
- **Evidence:** H2-root-cause-assist-launch; Insights, `alert resolved`, average `resolution_time_mins`, breakdown `resolution_method`, filter `plan_tier` in (business, enterprise), date range 2026-07-22 to 2026-10-01; `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (launch date, plan scope), 03-event-dictionary.md (`resolution_time_mins`, `resolution_method`).
- **Grading:** must compare AI-assisted to non-assisted resolutions on eligible plans, or use Free/Team as a control for the before/after. Wrong: comparing all resolutions before vs after launch across every plan (dilutes the effect); measuring trigger-to-ack time.

### Q2 — Root Cause Assist adoption
- **Prompt:** "How many incidents are resolved with Root Cause Assist? Is usage growing?"
- **Type:** segmentation
- **Answer:** Adoption **ramped for about four weeks and then leveled off at about 40%** of Business and Enterprise resolutions. Weekly share (Monday weeks): 3.5% in the launch week (Jul 22-26), 10.4% (week of Jul 27), 21.3% (Aug 3), 32.3% (Aug 10), 39.7% (Aug 17), then 36.8%-40.9% every week through the end of September (40.9% in the last partial week). From Aug 19 on, 39.8% of eligible resolutions use it; over the whole period since launch the share is 32.2%, by 1,601 users. It is no longer growing. Accept a ramp through mid-August and a plateau of 36%-44%.
- **Evidence:** H2-root-cause-assist-launch; Insights, `alert resolved`, filter `plan_tier` in (business, enterprise) and date from 2026-07-22, breakdown `resolution_method`, weekly; `-- EVAL Q2`.
- **Context needed:** 02-timeline.md (launch), 04-metrics-and-tables.md (adoption definition).
- **Grading:** denominator is eligible (Business/Enterprise, post-launch) resolutions, and the answer must describe the shape (ramp then plateau). Wrong: share of all resolutions (much lower, because Free and Team cannot use it); "still growing steadily"; quoting only the 32.2% all-period average as the current rate.

### Q3 — Did Root Cause Assist speed up page response? (null)
- **Prompt:** "Our CS team says Root Cause Assist also gets engineers to respond to pages faster. Since it launched, are Business and Enterprise customers acknowledging alerts any faster?"
- **Type:** null-hypothesis
- **Answer:** **No.** Business and Enterprise acknowledgements (`plan_tier` on the event) averaged **20.22 minutes before the 2026-07-22 launch and 20.43 after** (median 14.1 vs 14.1; 14,595 vs 22,554 acknowledgements; z = +0.90 on the mean, +0.89 on log minutes). Within the same users (3,147 users with acknowledgements on both sides) the change is −0.06 minutes (z = −0.23). By plan: Business 21.26 → 21.50 (z 0.86), Enterprise 17.44 → 17.44 (z 0.01). By company size, enterprise (z 0.88), mid-market (z 1.22), and startup (z −0.52) show nothing. SMB Business/Enterprise acknowledgements did get faster (28.77 → 25.42 minutes, z −3.27; within-user −2.78, z −2.17), but SMB accounts on Free and Team, which cannot use Root Cause Assist, also got faster over the same dates (27.20 → 25.24): newer, smaller accounts connect chat and paging tools during the window. Against that control the SMB difference-in-differences is −1.39 minutes (z −1.20), and every size has |z| ≤ 1.46 on the difference-in-differences. Root Cause Assist acts after acknowledgement: on the same plans, resolution time fell from 131.2 to 112.6 minutes. Accept "no meaningful difference" (within ±5%).
- **Evidence:** `-- EVAL Q3`; Insights, `alert acknowledged`, average (and median) `response_time_mins`, filter `plan_tier` in (business, enterprise), compare 2026-06-04 to 2026-07-21 with 2026-07-22 to 2026-10-01 (or a weekly line); optional breakdown by `plan_tier` or user property `company_size`, with Free/Team over the same dates as the control.
- **Context needed:** 03-event-dictionary.md (what `response_time_mins` measures), 02-timeline.md (launch date).
- **Grading:** must measure acknowledgement time, not resolution time, and conclude no change. Full credit if an SMB split is checked against Free/Team (same drop on plans without Root Cause Assist). Wrong: "yes, faster response" by citing resolution time; "Root Cause Assist speeds up response at SMB companies" from the SMB split alone without a control.

### Q4 — Where do new signups stall in setup?
- **Prompt:** "Too many signups never finish setup. Is it everyone, or is there a segment that struggles?"
- **Type:** funnel
- **Answer:** **Azure companies.** 7-day onboarding completion (account created → cloud account connected → agent installed → dashboard created) is **31.8% for Azure** (319 of 1,003 signups) vs **62.4% for AWS, GCP, and multi-cloud** (2,127 of 3,407; AWS 61.9%, GCP 62.7%, multi-cloud 64.4%), about **0.51x**. Azure trails at every step (step conversion given the prior step, Azure vs the other clouds): cloud account connected 79.0% vs 87.0% (0.91x), agent installed 71.1% vs 85.1% (0.84x), and **dashboard created 56.7% vs 84.3% (0.67x), the widest gap**. Azure is 23% of signups; at parity about 307 more Azure signups would have finished setup. Accept a ratio of 0.47-0.62 and naming Azure; full credit also reports the step gaps (any of the three steps may be named as a problem; the largest is agent installed → dashboard created).
- **Evidence:** H3-azure-onboarding-friction; Funnels, four onboarding steps, 7-day window, breakdown `cloud_provider`; `-- EVAL Q4`.
- **Context needed:** 03-event-dictionary.md (onboarding events), 04-metrics-and-tables.md (onboarding completion).
- **Grading:** must break down by cloud provider and give the gap. Wrong: blaming signup method, acquisition channel, or company size; reporting only the overall rate (55.5%).

### Q5 — Do LinkedIn signups finish setup less often? (null)
- **Prompt:** "LinkedIn brings us a lot of engineering leaders who don't do hands-on work. Do LinkedIn signups finish onboarding less often than everyone else?"
- **Type:** null-hypothesis
- **Answer:** **No.** 7-day onboarding completion is **55.4% for LinkedIn Ads signups** (935) vs **55.5% for all other channels** (3,475); there is no gap (z = −0.04). It holds within each cloud group (Azure 29.8% vs 32.4%, z −0.72; AWS/GCP/multi-cloud 63.1% vs 62.3%, z 0.39). By signup method, three of four splits show nothing (GitHub z −0.32, Google z 1.02, SSO z 1.38, the last two in LinkedIn's favor); email signups read 47.3% for LinkedIn vs 56.6% (182 vs 700 signups, z −2.25). With seven sub-splits, one at |z| ≈ 2.2 is expected about a third of the time by chance; it is below a multiple-comparison threshold (|z| 2.69 for seven tests) and has no counterpart in the other methods, so it is not a finding. No channel differs from the rest (g2_reviews 53.2%, outbound_sales 55.0%, organic 55.6%, paid_search 55.9%, referral 56.4%; every |z| ≤ 0.97). Accept "no meaningful difference". (LinkedIn signups do buy more often; see Q14. That is a later step.)
- **Evidence:** `-- EVAL Q5`; Funnels onboarding steps, 7-day window, breakdown `acquisition_channel`.
- **Context needed:** 03-event-dictionary.md, 01-business.md (channels).
- **Grading:** must check the data and conclude no channel effect. Mentioning the email sub-split is fine if it is treated as a multiple-comparison artifact. Wrong: "yes, LinkedIn signups onboard worse"; "LinkedIn signups who use email onboard worse" as a headline; ranking channels without a significance check.

### Q6 — Do chat and paging integrations matter?
- **Prompt:** "Does connecting Slack and PagerDuty actually speed up incident response?"
- **Type:** segmentation
- **Answer:** Yes, for acknowledgement, from the moment both are live. Among accounts set up before the window (customer_since before 2026-05-14), users whose profile `connected_integrations` holds **both Slack and PagerDuty** acknowledge alerts in **10.25 minutes on average vs 24.69 minutes** for everyone else (**0.42x**; 632 vs 4,173 users). Over all users the same profile cohort reads 16.12 vs 26.35 minutes (0.61x; median 9.8 vs 18.5), diluted because newer accounts connected the pair partway through the window. The within-user test is new signups who connect both during the window: their alerts took **33.54 minutes before the second integration was live and 13.32 minutes after (0.40x)**, and their pre-connection time matches new signups who never connect both (33.58 minutes). So the gap follows the connection, not which teams connect. Resolution time after acknowledgement does not change (130.4 vs 130.8 minutes for non-AI resolutions). Among alert recipients (7,460 users with at least one alert triggered), **1,211 (16.2%)** have both. Accept 0.35x-0.46x for the pre-window accounts (or 0.50x-0.66x for the all-user profile cohort with the dilution explained), a before/after drop for new users, and "no difference" for resolution.
- **Evidence:** H4-slack-pagerduty-response; Mixpanel (read 1): Insights, `alert acknowledged`, average `response_time_mins`, filter user property `customer_since` before 2026-05-14, breakdown by a cohort "user property `connected_integrations` contains slack AND contains pagerduty". The per-user before/after split at each new user's second `integration configured` has no direct Mixpanel report; it is a raw-data / SQL check. The closest Mixpanel view: the same Insights report filtered to `customer_since` on or after 2026-06-04, by week. The cohort's weekly average is 31-37 minutes in the second half of June (the first two weeks have under 20 acknowledgements), 25-29 in July, 23-26 in August, 20-22 in early September, and 16 and 13 in the last two weeks of September, while the rest stays at 31-36 (whole window 23.59 vs 33.58 minutes). The early weeks are diluted by alerts from before each member connected the pair. `-- EVAL Q6`.
- **Context needed:** 03-event-dictionary.md (`connected_integrations`, `integration configured`, `response_time_mins`), 01-business.md (teams connect tools in their first weeks), 00-manifest.md (`customer_since`).
- **Grading:** must build the both-integrations cohort and separate acknowledgement from resolution. Full credit also handles timing (accounts that connected during the window: the raw-data before/after per user, or the weekly trend of the new-signup cohort). Wrong: "integrated teams resolve incidents faster" (resolution does not change); using only one of the two integrations; building the cohort only from in-window `integration configured` events for older accounts (their tools were connected before June 4, so many never send one of each); "it is only selection" (the before/after shows the drop).

### Q7 — Response time by company size
- **Prompt:** "How quickly do customers acknowledge alerts, and does it differ by company size?"
- **Type:** funnel
- **Answer:** Median time to acknowledge per alert: **enterprise 11.6 minutes, mid-market 18.4, SMB 18.8, startup 26.9**. Enterprise is about **0.62x** and startups about **1.45x** the pooled SMB/mid-market median (18.5 minutes). Averages show the same order (15.9, 25.7, 26.1, 37.6). Accept enterprise 0.54x-0.66x and startup 1.35x-1.65x.
- **Evidence:** H10-response-time-by-company-size; Funnels, `alert triggered` → `alert acknowledged`, counting: totals, hold `alert_id` constant, median time to convert, breakdown `company_size`; `-- EVAL Q7`.
- **Context needed:** 01-business.md (company sizes), 04-metrics-and-tables.md (MTTA).
- **Grading:** must measure per alert (same `alert_id`, totals counting), median preferred. Wrong: unique-user funnel time that pairs a user's first trigger with an unrelated later acknowledgement.

### Q8 — Are we paging people too much?
- **Prompt:** "Our SRE advisory board says alert noise is a problem. Is there evidence people ignore alerts when they get a lot of them?"
- **Type:** segmentation
- **Answer:** Yes. Acknowledgement rate by alerts received in the window: **1-6 alerts 86.5%, 7-12 85.8%**, then it falls: 13-18 78.1%, 19-24 63.3%, 25-29 51.0%, and **about 43% at 30+** (30-44: 43.0%, 45+: 42.9%). Roughly half of the would-be acknowledgements are lost for the heaviest recipients (0.50x vs the 1-12 group: 42.9% vs 86.0%). The decline starts above about 12 alerts and levels off at about 30. 820 users (11.0% of alert recipients) get 30+ alerts and receive 29.3% of all alerts. Accept a description of a decline starting near 12 and a floor near 30, with rates within ±3 points.
- **Evidence:** H11-alert-fatigue; Funnels, `alert triggered` → `alert acknowledged`, totals, hold `alert_id`, breakdown by a cohort on alert count; `-- EVAL Q8`.
- **Context needed:** 01-business.md (goal 4), 04-metrics-and-tables.md (acknowledgement rate).
- **Grading:** must show the rate by volume band, not just a correlation. Wrong: "a cliff at N alerts"; unique-user funnel rates (most users acknowledge at least one alert).

### Q9 — What predicts new-user retention?
- **Prompt:** "Is there something new users do in their first week that predicts whether they stick around?"
- **Type:** retention
- **Answer:** **Inviting teammates in the first 7 days, with 2+ invites as the practical bar, and finishing setup.** Day-30 retention (any activity in days 30-36) is **50.3% for users with 2+ first-week invites vs 18.5%** for users with 0-1 (about **2.7x**). By first-week invites: 0 invites 15.0%, 1 invite 25.8%, 2 invites 51.8%, 3 invites 48.9%, 4+ 46.1% (89 users); the big step is from 1 to 2. Finishing setup matters as much: users who reached `dashboard created` retain at 38.5% vs 6.7% at day 30 (89.3% vs 37.7% at day 7); signups who never finish setup almost all stop within six weeks. The invite effect holds within both groups (onboarded: 72.6% vs 29.9%; not onboarded: 18.6% vs 4.0%). Among onboarded users the ramp is 24.7% (0 invites, 920 users), 40.3% (1, 464 users), 72.6% (2+, 350 users). 80.6% of new users (signups through Aug 25) fall below 2 invites. Accept 2.2x-3.2x for 2+ vs fewer, a rising pattern, and mention of setup completion as a second factor.
- **Evidence:** H5-first-week-team-activation; build the groups in **Funnels**: `account created` → `teammate invited` → `teammate invited`, 7-day conversion window, uniques (completed = 2+ first-week invites, dropped after step 2 = one, dropped after step 1 = none); save each group as a cohort from the funnel; then **Retention**, `account created` → any event, **custom bracket** day 30-36 (day 7-13 for D7; the standard day buckets do not give a 7-day bracket), breakdown by those cohorts, optional filter "did `dashboard created`"; `-- EVAL Q9`.
- **Context needed:** 01-business.md (activation goal), 04-metrics-and-tables.md (retention definition).
- **Grading:** must define the behavior from the first week only and show the invite gradient. Wrong: using invites over the whole window (leaks the outcome); claiming invites are the only factor without checking setup completion; "a hard cliff, nothing below 2 matters". Note for graders: part of the gap is engagement (heavier users both invite more and are likelier to be active in the day-30 week), so "invites predict retention" is correct and "invites alone cause the whole 2.7x" overstates it.

### Q10 — Is Smart Test Selection working?
- **Prompt:** "Should we ship Smart Test Selection to everyone? What did the test show?"
- **Type:** funnel
- **Answer:** Yes. Since 2026-07-15, **80.8% of Smart Selection pipeline runs succeed and deploy vs 67.3% for Control** (about **1.20x**, 44,982 vs 46,216 runs), and the median time from run to deploy is **22.5 vs 30.0 minutes** (0.75x). Users in both arms run about the same number of pipelines (12.5 vs 12.6 per user), so the gain is per run, not more runs. The split is even (3,594 Smart Selection vs 3,661 Control users; the profile property and the one `$experiment_started` event per user agree on both counts). Accept 1.08x-1.32x for success and 0.68x-0.83x for time.
- **Evidence:** H6-smart-test-selection-experiment; Funnels `deployment pipeline run` → `service deployed`, totals, hold `deploy_id`, 1-day window, **date range 2026-07-15 to 2026-10-01** (the full window dilutes the lift with pre-test runs), breakdown `Experiment: Smart Test Selection` (or Insights share of `pipeline_status = success` over the same dates); `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (test start and arms), 03-event-dictionary.md (`deploy_id`, `pipeline_status`).
- **Grading:** must compare per run within the test window. Wrong: unique-user funnel conversion (almost every user deploys at least once, which hides the gap); including runs before July 15; comparing before vs after July 15 for everyone.

### Q11 — Late-August deploy failures
- **Prompt:** "Pipeline failures spiked for a few days in late August. What happened, and how many deploys did customers lose?"
- **Type:** external-join
- **Answer:** The **2026-08-25 to 2026-08-27 hosted CI runner incident in us-east**. `ci_runner_health_daily` shows `runner_status = major_outage` for us-east only, `infra_error_rate` ≈ 0.60 (0.59-0.62, vs under 1% normally), and p95 queue time of 1,501-1,739 seconds (vs under 70). In Mixpanel, us-east pipeline success fell to **30.2%** on those days (28.9%-31.0% per day) from 74.8% on the surrounding days (Aug 18-24 and Aug 28-Sep 3), while the other regions moved from 75.0% to 74.7%. Relative to the other regions, us-east ran at **0.41x** its normal success rate. About **764 deploys** did not happen (1,722 us-east runs on incident days). Accept 0.35-0.46 and 650-880 lost deploys.
- **Evidence:** H7-ci-runner-incident; Insights `deployment pipeline run`, share `pipeline_status = success`, daily, breakdown `runner_region`; warehouse join on date and `runner_region`; `-- EVAL Q11`.
- **Context needed:** 02-timeline.md (incident dates), 04-metrics-and-tables.md (`ci_runner_health_daily`), 03-event-dictionary.md (`runner_region`).
- **Grading:** must name the incident, the region, the dates, and a size. Wrong: blaming the Smart Test Selection test (both arms were hit alike) or customer code; saying all regions failed; using `jobs_started` as the Mixpanel run count (it also counts scheduled and API-triggered jobs).

### Q12 — Was the incident only us-east? (null for the other regions)
- **Prompt:** "Did the August runner incident hurt pipelines in our other regions too?"
- **Type:** external-join
- **Answer:** **No.** Pooled, the other three regions succeeded on **74.7% of runs during the incident vs 75.0%** on the surrounding days (2,559 incident runs; z = −0.27, p ≈ 0.8). By region: **us-west 73.9% vs 75.1%, eu-west 76.1% vs 75.1%, ap-south 73.5% vs 74.3%**. ap-south has only 422 incident runs; over the 17 Tuesday-to-Thursday spans in the window (about 416 runs each) its success ran from 67.2% to 77.0% (median 73.1%), and the incident span sits inside that range. Only us-east fell far outside its range (30.2% vs 74.8%). The warehouse agrees: only us-east shows `major_outage`. Accept "only us-east" with no meaningful drop elsewhere.
- **Evidence:** H7-ci-runner-incident; `-- EVAL Q12`.
- **Context needed:** 04-metrics-and-tables.md, 02-timeline.md.
- **Grading:** must check each region or the pooled other regions. Wrong: "all regions were affected".

### Q13 — What does a signup cost by channel?
- **Prompt:** "What are we paying per signup on each paid channel?"
- **Type:** external-join
- **Answer:** Spend per Mixpanel signup over the window: **LinkedIn Ads $405.90** (935 signups, $379,515), **G2 $230.85** (408 signups, $94,188), **paid search $137.70** (1,001 signups, $137,833). LinkedIn costs about **2.9x** paid search per signup and takes 62% of the $611,535 paid budget. Spend is a paced daily budget on a weekday schedule (LinkedIn $1,400-$4,395 per day, about half its daily average on weekends; never zero). Weekend signups fall further than weekend spend, and smaller channels have days with no signups (G2 12 days, LinkedIn 1, paid search 0), so daily cost per signup swings; use the window or monthly totals. Platform-reported leads overstate Mixpanel signups by about 15% (2,692 vs 2,344), which understates CAC. Accept LinkedIn/search 2.6x-3.3x and dollar values within ±3%.
- **Evidence:** H8-paid-channel-economics; warehouse `paid_marketing_daily.spend_usd` joined to `account created` by date and `acquisition_channel`; `-- EVAL Q13`.
- **Context needed:** 04-metrics-and-tables.md (CAC definition, spend table), 01-business.md (channels).
- **Grading:** must divide by Mixpanel signups over a period, not quote a single day. Wrong: using `platform_reported_leads`; comparing total spend only.

### Q14 — Is LinkedIn worth it?
- **Prompt:** "Marketing says LinkedIn brings our best customers. Is it worth what we pay compared with search?"
- **Type:** attribution
- **Answer:** LinkedIn signups **do convert better than search**. With the Mixpanel funnel default 30-day conversion window, for signups from June 4 to August 31 (each has its full 30 days in the data), **18.6% of LinkedIn signups start a paid subscription vs 8.8% for paid search** (127 of 681 vs 67 of 763), about **2.1x** (z ≈ 5.5). Other channels: outbound 15.0%, referral 13.9%, organic 11.6%, G2 9.9%. (A signup who joins a colleague's workspace cannot start a subscription, so these per-signup rates sit below the share of new workspaces that pay; the channel comparison is unaffected.) But a LinkedIn signup costs about 2.9x as much, so **a paying customer costs about $2,211 from LinkedIn vs $1,524 from paid search** (June 4-August 31 spend divided by that period's paying signups), about 45% more. G2 is the most expensive per paying customer ($2,383), but it rests on only 29 paying signups. Paid search is the cheapest paid channel per paying customer. Accept a conversion ratio of 1.7x-2.6x and the conclusion that LinkedIn costs more per paying customer than search.
- **Evidence:** H8-paid-channel-economics; Funnels `account created` → `subscription started`, 30-day conversion window (Mixpanel default), date range Jun 4 - Aug 31, breakdown `acquisition_channel`; warehouse spend for the same days; `-- EVAL Q14`.
- **Context needed:** 01-business.md (channels, goal 2), 04-metrics-and-tables.md (cost per paying customer).
- **Grading:** must combine conversion and cost, with a stated conversion window. Wrong: "LinkedIn is best" from conversion alone, or "LinkedIn is worst" from CAC alone without noting that it converts better; comparing late-September signups that have not had their full window; a confident G2 ranking without noting its small count.

### Q15 — Did the Team price rise hurt Team sales?
- **Prompt:** "We raised the Team price on August 3. Did fewer people buy Team after that?"
- **Type:** trend
- **Answer:** **Not in subscription count; yes in seats.** Team new subscriptions held: 177 in the 60 days before the change vs 178 in the 60 days from Aug 3 (about 3.0 per day both times); in equal six-week windows (Jun 22 - Aug 2 vs Aug 3 - Sep 13) Team went from 123 to 129. Monthly Team subscriptions (Mixpanel): 88 in June (from June 4), 86 July, 92 August, 84 September. Business also held (119 before, 119 after; 57, 59, 62, 60 a month), so Team's share of new subscriptions did not move (59.8% vs 59.9%, z 0.03): buyers did not switch plans. What changed clearly is size: new Team subscriptions start with **8.38 seats on average vs 11.96 before (0.70x)**, while Business seats held (10.99 → 11.65). Accept "no drop in Team count" plus a seat ratio of 0.63-0.77.
- **Evidence:** H9-team-price-change; Insights, `subscription started`, total and average `seats`, breakdown `plan`, weekly; `-- EVAL Q15`.
- **Context needed:** 02-timeline.md (price change), 01-business.md (plans).
- **Grading:** must look at seats, not only counts, and check Team volume directly. Wrong: "no effect" (misses seats); "Team sales collapsed"; "the price rise pushed buyers to Business" (the plan mix did not move).

### Q16 — Did the price rise pay off?
- **Prompt:** "Even if seats dipped, did the higher Team price bring in more new Team MRR?"
- **Type:** external-join
- **Answer:** **No.** From `subscription_bookings_daily`, new MRR per Team subscription fell from **$251.41 to $222.37 (0.88x)** despite the 25% price rise, because billed seats per subscription fell by about 29% (12.6 → 8.9). A 25% higher price at the old seat counts would have given about $314. Business, at an unchanged price, held steady per subscription ($513.98 → $535.75). Team subscriptions per day held (3.18 before, 3.17 after in billing), so new Team MRR per day also fell, from $800 to $704 (−12%). Events joined to the list price give the same picture (Team $239.21 → $209.55 per subscription, 0.88x). The price rise did not pay off in new MRR. Accept a per-subscription ratio of 0.79-0.96 and "did not pay off".
- **Evidence:** H9-team-price-change; warehouse `subscription_bookings_daily` (or events joined to its prices on date and `plan`); `-- EVAL Q16`.
- **Context needed:** 04-metrics-and-tables.md (bookings table and caveats), 02-timeline.md.
- **Grading:** must use warehouse prices (price is not on events) and compare per subscription (or per day with a check that volume held). Wrong: multiplying seats by $25 for the whole window; ignoring the seat drop; "the price rise paid off" from the higher list price alone.

### Q17 — Did the quarter-close promotion work?
- **Prompt:** "Sales ran a seat promotion for the last two weeks of Q3. Did it drive seat expansion?"
- **Type:** trend
- **Answer:** Probably, as far as Mixpanel can show it: **Mixpanel does not track seats added to existing subscriptions** (04-metrics-and-tables.md: seat changes on existing subscriptions are billed outside the self-serve flow and are in neither Mixpanel nor `subscription_bookings_daily`), so teammate invitations are the best available proxy for seat expansion. On that proxy the promotion worked for paid workspaces. On paid plans (Team, Business, Enterprise by `plan_tier` on the event), teammate invitations per dashboard view rose from **0.0991 in the 30 days before (Aug 17 - Sep 15) to 0.1496 during the promotion (Sep 16-30), about 1.51x** (1.56x against Sep 1-15 alone: 0.0958 → 0.1496; invites 1,013 → 1,661 while dashboard views moved little, 10,578 vs 11,102). Free workspaces, which have no seats to discount, did not rise (0.152 → 0.146, 0.96x; against Sep 1-15, Free invites were flat at 658 → 664 while views rose, 0.93x), which rules out a general September trend. Both the number of paid users sending invites (857 in Sep 1-15, 1,104 during the promotion, +29%) and invites per inviting user (1.18 → 1.50) rose: the promotion brought in new inviters and got existing inviters to invite more people. Confirming actual seat expansion needs billing data on seat changes. Accept 1.35x-1.70x for paid plans (either baseline), "no meaningful change" for Free, and a statement that invites are a proxy.
- **Evidence:** H1-quarter-close-seat-push; Insights, `teammate invited` and `dashboard viewed`, daily, formula A/B, breakdown `plan_tier`, Sep 16-30 vs Aug 17 - Sep 15 (or Sep 1-15); `-- EVAL Q17`.
- **Context needed:** 02-timeline.md (promotion dates), 04-metrics-and-tables.md (seat expansion is not tracked).
- **Grading:** must normalize by a stable activity measure or compare like periods, should use Free as a control, and must say invites stand in for seats. Wrong: "Yes, seats grew 46%" (seats are not tracked); crediting Labor Day; reporting raw invites without a baseline; a blended all-plan lift without noting that Free did not move.

### Q18 — New bookings by month
- **Prompt:** "What did new self-serve bookings look like by month this summer, in new MRR?"
- **Type:** context
- **Answer:** From `subscription_bookings_daily`: **June $56,540 new MRR** (159 subscriptions; window starts June 4, so 27 days), **July $54,860** (154), **August $57,195** (163), **September $53,620** (153), October 1 $1,885 (7). Monthly totals moved within about ±4%; per day, June ran highest ($2,094 vs $1,770-$1,845 in July-September). The mix shifted: **Team new MRR fell every month, from $24,320 in June to $23,000, $21,825, and $19,375 in September (−20%)**, while Business new MRR held or rose ($32,220 / $31,860 / $35,370 / $34,245). Team subscriptions held (95, 93, 97, 90), so the Team decline is deal size after the August 3 price change: Team new MRR per subscription was $256 in June vs $215 in September. Business subscriptions held too (64, 61, 66, 63). Accept within ±1%.
- **Evidence:** warehouse `subscription_bookings_daily`; `-- EVAL Q18`.
- **Context needed:** 04-metrics-and-tables.md (bookings table, self-serve only), 02-timeline.md.
- **Grading:** must use the warehouse (prices are not on events), note the partial June, and split by plan. Wrong: counting Enterprise; reporting ARR as MRR; "bookings are flat, nothing changed" (misses the Team decline); "bookings collapsed"; expecting the table to match Mixpanel subscription counts exactly (billing includes a few checkouts Mixpanel missed and pre-invoice seat edits).

### Q19 — Did the runner incident spill over into alerting or dashboards? (null)
- **Prompt:** "During the August runner incident, did customers also stop acknowledging alerts or stop using dashboards?"
- **Type:** null-hypothesis
- **Answer:** **No.** Usage is weekday-heavy, so compare the incident days (Tue Aug 25 to Thu Aug 27) with the same weekdays one week before and one week after (Aug 18-20 and Sep 1-3). **66.1% of alerts triggered on incident days were acknowledged vs 64.8%** on the comparison days (3,003 vs 5,933 alerts; z = +1.15). Dashboard views did not fall: **1,232 per day vs 1,242** (−0.9%; incident days 1,213-1,265, comparison days 1,189-1,303; over all 17 Tuesday-to-Thursday spans in the window the daily average ran from 1,092 to 1,272, median 1,211). Queries: 919 per day vs 934. Acknowledgement was not slower either (23.6 vs 24.0 minutes on average; within the same users the change is −0.70 minutes, z = −0.62). Only pipelines were affected. Accept "no meaningful change".
- **Evidence:** `-- EVAL Q19`; Funnels `alert triggered` → `alert acknowledged` (hold `alert_id`) by trigger day, and Insights `dashboard viewed` total, daily.
- **Context needed:** 02-timeline.md.
- **Grading:** must check the data against comparable days. Wrong: "the whole platform was down"; "customers stopped working"; "usage rose during the incident" (a comparison with all surrounding days, weekends included, shows higher incident-day volume only because Tuesday to Thursday are busy days).

### Q20 — What to worry about in Q4
- **Prompt:** "Looking at this data, what should we worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names most of these, with numbers:
  1. **Team pricing and Team bookings**: the August 3 price rise cut new Team deals from 12.0 to 8.4 seats; new MRR per Team subscription fell 12% instead of rising with the 25% price increase, and monthly Team new MRR fell 20% from June to September while Team subscription counts held. Revisit the price or seat packaging.
  2. **Azure onboarding**: Azure signups finish setup at 32% vs 62% for other clouds; Azure is 23% of signups, about 307 lost setups this window. Azure trails at every setup step, most at agent installed → dashboard created (56.7% vs 84.3%). Fix the Azure setup path, starting with the first dashboard after the agent reports.
  3. **Activation and setup**: 81% of new users invite fewer than 2 teammates in week one, and they retain at 19% vs 50% at day 30; signups who never finish setup retain at 38% at day 7 vs 89% and almost all stop within six weeks. Push team invites and setup completion in onboarding.
  4. **Alert fatigue**: 11.0% of alert recipients get 30+ alerts (29.3% of all alerts) and acknowledge only about 43% of them vs 86% for light recipients. Tune alert noise.
  5. **Paid acquisition mix**: LinkedIn takes 62% of the $611,535 paid budget; it converts about 2.1x better than search (30-day window) but costs about $2,211 per paying customer vs $1,524 for search.
  6. **Runner reliability**: the us-east incident cut success to 30.2% for three days and cost about 764 deploys.
  Positive signals to keep: Root Cause Assist cuts resolution time to 0.55x and settled at about 40% of eligible incidents after a four-week ramp; Smart Test Selection lifts pipeline success 1.20x and cuts time to deploy about 25% (ship it); connecting Slack + PagerDuty cuts acknowledgement time to about 0.4x (worth promoting to the 84% of alert recipients without both); the quarter-close promotion lifted paid-plan invites about 1.5x and brought in new inviters; total new self-serve MRR held at $54k-$57k a month because Business bookings held.
- **Evidence:** H1-H11; `-- EVAL Q20` (headline numbers).
- **Context needed:** all guides.
- **Grading:** full credit for at least four risks with supporting numbers and at least one recommended action. Partial credit for risks without numbers. Wrong: a generic list not grounded in the data.
