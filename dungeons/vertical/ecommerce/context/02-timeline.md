# Marlowe & Pine timeline: June 4 to October 1, 2026

All dates are UTC. This page lists what happened and when. It does not record outcomes; measure those in the data.

| Date | Type | What happened |
|---|---|---|
| 2026-06-04 (Thu) | — | Start of the analysis window. |
| 2026-07-01 (Wed) | Holiday | Canada Day. No promotion. |
| 2026-07-03 (Fri) to 2026-07-04 (Sat) | Holiday | US Independence Day (observed Friday). No promotion and no site changes; the store ran as usual. |
| 2026-07-06 (Mon) | Org | A new Head of Growth joins and takes over the paid media team. Channel budgets were not changed. |
| 2026-07-06 (Mon) to 2026-08-09 (Sun) | Incident | **Northline Parcel hub disruption.** Northline reported a sortation equipment failure at its main Midwest hub. Parcels kept moving but slowly. Our contract volume stayed with Northline while their team worked the backlog; Northline reported normal service again from August 10. Daily carrier service levels are in `carrier_performance_daily`. |
| 2026-07-15 (Wed) | Experiment | **"One-Page Checkout" test** starts. From this date, when a shopper starts a cart they are assigned 50/50 to **Control** (the existing multi-page checkout) or **One-Page** (cart, shipping, and payment on one page). Assignment is sticky per customer. It is recorded once, with a `$experiment_started` event when the shopper starts their first cart in the test, and in the profile property `Experiment: One-Page Checkout`. The checkout steps are tracked the same way in both arms. |
| 2026-07-22 (Wed) | Launch | **Room Visualizer** launches on furniture and lighting product pages, on the website and in both apps. Opening it is tracked as `room visualizer opened`. |
| 2026-08-05 (Wed) | Pricing | **Free-shipping threshold change**: standard US orders now ship free from a $50 subtotal (it was $75). The $7.95 fee below the threshold, Pine Plus, and international shipping did not change. |
| 2026-08-10 (Mon) to 2026-08-30 (Sun) | Operations | **Delayed linen shipment.** A container of linen bedding from our supplier was held at the port of entry for inspection. It cleared and was received on August 31. Daily stock by category is in `inventory_daily`. |
| 2026-08-31 (Mon) | Holiday | UK summer bank holiday. No promotion. |
| 2026-09-01 (Tue) | Pricing | **Canada duties-included pilot.** Canadian shoppers now see duties-included prices from the product page on; the UK is unchanged. |
| 2026-09-04 (Fri) to 2026-09-07 (Mon) | Promotion | **Labor Day sale**: 25% off sitewide. The code `LABORDAY25` was applied automatically to every order placed during the sale. The homepage featured the sale, and the email list got two announcements (email sends are not tracked in Mixpanel). |
| 2026-09-07 (Mon) | Holiday | US Labor Day (inside the sale). |
| 2026-09-30 (Wed) | Fiscal | End of Q3. |
| 2026-10-01 (Thu) | — | End of the analysis window (data runs through 23:59 UTC). |

## Things that did not change in the window

- No change to product prices outside the Labor Day sale.
- No change to the Pine Plus price or perks, or to international shipping fees.
- Paid media budgets were steady through the period; no channel was added or paused.
- No change to the return policy (30 days from delivery).
- The carrier mix rules did not change; the fulfillment system kept assigning US parcels across the three contracted carriers.

## Open questions leadership has asked

- Should we ship the one-page checkout to everyone?
- Is international checkout healthy? Did the Canada pilot work, and what would it mean for the UK?
- Did lowering the free-shipping threshold pay off?
- Which paid channel gives us the cheapest new buyers?
- Did the Northline disruption affect customers beyond late parcels?
- Is Room Visualizer worth investing in further?
- How did the linen shipment delay show up in bedding?
- What makes a new customer stick?
