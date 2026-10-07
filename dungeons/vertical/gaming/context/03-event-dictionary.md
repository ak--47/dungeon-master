# Emberfall event dictionary

Every event below is tracked in Mixpanel. Property names are exact. All events carry `user_id`; most also carry `device_id` (see the identity notes in `00-manifest.md`).

## Properties on every event

| Property | Meaning |
|---|---|
| `platform` | Platform of the device the player used for this event: `pc` (Windows, macOS, Linux), `ios` (iPhone, iPad), or `android`. A player who plays on two devices shows up under both. |
| `server_region` | The player's home server region: `NA`, `EU`, or `APAC`. Fixed per player. |
| `os`, `model`, `screen_width`, `screen_height`, `carrier`, `radio` | Device details sent by the client. `carrier` and `radio` exist only on phones and tablets. |
| `session_id` | Client session identifier. Mixpanel computes its own sessions from timestamps; use those for session reports. |

## Account and onboarding

| Event | When it fires | Properties |
|---|---|---|
| `account created` | A new player creates their Emberfall account. It is the player's first event and starts their first session. | `signup_method`: `emberfall_id`, `google`, `apple`, `discord`. `acquisition_channel`: `organic`, `tiktok_ads`, `meta_ads`, `google_ads`, `youtube_creators` (how the player found the game). |
| `$experiment_started` | Right after `account created`, for players who joined from 2026-07-08 (the "First Flame Tutorial" test). Once per player. | `Experiment name`: `First Flame Tutorial`. `Variant name`: `Control` or `Guided`. |
| `character created` | The player finishes making their first hero. | `class_name`: the hero's class. `role`: `tank`, `healer`, or `dps`. |
| `tutorial started` | The tutorial begins. It fires again if a player who left the tutorial restarts it on a later visit. | — |
| `tutorial completed` | The player finishes the tutorial. A player who never finishes it cannot queue for dungeons or join the arena. | `tutorial_version`: `classic` or `guided`. `tutorial_minutes`: minutes spent in the tutorial. |

## Sessions

| Event | When it fires | Properties |
|---|---|---|
| `game launched` | The game client starts and the player is in. One per play session (a new player's first session starts with `account created` instead). | `launch_source`: `desktop_launcher` (PC), `app_icon`, or `push_notification` (mobile). `client_version`: game build (`4.0.1`, `4.0.2` from Jul 23, `4.1.0` from Aug 6). |

## Dungeons

A dungeon run's events share one `run_id`. Matchmade runs have all three events; premade and solo runs have no queue event. A run that never opens (for example, an instance that fails to launch) has a queue event only, or no event at all for premade and solo runs.

| Event | When it fires | Properties |
|---|---|---|
| `dungeon queued` | The player joins the group finder queue for a matchmade run. | `run_id`, `dungeon_name`, `difficulty` (`normal`, `heroic`, `mythic`), `role` (the role the player queued as: `tank`, `healer`, `dps`). |
| `dungeon started` | The dungeon instance opens and the party enters. | `run_id`, `dungeon_name`, `difficulty`, `party_size` (1-5), `queue_type` (`matchmade`, `premade`, `solo`), `xp_multiplier` (1 normally; 2 during XP events). |
| `dungeon finished` | The run ends. | `run_id`, `dungeon_name`, `difficulty`, `party_size`, `result` (`cleared`, `wiped`, `abandoned`), `duration_min`, `xp_earned` (XP the player earned, after any multiplier), `xp_multiplier`. |

Dungeons: `Emberdeep Mines`, `Sunken Reliquary`, `Ashen Catacombs`, `Thornwild Hollow`, and from Season 4 `Frostspire Vault`.

## Campaign, arena, and progression

| Event | When it fires | Properties |
|---|---|---|
| `quest completed` | The player turns in a quest. | `quest_type` (`daily`, `side`, `main_story`), `xp_earned`, `gold_earned`. |
| `boss fight` | One attempt at a campaign chapter boss ends. | `boss_name` (`Gravemaw`, `Hollow Matron`, `Ashen Warden`, `Cinder King`), `chapter` (1-4), `result` (`victory`, `defeat`). |
| `arena match` | A ranked arena match ends. | `arena_mode` (`1v1`, `3v3`), `result` (`win`, `loss`), `rating_change` (arena rating points gained, negative after a loss). |
| `level up` | The player's account reaches a new level (cap 60). | `new_level`. |
| `item crafted` | The player crafts a piece of gear. | `item_slot` (`weapon`, `helm`, `chest`, `gloves`, `boots`, `trinket`), `item_rarity` (`common`, `rare`, `epic`, `legendary`). |

## Social

| Event | When it fires | Properties |
|---|---|---|
| `chat message sent` | The player sends a chat message. | `chat_channel` (`party`, `guild`, `world`, `whisper`). |
| `friend added` | The player adds a friend. | `friend_source` (`party`, `guild`, `search`, `contacts`). |
| `guild joined` | The player joins a guild (or switches to a new one). | `guild_id` (e.g. `guild_042`), `guild_size` (members after joining). |

## Store

| Event | When it fires | Properties |
|---|---|---|
| `store opened` | The player opens the in-game store. | `store_tab` (`featured`, `embers`, `cosmetics`, `ember_pass`). |
| `purchase completed` | A real-money purchase succeeds in the client. | `product_type` (`embers`, `bundle`, `ember_pass`), `product` (e.g. `1,200 Embers`, `Adventurer's Bundle`, `Season 4 Ember Pass`), `price_usd` (list price paid), `embers_granted`. |

`purchase completed` is the client's record of a purchase. Billing (warehouse `store_revenue_daily`) is the financial record; see `04-metrics-and-tables.md` for how the two differ.

## User profile properties

| Property | Meaning |
|---|---|
| `server_region` | Home server region (`NA`, `EU`, `APAC`). |
| `acquisition_channel` | How the player found Emberfall (same values as on `account created`; veterans have the channel recorded when they joined). |
| `main_role` | Role of the hero the player plays most: `tank`, `healer`, or `dps`. |
| `main_class` | Class of that hero. |
| `account_level` | Current account level (1-60). |
| `member_since` | Date the account was created. |
| `in_guild` | Whether the player is in a guild now. |
| `total_spend_usd` | Lifetime real-money spend, including purchases before the window. |
| `Experiment: First Flame Tutorial` | `Control` or `Guided` for players in the test; empty for everyone else. |
| `name`, `email`, `avatar`, `created` | Standard profile fields. |

## Funnels the team tracks

- **New-player onboarding:** `account created` → `character created` → `tutorial started` → `tutorial completed`, 7-day conversion window.
- **Dungeon run:** `dungeon queued` → `dungeon started` → `dungeon finished`, hold `run_id` constant, 1-hour window. Time from queue to start is the player's queue wait.
- **Store conversion:** `store opened` → `purchase completed`, same session.
- **Guild:** `account created` → `guild joined`, with the conversion window set to the question.
