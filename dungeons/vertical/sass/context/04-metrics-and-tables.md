# Tallyboard metrics and warehouse tables

## KPI definitions

All KPIs use UTC days and count people by unique `user_id`.

| KPI | Definition |
|---|---|
| New signups | Unique users with `account created` in the period. |
| Onboarding completion | Share of new users who reach `dashboard created` after `account created` → `cloud account connected` → `agent installed`, in order, within 7 days of signup. |
| Activation | The growth team's working definition of an activated new workspace is still under discussion; it is measured from first-week behavior only. |
| Day-N retention | Of new users who signed up on day 0, the share with any event in days N to N+6 after signup. Only count users who signed up at least N+7 days before the end of the data. In Mixpanel Retention this needs custom brackets (for example day 30-36). |
| Weekly active users | Unique users with any event in a calendar week (Monday start). |
| Time to acknowledge (MTTA) | Per alert, time from `alert triggered` to `alert acknowledged` (same `alert_id`). Report the median; `response_time_mins` on the acknowledgement holds the same value. |
| Time to resolve (MTTR) | Per alert, time from `alert acknowledged` to `alert resolved` (same `alert_id`); `resolution_time_mins` on the resolution. |
| Acknowledgement rate | Share of triggered alerts that were acknowledged (match on `alert_id`). |
| Root Cause Assist adoption | Share of Business and Enterprise resolutions (by `plan_tier` on the event, since 2026-07-22) with `resolution_method = ai_assist`. |
| Pipeline success rate | Share of `deployment pipeline run` events with `pipeline_status = success`. Equivalent to a deploy funnel holding `deploy_id` constant. |
| Time to deploy | Per run, time from `deployment pipeline run` to `service deployed` (same `deploy_id`), successful runs only. |
| Paid conversion | Share of new signups with `subscription started`. Compare signups from the same weeks; later signups have had less time to buy. |
| New paid subscriptions | Count of `subscription started`, split by `plan`. |
| Seats per new subscription | Average `seats` on `subscription started`. |
| New MRR | Seats on new subscriptions × list price per seat on the start date, from `subscription_bookings_daily`. New ARR = new MRR × 12. |
| CAC (paid) | Spend for a paid channel divided by new signups Mixpanel recorded from that channel (`account created` with that `acquisition_channel`) over the same days. Finance uses Mixpanel signups, not the leads the ad platforms report. |
| Cost per paying customer | Spend for a paid channel divided by signups from that channel who started a subscription. |
| Seat expansion | Seats added at existing paid customers. Seat changes on existing subscriptions are billed outside the self-serve flow and are not in Mixpanel or `subscription_bookings_daily`; teams watch collaboration activity as a leading indicator. |

## Warehouse tables

Three tables come from the data warehouse, not from Mixpanel events. Each has one row per UTC day per dimension value for every day from 2026-06-04 to 2026-10-01 (120 days). Days with no activity have a row with zeros. They join to events on the UTC date of the event and on the named dimension.

Numeric columns are stored as FLOAT64 (shown as FLOAT below). Count columns (leads, clicks, impressions, jobs, seats, subscriptions) always hold whole numbers.

### `paid_marketing_daily`

Daily paid marketing cost by channel, from the ad platforms' billing exports. Each channel runs on a daily budget that the ad platform paces through the day, so spend is billed every day, including weekends and days with few signups.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Spend day. |
| `acquisition_channel` | STRING | — | `paid_search`, `linkedin_ads`, or `g2_reviews`. Matches `acquisition_channel` on `account created`. |
| `spend_usd` | FLOAT | USD | Media spend billed for the day. |
| `platform_reported_leads` | FLOAT | count | Leads the ad platform claims for the day. Platforms use their own attribution and usually claim more than Mixpanel records. |
| `clicks` | FLOAT | count | Ad clicks reported by the platform. |
| `impressions` | FLOAT | count | Ad impressions reported by the platform. |

Caveats: organic, referral, and outbound sales have no media spend and are not in this table (outbound is a sales cost). Use Mixpanel signups, not `platform_reported_leads`, for CAC.

### `ci_runner_health_daily`

Daily health of Tallyboard's hosted CI runners by region, from the infrastructure team's monitoring and the public status page.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Day. |
| `runner_region` | STRING | — | `us-east`, `us-west`, `eu-west`, or `ap-south`. Matches `runner_region` on `deployment pipeline run`. |
| `jobs_started` | FLOAT | count | All jobs started on the region's runners that day: customer pipeline runs plus scheduled and API-triggered jobs. |
| `infra_error_rate` | FLOAT | share 0-1 | Share of jobs that hit a runner-side infrastructure error (not a test or build failure in the customer's code). |
| `queue_p95_seconds` | FLOAT | seconds | 95th-percentile time a job waited for a runner. |
| `runner_status` | STRING | — | Daily status for the region: `operational` or `major_outage`, as posted on the status page. |
| `runner_capacity_vcpu` | FLOAT | vCPU | Provisioned runner capacity in the region. |

Caveats: customer code failures do not count toward `infra_error_rate`. Mixpanel's `pipeline_status` does not say why a run failed. Scheduled and API-triggered jobs do not send a product event, so `jobs_started` runs higher than the Mixpanel count of `deployment pipeline run` and does not track it exactly day to day.

### `subscription_bookings_daily`

Daily new self-serve subscriptions, seats, and bookings by plan, from the billing system.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Subscription start day. |
| `plan` | STRING | — | `team` or `business`. Matches `plan` on `subscription started`. |
| `new_seats` | FLOAT | seats | Seats on new subscriptions that day. |
| `new_subscriptions` | FLOAT | count | New subscriptions that day. |
| `list_price_per_seat_usd` | FLOAT | USD per seat per month | List price for a new subscription of this plan on this day. |
| `new_mrr_usd` | FLOAT | USD per month | `new_seats` × `list_price_per_seat_usd`. |
| `new_arr_usd` | FLOAT | USD per year | `new_mrr_usd` × 12. |

Caveats: the table covers new self-serve subscriptions only, not renewals, seat changes on existing subscriptions, or Enterprise contracts. Annual-billing discounts are not applied; finance reports bookings at list price. Billing and Mixpanel differ a little day to day: customers can edit the seat count before the first invoice, and a few checkouts never reach Mixpanel (blocked or dropped browser calls). Use this table, not Mixpanel, for booked seats and MRR.

## Analysis tips

- For a before/after question around a dated change, consider seasonality, weekday mix, the overall trend, and mix shifts before you attribute a change to the event.
- New-user funnels, conversion, and retention depend on signup date: users who joined late in the window have had less time to act. Compare cohorts that joined in the same weeks.
- Users receive many alerts and run many pipelines. Per-alert and per-run questions need `alert_id` or `deploy_id` held constant; unique-user funnels hide most of the difference between users.
