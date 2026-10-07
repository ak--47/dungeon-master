# Reelhouse (streaming) — 20-question eval

- **Data:** `data/verify-streaming` (full fidelity: 10,000 households, 9,953 with events, 5,022 new accounts, 4,130 trials started, 975,185 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query (or the `-- STORY` query it names) in `dungeons/vertical/streaming/streaming.sql` on that data.
- **Stories:** ids refer to the `stories` export in `streaming.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — How big was Saltmarsh season 2?
- **Prompt:** "Saltmarsh season 2 dropped in July. How many of our subscribers actually watched it in the first two weeks, and how far did they get?"
- **Type:** trend
- **Answer:** Of the **4,507** households that joined before the premiere and played anything from Jul 17 to Jul 30, **1,593 (35.3%)** started season 2 in that fortnight. Season 2 kept finding viewers after the fortnight: across the whole window **3,779** households started season 2 (this includes premiere signups, members who caught up in August and September, and later signups). New season 2 viewers by week: **1,180** (week of Jul 13, premiere Friday), **811**, **391**, **304**, then a tail of about **135-185** a week through mid-September that falls to **89** in the week of Sep 21. Season 2 viewers started **4.10 episodes** on average, **17.0%** started all 8 episodes, and there were **12,829** season 2 completions in the window. No season 2 play exists before July 17. Accept 32%-38% reach.
- **Evidence:** H1-saltmarsh-season-2-premiere; Insights, date range Jul 17-30, chart type Bar or Metric (Uniques then counts each household once over the range; a daily line chart shows daily uniques instead), A = `playback started`, Uniques, filter `title_name` = Saltmarsh and `season_number` = 2, B = `playback started`, Uniques, formula A / B, excluding households with `account created` on or after Jul 17 (or `member_since` before 2026-07-17); `-- STORY H1` and `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (premiere date, all episodes at once), 03-event-dictionary.md (`season_number`), 04-metrics-and-tables.md (title reach).
- **Grading:** must give reach as a share of viewing households and filter season 2. Wrong: counting season 1 plays of Saltmarsh; dividing by all 10,000 profiles (16%); counting plays instead of households; giving the whole-window viewer count as the first-two-weeks answer.

### Q2 — Why did viewing jump in late July?
- **Prompt:** "Our plays chart spikes in the second half of July. What happened, and was it more people watching or the same people watching more?"
- **Type:** context
- **Answer:** The Saltmarsh season 2 premiere on 2026-07-17 (all 8 episodes) plus the new_season push that day. Plays per day went from **1,389** (Jul 3-16) to **2,114** (Jul 17-30, **+52%**) and back to **1,582** (Jul 31-Aug 13). Mostly the same households watched more: the **4,507** households that already had an account played **25,426** times in Jul 17-30 (**1,816 a day**, **+31%** on the 1,389 a day of the fortnight before, when every viewing household already had an account; **5.64** plays each vs **4.07** per viewing household before). The premiere also brought new households: **755** households that created their account on or after Jul 17 played **4,169** times (**14.1%** of the fortnight's plays), and accounts created per day ran **60.1** Jul 17 - Aug 6 vs **38.0** on other days. Viewing households went **4,777 → 5,262 → 5,121**. Season 2 was **32.6%** of all plays Jul 17-30 (9,646 plays) and **11.9%** in Jul 31-Aug 13. The new_season push reached **3,707** households and **712** opened it (19.2%). Accept +45% to +60% and "mostly existing households watching more, plus a wave of new signups".
- **Evidence:** H1-saltmarsh-season-2-premiere, H2-premiere-tourists; Insights, `playback started` daily Totals, breakdown `title_name`; viewing households per fortnight with Uniques on a Bar or Metric chart over each fortnight (a daily line shows daily uniques); and the same split by a cohort of households with `account created` on or after Jul 17; Insights `account created` daily; `-- EVAL Q2` and `-- STORY H2`.
- **Context needed:** 02-timeline.md (premiere and push), 01-business.md (Saltmarsh is the flagship Original).
- **Grading:** must name the premiere and separate plays from households, and size both parts (existing households watching more; new premiere signups). Wrong: "only new users" (existing households drive most of the increase); "no new users" (signups rose about 1.6x in the premiere weeks); attributing it to the July 4 holiday or to a paid budget increase (budgets did not change).

### Q3 — Did the Saltmarsh signups stick around?
- **Prompt:** "A lot of people signed up when Saltmarsh came back. Did they convert after their free trial like everyone else?"
- **Type:** funnel
- **Answer:** No. The premiere did bring a wave of signups: **60.1** accounts a day Jul 17 - Aug 6 vs **38.0** on other days (**1.58x**; weeks of Jul 13, Jul 20, Jul 27: **461, 468, 339** accounts vs about 240-290 in other full weeks). Households that created their account from Jul 17 to Aug 6 converted their trial at **30.2%** (1,038 trials) vs **49.6%** for every other trial started from Jul 8 to Sep 23 (1,792 trials), about **0.61x**. **78.8%** of them started season 2 within a day of starting their trial, vs **4.3%** of the other trials. By signup week: the weeks of Jul 13 (premiere from Friday), Jul 20, and Jul 27 converted at **36.7%**, **31.3%**, and **31.0%**, the week of Aug 3 (premiere signups through Thursday) at 33.5%, vs **55.5%** the week of Jul 6 and **56.2%** / **44.5%** the weeks of Aug 10 and Aug 17. Accept 0.50x-0.70x and "they came for one show".
- **Evidence:** H2-premiere-tourists; Insights, `account created`, Totals, weekly; Funnels, `trial started` → `trial converted`, Uniques, 8-day window, trials Jul 8 - Sep 23, breakdown by a cohort of households with `account created` Jul 17 - Aug 6 (or `member_since`); `-- STORY H2` and `-- EVAL Q3`.
- **Context needed:** 02-timeline.md (premiere date, Smart Start start), 04-metrics-and-tables.md (trial conversion window).
- **Grading:** must compare against trials from the same period (the Smart Start test started Jul 8) and use the 8-day window. Wrong: comparing against June trials only (mixes in the test); counting trials that started after Sep 23 (incomplete windows).

### Q4 — Should we ship Smart Start?
- **Prompt:** "Is the Smart Start onboarding test working? Should we roll it out to everyone?"
- **Type:** funnel
- **Answer:** Yes. For trials started Jul 8 - Sep 23 (complete 8-day windows), **Smart Start converted 45.8%** (1,463 trials) vs **Control 38.9%** (1,367 trials): a **1.18x** lift, z ≈ 3.7. The split is close to even (51.7% of exposed households in Smart Start). Recommend shipping. Accept a lift of 1.08x-1.32x.
- **Evidence:** H3-smart-start-experiment; Funnels, `trial started` → `trial converted`, Uniques, 8-day window, date range Jul 8 - Sep 23, breakdown user property `Experiment: Smart Start` (or the Experiments report on `$experiment_started`); `-- STORY H3` and `-- EVAL Q4`.
- **Context needed:** 02-timeline.md (start date, arms), 04-metrics-and-tables.md (trial conversion).
- **Grading:** must compare arms within the test period and report size and significance. Wrong: comparing Smart Start households with all pre-July-8 trials; including trials without a complete window.

### Q5 — Does Smart Start make trials watch more? (null)
- **Prompt:** "Does Smart Start get new trials watching more in their first few days?"
- **Type:** null-hypothesis
- **Answer:** No meaningful difference. In the first 72 hours after `trial started`, **80.0%** of Smart Start trials completed at least one play vs **80.0%** in Control, **63.5%** vs **62.8%** completed two, and **47.2%** vs **46.7%** completed three (z ≈ 0.3). The mean is **2.84** completed plays in both arms (2.840 vs 2.837, t ≈ 0.0). It holds by signup platform too (mobile 2.80 vs 2.92, tablet 2.68 vs 2.95, tv 2.94 vs 2.77, web 2.73 vs 2.78; every |t| < 1.2). Smart Start raises conversion (Q4) without changing how much trials watch in the first three days.
- **Evidence:** H3-smart-start-experiment (early-viewing control); Funnels, `trial started` → `playback completed` → `playback completed` → `playback completed`, Uniques, 3-day conversion window, trials Jul 8 - Sep 23, breakdown user property `Experiment: Smart Start` (step 2, 3, and 4 conversion = 1, 2, and 3 completions); `-- EVAL Q5`.
- **Context needed:** 02-timeline.md (arms), 03-event-dictionary.md (`playback completed`).
- **Grading:** must say no difference, with the numbers. Wrong: claiming Smart Start works by driving more early viewing.

### Q6 — Is there a magic number for trials?
- **Prompt:** "Is there an early viewing milestone that predicts whether a free trial turns into a paying subscriber?"
- **Type:** segmentation
- **Answer:** Yes: **3 completed plays in the first 72 hours**. Trial conversion by `playback completed` count in the first 72 h: 0 → **25.4%**, 1 → **31.9%**, 2 → **38.5%**, 3 → **54.9%**, 4 → **58.9%**, 5+ → **57.2%**. Trials with 3+ convert at **56.9%** vs **31.4%** for 0-2 (**1.81x**); above 3 the rate is flat (5+ vs 3-4: 57.2% vs 56.6%). The jump is between 2 and 3. Accept a threshold at 3 and a 3+/0-2 ratio of 1.6x-2.0x.
- **Evidence:** H4-three-episodes-in-three-days; Funnels, `trial started` → `playback completed` → `playback completed` → `playback completed`, 3-day window, create a cohort from step 4, then Funnels `trial started` → `trial converted` (8-day window) broken down by that cohort; `-- STORY H4` and `-- EVAL Q6`.
- **Context needed:** 01-business.md (growth team hint), 04-metrics-and-tables.md (trial conversion).
- **Grading:** must show the step between 2 and 3 and the plateau after it. Wrong: "more viewing is always better" (no gain above 3); counting `playback started` (includes plays that never finished) or using the whole trial instead of the first 3 days.

### Q7 — What happened to TV in late August?
- **Prompt:** "TV completion rates fell off a cliff for a few days in August. What happened?"
- **Type:** external-join
- **Answer:** The streaming incident, Aug 20-22, which hit the TV apps only. TV `playback completed` per `playback started` ran **0.73-0.77** on the normal days around it (Aug 16-26) and fell to **0.419, 0.371, 0.407** on Aug 20, 21, 22, then returned to **0.75** on Aug 23. Phones, tablets, and the web stayed at **0.64-0.71** throughout. TV `playback error` events jumped from **12-24 a day** to **383-427 a day**. `playback_qos_daily` shows `cdn_status` = `degraded` for tv on exactly those three days, with `playback_failure_rate` **0.49-0.50** (vs about 0.02) and `rebuffer_ratio` **8.1%-8.8%** (vs under 1%). Relative to other platforms, TV completion on incident days was **0.52x** its normal level.
- **Evidence:** H5-tv-streaming-incident; Insights, `playback completed` / `playback started`, daily, breakdown `platform`, joined to `playback_qos_daily` on date and platform; `-- STORY H5` and `-- EVAL Q7`.
- **Context needed:** 02-timeline.md (incident dates; it points to the warehouse table for the platforms affected), 04-metrics-and-tables.md (`playback_qos_daily`).
- **Grading:** must say TV only, give the dates, and use the warehouse status. Wrong: "viewers lost interest"; blaming all platforms; reading the drop as a content problem.

### Q8 — What did the incident cost?
- **Prompt:** "How many TV plays did we lose to the August CDN incident, and how many households hit errors?"
- **Type:** trend
- **Answer:** On Aug 20-22 there were **1,914** TV playback starts and only **763** completions (**39.9%** vs **75.6%** on the 14 days either side), so about **685** completions were lost. There were **1,218** TV `playback error` events (**64 per 100 starts** vs 2.6 normally), and **677** households hit at least one error. Accept 590-780 lost completions and about 1,100-1,340 errors.
- **Evidence:** H5-tv-streaming-incident; Insights, TV `playback started`, `playback completed`, `playback error` (Totals; households with an error = Uniques of `playback error` on a Bar or Metric chart over Aug 20-22), Aug 20-22 vs Aug 6-19 and Aug 23 - Sep 5; `-- EVAL Q8`.
- **Context needed:** 02-timeline.md (incident window), 04-metrics-and-tables.md (completion rate, failure rate).
- **Grading:** must use a baseline completion rate to estimate the loss. Wrong: counting only errors as the loss; using a baseline that includes the incident days.

### Q9 — What did the price change do to the plan mix?
- **Prompt:** "We raised the Standard price for new subscribers in August. Did it change which plans new households pick?"
- **Type:** trend
- **Answer:** Yes, a shift to the ad tier. Share of `plan selected` before (Jun 4 - Aug 10) vs after (Aug 11 - Oct 1): **Standard 50.7% → 31.9% (0.63x)**, **Basic with Ads 29.7% → 47.4% (1.60x)**, Premium 19.6% → 20.7% (about unchanged). Plan selections per day stayed about the same once the Saltmarsh premiere weeks are set aside (**34.7** a day on the other before-days, **55.3** during Jul 17 - Aug 6, **34.9** after), so the change moved households down a tier rather than stopping them from signing up. Accept a Standard share of 0.55x-0.72x of before and a Basic with Ads gain of 1.4x-1.75x, with Premium about flat.
- **Evidence:** H6-standard-price-increase; Insights, `plan selected`, breakdown `plan`, % of total, before vs after Aug 11; `-- STORY H6` and `-- EVAL Q9`.
- **Context needed:** 02-timeline.md (date, which prices changed), 01-business.md (plans).
- **Grading:** must compare shares, not counts, and name the move to Basic with Ads. Wrong: "signups fell after the change" (the before period includes the premiere signup wave; outside it the daily rate is flat); comparing raw counts of periods with different lengths.

### Q10 — Did the price change raise revenue per new subscriber?
- **Prompt:** "Did the Standard price increase actually raise what we earn from each new subscriber?"
- **Type:** external-join
- **Answer:** No, it stayed about flat. From `subscription_billing_daily`, the average list price per new paid subscription was **$11.73** for first charges Jun 4 - Aug 10 and **$11.64** for Aug 18 - Oct 1 (about **-1%**). The week of Aug 11-17 shows **$12.84** because trials that chose Standard before the change paid the new price at their first charge. From Aug 18 on, first charges come from households that saw the new price, and Standard fell from **47.6%** to **33.2%** of new paid subscriptions as households traded down to Basic with Ads; the extra $2 on the remaining Standard subscriptions about offsets the trade-down. The plain split at Aug 11 (transition week counted as after) gives **$11.73 → $11.76** (+0.3%), the same flat conclusion. Joining Mixpanel `trial converted` to the warehouse price gives the same picture ($11.83 → $11.63). Accept flat to slightly down (-5% to +2%) with the trade-down explanation.
- **Evidence:** H6-standard-price-increase; warehouse `subscription_billing_daily` (`gross_bookings_usd` / `new_paid_subscriptions`) by period, or Mixpanel `trial converted` by `plan` joined to `list_price_usd` on date and plan; `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (price set at first charge), 04-metrics-and-tables.md (`subscription_billing_daily`, average price per new subscription).
- **Grading:** must use the warehouse prices and account for the plan mix. Best answer: split at Aug 18 (first charges from households that saw the new price) and explain the transition week. Also correct: the plain split at Aug 11 ($11.73 → $11.76) when the answer concludes "flat, because households traded down to Basic with Ads". At list prices the designed mix moves the average from about $11.69 to $11.47 (-2%); the measured -1% is within the noise of the conversion mix. Premium's share did not change in a meaningful way. Wrong: "+17% per subscriber" (applies the Standard increase to everyone); reading the Aug 11-17 week alone as the new level; "revenue per subscriber fell sharply".

### Q11 — Which paid channel is worth it?
- **Prompt:** "Which paid channel gives us the cheapest new subscribers? Paid social looks cheapest, is it?"
- **Type:** external-join
- **Answer:** Paid social is cheapest per account but not per paying subscriber. Over the window: **paid_social $20.60 per account**, trial conversion **27.7%**, **$96.76 per paying subscriber**; **paid_search $32.54**, **47.7%**, **$86.40**; **ctv $45.84**, **48.0%**, **$122.86**. Paid social trials convert at about **0.56x** the other channels (27.7% vs 49.1%), so per paying subscriber it costs about **1.12x** paid search. Paid search is the most efficient channel; ctv is the most expensive. Accept the ranking search < social < ctv per paying subscriber.
- **Evidence:** H7-paid-social-cac; Insights `account created` by `acquisition_channel` joined to `marketing_spend_daily.spend_usd`; Funnels `trial started` → `trial converted` (8-day window) breakdown user property `acquisition_channel`; `-- STORY H7` and `-- EVAL Q11`.
- **Context needed:** 04-metrics-and-tables.md (CAC uses Mixpanel accounts; `marketing_spend_daily`), 01-business.md (channels).
- **Grading:** must go past cost per signup to cost per paying subscriber. Wrong: using `platform_reported_signups` for CAC; ranking by cost per signup only.

### Q12 — Who cancels least?
- **Prompt:** "Which subscribers are least likely to cancel? Is there a segment we should be protecting?"
- **Type:** retention
- **Answer:** Households with more than one viewer profile. Renewal-time churn (paid cancellations / renewals due): **1 profile 6.03%**, 2 profiles 3.02%, 3 profiles 2.90%, 4 profiles 2.43%, 5 profiles 2.50%. Shared households (2+ profiles) churn **2.80%** vs **6.03%** for single-profile accounts, about **0.46x**. Plan does not explain it (basic_ads 3.72%, standard 4.03%, premium 3.74%). Getting a household to set up a second profile is a retention lever worth testing. Accept 0.40x-0.60x.
- **Evidence:** H8-shared-households-stay; Insights, A = `subscription cancelled` (`during_trial` = false), B = `subscription renewed`, formula A / (A + B), breakdown user property `profile_count`; `-- STORY H8` and `-- EVAL Q12`.
- **Context needed:** 04-metrics-and-tables.md (renewal-time churn excludes trial cancellations), 03-event-dictionary.md (`profile_count`).
- **Grading:** must exclude trial cancellations and normalize by renewals due. Wrong: counting all cancellations (trial cancellations dominate); "kids profiles cause retention" without checking profile count.

### Q13 — Which pushes work?
- **Prompt:** "Which push notifications actually get opened? Should we keep sending the trending ones?"
- **Type:** segmentation
- **Answer:** Personalized pushes win. Open rate (opens / delivered): **new_season 19.2%** (the one-off Saltmarsh push), **new_episode 14.8%**, **because_you_watched 8.8%**, **trending_now 4.9%**, **win_back 2.7%**. A new_episode push is opened about **3.0x** as often as a trending_now push (3.02x), because_you_watched about **1.8x** (1.79x). About half of opens lead to a play within 10 minutes for new_episode (50.3%), because_you_watched (49.0%), and trending_now (49.0%); win_back opens lead to none (those households no longer have access, and the in-app resubscribe flow for lapsed accounts did not exist in the window; see 01-business.md). Accept the ranking and a new_episode / trending_now ratio of 2.6x-3.4x.
- **Evidence:** H9-personalized-pushes; Insights, `notification opened` / `notification received` (Totals), breakdown `campaign_type`; `-- STORY H9` and `-- EVAL Q13`.
- **Context needed:** 01-business.md (campaign types), 04-metrics-and-tables.md (open rate).
- **Grading:** must use rates by campaign type. Wrong: comparing raw opens (different send volumes); judging win_back by plays.

### Q14 — Is search harder on TV?
- **Prompt:** "Is search harder on TV? The TV team wants to prioritize voice search."
- **Type:** funnel
- **Answer:** Slower, not less successful. Median time from `search performed` to the play it leads to is **164.8 s on tv** vs **74.9 s mobile, 75.9 s tablet, 75.0 s web**, about **2.2x**. The share of searches that end in a play within an hour is about the same everywhere (**58.8%-59.9%**; tv 58.8%). TV households find what they want as often but take more than twice as long, which supports voice search. Accept 2.0x-2.4x.
- **Evidence:** H10-tv-search-is-slow; Funnels, `search performed` → `playback started`, hold `search_id` constant, 1-hour window, median time to convert, breakdown `platform`; `-- STORY H10` and `-- EVAL Q14`.
- **Context needed:** 03-event-dictionary.md (`search_id`), 04-metrics-and-tables.md (search to play).
- **Grading:** must separate speed from success. Wrong: "TV search fails more"; matching a search to any later play without `search_id`.

### Q15 — What did paid marketing buy in Q3?
- **Prompt:** "How much did we spend on paid marketing in Q3, and how many paying subscribers did we get for it?"
- **Type:** external-join
- **Answer:** Q3 (Jul 1 - Sep 30) paid spend was **$65,792** (ctv $22,839, paid_search $21,700, paid_social $21,253). Paid channels brought **2,235** new accounts ($29.44 each), and **672** of them were paying subscribers by Oct 1 (**$97.91** per paying subscriber): paid_search 258 ($84.11 each), paid_social 225 ($94.46), ctv 189 ($120.84). Spend ran higher in the Saltmarsh premiere weeks because the bid-based part of spend follows delivered signups. Households that signed up in the last week of September were still in trial on Oct 1, so the paying count is slightly understated. Accept $62,000-$70,000 and $90-$106 per paying subscriber.
- **Evidence:** H7-paid-social-cac; `marketing_spend_daily` summed Jul 1 - Sep 30 by channel; Mixpanel `account created` Jul 1 - Sep 30 by `acquisition_channel`, then `trial converted`; `-- EVAL Q15`.
- **Context needed:** 04-metrics-and-tables.md (`marketing_spend_daily`, CAC), 00-manifest.md (Q3 = Jul 1 - Sep 30).
- **Grading:** must use the warehouse for spend and Mixpanel for accounts. Wrong: using the whole window; using `platform_reported_signups`.

### Q16 — Do Canadian households behave differently? (null)
- **Prompt:** "Do our Canadian households convert their trials differently from US households? Should we treat Canada as its own market?"
- **Type:** null-hypothesis
- **Answer:** No meaningful difference. Trial conversion is **43.4%** in the US (3,312 trials) and **43.2%** in Canada (556 trials), z ≈ -0.1. Within each Smart Start arm the gap is also small (Control 38.8% vs 39.7%, z ≈ 0.3; Smart Start 46.2% vs 43.7%, z ≈ -0.7). Renewal-time churn is about the same too (3.87% vs 3.95%, z ≈ 0.2). No case for a separate Canadian playbook on these numbers.
- **Evidence:** Funnels `trial started` → `trial converted` (8-day window), breakdown user property `country`; Insights renewal-time churn by `country`; `-- EVAL Q16`.
- **Context needed:** 01-business.md (markets), 04-metrics-and-tables.md (trial conversion, churn).
- **Grading:** must say no difference and give both rates. Wrong: reading the one-point conversion gap or the small churn gap as a finding.

### Q17 — Why did trial conversion move month to month?
- **Prompt:** "Trial conversion was lower in July and then climbed through September. What's going on?"
- **Type:** context
- **Answer:** Two things from the timeline. By month the trial started: **June 45.7%**, **July 38.0%**, **August 45.1%**, **September (1-23) 48.4%**. July was dragged down by Saltmarsh premiere signups (**62.3%** of July trials came from accounts created Jul 17 - Aug 6, which convert at about 0.6x the normal rate; see Q3), and they were still **20.7%** of August trials. From July 8 the Smart Start test lifted half of all new trials (see Q4); by September there were no premiere signups left and half the trials were in Smart Start, so September is the best month. Accept the two named drivers with the monthly numbers.
- **Evidence:** H2-premiere-tourists, H3-smart-start-experiment; Funnels `trial started` → `trial converted`, 8-day window, by month of trial start, with breakdowns by signup date and `Experiment: Smart Start`; `-- EVAL Q17`.
- **Context needed:** 02-timeline.md (premiere, Smart Start start), 04-metrics-and-tables.md (complete windows).
- **Grading:** must name both the premiere signups and the test. Wrong: a seasonal story; including late-September trials with incomplete windows.

### Q18 — What is our monthly churn?
- **Prompt:** "What's our monthly churn rate for paying subscribers, and why do people cancel?"
- **Type:** retention
- **Answer:** About **3.9% a month**. Renewal-time churn over the window is **3.88%** (paid cancellations / renewals due): June 3.48%, July 4.20%, August 3.83%, September 3.99% (October 1 is a single day: 5 cancellations, 200 renewals). June reads lowest partly because cancellations for renewals due in the first days of June were made before June 4 and are not in the data. Top paid cancellation reasons: **too_expensive (234)**, **not_enough_to_watch (205)**, **taking_a_break (160)**, then switching_service (116). Trial cancellations are separate (they are part of trial conversion). Accept 3.4%-4.4%.
- **Evidence:** H8-shared-households-stay (segments); Insights, A = `subscription cancelled` (`during_trial` = false), B = `subscription renewed`, A / (A + B), monthly; `cancel_reason` breakdown; `-- EVAL Q18`.
- **Context needed:** 04-metrics-and-tables.md (renewal-time churn), 03-event-dictionary.md (`cancel_reason`, `during_trial`).
- **Grading:** must exclude trial cancellations. Wrong: dividing cancellations by all households; mixing in trial cancellations (much higher).

### Q19 — What should we worry about? (open-ended)
- **Prompt:** "What should we be worried about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer covers most of these, with numbers: (1) **Trial conversion hinges on the first three days**: trials with fewer than 3 completed plays convert at 31.4% vs 56.9% (Q6), so onboarding should push early viewing; Smart Start already lifts conversion 1.18x and should ship (Q4). (2) **Premiere signups churn at trial end**: Saltmarsh brought about 1.6x the usual daily signups for three weeks, but those households converted at 30% (Q3); the next big release needs a plan to keep them. (3) **The Standard price rise did not raise revenue per new subscriber** ($11.73 → $11.64) because households traded down to Basic with Ads (Q9, Q10). (4) **Paid social is expensive per paying subscriber** ($97 vs $86 for paid search) despite the lowest cost per account (Q11). (5) **TV reliability**: one CDN fault cost about 685 completions in three days on the biggest screen (Q8). (6) **Single-profile households churn about twice as fast** (6.0% vs 2.8% a month, Q12). Context: 6,303 households watched in September and 5,986 subscriptions were active on Oct 1.
- **Evidence:** the story queries for H2-H8; `-- EVAL Q19` for the headline numbers.
- **Context needed:** all guides.
- **Grading:** reward answers that rank issues by size and tie each to data. Wrong: generic advice without numbers; calling the late-July viewing spike a lasting trend.

### Q20 — Does billing agree with Mixpanel?
- **Prompt:** "Finance's new-subscription numbers never match Mixpanel. How far apart are they, and what were first-month bookings by month?"
- **Type:** external-join
- **Answer:** Billing runs a little above Mixpanel. New paid subscriptions by month in `subscription_billing_daily` vs Mixpanel `trial converted`: **June 370 vs 361**, **July 533 vs 514**, **August 468 vs 439**, **September 457 vs 444** (October 1: 16 vs 16), about 2%-7% higher in billing because some app-store purchases never reach Mixpanel (net of same-day refunds). First-month bookings: **$4,359** (June 4-30), **$6,206** (July), **$5,717** (August), **$5,219** (September). Accept the direction and size of the gap and the monthly bookings.
- **Evidence:** warehouse `subscription_billing_daily` summed by month vs Mixpanel `trial converted` monthly totals; `-- EVAL Q20`.
- **Context needed:** 04-metrics-and-tables.md (`subscription_billing_daily` caveats), 00-manifest.md (June starts on the 4th).
- **Grading:** must explain the gap with the table caveats. Wrong: treating the gap as a tracking outage; comparing billing with `trial started`.
