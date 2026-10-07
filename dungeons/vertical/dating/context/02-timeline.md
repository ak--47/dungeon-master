# Kindred timeline: June 4 to October 1, 2026

All dates are UTC. This page lists what happened and when. It does not record outcomes; measure those in the data.

| Date | Type | What happened |
|---|---|---|
| 2026-06-04 (Thu) | — | Start of the analysis window. |
| 2026-06-15 (Mon) | Org | A new Head of Trust & Safety joins and takes over the Verified Profiles project. |
| 2026-07-01 (Wed) | Fiscal | Q3 starts. |
| 2026-07-03 (Fri) to 2026-07-04 (Sat) | Holiday | US Independence Day (observed Friday). No product or marketing changes. |
| 2026-07-14 (Tue) | Launch | **Verified Profiles** launches on iOS and Android. A member records a short video selfie; when it matches their photos, the profile gets a Verified badge. Existing members are prompted in the app; new members are offered it during setup. Each verification sends a `selfie verified` event, and the profile property `verified` shows the current status. Verification is optional. |
| 2026-07-22 (Wed) | Experiment | **"Icebreakers" test** starts. Members who get a match from this date are assigned 50/50 to **Control** (an empty chat) or **Icebreakers** (the new-match chat suggests a few openers based on the other member's prompts). Assignment is sticky per member and recorded with one `$experiment_started` event at the member's first match in the test and the profile property `Experiment: Icebreakers`. Openers sent from a suggestion carry `opener_type = icebreaker`. |
| 2026-08-18 (Tue) | Pricing | **Kindred+ price change** for new subscriptions: 1 month $29.99 → $34.99, 3 months $74.99 → $86.99, 6 months $119.99 → $139.99. Premier prices do not change. Existing subscribers keep their price until renewal. |
| 2026-08-24 (Mon) to 2026-08-30 (Sun) | Incident | **Chat incident.** A chat release caused some message sends to fail; a failed message was never delivered. The release was rolled back and the fix was live at 00:00 UTC on August 31. Daily delivery health is in `chat_delivery_daily`. |
| 2026-08-31 (Mon) | Holiday | UK summer bank holiday (London). |
| 2026-09-07 (Mon) | Holiday | US Labor Day. |
| 2026-09-30 (Wed) | Fiscal | End of Q3. |
| 2026-10-01 (Thu) | — | End of the analysis window (data runs through 23:59 UTC). Q4 starts. |

## Things that did not change in the window

- No change to the onboarding flow, the Free plan, Premier prices, or Spark allowances.
- No change to how Discover ranks profiles or how matches are made.
- Paid channel budgets were steady through the window; no channel was added or paused.
- Kindred ran no holiday campaigns. In past years, holidays have not changed member activity in a way the team could see.

## Open questions leadership has asked

- Is Verified Profiles making Kindred safer? How many members have verified?
- Is the Icebreakers test working, and should it ship to everyone?
- Did the Kindred+ price change hurt sales, and did it pay off?
- Which paid channel deserves more budget?
- Why do so many new signups never finish a profile?
- What happened to messaging in late August, and how big was it?
- What happens to members after a good date?
