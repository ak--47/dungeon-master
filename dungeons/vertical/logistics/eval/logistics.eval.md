# Routewise Freight (logistics) — 20-question eval

- **Data:** `data/verify-logistics` (full fidelity: 10,000 shipper users, 9,988 with events, 4,422 new signups, 822,398 events, 162,955 quotes (152,173 with a full 7-day window), 51,917 loads booked in the window, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query (or the `-- STORY` query it names) in `dungeons/vertical/logistics/logistics.sql` on that data.
- **Stories:** ids refer to the `stories` export in `logistics.js` (H1-H9).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Did Live ETA cut "where's my truck" tickets?
- **Prompt:** "We launched Live ETA in July. Are we getting fewer 'where's my truck' tickets since then?"
- **Type:** trend
- **Answer:** Yes. Tickets with `ticket_category = tracking_status` fell from **14.7 per 100 pickups** before the 2026-07-21 launch (2,520 tickets on 17,145 pickups) to **5.9 per 100 pickups from August 4 on** (1,688 on 28,705), about **0.40x** (−60%). The drop phases in over the two-week rollout: weekly rates of 13.6-15.5 per 100 in the full weeks before launch, 13.5 in the launch week, 10.0 the week of Jul 27, then 5.4-6.3 from the week of Aug 3. Booking-change and billing tickets did not move (8.7 → 9.1 per 100 loads booked, 1.04x), so it is not a change in ticketing overall. Delivery-issue tickets rose in late September (hurricane), which is unrelated. Accept 0.35x-0.47x and a ramp over late July.
- **Evidence:** H1-live-eta-tickets; Insights, `support ticket created` filtered `ticket_category = tracking_status`, formula ÷ `pickup confirmed`, weekly; `-- STORY H1` and `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (launch date, two-week rollout), 04-metrics-and-tables.md (tracking tickets per load).
- **Grading:** must normalize by loads (pickups or loads in transit) and give the size. Wrong: raw ticket counts only (loads grow over the window); "all tickets fell" (delivery-issue tickets rose in September); counting the rollout weeks as "after". The first partial week (Jun 4-7) reads 20 per 100 because some tickets there come from loads picked up before June 4; do not use it as the baseline.

### Q2 — Are shippers using Live ETA?
- **Prompt:** "How much are shippers actually using Live ETA?"
- **Type:** context
- **Answer:** From launch on, **34.9% of tracking views** (29,065 of 83,258) were opened from an ETA notification (`view_source = eta_notification`); the rest came from the portal (40.5%) and shared tracking links (24.6%). Before launch the split was portal 62.1% / tracking link 37.9%, and `eta_notification` never appears. Shippers did not look at loads more often: **2.37 tracking views per load** before launch vs **2.45** after the rollout; ETA notifications replaced part of the portal and link traffic. Accept "about a third of tracking views" (30%-40%) and "views per load about flat".
- **Evidence:** H1-live-eta-tickets (adoption trace); Insights, `shipment tracked`, breakdown `view_source`, before vs from Jul 21; `-- EVAL Q2`.
- **Context needed:** 02-timeline.md (Live ETA), 03-event-dictionary.md (`view_source`).
- **Grading:** must use `view_source` and a share of views. Wrong: "views per load rose sharply"; claiming ETA views before Jul 21.

### Q3 — Does our price vs the market decide whether we win the load?
- **Prompt:** "How much does our quote price relative to the market matter for winning loads?"
- **Type:** external-join
- **Answer:** A lot. Joining each quote to that day's spot benchmark for its equipment (`spot_market_rates_daily.spot_rate_per_mile`), quotes **within 5% of market book 43.7%** of the time (7-day window, per quote) vs **14.6% for quotes more than 15% over market (0.33x)**; 5-15% over books 29.7%. Finer: below market 44.7%, 0-5% 43.1%, 5-10% 35.0%, 10-15% 23.3%, 15-20% 15.1%, over 20% 13.1%. The steepest drop is between about 5% and 15% over market. The median quote sits 8.1% over market; the overall booking rate is 31.8%. The raw quoted rate per mile barely shows this (correlation with booking −0.11 vs −0.23 for the spread) because the market itself moves by day and equipment. Accept at-market roughly 3x expensive (0.28x-0.38x) with the decline concentrated between 5% and 15%.
- **Evidence:** H2-price-vs-market; Funnels `quote requested` → `load booked`, Totals, hold `shipment_id` constant, 7-day window, joined to `spot_market_rates_daily` on date and `equipment_type`; `-- STORY H2` and `-- EVAL Q3`.
- **Context needed:** 01-business.md (how quotes are priced), 04-metrics-and-tables.md (spread to market, `spot_market_rates_daily`).
- **Grading:** must join the benchmark (by day and equipment) and compare per-quote booking rates by spread. Wrong: using `quoted_rate_per_mile` alone ("price doesn't matter much"); comparing equipment types' rates; per-user conversion.

### Q4 — Should we ship Instant Book?
- **Prompt:** "Is the Instant Book test working? Should we roll it out to every dry van shipper?"
- **Type:** funnel
- **Answer:** It wins loads but loses margin dollars. For dry van quotes from 2026-08-11 to Sep 24 (full 7-day window), **39.6% of Instant Book quotes booked vs 30.4% in Control (1.30x, z ≈ 20)**; 79.7% of variant bookings used one-click booking (`booking_method = instant`). Exposed shippers: 3,484 Control vs 3,315 Instant Book (48.8% Instant Book; a sample-ratio check gives z ≈ −2.0, p ≈ 0.04). The gap comes from which shippers quoted dry van after Aug 11, not from the test: before the test the same two groups booked dry van quotes at 30.7% vs 30.1%. But instant loads earn **8.6% gross margin vs 14.7% negotiated** (warehouse `load_margin_daily`, Aug 11-Oct 1), so the variant's blended margin is 9.8% vs 14.7%. At about $2,780-2,810 of revenue per load, estimated gross margin per dry van quote is **$109 in Instant Book vs $124 in Control (about −12%)**. Recommendation: do not roll out as is; the extra loads do not pay for the thinner margin. Ship only with instant prices that protect margin (or limit it to lanes where margin holds), then re-test. Accept a booking lift of 1.2x-1.4x and a clear statement that margin per quote falls.
- **Evidence:** H3-instant-book-experiment; Funnels `quote requested` (equipment_type = dry_van) → `load booked`, Totals, hold `shipment_id`, 7-day window, Aug 11 - Sep 24, breakdown `Experiment: Instant Book` (or the Experiments report on `$experiment_started`); margin from `load_margin_daily`; `-- STORY H3` and `-- EVAL Q4`.
- **Context needed:** 02-timeline.md (test design, dry van only), 01-business.md (margin model, goal 1), 04-metrics-and-tables.md (`load_margin_daily`).
- **Grading:** must compare arms per quote after the start and bring in margin from the warehouse. Wrong: "ship it, bookings are up 30%" with no margin check; including reefer and flatbed quotes in the test read; unique-user funnels as the headline; using `booking_method = instant` as the treatment group. Flagging the slight arm-size imbalance is good practice, but it does not overturn the result (pre-test booking rates match).

### Q5 — What margin do Instant Book loads earn?
- **Prompt:** "What gross margin are we making on loads booked through Instant Book compared with our normal bookings?"
- **Type:** external-join
- **Answer:** From the warehouse, Aug 11-Oct 1: **instant loads 8.6% gross margin** (7,385 billed loads, $20.3M revenue) vs **negotiated loads 14.7%** (17,832 loads, $54.5M), about **0.58x**. In normal weeks instant runs 9.0%-9.5% and negotiated 15.5%-16.0%; both dropped in the hurricane week (6.2% and 11.3%). Instant Book took 27.2% of billed revenue after the test started, and overall margin went from 15.5% (Jun 4-Aug 10) to 13.0% (Aug 11-Oct 1). Accept instant at 0.5x-0.65x of negotiated.
- **Evidence:** H3-instant-book-experiment (warehouse assertion); `load_margin_daily` sum(gross_margin_usd) / sum(gross_revenue_usd) by `booking_method`; `-- STORY H3` and `-- EVAL Q5`.
- **Context needed:** 04-metrics-and-tables.md (`load_margin_daily`, how to compute margin %), 02-timeline.md (test start).
- **Grading:** must sum margin and revenue before dividing (not average daily percentages) and compare the same dates. Wrong: comparing instant (from Aug 11) with negotiated over the full window; averaging `gross_margin_pct` across rows including zero-load instant days.

### Q6 — How long does it take to cover a load?
- **Prompt:** "How long does it take us to find a carrier after a shipper books? Is it worse for some equipment?"
- **Type:** funnel
- **Answer:** Median time from booking to `carrier assigned` is **3.0 hours for dry van, 4.8 hours for reefer (1.6x), and 6.7 hours for flatbed (2.3x)**. Covered within 4 hours: dry van 69%, reefer 38%, flatbed 19%. Means are a little higher (3.6, 5.8, 8.0 h). Accept reefer 1.45x-1.75x and flatbed 2.0x-2.4x of dry van on medians.
- **Evidence:** H4-coverage-by-equipment; Funnels `load booked` → `carrier assigned`, Totals, hold `shipment_id` constant, median time to convert, breakdown `equipment_type`; `-- STORY H4` and `-- EVAL Q6`.
- **Context needed:** 01-business.md (cover step, equipment), 04-metrics-and-tables.md (time to cover).
- **Grading:** must hold `shipment_id` constant and report by equipment. Wrong: unique-user funnels across many loads (pairs a booking with another load's assignment); a single overall number.

### Q7 — Does a bad first delivery cost us new shippers?
- **Prompt:** "Customer success says some new shippers stop after their first loads. Does a late first delivery have anything to do with it?"
- **Type:** retention
- **Answer:** Yes, strongly. Among new shippers (signed up in the window) whose first `load delivered` was on or before Sep 17, **33.2% of those whose first delivery was late** came back to request a quote on or after day 14, vs **78.8% when it was on time (0.42x)** (256 vs 1,275 shippers). With a 14-27 day bracket (first deliveries to Sep 3): 30.7% vs 58.4% (0.53x). 16.7% of new shippers' first deliveries were late. The late group is small (about 250 shippers), so treat the size as roughly "half as likely to come back, or worse" rather than a precise number. Accept 0.40x-0.65x.
- **Evidence:** H5-late-first-load-churn; Retention, birth `load delivered` (first time), cohort new shippers (`account created` in window), breakdown `on_time`, return `quote requested`, on or after day 14; `-- STORY H5` and `-- EVAL Q7`.
- **Context needed:** 01-business.md (goal 7), 03-event-dictionary.md (`on_time`), 04-metrics-and-tables.md (active shipper excludes carrier and billing events).
- **Grading:** must split by the first delivery's on-time flag and use a shipper action as the return event. Wrong: using "any event" as the return (invoices and carrier events keep arriving after a shipper leaves, which hides the drop); including established customers; including first deliveries too late for the bracket.

### Q8 — Which paid channel is worth the money?
- **Prompt:** "Which paid channel gives us the cheapest new shippers? Is Google as cheap as it looks?"
- **Type:** external-join
- **Answer:** Google is cheapest per signup but not per real customer. Window spend per Mixpanel signup (warehouse `paid_marketing_daily`): **Google Ads $56.20, trade media $80.37, LinkedIn $110.42**. Only **36.0%** of Google signups are approved for credit within 7 days vs about 72% elsewhere (LinkedIn 72.0%, trade media 71.6%), so **spend per approved shipper is $156.26 Google vs $153.32 LinkedIn (≈1.0x)** and **$112.23 trade media**, the cheapest. Per load booked by those signups in the window: Google $55.27, LinkedIn $54.61, trade media $39.99. Spend: LinkedIn $79.7k, Google $63.3k, trade media $56.9k. Recommendation: move budget toward trade media; Google is not cheaper than LinkedIn once credit approval is counted. Accept Google per signup about half of LinkedIn (0.45x-0.55x), Google ≈ LinkedIn per approved shipper (0.9x-1.1x), and trade media cheapest per approved shipper.
- **Evidence:** H6-paid-channel-economics; Insights `account created` by `acquisition_channel` joined to `paid_marketing_daily.spend_usd`; Funnels onboarding by channel; `-- STORY H6` and `-- EVAL Q8`.
- **Context needed:** 04-metrics-and-tables.md (CAC uses Mixpanel signups, table columns), 01-business.md (channels, credit approval).
- **Grading:** must join spend to Mixpanel signups and go past cost per signup. Wrong: using `leads_reported` as the denominator (platforms over-claim, e.g. Google 1,322 claimed vs 1,126 signups); stopping at "Google is half the price of LinkedIn".

### Q9 — Where do new shippers drop in onboarding?
- **Prompt:** "Too many signups never book a load. Where do they drop in onboarding, and is it worse for some group?"
- **Type:** funnel
- **Answer:** Overall **62.7%** of new shippers are approved for credit within 7 days (4,422 signups). The gap is **Google Ads**: 57.7% of Google signups submit a credit application and **36.0%** are approved, vs 80.6% and **71.8%** for every other channel combined (**0.50x**). Google is 25% of signups (1,126 of 4,422). Other channels sit at 71.6%-72.0% approval. Shippers who are not approved cannot book and leave after a few days of rate lookups. Accept Google 0.45x-0.55x of the rest.
- **Evidence:** H6-paid-channel-economics; Funnels `account created` → `credit application submitted` → `credit approved`, 7-day window, breakdown `acquisition_channel`; `-- EVAL Q9`.
- **Context needed:** 01-business.md (credit approval), 03-event-dictionary.md (onboarding events), 04-metrics-and-tables.md (credit approval rate).
- **Grading:** must break down by acquisition channel. Wrong: blaming company tier or signup method; only reporting the overall rate.

### Q10 — What happened to on-time delivery in mid-September?
- **Prompt:** "On-time delivery fell off a cliff in mid-September. What happened and how big was it?"
- **Type:** context
- **Answer:** **Hurricane Odessa** (timeline: landfall on the central Gulf Coast on Sep 14, then inland across the Southeast through Sep 18). The analyst has to find the affected lanes in the data: loads on **Gulf lanes** (origin or destination in `south_central` or `southeast`) picked up Sep 14-18 arrived late **71.9%** of the time vs **18.9%** for other lanes picked up the same days and **18.6%** for all other loads. By delivery week, Gulf-lane late share was 66.4% the week of Sep 14 and 43.1% the week of Sep 21 (late deliveries spilled over), vs 16.5%-19.7% in every other week; other lanes stayed at 17.3%-20.8% throughout. Carriers reported 1,215 `weather_delay` exceptions Sep 14-20 vs 50 the week of Aug 31. Accept a Gulf-lane late share of 60%-75% in the storm days and naming the regions.
- **Evidence:** H7-hurricane-odessa; Funnels `pickup confirmed` → `load delivered`, hold `shipment_id`, Sep 14-18, breakdown region and `on_time`; Insights `delivery exception` by `exception_type`; `-- STORY H7` and `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (hurricane, path), 03-event-dictionary.md (regions table).
- **Grading:** must name the storm, the affected regions, and give the size against a baseline. Wrong: "carrier performance collapsed nationwide" (other lanes did not move); blaming Instant Book or Live ETA.

### Q11 — Why is margin lower in September?
- **Prompt:** "Gross margin looks lower in September. Why?"
- **Type:** external-join
- **Answer:** Two causes, both in the warehouse. Monthly margin: June 15.5%, July 15.6%, August 14.4%, **September 12.4%**. (1) **Instant Book mix**: from Aug 11 about 27% of billed revenue is instant loads at about 9% margin vs about 15% for negotiated loads (Q5). (2) **Hurricane Odessa**: spot rates jumped in the storm days (flatbed $2.81 → $3.27 per mile, +16%; dry van +13%; reefer +11%, vs the two weeks before) and faded by about Sep 24; margins compressed on both methods (instant 9.3% → 6.1%, negotiated 15.5% → 11.3% in Sep 14-18; 8.6% and 14.2% in Sep 19-30). Accept naming both the instant mix and the storm-week squeeze, with September near 12%-13%.
- **Evidence:** H3-instant-book-experiment and H7-hurricane-odessa (warehouse reads); `load_margin_daily` by month and method, `spot_market_rates_daily` by day; `-- EVAL Q11` and `-- EVAL Q17`.
- **Context needed:** 02-timeline.md (test, hurricane), 04-metrics-and-tables.md (both tables, margin % method).
- **Grading:** must use the margin table and separate mix from rate. Wrong: "shippers paid less" (booked revenue per load did not fall: about $2,890-2,920 in June-August and $3,084 in September as spot rates rose); only one of the two causes; averaging daily percentages.

### Q12 — Is there a magic number of saved lanes?
- **Prompt:** "Do new shippers who save their lanes ship more with us? Is there a number we should push for in onboarding?"
- **Type:** segmentation
- **Answer:** Yes: **three lanes**. Loads booked per credit-approved new shipper by saved lanes: 0: 1.72, 1: 1.87, 2: 1.83, **3: 3.69**, 4: 3.65, 5: 3.71, 6: 3.63, 7: 3.84. **Under 3 lanes: 1.81 loads vs 3+: 3.69 (0.49x)**; within each company tier the ratio is 0.48 (enterprise), 0.51 (mid-market), 0.505 (small business), 0.50 weighted. There is no meaningful gain past 3 (5+ vs 3-4: 0.97x within tier, 1.01x pooled; read it within tier, because enterprise shippers book several times more loads and tier mix moves the small pooled buckets). New shippers save lanes only in their first two weeks (including the onboarding lane), so `saved_lanes` on the profile is that count. Mixpanel's "average per user" on `load booked` counts only shippers who booked at least once; read that way it is 2.83 vs 4.62 loads (0.61x), and 64% of under-3 shippers book any load vs 80% of 3+ shippers. Accept a step at 3 with under-3 at 0.45x-0.57x of 3+ per approved shipper, or about 0.55x-0.7x per booking shipper if the analyst names that measure.
- **Evidence:** H8-saved-lanes-threshold; Insights, A = `load booked` (total), B = `credit approved` (uniques), formula A / B, filter user property `customer_since` on or after 2026-06-04, breakdown `company_tier` and `saved_lanes`; `-- STORY H8` and `-- EVAL Q12`.
- **Context needed:** 01-business.md (saved lanes, onboarding), 03-event-dictionary.md (`lane saved`, `saved_lanes`).
- **Grading:** must restrict to new approved shippers and show the step and the plateau. Wrong: "more lanes is always better"; mixing in established customers (their saved lanes come from before the window); total loads instead of loads per shipper.

### Q13 — What drives detention charges?
- **Prompt:** "Detention charges are eating into shipper satisfaction. What drives them?"
- **Type:** segmentation
- **Answer:** **Dock appointments.** Loads booked with `appointment_scheduled = true` got a detention charge **8.8%** of the time vs **21.7%** without one (**0.41x**), for loads booked through Sep 14. It holds in every tier (enterprise 8.9% vs 22.1%, mid-market 8.9% vs 21.6%, small business 8.4% vs 21.6%). Appointment use differs by tier (enterprise 64%, mid-market 45%, small business 25%), so small businesses carry the most detention. Lumper fees do not depend on appointments (9.8% vs 10.1%). Detention was 8,246 charges and $2.47M in the window (about $300 each). Recommendation: push appointment scheduling, especially for small-business shippers. Accept 0.33x-0.47x.
- **Evidence:** H9-dock-appointments; Funnels `load booked` → `accessorial charged` (charge_type = detention), Totals, hold `shipment_id`, breakdown `appointment_scheduled`; `-- STORY H9` and `-- EVAL Q13`.
- **Context needed:** 01-business.md (accessorials, appointments), 03-event-dictionary.md (`appointment_scheduled`, `charge_type`).
- **Grading:** must compare per-load detention rates by appointment. Wrong: "enterprise shippers cause less detention" without seeing that appointments explain it; counting all accessorials together.

### Q14 — Why did quotes crash on two days?
- **Prompt:** "Quote volume crashed on July 3 and September 7. Was something broken?"
- **Type:** context
- **Answer:** Nothing broke; those are **US holidays** (Independence Day observed on Friday Jul 3, Labor Day Monday Sep 7) when most shippers are closed. Quotes: **369 on Jul 3** vs 1,423 on Fri Jun 26 and 1,510 on Fri Jul 10 (about −75%); **539 on Sep 7** vs 1,976 on Mon Aug 31 and 1,972 on Mon Sep 14 (about −73%). Dashboard views fell the same way (194 and 256). Pickups did not (515 on Jul 3, 746 on Sep 7): carriers kept moving loads booked before the holiday. Accept naming both holidays and a drop of roughly two thirds or more.
- **Evidence:** `-- EVAL Q14`; Insights `quote requested`, daily.
- **Context needed:** 02-timeline.md (holidays).
- **Grading:** must tie both days to the holidays. Wrong: "an outage"; comparing a holiday Friday to a Monday.

### Q15 — Do bigger shippers convert quotes better? (null)
- **Prompt:** "Do enterprise shippers convert quotes to bookings better than small businesses? Should sales prioritize their quotes?"
- **Type:** null-hypothesis
- **Answer:** **No.** Per quote (7-day window), enterprise 31.8%, mid-market 31.7%, small business 32.0% (z ≈ −0.4 and −0.8 vs small business). Within each equipment type the tiers are also level (dry van 32.5% / 32.2% / 32.6%; reefer 30.6% / 30.9% / 30.7%; flatbed 30.6% / 30.9% / 31.0%; enterprise vs small business |z| ≤ 0.6). Enterprise shippers send more quotes, so they book more loads in total, but they do not convert better. What moves conversion is price vs market (Q3). Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q15`; Funnels `quote requested` → `load booked`, Totals, hold `shipment_id`, 7-day window, breakdown `company_tier`.
- **Context needed:** 01-business.md (tiers), 04-metrics-and-tables.md (quote-to-book rate).
- **Grading:** must use a per-quote rate and treat the gap as noise. Wrong: loads per user by tier ("enterprise converts 3x better"); unique-user funnels.

### Q16 — Did Instant Book help reefer and flatbed too? (null)
- **Prompt:** "Since Instant Book started, are reefer and flatbed quotes booking better for shippers in the Instant Book group?"
- **Type:** null-hypothesis
- **Answer:** **No.** Reefer and flatbed quotes are not part of the test, and they book the same in both arms: from Aug 11 to Sep 24, **30.9% in Control vs 31.0% in Instant Book** (z ≈ 0.2); reefer 30.8% vs 30.5% (z ≈ −0.3), flatbed 30.9% vs 31.5% (z ≈ 0.7). No tier shows a significant gap (enterprise 30.1% vs 32.2%, z ≈ 1.8, p ≈ 0.08; mid-market and small business |z| ≤ 0.9, in the other direction). The Instant Book lift is confined to dry van quotes (Q4). Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q16`; Funnels `quote requested` (equipment_type in reefer, flatbed) → `load booked`, Totals, hold `shipment_id`, 7-day window, Aug 11 - Sep 24, breakdown `Experiment: Instant Book`.
- **Context needed:** 02-timeline.md (test scope: dry van only).
- **Grading:** must check the data by arm and call it noise. Wrong: "Instant Book lifted all equipment" (pooling dry van in); claiming a halo effect from a 0.1-point gap or from the one non-significant enterprise split.

### Q17 — What should we worry about this quarter?
- **Prompt:** "Give me a quarter review: what's going well and what should we worry about going into Q4?"
- **Type:** open-ended
- **Answer:** Volume grew: monthly loads booked 9,842 (Jun 4-30) → 12,430 (Jul) → 13,972 (Aug) → 14,998 (Sep), booked revenue $28.7M → $46.2M, active shippers 6,161 → 8,171, about 1,150 new signups a month. Worries, in order: (1) **margin** fell to 12.4% in September (15.5% in June) from the Instant Book mix and the storm squeeze (Q5, Q11); Instant Book as built loses margin dollars per quote (Q4). (2) **New-shipper activation**: only 62.7% are approved for credit, and Google signups are approved at half the rate (Q9); a late first delivery cuts the chance a new shipper comes back by half or more (Q7). (3) **Hurricane exposure**: Gulf-lane on-time fell to about 28% in the storm days (Q10). Going well: Live ETA cut tracking tickets by 60% (Q1); appointments cut detention (Q13); pricing near market wins loads (Q3). A good answer names at least three of these with numbers.
- **Evidence:** `-- EVAL Q17` plus the story queries cited.
- **Context needed:** all guides.
- **Grading:** must combine event data and the margin table and rank the risks. Wrong: celebrating growth without margin; reporting raw tickets or raw bookings without rates.

### Q18 — How is volume trending?
- **Prompt:** "How have quotes and loads trended over the summer? Where is the growth coming from?"
- **Type:** trend
- **Answer:** Up about a quarter. Weekly quotes went from about 8,500-8,750 in full June weeks to 10,700-10,850 in full September weeks (the Jul 3 and Labor Day weeks dip; the first and last weeks are partial); weekly loads booked from about 2,570-2,650 to 3,600-3,675. Most of the growth is new shippers: loads booked by shippers who joined in the window went from 360 in June to 3,377 in September (46 → 336 quotes a day). Established customers quote at the same pace (1,160 quotes a day in June, 1,162 in September), but their loads went from 351 to 387 a day (+10%); that gain is the Instant Book test: established shippers in the Instant Book arm booked 107 → 142 dry van loads a day vs 106 → 114 in Control. New signups run steadily at about 220-275 a week. Accept growth of roughly 20%-35% with most of it from new shippers, and for full credit, established volume flat in quotes with the extra loads from Instant Book.
- **Evidence:** `-- EVAL Q18`; Insights `quote requested` and `load booked`, weekly; breakdown by `customer_since` in the window.
- **Context needed:** 00-manifest.md (scale), 04-metrics-and-tables.md (new shippers).
- **Grading:** must separate new from established shippers. Wrong: comparing the partial first or last week with full weeks; attributing all growth to Instant Book; claiming established customers quote more.

### Q19 — What's our on-time rate, and does it differ by equipment?
- **Prompt:** "What's our on-time delivery rate? Is reefer or flatbed worse than dry van?"
- **Type:** segmentation
- **Answer:** Outside the hurricane days, **81.5% on time** (46,100 loads); dry van 81.6%, flatbed 80.8%, reefer 81.6%: no meaningful equipment difference. Over the whole window including the storm, 79.2% (50,905 deliveries). Equipment matters for how long a load takes to cover (Q6), not for on-time delivery. Accept about 79%-82% and "no real difference by equipment".
- **Evidence:** `-- EVAL Q19`; Insights `load delivered`, share with `on_time = true`, breakdown `equipment_type`.
- **Context needed:** 04-metrics-and-tables.md (on-time delivery rate), 02-timeline.md (hurricane).
- **Grading:** must separate or mention the storm days. Wrong: "reefer is much worse"; reporting the storm-week rate as typical.

### Q20 — How fast do shippers pay?
- **Prompt:** "How long do shippers take to pay us? Is anyone paying slower than their terms?"
- **Type:** segmentation
- **Answer:** Median days from delivery to payment: **enterprise 37 days (net_45), mid-market 27 days (net_30), small business 19 days (net_21)**; means 39.8, 28.5, 20.1 days. Each tier pays inside its terms at the median; a tail pays late (the means sit above the medians). Invoices for loads delivered late in the window are paid after it ends, so recent weeks show fewer `invoice paid` events than loads. Accept the three medians within ±2 days.
- **Evidence:** `-- EVAL Q20`; Insights `invoice paid`, median of `days_to_pay`, breakdown `company_tier` or `payment_terms`.
- **Context needed:** 01-business.md (payment terms), 03-event-dictionary.md (`days_to_pay`).
- **Grading:** must break down by tier or terms. Wrong: one overall number; counting unpaid recent loads as late payers.
