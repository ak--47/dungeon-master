# Forkfly (food-delivery) — 20-question eval

- **Data:** `data/verify-food-delivery` (full fidelity: 10,000 customers, 9,987 with events, 4,222 new signups, 1,001,869 events, 48,264 orders, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query (or the `-- STORY` query it names) in `dungeons/vertical/food-delivery/food-delivery.sql` on that data.
- **Stories:** ids refer to the `stories` export in `food-delivery.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Do new customers come back after a late first order?
- **Prompt:** "Do new customers come back after their first order? Does a late first delivery change that?"
- **Type:** retention
- **Answer:** Yes, lateness matters a lot. Of new customers whose first order was delivered by Aug 31, 30-day repeat by lateness of that first delivery: early 48.6% (654), 0-9 min late 51.4% (743), 10-14 min late 49.2% (307), 15-19 min late 38.7% (204), 20+ min late 28.4% (222). At the company's 20-minute late threshold, **28.4%** of customers with a late first delivery ordered again vs **48.7%** of those delivered on time (**0.58x**); at a 15-minute cut, **33.3% vs 49.9% (0.67x)**. Repeat rates hold while the first order is early or up to 14 minutes late and fall steeply past 15. About half of new customers order again within 30 days even after a good first order. 10.4% of first deliveries (222 of 2,130) were 20+ minutes late; 20.0% were 15+. Accept a late/on-time ratio of 0.50-0.75 at any cutoff from 15 to 20 minutes.
- **Evidence:** H1-late-first-order; Funnels `order delivered` with the **first time ever** filter → `order placed`, 30-day window, cohort "did `account created`" in the window, date range Jun 4 - Aug 31, breakdown step 1 `minutes_late` (custom buckets); `-- STORY H1` and `-- EVAL Q1` (first two queries).
- **Context needed:** 04-metrics-and-tables.md (late = 20+ minutes, 30-day repeat definition), 03-event-dictionary.md (`minutes_late`).
- **Grading:** must key the read to each new customer's first delivery, restrict to new customers and complete 30-day windows, and give both rates. Reward the size of the gap and a bucketed curve that shows repeat rates holding for small delays and falling for large ones. Wrong: the same funnel without the first-time-ever filter. A breakdown on a step-1 property runs one funnel per bucket, so a kept customer's later late deliveries enter the late bucket and the ratio reads about 1.1 (1.14 at 20 minutes, 1.08 at 15; `-- EVAL Q1` third query), which hides the effect. Also wrong: using all customers (an established customer's first order in the window is not their first ever); counting first deliveries from September (window incomplete); "lateness doesn't matter".

### Q2 — Do we sell more on rainy days?
- **Prompt:** "Does the weather affect our order volume? Do we get more orders when it rains?"
- **Type:** external-join
- **Answer:** Yes, moderately. Joining orders to `market_ops_daily` by city and UTC date, a rainy city-day (`weather_condition` rain or thunderstorm; 178 of 960 city-days) has **1.15x** the orders of that city's average dry day. Every city shows more orders on rainy days: Miami 1.17x (44 rainy days), Atlanta 1.11x (27), Boston 1.09x (22), New York 1.23x (22), Chicago 1.10x (21), Denver 1.12x (21), Seattle 1.29x (11), Austin 1.05x (10); single cities with 10-22 rainy days are noisy. Checkout conversion is about the same in rain (66.3% on rainy days vs 66.8% on dry days); the extra orders come from more visits. Accept 1.08x-1.32x pooled.
- **Evidence:** H2-rainy-days; Insights `order placed` daily by `city`, joined to `market_ops_daily.precipitation_mm` on date + city; `-- STORY H2` and `-- EVAL Q2`.
- **Context needed:** 04-metrics-and-tables.md (`market_ops_daily`, rainy-day definition), 02-timeline.md (weather note).
- **Grading:** must join weather by city and date (not national averages) and compare within city. Wrong: pooling all cities without normalizing (Miami's many rainy days mix city size into the answer); "no effect"; claiming rain doubles demand.

### Q3 — Why are deliveries late on some days?
- **Prompt:** "Some days our late-delivery numbers are terrible. What's going on?"
- **Type:** external-join
- **Answer:** Rain. On rainy city-days deliveries average **15.2 minutes late vs 3.0 on dry days (+12.2 min)**, and **33.1%** of rainy-day orders arrive 20+ minutes late (the company's late threshold) vs **4.9%** on dry days. Couriers are stretched: `market_ops_daily` shows **3.08 orders per active courier on rainy days vs 2.38 on dry days**. Within each city, fewer couriers work on rainy days (`active_couriers` about 12% below the city's dry-day average) while dispatched orders rise about 14% (Mixpanel orders about 15%, Q2). Support contacts follow: 16.4% of rainy-day orders vs 6.5% of dry-day orders. Quoted ETAs at checkout do not rise on rainy days (37.6 vs 37.7 minutes on average), so customers are promised the usual time. Accept +10 to +14 minutes and naming rain plus courier strain.
- **Evidence:** H2-rainy-days; Insights `order delivered` average `minutes_late` by day and city joined to `market_ops_daily`; Insights `checkout started` average `quoted_eta_mins` on rainy vs dry city-days; `-- STORY H2` (second query) and `-- EVAL Q3` (the last query gives the quoted ETAs).
- **Context needed:** 04-metrics-and-tables.md (`market_ops_daily`, on-time definition), 03-event-dictionary.md (`minutes_late`, `quoted_eta_mins`).
- **Grading:** must link lateness to weather with the warehouse table and size it. Wrong: blaming specific restaurants or cuisines; blaming one city without checking weather (see Q20).

### Q4 — Does the quoted delivery time affect checkout?
- **Prompt:** "Does the delivery time we show at checkout affect whether people order? Is there a point where they give up?"
- **Type:** funnel
- **Answer:** Yes, there is a cliff around 45 minutes. Checkout → order (per checkout, `order_id` held, 1-hour window): quotes under 30 min 76.0%, 30-39 min 74.9%, 40-45 min 64.5%, 46-50 min 48.9%, 51-60 min 41.1%, over 60 min 38.3%. Quotes of 45 minutes or less convert **73.1%** vs **43.7%** for longer quotes (**0.60x**). 21.7% of checkouts are quoted over 45 minutes. Accept a decline that steepens in the 40-50 minute range and a ≤45 vs >45 ratio of 0.54-0.66.
- **Evidence:** H3-quoted-eta-threshold; Funnels `checkout started` → `order placed`, Totals, hold `order_id`, 1-hour window, breakdown `quoted_eta_mins` buckets; `-- STORY H3` and `-- EVAL Q4`.
- **Context needed:** 03-event-dictionary.md (`quoted_eta_mins`), 04-metrics-and-tables.md (checkout conversion).
- **Grading:** must use per-checkout conversion and find the threshold region. Wrong: a unique-customer funnel (most customers convert at least once, which hides the effect); "linear decline" with no threshold region.

### Q5 — What happened to orders in late August?
- **Prompt:** "Orders dipped for a few days at the end of August. What happened, and how many orders did we lose?"
- **Type:** external-join
- **Answer:** The **Paylane card processor incident, Aug 25-28** (timeline). `payment_gateway_daily` shows card as `major_outage` on those four days with decline rates of 0.60-0.62 (vs about 0.02 normally); other methods were operational. Card checkout conversion fell to 23.5-27.5% a day vs about 62% normally, while Apple Pay, Google Pay, and PayPal together held at 63-67%. Relative to other methods, card conversion was **0.39x** its level in the 14 days either side. Of 1,421 card checkouts, 358 became orders; at the normal 62.5% rate that is about **530 lost orders** (570 `processor_unavailable` failures), roughly **$18,000** of order value at the $34.61 average card order. Orders recovered on Aug 29. Accept 0.33x-0.50x and 430-640 lost orders.
- **Evidence:** H4-card-processor-incident; Funnels `checkout started` → `order placed` by `payment_method`, daily, joined to `payment_gateway_daily`; `payment failed` by `decline_code`; `-- STORY H4` and `-- EVAL Q5`.
- **Context needed:** 02-timeline.md (incident dates; Paylane is the card processor), 04-metrics-and-tables.md (`payment_gateway_daily`).
- **Grading:** must name the card processor incident and split by payment method. Wrong: "demand fell" or blaming weather or the fee change; counting all payment methods as affected.

### Q6 — Should we ship Smart Add-ons?
- **Prompt:** "Is the Smart Add-ons test working? Should we ship it?"
- **Type:** funnel
- **Answer:** Yes. After Jul 28 the Smart Add-ons arm orders **2.80 items per order vs 2.39 in Control (+0.41)** and **$27.96 vs $25.47 subtotal (+$2.49)**. Before Jul 28 the same customers ordered 2.39 vs 2.39 items, so the pre-test adjusted lift is **+0.40 items** and **+$2.33 subtotal per order**. Raw and adjusted lifts agree because the arms are balanced in customers (4,097 Control vs 4,265 Smart Add-ons exposed) and in household mix (single households 42.1% vs 42.4%; items per order follow household size, so a household skew would open a gap between the raw and adjusted lifts). Suggestions were added 5,757 times at about $5.48 each. Checkout conversion is not meaningfully different (64.0% vs 63.4%; Q7). Recommend shipping. Accept an items lift of 0.3-0.5 and a subtotal lift of $1.5-3.0, with conversion flat.
- **Evidence:** H5-smart-addons-experiment; Insights `order placed` average `items_count` and `subtotal_usd` by `Experiment: Smart Add-ons`, Jul 28 - Oct 1 vs Jun 4 - Jul 27 (or the Experiments report on `$experiment_started`); `-- STORY H5` and `-- EVAL Q6`.
- **Context needed:** 02-timeline.md (test start, arms), 03-event-dictionary.md (`added_from`, `items_count`).
- **Grading:** must compare arms after the start and check conversion. Full credit for the raw or the adjusted lift; extra credit for checking the pre-test baseline. Wrong: comparing customers who used a suggestion against everyone else (selection); including orders before Jul 28.

### Q7 — Does Smart Add-ons hurt conversion?
- **Prompt:** "Our designers worry the add-on suggestions slow people down at checkout. Did Smart Add-ons lower checkout conversion?"
- **Type:** null-hypothesis
- **Answer:** No meaningful effect. Per-checkout conversion after Jul 28: Control **63.95%** (21,893 checkouts) vs Smart Add-ons **63.43%** (22,708), z = -1.15 (p ≈ 0.25). By Pass status: non-Pass 62.0% vs 61.4% (z = -1.20), Pass 70.1% vs 69.9% (z = -0.15). By platform the arms go in opposite directions: iOS 63.7% vs 63.9% (z = 0.33), Android 64.3% vs 62.9% (z = -2.07, p ≈ 0.04). The Android split alone is the one sub-split under 0.05 among four, which fails a multiple-comparison check (Bonferroni threshold p < 0.0125), and the test for a platform difference in the arm effect is not significant (interaction z = -1.76, p ≈ 0.08). The checkout screen is the same on both platforms. Accept "no significant difference" with numbers within ±1.5 points.
- **Evidence:** H5-smart-addons-experiment (second assertion); Funnels `checkout started` → `order placed`, hold `order_id`, by arm, with platform and Pass breakdowns; `-- EVAL Q7` (split table and interaction query).
- **Context needed:** 02-timeline.md (test start), 04-metrics-and-tables.md (checkout conversion).
- **Grading:** must answer "no" with a test or interval. Full credit when an answer reports the Android split and treats it with a multiple-comparison or interaction check. Wrong: "Smart Add-ons hurts Android conversion" as a finding without that check; using unique-customer conversion.

### Q8 — Which paid channel has the cheapest customers?
- **Prompt:** "Which paid channel gives us the cheapest new customers?"
- **Type:** external-join
- **Answer:** Per signup, coupon affiliates: window spend from `marketing_spend_daily` divided by Mixpanel signups is **$9.01 coupon affiliates** (940 signups, $8,466), **$17.95 paid social** (927, $16,641), **$26.38 paid search** (720, $18,990). But coupon-site customers come back far less often (Q9), so **per repeat customer coupon affiliates cost $56.67 vs $45.89 for paid social (1.23x)** and $70.83 for paid search. Paid social is the cheapest channel per kept customer. Networks over-claim signups (e.g. coupon partners claim 1,089 vs 940), so cost per network-reported signup understates CAC. Accept coupon ≈ 0.31-0.38x of paid search per signup and coupon at least level with paid social per repeat customer (1.0-1.4x).
- **Evidence:** H6-channel-economics; Insights `account created` by `acquisition_channel` joined to `marketing_spend_daily.spend_usd`; Funnels `order delivered` → `order placed`, 30-day window, new customers, Jun 4 - Aug 31, by channel; `-- STORY H6` and `-- EVAL Q8`.
- **Context needed:** 04-metrics-and-tables.md (CAC uses Mixpanel signups; table columns), 01-business.md (channels, DEAL15).
- **Grading:** must join spend to Mixpanel signups and go beyond cost per signup. Wrong: using `network_reported_signups` as the denominator; stopping at "coupon affiliates are 3x cheaper".

### Q9 — Do coupon-site customers stick around?
- **Prompt:** "Are customers from coupon and deal sites as loyal as customers from other channels?"
- **Type:** retention
- **Answer:** No. Of new customers whose first order was delivered by Aug 31, **24.0%** of coupon-affiliate customers ordered again within 30 days vs **53.0%** for all other channels (**0.45x**). By channel: organic 50.0%, paid search 56.4%, paid social 55.9%, referral 49.8%, coupon affiliates 24.0% (471 first orders). First-order rates are similar across channels (78-83% of signups through Aug 31); the gap opens after the discounted first order. Accept 0.35x-0.60x.
- **Evidence:** H6-channel-economics; Funnels `order delivered` → `order placed`, 30-day window, cohort "did `account created`" in the window, date range Jun 4 - Aug 31, breakdown `acquisition_channel` (a first-time-ever filter on step 1 gives the same rates); `-- EVAL Q9`.
- **Context needed:** 01-business.md (coupon affiliates, DEAL15), 04-metrics-and-tables.md (repeat rate).
- **Grading:** must compare repeat behavior by channel for new customers with complete windows (first deliveries through Aug 31). Wrong: comparing total orders per customer without accounting for signup date; including September first deliveries (incomplete windows lower every channel's rate).

### Q10 — What makes a Pass trial convert?
- **Prompt:** "What predicts whether a Forkfly Pass free trial turns into a paid membership?"
- **Type:** segmentation
- **Answer:** Ordering at least twice during the trial. Of 1,548 trials that started in the window and finished by Oct 1, **64.2%** of trials with **2+ orders** converted vs **29.5%** with 0-1 orders (2.2x). By count: 0 orders 29.5%, 1 order 29.5%, 2 orders 62.8%, 3 orders 70.0%, 4+ orders 60.9%: a step at the second order, flat after. Overall 46.7% convert; 49.6% of trials reach 2 orders. Accept a step between 1 and 2 orders with rates of about 0.55-0.72 vs 0.24-0.35.
- **Evidence:** H7-pass-trial-two-orders; Insights `pass trial ended`, share `outcome = converted`, breakdown `orders_during_trial`; `-- STORY H7` and `-- EVAL Q10`.
- **Context needed:** 03-event-dictionary.md (`pass trial ended` properties), 01-business.md (trial rules).
- **Grading:** must find the threshold at 2 orders (not "more is always better"). Wrong: including trials still running at the end of the window; using Pass status on later orders as the outcome. Including the 192 trials that began before June 4 (their `pass trial ended` arrives Jun 4-17 with no `pass trial started`) moves the rates by under a point (29.0% vs 64.2%) and is acceptable if stated; their `orders_during_trial` includes days before the data starts (03-event-dictionary.md).

### Q11 — Does the $15 free-delivery minimum change baskets?
- **Prompt:** "Pass members get free delivery from $15. Does that change what they order?"
- **Type:** segmentation
- **Answer:** Yes, Pass baskets pile up just above $15. Share of orders with a subtotal of $10-14.99: **5.5% of Pass orders vs 13.0% of non-Pass orders**; $15-19.99: **28.4% vs 20.2%**. Among $10-19.99 orders, **16.1%** of Pass orders are under $15 vs **39.1%** of non-Pass orders (**0.41x**). Below $10 and above $20 the two look alike. 92.4% of Pass orders get free delivery. Accept a clear dip below $15 and pile-up above it for Pass orders (ratio 0.3-0.5).
- **Evidence:** H8-pass-free-delivery-minimum; Insights `order placed`, filter `subtotal_usd` 10-20, breakdown `pass_status` × subtotal buckets; `-- STORY H8` and `-- EVAL Q11`.
- **Context needed:** 01-business.md (Pass free-delivery minimum), 03-event-dictionary.md (`pass_status` at event time).
- **Grading:** must compare the distribution around $15 by Pass status at order time. Wrong: comparing average subtotal only ($26.46 vs $26.23, nearly the same); using the current profile Pass status instead of the event's.

### Q12 — Did the August fee increase cost us orders?
- **Prompt:** "We raised the service fee for non-Pass orders in August. Did it hurt orders, and was it worth it?"
- **Type:** trend
- **Answer:** It cost orders. Per-checkout conversion for non-Pass customers fell from **71.5% before Aug 11 to 60.6% after**, while Pass customers (fee unchanged) went from 71.5% to 71.7%; difference-in-differences **0.84** (−16%; card-incident days excluded). Service-fee revenue per non-Pass checkout still rose from **$1.82 to $2.38** (+31%) because each order pays more ($2.54 → $3.93 per order), but order value per non-Pass checkout fell from **$24.47 to $22.03** (−10%), so restaurants and couriers lose volume and the gain depends on how much commission is lost. Accept a DiD of 0.77-0.93 and naming Pass as the control.
- **Evidence:** H9-service-fee-change; Funnels `checkout started` → `order placed` by `pass_status`, before vs after Aug 11; `-- STORY H9` and `-- EVAL Q12`.
- **Context needed:** 02-timeline.md (fee change, Pass unchanged), 01-business.md (fees, commission not in data).
- **Grading:** must use Pass as a control or otherwise separate the fee effect from trends and the incident. Wrong: raw order counts before vs after (growth pushes orders up); including Aug 25-28 without noting the card incident.

### Q13 — Is Order Again working?
- **Prompt:** "We launched Order Again in July. Is it working?"
- **Type:** funnel
- **Answer:** Yes, mostly as a faster path to orders customers were going to place. Visits that use Order Again reach `order placed` in a median **5.6 minutes vs 16.0 minutes** for browsing visits (0.35x), and **75.9%** of Order Again visits reach checkout. The extra volume is modest: for established customers (all of whom have past orders and can use it), checkouts per app visit rose from **38.1% (Jun 4 - Jul 6) to 43.8% (Jul 28 - Oct 1), +15%**. Across all customers, orders per weekly active customer went from about 0.65-0.66 in June to 0.75 in the two full weeks after adoption settled (Jul 27 - Aug 9) while app opens per active customer stayed at 2.4; from Aug 11 the non-Pass fee increase (Q12) pulled it back to about 0.65-0.67. Order Again visits end in an order 48.9% of the time vs 23.4% for the other visits of customers who use it (2.1x), but that gap is mostly selection: customers open Order Again when they already plan to order. Accept a time ratio of 0.3-0.4 and an incremental checkout lift of roughly 10-20%.
- **Evidence:** H10-order-again-launch; speed: Funnels `app opened` → `order placed`, Totals, 60-minute window, median time to convert, breakdown step 2 `entry_point`, Jul 7 - Oct 1. Checkout reach: Funnels `reorder tapped` → `checkout started`, Totals, 60-minute window (24,371 taps). Lift: Insights, cohort "did not do `account created`" in the window (established customers), A = `checkout started`, B = `app opened`, formula A / B, Jun 4 - Jul 6 vs Jul 28 - Oct 1. `-- STORY H10` and `-- EVAL Q13` (speed, checkout reach, lift, weekly orders per active customer, and the visit order rate comparison).
- **Context needed:** 02-timeline.md (launch; fee change), 03-event-dictionary.md (`reorder tapped`, `entry_point`).
- **Grading:** must compare speed or conversion of Order Again visits against browsing visits after launch and say whether it adds orders. Reward separating the faster path from incremental volume. Wrong: reading the 2.1x visit order rate as the feature's lift; crediting all order growth since July to Order Again (new customers grow the base, Q17); comparing users who used it against users who never did (heavier customers use it more); using dates before Jul 7.

### Q14 — How fast did Order Again catch on?
- **Prompt:** "What share of our orders now come through Order Again, and how quickly did customers pick it up?"
- **Type:** trend
- **Answer:** Share of orders with `entry_point = reorder` by week: 5.4% in the launch week (Jul 6), 17.9% (Jul 13), 28.1% (Jul 20), 35.2% (Jul 27), then a plateau of 36-38% from August; **36.2% of September orders**. **6,275 customers** used it, 76% of customers who ordered after launch. Accept a ramp over about three weeks to roughly 33-40%.
- **Evidence:** H10-order-again-launch (adoption); Insights `order placed`, weekly, breakdown `entry_point`; `-- EVAL Q14`.
- **Context needed:** 02-timeline.md (launch date, eligibility).
- **Grading:** must show the ramp then plateau and a September share. Wrong: "adoption keeps growing"; counting `reorder tapped` events without checking they became orders.

### Q15 — Does the sign-up method matter?
- **Prompt:** "Do customers who sign up with email place a first order less often than people who use Apple or Google sign-in? Should we push social sign-in harder?"
- **Type:** null-hypothesis
- **Answer:** No meaningful difference. Of new customers who signed up through Aug 31, **80.7%** of Apple sign-ups (1,230), **81.0%** of email sign-ups (856), and **79.7%** of Google sign-ups (1,066) placed an order; a chi-square test across the three methods gives p = 0.77. The splits agree (one test per split): iOS 79.2% / 83.1% / 81.3% (Apple / email / Google; p = 0.25), Android 82.3% / 78.4% / 77.8% (p = 0.14), by signup month every p ≥ 0.51 (first-order rates fall from about 85% for June sign-ups to about 75% for August sign-ups for every method, because later sign-ups have less time to order), by channel every p ≥ 0.55. The direction flips between platforms, so there is no consistent pattern. Pushing social sign-in would not raise first orders. Accept "no significant difference" with rates within ±2 points.
- **Evidence:** Insights or Funnels `account created` → `order placed` (uniques), new customers who signed up Jun 4 - Aug 31, breakdown `signup_method`; `-- EVAL Q15` (rates per split, then one chi-square per split).
- **Context needed:** 01-business.md (sign-up options), 03-event-dictionary.md (`signup_method`), 04-metrics-and-tables.md (first-order rate).
- **Grading:** must answer "no" with numbers and a test or interval, using sign-ups with time to order. Wrong: comparing sign-up counts or order counts (Apple has the most sign-ups); including September sign-ups without noting the shorter time; reading a single pairwise gap inside one platform as a finding (for example Apple vs the rest on Android, z = 1.96, one of many comparisons).

### Q16 — How big is Forkfly Pass?
- **Prompt:** "Give me a quick picture of Forkfly Pass this summer: members, trials, and how much of our business it is."
- **Type:** context
- **Answer:** At the end of the window **1,521 customers are paid members and 195 are on a trial**. Pass orders were **26.5%** of all orders in the window, rising from 22.7% in June to 29.9% in September. 25,175 trial offers were shown, **1,743 trials started** in the window and 1,740 trials ended (including trials that began in late May); 285 members cancelled. Trial conversion is in Q10. Accept numbers within 3%.
- **Evidence:** H7/H8 context; profiles `pass_status`; Insights `order placed` by `pass_status`; `-- EVAL Q16`.
- **Context needed:** 01-business.md (Pass), 03-event-dictionary.md (`pass_status` at event time).
- **Grading:** must use event-time `pass_status` for order share and include trial customers as Pass. Wrong: using profile Pass status for historical orders.

### Q17 — Is acquisition growing?
- **Prompt:** "How many new customers are we getting each week, and from where?"
- **Type:** trend
- **Answer:** Steady, not growing: about **230-265 signups per full week** (4,222 in the window). Mix: organic 28.1%, coupon affiliates 22.3%, paid social 22.0%, paid search 17.1%, referral 10.6%. 80.4% of customers who signed up by Aug 31 placed an order. Total orders still grew (about 2,330-2,510 a week in the full June weeks to about 3,100-3,140 in the weeks starting Aug 31 to Sep 21), mainly because new customers add to the active base (weekly active customers rose from about 3,600 to 4,800); Order Again added a smaller share (Q13). Accept a flat signup trend.
- **Evidence:** Insights `account created`, weekly, breakdown `acquisition_channel`; `-- EVAL Q17`; weekly active customers in `-- EVAL Q13`.
- **Context needed:** 01-business.md (channels), 02-timeline.md (budgets steady).
- **Grading:** must separate signups from orders. Wrong: reading order growth as acquisition growth.

### Q18 — Where do customers drop between opening the app and ordering?
- **Prompt:** "Walk me through our ordering funnel. Where are we losing people?"
- **Type:** open-ended
- **Answer:** The ordering-visit funnel (`app opened` → `restaurant viewed` → `item added to cart` → `checkout started` → `order placed`, Totals, 1-hour window; 174,778 visits) converts **100% → 73.9% → 41.8% → 31.7% → 21.4%**. Read it with Order Again in mind: Order Again visits (13.9% of all visits in the window; the feature exists from Jul 7) send no `restaurant viewed`, so this funnel counts them as stopping after `app opened`. Split out:
  - **Browse visits** (86.1% of visits): 85.2% view a restaurant (the rest stop on the home feed), 48.2% build a cart, 36.6% reach checkout, 24.7% place an order.
  - **Order Again visits** (Order Again funnel `reorder tapped` → `checkout started` → `order placed`, 24,371 taps): 75.9% reach checkout and 49.7% place an order.
  The biggest drop is from restaurant page to cart (browsing without choosing). Checkout → order is **66.7%**. At checkout, the main losses are long quoted delivery times (Q4), the non-Pass fee increase from Aug 11 (Q12), and payment failures (1,553: an everyday rate of about 2.0%, plus the Aug 25-28 card incident, Q5). Accept the plain-funnel stage rates within 2 points. Also accept browse-only rates within 2 points when the analyst says Order Again visits are excluded or reported separately. Require at least two checkout drivers.
- **Evidence:** H3, H4, H9, H10; Funnels `app opened` → `restaurant viewed` → `item added to cart` → `checkout started` → `order placed`, Totals, 1-hour window (Mixpanel shows about 167,600 step-1 entries, because an `app opened` inside a live 1-hour attempt does not start a new one; the stage rates match within 0.1 point); Order Again funnel `reorder tapped` → `checkout started` → `order placed`, Totals, 1-hour window; `-- EVAL Q18` (first query: plain funnel; second: browse vs Order Again visits; third: Order Again funnel).
- **Context needed:** 03-event-dictionary.md (funnels, Order Again visits), 04-metrics-and-tables.md (visit and checkout conversion).
- **Grading:** must give stage rates and name checkout drivers backed by data. Credit an answer that notices Order Again visits drop out of the plain funnel at step 2 and reports them separately. Wrong: a unique-customer funnel over the whole window (nearly everyone orders at some point); reading the 26% drop at step 2 as all lost browsers without accounting for Order Again visits; counting one `reorder tapped` as both the restaurant step and the cart step (a Mixpanel funnel cannot match one event to two steps). Platform is not a checkout driver: iOS and Android checkout conversion are 66.8% vs 66.6% (z = 0.8, `-- EVAL Q15` context query); an answer that calls a platform gap a key finding is wrong.

### Q19 — What should we worry about this quarter?
- **Prompt:** "What should leadership worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names several of these, with numbers: (1) **late deliveries on rainy days** (33.1% of rainy-day orders 20+ minutes late vs 4.9% on dry days, with fewer couriers working; Q3) and **new customers lost after a late first delivery** (repeat 28.4% vs 48.7% at the 20-minute threshold; Q1), so courier supply on rainy days and more honest quotes matter; (2) **new-customer repeat is only about half** even after a good first order (Q1); (3) **coupon affiliates** look cheap but deliver less than half the repeat rate of other channels, so they cost more per repeat customer than paid social (Q8, Q9); (4) the **August fee increase** cut non-Pass checkout conversion by about 16% (Q12) and offset the Order Again gain in orders per active customer (Q13); (5) **quoted delivery times over 45 minutes** (22% of checkouts) convert far worse (Q4); (6) dependence on one card processor (Q5, about 530 lost orders in four days). Positives: Order Again (about 36% of orders and a faster path; a modest gain in checkouts), Smart Add-ons ready to ship, Pass trials convert well once customers order twice. Overall late share (20+ minutes) is about 10-12% each full month. Grade on use of evidence; any three supported points pass.
- **Evidence:** H1, H2, H3, H4, H6, H9, H10; `-- EVAL Q19` plus the queries cited.
- **Context needed:** all guides.
- **Grading:** must be grounded in data. Wrong: generic advice; claims with no numbers; naming an iOS vs Android gap as a risk (checkout conversion 66.8% vs 66.6%, z = 0.8: no supported platform difference).

### Q20 — Which cities have the worst on-time performance?
- **Prompt:** "Which cities are worst for late deliveries? Should we replace the market manager in the worst one?"
- **Type:** external-join
- **Answer:** Miami is worst (**16.0%** of deliveries 20+ minutes late, the company's late threshold), then Atlanta 11.9%, New York 11.2%, Chicago 10.5%, Denver 10.5%, Boston 9.9%, Seattle 8.4%, Austin 7.2%. The ranking follows the weather: 40.4% of Miami's orders fall on rainy days vs 9-12% in Austin and Seattle. On dry days every city is 4.4-5.3% late, so the city gap is rain, not management. Accept Miami worst and the rain explanation; recommend courier supply for rainy days rather than a personnel change.
- **Evidence:** H2-rainy-days; Insights `order delivered` late share by `city`, joined to `market_ops_daily`; `-- EVAL Q20`.
- **Context needed:** 02-timeline.md (weather note), 04-metrics-and-tables.md (late definition, `market_ops_daily`).
- **Grading:** must control for weather before blaming a city. Wrong: "replace Miami's manager" without checking dry-day performance.
