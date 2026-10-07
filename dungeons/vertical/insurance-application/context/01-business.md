# Shieldstone Insurance: the business

## Who we are

Shieldstone Insurance is a digital personal-lines insurance company founded in 2019 and headquartered in Austin, Texas. It sells auto, homeowners, and renters insurance directly to consumers in twelve US states, through its website, its mobile apps, and an in-house team of phone sales and service representatives. It does not sell through independent agents or brokers. Shieldstone has about 6,500 customer households and writes roughly $15 million of premium a year. It has about 90 employees: product and engineering, underwriting and pricing, a claims team of about ten staff adjusters plus independent adjusters it hires for catastrophes, a billing and customer care team, and growth marketing.

The company's pitch is "insurance you can handle from your phone": a quote in minutes, a policy the same day, and claims handled online.

## Products

| Product | Term | Typical monthly premium | What it covers |
|---|---|---|---|
| Auto (`auto`) | 6 months | about $110-230 (median about $160) | Liability, collision, comprehensive (glass, hail, theft, animals), roadside assistance |
| Homeowners (`home`) | 12 months | about $100-250 (median about $150); highest in Florida and Louisiana | The house, belongings, liability; wind and hail, water damage, fire, theft |
| Renters (`renters`) | 12 months | about $13-26 | Belongings and liability for tenants |

- **Coverage tiers.** Every policy is sold at one of three tiers: `basic`, `standard`, or `premium` (higher limits, lower deductibles). Price depends on the state, the tier, and the customer's risk (driving record, vehicle, home age and construction).
- **Bundles.** Customers can hold an auto policy together with a homeowners or renters policy in one account. Shieldstone markets bundles to every auto customer. About a third of customers hold a bundle.
- **Renewals.** Policies renew automatically at the end of each term. Thirty days before the term ends Shieldstone sends a renewal notice with the new premium. The renewal premium is re-priced for every policy, so it can go up or down; the change depends on the state's loss costs, repair and rebuilding cost inflation, and the vehicle or home. A customer who does not want to renew cancels before the term ends.
- **Billing.** Customers pay monthly installments (most customers) or the whole term up front. Monthly installments are due on the policy's anniversary day each month. Customers can pay by **autopay** (card or bank account, drawn automatically on the due date) or pay each bill by hand on the website or app (card or bank transfer). The first payment is taken when the policy is bought.
- **Missed payments.** If an autopay draw fails, billing retries it automatically three days later. If a manual payment fails, the customer is reminded and can pay within the grace period. A policy with an unpaid bill is cancelled for nonpayment when the grace period runs out.
- **Claims.** Customers report a claim (first notice of loss) in the app or on the website, add photos, and submit it. A claims adjuster inspects the damage, agrees an estimate, and the claim is settled (paid or denied). Customers can check the claim status online. Since July 2026, eligible auto claims can use **Snap & Settle** (see 02-timeline.md). Some claims are also reported by phone to the in-house service representatives; those never touch the app.

## How shoppers find us

New shoppers arrive through one of five acquisition channels, recorded on their quote and on their profile:

- **search_ads** — paid search ads on Google and Bing for insurance keywords. Billed per click.
- **comparison_site** — insurance comparison websites, where a shopper compares prices from several insurers and clicks through to finish a quote with us. Comparison sites bill Shieldstone per lead (each shopper they send to our quote page).
- **social_ads** — paid ads on Instagram, Facebook, and TikTok. Billed per impression.
- **organic** — people who come to the website or app store directly, through press, or through unpaid search.
- **referral** — friends and family of existing customers who used a referral link.

Daily spend by paid channel is in the warehouse table `marketing_spend_daily`.

## Shoppers and customers

- **Shopping reasons.** The quote flow asks why the shopper is looking (`shopping_reason`): `switching` (already insured with another company), `life_change` (a new car, a new home, or a move), or `first_policy` (never had this kind of insurance). About half of shoppers are switching.
- **Products quoted.** Most shoppers quote auto (about 60%); the rest quote homeowners or renters. New customers start with one policy.
- **Existing customers** (about 5,900 on June 4) joined between 2021 and spring 2026. About 40% hold auto only, about a third hold a bundle, and the rest hold homeowners or renters only.
- **Age.** Most customers are 25-54; about 10% are under 25.
- **Regions.** Claims operations are organized in five regions: `gulf_coast` (Florida, Louisiana), `south` (Texas, Georgia, North Carolina, Tennessee), `midwest` (Ohio, Illinois, Michigan), `west` (Arizona, Colorado), and `northeast` (Pennsylvania). Texas and Florida are the largest states.

## Goals for the period (Q3 2026)

Leadership set these goals for the quarter:

1. **Grow new policies efficiently.** Lower the cost per policy sold. Finance wants to know which paid channel is worth its cost and whether the fall social campaign paid off.
2. **A better quote.** The product team is testing a shorter quote flow (Express Quote) and wants a ship-or-kill decision.
3. **Faster claims.** The claims team launched Snap & Settle for auto claims and wants a read on whether it is working. Hurricane season (June to November) is the biggest operational risk; leadership wants to understand how the claims team held up.
4. **Price adequacy.** Pricing filed a new auto rate plan to restore auto margins; leadership asked whether it cost too many sales.
5. **Retention at renewal.** Keep more customers at renewal. The retention team wants to know what drives customers to leave at renewal.
6. **Fewer nonpayment cancellations.** Billing wants to know whether to push autopay harder.
