# Tradepost metrics and warehouse tables

## KPI definitions

All KPIs use UTC days and count people by unique `user_id` after identity merge.

| KPI | Definition |
|---|---|
| New members | Unique members with `account created` in the period. |
| New buyer activation | Share of new members with a `purchase completed` within 14 days of `account created`. Count only members who signed up at least 14 days before the end of the data. |
| Checkout conversion | Per checkout (hold `order_id` constant), the share of `checkout started` events followed by `purchase completed` within 1 day. The payments team reports it per checkout, not per member, because buyers check out many times. |
| Checkout time | Per completed checkout, minutes from `checkout started` to `purchase completed`. Report the median. |
| Offer acceptance rate | Per offer (hold `offer_id` constant), the share of `offer made` events answered by `offer accepted` within 2 days. |
| Sell-through | Per listing (hold `listing_id` constant), the share of `listing created` events followed by `item sold` within 30 days. Count only listings created at least 30 days before the end of the data. |
| Time to sell | Per sold listing, days from `listing created` to `item sold` (`days_to_sell` on the sale). Report the median, for listings sold within 30 days. |
| Listings per seller | `listing created` events per seller per day (or week), split by `account_type`. Compare the same group of sellers across periods; sellers who join mid-period add listings as they arrive. |
| Delivery time | `delivery_days` on `order delivered`: days from purchase to delivery. An order is **late** when it took more than 7 days. |
| Repeat purchase | Of buyers with a starting event on day 0 (for example their first purchase in the period), the share with another `purchase completed` within the next 30 days. Count only buyers whose 30 days end inside the data. In Mixpanel Retention this needs custom brackets. |
| Dispute rate | `dispute opened` per `order delivered`. Allow a few days after delivery before reading recent weeks. |
| Active buyer | A member with `listing viewed` or `search performed` in the period. Server-side order events do not count as activity. |
| GMV | Gross merchandise value: item prices of placed orders, from `marketplace_ledger_daily.gmv_usd`. Finance uses the ledger, not Mixpanel, for GMV. |
| Take rate | `fee_revenue_usd / gmv_usd` in the ledger. |
| CAC (paid) | Spend for a paid channel divided by new members Mixpanel recorded from that channel (`account created` with that `acquisition_channel`) over the same days. |
| Cost per activated buyer | Spend for a paid channel divided by that channel's new members who made a purchase within 14 days. |
| Payment approval rate | `authorizations_approved / authorizations_attempted` in `payment_processing_daily`. |

## Warehouse tables

Three tables come from the data warehouse, not from Mixpanel events. Each has one row per UTC day per dimension value for every day from 2026-06-04 to 2026-10-01 (120 days). They join to events on the UTC date of the event and on the named dimension.

In the warehouse, numeric columns are loaded as FLOAT64 (shown as FLOAT below). Count columns (clicks, impressions, authorizations, orders) and latency always hold whole numbers, and raw file exports show them as integers.

### `marketing_spend_daily`

Daily paid marketing cost by channel, from the ad platforms' billing exports. Part of each day's spend is a daily budget that the platform paces through the day, following the weekly rhythm with a floor on quieter days. The rest is bid-based and rises and falls with the installs the platform delivers that day.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Spend day. |
| `acquisition_channel` | STRING | — | `google_shopping`, `meta_ads`, or `tiktok_ads`. Matches `acquisition_channel` on `account created`. |
| `spend_usd` | FLOAT | USD | Media spend billed for the day. |
| `clicks` | FLOAT | count | Ad clicks or taps reported by the platform. |
| `impressions` | FLOAT | count | Ad impressions reported by the platform. |

Caveats: organic and referral have no media spend and are not in this table. Referral credits are not marketing spend.

### `payment_processing_daily`

Daily payment authorizations by payment method, from the payments team's processor reports and the processors' status pages.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Day. |
| `payment_method` | STRING | — | `card`, `apple_pay`, `google_pay`, or `paypal`. Matches `payment_method` on checkout and purchase events. |
| `authorizations_approved` | FLOAT | count | Payment authorizations approved (orders placed). |
| `authorizations_attempted` | FLOAT | count | Payment authorizations requested: approved plus declined or timed out. |
| `approval_rate` | FLOAT | share 0-1 | Share of attempted authorizations approved. |
| `p95_auth_latency_ms` | FLOAT | milliseconds | 95th-percentile time to answer an authorization. |
| `processor_status` | STRING | — | Daily status for the method: `operational` or `degraded`, as posted by the processor. |

Caveats: approvals run a little higher than the Mixpanel count of `purchase completed` and do not match it day to day: some orders come from older app versions that do not send analytics, and the processor settles across midnight differently from the app clock. A declined payment never fires `purchase completed`; the buyer's `checkout started` stays without a purchase. Attempts include retries.

### `marketplace_ledger_daily`

Daily marketplace financials by seller type, from the finance ledger.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Order day. |
| `seller_type` | STRING | — | `casual` or `pro`. Matches `seller_type` on buyer events. |
| `gmv_usd` | FLOAT | USD | Item prices of orders placed that day (excludes shipping fees). |
| `orders` | FLOAT | count | Orders placed that day. |
| `take_rate` | FLOAT | share 0-1 | Selling fee rate in effect for the seller type that day. |
| `fee_revenue_usd` | FLOAT | USD | Selling fees earned: `gmv_usd × take_rate`. |
| `refunds_usd` | FLOAT | USD | Refunds issued that day (disputes, cancellations, and goodwill credits). |

Caveats: the ledger counts orders from every client, including ones that never reach Mixpanel, and removes orders cancelled before shipping, so `orders` and `gmv_usd` differ from Mixpanel `purchase completed` by a few percent and do not track it exactly day to day. Pro subscription revenue is not in this table. Use the ledger, not Mixpanel, for GMV, fees, and refunds.

## Analysis tips

- For a before/after question around a dated change, consider the weekly rhythm, the overall trend, and mix shifts before you attribute a change to the event.
- Activity follows a weekly rhythm (Sunday is the busiest day, Friday the quietest). Compare whole weeks or matching weekdays.
- New members keep arriving through the window, so totals tend to grow over time. Use rates (per checkout, per offer, per listing, per seller) when you compare periods.
- Funnels, conversion, and retention depend on start date: members who joined, listings created, and orders placed late in the window have had less time to finish. Count only starts with a full window inside the data.
- Members check out, make offers, and list many times. Per-order, per-offer, and per-listing questions need the id held constant; unique-member funnels hide most of the differences.
