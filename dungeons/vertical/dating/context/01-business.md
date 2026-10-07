# Kindred: the business

## Who we are

Kindred is a dating app for adults who want a real relationship, not endless swiping. It launched in 2024 in New York and now serves ten US cities plus London and Toronto. The company is venture-backed and has about 12 employees: product and engineering, a two-person Trust & Safety team, growth marketing, and member support. Revenue comes from subscriptions (renewals included, about $55,000 a month in the summer of 2026) and a small amount of in-app purchases (extra Boosts); there is no advertising in the app.

The product team's north star is dates: Kindred measures itself by how many members meet someone in person, not by time spent in the app.

## How dating on Kindred works

- **Set up a profile.** A new member creates an account (Apple, Google, or phone number), uploads photos (1 to 9), answers profile prompts, and states a relationship goal. The profile is complete when photos and at least one prompt are in place. Members cannot like anyone until their profile is complete.
- **Discover.** Members browse profiles in Discover, in Standouts (a daily curated set), and in Likes You (people who already liked them). On each profile they either like it or pass. They can open the full profile first.
- **Like or Spark.** A like can be a standard like or a **Spark**: a premium like with a short note attached, shown at the top of the other member's Likes You list. Members get a Spark allowance that depends on their plan, and some members use Sparks far more than others.
- **Match.** A match happens when both members like each other. If the other member had already liked you, the match is instant; otherwise it waits until they see your like.
- **Chat.** After a match either member can send the first message (the opener). Conversations go back and forth in the chat.
- **Plan a date.** Inside a chat, members can use Date Plan to agree on a day and a venue type (drinks, coffee, dinner, an activity, or a video call).
- **Date feedback.** After the date, Kindred asks each member to rate it (1 to 5 stars) and say whether they would meet again. The feedback is private and helps the matching team.
- **Trust & Safety.** Members can report a profile (fake profile, scam, harassment, inappropriate photos, spam, or behavior on a date). From July 14 members can verify their profile with a short video selfie and earn a Verified badge.

## Plans and pricing

| Plan | List price | What you get |
|---|---|---|
| Free | $0 | A cap on likes per day, a small Spark allowance, basic filters |
| Kindred+ (`plus`) | 1 month $29.99, 3 months $74.99, 6 months $119.99 until 2026-08-17; 1 month $34.99, 3 months $86.99, 6 months $139.99 for new subscriptions from 2026-08-18 | Unlimited likes, see everyone in Likes You, a larger Spark allowance, advanced filters |
| Kindred Premier (`premier`) | 1 month $49.99, 3 months $119.99, 6 months $179.99 (unchanged) | Everything in Kindred+, the largest Spark allowance, a weekly Boost, priority placement in Discover |

- **How people upgrade.** Free members see a paywall when they run out of likes, tap Likes You, try to send a Spark beyond their allowance, try to Boost, or open the plans page from their profile. From the paywall they can start Kindred+ or Premier and pick a billing period.
- **Boosts** put a profile at the top of Discover in the member's area for 30 or 60 minutes. Premier includes one a week; anyone can buy more.
- **Cancellations.** Members can cancel at any time in the app store or in Kindred settings. Kindred asks for a reason when they cancel.
- The Mixpanel project tracks the subscription start, plan, and billing period, but not the price. List prices and bookings live in the warehouse table `subscription_bookings_daily`.

## Members

- **Gender and seeking** (`gender`, `seeking`): members state their gender (`man`, `woman`, `nonbinary`) and who they want to see (`women`, `men`, `everyone`).
- **Age bands** (`age_band`): `18-24`, `25-29`, `30-34`, `35-39`, `40-49`, `50+`. Most members are 25-34.
- **Relationship goal** (`relationship_goal`), chosen at profile setup:
  - `long_term` — looking for a long-term partner.
  - `long_term_open` — long-term, open to short.
  - `figuring_it_out` — not sure yet.
  - `short_term_fun` — short-term, open to long.
- **Markets** (`market`): New York, Los Angeles, Chicago, Washington DC, San Francisco, Austin, Boston, Miami, Seattle, Denver, London, Toronto. New York is the largest.
- **Platforms:** members use the iOS app (iPhone or iPad) or the Android app; a little over half are on Android.
- **Established vs new members.** About 55% of members active in the window joined before June 4. New members arrive steadily, about 260 a week.

## How members find us

New members arrive through one of five acquisition channels, recorded at signup:

- **organic** — app store search, press, and social posts.
- **referral** — a friend shared their invite link.
- **meta_ads** — paid ads on Instagram and Facebook.
- **tiktok_ads** — paid in-feed video ads on TikTok.
- **apple_search_ads** — paid placements in App Store search results.

The three paid channels bill for impressions and clicks on daily budgets. Daily spend by paid channel is in the warehouse table `paid_acquisition_daily`.

## Goals for the period (Q3 2026)

Leadership set these goals for the quarter:

1. **More first dates.** Grow the number of planned dates per active member. The product team is testing ways to help matched members start talking (the Icebreakers experiment). The chat team believes momentum right after a match matters.
2. **A safer app.** Trust & Safety launched Verified Profiles in July to fight fake accounts and romance scams, and asked for a read on whether it is working.
3. **Grow subscription revenue.** The pricing team raised Kindred+ prices in August; leadership asked whether it hurt sales and whether it paid off.
4. **Efficient acquisition.** Finance asked which paid channel is worth its cost.
5. **Activate new members.** Too many signups never finish their profile. The growth team wants to know where they drop.
6. **Understand churn.** Member support and finance want to know why members leave.
