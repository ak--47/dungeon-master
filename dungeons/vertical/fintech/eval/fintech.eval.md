# Penny Harbor (fintech) — 20-question eval

- **Data:** `data/verify-fintech` (full fidelity: 10,000 members, 9,923 with events, 4,027 new accounts, 1,112,233 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query in `dungeons/vertical/fintech/fintech.sql` on that data.
- **Stories:** ids refer to the `stories` export in `fintech.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Where do applicants drop out of onboarding?
- **Prompt:** "A third of the people who open an account never fund it. Is that everyone, or is a particular group struggling?"
- **Type:** funnel
- **Answer:** **Thin-file applicants.** 7-day onboarding completion (account opened → identity verified → account funded) is **38.8% for `credit_history = thin_file`** (424 of 1,094) vs **73.1% for established files** (2,145 of 2,933), about **0.53x**; overall 63.8%. Thin files lose ground at both steps: 69.3% pass identity verification within 7 days (vs 87.1%), and only 56% of those verified go on to fund (vs 84%). Accept a ratio of 0.50-0.61 and naming the thin-file segment.
- **Evidence:** H1-thin-file-onboarding; Funnels, three onboarding steps, 7-day window, breakdown user property `credit_history`; `-- EVAL Q1`.
- **Context needed:** 03-event-dictionary.md (onboarding events, `credit_history`), 04-metrics-and-tables.md (onboarding completion).
- **Grading:** must break down by credit file and quantify the gap. Wrong: blaming acquisition channel or signup method; reporting only the overall rate.

### Q2 — How long does it take to get funded?
- **Prompt:** "How long does it take a new member to go from opening the account to having money in it?"
- **Type:** funnel
- **Answer:** Among members who fund within 7 days, the **median is 3.8 hours** (2,569 members), with a long right tail (90th percentile 25.7 hours). It splits sharply by credit file: **established files median 3.0 hours** (90th percentile 9.2 hours) vs **thin files median 29.5 hours** (90th percentile 77.4 hours, more than three days), about 10x slower. The `kyc_method` on `identity verified` shows why: thin-file applicants go through `document_scan` review, and most of their wait comes before `identity verified`. Accept medians within ±10%, the established/thin split, and a note that the distribution is skewed.
- **Evidence:** H1 (declared onboarding timing); Funnels, onboarding steps, median time to convert, breakdown `credit_history`; `-- EVAL Q2`.
- **Context needed:** 03-event-dictionary.md (`kyc_method`), 04-metrics-and-tables.md (time to fund).
- **Grading:** must report a median (or note the skew) and the split by credit file. Wrong: a single average with no segmentation.

### Q3 — What predicts that a new member sticks around?
- **Prompt:** "Is there something new members do in their first couple of weeks that predicts whether they're still with us a month later?"
- **Type:** retention
- **Answer:** **Setting up direct deposit within 14 days of opening.** Among funded new members who opened at least 37 days before the end of the data, day-30 retention (an `app opened` in days 30-36) is **50.7% for members with direct deposit in their first 14 days** (734 members) vs **25.6% for the rest** (1,073 members), about **2.0x**. Day-7 retention (days 7-13) is closer: 83.8% vs 75.0%. Both groups lose activity over the first weeks (daily active share, the share of the group with an `app opened` on that day, falls from 41% and 36% on day 0 to 26% and 20% on day 14). After that the members with direct deposit level off at a daily active share of about 19% (average of days 26-36; 20.6% on day 30), while the rest slide to about 10% (9.6% average of days 26-36; 9.8% on day 30). Overall day-30 retention of funded new members is 35.8% (day 7: 78.6%). Accept a ratio of 1.6x-2.2x.
- **Evidence:** H2-direct-deposit-retention; Funnels `account opened` → `direct deposit set up` (14-day window, filter did `account funded`), save converters and non-converters as cohorts; Retention `account opened` → `app opened`, custom bracket day 30-36, breakdown by those cohorts; `-- EVAL Q3`.
- **Context needed:** 01-business.md (goal 1), 04-metrics-and-tables.md (retention and active-member definitions).
- **Grading:** must name direct deposit and give the retention gap with a definition of retention that excludes server events. Wrong: counting `direct deposit received` or AutoPay payments as activity (they post for lapsed members); comparing unfunded with funded members only.

### Q4 — CAC by paid channel
- **Prompt:** "What does it cost us to acquire a new account on each paid channel?"
- **Type:** external-join
- **Answer:** Window spend from `paid_acquisition_daily` divided by Mixpanel `account opened` by channel: **paid social $37.98** ($34,370 / 905), **app store ads $51.81** ($24,039 / 464), **search ads $72.86** ($40,509 / 556), **comparison sites $116.41** ($57,623 / 495). Comparison sites cost about 3.1x paid social per account. The platforms claim about 20% more installs than Mixpanel records (e.g. paid social claims 1,092), so platform CPI looks lower ($31.47 for paid social). Accept each CAC within ±5%.
- **Evidence:** H5-paid-channel-economics; Insights `account opened` by `acquisition_channel`, joined to `paid_acquisition_daily.spend_usd`; `-- EVAL Q4`.
- **Context needed:** 04-metrics-and-tables.md (CAC definition, table dictionary), 01-business.md (channels).
- **Grading:** must use Mixpanel accounts as the denominator. Wrong: using `platform_reported_installs`; including organic or referral.

### Q5 — Which channel brings primary-account customers cheapest?
- **Prompt:** "Cheap installs are nice, but which paid channel actually gets us members who move their paycheck over, and at what cost?"
- **Type:** external-join
- **Answer:** For accounts opened Jun 4 - Sep 17 (each has a full 14 days), direct deposit within 14 days per new account: **comparison sites 42.5%**, search 26.7%, app store 20.6%, **paid social 11.1%** (referral 34.0%, organic 27.2%). Cost per direct-deposit customer (spend over the same days / those customers): **app store $248**, **comparison sites $273**, **search $274**, **paid social $340**. Paid social is the cheapest per account and the most expensive per direct-deposit customer; comparison-site accounts set up direct deposit about 3.8x as often as paid-social accounts. Accept costs within ±10% and the ranking of paid social last.
- **Evidence:** H5-paid-channel-economics, H2; Funnels `account opened` → `direct deposit set up`, 14-day window, date range 2026-06-04 to 2026-09-17, breakdown `acquisition_channel`; join `paid_acquisition_daily`; `-- EVAL Q5`.
- **Context needed:** 04-metrics-and-tables.md (cost per direct-deposit customer), 01-business.md (goal 2).
- **Grading:** must combine spend with a quality outcome, not stop at CAC. Wrong: "paid social is our best channel" because it is cheapest per account.

### Q6 — How is Round-Ups adoption going?
- **Prompt:** "We launched Round-Ups in July. How many members are using it, and is it still growing?"
- **Type:** trend
- **Answer:** Adoption **ramped for about three weeks after the 2026-07-14 launch and then held flat at about 35%** of members who make card purchases. Weekly share of purchasers whose purchases produced a Round-Up sweep (Monday weeks): 3.5% (launch week), 13.9% (Jul 20), 25.7% (Jul 27), 33.5% (Aug 3), then 34.3%-35.1% every week from Aug 10 to Sep 21. Members turning it on peaked at 680-762 a week in late July and settled at 35-90 a week from mid-August. 2,621 members have turned it on; 42,283 Round-Up sweeps posted. The partial last week (Sep 28 - Oct 1) reads lower because sweeps post the next morning. Accept a ramp to a plateau of 32%-37% and "not growing any more".
- **Evidence:** H3-round-ups-launch; Insights `savings deposit` (source = round_up) uniques and `round-ups enabled` totals, weekly; `-- EVAL Q6`.
- **Context needed:** 02-timeline.md (launch date, how sweeps work), 03-event-dictionary.md (`source`).
- **Grading:** must describe the shape (ramp then plateau) with a sensible denominator. Wrong: "still growing steadily"; dividing by all members including those with no card purchases without saying so.

### Q7 — Did Round-Ups replace manual saving? (null)
- **Prompt:** "Now that Round-Ups saves spare change automatically, are members who use it moving less money into Pockets by hand?"
- **Type:** null-hypothesis
- **Answer:** **No.** Manual Pocket deposits per app visit went from 0.1020 (before launch) to 0.1156 (after Aug 4) for Round-Ups users and from 0.1000 to 0.1131 for everyone else: a relative change of 1.00x (z ≈ +0.1, not significant). Within Free it is 0.97x (z ≈ −1.0) and within Plus/Premium 1.04x (z ≈ +1.0), neither significant and in opposite directions. The overall rise after launch comes from Plus and Premium members during the Summer Saver Boost, and it is the same for users and non-users. Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q7`; Insights `savings deposit` (source = manual) and `app opened`, formula A/B, breakdown by cohort "did round-ups enabled", before vs after launch.
- **Context needed:** 02-timeline.md (launch and boost dates), 03-event-dictionary.md (`source`).
- **Grading:** must compare users with non-users over the same periods. Wrong: "manual deposits went up after Round-Ups, so it boosted saving" (that is the boost); "Round-Ups users save less by hand".

### Q8 — What happened on August 20-21?
- **Prompt:** "Card declines spiked around August 20th. What happened, and how many members were affected?"
- **Type:** external-join
- **Answer:** **Mobile wallet (Apple Pay / Google Pay) payments failed during the card processor's outage.** On Aug 20-21 the approval rate for `payment_channel = contactless_wallet` fell to **31.4%** (31.1% and 31.6% on the two days) from 94.7% in the surrounding week, while chip, online, and ATM stayed at about 94-96%. Relative to the other channels, wallet approval was about a third of its normal level. 1,265 wallet transactions were declined with `decline_reason = technical_error`, touching **1,099 members**. Chip volume rose to 1,556 and 1,605 transactions (from about 1,100-1,200 a day) as members retried with the physical card. `card_authorizations_daily` shows `processor_status = major_outage` and `tokenization_error_rate` 0.65 and 0.67 for the wallet channel on exactly those two days. Accept wallet approval within ±3 points and naming the wallet channel and the processor outage.
- **Evidence:** H4-wallet-outage; Insights `card transaction`, share approved, daily, breakdown `payment_channel`; join `card_authorizations_daily`; `-- EVAL Q8`.
- **Context needed:** 02-timeline.md (processor incident), 04-metrics-and-tables.md (`card_authorizations_daily`).
- **Grading:** must isolate the wallet channel and connect it to the processor status. Wrong: "insufficient funds" or a member-side cause; reporting an all-channel decline rate only.

### Q9 — Support load from the outage
- **Prompt:** "Did the August card problem hit our support team?"
- **Type:** segmentation
- **Answer:** Yes. On Aug 20-21 support received **239 tickets (119.5 a day) vs 39.3 a day** on other days, about 3.0x. **151 of them were `card_declined`** (75.5 a day vs 4.3 a day normally). Accept tickets per day within ±10%.
- **Evidence:** H4-wallet-outage; Insights `support ticket opened`, daily, breakdown `issue_type`; `-- EVAL Q9`.
- **Context needed:** 02-timeline.md, 03-event-dictionary.md (`issue_type`).
- **Grading:** must quantify the spike against a baseline. Wrong: counting resolutions instead of new tickets.

### Q10 — Did the Autopay Default test work?
- **Prompt:** "We're testing turning AutoPay on by default when members add a biller. Is it working?"
- **Type:** funnel
- **Answer:** Yes. For billers added from 2026-07-21, **56.5% of billers in "Autopay On" got AutoPay vs 35.3% in Control** (1,762 vs 1,725 billers), about **1.60x**. Measured per member (a unique-member funnel), 62.9% vs 41.3% of members turned AutoPay on for at least one new biller (1.52x). Enrollment is balanced (1,338 vs 1,312 exposed members). Over the full window the per-biller read drops to about 1.47x (52.5% vs 35.7%), because billers added before the test count in both arms; set the date range from 2026-07-21. Accept a per-biller lift of 1.40x-1.75x, or the per-member 1.52x when labeled as per member.
- **Evidence:** H6-autopay-default-experiment; Funnels `biller added` → `autopay enabled`, totals, hold `biller_id` constant, 1-day window, date range 2026-07-21 to 2026-10-01, breakdown `Experiment: Autopay Default`; `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (test design and start date), 03-event-dictionary.md (`biller_id`).
- **Grading:** must compare variants per biller (or per member with a note). Wrong: before/after across all members without the variant split.

### Q11 — Did the bank holidays dent card spending? (null)
- **Prompt:** "Paychecks didn't land on Juneteenth, July 3rd, or Labor Day. Did members spend less on their cards those days?"
- **Type:** null-hypothesis
- **Answer:** **No.** Card transactions on each holiday were in line with the same weekday one and two weeks either side: **Jun 19: 2,861 vs 3,009 (0.95x), Jul 3: 3,110 vs 2,983 (1.04x), Sep 7: 3,003 vs 2,933 (1.02x)**; against the normal day-to-day spread of that ratio the z-scores are −1.45, +1.35, and +0.78 (none significant, and not in one direction). Pooled over the three holidays the ratio is 1.01x (z ≈ +0.4). Card networks run every day; only ACH (paychecks, AutoPay) shifts. Accept "no meaningful change"; an answer that reads Jun 19 alone as a dip without testing it against the normal spread is wrong.
- **Evidence:** `-- EVAL Q11`; Insights `card transaction`, total, daily, compare same weekdays.
- **Context needed:** 02-timeline.md (holidays, banking calendar).
- **Grading:** must compare with the same weekday. Wrong: comparing a Friday holiday with a Sunday or the weekly average; "spending dropped because paychecks were late".

### Q12 — How often are bills paid late?
- **Prompt:** "How often do members pay their bills late, and does AutoPay make a difference?"
- **Type:** segmentation
- **Answer:** **10.9% of bill payments are late** (6,324 of 57,783). By method: **paid by hand 17.1% late** (32,725 payments) vs **AutoPay 2.9% late** (25,058), about 6x. 57% of bill payments are still made by hand. Accept shares within ±1.5 points.
- **Evidence:** H7-manual-payers-pay-late; Insights `bill paid`, total, breakdown `autopay` and `payment_status`; `-- EVAL Q12`.
- **Context needed:** 03-event-dictionary.md (`autopay`, `payment_status`).
- **Grading:** must split by payment method. Wrong: only the overall rate.

### Q13 — What did the AutoPay test do to late payments?
- **Prompt:** "If we ship AutoPay-by-default, will members pay fewer bills late?"
- **Type:** open-ended
- **Answer:** On billers added during the test, payments by "Autopay On" members were made by AutoPay 58.1% of the time vs 38.5% in Control, and **6.7% of them were late vs 9.6%** in Control (1,910 vs 1,857 payments so far). The per-method late rates (17.1% by hand vs 2.9% AutoPay) say every biller moved to AutoPay cuts its late rate by about 14 points, so a 20-point AutoPay gap predicts about 2.8 points fewer late payments; the observed gap is 2.9 points, still noisy with about 1,900 payments per arm. The test has only one or two billing cycles per new biller so far; the mechanism is the AutoPay share. Accept late shares within ±1.5 points and the reasoning through AutoPay share.
- **Evidence:** H6 and H7; Insights `bill paid` filtered to billers added after Jul 21, breakdown `Experiment: Autopay Default` and `payment_status`; `-- EVAL Q13`.
- **Context needed:** 02-timeline.md (test), 03-event-dictionary.md.
- **Grading:** must connect the AutoPay lift to the late-payment rates. Wrong: claiming a large late-payment drop across all bills (old billers are not in the test).

### Q14 — Did the Summer Saver Boost bring in savings?
- **Prompt:** "We ran a higher Pocket rate for Plus and Premium from August 3rd. Did it change how often members move money into their Pockets by hand?"
- **Type:** external-join
- **Answer:** Yes, for the eligible plans only. `pocket_savings_daily` shows the boost ran Aug 3 - Sep 30 at **5.00% APY for Plus (from 3.50%) and Premium (from 4.00%)**; Free stayed 0.50%. Manual Pocket deposits per app visit by Plus and Premium members (plan at event time) rose from **0.1015 to 0.1498 (1.48x)** in the 8 boost weeks vs the 8 weeks before; Free went from 0.0986 to 0.0956 (0.97x). In the ledger, deposits per day rose from $10,759 to $15,895 for Plus and from $7,051 to $9,251 for Premium, vs $21,929 to $23,224 for Free. Accept a Plus/Premium lift of 1.35x-1.65x with Free flat.
- **Evidence:** H8-summer-saver-boost; Insights `savings deposit` (source = manual) and `app opened`, formula A/B, breakdown `plan_tier`, weekly; join `pocket_savings_daily.apy_pct`; `-- EVAL Q14`.
- **Context needed:** 02-timeline.md (boost), 04-metrics-and-tables.md (`pocket_savings_daily`), 01-business.md (plans).
- **Grading:** must use Free as a control or normalize for the growing member base, and exclude Round-Up sweeps. Wrong: raw deposit totals (they include Round-Ups, which launched three weeks earlier); using the profile's current plan.

### Q15 — What did the boost cost?
- **Prompt:** "Finance wants to know what the Summer Saver Boost cost us in extra interest and what we got for it."
- **Type:** external-join
- **Answer:** From `pocket_savings_daily`, Plus and Premium Pockets accrued **$78,432 of interest** during the boost; at the pre-boost rates that would have been about $59,100, so the boost cost **about $19,287 in extra interest** ($10,762 Plus, $8,525 Premium). In return, net Pocket inflow (deposits − withdrawals) for those plans rose from **$1,834 a day to $6,779 a day**, and their combined balance grew from $9.47M on Aug 2 to $9.95M on Sep 30. Accept extra interest within ±10% and a clear net-inflow comparison.
- **Evidence:** H8; warehouse only; `-- EVAL Q15`.
- **Context needed:** 04-metrics-and-tables.md (`interest_paid_usd`, `apy_pct`, balances), 01-business.md (interest margin).
- **Grading:** must compute the incremental interest (boost APY − prior APY), not total interest. Wrong: quoting the $78k total as the cost; ignoring withdrawals.

### Q16 — Is Premium support faster?
- **Prompt:** "Premium promises priority support. Do Premium members actually get their tickets resolved faster?"
- **Type:** funnel
- **Answer:** Yes. Median time from ticket opened to resolved is **6.4 hours for Premium** (504 tickets) vs **16.1 hours for Free** (2,781) and **15.7 hours for Plus** (1,071), about **0.40x** (0.398 against Free and Plus combined, 16.1 hours over 3,852 tickets). Means: 8.7 vs 22.4 and 21.8 hours. Plus gets no speed-up. Accept a Premium median ratio of 0.36-0.44 using the plan at ticket time.
- **Evidence:** H9-premium-priority-support; Funnels `support ticket opened` → `support ticket resolved`, hold `ticket_id` constant, median time to convert, 30-day window (Mixpanel default), breakdown `plan_tier`; `-- EVAL Q16`.
- **Context needed:** 01-business.md (plans), 04-metrics-and-tables.md (time to resolve).
- **Grading:** must measure per ticket. Wrong: unique-member funnel time that pairs one member's tickets across each other.

### Q17 — Is there a savings habit tied to budgeting?
- **Prompt:** "When members move money into a Pocket by hand, do the ones who use budgets put in more? Is there a point where it kicks in?"
- **Type:** segmentation
- **Answer:** Yes, with a clear threshold at **three budgets**. Average manual Pocket deposit by budgets created in the window: 0 budgets $105.37, 1 $102.85, 2 $102.43, then **3 budgets $162.11, 4 $164.75, 5+ $172.38**. Members with 3+ budgets put about **1.6x** as much into each deposit ($165.05 vs $103.37 for 0-2); below three there is no difference, and above three it does not keep rising. Medians show the same step ($74-76 vs $118-123). Accept a step at 3 and a ratio of 1.45x-1.75x.
- **Evidence:** H10-budget-magic-number; Insights `savings deposit` (source = manual), average amount, breakdown by cohorts on count of `budget created`; `-- EVAL Q17`.
- **Context needed:** 03-event-dictionary.md.
- **Grading:** must show the dose pattern (flat, step, flat). Wrong: "more budgets, steadily more savings"; using deposit counts instead of amounts.

### Q18 — Why were there no paychecks on some days?
- **Prompt:** "Our deposits chart shows zero direct deposits on June 19, July 3, and September 7. Is something broken?"
- **Type:** context
- **Answer:** **Nothing is broken: those are Federal Reserve holidays** (Juneteenth, Independence Day observed, Labor Day), when ACH does not settle. Paychecks that would have posted then posted on the previous business day. Jun 18 (923 paychecks) and Jul 2 (970) carry the biweekly Friday payroll moved from Jun 19 and Jul 3 (787 and 828 biweekly paychecks) on top of the regular Thursday gig payouts. Sep 4 (1,176) is a regular biweekly payroll Friday (1,022) plus the 154 weekly gig payouts moved from Monday Sep 7 (gig payouts never post on a Friday otherwise); an ordinary weekday without a payroll date has about 115-170. AutoPay bill payments moved to the next business day (Jun 22: 490, Jul 6: 574, Sep 8: 593). Card transactions continued as normal (2,861-3,110 on the holidays). Weekends also show no direct deposits or AutoPay payments. Accept the holiday explanation with the shift.
- **Evidence:** `-- EVAL Q18`; Insights `direct deposit received` (breakdown `pay_frequency`) and `bill paid` (autopay = true), daily.
- **Context needed:** 02-timeline.md (holidays, banking calendar).
- **Grading:** must name the bank holidays and the ACH rule. Wrong: "a tracking outage"; "members stopped getting paid".

### Q19 — Did outage-hit members use their card less afterwards? (null)
- **Prompt:** "Members whose Apple Pay failed during the August outage — did they lose trust and use their Penny Harbor card less afterwards?"
- **Type:** null-hypothesis
- **Answer:** **No.** The cleanest comparison takes members who made exactly one mobile-wallet payment on Aug 20-21: the processor declined some of those payments and approved others, so both groups had the same outage-day usage. The 824 members whose payment was declined made 6.46 card transactions per member in the 14 days before (Aug 6-19) and 6.57 in the 14 days after (Aug 22 - Sep 4), 1.02x; the 436 whose payment was approved went from 6.67 to 6.59, 0.99x. The difference in change is not significant (z ≈ +0.8). It is not significant within Free (z ≈ −0.4) or within Plus/Premium (z ≈ +1.7) either. Broader controls point the same way: against wallet users who used their card on Aug 20-21, hit members changed 0.96x vs 0.96x (z ≈ +0.1). Against all other wallet users, hit members held up better (0.96x vs 0.91x, z ≈ +2.2). That gap favors the hit group because hit members were active on the outage days by definition, while some other wallet users went quiet during the window. No comparison shows hit members cutting card use. Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q19`; cohorts "did card transaction (payment_channel = contactless_wallet) exactly 1 time on Aug 20-21" split by "did card transaction with decline_reason = technical_error on Aug 20-21" vs authorization_status = approved; Insights `card transaction` per member, Aug 6-19 vs Aug 22 - Sep 4.
- **Context needed:** 02-timeline.md (incident), 03-event-dictionary.md.
- **Grading:** must compare with a control group over the same periods. Accept an answer from the all-wallet-users control if it concludes that hit members did not cut card use and notes that their usage held up. Wrong: "hit members spend less now", drawn from their own before/after alone (card use slips for everyone over those weeks).

### Q20 — What should we worry about going into Q4?
- **Prompt:** "Looking back at this quarter, what are the two or three things we should worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names several of these, with numbers:
  - **Onboarding leaks thin-file applicants:** 39% of them fund within 7 days vs 73% of established files, and their document review often takes more than three days (Q1, Q2); only 63.8% of all new accounts fund.
  - **Primary-account conversion decides retention, and paid social rarely delivers it:** funded members with direct deposit in 14 days retain at 50.7% vs 25.6% at day 30 (Q3); only 40% of funded new members set it up; paid social is 22% of new accounts but converts to direct deposit at 11% and costs $340 per direct-deposit customer (Q5).
  - **Late bills:** 57% of bill payments are made by hand and 17.1% of those are late vs 2.9% on AutoPay (Q12); the AutoPay default test is a ready fix (Q10, Q13).
  - **The boost ends Sep 30:** it cost about $19k in extra interest and lifted net Pocket inflow for Plus and Premium from about $1.8k to $6.8k a day (Q14, Q15); watch for withdrawals in October.
  - **Processor dependency:** a two-day wallet outage declined two-thirds of wallet payments and tripled ticket volume (Q8, Q9); wallet payments are 33% of card transactions.
  - Round-Ups adoption has plateaued at about 35% of purchasers (Q6).
- **Evidence:** `-- EVAL Q20` plus Q1, Q3, Q5, Q6, Q8, Q12, Q15.
- **Context needed:** all guides.
- **Grading:** full credit needs at least two issues backed by numbers from the data and at least one that uses a warehouse table. Wrong: generic advice with no numbers; claiming Round-Ups cut manual saving (it did not, Q7).
