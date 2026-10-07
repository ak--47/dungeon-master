# Brightpath Academy analytics: read me first

This folder is the internal analytics wiki for **Brightpath Academy**, an online learning platform for professional skills. It explains the business, the calendar of the period, the tracking plan, and the business tables in the data warehouse. Read it before you answer questions about the Brightpath Mixpanel project or its raw data exports.

## What the dataset covers

- **Product:** the Brightpath web app and the iOS and Android apps: the course catalog, enrollment, video, reading, and lab lessons, quizzes and assignments, course discussions, live sessions for cohort courses, certificates, the Ask Bright AI tutor, and Brightpath Plus subscriptions.
- **Window:** 2026-06-04 00:00 to 2026-10-01 23:59 (UTC). That is 120 days, from early summer to the start of Q4.
- **Scale:** the project holds about 10,000 learner profiles. About 4,000 learners signed up during the window; the rest were already learners before June 4. About 8,600 learners have at least one event in the window; the other profiles belong to earlier learners who did not come back after June 4. The project holds about 620,000 events.
- **Time zone:** every timestamp, daily bucket, and warehouse date is UTC.

## The other files

- **`01-business.md`** — who Brightpath is, the course catalog and course formats, plans and pricing, Brightpath for Teams, how learners find us, the learner segments the business talks about, and the goals for the period. Read it to understand what a metric means for the business.
- **`02-timeline.md`** — dated launches, the course page experiment, a pricing change, the university fall term, an app incident, holidays, and things that did not change. Read it whenever a question mentions a date, a "before and after", or an unexplained bump or dip in a chart.
- **`03-event-dictionary.md`** — every event, event property, and user profile property: what each one means in the product and what its values mean. It also lists the funnels the business tracks. Read it before you build any report.
- **`04-metrics-and-tables.md`** — how Brightpath defines its KPIs (onboarding completion, course completion, retention, paid conversion, CAC, bookings, and others), and a data dictionary for the three warehouse tables. Read it for metric definitions and whenever a question involves marketing spend, app stability, prices, or bookings.

## How the data fits together

- **Events** (the Mixpanel event stream) record what learners do. Each event has a timestamp, the learner's identity, and flat properties. Course attributes (title, category, format, level, length) are copied onto course events, and the learner's plan and platform are copied onto every event (`plan_tier`, `platform`), so you can break down events without a lookup table.
- **User profiles** hold one row per learner with their current attributes: learner segment, account type, primary goal, current plan, acquisition channel, customer-since date, preferred playback speed, and experiment assignment.
- **There are no group profiles or slowly changing dimensions** in this project. Employers who buy Brightpath for Teams seats are not modeled as a Mixpanel group.
- **Warehouse tables** are daily business facts that are not in the event stream: paid marketing spend by channel, app stability and video playback health by platform, and new Plus subscriptions, list prices, and bookings by billing interval. They join to events on the UTC date and a shared dimension (`acquisition_channel`, `platform`, or `billing_interval`).

## Identity notes

- A new learner is identified when they create an account. `account created` is each new learner's first event and carries both the learner's `user_id` and the `device_id`. There is no anonymous pre-signup activity in the data.
- Every event carries `user_id`. Every event also carries `device_id` except `certificate earned` and `subscription started`, which the backend sends with `user_id` only (they also have no `platform`). Learners use about two devices (for example a laptop and a phone); `device_id` changes between devices but `user_id` does not.
- Learners who joined before June 4 have no `account created` event in this window. Their `customer_since` profile date is before the window. For learners who joined in the window, `customer_since` is their signup date and the profile `created` timestamp equals their `account created` time.
- Count people with unique `user_id` (Mixpanel "Uniques"), not with `device_id`.

## Conventions

- Event and property names are lowercase with spaces or underscores, as tracked. The Mixpanel experiment fields keep their original capitalization.
- Money is in US dollars.
- "Paid plans" means Plus and Teams. "Self-pay learners" means learners with `account_type = individual`.
