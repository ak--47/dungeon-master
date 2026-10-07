# Stridewell timeline: June 4 to October 1, 2026

All dates are UTC. This page lists what happened and when. It does not record outcomes; measure those in the data.

| Date | Type | What happened |
|---|---|---|
| 2026-06-04 (Thu) | — | Start of the analysis window. |
| 2026-06-15 (Mon) | Campaign | **Summer Shred** starts: a 30-day summer fitness campaign. Marketing leaned on paid social (social and short-video placements) and ran it alongside the usual search and app-store ads. |
| 2026-07-01 (Wed) | Experiment | **"Guided First Week" onboarding test** starts. Every new member from this date is assigned 50/50 to **Control** (the existing onboarding) or **Guided Plan** (a structured day-by-day schedule for the first week). Assignment is sticky per member and recorded with a `$experiment_started` event and the profile property `Experiment: Guided First Week`. Members who joined before July 1 are not enrolled. |
| 2026-07-04 (Sat) | Holiday | US Independence Day. No product or marketing changes. Member activity is not affected. |
| 2026-07-14 (Tue) | Campaign | **Summer Shred** ends (last day). |
| 2026-07-20 (Mon) | Org | A new Head of Growth joins and takes over acquisition and lifecycle marketing. |
| 2026-08-12 (Wed) | Launch | **Stride Coach** launches for all Plus members (Monthly and Annual) and for members in a Plus trial. Free members see a teaser on the paywall. Workouts done with Stride Coach carry `coaching_mode = ai_coach`. |
| 2026-08-20 (Thu) to 2026-08-22 (Sat) | Incident | **Wearable sync incident.** Our third-party health-data partner had an API incident. Their status page reported degraded sync for some device integrations for about three days. It was resolved early on August 23. Engineering did not change the app. The partner's daily status per device type is in `wearable_sync_daily`. |
| 2026-09-01 (Tue) | Pricing | **Plus Monthly price change**: $12.99 → $14.99 per month for new purchases. Plus Annual stays $99.99. Existing subscribers keep their price until renewal. |
| 2026-09-07 (Mon) | Holiday | US Labor Day. No product or marketing changes. Member activity is not affected. |
| 2026-09-08 (Tue) to 2026-09-21 (Mon) | Program | **Fall Reset**: a 14-day back-to-routine program with in-app workout plans for all members. |
| 2026-10-01 (Thu) | — | End of the analysis window (data runs through 23:59 UTC). |

## Things that did not change in the window

- No change to the Free plan or to Plus Annual pricing.
- No change to trial length (7 days) or trial eligibility (one trial per new member).
- No app release changed onboarding outside the Guided First Week test.
- Team and solo challenges were available for the whole window.
- Notification sending rules were unchanged in the window. Frequency caps are under review for Q4.

## Open questions leadership has asked

- Did the Guided First Week test work, and should it ship to everyone?
- Was Summer Shred worth the money?
- Did the September price change hurt Plus sign-ups, and did it pay off in bookings?
- What did the August sync incident cost us, and was it only wearables?
- Are we sending too many notifications?
- Will Stride Coach take demand away from human coach sessions? The coaching lead plans contract coach hours for Q4.
