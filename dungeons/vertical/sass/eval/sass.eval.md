# Tallyboard (sass) — 20-question eval

- **Data:** `data/verify-sass` (full fidelity: 10,000 users, 9,995 with events, 4,531 new signups, 3,704 companies, 970,726 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07 (company-level plans: one workspace and one plan per company, at most one self-serve subscription per company; about 300 long-standing customers and 3,400 newer workspaces; weekend paging at about 70% of a weekday; workaround clones re-drawn; H1 baseline = the 30 days before the promotion)
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query in `dungeons/vertical/sass/sass.sql` on that data.
- **Stories:** ids refer to the `stories` export in `sass.js` (H1-H11).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Does Root Cause Assist shorten incidents?
- **Prompt:** "We launched Root Cause Assist in July. Is it actually making incident resolution faster? By how much?"
- **Type:** trend
- **Answer:** Yes. Since the 2026-07-22 launch, Business and Enterprise resolutions that used Root Cause Assist (`resolution_method = ai_assist`) took **72.0 minutes on average from acknowledgement to resolution vs 127.6 minutes** for manual and runbook resolutions on the same plans, about **0.56x** (median 51.2 vs 91.6 minutes). Blended over all Business and Enterprise resolutions, average resolution time fell from 129.3 minutes before launch to 108.6 after (−16%), while Free and Team (no access) stayed flat (129.8 → 130.4). Accept 0.50x-0.62x.
- **Evidence:** H2-root-cause-assist-launch; Insights, `alert resolved`, average `resolution_time_mins`, breakdown `resolution_method`, filter `plan_tier` in (business, enterprise), date range 2026-07-22 to 2026-10-01; `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (launch date, plan scope), 03-event-dictionary.md (`resolution_time_mins`, `resolution_method`).
- **Grading:** must compare AI-assisted to non-assisted resolutions on eligible plans, or use Free/Team as a control for the before/after. Wrong: comparing all resolutions before vs after launch across every plan (dilutes the effect); measuring trigger-to-ack time.

### Q2 — Root Cause Assist adoption
- **Prompt:** "How many incidents are resolved with Root Cause Assist? Is usage growing?"
- **Type:** segmentation
- **Answer:** Adoption **ramped for about four weeks and then leveled off at about 43%** of Business and Enterprise resolutions. Weekly share (Monday weeks): 3.9% in the launch week (Jul 22-26), 11.5% (week of Jul 27), 22.0% (Aug 3), 34.2% (Aug 10), 38.3% (Aug 17), then 42.9%-43.3% every week through the end of September (43.7% in the last partial week). From Aug 19 on, 42.7% of eligible resolutions use it; over the whole period since launch the share is 34.2%, by 1,702 users. It is no longer growing. Accept a ramp through mid-August and a plateau of 39%-46%.
- **Evidence:** H2-root-cause-assist-launch; Insights, `alert resolved`, filter `plan_tier` in (business, enterprise) and date from 2026-07-22, breakdown `resolution_method`, weekly; `-- EVAL Q2`.
- **Context needed:** 02-timeline.md (launch, opt-in), 04-metrics-and-tables.md (adoption definition).
- **Grading:** denominator is eligible (Business/Enterprise, post-launch) resolutions, and the answer must describe the shape (ramp then plateau). Wrong: share of all resolutions (much lower, because Free and Team cannot use it); "still growing steadily"; quoting only the 34.2% all-period average as the current rate.

### Q3 — Do Root Cause Assist incidents get acknowledged faster? (null)
- **Prompt:** "Our CS team says engineers who use Root Cause Assist also respond to pages faster. For Business and Enterprise incidents since adoption settled in mid-August, are the ones resolved with Root Cause Assist acknowledged any faster than the others?"
- **Type:** null-hypothesis
- **Answer:** **No.** For Business and Enterprise alerts resolved from 2026-08-19 on, alerts resolved with Root Cause Assist were acknowledged in **20.80 minutes on average (median 14.3) vs 20.99 (median 14.5)** for the other resolutions (4,696 vs 6,309 alerts; Welch z = −0.44 on the mean, −0.63 on log minutes). The null holds in the sub-splits: Business 22.05 vs 22.24 (z −0.36), Enterprise 17.27 vs 17.43 (z −0.24); by company size every |z| ≤ 0.87 (the smallest group, startups, 264 vs 285 alerts, z −0.63). Root Cause Assist acts after acknowledgement; it shortens resolution, not response. Context an analyst may also report: a plain before/after on all Business and Enterprise acknowledgements moves from 20.13 to 20.79 minutes (+3.3%; median 13.9 → 14.3; z +2.87 on the mean). That is a mix shift, not the launch: newer accounts (customer since 2026-05-14), which acknowledge in about 29 minutes, grow from 5% to 9% of Business and Enterprise acknowledgements as new workspaces buy Business. Within long-standing accounts the change is 19.63 → 20.04 (z +1.81, not significant) and within newer accounts 29.09 → 28.37. Accept "no meaningful difference" (within ±5%) for the Root Cause Assist comparison.
- **Evidence:** `-- EVAL Q3`; alert level (same `alert_id`): Funnels, `alert triggered` → `alert acknowledged` → `alert resolved`, hold `alert_id` constant, filter `plan_tier` in (business, enterprise), date range 2026-08-19 to 2026-10-01, breakdown `resolution_method` attributed to the `alert resolved` step, compare time from step 1 to step 2 (or read `response_time_mins` per `alert_id` in the raw data).
- **Context needed:** 03-event-dictionary.md (what `response_time_mins` measures; `alert_id` links the three events), 02-timeline.md.
- **Grading:** must compare acknowledgement time, not resolution time, and conclude no difference. A whole-window before/after read is acceptable only if it notes the mix shift toward newer, slower accounts. Wrong: "yes, RCA users respond faster" by citing resolution time; treating a sub-split as a finding; "Root Cause Assist slowed acknowledgement" from the plain before/after.

### Q4 — Where do new signups stall in setup?
- **Prompt:** "Too many signups never finish setup. Is it everyone, or is there a segment that struggles?"
- **Type:** funnel
- **Answer:** **Azure companies.** 7-day onboarding completion (account created → cloud account connected → agent installed → dashboard created) is **34.8% for Azure** (376 of 1,082 signups) vs **59.5% for AWS, GCP, and multi-cloud** (2,052 of 3,449; AWS 59.6%, GCP 61.5%, multi-cloud 55.0%), about **0.58x**. Azure signups drop at both the cloud-connect step (79.3% vs 85-87%) and the agent-install step (59.4% vs 71-74% cumulative). Azure is 24% of signups; at parity about 270 more Azure signups would have finished setup. Accept a ratio of 0.50-0.65 and naming Azure.
- **Evidence:** H3-azure-onboarding-friction; Funnels, four onboarding steps, 7-day window, breakdown `cloud_provider`; `-- EVAL Q4`.
- **Context needed:** 03-event-dictionary.md (onboarding events), 04-metrics-and-tables.md (onboarding completion).
- **Grading:** must break down by cloud provider and give the gap. Wrong: blaming signup method or company size; reporting only the overall rate (about 54%).

### Q5 — Do SSO signups onboard worse? (null)
- **Prompt:** "SSO signups come from bigger companies with IT approval steps. Do they finish onboarding less often than everyone else?"
- **Type:** null-hypothesis
- **Answer:** **No.** 7-day onboarding completion is **51.8% for SSO** (657 signups) vs **53.9% for all other signup methods** (3,874 signups); the 2.1-point gap is noise (z ≈ −1.0, p ≈ 0.31). The other methods: email 52.8% (932 signups), Google 53.4% (1,578), GitHub 55.3% (1,364); no method differs significantly from the rest (every |z| ≤ 1.5). Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q5`; Funnels onboarding steps, 7-day window, breakdown `signup_method`.
- **Context needed:** 03-event-dictionary.md.
- **Grading:** must check the data and treat the SSO gap as noise. Wrong: "yes, SSO is lower"; ranking methods without a significance check.

### Q6 — Do chat and paging integrations matter?
- **Prompt:** "Does connecting Slack and PagerDuty actually speed up incident response?"
- **Type:** segmentation
- **Answer:** Yes, for acknowledgement, from the moment both are live. Among accounts set up before the window (customer_since before 2026-05-14), users whose profile `connected_integrations` holds **both Slack and PagerDuty** acknowledge alerts in **9.9 minutes on average vs 24.8 minutes** for everyone else (**0.40x**; 642 vs 4,004 users). Over all users the same profile cohort reads 15.8 vs 26.6 minutes (0.60x; median 9.5 vs 18.6), diluted because newer accounts connected the pair partway through the window. The within-user test is new signups who connect both during the window: their alerts took **33.6 minutes before the second integration was live and 13.9 minutes after (0.41x)**, and their pre-connection time matches new signups who never connect both (34.0 minutes). So the gap follows the connection, not which teams connect. Resolution time after acknowledgement does not change (129.2 vs 129.4 minutes for non-AI resolutions). Among alert recipients (7,291 users with at least one alert triggered), **1,221 (16.7%)** have both. Accept 0.35x-0.46x for the pre-window accounts (or 0.50x-0.66x for the all-user profile cohort with the dilution explained), a before/after drop for new users, and "no difference" for resolution.
- **Evidence:** H4-slack-pagerduty-response; Mixpanel (read 1): Insights, `alert acknowledged`, average `response_time_mins`, filter user property `customer_since` before 2026-05-14, breakdown by a cohort "user property `connected_integrations` contains slack AND contains pagerduty". The per-user before/after split at each new user's second `integration configured` has no direct Mixpanel report; it is a raw-data / SQL check. The closest Mixpanel view: the same Insights report filtered to `customer_since` on or after 2026-06-04, by week: the cohort's weekly average falls from about 25 minutes in June to about 15-19 in September while the rest stays at 30-37 (whole window 22.9 vs 34.0 minutes), diluted by alerts from before each member connected the pair. `-- EVAL Q6`.
- **Context needed:** 03-event-dictionary.md (`connected_integrations`, `integration configured`, `response_time_mins`), 01-business.md (teams connect tools in their first weeks), 00-manifest.md (`customer_since`).
- **Grading:** must build the both-integrations cohort and separate acknowledgement from resolution. Full credit also handles timing (accounts that connected during the window: the raw-data before/after per user, or the weekly trend of the new-signup cohort). Wrong: "integrated teams resolve incidents faster" (resolution does not change); using only one of the two integrations; building the cohort only from in-window `integration configured` events for older accounts (their tools were connected before June 4, so many never send one of each); "it is only selection" (the before/after shows the drop).

### Q7 — Response time by company size
- **Prompt:** "How quickly do customers acknowledge alerts, and does it differ by company size?"
- **Type:** funnel
- **Answer:** Median time to acknowledge per alert: **enterprise 11.3 minutes, mid-market 18.7, SMB 18.5, startup 26.9**. Enterprise is about **0.61x** and startups about **1.45x** the pooled SMB/mid-market median (18.6 minutes). Accept enterprise 0.54x-0.66x and startup 1.35x-1.65x.
- **Evidence:** H10-response-time-by-company-size; Funnels, `alert triggered` → `alert acknowledged`, hold `alert_id` constant, median time to convert, breakdown `company_size`; `-- EVAL Q7`.
- **Context needed:** 01-business.md (company sizes), 04-metrics-and-tables.md (MTTA).
- **Grading:** must measure per alert (same `alert_id`), median preferred. Wrong: unique-user funnel time that pairs a trigger with an unrelated later acknowledgement.

### Q8 — Are we paging people too much?
- **Prompt:** "Our SRE advisory board says alert noise is a problem. Is there evidence people ignore alerts when they get a lot of them?"
- **Type:** segmentation
- **Answer:** Yes. Acknowledgement rate by alerts received in the window: **1-6 alerts 86.0%, 7-12 86.3%**, then it falls: 13-18 76.8%, 19-24 63.6%, 25-29 51.0%, and **about 43% at 30+** (30-44: 42.8%, 45+: 43.5%). Roughly half of the would-be acknowledgements are lost for the heaviest recipients (0.50x vs the 1-12 group: 43.0% vs 86.2%). The decline starts above about 12 alerts and levels off at about 30. 630 users (8.6% of alert recipients) get 30+ alerts and receive 24.9% of all alerts. Accept a description of a decline starting near 12 and a floor near 30, with rates within ±3 points.
- **Evidence:** H11-alert-fatigue; Funnels, `alert triggered` → `alert acknowledged`, totals, hold `alert_id`, breakdown by a cohort on alert count; `-- EVAL Q8`.
- **Context needed:** 01-business.md (goal 4), 04-metrics-and-tables.md (acknowledgement rate).
- **Grading:** must show the rate by volume band, not just a correlation. Wrong: "a cliff at N alerts"; unique-user funnel rates (most users acknowledge at least one alert).

### Q9 — What predicts new-user retention?
- **Prompt:** "Is there something new users do in their first week that predicts whether they stick around?"
- **Type:** retention
- **Answer:** **Inviting teammates in the first 7 days, with 2+ invites as the practical bar.** Day-30 retention (any activity in days 30-36) is **55.9% for users with 2+ first-week invites vs 22.2%** for users with 0-1 (about **2.5x**). Retention by first-week invites: 0 invites 17.9%, 1 invite 31.0%, 2 invites 56.5%, 3 invites 57.1%, 4+ 52.4% (105 users); the big step is from 1 to 2. Finishing setup also matters: users who reached `dashboard created` retain at 35.3% vs 20.6% at day 30 (87.2% vs 42.5% at day 7), and the invite effect holds within both groups (onboarded: 69.2% vs 28.1%; not onboarded: 42.6% vs 15.0%). Among onboarded users the ramp is 24.0% (0 invites, 925 users), 36.6% (1, 451 users), 69.2% (2+, 289 users). 81% of new users (signups through Aug 25) fall below 2 invites. Accept 2.1x-3.0x for 2+ vs fewer, a rising pattern, and mention of setup completion as a second factor.
- **Evidence:** H5-first-week-team-activation; build the groups in **Funnels**: `account created` → `teammate invited` → `teammate invited`, 7-day conversion window, uniques (completed = 2+ first-week invites, dropped after step 2 = one, dropped after step 1 = none); save each group as a cohort from the funnel; then **Retention**, `account created` → any event, **custom bracket** day 30-36 (day 7-13 for D7; the standard day buckets do not give a 7-day bracket), breakdown by those cohorts, optional filter "did `dashboard created`"; `-- EVAL Q9`.
- **Context needed:** 01-business.md (activation goal), 04-metrics-and-tables.md (retention definition).
- **Grading:** must define the behavior from the first week only and show the invite gradient. Wrong: using invites over the whole window (leaks the outcome); claiming invites are the only factor without checking setup completion; "a hard cliff, nothing below 2 matters". Note for graders: part of the gap is engagement (heavier users both invite more and are likelier to be active in the day-30 week), so "invites predict retention" is correct and "invites alone cause the whole 2.5x" overstates it.

### Q10 — Is Smart Test Selection working?
- **Prompt:** "Should we ship Smart Test Selection to everyone? What did the test show?"
- **Type:** funnel
- **Answer:** Yes. Since 2026-07-15, **80.7% of Smart Selection pipeline runs succeed and deploy vs 67.2% for Control** (about **1.20x**, 40,055 vs 40,992 runs), and the median time from run to deploy is **22.5 vs 30.1 minutes** (0.75x). Users in both arms run about the same number of pipelines (11.4 vs 11.5 per user), so the gain is per run, not more runs. The split is even (3,505 Smart Selection vs 3,551 Control users with runs; the profile property and the `$experiment_started` events agree on both counts). Accept 1.08x-1.32x for success and 0.68x-0.83x for time.
- **Evidence:** H6-smart-test-selection-experiment; Funnels `deployment pipeline run` → `service deployed`, totals, hold `deploy_id`, 1-day window, **date range 2026-07-15 to 2026-10-01** (the full window dilutes the lift with pre-test runs), breakdown `Experiment: Smart Test Selection` (or Insights share of `pipeline_status = success` over the same dates); `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (test start and arms), 03-event-dictionary.md (`deploy_id`, `pipeline_status`).
- **Grading:** must compare per run within the test window. Wrong: unique-user funnel conversion (almost every user deploys at least once, which hides the gap); including runs before July 15; comparing before vs after July 15 for everyone.

### Q11 — Late-August deploy failures
- **Prompt:** "Pipeline failures spiked for a few days in late August. What happened, and how many deploys did customers lose?"
- **Type:** external-join
- **Answer:** The **2026-08-25 to 2026-08-27 hosted CI runner incident in us-east**. `ci_runner_health_daily` shows `runner_status = major_outage` for us-east only, `infra_error_rate` ≈ 0.60 (0.59-0.62, vs under 1% normally), and p95 queue time of 1,501-1,739 seconds (vs under 70). In Mixpanel, us-east pipeline success fell to **30.0%** on those days (27.6%-33.1% per day) from 74.8% on the surrounding days (Aug 18-24 and Aug 28-Sep 3), while the other regions stayed at 75.1% (75.3% around). Relative to the other regions, us-east ran at **0.40x** its normal success rate. About **761 deploys** did not happen (1,709 us-east runs on incident days). Accept 0.35-0.46 and 650-870 lost deploys.
- **Evidence:** H7-ci-runner-incident; Insights `deployment pipeline run`, share `pipeline_status = success`, daily, breakdown `runner_region`; warehouse join on date and `runner_region`; `-- EVAL Q11`.
- **Context needed:** 02-timeline.md (incident dates), 04-metrics-and-tables.md (`ci_runner_health_daily`), 03-event-dictionary.md (`runner_region`).
- **Grading:** must name the incident, the region, the dates, and a size. Wrong: blaming the Smart Test Selection test (both arms were hit alike) or customer code; saying all regions failed; using `jobs_started` as the Mixpanel run count (it also counts scheduled and API-triggered jobs).

### Q12 — Was the incident only us-east? (null for the other regions)
- **Prompt:** "Did the August runner incident hurt pipelines in our other regions too?"
- **Type:** external-join
- **Answer:** **No.** Pooled, the other three regions succeeded on **75.1% of runs during the incident vs 75.3%** on the surrounding days (z ≈ −0.2). By region: **us-west 75.5% vs 75.6%, eu-west 75.3% vs 75.3%, ap-south 73.5% vs 75.0%**. ap-south has only 426 incident runs; over the 17 Tuesday-to-Thursday spans in the window (about 410 runs each) its success ran from 64.0% to 79.6% (median 73.4%), and the incident span sits in the middle of that range. Only us-east fell far outside its range (30.0% vs 74.8%). The warehouse agrees: only us-east shows `major_outage`. Accept "only us-east" with no meaningful drop elsewhere.
- **Evidence:** H7-ci-runner-incident; `-- EVAL Q12`.
- **Context needed:** 04-metrics-and-tables.md, 02-timeline.md.
- **Grading:** must check each region or the pooled other regions. Wrong: "all regions were affected".

### Q13 — What does a signup cost by channel?
- **Prompt:** "What are we paying per signup on each paid channel?"
- **Type:** external-join
- **Answer:** Spend per Mixpanel signup over the window: **LinkedIn Ads $424.99** (893 signups, $379,515), **G2 $204.76** (460 signups, $94,188), **paid search $140.93** (978 signups, $137,833). LinkedIn costs about **3.0x** paid search per signup and takes 62% of the $611,535 paid budget. Spend is a paced daily budget on a weekday schedule (LinkedIn $1,400-$4,395 per day, about half its daily average on weekends; never zero). Weekend signups fall further than weekend spend, and smaller channels have days with no signups (G2 11 days, paid search 1), so daily cost per signup swings; use the window or monthly totals. Platform-reported leads overstate Mixpanel signups by about 15% (2,692 vs 2,331), which understates CAC. Accept LinkedIn/search 2.6x-3.4x and dollar values within ±3%.
- **Evidence:** H8-paid-channel-economics; warehouse `paid_marketing_daily.spend_usd` joined to `account created` by date and `acquisition_channel`; `-- EVAL Q13`.
- **Context needed:** 04-metrics-and-tables.md (CAC definition, spend table), 01-business.md (channels).
- **Grading:** must divide by Mixpanel signups over a period, not quote a single day. Wrong: using `platform_reported_leads`; comparing total spend only.

### Q14 — Is LinkedIn worth it?
- **Prompt:** "Marketing says LinkedIn brings our best customers. Is it worth what we pay compared with search?"
- **Type:** attribution
- **Answer:** LinkedIn signups **do convert better than search**. With the Mixpanel funnel default 30-day conversion window, for signups from June 4 to August 31 (each has its full 30 days in the data), **23.2% of LinkedIn signups start a paid subscription vs 10.7% for paid search** (147 of 633 vs 75 of 704), about **2.2x** (z ≈ 6.2). Other channels: outbound 22.8%, referral 18.5%, organic 15.7%, G2 12.1%. (A signup who joins a colleague's workspace cannot start a subscription, so these per-signup rates sit below the share of new workspaces that pay; the channel comparison is unaffected.) But a LinkedIn signup costs about 3.0x as much, so **cost per paying customer is higher on LinkedIn: about $1,910 vs $1,361 for paid search and $1,686 for G2** (June 4-August 31 spend divided by that period's paying signups). LinkedIn is the most expensive paid channel per paying customer, by about 40% over search. Accept a conversion ratio of 1.7x-2.7x and the conclusion that LinkedIn costs more per paying customer.
- **Evidence:** H8-paid-channel-economics; Funnels `account created` → `subscription started`, 30-day conversion window (Mixpanel default), date range Jun 4 - Aug 31, breakdown `acquisition_channel`; warehouse spend for the same days; `-- EVAL Q14`.
- **Context needed:** 01-business.md (channels, goal 2), 04-metrics-and-tables.md (cost per paying customer).
- **Grading:** must combine conversion and cost, with a stated conversion window. Wrong: "LinkedIn is best" from conversion alone, or "LinkedIn is worst" from CAC alone without noting that it converts better; comparing late-September signups that have not had their full window.

### Q15 — Did the Team price rise hurt Team sales?
- **Prompt:** "We raised the Team price on August 17. Did fewer people buy Team after that?"
- **Type:** trend
- **Answer:** **Not in subscription count; yes in seats.** Team's share of new subscriptions, with Business as the control, was **60.5% before and 60.8% after** (286 of 473 vs 188 of 309; z ≈ +0.1, no drop). In equal six-week windows (Jul 6 - Aug 16 vs Aug 17 - Sep 27) Team went from 165 to 169 and Business from 107 to 110. Monthly Team subscriptions held (Mixpanel: 108 in June, 117 July, 118 August, 127 September; Business 65, 92, 65, 84). What changed clearly is size: new Team subscriptions start with **8.0 seats on average vs 12.2 before (0.66x)**, while Business seats held (11.6 → 12.0, within noise for 121 post-change subscriptions). Accept "no drop in Team count" plus a seat ratio of 0.58-0.76.
- **Evidence:** H9-team-price-change; Insights, `subscription started`, total and average `seats`, breakdown `plan`, weekly; `-- EVAL Q15`.
- **Context needed:** 02-timeline.md (price change), 01-business.md (plans).
- **Grading:** must look at seats, not only counts, and use Business (or Team share) as a control. Wrong: "no effect" (misses seats); "Team sales collapsed".

### Q16 — Did the price rise pay off?
- **Prompt:** "Even if seats dipped, did the higher Team price bring in more new Team MRR?"
- **Type:** external-join
- **Answer:** **No.** From `subscription_bookings_daily`, new MRR per Team subscription fell from **$253.69 to $209.92 (0.83x)** despite the 25% price rise, because seats per subscription fell about a third. A 25% higher price at the old seat counts would have given about $317. Business, at an unchanged price, held steady per subscription ($536.59 → $549.21, +2%). Team subscriptions per day held (4.1 before, 4.3 after), so new Team MRR per day also fell, from $1,032 to $908 (−12%). Events joined to the list price give the same picture (Team $244.06 → $200.66 per subscription, 0.82x). The price rise did not pay off in new MRR. Accept a per-subscription ratio of 0.75-0.92 and "did not pay off".
- **Evidence:** H9-team-price-change; warehouse `subscription_bookings_daily` (or events joined to its prices on date and `plan`); `-- EVAL Q16`.
- **Context needed:** 04-metrics-and-tables.md (bookings table and caveats), 02-timeline.md.
- **Grading:** must use warehouse prices (price is not on events) and compare per subscription (or per day with a check that volume held). Wrong: multiplying seats by $25 for the whole window; ignoring the seat drop; "the price rise paid off" from the higher list price alone.

### Q17 — Did the quarter-close promotion work?
- **Prompt:** "Sales ran a seat promotion for the last two weeks of Q3. Did it drive seat expansion?"
- **Type:** trend
- **Answer:** Probably, as far as Mixpanel can show it: **Mixpanel does not track seats added to existing subscriptions** (04-metrics-and-tables.md: seat changes on existing subscriptions are billed outside the self-serve flow and are in neither Mixpanel nor `subscription_bookings_daily`), so teammate invitations are the best available proxy for seat expansion. On that proxy the promotion worked for the paid workspaces it targeted. On paid plans (Team, Business, Enterprise by `plan_tier` on the event), teammate invitations per dashboard view rose from **0.097 in the 30 days before (Aug 17 - Sep 15) to 0.138 during the promotion (Sep 16-30), about 1.42x** (1.39x against Sep 1-15 alone: 0.099 → 0.138; invites 1,021 → 1,473 while dashboard views moved little, 10,295 vs 10,708). Free workspaces, which were not eligible, stayed flat (0.144 → 0.136, 0.95x; 1.02x against Sep 1-15), which rules out a general September trend. The number of paid users sending invites did not rise (854 in Sep 1-15, 816 during the promotion), while invites per inviting user rose from 1.20 to 1.81: the lift is existing inviters inviting more people. Confirming actual seat expansion needs billing data on seat changes. Accept 1.28x-1.60x for paid plans (either baseline), "no change" for Free, and a statement that invites are a proxy.
- **Evidence:** H1-quarter-close-seat-push; Insights, `teammate invited` and `dashboard viewed`, daily, formula A/B, breakdown `plan_tier`, Sep 16-30 vs Aug 17 - Sep 15 (or Sep 1-15); `-- EVAL Q17`.
- **Context needed:** 02-timeline.md (promotion dates and eligibility), 04-metrics-and-tables.md (seat expansion is not tracked).
- **Grading:** must normalize by a stable activity measure or compare like periods, should use Free as a control, and must say invites stand in for seats. Wrong: "Yes, seats grew 42%" (seats are not tracked); crediting Labor Day; reporting raw invites without a baseline; a blended all-plan lift without noting that Free did not move.

### Q18 — New bookings by month
- **Prompt:** "What did new self-serve bookings look like by month this summer, in new MRR?"
- **Type:** context
- **Answer:** From `subscription_bookings_daily`: **June $67,795 new MRR** (187 subscriptions; window starts June 4), **July $80,760** (218), **August $66,290** (192), **September $76,985** (220), October 1 $2,300 (8). By plan, Team was $27,880 / $31,800 / $29,480 / $27,575 and Business $39,915 / $48,960 / $36,810 / $49,410 for June-September. Bookings moved between $66k and $81k a month with no growth; the swings come from Business (July and September were strong Business months). Team subscriptions kept rising (115, 124, 123, 133) while Team new MRR stayed flat and fell in September, because Team deals after the August 17 price change carried fewer seats (Team new MRR per subscription $242 in June vs $207 in September). Accept within ±1%.
- **Evidence:** warehouse `subscription_bookings_daily`; `-- EVAL Q18`.
- **Context needed:** 04-metrics-and-tables.md (bookings table, self-serve only), 02-timeline.md.
- **Grading:** must use the warehouse (prices are not on events) and note the partial June. Wrong: counting Enterprise; reporting ARR as MRR; expecting the table to match Mixpanel subscription counts exactly (billing includes a few checkouts Mixpanel missed and pre-invoice seat edits).

### Q19 — Did the runner incident spill over into alerting or dashboards? (null)
- **Prompt:** "During the August runner incident, did customers also stop acknowledging alerts or stop using dashboards?"
- **Type:** null-hypothesis
- **Answer:** **No.** Usage is weekday-heavy, so compare the incident days (Tue Aug 25 to Thu Aug 27) with the same weekdays one week before and one week after (Aug 18-20 and Sep 1-3). **65.3% of alerts triggered on incident days were acknowledged vs 65.3%** on the comparison days (2,765 vs 5,599 alerts; z ≈ 0.0). Dashboard views did not fall meaningfully: **1,270 per day vs 1,300** (−2.3%; incident days 1,259-1,289, comparison days 1,239-1,377; over all 17 Tuesday-to-Thursday spans in the window the daily average ran from 1,114 to 1,341, median 1,269, and the incident span sits at the median). Queries: 959 per day vs 988. Acknowledgement was not slower either (23.8 vs 24.2 minutes on average; within the same users the change is −0.4 minutes, z ≈ −0.4). Only pipelines were affected. Accept "no meaningful change".
- **Evidence:** `-- EVAL Q19`; Funnels `alert triggered` → `alert acknowledged` (hold `alert_id`) by trigger day, and Insights `dashboard viewed` total, daily.
- **Context needed:** 02-timeline.md.
- **Grading:** must check the data against comparable days. Wrong: "the whole platform was down"; "customers stopped working"; "usage rose during the incident" (a comparison with all surrounding days, weekends included, shows higher incident-day volume only because Tuesday to Thursday are busy days).

### Q20 — What to worry about in Q4
- **Prompt:** "Looking at this data, what should we worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names most of these, with numbers:
  1. **Azure onboarding**: Azure signups finish setup at 35% vs 60% for other clouds; Azure is 24% of signups, about 270 lost setups this window. Fix the connect and agent-install steps for Azure.
  2. **Activation and setup**: 81% of new users invite fewer than 2 teammates in week one, and they retain at 22% vs 56% at day 30; signups who never finish setup retain at 42% at day 7 vs 87%. Push team invites and setup completion in onboarding.
  3. **Team pricing**: the August price rise shrank new Team deals from 12.2 to 8.0 seats; new MRR per Team subscription fell 17% instead of rising with the 25% price increase. Revisit the price or seat packaging.
  4. **Alert fatigue**: 8.6% of alert recipients get 30+ alerts (24.9% of all alerts) and acknowledge only about 43% of them vs 86% for light recipients. Tune alert noise.
  5. **Paid acquisition mix**: LinkedIn takes 62% of the $611,535 paid budget; it converts about 2.2x better than search (30-day window) but costs about $1,910 per paying customer vs $1,361 (search) and $1,686 (G2).
  6. **Runner reliability**: the us-east incident cut success to 30% for three days and cost about 761 deploys.
  7. **Flat bookings**: new self-serve MRR ran $66k-$81k a month with no growth, and Team new MRR stayed flat even as Team subscriptions rose.
  Positive signals to keep: Root Cause Assist cuts resolution time to 0.56x and settled at about 43% of eligible incidents after a four-week ramp; Smart Test Selection lifts pipeline success 1.20x and cuts time to deploy about 25% (ship it); connecting Slack + PagerDuty cuts acknowledgement time to about 0.4x (worth promoting to the 83% of alert recipients without both); the quarter-close promotion lifted paid-plan invites about 1.4x.
- **Evidence:** H1-H11; `-- EVAL Q20` (headline numbers).
- **Context needed:** all guides.
- **Grading:** full credit for at least four risks with supporting numbers and at least one recommended action. Partial credit for risks without numbers. Wrong: a generic list not grounded in the data.
