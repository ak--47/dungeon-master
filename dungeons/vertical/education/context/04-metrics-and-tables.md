# Brightpath Academy metrics and warehouse tables

## KPI definitions

All KPIs use UTC days and count people by unique `user_id`.

| KPI | Definition |
|---|---|
| New signups | Unique learners with `account created` in the period. |
| Onboarding completion | Share of new learners who reach `lesson started` after `account created` → `learning goals set` → `course enrolled`, in order, within 7 days of signup. |
| Time to first lesson | For new learners who complete onboarding, time from `account created` to the onboarding `lesson started`. Report the median. |
| Weekly active learners | Unique learners with any event in a calendar week (Monday start), not counting the backend events `certificate earned` and `subscription started`. |
| Lesson completion rate | Share of `lesson started` events whose lesson (same `lesson_id`) was completed. |
| Quiz score / pass rate | Average `score_pct` / share of `quiz submitted` with `passed = true`. |
| Enrollment conversion | Share of course page views followed by an enrollment in the same course (hold `course_id` constant, totals) within a day. |
| Course completion | Share of enrollments that end in a `certificate earned` for the same course. Only count enrollments that have had time to finish (courses run up to 8 weeks and some learners take longer; the learning team uses enrollments at least 90 days before the end of the data). |
| Activation | The growth team's working definition of an activated new learner is still under discussion; it is measured from first-week behavior only. |
| Day-N retention | Of new learners who signed up on day 0, the share with any event on or after day N (Mixpanel unbounded retention), or in days N to N+6 for a bracketed view. Only count learners who signed up at least N+7 days before the end of the data. Do not count backend events (`certificate earned`, `subscription started`) as activity. |
| Ask Bright adoption | Share of learners active on a Plus or Teams plan since 2026-07-21 who asked at least one tutor question. |
| Paid conversion | Share of new self-pay learners who start a Plus subscription within 30 days of `account created` (the Mixpanel Funnels default conversion window). Count only signups with a full 30 days of data (signups through August 31). |
| New Plus subscriptions | Count of `subscription started`, split by `billing_interval`. |
| Bookings | New subscriptions × list price on the start date, from `subscription_billing_daily`. Annual subscriptions book the full year up front. |
| CAC (paid) | Spend for a paid channel divided by new signups Mixpanel recorded from that channel (`account created` with that `acquisition_channel`) over the same days. Finance uses Mixpanel signups, not the signups the ad platforms report. |
| Cost per paying subscriber | Spend for a paid channel over a signup period divided by that period's signups from the channel who started Plus within 30 days. |

## Warehouse tables

Three tables come from the data warehouse, not from Mixpanel events. Each has one row per UTC day per dimension value for every day from 2026-06-04 to 2026-10-01 (120 days). Days with no activity have a row with zeros. They join to events on the UTC date of the event and on the named dimension.

Count columns (signups, clicks, impressions, video starts, subscriptions) and the whole-dollar columns `list_price_usd` and `gross_bookings_usd` are INTEGER (INT64 in the warehouse). Spend and rates are FLOAT (FLOAT64).

### `paid_marketing_daily`

Daily paid marketing cost by channel, from the ad platforms' billing exports. Each channel runs on a daily budget that the platform paces through the day. Budgets follow a weekly schedule (lower on Friday and Saturday, when learners study least), but ads keep serving every day, so spend is billed every day.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Spend day. |
| `acquisition_channel` | STRING | — | `paid_search`, `paid_social`, or `youtube_ads`. Matches `acquisition_channel` on `account created`. |
| `spend_usd` | FLOAT | USD | Media spend billed for the day. |
| `platform_reported_signups` | INTEGER | count | Signups the ad platform claims for the day. Platforms use their own attribution and usually claim more than Mixpanel records. |
| `clicks` | INTEGER | count | Ad clicks reported by the platform. |
| `impressions` | INTEGER | count | Ad impressions reported by the platform. |

Caveats: organic search, referral, university partnership, and employer signups have no media spend and are not in this table. Use Mixpanel signups, not `platform_reported_signups`, for CAC.

### `app_stability_daily`

Daily video playback and app health by platform, from the video player's quality monitoring and the mobile crash reporter.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Day. |
| `platform` | STRING | — | `web`, `ios`, or `android`. Matches `platform` on events. |
| `video_starts` | INTEGER | count | Videos the player started that day: lesson videos plus course trailers and previews on course pages. |
| `playback_failure_rate` | FLOAT | share 0-1 | Share of video starts that hit a player error (failed to load, stalled, or crashed the player). |
| `crash_free_session_rate` | FLOAT | share 0-1 | Share of app sessions without a crash. Web reports browser-side errors that end a session. |
| `app_version` | STRING | — | The app version most learners on the platform used that day. `web` for the web app, which deploys continuously. |

Caveats: course trailers and previews do not send a lesson event, so `video_starts` runs higher than the Mixpanel count of video `lesson started` and does not track it exactly day to day. Mixpanel does not record player errors.

### `subscription_billing_daily`

Daily new Plus subscriptions, list prices, and bookings by billing interval, from the billing system.

| Column | Type | Unit | Meaning |
|---|---|---|---|
| `date` | DATE | UTC day | Subscription start day. |
| `billing_interval` | STRING | — | `monthly` or `annual`. Matches `billing_interval` on `subscription started`. |
| `new_subscriptions` | INTEGER | count | New Plus subscriptions billed that day. |
| `list_price_usd` | INTEGER | USD | List price of a new subscription of this interval on this day (per month for monthly, per year for annual). |
| `gross_bookings_usd` | INTEGER | USD | `new_subscriptions` × `list_price_usd`: the first payment of the day's new subscriptions. |

Caveats: the table covers new Plus subscriptions only, not renewals, refunds after the first payment, or Teams contracts. Billing and Mixpanel differ a little day to day: a first payment that fails is never booked, and some purchases made through the app stores never reach Mixpanel. Use this table, not Mixpanel, for booked subscriptions and revenue.

## Analysis tips

- For a before/after question around a dated change, consider seasonality, weekday mix, the overall trend, and mix shifts before you attribute a change to the event.
- Activity follows a weekly study rhythm: Sunday is the busiest study day and Friday and Saturday are the quietest. Compare whole weeks or matching weekdays.
- Learners do many lessons, quizzes, and course page views. Per-lesson and per-page-view questions need `lesson_id` or `course_id` held constant; a unique-learner funnel answers a different question (did the learner ever do it).
- New-learner funnels, conversion, and retention depend on signup date: learners who joined late in the window have had less time to act. Compare cohorts that joined in the same weeks.
- New learners join every day, so the mix of new and established learners shifts across the window. Raw weekly totals can move for reasons unrelated to any one change.
