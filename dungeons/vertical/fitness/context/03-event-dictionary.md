# Stridewell tracking plan (event dictionary)

Event names are lowercase, as tracked. Properties are flat on each event. Times are UTC.

## Properties on every event

| Property | Meaning |
|---|---|
| `time` | When the event happened (UTC). |
| `user_id` | The member's ID. Present on every event after signup. |
| `device_id` | The device the event came from. A member has about two devices. |
| `insert_id` | Unique event ID used for de-duplication. |
| `session_id` | The app session the event belongs to (diagnostic; Mixpanel computes its own sessions). |
| `Platform` | `ios` or `android`. Fixed per member. |
| `subscription_tier` | The member's plan **at the moment of the event**: `free`, `monthly`, or `annual`. It changes from `free` to a paid plan at the moment a member buys Plus. |
| `country`, `country_code`, `region`, `city` | Member location (one location per member). |
| `model`, `os`, `carrier`, `radio`, `screen_height`, `screen_width` | Device details from the mobile SDK. |

## Signup and onboarding

New members go through onboarding once, right after they install. These four events happen only in onboarding.

| Event | Meaning | Properties |
|---|---|---|
| `account created` | The member creates an account. The first product event of every new member and the moment their device is linked to their `user_id`. | `acquisition_channel`: how the member found us (`organic`, `referral`, `paid_social`, `paid_search`, `app_store_ads`); same value as the profile property. |
| `goal quiz completed` | The member answers the goals survey. | `primary_goal` (same as profile); `days_per_week_target` (2-5): how many days a week they want to train. |
| `plan generated` | The app builds the member's first training plan. | `plan_length_weeks` (4, 6, 8, 12); `workout_category`: the plan's main focus. |
| `starter workout completed` | The member finishes the short guided starter session that ends onboarding. | `duration_minutes` (8-15). |
| `$experiment_started` | Mixpanel experiment exposure, sent when a new member enters the Guided First Week test (from 2026-07-01). It is logged one second before the member's `account created` and already carries their `user_id`. | `Experiment name` = `Guided First Week`; `Variant name` = `Control` or `Guided Plan`. |

## Training

| Event | Meaning | Properties |
|---|---|---|
| `workout planned` | The member schedules a workout. | `planned_duration_minutes`; `workout_category` (`strength`, `running`, `hiit`, `yoga`, `cycling`, `walking`); `coaching_mode`: `self_guided`, or `ai_coach` when the member chose to do it with Stride Coach. |
| `workout completed` | A finished workout reached Stridewell. This is the value moment. A workout tracked on a wearable is recorded only after it syncs. | `workout_category`; `duration_minutes`; `calories_burned`; `avg_heart_rate` (bpm); `perceived_effort` (1-10, self-rated); `coaching_mode` (`self_guided` or `ai_coach`; Stride Coach is a Plus feature from 2026-08-12); `wearable_type`: the member's wearable (`smartwatch`, `fitness_band`, `chest_strap`, or `none`); `tracking_source`: what recorded this workout (`wearable`, `phone`, or `manual`). |
| `progress checked` | The member opens a progress view. | `metric_viewed` (`weekly_minutes`, `workout_streak`, `body_weight`, `personal_records`, `heart_rate_trend`); `time_range` (`week`, `month`, `3_months`). |
| `achievement unlocked` | The member earns a badge. | `achievement_type` (`streak_7`, `streak_30`, `personal_record`, `first_5k`, `challenge_badge`, `minutes_milestone`). |
| `coach session` | The member has a session with a human coach. | `session_type` (`live_video`, `form_check`, `plan_review`, `chat`); `coach_speciality` (`strength`, `running`, `mobility`, `nutrition`); `session_minutes`; `satisfaction_score` (1-5). |
| `meal logged` | The member logs a meal. | `meal_type` (`breakfast`, `lunch`, `dinner`, `snack`); `calories`; `protein_g`. |

## Challenges and social

| Event | Meaning | Properties |
|---|---|---|
| `challenge joined` | The member joins a challenge. | `challenge_id`: unique ID of the challenge; `challenge_format`: `solo` or `team`; `challenge_type` (`steps`, `strength`, `streak`, `distance`); `duration_days` (7-30). |
| `challenge completed` | The member finishes a challenge they joined. Same `challenge_id` as the join. | `challenge_id`; `challenge_format`; `challenge_type`; `final_rank`. |
| `friend added` | The member adds a friend. | `source` (`contacts`, `search`, `challenge`, `suggested`). |
| `leaderboard viewed` | The member views a leaderboard. | `leaderboard_type` (`friends`, `challenge`, `city`, `global`). |

## Plus subscription

| Event | Meaning | Properties |
|---|---|---|
| `paywall viewed` | A free member sees the Plus paywall. | `paywall_trigger` (`workout_library`, `advanced_plans`, `coach_teaser` (the Stride Coach teaser, shown from 2026-08-12), `challenge_limit`, `settings`); `plan`: the plan highlighted on the paywall. |
| `trial started` | A trial-eligible member starts their one 7-day Plus trial. | `plan` (`monthly` or `annual`): the plan the trial converts to; `trial_days` (7). |
| `subscription purchased` | The member buys Plus. One per member. Price is **not** tracked here; see `subscription_billing_daily`. | `plan` (`monthly` or `annual`); `payment_method` (`apple_pay`, `google_pay`, `card`). |

## Engagement and lifecycle

| Event | Meaning | Properties |
|---|---|---|
| `app opened` | The member opens the app. | `entry_point` (`home_screen`, `push`, `widget`, `watch_app`); `session_minutes`. |
| `notification received` | Stridewell sends the member a notification. | `notification_type` (`workout_reminder`, `streak_at_risk`, `challenge_update`, `friend_activity`, `weekly_recap`); `channel` (`push` or `email`); `opened` (true/false): whether the member opened it. |
| `profile updated` | The member edits their profile or settings. | `field_updated` (`body_weight`, `goal`, `photo`, `units`, `notification_settings`, `connected_devices`). |
| `account deactivated` | The member deactivates their account. Sent at most once, after a member stops using the app. | `reason` (`lost_motivation`, `switched_apps`, `injury`, `reached_goal`, `too_busy`); `subscription_tier` at deactivation. |

## User profile properties

| Property | Meaning |
|---|---|
| `distinct_id` | The member's ID (same as `user_id` on events). |
| `name`, `email`, `avatar` | Contact details. |
| `segment` | Lifestyle segment: `casual`, `beginner`, `social`, `athlete`, `trainer` (see 01-business.md). |
| `_persona` | Legacy copy of `segment` from an older CRM sync. |
| `fitness_level` | Latest self-reported level: `beginner`, `intermediate`, `advanced`, `elite`. History is in the `fitness_level` history table. |
| `primary_goal` | `lose_weight`, `build_strength`, `improve_endurance`, `stay_active`, `reduce_stress`. |
| `acquisition_channel` | Channel at signup (for members who joined before the window, the channel they originally came from). |
| `wearable_type` | `smartwatch`, `fitness_band`, `chest_strap`, or `none`. |
| `subscription_tier` | Current plan: `free`, `monthly`, `annual`. |
| `trial_eligible` | `true` for members whose one trial was still available or in progress on June 4: everyone who joined in the window, plus a small number who joined in the weeks just before it. `false` for earlier members, who already used their trial. |
| `Platform` | `ios` or `android`. |
| `Experiment: Guided First Week` | `Control` or `Guided Plan` for members enrolled in the onboarding test; empty for everyone else. |
| `created` | Signup time for members who joined in the window; empty for earlier members. |
| `country`, `country_code`, `region`, `city` | Location. |
| `anonymousIds`, `sessionIds` | Devices and sessions seen for the member (pipeline metadata). |

## `fitness_level` history (slowly changing dimension)

One row per change in a member's self-reported fitness level: `distinct_id`, `fitness_level`, and `startTime` (when that level began). Members update their level about monthly at most. Use it to read a member's level as of an event's date.

## Funnels the business tracks

| Funnel | Steps | Notes |
|---|---|---|
| Onboarding | `account created` → `goal quiz completed` → `plan generated` → `starter workout completed` | New members only. The business reads it with a 7-day conversion window. |
| Workout loop | `workout planned` → `workout completed` → `progress checked` | The core habit loop. Members repeat it many times. |
| Upgrade (trial) | `paywall viewed` → `trial started` → `subscription purchased` | Trial-eligible members (`trial_eligible = true`): mostly new members. |
| Upgrade (direct) | `paywall viewed` → `subscription purchased` | Members who already used their trial (`trial_eligible = false`). |
| Challenge completion | `challenge joined` → `challenge completed` | Members join many challenges; hold `challenge_id` constant to measure each challenge on its own. |
| Coaching | `coach session` → `workout planned` → `workout completed` | |
