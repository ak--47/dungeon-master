# Driftway Travel metrics and warehouse tables

## KPI definitions

All KPIs use UTC days and count people by unique resolved member (`user_id`, with anonymous pre-signup events merged into the member).

| KPI | Definition |
|---|---|
| Search sessions | Count of `destination searched`. Each starts one session (`search_id`). |
| Checkout rate | Per search session, the share that reaches `checkout started` within 7 days (same `search_id`). Equivalently, `checkout started` / `destination searched` over a period. |
| Booking rate (checkout conversion) | `booking completed` / `checkout started` over the same period and segment. |
| Search conversion | Per search session, the share that ends in `booking completed` within 7 days. |
| Bookings | Count of `booking completed`. |
| Booking value (GBV) | Sum of `total_price` on `booking completed`, before cancellations. Driftway's revenue is about 15% of the value of stays that are not cancelled. |
| Average nightly rate | Average `nightly_rate` on `booking completed`. |
| Time to book | Per search session, the time from `destination searched` to `booking completed` (same `search_id`). Report the median; the distribution has a long tail. |
| Lead time | `lead_time_days` on the booking: days from booking to check-in. |
| Cancellation rate | Per booking (`booking_id` held constant), the share cancelled within 30 days of the booking. Compare only bookings with a full 30 days of data. Report weather cancellations separately; they follow the hurricane waiver, not traveler choice. |
| Active traveler | A member with `destination searched` in the period. Driftway does not count received notifications, check-ins, or experiment exposures as activity. |
| Traveler retention | Of members who did a starting event on day 0, the share with `destination searched` in a later bracket. Count only members whose bracket ends inside the data. In Mixpanel Retention this needs custom brackets. |
| New member activation | Share of new members (`account created`) with `booking completed` within 30 days. Compare only members with a full 30 days of data. |
| CAC (paid) | Spend for a paid channel divided by new members Mixpanel recorded from that channel (`account created` with that `acquisition_channel`) over the same days. Finance uses Mixpanel signups, not the signups the ad networks report. |
| Cost per booker | Spend for a paid channel divided by that channel's new members who booked within 30 days of signing up. |
| Payment approval rate | `authorizations_approved` / `authorization_attempts` in `payment_gateway_daily`. |
| Review rating | Average `rating` on `review submitted`; share of 1-2 star reviews. |

## Warehouse tables

Three tables come from the data warehouse, not from Mixpanel events. Each has one row per UTC day per dimension value for every day from 2026-06-04 to 2026-10-01 (120 days). They join to events on the UTC date of the event and on the named dimension.

In the warehouse, count columns (clicks, impressions, signups, authorizations, rooms, room nights) and latency are loaded as INT64 (shown as INTEGER below); money, rate, and share columns are FLOAT64 (shown as FLOAT).

### `marketing_spend_daily`

Daily paid acquisition cost by channel, from the ad networks' billing exports. Part of each day's spend is a budget the network paces through the day, following the weekly rhythm of traffic with a floor on quieter days; the rest is bid-based and rises and falls with the signups the network delivers that day.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Spend day. |
| `acquisition_channel` | STRING | — | `google_hotel_ads`, `meta_ads`, or `tiktok_ads`. Matches `acquisition_channel` on `account created`. |
| `spend_usd` | FLOAT | USD | Media spend billed for the day. |
| `impressions` | INTEGER | count | Ad impressions reported by the network. |
| `clicks` | INTEGER | count | Ad clicks reported by the network. |
| `signups_reported` | INTEGER | count | Signups the network attributes to itself for the day. Networks use their own attribution and usually claim more than Mixpanel records. |

Caveats: organic, referral, and email signups have no media spend and are not in this table. Use Mixpanel signups, not `signups_reported`, for CAC.

### `payment_gateway_daily`

Daily payment authorization health by platform (the gateway authorizes every checkout payment method), from the payments team's gateway logs and the gateway status page.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Day. |
| `platform` | STRING | — | `ios`, `android`, or `web`. Matches `platform` on events. |
| `authorization_attempts` | INTEGER | count | Payment authorizations the gateway received from that platform: approved, declined, and timed out, including card retries. |
| `approval_rate` | FLOAT | share 0-1 | Share of attempts the gateway approved (`authorizations_approved` / `authorization_attempts`, up to rounding). |
| `authorizations_approved` | INTEGER | count | Authorizations the gateway approved. Each successful booking payment needs one. |
| `gateway_timeout_rate` | FLOAT | share 0-1 | Share of attempts that timed out at the gateway. |
| `p95_auth_latency_ms` | INTEGER | milliseconds | 95th-percentile time to answer an authorization. |
| `gateway_status` | STRING | — | Daily status for the platform as posted on the status page: `operational` or `degraded`. |

Caveats: approvals run a little above Mixpanel's `booking completed` count and do not track it exactly: a date change re-authorizes the card, members who opted out of analytics are only in this table, and a few booking events never reach Mixpanel. Only travelers who reach the payment step create attempts, so attempts usually run well below the `checkout started` count (card retries can push a quiet day close to it). Declines for ordinary reasons (insufficient funds, failed bank verification) are part of the normal approval rate.

### `destination_supply_daily`

Daily hotel supply and demand by region, from the supply team's partner feeds and the operations team's weather desk.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Day. |
| `region` | STRING | — | `us_cities`, `us_beaches`, `mountains`, `caribbean`, or `europe`. Matches `region` on events. |
| `room_nights_booked` | INTEGER | room nights | Room nights in bookings made that day across all of Driftway's sales channels for the region. |
| `rooms_listed` | INTEGER | rooms | Rooms partners offered on Driftway in the region that day. |
| `avg_daily_rate_usd` | FLOAT | USD per night | The region's average daily room rate from partner feeds (market rate, not Driftway's booked rate). Higher on Friday and Saturday nights. |
| `weather_advisory` | STRING | — | `none` or `hurricane_warning`, from the weather desk. |

Caveats: `room_nights_booked` includes bookings sold through corporate travel desks and wholesale partners that never pass through the Driftway app or website, so it is larger than the room nights in Mixpanel bookings and does not track them exactly day to day. It counts by booking date, not stay date.

## Analysis tips

- For a before/after question around a dated change, consider the weekly rhythm, the overall trend, and other changes in the window (see 02-timeline.md) before you attribute a change to the event. Pick comparison periods that do not overlap another change.
- Activity follows a weekly rhythm (Sunday and Monday are the busiest planning days). Compare whole weeks or matching weekdays.
- New members keep arriving through the window, so totals tend to grow over time. Use rates (per search, per checkout, per booking, per member) when you compare periods.
- Per-session and per-booking questions need `search_id` or `booking_id` held constant; unique-member funnels answer a different question.
- New-member and per-booking windows (activation, cancellations, retention) need complete windows: drop cohorts that started too late in the window to finish theirs.
