# Ledgerline metrics and warehouse tables

## KPI definitions

All KPIs use UTC days and count people by unique `user_id`.

| KPI | Definition |
|---|---|
| New sign-ups | Unique customers with `account created` in the period. |
| Onboarding completion (funded rate) | Share of new sign-ups who reach `deposit completed` after `account created` → `identity verification started` → `identity verified`, in order, within 7 days of sign-up. Only count sign-ups with 7 full days of data (sign-ups through September 23). |
| Time to fund | Per new customer, time from `account created` to the first `deposit completed`. Report the median. |
| Funded account | A customer with at least one `deposit completed`. |
| Active customer | A customer with at least one customer-initiated event in the period. Server-side events (`price alert triggered`, `recurring buy executed`, `withdrawal confirmed`) do not make a customer active. |
| Day-N retention | Of new customers who signed up on day 0, the share with an `app opened` in days N to N+6 after sign-up. Only count customers who signed up at least N+7 days before the end of the data. In Mixpanel Retention this needs a custom bracket (for example day 30-36). |
| Simple Buy completion | Share of `quick buy started` orders with a `quick buy completed` (same `order_id`) within one day. |
| Advanced Trade activity | `trade executed` count; per active customer when comparing days. |
| Withdrawal success | Share of `withdrawal submitted` with a `withdrawal confirmed` (same `withdrawal_id`). |
| Staking flows | Counts of `stake started` and `unstake requested`, and their `amount_usd`. |
| Recurring buy plans | Active plans = plans with an execution in the period (`recurring buy executed`, distinct `plan_id`). |
| Net deposits | Sum of `amount_usd` on `deposit completed` minus sum of `amount_usd` on `withdrawal submitted`. |
| Trading fee revenue | Sum of `fee_usd` on `quick buy completed`, `trade executed`, and `recurring buy executed`. |
| CAC (paid) | Spend for a paid channel divided by new sign-ups Mixpanel recorded from that channel (`account created` with that `acquisition_channel`) over the same days. Finance uses Mixpanel sign-ups, not the sign-ups the ad platforms report. |
| Cost per funded account | Spend for a paid channel over a sign-up period divided by that period's sign-ups from the channel who finished onboarding within 7 days. |

## Warehouse tables

Three tables come from the data warehouse, not from Mixpanel events. Each has one row per UTC day per dimension value for every day from 2026-06-04 to 2026-10-01 (120 days). They join to events on the UTC date of the event and on the named dimension.

In the warehouse, numeric columns are loaded as FLOAT64 (shown as FLOAT below). Count columns (withdrawals, sign-ups, clicks, impressions, volume in millions) always hold whole numbers, and raw file exports show them as integers.

### `market_prices_daily`

Daily market data for every coin Ledgerline lists, from the market data vendor's composite feed across major exchanges. It describes the whole crypto market, not trading on Ledgerline.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Trading day (00:00 to 23:59 UTC). |
| `asset` | STRING | — | `BTC`, `ETH`, `SOL`, `XRP`, `DOGE`, `ADA`, `AVAX`, `LINK`, `ONDO`. Matches `asset` on trading events. |
| `close_usd` | FLOAT | USD per coin | Price at 23:59 UTC. |
| `open_usd` | FLOAT | USD per coin | Price at 00:00 UTC (the previous day's close). |
| `high_usd`, `low_usd` | FLOAT | USD per coin | Highest and lowest price of the day. |
| `daily_return_pct` | FLOAT | percent | Close-to-close change. |
| `realized_vol_pct` | FLOAT | percent | Realized volatility of the day from intraday returns, in daily percent terms. The market team calls a day with BTC above about 4.5 "volatile" and below 3 "calm". |
| `global_spot_volume_usd_m` | FLOAT | USD millions | Spot trading volume for the coin across the major exchanges in the vendor's feed. |

Caveats: ONDO has market data for the whole window because it traded elsewhere before Ledgerline listed it on 2026-08-05. Ledgerline's own fill prices (`price_usd` on events) sit close to, but not exactly at, the vendor's prices.

### `chain_network_daily`

Daily blockchain network conditions and Ledgerline's withdrawal broadcasts by network, from the wallet infrastructure team's node monitoring.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Day. |
| `network` | STRING | — | `bitcoin`, `ethereum`, `solana`, `base`, `tron`. Matches `network` on withdrawal events. |
| `withdrawals_broadcast` | FLOAT | count | Withdrawals Ledgerline processed for the network that day: app withdrawals plus institutional API withdrawals. |
| `avg_network_fee_usd` | FLOAT | USD | Average network fee for a standard transfer on the network that day. |
| `median_confirmation_mins` | FLOAT | minutes | Median time for Ledgerline's broadcasts to confirm. |
| `failed_broadcast_rate` | FLOAT | share 0-1 | Share of Ledgerline's broadcasts that did not confirm and were returned to the customer. |
| `network_status` | STRING | — | `normal` or `congested`, as posted on Ledgerline's status page for that network. |

Caveats: institutional API withdrawals do not send a product event, so `withdrawals_broadcast` runs higher than the Mixpanel count of `withdrawal submitted` and does not track it exactly day to day. `failed_broadcast_rate` covers network failures only; withdrawals the customer cancelled or compliance held before broadcast are not failures here.

### `paid_marketing_daily`

Daily paid marketing cost by channel, from the ad platforms' and the affiliate network's billing exports. Each channel runs on a daily budget that the platform paces through the day; budgets are a little lower on Saturdays and Sundays. Spend is billed every day.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Spend day. |
| `acquisition_channel` | STRING | — | `paid_search`, `paid_social`, `influencer_affiliate`, or `app_store_ads`. Matches `acquisition_channel` on `account created`. |
| `spend_usd` | FLOAT | USD | Media spend (or creator and affiliate fees) billed for the day. |
| `platform_reported_signups` | FLOAT | count | Sign-ups the platform claims for the day. Platforms use their own attribution and usually claim more than Mixpanel records. |
| `clicks` | FLOAT | count | Clicks reported by the platform. |
| `impressions` | FLOAT | count | Impressions reported by the platform. |

Caveats: organic and referral have no media spend and are not in this table. Use Mixpanel sign-ups, not `platform_reported_signups`, for CAC.

## Analysis tips

- For a before/after question around a dated change, consider the market (prices and volatility move every day), weekday mix, the overall trend, and mix shifts before you attribute a change to the event.
- New customers keep joining through the window, so totals drift up over time. Compare rates, or fix the population (for example, established customers only), when you compare periods.
- New-customer funnels, conversion, and retention depend on sign-up date: customers who joined late in the window have had less time to act. Compare cohorts that joined in the same weeks.
- Customers place many orders and withdrawals. Per-order and per-withdrawal questions need `order_id` or `withdrawal_id` held constant; unique-customer funnels hide most of the difference between orders.
