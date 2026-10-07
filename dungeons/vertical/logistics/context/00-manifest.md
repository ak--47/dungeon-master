# Routewise Freight analytics: read me first

This folder is the internal analytics wiki for **Routewise Freight**, a digital truckload freight broker. It explains the business, the calendar of the period, the tracking plan, and the business tables in the data warehouse. Read it before you answer questions about the Routewise Mixpanel project or its raw data exports.

## What the dataset covers

- **Product:** the Routewise shipper portal. Shippers price loads, book them, follow them to delivery, download shipping documents, export reports, and pay invoices. Routewise covers each booked load with a carrier from its network.
- **Window:** 2026-06-04 00:00 to 2026-10-01 23:59 (UTC). That is 120 days, from early June through the end of September and the first day of October.
- **Scale:** about 10,000 shipper users were active in the window. About 4,500 of them signed up during the window; the rest were customers before June 4. The project holds about 810,000 events: about 152,000 quotes and about 49,000 loads booked in the window.
- **Network:** loads move between six US regions (northeast, southeast, midwest, south_central, mountain, west_coast) on three equipment types (dry van, reefer, flatbed).
- **Time zone:** every timestamp, daily bucket, and warehouse date is UTC. Shippers work US business hours, so most activity falls between 12:00 and 01:00 UTC.

## The other files

- **`01-business.md`** — who Routewise is, how a load moves through the portal, the customer tiers and payment terms, the industries and equipment we serve, how shippers find us, and the goals for the quarter. Read it to understand what a metric means for the business.
- **`02-timeline.md`** — dated launches, an experiment, holidays, a hurricane, and org changes in the window. Read it whenever a question mentions a date, a "before and after", or an unexplained bump or dip in a chart.
- **`03-event-dictionary.md`** — every event, event property, and user profile property: what each one means in the product and what its values mean. It also lists the funnels the business tracks. Read it before you build any report.
- **`04-metrics-and-tables.md`** — how Routewise defines its KPIs (quote-to-book rate, time to cover, on-time delivery, support tickets per load, accessorials, credit approval, CAC, gross margin, and others), and a data dictionary for the three warehouse tables. Read it for metric definitions and whenever a question involves the spot market, margin, or marketing spend.

## How the data fits together

- **Events** (the Mixpanel event stream) record what shippers do in the portal and what happens to their loads. Each event has a timestamp, the shipper user's identity, and flat properties. The shipper's company tier is copied onto every event (`company_tier`), so you can break down events without a lookup.
- **Shipments** tie events together. A quote creates a `shipment_id`, and every later step of that load (booking, carrier assignment, pickup, tracking views, exceptions, delivery, accessorial charges, the invoice payment, and related support tickets) carries the same `shipment_id`. Most quotes are never booked, so most shipment ids have only a quote.
- **User profiles** hold one row per shipper user with current attributes: company tier, industry, main equipment, home region, acquisition channel, customer-since date, credit limit, payment terms, freight spend band, saved lanes, and experiment enrollment.
- **Warehouse tables** are daily business facts that are not in the event stream: a third-party spot market index by equipment, billed revenue and gross margin by booking method, and paid marketing spend by channel. They join to events on the UTC date and a shared dimension (`equipment_type`, `booking_method`, or `acquisition_channel`).
- There are no group profiles and no slowly changing dimension tables in this project.

## Identity notes

- A new shipper user is identified when they create an account. `account created` is each new user's first event and carries both the `user_id` and the `device_id` of their computer. There is no anonymous pre-signup activity in the data.
- Every event carries `user_id`. Events sent from the portal in the browser (quotes, bookings, tracking views, tickets, dashboards, rate lookups, documents, reports, experiment exposures, and `account created`) also carry `device_id` and browser details. Events sent by back-office systems carry `user_id` only: `credit application submitted`, `credit approved`, `lane saved`, and the carrier and billing events (`carrier assigned`, `pickup confirmed`, `delivery exception`, `load delivered`, `accessorial charged`, `invoice paid`).
- Shipper users work from one to a few computers; `device_id` changes between them. Count people with unique `user_id` (Mixpanel "Uniques"), not with `device_id`.
- Users who were customers before June 4 have no `account created` event in this window. Their `customer_since` profile date is before the window. For users who joined in the window, `customer_since` is their signup date.

## Conventions

- Event and property names are lowercase with spaces or underscores, as tracked. The Mixpanel experiment fields keep their original capitalization.
- Money is in US dollars. Rates are per loaded mile.
- "Loads" means booked shipments. "Quotes" means `quote requested` events.
- "September" means September 1-30; the window's last day (October 1) is reported separately.
