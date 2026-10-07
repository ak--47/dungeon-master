# Hearthside metrics and warehouse tables

## KPI definitions

All KPIs use UTC days and count people by unique `user_id`. "Member actions" are all events except `notification received` and `report resolved`, which Hearthside's servers send.

| KPI | Definition |
|---|---|
| New members | Unique members with `account created` in the period. |
| Onboarding completion | Share of new members who reach `intro posted` after `account created` → `interests selected`, in order, within 7 days of signup. |
| Intro reply rate | Share of intros that receive a reply notification (`notification received` with `notification_type = reply`) within 24 hours. |
| Day-30 retention | Of new members who signed up on day 0, the share with any member action on or after day 30 ("on or after" / unbounded retention). Only count members who signed up at least 30 days before the end of the data (signups through August 31). The community team also reads a day 30-36 bracket (any member action in days 30 to 36); in Mixpanel Retention that needs a custom bracket. |
| Weekly active members (WAM) | Unique members with any member action in a calendar week (Monday start). In Mixpanel the team keeps a custom event "member action" that combines every event except `notification received` and `report resolved`. |
| Thread reply rate | Share of thread views (`discussion viewed`) followed by the same member's `comment posted` on the same `thread_id` within a day. In Mixpanel: Funnels, totals, hold `thread_id` constant, 1-day window. |
| Editor return rate | Of members who made their first wiki edit in the period, the share who edit again within 30 days. |
| Report resolution time | Per report, time from `report submitted` to `report resolved` (same `report_id`). Report the median; `resolution_hours` on the resolution holds the same value. Only count reports with enough time to resolve (filed at least a week before the end of the data). |
| Plus conversion | Share of `plus page viewed` visits followed by `plus subscribed` within a day (Funnels, totals, 1-day window). |
| Plus members | Members whose current `membership` is `plus`. |
| CAC (paid) | Spend for a paid channel divided by new members Mixpanel recorded from that channel (`account created` with that `acquisition_channel`) over the same days. Finance uses Mixpanel signups, not the signups the ad platforms report. |
| Cost per onboarded member | Spend for a paid channel divided by that channel's new members who completed onboarding (7-day window) over the same signup days. |
| Ad revenue | Sum of `ad_revenue_usd` in `ad_revenue_daily`. |
| RPM | Ad revenue per 1,000 ad-serving page views; the team also tracks revenue per 1,000 free-member article views (Mixpanel `article viewed` where `membership = free`). |

## Warehouse tables

Three tables come from the data warehouse, not from Mixpanel events. Each has one row per UTC day per dimension value for every day from 2026-06-04 to 2026-10-01 (120 days). They join to events on the UTC date of the event and on the named dimension.

In the warehouse, numeric columns are loaded as FLOAT64 (shown as FLOAT below). Count columns (signups, clicks, impressions, reports, removals) always hold whole numbers, and raw file exports show them as integers.

### `paid_marketing_daily`

Daily paid marketing cost by channel, from the ad platforms' billing exports. Each channel runs on a daily budget that the platform paces through the day, a little higher on weekends when fans are online. Spend is billed every day, including days with few signups.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Spend day. |
| `acquisition_channel` | STRING | — | `reddit_ads`, `tiktok_ads`, or `youtube_creators`. Matches `acquisition_channel` on `account created`. |
| `spend_usd` | FLOAT | USD | Media spend billed for the day. |
| `platform_reported_signups` | FLOAT | count | Signups the ad platform claims for the day. Platforms use their own attribution windows and usually claim more than Mixpanel records. |
| `clicks` | FLOAT | count | Ad clicks reported by the platform. |
| `impressions` | FLOAT | count | Ad impressions reported by the platform. |

Caveats: organic, friend invites, and app store signups have no media spend and are not in this table. Use Mixpanel signups, not `platform_reported_signups`, for CAC.

### `trust_safety_daily`

Daily trust and safety operations by hub, from the moderation back office.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Day. |
| `content_hub` | STRING | — | Hub. Matches `content_hub` on events. |
| `reports_received` | FLOAT | count | All reports received for the hub that day: in-product reports (the ones Mixpanel sees as `report submitted`) plus reports sent by email and by logged-out readers. |
| `spam_accounts_removed` | FLOAT | count | Accounts banned as spam or bots. |
| `automod_removals` | FLOAT | count | Posts removed automatically (keyword filters, and Hearth Guard once a community has it). |
| `raid_alert_level` | STRING | — | `normal` or `raid` (a coordinated attack on the hub was declared that day). |
| `volunteer_mod_hours` | FLOAT | hours | Hours volunteer moderators logged in the moderation tools for the hub. |

Caveats: `reports_received` runs higher than the Mixpanel count of `report submitted` and does not track it exactly day to day, because email and logged-out reports never reach Mixpanel. Banned accounts' activity is filtered out of Mixpanel.

### `ad_revenue_daily`

Daily display ad delivery and revenue by hub, from the ad server.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Day. |
| `content_hub` | STRING | — | Hub the pages belong to. Matches `content_hub` on `article viewed`. |
| `ad_impressions` | FLOAT | count | Ad impressions served on the hub's pages: pages seen by free members and by logged-out readers. |
| `ecpm_usd` | FLOAT | USD per 1,000 impressions | Average price advertisers paid that day. |
| `ad_revenue_usd` | FLOAT | USD | Revenue earned that day (`ad_impressions` / 1000 × `ecpm_usd`). |
| `fill_rate` | FLOAT | share 0-1 | Share of ad slots that were filled with a paid ad. |

Caveats: most ad-serving page views come from logged-out readers, who are not in Mixpanel, so impressions are many times the Mixpanel count of free-member `article viewed` events. Plus members see no ads. The ratio of impressions to Mixpanel free-member article views moves with the ad layout and the logged-out share, not only with member reading.

## Analysis tips

- For a before/after question around a dated change, consider seasonality, the weekly rhythm, the overall trend, other dated events nearby, and mix shifts before you attribute a change to the event.
- Activity is busiest on weekends and in the evenings of the Americas and Europe (UTC). Compare matching weekdays or whole weeks, not a few weekdays against a span that includes a weekend.
- The membership base is growing, so totals rise over the window. Use rates (per member, per search, per thread view) or a comparison group when you can.
- New-member funnels and retention depend on signup date: members who joined late in the window have had less time to act. Compare cohorts that joined in the same weeks and with the full window observed.
- Members open many threads and file several reports. Per-thread and per-report questions need `thread_id` or `report_id` held constant; unique-member funnels hide most of the difference.
- `membership` on an event is the membership at that moment; a member who subscribed during the window has free events before and Plus events after.
