# Cortexa analytics: read me first

This folder is the internal analytics wiki for **Cortexa**, a developer platform for large language models. It explains the business, the calendar of the period, the tracking plan, and the business tables in the data warehouse. Read it before you answer questions about the Cortexa Mixpanel project or its raw data exports.

## What the dataset covers

- **Product:** the Cortexa API (Messages API and Batch API) and the Cortexa web console: API keys, the prompt playground, evaluations, usage dashboards, docs, and billing. Models: atlas-2, swift-2, and atlas-3 (from July 28).
- **Window:** 2026-06-04 00:00 to 2026-10-01 23:59 (UTC). That is 120 days, the end of Q2 through the close of Q3 and the first day of Q4.
- **Scale:** about 10,000 developer accounts were active in the window. About 5,000 of them signed up during the window; the rest were already customers before June 4. The project holds about 860,000 events.
- **Time zone:** every timestamp, daily bucket, and warehouse date is UTC.

## The other files

- **`01-business.md`** — who Cortexa is, the models and their list prices, the plans, what customers build, how developers find us, the customer segments the business talks about, and the goals for the period. Read it to understand what a metric means for the business.
- **`02-timeline.md`** — dated launches, a price change, an onboarding experiment, an infrastructure incident, a rate-limit change, holidays, and org changes in the window. Read it whenever a question mentions a date, a "before and after", or an unexplained bump or dip in a chart.
- **`03-event-dictionary.md`** — every event, event property, and user profile property: what each one means in the product and what its values mean. It also lists the funnels the business tracks. Read it before you build any report.
- **`04-metrics-and-tables.md`** — how Cortexa defines its KPIs (activation, retention, cache hit rate, model mix, error rate, CAC, revenue, and others), and a data dictionary for the three warehouse tables. Read it for metric definitions and whenever a question involves revenue, prices, GPU fleet health, or marketing spend.

## How the data fits together

- **Events** (the Mixpanel event stream) record what accounts do in the console and through the API. Each event has a timestamp, the account's identity, and flat properties. The account's plan at the moment of the event is copied onto every event (`plan_tier`), so you can break down events by plan without a lookup table.
- **API traffic is sampled.** Cortexa sends one `api request` event to analytics for every 1,000 API requests, chosen at random. Ratios, shares, and averages from `api request` events describe all traffic; counts must be multiplied by 1,000 to estimate real request volume. Every other event is recorded in full.
- **User profiles** hold one row per account with its current attributes: plan, company size, use case, SDK language, acquisition channel, serving region, role, customer-since date, and experiment enrollment.
- **Warehouse tables** are daily business facts that are not in the event stream: GPU fleet health by inference region, metered usage, list prices, and revenue by model, and paid developer-marketing spend by channel. They join to events on the UTC date and a shared dimension (`inference_region`, `model`, or `acquisition_channel`).
- There are no group profiles. An "account" is one developer's login and API organization seat; when this wiki says "customer" or "account", it means one profile.

## Identity notes

- Cortexa sends every event from its servers with the account's `user_id`. There is no `device_id` and no anonymous (logged-out) activity in the data.
- A new account is identified when it is created. `account created` is each new account's first product event. Accounts created while the Interactive Quickstart test is live (from July 1) also get a `$experiment_started` event one second before `account created`.
- Accounts that joined before June 4 have no `account created` event in this window. Their `customer_since` profile date is before the window. For accounts that joined in the window, `customer_since` is their signup date and `created` is their signup time.
- Count accounts with unique `user_id` (Mixpanel "Uniques").

## Conventions

- Event and property names are lowercase with spaces or underscores, as tracked. The Mixpanel experiment fields keep their original capitalization.
- Money is in US dollars. Token prices are per million tokens.
- "Paid plans" means Build, Scale, and Enterprise.
