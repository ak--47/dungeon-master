# Penny Harbor metrics and warehouse tables

## KPI definitions

All KPIs use UTC days and count people by unique `user_id`.

| KPI | Definition |
|---|---|
| New accounts | Unique members with `account opened` in the period. |
| Funded rate / onboarding completion | Share of new accounts that reach `account funded` after `account opened` → `identity verified`, in order, within 7 days of opening. |
| Time to fund | Per new member, time from `account opened` to `account funded`. Report the median. |
| Direct deposit adoption | Share of new accounts (or of funded new accounts; say which) with `direct deposit set up` within 14 days of `account opened`. Only count accounts opened at least 14 days before the end of the data. |
| Primary-account members | Members with direct deposit active (profile `direct_deposit_active`), or members with a `direct deposit received` in the period. |
| Active member | A member with at least one `app opened` in the period. Server events (deposits posting, AutoPay payments, Round-Up sweeps, repayments, ticket resolutions) do not make a member active. |
| Day-N retention | Of new members who opened their account on day 0, the share with an `app opened` in days N to N+6 after opening. Only count members who opened at least N+7 days before the end of the data. In Mixpanel Retention this needs custom brackets (for example day 7-13). |
| CAC (paid) | Spend for a paid channel divided by new accounts Mixpanel recorded from that channel (`account opened` with that `acquisition_channel`) over the same days. Finance uses Mixpanel accounts, not the installs the ad platforms report. |
| Cost per direct-deposit customer | Spend for a paid channel over a signup period divided by that period's new accounts from the channel that set up direct deposit within 14 days. |
| Card approval rate | Share of `card transaction` events with `authorization_status = approved`. |
| Round-Ups adoption | Share of members with approved card purchases in a period who also have a `savings deposit` with `source = round_up` in that period. |
| Manual saving rate | `savings deposit` events with `source = manual` per `app opened`, or per active member. |
| AutoPay adoption on new billers | Share of `biller added` events followed by `autopay enabled` with the same `biller_id` (same day). In Mixpanel Funnels: totals, hold `biller_id` constant. |
| Late payment rate | Share of `bill paid` events with `payment_status = late`. |
| Pocket net inflow | `deposits_usd` − `withdrawals_usd` from `pocket_savings_daily`. |
| Interest expense | `interest_paid_usd` from `pocket_savings_daily`. |
| Time to resolve | Per ticket, time from `support ticket opened` to `support ticket resolved` (same `ticket_id`). Report the median; `resolution_hours` on the resolution holds the same value. |

## Warehouse tables

Three tables come from the data warehouse, not from Mixpanel events. Each has one row per UTC day per dimension value for every day from 2026-06-04 to 2026-10-01 (120 days). They join to events on the UTC date of the event and on the named dimension.

In the warehouse, numeric columns are loaded as FLOAT64 (shown as FLOAT below). Count columns (installs, clicks, impressions, authorization attempts) and latency always hold whole numbers, and raw file exports show them as integers.

### `paid_acquisition_daily`

Daily paid acquisition cost by channel, from the ad platforms' billing exports. Each channel runs on automated bidding managed by the growth team, so the daily budget moves with recent performance. Ads serve every day, so spend is billed every day, including weekends.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Spend day. |
| `acquisition_channel` | STRING | — | `paid_social`, `search_ads`, `app_store_ads`, or `comparison_sites`. Matches `acquisition_channel` on `account opened`. |
| `spend_usd` | FLOAT | USD | Media spend billed for the day. |
| `platform_reported_installs` | FLOAT | count | Installs or sign-ups the ad platform claims for the day. Platforms use their own attribution and usually claim more than Mixpanel records. |
| `clicks` | FLOAT | count | Ad clicks reported by the platform. |
| `impressions` | FLOAT | count | Ad impressions reported by the platform. |

Caveats: organic and referral have no media spend and are not in this table. Referral bonuses are paid from a separate budget and are not included. Use Mixpanel accounts, not `platform_reported_installs`, for CAC.

### `card_authorizations_daily`

Daily card authorization health by payment channel, from the card processor's reporting portal and status page.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Day. |
| `payment_channel` | STRING | — | `chip`, `contactless_wallet`, `online`, or `atm`. Matches `payment_channel` on `card transaction`. |
| `auth_attempts` | FLOAT | count | Authorization requests the processor handled for Penny Harbor cards on that channel. |
| `approval_rate` | FLOAT | share 0-1 | Share of authorization requests approved, as reported by the processor. |
| `tokenization_error_rate` | FLOAT | share 0-1 | Share of wallet authorizations that failed because the processor could not validate the device token. Always 0 for channels that do not use tokens. |
| `processor_status` | STRING | — | Daily status for the channel's processing path: `operational` or `major_outage`, as posted on the processor's status page. |
| `p95_auth_latency_ms` | FLOAT | milliseconds | 95th-percentile authorization response time. |

Caveats: the processor sees authorizations the app never logs (incremental authorizations at gas pumps and hotels, stand-in authorizations, recurring merchant-initiated charges), so `auth_attempts` runs higher than the Mixpanel count of `card transaction` and does not track it exactly day to day. The processor's approval rate is computed on its own count.

### `pocket_savings_daily`

Daily Pocket activity by plan, from the core banking ledger.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Ledger day. |
| `plan_tier` | STRING | — | `free`, `plus`, or `premium`: the member's plan on that day. Matches `plan_tier` on events. |
| `deposits_usd` | FLOAT | USD | Money moved into Pockets that day. |
| `apy_pct` | FLOAT | percent per year | Pocket APY for the plan on that day (for example 3.5 = 3.50%). |
| `promo_code` | STRING | — | Rate promotion in effect for the plan that day, or `none`. |
| `withdrawals_usd` | FLOAT | USD | Money moved out of Pockets that day. |
| `interest_paid_usd` | FLOAT | USD | Interest accrued to members that day: the previous day's balance × APY / 365. |
| `pocket_balance_usd` | FLOAT | USD | Total Pocket balance for the plan at the end of the day. |

Caveats: `deposits_usd` includes ACH pulls into Pockets that members set up from other banks outside the app and is reduced by returned (failed) deposits, so it does not equal the sum of `savings deposit` amounts in Mixpanel.

## Analysis tips

- For a before/after question around a dated change, consider seasonality, weekday mix, the overall trend, and mix shifts before you attribute a change to the event. The member base grows through the period, so compare rates (per member, per visit) rather than raw totals.
- Members are most active on Fridays and least active on Sundays, and active hours run from US morning to late US evening (roughly 11:00 to 04:00 UTC). Compare whole weeks or matching weekdays.
- Server events follow the banking calendar: paychecks and AutoPay payments post on business days only, and Round-Up sweeps post the morning after the purchases. Count them by the day they posted.
- New-member funnels, conversion, and retention depend on signup date: members who joined late in the window have had less time to act. Compare cohorts that joined in the same weeks and exclude cohorts too young for the window you measure.
- Members add several billers and open several tickets. Per-biller and per-ticket questions need `biller_id` or `ticket_id` held constant; unique-member funnels count members, not billers or tickets.
- Use `plan_tier` on the event, not the profile's current plan, when a question depends on the plan at the time.
