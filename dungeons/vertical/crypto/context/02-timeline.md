# Ledgerline timeline: June 4 to October 1, 2026

All dates are UTC. This page lists what happened and when. It does not record outcomes; measure those in the data.

## Company and product calendar

| Date | Type | What happened |
|---|---|---|
| 2026-06-04 (Thu) | — | Start of the analysis window. |
| 2026-06-30 (Tue) | Fiscal | End of Q2. |
| 2026-07-03 (Fri) to 2026-07-04 (Sat) | Holiday | US Independence Day. Crypto markets trade every day; Ledgerline made no product or marketing changes. |
| 2026-07-06 (Mon) | Org | A new Head of Growth joins and takes over onboarding and lifecycle messaging. |
| 2026-07-08 (Wed) | Experiment | **"One-Tap Buy" Simple Buy test** starts. Every customer who starts a Simple Buy from this date is assigned 50/50 to **Control** (the current flow with a review screen) or **One-Tap** (a shorter flow that confirms the order in one step). Assignment is sticky per customer and recorded with a `$experiment_started` event (sent once, at the customer's first Simple Buy in the test) and the profile property `Experiment: One-Tap Buy`. |
| 2026-07-20 (Mon) to 2026-07-22 (Wed) | Incident | **Ethereum network congestion.** A popular token launch on Ethereum pushed network fees to multi-month highs for three days. Ledgerline's status page reported "degraded: some crypto withdrawals" for those days and cleared it early on July 23. Daily network conditions are in `chain_network_daily`. |
| 2026-07-28 (Tue) | Launch | **New identity verification vendor.** Every customer who signs up from this date verifies through the new vendor (document photo plus selfie, as before). Customers who signed up earlier finish on the old vendor. The onboarding steps and screens are otherwise the same. |
| 2026-08-05 (Wed) | Listing | **ONDO** listed on Advanced Trade. It is not available in Simple Buy, recurring buys, staking, or withdrawals. |
| 2026-08-19 (Wed) | Pricing | **Staking commission change:** Ledgerline's commission on staking rewards rises from 15% to 25% for every staking asset, effective immediately for new stakes and announced in the app the same day. The APY shown on new stakes is net of the commission. |
| 2026-08-26 (Wed) | Release | **Android app 5.12** released (new home screen design and performance work). |
| 2026-08-29 (Sat) | Release | **Android app 5.12.1** hotfix released ("stability fixes"). |
| 2026-09-07 (Mon) | Holiday | US Labor Day. No product or marketing changes. |
| 2026-09-30 (Wed) | Fiscal | End of Q3. |
| 2026-10-01 (Thu) | — | End of the analysis window (data runs through 23:59 UTC). Q4 starts. |

## Market-moving days

Crypto prices move every day. These were the days the market team flagged in its weekly notes. Daily prices, returns, and realized volatility for every asset are in `market_prices_daily`.

| Date | What happened in the market |
|---|---|
| 2026-06-18 (Thu) | Hot US inflation print; BTC falls about 5%. |
| 2026-07-13 (Mon) to 07-14 (Tue) | Large spot ETF inflows; BTC rises about 8%, then another 3%. |
| 2026-08-10 (Mon) to 08-12 (Wed) | Three volatile sessions around a central bank meeting: BTC up about 7%, down about 5%, up about 3%. |
| 2026-09-09 (Wed) to 09-11 (Fri) | **Market drawdown:** a large exchange outside Ledgerline halts withdrawals; BTC falls about 12% on September 9 and about 4% on September 10, then rebounds about 3% on September 11. Altcoins fall further. |
| 2026-09-24 (Thu) | Relief rally after a favorable court ruling; BTC rises about 6%. |

## Things that did not change in the window

- Simple Buy, Advanced Trade, and recurring-buy fees.
- The list of deposit methods, withdrawal assets, and withdrawal networks.
- The onboarding steps (only the verification vendor changed).
- Paid channel budgets followed the standing rule (each channel's daily budget is re-set from its sign-ups over the previous week); no new channels were added.
- No outage of Ledgerline's own systems was declared in the window.

## Open questions leadership has asked

- How much of our trading activity is driven by the market rather than by us?
- What did the July Ethereum problems cost our customers?
- Did the new verification vendor help?
- Which early actions should onboarding messages push?
- Should One-Tap Buy ship to everyone?
- Are influencer and affiliate partnerships worth it?
- How did customers react to the September drawdown?
- Did the commission change hurt staking?
- How is ONDO doing?
