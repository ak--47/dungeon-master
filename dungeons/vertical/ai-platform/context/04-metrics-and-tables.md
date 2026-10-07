# Cortexa metrics and warehouse tables

## KPI definitions

All KPIs use UTC days and count accounts by unique `user_id`. Remember that each `api request` event stands for 1,000 requests.

| KPI | Definition |
|---|---|
| New accounts | Unique accounts with `account created` in the period. |
| Activation | Share of new accounts that complete the onboarding funnel (`account created` → `api key created` → `api request`, in order) within 7 days of signup. |
| Time to first request | Per new account, time from `account created` to its first `api request` after `api key created`. Report the median. |
| Active account | An account with any event other than the platform-sent `batch job completed` and `eval run completed` (those arrive even when nobody is working). |
| Day-N retention | Of new accounts that signed up on day 0, the share active in days N to N+6 after signup. Only count accounts that signed up at least N+7 days before the end of the data. In Mixpanel Retention this needs custom brackets (for example day 30-36). To exclude the two platform-sent events, use a custom event that groups every other event as the return event. |
| Weekly active accounts | Unique active accounts in a calendar week (Monday start). |
| Request volume | Count of `api request` events × 1,000. |
| Success rate / error rate | Share of `api request` events with `status_code = 200` / with any other status. Server-side error rate counts `500` and `529` only. |
| Latency | Average or median `latency_ms` of successful requests (`status_code = 200`). Failed requests return early, and models differ in speed, so compare like with like. |
| Cache hit rate | Share of `api request` events with `cache_hit = true`. |
| Model mix | Share of `api request` events by `model`. "Flagship mix" compares atlas-3 with atlas-2 only. |
| Rate-limit rate | `rate limit hit` events per 1,000 `api request` events (that is, rate-limit episodes per million requests). |
| Batch turnaround | Per job, time from `batch job submitted` to `batch job completed` (same `batch_id`). Report the median. |
| Paid conversion | Share of new accounts that reach `plan upgraded` within 30 days of `account created` (the Mixpanel Funnels default conversion window). Count only signups with a full 30 days of data (signups through August 31). |
| Usage value | Metered usage at list price (cached input at 10% of the input price), from `model_billing_daily`. |
| Revenue | Usage value minus the part drawn from Free accounts' free allowance (`free_credit_usd`), from `model_billing_daily`. Reported at list price. |
| CAC (paid) | Spend for a paid channel divided by new accounts Mixpanel recorded from that channel (`account created` with that `acquisition_channel`) over the same days. Finance uses Mixpanel signups, not the signups the platforms report. |
| Cost per paying account | Spend for a paid channel over a signup period divided by that period's signups from the channel that upgraded within 30 days. |

## Warehouse tables

Three tables come from the data warehouse, not from Mixpanel events. Each has one row per UTC day per dimension value for every day from 2026-06-04 to 2026-10-01 (120 days). Days with no activity have a row with zeros. They join to events on the UTC date of the event and on the named dimension. Count columns hold whole numbers; rates, prices, and dollar amounts are decimals.

### `inference_fleet_daily`

Daily health of Cortexa's GPU inference fleet by region, from the platform team's monitoring and the public status page.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Day. |
| `inference_region` | STRING | — | `us-east`, `us-west`, or `eu-west`. Matches `inference_region` on `api request`. |
| `requests_served` | INTEGER | requests | Every request the region served that day (not sampled): customer API requests, including failed ones, plus Cortexa's own first-party apps and internal evaluation pipelines. |
| `error_rate_5xx` | FLOAT | share 0-1 | Share of customer API requests that failed with a server-side error (500 or 529). |
| `gpus_online` | INTEGER | GPUs | Average number of GPUs in service. |
| `gpu_utilization` | FLOAT | share 0-1 | Average utilization of the GPUs in service. |
| `p95_latency_ms` | INTEGER | milliseconds | 95th-percentile request latency across all models. |
| `region_status` | STRING | — | Daily status for the region as posted on the status page: `operational` or `major_outage`. |

Caveats: internal traffic does not send product events and runs every day at a steady level, so `requests_served` is higher than 1,000 × the Mixpanel request count and does not track it exactly day to day. Rate-limited (429) requests are rejected before they reach the fleet and are not counted.

### `model_billing_daily`

Daily metered usage, list prices, and revenue by model, from the billing system. It covers the Messages API; Batch API usage is invoiced separately and is not in this table.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Metering day. |
| `model` | STRING | — | `atlas-2`, `swift-2`, or `atlas-3`. Matches `model` on `api request`. |
| `requests_billed` | INTEGER | requests | Successful requests metered (not sampled). Failed requests are not billed. |
| `input_tokens_billed` | INTEGER | tokens | Input tokens of those requests, including cached input. |
| `cached_input_tokens_billed` | INTEGER | tokens | The part of the input read from the prompt cache. |
| `output_tokens_billed` | INTEGER | tokens | Output tokens. |
| `list_price_input_per_mtok` | FLOAT | USD per million tokens | Input list price for the model on this day. |
| `list_price_output_per_mtok` | FLOAT | USD per million tokens | Output list price for the model on this day. |
| `usage_value_usd` | FLOAT | USD | Usage at list price: uncached input × input price + cached input × 10% of the input price + output × output price. |
| `free_credit_usd` | FLOAT | USD | The part of the usage value drawn from Free accounts' free allowance. |
| `revenue_usd` | FLOAT | USD | `usage_value_usd` − `free_credit_usd`. |

Caveats: metering posts a request's usage when it closes and the daily file closes on a schedule, so a varying share of each day's usage lands in the next day's row. A small share of requests never reaches analytics, so billing runs slightly above 1,000 × the Mixpanel count. Scale and Enterprise contract terms are not applied; finance reports revenue at list price. Use this table, not Mixpanel, for prices and revenue.

### `developer_marketing_daily`

Daily paid developer-marketing cost by channel, from the ad platforms and sponsorship invoices (sponsorship fees are amortized over the days each sponsorship runs).

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Spend day. |
| `acquisition_channel` | STRING | — | `search_ads`, `newsletter_sponsorships`, or `hackathons`. Matches `acquisition_channel` on `account created`. |
| `spend_usd` | FLOAT | USD | Spend billed or amortized for the day. |
| `platform_reported_signups` | INTEGER | count | Signups the platform or sponsor claims for the day, by its own attribution. |
| `clicks` | INTEGER | count | Clicks (for hackathons, registrations and link clicks) reported by the platform. |
| `impressions` | INTEGER | count | Impressions or reach reported by the platform. |

Caveats: organic, github, and referral have no media spend and are not in this table. Daily budgets are paced through the week (lower on weekends) but never stop. Use Mixpanel signups, not `platform_reported_signups`, for CAC.

## Analysis tips

- `api request` is sampled 1 in 1,000. Shares, averages, and rates are unbiased; multiply counts by 1,000 for volume.
- `plan_tier` on an event is the plan at that moment. Accounts move from Free to Build, so a user-profile breakdown (current plan) and an event breakdown (plan at the time) can differ.
- Console activity is weekday-heavy; API traffic runs every day. Compare whole weeks or matching weekdays.
- For a before/after question around a dated change, check the overall trend, plan mix, and model mix before you credit the change. Look for a group the change did not touch and use it as a control.
- New-account funnels, conversion, and retention depend on signup date: accounts that joined late in the window have had less time to act. Compare cohorts that joined in the same weeks.
- Accounts run many batch jobs and evaluations. Per-job questions need `batch_id` or `eval_id` held constant.
