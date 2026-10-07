# The Lantern timeline: June 4 to October 1, 2026

All dates are UTC. This page lists what happened and when. It does not record outcomes; measure those in the data.

| Date | Type | What happened |
|---|---|---|
| 2026-06-04 (Thu) | — | Start of the analysis window. |
| 2026-06-11 (Thu) to 2026-07-19 (Sun) | World event | **FIFA World Cup 2026**, hosted by the United States, Canada, and Mexico. Group stage June 11-27, round of 32 June 28 - July 3, round of 16 July 4-7, quarterfinals July 9-11, semifinals July 14-15, third-place match July 18, final July 19. The sports desk, with freelance help, covered every match day on the site and in the apps. Preview coverage started June 8 and wrap-ups ran until July 22. |
| 2026-06-15 (Mon) | Org | A new Head of Audience joins from a national newspaper and takes over newsletters, marketing, and the paywall. |
| 2026-07-01 (Wed) | Fiscal | Q3 starts. |
| 2026-07-03 (Fri) to 2026-07-04 (Sat) | Holiday | US Independence Day (observed Friday). The newsroom published on its normal schedule. |
| 2026-07-15 (Wed) | Experiment | **"For You Feed" test** starts in the iOS and Android apps. Signed-in app readers are assigned 50/50 to **Control** (the home screen's module shows Top Stories, picked by editors) or **For You** (the same module shows a personalized feed based on the reader's history). Assignment is sticky per reader and recorded with a `$experiment_started` event at the reader's first app visit after the start and the profile property `Experiment: For You Feed`. The website is not part of the test. |
| 2026-08-11 (Tue) | Launch | **Gift Articles** launches for subscribers on web and apps, rolled out over one week (all subscribers by August 18). A subscriber shares a gift link; anyone who opens it can read that article free. Gift shares are tracked as `article shared` with `share_method = gift_link`. |
| 2026-08-25 (Tue) to 2026-08-27 (Thu) | Incident | **Web metering incident.** A faulty deploy to the website's metering service made many meter checks fail open: free readers on the website were often shown articles they should have hit the paywall for. Engineering rolled back the deploy; the fix was live at 00:00 UTC on August 28. The iOS and Android apps were not affected. Daily meter error rates and service status by platform are in `platform_reliability_daily`. |
| 2026-09-03 (Thu) to 2026-09-09 (Wed) | Promotion | **Labor Day sale.** 60% off the first billing period of either plan, monthly or annual (Digital $4.80 for the first month or $48 for the first year; All Access $8 or $80). Shown on the paywall only. New subscriptions in the sale carry `offer = labor_day_sale`. Renewals are at list price. |
| 2026-09-07 (Mon) | Holiday | US Labor Day. The newsroom published on its normal schedule. |
| 2026-09-30 (Wed) | Fiscal | End of Q3. |
| 2026-10-01 (Thu) | — | End of the analysis window (data runs through 23:59 UTC). Q4 starts. |

## Things that did not change in the window

- List prices of both plans, the meter (one free article for anonymous visitors, 5 articles in any rolling 30 days for free accounts), and the registration wall.
- The newsletter lineup and send schedule, the podcast lineup, and the push alert policy.
- Paid marketing: budgets for Google, Meta, and podcast ads were steady through the window; no channel was added or paused. There was no paid promotion of the Labor Day sale.
- The website's and apps' design outside the For You test.
- Holidays: The Lantern ran no holiday promotions other than the Labor Day sale.
- The apps had no incidents in the window.

## Open questions leadership has asked

- What did the World Cup coverage do for readership, and was it only sports?
- Should the For You feed ship to every app reader? Does it change subscriptions?
- Are subscribers using Gift Articles?
- What happened to the paywall in late August, and what did it cost?
- Which paid channel deserves more budget?
- Which readers are most likely to subscribe, and which subscribers are most likely to cancel?
- Did the Labor Day sale pay off?
