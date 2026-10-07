# Forkfly (food-delivery) — 20-question eval

- **Data:** `data/verify-food-delivery` (full fidelity: 10,000 customers, 9,978 with events, 4,163 new signups, 809,221 events, 42,394 orders, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query (or the `-- STORY` query it names) in `dungeons/vertical/food-delivery/food-delivery.sql` on that data.
- **Stories:** ids refer to the `stories` export in `food-delivery.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Do new customers come back after a late first order?
- **Prompt:** "Do new customers come back after their first order? Does a late first delivery change that?"
- **Type:** retention
- **Answer:** Yes, lateness matters a lot. Of new customers whose first order was delivered by Aug 31, **63.2%** of those delivered on time (under 15 minutes late) ordered again within 30 days vs **39.5%** of those delivered **15+ minutes late (0.62x)**. By lateness bucket: early 64.6%, 0-9 min late 66.4%, 10-14 min late 53.1%, 15-24 min late 37.6%, 25+ min late 45.7% (only 92 customers, so the 15-24 and 25+ buckets are not meaningfully different). Repeat rates hold while the first order is early or a little late, start to slip at 10-14 minutes, and are far lower once it is 15+ minutes late. 21.7% of first deliveries (398 of 1,833) were 15+ minutes late. Accept a late/on-time ratio of 0.55-0.72.
- **Evidence:** H1-late-first-order; Funnels `order delivered` → `order placed`, 30-day window, cohort "did account created" in the window, date range Jun 4 - Aug 31, breakdown step 1 `minutes_late` (< 15, ≥ 15); `-- STORY H1` and `-- EVAL Q1`.
- **Context needed:** 04-metrics-and-tables.md (late = 15+ minutes, 30-day repeat definition), 03-event-dictionary.md (`minutes_late`).
- **Grading:** must restrict to new customers and complete 30-day windows and give both rates. Reward the size of the gap between late and on-time first orders and a bucketed curve that shows repeat rates holding for small delays and falling for large ones. Do not give credit just for naming 15 minutes as the cutoff; that is the company's KPI definition in 04-metrics-and-tables.md, not a finding. Wrong: using all customers (established customers' first order in the window is not their first ever); counting first orders from September (window incomplete); "lateness doesn't matter".

### Q2 — Do we sell more on rainy days?
- **Prompt:** "Does the weather affect our order volume? Do we get more orders when it rains?"
- **Type:** external-join
- **Answer:** Yes. Joining orders to `market_ops_daily` by city and UTC date, a rainy city-day (precipitation ≥ 4 mm; 188 of 960 city-days) has **1.37x** the orders of that city's average dry day. It holds in every city: Miami 1.47x (54 rainy days), Atlanta 1.33x (27), Boston 1.39x (22), New York 1.41x (22), Chicago 1.26x (21), Denver 1.29x (21), Seattle 1.54x (11), Austin 1.15x (10). Checkout conversion is about the same in rain (66.4% on rainy days vs 66.8% on dry days); the extra orders come from more visits. Accept 1.25x-1.55x pooled.
- **Evidence:** H2-rainy-days; Insights `order placed` daily by `city`, joined to `market_ops_daily.precipitation_mm` on date + city; `-- STORY H2` and `-- EVAL Q2`.
- **Context needed:** 04-metrics-and-tables.md (`market_ops_daily`, rainy-day definition), 02-timeline.md (weather note).
- **Grading:** must join weather by city and date (not national averages) and compare within city. Wrong: pooling all cities without normalizing (Miami's many rainy days mix city size into the answer); "no effect".

### Q3 — Why are deliveries late on some days?
- **Prompt:** "Some days our late-delivery numbers are terrible. What's going on?"
- **Type:** external-join
- **Answer:** Rain. On rainy city-days deliveries average **14.9 minutes late vs 3.0 on dry days (+11.9 min)**, and **51.5%** of rainy-day orders arrive 15+ minutes late vs **12.5%** on dry days. Couriers are stretched: `market_ops_daily` shows **3.09 orders per active courier on rainy days vs 2.38 on dry days**. Within each city, courier supply rises only slightly on rainy days (`active_couriers` about 3% above the city's dry-day average) while dispatched orders rise about 34% (Mixpanel orders about 37%, Q2). Support contacts follow: 15.0% of rainy-day orders vs 6.4% of dry-day orders. Quoted ETAs at checkout do not rise on rainy days, so customers are promised the usual time. Accept +10 to +14 minutes and naming rain plus courier strain.
- **Evidence:** H2-rainy-days; Insights `order delivered` average `minutes_late` by day and city joined to `market_ops_daily`; `-- STORY H2` (second query) and `-- EVAL Q3`.
- **Context needed:** 04-metrics-and-tables.md (`market_ops_daily`, on-time definition), 03-event-dictionary.md (`minutes_late`, `quoted_eta_mins`).
- **Grading:** must link lateness to weather with the warehouse table and size it. Wrong: blaming specific restaurants or cuisines; blaming one city without checking weather (see Q20).

### Q4 — Does the quoted delivery time affect checkout?
- **Prompt:** "Does the delivery time we show at checkout affect whether people order? Is there a point where they give up?"
- **Type:** funnel
- **Answer:** Yes, there is a cliff around 45 minutes. Checkout → order (per checkout, `order_id` held, 1-hour window): quotes under 30 min 76.7%, 30-39 min 74.5%, 40-45 min 64.4%, 46-50 min 49.4%, 51-60 min 40.7%, over 60 min 39.4%. Quotes of 45 minutes or less convert **73.1%** vs **43.9%** for longer quotes (**0.60x**). 22.0% of checkouts are quoted over 45 minutes. Accept a decline that steepens in the 40-50 minute range and a ≤45 vs >45 ratio of 0.54-0.66.
- **Evidence:** H3-quoted-eta-threshold; Funnels `checkout started` → `order placed`, Totals, hold `order_id`, 1-hour window, breakdown `quoted_eta_mins` buckets; `-- STORY H3` and `-- EVAL Q4`.
- **Context needed:** 03-event-dictionary.md (`quoted_eta_mins`), 04-metrics-and-tables.md (checkout conversion).
- **Grading:** must use per-checkout conversion and find the threshold region. Wrong: a unique-customer funnel (most customers convert at least once, which hides the effect); "linear decline" with no threshold region.

### Q5 — What happened to orders in late August?
- **Prompt:** "Orders dipped for a few days at the end of August. What happened, and how many orders did we lose?"
- **Type:** external-join
- **Answer:** The **Paylane card processor incident, Aug 25-28** (timeline). `payment_gateway_daily` shows card as `major_outage` on those four days with decline rates of 0.60-0.62 (vs about 0.02 normally); other methods were operational. Card checkout conversion fell to 23.2-28.9% a day vs about 63% normally, while Apple Pay, Google Pay, and PayPal held at 63-69%. Relative to other methods, card conversion was **0.39x** its level in the 14 days either side. Of 1,173 card checkouts, 297 became orders; at the normal 62.7% rate that is about **439 lost orders** (444 `processor_unavailable` failures), roughly **$15,800** of order value at the $35.97 average card order. Orders recovered on Aug 29. Accept 0.35x-0.50x and 350-550 lost orders.
- **Evidence:** H4-card-processor-incident; Funnels `checkout started` → `order placed` by `payment_method`, daily, joined to `payment_gateway_daily`; `payment failed` by `decline_code`; `-- STORY H4` and `-- EVAL Q5`.
- **Context needed:** 02-timeline.md (incident dates; Paylane is the card processor), 04-metrics-and-tables.md (`payment_gateway_daily`).
- **Grading:** must name the card processor incident and split by payment method. Wrong: "demand fell" or blaming weather or the fee change; counting all payment methods as affected.

### Q6 — Should we ship Smart Add-ons?
- **Prompt:** "Is the Smart Add-ons test working? Should we ship it?"
- **Type:** funnel
- **Answer:** Yes. After Jul 28 the Smart Add-ons arm orders **2.81 items per order vs 2.41 in Control (+0.40)** and **$28.06 vs $25.96 subtotal (+$2.11)**. Before Jul 28 the same customers ordered 2.40 vs 2.39 items, so the pre-test adjusted lift is **+0.39 items** and **+$2.20 subtotal per order**. Raw and adjusted lifts agree because the arms are balanced in customers (4,030 vs 4,058 exposed) and in household mix (single households 42.9% vs 42.5%; items per order follow household size, so a household skew would open a gap between the raw and adjusted lifts). Suggestions were added 5,258 times at about $5.51 each. Checkout conversion is not meaningfully different (63.8% vs 63.7%; Q7). Recommend shipping. Accept an items lift of 0.3-0.5 and a subtotal lift of $1.2-2.5, with conversion flat.
- **Evidence:** H5-smart-addons-experiment; Insights `order placed` average `items_count` and `subtotal_usd` by `Experiment: Smart Add-ons`, Jul 28 - Oct 1 vs Jun 4 - Jul 27 (or the Experiments report on `$experiment_started`); `-- STORY H5` and `-- EVAL Q6`.
- **Context needed:** 02-timeline.md (test start, arms), 03-event-dictionary.md (`added_from`, `items_count`).
- **Grading:** must compare arms after the start and check conversion. Full credit for the raw or the adjusted lift; extra credit for checking the pre-test baseline. Wrong: comparing customers who used a suggestion against everyone else (selection); including orders before Jul 28.

### Q7 — Does Smart Add-ons hurt conversion?
- **Prompt:** "Our designers worry the add-on suggestions slow people down at checkout. Did Smart Add-ons lower checkout conversion?"
- **Type:** null-hypothesis
- **Answer:** No meaningful effect. Per-checkout conversion after Jul 28: Control **63.74%** (20,307 checkouts) vs Smart Add-ons **63.82%** (20,293), z = 0.16 (p ≈ 0.87). No split reaches significance: iOS 63.7% vs 63.5% (z = −0.25), Android 63.9% vs 64.4% (z = 0.59), non-Pass 61.8% vs 62.0% (z = 0.38), Pass 70.5% vs 69.8% (z = −0.78, p ≈ 0.44). Accept "no significant difference" with numbers within ±1.5 points.
- **Evidence:** H5-smart-addons-experiment (second assertion); Funnels `checkout started` → `order placed`, hold `order_id`, by arm; `-- EVAL Q7`.
- **Context needed:** 02-timeline.md (test start), 04-metrics-and-tables.md (checkout conversion).
- **Grading:** must answer "no" with a test or interval. Wrong: claiming a drop from the Pass split alone; using unique-customer conversion.

### Q8 — Which paid channel has the cheapest customers?
- **Prompt:** "Which paid channel gives us the cheapest new customers?"
- **Type:** external-join
- **Answer:** Per signup, coupon affiliates: window spend from `marketing_spend_daily` divided by Mixpanel signups is **$8.92 coupon affiliates** (956 signups, $8,531), **$17.99 paid social** (923, $16,600), **$25.99 paid search** (740, $19,232). But coupon-site customers come back far less often (Q9), so **per repeat customer coupon affiliates cost $42.78 vs $45.86 for paid social (0.93x)** and $69.20 for paid search. Networks over-claim signups (e.g. coupon partners claim 1,100 vs 956), so cost per network-reported signup understates CAC. Accept coupon ≈ 0.31-0.38x of paid search per signup and coupon ≈ paid social per repeat customer (0.85-1.15x).
- **Evidence:** H6-channel-economics; Insights `account created` by `acquisition_channel` joined to `marketing_spend_daily.spend_usd`; Funnels `order delivered` → `order placed`, 30 days, by channel; `-- STORY H6` and `-- EVAL Q8`.
- **Context needed:** 04-metrics-and-tables.md (CAC uses Mixpanel signups; table columns), 01-business.md (channels, DEAL15).
- **Grading:** must join spend to Mixpanel signups and go beyond cost per signup. Wrong: using `network_reported_signups` as the denominator; stopping at "coupon affiliates are 3x cheaper".

### Q9 — Do coupon-site customers stick around?
- **Prompt:** "Are customers from coupon and deal sites as loyal as customers from other channels?"
- **Type:** retention
- **Answer:** No. Of new customers whose first order was delivered by Aug 31, **36.2%** of coupon-affiliate customers ordered again within 30 days vs **64.4%** for all other channels (**0.56x**). By channel: organic 64.3%, paid search 64.6%, paid social 65.5%, referral 61.7%, coupon affiliates 36.2% (414 first orders). First-order rates are similar across channels (71-74% of signups through Aug 31); the gap opens after the discounted first order. Accept 0.40x-0.65x.
- **Evidence:** H6-channel-economics; Funnels `order delivered` → `order placed`, 30-day window, new customers, breakdown `acquisition_channel`; `-- EVAL Q9`.
- **Context needed:** 01-business.md (coupon affiliates, DEAL15), 04-metrics-and-tables.md (repeat rate).
- **Grading:** must compare repeat behavior by channel for new customers with complete windows. Wrong: comparing total orders per customer without accounting for signup date.

### Q10 — What makes a Pass trial convert?
- **Prompt:** "What predicts whether a Forkfly Pass free trial turns into a paid membership?"
- **Type:** segmentation
- **Answer:** Ordering at least twice during the trial. Of 1,354 trials that started in the window and finished by Oct 1, **64.4%** of trials with **2+ orders** converted vs **30.1%** with 0-1 orders (2.1x). By count: 0 orders 26.0%, 1 order 31.8%, 2 orders 64.4%, 3 orders 65.4%, 4+ orders 62.8%: a step at the second order, flat after. Overall 46.2% convert; 47.1% of trials reach 2 orders. Accept a step between 1 and 2 orders with rates of about 0.6-0.7 vs 0.25-0.35.
- **Evidence:** H7-pass-trial-two-orders; Insights `pass trial ended`, share `outcome = converted`, breakdown `orders_during_trial`; `-- STORY H7` and `-- EVAL Q10`.
- **Context needed:** 03-event-dictionary.md (`pass trial ended` properties), 01-business.md (trial rules).
- **Grading:** must find the threshold at 2 orders (not "more is always better"). Wrong: including trials still running at the end of the window; using Pass status on later orders as the outcome. Including the trials that began before June 4 (their `pass trial ended` arrives Jun 4-17 with no `pass trial started`) shifts the rates by about a point and is acceptable if stated; their `orders_during_trial` includes days before the data starts (03-event-dictionary.md).

### Q11 — Does the $15 free-delivery minimum change baskets?
- **Prompt:** "Pass members get free delivery from $15. Does that change what they order?"
- **Type:** segmentation
- **Answer:** Yes, Pass baskets pile up just above $15. Share of orders with a subtotal of $10-14.99: **4.5% of Pass orders vs 13.1% of non-Pass orders**; $15-19.99: **28.0% vs 20.5%**. Among $10-19.99 orders, **13.8%** of Pass orders are under $15 vs **39.1%** of non-Pass orders (**0.35x**). Below $10 and above $20 the two look alike. 93.8% of Pass orders get free delivery. Accept a clear dip below $15 and pile-up above it for Pass orders (ratio 0.3-0.5).
- **Evidence:** H8-pass-free-delivery-minimum; Insights `order placed`, filter `subtotal_usd` 10-20, breakdown `pass_status` × subtotal buckets; `-- STORY H8` and `-- EVAL Q11`.
- **Context needed:** 01-business.md (Pass free-delivery minimum), 03-event-dictionary.md (`pass_status` at event time).
- **Grading:** must compare the distribution around $15 by Pass status at order time. Wrong: comparing average subtotal only ($27.07 vs $26.34, nearly the same); using the current profile Pass status instead of the event's.

### Q12 — Did the August fee increase cost us orders?
- **Prompt:** "We raised the service fee for non-Pass orders in August. Did it hurt orders, and was it worth it?"
- **Type:** trend
- **Answer:** It cost orders. Per-checkout conversion for non-Pass customers fell from **71.9% before Aug 11 to 60.5% after**, while Pass customers (fee unchanged) went from 71.6% to 71.5%; difference-in-differences **0.84** (−16%; card-incident days excluded). Service-fee revenue per non-Pass checkout still rose from **$1.83 to $2.40** (+31%) because each order pays more ($2.54 → $3.96 per order), but order value per non-Pass checkout fell from **$24.54 to $22.25** (−9%), so restaurants and couriers lose volume and the gain depends on how much commission is lost. Accept a DiD of 0.77-0.93 and naming Pass as the control.
- **Evidence:** H9-service-fee-change; Funnels `checkout started` → `order placed` by `pass_status`, before vs after Aug 11; `-- STORY H9` and `-- EVAL Q12`.
- **Context needed:** 02-timeline.md (fee change, Pass unchanged), 01-business.md (fees, commission not in data).
- **Grading:** must use Pass as a control or otherwise separate the fee effect from trends and the incident. Wrong: raw order counts before vs after (growth and Order Again push orders up); including Aug 25-28 without noting the card incident.

### Q13 — Is Order Again working?
- **Prompt:** "We launched Order Again in July. Is it working?"
- **Type:** funnel
- **Answer:** Yes. Visits that use Order Again reach `order placed` in a median **5.6 minutes vs 16.0 minutes** for browsing visits (0.35x), and among customers who have used it, Order Again visits end in an order **58.1%** of the time vs **26.3%** for their other visits (**2.2x**). It is not a niche feature (Q14). Accept a time ratio of 0.3-0.4 and a conversion ratio of 1.9-2.5.
- **Evidence:** H10-order-again-launch; speed: Funnels `app opened` → `order placed`, Totals, 60-minute window, median time to convert, breakdown step 2 `entry_point`, Jul 7 - Oct 1. Visit order rate: Insights, cohort "did `reorder tapped`", Jul 7 - Oct 1, totals A = `order placed` with `entry_point` = reorder (13,541), B = `reorder tapped` (23,327; one per Order Again visit), C = `order placed` with other entry points (16,984), D = `app opened` (87,960); formula (A / B) / (C / (D − B)). `-- STORY H10` and `-- EVAL Q13`.
- **Context needed:** 02-timeline.md (launch), 03-event-dictionary.md (`reorder tapped`, `entry_point`).
- **Grading:** must compare speed or conversion of Order Again visits against browsing visits after launch. Wrong: comparing users who used it against users who never did (heavier customers use it more); using dates before Jul 7.

### Q14 — How fast did Order Again catch on?
- **Prompt:** "What share of our orders now come through Order Again, and how quickly did customers pick it up?"
- **Type:** trend
- **Answer:** Share of orders with `entry_point = reorder` by week: 7.6% in the launch week (Jul 6), 21.4% (Jul 13), 36.6% (Jul 20), 43.3% (Jul 27), then a plateau of 44-48% from August; **46.2% of September orders**. **6,090 customers** used it, 79% of customers who ordered after launch. Accept a ramp over about three weeks to roughly 42-48%.
- **Evidence:** H10-order-again-launch (adoption); Insights `order placed`, weekly, breakdown `entry_point`; `-- EVAL Q14`.
- **Context needed:** 02-timeline.md (launch date, eligibility).
- **Grading:** must show the ramp then plateau and a September share. Wrong: "adoption keeps growing"; counting `reorder tapped` events without checking they became orders.

### Q15 — Is the Android app converting worse?
- **Prompt:** "Someone on the team thinks the Android checkout converts worse than iOS. Is that true?"
- **Type:** null-hypothesis
- **Answer:** No meaningful difference. Per-checkout conversion is **66.6% on iOS** (41,863 checkouts) vs **66.8% on Android** (21,717), z = 0.31 (p ≈ 0.76). Splits agree: non-Pass 65.4% vs 65.7% (z = 0.68), Pass 70.8% vs 70.5% (z = −0.40), before Aug 11 72.0% vs 71.3% (z = −1.34, p ≈ 0.18), after 61.4% vs 62.4% (z = 1.59, p ≈ 0.11); the two period splits point in opposite directions. The only platform-linked dip is the Aug 25-28 card incident, which hit Android a little harder because more Android customers pay by card. Accept "no significant difference".
- **Evidence:** Funnels `checkout started` → `order placed`, hold `order_id`, breakdown `platform`; `-- EVAL Q15`.
- **Context needed:** 01-business.md (payment methods by platform), 04-metrics-and-tables.md (checkout conversion).
- **Grading:** must answer "no" with numbers and a test. Wrong: reporting a gap from order counts (iOS has twice the customers).

### Q16 — How big is Forkfly Pass?
- **Prompt:** "Give me a quick picture of Forkfly Pass this summer: members, trials, and how much of our business it is."
- **Type:** context
- **Answer:** At the end of the window **1,473 customers are paid members and 213 are on a trial**. Pass orders were **26.0%** of all orders in the window, rising from 23.8% in June to 29.3% in September. 22,542 trial offers were shown, **1,567 trials started** in the window and 1,533 trials ended (including trials that began in late May); 279 members cancelled. Trial conversion is in Q10. Accept numbers within 3%.
- **Evidence:** H7/H8 context; profiles `pass_status`; Insights `order placed` by `pass_status`; `-- EVAL Q16`.
- **Context needed:** 01-business.md (Pass), 03-event-dictionary.md (`pass_status` at event time).
- **Grading:** must use event-time `pass_status` for order share and include trial customers as Pass. Wrong: using profile Pass status for historical orders.

### Q17 — Is acquisition growing?
- **Prompt:** "How many new customers are we getting each week, and from where?"
- **Type:** trend
- **Answer:** Steady, not growing: about **210-260 signups per full week** (4,163 in the window). Mix: organic 27.2%, coupon affiliates 23.0%, paid social 22.2%, paid search 17.8%, referral 9.9%. 72.8% of customers who signed up by Aug 31 placed an order. Total orders still grew (about 1,850-2,100 a week in June to about 2,700-2,900 in September) because new customers add to the base and Order Again lifted ordering. Accept a flat signup trend.
- **Evidence:** Insights `account created`, weekly, breakdown `acquisition_channel`; `-- EVAL Q17`.
- **Context needed:** 01-business.md (channels), 02-timeline.md (budgets steady).
- **Grading:** must separate signups from orders. Wrong: reading order growth as acquisition growth.

### Q18 — Where do customers drop between opening the app and ordering?
- **Prompt:** "Walk me through our ordering funnel. Where are we losing people?"
- **Type:** open-ended
- **Answer:** The ordering-visit funnel (`app opened` → `restaurant viewed` → `item added to cart` → `checkout started` → `order placed`, Totals, 1-hour window; 134,366 visits) converts **100% → 71.0% → 41.5% → 32.2% → 21.9%**. Read it with Order Again in mind: Order Again visits (17.4% of all visits in the window; the feature exists from Jul 7) never send `restaurant viewed` or `item added to cart`, so this funnel counts them as stopping after `app opened`. Split out:
  - **Browse visits** (82.6% of visits): 85.5% view a restaurant (the rest stop on the home feed), 49.9% build a cart, 38.8% reach checkout, 26.4% place an order.
  - **Order Again visits** (Order Again funnel `reorder tapped` → `checkout started` → `order placed`, 23,327 taps): 90.2% reach checkout and 58.7% place an order.
  The biggest drop is from restaurant page to cart (browsing without choosing). Checkout → order is **66.7%**. At checkout, the main losses are long quoted delivery times (Q4), the non-Pass fee increase from Aug 11 (Q12), and payment failures (1,328: an everyday rate of about 2.0%, plus the Aug 25-28 card incident, Q5). Accept the plain-funnel stage rates within 2 points. Also accept browse-only rates within 2 points when the analyst says Order Again visits are excluded or reported separately. Require at least two checkout drivers.
- **Evidence:** H3, H4, H9, H10; Funnels `app opened` → `restaurant viewed` → `item added to cart` → `checkout started` → `order placed`, Totals, 1-hour window (Mixpanel shows about 130,400 step-1 entries, because an `app opened` inside a live 1-hour attempt does not start a new one; the stage rates match within 0.1 point); Order Again funnel `reorder tapped` → `checkout started` → `order placed`, Totals, 1-hour window; `-- EVAL Q18` (first query: plain funnel; second: browse vs Order Again visits; third: Order Again funnel).
- **Context needed:** 03-event-dictionary.md (funnels, Order Again visits), 04-metrics-and-tables.md (visit and checkout conversion).
- **Grading:** must give stage rates and name checkout drivers backed by data. Credit an answer that notices Order Again visits drop out of the plain funnel at step 2 and reports them separately. Wrong: a unique-customer funnel over the whole window (nearly everyone orders at some point); reading the 29% drop at step 2 as all lost browsers without accounting for Order Again visits; counting one `reorder tapped` as both the restaurant step and the cart step (a Mixpanel funnel cannot match one event to two steps).

### Q19 — What should we worry about this quarter?
- **Prompt:** "What should leadership worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names several of these, with numbers: (1) **late deliveries on rainy days** (51.5% late vs 12.5% dry; Q3) and **new customers lost after a late first order** (repeat 39.5% vs 63.2%; Q1), so courier supply on rainy days and more honest quotes matter; (2) **coupon affiliates** look cheap but deliver a little over half the repeat rate, so they cost about the same per repeat customer as paid social (Q8, Q9); (3) the **August fee increase** cut non-Pass checkout conversion by about 16% (Q12); (4) **quoted delivery times over 45 minutes** (22% of checkouts) convert far worse (Q4); (5) dependence on one card processor (Q5, about 440 lost orders in four days). Positives: Order Again (about 46% of orders, faster and better converting), Smart Add-ons ready to ship, Pass trials convert well once customers order twice. Overall late share is about 20-25% each month. Grade on use of evidence; any three supported points pass.
- **Evidence:** H1, H2, H3, H4, H6, H9, H10; `-- EVAL Q19` plus the queries cited.
- **Context needed:** all guides.
- **Grading:** must be grounded in data. Wrong: generic advice; claims with no numbers.

### Q20 — Which cities have the worst on-time performance?
- **Prompt:** "Which cities are worst for late deliveries? Should we replace the market manager in the worst one?"
- **Type:** external-join
- **Answer:** Miami is worst (**34.6%** of deliveries 15+ minutes late), then Atlanta 22.5%, New York 22.0%, Boston 21.2%, Chicago 21.0%, Denver 21.0%, Seattle 17.5%, Austin 16.2%. The ranking follows the weather: 54.6% of Miami's orders fall on rainy days vs 9-13% in Austin and Seattle. On dry days every city is 11.9-13.3% late, so the city gap is rain, not management. Accept Miami worst and the rain explanation; recommend courier supply for rainy days rather than a personnel change.
- **Evidence:** H2-rainy-days; Insights `order delivered` late share by `city`, joined to `market_ops_daily`; `-- EVAL Q20`.
- **Context needed:** 02-timeline.md (weather note), 04-metrics-and-tables.md (late definition, `market_ops_daily`).
- **Grading:** must control for weather before blaming a city. Wrong: "replace Miami's manager" without checking dry-day performance.
