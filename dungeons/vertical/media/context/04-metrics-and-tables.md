# The Lantern metrics and warehouse tables

## KPI definitions

All KPIs use UTC days. Count people with Mixpanel Uniques (resolved identity: an anonymous visitor who registers counts once).

| KPI | Definition |
|---|---|
| New visitors | Unique readers whose first article in the data is anonymous (`article viewed` with `reader_tier = anonymous`). Each new visitor has exactly one anonymous article view. |
| Registration rate | Share of new visitors who fire `account registered` within 7 days of their first article. Count only visitors with a full 7 days of data (first visit on or before September 24). |
| Time to register | Hours from a new visitor's first article to `account registered`. Report the median. |
| Attempted reads | `article viewed` + `paywall shown`. A free reader's blocked attempt fires `paywall shown` instead of `article viewed`, so article views alone undercount free readers' demand. |
| Paywall conversion | `subscription started` events divided by `paywall shown` events over the same period and segment. The audience team reports it per paywall view, not per reader. |
| New subscriptions | Count of `subscription started`, by `plan`, `billing_period`, and `offer`. |
| Cancellations | Count of `subscription cancelled`. A subscriber can cancel and later subscribe again. |
| Monthly churn | Of subscribers who were paid for the whole prior calendar month (no subscription start or cancellation in it), the share who cancel during the month. |
| Reading days | Distinct UTC days with at least one `article viewed` in a period. |
| Active reader | A reader with `article viewed` in the period. Newsletter opens, push alert opens, and podcast plays alone do not make a reader active. |
| Home-feed click-through | `recommendation clicked` with `module = home_feed` divided by `front page viewed` with `page = home`, over the same readers and period. |
| Share rate | `article shared` per attempted read (or per article view for subscribers, who never hit the paywall). |
| Read time | Average `read_time_sec` on `article viewed`. |
| Section mix | Share of `article viewed` by `section`. |
| CAC (paid) | Spend for a paid channel divided by the new visitors or the registrations Mixpanel recorded from that channel (`acquisition_channel`) over the same days. Finance uses Mixpanel counts, not the clicks the ad networks report. |
| First-period bookings | New subscriptions × `first_period_price_usd` on the start date, from `subscription_billing_daily`. This is the cash the first billing period brings in; renewals are not included. |
| List-price value | New subscriptions × `list_price_usd`: what the same subscriptions are worth at renewal. |

## Warehouse tables

Three tables come from the data warehouse, not from Mixpanel events. Each has one row per UTC day per dimension value for every day from 2026-06-04 to 2026-10-01 (120 days). Days with no activity have a row with zeros. They join to events on the UTC date of the event and the named dimension.

Column types below are the warehouse load types: INTEGER (INT64) for counts, page load times, and whole-dollar prices and bookings; FLOAT (FLOAT64) for spend and rates.

### `marketing_spend_daily`

Daily paid marketing cost by channel, from the ad networks' billing exports. The campaigns are bought per visit. Part of each day's spend is a daily budget that the network paces through the week; the rest rises and falls with the visits the network delivers that day.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Spend day. |
| `acquisition_channel` | STRING | — | `google_ads`, `meta_ads`, or `podcast_ads`. Matches `acquisition_channel` on events. |
| `spend_usd` | FLOAT | USD | Media spend billed for the day. |
| `clicks` | INTEGER | count | Clicks the network reports (for podcast ads: visits to the vanity URL reported by the podcast network). Networks count clicks that never load an article, so this runs above the visitors Mixpanel records. |
| `impressions` | INTEGER | count | Ad impressions (for podcast ads: episode downloads carrying the ad). |

Caveats: organic search, unpaid social, and direct have no media spend and are not in this table. Use Mixpanel new visitors and registrations, not `clicks`, for CAC.

### `platform_reliability_daily`

Daily health of the reading platforms, from the engineering team's server logs and the public status page.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Day. |
| `platform` | STRING | — | `web`, `ios_app`, or `android_app`. Matches `platform` on events. |
| `pageviews_served` | INTEGER | count | Article pages the servers delivered on that platform. Includes readers whose browsers block analytics (common on the web), readers who opted out of tracking in the apps, and some automated traffic, so it runs above the Mixpanel count of `article viewed` and does not track it exactly day to day. |
| `meter_error_rate` | FLOAT | share 0-1 | Share of meter checks (does this free reader still have free articles?) that failed. A failed check lets the article through. |
| `p75_page_load_ms` | INTEGER | milliseconds | 75th-percentile time for an article page to load. |
| `service_status` | STRING | — | Daily status for the platform: `operational` or `major_outage`, as posted on the status page. |

### `subscription_billing_daily`

Daily new subscriptions, prices, and first-period bookings by plan and billing period, from The Lantern's billing system and the app stores.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Subscription start day. |
| `plan` | STRING | — | `digital` or `all_access`. Matches `plan` on `subscription started`. |
| `billing_period` | STRING | — | `monthly` or `annual`. Matches `billing_period` on `subscription started`. |
| `new_subscriptions` | INTEGER | count | New subscriptions that day. |
| `list_price_usd` | INTEGER | USD per billing period | List price for this plan and period. |
| `first_period_price_usd` | INTEGER | USD | What a new subscriber of this plan and period paid for the first billing period that day (list price, or the promotional price during a promotion). |
| `gross_bookings_usd` | INTEGER | USD | `new_subscriptions` × `first_period_price_usd`. |

Caveats: the table covers new subscriptions only, not renewals or cancellations. Billing and Mixpanel differ a little day to day: a few purchases made through the app stores never reach Mixpanel, and same-day refunds are netted out of billing. Use this table, not Mixpanel, for prices and bookings.

## Analysis tips

- For a before/after question around a dated change, consider the weekly rhythm, the overall trend, and mix shifts before you attribute a change to the event.
- Readership follows a weekly rhythm. Compare whole weeks or matching weekdays, not a few days against a span with a different mix of weekdays.
- New readers keep arriving and free readers keep converting, so totals and tier mixes drift over the window. Use rates (per paywall view, per home view, per attempted read, per visitor) when you compare periods or groups.
- The meter caps free readers' article views. Questions about free readers' reading usually need attempted reads, not article views alone.
- New-visitor funnels and retention depend on arrival date: readers who arrived late in the window have had less time to act. Only count windows that end inside the data.
- Anonymous visitors exist only as devices. Uniques that include them count devices for visitors who never registered.
