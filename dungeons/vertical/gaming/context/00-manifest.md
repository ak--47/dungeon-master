# Emberfall analytics: read me first

This folder is the internal analytics wiki for **Emberfall**, the free-to-play fantasy action RPG made by Cinderlight Games. It explains the business, the calendar of the period, the tracking plan, and the business tables in the data warehouse. Read it before you answer questions about the Emberfall Mixpanel project or its raw data exports.

## What the dataset covers

- **Product:** Emberfall on PC (Windows, macOS, and Linux through the Emberfall launcher) and on mobile (iPhone, iPad, and Android). One account plays on every device, with cross-play between PC and mobile.
- **Window:** 2026-06-04 00:00 to 2026-10-01 23:59 (UTC). That is 120 days, from early June through the end of September and the first day of October.
- **Scale:** about 9,800 players have events in the window, and about 7,900 of them launched the game (`game launched`). About 4,500 of the 9,800 created their account during the window; the rest are veterans who joined before June 4. The project holds about 684,000 events.
- **Servers:** players pick a home server region when they create their account: North America (`NA`), Europe (`EU`), or Asia-Pacific (`APAC`).
- **Time zone:** every timestamp, daily bucket, and warehouse date is UTC. North American evenings fall after midnight UTC.

## The other files

- **`01-business.md`** — who Cinderlight Games is, how Emberfall works, how it makes money, how players find it, the player segments the team talks about, and the goals for the period. Read it to understand what a metric means for the business.
- **`02-timeline.md`** — dated launches, a patch, an experiment, a season launch, a live event, an incident, holidays, and org changes in the window. Read it whenever a question mentions a date, a "before and after", or an unexplained bump or dip in a chart.
- **`03-event-dictionary.md`** — every event, event property, and user profile property: what each one means in the game and what its values mean. It also lists the funnels the team tracks. Read it before you build any report.
- **`04-metrics-and-tables.md`** — how Cinderlight defines its KPIs (active players, tutorial completion, retention, win and clear rates, queue time, payers, revenue, CAC, and others), and a data dictionary for the three warehouse tables. Read it for metric definitions and whenever a question involves marketing spend, server health, store fees, or net revenue.

## How the data fits together

- **Events** (the Mixpanel event stream) record what players do in the game. Each event has a timestamp, the player's identity, and flat properties. The player's home server region (`server_region`) and the platform of the device they played on (`platform`) are on every event, so you can break down events without a lookup table.
- **Dungeon runs** tie events together. A run's queue, start, and finish share one `run_id`.
- **User profiles** hold one row per player with their current attributes: server region, acquisition channel, main role and class, account level, member-since date, guild membership, lifetime spend, and experiment enrollment.
- **Warehouse tables** are daily business facts that are not in the event stream: paid acquisition spend by channel, server health by region, and store revenue by platform and product type (including refunds and store fees). They join to events on the UTC date and a shared dimension (`acquisition_channel`, `server_region`, or `platform` + `product_type`).
- There are no group profiles and no slowly changing dimension tables in this project.

## Identity notes

- A new player is identified when they create an account. `account created` carries both the player's `user_id` and the `device_id` of the device they signed up on. It is each new player's first event, except that players who joined from July 8 have a `$experiment_started` event (the "First Flame Tutorial" assignment) one second earlier, with the same `user_id` and `device_id`. There is no anonymous pre-signup activity in the data. A new player's first play session starts with `account created` (the game creates the account on first launch), so that session has no `game launched` event.
- Every event carries `user_id`. Almost every event also carries `device_id`; the exceptions are the three onboarding steps after signup (`character created`, `tutorial started`, `tutorial completed`), which the game server sends with `user_id` only.
- Some players use more than one device, for example a PC at home and a phone on the go. Each play session stays on one device. `platform` is `pc` for Windows, macOS, and Linux, `ios` for iPhone and iPad (`os` = `iOS` or `iPadOS`), and `android` for Android phones. A player can therefore appear under more than one platform.
- Veterans who joined before June 4 have no `account created` event in this window. Their `member_since` profile date is before the window. For players who joined in the window, `member_since` is their signup date.
- Count people with unique `user_id` (Mixpanel "Uniques"), not with `device_id`.

## Conventions

- Event and property names are lowercase with spaces or underscores, as tracked. The Mixpanel experiment fields keep their original capitalization.
- Money is in US dollars.
- "Mobile" means `ios` + `android`.
- "September" means September 1-30; the window's last day (October 1) is reported separately.
