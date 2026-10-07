# Marlowe & Pine tracking plan (event dictionary)

Event names are lowercase, as tracked. Properties are flat on each event. Times are UTC.

## Properties on events

| Property | Meaning |
|---|---|
| `time` | When the event happened (UTC). |
| `user_id` | The customer's ID. Present on every event except a new shopper's anonymous first visit (before `account created`). |
| `device_id` | The device the event came from. Present on every website and app event; absent on `order shipped` and `order delivered`. Customers use about two devices. |
| `insert_id` | Unique event ID used for de-duplication. |
| `session_id` | The app or web session the event belongs to (diagnostic; Mixpanel computes its own sessions). |
| `platform` | Where the event happened: `web`, `ios_app`, or `android_app`. Follows the device. Absent on `order shipped` and `order delivered`. |
| `membership` | The customer's membership: `pine_plus` or `standard`. On every event; it did not change for anyone in the window. |
| `os`, `model`, `screen_height`, `screen_width`, `carrier`, `radio` | Device details from the SDK. `carrier` here is the phone's mobile network, not the parcel carrier. |
| `browser` | Web browser, on `web` events only. |
| `country`, `country_code`, `region`, `city` | Customer location (one location per customer). |

## Browsing

| Event | Meaning | Properties |
|---|---|---|
| `home page viewed` | The shopper opens the home page. | `home_module`: the featured module the shopper engaged with (`new_arrivals`, `bestsellers`, `seasonal_edit`, `recently_viewed`, `room_inspiration`, `labor_day_sale` during the sale). |
| `category browsed` | The shopper opens a category page. | `category` (`bedding`, `bath`, `kitchen`, `dining`, `furniture`, `lighting`, `decor`, `outdoor`); `sort_by` (`featured`, `bestselling`, `newest`, `price_low_high`, `price_high_low`). |
| `product searched` | The shopper runs a search. | `search_term`; `results_count`. |
| `product viewed` | The shopper opens a product page. The first product in a cart is viewed shortly before it is added; further items can be added from the cart page ("complete the set" suggestions) without opening their product page. | `product_id`, `product_name`, `category`, `price_usd` (list price). |
| `product reviews read` | The shopper opens the reviews on a product page. | `product_id`, `category`, `reviews_shown`. |
| `product added to wishlist` | The shopper saves a product to their wishlist. | `product_id`, `product_name`, `category`, `price_usd`. |
| `room visualizer opened` | The shopper opens Room Visualizer on a furniture or lighting product page (from 2026-07-22). | `product_id`, `product_name`, `category`, `price_usd`. |
| `order history viewed` | The shopper opens their order history (order tracking lives here). | `orders_listed`. |

## Signup

| Event | Meaning | Properties |
|---|---|---|
| `account created` | A new shopper creates an account. Required before checkout. It links the shopper's earlier anonymous browsing to their `user_id`. | `signup_method` (`email`, `google`, `apple`, `facebook`); `acquisition_channel` (`organic_search`, `direct`, `email_referral`, `meta_ads`, `google_shopping`, `tiktok_ads`), the same value as the profile property. |

## Cart and checkout

Every step of one cart carries the same `cart_id`. A cart starts with its first `product added to cart`; more items can be added before the cart is viewed.

| Event | Meaning | Properties |
|---|---|---|
| `product added to cart` | The shopper adds a product to the cart. | `cart_id`; `product_id`, `product_name`, `category`, `price_usd`; `quantity`. |
| `cart viewed` | The shopper opens the cart. | `cart_id`; `cart_items` (units in the cart); `cart_value_usd` (merchandise subtotal). |
| `checkout started` | The shopper starts checkout. | `cart_id`; `cart_items`; `cart_value_usd`. |
| `shipping info entered` | The shopper completes the shipping step. | `cart_id`; `ship_country` (`US`, `CA`, `GB`); `address_type` (`home`, `work`, `gift_recipient`). |
| `payment info entered` | The shopper completes the payment step. | `cart_id`; `payment_method` (`credit_card`, `paypal`, `digital_wallet`, `afterpay`). |
| `order completed` | The order is placed. | `cart_id`; `order_id`; `item_count` (units); `primary_category` (category of the cart's first item); `subtotal_usd` (merchandise, before discounts); `discount_code` (`none`, `WELCOME10` for some new customers' first order, `LABORDAY25`); `discount_usd`; `shipping_usd`; `free_shipping` (true when shipping was $0); `order_total_usd` = subtotal − discount + shipping (tax excluded); `payment_method`; `ship_country`. |
| `$experiment_started` | Mixpanel experiment exposure for the One-Page Checkout test (from 2026-07-15). Sent once per shopper, one second before the first add of their first cart in the test; later carts keep the same variant and send no new exposure. | `Experiment name` = `One-Page Checkout`; `Variant name` = `Control` or `One-Page`. |

## Fulfillment and after the order

`order shipped` and `order delivered` are sent by the fulfillment system (server-side) with `user_id` only. They keep arriving after a customer stops visiting the store. Orders placed before June 4 can ship and deliver inside the window; their `order completed` is not in the data.

| Event | Meaning | Properties |
|---|---|---|
| `order shipped` | The parcel leaves the fulfillment center. | `order_id`; `shipping_carrier` (`northline`, `bluejay`, `parcelpost`, `maple_courier`, `albion_parcel`); `ship_country`. |
| `order delivered` | The carrier delivers the parcel. | `order_id`; `shipping_carrier`; `ship_country`; `delivery_days` (days from shipped to delivered, one decimal); `on_time` (true when delivered within the promise: 5 days US, 12 days Canada and UK). |
| `return requested` | The customer requests a return for an order. | `order_id`; `category`; `return_reason` (`changed_mind`, `not_as_pictured`, `damaged`, `wrong_size`, `arrived_late`); `refund_usd`. |
| `review submitted` | The customer reviews an order they received. | `order_id`; `category`; `rating` (1-5). |

## User profile properties

| Property | Meaning |
|---|---|
| `distinct_id` | The customer's ID (same as `user_id` on events). |
| `name`, `email`, `avatar` | Contact details. |
| `shopper_segment` | `home_refresher`, `deal_seeker`, `new_mover`, `casual_gifter` (see 01-business.md). |
| `membership` | `pine_plus` or `standard`. |
| `ship_country` | `US`, `CA`, or `GB`. |
| `acquisition_channel` | Channel at signup (for customers from before the window, the channel they originally came from). |
| `customer_since` | Date the customer created their account (YYYY-MM-DD). Before 2026-06-04 for established customers. |
| `Experiment: One-Page Checkout` | `Control` or `One-Page` for customers enrolled in the checkout test; empty for everyone else. |
| `created` | First-visit time for customers who joined in the window; empty for established customers. |
| `country`, `country_code`, `region`, `city` | Location. |
| `anonymousIds`, `sessionIds` | Devices and sessions seen for the customer (pipeline metadata). |

## Funnels the business tracks

| Funnel | Steps | Notes |
|---|---|---|
| New shopper | `category browsed` → `product viewed` → `account created` | First visit; the first two steps are anonymous until the account links them. |
| Browse | `category browsed` → `product viewed` | Daily browsing habit. |
| Cart to order | `product added to cart` → `cart viewed` → `checkout started` → `shipping info entered` → `payment info entered` → `order completed` | Customers start many carts. Hold `cart_id` constant and count Totals to measure each cart on its own; use a 1-day conversion window (a checkout session times out one hour after the cart's first add). |
| Delivery | `order shipped` → `order delivered` | Hold `order_id` constant. |
