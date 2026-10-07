# Driftway Travel timeline: June 4 to October 1, 2026

All dates are UTC. This page lists what happened and when. It does not record outcomes; measure those in the data.

| Date | Type | What happened |
|---|---|---|
| 2026-06-04 (Thu) | — | Start of the analysis window. |
| 2026-06-15 (Mon) | Org | A new Head of Payments joins and takes over the Flex Pay project. |
| 2026-06-24 (Wed) to 2026-06-28 (Sun) | Campaign | **Summer Kickoff Sale.** Every stay on Driftway shows 15% off the nightly rate, applied automatically; bookings made during the sale carry `promo_code = SUMMERKICKOFF`. Members on the marketing list got a launch email on June 24 (about 15:00 UTC) and a reminder on June 27; members who allow push also got a push with each email. The sends are `notification received` events with `campaign = summer_kickoff_sale`. |
| 2026-07-01 (Wed) | Fiscal | Q3 starts. |
| 2026-07-03 (Fri) to 2026-07-04 (Sat) | Holiday | US Independence Day (observed Friday). Driftway ran no holiday promotion. Holiday stays are booked weeks ahead, so app and website activity on the holiday itself usually looks like an ordinary weekend. |
| 2026-07-14 (Tue) | Launch | **Flex Pay** launches on iOS, Android, and the web: at payment, travelers can choose to pay in four installments with no interest. Bookings paid this way have `payment_method = flex_pay`. |
| 2026-07-20 (Mon) | Org | A new VP of Growth joins and takes over paid marketing. |
| 2026-08-18 (Tue) to 2026-08-21 (Fri) | Incident | **Website payment incident.** A faulty release at Driftway's card payment gateway made many card payments on the website time out; travelers saw an error at the payment step. The gateway status page showed the website as degraded from 00:00 on August 18 until the fix at 00:00 on August 22. App payments were not affected. Daily authorization health by platform is in `payment_gateway_daily`. |
| 2026-08-25 (Tue) | Experiment | **"All-in Pricing" test** starts. Members are assigned 50/50 to **Control** (search results and property pages show the nightly rate; taxes and fees appear at checkout) or **All-in Pricing** (the price shown everywhere includes taxes and fees). Assignment is sticky per member and recorded with one `$experiment_started` event the first time the member opens a property page after the start, and with the profile property `Experiment: All-in Pricing`. The test runs to the end of the window. |
| 2026-08-31 (Mon) | Holiday | UK summer bank holiday. |
| 2026-09-07 (Mon) | Holiday | US Labor Day. |
| 2026-09-07 (Mon) | Policy | As forecasts for **Hurricane Delia** firm up, Driftway waives cancellation fees for Caribbean stays checking in from September 9 to 13, including non-refundable rates. Cancellations for this reason carry `cancellation_reason = weather`. |
| 2026-09-09 (Wed) to 2026-09-13 (Sun) | Weather | **Hurricane Delia** passes through the Caribbean. Hurricane warnings cover Cancun, Punta Cana, Montego Bay, Nassau, San Juan, and Aruba. Many partner resorts close rooms. The daily advisory and rooms listed are in `destination_supply_daily` (`weather_advisory = hurricane_warning`). |
| 2026-09-30 (Wed) | Fiscal | End of Q3. |
| 2026-10-01 (Thu) | — | End of the analysis window (data runs through 23:59 UTC). Q4 starts. |

## Things that did not change in the window

- No change to commission rates, the free-cancellation and non-refundable rate rules (apart from the hurricane waiver), Rewards tiers, or taxes and fees.
- No change to how search results rank properties.
- No new destinations, regions, or property partners went live; the property catalog was stable.
- Paid channel budgets were steady through the window; no channel was added or paused.
- The weekly Thursday deals email went out every week as usual.
- The apps had no payment incidents in the window.

## Open questions leadership has asked

- Did Flex Pay help more checkouts turn into bookings?
- How many bookings did the August payment incident cost us?
- Which paid channel deserves more budget, including TikTok?
- Which bookings cancel, and how much does the non-refundable rate matter?
- Is the All-in Pricing test working, and should it ship to everyone?
- How hard did Hurricane Delia hit the Caribbean business?
- Did the Summer Kickoff Sale pay off, or did it just discount bookings we would have had anyway?
- What do guest reviews tell us about who keeps booking with us?
- Do new listings with few reviews get booked?
