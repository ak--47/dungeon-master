# The Lantern analytics: read me first

This folder is the internal analytics wiki for **The Lantern**, an independent national digital news publication. It explains the business, the calendar of the period, the tracking plan, and the business tables in the data warehouse. Read it before you answer questions about The Lantern Mixpanel project or its raw data exports.

## What the dataset covers

- **Product:** The Lantern website and the iOS and Android apps: articles across ten sections, the home page and section fronts, search, recommendations, six email newsletters, three podcasts, push alerts, saved articles, comments, sharing, the free-account registration wall, the metered paywall, and the two paid plans (Lantern Digital and Lantern All Access).
- **Window:** 2026-06-04 00:00 to 2026-10-01 23:59 (UTC). That is 120 days, from early June through the end of September and the first day of October.
- **Scale:** about 10,000 readers were active in the window. About 7,300 of them have an account (registered free readers and subscribers); about 2,700 were visitors who read without ever registering. About 4,500 new visitors arrived during the window and about 1,800 of them registered. The project holds about 890,000 events.
- **Readers:** mostly in the United States, with some in Canada, the UK, and elsewhere.
- **Time zone:** every timestamp, daily bucket, and warehouse date is UTC. Most readers are in US time zones, so a US evening falls after midnight UTC.

## The other files

- **`01-business.md`** — who The Lantern is, how reading and the paywall work, the plans and prices, how readers find us, the reader segments the business talks about, and the goals for the period. Read it to understand what a metric means for the business.
- **`02-timeline.md`** — dated events in the window: a major sporting event, an app experiment, a product launch, an incident, a sale, holidays, and org changes. Read it whenever a question mentions a date, a "before and after", or an unexplained bump or dip in a chart.
- **`03-event-dictionary.md`** — every event, event property, and user profile property: what each one means in the product and what its values mean. It also lists the funnels the business tracks. Read it before you build any report.
- **`04-metrics-and-tables.md`** — how The Lantern defines its KPIs (new visitors, registration rate, paywall conversion, recirculation, sharing, reading days, churn, CAC, bookings, and others), and a data dictionary for the three warehouse tables. Read it for metric definitions and whenever a question involves marketing spend, platform reliability, prices, or bookings.

## How the data fits together

- **Events** (the Mixpanel event stream) record what readers do. Each event has a timestamp, the reader's identity, and flat properties. The reader's access tier at the time (`reader_tier`), the platform of the device (`platform`), and the channel that first brought the reader to The Lantern (`acquisition_channel`) are on every event, so you can break down events without a lookup table. Article attributes (section, content type, article ID) are on the article events themselves.
- **User profiles** hold one row per account with current attributes: acquisition channel, region, age band, current access tier, member-since date, and experiment enrollment. Visitors who never registered have no profile.
- **Warehouse tables** are daily business facts that are not in the event stream: paid marketing spend by channel, platform reliability (pageviews served, meter errors, page load, service status) by platform, and new subscriptions, prices, and bookings by plan and billing period. They join to events on the UTC date and a shared dimension (`acquisition_channel`, `platform`, or `plan` + `billing_period`).
- There are no group profiles, no lookup tables, and no slowly changing dimension tables in this project.

## Identity notes

- A new visitor's first article is read anonymously: the event carries a `device_id` and no `user_id`, and its `reader_tier` is `anonymous`. The registration wall (`regwall shown`) follows on the same device.
- A visitor who creates a free account fires `account registered`, which carries both the new `user_id` and the `device_id`. Mixpanel links the device to the account at that moment, so the visitor's earlier anonymous events count toward the same person.
- Visitors who never register stay anonymous: their events carry only a `device_id`, and Mixpanel counts each such device as one user.
- Every other event carries both `user_id` and `device_id`. Most readers use one to three devices (laptop, phone, tablet), a few use more; every device in an account is linked to that account.
- Readers who had an account before June 4 have no `account registered` event in this window. Their `member_since` profile date is before the window. For accounts created in the window, `member_since` is the registration date.
- Count people with Mixpanel "Uniques" (resolved identity), not with raw `device_id`.

## Conventions

- Event and property names are lowercase with spaces or underscores, as tracked. The Mixpanel experiment fields keep their original capitalization.
- Money is in US dollars. Prices are per billing period (one month or one year).
- "Subscribers" means readers on Lantern Digital (`digital`) or Lantern All Access (`all_access`). "Free readers" means registered readers without a subscription (`registered`).
- "September" means September 1-30; the window's last day (October 1) is reported separately.
