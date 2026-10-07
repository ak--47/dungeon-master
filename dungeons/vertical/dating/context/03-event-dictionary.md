# Kindred tracking plan (event dictionary)

Event names are lowercase, as tracked. Properties are flat on each event. Times are UTC.

## Properties on every event

| Property | Meaning |
|---|---|
| `time` | When the event happened (UTC). |
| `user_id` | The member's ID. Present on every event. |
| `device_id` | The member's device. Present on every event except `photos uploaded` and `profile completed`, which the profile service sends server-side with `user_id` only. |
| `insert_id` | Unique event ID used for de-duplication. |
| `session_id` | The app session the event belongs to (diagnostic; Mixpanel computes its own sessions). |
| `subscription_plan` | The member's plan **at the moment of the event**: `free`, `plus`, or `premier`. It changes when a member starts a subscription, and goes back to `free` after they cancel. On `subscription cancelled` itself it is the plan being cancelled. |
| `platform` | `ios` (iPhone or iPad) or `android`. Fixed per member. |
| `market` | The member's city: one of the twelve markets in 01-business.md. Fixed per member. |
| `os`, `model`, `screen_height`, `screen_width`, `carrier`, `radio` | Device details from the mobile SDK. `os` is `iOS`, `iPadOS`, or `Android`. |

## Signup and profile setup

New members go through setup once, right after they sign up. These three events happen only during setup.

| Event | Meaning | Properties |
|---|---|---|
| `account created` | The member creates an account. First event of every new member and the moment their device is linked to their `user_id`. | `signup_method` (`apple`, `phone`, `google`); `acquisition_channel`: how the member found us (`organic`, `referral`, `meta_ads`, `tiktok_ads`, `apple_search_ads`), same value as the profile property. |
| `photos uploaded` | The member adds photos to their new profile. | `photo_count` (1-9): photos on the profile. |
| `profile completed` | The member finishes their profile (photos and at least one prompt). This ends setup; only now can they like profiles. | `photo_count`; `prompts_answered` (1-3); `relationship_goal` (see 01-business.md). |

## Discovery

| Event | Meaning | Properties |
|---|---|---|
| `app opened` | The member opens the app. | `open_source` (`organic`, `push_notification`, `widget`). |
| `profile viewed` | The member opens someone's full profile. | `view_source` (`discover`, `likes_you`, `standouts`). |
| `like sent` | The member likes a profile. | `like_type` (`standard` or `spark`; a Spark is a premium like with a note); `liked_content` (`photo`, `prompt`, `voice_prompt`): the part of the profile they liked. |
| `profile passed` | The member passes on a profile. | `view_source` (`discover`, `likes_you`, `standouts`). |
| `selfie verified` | The member completes Verified Profiles (video selfie check). At most one per member; only exists from 2026-07-14. | `verification_method` (`video_selfie`); `attempts` (1-3): tries needed. |
| `profile reported` | The member reports another profile. | `report_reason` (`fake_profile`, `scam`, `harassment`, `inappropriate_photos`, `spam`, `offline_behavior`). |
| `boost activated` | The member boosts their profile in Discover. | `boost_source` (`purchased`, `included_in_plan`); `boost_minutes` (30 or 60). |
| `filters updated` | The member changes a Discover filter. | `filter_changed` (`age_range`, `distance`, `height`, `religion`, `family_plans`, `drinking`). |
| `prompt edited` | The member edits a profile prompt. | `prompt_category` (`about_me`, `my_type`, `getting_personal`, `date_vibes`, `self_care`). |

## Matches, chat, and dates

Every match has a `match_id`. The match, the opener, every later message, the date plan, and the date feedback for one match share the same `match_id`. Not every match gets an opener, and not every conversation leads to a date. A conversation that has been open for four weeks is archived and takes no new messages.

| Event | Meaning | Properties |
|---|---|---|
| `match created` | Two members liked each other. Sent to the member when the match happens: right after their like if the other member had already liked them, otherwise when the other member likes back. | `match_id`; `match_source` (`like` or `spark`): the kind of like the member sent. |
| `conversation started` | The member sends the first message (the opener) in a match. | `match_id`; `hours_since_match`: hours from the match to this opener; `opener_type` (`text`, `prompt_reply`, `voice_note`, or `icebreaker` for an opener picked from Icebreakers suggestions; see 02-timeline.md). |
| `message sent` | The member sends a later message in an open conversation. | `match_id`; `message_type` (`text`, `photo`, `voice_note`, `gif`). |
| `date planned` | The member and their match agree a date with Date Plan. | `match_id`; `venue_type` (`drinks`, `coffee`, `dinner`, `activity`, `video_call`); `days_until_date` (1-7): days from planning to the date itself. |
| `date feedback submitted` | The member rates the date after it happened. Sent the day after the date or later. | `match_id`; `rating` (1-5 stars); `would_meet_again` (true or false). |
| `$experiment_started` | Mixpanel experiment exposure, sent one second before each new match for members in the Icebreakers test (from 2026-07-22). | `Experiment name` = `Icebreakers`; `Variant name` = `Control` or `Icebreakers`. |

## Billing

| Event | Meaning | Properties |
|---|---|---|
| `paywall viewed` | A free member sees the plans paywall. | `paywall_trigger` (`out_of_likes`, `likes_you`, `spark`, `boost`, `profile_tab`). |
| `subscription started` | The member starts a paid plan. At most one per member in the window. Price is **not** tracked here; see `subscription_bookings_daily`. | `plan` (`plus` or `premier`); `billing_period` (`1_month`, `3_month`, `6_month`). |
| `subscription cancelled` | The member cancels their paid plan. The event carries the plan being cancelled in `subscription_plan`; the member's later events carry `free`. At most one per member in the window. | `cancel_reason` (`met_someone`, `too_expensive`, `not_enough_matches`, `taking_a_break`, `bad_experience`). |

## User profile properties

| Property | Meaning |
|---|---|
| `distinct_id` | The member's ID (same as `user_id` on events). |
| `name`, `email`, `avatar` | Contact details. |
| `market` | City (same as on events). |
| `age_band` | `18-24`, `25-29`, `30-34`, `35-39`, `40-49`, `50+`. |
| `gender` | `man`, `woman`, `nonbinary`. |
| `seeking` | Who the member wants to see: `women`, `men`, `everyone`. |
| `relationship_goal` | `long_term`, `long_term_open`, `figuring_it_out`, `short_term_fun`. |
| `photo_count` | Photos on the member's profile (1-9). |
| `subscription_plan` | Current plan: `free`, `plus`, `premier`. |
| `acquisition_channel` | Channel at signup (for established members, the channel they originally came from). |
| `member_since` | Date the member first signed up (YYYY-MM-DD). Before 2026-06-04 for established members. |
| `verified` | `true` if the member has completed Verified Profiles. |
| `Experiment: Icebreakers` | `Control` or `Icebreakers` for members in the test; empty for everyone else. |
| `created` | Signup time for members who joined in the window (the time of their `account created` event); empty for established members. |
| `_persona` | Engagement segment from the CRM's lifecycle model (`serial_swiper`, `intentional_dater`, `casual_browser`). |
| `anonymousIds`, `sessionIds` | Devices and sessions seen for the member (pipeline metadata). |

## Funnels the business tracks

| Funnel | Steps | Notes |
|---|---|---|
| Profile setup | `account created` → `photos uploaded` → `profile completed` | New members only. Read with a 7-day conversion window. |
| Match to date | `match created` → `conversation started` → `date planned` → `date feedback submitted` | Members have many matches; hold `match_id` constant to follow each match on its own. |
| Upgrade | `paywall viewed` → `subscription started` | Free members. |

Likes are not tied to a specific match in the data (`like sent` has no `match_id`). Match rate is a ratio of counts (see 04-metrics-and-tables.md), not a funnel.
