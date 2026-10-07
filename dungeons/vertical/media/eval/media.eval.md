# The Lantern (media) — 20-question eval

- **Data:** `data/verify-media` (full fidelity: 10,000 readers, 9,990 with events, 7,294 accounts, 2,696 visitors who never registered, 833,974 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query (or the `-- STORY` query it names) in `dungeons/vertical/media/media.sql` on that data.
- **Stories:** ids refer to the `stories` export in `media.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — What did the World Cup do for readership?
- **Prompt:** "Sports traffic went crazy in June and July. How big was the World Cup bump, and was it only sports?"
- **Type:** trend
- **Answer:** A large, sports-only bump during the tournament (June 11 - July 19). Sports went from **9.0% of article views** in the baseline (Jun 4-7 and Jul 23 - Aug 19) to **15.5%** during the tournament, about **214 → 368 sports reads a day**. Relative to non-sports reading, sports rose **1.85x** for all readers and **1.96x** for subscribers (subscribers have no meter, so their number is the cleanest read; free readers' extra sports clicks partly hit the paywall). It built through the bracket: sports share 11.8% the week of June 8, 13.5%, 14.5%, 15.7%, then 17.2-17.3% in the weeks of July 6 and July 13 (knockouts and final), back to 9.6% the week of July 20 and about 9% after. Non-sports reading per active reader-day did not change (2.25 during vs 2.28 baseline), so it was not a general traffic lift. Accept a sports lift of 1.7x-2.2x and "sports only".
- **Evidence:** H1-world-cup-sports-surge; Insights, `article viewed`, breakdown `section`, daily or weekly, optionally filter `reader_tier` in (digital, all_access); `-- STORY H1` and `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (tournament dates and phases).
- **Grading:** must give the size and tie it to the tournament dates; must say whether non-sports moved. Wrong: "overall traffic doubled"; comparing raw total views (the reader base grows over the summer); using the preview week (from June 8) as baseline.

### Q2 — Should we ship the For You feed?
- **Prompt:** "Is the For You feed test working in the apps? Should we ship it?"
- **Type:** funnel
- **Answer:** Yes on engagement. Since July 15, home-module click-through (recommendation clicked with module = home_feed per home view, apps only) is **49.7% in For You vs 34.5% in Control, 1.44x** (z ≈ 22). Each extra click opens an article: For You readers view **1.21 articles per app reader-day vs 1.13** (+6%) and attempt 1.80 reads vs 1.68. The split is balanced (1,695 For You vs 1,781 Control exposed readers). It does not change paywall conversion (see Q3). Recommend shipping. Accept a click-through lift of 1.3x-1.6x.
- **Evidence:** H2-for-you-feed-experiment; Insights, `recommendation clicked` (module = home_feed) ÷ `front page viewed` (page = home), filter platform in (ios_app, android_app), Jul 15 - Oct 1, breakdown `Experiment: For You Feed` (or the Experiments report on `$experiment_started`); `-- STORY H2` and `-- EVAL Q2`.
- **Context needed:** 02-timeline.md (start date, arms, apps only), 03-event-dictionary.md (`module`, `page`).
- **Grading:** must compare arms on the home module rate after exposure and give the size. Wrong: including web events (not in the test); counting all recommendation modules (related and most-read are not part of the test); comparing raw click totals without home views.

### Q3 — Does For You change subscriptions?
- **Prompt:** "Does the For You feed help us sell subscriptions?"
- **Type:** null-hypothesis
- **Answer:** No meaningful effect. Paywall conversion per view after exposure is **0.88% in For You vs 0.85% in Control (z = 0.31)**, and it holds by platform (Android 0.89% vs 0.77%, z = 0.89; iOS 0.65% vs 0.78%, z = -0.88; web 1.05% vs 0.98%, z = 0.47). The share of exposed readers who subscribed afterwards is **11.9% vs 11.3%** (z ≈ 0.5). For You lifts reading, not conversion. Accept "no significant difference".
- **Evidence:** H2 (control read); Insights, `subscription started` ÷ `paywall shown`, from Jul 15, breakdown `Experiment: For You Feed`; `-- EVAL Q3`.
- **Context needed:** 02-timeline.md, 04-metrics-and-tables.md (paywall conversion).
- **Grading:** must test and report no significant effect. Wrong: claiming a lift from the extra reads; reading a single platform split as a finding.

### Q4 — Are subscribers using Gift Articles?
- **Prompt:** "We launched Gift Articles in August. Are subscribers actually using it? Did sharing go up?"
- **Type:** trend
- **Answer:** Yes. Subscriber sharing rose about **1.6x** once the rollout finished: shares per attempted read went from **3.70% (Jul 20 - Aug 10) to 5.83% (from Aug 18), 1.58x**, while free readers (who cannot gift) stayed flat (3.61% → 3.68%, 1.02x), so the net effect is **about 1.54x**. Weekly subscriber shares went from 440-500 before launch to 720-850 after. **2,083 gift links** were sent by **1,406 subscribers**; gift links are 37% of subscriber shares after the ramp. Gift links never appear before August 11 or from non-subscribers. Accept 1.4x-1.8x.
- **Evidence:** H3-gift-articles-launch; Insights, `article shared` ÷ (`article viewed` + `paywall shown`), breakdown `reader_tier`, Jul 20 - Aug 10 vs Aug 18 - Oct 1, and `article shared` by `share_method`; `-- STORY H3` and `-- EVAL Q4`.
- **Context needed:** 02-timeline.md (launch, one-week rollout), 03-event-dictionary.md (`share_method`).
- **Grading:** must compare subscribers before and after with a control or a rate, and give adoption. Wrong: using the rollout week as "after"; counting only gift links as the effect (some subscriber sharing existed before); raw share totals without normalizing.

### Q5 — What happened to the paywall in late August?
- **Prompt:** "Paywall views and new subscriptions dropped for a few days at the end of August. What happened?"
- **Type:** external-join
- **Answer:** The **web metering incident, August 25-27**. `platform_reliability_daily` shows `service_status = major_outage` for web on those three days with `meter_error_rate` 0.69-0.72 (normally below 0.004); the apps stayed operational. In Mixpanel, web paywall views fell to **about 250 a day** (vs 700-930 on the days around it) while app paywall views held at about 400; the web/app ratio fell to **0.31x** of its level in the 14 days either side (0.62 vs 2.01). Web subscriptions fell to 1-3 a day. Web article views by free readers rose because the blocked reads went through. Everything was back to normal on August 28. Accept naming the web, the dates, and a drop to roughly 0.25x-0.4x.
- **Evidence:** H4-web-meter-outage; Insights, `paywall shown` daily by `platform`, joined to `platform_reliability_daily`; `-- STORY H4` and `-- EVAL Q5`.
- **Context needed:** 02-timeline.md (incident), 04-metrics-and-tables.md (`platform_reliability_daily`).
- **Grading:** must name the platform and the warehouse evidence. Wrong: "readers lost interest"; blaming the apps; missing that article views went up.

### Q6 — What did the incident cost?
- **Prompt:** "How many subscriptions did the August paywall incident cost us?"
- **Type:** external-join
- **Answer:** About **16 subscriptions** (accept 10-25). Using the web/app paywall ratio from the surrounding days, the web should have shown about 2,466 paywalls on August 25-27 and showed 758, so about **1,700 paywall views were lost**. At the web's normal conversion per paywall view that is about 23 expected web subscriptions vs 6 actual. At the window's average first-period price (from `subscription_billing_daily`, outside the sale) that is about **$1,000 of first-period bookings**, plus their renewals.
- **Evidence:** H4-web-meter-outage; `-- EVAL Q6`.
- **Context needed:** 02-timeline.md, 04-metrics-and-tables.md.
- **Grading:** must build a counterfactual from a baseline (other days or the apps) and convert lost paywall views to subscriptions. Wrong: "zero, because subscriptions recovered"; using total daily subscriptions without a platform baseline.

### Q7 — Which paid channel gives the cheapest readers?
- **Prompt:** "Which paid channel brings us the cheapest readers? Meta looks cheapest — is it?"
- **Type:** external-join
- **Answer:** Meta is cheapest per visitor but not per registered reader. Window spend (warehouse `marketing_spend_daily`) over Mixpanel new visitors: **Meta $1.48, Google $2.40, podcast ads $3.17** (Meta about 0.62x Google). But only about a quarter of Meta visitors register (vs about half for Google), so spend per registration is **Google $4.91, Meta $5.83 (1.19x Google), podcast ads $6.30**. Per subscriber (small counts): Google $27 (72), Meta $44 (38), podcast ads $46 (31). Spend: Google $1,945, Meta $1,686, podcast ads $1,437. Google search is the most efficient paid channel. Accept Meta per visitor 0.55x-0.7x of Google and Meta per registration 1.1x-1.35x of Google.
- **Evidence:** H5-paid-channel-economics; Insights uniques of `article viewed` (reader_tier = anonymous) by `acquisition_channel`, Funnels to `account registered`, joined to `marketing_spend_daily.spend_usd`; `-- STORY H5` and `-- EVAL Q7`.
- **Context needed:** 04-metrics-and-tables.md (CAC uses Mixpanel counts), 01-business.md (channels).
- **Grading:** must join spend to Mixpanel visitors or registrations and go past cost per visitor. Wrong: using the networks' `clicks` as the denominator (they run above Mixpanel visitors, e.g. Meta 1,389 clicks vs 1,138 visitors); stopping at "Meta is cheapest".

### Q8 — What share of new visitors register?
- **Prompt:** "What share of new visitors create a free account, and does it depend on where they come from?"
- **Type:** funnel
- **Answer:** Overall **40.4%** of new visitors (first visit through Sep 24) register within 7 days. Visitors from social platforms register at about **half** the rate of everyone else: **Meta ads 26.0% and organic social 23.5%** vs organic search 50.0%, Google ads 49.1%, podcast ads 50.8%, direct 47.0% (social platforms 25.2% vs 49.3% for the rest, 0.51x). Accept a social/other ratio of 0.45-0.6.
- **Evidence:** H5-paid-channel-economics; Funnels, `article viewed` (reader_tier = anonymous) → `account registered`, 7-day window, breakdown `acquisition_channel`; `-- EVAL Q8`.
- **Context needed:** 03-event-dictionary.md (anonymous first read, registration), 04-metrics-and-tables.md (registration rate).
- **Grading:** must restrict to new (anonymous) visitors and break down by channel. Wrong: a funnel from any `article viewed` (existing readers never register, which drags the rate toward zero); breaking down by a user profile property only (visitors who never register have no profile).

### Q9 — Which readers convert best at the paywall?
- **Prompt:** "Where do our new subscribers come from? Which traffic sources convert best at the paywall?"
- **Type:** segmentation
- **Answer:** **Newsletter readers.** A paywall view from a newsletter click converts at **1.79%** vs **0.74%** for every other source combined (**2.4x**); every other referrer sits between 0.72% and 0.79%, except site search (0.52%, on only 30 subscriptions). Newsletters are **11.6% of paywall views but 24.2% of new subscriptions**. The largest absolute sources are internal links (227 subscriptions) and newsletters (276). Accept 2.0x-2.9x.
- **Evidence:** H6-newsletter-readers-convert; Insights, `subscription started` ÷ `paywall shown`, breakdown `referrer`; `-- STORY H6` and `-- EVAL Q9`.
- **Context needed:** 03-event-dictionary.md (how `referrer` is set), 04-metrics-and-tables.md (paywall conversion per view).
- **Grading:** must compare conversion per paywall view, not raw subscription counts. Wrong: "internal links are best" (largest volume, average rate); "social converts worst" (it is average).

### Q10 — Did the Labor Day sale pay off?
- **Prompt:** "Did the Labor Day sale work? Was the discount worth it?"
- **Type:** external-join
- **Answer:** It more than doubled sign-ups but brought in a little less first-period cash. Sale week (Sep 3-9): **127 subscriptions, 18.1 a day vs 7.8 a day** in the four weeks before; conversion per paywall view **1.62% vs 0.72% (2.25x)**. With 60% off the first period (prices from `subscription_billing_daily`), first-period bookings were **$451 a day vs $496** (−9%) and **$0.40 vs $0.46 per paywall view (0.88x)**. At list price the sale cohort is worth **$1,126 a day vs $496** (2.3x), so it pays off if sale subscribers renew at a reasonable rate; the first renewals (monthly plans in October, at 2.5x the sale price) fall outside the window. Plan and billing mix did not change meaningfully (Q14). Accept conversion 1.7x-2.5x and first-period bookings per view 0.75x-1.0x.
- **Evidence:** H7-labor-day-sale; Insights, `subscription started` ÷ `paywall shown`, sale week vs Aug 6 - Sep 2, joined to `subscription_billing_daily.first_period_price_usd`; `-- STORY H7` and `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (sale dates and discount), 04-metrics-and-tables.md (first-period bookings), 01-business.md (renewals at list price).
- **Grading:** must use warehouse prices for revenue and separate first-period cash from list value. Wrong: "revenue doubled" (ignores the discount); using list prices for sale subscriptions; no renewal caveat.

### Q11 — How fast do new visitors register?
- **Prompt:** "How long after their first visit do people sign up for an account?"
- **Type:** funnel
- **Answer:** Median **5.0 hours** overall (registrations within 7 days, visitors through Sep 24), but it splits by channel: about **3.6-4.2 hours** for search, Google ads, podcast ads, and direct, vs **about 12 hours for Meta ads (11.8) and organic social (12.0)**, roughly **3x**. About 21-22% of social registrants take more than a day vs 1-2% elsewhere. Accept a social/other median ratio of 2.5x-3.5x.
- **Evidence:** H8-registration-speed-by-channel; Funnels, `article viewed` (reader_tier = anonymous) → `account registered`, 7-day window, median time to convert, breakdown `acquisition_channel`; `-- STORY H8` and `-- EVAL Q11`.
- **Context needed:** 03-event-dictionary.md, 04-metrics-and-tables.md (time to register).
- **Grading:** must report a median by channel. Wrong: mean only (skewed by the long tail); including existing readers.

### Q12 — Which subscribers are about to cancel?
- **Prompt:** "Which subscribers are most likely to cancel? Is there an early warning sign?"
- **Type:** retention
- **Answer:** Subscribers who stop reading. Among subscribers paid for the whole prior month (subscriber-months July-September), those who read on **fewer than 4 days** in the prior month cancel at **15.2%** in the next month vs **4.3%** for everyone else (**3.5x**). Above 4 reading days the rate is flat (4-7 days 4.3%, 8-14 days 4.3%, 15+ 4.2%), so the warning sign is a threshold at about 4 reading days a month. About 14.5% of subscriber-months are under the threshold. Cancellation reasons agree: `not_reading_enough` is the second most common reason (153 of 606) after `price` (182). Accept 2.5x-4.5x and a threshold near 4 days.
- **Evidence:** H9-reading-habit-churn; cohorts by distinct reading days in month M-1, Insights uniques of `subscription cancelled` in month M; `-- STORY H9` and `-- EVAL Q12`.
- **Context needed:** 04-metrics-and-tables.md (reading days, monthly churn), 01-business.md (cancellation).
- **Grading:** must use prior-period reading as the predictor and give the rates. Wrong: using reading in the same month as the cancellation (reading after a cancel is metered); "All Access cancels more" without controlling for reading.

### Q13 — When do people read longer?
- **Prompt:** "Do people read differently on weekends?"
- **Type:** segmentation
- **Answer:** Yes: fewer reads but longer ones. Average read time is **245-248 seconds on Saturday and Sunday vs 181-183 on weekdays (1.35x)**, and scroll depth is 72% vs 63%. The content mix does not change (features and analysis are 34-35% of reads every day), so readers spend longer on the same kinds of articles. Weekend days have fewer reads (31,783 Saturday and 36,153 Sunday vs 46,681-47,733 on Monday-Thursday). Accept 1.25x-1.45x.
- **Evidence:** H10-weekend-long-reads; Insights, `article viewed`, average `read_time_sec`, breakdown day of week; `-- STORY H10` and `-- EVAL Q13`.
- **Context needed:** 03-event-dictionary.md (`read_time_sec`).
- **Grading:** must give the size and rule out a content-mix shift. Wrong: "weekends are more engaged" based on volume (volume is lower); attributing it to more features on weekends.

### Q14 — Which plans do new subscribers choose?
- **Prompt:** "What plans are new subscribers picking? Did the sale change the mix?"
- **Type:** segmentation
- **Answer:** Of 1,142 new subscriptions, **Digital monthly 44.5%, Digital annual 25.7%, All Access monthly 18.5%, All Access annual 11.3%** (Digital 70%, annual 37%). The sale week looked a little more Digital (76.4% vs 69.5% outside the sale, z ≈ 1.6, not significant) and the annual share was the same (37.8% vs 37.0%). No meaningful mix change.
- **Evidence:** `-- EVAL Q14`; Insights, `subscription started`, breakdown `plan` and `billing_period`, filter `offer`.
- **Context needed:** 01-business.md (plans).
- **Grading:** must give the mix and test the sale difference. Wrong: claiming the sale shifted buyers to Digital.

### Q15 — Did the World Cup bring new readers?
- **Prompt:** "Did the World Cup bring us new readers and sign-ups?"
- **Type:** null-hypothesis
- **Answer:** No measurable effect. New visitors averaged **37.7 a day during the tournament vs 37.7 outside it**, and registrations **15.4 vs 15.1 a day** (Welch t = 0.28). New visitors' first articles were no more likely to be sports during the tournament (8.7% vs 9.2%). The World Cup lifted sports reading among existing readers (Q1), not acquisition. Accept "no meaningful change".
- **Evidence:** H1 (control read); Insights, `account registered` and uniques of anonymous `article viewed`, daily, Jun 11 - Jul 19 vs the rest; `-- EVAL Q15`.
- **Context needed:** 02-timeline.md.
- **Grading:** must compare rates per day and report no difference. Wrong: "the World Cup drove sign-ups" based on total sports traffic.

### Q16 — Why don't server pageviews match Mixpanel?
- **Prompt:** "Engineering's pageview numbers are higher than Mixpanel's. Which one is wrong?"
- **Type:** external-join
- **Answer:** Neither; they measure different things. Over the window `pageviews_served` exceeds Mixpanel `article viewed` by **18.2% on web, 10.7% on iOS, and 8.3% on Android**, varying by day (web 4.5%-32.5%), with daily correlation 0.94-0.98. The server count includes readers whose browsers block analytics (mostly web), readers who opted out of tracking in the apps, and automated traffic. Use Mixpanel for reader behavior and the warehouse for load and capacity. Accept the per-platform gaps within ±3 points and the explanation.
- **Evidence:** `-- EVAL Q16`; warehouse `platform_reliability_daily` joined to `article viewed` by date and `platform`.
- **Context needed:** 04-metrics-and-tables.md (`pageviews_served` caveats).
- **Grading:** must quantify by platform and explain with the table caveats. Wrong: "Mixpanel is dropping data" or "the warehouse double counts".

### Q17 — How did the subscriber base grow?
- **Prompt:** "How many subscribers did we add this summer, and what's our monthly churn?"
- **Type:** context
- **Answer:** About **2,486 subscribers at the start of the window and 3,022 at the end** (+536, +22%). New subscriptions by month: **June 228 (from June 4), July 313, August 260, September 331** (October 1: 10). Cancellations: **June 164, July 158, August 136, September 141** (October 1: 7). Monthly churn (subscribers paid all of the prior month) was **5.9%** on average July-September. July was lifted by World Cup reading, August was dented by the paywall incident, and September by the sale. Accept churn 5-7% and net growth near +500.
- **Evidence:** `-- EVAL Q17`; Insights, `subscription started` and `subscription cancelled`, monthly; profiles by `reader_tier`.
- **Context needed:** 04-metrics-and-tables.md (monthly churn definition), 02-timeline.md (to explain the months).
- **Grading:** must give both flows and a churn rate with a stated denominator. Wrong: churn as cancellations ÷ end-of-window subscribers without saying so; counting October 1 as a month.

### Q18 — How many readers do we have?
- **Prompt:** "How many readers did we have this summer? How many are anonymous?"
- **Type:** context
- **Answer:** **9,990 unique readers** (Mixpanel Uniques with identity resolution): **7,294 accounts** (free readers and subscribers) and **2,696 visitors who never registered**, who exist only as devices. **1,816 accounts were created in the window**; their earlier anonymous reads merge into the account. The project has 17,749 distinct devices, so counting devices would overstate readers by about 1.8x. Accept 9,900-10,000 readers and about 2,700 anonymous.
- **Evidence:** `-- EVAL Q18`; Insights uniques of any event; uniques of `account registered`.
- **Context needed:** 00-manifest.md (identity notes).
- **Grading:** must count resolved people, not devices, and separate anonymous visitors. Wrong: 17,749 (devices); 7,294 (accounts only) given as "readers".

### Q19 — Do some sections sell subscriptions better?
- **Prompt:** "Which sections sell the most subscriptions? Should we put more investigations behind the paywall?"
- **Type:** null-hypothesis
- **Answer:** Sections differ in volume, not in conversion. Politics (187), US news (147), and sports (136) bring the most new subscriptions because they get the most paywall views, but conversion per paywall view is about the same everywhere (**0.82%-0.96%**; chi-square 2.65 on 9 degrees of freedom, p ≈ 0.98). Investigations converts like every other section (0.82%) and is a small share (4.6%) of subscriptions. No section is a better paywall. Accept "no meaningful difference in conversion".
- **Evidence:** `-- EVAL Q19`; Insights, `subscription started` ÷ `paywall shown`, breakdown `section`.
- **Context needed:** 03-event-dictionary.md (`section` on walls and subscriptions).
- **Grading:** must separate volume from rate and test the rates. Wrong: "politics converts best" (volume); "investigations is a weak seller" from counts alone.

### Q20 — What should we worry about this quarter?
- **Prompt:** "Looking at the summer, what should we worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names several of these, with numbers:
  1. **Light-reading subscribers churn.** 14.5% of subscriber-months had fewer than 4 reading days, and those cancel at 15.2% a month vs 4.3% (Q12). Habit-building (newsletters, alerts) for light readers is the clearest retention lever.
  2. **Sale cohort renewals.** 127 sale-week subscribers face a 2.5x price jump at their first renewal (October for monthly plans); their retention decides whether the sale paid off (Q10).
  3. **Paywall reliability.** Three days of a fail-open web meter cost about 16 subscriptions (Q5, Q6); the web carries most paywall views.
  4. **Acquisition mix.** Meta is the cheapest per visitor but the most expensive paid channel per registration besides podcasts; Google search is the most efficient (Q7, Q8).
  5. **Newsletters are the conversion engine.** Newsletter reads convert at 2.4x and supply 24% of new subscriptions from 12% of paywall views (Q9).
  6. **Post-World Cup sports readers.** Sports reading returned to its baseline share right after the final (Q1); the World Cup did not bring new sign-ups (Q15).
  7. Upside to act on: ship For You (Q2) and keep promoting Gift Articles (Q4).
- **Evidence:** `-- EVAL Q20` plus the queries cited.
- **Context needed:** all guides.
- **Grading:** credit 3+ concrete, data-backed risks or actions. Wrong: generic advice without numbers; claiming For You or the World Cup drove subscriptions.
