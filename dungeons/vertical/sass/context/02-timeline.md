# Tallyboard timeline: June 4 to October 1, 2026

All dates are UTC. This page lists what happened and when. It does not record outcomes; measure those in the data.

| Date | Type | What happened |
|---|---|---|
| 2026-06-04 (Thu) | — | Start of the analysis window. |
| 2026-06-30 (Tue) | Fiscal | End of Q2. |
| 2026-07-03 (Fri) to 2026-07-04 (Sat) | Holiday | US Independence Day (observed Friday). No product or marketing changes. |
| 2026-07-06 (Mon) | Org | A new VP of Marketing joins and takes over paid acquisition. |
| 2026-07-15 (Wed) | Experiment | **"Smart Test Selection" pipeline test** starts. Every user who runs a pipeline from this date is assigned 50/50 to **Control** (runs the full test suite) or **Smart Selection** (runs only the tests affected by the change). Assignment is sticky per user and recorded with a `$experiment_started` event and the profile property `Experiment: Smart Test Selection`. |
| 2026-07-22 (Wed) | Launch | **Root Cause Assist** launches for all Business and Enterprise customers. Resolutions that use it carry `resolution_method = ai_assist`. Free and Team users see it in the product as an upgrade prompt only. |
| 2026-08-04 (Tue) | Compliance | SOC 2 Type II report published. No product change. |
| 2026-08-17 (Mon) | Pricing | **Team plan price change**: $20 → $25 per seat per month for new Team subscriptions. Business stays $45 per seat. Existing Team subscribers keep their price until renewal. |
| 2026-08-25 (Tue) to 2026-08-27 (Thu) | Incident | **Hosted CI runner incident.** A capacity problem in one hosted runner region caused pipeline jobs to fail or queue. The status page reported a major outage for that region for three days; it was resolved early on August 28. No customer action was needed. Daily runner health by region is in `ci_runner_health_daily`. |
| 2026-09-07 (Mon) | Holiday | US Labor Day. |
| 2026-09-16 (Wed) to 2026-09-30 (Wed) | Promotion | **Q3 quarter-close seat promotion**: 20% off added seats for existing customers, announced in-app and by account managers. |
| 2026-09-30 (Wed) | Fiscal | End of Q3. |
| 2026-10-01 (Thu) | — | End of the analysis window (data runs through 23:59 UTC). Q4 starts. |

## Things that did not change in the window

- No change to the Free plan, the Business price, or Enterprise contracts.
- No change to the onboarding flow or to the supported clouds.
- No change to alert thresholds or alert routing defaults.
- Paid channel budgets and bids were steady through the quarter.
- The hosted runner fleet kept the same regions and capacity outside the August incident.

## Open questions leadership has asked

- Does Root Cause Assist shorten incidents? Is it being used?
- Did the Team price change hurt Team sales, and did it pay off?
- Is LinkedIn worth its cost compared with search?
- Why do some new signups never finish setup?
- Is the Smart Test Selection test working, and should it ship to everyone?
- What did the August runner incident cost our customers?
- Are we paging people too much?
