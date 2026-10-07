# Penny Harbor tracking plan (event dictionary)

Event names are lowercase, as tracked. Properties are flat on each event. Times are UTC.

**Who sends the event.** "App" events are sent by the iOS or Android app when the member does something and carry `user_id`, `device_id`, and device details. "Server" events are sent by Penny Harbor's back end when money posts or a back-office step completes; they carry `user_id` only and no device fields, and they keep arriving even when a member has stopped opening the app.

## Properties on every event

| Property | Meaning |
|---|---|
| `time` | When the event happened (UTC). For server events, when the money posted or the step completed. |
| `user_id` | The member's ID. Present on every event. |
| `device_id` | The device the event came from. App events only. Members use about two devices on average. |
| `insert_id` | Unique event ID used for de-duplication. |
| `session_id` | Pipeline field grouping events close in time (diagnostic; Mixpanel computes its own sessions). Present on every event, including server events. |
| `plan_tier` | The member's plan **at the moment of the event**: `free`, `plus`, or `premium`. It changes at the moment a member upgrades. |
| `country`, `country_code`, `region`, `city` | Member location (United States; one location per member). |
| `os`, `model`, `screen_height`, `screen_width`, `carrier`, `radio` | Device details (`os` is `iOS`, `iPadOS`, or `Android`). App events only; fixed per device. |

## Opening an account (onboarding)

New members go through these three steps once, when they join. The steps happen only during onboarding.

| Event | Sender | Meaning | Properties |
|---|---|---|---|
| `account opened` | App | The applicant submits the account application. First event of every new member and the moment their device is linked to their `user_id`. | `signup_method` (`email`, `apple`, `google`); `acquisition_channel`: how the member found us (`organic`, `referral`, `paid_social`, `search_ads`, `app_store_ads`, `comparison_sites`), same value as the profile property. |
| `identity verified` | Server | Identity verification passed (KYC). | `kyc_method`: `instant_match` (verified automatically against credit bureau and identity databases) or `document_scan` (the applicant uploaded a photo ID and selfie, which the operations team reviewed). |
| `account funded` | Server | The first money arrived in the account. Onboarding ends here. | `funding_method` (`bank_link`, `debit_card`, `p2p_in`, `cash_load`); `amount` (USD). |

## Everyday banking

| Event | Sender | Meaning | Properties |
|---|---|---|---|
| `app opened` | App | The member opens the app. This is the event Penny Harbor uses for "active". | `entry_point` (`icon`, `widget`, `notification`, `deeplink`). |
| `balance checked` | App | The member views a balance screen. | `available_balance_usd`: the available balance shown (0 for accounts that were never funded); `account_view` (`overview`, `checking`, `pockets`). |
| `card transaction` | App (card feed) | A debit card authorization: a purchase or an ATM withdrawal, approved or declined. | `transaction_type` (`purchase`, `atm_withdrawal`); `amount` (USD); `merchant_category` (`grocery`, `dining`, `gas`, `retail`, `online_shopping`, `subscriptions`, `travel`, `entertainment`, `health`, or `cash` for ATMs); `merchant_name`; `payment_channel` (`chip`, `contactless_wallet` for Apple Pay / Google Pay, `online`, `atm`); `authorization_status` (`approved`, `declined`); `decline_reason` on declines only (`insufficient_funds`, `suspected_fraud`, `incorrect_pin`, `merchant_blocked`, `card_locked`, `technical_error`). |
| `card locked` | App | The member locks their card. | `reason` (`misplaced`, `lost`, `suspicious_activity`, `travel`). |
| `transfer sent` | App | The member sends money. | `transfer_type` (`p2p`, `external_bank`); `speed` (`standard`, `instant`); `amount` (USD); `instant_fee_usd` (0 for standard); `recipient_type` (`friend`, `family`, `landlord`, `self`, `business`). |

## Getting paid and Float

| Event | Sender | Meaning | Properties |
|---|---|---|---|
| `direct deposit set up` | App | The member switches a paycheck or other recurring deposit to Penny Harbor. Members who joined before June 4 and already had direct deposit have no such event in the window. | `setup_method` (`payroll_connect`: logged in to their payroll provider in the app; `form_download`: downloaded a pre-filled form for their employer). |
| `direct deposit received` | Server | A direct deposit posted to the account. Posts on business days only (see the banking calendar in `02-timeline.md`). | `amount` (USD); `pay_frequency` (`weekly`, `biweekly`, `semimonthly`); `payer_type` (`employer_payroll`, `gig_platform`, `government_benefit`). |
| `float advance taken` | App | The member takes a Float cash advance. Requires direct deposit. | `amount` (USD); `float_limit_usd`: the member's limit at the time (depends on plan). |
| `float advance repaid` | Server | A Float advance is repaid automatically from the member's next direct deposit, a few minutes after it posts. | `amount` (USD). |

## Saving, budgeting, investing

| Event | Sender | Meaning | Properties |
|---|---|---|---|
| `savings deposit` | App (manual) or Server (Round-Ups) | Money moved into a Pocket. | `source`: `manual` (the member moved money in the app; app event) or `round_up` (the morning sweep of the previous day's spare change; server event, from 2026-07-14); `amount` (USD); `pocket_type` (`emergency`, `vacation`, `home`, `car`, `general`, or `round_ups` for Round-Up sweeps). |
| `round-ups enabled` | App | The member turns on Round-Ups. Once per member. | `roundup_multiplier` (1, 2, or 3: spare change is multiplied before the sweep). |
| `budget created` | App | The member creates a monthly budget for a category. | `category` (`groceries`, `dining`, `transport`, `shopping`, `entertainment`, `bills`, `subscriptions`); `monthly_limit` (USD). |
| `investment order placed` | App | A Harbor Invest order. | `asset_type` (`stock`, `etf`, `bond_fund`); `side` (`buy`, `sell`); `amount` (USD). |

## Bill Pay

Every biller has a `biller_id`. The biller's AutoPay event and every payment to it share that `biller_id`.

| Event | Sender | Meaning | Properties |
|---|---|---|---|
| `biller added` | App | The member adds a biller. | `biller_id`; `biller_category` (`rent`, `utilities`, `mobile_phone`, `internet`, `insurance`, `credit_card`, `streaming`, `loan`). |
| `autopay enabled` | App | The member turns on AutoPay for a biller, usually on the add-biller screen right after adding it. | `biller_id`; `biller_category`. |
| `bill paid` | App (paid by hand) or Server (AutoPay) | A monthly bill payment. Each biller has a monthly due date; rent is due on the 1st. AutoPay payments post on the due date or the next business day. Members who joined before June 4 have billers set up before the window, so their payments have no `biller added` event in the window. | `biller_id`; `biller_category`; `amount` (USD); `autopay` (true when the payment was made by AutoPay); `payment_status` (`on_time`, `late`: paid after the due date). |

## Plans

| Event | Sender | Meaning | Properties |
|---|---|---|---|
| `plan comparison viewed` | App | A Free member opens the plan comparison screen. | `trigger` (`float_limit`, `pockets_apy`, `settings`, `promo_banner`). |
| `plan upgraded` | App | The member upgrades from Free. At most once per member. | `new_plan` (`plus`, `premium`); `monthly_fee` (USD). |

## Support

A ticket's two events share a `ticket_id`.

| Event | Sender | Meaning | Properties |
|---|---|---|---|
| `support ticket opened` | App | The member contacts support. | `ticket_id`; `issue_type` (`card`, `card_declined`, `transfer`, `account_access`, `fees`, `direct_deposit`, `dispute`); `contact_channel` (`chat`, `in_app`, `phone`, `email`). |
| `support ticket resolved` | Server | The support team marks the ticket resolved. Tickets opened just before June 4 can be resolved early in the window. | `ticket_id`; `issue_type`; `contact_channel`; `resolution_hours`: hours from the ticket being opened to being resolved. |

## Experiments

| Event | Sender | Meaning | Properties |
|---|---|---|---|
| `$experiment_started` | App | Mixpanel experiment exposure: sent the first time a member adds a biller while the "Autopay Default" test is live (from 2026-07-21). | `Experiment name` = `Autopay Default`; `Variant name` = `Control` or `Autopay On`. |

## User profile properties

| Property | Meaning |
|---|---|
| `distinct_id` | The member's ID (same as `user_id` on events). |
| `name`, `email`, `avatar` | Contact details. |
| `customer_segment` | `everyday`, `tight_budget`, `saver`, `gig_worker`, `student` (see 01-business.md). |
| `_persona` | Legacy copy of `customer_segment` from an older CRM sync. |
| `credit_history` | `established` or `thin_file`. |
| `acquisition_channel` | Channel at signup (for members who joined before June 4, the channel they originally came from). |
| `plan_tier` | Current plan: `free`, `plus`, `premium`. |
| `customer_since` | Date the member opened their account (YYYY-MM-DD). Before 2026-06-04 for members who joined earlier. |
| `age_band` | 18-24, 25-34, 35-44, 45-54, 55+. |
| `pay_frequency` | `weekly`, `biweekly`, `semimonthly` for members with direct deposit; `none` otherwise. |
| `direct_deposit_active` | Whether the member has direct deposit to Penny Harbor (at the end of the window). |
| `round_ups_enabled` | Whether the member has turned on Round-Ups. |
| `Experiment: Autopay Default` | `Control` or `Autopay On` for members enrolled in the test; empty for everyone else. |
| `created` | Account-opening time for members who joined in the window (the time of their `account opened` event); empty for earlier members. |
| `country`, `country_code`, `region`, `city` | Location. |
| `anonymousIds`, `sessionIds` | Devices and sessions seen for the member (pipeline metadata). |

## Funnels the business tracks

| Funnel | Steps | Notes |
|---|---|---|
| Onboarding | `account opened` → `identity verified` → `account funded` | New members only. Read with a 7-day conversion window. |
| Direct deposit switch | `account opened` → `direct deposit set up` | New members. The growth team reads it with a 14-day window. |
| Money check | `app opened` → `balance checked` | Daily habit. |
| Send money | `app opened` → `transfer sent` | |
| Save | `app opened` → `savings deposit` (source = manual) | |
| Bill setup | `biller added` → `autopay enabled` | Members add several billers; hold `biller_id` constant to measure each biller. |
| Support | `support ticket opened` → `support ticket resolved` | Hold `ticket_id` constant to measure each ticket. |
| Upgrade | `plan comparison viewed` → `plan upgraded` | Free members. |
