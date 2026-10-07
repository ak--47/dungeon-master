# Cinderlight Games and Emberfall

## The company

Cinderlight Games is an independent game studio of nine people in Portland, Oregon. Emberfall is its only game. It launched on PC in March 2024 and on iOS and Android in April 2025. A publishing advance funds the studio; Emberfall's revenue covers part of the costs, and the plan for the next year is to grow revenue and hold marketing costs so the game pays for itself.

## The game

Emberfall is a free-to-play fantasy action RPG. A new player creates an account, makes a hero, and plays a short tutorial. After that, the main activities are:

- **Dungeons.** Five-player instanced runs, the heart of the game. A run is either **matchmade** (the player joins the queue and the group finder builds a balanced party of five: one tank, one healer, three damage dealers), **premade** (friends or guildmates form a party of two to five and enter together, no queue), or **solo** (one player enters alone). Each run ends with the party clearing the dungeon, wiping (everyone dies), or abandoning it. Dungeons come in three difficulties: normal, heroic, and mythic. Before Season 4 there were four dungeons (Emberdeep Mines, Sunken Reliquary, Ashen Catacombs, Thornwild Hollow).
- **Story campaign.** Quests and four chapters, each ending in a boss fight: Gravemaw (chapter 1), the Hollow Matron (chapter 2), the Ashen Warden (chapter 3), and the Cinder King (chapter 4). Players can attempt a boss as often as they like.
- **Arena.** Ranked 1v1 and 3v3 player-versus-player matches.
- **Crafting, quests, chat, friends, and guilds.** Guilds are player-run groups of up to about 50 members with their own chat. A player belongs to at most one guild at a time.

Every hero has a **role**: tank (absorbs damage), healer, or damage dealer ("dps"). Each role has its own classes: Bulwark and Ironclad (tank), Lightweaver and Grovekeeper (healer), Pyromancer, Ranger, Shadowblade, and Stormcaller (damage). A player's main role is the role of the hero they play most.

Players choose a home server region (NA, EU, or APAC) at signup. Each region has its own game and dungeon-instance servers.

## Platforms

- **PC:** Windows, macOS, and Linux, through the Emberfall launcher. In-game purchases on PC go through Cinderlight's own webshop and its payment processor.
- **Mobile:** iPhone and iPad (App Store) and Android (Google Play). In-game purchases use the store's billing, and the store keeps a commission.

One account works on every device; progress and purchases carry over.

## How Emberfall makes money

Emberfall is free to play. Revenue comes from three products:

| Product | `product_type` | Price (USD) | What it gives |
|---|---|---|---|
| Ember packs | `embers` | $0.99 (100 Embers), $4.99 (550), $9.99 (1,200), $19.99 (2,500), $49.99 (6,500), $99.99 (14,000) | Embers, the premium currency, spent on cosmetics, mounts, and convenience items |
| Adventurer's Bundle | `bundle` | $14.99 | 1,500 Embers plus a crafting kit; can be bought repeatedly |
| Ember Pass | `ember_pass` | $9.99 per season | The season's reward track (cosmetics and Embers as players level the pass) |

Seasons last about three months. Season 3 ("Ashen Tide") started on May 14, 2026; Season 4 ("Frostbound") started on August 6, 2026. Each season has its own Ember Pass. Prices did not change during the window.

Finance reports **gross bookings** (what players paid), **refunds**, **store fees** (the app store commission or the PC payment processor fee), and **net revenue** (gross minus refunds and fees). Those numbers come from billing systems and live in the warehouse table `store_revenue_daily`, not in Mixpanel.

## How players find Emberfall

Each new player's acquisition channel is recorded at signup (`acquisition_channel`):

- `organic` — store search, word of mouth, press, and community.
- `tiktok_ads` — paid TikTok campaigns.
- `meta_ads` — paid Facebook and Instagram campaigns.
- `google_ads` — paid Google campaigns (YouTube ads, search, and Play Store placements).
- `youtube_creators` — paid sponsorships with YouTube and Twitch creators who play Emberfall on stream.

Paid campaigns are optimized for installs. Daily spend by channel comes from the networks' billing exports (`ua_spend_daily`).

## Players the team talks about

- **New players vs veterans.** New players created their account in the window. Veterans joined before June 4; some play every week, and some drift away between seasons.
- **Core, regular, and casual players.** Core players log in most days and run heroic and mythic dungeons; regular players play a few times a week; casual players drop in now and then, often on weekends. Most revenue comes from a small share of players.
- **Payers.** A minority of players ever buy anything; the team tracks payers separately from everyone else.
- **Roles and regions.** Most players main a damage role. North America is the largest region, then Europe, then Asia-Pacific.

## Goals for the period (Q3 2026)

1. **Onboarding.** Raise the share of new players who finish the tutorial. The "First Flame" guided tutorial test (see the timeline) is the main bet.
2. **New-player retention.** Keep more new players past their second week. The community team believes guilds are what keep players around and wants to know whether that holds up in the data.
3. **Season 4.** Bring lapsed veterans back and sell the new Ember Pass.
4. **Marketing efficiency.** Hold paid acquisition cost per new player. Marketing is debating how to split the budget across TikTok, Meta, Google, and creator sponsorships.
5. **Reliability.** Keep every region's servers healthy through the season launch and live events.
6. **Revenue.** Grow net revenue across PC and mobile.
