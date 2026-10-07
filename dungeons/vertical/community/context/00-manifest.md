# Hearthside analytics: read me first

This folder is the internal analytics wiki for **Hearthside**, a fan community platform. It explains the product, the calendar of the period, the tracking plan, and the business tables in the data warehouse. Read it before you answer questions about the Hearthside Mixpanel project or its raw data exports.

## What the dataset covers

- **Product:** the Hearthside web site and mobile apps. Members join hobby communities in six hubs (gaming, anime, movies & TV, books, tabletop, music), read and edit community wikis, start and reply to discussion threads, upvote, upload fan art and media, and report bad content to volunteer moderators. Hearthside is free with ads; Hearthside Plus is the paid, ad-free membership.
- **Window:** 2026-06-04 00:00 to 2026-10-01 23:59 (UTC). That is 120 days, early June through the first day of October.
- **Scale:** about 10,000 signed-in members were active in the window. About 4,400 of them joined during the window; the rest were already members before June 4. The project holds about 830,000 events. There are 48 communities.
- **Time zone:** every timestamp, daily bucket, and warehouse date is UTC.

## The other files

- **`01-business.md`** — who Hearthside is, the hubs and communities, member roles, how the business makes money (ads and Plus), how new members find us, and the goals for the period. Read it to understand what a metric means for the business.
- **`02-timeline.md`** — dated launches, an experiment, a game release, a trust and safety incident, an ad change, a community event, holidays, and org changes in the window. Read it whenever a question mentions a date, a "before and after", or an unexplained bump or dip in a chart.
- **`03-event-dictionary.md`** — every event, event property, member profile property, and community (group) property: what each one means in the product and what its values mean. It also lists the funnels the business tracks. Read it before you build any report.
- **`04-metrics-and-tables.md`** — how Hearthside defines its KPIs (onboarding, retention, reply rate, report resolution time, CAC, ad revenue, and others), and a data dictionary for the three warehouse tables. Read it for metric definitions and whenever a question involves marketing spend, trust and safety operations, or ad revenue.

## How the data fits together

- **Events** (the Mixpanel event stream) record what members do in the product, plus a few server-side messages (notifications, report resolutions). Each event has a timestamp, the member's identity, and flat properties. The member's membership level at the time of the event is copied onto every event (`membership`), and events that happen inside a community carry its hub (`content_hub`) and community (`community_id`), so you can break down events without a lookup table.
- **Member profiles** hold one row per member with their current attributes: role, home hub, membership, member-since date, acquisition channel, karma, and experiment enrollment.
- **Communities** are a Mixpanel group (`community_id`). Each community has a group profile with its name, hub, member count, founding year, and whether it is an official community.
- **Warehouse tables** are daily business facts that are not in the event stream: paid marketing spend by channel, trust and safety operations by hub, and ad impressions and revenue by hub. They join to events on the UTC date and a shared dimension (`acquisition_channel` or `content_hub`).

## Identity notes

- A new member is identified when they create an account. `account created` is each new member's first event and carries both the member's `user_id` and the `device_id`. There is no anonymous (logged-out) activity in the Mixpanel project: logged-out readers are not tracked in Mixpanel.
- Every event carries `user_id`. Almost every event also carries `device_id`; the exceptions are the two onboarding steps right after signup (`interests selected`, `intro posted`), which the onboarding service sends server-side with `user_id` only. Members use about two devices (for example a phone and a laptop); `device_id` changes between devices but `user_id` does not.
- Members who joined before June 4 have no `account created` event in this window. Their `member_since` profile date is before the window. For members who joined in the window, `member_since` is their signup date and the profile `created` field is their signup time.
- Count people with unique `user_id` (Mixpanel "Uniques"), not with `device_id`. Count communities with the `community_id` group.

## Conventions

- Event and property names are lowercase with spaces or underscores, as tracked. The Mixpanel experiment fields keep their original capitalization.
- Money is in US dollars.
- "Member actions" means events a member does themselves. `notification received` and `report resolved` are sent by Hearthside's servers and are not member actions.
