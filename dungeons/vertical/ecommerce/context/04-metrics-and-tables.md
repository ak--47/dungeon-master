# Marlowe & Pine metrics and warehouse tables

## KPI definitions

All KPIs use UTC days and count people by unique `user_id`.

| KPI | Definition |
|---|---|
| New customers | Unique customers with `account created` in the period. |
| Buyers | Unique customers with at least one `order completed` in the period. |
| Orders and revenue | Count of `order completed`; revenue = sum of `order_total_usd` (after discounts, including shipping fees, excluding tax). |
| Average order value (AOV) | Revenue / orders. Order values are skewed by furniture; report the median too. |
| Cart conversion | Share of carts that reach `order completed` within 1 day of the cart's first `product added to cart`, matching on `cart_id`. In Mixpanel: Funnels, product added to cart → order completed, Totals, hold `cart_id` constant, 1-day window. |
| Checkout time | Per converted cart, time from the first `product added to cart` to `order completed` (same `cart_id`). Report the median. |
| Free-shipping share | Share of orders with `free_shipping` = true. Meaningful for standard US orders; Pine Plus orders always ship free and international orders never do. |
| Add-to-cart rate | `product added to cart` events per `product viewed` event, for a category or overall. |
| First-order rate | Share of new customers who place an order within 30 days of `account created` (the Mixpanel Funnels default window). Count only customers who signed up at least 30 days before the end of the data (through August 31). |
| Repeat rate | Share of customers with another `order completed` within N days after a given order. Use a window that fits inside the data. |
| Day-N retention | Of new customers who signed up on day 0, the share with any shopper action in days N to N+6 after signup. Shopper actions exclude `order shipped` and `order delivered`, which the fulfillment system sends. Only count customers who signed up at least N+7 days before the end of the data. In Mixpanel Retention this needs custom brackets. |
| Return rate | `return requested` per order, by category or overall. |
| On-time delivery | Share of `order delivered` with `on_time` = true. |
| CAC (paid) | Spend for a paid channel divided by new customers Mixpanel recorded from that channel (`account created` with that `acquisition_channel`) over the same days. |
| Cost per first order | Spend for a paid channel over a signup period divided by that period's new customers from the channel who placed an order within 30 days. Finance uses Mixpanel buyers, not purchases the ad platforms claim. |

## Warehouse tables

Three tables come from the data warehouse, not from Mixpanel events. Each has one row per UTC day per dimension value for every day from 2026-06-04 to 2026-10-01 (120 days). Days with no activity have a row with zeros. They join to events on the UTC date and the named dimension.

In the warehouse, count columns (clicks, impressions, purchases, parcels, units, SKUs) are loaded as INT64 (shown as INTEGER below); money, rates, and averages are FLOAT64 (shown as FLOAT).

### `marketing_spend_daily`

Daily paid media cost by channel, from the ad platforms' billing exports. Each channel runs on a daily budget that the platform paces through the day. Budgets follow the weekly shopping rhythm (highest on Sundays and Mondays, lowest on Fridays), and spend is billed every day.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Spend day. |
| `acquisition_channel` | STRING | — | `meta_ads`, `google_shopping`, or `tiktok_ads`. Matches `acquisition_channel` on `account created` and on profiles. |
| `spend_usd` | FLOAT | USD | Media spend billed for the day. |
| `clicks` | INTEGER | count | Ad clicks reported by the platform. |
| `impressions` | INTEGER | count | Ad impressions reported by the platform. |
| `platform_attributed_purchases` | INTEGER | count | Purchases the ad platform credits to its ads that day, with its own attribution (including view-through). Platforms count differently from Mixpanel and from each other. |

Caveats: organic search, direct, and email/referral have no media spend and are not in this table. Brand, creator fees outside the ad platforms, and wholesale marketing are booked elsewhere. Use Mixpanel signups and buyers, not `platform_attributed_purchases`, for CAC.

### `carrier_performance_daily`

Daily service levels by parcel carrier, from the carriers' scan feeds and our weekly carrier scorecards. A row's date is the day parcels were handed to the carrier.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Ship (hand-off) day. |
| `shipping_carrier` | STRING | — | `northline`, `bluejay`, `parcelpost`, `maple_courier`, or `albion_parcel`. Matches `shipping_carrier` on `order shipped` and `order delivered`. |
| `parcels_shipped` | INTEGER | count | Parcels handed to the carrier that day, including wholesale shipments to retail partners. |
| `on_time_rate` | FLOAT | share 0-1 | Share of that day's parcels delivered within the carrier's service commitment, as the carrier reports it: 1 − `late_parcels` / `parcels_shipped`. On low-volume days (the international carriers hand over a few parcels a day) it moves in large steps. |
| `avg_transit_days` | FLOAT | days | Average days from hand-off to delivery for that day's parcels, as the carrier reports it. |
| `late_parcels` | INTEGER | count | Parcels from that day that missed the carrier's service commitment, as the carrier reports it. |
| `service_status` | STRING | — | The carrier's posted status for its network that day: `normal` or `disrupted`. |

Caveats: wholesale parcels never appear in Mixpanel, so `parcels_shipped` runs higher than the count of `order shipped` and does not track it exactly day to day. Carriers measure their own commitment, which can differ from our customer promise (`on_time` on `order delivered`).

### `inventory_daily`

Daily stock position by product category, from the warehouse management system (end-of-day snapshot).

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Snapshot day. |
| `primary_category` | STRING | — | `bedding`, `bath`, `kitchen`, `dining`, `furniture`, `lighting`, `decor`, `outdoor`. Matches `primary_category` on `order completed` and `category` on product events. |
| `units_shipped` | INTEGER | units | Units allocated to orders that day for this category: online orders (by order date) plus wholesale and retail-partner orders (partners place occasional bulk orders). |
| `skus_active` | INTEGER | count | Sellable SKUs in the category (each product in each size and colorway). |
| `skus_out_of_stock` | INTEGER | count | Active SKUs with zero sellable units at end of day. |
| `in_stock_rate` | FLOAT | share 0-1 | 1 − `skus_out_of_stock` / `skus_active`. |
| `units_on_hand` | INTEGER | units | Sellable units on hand at end of day. |

Caveats: Mixpanel events carry no stock information; use this table for stock questions. `units_shipped` counts units by the order's first-item category, like `primary_category`.

## Analysis tips

- Customers start many carts and place several orders. Per-cart questions need `cart_id` held constant; unique-user funnels hide most of the difference between carts.
- For a before/after question around a dated change, consider the overall growth of the customer base, the weekly rhythm, other changes in the same weeks, and mix shifts before you attribute a change to the event.
- Shopping is heavier on weekends. Compare matching weekdays or whole weeks.
- New-customer conversion and retention depend on signup date: customers who joined late in the window have had less time to act. Compare cohorts that joined in the same weeks, and use windows that fit inside the data.
- Orders placed in the last days of September may not have shipped or been delivered by October 1.
