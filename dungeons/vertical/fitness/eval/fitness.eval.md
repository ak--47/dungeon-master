# Stridewell (fitness) — 20-question eval

- **Data:** `data/verify-fitness` (full fidelity: 9,038 members with events, 4,059 new-member signups, 1,161,252 events, 2026-06-04 → 2026-10-01 UTC). The USERS file holds 9,043 profiles: 5 pre-existing members have a profile but no events in the window. Member counts in the answers use members with events.
- **Run date:** 2026-10-06 (fix round on engine 52e81c4: engine-placed UTC signups, weekly and daily rhythm, Fall Reset sessions with their own workout details, lower paid share among long-time members; every number re-measured)
- **Period labels:** "August" and "September" always mean calendar months (Aug 1-31, Sep 1-30). "Before / after the price change" means before Sep 1 / Sep 1 through Oct 1.
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query in `dungeons/vertical/fitness/fitness.sql` on that data.
- **Stories:** ids refer to the `stories` export in `fitness.js` (H1-H9).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Did the onboarding test work?
- **Prompt:** "We've been running the Guided First Week onboarding test since July. Is the Guided Plan variant actually better? By how much?"
- **Type:** funnel
- **Answer:** Yes. 7-day onboarding completion (account created → goal quiz completed → plan generated → starter workout completed): **Guided Plan 59.3%** (920 of 1,552) vs **Control 44.6%** (692 of 1,551), a **relative lift of about 1.33x** (+14.7 points). Accept 1.17x-1.43x and rates within ±1.5 points. Bonus: finishing onboarding goes with buying. Across all new members, 24.7% of those who finish buy Plus vs 12.6% of those who do not (non-finishers also log about half as many workouts: 3.4 vs 6.6). Guided Plan has slightly more buyers per enrolled signup so far (17.5% vs 16.1%), but that gap is not yet significant (z ≈ 1.0).
- **Evidence:** H1-guided-first-week; Funnels report with the four onboarding steps, 7-day window, breakdown by user property `Experiment: Guided First Week`; `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (test start and enrollment), 03-event-dictionary.md (onboarding events, experiment property).
- **Grading:** must restrict to enrolled members (signups from 2026-07-01) and compare variants on the same funnel. Wrong answers: comparing all new members before vs after July 1; counting `workout completed` instead of `starter workout completed`; reporting the lift as absolute points only without the rates; claiming members who skip onboarding never buy (12.6% of them do); claiming Guided Plan already produced significantly more buyers.

### Q2 — Is onboarding faster in the new variant?
- **Prompt:** "For people who finish onboarding, how long does it take in each variant of the Guided First Week test?"
- **Type:** funnel
- **Answer:** Median time from signup to starter workout: **Guided Plan ≈ 12.7 hours vs Control ≈ 18.1 hours**, about **0.70x** the control time (about 30% faster). Accept 0.63x-0.77x.
- **Evidence:** H1-guided-first-week; Funnels time-to-convert, same steps, breakdown by variant; `-- EVAL Q2`.
- **Context needed:** 03-event-dictionary.md.
- **Grading:** must use medians (or say the mean shows the same direction) on converters only. Wrong: computing time to `workout completed`.

### Q3 — Stride Coach and workout length
- **Prompt:** "What happened to workout duration after we launched Stride Coach?"
- **Type:** trend
- **Answer:** After the 2026-08-12 launch, Plus workouts done with Stride Coach (`coaching_mode = ai_coach`) average **49.9 minutes vs 41.4 minutes** for self-guided Plus workouts, about **1.21x longer**. Self-guided Plus workouts did not change (41.6 min before launch, 41.4 after). Free workouts are all self-guided. Accept 1.12x-1.28x.
- **Evidence:** H2-stride-coach-launch; Insights, `workout completed`, average `duration_minutes`, breakdown `coaching_mode`, filter `subscription_tier` ≠ free; `-- EVAL Q3`.
- **Context needed:** 02-timeline.md (launch date, Plus only), 01-business.md.
- **Grading:** must separate AI-coached from self-guided workouts and restrict to Plus. Wrong: comparing all workouts before vs after launch (41.5 → 42.5 minutes, about 1.02x, because it mixes in self-guided and free workouts and the adoption ramp).

### Q4 — Stride Coach adoption
- **Prompt:** "What share of Plus workouts use Stride Coach since it launched? Is adoption growing?"
- **Type:** segmentation
- **Answer:** Adoption **ramped for about three weeks, then leveled off near 44-46%**. Weekly share of Plus members' completed workouts with Stride Coach: 20.6% in the launch week (week of Aug 10, partial), 27.9%, 39.9%, 44.8%, then 43.7%-46.1% every week in September. Since launch overall: 40.7%; from Sep 2: 45.0%. Use varies by member: among the 720 Plus members with 10+ workouts since Sep 2, 41.0% never use Stride Coach, 6.8% use it for under half of their workouts (1.0% under 25%, 5.8% for 25-49%), 15.6% for 50-74%, and 36.7% for 75% or more. Accept a ramp that plateaus at 40%-48%, and a note that about 40% of Plus members do not use it while users vary in how much they use it.
- **Evidence:** H2-stride-coach-launch; Insights, `workout completed`, filter `subscription_tier` ≠ free and after launch, breakdown `coaching_mode`, weekly; per-member split needs a breakdown by user or the raw export; `-- EVAL Q4`.
- **Context needed:** 02-timeline.md, 04-metrics-and-tables.md (adoption definition).
- **Grading:** denominator is Plus workouts, not all workouts. Wrong: share of all workouts (much lower); "still growing steadily" (it plateaued in September); "every Plus member uses it a little" (about 40% never use it, and most users use it for half or more of their workouts).

### Q5 — Do Stride Coach workouts push people harder? (null)
- **Prompt:** "Stride Coach sessions run longer. Are people also working harder in them — higher heart rate or effort?"
- **Type:** null-hypothesis
- **Answer:** **No meaningful difference in intensity.** Plus workouts after launch: average heart rate **125.7 vs 126.2 bpm** (ai_coach vs self-guided); perceived effort 5.99 vs 5.99; calories per minute 6.28 vs 6.33. Stride Coach sessions burn more total calories only because they last longer (313.5 vs 261.8 calories per workout, about the same 1.20x as duration). Accept any answer that says intensity did not change (heart rate and effort within ±2%).
- **Evidence:** Insights, `workout completed`, average `avg_heart_rate` and `perceived_effort` (and calories ÷ minutes), breakdown `coaching_mode`, Plus and after launch; `-- EVAL Q5`.
- **Context needed:** 03-event-dictionary.md.
- **Grading:** must check intensity directly, not infer it from total calories. Wrong: "yes, they burn about 20% more calories, so they are harder workouts" (the extra calories come from the extra minutes).

### Q6 — The late-August dip
- **Prompt:** "Workout logging looks like it dropped for a few days in late August. What happened and how big was it?"
- **Type:** external-join
- **Answer:** The **2026-08-20 to 2026-08-22 wearable sync incident** at the health-data partner. On those three days (Thursday to Saturday), smartwatch and fitness-band workouts fell to about **131 per day, from about 524 per day** on the same weekdays one week before and after, while all other workouts (phone, manual, chest strap) held steady (642 vs 649 per day). Against the full 7 days on each side, unaffected workouts read lower (642 vs 766 per day) only because Friday and Saturday are quiet days. Relative to the unaffected workouts, watch and band workouts ran at **about 25%** of normal (0.250 ratio of ratios vs the 7 days on each side). The warehouse table `wearable_sync_daily` shows `sync_error_rate` ≈ 0.75 and `partner_api_status = major_outage` on exactly those days. Workouts that failed to sync are missing from Mixpanel. Accept 0.20-0.30.
- **Evidence:** H3-wearable-sync-outage; Insights daily `workout completed` by `tracking_source` and `wearable_type`; warehouse join on date and `wearable_type`; `-- EVAL Q6`.
- **Context needed:** 02-timeline.md (incident dates), 04-metrics-and-tables.md (`wearable_sync_daily`).
- **Grading:** must name the incident, the dates, the device scope, and a size. Wrong: blaming the dip on members working out less (phone workouts held steady against the same weekdays), or on the Stride Coach launch.

### Q7 — Which devices were hit?
- **Prompt:** "Was the August sync incident only smartwatches, or did it hit other trackers too?"
- **Type:** external-join
- **Answer:** **Smartwatches and fitness bands** were hit: during the incident they ran at 0.24x (smartwatch) and 0.26x (fitness band) of their normal level relative to phone workouts. **Chest straps** (0.93x) and **manual entries** (0.96x) were not hit. The warehouse agrees: `major_outage` with a 0.74-0.76 error rate for smartwatch and fitness_band only; chest_strap stayed `operational` (≈0.9% errors). Accept 0.15-0.35 for affected devices and 0.85-1.2 for unaffected.
- **Evidence:** H3-wearable-sync-outage; `-- EVAL Q7`.
- **Context needed:** 04-metrics-and-tables.md (`wearable_sync_daily`), 03-event-dictionary.md (`tracking_source`, `wearable_type`).
- **Grading:** must separate chest straps from watches and bands. Wrong: "all wearables".

### Q8 — Did the price change hurt sign-ups?
- **Prompt:** "Did the September Plus Monthly price increase hurt new subscriptions?"
- **Type:** trend
- **Answer:** **Yes, for Monthly.** Annual (whose price did not change) is the control. Monthly purchases per Annual purchase fell from **2.23 before Sep 1 to 1.28 after**, a ratio of **0.57** (about 43% fewer Monthly purchases than the Annual trend predicts). August vs September (calendar months): Monthly 215 → 125 (−42%) while Annual 98 → 98 (no change); Monthly share of new subscriptions 68.7% → 56.1%. Accept a ratio of 0.45-0.8 (the post-change period holds about 230 purchases, so the ratio is noisy).
- **Evidence:** H4-monthly-price-change; Insights, `subscription purchased`, breakdown `plan`, weekly; `-- EVAL Q8`.
- **Context needed:** 02-timeline.md (price change), 01-business.md (plans).
- **Grading:** must use a control or mix analysis. Wrong: reading only the total (313 → 223 purchases) with no control. The answer must show that the drop sits in Monthly while Annual, whose price did not change, held flat (98 → 98); the gap between the plans is the price signal. Also wrong: claiming no effect.

### Q9 — Did the price change pay off in bookings?
- **Prompt:** "Even if we sold fewer monthly plans, did the higher price bring in more monthly bookings?"
- **Type:** external-join
- **Answer:** **No.** Joining Mixpanel purchases to `list_price_usd`, Monthly gross bookings fell from **$2,793 in August (215 × $12.99) to $1,874 in September (125 × $14.99)** while Annual bookings held at $9,799 (98 × $99.99 in both months). Relative to Annual, Monthly bookings from Sep 1 are **0.66x** of before: the 15% higher price did not make up for the lost volume. Reading the billing table alone gives the same answer: Monthly $2,741 (211) → $1,934 (129), Annual $10,399 (104) → $9,799 (98), ratio 0.69x. Accept 0.6-0.88 from either source and "did not pay off".
- **Evidence:** H4-monthly-price-change; warehouse `subscription_billing_daily` joined to `subscription purchased` on date and plan; `-- EVAL Q9`.
- **Context needed:** 04-metrics-and-tables.md (billing table and its first-payment caveat), 02-timeline.md.
- **Grading:** must use warehouse prices (price is not on events). Wrong: multiplying all purchases by $14.99; reading the Monthly drop without the Annual control.

### Q10 — Summer Shred CAC
- **Prompt:** "What did a paid social signup cost us during Summer Shred compared with the rest of the period?"
- **Type:** external-join
- **Answer:** Paid social spend per Mixpanel signup was **$18.08 during Summer Shred (Jun 15-Jul 14) vs $8.94 outside it**, about **2.02x**. Spend: $8,406 for 465 signups in the campaign vs $4,606 for 515 signups outside. Paid search ($13.79 vs $14.02) and app-store ads ($6.02 vs $6.02) cost the same per signup in and out of the campaign. Daily cost per signup varies by about ±10% around those levels. Accept 1.8x-2.2x.
- **Evidence:** H5-summer-shred-paid-social; warehouse `paid_acquisition_daily.spend_usd` joined to `account created` by date and `acquisition_channel`; `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (campaign dates), 04-metrics-and-tables.md (CAC definition, spend table).
- **Grading:** must divide by Mixpanel signups, not `platform_reported_installs`. Wrong: using platform installs (understates CAC about 8%); comparing total spend only.

### Q11 — Did Summer Shred add new members?
- **Prompt:** "Did Summer Shred actually bring in extra members, or did paid social just take credit for people who would have joined anyway?"
- **Type:** attribution
- **Answer:** **It added real members.** New-member signups ran at **41.0 per day during the campaign vs 31.4 per day** in the rest of the window (**1.30x**), about **286 extra members** over the 30 days. The extra came through paid social: 15.5 vs 5.7 paid-social signups per day (2.7x; share of signups 18.2% → 37.8%). Every other channel held its normal daily volume (combined 0.99x): organic 10.5 vs 10.8, referral 5.4 vs 5.0, paid search 4.2 vs 4.2, app-store ads 5.4 vs 5.7. None of those per-channel moves is distinguishable from day-to-day noise (|z| ≤ 0.7 against the outside-campaign rate). There is no sign of cannibalization. Extra paid-social spend was about $6,871, or **about $24 per extra member** (higher than the $18.08 average because the campaign also paid double for paid-social members who would have come anyway). Accept a lift of 1.2x-1.5x, 250-420 extra members, and $17-$27 per extra member.
- **Evidence:** H5-summer-shred-paid-social; Insights, `account created`, breakdown `acquisition_channel`, daily or weekly, compare date ranges; warehouse spend for the cost; `-- EVAL Q11`.
- **Context needed:** 02-timeline.md (campaign dates), 04-metrics-and-tables.md (spend table).
- **Grading:** must compare absolute daily volume per channel, not only shares. Wrong: "paid social cannibalized organic" (shares fell, but absolute organic volume did not); reporting only the share shift; ignoring that the paid-social members buy Plus at a much lower rate (see Q12).

### Q12 — Which channel converts to Plus?
- **Prompt:** "Which acquisition channel brings members who actually pay? Is paid social worth it?"
- **Type:** attribution
- **Answer:** New members from **paid social buy Plus at a much lower rate** than other channels. Counting a purchase at any time after signup (a 120-day conversion window covers the whole dataset): paid social 10.7% vs 19-22% for organic (21.8%), referral (21.7%), paid search (22.2%), and app-store ads (19.1%). With Mixpanel's default 30-day funnel window the rates are lower and the gap is the same: paid social 9.9% vs 19.0% for all other channels. Comparing signups from the same weeks, paid social's purchase rate is **about 0.46x** the other channels'. Spend per paying member: **paid social ≈ $124**, paid search ≈ $63, app-store ads ≈ $31. Paid social is the most expensive way to get a paying member. Accept 0.40x-0.65x, and rates from either window if the answer names it.
- **Evidence:** H5-summer-shred-paid-social; Funnels `account created` → `subscription purchased`, breakdown `acquisition_channel`, uniques, conversion window 120 days (or the default 30 days, which reads lower rates); warehouse spend; `-- EVAL Q12`.
- **Context needed:** 01-business.md (channels), 04-metrics-and-tables.md (cost per paying member).
- **Grading:** must compare paying rates, not signup volume. Bonus for controlling for signup week. Wrong: "paid social is our best channel" because it drove the most signups.

### Q13 — First-week behavior that predicts retention
- **Prompt:** "Is there something new members do in their first week that predicts whether they stick around?"
- **Type:** retention
- **Answer:** **The number of workouts completed in the first 7 days.** Week-4 retention (any activity in days 28-34 after signup) climbs with early workouts: **0 workouts 15.1%**, 1 → 23.4%, 2 → 32.7%, 3 → 38.8%, 4 → 41.7%, **5 or more 51.5%** (5+ vs 0 ≈ **3.4x**). There is no single cliff; the curve rises in steps and flattens at about 5 (5 → 59.7% and 6+ → 46.2%, both small groups of 77 and 117 members). Grouped: 0 → 15.1%, 1-2 → 27.1%, 3-4 → 39.8%, 5+ → 51.5%. Split at 3: 43.4% (3+) vs 21.8% (0-2). 79% of new members (signed up by Aug 27) complete 0-2 workouts in their first week. A Mixpanel cohort version (workouts from the start of the signup week to 7 days after its end) gives the same shape: 14.4%, 23.6%, 35.3%, 45.9%. Accept a rising curve, 5+ vs 0 of 2.5x-3.7x, and rates within ±3 points.
- **Evidence:** H6-first-week-habit; Retention, birth `account created`, return any event, weekly unit, Week 4 bucket, segmented by per-signup-week cohorts on `workout completed` count (approximate first week), members who signed up by 2026-08-27; exact per-member first-week counts need the raw export; `-- EVAL Q13`.
- **Context needed:** 01-business.md (activation goal), 04-metrics-and-tables.md (Week-N retention definition).
- **Grading:** must define the behavior from the first week only and show that more early workouts means better retention. Wrong: using total workouts over the whole window (leaks the outcome into the cohort); claiming a hard threshold with no gain past it.

### Q14 — Team vs solo challenges
- **Prompt:** "Do team challenges get finished more often than solo challenges?"
- **Type:** funnel
- **Answer:** Yes. Per challenge (each `challenge_id` counted on its own), **team challenges complete 57.8%** (18,403 of 31,861) vs **solo 29.0%** (9,324 of 32,145), about **2x**. Accept 55%-63% team and 26%-32% solo.
- **Evidence:** H7-team-vs-solo-challenges; Funnels `challenge joined` → `challenge completed`, totals, hold `challenge_id` constant, breakdown `challenge_format`; `-- EVAL Q14`.
- **Context needed:** 03-event-dictionary.md (challenge_id), 04-metrics-and-tables.md.
- **Grading:** must count per challenge. Wrong: unique-member funnel rates (members join many challenges, so 83.9% of team joiners and 64.9% of solo joiners complete at least one, which hides most of the gap).

### Q15 — Too many notifications?
- **Prompt:** "Are we sending too many notifications? Is there a point where people stop opening them?"
- **Type:** segmentation
- **Answer:** Yes. Open rates fall as the number of notifications a member gets rises. By a member's notification count in the window: under 12 → **19.7%**, 12-23 → 17.7%, 24-35 → 14.6%, 36-47 → 12.1%, 48+ → **10.7%**. The driver is recent volume: by how many other notifications the member received in the previous 30 days (notifications from Jul 4, when the 30-day look-back is complete), 0-4 → **20.2%** (a normal rate for fitness-app notifications; 47% of notifications), 5-7 → 17.0%, 8-11 → 12.3%, 12-15 → 7.9%, 16+ → **9.1%** (12+ combined 8.4%). About 15% of notifications go out to members who already had 12 or more in the last 30 days, and 1,145 members (16% of members with notifications) reached that level at some point. The overall open rate is flat over time (16.0%, 16.5%, 16.3%, 16.6% for June-September), so this is a volume effect, not a calendar trend. Accept: decline begins around 5 notifications in 30 days (or about a dozen in the window per member), settles near 8% (±2 points, or 0.33x-0.45x of the fresh rate) at about 12+ in 30 days, gradual rather than a single step, and no time trend.
- **Evidence:** H8-push-fatigue; Insights, `notification received`, share `opened = true`, broken down by cohorts on notification count; recent-volume read from the raw export or the `-- EVAL Q15` query.
- **Context needed:** 01-business.md (lifecycle goal), 02-timeline.md (caps under review; sending rules unchanged).
- **Grading:** must show that open rate depends on how many notifications a member has received recently (or in total), and give a level where it drops. Wrong: "no effect"; "a hard cutoff at exactly N"; "open rates have been falling since July" or crediting the July 20 org change (the monthly open rate is flat).

### Q16 — Did Fall Reset work?
- **Prompt:** "Did the Fall Reset program actually get people working out more?"
- **Type:** trend
- **Answer:** Yes. During Fall Reset (Sep 8-21) vs the two weeks before, completed workouts rose from 19,734 to 29,136 while meal logging (not part of the program) was flat (11,190 → 11,080): workouts per meal logged rose **1.49x**. App opens rose modestly (12,366 → 14,702; 1.20x relative to meals), so completed workouts per app open rose **1.24x** (1.60 → 1.98). Workout planning and progress checks show the same pattern (progress checks per completed workout stayed at 0.64). Accept a workout lift of 1.35x-1.6x against an untouched baseline, and app opens up about 1.1x-1.3x.
- **Evidence:** H9-fall-reset-program; Insights, `workout completed`, `app opened`, `meal logged` daily, formulas; `-- EVAL Q16`.
- **Context needed:** 02-timeline.md (program dates).
- **Grading:** must compare against an untouched baseline (meals, or the period before) and separate workouts from app traffic. Wrong: crediting Labor Day; saying only app traffic rose; reporting raw counts without a baseline.

### Q17 — iOS vs Android onboarding (null)
- **Prompt:** "Do Android users finish onboarding at a lower rate than iOS users?"
- **Type:** null-hypothesis
- **Answer:** **No meaningful difference.** 7-day onboarding completion is **51.3% on Android (1,517 signups) vs 50.8% on iOS (2,542)**. The 0.5-point gap is well inside noise (two-proportion z = 0.31, p ≈ 0.76). Within each test variant the gap is not significant either (Control 45.1% vs 44.3%, p ≈ 0.75; Guided Plan 60.5% vs 58.6%, p ≈ 0.47; not enrolled 46.8% vs 48.4%, p ≈ 0.64). Platform has no role in onboarding in the product. Accept "no meaningful difference".
- **Evidence:** Funnels onboarding steps, breakdown `Platform`; `-- EVAL Q17`.
- **Context needed:** 03-event-dictionary.md.
- **Grading:** a correct answer says the platforms convert about the same and treats the small gap as noise (ideally with a significance check). Wrong: "yes, Android is lower".

### Q18 — Did the sync incident affect other activity? (null)
- **Prompt:** "During the August sync incident, did the members whose watch or band workouts stopped syncing also log fewer meals or open the app less?"
- **Type:** null-hypothesis
- **Answer:** **No.** Against other members and the 7 days on each side, smartwatch and fitness-band owners logged meals at **1.00x** (z = 0.05, p ≈ 0.96) and opened the app at **0.94x** (z = −1.2, p ≈ 0.22): inside noise. Meals logged per app open across all members were 0.923 during the incident vs 0.905 in the surrounding week (1.02x). App opens for everyone ran 700 per day vs 787 on the same weekdays one week before and after, but that applies equally to members with and without watches or bands, and the incident's Thursday-Saturday total (2,100 opens) sits inside the range of the same three days in the other 13 full weeks (2,015-2,470). Only wearable-synced workouts were affected. Accept "no meaningful change".
- **Evidence:** `-- EVAL Q18`; Insights, `meal logged` and `app opened`, daily, breakdown user property `wearable_type`, compare Aug 20-22 with Aug 13-19 and Aug 23-29.
- **Context needed:** 02-timeline.md (incident dates), 03-event-dictionary.md (`wearable_type`).
- **Grading:** must check the data and compare the affected members with a control. Wrong: "engagement fell across the board" or "affected members gave up on the app"; reading the all-member dip in app opens as an incident effect without a control.

### Q19 — Bookings by month
- **Prompt:** "What were our new subscription bookings by month this summer, gross and net of store fees?"
- **Type:** external-join
- **Answer:** From `subscription_billing_daily`: **June (from Jun 4, 27 days) $10,484 gross / $8,912 net** (278 new subscriptions); **July $14,316 / $12,169** (352); **August $13,140 / $11,169** (315); **September $11,733 / $9,973** (227); October 1 only $245 / $208 (5). Net is gross minus the 15% store fee. Per day, new subscriptions ran 10.3 in June, 11.4 in July, 10.2 in August, and 7.6 in September. June has no ramp from zero: its weekly volume varies between about 9 and 11 per day (8.9-11.4), the same range as July and August (9.4-12.1). July was the strongest month; September bookings fell about 11% from August (Monthly gross −$807 after the price change, Annual −$600). The billing counts differ slightly from Mixpanel purchases (278/352/315/227 vs 279/351/313/223) because of settlement timing, failed or refunded first payments, and store-page purchases. Accept within ±1%.
- **Evidence:** warehouse `subscription_billing_daily`; `-- EVAL Q19`.
- **Context needed:** 04-metrics-and-tables.md (billing table, first-payment caveat), 02-timeline.md.
- **Grading:** must use the warehouse table (prices are not in events) and note that June is a partial month (start June 4). Normalized per day, July is still the high point (11.4 vs 10.3 per day in June). Credit an answer that links July to more new members buying: Summer Shred sign-ups (new paid-social members bought 55 subscriptions in July vs 12-25 in the other full months) and the Guided Plan variant from July 1. Wrong: reading the raw June-to-July rise without normalizing for days; multiplying purchases by a single price; using Mixpanel purchase counts as bookings without the warehouse price.

### Q20 — What to worry about in Q4
- **Prompt:** "Looking at this data, what should we worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names most of these, with numbers:
  1. **Paid social quality and cost**: Summer Shred did add members (1.30x daily signups, about 286 extra, about $24 each in extra spend), but paid-social members buy Plus at about half the rate of same-week signups from other channels (0.46x), the campaign doubled paid-social cost per signup ($8.94 → $18.08), and a paying member costs about $124 via paid social vs $31-63 elsewhere.
  2. **Monthly price change**: Monthly purchases fell to about 0.57x of the Annual trend after Sep 1 and Monthly bookings relative to Annual fell to about 0.66x; the increase did not pay off so far, and September bookings fell about 11% from August.
  3. **Activation**: 79% of new members do 0-2 workouts in their first week; Week-4 retention climbs from 15% (0 workouts) to 52% (5+). Members who finish onboarding buy Plus about twice as often (25% vs 13%). Ship Guided Plan (1.33x onboarding completion, about 30% faster).
  4. **Notification fatigue**: open rates fall from 20% to about 8% once a member has had 12 or more notifications in 30 days, and about 15% of notifications go out at that level. Set a frequency cap.
  5. **Wearable partner reliability**: a 3-day partner incident lost about 75% of watch and band workouts.
  Positive signals to keep: Stride Coach adoption ramped to about 45% of Plus workouts within three weeks and coached sessions run about 20% longer; team challenges finish at 2x the solo rate; Fall Reset lifted workouts about 1.5x against untouched activity. Long-time free members convert slowly (about 8% bought Plus in the window).
- **Evidence:** H1-H9; `-- EVAL Q20` (headline numbers).
- **Context needed:** all guides.
- **Grading:** full credit for at least four risks with supporting numbers and at least one recommended action. Partial credit for risks without numbers. Wrong: a generic list not grounded in the data.
