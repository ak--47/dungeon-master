# Forkfly (food-delivery) — 20-question eval

- **Data:** `data/verify-food-delivery` (full fidelity: 10,000 customers, 9,987 with events, 4,222 new signups, 973,401 events, 46,511 orders, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query (or the `-- STORY` query it names) in `dungeons/vertical/food-delivery/food-delivery.sql` on that data.
- **Stories:** ids refer to the `stories` export in `food-delivery.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Do new customers come back after a late first order?
- **Prompt:** "Do new customers come back after their first order? Does a late first delivery change that?"
- **Type:** retention
- **Answer:** Yes, lateness matters a lot. Of new customers whose first order was delivered by Aug 31, 30-day repeat by lateness of that first delivery: early 53.0% (528), 0-9 min late 53.0% (621), 10-14 min late 44.1% (256), 15-19 min late 30.8% (156), 20+ min late 28.0% (157). At the company's 20-minute late threshold, **28.0%** of customers with a late first delivery ordered again vs **49.3%** of those delivered on time (**0.57x**); at a 15-minute cut, **29.4% vs 51.4% (0.57x)**. Repeat rates hold while the first order is early or up to 9 minutes late, dip at 10-14 minutes, and fall steeply past 15. About half of new customers order again within 30 days even after a good first order. 9.1% of first deliveries (157 of 1,718) were 20+ minutes late; 18.2% were 15+. Accept a late/on-time ratio of 0.45-0.75 at any cutoff from 15 to 20 minutes.
- **Evidence:** H1-late-first-order; Funnels `order delivered` with the **first time ever** filter → `order placed`, 30-day window, cohort "did `account created`" in the window, date range Jun 4 - Aug 31, breakdown step 1 `minutes_late` (custom buckets); `-- STORY H1` and `-- EVAL Q1` (first two queries).
- **Context needed:** 04-metrics-and-tables.md (late = 20+ minutes, 30-day repeat definition), 03-event-dictionary.md (`minutes_late`).
- **Grading:** must key the read to each new customer's first delivery, restrict to new customers and complete 30-day windows, and give both rates. Reward the size of the gap and a bucketed curve that shows repeat rates holding for small delays and falling for large ones. Wrong: the same funnel without the first-time-ever filter. A breakdown on a step-1 property runs one funnel per bucket, so a kept customer's later late deliveries enter the late bucket and the ratio reads about 1.0-1.1 (1.10 at 20 minutes, 1.01 at 15; `-- EVAL Q1` third query), which hides the effect. Also wrong: using all customers (an established customer's first order in the window is not their first ever); counting first deliveries from September (window incomplete); "lateness doesn't matter".

### Q2 — Do we sell more on rainy days?
- **Prompt:** "Does the weather affect our order volume? Do we get more orders when it rains?"
- **Type:** external-join
- **Answer:** Yes, moderately. Joining orders to `market_ops_daily` by city and UTC date, a rainy city-day (`weather_condition` rain or thunderstorm; 178 of 960 city-days) has **1.18x** the orders of that city's average dry day. Every city shows more orders on rainy days: Miami 1.16x (44 rainy days), Atlanta 1.21x (27), Boston 1.20x (22), New York 1.19x (22), Chicago 1.18x (21), Denver 1.15x (21), Seattle 1.25x (11), Austin 1.09x (10); single cities with 10-22 rainy days are noisy. Checkout conversion is the same in rain (66.5% on rainy days vs 66.5% on dry days); the extra orders come from more visits. Accept 1.08x-1.32x pooled.
- **Evidence:** H2-rainy-days; Insights `order placed` daily by `city`, joined to `market_ops_daily.precipitation_mm` on date + city; `-- STORY H2` and `-- EVAL Q2`.
- **Context needed:** 04-metrics-and-tables.md (`market_ops_daily`, rainy-day definition), 02-timeline.md (weather note).
- **Grading:** must join weather by city and date (not national averages) and compare within city. Wrong: pooling all cities without normalizing (Miami's many rainy days mix city size into the answer); "no effect"; claiming rain doubles demand.

### Q3 — Why are deliveries late on some days?
- **Prompt:** "Some days our late-delivery numbers are terrible. What's going on?"
- **Type:** external-join
- **Answer:** Rain. On rainy city-days deliveries average **14.9 minutes late vs 3.0 on dry days (+11.9 min)**, and **32.2%** of rainy-day orders arrive 20+ minutes late (the company's late threshold) vs **5.0%** on dry days. Couriers are stretched: `market_ops_daily` shows **8.9 orders per active courier on rainy days vs 6.9 on dry days**. Within each city, fewer couriers work on rainy days (`active_couriers` about 10% below the city's dry-day average) while dispatched orders rise about 16% (Mixpanel orders about 18%, Q2). Support contacts follow: 15.2% of rainy-day orders vs 6.4% of dry-day orders. Quoted ETAs at checkout do not rise on rainy days (37.6 vs 37.7 minutes on average), so customers are promised the usual time. Accept +10 to +14 minutes and naming rain plus courier strain.
- **Evidence:** H2-rainy-days; Insights `order delivered` average `minutes_late` by day and city joined to `market_ops_daily`; Insights `checkout started` average `quoted_eta_mins` on rainy vs dry city-days; `-- STORY H2` (second query) and `-- EVAL Q3` (the last query gives the quoted ETAs).
- **Context needed:** 04-metrics-and-tables.md (`market_ops_daily`, on-time definition), 03-event-dictionary.md (`minutes_late`, `quoted_eta_mins`).
- **Grading:** must link lateness to weather with the warehouse table and size it. Wrong: blaming specific restaurants or cuisines; blaming one city without checking weather (see Q20).

### Q4 — Does the quoted delivery time affect checkout?
- **Prompt:** "Does the delivery time we show at checkout affect whether people order? Is there a point where they give up?"
- **Type:** funnel
- **Answer:** Yes, there is a cliff around 45 minutes. Checkout → order (per checkout, `order_id` held, 1-hour window): quotes under 30 min 76.3%, 30-39 min 74.5%, 40-45 min 64.4%, 46-50 min 48.6%, 51-60 min 40.7%, over 60 min 36.7%. Quotes of 45 minutes or less convert **73.0%** vs **43.1%** for longer quotes (**0.59x**). 21.8% of checkouts are quoted over 45 minutes. Accept a decline that steepens in the 40-50 minute range and a ≤45 vs >45 ratio of 0.54-0.66.
- **Evidence:** H3-quoted-eta-threshold; Funnels `checkout started` → `order placed`, Totals, hold `order_id`, 1-hour window, breakdown `quoted_eta_mins` buckets; `-- STORY H3` and `-- EVAL Q4`.
- **Context needed:** 03-event-dictionary.md (`quoted_eta_mins`), 04-metrics-and-tables.md (checkout conversion).
- **Grading:** must use per-checkout conversion and find the threshold region. Wrong: a unique-customer funnel (most customers convert at least once, which hides the effect); "linear decline" with no threshold region.

### Q5 — What happened to orders in late August?
- **Prompt:** "Orders dipped for a few days at the end of August. What happened, and how many orders did we lose?"
- **Type:** external-join
- **Answer:** The **Paylane card processor incident, Aug 25-28** (timeline). `payment_gateway_daily` shows card as `major_outage` on those four days with decline rates of 0.60-0.62 (vs about 0.02 normally); other methods were operational. Card checkout conversion fell to 22.4-26.1% a day vs about 64% normally, while Apple Pay, Google Pay, and PayPal together held at 59.8-65.5%. Relative to other methods, card conversion was **0.37x** its level in the 14 days either side. Of 1,360 card checkouts, 328 became orders; at the normal 64.0% rate that is about **540 lost orders** (512 `processor_unavailable` failures), roughly **$18,600** of order value at the $34.31 average card order. Orders recovered on Aug 29. Accept 0.30x-0.50x and 430-650 lost orders.
- **Evidence:** H4-card-processor-incident; Funnels `checkout started` → `order placed` by `payment_method`, daily, joined to `payment_gateway_daily`; `payment failed` by `decline_code`; `-- STORY H4` and `-- EVAL Q5`.
- **Context needed:** 02-timeline.md (incident dates; Paylane is the card processor), 04-metrics-and-tables.md (`payment_gateway_daily`).
- **Grading:** must name the card processor incident and split by payment method. Wrong: "demand fell" or blaming weather or the fee change; counting all payment methods as affected.

### Q6 — Should we ship Smart Add-ons?
- **Prompt:** "Is the Smart Add-ons test working? Should we ship it?"
- **Type:** funnel
- **Answer:** Yes, it adds a modest amount to every basket at no conversion cost. After Jul 28 the Smart Add-ons arm orders **2.57 items per order vs 2.37 in Control (+0.20)** and **$26.71 vs $25.50 subtotal (+$1.20)**. Before Jul 28 the same customers ordered 2.41 vs 2.39 items, so the pre-test adjusted lift is **+0.18 items** and **+$1.05 subtotal per order**. Raw and adjusted lifts agree because the arms are balanced in customers (3,829 Control vs 3,956 Smart Add-ons exposed) and in household mix (single households 42.5% vs 42.2%; items per order follow household size, so a household skew would open a gap between the raw and adjusted lifts). Suggestions were added 2,489 times at about $5.49 each, on about 18% of Smart Add-ons orders. Checkout conversion does not move: **63.7% Control vs 63.5% Smart Add-ons** (21,049 vs 21,557 checkouts, z = -0.35); by platform iOS 64.4% vs 63.8% (z = -1.01) and Android 62.7% vs 63.2% (z = 0.64); by Pass status non-Pass 61.4% vs 61.6% (z = 0.44) and Pass 70.3% vs 69.8% (z = -0.65). Recommend shipping. Accept an items lift of 0.12-0.25 and a subtotal lift of $0.6-1.6, with conversion flat.
- **Evidence:** H5-smart-addons-experiment; Insights `order placed` average `items_count` and `subtotal_usd` by `Experiment: Smart Add-ons`, Jul 28 - Oct 1 vs Jun 4 - Jul 27 (or the Experiments report on `$experiment_started`); Funnels `checkout started` → `order placed`, Totals, hold `order_id`, 1-hour window, by arm with platform and Pass breakdowns; `-- STORY H5` and `-- EVAL Q6` (including the conversion-by-arm query).
- **Context needed:** 02-timeline.md (test start, arms), 03-event-dictionary.md (`added_from`, `items_count`).
- **Grading:** must compare arms after the start and check conversion. Full credit for the raw or the adjusted lift; extra credit for checking the pre-test baseline. Wrong: comparing customers who used a suggestion against everyone else (selection); including orders before Jul 28; claiming the test hurts conversion overall or on one platform (no split has |z| above 1.1).

### Q7 — Does search lead to better checkouts?
- **Prompt:** "People who search for a dish seem to know what they want. Do checkouts that start from search convert better than checkouts from browsing the home feed? Should we make search more prominent?"
- **Type:** null-hypothesis
- **Answer:** No meaningful difference. Per checkout (`order_id` held, 1-hour window), checkouts whose `entry_point` is search convert **67.29%** (20,795 checkouts) vs **67.19%** from the home feed (31,260), z = 0.24 (p ≈ 0.81). The null holds in every obvious split (search vs home feed): iOS 67.1% vs 67.5% (p = 0.44), Android 67.6% vs 66.8% (p = 0.23); non-Pass 66.4% vs 66.2% (p = 0.65), Pass 70.5% vs 70.8% (p = 0.74); Control arm 67.6% vs 67.0% (p = 0.32), Smart Add-ons arm 66.7% vs 67.1% (p = 0.50); June 70.6% vs 70.9% (p = 0.72), July 71.6% vs 71.0% (p = 0.46), August 63.1% vs 63.2% (p = 0.89), September 63.9% vs 63.4% (p = 0.50); October 1 alone 56.8% vs 62.7% (446 checkouts, p = 0.21). The gap does not differ by platform (interaction p = 0.16), Pass (0.61), arm (0.48), or month (0.63). Order Again checkouts (the third `entry_point`, from Jul 7) average 64.3% over the window only because they exist after the launch, when the Aug 11 fee change and the card incident lower every path; in the same periods they convert like the others (Jul 7 - Aug 10: 70.8% vs 71.0% home feed and 71.1% search; Aug 11 - Oct 1: 61.5% vs 61.9% and 62.2%). Search makes no difference to checkout conversion, so promoting search would not raise orders from checkout. Accept "no significant difference" with rates within ±1.5 points.
- **Evidence:** Funnels `checkout started` → `order placed`, Totals, hold `order_id`, 1-hour window, breakdown step 1 `entry_point`, with platform, `pass_status`, `Experiment: Smart Add-ons`, and month breakdowns; `-- EVAL Q7` (split table with z and p, interaction table, Order Again periods).
- **Context needed:** 03-event-dictionary.md (`entry_point`), 04-metrics-and-tables.md (checkout conversion), 02-timeline.md (Order Again launch, fee change).
- **Grading:** must answer "no" with a test or interval and check at least one sub-split. Wrong: "search converts better" or "home feed converts better"; reading Order Again's lower whole-window rate as a path effect without noticing it exists only from Jul 7; a unique-customer funnel (nearly every customer converts at some point).

### Q8 — Which paid channel has the cheapest customers?
- **Prompt:** "Which paid channel gives us the cheapest new customers?"
- **Type:** external-join
- **Answer:** Per signup, coupon affiliates: window spend from `marketing_spend_daily` divided by Mixpanel signups is **$9.01 coupon affiliates** (940 signups, $8,466), **$17.95 paid social** (927, $16,641), **$26.38 paid search** (720, $18,990). But coupon-site customers come back far less often (Q9), so per repeat customer (spend Jun 4 - Aug 31 over new customers who reordered within 30 days of a first delivery through Aug 31) coupon affiliates are **at least as expensive as paid social: $62.78 vs $57.42 (1.09x; noisy, about 100 coupon repeaters, standard error of the ratio about 0.1)**, and paid search is the most expensive at $89.33. The cheap signup price does not carry through to kept customers. Networks over-claim signups (e.g. coupon partners claim 1,089 vs 940), so cost per network-reported signup understates CAC. Accept coupon ≈ 0.31-0.38x of paid search per signup, and coupon per repeat customer at about 0.9x of paid social or more (level or more expensive).
- **Evidence:** H6-channel-economics; Insights `account created` by `acquisition_channel` joined to `marketing_spend_daily.spend_usd`; Funnels `order delivered` → `order placed`, 30-day window, new customers, Jun 4 - Aug 31, by channel; `-- STORY H6` and `-- EVAL Q8`.
- **Context needed:** 04-metrics-and-tables.md (CAC uses Mixpanel signups; cost per repeat customer; table columns), 01-business.md (channels, DEAL15).
- **Grading:** must join spend to Mixpanel signups and go beyond cost per signup. Wrong: using `network_reported_signups` as the denominator; stopping at "coupon affiliates are 3x cheaper"; calling coupon affiliates the cheapest channel per kept customer.

### Q9 — Do coupon-site customers stick around?
- **Prompt:** "Are customers from coupon and deal sites as loyal as customers from other channels?"
- **Type:** retention
- **Answer:** No. Of new customers whose first order was delivered by Aug 31, **26.4%** of coupon-affiliate customers ordered again within 30 days vs **53.5%** for all other channels (**0.49x**). By channel: organic 52.1%, paid search 55.1%, paid social 55.6%, referral 50.3%, coupon affiliates 26.4% (387 first orders). First-order rates are similar across channels (62.5-65.6% of signups through Aug 31); the gap opens after the discounted first order. Accept 0.35x-0.60x.
- **Evidence:** H6-channel-economics; Funnels `order delivered` → `order placed`, 30-day window, cohort "did `account created`" in the window, date range Jun 4 - Aug 31, breakdown `acquisition_channel` (a first-time-ever filter on step 1 gives the same rates); `-- EVAL Q9`.
- **Context needed:** 01-business.md (coupon affiliates, DEAL15), 04-metrics-and-tables.md (repeat rate).
- **Grading:** must compare repeat behavior by channel for new customers with complete windows (first deliveries through Aug 31). Wrong: comparing total orders per customer without accounting for signup date; including September first deliveries (incomplete windows lower every channel's rate).

### Q10 — What makes a Pass trial convert?
- **Prompt:** "What predicts whether a Forkfly Pass free trial turns into a paid membership?"
- **Type:** segmentation
- **Answer:** Ordering at least twice during the trial. Of 1,478 trials that started in the window and finished by Oct 1, **64.3%** of trials with **2+ orders** converted vs **30.9%** with 0-1 orders (2.1x). By count: 0 orders 30.5%, 1 order 31.1%, 2 orders 63.6%, 3 orders 64.8%, 4+ orders 65.0%: a step at the second order, flat after. Overall 47.4% convert; 49.3% of trials reach 2 orders. Accept a step between 1 and 2 orders with rates of about 0.55-0.72 vs 0.24-0.35.
- **Evidence:** H7-pass-trial-two-orders; Insights `pass trial ended`, share `outcome = converted`, breakdown `orders_during_trial`; `-- STORY H7` and `-- EVAL Q10`.
- **Context needed:** 03-event-dictionary.md (`pass trial ended` properties), 01-business.md (trial rules).
- **Grading:** must find the threshold at 2 orders (not "more is always better"). Wrong: including trials still running at the end of the window; using Pass status on later orders as the outcome. Including the 192 trials that began before June 4 (their `pass trial ended` arrives Jun 4-17 with no `pass trial started`) moves the rates by under a point (31.0% vs 63.4%) and is acceptable if stated; their `orders_during_trial` includes days before the data starts (03-event-dictionary.md).

### Q11 — Does the $15 free-delivery minimum change baskets?
- **Prompt:** "Pass members get free delivery from $15. Does that change what they order?"
- **Type:** segmentation
- **Answer:** Yes, Pass baskets pile up just above $15. Share of orders with a subtotal of $10-14.99: **5.8% of Pass orders vs 14.1% of non-Pass orders**; $15-19.99: **29.0% vs 20.9%**. Among $10-19.99 orders, **16.6%** of Pass orders are under $15 vs **40.3%** of non-Pass orders (**0.41x**). Below $10 and above $20 the two look alike. 92.1% of Pass orders get free delivery. Accept a clear dip below $15 and pile-up above it for Pass orders (ratio 0.3-0.5).
- **Evidence:** H8-pass-free-delivery-minimum; Insights `order placed`, filter `subtotal_usd` 10-20, breakdown `pass_status` × subtotal buckets; `-- STORY H8` and `-- EVAL Q11`.
- **Context needed:** 01-business.md (Pass free-delivery minimum), 03-event-dictionary.md (`pass_status` at event time).
- **Grading:** must compare the distribution around $15 by Pass status at order time. Wrong: comparing average subtotal only ($26.37 vs $25.82, nearly the same); using the current profile Pass status instead of the event's.

### Q12 — Did the August fee increase cost us orders?
- **Prompt:** "We raised the service fee for non-Pass orders in August. Did it hurt orders, and was it worth it?"
- **Type:** trend
- **Answer:** It cost orders. Per-checkout conversion for non-Pass customers fell from **71.0% before Aug 11 to 60.7% after**, while Pass customers (fee unchanged) went from 70.8% to 71.6%; difference-in-differences **0.84** (−16%; card-incident days excluded). Service-fee revenue per non-Pass checkout still rose from **$1.80 to $2.32** (+29%) because each order pays more ($2.53 → $3.82 per order), but order value per non-Pass checkout fell from **$24.28 to $21.61** (−11%), so restaurants and couriers lose volume and the gain depends on how much commission is lost. Accept a DiD of 0.77-0.93 and naming Pass as the control.
- **Evidence:** H9-service-fee-change; Funnels `checkout started` → `order placed` by `pass_status`, before vs after Aug 11; `-- STORY H9` and `-- EVAL Q12`.
- **Context needed:** 02-timeline.md (fee change, Pass unchanged), 01-business.md (fees, commission not in data).
- **Grading:** must use Pass as a control or otherwise separate the fee effect from trends and the incident. Wrong: raw order counts before vs after (growth pushes orders up); including Aug 25-28 without noting the card incident.

### Q13 — Is Order Again working?
- **Prompt:** "We launched Order Again in July. Is it working?"
- **Type:** funnel
- **Answer:** Yes, mostly as a faster path to orders customers were going to place. Visits that use Order Again reach `order placed` in a median **5.65 minutes vs 16.0 minutes** for browsing visits (0.35x), and **75.8%** of Order Again visits reach checkout. The extra volume is modest: for established customers (all of whom have past orders and can use it), checkouts per app visit rose from **38.3% (Jun 4 - Jul 6) to 43.9% (Jul 28 - Oct 1), +15%**. Across all customers, orders per weekly active customer went from about 0.62-0.66 in June to 0.72-0.74 in the two full weeks after adoption settled (Jul 27 - Aug 9) while app opens per active customer stayed at about 2.4; from Aug 10 the non-Pass fee increase (Q12) pulled it back to about 0.64-0.68 (0.55 in the card-incident week of Aug 24). Order Again visits end in an order 48.5% of the time vs 23.6% for the other visits of customers who use it (2.1x), but that gap is mostly selection: customers open Order Again when they already plan to order. Accept a time ratio of 0.3-0.4 and an incremental checkout lift of roughly 10-20%.
- **Evidence:** H10-order-again-launch; speed: Funnels `app opened` → `order placed`, Totals, 60-minute window, median time to convert, breakdown step 2 `entry_point`, Jul 7 - Oct 1. Checkout reach: Funnels `reorder tapped` → `checkout started`, Totals, 60-minute window (23,758 taps). Lift: Insights, cohort "did not do `account created`" in the window (established customers), A = `checkout started`, B = `app opened`, formula A / B, Jun 4 - Jul 6 vs Jul 28 - Oct 1. `-- STORY H10` and `-- EVAL Q13` (speed, checkout reach, lift, weekly orders per active customer, and the visit order rate comparison).
- **Context needed:** 02-timeline.md (launch; fee change), 03-event-dictionary.md (`reorder tapped`, `entry_point`).
- **Grading:** must compare speed or conversion of Order Again visits against browsing visits after launch and say whether it adds orders. Reward separating the faster path from incremental volume. Wrong: reading the 2.1x visit order rate as the feature's lift; crediting all order growth since July to Order Again (new customers grow the base, Q17); comparing users who used it against users who never did (heavier customers use it more); using dates before Jul 7.

### Q14 — How fast did Order Again catch on?
- **Prompt:** "What share of our orders now come through Order Again, and how quickly did customers pick it up?"
- **Type:** trend
- **Answer:** Share of orders with `entry_point = reorder` by week: 6.1% in the launch week (Jul 6), 18.8% (Jul 13), 29.0% (Jul 20), 36.6% (Jul 27), then a plateau of 36-38% from August; **36.7% of September orders**. **6,087 customers** used it, 79% of customers who ordered after launch. Accept a ramp over about three weeks to roughly 33-40%.
- **Evidence:** H10-order-again-launch (adoption); Insights `order placed`, weekly, breakdown `entry_point`; `-- EVAL Q14`.
- **Context needed:** 02-timeline.md (launch date, eligibility).
- **Grading:** must show the ramp then plateau and a September share. Wrong: "adoption keeps growing"; counting `reorder tapped` events without checking they became orders.

### Q15 — Do push notification visits order less?
- **Prompt:** "Do visits that start from a push notification turn into orders as often as visits where customers open the app on their own? Are our pushes just bringing in low-intent traffic?"
- **Type:** null-hypothesis
- **Answer:** No meaningful difference. Visit conversion (the KPI: `app opened` → `order placed` within an hour, before the next `app opened`), by `open_source`: push **27.09%** (48,010 visits) vs organic **27.21%** (105,829), z = -0.47; deep links 27.19% (17,111); a chi-square across the three sources gives p = 0.90. The null holds in every obvious split (push vs organic): iOS 27.4% vs 27.5%, Android 26.7% vs 26.8%; non-Pass 26.3% vs 26.4%, Pass 30.0% vs 30.0%; Control arm 27.9% vs 28.1%, Smart Add-ons arm 27.9% vs 28.1%; every month within 0.2 points (October 1 alone 26.3% vs 25.0%). Every three-source split has p ≥ 0.16, and the push - organic gap does not differ by platform (interaction p = 0.94), Pass (0.84), arm (0.46), or month (0.98). The one soft spot is deep links among Pass visits (28.5% vs 30.0% organic, pairwise p ≈ 0.06), one of many comparisons and not significant in its own split (three-source p = 0.16). A Mixpanel funnel `app opened` → `order placed`, Totals, 1-hour window, breakdown step 1 `open_source` reads 27.9% for all three sources (it does not stop at the next `app opened`). Push visits are not lower-intent. Accept "no significant difference" with rates within ±1 point.
- **Evidence:** Funnels `app opened` → `order placed`, Totals, 1-hour window, breakdown step 1 `open_source`, with platform, `pass_status`, `Experiment: Smart Add-ons`, and month breakdowns (or the visit conversion KPI); `-- EVAL Q15` (rates with chi-square and push vs organic z per split, then the interaction table).
- **Context needed:** 03-event-dictionary.md (`open_source`), 04-metrics-and-tables.md (visit conversion).
- **Grading:** must answer "no" with numbers and a test or interval, on a per-visit base. Wrong: comparing order counts or orders per customer by source (heavier customers open more pushes and more visits of every kind); "pushes bring low-intent visits"; reading the deep-link Pass split as a finding without a multiple-comparison check; using unique-customer conversion.

### Q16 — How big is Forkfly Pass?
- **Prompt:** "Give me a quick picture of Forkfly Pass this summer: members, trials, and how much of our business it is."
- **Type:** context
- **Answer:** At the end of the window **1,512 customers are paid members and 185 are on a trial**. Pass orders were **26.9%** of all orders in the window, rising from 23.6% in June to 30.6% in September. 24,006 trial offers were shown, **1,663 trials started** in the window and 1,670 trials ended (including trials that began in late May); 268 members cancelled. Trial conversion is in Q10. Accept numbers within 3%.
- **Evidence:** H7/H8 context; profiles `pass_status`; Insights `order placed` by `pass_status`; `-- EVAL Q16`.
- **Context needed:** 01-business.md (Pass), 03-event-dictionary.md (`pass_status` at event time).
- **Grading:** must use event-time `pass_status` for order share and include trial customers as Pass. Wrong: using profile Pass status for historical orders.

### Q17 — Is acquisition growing?
- **Prompt:** "How many new customers are we getting each week, from which channels, and how many of them go on to place a first order? Is acquisition growing?"
- **Type:** trend
- **Answer:** Steady, not growing: **231-262 signups per full week** (weeks of Jun 8 to Sep 21; 4,222 in the window). Mix: organic 28.1%, coupon affiliates 22.3%, paid social 22.0%, paid search 17.1%, referral 10.6%. **64.3%** of customers who signed up by Aug 31 placed an order (62.5-65.6% by channel; the rest never saved an address or browsed without checking out). Total orders still grew (about 2,280-2,480 a week in the full June weeks to about 2,920-3,000 in the weeks of Aug 31 to Sep 21), mainly because new customers add to the active base (weekly active customers rose from about 3,600 to 4,550); Order Again added a smaller share (Q13). Accept a flat signup trend of roughly 220-270 a week and a first-order rate of 60-68%.
- **Evidence:** Insights `account created`, weekly, breakdown `acquisition_channel`; Funnels `account created` → `order placed` (uniques), signups Jun 4 - Aug 31; `-- EVAL Q17`; first-order rate by channel in `-- EVAL Q9`; weekly active customers in `-- EVAL Q13`.
- **Context needed:** 01-business.md (channels), 02-timeline.md (budgets steady), 04-metrics-and-tables.md (first-order rate).
- **Grading:** must give weekly counts from the data, separate signups from orders, and restrict the first-order rate to signups with time to order. Wrong: reading order growth as acquisition growth; dividing the window total by 17 weeks without checking the weekly trend; including September signups in the first-order rate without noting their shorter time.

### Q18 — Where do customers drop between opening the app and ordering?
- **Prompt:** "Walk me through our ordering funnel. Where are we losing people?"
- **Type:** open-ended
- **Answer:** The ordering-visit funnel (`app opened` → `restaurant viewed` → `item added to cart` → `checkout started` → `order placed`, Totals, 1-hour window; 170,950 visits) converts **100% → 73.9% → 42.1% → 31.2% → 21.0%**. Read it with Order Again in mind: Order Again visits (13.9% of all visits in the window; the feature exists from Jul 7) send no `restaurant viewed`, so this funnel counts them as stopping after `app opened`. Split out:
  - **Browse visits** (86.1% of visits): 85.2% view a restaurant (the rest stop on the home feed), 48.6% build a cart, 36.0% reach checkout, 24.3% place an order.
  - **Order Again visits** (Order Again funnel `reorder tapped` → `checkout started` → `order placed`, 23,758 taps): 75.8% reach checkout and 49.3% place an order.
  The biggest drop is from restaurant page to cart (browsing without choosing). Checkout → order is **66.5%**. At checkout, the main losses are long quoted delivery times (Q4), the non-Pass fee increase from Aug 11 (Q12), and payment failures (1,418: an everyday rate of about 1.9%, plus the Aug 25-28 card incident, Q5). Accept the plain-funnel stage rates within 2 points. Also accept browse-only rates within 2 points when the analyst says Order Again visits are excluded or reported separately. Require at least two checkout drivers.
- **Evidence:** H3, H4, H9, H10; Funnels `app opened` → `restaurant viewed` → `item added to cart` → `checkout started` → `order placed`, Totals, 1-hour window (Mixpanel shows about 163,900 step-1 entries, because an `app opened` inside a live 1-hour attempt does not start a new one; the stage rates match within 0.1 point); Order Again funnel `reorder tapped` → `checkout started` → `order placed`, Totals, 1-hour window; `-- EVAL Q18` (first query: plain funnel; second: browse vs Order Again visits; third: Order Again funnel).
- **Context needed:** 03-event-dictionary.md (funnels, Order Again visits), 04-metrics-and-tables.md (visit and checkout conversion).
- **Grading:** must give stage rates and name checkout drivers backed by data. Credit an answer that notices Order Again visits drop out of the plain funnel at step 2 and reports them separately. Wrong: a unique-customer funnel over the whole window (nearly everyone orders at some point); reading the 26% drop at step 2 as all lost browsers without accounting for Order Again visits; counting one `reorder tapped` as both the restaurant step and the cart step (a Mixpanel funnel cannot match one event to two steps). Platform is not a checkout driver: iOS and Android checkout conversion are 66.8% vs 66.2% (p = 0.10), and 67.6% vs 67.2% without the card incident days (p = 0.30); the small gap comes from Android customers paying by card more often (60% vs 47%) during the Aug 25-28 incident (`-- EVAL Q15` context query). An answer that calls a platform gap a key finding is wrong.

### Q19 — What should we worry about this quarter?
- **Prompt:** "What should leadership worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names several of these, with numbers: (1) **late deliveries on rainy days** (32.2% of rainy-day orders 20+ minutes late vs 5.0% on dry days, with fewer couriers working; Q3) and **new customers lost after a late first delivery** (repeat 28.0% vs 49.3% at the 20-minute threshold; Q1), so courier supply on rainy days and more honest quotes matter; (2) **new-customer repeat is only about half** even after a good first order, and about a third of signups never order (Q1, Q17); (3) **coupon affiliates** look cheap but deliver half the repeat rate of other channels, so they cost at least as much per repeat customer as paid social (Q8, Q9); (4) the **August fee increase** cut non-Pass checkout conversion by about 16% (Q12) and offset the Order Again gain in orders per active customer (Q13); (5) **quoted delivery times over 45 minutes** (22% of checkouts) convert far worse (Q4); (6) dependence on one card processor (Q5, about 540 lost orders in four days). Positives: Order Again (about 37% of orders and a faster path; a modest gain in checkouts), Smart Add-ons ready to ship (a small basket gain at no conversion cost), Pass trials convert well once customers order twice. Overall late share (20+ minutes) is about 9-12% each full month. Grade on use of evidence; any three supported points pass.
- **Evidence:** H1, H2, H3, H4, H6, H9, H10; `-- EVAL Q19` plus the queries cited.
- **Context needed:** all guides.
- **Grading:** must be grounded in data. Wrong: generic advice; claims with no numbers; naming an iOS vs Android gap as a risk (checkout conversion 66.8% vs 66.2%, p = 0.10, explained by the card incident: no supported platform difference).

### Q20 — Which cities have the worst on-time performance?
- **Prompt:** "Which cities are worst for late deliveries? Should we replace the market manager in the worst one?"
- **Type:** external-join
- **Answer:** Miami is worst (**16.0%** of deliveries 20+ minutes late, the company's late threshold), then Atlanta 11.8%, Chicago 10.9%, New York 10.6%, Boston 10.5%, Denver 10.5%, Seattle 8.2%, Austin 7.1%. The ranking follows the weather: 40.2% of Miami's orders fall on rainy days vs 9-11% in Austin and Seattle. On dry days every city is 4.6-5.5% late, so the city gap is rain, not management. Accept Miami worst and the rain explanation; recommend courier supply for rainy days rather than a personnel change.
- **Evidence:** H2-rainy-days; Insights `order delivered` late share by `city`, joined to `market_ops_daily`; `-- EVAL Q20`.
- **Context needed:** 02-timeline.md (weather note), 04-metrics-and-tables.md (late definition, `market_ops_daily`).
- **Grading:** must control for weather before blaming a city. Wrong: "replace Miami's manager" without checking dry-day performance.
