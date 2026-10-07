# Tallyboard analytics: read me first

This folder is the internal analytics wiki for **Tallyboard**, a B2B cloud operations platform. It explains the product, the calendar of the period, the tracking plan, and the business tables in the data warehouse. Read it before you answer questions about the Tallyboard Mixpanel project or its raw data exports.

## What the dataset covers

- **Product:** the Tallyboard web app and API: monitoring dashboards, alerting and incident response, hosted CI/CD pipelines, and cloud cost reports. Paid plans are Team, Business, and Enterprise.
- **Window:** 2026-06-04 00:00 to 2026-10-01 23:59 (UTC). That is 120 days, the end of Q2 through the close of Q3 and the first day of Q4.
- **Scale:** about 10,000 users at about 3,700 companies were active in the window. About 300 of those companies are long-standing customers with many users each; the rest are workspaces started during the window or in the few weeks before it, most of them by one to three engineers. This project does not hold Tallyboard's whole installed base: it covers every workspace started from mid-May 2026 on, plus the roughly 300 long-standing accounts that moved to the new tracking plan before June. Most older customer accounts still report to a legacy project and are not in this data, so this project's long-standing accounts are a sample of the base, not all of it. About 4,500 of the users signed up during the window; the rest were already using Tallyboard before June 4. Because new workspaces keep joining while the long-standing sample is fixed, the number of active users grows through the period. The project holds about 0.9 million events.
- **Time zone:** every timestamp, daily bucket, and warehouse date is UTC.

## The other files

- **`01-business.md`** — who Tallyboard is, what customers do in the product, plans and pricing, how customers find us, the customer segments and user roles the business talks about, and the goals for the period. Read it to understand what a metric means for the business.
- **`02-timeline.md`** — dated launches, the pipeline experiment, a pricing change, an infrastructure incident, a quarter-close promotion, holidays, and org changes in the window. Read it whenever a question mentions a date, a "before and after", or an unexplained bump or dip in a chart.
- **`03-event-dictionary.md`** — every event, event property, user profile property, company (group) property, and the account health history: what each one means in the product and what its values mean. It also lists the funnels the business tracks. Read it before you build any report.
- **`04-metrics-and-tables.md`** — how Tallyboard defines its KPIs (onboarding completion, time to acknowledge, pipeline success, CAC, new MRR, and others), and a data dictionary for the three warehouse tables. Read it for metric definitions and whenever a question involves marketing spend, CI runner health, prices, or bookings.

## How the data fits together

- **Events** (the Mixpanel event stream) record what users do in the product. Each event has a timestamp, the user's identity, and flat properties. Attributes that describe the user's plan, cloud, and company are copied onto events (`plan_tier`, `cloud_provider`, `company_id`), so you can break down events without a lookup table.
- **User profiles** hold one row per user with their current attributes: company, company size, industry, role, plan, cloud provider, acquisition channel, customer-since date, connected integrations, and experiment enrollment.
- **Companies** are a Mixpanel group (`company_id`). A company has one Tallyboard workspace and one plan, shared by all of its users. Each company has a group profile with its name, size, headcount band, industry, cloud provider, current plan, annual contract value, contracted seats, and whether it has a customer success manager. Every event carries the user's own `company_id`.
- **Account health history** is a slowly changing record: each row is a customer success manager's health rating for a user's account from a given moment. Only accounts at companies with a dedicated customer success manager (companies on an Enterprise contract) are rated; other accounts have no rows. A row is written at every review, even when the rating does not change. A new account's first rating is written when it signs up. An established account's history starts with a rating from the month before June 4, so it has a rating in force for its whole time in the window; accounts that joined in the last weeks before June 4 have no rating until their first review.
- **Warehouse tables** are daily business facts that are not in the event stream: paid marketing spend by channel, hosted CI runner health by region, and new seats, list prices, and new MRR by plan. They join to events on the UTC date and a shared dimension (`acquisition_channel`, `runner_region`, or `plan`).

## Identity notes

- A new user is identified when they create an account. `account created` is each new user's first event and carries both the user's `user_id` and the `device_id`. There is no anonymous pre-signup activity in the data.
- Every event carries `user_id`. Almost every event also carries `device_id`; the exceptions are the three setup steps after signup (`cloud account connected`, `agent installed`, `dashboard created`), which the setup service sends server-side with `user_id` only. Users work from about two devices (for example a laptop and a desktop), all through a desktop web browser; `device_id` changes between devices but `user_id` does not.
- Users who joined before June 4 have no `account created` event in this window. Their `customer_since` profile date is before the window. For users who joined in the window, `customer_since` is their signup date.
- Count people with unique `user_id` (Mixpanel "Uniques"), not with `device_id`. Count companies with the `company_id` group.

## Conventions

- Event and property names are lowercase with spaces or underscores, as tracked. The Mixpanel experiment fields keep their original capitalization.
- Money is in US dollars. Prices are per seat per month.
- "Paid plans" means Team, Business, and Enterprise.
