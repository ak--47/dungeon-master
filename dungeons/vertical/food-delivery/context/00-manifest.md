# Forkfly analytics: read me first

This folder is the internal analytics wiki for **Forkfly**, a food delivery app that works with a curated set of local restaurants in eight US cities. It explains the business, the calendar of the period, the tracking plan, and the business tables in the data warehouse. Read it before you answer questions about the Forkfly Mixpanel project or its raw data exports.

## What the dataset covers

- **Product:** the Forkfly iOS and Android apps: browsing and searching restaurants, building a cart, checkout, payment, delivery tracking, ratings, support contacts, the Order Again shortcut, and the Forkfly Pass membership.
- **Window:** 2026-06-04 00:00 to 2026-10-01 23:59 (UTC). That is 120 days, from early June through the end of September and the first day of October.
- **Scale:** about 10,000 customers were active in the window. About 4,200 of them signed up during the window; the rest were already customers on June 4. The project holds about 810,000 events, including about 42,400 orders.
- **Markets:** New York, Chicago, Atlanta, Miami, Boston, Austin, Denver, and Seattle.
- **Time zone:** every timestamp, daily bucket, and warehouse date is UTC. Customers are in US time zones, so a US dinner order often falls after midnight UTC, on the next UTC date.

## The other files

- **`01-business.md`** — who Forkfly is, how ordering and delivery work, fees and Forkfly Pass, how customers find us, the customer segments the business talks about, and the goals for the period. Read it to understand what a metric means for the business.
- **`02-timeline.md`** — dated launches, an experiment, a fee change, an incident, holidays, and org changes in the window. Read it whenever a question mentions a date, a "before and after", or an unexplained bump or dip in a chart.
- **`03-event-dictionary.md`** — every event, event property, and user profile property: what each one means in the product and what its values mean. It also lists the funnels the business tracks. Read it before you build any report.
- **`04-metrics-and-tables.md`** — how Forkfly defines its KPIs (conversion, repeat rate, on-time delivery, CAC, Pass conversion, and others), and a data dictionary for the three warehouse tables. Read it for metric definitions and whenever a question involves marketing spend, payments, weather, couriers, or dispatch volume.

## How the data fits together

- **Events** (the Mixpanel event stream) record what customers do in the app plus a few server-side events (delivery, Pass billing). Each event has a timestamp, the customer's identity, and flat properties. The customer's city, phone platform, and Pass status at the time are copied onto every event (`city`, `platform`, `pass_status`), so you can break down events without a lookup table. Restaurant details (name, cuisine, price tier, rating) are also on the events that reference a restaurant.
- **Orders** tie events together. A checkout and everything that follows from it (a payment failure, the order, tracking views, the delivery, the rating, a support contact) share one `order_id`.
- **User profiles** hold one row per customer with their current attributes: city, platform, household type, favorite cuisine, acquisition channel, customer-since date, default payment method, current Pass status, and experiment enrollment.
- **Warehouse tables** are daily business facts that are not in the event stream: paid marketing spend by channel, payment gateway authorizations and declines by payment method, and dispatch volume, weather, and courier supply by city. They join to events on the UTC date and a shared dimension (`acquisition_channel`, `payment_method`, or `city`).
- There are no group profiles and no slowly changing dimension tables in this project.

## Identity notes

- A new customer is identified when they create an account. `account created` is each new customer's first event and carries both the customer's `user_id` and the `device_id` of their phone. There is no anonymous browsing in the data.
- Every event carries `user_id`. Every event except `address saved` also carries `device_id`; the address service sends `address saved` server-side with `user_id` only.
- Each customer uses one device: an iPhone, an iPad, or an Android phone. `platform` is `ios` for iPhone and iPad (`os` = `iOS` or `iPadOS`) and `android` for Android phones.
- Customers who joined before June 4 have no `account created` event in this window. Their `customer_since` profile date is before the window. For customers who joined in the window, `customer_since` is their signup date.
- Count people with unique `user_id` (Mixpanel "Uniques"), not with `device_id`.

## Conventions

- Event and property names are lowercase with spaces or underscores, as tracked. The Mixpanel experiment fields keep their original capitalization.
- Money is in US dollars. `subtotal_usd` is the food total before fees, tip, and discounts.
- "Pass customers" or "Pass orders" means `pass_status` is `trial` or `member` (both get Pass benefits).
- "September" means September 1-30; the window's last day (October 1) is reported separately.
