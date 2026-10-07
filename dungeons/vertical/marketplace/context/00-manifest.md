# Tradepost analytics: read me first

This folder is the internal analytics wiki for **Tradepost**, a peer-to-peer resale marketplace. It explains the business, the calendar of the period, the tracking plan, and the business tables in the data warehouse. Read it before you answer questions about the Tradepost Mixpanel project or its raw data exports.

## What the dataset covers

- **Product:** the Tradepost iOS and Android apps. Buyers browse and search listings, save items, buy now or make an offer, check out, and receive the item by mail; afterwards they can leave a review or open a dispute. Sellers list items, drop prices, sell, and print a prepaid shipping label.
- **Window:** 2026-06-04 00:00 to 2026-10-01 23:59 (UTC). That is 120 days, from early June through the end of September and the first day of October.
- **Scale:** about 10,000 people have activity in the window. About 4,640 of them signed up during the window; the rest joined before June 4. About 330 more people started signing up but never finished (see Identity notes). The project holds about 750,000 events. About 70% of members only buy; about 2,150 are casual sellers and about 770 are Tradepost Pro sellers.
- **Time zone:** every timestamp, daily bucket, and warehouse date is UTC. Members are in the United States, so a US evening falls after midnight UTC.

## The other files

- **`01-business.md`** — who Tradepost is, how buying and selling work, fees and plans, member types, how members find us, and the goals for the period. Read it to understand what a metric means for the business.
- **`02-timeline.md`** — dated pricing changes, an experiment, a launch, a seasonal campaign, an incident, holidays, and org changes in the window. Read it whenever a question mentions a date, a "before and after", or an unexplained bump or dip in a chart.
- **`03-event-dictionary.md`** — every event, event property, and user profile property: what each one means in the product and what its values mean. It also lists the funnels the business tracks. Read it before you build any report.
- **`04-metrics-and-tables.md`** — how Tradepost defines its KPIs (conversion, sell-through, time to sell, activation, CAC, GMV, take rate, and others), and a data dictionary for the three warehouse tables. Read it for metric definitions and whenever a question involves marketing spend, payments, GMV, fees, or refunds.

## How the data fits together

- **Events** (the Mixpanel event stream) record what members do in the app and what Tradepost's servers send about their orders. Each event has a timestamp, the member's identity, and flat properties. The member's phone platform and region are copied onto every event (`platform`, `region`).
- **Listings and orders tie events together.** On the buyer side, the events about one item share a `listing_id`; everything from checkout onward also shares an `order_id`, and an offer's events share an `offer_id`. On the seller side, a listing and everything that follows from it (price drops, the sale, the shipping label) share a `listing_id`. Listing attributes (category, price, condition, photo count, seller type) are copied onto the events, so you never need a lookup table.
- **Buyers and sellers are different streams.** A seller's `item sold` and a buyer's `purchase completed` are tracked by different services for different people; this export does not link a buyer's order to a seller's listing.
- **User profiles** hold one row per person with their current attributes: account type, acquisition channel, region, age band, member-since date, and experiment enrollment.
- **Warehouse tables** are daily business facts that are not in the event stream: paid marketing spend by channel, card and wallet payment processing by payment method, and the marketplace ledger (GMV, orders, take rate, fee revenue, refunds) by seller type. They join to events on the UTC date and a shared dimension (`acquisition_channel`, `payment_method`, or `seller_type`).
- There are no group profiles and no slowly changing dimension tables in this project.

## Identity notes

- Guests can browse Tradepost before they sign up. Guest events (`home feed viewed`, `listing viewed`, `search performed`) carry only the `device_id` of the phone.
- `account created` is each new member's signup. It carries both `user_id` and `device_id`, so Mixpanel links the guest browsing on that phone to the new member.
- The two events right after signup (the first search and listing view) carry `user_id` only. Server-side events (`offer accepted`, `offer declined`, `order shipped`, `order delivered`, `item sold`) also carry `user_id` only. Every other member event carries both ids.
- Each member uses one phone: an iPhone, an iPad, or an Android phone. `platform` is `ios` for iPhone and iPad (`os` = `iOS` or `iPadOS`) and `android` for Android phones.
- About 330 people started signing up but never finished. Their few days of guest browsing stay anonymous (device id only). Their records in the raw user export carry `_drop: true` and are not loaded into Mixpanel as profiles.
- Members who joined before June 4 have no `account created` event in this window; their `member_since` profile date is before the window. For members who joined in the window, `member_since` is their signup date.
- Count people with unique `user_id` (Mixpanel "Uniques" after identity merge). Unique counts on guest-heavy events also include the anonymous guests.

## Conventions

- Event and property names are lowercase with spaces or underscores, as tracked. The Mixpanel experiment fields keep their original capitalization.
- Money is in US dollars. Item prices are whole dollars.
- "Casual sellers" are members with `account_type` = `seller`; "Pro sellers" have `account_type` = `pro_seller`. On listing and order events the same split appears as `seller_type` = `casual` or `pro`.
- "September" means September 1-30; the window's last day (October 1) is reported separately.
