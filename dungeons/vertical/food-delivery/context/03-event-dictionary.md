# Forkfly tracking plan (event dictionary)

Event names are lowercase, as tracked. Properties are flat on each event. Times are UTC.

## Properties on every event

| Property | Meaning |
|---|---|
| `time` | When the event happened (UTC). |
| `user_id` | The customer's ID. Present on every event. |
| `device_id` | The customer's device. Present on every event except `address saved`, which the address service sends server-side with `user_id` only. |
| `insert_id` | Unique event ID used for de-duplication. |
| `session_id` | The app session the event belongs to (diagnostic; Mixpanel computes its own sessions). |
| `city` | The customer's city (one of the eight markets). Fixed per customer. |
| `platform` | `ios` (iPhone or iPad) or `android`. Fixed per customer. |
| `pass_status` | The customer's Forkfly Pass status **at the moment of the event**: `none`, `trial` (free trial), or `member` (paid). On `pass trial ended` and `pass cancelled` it is the status that is ending (`trial` or `member`); the customer's later events carry the new status. |
| `os`, `model`, `screen_height`, `screen_width`, `carrier`, `radio` | Device details from the mobile SDK. `os` is `iOS`, `iPadOS`, or `Android`. |

## Signup

| Event | Meaning | Properties |
|---|---|---|
| `account created` | The customer creates an account. First event of every new customer and the moment their device is linked to their `user_id`. | `signup_method` (`apple`, `google`, `email`); `acquisition_channel`: how the customer found us (`organic`, `referral`, `paid_search`, `paid_social`, `coupon_affiliates`), same value as the profile property. |
| `address saved` | The customer saves their first delivery address, right after signup. Needed before checkout. | `address_type` (`home`, `work`, `other`). |

## Browsing and cart

| Event | Meaning | Properties |
|---|---|---|
| `app opened` | The customer opens the app. Starts a visit. | `open_source` (`organic`, `push_notification`, `deep_link`). |
| `search performed` | The customer searches for a dish or cuisine. | `search_term`; `results_count` (0 = no results). |
| `restaurant viewed` | The customer opens a restaurant's page. | `restaurant_id`, `restaurant_name`, `cuisine` (`american`, `pizza`, `mexican`, `chinese`, `japanese`, `indian`, `thai`, `mediterranean`, `italian`, `healthy`), `price_tier` (`$` to `$$$$`), `restaurant_rating` (average stars, 3.7-4.9). |
| `item added to cart` | The customer adds a menu item. | `restaurant_id`; `item_category` (`entree`, `side`, `drink`, `appetizer`, `dessert`); `item_price_usd`; `added_from`: `menu` (from the restaurant menu) or `addon_suggestion` (from a Smart Add-ons suggestion on the checkout screen; see 02-timeline.md). |
| `reorder tapped` | The customer taps a restaurant in the Order Again row (from 2026-07-07). The cart is filled from a recent order, ready for checkout. | `restaurant_id`, `restaurant_name`, `cuisine`; `days_since_last_order`: whole days since the earlier order that is being repeated (one of the customer's three most recent orders). |

## Checkout, payment, and orders

Every checkout gets an `order_id`. The checkout, a failed payment, the order, tracking views, the delivery, the rating, and a support contact for that order all share it.

| Event | Meaning | Properties |
|---|---|---|
| `checkout started` | The customer opens the checkout screen. | `order_id`, `restaurant_id`, `restaurant_name`, `cuisine`; `items_count` and `subtotal_usd` (the cart when checkout opened); `delivery_fee_usd`, `service_fee_usd` (as shown); `quoted_eta_mins`: the delivery time quoted by the dispatch system, in minutes; `payment_method` (`card`, `apple_pay`, `google_pay`, `paypal`); `entry_point`: how the visit reached checkout (`home_feed`, `search`, or `reorder` for Order Again). |
| `pass offer viewed` | The checkout screen shows the Forkfly Pass free-trial offer (only to customers who never had a trial). | `order_id`; `offer_type` (`free_trial_14_days`). |
| `pass trial started` | The customer starts a 14-day free Pass trial from the offer. Pass benefits apply right away. | `plan` (`monthly`); `price_after_trial_usd` (9.99). |
| `payment failed` | The payment for a checkout was declined. The order is not placed. | `order_id`; `payment_method`; `decline_code` (`insufficient_funds`, `card_declined`, `expired_card`, `authentication_failed`, `processor_unavailable`). |
| `order placed` | The customer places and pays for the order. | `order_id`, `restaurant_id`, `restaurant_name`, `cuisine`, `price_tier`; `items_count`, `subtotal_usd` (final cart, including items added on the checkout screen); `delivery_fee_usd`, `service_fee_usd`, `tip_usd`, `discount_usd`; `promo_code` (`WELCOME8`, `DEAL15`, `FORK5`, or `none`); `order_total_usd` = subtotal + fees + tip − discount; `quoted_eta_mins`; `payment_method`; `entry_point`. |
| `order tracking viewed` | The customer opens the tracking screen for an order on its way. | `order_id`; `order_status` (`preparing`, `picked_up`, `on_the_way`, `running_late`). |
| `order delivered` | The courier marks the order delivered (server-side). | `order_id`, `restaurant_id`; `delivery_minutes`: minutes from order placed to delivered; `minutes_late`: delivered time minus the quoted time, in minutes (negative = early). |
| `order rated` | The customer rates a delivered order. | `order_id`, `restaurant_id`; `food_rating` and `delivery_rating` (1-5 stars). |
| `support contacted` | The customer contacts support about an order. | `order_id`; `issue_type` (`late_delivery`, `missing_item`, `wrong_item`, `food_quality`, `refund_request`); `contact_channel` (`chat`, `phone`). |
| `$experiment_started` | Mixpanel experiment exposure for the Smart Add-ons test, sent one second before the customer's first checkout on or after 2026-07-28. One per enrolled customer. | `Experiment name` = `Smart Add-ons`; `Variant name` = `Control` or `Smart Add-ons`. |

## Forkfly Pass billing (server-side)

| Event | Meaning | Properties |
|---|---|---|
| `pass trial ended` | A free trial reaches its 14th day. Sent by billing whether or not the customer still uses the app. | `outcome` (`converted` = became a paid member, `not_converted`); `orders_during_trial`: orders the customer placed in the 14 days of the trial, as billing counts them. For trials that began before 2026-06-04, the count includes the trial days before June 4, which are not in this dataset, so it can be higher than the orders you see in Mixpanel. |
| `pass cancelled` | A paid member cancels. | `cancel_reason` (`not_ordering_enough`, `too_expensive`, `switching_apps`, `moving`, `other`); `months_subscribed`. |

## User profile properties

| Property | Meaning |
|---|---|
| `distinct_id` | The customer's ID (same as `user_id` on events). |
| `name`, `email`, `avatar` | Contact details. |
| `city` | City (same as on events). |
| `platform` | `ios` or `android` (same as on events). |
| `household_type` | `single`, `couple`, `family` (signup survey). |
| `favorite_cuisine` | Signup survey answer. |
| `acquisition_channel` | Channel at signup (for established customers, the channel they originally came from). |
| `customer_since` | Date the customer signed up (YYYY-MM-DD). Before 2026-06-04 for established customers. |
| `default_payment` | The customer's saved default payment method. Most checkouts use it. |
| `pass_status` | Current Pass status: `none`, `trial`, `member`. |
| `Experiment: Smart Add-ons` | `Control` or `Smart Add-ons` for customers in the test; empty for everyone else. |
| `created` | Signup time for customers who joined in the window; empty for established customers. |
| `anonymousIds`, `sessionIds` | Devices and sessions seen for the customer (pipeline metadata). |

## Funnels the business tracks

| Funnel | Steps | Notes |
|---|---|---|
| Signup | `account created` → `address saved` | New customers only. |
| Ordering visit | `app opened` → `restaurant viewed` → `item added to cart` → `checkout started` → `order placed` | One visit; 1-hour conversion window, Totals counting. Order Again visits never send `restaurant viewed` or `item added to cart`, so this funnel counts them as stopping after `app opened`; the team reports them with the Order Again funnel below. |
| Order Again visit | `reorder tapped` → `checkout started` → `order placed` | From 2026-07-07. 1-hour conversion window, Totals counting. |
| Checkout | `checkout started` → `order placed` | Per checkout: hold `order_id` constant (Totals counting). |
| Order lifecycle | `order placed` → `order delivered` → `order rated` | Hold `order_id` constant. |
| Pass trial | `pass trial started` → `pass trial ended` (outcome = converted) | 14-day trials; only trials that started at least 14 days before the window end have an outcome. |
