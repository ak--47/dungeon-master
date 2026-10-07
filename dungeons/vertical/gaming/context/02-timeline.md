# Emberfall timeline: June 4 to October 1, 2026

All dates are UTC. This page lists what happened and when. It does not record outcomes; measure those in the data.

| Date | Type | What happened |
|---|---|---|
| 2026-05-14 (Thu) | Season | Season 3 "Ashen Tide" starts (before the window). The Season 3 Ember Pass is on sale until Season 4 starts. |
| 2026-06-04 (Thu) | — | Start of the analysis window. Game client version 4.0.1. |
| 2026-06-22 (Mon) | Org | A new Head of Live Operations joins and takes over season planning and live events. |
| 2026-07-01 (Wed) | Fiscal | Q3 starts. |
| 2026-07-03 (Fri) to 2026-07-04 (Sat) | Holiday | US Independence Day (observed Friday). No in-game event. |
| 2026-07-08 (Wed) | Experiment | **"First Flame Tutorial" test** starts. Every player who creates an account from this date is assigned 50/50 to **Control** (the classic tutorial) or **Guided** (a shorter tutorial with a guide character who walks the player through their first quest and first dungeon). Assignment happens at account creation, is permanent, and is recorded with a `$experiment_started` event right after `account created` and the profile property `Experiment: First Flame Tutorial`. A tutorial finished in the Guided version has `tutorial_version = guided` on `tutorial completed`. Players who joined before July 8 are not in the test. |
| 2026-07-23 (Thu) | Patch | **Patch 4.0.2** (client 4.0.2). The patch notes list: a rebalance of the **Ashen Warden**, the chapter 3 boss (the community had called it a wall for months), an update to dungeon loot tables, and bug fixes. No other boss was changed. |
| 2026-08-06 (Thu) | Season | **Season 4 "Frostbound"** launches with client 4.1.0: a new Season 4 Ember Pass ($9.99), a new dungeon, **Frostspire Vault** (all three difficulties), and new cosmetics. The marketing team emailed veterans who had not played recently about the new season (marketing email is sent from the email platform and is not tracked in Mixpanel). |
| 2026-08-21 (Fri) to 2026-08-23 (Sun) | Live event | **Double XP weekend.** All XP from dungeon runs is doubled from 00:00 UTC Friday to 23:59 UTC Sunday. Dungeon events in the window carry `xp_multiplier = 2`. The event was announced in game and on social media the week before. |
| 2026-08-26 (Wed) to 2026-08-30 (Sun) | Industry | gamescom in Cologne. Cinderlight showed a teaser for a 2027 expansion. No in-game change. |
| 2026-09-07 (Mon) | Holiday | US Labor Day. No in-game event. |
| 2026-09-12 (Sat) to 2026-09-14 (Mon) | Incident | **EU instance-server incident.** A storage fault at the EU hosting provider made many dungeon instances fail to launch for EU players: the group finder formed parties, but the instance never opened. The fix was live at 00:00 UTC on September 15. The ops team's daily health numbers by region are in `server_health_daily`. |
| 2026-09-30 (Wed) | Fiscal | End of Q3. |
| 2026-10-01 (Thu) | — | End of the analysis window (data runs through 23:59 UTC). Q4 starts. |

## Things that did not change in the window

- No price changes to Ember packs, the Adventurer's Bundle, or the Ember Pass.
- No change to matchmaking rules or party composition (one tank, one healer, three damage dealers).
- No new regions, platforms, or payment methods.
- Paid marketing budgets were steady by channel through the window; no channel was added or paused.
- Cinderlight ran no holiday events. In past years, public holidays have not changed player activity in a way the team could see.
- NA and APAC had no server incidents in the window.

## Open questions leadership has asked

- Should the Guided tutorial ship to every new player?
- Did the Ashen Warden rebalance work, and did patch 4.0.2 change anything else?
- Do guilds really keep new players around?
- Which paid channel deserves more budget?
- Did Season 4 bring players back, and how did the new Ember Pass sell?
- Was the Double XP weekend worth running again?
- What happened to EU dungeon activity in mid-September, and how big was it?
- Players complain about dungeon queue times. Who waits, and how long?
- Which platform makes Cinderlight the most money once store fees are paid?
