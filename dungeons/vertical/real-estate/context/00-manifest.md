# Keystead Homes analytics: read me first

This folder is the internal analytics wiki for **Keystead Homes**, a home-search app and buyer brokerage. It explains the business, the calendar of the period, the tracking plan, and the business tables in the data warehouse. Read it before you answer questions about the Keystead Mixpanel project or its raw data exports.

## What the dataset covers

- **Product:** the Keystead Homes website and iOS and Android apps: home search, listing pages, saved homes and saved searches, listing alerts, chat with a Keystead buyer agent, tour booking, mortgage pre-approval with Keystead Home Loans, and offers written through the agent.
- **Window:** 2026-06-04 00:00 to 2026-10-01 23:59 (UTC). That is 120 days, from early summer through the end of September and the first day of October.
- **Scale:** 10,000 shopper accounts; 9,747 of them have activity in the window. About 4,500 created their account during the window; the rest joined before June 4. The project holds about 1.13 million events.
- **Population:** this project is an export of account holders. It includes each new shopper's anonymous browsing before signup on the device they signed up on, but visitors who browse without ever creating an account are not in the export. Their page views show up only in the server-log traffic in `market_inventory_daily`.
- **Markets:** eight metro areas: Dallas, Austin, Phoenix, Denver, Nashville, Charlotte, Tampa, and Raleigh.
- **Time zone:** every timestamp, daily bucket, and warehouse date is UTC. Shoppers live in US Central, Eastern, and Mountain time, so a US evening falls after midnight UTC.

## The other files

- **`01-business.md`** — who Keystead is, how buying a home with Keystead works, how the company makes money, how shoppers find us, the shopper segments the business talks about, and the goals for the period. Read it to understand what a metric means for the business.
- **`02-timeline.md`** — dated launches, an experiment, a market event, an outage, holidays, and org changes in the window. Read it whenever a question mentions a date, a "before and after", or an unexplained bump or dip in a chart.
- **`03-event-dictionary.md`** — every event, event property, and user profile property: what each one means in the product and what its values mean. It also lists the funnels the business tracks. Read it before you build any report.
- **`04-metrics-and-tables.md`** — how Keystead defines its KPIs (tour conversion, offer rate, time to offer, retention, CAC, and others), and a data dictionary for the three warehouse tables. Read it for metric definitions and whenever a question involves marketing spend, mortgage rates, or listing inventory.

## How the data fits together

- **Events** (the Mixpanel event stream) record what shoppers do in the product and what Keystead's systems do for them (agent replies, completed tours, lender decisions, alerts, offer outcomes). Each event has a timestamp, the shopper's identity, and flat properties.
- **Listings** tie events together. A listing view, a save, an agent chat, a tour request, a completed tour, an offer, and its outcome for the same home share one `listing_id`. Listing facts (market, list price, type, bedrooms, days on market, and whether the price has been cut) are copied onto the events about that listing as of the moment of the event, so you never need a lookup table. Many shoppers look at the same listings.
- **User profiles** hold one row per shopper with current attributes: home market, buyer type, budget, how they found us, member-since date, pre-approval status, number of saved searches, and experiment enrollment.
- **Warehouse tables** are daily business facts that are not in the event stream: paid marketing spend by channel, the Keystead Home Loans rate sheet and applications by loan type, and MLS listing inventory and listing-page traffic by market. They join to events on the UTC date and a shared dimension (`acquisition_channel`, `loan_type`, or `market`).
- There are no group profiles and no slowly changing dimension tables in this project.

## Identity notes

- Shoppers who join during the window usually browse a few listings before they create an account. That browsing is anonymous: the events carry a `device_id` and no `user_id`.
- `account created` is the moment a new shopper is identified. It carries both the shopper's `user_id` and the `device_id` they signed up on, and Mixpanel links the earlier anonymous events on that device to the shopper. Every anonymous event in this export links to an account.
- Every event after signup carries `user_id`. Events sent from the shopper's device also carry `device_id`. Events sent by Keystead's servers carry `user_id` only: `agent responded`, `tour completed`, `pre-approval completed`, `offer accepted`, `offer rejected`, and `listing alert sent`.
- Shoppers use about two devices on average (a phone and a laptop or tablet). Device fields (`os`, `model`, `browser`, screen size) describe the device that sent the event.
- Shoppers who joined before June 4 have no `account created` event and no anonymous events in this window.
- Count people with unique `user_id` (Mixpanel "Uniques" after identity merge), not with `device_id`.

## Conventions

- Event and property names are lowercase with spaces or underscores, as tracked. The Mixpanel experiment fields keep their original capitalization.
- Money is in US dollars. Prices are list prices of homes unless a property says otherwise.
- "September" means September 1-30; the window's last day (October 1) is reported separately.
