# Marlowe & Pine (ecommerce) — 20-question eval

- **Data:** `data/verify-ecommerce` (full fidelity: 10,000 users, 4,036 new accounts, 5,868 buyers, 11,536 orders, $3.29M revenue, 1,223,028 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query in `dungeons/vertical/ecommerce/ecommerce.sql` on that data.
- **Stories:** ids refer to the `stories` export in `ecommerce.js` (H1-H10).
- **Per-cart conversion** below always means: Funnels, `product added to cart` → `order completed`, Totals, hold `cart_id` constant, 1-day conversion window.
- **Null questions** report a two-sided z test; a clean null has p > 0.2 overall and no sub-split with p < 0.05.
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Should we ship One-Page Checkout?
- **Prompt:** "We've been running the one-page checkout test since mid-July. Is it working? Should we roll it out?"
- **Type:** funnel
- **Answer:** Yes. Since 2026-07-15, **One-Page carts convert at 36.9% vs 30.9% for Control** (4,251 orders from 11,510 carts vs 3,848 from 12,442), a **1.19x** lift (+6.0 points, z ≈ 9.8). Checkout is also faster: median time from first add to order **28.8 vs 36.0 minutes (0.80x)**. The arms have 3,881 (One-Page) and 4,075 (Control) enrolled shoppers with a cart. Accept a lift of 1.13x-1.25x (or +4.5 to +7.5 points) and a recommendation to ship.
- **Evidence:** H2-one-page-checkout-experiment; per-cart conversion, breakdown user property `Experiment: One-Page Checkout`, Jul 15 - Oct 1 (or Mixpanel Experiments on `$experiment_started`); median time to convert; `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (start date, how assignment works), 03-event-dictionary.md (`cart_id`, `$experiment_started`).
- **Grading:** must compare the arms on the same metric over the test period and give the size of the lift. Per-cart (cart_id held) is best; a unique-user funnel that shows a smaller but positive gap is partial credit. Wrong: comparing before vs after July 15 for everyone; "no difference".

### Q2 — Does One-Page Checkout change order value? (null)
- **Prompt:** "Before we roll out the one-page checkout, finance wants to know: does it change how much people spend per order?"
- **Type:** null-hypothesis
- **Answer:** **No.** Orders from carts started since July 15 average **$285.70 in One-Page vs $287.53 in Control** (z ≈ −0.26, p ≈ 0.79); median $180 vs $184; on a log scale (order values are heavy-tailed from furniture) z ≈ +0.04. No sub-split differs: by platform z is −0.87 (iOS), +0.94 (Android), −0.36 (web); by membership +1.03 (Pine Plus) and −1.00 (standard); log-scale sub-splits are all within ±1.36 (p ≥ 0.17). Context, not graded: items per order are 1.81 vs 1.84 (z ≈ −1.46, p ≈ 0.14), also not significant. Accept "no meaningful change in order value".
- **Evidence:** H2 (read 3, the honest null); `-- EVAL Q2`; Insights, `order completed`, average `order_total_usd`, breakdown `Experiment: One-Page Checkout`, from Jul 15.
- **Context needed:** 03-event-dictionary.md (`order_total_usd`), 02-timeline.md (test start).
- **Grading:** must compare order value by arm over the test period and call the gap noise. Mentioning more orders in One-Page (from higher conversion) is fine as long as the per-order value is reported as unchanged. Wrong: "One-Page lowers order value" from the $2 gap without a significance check; comparing total revenue by arm and calling that order value.

### Q3 — International checkout and the Canada pilot
- **Prompt:** "How is checkout doing in Canada and the UK compared with the US? Did the September Canada change help?"
- **Type:** funnel
- **Answer:** Before September 1, Canadian and UK carts converted at about **0.55x the US rate** (Canada 18.1%, UK 18.2%, US 33.1%; Canada and UK together 18.1%). The loss sits at the **last step**: shipping → payment is about the same everywhere (77-78%), but **payment → order is 38.8% (CA) and 39.8% (UK) vs 72.0% (US)**. After the **Sep 1 duties-included pilot**, Canada converts like the US: **37.0% vs 37.7% (0.98x)**, payment → order 77.9% vs 77.3%. The **UK stays low** (20.8% from Sep 1, 0.55x the US; payment → order 39.4%). Accept intl/US 0.48-0.62 before, Canada/US 0.88-1.12 after, and the UK still well below the US.
- **Evidence:** H3-cross-border-duties; Funnels, the six cart steps, Totals, hold `cart_id`, breakdown `ship_country`, before vs after 2026-09-01; `-- EVAL Q3`.
- **Context needed:** 02-timeline.md (Canada pilot), 01-business.md (international shipping).
- **Grading:** must break down by country, locate the drop at the final step, and compare Canada before/after with the UK as the unchanged market. Wrong: blaming the shipping fee or the shipping step; "the pilot did nothing".

### Q4 — Do shoppers pad carts to get free shipping?
- **Prompt:** "Do customers add items to reach free shipping? Can you see it in order sizes?"
- **Type:** segmentation
- **Answer:** Yes. Standard US orders pile up just above the free-shipping threshold and thin out just below it; Pine Plus members (always free shipping) do not. Within $30 of the threshold in force, **23.8% of standard orders sit just below it vs 60.3% of Pine Plus orders (0.40x)**. Before Aug 5 (threshold $75), standard orders in $45-$75 numbered 173 vs 479 in $75-$105; from Aug 5 (threshold $50), 196 in $20-$50 vs 701 in $50-$80. The pile moved down with the threshold: standard orders with a $50-$75 subtotal rose from 139 before to 636 after. Share below: standard 26.5% before and 21.9% after; Pine Plus 60.7% and 60.1%. Accept a standard/Plus ratio of 0.33-0.47, or an equivalent histogram description that names the threshold and the shift.
- **Evidence:** H1-free-shipping-threshold; Insights, `order completed`, breakdown `subtotal_usd` in $5 buckets, filter `ship_country` = US, breakdown `membership`, before vs after Aug 5; `-- EVAL Q4`.
- **Context needed:** 01-business.md (shipping rules, Pine Plus), 02-timeline.md (threshold change).
- **Grading:** must compare to a group without the incentive (Pine Plus) or show the bunching moving with the threshold. Wrong: "AOV went up so yes" with no distribution view.

### Q5 — Did lowering the free-shipping threshold pay off?
- **Prompt:** "We dropped free shipping from $75 to $50 on August 5. What did it do?"
- **Type:** context
- **Answer:** For standard US orders, the **free-shipping share rose from 82.0% to 94.0%**, and **shipping fee revenue fell from $75 to $32 per day** (about $43 a day, roughly $2,500 over the rest of the window). The add-on bunching moved from just above $75 to just above $50 (see Q4): orders under $50 fell from 13.7% to 6.0% of standard orders, while orders between $50 and $75 grew. Average subtotal was $283 before and $300 after (median $175 vs $190), so basket size did not shrink. Standard US orders per day rose from 52.5 to 66.8, but that period also had customer-base growth, the One-Page test (from Jul 15), Room Visualizer (Jul 22), the end of the Northline disruption, and the Labor Day sale, so the volume rise cannot be credited to the threshold. Accept: higher free-shipping share, lower fee revenue, bunching shifted to $50, and a caution against attributing order growth to the change.
- **Evidence:** H1 (bunching); `-- EVAL Q5`; Insights, `order completed` filter US + standard, average `free_shipping`, sum `shipping_usd`, before vs after Aug 5.
- **Context needed:** 02-timeline.md (date and the other changes in the same weeks), 01-business.md (shipping rules).
- **Grading:** must quantify the free-shipping share and fee revenue change and address confounds. Wrong: "orders grew 27% because of the threshold".

### Q6 — Checkout time and Pine Plus
- **Prompt:** "How long does checkout take, and are Pine Plus members faster?"
- **Type:** funnel
- **Answer:** Median time from a cart's first add to the order is **17.7 minutes for Pine Plus vs 35.3 minutes for standard customers (0.50x)**. Conversion is about the same (33.1% vs 32.1%), so members are faster, not more likely to buy. The gap holds in both checkout arms (Plus 18.7 vs standard 37.6 minutes in Control; 15.0 vs 30.0 in One-Page). Accept 0.45x-0.55x.
- **Evidence:** H4-pine-plus-checkout-speed; per-cart funnel, median time to convert, breakdown `membership`; `-- EVAL Q6`.
- **Context needed:** 01-business.md (Pine Plus), 04-metrics-and-tables.md (checkout time).
- **Grading:** must use per-cart time (cart_id held) and report the conversion parity. Wrong: unique-user funnel time that pairs a cart with a later order.

### Q7 — Repeat orders after the summer carrier problem
- **Prompt:** "Customers who ordered in July and early August seem to come back less. Is that real, and why?"
- **Type:** external-join
- **Answer:** Yes, and it is tied to **Northline Parcel's hub disruption (Jul 6 - Aug 9)**. Funnels `order shipped` → `order completed`, Uniques, 45-day window, date range Jul 6 - Aug 9, US customers, breakdown `shipping_carrier`: customers whose first parcel of that period went with Northline placed another order within 45 days **25.3% of the time vs 46.7%** for Bluejay (46.9%) or ParcelPost (46.1%): **0.54x** (1,203 vs 1,016 customers). Their parcels arrived late (9.8 days vs about 3.3, none on time). Across all carriers, US customers whose first parcel shipped Jul 6 - Aug 9 repeated at 35.1% vs 47.8% for those whose first parcel shipped Jun 4 - Jul 5. Accept 0.45x-0.62x for Northline vs other carriers and naming the carrier disruption.
- **Evidence:** H5-carrier-disruption-repeat-orders; `carrier_performance_daily.service_status` = disrupted gives the dates; Funnels order shipped → order completed as above; `-- EVAL Q7`.
- **Context needed:** 02-timeline.md (disruption dates), 04-metrics-and-tables.md (carrier table), 03-event-dictionary.md (`order_id` links).
- **Grading:** must connect the dip to the late Northline deliveries and compare against other carriers in the same weeks. Wrong: blaming seasonality or the new Head of Growth (same start date, no role in fulfillment); "no difference"; comparing to international carriers (Northline ships US only).

### Q8 — Which carrier performed worst?
- **Prompt:** "Which carrier gave us the most trouble this summer, and when?"
- **Type:** external-join
- **Answer:** **Northline Parcel, Jul 6 - Aug 9** (35 days marked `disrupted`). Its reported on-time rate fell to **14.3% vs 93.2%** on normal days and average transit rose to **9.8 vs 3.3 days**; 1,597 of 1,865 parcels handed over in those days were late. In Mixpanel, Northline deliveries shipped in that window took **9.8 days on average and 0% met the 5-day promise**, vs 3.3 days and 92.6% otherwise. The other carriers stayed normal (Bluejay 94.8% on time, 2.7 days; ParcelPost 91.1%, 3.7 days). Accept naming Northline with the dates and the size of the delay.
- **Evidence:** H5 (read 2); `carrier_performance_daily` by carrier and status; Insights, `order delivered`, average `delivery_days`, breakdown `shipping_carrier`, daily; `-- EVAL Q8`.
- **Context needed:** 04-metrics-and-tables.md (carrier table), 02-timeline.md.
- **Grading:** must give the window and the magnitude from either source. Wrong: naming ParcelPost because it is slowest on a normal day.

### Q9 — CAC by paid channel
- **Prompt:** "What's our cost to acquire a customer on each paid channel? Is TikTok worth it?"
- **Type:** external-join
- **Answer:** Spend per new account: **TikTok $20.08, Meta $40.21, Google Shopping $57.50** (TikTok is 0.35x Google). But TikTok signups rarely buy: 30-day first-order rate **TikTok 8.7% (43 of 496), Meta 30.4%, Google Shopping 36.2%** (signups through Aug 31). Spend per 30-day first order: **TikTok $232, Meta $132, Google $159**, so TikTok is the cheapest signup and the most expensive first buyer (about 1.5x Google, 1.8x Meta). The ad platforms' own purchase claims rank TikTok highest (761 claimed vs 43 Mixpanel buyers), which is why Finance uses Mixpanel buyers. Accept a first-order ratio TikTok/Google of 0.15-0.38 and the conclusion that TikTok is not cheaper per buyer.
- **Evidence:** H6-paid-channel-economics; `marketing_spend_daily.spend_usd` by `acquisition_channel` joined to `account created`; Funnels account created → order completed, 30-day window, breakdown `acquisition_channel`; `-- EVAL Q9`.
- **Context needed:** 04-metrics-and-tables.md (CAC and cost per first order, table caveats), 01-business.md (channels).
- **Grading:** must join spend and go past cost per signup to buyers. Wrong: "TikTok is our best channel" from CAC per signup or platform-claimed purchases.

### Q10 — How did the Labor Day sale do?
- **Prompt:** "How did the Labor Day sale perform?"
- **Type:** trend
- **Answer:** Over the four sale days (Sep 4-7) orders ran at **167 a day vs 99** in the 14 days before (1.69x) and revenue at **$40,189 a day vs $27,163 (+48%)**; AOV fell from $276 to $241 because of the 25% discount ($52,893 of discounts). Both traffic and intent rose: **US per-cart conversion 51.9% vs 35.4% (1.47x)**, carts per day 330 vs 296 (1.11x), and category browses per day 2,661 vs 2,038 on the same weekdays of the prior two weeks (1.31x; product views 1.28x). Every sale order carried `LABORDAY25`. Accept a conversion lift of 1.35x-1.65x, revenue up by roughly 40-50%, and the AOV trade-off.
- **Evidence:** H7-labor-day-sale; Insights `order completed` by day and `discount_code`; per-cart conversion sale vs prior 14 days, filter `ship_country` = US; `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (sale dates and mechanics; Canada pilot started Sep 1).
- **Grading:** must separate volume, conversion, and AOV and use a fair baseline. All-country conversion (50.6% vs 33.4%, 1.51x) is accepted with a note that Canada's Sep 1 change sits in the comparison. Wrong: comparing to a single weekday; ignoring the discount when calling revenue.

### Q11 — What early behavior predicts a new customer sticking?
- **Prompt:** "Is there something new customers do in their first two weeks that predicts whether they stick around?"
- **Type:** retention
- **Answer:** **Saving products to the wishlist: 3+ saves in the first 14 days.** Day-45 retention (any shopper action in days 45-51; signups through Aug 10) is **60.8% with 3+ saves vs 24.6% with none (2.48x)**; 1 save 36.2%, 2 saves 42.8%, 3 saves 59.9%, 4 saves 62.0%, 5+ 61.0%, so the gain levels off after 3. Day 30 is 73.2% vs 38.6% for 3+ vs fewer. 33% of new customers (742 of 2,249) reach 3 saves. Placing an order in the first 14 days is not a signal (43.6% vs 42.5%, 1.02x, z ≈ 0.4), far below the wishlist effect. Accept 2.0x-3.2x for 3+ vs none and a rising pattern that plateaus.
- **Evidence:** H8-wishlist-magic-number; Funnels account created → product added to wishlist ×3, 14-day window, save cohorts; Retention account created → any event excluding `order shipped` / `order delivered`, custom bracket day 45-51; `-- EVAL Q11`.
- **Context needed:** 04-metrics-and-tables.md (retention definition), 01-business.md (goal 4).
- **Grading:** must name the wishlist and a threshold near 3, using a mature cohort and shopper actions only. Wrong: counting server-side delivery events as activity; "ordering early is the key".

### Q12 — Is Room Visualizer driving sales?
- **Prompt:** "We launched Room Visualizer in July. Is anyone using it, and does it sell more furniture?"
- **Type:** funnel
- **Answer:** Adoption ramped for about four weeks and then held: the share of furniture and lighting carts that start with a visualizer session went **6.5% (week of Jul 20; launch Jul 22) → 23% → 34% → 42% → 47% → 43-45% weekly from late August**; 2,030 customers opened it 2,722 times. US furniture and lighting carts with a visualizer session on the same product just before the first add **convert 41.6% vs 30.9% without (1.35x)**; all countries 39.5% vs 28.9% (1.37x). The buildable Mixpanel versions land a little lower: Funnels room visualizer opened → product added to cart → order completed (Totals, 1-day window, US, from Jul 22) converts 44.3% vs 35.2% for all US furniture and lighting carts (hold `cart_id`), 1.26x; carts of customers who had opened the visualizer before vs those who had not, 40.8% vs 30.9% (1.32x). There were no visualizer events before Jul 22. Accept a lift of 1.20x-1.55x and a ramp-then-plateau adoption.
- **Evidence:** H9-room-visualizer-launch; Funnels A room visualizer opened → product added to cart → order completed vs Funnels B furniture/lighting add → order (hold `cart_id`), or a visualizer-user cohort; Insights weekly `room visualizer opened`; `-- EVAL Q12`.
- **Context needed:** 02-timeline.md (launch, categories), 01-business.md.
- **Grading:** must compare visualizer carts or users with the rest in the same period. A before/after on all US furniture and lighting carts (26.7% → 35.2%) alone is partial credit: it mixes in the One-Page test and other changes.

### Q13 — Why did bedding slow down in August?
- **Prompt:** "Bedding add-to-cart rates dropped in mid-August. Is demand falling?"
- **Type:** external-join
- **Answer:** **No, it was stock.** Bedding product views held steady, but bedding adds per view fell from about 0.13-0.14 to **0.066-0.081 in the weeks of Aug 10, 17, and 24** and recovered to 0.129 in the week of Aug 31, while other categories stayed near 0.12-0.13. `inventory_daily` shows bedding **in-stock rate 60.2% from Aug 10 to Aug 30 vs 98.2%** before and after (45 of 114 SKUs out vs 2), matching the delayed linen container. Bedding orders were 289 ($68k) in those 21 days vs 454 ($111k) in the 21 days before, about $42k of lost bedding revenue. Accept naming the stockout from the inventory table with the dates and a drop of roughly 40%.
- **Evidence:** H10-bedding-stockout; Insights `product added to cart` / `product viewed` by `category`, daily or weekly; join `inventory_daily.in_stock_rate`; `-- EVAL Q13`.
- **Context needed:** 04-metrics-and-tables.md (inventory table), 02-timeline.md (delayed shipment).
- **Grading:** must use the inventory data (or the timeline plus data) to explain the drop as supply, not demand. Wrong: "customers lost interest in bedding".

### Q14 — Which shopper segment is worth the most?
- **Prompt:** "Which of our shopper segments is most valuable, and why?"
- **Type:** segmentation
- **Answer:** **New movers.** Revenue per customer in the window is **$468 for new movers vs $369 for deal seekers, $331 for home refreshers, and $199 for casual gifters**; new movers are 15% of customers but 22% of revenue ($722k of $3.29M). The gap comes from **frequency, not conversion or basket**: new movers place **1.69 orders per customer** (deal seekers 1.30, home refreshers 1.15, casual gifters 0.68) and 70% of them bought (vs 46% of casual gifters), because they start more carts (5.7 per carting customer vs 2.7 for casual gifters). Per-cart conversion is flat across segments (32.2%-32.9%) and AOV is similar ($277 for new movers to $293 for casual gifters). Accept new movers as most valuable per customer, home refreshers as the largest revenue pool ($1.14M), and frequency as the driver.
- **Evidence:** `-- EVAL Q14`; Insights `order completed`, total and per user, breakdown user property `shopper_segment`; per-cart conversion by `shopper_segment`.
- **Context needed:** 01-business.md (segments).
- **Grading:** must separate per-customer value from segment size and name order frequency as the driver. Wrong: "new movers convert better" (per-cart conversion is flat); ranking only by total revenue without per-customer value.

### Q15 — Did the new Head of Growth change paid signups? (null)
- **Prompt:** "Our new Head of Growth took over paid media on July 6. Have paid signups picked up since then?"
- **Type:** null-hypothesis
- **Answer:** **No.** Paid-channel signups ran at **18.9 a day from Jun 4 to Jul 5 vs 18.2 a day from Jul 6 to Oct 1** (605 in 32 days vs 1,605 in 88 days; z ≈ −0.75, p ≈ 0.45). No channel moved: Google Shopping 6.13 vs 5.94 a day (z −0.36), Meta 6.69 vs 6.99 (z +0.56), TikTok 6.09 vs 5.31 (z −1.57, p ≈ 0.12); unpaid channels 15.2 vs 15.2 (z +0.05). Spend per day was flat too (Google $347 vs $344, Meta $277 vs $278, TikTok $111 vs $111), as the timeline says budgets did not change. Accept "no meaningful change".
- **Evidence:** `-- EVAL Q15`; Insights, `account created`, breakdown `acquisition_channel`, daily or weekly, before vs after Jul 6; `marketing_spend_daily`.
- **Context needed:** 02-timeline.md (Head of Growth start, budgets unchanged), 04-metrics-and-tables.md (spend table).
- **Grading:** must compare signup rates per day (the two periods differ in length) and call the gap noise. Wrong: comparing raw totals of the two periods; "TikTok signups fell after the change" from a non-significant gap; crediting the Northline disruption (same start date) with any signup change.

### Q16 — Why did deliveries dip and then bump this summer?
- **Prompt:** "Our delivered-orders chart has a dip in July and a bump in mid-August. What happened?"
- **Type:** context
- **Answer:** The **Northline disruption (Jul 6 - Aug 9)** delayed about half of US parcels by roughly a week. Shipments stayed steady (about 560-650 a week through August), but deliveries fell to **439 and 482** in the weeks of Jul 6 and Jul 13 (Northline deliveries 119 and 176 vs about 270-310 normally), ran near normal counts but late (average delivery time 6.7-6.9 days) in the weeks of Jul 20 - Aug 3, and then the backlog landed after service recovered: **767 (week of Aug 10) and 765 (Aug 17)**, Northline 459 and 427. Deliveries were back to normal by the week of Aug 24 (614, 3.6 days). The later rise in the week of Sep 7 (984) is Labor Day sale orders arriving. Accept the disruption backlog as the cause and the sale for the September spike.
- **Evidence:** H5 (delays); Insights `order shipped` and `order delivered` weekly, breakdown `shipping_carrier`; `-- EVAL Q16`.
- **Context needed:** 02-timeline.md (disruption, Labor Day sale).
- **Grading:** must tie the dip-then-bump to delayed deliveries, not to orders. Wrong: "orders spiked in mid-August".

### Q17 — Do late deliveries hurt reviews and returns?
- **Prompt:** "Do late deliveries show up in our reviews or returns? Which category gets returned most?"
- **Type:** segmentation
- **Answer:** Yes for reviews: orders delivered late average **3.07 stars vs 4.30** on time, and **33.7% of late-order reviews are 1-2 stars vs 7.4%**. "Arrived late" is the return reason on 134 returns. **Bedding has the highest return rate (9.6% of orders)**, then furniture (7.6%), bath (5.3%), dining and outdoor (4.9%); lighting (4.5%), kitchen (4.2%), and decor (4.1%) are lowest. Accept the rating gap and bedding as the top return category.
- **Evidence:** `-- EVAL Q17`; Insights `review submitted` average `rating` joined to `order delivered.on_time` on `order_id`; `return requested` per order by `category`.
- **Context needed:** 03-event-dictionary.md (`order_id`, `on_time`).
- **Grading:** must join reviews to delivery timeliness via `order_id`. Wrong: rating by review date only.

### Q18 — Where do carts drop off?
- **Prompt:** "Walk me through our cart funnel. Where do we lose people?"
- **Type:** funnel
- **Answer:** Of 35,591 carts: **87.2% view the cart, 72.7% start checkout, 59.7% finish shipping, 46.8% finish payment, 32.4% order**. Each step loses roughly 13-15% of the starting carts; the payment → order step keeps 69.2% overall but only 49.9% for Canada (whole window, before and after the Sep 1 pilot) and 39.7% for the UK vs 73.7% for the US (see Q3). Furniture carts convert least (27.8%); lighting most (35.0%). Accept step shares within ±2 points and mention of the international last-step gap.
- **Evidence:** Funnels, six cart steps, Totals, hold `cart_id`, 1-day window; `-- EVAL Q18`.
- **Context needed:** 03-event-dictionary.md (cart events, `cart_id`).
- **Grading:** must use per-cart counting. Wrong: unique-user funnel (most buyers order at least once, which hides cart abandonment).

### Q19 — What should we worry about going into Q4? (open-ended)
- **Prompt:** "What should I be worried about going into Q4?"
- **Type:** open-ended
- **Answer:** A good answer ranks issues with numbers: (1) **UK checkout**: in September (Sep 1-30) UK carts converted at 20.7% vs 37.9% in the US (0.55x), losing orders at the final step; the Canada duties-included pilot fixed the same problem (37.1%), so extend it to the UK before the holidays. (2) **Carrier concentration**: Northline carries about half of US parcels, and its July-August disruption cut affected customers' 45-day repeat rate to about half and hurt their review scores; holiday volume needs a backup plan. (3) **TikTok efficiency**: cheapest signups but the most expensive first orders ($232 vs $132-$159). (4) **Inventory on core bedding**: the August stockout cost about $42k of bedding sales. (5) Decide on One-Page Checkout (+19% per-cart conversion) before peak season. Revenue grew month over month ($0.74M July, $0.82M August, $1.06M September). Accept any three of these with supporting numbers.
- **Evidence:** H3, H5, H6, H10, H2; `-- EVAL Q19` plus Q3, Q7, Q9, Q13 queries.
- **Context needed:** all guides.
- **Grading:** reward prioritization and quantified, data-backed risks. Penalize generic advice with no numbers, or claims that contradict the data (for example "Canada is still broken").

### Q20 — Summarize the summer (open-ended)
- **Prompt:** "Give me a one-paragraph summary of how the business did this summer."
- **Type:** open-ended
- **Answer:** From Jun 4 to Oct 1: **4,036 new accounts, 5,868 buyers, 11,536 orders, $3.29M revenue**, AOV $285, 1.97 orders per buyer, Pine Plus members 31.0% of orders. Monthly revenue rose from $0.74M (July) to $1.06M (September). Wins: One-Page Checkout (+19% per-cart conversion), Room Visualizer (about 1.3-1.4x conversion on carts that use it), the Canada duties pilot, and the Labor Day sale (+48% daily revenue). Setbacks: the Northline disruption (late parcels, fewer repeat orders, worse reviews), the bedding stockout, persistent UK checkout loss, and weak TikTok buyer economics. Accept totals within ±2% and a balanced view of wins and setbacks.
- **Evidence:** `-- EVAL Q20`, `-- EVAL Q19`, and the story queries.
- **Context needed:** all guides.
- **Grading:** must include the core totals and at least two wins and two setbacks tied to dated events. Wrong: totals that count anonymous visitors or device IDs as customers.
