# Tradepost: the business

## Who we are

Tradepost is a peer-to-peer resale marketplace for secondhand goods: electronics, clothing, sneakers, home decor, collectibles, toys and games, and sports and outdoor gear. It launched in 2022 and serves buyers and sellers across the United States through its iOS and Android apps. The company has about 14 employees: product and engineering, trust and safety, payments, seller success, growth marketing, and member support. Tradepost is venture-funded and not yet profitable; the plan is to grow GMV and reach break-even on fee and subscription revenue.

Tradepost makes money from **selling fees** (a percentage of each sale's item price, also called the take rate) and from the **Tradepost Pro** subscription. Buyers do not pay a fee; they pay the item price plus shipping. Over the summer of 2026 the members in the analytics sample (see 00-manifest.md) bought roughly $0.5-1.0 million of goods a month (gross merchandise value, GMV).

## How buying works

- **Browse.** Members land on the home feed (sections For You, Following, Deals, and seasonal collections), search, and open listings. They can save a listing to come back to it.
- **Buy now or make an offer.** A buyer can buy at the asking price or make an offer below it. The seller accepts or declines (counteroffers are handled as a new offer). Offers expire after 48 hours without an answer. An accepted offer moves the buyer to checkout at the offer price.
- **Checkout.** The buyer confirms the shipping address and pays with a card, Apple Pay (iOS), Google Pay (Android), or PayPal. A checkout ends when the payment is approved and the order is placed.
- **Shipping.** Items over $100 ship free; otherwise the buyer pays $5.49 ($8.49 for home decor). The seller prints a prepaid label and ships with USPS, UPS, or FedEx. Tradepost asks sellers to ship within 3 business days.
- **After delivery.** The buyer can review the order (1-5 stars) or open a dispute (item not as described, damaged, counterfeit, not received, other).

## How selling works

- **List.** A seller creates a listing with photos (1 to 12), a category, a condition, an asking price, and a package size (small, medium, or large) that sets the prepaid label.
- **Price drops.** Sellers can lower the price at any time.
- **Sell and ship.** When an item sells, the seller prints the shipping label and ships it. The seller is paid when the buyer confirms delivery or three days after delivery.

## Fees and plans

| Seller type | `account_type` / `seller_type` | Selling fee | Subscription |
|---|---|---|---|
| Casual seller | `seller` / `casual` | 10% of the item price until 2026-07-14; 12.9% from 2026-07-15 | none |
| Tradepost Pro | `pro_seller` / `pro` | 9.5% (unchanged) | $19.99 a month |

Pro is for frequent sellers: small resale shops, sneaker resellers, vintage dealers, and people clearing an estate. Pro sellers get the lower fee, bulk listing tools, and a seller dashboard; they list from the Sell tab and the dashboard rather than from the home feed. Fees and fee revenue are recorded in the warehouse table `marketplace_ledger_daily`, not in Mixpanel.

## Members

- **Account type** (`account_type`): `buyer` (buys only), `seller` (a casual seller who also buys), or `pro_seller` (a Tradepost Pro seller). About 70% of active members are buyers, 22% casual sellers, and 8% Pro sellers.
- **Region** (`region`): `south`, `west`, `midwest`, or `northeast`, from the member's shipping address. The South is the largest region.
- **Age band** (`age_band`): `18-24`, `25-34`, `35-44`, `45-54`, `55+`.
- **Platforms:** members use the iOS app (iPhone or iPad) or the Android app. A little over half are on iOS.
- **Established vs new members.** About half of the members active in the window joined before June 4. New members arrive steadily, about 290 a week. Established members skew toward recent sign-ups: acquisition grew through 2025 and spring 2026 (TikTok was added in March 2026), and many members from earlier years have gone quiet.

## Categories

| Category | `category` | Typical price |
|---|---|---|
| Electronics | `electronics` | about $165 (phones, laptops, tablets, headphones, consoles) |
| Sneakers | `sneakers` | about $125 |
| Collectibles | `collectibles` | about $60 (cards, figures, vintage items) |
| Sports and outdoors | `sports_outdoors` | about $60 |
| Home decor | `home_decor` | about $50 |
| Fashion | `fashion` | about $35 |
| Toys and games | `toys_games` | about $30 |

Prices vary widely inside each category; a few listings run to several thousand dollars.

## How members find us

New members arrive through one of five acquisition channels, recorded at signup:

- **organic** — app store search, word of mouth, and social posts.
- **referral** — a friend shared their invite link (both get a credit).
- **google_shopping** — paid product listing ads in Google Shopping that open a Tradepost listing.
- **meta_ads** — paid ads on Instagram and Facebook.
- **tiktok_ads** — paid in-feed video ads on TikTok.

The three paid channels run on daily budgets plus automated bidding toward app installs. Daily spend by channel is in the warehouse table `marketing_spend_daily`. The growth team added TikTok in March 2026 to reach younger shoppers, so no member who joined before then came through TikTok. Finance has asked whether it pays off.

## Goals for the period (Q3 2026)

1. **Healthy supply.** Keep listings growing while the fee schedule changes. Seller success asked how sellers responded to the July fee change and whether it paid off.
2. **Convert more checkouts.** The payments team is testing a faster checkout (the Express Checkout experiment) and launched the Tradepost Guarantee to give buyers confidence.
3. **Efficient acquisition.** Finance wants to know which paid channel brings new buyers most efficiently.
4. **Better offers.** The marketplace team wants guidance for buyers on what offers sellers accept.
5. **Faster selling.** Seller success wants to know what makes listings sell, and how fast each category moves.
6. **Delivery and trust.** Member support wants to understand how delivery speed affects buyers.
7. **Reliable payments.** After a rough week in September, the payments team wants to know what the processor problems cost.
