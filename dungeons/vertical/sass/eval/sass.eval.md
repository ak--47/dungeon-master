# Tallyboard (sass) — 20-question eval

- **Data:** `data/verify-sass` (full fidelity: 10,000 users, 9,995 with events, 4,508 new signups, 300 companies, 957,970 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07 (engine round 7 rebase: sticky device fields, uncapped event weights; US holiday dip; pre-window integrations on the profile; account health for CSM-covered accounts only; warm start for accounts that joined just before the window)
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query in `dungeons/vertical/sass/sass.sql` on that data.
- **Stories:** ids refer to the `stories` export in `sass.js` (H1-H11).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Does Root Cause Assist shorten incidents?
- **Prompt:** "We launched Root Cause Assist in July. Is it actually making incident resolution faster? By how much?"
- **Type:** trend
- **Answer:** Yes. Since the 2026-07-22 launch, Business and Enterprise resolutions that used Root Cause Assist (`resolution_method = ai_assist`) took **72.6 minutes on average from acknowledgement to resolution vs 129.6 minutes** for manual and runbook resolutions on the same plans, about **0.56x** (median 51.2 vs 92.7 minutes). Blended over all Business and Enterprise resolutions, average resolution time fell from 130.1 minutes before launch to 110.6 after (−15%), while Free and Team (no access) stayed flat (129.8 → 129.7). Accept 0.50x-0.62x.
- **Evidence:** H2-root-cause-assist-launch; Insights, `alert resolved`, average `resolution_time_mins`, breakdown `resolution_method`, filter `plan_tier` in (business, enterprise), date range 2026-07-22 to 2026-10-01; `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (launch date, plan scope), 03-event-dictionary.md (`resolution_time_mins`, `resolution_method`).
- **Grading:** must compare AI-assisted to non-assisted resolutions on eligible plans, or use Free/Team as a control for the before/after. Wrong: comparing all resolutions before vs after launch across every plan (dilutes the effect); measuring trigger-to-ack time.

### Q2 — Root Cause Assist adoption
- **Prompt:** "How many incidents are resolved with Root Cause Assist? Is usage growing?"
- **Type:** segmentation
- **Answer:** Adoption **ramped for about four weeks and then leveled off at about 41%** of Business and Enterprise resolutions. Weekly share (Monday weeks): 2.5% in the launch week (Jul 22-26), 10.3% (week of Jul 27), 20.3% (Aug 3), 31.7% (Aug 10), 41.1% (Aug 17), then 39.6%-43.0% every week through the end of September (41.9% in the last partial week). From Aug 19 on, 41.5% of eligible resolutions use it; over the whole period since launch the share is 33.2%, by 1,255 users. It is no longer growing. Accept a ramp through mid-August and a plateau of 38%-44%.
- **Evidence:** H2-root-cause-assist-launch; Insights, `alert resolved`, filter `plan_tier` in (business, enterprise) and date from 2026-07-22, breakdown `resolution_method`, weekly; `-- EVAL Q2`.
- **Context needed:** 02-timeline.md (launch, opt-in), 04-metrics-and-tables.md (adoption definition).
- **Grading:** denominator is eligible (Business/Enterprise, post-launch) resolutions, and the answer must describe the shape (ramp then plateau). Wrong: share of all resolutions (much lower, because Free and Team cannot use it); "still growing steadily"; quoting only the 33.2% all-period average as the current rate.

### Q3 — Do Root Cause Assist incidents get acknowledged faster? (null)
- **Prompt:** "Our CS team says engineers who use Root Cause Assist also respond to pages faster. For Business and Enterprise incidents since adoption settled in mid-August, are the ones resolved with Root Cause Assist acknowledged any faster than the others?"
- **Type:** null-hypothesis
- **Answer:** **No.** For Business and Enterprise alerts resolved from 2026-08-19 on, alerts resolved with Root Cause Assist were acknowledged in **21.47 minutes on average (median 14.8) vs 21.42 (median 14.9)** for the other resolutions (3,532 vs 4,971 alerts; Welch z = +0.11 on the mean, −0.54 on log minutes). The null holds in the sub-splits: Business 23.06 vs 23.56 (z −0.80), Enterprise 18.02 vs 17.24 (z +1.06); by company size every |z| ≤ 1.28 (the smallest group, startups, 171 vs 243 alerts, z −1.28). Root Cause Assist acts after acknowledgement; it shortens resolution, not response. Context an analyst may also report: a plain before/after on all Business and Enterprise acknowledgements moves from 21.05 to 21.42 minutes (+1.7%; median 14.6 → 14.7), not significant (z +1.34 on the mean, +0.78 on log minutes); accounts that upgraded to Business during the window are slower on average (23.9 minutes after launch), which adds to the post-launch average. Accept "no meaningful difference" (within ±5%).
- **Evidence:** `-- EVAL Q3`; alert level (same `alert_id`): Funnels, `alert triggered` → `alert acknowledged` → `alert resolved`, hold `alert_id` constant, filter `plan_tier` in (business, enterprise), date range 2026-08-19 to 2026-10-01, breakdown `resolution_method` attributed to the `alert resolved` step, compare time from step 1 to step 2 (or read `response_time_mins` per `alert_id` in the raw data).
- **Context needed:** 03-event-dictionary.md (what `response_time_mins` measures; `alert_id` links the three events), 02-timeline.md.
- **Grading:** must compare acknowledgement time, not resolution time, and conclude no difference. Accept "no change" from the whole-window before/after read too. Wrong: "yes, RCA users respond faster" by citing resolution time; treating a sub-split as a finding.

### Q4 — Where do new signups stall in setup?
- **Prompt:** "Too many signups never finish setup. Is it everyone, or is there a segment that struggles?"
- **Type:** funnel
- **Answer:** **Azure companies.** 7-day onboarding completion (account created → cloud account connected → agent installed → dashboard created) is **33.7% for Azure** (441 of 1,307 signups) vs **61.7% for AWS, GCP, and multi-cloud** (1,975 of 3,201; AWS 61.3%, GCP 62.5%, multi-cloud 61.5%), about **0.55x**. Azure signups drop at both the cloud-connect step (76.6% vs 86-88%) and the agent-install step (55.3% vs 71-75% cumulative). Azure is 29% of signups; at parity about 365 more Azure signups would have finished setup. Accept a ratio of 0.48-0.62 and naming Azure.
- **Evidence:** H3-azure-onboarding-friction; Funnels, four onboarding steps, 7-day window, breakdown `cloud_provider`; `-- EVAL Q4`.
- **Context needed:** 03-event-dictionary.md (onboarding events), 04-metrics-and-tables.md (onboarding completion).
- **Grading:** must break down by cloud provider and give the gap. Wrong: blaming signup method or company size; reporting only the overall rate (about 54%).

### Q5 — Do SSO signups onboard worse? (null)
- **Prompt:** "SSO signups come from bigger companies with IT approval steps. Do they finish onboarding less often than everyone else?"
- **Type:** null-hypothesis
- **Answer:** **No.** 7-day onboarding completion is **52.2% for SSO** (619 signups) vs **53.8% for all other signup methods** (3,889 signups); the 1.6-point gap is noise (z ≈ −0.8). The other methods: email 52.8% (947 signups), Google 54.3% (1,577), GitHub 54.0% (1,365); no method differs from the rest (every |z| < 0.8). Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q5`; Funnels onboarding steps, 7-day window, breakdown `signup_method`.
- **Context needed:** 03-event-dictionary.md.
- **Grading:** must check the data and treat the SSO gap as noise. Wrong: "yes, SSO is lower"; ranking methods without a significance check.

### Q6 — Do chat and paging integrations matter?
- **Prompt:** "Does connecting Slack and PagerDuty actually speed up incident response?"
- **Type:** segmentation
- **Answer:** Yes, for acknowledgement, from the moment both are live. Among accounts set up before the window (customer_since before 2026-05-14), users whose profile `connected_integrations` holds **both Slack and PagerDuty** acknowledge alerts in **11.1 minutes on average vs 27.0 minutes** for everyone else (**0.41x**; 663 vs 3,954 users). Over all users the same profile cohort reads 14.7 vs 27.0 minutes (0.54x; median 9.3 vs 19.1), diluted because newer accounts connected the pair partway through the window. The within-user test is new signups who connect both during the window: their alerts took **26.6 minutes before the second integration was live and 11.7 minutes after (0.44x)**, and their pre-connection time is close to new signups who never connect both (27.2 minutes). So the gap follows the connection, not which teams connect. Resolution time after acknowledgement does not change (129.2 vs 130.0 minutes for non-AI resolutions). Among alert recipients (7,313 users with at least one alert triggered), **1,308 (17.9%)** have both. Accept 0.36x-0.46x for the pre-window accounts (or 0.48x-0.60x for the all-user profile cohort with the dilution explained), a before/after drop for new users, and "no difference" for resolution.
- **Evidence:** H4-slack-pagerduty-response; Insights, `alert acknowledged`, average `response_time_mins`, filter user property `customer_since` before 2026-05-14, breakdown by a cohort "user property `connected_integrations` contains slack AND contains pagerduty"; before/after per new user on the date of their second `integration configured`; `-- EVAL Q6`.
- **Context needed:** 03-event-dictionary.md (`connected_integrations`, `integration configured`, `response_time_mins`), 01-business.md (teams connect tools in their first weeks), 00-manifest.md (`customer_since`).
- **Grading:** must build the both-integrations cohort and separate acknowledgement from resolution. Full credit also handles timing (accounts that connected during the window, or a before/after per user). Wrong: "integrated teams resolve incidents faster" (resolution does not change); using only one of the two integrations; building the cohort only from in-window `integration configured` events for older accounts (their tools were connected before June 4, so many never send one of each); "it is only selection" (the before/after shows the drop).

### Q7 — Response time by company size
- **Prompt:** "How quickly do customers acknowledge alerts, and does it differ by company size?"
- **Type:** funnel
- **Answer:** Median time to acknowledge per alert: **enterprise 11.1 minutes, mid-market 18.5, SMB 18.8, startup 27.7**. Enterprise is about **0.60x** and startups about **1.49x** the pooled SMB/mid-market median (18.6 minutes). Accept enterprise 0.54x-0.66x and startup 1.35x-1.65x.
- **Evidence:** H10-response-time-by-company-size; Funnels, `alert triggered` → `alert acknowledged`, hold `alert_id` constant, median time to convert, breakdown `company_size`; `-- EVAL Q7`.
- **Context needed:** 01-business.md (company sizes), 04-metrics-and-tables.md (MTTA).
- **Grading:** must measure per alert (same `alert_id`), median preferred. Wrong: unique-user funnel time that pairs a trigger with an unrelated later acknowledgement.

### Q8 — Are we paging people too much?
- **Prompt:** "Our SRE advisory board says alert noise is a problem. Is there evidence people ignore alerts when they get a lot of them?"
- **Type:** segmentation
- **Answer:** Yes. Acknowledgement rate by alerts received in the window: **1-6 alerts 85.7%, 7-12 86.5%**, then it falls: 13-18 77.6%, 19-24 62.6%, 25-29 49.6%, and **about 43% at 30+** (30-44: 42.8%, 45+: 42.6%). Roughly half of the would-be acknowledgements are lost for the heaviest recipients (0.50x vs the 1-12 group: 42.8% vs 86.2%). The decline starts above about 12 alerts and levels off at about 30. 579 users (7.9% of alert recipients) get 30+ alerts and receive 22.5% of all alerts. Accept a description of a decline starting near 12 and a floor near 30, with rates within ±3 points.
- **Evidence:** H11-alert-fatigue; Funnels, `alert triggered` → `alert acknowledged`, totals, hold `alert_id`, breakdown by a cohort on alert count; `-- EVAL Q8`.
- **Context needed:** 01-business.md (goal 4), 04-metrics-and-tables.md (acknowledgement rate).
- **Grading:** must show the rate by volume band, not just a correlation. Wrong: "a cliff at N alerts"; unique-user funnel rates (most users acknowledge at least one alert).

### Q9 — What predicts new-user retention?
- **Prompt:** "Is there something new users do in their first week that predicts whether they stick around?"
- **Type:** retention
- **Answer:** **Inviting teammates in the first 7 days, with 2+ invites as the practical bar.** Day-30 retention (any activity in days 30-36) is **56.1% for users with 2+ first-week invites vs 21.1%** for users with 0-1 (about **2.7x**). Retention by first-week invites: 0 invites 17.0%, 1 invite 29.7%, 2 invites 54.3%, 3 invites 57.0%, 4+ 61.6% (86 users); the big step is from 1 to 2. Finishing setup also matters: users who reached `dashboard created` retain at 35.5% vs 18.4% at day 30 (86.8% vs 41.1% at day 7), and the invite effect holds within both groups (onboarded: 67.2% vs 28.0%; not onboarded: 42.6% vs 13.0%). Among onboarded users the ramp is 23.1% (0 invites, 917 users), 38.0% (1, 453 users), 67.2% (2+, 323 users). 81% of new users (signups through Aug 25) fall below 2 invites. Accept 2.3x-3.2x for 2+ vs fewer, a rising pattern, and mention of setup completion as a second factor.
- **Evidence:** H5-first-week-team-activation; build the groups in **Funnels**: `account created` → `teammate invited` → `teammate invited`, 7-day conversion window, uniques (completed = 2+ first-week invites, dropped after step 2 = one, dropped after step 1 = none); save each group as a cohort from the funnel; then **Retention**, `account created` → any event, **custom bracket** day 30-36 (day 7-13 for D7; the standard day buckets do not give a 7-day bracket), breakdown by those cohorts, optional filter "did `dashboard created`"; `-- EVAL Q9`.
- **Context needed:** 01-business.md (activation goal), 04-metrics-and-tables.md (retention definition).
- **Grading:** must define the behavior from the first week only and show the invite gradient. Wrong: using invites over the whole window (leaks the outcome); claiming invites are the only factor without checking setup completion; "a hard cliff, nothing below 2 matters". Note for graders: part of the gap is engagement (heavier users both invite more and are likelier to be active in the day-30 week), so "invites predict retention" is correct and "invites alone cause the whole 2.7x" overstates it.

### Q10 — Is Smart Test Selection working?
- **Prompt:** "Should we ship Smart Test Selection to everyone? What did the test show?"
- **Type:** funnel
- **Answer:** Yes. Since 2026-07-15, **80.6% of Smart Selection pipeline runs succeed and deploy vs 67.4% for Control** (about **1.20x**, 40,276 vs 40,402 runs), and the median time from run to deploy is **22.5 vs 30.0 minutes** (0.75x). Users in both arms run about the same number of pipelines (11.4 vs 11.3 per user), so the gain is per run, not more runs. The split is even (3,547 Smart Selection vs 3,572 Control users with runs; the profile property and the `$experiment_started` events agree on both counts). Accept 1.08x-1.32x for success and 0.68x-0.83x for time.
- **Evidence:** H6-smart-test-selection-experiment; Funnels `deployment pipeline run` → `service deployed`, totals, hold `deploy_id`, 1-day window, **date range 2026-07-15 to 2026-10-01** (the full window dilutes the lift with pre-test runs), breakdown `Experiment: Smart Test Selection` (or Insights share of `pipeline_status = success` over the same dates); `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (test start and arms), 03-event-dictionary.md (`deploy_id`, `pipeline_status`).
- **Grading:** must compare per run within the test window. Wrong: unique-user funnel conversion (almost every user deploys at least once, which hides the gap); including runs before July 15; comparing before vs after July 15 for everyone.

### Q11 — Late-August deploy failures
- **Prompt:** "Pipeline failures spiked for a few days in late August. What happened, and how many deploys did customers lose?"
- **Type:** external-join
- **Answer:** The **2026-08-25 to 2026-08-27 hosted CI runner incident in us-east**. `ci_runner_health_daily` shows `runner_status = major_outage` for us-east only, `infra_error_rate` ≈ 0.60 (0.59-0.62, vs under 1% normally), and p95 queue time of 1,501-1,739 seconds (vs under 70). In Mixpanel, us-east pipeline success fell to **29.1%** on those days (28.4%-30.4% per day) from 74.9% on the surrounding days (Aug 18-24 and Aug 28-Sep 3), while the other regions stayed at 75.9% (75.1% around). Relative to the other regions, us-east ran at **0.38x** its normal success rate. About **741 deploys** did not happen (1,591 us-east runs on incident days). Accept 0.33-0.45 and 630-850 lost deploys.
- **Evidence:** H7-ci-runner-incident; Insights `deployment pipeline run`, share `pipeline_status = success`, daily, breakdown `runner_region`; warehouse join on date and `runner_region`; `-- EVAL Q11`.
- **Context needed:** 02-timeline.md (incident dates), 04-metrics-and-tables.md (`ci_runner_health_daily`), 03-event-dictionary.md (`runner_region`).
- **Grading:** must name the incident, the region, the dates, and a size. Wrong: blaming the Smart Test Selection test (both arms were hit alike) or customer code; saying all regions failed; using `jobs_started` as the Mixpanel run count (it also counts scheduled and API-triggered jobs).

### Q12 — Was the incident only us-east? (null for the other regions)
- **Prompt:** "Did the August runner incident hurt pipelines in our other regions too?"
- **Type:** external-join
- **Answer:** **No.** Pooled, the other three regions succeeded on **75.9% of runs during the incident vs 75.1%** on the surrounding days (z ≈ +0.8). By region: **us-west 75.9% vs 74.6%, eu-west 75.1% vs 75.5%, ap-south 77.9% vs 75.6%**. ap-south has only 412 incident runs; over the 17 Tuesday-to-Thursday spans in the window (about 400 runs each) its success ran from 66.1% to 77.9% (median 73.4%), and the incident span sits at the top of that range. Only us-east fell far outside its range (29.1% vs 74.9%). The warehouse agrees: only us-east shows `major_outage`. Accept "only us-east" with no meaningful drop elsewhere.
- **Evidence:** H7-ci-runner-incident; `-- EVAL Q12`.
- **Context needed:** 04-metrics-and-tables.md, 02-timeline.md.
- **Grading:** must check each region or the pooled other regions. Wrong: "all regions were affected".

### Q13 — What does a signup cost by channel?
- **Prompt:** "What are we paying per signup on each paid channel?"
- **Type:** external-join
- **Answer:** Spend per Mixpanel signup over the window: **LinkedIn Ads $419.35** (905 signups, $379,515), **G2 $207.46** (454 signups, $94,188), **paid search $138.66** (994 signups, $137,833). LinkedIn costs about **3.0x** paid search per signup and takes 62% of the $611,535 paid budget. Spend is a paced daily budget on a weekday schedule (LinkedIn $1,400-$4,395 per day, about half its daily average on weekends; never zero). Weekend signups fall further than weekend spend, and smaller channels have days with no signups (G2 10 days, LinkedIn and search 3 each), so daily cost per signup swings; use the window or monthly totals. Platform-reported leads overstate Mixpanel signups by about 14% (2,692 vs 2,353), which understates CAC. Accept LinkedIn/search 2.6x-3.4x and dollar values within ±3%.
- **Evidence:** H8-paid-channel-economics; warehouse `paid_marketing_daily.spend_usd` joined to `account created` by date and `acquisition_channel`; `-- EVAL Q13`.
- **Context needed:** 04-metrics-and-tables.md (CAC definition, spend table), 01-business.md (channels).
- **Grading:** must divide by Mixpanel signups over a period, not quote a single day. Wrong: using `platform_reported_leads`; comparing total spend only.

### Q14 — Is LinkedIn worth it?
- **Prompt:** "Marketing says LinkedIn brings our best customers. Is it worth what we pay compared with search?"
- **Type:** attribution
- **Answer:** LinkedIn signups **do convert better than search**. With the Mixpanel funnel default 30-day conversion window, for signups from June 4 to August 31 (each has its full 30 days in the data), **17.7% of LinkedIn signups start a paid subscription vs 8.8% for paid search** (119 of 671 vs 65 of 738), about **2.0x** (z ≈ 5.0). Other channels: outbound 16.8%, referral 13.8%, G2 12.8%, organic 12.5%. But a LinkedIn signup costs about 3.0x as much, so **cost per paying customer is higher on LinkedIn: about $2,359 vs $1,571 for paid search and $1,646 for G2** (June 4-August 31 spend divided by that period's paying signups). LinkedIn is the most expensive paid channel per paying customer; search and G2 are close. Accept a conversion ratio of 1.6x-2.5x and the conclusion that LinkedIn costs more per paying customer.
- **Evidence:** H8-paid-channel-economics; Funnels `account created` → `subscription started`, 30-day conversion window (Mixpanel default), date range Jun 4 - Aug 31, breakdown `acquisition_channel`; warehouse spend for the same days; `-- EVAL Q14`.
- **Context needed:** 01-business.md (channels, goal 2), 04-metrics-and-tables.md (cost per paying customer).
- **Grading:** must combine conversion and cost, with a stated conversion window. Wrong: "LinkedIn is best" from conversion alone, or "LinkedIn is worst" from CAC alone without noting that it converts better; comparing late-September signups that have not had their full window.

### Q15 — Did the Team price rise hurt Team sales?
- **Prompt:** "We raised the Team price on August 17. Did fewer people buy Team after that?"
- **Type:** trend
- **Answer:** **Not in subscription count; yes in seats.** Team's share of new subscriptions, with Business as the control, was **66.9% before and 70.4% after** (380 of 568 vs 247 of 351; z ≈ +1.1, no drop). In equal six-week windows Team went from 213 to 226 and Business from 104 to 92. Monthly Team subscriptions held (Mixpanel: 149 in June, 143 July, 159 August, 169 September; Business 69, 72, 83, 63). What changed clearly is size: new Team subscriptions start with **8.5 seats on average vs 12.4 before (0.69x)**, while Business seats held (12.1 → 12.9, within noise for 104 post-change subscriptions). Accept "no drop in Team count" plus a seat ratio of 0.60-0.78.
- **Evidence:** H9-team-price-change; Insights, `subscription started`, total and average `seats`, breakdown `plan`, weekly; `-- EVAL Q15`.
- **Context needed:** 02-timeline.md (price change), 01-business.md (plans).
- **Grading:** must look at seats, not only counts, and use Business (or Team share) as a control. Wrong: "no effect" (misses seats); "Team sales collapsed".

### Q16 — Did the price rise pay off?
- **Prompt:** "Even if seats dipped, did the higher Team price bring in more new Team MRR?"
- **Type:** external-join
- **Answer:** **No.** From `subscription_bookings_daily`, new MRR per Team subscription fell from **$255.04 to $218.70 (0.86x)** despite the 25% price rise, because seats per subscription fell about 30%. A 25% higher price at the old seat counts would have given about $319. Business, at an unchanged price, held steady per subscription ($560.80 → $589.91, +5%). Team subscriptions per day held (5.3 before, 5.6 after), so new Team MRR per day also fell, from $1,361 to $1,227 (−10%). Events joined to the list price give the same picture (Team $247.84 → $212.65 per subscription, 0.86x). The price rise did not pay off in new MRR. Accept a per-subscription ratio of 0.79-0.94 and "did not pay off".
- **Evidence:** H9-team-price-change; warehouse `subscription_bookings_daily` (or events joined to its prices on date and `plan`); `-- EVAL Q16`.
- **Context needed:** 04-metrics-and-tables.md (bookings table and caveats), 02-timeline.md.
- **Grading:** must use warehouse prices (price is not on events) and compare per subscription (or per day with a check that volume held). Wrong: multiplying seats by $25 for the whole window; ignoring the seat drop; "the price rise paid off" from the higher list price alone.

### Q17 — Did the quarter-close promotion work?
- **Prompt:** "Sales ran a seat promotion for the last two weeks of Q3. Did it drive seat expansion?"
- **Type:** trend
- **Answer:** Probably, as far as Mixpanel can show it: **Mixpanel does not track seats added to existing subscriptions** (04-metrics-and-tables.md: seat changes on existing subscriptions are billed outside the self-serve flow and are in neither Mixpanel nor `subscription_bookings_daily`), so teammate invitations are the best available proxy for seat expansion. On that proxy the promotion worked for the paid workspaces it targeted. On paid plans (Team, Business, Enterprise by `plan_tier` on the event), teammate invitations per dashboard view rose from **0.091 (Sep 1-15) to 0.131 (Sep 16-30), about 1.44x**; invites went from 816 to 1,242 while dashboard views moved little (8,964 vs 9,453). Free workspaces, which were not eligible, stayed flat (0.149 → 0.143, 0.96x), which rules out a general September trend. The number of paid users sending invites rose only 3% (713 to 731), while invites per inviting user rose from 1.14 to 1.70: most of the lift is existing inviters inviting more people. Confirming actual seat expansion needs billing data on seat changes. Accept 1.30x-1.65x for paid plans, "no change" for Free, and a statement that invites are a proxy.
- **Evidence:** H1-quarter-close-seat-push; Insights, `teammate invited` and `dashboard viewed`, daily, formula A/B, breakdown `plan_tier`; `-- EVAL Q17`.
- **Context needed:** 02-timeline.md (promotion dates and eligibility), 04-metrics-and-tables.md (seat expansion is not tracked).
- **Grading:** must normalize by a stable activity measure or compare like periods, should use Free as a control, and must say invites stand in for seats. Wrong: "Yes, seats grew 44%" (seats are not tracked); crediting Labor Day; reporting raw invites without a baseline; a blended all-plan lift without noting that Free did not move.

### Q18 — New bookings by month
- **Prompt:** "What did new self-serve bookings look like by month this summer, in new MRR?"
- **Type:** context
- **Answer:** From `subscription_bookings_daily`: **June $78,845 new MRR** (232 subscriptions; window starts June 4), **July $81,285** (224), **August $90,835** (251), **September $77,220** (241), October 1 $5,470 (14). By plan, Team was $38,840 / $38,580 / $40,120 / $37,350 and Business $40,005 / $42,705 / $50,715 / $39,870 for June-September. Bookings were broadly flat at $77k-$91k a month; August was the high month (a strong Business month), September the low full month. Team subscriptions kept rising (156, 150, 164, 175) while Team new MRR stayed flat, because Team deals after the August 17 price change carried fewer seats (Team new MRR per subscription $249 in June vs $213 in September). Accept within ±1%.
- **Evidence:** warehouse `subscription_bookings_daily`; `-- EVAL Q18`.
- **Context needed:** 04-metrics-and-tables.md (bookings table, self-serve only), 02-timeline.md.
- **Grading:** must use the warehouse (prices are not on events) and note the partial June. Wrong: counting Enterprise; reporting ARR as MRR; expecting the table to match Mixpanel subscription counts exactly (billing includes a few checkouts Mixpanel missed and pre-invoice seat edits).

### Q19 — Did the runner incident spill over into alerting or dashboards? (null)
- **Prompt:** "During the August runner incident, did customers also stop acknowledging alerts or stop using dashboards?"
- **Type:** null-hypothesis
- **Answer:** **No.** Usage is weekday-heavy, so compare the incident days (Tue Aug 25 to Thu Aug 27) with the same weekdays one week before and one week after (Aug 18-20 and Sep 1-3). **65.2% of alerts triggered on incident days were acknowledged vs 65.8%** on the comparison days (3,333 vs 6,569 alerts; z ≈ −0.6). Dashboard views did not fall meaningfully: **1,244 per day vs 1,264** (−1.6%; incident days 1,210-1,270, comparison days 1,241-1,309; over all 17 Tuesday-to-Thursday spans in the window the daily average ran from 1,080 to 1,280, median 1,244). Queries: 936 per day vs 957. Acknowledgement was not slower either (22.6 vs 24.4 minutes on average; within the same users the change is −1.4 minutes, z ≈ −1.4, not significant). Only pipelines were affected. Accept "no meaningful change".
- **Evidence:** `-- EVAL Q19`; Funnels `alert triggered` → `alert acknowledged` (hold `alert_id`) by trigger day, and Insights `dashboard viewed` total, daily.
- **Context needed:** 02-timeline.md.
- **Grading:** must check the data against comparable days. Wrong: "the whole platform was down"; "customers stopped working"; "usage rose during the incident" (a comparison with all surrounding days, weekends included, shows higher incident-day volume only because Tuesday to Thursday are busy days).

### Q20 — What to worry about in Q4
- **Prompt:** "Looking at this data, what should we worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names most of these, with numbers:
  1. **Azure onboarding**: Azure signups finish setup at 34% vs 62% for other clouds; Azure is 29% of signups, about 365 lost setups this window. Fix the connect and agent-install steps for Azure.
  2. **Activation and setup**: 81% of new users invite fewer than 2 teammates in week one, and they retain at 21% vs 56% at day 30; signups who never finish setup retain at 41% at day 7 vs 87%. Push team invites and setup completion in onboarding.
  3. **Team pricing**: the August price rise shrank new Team deals from 12.4 to 8.5 seats; new MRR per Team subscription fell 14% instead of rising with the 25% price increase. Revisit the price or seat packaging.
  4. **Alert fatigue**: 7.9% of alert recipients get 30+ alerts (22.5% of all alerts) and acknowledge only about 43% of them vs 86% for light recipients. Tune alert noise.
  5. **Paid acquisition mix**: LinkedIn takes 62% of the $611,535 paid budget; it converts about 2.0x better than search (30-day window) but costs about $2,359 per paying customer vs $1,571 (search) and $1,646 (G2).
  6. **Runner reliability**: the us-east incident cut success to 29% for three days and cost about 741 deploys.
  7. **Flat bookings**: new self-serve MRR ran $77k-$91k a month with no growth; September was the lowest full month, and Team new MRR stayed flat even as Team subscriptions rose.
  Positive signals to keep: Root Cause Assist cuts resolution time to 0.56x and settled at about 41% of eligible incidents after a four-week ramp; Smart Test Selection lifts pipeline success 1.20x and cuts time to deploy about 25% (ship it); connecting Slack + PagerDuty cuts acknowledgement time to about 0.4x (worth promoting to the 82% of alert recipients without both); the quarter-close promotion lifted paid-plan invites 1.44x.
- **Evidence:** H1-H11; `-- EVAL Q20` (headline numbers).
- **Context needed:** all guides.
- **Grading:** full credit for at least four risks with supporting numbers and at least one recommended action. Partial credit for risks without numbers. Wrong: a generic list not grounded in the data.
