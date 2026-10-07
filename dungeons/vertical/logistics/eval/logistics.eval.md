# Routewise Freight (logistics) — 20-question eval

- **Data:** `data/verify-logistics` (full fidelity: 10,000 shipper users, 9,983 with events, 4,446 new signups, 823,990 events, 162,526 quotes (151,821 with a full 7-day window), 51,852 loads booked in the window, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query (or the `-- STORY` query it names) in `dungeons/vertical/logistics/logistics.sql` on that data.
- **Stories:** ids refer to the `stories` export in `logistics.js` (H1-H9).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Did Live ETA cut "where's my truck" tickets?
- **Prompt:** "We launched Live ETA in July. Are we getting fewer 'where's my truck' tickets since then?"
- **Type:** trend
- **Answer:** Yes. Tickets with `ticket_category = tracking_status` fell from **15.7 per 100 pickups** before the 2026-07-21 launch (2,683 tickets on 17,069 pickups) to **6.1 per 100 pickups from August 4 on** (1,763 on 28,732), about **0.39x** (−61%). The drop phases in over the two-week rollout: weekly rates of 14.1-15.8 per 100 in the full weeks before launch, 13.6 in the launch week, 8.8 the week of Jul 27, then 5.3-6.8 from the week of Aug 3. Booking-change and billing tickets did not move (8.9 → 8.9 per 100 loads booked, 1.00x), so it is not a change in ticketing overall. Delivery-issue tickets rose in late September (hurricane), which is unrelated. Accept 0.35x-0.47x and a ramp over late July.
- **Evidence:** H1-live-eta-tickets; Insights, `support ticket created` filtered `ticket_category = tracking_status`, formula ÷ `pickup confirmed`, weekly; `-- STORY H1` and `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (launch date, two-week rollout), 04-metrics-and-tables.md (tracking tickets per load).
- **Grading:** must normalize by loads (pickups or loads in transit) and give the size. Wrong: raw ticket counts only (loads grow over the window); "all tickets fell" (delivery-issue tickets rose in September); counting the rollout weeks as "after". The first partial week (Jun 4-7) reads 25 per 100 because some tickets there come from loads picked up before June 4; do not use it as the baseline.

### Q2 — Are shippers using Live ETA?
- **Prompt:** "How much are shippers actually using Live ETA?"
- **Type:** context
- **Answer:** From launch on, **35.1% of tracking views** (29,116 of 82,874) were opened from an ETA notification (`view_source = eta_notification`); the rest came from the portal (40.1%) and shared tracking links (24.8%). Before launch the split was portal 61.7% / tracking link 38.3%, and `eta_notification` never appears. Shippers did not look at loads more often: **2.36 tracking views per load** before launch vs **2.45** after the rollout; ETA notifications replaced part of the portal and link traffic. Accept "about a third of tracking views" (30%-40%) and "views per load about flat".
- **Evidence:** H1-live-eta-tickets (adoption trace); Insights, `shipment tracked`, breakdown `view_source`, before vs from Jul 21; `-- EVAL Q2`.
- **Context needed:** 02-timeline.md (Live ETA), 03-event-dictionary.md (`view_source`).
- **Grading:** must use `view_source` and a share of views. Wrong: "views per load rose sharply"; claiming ETA views before Jul 21.

### Q3 — Does our price vs the market decide whether we win the load?
- **Prompt:** "How much does our quote price relative to the market matter for winning loads?"
- **Type:** external-join
- **Answer:** A lot. Joining each quote to that day's spot benchmark for its equipment (`spot_market_rates_daily.spot_rate_per_mile`), quotes **at or below 5% over market (below-market quotes included) book 43.6%** of the time (7-day window, per quote) vs **14.3% for quotes more than 15% over market (0.33x)**; 5-15% over books 29.8%. Finer: below market 45.6%, 0-5% 42.5%, 5-10% 35.5%, 10-15% 23.0%, 15-20% 14.9%, over 20% 12.8%. The steepest drop is between about 5% and 15% over market. The median quote sits 8.1% over market; the overall booking rate is 31.8% (151,821 quotes with a full 7-day window). The raw quoted rate per mile barely shows this (correlation with booking −0.11 vs −0.23 for the spread) because the market itself moves by day and equipment. Accept at-market roughly 3x expensive (0.28x-0.38x) with the decline concentrated between 5% and 15%; a bucket of |spread| ≤ 5% gives the same picture.
- **Evidence:** H2-price-vs-market; Funnels `quote requested` → `load booked`, Totals, hold `shipment_id` constant, 7-day window, joined to `spot_market_rates_daily` on date and `equipment_type`; `-- STORY H2` and `-- EVAL Q3`.
- **Context needed:** 01-business.md (how quotes are priced), 04-metrics-and-tables.md (spread to market, `spot_market_rates_daily`).
- **Grading:** must join the benchmark (by day and equipment) and compare per-quote booking rates by spread. Wrong: using `quoted_rate_per_mile` alone ("price doesn't matter much"); comparing equipment types' rates; per-user conversion.

### Q4 — Should we ship Instant Book?
- **Prompt:** "Is the Instant Book test working? Should we roll it out to every dry van shipper?"
- **Type:** funnel
- **Answer:** It wins loads but loses margin dollars. For dry van quotes from 2026-08-11 to Sep 24 (full 7-day window), **39.7% of Instant Book quotes booked vs 30.7% in Control (1.29x, z ≈ 19)**; 80.4% of variant bookings used one-click booking (`booking_method = instant`). Exposed shippers: 3,321 Control vs 3,386 Instant Book (50.5% Instant Book; sample-ratio z ≈ 0.8, no imbalance), and before the test the same two groups booked dry van quotes at 30.4% vs 30.1%. But instant loads earn **8.6% gross margin vs 14.7% negotiated** (warehouse `load_margin_daily`, Aug 11-Oct 1), so the variant's blended margin is 9.8% vs 14.7%. At about $2,740-2,780 of revenue per load, estimated gross margin per dry van quote is **$108 in Instant Book vs $124 in Control (about −13%)**. Recommendation: do not roll out as is; the extra loads do not pay for the thinner margin. Ship only with instant prices that protect margin (or limit it to lanes where margin holds), then re-test. Accept a booking lift of 1.2x-1.4x and a clear statement that margin per quote falls.
- **Evidence:** H3-instant-book-experiment; Funnels `quote requested` (equipment_type = dry_van) → `load booked`, Totals, hold `shipment_id`, 7-day window, Aug 11 - Sep 24, breakdown `Experiment: Instant Book` (or the Experiments report on `$experiment_started`); margin from `load_margin_daily`; `-- STORY H3` and `-- EVAL Q4`.
- **Context needed:** 02-timeline.md (test design, dry van only), 01-business.md (margin model, goal 1), 04-metrics-and-tables.md (`load_margin_daily`).
- **Grading:** must compare arms per quote after the start and bring in margin from the warehouse. Wrong: "ship it, bookings are up 30%" with no margin check; including reefer and flatbed quotes in the test read; unique-user funnels as the headline; using `booking_method = instant` as the treatment group. A sample-ratio check is good practice; here the arms are balanced (50.5% / 49.5%) and pre-test booking rates match.

### Q5 — What margin do Instant Book loads earn?
- **Prompt:** "What gross margin are we making on loads booked through Instant Book compared with our normal bookings?"
- **Type:** external-join
- **Answer:** From the warehouse, Aug 11-Oct 1: **instant loads 8.6% gross margin** (7,641 billed loads, $20.8M revenue) vs **negotiated loads 14.7%** (17,499 loads, $53.2M), about **0.58x**. In normal weeks instant runs 9.0%-9.5% and negotiated 15.4%-16.0%; both dropped in the hurricane week (6.2% and 11.2%). Instant Book took 28.2% of billed revenue after the test started, and overall margin went from 15.5% (Jun 4-Aug 10) to 13.0% (Aug 11-Oct 1). Accept instant at 0.5x-0.65x of negotiated.
- **Evidence:** H3-instant-book-experiment (warehouse assertion); `load_margin_daily` sum(gross_margin_usd) / sum(gross_revenue_usd) by `booking_method`; `-- STORY H3` and `-- EVAL Q5`.
- **Context needed:** 04-metrics-and-tables.md (`load_margin_daily`, how to compute margin %), 02-timeline.md (test start).
- **Grading:** must sum margin and revenue before dividing (not average daily percentages) and compare the same dates. Wrong: comparing instant (from Aug 11) with negotiated over the full window; averaging `gross_margin_pct` across rows including zero-load instant days.

### Q6 — How long does it take to cover a load?
- **Prompt:** "How long does it take us to find a carrier after a shipper books? Is it worse for some equipment?"
- **Type:** funnel
- **Answer:** Median time from booking to `carrier assigned` is **3.0 hours for dry van, 4.8 hours for reefer (1.6x), and 6.6 hours for flatbed (2.2x)**. Covered within 4 hours: dry van 69%, reefer 39%, flatbed 19%. Means are a little higher (3.6, 5.7, 8.0 h). Accept reefer 1.45x-1.75x and flatbed 2.0x-2.4x of dry van on medians.
- **Evidence:** H4-coverage-by-equipment; Funnels `load booked` → `carrier assigned`, Totals, hold `shipment_id` constant, median time to convert, breakdown `equipment_type`; `-- STORY H4` and `-- EVAL Q6`.
- **Context needed:** 01-business.md (cover step, equipment), 04-metrics-and-tables.md (time to cover).
- **Grading:** must hold `shipment_id` constant and report by equipment. Wrong: unique-user funnels across many loads (pairs a booking with another load's assignment); a single overall number.

### Q7 — Does a bad first delivery cost us new shippers?
- **Prompt:** "Customer success says some new shippers stop after their first loads. Does a late first delivery have anything to do with it?"
- **Type:** retention
- **Answer:** Yes, strongly. Among new shippers (signed up in the window) whose first `load delivered` was on or before Sep 17, **37.9% of those whose first delivery was late** came back to request a quote on or after day 14, vs **78.9% when it was on time (0.48x)** (256 vs 1,247 shippers). With a 14-27 day bracket (first deliveries to Sep 3): 28.9% vs 60.5% (0.48x). 17.0% of new shippers' first deliveries were late. The late group is small (about 250 shippers), so treat the size as roughly "half as likely to come back" rather than a precise number. Accept 0.40x-0.65x.
- **Evidence:** H5-late-first-load-churn; Retention, birth `load delivered` (first time), cohort new shippers (`account created` in window), breakdown `on_time`, return `quote requested`, on or after day 14; `-- STORY H5` and `-- EVAL Q7`.
- **Context needed:** 01-business.md (goal 7), 03-event-dictionary.md (`on_time`), 04-metrics-and-tables.md (active shipper excludes carrier and billing events).
- **Grading:** must split by the first delivery's on-time flag and use a shipper action as the return event. Wrong: using "any event" as the return (invoices and carrier events keep arriving after a shipper leaves, which hides the drop); including established customers; including first deliveries too late for the bracket.

### Q8 — Which paid channel is worth the money?
- **Prompt:** "Which paid channel gives us the cheapest new shippers? Is Google as cheap as it looks?"
- **Type:** external-join
- **Answer:** Google is cheapest per signup but not per real customer. Window spend per Mixpanel signup (warehouse `paid_marketing_daily`): **Google Ads $55.05, trade media $79.74, LinkedIn $110.36**. Only **35.8%** of Google signups are approved for credit within 7 days vs about 72% elsewhere (LinkedIn 71.9%, trade media 72.0%), so **spend per approved shipper is $153.65 Google vs $153.57 LinkedIn (≈1.0x)** and **$110.68 trade media**, the cheapest. Per load booked by those signups in the window: Google $58.71, LinkedIn $57.70, trade media $41.61. Spend: LinkedIn $72.2k, Google $67.0k, trade media $55.3k. Recommendation: move budget toward trade media; Google is not cheaper than LinkedIn once credit approval is counted. Accept Google per signup about half of LinkedIn (0.45x-0.55x), Google ≈ LinkedIn per approved shipper (0.9x-1.1x), and trade media cheapest per approved shipper.
- **Evidence:** H6-paid-channel-economics; Insights `account created` by `acquisition_channel` joined to `paid_marketing_daily.spend_usd`; Funnels onboarding by channel; `-- STORY H6` and `-- EVAL Q8`.
- **Context needed:** 04-metrics-and-tables.md (CAC uses Mixpanel signups, table columns), 01-business.md (channels, credit approval).
- **Grading:** must join spend to Mixpanel signups and go past cost per signup. Wrong: using `leads_reported` as the denominator (platforms over-claim, e.g. Google 1,407 claimed vs 1,217 signups); stopping at "Google is half the price of LinkedIn".

### Q9 — Where do new shippers drop in onboarding?
- **Prompt:** "Too many signups never book a load. Where do they drop in onboarding, and is it worse for some group?"
- **Type:** funnel
- **Answer:** Overall **62.0%** of new shippers are approved for credit within 7 days (4,446 signups). The gap is **Google Ads**: 58.1% of Google signups submit a credit application and **35.8%** are approved, vs 81.7% and **71.9%** for every other channel combined (**0.50x**). Google is 27% of signups (1,217 of 4,446). Other channels sit at 71.8%-72.1% approval. Shippers who are not approved cannot book and leave after a few days of rate lookups. Accept Google 0.45x-0.55x of the rest.
- **Evidence:** H6-paid-channel-economics; Funnels `account created` → `credit application submitted` → `credit approved`, 7-day window, breakdown `acquisition_channel`; `-- EVAL Q9`.
- **Context needed:** 01-business.md (credit approval), 03-event-dictionary.md (onboarding events), 04-metrics-and-tables.md (credit approval rate).
- **Grading:** must break down by acquisition channel. Wrong: blaming company tier or signup method; only reporting the overall rate.

### Q10 — What happened to on-time delivery in mid-September?
- **Prompt:** "On-time delivery fell off a cliff in mid-September. What happened and how big was it?"
- **Type:** context
- **Answer:** **Hurricane Odessa** (timeline: landfall on the central Gulf Coast on Sep 14, then inland across the Southeast through Sep 18). The analyst has to find the affected lanes in the data: loads on **Gulf lanes** (origin or destination in `south_central` or `southeast`) picked up Sep 14-18 arrived late **70.1%** of the time vs **17.4%** for other lanes picked up the same days and **18.3%** for all other loads. By delivery week, Gulf-lane late share was 65.4% the week of Sep 14 and 41.5% the week of Sep 21 (late deliveries spilled over), vs 15.5%-19.8% in every other week; other lanes stayed at 15.5%-19.7% throughout (22.1% in the partial first week). Carriers reported 1,227 `weather_delay` exceptions Sep 14-20 vs 53 the week of Aug 31. Accept a Gulf-lane late share of 60%-75% in the storm days and naming the regions.
- **Evidence:** H7-hurricane-odessa; Funnels `pickup confirmed` → `load delivered`, hold `shipment_id`, Sep 14-18, breakdown region and `on_time`; Insights `delivery exception` by `exception_type`; `-- STORY H7` and `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (hurricane, path), 03-event-dictionary.md (regions table).
- **Grading:** must name the storm, the affected regions, and give the size against a baseline. Wrong: "carrier performance collapsed nationwide" (other lanes did not move); blaming Instant Book or Live ETA.

### Q11 — Why is margin lower in September?
- **Prompt:** "Gross margin looks lower in September. Why?"
- **Type:** external-join
- **Answer:** Two causes, both in the warehouse. Monthly margin: June 15.5%, July 15.6%, August 14.4%, **September 12.4%**. (1) **Instant Book mix**: from Aug 11 about 28% of billed revenue is instant loads at about 9% margin vs about 15% for negotiated loads (Q5). (2) **Hurricane Odessa**: spot rates jumped in the storm days (flatbed $2.81 → $3.27 per mile, +16%; dry van +13%; reefer +11%, vs the two weeks before) and faded by about Sep 24; margins compressed on both methods (instant 9.3% → 6.1%, negotiated 15.5% → 11.3% in Sep 14-18; 8.6% and 14.2% in Sep 19-30). Accept naming both the instant mix and the storm-week squeeze, with September near 12%-13%.
- **Evidence:** H3-instant-book-experiment and H7-hurricane-odessa (warehouse reads); `load_margin_daily` by month and method, `spot_market_rates_daily` by day; `-- EVAL Q11` and `-- EVAL Q17`.
- **Context needed:** 02-timeline.md (test, hurricane), 04-metrics-and-tables.md (both tables, margin % method).
- **Grading:** must use the margin table and separate mix from rate. Wrong: "shippers paid less" (booked revenue per load did not fall: about $2,880-2,910 in June-August and $3,065 in September as spot rates rose); only one of the two causes; averaging daily percentages.

### Q12 — Is there a magic number of saved lanes?
- **Prompt:** "Do new shippers who save their lanes ship more with us? Is there a number we should push for in onboarding?"
- **Type:** segmentation
- **Answer:** Yes: **three lanes**. Loads booked per credit-approved new shipper (signed up Jun 4-Sep 17, so the two-week lane setup is over) by saved lanes: 0: 2.07, 1: 1.90, 2: 2.03, **3: 4.47**, 4: 3.82, 5: 4.03, 6: 3.94, 7: 4.04. **Under 3 lanes: 2.00 loads vs 3+: 4.10 (0.49x)**; within each company tier the ratio is 0.45 (enterprise), 0.47 (mid-market), 0.52 (small business), 0.49 weighted. There is no gain past 3 (5+ vs 3-4: 0.97x within tier, 0.96x pooled; read it within tier, because enterprise shippers book several times more loads and tier mix moves the small pooled buckets). New shippers save lanes only in their first two weeks (including the onboarding lane), so `saved_lanes` on the profile is that count once the two weeks are over. Mixpanel's "average per user" on `load booked` counts only shippers who booked at least once; read that way it is 2.90 vs 4.77 loads (0.61x), and 69% of under-3 shippers book any load vs 86% of 3+ shippers. Accept a step at 3 with under-3 at 0.45x-0.57x of 3+ per approved shipper, or about 0.55x-0.7x per booking shipper if the analyst names that measure. Including signups from the last two weeks (still saving lanes) pulls the ratio down slightly; accept it if the step at 3 is clear.
- **Evidence:** H8-saved-lanes-threshold; Insights, A = `load booked` (total), B = `credit approved` (uniques), formula A / B, filter user property `customer_since` from 2026-06-04 through 2026-09-17, breakdown `company_tier` and `saved_lanes`; `-- STORY H8` and `-- EVAL Q12`.
- **Context needed:** 01-business.md (saved lanes, onboarding), 03-event-dictionary.md (`lane saved`, `saved_lanes`).
- **Grading:** must restrict to new approved shippers and show the step and the plateau. Wrong: "more lanes is always better"; mixing in established customers (their saved lanes come from before the window); total loads instead of loads per shipper.

### Q13 — What drives detention charges?
- **Prompt:** "Detention charges are eating into shipper satisfaction. What drives them?"
- **Type:** segmentation
- **Answer:** **Dock appointments.** Loads booked with `appointment_scheduled = true` got a detention charge **8.9%** of the time vs **22.2%** without one (**0.40x**), for loads booked through Sep 14. It holds in every tier (enterprise 8.8% vs 22.2%, mid-market 8.7% vs 22.3%, small business 9.6% vs 22.1%). Appointment use differs by tier (enterprise 65%, mid-market 45%, small business 25%), so small businesses carry the most detention. Lumper fees do not depend on appointments (9.8% vs 9.9%). Detention was 8,322 charges and $2.50M in the window ($300 each). Recommendation: push appointment scheduling, especially for small-business shippers. Accept 0.33x-0.47x.
- **Evidence:** H9-dock-appointments; Funnels `load booked` → `accessorial charged` (charge_type = detention), Totals, hold `shipment_id`, breakdown `appointment_scheduled`; `-- STORY H9` and `-- EVAL Q13`.
- **Context needed:** 01-business.md (accessorials, appointments), 03-event-dictionary.md (`appointment_scheduled`, `charge_type`).
- **Grading:** must compare per-load detention rates by appointment. Wrong: "enterprise shippers cause less detention" without seeing that appointments explain it; counting all accessorials together.

### Q14 — Why did quotes crash on two days?
- **Prompt:** "Quote volume crashed on July 3 and September 7. Was something broken?"
- **Type:** context
- **Answer:** Nothing broke; those are **US holidays** (Independence Day observed on Friday Jul 3, Labor Day Monday Sep 7) when most shippers are closed. Quotes: **296 on Jul 3** vs 1,529 on Fri Jun 26 and 1,471 on Fri Jul 10 (about −80%); **501 on Sep 7** vs 1,865 on Mon Aug 31 and 1,913 on Mon Sep 14 (about −73%). Dashboard views fell the same way (172 and 246). Pickups did not (541 on Jul 3, 779 on Sep 7): carriers kept moving loads booked before the holiday. Accept naming both holidays and a drop of roughly two thirds or more.
- **Evidence:** `-- EVAL Q14`; Insights `quote requested`, daily.
- **Context needed:** 02-timeline.md (holidays).
- **Grading:** must tie both days to the holidays. Wrong: "an outage"; comparing a holiday Friday to a Monday.

### Q15 — Do bigger shippers convert quotes better? (null)
- **Prompt:** "Do enterprise shippers convert quotes to bookings better than small businesses? Should sales prioritize their quotes?"
- **Type:** null-hypothesis
- **Answer:** **No.** Per quote (7-day window), enterprise 31.7%, mid-market 31.9%, small business 31.7% (z ≈ 0.05 and 0.5 vs small business). Within each equipment type the tiers are also level (dry van 32.6% / 32.5% / 32.4%; reefer 30.6% / 31.0% / 30.5%; flatbed 30.2% / 30.9% / 30.9%; enterprise vs small business |z| ≤ 1.0). Enterprise shippers send more quotes, so they book more loads in total, but they do not convert better. What moves conversion is price vs market (Q3). Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q15`; Funnels `quote requested` → `load booked`, Totals, hold `shipment_id`, 7-day window, breakdown `company_tier`.
- **Context needed:** 01-business.md (tiers), 04-metrics-and-tables.md (quote-to-book rate).
- **Grading:** must use a per-quote rate and treat the gap as noise. Wrong: loads per user by tier ("enterprise converts 3x better"); unique-user funnels.

### Q16 — Did Instant Book help reefer and flatbed too? (null)
- **Prompt:** "Since Instant Book started, are reefer and flatbed quotes booking better for shippers in the Instant Book group?"
- **Type:** null-hypothesis
- **Answer:** **No.** Reefer and flatbed quotes are not part of the test, and they book the same in both arms: from Aug 11 to Sep 24, **30.5% in Control vs 30.4% in Instant Book** (z ≈ −0.2); reefer 30.9% vs 30.7% (z ≈ −0.2), flatbed 30.1% vs 30.0% (z ≈ −0.1). No tier shows a gap (enterprise 29.9% vs 29.8%, mid-market 31.2% vs 30.8%, small business 30.2% vs 30.5%; |z| ≤ 0.4). The Instant Book lift is confined to dry van quotes (Q4). Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q16`; Funnels `quote requested` (equipment_type in reefer, flatbed) → `load booked`, Totals, hold `shipment_id`, 7-day window, Aug 11 - Sep 24, breakdown `Experiment: Instant Book`.
- **Context needed:** 02-timeline.md (test scope: dry van only).
- **Grading:** must check the data by arm and call it noise. Wrong: "Instant Book lifted all equipment" (pooling dry van in); claiming a halo effect from a 0.1-point gap or from a tier split with |z| below 0.5.

### Q17 — What should we worry about this quarter?
- **Prompt:** "Give me a quarter review: what's going well and what should we worry about going into Q4?"
- **Type:** open-ended
- **Answer:** Volume grew: monthly loads booked 9,749 (Jun 4-30) → 12,366 (Jul) → 14,042 (Aug) → 14,990 (Sep), booked revenue $28.4M → $45.9M, active shippers 6,179 → 8,226, about 1,100-1,175 new signups a month. Worries, in order: (1) **margin** fell to 12.4% in September (15.5% in June) from the Instant Book mix and the storm squeeze (Q5, Q11); Instant Book as built loses margin dollars per quote (Q4). (2) **New-shipper activation**: only 62.0% are approved for credit, and Google signups are approved at half the rate (Q9); a late first delivery cuts the chance a new shipper comes back by about half (Q7). (3) **Hurricane exposure**: Gulf-lane on-time fell to about 30% in the storm days (Q10). Going well: Live ETA cut tracking tickets by about 60% (Q1); appointments cut detention (Q13); pricing near market wins loads (Q3). A good answer names at least three of these with numbers.
- **Evidence:** `-- EVAL Q17` plus the story queries cited.
- **Context needed:** all guides.
- **Grading:** must combine event data and the margin table and rank the risks. Wrong: celebrating growth without margin; reporting raw tickets or raw bookings without rates.

### Q18 — How is volume trending?
- **Prompt:** "How have quotes and loads trended over the summer? Where is the growth coming from?"
- **Type:** trend
- **Answer:** Up. Weekly quotes went from about 8,400-8,725 in full June weeks to 10,500-10,800 in full September weeks (about +25%; the Jul 3 and Labor Day weeks dip; the first and last weeks are partial); weekly loads booked from about 2,530-2,630 to about 3,570 (about +39%). Most of the growth is new shippers: loads booked by shippers who joined in the window went from 306 in June to 3,232 in September (41 → 324 quotes a day). Established customers quote at the same pace (1,156 quotes a day in June, 1,161 in September), but their loads went from 350 to 392 a day (+12%); that gain is the Instant Book test: established shippers in the Instant Book arm booked 103 → 146 dry van loads a day vs 103 → 110 in Control. New signups run steadily at about 230-295 a week. Accept growth of roughly 20%-40% with most of it from new shippers, and for full credit, established volume flat in quotes with the extra loads from Instant Book.
- **Evidence:** `-- EVAL Q18`; Insights `quote requested` and `load booked`, weekly; breakdown by `customer_since` in the window.
- **Context needed:** 00-manifest.md (scale), 04-metrics-and-tables.md (new shippers).
- **Grading:** must separate new from established shippers. Wrong: comparing the partial first or last week with full weeks; attributing all growth to Instant Book; claiming established customers quote more.

### Q19 — What's our on-time rate, and does it differ by equipment?
- **Prompt:** "What's our on-time delivery rate? Is reefer or flatbed worse than dry van?"
- **Type:** segmentation
- **Answer:** Outside the hurricane days, **81.7% on time** (46,136 loads); dry van 81.7%, flatbed 81.5%, reefer 82.0%: no meaningful equipment difference. Over the whole window including the storm, 79.5% (51,039 deliveries). Equipment matters for how long a load takes to cover (Q6), not for on-time delivery. Accept about 79%-82% and "no real difference by equipment".
- **Evidence:** `-- EVAL Q19`; Insights `load delivered`, share with `on_time = true`, breakdown `equipment_type`.
- **Context needed:** 04-metrics-and-tables.md (on-time delivery rate), 02-timeline.md (hurricane).
- **Grading:** must separate or mention the storm days. Wrong: "reefer is much worse"; reporting the storm-week rate as typical.

### Q20 — How fast do shippers pay?
- **Prompt:** "How long do shippers take to pay us? Is anyone paying slower than their terms?"
- **Type:** segmentation
- **Answer:** Median days from delivery to payment: **enterprise 38 days (net_45), mid-market 27 days (net_30), small business 19 days (net_21)**; means 39.8, 28.5, 20.2 days. Each tier pays inside its terms at the median; a tail pays late (the means sit above the medians). Invoices for loads delivered late in the window are paid after it ends, so recent weeks show fewer `invoice paid` events than loads. Accept the three medians within ±2 days.
- **Evidence:** `-- EVAL Q20`; Insights `invoice paid`, median of `days_to_pay`, breakdown `company_tier` or `payment_terms`.
- **Context needed:** 01-business.md (payment terms), 03-event-dictionary.md (`days_to_pay`).
- **Grading:** must break down by tier or terms. Wrong: one overall number; counting unpaid recent loads as late payers.
