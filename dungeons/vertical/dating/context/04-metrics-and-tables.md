# Kindred metrics and warehouse tables

## KPI definitions

All KPIs use UTC days and count people by unique `user_id`.

| KPI | Definition |
|---|---|
| New members | Unique members with `account created` in the period. |
| Profile completion | Share of new members who reach `profile completed` within 7 days of `account created`. |
| Match rate | `match created` events divided by `like sent` events over the same period and segment. Report it for standard likes and Sparks separately when Sparks matter (a Spark match has `match_source = spark`). |
| Opener rate | Per match (hold `match_id` constant), the share of matches with a `conversation started` within 7 days of `match created`. |
| Time to opener | Per match, hours from `match created` to `conversation started` (`hours_since_match` on the opener). Report the median. |
| Date rate | Per conversation (hold `match_id` constant), the share of openers followed by `date planned` within 30 days (the Mixpanel Funnels default window). Count only openers with a full 30 days of data. |
| Time to date | Per match, time from `conversation started` to `date planned`. Report the median. |
| Active member | A member with `app opened` in the period. Kindred does not count matches or experiment exposures as activity. |
| Retention | Of members who did a starting event on day 0, the share with `app opened` in a later bracket (for example day 14-27). Count only members whose bracket ends inside the data. In Mixpanel Retention this needs custom brackets. |
| Fake-account report rate | `profile reported` events with `report_reason` in (`fake_profile`, `scam`) per 1,000 profile decisions (`like sent` + `profile passed`). Trust & Safety uses decisions as the exposure base because report volume grows with browsing. |
| Verification rate | Share of active members (`app opened` since 2026-07-14) with `verified = true`. |
| Paywall conversion | `subscription started` events per `paywall viewed` event, by `plan`. |
| Weekly cancellation rate | `subscription cancelled` events divided by paid member-weeks in the period (members on `plus` or `premier`). Finance tracks the rate, not the raw count, because the paid base changes size. |
| New subscriptions | Count of `subscription started`, split by `plan` and `billing_period`. |
| Bookings | New subscriptions × list price on the start date, from `subscription_bookings_daily`. Finance reports bookings at list price for the whole billing period. |
| CAC (paid) | Spend for a paid channel divided by new members Mixpanel recorded from that channel (`account created` with that `acquisition_channel`) over the same days. Finance uses Mixpanel signups, not the installs the ad networks report. |
| Cost per completed profile | Spend for a paid channel divided by that channel's new members who completed their profile within 7 days. |
| Message delivery rate | 1 − `delivery_failure_rate` in `chat_delivery_daily`. |

## Warehouse tables

Three tables come from the data warehouse, not from Mixpanel events. Each has one row per UTC day per dimension value for every day from 2026-06-04 to 2026-10-01 (120 days). Days with no activity have a row with zeros. They join to events on the UTC date of the event and on the named dimension.

In the warehouse, numeric columns are loaded as FLOAT64 (shown as FLOAT below). Count columns (installs, clicks, impressions, messages, subscriptions) and latency always hold whole numbers, and raw file exports show them as integers.

### `paid_acquisition_daily`

Daily paid acquisition cost by channel, from the ad networks' billing exports. The campaigns are install-optimized. Part of each day's spend is a daily budget that the network paces through the day, following the weekly rhythm of signups with a floor on quieter days. The rest is bid-based and rises and falls with the installs the network delivers that day.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Spend day. |
| `acquisition_channel` | STRING | — | `meta_ads`, `tiktok_ads`, or `apple_search_ads`. Matches `acquisition_channel` on `account created`. |
| `spend_usd` | FLOAT | USD | Media spend billed for the day. |
| `installs_reported` | FLOAT | count | App installs the ad network claims for the day. Networks use their own attribution and usually claim more than Mixpanel records as signups. |
| `clicks` | FLOAT | count | Ad clicks or taps reported by the network. |
| `impressions` | FLOAT | count | Ad impressions reported by the network. |

Caveats: organic and referral have no media spend and are not in this table. Use Mixpanel signups, not `installs_reported`, for CAC.

### `chat_delivery_daily`

Daily health of the chat service by platform, from the messaging team's delivery logs and the public status page. It covers chat messages sent in existing conversations (Mixpanel `message sent`); first messages are logged by the match service and are not in this table.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Day. |
| `platform` | STRING | — | `ios` or `android`. Matches `platform` on events. |
| `messages_delivered` | FLOAT | count | Messages the chat service delivered from that platform's app, including automated messages (match greetings and safety tips) and messages from members who opted out of analytics. |
| `messages_attempted` | FLOAT | count | Messages the app tried to send: delivered plus failed. |
| `delivery_failure_rate` | FLOAT | share 0-1 | Share of attempted messages that failed. |
| `p95_send_latency_ms` | FLOAT | milliseconds | 95th-percentile time from send to delivery. |
| `service_status` | STRING | — | Daily status for the platform: `operational` or `major_outage`, as posted on the status page. |

Caveats: `messages_delivered` runs higher than the Mixpanel count of `message sent` and does not track it exactly day to day (automated messages and members who opted out of analytics are only in this table). A failed send never fires a Mixpanel `message sent` event.

### `subscription_bookings_daily`

Daily new subscriptions and bookings by plan and billing period, from the app stores' and Kindred's billing records.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Subscription start day. |
| `plan` | STRING | — | `plus` or `premier`. Matches `plan` on `subscription started`. |
| `billing_period` | STRING | — | `1_month`, `3_month`, or `6_month`. Matches `billing_period` on `subscription started`. |
| `new_subscriptions` | FLOAT | count | New subscriptions that day. |
| `list_price_usd` | FLOAT | USD per billing period | List price for a new subscription of this plan and period on this day. |
| `gross_bookings_usd` | FLOAT | USD | `new_subscriptions` × `list_price_usd`. |

Caveats: the table covers new subscriptions only, not renewals. Promotional and introductory discounts are not applied; finance reports bookings at list price. Billing and Mixpanel differ a little day to day: a few purchases made on the app store page never reach Mixpanel, and same-day refunds are netted out of billing. Use this table, not Mixpanel, for prices and bookings.

## Analysis tips

- For a before/after question around a dated change, consider the weekly rhythm, the overall trend, and mix shifts before you attribute a change to the event.
- Activity follows a weekly rhythm. Compare whole weeks or matching weekdays, not a few days against a span with a different mix of weekdays.
- New members keep arriving through the window, so totals tend to grow over time. Use rates (per like, per match, per paywall view, per decision) when you compare periods.
- New-member funnels, conversion, and retention depend on signup date: members who joined late in the window have had less time to act. Compare cohorts that joined in the same weeks, and only count brackets that end inside the data.
- Per-match questions need `match_id` held constant.
