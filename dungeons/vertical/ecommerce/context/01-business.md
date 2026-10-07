# Marlowe & Pine: the business

## Who we are

Marlowe & Pine is a direct-to-consumer home goods brand founded in 2019 and based in Portland, Oregon. We design our own bedding, bath, kitchen and dining goods, furniture, lighting, decor, and outdoor pieces, make them with contract manufacturers, and sell them only through our own website and apps. We run one fulfillment center in Columbus, Ohio. The company has about 70 employees, and annual sales are about $16 million. A small wholesale program supplies a few boutique retailers from the same stock.

## What customers do in the store

- **Browse.** Shoppers open a category page (sorted by featured, bestselling, newest, or price), search, and open product pages. They read product reviews and save products to a wishlist.
- **Room Visualizer.** From July 22, furniture and lighting product pages offer Room Visualizer: the shopper points a phone camera (or uploads a photo on the website) and sees the piece in their own room at true scale. The furniture team hopes it reduces hesitation on big-ticket items.
- **Buy.** Shoppers add products to a cart, view the cart, start checkout, enter a shipping address, enter payment (card, PayPal, a digital wallet, or Afterpay), and place the order. An account is required to check out.
- **Receive.** The fulfillment center ships the order, usually within a day and a half. A parcel carrier delivers it. Customers can track orders in their order history, request a return within 30 days of delivery, and review what they bought.

## Products and prices

| Category | Typical items | Typical price |
|---|---|---|
| Bedding | duvet covers, sheet sets, quilts, pillowcases, throws | $30-$280 |
| Bath | towel sets, bath mats, robes | $18-$120 |
| Kitchen | Dutch ovens, knife sets, cutting boards, dish towels, utensils | $14-$240 |
| Dining | dinnerware, glassware, flatware, napkins, platters | $20-$200 |
| Furniture | accent chairs, coffee tables, bookshelves, bed frames, nightstands | $180-$1,400 |
| Lighting | table lamps, floor lamps, pendants | $70-$320 |
| Decor | candles, vases, throw pillows, mirrors, planters, frames | $14-$240 |
| Outdoor | cushions, lanterns, patio chairs, planter boxes | $28-$380 |


## Shipping and Pine Plus

- **US standard shipping** is free on orders whose subtotal is at or above the free-shipping threshold, and $7.95 below it. The threshold was $75 until August 4 and $50 from August 5 (see the timeline). The threshold applies to the merchandise subtotal before discounts.
- **Pine Plus** is a paid membership: $49 a year for free US shipping on every order, early access to new collections, and 10% back in Pine points. About a quarter of active customers are members. Membership is recorded on the profile and on every event (`membership`); it did not change for anyone during the window.
- **Canada and the UK** pay a flat $24.95 shipping fee on every order, members included. Duties and import taxes apply to international orders (see the timeline for how they were shown at checkout).
- **Carriers.** The fulfillment system picks the carrier for each US parcel by rate and capacity across three contracted carriers: **Northline Parcel** (regional ground, our largest contract), **Bluejay Express**, and **ParcelPost** (the national postal service). Canadian orders go by **Maple Courier** and UK orders by **Albion Parcel**. We promise delivery within 5 days of shipping in the US and 12 days for Canada and the UK.

## Customers

- **Shipping country** (`ship_country`): `US` (most customers), `CA`, or `GB`. We started shipping to Canada and the UK in 2025.
- **Shopper segments** (`shopper_segment`), from the CRM's survey-based model:
  - `home_refresher` — updates a room or two a year; the largest segment.
  - `deal_seeker` — buys during promotions and watches prices.
  - `new_mover` — recently moved and furnishing a new home; the most active shoppers.
  - `casual_gifter` — buys a few items a year, often as gifts.
- **Membership** (`membership`): `pine_plus` or `standard`.

## How customers find us

New customers arrive through one of six acquisition channels, recorded at signup (`acquisition_channel`):

- **organic_search** — unpaid search results and content.
- **direct** — typed the URL or opened the app directly, often after word of mouth.
- **email_referral** — our email newsletter and the refer-a-friend program.
- **meta_ads** — paid social ads on Facebook and Instagram.
- **google_shopping** — paid Google Shopping product listings.
- **tiktok_ads** — paid TikTok ads and creator videos promoted as ads.

The three paid channels bill for impressions and clicks. Daily spend by paid channel is in the warehouse table `marketing_spend_daily`.

## Goals for the period (summer and Q3 2026)

Leadership set these goals:

1. **Convert more carts.** Checkout is the biggest lever. The product team is testing a one-page checkout (see the timeline) and wants a ship decision.
2. **Grow international.** Canada and the UK are young markets. Leadership asked how international checkout compares with the US and whether the September Canada pilot was worth it.
3. **Spend paid media efficiently.** Marketing added TikTok to the mix this year. Finance asked which paid channels are worth their cost, measured on first orders, not signups.
4. **Keep new customers.** The growth team wants to know which early behaviors predict a new customer coming back.
5. **Deliver on time.** Late parcels drive support contacts and bad reviews. Operations watches carrier service levels closely.
6. **Merchandise well.** The merchandising team lowered the free-shipping threshold in August and wants to know whether it paid off. It also tracks stock on core bedding lines.
