# Clearwell Health metrics and warehouse tables

## KPI definitions

All KPIs use UTC days and count people by unique `user_id`. Visit-level KPIs hold `visit_id` constant (Mixpanel Funnels "hold property constant", Totals counting) so each visit counts once.

| KPI | Definition |
|---|---|
| New patients | Unique patients with `account created` in the period. |
| Active patient | A patient with at least one patient-initiated event in the period. Server-side events (`reminder sent`, `appointment missed`) do not count as activity. |
| Patients served | Unique patients with `visit completed` or `therapy session completed` in the period. |
| Visit request rate | `visit requested` events divided by `symptom check completed` events over the same period and segment. |
| Visit start rate | Per live urgent-care request (`visit_type` `video` or `phone`), the share with `visit started` within 1 day. Async requests are excluded because they have no live start. |
| Waiting room exit rate | Per live urgent-care request, the share that ends in `waiting room left`. Visit start rate + exit rate = 100% for live requests. |
| Urgent completion rate | Per urgent-care request (any `visit_type`), the share with `visit completed` within 1 day. |
| Async share | Among `visit requested` events for the four Async-eligible reasons (`urinary`, `skin_rash`, `pink_eye`, `allergy`), the share with `visit_type = async`. |
| Estimated wait | `estimated_wait_min` on live `visit requested` events. Report the average and the median; exclude Async (always 0). |
| Prescription pickup rate | Per prescription (`prescription sent`), the share with `prescription picked up` within 7 days. Count only prescriptions with a full 7 days of data. |
| Time to pickup | Per prescription, hours from `prescription sent` to `prescription picked up`. Report the median. |
| No-show rate | Per primary care appointment (`appointment booked`), the share that ends in `appointment missed`. Count only appointments whose date has passed. |
| Time to first therapy session | Per new therapy client, time from `therapy intake completed` to their first `therapy session completed`, within 30 days. Report the median. Count only intakes with a full 30 days of data. |
| Remote monitoring engagement | Share of program patients with at least one `reading logged` in a period. New enrollees join throughout the window, so monthly totals mix new and established patients. |
| Visit rating | Average `rating` on `visit rated`, and the share of 4-5 star ratings. Ratings are optional. |
| Revenue per visit | `total_revenue_usd` / `visits_billed` in `visit_revenue_daily`, by service line and coverage. Employer-covered visits show $0 here because employers pay a monthly fee instead (see 01-business.md). |
| Clinician hours per request | Urgent-care `clinician_hours` in `clinician_staffing_daily` divided by urgent-care `visit requested` events on the same day. |

## Warehouse tables

Two tables come from the data warehouse, not from Mixpanel events. Each has one row per UTC day per dimension value for every day from 2026-06-04 to 2026-10-01 (120 days). Days with no activity have a row with zeros. They join to events on the UTC date of the event and on the named dimension.

In the warehouse, count columns and whole-dollar rates are INTEGER (INT64); hours and amounts with cents are FLOAT (FLOAT64).

### `clinician_staffing_daily`

Daily clinician hours by service line, from the scheduling and time-keeping system. Hours are planned to a demand forecast for each day; actual hours worked can differ from the plan.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Shift day. |
| `service_line` | STRING | — | `urgent_care`, `primary_care`, or `behavioral_health`. Matches `service_line` on events. |
| `clinician_hours` | FLOAT | hours | Total clinician hours worked (employed + agency). |
| `employed_clinician_hours` | FLOAT | hours | Hours worked by Clearwell-employed clinicians. |
| `agency_clinician_hours` | FLOAT | hours | Hours worked by clinicians from a staffing agency. |
| `spanish_speaking_clinician_hours` | FLOAT | hours | Hours worked by clinicians who see patients in Spanish (included in `clinician_hours`). |
| `clinicians_on_shift` | INTEGER | count | Clinicians who worked that day. Shift lengths vary; the average shift is about 7.5 hours. |

Caveats: primary care has 0 hours on days the clinic is closed (Sundays and the July 3 and September 7 holidays). Hours include charting and time between visits, so hours per visit are higher than visit durations on events. Remote monitoring nurses are not in this table.

### `visit_revenue_daily`

Daily billed visits and revenue by service line and coverage type, from the billing (revenue cycle) system.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Day the claims posted in billing. |
| `service_line` | STRING | — | `urgent_care`, `primary_care`, or `behavioral_health`. |
| `coverage_type` | STRING | — | `employer`, `commercial`, `medicare`, `medicaid`, `self_pay`. Matches `coverage_type` on events. |
| `visits_billed` | INTEGER | count | Visits (or therapy sessions) whose claims posted that day. |
| `avg_patient_charge_usd` | FLOAT | USD per visit | What the patient pays per visit: the self-pay list price on that day, or the average copay for the coverage type. |
| `payer_rate_usd` | INTEGER | USD per visit | Contracted reimbursement per visit from the insurer. 0 for employer and self-pay. |
| `patient_revenue_usd` | FLOAT | USD | `visits_billed` × `avg_patient_charge_usd`. |
| `payer_revenue_usd` | INTEGER | USD | `visits_billed` × `payer_rate_usd`. |
| `total_revenue_usd` | FLOAT | USD | Patient revenue + payer revenue. |

Caveats: billing and Mixpanel differ day to day. Claims post on the day billing closes them, so part of each day's visits posts the next day. Billing also includes visits from Clearwell's nurse phone line, which never reach the app, and nets out voided visits. Employer fees and remote monitoring fees are not in this table. Async visits bill as urgent-care visits.

## Analysis tips

- For a before/after question around a dated change, consider the weekly rhythm, the growth of the patient base, other dated changes nearby, and mix shifts before you attribute a change to the event.
- Demand follows a weekly rhythm (Monday is the busiest day). Compare whole weeks or matching weekdays.
- New patients keep arriving through the window, so totals grow over time. Use rates (per symptom check, per request, per prescription, per appointment) when you compare periods.
- Patients have many visits. Visit-level questions need `visit_id` held constant; unique-patient funnels hide differences between visits.
- Conversion, pickup, no-show, and therapy-start reads need complete windows: leave out the last days of the window when the conversion window would run past October 1.
