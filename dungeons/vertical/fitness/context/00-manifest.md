# Stridewell analytics: read me first

This folder is the internal analytics wiki for **Stridewell**, a consumer fitness app. It explains the product, the calendar of the period, the tracking plan, and the business tables that live in the data warehouse. Read it before you answer questions about the Stridewell Mixpanel project or its raw data exports.

## What the dataset covers

- **Product:** the Stridewell mobile app (iOS and Android) and its paid tier, Stridewell Plus.
- **Window:** 2026-06-04 00:00 to 2026-10-01 23:59 (UTC). That is 120 days, early summer through the end of Q3.
- **Scale:** about 9,000 members were active in the window. About 4,200 of them joined during the window; the rest were members before June 4. The project holds about 1.2 million events.
- **Time zone:** every timestamp, daily bucket, and warehouse date is UTC.

## The other files

- **`01-business.md`** — who Stridewell is, what members do in the app, the Free and Plus plans and their prices, how members find us, the member segments the business talks about, and the goals for the period. Read it to understand what a metric means for the business.
- **`02-timeline.md`** — dated launches, campaigns, the onboarding experiment, a pricing change, an incident, holidays, and org changes in the window. Read it whenever a question mentions a date, a "before and after", or an unexplained bump or dip in a chart.
- **`03-event-dictionary.md`** — every event, event property, user profile property, and the slowly changing `fitness_level` history: what each one means in the product and what its values mean. It also lists the funnels the business tracks. Read it before you build any report.
- **`04-metrics-and-tables.md`** — how Stridewell defines its KPIs (onboarding completion, trial-to-paid, CAC, retention, and others), and a data dictionary for the three warehouse tables. Read it for metric definitions and whenever a question involves spend, prices, bookings, or wearable sync health.

## How the data fits together

- **Events** (the Mixpanel event stream) record what members do in the app. Each event has a timestamp, the member's identity, and flat properties. Properties that describe the member's plan or device are copied onto events (for example `subscription_tier`, `Platform`, `wearable_type`, `acquisition_channel`), so you can break down events without a lookup table.
- **User profiles** hold one row per member with their current attributes: segment, goal, acquisition channel, wearable, current plan, and experiment enrollment.
- **`fitness_level` history** is a slowly changing record: each row is the member's self-reported fitness level from a given date. The profile shows the latest level.
- **Groups:** none. Stridewell has no team or company accounts.
- **Warehouse tables** are daily business facts that are not in the event stream: paid-media spend by channel, partner sync health by device type, and list prices and bookings by plan. They join to events on the UTC date and on a shared dimension (`acquisition_channel`, `wearable_type`, or `plan`).

## Identity notes

- The app tracks nothing before a member creates an account, so there is no anonymous (device-only) activity in the project. The `account created` event carries both the member's `user_id` and the `device_id`.
- Every event carries `user_id`, including the onboarding experiment's `$experiment_started` exposure, which is logged one second before `account created`. Members use about two devices on average; `device_id` changes between devices but `user_id` does not.
- Members who joined before June 4 have no `account created` event in this window. Their profile `created` field is empty. For members who joined in the window, `created` is their signup time.
- Count people with unique `user_id` (Mixpanel "Uniques"), not with `device_id`.

## Conventions

- Event and property names are lowercase with spaces or underscores, as tracked. `Platform` and the Mixpanel experiment fields keep their original capitalization.
- Money is in US dollars.
- "Plus" means either paid plan (Monthly or Annual).
