# Hearthside tracking plan (event dictionary)

Event names are lowercase, as tracked. Properties are flat on each event. Times are UTC.

## Properties on events

| Property | Meaning |
|---|---|
| `time` | When the event happened (UTC). |
| `user_id` | The member's ID. Present on every event. |
| `device_id` | The device the event came from. A member has about two devices. Present on every event except `interests selected` and `intro posted`, which are sent server-side with `user_id` only. |
| `insert_id` | Unique event ID used for de-duplication. |
| `session_id` | The app session the event belongs to (diagnostic; Mixpanel computes its own sessions). |
| `membership` | The member's membership **at the moment of the event**: `free` or `plus`. It changes from `free` to `plus` at the moment a member subscribes. |
| `content_hub` | The hub the event happened in (`gaming`, `anime`, `movies_tv`, `books`, `tabletop`, `music`). On events that happen inside a community. |
| `community_id` | The community the event happened in (Mixpanel group key, `1` to `48`). Always a community in the event's `content_hub`. See "Community (group) properties". |
| `country`, `country_code`, `region`, `city` | Member location (one location per member). |
| `os`, `model`, `browser`, `screen_height`, `screen_width`, `carrier`, `radio` | Device details from the SDK. Fixed per device. |

## Signup and onboarding

New members go through onboarding once, right after signup. These three events happen only during onboarding.

| Event | Meaning | Properties |
|---|---|---|
| `account created` | The member creates an account. First event of every new member and the moment their device is linked to their `user_id`. | `signup_method` (`google`, `apple`, `email`, `discord`); `acquisition_channel`: how the member found us (`organic`, `friend_invite`, `app_store`, `reddit_ads`, `tiktok_ads`, `youtube_creators`), same value as the profile property. |
| `interests selected` | The member picks the hubs they care about. | `hubs_selected` (1-6). |
| `intro posted` | The member posts an introduction in their home community's welcome thread. This ends onboarding. | `content_hub` (the member's home hub); `community_id`; `word_count`. |

## Reading and search

| Event | Meaning | Properties |
|---|---|---|
| `article viewed` | The member opens a wiki article. | `content_hub`; `community_id`; `wiki_id`: the page (`wk_<hub code>_<number>`; low numbers are long-standing pages); `article_type` (`character`, `walkthrough`, `episode_guide`, `lore`, `location`, `review`, `news`); `time_on_page_sec`. |
| `search performed` | The member searches the wikis. | `content_hub` (the hub searched); `search_term` (the search category, e.g. `walkthrough`, `tier list`, `ending explained`); `results_count`. |

## Discussion

Threads are shared: many members view and reply to the same thread. A member's view of a thread and their reply to it carry the same `thread_id`.

| Event | Meaning | Properties |
|---|---|---|
| `discussion viewed` | The member opens a discussion thread. | `thread_id`; `content_hub`; `community_id`; `reply_count`: replies on the thread when it was opened. |
| `comment posted` | The member replies in a thread. | `thread_id`; `content_hub`; `community_id`; `comment_length` (characters); `is_reply` (`true` when it answers another comment, `false` when it answers the thread). |
| `discussion posted` | The member starts a new thread. | `thread_id` (a new thread); `content_hub`; `community_id`; `topic_type` (`theory`, `question`, `news`, `review`, `recommendation`, `debate`). |
| `upvote given` | The member upvotes something. | `content_hub`; `community_id`; `content_type` (`article`, `discussion`, `comment`). |
| `$experiment_started` | Mixpanel experiment exposure, sent once per member at their first thread view while the Reply Nudges test is live (from 2026-07-08). | `Experiment name` = `Reply Nudges`; `Variant name` = `Control` or `Nudges On`. |

## Contribution

| Event | Meaning | Properties |
|---|---|---|
| `article edited` | The member saves an edit to a wiki article. | `content_hub`; `community_id`; `wiki_id`; `edit_type` (`content`, `formatting`, `citation`, `grammar`, `image`); `chars_changed`. |
| `article published` | The member publishes a new wiki article. | `content_hub`; `community_id`; `wiki_id` (a new page); `category`; `word_count`. |
| `media uploaded` | The member uploads media to a community. | `content_hub`; `community_id`; `media_type` (`fan_art`, `screenshot`, `gif`, `video_clip`); `file_size_kb`. |

## Social

| Event | Meaning | Properties |
|---|---|---|
| `community joined` | The member joins a community. | `content_hub`; `community_id`; `join_source` (`recommendation`, `search`, `browse`, `invite`). |
| `user followed` | The member follows another member. | `follow_source` (`profile`, `article`, `discussion`, `recommendation`). |
| `notification received` | Hearthside sends the member a notification (server-side; not a member action). Sent whether or not the member is still active. | `notification_type`: `reply` (someone replied to the member's post), `mention`, `upvote_digest`, `new_follower`, `weekly_digest`, `community_update`, `edit_reverted` (a moderator reverted one of the member's wiki edits); `channel` (`push`, `email`, `in_app`); `opened` (whether the member opened it). |

## Trust and safety

Every report has a `report_id`. The report and its resolution share the same `report_id`, `report_type`, `content_hub`, and `community_id`. A small share of reports never get a `report resolved`: duplicates and reports on content that is already gone are closed without a notice. Reports filed in the last days of the window may still be open.

| Event | Meaning | Properties |
|---|---|---|
| `report submitted` | The member reports content. | `report_id`; `report_type` (`spam`, `harassment`, `vandalism`, `misinformation`, `copyright`, `other`); `content_hub`; `community_id`. |
| `report resolved` | A moderator closes the member's report; Hearthside notifies the reporter (server-side; attributed to the reporter). Reports filed in the last days before June 4 can resolve inside the window, so some resolutions early in June have no report event in the data. | `report_id`; `report_type`; `content_hub`; `community_id`; `outcome` (`content_removed`, `user_warned`, `no_violation`); `resolution_hours`: hours from the report to this resolution. |
| `moderation action` | A volunteer moderator acts on content or a member. Moderators only. | `content_hub`; `community_id`; `action_type` (`remove_post`, `warn_member`, `lock_thread`, `mute_member`, `approve_post`, `ban_member`); `severity` (`low`, `medium`, `high`). |

## Plus

| Event | Meaning | Properties |
|---|---|---|
| `plus page viewed` | A free member opens the Plus page. | `upgrade_trigger`: what brought them there (`ad_free`, `custom_flair`, `profile_badges`, `larger_uploads`). |
| `plus subscribed` | The member buys Plus. At most one per member. Price is not tracked here (see 01-business.md). | `plan` (`plus_monthly`, `plus_annual`). |

## Member profile properties

| Property | Meaning |
|---|---|
| `distinct_id` | The member's ID (same as `user_id` on events). |
| `name`, `email`, `avatar` | Contact details. |
| `role` | `lurker`, `reader`, `contributor`, `creator`, `moderator` (see 01-business.md). |
| `home_hub` | The hub where the member spends most of their time. |
| `membership` | Current membership: `free` or `plus`. |
| `member_since` | Date the member joined (YYYY-MM-DD). Before 2026-06-04 for established members. |
| `acquisition_channel` | Channel at signup (for established members, the channel they originally came from). |
| `karma` | Lifetime reputation score. |
| `Experiment: Reply Nudges` | `Control` or `Nudges On` for members enrolled in the thread test; empty for everyone else. |
| `created` | Signup time for members who joined in the window (the time of their `account created` event); empty for established members. |
| `country`, `country_code`, `region`, `city` | Location. |
| `anonymousIds` | Device IDs seen for the member (pipeline metadata). |
| `sessionIds` | Unused pipeline field; always empty. |

## Community (group) properties — `community_id`

| Property | Meaning |
|---|---|
| `community_id` | Group key, `1` to `48`. |
| `name` | Community name (e.g. "Dice Tavern Circle"). |
| `content_hub` | The community's hub. |
| `member_count` | Members who have joined the community (all time). |
| `founded_year` | Year the community opened on Hearthside. |
| `is_official` | Whether the community is run with the blessing of the rights holder. |

## Funnels the business tracks

| Funnel | Steps | Notes |
|---|---|---|
| Onboarding | `account created` → `interests selected` → `intro posted` | New members only. Read with a 7-day conversion window. |
| Thread reply | `discussion viewed` → `comment posted` | Members open many threads; hold `thread_id` constant to measure each thread view on its own. Read with a 1-day window. |
| Report handling | `report submitted` → `report resolved` | Hold `report_id` constant. Time to convert is the resolution time. Read with a 30-day conversion window; some reports take several days to resolve. |
| Upgrade to Plus | `plus page viewed` → `plus subscribed` | Free members. Read with a 1-day window. |
