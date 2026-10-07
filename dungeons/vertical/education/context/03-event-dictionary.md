# Brightpath Academy tracking plan (event dictionary)

Event names are lowercase, as tracked. Properties are flat on each event. Times are UTC.

## Properties on events

| Property | Meaning |
|---|---|
| `time` | When the event happened (UTC). |
| `user_id` | The learner's ID. Present on every event. |
| `device_id` | The device the event came from. A learner has about two devices. Present on every event except `certificate earned` and `subscription started`, which the backend sends with `user_id` only. |
| `insert_id` | Unique event ID used for de-duplication. |
| `session_id` | The app session the event belongs to (diagnostic; Mixpanel computes its own sessions). |
| `plan_tier` | The learner's plan **at the moment of the event**: `free`, `plus`, or `teams`. It changes from `free` to `plus` at the moment a learner starts a subscription. Teams learners are `teams` on every event. |
| `platform` | Where the event came from: `web`, `ios`, or `android`, from the device's operating system. Not present on the two backend events. |
| `os`, `model`, `screen_height`, `screen_width`, `carrier`, `radio` | Device details from the SDK. The device fields stay the same for a given `device_id`. |
| `country`, `country_code`, `region`, `city` | Learner location (one location per learner). |

## Signup and onboarding

New learners go through onboarding once, on the device they signed up on. Many answer the questionnaire and pick a first course later the same day or the next day, so the onboarding steps are often in a later app session than the signup.

| Event | Meaning | Properties |
|---|---|---|
| `account created` | The learner creates an account. First event of every new learner and the moment their device is linked to their `user_id`. | `signup_method` (`google`, `email`, `apple`, `sso`); `acquisition_channel` (`organic_search`, `paid_search`, `paid_social`, `youtube_ads`, `referral`, `university_partnership`, `employer`), same as the profile; `account_type` (`individual`, `employer_sponsored`), same as the profile. |
| `learning goals set` | The learner answers the onboarding questionnaire. | `primary_goal` (same as the profile); `weekly_hours_target` (2-10 hours a week). |

The first `course enrolled` and the first `lesson started` of a new learner complete onboarding (see Funnels).

## Catalog and enrollment

| Event | Meaning | Properties |
|---|---|---|
| `course search` | The learner searches the catalog. | `query_topic` (one of the six categories); `results_count`. |
| `course page viewed` | The learner opens a course's page. | `course_id`, `course_title`, `course_category`, `course_format` (`self_paced`, `cohort`), `course_level` (`beginner`, `intermediate`, `advanced`), `course_length_weeks` (4-8). |
| `course enrolled` | The learner enrolls in a course. A learner enrolls in a given course at most once. | The same course fields as `course page viewed`, plus `enrollment_source` (`catalog_browse`, `search`, `recommendation`, `learning_path`: a path assigned by a Teams employer or chosen in onboarding) and `cohort_start_date` (cohort courses only: the date, YYYY-MM-DD, of the Monday the learner's group starts; not present for self-paced courses). |
| `$experiment_started` | Mixpanel experiment exposure, sent once per learner at their first course page view while the Personalized Course Picks test is live (from 2026-07-08). | `Experiment name` = `Personalized Course Picks`; `Variant name` = `Control` or `Personalized`. |

## Learning

Every learning event carries the `course_id` and `course_category` of the course it belongs to. A learner can have several courses in progress at once.

| Event | Meaning | Properties |
|---|---|---|
| `lesson started` | The learner opens a lesson. | `course_id`, `course_category`; `lesson_id`: this lesson visit; `lesson_number` (position in the course, 1 to 4 × course weeks); `content_type` (`video`, `reading`, `lab`). |
| `lesson completed` | The learner finishes the lesson they started. Same `lesson_id`, `lesson_number`, and `content_type` as its `lesson started`. Some started lessons are never completed; a few completions early on June 4 belong to lessons started before the window. | The same fields as `lesson started`, plus `minutes_spent` and `playback_speed` (1, 1.25, 1.5, 2; video lessons only, the speed the video played at). |
| `quiz submitted` | The learner submits a quiz. Learners take a course's quizzes in order. After failing a quiz, a learner may retake it (up to three attempts in total) or move on to the next one; a passed quiz is not retaken. | `course_id`, `course_category`; `quiz_number` (1 to the course's number of weeks); `score_pct` (0-100); `passed` (score of 70 or more); `attempt_number` (integer: 1 for the first try at that quiz in that course, 2 or 3 for retakes). |
| `assignment submitted` | The learner submits an assignment. | `course_id`, `course_category`; `assignment_type` (`project`, `peer_review`, `coding_exercise`, `written_response`); `is_late` (after the deadline; always `false` in self-paced courses, which have no deadlines). |
| `discussion posted` | The learner posts in a course discussion. | `course_id`, `course_category`; `post_type` (`question`, `answer`, `comment`); `word_count`. |
| `live session attended` | The learner joins a cohort course's live session (cohort courses only, from the group's start date). Sessions run at the course's fixed weekly section times; learners join within a few minutes of the start. | `course_id`, `course_category`; `minutes_attended`. |
| `ai tutor question asked` | The learner asks Ask Bright a question (Plus and Teams, from 2026-07-21). Conversations often include several questions a few minutes apart. | `course_id`, `course_category`; `question_type` (`explain_concept`, `check_my_answer`, `hint`, `summarize_lesson`). |
| `certificate earned` | Backend event: the learner finished a course. One per finished course, with the same `course_id` as its enrollment. Sent when the course ends for the learner: for cohort courses, on the group's end date, in the course's daily certificate run. | The course fields as on `course enrolled`, including `cohort_start_date` for cohort courses; `final_grade` (62-100); `days_to_complete`: days from enrollment to certificate (for cohort courses this includes the wait for the group's start). Courses that learners enrolled in before June 4 can finish in the window. |

## Engagement and billing

| Event | Meaning | Properties |
|---|---|---|
| `home viewed` | The learner opens their Brightpath home screen. | `entry_point` (`direct`, `bookmark`, `email_reminder`, `push_notification`). |
| `paywall viewed` | A free learner sees an upgrade prompt. Plus and Teams learners never see it. | `paywall_trigger` (`enrollment_limit`, `certificate_upsell`, `offline_downloads`, `ai_tutor` from 2026-07-21). |
| `subscription started` | Backend event: a self-pay learner starts Brightpath Plus. At most one per learner. Price is **not** tracked here; see `subscription_billing_daily`. | `plan` (`plus`); `billing_interval` (`monthly`, `annual`). |

## User profile properties

| Property | Meaning |
|---|---|
| `distinct_id` | The learner's ID (same as `user_id` on events). |
| `name`, `email`, `avatar` | Contact details. |
| `learner_segment` | `career_switcher`, `upskiller`, `university_student`, `lifelong_learner` (see 01-business.md). |
| `account_type` | `individual` (self-pay) or `employer_sponsored` (Teams seat). |
| `primary_goal` | `change_careers`, `advance_in_role`, `earn_course_credit`, `personal_interest`. |
| `plan_tier` | Current plan: `free`, `plus`, `teams`. |
| `customer_since` | Date the learner first signed up (YYYY-MM-DD). Before 2026-06-04 for established learners. |
| `acquisition_channel` | Channel at signup (for established learners, the channel they originally came from). |
| `preferred_playback_speed` | The video speed the learner set in their settings: 1, 1.25, 1.5, or 2. Videos usually play at it, but learners change speed for some lessons. |
| `Experiment: Personalized Course Picks` | `Control` or `Personalized` for learners exposed to the course page test; empty for everyone else. |
| `created` | Signup time for learners who joined in the window (the time of their `account created` event); empty for established learners. |
| `country`, `country_code`, `region`, `city` | Location. |
| `anonymousIds`, `sessionIds` | Devices and sessions seen for the learner (pipeline metadata). |

## Funnels the business tracks

| Funnel | Steps | Notes |
|---|---|---|
| Onboarding | `account created` → `learning goals set` → `course enrolled` → `lesson started` | New learners only. Read with a 7-day conversion window. |
| Course enrollment | `course page viewed` → `course enrolled` | Hold `course_id` constant and count totals to measure each page view; learners view many course pages. A 1-day window covers almost every enrollment from a page view. |
| Lesson | `lesson started` → `lesson completed` | Hold `lesson_id` constant to measure each lesson visit. |
| Course completion | `course enrolled` → `certificate earned` | Hold `course_id` constant and count totals to measure each enrollment. Courses run 4-8 weeks and some learners take longer, so use a 90-day window and enrollments that have had time to finish. |
| Upgrade | `paywall viewed` → `subscription started` | Free self-pay learners. |
