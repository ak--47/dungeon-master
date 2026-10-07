# Routewise Freight timeline: June 4 to October 1, 2026

All dates are UTC. This page lists what happened and when. It does not record outcomes; measure those in the data.

| Date | Type | What happened |
|---|---|---|
| 2026-06-04 (Thu) | — | Start of the analysis window. |
| 2026-06-22 (Mon) | Org | A new VP of Operations joins and takes over carrier sales and the weekly service review. |
| 2026-06-30 (Tue) | Fiscal | End of Q2. |
| 2026-07-03 (Fri) | Holiday | US Independence Day (observed). Most shippers are closed and Routewise runs a holiday crew. Carriers keep moving loads that are already booked. No product or marketing changes. |
| 2026-07-21 (Tue) | Launch | **Live ETA** launches. For every load in transit, the portal shows a live map and an estimated arrival time, and the shipper gets ETA notifications by email and text with a tracking link. It rolls out to all shippers over two weeks (complete by August 4). Tracking views opened from an ETA notification carry `view_source = eta_notification`. |
| 2026-08-11 (Tue) | Experiment | **"Instant Book" test** starts. Shippers who price a dry van load from this date are assigned 50/50 to **Control** (book through the usual flow with their rep) or **Instant Book** (the quote page offers a one-click booking at the quoted price; the shipper can still negotiate instead). Assignment is sticky per shipper user and recorded with a `$experiment_started` event on each dry van quote and the profile property `Experiment: Instant Book`. One-click bookings carry `booking_method = instant`. Reefer and flatbed quotes are not part of the test. |
| 2026-09-07 (Mon) | Holiday | US Labor Day. Most shippers are closed and Routewise runs a holiday crew. Carriers keep moving loads that are already booked. |
| 2026-09-14 (Mon) to 2026-09-18 (Fri) | Weather | **Hurricane Odessa.** The storm made landfall on the Louisiana coast early on September 14 and moved northeast across Mississippi, Alabama, and Georgia through September 18. Ports and interstates along the storm's path closed for parts of the week. Routewise kept taking and booking loads in every region. |
| 2026-09-30 (Wed) | Fiscal | End of Q3. |
| 2026-10-01 (Thu) | — | End of the analysis window (data runs through 23:59 UTC). Q4 starts. |

## Things that did not change in the window

- No change to the pricing desk's method for quoting (spot benchmark plus margin).
- No change to credit policy, payment terms, or the onboarding flow.
- No change to accessorial rates or detention rules.
- Paid channel budgets and bids were steady through the window; no channel was added or paused.
- The carrier network kept the same size and vetting rules.
- Routewise ran no holiday promotions.

## Open questions leadership has asked

- Did Live ETA reduce support tickets? Are shippers using it?
- Is Instant Book working, and should it ship to everyone? What does it do to margin?
- How much does the quote price relative to the market matter for winning loads?
- What happened to service in mid-September, and how big was it?
- Which paid channel deserves more budget?
- Why do so many new signups never book a load, and what do the ones who stay do differently?
- What drives detention charges?
- How did gross margin move over the quarter, and why?
