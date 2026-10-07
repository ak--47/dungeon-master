# Forkfly timeline: June 4 to October 1, 2026

All dates are UTC. This page lists what happened and when. It does not record outcomes; measure those in the data.

| Date | Type | What happened |
|---|---|---|
| 2026-06-04 (Thu) | — | Start of the analysis window. |
| 2026-06-22 (Mon) | Org | A new VP of Market Operations joins; the eight market managers now report to her. |
| 2026-07-01 (Wed) | Fiscal | Q3 starts. |
| 2026-07-03 (Fri) to 2026-07-04 (Sat) | Holiday | US Independence Day (observed Friday). Restaurants and couriers operated normally; Forkfly ran no holiday promotion. |
| 2026-07-07 (Tue) | Launch | **Order Again** ships on iOS and Android. Customers who have had an order delivered see their recent restaurants on the home screen and can reorder in one tap. Each use sends a `reorder tapped` event, and orders that start from it carry `entry_point = reorder`. The row appears for every eligible customer from launch day; customers discover it at their own pace. |
| 2026-07-28 (Tue) | Experiment | **"Smart Add-ons" test** starts. Customers are assigned 50/50 to **Control** (the current checkout screen) or **Smart Add-ons** (the checkout screen suggests a dessert, drink, or side that goes with the order). Assignment is sticky per customer and recorded with a `$experiment_started` event at the customer's first checkout on or after July 28, and in the profile property `Experiment: Smart Add-ons`. An item added from a suggestion carries `added_from = addon_suggestion`. |
| 2026-08-11 (Tue) | Pricing | **Service fee change.** The service fee on non-Pass orders rises from 10% to 15% of the subtotal. Pass orders stay at 5%. Delivery fees do not change. |
| 2026-08-25 (Tue) to 2026-08-28 (Fri) | Incident | **Card processor incident.** Paylane, our card processor, had a fault that declined many card payments. Customers saw "payment failed" and the order was not placed. Apple Pay, Google Pay, and PayPal run through other providers. Paylane fixed the fault at 00:00 UTC on August 29. Daily authorizations and declines by payment method are in `payment_gateway_daily`. |
| 2026-09-07 (Mon) | Holiday | US Labor Day. Normal operations; no promotion. |
| 2026-09-30 (Wed) | Fiscal | End of Q3. |
| 2026-10-01 (Thu) | — | End of the analysis window (data runs through 23:59 UTC). Q4 starts. |

## Weather

Summer weather varies a lot by city: Miami and Atlanta get frequent afternoon storms, while Seattle and Austin are mostly dry in summer. Forkfly does not change prices or fees for weather. Daily precipitation and conditions for each city are in `market_ops_daily`.

## Things that did not change in the window

- No change to delivery fees, Pass pricing ($9.99 a month), the Pass benefits, or the free-trial offer.
- No change to the restaurant line-up in any city, or to how the dispatch system quotes delivery times.
- No change to the signup flow or the welcome promotions (`WELCOME8`, `DEAL15`).
- Paid channel budgets were steady through the window; no channel was added or paused.
- Forkfly ran no holiday or seasonal campaigns. In past years, July 4 and Labor Day looked like ordinary days in the order data.
- Apple Pay, Google Pay, and PayPal had no incidents in the window.

## Open questions leadership has asked

- Is Order Again working, and how many customers use it?
- Should Smart Add-ons ship to everyone? Does it hurt conversion?
- Did the August service fee change cost us orders, and did it pay off?
- What happened to orders in late August, and how big was it?
- Which paid channel deserves more budget? Are coupon-site customers worth it?
- What makes a Pass trial convert?
- Why are some days and cities so much worse for late deliveries?
- Do new customers come back after their first order?
