# Clearwell Health analytics: read me first

This folder is the internal analytics wiki for **Clearwell Health**, a virtual care company. It explains the business, the calendar of the period, the tracking plan, and the business tables in the data warehouse. Read it before you answer questions about the Clearwell Mixpanel project or its raw data exports.

## What the dataset covers

- **Product:** the Clearwell iOS and Android apps: on-demand urgent care visits (symptom check, virtual waiting room, video or phone visit), Clearwell Async questionnaire visits, scheduled primary care appointments, therapy, remote monitoring for hypertension and diabetes, prescriptions sent to the patient's pharmacy, lab results, the health record, and secure messaging with the care team.
- **Window:** 2026-06-04 00:00 to 2026-10-01 23:59 (UTC). That is 120 days, from early June through the end of September and the first day of October.
- **Scale:** about 10,000 patients were active in the window. About 3,500 of them signed up during the window; the rest joined before June 4. The project holds about 1.2 million events.
- **Geography:** patients live in the United States, mostly in California, Texas, Florida, and New York. The apps are available in English and Spanish.
- **Time zone:** every timestamp, daily bucket, and warehouse date is UTC. Patients are in US time zones, so a US evening falls after midnight UTC, and a US business day runs from about 13:00 to 03:00 UTC.

## The other files

- **`01-business.md`** — who Clearwell is, the four service lines, how patients pay (coverage types and prices), how patients find us, care teams and staffing, the patient segments the business talks about, and the goals for the period. Read it to understand what a metric means for the business.
- **`02-timeline.md`** — dated launches, an experiment, a staffing change, a price change, the start of respiratory season, holidays, and org changes in the window. Read it whenever a question mentions a date, a "before and after", or an unexplained bump or dip in a chart.
- **`03-event-dictionary.md`** — every event, event property, and user profile property: what each one means in the product and what its values mean. It also lists the funnels the business tracks. Read it before you build any report.
- **`04-metrics-and-tables.md`** — how Clearwell defines its KPIs (visit start rate, waiting room exits, no-show rate, prescription pickup, time to first therapy session, remote monitoring engagement, revenue per visit, and others), and a data dictionary for the two warehouse tables. Read it for metric definitions and whenever a question involves clinician staffing, prices, or revenue.

## How the data fits together

- **Events** (the Mixpanel event stream) record what patients do in the app and what Clearwell's systems send them. Each event has a timestamp, the patient's identity, and flat properties. The patient's coverage type and preferred language are copied onto every event (`coverage_type`, `preferred_language`), so you can break down events without a lookup table.
- **Visits** tie events together. Every step of one urgent-care visit (the symptom check, the request, the waiting room, the visit, the prescription and its pickup, the rating) shares one `visit_id`. Every step of one primary care appointment (the booking, the reminder, the visit or the missed appointment, the prescription, the rating) also shares one `visit_id`. Therapy and remote monitoring events have no `visit_id`.
- **User profiles** hold one row per patient with their current attributes: coverage type, age band, gender, preferred language, state, remote monitoring program and device, therapy status and therapist preference, acquisition channel, member-since date, and experiment assignment.
- **Warehouse tables** are daily business facts that are not in the event stream: clinician hours by service line (from the scheduling system), and billed visits and revenue by service line and coverage type (from the billing system). They join to events on the UTC date and a shared dimension (`service_line`, `coverage_type`).
- There are no group profiles and no slowly changing dimension tables in this project.

## Identity notes

- A new patient is identified when they create an account. `account created` is each new patient's first event and carries both the patient's `user_id` and the `device_id` of their phone or tablet. There is no anonymous pre-signup activity in the data.
- Every event carries `user_id`. Most events also carry `device_id` and device details (`os`, `model`, and so on). The exceptions: `coverage added` and `program enrolled` (sent by the app's enrollment flow after signup with `user_id` and device details such as `os`, but no `device_id`), and the server-side events `reminder sent` and `appointment missed` (sent by Clearwell's systems with `user_id` and no device fields at all).
- Each patient uses one device: an iPhone, an iPad, or an Android phone (`os` = `iOS`, `iPadOS`, or `Android`).
- Patients who joined before June 4 have no `account created` event in this window. Their `member_since` profile date is before the window. For patients who joined in the window, `member_since` is their signup date.
- Count people with unique `user_id` (Mixpanel "Uniques"), not with `device_id`.

## Conventions

- Event and property names are lowercase with spaces or underscores, as tracked. The Mixpanel experiment fields keep their original capitalization.
- Money is in US dollars. Durations and waits are in minutes unless the property name says otherwise (`lead_days`, `days_until_session`).
- "Insured" means coverage types `employer`, `commercial`, `medicare`, and `medicaid`; `self_pay` patients pay the list price themselves.
- "September" means September 1-30; the window's last day (October 1) is reported separately. "June" in this window starts on June 4.
