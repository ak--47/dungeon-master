# Murmur tracking plan (event dictionary)

Event names are lowercase, as tracked. Properties are flat on each event. Times are UTC.

## Properties on every event

| Property | Meaning |
|---|---|
| `time` | When the event happened (UTC). |
| `user_id` | The member's ID. Present on every event. |
| `device_id` | The member's device. Present on every event except `interests selected` and the `user followed` events from the onboarding suggestions screen, which the onboarding service sends server-side with `user_id` only. |
| `insert_id` | Unique event ID used for de-duplication. |
| `session_id` | The app session the event belongs to (diagnostic; Mixpanel computes its own sessions). |
| `platform` | `ios` (iPhone or iPad) or `android`. Fixed per member (one device each). |
| `os`, `model`, `screen_height`, `screen_width`, `carrier`, `radio` | Device details from the mobile SDK. `os` is `iOS`, `iPadOS`, or `Android`. |

## Signup and onboarding

New members go through onboarding once, right after they sign up.

| Event | Meaning | Properties |
|---|---|---|
| `account created` | The member creates an account. First event of every new member and the moment their device is linked to their `user_id`. | `signup_method` (`apple`, `google`, `phone`); `acquisition_channel`: how the member found us (`organic`, `friend_invite`, `meta_ads`, `tiktok_ads`, `creator_partnerships`), same value as the profile property. |
| `interests selected` | The member picks interests on the second onboarding screen. | `interest_count` (3-8). |
| `user followed` (onboarding) | The member follows an account on the suggested-accounts screen. One event per account followed, seconds apart; a member who skips the screen has none. | `discovery_source = onboarding_suggestions`. |

## Browsing and engagement

| Event | Meaning | Properties |
|---|---|---|
| `app opened` | The member opens the app. | `open_source` (`home_screen`, `link`, `widget`). |
| `post viewed` | A post is shown on screen long enough to count as a view. | `post_type` (`photo`, `text`, `link`, `poll`, `clip`); `feed`: where the post was seen (`for_you`, `following`, `community`, `profile`, `search`); `view_duration_sec`: seconds on screen. |
| `post liked` | The member likes a post. | `post_type` of the post liked. |
| `comment posted` | The member comments on a post. | `comment_length` (characters); `has_mention` (true if the comment @-mentions someone); `community_id` when the comment is in a community. |
| `post shared` | The member shares a post. | `share_destination` (`repost`, `dm`, `external_link`). |
| `story viewed` | The member watches a Story. | `story_type` (`photo`, `video`, `text`); `completed` (true if watched to the end). |
| `search performed` | The member searches. The next `post viewed` from the results has `feed = search`. | `search_type` (`people`, `topics`, `communities`). |
| `user followed` | The member follows an account (outside onboarding). | `discovery_source`: where the member found the account (`for_you` = a post in the For You feed, `search` = search results, `profile` = the account's profile, `suggested_for_you` = a follow-suggestion card; `onboarding_suggestions` for the onboarding screen). |
| `user unfollowed` | The member unfollows an account. | `reason` (`posts_too_often`, `lost_interest`, `offensive`, `other`). |
| `community joined` | The member joins a community. | `join_source` (`search`, `for_you`, `invite`); `community_id`. |
| `content reported` | The member reports a post, comment, or account. | `report_reason` (`spam`, `harassment`, `misinformation`, `nudity`, `hate_speech`, `other`). |
| `profile updated` | The member edits their profile. | `field_updated` (`bio`, `avatar`, `display_name`, `privacy`, `links`). |

## Creating

| Event | Meaning | Properties |
|---|---|---|
| `post created` | The member publishes a post. | `post_type` (`photo`, `text`, `link`, `poll`, `clip` from 2026-07-08); `has_media` (true for photos and Clips); `character_count`; `hashtag_count`; `community_id` when posted to a community (about a third of posts). |
| `story posted` | The member posts a Story. | `story_type` (`photo`, `video`, `text`). |
| `dm sent` | The member sends a direct message. | `message_type` (`text`, `photo`, `post_share`, `voice`). |

## Notifications

| Event | Meaning | Properties |
|---|---|---|
| `push notification sent` | The notification service sends a push to the member's phone. **Server-side**: it is sent whether or not the member is using the app, and it is not member activity. | `notification_id`; `notification_type` (`like`, `comment`, `new_follower`, `mention`, `dm`, `trending`, and `daily_digest` for the Smart Digest summary push, see 02-timeline.md). |
| `push notification opened` | The member taps a push and the app opens. At most one per push. | `notification_id` (same as on the send); `notification_type` (same as on the send). |
| `$experiment_started` | Mixpanel experiment exposure, sent once per member when the notification system first assigns them: at the first push they qualify for after 2026-08-05 (in the Digest arm that push can be held back, so a few Digest members have an exposure and no push after it). **Server-side**, not member activity. | `Experiment name` = `Smart Digest`; `Variant name` = `Control` or `Digest`. |

## Ads

| Event | Meaning | Properties |
|---|---|---|
| `ad viewed` | An ad is shown. | `ad_placement`: where the ad slot was (`feed` between posts, `stories` between Stories, `clips` between Clips); `ad_category` (`retail`, `entertainment`, `food`, `tech`, `finance`, `travel`). |
| `ad clicked` | The member taps an ad, seconds after seeing it. | `ad_placement`, `ad_category` (same as the impression). |

Prices and revenue are **not** tracked in Mixpanel; see `ad_revenue_daily` in 04-metrics-and-tables.md.

## Circles

| Event | Meaning | Properties |
|---|---|---|
| `circle paywall viewed` | A fan sees a creator's Circle paywall. | `paywall_trigger`: what opened it (`locked_post` = tapped a subscriber-only post in a feed; `profile_button` = tapped Join on the creator's profile). |
| `circle subscription started` | The fan subscribes to a creator's Circle (first month). Renewals and payments are not tracked. | `paywall_trigger` of the paywall that led to it; `circle_tier` (`supporter`, `insider`, `vip`; prices in 01-business.md). |

## User profile properties

| Property | Meaning |
|---|---|
| `distinct_id` | The member's ID (same as `user_id` on events). |
| `name`, `email`, `avatar` | Contact details. |
| `account_type` | `personal`, `creator`, or `business`. |
| `circle_enabled` | `true` for creators who run a paid Circle; `false` for everyone else. |
| `acquisition_channel` | Channel at signup (for established members, the channel they originally came from). |
| `joined_date` | Date the member signed up (YYYY-MM-DD). Before 2026-06-04 for established members. |
| `age_band` | `18-24`, `25-34`, `35-44`, `45-54`, `55+`. |
| `country` | `US`, `GB`, `CA`, `BR`, `IN`, `DE`, `AU`. |
| `follower_count`, `following_count` | Followers and accounts followed at the last profile sync. |
| `Experiment: Smart Digest` | `Control` or `Digest` for members in the test; empty for everyone else. |
| `created` | Signup time for members who joined in the window; empty for established members. |
| `anonymousIds`, `sessionIds` | Devices and sessions seen for the member (pipeline metadata). |

## Group profile: `community_id`

One row per community (240). Events that happen in a community carry its `community_id` (`post created` and `comment posted` when in a community, and `community joined`).

| Property | Meaning |
|---|---|
| `community_id` | Community ID ("1" to "240"). |
| `community_name` | Display name. |
| `topic` | `music`, `gaming`, `sports`, `food`, `fashion`, `tech`, `film_tv`, `fitness`, `travel`, `comedy`, `books`, `art`. |
| `is_moderated` | `true` if the community has volunteer moderators. |
| `created_year` | Year the community was created. |

## Funnels the business tracks

| Funnel | Steps | Notes |
|---|---|---|
| Onboarding | `account created` → `interests selected` → `user followed` (`discovery_source = onboarding_suggestions`) | New members only. Read with a 1-day conversion window. |
| First post | `account created` → `post created` | New members only. Read with a 7-day conversion window. |
| Push | `push notification sent` → `push notification opened` | Hold `notification_id` constant (Totals counting) to follow each push. |
| Circle join | `circle paywall viewed` → `circle subscription started` | Use a 1-hour window, or compare counts by `paywall_trigger` (the subscription carries the trigger that led to it). |
