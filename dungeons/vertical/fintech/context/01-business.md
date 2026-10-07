# Penny Harbor: the business

## Who we are

Penny Harbor is a mobile bank for everyday Americans, launched in March 2023. The app is the whole bank: there are no branches. Deposits are held at a partner bank and FDIC-insured through it; Penny Harbor builds the product, runs operations and support, and owns the member relationship. The company has about 45 employees and roughly 10,000 members, and it is still growing quickly.

## How we make money

- **Card interchange.** Every Visa debit card purchase earns Penny Harbor a share of the merchant fee. This is the largest revenue line, so card spending matters.
- **Subscriptions.** Plus and Premium are monthly plans.
- **Instant transfer fees.** Standard transfers are free; instant transfers carry a small percentage fee.
- **Interest margin.** Penny Harbor earns interest on member deposits held at the partner bank and pays part of it back to members as APY on Pockets. The APY paid is a cost.

## What members do in the app

- **Open and fund an account.** A new member opens an account in the app, verifies their identity, and funds the account (from a linked bank, a debit card, a transfer from a friend, or a cash load at a retail store). The debit card can be used in Apple Pay or Google Pay right away.
- **Get paid.** Members can switch their paycheck, gig-platform payouts, or government benefits to Penny Harbor with direct deposit, either by connecting to their payroll provider in the app or by downloading a pre-filled form for their employer.
- **Spend.** The Visa debit card works in stores (chip or a mobile wallet), online, and at ATMs (free at HarborLink ATMs).
- **Check in.** Members open the app to check their balance, see transactions, and manage money.
- **Save.** Pockets are savings sub-accounts for goals (emergency, vacation, home, car, general). Pockets earn interest (APY); the rate depends on the plan. Members move money into Pockets by hand. Round-Ups (launched in July) add the spare change from card purchases automatically.
- **Send.** P2P transfers to friends and family, and transfers to external bank accounts. Standard transfers are free; instant transfers carry a fee.
- **Pay bills.** Bill Pay stores billers (rent, utilities, phone, internet, insurance, credit cards, streaming, loans). For each biller the member can pay by hand each month or turn on AutoPay so Penny Harbor pays it on the due date.
- **Float.** Members with direct deposit can take a fee-free cash advance before payday. It is repaid automatically from their next paycheck.
- **Budget.** Members create monthly budgets by spending category.
- **Invest.** Harbor Invest offers fractional stocks, ETFs, and bond funds.
- **Get help.** Members contact support by chat, in-app message, phone, or email.

## Plans

| Plan | Price | Pocket APY | Float limit | Support |
|---|---|---|---|---|
| Free | $0 | Base rate | $50 | Standard queue |
| Plus | $4.99 per month | Higher rate | $150 | Standard queue |
| Premium | $11.99 per month | Highest rate | $250 | Priority support queue |

Current and historical Pocket rates by plan are in the warehouse table `pocket_savings_daily` (column `apy_pct`). New members start on Free. Members upgrade from the plan comparison screen.

## Members

- **Segments** (`customer_segment`), assigned by the data team from onboarding answers and early account behavior:
  - `everyday` — salaried members who use Penny Harbor for day-to-day banking.
  - `tight_budget` — members living paycheck to paycheck with low balances.
  - `saver` — members who keep larger balances and save regularly.
  - `gig_worker` — members paid by gig platforms (rideshare, delivery, freelance), usually weekly.
  - `student` — college students and recent graduates.
- **Credit file** (`credit_history`): `established` (the applicant has a full file at the credit bureaus) or `thin_file` (little or no credit history).
- **Pay frequency** (`pay_frequency`): weekly, biweekly, or semimonthly for members with direct deposit; `none` otherwise.
- **Age band** (`age_band`): 18-24, 25-34, 35-44, 45-54, 55+.

## How members find us

New members arrive through one of six acquisition channels, recorded when they open their account:

- **organic** — app store search, word of mouth, press.
- **referral** — invited by an existing member.
- **paid_social** — ads on social platforms.
- **search_ads** — paid search ads.
- **app_store_ads** — paid placements in the app stores.
- **comparison_sites** — paid listings on bank-comparison websites.

The four paid channels run on automated bidding that the growth team manages. Daily spend by paid channel is in the warehouse table `paid_acquisition_daily`.

## Goals for the period (Q3 2026)

Leadership set these goals for the quarter:

1. **Become the primary account.** Grow the number of members with direct deposit. The growth team believes the first weeks after signup decide whether a new account becomes someone's main bank account.
2. **Spend acquisition money where it pays back.** The CFO asked which paid channels bring members who become primary-account customers, not just installs.
3. **Grow savings.** Launch Round-Ups, and run the Summer Saver Boost for paid-plan members. Finance asked what the boost cost and what it brought in.
4. **Fewer late bills.** Late bill payments cost members late fees and generate support contacts. Product is testing whether AutoPay should be the default.
5. **Make onboarding work for everyone.** Too many applicants start an account and never fund it.
6. **Support that earns Premium.** Premium promises faster help; the support lead wants proof.
7. **Card reliability.** Card spending is the largest revenue line, so any processor problem is a priority.
