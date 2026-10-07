# Murmur timeline: June 4 to October 1, 2026

All dates are UTC. This page lists what happened and when. It does not record outcomes; measure those in the data.

| Date | Type | What happened |
|---|---|---|
| 2026-06-04 (Thu) | — | Start of the analysis window. |
| 2026-06-22 (Mon) | Org | Murmur hires its first creator partnerships lead, who takes over the paid creator referral program and the Circles roadmap. |
| 2026-07-01 (Wed) | Fiscal | Q3 starts. |
| 2026-07-04 (Sat) | Holiday | US Independence Day. No product or marketing changes. |
| 2026-07-08 (Wed) | Launch | **Clips** launches on iOS and Android: members can post short vertical videos (`post_type = clip`) and watch them in every feed. Ads between Clips (`ad_placement = clips`) start selling the same day. |
| 2026-08-05 (Wed) | Experiment | **"Smart Digest" test** starts. Members who receive a push notification from this date are assigned 50/50 to **Control** (notifications as before) or **Digest** (some notifications are held back and combined into a once-a-day summary push, `notification_type = daily_digest`). Assignment is sticky per member. It is recorded with one `$experiment_started` event when the notification system first assigns the member (at the first push they qualify for after the start; in the Digest arm that push can be one of the held-back notifications) and with the profile property `Experiment: Smart Digest`. The test was still running on October 1. |
| 2026-08-12 (Wed) | Pricing | **Creator Fair Share.** Murmur's platform fee on Circle subscriptions falls from 20% to 10% of each payment, for all creators and all tiers. Fan prices do not change. |
| 2026-08-26 (Wed) to 2026-08-29 (Sat) | Incident | **Android For You incident.** An Android app release shipped a bug in how the app requested the For You feed; some For You feed loads failed and showed an error card instead of posts. The iOS app was not affected. A fixed release was live at 00:00 UTC on August 30. Daily feed service health by platform is in `for_you_feed_health_daily`. |
| 2026-09-07 (Mon) | Holiday | US Labor Day. |
| 2026-09-09 (Wed) | Ads | **Ad load change.** Murmur added more ad slots to the feed and to Clips. Ads between Stories did not change. |
| 2026-09-12 (Sat) | Event | **Murmur Sound Awards**, a live-streamed music awards show hosted on Murmur. |
| 2026-09-30 (Wed) | Fiscal | End of Q3. |
| 2026-10-01 (Thu) | — | End of the analysis window (data runs through 23:59 UTC). Q4 starts. |

## Things that did not change in the window

- No change to the onboarding flow (interests, then suggested accounts) or to signup methods.
- Paid channel budgets were steady through the window; no channel was added or paused.
- Circle tier prices for fans did not change.
- No change to the Stories ad load.
- Murmur ran no holiday campaigns. In past years, US holidays have not changed member activity in a way the team could see.
- The iOS app had no incidents in the window.

## Open questions leadership has asked

- How fast is Clips being adopted?
- Is there something in onboarding that predicts which new members stay?
- Should Smart Digest ship to everyone?
- Which paid channel deserves more budget?
- What did Creator Fair Share cost us, and did creators respond?
- What happened to the Android feed in late August, and how big was it?
- Did the ad load change pay off?
- What did the Sound Awards do for the app?
