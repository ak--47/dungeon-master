# Reelhouse tracking plan (event dictionary)

Event names are lowercase, as tracked. Properties are flat on each event. Times are UTC.

## Properties on every event

| Property | Meaning |
|---|---|
| `time` | When the event happened (UTC). |
| `user_id` | The household's account ID. Present on every event. |
| `device_id` | The screen the event came from. Present on events sent by an app or browser. Absent on `plan selected` and `trial started` (billing service, during signup) and on `trial converted` and `subscription renewed` (server-side billing). |
| `insert_id` | Unique event ID used for de-duplication. |
| `session_id` | The app session the event belongs to (diagnostic; Mixpanel computes its own sessions). |
| `plan` | The household's plan **at the moment of the event**: `basic_ads`, `standard`, `premium`, or `none`. It is `none` on `account created` (no plan chosen yet) and after a household's access ends (trial ended without converting, or subscription ended). On `subscription cancelled` it is the plan being cancelled; on `plan changed` it is the plan before the change. |
| `platform` | `tv` (smart TV or streaming box), `mobile` (phone), `tablet`, or `web` (browser), from the device. `server` on server-side billing events. Fixed per `device_id`. |
| `device_family` | The kind of device: `Roku`, `Fire TV`, `Samsung TV`, `LG TV`, `Apple TV`, `Google TV` (tv); `iPhone`, `Android phone` (mobile); `iPad`, `Android tablet`, `Fire tablet` (tablet); `Chrome`, `Safari`, `Edge`, `Firefox` (web); `server` on server-side billing events. Fixed per `device_id`. |

## Title properties

Events that involve a title carry its attributes so viewing can be broken down without a lookup table.

| Property | Meaning |
|---|---|
| `title_id` | Catalog ID, for example `rh_s01`. |
| `title_name` | Title, for example `Saltmarsh`. |
| `content_type` | `series` or `movie`. |
| `genre` | `drama`, `comedy`, `thriller`, `crime`, `sci-fi`, `mystery`, `documentary`, `reality`, `western`, `horror`, `romance`, `action`, or `kids`. |
| `is_original` | `true` for Reelhouse Originals, `false` for licensed titles. |
| `maturity_rating` | TV or film rating, for example `TV-MA`, `TV-14`, `PG-13`, `TV-Y`. |
| `season_number`, `episode_number` | On playback events for series. Empty (null) for films. |

`title details viewed`, `trailer played`, `watchlist added`, `playback started`, and `playback completed` carry all title properties. `playback error`, `rating submitted`, and `download started` carry `title_id` and `title_name` (`download started` also `content_type`). `ad break completed` carries `title_id`.

## Signup and trial

| Event | Meaning | Properties |
|---|---|---|
| `account created` | A household creates an account. First event of every new household and the moment its device is linked to its `user_id`. | `signup_method` (`email`, `apple`, `google`); `acquisition_channel`: how the household found us (`organic`, `referral`, `paid_social`, `paid_search`, `ctv`), same value as the profile property. |
| `plan selected` | The household picks a plan on the plans page during signup. Recorded by the billing service (no `device_id`). | `plan` (`basic_ads`, `standard`, `premium`). |
| `trial started` | The household adds a payment method and starts its 7-day free trial. Recorded by the billing service (no `device_id`). Some households pick a plan but never start the trial; they leave without watching. | `plan`; `trial_days` (always 7); `payment_method` (`credit_card`, `paypal`, `apple_pay`, `gift_card`). |
| `profile created` | The household adds a viewer profile. The account owner's profile exists from signup and is not tracked, so a household with N profiles has N - 1 of these events (only households that joined in the window). | `profile_type` (`adult`, `kids`). |
| `$experiment_started` | The household was assigned to an experiment arm (see 02-timeline.md). Sent a few seconds after `trial started` for households that created their account on or after 2026-07-08. | `Experiment name` (`Smart Start`); `Variant name` (`Control`, `Smart Start`). |

## Subscription and billing

| Event | Meaning | Properties |
|---|---|---|
| `trial converted` | The trial ended and the first monthly charge succeeded: the household is now a paying subscriber. Server-side, exactly 7 days after `trial started`. | `plan`. |
| `subscription renewed` | A monthly renewal charge succeeded (every 30 days after the first charge). Server-side. | `plan`. |
| `subscription cancelled` | The household cancels in account settings. Access continues to the end of the current period: the end of the trial, or the next renewal date (a paid subscriber's cancellation lands a few hours to six days before that renewal date). A renewal is never charged after a cancellation. | `plan` (the plan being cancelled); `during_trial` (`true` when cancelled during the free trial); `cancel_reason` (`too_expensive`, `not_enough_to_watch`, `taking_a_break`, `switching_service`, `just_trying_it`, `technical_issues`, `other`). |
| `plan changed` | A paying household switches plan. The change applies at once and the next renewal charges the new plan. | `from_plan`; `to_plan`. |

## Browsing and discovery

| Event | Meaning | Properties |
|---|---|---|
| `app opened` | A viewer opens the Reelhouse app or site. | `launch_source` (`home_screen`, `deep_link`, `widget`). |
| `browse` | The viewer scrolls the home screen. | `row_name` (`continue_watching`, `top_10`, `new_releases`, `because_you_watched`, `reelhouse_originals`, `trending_now`): the row they stopped on; `rows_scrolled`. |
| `search performed` | The viewer runs a search. | `search_id`: ID of this search; `query_length` (characters); `results_count`. |
| `title details viewed` | The viewer opens a title page. | Title properties; `search_id` when the page was opened from a search result (null otherwise). |
| `trailer played` | The viewer plays a trailer. | Title properties. |
| `watchlist added` | The viewer adds a title to My List. | Title properties. |

## Watching

| Event | Meaning | Properties |
|---|---|---|
| `playback started` | A play begins (an episode or a film). | Title properties; `source`: how the play started (`home_row`: from a title page reached from the home screen; `search`: from a search result; `continue_watching`: resumed or picked from Continue Watching; `autoplay`: the next episode started automatically after the previous one finished; `push_notification`: from a push); `profile_type` (`adult`, `kids`): the viewer profile watching; `search_id`: the search that led to the play (null if not from search). |
| `playback completed` | The viewer reached the end of the episode or film (end credits). | Title properties; `watch_minutes`: minutes watched; `profile_type`. |
| `playback error` | A play failed: the stream could not start or stopped with an error. A play with an error does not complete. One or two per failed play. | `title_id`; `title_name`; `error_code` (`segment_timeout`, `manifest_unavailable`, `drm_license_error`, `network_lost`, `decoder_error`); `seconds_into_playback`. |
| `ad break completed` | An ad break finished during a Basic with Ads play: a pre-roll at the start of every play and a mid-roll about every 20 minutes. | `title_id`; `ad_position` (`pre_roll`, `mid_roll`); `ad_seconds`. |
| `rating submitted` | The viewer rates a title right after finishing it. | `title_id`; `title_name`; `rating` (`thumbs_up`, `thumbs_down`, `love_this`). |
| `download started` | The viewer downloads a title to a phone or tablet. | `title_id`; `title_name`; `content_type`; `download_quality` (`standard`, `high`). |

## Messaging

| Event | Meaning | Properties |
|---|---|---|
| `notification received` | A push notification was delivered to the household's phone or tablet. Sent by the CRM system, also to households whose subscription has ended. | `campaign_type` (`new_episode`, `because_you_watched`, `trending_now`, `win_back`, `new_season`; see 01-business.md); `title_name`: the title the push is about. |
| `notification opened` | The viewer tapped the push and the app opened. | `campaign_type`; `minutes_to_open`: minutes from delivery to the tap. |

## User profile properties

| Property | Meaning |
|---|---|
| `plan` | The household's current plan, or its last plan if its subscription has ended. Households that never started a trial have the plan they picked, or `none` if they left before picking one. |
| `subscription_status` | `active` (paying or in trial on October 1), `cancelled` (access ended in the window), or `never_subscribed` (created an account but never started a trial). |
| `acquisition_channel` | How the household found Reelhouse (see 01-business.md). |
| `profile_count` | Number of viewer profiles on the account (1-5). |
| `has_kids_profile` | Whether the account has a kids profile. |
| `country` | `US` or `CA`. |
| `member_since` | Date the account was created (YYYY-MM-DD). |
| `Experiment: Smart Start` | The household's arm in the Smart Start test (`Control` or `Smart Start`). Only households that created their account on or after 2026-07-08 and started a trial have it. |
| `_persona` | Engagement segment from the CRM's lifecycle model (`binge_watcher`, `regular_viewer`, `light_viewer`). |

## Funnels the business tracks

| Funnel | Steps | Notes |
|---|---|---|
| Signup | `account created` → `plan selected` → `trial started` | Same session, a few minutes end to end. |
| Trial conversion | `trial started` → `trial converted` | Use an 8-day conversion window (a trial converts at day 7). Only trials that started at least 8 days before the end of the data have a complete window. |
| Watch | `app opened` → `browse` → `title details viewed` → `playback started` → `playback completed` | Completion depends on the length of the title. |
| Search | `search performed` → `title details viewed` → `playback started` | Hold `search_id` constant to keep each search's own path. |
| Discovery | `browse` → `trailer played` → `watchlist added` | |
| Push | `notification received` → `notification opened` → `playback started` | Plays from a push have `source` = `push_notification`. |
