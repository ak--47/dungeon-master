# Shieldstone timeline: June 4 to October 1, 2026

All dates are UTC. This page lists what happened and when. It does not record outcomes; measure those in the data.

| Date | Type | What happened |
|---|---|---|
| 2026-06-01 | Season | Atlantic hurricane season starts (runs to November 30). |
| 2026-06-04 (Thu) | — | Start of the analysis window. |
| 2026-06-22 (Mon) | Org | A new Head of Growth Marketing joins and takes over paid acquisition budgets. |
| 2026-07-01 (Wed) | Fiscal | Q3 starts. |
| 2026-07-03 (Fri) to 2026-07-04 (Sat) | Holiday | US Independence Day (observed Friday). No product, pricing, or marketing changes. |
| 2026-07-08 (Wed) | Experiment | **"Express Quote" test** starts. Every new shopper who starts a quote from this date is assigned 50/50 to **Control** (the standard quote form) or **Express Quote** (the form pre-fills vehicle and property details from public records, so the shopper confirms instead of typing). Assignment is sticky per shopper and recorded with a `$experiment_started` event just before the quote starts; quote events carry `quote_flow = standard` or `express`. Shoppers who create an account also get the profile property `Experiment: Express Quote`. |
| 2026-07-21 (Tue) | Launch | **Snap & Settle** launches for auto claims. A customer with a collision, glass, or comprehensive claim can upload photos of the damage and receive an estimate generated from the photos instead of scheduling an adjuster inspection. It is optional; the customer chooses at the start of the claim. Theft and liability claims, and all homeowners and renters claims, still go to an adjuster. Claims that use it carry `claim_channel = photo_estimate`. |
| 2026-08-17 (Mon) | Pricing | **New auto rate plan** takes effect for new auto business in all twelve states, after regulatory approval. The approved plan is a double-digit average increase on new auto quotes. Homeowners and renters prices do not change. Existing auto customers move to the new rates at their first renewal after November 1, 2026, so renewals in this window are priced on the old plan. Written premium and the rate level index are in `written_premium_daily`. |
| 2026-08-25 (Tue) | Weather | National Hurricane Center issues a hurricane watch for the Florida Panhandle and southeast Louisiana. Claims prepares a catastrophe response plan. |
| 2026-08-27 (Thu) | Catastrophe | **Hurricane Delphine** makes landfall near the Florida Panhandle in the early hours UTC and moves west over southeast Louisiana with heavy rain. The industry catastrophe code **PCS-2614** is assigned. Claims opens a catastrophe reporting period for the `gulf_coast` region (Florida, Louisiana) from August 27 to September 9; claims reported in that period are coded to the catastrophe in `claims_operations_daily.catastrophe_code`. |
| 2026-08-29 (Sat) | Operations | Independent catastrophe adjusters begin arriving in the Gulf region; the deployment ramps up over four days and stays for five weeks. Daily adjuster hours by region are in `claims_operations_daily`. |
| 2026-09-07 (Mon) | Holiday | US Labor Day. |
| 2026-09-08 (Tue) | Campaign | Fall **"Switch & Save"** campaign starts on social ads (Instagram, Facebook, TikTok), aimed at drivers whose policy renews in the fall. The social planned budget increases substantially from this date; the campaign runs through October 31. Other channels' budgets do not change. Daily spend is in `marketing_spend_daily`. |
| 2026-09-30 (Wed) | Fiscal | End of Q3. |
| 2026-10-01 (Thu) | — | End of the analysis window (data runs through 23:59 UTC). Q4 starts. |

## Things that did not change in the window

- No change to homeowners or renters pricing, to coverage tiers, or to how renewal prices are calculated.
- No change to the comparison-site partners or their price per lead, to paid search budgets, or to referral rewards.
- No change to billing rules: autopay retries, grace periods, and nonpayment rules were the same all period.
- No change to the account signup step or the purchase flow after a quote.
- Shoppers in the Express Quote test saw the same prices as Control; only the quote form changed.
- Holidays: Shieldstone ran no holiday promotions, and the team has not seen holidays change customer activity beyond the normal weekly rhythm.

## Open questions leadership has asked

- Should we ship Express Quote to everyone?
- Is Snap & Settle making auto claims faster? How many customers use it?
- How did the claims team hold up after Hurricane Delphine, and what did it do to cycle times and backlog in the Gulf?
- Which paid channel is worth its cost?
- Did the August auto rate increase cost us too many sales? Did it pay off in premium?
- What drives customers to leave at renewal? Do bundles change renewal behavior?
- Did the fall social campaign bring new shoppers, and at what cost?
- Should billing push autopay harder?
