# Marlowe & Pine (ecommerce) — 20-question eval

- **Data:** `data/verify-ecommerce` (full fidelity: 10,000 users, 3,994 new accounts, 5,753 buyers, 11,340 orders, $3.28M revenue, 1,176,400 events, 2026-06-04 → 2026-10-01 UTC)
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
- **Answer:** Yes. Since 2026-07-15, **One-Page carts convert at 37.8% vs 31.3% for Control** (4,419 orders from 11,693 carts vs 3,550 from 11,356), a **1.21x** lift (+6.5 points, z ≈ 10.5). Checkout is also faster: median time from first add to order **28.7 vs 35.9 minutes (0.80x)**. Both arms have about 3,800-3,900 enrolled shoppers. Accept a lift of 1.15x-1.25x (or +5 to +8 points) and a recommendation to ship.
- **Evidence:** H2-one-page-checkout-experiment; per-cart conversion, breakdown user property `Experiment: One-Page Checkout`, Jul 15 - Oct 1 (or Mixpanel Experiments on `$experiment_started`); median time to convert; `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (start date, how assignment works), 03-event-dictionary.md (`cart_id`, `$experiment_started`).
- **Grading:** must compare the arms on the same metric over the test period and give the size of the lift. Per-cart (cart_id held) is best; a unique-user funnel that shows a smaller but positive gap is partial credit. Wrong: comparing before vs after July 15 for everyone; "no difference".

### Q2 — Did One-Page Checkout change basket size? (null)
- **Prompt:** "The one-page checkout removed the cart page upsell spot. Are people buying fewer items per order in the One-Page arm?"
- **Type:** null-hypothesis
- **Answer:** **No.** Orders from carts started since July 15 hold **1.82 items in One-Page vs 1.83 in Control** (z ≈ −0.5, p ≈ 0.59). No sub-split differs: by platform z is between −0.7 and +0.4; by membership +1.4 (Pine Plus) and −1.6 (standard), opposite directions, both p ≥ 0.11. Context, not graded: order value is also not significantly different at the 0.05 level (mean $288 vs $297, z ≈ −1.2, p ≈ 0.22; log order value z ≈ −1.7, p ≈ 0.09; median $176 vs $190), and order values are heavy-tailed from furniture. Accept "no meaningful change in items per order".
- **Evidence:** `-- EVAL Q2`; Insights, `order completed`, average `item_count`, breakdown `Experiment: One-Page Checkout`, from Jul 15.
- **Context needed:** 03-event-dictionary.md (`item_count`).
- **Grading:** must check items per order by arm and call the gap noise. An answer that also reports order value and calls it not significant is fine. Wrong: "baskets got smaller" without a significance check.

### Q3 — International checkout and the Canada pilot
- **Prompt:** "How is checkout doing in Canada and the UK compared with the US? Did the September Canada change help?"
- **Type:** funnel
- **Answer:** Before September 1, Canadian and UK carts converted at about **0.54x the US rate** (Canada 17.6%, UK 18.5%, US 33.6%; Canada and UK together 18.0%). The loss sits at the **last step**: shipping → payment is about the same everywhere (76-78%), but **payment → order is 40.0% (CA) and 40.1% (UK) vs 72.7% (US)**. After the **Sep 1 duties-included pilot**, Canada converts like the US: **41.1% vs 38.0% (1.08x)**, payment → order 77.7% vs 76.8%. The **UK stays low** (23.5% from Sep 1, 0.62x the US; payment → order 45.1%). Accept intl/US 0.48-0.62 before, Canada/US 0.92-1.18 after, and the UK still well below the US.
- **Evidence:** H3-cross-border-duties; Funnels, the six cart steps, Totals, hold `cart_id`, breakdown `ship_country`, before vs after 2026-09-01; `-- EVAL Q3`.
- **Context needed:** 02-timeline.md (Canada pilot), 01-business.md (international shipping).
- **Grading:** must break down by country, locate the drop at the final step, and compare Canada before/after with the UK as the unchanged market. Wrong: blaming the shipping fee or the shipping step; "the pilot did nothing".

### Q4 — Do shoppers pad carts to get free shipping?
- **Prompt:** "Do customers add items to reach free shipping? Can you see it in order sizes?"
- **Type:** segmentation
- **Answer:** Yes. Standard US orders pile up just above the free-shipping threshold and thin out just below it; Pine Plus members (always free shipping) do not. Within $30 of the threshold in force, **24.5% of standard orders sit just below it vs 58.5% of Pine Plus orders (0.42x)**. Before Aug 5 (threshold $75), standard orders in $45-$75 numbered 159 vs 473 in $75-$105; from Aug 5 (threshold $50), 216 in $20-$50 vs 683 in $50-$80. The pile moved down with the threshold: standard orders with a $50-$75 subtotal rose from 129 before to 628 after. Share below: standard 25.2% before and 24.0% after; Pine Plus 58.9% and 58.3%. Accept a standard/Plus ratio of 0.33-0.47, or an equivalent histogram description that names the threshold and the shift.
- **Evidence:** H1-free-shipping-threshold; Insights, `order completed`, breakdown `subtotal_usd` in $5 buckets, filter `ship_country` = US, breakdown `membership`, before vs after Aug 5; `-- EVAL Q4`.
- **Context needed:** 01-business.md (shipping rules, Pine Plus), 02-timeline.md (threshold change).
- **Grading:** must compare to a group without the incentive (Pine Plus) or show the bunching moving with the threshold. Wrong: "AOV went up so yes" with no distribution view.

### Q5 — Did lowering the free-shipping threshold pay off?
- **Prompt:** "We dropped free shipping from $75 to $50 on August 5. What did it do?"
- **Type:** context
- **Answer:** For standard US orders, the **free-shipping share rose from 83.2% to 93.3%**, and **shipping fee revenue fell from $70 to $33 per day** (about $37 a day, roughly $2,100 over the rest of the window). The add-on bunching moved from just above $75 to just above $50 (see Q4): orders under $50 fell from 12.9% to 6.7% of standard orders, while orders between $50 and $75 grew. Average subtotal was $284 before and $303 after (median $185 vs $190), so basket size did not shrink. Standard US orders per day rose from 52 to 62, but that period also had customer-base growth, the One-Page test (from Jul 15), Room Visualizer (Jul 22), and the Labor Day sale, so the volume rise cannot be credited to the threshold. Accept: higher free-shipping share, lower fee revenue, bunching shifted to $50, and a caution against attributing order growth to the change.
- **Evidence:** H1 (bunching); `-- EVAL Q5`; Insights, `order completed` filter US + standard, average `free_shipping`, sum `shipping_usd`, before vs after Aug 5.
- **Context needed:** 02-timeline.md (date and the other changes in the same weeks), 01-business.md (shipping rules).
- **Grading:** must quantify the free-shipping share and fee revenue change and address confounds. Wrong: "orders grew 19% because of the threshold".

### Q6 — Checkout time and Pine Plus
- **Prompt:** "How long does checkout take, and are Pine Plus members faster?"
- **Type:** funnel
- **Answer:** Median time from a cart's first add to the order is **17.6 minutes for Pine Plus vs 35.1 minutes for standard customers (0.50x)**. Conversion is about the same (33.5% vs 32.6%), so members are faster, not more likely to buy. The gap holds in both checkout arms (Plus 18.8 vs standard 37.5 minutes in Control; 15.0 vs 30.0 in One-Page). Accept 0.45x-0.55x.
- **Evidence:** H4-pine-plus-checkout-speed; per-cart funnel, median time to convert, breakdown `membership`; `-- EVAL Q6`.
- **Context needed:** 01-business.md (Pine Plus), 04-metrics-and-tables.md (checkout time).
- **Grading:** must use per-cart time (cart_id held) and report the conversion parity. Wrong: unique-user funnel time that pairs a cart with a later order.

### Q7 — Repeat orders after the summer carrier problem
- **Prompt:** "Customers who ordered in late July and early August seem to come back less. Is that real, and why?"
- **Type:** external-join
- **Answer:** Yes, and it is tied to **Northline Parcel's hub disruption (Jul 20 - Aug 9)**. Funnels `order shipped` → `order completed`, Uniques, 45-day window, date range Jul 20 - Aug 9, US customers, breakdown `shipping_carrier`: customers whose first parcel of that period went with Northline placed another order within 45 days **24.8% of the time vs 49.5%** for Bluejay (48.6%) or ParcelPost (51.3%): **0.50x** (847 vs 715 customers). Their parcels arrived late (9.8 days vs about 3.3, none on time). Anchoring on the order date instead (first order whose parcel shipped in the window, or orders placed Jul 20 - Aug 9) gives 0.54x-0.55x. Across all carriers, customers whose first parcel shipped Jul 20 - Aug 9 repeated at 36.1% vs 45.9% for Jun 29 - Jul 19. Accept 0.45x-0.62x for Northline vs other carriers and naming the carrier disruption.
- **Evidence:** H5-carrier-disruption-repeat-orders; `carrier_performance_daily.service_status` = disrupted gives the dates; Funnels order shipped → order completed as above; `-- EVAL Q7`.
- **Context needed:** 02-timeline.md (disruption dates), 04-metrics-and-tables.md (carrier table), 03-event-dictionary.md (`order_id` links).
- **Grading:** must connect the dip to the late Northline deliveries and compare against other carriers in the same weeks. Wrong: blaming seasonality; "no difference"; comparing to international carriers (Northline ships US only).

### Q8 — Which carrier performed worst?
- **Prompt:** "Which carrier gave us the most trouble this summer, and when?"
- **Type:** external-join
- **Answer:** **Northline Parcel, Jul 20 - Aug 9** (21 days marked `disrupted`). Its reported on-time rate fell to **14.4% vs 93.1%** on normal days and average transit rose to **9.7 vs 3.3 days**; 1,030 of 1,205 parcels handed over in those days were late. In Mixpanel, Northline deliveries shipped in that window took **9.8 days on average and 0% met the 5-day promise**, vs 3.3 days and 93.2% otherwise. The other carriers stayed normal (Bluejay 94.7% on time, 2.7 days; ParcelPost 91.1%, 3.7 days). Accept naming Northline with the dates and the size of the delay.
- **Evidence:** H5 (read 2); `carrier_performance_daily` by carrier and status; Insights, `order delivered`, average `delivery_days`, breakdown `shipping_carrier`, daily; `-- EVAL Q8`.
- **Context needed:** 04-metrics-and-tables.md (carrier table), 02-timeline.md.
- **Grading:** must give the window and the magnitude from either source. Wrong: naming ParcelPost because it is slowest on a normal day.

### Q9 — CAC by paid channel
- **Prompt:** "What's our cost to acquire a customer on each paid channel? Is TikTok worth it?"
- **Type:** external-join
- **Answer:** Spend per new account: **TikTok $21.10, Meta $40.30, Google Shopping $57.99** (TikTok is 0.36x Google). But TikTok signups rarely buy: 30-day first-order rate **TikTok 8.8% (42 of 476), Meta 20.3%, Google Shopping 33.5%** (signups through Aug 31). Spend per 30-day first order: **TikTok $239, Meta $198, Google $173**, so TikTok is the cheapest signup and the most expensive first buyer (about 1.4x Google). The ad platforms' own purchase claims rank TikTok highest (761 claimed vs 42 Mixpanel buyers), which is why Finance uses Mixpanel buyers. Accept a first-order ratio TikTok/Google of 0.20-0.38 and the conclusion that TikTok is not cheaper per buyer.
- **Evidence:** H6-paid-channel-economics; `marketing_spend_daily.spend_usd` by `acquisition_channel` joined to `account created`; Funnels account created → order completed, 30-day window, breakdown `acquisition_channel`; `-- EVAL Q9`.
- **Context needed:** 04-metrics-and-tables.md (CAC and cost per first order, table caveats), 01-business.md (channels).
- **Grading:** must join spend and go past cost per signup to buyers. Wrong: "TikTok is our best channel" from CAC per signup or platform-claimed purchases.

### Q10 — How did the Labor Day sale do?
- **Prompt:** "How did the Labor Day sale perform?"
- **Type:** trend
- **Answer:** Over the four sale days (Sep 4-7) orders ran at **156 a day vs 92** in the 14 days before (1.69x) and revenue at **$37,613 a day vs $28,136 (+34%)**; AOV fell from $305 to $241 because of the 25% discount ($49,415 of discounts). Both traffic and intent rose: **US per-cart conversion 53.4% vs 36.1% (1.48x)**, carts per day 302 vs 275 (1.10x), and category browses per day 2,573 vs 1,982 on the same weekdays of the prior two weeks (1.30x; product views 1.28x). Every sale order carried `LABORDAY25`. Accept a conversion lift of 1.35x-1.65x, revenue up roughly a third, and the AOV trade-off.
- **Evidence:** H7-labor-day-sale; Insights `order completed` by day and `discount_code`; per-cart conversion sale vs prior 14 days, filter `ship_country` = US; `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (sale dates and mechanics; Canada pilot started Sep 1).
- **Grading:** must separate volume, conversion, and AOV and use a fair baseline. All-country conversion (51.8% vs 33.6%, 1.54x) is accepted with a note that Canada's Sep 1 change sits in the comparison. Wrong: comparing to a single weekday; ignoring the discount when calling revenue.

### Q11 — What early behavior predicts a new customer sticking?
- **Prompt:** "Is there something new customers do in their first two weeks that predicts whether they stick around?"
- **Type:** retention
- **Answer:** **Saving products to the wishlist: 3+ saves in the first 14 days.** Day-45 retention (any shopper action in days 45-51; signups through Aug 10) is **62.0% with 3+ saves vs 23.8% with none (2.60x)**; 1 save 34.5%, 2 saves 47.6%, 3 saves 64.3%, 4 saves 56.8%, 5+ 62.9%, so the gain levels off after 3. Day 30 is 74.0% vs 37.9% for 3+ vs fewer. 30% of new customers (684 of 2,253) reach 3 saves. Placing an order in the first 14 days is a weak signal (45.4% vs 41.6%, 1.09x, z ≈ 1.3, not significant), far below the wishlist effect. Accept 2.0x-3.2x for 3+ vs none and a rising pattern that plateaus.
- **Evidence:** H8-wishlist-magic-number; Funnels account created → product added to wishlist ×3, 14-day window, save cohorts; Retention account created → any event excluding `order shipped` / `order delivered`, custom bracket day 45-51; `-- EVAL Q11`.
- **Context needed:** 04-metrics-and-tables.md (retention definition), 01-business.md (goal 4).
- **Grading:** must name the wishlist and a threshold near 3, using a mature cohort and shopper actions only. Wrong: counting server-side delivery events as activity; "ordering early is the key".

### Q12 — Is Room Visualizer driving sales?
- **Prompt:** "We launched Room Visualizer in July. Is anyone using it, and does it sell more furniture?"
- **Type:** funnel
- **Answer:** Adoption ramped for about three weeks and then held: the share of furniture and lighting carts that start with a visualizer session went **6.6% (launch week) → 20% → 31% → 46% → about 45% from mid-August** (39-47% weekly); 1,922 customers opened it 2,560 times. US furniture and lighting carts with a visualizer session on the same product just before the first add **convert 41.7% vs 29.9% without (1.40x)**; all countries 40.0% vs 28.6% (1.40x). The buildable Mixpanel versions land a little lower: Funnels room visualizer opened → product added to cart → order completed (Totals, 1-day window, US, from Jul 22) converts 44.2% vs 34.4% for all US furniture and lighting carts (hold `cart_id`), 1.28x; carts of customers who had opened the visualizer before vs those who had not, 40.9% vs 29.8% (1.37x). There were no visualizer events before Jul 22. Accept a lift of 1.20x-1.55x and a ramp-then-plateau adoption.
- **Evidence:** H9-room-visualizer-launch; Funnels A room visualizer opened → product added to cart → order completed vs Funnels B furniture/lighting add → order (hold `cart_id`), or a visualizer-user cohort; Insights weekly `room visualizer opened`; `-- EVAL Q12`.
- **Context needed:** 02-timeline.md (launch, categories), 01-business.md.
- **Grading:** must compare visualizer carts or users with the rest in the same period. A before/after on all furniture and lighting carts (27.8% → 34.4%) alone is partial credit: it mixes in the One-Page test and other changes.

### Q13 — Why did bedding slow down in August?
- **Prompt:** "Bedding add-to-cart rates dropped in mid-August. Is demand falling?"
- **Type:** external-join
- **Answer:** **No, it was stock.** Bedding product views held steady, but bedding adds per view fell from about 0.13-0.15 to **0.076-0.079 in the weeks of Aug 10, 17, and 24**, while other categories stayed near 0.12-0.13. `inventory_daily` shows bedding **in-stock rate 60.2% from Aug 10 to Aug 30 vs 98.2%** before and after (about 45 of 114 SKUs out vs 2), matching the delayed linen container. Bedding orders were 293 ($64k) in those 21 days vs 461 ($109k) in the 21 days before, about $45k of lost bedding revenue. Accept naming the stockout from the inventory table with the dates and a drop of roughly 40%.
- **Evidence:** H10-bedding-stockout; Insights `product added to cart` / `product viewed` by `category`, daily or weekly; join `inventory_daily.in_stock_rate`; `-- EVAL Q13`.
- **Context needed:** 04-metrics-and-tables.md (inventory table), 02-timeline.md (delayed shipment).
- **Grading:** must use the inventory data (or the timeline plus data) to explain the drop as supply, not demand. Wrong: "customers lost interest in bedding".

### Q14 — Do app shoppers convert differently from web shoppers? (null)
- **Prompt:** "We're debating whether to push shoppers into the app. Do people who shop in our apps finish their carts more often than people on the website?"
- **Type:** null-hypothesis
- **Answer:** **No meaningful difference.** Per-cart conversion is **33.1% on the website vs 32.7% in the apps** (20,578 vs 13,899 carts, z ≈ +0.8, p ≈ 0.43); iOS 32.8%, Android 32.5%. The gap is noise in every obvious sub-split: Control 31.6% vs 30.8%, One-Page 37.7% vs 38.0%, Pine Plus 33.7% vs 33.2%, standard 32.8% vs 32.4%, US 35.1% vs 34.4%, Canada 23.8% vs 25.0%, UK 19.7% vs 20.3% (all |z| ≤ 1.22, p ≥ 0.22). Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q14`; per-cart conversion, breakdown `platform` of the cart's first add.
- **Context needed:** 03-event-dictionary.md (`platform`).
- **Grading:** must check the data and call it noise. Wrong: "the website converts better" from a 0.4-point gap.

### Q15 — Do social-login signups buy sooner? (null)
- **Prompt:** "We added Google and Apple sign-in to make signup easier. Do people who sign up that way place a first order more often than email signups?"
- **Type:** null-hypothesis
- **Answer:** **No.** 30-day first-order rate is **24.2% for social-login signups (Google, Apple, Facebook) vs 25.4% for email** (1,607 vs 1,346 signups through Aug 31, z ≈ −0.75, p ≈ 0.45); Google 23.3%, Apple 24.8%, Facebook 27.1% (144 signups). No sub-split differs: paid channels 21.0% vs 21.3%, unpaid channels 28.0% vs 30.1%, Pine Plus 25.8% vs 24.0%, standard 23.9% vs 25.7%, US 26.1% vs 27.4%, international 13.0% vs 14.6% (all |z| ≤ 0.99). Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q15`; Funnels account created → order completed, 30-day window, breakdown `signup_method`, signups Jun 4 - Aug 31.
- **Context needed:** 03-event-dictionary.md (`signup_method`), 04-metrics-and-tables.md (first-order rate).
- **Grading:** must compare the same cohort window and call the gap noise. Wrong: "email signups are better buyers" from a one-point gap; using signups from September that have not had 30 days.

### Q16 — Why did deliveries spike in mid-August?
- **Prompt:** "Our delivered-orders chart has a dip in late July and a bump in mid-August. What happened?"
- **Type:** context
- **Answer:** The **Northline disruption (Jul 20 - Aug 9)** delayed about half of US parcels by roughly a week. Shipments stayed steady (about 600-680 a week), but deliveries fell to **465 and 512** in the weeks of Jul 20 and Jul 27 (Northline deliveries 136 and 191 vs about 300 normally), then the backlog landed: **724 (week of Aug 3), 765 (Aug 10), and 757 (Aug 17)**, with average delivery time up to 6-7 days. Deliveries were back to normal by the week of Aug 24 (615). The later spike in the week of Sep 7 (887) is Labor Day sale orders arriving. Accept the disruption backlog as the cause and the sale for the September spike.
- **Evidence:** H5 (delays); Insights `order shipped` and `order delivered` weekly, breakdown `shipping_carrier`; `-- EVAL Q16`.
- **Context needed:** 02-timeline.md (disruption, Labor Day sale).
- **Grading:** must tie the dip-then-bump to delayed deliveries, not to orders. Wrong: "orders spiked in mid-August".

### Q17 — Do late deliveries hurt reviews and returns?
- **Prompt:** "Do late deliveries show up in our reviews or returns? Which category gets returned most?"
- **Type:** segmentation
- **Answer:** Yes for reviews: orders delivered late average **3.36 stars vs 4.36** on time, and **29.2% of late-order reviews are 1-2 stars vs 5.7%**. "Arrived late" is the return reason on 125 returns. **Bedding has the highest return rate (9.8% of orders)**, then furniture (7.6%), lighting (6.4%), and bath (6.2%); dining (3.8%) and kitchen (4.0%) are lowest. Accept the rating gap and bedding as the top return category.
- **Evidence:** `-- EVAL Q17`; Insights `review submitted` average `rating` joined to `order delivered.on_time` on `order_id`; `return requested` per order by `category`.
- **Context needed:** 03-event-dictionary.md (`order_id`, `on_time`).
- **Grading:** must join reviews to delivery timeliness via `order_id`. Wrong: rating by review date only.

### Q18 — Where do carts drop off?
- **Prompt:** "Walk me through our cart funnel. Where do we lose people?"
- **Type:** funnel
- **Answer:** Of 34,477 carts: **87.1% view the cart, 72.8% start checkout, 59.9% finish shipping, 47.1% finish payment, 32.9% order**. Each step loses roughly 13-14% of the starting carts; the payment → order step keeps 69.8% overall but only 52.2% for Canada and 41.6% for the UK vs 73.9% for the US (see Q3). Furniture carts convert least (28.5%); dining most (35.4%). Accept step shares within ±2 points and mention of the international last-step gap.
- **Evidence:** Funnels, six cart steps, Totals, hold `cart_id`, 1-day window; `-- EVAL Q18`.
- **Context needed:** 03-event-dictionary.md (cart events, `cart_id`).
- **Grading:** must use per-cart counting. Wrong: unique-user funnel (most buyers order at least once, which hides cart abandonment).

### Q19 — What should we worry about going into Q4? (open-ended)
- **Prompt:** "What should I be worried about going into Q4?"
- **Type:** open-ended
- **Answer:** A good answer ranks issues with numbers: (1) **UK checkout**: in September (Sep 1-30) UK carts converted at 23.6% vs 38.0% in the US (0.62x), losing orders at the final step; the Canada duties-included pilot fixed the same problem (41.0%), so extend it to the UK before the holidays. (2) **Carrier concentration**: Northline carries about half of US parcels, and its July-August disruption cut affected customers' 45-day repeat rate to about half and their review scores; holiday volume needs a backup plan. (3) **TikTok efficiency**: cheapest signups but the most expensive first orders ($239 vs $173-$198). (4) **Inventory on core bedding**: the August stockout cost about $45k of bedding sales. (5) Decide on One-Page Checkout (+21% per-cart conversion) before peak season. Revenue grew month over month ($0.79M July, $0.84M August, $1.00M September). Accept any three of these with supporting numbers.
- **Evidence:** H3, H5, H6, H10, H2; `-- EVAL Q19` plus Q3, Q7, Q9, Q13 queries.
- **Context needed:** all guides.
- **Grading:** reward prioritization and quantified, data-backed risks. Penalize generic advice with no numbers, or claims that contradict the data (for example "Canada is still broken").

### Q20 — Summarize the summer (open-ended)
- **Prompt:** "Give me a one-paragraph summary of how the business did this summer."
- **Type:** open-ended
- **Answer:** From Jun 4 to Oct 1: **3,994 new accounts, 5,753 buyers, 11,340 orders, $3.28M revenue**, AOV $289 (median $185), 2.0 orders per buyer, Pine Plus members 32.2% of orders. Monthly revenue rose from $0.79M (July) to $1.00M (September). Wins: One-Page Checkout (+21% per-cart conversion), Room Visualizer (about 1.3-1.4x conversion on carts that use it), the Canada duties pilot, and the Labor Day sale (+34% daily revenue). Setbacks: the Northline disruption (late parcels, fewer repeat orders, worse reviews), the bedding stockout, persistent UK checkout loss, and weak TikTok buyer economics. Accept totals within ±2% and a balanced view of wins and setbacks.
- **Evidence:** `-- EVAL Q20`, `-- EVAL Q19`, and the story queries.
- **Context needed:** all guides.
- **Grading:** must include the core totals and at least two wins and two setbacks tied to dated events. Wrong: totals that count anonymous visitors or device IDs as customers.
