# Clearwell Health: the business

## Who we are

Clearwell Health is a virtual care company for adults in the United States. Patients use the Clearwell app to see a licensed clinician by video or phone, get prescriptions sent to their pharmacy, book primary care, see a therapist, and manage a chronic condition from home. Clearwell started in 2023 in Colorado and is licensed in every state where its patients live; most patients are in California, Texas, Florida, and New York.

The company has about 210 employees. About 50 full-time-equivalent clinicians see patients in a given week: physicians, nurse practitioners, physician assistants, and licensed therapists. A locum staffing agency supplies part of the urgent-care roster. The rest of the company is clinical operations (scheduling and staffing), product and engineering, pharmacy partnerships, revenue cycle (billing), employer sales, and patient support.

Revenue comes from three sources:

- **Visit billing** (about $520,000-650,000 a month in the summer of 2026, growing with the patient base): insurance reimbursement for visits, plus what patients pay themselves (copays and self-pay prices). The warehouse table `visit_revenue_daily` holds it.
- **Employer fees** (about $190,000 a month): employer clients pay a fixed fee per eligible employee per month. Their employees then pay nothing per visit. Finance books these fees monthly; they are not in the visit revenue table.
- **Remote monitoring program fees** billed to health plans (small; not analyzed here).

## Service lines

| Service line (`service_line`) | What it is | How it works in the app |
|---|---|---|
| Urgent care (`urgent_care`) | On-demand care for new, non-emergency problems (respiratory infections, urinary symptoms, rashes, pink eye, allergies, stomach problems, minor injuries, headaches, back pain). Open 24/7. | The patient completes a symptom check. The checker recommends a virtual visit, self-care, or in-person care. For a virtual visit the patient requests a visit, sees the estimated wait, and enters the virtual waiting room until a clinician joins by video or phone. From July 15, some minor conditions can use **Clearwell Async** instead (see below). |
| Primary care (`primary_care`) | Scheduled visits with a primary care clinician: annual checkups, chronic condition follow-ups, medication reviews, new concerns, lab reviews. | The patient books a video or phone appointment for a later day. Appointments run Monday to Saturday during US clinic hours. Clearwell sends a reminder the day before. |
| Behavioral health (`behavioral_health`) | Weekly therapy with a licensed therapist for anxiety, depression, stress, relationships, sleep, and grief. | A new client completes an intake and books a first session. At intake the client either takes the first available therapist or asks for a specific therapist (for example a therapist of a certain gender, background, or specialty). A typical course is 6 to 16 weekly 50-minute sessions. |
| Remote monitoring | Programs for hypertension and diabetes. | The patient receives a connected blood pressure cuff or glucometer. Each reading flows into the app and to the care team. Devices come in two models, a cellular model and a Bluetooth model; the programs team assigns whichever is in stock. |

**Clearwell Async** (launched 2026-07-15): for urinary symptoms, rashes, pink eye, and allergies, the patient can answer a short questionnaire instead of waiting for a live visit. A clinician reviews it, messages the patient, and sends a prescription if needed, usually within a few hours. Async visits have no waiting room.

**Prescriptions** go electronically to the patient's chosen pharmacy (a chain, grocery, or independent pharmacy). The pharmacy confirms when the patient picks the prescription up.

**Languages:** the app and visits are available in English and Spanish. A patient whose preferred language is Spanish is seen by a Spanish-speaking clinician.

## How patients pay

Each patient has one coverage type (`coverage_type`):

| Coverage type | Who | What the patient pays |
|---|---|---|
| `employer` | Employees of a Clearwell employer client | $0 for every visit (the employer pays a monthly fee) |
| `commercial` | Patients with their own health insurance plan | Their plan's copay: $0, $10, $25, or $40 per visit |
| `medicare` | Patients 65 and older on Medicare | $0 or $15 per visit |
| `medicaid` | Patients on Medicaid | $0 |
| `self_pay` | Patients without coverage, or who choose not to use it | List price: urgent care visit $79 until 2026-08-30 and $59 from 2026-08-31; primary care visit $99; therapy session $120 |

Insurance plans reimburse Clearwell a contracted rate per visit on top of the copay. Contracted rates differ by plan type and service line and are in `visit_revenue_daily`. The patient sees what they will pay (`patient_cost_usd`) when they request a visit or book an appointment.

## Patients

- **Size:** about 10,000 patients used Clearwell in the window. About 3,500 signed up during the window, around 200 a week; the patient base grows through the period.
- **Coverage mix:** about 34% employer, 28% commercial, 16% self-pay, 11% Medicare, 11% Medicaid.
- **Age:** most patients are 26-55; about 13% are 65 or older (almost all on Medicare).
- **Language:** about 15% of patients prefer Spanish (`preferred_language = es`); they are concentrated in California, Texas, and Florida.
- **Remote monitoring:** about 1,750 patients are in a remote monitoring program (about two thirds hypertension, one third diabetes).
- **Therapy:** about 1,500 patients are in therapy with Clearwell in the window, some continuing a course that started before June and some starting new.
- **Engagement segments:** the CRM assigns each patient a lifecycle segment (`_persona` on the profile): `monitoring_member` (remote monitoring patients, the most active), `frequent_patient`, `regular_patient`, and `occasional_patient`.

## How patients find us

New patients arrive through one of six acquisition channels, recorded at signup (`acquisition_channel`): `employer_benefit` (their employer's benefits portal), `organic` (app store, word of mouth), `google_search`, `meta_ads`, `insurer_referral` (their health plan's member site), and `clinician_referral`. Most employer-covered patients come through the employer benefit channel.

## Care operations

- Urgent care is staffed around the clock to a demand forecast by hour and day of week; the scheduling system records clinician hours per day by service line (`clinician_staffing_daily`). The urgent-care roster mixes employed clinicians and agency clinicians.
- The estimated wait shown to a patient at request comes from the live queue: how many patients are waiting and how many clinicians who can see them are free.
- Primary care runs Monday to Saturday. The primary care clinic is closed on Sundays and on US federal holidays observed by Clearwell.
- Patients rate visits from 1 to 5 stars after the visit (optional).

## Goals for the period (Q3 2026)

Leadership set these goals for the quarter:

1. **Fewer patients lost in the waiting room.** Clinical operations wants to know how long patients will wait and what pushes them to leave. The operations team believes long waits drive patients away.
2. **Make Async a success.** The product team launched Clearwell Async in July and wants to know whether patients use it and whether it is good care.
3. **Better medication adherence.** The pharmacy partnerships team is testing pickup reminders (see 02-timeline.md) and wants a ship decision.
4. **Equal access.** The health equity committee asked whether Spanish-speaking patients get the same access to care as English-speaking patients.
5. **Grow self-pay.** Finance cut the self-pay urgent price at the end of August and asked whether it paid off.
6. **Fewer missed appointments.** Primary care wants to understand no-shows.
7. **Therapy access.** Behavioral health wants new clients in their first session quickly.
8. **Keep remote monitoring patients engaged.** The programs team wants to know who stops sending readings.
9. **Get ready for respiratory season.** Clinical operations plans urgent-care staffing for the fall.
