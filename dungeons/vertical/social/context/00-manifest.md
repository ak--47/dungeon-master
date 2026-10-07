# Murmur analytics: read me first

This folder is the internal analytics wiki for **Murmur**, a mobile social app. It explains the business, the calendar of the period, the tracking plan, and the business tables in the data warehouse. Read it before you answer questions about the Murmur Mixpanel project or its raw data exports.

## What the dataset covers

- **Product:** the Murmur iOS and Android apps: a Following feed and a ranked For You feed of posts, Stories, direct messages, communities, Clips (short vertical video, from July 8), creator Circles (paid fan subscriptions), push notifications, and ads in the feed, in Stories, and in Clips.
- **Window:** 2026-06-04 00:00 to 2026-10-01 23:59 (UTC). That is 120 days, from early summer through the end of September and the first day of October.
- **Scale:** about 10,000 members were active in the window. About 5,000 of them signed up during the window; the rest joined before June 4. The project holds about 1.2 million events.
- **Markets:** members live mostly in the US, with smaller groups in the UK, Canada, Brazil, India, Germany, and Australia.
- **Time zone:** every timestamp, daily bucket, and warehouse date is UTC. Most members are in US time zones, so a US evening falls after midnight UTC.

## The other files

- **`01-business.md`** — who Murmur is, how the product works, how Murmur makes money (ads and the Circles fee), creator programs, how members find us, the member segments the business talks about, and the goals for the period. Read it to understand what a metric means for the business, and for Circle prices.
- **`02-timeline.md`** — dated launches, an experiment, a creator pricing change, an incident, an ad change, a live event, holidays, and org changes in the window. Read it whenever a question mentions a date, a "before and after", or an unexplained bump or dip in a chart.
- **`03-event-dictionary.md`** — every event, event property, user profile property, and the community group profile: what each one means in the product and what its values mean. It also lists the funnels the business tracks. Read it before you build any report.
- **`04-metrics-and-tables.md`** — how Murmur defines its KPIs (active members, retention, push open rate, paywall conversion, CAC, ad load, eCPM, ad revenue, and others), and a data dictionary for the three warehouse tables. Read it for metric definitions and whenever a question involves marketing spend, feed reliability, or ad revenue.

## How the data fits together

- **Events** (the Mixpanel event stream) record what members do in the app, plus two server-side events (push notifications sent and experiment assignment). Each event has a timestamp, the member's identity, and flat properties. The member's phone platform is on every event (`platform`), so you can break down events without a lookup table.
- **Pushes** tie together: a `push notification sent` and the `push notification opened` that answers it share one `notification_id`.
- **User profiles** hold one row per member with their current attributes: account type, whether a creator runs a Circle, acquisition channel, join date, age band, country, follower counts, and experiment enrollment.
- **Group profiles** (`community_id`) hold one row per community (240 communities): name, topic, moderation, and the year it was created. Community posts, comments in communities, and community joins carry `community_id`.
- **Warehouse tables** are daily business facts that are not in the event stream: paid marketing spend by channel, For You feed service health by platform, and ad impressions served, eCPM, and ad revenue by ad placement. They join to events on the UTC date and a shared dimension (`acquisition_channel`, `platform`, or `ad_placement`).
- There are no slowly changing dimension tables in this project.

## Identity notes

- A new member is identified when they create an account. `account created` is each new member's first event and carries both the member's `user_id` and the `device_id` of their phone. There is no anonymous pre-signup activity in the data.
- Every event carries `user_id`. Almost every event also carries `device_id`; the exceptions are the two onboarding steps after signup (`interests selected` and the follows made on the suggested-accounts screen), which the onboarding service sends server-side with `user_id` only.
- Each member uses one device: an iPhone, an iPad, or an Android phone. `platform` is `ios` for iPhone and iPad (`os` = `iOS` or `iPadOS`) and `android` for Android phones.
- Members who joined before June 4 have no `account created` event in this window. Their `joined_date` profile date is before the window. For members who joined in the window, `joined_date` is their signup date.
- Count people with unique `user_id` (Mixpanel "Uniques"), not with `device_id`.

## Conventions

- Event and property names are lowercase with spaces or underscores, as tracked. The Mixpanel experiment fields keep their original capitalization.
- Money is in US dollars.
- "September" means September 1-30; the window's last day (October 1) is reported separately.
- "Active" means a member did something in the app. Server-side events (`push notification sent`, `$experiment_started`) are not activity; see 04-metrics-and-tables.md.
