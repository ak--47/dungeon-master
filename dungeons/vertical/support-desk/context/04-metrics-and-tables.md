# Ticketloop metrics and warehouse tables

## KPI definitions

All KPIs use UTC days. Count people by unique `user_id` and companies by `company_id`.

| KPI | Definition |
|---|---|
| Tickets | Count of `ticket assigned`. A ticket that never reached an agent (spam, auto-closed, merged) is not a ticket in Mixpanel; see `inbound_channel_daily`. |
| First response time (FRT) | Per ticket, time from `ticket assigned` to the first `reply sent` (hold `ticket_id` constant). Report the median, in minutes. `first_response_mins` on `ticket resolved` and `csat received` holds the same value in whole minutes. |
| Resolution time | Per ticket, time from `ticket assigned` to the first `ticket resolved`. Report the median, in hours, within a 14-day window. `resolution_mins` on the first `ticket resolved` of a ticket holds the same value. A reopened ticket is resolved a second time, and that second `ticket resolved` carries the minutes to the later resolution. |
| Reopen rate | Share of resolved tickets that later have a `ticket reopened` (per ticket). Count only tickets whose reopen window has passed (customers can reopen a ticket days after it is resolved), so leave out tickets assigned in the last few weeks of the data. Counting events (total `ticket reopened` ÷ total `ticket resolved`) gives a lower number, because a reopened ticket is resolved twice. |
| Escalation rate | Share of tickets with a `ticket escalated`. |
| CSAT (positive share) | Share of `csat received` answers with `score` 4 or 5. Ticketloop also reports the average score. |
| Active user | A user with `queue viewed` in the period. Server-side events (`ticket assigned`, `ticket reopened`, `csat received`, `subscription started`) and `inbox connected` are not user activity. |
| Retention (new workspaces) | Of trial signups, the share with `queue viewed` in a later bracket after `account created` (for example day 30, or week 5). Count only signups whose bracket ends inside the data. In Mixpanel Retention this needs custom brackets. |
| Setup completion | Share of trial signups who reach `widget installed` (after `inbox connected`) within 7 days of `account created`. |
| Trial-to-paid conversion | Share of trial signups with `subscription started` within 30 days of `account created`. Count only signups with 30 days of data (signups through September 1). |
| Reply Assist adoption | Share of first replies on Growth and Enterprise tickets that have `reply_method = ai_draft`. |
| CAC (paid) | Spend for a paid channel divided by the trial signups Mixpanel recorded from that channel (`account created` with that `acquisition_channel`) over the same days. Finance uses Mixpanel signups, not the sign-ups the ad platforms report. |
| Cost per paying workspace | Spend for a paid channel divided by that channel's trial signups who bought a plan. |
| New MRR | New subscriptions' seats × list price per seat, from `subscription_billing_daily` (`new_mrr_usd`). Annual subscriptions count at their monthly equivalent. |

## Warehouse tables

Three tables come from the data warehouse, not from Mixpanel events. Each has one row per UTC day per dimension value for every day from 2026-06-04 to 2026-10-01 (120 days). Days with no activity have a row with zeros. They join to events on the UTC date of the event and on the named dimension.

In the warehouse, numeric columns are loaded as FLOAT64 (shown as FLOAT below). Count columns always hold whole numbers, and raw file exports show them as integers.

### `paid_marketing_daily`

Daily paid marketing cost by channel, from the ad platforms' billing exports, as each platform billed it.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Spend day. |
| `acquisition_channel` | STRING | — | `google_ads`, `capterra`, or `linkedin_ads`. Matches `acquisition_channel` on `account created`. |
| `spend_usd` | FLOAT | USD | Media spend billed for the day. |
| `signups_reported` | FLOAT | count | Trial sign-ups the ad platform claims for the day. Platforms use their own attribution and usually claim more than Mixpanel records. |
| `clicks` | FLOAT | count | Ad clicks reported by the platform. |
| `impressions` | FLOAT | count | Ad impressions reported by the platform. |

Caveats: organic, partner referral, and Shopify App Store have no media spend and are not in this table. Use Mixpanel signups, not `signups_reported`, for CAC.

### `inbound_channel_daily`

Daily health of ticket intake by channel, from the intake pipeline's logs and the public status page.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Day the pipeline processed the messages. |
| `channel` | STRING | — | `email`, `chat`, `web_form`, or `api`. Matches `channel` on `ticket assigned`. |
| `tickets_ingested` | FLOAT | count | Messages that became tickets in the pipeline that day, including tickets later closed as spam or auto-replies, and tickets merged into an existing ticket. Counted on the day they were processed. |
| `tickets_auto_closed` | FLOAT | count | Of those, tickets closed automatically (spam, out-of-office replies, notifications) and never assigned to an agent. |
| `tickets_merged` | FLOAT | count | Of those, tickets merged into an existing ticket and never assigned on their own. |
| `tickets_delayed_over_1h` | FLOAT | count | Messages received that day that waited more than one hour before they became tickets. Counted on the day they were received. |
| `p95_ingest_latency_sec` | FLOAT | seconds | 95th-percentile time from receiving a message to creating its ticket, over the messages received that day. |
| `ingestion_status` | STRING | — | Daily status for the channel: `operational` or `degraded`, as posted on the status page. |

Caveats: `tickets_ingested` runs higher than the Mixpanel count of `ticket assigned` and does not track it exactly day to day, because auto-closed and merged tickets are only in this table. Intake and routing also disagree a little each day: agents log some tickets by hand (phone calls, imports) that never pass through intake, and delete a few ingested tickets before they are routed. A message that is delayed is counted in `tickets_ingested` (and assigned in Mixpanel) on the day it is finally processed.

### `subscription_billing_daily`

Daily new subscriptions, seats, and new MRR by plan, from Ticketloop's billing system.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Subscription start day. |
| `plan` | STRING | — | `starter` or `growth`. Matches `plan` on `subscription started`. Enterprise contracts are booked by sales and are not in this table. |
| `seats_purchased` | FLOAT | count | Seats on the new subscriptions that day. |
| `new_subscriptions` | FLOAT | count | New subscriptions that day. |
| `list_price_per_seat_usd` | FLOAT | USD per seat per month | List price for a new subscription of this plan on this day. |
| `new_mrr_usd` | FLOAT | USD per month | `seats_purchased` × `list_price_per_seat_usd`. |

Caveats: the table covers new self-serve subscriptions only, not renewals, expansions, or Enterprise contracts. Annual plans are shown at their monthly list price; discounts are not applied. Billing and Mixpanel differ a little day to day: a few subscriptions bought on invoice never reach Mixpanel, seat counts can be edited before the first invoice, and a subscription cancelled on its first day is voided in billing but stays in Mixpanel. Use this table, not Mixpanel, for prices and MRR.

## Analysis tips

- For a before/after question around a dated change, consider the weekly rhythm, the overall trend, other changes in the same weeks, and mix shifts before you attribute a change to one event.
- Activity follows a weekly rhythm: weekdays are much busier than weekends. Compare whole weeks or matching weekdays.
- New trial workspaces keep arriving through the window, so totals tend to grow over time. Use rates (per ticket, per signup, per user) when you compare periods.
- Trial funnels, conversion, and retention depend on signup date: workspaces that signed up late in the window have had less time to act. Compare cohorts that signed up in the same weeks, and only count brackets that end inside the data.
- Each agent handles a stream of tickets. Per-ticket questions need `ticket_id` held constant (Totals counting); unique-user funnels hide most of the difference between tickets.
