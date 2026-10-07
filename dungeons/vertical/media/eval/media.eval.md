# The Lantern (media) — 20-question eval

- **Data:** `data/verify-media` (full fidelity: 10,000 readers, 9,989 with events, 7,396 accounts, 2,593 visitors who never registered, 883,313 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query (or the `-- STORY` query it names) in `dungeons/vertical/media/media.sql` on that data.
- **Stories:** ids refer to the `stories` export in `media.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — What did the World Cup do for readership?
- **Prompt:** "Sports traffic went crazy in June and July. How big was the World Cup bump, and was it only sports?"
- **Type:** trend
- **Answer:** A large, sports-only bump during the tournament (June 11 - July 19). Sports went from **9.0% of article views** in the baseline (Jun 4-7 and Jul 23 - Aug 19) to **15.7%** during the tournament, about **237 → 413 sports reads a day**. Relative to non-sports reading, sports rose **1.89x** for all readers and **2.03x** for subscribers (subscribers have no meter, so their number is the cleanest read; free readers' extra sports clicks partly hit the paywall). It built through the bracket: sports share 12.9% the week of June 8, then 14.2%, 14.4%, 16.2%, and 16.9-17.1% in the weeks of July 6 and July 13 (knockouts and final), back to 9.5% the week of July 20 and about 9% after. Non-sports reading per active reader-day did not change (2.48 during vs 2.49 baseline), so it was not a general traffic lift. Accept a sports lift of 1.7x-2.2x and "sports only".
- **Evidence:** H1-world-cup-sports-surge; Insights, `article viewed`, breakdown `section`, daily or weekly, optionally filter `reader_tier` in (digital, all_access); `-- STORY H1` and `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (tournament dates and phases).
- **Grading:** must give the size and tie it to the tournament dates; must say whether non-sports moved. Wrong: "overall traffic doubled"; comparing raw total views (the reader base grows over the summer); using the preview week (from June 8) as baseline.

### Q2 — Should we ship the For You feed?
- **Prompt:** "Is the For You feed test working in the apps? Should we ship it?"
- **Type:** funnel
- **Answer:** Yes on engagement. Since July 15, home-module click-through (recommendation clicked with module = home_feed per home view, apps only) is **49.9% in For You vs 33.7% in Control, 1.48x** (z ≈ 24). Each extra click opens an article: For You readers attempt **2.12 reads per app reader-day vs 2.04** (+3.6%) and view 1.46 articles vs 1.43 (some extra reads by free readers hit the paywall). The split is balanced (1,560 For You vs 1,548 Control exposed readers). It does not change paywall conversion (see Q3). Recommend shipping. Accept a click-through lift of 1.3x-1.65x.
- **Evidence:** H2-for-you-feed-experiment; Insights, `recommendation clicked` (module = home_feed) ÷ `front page viewed` (page = home), filter platform in (ios_app, android_app), Jul 15 - Oct 1, breakdown `Experiment: For You Feed` (or the Experiments report on `$experiment_started`); `-- STORY H2` and `-- EVAL Q2`.
- **Context needed:** 02-timeline.md (start date, arms, apps only), 03-event-dictionary.md (`module`, `page`).
- **Grading:** must compare arms on the home module rate after exposure and give the size. Wrong: including web events (not in the test); counting all recommendation modules (related and most-read are not part of the test); comparing raw click totals without home views.

### Q3 — Does For You change subscriptions?
- **Prompt:** "Does the For You feed help us sell subscriptions?"
- **Type:** null-hypothesis
- **Answer:** No meaningful effect. Paywall conversion per view after exposure is **0.86% in For You vs 0.87% in Control (z = -0.13)**, and it holds by platform (Android 0.80% vs 0.93%, z = -0.95; iOS 0.95% vs 0.84%, z = 0.62; web 0.86% vs 0.82%, z = 0.28). The share of exposed readers who subscribed afterwards is **12.4% vs 12.0%** (z = 0.36). For You lifts reading, not conversion. Accept "no significant difference".
- **Evidence:** H2 (control read); Insights, `subscription started` ÷ `paywall shown`, from Jul 15, breakdown `Experiment: For You Feed`; `-- EVAL Q3`.
- **Context needed:** 02-timeline.md, 04-metrics-and-tables.md (paywall conversion).
- **Grading:** must test and report no significant effect. Wrong: claiming a lift from the extra reads; reading a single platform split as a finding.

### Q4 — Are subscribers using Gift Articles?
- **Prompt:** "We launched Gift Articles in August. Are subscribers actually using it? Did sharing go up?"
- **Type:** trend
- **Answer:** Yes. Subscriber sharing rose about **1.6x** once the rollout finished: shares per attempted read went from **3.36% (Jul 20 - Aug 10) to 5.40% (from Aug 18), 1.61x**, while free readers (who cannot gift) did not rise (3.43% → 3.20%, 0.93x), so the effect net of the free-reader control is **about 1.7x**. Weekly subscriber shares went from about 500 before launch to 790-915 after. **2,264 gift links** were sent by **1,483 subscribers**; gift links are 38% of subscriber shares after the ramp. Gift links never appear before August 11 or from non-subscribers. Accept 1.4x-1.9x.
- **Evidence:** H3-gift-articles-launch; Insights, `article shared` ÷ (`article viewed` + `paywall shown`), breakdown `reader_tier`, Jul 20 - Aug 10 vs Aug 18 - Oct 1, and `article shared` by `share_method`; `-- STORY H3` and `-- EVAL Q4`.
- **Context needed:** 02-timeline.md (launch, one-week rollout), 03-event-dictionary.md (`share_method`).
- **Grading:** must compare subscribers before and after with a control or a rate, and give adoption. Wrong: using the rollout week as "after"; counting only gift links as the effect (some subscriber sharing existed before); raw share totals without normalizing.

### Q5 — What happened to the paywall in late August?
- **Prompt:** "Paywall views and new subscriptions dropped for a few days at the end of August. What happened?"
- **Type:** external-join
- **Answer:** The **web metering incident, August 25-27**. `platform_reliability_daily` shows `service_status = major_outage` for web on those three days with `meter_error_rate` 0.69-0.72 (normally below 0.004); the apps stayed operational. In Mixpanel, web paywall views fell to **about 290-310 a day** (vs 735-1,018 on the days around it) while app paywall views held at 400-480; the web/app ratio fell to **0.31x** of its level in the 14 days either side (0.68 vs 2.20). Web subscriptions fell to 1-5 a day. Web article views by free readers rose because the blocked reads went through. Everything was back to normal on August 28. Accept naming the web, the dates, and a drop to roughly 0.25x-0.4x.
- **Evidence:** H4-web-meter-outage; Insights, `paywall shown` daily by `platform`, joined to `platform_reliability_daily`; `-- STORY H4` and `-- EVAL Q5`.
- **Context needed:** 02-timeline.md (incident dates), 04-metrics-and-tables.md (`platform_reliability_daily`).
- **Grading:** must name the platform and the warehouse evidence. Wrong: "readers lost interest"; blaming the apps; missing that article views went up.

### Q6 — What did the incident cost?
- **Prompt:** "How many subscriptions did the August paywall incident cost us?"
- **Type:** external-join
- **Answer:** About **20 subscriptions** (accept 12-28). Using the web/app paywall ratio from the surrounding days (Aug 11 - Sep 10 without the incident days), the web should have shown about 2,844 paywalls on August 25-27 and showed 884, so about **1,960 paywall views were lost**. At the web's normal conversion per paywall view that is about 29 expected web subscriptions vs 7 actual. At the window's average first-period price (from `subscription_billing_daily`, outside the sale) that is about **$1,300 of first-period bookings**, plus their renewals.
- **Evidence:** H4-web-meter-outage; `-- EVAL Q6`.
- **Context needed:** 02-timeline.md, 04-metrics-and-tables.md.
- **Grading:** must build a counterfactual from a baseline (other days or the apps) and convert lost paywall views to subscriptions. Wrong: "zero, because subscriptions recovered"; using total daily subscriptions without a platform baseline.

### Q7 — Which paid channel gives the cheapest readers?
- **Prompt:** "Which paid channel brings us the cheapest readers? Meta looks cheapest — is it?"
- **Type:** external-join
- **Answer:** Meta is cheapest per visitor but not per registered reader. Window spend (warehouse `marketing_spend_daily`) over Mixpanel new visitors: **Meta $1.48, Google $2.42, podcast ads $3.28** (Meta about 0.61x Google). But only about a quarter of Meta visitors register (vs about half for Google), so spend per registration is **Google $4.58, Meta $5.40 (1.18x Google), podcast ads $6.03**. Per subscriber (small counts): Google $29 (67), Meta $34 (49), podcast ads $41 (34). Spend: Google $1,932, Meta $1,686, podcast ads $1,387. Google search is the most efficient paid channel. Accept Meta per visitor 0.55x-0.7x of Google and Meta per registration 1.05x-1.35x of Google.
- **Evidence:** H5-paid-channel-economics; Insights uniques of `article viewed` (reader_tier = anonymous) by `acquisition_channel`, Funnels to `account registered` (7-day window), joined to `marketing_spend_daily.spend_usd`; `-- STORY H5` and `-- EVAL Q7`.
- **Context needed:** 04-metrics-and-tables.md (CAC uses Mixpanel counts), 01-business.md (channels).
- **Grading:** must join spend to Mixpanel visitors or registrations and go past cost per visitor. Wrong: using the networks' `clicks` as the denominator (they run above Mixpanel visitors, e.g. Meta 1,388 clicks vs 1,140 visitors); stopping at "Meta is cheapest".

### Q8 — What share of new visitors register?
- **Prompt:** "What share of new visitors create a free account, and does it depend on where they come from?"
- **Type:** funnel
- **Answer:** Overall **42.6%** of new visitors (first visit through Sep 24) register within 7 days. Visitors from social platforms register at about **half** the rate of everyone else: **Meta ads 27.1% and organic social 28.3%** vs organic search 51.1%, Google ads 52.7%, podcast ads 54.4%, direct 49.3% (social platforms 27.4% vs 51.7% for the rest, 0.53x). Accept a social/other ratio of 0.45-0.6.
- **Evidence:** H5-paid-channel-economics; Funnels, `article viewed` (reader_tier = anonymous) → `account registered`, 7-day window, breakdown `acquisition_channel`; `-- EVAL Q8`.
- **Context needed:** 03-event-dictionary.md (anonymous first read, registration), 04-metrics-and-tables.md (registration rate).
- **Grading:** must restrict to new (anonymous) visitors and break down by channel. Wrong: a funnel from any `article viewed` (existing readers never register, which drags the rate toward zero); breaking down by a user profile property only (visitors who never register have no profile).

### Q9 — Which readers convert best at the paywall?
- **Prompt:** "Where do our new subscribers come from? Which traffic sources convert best at the paywall?"
- **Type:** segmentation
- **Answer:** **Newsletter readers.** A paywall view from a newsletter click converts at **1.81%** vs **0.74%** for every other source combined (**2.4x**); every other referrer sits between 0.53% and 0.93% (push 0.93% on 29 subscriptions, site search 0.53% on 31). Newsletters are **10.6% of paywall views but 22.4% of new subscriptions**. The largest absolute sources are newsletters (281 subscriptions) and internal links (280, at an average rate). Accept 2.0x-2.9x.
- **Evidence:** H6-newsletter-readers-convert; Insights, `subscription started` ÷ `paywall shown`, breakdown `referrer`; `-- STORY H6` and `-- EVAL Q9`.
- **Context needed:** 03-event-dictionary.md (how `referrer` is set), 04-metrics-and-tables.md (paywall conversion per view).
- **Grading:** must compare conversion per paywall view, not raw subscription counts. Wrong: "internal links are best" (largest volume, average rate); "push converts best" (29 subscriptions, within noise of the rest).

### Q10 — Did the Labor Day sale pay off?
- **Prompt:** "Did the Labor Day sale work? Was the discount worth it?"
- **Type:** external-join
- **Answer:** It more than doubled sign-ups but brought in less first-period cash. Sale week (Sep 3-9): **146 subscriptions, 20.9 a day vs 9.0 a day** in the four weeks before; conversion per paywall view **1.65% vs 0.76% (2.17x)**. With 60% off the first period (prices from `subscription_billing_daily`), first-period bookings were **$496 a day vs $569** (−13%) and **$0.39 vs $0.48 per paywall view (0.82x)**. At list price the sale cohort is worth **$1,241 a day vs $569** (2.2x), so it pays off if sale subscribers renew at a reasonable rate; the first renewals (monthly plans in October, at 2.5x the sale price) fall outside the window. The plan mix moved little (Q14). Accept conversion 1.7x-2.5x and first-period bookings per view 0.7x-1.0x.
- **Evidence:** H7-labor-day-sale; Insights, `subscription started` ÷ `paywall shown`, sale week vs Aug 6 - Sep 2, joined to `subscription_billing_daily.first_period_price_usd`; `-- STORY H7` and `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (sale dates and discount), 04-metrics-and-tables.md (first-period bookings), 01-business.md (renewals at list price).
- **Grading:** must use warehouse prices for revenue and separate first-period cash from list value. Wrong: "revenue doubled" (ignores the discount); using list prices for sale subscriptions; no renewal caveat.

### Q11 — How fast do new visitors register?
- **Prompt:** "How long after their first visit do people sign up for an account?"
- **Type:** funnel
- **Answer:** Median **5.0 hours** overall (registrations within 7 days, visitors through Sep 24), but it splits by channel: about **3.6-4.0 hours** for organic search, Google ads, podcast ads, and direct, vs **about 12-13 hours for Meta ads (11.7) and organic social (13.1)**, roughly **3x** (social platforms 12.4 h vs 3.9 h for the rest, 3.2x). About 22-23% of social registrants take more than a day vs 2-3% elsewhere. Accept a social/other median ratio of 2.5x-3.6x.
- **Evidence:** H8-registration-speed-by-channel; Funnels, `article viewed` (reader_tier = anonymous) → `account registered`, 7-day window, median time to convert, breakdown `acquisition_channel`; `-- STORY H8` and `-- EVAL Q11`.
- **Context needed:** 03-event-dictionary.md, 04-metrics-and-tables.md (time to register).
- **Grading:** must report a median by channel. Wrong: mean only (skewed by the long tail); including existing readers.

### Q12 — Which subscribers are about to cancel?
- **Prompt:** "Which subscribers are most likely to cancel? Is there an early warning sign?"
- **Type:** retention
- **Answer:** Subscribers who stop reading. Among subscribers paid for the whole prior month (subscriber-months July-September), those who read on **fewer than 4 days** in the prior month cancel at **16.1%** in the next month vs **3.2%** for everyone else (**about 5x**). Above 4 reading days the rate is flat (4-7 days 3.0%, 8-14 days 3.4%, 15+ days 3.1% on only 65 subscriber-months), so the warning sign is a threshold at about 4 reading days a month. About 13.9% of subscriber-months are under the threshold. Cancellation reasons agree: `not_reading_enough` is the most common stated reason (154 of 532, 29%), just ahead of `price` (148). Accept 3x-6x and a threshold near 4 days.
- **Evidence:** H9-reading-habit-churn; cohorts by distinct reading days in month M-1, Insights uniques of `subscription cancelled` in month M; `-- STORY H9` and `-- EVAL Q12`.
- **Context needed:** 04-metrics-and-tables.md (reading days, monthly churn), 01-business.md (cancellation).
- **Grading:** must use prior-period reading as the predictor and give the rates. Wrong: using reading in the same month as the cancellation (reading after a cancel is metered); "All Access cancels more" without controlling for reading.

### Q13 — When do people read longer?
- **Prompt:** "Do people read differently on weekends?"
- **Type:** segmentation
- **Answer:** Yes: fewer reads but longer ones. Average read time is **243-245 seconds on Saturday and Sunday vs 181-183 on weekdays (1.34x)**, and scroll depth is 72% vs 63%. The content mix does not change (features and analysis are about 34% of reads every day), so readers spend longer on the same kinds of articles. Weekend days have fewer reads (39,905 Saturday and 42,787 Sunday vs 49,378-51,161 on Monday-Thursday). Accept 1.25x-1.45x.
- **Evidence:** H10-weekend-long-reads; Insights, `article viewed`, average `read_time_sec`, breakdown day of week; `-- STORY H10` and `-- EVAL Q13`.
- **Context needed:** 03-event-dictionary.md (`read_time_sec`).
- **Grading:** must give the size and rule out a content-mix shift. Wrong: "weekends are more engaged" based on volume (volume is lower); attributing it to more features on weekends.

### Q14 — Which plans do new subscribers choose?
- **Prompt:** "What plans are new subscribers picking? Did the sale change the mix?"
- **Type:** segmentation
- **Answer:** Of 1,256 new subscriptions, **Digital monthly 44.3%, Digital annual 29.9%, All Access monthly 16.2%, All Access annual 9.6%** (Digital 74%, annual 40%). The sale week (146 subscriptions) had more All Access (32.9% vs 24.9% outside the sale, z = 2.08, p ≈ 0.04) and a little less annual (34.2% vs 40.3%, z = -1.40). The All Access tilt is borderline on a small sample: it does not survive a correction for testing two mix shares, and the sale discounted both plans equally. Accept "little or no mix change" or "a small, borderline tilt toward All Access"; do not accept a confident claim that the sale shifted buyers.
- **Evidence:** `-- EVAL Q14`; Insights, `subscription started`, breakdown `plan` and `billing_period`, filter `offer`.
- **Context needed:** 01-business.md (plans), 02-timeline.md (sale terms).
- **Grading:** must give the mix and test the sale difference with its sample size. Wrong: "the sale shifted buyers to All Access" stated as a firm finding; comparing counts without shares.

### Q15 — Did the World Cup bring new readers?
- **Prompt:** "Did the World Cup bring us new readers?"
- **Type:** null-hypothesis
- **Answer:** No measurable effect. New visitors averaged **38.3 a day during the tournament vs 37.7 outside it** (Welch t = 0.48). Visitors who arrived during the tournament registered at 43.8% vs 42.0% (z = 1.13, not significant; tournament arrivals happened to include fewer social-platform visitors, 35% vs 38%, who register less). Registrations per day were 16.9 vs 15.8 (t = 1.49, not significant). New visitors' first articles were no more likely to be sports during the tournament (8.7% vs 9.3%). The World Cup lifted sports reading among existing readers (Q1), not acquisition. Accept "no meaningful change".
- **Evidence:** H1 (control read); Insights, uniques of anonymous `article viewed` and `account registered`, daily, Jun 11 - Jul 19 vs the rest; `-- EVAL Q15`.
- **Context needed:** 02-timeline.md.
- **Grading:** must compare rates per day (or per visitor) and report no significant difference. Wrong: "the World Cup drove new readers" based on total sports traffic; calling the registration difference a lift without a test.

### Q16 — Why don't server pageviews match Mixpanel?
- **Prompt:** "Engineering's pageview numbers are higher than Mixpanel's. Which one is wrong?"
- **Type:** external-join
- **Answer:** Neither; they measure different things. Over the window `pageviews_served` exceeds Mixpanel `article viewed` by **18.1% on web, 9.5% on iOS, and 7.7% on Android**, varying by day (web 4.5%-31.6%), with daily correlation 0.90-0.98. The server count includes readers whose browsers block analytics (mostly web), readers who opted out of tracking in the apps, and automated traffic. Use Mixpanel for reader behavior and the warehouse for load and capacity. Accept the per-platform gaps within ±3 points and the explanation.
- **Evidence:** `-- EVAL Q16`; warehouse `platform_reliability_daily` joined to `article viewed` by date and `platform`.
- **Context needed:** 04-metrics-and-tables.md (`pageviews_served` caveats).
- **Grading:** must quantify by platform and explain with the table caveats. Wrong: "Mixpanel is dropping data" or "the warehouse double counts".

### Q17 — How did the subscriber base grow?
- **Prompt:** "How many subscribers did we add this summer, and what's our monthly churn?"
- **Type:** context
- **Answer:** About **2,509 subscribers at the start of the window and 3,233 at the end** (+724, +29%). New subscriptions by month: **June 241 (from June 4), July 337, August 290, September 383** (October 1: 5). Cancellations: **June 150, July 136, August 123, September 117** (October 1: 6). Monthly churn (subscribers paid all of the prior month) was **5.0%** on average July-September. September includes the Labor Day sale week (146 subscriptions); August includes the three-day web metering incident (about 20 subscriptions lost, Q6). The World Cup weeks averaged 10.7 subscriptions a day vs 10.0 in the five weeks after (not significant), so July is not explained by the tournament. June starts lower because the free readers who registered during the window add paywall views as their number grows. Accept churn 4-6% and net growth near +700.
- **Evidence:** `-- EVAL Q17`; Insights, `subscription started` and `subscription cancelled`, monthly; profiles by `reader_tier`.
- **Context needed:** 04-metrics-and-tables.md (monthly churn definition), 02-timeline.md (to explain the months).
- **Grading:** must give both flows and a churn rate with a stated denominator. Wrong: churn as cancellations ÷ end-of-window subscribers without saying so; counting October 1 as a month; crediting the World Cup for July's subscriptions.

### Q18 — How many readers do we have?
- **Prompt:** "How many readers did we have this summer? How many are anonymous?"
- **Type:** context
- **Answer:** **9,989 unique readers** (Mixpanel Uniques with identity resolution): **7,396 accounts** (free readers and subscribers) and **2,593 visitors who never registered**, who exist only as devices. **1,942 accounts were created in the window**; their earlier anonymous reads merge into the account. The project has 14,965 distinct devices, so counting devices would overstate readers by about 1.5x. Accept 9,900-10,000 readers and about 2,600 anonymous.
- **Evidence:** `-- EVAL Q18`; Insights uniques of any event; uniques of `account registered`.
- **Context needed:** 00-manifest.md (identity notes).
- **Grading:** must count resolved people, not devices, and separate anonymous visitors. Wrong: 14,965 (devices); 7,396 (accounts only) given as "readers".

### Q19 — Do app readers convert better?
- **Prompt:** "Should we push free readers into the apps? Do app readers subscribe at a higher rate at the paywall than web readers?"
- **Type:** null-hypothesis
- **Answer:** No difference in conversion. Subscriptions per paywall view are **web 0.85%, Android 0.84%, iOS 0.87%** (chi-square 0.11 on 2 degrees of freedom, p ≈ 0.95). The null holds in the obvious splits: newsletter reads (web 1.78%, Android 2.01%, iOS 1.68%; chi-square 0.83), other reads (0.74%, 0.71%, 0.78%; chi-square 0.57), outside the sale (chi-square 0.75), and sale week (chi-square 1.93 on 146 subscriptions). The web carries about two thirds of paywall views (100,076 of 146,923), so it brings the most subscriptions by volume. Moving readers to the apps would not raise the paywall rate. Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q19`; Insights, `subscription started` ÷ `paywall shown`, breakdown `platform`.
- **Context needed:** 03-event-dictionary.md (`platform`), 04-metrics-and-tables.md (paywall conversion per view).
- **Grading:** must compare conversion per paywall view across platforms and test it. Wrong: "web converts best" (volume, not rate); citing a single split without a test.

### Q20 — What should we worry about this quarter?
- **Prompt:** "Looking at the summer, what should we worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names several of these, with numbers:
  1. **Light-reading subscribers churn.** 13.9% of subscriber-months had fewer than 4 reading days, and those cancel at 16.1% a month vs 3.2% (Q12). Habit-building for light readers is the clearest retention lever.
  2. **Sale cohort renewals.** 146 sale-week subscribers face a 2.5x price jump at their first renewal (October for monthly plans); their retention decides whether the sale paid off (Q10).
  3. **Paywall reliability.** Three days of a degraded web meter cost about 20 subscriptions (Q5, Q6); the web carries about two thirds of paywall views (Q19).
  4. **Acquisition mix.** Meta is the cheapest per visitor but costs 1.18x Google per registration; Google search is the most efficient paid channel (Q7, Q8).
  5. **Newsletters are the conversion engine.** Newsletter reads convert at 2.4x and supply 22% of new subscriptions from 11% of paywall views (Q9).
  6. **Post-World Cup sports readers.** Sports reading returned to its baseline share right after the final (Q1); the World Cup did not bring new readers (Q15) and did not measurably lift subscriptions (Q17).
  7. **The grant ends after 2026** (01-business.md). Subscribers grew 29% this summer (Q17), and reader revenue still covers under half of the budget.
  8. Upside to act on: ship For You (Q2) and keep promoting Gift Articles (Q4).
- **Evidence:** `-- EVAL Q20` plus the queries cited.
- **Context needed:** all guides.
- **Grading:** credit 3+ concrete, data-backed risks or actions. Wrong: generic advice without numbers; claiming For You or the World Cup drove subscriptions.
