# Keystead Homes timeline: June 4 to October 1, 2026

All dates are UTC. This page lists what happened and when. It does not record outcomes; measure those in the data.

| Date | Type | What happened |
|---|---|---|
| 2026-06-04 (Thu) | — | Start of the analysis window. |
| 2026-06-22 (Mon) | Org | A new Head of Growth joins and takes over acquisition marketing. |
| 2026-07-01 (Wed) | Fiscal | Q3 starts. |
| 2026-07-03 (Fri) to 2026-07-04 (Sat) | Holiday | US Independence Day (observed Friday). |
| 2026-07-15 (Wed) | Launch | **Tour It Now** launches on the website and apps in all eight markets. From a listing page, a signed-in shopper can book a same-day or next-morning tour without waiting for the agent to schedule it. Rollout reached every shopper over the first week. Tours booked this way have `booking_type = tour_it_now`; all other tours are `scheduled`. |
| 2026-07-29 (Wed) | Experiment | **"Payment Estimate" test** starts. Shoppers who do not hold a current Keystead Home Loans pre-approval and have not applied since June 4 are assigned 50/50 at their first listing view from this date to **Control** (the current listing page) or **Payment Estimate** (the listing page shows an estimated monthly payment at today's rates, with a "Get pre-approved" link). Assignment is sticky per shopper and recorded with a `$experiment_started` event and the profile property `Experiment: Payment Estimate`. Applications started from the estimate have `entry_point = payment_estimate`. |
| 2026-08-10 (Mon) to 2026-08-16 (Sun) | Market | **Mortgage rates climb.** After a hot inflation report, the 30-year conventional rate on the Keystead Home Loans rate sheet rises over the week from about 6.3% to about 7.0%. Other loan types move with it. |
| 2026-08-17 (Mon) to 2026-09-13 (Sun) | Market | Rates stay near their high. |
| 2026-09-14 (Mon) to 2026-09-27 (Sun) | Market | Rates ease, settling near 6.6% by September 28. The daily rate sheet is in `mortgage_rate_sheet_daily`. |
| 2026-08-24 (Mon) to 2026-08-30 (Sun) | Incident | **Austin MLS feed outage.** The Austin MLS moved its data feed to a new vendor and Keystead's import failed. New Austin listings did not appear in Keystead search, and Austin saved-search alerts were paused because there was nothing new to send. Existing listings stayed visible. The fix went live at 00:00 UTC on August 31, and the backlog of listings arrived that day. Other markets were not affected. Daily feed status by market is in `market_inventory_daily`. |
| 2026-09-07 (Mon) | Holiday | US Labor Day. |
| 2026-09-30 (Wed) | Fiscal | End of Q3. |
| 2026-10-01 (Thu) | — | End of the analysis window (data runs through 23:59 UTC). Q4 starts. |

## Things that did not change in the window

- No change to search, listing pages (outside the Payment Estimate test), saved searches, or alerts.
- No change to how agents are assigned or staffed, or to agent working hours.
- No change to Keystead Home Loans products or underwriting. Rates follow the market each day.
- Paid channel budgets were steady through the window; no channel was added or paused.
- Keystead ran no holiday promotions, and agents worked normal schedules on holidays. Holidays are listed for reference.
- No feed problems in any market other than Austin.

## Open questions leadership has asked

- Did Tour It Now work? Are its tours as good as scheduled tours?
- Should Payment Estimate ship to everyone?
- How did the rate move in August affect buyers?
- Which paid channel brings buyers, not just accounts?
- What happened in Austin in late August, and how big was it?
- Do saved searches keep new shoppers around?
- Does agent response time matter?
