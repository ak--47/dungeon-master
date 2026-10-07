# The Lantern (media) — 20-question eval

- **Data:** `data/verify-media` (full fidelity: 10,000 readers, 9,993 with events, 7,319 accounts, 2,674 visitors who never registered, 892,791 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query (or the `-- STORY` query it names) in `dungeons/vertical/media/media.sql` on that data.
- **Stories:** ids refer to the `stories` export in `media.js` (H1-H10).
- **Known level caveat (for graders):** the registration level (40.5% of new visitors register within 7 days, about 56% of visitors who see the registration wall) is higher than real publishers see. It is a scale tradeoff that keeps the channel comparisons readable. Do not penalize an answer that calls the level high; grade the channel comparisons.
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — What did the World Cup do for readership?
- **Prompt:** "Sports traffic went crazy in June and July. How big was the World Cup bump, and was it only sports?"
- **Type:** trend
- **Answer:** A large, sports-only bump during the tournament (June 11 - July 19). Sports went from **9.1% of article views** in the baseline (Jun 4-7 and Jul 23 - Aug 19) to **15.8%** during the tournament, about **234 → 412 sports reads a day**. Relative to non-sports reading, sports rose **1.87x** for all readers and **1.97x** for subscribers (subscribers have no meter, so their number is the cleanest read; free readers' extra sports clicks partly hit the paywall). It built through the bracket: sports share 12.0% the week of June 8, then 13.7%, 14.2%, 16.8%, 17.1%, and 17.9% the week of July 13 (semifinals and final), back to 9.9% the week of July 20 and about 9% after. Non-sports reading per active reader-day did not change (2.464 during vs 2.469 baseline), so it was not a general traffic lift. Accept a sports lift of 1.65x-2.2x and "sports only".
- **Evidence:** H1-world-cup-sports-surge; Insights, `article viewed`, breakdown `section`, daily or weekly, optionally filter `reader_tier` in (digital, all_access); `-- STORY H1` and `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (tournament dates and phases).
- **Grading:** must give the size and tie it to the tournament dates; must say whether non-sports moved. Wrong: "overall traffic doubled"; comparing raw total views (the reader base grows over the summer); using the preview week (from June 8) as baseline.

### Q2 — Should we ship the For You feed?
- **Prompt:** "Is the For You feed test working in the apps? Should we ship it?"
- **Type:** segmentation
- **Answer:** Yes on engagement. Since July 15, in the apps, a For You reader's home screen view leads to a tap on the home module far more often. Clicks per home view (recommendation clicked with module = home_feed ÷ front page viewed with page = home) are **49.7% in For You vs 33.3% in Control, 1.50x** (z ≈ 27). The per-view funnel gives the same lift: **50.1% vs 33.6% of home views lead to a home_feed click within 30 minutes (1.49x)**; a view leads to at most one home-module click, so the two reads agree. A Uniques funnel over the whole test shows a much smaller gap (**92.0% vs 85.6% of exposed readers, 1.08x**) because most readers in either arm tap the module at least once over 11 weeks; that is saturation, not a weak effect. Each extra click opens an article, but the extra reads are a small part of app reading: For You readers attempt **2.34 reads per app reader-day vs 2.32** (+1.1%) and view 1.58 vs 1.53 articles (some extra reads by free readers hit the paywall). The split is balanced (1,793 For You vs 1,813 Control exposed readers). It does not change paywall conversion (see Q3). Recommend shipping for home-screen engagement; do not expect a large reading or revenue lift. Accept a per-view lift (clicks per home view, or a Totals funnel with a short window) of 1.35x-1.7x.
- **Evidence:** H2-for-you-feed-experiment; Insights, `recommendation clicked` (module = home_feed) ÷ `front page viewed` (page = home), filter platform in (ios_app, android_app), Jul 15 - Oct 1, breakdown `Experiment: For You Feed` (or the Experiments report on `$experiment_started`); or Funnels, `front page viewed` (page = home) → `recommendation clicked` (module = home_feed), 30-minute window, Totals, same filter and breakdown; `-- STORY H2` (both queries) and `-- EVAL Q2`.
- **Context needed:** 02-timeline.md (start date, arms, apps only), 03-event-dictionary.md (`module`, `page`).
- **Grading:** must compare arms on the per-home-view rate after exposure (clicks per home view, or a Totals funnel from home view to home_feed click with a short window) and give the size. Accept a Uniques funnel result only if the analyst explains that it saturates and also reports a per-view rate. Wrong: including web events (not in the test); counting all recommendation modules (related and most-read are not part of the test); comparing raw click totals without home views; concluding "no effect" from the Uniques funnel alone; claiming a large lift in total reading.

### Q3 — Does For You change subscriptions?
- **Prompt:** "Does the For You feed help us sell subscriptions?"
- **Type:** null-hypothesis
- **Answer:** No meaningful effect. Paywall conversion per view after exposure is **0.90% in For You vs 0.88% in Control (z = 0.25)**, and it holds by platform (Android 0.80% vs 0.91%, z = -0.78; iOS 1.02% vs 0.90%, z = 0.93; web 0.84% vs 0.82%, z = 0.15). The share of exposed readers who subscribed afterwards is **13.4% vs 13.5%** (z = -0.06). For You lifts home-screen clicks, not conversion. Accept "no significant difference".
- **Evidence:** H2 (control read); Insights, `subscription started` ÷ `paywall shown`, from Jul 15, breakdown `Experiment: For You Feed`; `-- EVAL Q3`.
- **Context needed:** 02-timeline.md, 04-metrics-and-tables.md (paywall conversion).
- **Grading:** must test and report no significant effect. Wrong: claiming a lift from the extra clicks; reading a single platform split as a finding.

### Q4 — Are subscribers using Gift Articles?
- **Prompt:** "We launched Gift Articles in August. Are subscribers actually using it? Did sharing go up?"
- **Type:** trend
- **Answer:** Yes. Subscriber sharing rose about **1.6x** once the rollout finished: shares per attempted read went from **3.33% (Jul 20 - Aug 10) to 5.49% (from Aug 18), 1.65x**, while free readers (who cannot gift) stayed flat (3.38% → 3.42%, 1.01x), so the effect net of the free-reader control is **about 1.63x**. Weekly subscriber shares went from about 450-535 before launch to 800-970 after. **2,273 gift links** were sent by **1,457 subscribers**; gift links are 37.5% of subscriber shares after the ramp. Gift links never appear before August 11 or from non-subscribers. Accept 1.4x-1.85x.
- **Evidence:** H3-gift-articles-launch; Insights, `article shared` ÷ (`article viewed` + `paywall shown`), breakdown `reader_tier`, Jul 20 - Aug 10 vs Aug 18 - Oct 1, and `article shared` by `share_method`; `-- STORY H3` and `-- EVAL Q4`.
- **Context needed:** 02-timeline.md (launch, one-week rollout), 03-event-dictionary.md (`share_method`).
- **Grading:** must compare subscribers before and after with a control or a rate, and give adoption. Wrong: using the rollout week as "after"; counting only gift links as the effect (some subscriber sharing existed before); raw share totals without normalizing.

### Q5 — What happened to the paywall in late August?
- **Prompt:** "Paywall views and new subscriptions dropped for a few days at the end of August. What happened?"
- **Type:** external-join
- **Answer:** The **web metering incident, August 25-27**. `platform_reliability_daily` shows `service_status = major_outage` for web on those three days with `meter_error_rate` 0.69-0.72 (normally below 0.004); the apps stayed operational. In Mixpanel, web paywall views fell to **about 230-300 a day** (vs 634-915 on the week either side) while app paywall views held at 516-543; the web/app paywall ratio fell to **0.32x** of its level in the 14 days either side (0.50 vs 1.57). Measured as the share of free readers' attempted reads that hit the paywall (paywall shown ÷ (paywall shown + article viewed with reader_tier = registered)), the web fell from **70.7% to 21.5% (0.30x)** while the apps stayed at 70.5-70.6%. Web subscriptions fell to 0-3 a day. Web article views by free readers rose because the blocked reads went through. Everything was back to normal on August 28. Accept naming the web, the dates, and a drop to roughly 0.25x-0.4x.
- **Evidence:** H4-web-meter-outage; Insights, `paywall shown` daily by `platform`, joined to `platform_reliability_daily`; `-- STORY H4` and `-- EVAL Q5`.
- **Context needed:** 02-timeline.md (incident dates), 04-metrics-and-tables.md (`platform_reliability_daily`).
- **Grading:** must name the platform and the warehouse evidence. Wrong: "readers lost interest"; blaming the apps; missing that article views went up.

### Q6 — What did the incident cost?
- **Prompt:** "How many subscriptions did the August paywall incident cost us?"
- **Type:** external-join
- **Answer:** About **17 subscriptions** (accept 10-25). Using the web/app paywall ratio from the surrounding days (Aug 11 - Sep 10 without the incident days), the web should have shown about 2,507 paywalls on August 25-27 and showed 804, so about **1,700 paywall views were lost**. At the web's normal conversion per paywall view that is about 25 expected web subscriptions vs 4 actual. At the window's average first-period price (from `subscription_billing_daily`, outside the sale) that is about **$1,100 of first-period bookings**, plus their renewals.
- **Evidence:** H4-web-meter-outage; `-- EVAL Q6`.
- **Context needed:** 02-timeline.md, 04-metrics-and-tables.md.
- **Grading:** must build a counterfactual from a baseline (other days or the apps) and convert lost paywall views to subscriptions. Wrong: "zero, because subscriptions recovered"; using total daily subscriptions without a platform baseline.

### Q7 — Which paid channel gives the cheapest readers?
- **Prompt:** "Which paid channel brings us the cheapest readers? Meta looks cheapest — is it?"
- **Type:** external-join
- **Answer:** Meta is cheapest per visitor but the most expensive per registered reader. Window spend (warehouse `marketing_spend_daily`) over Mixpanel new visitors: **Meta $1.49, Google $2.34, podcast ads $3.22** (Meta about 0.64x Google). But only about a fifth of Meta visitors register (vs about half for Google), so spend per registration is **Google $4.72, podcast ads $6.07, Meta $6.82 (1.45x Google)**. Per subscriber (small counts): Google $24 (82), Meta $32 (52), podcast ads $34 (41). Spend: Google $2,001, Meta $1,672, podcast ads $1,414. Google search is the most efficient paid channel. Accept Meta per visitor 0.55x-0.7x of Google and Meta per registration 1.2x-1.7x of Google.
- **Evidence:** H5-paid-channel-economics; Insights uniques of `article viewed` (reader_tier = anonymous) by `acquisition_channel`, Funnels to `account registered` (7-day window), joined to `marketing_spend_daily.spend_usd`; `-- STORY H5` and `-- EVAL Q7`.
- **Context needed:** 04-metrics-and-tables.md (CAC uses Mixpanel counts), 01-business.md (channels).
- **Grading:** must join spend to Mixpanel visitors or registrations and go past cost per visitor. Wrong: using the networks' `clicks` as the denominator (they run above Mixpanel visitors, e.g. Meta 1,380 clicks vs 1,122 visitors); stopping at "Meta is cheapest".

### Q8 — What share of new visitors register?
- **Prompt:** "What share of new visitors create a free account, and does it depend on where they come from?"
- **Type:** funnel
- **Answer:** Overall **40.5%** of new visitors (first visit through Sep 24) register within 7 days (1,716 of 4,240). Visitors from social platforms register at well under half the rate of everyone else: **Meta ads 21.6% and organic social 24.3%** vs organic search 52.0%, Google ads 49.9%, podcast ads 53.3%, direct 50.9% (social platforms 22.5% vs 51.3% for the rest, 0.44x). Accept a social/other ratio of 0.38-0.6.
- **Evidence:** H5-paid-channel-economics; Funnels, `article viewed` (reader_tier = anonymous) → `account registered`, 7-day window, breakdown `acquisition_channel`; `-- EVAL Q8`.
- **Context needed:** 03-event-dictionary.md (anonymous first read, registration), 04-metrics-and-tables.md (registration rate).
- **Grading:** must restrict to new (anonymous) visitors and break down by channel. Wrong: a funnel from any `article viewed` (existing readers never register, which drags the rate toward zero); breaking down by a user profile property only (visitors who never register have no profile).

### Q9 — Which readers convert best at the paywall?
- **Prompt:** "Where do our new subscribers come from? Which traffic sources convert best at the paywall?"
- **Type:** segmentation
- **Answer:** **Newsletter readers.** A paywall view from a newsletter click converts at **1.84%** vs **0.77%** for every other source combined (**2.4x**); every other referrer sits between 0.67% (direct) and 0.97% (site search, on 60 subscriptions). Newsletters are **10.5% of paywall views but 21.9% of new subscriptions**. The largest absolute sources are internal links (324 subscriptions, at an average rate) and newsletters (295). Accept 2.0x-3.2x.
- **Evidence:** H6-newsletter-readers-convert; Insights, `subscription started` ÷ `paywall shown`, breakdown `referrer`; `-- STORY H6` and `-- EVAL Q9`.
- **Context needed:** 03-event-dictionary.md (how `referrer` is set), 04-metrics-and-tables.md (paywall conversion per view).
- **Grading:** must compare conversion per paywall view, not raw subscription counts. Wrong: "internal links are best" (largest volume, average rate).

### Q10 — Did the Labor Day sale pay off?
- **Prompt:** "Did the Labor Day sale work? Was the discount worth it?"
- **Type:** external-join
- **Answer:** It more than doubled sign-ups but brought in much less first-period cash. Sale week (Sep 3-9): **153 subscriptions, 21.9 a day vs 9.7 a day** in the four weeks before; conversion per paywall view **1.65% vs 0.79% (2.10x)**. With 75% off the first period (prices from `subscription_billing_daily`), first-period bookings were **$302 a day vs $660** (−54%) and **$0.23 vs $0.54 per paywall view (0.43x)**. At list price the sale cohort is worth **$1,209 a day vs $660** (1.8x), so it pays off only if sale subscribers renew at a good rate; the first renewals (monthly plans in October, at 4x the sale price) fall outside the window. The plan mix did not change significantly (Q14). Accept conversion 1.7x-2.5x and first-period bookings per view 0.35x-0.75x.
- **Evidence:** H7-labor-day-sale; Insights, `subscription started` ÷ `paywall shown`, sale week vs Aug 6 - Sep 2, joined to `subscription_billing_daily.first_period_price_usd`; `-- STORY H7` and `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (sale dates and discount), 04-metrics-and-tables.md (first-period bookings), 01-business.md (renewals at list price).
- **Grading:** must use warehouse prices for revenue and separate first-period cash from list value. Wrong: "revenue doubled" (ignores the discount); using list prices for sale subscriptions; no renewal caveat.

### Q11 — How fast do new visitors register?
- **Prompt:** "How long after their first visit do people sign up for an account?"
- **Type:** funnel
- **Answer:** Median **5.1 hours** overall (registrations within 7 days, visitors through Sep 24), but it splits by channel: about **3.8-4.2 hours** for organic search, Google ads, podcast ads, and direct, vs **about 12-13 hours for Meta ads (12.9) and organic social (12.2)**, roughly **3x** (social platforms 12.6 h vs 4.1 h for the rest, 3.1x). About 25-31% of social registrants take more than a day vs 2-5% elsewhere. Accept a social/other median ratio of 2.4x-3.6x.
- **Evidence:** H8-registration-speed-by-channel; Funnels, `article viewed` (reader_tier = anonymous) → `account registered`, 7-day window, median time to convert, breakdown `acquisition_channel`; `-- STORY H8` and `-- EVAL Q11`.
- **Context needed:** 03-event-dictionary.md, 04-metrics-and-tables.md (time to register).
- **Grading:** must report a median by channel. Wrong: mean only (skewed by the long tail); including existing readers.

### Q12 — Which subscribers are about to cancel?
- **Prompt:** "Which subscribers are most likely to cancel? Is there an early warning sign?"
- **Type:** retention
- **Answer:** Subscribers who stop reading. Among subscribers paid for the whole prior month (subscriber-months July-September), those who read on **fewer than 4 days** in the prior month cancel at **14.0%** in the next month vs **4.4%** for everyone else (**about 3x**). Above 4 reading days the rate is flat (4-7 days 4.3%, 8-14 days 4.4%, 15+ days 1 of 61 subscriber-months), so the warning sign is a threshold at about 4 reading days a month. About 14% of subscriber-months are under the threshold. Cancellation reasons agree in part: `not_reading_enough` is the second most common stated reason (137 of 581, 24%), after `price` (187, 32%). Accept 2.5x-5x and a threshold near 4 days.
- **Evidence:** H9-reading-habit-churn; `-- STORY H9` and `-- EVAL Q12`. Mixpanel recipe: Retention report in Frequency mode on `article viewed` (filter `reader_tier` in digital, all_access; monthly), save the 1-3 day buckets of month M-1 as a cohort and intersect with "did not do `subscription started` or `subscription cancelled` in M-1"; Insights uniques of `subscription cancelled` in month M over cohort size. That buildable cohort gives the same rates (14.1% vs 4.4%, `-- EVAL Q12` buildable-cohort query); the exact subscribed-all-month frame needs the raw export.
- **Context needed:** 04-metrics-and-tables.md (reading days, monthly churn), 01-business.md (cancellation).
- **Grading:** must use prior-period reading as the predictor and give the rates. Accept any close cohort approximation (event-count cohorts such as "article viewed fewer than 4 times in M-1" give a weaker but same-direction split; accept them if the analyst says they approximate reading days). Wrong: using reading in the same month as the cancellation (reading after a cancel is metered); "All Access cancels more" without controlling for reading.

### Q13 — When do people read longer?
- **Prompt:** "Do people read differently on weekends?"
- **Type:** segmentation
- **Answer:** Yes: fewer reads but longer ones. In the project's UTC day-of-week breakdown, average read time is **233 seconds on Saturday and 246 on Sunday vs 182-183 Tuesday-Friday** (weekend 240 vs weekday 185, **1.30x**); Monday reads a little high (195) and Saturday a little low because US Sunday evenings fall on Monday UTC and Friday evenings on Saturday UTC. On readers' local days (the region-to-time-zone convention in 03-event-dictionary.md) the gap is **1.35x** (246 vs 182 seconds). Scroll depth follows (71% vs 63%). The content mix does not change (features and analysis are about 34% of reads every day), so readers spend longer on the same kinds of articles. Weekend days have fewer reads (39,510 Saturday and 42,120 Sunday vs 48,498-51,015 on Monday-Thursday). Accept 1.25x-1.45x.
- **Evidence:** H10-weekend-long-reads; Insights, `article viewed`, average `read_time_sec`, breakdown day of week; `-- STORY H10` and `-- EVAL Q13`.
- **Context needed:** 03-event-dictionary.md (`read_time_sec`, `region` time zones), 00-manifest.md (UTC and US time zones).
- **Grading:** must give the size and rule out a content-mix shift. Wrong: "weekends are more engaged" based on volume (volume is lower); attributing it to more features on weekends.

### Q14 — Which plans do new subscribers choose?
- **Prompt:** "What plans are new subscribers picking? Did the sale change the mix?"
- **Type:** segmentation
- **Answer:** Of 1,345 new subscriptions, **Digital monthly 44.1%, Digital annual 27.2%, All Access monthly 17.8%, All Access annual 10.9%** (Digital 71%, annual 38%). The sale week (153 subscriptions) had about the same plan split (All Access 26.8% vs 28.9% outside the sale, z = -0.55) and a little less annual (33.3% vs 38.7%, z = -1.28, p ≈ 0.20, not significant). The sale discounted both plans and both billing periods equally. Accept "no meaningful mix change"; do not accept a claim that the sale shifted buyers.
- **Evidence:** `-- EVAL Q14`; Insights, `subscription started`, breakdown `plan` and `billing_period`, filter `offer`.
- **Context needed:** 01-business.md (plans), 02-timeline.md (sale terms).
- **Grading:** must give the mix and test the sale difference with its sample size. Wrong: "the sale pushed buyers to monthly plans" (or to annual) stated as a finding; comparing counts without shares.

### Q15 — Did the World Cup bring new readers?
- **Prompt:** "Did the World Cup bring us new readers?"
- **Type:** null-hypothesis
- **Answer:** No measurable effect. New visitors averaged **36.5 a day during the tournament vs 37.9 outside it** (Welch t = -1.01, p ≈ 0.32). Per visitor, those who arrived during the tournament registered at 39.4% vs 41.0% (z = -1.04, p ≈ 0.30). New visitors' first articles were no more likely to be sports during the tournament (9.3% vs 8.7%). The World Cup lifted sports reading among existing readers (Q1), not acquisition. Accept "no meaningful change".
- **Evidence:** H1 (control read); Insights, uniques of anonymous `article viewed`, daily, Jun 11 - Jul 19 vs the rest; Funnels to `account registered` by arrival period; `-- EVAL Q15`.
- **Context needed:** 02-timeline.md.
- **Grading:** must compare new visitors per day (or registration per visitor) and report no significant difference. Wrong: "the World Cup drove new readers" based on total sports traffic.

### Q16 — Why don't server pageviews match Mixpanel?
- **Prompt:** "Engineering's pageview numbers are higher than Mixpanel's. Which one is wrong?"
- **Type:** external-join
- **Answer:** Neither; they measure different things. Over the window `pageviews_served` exceeds Mixpanel `article viewed` by **18.2% on web, 7.4% on iOS, and 8.2% on Android**, varying by day (web 4.5%-32.3%), with daily correlation 0.91-0.99. The server count includes readers whose browsers block analytics (mostly web), readers who opted out of tracking in the apps, and automated traffic. Use Mixpanel for reader behavior and the warehouse for load and capacity. Accept the per-platform gaps within ±3 points and the explanation.
- **Evidence:** `-- EVAL Q16`; warehouse `platform_reliability_daily` joined to `article viewed` by date and `platform`.
- **Context needed:** 04-metrics-and-tables.md (`pageviews_served` caveats).
- **Grading:** must quantify by platform and explain with the table caveats. Wrong: "Mixpanel is dropping data" or "the warehouse double counts".

### Q17 — How did the subscriber base grow?
- **Prompt:** "How many subscribers did we add this summer, and what's our monthly churn?"
- **Type:** context
- **Answer:** About **2,475 subscribers at the start of the window and 3,239 at the end** (+764, +31%). New subscriptions by month: **June 271 (from June 4), July 360, August 293, September 409** (October 1: 12). Cancellations: **June 142, July 147, August 137, September 149** (October 1: 6). Monthly churn (subscribers paid all of the prior month) was **5.7%** on average July-September. September includes the Labor Day sale week (153 subscriptions); August includes the three-day web metering incident (about 17 subscriptions lost, Q6). The World Cup weeks averaged 10.7 subscriptions a day vs 10.6 in the five weeks after, so July is not explained by the tournament. Accept churn 4.5-6.5% and net growth near +750.
- **Evidence:** `-- EVAL Q17`; Insights, `subscription started` and `subscription cancelled`, monthly; profiles by `reader_tier`.
- **Context needed:** 04-metrics-and-tables.md (monthly churn definition), 02-timeline.md (to explain the months).
- **Grading:** must give both flows and a churn rate with a stated denominator. Wrong: churn as cancellations ÷ end-of-window subscribers without saying so; counting October 1 as a month; crediting the World Cup for July's subscriptions.

### Q18 — How many readers do we have?
- **Prompt:** "How many readers did we have this summer? How many are anonymous?"
- **Type:** context
- **Answer:** **9,993 unique readers** (Mixpanel Uniques with identity resolution): **7,319 accounts** (free readers and subscribers) and **2,674 visitors who never registered**, who exist only as devices. **1,821 accounts were created in the window**; their earlier anonymous reads merge into the account. The project has 15,083 distinct devices, so counting devices would overstate readers by about 1.5x. Accept 9,900-10,000 readers and about 2,700 anonymous.
- **Evidence:** `-- EVAL Q18`; Insights uniques of any event; uniques of `account registered`.
- **Context needed:** 00-manifest.md (identity notes).
- **Grading:** must count resolved people, not devices, and separate anonymous visitors. Wrong: 15,083 (devices); 7,319 (accounts only) given as "readers".

### Q19 — Do app readers convert better?
- **Prompt:** "Should we push free readers into the apps? Do app readers subscribe at a higher rate at the paywall than web readers?"
- **Type:** null-hypothesis
- **Answer:** No difference in conversion. Subscriptions per paywall view are **web 0.87%, Android 0.87%, iOS 0.92%** (chi-square 0.66 on 2 degrees of freedom, p ≈ 0.72). The null holds in the obvious splits: newsletter reads (web 1.75%, Android 2.15%, iOS 1.86%; chi-square 1.91, p ≈ 0.38), other reads (chi-square 1.33), outside the sale (chi-square 0.99), and sale week (chi-square 0.28 on 153 subscriptions). The web carries about 61% of paywall views (92,731 of 152,932), so it brings the most subscriptions by volume. Moving readers to the apps would not raise the paywall rate. Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q19`; Insights, `subscription started` ÷ `paywall shown`, breakdown `platform`.
- **Context needed:** 03-event-dictionary.md (`platform`), 04-metrics-and-tables.md (paywall conversion per view).
- **Grading:** must compare conversion per paywall view across platforms and test it. Wrong: "web converts best" (volume, not rate); "Android converts best" from the newsletter split without a test.

### Q20 — What should we worry about this quarter?
- **Prompt:** "Looking at the summer, what should we worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names several of these, with numbers:
  1. **Light-reading subscribers churn.** 14% of subscriber-months had fewer than 4 reading days, and those cancel at 14.0% a month vs 4.4% (Q12). Habit-building for light readers is the clearest retention lever.
  2. **Sale cohort renewals.** 153 sale-week subscribers face a 4x price jump at their first renewal (October for monthly plans); their retention decides whether the sale paid off (Q10).
  3. **Paywall reliability.** Three days of a degraded web meter cost about 17 subscriptions (Q5, Q6); the web carries about 61% of paywall views (Q19).
  4. **Acquisition mix.** Meta is the cheapest per visitor but costs 1.45x Google per registration; Google search is the most efficient paid channel (Q7, Q8).
  5. **Newsletters are the conversion engine.** Newsletter reads convert at 2.4x and supply 22% of new subscriptions from 10% of paywall views (Q9).
  6. **Post-World Cup sports readers.** Sports reading returned to its baseline share right after the final (Q1); the World Cup did not bring new readers (Q15) and did not lift subscriptions (Q17).
  7. **The grant ends after 2026** (01-business.md). Subscribers grew 31% this summer (Q17), and reader revenue still covers under half of the budget.
  8. Upside to act on: ship For You for home-screen engagement (Q2) and keep promoting Gift Articles (Q4).
- **Evidence:** `-- EVAL Q20` plus the queries cited.
- **Context needed:** all guides.
- **Grading:** credit 3+ concrete, data-backed risks or actions. Wrong: generic advice without numbers; claiming For You or the World Cup drove subscriptions.
