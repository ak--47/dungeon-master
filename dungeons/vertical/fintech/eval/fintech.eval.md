# Penny Harbor (fintech) — 20-question eval

- **Data:** `data/verify-fintech` (full fidelity: 10,000 members, 9,935 with events, 3,976 new accounts, 1,105,774 events, 2026-06-04 → 2026-10-01 UTC)
- **Run date:** 2026-10-07
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query in `dungeons/vertical/fintech/fintech.sql` on that data.
- **Stories:** ids refer to the `stories` export in `fintech.js` (H1-H10).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Where do applicants drop out of onboarding?
- **Prompt:** "A third of the people who open an account never fund it. Is that everyone, or is a particular group struggling?"
- **Type:** funnel
- **Answer:** **Thin-file applicants.** 7-day onboarding completion (account opened → identity verified → account funded) is **40.8% for `credit_history = thin_file`** (433 of 1,062) vs **73.0% for established files** (2,128 of 2,914), about **0.56x**; overall 64.4%. Thin files lose ground at both steps: 69.9% pass identity verification within 7 days (vs 86.6%), and only 58% of those verified go on to fund (vs 84%). Accept a ratio of 0.50-0.61 and naming the thin-file segment.
- **Evidence:** H1-thin-file-onboarding; Funnels, three onboarding steps, 7-day window, breakdown user property `credit_history`; `-- EVAL Q1`.
- **Context needed:** 03-event-dictionary.md (onboarding events, `credit_history`), 04-metrics-and-tables.md (onboarding completion).
- **Grading:** must break down by credit file and quantify the gap. Wrong: blaming acquisition channel or signup method; reporting only the overall rate.

### Q2 — How long does it take to get funded?
- **Prompt:** "How long does it take a new member to go from opening the account to having money in it?"
- **Type:** funnel
- **Answer:** Among members who fund within 7 days, the **median is 3.8 hours** (2,561 members), with a long right tail (90th percentile 25.1 hours). It splits sharply by credit file: **established files median 3.0 hours** (90th percentile 9.2 hours) vs **thin files median 27.5 hours** (90th percentile 78.6 hours, more than three days), about 9x slower. The `kyc_method` on `identity verified` shows why: thin-file applicants go through `document_scan` review, and most of their wait comes before `identity verified`. Accept medians within ±10%, the established/thin split, and a note that the distribution is skewed.
- **Evidence:** H1 (declared onboarding timing); Funnels, onboarding steps, median time to convert, breakdown `credit_history`; `-- EVAL Q2`.
- **Context needed:** 03-event-dictionary.md (`kyc_method`), 04-metrics-and-tables.md (time to fund).
- **Grading:** must report a median (or note the skew) and the split by credit file. Wrong: a single average with no segmentation.

### Q3 — What predicts that a new member sticks around?
- **Prompt:** "Is there something new members do in their first couple of weeks that predicts whether they're still with us a month later?"
- **Type:** retention
- **Answer:** **Setting up direct deposit within 14 days of opening.** Among funded new members who opened at least 37 days before the end of the data, day-30 retention (an `app opened` in days 30-36) is **47.5% for members with direct deposit in their first 14 days** (748 members) vs **26.0% for the rest** (1,042 members), about **1.8x**. Day-7 retention (days 7-13) is closer: 83.3% vs 73.7%. Both groups lose activity over the first weeks (daily active share falls from about 33-37% on day 0 to 20-25% by day 14); after that the members with direct deposit thin slowly (about 16-19% a day in days 26-36), while the rest keep sliding to about 9% by day 30. Overall day-30 retention of funded new members is 35.0% (day 7: 77.7%). Accept a ratio of 1.6x-2.2x.
- **Evidence:** H2-direct-deposit-retention; Funnels `account opened` → `direct deposit set up` (14-day window, filter did `account funded`), save converters and non-converters as cohorts; Retention `account opened` → `app opened`, custom bracket day 30-36, breakdown by those cohorts; `-- EVAL Q3`.
- **Context needed:** 01-business.md (goal 1), 04-metrics-and-tables.md (retention and active-member definitions).
- **Grading:** must name direct deposit and give the retention gap with a definition of retention that excludes server events. Wrong: counting `direct deposit received` or AutoPay payments as activity (they post for lapsed members); comparing unfunded with funded members only.

### Q4 — CAC by paid channel
- **Prompt:** "What does it cost us to acquire a new account on each paid channel?"
- **Type:** external-join
- **Answer:** Window spend from `paid_acquisition_daily` divided by Mixpanel `account opened` by channel: **paid social $38.13** ($33,858 / 888), **app store ads $51.60** ($25,696 / 498), **search ads $72.63** ($39,945 / 550), **comparison sites $115.82** ($51,886 / 448). Comparison sites cost about 3.0x paid social per account. The platforms claim about 20% more installs than Mixpanel records (e.g. paid social claims 1,067), so platform CPI looks lower ($31.73 for paid social). Accept each CAC within ±5%.
- **Evidence:** H5-paid-channel-economics; Insights `account opened` by `acquisition_channel`, joined to `paid_acquisition_daily.spend_usd`; `-- EVAL Q4`.
- **Context needed:** 04-metrics-and-tables.md (CAC definition, table dictionary), 01-business.md (channels).
- **Grading:** must use Mixpanel accounts as the denominator. Wrong: using `platform_reported_installs`; including organic or referral.

### Q5 — Which channel brings primary-account customers cheapest?
- **Prompt:** "Cheap installs are nice, but which paid channel actually gets us members who move their paycheck over, and at what cost?"
- **Type:** external-join
- **Answer:** For accounts opened Jun 4 - Sep 17 (each has a full 14 days), direct deposit within 14 days per new account: **comparison sites 40.7%**, search 26.2%, app store 22.6%, **paid social 11.2%** (referral 38.8%, organic 29.3%). Cost per direct-deposit customer (spend over the same days / those customers): **app store $227**, **search $278**, **comparison sites $285**, **paid social $340**. Paid social is the cheapest per account and the most expensive per direct-deposit customer; comparison-site accounts set up direct deposit about 3.6x as often as paid-social accounts. Accept costs within ±10% and the ranking of paid social last.
- **Evidence:** H5-paid-channel-economics, H2; Funnels `account opened` → `direct deposit set up`, 14-day window, date range 2026-06-04 to 2026-09-17, breakdown `acquisition_channel`; join `paid_acquisition_daily`; `-- EVAL Q5`.
- **Context needed:** 04-metrics-and-tables.md (cost per direct-deposit customer), 01-business.md (goal 2).
- **Grading:** must combine spend with a quality outcome, not stop at CAC. Wrong: "paid social is our best channel" because it is cheapest per account.

### Q6 — How is Round-Ups adoption going?
- **Prompt:** "We launched Round-Ups in July. How many members are using it, and is it still growing?"
- **Type:** trend
- **Answer:** Adoption **ramped for about three weeks after the 2026-07-14 launch and then held flat at about 34%** of members who make card purchases. Weekly share of purchasers whose purchases produced a Round-Up sweep (Monday weeks): 4.2% (launch week), 14.5% (Jul 20), 25.7% (Jul 27), 32.9% (Aug 3), then 33.5%-34.3% every week from Aug 10 to Sep 21. Members turning it on peaked at 677-782 a week in late July and settled at 69-108 a week (mostly newly joined members). 2,915 members have turned it on; 42,333 Round-Up sweeps posted. The partial last week (Sep 28 - Oct 1) reads lower because sweeps post the next morning. Accept a ramp to a plateau of 32%-37% and "not growing any more".
- **Evidence:** H3-round-ups-launch; Insights `savings deposit` (source = round_up) uniques and `round-ups enabled` totals, weekly; `-- EVAL Q6`.
- **Context needed:** 02-timeline.md (launch date, how sweeps work), 03-event-dictionary.md (`source`).
- **Grading:** must describe the shape (ramp then plateau) with a sensible denominator. Wrong: "still growing steadily"; dividing by all members including those with no card purchases without saying so.

### Q7 — Did Round-Ups replace manual saving? (null)
- **Prompt:** "Now that Round-Ups saves spare change automatically, are members who use it moving less money into Pockets by hand?"
- **Type:** null-hypothesis
- **Answer:** **No.** Manual Pocket deposits per app visit went from 0.0756 (before launch) to 0.0869 (after Aug 4) for Round-Ups users and from 0.0762 to 0.0877 for everyone else: a relative change of 1.00x (z ≈ −0.1, not significant). The same holds within Free (1.00x, z ≈ 0.0) and within Plus/Premium (1.01x, z ≈ +0.3). The overall rise after launch comes from Plus and Premium members during the Summer Saver Boost, and it is the same for users and non-users. Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q7`; Insights `savings deposit` (source = manual) and `app opened`, formula A/B, breakdown by cohort "did round-ups enabled", before vs after launch.
- **Context needed:** 02-timeline.md (launch and boost dates), 03-event-dictionary.md (`source`).
- **Grading:** must compare users with non-users over the same periods. Wrong: "manual deposits went up after Round-Ups, so it boosted saving" (that is the boost); "Round-Ups users save less by hand".

### Q8 — What happened on August 20-21?
- **Prompt:** "Card declines spiked around August 20th. What happened, and how many members were affected?"
- **Type:** external-join
- **Answer:** **Mobile wallet (Apple Pay / Google Pay) payments failed during the card processor's outage.** On Aug 20-21 the approval rate for `payment_channel = contactless_wallet` fell to **32.3%** (30.7% and 33.9% on the two days) from 94.5% in the surrounding week, while chip, online, and ATM stayed at about 93-96%. Relative to the other channels, wallet approval was 0.34x its normal level. 1,295 wallet transactions were declined with `decline_reason = technical_error`, touching **1,129 members**. Chip volume rose to 1,523 and 1,625 transactions (from about 1,200 a day) as members retried with the physical card. `card_authorizations_daily` shows `processor_status = major_outage` and `tokenization_error_rate` 0.65 and 0.67 for the wallet channel on exactly those two days. Accept wallet approval within ±3 points and naming the wallet channel and the processor outage.
- **Evidence:** H4-wallet-outage; Insights `card transaction`, share approved, daily, breakdown `payment_channel`; join `card_authorizations_daily`; `-- EVAL Q8`.
- **Context needed:** 02-timeline.md (processor incident), 04-metrics-and-tables.md (`card_authorizations_daily`).
- **Grading:** must isolate the wallet channel and connect it to the processor status. Wrong: "insufficient funds" or a member-side cause; reporting an all-channel decline rate only.

### Q9 — Support load from the outage
- **Prompt:** "Did the August card problem hit our support team?"
- **Type:** segmentation
- **Answer:** Yes. On Aug 20-21 support received **204 tickets (102.0 a day) vs 33.3 a day** on other days, about 3.1x. **146 of them were `card_declined`** (73.0 a day vs 3.5 a day normally). Accept tickets per day within ±10%.
- **Evidence:** H4-wallet-outage; Insights `support ticket opened`, daily, breakdown `issue_type`; `-- EVAL Q9`.
- **Context needed:** 02-timeline.md, 03-event-dictionary.md (`issue_type`).
- **Grading:** must quantify the spike against a baseline. Wrong: counting resolutions instead of new tickets.

### Q10 — Did the Autopay Default test work?
- **Prompt:** "We're testing turning AutoPay on by default when members add a biller. Is it working?"
- **Type:** funnel
- **Answer:** Yes. For billers added from 2026-07-21, **56.5% of billers in "Autopay On" got AutoPay vs 36.0% in Control** (1,823 vs 1,805 billers), about **1.57x**. Measured per member (a unique-member funnel), 63.7% vs 43.5% of members turned AutoPay on for at least one new biller (1.47x). Enrollment is balanced (1,385 vs 1,344 exposed members). Over the full window the per-biller read drops to about 1.43x (51.8% vs 36.3%), because billers added before the test count in both arms; set the date range from 2026-07-21. Accept a per-biller lift of 1.40x-1.75x, or the per-member 1.47x when labeled as per member.
- **Evidence:** H6-autopay-default-experiment; Funnels `biller added` → `autopay enabled`, totals, hold `biller_id` constant, 1-day window, date range 2026-07-21 to 2026-10-01, breakdown `Experiment: Autopay Default`; `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (test design and start date), 03-event-dictionary.md (`biller_id`).
- **Grading:** must compare variants per biller (or per member with a note). Wrong: before/after across all members without the variant split.

### Q11 — Did the bank holidays dent card spending? (null)
- **Prompt:** "Paychecks didn't land on Juneteenth, July 3rd, or Labor Day. Did members spend less on their cards those days?"
- **Type:** null-hypothesis
- **Answer:** **No.** Card transactions on each holiday were in line with the same weekday one and two weeks either side: **Jun 19: 3,047 vs 3,069 (0.99x), Jul 3: 3,021 vs 3,113 (0.97x), Sep 7: 2,934 vs 2,955 (0.99x)**; against the normal day-to-day spread of that ratio the z-scores are −0.3, −1.1, and −0.3 (none significant). Card networks run every day; only ACH (paychecks, AutoPay) shifts. Accept "no meaningful change".
- **Evidence:** `-- EVAL Q11`; Insights `card transaction`, total, daily, compare same weekdays.
- **Context needed:** 02-timeline.md (holidays, banking calendar).
- **Grading:** must compare with the same weekday. Wrong: comparing a Friday holiday with a Sunday or the weekly average; "spending dropped because paychecks were late".

### Q12 — How often are bills paid late?
- **Prompt:** "How often do members pay their bills late, and does AutoPay make a difference?"
- **Type:** segmentation
- **Answer:** **11.1% of bill payments are late** (6,502 of 58,772). By method: **paid by hand 17.4% late** (33,203 payments) vs **AutoPay 2.8% late** (25,569), about 6x. 56% of bill payments are still made by hand. Accept shares within ±1.5 points.
- **Evidence:** H7-manual-payers-pay-late; Insights `bill paid`, total, breakdown `autopay` and `payment_status`; `-- EVAL Q12`.
- **Context needed:** 03-event-dictionary.md (`autopay`, `payment_status`).
- **Grading:** must split by payment method. Wrong: only the overall rate.

### Q13 — What did the AutoPay test do to late payments?
- **Prompt:** "If we ship AutoPay-by-default, will members pay fewer bills late?"
- **Type:** open-ended
- **Answer:** On billers added during the test, payments by "Autopay On" members were made by AutoPay 58.8% of the time vs 36.7% in Control, and **7.5% of them were late vs 8.7%** in Control (1,965 vs 1,937 payments so far). The per-method late rates (17.4% by hand vs 2.8% AutoPay) say every biller moved to AutoPay cuts its late rate by about 15 points, so a 22-point AutoPay gap predicts about 3 points fewer late payments; the observed gap (1.2 points) is smaller and still noisy with about 1,950 payments per arm. The test has only one or two billing cycles per new biller so far; the mechanism is the AutoPay share. Accept late shares within ±1.5 points and the reasoning through AutoPay share.
- **Evidence:** H6 and H7; Insights `bill paid` filtered to billers added after Jul 21, breakdown `Experiment: Autopay Default` and `payment_status`; `-- EVAL Q13`.
- **Context needed:** 02-timeline.md (test), 03-event-dictionary.md.
- **Grading:** must connect the AutoPay lift to the late-payment rates. Wrong: claiming a large late-payment drop across all bills (old billers are not in the test).

### Q14 — Did the Summer Saver Boost bring in savings?
- **Prompt:** "We ran a higher Pocket rate for Plus and Premium from August 3rd. Did it change how often members move money into their Pockets by hand?"
- **Type:** external-join
- **Answer:** Yes, for the eligible plans only. `pocket_savings_daily` shows the boost ran Aug 3 - Sep 30 at **5.00% APY for Plus (from 3.50%) and Premium (from 4.00%)**; Free stayed 0.50%. Manual Pocket deposits per app visit by Plus and Premium members (plan at event time) rose from **0.0770 to 0.1144 (1.48x)** in the 8 boost weeks vs the 8 weeks before; Free went from 0.0748 to 0.0741 (0.99x). In the ledger, deposits per day rose from $8,518 to $11,617 for Plus and from $6,283 to $8,046 for Premium, vs $17,226 to $18,388 for Free. Accept a Plus/Premium lift of 1.35x-1.65x with Free flat.
- **Evidence:** H8-summer-saver-boost; Insights `savings deposit` (source = manual) and `app opened`, formula A/B, breakdown `plan_tier`, weekly; join `pocket_savings_daily.apy_pct`; `-- EVAL Q14`.
- **Context needed:** 02-timeline.md (boost), 04-metrics-and-tables.md (`pocket_savings_daily`), 01-business.md (plans).
- **Grading:** must use Free as a control or normalize for the growing member base, and exclude Round-Up sweeps. Wrong: raw deposit totals (they include Round-Ups, which launched three weeks earlier); using the profile's current plan.

### Q15 — What did the boost cost?
- **Prompt:** "Finance wants to know what the Summer Saver Boost cost us in extra interest and what we got for it."
- **Type:** external-join
- **Answer:** From `pocket_savings_daily`, Plus and Premium Pockets accrued **$77,913 of interest** during the boost; at the pre-boost rates that would have been about $58,800, so the boost cost **about $19,139 in extra interest** ($10,638 Plus, $8,501 Premium). In return, net Pocket inflow (deposits − withdrawals) for those plans rose from **$1,495 a day to $5,328 a day**, and their combined balance grew from $9.45M on Aug 2 to $9.84M on Sep 30. Accept extra interest within ±10% and a clear net-inflow comparison.
- **Evidence:** H8; warehouse only; `-- EVAL Q15`.
- **Context needed:** 04-metrics-and-tables.md (`interest_paid_usd`, `apy_pct`, balances), 01-business.md (interest margin).
- **Grading:** must compute the incremental interest (boost APY − prior APY), not total interest. Wrong: quoting the $78k total as the cost; ignoring withdrawals.

### Q16 — Is Premium support faster?
- **Prompt:** "Premium promises priority support. Do Premium members actually get their tickets resolved faster?"
- **Type:** funnel
- **Answer:** Yes. Median time from ticket opened to resolved is **6.6 hours for Premium** (427 tickets) vs **17.2 hours for Free** (2,372) and **15.7 hours for Plus** (888), about **0.40x** (0.395 against Free and Plus combined, 16.8 hours). Means: 10.9 vs 27.9 and 24.7 hours. Plus gets no speed-up. Accept a Premium median ratio of 0.36-0.44 using the plan at ticket time.
- **Evidence:** H9-premium-priority-support; Funnels `support ticket opened` → `support ticket resolved`, hold `ticket_id` constant, median time to convert, 30-day window (Mixpanel default), breakdown `plan_tier`; `-- EVAL Q16`.
- **Context needed:** 01-business.md (plans), 04-metrics-and-tables.md (time to resolve).
- **Grading:** must measure per ticket. Wrong: unique-member funnel time that pairs one member's tickets across each other.

### Q17 — Is there a savings habit tied to budgeting?
- **Prompt:** "When members move money into a Pocket by hand, do the ones who use budgets put in more? Is there a point where it kicks in?"
- **Type:** segmentation
- **Answer:** Yes, with a clear threshold at **three budgets**. Average manual Pocket deposit by budgets created in the window: 0 budgets $103.42, 1 $103.54, 2 $103.12, then **3 budgets $163.01, 4 $168.35, 5+ $169.79**. Members with 3+ budgets put about **1.6x** as much into each deposit ($165.91 vs $103.36); below three there is no difference, and above three it does not keep rising. Medians show the same step ($74-76 vs $118-124). Accept a step at 3 and a ratio of 1.45x-1.75x.
- **Evidence:** H10-budget-magic-number; Insights `savings deposit` (source = manual), average amount, breakdown by cohorts on count of `budget created`; `-- EVAL Q17`.
- **Context needed:** 03-event-dictionary.md.
- **Grading:** must show the dose pattern (flat, step, flat). Wrong: "more budgets, steadily more savings"; using deposit counts instead of amounts.

### Q18 — Why were there no paychecks on some days?
- **Prompt:** "Our deposits chart shows zero direct deposits on June 19, July 3, and September 7. Is something broken?"
- **Type:** context
- **Answer:** **Nothing is broken: those are Federal Reserve holidays** (Juneteenth, Independence Day observed, Labor Day), when ACH does not settle. Paychecks that would have posted then posted on the previous business day. Jun 18 (945 paychecks) and Jul 2 (983) carry the biweekly Friday payroll moved from Jun 19 and Jul 3 (848 and 883 biweekly paychecks) on top of the regular Thursday gig payouts. Sep 4 (1,141) is a regular biweekly payroll Friday (1,006) plus the 135 weekly gig payouts moved from Monday Sep 7; an ordinary weekday without a payroll date has about 110-130, and AutoPay bill payments moved to the next business day (Jun 22: 442, Jul 6: 543, Sep 8: 614). Card transactions continued as normal (about 2,900-3,050 on each holiday). Weekends also show no direct deposits or AutoPay payments. Accept the holiday explanation with the shift.
- **Evidence:** `-- EVAL Q18`; Insights `direct deposit received` (breakdown `pay_frequency`) and `bill paid` (autopay = true), daily.
- **Context needed:** 02-timeline.md (holidays, banking calendar).
- **Grading:** must name the bank holidays and the ACH rule. Wrong: "a tracking outage"; "members stopped getting paid".

### Q19 — Did outage-hit members use their card less afterwards? (null)
- **Prompt:** "Members whose Apple Pay failed during the August outage — did they lose trust and use their Penny Harbor card less afterwards?"
- **Type:** null-hypothesis
- **Answer:** **No.** Among members who used a mobile wallet in the two weeks before Aug 20 and used their card on Aug 20-21, the 970 whose wallet payment was declined in the outage made 7.71 card transactions per member in the 14 days before and 7.25 in the 14 days after (0.94x); the 2,051 who were not hit went from 7.19 to 6.77 (0.94x). The difference in change is not significant (z ≈ −0.2). Within Free (z ≈ +0.5) and within Plus/Premium (z ≈ −1.1) it is not significant either. The control group must also have used the card on the outage days: hit members were active then by definition, while some other wallet users went quiet during the window. A comparison against all other wallet users also shows no significant difference. Accept "no meaningful difference".
- **Evidence:** `-- EVAL Q19`; cohorts "did card transaction with decline_reason = technical_error on Aug 20-21" and "did card transaction on Aug 20-21", Insights `card transaction` per member, before vs after.
- **Context needed:** 02-timeline.md (incident), 03-event-dictionary.md.
- **Grading:** must compare with a control group over the same periods. Wrong: "hit members spend less now" from their own before/after alone.

### Q20 — What should we worry about going into Q4?
- **Prompt:** "Looking back at this quarter, what are the two or three things we should worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names several of these, with numbers:
  - **Onboarding leaks thin-file applicants:** 41% of them fund within 7 days vs 73% of established files, and their document review often takes more than three days (Q1, Q2); only 64.4% of all new accounts fund.
  - **Primary-account conversion decides retention, and paid social rarely delivers it:** funded members with direct deposit in 14 days retain at 47.5% vs 26.0% at day 30 (Q3); only 42% of funded new members set it up; paid social is 22% of new accounts but converts to direct deposit at 11% and costs $340 per direct-deposit customer (Q5).
  - **Late bills:** 56% of bill payments are made by hand and 17.4% of those are late vs 2.8% on AutoPay (Q12); the AutoPay default test is a ready fix (Q10, Q13).
  - **The boost ends Sep 30:** it cost about $19k in extra interest and more than tripled net Pocket inflow for Plus and Premium (Q14, Q15); watch for withdrawals in October.
  - **Processor dependency:** a two-day wallet outage declined two-thirds of wallet payments and tripled ticket volume (Q8, Q9); wallet payments are 33% of card transactions.
  - Round-Ups adoption has plateaued at about 34% of purchasers (Q6).
- **Evidence:** `-- EVAL Q20` plus Q1, Q3, Q5, Q6, Q8, Q12, Q15.
- **Context needed:** all guides.
- **Grading:** full credit needs at least two issues backed by numbers from the data and at least one that uses a warehouse table. Wrong: generic advice with no numbers; claiming Round-Ups cut manual saving (it did not, Q7).
