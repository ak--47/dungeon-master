# Marlowe & Pine analytics: read me first

This folder is the internal analytics wiki for **Marlowe & Pine**, a direct-to-consumer home goods brand. It explains the business, the calendar of the period, the tracking plan, and the business tables in the data warehouse. Read it before you answer questions about the Marlowe & Pine Mixpanel project or its raw data exports.

## What the dataset covers

- **Product:** the Marlowe & Pine online store: the website and the iOS and Android shopping apps. Shoppers browse eight categories (bedding, bath, kitchen, dining, furniture, lighting, decor, outdoor), build carts, check out, and receive their orders by parcel carrier. Marlowe & Pine ships to the United States, Canada, and the United Kingdom.
- **Window:** 2026-06-04 00:00 to 2026-10-01 23:59 (UTC). That is 120 days, from early June through the first day of Q4.
- **Scale:** about 10,000 customer accounts were active in the window. About 4,000 of them created their account during the window; the rest were customers before June 4. About 5,900 customers placed at least one order. The project holds about 1.2 million events and about 11,500 orders.
- **Time zone:** every timestamp, daily bucket, and warehouse date is UTC. Most customers are in the US, so a US evening falls after midnight UTC.

## The other files

- **`01-business.md`** — who Marlowe & Pine is, what it sells, how shipping and the Pine Plus membership work, how customers find us, the shopper segments the business talks about, and the goals for the period. Read it to understand what a metric means for the business.
- **`02-timeline.md`** — dated launches, the checkout experiment, a shipping policy change, a carrier problem, an inventory problem, a sale, holidays, and org changes in the window. Read it whenever a question mentions a date, a "before and after", or an unexplained bump or dip in a chart.
- **`03-event-dictionary.md`** — every event, event property, and user profile property: what each one means in the product and what its values mean. It also lists the funnels the business tracks. Read it before you build any report.
- **`04-metrics-and-tables.md`** — how Marlowe & Pine defines its KPIs (cart conversion, checkout time, repeat rate, CAC, and others), and a data dictionary for the three warehouse tables. Read it for metric definitions and whenever a question involves marketing spend, carriers and delivery, or inventory.

## How the data fits together

- **Events** (the Mixpanel event stream) record what shoppers do in the store and what happens to their orders. Each event has a timestamp, the shopper's identity, and flat properties. Product attributes (product ID, name, category, price) are copied onto every product event, so you can break down events without a lookup table.
- **Carts and orders.** Every step of one cart (adds, cart view, checkout steps, the order) carries the same `cart_id`. An order carries an `order_id`; the shipment, the delivery, a return, and a review of that order carry the same `order_id`.
- **User profiles** hold one row per customer with their current attributes: shopper segment, Pine Plus membership, shipping country, acquisition channel, customer-since date, and experiment enrollment.
- **Warehouse tables** are daily business facts that are not in the event stream: paid media spend by channel, parcel carrier service levels, and inventory by product category. They join to events on the UTC date and a shared dimension (`acquisition_channel`, `shipping_carrier`, or `primary_category` / `category`).
- There are no group (company) profiles and no slowly changing dimension tables.

## Identity notes

- A new shopper browses before they have an account. Their first visit (usually a category browse and a product view) is anonymous and carries only a `device_id`. When they create an account, `account created` carries both their `user_id` and the `device_id`, and Mixpanel links the earlier anonymous events to the customer. Anonymous events link to a customer this way, except a visit in the last minutes of October 1 by a shopper who had not finished signing up when the window closed.
- An account is required to check out; there is no guest checkout. So every cart and order belongs to a known customer.
- Every event after account creation carries `user_id`. Events from the website and apps also carry `device_id`; customers use about two devices (for example a phone and a laptop). `order shipped` and `order delivered` come from the fulfillment system and carry `user_id` only, with no device or platform.
- Customers who joined before June 4 have no `account created` event in this window. Their `customer_since` profile date is before the window. For customers who joined in the window, `customer_since` is their signup date.
- Count people with unique `user_id` (Mixpanel "Uniques"), not with `device_id`.

## Conventions

- Event and property names are lowercase with spaces or underscores, as tracked. The Mixpanel experiment fields keep their original capitalization.
- Money is in US dollars. Orders from Canada and the UK are recorded in US dollars at the exchange rate on the order date.
- Order totals exclude sales tax and VAT.
