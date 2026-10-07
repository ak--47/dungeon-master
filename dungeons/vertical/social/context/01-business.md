# Murmur: the business

## Who we are

Murmur is a social app for sharing everyday moments with friends and with the creators people love. It launched in 2024 and raised a seed round in early 2026. The team is 8 people: five engineers (feed and ranking, Clips, messaging, creator tools), a product lead who also runs growth marketing, a creator partnerships lead, and a community and trust and safety manager. Murmur is very early in monetization. Revenue is tiny next to marketing spend: ads and Circles are small tests that prove the model before the next round. Leadership's 2026 plan is to grow the member base and show that ads and Circles can pay for growth at scale.

## How Murmur works

- **Sign up and onboard.** A new member creates an account (Apple, Google, or phone number), picks a few interests, and then sees a **suggested accounts** screen with people and creators to follow, based on those interests. Members can follow as many suggestions as they like or skip the screen.
- **Feeds.** Members scroll two feeds: **Following** (posts from accounts they follow, newest first) and **For You** (posts ranked by the ranking service, including accounts the member does not follow yet). They can also browse a community's feed, a profile, or search results.
- **Posts.** A post is text, a photo, a link, or a poll. From July 8 members can also post **Clips**, short vertical videos (see 02-timeline.md). Members like, comment on, and share posts.
- **Stories** are photos or short videos that disappear after a day. Viewers can reply by direct message.
- **DMs.** One-to-one and small-group direct messages.
- **Communities.** Topic groups (music, gaming, food, film, and others) with their own feed. Each member belongs to a few.
- **Push notifications** tell members about likes, comments, new followers, mentions, DMs, and trending posts.
- **Search** finds people, topics, and communities.

## Account types

| Account type (`account_type`) | Who | Share of members |
|---|---|---|
| `personal` | Everyday members | about 83% |
| `creator` | Musicians, artists, comedians, and other creators who post for an audience | about 14% |
| `business` | Brands and local businesses | about 3% |

## How Murmur makes money

### Ads

Murmur sells ads in three placements (`ad_placement`): in the **feed** between posts, between **Stories**, and between **Clips** (from the Clips launch). Murmur has no ad sales team. One ad network partner fills every slot and pays Murmur per thousand impressions (eCPM); Murmur's own ad server decides where slots go and counts impressions. Ad impressions are tracked in Mixpanel (`ad viewed`), but prices and revenue live only in the warehouse table `ad_revenue_daily`.

### Circles (creator subscriptions)

A creator can open a **Circle**: fans pay monthly for subscriber-only posts, Stories, and a badge. The profile property `circle_enabled` marks creators who run a Circle. Fans pick a tier:

| Tier (`circle_tier`) | Price per month |
|---|---|
| `supporter` | $2.99 |
| `insider` | $5.99 |
| `vip` | $11.99 |

Murmur keeps a platform fee on each Circle payment and pays the rest to the creator. The fee was 20% until 2026-08-11 and 10% from 2026-08-12 (see 02-timeline.md). Mixpanel records a new subscription (`circle subscription started`, with tier) but not renewals or payments.

Fans meet a Circle paywall in two places (`paywall_trigger`): when they tap a **locked post** (subscriber-only content) in a feed, or when they tap the **Join** button on a creator's profile. Locked posts show in feeds as blurred previews, and the ranking service puts them in For You for members who do not follow the creator, so many members who have never subscribed to anything still meet a paywall from time to time.

## How members find us

New members arrive through one of five acquisition channels, recorded at signup (`acquisition_channel`):

- **organic** — app store search, press, and word of mouth.
- **friend_invite** — a friend sent an invite link.
- **meta_ads** — paid ads on Instagram and Facebook.
- **tiktok_ads** — paid in-feed video ads on TikTok.
- **creator_partnerships** — Murmur pays creators on other platforms to invite their audience to Murmur with a referral link.

The three paid channels are billed daily. Daily spend by paid channel is in the warehouse table `marketing_spend_daily`. Creator partnerships are the newest paid channel; the founders asked whether they are worth it.

## Members

- **Platforms:** members use the iOS app (iPhone or iPad, about 54% of members) or the Android app (about 46%).
- **Age bands** (`age_band`): `18-24`, `25-34`, `35-44`, `45-54`, `55+`. Most members are under 35.
- **Countries** (`country`): `US` (most members), `GB`, `CA`, `BR`, `IN`, `DE`, `AU`.
- **Established vs new members.** About half of members active in the window joined before June 4. New members arrive steadily, about 290 a week.
- **Engagement segments.** The CRM groups personal members into heavy scrollers, regular members, and lurkers by how much they use the app; creators and businesses are their own segments. These segments live in the CRM, not in Mixpanel.

## Goals for the period (Q3 2026)

1. **Grow and keep new members.** New-member retention is the top growth metric. The product lead believes a new member's first week decides whether they stay.
2. **Make Clips a habit.** Clips launched in July; the team wants to know how fast it is being adopted, by viewers and by posters.
3. **Fewer, better notifications.** The messaging engineer is testing a daily digest (the Smart Digest experiment) and wants a ship decision.
4. **Efficient acquisition.** The founders and the board asked which paid channel is worth its cost, counting members who stay, not just signups.
5. **A healthy creator economy.** Murmur cut the Circles fee in August to bring creators' earnings closer to other platforms. Leadership asked what it cost Murmur and whether creators responded.
6. **Grow ad revenue without hurting the feed.** The team raised ad load in September and wants to know whether it paid off.
7. **Reliability.** Engineering wants a clear account of the August Android incident and its impact.
