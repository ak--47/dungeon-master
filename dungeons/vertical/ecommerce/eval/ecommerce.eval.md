# Marlowe & Pine (ecommerce) — 20-question eval

- **Data:** `data/verify-ecommerce` (full fidelity: 10,000 users, 4,071 new accounts, 6,947 buyers, 18,660 orders, $5.38M revenue, 1,199,991 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query in `dungeons/vertical/ecommerce/ecommerce.sql` on that data.
- **Stories:** ids refer to the `stories` export in `ecommerce.js` (H1-H10).
- **Per-cart conversion** below always means: Funnels, `product added to cart` → `order completed`, Totals, hold `cart_id` constant, 1-day conversion window.
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Should we ship One-Page Checkout?
- **Prompt:** "We've been running the one-page checkout test since mid-July. Is it working? Should we roll it out?"
- **Type:** funnel
- **Answer:** Yes. Since 2026-07-15, **One-Page carts convert at 37.9% vs 31.4% for Control** (7,032 orders from 18,552 carts vs 6,005 from 19,117), a **1.21x** lift (+6.5 points, z ≈ 13). Checkout is also faster: median time from first add to order **28.8 vs 36.0 minutes (0.80x)**. Both arms have about 4,200-4,300 enrolled shoppers. Accept a lift of 1.15x-1.25x (or +5 to +8 points) and a recommendation to ship.
- **Evidence:** H2-one-page-checkout-experiment; per-cart conversion, breakdown user property `Experiment: One-Page Checkout`, Jul 15 - Oct 1 (or Mixpanel Experiments on `$experiment_started`); median time to convert; `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (start date, how assignment works), 03-event-dictionary.md (`cart_id`, `$experiment_started`).
- **Grading:** must compare the arms on the same metric over the test period and give the size of the lift. Per-cart (cart_id held) is best; a unique-user funnel that shows a smaller but positive gap is partial credit. Wrong: comparing before vs after July 15 for everyone; "no difference".

### Q2 — Did One-Page Checkout change basket size? (null)
- **Prompt:** "The one-page checkout removed the cart page upsell spot. Are people buying smaller baskets in the One-Page arm?"
- **Type:** null-hypothesis
- **Answer:** **No.** Orders from carts started since July 15 hold **1.83 items in One-Page vs 1.84 in Control** (z ≈ −0.3), and the median order total is the same ($179.98 vs $179.94). Mean order total is $284 vs $292 (−2.8%), which is not significant (z ≈ −1.4 on the mean, −1.0 on log order value) and comes from a few large furniture orders. No sub-split differs: items per order by platform (z between −0.5 and +0.5) and by membership (z +1.5 Pine Plus, −1.4 standard, opposite directions). Accept "no meaningful change in basket size".
- **Evidence:** `-- EVAL Q2`; Insights, `order completed`, average `item_count` and median `order_total_usd`, breakdown `Experiment: One-Page Checkout`, from Jul 15.
- **Context needed:** 03-event-dictionary.md (`item_count`, `order_total_usd`).
- **Grading:** must check items or order value by arm and call the gap noise. Wrong: "baskets got smaller" based on the mean order total alone without a significance check.

### Q3 — International checkout and the Canada pilot
- **Prompt:** "How is checkout doing in Canada and the UK compared with the US? Did the September Canada change help?"
- **Type:** funnel
- **Answer:** Before September 1, Canadian and UK carts converted at about **0.56x the US rate** (Canada 18.7%, UK 19.2%, US 33.9%). The loss sits at the **last step**: shipping → payment is the same everywhere (about 79%), but **payment → order is 40.5% (CA) and 41.2% (UK) vs 72.8% (US)**. After the **Sep 1 duties-included pilot**, Canada converts like the US: **39.5% vs 38.0% (1.04x)**, payment → order 78.4% vs 76.5%. The **UK did not change** (18.7% from Sep 1, 0.49x the US; payment → order 38.7%). Accept intl/US 0.50-0.62 before, Canada/US 0.92-1.12 after, and the UK still low.
- **Evidence:** H3-cross-border-duties; Funnels, the six cart steps, Totals, hold `cart_id`, breakdown `ship_country`, before vs after 2026-09-01; `-- EVAL Q3`.
- **Context needed:** 02-timeline.md (Canada pilot and how duties were shown before), 01-business.md (international shipping).
- **Grading:** must break down by country, locate the drop at the final step, and compare Canada before/after with the UK as the unchanged market. Wrong: blaming the shipping fee or the shipping step; "the pilot did nothing".

### Q4 — Do shoppers pad carts to get free shipping?
- **Prompt:** "Do customers add items to reach free shipping? Can you see it in order sizes?"
- **Type:** segmentation
- **Answer:** Yes. Standard US orders pile up just above the free-shipping threshold and thin out just below it; Pine Plus members (always free shipping) do not. Within $30 of the threshold in force, **23.2% of standard orders sit just below it vs 60.3% of Pine Plus orders (0.38x)**. Before Aug 5 (threshold $75) standard orders in $55-$75 numbered 142 vs 554 in $75-$95; after Aug 5 (threshold $50) the pile moved down: standard orders in $50-$75 rose from 198 to 988. Before the change the standard share below was 22.6% (Plus 64.6%); after, 23.6% (Plus 56.5%). Accept a standard/Plus ratio of 0.33-0.45 or an equivalent histogram description that names the threshold and the shift.
- **Evidence:** H1-free-shipping-threshold; Insights, `order completed`, breakdown `subtotal_usd` in $5 buckets, filter `ship_country` = US, breakdown `membership`, before vs after Aug 5; `-- EVAL Q4`.
- **Context needed:** 01-business.md (shipping rules, Pine Plus), 02-timeline.md (threshold change).
- **Grading:** must compare to a group without the incentive (Pine Plus) or show the bunching moving with the threshold. Wrong: "AOV went up so yes" with no distribution view.

### Q5 — Did lowering the free-shipping threshold pay off?
- **Prompt:** "We dropped free shipping from $75 to $50 on August 5. What did it do?"
- **Type:** context
- **Answer:** For standard US orders, the **free-shipping share rose from 82.8% to 93.3%**, and **shipping fee revenue fell from $122 to $54 per day** (about $68 a day, roughly $4,000 over the rest of the window). The add-on bunching moved from just above $75 to just above $50 (see Q4): orders under $50 fell from 13.6% to 6.7% of standard orders, while orders between $50 and $75 grew. Average subtotal was $287 before and $295 after (median $180 vs $185), so basket size did not shrink. Standard US orders per day rose from 89 to 102, but that period also had customer-base growth, the One-Page test (from Jul 15), Room Visualizer (Jul 22), and the Labor Day sale, so the volume rise cannot be credited to the threshold. Accept: higher free-shipping share, lower fee revenue, bunching shifted to $50, and a caution against attributing order growth to the change.
- **Evidence:** H1 (bunching); `-- EVAL Q5`; Insights, `order completed` filter US + standard, average `free_shipping`, sum `shipping_usd`, before vs after Aug 5.
- **Context needed:** 02-timeline.md (date and the other changes in the same weeks), 01-business.md (shipping rules).
- **Grading:** must quantify the free-shipping share and fee revenue change and address confounds. Wrong: "orders grew 15% because of the threshold".

### Q6 — Checkout time and Pine Plus
- **Prompt:** "How long does checkout take, and are Pine Plus members faster?"
- **Type:** funnel
- **Answer:** Median time from a cart's first add to the order is **17.6 minutes for Pine Plus vs 35.2 minutes for standard customers (0.50x)**. Conversion is the same (33.0% vs 32.9%), so members are faster, not more likely to buy. The gap holds in both checkout arms (Plus 18.7 vs standard 37.6 minutes in Control; 15.0 vs 30.0 in One-Page). Accept 0.45x-0.55x.
- **Evidence:** H4-pine-plus-checkout-speed; per-cart funnel, median time to convert, breakdown `membership`; `-- EVAL Q6`.
- **Context needed:** 01-business.md (Pine Plus), 04-metrics-and-tables.md (checkout time).
- **Grading:** must use per-cart time (cart_id held) and report the conversion parity. Wrong: unique-user funnel time that pairs a cart with a later order.

### Q7 — Repeat orders after the summer carrier problem
- **Prompt:** "Customers who ordered in late July and early August seem to come back less. Is that real, and why?"
- **Type:** external-join
- **Answer:** Yes, and it is tied to **Northline Parcel's hub disruption (Jul 20 - Aug 9)**. US customers whose first order of that period shipped with Northline placed another order within 45 days **37.1% of the time vs 66.5%** for customers whose order went with Bluejay (66.0%) or ParcelPost (67.5%): **0.56x** (1,301 vs 1,040 customers). Their parcels arrived late (9.8 days vs about 3.3, none on time). Across all carriers, customers whose first order of the summer shipped Jul 20 - Aug 9 repeated at 48.8% vs 65.2% for Jun 29 - Jul 19. Accept 0.50x-0.62x for Northline vs other carriers and naming the carrier disruption.
- **Evidence:** H5-carrier-disruption-repeat-orders; `carrier_performance_daily.service_status` = disrupted joined to `order shipped` (`shipping_carrier`, ship date); Retention or Funnels order completed → order completed within 45 days, breakdown carrier; `-- EVAL Q7`.
- **Context needed:** 02-timeline.md (disruption dates), 04-metrics-and-tables.md (carrier table), 03-event-dictionary.md (`order_id` links).
- **Grading:** must connect the dip to the late Northline deliveries and compare against other carriers in the same weeks. Wrong: blaming seasonality; "no difference"; comparing to international carriers (Northline ships US only).

### Q8 — Which carrier performed worst?
- **Prompt:** "Which carrier gave us the most trouble this summer, and when?"
- **Type:** external-join
- **Answer:** **Northline Parcel, Jul 20 - Aug 9** (21 days marked `disrupted`). Its reported on-time rate fell to **14.4% vs 93.1%** on normal days and average transit rose to **9.7 vs 3.3 days**; 1,779 of 2,084 parcels handed over in those days were late. In Mixpanel, Northline deliveries shipped in that window took **9.8 days on average and 0% met the 5-day promise**, vs 3.3 days and 92.7% otherwise. The other carriers stayed normal (Bluejay 95% on time, 2.7 days; ParcelPost 91%, 3.7 days). Accept naming Northline with the dates and the size of the delay.
- **Evidence:** H5 (read 2); `carrier_performance_daily` by carrier and status; Insights, `order delivered`, average `delivery_days`, breakdown `shipping_carrier`, daily; `-- EVAL Q8`.
- **Context needed:** 04-metrics-and-tables.md (carrier table), 02-timeline.md.
- **Grading:** must give the window and the magnitude from either source. Wrong: naming ParcelPost because it is slowest on a normal day.

### Q9 — CAC by paid channel
- **Prompt:** "What's our cost to acquire a customer on each paid channel? Is TikTok worth it?"
- **Type:** external-join
- **Answer:** Spend per new account: **TikTok $21.10, Meta $40.45, Google Shopping $61.07** (TikTok is 0.35x Google). But TikTok signups rarely buy: 30-day first-order rate **TikTok 14.5% (67 of 463), Meta 34.0%, Google Shopping 49.8%** (signups through Aug 31). Spend per 30-day first order: **TikTok $146, Google $123, Meta $119**, so TikTok is the cheapest signup and the most expensive first buyer (about 1.2x Google). The ad platforms' own purchase claims rank TikTok highest (761 claimed vs 67 Mixpanel buyers), which is why Finance uses Mixpanel buyers. Accept first-order ratio TikTok/Google 0.22-0.38 and the conclusion that TikTok is not cheaper per buyer.
- **Evidence:** H6-paid-channel-economics; `marketing_spend_daily.spend_usd` by `acquisition_channel` joined to `account created`; Funnels account created → order completed, 30-day window, breakdown `acquisition_channel`; `-- EVAL Q9`.
- **Context needed:** 04-metrics-and-tables.md (CAC and cost per first order, table caveats), 01-business.md (channels).
- **Grading:** must join spend and go past cost per signup to buyers. Wrong: "TikTok is our best channel" from CAC per signup or platform-claimed purchases.

### Q10 — How did the Labor Day sale do?
- **Prompt:** "How did the Labor Day sale perform?"
- **Type:** trend
- **Answer:** Over the four sale days (Sep 4-7) orders ran at **265 a day vs 149** in the 14 days before (1.78x) and revenue at **$58,965 a day vs $43,988 (+34%)**; AOV fell from $295 to $223 because of the 25% discount ($77,075 of discounts). Both traffic and intent rose: **US per-cart conversion 52.6% vs 36.8% (1.43x)**, carts per day 510 vs 430 (1.19x), and category browses per day 2,199 vs 1,646 on the same weekdays of the prior two weeks (1.34x; product views 1.29x). Every sale order carried `LABORDAY25`. Accept conversion lift 1.35x-1.65x, revenue up roughly a third, and the AOV trade-off.
- **Evidence:** H7-labor-day-sale; Insights `order completed` by day and `discount_code`; per-cart conversion sale vs prior 14 days, filter `ship_country` = US; `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (sale dates and mechanics; Canada pilot started Sep 1).
- **Grading:** must separate volume, conversion, and AOV and use a fair baseline. All-country conversion (52.1% vs 34.7%, 1.50x) is accepted with a note that Canada's Sep 1 change sits in the comparison. Wrong: comparing to a single weekday; ignoring the discount when calling revenue.

### Q11 — What early behavior predicts a new customer sticking?
- **Prompt:** "Is there something new customers do in their first two weeks that predicts whether they stick around?"
- **Type:** retention
- **Answer:** **Saving products to the wishlist: 3+ saves in the first 14 days.** Day-45 retention (any shopper action in days 45-51; signups through Aug 10) is **55.0% with 3+ saves vs 22.2% with none (2.47x)**; 1 save 32.5%, 2 saves 42.2%, 3 saves 59.2%, 4 saves 52.7%, 5+ 52.7%, so the gain levels off after 3. Day 30 is 62.9% vs 30.9% for 3+ vs fewer. 29% of new customers (682 of 2,352) reach 3 saves. Placing an order in the first 14 days barely matters (37.7% vs 33.0%). Accept 2.0x-3.0x for 3+ vs none and a rising pattern that plateaus.
- **Evidence:** H8-wishlist-magic-number; Funnels account created → product added to wishlist ×3, 14-day window, save cohorts; Retention account created → any event excluding `order shipped` / `order delivered`, custom bracket day 45-51; `-- EVAL Q11`.
- **Context needed:** 04-metrics-and-tables.md (retention definition), 01-business.md (goal 4).
- **Grading:** must name the wishlist and a threshold near 3, using a mature cohort and shopper actions only. Wrong: counting server-side delivery events as activity; "ordering early is the key".

### Q12 — Is Room Visualizer driving sales?
- **Prompt:** "We launched Room Visualizer in July. Is anyone using it, and does it sell more furniture?"
- **Type:** funnel
- **Answer:** Adoption ramped for about three weeks and then held: the share of furniture and lighting carts that start with a visualizer session went **6.7% (launch week) → 20% → 34% → 41% → about 45% from mid-August**; 2,681 customers opened it 4,200 times. US furniture and lighting carts with a visualizer session **convert 41.3% vs 30.5% without (1.36x)**; all countries 39.1% vs 28.6% (1.37x). There were no visualizer events before Jul 22. Accept a lift of 1.25x-1.55x and a ramp-then-plateau adoption.
- **Evidence:** H9-room-visualizer-launch; Funnels room visualizer opened → product added to cart → order completed vs carts without it; Insights weekly `room visualizer opened`; `-- EVAL Q12`.
- **Context needed:** 02-timeline.md (launch, categories), 01-business.md.
- **Grading:** must compare carts with vs without the visualizer in the same period. A before/after on all furniture and lighting carts (27.7% → 34.6%) alone is partial credit: it mixes in the One-Page test and other changes.

### Q13 — Why did bedding slow down in August?
- **Prompt:** "Bedding add-to-cart rates dropped in mid-August. Is demand falling?"
- **Type:** external-join
- **Answer:** **No, it was stock.** Bedding product views held steady, but bedding adds per view fell from about 0.24-0.26 to **0.13-0.15 in the weeks of Aug 10, 17, and 24**, while other categories stayed near 0.22-0.23. `inventory_daily` shows bedding **in-stock rate 60.2% from Aug 10 to Aug 30 vs 98.2%** before and after (about 45 of 114 SKUs out vs 2), matching the delayed linen container. Bedding orders were 455 ($104k) in those 21 days vs 791 ($184k) in the 21 days before, about $80k of lost bedding revenue. Accept naming the stockout from the inventory table with the dates and a drop of roughly 40%.
- **Evidence:** H10-bedding-stockout; Insights `product added to cart` / `product viewed` by `category`, daily or weekly; join `inventory_daily.in_stock_rate`; `-- EVAL Q13`.
- **Context needed:** 04-metrics-and-tables.md (inventory table), 02-timeline.md (delayed shipment).
- **Grading:** must use the inventory data (or the timeline plus data) to explain the drop as supply, not demand. Wrong: "customers lost interest in bedding".

### Q14 — Do Android shoppers convert worse? (null)
- **Prompt:** "Our Android app gets fewer engineering resources. Do Android shoppers convert carts worse than iPhone shoppers?"
- **Type:** null-hypothesis
- **Answer:** **No.** Per-cart conversion is **33.2% on iOS vs 32.8% on Android** (11,126 vs 10,904 carts, z ≈ +0.7); web is 32.9%. The gap is noise in every sub-split: Control 31.5% vs 30.2%, One-Page 38.0% vs 38.7%, Pine Plus 32.7% vs 32.4%, standard 33.4% vs 33.0%. Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q14`; per-cart conversion, breakdown `platform` of the cart's first add.
- **Context needed:** 03-event-dictionary.md (`platform`).
- **Grading:** must check the data and call it noise. Wrong: "iOS converts better" from a 0.4-point gap.

### Q15 — Do new movers convert better? (null)
- **Prompt:** "New movers are our most active shoppers. Are they also more likely to finish checkout once they start a cart?"
- **Type:** null-hypothesis
- **Answer:** **No.** New movers start far more carts (9.1 per shopper vs 3.9-7.0 for other segments) and place more orders (3.0 per shopper), but their **per-cart conversion is 32.8% vs 32.9%** for everyone else (z ≈ −0.3). No sub-split differs (membership, US vs international, and checkout arm all |z| ≤ 1.4). They buy more because they shop more, not because they convert better. Accept "same conversion, more volume".
- **Evidence:** `-- EVAL Q15`; per-cart conversion, breakdown `shopper_segment`; carts and orders per shopper.
- **Context needed:** 01-business.md (segments).
- **Grading:** must separate volume from rate. Wrong: "new movers convert better" from orders per user.

### Q16 — Why did deliveries spike in mid-August?
- **Prompt:** "Our delivered-orders chart has a dip in late July and a big spike in mid-August. What happened?"
- **Type:** context
- **Answer:** The **Northline disruption (Jul 20 - Aug 9)** delayed about half of US parcels by roughly a week. Shipments stayed steady (about 1,050-1,140 a week), but deliveries fell to about **860 a week** in the weeks of Jul 20 and Jul 27 (Northline deliveries about 300 vs 500 normally), then the backlog landed: **1,111 (week of Aug 3) and 1,412 (week of Aug 10)**, with average delivery time up to 6-7 days. Deliveries were back to normal by the week of Aug 24. The later spike in the week of Sep 7 (1,451) is Labor Day sale orders arriving. Accept the disruption backlog as the cause and the sale for the September spike.
- **Evidence:** H5 (delays); Insights `order shipped` and `order delivered` weekly, breakdown `shipping_carrier`; `-- EVAL Q16`.
- **Context needed:** 02-timeline.md (disruption, Labor Day sale).
- **Grading:** must tie the dip-then-spike to delayed deliveries, not to orders. Wrong: "orders spiked in mid-August".

### Q17 — Do late deliveries hurt reviews and returns?
- **Prompt:** "Do late deliveries show up in our reviews or returns? Which category gets returned most?"
- **Type:** segmentation
- **Answer:** Yes for reviews: orders delivered late average **3.16 stars vs 4.30** on time, and **31.9% of late-order reviews are 1-2 stars vs 7.0%**. "Arrived late" is a return reason on 167 returns. **Bedding has the highest return rate (9.4% of orders)**, then furniture (7.4%) and bath (6.3%); kitchen is lowest (3.7%). Accept the rating gap and bedding as the top return category.
- **Evidence:** `-- EVAL Q17`; Insights `review submitted` average `rating` joined to `order delivered.on_time` on `order_id`; `return requested` per order by `category`.
- **Context needed:** 03-event-dictionary.md (`order_id`, `on_time`).
- **Grading:** must join reviews to delivery timeliness via `order_id`. Wrong: rating by review date only.

### Q18 — Where do carts drop off?
- **Prompt:** "Walk me through our cart funnel. Where do we lose people?"
- **Type:** funnel
- **Answer:** Of 56,687 carts: **87.3% view the cart, 71.8% start checkout, 59.5% finish shipping, 47.4% finish payment, 32.9% order**. Each step loses roughly 12-16% of the starting carts; the payment → order step keeps 69.5% overall but only 50.8% for Canada and 40.5% for the UK vs 73.8% for the US (see Q3). Furniture carts convert least (28.4%); decor most (35.3%). Accept step shares within ±2 points and mention of the international last-step gap.
- **Evidence:** Funnels, six cart steps, Totals, hold `cart_id`, 1-day window; `-- EVAL Q18`.
- **Context needed:** 03-event-dictionary.md (cart events, `cart_id`).
- **Grading:** must use per-cart counting. Wrong: unique-user funnel (most customers order at least once, which hides cart abandonment).

### Q19 — What should we worry about going into Q4? (open-ended)
- **Prompt:** "What should I be worried about going into Q4?"
- **Type:** open-ended
- **Answer:** A good answer ranks issues with numbers: (1) **UK checkout**: UK carts still convert at about half the US rate in September (18.7% vs 38.0%), losing orders at the final step; the Canada duties-included pilot fixed the same problem (39.5%), so extend it to the UK before the holidays. (2) **Carrier concentration**: Northline carries about half of US parcels, and its July-August disruption cut affected customers' 45-day repeat rate to 0.56x and their review scores; holiday volume needs a backup plan. (3) **TikTok efficiency**: cheapest signups but the most expensive first orders ($146 vs $119-$123). (4) **Inventory on core bedding**: the August stockout cost about $80k of bedding sales. (5) Decide on One-Page Checkout (+21% per-cart conversion) before peak season. Revenue grew month over month ($1.34M July, $1.39M August, $1.55M September). Accept any three of these with supporting numbers.
- **Evidence:** H3, H5, H6, H10, H2; `-- EVAL Q19` plus Q3, Q7, Q9, Q13 queries.
- **Context needed:** all guides.
- **Grading:** reward prioritization and quantified, data-backed risks. Penalize generic advice with no numbers, or claims that contradict the data (for example "Canada is still broken").

### Q20 — Summarize the summer (open-ended)
- **Prompt:** "Give me a one-paragraph summary of how the business did this summer."
- **Type:** open-ended
- **Answer:** From Jun 4 to Oct 1: **4,071 new accounts, 6,947 buyers, 18,660 orders, $5.38M revenue**, AOV $288 (median about $180), 2.7 orders per buyer, Pine Plus members 30.8% of orders. Monthly revenue rose from $1.34M (July) to $1.55M (September). Wins: One-Page Checkout (+21% per-cart conversion), Room Visualizer (1.36x conversion on carts that use it), the Canada duties pilot, and the Labor Day sale (+34% daily revenue). Setbacks: the Northline disruption (late parcels, fewer repeat orders, worse reviews), the bedding stockout, persistent UK checkout loss, and weak TikTok buyer economics. Accept totals within ±2% and a balanced view of wins and setbacks.
- **Evidence:** `-- EVAL Q20`, `-- EVAL Q19`, and the story queries.
- **Context needed:** all guides.
- **Grading:** must include the core totals and at least two wins and two setbacks tied to dated events. Wrong: totals that count anonymous visitors or device IDs as customers.
