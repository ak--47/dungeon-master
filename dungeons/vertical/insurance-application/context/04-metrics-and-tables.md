# Shieldstone metrics and warehouse tables

## KPI definitions

All KPIs use UTC days. People are counted by their merged identity (Mixpanel "Uniques"); anonymous shoppers count by device.

| KPI | Definition |
|---|---|
| Quote starts | Count of `quote started` (one per shopper). |
| Quote completion rate | Share of shoppers with `quote completed` within 1 day of `quote started`. |
| Purchase rate (bind rate) | Share of completed quotes followed by `policy purchased` within 14 days of `quote completed`. Count only quotes with a full 14 days of data (completed by September 17). |
| Time to purchase | Time from `quote completed` to `policy purchased` for shoppers who bought. Report the median. |
| New policies | Count of `policy purchased`. |
| Cost per quote | Spend for a paid channel divided by `quote started` from that channel (`acquisition_channel`) over the same days. |
| Cost per policy (CAC) | Spend for a paid channel divided by new policies bought by shoppers from that channel. Finance uses Mixpanel quote starts and purchases, not the conversions the ad networks report. |
| Claim cycle time | Per claim (hold `claim_id` constant), time from `claim submitted` to `claim settled`. Report the median; count only claims that had time to close (the claims team uses a 30-day window for auto and a 45-day window for property). |
| Snap & Settle adoption | Share of eligible auto claims (collision, glass, comprehensive) submitted since 2026-07-21 with `claim_channel = photo_estimate`. |
| Claim denial rate | Share of settled claims with `settlement_type = denied`. |
| Renewal retention | Per renewal notice (hold `policy_id` constant), the share of policies that renew. The term ends 30 days after `renewal offered`; use a 35-day window and only notices sent by August 31 (complete windows). |
| Non-renewal rate | Per renewal notice, the share followed by `policy cancelled` with `cancel_reason` in (`found_cheaper`, `price_increase`) within 35 days. |
| Payment failure rate | Failed scheduled payments divided by scheduled payments: `payment failed` (`is_retry = false`) / (`payment made` with `is_retry = false` + `payment failed` with `is_retry = false`). Billing reports it separately for autopay and manual payers. |
| Nonpayment cancellation rate | Share of failed scheduled payments followed by `policy cancelled` with `cancel_reason = nonpayment` on the same policy within 30 days. |
| Active customer | An identified customer with a website or app event in the period. Back-office events (`platform = server`: payments by autopay, renewal notices, renewals, cancellations, claim settlements, policy issue) do not count as activity. |
| Written premium | Premium for the full term of policies sold or renewed, by the day the policy was written, from `written_premium_daily`. Finance's revenue measure for growth. |

## Warehouse tables

Three tables come from the data warehouse, not from Mixpanel events. Each has one row per UTC day per dimension value for every day from 2026-06-04 to 2026-10-01 (120 days). Days with no activity have a row with zeros. They join to events on the UTC date of the event and on the named dimension.

In the warehouse, numeric columns are loaded as FLOAT64 (shown as FLOAT below). Count columns always hold whole numbers, and raw file exports show them as integers.

### `marketing_spend_daily`

Daily paid acquisition cost by channel, from the ad platforms' and comparison sites' billing exports.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Spend day. |
| `acquisition_channel` | STRING | — | `search_ads`, `comparison_site`, or `social_ads`. Matches `acquisition_channel` on `quote started`. |
| `spend_usd` | FLOAT | USD | Media spend billed for the day. Search and social run on daily budgets that the platform paces through the day (following the weekly rhythm, with a floor on quiet days) plus bids that rise and fall with the traffic delivered. Comparison sites bill per lead. |
| `clicks` | FLOAT | count | Ad clicks or click-throughs reported by the platform. |
| `impressions` | FLOAT | count | Ad impressions or listing views reported by the platform. |
| `conversions_reported` | FLOAT | count | Quote starts the platform claims (search and social, by their own attribution); for comparison sites, the leads they billed. Platforms usually claim more than Mixpanel records. |

Caveats: organic and referral have no media spend and are not in this table. Use Mixpanel quote starts and purchases, not `conversions_reported`, for cost per quote and per policy.

### `claims_operations_daily`

Daily claims operations by claims region, from the claims system and the adjuster scheduling tool.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Day. |
| `region` | STRING | — | `gulf_coast`, `south`, `midwest`, `west`, `northeast`. Matches `region` on claim events. |
| `new_claims_reported` | FLOAT | count | Claims reported that day through every channel: app, website, phone, and agents. |
| `claims_closed` | FLOAT | count | Claims closed (paid or denied) that day, every channel. |
| `open_claims` | FLOAT | count | Claims open at the end of the day, every channel. |
| `adjuster_hours` | FLOAT | hours | Adjuster hours worked on the region's claims that day: staff adjusters plus independent adjusters hired for catastrophes. |
| `catastrophe_code` | STRING | — | Industry catastrophe code when the day falls in a declared catastrophe reporting period for that region (for example `PCS-2614`), otherwise `none`. |

Caveats: phone and agent-reported claims are in this table but never in Mixpanel, so the counts run higher than Mixpanel claim events and do not match them day to day. A claim's region is the region of the customer's state.

### `written_premium_daily`

Daily written premium by product line and transaction type, from the policy administration and billing systems.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Day the policy was written (sold or renewed). |
| `product_line` | STRING | — | `auto`, `home`, `renters`. Matches `product_line` on events. |
| `transaction_type` | STRING | — | `new_business` (matches `policy purchased`) or `renewal` (matches `policy renewed`). |
| `written_premium_usd` | FLOAT | USD | Premium for the full term of the policies written that day. |
| `policies_written` | FLOAT | count | Policies written that day. |
| `rate_level_index` | FLOAT | index | The rate plan in force for this product and transaction type, relative to the plan at the start of the window (1.00). |

Caveats: billing includes a few policies sold or renewed by phone that are not in Mixpanel, nets out policies cancelled on their first day, and renewal premium includes mid-term adjustments made in billing. Use this table, not Mixpanel, for premium totals.

## Analysis tips

- Activity follows a weekly rhythm (busy weekdays, quiet weekends). Compare whole weeks or matching weekdays, not a few days against a span with a different mix of weekdays.
- For a before/after question around a dated change, consider the overall trend and mix shifts (product line, channel, region) before you attribute a change to the event.
- Purchases, renewals, claims, and payment outcomes take time to happen. Only count quotes, notices, claims, or failures whose follow-up window ends inside the data.
- Shoppers, policies, and claims are separate units. A customer can have two policies and several claims; hold `policy_id` or `claim_id` constant when the question is per policy or per claim.
- Quote events are anonymous; a quote funnel needs identity merging, and shoppers who never created an account count by device.
