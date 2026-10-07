# Tallyboard (sass) — 20-question eval

- **Data:** `data/verify-sass` (full fidelity: 10,000 users, 9,996 with events, 4,462 new signups, 3,665 companies, 955,574 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07 (final engine: one experiment exposure per user, soup hour and weekday shapes honored, identity-resolved warehouse measures; company-level plans with at most one self-serve subscription per company; about 300 long-standing customers and 3,360 newer workspaces; Team price change on 2026-08-03; 19% of new workspaces pay inside the window)
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query in `dungeons/vertical/sass/sass.sql` on that data.
- **Stories:** ids refer to the `stories` export in `sass.js` (H1-H11).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Does Root Cause Assist shorten incidents?
- **Prompt:** "We launched Root Cause Assist in July. Is it actually making incident resolution faster? By how much?"
- **Type:** trend
- **Answer:** Yes. Since the 2026-07-22 launch, Business and Enterprise resolutions that used Root Cause Assist (`resolution_method = ai_assist`) took **72.1 minutes on average from acknowledgement to resolution vs 130.7 minutes** for manual and runbook resolutions on the same plans, about **0.55x** (median 52.1 vs 92.9 minutes). Blended over all Business and Enterprise resolutions, average resolution time fell from 128.8 minutes before launch to 112.1 after (−13%), while Free and Team (no access) stayed flat (131.3 → 130.2). Accept 0.50x-0.61x.
- **Evidence:** H2-root-cause-assist-launch; Insights, `alert resolved`, average `resolution_time_mins`, breakdown `resolution_method`, filter `plan_tier` in (business, enterprise), date range 2026-07-22 to 2026-10-01; `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (launch date, plan scope), 03-event-dictionary.md (`resolution_time_mins`, `resolution_method`).
- **Grading:** must compare AI-assisted to non-assisted resolutions on eligible plans, or use Free/Team as a control for the before/after. Wrong: comparing all resolutions before vs after launch across every plan (dilutes the effect); measuring trigger-to-ack time.

### Q2 — Root Cause Assist adoption
- **Prompt:** "How many incidents are resolved with Root Cause Assist? Is usage growing?"
- **Type:** segmentation
- **Answer:** Adoption **ramped for about four weeks and then leveled off at about 40%** of Business and Enterprise resolutions. Weekly share (Monday weeks): 3.7% in the launch week (Jul 22-26), 10.7% (week of Jul 27), 21.2% (Aug 3), 31.5% (Aug 10), 39.8% (Aug 17), then 38.2%-41.6% every week through the end of September (39.7% in the last partial week). From Aug 19 on, 39.8% of eligible resolutions use it; over the whole period since launch the share is 31.8%, by 1,594 users. It is no longer growing. Accept a ramp through mid-August and a plateau of 36%-44%.
- **Evidence:** H2-root-cause-assist-launch; Insights, `alert resolved`, filter `plan_tier` in (business, enterprise) and date from 2026-07-22, breakdown `resolution_method`, weekly; `-- EVAL Q2`.
- **Context needed:** 02-timeline.md (launch), 04-metrics-and-tables.md (adoption definition).
- **Grading:** denominator is eligible (Business/Enterprise, post-launch) resolutions, and the answer must describe the shape (ramp then plateau). Wrong: share of all resolutions (much lower, because Free and Team cannot use it); "still growing steadily"; quoting only the 31.8% all-period average as the current rate.

### Q3 — Did Root Cause Assist speed up page response? (null)
- **Prompt:** "Our CS team says Root Cause Assist also gets engineers to respond to pages faster. Since it launched, are Business and Enterprise customers acknowledging alerts any faster?"
- **Type:** null-hypothesis
- **Answer:** **No.** Business and Enterprise acknowledgements (`plan_tier` on the event) averaged **20.09 minutes before the 2026-07-22 launch and 20.22 after** (median 13.7 vs 14.0; 14,373 vs 22,700 acknowledgements; z = +0.58 on the mean, +0.40 on log minutes). Within the same users (3,126 users with acknowledgements on both sides) the change is +0.02 minutes (z = 0.08). The null holds in every sub-split: Business 21.36 → 21.45 (z 0.34), Enterprise 16.46 → 16.64 (z 0.50); by company size every |z| ≤ 1.09 (startups, the smallest group, 397 vs 817 acknowledgements: 39.3 → 36.9, z −1.09), and every within-user sub-split has |z| ≤ 0.61. Root Cause Assist acts after acknowledgement: on the same plans, resolution time fell from 128.8 to 112.1 minutes. Accept "no meaningful difference" (within ±5%).
- **Evidence:** `-- EVAL Q3`; Insights, `alert acknowledged`, average (and median) `response_time_mins`, filter `plan_tier` in (business, enterprise), compare 2026-06-04 to 2026-07-21 with 2026-07-22 to 2026-10-01 (or a weekly line); optional breakdown by `plan_tier` or user property `company_size`.
- **Context needed:** 03-event-dictionary.md (what `response_time_mins` measures), 02-timeline.md (launch date).
- **Grading:** must measure acknowledgement time, not resolution time, and conclude no change. Wrong: "yes, faster response" by citing resolution time; treating the small startup change as a finding (it is the noisiest split and not significant).

### Q4 — Where do new signups stall in setup?
- **Prompt:** "Too many signups never finish setup. Is it everyone, or is there a segment that struggles?"
- **Type:** funnel
- **Answer:** **Azure companies.** 7-day onboarding completion (account created → cloud account connected → agent installed → dashboard created) is **32.3% for Azure** (346 of 1,072 signups) vs **61.6% for AWS, GCP, and multi-cloud** (2,088 of 3,390; AWS 62.2%, GCP 60.5%, multi-cloud 61.2%), about **0.52x**. Azure trails at every step (step conversion given the prior step, Azure vs the other clouds): cloud account connected 75.9% vs 86.4% (0.88x), agent installed 70.3% vs 86.1% (0.82x), and **dashboard created 60.5% vs 82.8% (0.73x), the widest gap**. Azure is 24% of signups; at parity about 314 more Azure signups would have finished setup. Accept a ratio of 0.47-0.62 and naming Azure; full credit also reports the step gaps (any of the three steps may be named as a problem; the largest is agent installed → dashboard created).
- **Evidence:** H3-azure-onboarding-friction; Funnels, four onboarding steps, 7-day window, breakdown `cloud_provider`; `-- EVAL Q4`.
- **Context needed:** 03-event-dictionary.md (onboarding events), 04-metrics-and-tables.md (onboarding completion).
- **Grading:** must break down by cloud provider and give the gap. Wrong: blaming signup method, acquisition channel, or company size; reporting only the overall rate (54.5%).

### Q5 — Do LinkedIn signups finish setup less often? (null)
- **Prompt:** "LinkedIn brings us a lot of engineering leaders who don't do hands-on work. Do LinkedIn signups finish onboarding less often than everyone else?"
- **Type:** null-hypothesis
- **Answer:** **No.** 7-day onboarding completion is **53.0% for LinkedIn Ads signups** (887) vs **54.9% for all other channels** (3,575); the 2-point gap is noise (z = −1.04, p ≈ 0.30). It holds within each cloud group (Azure 31.8% vs 32.4%, z −0.16; AWS/GCP/multi-cloud 60.0% vs 62.0%, z −0.96) and each signup method (every |z| ≤ 1.11). No channel differs from the rest (g2_reviews 53.6%, organic 53.9%, paid_search 55.4%, referral 55.8%, outbound_sales 56.6%; every |z| ≤ 1.04). Accept "no meaningful difference". (LinkedIn signups do buy more often; see Q14. That is a later step.)
- **Evidence:** `-- EVAL Q5`; Funnels onboarding steps, 7-day window, breakdown `acquisition_channel`.
- **Context needed:** 03-event-dictionary.md, 01-business.md (channels).
- **Grading:** must check the data and treat the gap as noise. Wrong: "yes, LinkedIn signups onboard worse"; ranking channels without a significance check.

### Q6 — Do chat and paging integrations matter?
- **Prompt:** "Does connecting Slack and PagerDuty actually speed up incident response?"
- **Type:** segmentation
- **Answer:** Yes, for acknowledgement, from the moment both are live. Among accounts set up before the window (customer_since before 2026-05-14), users whose profile `connected_integrations` holds **both Slack and PagerDuty** acknowledge alerts in **10.05 minutes on average vs 24.70 minutes** for everyone else (**0.41x**; 658 vs 4,131 users). Over all users the same profile cohort reads 15.83 vs 26.39 minutes (0.60x; median 9.6 vs 18.5), diluted because newer accounts connected the pair partway through the window. The within-user test is new signups who connect both during the window: their alerts took **32.81 minutes before the second integration was live and 13.77 minutes after (0.42x)**, and their pre-connection time matches new signups who never connect both (33.93 minutes). So the gap follows the connection, not which teams connect. Resolution time after acknowledgement does not change (130.3 vs 130.2 minutes for non-AI resolutions). Among alert recipients (7,438 users with at least one alert triggered), **1,230 (16.5%)** have both. Accept 0.35x-0.46x for the pre-window accounts (or 0.50x-0.66x for the all-user profile cohort with the dilution explained), a before/after drop for new users, and "no difference" for resolution.
- **Evidence:** H4-slack-pagerduty-response; Mixpanel (read 1): Insights, `alert acknowledged`, average `response_time_mins`, filter user property `customer_since` before 2026-05-14, breakdown by a cohort "user property `connected_integrations` contains slack AND contains pagerduty". The per-user before/after split at each new user's second `integration configured` has no direct Mixpanel report; it is a raw-data / SQL check. The closest Mixpanel view: the same Insights report filtered to `customer_since` on or after 2026-06-04, by week. The cohort's weekly average is about 34 minutes in the second half of June (one noisy week, Jun 8, reads 42.9 minutes on 24 acknowledgements), 24-26 from late July to mid-August, 20-22 from mid-August, and about 15 in the last two weeks of September, while the rest stays at 30-38 (whole window 23.67 vs 33.93 minutes). The early weeks are diluted by alerts from before each member connected the pair. `-- EVAL Q6`.
- **Context needed:** 03-event-dictionary.md (`connected_integrations`, `integration configured`, `response_time_mins`), 01-business.md (teams connect tools in their first weeks), 00-manifest.md (`customer_since`).
- **Grading:** must build the both-integrations cohort and separate acknowledgement from resolution. Full credit also handles timing (accounts that connected during the window: the raw-data before/after per user, or the weekly trend of the new-signup cohort). Wrong: "integrated teams resolve incidents faster" (resolution does not change); using only one of the two integrations; building the cohort only from in-window `integration configured` events for older accounts (their tools were connected before June 4, so many never send one of each); "it is only selection" (the before/after shows the drop).

### Q7 — Response time by company size
- **Prompt:** "How quickly do customers acknowledge alerts, and does it differ by company size?"
- **Type:** funnel
- **Answer:** Median time to acknowledge per alert: **enterprise 11.3 minutes, mid-market 18.6, SMB 18.2, startup 27.2**. Enterprise is about **0.61x** and startups about **1.48x** the pooled SMB/mid-market median (18.4 minutes). Averages show the same order (15.6, 26.0, 25.6, 37.8). Accept enterprise 0.54x-0.66x and startup 1.35x-1.65x.
- **Evidence:** H10-response-time-by-company-size; Funnels, `alert triggered` → `alert acknowledged`, counting: totals, hold `alert_id` constant, median time to convert, breakdown `company_size`; `-- EVAL Q7`.
- **Context needed:** 01-business.md (company sizes), 04-metrics-and-tables.md (MTTA).
- **Grading:** must measure per alert (same `alert_id`, totals counting), median preferred. Wrong: unique-user funnel time that pairs a user's first trigger with an unrelated later acknowledgement.

### Q8 — Are we paging people too much?
- **Prompt:** "Our SRE advisory board says alert noise is a problem. Is there evidence people ignore alerts when they get a lot of them?"
- **Type:** segmentation
- **Answer:** Yes. Acknowledgement rate by alerts received in the window: **1-6 alerts 86.8%, 7-12 85.9%**, then it falls: 13-18 77.4%, 19-24 64.5%, 25-29 49.7%, and **about 43% at 30+** (30-44: 42.9%, 45+: 42.9%). Roughly half of the would-be acknowledgements are lost for the heaviest recipients (0.50x vs the 1-12 group: 42.9% vs 86.2%). The decline starts above about 12 alerts and levels off at about 30. 805 users (10.8% of alert recipients) get 30+ alerts and receive 28.7% of all alerts. Accept a description of a decline starting near 12 and a floor near 30, with rates within ±3 points.
- **Evidence:** H11-alert-fatigue; Funnels, `alert triggered` → `alert acknowledged`, totals, hold `alert_id`, breakdown by a cohort on alert count; `-- EVAL Q8`.
- **Context needed:** 01-business.md (goal 4), 04-metrics-and-tables.md (acknowledgement rate).
- **Grading:** must show the rate by volume band, not just a correlation. Wrong: "a cliff at N alerts"; unique-user funnel rates (most users acknowledge at least one alert).

### Q9 — What predicts new-user retention?
- **Prompt:** "Is there something new users do in their first week that predicts whether they stick around?"
- **Type:** retention
- **Answer:** **Inviting teammates in the first 7 days, with 2+ invites as the practical bar, and finishing setup.** Day-30 retention (any activity in days 30-36) is **47.3% for users with 2+ first-week invites vs 18.9%** for users with 0-1 (about **2.5x**). By first-week invites: 0 invites 16.0%, 1 invite 25.2%, 2 invites 49.6%, 3 invites 43.2%, 4+ 45.1% (102 users); the big step is from 1 to 2. Finishing setup matters as much: users who reached `dashboard created` retain at 38.5% vs 7.2% at day 30 (90.5% vs 38.7% at day 7); signups who never finish setup almost all stop within six weeks. The invite effect holds within both groups (onboarded: 70.8% vs 30.5%; not onboarded: 19.2% vs 4.0%). Among onboarded users the ramp is 26.1% (0 invites, 933 users), 40.4% (1, 423 users), 70.8% (2+, 336 users). 79.7% of new users (signups through Aug 25) fall below 2 invites. Accept 2.1x-3.0x for 2+ vs fewer, a rising pattern, and mention of setup completion as a second factor.
- **Evidence:** H5-first-week-team-activation; build the groups in **Funnels**: `account created` → `teammate invited` → `teammate invited`, 7-day conversion window, uniques (completed = 2+ first-week invites, dropped after step 2 = one, dropped after step 1 = none); save each group as a cohort from the funnel; then **Retention**, `account created` → any event, **custom bracket** day 30-36 (day 7-13 for D7; the standard day buckets do not give a 7-day bracket), breakdown by those cohorts, optional filter "did `dashboard created`"; `-- EVAL Q9`.
- **Context needed:** 01-business.md (activation goal), 04-metrics-and-tables.md (retention definition).
- **Grading:** must define the behavior from the first week only and show the invite gradient. Wrong: using invites over the whole window (leaks the outcome); claiming invites are the only factor without checking setup completion; "a hard cliff, nothing below 2 matters". Note for graders: part of the gap is engagement (heavier users both invite more and are likelier to be active in the day-30 week), so "invites predict retention" is correct and "invites alone cause the whole 2.5x" overstates it.

### Q10 — Is Smart Test Selection working?
- **Prompt:** "Should we ship Smart Test Selection to everyone? What did the test show?"
- **Type:** funnel
- **Answer:** Yes. Since 2026-07-15, **80.9% of Smart Selection pipeline runs succeed and deploy vs 67.6% for Control** (about **1.20x**, 43,771 vs 45,352 runs), and the median time from run to deploy is **22.5 vs 30.1 minutes** (0.75x). Users in both arms run about the same number of pipelines (12.3 vs 12.6 per user), so the gain is per run, not more runs. The split is even (3,563 Smart Selection vs 3,600 Control users; the profile property and the one `$experiment_started` event per user agree on both counts). Accept 1.08x-1.32x for success and 0.68x-0.83x for time.
- **Evidence:** H6-smart-test-selection-experiment; Funnels `deployment pipeline run` → `service deployed`, totals, hold `deploy_id`, 1-day window, **date range 2026-07-15 to 2026-10-01** (the full window dilutes the lift with pre-test runs), breakdown `Experiment: Smart Test Selection` (or Insights share of `pipeline_status = success` over the same dates); `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (test start and arms), 03-event-dictionary.md (`deploy_id`, `pipeline_status`).
- **Grading:** must compare per run within the test window. Wrong: unique-user funnel conversion (almost every user deploys at least once, which hides the gap); including runs before July 15; comparing before vs after July 15 for everyone.

### Q11 — Late-August deploy failures
- **Prompt:** "Pipeline failures spiked for a few days in late August. What happened, and how many deploys did customers lose?"
- **Type:** external-join
- **Answer:** The **2026-08-25 to 2026-08-27 hosted CI runner incident in us-east**. `ci_runner_health_daily` shows `runner_status = major_outage` for us-east only, `infra_error_rate` ≈ 0.60 (0.59-0.62, vs under 1% normally), and p95 queue time of 1,501-1,739 seconds (vs under 70). In Mixpanel, us-east pipeline success fell to **30.5%** on those days (28.5%-32.4% per day) from 75.4% on the surrounding days (Aug 18-24 and Aug 28-Sep 3), while the other regions moved from 74.8% to 74.2%. Relative to the other regions, us-east ran at **0.41x** its normal success rate. About **744 deploys** did not happen (1,681 us-east runs on incident days). Accept 0.35-0.46 and 640-850 lost deploys.
- **Evidence:** H7-ci-runner-incident; Insights `deployment pipeline run`, share `pipeline_status = success`, daily, breakdown `runner_region`; warehouse join on date and `runner_region`; `-- EVAL Q11`.
- **Context needed:** 02-timeline.md (incident dates), 04-metrics-and-tables.md (`ci_runner_health_daily`), 03-event-dictionary.md (`runner_region`).
- **Grading:** must name the incident, the region, the dates, and a size. Wrong: blaming the Smart Test Selection test (both arms were hit alike) or customer code; saying all regions failed; using `jobs_started` as the Mixpanel run count (it also counts scheduled and API-triggered jobs).

### Q12 — Was the incident only us-east? (null for the other regions)
- **Prompt:** "Did the August runner incident hurt pipelines in our other regions too?"
- **Type:** external-join
- **Answer:** **No.** Pooled, the other three regions succeeded on **74.2% of runs during the incident vs 74.8%** on the surrounding days (2,535 incident runs; z = −0.65, p ≈ 0.5). By region: **us-west 73.3% vs 74.1%, eu-west 74.4% vs 75.3%, ap-south 76.1% vs 75.6%**. ap-south has only 405 incident runs; over the 17 Tuesday-to-Thursday spans in the window (about 407 runs each) its success ran from 64.5% to 77.5% (median 72.4%), and the incident span sits inside that range. Only us-east fell far outside its range (30.5% vs 75.4%). The warehouse agrees: only us-east shows `major_outage`. Accept "only us-east" with no meaningful drop elsewhere.
- **Evidence:** H7-ci-runner-incident; `-- EVAL Q12`.
- **Context needed:** 04-metrics-and-tables.md, 02-timeline.md.
- **Grading:** must check each region or the pooled other regions. Wrong: "all regions were affected".

### Q13 — What does a signup cost by channel?
- **Prompt:** "What are we paying per signup on each paid channel?"
- **Type:** external-join
- **Answer:** Spend per Mixpanel signup over the window: **LinkedIn Ads $427.86** (887 signups, $379,515), **G2 $206.10** (457 signups, $94,188), **paid search $145.55** (947 signups, $137,833). LinkedIn costs about **2.9x** paid search per signup and takes 62% of the $611,535 paid budget. Spend is a paced daily budget on a weekday schedule (LinkedIn $1,400-$4,395 per day, about half its daily average on weekends; never zero). Weekend signups fall further than weekend spend, and smaller channels have days with no signups (G2 7 days, paid search 2, LinkedIn 1), so daily cost per signup swings; use the window or monthly totals. Platform-reported leads overstate Mixpanel signups by about 17.5% (2,692 vs 2,291), which understates CAC. Accept LinkedIn/search 2.6x-3.3x and dollar values within ±3%.
- **Evidence:** H8-paid-channel-economics; warehouse `paid_marketing_daily.spend_usd` joined to `account created` by date and `acquisition_channel`; `-- EVAL Q13`.
- **Context needed:** 04-metrics-and-tables.md (CAC definition, spend table), 01-business.md (channels).
- **Grading:** must divide by Mixpanel signups over a period, not quote a single day. Wrong: using `platform_reported_leads`; comparing total spend only.

### Q14 — Is LinkedIn worth it?
- **Prompt:** "Marketing says LinkedIn brings our best customers. Is it worth what we pay compared with search?"
- **Type:** attribution
- **Answer:** LinkedIn signups **do convert better than search**. With the Mixpanel funnel default 30-day conversion window, for signups from June 4 to August 31 (each has its full 30 days in the data), **19.7% of LinkedIn signups start a paid subscription vs 8.2% for paid search** (126 of 639 vs 56 of 683), about **2.4x** (z ≈ 6.1). Other channels: outbound 16.8%, G2 13.7%, referral 11.5%, organic 11.2%. (A signup who joins a colleague's workspace cannot start a subscription, so these per-signup rates sit below the share of new workspaces that pay; the channel comparison is unaffected.) But a LinkedIn signup costs about 2.9x as much, so **cost per paying customer is highest on LinkedIn: about $2,228 vs $1,823 for paid search and $1,502 for G2** (June 4-August 31 spend divided by that period's paying signups). LinkedIn is the most expensive paid channel per paying customer, about 22% above search and 48% above G2. Accept a conversion ratio of 1.7x-3.0x and the conclusion that LinkedIn costs more per paying customer.
- **Evidence:** H8-paid-channel-economics; Funnels `account created` → `subscription started`, 30-day conversion window (Mixpanel default), date range Jun 4 - Aug 31, breakdown `acquisition_channel`; warehouse spend for the same days; `-- EVAL Q14`.
- **Context needed:** 01-business.md (channels, goal 2), 04-metrics-and-tables.md (cost per paying customer).
- **Grading:** must combine conversion and cost, with a stated conversion window. Wrong: "LinkedIn is best" from conversion alone, or "LinkedIn is worst" from CAC alone without noting that it converts better; comparing late-September signups that have not had their full window.

### Q15 — Did the Team price rise hurt Team sales?
- **Prompt:** "We raised the Team price on August 3. Did fewer people buy Team after that?"
- **Type:** trend
- **Answer:** **Not in subscription count; yes in seats.** Team new subscriptions held: 185 in the 60 days before the change vs 184 in the 60 days from Aug 3 (3.1 per day both times); in equal six-week windows (Jun 22 - Aug 2 vs Aug 3 - Sep 13) Team went from 122 to 128. Monthly Team subscriptions (Mixpanel): 91 in June, 89 July, 102 August, 85 September. What changed clearly is size: new Team subscriptions start with **8.46 seats on average vs 11.78 before (0.72x)**, while Business seats held (11.40 → 11.10). Business volume is a separate pattern: Business new subscriptions fell from 136 to 88 (67 a month in June and July, 50 in August, 36 in September) with no Business price or product change in the timeline, so Team's share of new subscriptions rose from 57.6% to 67.6% (z ≈ 2.5) because Business fell, not because Team grew. The Team price change does not explain the Business drop (a pricier Team plan would push buyers toward Business, not away). Accept "no drop in Team count" plus a seat ratio of 0.63-0.77; credit for flagging the Business decline as unexplained.
- **Evidence:** H9-team-price-change; Insights, `subscription started`, total and average `seats`, breakdown `plan`, weekly; `-- EVAL Q15`.
- **Context needed:** 02-timeline.md (price change), 01-business.md (plans).
- **Grading:** must look at seats, not only counts, and check Team volume directly. Wrong: "no effect" (misses seats); "Team sales collapsed"; "the price rise moved buyers from Business to Team" (Team volume did not rise; Business fell).

### Q16 — Did the price rise pay off?
- **Prompt:** "Even if seats dipped, did the higher Team price bring in more new Team MRR?"
- **Type:** external-join
- **Answer:** **No.** From `subscription_bookings_daily`, new MRR per Team subscription fell from **$248.54 to $223.60 (0.90x)** despite the 25% price rise, because billed seats per subscription fell by about 28% (12.4 → 8.9). A 25% higher price at the old seat counts would have given about $311. Business, at an unchanged price, held steady per subscription ($527.90 → $519.84). Team subscriptions per day held (3.32 before, 3.27 after in billing), so new Team MRR per day also fell, from $824 to $730 (−11%). Events joined to the list price give the same picture (Team $235.57 → $211.55 per subscription, 0.90x). The price rise did not pay off in new MRR. Accept a per-subscription ratio of 0.80-0.96 and "did not pay off".
- **Evidence:** H9-team-price-change; warehouse `subscription_bookings_daily` (or events joined to its prices on date and `plan`); `-- EVAL Q16`.
- **Context needed:** 04-metrics-and-tables.md (bookings table and caveats), 02-timeline.md.
- **Grading:** must use warehouse prices (price is not on events) and compare per subscription (or per day with a check that volume held). Wrong: multiplying seats by $25 for the whole window; ignoring the seat drop; "the price rise paid off" from the higher list price alone.

### Q17 — Did the quarter-close promotion work?
- **Prompt:** "Sales ran a seat promotion for the last two weeks of Q3. Did it drive seat expansion?"
- **Type:** trend
- **Answer:** Probably, as far as Mixpanel can show it: **Mixpanel does not track seats added to existing subscriptions** (04-metrics-and-tables.md: seat changes on existing subscriptions are billed outside the self-serve flow and are in neither Mixpanel nor `subscription_bookings_daily`), so teammate invitations are the best available proxy for seat expansion. On that proxy the promotion worked for paid workspaces. On paid plans (Team, Business, Enterprise by `plan_tier` on the event), teammate invitations per dashboard view rose from **0.1005 in the 30 days before (Aug 17 - Sep 15) to 0.1470 during the promotion (Sep 16-30), about 1.46x** (1.47x against Sep 1-15 alone: 0.1001 → 0.1470; invites 1,059 → 1,614 while dashboard views moved little, 10,578 vs 10,979). Free workspaces, which have no seats to discount, stayed about flat (0.162 → 0.152, 0.94x; 0.98x against Sep 1-15), which rules out a general September trend. The number of paid users sending invites did not rise (896 in Sep 1-15, 893 during the promotion), while invites per inviting user rose from 1.18 to 1.81: the lift is existing inviters inviting more people. Confirming actual seat expansion needs billing data on seat changes. Accept 1.30x-1.62x for paid plans (either baseline), "no meaningful change" for Free, and a statement that invites are a proxy.
- **Evidence:** H1-quarter-close-seat-push; Insights, `teammate invited` and `dashboard viewed`, daily, formula A/B, breakdown `plan_tier`, Sep 16-30 vs Aug 17 - Sep 15 (or Sep 1-15); `-- EVAL Q17`.
- **Context needed:** 02-timeline.md (promotion dates), 04-metrics-and-tables.md (seat expansion is not tracked).
- **Grading:** must normalize by a stable activity measure or compare like periods, should use Free as a control, and must say invites stand in for seats. Wrong: "Yes, seats grew 46%" (seats are not tracked); crediting Labor Day; reporting raw invites without a baseline; a blended all-plan lift without noting that Free did not move.

### Q18 — New bookings by month
- **Prompt:** "What did new self-serve bookings look like by month this summer, in new MRR?"
- **Type:** context
- **Answer:** From `subscription_bookings_daily`: **June $64,420 new MRR** (172 subscriptions; window starts June 4), **July $60,065** (165), **August $53,635** (161), **September $38,515** (130), October 1 $3,100 (8). New bookings fell every month, about 40% from June to September. By plan, Team was $24,820 / $23,840 / $24,475 / $19,075 and Business $39,600 / $36,225 / $29,160 / $19,440 for June-September. Two things drive the decline: Business subscriptions fell (74, 69, 54, 39) at an unchanged price and seat size, and Team deals after the August 3 price change carried fewer seats, so Team new MRR stayed flat through August and fell in September even though Team subscriptions held (98, 96, 107, 91; Team new MRR per subscription $253 in June vs $210 in September). Accept within ±1%.
- **Evidence:** warehouse `subscription_bookings_daily`; `-- EVAL Q18`.
- **Context needed:** 04-metrics-and-tables.md (bookings table, self-serve only), 02-timeline.md.
- **Grading:** must use the warehouse (prices are not on events), note the partial June, and split the decline by plan. Wrong: counting Enterprise; reporting ARR as MRR; blaming only the Team price change (Business fell more); expecting the table to match Mixpanel subscription counts exactly (billing includes a few checkouts Mixpanel missed and pre-invoice seat edits).

### Q19 — Did the runner incident spill over into alerting or dashboards? (null)
- **Prompt:** "During the August runner incident, did customers also stop acknowledging alerts or stop using dashboards?"
- **Type:** null-hypothesis
- **Answer:** **No.** Usage is weekday-heavy, so compare the incident days (Tue Aug 25 to Thu Aug 27) with the same weekdays one week before and one week after (Aug 18-20 and Sep 1-3). **63.4% of alerts triggered on incident days were acknowledged vs 63.8%** on the comparison days (2,802 vs 5,658 alerts; z = −0.36). Dashboard views did not fall: **1,236 per day vs 1,220** (+1.3%; incident days 1,220-1,250, comparison days 1,174-1,279; over all 17 Tuesday-to-Thursday spans in the window the daily average ran from 1,092 to 1,262, median 1,219). Queries: 905 per day vs 912. Acknowledgement was not slower either (23.0 vs 23.6 minutes on average; within the same users the change is +0.14 minutes, z = 0.13). Only pipelines were affected. Accept "no meaningful change".
- **Evidence:** `-- EVAL Q19`; Funnels `alert triggered` → `alert acknowledged` (hold `alert_id`) by trigger day, and Insights `dashboard viewed` total, daily.
- **Context needed:** 02-timeline.md.
- **Grading:** must check the data against comparable days. Wrong: "the whole platform was down"; "customers stopped working"; "usage rose during the incident" (a comparison with all surrounding days, weekends included, shows higher incident-day volume only because Tuesday to Thursday are busy days).

### Q20 — What to worry about in Q4
- **Prompt:** "Looking at this data, what should we worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names most of these, with numbers:
  1. **Falling new bookings**: new self-serve MRR fell from $64k in June to $39k in September. Business subscriptions fell from 74 to 39 a month with no price or product change (worth investigating), and Team deals shrank after the price change.
  2. **Team pricing**: the August 3 price rise cut new Team deals from 11.8 to 8.5 seats; new MRR per Team subscription fell 10% instead of rising with the 25% price increase. Revisit the price or seat packaging.
  3. **Azure onboarding**: Azure signups finish setup at 32% vs 62% for other clouds; Azure is 24% of signups, about 314 lost setups this window. Azure trails at every setup step, most at agent installed → dashboard created (60.5% vs 82.8%). Fix the Azure setup path, starting with the first dashboard after the agent reports.
  4. **Activation and setup**: 80% of new users invite fewer than 2 teammates in week one, and they retain at 19% vs 47% at day 30; signups who never finish setup retain at 39% at day 7 vs 91% and almost all stop within six weeks. Push team invites and setup completion in onboarding.
  5. **Alert fatigue**: 10.8% of alert recipients get 30+ alerts (28.7% of all alerts) and acknowledge only about 43% of them vs 86% for light recipients. Tune alert noise.
  6. **Paid acquisition mix**: LinkedIn takes 62% of the $611,535 paid budget; it converts about 2.4x better than search (30-day window) but costs about $2,228 per paying customer vs $1,823 (search) and $1,502 (G2).
  7. **Runner reliability**: the us-east incident cut success to 30.5% for three days and cost about 744 deploys.
  Positive signals to keep: Root Cause Assist cuts resolution time to 0.55x and settled at about 40% of eligible incidents after a four-week ramp; Smart Test Selection lifts pipeline success 1.20x and cuts time to deploy about 25% (ship it); connecting Slack + PagerDuty cuts acknowledgement time to about 0.4x (worth promoting to the 83% of alert recipients without both); the quarter-close promotion lifted paid-plan invites about 1.46x.
- **Evidence:** H1-H11; `-- EVAL Q20` (headline numbers).
- **Context needed:** all guides.
- **Grading:** full credit for at least four risks with supporting numbers and at least one recommended action. Partial credit for risks without numbers. Wrong: a generic list not grounded in the data.
