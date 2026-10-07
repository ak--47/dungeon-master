# Forgebench timeline: June 4 to October 1, 2026

All dates are UTC. This page lists what happened and when. It does not record outcomes; measure those in the data.

| Date | Type | What happened |
|---|---|---|
| 2026-06-04 (Thu) | — | Start of the analysis window. |
| 2026-06-30 (Tue) | Fiscal | End of Q2. |
| 2026-07-03 (Fri) | Holiday | US Independence Day (observed). Many US-based customer teams take the day off. No product or marketing changes. |
| 2026-07-08 (Wed) | Experiment | **"Remote Build Cache" CI test** starts. Every developer who runs a CI build from this date is assigned 50/50 to **Control** (the runner's local cache only) or **Remote Cache** (builds also read and write a shared remote cache of dependencies and build outputs). Assignment is sticky per developer and is recorded once, at the developer's first build in the test, with a `$experiment_started` event, and on the profile as `Experiment: Remote Build Cache`. |
| 2026-07-13 (Mon) | Org | A developer experience (DX) team is formed to own onboarding and the CLI. |
| 2026-07-29 (Wed) | Launch | **Forge Assist** (AI code review) launches for Pro, Team, and Enterprise. It is off by default; each developer turns it on for their own pull requests. Pull requests it reviews carry `review_mode = forge_assist`. Free developers see it as an upgrade prompt only. |
| 2026-08-18 (Tue) | Billing | Team customers are emailed that **runner-minute overage billing** starts on September 1. No product change on this date. |
| 2026-08-19 (Wed) to 2026-08-20 (Thu) | Incident | **Package registry mirror incident.** One of Forgebench's package registry mirrors served errors and timeouts. The status page reported the mirror as degraded for two days; it recovered early on August 21. No customer action was needed. Daily mirror status by package ecosystem is in `build_fleet_daily`. |
| 2026-09-01 (Tue) | Billing | **Team overage billing starts.** Team runner minutes above the organization's pooled monthly allowance are billed at $0.015 per minute. Free, Pro, and Enterprise are not metered this way. Overage appears in `usage_billing_daily`. |
| 2026-09-07 (Mon) | Holiday | US Labor Day. Many US-based customer teams take the day off. |
| 2026-09-30 (Wed) | Fiscal | End of Q3. |
| 2026-10-01 (Thu) | — | End of the analysis window (data runs through 23:59 UTC). Q4 starts. |

## Things that did not change in the window

- No change to the Free, Pro, or Team seat prices or to Enterprise contracts.
- No change to the setup flow, the supported stacks, or the pipeline templates.
- No change to how pull requests are reviewed outside Forge Assist.
- Paid channel cost-per-signup targets were steady through the quarter. Weekly budgets per paid channel moved up and down as usual (see `marketing_spend_daily`).
- The hosted runner fleet kept the same runner sizes and capacity.

## Open questions leadership has asked

- Is Forge Assist being used, and does it change how fast pull requests get merged?
- Should the Remote Build Cache ship to everyone?
- Why do some new signups never finish setup?
- What drives change failure rate?
- What did the August mirror incident cost our customers?
- Did overage billing change how Team customers use CI, and what did it bring in?
