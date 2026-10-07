# Forgebench metrics and warehouse tables

## KPI definitions

All KPIs use UTC days and count people by unique `user_id`.

| KPI | Definition |
|---|---|
| New signups | Unique developers with `account created` in the period. |
| Onboarding completion | Share of new developers who reach `preview deployed` after `account created` → `repository imported` → `pipeline configured`, in order, within 7 days of signup. |
| Activation | The growth team's working definition of an activated developer is still under discussion; it is measured from early behavior after signup only. |
| Day-N retention | Of developers who signed up on day 0, the share with any event in days N to N+6 after signup. Only count developers who signed up at least N+7 days before the end of the data. In Mixpanel Retention this needs custom brackets (for example day 30-36). Every event in this project is a developer action, so "any event" means "active". |
| Weekly active developers | Unique developers with any event in a calendar week (Monday start). |
| Review wait | Per pull request, time from `pull request opened` to `review submitted` (same `pr_id`). Report the median. `review_wait_hours` on the review holds the same value. |
| Merge time | Per pull request, time from `review submitted` to `pull request merged` (same `pr_id`). Report the median. |
| Forge Assist adoption | Share of pull requests opened on Pro, Team, and Enterprise (by `plan_tier` on the event, since 2026-07-29) with `review_mode = forge_assist`. |
| Build success rate | Share of `build finished` events with `build_status = success`. |
| Build time | `build_duration_sec` on `build finished`. Compare passed builds: a failed build stops early at its failing stage. |
| Change failure rate | Share of `production deployed` events with `deploy_outcome = rolled_back`. |
| Paid conversion | Share of new signups on Free (`plan_tier = free` on `account created`) who start a subscription within 42 days of `account created`. Developers who join a company already on Team or Enterprise have nothing to buy and are left out. Count only signups with a full 42 days of data (signups through August 20). |
| New paid subscriptions | Count of `subscription started`, split by `plan`. |
| New MRR | Seats on new subscriptions × list price per seat (Pro $12, Team $29). |
| CAC (paid) | Spend for a paid channel divided by new signups Mixpanel recorded from that channel (`account created` with that `acquisition_channel`) over the same days. Finance uses Mixpanel signups, not the signups the ad platforms report. |
| Cost per onboarded developer | Spend for a paid channel divided by that channel's signups who completed onboarding, over the same signup days. |
| Overage revenue | `overage_revenue_usd` in `usage_billing_daily`. |

## Warehouse tables

Three tables come from the data warehouse, not from Mixpanel events. Each has one row per UTC day per dimension value for every day from 2026-06-04 to 2026-10-01 (120 days). Days with no activity have a row with zeros. They join to events on the UTC date of the event and on the named dimension.

In the warehouse, numeric columns are loaded as FLOAT64 (shown as FLOAT below). Count columns (clicks, impressions, signups, builds, minutes) always hold whole numbers, and raw file exports show them as integers.

### `marketing_spend_daily`

Daily paid marketing cost by channel, from the ad platforms' and newsletter publishers' billing exports. Each campaign bids to a target cost per signup set by marketing, so the platform paces spend to the conversions it has been getting over the past week. Budgets also follow a weekday schedule (lower on Saturday and Sunday), but campaigns keep serving on weekends, so spend is billed every day.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Spend day. |
| `acquisition_channel` | STRING | — | `paid_search`, `paid_social`, or `newsletter`. Matches `acquisition_channel` on `account created`. |
| `spend_usd` | FLOAT | USD | Media spend billed for the day. |
| `clicks` | FLOAT | count | Clicks reported by the platform or publisher. |
| `impressions` | FLOAT | count | Impressions reported by the platform or publisher. |
| `platform_reported_signups` | FLOAT | count | Signups the platform claims for the day. Platforms use their own attribution and usually claim more than Mixpanel records. |

Caveats: organic, referral, and community have no media spend and are not in this table. Use Mixpanel signups, not `platform_reported_signups`, for CAC. Daily cost per signup is noisy (a small channel can have days with few signups); use weekly, monthly, or window totals.

### `build_fleet_daily`

Daily health of the hosted CI fleet by package ecosystem, from the infrastructure team's monitoring and the public status page.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Day. |
| `ecosystem` | STRING | — | `npm`, `pypi`, `go_modules`, `rubygems`, `maven`, `nuget`, or `cargo`. Matches `ecosystem` on the build events. |
| `builds_started` | FLOAT | count | All builds started for the ecosystem: customer builds plus API-triggered and partner jobs. |
| `dependency_fetch_error_rate` | FLOAT | share 0-1 | Share of dependency downloads through Forgebench's registry mirror that failed or timed out. |
| `registry_mirror_status` | STRING | — | Daily status of the ecosystem's registry mirror as posted on the status page: `operational` or `degraded`. |
| `queue_p95_seconds` | FLOAT | seconds | 95th-percentile time a build waited for a runner. |
| `remote_cache_hit_rate` | FLOAT | share 0-1 | Share of cache lookups served by the shared remote build cache, among builds that use it. Zero before the Remote Build Cache test started (2026-07-08). |

Caveats: API-triggered and partner jobs do not send a product event, so `builds_started` runs higher than the Mixpanel count of `build started` and does not track it exactly day to day. Mixpanel's `failure_stage` says where a build failed but not why.

### `usage_billing_daily`

Daily metered runner usage and overage by plan, from the billing system.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Billing day (see caveats). |
| `plan_tier` | STRING | — | `free`, `pro`, `team`, or `enterprise`. Matches `plan_tier` on build events. |
| `billable_runner_minutes` | FLOAT | minutes | Runner minutes metered for the plan that day, across every parallel job of every build. |
| `overage_price_per_minute_usd` | FLOAT | USD per minute | Overage price in force: $0.015 for Team from 2026-09-01, zero otherwise. |
| `overage_minutes` | FLOAT | minutes | Minutes billed above organizations' pooled allowances. |
| `overage_revenue_usd` | FLOAT | USD | `overage_minutes` × `overage_price_per_minute_usd`. |

Caveats: a build fans out into several parallel jobs (matrix builds, test shards), and billing meters runner minutes for every job, so `billable_runner_minutes` is several times the sum of `build_duration_sec` for the same builds. The billing day closes at 07:00 UTC, so part of each UTC day's usage bills on the next day. Retries and API-triggered jobs that send no product event are billed too. Use this table, not Mixpanel, for billed minutes and overage.

## Analysis tips

- For a before/after question around a dated change, consider the weekday mix, the overall trend, and mix shifts before you attribute a change to the event. The active base grew through the summer as new signups joined.
- Activity is weekday-heavy: developers work Monday to Friday, and weekends are light. Compare matching weekdays or whole weeks.
- New-developer funnels, conversion, and retention depend on signup date: developers who joined late in the window have had less time to act. Compare cohorts that joined in the same weeks.
- Developers open many pull requests and run many builds. Per-PR and per-build questions need `pr_id` or `build_id` held constant; unique-developer funnels hide most of the difference between pull requests.
