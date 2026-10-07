# Penny Harbor timeline: June 4 to October 1, 2026

All dates are UTC. This page lists what happened and when. It does not record outcomes; measure those in the data.

| Date | Type | What happened |
|---|---|---|
| 2026-06-04 (Thu) | — | Start of the analysis window. |
| 2026-06-19 (Fri) | Bank holiday | Juneteenth. Federal Reserve holiday: ACH does not settle, so payroll deposits and Bill Pay payments that would post that day post on another business day. Card networks operate as normal. |
| 2026-06-30 (Tue) | Fiscal | End of Q2. |
| 2026-07-03 (Fri) | Bank holiday | Independence Day (observed). Federal Reserve holiday, same ACH rules as above. |
| 2026-07-06 (Mon) | Org | A new Head of Growth joins and takes over paid acquisition and the direct deposit program. |
| 2026-07-14 (Tue) | Launch | **Round-Ups** launches for all members. A member turns it on in the app (with a 1x, 2x, or 3x multiplier); each morning Penny Harbor sweeps the previous day's spare change from approved card purchases into a Round-Ups Pocket. Announced in-app; members who join later can turn it on at any time. |
| 2026-07-21 (Tue) | Experiment | **"Autopay Default" test** starts. Members who add a biller from this date are assigned 50/50 to **Control** (AutoPay off by default on the add-biller screen) or **Autopay On** (AutoPay pre-selected; the member can switch it off). Assignment is sticky per member and recorded with a `$experiment_started` event the first time the member adds a biller, and with the profile property `Experiment: Autopay Default`. |
| 2026-08-03 (Mon) | Promotion | **Summer Saver Boost** starts: a limited-time higher APY on Pockets for members on Plus or Premium, announced in-app and by email. It runs through September 30. Free Pockets keep their usual rate. Daily rates by plan are in `pocket_savings_daily`. |
| 2026-08-20 (Thu) to 2026-08-21 (Fri) | Incident | **Card processor incident.** Penny Harbor's card processor reported a major outage of one of its authorization services for two days; it was resolved by the morning of August 22. No member action was needed. Daily processor health by payment channel is in `card_authorizations_daily`. |
| 2026-09-07 (Mon) | Bank holiday | Labor Day. Federal Reserve holiday, same ACH rules as above. |
| 2026-09-30 (Wed) | Promotion / Fiscal | Last day of the Summer Saver Boost. End of Q3. |
| 2026-10-01 (Thu) | — | End of the analysis window (data runs through 23:59 UTC). Q4 starts. |

## Things that did not change in the window

- Plan prices, Float limits, and Free Pocket rates.
- The onboarding flow and the identity verification vendor.
- Bill Pay, except the AutoPay default inside the test.
- The paid channel mix and the bidding setup.
- The card processor, apart from the August incident.

## Banking calendar notes

- ACH (payroll direct deposit, Float repayments from paychecks, AutoPay bill payments) settles on business days only: not on weekends or Federal Reserve holidays.
- Card purchases and ATM withdrawals authorize every day of the year.

## Open questions leadership has asked

- What makes a new member stick around in the first month?
- Which paid channels are worth their cost?
- How is Round-Ups doing? Did it take money away from the savings members already did by hand?
- Did the Summer Saver Boost bring in deposits, and what did it cost in interest?
- Should AutoPay be the default for everyone?
- How often do members pay bills late?
- What happened on August 20-21, and how many members did it touch?
- Why do so many applicants never fund their account?
- Is Premium support faster?
