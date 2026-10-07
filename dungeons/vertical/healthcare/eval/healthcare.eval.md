# Clearwell Health (healthcare) — 20-question eval

- **Data:** `data/verify-healthcare` (full fidelity: 10,000 patient profiles, 9,987 with events, 3,479 new signups, 1,213,081 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query (or the `-- STORY` query it names) in `dungeons/vertical/healthcare/healthcare.sql` on that data.
- **Stories:** ids refer to the `stories` export in `healthcare.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Is Clearwell Async being used?
- **Prompt:** "We launched Clearwell Async in July. Are patients actually using it?"
- **Type:** trend
- **Answer:** Yes, for the conditions it covers. Among urgent-care requests for the four eligible reasons (urinary, rash, pink eye, allergy), the Async share went from 0 before July 15 to 5.9% in the launch week (Jul 13-19), 29.6% the week of Jul 20, 41.6% the week of Jul 27, and **about 50% from August on** (47.0%-54.2% every full week from Aug 3; 762 of 1,534 eligible requests from Jul 29 = **49.7%**). It then holds flat rather than continuing to grow. In total 807 patients requested 844 Async visits; the median Async visit closed **2.5 hours** after the request, and no Async request was abandoned. Async never appears for other reasons. Accept 45%-55% steady share after a two-week ramp.
- **Evidence:** H1-async-launch; Insights, `visit requested` filtered `reason_category` in (urinary, skin_rash, pink_eye, allergy), breakdown `visit_type`, weekly, % of total; `-- STORY H1` and `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (launch date, eligible conditions), 03-event-dictionary.md (`visit_type`).
- **Grading:** must use the eligible reasons as the denominator and describe the ramp then plateau. Wrong: Async share of all urgent requests (15.5% from Jul 29, because most reasons are not eligible) presented as adoption; "adoption keeps growing".

### Q2 — How long will patients wait?
- **Prompt:** "How long are patients willing to sit in the virtual waiting room? Is there a point where they give up?"
- **Type:** funnel
- **Answer:** About **ten minutes**. Per live request (hold `visit_id` constant), the visit starts **93%** of the time when the estimated wait is up to 10 minutes (1-5 min 93.5%, 6-10 min 93.2%), then falls through the next ten minutes (11-15 min 86.0%, 16-19 min 67.1%) and levels off at about **64-66%** from 20 minutes on (20-30 min 65.6%, 31+ min 64.4%). So waits of 20+ minutes keep about **0.70x** the starts of short waits (65.2% vs 93.3%). Overall 14.5% of 7,585 live requests ended in `waiting room left`; the median estimated wait is 9 minutes and patients who left had waited a median of 11 minutes. Accept a threshold around 10-15 minutes with a plateau near 60-66% beyond 20.
- **Evidence:** H2-waiting-room-threshold; Funnels `visit requested` → `visit started`, Totals, hold `visit_id` constant, 1-day window, filter `visit_type` ≠ async, breakdown `estimated_wait_min` custom buckets; `-- STORY H2` and `-- EVAL Q2`.
- **Context needed:** 03-event-dictionary.md (`estimated_wait_min`, `waiting room left`), 04-metrics-and-tables.md (visit start rate).
- **Grading:** must break down by the estimated wait shown at request and name the zone where starts fall. Wrong: "longer waits always lose patients linearly" (flat below 10 and above 20 minutes); using `minutes_waited` (only exists for patients who left); including Async requests (wait 0).

### Q3 — What happened to urgent care in mid-August?
- **Prompt:** "Completed urgent-care visits dipped for a couple of weeks in August. What happened?"
- **Type:** external-join
- **Answer:** The **locum agency gap, Aug 10-23** (timeline). `clinician_staffing_daily` shows `agency_clinician_hours` = 0 for urgent care on exactly those 14 days (agency is normally 40% of urgent hours), so urgent clinician hours fell from about 44 to 27 a day (**0.62x**; 0.63x per request). Requests stayed at their normal level (395 and 396 live requests in the two gap weeks vs 375-430 in the weeks around), but the average estimated wait rose from **10.8 to 23.3 minutes (2.16x)**, and the share of live requests that reached a clinician dropped from about **87% to 74%** (weeks of Aug 10 and Aug 17: 72.7% and 76.0%, vs 84.5%-90.8% in the weeks around). Everything returned to normal on Aug 24 when the new agency started. Accept 1.9x-2.4x on waits and a start-rate drop to roughly 68-80%.
- **Evidence:** H3-urgent-care-staffing-gap; Insights `visit requested` (visit_type ≠ async) average `estimated_wait_min` daily, Funnels request → started by week, joined to `clinician_staffing_daily`; `-- STORY H3` and `-- EVAL Q3`.
- **Context needed:** 02-timeline.md (agency contract), 04-metrics-and-tables.md (`clinician_staffing_daily`).
- **Grading:** must connect the staffing table to longer waits and fewer started visits. Wrong: "demand fell" (requests were flat); blaming the Aug 31 price change or seasonality; reading total completed visits without separating Async.

### Q4 — Should we ship Prescription Pickup Reminders?
- **Prompt:** "Is the Prescription Pickup Reminders test working? Should we turn it on for everyone?"
- **Type:** funnel
- **Answer:** Yes. For urgent-care prescriptions from Jul 28 to Sep 24 (each with a full 7-day window), **80.8%** of Text Reminders prescriptions were picked up within 7 days vs **64.9%** in Control (**1.25x**; 925 vs 888 prescriptions). The arms are identical until the text goes out: within 20 hours of the prescription 32.4% vs 32.7% were picked up. The gain comes after the 20-hour text: within 24 hours 60.0% vs 40.9% (1.47x), and pickups between 20 hours and 7 days were 48.3% vs 32.2% of prescriptions. The median time to pickup does not fall (21.7 vs 19.9 hours), because the extra pickups the text recovers arrive after it; that is not a sign the reminder slows anyone down. The split is balanced (897 vs 917 exposed patients, one exposure each). 698 reminder texts went to 635 patients. Recommend shipping, and extending it to primary care prescriptions (not in the test). Accept a 7-day lift of 1.10x-1.40x, no difference before 20 hours, and a gain concentrated after the text.
- **Evidence:** H4-pickup-reminders-experiment; Funnels `prescription sent` → `prescription picked up`, Totals, hold `visit_id` constant, 7-day conversion window (repeat with 20-hour and 24-hour conversion windows), filter `service_line` = urgent_care, Jul 28 - Sep 24, breakdown `Experiment: Prescription Pickup Reminders`. The Experiments report on `$experiment_started` reads the same prescriptions: exposure fires one second before each patient's first prescription in the test, so all 2,087 in-test prescriptions follow the exposure. `-- STORY H4` and `-- EVAL Q4`.
- **Context needed:** 02-timeline.md (test design), 03-event-dictionary.md.
- **Grading:** must compare arms per prescription after the start and report the 7-day pickup rate; strong answers show the arms match before the 20-hour text and diverge after it. Wrong: "reminders slow pickup" from the median time to convert (the median rises only because recovered pickups are late); including primary care prescriptions or prescriptions before Jul 28; comparing reminded vs not-reminded patients inside the variant (only slow pickups get a text).

### Q5 — Who stops sending remote monitoring readings?
- **Prompt:** "Are our remote monitoring patients sticking with the program? Who drops off?"
- **Type:** retention
- **Answer:** Patients with **Bluetooth devices**. Of patients who sent a reading in Jun 4-17, **55.9%** of Bluetooth patients still sent one in Sep 3 - Oct 1 vs **89.7%** of cellular patients (**0.62x**; 678 vs 514 patients); 70.5% overall. Monthly, the number of Bluetooth patients logging fell from 772 in July to 624 in September while cellular rose from 621 to 716 (new enrollees). It is not a program effect: hypertension 52.2% vs 88.0% and diabetes 62.9% vs 92.8% (Bluetooth vs cellular). Accept 0.5x-0.7x.
- **Evidence:** H5-bluetooth-cuff-lapse; cohort "did `reading logged` Jun 4-17", Insights uniques of `reading logged` Sep 3 - Oct 1, breakdown `device_connectivity` (or Retention with custom brackets); `-- STORY H5` and `-- EVAL Q5`.
- **Context needed:** 01-business.md (device models), 03-event-dictionary.md (`device_connectivity`, `sync_method`), 04-metrics-and-tables.md (engagement).
- **Grading:** must follow a fixed starting cohort and split by device. Wrong: total readings by month (new enrollees mask the drop); blaming program type or age.

### Q6 — Why do patients miss primary care appointments?
- **Prompt:** "Our primary care no-show rate seems high. What drives it?"
- **Type:** funnel
- **Answer:** How far ahead the appointment was booked. The overall no-show rate is **15.9%** (10,929 appointments booked Jun 4 - Sep 9, so every slot falls in the window), but it rises steadily with `lead_days`: **5.7%** for same/next-day, 7.2% at 2-3 days, 12.7% at 4-7 days, 19.4% at 8-14 days, **31.8%** at 15-21 days, about **+1.5 points per day of lead time** (8+ days 23.6% vs 0-1 days 5.7%, about 4.1x). Suggests offering sooner slots or extra reminders for far-out bookings. Accept a monotonic rise of roughly 1.2-1.8 points per day.
- **Evidence:** H6-no-shows-by-lead-time; Funnels `appointment booked` → `appointment missed`, Totals, hold `visit_id` constant, 30-day window, bookings Jun 4 - Sep 9, breakdown `lead_days`; `-- STORY H6` and `-- EVAL Q6`.
- **Context needed:** 03-event-dictionary.md (`lead_days`, `appointment missed`), 04-metrics-and-tables.md (no-show rate).
- **Grading:** must find lead time as the driver and quantify the slope. Wrong: blaming video vs phone or coverage type; including late-September bookings whose appointments fall after October 1 (they look like shows). Answers that stop at Aug 31 bookings are fine (same slope within noise).

### Q7 — How long until a new therapy client's first session?
- **Prompt:** "How long do new therapy clients wait for their first session? Does anything make it slower?"
- **Type:** funnel
- **Answer:** Median **5.3 days** from intake to first session (784 intakes Jun 4 - Aug 31; 89.7% reach a first session within 30 days). It depends on therapist choice: clients who take the first available therapist wait a median **4.0 days**; clients who ask for a specific therapist wait **9.4 days (2.4x)**. Almost all clients in both groups start within 30 days (90.6% specific vs 89.2% first available), so the choice delays the start rather than losing clients. Accept 2.2x-3.0x.
- **Evidence:** H7-therapist-choice-wait; Funnels `therapy intake completed` → `therapy session completed`, 30-day window, intakes Jun 4 - Aug 31, median time to convert, breakdown `therapist_preference`; `-- STORY H7` and `-- EVAL Q7`.
- **Context needed:** 01-business.md (therapist choice at intake), 03-event-dictionary.md.
- **Grading:** must use medians and break down by `therapist_preference`. Wrong: averages dominated by long waits; including continuing clients (no intake in the window).

### Q8 — Did the self-pay price cut pay off?
- **Prompt:** "We cut the self-pay urgent visit price from $79 to $59 on August 31. Did it work?"
- **Type:** external-join
- **Answer:** It bought volume; revenue per check held flat. Self-pay patients requested a visit after **36.8%** of symptom checks before vs **48.4%** after (**1.31x**), while insured patients did not change (61.9% → 62.2%). Self-pay requests rose from 7.1 to 11.6 a day, partly because of the respiratory season and the growing patient base. Billing (`visit_revenue_daily`) shows self-pay urgent revenue of $505 a day before and $631 after, but **revenue per self-pay symptom check stayed flat: $26.21 → $26.31 (1.00x)** against a 31% rise in conversion. The lower price gave back the extra volume: on price and conversion alone the cut is revenue-neutral (1.31 × 59/79 ≈ 0.98). Accept a conversion lift of 1.2x-1.5x and revenue per check roughly flat (about 0.9x-1.1x).
- **Evidence:** H8-self-pay-price-cut; Insights `visit requested` / `symptom check completed`, breakdown `coverage_type`, before vs after Aug 31; `visit_revenue_daily` (urgent_care, self_pay); `-- STORY H8` and `-- EVAL Q8`.
- **Context needed:** 02-timeline.md (date, prices), 01-business.md (coverage types), 04-metrics-and-tables.md (`visit_revenue_daily`).
- **Grading:** must normalize volume (per symptom check) and bring in billing for revenue. Wrong: "revenue per day rose 25%, so it worked" (driven by more demand, not the price); raw request counts across periods of different length; claiming insured patients changed.

### Q9 — Has respiratory season started?
- **Prompt:** "Are we seeing respiratory season yet? How big is it?"
- **Type:** trend
- **Answer:** Yes, from mid-September. Respiratory symptom checks were a steady ~21% of checks through early September (20.6% Jun 4 - Sep 13; 19.2%-22.3% every week in August and early September), rose to 28.7% the week of Sep 14 and **37.9%** the week of Sep 21. In Sep 21 - Oct 1, respiratory checks ran at **63.6 a day vs 23.5 before (2.7x)** while other reasons grew only 1.07x (patient growth), so **respiratory relative to other reasons is about 2.5x** its summer level (2.53x). The rise is more sick patients, not the same patients coming back: weekly patients with a symptom check went from about 797 (average week Aug 17 - Sep 13) to 1,009 the week of Sep 21 (+27%, checks +30%: 841 → 1,094), checks per patient per week stayed at 1.05-1.08, and the share of checks with another check by the same patient within 3 days stayed near its summer level (9.3% before, 10.3% Sep 21 - Oct 1; respiratory checks 9.2% → 9.1%). Timing matches school reopening and the start of public-health respiratory reporting in mid-September. Accept 2.2x-2.8x relative, and a start in the week of Sep 14.
- **Evidence:** H9-respiratory-season; Insights `symptom check completed`, breakdown `reason_category`, weekly (totals or uniques); `-- STORY H9` and `-- EVAL Q9`.
- **Context needed:** 02-timeline.md (schools, mid-September respiratory reporting).
- **Grading:** must separate the respiratory rise from overall growth (share or ratio to other reasons). Wrong: raw respiratory counts June vs September without adjusting for growth (overstates); "no change"; "it is mostly repeat visits" (repeat share is flat).

### Q10 — Do Spanish-speaking patients get the same access?
- **Prompt:** "The equity committee wants to know: do Spanish-speaking patients have the same urgent-care experience as English-speaking patients?"
- **Type:** segmentation
- **Answer:** No. Spanish-preferring patients see longer estimated waits: **17.3 vs 11.2 minutes on average (1.55x; medians 14 vs 9)**, and so more of them leave the waiting room: **81.2%** of their live requests reach a clinician vs **86.2%** for English (18.8% vs 13.8% leave). Staffing explains it: Spanish-speaking clinicians are **8.0%** of urgent clinician hours in `clinician_staffing_daily`, while Spanish speakers are **15.5%** of live requests (16.4% of patients). Accept 1.4x-1.8x on waits plus the staffing comparison.
- **Evidence:** H10-spanish-wait-gap (with H2); Insights `visit requested` (visit_type ≠ async), average `estimated_wait_min`, breakdown `preferred_language`; Funnels request → started by language; `clinician_staffing_daily.spanish_speaking_clinician_hours`; `-- STORY H10` and `-- EVAL Q10`.
- **Context needed:** 01-business.md (languages), 04-metrics-and-tables.md (`clinician_staffing_daily`).
- **Grading:** must show both the wait gap and its consequence, and ideally the capacity cause. Wrong: comparing visit counts per patient only; "no difference".

### Q11 — What did the August agency gap cost?
- **Prompt:** "How many visits did we lose during the August staffing gap?"
- **Type:** external-join
- **Answer:** About **100 urgent visits**. On the 14 zero-agency days (from `clinician_staffing_daily`, Aug 10-23) there were 791 live requests and 74.3% started, vs 87.1% in the 14 days either side; 791 × (0.871 − 0.743) ≈ 101 visits that would otherwise have happened. 202 patients left the waiting room on those days. At the average $44.21 billed per urgent visit (employer visits bill $0), that is about **$4,500** of visit revenue, plus the patient experience cost. Accept 70-140 visits.
- **Evidence:** H3-urgent-care-staffing-gap with H2; `-- EVAL Q11`.
- **Context needed:** 02-timeline.md, 04-metrics-and-tables.md.
- **Grading:** must use a counterfactual start rate (or completion rate) from surrounding days, applied to gap-day demand. Wrong: counting only `waiting room left` events on gap days (includes patients who would have left anyway); comparing to June.

### Q12 — How much visit revenue do we make?
- **Prompt:** "What does our monthly visit revenue look like, and which service line brings in the most?"
- **Type:** context
- **Answer:** From `visit_revenue_daily`: **June (Jun 4-30) $360,792, July $446,835, August $454,523, September $474,693** (growing with the patient base). In September, primary care brought in the most ($214,966), then behavioral health ($160,031) and urgent care ($99,695), on 7,936 billed visits; about two thirds of revenue is payer reimbursement ($307,164) and one third patient payments ($167,529). Employer clients' monthly fees (about $190,000 a month per 01-business.md) are not in this table. Accept the table's figures and the note about employer fees.
- **Evidence:** `-- EVAL Q12`; warehouse `visit_revenue_daily`.
- **Context needed:** 01-business.md (revenue sources), 04-metrics-and-tables.md.
- **Grading:** must use the warehouse and note that employer revenue is outside it. Wrong: estimating revenue from Mixpanel `patient_cost_usd` (misses payer reimbursement); calling the June partial month a decline.

### Q13 — Did Async raise completed visits for minor conditions?
- **Prompt:** "Did Async change how many minor-condition requests end in a completed visit?"
- **Type:** funnel
- **Answer:** Yes, modestly. For the four eligible reasons, the share of requests completed within a day rose from **88.2% before launch to 91.3% after the ramp** (from Jul 29), because Async requests complete 99.9% of the time with no waiting room, while live requests for the same reasons still complete about 83% (video 83.0%, phone 82.6%). For other reasons completion went from 86.5% to 84.4% (the August staffing gap falls in the later period), so against that control group the gain is about 5 points. Async visits close in a median 2.5 hours vs about 20 minutes for live visits. Accept a gain of roughly 1-7 points for eligible reasons.
- **Evidence:** H1-async-launch with H2; Funnels `visit requested` → `visit completed`, Totals, hold `visit_id` constant, 1-day window, breakdown reason group and period; `-- EVAL Q13`.
- **Context needed:** 02-timeline.md, 03-event-dictionary.md (Async skips `visit started`).
- **Grading:** must use request → completed (not → started) and compare with a control group of reasons or time. Wrong: using `visit started` (Async never starts); claiming Async made live visits worse.

### Q14 — Are patients less satisfied with Async? (null)
- **Prompt:** "Some clinicians worry Async is lower-quality care. Are patients rating Async visits worse than live visits?"
- **Type:** null-hypothesis
- **Answer:** **No meaningful difference.** For urgent-care visits rated since the Jul 15 launch, Async visits average **4.12 stars** (310 ratings) vs **4.06** for live video/phone visits (1,464), z ≈ 0.85 (p ≈ 0.4); 78.7% vs 75.8% are 4-5 stars. For the same four eligible reasons, live visits average 4.05 (315 ratings, z ≈ 0.8). The null also holds by platform and by Prescription Pickup Reminders arm (every |z| ≤ 1.41, p ≥ 0.16). Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q14`; Insights `visit rated` average `rating`, filter `service_line` = urgent_care, breakdown `visit_type` (on the rating event), from Jul 15. The H1 story re-checks this z on every run.
- **Context needed:** 03-event-dictionary.md (`visit rated`).
- **Grading:** must check significance or the comparable reasons. Wrong: "Async is rated worse" (or better) from a few hundredths of a star; comparing ratings across different reasons without noting the mix.

### Q15 — Did the price cut change insured patients' behavior? (null)
- **Prompt:** "Did the self-pay price cut spill over to insured patients, for example more of them requesting visits?"
- **Type:** null-hypothesis
- **Answer:** **No.** Insured patients requested a visit after **61.9%** of symptom checks before Aug 31 and **62.2%** after (z ≈ 0.3, p ≈ 0.8). Each insured coverage type is flat too (commercial 61.0% → 60.9%, employer 62.1% → 63.0%, Medicare 62.9% → 61.8%, Medicaid 62.1% → 62.9%; every |z| ≤ 0.6). Their prices did not change. Accept "no change".
- **Evidence:** `-- EVAL Q15`; Insights `visit requested` / `symptom check completed`, breakdown `coverage_type`, before vs after Aug 31.
- **Context needed:** 02-timeline.md (price cut applies to self-pay only).
- **Grading:** must use a rate per symptom check. Wrong: raw request counts (insured requests per day rose with growth and respiratory season).

### Q16 — Which coverage type is worth the most per urgent visit?
- **Prompt:** "Which patients bring in the most revenue per urgent-care visit?"
- **Type:** external-join
- **Answer:** Per billed urgent visit (`visit_revenue_daily`, whole window): **commercial $86.75** (copay $18.75 average + $68 payer rate), **self-pay $71.43** (blend of $79 and $59 list prices), Medicare $57, Medicaid $38. **Employer-covered visits show $0** even though they are the largest group (36% of billed urgent visits), because employers pay a fixed monthly fee per eligible employee instead of per visit (01-business.md). So employer patients' visits are a cost against a fixed fee, not a revenue line. Accept the per-visit figures and the employer explanation.
- **Evidence:** `-- EVAL Q16`; warehouse `visit_revenue_daily`.
- **Context needed:** 01-business.md (how patients pay, employer fees), 04-metrics-and-tables.md.
- **Grading:** must explain the employer $0. Wrong: "employer patients are worthless"; using Mixpanel `patient_cost_usd` alone.

### Q17 — When does urgent-care demand peak?
- **Prompt:** "When during the week and day do we get the most urgent-care requests? We want to schedule clinicians better."
- **Type:** trend
- **Answer:** **Monday is the busiest day** (1.19x an average day), then Tuesday (1.08x); **Saturday is the quietest** (0.83x), then Sunday (0.91x) and Friday (0.95x). By hour, requests run high from **12:00 to 01:00 UTC** (about 1.0x-1.56x an average hour; US morning through evening) and are lowest at **06:00-09:00 UTC** (0.17x-0.24x; US night). Accept Monday peak, Saturday low, and a US-daytime peak expressed in UTC.
- **Evidence:** `-- EVAL Q17`; Insights `visit requested`, breakdown day of week and hour (project time zone UTC).
- **Context needed:** 00-manifest.md (UTC, US time zones).
- **Grading:** must state UTC or convert to US time. Wrong: reading UTC hours as local hours; "weekends are busiest".

### Q18 — How many patients did we serve each month?
- **Prompt:** "How many patients did we serve each month, and how many visits?"
- **Type:** context
- **Answer:** Patients with a completed visit or therapy session: **June (Jun 4-30) 3,140, July 3,779, August 4,004, September 4,323**. September volume: 2,198 urgent visits, 3,127 primary care visits, 2,333 therapy sessions; 894 new patients signed up (782-894 a month). Active patients (any patient-initiated event) grew from 7,128 in June to 9,766 in September. Accept the monthly figures; growth is steady new-patient acquisition (about 200 a week).
- **Evidence:** `-- EVAL Q18`; Insights uniques of `visit completed` + `therapy session completed` by month.
- **Context needed:** 00-manifest.md, 04-metrics-and-tables.md (patients served, active patient).
- **Grading:** must name the definition used. Wrong: counting `reminder sent` as activity; treating June as a full month.

### Q19 — What should leadership worry about?
- **Prompt:** "Looking at the last four months, what should we worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names at least three, with numbers:
  - **Waiting-room losses**: 14.5% of live requests leave; starts fall from 93% to about 65% once waits pass 10-20 minutes (Q2).
  - **Spanish-language access gap**: waits 1.55x and 81% vs 86% reach a clinician; Spanish-speaking clinicians are 8% of urgent hours for 15.5% of live requests (Q10).
  - **Staffing fragility**: the Aug 10-23 agency lapse doubled waits and cost about 100 visits; renewals need a backstop (Q3, Q11).
  - **Respiratory season**: respiratory demand is 2.5x relative to summer and urgent requests are up 37% (97 vs 71 a day); so far clinician hours rose with demand (58 vs 44 a day) and waits held (11.1 min average, 87.4% of live requests started, Sep 21 - Oct 1), but the fall peak is still ahead (Q9).
  - **Remote monitoring**: Bluetooth patients drop out (56% vs 90% still logging) (Q5).
  - **No-shows on far-out bookings** (32% at 15-21 days) (Q6).
  - Positives: Prescription Pickup Reminders lifts 7-day pickup 1.25x (ship it, Q4); Async took half of eligible demand with no rating penalty (Q1, Q14).
- **Evidence:** H2, H3, H5, H6, H9, H10, H4, H1; `-- EVAL Q19` and the queries above.
- **Context needed:** all guides.
- **Grading:** credit prioritized, quantified risks tied to the data. Penalize generic advice without numbers, or claims the data does not support (for example "Async patients are less satisfied", "reminders slow pickup", or a claim that the price cut alone drove the rise in self-pay revenue per day: revenue per self-pay symptom check is flat, and the daily rise comes from more demand).

### Q20 — Where should we add clinical capacity?
- **Prompt:** "If we can add clinician hours next quarter, where would they do the most good?"
- **Type:** open-ended
- **Answer:** Spanish-speaking urgent-care clinicians first: in September Spanish-preferring patients waited 16.1 minutes on average vs 10.1 for English and 21.4% left the waiting room vs 12.7% (70 of 327 live requests). Moving their waits under 10 minutes would recover roughly the gap in exit rates (about 8.7 points of ~330 requests a month, ≈ 28 visits a month, more in respiratory season), and it closes an equity gap the committee asked about. Second, a contractual backstop for agency cover (the August lapse cost ~100 visits in two weeks). Third, keep scaling urgent care to the respiratory forecast. Answers should note that waits above ~10 minutes are where patients start leaving (Q2), and that primary care and therapy capacity issues are about booking (lead time, therapist choice) more than raw hours.
- **Evidence:** H10, H2, H3, H9; `-- EVAL Q20`, `-- EVAL Q10`, `-- EVAL Q11`.
- **Context needed:** 01-business.md (staffing, languages), 04-metrics-and-tables.md (`clinician_staffing_daily`).
- **Grading:** credit for tying capacity to the wait threshold and the language gap with numbers. Wrong: "hire more therapists" without evidence; adding hours evenly across service lines.
