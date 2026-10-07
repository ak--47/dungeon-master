# The Lantern tracking plan (event dictionary)

Event names are lowercase, as tracked. Properties are flat on each event. Times are UTC.

## Properties on every event

| Property | Meaning |
|---|---|
| `time` | When the event happened (UTC). |
| `user_id` | The reader's account ID. Present on every event except a new visitor's anonymous events (`reader_tier = anonymous`). |
| `device_id` | The reader's device (browser or app install). Present on every event. |
| `insert_id` | Unique event ID used for de-duplication. |
| `reader_tier` | The reader's access tier **at the moment of the event**: `anonymous` (no account yet), `registered` (free account), `digital` (Lantern Digital), or `all_access` (Lantern All Access). It changes when a reader registers, subscribes, or cancels. On `subscription started` it is the new plan; on `subscription cancelled` it is the plan being cancelled. |
| `platform` | `web` (any browser, desktop or phone), `ios_app` (iPhone or iPad app), or `android_app`. Fixed per device. |
| `acquisition_channel` | The channel that first brought the reader to The Lantern (see 01-business.md): `organic_search`, `google_ads`, `meta_ads`, `social`, `podcast_ads`, `direct`. Fixed per reader, recorded at the first visit, like an initial UTM source. Also on the profile. |
| `os`, `model`, `screen_height`, `screen_width` | Device details. `os` is `Windows`, `macOS`, `Linux` (and Linux variants), `iOS`, `iPadOS`, or `Android`. |
| `carrier`, `radio` | Mobile network details, on phones and tablets only. |

## Reading

| Event | Meaning | Properties |
|---|---|---|
| `article viewed` | The reader opens an article and the article is shown (not blocked by a wall). | `section` (`politics`, `us_news`, `world`, `business`, `sports`, `climate`, `culture`, `opinion`, `technology`, `investigations`); `article_id`; `content_type` (`news`, `analysis`, `feature`, `explainer`, `live_blog`, `opinion`); `referrer` (see below); `read_time_sec`: seconds the article was in view; `scroll_depth_pct` (5-100): how far down the reader scrolled. |
| `front page viewed` | The reader opens the home page / home screen or a section front. | `page` (`home`, or a section front: `politics`, `sports`, `business`, `world`, `culture`, `climate`). |
| `recommendation clicked` | The reader taps an article in a recommendation module; the article it opens usually follows within seconds. | `module`: `home_feed` (the module on the home page / home screen, which is part of the For You test in the apps), `related` and `more_in_section` (at the end of an article), `most_read`; `position` (1-10): slot in the module. |
| `search performed` | The reader searches the site. | `query_topic` (a section name, `people`, or `archive`); `results_count`. |
| `podcast played` | The reader plays a podcast episode in the apps or on the web player. | `show` (`the_lantern_daily`, `inside_politics`, `the_long_read`); `listen_sec`: seconds listened. |
| `push alert opened` | The reader opens a push alert (apps only). | `alert_type` (`breaking_news`, `daily_briefing`, `live_updates`, `sports`). |
| `newsletter opened` | The reader opens a newsletter email (registered readers only). | `newsletter` (`the_morning_lantern`, `politics_briefing`, `weekend_edition`, `climate_desk`, `sports_extra`, `tech_week`). |
| `newsletter signup` | The reader adds a newsletter to their account. | `newsletter`. |
| `article saved` | The reader saves an article to read later (registered readers only). | `section`. |
| `article shared` | The reader shares an article. | `share_method` (`copy_link`, `email`, `x_twitter`, `facebook`, `whatsapp`, `linkedin`, and from 2026-08-11 `gift_link` for a subscriber's gift article); `section`. |
| `comment posted` | The reader posts a comment (subscribers only). | `section`; `is_reply`: true when it answers another comment. |

### How `referrer` is set on article views

`referrer` says how the reader got to the article. When the reader did something else on The Lantern in the 30 minutes before, it names that step: `newsletter` (right after opening a newsletter), `push` (after a push alert), `site_search` (after a search), `recommendation` (after a recommendation click), `front_page` (from the home page or a section front), or `internal` (a link inside another article). Otherwise the article is an entry from outside: `search_engine`, `social`, or `direct` (no referrer, typed or bookmarked links, links in apps and emails we cannot attribute). A new visitor's first article carries the referrer of the visit that brought them.

The walls (`regwall shown`, `paywall shown`) copy the `section`, `article_id`, and `referrer` of the article the reader tried to open, and a new subscription copies the `referrer` and `section` of the read that led to the paywall where the reader subscribed.

## Accounts, walls, and subscriptions

| Event | Meaning | Properties |
|---|---|---|
| `regwall shown` | An anonymous visitor tried to open a second article and saw the registration wall. | `section`, `referrer`: from the article they tried to open. |
| `account registered` | The visitor creates a free account. Fired once per account; the moment the visitor's device is linked to their `user_id`. | `registration_method` (`email`, `google`, `apple`). |
| `paywall shown` | A registered free reader tried to open an article beyond their allowance (5 in any rolling 30 days) and saw the paywall instead. The article is not shown, so there is no `article viewed` for that attempt. | `section`, `article_id`, `referrer`: from the article they tried to open. |
| `subscription started` | The reader subscribes from the paywall. | `plan` (`digital`, `all_access`); `billing_period` (`monthly`, `annual`); `offer` (`standard` at list price, or `labor_day_sale`); `referrer`, `section`: from the read that led to the paywall. |
| `subscription cancelled` | The subscriber cancels. They become a free reader again from that moment. | `plan`: the plan cancelled; `cancel_reason` (`price`, `not_reading_enough`, `too_many_subscriptions`, `financial`, `other`), chosen by the subscriber. |
| `$experiment_started` | The reader enters an experiment. Fired once per reader, just before their first app event after the test starts. | `Experiment name` (`For You Feed`); `Variant name` (`Control`, `For You`). |

## User profile properties

| Property | Meaning |
|---|---|
| `acquisition_channel` | The channel that first brought the reader (same values as the event property). |
| `region` | `us_northeast`, `us_south`, `us_west`, `us_midwest`, `canada`, `uk`, `other_international`. |
| `age_band` | `18-24`, `25-34`, `35-44`, `45-54`, `55-64`, `65+`. |
| `reader_tier` | The reader's current access tier (end of the window): `registered`, `digital`, or `all_access`. |
| `member_since` | Date the account was created (YYYY-MM-DD). Before 2026-06-04 for readers who registered earlier. |
| `Experiment: For You Feed` | `Control` or `For You` for readers in the For You test; absent for everyone else. |

Profiles also carry the standard `name` and `email` fields. Only accounts have profiles; anonymous visitors do not.

## Funnels the business tracks

- **Registration:** `article viewed` (by an anonymous visitor) → `regwall shown` → `account registered`. The growth team uses a 7-day window.
- **Paywall:** `paywall shown` → `subscription started`. A subscription follows the paywall within minutes; the team reports conversion as subscriptions per paywall view.
- **Home-screen engagement:** `front page viewed` (page = `home`) → `recommendation clicked` (module = `home_feed`) → `article viewed`.
- **Newsletter to article:** `newsletter opened` → `article viewed` (referrer = `newsletter`).
- **Cancellation:** subscribers who fire `subscription cancelled`, by plan and reason.

There are no group analytics keys, no lookup tables, and no slowly changing dimensions in this project.
