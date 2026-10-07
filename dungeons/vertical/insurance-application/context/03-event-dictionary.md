# Shieldstone tracking plan (event dictionary)

Event names are lowercase, as tracked. Properties are flat on each event. Times are UTC.

## Properties on every event

| Property | Meaning |
|---|---|
| `time` | When the event happened (UTC). |
| `user_id` | The customer's ID. Missing on anonymous quote events (see Identity in 00-manifest.md). |
| `device_id` | The device (browser or app install). Present on website and app events, including anonymous quote events. Missing on back-office events. |
| `insert_id` | Unique event ID used for de-duplication. |
| `platform` | `web` (computer browser), `ios` (iPhone or iPad app), `android` (Android app), or `server` (back-office systems: policy administration, billing, claims). |
| `state` | The customer's state (two-letter code), from their address. Fixed per person. |
| `os`, `model`, `screen_height`, `screen_width`, `carrier`, `radio` | Device details from the SDK, on events that carry a `device_id`. `os` is `iOS`, `iPadOS`, `Android`, `Windows`, `macOS`, or a Linux variant. |

## Shopping: quote and purchase (new customers)

A shopper goes through these once. The first two events (and the experiment exposure) happen before the shopper has an account.

| Event | Meaning | Properties |
|---|---|---|
| `quote started` | A shopper starts a quote. Anonymous (device only). | `product_line` (`auto`, `home`, `renters`); `acquisition_channel` (`search_ads`, `comparison_site`, `social_ads`, `organic`, `referral`); `quote_flow` (`standard` or `express`, see 02-timeline.md). |
| `$experiment_started` | Mixpanel experiment exposure for the Express Quote test, sent one second before `quote started` for shoppers who started on or after 2026-07-08. | `Experiment name` = `Express Quote`; `Variant name` = `Control` or `Express Quote`. |
| `quote completed` | The shopper answers every question and sees a price. Anonymous (device only). | `product_line`; `acquisition_channel`; `quote_flow`; `coverage_tier` (`basic`, `standard`, `premium`); `quoted_premium_monthly` (USD per month); `shopping_reason` (`switching`, `life_change`, `first_policy`). |
| `account created` | The shopper creates an account, to save the quote or to buy it. This is the moment the device is linked to the new `user_id`. Comes a few minutes after `quote completed`. | `signup_method` (`email`, `google`, `apple`); `acquisition_channel`; `product_line`. |
| `policy purchased` | A new policy is issued (sent by the policy administration system; `platform = server`). | `policy_id`; `product_line`; `coverage_tier`; `premium_monthly`; `term_months` (6 for auto, 12 for homeowners and renters); `term_premium_usd` (premium for the whole term); `payment_plan` (`monthly`, `paid_in_full`); `autopay` (true/false); `transaction_type` = `new_business`; `acquisition_channel`; `shopping_reason`. |

A few customers who quoted in late May (before the window) bought their policy in early June; they have a `policy purchased` event but no quote events in the window.

## Account activity (customers)

| Event | Meaning | Properties |
|---|---|---|
| `app opened` | The customer opens the app or logs in on the website. | `open_source` (`organic`, `push_notification`, `email_link`). |
| `policy viewed` | The customer looks at a policy. | `product_line`; `section` (`overview`, `coverages`, `drivers_vehicles_property`, `discounts`). |
| `billing viewed` | The customer opens billing. | `billing_section` (`next_payment`, `payment_history`, `payment_methods`). |
| `id card viewed` | The customer opens their auto ID card (auto customers only). | `card_format` (`in_app`, `wallet_pass`, `pdf`). |
| `documents viewed` | The customer opens a document. | `document_type` (`declarations_page`, `policy_contract`, `billing_statement`, `claim_letter`). |
| `coverage changed` | The customer changes a policy (an endorsement). | `product_line`; `change_type` (`change_deductible`, `add_vehicle`, `remove_vehicle`, `add_driver`, `add_endorsement`, `update_address`). |
| `support chat started` | The customer starts a chat with customer care. | `topic` (`billing`, `policy_change`, `coverage_question`, `claims`, `technical`). |
| `roadside assistance requested` | The customer asks for roadside help (auto customers only). | `service_type` (`tow`, `jump_start`, `flat_tire`, `lockout`, `fuel_delivery`). |

## Billing and policy lifecycle

Every event here carries `policy_id` and `product_line`.

| Event | Meaning | Properties |
|---|---|---|
| `payment made` | A payment is collected. Autopay draws are posted by billing (`platform = server`, early morning UTC on the due date); manual payments come from the website or app. The first payment of a new policy is taken at purchase by the policy system (`platform = server`), whatever the payment method. | `amount_usd`; `payment_method` (`autopay_card`, `autopay_bank`, `card`, `bank_transfer`); `is_retry` (true when it pays a bill that failed earlier). |
| `payment failed` | A payment attempt fails. Autopay failures come from billing (`platform = server`); manual failures from the website or app. | `amount_usd`; `payment_method`; `is_retry` (true when the automatic retry of an autopay draw fails too); `failure_reason` (`card_declined`, `insufficient_funds`, `card_expired`, `bank_returned`). |
| `renewal offered` | Billing sends the renewal notice, 30 days before the term ends (`platform = server`). | `current_premium_monthly`; `renewal_premium_monthly`; `premium_change_pct` (renewal premium vs current, in percent); `is_bundled` (true if the customer holds two lines); `term_months`. |
| `policy renewed` | The policy renews at the end of the term (`platform = server`). | `premium_monthly`; `term_months`; `transaction_type` = `renewal`; `term_premium_usd`; `is_bundled`. |
| `policy cancelled` | The policy ends before its term is up (`platform = server`). | `cancel_reason` (`found_cheaper`, `price_increase`, `nonpayment`, `sold_vehicle`, `moved`, `no_longer_needed`); `is_bundled`. A customer who decides not to renew cancels during the 30 days after the renewal notice, with reason `found_cheaper` or `price_increase`. |

## Claims

Every claim event carries `claim_id`.

| Event | Meaning | Properties |
|---|---|---|
| `claim started` | The customer starts reporting a claim (first notice of loss). | `product_line`; `peril` (auto: `collision`, `glass`, `comprehensive`, `theft`, `liability`; homeowners and renters: `water`, `wind_hail`, `fire`, `theft`, `liability`). |
| `claim photos uploaded` | The customer adds photos to the claim. | `photo_count`. |
| `claim submitted` | The customer submits the claim. | `product_line`; `peril`; `claim_channel` (`adjuster_inspection` or `photo_estimate`, see Snap & Settle in 02-timeline.md); `region` (claims region of the customer's state); `estimated_loss_usd` (the customer's estimate). |
| `claim status checked` | The customer checks the claim status. | `claim_status` (`under_review`, `inspection_scheduled`, `estimate_ready`). |
| `claim settled` | The claim is closed with a payment or a denial (`platform = server`, during the claims team's working hours). | `product_line`; `peril`; `claim_channel`; `region`; `settlement_type` (`paid` or `denied`); `payout_usd` (0 when denied); `days_open` (days from submission to settlement). |

Some claims reported in May were still open in June; their June events (status checks, settlement) appear without the earlier steps.

## User profile properties

Profiles exist for identified people only (customers and shoppers who created an account).

| Property | Meaning |
|---|---|
| `distinct_id` | The person's ID (same as `user_id` on events). |
| `name`, `email`, `avatar` | Contact details. |
| `created` | For people who first appeared in the window: when they started their first quote. Empty for customers from before June 4. |
| `state`, `region` | Address state and its claims region (`gulf_coast`, `south`, `midwest`, `west`, `northeast`). |
| `age_band` | `18-24`, `25-34`, `35-44`, `45-54`, `55-64`, `65+`. |
| `product_lines` | Lines held at the end of the window (`auto`, `home`, `renters`, `auto+home`, `auto+renters`); for cancelled customers the lines they last held; for prospects the line they quoted. |
| `bundle` | `true` if the customer held two active policies at the end of the window. |
| `autopay` | `true` if the customer pays by autopay. |
| `customer_status` | `active` (at least one policy in force on October 1), `cancelled` (all policies ended), or `prospect` (created an account but never bought). |
| `customer_since` | Date of the customer's first policy. Empty for prospects. |
| `acquisition_channel` | How the person first found Shieldstone (same values as on quote events). |
| `shopping_reason` | The reason given in the quote flow (`switching`, `life_change`, `first_policy`). |
| `Experiment: Express Quote` | `Control` or `Express Quote` for identified shoppers in the test; empty for everyone else. |
| `_persona` | Engagement segment from the CRM (`app_regular`, `typical`, `set_and_forget`). |
| `anonymousIds` | Devices seen for the person (pipeline metadata). |

## Funnels the business tracks

| Funnel | Steps | Notes |
|---|---|---|
| Quote to purchase | `quote started` → `quote completed` → `account created` → `policy purchased` | New shoppers. Needs identity merging (the first steps are anonymous). The growth team reads quote completion with a 1-day window and purchase with a 14-day window from `quote completed`. |
| Claim cycle | `claim submitted` → `claim settled` | Hold `claim_id` constant. Report the median time to convert. |
| Renewal | `renewal offered` → `policy renewed` (or → `policy cancelled`) | Hold `policy_id` constant. The term ends 30 days after the notice; use a 35-day window. |
| Payment recovery | `payment failed` → `payment made` (or → `policy cancelled`) | Hold `policy_id` constant. |
