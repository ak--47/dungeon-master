# Stridewell metrics and warehouse tables

## KPI definitions

All KPIs use UTC days and count people by unique `user_id`.

| KPI | Definition |
|---|---|
| New members | Unique members with `account created` in the period. |
| Onboarding completion | Share of new members who reach `starter workout completed` after `account created` → `goal quiz completed` → `plan generated`, in order, within 7 days of signup. |
| Time to onboard | Time from `account created` to `starter workout completed` for members who complete onboarding (median preferred). |
| Weekly active members | Unique members with any event in a calendar week (Monday start). |
| Workout frequency | `workout completed` events per active member per week. |
| Week-N retention | Of new members who signed up on day 0, the share with any event in days 7N to 7N+6 after signup (Mixpanel Retention, weekly unit, Week N bucket; Week 4 = days 28-34). Only count members who signed up at least 7N+7 days before the end of the data. |
| Trial start rate | Share of new members with `trial started`. |
| Trial-to-paid | Share of trial starters with `subscription purchased` (on any plan). |
| New Plus subscriptions | Count of `subscription purchased`, split by `plan`. Each member buys at most once. |
| Plan mix | Share of new Plus subscriptions that are Monthly vs Annual. |
| Gross bookings | New subscriptions × list price on the purchase date, from `subscription_billing_daily`. |
| Net bookings | Gross bookings minus app-store fees (15%). |
| CAC (paid) | Paid-media spend for a channel divided by the new members Mixpanel recorded from that channel (`account created` with that `acquisition_channel`) over the same days. Finance uses Mixpanel signups, not the installs the ad platforms report. |
| Cost per paying member | Paid-media spend for a channel divided by members from that channel who bought Plus. |
| Challenge completion rate | Share of joined challenges that the member completed, matched on `challenge_id`. |
| Notification open rate | Share of `notification received` events with `opened = true`. |
| Stride Coach adoption | Share of Plus members' completed workouts with `coaching_mode = ai_coach` (since 2026-08-12). |
| Sync success rate | 1 − `sync_error_rate` in `wearable_sync_daily`. |

## Warehouse tables

Three tables come from the data warehouse, not from Mixpanel events. Each has one row per UTC day per dimension value for every day from 2026-06-04 to 2026-10-01 (120 days). Days with no activity have a row with zeros. They join to events on the UTC date of the event and on the named dimension.

### `paid_acquisition_daily`

Daily paid-media cost by channel, from the ad platforms' billing exports.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Spend day. |
| `acquisition_channel` | STRING | — | `paid_social`, `paid_search`, or `app_store_ads`. Matches `acquisition_channel` on `account created`. |
| `spend_usd` | FLOAT | USD | Media spend billed for the day. All three channels are bought per install (CPI). |
| `platform_reported_installs` | INTEGER | count | Installs the ad platform claims for the day. Platforms use their own attribution and usually claim more than Mixpanel records. |
| `clicks` | INTEGER | count | Ad clicks reported by the platform. |
| `impressions` | INTEGER | count | Ad impressions reported by the platform. |

Caveats: organic and referral channels have no spend and are not in this table. Use Mixpanel signups, not `platform_reported_installs`, for CAC.

### `wearable_sync_daily`

Daily health of wearable workout sync, by device type, from the integration team's monitoring and the partner's status feed.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Day. |
| `wearable_type` | STRING | — | `smartwatch`, `fitness_band`, or `chest_strap`. Matches `wearable_type` on `workout completed`. |
| `synced_workouts` | INTEGER | count | Wearable-tracked workouts that synced successfully that day. |
| `sync_error_rate` | FLOAT | share 0-1 | Share of sync attempts that failed. |
| `sync_requests` | INTEGER | count | Sync attempts made (successful plus failed). |
| `partner_api_status` | STRING | — | Daily sync status for the device type: `operational` or `major_outage`. Combines the partner status feed with our own pipeline monitoring. |
| `p95_sync_latency_ms` | INTEGER | milliseconds | 95th-percentile time from workout end to sync. |

Caveats: a workout that never synced is not in Mixpanel and is not in `synced_workouts`. Phone-tracked and manual workouts are not in this table.

### `subscription_billing_daily`

Daily new Plus subscriptions and bookings by plan, from the billing system.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Purchase day. |
| `plan` | STRING | — | `monthly` or `annual`. Matches `plan` on `subscription purchased`. |
| `new_subscriptions` | INTEGER | count | New Plus purchases that day. |
| `list_price_usd` | FLOAT | USD | List price for a new purchase of this plan on this day. |
| `gross_bookings_usd` | FLOAT | USD | `new_subscriptions` × `list_price_usd`. |
| `store_fees_usd` | FLOAT | USD | App-store fees (15% of gross). |
| `net_bookings_usd` | FLOAT | USD | Gross bookings minus store fees. |

Caveats: the table covers first purchases only, not renewals, refunds, or upgrades between plans. Bookings are the first payment (one month for Monthly, one year for Annual), so Monthly and Annual bookings are not directly comparable as lifetime value.

## Analysis tips

- For a before/after question around a dated change, consider seasonality, the overall trend, and mix shifts before you attribute a change to the event.
- New-member funnels and retention depend on signup date: members who joined late in the window have had less time to act. Compare cohorts that joined in the same weeks.
