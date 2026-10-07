# Driftway Travel (travel) — 20-question eval

- **Data:** `data/verify-travel` (full fidelity: 10,000 member profiles, 9,992 members with events, 4,979 new signups, 14,325 bookings, 1,551,549 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query (or the `-- STORY` query it names) in `dungeons/vertical/travel/travel.sql` on that data.
- **Stories:** ids refer to the `stories` export in `travel.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Did Flex Pay lift checkout conversion?
- **Prompt:** "We launched Flex Pay in July. Did more checkouts turn into bookings after that?"
- **Type:** trend
- **Answer:** Yes. Bookings per checkout rose from **50.0%** (Jun 4-Jul 13; 3,418 of 6,843 checkouts) to **60.5%** from launch day to Aug 17 (4,246 of 7,022), **1.21x**. Weekly rates sit at 49.6-51.2% before launch and 59.2-61.1% in the full weeks after; the step is at July 14. Flex Pay paid for **36%** of bookings after launch (35.6%; none before). The weekly line moves again later for other reasons: it dips the week of Aug 17 (51%, the website payment incident) and rises to about 65-69% from the week of Aug 24 (the All-in Pricing test, where half of members convert more at checkout). Over the whole after-period (Jul 14-Oct 1) the rate is 63.2% (1.26x). Accept 1.14x-1.28x for the launch effect; accept 1.26x for the whole after-period only if the answer notes the later changes.
- **Evidence:** H1-flex-pay-launch; Insights, `booking completed` / `checkout started`, weekly, breakdown `payment_method`; `-- STORY H1` and `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (launch date; incident and experiment dates), 04-metrics-and-tables.md (booking rate).
- **Grading:** must use a rate per checkout and a before/after split at Jul 14. Wrong: raw booking counts (members grow over the window); crediting the late-August rise to Flex Pay; claiming no change.

### Q2 — What did the August payment incident cost?
- **Prompt:** "Our payment gateway had an incident in August. How many bookings did we lose, and was it only the website?"
- **Type:** external-join
- **Answer:** It was a website problem, Aug 18-21. On those days web bookings per checkout fell to **24.2%** (113 bookings from 467 web checkouts; 20-31% each day) against **62.2%** on the website in the 14 days either side. App checkouts converted at 63.7% over the four days (432 checkouts; 60-67% a day), in line with the app's 61.4% the week before (53-67% a day) and 63.9% over the 14 days either side, with no gateway errors. Relative to the app, web conversion fell to **0.39x** of normal. That is about **177 lost web bookings**, roughly **$187,000** of booking value (about $28,000 of commission at 15%). 222 `payment failed` events with `error_code = gateway_timeout` appeared, all on the web, only on those four days, and across every payment method (152 credit card, 44 PayPal, 26 Apple Pay or Google Pay). `payment_gateway_daily` shows `gateway_status = degraded` for web on Aug 18-21 only, with approval rate 0.40-0.43 (normal about 0.92) and p95 latency about 18 s, on 74 web attempts a day vs about 82 in the weeks around it; iOS and Android stay `operational` with normal approval. A warehouse-only estimate agrees: 295 web attempts on the degraded days at the web's normal 0.920 approval rate would have given about 271 approvals instead of 123, so about **148 lost approved payments**. Accept 130-200 lost bookings (from events or from the warehouse) and $140K-$220K.
- **Evidence:** H2-web-payment-incident; Insights, `booking completed` / `checkout started` by `platform`, daily; `payment failed` by `error_code`; warehouse `payment_gateway_daily`; `-- STORY H2` and `-- EVAL Q2`.
- **Context needed:** 02-timeline.md (incident window), 04-metrics-and-tables.md (`payment_gateway_daily`).
- **Grading:** must quantify lost bookings against a baseline and show from the data that the app was not part of the incident (no gateway timeouts, operational gateway rows, app conversion at its normal level). Accept the warehouse-based estimate (attempts × normal approval rate − approvals, about 148) as the lost-bookings number. Do not require a comment on attempt volume. Wrong: blaming all platforms equally; using a single day; counting `payment failed` events as the lost bookings (not every failed checkout logs one); treating approvals and Mixpanel bookings as the same count (approvals run about 5% above bookings); calling it a card-only outage (PayPal and wallet payments timed out too).

### Q3 — Which paid channel gives the cheapest bookers?
- **Prompt:** "Which paid channel gives us the cheapest new customers? Is TikTok as cheap as it looks?"
- **Type:** external-join
- **Answer:** TikTok is the cheapest per signup and **not** per booker. For signups Jun 4-Aug 31 with a full 30-day window: spend per Mixpanel signup **$9.90 TikTok**, $13.77 Meta, $26.10 Google Hotel Ads; only **22.4%** of TikTok signups booked within 30 days vs 43.7% for Meta and 49.1% for Google (47.3% for all other channels), so spend per booker is **$31.55 Meta**, **$44.13 TikTok** (1.40x Meta), **$53.14 Google**. Over the whole window (all signups, any booking) the order is the same: $24.82 Meta, $33.45 TikTok, $43.75 Google per booker (TikTok booker rate 29.4% vs 58.7% for all other channels). TikTok signups search about as often as other new members (16.8 vs 16.5 searches each in the window) but rarely start checkout. Recommendation: Meta is the most efficient; TikTok's cheap signups mostly browse, so TikTok costs about 40% more per booker than Meta; Google is the most expensive per booker. Accept TikTok 0.38x-0.58x of other channels' booker rate, Meta < TikTok < Google per booker, and TikTok 1.2x-1.7x of Meta per booker.
- **Evidence:** H3-paid-channel-economics; Funnels, `account created` → `booking completed`, 30-day window, breakdown `acquisition_channel`, joined to `marketing_spend_daily.spend_usd`; `-- STORY H3` and `-- EVAL Q3`.
- **Context needed:** 01-business.md (channels), 04-metrics-and-tables.md (CAC, cost per booker, `marketing_spend_daily`).
- **Grading:** must join spend to Mixpanel signups and bookers. Wrong: using `signups_reported` from the networks; ranking by cost per signup only; including signups from September (incomplete windows) without saying so.

### Q4 — Which bookings cancel?
- **Prompt:** "Do bookings made far in advance get cancelled more? Break down cancellations by how far ahead people book."
- **Type:** funnel
- **Answer:** Yes, strongly. Share of bookings (Jun 4-Aug 31) cancelled within 30 days, excluding hurricane weather cancellations: **0-6 days lead 4.2%**, **7-29 days 11.8%**, **30-59 days 21.0%**, **60+ days 29.6%**; the 60+ bucket cancels **2.5x** as often as 7-29 days (2.50x). The pattern holds on both rate types (free cancellation: 5.3%, 15.3%, 28.4%, 38.9%). Overall 14.0% of bookings cancel within 30 days (13.1% of all bookings have a cancellation in the window). Accept a monotonic rise with 60+ at 2.1x-3.2x of 7-29; accept other reasonable lead buckets if the rise is shown per booking.
- **Evidence:** H4-lead-time-cancellations; Funnels, `booking completed` → `booking cancelled` (reason ≠ weather), Totals, hold `booking_id` constant, 30-day window, breakdown `lead_time_days` custom buckets; `-- STORY H4` and `-- EVAL Q4`.
- **Context needed:** 03-event-dictionary.md (`lead_time_days`), 04-metrics-and-tables.md (cancellation rate).
- **Grading:** must compute a per-booking rate by lead bucket. Wrong: counting cancellations without a booking denominator; including weather cancellations without saying so; using `days_before_check_in` (time from cancellation, not from booking).

### Q5 — Does the non-refundable rate matter?
- **Prompt:** "How much less do non-refundable bookings get cancelled than free-cancellation ones?"
- **Type:** segmentation
- **Answer:** Non-refundable bookings cancel about a fifth as often: **3.9%** vs **18.3%** within 30 days (bookings Jun 4-Aug 31, weather excluded), **0.21x**. Within the lead buckets the ratio is about 0.18-0.25 (for example 60+ days: 7.1% vs 38.9%). Non-refundable rates are 30% of bookings and cost 10% less per night ($228.29 vs $251.54 average). Refunds paid in the window: $2.06M on free-cancellation bookings, $18.3K on non-refundable bookings (all of it from the hurricane fee waiver). Accept 0.15x-0.33x.
- **Evidence:** H4-lead-time-cancellations; Funnels as in Q4, breakdown `refundable`; `-- STORY H4` and `-- EVAL Q5`.
- **Context needed:** 01-business.md (rate types), 03-event-dictionary.md (`refundable`, `refund_amount`).
- **Grading:** must compare per-booking rates. Wrong: "non-refundable bookings never cancel"; comparing cancellation counts.

### Q6 — Should we ship All-in Pricing?
- **Prompt:** "Is the All-in Pricing test working? Should we show the full price everywhere?"
- **Type:** funnel
- **Answer:** It moves the funnel in two directions and comes out ahead. For search sessions Aug 25-Sep 23 (7-day window, per `search_id`): sessions reaching checkout **9.8% vs 11.3%** (**0.87x**, fewer people start checkout once they see the full price), and checkouts that book **76.9% vs 59.9%** (**1.28x**, fewer surprises at payment). Net bookings per search **7.56% vs 6.76%** (**1.12x**), booked value per search **$79.15 vs $69.20** (+14%). The split is balanced (4,677 vs 4,761 exposed members), and the same two groups of members behaved alike before the test (Jul 14-Aug 17: checkout rate 1.01x, net bookings per search 1.03x), so the gain is not a member-mix artifact; against that baseline the net change is about 1.08x. A unique-member funnel (Uniques, same steps and window, re-entry after an expired window) shows the same two directions with smaller gaps: members reaching checkout 41.0% vs 44.4%, members who booked 34.0% vs 32.2%. Recommend shipping, and watch the checkout-start metric so nobody reads the lower checkout rate as a loss. Accept checkout 0.75x-0.92x, booking 1.17x-1.43x, net 1.0x-1.2x (positive); accept the unique-member reading if both directions are reported.
- **Evidence:** H5-all-in-pricing-experiment; Funnels, `destination searched` → `checkout started` → `booking completed`, Totals, hold `search_id` constant, 7-day window, breakdown `Experiment: All-in Pricing` (or the Experiments report on `$experiment_started`); `-- STORY H5` and `-- EVAL Q6` (the pre-test comparison and the unique-member funnel are the last two Q6 queries).
- **Context needed:** 02-timeline.md (start date, arms), 03-event-dictionary.md (funnel, `search_id`).
- **Grading:** must report both steps and the net effect. Wrong: judging only on checkout starts ("the variant loses"); calling the test flat from the unique-member booked share alone; including sessions before Aug 25.

### Q7 — How long do travelers take to book?
- **Prompt:** "How long does it take from searching to booking, and does it differ by type of traveler?"
- **Type:** funnel
- **Answer:** Per search session (search → booking, same `search_id`, 14-day window, searches through Sep 16), the median is **2.0 h for business travelers** (1.99), **about 4 h for couples and solo travelers** (4.09 and 3.90; 4.02 together), and **7.4 h for families** (7.44): business travelers book in about half the time (0.50x) and families take about 1.85x as long. 32% of business bookings come within an hour of the search vs 8% for families; the 75th percentile is 5.6 h for business and 20.6 h for families. Accept business 0.43x-0.57x and family 1.6x-2.1x of couples/solo.
- **Evidence:** H6-booking-speed-by-segment; Funnels, `destination searched` → `booking completed`, Totals, hold `search_id` constant, median time to convert, breakdown `traveler_segment`; `-- STORY H6` and `-- EVAL Q7`.
- **Context needed:** 01-business.md (segments), 03-event-dictionary.md (`search_id`).
- **Grading:** must measure within a session. Wrong: a unique-member funnel from the first search to the first booking (mixes sessions); averages instead of medians without saying so.

### Q8 — What happens after a bad stay?
- **Prompt:** "Do guests who have a bad stay keep booking with us?"
- **Type:** retention
- **Answer:** About half of them stop. Among members whose first review in the window (on or before Sep 1) was **1-2 stars, 47.0%** (of 402) searched again on days 7-29 afterwards vs **94.8%** (of 2,072) after a 3-5 star first review (**0.50x**). By rating: 1★ 47.7%, 2★ 46.5%, 3★ 94.4%, 4★ 94.1%, 5★ 95.7%; the break is between 2 and 3 stars. 16% of reviews are 1-2 stars. Accept 0.38x-0.62x, and other later brackets (for example week 2-4) if the gap is shown.
- **Evidence:** H7-bad-stay-churn; Retention, birth `review submitted` (first time), return `destination searched`, custom bracket day 7-29, breakdown `rating`; `-- STORY H7` and `-- EVAL Q8`.
- **Context needed:** 04-metrics-and-tables.md (active traveler excludes notifications and check-ins), 03-event-dictionary.md (`rating`).
- **Grading:** must use a return event that is user-initiated and split by rating. Wrong: counting `notification received` or `check in completed` as a return (they continue after a member leaves); including reviews from late September when the bracket is incomplete.

### Q9 — Do listings with few reviews get booked?
- **Prompt:** "Do new properties with only a few reviews convert worse than established ones? Is there a magic number of reviews?"
- **Type:** segmentation
- **Answer:** Yes. Checkouts per property view: **1.32%** for listings showing 0-9 reviews, **2.54%** for 10-49, **3.41%** for 50+ (**0.39x** and **0.75x** of 50+). Finer buckets show where it moves: 0-4: 1.18%, 5-7: 1.36%, 8-9: 1.63%, 10-12: 2.02%, 13-24: 2.45%, 25-39: 2.56%, 40-49: 2.84%, 50-64: 3.18%, 65-99: 3.44%, 100+: 3.51%. The steepest climb is from about 8 to 13 reviews, a second rise runs from about 40 to 65, and it flattens above roughly 65-100 reviews. So "about 10 reviews" is the first magic number and "about 50" the second. 11% of property views land on listings with fewer than 10 reviews (mostly new listings). Accept 0-9 at 0.33x-0.47x and 10-49 at 0.67x-0.83x of 50+, with the big step near 10 reviews and a plateau somewhere above 50.
- **Evidence:** H8-review-count-threshold; Insights, `checkout started` / `property viewed`, breakdown `review_count` custom buckets; `-- STORY H8` and `-- EVAL Q9`.
- **Context needed:** 03-event-dictionary.md (`review_count` is the count shown that day), 01-business.md (new listings start with no reviews).
- **Grading:** must normalize by views. Wrong: checkouts per property (popular properties get more views); "more reviews is always better" with no plateau; a property-level average of `review_count` over the whole window (the count grows, so use the value on each event).

### Q10 — How did Hurricane Delia hit the Caribbean?
- **Prompt:** "How badly did the September hurricane hurt our Caribbean business?"
- **Type:** external-join
- **Answer:** Sharply, for exactly the warning days Sep 9-13 (`weather_advisory = hurricane_warning` in `destination_supply_daily`, where Caribbean rooms listed fell to about 11,000 from about 18,500, 0.60x). Caribbean searches fell to 116-143 a day from 231-323 the week before (642 searches over the five days; relative to other regions and the 14 days either side, **0.48x**). The searches that remained rarely reached checkout: 14 Caribbean checkouts in five days (2.2% of searches vs about 10.8% normally; relative to other regions about 0.20x), and Caribbean bookings fell to 0-5 a day from 11-30. On top of that, 43 of the 60 eligible Caribbean stays in the storm window were cancelled for weather (Q11). Everything was back to normal on Sep 14. Accept searches 0.40x-0.60x.
- **Evidence:** H9-hurricane-delia; Insights, `destination searched` and `checkout started` by `region`, daily, joined to `destination_supply_daily.weather_advisory`; `-- STORY H9` and `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (storm dates, destinations), 04-metrics-and-tables.md (`destination_supply_daily`).
- **Grading:** grade mainly on the search drop (a rate relative to other regions or to the weeks around the storm) and on the weather cancellations. The checkout-per-search ratio rests on 14 checkouts; treat it as directional (any clear drop is correct; do not require a number). Wrong: reading `room_nights_booked` as Driftway app bookings; attributing the drop to Labor Day.

### Q11 — How many Caribbean stays were cancelled for the storm?
- **Prompt:** "How many Caribbean bookings did we lose to cancellations because of Hurricane Delia, and how much did we refund?"
- **Type:** context
- **Answer:** **44 weather cancellations** (Sep 7-9), refunding **$55,151**. Of the 69 in-window Caribbean bookings checking in Sep 9-13 that were made before Sep 7, 9 had already been cancelled for other reasons; of the remaining 60, **43 (72%)** cancelled for weather ($54,251 refunded), 16 checked in, and 1 was cancelled for another reason. The other weather cancellation is a stay booked before June 4. Accept 37-51 cancellations and 60%-85% of eligible stays.
- **Evidence:** H9-hurricane-delia; Insights, `booking cancelled` where `cancellation_reason = weather`, sum of `refund_amount`; `-- EVAL Q11`.
- **Context needed:** 02-timeline.md (fee waiver from Sep 7), 03-event-dictionary.md (`cancellation_reason`, `refund_amount`).
- **Grading:** must use the weather reason. Wrong: all Caribbean cancellations in September; ignoring refunds on non-refundable rates (the waiver refunded them).

### Q12 — Did the Summer Kickoff Sale pay off?
- **Prompt:** "Did the Summer Kickoff Sale in June actually bring in more bookings, or did we just give away 15%?"
- **Type:** trend
- **Answer:** It brought real extra bookings. During Jun 24-28 search sessions reached checkout **15.6%** of the time vs **11.1%** in the 14 days either side (**1.40x**), and bookings per day rose to **126.4 from 80.6** (1.57x). The booked nightly rate fell to **$209 from $249** (0.84x, the discount). Booking value per day still rose to **$112,177 from $85,116** (+32%), so commission per day rose too. Searches per day rose about 9% (1,594 vs 1,463), helped by the campaign: 9,279 sale emails to 4,676 members and 5,876 pushes to 2,959 members. 632 bookings used SUMMERKICKOFF. Accept checkout lift 1.25x-1.55x and value per day up 15%-45%.
- **Evidence:** H10-summer-kickoff-sale; Insights, `checkout started` / `destination searched` and average `nightly_rate` on `booking completed`, daily Jun 10-Jul 12; `notification received` by `campaign`; `-- STORY H10` and `-- EVAL Q12`.
- **Context needed:** 02-timeline.md (sale dates, sends), 01-business.md (commission model).
- **Grading:** must separate more bookings from cheaper bookings. Wrong: counting promo bookings as incremental; comparing the sale with the July weeks after Flex Pay without saying so.

### Q13 — How healthy are payments normally?
- **Prompt:** "What's our normal payment approval rate, and does it differ between the apps and the website?"
- **Type:** external-join
- **Answer:** About **92%** on every platform on normal days: iOS 0.920, Android 0.921, web 0.920 (weighted by attempts), with p95 authorization latency about 1.1-1.2 s. The only exception is the website on Aug 18-21 (`gateway_status = degraded`): approval 0.42 and p95 latency about 18 s. Accept 0.90-0.94 and no meaningful platform difference outside the incident.
- **Evidence:** H2-web-payment-incident (warehouse side); `payment_gateway_daily`; `-- EVAL Q13`.
- **Context needed:** 04-metrics-and-tables.md (`payment_gateway_daily`, payment approval rate).
- **Grading:** must exclude or call out the degraded days. Wrong: a web average that silently includes the incident; using Mixpanel `payment failed` counts as the approval rate.

### Q14 — Did All-in Pricing push travelers to cheaper rooms? (null)
- **Prompt:** "With All-in Pricing showing higher prices up front, are travelers in that group picking cheaper places to stay?"
- **Type:** null-hypothesis
- **Answer:** No meaningful effect. Average booked `nightly_rate` for bookings from Aug 25 by enrolled members: **$244.76 All-in Pricing vs $244.95 Control** (difference −$0.19, z = −0.09, p ≈ 0.93). The null holds on the website (z = 0.42), in the apps (z = −0.54), and in every traveler segment (|z| ≤ 1.15, none significant). Booking value per booking is $1,046 vs $1,018 (z = 1.71, p ≈ 0.09, not significant); that small gap comes from stay length (3.68 vs 3.57 nights), not from the nightly rate. The test changes how many sessions start checkout and how many checkouts book, not which properties people choose.
- **Evidence:** none engineered (control for H5); Insights, average `nightly_rate` on `booking completed`, breakdown `Experiment: All-in Pricing`, from Aug 25; `-- EVAL Q14`.
- **Context needed:** 02-timeline.md (test design).
- **Grading:** must say no meaningful difference and give the size. Wrong: "variant travelers choose cheaper rooms" (the rates differ by less than a dollar); treating the booking-value gap (p ≈ 0.09, driven by nights) as a pricing effect.

### Q15 — Do members outside the US cancel more? (null)
- **Prompt:** "Our members in London, Manchester, and Toronto book from further away. Do they cancel more often than US-based members?"
- **Type:** null-hypothesis
- **Answer:** No. 30-day cancellation rate (bookings Jun 4-Aug 31, weather excluded): **14.0% for members based in London, Manchester, or Toronto vs 14.0% for US-based members** (13.95% both; 1,556 vs 7,929 bookings; z = 0.00). No lead bucket, rate type, or platform shows a significant difference (|z| ≤ 1.56; for example 60+ days lead 32.6% vs 29.0% on only 221 international bookings, non-refundable 3.7% vs 3.9%, apps 15.2% vs 14.8%). What drives cancellations is lead time and rate type, not where the member lives.
- **Evidence:** none engineered (control for H4); Funnels, `booking completed` → `booking cancelled` (reason ≠ weather), Totals, hold `booking_id` constant, 30-day window, breakdown user property `home_market`; `-- EVAL Q15`.
- **Context needed:** 01-business.md (home markets), 04-metrics-and-tables.md (cancellation rate).
- **Grading:** must give rates and say no meaningful difference. Wrong: claiming international members cancel more (or less); comparing cancellation counts (US members make most bookings).

### Q16 — Where does booking value come from?
- **Prompt:** "Which regions bring in the most booking value?"
- **Type:** segmentation
- **Answer:** Booking value in the window (before cancellations): **US cities $4.51M** (5,204 bookings, 36% of bookings), **US beaches $3.30M** (2,674), **Europe $2.94M** (3,081), **Caribbean $2.27M** (1,741; highest nightly rate, $271), **mountains $1.84M** (1,625). Total $14.85M. Accept the ranking and values within 5%.
- **Evidence:** descriptive; Insights, sum of `total_price` on `booking completed`, breakdown `region`; `-- EVAL Q16`.
- **Context needed:** 01-business.md (regions, commission), 04-metrics-and-tables.md (booking value).
- **Grading:** must use `total_price`. Wrong: counting bookings only; summing `nightly_rate`.

### Q17 — How big is the member base?
- **Prompt:** "How many members were active this summer, how many are new, and how many booked?"
- **Type:** context
- **Answer:** **9,992 members** had activity (10,000 member profiles); **4,979** created their account in the window (about 290 a week); **5,865** members booked at least once (14,325 bookings worth $14.85M before cancellations). Accept within 2%.
- **Evidence:** descriptive; Insights uniques on all events, `account created`, `booking completed`; `-- EVAL Q17`.
- **Context needed:** 00-manifest.md (identity: merged anonymous browsing).
- **Grading:** must count resolved members. Wrong: counting device IDs (inflates people because pre-signup browsing is anonymous and members use two devices).

### Q18 — How do traveler segments differ?
- **Prompt:** "Give me a quick profile of our traveler segments: how many, how much they book, how far ahead, how long they stay."
- **Type:** segmentation
- **Answer:** business 2,079 members, 3,959 bookings, median lead 5 days, 2.0 nights; couple 3,032 members, 4,166 bookings, 23 days, 3.5 nights; family 2,389 members, 2,570 bookings, 50 days, 6.0 nights; solo 2,500 members, 3,630 bookings, 13 days, 4.0 nights. Average nightly rate is about $242-247 in every segment. Business travelers book the most per member (1.9 bookings); families book furthest ahead (median 50 days). Accept within 5%.
- **Evidence:** descriptive; Insights on `booking completed` by user property `traveler_segment`; `-- EVAL Q18`.
- **Context needed:** 01-business.md (segments).
- **Grading:** must use the profile segment. Wrong: inferring segment from `guests` alone.

### Q19 — What should we worry about this quarter?
- **Prompt:** "Looking at the summer data, what should we worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names most of these, with numbers: (1) **Bad stays drive churn** — about half of members with a 1-2 star first review stop searching (47% vs 95% return, Q8), and 16% of reviews are 1-2 stars. (2) **Long-lead cancellations** — 60+ day bookings cancel 30% of the time within 30 days, and free-cancellation rates cancel about 4.7x as often as non-refundable (Q4, Q5). (3) **Payment reliability** — four degraded website days cost about 177 bookings and $187K (Q2); monitor gateway status. (4) **TikTok efficiency** — cheapest per signup but 22% of signups book within 30 days vs 47%, so it costs about 40% more per booker than Meta ($44 vs $32, Q3). (5) **Thin-review supply** — listings under 10 reviews convert at 0.39x and take 11% of property views (Q9); new listings need their first reviews. Paid spend is 52% Google, 28% Meta, 20% TikTok, so the most expensive channel per booker (Google) takes most of the budget. (6) **Ship All-in Pricing** with the right success metric (Q6). Weather risk for the Caribbean in hurricane season (Q10) is a fair extra.
- **Evidence:** H2, H3, H4, H5, H7, H8, H9; `-- EVAL Q19` plus the queries cited.
- **Context needed:** all guides.
- **Grading:** must rank issues with evidence. Wrong: generic advice with no numbers; "conversion is falling" (it rose).

### Q20 — Where do we lose travelers in the booking funnel?
- **Prompt:** "Walk me through our booking funnel. Where are we losing people?"
- **Type:** open-ended
- **Answer:** Per search session (Jun 4-Sep 23, 7-day window, 197,494 sessions, 3.96 property views per session on average): **11.2%** reach checkout and **58.7%** of checkouts book, so **6.6%** of sessions end in a booking (6.55%). The big loss is between browsing and checkout. Things that move it: listings with few reviews (Q9), the sale (Q12), All-in Pricing (Q6), Caribbean demand during the storm (Q10). Checkout → booking moved with Flex Pay (Q1), the payment incident (Q2), and All-in Pricing (Q6). Accept search → checkout 9%-12.5%, checkout → booking 55%-62%, search → booking 5.3%-7.5%.
- **Evidence:** Funnels, `destination searched` → `checkout started` → `booking completed`, Totals, hold `search_id` constant, 7-day window; `-- EVAL Q20`.
- **Context needed:** 03-event-dictionary.md (funnels), 04-metrics-and-tables.md (KPIs).
- **Grading:** must measure per session. Wrong: a unique-member funnel only (about half of members book at least once, which hides the per-session loss); counting property views as steps of separate sessions.
