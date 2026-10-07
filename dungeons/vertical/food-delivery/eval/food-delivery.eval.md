# Forkfly (food-delivery) — 20-question eval

- **Data:** `data/verify-food-delivery` (full fidelity: 10,000 customers, 9,980 with events, 4,159 new signups, 821,016 events, 43,240 orders, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query (or the `-- STORY` query it names) in `dungeons/vertical/food-delivery/food-delivery.sql` on that data.
- **Stories:** ids refer to the `stories` export in `food-delivery.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Do new customers come back after a late first order?
- **Prompt:** "Do new customers come back after their first order? Does a late first delivery change that?"
- **Type:** retention
- **Answer:** Yes, lateness matters a lot. Of new customers whose first order was delivered by Aug 31, **64.5%** of those delivered on time (under 15 minutes late) ordered again within 30 days vs **39.2%** of those delivered **15+ minutes late (0.61x)**. The drop sets in right around the 15-minute mark: early 67.4%, 0-9 min late 64.2%, 10-14 min late 59.5%, 15-24 min late 40.7%, 25+ min late 33.7%. 22.3% of first deliveries (406 of 1,822) were 15+ minutes late. Accept a late/on-time ratio of 0.55-0.70 and a shift around 15 minutes.
- **Evidence:** H1-late-first-order; Funnels `order delivered` → `order placed`, 30-day window, cohort "did account created" in the window, date range Jun 4 - Aug 31, breakdown step 1 `minutes_late` (< 15, ≥ 15); `-- STORY H1` and `-- EVAL Q1`.
- **Context needed:** 04-metrics-and-tables.md (late = 15+ minutes, 30-day repeat definition), 03-event-dictionary.md (`minutes_late`).
- **Grading:** must restrict to new customers and complete 30-day windows and give both rates. Wrong: using all customers (established customers' first order in the window is not their first ever); counting first orders from September (window incomplete); "lateness doesn't matter".

### Q2 — Do we sell more on rainy days?
- **Prompt:** "Does the weather affect our order volume? Do we get more orders when it rains?"
- **Type:** external-join
- **Answer:** Yes. Joining orders to `market_ops_daily` by city and UTC date, a rainy city-day (precipitation ≥ 4 mm; 188 of 960 city-days) has **1.38x** the orders of that city's average dry day. It holds in every city: Miami 1.41x (54 rainy days), Atlanta 1.29x (27), Boston 1.47x (22), New York 1.45x (22), Denver 1.29x (21), Chicago 1.30x (21), Seattle 1.49x (11), Austin 1.26x (10). Checkout conversion is about the same in rain (66.4% on rainy days vs 67.1% on dry days); the extra orders come from more visits. Accept 1.25x-1.55x pooled.
- **Evidence:** H2-rainy-days; Insights `order placed` daily by `city`, joined to `market_ops_daily.precipitation_mm` on date + city; `-- STORY H2` and `-- EVAL Q2`.
- **Context needed:** 04-metrics-and-tables.md (`market_ops_daily`, rainy-day definition), 02-timeline.md (weather by city).
- **Grading:** must join weather by city and date (not national averages) and compare within city. Wrong: pooling all cities without normalizing (Miami's many rainy days mix city size into the answer); "no effect".

### Q3 — Why are deliveries late on some days?
- **Prompt:** "Some days our late-delivery numbers are terrible. What's going on?"
- **Type:** external-join
- **Answer:** Rain. On rainy city-days deliveries average **15.0 minutes late vs 3.1 on dry days (+12.0 min)**, and **52.1%** of rainy-day orders arrive 15+ minutes late vs **12.5%** on dry days. Couriers are stretched: `market_ops_daily` shows **3.09 orders per active courier on rainy days vs 2.38 on dry days**, because demand rises (Q2) while courier supply does not. Support contacts follow: 15.4% of rainy-day orders vs 6.6% of dry-day orders. Quoted ETAs at checkout do not rise on rainy days, so customers are promised the usual time. Accept +10 to +14 minutes and naming rain plus courier strain.
- **Evidence:** H2-rainy-days; Insights `order delivered` average `minutes_late` by day and city joined to `market_ops_daily`; `-- STORY H2` (second query) and `-- EVAL Q3`.
- **Context needed:** 04-metrics-and-tables.md (`market_ops_daily`, on-time definition), 03-event-dictionary.md (`minutes_late`, `quoted_eta_mins`).
- **Grading:** must link lateness to weather with the warehouse table and size it. Wrong: blaming specific restaurants or cuisines; blaming one city without checking weather (see Q20).

### Q4 — Does the quoted delivery time affect checkout?
- **Prompt:** "Does the delivery time we show at checkout affect whether people order? Is there a point where they give up?"
- **Type:** funnel
- **Answer:** Yes, there is a cliff around 45 minutes. Checkout → order (per checkout, `order_id` held, 1-hour window): quotes under 30 min 76.5%, 30-39 min 74.6%, 40-45 min 64.9%, 46-50 min 50.2%, 51-60 min 41.6%, over 60 min 39.2%. Quotes of 45 minutes or less convert **73.2%** vs **44.6%** for longer quotes (**0.61x**). 21.9% of checkouts are quoted over 45 minutes. Accept a decline that steepens in the 40-50 minute range and a ≤45 vs >45 ratio of 0.54-0.66.
- **Evidence:** H3-quoted-eta-threshold; Funnels `checkout started` → `order placed`, Totals, hold `order_id`, 1-hour window, breakdown `quoted_eta_mins` buckets; `-- STORY H3` and `-- EVAL Q4`.
- **Context needed:** 03-event-dictionary.md (`quoted_eta_mins`), 04-metrics-and-tables.md (checkout conversion).
- **Grading:** must use per-checkout conversion and find the threshold region. Wrong: a unique-customer funnel (most customers convert at least once, which hides the effect); "linear decline" with no threshold region.

### Q5 — What happened to orders in late August?
- **Prompt:** "Orders dipped for a few days at the end of August. What happened, and how many orders did we lose?"
- **Type:** external-join
- **Answer:** The **Paylane card processor incident, Aug 25-28** (timeline). `payment_gateway_daily` shows card as `major_outage` on those four days with decline rates of 0.60-0.62 (vs about 0.02 normally); other methods were operational. Card checkout conversion fell to 25.6-29.0% a day vs about 64% normally, while Apple Pay, Google Pay, and PayPal held at 58-66%. Relative to other methods, card conversion was **0.43x** its level in the 14 days either side. Of 1,249 card checkouts, 341 became orders; at the normal 63.8% rate that is about **456 lost orders** (476 `processor_unavailable` failures), roughly **$16,000** of order value at the $35.23 average card order. Orders recovered on Aug 29. Accept 0.35x-0.50x and 350-550 lost orders.
- **Evidence:** H4-card-processor-incident; Funnels `checkout started` → `order placed` by `payment_method`, daily, joined to `payment_gateway_daily`; `payment failed` by `decline_code`; `-- STORY H4` and `-- EVAL Q5`.
- **Context needed:** 02-timeline.md (incident dates, Paylane handles cards only), 04-metrics-and-tables.md (`payment_gateway_daily`).
- **Grading:** must name the card processor incident and split by payment method. Wrong: "demand fell" or blaming weather or the fee change; counting all payment methods as affected.

### Q6 — Should we ship Smart Add-ons?
- **Prompt:** "Is the Smart Add-ons test working? Should we ship it?"
- **Type:** funnel
- **Answer:** Yes. After Jul 28 the Smart Add-ons arm orders **2.81 items per order vs 2.38 in Control (+0.43)**; adjusting for the arms' pre-test difference (2.44 vs 2.39 before Jul 28; the arms differ a little in household mix) the lift is **+0.37 items per order** and **+$1.60 subtotal per order** (raw arm difference +$2.12). Suggestions were added 5,150 times at about $5.45 each. Checkout conversion is unchanged (64.1% vs 64.2%; Q7). The split is balanced (4,109 vs 4,013 exposed customers). Recommend shipping. Accept an items lift of 0.3-0.5 and a subtotal lift of $1.2-2.5, with conversion flat.
- **Evidence:** H5-smart-addons-experiment; Insights `order placed` average `items_count` and `subtotal_usd` by `Experiment: Smart Add-ons`, Jul 28 - Oct 1 vs Jun 4 - Jul 27 (or the Experiments report on `$experiment_started`); `-- STORY H5` and `-- EVAL Q6`.
- **Context needed:** 02-timeline.md (test start, arms), 03-event-dictionary.md (`added_from`, `items_count`).
- **Grading:** must compare arms after the start and check conversion. Full credit for the raw or the adjusted lift; extra credit for noticing the pre-test gap. Wrong: comparing customers who used a suggestion against everyone else (selection); including orders before Jul 28.

### Q7 — Does Smart Add-ons hurt conversion?
- **Prompt:** "Our designers worry the add-on suggestions slow people down at checkout. Did Smart Add-ons lower checkout conversion?"
- **Type:** null-hypothesis
- **Answer:** No meaningful effect. Per-checkout conversion after Jul 28: Control **64.16%** (19,945 checkouts) vs Smart Add-ons **64.06%** (20,636), z = −0.22 (p ≈ 0.8). The null holds in the obvious splits: iOS 64.2% vs 64.0% (z = −0.40), Android 64.0% vs 64.1% (z = 0.18), non-Pass 62.1% vs 62.2% (z = 0.16), Pass 71.2% vs 70.1% (z = −1.15, p ≈ 0.25). Accept "no significant difference" with numbers within ±1.5 points.
- **Evidence:** H5-smart-addons-experiment (second assertion); Funnels `checkout started` → `order placed`, hold `order_id`, by arm; `-- EVAL Q7`.
- **Context needed:** 02-timeline.md (test start), 04-metrics-and-tables.md (checkout conversion).
- **Grading:** must answer "no" with a test or interval. Wrong: claiming a drop from the Pass split alone; using unique-customer conversion.

### Q8 — Which paid channel has the cheapest customers?
- **Prompt:** "Which paid channel gives us the cheapest new customers?"
- **Type:** external-join
- **Answer:** Per signup, coupon affiliates: window spend from `marketing_spend_daily` divided by Mixpanel signups is **$9.07 coupon affiliates** (887 signups, $8,043), **$17.76 paid social** (944, $16,764), **$26.45 paid search** (716, $18,938). But coupon-site customers rarely come back (Q9), so **per repeat customer coupon affiliates cost $47.30 vs $48.38 for paid social (≈1.0x)** and $64.30 for paid search. Networks over-claim signups (e.g. coupon partners claim 1,039 vs 887), so cost per network-reported signup understates CAC. Accept coupon ≈ 0.31-0.38x of paid search per signup and coupon ≈ paid social per repeat customer (0.85-1.15x).
- **Evidence:** H6-channel-economics; Insights `account created` by `acquisition_channel` joined to `marketing_spend_daily.spend_usd`; Funnels `order delivered` → `order placed`, 30 days, by channel; `-- STORY H6` and `-- EVAL Q8`.
- **Context needed:** 04-metrics-and-tables.md (CAC uses Mixpanel signups; table columns), 01-business.md (channels, DEAL15).
- **Grading:** must join spend to Mixpanel signups and go beyond cost per signup. Wrong: using `network_reported_signups` as the denominator; stopping at "coupon affiliates are 3x cheaper".

### Q9 — Do coupon-site customers stick around?
- **Prompt:** "Are customers from coupon and deal sites as loyal as customers from other channels?"
- **Type:** retention
- **Answer:** No. Of new customers whose first order was delivered by Aug 31, **33.1%** of coupon-affiliate customers ordered again within 30 days vs **65.9%** for all other channels (**0.50x**). By channel: organic 67.0%, paid search 68.6%, paid social 63.3%, referral 63.3%, coupon affiliates 33.1% (390 first orders). First-order rates are similar across channels; the gap opens after the discounted first order. Accept 0.40x-0.60x.
- **Evidence:** H6-channel-economics; Funnels `order delivered` → `order placed`, 30-day window, new customers, breakdown `acquisition_channel`; `-- EVAL Q9`.
- **Context needed:** 01-business.md (coupon affiliates, DEAL15), 04-metrics-and-tables.md (repeat rate).
- **Grading:** must compare repeat behavior by channel for new customers with complete windows. Wrong: comparing total orders per customer without accounting for signup date.

### Q10 — What makes a Pass trial convert?
- **Prompt:** "What predicts whether a Forkfly Pass free trial turns into a paid membership?"
- **Type:** segmentation
- **Answer:** Ordering at least twice during the trial. Of 1,407 trials that started in the window and finished by Oct 1, **64.6%** of trials with **2+ orders** converted vs **29.3%** with 0-1 orders (2.2x). By count: 0 orders 22.8%, 1 order 32.0%, 2 orders 64.6%, 3 orders 63.4%, 4+ orders 65.8% — a step at the second order, flat after. Overall 45.7% convert; 46.6% of trials reach 2 orders. Accept a step between 1 and 2 orders with rates of about 0.6-0.7 vs 0.25-0.35.
- **Evidence:** H7-pass-trial-two-orders; Insights `pass trial ended`, share `outcome = converted`, breakdown `orders_during_trial`; `-- STORY H7` and `-- EVAL Q10`.
- **Context needed:** 03-event-dictionary.md (`pass trial ended` properties), 01-business.md (trial rules).
- **Grading:** must find the threshold at 2 orders (not "more is always better"). Wrong: including trials still running at the end of the window; using Pass status on later orders as the outcome.

### Q11 — Does the $15 free-delivery minimum change baskets?
- **Prompt:** "Pass members get free delivery from $15. Does that change what they order?"
- **Type:** segmentation
- **Answer:** Yes, Pass baskets pile up just above $15. Share of orders with a subtotal of $10-14.99: **5.1% of Pass orders vs 13.1% of non-Pass orders**; $15-19.99: **28.5% vs 20.6%**. Among $10-19.99 orders, **15.3%** of Pass orders are under $15 vs **38.9%** of non-Pass orders (**0.39x**). Below $10 and above $20 the two look alike. 92.5% of Pass orders get free delivery. Accept a clear dip below $15 and pile-up above it for Pass orders (ratio 0.3-0.5).
- **Evidence:** H8-pass-free-delivery-minimum; Insights `order placed`, filter `subtotal_usd` 10-20, breakdown `pass_status` × subtotal buckets; `-- STORY H8` and `-- EVAL Q11`.
- **Context needed:** 01-business.md (Pass free-delivery minimum), 03-event-dictionary.md (`pass_status` at event time).
- **Grading:** must compare the distribution around $15 by Pass status at order time. Wrong: comparing average subtotal only (26.63 vs 26.22, nearly the same); using the current profile Pass status instead of the event's.

### Q12 — Did the August fee increase cost us orders?
- **Prompt:** "We raised the service fee for non-Pass orders in August. Did it hurt orders, and was it worth it?"
- **Type:** trend
- **Answer:** It cost orders. Per-checkout conversion for non-Pass customers fell from **71.9% before Aug 11 to 60.9% after**, while Pass customers (fee unchanged) went from 71.5% to 72.0%; difference-in-differences **0.84** (−16%; card-incident days excluded). Service-fee revenue per non-Pass checkout still rose from **$1.84 to $2.38** (+30%) because each order pays more ($2.55 → $3.91 per order), but order value per non-Pass checkout fell from **$24.67 to $22.15** (−10%), so restaurants and couriers lose volume and the gain depends on how much commission is lost. Accept a DiD of 0.77-0.93 and naming Pass as the control.
- **Evidence:** H9-service-fee-change; Funnels `checkout started` → `order placed` by `pass_status`, before vs after Aug 11; `-- STORY H9` and `-- EVAL Q12`.
- **Context needed:** 02-timeline.md (fee change, Pass unchanged), 01-business.md (fees, commission not in data).
- **Grading:** must use Pass as a control or otherwise separate the fee effect from trends and the incident. Wrong: raw order counts before vs after (growth and Order Again push orders up); including Aug 25-28 without noting the card incident.

### Q13 — Is Order Again working?
- **Prompt:** "We launched Order Again in July. Is it working?"
- **Type:** funnel
- **Answer:** Yes. Visits that use Order Again reach `order placed` in a median **5.6 minutes vs 16.0 minutes** for browsing visits (0.35x), and among customers who have used it, Order Again visits end in an order **59.1%** of the time vs **30.9%** for their browsing visits (**1.9x**). It is not a niche feature (Q14). Accept a time ratio of 0.3-0.4 and a conversion ratio of 1.7-2.2.
- **Evidence:** H10-order-again-launch; Funnels `app opened` → `order placed`, Totals, 60-minute window, median time to convert, breakdown step 2 `entry_point`, Jul 7 - Oct 1; `-- STORY H10` and `-- EVAL Q13`.
- **Context needed:** 02-timeline.md (launch), 03-event-dictionary.md (`reorder tapped`, `entry_point`).
- **Grading:** must compare speed or conversion of Order Again visits against browsing visits after launch. Wrong: comparing users who used it against users who never did (heavier customers use it more); using dates before Jul 7.

### Q14 — How fast did Order Again catch on?
- **Prompt:** "What share of our orders now come through Order Again, and how quickly did customers pick it up?"
- **Type:** trend
- **Answer:** Share of orders with `entry_point = reorder` by week: 7.0% in the launch week (Jul 6), 20.6% (Jul 13), 32.9% (Jul 20), 39.5% (Jul 27), then a plateau of 41-44% from August; **43.0% of September orders**. **6,003 customers** used it, 77% of customers who ordered after launch. Accept a ramp over about three weeks to roughly 40-45%.
- **Evidence:** H10-order-again-launch (adoption); Insights `order placed`, weekly, breakdown `entry_point`; `-- EVAL Q14`.
- **Context needed:** 02-timeline.md (launch date, eligibility).
- **Grading:** must show the ramp then plateau and a September share. Wrong: "adoption keeps growing"; counting `reorder tapped` events without checking they became orders.

### Q15 — Is the Android app converting worse?
- **Prompt:** "Someone on the team thinks the Android checkout converts worse than iOS. Is that true?"
- **Type:** null-hypothesis
- **Answer:** No meaningful difference. Per-checkout conversion is **67.1% on iOS** (42,419 checkouts) vs **66.7% on Android** (22,192), z = −1.05 (p ≈ 0.3). Splits agree: non-Pass 65.8% vs 65.7% (z = −0.38), Pass 71.2% vs 70.2% (z = −1.17), before Aug 11 72.0% vs 71.6% (z = −0.69), after 62.2% vs 61.8% (z = −0.73). The only platform-linked dip is the Aug 25-28 card incident, which hit Android a little harder because more Android customers pay by card. Accept "no significant difference".
- **Evidence:** Funnels `checkout started` → `order placed`, hold `order_id`, breakdown `platform`; `-- EVAL Q15`.
- **Context needed:** 01-business.md (payment methods by platform), 04-metrics-and-tables.md (checkout conversion).
- **Grading:** must answer "no" with numbers and a test. Wrong: reporting a gap from order counts (iOS has twice the customers).

### Q16 — How big is Forkfly Pass?
- **Prompt:** "Give me a quick picture of Forkfly Pass this summer: members, trials, and how much of our business it is."
- **Type:** context
- **Answer:** At the end of the window **1,480 customers are paid members and 193 are on a trial**. Pass orders were **26.2%** of all orders in the window, rising from 23.4% in June to 29.6% in September. 22,870 trial offers were shown, **1,600 trials started** in the window and 1,567 trials ended (including trials that began in late May); 268 members cancelled. Trial conversion is in Q10. Accept numbers within 3%.
- **Evidence:** H7/H8 context; profiles `pass_status`; Insights `order placed` by `pass_status`; `-- EVAL Q16`.
- **Context needed:** 01-business.md (Pass), 03-event-dictionary.md (`pass_status` at event time).
- **Grading:** must use event-time `pass_status` for order share and include trial customers as Pass. Wrong: using profile Pass status for historical orders.

### Q17 — Is acquisition growing?
- **Prompt:** "How many new customers are we getting each week, and from where?"
- **Type:** trend
- **Answer:** Steady, not growing: about **225-265 signups per full week** (4,159 in the window). Mix: organic 29.3%, paid social 22.7%, coupon affiliates 21.3%, paid search 17.2%, referral 9.5%. 73.1% of customers who signed up by Aug 31 placed an order. Total orders still grew (about 2,000 a week in June to about 2,800-2,900 in September) because new customers add to the base and Order Again lifted ordering. Accept a flat signup trend.
- **Evidence:** Insights `account created`, weekly, breakdown `acquisition_channel`; `-- EVAL Q17`.
- **Context needed:** 01-business.md (channels), 02-timeline.md (budgets steady).
- **Grading:** must separate signups from orders. Wrong: reading order growth as acquisition growth.

### Q18 — Where do customers drop between opening the app and ordering?
- **Prompt:** "Walk me through our ordering funnel. Where are we losing people?"
- **Type:** open-ended
- **Answer:** Per visit (121,388 visits): nearly every visit opens a restaurant page or Order Again; **65.5%** build a cart; **53.2%** reach checkout; **35.6%** place an order. Checkout → order is **66.9%**. The biggest drop is before the cart (browsing without choosing). At checkout, the main losses are long quoted delivery times (Q4), the non-Pass fee increase from Aug 11 (Q12), and payment failures (1,339, an everyday rate of about 2%, plus the Aug 25-28 card incident, Q5). Order Again visits convert about twice as well (Q13). Accept the stage rates within 2 points and at least two checkout drivers.
- **Evidence:** H3, H4, H9, H10; Funnels `app opened` → `restaurant viewed` → `item added to cart` → `checkout started` → `order placed`, 1-hour window; `-- EVAL Q18`.
- **Context needed:** 03-event-dictionary.md (funnels), 04-metrics-and-tables.md (visit and checkout conversion).
- **Grading:** must give stage rates and name checkout drivers backed by data. Wrong: a unique-customer funnel over the whole window (nearly everyone orders at some point).

### Q19 — What should we worry about this quarter?
- **Prompt:** "What should leadership worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names several of these, with numbers: (1) **late deliveries on rainy days** (52% late vs 12.5% dry; Q3) and **new customers lost after a late first order** (repeat 39% vs 64%; Q1), so courier supply on rainy days and more honest quotes matter; (2) **coupon affiliates** look cheap but deliver half the repeat rate, no cheaper per repeat customer than paid social (Q8, Q9); (3) the **August fee increase** cut non-Pass checkout conversion by about 16% (Q12); (4) **quoted delivery times over 45 minutes** (22% of checkouts) convert far worse (Q4); (5) dependence on one card processor (Q5, about 456 lost orders in four days). Positives: Order Again (about 43% of orders, faster and better converting), Smart Add-ons ready to ship, Pass trials convert well once customers order twice. Overall late share is about 20-23% each month. Grade on use of evidence; any three supported points pass.
- **Evidence:** H1, H2, H3, H4, H6, H9, H10; `-- EVAL Q19` plus the queries cited.
- **Context needed:** all guides.
- **Grading:** must be grounded in data. Wrong: generic advice; claims with no numbers.

### Q20 — Which cities have the worst on-time performance?
- **Prompt:** "Which cities are worst for late deliveries? Should we replace the market manager in the worst one?"
- **Type:** external-join
- **Answer:** Miami is worst (**33.9%** of deliveries 15+ minutes late), then Atlanta 22.7%, Boston 22.5%, New York 22.1%, Denver 21.9%, Chicago 20.4%, Seattle 18.2%, Austin 16.5%. The ranking follows the weather: 53.5% of Miami's orders fall on rainy days vs 10-13% in Austin and Seattle. On dry days every city is 11.7-13.1% late, so the city gap is rain, not management. Accept Miami worst and the rain explanation; recommend courier supply for rainy days rather than a personnel change.
- **Evidence:** H2-rainy-days; Insights `order delivered` late share by `city`, joined to `market_ops_daily`; `-- EVAL Q20`.
- **Context needed:** 02-timeline.md (weather by city), 04-metrics-and-tables.md (late definition, `market_ops_daily`).
- **Grading:** must control for weather before blaming a city. Wrong: "replace Miami's manager" without checking dry-day performance.
