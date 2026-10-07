# Keystead Homes tracking plan (event dictionary)

Event names are lowercase, as tracked. Properties are flat on each event. Times are UTC.

## Properties on every event

| Property | Meaning |
|---|---|
| `time` | When the event happened (UTC). |
| `user_id` | The shopper's account ID. Present on every event after signup; absent on anonymous browsing before signup. |
| `device_id` | The device that sent the event. Present on events sent from the website or apps; absent on server-side events (see each section). |
| `insert_id` | Unique event ID used for de-duplication. |
| `session_id` | Diagnostic session tag from the tracking pipeline. Mixpanel computes its own sessions; do not use this for session analysis. |
| `os`, `model`, `browser`, `screen_height`, `screen_width`, `carrier`, `radio` | Device details from the SDK, on events sent from a device. `os` is `Windows`, `macOS`, `Linux` (and other desktop Linux names), `iOS`, `iPadOS`, or `Android`. |

## Listing facts

Every event about a specific home carries the listing's facts as of that moment:

| Property | Meaning |
|---|---|
| `listing_id` | The MLS listing, for example `AUS-104512` (market code + number). The same home has the same ID for every shopper. |
| `market` | The metro of the listing: `Dallas`, `Austin`, `Phoenix`, `Denver`, `Nashville`, `Charlotte`, `Tampa`, or `Raleigh`. Shoppers search in their home market, so this matches the shopper's `home_market`. |
| `list_price_usd` | The list price at that moment (after any price cut). |
| `property_type` | `single_family`, `townhome`, or `condo`. |
| `beds` | Bedrooms. |
| `days_on_market` | Whole days since the listing went live. |
| `price_reduced` | `true` if the seller has cut the price since listing. A listing takes at most one cut in this period. |

Not every listing event carries every fact; see the tables below.

## Signup

| Event | Meaning | Properties |
|---|---|---|
| `account created` | A shopper creates an account. First identified event of every new shopper; links the device's earlier anonymous browsing to the account. Sent from the device. | `signup_method` (`google`, `apple`, `email`); `acquisition_channel` (`organic`, `referral`, `paid_search`, `paid_social`, `youtube_ads`), same value as the profile property. |

## Search and browsing (sent from the device)

| Event | Meaning | Properties |
|---|---|---|
| `home search` | The shopper runs a search. | `market`; `price_max_usd` (the shopper's budget filter); `beds_min`; `property_type` (`any`, `single_family`, `townhome`, `condo`); `results_count`: homes matching. |
| `listing viewed` | The shopper opens a listing page. Anonymous visitors can view listings. | Listing facts (`listing_id`, `market`, `list_price_usd`, `property_type`, `beds`, `days_on_market`, `price_reduced`) plus `baths`, `sqft`; `view_source`: how they got there (`search_results`, `map`, `saved_homes`, `shared_link`, `listing_alert` when the view follows a tapped alert). |
| `3d tour viewed` | The shopper watches the 3D walkthrough of a listing. | `listing_id`, `market`, `list_price_usd`; `watch_seconds`. |
| `listing saved` | The shopper saves a home (adds a heart). Requires an account. At most one save per shopper per listing. | Listing facts. |
| `saved search created` | The shopper saves a search and turns on alerts. | `market`; `price_max_usd`; `beds_min`; `alert_frequency` (`daily` digest or `instant`). |
| `listing alert opened` | The shopper taps a listing alert (email or push) through to Keystead. | `market`; `alert_channel` (`email`, `push`). |

## Alerts (server-side, `user_id` only)

| Event | Meaning | Properties |
|---|---|---|
| `listing alert sent` | Keystead sends a listing alert for a saved search because new homes match. Sent whether or not the shopper is still active. | `market`; `new_matches`: matching new listings in the alert; `alert_channel` (`email`, `push`). |

## Agent chat

Every shopper has an assigned Keystead buyer agent in their market.

| Event | Meaning | Properties |
|---|---|---|
| `agent contacted` | The shopper messages their agent about a listing from the listing page. Sent from the device. | `listing_id`, `market`, `list_price_usd`; `contact_method` (`chat`, `call_request`, `email`). |
| `agent responded` | The agent's first reply to that message. Server-side (`user_id` only). | `listing_id`, `market`; `agent_id` (for example `DAL-A07`); `response_minutes`: whole minutes from the shopper's message to the reply. |

## Tours and offers

One tour per shopper per listing. The request, the completed tour, the offer, and the outcome for a home share its `listing_id`.

| Event | Meaning | Properties |
|---|---|---|
| `tour requested` | A tour is booked. Sent from the device. | Listing facts; `request_source`: `listing_page` (the shopper booked from the listing page) or `agent_chat` (the agent booked it from the conversation); `booking_type`: `scheduled` or `tour_it_now` (from July 15; see 02-timeline.md). |
| `tour completed` | The agent marks the tour done in the agent app. Server-side (`user_id` only). Not every requested tour happens. | `listing_id`, `market`, `list_price_usd`; `booking_type`; `buyer_preapproved`: `true` if the shopper held a valid Keystead Home Loans pre-approval at the time of the tour; `agent_id`. |
| `offer submitted` | The agent submits the shopper's offer on a home they toured. Sent from the device (the shopper signs in the app). | `listing_id`, `market`, `list_price_usd`; `offer_price_usd`; `buyer_preapproved` (as on the tour). |
| `offer accepted` | The seller accepts the offer. Server-side. The shopper is now under contract; closing happens later and is not tracked here. | `listing_id`, `market`; `final_price_usd`. |
| `offer rejected` | The seller rejects the offer. Server-side. | `listing_id`, `market`; `rejection_reason` (`outbid`, `price_too_low`, `terms`, `seller_withdrew`). |

A shopper who goes under contract can have another offer still in flight; on rare occasions a second offer is also accepted (a backup offer).

## Financing (Keystead Home Loans)

| Event | Meaning | Properties |
|---|---|---|
| `pre-approval started` | The shopper starts a pre-approval application. Sent from the device. | `loan_type` (`conventional`, `fha`, `va`, `jumbo`); `entry_point`: where they started (`listing_page`, `financing_tab`, `agent_referral`, or `payment_estimate` for the Payment Estimate link; see 02-timeline.md). |
| `pre-approval completed` | The lender approves the application. Server-side. Not every application is approved. The letter is valid 90 days. | `loan_type`; `approved_amount_usd`; `rate_quoted_pct`: the rate quoted for the shopper that day. |

## Experiments

| Event | Meaning | Properties |
|---|---|---|
| `$experiment_started` | Mixpanel experiment exposure, sent once per shopper at their first listing view in the Payment Estimate test (from 2026-07-29; only shoppers without a current pre-approval who have not applied since June 4). | `Experiment name` = `Payment Estimate`; `Variant name` = `Control` or `Payment Estimate`. |

## User profile properties

| Property | Meaning |
|---|---|
| `home_market` | The metro the shopper searches in. |
| `buyer_type` | `first_time`, `move_up`, or `investor` (see 01-business.md). |
| `budget_max_usd` | The shopper's maximum price. |
| `acquisition_channel` | How the shopper found us (see 01-business.md). Set for every shopper, including those who joined before June 4. |
| `member_since` | Account creation date. Before 2026-06-04 for established shoppers. |
| `preapproval_status` | Current Keystead Home Loans status at the end of the window: `none`, `started` (applied, not approved), `approved` (valid letter), or `expired` (approved earlier; the 90-day letter has lapsed). |
| `saved_search_count` | Saved searches the shopper has now (0-3). |
| `Experiment: Payment Estimate` | `Control` or `Payment Estimate` for shoppers in the test; absent otherwise. |
| `name`, `email`, `avatar` | Contact fields. |

## Funnels the business tracks

- **Signup:** `home search` → `listing viewed` → `account created` (new shoppers, anonymous until signup).
- **Save to tour:** `listing saved` → `tour requested`, hold `listing_id` constant.
- **Lead response:** `agent contacted` → `agent responded` → `tour requested`, hold `listing_id` constant, 7-day window.
- **Tour to offer:** `tour completed` → `offer submitted`, hold `listing_id` constant, 14-day window (Totals counting: one conversion per toured home).
- **Financing:** `pre-approval started` → `pre-approval completed`.
- **New shopper financing:** `account created` → `pre-approval started`, 30-day window.
