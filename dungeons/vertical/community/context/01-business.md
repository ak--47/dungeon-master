# Hearthside: the business

## Who we are

Hearthside is a fan community platform: a home for people who love a game, a show, a book series, a tabletop system, or a band to read and write wikis together and talk about them. The company is a seed-stage startup of eleven people (product, engineering, a two-person community team, one trust and safety lead, and one growth marketer). Most moderation is done by volunteer moderators from the communities themselves.

## Hubs and communities

Hearthside groups its 48 communities into six hubs, eight communities each:

| Hub (`content_hub`) | What it covers |
|---|---|
| `gaming` | Video games: walkthroughs, builds, lore. The largest hub. |
| `anime` | Anime and manga series. |
| `movies_tv` | Films and TV series. |
| `books` | Novels, series fiction, poetry. |
| `tabletop` | Board games, card games, tabletop role-playing. |
| `music` | Artists, genres, scores and soundtracks. |

Each community has its own wiki, its own discussion threads, and its own volunteer moderators. Some communities are "official" (run with the blessing of the game studio, author, or publisher). Members have a home hub (where they spend most of their time) but read and post across hubs.

## What members do

- **Join.** A new member creates an account, picks the hubs they are interested in, and posts a short introduction in their home community's welcome thread. The community team calls this the onboarding flow.
- **Read.** Members read wiki articles (character pages, walkthroughs, episode guides, lore) and search the wikis. Reading is by far the most common activity.
- **Discuss.** Members open discussion threads and reply in them, start new threads, and upvote articles, threads, and comments.
- **Contribute.** Members edit wiki articles, publish new articles, and upload fan art, screenshots, GIFs, and clips. Volunteer moderators can revert an edit that breaks the community's rules or style.
- **Keep it safe.** Members report spam, harassment, vandalism, misinformation, and copyright problems. A moderator reviews each report. Most reports end with a resolution, and the reporter gets a notification with the outcome. A small share are closed without a resolution notice (duplicates of an earlier report, or content that is already gone).
- **Upgrade.** Free members can view the Plus page and subscribe.

## Member roles

The community team describes members by role (`role` on the profile). The role comes from the member's history on the platform and is updated by a nightly job.

| Role | Meaning |
|---|---|
| `lurker` | Reads occasionally, almost never posts. |
| `reader` | Reads regularly, posts now and then. |
| `contributor` | Posts, comments, and edits regularly. |
| `creator` | Writes and maintains a lot of wiki content. |
| `moderator` | Volunteer moderator for one or more communities. Only moderators can take moderation actions. |

`karma` on the profile is the member's lifetime reputation score from upvotes on their contributions.

## How Hearthside makes money

- **Ads.** Pages shown to free members and to logged-out readers carry display ads, sold by hub (advertisers buy audiences such as "gaming" or "movies & TV"). Most ad page views come from logged-out readers who arrive from search engines and never sign in; they are not in Mixpanel. Ad impressions and revenue are in the warehouse table `ad_revenue_daily`.
- **Hearthside Plus.** $4.99 per month or $49.99 per year. Plus members see no ads and get custom flair, profile badges, and larger uploads. Plus is bought through the Plus page (`plus page viewed` → `plus subscribed`). There was no price change in the window.

## How new members find us

New members arrive through one of six acquisition channels, recorded at signup (`acquisition_channel`):

- **organic** — search engines, word of mouth.
- **friend_invite** — an invite link from an existing member.
- **app_store** — found the mobile app in an app store.
- **reddit_ads** — promoted posts in fandom subreddits.
- **tiktok_ads** — short-video ads.
- **youtube_creators** — sponsored segments with fandom YouTube creators.

The three paid channels bill daily. Spend by paid channel is in the warehouse table `paid_marketing_daily`.

## Goals for the period (June to September 2026)

1. **Grow active membership.** More weekly active members, and more of them taking part (replying, posting, contributing) rather than only reading.
2. **Turn signups into members.** Too many new accounts never finish onboarding or stop showing up soon after joining. The community team wants to know what separates the newcomers who stay from the ones who leave.
3. **Spend acquisition money well.** Growth spreads its budget across three paid channels. Finance asked what a signup costs on each channel, and what a signup that actually becomes a member costs.
4. **Keep communities safe without burning out volunteers.** Report resolution time is the trust and safety team's headline metric. Hearth Guard (see the timeline) is the main bet.
5. **Grow revenue.** Ad revenue and Plus subscriptions. The team changed the ad setup in September; leadership asked what it did to the business.
6. **Make threads livelier.** The product team is testing ways to get readers to reply (the Reply Nudges experiment).
