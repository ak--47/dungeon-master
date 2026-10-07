# Keystead Homes: the business

## Who we are

Keystead Homes is a home-search app and buyer brokerage. It started in Austin in 2021 and now serves eight fast-growing metros in the South and Mountain West: Dallas, Austin, Phoenix, Denver, Nashville, Charlotte, Tampa, and Raleigh. Shoppers search every MLS listing in their market for free; when they are ready to buy, a Keystead buyer agent tours homes with them and writes their offers. Keystead Home Loans, the company's mortgage arm, offers pre-approvals and loans.

The company has about 270 people: about 190 licensed buyer agents (24 per market), a lending team, and product, engineering, marketing, and operations staff at headquarters.

## How Keystead makes money

- **Buyer-agent commission.** When a Keystead buyer closes on a home, Keystead earns the buyer-agent commission, typically about 2.5% of the price. Closing usually happens 30 to 45 days after the seller accepts the offer, so most closings from offers accepted in this window land after it.
- **Mortgage origination.** When the buyer finances with Keystead Home Loans, the lender earns origination fees.
- Search, saved homes, alerts, agent chat, and tours are free. Shoppers pay nothing unless they buy.

## How buying a home with Keystead works

- **Search.** Shoppers search their market by price, bedrooms, and property type. Anyone can browse without an account; an account is needed to save homes and searches, message an agent, or book a tour.
- **Listing pages.** Each listing page shows the MLS details (price, beds, baths, square feet, days on market, and whether the price has been cut) and, for many homes, a 3D walkthrough.
- **Save homes and searches.** Shoppers save homes they like. They can also save a search; Keystead then sends a listing alert (a daily digest or an instant notice, by email or push) when new homes match it.
- **Your agent.** Every shopper is assigned a Keystead buyer agent in their market at signup. Shoppers message their agent about a listing from the listing page (chat, a call-back request, or email). Agents work in teams and cover messages seven days a week.
- **Tours.** A shopper can request a scheduled tour (the agent meets them at the home, usually two to three days later) or, from July 15, use **Tour It Now** to book a same-day or next-morning tour from the listing page. Agents also book tours for shoppers from the chat. The agent marks the tour completed in the agent app.
- **Pre-approval.** Shoppers apply for a pre-approval with Keystead Home Loans online. The lender reviews the application and issues a decision, usually about a day later, with an approved amount and a quoted rate for the day. A pre-approval letter is valid for 90 days and can be renewed. Shoppers may also use an outside lender; Keystead does not see those approvals.
- **Offers.** After a tour, the agent writes and submits an offer if the shopper wants the home. The seller accepts it or rejects it (outbid, price too low, terms, or the seller withdrew). A shopper whose offer is accepted is "under contract" and usually stops shopping.

## Shoppers

- **Buyer type** (`buyer_type`), asked at signup:
  - `first_time` — buying their first home.
  - `move_up` — selling or leaving a current home for a bigger or better one.
  - `investor` — buying a rental or second property.
- **Home market** (`home_market`): the metro the shopper is searching in. Dallas is the largest; Raleigh is the smallest.
- **Budget** (`budget_max_usd`): the maximum price the shopper set in their search preferences.
- **Platforms:** about half of activity comes from laptops and desktops on the website; the rest comes from phones and tablets (iOS and Android). Most shoppers use more than one device.
- **Established vs new shoppers.** About 53% of the shoppers active in the window created their account before June 4. New accounts arrive steadily, about 265 a week.

## Markets at a glance

| Market | Typical list price | Active listings on a typical day |
|---|---|---|
| Dallas | about $395k | about 2,500 |
| Phoenix | about $425k | about 2,200 |
| Austin | about $495k | about 2,100 |
| Tampa | about $380k | about 1,650 |
| Denver | about $550k | about 1,650 |
| Charlotte | about $385k | about 1,550 |
| Nashville | about $455k | about 1,500 |
| Raleigh | about $420k | about 1,350 |

Market-wide inventory comes from each metro's MLS feed; daily figures are in the warehouse table `market_inventory_daily`.

## How shoppers find us

New shoppers arrive through one of five acquisition channels, recorded at signup:

- **organic** — search engines, app stores, press, and word of mouth.
- **referral** — a friend, a past client, or a partner shared a link.
- **paid_search** — paid ads on Google and Bing search.
- **paid_social** — paid ads on Instagram, Facebook, and TikTok.
- **youtube_ads** — paid video ads on YouTube.

The three paid channels run on daily budgets. Daily spend, clicks, impressions, and the leads each ad platform reports are in the warehouse table `marketing_spend_daily`. Paid social is the largest source of new accounts.

## Goals for the period (Q3 2026)

Leadership set these goals for the quarter:

1. **More tours.** Tours are where buyers decide. The product team launched Tour It Now in July and wants to know whether it worked.
2. **More financing-ready buyers.** Keystead Home Loans wants more shoppers pre-approved and is testing a monthly payment estimate on listing pages (the Payment Estimate experiment).
3. **Efficient acquisition.** Finance asked which paid channel brings buyers, not just accounts.
4. **Keep new shoppers coming back.** The growth team believes saved searches matter for new shoppers and wants a read.
5. **Responsive agents.** Sales leadership tracks how fast agents reply to shopper messages and believes it matters.
6. **Read the market.** Leadership asked how the late-summer change in mortgage rates affected demand.
