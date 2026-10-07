# Shieldstone Insurance (insurance-application) — 20-question eval

- **Data:** `data/verify-insurance-application` (full fidelity: 10,000 people, 757,612 events, 9,753 distinct people in Mixpanel terms of whom 7,173 are identified, 3,743 new shoppers, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query (or the `-- STORY` query it names) in `dungeons/vertical/insurance-application/insurance-application.sql` on that data.
- **Stories:** ids refer to the `stories` export in `insurance-application.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Should we ship Express Quote?
- **Prompt:** "We've been testing Express Quote since July. Is it working, and should we roll it out to everyone?"
- **Type:** funnel
- **Answer:** Yes. Among shoppers who started a quote from 2026-07-08, **71.8% of Express Quote shoppers finished the quote within a day vs 54.5% in Control (1.32x)**, and the median time to finish fell from **15.5 to 8.0 minutes (0.52x)**. Purchases per completed quote did not change (24.0% vs 24.1%, z ≈ −0.1), so the extra completions turn into extra policies: **17.1% of Express shoppers bought vs 13.2% of Control shoppers (1.29x)**. The split is balanced (1,340 Express vs 1,370 Control exposed). Recommend shipping. Accept a completion lift of 1.2x-1.5x and a time ratio of 0.4-0.6.
- **Evidence:** H3-express-quote-experiment; Funnels `quote started` → `quote completed`, 1-day window, from Jul 8, breakdown `quote_flow` (or the Experiments report on `$experiment_started`); `-- STORY H3` and `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (start date, what the variant does), 00-manifest.md (anonymous quotes need identity merging).
- **Grading:** must compare arms after the start date and report completion and speed. Credit for checking purchases per completed quote or per shopper. Wrong: comparing shoppers before vs after July 8 instead of the two arms; counting only identified shoppers (drops the 2,580 anonymous shoppers, most of whom did not finish); claiming Express shoppers buy at a higher rate once they have a quote.

### Q2 — Is Snap & Settle making claims faster?
- **Prompt:** "Since Snap & Settle launched, how much faster are we settling auto claims? How many customers use it?"
- **Type:** funnel
- **Answer:** Much faster. For eligible auto claims (collision, glass, comprehensive) submitted Jul 21 - Sep 15, photo-estimate claims settled in a **median 1.9 days vs 6.9 days for adjuster-inspected claims (≈0.27x)**; against every eligible adjuster claim since June 4 (6.2 days; adjuster handling did not change at launch) the ratio is ≈0.30x. **62% of eligible auto claims** used it (117 of 189); 50% of all auto claims after launch, since theft and liability claims cannot. All auto claims together went from a median **6.7 days** before launch (Jun 4-Jul 20) to **3.5 days** after. No claim used photo estimates before July 21. Accept a ratio of 0.22-0.40 and adoption of 50%-70% of eligible claims.
- **Evidence:** H1-snap-and-settle; Funnels `claim submitted` → `claim settled`, Totals, hold `claim_id` constant, 30-day window, filter `product_line = auto` and `peril` in (collision, glass, comprehensive), date range from Jul 21 (or from Jun 4 for the story read), breakdown `claim_channel`, median time to convert; `-- STORY H1` and `-- EVAL Q2`.
- **Context needed:** 02-timeline.md (launch date, eligible perils), 04-metrics-and-tables.md (claim cycle time).
- **Grading:** must compare per claim and name the eligible perils or the channel split. Wrong: comparing all auto claims by channel including theft and liability (mix effect); "no change" from averaging in property claims; using `days_open` averages dominated by a few long claims without saying so.

### Q3 — What did Hurricane Delphine do to claims?
- **Prompt:** "How did the claims team hold up after Hurricane Delphine? What happened to volume, cycle times, and backlog in the Gulf?"
- **Type:** external-join
- **Answer:** Delphine (landfall 2026-08-27, catastrophe code PCS-2614, reporting period Aug 27 - Sep 9 for `gulf_coast`) flooded the Gulf property team. In `claims_operations_daily`, Gulf claims reported per day (every channel) went from **1.08 before to 20.7 during the catastrophe period**, open claims peaked at **236** (8 on an average day before; the pre-storm peak was 14), and adjuster hours rose from **12.4 a day to 72.4 during the period and 92.9 after** as independent adjusters arrived (Aug 29). In Mixpanel, **182 Gulf home and renters claims** were submitted in the period (180 wind/hail or water), and they settled in a **median 17.4 days vs 7.0 days** for every other property claim (**≈2.49x slower**). 179 of the 182 were settled by Oct 1, with **$1.81M** paid. Accept 2.1x-3.0x and a backlog peak around 235.
- **Evidence:** H2-hurricane-delphine; Funnels `claim submitted` → `claim settled` (property, hold `claim_id`, 45-day window) split by region and submit date, joined to `claims_operations_daily`; `-- STORY H2` and `-- EVAL Q3`.
- **Context needed:** 02-timeline.md (landfall, reporting period, adjuster deployment), 04-metrics-and-tables.md (`claims_operations_daily`).
- **Grading:** must use the warehouse for capacity/backlog and Mixpanel per-claim cycle time, and keep auto claims out of the property comparison. Wrong: comparing warehouse `new_claims_reported` to Mixpanel claim counts as if they should match (phone claims are only in the warehouse); attributing the slowdown to Snap & Settle; reading cycle time from claims that had not had time to close.

### Q4 — Which paid channel is cheapest per policy?
- **Prompt:** "Comparison sites look like our cheapest source of shoppers. Are they really? Which paid channel gets us policies most cheaply?"
- **Type:** external-join
- **Answer:** Comparison sites are cheap per quote but not per policy. Window spend per Mixpanel quote start (`marketing_spend_daily`): **comparison sites $44.41, search $96.24, social $40.62**. But only **13.3%** of completed comparison-site quotes turn into a purchase within 14 days vs **28.5%** for every other channel (**≈0.47x**), so **cost per policy is $564 for comparison sites vs $582 for search**, about the same, and **$240 for social**, the cheapest. Spend: search $114,618, comparison $42,324, social $16,574. Accept comparison-site cost per quote at 0.43-0.52x of search and a purchase rate 0.4-0.55x of other channels.
- **Evidence:** H4-comparison-site-economics; Insights `quote started` by `acquisition_channel` joined to `marketing_spend_daily.spend_usd`; Funnels `quote completed` → `policy purchased`, 14-day window, breakdown `acquisition_channel`; `-- STORY H4` and `-- EVAL Q4`.
- **Context needed:** 01-business.md (channels and billing), 04-metrics-and-tables.md (cost per policy uses Mixpanel purchases).
- **Grading:** must join spend to Mixpanel quote starts and purchases and go past cost per quote. Wrong: using `conversions_reported` as the denominator (networks over-claim; comparison sites bill 1,019 leads vs 953 Mixpanel quote starts); stopping at "comparison sites are half the price of search".

### Q5 — Did the auto rate increase pay off?
- **Prompt:** "Our new auto rates went live on August 17. Did they cost us sales? Did we come out ahead on premium?"
- **Type:** external-join
- **Answer:** It cost more sales than it earned per shopper. Auto quotes priced **14%** higher on average ($159.41 → $181.04 a month quoted; `rate_level_index` reads 1.14 for auto new business from Aug 17, and the quoted average also moves with the mix of states, tiers, and drivers). Purchases per completed auto quote fell from **25.6% to 19.2% (0.75x, z ≈ −2.4)**. Home and renters, which did not change price, did not move significantly (26.3% → 25.5%, z ≈ −0.2). In `written_premium_daily`, auto new-business written premium per completed auto quote fell from **$282.39 (Jun 4-Aug 16) to $250.73 (Aug 31-Oct 1), ≈0.89x**. Written premium per day rose from **$2,912 to $3,205 (+10%)**, but only because more auto shoppers arrived (completed auto quotes per day went from 10.3 to 12.8, largely the fall social campaign's auto-focused shoppers); per shopper the higher price did not make up for the lost buyers. Accept a quoted-price rise of 8%-16%, a purchase ratio of 0.6-0.85, and premium per quote below about 0.93.
- **Evidence:** H5-auto-rate-change; Insights average `quoted_premium_monthly` on `quote completed` (auto); Funnels `quote completed` → `policy purchased`, 14-day window, breakdown `product_line`, before vs after Aug 17; `written_premium_daily` (auto, new_business); `-- STORY H5` and `-- EVAL Q5`.
- **Context needed:** 02-timeline.md (date, renewals unaffected), 04-metrics-and-tables.md (`written_premium_daily`).
- **Grading:** must normalize by completed quotes, use a control or note property did not move significantly, and bring in premium. Wrong: "premium per policy went up, so it worked"; "premium per day went up, so it worked" without normalizing for the extra campaign shoppers; comparing raw purchase counts across periods of different length; including auto renewals (not repriced in the window).

### Q6 — Do bundles keep customers?
- **Prompt:** "Do customers with a bundle (auto + home or auto + renters) renew better than single-policy customers?"
- **Type:** retention
- **Answer:** Yes. Per renewal notice (Jun 4-Aug 31, 35-day window), bundled policies left at renewal **6.5%** of the time vs **16.4%** for single-line policies (**≈0.40x**); renewal rates were 92.9% vs 82.7%. It holds for every product line (bundled vs single: auto 6.7% vs 16.3%, home 5.9% vs 20.0%, renters 6.4% vs 14.7%). Accept a ratio of 0.30-0.60.
- **Evidence:** H6-bundle-retention; Funnels `renewal offered` → `policy cancelled` (`cancel_reason` in found_cheaper, price_increase), Totals, hold `policy_id`, 35-day window, breakdown `is_bundled`; `-- STORY H6` and `-- EVAL Q6`.
- **Context needed:** 01-business.md (bundles, renewal process), 04-metrics-and-tables.md (non-renewal rate).
- **Grading:** must measure per renewal notice and use `is_bundled` at the time of the notice. Wrong: using the profile property `bundle` (it reflects the end of the window, so customers who dropped one line show as single-line); counting nonpayment cancellations as renewal decisions; including notices from September (incomplete windows).

### Q7 — How sensitive are customers to renewal price increases?
- **Prompt:** "How much does the renewal price change affect whether customers renew?"
- **Type:** segmentation
- **Answer:** Strongly. Non-renewal per notice rises with the premium change: **≤ 0%: 5.8%**, 0-5%: 7.6%, 5-10%: 12.7%, 10-15%: 16.1%, **≥ 15%: 16.7%** (about **2.9x** no increase). Single-line policies, which hold the bundle effect constant, show the same rising curve at a higher level: **8.0% → 12.2% → 18.3% → 23.8% → 23.3% (2.9x)**; the 0-15% bands together read 17.7%, about 2.2x no increase. Above +15% the data is thin and does not keep rising (15-20%: 17.9% of 262 notices; 20%+: 11.3% of 62). Accept a top-vs-none ratio of 2.5x-5x and an increasing curve up to about +15%.
- **Evidence:** H7-renewal-price-shock; Funnels as in Q6, breakdown `premium_change_pct` custom buckets (single-line: filter `is_bundled = false`); `-- STORY H7` and `-- EVAL Q7`.
- **Context needed:** 01-business.md (renewal re-pricing), 03-event-dictionary.md (`premium_change_pct`).
- **Grading:** must bucket by `premium_change_pct` on the notice and compare rates, not counts. Accept "rises to about 15%, then flat, slightly higher, or slightly lower" for the top: the finer top buckets are thin. Wrong: counting cancellations by reason only; "price does not matter"; claiming a precise threshold from the 20%+ bucket.

### Q8 — Did the fall social campaign work?
- **Prompt:** "We doubled social spend for the fall Switch & Save campaign. Did it bring in new shoppers, and what did each extra quote cost?"
- **Type:** external-join
- **Answer:** Yes. From Sep 8, social quote starts rose from **2.97 to 5.13 a day (1.73x)** while all other channels stayed flat (28.0 → 27.0 a day, 0.96x), so the campaign brought new shoppers rather than taking them from other channels. Campaign shoppers matched the targeting: 77% quoted auto (58% of social shoppers before) and 64% were switching (51% before). Social spend went from **$118 to $218 a day (1.85x)**. The **incremental cost per extra quote was about $47**, a little above social's pre-campaign average ($39.76) and far below search. Social purchases rose from 0.48 to 1.08 a day (purchase date; the last shoppers are still inside their 14-day window). Accept a quote lift of 1.5x-2.1x and an incremental cost per quote of roughly $35-55.
- **Evidence:** H8-fall-social-campaign; Insights `quote started` per day by `acquisition_channel`, before vs from Sep 8, joined to `marketing_spend_daily` (social_ads); social shoppers by `product_line` and `shopping_reason`; `-- STORY H8` and `-- EVAL Q8`.
- **Context needed:** 02-timeline.md (campaign date, budget), 04-metrics-and-tables.md (`marketing_spend_daily`).
- **Grading:** must compare per day (the periods differ in length), check other channels, and use warehouse spend for the cost. Wrong: total quotes before vs after (96 vs 24 days); `conversions_reported` as the quote count; claiming it cannibalized search.

### Q9 — How long do shoppers take to buy?
- **Prompt:** "Once someone gets a quote, how long does it take them to buy? Does it vary by type of shopper?"
- **Type:** funnel
- **Answer:** The median time from completed quote to purchase is **29.6 hours**, but it depends on why they are shopping: **switching shoppers take a median 52.4 hours** (only 11% buy within a day) vs **15.8 hours for life_change** and **16.4 hours for first_policy** shoppers (68-75% buy within a day), about **3.2x** longer. Product line matters much less (auto 32.8 h, home 24.5 h, renters 28.6 h). Accept a switcher ratio of 2.5x-3.5x.
- **Evidence:** H9-switchers-take-longer; Funnels `quote completed` → `policy purchased`, 14-day window, quotes Jun 4 - Sep 17, median time to convert, breakdown `shopping_reason`; `-- STORY H9` and `-- EVAL Q9`.
- **Context needed:** 01-business.md (shopping reasons), 04-metrics-and-tables.md (time to purchase).
- **Grading:** must report medians by `shopping_reason`. Wrong: breaking down by product line only and concluding there is no difference; using means dominated by long tails; including quotes from the last two weeks (incomplete windows).

### Q10 — Should we push autopay harder?
- **Prompt:** "Billing wants to push autopay. Does autopay actually reduce missed payments and cancellations?"
- **Type:** segmentation
- **Answer:** Yes. Scheduled autopay draws fail **1.47%** of the time vs **4.95%** for manual payments (**≈0.30x**). When a manual payment fails, **26.0%** of policies are cancelled for nonpayment within 30 days (465 failures through Aug 31); autopay failures are retried automatically and only **3.7%** lapse (6 of 161). Among policies billed in the window, **133 manually paid policies** were cancelled for nonpayment (3.6% of manual policies) vs **6 autopay policies** (0.1%). Basis note: all 159 nonpayment cancellations in the window (Q18) include 20 on policies with no payment event in the window (their failed payment was before June 4); split by the profile property `autopay`, that is 150 manual vs 9 autopay. Accept either basis. 54% of active customers use autopay. Accept a failure ratio of 0.25-0.40 and a manual lapse rate of 18%-32%.
- **Evidence:** H10-autopay-and-lapses; Insights `payment failed` / (`payment made` + `payment failed`), both `is_retry = false`, breakdown `payment_method`; Funnels `payment failed` (step 1 filter `is_retry = false`, so an autopay retry failure is not counted as a second failure) → `policy cancelled` (`cancel_reason = nonpayment`), Totals, hold `policy_id`, 30-day window, failures through Aug 31; `-- STORY H10` and `-- EVAL Q10`.
- **Context needed:** 01-business.md (billing rules), 04-metrics-and-tables.md (payment failure rate).
- **Grading:** must exclude retries from the denominator and separate autopay from manual. Wrong: counting retries as scheduled payments; including back-office autopay events as customer "activity"; claiming autopay customers also renew better (see Q14).

### Q11 — How big is our book?
- **Prompt:** "How many customers and policies do we have, what's the product mix, and how much premium did we write this period?"
- **Type:** context
- **Answer:** On October 1, **6,094 customers are active**, 463 have cancelled every policy, and 616 created an account but never bought (prospects). Active customers hold: auto only 41.1%, auto+home 20.7%, renters only 13.3%, homeowners only 13.2%, auto+renters 11.7% (**32.4% bundled**); 54% pay by autopay. In the window there were **554 new policies**, **3,783 renewals**, and **780 cancellations**. Billing wrote **$4.84M** of premium: auto $3.10M, homeowners $1.61M, renters $0.14M; new business $0.69M and renewals $4.15M. Accept premium from the warehouse and counts from profiles and events.
- **Evidence:** `-- EVAL Q11`; profiles (`customer_status`, `product_lines`, `bundle`, `autopay`); Insights `policy purchased`, `policy renewed`, `policy cancelled`; `written_premium_daily`.
- **Context needed:** 03-event-dictionary.md (profile properties), 04-metrics-and-tables.md (written premium, caveats).
- **Grading:** must take premium from the warehouse and note it includes a few phone sales. Wrong: counting all 10,000 people or 9,753 distinct ids as customers (about 2,580 are anonymous shoppers); multiplying Mixpanel policies by an average premium.

### Q12 — Do premium-tier quotes convert worse? (null)
- **Prompt:** "Premium-tier quotes cost more. Are shoppers who pick premium coverage less likely to buy than basic-tier shoppers?"
- **Type:** null-hypothesis
- **Answer:** **No.** Purchases per completed quote are **22.9% basic, 26.2% standard, 22.7% premium** (premium vs basic z ≈ −0.1, p ≈ 0.9; all three tiers together chi-square 3.1, p ≈ 0.21). No sub-split is significant: auto z ≈ −0.4, property z ≈ 0.3, comparison sites z ≈ 0.6, other channels z ≈ −0.6. Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q12`; Funnels `quote completed` → `policy purchased`, 14-day window, breakdown `coverage_tier`.
- **Context needed:** 01-business.md (tiers), 03-event-dictionary.md (`coverage_tier`).
- **Grading:** must check the data and treat the gaps as noise. Wrong: "premium shoppers buy less" (or more) without a significance check; "standard tier converts best" (the three-tier test is not significant).

### Q13 — Is the Android quote flow worse? (null)
- **Prompt:** "Do Android shoppers abandon quotes more than iPhone and iPad shoppers? Should we prioritize fixing the Android quote flow?"
- **Type:** null-hypothesis
- **Answer:** **No.** Quote completion within a day is **61.1% on iOS (iPhone and iPad) vs 61.0% on Android** (z ≈ −0.1). It holds within each form (standard 55.5% vs 56.7%, z ≈ 0.4; Express Quote 71.0% vs 69.0%, z ≈ −0.6) and each product (auto z ≈ 0.1, home z ≈ −0.1, renters z ≈ −0.3). Web shoppers complete at about the same rate too (61.5% vs 61.1% on all mobile). The quote-completion lever is the form itself (Q1), not the device. Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q13`; Funnels `quote started` → `quote completed`, 1-day window, breakdown `platform` (ios vs android), optionally by `quote_flow`.
- **Context needed:** 03-event-dictionary.md (`platform`), 00-manifest.md (anonymous quotes).
- **Grading:** must compare rates by platform and check significance. Wrong: "Android is worse" from raw counts (iOS has about 1.4x as many shoppers: 1,101 vs 794).

### Q14 — Do autopay customers renew better? (null)
- **Prompt:** "Autopay customers seem more committed. Are they less likely to leave at renewal?"
- **Type:** null-hypothesis
- **Answer:** **No.** Voluntary non-renewal per notice is **10.6% for autopay vs 11.8% for manual payers** (z ≈ −1.0, p ≈ 0.3). It holds within bundled policies (6.1% vs 7.0%, z ≈ −0.8, p ≈ 0.4) and within single-line policies (15.8% vs 17.2%, z ≈ −0.7, p ≈ 0.5). Autopay prevents nonpayment cancellations (Q10) but does not change whether customers choose to renew; price change and bundling do (Q6, Q7). Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q14`; Funnels `renewal offered` → `policy cancelled` (found_cheaper, price_increase), 35-day window, breakdown user property `autopay`.
- **Context needed:** 04-metrics-and-tables.md (non-renewal rate).
- **Grading:** must separate voluntary non-renewal from nonpayment cancellations. Wrong: counting nonpayment cancellations as non-renewal (which makes manual payers look worse); "autopay customers are more loyal".

### Q15 — When are customers active?
- **Prompt:** "When during the week and day do customers use the website and app? When should we staff customer care chat?"
- **Type:** trend
- **Answer:** **Weekdays.** Monday-Thursday each run about **1.11-1.16x** an average day, Friday 1.05x, **Saturday 0.78x and Sunday 0.68x**. By hour, activity runs from about **13:00 to 01:00 UTC** (roughly 9 am - 9 pm Eastern) with a broad plateau from **14:00 to 22:00 UTC at 1.5-1.7x the average hour**, highest at 15:00-17:00 UTC (late morning to noon Eastern); overnight US hours (05:00-10:00 UTC) are nearly empty (0.1-0.3x). Staff chat most heavily on weekday US business hours. Accept a weekday-heavy pattern and a daytime US peak expressed in UTC.
- **Evidence:** `-- EVAL Q15`; Insights all customer events (exclude `platform = server`), breakdown day of week and hour (project time zone UTC).
- **Context needed:** 00-manifest.md (UTC, US time zones), 04-metrics-and-tables.md (back-office events are not activity).
- **Grading:** must convert to US time or say UTC. Wrong: including back-office events (autopay posts in the early morning UTC); reading UTC hours as local hours.

### Q16 — What does our claims mix look like?
- **Prompt:** "How many claims did we get this period, by line, and what did we pay out?"
- **Type:** context
- **Answer:** Mixpanel recorded **793 claims submitted**: **465 auto, 245 homeowners, 83 renters**; 753 were settled by Oct 1 with **$4.28M paid** (auto $1.38M, homeowners $2.28M, renters $0.61M) and an **8.1% denial rate**. The average paid claim was about $3,500 for auto and $10,400 for homeowners. Auto claims are mostly collision (186) and glass (126); property claims are dominated by wind/hail and water, largely from Hurricane Delphine in late August (claims jumped to 331 in August vs 148 in July and 168 in September; June has 139 in 27 days). The warehouse counts more claims than Mixpanel because phone-reported claims are only there. Accept counts from Mixpanel with the phone-claim caveat.
- **Evidence:** `-- EVAL Q16` (monthly counts from `-- EVAL Q19`); Insights `claim submitted` by `product_line` and `peril`; `claim settled` sum of `payout_usd`.
- **Context needed:** 03-event-dictionary.md (claim events), 04-metrics-and-tables.md (`claims_operations_daily` caveats), 02-timeline.md (hurricane).
- **Grading:** must separate submitted from settled and mention the hurricane. Wrong: summing `estimated_loss_usd` as payouts; treating warehouse claim counts and Mixpanel counts as interchangeable.

### Q17 — Where do shoppers drop out?
- **Prompt:** "Walk me through our quote-to-purchase funnel. Where do we lose shoppers?"
- **Type:** funnel
- **Answer:** Of **3,743** shoppers who started a quote, **2,294 (61.3%)** completed it, **1,163 (50.7% of completed)** created an account, and **547 (47.0% of accounts)** bought a policy: **14.6%** of quote starts end in a purchase. The two biggest losses are the quote form itself (39% never finish; see Q1) and the step after the price (49% of completed quotes never create an account). **2,580 shoppers never created an account** and exist only as anonymous devices. Completion is similar by product (auto 61.8%, home 61.3%, renters 59.7%). Accept funnel numbers within ±1 point with identity merging.
- **Evidence:** `-- EVAL Q17`; Funnels `quote started` → `quote completed` → `account created` → `policy purchased`, Uniques with identity merging, window long enough for purchases (14 days).
- **Context needed:** 00-manifest.md (anonymous quotes, identity merging), 03-event-dictionary.md (shopping events).
- **Grading:** must use merged identities (quote steps are anonymous). Wrong: a funnel that breaks at `account created` because the analyst counted by `user_id` only (it shows almost no shoppers completing quotes); blaming the device (see Q13).

### Q18 — Why do customers cancel?
- **Prompt:** "Why are customers cancelling their policies?"
- **Type:** segmentation
- **Answer:** **780 policies were cancelled** in the window: **found_cheaper 32.9%** and **price_increase 26.2%** (together 59%, almost all at renewal, after the renewal notice), **nonpayment 20.4%** (159), moved 8.3%, sold_vehicle 6.7%, no_longer_needed 5.5%. Auto accounts for 521 cancellations, homeowners 149, renters 110. The controllable drivers are renewal price changes and bundling (Q6, Q7) and missed manual payments (Q10). Accept the reason mix from `cancel_reason`.
- **Evidence:** `-- EVAL Q18`; Insights `policy cancelled`, breakdown `cancel_reason` and `product_line`.
- **Context needed:** 03-event-dictionary.md (`cancel_reason`, renewal timing).
- **Grading:** must use `cancel_reason` and connect price reasons to renewal. Wrong: counting customers with `customer_status = cancelled` only (463; customers who drop one of two policies stay active).

### Q19 — What should leadership worry about going into Q4?
- **Prompt:** "Looking at the last four months, what should leadership worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names at least three of these, with numbers:
  - **The auto rate increase is losing buyers:** auto purchases per completed quote 25.6% → 19.2% (0.75x) and written premium per completed quote 0.89x. Auto new-business premium per day rose about 10%, but only because the fall social campaign brought more auto shoppers. Consider a smaller increase or segment the increase (Q5). Existing auto customers move to the new rates at renewal from November, and renewal price increases drive non-renewal (Q7).
  - **Renewal retention:** increases of 15%+ push non-renewal to about 17% overall (2.9x no increase; 23% for single-line policies); single-line customers leave about 2.5x as often as bundled ones (Q6, Q7). Bundling and price-change management are the levers.
  - **Catastrophe exposure and capacity:** Delphine made Gulf property claims 2.49x slower and backed up 236 open claims; $1.81M paid. Hurricane season runs to November 30 (Q3).
  - **Nonpayment:** about a fifth of cancellations; manual payers fail 3.4x as often and about a quarter of their failures lapse; push autopay (Q10).
  - **Acquisition mix:** comparison sites cost $564 per policy, about the same as search ($582); social costs $240 and scaled in the fall campaign (Q4, Q8).
  - Positives: Express Quote (+32% completion, ship it) and Snap & Settle (0.27-0.30x cycle time) work (Q1, Q2).
  - Context: monthly quote starts about 820 (June, 27 days) to 980 (September); new policies 112-153 a month; active customers grew from 6,124 (June) to 6,350 (September).
- **Evidence:** H1, H2, H3, H4, H5, H6, H7, H10; `-- EVAL Q19` and the queries above.
- **Context needed:** all guides.
- **Grading:** credit for prioritized, quantified risks tied to the data and the calendar (November renewals on the new rate plan, hurricane season). Penalize generic advice without numbers, or claims the data does not support (for example "autopay customers renew better").

### Q20 — Where should next quarter's paid budget go?
- **Prompt:** "If we can move paid budget between search, comparison sites, and social next quarter, what would you do?"
- **Type:** open-ended
- **Answer:** Judge channels on policies, not quotes or platform-reported conversions. Current spend is about **$955 a day on search, $353 on comparison sites, and $138 on social** (window average). Cost per policy is **$582 search, $564 comparison sites, $240 social**; the networks' own cost per conversion ($85.28, $41.53, $31.75) makes comparison sites look twice as efficient as search, but their shoppers rarely buy, so per policy they cost about the same (Q4). The fall campaign showed social scales: spend up 1.85x brought 1.73x the quote starts at a slightly higher cost per quote (about $47 per extra quote vs $40 before; Q8). A reasonable plan: grow social further and test whether the cost per quote holds; renegotiate the comparison-site price per lead (at their purchase rate a lead is worth roughly half what a search quote is worth); hold search. Note that purchase counts per channel are small (69-197) and the window cannot show lifetime value or claims experience by channel.
- **Evidence:** H4-comparison-site-economics, H8-fall-social-campaign; `-- EVAL Q4`, `-- EVAL Q8`, `-- EVAL Q20`.
- **Context needed:** 04-metrics-and-tables.md (cost per policy definition, `marketing_spend_daily`), 01-business.md (channels and billing).
- **Grading:** credit for joining spend to Mixpanel purchases, using the campaign as evidence of scalability, and caveats. Wrong: "move everything to comparison sites because leads are cheapest"; using `conversions_reported` for cost per policy.
