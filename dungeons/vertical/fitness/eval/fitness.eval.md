# Stridewell (fitness) — 20-question eval

- **Data:** `data/verify-fitness` (full fidelity: 9,014 members with events, 4,128 new-member signups, 1,190,916 events, 2026-06-04 → 2026-10-01 UTC). The USERS file holds 9,019 profiles: 5 pre-existing members have a profile but no events in the window. Member counts in the answers use members with events.
- **Run date:** 2026-10-06 (re-run after the hashFloat finalizer change; all salted cohorts re-drawn)
- **Period labels:** "August" and "September" always mean calendar months (Aug 1-31, Sep 1-30). "Before / after the price change" means before Sep 1 / Sep 1 through Oct 1.
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query in `dungeons/vertical/fitness/fitness.sql` on that data.
- **Stories:** ids refer to the `stories` export in `fitness.js` (H1-H9).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Did the onboarding test work?
- **Prompt:** "We've been running the Guided First Week onboarding test since July. Is the Guided Plan variant actually better? By how much?"
- **Type:** funnel
- **Answer:** Yes. 7-day onboarding completion (account created → goal quiz completed → plan generated → starter workout completed): **Guided Plan 58.5%** (920 of 1,574) vs **Control 44.0%** (672 of 1,527), a **relative lift of about 1.33x** (+14.4 points). Accept 1.17x-1.43x and rates within ±1.5 points. Bonus: members who finish onboarding are the ones who go on to buy Plus, so Guided Plan also produced more buyers (268 of 1,574, 17.0%, vs 209 of 1,527, 13.7%).
- **Evidence:** H1-guided-first-week; Funnels report with the four onboarding steps, 7-day window, breakdown by user property `Experiment: Guided First Week`; `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (test start and enrollment), 03-event-dictionary.md (onboarding events, experiment property).
- **Grading:** must restrict to enrolled members (signups from 2026-07-01) and compare variants on the same funnel. Wrong answers: comparing all new members before vs after July 1; counting `workout completed` instead of `starter workout completed`; reporting the lift as absolute points only without the rates.

### Q2 — Is onboarding faster in the new variant?
- **Prompt:** "For people who finish onboarding, how long does it take in each variant of the Guided First Week test?"
- **Type:** funnel
- **Answer:** Median time from signup to starter workout: **Guided Plan ≈ 12.6 hours vs Control ≈ 17.9 hours**, about **0.70x** the control time (about 30% faster). Accept 0.63x-0.77x.
- **Evidence:** H1-guided-first-week; Funnels time-to-convert, same steps, breakdown by variant; `-- EVAL Q2`.
- **Context needed:** 03-event-dictionary.md.
- **Grading:** must use medians (or say the mean shows the same direction) on converters only. Wrong: computing time to `workout completed`.

### Q3 — Stride Coach and workout length
- **Prompt:** "What happened to workout duration after we launched Stride Coach?"
- **Type:** trend
- **Answer:** After the 2026-08-12 launch, Plus workouts done with Stride Coach (`coaching_mode = ai_coach`) average **50.0 minutes vs 41.7 minutes** for self-guided Plus workouts, about **1.20x longer**. Self-guided Plus workouts did not change (41.5 min before launch, 41.7 after). Free workouts are all self-guided. Accept 1.12x-1.28x.
- **Evidence:** H2-stride-coach-launch; Insights, `workout completed`, average `duration_minutes`, breakdown `coaching_mode`, filter `subscription_tier` ≠ free; `-- EVAL Q3`.
- **Context needed:** 02-timeline.md (launch date, Plus only), 01-business.md.
- **Grading:** must separate AI-coached from self-guided workouts and restrict to Plus. Wrong: comparing all workouts before vs after launch (41.5 → 43.2 minutes, about 1.04x, because it mixes in self-guided and free workouts and the adoption ramp).

### Q4 — Stride Coach adoption
- **Prompt:** "What share of Plus workouts use Stride Coach since it launched? Is adoption growing?"
- **Type:** segmentation
- **Answer:** Adoption **ramped for about three weeks, then leveled off near 43-45%**. Weekly share of Plus members' completed workouts with Stride Coach: 21.9% in the launch week (week of Aug 10, partial), 28.9%, 38.5%, 44.7%, then 42.9%-44.5% every week in September. Since launch overall: 39.7%; from Sep 2: 43.8%. Use varies by member: among the 1,155 Plus members with 10+ workouts since Sep 2, 41.2% never use Stride Coach, 7.8% use it for under half of their workouts (1.3% under 25%, 6.5% for 25-49%), 16.3% for 50-74%, and 34.7% for 75% or more. Accept a ramp that plateaus at 40%-48%, and a note that about 40% of Plus members do not use it while users vary in how much they use it.
- **Evidence:** H2-stride-coach-launch; Insights, `workout completed`, filter `subscription_tier` ≠ free and after launch, breakdown `coaching_mode`, weekly; per-member split needs a breakdown by user or the raw export; `-- EVAL Q4`.
- **Context needed:** 02-timeline.md, 04-metrics-and-tables.md (adoption definition).
- **Grading:** denominator is Plus workouts, not all workouts. Wrong: share of all workouts (much lower); "still growing steadily" (it plateaued in September); "every Plus member uses it a little" (about 40% never use it, and most users use it for half or more of their workouts).

### Q5 — Do Stride Coach workouts push people harder? (null)
- **Prompt:** "Stride Coach sessions run longer. Are people also working harder in them — higher heart rate or effort?"
- **Type:** null-hypothesis
- **Answer:** **No meaningful difference in intensity.** Plus workouts after launch: average heart rate **126.0 vs 126.0 bpm** (ai_coach vs self-guided); perceived effort 6.00 vs 6.01; calories per minute 7.72 vs 7.74. Stride Coach sessions burn more total calories only because they last longer (385.9 vs 322.6 calories per workout, about the same 1.20x as duration). Accept any answer that says intensity did not change (heart rate and effort within ±2%).
- **Evidence:** Insights, `workout completed`, average `avg_heart_rate` and `perceived_effort` (and calories ÷ minutes), breakdown `coaching_mode`, Plus and after launch; `-- EVAL Q5`.
- **Context needed:** 03-event-dictionary.md.
- **Grading:** must check intensity directly, not infer it from total calories. Wrong: "yes, they burn about 20% more calories, so they are harder workouts" (the extra calories come from the extra minutes).

### Q6 — The late-August dip
- **Prompt:** "Workout logging looks like it dropped for a few days in late August. What happened and how big was it?"
- **Type:** external-join
- **Answer:** The **2026-08-20 to 2026-08-22 wearable sync incident** at the health-data partner. On those three days, smartwatch and fitness-band workouts fell from about **683 per day to about 177 per day**, while all other workouts (phone, manual, chest strap) held steady (807 per day in both periods). Relative to those unaffected workouts, watch and band workouts ran at **about 26%** of normal (0.259 ratio of ratios vs the 7 days on each side). The warehouse table `wearable_sync_daily` shows `sync_error_rate` ≈ 0.75 and `partner_api_status = major_outage` on exactly those days. Workouts that failed to sync are missing from Mixpanel. Accept 0.20-0.30.
- **Evidence:** H3-wearable-sync-outage; Insights daily `workout completed` by `tracking_source` and `wearable_type`; warehouse join on date and `wearable_type`; `-- EVAL Q6`.
- **Context needed:** 02-timeline.md (incident dates), 04-metrics-and-tables.md (`wearable_sync_daily`).
- **Grading:** must name the incident, the dates, the device scope, and a size. Wrong: blaming the dip on members working out less (phone workouts and meal logging did not move), or on the Stride Coach launch.

### Q7 — Which devices were hit?
- **Prompt:** "Was the August sync incident only smartwatches, or did it hit other trackers too?"
- **Type:** external-join
- **Answer:** **Smartwatches and fitness bands** were hit: during the incident they ran at 0.24x (smartwatch) and 0.29x (fitness band) of their normal level relative to phone workouts. **Chest straps** (0.93x) and **manual entries** (1.01x, a small sample) were not hit. The warehouse agrees: `major_outage` with a 0.74-0.76 error rate for smartwatch and fitness_band only; chest_strap stayed `operational` (≈0.9% errors). Accept 0.2-0.35 for affected devices and 0.85-1.2 for unaffected.
- **Evidence:** H3-wearable-sync-outage; `-- EVAL Q7`.
- **Context needed:** 04-metrics-and-tables.md (`wearable_sync_daily`), 03-event-dictionary.md (`tracking_source`, `wearable_type`).
- **Grading:** must separate chest straps from watches and bands. Wrong: "all wearables".

### Q8 — Did the price change hurt sign-ups?
- **Prompt:** "Did the September Plus Monthly price increase hurt new subscriptions?"
- **Type:** trend
- **Answer:** **Yes, for Monthly.** Annual (whose price did not change) is the control. Monthly purchases per Annual purchase fell from **1.92 before Sep 1 to 1.44 after**, a ratio of **0.75** (about 25% fewer Monthly purchases than the Annual trend predicts). August vs September (calendar months): Monthly 155 → 117 (−25%) while Annual 87 → 84 (−3%); Monthly share of new subscriptions 64.0% → 58.2%. Accept a ratio of 0.6-0.88 (the post-change period holds about 210 purchases, so the ratio is noisy).
- **Evidence:** H4-monthly-price-change; Insights, `subscription purchased`, breakdown `plan`, weekly; `-- EVAL Q8`.
- **Context needed:** 02-timeline.md (price change), 01-business.md (plans).
- **Grading:** must use a control or mix analysis. Wrong: attributing the whole August-to-September drop in total purchases (242 → 201) to the price change without a control (Annual also dipped, 87 → 84, so part of the drop is not price); claiming no effect.

### Q9 — Did the price change pay off in bookings?
- **Prompt:** "Even if we sold fewer monthly plans, did the higher price bring in more monthly bookings?"
- **Type:** external-join
- **Answer:** **No.** Joining Mixpanel purchases to `list_price_usd`, Monthly gross bookings fell from **$2,013 in August (155 × $12.99) to $1,754 in September (117 × $14.99)** while Annual bookings moved from $8,699 to $8,399. Relative to Annual, Monthly bookings from Sep 1 are **0.87x** of before: the 15% higher price did not make up for the lost volume. Reading the billing table alone gives the same answer: Monthly $1,974 (152) → $1,799 (120), Annual $9,199 (92) → $8,799 (88), ratio 0.89x. Accept 0.75-0.97 from either source and "did not pay off".
- **Evidence:** H4-monthly-price-change; warehouse `subscription_billing_daily` joined to `subscription purchased` on date and plan; `-- EVAL Q9`.
- **Context needed:** 04-metrics-and-tables.md (billing table and its first-payment caveat), 02-timeline.md.
- **Grading:** must use warehouse prices (price is not on events). Wrong: multiplying all purchases by $14.99; ignoring that Annual also declined.

### Q10 — Summer Shred CAC
- **Prompt:** "What did a paid social signup cost us during Summer Shred compared with the rest of the period?"
- **Type:** external-join
- **Answer:** Paid social spend per Mixpanel signup was **$18.03 during Summer Shred (Jun 15-Jul 14) vs $8.96 outside it**, about **2.01x**. Spend: $9,158 for 508 signups in the campaign vs $4,867 for 543 signups outside. Paid search ($13.90 vs $13.96) and app-store ads ($6.06 vs $6.03) cost the same per signup in and out of the campaign. Daily cost per signup varies by about ±10% around those levels. Accept 1.8x-2.2x.
- **Evidence:** H5-summer-shred-paid-social; warehouse `paid_acquisition_daily.spend_usd` joined to `account created` by date and `acquisition_channel`; `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (campaign dates), 04-metrics-and-tables.md (CAC definition, spend table).
- **Grading:** must divide by Mixpanel signups, not `platform_reported_installs`. Wrong: using platform installs (understates CAC about 8%); comparing total spend only.

### Q11 — Did Summer Shred add new members?
- **Prompt:** "Did Summer Shred actually bring in extra members, or did paid social just take credit for people who would have joined anyway?"
- **Type:** attribution
- **Answer:** **It added real members.** New-member signups ran at **42.9 per day during the campaign vs 31.6 per day** in the rest of the window (**1.36x**), about **340 extra members** over the 30 days. The extra came through paid social: 16.9 vs 6.0 paid-social signups per day (2.8x; share of signups 19.1% → 39.5%). Every other channel held its normal daily volume (combined 1.02x): organic 10.8 vs 10.6, referral 5.2 vs 5.0, paid search 4.1 vs 4.4, app-store ads 5.8 vs 5.6. None of those per-channel moves is distinguishable from day-to-day noise (|z| ≤ 0.52 against the outside-campaign rate). There is no sign of cannibalization. Extra paid-social spend was about $7,536, or **about $22 per extra member** (higher than the $18.03 average because the campaign also paid double for paid-social members who would have come anyway). Accept a lift of 1.2x-1.5x, 250-420 extra members, and $17-$27 per extra member.
- **Evidence:** H5-summer-shred-paid-social; Insights, `account created`, breakdown `acquisition_channel`, daily or weekly, compare date ranges; warehouse spend for the cost; `-- EVAL Q11`.
- **Context needed:** 02-timeline.md (campaign dates), 04-metrics-and-tables.md (spend table).
- **Grading:** must compare absolute daily volume per channel, not only shares. Wrong: "paid social cannibalized organic" (shares fell, but absolute organic volume did not); reporting only the share shift; ignoring that the paid-social members buy Plus at a much lower rate (see Q12).

### Q12 — Which channel converts to Plus?
- **Prompt:** "Which acquisition channel brings members who actually pay? Is paid social worth it?"
- **Type:** attribution
- **Answer:** New members from **paid social buy Plus at a much lower rate** than other channels: 10.2% vs 17-18% for organic (17.4%), referral (17.8%), paid search (16.9%), and app-store ads (18.0%). Comparing signups from the same weeks, paid social's purchase rate is **about 0.54x** the other channels'. Spend per paying member: **paid social ≈ $131**, paid search ≈ $83, app-store ads ≈ $33. Paid social is the most expensive way to get a paying member. Accept 0.42x-0.68x.
- **Evidence:** H5-summer-shred-paid-social; Funnels or Insights `account created` → `subscription purchased` by `acquisition_channel`; warehouse spend; `-- EVAL Q12`.
- **Context needed:** 01-business.md (channels), 04-metrics-and-tables.md (cost per paying member).
- **Grading:** must compare paying rates, not signup volume. Bonus for controlling for signup week. Wrong: "paid social is our best channel" because it drove the most signups.

### Q13 — First-week behavior that predicts retention
- **Prompt:** "Is there something new members do in their first week that predicts whether they stick around?"
- **Type:** retention
- **Answer:** **The number of workouts completed in the first 7 days.** Week-4 retention (any activity in days 28-34 after signup) climbs with early workouts: **0 workouts 17.9%**, 1 → 24.1%, 2 → 34.5%, 3 → 37.0%, 4 → 37.9%, **5 or more 48.8%** (5+ vs 0 ≈ **2.7x**). There is no single cliff; the curve rises in steps and flattens at about 5 (5 → 50.7%, 6+ → 47.9%). Grouped: 0 → 17.9%, 1-2 → 28.5%, 3-4 → 37.4%, 5+ → 48.8%. Split at 3: 42.3% (3+) vs 24.5% (0-2). 66% of new members (signed up by Aug 27) complete 0-2 workouts in their first week. Accept a rising curve, 5+ vs 0 of 2.3x-3.3x, and rates within ±3 points.
- **Evidence:** H6-first-week-habit; Retention, birth `account created`, return any event, weekly unit, Week 4 bucket, segmented by per-signup-week cohorts on `workout completed` count (approximate first week), members who signed up by 2026-08-27; exact per-member first-week counts need the raw export; `-- EVAL Q13`.
- **Context needed:** 01-business.md (activation goal), 04-metrics-and-tables.md (Week-N retention definition).
- **Grading:** must define the behavior from the first week only and show that more early workouts means better retention. Wrong: using total workouts over the whole window (leaks the outcome into the cohort); claiming a hard threshold with no gain past it.

### Q14 — Team vs solo challenges
- **Prompt:** "Do team challenges get finished more often than solo challenges?"
- **Type:** funnel
- **Answer:** Yes. Per challenge (matched on `challenge_id`), **team challenges complete 58.5%** (18,157 of 31,028) vs **solo 28.8%** (8,875 of 30,781), about **2x**. Accept 55%-63% team and 26%-32% solo.
- **Evidence:** H7-team-vs-solo-challenges; Funnels `challenge joined` → `challenge completed`, totals, hold `challenge_id` constant, breakdown `challenge_format`; `-- EVAL Q14`.
- **Context needed:** 03-event-dictionary.md (challenge_id), 04-metrics-and-tables.md.
- **Grading:** must count per challenge. Wrong: unique-member funnel rates (members join many challenges, so 88.1% of team joiners and 68.7% of solo joiners complete at least one, which hides most of the gap).

### Q15 — Too many notifications?
- **Prompt:** "Are we sending too many notifications? Is there a point where people stop opening them?"
- **Type:** segmentation
- **Answer:** Yes. Open rates fall as members receive more notifications, starting after about a dozen. By a member's notification count in the window: under 12 → **20.0%**, 12-19 → 19.4%, 20-27 → 17.6%, 28-39 → 15.8%, 40+ → **12.8%**. By notification order: a member's first 12 notifications open at **20.0%** (a normal rate for fitness-app notifications), the 13th-16th at 18.3%, 17th-20th 15.0%, 21st-24th 11.8%, 25th-27th 10.5%, and the 28th onward at **7.9%**, well under half the fresh rate. The same heavy members opened 20.7% of their first 12 notifications, so this is fatigue, not a different kind of member. 773 members (10.0% of members with notifications) received 28 or more. Accept: decline begins around 12-16 notifications, settles near 8% (±2 points, or 0.33x-0.45x of the fresh rate) past about 28, and is gradual rather than a single step.
- **Evidence:** H8-push-fatigue; Insights, `notification received`, share `opened = true`, broken down by cohorts on notification count; order-level read from the raw export or the `-- EVAL Q15` query.
- **Context needed:** 01-business.md (lifecycle goal), 02-timeline.md (caps under review).
- **Grading:** must show that open rate depends on how many notifications a member has already received, and give a level where it drops. Wrong: "no effect"; "a hard cutoff at exactly N"; comparing heavy and light members without noting heavy members' early notifications open normally.

### Q16 — Did Fall Reset work?
- **Prompt:** "Did the Fall Reset program actually get people working out more?"
- **Type:** trend
- **Answer:** Yes. During Fall Reset (Sep 8-21) vs the two weeks before, completed workouts rose from 21,049 to 30,544 while meal logging (not part of the program) was flat (12,077 → 11,812): workouts per meal logged rose **1.48x**. App opens rose modestly (13,478 → 15,771; 1.20x relative to meals), so completed workouts per app open rose **1.24x** (1.56 → 1.94). Workout planning shows the same pattern. Accept a workout lift of 1.35x-1.6x against an untouched baseline, and app opens up about 1.1x-1.3x.
- **Evidence:** H9-fall-reset-program; Insights, `workout completed`, `app opened`, `meal logged` daily, formulas; `-- EVAL Q16`.
- **Context needed:** 02-timeline.md (program dates).
- **Grading:** must compare against an untouched baseline (meals, or the period before) and separate workouts from app traffic. Wrong: crediting Labor Day; saying only app traffic rose; reporting raw counts without a baseline.

### Q17 — iOS vs Android onboarding (null)
- **Prompt:** "Do Android users finish onboarding at a lower rate than iOS users?"
- **Type:** null-hypothesis
- **Answer:** **No meaningful difference.** 7-day onboarding completion is **48.1% on Android (1,509 signups) vs 49.8% on iOS (2,619)**. The 1.8-point gap is well inside noise (two-proportion z = −1.1, p ≈ 0.27). Within each test variant the gap is not significant either (Control 43.7% vs 44.2%, p ≈ 0.84; Guided Plan 56.6% vs 59.5%, p ≈ 0.25; not enrolled 41.5% vs 43.4%, p ≈ 0.55). Platform has no role in onboarding in the product. Accept "no meaningful difference".
- **Evidence:** Funnels onboarding steps, breakdown `Platform`; `-- EVAL Q17`.
- **Context needed:** 03-event-dictionary.md.
- **Grading:** a correct answer says the platforms convert about the same and treats the small gap as noise (ideally with a significance check). Wrong: "yes, Android is lower" based on the raw 1.8-point gap.

### Q18 — Did the sync incident affect other activity? (null)
- **Prompt:** "During the August sync incident, did members also stop logging meals or using the app?"
- **Type:** null-hypothesis
- **Answer:** **No.** Meals logged per app open were **0.888 during the incident vs 0.909** in the surrounding week (0.98x), and app opens per day were normal (964 vs 963). Only wearable-synced workouts were affected. Accept "no meaningful change" (within ±5%).
- **Evidence:** `-- EVAL Q18`; Insights, `meal logged` and `app opened`, daily.
- **Context needed:** 02-timeline.md.
- **Grading:** must check the data. Wrong: "engagement fell across the board".

### Q19 — Bookings by month
- **Prompt:** "What were our new subscription bookings by month this summer, gross and net of store fees?"
- **Type:** external-join
- **Answer:** From `subscription_billing_daily`: **June (from Jun 4, 27 days) $8,297 gross / $7,052 net** (190 new subscriptions); **July $11,541 / $9,810** (279); **August $11,174 / $9,497** (244); **September $10,598 / $9,008** (208); October 1 only $320 / $272 (10). Net is gross minus the 15% store fee. Per day, new subscriptions ran 7.0 in June, 9.0 in July, 7.9 in August, and 6.9 in September; weekly volume was steady through June (no ramp-up from zero). July was the strongest month; September bookings fell about 5% from August (Monthly gross −$176 after the price change, Annual −$400). The billing counts differ slightly from Mixpanel purchases (190/279/244/208 vs 185/282/242/201) because of settlement timing, failed or refunded first payments, and store-page purchases. Accept within ±1%.
- **Evidence:** warehouse `subscription_billing_daily`; `-- EVAL Q19`.
- **Context needed:** 04-metrics-and-tables.md (billing table, first-payment caveat), 02-timeline.md.
- **Grading:** must use the warehouse table (prices are not in events) and note that June is a partial month (start June 4). Normalized per day, July is still the high point (9.0 vs 7.0 per day in June). Credit an answer that links July to more new members buying: Summer Shred sign-ups (paid-social members bought 45 subscriptions in July vs about 20 in other months) and the Guided Plan variant from July 1 (more members finish onboarding and go on to buy). Wrong: reading the raw June-to-July rise without normalizing for days; multiplying purchases by a single price; using Mixpanel purchase counts as bookings without the warehouse price.

### Q20 — What to worry about in Q4
- **Prompt:** "Looking at this data, what should we worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names most of these, with numbers:
  1. **Paid social quality and cost**: Summer Shred did add members (1.36x daily signups, about 340 extra, about $22 each in extra spend), but paid-social members buy Plus at about half the rate of same-week signups from other channels (0.54x), the campaign doubled paid-social cost per signup ($8.96 → $18.03), and a paying member costs about $131 via paid social vs $33-83 elsewhere.
  2. **Monthly price change**: Monthly purchases fell to about 0.75x of the Annual trend after Sep 1 and Monthly bookings relative to Annual fell to about 0.87x; the increase did not pay off so far, and September bookings fell about 5% from August.
  3. **Activation**: 66% of new members do 0-2 workouts in their first week; Week-4 retention climbs from 18% (0 workouts) to 49% (5+). Ship Guided Plan (1.33x onboarding completion, faster time to onboard, more buyers).
  4. **Notification fatigue**: open rates fall after about a dozen notifications per member, from 20% to about 8% from the 28th on; about 10% of members are past that point. Set a frequency cap.
  5. **Wearable partner reliability**: a 3-day partner incident lost about 75% of watch and band workouts.
  Positive signals to keep: Stride Coach adoption ramped to about 44% of Plus workouts within three weeks and coached sessions run about 20% longer; team challenges finish at 2x the solo rate; Fall Reset lifted workouts about 1.5x against untouched activity. Long-time free members convert slowly (about 7% bought Plus in the window).
- **Evidence:** H1-H9; `-- EVAL Q20` (headline numbers).
- **Context needed:** all guides.
- **Grading:** full credit for at least four risks with supporting numbers and at least one recommended action. Partial credit for risks without numbers. Wrong: a generic list not grounded in the data.

