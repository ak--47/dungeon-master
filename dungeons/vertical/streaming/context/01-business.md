# Reelhouse: the business

## Who we are

Reelhouse is a subscription streaming service for independent film and prestige TV. It launched in 2021 in Portland, Oregon, and serves households in the United States and Canada. It is venture-backed: a Series A in 2024 funds the team while subscription revenue grows, and the company does not yet cover its costs from subscriptions. It has about 20 employees: content and curation, product and engineering (TV, mobile, and web apps, plus a small streaming infrastructure team), growth marketing, and member support. Playback is delivered through a commercial CDN provider.

Revenue comes from monthly subscriptions, about $65,000 a month in the summer of 2026 from roughly 5,400 paying households. The Basic with Ads plan also earns a small amount of advertising revenue through an ad partner; ad revenue is not in this data.

Reelhouse measures itself by paying households and by how much of what they start they finish. The content team cares about reach: how many households watch a title.

## How Reelhouse works

- **Sign up.** A household creates an account (email, Apple, or Google) on the web, a TV app, or a phone, picks a plan, and starts a **7-day free trial** with a payment method. If the household does not cancel, the first monthly charge happens when the trial ends, and the plan then renews every 30 days.
- **Viewer profiles.** An account has up to five viewer profiles. The account owner's profile exists from signup; households add the others in their first days. A profile can be a kids profile, which shows only kids titles.
- **Screens.** Households watch on TV apps and streaming boxes (Roku, Fire TV, Samsung TV, LG TV, Apple TV, Google TV), phones (iPhone and Android), tablets (iPad, Android tablets, Fire tablets), and web browsers (Chrome, Safari, Edge, Firefox). Most households use more than one screen.
- **Finding something to watch.** The home screen has rows (Continue Watching, Top 10, New Releases, Because You Watched, Reelhouse Originals, Trending Now). Households can search, open a title page, play a trailer, and add titles to My List.
- **Watching.** Series play episode by episode; when an episode ends, the next one starts automatically after a short countdown. Households can rate a title (thumbs up, thumbs down, or "love this") and download titles to a phone or tablet for offline viewing.
- **Ads.** On Basic with Ads, a play starts with a short pre-roll ad, and longer shows have an ad break about every 20 minutes.
- **Cancelling.** Households can cancel at any time in account settings. A cancellation takes effect at the end of the current period (the end of the trial, or the next renewal date), and Reelhouse asks for a reason.

## Plans and pricing

| Plan | List price per month | What you get |
|---|---|---|
| Basic with Ads (`basic_ads`) | $6.99 | Full catalog in HD with ads, 2 streams at once |
| Standard (`standard`) | $11.99; $13.99 for new subscriptions from 2026-08-11 | Full catalog in HD, no ads, 2 streams at once |
| Premium (`premium`) | $17.99 | Full catalog in 4K, no ads, 4 streams at once |

- Every plan starts with the same 7-day free trial.
- Existing subscribers keep the price they signed up at. Households can change plan at any time; the next renewal charges the new plan.
- The Mixpanel project records the plan, not the price. List prices and bookings live in the warehouse table `subscription_billing_daily`.

## The catalog

- **Reelhouse Originals** are series and films that Reelhouse licenses exclusively from independent producers: it buys exclusive North American streaming rights to finished seasons and films at festival and market prices, and it co-finances later seasons of the series that do well with a small minimum guarantee. Reelhouse does not run its own productions. The current Originals are *Saltmarsh* (thriller series, two seasons), *The Quiet Acre* (drama series), *Northbound* (sci-fi series, two seasons), *Copperline* (crime series), *Small Hours* (comedy series, two seasons), *Low Tide Diaries* (documentary series), *Paper Lanterns* and *The Glass Orchard* (films), and the kids series *Pip & the Lighthouse*.
- **Licensed titles** are series and films Reelhouse licenses from studios and distributors, for example *Harbor Lights*, *Second Shift*, *The Assessor*, *Fieldwork*, *Ironwood*, *Kitchen Table*, *Night Desk*, *Marrow Creek*, and films such as *Signal Fires*, *Ember Road*, and *Pale Signal*, plus a small kids library.
- *Saltmarsh* is Reelhouse's best-known Original. Season 1 has been on the service since 2025. Season 2 is the big release of the summer (see 02-timeline.md).
- There are 34 titles in the catalog through the window; no licensed title was added or removed.

## Households

- **Country** (`country`): `US` or `CA`. About 84% of households are in the US.
- **Viewer profiles** (`profile_count`, 1-5): the number of viewer profiles on the account. About a third of households have a single profile.
- **Kids profile** (`has_kids_profile`): whether the account has a kids profile.
- **Established vs new households.** About half of the households active in the window joined before June 4. In a typical week a little over 250 households create an account.

## How households find us

New households arrive through one of five acquisition channels, recorded at signup:

- **organic** — app store and smart-TV store search, press, and word of mouth.
- **referral** — a friend shared a referral link.
- **paid_social** — paid ads on Instagram, Facebook, and TikTok.
- **paid_search** — paid search ads on Google and Bing.
- **ctv** — video ads on connected-TV platforms (ads that play inside other streaming apps).

The three paid channels run on daily budgets set by growth marketing. Daily spend by paid channel is in the warehouse table `marketing_spend_daily`.

## Push notifications

The CRM team sends push notifications to the Reelhouse app on phones and tablets. Each push has a campaign type:

- `new_episode` — a new or next episode of a series the household is watching.
- `because_you_watched` — a recommendation based on what the household watched.
- `trending_now` — a title that is popular on Reelhouse right now.
- `win_back` — an invitation to come back, sent to households whose subscription has ended. In this period it is a content reminder only: a lapsed account cannot resubscribe in the app yet (the in-app resubscribe flow and win-back offers are planned for after September).
- `new_season` — a one-off announcement of a major season launch.

## Goals for the period (Q3 2026)

Leadership set these goals for the quarter:

1. **Convert more trials.** Trial conversion is the most watched number in the company. The product team is testing a new onboarding flow (the Smart Start experiment). The growth team believes the first days of a trial decide whether a household subscribes.
2. **Make Saltmarsh season 2 a hit.** The content team wants to know how many households watched it and whether it brought in subscribers who stay.
3. **Grow revenue per subscriber.** The pricing team raised the Standard price for new subscriptions in August; leadership asked whether it raised revenue.
4. **Efficient acquisition.** Finance asked which paid channel is worth its cost.
5. **Reliable streaming.** The streaming infrastructure team reports playback quality every week and wants to understand what the August streaming incident cost.
6. **Reduce churn.** Member support and finance want to know which households cancel and why.
7. **Better discovery.** The product team asked how search works across screens; the CRM team wants to know which pushes are worth sending.
