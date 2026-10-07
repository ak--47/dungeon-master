# Reelhouse (streaming) — 20-question eval

- **Data:** `data/verify-streaming` (full fidelity: 10,000 households, 9,966 with events, 4,867 new accounts, 3,989 trials started, 986,748 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query (or the `-- STORY` query it names) in `dungeons/vertical/streaming/streaming.sql` on that data.
- **Stories:** ids refer to the `stories` export in `streaming.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — How big was Saltmarsh season 2?
- **Prompt:** "Saltmarsh season 2 dropped in July. How many of our subscribers actually watched it in the first two weeks, and how far did they get?"
- **Type:** trend
- **Answer:** Of the **4,632** households that joined before the premiere and played anything from Jul 17 to Jul 30, **1,625 (35.1%)** started season 2 in that fortnight. Across the whole window **2,401** households started season 2 (this includes households that signed up for it). Season 2 viewers started **4.60 episodes** on average, **21.9%** started all 8 episodes, and there were **8,942** season 2 completions. No season 2 play exists before July 17. Accept 32%-38% reach.
- **Evidence:** H1-saltmarsh-season-2-premiere; Insights, `playback started`, Uniques, filter `title_name` = Saltmarsh and `season_number` = 2, divided by Uniques of all `playback started`, Jul 17-30, excluding households with `account created` on or after Jul 17 (or `member_since` before 2026-07-17); `-- STORY H1` and `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (premiere date, all episodes at once), 03-event-dictionary.md (`season_number`), 04-metrics-and-tables.md (title reach).
- **Grading:** must give reach as a share of viewing households and filter season 2. Wrong: counting season 1 plays of Saltmarsh; dividing by all 10,000 profiles (17%); counting plays instead of households.

### Q2 — Why did viewing jump in late July?
- **Prompt:** "Our plays chart spikes in the second half of July. What happened, and was it more people watching or the same people watching more?"
- **Type:** context
- **Answer:** The Saltmarsh season 2 premiere on 2026-07-17 (all 8 episodes) plus the new_season push that day. Plays per day went from **1,477** (Jul 3-16) to **2,187** (Jul 17-30, **+48%**) and back to **1,549** (Jul 31-Aug 13). Mostly the same households watched more: the **4,632** households that already had an account played **26,755** times in Jul 17-30 (**1,911 a day**, **+29%** on the 1,477 a day of the fortnight before, when every viewing household already had an account; **5.78** plays each vs **4.24** per viewing household before). The premiere also brought new households: **733** households that created their account on or after Jul 17 played **3,858** times (**12.6%** of the fortnight's plays), and accounts created per day ran **56.2** Jul 17 - Aug 6 vs **37.2** on other days. Viewing households went **4,870 → 5,365 → 5,131**. Season 2 was **31.8%** of all plays Jul 17-30 (9,737 plays). The new_season push reached **3,739** households and **714** opened it (19.1%). Accept +40% to +55% and "mostly existing households watching more, plus a wave of new signups".
- **Evidence:** H1-saltmarsh-season-2-premiere, H2-premiere-tourists; Insights, `playback started` daily (Totals and Uniques), breakdown `title_name`, and the same split by a cohort of households with `account created` on or after Jul 17; Insights `account created` daily; `-- EVAL Q2` and `-- STORY H2`.
- **Context needed:** 02-timeline.md (premiere and push), 01-business.md (Saltmarsh is the flagship Original).
- **Grading:** must name the premiere and separate plays from households, and size both parts (existing households watching more; new premiere signups). Wrong: "only new users" (existing households drive most of the increase); "no new users" (signups rose about 1.5x in the premiere weeks); attributing it to the July 4 holiday or to a paid budget increase (budgets did not change).

### Q3 — Did the Saltmarsh signups stick around?
- **Prompt:** "A lot of people signed up when Saltmarsh came back. Did they convert after their free trial like everyone else?"
- **Type:** funnel
- **Answer:** No. The premiere did bring a wave of signups: **56.2** accounts a day Jul 17 - Aug 6 vs **37.2** on other days (**1.51x**; weeks of Jul 13, Jul 20, Jul 27: **436, 453, 311** accounts vs about 230-300 in other weeks). Households that created their account from Jul 17 to Aug 6 converted their trial at **27.6%** (976 trials) vs **50.8%** for every other trial started from Jul 8 to Sep 23 (1,719 trials), about **0.54x**. **79.5%** of them started season 2 within a day of starting their trial. By signup week: the weeks of Jul 20 and Jul 27 converted at **27.5%** and **29.7%**, the week of Jul 13 (premiere from Friday) at 35.6% and the week of Aug 3 (premiere signups through Thursday) at 34.6%, vs **47.4%** the week of Jul 6 and **57.4%** / **51.3%** the weeks of Aug 10 and Aug 17. Accept 0.45x-0.65x and "they came for one show".
- **Evidence:** H2-premiere-tourists; Insights, `account created`, Totals, weekly; Funnels, `trial started` → `trial converted`, Uniques, 8-day window, trials Jul 8 - Sep 23, breakdown by a cohort of households with `account created` Jul 17 - Aug 6 (or `member_since`); `-- STORY H2` and `-- EVAL Q3`.
- **Context needed:** 02-timeline.md (premiere date, Smart Start start), 04-metrics-and-tables.md (trial conversion window).
- **Grading:** must compare against trials from the same period (the Smart Start test started Jul 8) and use the 8-day window. Wrong: comparing against June trials only (mixes in the test); counting trials that started after Sep 23 (incomplete windows).

### Q4 — Should we ship Smart Start?
- **Prompt:** "Is the Smart Start onboarding test working? Should we roll it out to everyone?"
- **Type:** funnel
- **Answer:** Yes. For trials started Jul 8 - Sep 23 (complete 8-day windows), **Smart Start converted 47.3%** (1,312 trials) vs **Control 37.8%** (1,382 trials): a **1.25x** lift, z ≈ 5.0. The split is balanced (48.6% of exposed households in Smart Start). Recommend shipping. Accept a lift of 1.12x-1.38x.
- **Evidence:** H3-smart-start-experiment; Funnels, `trial started` → `trial converted`, Uniques, 8-day window, date range Jul 8 - Sep 23, breakdown user property `Experiment: Smart Start` (or the Experiments report on `$experiment_started`); `-- STORY H3` and `-- EVAL Q4`.
- **Context needed:** 02-timeline.md (start date, arms), 04-metrics-and-tables.md (trial conversion).
- **Grading:** must compare arms within the test period and report size and significance. Wrong: comparing Smart Start households with all pre-July-8 trials; including trials without a complete window.

### Q5 — Does Smart Start make trials watch more? (null)
- **Prompt:** "Does Smart Start get new trials watching more in their first few days?"
- **Type:** null-hypothesis
- **Answer:** No meaningful difference. Trials in Smart Start completed **2.85** plays in their first 72 hours on average vs **2.87** in Control (t ≈ -0.22). It holds by signup platform too (mobile 2.75 vs 2.80, tablet 2.78 vs 2.86, tv 2.97 vs 2.90, web 2.76 vs 2.95; every |t| < 0.8). Smart Start raises conversion (Q4) without changing how much trials watch in the first three days.
- **Evidence:** H3-smart-start-experiment (early-viewing control); Insights, `playback completed` per household within 3 days of `trial started`, breakdown `Experiment: Smart Start`; `-- EVAL Q5`.
- **Context needed:** 02-timeline.md (arms), 03-event-dictionary.md (`playback completed`).
- **Grading:** must say no difference, with the numbers. Wrong: claiming Smart Start works by driving more early viewing.

### Q6 — Is there a magic number for trials?
- **Prompt:** "Is there an early viewing milestone that predicts whether a free trial turns into a paying subscriber?"
- **Type:** segmentation
- **Answer:** Yes: **3 completed plays in the first 72 hours**. Trial conversion by `playback completed` count in the first 72 h: 0 → **25.2%**, 1 → **32.4%**, 2 → **37.1%**, 3 → **54.9%**, 4 → **57.9%**, 5+ → **57.4%**. Trials with 3+ convert at **56.8%** vs **31.0%** for 0-2 (**1.83x**); above 3 the rate is flat (5+ vs 3-4: 57.4% vs 56.1%). The jump is between 2 and 3. Accept a threshold at 3 and a 3+/0-2 ratio of 1.6x-2.1x.
- **Evidence:** H4-three-episodes-in-three-days; Funnels, `trial started` → `playback completed` → `playback completed` → `playback completed`, 3-day window, create a cohort from step 4, then Funnels `trial started` → `trial converted` (8-day window) broken down by that cohort; `-- STORY H4` and `-- EVAL Q6`.
- **Context needed:** 01-business.md (growth team hint), 04-metrics-and-tables.md (trial conversion).
- **Grading:** must show the step between 2 and 3 and the plateau after it. Wrong: "more viewing is always better" (no gain above 3); counting `playback started` (includes plays that never finished) or using the whole trial instead of the first 3 days.

### Q7 — What happened to TV in late August?
- **Prompt:** "TV completion rates fell off a cliff for a few days in August. What happened?"
- **Type:** external-join
- **Answer:** The TV streaming incident, Aug 20-22. TV `playback completed` per `playback started` ran **0.73-0.81** on normal days and fell to **0.382, 0.393, 0.375** on Aug 20, 21, 22, then returned to **0.73** on Aug 23. Phones, tablets, and the web stayed at **0.65-0.71** throughout. TV `playback error` events jumped from **3-25 a day** to **394-438 a day**. `playback_qos_daily` shows `cdn_status` = `degraded` for tv on exactly those three days, with `playback_failure_rate` **0.49-0.50** (vs about 0.02) and `rebuffer_ratio` **8.1%-8.8%** (vs under 1%). Relative to other platforms, TV completion on incident days was **0.49x** its normal level.
- **Evidence:** H5-tv-streaming-incident; Insights, `playback completed` / `playback started`, daily, breakdown `platform`, joined to `playback_qos_daily` on date and platform; `-- STORY H5` and `-- EVAL Q7`.
- **Context needed:** 02-timeline.md (incident dates, TV apps), 04-metrics-and-tables.md (`playback_qos_daily`).
- **Grading:** must say TV only, give the dates, and use the warehouse status. Wrong: "viewers lost interest"; blaming all platforms; reading the drop as a content problem.

### Q8 — What did the incident cost?
- **Prompt:** "How many TV plays did we lose to the August CDN incident, and how many households hit errors?"
- **Type:** external-join
- **Answer:** On Aug 20-22 there were **1,911** TV playback starts and only **733** completions (**38.4%** vs **76.8%** on the 14 days either side), so about **734** completions were lost. There were **1,265** TV `playback error` events (**66 per 100 starts** vs 2.3 normally), and **656** households hit at least one error. Accept 620-850 lost completions and about 1,150-1,350 errors.
- **Evidence:** H5-tv-streaming-incident; Insights, TV `playback started`, `playback completed`, `playback error` (Totals and Uniques), Aug 20-22 vs Aug 6-19 and Aug 23 - Sep 5; `-- EVAL Q8`.
- **Context needed:** 02-timeline.md (incident window), 04-metrics-and-tables.md (completion rate, failure rate).
- **Grading:** must use a baseline completion rate to estimate the loss. Wrong: counting only errors as the loss; using a baseline that includes the incident days.

### Q9 — What did the price change do to the plan mix?
- **Prompt:** "We raised the Standard price for new subscribers in August. Did it change which plans new households pick?"
- **Type:** trend
- **Answer:** Yes, a shift to the ad tier. Share of `plan selected` before (Jun 4 - Aug 10) vs after (Aug 11 - Oct 1): **Standard 49.4% → 33.4% (0.68x)**, **Basic with Ads 30.1% → 49.0% (1.63x)**, Premium 20.5% → 17.6%. Plan selections per day stayed about the same once the Saltmarsh premiere weeks are set aside (**34.9** a day on the other before-days, **51.2** during Jul 17 - Aug 6, **32.9** after; the 34.9 vs 32.9 gap is within day-to-day noise, z ≈ 1.7), so the change moved households down a tier rather than stopping them from signing up. Accept a Standard share of 0.60x-0.75x of before and a Basic with Ads gain of 1.4x-1.8x; Premium may be described as flat or slightly lower.
- **Evidence:** H6-standard-price-increase; Insights, `plan selected`, breakdown `plan`, % of total, before vs after Aug 11; `-- STORY H6` and `-- EVAL Q9`.
- **Context needed:** 02-timeline.md (date, which prices changed), 01-business.md (plans).
- **Grading:** must compare shares, not counts, and name the move to Basic with Ads. Wrong: "signups fell after the change" (the before period includes the premiere signup wave; outside it the daily rate is flat); comparing raw counts of periods with different lengths.

### Q10 — Did the price change raise revenue per new subscriber?
- **Prompt:** "Did the Standard price increase actually raise what we earn from each new subscriber?"
- **Type:** external-join
- **Answer:** No. From `subscription_billing_daily`, the average list price per new paid subscription was **$11.65** for first charges Jun 4 - Aug 10 and **$11.19** for Aug 18 - Oct 1 (about **-4%**). The week of Aug 11-17 shows **$13.44** because trials that chose Standard before the change paid the new price at their first charge. From Aug 18 on, first charges come from households that saw the new price, and Standard fell from **48.1%** to **32.0%** of new paid subscriptions as households traded down to Basic with Ads. Joining Mixpanel `trial converted` to the warehouse price gives the same picture ($11.82 → $11.15). Accept flat to slightly down (-8% to +2%) with the trade-down explanation.
- **Evidence:** H6-standard-price-increase; warehouse `subscription_billing_daily` (`gross_bookings_usd` / `new_paid_subscriptions`) by period, or Mixpanel `trial converted` by `plan` joined to `list_price_usd` on date and plan; `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (price set at first charge), 04-metrics-and-tables.md (`subscription_billing_daily`, average price per new subscription).
- **Grading:** must use the warehouse prices and account for the plan mix. The trade-down to Basic with Ads alone, at an unchanged Premium share, gives about -2% ($11.69 → $11.47 at list prices); the rest of the measured -4% comes from a smaller Premium share after Aug 11 (20.5% → 17.6% of plan selections), which the price change does not explain (Premium's price did not change). Accept either reading if the answer names the Standard-to-Basic trade-down. Wrong: "+17% per subscriber" (applies the Standard increase to everyone); counting the Aug 11-17 transition week as "after".

### Q11 — Which paid channel is worth it?
- **Prompt:** "Which paid channel gives us the cheapest new subscribers? Paid social looks cheapest, is it?"
- **Type:** external-join
- **Answer:** Paid social is cheapest per account but not per paying subscriber. Over the window: **paid_social $21.35 per account**, trial conversion **27.1%**, **$102.42 per paying subscriber**; **paid_search $31.54**, **49.9%**, **$79.51**; **ctv $48.42**, **47.9%**, **$131.52**. Paid social trials convert at about **0.55x** the other channels (27.1% vs 48.9%), so per paying subscriber it costs about **1.29x** paid search. Paid search is the most efficient channel; ctv is the most expensive. Accept the ranking search < social < ctv per paying subscriber.
- **Evidence:** H7-paid-social-cac; Insights `account created` by `acquisition_channel` joined to `marketing_spend_daily.spend_usd`; Funnels `trial started` → `trial converted` (8-day window) breakdown user property `acquisition_channel`; `-- STORY H7` and `-- EVAL Q11`.
- **Context needed:** 04-metrics-and-tables.md (CAC uses Mixpanel accounts; `marketing_spend_daily`), 01-business.md (channels).
- **Grading:** must go past cost per signup to cost per paying subscriber. Wrong: using `platform_reported_signups` for CAC; ranking by cost per signup only.

### Q12 — Who cancels least?
- **Prompt:** "Which subscribers are least likely to cancel? Is there a segment we should be protecting?"
- **Type:** retention
- **Answer:** Households with more than one viewer profile. Renewal-time churn (paid cancellations / renewals due): **1 profile 5.74%**, 2 profiles 3.22%, 3 profiles 3.16%, 4 profiles 2.68%, 5 profiles 3.01%. Shared households (2+ profiles) churn **3.06%** vs **5.74%** for single-profile accounts, about **0.53x**. Plan does not explain it (basic_ads 4.14%, standard 3.76%, premium 4.36%). Getting a household to set up a second profile is a retention lever worth testing. Accept 0.45x-0.60x.
- **Evidence:** H8-shared-households-stay; Insights, A = `subscription cancelled` (`during_trial` = false), B = `subscription renewed`, formula A / (A + B), breakdown user property `profile_count`; `-- STORY H8` and `-- EVAL Q12`.
- **Context needed:** 04-metrics-and-tables.md (renewal-time churn excludes trial cancellations), 03-event-dictionary.md (`profile_count`).
- **Grading:** must exclude trial cancellations and normalize by renewals due. Wrong: counting all cancellations (trial cancellations dominate); "kids profiles cause retention" without checking profile count.

### Q13 — Which pushes work?
- **Prompt:** "Which push notifications actually get opened? Should we keep sending the trending ones?"
- **Type:** segmentation
- **Answer:** Personalized pushes win. Open rate (opens / delivered): **new_season 19.1%** (the one-off Saltmarsh push), **new_episode 15.1%**, **because_you_watched 9.2%**, **trending_now 4.8%**, **win_back 2.9%**. A new_episode push is opened about **3.2x** as often as a trending_now push, because_you_watched about **1.9x**. About half of opens lead to a play within 10 minutes for new_episode (51.2%), because_you_watched (51.0%), and trending_now (48.9%); win_back opens lead to none (those households no longer have access). Accept the ranking and a new_episode / trending_now ratio of 2.6x-3.6x.
- **Evidence:** H9-personalized-pushes; Insights, `notification opened` / `notification received` (Totals), breakdown `campaign_type`; `-- STORY H9` and `-- EVAL Q13`.
- **Context needed:** 01-business.md (campaign types), 04-metrics-and-tables.md (open rate).
- **Grading:** must use rates by campaign type. Wrong: comparing raw opens (different send volumes); judging win_back by plays.

### Q14 — Is search harder on TV?
- **Prompt:** "Is search harder on TV? The TV team wants to prioritize voice search."
- **Type:** funnel
- **Answer:** Slower, not less successful. Median time from `search performed` to the play it leads to is **162.9 s on tv** vs **75.9 s mobile, 74.1 s tablet, 75.2 s web**, about **2.2x**. The share of searches that end in a play within an hour is about the same everywhere (**58.6%-60.5%**; tv 59.1%). TV households find what they want as often but take more than twice as long, which supports voice search. Accept 2.0x-2.4x.
- **Evidence:** H10-tv-search-is-slow; Funnels, `search performed` → `playback started`, hold `search_id` constant, 1-hour window, median time to convert, breakdown `platform`; `-- STORY H10` and `-- EVAL Q14`.
- **Context needed:** 03-event-dictionary.md (`search_id`), 04-metrics-and-tables.md (search to play).
- **Grading:** must separate speed from success. Wrong: "TV search fails more"; matching a search to any later play without `search_id`.

### Q15 — What did paid marketing buy in Q3?
- **Prompt:** "How much did we spend on paid marketing in Q3, and how many paying subscribers did we get for it?"
- **Type:** external-join
- **Answer:** Q3 (Jul 1 - Sep 30) paid spend was **$64,461** (paid_search $21,981, ctv $21,772, paid_social $20,708). Paid channels brought **2,154** new accounts ($29.93 each), and **652** of them were paying subscribers by Oct 1 (**$98.87** per paying subscriber): paid_search 278 ($79.07 each), paid_social 209 ($99.08), ctv 165 ($131.95). Spend ran higher in the Saltmarsh premiere weeks because the bid-based part of spend follows delivered signups. Households that signed up in the last week of September were still in trial on Oct 1, so the paying count is slightly understated. Accept $61,000-$68,000 and $90-$108 per paying subscriber.
- **Evidence:** H7-paid-social-cac; `marketing_spend_daily` summed Jul 1 - Sep 30 by channel; Mixpanel `account created` Jul 1 - Sep 30 by `acquisition_channel`, then `trial converted`; `-- EVAL Q15`.
- **Context needed:** 04-metrics-and-tables.md (`marketing_spend_daily`, CAC), 00-manifest.md (Q3 = Jul 1 - Sep 30).
- **Grading:** must use the warehouse for spend and Mixpanel for accounts. Wrong: using the whole window; using `platform_reported_signups`.

### Q16 — Do Canadian households behave differently? (null)
- **Prompt:** "Do our Canadian households convert their trials differently from US households? Should we treat Canada as its own market?"
- **Type:** null-hypothesis
- **Answer:** No meaningful difference. Trial conversion is **43.4%** in the US (3,142 trials) and **43.4%** in Canada (602 trials), z ≈ 0.0. Within each Smart Start arm the gap is also small (Control 37.5% vs 39.2%, z ≈ 0.5; Smart Start 46.7% vs 50.5%, z ≈ 1.0). Renewal-time churn is the same too (4.01% vs 3.96%, z ≈ -0.1). No case for a separate Canadian playbook on these numbers.
- **Evidence:** Funnels `trial started` → `trial converted` (8-day window), breakdown user property `country`; Insights renewal-time churn by `country`; `-- EVAL Q16`.
- **Context needed:** 01-business.md (markets), 04-metrics-and-tables.md (trial conversion, churn).
- **Grading:** must say no difference and give both rates. Wrong: reading the small Smart Start-arm gap as a finding.

### Q17 — Why did trial conversion move month to month?
- **Prompt:** "Trial conversion was lower in July and then climbed through September. What's going on?"
- **Type:** context
- **Answer:** Two things from the timeline. By month the trial started: **June 45.4%**, **July 36.1%**, **August 45.6%**, **September (1-23) 51.4%**. July was dragged down by Saltmarsh premiere signups (**61.8%** of July trials came from accounts created Jul 17 - Aug 6, which convert at about half the normal rate; see Q3), and they were still **19.9%** of August trials. From July 8 the Smart Start test lifted half of all new trials (see Q4); by September there were no premiere signups left and half the trials were in Smart Start, so September is the best month. Accept the two named drivers with the monthly numbers.
- **Evidence:** H2-premiere-tourists, H3-smart-start-experiment; Funnels `trial started` → `trial converted`, 8-day window, by month of trial start, with breakdowns by signup date and `Experiment: Smart Start`; `-- EVAL Q17`.
- **Context needed:** 02-timeline.md (premiere, Smart Start start), 04-metrics-and-tables.md (complete windows).
- **Grading:** must name both the premiere signups and the test. Wrong: a seasonal story; including late-September trials with incomplete windows.

### Q18 — What is our monthly churn?
- **Prompt:** "What's our monthly churn rate for paying subscribers, and why do people cancel?"
- **Type:** retention
- **Answer:** About **4.0% a month**. Renewal-time churn over the window is **4.00%** (paid cancellations / renewals due): June 4.24%, July 3.83%, August 4.26%, September 3.81% (October 1 alone is too short to read). Top paid cancellation reasons: **too_expensive (268)**, **not_enough_to_watch (224)**, **taking_a_break (168)**, then switching_service (108). Trial cancellations are separate (they are part of trial conversion). Accept 3.5%-4.5%.
- **Evidence:** H8-shared-households-stay (segments); Insights, A = `subscription cancelled` (`during_trial` = false), B = `subscription renewed`, A / (A + B), monthly; `cancel_reason` breakdown; `-- EVAL Q18`.
- **Context needed:** 04-metrics-and-tables.md (renewal-time churn), 03-event-dictionary.md (`cancel_reason`, `during_trial`).
- **Grading:** must exclude trial cancellations. Wrong: dividing cancellations by all households; mixing in trial cancellations (much higher).

### Q19 — What should we worry about? (open-ended)
- **Prompt:** "What should we be worried about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer covers most of these, with numbers: (1) **Trial conversion hinges on the first three days**: trials with fewer than 3 completed plays convert at 31.0% vs 56.8% (Q6), so onboarding should push early viewing; Smart Start already lifts conversion 1.25x and should ship (Q4). (2) **Premiere signups churn at trial end**: Saltmarsh brought about 1.5x the usual daily signups for three weeks, but those households converted at 28% (Q3); the next big release needs a plan to keep them. (3) **The Standard price rise did not raise revenue per new subscriber** ($11.65 → $11.19) because households traded down to Basic with Ads (Q9, Q10). (4) **Paid social is expensive per paying subscriber** ($102 vs $80 for paid search) despite the lowest cost per account (Q11). (5) **TV reliability**: one CDN fault cost about 734 completions in three days on the biggest screen (Q8). (6) **Single-profile households churn about twice as fast** (5.7% vs 3.1% a month, Q12). Context: 6,285 households watched in September and 6,036 subscriptions were active on Oct 1.
- **Evidence:** the story queries for H2-H8; `-- EVAL Q19` for the headline numbers.
- **Context needed:** all guides.
- **Grading:** reward answers that rank issues by size and tie each to data. Wrong: generic advice without numbers; calling the late-July viewing spike a lasting trend.

### Q20 — Does billing agree with Mixpanel?
- **Prompt:** "Finance's new-subscription numbers never match Mixpanel. How far apart are they, and what were first-month bookings by month?"
- **Type:** external-join
- **Answer:** Billing runs a little above Mixpanel. New paid subscriptions by month in `subscription_billing_daily` vs Mixpanel `trial converted`: **June 377 vs 368**, **July 492 vs 473**, **August 447 vs 418**, **September 463 vs 449** (October 1: 10 vs 10), about 2%-7% higher in billing because some app-store purchases never reach Mixpanel (net of same-day refunds). First-month bookings: **$4,416** (June 4-30), **$5,656** (July), **$5,318** (August), **$5,172** (September). Accept the direction and size of the gap and the monthly bookings.
- **Evidence:** warehouse `subscription_billing_daily` summed by month vs Mixpanel `trial converted` monthly totals; `-- EVAL Q20`.
- **Context needed:** 04-metrics-and-tables.md (`subscription_billing_daily` caveats), 00-manifest.md (June starts on the 4th).
- **Grading:** must explain the gap with the table caveats. Wrong: treating the gap as a tracking outage; comparing billing with `trial started`.
