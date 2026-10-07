# Clearwell Health tracking plan (event dictionary)

Event names are lowercase, as tracked. Properties are flat on each event. Times are UTC.

## Properties on every event

| Property | Meaning |
|---|---|
| `time` | When the event happened (UTC). |
| `user_id` | The patient's ID. Present on every event. |
| `device_id` | The patient's device. Present on every event except `coverage added` and `program enrolled` (the enrollment flow sends `user_id` and device details, but no `device_id`) and the server-side events `reminder sent` and `appointment missed`. |
| `insert_id` | Unique event ID used for de-duplication. |
| `session_id` | The app session the event belongs to (diagnostic; Mixpanel computes its own sessions). |
| `coverage_type` | The patient's coverage: `employer`, `commercial`, `medicare`, `medicaid`, or `self_pay` (see 01-business.md). Fixed per patient. |
| `preferred_language` | `en` (English) or `es` (Spanish). Fixed per patient. |
| `os`, `model`, `screen_height`, `screen_width`, `carrier`, `radio` | Device details from the mobile SDK. `os` is `iOS`, `iPadOS`, or `Android`. Not present on server-side events. |

## Signup and enrollment

New patients go through these steps once, right after they sign up.

| Event | Meaning | Properties |
|---|---|---|
| `account created` | The patient creates an account. First event of every new patient and the moment their device is linked to their `user_id`. | `signup_method` (`email`, `apple`, `google`); `acquisition_channel` (`employer_benefit`, `organic`, `google_search`, `meta_ads`, `insurer_referral`, `clinician_referral`), same value as the profile property. |
| `coverage added` | The patient enters their coverage (or chooses self-pay). | `coverage_type`; `verification_status` (`verified`, `manual_review`, or `not_applicable` for self-pay). |
| `program enrolled` | A new patient joins a remote monitoring program at signup. Patients who joined a program before June 4 have no such event in the window. | `program` (`hypertension` or `diabetes`); `device_connectivity` (`cellular` or `bluetooth`): the device model the patient received. |

## App use

| Event | Meaning | Properties |
|---|---|---|
| `app opened` | The patient opens the app. | `open_source` (`organic`, `push_notification`, `sms_link`, `email_link`). |
| `health record viewed` | The patient opens part of their health record. | `record_type` (`visit_summary`, `medications`, `care_plan`, `immunizations`, `billing`). |
| `lab results viewed` | The patient opens a lab result. | `test_type` (`basic_metabolic_panel`, `lipid_panel`, `a1c`, `cbc`, `thyroid_panel`, `urinalysis`); `result_flag` (`normal`, `abnormal`). |
| `message sent` | The patient sends a secure message to their care team. | `message_topic` (`question_for_clinician`, `medication_question`, `scheduling`, `billing`, `test_results`). |

## Urgent care

Every step of one urgent-care visit shares one `visit_id`, from the symptom check to the rating.

| Event | Meaning | Properties |
|---|---|---|
| `symptom check completed` | The patient finishes the symptom checker. | `visit_id`; `reason_category` (`respiratory`, `urinary`, `skin_rash`, `pink_eye`, `allergy`, `stomach`, `minor_injury`, `headache`, `back_pain`, `other`); `triage_result`: the checker's recommendation (`virtual_visit`, `self_care`, `in_person`). Only `virtual_visit` checks can lead to a visit request. |
| `visit requested` | The patient requests an urgent-care visit. | `visit_id`; `service_line` = `urgent_care`; `visit_type` (`video`, `phone`, or `async` for a Clearwell Async questionnaire visit, from 2026-07-15); `reason_category`; `estimated_wait_min`: the wait in minutes shown to the patient when they requested (0 for Async, which has no waiting room); `patient_cost_usd`: what the patient will pay for the visit. |
| `waiting room left` | The patient leaves the virtual waiting room before a clinician joins. The visit does not happen. | `visit_id`; `service_line`; `minutes_waited`: minutes in the waiting room before leaving. |
| `visit started` | A clinician joins and the live visit begins (urgent care and primary care). Not sent for Async visits. | `visit_id`; `service_line`; `visit_type`; `wait_min`: minutes from request (urgent care) or appointment time (primary care) to the start. |
| `visit completed` | The visit ends and the clinician signs the note (urgent care, primary care, and Async). | `visit_id`; `service_line`; `visit_type`; `reason_category` (for primary care: the appointment reason); `duration_min`: clinician minutes with the patient (for Async: review time); `clinician_type` (`physician`, `nurse_practitioner`, `physician_assistant`). |
| `prescription sent` | The clinician sends a prescription to the patient's pharmacy (urgent care and primary care). At most one per visit. | `visit_id`; `service_line`; `medication_class` (for example `antibiotic`, `antiviral`, `inhaler`, `topical_steroid`, `antihistamine`, `nsaid`, `blood_pressure`, `diabetes`); `pharmacy_type` (`chain`, `grocery`, `independent`). |
| `prescription picked up` | The pharmacy confirms the patient picked up the prescription. | `visit_id`; `service_line`; `pharmacy_type`. |
| `visit rated` | The patient rates the visit after it ends (optional). | `visit_id`; `service_line`; `visit_type` (`video`, `phone`, or `async`); `rating` (1-5 stars); `would_recommend` (true or false). |
| `$experiment_started` | Mixpanel experiment exposure for the Pickup Reminders test: sent once per patient, one second after the patient's first urgent-care prescription in the test (from 2026-07-28). | `Experiment name` = `Pickup Reminders`; `Variant name` = `Control` or `Text Reminders`. |

## Primary care

Every step of one appointment shares one `visit_id`. A booked appointment ends either in `visit started` → `visit completed` or in `appointment missed`.

| Event | Meaning | Properties |
|---|---|---|
| `appointment booked` | The patient books a primary care appointment. | `visit_id`; `service_line` = `primary_care`; `appointment_reason` (`annual_checkup`, `chronic_followup`, `medication_review`, `new_concern`, `lab_review`); `visit_type` (`video`, `phone`); `lead_days`: days from booking to the appointment date (0 = same day); `patient_cost_usd`. |
| `reminder sent` | Server-side. Clearwell texts or pushes a reminder. `reminder_type = appointment`: the day before a primary care appointment booked at least a day ahead. `reminder_type = rx_pickup`: the Pickup Reminders text (see 02-timeline.md). | `visit_id`; `reminder_type`; `channel` (`sms`, `push`). |
| `appointment missed` | Server-side. The patient did not join the appointment; sent 15 minutes after the start time. | `visit_id`; `service_line`; `lead_days`. |

Primary care visits use `visit started`, `visit completed`, `prescription sent`, `prescription picked up`, and `visit rated` as above.

## Therapy

| Event | Meaning | Properties |
|---|---|---|
| `therapy intake completed` | A new therapy client completes the intake. Clients who were already in a course of therapy on June 4 have no intake in the window. | `service_line` = `behavioral_health`; `therapist_preference` (`first_available` or `specific_therapist`); `primary_concern` (`anxiety`, `depression`, `stress`, `relationships`, `sleep`, `grief`). |
| `therapy session booked` | The client books their next session (after the intake, then at the end of each session). | `service_line`; `session_number`: which session in the course is being booked; `days_until_session`. |
| `therapy session completed` | The client attends a session. Missed sessions send no event. | `service_line`; `session_number`; `duration_min`. |

## Remote monitoring

| Event | Meaning | Properties |
|---|---|---|
| `reading logged` | A reading from the patient's connected device arrives. | `reading_type` (`blood_pressure` or `glucose`); `in_range` (true if the reading is within the patient's target range); `sync_method` (`cellular` or `bluetooth`, the device model). |

## User profile properties

| Property | Meaning |
|---|---|
| `distinct_id` | The patient's ID (same as `user_id` on events). |
| `name`, `email`, `avatar` | Contact details. |
| `coverage_type` | Same as on events. |
| `age_band` | `18-25`, `26-35`, `36-45`, `46-55`, `56-64`, `65+`. |
| `gender` | `female`, `male`, `nonbinary`. |
| `preferred_language` | `en` or `es`. |
| `state` | US state of residence (two-letter code). |
| `chronic_program` | `hypertension`, `diabetes`, or `none` (not in a remote monitoring program). |
| `device_connectivity` | Remote monitoring device model: `cellular`, `bluetooth`, or `none`. |
| `therapy_client` | `true` if the patient is in therapy with Clearwell in the window. |
| `therapist_preference` | For therapy clients: `first_available` or `specific_therapist` (their choice at intake; for continuing clients, their choice when they started). `none` otherwise. |
| `acquisition_channel` | Channel at signup (for patients who joined before June 4, the channel they originally came from). |
| `member_since` | Date the patient first signed up (YYYY-MM-DD). Before 2026-06-04 for established patients. |
| `Experiment: Pickup Reminders` | `Control` or `Text Reminders` for patients in the test; empty for everyone else. |
| `created` | Signup time for patients who joined in the window; empty for established patients. |
| `anonymousIds`, `sessionIds` | Devices and sessions seen for the patient (pipeline metadata). |

## Funnels the business tracks

| Funnel | Steps | Notes |
|---|---|---|
| Urgent care | `symptom check completed` → `visit requested` → `visit started` → `visit completed` | Patients have many visits; hold `visit_id` constant to follow each visit on its own. Async visits skip `visit started`; use `visit requested` → `visit completed` when Async is included. Clinical operations reads the waiting room with a 1-day window. |
| Prescription pickup | `prescription sent` → `prescription picked up` | Hold `visit_id` constant. The pharmacy team reads pickup within 7 days. |
| Primary care attendance | `appointment booked` → `visit started` (attended) or → `appointment missed` | Hold `visit_id` constant; use a window that covers the appointment date (appointments are booked up to three weeks ahead). |
| Therapy start | `therapy intake completed` → `therapy session completed` | New clients only. Behavioral health reads it with a 30-day window. |
