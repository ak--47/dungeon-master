# Forkfly metrics and warehouse tables

## KPI definitions

All KPIs use UTC days and count people by unique `user_id`.

| KPI | Definition |
|---|---|
| New customers | Unique customers with `account created` in the period. |
| First-order rate | Share of new customers who place an order (any time in the data after signup). Count only customers who signed up early enough to have had a fair chance (for example through August). |
| Active customer | A customer with `app opened` in the period. Forkfly does not count server-side events (`order delivered`, `pass trial ended`, `pass cancelled`) as activity. |
| Ordering customer | A customer with `order placed` in the period. |
| Visit conversion | Share of visits (`app opened`) that end in `order placed` within an hour, before the next `app opened`. |
| Checkout conversion | Per checkout (hold `order_id` constant), the share of `checkout started` followed by `order placed` within 1 hour. |
| Average order value (AOV) | Average `order_total_usd` on `order placed`. Basket size is average `subtotal_usd` or `items_count`. |
| On-time delivery | Share of delivered orders with `minutes_late` below 20. An order 20 or more minutes past its quoted time counts as **late** (the threshold in courier and restaurant scorecards). |
| Repeat rate (30-day) | Of new customers whose first order was delivered on day 0, the share who place another order within 30 days. Count only first deliveries with a full 30 days of data (through August 31). |
| Payment failure rate | `payment failed` / (`payment failed` + `order placed`) for the same payment method and days. |
| Support contact rate | Share of delivered orders with a `support contacted` event for the same `order_id`. |
| Pass trial conversion | Share of `pass trial ended` events with `outcome = converted`. |
| Pass order share | Share of `order placed` events with `pass_status` in (`trial`, `member`). |
| CAC (paid) | Spend for a paid channel divided by new customers Mixpanel recorded from that channel (`account created` with that `acquisition_channel`) over the same days. Finance uses Mixpanel signups, not the signups the ad networks report. |
| Cost per repeat customer | Spend for a paid channel divided by that channel's new customers who placed a second order within 30 days of their first delivery. |
| Orders per courier | `orders_dispatched` / `active_couriers` in `market_ops_daily`. |

## Warehouse tables

Three tables come from the data warehouse, not from Mixpanel events. Each has one row per UTC day per dimension value for every day from 2026-06-04 to 2026-10-01 (120 days). They join to events on the UTC date of the event and on the named dimension.

In the warehouse, numeric columns are loaded as FLOAT64 (shown as FLOAT below). Count columns (impressions, clicks, signups, attempts, declines, orders, couriers) and latency always hold whole numbers, and raw file exports show them as integers.

### `marketing_spend_daily`

Daily paid acquisition cost by channel, from the ad networks' and affiliate partners' billing exports. Paid search and paid social are bought partly on daily budgets that the networks pace through the week (with a floor on quieter days) and partly on results. Coupon affiliates are paid mostly per signup they send.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Spend day. |
| `acquisition_channel` | STRING | — | `paid_search`, `paid_social`, or `coupon_affiliates`. Matches `acquisition_channel` on `account created`. |
| `spend_usd` | FLOAT | USD | Spend billed for the day (media spend or affiliate fees). |
| `impressions` | FLOAT | count | Ad impressions (or deal listing views) reported by the network or partner. |
| `clicks` | FLOAT | count | Clicks reported by the network or partner. |
| `network_reported_signups` | FLOAT | count | Signups the network or partner claims for the day, under its own attribution rules. Usually higher than Mixpanel's count. |

Caveats: organic and referral have no spend and are not in this table. The `DEAL15` discount itself is a promotion cost, not marketing spend, and is not in `spend_usd` (it appears as `discount_usd` on the first order). Use Mixpanel signups, not `network_reported_signups`, for CAC.

### `payment_gateway_daily`

Daily payment authorizations by payment method, from the payment gateway's settlement reports and the providers' status pages.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Day. |
| `payment_method` | STRING | — | `card`, `apple_pay`, `google_pay`, or `paypal`. Matches `payment_method` on events. |
| `auth_attempts` | FLOAT | count | Payment authorizations attempted (approved plus declined). |
| `auth_declines` | FLOAT | count | Authorizations declined. |
| `decline_rate` | FLOAT | share 0-1 | `auth_declines` / `auth_attempts`. |
| `p95_auth_latency_ms` | FLOAT | milliseconds | 95th-percentile authorization time. |
| `gateway_status` | STRING | — | Daily status for the method's provider: `operational` or `major_outage`. |

Caveats: the gateway also processes web and phone orders and automatic payment retries that never reach Mixpanel, so `auth_attempts` runs higher than the Mixpanel count of `order placed` + `payment failed` and does not track it exactly day to day.

### `market_ops_daily`

Daily dispatch volume, weather, and courier supply by city, from the dispatch system, the courier scheduling tool, and a weather data feed (station data for each city, by UTC day).

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Day. |
| `city` | STRING | — | One of the eight markets. Matches `city` on events. |
| `orders_dispatched` | FLOAT | count | Orders sent to couriers that day, including phone and partner-site orders, net of cancellations. |
| `precipitation_mm` | FLOAT | millimeters | Total precipitation for the UTC day. |
| `weather_condition` | STRING | — | `clear`, `cloudy`, `drizzle` (a trace of rain, under 2 mm), `rain` (4 mm or more), `thunderstorm` (25 mm or more). |
| `temp_high_f` | FLOAT | °F | Daily high temperature. |
| `active_couriers` | FLOAT | count | Couriers who worked at least one delivery shift that day. |
| `courier_hours` | FLOAT | hours | Total courier shift hours. |

Caveats: `orders_dispatched` runs a little higher than the Mixpanel count of `order placed` for the city and day (phone and partner-site orders are only in this table). Forkfly calls a day "rainy" in a city when `precipitation_mm` is 4 or more.

## Analysis tips

- Activity follows a weekly and daily rhythm (lunch and dinner peaks, busier Friday to Sunday). Compare whole weeks or matching weekdays when you look at a dated change.
- New customers keep arriving through the window, so totals tend to grow over time. Use rates (per visit, per checkout, per customer, per city-day) when you compare periods.
- A US dinner order often lands on the next UTC date. Use UTC dates consistently when you join events to the warehouse tables.
- Conversion, repeat, and trial questions depend on how much time a customer had: only count windows that end inside the data.
- Customers place many orders. Per-order questions need `order_id` held constant; unique-customer funnels hide most of the difference between orders.
