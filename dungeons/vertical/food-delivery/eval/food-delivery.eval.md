# Forkfly (food-delivery) — 20-question eval

- **Data:** `data/verify-food-delivery` (full fidelity: 10,000 customers, 9,987 with events, 4,222 new signups, 1,132,922 events, 60,417 orders, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query (or the `-- STORY` query it names) in `dungeons/vertical/food-delivery/food-delivery.sql` on that data.
- **Stories:** ids refer to the `stories` export in `food-delivery.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Do new customers come back after a late first order?
- **Prompt:** "Do new customers come back after their first order? Does a late first delivery change that?"
- **Type:** retention
- **Answer:** Yes, lateness matters a lot. Of new customers whose first order was delivered by Aug 31, 30-day repeat by lateness of that first delivery: early 75.0% (635), 0-9 min late 73.5% (748), 10-14 min late 68.3% (312), 15-19 min late 50.5% (212), 20+ min late 42.9% (205). At the company's 20-minute late threshold, **42.9%** of customers with a late first delivery ordered again vs **70.6%** of those delivered on time (**0.61x**); at a 15-minute cut, **46.8% vs 73.1% (0.64x)**. Repeat rates hold while the first order is early or a little late, slip at 10-14 minutes, and fall steeply past 15. 9.7% of first deliveries (205 of 2,112) were 20+ minutes late; 19.7% were 15+. Accept a late/on-time ratio of 0.50-0.72 at any cutoff from 15 to 20 minutes.
- **Evidence:** H1-late-first-order; Funnels `order delivered` with the **first time ever** filter → `order placed`, 30-day window, cohort "did `account created`" in the window, date range Jun 4 - Aug 31, breakdown step 1 `minutes_late` (custom buckets); `-- STORY H1` and `-- EVAL Q1` (first two queries).
- **Context needed:** 04-metrics-and-tables.md (late = 20+ minutes, 30-day repeat definition), 03-event-dictionary.md (`minutes_late`).
- **Grading:** must key the read to each new customer's first delivery, restrict to new customers and complete 30-day windows, and give both rates. Reward the size of the gap and a bucketed curve that shows repeat rates holding for small delays and falling for large ones. Wrong: the same funnel without the first-time-ever filter. A breakdown on a step-1 property runs one funnel per bucket, so a kept customer's later late deliveries enter the late bucket and the ratio reads about 1 (1.02 at 20 minutes, 0.94 at 15; `-- EVAL Q1` third query), which hides the effect. Also wrong: using all customers (an established customer's first order in the window is not their first ever); counting first deliveries from September (window incomplete); "lateness doesn't matter".

### Q2 — Do we sell more on rainy days?
- **Prompt:** "Does the weather affect our order volume? Do we get more orders when it rains?"
- **Type:** external-join
- **Answer:** Yes. Joining orders to `market_ops_daily` by city and UTC date, a rainy city-day (`weather_condition` rain or thunderstorm; 178 of 960 city-days) has **1.34x** the orders of that city's average dry day. It holds in every city: Miami 1.37x (44 rainy days), Atlanta 1.29x (27), Boston 1.45x (22), New York 1.31x (22), Chicago 1.30x (21), Denver 1.29x (21), Seattle 1.45x (11), Austin 1.22x (10). Checkout conversion is about the same in rain (66.4% on rainy days vs 66.7% on dry days); the extra orders come from more visits. Accept 1.25x-1.55x pooled.
- **Evidence:** H2-rainy-days; Insights `order placed` daily by `city`, joined to `market_ops_daily.precipitation_mm` on date + city; `-- STORY H2` and `-- EVAL Q2`.
- **Context needed:** 04-metrics-and-tables.md (`market_ops_daily`, rainy-day definition), 02-timeline.md (weather note).
- **Grading:** must join weather by city and date (not national averages) and compare within city. Wrong: pooling all cities without normalizing (Miami's many rainy days mix city size into the answer); "no effect".

### Q3 — Why are deliveries late on some days?
- **Prompt:** "Some days our late-delivery numbers are terrible. What's going on?"
- **Type:** external-join
- **Answer:** Rain. On rainy city-days deliveries average **14.8 minutes late vs 3.0 on dry days (+11.8 min)**, and **31.6%** of rainy-day orders arrive 20+ minutes late (the company's late threshold) vs **4.9%** on dry days. Couriers are stretched: `market_ops_daily` shows **3.09 orders per active courier on rainy days vs 2.38 on dry days**. Within each city, courier supply barely moves on rainy days (`active_couriers` under 1% above the city's dry-day average) while dispatched orders rise about 31% (Mixpanel orders about 34%, Q2). Support contacts follow: 14.9% of rainy-day orders vs 6.6% of dry-day orders. Quoted ETAs at checkout do not rise on rainy days (37.6 vs 37.7 minutes on average), so customers are promised the usual time. Accept +10 to +14 minutes and naming rain plus courier strain.
- **Evidence:** H2-rainy-days; Insights `order delivered` average `minutes_late` by day and city joined to `market_ops_daily`; `-- STORY H2` (second query) and `-- EVAL Q3`.
- **Context needed:** 04-metrics-and-tables.md (`market_ops_daily`, on-time definition), 03-event-dictionary.md (`minutes_late`, `quoted_eta_mins`).
- **Grading:** must link lateness to weather with the warehouse table and size it. Wrong: blaming specific restaurants or cuisines; blaming one city without checking weather (see Q20).

### Q4 — Does the quoted delivery time affect checkout?
- **Prompt:** "Does the delivery time we show at checkout affect whether people order? Is there a point where they give up?"
- **Type:** funnel
- **Answer:** Yes, there is a cliff around 45 minutes. Checkout → order (per checkout, `order_id` held, 1-hour window): quotes under 30 min 76.3%, 30-39 min 74.3%, 40-45 min 64.3%, 46-50 min 50.2%, 51-60 min 39.8%, over 60 min 39.7%. Quotes of 45 minutes or less convert **72.9%** vs **44.0%** for longer quotes (**0.60x**). 21.7% of checkouts are quoted over 45 minutes. Accept a decline that steepens in the 40-50 minute range and a ≤45 vs >45 ratio of 0.54-0.66.
- **Evidence:** H3-quoted-eta-threshold; Funnels `checkout started` → `order placed`, Totals, hold `order_id`, 1-hour window, breakdown `quoted_eta_mins` buckets; `-- STORY H3` and `-- EVAL Q4`.
- **Context needed:** 03-event-dictionary.md (`quoted_eta_mins`), 04-metrics-and-tables.md (checkout conversion).
- **Grading:** must use per-checkout conversion and find the threshold region. Wrong: a unique-customer funnel (most customers convert at least once, which hides the effect); "linear decline" with no threshold region.

### Q5 — What happened to orders in late August?
- **Prompt:** "Orders dipped for a few days at the end of August. What happened, and how many orders did we lose?"
- **Type:** external-join
- **Answer:** The **Paylane card processor incident, Aug 25-28** (timeline). `payment_gateway_daily` shows card as `major_outage` on those four days with decline rates of 0.60-0.62 (vs about 0.02 normally); other methods were operational. Card checkout conversion fell to 25.2-28.8% a day vs about 64% normally, while Apple Pay, Google Pay, and PayPal together held at 62-65%. Relative to other methods, card conversion was **0.41x** its level in the 14 days either side. Of 1,887 card checkouts, 499 became orders; at the normal 64.0% rate that is about **709 lost orders** (733 `processor_unavailable` failures), roughly **$25,000** of order value at the $35.24 average card order. Orders recovered on Aug 29. Accept 0.35x-0.50x and 580-850 lost orders.
- **Evidence:** H4-card-processor-incident; Funnels `checkout started` → `order placed` by `payment_method`, daily, joined to `payment_gateway_daily`; `payment failed` by `decline_code`; `-- STORY H4` and `-- EVAL Q5`.
- **Context needed:** 02-timeline.md (incident dates; Paylane is the card processor), 04-metrics-and-tables.md (`payment_gateway_daily`).
- **Grading:** must name the card processor incident and split by payment method. Wrong: "demand fell" or blaming weather or the fee change; counting all payment methods as affected.

### Q6 — Should we ship Smart Add-ons?
- **Prompt:** "Is the Smart Add-ons test working? Should we ship it?"
- **Type:** funnel
- **Answer:** Yes. After Jul 28 the Smart Add-ons arm orders **2.79 items per order vs 2.40 in Control (+0.38)** and **$27.90 vs $25.70 subtotal (+$2.21)**. Before Jul 28 the same customers ordered 2.37 vs 2.38 items, so the pre-test adjusted lift is **+0.39 items** and **+$2.19 subtotal per order**. Raw and adjusted lifts agree because the arms are balanced in customers (4,300 Control vs 4,409 Smart Add-ons exposed) and in household mix (single households 42.2% vs 42.4%; items per order follow household size, so a household skew would open a gap between the raw and adjusted lifts). Suggestions were added 7,621 times at about $5.47 each. Checkout conversion is not meaningfully different (64.3% in both arms; Q7). Recommend shipping. Accept an items lift of 0.3-0.5 and a subtotal lift of $1.2-2.5, with conversion flat.
- **Evidence:** H5-smart-addons-experiment; Insights `order placed` average `items_count` and `subtotal_usd` by `Experiment: Smart Add-ons`, Jul 28 - Oct 1 vs Jun 4 - Jul 27 (or the Experiments report on `$experiment_started`); `-- STORY H5` and `-- EVAL Q6`.
- **Context needed:** 02-timeline.md (test start, arms), 03-event-dictionary.md (`added_from`, `items_count`).
- **Grading:** must compare arms after the start and check conversion. Full credit for the raw or the adjusted lift; extra credit for checking the pre-test baseline. Wrong: comparing customers who used a suggestion against everyone else (selection); including orders before Jul 28.

### Q7 — Does Smart Add-ons hurt conversion?
- **Prompt:** "Our designers worry the add-on suggestions slow people down at checkout. Did Smart Add-ons lower checkout conversion?"
- **Type:** null-hypothesis
- **Answer:** No meaningful effect. Per-checkout conversion after Jul 28: Control **64.34%** (29,689 checkouts) vs Smart Add-ons **64.34%** (29,979), z = -0.01 (p ≈ 0.99). No split comes near significance: iOS 64.3% vs 64.2% (z = -0.10), Android 64.5% vs 64.5% (z = 0.08), non-Pass 61.8% vs 62.0% (z = 0.40), Pass 71.4% vs 71.0% (z = -0.46, p ≈ 0.65). Accept "no significant difference" with numbers within ±1.5 points.
- **Evidence:** H5-smart-addons-experiment (second assertion); Funnels `checkout started` → `order placed`, hold `order_id`, by arm; `-- EVAL Q7`.
- **Context needed:** 02-timeline.md (test start), 04-metrics-and-tables.md (checkout conversion).
- **Grading:** must answer "no" with a test or interval. Wrong: claiming a drop from the Pass split alone; using unique-customer conversion.

### Q8 — Which paid channel has the cheapest customers?
- **Prompt:** "Which paid channel gives us the cheapest new customers?"
- **Type:** external-join
- **Answer:** Per signup, coupon affiliates: window spend from `marketing_spend_daily` divided by Mixpanel signups is **$9.01 coupon affiliates** (940 signups, $8,466), **$17.95 paid social** (927, $16,641), **$26.38 paid search** (720, $18,990). But coupon-site customers come back far less often (Q9), so **per repeat customer coupon affiliates cost $33.35 vs $34.97 for paid social (0.95x)** and $51.56 for paid search. Networks over-claim signups (e.g. coupon partners claim 1,089 vs 940), so cost per network-reported signup understates CAC. Accept coupon ≈ 0.31-0.38x of paid search per signup and coupon ≈ paid social per repeat customer (0.85-1.15x).
- **Evidence:** H6-channel-economics; Insights `account created` by `acquisition_channel` joined to `marketing_spend_daily.spend_usd`; Funnels `order delivered` → `order placed`, 30-day window, new customers, Jun 4 - Aug 31, by channel; `-- STORY H6` and `-- EVAL Q8`.
- **Context needed:** 04-metrics-and-tables.md (CAC uses Mixpanel signups; table columns), 01-business.md (channels, DEAL15).
- **Grading:** must join spend to Mixpanel signups and go beyond cost per signup. Wrong: using `network_reported_signups` as the denominator; stopping at "coupon affiliates are 3x cheaper".

### Q9 — Do coupon-site customers stick around?
- **Prompt:** "Are customers from coupon and deal sites as loyal as customers from other channels?"
- **Type:** retention
- **Answer:** No. Of new customers whose first order was delivered by Aug 31, **40.9%** of coupon-affiliate customers ordered again within 30 days vs **75.6%** for all other channels (**0.54x**). By channel: organic 76.8%, paid search 77.5%, paid social 74.0%, referral 73.1%, coupon affiliates 40.9% (470 first orders). First-order rates are similar across channels (79-81% of signups through Aug 31); the gap opens after the discounted first order. Accept 0.40x-0.65x.
- **Evidence:** H6-channel-economics; Funnels `order delivered` → `order placed`, 30-day window, cohort "did `account created`" in the window, date range Jun 4 - Aug 31, breakdown `acquisition_channel` (a first-time-ever filter on step 1 gives the same rates); `-- EVAL Q9`.
- **Context needed:** 01-business.md (coupon affiliates, DEAL15), 04-metrics-and-tables.md (repeat rate).
- **Grading:** must compare repeat behavior by channel for new customers with complete windows (first deliveries through Aug 31). Wrong: comparing total orders per customer without accounting for signup date; including September first deliveries (incomplete windows lower every channel's rate).

### Q10 — What makes a Pass trial convert?
- **Prompt:** "What predicts whether a Forkfly Pass free trial turns into a paid membership?"
- **Type:** segmentation
- **Answer:** Ordering at least twice during the trial. Of 1,889 trials that started in the window and finished by Oct 1, **64.8%** of trials with **2+ orders** converted vs **30.8%** with 0-1 orders (2.1x). By count: 0 orders 34.0%, 1 order 29.8%, 2 orders 66.8%, 3 orders 66.2%, 4+ orders 60.9%: a step at the second order, flat after. Overall 49.9% convert; 56.2% of trials reach 2 orders. Accept a step between 1 and 2 orders with rates of about 0.6-0.7 vs 0.25-0.35.
- **Evidence:** H7-pass-trial-two-orders; Insights `pass trial ended`, share `outcome = converted`, breakdown `orders_during_trial`; `-- STORY H7` and `-- EVAL Q10`.
- **Context needed:** 03-event-dictionary.md (`pass trial ended` properties), 01-business.md (trial rules).
- **Grading:** must find the threshold at 2 orders (not "more is always better"). Wrong: including trials still running at the end of the window; using Pass status on later orders as the outcome. Including the trials that began before June 4 (their `pass trial ended` arrives Jun 4-17 with no `pass trial started`) (192 trials) moves the rates by under a point (30.6% vs 65.0%) and is acceptable if stated; their `orders_during_trial` includes days before the data starts (03-event-dictionary.md).

### Q11 — Does the $15 free-delivery minimum change baskets?
- **Prompt:** "Pass members get free delivery from $15. Does that change what they order?"
- **Type:** segmentation
- **Answer:** Yes, Pass baskets pile up just above $15. Share of orders with a subtotal of $10-14.99: **5.5% of Pass orders vs 13.0% of non-Pass orders**; $15-19.99: **28.0% vs 20.9%**. Among $10-19.99 orders, **16.4%** of Pass orders are under $15 vs **38.4%** of non-Pass orders (**0.43x**). Below $10 and above $20 the two look alike. 92.6% of Pass orders get free delivery. Accept a clear dip below $15 and pile-up above it for Pass orders (ratio 0.3-0.5).
- **Evidence:** H8-pass-free-delivery-minimum; Insights `order placed`, filter `subtotal_usd` 10-20, breakdown `pass_status` × subtotal buckets; `-- STORY H8` and `-- EVAL Q11`.
- **Context needed:** 01-business.md (Pass free-delivery minimum), 03-event-dictionary.md (`pass_status` at event time).
- **Grading:** must compare the distribution around $15 by Pass status at order time. Wrong: comparing average subtotal only ($26.62 vs $26.21, nearly the same); using the current profile Pass status instead of the event's.

### Q12 — Did the August fee increase cost us orders?
- **Prompt:** "We raised the service fee for non-Pass orders in August. Did it hurt orders, and was it worth it?"
- **Type:** trend
- **Answer:** It cost orders. Per-checkout conversion for non-Pass customers fell from **71.4% before Aug 11 to 60.7% after**, while Pass customers (fee unchanged) went from 71.5% to 72.7%; difference-in-differences **0.84** (−16%; card-incident days excluded). Service-fee revenue per non-Pass checkout still rose from **$1.81 to $2.38** (+31%) because each order pays more ($2.54 → $3.92 per order), but order value per non-Pass checkout fell from **$24.45 to $22.18** (−9%), so restaurants and couriers lose volume and the gain depends on how much commission is lost. Accept a DiD of 0.77-0.93 and naming Pass as the control.
- **Evidence:** H9-service-fee-change; Funnels `checkout started` → `order placed` by `pass_status`, before vs after Aug 11; `-- STORY H9` and `-- EVAL Q12`.
- **Context needed:** 02-timeline.md (fee change, Pass unchanged), 01-business.md (fees, commission not in data).
- **Grading:** must use Pass as a control or otherwise separate the fee effect from trends and the incident. Wrong: raw order counts before vs after (growth and Order Again push orders up); including Aug 25-28 without noting the card incident.

### Q13 — Is Order Again working?
- **Prompt:** "We launched Order Again in July. Is it working?"
- **Type:** funnel
- **Answer:** Yes. Visits that use Order Again reach `order placed` in a median **5.6 minutes vs 16.1 minutes** for browsing visits (0.35x), and among customers who have used it, Order Again visits end in an order **58.5%** of the time vs **26.1%** for their other visits (**2.2x**). It is not a niche feature (Q14). Accept a time ratio of 0.3-0.4 and a conversion ratio of 1.9-2.5.
- **Evidence:** H10-order-again-launch; speed: Funnels `app opened` → `order placed`, Totals, 60-minute window, median time to convert, breakdown step 2 `entry_point`, Jul 7 - Oct 1. Visit order rate: Insights, cohort "did `reorder tapped`", Jul 7 - Oct 1, totals A = `order placed` with `entry_point` = reorder (20,516), B = `reorder tapped` (35,051; one per Order Again visit), C = `order placed` with other entry points (25,318), D = `app opened` (132,230); formula (A / B) / (C / (D − B)). `-- STORY H10` and `-- EVAL Q13`.
- **Context needed:** 02-timeline.md (launch), 03-event-dictionary.md (`reorder tapped`, `entry_point`).
- **Grading:** must compare speed or conversion of Order Again visits against browsing visits after launch. Wrong: comparing users who used it against users who never did (heavier customers use it more); using dates before Jul 7.

### Q14 — How fast did Order Again catch on?
- **Prompt:** "What share of our orders now come through Order Again, and how quickly did customers pick it up?"
- **Type:** trend
- **Answer:** Share of orders with `entry_point = reorder` by week: 7.9% in the launch week (Jul 6), 24.3% (Jul 13), 38.0% (Jul 20), 45.8% (Jul 27), then a plateau of 45-48% from August; **46.9% of September orders**. **7,010 customers** used it, 83% of customers who ordered after launch. Accept a ramp over about three weeks to roughly 42-48%.
- **Evidence:** H10-order-again-launch (adoption); Insights `order placed`, weekly, breakdown `entry_point`; `-- EVAL Q14`.
- **Context needed:** 02-timeline.md (launch date, eligibility).
- **Grading:** must show the ramp then plateau and a September share. Wrong: "adoption keeps growing"; counting `reorder tapped` events without checking they became orders.

### Q15 — Does the sign-up method matter?
- **Prompt:** "Do customers who sign up with email place a first order less often than people who use Apple or Google sign-in? Should we push social sign-in harder?"
- **Type:** null-hypothesis
- **Answer:** No meaningful difference. Of new customers who signed up through Aug 31, **79.9%** of Apple sign-ups (1,230), **80.5%** of email sign-ups (856), and **79.3%** of Google sign-ups (1,066) placed an order; each method vs the other two |z| ≤ 0.6. The splits agree: iOS 80.1% / 81.2% / 81.0% and Android 79.7% / 79.7% / 77.2% (Apple / email / Google; every |z| < 1.2); by signup month every |z| < 1.3 (first-order rates fall from about 85% for June sign-ups to about 73% for August sign-ups for every method, because later sign-ups have less time to order); by channel every |z| < 1.3 with no consistent direction. Pushing social sign-in would not raise first orders. Accept "no significant difference" with rates within ±2 points.
- **Evidence:** Insights or Funnels `account created` → `order placed` (uniques), new customers who signed up Jun 4 - Aug 31, breakdown `signup_method`; `-- EVAL Q15`.
- **Context needed:** 01-business.md (sign-up options), 03-event-dictionary.md (`signup_method`), 04-metrics-and-tables.md (first-order rate).
- **Grading:** must answer "no" with numbers and a test or interval, using sign-ups with time to order. Wrong: comparing sign-up counts or order counts (Apple has the most sign-ups); including September sign-ups without noting the shorter time; reading a single channel sub-split as a finding.

### Q16 — How big is Forkfly Pass?
- **Prompt:** "Give me a quick picture of Forkfly Pass this summer: members, trials, and how much of our business it is."
- **Type:** context
- **Answer:** At the end of the window **1,791 customers are paid members and 251 are on a trial**. Pass orders were **28.5%** of all orders in the window, rising from 23.3% in June to 32.5% in September. 30,544 trial offers were shown, **2,140 trials started** in the window and 2,081 trials ended (including trials that began in late May); 240 members cancelled. Trial conversion is in Q10. Accept numbers within 3%.
- **Evidence:** H7/H8 context; profiles `pass_status`; Insights `order placed` by `pass_status`; `-- EVAL Q16`.
- **Context needed:** 01-business.md (Pass), 03-event-dictionary.md (`pass_status` at event time).
- **Grading:** must use event-time `pass_status` for order share and include trial customers as Pass. Wrong: using profile Pass status for historical orders.

### Q17 — Is acquisition growing?
- **Prompt:** "How many new customers are we getting each week, and from where?"
- **Type:** trend
- **Answer:** Steady, not growing: about **230-265 signups per full week** (4,222 in the window). Mix: organic 28.1%, coupon affiliates 22.3%, paid social 22.0%, paid search 17.1%, referral 10.6%. 79.9% of customers who signed up by Aug 31 placed an order. Total orders still grew (about 2,450-2,700 a week in the full June weeks to about 4,100-4,450 in the weeks starting Aug 31 to Sep 21) because new customers add to the base and Order Again lifted ordering. Accept a flat signup trend.
- **Evidence:** Insights `account created`, weekly, breakdown `acquisition_channel`; `-- EVAL Q17`.
- **Context needed:** 01-business.md (channels), 02-timeline.md (budgets steady).
- **Grading:** must separate signups from orders. Wrong: reading order growth as acquisition growth.

### Q18 — Where do customers drop between opening the app and ordering?
- **Prompt:** "Walk me through our ordering funnel. Where are we losing people?"
- **Type:** open-ended
- **Answer:** The ordering-visit funnel (`app opened` → `restaurant viewed` → `item added to cart` → `checkout started` → `order placed`, Totals, 1-hour window; 189,633 visits) converts **100% → 70.6% → 41.6% → 32.1% → 21.7%**. Read it with Order Again in mind: Order Again visits (18.5% of all visits in the window; the feature exists from Jul 7) never send `restaurant viewed` or `item added to cart`, so this funnel counts them as stopping after `app opened`. Split out:
  - **Browse visits** (81.5% of visits): 85.8% view a restaurant (the rest stop on the home feed), 50.5% build a cart, 39.1% reach checkout, 26.5% place an order.
  - **Order Again visits** (Order Again funnel `reorder tapped` → `checkout started` → `order placed`, 35,051 taps): 90.1% reach checkout and 59.5% place an order.
  The biggest drop is from restaurant page to cart (browsing without choosing). Checkout → order is **66.6%**. At checkout, the main losses are long quoted delivery times (Q4), the non-Pass fee increase from Aug 11 (Q12), and payment failures (2,024: an everyday rate of about 2.1%, plus the Aug 25-28 card incident, Q5). Accept the plain-funnel stage rates within 2 points. Also accept browse-only rates within 2 points when the analyst says Order Again visits are excluded or reported separately. Require at least two checkout drivers.
- **Evidence:** H3, H4, H9, H10; Funnels `app opened` → `restaurant viewed` → `item added to cart` → `checkout started` → `order placed`, Totals, 1-hour window (Mixpanel shows about 181,100 step-1 entries, because an `app opened` inside a live 1-hour attempt does not start a new one; the stage rates match within 0.1 point); Order Again funnel `reorder tapped` → `checkout started` → `order placed`, Totals, 1-hour window; `-- EVAL Q18` (first query: plain funnel; second: browse vs Order Again visits; third: Order Again funnel).
- **Context needed:** 03-event-dictionary.md (funnels, Order Again visits), 04-metrics-and-tables.md (visit and checkout conversion).
- **Grading:** must give stage rates and name checkout drivers backed by data. Credit an answer that notices Order Again visits drop out of the plain funnel at step 2 and reports them separately. Wrong: a unique-customer funnel over the whole window (nearly everyone orders at some point); reading the 29% drop at step 2 as all lost browsers without accounting for Order Again visits; counting one `reorder tapped` as both the restaurant step and the cart step (a Mixpanel funnel cannot match one event to two steps). Platform is not a checkout driver: iOS and Android checkout conversion are 66.7% vs 66.5% (z = 0.5, `-- EVAL Q15` context query); an answer that calls a platform gap a key finding is wrong.

### Q19 — What should we worry about this quarter?
- **Prompt:** "What should leadership worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names several of these, with numbers: (1) **late deliveries on rainy days** (31.6% of rainy-day orders 20+ minutes late vs 4.9% on dry days; Q3) and **new customers lost after a late first delivery** (repeat 42.9% vs 70.6% at the 20-minute threshold; Q1), so courier supply on rainy days and more honest quotes matter; (2) **coupon affiliates** look cheap but deliver about half the repeat rate of other channels, so they cost about the same per repeat customer as paid social (Q8, Q9); (3) the **August fee increase** cut non-Pass checkout conversion by about 16% (Q12); (4) **quoted delivery times over 45 minutes** (22% of checkouts) convert far worse (Q4); (5) dependence on one card processor (Q5, about 710 lost orders in four days). Positives: Order Again (about 47% of orders, faster and better converting), Smart Add-ons ready to ship, Pass trials convert well once customers order twice. Overall late share (20+ minutes) is about 10-12% each full month. Grade on use of evidence; any three supported points pass.
- **Evidence:** H1, H2, H3, H4, H6, H9, H10; `-- EVAL Q19` plus the queries cited.
- **Context needed:** all guides.
- **Grading:** must be grounded in data. Wrong: generic advice; claims with no numbers; naming an iOS vs Android gap as a risk (checkout conversion 66.7% vs 66.5%, z = 0.5: no supported platform difference).

### Q20 — Which cities have the worst on-time performance?
- **Prompt:** "Which cities are worst for late deliveries? Should we replace the market manager in the worst one?"
- **Type:** external-join
- **Answer:** Miami is worst (**16.5%** of deliveries 20+ minutes late, the company's late threshold), then Atlanta 12.3%, Boston 11.2%, New York 11.1%, Denver 11.0%, Chicago 10.9%, Seattle 7.9%, Austin 7.7%. The ranking follows the weather: 44.3% of Miami's orders fall on rainy days vs 10-13% in Austin and Seattle. On dry days every city is 4.3-5.6% late, so the city gap is rain, not management. Accept Miami worst and the rain explanation; recommend courier supply for rainy days rather than a personnel change.
- **Evidence:** H2-rainy-days; Insights `order delivered` late share by `city`, joined to `market_ops_daily`; `-- EVAL Q20`.
- **Context needed:** 02-timeline.md (weather note), 04-metrics-and-tables.md (late definition, `market_ops_daily`).
- **Grading:** must control for weather before blaming a city. Wrong: "replace Miami's manager" without checking dry-day performance.
