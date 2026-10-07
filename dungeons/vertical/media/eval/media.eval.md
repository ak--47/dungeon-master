# The Lantern (media) — 20-question eval

- **Data:** `data/verify-media` (full fidelity: 10,000 readers, 9,993 with events, 7,319 accounts, 2,674 visitors who never registered, 892,968 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query (or the `-- STORY` query it names) in `dungeons/vertical/media/media.sql` on that data.
- **Stories:** ids refer to the `stories` export in `media.js` (H1-H10).
- **Known level caveat (for graders):** the registration level (40.5% of new visitors register within 7 days, about 56% of visitors who see the registration wall) is higher than real publishers see. It is a scale tradeoff that keeps the channel comparisons readable. Do not penalize an answer that calls the level high; grade the channel comparisons.
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — What did the World Cup do for readership?
- **Prompt:** "Sports traffic went crazy in June and July. How big was the World Cup bump, and was it only sports?"
- **Type:** trend
- **Answer:** A large, sports-only bump during the tournament (June 11 - July 19). Sports went from **9.2% of article views** in the baseline (Jun 4-7 and Jul 23 - Aug 19) to **15.7%** during the tournament, about **234 → 408 sports reads a day**. Relative to non-sports reading, sports rose **1.85x** for all readers and **1.95x** for subscribers (subscribers have no meter, so their number is the cleanest read; free readers' extra sports clicks partly hit the paywall). It built through the bracket: sports share 12.0% the week of June 8, then 13.6%, 14.2%, 16.7%, 17.2%, and 17.5% the week of July 13 (semifinals and final), back to 9.9% the week of July 20 and about 9% after. Non-sports reading per active reader-day did not change (2.458 during vs 2.459 baseline), so it was not a general traffic lift. Accept a sports lift of 1.65x-2.2x and "sports only".
- **Evidence:** H1-world-cup-sports-surge; Insights, `article viewed`, breakdown `section`, daily or weekly, optionally filter `reader_tier` in (digital, all_access); `-- STORY H1` and `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (tournament dates and phases).
- **Grading:** must give the size and tie it to the tournament dates; must say whether non-sports moved. Wrong: "overall traffic doubled"; comparing raw total views (the reader base grows over the summer); using the preview week (from June 8) as baseline.

### Q2 — Should we ship the For You feed?
- **Prompt:** "Is the For You feed test working in the apps? Should we ship it?"
- **Type:** segmentation
- **Answer:** Yes on engagement. Since July 15, home-module click-through (recommendation clicked with module = home_feed per home view, apps only) is **51.1% in For You vs 33.1% in Control, 1.55x** (z ≈ 29). Each extra click opens an article, but the extra reads are a small part of app reading: For You readers attempt **2.13 reads per app reader-day vs 2.11** (+0.9%, within day-to-day noise) and view 1.41 vs 1.42 articles (some extra reads by free readers hit the paywall). The split is balanced (1,794 For You vs 1,814 Control exposed readers). It does not change paywall conversion (see Q3). Recommend shipping for home-screen engagement; do not expect a reading or revenue lift. Accept a click-through lift of 1.35x-1.7x.
- **Evidence:** H2-for-you-feed-experiment; Insights, `recommendation clicked` (module = home_feed) ÷ `front page viewed` (page = home), filter platform in (ios_app, android_app), Jul 15 - Oct 1, breakdown `Experiment: For You Feed` (or the Experiments report on `$experiment_started`); `-- STORY H2` and `-- EVAL Q2`.
- **Context needed:** 02-timeline.md (start date, arms, apps only), 03-event-dictionary.md (`module`, `page`).
- **Grading:** must compare arms on the home module rate after exposure and give the size. Wrong: including web events (not in the test); counting all recommendation modules (related and most-read are not part of the test); comparing raw click totals without home views; claiming a large lift in total reading.

### Q3 — Does For You change subscriptions?
- **Prompt:** "Does the For You feed help us sell subscriptions?"
- **Type:** null-hypothesis
- **Answer:** No meaningful effect. Paywall conversion per view after exposure is **0.89% in For You vs 0.90% in Control (z = -0.12)**, and it holds by platform (Android 0.95% vs 0.86%, z = 0.59; iOS 0.80% vs 0.87%, z = -0.58; web 0.98% vs 1.00%, z = -0.13). The share of exposed readers who subscribed afterwards is **13.7% vs 13.6%** (z = 0.04). For You lifts home-screen clicks, not conversion. Accept "no significant difference".
- **Evidence:** H2 (control read); Insights, `subscription started` ÷ `paywall shown`, from Jul 15, breakdown `Experiment: For You Feed`; `-- EVAL Q3`.
- **Context needed:** 02-timeline.md, 04-metrics-and-tables.md (paywall conversion).
- **Grading:** must test and report no significant effect. Wrong: claiming a lift from the extra clicks; reading a single platform split as a finding.

### Q4 — Are subscribers using Gift Articles?
- **Prompt:** "We launched Gift Articles in August. Are subscribers actually using it? Did sharing go up?"
- **Type:** trend
- **Answer:** Yes. Subscriber sharing rose about **1.6x** once the rollout finished: shares per attempted read went from **3.33% (Jul 20 - Aug 10) to 5.46% (from Aug 18), 1.64x**, while free readers (who cannot gift) stayed flat (3.37% → 3.42%, 1.02x), so the effect net of the free-reader control is **about 1.6x**. Weekly subscriber shares went from about 440-525 before launch to 790-980 after. **2,224 gift links** were sent by **1,442 subscribers**; gift links are 37% of subscriber shares after the ramp. Gift links never appear before August 11 or from non-subscribers. Accept 1.4x-1.85x.
- **Evidence:** H3-gift-articles-launch; Insights, `article shared` ÷ (`article viewed` + `paywall shown`), breakdown `reader_tier`, Jul 20 - Aug 10 vs Aug 18 - Oct 1, and `article shared` by `share_method`; `-- STORY H3` and `-- EVAL Q4`.
- **Context needed:** 02-timeline.md (launch, one-week rollout), 03-event-dictionary.md (`share_method`).
- **Grading:** must compare subscribers before and after with a control or a rate, and give adoption. Wrong: using the rollout week as "after"; counting only gift links as the effect (some subscriber sharing existed before); raw share totals without normalizing.

### Q5 — What happened to the paywall in late August?
- **Prompt:** "Paywall views and new subscriptions dropped for a few days at the end of August. What happened?"
- **Type:** external-join
- **Answer:** The **web metering incident, August 25-27**. `platform_reliability_daily` shows `service_status = major_outage` for web on those three days with `meter_error_rate` 0.69-0.72 (normally below 0.004); the apps stayed operational. In Mixpanel, web paywall views fell to **about 290-310 a day** (vs 656-952 on the days around it) while app paywall views held at 530-560; the web/app ratio fell to **0.33x** of its level in the 14 days either side (0.55 vs 1.66). Web subscriptions fell to 1-3 a day. Web article views by free readers rose because the blocked reads went through. Everything was back to normal on August 28. Accept naming the web, the dates, and a drop to roughly 0.25x-0.4x.
- **Evidence:** H4-web-meter-outage; Insights, `paywall shown` daily by `platform`, joined to `platform_reliability_daily`; `-- STORY H4` and `-- EVAL Q5`.
- **Context needed:** 02-timeline.md (incident dates), 04-metrics-and-tables.md (`platform_reliability_daily`).
- **Grading:** must name the platform and the warehouse evidence. Wrong: "readers lost interest"; blaming the apps; missing that article views went up.

### Q6 — What did the incident cost?
- **Prompt:** "How many subscriptions did the August paywall incident cost us?"
- **Type:** external-join
- **Answer:** About **17 subscriptions** (accept 10-25). Using the web/app paywall ratio from the surrounding days (Aug 11 - Sep 10 without the incident days), the web should have shown about 2,726 paywalls on August 25-27 and showed 898, so about **1,830 paywall views were lost**. At the web's normal conversion per paywall view that is about 25 expected web subscriptions vs 7 actual. At the window's average first-period price (from `subscription_billing_daily`, outside the sale) that is about **$1,100 of first-period bookings**, plus their renewals.
- **Evidence:** H4-web-meter-outage; `-- EVAL Q6`.
- **Context needed:** 02-timeline.md, 04-metrics-and-tables.md.
- **Grading:** must build a counterfactual from a baseline (other days or the apps) and convert lost paywall views to subscriptions. Wrong: "zero, because subscriptions recovered"; using total daily subscriptions without a platform baseline.

### Q7 — Which paid channel gives the cheapest readers?
- **Prompt:** "Which paid channel brings us the cheapest readers? Meta looks cheapest — is it?"
- **Type:** external-join
- **Answer:** Meta is cheapest per visitor but the most expensive per registered reader. Window spend (warehouse `marketing_spend_daily`) over Mixpanel new visitors: **Meta $1.49, Google $2.34, podcast ads $3.22** (Meta about 0.64x Google). But only about a fifth of Meta visitors register (vs about half for Google), so spend per registration is **Google $4.72, podcast ads $6.07, Meta $6.82 (1.45x Google)**. Per subscriber (small counts): Google $25 (80), Meta $28 (60), podcast ads $30 (47). Spend: Google $2,001, Meta $1,671, podcast ads $1,414. Google search is the most efficient paid channel. Accept Meta per visitor 0.55x-0.7x of Google and Meta per registration 1.2x-1.7x of Google.
- **Evidence:** H5-paid-channel-economics; Insights uniques of `article viewed` (reader_tier = anonymous) by `acquisition_channel`, Funnels to `account registered` (7-day window), joined to `marketing_spend_daily.spend_usd`; `-- STORY H5` and `-- EVAL Q7`.
- **Context needed:** 04-metrics-and-tables.md (CAC uses Mixpanel counts), 01-business.md (channels).
- **Grading:** must join spend to Mixpanel visitors or registrations and go past cost per visitor. Wrong: using the networks' `clicks` as the denominator (they run above Mixpanel visitors, e.g. Meta 1,376 clicks vs 1,122 visitors); stopping at "Meta is cheapest".

### Q8 — What share of new visitors register?
- **Prompt:** "What share of new visitors create a free account, and does it depend on where they come from?"
- **Type:** funnel
- **Answer:** Overall **40.5%** of new visitors (first visit through Sep 24) register within 7 days (1,718 of 4,242). Visitors from social platforms register at well under half the rate of everyone else: **Meta ads 21.7% and organic social 24.3%** vs organic search 52.0%, Google ads 49.9%, podcast ads 53.4%, direct 50.9% (social platforms 22.6% vs 51.4% for the rest, 0.44x). Accept a social/other ratio of 0.38-0.6.
- **Evidence:** H5-paid-channel-economics; Funnels, `article viewed` (reader_tier = anonymous) → `account registered`, 7-day window, breakdown `acquisition_channel`; `-- EVAL Q8`.
- **Context needed:** 03-event-dictionary.md (anonymous first read, registration), 04-metrics-and-tables.md (registration rate).
- **Grading:** must restrict to new (anonymous) visitors and break down by channel. Wrong: a funnel from any `article viewed` (existing readers never register, which drags the rate toward zero); breaking down by a user profile property only (visitors who never register have no profile).

### Q9 — Which readers convert best at the paywall?
- **Prompt:** "Where do our new subscribers come from? Which traffic sources convert best at the paywall?"
- **Type:** segmentation
- **Answer:** **Newsletter readers.** A paywall view from a newsletter click converts at **1.94%** vs **0.70%** for every other source combined (**2.8x**); every other referrer sits between 0.57% and 0.79% (push 0.72% on 29 subscriptions). Newsletters are **10.5% of paywall views but 24.6% of new subscriptions**. The largest absolute sources are internal links (344 subscriptions, at an average rate) and newsletters (316). Accept 2.2x-3.2x.
- **Evidence:** H6-newsletter-readers-convert; Insights, `subscription started` ÷ `paywall shown`, breakdown `referrer`; `-- STORY H6` and `-- EVAL Q9`.
- **Context needed:** 03-event-dictionary.md (how `referrer` is set), 04-metrics-and-tables.md (paywall conversion per view).
- **Grading:** must compare conversion per paywall view, not raw subscription counts. Wrong: "internal links are best" (largest volume, average rate).

### Q10 — Did the Labor Day sale pay off?
- **Prompt:** "Did the Labor Day sale work? Was the discount worth it?"
- **Type:** external-join
- **Answer:** It more than doubled sign-ups but brought in much less first-period cash. Sale week (Sep 3-9): **153 subscriptions, 21.9 a day vs 9.9 a day** in the four weeks before; conversion per paywall view **1.65% vs 0.78% (2.10x)**. With 75% off the first period (prices from `subscription_billing_daily`), first-period bookings were **$387 a day vs $611** (−37%) and **$0.29 vs $0.48 per paywall view (0.60x)**. At list price the sale cohort is worth **$1,549 a day vs $611** (2.5x), so it pays off only if sale subscribers renew at a good rate; the first renewals (monthly plans in October, at 4x the sale price) fall outside the window. The plan mix did not change significantly (Q14). Accept conversion 1.7x-2.5x and first-period bookings per view 0.4x-0.75x.
- **Evidence:** H7-labor-day-sale; Insights, `subscription started` ÷ `paywall shown`, sale week vs Aug 6 - Sep 2, joined to `subscription_billing_daily.first_period_price_usd`; `-- STORY H7` and `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (sale dates and discount), 04-metrics-and-tables.md (first-period bookings), 01-business.md (renewals at list price).
- **Grading:** must use warehouse prices for revenue and separate first-period cash from list value. Wrong: "revenue doubled" (ignores the discount); using list prices for sale subscriptions; no renewal caveat.

### Q11 — How fast do new visitors register?
- **Prompt:** "How long after their first visit do people sign up for an account?"
- **Type:** funnel
- **Answer:** Median **4.9 hours** overall (registrations within 7 days, visitors through Sep 24), but it splits by channel: about **3.8-4.3 hours** for organic search, Google ads, podcast ads, and direct, vs **about 11-12 hours for Meta ads (11.1) and organic social (11.6)**, roughly **3x** (social platforms 11.4 h vs 4.0 h for the rest, 2.9x). About 22% of social registrants take more than a day vs 1-4% elsewhere. Accept a social/other median ratio of 2.4x-3.5x.
- **Evidence:** H8-registration-speed-by-channel; Funnels, `article viewed` (reader_tier = anonymous) → `account registered`, 7-day window, median time to convert, breakdown `acquisition_channel`; `-- STORY H8` and `-- EVAL Q11`.
- **Context needed:** 03-event-dictionary.md, 04-metrics-and-tables.md (time to register).
- **Grading:** must report a median by channel. Wrong: mean only (skewed by the long tail); including existing readers.

### Q12 — Which subscribers are about to cancel?
- **Prompt:** "Which subscribers are most likely to cancel? Is there an early warning sign?"
- **Type:** retention
- **Answer:** Subscribers who stop reading. Among subscribers paid for the whole prior month (subscriber-months July-September), those who read on **fewer than 4 days** in the prior month cancel at **13.6%** in the next month vs **4.2%** for everyone else (**about 3x**). Above 4 reading days the rate is flat (4-7 days 4.0%, 8-14 days 4.5%, 15+ days 0 of 61 subscriber-months), so the warning sign is a threshold at about 4 reading days a month. About 14% of subscriber-months are under the threshold. Cancellation reasons agree in part: `not_reading_enough` is the second most common stated reason (135 of 565, 24%), after `price` (158, 28%). Accept 2.5x-5x and a threshold near 4 days.
- **Evidence:** H9-reading-habit-churn; `-- STORY H9` and `-- EVAL Q12`. Mixpanel recipe: Retention report in Frequency mode on `article viewed` (filter `reader_tier` in digital, all_access; monthly), save the 1-3 day buckets of month M-1 as a cohort and intersect with "did not do `subscription started` or `subscription cancelled` in M-1"; Insights uniques of `subscription cancelled` in month M over cohort size. That buildable cohort gives the same rates (13.6% vs 4.2%, `-- EVAL Q12` buildable-cohort query); the exact subscribed-all-month frame needs the raw export.
- **Context needed:** 04-metrics-and-tables.md (reading days, monthly churn), 01-business.md (cancellation).
- **Grading:** must use prior-period reading as the predictor and give the rates. Accept any close cohort approximation (event-count cohorts such as "article viewed fewer than 4 times in M-1" give a weaker but same-direction split; accept them if the analyst says they approximate reading days). Wrong: using reading in the same month as the cancellation (reading after a cancel is metered); "All Access cancels more" without controlling for reading.

### Q13 — When do people read longer?
- **Prompt:** "Do people read differently on weekends?"
- **Type:** segmentation
- **Answer:** Yes: fewer reads but longer ones. In the project's UTC day-of-week breakdown, average read time is **233 seconds on Saturday and 245 on Sunday vs 181-182 Tuesday-Friday** (weekend 239 vs weekday 184, **1.30x**); Monday reads a little high (195) and Saturday a little low because US Sunday evenings fall on Monday UTC and Friday evenings on Saturday UTC. On readers' local days (time zone from `region`) the gap is **1.35x** (246 vs 182 seconds). Scroll depth follows (71% vs 63%). The content mix does not change (features and analysis are about 34% of reads every day), so readers spend longer on the same kinds of articles. Weekend days have fewer reads (39,247 Saturday and 41,845 Sunday vs 48,304-50,698 on Monday-Thursday). Accept 1.25x-1.45x.
- **Evidence:** H10-weekend-long-reads; Insights, `article viewed`, average `read_time_sec`, breakdown day of week; `-- STORY H10` and `-- EVAL Q13`.
- **Context needed:** 03-event-dictionary.md (`read_time_sec`), 00-manifest.md (UTC and US time zones).
- **Grading:** must give the size and rule out a content-mix shift. Wrong: "weekends are more engaged" based on volume (volume is lower); attributing it to more features on weekends.

### Q14 — Which plans do new subscribers choose?
- **Prompt:** "What plans are new subscribers picking? Did the sale change the mix?"
- **Type:** segmentation
- **Answer:** Of 1,283 new subscriptions, **Digital monthly 42.7%, Digital annual 27.4%, All Access monthly 18.0%, All Access annual 11.9%** (Digital 70%, annual 39%). The sale week (153 subscriptions) had the same plan split (All Access 30.1% vs 29.9% outside the sale, z = 0.04) and a little more annual (44.4% vs 38.6%, z = 1.39, p ≈ 0.16, not significant). The sale discounted both plans and both billing periods equally. Accept "no meaningful mix change"; do not accept a claim that the sale shifted buyers.
- **Evidence:** `-- EVAL Q14`; Insights, `subscription started`, breakdown `plan` and `billing_period`, filter `offer`.
- **Context needed:** 01-business.md (plans), 02-timeline.md (sale terms).
- **Grading:** must give the mix and test the sale difference with its sample size. Wrong: "the sale pushed buyers to annual plans" stated as a finding; comparing counts without shares.

### Q15 — Did the World Cup bring new readers?
- **Prompt:** "Did the World Cup bring us new readers?"
- **Type:** null-hypothesis
- **Answer:** No measurable effect. New visitors averaged **36.6 a day during the tournament vs 37.9 outside it** (Welch t = -0.93, p ≈ 0.35). Per visitor, those who arrived during the tournament registered at 39.5% vs 41.0% (z = -0.99, p ≈ 0.32). New visitors' first articles were no more likely to be sports during the tournament (9.3% vs 8.7%). The World Cup lifted sports reading among existing readers (Q1), not acquisition. Accept "no meaningful change".
- **Evidence:** H1 (control read); Insights, uniques of anonymous `article viewed`, daily, Jun 11 - Jul 19 vs the rest; Funnels to `account registered` by arrival period; `-- EVAL Q15`.
- **Context needed:** 02-timeline.md.
- **Grading:** must compare new visitors per day (or registration per visitor) and report no significant difference. Wrong: "the World Cup drove new readers" based on total sports traffic.

### Q16 — Why don't server pageviews match Mixpanel?
- **Prompt:** "Engineering's pageview numbers are higher than Mixpanel's. Which one is wrong?"
- **Type:** external-join
- **Answer:** Neither; they measure different things. Over the window `pageviews_served` exceeds Mixpanel `article viewed` by **18.2% on web, 7.5% on iOS, and 8.2% on Android**, varying by day (web 4.5%-32.3%), with daily correlation 0.91-0.98. The server count includes readers whose browsers block analytics (mostly web), readers who opted out of tracking in the apps, and automated traffic. Use Mixpanel for reader behavior and the warehouse for load and capacity. Accept the per-platform gaps within ±3 points and the explanation.
- **Evidence:** `-- EVAL Q16`; warehouse `platform_reliability_daily` joined to `article viewed` by date and `platform`.
- **Context needed:** 04-metrics-and-tables.md (`pageviews_served` caveats).
- **Grading:** must quantify by platform and explain with the table caveats. Wrong: "Mixpanel is dropping data" or "the warehouse double counts".

### Q17 — How did the subscriber base grow?
- **Prompt:** "How many subscribers did we add this summer, and what's our monthly churn?"
- **Type:** context
- **Answer:** About **2,475 subscribers at the start of the window and 3,193 at the end** (+718, +29%). New subscriptions by month: **June 258 (from June 4), July 325, August 314, September 378** (October 1: 8). Cancellations: **June 143, July 147, August 135, September 133** (October 1: 7). Monthly churn (subscribers paid all of the prior month) was **5.5%** on average July-September. September includes the Labor Day sale week (153 subscriptions); August includes the three-day web metering incident (about 17 subscriptions lost, Q6). The World Cup weeks averaged 10.4 subscriptions a day vs 10.6 in the five weeks after, so July is not explained by the tournament. Accept churn 4.5-6.5% and net growth near +700.
- **Evidence:** `-- EVAL Q17`; Insights, `subscription started` and `subscription cancelled`, monthly; profiles by `reader_tier`.
- **Context needed:** 04-metrics-and-tables.md (monthly churn definition), 02-timeline.md (to explain the months).
- **Grading:** must give both flows and a churn rate with a stated denominator. Wrong: churn as cancellations ÷ end-of-window subscribers without saying so; counting October 1 as a month; crediting the World Cup for July's subscriptions.

### Q18 — How many readers do we have?
- **Prompt:** "How many readers did we have this summer? How many are anonymous?"
- **Type:** context
- **Answer:** **9,993 unique readers** (Mixpanel Uniques with identity resolution): **7,319 accounts** (free readers and subscribers) and **2,674 visitors who never registered**, who exist only as devices. **1,821 accounts were created in the window**; their earlier anonymous reads merge into the account. The project has 15,102 distinct devices, so counting devices would overstate readers by about 1.5x. Accept 9,900-10,000 readers and about 2,700 anonymous.
- **Evidence:** `-- EVAL Q18`; Insights uniques of any event; uniques of `account registered`.
- **Context needed:** 00-manifest.md (identity notes).
- **Grading:** must count resolved people, not devices, and separate anonymous visitors. Wrong: 15,102 (devices); 7,319 (accounts only) given as "readers".

### Q19 — Do app readers convert better?
- **Prompt:** "Should we push free readers into the apps? Do app readers subscribe at a higher rate at the paywall than web readers?"
- **Type:** null-hypothesis
- **Answer:** No difference in conversion. Subscriptions per paywall view are **web 0.82%, Android 0.90%, iOS 0.81%** (chi-square 1.83 on 2 degrees of freedom, p ≈ 0.40). The null holds in the obvious splits: newsletter reads (web 1.98%, Android 1.80%, iOS 1.92%; chi-square 0.37), outside the sale (chi-square 2.60, p ≈ 0.27), and sale week (chi-square 0.77 on 153 subscriptions). Non-newsletter reads show a weak, non-significant spread (web 0.68%, Android 0.80%, iOS 0.68%; chi-square 3.83, p ≈ 0.15) that is not a finding. The web carries about 62% of paywall views (95,269 of 154,408), so it brings the most subscriptions by volume. Moving readers to the apps would not raise the paywall rate. Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q19`; Insights, `subscription started` ÷ `paywall shown`, breakdown `platform`.
- **Context needed:** 03-event-dictionary.md (`platform`), 04-metrics-and-tables.md (paywall conversion per view).
- **Grading:** must compare conversion per paywall view across platforms and test it. Wrong: "web converts best" (volume, not rate); "Android converts best" from the non-newsletter split without a test.

### Q20 — What should we worry about this quarter?
- **Prompt:** "Looking at the summer, what should we worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names several of these, with numbers:
  1. **Light-reading subscribers churn.** 14% of subscriber-months had fewer than 4 reading days, and those cancel at 13.6% a month vs 4.2% (Q12). Habit-building for light readers is the clearest retention lever.
  2. **Sale cohort renewals.** 153 sale-week subscribers face a 4x price jump at their first renewal (October for monthly plans); their retention decides whether the sale paid off (Q10).
  3. **Paywall reliability.** Three days of a degraded web meter cost about 17 subscriptions (Q5, Q6); the web carries about 62% of paywall views (Q19).
  4. **Acquisition mix.** Meta is the cheapest per visitor but costs 1.45x Google per registration; Google search is the most efficient paid channel (Q7, Q8).
  5. **Newsletters are the conversion engine.** Newsletter reads convert at 2.8x and supply 25% of new subscriptions from 11% of paywall views (Q9).
  6. **Post-World Cup sports readers.** Sports reading returned to its baseline share right after the final (Q1); the World Cup did not bring new readers (Q15) and did not lift subscriptions (Q17).
  7. **The grant ends after 2026** (01-business.md). Subscribers grew 29% this summer (Q17), and reader revenue still covers under half of the budget.
  8. Upside to act on: ship For You for home-screen engagement (Q2) and keep promoting Gift Articles (Q4).
- **Evidence:** `-- EVAL Q20` plus the queries cited.
- **Context needed:** all guides.
- **Grading:** credit 3+ concrete, data-backed risks or actions. Wrong: generic advice without numbers; claiming For You or the World Cup drove subscriptions.
