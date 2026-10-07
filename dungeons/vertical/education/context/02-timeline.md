# Brightpath Academy timeline: June 4 to October 1, 2026

All dates are UTC. This page lists what happened and when. It does not record outcomes; measure those in the data.

| Date | Type | What happened |
|---|---|---|
| 2026-06-04 (Thu) | — | Start of the analysis window. |
| 2026-06-30 (Tue) | Fiscal | End of Q2. |
| 2026-07-03 (Fri) to 2026-07-04 (Sat) | Holiday | US Independence Day (observed Friday). Brightpath runs no holiday promotions and does not change the product for holidays. |
| 2026-07-08 (Wed) | Experiment | **"Personalized Course Picks" test** starts on the course page. Every learner who views a course page from this date is assigned 50/50 to **Control** (the standard "related courses" module) or **Personalized** (picks based on the learner's goal and history). Assignment is sticky per learner and recorded once, at the learner's first course page view in the test, with a `$experiment_started` event and the profile property `Experiment: Personalized Course Picks`. |
| 2026-07-21 (Tue) | Launch | **Ask Bright**, the AI tutor, launches for Plus and Teams learners. Learners turn it on from a lesson or quiz page. Free learners see it as an upgrade prompt (`paywall_trigger = ai_tutor`). |
| 2026-08-10 (Mon) | Pricing | **Plus monthly price change**: $29 → $35 per month for new subscribers. The annual plan stays $239 per year. Existing monthly subscribers keep their price until renewal. |
| 2026-08-24 (Mon) | Academic calendar | The **fall term** begins at most partner universities in the university partnership program (most start the week of August 24; dates vary by school). |
| 2026-09-07 (Mon) | Holiday | US Labor Day. No product or marketing change. |
| 2026-09-09 (Wed) to 2026-09-12 (Sat) | Incident | **Video playback incident.** After a mobile app update, support received reports of videos that stopped or failed to load in one of the apps. Engineering shipped a hotfix on September 13. No data was lost. Daily playback health and app versions by platform are in `app_stability_daily`. |
| 2026-09-30 (Wed) | Fiscal | End of Q3. |
| 2026-10-01 (Thu) | — | End of the analysis window (data runs through 23:59 UTC). Q4 starts. |

## Things that did not change in the window

- No new courses went live and no course changed format. The catalog is the same 68 courses for the whole window.
- No change to the Free plan, the annual Plus price, or Teams contracts.
- No change to the onboarding flow.
- Paid channel budgets and bids were steady through the quarter.
- No change to reminder emails or push notifications.

## Open questions leadership has asked

- Is Ask Bright helping learners? Who uses it, and is use still growing?
- Did Personalized Course Picks work, and should it ship to everyone?
- Did the August price change pay off?
- Why do so many new learners never start a lesson? How long does it take new learners to get started?
- Should we build more cohort courses?
- What should a new learner do in their first week?
- Is paid social worth its cost compared with search?
- What did the September app incident cost us?
