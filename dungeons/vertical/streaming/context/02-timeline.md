# Reelhouse timeline: June 4 to October 1, 2026

All dates are UTC. This page lists what happened and when. It does not record outcomes; measure those in the data.

| Date | Type | What happened |
|---|---|---|
| 2026-06-04 (Thu) | — | Start of the analysis window. |
| 2026-06-22 (Mon) | Org | A new Director of Growth joins and takes over paid marketing and the onboarding roadmap. |
| 2026-07-01 (Wed) | Holiday / fiscal | Canada Day. Q3 starts. |
| 2026-07-03 (Fri) to 2026-07-04 (Sat) | Holiday | US Independence Day (observed Friday). |
| 2026-07-08 (Wed) | Experiment | **"Smart Start" test** starts. Every new household that creates its account and starts a free trial from this date is assigned 50/50 to **Control** (the existing first-run experience: straight to the home screen) or **Smart Start** (a short taste picker right after the trial starts, then personalized first rows on the home screen). Assignment is sticky per household and recorded with a `$experiment_started` event a few seconds after `trial started`, and with the profile property `Experiment: Smart Start`. Households that signed up before July 8 are not in the test. |
| 2026-07-17 (Fri) | Launch | **Saltmarsh season 2** premieres: all 8 episodes are available at 00:00 UTC. Season 2 plays carry `title_name` = `Saltmarsh` and `season_number` = 2. Season 2 leads the home screen for the rest of July. |
| 2026-07-17 (Fri), about 16:00 | Campaign | A one-off **new_season push** announcing Saltmarsh season 2 goes to every subscribed household with the Reelhouse app on a phone or tablet (`notification received` with `campaign_type` = `new_season`). |
| 2026-07-28 (Tue) | Pricing | The Standard price change is announced on the Reelhouse blog and on the plans page. |
| 2026-08-03 (Mon) | Holiday | Civic Holiday in most of Canada. |
| 2026-08-11 (Tue) | Pricing | **Standard price change** for new subscriptions: $11.99 → $13.99 a month. The plans page shows the new price from this date. The price is set at the first charge, so households already in a trial on August 11 that kept Standard paid the new price when their trial ended. Existing paying subscribers keep $11.99. Basic with Ads ($6.99) and Premium ($17.99) do not change. |
| 2026-08-20 (Thu) to 2026-08-22 (Sat) | Incident | **TV streaming incident.** A fault at one of Reelhouse's CDN edges affected streams to the TV apps. Some TV plays failed to start or stopped with an error (`playback error`). Traffic was moved to a backup CDN, and the fix was live at 00:00 UTC on August 23. Phones, tablets, and the web were not affected. Daily streaming quality by platform is in `playback_qos_daily`. |
| 2026-09-07 (Mon) | Holiday | Labor Day (US) and Labour Day (Canada). |
| 2026-09-30 (Wed) | Fiscal | End of Q3. |
| 2026-10-01 (Thu) | — | End of the analysis window (data runs through 23:59 UTC). Q4 starts. |

## Things that did not change in the window

- No change to the 7-day free trial, to the signup flow outside the Smart Start test, or to how renewals and cancellations work.
- No change to Basic with Ads or Premium prices, and no change to what any plan includes.
- No licensed title was added or removed. Saltmarsh season 2 is the only new release in the window.
- Paid channel budgets were steady through the window; no channel was added or paused. There was no paid campaign for the Saltmarsh premiere beyond the push and the home screen.
- The regular push programme (new_episode, because_you_watched, trending_now, win_back) ran at its normal cadence all window. The new_season push on July 17 is the only one-off push.
- Reelhouse ran no holiday promotions. In past years, holidays have not changed viewing in a way the team could see.
- Apart from August 20-22, the CDN and the apps had no incidents in the window.

## Open questions leadership has asked

- How big was Saltmarsh season 2, and did the households who signed up for it stay?
- Is the Smart Start test working, and should it ship to everyone?
- What makes a trial convert?
- Did the Standard price change raise revenue? What did it do to the plan mix?
- What did the August TV incident cost us?
- Which paid channel deserves more budget?
- Who cancels, and why?
- Which pushes are worth sending? How well does search work on TV?
