# Driftway Travel (travel) — 20-question eval

- **Data:** `data/verify-travel` (full fidelity: 10,000 generated profiles, 9,999 sent to Mixpanel, 9,988 members with events, 5,023 new signups, 20,698 bookings, 1,478,087 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query (or the `-- STORY` query it names) in `dungeons/vertical/travel/travel.sql` on that data.
- **Stories:** ids refer to the `stories` export in `travel.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Did Flex Pay lift checkout conversion?
- **Prompt:** "We launched Flex Pay in July. Did more checkouts turn into bookings after that?"
- **Type:** trend
- **Answer:** Yes. Bookings per checkout rose from **54.8%** (Jun 4-Jul 13; 5,620 of 10,262 checkouts) to **65.2%** from launch day to Aug 17 (6,434 of 9,863), **1.19x**. Weekly rates sit at 53-57% before launch and 64-67% in the full weeks after; the step is at July 14. Flex Pay paid for **35%** of bookings after launch (34.7%; none before). The weekly line moves again later for other reasons: it dips the week of Aug 17 (51%, the website payment incident) and rises to about 73-76% from the week of Aug 24 (the All-in Pricing test, where half of members convert more at checkout). Over the whole after-period (Jul 14-Oct 1) the rate is 68.3% (1.25x). Accept 1.14x-1.25x for the launch effect; accept 1.25x for the whole after-period only if the answer notes the later changes.
- **Evidence:** H1-flex-pay-launch; Insights, `booking completed` / `checkout started`, weekly, breakdown `payment_method`; `-- STORY H1` and `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (launch date; incident and experiment dates), 04-metrics-and-tables.md (booking rate).
- **Grading:** must use a rate per checkout and a before/after split at Jul 14. Wrong: raw booking counts (members grow over the window); crediting the late-August rise to Flex Pay; claiming no change.

### Q2 — What did the August payment incident cost?
- **Prompt:** "Our payment gateway had an incident in August. How many bookings did we lose, and was it only the website?"
- **Type:** external-join
- **Answer:** It was a website problem, Aug 18-21. On those days web bookings per checkout fell to **28.6%** (193 bookings from 674 web checkouts; 25-32% each day) against **69.2%** on the website in the 14 days either side. App checkouts converted at 56.5% over the four days (51-61% a day), inside the app's normal day-to-day range (51-70% a day in the week before; 64% for that week) and with no gateway errors. Relative to the app, web conversion fell to **0.51x** of normal. That is about **274 lost web bookings**, roughly **$310,000** of booking value (about $46,000 of commission at 15%). 313 `payment failed` events with `error_code = gateway_timeout` appeared, all on the web and only on those four days. `payment_gateway_daily` shows `gateway_status = degraded` for web on Aug 18-21 only, with approval rate 0.42-0.47 (normal about 0.92) and p95 latency about 18 s; iOS and Android stay `operational` with normal approval. Accept 230-320 lost bookings and $260K-$360K.
- **Evidence:** H2-web-payment-incident; Insights, `booking completed` / `checkout started` by `platform`, daily; `payment failed` by `error_code`; warehouse `payment_gateway_daily`; `-- STORY H2` and `-- EVAL Q2`.
- **Context needed:** 02-timeline.md (incident window, website release), 04-metrics-and-tables.md (`payment_gateway_daily`).
- **Grading:** must quantify lost bookings against a baseline and show from the data that the app was not part of the incident (no gateway timeouts, operational gateway rows, app conversion within its normal daily range). Accept a note that app conversion was a little soft on those days if the answer does not call it an app outage. Wrong: blaming all platforms equally; using a single day; counting `payment failed` events as the lost bookings (not every failed checkout logs one).

### Q3 — Which paid channel gives the cheapest bookers?
- **Prompt:** "Which paid channel gives us the cheapest new customers? Is TikTok as cheap as it looks?"
- **Type:** external-join
- **Answer:** TikTok is the cheapest per signup and **not** per booker. For signups Jun 4-Aug 31 with a full 30-day window: spend per Mixpanel signup **$7.71 TikTok**, $13.89 Meta, $26.00 Google Hotel Ads; only **26.8%** of TikTok signups booked within 30 days vs 51.6% for Meta and 56.1% for Google (54.6% for all other channels), so spend per booker is **$26.94 Meta**, **$28.80 TikTok**, **$46.37 Google**. Over the whole window (all signups, any booking) the order is the same: $22.89 Meta, $24.72 TikTok, $42.75 Google per booker (TikTok booker rate 31.2% vs 61%). TikTok signups search about as often as other new members (14.8 vs 15.1 searches each in the window) but rarely start checkout. Recommendation: Meta is the most efficient; TikTok's cheap signups mostly browse; Google is the most expensive per booker. Accept TikTok 0.42x-0.58x of other channels' booker rate and Meta ≤ TikTok < Google per booker.
- **Evidence:** H3-paid-channel-economics; Funnels, `account created` → `booking completed`, 30-day window, breakdown `acquisition_channel`, joined to `marketing_spend_daily.spend_usd`; `-- STORY H3` and `-- EVAL Q3`.
- **Context needed:** 01-business.md (channels), 04-metrics-and-tables.md (CAC, cost per booker, `marketing_spend_daily`).
- **Grading:** must join spend to Mixpanel signups and bookers. Wrong: using `signups_reported` from the networks; ranking by cost per signup only; including signups from September (incomplete windows) without saying so.

### Q4 — Which bookings cancel?
- **Prompt:** "Do bookings made far in advance get cancelled more? Break down cancellations by how far ahead people book."
- **Type:** funnel
- **Answer:** Yes, strongly. Share of bookings (Jun 4-Aug 31) cancelled within 30 days, excluding hurricane weather cancellations: **0-6 days lead 4.3%**, **7-29 days 10.9%**, **30-59 days 20.3%**, **60+ days 31.8%**; the 60+ bucket cancels **2.9x** as often as 7-29 days. The pattern holds on both rate types (free cancellation: 5.7%, 13.9%, 26.5%, 41.7%). Overall 14.1% of bookings cancel within 30 days (13.5% of all bookings have a cancellation in the window). Accept a monotonic rise with 60+ at 2.4x-3.3x of 7-29; accept other reasonable lead buckets if the rise is shown per booking.
- **Evidence:** H4-lead-time-cancellations; Funnels, `booking completed` → `booking cancelled` (reason ≠ weather), Totals, hold `booking_id` constant, 30-day window, breakdown `lead_time_days` custom buckets; `-- STORY H4` and `-- EVAL Q4`.
- **Context needed:** 03-event-dictionary.md (`lead_time_days`), 04-metrics-and-tables.md (cancellation rate, lead-time buckets).
- **Grading:** must compute a per-booking rate by lead bucket. Wrong: counting cancellations without a booking denominator; including weather cancellations without saying so; using `days_before_check_in` (time from cancellation, not from booking).

### Q5 — Does the non-refundable rate matter?
- **Prompt:** "How much less do non-refundable bookings get cancelled than free-cancellation ones?"
- **Type:** segmentation
- **Answer:** Non-refundable bookings cancel about a quarter as often: **4.1%** vs **18.3%** within 30 days (bookings Jun 4-Aug 31, weather excluded), **0.22x**. Within every lead bucket the ratio is about 0.19-0.27 (for example 60+ days: 8.5% vs 41.7%). Non-refundable rates are 30% of bookings. Refunds paid in the window: $3.17M on free-cancellation bookings, $35K on non-refundable bookings (all of it from the hurricane fee waiver). Accept 0.17x-0.32x.
- **Evidence:** H4-lead-time-cancellations; Funnels as in Q4, breakdown `refundable`; `-- STORY H4` and `-- EVAL Q5`.
- **Context needed:** 01-business.md (rate types), 03-event-dictionary.md (`refundable`, `refund_amount`).
- **Grading:** must compare per-booking rates. Wrong: "non-refundable bookings never cancel"; comparing cancellation counts.

### Q6 — Should we ship All-in Pricing?
- **Prompt:** "Is the All-in Pricing test working? Should we show the full price everywhere?"
- **Type:** funnel
- **Answer:** It moves the funnel in two directions and wins overall. For search sessions Aug 25-Sep 23 (7-day window, per `search_id`): sessions reaching checkout **12.0% vs 14.8%** (**0.81x**, fewer people start checkout once they see the full price), and checkouts that book **85.7% vs 66.1%** (**1.30x**, fewer surprises at payment). Net bookings per search **10.3% vs 9.8%** (**1.05x**), booked value per search **$112.67 vs $106.65** (+6%). The split is balanced (4,478 vs 4,535 exposed members). A unique-member funnel (Uniques, same steps and window, re-entry after an expired window) shows the same two directions with smaller gaps: members reaching checkout 44.6% vs 48.8%, members who booked 40.8% vs 38.7%. Recommend shipping, and watch the checkout-start metric so nobody reads the lower checkout rate as a loss. Accept checkout 0.75x-0.93x, booking 1.17x-1.43x, net 1.0x-1.2x (positive); accept the unique-member reading if both directions are reported.
- **Evidence:** H5-all-in-pricing-experiment; Funnels, `destination searched` → `checkout started` → `booking completed`, Totals, hold `search_id` constant, 7-day window, breakdown `Experiment: All-in Pricing` (or the Experiments report on `$experiment_started`); `-- STORY H5` and `-- EVAL Q6` (the unique-member funnel is the last Q6 query).
- **Context needed:** 02-timeline.md (start date, arms), 03-event-dictionary.md (funnel, `search_id`).
- **Grading:** must report both steps and the net effect. Wrong: judging only on checkout starts ("the variant loses"); calling the test flat from the unique-member booked share alone; including sessions before Aug 25.

### Q7 — How long do travelers take to book?
- **Prompt:** "How long does it take from searching to booking, and does it differ by type of traveler?"
- **Type:** funnel
- **Answer:** Per search session (search → booking, same `search_id`, 14-day window, searches through Sep 16), the median is **2.0 h for business travelers** (1.96), **4.1 h for couples and solo travelers** (4.08 each), and **6.9 h for families** (6.85): business travelers book in about half the time (0.48x) and families take about 1.7x as long. 33% of business bookings come within an hour of the search vs 10% for families; the 75th percentile is 5.4 h for business and 17.5 h for families. Accept business 0.43x-0.55x and family 1.55x-2.0x of couples/solo.
- **Evidence:** H6-booking-speed-by-segment; Funnels, `destination searched` → `booking completed`, Totals, hold `search_id` constant, median time to convert, breakdown `traveler_segment`; `-- STORY H6` and `-- EVAL Q7`.
- **Context needed:** 01-business.md (segments), 03-event-dictionary.md (`search_id`).
- **Grading:** must measure within a session. Wrong: a unique-member funnel from the first search to the first booking (mixes sessions); averages instead of medians without saying so.

### Q8 — What happens after a bad stay?
- **Prompt:** "Do guests who have a bad stay keep booking with us?"
- **Type:** retention
- **Answer:** About half of them stop. Among members whose first review in the window (on or before Sep 1) was **1-2 stars, 44.5%** (of 562) searched again on days 7-29 afterwards vs **94.4%** (of 2,624) after a 3-5 star first review (**0.47x**). By rating: 1★ 42.5%, 2★ 45.8%, 3★ 94.7%, 4★ 94.4%, 5★ 94.2%; the break is between 2 and 3 stars. 17% of reviews are 1-2 stars. Accept 0.38x-0.60x, and other later brackets (for example week 2-4) if the gap is shown.
- **Evidence:** H7-bad-stay-churn; Retention, birth `review submitted` (first time), return `destination searched`, custom bracket day 7-29, breakdown `rating`; `-- STORY H7` and `-- EVAL Q8`.
- **Context needed:** 04-metrics-and-tables.md (active traveler excludes notifications and check-ins), 03-event-dictionary.md (`rating`).
- **Grading:** must use a return event that is user-initiated and split by rating. Wrong: counting `notification received` or `check in completed` as a return (they continue after a member leaves); including reviews from late September when the bracket is incomplete.

### Q9 — Do listings with few reviews get booked?
- **Prompt:** "Do new properties with only a few reviews convert worse than established ones? Is there a magic number of reviews?"
- **Type:** segmentation
- **Answer:** Yes, with two steps. Checkouts per property view: **1.9%** for properties with 0-9 reviews, **3.5%** for 10-49, **4.6%** for 50+ (**0.41x** and **0.75x** of 50+). Finer buckets are flat inside each step (0: 1.80%, 1-4: 1.89%, 5-9: 1.95%; 10-24: 3.51%, 25-49: 3.49%; 50-99: 4.69%, 100+: 4.61%), so the thresholds are 10 and 50 reviews. 16% of property views land on listings with fewer than 10 reviews. Accept 0-9 at 0.35x-0.47x and 10-49 at 0.68x-0.83x of 50+, with thresholds near 10 and 50.
- **Evidence:** H8-review-count-threshold; Insights, `checkout started` / `property viewed`, breakdown `review_count` custom buckets; `-- STORY H8` and `-- EVAL Q9`.
- **Context needed:** 03-event-dictionary.md (`review_count`).
- **Grading:** must normalize by views. Wrong: checkouts per property (popular properties get more views); "more reviews is always better" with no plateau.

### Q10 — How did Hurricane Delia hit the Caribbean?
- **Prompt:** "How badly did the September hurricane hurt our Caribbean business?"
- **Type:** external-join
- **Answer:** Sharply, for exactly the warning days Sep 9-13 (`weather_advisory = hurricane_warning` in `destination_supply_daily`, where Caribbean rooms listed fell to about 11,000 from about 18,500, 0.60x). Caribbean searches fell to 97-145 a day from 214-293 the week before (577 searches over the five days; relative to other regions and the 14 days either side, **0.46x**). The searches that remained rarely reached checkout: 18 Caribbean checkouts in five days (3.1% of searches vs 13.9% normally; relative to other regions about 0.24x), and Caribbean bookings fell to 0-6 a day from 20-35. On top of that, 65 of the 87 eligible Caribbean stays in the storm window were cancelled for weather (Q11). Everything was back to normal on Sep 14. Accept searches 0.40x-0.60x.
- **Evidence:** H9-hurricane-delia; Insights, `destination searched` and `checkout started` by `region`, daily, joined to `destination_supply_daily.weather_advisory`; `-- STORY H9` and `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (storm dates, destinations), 04-metrics-and-tables.md (`destination_supply_daily`).
- **Grading:** grade mainly on the search drop (a rate relative to other regions or to the weeks around the storm) and on the weather cancellations. The checkout-per-search ratio rests on 18 checkouts; treat it as directional (any clear drop is correct; do not require a number). Wrong: reading `room_nights_booked` as Driftway app bookings; attributing the drop to Labor Day.

### Q11 — How many Caribbean stays were cancelled for the storm?
- **Prompt:** "How many Caribbean bookings did we lose to cancellations because of Hurricane Delia, and how much did we refund?"
- **Type:** context
- **Answer:** **69 weather cancellations** (Sep 7-9), refunding **$88,560**. Of the 102 in-window Caribbean bookings checking in Sep 9-13 that were made before Sep 7, 15 had already been cancelled for other reasons; of the remaining 87, **65 (75%)** cancelled for weather ($82,909 refunded) and 22 checked in. The other 4 weather cancellations are stays booked before June 4. Accept 60-75 cancellations and 65%-82% of eligible stays.
- **Evidence:** H9-hurricane-delia; Insights, `booking cancelled` where `cancellation_reason = weather`, sum of `refund_amount`; `-- EVAL Q11`.
- **Context needed:** 02-timeline.md (fee waiver from Sep 7), 03-event-dictionary.md (`cancellation_reason`, `refund_amount`).
- **Grading:** must use the weather reason. Wrong: all Caribbean cancellations in September; ignoring refunds on non-refundable rates (the waiver refunded them).

### Q12 — Did the Summer Kickoff Sale pay off?
- **Prompt:** "Did the Summer Kickoff Sale in June actually bring in more bookings, or did we just give away 15%?"
- **Type:** trend
- **Answer:** It brought real extra bookings. During Jun 24-28 search sessions reached checkout **21.1%** of the time vs **15.5%** in the 14 days either side (**1.36x**), and bookings per day rose to **192.6 from 134.9** (1.43x). The booked nightly rate fell to **$213 from $255** (0.84x, the discount). Booking value per day still rose to **$175,912 from $150,039** (+17%), so commission per day rose too. Searches per day rose about 3% (1,652 vs 1,598), helped by the campaign: 9,080 sale emails to 4,583 members and 5,708 pushes to 2,881 members. 963 bookings used SUMMERKICKOFF. Accept checkout lift 1.25x-1.5x and value per day up 10%-30%.
- **Evidence:** H10-summer-kickoff-sale; Insights, `checkout started` / `destination searched` and average `nightly_rate` on `booking completed`, daily Jun 10-Jul 12; `notification received` by `campaign`; `-- STORY H10` and `-- EVAL Q12`.
- **Context needed:** 02-timeline.md (sale dates, sends), 01-business.md (commission model).
- **Grading:** must separate more bookings from cheaper bookings. Wrong: counting promo bookings as incremental; comparing the sale with the July weeks after Flex Pay without saying so.

### Q13 — How healthy are card payments normally?
- **Prompt:** "What's our normal card approval rate, and does it differ between the apps and the website?"
- **Type:** external-join
- **Answer:** About **92%** on every platform on normal days: iOS 0.920, Android 0.921, web 0.921 (weighted by attempts), with p95 authorization latency about 1.1-1.2 s. The only exception is the website on Aug 18-21 (`gateway_status = degraded`): approval 0.44 and p95 latency about 18 s. Accept 0.90-0.94 and no meaningful platform difference outside the incident.
- **Evidence:** H2-web-payment-incident (warehouse side); `payment_gateway_daily`; `-- EVAL Q13`.
- **Context needed:** 04-metrics-and-tables.md (`payment_gateway_daily`, card approval rate).
- **Grading:** must exclude or call out the degraded days. Wrong: a web average that silently includes the incident; using Mixpanel `payment failed` counts as the approval rate.

### Q14 — Did All-in Pricing push travelers to cheaper rooms? (null)
- **Prompt:** "With All-in Pricing showing higher prices up front, are travelers in that group picking cheaper places to stay?"
- **Type:** null-hypothesis
- **Answer:** No meaningful effect. Average booked `nightly_rate` for bookings from Aug 25 by enrolled members: **$253.00 All-in Pricing vs $253.98 Control** (difference −$0.98, z = −0.53, p ≈ 0.6). The null holds on the website (z = −0.63), in the apps (z = −0.06), and in every traveler segment (|z| ≤ 1.21). Booking value per booking is also flat ($1,102 vs $1,106, z = −0.29), and stays are the same length (3.74 nights each). The test changes how many sessions start checkout and how many checkouts book, not which properties people choose.
- **Evidence:** none engineered (control for H5); Insights, average `nightly_rate` on `booking completed`, breakdown `Experiment: All-in Pricing`, from Aug 25; `-- EVAL Q14`.
- **Context needed:** 02-timeline.md (test design).
- **Grading:** must say no meaningful difference and give the size. Wrong: "variant travelers choose cheaper rooms"; treating a $1 difference as a finding.

### Q15 — Do members outside the US cancel more? (null)
- **Prompt:** "Our members in London, Manchester, and Toronto book from further away. Do they cancel more often than US-based members?"
- **Type:** null-hypothesis
- **Answer:** No. 30-day cancellation rate (bookings Jun 4-Aug 31, weather excluded): **13.6% for members based in London, Manchester, or Toronto vs 14.2% for US-based members** (2,469 vs 12,086 bookings; z = −0.70, p ≈ 0.48). No lead bucket, rate type, or platform shows a difference (|z| ≤ 1.07; for example 60+ days lead 31.6% vs 31.8%, non-refundable 4.1% vs 4.1%, website 14.3% vs 14.3%). What drives cancellations is lead time and rate type, not where the member lives.
- **Evidence:** none engineered (control for H4); Funnels, `booking completed` → `booking cancelled` (reason ≠ weather), Totals, hold `booking_id` constant, 30-day window, breakdown user property `home_market`; `-- EVAL Q15`.
- **Context needed:** 01-business.md (home markets), 04-metrics-and-tables.md (cancellation rate).
- **Grading:** must give rates and say no meaningful difference. Wrong: claiming international members cancel more (or less); comparing cancellation counts (US members make most bookings).

### Q16 — Where does booking value come from?
- **Prompt:** "Which regions bring in the most booking value?"
- **Type:** segmentation
- **Answer:** Booking value in the window (before cancellations): **US cities $6.72M** (7,430 bookings, 36% of bookings), **US beaches $5.02M** (3,862), **Europe $4.16M** (4,167), **Caribbean $3.76M** (2,675; highest nightly rate, $282), **mountains $3.06M** (2,564). Total $22.71M. Accept the ranking and values within 5%.
- **Evidence:** descriptive; Insights, sum of `total_price` on `booking completed`, breakdown `region`; `-- EVAL Q16`.
- **Context needed:** 01-business.md (regions, commission), 04-metrics-and-tables.md (booking value).
- **Grading:** must use `total_price`. Wrong: counting bookings only; summing `nightly_rate`.

### Q17 — How big is the member base?
- **Prompt:** "How many members were active this summer, how many are new, and how many booked?"
- **Type:** context
- **Answer:** **9,988 members** had activity (9,999 member profiles); **5,023** created their account in the window (about 290 a week); **6,433** members booked at least once (20,698 bookings worth $22.71M before cancellations). Accept within 2%.
- **Evidence:** descriptive; Insights uniques on all events, `account created`, `booking completed`; `-- EVAL Q17`.
- **Context needed:** 00-manifest.md (identity: merged anonymous browsing).
- **Grading:** must count resolved members. Wrong: counting device IDs (inflates people because pre-signup browsing is anonymous and members use two devices).

### Q18 — How do traveler segments differ?
- **Prompt:** "Give me a quick profile of our traveler segments: how many, how much they book, how far ahead, how long they stay."
- **Type:** segmentation
- **Answer:** business 1,982 members, 5,399 bookings, median lead 5 days, 2.0 nights; couple 3,012 members, 6,258 bookings, 23 days, 3.5 nights; family 2,524 members, 4,243 bookings, 49 days, 6.0 nights; solo 2,481 members, 4,798 bookings, 12.5 days, 4.0 nights. Average nightly rate is about $247-255 in every segment. Business travelers book the most per member (2.7 bookings); families book furthest ahead (median 49 days). Accept within 5%.
- **Evidence:** descriptive; Insights on `booking completed` by user property `traveler_segment`; `-- EVAL Q18`.
- **Context needed:** 01-business.md (segments).
- **Grading:** must use the profile segment. Wrong: inferring segment from `guests` alone.

### Q19 — What should we worry about this quarter?
- **Prompt:** "Looking at the summer data, what should we worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names most of these, with numbers: (1) **Bad stays drive churn** — about half of members with a 1-2 star first review stop searching (45% vs 94% return, Q8), and 17% of reviews are 1-2 stars. (2) **Long-lead cancellations** — 60+ day bookings cancel 32% of the time within 30 days, and free-cancellation rates cancel about 4.5x as often as non-refundable (Q4, Q5). (3) **Payment reliability** — four degraded website days cost about 274 bookings and $310K (Q2); monitor gateway status. (4) **TikTok efficiency** — cheapest per signup but 27% of signups book vs 55%, more per booker than Meta (Q3). (5) **Thin-review supply** — listings under 10 reviews convert at 0.41x and take 16% of property views (Q9). Paid spend is 54% Google, 29% Meta, 17% TikTok, so the most expensive channel per booker takes most of the budget. (6) **Ship All-in Pricing** with the right success metric (Q6). Weather risk for the Caribbean in hurricane season (Q10) is a fair extra.
- **Evidence:** H2, H3, H4, H5, H7, H8, H9; `-- EVAL Q19` plus the queries cited.
- **Context needed:** all guides.
- **Grading:** must rank issues with evidence. Wrong: generic advice with no numbers; "conversion is falling" (it rose).

### Q20 — Where do we lose travelers in the booking funnel?
- **Prompt:** "Walk me through our booking funnel. Where are we losing people?"
- **Type:** open-ended
- **Answer:** Per search session (Jun 4-Sep 23, 7-day window, 200,917 sessions, 3.96 property views per session on average): **15.0%** reach checkout and **63.3%** of checkouts book, so **9.5%** of sessions end in a booking. The big loss is between browsing and checkout. Things that move it: listings with few reviews (Q9), the sale (Q12), All-in Pricing (Q6), Caribbean demand during the storm (Q10). Checkout → booking moved with Flex Pay (Q1), the payment incident (Q2), and All-in Pricing (Q6). Accept search → checkout 13%-17%, checkout → booking 60%-66%, search → booking 8.5%-10.5%.
- **Evidence:** Funnels, `destination searched` → `checkout started` → `booking completed`, Totals, hold `search_id` constant, 7-day window; `-- EVAL Q20`.
- **Context needed:** 03-event-dictionary.md (funnels), 04-metrics-and-tables.md (KPIs).
- **Grading:** must measure per session. Wrong: a unique-member funnel only (most members book at least once, which hides the per-session loss); counting property views as steps of separate sessions.
