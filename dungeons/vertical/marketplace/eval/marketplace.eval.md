# Tradepost (marketplace) — 20-question eval

- **Data:** `data/verify-marketplace` (full fidelity: 10,000 people, 9,986 with events, 4,984 new signups, no anonymous events after identity merge, 817,949 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query (or the `-- STORY` query it names) in `dungeons/vertical/marketplace/marketplace.sql` on that data.
- **Stories:** ids refer to the `stories` export in `marketplace.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Did the fee change make casual sellers list less?
- **Prompt:** "We raised the casual seller fee in July. Did casual sellers stop listing as much?"
- **Type:** trend
- **Answer:** Yes. Among sellers who joined before June 4 (a fixed group), casual sellers created **71.4 listings a day** from Jun 4 to Jul 14 and **55.0 a day** from Jul 15 to Oct 1, **0.77x** (−23%). Pro sellers, whose fee did not change, went from 203.3 to 208.9 a day (1.03x), so relative to Pro the casual drop is **0.75x**. The drop starts at the change on July 15, not before. Raw weekly casual listings across all sellers dip less (from about 550-695 a week in the full weeks before the change to about 590-605 in late July and early August, then 665-785 in September) because new casual sellers keep joining; that masks the per-seller drop. Accept a casual drop of 20%-30% with Pro roughly flat.
- **Evidence:** H1-seller-fee-change; Insights, `listing created`, total per day, filter user `member_since` before 2026-06-04, breakdown `account_type`, Jun 4-Jul 14 vs Jul 15-Oct 1; `-- STORY H1` and `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (fee change date, Pro unchanged), 01-business.md (seller types).
- **Grading:** must compare per seller or per day in a fixed group (or against Pro) and give the size. Wrong: weekly casual totals only ("no real change", because new sellers keep arriving); "Pro sellers also listed less"; attributing the drop to Back to Campus or the Guarantee.

### Q2 — Did the fee change pay off?
- **Prompt:** "Did the July fee increase actually make us more money from casual sellers?"
- **Type:** external-join
- **Answer:** In absolute terms yes, but less than the rate rise. From the ledger, casual-seller fee revenue rose from **$452 a day** (Jun 4-Jul 14, take rate 10%) to **$788 a day** (Jul 29-Oct 1, take rate 12.9%), +74%. That is the 29% rate rise plus 35% growth in casual GMV ($4,519 → $6,108 a day). Over the same periods total GMV grew 67% ($18,297 → $30,489 a day; Pro $13,778 → $24,381), and the casual share of GMV fell from **24.7% to 20.0%**: buyers bought relatively less from casual sellers as casual supply shrank (see Q1, Q18). Measured against total GMV growth, casual GMV is about 0.81x where it would have been (1.35 / 1.67), so the higher rate (×1.29) roughly breaks even against the lost volume (0.81 × 1.29 ≈ 1.05). Pro growth is not a clean counterfactual: part of it is demand that moved from casual to Pro sellers, so using it (0.76x, ≈ 0.99) overstates the loss. Accept "fee revenue up about 70-75% in absolute terms, roughly break-even against the trend (anywhere from slightly negative to slightly positive), with casual share of GMV down about 5 points".
- **Evidence:** H1-seller-fee-change (warehouse join); `marketplace_ledger_daily` gmv_usd, fee_revenue_usd, take_rate by seller_type; `-- EVAL Q2`.
- **Context needed:** 02-timeline.md (fee change), 01-business.md (fees), 04-metrics-and-tables.md (ledger).
- **Grading:** must use the ledger (fees are not in Mixpanel) and notice the shrinking casual share. Wrong: "fee revenue up 29% exactly"; using Mixpanel item prices × assumed fee as if it were the ledger without saying so; ignoring the growth trend. An answer that benchmarks against Pro growth is acceptable if it notes the casual-to-Pro substitution.

### Q3 — Should we ship Express Checkout?
- **Prompt:** "Is the Express Checkout test working? Should we roll it out to everyone?"
- **Type:** funnel
- **Answer:** Yes. For checkouts from Jul 22 to Sep 30, **72.7% of Express Checkout checkouts ended in a purchase within a day vs 64.3% in Control (1.13x, z ≈ 16.0)**, and the median time from checkout start to purchase fell from **3.98 to 2.00 minutes (0.50x)**. The split is balanced (4,181 vs 4,201 members with checkouts; 15,773 vs 15,397 checkouts; 4,200 vs 4,211 members exposed). Every member who checked out from Jul 22 has an arm, including members who only bought through accepted offers. Recommend shipping. Accept a lift of 1.10x-1.20x and a time ratio of 0.45-0.60.
- **Evidence:** H2-express-checkout-experiment; Funnels, `checkout started` → `purchase completed`, Totals counting, hold `order_id` constant, 1-day window, Jul 22-Sep 30, breakdown `Experiment: Express Checkout` (or the Experiments report on `$experiment_started`); `-- STORY H2` and `-- EVAL Q3`.
- **Context needed:** 02-timeline.md (start date, arms), 04-metrics-and-tables.md (checkout conversion is per checkout).
- **Grading:** must compare per checkout and report both conversion and speed. Wrong: unique-member conversion as the headline (94.0% vs 91.9%, 1.02x; almost every member completes at least one checkout either way); including checkouts before July 22.

### Q4 — What offer should a buyer make?
- **Prompt:** "What offer amount actually gets accepted? Is there a sweet spot we should suggest to buyers?"
- **Type:** segmentation
- **Answer:** Acceptance rises steeply between about 70% and 85% of the asking price and then flattens. Acceptance within 2 days by `offer_pct_of_ask`: under 60% 5.4%, 60-69% 7.4%, 70-74% 16.8%, 75-79% 36.4%, 80-84% 58.0%, 85-89% 65.0%, 90%+ 68.3%. Offers at **80% or more are accepted 63.6% of the time vs 21.1% below 80% (3.01x)**. Going above about 85% buys little extra. The average offer is 79.9% of the asking price, right at the steep part, and 43.2% of offers are accepted overall. Suggest about 80-85%. Accept a threshold around 75-85% and a 2.7x-3.4x gap at 80%.
- **Evidence:** H3-offer-price-threshold; Funnels, `offer made` → `offer accepted`, Totals, hold `offer_id` constant, 2-day window, breakdown `offer_pct_of_ask` (custom buckets); `-- STORY H3` and `-- EVAL Q4`.
- **Context needed:** 03-event-dictionary.md (`offer_pct_of_ask`), 04-metrics-and-tables.md (offer acceptance rate).
- **Grading:** must use a rate per offer by offer percentage (not by offer amount in dollars) and describe the curve. Wrong: "higher offers always win more, linearly"; averages of `offer_amount` (dollar amounts mix cheap and expensive items).

### Q5 — Do more photos help listings sell?
- **Prompt:** "Do listings with more photos sell better? How many photos should sellers add?"
- **Type:** segmentation
- **Answer:** Yes, up to about five. For listings created Jun 4-Aug 31, the share that sold within 30 days: 1-2 photos **24.2%**, 3-4 photos **39.6%**, 5+ photos **49.8%** (1-2 photos sell at **0.49x** and 3-4 at **0.80x** the rate of 5+). By count it plateaus from 5 photos (5: 49.9%, 6: 49.7%, 7: 49.9%, 8: 49.7%, 9: 50.0%). It is not a seller-type effect: Pro sellers use more photos (6.2 on average vs 3.9 for casual sellers), but within each type the pattern holds (casual 24.3% / 39.9% / 49.7%; Pro 24.0% / 39.5% / 49.8%). Recommend at least 5 photos. Accept 0.45-0.58x and 0.72-0.88x.
- **Evidence:** H4-photos-sell-through; Funnels, `listing created` → `item sold`, Totals, hold `listing_id` constant, 30-day window, listings Jun 4-Aug 31, breakdown `photo_count`; `-- STORY H4` and `-- EVAL Q5`.
- **Context needed:** 03-event-dictionary.md, 04-metrics-and-tables.md (sell-through, full window).
- **Grading:** must use sell-through per listing with a full window and address the seller-type confound. Wrong: "more photos is always better" past 5; including September listings that cannot reach 30 days.

### Q6 — What does a late first delivery cost?
- **Prompt:** "When a buyer's first order takes more than a week to arrive, do we lose them?"
- **Type:** retention
- **Answer:** Yes. Of buyers whose first delivery in the period (through Sep 1) took **more than 7 days**, **34.1%** bought again within 30 days vs **60.3%** when it arrived within 7 days (**0.56x**; 749 vs 6,614 buyers). 10.2% of first deliveries were late. Accept 0.48x-0.60x.
- **Evidence:** H5-late-first-delivery; Retention, birth `order delivered` (first time), breakdown `delivery_days` (≤ 7, > 7), return `purchase completed`, custom bracket day 0-29, births Jun 4-Sep 1; `-- STORY H5` and `-- EVAL Q6`.
- **Context needed:** 04-metrics-and-tables.md (delivery time, repeat purchase). The prompt names the one-week cutoff; the guides do not define "late".
- **Grading:** must split by delivery time on the first delivery and use a complete 30-day window. Wrong: counting `order shipped`/`order delivered` as buyer activity; including births in September.

### Q7 — What happened to purchases in mid-September?
- **Prompt:** "Purchases dipped in the middle of September. What happened?"
- **Type:** external-join
- **Answer:** A card payment incident. From **Sep 14 to Sep 18** card checkouts completed only **43.9%** of the time vs **70.4%** on the 14 days either side, while Apple Pay, Google Pay, and PayPal checkouts were normal (69.3% vs 70.8%); relative to the other methods card conversion fell to **0.64x**. Daily card conversion was 42-48% on those five days and back to 66-75% from Sep 19. `payment_processing_daily` shows `processor_status = degraded` for card only on exactly those days, with approval rate about 0.57-0.59 (vs about 0.97 normally) and p95 latency 7.5-10.2 s. Accept a card drop to 0.55-0.70x of normal on Sep 14-18.
- **Evidence:** H6-card-processor-incident; Funnels, `checkout started` → `purchase completed`, hold `order_id`, 1-day window, breakdown `payment_method`, daily; join `payment_processing_daily.processor_status`; `-- STORY H6` and `-- EVAL Q7`.
- **Context needed:** 02-timeline.md (incident dates), 04-metrics-and-tables.md (payment table).
- **Grading:** must name the payment method and the dates and tie them to the warehouse status. Wrong: "seasonal dip after Labor Day"; blaming Express Checkout or the Guarantee; "all payment methods were affected".

### Q8 — Which paid channel is cheapest?
- **Prompt:** "Which paid channel brings us new buyers most cheaply? TikTok looks cheapest — is it?"
- **Type:** attribution
- **Answer:** Per signup TikTok is cheapest (**$5.90** vs Meta **$9.00** and Google Shopping **$11.90**; window spend over Mixpanel signups). But TikTok signups rarely buy: **36.2%** made a first purchase within 14 days vs **54.3%** for Meta and **79.8%** for Google Shopping (signups through Sep 17). Per activated buyer Google Shopping is cheapest: **$14.92** vs **$16.31** TikTok and **$16.58** Meta. Google Shopping costs 2.0x TikTok per signup but 0.91x per buyer. Accept per-activated costs within ±10%, Google Shopping cheapest, TikTok and Meta close behind it, and TikTok no longer the clear winner.
- **Evidence:** H7-paid-channel-activation; Funnels, `account created` → `purchase completed`, 14-day window, breakdown `acquisition_channel`; spend from `marketing_spend_daily`; `-- STORY H7` and `-- EVAL Q8`.
- **Context needed:** 01-business.md (channels), 04-metrics-and-tables.md (CAC, cost per activated buyer, marketing table).
- **Grading:** must join spend to Mixpanel signups and adjust for activation. Wrong: CAC per signup only ("TikTok is best"); using clicks or impressions as signups.

### Q9 — Did the Tradepost Guarantee help?
- **Prompt:** "Did launching the Tradepost Guarantee change anything at checkout?"
- **Type:** trend
- **Answer:** Yes, for expensive items. Checkouts of items priced **$150 or more** completed **54.7%** of the time before Aug 26 and **70.1%** after (**1.28x**), while cheaper items stayed flat (68.4% → 68.3%). Before the launch expensive items lagged cheap ones; afterwards they convert at about the same rate. Relative to low-ticket, the lift is **1.29x**. Accept 1.10x-1.35x for high-ticket with low-ticket flat.
- **Evidence:** H8-guarantee-launch; Funnels, `checkout started` → `purchase completed`, Totals, hold `order_id`, 1-day window, breakdown `item_price` (< 150, ≥ 150), before vs after Aug 26; `-- STORY H8` and `-- EVAL Q9`.
- **Context needed:** 02-timeline.md (launch date), 03-event-dictionary.md (`item_price` on checkout).
- **Grading:** must split by price and compare before/after. Wrong: overall conversion only ("small lift"); crediting Express Checkout. Express Checkout started Jul 22, so the before period (Jun 4-Aug 25) has 48 days without the test and 35 days with it; but the variant lifts both price bands by the same factor, so comparing high-ticket to low-ticket removes its effect.

### Q10 — Which categories sell fastest?
- **Prompt:** "How long does it take to sell an item on Tradepost, and which categories move fastest?"
- **Type:** funnel
- **Answer:** Median days from listing to sale (listings created Jun 4-Aug 31, sold within 30 days): electronics **3.03**, sneakers 4.47, toys & games 5.93, fashion 6.06, sports & outdoors 6.35, home decor 7.82, collectibles **9.21**. Electronics sell in about half the time of fashion/toys/sports (0.50x of their 6.09-day median), collectibles take about 1.5x as long. The share that sells within 30 days is about the same everywhere (44.3%-46.4%), so the difference is speed, not demand. Accept electronics 0.45-0.55x and collectibles 1.45-1.75x of the middle categories.
- **Evidence:** H9-time-to-sell-by-category; Funnels, `listing created` → `item sold`, hold `listing_id`, 30-day window, median time to convert, breakdown `category`; `-- STORY H9` and `-- EVAL Q10`.
- **Context needed:** 03-event-dictionary.md (`days_to_sell`), 04-metrics-and-tables.md (time to sell).
- **Grading:** must report medians by category. Wrong: means dominated by slow outliers; "collectibles sell less" (sell-through is similar).

### Q11 — Did Back to Campus change what people shop for?
- **Prompt:** "Did the Back to Campus collection change what people looked at and bought?"
- **Type:** context
- **Answer:** Yes. Electronics went from **18.1%** of listing views (Jun 4-Aug 9) to **30.9%** during Back to Campus (Aug 10-Sep 7), **1.71x**, and back to **18.1%** after Sep 8. Electronics' share of purchases followed (16.7% → 30.1% → 18.7%). 4,528 home feed visits opened the collection, all between Aug 10 and Sep 7. Accept a rise to 1.5-1.9x and a return to baseline.
- **Evidence:** H10-back-to-campus; Insights, `listing viewed`, breakdown `category`, % of total, weekly; `-- STORY H10` and `-- EVAL Q11`.
- **Context needed:** 02-timeline.md (campaign dates).
- **Grading:** must use shares (totals also grew) and note the return after the campaign. Wrong: raw electronics counts only; "electronics demand kept growing".

### Q12 — Is the Guarantee costing us in disputes?
- **Prompt:** "Since we launched the Tradepost Guarantee, are buyers opening more disputes?"
- **Type:** null-hypothesis
- **Answer:** No meaningful change. Disputes per delivered order were **2.99%** before Aug 26 (581 of 19,402) and **2.96%** after (305 of 10,296, deliveries through Sep 27), z = −0.16 (p ≈ 0.87). The obvious splits agree: high-ticket 3.38% → 2.87% (z ≈ −1.0, p ≈ 0.32), low-ticket 2.88% → 2.98%, iOS 2.89% → 2.91%, Android 3.11% → 3.02%, and the mix of dispute reasons is similar. Disputes track delivery time (about 6-7% for late orders vs 2.5% for on-time ones, before and after), not the Guarantee.
- **Evidence:** `-- EVAL Q12`; Insights, `dispute opened` / `order delivered`, weekly, before vs after Aug 26.
- **Context needed:** 02-timeline.md (Guarantee launch; dispute rules unchanged), 04-metrics-and-tables.md (dispute rate).
- **Grading:** must give a rate, not a count (deliveries grew), and conclude no effect. Wrong: "disputes rose" from raw counts; "disputes fell a lot".

### Q13 — Do Southern buyers get fewer offers accepted?
- **Prompt:** "Sellers in our community forum say buyers in the South lowball and get fewer offers accepted than other regions. Is that true?"
- **Type:** null-hypothesis
- **Answer:** No. Offer acceptance within 2 days is about the same in every region: South **43.2%**, Midwest 43.5%, Northeast 43.1%, West 43.1%; South vs the rest 43.2% vs 43.2%, z = 0.04 (p ≈ 0.97). Southern buyers do not lowball: the average offer is 80.0% of the asking price in the South and 79.7-80.0% elsewhere. It holds on both platforms (Android: 43.8% vs 43.0%, z = 0.86, p ≈ 0.39; iOS: 42.7% vs 43.4%, z = −0.73, p ≈ 0.47) and at matched offer levels (below 80% of ask: 20.8% vs 21.3%, z = −0.72; 80%+: 64.0% vs 63.4%, z = 0.75, p ≈ 0.45). The South simply makes the most offers (it is the largest region).
- **Evidence:** `-- EVAL Q13`; Funnels, `offer made` → `offer accepted`, Totals, hold `offer_id` constant, 2-day window, breakdown user `region`; Insights, `offer made`, average `offer_pct_of_ask`, breakdown user `region`.
- **Context needed:** 01-business.md (regions), 04-metrics-and-tables.md (offer acceptance rate).
- **Grading:** must compare rates per offer and say there is no meaningful difference. Wrong: comparing raw counts of accepted offers ("the South has the most accepted offers"); calling a one-point gap a finding. No sub-split (platform, offer level) reaches p < 0.3, so a sub-split "effect" is also wrong.

### Q14 — How big was September?
- **Prompt:** "What were GMV, orders, and fee revenue in September, and what take rate did we earn?"
- **Type:** external-join
- **Answer:** From the ledger for Sep 1-30: **GMV $964,580**, **9,925 orders**, **fee revenue $98,233**, blended take rate **10.2%**, refunds $27,440. Mixpanel shows 9,712 `purchase completed` events worth $943,415 of item value from 5,608 buyers in September: about 2% below the ledger, as expected (untracked clients, cancellations). The blended take rate rose from 9.6% in June to 10.2% in September after the casual fee change. Accept ledger numbers within 1%.
- **Evidence:** `-- EVAL Q14`; `marketplace_ledger_daily`.
- **Context needed:** 04-metrics-and-tables.md (GMV and take rate come from the ledger), 02-timeline.md.
- **Grading:** must use the ledger for GMV and fees. Wrong: Mixpanel `order_total` as GMV (it includes shipping); Oct 1 counted in September.

### Q15 — Does delivery speed affect ratings?
- **Prompt:** "Do slow deliveries hurt our ratings and disputes?"
- **Type:** segmentation
- **Answer:** Yes. Average rating by delivery time: within 4 days **4.39**, 5-7 days **4.15**, more than 7 days **3.46**; dispute rates 2.5%, 2.5%, and **6.8%**. Late orders come mostly from casual sellers: 28.1% of casual-seller orders took more than 7 days vs 5.3% of Pro-seller orders (average 6.2 vs 4.5 days). Accept any reasonable delivery-time buckets (for example a slow cutoff anywhere from 6 to 10 days) as long as ratings fall and disputes rise for the slowest bucket; with a 7-day cutoff the slow-bucket rating is near 3.5.
- **Evidence:** `-- EVAL Q15`. `review submitted` and `dispute opened` carry `order_id` but not `delivery_days`, and `order delivered` has no `seller_type`, so every split goes through `order_id`. Mixpanel recipes that hold `order_id` constant: Funnels, `order delivered` (breakdown `delivery_days`, custom buckets ≤ 4, 5-7, > 7) → `review submitted` filtered by `rating` (for example rating ≤ 3, or each star value) and → `dispute opened`, Totals, 7-day window; Funnels, `purchase completed` (breakdown `seller_type`) → `order delivered` filtered `delivery_days` > 7, Totals, 30-day window. The average rating per delivery bucket has no direct Mixpanel recipe; it needs the raw export joined on `order_id` (as the SQL does), or a rating mix read from the funnel above.
- **Context needed:** 03-event-dictionary.md (`delivery_days`, `rating`), 04-metrics-and-tables.md (delivery time, dispute rate).
- **Grading:** must bucket by delivery time. Wrong: "ratings are the same regardless of speed".

### Q16 — What did the card incident cost?
- **Prompt:** "How many purchases did we lose to the September card payment problems, and roughly how much money?"
- **Type:** external-join
- **Answer:** About **290 purchases**, roughly **$26,000** of item value (about $2,700 of fee revenue at the 10.2% blended take rate). On Sep 14-18 there were 1,101 card checkouts and 483 card purchases; at the 70.4% baseline completion they would have produced about 775. The warehouse confirms card approval rates near 0.58 on those days (vs about 0.97); other methods stayed at about 0.97. Accept 230-350 purchases and $20,000-$32,000.
- **Evidence:** H6-card-processor-incident; `-- EVAL Q16`; `payment_processing_daily`.
- **Context needed:** 02-timeline.md (incident), 04-metrics-and-tables.md (payment table, take rate).
- **Grading:** must estimate from card checkouts × the conversion gap (or the approval gap). Wrong: counting all purchases lost in the week across methods; "no measurable cost".

### Q17 — How many new members buy quickly?
- **Prompt:** "What share of new signups make a purchase in their first two weeks?"
- **Type:** funnel
- **Answer:** **63.1%** of the 4,397 members who signed up by Sep 17 bought within 14 days. By channel: Google Shopping 79.8%, referral 74.3%, organic 71.1%, Meta 54.3%, TikTok 36.2%. Accept 58%-68% overall and the channel ordering.
- **Evidence:** H7-paid-channel-activation; Funnels, `account created` → `purchase completed`, Uniques, 14-day window, signups Jun 4-Sep 17, breakdown `acquisition_channel`; `-- EVAL Q17`.
- **Context needed:** 04-metrics-and-tables.md (activation definition, full window).
- **Grading:** must restrict to signups with a full 14 days. Wrong: including late-September signups (understates); counting established members (no `account created` in the window) as signups.

### Q18 — Are buyers seeing fewer casual listings?
- **Prompt:** "Has the mix of who buyers buy from changed this summer?"
- **Type:** trend
- **Answer:** Yes. Casual sellers' share of listings viewed was about **25%** each week through mid-July, slid over the two weeks after the July 15 fee change, and has held at about **19.5-20.5%** since late July; the share of purchases from casual sellers followed (about 23.5-26% in June and early July → 19-21%). Before vs after the drain the casual:Pro mix of listings viewed fell to **0.75x** (odds 0.336 → 0.251; share 25.2% → 20.1%). This is the supply side of the fee change: casual sellers list less (Q1). Accept a drop of 4-7 points in casual share starting mid-July.
- **Evidence:** H1-seller-fee-change (buyer side); Insights, `listing viewed`, breakdown `seller_type`, % of total, weekly; `-- STORY H1` and `-- EVAL Q18`.
- **Context needed:** 02-timeline.md (fee change), 01-business.md (seller types).
- **Grading:** must tie the shift to mid-July and the fee change. Wrong: "no change"; attributing it to Back to Campus (it starts three weeks earlier).

### Q19 — What should we worry about?
- **Prompt:** "Looking at the summer, what should we be most worried about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names at least three of these, with numbers: (1) **Slow deliveries from casual sellers** cost repeat buyers: 28.1% of casual-seller orders take more than 7 days vs 5.3% for Pro, and a late first delivery cuts 30-day repurchase from 60.3% to 34.1% (0.56x). (2) **TikTok** is 36% of paid signups but only 36.2% of its signups buy within 14 days; per activated buyer it costs more than Google Shopping ($16.31 vs $14.92), about the same as Meta ($16.58), although it looks cheapest per signup. (3) **Casual supply** fell about 25% per seller after the fee change and casual share of GMV dropped from 25% to 20%; the fee rise roughly breaks even against that loss. (4) **Payment reliability**: one processor incident cost about 290 purchases in five days; card is the largest method. Good answers also note the wins to keep (Express Checkout +13% conversion, Guarantee lifting $150+ checkouts, offers at 80%+ of ask).
- **Evidence:** H1, H5, H6, H7 stories; `-- EVAL Q19`, Q1, Q2, Q6, Q8, Q16.
- **Context needed:** all guides.
- **Grading:** reward specific, quantified risks tied to data. Wrong: generic advice without numbers; calling disputes or regions a problem (Q12, Q13 are nulls).

### Q20 — Where are we losing purchases?
- **Prompt:** "Where in the buying process do we lose the most purchases right now, and what would you fix first?"
- **Type:** open-ended
- **Answer:** In September there were 14,216 checkouts and 9,712 purchases (about a third of checkouts do not finish), and 8,135 offers of which 3,427 were accepted (42%). The biggest levers: (1) ship **Express Checkout** to everyone (+13% checkout conversion in the test; about half of September checkouts were still in Control); (2) steer offers toward **80-85% of asking** (offers below 80% are accepted about 21% of the time vs 64% at 80%+); (3) make **card payments resilient** (card is the largest method: 1,223 high-ticket and 5,603 low-ticket card checkouts in September; the incident pulled September low-ticket card conversion to 65.4% vs 69-71% for the other methods). After the Guarantee, high-ticket checkouts no longer lag (68-74% in September). Accept any well-argued ordering that uses these numbers.
- **Evidence:** H2, H3, H6, H8 stories; `-- EVAL Q20`, Q3, Q4.
- **Context needed:** 02-timeline.md, 03-event-dictionary.md, 04-metrics-and-tables.md.
- **Grading:** reward answers that size each lever with per-checkout or per-offer rates. Wrong: unique-member funnels that hide repeat checkouts; recommending the Guarantee as if not yet launched.
