# Reelhouse metrics and warehouse tables

## KPI definitions

All KPIs use UTC days and count households by unique `user_id`.

| KPI | Definition |
|---|---|
| New accounts | Unique households with `account created` in the period. |
| Trial start rate | Share of new accounts that reach `trial started` (same signup session). |
| Trial conversion | Share of households with `trial started` that reach `trial converted` within 8 days (a trial converts at day 7). Mixpanel Funnels, `trial started` → `trial converted`, Uniques, 8-day conversion window. Count only trials that started at least 8 days before the end of the data (through 2026-09-23). |
| Paying subscribers | Households whose subscription is active (paid or in trial). On the profile: `subscription_status` = `active`. |
| Renewal-time churn | Of the renewals that came due in the period, the share that were cancelled instead: paid cancellations (`subscription cancelled` with `during_trial` = false) / (paid cancellations + `subscription renewed`). Reelhouse reports this as its monthly churn rate. Trial cancellations are not churn; they show up in trial conversion. The data starts June 4, so a renewal due in the first days of June that was cancelled before June 4 has no cancellation event in the data, and June churn reads a little low. |
| Viewing household | A household with at least one `playback started` in the period. Reelhouse does not count notifications, billing events, or app opens without a play as viewing. |
| Plays | Count of `playback started`. |
| Completion rate | `playback completed` / `playback started` over the same period and segment. Films complete less often than episodes. |
| Title reach | Of the viewing households in a period, the share with at least one play of a title (or of one season of it). |
| Search to play | Per search, the time from `search performed` to the `playback started` with the same `search_id`. Report the median. Mixpanel Funnels, `search performed` → `playback started`, hold `search_id` constant, 1-hour window, median time to convert. |
| Push open rate | `notification opened` / `notification received` (totals), by `campaign_type`. |
| CAC (paid) | Spend for a paid channel divided by new accounts Mixpanel recorded from that channel (`account created` with that `acquisition_channel`) over the same days. Finance uses Mixpanel accounts, not the conversions the ad platforms report. |
| Cost per paid subscriber | Spend for a paid channel divided by that channel's households that reached `trial converted`. |
| New paid subscriptions | First charges at the end of a trial: `trial converted` in Mixpanel, `new_paid_subscriptions` in `subscription_billing_daily`. |
| Bookings | New paid subscriptions × list price on the day of the first charge, from `subscription_billing_daily`. Finance reports first-month bookings at list price; renewals are tracked separately in billing and are not in this table. |
| Average price per new subscription | `gross_bookings_usd` / `new_paid_subscriptions` over the period. |
| Playback failure rate | Share of playback attempts that failed, from `playback_qos_daily`. In Mixpanel, failed plays send `playback error`. |

## Warehouse tables

Three tables come from the data warehouse, not from Mixpanel events. Each has one row per UTC day per dimension value for every day from 2026-06-04 to 2026-10-01 (120 days). Days with no activity have a row with zeros. They join to events on the UTC date of the event and on the named dimension.

In the warehouse, whole-number columns (counts, kbps, milliseconds) are INTEGER (INT64) and money and rate columns are FLOAT (FLOAT64).

### `marketing_spend_daily`

Daily paid marketing cost by channel, from the ad platforms' billing exports. Part of each day's spend is a daily budget that the platform paces through the day, following the weekly rhythm of signups with a floor on quieter days. The rest is bid-based and rises and falls with the signups the platform delivers that day.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Spend day. |
| `acquisition_channel` | STRING | — | `paid_social`, `paid_search`, or `ctv`. Matches `acquisition_channel` on `account created` and on the profile. |
| `spend_usd` | FLOAT | USD | Media spend billed for the day. |
| `platform_reported_signups` | INTEGER | count | Signups the ad platform claims for the day. Platforms use their own attribution and usually claim more than Mixpanel records. |
| `clicks` | INTEGER | count | Ad clicks or taps (for `ctv`: QR-code scans and remote clicks on the ad). |
| `impressions` | INTEGER | count | Ad impressions. |

Caveats: organic and referral have no media spend and are not in this table. Use Mixpanel accounts, not `platform_reported_signups`, for CAC.

### `playback_qos_daily`

Daily streaming quality by platform, from the CDN provider's logs and the player's quality reports. The streaming infrastructure team owns it and posts `cdn_status` on the internal status page.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Day. |
| `platform` | STRING | — | `tv`, `mobile`, `tablet`, or `web`. Matches `platform` on events. |
| `playback_attempts` | INTEGER | count | Plays the player tried to start on that platform. |
| `playback_failure_rate` | FLOAT | share 0-1 | Share of attempts that failed to start or stopped with an error. |
| `rebuffer_ratio` | FLOAT | share 0-1 | Share of watch time spent rebuffering. |
| `avg_bitrate_kbps` | INTEGER | kbps | Average delivered video bitrate. |
| `p95_startup_ms` | INTEGER | milliseconds | 95th-percentile time from pressing play to the first frame. |
| `cdn_status` | STRING | — | Daily status for the platform: `healthy` or `degraded`. |

Caveats: `playback_attempts` runs higher than the Mixpanel count of `playback started` and does not track it exactly day to day: it includes plays from older app versions that do not send analytics, and the player also logs preview autoplays and automatic retries as attempts. Bitrate differs by platform because screens and connections differ.

### `subscription_billing_daily`

Daily new paid subscriptions and first-month bookings by plan, from Reelhouse's billing system and the app stores.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Day of the first charge (the day the trial ended). |
| `plan` | STRING | — | `basic_ads`, `standard`, or `premium`. Matches `plan` on `trial converted`. |
| `new_paid_subscriptions` | INTEGER | count | Trials that turned into a paid subscription that day. |
| `list_price_usd` | FLOAT | USD per month | List price of the plan for a first charge on this day. |
| `gross_bookings_usd` | FLOAT | USD | `new_paid_subscriptions` × `list_price_usd`. |

Caveats: the table covers first charges only, not renewals. Billing and Mixpanel differ a little day to day: a few subscriptions bought through an app store never reach Mixpanel, and same-day refunds are netted out of billing. Use this table, not Mixpanel, for prices and bookings.

## Analysis tips

- For a before/after question around a dated change, consider the weekly rhythm, the overall trend, and mix shifts before you attribute a change to the event.
- Viewing follows a strong weekly and nightly rhythm. Compare whole weeks or matching weekdays, and remember that a North American evening spans two UTC dates.
- New households keep arriving through the window while some established households leave, so compare rates (per play, per trial, per renewal due, per push) rather than raw totals.
- Trial outcomes depend on when the trial started: a trial needs 8 days of data to have converted or not. Compare cohorts that started in the same weeks, and only count complete windows.
- A household can watch on several screens. Breakdowns by `platform` split one household's activity across rows, so per-platform unique counts do not add up to the total.
