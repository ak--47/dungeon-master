# The Lantern: the business

## Who we are

The Lantern is an independent national digital news publication founded in 2022 by a group of former metro-desk reporters. It covers US politics and policy, national and world news, business, climate, culture, technology, sports, and opinion, and it runs a small investigations desk. The company has eight full-time staff: a newsroom of five (an editor-in-chief, a deputy editor, two reporters, and a podcast producer who also covers sports), one product engineer, one audience lead, and a managing director who also runs member support. Freelance writers and an outside app agency fill the gaps.

Reader subscriptions bring in about $34,000 a month in recurring revenue (early summer 2026, about 2,500 paying subscribers), a little over $400,000 a year. That covers just under half of the budget. A two-year operating grant from a journalism foundation (2025-2026) and reader donations cover most of the rest, and podcast sponsorships bring in a little more. The website and apps carry no display advertising.

The grant ends after 2026, so subscription revenue has to grow. The newsroom and the audience team watch the same numbers: how many people read us, how many create a free account, how many subscribe, and how many stay.

## How reading on The Lantern works

- **Anonymous visitors.** Anyone can read one article without an account. On the next article the site or app shows a **registration wall** asking the visitor to create a free account (email, Google, or Apple sign-in).
- **Registered free readers.** A free account gets **5 free articles in any rolling 30 days**, plus newsletters, saved articles, and push alerts. When a free reader opens an article beyond their allowance, they see the **paywall** instead of the article. The paywall offers both plans. Free readers can always read the home page and section fronts, search, and share links.
- **Subscribers** read without limits, can comment, and (from August 11) can send **gift articles**: a gift link opens one article for anyone, free.
- **Platforms.** Readers use the website (desktop or phone browser) and the iOS and Android apps.
- **Discovery.** Readers arrive from search engines, social media, newsletters, push alerts, links shared by friends, and the home page. Inside the product they move between articles through in-article links and recommendation modules: a module on the app home screen, "related", "more in this section", and "most read".
- **Newsletters** (free with an account): The Morning Lantern (daily briefing), Politics Briefing, Weekend Edition (Saturdays), Climate Desk, Sports Extra, and Tech Week. A newsletter links to articles on the site.
- **Podcasts:** The Lantern Daily (weekday news show), Inside Politics (weekly), and The Long Read (audio versions of features). Anyone can listen; All Access removes the sponsor reads.
- **Push alerts** (apps only): breaking news, the daily briefing, live updates, and sports.

## Plans and pricing

| Plan | List price | What you get |
|---|---|---|
| Free account (`registered`) | $0 | 5 articles in any rolling 30 days, newsletters, saved articles, push alerts |
| Lantern Digital (`digital`) | $12 per month or $120 per year | Unlimited articles on web and apps, comments, gift articles (from Aug 11) |
| Lantern All Access (`all_access`) | $20 per month or $200 per year | Everything in Digital, plus the full archive and ad-free podcasts |

- New subscriptions start from the paywall. The reader picks a plan and a billing period (monthly or annual).
- Promotions apply a discount to the first billing period only; renewals are at list price. The only promotion in the window is the Labor Day sale (see 02-timeline.md).
- Subscribers can cancel at any time in their account settings; The Lantern asks for a reason. A subscriber who cancels goes back to being a free reader and can subscribe again later.
- The Mixpanel project records the plan, billing period, and offer on each new subscription, but not the price. Prices and first-period bookings live in the warehouse table `subscription_billing_daily`.

## Readers

- **Access tier** (`reader_tier`): anonymous visitor, registered free reader, Digital subscriber, or All Access subscriber.
- **Reading habits.** Readership ranges from people who read several times a week to people who come by a few times a month; very few read every day. Frequent readers are more likely to subscribe; most occasional readers stay on a free account.
- **Region** (`region`): US Northeast, South, West, and Midwest, Canada, the UK, and other international readers. The US coasts are the largest groups.
- **Age bands** (`age_band`): `18-24`, `25-34`, `35-44`, `45-54`, `55-64`, `65+`. Most readers are 25-54.
- **Established vs new readers.** About 55% of the readers active in the window had an account before June 4. New visitors arrive steadily, about 260 a week.

## How readers find us

Every reader carries the channel that first brought them to The Lantern (`acquisition_channel`):

- **organic_search** — unpaid search results (Google, Bing, and others).
- **google_ads** — paid Google search ads.
- **meta_ads** — paid ads on Facebook and Instagram.
- **social** — unpaid social media: our own posts and readers' shares.
- **podcast_ads** — host-read ads on other podcasts, with a vanity URL.
- **direct** — typed URLs, bookmarks, and word of mouth.

The three paid channels run on steady daily budgets and bill per visit; daily spend, clicks, and impressions by paid channel are in the warehouse table `marketing_spend_daily`.

## Goals for the period (Q3 2026)

Leadership set these goals for the quarter:

1. **Grow paying subscribers.** Net subscriber growth is the company's main number. The audience team wants to know which reader habits lead to a subscription.
2. **Make the World Cup count.** The sports desk went all in on the 2026 World Cup. Leadership wants to know what the coverage did for readership.
3. **Decide on the For You feed.** Product is testing a personalized home-screen module in the apps and needs a ship / no-ship call.
4. **Turn subscribers into ambassadors.** Gift Articles launched in August. The team wants to know whether subscribers use it.
5. **Spend marketing money well.** Finance asked which paid channel is worth its cost.
6. **Keep subscribers.** Member support wants to know which subscribers are likely to cancel, early enough to do something about it.
7. **Learn from the Labor Day sale.** Was a deep first-period discount worth it?
