# Kindred analytics: read me first

This folder is the internal analytics wiki for **Kindred**, a mobile dating app for people who want a relationship. It explains the business, the calendar of the period, the tracking plan, and the business tables in the data warehouse. Read it before you answer questions about the Kindred Mixpanel project or its raw data exports.

## What the dataset covers

- **Product:** the Kindred iOS and Android apps: profiles with photos and prompts, liking and passing on profiles, matches, chat, in-app date planning, post-date feedback, and the paid plans Kindred+ and Kindred Premier.
- **Window:** 2026-06-04 00:00 to 2026-10-01 23:59 (UTC). That is 120 days, from early summer through the end of September and the first day of October.
- **Scale:** about 10,000 members were active in the window. About 4,500 of them signed up during the window; the rest joined before June 4. The project holds about 770,000 events.
- **Markets:** members live in ten US cities, London, and Toronto.
- **Time zone:** every timestamp, daily bucket, and warehouse date is UTC. Most members are in US time zones, so a US evening falls after midnight UTC.

## The other files

- **`01-business.md`** — who Kindred is, how dating on Kindred works, the plans and what they include, how members find us, the member segments the business talks about, and the goals for the period. Read it to understand what a metric means for the business.
- **`02-timeline.md`** — dated launches, an experiment, a price change, an incident, holidays, and org changes in the window. Read it whenever a question mentions a date, a "before and after", or an unexplained bump or dip in a chart.
- **`03-event-dictionary.md`** — every event, event property, and user profile property: what each one means in the product and what its values mean. It also lists the funnels the business tracks. Read it before you build any report.
- **`04-metrics-and-tables.md`** — how Kindred defines its KPIs (match rate, opener rate, date rate, retention, paid conversion, CAC, bookings, message delivery, and others), and a data dictionary for the three warehouse tables. Read it for metric definitions and whenever a question involves marketing spend, message delivery, prices, or bookings.

## How the data fits together

- **Events** (the Mixpanel event stream) record what members do in the app. Each event has a timestamp, the member's identity, and flat properties. The member's plan at the time, phone platform, and market are copied onto every event (`subscription_plan`, `platform`, `market`), so you can break down events without a lookup table.
- **Matches** tie events together. A match and everything that follows from it (the first message, later messages, a planned date, and the post-date feedback) share one `match_id`.
- **User profiles** hold one row per member with their current attributes: market, age band, gender, who they are looking for, relationship goal, photo count, current plan, acquisition channel, member-since date, verification status, and experiment enrollment.
- **Warehouse tables** are daily business facts that are not in the event stream: paid acquisition spend by channel, chat message delivery health by platform, and new subscriptions, list prices, and bookings by plan and billing period. They join to events on the UTC date and a shared dimension (`acquisition_channel`, `platform`, or `plan` + `billing_period`).
- There are no group profiles and no slowly changing dimension tables in this project.

## Identity notes

- A new member is identified when they create an account. `account created` is each new member's first event and carries both the member's `user_id` and the `device_id` of their phone. There is no anonymous pre-signup activity in the data.
- Every event carries `user_id`. Almost every event also carries `device_id`; the exceptions are the two profile setup steps after signup (`photos uploaded`, `profile completed`), which the profile service sends server-side with `user_id` only.
- Each member uses one device: an iPhone, an iPad, or an Android phone. `platform` is `ios` for iPhone and iPad (`os` = `iOS` or `iPadOS`) and `android` for Android phones.
- Members who joined before June 4 have no `account created` event in this window. Their `member_since` profile date is before the window. For members who joined in the window, `member_since` is their signup date.
- Count people with unique `user_id` (Mixpanel "Uniques"), not with `device_id`.

## Conventions

- Event and property names are lowercase with spaces or underscores, as tracked. The Mixpanel experiment fields keep their original capitalization.
- Money is in US dollars. List prices are for the whole billing period (1, 3, or 6 months).
- "Paid plans" means Kindred+ (`plus`) and Kindred Premier (`premier`).
- "September" means September 1-30; the window's last day (October 1) is reported separately.
