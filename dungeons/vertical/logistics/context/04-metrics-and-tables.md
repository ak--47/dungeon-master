# Routewise Freight metrics and warehouse tables

## KPI definitions

All KPIs use UTC days and count people by unique `user_id`.

| KPI | Definition |
|---|---|
| New shippers | Unique users with `account created` in the period. |
| Credit approval rate | Share of new shippers with `credit approved` within 7 days of `account created`. |
| Quote-to-book rate | Per quote (hold `shipment_id` constant, Totals), the share of `quote requested` followed by `load booked` within 7 days. Count only quotes with a full 7 days of data. |
| Spread to market | For a quote, `quoted_rate_per_mile` / the day's `spot_rate_per_mile` for the same equipment in `spot_market_rates_daily` − 1. A spread of 0.10 means the quote is 10% over the spot benchmark. The benchmark is not on events; it needs the warehouse join on date and `equipment_type`. |
| Time to cover | Per load (hold `shipment_id` constant), time from `load booked` to `carrier assigned`. Report the median. |
| On-time delivery rate | Share of `load delivered` events with `on_time = true`. |
| Tracking tickets per load | `support ticket created` with `ticket_category = tracking_status` per `pickup confirmed` in the same period. Support uses pickups as the base because these tickets come from loads in transit. |
| Accessorial rate | Per booked load (hold `shipment_id` constant), the share with an `accessorial charged` of a given `charge_type`. Read loads booked at least two weeks before the end of the data so they have been delivered and billed. |
| Active shipper | A user with any portal action in the period: `quote requested`, `load booked`, `shipment tracked`, `support ticket created`, `dashboard viewed`, `rate lookup`, `document downloaded`, `report exported`, or `lane saved`. Carrier and billing events (`carrier assigned`, `pickup confirmed`, `delivery exception`, `load delivered`, `accessorial charged`, `invoice paid`) are not shipper activity; they keep arriving for booked loads after a shipper goes quiet. |
| Retention | Of shippers who did a starting event on day 0, the share who come back with a shipper action (for example `quote requested`) in a later bracket. Count only shippers whose bracket ends inside the data. |
| Booked revenue | Sum of `customer_rate_usd` on `load booked` (linehaul at booking, from Mixpanel). |
| Billed revenue and gross margin | From `load_margin_daily`: billed revenue, carrier cost, and gross margin (revenue − carrier cost). Margin % = gross margin / billed revenue, summed over the days and methods in question (do not average daily percentages). |
| CAC (paid) | Spend for a paid channel divided by new shippers Mixpanel recorded from that channel (`account created` with that `acquisition_channel`) over the same days. Finance uses Mixpanel signups, not the leads the ad platforms report. |
| Cost per approved shipper | Spend for a paid channel divided by that channel's new shippers approved for credit within 7 days. |
| Days to pay | `days_to_pay` on `invoice paid`. Report the median by tier or terms. |

## Warehouse tables

Three tables come from the data warehouse, not from Mixpanel events. Each has one row per UTC day per dimension value for every day from 2026-06-04 to 2026-10-01 (120 days). Days with no activity have a row with zeros. They join to events on the UTC date of the event and on the named dimension.

Count columns (posts, loads, leads, clicks, impressions) are whole numbers loaded as INT64 (shown as INTEGER below). Money, rate, and ratio columns are FLOAT64 (shown as FLOAT).

### `spot_market_rates_daily`

Daily truckload spot market benchmark by equipment type, licensed from a third-party freight market index that aggregates load board postings and spot rates across the US. Routewise's pricing desk prices quotes from this benchmark.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Benchmark day. |
| `equipment_type` | STRING | — | `dry_van`, `reefer`, or `flatbed`. Matches `equipment_type` on events. |
| `market_load_posts` | INTEGER | count | Loads posted to US load boards that day for this equipment. |
| `market_truck_posts` | INTEGER | count | Trucks posted as available that day for this equipment. |
| `load_to_truck_ratio` | FLOAT | ratio | Load posts per truck post. Higher means tighter capacity. |
| `spot_rate_per_mile` | FLOAT | USD per mile | National average spot rate for the equipment, linehaul including fuel. |
| `diesel_usd_per_gallon` | FLOAT | USD per gallon | US average retail diesel price (same value on every equipment row of a day). |

Caveats: the index is national, not per lane. Use it as the benchmark for every quote of that day and equipment. The index publishes every day, including weekends.

### `load_margin_daily`

Daily billed revenue, carrier cost, and gross margin by booking method, from Routewise's billing and carrier settlement systems. Each load is attributed to its booking day.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Booking day. |
| `booking_method` | STRING | — | `negotiated` or `instant`. Matches `booking_method` on `load booked`. `instant` rows are zero before the Instant Book test (see 02-timeline.md). |
| `gross_revenue_usd` | FLOAT | USD | Linehaul revenue billed to shippers for loads booked that day. |
| `loads_booked` | INTEGER | count | Loads booked that day that were billed (cancelled loads are excluded). |
| `carrier_cost_usd` | FLOAT | USD | What Routewise paid carriers for those loads. |
| `gross_margin_usd` | FLOAT | USD | `gross_revenue_usd` − `carrier_cost_usd`. |
| `gross_margin_pct` | FLOAT | share 0-1 | `gross_margin_usd` / `gross_revenue_usd` for the row. |

Caveats: billing does not match the Mixpanel `load booked` count and `customer_rate_usd` exactly. A few booked loads are cancelled before pickup and never billed, and rebills, fuel true-ups, and short payments move billed revenue from day to day. Accessorial charges are not in this table. Use this table, not Mixpanel, for carrier cost and margin.

### `paid_marketing_daily`

Daily paid acquisition cost by channel, from the ad platforms' billing exports.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Spend day. |
| `acquisition_channel` | STRING | — | `google_ads`, `linkedin_ads`, or `trade_media`. Matches `acquisition_channel` on `account created`. |
| `spend_usd` | FLOAT | USD | Media spend billed for the day. |
| `leads_reported` | INTEGER | count | Signups the ad platform claims for the day. Platforms use their own attribution and usually claim more than Mixpanel records. |
| `clicks` | INTEGER | count | Ad clicks reported by the platform. |
| `impressions` | INTEGER | count | Ad impressions reported by the platform. |

Caveats: organic and referral have no media spend and are not in this table. Part of each day's spend is a paced daily budget (following the weekday rhythm, with a floor on weekends) and the rest is bid-based and rises and falls with the signups the platform delivers. Use Mixpanel signups, not `leads_reported`, for CAC.

## Analysis tips

- For a before/after question around a dated change, consider the weekly rhythm, the overall trend, and mix shifts before you attribute a change to the event.
- Activity follows a strong weekday rhythm; weekends are quiet. Compare whole weeks or matching weekdays.
- New shippers keep arriving through the window, so totals tend to grow over time. Use rates (per quote, per load, per pickup) when you compare periods.
- Shippers price many loads. Per-quote and per-load questions need `shipment_id` held constant; unique-user funnels hide most of the difference between quotes.
- New-shipper funnels and retention depend on signup date: shippers who joined late in the window have had less time to act. Compare cohorts that joined in the same weeks, and only count brackets that end inside the data.
- Loads in transit on June 4 were picked up before the window, so the first days of the window show deliveries and tickets for pickups that are not in the data.
