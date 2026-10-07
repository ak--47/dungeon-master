# Reelhouse analytics: read me first

This folder is the internal analytics wiki for **Reelhouse**, a subscription streaming service for independent film and prestige TV in the US and Canada. It explains the business, the calendar of the period, the tracking plan, and the business tables in the data warehouse. Read it before you answer questions about the Reelhouse Mixpanel project or its raw data exports.

## What the dataset covers

- **Product:** the Reelhouse apps on smart TVs and streaming boxes, phones, tablets, and the web: browsing and search, title pages, trailers, My List, playback, ratings, downloads, push notifications, the 7-day free trial, and the three paid plans (Basic with Ads, Standard, Premium).
- **Window:** 2026-06-04 00:00 to 2026-10-01 23:59 (UTC). That is 120 days, from early June through the end of September and the first day of October.
- **Scale:** about 10,000 households were active in the window. About 5,000 of them created their account during the window; the rest joined before June 4. The project holds about 970,000 events.
- **Markets:** households in the United States and Canada.
- **Time zone:** every timestamp, daily bucket, and warehouse date is UTC. Households watch in North American evenings, so the busiest hours fall between 23:00 and 06:00 UTC, and a US evening crosses midnight UTC.

## The other files

- **`01-business.md`** — who Reelhouse is, how the service works, the plans and prices, the catalog, how households find us, the household segments the business talks about, and the goals for the period. Read it to understand what a metric means for the business.
- **`02-timeline.md`** — dated launches, an experiment, a price change, an incident, holidays, and org changes in the window. Read it whenever a question mentions a date, a "before and after", or an unexplained bump or dip in a chart.
- **`03-event-dictionary.md`** — every event, event property, and user profile property: what each one means in the product and what its values mean. It also lists the funnels the business tracks. Read it before you build any report.
- **`04-metrics-and-tables.md`** — how Reelhouse defines its KPIs (trial conversion, churn, completion rate, reach, open rate, CAC, bookings, streaming quality, and others), and a data dictionary for the three warehouse tables. Read it for metric definitions and whenever a question involves marketing spend, streaming quality, prices, or bookings.

## How the data fits together

- **Events** (the Mixpanel event stream) record what households do in the apps, plus a few server-side billing events. Each event has a timestamp, the household's identity, and flat properties. The household's plan at the time, the platform, and the device family are on every event (`plan`, `platform`, `device_family`). Title attributes (name, type, genre, Original or licensed, rating, season, episode) are copied onto the events that involve a title, so you can break down viewing without a lookup table.
- **Playback** is tracked as a start and, when the viewer reaches the end, a completion. Not every start completes. A start that fails sends a `playback error` instead.
- **User profiles** hold one row per household with its current attributes: plan, subscription status, acquisition channel, number of viewer profiles, whether it has a kids profile, country, member-since date, and experiment enrollment.
- **Warehouse tables** are daily business facts that are not in the event stream: paid marketing spend by channel, streaming quality by platform, and new paid subscriptions, list prices, and bookings by plan. They join to events on the UTC date and a shared dimension (`acquisition_channel`, `platform`, or `plan`).
- There are no group profiles and no slowly changing dimension tables in this project.

## Identity notes

- A household is the unit of analysis. One account (one `user_id`) is shared by everyone in the home, and each person can have a viewer profile inside it.
- A new household is identified when it creates an account. `account created` is each new household's first event and carries both the household's `user_id` and the `device_id` of the device used to sign up. There is no anonymous pre-signup activity in the data.
- Every event carries `user_id`. Events sent from an app or browser also carry `device_id`. The exceptions:
  - `plan selected` and `trial started` are recorded by the billing service during signup and carry `user_id` only. Their `platform` and `device_family` are those of the signup device.
  - `trial converted` and `subscription renewed` are server-side billing events. They carry `user_id` only, with `platform` = `server` and `device_family` = `server`.
- Each `device_id` is one screen (a TV or streaming box, a phone, a tablet, or a browser). Its `platform` (`tv`, `mobile`, `tablet`, `web`) and `device_family` never change. Households use about two devices on average; some use one, a few use five or more.
- Push notifications go to the Reelhouse app on a phone or tablet. Households without the app on a phone or tablet receive none.
- Households that joined before June 4 have no `account created` event in this window, and their `member_since` profile date is before the window. A small number of them were in their free trial on June 4 (`member_since` May 28 to June 3); their trial ends in the first week of June and they have no `trial started` event in the window. For households that joined in the window, `member_since` is the signup date.
- Count households with unique `user_id` (Mixpanel "Uniques"), not with `device_id`.

## Conventions

- Event and property names are lowercase with spaces or underscores, as tracked. The Mixpanel experiment fields keep their original capitalization.
- Money is in US dollars. Reelhouse bills in US dollars in both countries. List prices are monthly.
- "Paid plans" means all three plans after the trial: Basic with Ads (`basic_ads`), Standard (`standard`), and Premium (`premium`).
- "Q3" means July 1 to September 30. "September" means September 1-30; the window's last day (October 1) is reported separately.
