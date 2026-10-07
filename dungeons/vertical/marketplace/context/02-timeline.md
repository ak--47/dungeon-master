# Tradepost timeline: June 4 to October 1, 2026

All dates are UTC. This page lists what happened and when. It does not record outcomes; measure those in the data.

| Date | Type | What happened |
|---|---|---|
| 2026-06-04 (Thu) | — | Start of the analysis window. |
| 2026-06-22 (Mon) | Org | A new Head of Payments joins from a large retailer and takes over the checkout roadmap. |
| 2026-07-01 (Wed) | Fiscal | Q3 starts. |
| 2026-07-03 (Fri) to 2026-07-04 (Sat) | Holiday | US Independence Day (observed Friday). No product or marketing changes. |
| 2026-07-15 (Wed) | Pricing | **Casual seller fee change.** The selling fee for casual sellers rises from 10% to 12.9% of the item price on every sale from this date. Tradepost Pro fees (9.5%) and the Pro subscription do not change. The fee schedule by seller type is in `marketplace_ledger_daily.take_rate`. |
| 2026-07-22 (Wed) | Experiment | **"Express Checkout" test** starts. Members who start a checkout from this date are assigned 50/50 to **Control** (the existing three-screen checkout) or **Express Checkout** (saved address and payment on one screen with a single confirm tap). Assignment is sticky per member and recorded with a `$experiment_started` event just before each checkout and the profile property `Experiment: Express Checkout`. Offers that are accepted go through the same checkout, so they are in the test too. |
| 2026-08-10 (Mon) to 2026-09-07 (Mon) | Campaign | **Back to Campus.** The home feed shows a Back to Campus collection of laptops, tablets, headphones, and other electronics for students. Visits that open it are recorded as `home feed viewed` with `feed_section` = `back_to_campus`. No discount or fee change came with it. The collection came down at the end of Labor Day. |
| 2026-08-26 (Wed) | Launch | **Tradepost Guarantee.** Every order is now covered: if an item never arrives or is not as described, the buyer gets a full refund through a dispute. The Guarantee is shown on every listing and at checkout. Dispute handling rules did not change. |
| 2026-09-07 (Mon) | Holiday | US Labor Day. Last day of the Back to Campus collection. |
| 2026-09-14 (Mon) to 2026-09-18 (Fri) | Incident | **Card payment incident.** Tradepost's card processor had degraded authorizations after a change on their side: many card payments were declined or timed out at checkout. Apple Pay, Google Pay, and PayPal kept working. The processor's fix was live at 00:00 UTC on September 19. Daily authorizations, approval rate, latency, and status by payment method are in `payment_processing_daily`. |
| 2026-09-30 (Wed) | Fiscal | End of Q3. |
| 2026-10-01 (Thu) | — | End of the analysis window (data runs through 23:59 UTC). Q4 starts. |

## Things that did not change in the window

- No change to buyer shipping fees, the free-shipping threshold, or the carriers Tradepost works with.
- No change to how search and the home feed rank listings, apart from the Back to Campus collection.
- No change to the offer flow or the 48-hour offer expiry.
- Paid channel budgets were steady through the window; no channel was added or paused.
- Tradepost ran no holiday promotions. In past years, holidays have not changed marketplace activity in a way the team could see.
- The Android and iOS apps had no incidents in the window.

## Open questions leadership has asked

- How did sellers react to the July fee change, and did it pay off in fee revenue?
- Is Express Checkout working, and should it ship to everyone?
- Did the Tradepost Guarantee change how buyers behave at checkout? Is it costing us in disputes?
- What happened to purchases in mid-September, and what did it cost?
- Which paid channel brings buyers most cheaply? Is TikTok worth it?
- What makes a listing sell, and how long does it take?
- What do slow deliveries cost us?
