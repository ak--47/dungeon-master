# Murmur metrics and warehouse tables

## KPI definitions

All KPIs use UTC days and count people by unique `user_id`.

| KPI | Definition |
|---|---|
| Active member | A member with at least one member-initiated event in the period: any event except `push notification sent` and `$experiment_started` (both are server-side). DAU, WAU, and MAU use this definition. |
| New members | Unique members with `account created` in the period. |
| Onboarding completion | Share of new members with an onboarding `user followed` (`discovery_source = onboarding_suggestions`) within 1 day of `account created`. Members who skip the suggestions screen do not complete. |
| Onboarding follows | Number of onboarding `user followed` events per new member (0 if they skipped the screen). |
| New-member retention | Of new members who signed up on day 0, the share with any member-initiated event on day 14-27 after signup. Count only members whose bracket ends inside the data (signups through 2026-09-03). In Mixpanel Retention this needs a custom bracket and a return event of "any event" with the two server-side events excluded. |
| Time to first post | Hours from `account created` to the first `post created`. Report the median; read with a 7-day window and signups through 2026-09-24. |
| Clips share | Share of `post viewed` (or `post created`) events with `post_type = clip`. |
| Push open rate | `push notification opened` / `push notification sent` over the same pushes (match on `notification_id`, or compare totals over the same days and members). |
| Pushes per member | `push notification sent` events per member over the period. |
| Paywall conversion | `circle subscription started` / `circle paywall viewed`, by `paywall_trigger` when the entry point matters. |
| Circle bookings (first month) | New Circle subscriptions x the tier's monthly price (01-business.md). Murmur's take is the platform fee in force on the subscription date (20% before 2026-08-12, 10% from that day). Renewals are not in Mixpanel. |
| CAC (paid) | Spend for a paid channel (`marketing_spend_daily`) divided by new members Mixpanel recorded from that channel (`account created` with that `acquisition_channel`) over the same days. Finance uses Mixpanel signups, not the installs the networks report. |
| Cost per retained member | CAC divided by that channel's new-member retention (day 14-27). |
| Ad load | `ad viewed` events per `post viewed` event, by `ad_placement`. Feed and Clips ad load is measured per post viewed; Stories ad load per `story viewed`. |
| eCPM | Ad revenue per 1,000 impressions served, from `ad_revenue_daily`. |
| Ad revenue per 1,000 post views | `ad_revenue_usd` (feed and Clips placements) per 1,000 Mixpanel `post viewed` events over the same days. |
| Feed reliability | 1 − `error_rate` in `for_you_feed_health_daily`. |

## Warehouse tables

Three tables come from the data warehouse, not from Mixpanel events. Each has one row per UTC day per dimension value for every day from 2026-06-04 to 2026-10-01 (120 days). Days with no activity have a row with zeros. They join to events on the UTC date of the event and on the named dimension.

In the warehouse, numeric columns are loaded as FLOAT64 (shown as FLOAT below). Count columns (impressions, clicks, installs, requests) always hold whole numbers, and raw file exports show them as integers.

### `marketing_spend_daily`

Daily paid acquisition cost by channel, from the ad networks' billing exports and the creator partnership payouts ledger. Part of each day's spend is a daily budget paced through the day, following the weekly rhythm with a floor on quieter days. The rest is performance-based and rises and falls with the signups the channel delivers that day (for creator partnerships, a payout per referred signup).

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Spend day. |
| `acquisition_channel` | STRING | — | `meta_ads`, `tiktok_ads`, or `creator_partnerships`. Matches `acquisition_channel` on `account created`. |
| `spend_usd` | FLOAT | USD | Spend billed for the day. |
| `impressions` | FLOAT | count | Ad or post impressions reported by the network or partner. |
| `clicks` | FLOAT | count | Clicks or taps on the ad or referral link. |
| `installs_reported` | FLOAT | count | App installs the network or partner claims for the day. Networks use their own attribution and usually claim more than Mixpanel records as signups. |

Caveats: organic and friend invites have no media spend and are not in this table. Use Mixpanel signups, not `installs_reported`, for CAC.

### `for_you_feed_health_daily`

Daily health of the For You feed service by app platform, from the feed API's request logs and the public status page. One feed request returns a page of several posts; the app also prefetches pages it may not show.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Day. |
| `platform` | STRING | — | `ios` or `android`. Matches `platform` on events. |
| `feed_requests` | FLOAT | count | For You page requests from that platform's app, including failed requests and requests from members who opted out of analytics. |
| `failed_requests` | FLOAT | count | Requests that returned an error. |
| `error_rate` | FLOAT | share 0-1 | `failed_requests` / `feed_requests`. |
| `p95_latency_ms` | FLOAT | milliseconds | 95th-percentile response time. |
| `service_status` | STRING | — | Daily status for the platform: `operational` or `major_outage`, as posted on the status page. |

Caveats: requests are pages, not posts, so `feed_requests` is much smaller than the Mixpanel count of For You `post viewed` and does not track it exactly day to day. A failed feed load shows no posts, so it fires no `post viewed`.

### `ad_revenue_daily`

Daily ad delivery and revenue by placement, from the ad server.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Day. |
| `ad_placement` | STRING | — | `feed`, `stories`, or `clips`. Matches `ad_placement` on `ad viewed`. |
| `impressions_served` | FLOAT | count | Impressions the ad server counted for the placement. |
| `ecpm_usd` | FLOAT | USD per 1,000 impressions | Average price per 1,000 impressions that day. 0 for Clips before Clips launched. |
| `ad_revenue_usd` | FLOAT | USD | `impressions_served` x `ecpm_usd` / 1,000. |

Caveats: the ad server counts impressions for members who opted out of analytics, and its invalid-traffic filter and late logs move each day's count, so `impressions_served` runs a few percent above Mixpanel `ad viewed` and does not match it day to day. Use this table, not Mixpanel, for prices and revenue.

## Analysis tips

- For a before/after question around a dated change, consider the weekly rhythm, the overall trend, and mix shifts before you attribute a change to the event.
- Activity follows a weekly rhythm (weekends are a little busier). Compare whole weeks or matching weekdays.
- New members keep arriving through the window, so totals tend to grow over time. Use rates (per post view, per paywall view, per push, per active member) when you compare periods.
- New members and established members do not use the app the same way. When the share of new members changes, all-member averages can move even when no one's behavior did.
- New-member funnels, conversion, and retention depend on signup date: members who joined late in the window have had less time to act. Compare cohorts that joined in the same weeks, and only count brackets that end inside the data.
- Pushes are sent server-side. Do not count them, or experiment exposures, as activity.
