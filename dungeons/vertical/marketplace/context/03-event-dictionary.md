# Tradepost tracking plan (event dictionary)

Event names are lowercase, as tracked. Properties are flat on each event. Times are UTC.

## Properties on every event

| Property | Meaning |
|---|---|
| `time` | When the event happened (UTC). |
| `user_id` | The member's ID. Missing on guest browsing before signup (see 00-manifest.md, Identity notes). |
| `device_id` | The member's phone. Present on app events. Missing on server-side events (`offer accepted`, `offer declined`, `order shipped`, `order delivered`, `item sold`) and on the first search and listing view right after signup. |
| `insert_id` | Unique event ID used for de-duplication. |
| `platform` | `ios` (iPhone or iPad) or `android`. Fixed per member. |
| `region` | The member's region (`south`, `west`, `midwest`, `northeast`). Fixed per member. |
| `os`, `model`, `screen_height`, `screen_width`, `carrier`, `radio` | Device details from the mobile SDK, stored per member. `os` is `iOS`, `iPadOS`, or `Android`; `carrier` is the phone's mobile network (not the shipping carrier). |

## Listing attributes

Buyer events about a listing carry the listing's attributes, so you can break down any buyer event without a lookup:

| Property | Meaning |
|---|---|
| `listing_id` | The listing. All events about one item in one shopping visit share it (view, offer, checkout, purchase, shipping, delivery, review, dispute). |
| `category` | `electronics`, `fashion`, `sneakers`, `home_decor`, `collectibles`, `toys_games`, `sports_outdoors`. |
| `item_price` | On `listing viewed`: the asking price. On `checkout started`, `purchase completed`, and `dispute opened`: the price the buyer pays for the item (the offer amount when an offer was accepted). Whole US dollars. |
| `condition` | `new_with_tags`, `like_new`, `good`, `fair`. |
| `photo_count` | Photos on the listing (1-12). |
| `seller_type` | Who listed it: `casual` (a casual seller) or `pro` (a Tradepost Pro seller). |

## Signup

| Event | Meaning | Properties |
|---|---|---|
| `account created` | A guest creates an account. First event of every new member as a member, and the moment their phone is linked to their `user_id`. | `signup_method` (`email`, `google`, `apple`); `acquisition_channel`: how the member found us (`organic`, `referral`, `google_shopping`, `meta_ads`, `tiktok_ads`), same value as the profile property; `account_type` at signup (same as the profile). |

## Browsing

| Event | Meaning | Properties |
|---|---|---|
| `home feed viewed` | The member (or a guest) opens the home feed. | `feed_section`: the section they opened (`for_you`, `following`, `deals`, or a seasonal collection such as `back_to_campus`). |
| `search performed` | The member searches. | `search_category`: the category the search maps to; `results_count`: listings matched; `sort_by` (`relevance`, `newest`, `price_low`, `price_high`). |
| `listing viewed` | The member opens a listing page. | Listing attributes; `view_source` (`search`, `feed`, `saved`). |
| `item saved` | The member saves (likes) a listing to come back to it. | `listing_id`, `category`, `item_price`. |

## Offers

| Event | Meaning | Properties |
|---|---|---|
| `offer made` | The buyer sends an offer below the asking price. | `offer_id` (shared by the offer and its answer); `listing_id`; `category`; `asking_price`; `offer_amount` (US dollars); `offer_pct_of_ask`: the offer as a whole-number percentage of the asking price (for example 80 means 80% of the asking price); `seller_type`. |
| `offer accepted` | The seller accepts the offer. Sent by the server to the buyer's stream. | `offer_id`, `listing_id`, `category`, `offer_amount`, `offer_pct_of_ask`; `hours_to_response`: hours from the offer to the answer. |
| `offer declined` | The seller declines the offer (or it expires). Sent by the server. | Same as `offer accepted`. |

An offer has exactly one answer within 48 hours. Offers made in the last two days of the window may not have their answer yet.

## Checkout and orders (buyer side)

| Event | Meaning | Properties |
|---|---|---|
| `$experiment_started` | The member is shown their Express Checkout arm. Fires one second before each `checkout started` from 2026-07-22 for members in the test. | `Experiment name` (`Express Checkout`); `Variant name` (`Control` or `Express Checkout`). |
| `checkout started` | The buyer starts checkout for one item. | `order_id` (shared by every event of the order from here on); listing attributes; `payment_method` (`card`, `apple_pay`, `google_pay`, `paypal`); `purchase_type` (`buy_now` or `offer`). |
| `purchase completed` | Payment is approved and the order is placed. | `order_id`; listing attributes; `item_price`; `shipping_fee` (0, 5.49, or 8.49); `order_total` = item price + shipping fee; `payment_method`; `purchase_type`. |
| `order shipped` | The carrier scans the package. Sent by the server. | `order_id`, `listing_id`, `category`; `shipping_carrier` (`usps`, `ups`, `fedex`); `days_to_ship`: days from purchase to the first carrier scan. |
| `order delivered` | The carrier marks the package delivered. Sent by the server. | `order_id`, `listing_id`, `category`, `shipping_carrier`; `delivery_days`: days from purchase to delivery (one decimal). |
| `review submitted` | The buyer reviews the order. | `order_id`, `listing_id`, `category`; `rating` (1-5 stars); `has_photo`. |
| `dispute opened` | The buyer opens a dispute after delivery. | `order_id`, `listing_id`, `category`; `dispute_reason` (`not_as_described`, `damaged`, `counterfeit`, `not_received`, `other`); `item_price`. |

A checkout that does not end in `purchase completed` was abandoned or its payment failed. Each order has one item. Orders placed shortly before June 4 can show up in the window as `order shipped`, `order delivered`, `review submitted`, or `dispute opened` without their earlier steps.

## Selling (seller side)

| Event | Meaning | Properties |
|---|---|---|
| `listing created` | The seller publishes a listing. | `listing_id` (shared by every event of the listing); `category`; `asking_price`; `condition`; `photo_count` (1-12); `package_size` (`small`, `medium`, `large`; sets the prepaid label). |
| `listing price dropped` | The seller lowers the price. | `listing_id`, `category`; `old_price`; `new_price`; `drop_pct` (5-25); `days_since_listed`. |
| `item sold` | The listing sells. Sent by the server to the seller's stream. | `listing_id`, `category`; `sale_price` (US dollars); `days_to_sell`: days from listing to sale (one decimal); `sale_type` (`buy_now` or `offer`). |
| `shipping label printed` | The seller prints the prepaid shipping label. | `listing_id`, `category`; `shipping_carrier`; `days_to_ship`: days from the sale to printing the label. |

Listings created before June 4 can sell in the window: their `item sold` and `shipping label printed` events appear without a `listing created` in the data.

## User profile properties

| Property | Meaning |
|---|---|
| `account_type` | `buyer`, `seller` (casual seller), or `pro_seller` (Tradepost Pro). |
| `acquisition_channel` | How the member found Tradepost: `organic`, `referral`, `google_shopping`, `meta_ads`, `tiktok_ads`. Members who joined before June 4 have it from their original signup. |
| `region` | `south`, `west`, `midwest`, `northeast`. |
| `age_band` | `18-24`, `25-34`, `35-44`, `45-54`, `55+`. |
| `member_since` | Signup date (YYYY-MM-DD). Before 2026-06-04 for established members. |
| `Experiment: Express Checkout` | The member's arm (`Control` or `Express Checkout`), set when they are first exposed. Missing for members never exposed. |
| `name`, `email`, `avatar`, `created` | Contact details and the profile creation time. |
| `_persona` | Engagement segment from the CRM's lifecycle model (`browser`, `regular_buyer`, `casual_seller`, `pro_seller`). Raw export only. |
| `_drop` | `true` on records of guests who never finished signing up. These records are not loaded into Mixpanel. Raw export only. |

## Funnels the business tracks

| Funnel | Steps | Notes |
|---|---|---|
| Signup | `home feed viewed` → `listing viewed` → `account created` | Guests' path to an account. Needs identity merge (guest steps carry device id only). |
| Checkout | `checkout started` → `purchase completed` | Hold `order_id` constant, Totals counting. Purchases happen within minutes; the payments team uses a 1-day window. |
| Offer | `offer made` → `offer accepted` | Hold `offer_id` constant, Totals counting, 2-day window (offers expire after 48 hours). |
| Buyer journey | `listing viewed` → `checkout started` → `purchase completed` → `order delivered` | Hold `listing_id` constant. Use a 30-day window to include delivery. |
| New buyer activation | `account created` → `purchase completed` | Uniques, 14-day window. Count only signups with a full 14 days of data. |
| Sell-through | `listing created` → `item sold` | Hold `listing_id` constant, Totals counting, 30-day window. Count only listings with a full 30 days of data. |
| Seller fulfilment | `item sold` → `shipping label printed` | Hold `listing_id` constant, 7-day window. |
