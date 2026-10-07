# Clearwell Health timeline: June 4 to October 1, 2026

All dates are UTC. This page lists what happened and when. It does not record outcomes; measure those in the data.

| Date | Type | What happened |
|---|---|---|
| 2026-06-04 (Thu) | — | Start of the analysis window. |
| 2026-06-22 (Mon) | Org | A new VP of Clinical Operations joins and takes over urgent-care staffing and the waiting-room program. |
| 2026-07-01 (Wed) | Fiscal | Q3 starts. |
| 2026-07-03 (Fri) | Holiday | US Independence Day (observed). The primary care clinic is closed; urgent care, therapy, and remote monitoring run as usual. |
| 2026-07-15 (Wed) | Launch | **Clearwell Async** launches on iOS and Android for four minor conditions: urinary symptoms, rashes, pink eye, and allergies. When a patient requests an urgent-care visit for one of these, the app offers a questionnaire visit as an alternative to the live waiting room. A clinician reviews the answers and replies, usually within a few hours. An Async request is a `visit requested` event with `visit_type = async`. |
| 2026-07-28 (Tue) | Experiment | **"Prescription Pickup Reminders" test** starts. Patients who get a prescription from an urgent-care visit requested from this date are assigned 50/50, sticky per patient, to **Control** (no reminder) or **Text Reminders** (an SMS about 20 hours after the prescription if the pharmacy has not confirmed pickup yet). Assignment is recorded with one `$experiment_started` event per patient, sent one second before the patient's first prescription in the test, and the profile property `Experiment: Prescription Pickup Reminders`. Reminder texts appear as `reminder sent` with `reminder_type = rx_pickup`. Primary care prescriptions are not part of the test. |
| 2026-08-09 (Sun) | Staffing | The contract with Clearwell's locum staffing agency for urgent care expires; the renewal is not signed in time. From **2026-08-10 to 2026-08-23** urgent care runs on employed clinicians only. A new agency (a different vendor) starts on **2026-08-24**. Primary care and therapy are not affected. Daily clinician hours, split into employed and agency hours, are in `clinician_staffing_daily`. |
| 2026-08-31 (Mon) | Pricing | **Self-pay urgent-care price cut:** the list price for a self-pay urgent-care visit drops from $79 to $59 (also applies to Async visits). Primary care and therapy self-pay prices and all insured copays do not change. The price a patient will pay is shown at request (`patient_cost_usd`). |
| Mid-August to 2026-09-08 | Season | Schools reopen across the US; most states are back in session by September 8. |
| 2026-09-07 (Mon) | Holiday | US Labor Day. The primary care clinic is closed; urgent care, therapy, and remote monitoring run as usual. |
| Mid-September | Season | State public health departments begin their weekly respiratory-season reporting (flu, COVID-19, RSV). In the second half of September clinical operations moves urgent-care scheduling to its fall demand forecast. |
| 2026-09-30 (Wed) | Fiscal | End of Q3. |
| 2026-10-01 (Thu) | — | End of the analysis window (data runs through 23:59 UTC). Q4 starts. |

## Things that did not change in the window

- No change to primary care, therapy, or remote monitoring pricing, or to any insured copay.
- No change to the symptom checker, the triage rules, or how the estimated wait is calculated.
- The Spanish-speaking clinician roster and the language options did not change.
- The remote monitoring device models and vendors did not change; no device recalls.
- No marketing campaigns ran; acquisition channel budgets were steady.
- No app outages or incidents were recorded. The urgent-care staffing change above is the only operational event.
- Holidays affect only the primary care clinic (closed); Clearwell has not seen holidays change urgent-care demand in a way the team acts on.

## Open questions leadership has asked

- Is Clearwell Async being used, and is it good for patients?
- How long will patients wait in the virtual waiting room? What can we do about patients who leave?
- What did the August agency gap cost us?
- Should we ship Prescription Pickup Reminders to everyone?
- Do Spanish-speaking patients get the same access to urgent care?
- Did the self-pay price cut pay off?
- Why do primary care patients miss appointments?
- How long do new therapy clients wait for their first session?
- Are remote monitoring patients staying engaged with their programs?
- How big is respiratory season so far, and are we staffed for it?
