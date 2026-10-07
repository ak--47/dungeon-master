# Ledgerline analytics: read me first

This folder is the internal analytics wiki for **Ledgerline**, a retail crypto exchange and wallet app. It explains the business, the calendar of the period, the tracking plan, and the business tables in the data warehouse. Read it before you answer questions about the Ledgerline Mixpanel project or its raw data exports.

## What the dataset covers

- **Product:** the Ledgerline iOS and Android apps: sign-up and identity verification, deposits, Simple Buy, Advanced Trade, recurring buys, staking (Earn), price alerts, and withdrawals to external wallets.
- **Window:** 2026-06-04 00:00 to 2026-10-01 23:59 (UTC). That is 120 days: the last weeks of Q2, all of Q3, and the first day of Q4.
- **Scale:** about 10,000 customers used Ledgerline in the window. About 4,000 of them created their account during the window; the rest were already customers before June 4. The project holds about 1.35 million events.
- **Time zone:** every timestamp, daily bucket, and warehouse date is UTC.

## The other files

- **`01-business.md`** — who Ledgerline is, the products and their fees, how customers find us, the customer types the business talks about, and the goals for the period. Read it to understand what a metric means for the business.
- **`02-timeline.md`** — dated launches, an experiment, a pricing change, a new listing, incidents, app releases, market-moving days, and holidays in the window. Read it whenever a question mentions a date, a "before and after", or an unexplained bump or dip in a chart.
- **`03-event-dictionary.md`** — every event, event property, and user profile property: what each one means in the product and what its values mean. It also lists the funnels the business tracks. Read it before you build any report.
- **`04-metrics-and-tables.md`** — how Ledgerline defines its KPIs (funded accounts, onboarding completion, retention, CAC, staking flows, and others), and a data dictionary for the three warehouse tables. Read it for metric definitions and whenever a question involves market prices, blockchain network conditions, or marketing spend.

## How the data fits together

- **Events** (the Mixpanel event stream) record what customers do in the app, plus a few events that Ledgerline's servers send on a customer's behalf. Each event has a timestamp, the customer's identity, and flat properties.
- **User profiles** hold one row per customer with their current attributes: investor type, acquisition channel, customer-since date, identity verification status, experiment enrollment, and location.
- There are no group profiles and no slowly changing dimension tables in this project.
- **Warehouse tables** are daily facts that are not in the event stream: market prices and volatility by asset, blockchain network conditions and Ledgerline's withdrawal broadcasts by network, and paid marketing spend by channel. They join to events on the UTC date and a shared dimension (`asset`, `network`, or `acquisition_channel`).

## Identity notes

- A new customer is identified when they create an account. `account created` is each new customer's first event and carries both the customer's `user_id` and the `device_id`. There is no anonymous pre-signup activity in the data.
- Every event carries `user_id`. Most events also carry `device_id`. The exceptions are the onboarding steps after sign-up (`identity verification started`, `identity verified`, and the customer's first `deposit completed`), which the onboarding service sends server-side with `user_id` only (no device fields and no `session_id`), and a small share of recurring-buy events. Customers use about two devices (phones and tablets); `device_id` changes between devices but `user_id` does not.
- Customers who joined before June 4 have no `account created` event in this window. Their `customer_since` profile date is before the window. For customers who joined in the window, `customer_since` is their sign-up date.
- Some customers signed up in the last days of May or on June 1-3 and were still in onboarding on June 4. Their remaining onboarding steps (`identity verification started`, `identity verified`, first `deposit completed`) appear in the first days of the window without an `account created` event.
- Count people with unique `user_id` (Mixpanel "Uniques"), not with `device_id`.

## Server-side events and sessions

- Three events are sent by Ledgerline's servers, not by a customer action in the app: `price alert triggered` (a push notification that an alert fired), `recurring buy executed` (a scheduled purchase), and `withdrawal confirmed` (the blockchain confirmed a withdrawal). They keep arriving when a customer is not using the app. Do not count them as customer activity.
- `app opened` marks the start of an app session (the app sends it when a customer opens the app after 30 minutes or more without activity). A new customer's sign-up session has no `app opened`. Use `app opened` when you need a measure of "the customer came back".

## Conventions

- Event and property names are lowercase with spaces or underscores, as tracked. The Mixpanel experiment fields keep their original capitalization.
- Money is in US dollars. Crypto prices are USD per coin.
- "New customers" means customers whose `customer_since` is on or after 2026-06-04. "Established customers" joined before.
