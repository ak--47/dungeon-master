# Ledgerline: the business

## Who we are

Ledgerline is a crypto exchange and wallet app for everyday investors. The company was founded in 2022, is based in Denver, and has about 45 employees. Most customers live in the United States; the rest are spread across about 40 other countries. About 10,000 customers use the app in a typical quarter. Ledgerline is mobile-only: customers use the iOS app (iPhone and iPad) or the Android app.

## What customers do in the app

- **Sign up and verify.** A new customer creates an account (email, Google, Sign in with Apple on iOS, or phone number), then completes identity verification: they photograph an ID document (driver's license, passport, or national ID) and take a selfie. Regulation requires verification before a customer can deposit money. An outside identity verification vendor runs the checks.
- **Fund the account.** Customers deposit by bank transfer, debit card, crypto transfer from another wallet, or wire. An account with at least one completed deposit is a **funded account**.
- **Buy with Simple Buy.** The simplest way to buy one coin (BTC, ETH, SOL, DOGE, XRP) with the cash balance, a debit card, or a linked bank account. Fee: 1.49% of the order, minimum $0.99.
- **Trade on Advanced Trade.** An order book with market and limit orders on BTC, ETH, SOL, XRP, DOGE, ADA, AVAX, LINK, and, from August 5, ONDO. Fees: 0.25% for limit (maker) orders and 0.40% for market (taker) orders. Advanced Trade is in the same app as Simple Buy.
- **Recurring buys.** A customer schedules an automatic purchase of BTC, ETH, or SOL (daily, weekly, every two weeks, or monthly) for a fixed dollar amount. Ledgerline's servers run each purchase on schedule until the customer cancels the plan. Fee: 0.99%, minimum $0.49.
- **Earn (staking).** Customers stake ETH, SOL, ADA, or AVAX to earn network rewards. Ledgerline keeps a commission on rewards and shows the customer the net annual yield (APY) when they stake. Customers can request to unstake at any time.
- **Price alerts.** Customers set an alert for a coin to move above or below a threshold; Ledgerline sends a push notification when it fires.
- **Withdraw.** Customers send BTC, ETH, SOL, USDC, or USDT to an outside wallet over the bitcoin, ethereum, solana, base, or tron network. The customer pays the network fee, which depends on how busy the network is.
- **Other.** Customers read market news in the app and share a referral link with friends.

## How we make money

- Trading fees on Simple Buy, Advanced Trade, and recurring buys.
- Staking commission: a share of the rewards earned by staked coins.
- Ledgerline does not charge for deposits or for its own side of withdrawals.

## Customers

- **Investor type** (`investor_type` on the profile), set from the sign-up questionnaire and early activity:
  - `casual_investor` — buys now and then, mostly with Simple Buy; the largest group.
  - `active_trader` — trades often on Advanced Trade, larger orders.
  - `crypto_native` — experienced with wallets and staking; trades regularly and moves coins on and off the platform.
- **Tenure.** Established customers joined between 2020 and June 2026 (`customer_since`). New customers joined in the window.
- **Verification status** (`kyc_status`): `verified`, `pending` (started but not finished), or `not_started`.

## How customers find us

New customers arrive through one of six acquisition channels, recorded at sign-up:

- **organic** — app store search, word of mouth, press.
- **referral** — invited by a friend's referral link.
- **paid_search** — search ads.
- **paid_social** — ads on social platforms.
- **influencer_affiliate** — crypto creators and affiliate sites.
- **app_store_ads** — search ads inside the app stores.

The four paid channels bill every day. Daily spend by paid channel is in the warehouse table `paid_marketing_daily`.

## Goals for the period (Q3 2026)

Leadership set these goals for the quarter:

1. **Grow funded accounts.** Too many new sign-ups never finish identity verification or never deposit. The onboarding team moved identity verification to a new vendor in July.
2. **Spend acquisition money well.** Marketing expanded influencer and affiliate partnerships this year. Finance asked which paid channels are worth their cost.
3. **Build habits early.** The growth team wants to know which early actions go with new customers staying. They are debating which action to promote in onboarding messages.
4. **Lift Simple Buy conversion.** Product is testing a shorter buy flow ("One-Tap Buy").
5. **Grow staking revenue.** Finance raised the staking commission in August. Leadership asked whether customers reacted.
6. **Run reliably.** Keep deposits, buys, and withdrawals working through market swings and network problems.
7. **Expand the asset list.** ONDO was the quarter's new listing.
