# Routewise Freight tracking plan (event dictionary)

Event names are lowercase, as tracked. Properties are flat on each event. Times are UTC.

## Properties on every event

| Property | Meaning |
|---|---|
| `time` | When the event happened (UTC). |
| `user_id` | The shipper user's ID. Present on every event. |
| `insert_id` | Unique event ID used for de-duplication. |
| `company_tier` | The customer's tier: `enterprise`, `mid_market`, or `small_business`. Fixed per user. |

Events sent from the portal in the browser also carry `device_id` (the user's computer), `session_id` (diagnostic; Mixpanel computes its own sessions), and browser details from the web SDK (`browser`, `os`, `model`, `screen_height`, `screen_width`). Back-office events carry none of these; the tables below mark them.

## Regions

`origin_region` and `destination_region` use six regions:

| Region | States |
|---|---|
| `northeast` | New England, New York, New Jersey, Pennsylvania, Delaware, Maryland |
| `southeast` | Virginia, the Carolinas, Georgia, Florida, Alabama, Mississippi, Tennessee, Kentucky |
| `midwest` | Ohio, Michigan, Indiana, Illinois, Wisconsin, Minnesota, Iowa, Missouri, the Dakotas, Nebraska |
| `south_central` | Texas, Louisiana, Oklahoma, Arkansas, Kansas |
| `mountain` | Colorado, Utah, Nevada, Arizona, New Mexico, Idaho, Montana, Wyoming |
| `west_coast` | California, Oregon, Washington |

## Signup and onboarding

New shippers go through onboarding once, right after they sign up.

| Event | Sent from | Meaning | Properties |
|---|---|---|---|
| `account created` | portal | The user creates an account. First event of every new user and the moment their device is linked to their `user_id`. | `signup_method` (`email`, `google_sso`, `microsoft_sso`); `acquisition_channel`: how the customer found us (`organic`, `referral`, `google_ads`, `linkedin_ads`, `trade_media`), same value as the profile property. |
| `credit application submitted` | back office | The shipper submits the credit application. | `annual_freight_spend_band` (`under_1m`, `1m_to_10m`, `over_10m`); `years_in_business` (`under_2`, `2_to_5`, `5_to_10`, `over_10`). |
| `credit approved` | back office | The credit team approves the shipper. Only now can they book loads. Shippers who are not approved never get this event. | `credit_limit_usd`; `payment_terms` (`net_21`, `net_30`, `net_45`). |

## Shipments

Every shipment has a `shipment_id`, created with the quote. Every later step of the same load carries the same `shipment_id`. Most quotes are never booked.

| Event | Sent from | Meaning | Properties |
|---|---|---|---|
| `quote requested` | portal | The shipper prices a load. | `shipment_id`; `equipment_type` (`dry_van`, `reefer`, `flatbed`); `origin_region`; `destination_region`; `lane_miles`; `weight_lbs`; `quoted_rate_per_mile` (USD per mile); `quoted_total_usd` (the price for the load); `pickup_lead_days` (1-3: business days from booking to the requested pickup). |
| `load booked` | portal | The shipper books the quoted load at the quoted price. | `shipment_id`; `equipment_type`; `origin_region`; `destination_region`; `lane_miles`; `customer_rate_usd` (the linehaul price the shipper pays, before accessorials); `booking_method` (`negotiated`: booked through the usual flow with a rep; `instant`: one-click Instant Book, see 02-timeline.md); `appointment_scheduled` (true when the shipper booked a pickup dock appointment). |
| `carrier assigned` | back office | Routewise's carrier sales team covers the load with a carrier. | `shipment_id`; `equipment_type`; `carrier_tier` (`preferred`, `standard`, `new_partner`). |
| `pickup confirmed` | back office | The carrier confirms pickup. | `shipment_id`; `equipment_type`; `origin_region`; `destination_region`. |
| `shipment tracked` | portal | The shipper opens a load's tracking page while it is in transit. | `shipment_id`; `view_source` (`portal`: from the portal; `tracking_link`: from a shared link; `eta_notification`: from a Live ETA email or text, from 2026-07-21). |
| `delivery exception` | back office | The carrier reports a problem in transit. | `shipment_id`; `exception_type` (`weather_delay`, `mechanical`, `missed_appointment`, `traffic`, `consignee_closed`, `damage`, `shortage`); `delay_hours` (expected delay; 0 for damage or shortage). |
| `load delivered` | back office | The carrier delivers the load. | `shipment_id`; `equipment_type`; `origin_region`; `destination_region`; `on_time` (true when it arrived by the delivery appointment); `transit_hours` (pickup to delivery). |
| `accessorial charged` | back office | An extra charge is added to the load after delivery. A load can have more than one. | `shipment_id`; `charge_type` (`detention`, `lumper`, `layover`); `amount_usd`. |
| `invoice paid` | back office | The shipper pays the load's invoice (linehaul plus accessorials). Invoices for loads delivered late in the window are often paid after it ends. | `shipment_id`; `amount_usd`; `days_to_pay` (days from delivery to payment); `payment_method` (`ach`, `card`, `check`). |
| `support ticket created` | portal | The shipper opens a support ticket about a load. | `shipment_id`; `ticket_category` (`tracking_status`: where is my load; `booking_change`: change a pickup or details before pickup; `delivery_issue`: a problem with the delivery; `billing_question`); `contact_channel` (`chat`, `email`, `phone`). |
| `$experiment_started` | portal | Mixpanel experiment exposure, sent once per shipper user in the Instant Book test, one second before their first dry van quote on or after 2026-08-11. Later quotes do not send it again. | `Experiment name` = `Instant Book`; `Variant name` = `Control` or `Instant Book`. |

## Portal

| Event | Sent from | Meaning | Properties |
|---|---|---|---|
| `dashboard viewed` | portal | The user opens a portal dashboard. Usually the start of a portal session. | `dashboard_name` (`active_shipments`, `spend_overview`, `carrier_scorecard`, `lane_analytics`, `invoices`). |
| `lane saved` | back office (lanes service) | The user saves a lane they ship regularly. New shippers can save their first lane in onboarding, right after signup. | `equipment_type`; `origin_region`; `destination_region`. |
| `rate lookup` | portal | The user checks the market rate for a lane in the rate tool (no quote is created). | `equipment_type`; `origin_region`; `destination_region`. |
| `document downloaded` | portal | The user downloads a shipping document. | `document_type` (`bill_of_lading`, `proof_of_delivery`, `rate_confirmation`, `invoice_pdf`). |
| `report exported` | portal | The user exports a report. | `report_type` (`shipment_history`, `freight_spend`, `on_time_performance`, `accessorials`); `file_format` (`csv`, `xlsx`, `pdf`). |

## User profile properties

| Property | Meaning |
|---|---|
| `distinct_id` | The user's ID (same as `user_id` on events). |
| `name`, `email`, `avatar` | Contact details. |
| `company_tier` | `enterprise`, `mid_market`, `small_business` (same as on events). |
| `industry` | `retail`, `food_beverage`, `manufacturing`, `building_materials`, `consumer_goods`, `automotive`, `chemicals`. |
| `primary_equipment` | The equipment the customer ships most: `dry_van`, `reefer`, `flatbed`. |
| `home_region` | Region of the customer's main shipping facility. |
| `acquisition_channel` | Channel at signup (for established customers, the channel they originally came from). |
| `customer_since` | Date the customer signed up (YYYY-MM-DD). Before 2026-06-04 for established customers. |
| `credit_limit_usd` | Approved credit limit. |
| `payment_terms` | `net_21`, `net_30`, `net_45`. |
| `annual_freight_spend_band` | `under_1m`, `1m_to_10m`, `over_10m`. |
| `saved_lanes` | Number of lanes the user has saved. |
| `Experiment: Instant Book` | `Control` or `Instant Book` for users exposed in the test; empty for everyone else. |
| `created` | Signup time for users who joined in the window (the time of their `account created` event); empty for established customers. |
| `_persona` | Account segment from the CRM (`enterprise_shipper`, `mid_market_shipper`, `small_business_shipper`). |
| `anonymousIds`, `sessionIds` | Devices and sessions seen for the user (pipeline metadata). |

## Funnels the business tracks

| Funnel | Steps | Notes |
|---|---|---|
| Shipper onboarding | `account created` → `credit application submitted` → `credit approved` | New shippers only. Read with a 7-day conversion window. |
| Quote to book | `quote requested` → `load booked` | Shippers price many loads; hold `shipment_id` constant and count Totals to follow each quote. Read with a 7-day conversion window. |
| Load lifecycle | `load booked` → `carrier assigned` → `pickup confirmed` → `load delivered` → `invoice paid` | Hold `shipment_id` constant. Invoices often fall after the window ends for late-window loads. |
