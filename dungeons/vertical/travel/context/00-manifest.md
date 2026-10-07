# Driftway Travel analytics: read me first

This folder is the internal analytics wiki for **Driftway Travel**, an app and website for booking hotels and vacation rentals. It explains the business, the calendar of the period, the tracking plan, and the business tables in the data warehouse. Read it before you answer questions about the Driftway Mixpanel project or its raw data exports.

## What the dataset covers

- **Product:** the Driftway iOS app, Android app, and website: destination search, property pages, checkout, bookings, cancellations, check-in, guest reviews, wishlists, price alerts, notifications, and member support.
- **Window:** 2026-06-04 00:00 to 2026-10-01 23:59 (UTC). That is 120 days, the whole summer travel season through the end of September and the first day of October.
- **Scale:** about 10,000 members were active in the window. About 5,000 of them created their account during the window; the rest joined before June 4. The project holds about 1.5 million events and about 21,000 bookings.
- **Travelers:** members live in US cities, Toronto, London, and Manchester. They book stays in 28 destinations in five regions (US cities, US beaches, mountains, the Caribbean, and Europe).
- **Time zone:** every timestamp, daily bucket, and warehouse date is UTC. Most members are in US time zones, so a US evening falls after midnight UTC.

## The other files

- **`01-business.md`** — who Driftway is, how booking works, how Driftway makes money, Driftway Rewards, Flex Pay, the traveler segments the business talks about, how members find us, and the goals for the period. Read it to understand what a metric means for the business.
- **`02-timeline.md`** — dated campaigns, launches, an experiment, an incident, a storm, holidays, and org changes in the window. Read it whenever a question mentions a date, a "before and after", or an unexplained bump or dip in a chart.
- **`03-event-dictionary.md`** — every event, event property, and user profile property: what each one means in the product and what its values mean. It also lists the funnels the business tracks. Read it before you build any report.
- **`04-metrics-and-tables.md`** — how Driftway defines its KPIs (search conversion, booking rate, cancellations, time to book, retention, CAC, approval rate, and others), and a data dictionary for the three warehouse tables. Read it for metric definitions and whenever a question involves marketing spend, card payments, hotel supply, or weather.

## How the data fits together

- **Events** (the Mixpanel event stream) record what members do in the app and on the website, plus the messages Driftway sends them. Each event has a timestamp, the member's identity, and flat properties. The device platform (`platform`: `ios`, `android`, or `web`) is on every event.
- **Search sessions** tie the shopping events together. A `destination searched` event starts a search session; the property pages viewed for that search, the checkout, and the booking all carry the same `search_id`.
- **Bookings** tie the stay events together. A booking and everything that follows from it (a cancellation, the check-in, the guest review) share one `booking_id`. Property details (name, type, destination, region, stars, review count, guest rating) are copied onto the events, so you never need a lookup table.
- **User profiles** hold one row per member with their current attributes: traveler segment, home market, age band, acquisition channel, Rewards tier, member-since date, push permission, and experiment enrollment.
- **Warehouse tables** are daily business facts that are not in the event stream: paid marketing spend by channel, card payment authorizations by platform, and hotel supply and weather by region. They join to events on the UTC date and a shared dimension (`acquisition_channel`, `platform`, or `region`).
- There are no group profiles and no slowly changing dimension tables in this project.

## Identity notes

- A traveler can browse before they have an account. A new member's first search and the property pages they open before signing up carry only an anonymous `device_id`. `account created` carries both the new `user_id` and that `device_id`; Mixpanel merges the anonymous events into the member from that moment. Count people with unique members (resolved `user_id`), not with `device_id`.
- After signup, every event carries `user_id` and `device_id`. Members use about two devices on average (typically a phone and a computer), so one member can have activity on more than one platform.
- `platform` follows the device: `ios` for iPhone and iPad (`os` = `iOS` or `iPadOS`), `android` for Android phones, `web` for the website on a computer (`os` = `Windows`, `macOS`, `Linux`, and similar).
- Members who joined before June 4 have no `account created` event in this window; their `member_since` profile date is before the window. Stays they booked before June 4 still show up as cancellations, check-ins, and reviews in the window, but the booking event itself is not in the data.
- Messages Driftway sends (`notification received`) are server-side. They keep arriving for members who have stopped using the app.

## Conventions

- Event and property names are lowercase with spaces or underscores, as tracked. The Mixpanel experiment fields keep their original capitalization.
- Money is in US dollars. Nightly rates are before taxes and fees; `total_price` includes them.
- "September" means September 1-30; the window's last day (October 1) is reported separately. "Q3" means July 1 to September 30.
