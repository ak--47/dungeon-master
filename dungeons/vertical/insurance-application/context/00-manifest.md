# Shieldstone Insurance analytics: read me first

This folder is the internal analytics wiki for **Shieldstone Insurance**, a direct-to-consumer personal insurance company. It explains the business, the calendar of the period, the tracking plan, and the business tables in the data warehouse. Read it before you answer questions about the Shieldstone Mixpanel project or its raw data exports.

## What the dataset covers

- **Product:** the Shieldstone website and the iOS and Android apps. People get a quote for auto, homeowners, or renters insurance, create an account, buy a policy, and then manage it online: ID cards, policy documents, bills and payments, coverage changes, roadside assistance, and claims. Back-office systems (billing, policy administration, claims) also send events: autopay payments, renewal notices, renewals, cancellations, policy issue, and claim settlements.
- **Window:** 2026-06-04 00:00 to 2026-10-01 23:59 (UTC). That is 120 days, from early summer through the end of September and the first day of October.
- **Scale:** about 10,000 people. About 6,000 were already Shieldstone customers on June 4. About 3,700 new shoppers started a quote during the window; about 2,450 of them never created an account and appear only as anonymous devices. The project holds about 760,000 events.
- **Where customers live:** twelve US states (Texas, Florida, Pennsylvania, Illinois, Arizona, Georgia, Ohio, North Carolina, Colorado, Michigan, Louisiana, Tennessee), grouped into five claims regions.
- **Time zone:** every timestamp, daily bucket, and warehouse date is UTC. Customers are in US time zones, so a US afternoon is UTC evening and a US evening runs past midnight UTC.

## The other files

- **`01-business.md`** — who Shieldstone is, the products and how they are priced and billed, how shoppers find us, the customer segments the business talks about, and the goals for the period. Read it to understand what a metric means for the business.
- **`02-timeline.md`** — dated launches, an experiment, a rate change, a hurricane, a marketing campaign, holidays, and org changes in the window. Read it whenever a question mentions a date, a "before and after", or an unexplained bump or dip in a chart.
- **`03-event-dictionary.md`** — every event, event property, and user profile property: what each one means and what its values mean. It also lists the funnels the business tracks. Read it before you build any report.
- **`04-metrics-and-tables.md`** — how Shieldstone defines its KPIs (quote completion, purchase rate, cost per quote and per policy, claim cycle time, renewal retention, payment failure, written premium, and others), and a data dictionary for the three warehouse tables. Read it for metric definitions and whenever a question involves marketing spend, claims operations, or premium.

## How the data fits together

- **Events** (the Mixpanel event stream) record what people do on the website and in the apps, plus a few back-office events. Each event has a timestamp, an identity, and flat properties. The customer's state and the platform are on every event (`state`, `platform`).
- **Policies** tie events together. Every policy event (purchase, payments, renewal notice, renewal, cancellation) carries the same `policy_id`. A customer with two policies (a bundle) has two `policy_id` values.
- **Claims** tie events together too: every claim event carries `claim_id`.
- **User profiles** hold one row per identified person with events in the window, with their current attributes: state, region, age band, the product lines they hold, bundle and autopay status, customer status, customer-since date, acquisition channel, shopping reason, and experiment enrollment.
- **Warehouse tables** are daily business facts that are not in the event stream: marketing spend by paid channel, claims operations by region (claims reported, closed, open, adjuster hours, catastrophe codes), and written premium by product line and transaction type. They join to events on the UTC date and a shared dimension (`acquisition_channel`, `region`, or `product_line` + `transaction_type`).
- There are no group profiles, no slowly changing dimension tables, and no lookup tables in this project.

## Identity notes

- **Shoppers are anonymous while they quote.** `quote started` and `quote completed` carry only the shopper's `device_id`. If the shopper creates an account, `account created` carries both the new `user_id` and that `device_id`, and Mixpanel merges the earlier quote events into the customer. A shopper who never creates an account stays an anonymous device in Mixpanel and has no user profile.
- `$experiment_started` (the Express Quote test) carries the shopper's `device_id`; for shoppers who later created an account it also carries their `user_id`.
- Customers who joined before June 4 are identified on every event.
- Website and app events carry `user_id` and `device_id`. Many customers use more than one device (often a computer and a phone). `platform` is `web` for computers (Windows, macOS, Linux), `ios` for iPhone and iPad, and `android` for Android devices.
- Back-office events carry `user_id` only, with no device, and `platform = server`: `policy purchased`, `renewal offered`, `policy renewed`, `policy cancelled`, `claim settled`, payments and payment failures from autopay, and the first payment of a new policy (taken at purchase). Other payments a customer makes by hand come from the website or app and carry a device.
- Count people with Mixpanel "Uniques" on the merged identity. Funnels that start with a quote event work only with identity merging, because the quote steps happen before the account exists.

## Conventions

- Event and property names are lowercase with spaces or underscores, as tracked. The Mixpanel experiment fields keep their original capitalization.
- Money is in US dollars. Monthly premium fields are per month; `term_premium_usd` is for the whole policy term (6 months for auto, 12 months for homeowners and renters).
- "September" means September 1-30; the window's last day (October 1) is reported separately.
- "Property" means homeowners and renters together.
