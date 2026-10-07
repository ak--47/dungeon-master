# Keystead Homes metrics and warehouse tables

## KPI definitions

All KPIs use UTC days and count people by unique `user_id` (after Mixpanel links anonymous pre-signup browsing to the account).

| KPI | Definition |
|---|---|
| Active shoppers | Unique shoppers with `listing viewed` or `home search` in the period. Keystead does not count alerts sent, agent replies, completed tours, lender decisions, or experiment exposures as shopper activity. |
| New shoppers | Unique shoppers with `account created` in the period. |
| Save rate | `listing saved` events divided by `listing viewed` events over the same period and segment. |
| Tours per save | `tour requested` events with `request_source = listing_page` divided by `listing saved` events in the same period. Product uses it to track the listing-page booking flow. |
| Lead-to-tour rate | Per agent reply (hold `listing_id` constant), the share of `agent responded` events followed by `tour requested` for the same home within 7 days. |
| Agent response time | `response_minutes` on `agent responded`. Report the median and the share answered within the team's target bands. |
| Tour completion | `tour completed` divided by `tour requested`, by `booking_type`. |
| Offer rate per tour | Per completed tour (hold `listing_id` constant, Totals counting), the share of `tour completed` events followed by `offer submitted` for the same home within 14 days. Count only tours with a full 14 days of data (tours through September 17). |
| Time to offer | Per offer, time from `tour completed` to `offer submitted` for the same home. Report the median. |
| Acceptance rate | `offer accepted` divided by offers with an outcome (`offer accepted` + `offer rejected`). |
| Homes under contract | Count of `offer accepted`. Closings happen 30-45 days later and are not in this project. |
| Pre-approval start rate (new shoppers) | Share of new shoppers with `pre-approval started` within 30 days of `account created`. Count only shoppers with a full 30 days (signups through September 1). |
| Approval rate | `pre-approval completed` divided by `pre-approval started`. |
| Retention | Of shoppers who did a starting event on day 0, the share with an active-shopper event (Keystead uses `listing viewed`) in a later bracket, for example day 7-13. Count only shoppers whose bracket ends inside the data. In Mixpanel Retention this needs custom brackets. |
| Alert tap-through | `listing alert opened` divided by `listing alert sent`. |
| CAC (paid) | Spend for a paid channel divided by new shoppers Mixpanel recorded from that channel (`account created` with that `acquisition_channel`) over the same days. Finance uses Mixpanel signups, not the leads the ad platforms report. |
| Cost per pre-approval start | Spend for a paid channel divided by that channel's new shoppers who started a pre-approval within 30 days of signup. |
| Cost per offer | Spend for a paid channel divided by the `offer submitted` events of that channel's new shoppers over the same signup days (offers counted through the end of the data). |

## Warehouse tables

Three tables come from the data warehouse, not from Mixpanel events. Each has one row per UTC day per dimension value for every day from 2026-06-04 to 2026-10-01 (120 days). Days with no activity have a row with zeros. They join to events on the UTC date of the event and on the named dimension.

In the warehouse, counts and whole-dollar prices are INT64 (shown as INTEGER below); spend, rates, and points are FLOAT64 (shown as FLOAT).

### `marketing_spend_daily`

Daily paid acquisition cost by channel, from the ad platforms' billing exports. Spend is billed daily against each channel's budget; daily amounts vary with delivery.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Spend day. |
| `acquisition_channel` | STRING | — | `paid_search`, `paid_social`, or `youtube_ads`. Matches `acquisition_channel` on `account created`. |
| `spend_usd` | FLOAT | USD | Media spend billed for the day. |
| `leads_reported` | INTEGER | count | Sign-ups the ad platform claims for the day, using its own attribution. Platforms usually claim more than Mixpanel records. |
| `clicks` | INTEGER | count | Ad clicks reported by the platform. |
| `impressions` | INTEGER | count | Ad impressions reported by the platform. |

Caveats: organic and referral have no media spend and are not in this table. Use Mixpanel signups, not `leads_reported`, for CAC.

### `mortgage_rate_sheet_daily`

The Keystead Home Loans daily rate sheet and application count by loan type, from the lending team's loan origination system.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Rate-sheet day. |
| `loan_type` | STRING | — | `conventional` (30-year fixed), `fha`, `va`, or `jumbo`. Matches `loan_type` on the pre-approval events. |
| `applications` | INTEGER | count | Pre-approval applications received that day, from every source: the website and apps, phone, and branch partners. |
| `note_rate_pct` | FLOAT | percent | The day's base note rate for a 30-year fixed loan of this type, before borrower adjustments. |
| `apr_pct` | FLOAT | percent | The matching annual percentage rate. |
| `discount_points` | FLOAT | points | Points priced into the base rate. |
| `rate_locks` | INTEGER | count | Rate locks taken that day. |

Caveats: `applications` runs higher than the Mixpanel count of `pre-approval started` and does not track it exactly day to day, because phone and partner applications never reach Mixpanel. The rate a shopper is quoted (`rate_quoted_pct` on `pre-approval completed`) is the day's note rate adjusted for the borrower, rounded to 1/8 point.

### `market_inventory_daily`

Daily MLS inventory and listing-page traffic by market, from the listings data team (MLS feed imports) and the web servers.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Day. |
| `market` | STRING | — | One of the eight markets. Matches `market` on listing events. |
| `listing_page_views` | INTEGER | count | Listing pages served that day from the server logs, including visitors who block analytics and crawler traffic. |
| `new_listings` | INTEGER | count | Listings that became visible in Keystead search that day. |
| `active_listings` | INTEGER | count | Listings visible in search at 12:00 UTC. |
| `price_reductions` | INTEGER | count | Listings whose price was cut that day. |
| `closed_sales` | INTEGER | count | MLS closings in the market that day, all brokerages. |
| `median_list_price_usd` | INTEGER | USD | Median list price of active listings at 12:00 UTC. |
| `feed_status` | STRING | — | `healthy` or `stale` (the MLS import failed; listings visible in search are not being updated). |

Caveats: `listing_page_views` runs well above the Mixpanel count of `listing viewed` and does not track it exactly day to day. Market figures (`closed_sales`, inventory) cover the whole MLS, not only Keystead buyers.

## Analysis tips

- For a before/after question around a dated change, consider the weekly rhythm, the overall trend, and mix shifts before you attribute a change to the event.
- Activity follows a weekly rhythm (Sundays are busiest). Compare whole weeks or matching weekdays.
- New shoppers keep arriving through the window, so totals tend to grow over time. Use rates (per view, per save, per tour, per reply) when you compare periods.
- New-shopper conversion and retention depend on signup date: shoppers who joined late in the window have had less time to act. Compare cohorts that joined in the same weeks, and only count windows that end inside the data.
- Shoppers view, save, and tour many homes. Per-home questions need `listing_id` held constant; unique-shopper funnels hide most of the difference between homes.
