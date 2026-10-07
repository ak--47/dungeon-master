# Ledgerline tracking plan (event dictionary)

Event names are lowercase, as tracked. Properties are flat on each event. Times are UTC.

## Properties on every event

| Property | Meaning |
|---|---|
| `time` | When the event happened (UTC). |
| `user_id` | The customer's ID. Present on every event. |
| `device_id` | The phone or tablet the event came from. A customer has about two devices. Missing on the onboarding steps after sign-up (sent server-side) and on a small share of recurring-buy events. |
| `insert_id` | Unique event ID used for de-duplication. |
| `session_id` | The app session the event belongs to (diagnostic; Mixpanel computes its own sessions). |
| `os` | `iOS`, `iPadOS`, or `Android`. Fixed per device. |
| `model`, `carrier`, `radio`, `screen_height`, `screen_width` | Device details from the mobile SDK. |
| `country`, `country_code`, `region`, `city` | Customer location (one location per customer). |

## Sign-up and onboarding

New customers go through onboarding once, right after they sign up. Identity verification and the first deposit are sent by the onboarding service with `user_id` only.

| Event | Meaning | Properties |
|---|---|---|
| `account created` | The customer creates an account. First event of every new customer and the moment their device is linked to their `user_id`. | `signup_method` (`email`, `google`, `apple`, `phone`; Sign in with Apple exists on iOS and iPadOS only); `acquisition_channel`: how the customer found us (`organic`, `referral`, `paid_search`, `paid_social`, `influencer_affiliate`, `app_store_ads`); same value as the profile property. |
| `identity verification started` | The customer submits an ID document and selfie. | `id_document_type` (`drivers_license`, `passport`, `national_id`). |
| `identity verified` | The verification vendor approves the customer. | none |
| `deposit completed` | Money arrives in the customer's Ledgerline account. The first one finishes onboarding (a funded account); later deposits are ordinary funding. | `deposit_method` (`bank_transfer`, `debit_card`, `crypto_transfer`, `wire`); `amount_usd`. |

## Browsing and sessions

| Event | Meaning | Properties |
|---|---|---|
| `app opened` | Start of an app session: the customer opens the app after 30 minutes or more without activity. Not sent for the sign-up session. | `entry_point` (`direct`, `widget`, `email_link`, `push_notification`). |
| `asset viewed` | The customer opens a coin's price page. | `asset`; `chart_range` (`1D`, `1W`, `1M`, `1Y`). |
| `portfolio viewed` | The customer opens their holdings. | `view` (`overview`, `asset_detail`, `performance`); `asset` when they opened a staked coin's detail. |
| `news article viewed` | The customer reads an in-app news article. | `topic` (`markets`, `bitcoin`, `ethereum`, `regulation`, `defi`, `learn`). |
| `referral link shared` | The customer shares their referral link. | `share_channel` (`sms`, `whatsapp`, `x`, `email`, `copy_link`). |

## Buying and trading

| Event | Meaning | Properties |
|---|---|---|
| `quick buy started` | The customer starts a Simple Buy order. | `order_id`; `asset` (`BTC`, `ETH`, `SOL`, `DOGE`, `XRP`). |
| `quick buy completed` | The Simple Buy order is filled. Same `order_id` as its start. An order that is abandoned or fails has no completed event. | `order_id`; `asset`; `amount_usd`; `fee_usd`; `price_usd` (fill price per coin); `payment_source` (`cash_balance`, `debit_card`, `bank_account`). |
| `trade executed` | An Advanced Trade order is filled. | `asset` (`BTC`, `ETH`, `SOL`, `XRP`, `DOGE`, `ADA`, `AVAX`, `LINK`, `ONDO`); `quote_currency` (`USD`, `USDC`); `side` (`buy`, `sell`); `order_type` (`market`, `limit`); `notional_usd`; `price_usd`; `fee_usd`. |
| `$experiment_started` | Mixpanel experiment exposure, sent once per customer at their first Simple Buy while the One-Tap Buy test is live (from 2026-07-08). | `Experiment name` = `One-Tap Buy`; `Variant name` = `Control` or `One-Tap`. |

## Recurring buys

| Event | Meaning | Properties |
|---|---|---|
| `recurring buy created` | The customer sets up a recurring buy plan. | `plan_id`; `asset` (`BTC`, `ETH`, `SOL`); `frequency` (`daily`, `weekly`, `biweekly`, `monthly`); `amount_usd` per purchase. |
| `recurring buy executed` | Server-side: a scheduled purchase runs. Keeps running until the plan is cancelled, whether or not the customer uses the app. | `plan_id`; `asset`; `frequency`; `amount_usd`; `price_usd`; `fee_usd`. |
| `recurring buy cancelled` | The customer cancels a plan. | `plan_id`; `asset`; `frequency`; `amount_usd`. |

Plans set up before June 4 have executions in the window but no `recurring buy created` event.

## Earn (staking)

| Event | Meaning | Properties |
|---|---|---|
| `stake started` | The customer stakes a coin. | `asset` (`ETH`, `SOL`, `ADA`, `AVAX`); `amount_usd`; `apy_pct`: the net annual yield shown at the time (after Ledgerline's commission). |
| `unstake requested` | The customer asks to unstake. Established customers can unstake coins they staked before June 4. | `asset`; `amount_usd`. |

## Alerts

| Event | Meaning | Properties |
|---|---|---|
| `price alert created` | The customer sets a price alert. | `asset`; `direction` (`above`, `below`); `threshold_pct`. |
| `price alert triggered` | Server-side: an alert fires and Ledgerline sends a push notification. | `asset`; `direction`; `move_pct`: the price move that triggered it. |

## Withdrawals

| Event | Meaning | Properties |
|---|---|---|
| `withdrawal submitted` | The customer submits a withdrawal to an outside wallet. Ledgerline broadcasts it to the network unless the customer cancels it or a compliance check holds it first (a few percent of withdrawals). | `withdrawal_id`; `asset` (`BTC`, `ETH`, `SOL`, `USDC`, `USDT`); `network` (`bitcoin`, `ethereum`, `solana`, `base`, `tron`); `amount_usd`; `network_fee_usd` (paid by the customer). |
| `withdrawal confirmed` | Server-side: the blockchain confirms the withdrawal. Same `withdrawal_id` as its submission. A withdrawal that never confirms (cancelled, held, or failed on the network) has no confirmed event; its funds return to the customer's balance. | `withdrawal_id`; `asset`; `network`; `confirmation_mins`: minutes from submission to confirmation. |

## User profile properties

| Property | Meaning |
|---|---|
| `investor_type` | `casual_investor`, `active_trader`, or `crypto_native` (see 01-business.md). |
| `acquisition_channel` | Channel at sign-up (same values as on `account created`). Established customers keep the channel recorded when they joined. |
| `customer_since` | Date the customer joined (UTC). On or after 2026-06-04 for new customers. |
| `kyc_status` | `verified`, `pending`, or `not_started`. |
| `Experiment: One-Tap Buy` | `Control` or `One-Tap` for customers enrolled in the test; missing otherwise. |
| `name`, `email`, `avatar` | Contact details. |
| `country`, `country_code`, `region`, `city` | Location. |

## Funnels the business tracks

| Funnel | Steps | Notes |
|---|---|---|
| Onboarding | `account created` → `identity verification started` → `identity verified` → `deposit completed` | New customers only. The business uses a 7-day conversion window. |
| Simple Buy | `quick buy started` → `quick buy completed` | Hold `order_id` constant and count totals to measure per order. |
| Advanced Trade | `asset viewed` → `trade executed` | Price page to fill. |
| Funding | `portfolio viewed` → `deposit completed` | Repeat deposits. |
| Earn | `asset viewed` → `stake started` | |
| Withdrawal | `withdrawal submitted` → `withdrawal confirmed` | Hold `withdrawal_id` constant and count totals to measure per withdrawal. |
