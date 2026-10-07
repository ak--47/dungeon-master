# Penny Harbor analytics: read me first

This folder is the internal analytics wiki for **Penny Harbor**, a US mobile bank. It explains the company and its products, the calendar of the period, the tracking plan, and the finance and operations tables in the data warehouse. Read it before you answer questions about the Penny Harbor Mixpanel project or its raw data exports.

## What the dataset covers

- **Product:** the Penny Harbor app for iOS and Android: checking with a Visa debit card, direct deposit, Pockets (savings), Round-Ups, Send (transfers), Bill Pay with AutoPay, Float (cash advances), Harbor Invest, and budgets. Plans are Free, Plus, and Premium.
- **Window:** 2026-06-04 00:00 to 2026-10-01 23:59 (UTC). That is 120 days, from early June through the end of Q3 and the first day of Q4.
- **Scale:** about 10,000 members. About 4,100 of them opened their account during the window; the rest were already members before June 4. The project holds about 1.16 million events.
- **Time zone:** every timestamp, daily bucket, and warehouse date is UTC. Members are in the United States, so a US evening falls after midnight UTC.

## The other files

- **`01-business.md`** — who Penny Harbor is, what members do with it, how the company makes money, plans and their perks, how members find us, the member segments the business talks about, and the goals for the period. Read it to understand what a metric means for the business.
- **`02-timeline.md`** — dated launches, an experiment, a savings promotion, a card processor incident, bank holidays, and org changes in the window. Read it whenever a question mentions a date, a "before and after", or an unexplained bump or dip in a chart.
- **`03-event-dictionary.md`** — every event, event property, and user profile property: what each one means in the product and what its values mean. It also lists the funnels the business tracks and which events are sent by Penny Harbor's servers rather than by the app. Read it before you build any report.
- **`04-metrics-and-tables.md`** — how Penny Harbor defines its KPIs (onboarding completion, direct deposit adoption, retention, CAC, approval rate, late payments, Pocket growth, and others), and a data dictionary for the three warehouse tables. Read it for metric definitions and whenever a question involves marketing spend, card processing, interest rates, or Pocket balances.

## How the data fits together

- **Events** (the Mixpanel event stream) record what members do in the app and the money movements Penny Harbor's systems post to their accounts. Each event has a timestamp, the member's identity, and flat properties. The member's plan at the moment of the event is copied onto every event (`plan_tier`), so you can break down events by plan without a lookup table. Merchant and biller details are on the events themselves.
- **User profiles** hold one row per member with their current attributes: segment, credit file, acquisition channel, plan, member-since date, age band, pay frequency, whether direct deposit and Round-Ups are on, and experiment enrollment.
- There are **no group profiles and no slowly changing history tables** in this project.
- **Warehouse tables** are daily business facts that are not in the event stream: paid marketing spend by channel, card authorization health by payment channel from the card processor, and Pocket deposits, withdrawals, interest rates, interest paid, and balances by plan from the core banking ledger. They join to events on the UTC date and a shared dimension (`acquisition_channel`, `payment_channel`, or `plan_tier`).

## Identity notes

- A new member is identified when they open an account. `account opened` is each new member's first event and carries both the member's `user_id` and the `device_id`. There is no anonymous pre-signup activity in the data.
- Every event carries `user_id`. Events the member triggers in the app also carry `device_id` and device details. Events sent by Penny Harbor's servers carry `user_id` only, with no device fields: `identity verified`, `account funded`, `direct deposit received`, `float advance repaid`, `support ticket resolved`, `bill paid` when it was paid by AutoPay, and `savings deposit` when it is a Round-Up sweep. The event dictionary marks these.
- Members use about two devices on average (a phone and a tablet, or an old and a new phone). `device_id` changes between devices; `user_id` does not.
- Members who joined before June 4 have no `account opened` event in this window. Their `customer_since` profile date is before the window. For members who joined in the window, `customer_since` is the date they opened their account.
- Count people with unique `user_id` (Mixpanel "Uniques"), not with `device_id`.

## Conventions

- Event and property names are lowercase with spaces or underscores, as tracked. The Mixpanel experiment fields keep their original capitalization.
- Money is in US dollars. Plan prices are per month.
- "Paid plans" means Plus and Premium.
