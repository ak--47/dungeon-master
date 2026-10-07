# Routewise Freight: the business

## Who we are

Routewise Freight is a digital truckload broker founded in 2019 and based in Chicago. Shippers come to Routewise to move full truckloads; Routewise does not own trucks. It matches each booked load with a carrier from a network of about 14,000 vetted trucking companies, tracks the load, and bills the shipper. The company has about 210 employees: carrier sales and operations, shipper account management, a pricing desk, customer support, engineering, and marketing.

In the summer of 2026 Routewise moves roughly 11,500 to 14,000 loads a month, with gross billings of about $33-43 million a month. Routewise earns the difference between what the shipper pays and what the carrier is paid (gross margin). Historically that margin has been about 15% of billings.

## How a load moves through Routewise

1. **Quote.** A shipper user enters a lane (origin and destination region), equipment, weight, and the desired pickup timing in the portal. Routewise returns a price for the whole load. The pricing desk sets quote prices from the day's spot market benchmark plus a margin, so quotes for the same lane can sit closer to or further from the market. Shippers often price several loads in one sitting.
2. **Book.** If the shipper accepts, they book the load. Most bookings follow a short negotiation with the shipper's Routewise rep (by chat, email, or phone), so a booking can come minutes, hours, or a day or two after the quote. When booking, the shipper can schedule a dock appointment for pickup.
3. **Cover.** Routewise's carrier sales team finds a carrier and assigns the load ("covering" it).
4. **Pick up.** The carrier picks up the load on a business day one to three days after booking.
5. **In transit.** The shipper follows the load in the portal or from a tracking link. Carriers report exceptions (mechanical problems, weather, missed appointments, and others).
6. **Deliver.** The carrier delivers the load. Routewise records whether it arrived on time against the delivery appointment.
7. **Accessorials.** Extra charges added after delivery: detention (the driver waited at the dock beyond the free time), lumper fees (paid labor to unload), and layover (the driver had to wait overnight).
8. **Invoice.** The shipper pays the invoice for the load plus accessorials, on their payment terms.

Equipment types:

- **Dry van** (`dry_van`) — the standard enclosed trailer for packaged goods. Most of our loads.
- **Reefer** (`reefer`) — refrigerated trailer for food and temperature-sensitive goods.
- **Flatbed** (`flatbed`) — open trailer for building materials, machinery, and steel.

## Customers

Routewise customers are shipping companies; the people who use the portal are their logistics coordinators and transportation managers. Each portal user belongs to one customer, and their profile carries the customer's attributes.

| Tier (`company_tier`) | Who they are | Annual freight spend band | Payment terms | Typical credit limit |
|---|---|---|---|---|
| `enterprise` | National shippers with a transportation team | `over_10m` | `net_45` | $250k-$1.5M |
| `mid_market` | Regional manufacturers and distributors | `1m_to_10m` | `net_30` | $50k-$250k |
| `small_business` | Small manufacturers, e-commerce sellers, local distributors | `under_1m` | `net_21` | $10k-$50k |

About 15% of portal users are at enterprise customers, 35% at mid-market, and 50% at small businesses. Enterprise users are the most active.

- **Industries** (`industry`): retail, food_beverage, manufacturing, building_materials, consumer_goods, automotive, chemicals. Food and beverage shippers mostly use reefers; building materials mostly flatbeds; everyone else mostly dry vans (`primary_equipment`).
- **Home region** (`home_region`): where the customer's main shipping facility is. Most of a customer's loads start there.
- **Saved lanes:** shippers can save the lanes they ship regularly so they can price and book them faster. The onboarding flow asks new shippers to save their first lane.

## Becoming a customer

A new shipper creates an account, can save a first lane, and submits a credit application. Routewise's credit team reviews every application (business history, trade references, payment risk); approval usually comes within a day. A shipper cannot book a load until credit is approved. Shippers who are not approved can still look up market rates in the portal.

## How shippers find us

New shippers arrive through one of five acquisition channels, recorded at signup:

- **organic** — search, word of mouth, and freight industry press.
- **referral** — another shipper or a carrier referred them.
- **google_ads** — paid search ads on Google.
- **linkedin_ads** — paid ads on LinkedIn aimed at logistics and supply chain managers.
- **trade_media** — sponsored placements in freight industry newsletters and websites.

The three paid channels bill daily. Daily spend by paid channel is in the warehouse table `paid_marketing_daily`.

## Goals for the period (Q3 2026)

Leadership set these goals for the quarter:

1. **Grow loads at a healthy margin.** Finance tracks gross margin against the historical 15% of billings and asked the product team to report what the Instant Book test does to margin as well as to bookings.
2. **Win more quotes.** Sales and pricing regularly debate how much a quote's distance from the market matters, and want a number they can use.
3. **Cut support load.** Support asked whether Live ETA reduced the calls and tickets it was built for.
4. **Activate new shippers.** Too many signups never book a load. The growth team wants to know where they drop and what the shippers who stick around do differently in their first weeks.
5. **Efficient acquisition.** Finance asked which paid channel is worth its cost.
6. **Service quality.** Operations reports on-time delivery and time to cover every week and wants to know what drives accessorial charges.
7. **Keep new customers.** Customer success wants to understand why some new shippers stop after their first loads.
