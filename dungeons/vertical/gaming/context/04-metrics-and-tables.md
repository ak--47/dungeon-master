# Emberfall metrics and warehouse tables

## KPI definitions

All KPIs use UTC days and count people by unique `user_id`.

| KPI | Definition |
|---|---|
| Active player (DAU / WAU / MAU) | A player with `game launched` in the day, week, or month. A new player's first session starts with `account created` and has no `game launched`; Cinderlight's DAU does not count it. Experiment exposures are not activity. |
| New players | Unique players with `account created` in the period. |
| Veterans | Players who joined before June 4, 2026 (no `account created` in the window; `member_since` before June 4). |
| Tutorial completion | Share of new players who reach `tutorial completed` within 7 days of `account created`. |
| Retention (day N) | Of players who created an account, the share with `game launched` in the 24 hours starting N days after signup (Mixpanel Retention, "on" mode). For a bracket (for example day 7-13), the share with any `game launched` in the bracket. Count only players whose bracket ends inside the data. |
| Early guild rate | Share of new players who join a guild in their first days after `account created` (state the window you use). |
| Boss win rate | `boss fight` with `result = victory` divided by all `boss fight` events, per boss. Attempts, not players. |
| Clear rate | `dungeon finished` with `result = cleared` divided by all `dungeon finished` events. |
| Queue wait | For matchmade runs, time from `dungeon queued` to `dungeon started` with the same `run_id`. Report the median (Mixpanel Funnels median time to convert). |
| Runs per active player | `dungeon started` events divided by daily active players over the same days. |
| Payer | A player with at least one `purchase completed` in the period. |
| Payer share | Payers divided by active players. |
| ARPPU | Revenue divided by payers over the same period. |
| Revenue (Mixpanel) | Sum of `price_usd` on `purchase completed`. Use for product and segment analysis. |
| Gross bookings, net revenue | From `store_revenue_daily`. Finance reports these, not the Mixpanel sum. Net revenue = gross bookings − refunds − store fees. |
| CAC (paid) | Spend for a paid channel divided by new players Mixpanel recorded from that channel (`account created` with that `acquisition_channel`) over the same days. Marketing uses Mixpanel signups, not the installs the networks report. |
| Cost per tutorial finisher | Spend for a paid channel divided by that channel's new players who finished the tutorial within 7 days. |
| Peak concurrency (CCU) | `peak_concurrent_players` in `server_health_daily`. |
| Instance launch success | `instance_launch_success_rate` in `server_health_daily`. |

## Warehouse tables

Three tables come from the data warehouse, not from Mixpanel events. Each has one row per UTC day per dimension value for every day from 2026-06-04 to 2026-10-01 (120 days). Days with no activity have a row with zeros. They join to events on the UTC date of the event and on the named dimension.

In the warehouse, numeric columns are loaded as FLOAT64 (shown as FLOAT below). Count columns (installs, clicks, impressions, players, transactions) and seconds always hold whole numbers, and raw file exports show them as integers.

### `ua_spend_daily`

Daily paid acquisition cost by channel, from the ad networks' and creator agencies' billing exports. The campaigns are install-optimized. Part of each day's spend is a daily budget that the network paces through the day, following the weekly rhythm with a floor on quieter days. The rest is bid-based and rises and falls with the installs the network delivers that day.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Spend day. |
| `acquisition_channel` | STRING | — | `tiktok_ads`, `meta_ads`, `google_ads`, or `youtube_creators`. Matches `acquisition_channel` on `account created`. |
| `spend_usd` | FLOAT | USD | Media or sponsorship spend billed for the day. |
| `installs_reported` | FLOAT | count | Installs the network claims for the day. Networks use their own attribution and usually claim more than Mixpanel records as new accounts. |
| `clicks` | FLOAT | count | Ad clicks or taps reported by the network (for creators: link clicks). |
| `impressions` | FLOAT | count | Ad impressions (for creators: stream and video views attributed to the sponsorship). |

Caveats: organic players have no spend and are not in this table. Use Mixpanel signups, not `installs_reported`, for CAC.

### `server_health_daily`

Daily server health by region, from the operations team's monitoring and the public status page.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Day. |
| `server_region` | STRING | — | `NA`, `EU`, or `APAC`. Matches `server_region` on events. |
| `peak_concurrent_players` | FLOAT | players | Highest number of players online at the same time that day. |
| `instance_launch_success_rate` | FLOAT | share 0-1 | Share of dungeon instance launch requests that opened an instance. |
| `avg_queue_seconds` | FLOAT | seconds | Average group-finder wait for matchmade runs, across all roles. |
| `uptime_pct` | FLOAT | percent | Share of the day the region's game services were fully available. |
| `incident_severity` | STRING | — | `none`, `sev2` (degraded), or `sev1` (major outage), as posted on the status page. |

Caveats: concurrency is a peak, not a count of daily players; it does not track Mixpanel DAU exactly. `avg_queue_seconds` is a mean over all queued players, so a few long waits pull it up.

### `store_revenue_daily`

Daily store revenue by platform and product type, from Apple, Google, and Cinderlight's PC webshop billing records.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Purchase day. |
| `platform` | STRING | — | `pc`, `ios`, or `android`. Matches `platform` on `purchase completed`. |
| `product_type` | STRING | — | `embers`, `bundle`, or `ember_pass`. Matches `product_type` on `purchase completed`. |
| `gross_bookings_usd` | FLOAT | USD | What players paid that day, at list price. |
| `transactions` | FLOAT | count | Purchases billed that day. |
| `refunds_usd` | FLOAT | USD | Refunds granted that day. |
| `store_fees_usd` | FLOAT | USD | Fees kept by the store (Apple, Google) or the PC payment processor on that day's purchases, after refunds. |
| `net_revenue_usd` | FLOAT | USD | `gross_bookings_usd − refunds_usd − store_fees_usd`. What Cinderlight receives. |

Caveats: billing and Mixpanel differ day to day. Billing includes purchases that never reached Mixpanel (players who opted out of analytics, and clients that closed before the event was sent), so `transactions` and `gross_bookings_usd` run higher than the Mixpanel count and sum of `purchase completed`. Refunds appear only here. Use this table for gross, fees, and net; use Mixpanel for who bought what.

## Analysis tips

- For a before/after question around a dated change, consider the weekly rhythm, the overall trend, and mix shifts before you attribute a change to the event.
- Activity follows a weekly rhythm with busy weekends. Compare whole weeks or matching weekdays, not a few days against a span with a different mix of weekdays.
- New players keep arriving and many leave in their first weeks, so new-player totals and veteran totals move differently. Split them when you compare periods.
- New-player funnels and retention depend on signup date: players who joined late in the window have had less time to act. Compare cohorts that joined in the same weeks, and only count brackets that end inside the data.
- Per-attempt and per-run questions (win rates, clear rates, queue waits) need event-level rates, not unique-player funnels; one player can have hundreds of runs.
- A player can play on more than one platform. Platform breakdowns of events are by the device used for that event, not by player.
