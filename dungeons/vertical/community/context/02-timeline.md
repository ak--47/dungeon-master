# Hearthside timeline: June 4 to October 1, 2026

All dates are UTC. This page lists what happened and when. It does not record outcomes; measure those in the data.

| Date | Type | What happened |
|---|---|---|
| 2026-06-04 (Thu) | — | Start of the analysis window. |
| 2026-07-03 (Fri) to 2026-07-04 (Sat) | Holiday | US Independence Day (observed Friday). No product or marketing changes. Hearthside traffic does not usually move on US holidays; the community is international and busiest on weekends anyway. |
| 2026-07-08 (Wed) | Experiment | **"Reply Nudges" thread test** starts. Every member who opens a discussion thread from this date is assigned 50/50 to **Control** (the thread page as before) or **Nudges On** (a reply prompt under the thread). Assignment is sticky per member and recorded with one `$experiment_started` event (at the member's first thread view in the test) and the profile property `Experiment: Reply Nudges`. |
| 2026-07-13 (Mon) | Org | A new Head of Community joins and takes over the volunteer moderator program. |
| 2026-07-22 (Wed) | Launch | **Hearth Guard** rollout begins. Hearth Guard is an AI assistant for volunteer moderators: it reads each incoming report, pre-sorts the queue, and suggests an action. It can also remove posts automatically (counted in `trust_safety_daily.automod_removals`). It is switched on community by community; every community has it by 2026-07-31. Moderators still resolve each report themselves. |
| 2026-08-06 (Thu) | Industry | **Starfall** releases. Starfall is a large open-world video game. Hearthside ran no campaign for it. |
| 2026-08-19 (Wed) to 2026-08-21 (Fri) | Incident | **Spam raid.** A coordinated bot network targeted one hub with spam threads, comments, and uploads. Trust and safety raised a raid alert for that hub, banned the accounts in waves, and lifted the alert early on August 22. Bot accounts are filtered out of analytics, so the spam itself is not in Mixpanel. Daily trust and safety figures by hub, including the raid alert, are in `trust_safety_daily`. |
| 2026-09-02 (Wed) | Revenue | **Ad layout change.** Pages shown to free members and logged-out readers get more ad slots per page. Plus members are not affected (they see no ads). The Plus price did not change. |
| 2026-09-07 (Mon) | Holiday | US Labor Day. No product or marketing changes. |
| 2026-09-17 (Thu) to 2026-09-20 (Sun) | Community event | **Hearthside Fandom Fest.** A four-day, platform-wide event with themed discussion threads in every hub and a fan-art contest, announced with an in-app banner. |
| 2026-10-01 (Thu) | — | End of the analysis window (data runs through 23:59 UTC). |

## Things that did not change in the window

- No change to the Plus price, plans, or the Plus page.
- No change to the onboarding flow (create account → pick interests → post an intro).
- No change to notification settings or email digests.
- Paid channel budgets and bids were steady through the period.
- No change to who can moderate or to the community rules.

## Open questions leadership has asked

- Is the Reply Nudges test working, and should it ship to everyone?
- Is Hearth Guard actually making report handling faster?
- What did the August spam raid cost us?
- What did the September ad change do to revenue, to reading, and to Plus?
- Which acquisition channel gives us real members for the money?
- Why do so many newcomers go quiet, and what can the community team do about it?
- Did Fandom Fest work?
