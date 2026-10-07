# Ledgerline (crypto) — 20-question eval

- **Data:** `data/verify-crypto` (full fidelity: 10,000 users, 9,919 with events, 4,010 new sign-ups, 1,351,820 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query in `dungeons/vertical/crypto/crypto.sql` on that data.
- **Stories:** ids refer to the `stories` export in `crypto.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Does the market drive our trading?
- **Prompt:** "How much of our Advanced Trade activity is just the crypto market moving? Do people trade more on volatile days, and how much more?"
- **Type:** external-join
- **Answer:** Yes, strongly. On the 12 days when BTC realized volatility in `market_prices_daily` was 4.5% or higher, customers made **0.551 Advanced Trade fills per active customer vs 0.310 on the 101 calm days** (below 3.0%), about **1.78x**; the 7 middle days sit at 0.382 (1.23x). Two of the 12 volatile days (June 29 and September 17) are not in the timeline's market notes; only the warehouse shows them. Across all 120 days, trades per active customer correlate 0.83 with BTC volatility. The busiest day was the September 9 drawdown (0.75 per active customer, 1,969 fills). Simple Buy does not follow the market: 0.295 orders per active customer on volatile days vs 0.296 on calm days. The 4.5% / 3.0% cut-offs are the answer key's choice; any reasonable split (terciles, top 10 days, the timeline's ten market days, a regression) shows the same strong relationship. Accept a high-vs-calm ratio of 1.6-2.0 (or an equivalent size for another split) and the Simple Buy contrast.
- **Evidence:** H1-volatility-drives-trading; Insights, `trade executed` total and daily unique active customers (any event except `price alert triggered`, `recurring buy executed`, `withdrawal confirmed`), daily, exported and joined to `market_prices_daily` (asset BTC, `realized_vol_pct`); `-- EVAL Q1`.
- **Context needed:** 04-metrics-and-tables.md (`market_prices_daily`, active customer), 02-timeline.md (market-moving days).
- **Grading:** must join the warehouse volatility (or the dated market days) to a per-active-customer trading rate and give a size. Other volatility splits or a regression are fine if they show the same strong relationship. Full credit notes that Simple Buy does not move. Wrong: raw daily trade counts without normalizing; "no relationship"; attributing the spikes to Ledgerline launches.

### Q2 — What went wrong with withdrawals in July?
- **Prompt:** "Support says customers complained about stuck withdrawals in late July. What happened, who was affected, and how bad was it?"
- **Type:** external-join
- **Answer:** Ethereum-network withdrawals failed during the **2026-07-20 to 07-22 Ethereum congestion**. Only **123 of 313 (39.3%)** ethereum-network withdrawals submitted on those days confirmed, vs **97.2%** in the 7 days either side; bitcoin, solana, base, and tron stayed at 94.3%-100% on those days (95.2%-97.4% around them). The ones that did confirm took a median **32.4 minutes vs 3.6**, and customers paid **$9.77 vs $1.64** average network fee (about 6.0x). The warehouse matches: `chain_network_daily` shows `network_status = congested` for ethereum on exactly those three days, with `failed_broadcast_rate` 0.61 and an average network fee of $7.76-$11.32 (vs about $1.4-$1.9). Relative to other networks, ethereum's confirmation rate fell to 0.41x of normal. 190 withdrawals never confirmed. Accept an ethereum success rate of 35%-45% vs about 97%, and naming the ethereum network.
- **Evidence:** H2-ethereum-congestion-withdrawals; Funnels, `withdrawal submitted` → `withdrawal confirmed`, totals, hold `withdrawal_id` constant, breakdown `network`, daily; join `chain_network_daily`; `-- EVAL Q2`.
- **Context needed:** 02-timeline.md (incident dates), 04-metrics-and-tables.md (`chain_network_daily`), 03-event-dictionary.md (confirmed vs submitted).
- **Grading:** must isolate the ethereum network and the three days, and quantify the confirmation drop. Wrong: blended withdrawal success across all networks (it hides the problem); unique-user funnels (most customers confirm some withdrawal); blaming Ledgerline systems.

### Q3 — Did the new identity verification vendor help?
- **Prompt:** "We switched KYC vendors on July 28. Did onboarding get better? Faster?"
- **Type:** funnel
- **Answer:** Yes, both. Of sign-ups before July 28, **41.8%** finished onboarding (account created → identity verification started → identity verified → deposit completed) within 7 days; of sign-ups from July 28 through September 23, **54.2%** did, about **1.30x** (1,855 vs 1,877 sign-ups). Verification approval rose most (62.5% → 69.1% of sign-ups verified within 7 days; 82.8% → 84.1% started). The median time from sign-up to first deposit fell from **30.1 hours to 10.5 hours (0.35x)**, and the verification step itself from 9.9 to 3.5 hours. The gain holds for influencer/affiliate sign-ups (25.7% → 31.1%) and for everyone else (45.3% → 59.3%). Accept a lift of 1.18x-1.42x (or +9 to +16 points) and a time ratio of 0.30-0.40.
- **Evidence:** H3-kyc-vendor-switch; Funnels, the four onboarding steps, 7-day window, conversion and median time to convert, sign-ups before vs from 2026-07-28 (breakdown by `customer_since` or a date filter on the first step); `-- EVAL Q3`.
- **Context needed:** 02-timeline.md (switch date, defined by sign-up date), 04-metrics-and-tables.md (onboarding completion, 7-day window).
- **Grading:** must compare cohorts by sign-up date and report both conversion and time. Wrong: comparing all onboarding events before vs after by event date; including late-September sign-ups without a full window; claiming no change.

### Q4 — What early behavior predicts that a new customer sticks around?
- **Prompt:** "Is there something new customers do in their first couple of weeks that predicts whether they're still around a month later? We want to push it in onboarding emails."
- **Type:** retention
- **Answer:** **Setting up a recurring buy in the first 14 days.** Among funded new customers who signed up through August 25, those with a recurring buy plan in their first 14 days had **81.2% day-30 retention** (an `app opened` in days 30-36) vs **36.1%** for those without, about **2.25x** (558 vs 786 customers). It is not just that keen customers set up plans: day-7 retention is about the same for both groups (94.3% vs 92.8%); the groups split after the first three weeks. Other early actions matter far less: making an Advanced Trade fill (58.6% vs 51.4%), staking (56.6% vs 54.4%), or setting a price alert (58.2% vs 54.3%). 41.5% of funded new customers set up a plan in their first 14 days. Accept 2.0x-2.6x for recurring buys and naming recurring buys as the strongest signal.
- **Evidence:** H4-recurring-buy-retention; build the cohort in Funnels (`account created` → `recurring buy created`, 14-day window, save converters), then Retention, `account created` → `app opened`, custom bracket day 30-36 (and 7-13), breakdown by that cohort, filter cohort "did `deposit completed`"; `-- EVAL Q4`.
- **Context needed:** 00-manifest.md (server-side events; why `app opened` is the return event), 04-metrics-and-tables.md (retention definition).
- **Grading:** must use a customer-initiated return event. Wrong: Retention with "any event" as the return (recurring-buy executions are server-side and keep plan holders "active" by construction, inflating the gap); including customers who never funded; citing day-7 only.

### Q5 — Should we ship One-Tap Buy?
- **Prompt:** "Is the One-Tap Buy test working? Should we roll it out?"
- **Type:** funnel
- **Answer:** Yes. Since July 8, **71.7%** of One-Tap Simple Buy orders completed vs **59.4%** in Control (about **1.21x**; 31,260 vs 31,838 orders from 3,633 vs 3,717 customers, a 50/50 split). Completed orders took a median **269 seconds vs 449** (0.60x). With this many orders the difference is far beyond noise. Accept 1.15x-1.27x completion and a faster time to complete.
- **Evidence:** H5-one-tap-buy-experiment; Funnels, `quick buy started` → `quick buy completed`, totals, hold `order_id` constant, 1-day conversion window, date range 2026-07-08 to 2026-10-01, breakdown user property `Experiment: One-Tap Buy`; or Mixpanel Experiments report on `$experiment_started`; `-- EVAL Q5`.
- **Context needed:** 02-timeline.md (test design), 03-event-dictionary.md (`order_id`, exposure event).
- **Grading:** must measure per order (or per exposed customer) by variant. Wrong: a unique-customer funnel (nearly every customer completes at least one order in both arms); comparing before vs after July 8.

### Q6 — Which paid channel is worth the money?
- **Prompt:** "Influencer and affiliate deals bring the cheapest sign-ups. Are they actually our best paid channel?"
- **Type:** external-join
- **Answer:** No. For sign-ups June 4-September 23 and the same days' spend from `paid_marketing_daily`: **influencer_affiliate costs $40.08 per sign-up**, the cheapest (app store ads $47.66, paid social $54.95, paid search $69.11), but only **28.4%** of its sign-ups fund their account within 7 days vs **50.1%-53.8%** for the other paid channels (about **0.53x** paid search). Per funded account it is the **most expensive: $141.21**, vs $128.44 paid search, $109.70 paid social, and $90.87 app store ads. Over the whole window, spend per sign-up is $39.86 influencer vs $69.58 paid search (0.57x). Accept the reversal (cheapest per sign-up, most expensive per funded account) with cost per funded account within ±10%.
- **Evidence:** H6-paid-channel-quality; Insights `account created` by `acquisition_channel` joined to `paid_marketing_daily.spend_usd`; Funnels onboarding steps (7-day window) by `acquisition_channel`; `-- EVAL Q6`.
- **Context needed:** 04-metrics-and-tables.md (CAC and cost per funded account definitions, table), 01-business.md (channels).
- **Grading:** must combine spend with a quality metric (funded rate or later activity). Wrong: ranking by cost per sign-up alone; using `platform_reported_signups` as the denominator.

### Q7 — How did customers react to the September drawdown?
- **Prompt:** "Did our customers panic sell during the September 9 crash? Was it everyone?"
- **Type:** segmentation
- **Answer:** Mostly new customers. On September 9-11, **73.1%** of Advanced Trade fills by customers who joined in the window were sells vs **45.3%** in the 28 days before (1.62x; 673 fills by 219 customers). Established customers moved much less: **49.2% vs 44.8%** sells (1.10x; 4,144 fills). Across everyone, the daily sell share was 52.7%, 52.0%, and 53.1% on September 9, 10, and 11, vs 44%-48% on the days around. Trading volume also spiked on those days (Q1). Accept new-customer sell share of 65%-80% vs established near 50%, and the split by tenure.
- **Evidence:** H7-drawdown-panic-selling; Insights, `trade executed`, breakdown `side` and user property `customer_since` (before / from 2026-06-04), daily, % of total; `-- EVAL Q7`.
- **Context needed:** 02-timeline.md (drawdown dates), 00-manifest.md (new vs established definition).
- **Grading:** must split by tenure and compare with a baseline sell share. Wrong: only the blended sell share ("people sold a little more"); counting trades without the side mix.

### Q8 — Did the staking commission increase hurt staking?
- **Prompt:** "We raised our staking commission from 15% to 25% on August 19. Did customers react?"
- **Type:** trend
- **Answer:** Yes. Among established customers (a fixed population), new stakes fell from **2,352 in the 21 days before to 1,758 in the 21 days after (0.75x)** and stayed low (1,736 in September 9-29). Unstake requests jumped from **1,368 to 2,237 (1.64x)**: weekly unstakes ran 452, 476, and 440 in the three weeks before, 791 and 784 in the first two weeks after, 662 in the third, then 468, 427, and 404, so the outflow lasted about three weeks and faded in the third. The APY shown on new ETH stakes fell from 3.06% to 2.71% (0.884x; about the same ratio for SOL, ADA, and AVAX). New customers show the same direction (stakes 304 → 269, unstakes 63 → 142). Accept stakes down 20%-30% and unstakes up 45%-85% over the three weeks after, fading back toward normal.
- **Evidence:** H8-staking-commission-change; Insights, `stake started` and `unstake requested` totals, weekly, filter `customer_since` before 2026-06-04; average `apy_pct` on `stake started` by `asset`; `-- EVAL Q8`.
- **Context needed:** 02-timeline.md (change date), 01-business.md (commission model), 04-metrics-and-tables.md (comparing a fixed population).
- **Grading:** must compare equal windows and report both stakes and unstakes. Full credit notes the unstake surge faded after about three weeks. Wrong: "no effect" from all-customer weekly totals without noticing the unstake spike.

### Q9 — Why did Simple Buy completions dip in late August?
- **Prompt:** "Simple Buy conversion dropped for a few days at the end of August. What happened?"
- **Type:** funnel
- **Answer:** An Android problem. On **August 26-28** (Android 5.12, released August 26 and fixed by 5.12.1 on August 29), Android Simple Buy orders completed at **34.1%** (360 of 1,056) vs **66.2%** in the 7 days either side (0.51x). iOS (64.0% vs 67.7%) and iPadOS (63.2% vs 67.8%) dipped only within their normal day-to-day range (daily iOS 62%-70%). Relative to Apple devices, Android completion was 0.55x of normal; about 340 Android orders were lost. Completion recovered on August 29. Accept Android at 29%-39% on those days, iOS about normal, and the link to the 5.12 release.
- **Evidence:** H9-android-simple-buy-bug; Funnels, `quick buy started` → `quick buy completed`, totals, hold `order_id` constant, breakdown `os`, daily; `-- EVAL Q9`.
- **Context needed:** 02-timeline.md (release and hotfix dates).
- **Grading:** must break down by platform and tie the dates to the release. Wrong: blaming the One-Tap test (both arms dipped on Android only); "market conditions".

### Q10 — How is ONDO doing?
- **Prompt:** "We listed ONDO in August. Is anyone trading it?"
- **Type:** trend
- **Answer:** Yes. ONDO ramped over its first ten days (4.6% of Advanced Trade fills on August 5-14) and has held about **8.2% of fills** since August 15 (8.5% of notional), traded by **1,234 of 4,775** Advanced Trade customers (26%) in that period. There were no ONDO fills before the listing. ONDO's market price fell 51% over the window (`market_prices_daily`), so its dollar volume share is not driven by price gains. Accept 7.2%-9.2% of fills after the ramp.
- **Evidence:** H10-ondo-listing; Insights, `trade executed`, breakdown `asset`, daily, % of total; `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (listing date and scope).
- **Grading:** must give a share of trading after launch (not a raw count) and the ramp. Wrong: looking for ONDO in Simple Buy or staking (not offered).

### Q11 — Does the ID document type change KYC approval? (null)
- **Prompt:** "Compliance thinks customers who verify with a passport get approved more often than people who use a driver's license or a national ID. Is that true?"
- **Type:** null-hypothesis
- **Answer:** **No.** Among sign-ups through September 23 who started identity verification within 7 days, the share verified within 7 days of sign-up is **78.6% for driver's licenses (1,607), 78.8% for passports (1,067), and 80.2% for national IDs (440)**; z = 0.14 (passport) and 0.76 (national ID) against driver's licenses. The same holds within each platform, verification vendor era, acquisition channel, and investor type: every split has |z| ≤ 1.21 (the largest is national IDs before July 28, 78.5% vs 74.7%, p ≈ 0.23). What changed approval was the vendor switch on July 28 (driver's licenses 74.7% → 82.4%), not the document type. Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q11`; Funnels, `identity verification started` → `identity verified`, 7-day window from sign-up (or `account created` → `identity verification started` → `identity verified`), breakdown `id_document_type`, sign-ups through 2026-09-23.
- **Context needed:** 03-event-dictionary.md (`id_document_type`), 02-timeline.md (vendor switch).
- **Grading:** must check the data and call it flat. Accept a mention of a small sub-split gap if the answer flags it as not significant. Wrong: "passports get approved more" (or less) from a gap of a point or two.

### Q12 — Do bank-transfer funders stick around better? (null)
- **Prompt:** "Growth wants to push bank transfers instead of debit cards for the first deposit, because they think bank funders are stickier. Do customers who first fund by bank transfer retain better at day 30?"
- **Type:** null-hypothesis
- **Answer:** **No.** Among funded new customers who signed up through August 25 (1,344), day-30 retention (an `app opened` in days 30-36) is **55.1% for bank-transfer first deposits (735) vs 53.3% for debit card (349)**, z = 0.56; against every other method combined (54.5%, 609) z = 0.22. Crypto transfer is 54.7% (201) and wire 61.0% (59, a small group). Within platforms, investor types, channels, and sign-up eras the bank-vs-card gap changes sign and none is significant (every split |z| ≤ 1.27; the largest is active traders, 63.4% vs 55.7%). The first deposit method does not predict retention. Accept "no meaningful difference" (and "no evidence that bank funders are stickier").
- **Evidence:** `-- EVAL Q12`; Retention, `account created` → `app opened`, custom bracket day 30-36, filter cohort "did `deposit completed`", breakdown `deposit_method` of the first deposit (cohorts per method), sign-ups through 2026-08-25.
- **Context needed:** 04-metrics-and-tables.md (retention definition), 00-manifest.md (`app opened` as the return event).
- **Grading:** must check the data and call it flat. Also accept "a small, non-significant difference" in either direction when the answer says it is not significant. Accept a mention of a sub-split if the answer flags it as noise (the signs disagree across splits). Wrong: "bank funders are stickier" (or "card funders are stickier") stated as a finding without a significance check; retention on "any event".

### Q13 — Q3 paid marketing spend
- **Prompt:** "How much did we spend on paid acquisition in Q3, and where did it go?"
- **Type:** context
- **Answer:** **$97,031** from July 1 to September 30 (`paid_marketing_daily`): paid search $32,940 (33.9%), paid social $23,892 (24.6%), influencer/affiliate $21,360 (22.0%), app store ads $18,840 (19.4%). Accept ±1%.
- **Evidence:** `-- EVAL Q13`; warehouse `paid_marketing_daily`, sum `spend_usd` by `acquisition_channel`, July 1-September 30.
- **Context needed:** 04-metrics-and-tables.md (table), 02-timeline.md (Q3 dates).
- **Grading:** must use the warehouse table and the calendar quarter. Wrong: using the whole 120-day window ($126,848); counting organic or referral.

### Q14 — Do the ad platforms over-report sign-ups?
- **Prompt:** "The ad platforms say they drove more sign-ups than Mixpanel shows. How far off are they, and which number should we use?"
- **Type:** external-join
- **Answer:** Platforms claim more sign-ups than Mixpanel records in every channel: **influencer/affiliate 993 vs 720 (1.38x)**, paid social 695 vs 560 (1.24x), app store ads 573 vs 495 (1.16x), paid search 694 vs 628 (1.11x), over the whole window. Using platform numbers makes influencer CAC look like $28.90 instead of $39.86. Finance uses Mixpanel sign-ups for CAC. Accept ratios within ±0.05.
- **Evidence:** `-- EVAL Q14`; `paid_marketing_daily.platform_reported_signups` vs Insights `account created` by `acquisition_channel`.
- **Context needed:** 04-metrics-and-tables.md (CAC definition and caveats).
- **Grading:** must compare per channel and recommend Mixpanel sign-ups. Wrong: treating platform numbers as truth.

### Q15 — How many new customers did we get, and how many funded?
- **Prompt:** "How many people signed up this period, and what share actually funded their account?"
- **Type:** trend
- **Answer:** **4,010 new sign-ups** (about 1,000 a month: June 4-30 914, July 1,080, August 1,003, September 988, October 1 25). **1,938 (48.3%)** funded within 7 days; funded rates were 42.9% for June sign-ups, 42.5% for July (the verification vendor changed on July 28), 55.7% for August, and 52.8% for September; late-September and October 1 sign-ups have not had a full 7 days. By the end of the window **1,989** had funded: 51 customers (2.6% of funders) made their first deposit after day 7 (median day 17, latest day 42). Accept counts within ±1% and the step up after July.
- **Evidence:** `-- EVAL Q15`; Insights `account created` monthly; Funnels onboarding steps, 7-day window, by sign-up month.
- **Context needed:** 04-metrics-and-tables.md (funded rate), 02-timeline.md.
- **Grading:** must give sign-ups and a funded share; full credit notes the change after July 28. Wrong: counting profiles or all customers as sign-ups.

### Q16 — How do our investor types differ?
- **Prompt:** "Give me a quick profile of casual investors vs active traders vs crypto natives. How do they use the app?"
- **Type:** segmentation
- **Answer:** Per customer over the window: **active traders** (2,771) have 86.7 sessions, 23.4 Advanced Trade fills, 8.6 Simple Buys, 2.12 stakes, median fill $644; **crypto natives** (1,986) 58.1 sessions, 14.9 fills, 5.5 Simple Buys, 1.33 stakes, median fill $384; **casual investors** (5,162, the largest group) 28.6 sessions, 0.8 fills, 3.9 Simple Buys, 0.97 stakes, median fill $99. Casual investors live in Simple Buy; the other two drive Advanced Trade. Accept the ordering and values within ±10%.
- **Evidence:** `-- EVAL Q16`; Insights, events per user by user property `investor_type`.
- **Context needed:** 01-business.md (investor types).
- **Grading:** must quantify by type. Wrong: describing types from the business guide only, without data.

### Q17 — Incidents this quarter
- **Prompt:** "Were there any incidents or outages this quarter that affected customers? Give me the damage."
- **Type:** context
- **Answer:** Two. (1) **Ethereum network congestion, July 20-22:** 190 of 313 ethereum-network withdrawals (61%) never confirmed and network fees ran about 6x (Q2). (2) **Android 5.12, August 26-28:** 696 of 1,056 Android Simple Buy orders did not complete (34.1% completion vs about 66% normally; about 340 more than usual), fixed by 5.12.1 on August 29 (Q9). Ledgerline's own systems had no declared outage. Accept both incidents with dates and approximate impact.
- **Evidence:** H2, H9; `-- EVAL Q17`.
- **Context needed:** 02-timeline.md, 04-metrics-and-tables.md (`chain_network_daily`).
- **Grading:** must find both, including the Android one, which is not labeled an incident in the timeline. Wrong: listing the September drawdown as a Ledgerline outage.

### Q18 — Recurring buys from customers who stopped using the app
- **Prompt:** "How much of our recurring-buy volume comes from customers who don't even open the app anymore?"
- **Type:** segmentation
- **Answer:** A small share. In September, **3.6%** of the 10,943 recurring-buy executions belonged to customers with no `app opened` in the previous 30 days (102 of 2,231 customers with executions). Plans keep running until cancelled, so this group will grow if customers drift away. Accept 2.5%-5%.
- **Evidence:** `-- EVAL Q18`; Insights `recurring buy executed` in September by a cohort "did not do `app opened` in the last 30 days".
- **Context needed:** 00-manifest.md and 03-event-dictionary.md (executions are server-side).
- **Grading:** must use a customer-initiated activity signal. Wrong: using "any event" as activity (executions count themselves).

### Q19 — New-customer retention
- **Prompt:** "What's our day-7 and day-30 retention for new funded customers?"
- **Type:** retention
- **Answer:** For funded new customers who signed up through August 25 (1,344), **day-7 retention is 93.4%** and **day-30 retention is 54.8%** (an `app opened` in days 7-13 and 30-36 after sign-up). Accept ±2 points.
- **Evidence:** `-- EVAL Q19`; Retention, `account created` → `app opened`, custom brackets day 7-13 and 30-36, filter cohort "did `deposit completed`".
- **Context needed:** 04-metrics-and-tables.md (retention definition), 00-manifest.md (`app opened`).
- **Grading:** must use the bracket definition and a customer-initiated return event. Wrong: "any event" retention; including unfunded sign-ups without saying so.

### Q20 — What should we worry about going into Q4?
- **Prompt:** "Looking at Q3, what should leadership worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names several of these, with numbers: (1) **Market exposure:** coins fell over the window (BTC -9%, ETH -37%, ONDO -51%) and trading swings with volatility (Q1). Customer money is not leaving: deposits exceeded withdrawals every month (net +$0.73M to +$0.91M a month, June-September). (2) **New-customer fragility:** new customers sold heavily in the September drawdown (73% sells, Q7), and funded new customers without a recurring buy retain at 36.1% by day 30 vs 81.2% with one (Q4); onboarding should push recurring buys. (3) **Acquisition quality:** influencer/affiliate is the most expensive channel per funded account ($141, Q6) and platforms over-report its sign-ups by 38% (Q14). (4) **Staking:** the commission increase cut new stakes about 25% and triggered a three-week unstake surge (Q8). (5) **Reliability:** an Android release cut Simple Buy completion in half for three days (Q9), and ethereum withdrawals depend on network conditions (Q2). Positives to keep: the new verification vendor (Q3) and One-Tap Buy (Q5).
- **Evidence:** `-- EVAL Q20` plus Q1-Q9, Q14.
- **Context needed:** all guides.
- **Grading:** must give at least three concerns backed by data. Wrong: generic crypto commentary without numbers; recommending more influencer spend because it is cheapest per sign-up; claiming customers are pulling money out (net deposits are positive every month).
