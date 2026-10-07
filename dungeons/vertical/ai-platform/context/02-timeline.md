# Cortexa timeline: June 4 to October 1, 2026

All dates are UTC. This page lists what happened and when. It does not record outcomes; measure those in the data.

| Date | Type | What happened |
|---|---|---|
| 2026-06-04 (Thu) | — | Start of the analysis window. |
| 2026-06-30 (Tue) | Fiscal | End of Q2. |
| 2026-07-01 (Wed) | Experiment | **"Interactive Quickstart" onboarding test** starts. Every account created from this date is assigned 50/50 at signup to **Control** (the quickstart docs page) or **Interactive Quickstart** (a guided walkthrough in the console that creates a key and sends a first request with the account). Assignment is sticky and recorded with a `$experiment_started` event and the profile property `Experiment: Interactive Quickstart`. |
| 2026-07-03 (Fri) to 2026-07-04 (Sat) | Holiday | US Independence Day (observed Friday). No launches or marketing changes. Production API traffic runs through US holidays, and many customers are outside the US. |
| 2026-07-08 (Wed) | Launch | **Prompt caching** becomes generally available on every plan. Customers turn it on in their own code by marking a cacheable prompt prefix. Requests that read a cached prefix carry `cache_hit = true`. |
| 2026-07-13 (Mon) | Org | A new Head of Developer Marketing joins and takes over paid channels and sponsorships. |
| 2026-07-28 (Tue) | Launch | **atlas-3** launches for Build, Scale, and Enterprise accounts at the same list price as atlas-2. atlas-2 stays available. |
| 2026-08-04 (Tue) | Compliance | SOC 2 Type II report published. No product change. |
| 2026-08-18 (Tue) | Pricing | **swift-2 price cut**: list price halved, from $0.80 to $0.40 per million input tokens and from $4.00 to $2.00 per million output tokens. No other model price changes. |
| 2026-08-26 (Wed) to 2026-08-27 (Thu) | Incident | **GPU capacity incident.** A hardware fault took part of one inference region's GPU fleet offline. The status page reported a major outage for that region for two days; capacity was restored early on August 28. Daily fleet health by region is in `inference_fleet_daily`. |
| 2026-09-01 (Tue) | Platform | **Build rate limits raised**: higher requests-per-minute and tokens-per-minute limits for every Build account. Other plans' limits unchanged. |
| 2026-09-07 (Mon) | Holiday | US Labor Day. No launches. |
| 2026-09-08 (Tue) | Launch | **atlas-3 opens to Free accounts.** |
| 2026-09-30 (Wed) | Fiscal | End of Q3. |
| 2026-10-01 (Thu) | — | End of the analysis window (data runs through 23:59 UTC). Q4 starts. |

## Things that did not change in the window

- No change to the atlas-2 or atlas-3 list price, the Free plan allowance, or Scale and Enterprise contract terms.
- No change to the onboarding flow outside the Interactive Quickstart test.
- No change to the Batch API or the evaluation tool.
- Paid marketing budgets were steady through the quarter (daily budgets paced by the ad and sponsorship platforms).
- The GPU fleet kept the same regions and capacity outside the August incident.

## Open questions leadership has asked

- Is prompt caching being used, and does it make the API faster? What does it do to revenue?
- How fast are customers moving to atlas-3?
- Should the Interactive Quickstart ship to everyone?
- What did the August incident cost us and our customers?
- Did the swift-2 price cut change which models customers use, and what did it do to revenue?
- What drove revenue per day over the summer?
- Are hackathon sponsorships worth it compared with search ads and newsletters?
- Did raising Build rate limits work?
