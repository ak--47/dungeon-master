# Shieldstone Insurance (insurance-application) — 20-question eval

- **Data:** `data/verify-insurance-application` (full fidelity: 10,000 people, 756,491 events, 9,761 distinct people in Mixpanel terms of whom 7,310 are identified, 3,735 new shoppers, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query (or the `-- STORY` query it names) in `dungeons/vertical/insurance-application/insurance-application.sql` on that data.
- **Stories:** ids refer to the `stories` export in `insurance-application.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Should we ship Express Quote?
- **Prompt:** "We've been testing Express Quote since July. Is it working, and should we roll it out to everyone?"
- **Type:** funnel
- **Answer:** Yes. Among shoppers who started a quote from 2026-07-08, **73.4% of Express Quote shoppers finished the quote within a day vs 53.3% in Control (1.38x)**, and the median time to finish fell from **15.9 to 8.1 minutes (0.51x)**. Purchases per completed quote did not change significantly (32.0% vs 31.5%, z ≈ 0.2), so the extra completions turn into extra policies: **23.5% of Express shoppers bought vs 16.9% of Control shoppers (1.39x)**. The split is balanced (1,302 Express vs 1,378 Control exposed). Recommend shipping. Accept a completion lift of 1.2x-1.5x and a time ratio of 0.4-0.6.
- **Evidence:** H3-express-quote-experiment; Funnels `quote started` → `quote completed`, 1-day window, from Jul 8, breakdown `quote_flow` (or the Experiments report on `$experiment_started`); `-- STORY H3` and `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (start date, what the variant does), 00-manifest.md (anonymous quotes need identity merging).
- **Grading:** must compare arms after the start date and report completion and speed. Credit for checking purchases per completed quote or per shopper. Wrong: comparing shoppers before vs after July 8 instead of the two arms; counting only identified shoppers (drops the 2,450 anonymous shoppers, most of whom did not finish); claiming Express shoppers buy at a higher rate once they have a quote.

### Q2 — Is Snap & Settle making claims faster?
- **Prompt:** "Since Snap & Settle launched, how much faster are we settling auto claims? How many customers use it?"
- **Type:** funnel
- **Answer:** Much faster. For eligible auto claims (collision, glass, comprehensive) submitted Jul 21 - Sep 15, photo-estimate claims settled in a **median 1.9 days vs 7.0 days for adjuster-inspected claims (≈0.28x)**. **61% of eligible auto claims** used it (100 of 163); 49% of all auto claims after launch, since theft and liability claims cannot. All auto claims together went from a median **7.5 days** before launch (Jun 4-Jul 20) to **3.4 days** after. No claim used photo estimates before July 21. Accept a ratio of 0.22-0.40 and adoption of 50%-70% of eligible claims.
- **Evidence:** H1-snap-and-settle; Funnels `claim submitted` → `claim settled`, Totals, hold `claim_id` constant, 30-day window, filter `product_line = auto`, breakdown `claim_channel`, median time to convert; `-- STORY H1` and `-- EVAL Q2`.
- **Context needed:** 02-timeline.md (launch date, eligible perils), 04-metrics-and-tables.md (claim cycle time).
- **Grading:** must compare per claim and name the eligible perils or the channel split. Wrong: comparing all auto claims by channel including theft and liability (mix effect); "no change" from averaging in property claims; using `days_open` averages dominated by a few long claims without saying so.

### Q3 — What did Hurricane Delphine do to claims?
- **Prompt:** "How did the claims team hold up after Hurricane Delphine? What happened to volume, cycle times, and backlog in the Gulf?"
- **Type:** external-join
- **Answer:** Delphine (landfall 2026-08-27, catastrophe code PCS-2614, reporting period Aug 27 - Sep 9 for `gulf_coast`) flooded the Gulf property team. In `claims_operations_daily`, Gulf claims reported per day went from **1.65 before to 16.4 during the catastrophe period**, open claims peaked at **211** (about 10 on an average day before; the pre-storm peak was 22), and adjuster hours rose from **12.4 a day to 72.4 during the period and 92.9 after** as independent adjusters arrived (Aug 29). In Mixpanel, **172 Gulf home and renters claims** were submitted in the period (170 wind/hail or water), and they settled in a **median 17.7 days vs 7.0 days** for every other property claim (**≈2.55x slower**). 165 of the 172 were settled by Oct 1, with **$1.69M** paid. Accept 2.1x-3.0x and a backlog peak around 210.
- **Evidence:** H2-hurricane-delphine; Funnels `claim submitted` → `claim settled` (property, hold `claim_id`, 45-day window) split by region and submit date, joined to `claims_operations_daily`; `-- STORY H2` and `-- EVAL Q3`.
- **Context needed:** 02-timeline.md (landfall, reporting period, adjuster deployment), 04-metrics-and-tables.md (`claims_operations_daily`).
- **Grading:** must use the warehouse for capacity/backlog and Mixpanel per-claim cycle time, and keep auto claims out of the property comparison. Wrong: comparing warehouse `new_claims_reported` to Mixpanel claim counts as if they should match (phone claims are only in the warehouse); attributing the slowdown to Snap & Settle; reading cycle time from claims that had not had time to close.

### Q4 — Which paid channel is cheapest per policy?
- **Prompt:** "Comparison sites look like our cheapest source of shoppers. Are they really? Which paid channel gets us policies most cheaply?"
- **Type:** external-join
- **Answer:** Comparison sites are cheap per quote but not per policy. Window spend per Mixpanel quote start (`marketing_spend_daily`): **comparison sites $44.45, search $96.39, social $40.67**. But only **18.0%** of completed comparison-site quotes turn into a purchase within 14 days vs **38.0%** for every other channel (**≈0.47x**), so **cost per policy is $414 for comparison sites vs $435 for search**, about the same, and **$161 for social**, the cheapest. Spend: search $114,413, comparison $42,277, social $16,633. Accept comparison-site cost per quote at 0.43-0.52x of search and a purchase rate 0.4-0.55x of other channels.
- **Evidence:** H4-comparison-site-economics; Insights `quote started` by `acquisition_channel` joined to `marketing_spend_daily.spend_usd`; Funnels `quote completed` → `policy purchased`, 14-day window, breakdown `acquisition_channel`; `-- STORY H4` and `-- EVAL Q4`.
- **Context needed:** 01-business.md (channels and billing), 04-metrics-and-tables.md (cost per policy uses Mixpanel purchases).
- **Grading:** must join spend to Mixpanel quote starts and purchases and go past cost per quote. Wrong: using `conversions_reported` as the denominator (networks over-claim; comparison sites bill 1,016 leads vs 951 Mixpanel quote starts); stopping at "comparison sites are half the price of search".

### Q5 — Did the auto rate increase pay off?
- **Prompt:** "Our new auto rates went live on August 17. Did they cost us sales? Did we come out ahead on premium?"
- **Type:** external-join
- **Answer:** It cost more sales than it earned. Auto quotes priced **12%** higher on average ($159.89 → $178.72 a month quoted; `rate_level_index` reads 1.14 for auto new business from Aug 17, and the quoted average also moves with the mix of states, tiers, and drivers). Purchases per completed auto quote fell from **34.6% to 25.4% (0.73x, z ≈ −3.1)**. Home and renters, which did not change price, did not move significantly (34.4% → 33.8%, z ≈ −0.2). In `written_premium_daily`, auto new-business written premium per completed auto quote fell from **$365.68 (Jun 4-Aug 16) to $295.85 (Aug 31-Oct 1), ≈0.81x**; written premium per day fell from **$4,126 to $3,439** despite higher prices, because fewer shoppers bought. Accept a quoted-price rise of 8%-16%, a purchase ratio of 0.6-0.85, and premium per quote below about 0.93.
- **Evidence:** H5-auto-rate-change; Insights average `quoted_premium_monthly` on `quote completed` (auto); Funnels `quote completed` → `policy purchased`, 14-day window, breakdown `product_line`, before vs after Aug 17; `written_premium_daily` (auto, new_business); `-- STORY H5` and `-- EVAL Q5`.
- **Context needed:** 02-timeline.md (date, renewals unaffected), 04-metrics-and-tables.md (`written_premium_daily`).
- **Grading:** must normalize by completed quotes, use a control or note property did not move significantly, and bring in premium. Wrong: "premium per policy went up, so it worked"; comparing raw purchase counts across periods of different length; including auto renewals (not repriced in the window).

### Q6 — Do bundles keep customers?
- **Prompt:** "Do customers with a bundle (auto + home or auto + renters) renew better than single-policy customers?"
- **Type:** retention
- **Answer:** Yes. Per renewal notice (Jun 4-Aug 31, 35-day window), bundled policies left at renewal **6.5%** of the time vs **15.7%** for single-line policies (**≈0.41x**); renewal rates were 92.5% vs 83.6%. It holds for every product line (bundled vs single: auto 6.7% vs 15.7%, home 6.7% vs 17.0%, renters 4.4% vs 14.1%). Accept a ratio of 0.30-0.60.
- **Evidence:** H6-bundle-retention; Funnels `renewal offered` → `policy cancelled` (`cancel_reason` in found_cheaper, price_increase), Totals, hold `policy_id`, 35-day window, breakdown `is_bundled`; `-- STORY H6` and `-- EVAL Q6`.
- **Context needed:** 01-business.md (bundles, renewal process), 04-metrics-and-tables.md (non-renewal rate).
- **Grading:** must measure per renewal notice and use `is_bundled` at the time of the notice. Wrong: using the profile property `bundle` (it reflects the end of the window, so customers who dropped one line show as single-line); counting nonpayment cancellations as renewal decisions; including notices from September (incomplete windows).

### Q7 — How sensitive are customers to renewal price increases?
- **Prompt:** "How much does the renewal price change affect whether customers renew?"
- **Type:** segmentation
- **Answer:** Strongly. Non-renewal per notice rises with the premium change: **≤ 0%: 5.1%**, 0-5%: 7.9%, 5-10%: 12.0%, 10-15%: 15.7%, **≥ 15%: 17.6%** (about **3.4x** no increase). Single-line policies, which hold the bundle effect constant, show the same rising curve at a higher level: **7.5% → 11.2% → 17.4% → 22.8% → 27.7% (3.7x)**; the 0-15% bands together read 16.6%, about 2.2x no increase. Above +15% the data is thin and does not keep rising (15-20%: 18.1% of 237 notices; 20%+: 15.7% of 70). Accept a top-vs-none ratio of 3x-5x and an increasing curve up to about +15%.
- **Evidence:** H7-renewal-price-shock; Funnels as in Q6, breakdown `premium_change_pct` custom buckets (single-line: filter `is_bundled = false`); `-- STORY H7` and `-- EVAL Q7`.
- **Context needed:** 01-business.md (renewal re-pricing), 03-event-dictionary.md (`premium_change_pct`).
- **Grading:** must bucket by `premium_change_pct` on the notice and compare rates, not counts. Accept "rises to about 15%, then flat, slightly higher, or slightly lower" for the top: the finer top buckets are thin. Wrong: counting cancellations by reason only; "price does not matter"; claiming a precise threshold from the 20%+ bucket.

### Q8 — Did the fall social campaign work?
- **Prompt:** "We doubled social spend for the fall Switch & Save campaign. Did it bring in new shoppers, and what did each extra quote cost?"
- **Type:** external-join
- **Answer:** Yes. From Sep 8, social quote starts rose from **2.92 to 5.38 a day (1.84x)** while all other channels stayed flat (27.6 → 28.4 a day, 1.03x), so the campaign brought new shoppers rather than taking them from other channels. Social spend went from **$117 to $224 a day (1.91x)**. The **incremental cost per extra quote was about $43**, close to social's pre-campaign average ($40.23) and far below search. Social purchases rose from 0.84 to 1.13 a day (purchase date; the last shoppers are still inside their 14-day window). Accept a quote lift of 1.6x-2.1x and an incremental cost per quote of roughly $35-50.
- **Evidence:** H8-fall-social-campaign; Insights `quote started` per day by `acquisition_channel`, before vs from Sep 8, joined to `marketing_spend_daily` (social_ads); `-- STORY H8` and `-- EVAL Q8`.
- **Context needed:** 02-timeline.md (campaign date, budget), 04-metrics-and-tables.md (`marketing_spend_daily`).
- **Grading:** must compare per day (the periods differ in length), check other channels, and use warehouse spend for the cost. Wrong: total quotes before vs after (96 vs 24 days); `conversions_reported` as the quote count; claiming it cannibalized search.

### Q9 — How long do shoppers take to buy?
- **Prompt:** "Once someone gets a quote, how long does it take them to buy? Does it vary by type of shopper?"
- **Type:** funnel
- **Answer:** The median time from completed quote to purchase is **27.1 hours**, but it depends on why they are shopping: **switching shoppers take a median 49.0 hours** (only 10% buy within a day) vs **15.6 hours for life_change** and **16.6 hours for first_policy** shoppers (76-78% buy within a day), about **3.0x** longer. Product line matters much less (auto 27.5 h, home 25.8 h, renters 28.1 h). Accept a switcher ratio of 2.5x-3.5x.
- **Evidence:** H9-switchers-take-longer; Funnels `quote completed` → `policy purchased`, 14-day window, quotes Jun 4 - Sep 17, median time to convert, breakdown `shopping_reason`; `-- STORY H9` and `-- EVAL Q9`.
- **Context needed:** 01-business.md (shopping reasons), 04-metrics-and-tables.md (time to purchase).
- **Grading:** must report medians by `shopping_reason`. Wrong: breaking down by product line only and concluding there is no difference; using means dominated by long tails; including quotes from the last two weeks (incomplete windows).

### Q10 — Should we push autopay harder?
- **Prompt:** "Billing wants to push autopay. Does autopay actually reduce missed payments and cancellations?"
- **Type:** segmentation
- **Answer:** Yes. Scheduled autopay draws fail **1.36%** of the time vs **4.92%** for manual payments (**≈0.28x**). When a manual payment fails, **21.9%** of policies are cancelled for nonpayment within 30 days (421 failures through Aug 31); autopay failures are retried automatically and only **5.1%** lapse (8 of 158). Among policies billed in the window, **105 manually paid policies** were cancelled for nonpayment (3.0% of manual policies) vs **8 autopay policies** (0.2%). Basis note: all 128 nonpayment cancellations in the window (Q18) include 15 on policies with no payment event in the window (their failed payment was before June 4); split by the profile property `autopay`, that is 119 manual vs 9 autopay. Accept either basis. 56% of active customers use autopay. Accept a failure ratio of 0.25-0.40 and a manual lapse rate of 18%-30%.
- **Evidence:** H10-autopay-and-lapses; Insights `payment failed` / (`payment made` + `payment failed`), both `is_retry = false`, breakdown `payment_method`; Funnels `payment failed` → `policy cancelled` (`cancel_reason = nonpayment`), Totals, hold `policy_id`, 30-day window; `-- STORY H10` and `-- EVAL Q10`.
- **Context needed:** 01-business.md (billing rules), 04-metrics-and-tables.md (payment failure rate).
- **Grading:** must exclude retries from the denominator and separate autopay from manual. Wrong: counting retries as scheduled payments; including back-office autopay events as customer "activity"; claiming autopay customers also renew better (see Q14).

### Q11 — How big is our book?
- **Prompt:** "How many customers and policies do we have, what's the product mix, and how much premium did we write this period?"
- **Type:** context
- **Answer:** On October 1, **6,277 customers are active**, 483 have cancelled every policy, and 550 created an account but never bought (prospects). Active customers hold: auto only 41.9%, auto+home 20.9%, renters only 13.4%, homeowners only 12.6%, auto+renters 11.2% (**32.1% bundled**); 56% pay by autopay. In the window there were **748 new policies**, **3,834 renewals**, and **772 cancellations**. Billing wrote **$5.04M** of premium: auto $3.28M, homeowners $1.60M, renters $0.15M; new business $0.87M and renewals $4.16M. Accept premium from the warehouse and counts from profiles and events.
- **Evidence:** `-- EVAL Q11`; profiles (`customer_status`, `product_lines`, `bundle`, `autopay`); Insights `policy purchased`, `policy renewed`, `policy cancelled`; `written_premium_daily`.
- **Context needed:** 03-event-dictionary.md (profile properties), 04-metrics-and-tables.md (written premium, caveats).
- **Grading:** must take premium from the warehouse and note it includes a few phone sales. Wrong: counting all 10,000 people or 9,761 distinct ids as customers (about 2,450 are anonymous shoppers); multiplying Mixpanel policies by an average premium.

### Q12 — Do premium-tier quotes convert worse? (null)
- **Prompt:** "Premium-tier quotes cost more. Are shoppers who pick premium coverage less likely to buy than basic-tier shoppers?"
- **Type:** null-hypothesis
- **Answer:** **No.** Purchases per completed quote are **32.4% basic, 33.3% standard, 32.4% premium** (premium vs basic z ≈ 0.0). No sub-split is significant: auto z ≈ 0.8, property z ≈ −0.8, comparison sites z ≈ 0.5, other channels z ≈ 0.2. Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q12`; Funnels `quote completed` → `policy purchased`, 14-day window, breakdown `coverage_tier`.
- **Context needed:** 01-business.md (tiers), 03-event-dictionary.md (`coverage_tier`).
- **Grading:** must check the data and treat the gaps as noise. Wrong: "premium shoppers buy less" (or more) without a significance check.

### Q13 — Is mobile quoting worse than web? (null)
- **Prompt:** "Do shoppers on phones abandon quotes more than shoppers on a computer? Should we prioritize the mobile quote flow?"
- **Type:** null-hypothesis
- **Answer:** **No.** Quote completion within a day is **61.7% on the web vs 61.5% on mobile** (z ≈ −0.1). It holds within each form: standard 55.2% vs 55.6% (z ≈ 0.2), Express Quote 74.6% vs 71.4% (z ≈ −1.3, p ≈ 0.2). The quote-completion lever is the form itself (Q1), not the device. Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q13`; Funnels `quote started` → `quote completed`, 1-day window, breakdown `platform` (web vs ios/android).
- **Context needed:** 03-event-dictionary.md (`platform`), 00-manifest.md (anonymous quotes).
- **Grading:** must compare rates by device and check significance. Wrong: "mobile is worse" from raw counts (web has about 1.9x as many shoppers: 2,438 vs 1,297).

### Q14 — Do autopay customers renew better? (null)
- **Prompt:** "Autopay customers seem more committed. Are they less likely to leave at renewal?"
- **Type:** null-hypothesis
- **Answer:** **No.** Voluntary non-renewal per notice is **11.2% for autopay vs 10.3% for manual payers** (z ≈ 0.8, p ≈ 0.4). It holds within bundled policies (6.0% vs 7.0%, z ≈ −0.8); among single-line policies autopay customers left slightly more often, not less (17.2% vs 13.8%, z ≈ 1.8, p ≈ 0.07, not significant). Autopay prevents nonpayment cancellations (Q10) but does not change whether customers choose to renew; price change and bundling do (Q6, Q7). Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q14`; Funnels `renewal offered` → `policy cancelled` (found_cheaper, price_increase), 35-day window, breakdown user property `autopay`.
- **Context needed:** 04-metrics-and-tables.md (non-renewal rate).
- **Grading:** must separate voluntary non-renewal from nonpayment cancellations. Wrong: counting nonpayment cancellations as non-renewal (which makes manual payers look worse); "autopay customers are more loyal".

### Q15 — When are customers active?
- **Prompt:** "When during the week and day do customers use the website and app? When should we staff customer care chat?"
- **Type:** trend
- **Answer:** **Weekdays.** Monday-Thursday each run about **1.09-1.17x** an average day, Friday 1.03x, **Saturday 0.77x and Sunday 0.69x**. By hour, activity runs from about **13:00 to 01:00 UTC** (roughly 9 am - 9 pm Eastern) with a broad plateau from **14:00 to 23:00 UTC at 1.5-1.7x the average hour**, highest at 16:00-17:00 UTC (late morning to noon Eastern); overnight US hours (05:00-10:00 UTC) are nearly empty (0.1-0.3x). Staff chat most heavily on weekday US business hours. Accept a weekday-heavy pattern and a daytime US peak expressed in UTC.
- **Evidence:** `-- EVAL Q15`; Insights all customer events (exclude `platform = server`), breakdown day of week and hour (project time zone UTC).
- **Context needed:** 00-manifest.md (UTC, US time zones), 04-metrics-and-tables.md (back-office events are not activity).
- **Grading:** must convert to US time or say UTC. Wrong: including back-office events (autopay posts in the early morning UTC); reading UTC hours as local hours.

### Q16 — What does our claims mix look like?
- **Prompt:** "How many claims did we get this period, by line, and what did we pay out?"
- **Type:** context
- **Answer:** Mixpanel recorded **791 claims submitted**: **466 auto, 239 homeowners, 86 renters**; 746 were settled by Oct 1 with **$4.35M paid** (auto $1.36M, homeowners $2.25M, renters $0.75M) and a **9.1% denial rate**. The average paid claim was about $3,400 for auto and $10,500 for homeowners. Auto claims are mostly collision (177) and glass (118); property claims are dominated by wind/hail and water, largely from Hurricane Delphine in late August (claims jumped to 304 in August vs 176 in July and 173 in September; June has 134 in 27 days). The warehouse counts more claims than Mixpanel because phone-reported claims are only there. Accept counts from Mixpanel with the phone-claim caveat.
- **Evidence:** `-- EVAL Q16` (monthly counts from `-- EVAL Q19`); Insights `claim submitted` by `product_line` and `peril`; `claim settled` sum of `payout_usd`.
- **Context needed:** 03-event-dictionary.md (claim events), 04-metrics-and-tables.md (`claims_operations_daily` caveats), 02-timeline.md (hurricane).
- **Grading:** must separate submitted from settled and mention the hurricane. Wrong: summing `estimated_loss_usd` as payouts; treating warehouse claim counts and Mixpanel counts as interchangeable.

### Q17 — Where do shoppers drop out?
- **Prompt:** "Walk me through our quote-to-purchase funnel. Where do we lose shoppers?"
- **Type:** funnel
- **Answer:** Of **3,735** shoppers who started a quote, **2,302 (61.6%)** completed it, **1,284 (55.8% of completed)** created an account, and **734 (57.2% of accounts)** bought a policy: **19.7%** of quote starts end in a purchase. The two biggest losses are the quote form itself (38% never finish; see Q1) and the step after the price (44% of completed quotes never create an account). **2,451 shoppers never created an account** and exist only as anonymous devices. Completion is similar by product (auto 60.9%, home 63.5%, renters 62.0%). Accept funnel numbers within ±1 point with identity merging.
- **Evidence:** `-- EVAL Q17`; Funnels `quote started` → `quote completed` → `account created` → `policy purchased`, Uniques with identity merging, window long enough for purchases (14 days).
- **Context needed:** 00-manifest.md (anonymous quotes, identity merging), 03-event-dictionary.md (shopping events).
- **Grading:** must use merged identities (quote steps are anonymous). Wrong: a funnel that breaks at `account created` because the analyst counted by `user_id` only (it shows almost no shoppers completing quotes); blaming mobile (see Q13).

### Q18 — Why do customers cancel?
- **Prompt:** "Why are customers cancelling their policies?"
- **Type:** segmentation
- **Answer:** **772 policies were cancelled** in the window: **found_cheaper 32.3%** and **price_increase 27.1%** (together 59%, almost all at renewal, after the renewal notice), **nonpayment 16.6%** (128), moved 9.3%, sold_vehicle 8.7%, no_longer_needed 6.1%. Auto accounts for 520 cancellations, homeowners 146, renters 106. The controllable drivers are renewal price changes and bundling (Q6, Q7) and missed manual payments (Q10). Accept the reason mix from `cancel_reason`.
- **Evidence:** `-- EVAL Q18`; Insights `policy cancelled`, breakdown `cancel_reason` and `product_line`.
- **Context needed:** 03-event-dictionary.md (`cancel_reason`, renewal timing).
- **Grading:** must use `cancel_reason` and connect price reasons to renewal. Wrong: counting customers with `customer_status = cancelled` only (483; customers who drop one of two policies stay active).

### Q19 — What should leadership worry about going into Q4?
- **Prompt:** "Looking at the last four months, what should leadership worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names at least three of these, with numbers:
  - **The auto rate increase is losing buyers:** auto purchases per completed quote 34.6% → 25.4% (0.73x) and written premium per quote 0.81x; auto new-business premium per day down about 17%. Consider a smaller increase or segment the increase (Q5). Existing auto customers move to the new rates at renewal from November, and renewal price increases drive non-renewal (Q7).
  - **Renewal retention:** increases of 15%+ push non-renewal to about 18% overall (3.4x no increase; 28% for single-line policies); single-line customers leave about 2.4x as often as bundled ones (Q6, Q7). Bundling and price-change management are the levers.
  - **Catastrophe exposure and capacity:** Delphine made Gulf property claims 2.55x slower and backed up 211 open claims; $1.69M paid. Hurricane season runs to November 30 (Q3).
  - **Nonpayment:** about a sixth of cancellations; manual payers fail 3.6x as often and about a fifth of their failures lapse; push autopay (Q10).
  - **Acquisition mix:** comparison sites cost $414 per policy, about the same as search ($435); social costs $161 and scaled cleanly in the fall campaign (Q4, Q8).
  - Positives: Express Quote (+38% completion, ship it) and Snap & Settle (0.28x cycle time) work (Q1, Q2).
  - Context: monthly quote starts about 835 (June, 27 days) to 1,006 (September); new policies 175-204 a month; active customers grew from 6,189 (June) to 6,544 (September).
- **Evidence:** H1, H2, H3, H4, H5, H6, H7, H10; `-- EVAL Q19` and the queries above.
- **Context needed:** all guides.
- **Grading:** credit for prioritized, quantified risks tied to the data and the calendar (November renewals on the new rate plan, hurricane season). Penalize generic advice without numbers, or claims the data does not support (for example "autopay customers renew better").

### Q20 — Where should next quarter's paid budget go?
- **Prompt:** "If we can move paid budget between search, comparison sites, and social next quarter, what would you do?"
- **Type:** open-ended
- **Answer:** Judge channels on policies, not quotes or platform-reported conversions. Current spend is about **$953 a day on search, $352 on comparison sites, and $139 on social** (window average). Cost per policy is **$435 search, $414 comparison sites, $161 social**; the networks' own cost per conversion ($85.32, $41.61, $31.62) makes comparison sites look twice as efficient as search, but their shoppers rarely buy, so per policy they cost about the same (Q4). The fall campaign showed social scales: spend up 1.9x brought 1.8x the quote starts at about the same cost per quote (Q8). A reasonable plan: grow social further and test whether the cost per quote holds; renegotiate the comparison-site price per lead (at their purchase rate a lead is worth roughly half what a search quote is worth); hold search. Note that purchase counts per channel are small (102-263) and the window cannot show lifetime value or claims experience by channel.
- **Evidence:** H4-comparison-site-economics, H8-fall-social-campaign; `-- EVAL Q4`, `-- EVAL Q8`, `-- EVAL Q20`.
- **Context needed:** 04-metrics-and-tables.md (cost per policy definition, `marketing_spend_daily`), 01-business.md (channels and billing).
- **Grading:** credit for joining spend to Mixpanel purchases, using the campaign as evidence of scalability, and caveats. Wrong: "move everything to comparison sites because leads are cheapest"; using `conversions_reported` for cost per policy.
