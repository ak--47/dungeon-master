# Ticketloop analytics: read me first

This folder is the internal analytics wiki for **Ticketloop**, a help desk product for small and mid-size customer support teams. It explains the business, the calendar of the period, the tracking plan, and the business tables in the data warehouse. Read it before you answer questions about the Ticketloop Mixpanel project or its raw data exports.

## What the dataset covers

- **Product:** the Ticketloop web app, used by support agents, team leads, and admins at our customers. Tickets arrive from our customers' own customers by email, chat, web form, or API; Ticketloop routes each ticket to an agent, who replies, escalates if needed, and resolves it. Customers can reopen a ticket and can answer a satisfaction (CSAT) survey. New workspaces start with a 14-day trial.
- **Window:** 2026-06-04 00:00 to 2026-10-01 23:59 (UTC). That is 120 days, from early June through the end of September and the first day of October.
- **Scale:** about 10,000 users were active in the window. About 4,500 of them signed up for a trial during the window; the rest were already Ticketloop users on June 4. The project holds about 840,000 events, including about 98,000 tickets assigned to agents.
- **Customers:** about 370 customer companies with several agents each, plus several thousand one-person workspaces (Free plan users, trials, and small businesses that bought after a trial). Most customer teams route only part of their support volume through Ticketloop (see 01-business.md), so the project holds only the tickets that reach Ticketloop, not each team's full workload.
- **Time zone:** every timestamp, daily bucket, and warehouse date is UTC. Most users work in the Americas or Europe, so a US working day runs from about 13:00 to 01:00 UTC.

## The other files

- **`01-business.md`** — who Ticketloop is, how the product works, the plans and prices, customer segments, how new workspaces find us, and the goals for the period. Read it to understand what a metric means for the business.
- **`02-timeline.md`** — dated launches, an experiment, a price change, an incident, seasonal periods, and holidays in the window. Read it whenever a question mentions a date, a "before and after", or an unexplained bump or dip in a chart.
- **`03-event-dictionary.md`** — every event, event property, user profile property, and company (group) property: what each one means in the product and what its values mean. It also lists the funnels the business tracks. Read it before you build any report.
- **`04-metrics-and-tables.md`** — how Ticketloop defines its KPIs (first response time, resolution time, reopen rate, CSAT, setup completion, trial conversion, CAC, new MRR, and others), and a data dictionary for the three warehouse tables. Read it for metric definitions and whenever a question involves marketing spend, ticket ingestion, prices, or revenue.

## How the data fits together

- **Events** (the Mixpanel event stream) record what users do in Ticketloop and what happens to their tickets. Each event has a timestamp, the user's identity, and flat properties. The company's plan at the moment of the event (`plan_tier`) and the company (`company_id`) are on every event.
- **Tickets** tie events together. Every step of one ticket (assignment, replies, escalation, resolution, reopen, CSAT answer) shares one `ticket_id`. A ticket belongs to the agent it was assigned to.
- **User profiles** hold one row per user with their current attributes: company, company size, industry, region, role, current plan, email provider, acquisition channel, customer-since date, seats, and experiment enrollment.
- **Company profiles** (Mixpanel group key `company_id`) hold one row per company with its name, size, industry, region, current plan, seats, email provider, customer-since date, and acquisition channel. Every event carries the user's `company_id`.
- **Warehouse tables** are daily business facts that are not in the event stream: paid marketing spend by channel, ticket ingestion health by channel, and new subscriptions, seats, list prices, and new MRR by plan. They join to events on the UTC date and a shared dimension (`acquisition_channel`, `channel`, or `plan`).
- There are no slowly changing dimension tables and no lookup tables in this project.

## Identity notes

- A trial signup is identified when they create an account. `account created` is each new user's first event and carries both the user's `user_id` and the `device_id` of their browser. There is no anonymous pre-signup activity in the data.
- Every event carries `user_id`. Most events also carry `device_id` and browser details (`os`, `browser`, `model`, screen size). The exceptions have `user_id` only: `inbox connected` (sent by the mail integration service) and the server-side events `ticket assigned`, `ticket reopened`, `csat received`, and `subscription started`.
- Users work from one or two browsers (for example a work laptop and a home computer); a user can have more than one `device_id`.
- Users who joined before June 4 have no `account created` event in this window. Their `customer_since` is before the window.
- Count people with unique `user_id` (Mixpanel "Uniques"), not with `device_id`. Count companies with `company_id`.

## Conventions

- Event and property names are lowercase with spaces or underscores, as tracked. The Mixpanel experiment fields keep their original capitalization.
- Money is in US dollars. Plan prices are per agent seat per month.
- "September" means September 1-30; the window's last day (October 1) is reported separately.
