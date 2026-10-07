# Driftway Travel tracking plan (event dictionary)

Event names are lowercase, as tracked. Properties are flat on each event. Times are UTC.

## Properties on every event

| Property | Meaning |
|---|---|
| `time` | When the event happened (UTC). |
| `user_id` | The member's ID. Present on every event except a new traveler's anonymous first search and the property pages they open before `account created`. |
| `device_id` | The device the event came from. Present on every event. A member typically has two devices (a phone and a computer). |
| `insert_id` | Unique event ID used for de-duplication. |
| `session_id` | The app or website session (diagnostic; Mixpanel computes its own sessions). |
| `platform` | `ios` (iPhone or iPad), `android`, or `web` (the website on a computer). Follows the device the event came from. |
| `os`, `model`, `screen_height`, `screen_width`, `carrier`, `radio` | Device details from the SDK. `os` is `iOS`, `iPadOS`, `Android`, or a desktop OS (`Windows`, `macOS`, `Linux`, and similar). |

## Signup

| Event | Meaning | Properties |
|---|---|---|
| `account created` | A new traveler creates an account, usually when they first want to save a property or check out. It links the device they browsed on to their new `user_id`. Members who joined before June 4 have no `account created` event in the window. | `signup_method` (`email`, `google`, `apple`); `acquisition_channel` (`organic`, `referral`, `email`, `google_hotel_ads`, `meta_ads`, `tiktok_ads`), same value as the profile property. |

## Shopping (one search session = one `search_id`)

| Event | Meaning | Properties |
|---|---|---|
| `destination searched` | The traveler searches a destination and dates. Starts a search session. | `search_id`; `destination` (one of 28 destinations); `region` (`us_cities`, `us_beaches`, `mountains`, `caribbean`, `europe`); `check_in_date` (YYYY-MM-DD); `lead_time_days` (days from the search to check-in); `nights` (1-8); `guests` (1-5). |
| `property viewed` | The traveler opens a property page from the results of that search. A session has one to about a dozen property views. | `search_id`; `property_id`; `property_name`; `property_type` (`hotel`, `boutique_hotel`, `resort`, `vacation_rental`); `destination`; `region`; `star_rating` (2-5; 0 for vacation rentals, which have no star rating); `review_count` (guest reviews shown on the property page that day; it grows as stays are reviewed); `guest_rating` (average guest rating out of 5; 0 when the property has no reviews); `nightly_rate` (USD per night before taxes and fees for the searched dates; property pages show the free-cancellation rate). |
| `checkout started` | The traveler starts checkout for a property from that search. At most one per search session. | `search_id`; property fields as on `property viewed` (without `guest_rating`); `nightly_rate` (for the rate type the traveler chose; the non-refundable rate is 10% lower); `nights`; `guests`; `total_price` (USD for the whole stay, including taxes and fees, which are about 16% of the room price); `check_in_date`; `lead_time_days` (days from checkout to check-in). |
| `payment failed` | A payment attempt at checkout fails and the traveler sees an error. Not every abandoned checkout has one. | `search_id`; `property_id`; `error_code` (`card_declined`, `insufficient_funds`, `3ds_failed` for a failed bank verification, `gateway_timeout` when the payment gateway did not answer); `payment_method` the traveler tried. |
| `booking completed` | Payment succeeds and the stay is booked. At most one per search session. | `booking_id`; `search_id`; property fields; `nightly_rate`; `nights`; `guests`; `total_price`; `check_in_date`; `lead_time_days` (days from the booking to check-in); `refundable` (`true` = free-cancellation rate, `false` = non-refundable rate); `payment_method` (`credit_card`, `paypal`, `apple_pay`, `google_pay`, `flex_pay`); `promo_code` (`none` or a campaign code such as `SUMMERKICKOFF`). |
| `filters applied` | The traveler filters search results. | `filter_type` (`price`, `guest_rating`, `free_cancellation`, `property_type`, `amenities`, `neighborhood`). |
| `map viewed` | The traveler opens the map view of results. | `zoom_level` (11-15). |
| `wishlist saved` | The traveler saves a property to a wishlist. | `property_id`; `property_name`; `destination`; `region`. |
| `price alert set` | The traveler asks to be told when prices drop for a destination. | `destination`; `region`; `target_price` (USD per night). |

## Stays (one booking = one `booking_id`)

| Event | Meaning | Properties |
|---|---|---|
| `booking cancelled` | The traveler cancels a booking before check-in. At most one per booking. Stays booked before June 4 can be cancelled in the window, so some cancellations have no `booking completed` event in the data. | `booking_id`; `property_id`; `destination`; `region`; `check_in_date`; `lead_time_days` (from the original booking); `days_before_check_in` (days from the cancellation to check-in); `cancellation_reason` (`change_of_plans`, `found_better_price`, `schedule_conflict`, `illness`, `travel_restrictions`, `weather`); `refund_amount` (USD; the full `total_price` on a free-cancellation rate or a weather waiver, 0 otherwise). |
| `check in completed` | The guest checks in on the first day of the stay (the UTC date equals the booking's `check_in_date`). | `booking_id`; `property_id`; `property_type`; `destination`; `region`; `nights`; `check_in_method` (`front_desk`, `mobile_key`, `self_check_in`). |
| `review submitted` | The guest reviews the stay, half a day to six days after checking out. About half of stays get a review. | `booking_id`; `property_id`; `property_type`; `destination`; `region`; `rating` (1-5 stars); `review_length` (words); `would_recommend` (`true`/`false`). |

## Messages and support

| Event | Meaning | Properties |
|---|---|---|
| `notification received` | Driftway sends the member a message (server-side; it fires whether or not the member opens the app). | `notification_type` (`deal_digest` = the weekly Thursday deals email; `price_drop` = a price alert or saved property got cheaper; `abandoned_search` = a reminder about an unfinished search; `trip_reminder` = the day before check-in; `marketing_campaign` = a campaign send); `channel` (`email`, `push`); `campaign` (`none` or the campaign name, such as `summer_kickoff_sale`). |
| `support contacted` | The member contacts member support. | `topic` (`change_dates`, `cancellation`, `refund_status`, `payment_issue`, `property_issue`, `other`); `contact_channel` (`chat`, `phone`, `email`). |

## Experiments

| Event | Meaning | Properties |
|---|---|---|
| `$experiment_started` | The member is enrolled in an experiment. Fires once per member, just before their first search after the test starts. | `Experiment name` (`All-in Pricing`); `Variant name` (`Control`, `All-in Pricing`). |

## User profile properties

| Property | Meaning |
|---|---|
| `traveler_segment` | `business`, `family`, `couple`, or `solo` (see 01-business.md). Set by the planning team from the member's trips and stated purpose. |
| `home_market` | The member's home city: US cities, Toronto, London, or Manchester. |
| `age_band` | `18-24`, `25-34`, `35-44`, `45-54`, `55-64`, `65+`. |
| `acquisition_channel` | How the member first found Driftway (see 01-business.md). |
| `rewards_tier` | Driftway Rewards tier: `member`, `silver`, or `gold`. |
| `member_since` | UTC date the member created their account (YYYY-MM-DD); for new members, the date of `account created`. |
| `push_enabled` | `true` if the member allows push notifications. |
| `Experiment: All-in Pricing` | The member's arm (`Control` or `All-in Pricing`) if they were enrolled; absent otherwise. |

Profiles also carry `name`, `email`, and `avatar`.

## Funnels the business tracks

- **Search to booking** (per search session): `destination searched` → `property viewed` → `checkout started` → `booking completed`. Use Totals counting with `search_id` held constant to measure per session; a unique-member funnel credits a member who booked in any session. The product team uses a 7-day conversion window.
- **Checkout to booking:** `checkout started` → `booking completed` (same `search_id`). Booking usually follows a checkout within minutes.
- **Booking to cancellation** (per booking): `booking completed` → `booking cancelled`, Totals counting, `booking_id` held constant. The revenue team uses a 30-day window from the booking.
- **Stay:** `booking completed` → `check in completed` → `review submitted` (same `booking_id`).
- **New member activation:** `account created` → `booking completed`. Growth uses a 30-day window.
