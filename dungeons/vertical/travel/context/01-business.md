# Driftway Travel: the business

## Who we are

Driftway Travel is an online travel company that sells hotel and vacation-rental stays through an iOS app, an Android app, and a website. It started in 2021 with city hotels for US travelers and now lists about 670 properties in 28 destinations across the US, the Caribbean, Canada, and Europe. The company has about 60 employees: product and engineering, a supply team that signs and manages property partners, growth marketing, payments, and a member support team.

Driftway earns a commission (about 15% of the stay price) from the property on every completed stay. Travelers pay the nightly rate plus taxes and fees; Driftway charges travelers no booking fee. In summer 2026 members booked about $5.7 million of stays a month through Driftway (before cancellations).

## How booking on Driftway works

- **Search.** A traveler picks a destination, dates (check-in date and number of nights), and the number of guests. Each search starts a search session.
- **Browse.** Search results list properties for that destination. Travelers open property pages, filter (price, guest rating, free cancellation, property type, amenities, neighborhood), look at the map, save properties to a wishlist, and set price alerts for a destination.
- **Checkout.** From a property page the traveler starts checkout: they confirm dates and guests, choose a rate, and pay. Checkout needs an account; a new traveler creates one when they want to save a property or check out.
- **Book.** A successful payment creates the booking. Driftway sends a confirmation and, the day before check-in, a trip reminder.
- **Stay.** On the first day of the stay the guest checks in (front desk, mobile key, or self check-in). After the stay Driftway asks for a review (1-5 stars and a short text).
- **Cancel.** Travelers can cancel in the app or on the website. On a **free-cancellation rate** they get a full refund; on a **non-refundable rate** (cheaper, about 30% of bookings) they get nothing back. Driftway asks for a reason when someone cancels.
- **Support.** Members reach support by chat, phone, or email about date changes, cancellations, refunds, payments, and problems at the property.

## Products and payments

- **Property types:** hotels, boutique hotels, resorts (many of the Caribbean listings), and vacation rentals (houses and apartments, which use self check-in).
- **Guest reviews.** Every property page shows its number of guest reviews (`review_count`) and its average guest rating. New listings start with no reviews; vacation rentals show no star rating.
- **Payment methods:** credit or debit card, PayPal, Apple Pay (Apple devices and Safari), Google Pay (Android and Chrome), and, from July 14, **Flex Pay**: book now and pay in four installments, with no interest for the traveler.
- **Driftway Rewards.** Every member is in Rewards. Tiers are `member` (everyone starts here), `silver`, and `gold`, earned by stays in the previous calendar year. Members who joined in 2026 are all `member`.
- **Messages.** Members on the marketing list get a weekly deals email every Thursday. The app also sends price-drop alerts, reminders about searches a member did not finish, trip reminders, and occasional campaign emails and pushes. About 62% of members allow push notifications.

## Travelers

Driftway's planning and marketing teams describe travelers in four segments (`traveler_segment` on the profile):

- **`business`** — people who travel for work: mostly city hotels, one to three nights, one guest.
- **`family`** — parents traveling with children: beach, mountain, and Caribbean stays of four to eight nights for three to five guests, usually planned well ahead around school holidays.
- **`couple`** — two adults on a getaway: two to five nights, often Caribbean and European trips.
- **`solo`** — one adult traveling for leisure: city and European trips of two to six nights.

Other profile attributes: home market (US cities, Toronto, London, Manchester), age band, acquisition channel, Rewards tier, and member-since date. About half of the members active this summer joined before June 4.

## How members find us

New members arrive through one of six acquisition channels, recorded at signup:

- **organic** — app store search, search engines, press, and word of mouth.
- **referral** — a friend shared their invite link.
- **email** — sign-ups from partner newsletters.
- **google_hotel_ads** — paid listings in Google's hotel search results.
- **meta_ads** — paid ads on Instagram and Facebook.
- **tiktok_ads** — paid in-feed video ads on TikTok. Marketing added TikTok in the spring to reach younger travelers.

The three paid channels run on daily budgets with bids. Paid acquisition runs on a modest budget (about $12,000 a month across the three channels). Daily spend, clicks, and impressions by paid channel are in the warehouse table `marketing_spend_daily`.

## Goals for the period (summer and Q3 2026)

Leadership set these goals for the season:

1. **Convert more shoppers.** Grow the share of search sessions that end in a booking. The payments team launched Flex Pay in July; the product team is testing how prices are displayed (the All-in Pricing experiment).
2. **Grow bookings efficiently.** Finance asked which paid channel is worth its cost, including the newest one, TikTok, and how much a booking costs to acquire by channel.
3. **Keep bookings booked.** Cancellations cost commission and support time. The revenue team wants to understand which bookings cancel.
4. **Reliable payments.** After a payment incident in August, leadership asked how much it cost and how quickly it was caught.
5. **Supply quality.** The supply team is planning which properties to sign for the winter season and wants to know which listings turn browsers into bookers.
6. **Guest experience.** Member support wants to know what reviews tell us about who keeps booking with Driftway.
