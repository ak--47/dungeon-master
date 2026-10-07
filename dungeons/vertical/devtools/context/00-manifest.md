# Forgebench analytics: read me first

This folder is the internal analytics wiki for **Forgebench**, a developer platform for code review, CI builds, and deployments. It explains the product, the calendar of the period, the tracking plan, and the business tables in the data warehouse. Read it before you answer questions about the Forgebench Mixpanel project or its raw data exports.

## What the dataset covers

- **Product:** the Forgebench web app, CLI, and hosted CI service: repository import, pull requests and code review, CI builds on hosted runners, preview deployments for every push, and production deploys. Paid plans are Pro, Team, and Enterprise.
- **Window:** 2026-06-04 00:00 to 2026-10-01 23:59 (UTC). That is 120 days, from early June through the first day of Q4.
- **Scale:** about 10,000 developers at 500 customer organizations were active in the window. About 4,500 of them signed up during the window; the rest were already using Forgebench before June 4. The project holds about 980,000 events.
- **Time zone:** every timestamp, daily bucket, and warehouse date is UTC.

## The other files

- **`01-business.md`** — who Forgebench is, what developers do in the product, plans and pricing, how developers find us, the customer segments and roles the business talks about, and the goals for the period. Read it to understand what a metric means for the business.
- **`02-timeline.md`** — dated launches, the CI experiment, a billing change, an infrastructure incident, holidays, and org changes in the window. Read it whenever a question mentions a date, a "before and after", or an unexplained bump or dip in a chart.
- **`03-event-dictionary.md`** — every event, event property, user profile property, and organization (group) property: what each one means in the product and what its values mean. It also lists the funnels the business tracks. Read it before you build any report.
- **`04-metrics-and-tables.md`** — how Forgebench defines its KPIs (onboarding completion, review wait, merge time, build success, change failure rate, CAC, and others), and a data dictionary for the three warehouse tables. Read it for metric definitions and whenever a question involves marketing spend, the build fleet, runner minutes, or overage billing.

## How the data fits together

- **Events** (the Mixpanel event stream) record what developers do. Each event has a timestamp, the developer's identity, and flat properties. Attributes that describe the developer's plan, stack, and organization are copied onto events (`plan_tier`, `primary_stack`, `org_id`), so you can break down events without a lookup table.
- **Linked events share an ID.** The four steps of one pull request share a `pr_id`; the start and finish of one CI build share a `build_id`; a push and the preview it produced share a `commit_sha`. Hold these constant in funnels to measure one PR or one build at a time.
- **User profiles** hold one row per developer with current attributes: organization, organization size, industry, role, primary stack, plan, acquisition channel, customer-since date, and experiment enrollment.
- **Organizations** are a Mixpanel group (`org_id`). Each organization has a group profile with its name, size, industry, and employee band. Every event carries the developer's own `org_id`.
- **There are no slowly changing dimension tables** in this project. The plan a developer was on at the moment of an event is on the event itself (`plan_tier`).
- **Warehouse tables** are daily business facts that are not in the event stream: paid marketing spend by channel, build fleet health by package ecosystem, and billed runner minutes and overage by plan. They join to events on the UTC date and a shared dimension (`acquisition_channel`, `ecosystem`, or `plan_tier`).

## Identity notes

- A new developer is identified when they create an account. `account created` is each new developer's first event and carries both `user_id` and `device_id`. There is no anonymous pre-signup activity in the data.
- Every event carries `user_id`. Almost every event also carries `device_id`; the exceptions are the setup steps the server records after signup (`repository imported`, `pipeline configured`, and the first `preview deployed` of setup), which carry `user_id` only. Developers work from about two devices (for example a laptop and a desktop); `device_id` changes between devices but `user_id` does not.
- Developers who joined before June 4 have no `account created` event in this window. Their `customer_since` profile date is before the window. For developers who joined in the window, `customer_since` is their signup date.
- Count people with unique `user_id` (Mixpanel "Uniques"), not with `device_id`. Count organizations with the `org_id` group.

## Conventions

- Event and property names are lowercase with spaces or underscores, as tracked. The Mixpanel experiment fields keep their original capitalization.
- Money is in US dollars. Seat prices are per seat per month.
- "Paid plans" means Pro, Team, and Enterprise.
