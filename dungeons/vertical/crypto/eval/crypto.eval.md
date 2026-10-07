# Ledgerline (crypto) — 20-question eval

- **Data:** `data/verify-crypto` (full fidelity: 10,000 users, 9,991 with events, 3,968 new sign-ups, 1,255,014 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query in `dungeons/vertical/crypto/crypto.sql` on that data.
- **Stories:** ids refer to the `stories` export in `crypto.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Does the market drive our trading?
- **Prompt:** "How much of our Advanced Trade activity is just the crypto market moving? Do people trade more on volatile days, and how much more?"
- **Type:** external-join
- **Answer:** Yes, strongly. On the 10 days when BTC realized volatility in `market_prices_daily` was 4.5% or higher, customers made **0.569 Advanced Trade fills per active customer vs 0.309 on the 103 calm days** (below 3.0%), about **1.84x**; the 7 middle days sit at 0.357 (1.16x). Across all 120 days, trades per active customer correlate 0.95 with BTC volatility. The busiest day was the September 9 drawdown (0.80 per active customer, 2,035 fills). Simple Buy does not follow the market: 0.285 orders per active customer on volatile days vs 0.286 on calm days (correlation 0.05). Accept a ratio of 1.65-2.05 and the Simple Buy contrast.
- **Evidence:** H1-volatility-drives-trading; Insights, `trade executed` total and daily unique active customers (any event except `price alert triggered`, `recurring buy executed`, `withdrawal confirmed`), daily, exported and joined to `market_prices_daily` (asset BTC, `realized_vol_pct`); `-- EVAL Q1`.
- **Context needed:** 04-metrics-and-tables.md (`market_prices_daily`, volatility thresholds, active customer), 02-timeline.md (market-moving days).
- **Grading:** must join the warehouse volatility (or the dated market days) to a per-active-customer trading rate and give a size. Other volatility splits or a regression are fine if they show the same strong relationship. Full credit notes that Simple Buy does not move. Wrong: raw daily trade counts without normalizing; "no relationship"; attributing the spikes to Ledgerline launches.

### Q2 — What went wrong with withdrawals in July?
- **Prompt:** "Support says customers complained about stuck withdrawals in late July. What happened, who was affected, and how bad was it?"
- **Type:** external-join
- **Answer:** Ethereum-network withdrawals failed during the **2026-07-20 to 07-22 Ethereum congestion**. Only **127 of 314 (40.4%)** ethereum-network withdrawals submitted on those days confirmed, vs **97.7%** in the 7 days either side; bitcoin, solana, base, and tron stayed at 93.3%-96.3% on those days (96.8%-97.8% around them). The ones that did confirm took a median **27.6 minutes vs 3.5**, and customers paid **$9.74 vs $1.65** average network fee (about 5.9x). The warehouse matches: `chain_network_daily` shows `network_status = congested` for ethereum on exactly those three days, with `failed_broadcast_rate` 0.61 and an average network fee of $7.76-$11.32 (vs about $1.4-$1.9). Relative to other networks, ethereum's confirmation rate fell to 0.42x of normal. 187 withdrawals never confirmed. Accept an ethereum success rate of 35%-47% vs about 97%, and naming the ethereum network.
- **Evidence:** H2-ethereum-congestion-withdrawals; Funnels, `withdrawal submitted` → `withdrawal confirmed`, totals, hold `withdrawal_id` constant, breakdown `network`, daily; join `chain_network_daily`; `-- EVAL Q2`.
- **Context needed:** 02-timeline.md (incident dates), 04-metrics-and-tables.md (`chain_network_daily`), 03-event-dictionary.md (confirmed vs submitted).
- **Grading:** must isolate the ethereum network and the three days, and quantify the confirmation drop. Wrong: blended withdrawal success across all networks (it hides the problem); unique-user funnels (most customers confirm some withdrawal); blaming Ledgerline systems.

### Q3 — Did the new identity verification vendor help?
- **Prompt:** "We switched KYC vendors on July 28. Did onboarding get better? Faster?"
- **Type:** funnel
- **Answer:** Yes, both. Of sign-ups before July 28, **40.1%** finished onboarding (account created → identity verification started → identity verified → deposit completed) within 7 days; of sign-ups from July 28 through September 23, **56.8%** did, about **1.41x** (1,799 vs 1,880 sign-ups). Verification approval rose most (59.1% → 71.0% of sign-ups verified within 7 days; 80.3% → 85.0% started). The median time from sign-up to first deposit fell from **29.9 hours to 10.4 hours (0.35x)**, and the verification step itself from 10.0 to 3.5 hours. The gain holds for influencer/affiliate sign-ups (21.3% → 33.1%) and for everyone else (44.3% → 61.4%). Accept a lift of 1.25x-1.45x (or +12 to +20 points) and a time ratio of 0.30-0.40.
- **Evidence:** H3-kyc-vendor-switch; Funnels, the four onboarding steps, 7-day window, conversion and median time to convert, sign-ups before vs from 2026-07-28 (breakdown by `customer_since` or a date filter on the first step); `-- EVAL Q3`.
- **Context needed:** 02-timeline.md (switch date, defined by sign-up date), 04-metrics-and-tables.md (onboarding completion, 7-day window).
- **Grading:** must compare cohorts by sign-up date and report both conversion and time. Wrong: comparing all onboarding events before vs after by event date; including late-September sign-ups without a full window; claiming no change.

### Q4 — What early behavior predicts that a new customer sticks around?
- **Prompt:** "Is there something new customers do in their first couple of weeks that predicts whether they're still around a month later? We want to push it in onboarding emails."
- **Type:** retention
- **Answer:** **Setting up a recurring buy in the first 14 days.** Among funded new customers who signed up through August 25, those with a recurring buy plan in their first 14 days had **79.3% day-30 retention** (an `app opened` in days 30-36) vs **34.5%** for those without, about **2.30x** (477 vs 766 customers). It is not just that keen customers set up plans: day-7 retention is the same for both groups (88.5% vs 88.8%); the groups split after the first three weeks. Other early actions matter far less: making an Advanced Trade fill (58.7% vs 44.2%), staking (52.4% vs 51.4%), or setting a price alert (51.5% vs 51.7%). 38.4% of funded new customers set up a plan in their first 14 days. Accept 2.0x-2.6x for recurring buys and naming recurring buys as the strongest signal.
- **Evidence:** H4-recurring-buy-retention; build the cohort in Funnels (`account created` → `recurring buy created`, 14-day window, save converters), then Retention, `account created` → `app opened`, custom bracket day 30-36 (and 7-13), breakdown by that cohort, filter cohort "did `deposit completed`"; `-- EVAL Q4`.
- **Context needed:** 00-manifest.md (server-side events; why `app opened` is the return event), 04-metrics-and-tables.md (retention definition).
- **Grading:** must use a customer-initiated return event. Wrong: Retention with "any event" as the return (recurring-buy executions are server-side and keep plan holders "active" by construction, inflating the gap); including customers who never funded; citing day-7 only.

### Q5 — Should we ship One-Tap Buy?
- **Prompt:** "Is the One-Tap Buy test working? Should we roll it out?"
- **Type:** funnel
- **Answer:** Yes. Since July 8, **71.7%** of One-Tap Simple Buy orders completed vs **59.2%** in Control (about **1.21x**; 29,023 vs 28,682 orders from 3,735 vs 3,645 customers, a 50/50 split). Completed orders took a median **270 seconds vs 450** (0.60x). With this many orders the difference is far beyond noise. Accept 1.15x-1.27x completion and a faster time to complete.
- **Evidence:** H5-one-tap-buy-experiment; Funnels, `quick buy started` → `quick buy completed`, totals, hold `order_id` constant, breakdown user property `Experiment: One-Tap Buy`, 1-day window; or Mixpanel Experiments report on `$experiment_started`; `-- EVAL Q5`.
- **Context needed:** 02-timeline.md (test design), 03-event-dictionary.md (`order_id`, exposure event).
- **Grading:** must measure per order (or per exposed customer) by variant. Wrong: a unique-customer funnel (nearly every customer completes at least one order in both arms); comparing before vs after July 8.

### Q6 — Which paid channel is worth the money?
- **Prompt:** "Influencer and affiliate deals bring the cheapest sign-ups. Are they actually our best paid channel?"
- **Type:** external-join
- **Answer:** No. For sign-ups June 4-September 23 and the same days' spend from `paid_marketing_daily`: **influencer_affiliate costs $42.26 per sign-up**, the cheapest (app store ads $50.33, paid social $57.66, paid search $67.81), but only **27.1%** of its sign-ups fund their account within 7 days vs **51.5%-55.4%** for the other paid channels (about **0.50x** paid search). Per funded account it is the **most expensive: $156.01**, vs $124.01 paid search, $104.04 paid social, and $97.66 app store ads. Over the whole window, spend per sign-up is $41.92 influencer vs $67.84 paid search (0.62x). Accept the reversal (cheapest per sign-up, most expensive per funded account) with cost per funded account within ±10%.
- **Evidence:** H6-paid-channel-quality; Insights `account created` by `acquisition_channel` joined to `paid_marketing_daily.spend_usd`; Funnels onboarding steps (7-day window) by `acquisition_channel`; `-- EVAL Q6`.
- **Context needed:** 04-metrics-and-tables.md (CAC and cost per funded account definitions, table), 01-business.md (channels).
- **Grading:** must combine spend with a quality metric (funded rate or later activity). Wrong: ranking by cost per sign-up alone; using `platform_reported_signups` as the denominator.

### Q7 — How did customers react to the September drawdown?
- **Prompt:** "Did our customers panic sell during the September 9 crash? Was it everyone?"
- **Type:** segmentation
- **Answer:** Mostly new customers. On September 9-11, **72.5%** of Advanced Trade fills by customers who joined in the window were sells vs **45.8%** in the 28 days before (1.58x; 599 fills by 185 customers). Established customers barely moved: **49.2% vs 45.2%** sells (1.09x; 4,204 fills). Across everyone, the daily sell share was 54.0%, 50.0%, and 51.7% on September 9, 10, and 11, vs 43%-45% on the days around. Trading volume also spiked on those days (Q1). Accept new-customer sell share of 65%-78% vs established near 50%, and the split by tenure.
- **Evidence:** H7-drawdown-panic-selling; Insights, `trade executed`, breakdown `side` and user property `customer_since` (before / from 2026-06-04), daily, % of total; `-- EVAL Q7`.
- **Context needed:** 02-timeline.md (drawdown dates), 00-manifest.md (new vs established definition).
- **Grading:** must split by tenure and compare with a baseline sell share. Wrong: only the blended sell share ("people sold a little more"); counting trades without the side mix.

### Q8 — Did the staking commission increase hurt staking?
- **Prompt:** "We raised our staking commission from 15% to 25% on August 19. Did customers react?"
- **Type:** trend
- **Answer:** Yes. Among established customers (a fixed population), new stakes fell from **2,184 in the 21 days before to 1,654 in the 21 days after (0.76x)** and stayed low (1,630 in September 9-29). Unstake requests jumped from **1,246 to 2,251 (1.81x)**, then returned close to normal (1,322 in September 9-29): a three-week outflow. The APY shown on new ETH stakes fell from 3.06% to 2.71% (0.885x; the same ratio for SOL, ADA, and AVAX). New customers show the same direction (stakes 248 → 188, unstakes 69 → 154). Accept stakes down 20%-30% and unstakes up 60%-100% for about three weeks.
- **Evidence:** H8-staking-commission-change; Insights, `stake started` and `unstake requested` totals, weekly, filter `customer_since` before 2026-06-04; average `apy_pct` on `stake started` by `asset`; `-- EVAL Q8`.
- **Context needed:** 02-timeline.md (change date), 01-business.md (commission model), 04-metrics-and-tables.md (comparing a fixed population).
- **Grading:** must compare equal windows and report both stakes and unstakes. Full credit notes the unstake surge faded after about three weeks. Wrong: "no effect" from all-customer weekly totals without noticing the unstake spike.

### Q9 — Why did Simple Buy completions dip in late August?
- **Prompt:** "Simple Buy conversion dropped for a few days at the end of August. What happened?"
- **Type:** funnel
- **Answer:** An Android problem. On **August 26-28** (Android 5.12, released August 26 and fixed by 5.12.1 on August 29), Android Simple Buy orders completed at **34.2%** (358 of 1,047) vs **65.4%** in the 7 days either side. iOS (64.3% vs 65.4%) and iPadOS (63.2% vs 66.2%) were normal. Relative to Apple devices, Android completion was 0.54x of normal; about 330 Android orders were lost. Completion recovered on August 29. Accept Android at 28%-38% on those days, iOS normal, and the link to the 5.12 release.
- **Evidence:** H9-android-simple-buy-bug; Funnels, `quick buy started` → `quick buy completed`, totals, hold `order_id` constant, breakdown `os`, daily; `-- EVAL Q9`.
- **Context needed:** 02-timeline.md (release and hotfix dates).
- **Grading:** must break down by platform and tie the dates to the release. Wrong: blaming the One-Tap test (both arms dipped on Android only); "market conditions".

### Q10 — How is ONDO doing?
- **Prompt:** "We listed ONDO in August. Is anyone trading it?"
- **Type:** trend
- **Answer:** Yes. ONDO ramped over its first ten days (3.9% of Advanced Trade fills on August 5-14) and has held about **7.5% of fills** since August 15 (7.4% of notional), traded by **1,154 of 4,693** Advanced Trade customers (25%) in that period. There were no ONDO fills before the listing. ONDO's market price fell 53% over the window (`market_prices_daily`), so its dollar volume share is not driven by price gains. Accept 6.5%-8.5% of fills after the ramp.
- **Evidence:** H10-ondo-listing; Insights, `trade executed`, breakdown `asset`, daily, % of total; `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (listing date and scope).
- **Grading:** must give a share of trading after launch (not a raw count) and the ramp. Wrong: looking for ONDO in Simple Buy or staking (not offered).

### Q11 — Did the new vendor change first-deposit size? (null)
- **Prompt:** "Since the KYC vendor switch, are new customers making bigger or smaller first deposits?"
- **Type:** null-hypothesis
- **Answer:** **No meaningful change.** The median first deposit is **$121.50 for sign-ups before July 28 and $120.00 from July 28** (mean $171.45 vs $184.99, pulled by a few large deposits; 722 vs 1,217 funded customers); the difference in log amount is noise (z = 0.43). The same holds within each platform and each deposit method (all |z| < 1.2). Across the six acquisition channels one split (referral, z = 2.4) crosses p < 0.05, which is what chance gives among 13 comparisons. The vendor changed how many customers fund and how fast, not how much they deposit. Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q11`; Insights, `deposit completed` first time per customer (or a funnel to the first deposit), median `amount_usd`, by sign-up before / from 2026-07-28.
- **Context needed:** 02-timeline.md.
- **Grading:** must check the data and call it flat. Wrong: "bigger deposits" or "smaller deposits" from a few-dollar difference.

### Q12 — Do Sign in with Apple customers drop out of onboarding? (null)
- **Prompt:** "Our iOS lead thinks people who sign up with Apple ID are less committed and drop out in KYC. Is that true?"
- **Type:** null-hypothesis
- **Answer:** **No.** 7-day onboarding completion is **49.5% for Apple sign-ups vs 48.5% for every other method** (495 vs 3,184 sign-ups through September 23; z = 0.42). Apple sign-in exists only on iOS and iPadOS, so the fair comparison is within those platforms: iOS 52.0% vs 47.6% (z = 1.37, not significant) and iPadOS 44.9% vs 46.2% (z = -0.3). Before and after the vendor switch the gap is also noise (42.6% vs 39.7%; 56.2% vs 56.8%). Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q12`; Funnels, onboarding steps, 7-day window, breakdown `signup_method` (optionally filtered to iOS / iPadOS).
- **Context needed:** 03-event-dictionary.md (Apple sign-in on iOS only), 04-metrics-and-tables.md.
- **Grading:** must check the data and treat the differences as noise. Wrong: "Apple users complete less"; "Apple users complete more" from the iOS split without a significance check.

### Q13 — Q3 paid marketing spend
- **Prompt:** "How much did we spend on paid acquisition in Q3, and where did it go?"
- **Type:** context
- **Answer:** **$96,971** from July 1 to September 30 (`paid_marketing_daily`): paid search $33,817 (34.9%), paid social $23,660 (24.4%), influencer/affiliate $21,857 (22.5%), app store ads $17,636 (18.2%). Accept ±1%.
- **Evidence:** `-- EVAL Q13`; warehouse `paid_marketing_daily`, sum `spend_usd` by `acquisition_channel`, July 1-September 30.
- **Context needed:** 04-metrics-and-tables.md (table), 02-timeline.md (Q3 dates).
- **Grading:** must use the warehouse table and the calendar quarter. Wrong: using the whole 120-day window ($126,724); counting organic or referral.

### Q14 — Do the ad platforms over-report sign-ups?
- **Prompt:** "The ad platforms say they drove more sign-ups than Mixpanel shows. How far off are they, and which number should we use?"
- **Type:** external-join
- **Answer:** Platforms claim more sign-ups than Mixpanel records in every channel: **influencer/affiliate 998 vs 686 (1.46x)**, paid social 697 vs 541 (1.29x), app store ads 551 vs 464 (1.19x), paid search 706 vs 653 (1.08x), over the whole window. Using platform numbers makes influencer CAC look like $28.82 instead of $41.92. Finance uses Mixpanel sign-ups for CAC. Accept ratios within ±0.05.
- **Evidence:** `-- EVAL Q14`; `paid_marketing_daily.platform_reported_signups` vs Insights `account created` by `acquisition_channel`.
- **Context needed:** 04-metrics-and-tables.md (CAC definition and caveats).
- **Grading:** must compare per channel and recommend Mixpanel sign-ups. Wrong: treating platform numbers as truth.

### Q15 — How many new customers did we get, and how many funded?
- **Prompt:** "How many people signed up this period, and what share actually funded their account?"
- **Type:** trend
- **Answer:** **3,968 new sign-ups** (about 1,000 a month: June 4-30 882, July 1,033, August 996, September 1,030, October 1 27). **1,939 (48.9%)** funded within 7 days; funded rates were about 40%-42% for June and July sign-ups and about 56%-57% for August and September (the verification vendor changed on July 28). Every funded customer funded within 7 days of sign-up. Accept counts within ±1% and the step up after July.
- **Evidence:** `-- EVAL Q15`; Insights `account created` monthly; Funnels onboarding steps, 7-day window, by sign-up month.
- **Context needed:** 04-metrics-and-tables.md (funded rate), 02-timeline.md.
- **Grading:** must give sign-ups and a funded share; full credit notes the change after July 28. Wrong: counting profiles or all customers as sign-ups.

### Q16 — How do our investor types differ?
- **Prompt:** "Give me a quick profile of casual investors vs active traders vs crypto natives. How do they use the app?"
- **Type:** segmentation
- **Answer:** Per customer over the window: **active traders** (2,750) have 79.7 sessions, 21.5 Advanced Trade fills, 7.9 Simple Buys, 1.97 stakes, median fill $651; **crypto natives** (2,021) 54.0 sessions, 14.3 fills, 5.1 Simple Buys, 1.26 stakes, median fill $378; **casual investors** (5,220, the largest group) 26.3 sessions, 0.8 fills, 3.5 Simple Buys, 0.89 stakes, median fill $98. Casual investors live in Simple Buy; the other two drive Advanced Trade. Accept the ordering and values within ±10%.
- **Evidence:** `-- EVAL Q16`; Insights, events per user by user property `investor_type`.
- **Context needed:** 01-business.md (investor types).
- **Grading:** must quantify by type. Wrong: describing types from the business guide only, without data.

### Q17 — Incidents this quarter
- **Prompt:** "Were there any incidents or outages this quarter that affected customers? Give me the damage."
- **Type:** context
- **Answer:** Two. (1) **Ethereum network congestion, July 20-22:** 187 of 314 ethereum-network withdrawals (60%) never confirmed and network fees ran about 6x (Q2). (2) **Android 5.12, August 26-28:** 689 of 1,047 Android Simple Buy orders did not complete (34.2% completion vs about 65% normally; about 330 more than usual), fixed by 5.12.1 on August 29 (Q9). Ledgerline's own systems had no declared outage. Accept both incidents with dates and approximate impact.
- **Evidence:** H2, H9; `-- EVAL Q17`.
- **Context needed:** 02-timeline.md, 04-metrics-and-tables.md (`chain_network_daily`).
- **Grading:** must find both, including the Android one, which is not labeled an incident in the timeline. Wrong: listing the September drawdown as a Ledgerline outage.

### Q18 — Recurring buys from customers who stopped using the app
- **Prompt:** "How much of our recurring-buy volume comes from customers who don't even open the app anymore?"
- **Type:** segmentation
- **Answer:** A small share. In September, **3.5%** of the 10,374 recurring-buy executions belonged to customers with no `app opened` in the previous 30 days (86 of 2,178 customers with executions). Plans keep running until cancelled, so this group will grow if customers drift away. Accept 2%-5%.
- **Evidence:** `-- EVAL Q18`; Insights `recurring buy executed` in September by a cohort "did not do `app opened` in the last 30 days".
- **Context needed:** 00-manifest.md and 03-event-dictionary.md (executions are server-side).
- **Grading:** must use a customer-initiated activity signal. Wrong: using "any event" as activity (executions count themselves).

### Q19 — New-customer retention
- **Prompt:** "What's our day-7 and day-30 retention for new funded customers?"
- **Type:** retention
- **Answer:** For funded new customers who signed up through August 25 (1,243), **day-7 retention is 88.7%** and **day-30 retention is 51.7%** (an `app opened` in days 7-13 and 30-36 after sign-up). Accept ±2 points.
- **Evidence:** `-- EVAL Q19`; Retention, `account created` → `app opened`, custom brackets day 7-13 and 30-36, filter cohort "did `deposit completed`".
- **Context needed:** 04-metrics-and-tables.md (retention definition), 00-manifest.md (`app opened`).
- **Grading:** must use the bracket definition and a customer-initiated return event. Wrong: "any event" retention; including unfunded sign-ups without saying so.

### Q20 — What should we worry about going into Q4?
- **Prompt:** "Looking at Q3, what should leadership worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names several of these, with numbers: (1) **Market exposure:** coins fell over the window (BTC -11%, ETH -37%, ONDO -53%), customers withdrew more than they deposited every month (net about -$1.0M to -$1.4M a month), and trading swings with volatility (Q1). (2) **New-customer fragility:** new customers sold heavily in the September drawdown (72% sells, Q7), and funded new customers without a recurring buy retain at 34.5% by day 30 vs 79.3% with one (Q4); onboarding should push recurring buys. (3) **Acquisition quality:** influencer/affiliate is the most expensive channel per funded account ($156, Q6) and platforms over-report its sign-ups by 46% (Q14). (4) **Staking:** the commission increase cut new stakes about 24% and triggered a three-week unstake surge (Q8). (5) **Reliability:** an Android release cut Simple Buy completion in half for three days (Q9), and ethereum withdrawals depend on network conditions (Q2). Positives to keep: the new verification vendor (Q3) and One-Tap Buy (Q5).
- **Evidence:** `-- EVAL Q20` plus Q1-Q9, Q14.
- **Context needed:** all guides.
- **Grading:** must give at least three concerns backed by data. Wrong: generic crypto commentary without numbers; recommending more influencer spend because it is cheapest per sign-up.
