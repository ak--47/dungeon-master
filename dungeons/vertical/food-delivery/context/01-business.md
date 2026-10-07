# Forkfly: the business

## Who we are

Forkfly is a food delivery app for people who want good local food, not a thousand chains. It launched in Austin in 2023 and now runs in eight US cities: New York, Chicago, Atlanta, Miami, Boston, Austin, Denver, and Seattle. In each city Forkfly works with a curated set of about 24 independent restaurants (about 190 in total), chosen by the local market manager.

The company has about 30 employees: product and engineering, a market operations team (one market manager per city plus courier scheduling), growth marketing, a small customer support team (chat and phone), and finance. In summer 2026 Forkfly handles a few hundred app orders a day across all cities. The average order total is about $34.

Couriers are independent contractors who sign up for delivery shifts in their city. Forkfly's dispatch system assigns each order to a courier and estimates the delivery time.

## How ordering works

- **Sign up.** A new customer creates an account (Apple, Google, or email) and saves a delivery address. A customer needs a saved address to check out.
- **Find food.** Customers browse the home feed or search by dish or cuisine, then open a restaurant's page (name, cuisine, price tier `$` to `$$$$`, and rating).
- **Build a cart.** They add menu items to the cart.
- **Order Again.** From 2026-07-07, customers who have had an order delivered see an Order Again row on the home screen with their recent restaurants. One tap refills the cart with the items the customer chose on a recent order, at today's menu prices, ready for checkout. Items added on the checkout screen are not copied.
- **Check out.** The checkout screen shows the subtotal, the delivery fee, the service fee, the quoted delivery time in minutes (from the dispatch system), and the payment method. The customer then places the order and pays.
- **Pay.** Payment methods are card (credit or debit, processed by our card processor, Paylane), Apple Pay (iOS only), Google Pay (Android only), and PayPal. If a payment fails, the order is not placed.
- **Track.** While the order is on its way, the customer can open the tracking screen (preparing, picked up, on the way, or running late).
- **Delivery.** The courier marks the order delivered. Forkfly records how long the delivery took and how early or late it was against the time quoted at checkout.
- **Rate and get help.** After delivery the customer can rate the food and the delivery (1 to 5 stars each). Customers can contact support by chat or phone about an order (late delivery, missing or wrong items, food quality, refunds).

## Fees, promotions, and Forkfly Pass

| Charge | Non-Pass orders | Pass orders (trial or member) |
|---|---|---|
| Delivery fee | $1.99-$4.99, by distance from the restaurant | $0 on orders with a subtotal of $15 or more; the normal fee below $15 |
| Service fee | 10% of the subtotal; 15% from 2026-08-11 | 5% of the subtotal |
| Tip | Optional; 100% goes to the courier | Same |

- **Promotions.** A new customer's first order gets $8 off (code `WELCOME8`). Customers who come from a coupon or deal website get $15 off their first order instead (`DEAL15`). Now and then a customer gets a $5 code (`FORK5`).
- **Forkfly Pass** costs $9.99 a month. Customers who have never had a Pass trial are offered a 14-day free trial on the checkout screen. A customer can have one trial. At the end of the 14 days the trial either converts to a paid membership or ends. Members can cancel at any time and are asked for a reason.
- Restaurants pay Forkfly a commission on each order. Commission is not in this dataset.

## Customers

- **Cities** (`city`): New York is the largest market (about a fifth of customers), then Chicago (about a seventh). Each of the other six cities has about a tenth of customers.
- **Household type** (`household_type`), from the signup survey question "Who do you usually order for?": `single` (just me), `couple`, `family`. Families order more items per order.
- **Favorite cuisine** (`favorite_cuisine`), from the same survey.
- **Platforms:** a little over half of customers use the iOS app (iPhone or iPad); the rest use the Android app.
- **Established vs new customers.** About 58% of customers active in the window were already customers on June 4. The rest signed up during the window.
- **Pass members.** Roughly 1,200 to 1,700 customers held a Pass (trial or paid) at any one time in the summer.

## How customers find us

New customers arrive through one of five acquisition channels, recorded at signup:

- **organic** — app store search, press, word of mouth.
- **referral** — a friend shared their invite link.
- **paid_search** — Google Search ads.
- **paid_social** — Instagram, Facebook, and TikTok ads.
- **coupon_affiliates** — coupon and deal websites. Forkfly pays the partner site for each signup it sends, and the customer gets `DEAL15` on their first order.

Daily spend for the three paid channels is in the warehouse table `marketing_spend_daily`.

## Goals for the period (Q3 2026)

Leadership set these goals for the quarter:

1. **Repeat ordering.** Grow the share of new customers who order again within 30 days. The growth team believes the first order experience matters.
2. **On-time delivery.** Market operations wants to understand which cities and days have the most late deliveries, and why.
3. **Bigger baskets.** The product team is testing Smart Add-ons on the checkout screen and wants a ship decision.
4. **Efficient acquisition.** Finance asked which paid channel is worth its cost, including the coupon affiliate program.
5. **Grow Forkfly Pass.** The membership team wants to know what makes a free trial turn into a paid membership.
6. **Fee revenue without losing orders.** Finance raised the non-Pass service fee in August and asked whether it cost orders.
7. **Checkout conversion.** The product team wants to know where customers abandon between opening the app and placing an order.
