# Stridewell (fitness) — 20-question eval

- **Data:** `data/verify-fitness` (full fidelity: 9,093 members with events, 4,074 new-member signups, 1,173,098 events, 2026-06-04 → 2026-10-01 UTC). The USERS file holds 9,097 profiles: 4 pre-existing members have a profile but no events in the window. Member counts in the answers use members with events.
- **Run date:** 2026-10-06 (fix round: signup times spread across the day, onboarding non-finishers keep reduced usage and purchases, notification fatigue follows 30-day volume, Fall Reset includes progress checks; every number re-measured)
- **Period labels:** "August" and "September" always mean calendar months (Aug 1-31, Sep 1-30). "Before / after the price change" means before Sep 1 / Sep 1 through Oct 1.
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query in `dungeons/vertical/fitness/fitness.sql` on that data.
- **Stories:** ids refer to the `stories` export in `fitness.js` (H1-H9).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Did the onboarding test work?
- **Prompt:** "We've been running the Guided First Week onboarding test since July. Is the Guided Plan variant actually better? By how much?"
- **Type:** funnel
- **Answer:** Yes. 7-day onboarding completion (account created → goal quiz completed → plan generated → starter workout completed): **Guided Plan 59.7%** (924 of 1,547) vs **Control 46.4%** (699 of 1,507), a **relative lift of about 1.29x** (+13.4 points). Accept 1.17x-1.43x and rates within ±1.5 points. Bonus: finishing onboarding goes with buying. Across all new members, 25.2% of those who finish buy Plus vs 13.0% of those who do not (non-finishers also log about half as many workouts). Guided Plan has slightly more buyers per enrolled signup so far (17.9% vs 16.9%), but that gap is not yet significant (z ≈ 0.8).
- **Evidence:** H1-guided-first-week; Funnels report with the four onboarding steps, 7-day window, breakdown by user property `Experiment: Guided First Week`; `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (test start and enrollment), 03-event-dictionary.md (onboarding events, experiment property).
- **Grading:** must restrict to enrolled members (signups from 2026-07-01) and compare variants on the same funnel. Wrong answers: comparing all new members before vs after July 1; counting `workout completed` instead of `starter workout completed`; reporting the lift as absolute points only without the rates; claiming members who skip onboarding never buy (13% of them do); claiming Guided Plan already produced significantly more buyers.

### Q2 — Is onboarding faster in the new variant?
- **Prompt:** "For people who finish onboarding, how long does it take in each variant of the Guided First Week test?"
- **Type:** funnel
- **Answer:** Median time from signup to starter workout: **Guided Plan ≈ 12.5 hours vs Control ≈ 18.0 hours**, about **0.70x** the control time (about 30% faster). Accept 0.63x-0.77x.
- **Evidence:** H1-guided-first-week; Funnels time-to-convert, same steps, breakdown by variant; `-- EVAL Q2`.
- **Context needed:** 03-event-dictionary.md.
- **Grading:** must use medians (or say the mean shows the same direction) on converters only. Wrong: computing time to `workout completed`.

### Q3 — Stride Coach and workout length
- **Prompt:** "What happened to workout duration after we launched Stride Coach?"
- **Type:** trend
- **Answer:** After the 2026-08-12 launch, Plus workouts done with Stride Coach (`coaching_mode = ai_coach`) average **49.9 minutes vs 41.4 minutes** for self-guided Plus workouts, about **1.21x longer**. Self-guided Plus workouts did not change (41.5 min before launch, 41.4 after). Free workouts are all self-guided. Accept 1.12x-1.28x.
- **Evidence:** H2-stride-coach-launch; Insights, `workout completed`, average `duration_minutes`, breakdown `coaching_mode`, filter `subscription_tier` ≠ free; `-- EVAL Q3`.
- **Context needed:** 02-timeline.md (launch date, Plus only), 01-business.md.
- **Grading:** must separate AI-coached from self-guided workouts and restrict to Plus. Wrong: comparing all workouts before vs after launch (41.4 → 43.1 minutes, about 1.04x, because it mixes in self-guided and free workouts and the adoption ramp).

### Q4 — Stride Coach adoption
- **Prompt:** "What share of Plus workouts use Stride Coach since it launched? Is adoption growing?"
- **Type:** segmentation
- **Answer:** Adoption **ramped for about three weeks, then leveled off near 43-45%**. Weekly share of Plus members' completed workouts with Stride Coach: 20.6% in the launch week (week of Aug 10, partial), 28.4%, 37.1%, 45.0%, then 43.0%-45.3% every week in September. Since launch overall: 39.8%; from Sep 2: 44.4%. Use varies by member: among the 1,196 Plus members with 10+ workouts since Sep 2, 42.0% never use Stride Coach, 7.5% use it for under half of their workouts (1.3% under 25%, 6.2% for 25-49%), 14.8% for 50-74%, and 35.7% for 75% or more. Accept a ramp that plateaus at 40%-48%, and a note that about 40% of Plus members do not use it while users vary in how much they use it.
- **Evidence:** H2-stride-coach-launch; Insights, `workout completed`, filter `subscription_tier` ≠ free and after launch, breakdown `coaching_mode`, weekly; per-member split needs a breakdown by user or the raw export; `-- EVAL Q4`.
- **Context needed:** 02-timeline.md, 04-metrics-and-tables.md (adoption definition).
- **Grading:** denominator is Plus workouts, not all workouts. Wrong: share of all workouts (much lower); "still growing steadily" (it plateaued in September); "every Plus member uses it a little" (about 40% never use it, and most users use it for half or more of their workouts).

### Q5 — Do Stride Coach workouts push people harder? (null)
- **Prompt:** "Stride Coach sessions run longer. Are people also working harder in them — higher heart rate or effort?"
- **Type:** null-hypothesis
- **Answer:** **No meaningful difference in intensity.** Plus workouts after launch: average heart rate **126.0 vs 126.0 bpm** (ai_coach vs self-guided); perceived effort 6.00 vs 5.98; calories per minute 7.72 vs 7.76. Stride Coach sessions burn more total calories only because they last longer (385.2 vs 321.1 calories per workout, about the same 1.20x as duration). Accept any answer that says intensity did not change (heart rate and effort within ±2%).
- **Evidence:** Insights, `workout completed`, average `avg_heart_rate` and `perceived_effort` (and calories ÷ minutes), breakdown `coaching_mode`, Plus and after launch; `-- EVAL Q5`.
- **Context needed:** 03-event-dictionary.md.
- **Grading:** must check intensity directly, not infer it from total calories. Wrong: "yes, they burn about 20% more calories, so they are harder workouts" (the extra calories come from the extra minutes).

### Q6 — The late-August dip
- **Prompt:** "Workout logging looks like it dropped for a few days in late August. What happened and how big was it?"
- **Type:** external-join
- **Answer:** The **2026-08-20 to 2026-08-22 wearable sync incident** at the health-data partner. On those three days, smartwatch and fitness-band workouts fell from about **661 per day to about 165 per day**, while all other workouts (phone, manual, chest strap) held steady (781 vs 779 per day). Relative to those unaffected workouts, watch and band workouts ran at **about 25%** of normal (0.250 ratio of ratios vs the 7 days on each side). The warehouse table `wearable_sync_daily` shows `sync_error_rate` ≈ 0.75 and `partner_api_status = major_outage` on exactly those days. Workouts that failed to sync are missing from Mixpanel. Accept 0.20-0.30.
- **Evidence:** H3-wearable-sync-outage; Insights daily `workout completed` by `tracking_source` and `wearable_type`; warehouse join on date and `wearable_type`; `-- EVAL Q6`.
- **Context needed:** 02-timeline.md (incident dates), 04-metrics-and-tables.md (`wearable_sync_daily`).
- **Grading:** must name the incident, the dates, the device scope, and a size. Wrong: blaming the dip on members working out less (phone workouts and meal logging did not move), or on the Stride Coach launch.

### Q7 — Which devices were hit?
- **Prompt:** "Was the August sync incident only smartwatches, or did it hit other trackers too?"
- **Type:** external-join
- **Answer:** **Smartwatches and fitness bands** were hit: during the incident they ran at 0.27x (smartwatch) and 0.22x (fitness band) of their normal level relative to phone workouts. **Chest straps** (1.06x) and **manual entries** (1.03x) were not hit. The warehouse agrees: `major_outage` with a 0.74-0.76 error rate for smartwatch and fitness_band only; chest_strap stayed `operational` (≈0.9% errors). Accept 0.15-0.35 for affected devices and 0.85-1.2 for unaffected.
- **Evidence:** H3-wearable-sync-outage; `-- EVAL Q7`.
- **Context needed:** 04-metrics-and-tables.md (`wearable_sync_daily`), 03-event-dictionary.md (`tracking_source`, `wearable_type`).
- **Grading:** must separate chest straps from watches and bands. Wrong: "all wearables".

### Q8 — Did the price change hurt sign-ups?
- **Prompt:** "Did the September Plus Monthly price increase hurt new subscriptions?"
- **Type:** trend
- **Answer:** **Yes, for Monthly.** Annual (whose price did not change) is the control. Monthly purchases per Annual purchase fell from **2.01 before Sep 1 to 1.22 after**, a ratio of **0.60** (about 40% fewer Monthly purchases than the Annual trend predicts). August vs September (calendar months): Monthly 223 → 102 (−54%) while Annual 88 → 87 (−1%); Monthly share of new subscriptions 71.7% → 54.0%. Accept a ratio of 0.45-0.8 (the post-change period holds about 195 purchases, so the ratio is noisy).
- **Evidence:** H4-monthly-price-change; Insights, `subscription purchased`, breakdown `plan`, weekly; `-- EVAL Q8`.
- **Context needed:** 02-timeline.md (price change), 01-business.md (plans).
- **Grading:** must use a control or mix analysis. Wrong: attributing the whole August-to-September drop in total purchases (311 → 189) to the price change without a control (part of the drop is fewer trial starts in September, which affects both plans; Annual held flat, so the gap between plans is the price signal); claiming no effect.

### Q9 — Did the price change pay off in bookings?
- **Prompt:** "Even if we sold fewer monthly plans, did the higher price bring in more monthly bookings?"
- **Type:** external-join
- **Answer:** **No.** Joining Mixpanel purchases to `list_price_usd`, Monthly gross bookings fell from **$2,897 in August (223 × $12.99) to $1,529 in September (102 × $14.99)** while Annual bookings moved from $8,799 to $8,699. Relative to Annual, Monthly bookings from Sep 1 are **0.70x** of before: the 15% higher price did not make up for the lost volume. Reading the billing table alone gives the same answer: Monthly $2,871 (221) → $1,529 (102), Annual $9,199 (92) → $8,499 (85), ratio 0.73x. Accept 0.6-0.88 from either source and "did not pay off".
- **Evidence:** H4-monthly-price-change; warehouse `subscription_billing_daily` joined to `subscription purchased` on date and plan; `-- EVAL Q9`.
- **Context needed:** 04-metrics-and-tables.md (billing table and its first-payment caveat), 02-timeline.md.
- **Grading:** must use warehouse prices (price is not on events). Wrong: multiplying all purchases by $14.99; reading the Monthly drop without the Annual control.

### Q10 — Summer Shred CAC
- **Prompt:** "What did a paid social signup cost us during Summer Shred compared with the rest of the period?"
- **Type:** external-join
- **Answer:** Paid social spend per Mixpanel signup was **$18.03 during Summer Shred (Jun 15-Jul 14) vs $8.95 outside it**, about **2.01x**. Spend: $8,924 for 495 signups in the campaign vs $4,447 for 497 signups outside. Paid search ($13.92 vs $13.94) and app-store ads ($6.05 vs $6.06) cost the same per signup in and out of the campaign. Daily cost per signup varies by about ±10% around those levels. Accept 1.8x-2.2x.
- **Evidence:** H5-summer-shred-paid-social; warehouse `paid_acquisition_daily.spend_usd` joined to `account created` by date and `acquisition_channel`; `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (campaign dates), 04-metrics-and-tables.md (CAC definition, spend table).
- **Grading:** must divide by Mixpanel signups, not `platform_reported_installs`. Wrong: using platform installs (understates CAC about 8%); comparing total spend only.

### Q11 — Did Summer Shred add new members?
- **Prompt:** "Did Summer Shred actually bring in extra members, or did paid social just take credit for people who would have joined anyway?"
- **Type:** attribution
- **Answer:** **It added real members.** New-member signups ran at **42.3 per day during the campaign vs 31.2 per day** in the rest of the window (**1.36x**), about **334 extra members** over the 30 days. The extra came through paid social: 16.5 vs 5.5 paid-social signups per day (3.0x; share of signups 17.7% → 39.0%). Every other channel held its normal daily volume (combined 1.01x): organic 11.5 vs 10.6, referral 4.7 vs 5.0, paid search 4.2 vs 4.8, app-store ads 5.5 vs 5.2. None of those per-channel moves is distinguishable from day-to-day noise (|z| ≤ 1.4 against the outside-campaign rate). There is no sign of cannibalization. Extra paid-social spend was about $7,442, or **about $22 per extra member** (higher than the $18.03 average because the campaign also paid double for paid-social members who would have come anyway). Accept a lift of 1.2x-1.5x, 250-420 extra members, and $17-$27 per extra member.
- **Evidence:** H5-summer-shred-paid-social; Insights, `account created`, breakdown `acquisition_channel`, daily or weekly, compare date ranges; warehouse spend for the cost; `-- EVAL Q11`.
- **Context needed:** 02-timeline.md (campaign dates), 04-metrics-and-tables.md (spend table).
- **Grading:** must compare absolute daily volume per channel, not only shares. Wrong: "paid social cannibalized organic" (shares fell, but absolute organic volume did not); reporting only the share shift; ignoring that the paid-social members buy Plus at a much lower rate (see Q12).

### Q12 — Which channel converts to Plus?
- **Prompt:** "Which acquisition channel brings members who actually pay? Is paid social worth it?"
- **Type:** attribution
- **Answer:** New members from **paid social buy Plus at a much lower rate** than other channels: 12.0% vs 21-24% for organic (21.2%), referral (20.7%), paid search (23.7%), and app-store ads (21.4%). Comparing signups from the same weeks, paid social's purchase rate is **about 0.52x** the other channels'. Spend per paying member: **paid social ≈ $112**, paid search ≈ $59, app-store ads ≈ $28. Paid social is the most expensive way to get a paying member. Accept 0.40x-0.65x.
- **Evidence:** H5-summer-shred-paid-social; Funnels or Insights `account created` → `subscription purchased` by `acquisition_channel`; warehouse spend; `-- EVAL Q12`.
- **Context needed:** 01-business.md (channels), 04-metrics-and-tables.md (cost per paying member).
- **Grading:** must compare paying rates, not signup volume. Bonus for controlling for signup week. Wrong: "paid social is our best channel" because it drove the most signups.

### Q13 — First-week behavior that predicts retention
- **Prompt:** "Is there something new members do in their first week that predicts whether they stick around?"
- **Type:** retention
- **Answer:** **The number of workouts completed in the first 7 days.** Week-4 retention (any activity in days 28-34 after signup) climbs with early workouts: **0 workouts 16.9%**, 1 → 26.5%, 2 → 30.5%, 3 → 38.4%, 4 → 49.1%, **5 or more 51.7%** (5+ vs 0 ≈ **3.1x**). There is no single cliff; the curve rises in steps and flattens at about 5 (5 → 53.9%, 6+ → 50.3%). Grouped: 0 → 16.9%, 1-2 → 27.9%, 3-4 → 42.5%, 5+ → 51.7%. Split at 3: 45.8% (3+) vs 22.9% (0-2). 77% of new members (signed up by Aug 27) complete 0-2 workouts in their first week. A Mixpanel cohort version (workouts from the start of the signup week to 7 days after its end) gives the same shape: 15.5%, 26.2%, 33.3%, 48.2%. Accept a rising curve, 5+ vs 0 of 2.5x-3.7x, and rates within ±3 points.
- **Evidence:** H6-first-week-habit; Retention, birth `account created`, return any event, weekly unit, Week 4 bucket, segmented by per-signup-week cohorts on `workout completed` count (approximate first week), members who signed up by 2026-08-27; exact per-member first-week counts need the raw export; `-- EVAL Q13`.
- **Context needed:** 01-business.md (activation goal), 04-metrics-and-tables.md (Week-N retention definition).
- **Grading:** must define the behavior from the first week only and show that more early workouts means better retention. Wrong: using total workouts over the whole window (leaks the outcome into the cohort); claiming a hard threshold with no gain past it.

### Q14 — Team vs solo challenges
- **Prompt:** "Do team challenges get finished more often than solo challenges?"
- **Type:** funnel
- **Answer:** Yes. Per challenge (each `challenge_id` counted on its own), **team challenges complete 57.8%** (19,094 of 33,027) vs **solo 29.1%** (9,709 of 33,324), about **2x**. Accept 55%-63% team and 26%-32% solo.
- **Evidence:** H7-team-vs-solo-challenges; Funnels `challenge joined` → `challenge completed`, totals, hold `challenge_id` constant, breakdown `challenge_format`; `-- EVAL Q14`.
- **Context needed:** 03-event-dictionary.md (challenge_id), 04-metrics-and-tables.md.
- **Grading:** must count per challenge. Wrong: unique-member funnel rates (members join many challenges, so 84.7% of team joiners and 66.5% of solo joiners complete at least one, which hides most of the gap).

### Q15 — Too many notifications?
- **Prompt:** "Are we sending too many notifications? Is there a point where people stop opening them?"
- **Type:** segmentation
- **Answer:** Yes. Open rates fall as the number of notifications a member gets rises. By a member's notification count in the window: under 12 → **19.5%**, 12-23 → 17.5%, 24-35 → 14.7%, 36-47 → 11.8%, 48+ → **9.6%**. The driver is recent volume: by how many other notifications the member received in the previous 30 days (notifications from Jul 4, when the 30-day look-back is complete), 0-4 → **20.1%** (a normal rate for fitness-app notifications; 47% of notifications), 5-7 → 17.2%, 8-11 → 11.5%, 12-15 → 8.2%, 16+ → **7.5%**. About 15% of notifications go out to members who already had 12 or more in the last 30 days, and 1,115 members (16% of members with notifications) reached that level at some point. The overall open rate is flat over time (15.9%, 16.3%, 16.2%, 16.1% for June-September), so this is a volume effect, not a calendar trend. Accept: decline begins around 5 notifications in 30 days (or about a dozen in the window per member), settles near 8% (±2 points, or 0.33x-0.45x of the fresh rate) at about 12+ in 30 days, gradual rather than a single step, and no time trend.
- **Evidence:** H8-push-fatigue; Insights, `notification received`, share `opened = true`, broken down by cohorts on notification count; recent-volume read from the raw export or the `-- EVAL Q15` query.
- **Context needed:** 01-business.md (lifecycle goal), 02-timeline.md (caps under review; sending rules unchanged).
- **Grading:** must show that open rate depends on how many notifications a member has received recently (or in total), and give a level where it drops. Wrong: "no effect"; "a hard cutoff at exactly N"; "open rates have been falling since July" or crediting the July 20 org change (the monthly open rate is flat).

### Q16 — Did Fall Reset work?
- **Prompt:** "Did the Fall Reset program actually get people working out more?"
- **Type:** trend
- **Answer:** Yes. During Fall Reset (Sep 8-21) vs the two weeks before, completed workouts rose from 20,122 to 30,188 while meal logging (not part of the program) was flat (10,838 → 11,139): workouts per meal logged rose **1.46x**. App opens rose modestly (11,905 → 14,724; 1.20x relative to meals), so completed workouts per app open rose **1.21x** (1.69 → 2.05). Workout planning and progress checks show the same pattern (progress checks per completed workout stayed at 0.64). Accept a workout lift of 1.35x-1.6x against an untouched baseline, and app opens up about 1.1x-1.3x.
- **Evidence:** H9-fall-reset-program; Insights, `workout completed`, `app opened`, `meal logged` daily, formulas; `-- EVAL Q16`.
- **Context needed:** 02-timeline.md (program dates).
- **Grading:** must compare against an untouched baseline (meals, or the period before) and separate workouts from app traffic. Wrong: crediting Labor Day; saying only app traffic rose; reporting raw counts without a baseline.

### Q17 — iOS vs Android onboarding (null)
- **Prompt:** "Do Android users finish onboarding at a lower rate than iOS users?"
- **Type:** null-hypothesis
- **Answer:** **No meaningful difference.** 7-day onboarding completion is **51.6% on Android (1,561 signups) vs 50.9% on iOS (2,513)**. The 0.7-point gap is well inside noise (two-proportion z = 0.46, p ≈ 0.65). Within each test variant the gap is not significant either (Control 45.6% vs 46.9%, p ≈ 0.63; Guided Plan 61.4% vs 58.7%, p ≈ 0.30; not enrolled 46.0% vs 44.9%, p ≈ 0.73). Platform has no role in onboarding in the product. Accept "no meaningful difference".
- **Evidence:** Funnels onboarding steps, breakdown `Platform`; `-- EVAL Q17`.
- **Context needed:** 03-event-dictionary.md.
- **Grading:** a correct answer says the platforms convert about the same and treats the small gap as noise (ideally with a significance check). Wrong: "yes, Android is lower".

### Q18 — Did the sync incident affect other activity? (null)
- **Prompt:** "During the August sync incident, did members also stop logging meals or using the app?"
- **Type:** null-hypothesis
- **Answer:** **No.** Meals logged per app open were **0.924 during the incident vs 0.906** in the surrounding week (1.02x), and app opens per day were normal (921 vs 888). Only wearable-synced workouts were affected. Accept "no meaningful change" (within ±5%).
- **Evidence:** `-- EVAL Q18`; Insights, `meal logged` and `app opened`, daily.
- **Context needed:** 02-timeline.md.
- **Grading:** must check the data. Wrong: "engagement fell across the board".

### Q19 — Bookings by month
- **Prompt:** "What were our new subscription bookings by month this summer, gross and net of store fees?"
- **Type:** external-join
- **Answer:** From `subscription_billing_daily`: **June (from Jun 4, 27 days) $10,817 gross / $9,194 net** (250 new subscriptions); **July $15,270 / $12,979** (345); **August $12,070 / $10,259** (313); **September $10,028 / $8,524** (187); October 1 only $190 / $161 (7). Net is gross minus the 15% store fee. Per day, new subscriptions ran 9.3 in June, 11.1 in July, 10.1 in August, and 6.2 in September; weekly volume was steady through June (no ramp-up from zero). July was the strongest month; September bookings fell about 17% from August (Monthly gross −$1,342 after the price change, Annual −$700). The billing counts differ slightly from Mixpanel purchases (250/345/313/187 vs 250/345/311/189) because of settlement timing, failed or refunded first payments, and store-page purchases. Accept within ±1%.
- **Evidence:** warehouse `subscription_billing_daily`; `-- EVAL Q19`.
- **Context needed:** 04-metrics-and-tables.md (billing table, first-payment caveat), 02-timeline.md.
- **Grading:** must use the warehouse table (prices are not in events) and note that June is a partial month (start June 4). Normalized per day, July is still the high point (11.1 vs 9.3 per day in June). Credit an answer that links July to more new members buying: Summer Shred sign-ups (paid-social members bought 61 subscriptions in July vs 10-31 in other months) and the Guided Plan variant from July 1. Wrong: reading the raw June-to-July rise without normalizing for days; multiplying purchases by a single price; using Mixpanel purchase counts as bookings without the warehouse price.

### Q20 — What to worry about in Q4
- **Prompt:** "Looking at this data, what should we worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names most of these, with numbers:
  1. **Paid social quality and cost**: Summer Shred did add members (1.36x daily signups, about 334 extra, about $22 each in extra spend), but paid-social members buy Plus at about half the rate of same-week signups from other channels (0.52x), the campaign doubled paid-social cost per signup ($8.95 → $18.03), and a paying member costs about $112 via paid social vs $28-59 elsewhere.
  2. **Monthly price change**: Monthly purchases fell to about 0.60x of the Annual trend after Sep 1 and Monthly bookings relative to Annual fell to about 0.70x; the increase did not pay off so far, and September bookings fell about 17% from August.
  3. **Activation**: 77% of new members do 0-2 workouts in their first week; Week-4 retention climbs from 17% (0 workouts) to 52% (5+). Members who finish onboarding buy Plus about twice as often (25% vs 13%). Ship Guided Plan (1.29x onboarding completion, about 30% faster).
  4. **Notification fatigue**: open rates fall from 20% to about 8% once a member has had 12 or more notifications in 30 days, and about 15% of notifications go out at that level. Set a frequency cap.
  5. **Wearable partner reliability**: a 3-day partner incident lost about 75% of watch and band workouts.
  Positive signals to keep: Stride Coach adoption ramped to about 44% of Plus workouts within three weeks and coached sessions run about 20% longer; team challenges finish at 2x the solo rate; Fall Reset lifted workouts about 1.5x against untouched activity. Long-time free members convert slowly (about 8% bought Plus in the window).
- **Evidence:** H1-H9; `-- EVAL Q20` (headline numbers).
- **Context needed:** all guides.
- **Grading:** full credit for at least four risks with supporting numbers and at least one recommended action. Partial credit for risks without numbers. Wrong: a generic list not grounded in the data.
