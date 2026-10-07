# Stridewell (fitness) — 20-question eval

- **Data:** `data/verify-fitness` (full fidelity: 9,056 members with events, 4,063 new-member signups, 1,087,105 events, 2026-06-04 → 2026-10-01 UTC). The USERS file holds 9,064 profiles: 8 pre-existing members have a profile but no events in the window. Member counts in the answers use members with events.
- **Run date:** 2026-10-06 (second fix round on engine d15c80d: challenges joined before June 4 complete inside the window at the steady rate, some long-time free members drift away and deactivate early in the window, human coaching is a Plus perk; every number re-measured)
- **Period labels:** "August" and "September" always mean calendar months (Aug 1-31, Sep 1-30). "Before / after the price change" means before Sep 1 / Sep 1 through Oct 1.
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query in `dungeons/vertical/fitness/fitness.sql` on that data.
- **Stories:** ids refer to the `stories` export in `fitness.js` (H1-H9).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Did the onboarding test work?
- **Prompt:** "We've been running the Guided First Week onboarding test since July. Is the Guided Plan variant actually better? By how much?"
- **Type:** funnel
- **Answer:** Yes. 7-day onboarding completion (account created → goal quiz completed → plan generated → starter workout completed): **Guided Plan 57.1%** (879 of 1,540) vs **Control 44.5%** (668 of 1,501), a **relative lift of about 1.28x** (+12.6 points). Accept 1.17x-1.43x and rates within ±1.5 points. Bonus: finishing onboarding goes with buying. Across all new members, 25.0% of those who finish buy Plus vs 11.2% of those who do not (non-finishers also log about half as many workouts: 3.3 vs 6.4). Guided Plan has slightly more buyers per enrolled signup so far (16.9% vs 16.5%), but that gap is not significant (z ≈ 0.4).
- **Evidence:** H1-guided-first-week; Funnels report with the four onboarding steps, 7-day window, breakdown by user property `Experiment: Guided First Week`; `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (test start and enrollment), 03-event-dictionary.md (onboarding events, experiment property).
- **Grading:** must restrict to enrolled members (signups from 2026-07-01) and compare variants on the same funnel. Wrong answers: comparing all new members before vs after July 1; counting `workout completed` instead of `starter workout completed`; reporting the lift as absolute points only without the rates; claiming members who skip onboarding never buy (11.2% of them do); claiming Guided Plan already produced significantly more buyers.

### Q2 — Is onboarding faster in the new variant?
- **Prompt:** "For people who finish onboarding, how long does it take in each variant of the Guided First Week test?"
- **Type:** funnel
- **Answer:** Median time from signup to starter workout: **Guided Plan ≈ 12.6 hours vs Control ≈ 18.1 hours**, about **0.70x** the control time (about 30% faster). Accept 0.63x-0.77x.
- **Evidence:** H1-guided-first-week; Funnels time-to-convert, same steps, breakdown by variant; `-- EVAL Q2`.
- **Context needed:** 03-event-dictionary.md.
- **Grading:** must use medians (or say the mean shows the same direction) on converters only. Wrong: computing time to `workout completed`.

### Q3 — Stride Coach and workout length
- **Prompt:** "What happened to workout duration after we launched Stride Coach?"
- **Type:** trend
- **Answer:** After the 2026-08-12 launch, workouts by members with Plus features (`subscription_tier` monthly, annual, or trial) done with Stride Coach (`coaching_mode = ai_coach`) average **49.6 minutes vs 41.6 minutes** for self-guided ones, about **1.19x longer**. Self-guided Plus workouts did not change (41.3 min before launch, 41.6 after). Free workouts are all self-guided. Accept 1.12x-1.28x.
- **Evidence:** H2-stride-coach-launch; Insights, `workout completed`, average `duration_minutes`, breakdown `coaching_mode`, filter `subscription_tier` ≠ free; `-- EVAL Q3`.
- **Context needed:** 02-timeline.md (launch date, Plus and trial), 01-business.md, 03-event-dictionary.md (`subscription_tier` values).
- **Grading:** must separate AI-coached from self-guided workouts and restrict to members with Plus features. Wrong: comparing all workouts before vs after launch (41.4 → 42.6 minutes, about 1.03x, because it mixes in self-guided and free workouts and the adoption ramp).

### Q4 — Stride Coach adoption
- **Prompt:** "What share of Plus workouts use Stride Coach since it launched? Is adoption growing?"
- **Type:** segmentation
- **Answer:** Adoption **ramped for about three weeks, then leveled off near 43-46%**. Weekly share of completed workouts by members with Plus features that use Stride Coach: 20.3% in the launch week (week of Aug 10, partial), 28.4%, 37.3%, 44.9%, then 42.5%-46.1% every week in September. Since launch overall: 40.2%; from Sep 2: 45.1%. Use varies by member: among the 694 Plus members with 10+ workouts since Sep 2, 40.1% never use Stride Coach, 6.9% use it for under half of their workouts (0.7% under 25%, 6.2% for 25-49%), 17.9% for 50-74%, and 35.2% for 75% or more. Accept a ramp that plateaus at 40%-48%, and a note that about 40% of Plus members do not use it while users vary in how much they use it.
- **Evidence:** H2-stride-coach-launch; Insights, `workout completed`, filter `subscription_tier` ≠ free and after launch, breakdown `coaching_mode`, weekly; per-member split needs a breakdown by user or the raw export; `-- EVAL Q4`.
- **Context needed:** 02-timeline.md, 04-metrics-and-tables.md (adoption definition).
- **Grading:** denominator is workouts by members with Plus features, not all workouts. Wrong: share of all workouts (much lower); "still growing steadily" (it plateaued in September); "every Plus member uses it a little" (about 40% never use it, and most users use it for half or more of their workouts).

### Q5 — Do Stride Coach workouts push people harder? (null)
- **Prompt:** "Stride Coach sessions run longer. Are people also working harder in them — higher heart rate or effort?"
- **Type:** null-hypothesis
- **Answer:** **No meaningful difference in intensity.** Plus workouts after launch: average heart rate **126.1 vs 126.0 bpm** (ai_coach vs self-guided); perceived effort 6.01 vs 6.00; calories per minute 6.30 vs 6.29. Stride Coach sessions burn more total calories only because they last longer (312.5 vs 261.5 calories per workout, about the same 1.2x as duration). Accept any answer that says intensity did not change (heart rate and effort within ±2%).
- **Evidence:** Insights, `workout completed`, average `avg_heart_rate` and `perceived_effort` (and calories ÷ minutes), breakdown `coaching_mode`, Plus and after launch; `-- EVAL Q5`.
- **Context needed:** 03-event-dictionary.md.
- **Grading:** must check intensity directly, not infer it from total calories. Wrong: "yes, they burn about 20% more calories, so they are harder workouts" (the extra calories come from the extra minutes).

### Q6 — The late-August dip
- **Prompt:** "Workout logging looks like it dropped for a few days in late August. What happened and how big was it?"
- **Type:** external-join
- **Answer:** The **2026-08-20 to 2026-08-22 wearable sync incident** at the health-data partner. On those three days (Thursday to Saturday), smartwatch and fitness-band workouts fell to about **148 per day, from about 517 per day** on the same weekdays one week before and after, while all other workouts (phone, manual, chest strap) held steady (623 vs 597 per day). Against the full 7 days on each side, unaffected workouts read 623 vs 695 per day only because Friday and Saturday are quiet days. Relative to the unaffected workouts, watch and band workouts ran at **about 27%** of normal (0.267 ratio of ratios vs the 7 days on each side). The warehouse table `wearable_sync_daily` shows `sync_error_rate` ≈ 0.74-0.76 and `partner_api_status = major_outage` on exactly those days. Workouts that failed to sync are missing from Mixpanel. Accept 0.20-0.32. Also accept the device-owner read: breaking down `workout completed` by `wearable_type` only (no `tracking_source` filter), watch and band owners' workouts ran at **about 0.40** of normal against other members' (0.395), a drop of about 60%. That read is diluted because watch and band owners also log some workouts with the phone, and those kept syncing. Accept 0.33-0.47 for it when the answer names the scope (all workouts by watch and band owners).
- **Evidence:** H3-wearable-sync-outage; Insights daily `workout completed` by `tracking_source` and `wearable_type`; warehouse join on date and `wearable_type`; `-- EVAL Q6`.
- **Context needed:** 02-timeline.md (incident dates), 04-metrics-and-tables.md (`wearable_sync_daily`).
- **Grading:** must name the incident, the dates, the device scope, and a size. Either size is correct if its scope is stated: about 27% of normal for wearable-tracked watch and band workouts, or about 40% for all workouts by watch and band owners. A size near 0.40 presented as the share of wearable-synced workouts that got through is a partial answer (it mixes in phone-tracked workouts). Wrong: blaming the dip on members working out less (phone workouts held steady against the same weekdays), or on the Stride Coach launch.

### Q7 — Which devices were hit?
- **Prompt:** "Was the August sync incident only smartwatches, or did it hit other trackers too?"
- **Type:** external-join
- **Answer:** **Smartwatches and fitness bands** were hit: during the incident they ran at 0.28x (smartwatch) and 0.23x (fitness band) of their normal level relative to phone workouts. **Chest straps** (0.97x) and **manual entries** (0.97x) were not hit. Broken down by `wearable_type` only (all workouts by each device's owners, against members with no wearable): smartwatch owners 0.41x, fitness-band owners 0.37x, chest-strap owners 0.97x. The warehouse agrees: `major_outage` with a 0.74-0.76 error rate for smartwatch and fitness_band only; chest_strap stayed `operational` (≈0.9% errors). Accept 0.15-0.35 for affected devices and 0.85-1.2 for unaffected. With the `wearable_type`-only breakdown, accept 0.30-0.50 for smartwatch and fitness-band owners when the answer says it covers all of their workouts (some are phone-tracked and kept syncing).
- **Evidence:** H3-wearable-sync-outage; `-- EVAL Q7`.
- **Context needed:** 04-metrics-and-tables.md (`wearable_sync_daily`), 03-event-dictionary.md (`tracking_source`, `wearable_type`).
- **Grading:** must separate chest straps from watches and bands. The device ranking is the same with or without a `tracking_source = wearable` filter; only the size of the drop differs. Wrong: "all wearables".

### Q8 — Did the price change hurt sign-ups?
- **Prompt:** "Did the September Plus Monthly price increase hurt new subscriptions?"
- **Type:** trend
- **Answer:** **Yes, for Monthly.** Annual (whose price did not change) is the control. Monthly purchases per Annual purchase fell from **1.89 before Sep 1 to 1.40 after**, a ratio of **0.74** (about 26% fewer Monthly purchases than the Annual trend predicts). August vs September (calendar months): Monthly 192 → 122 (−36%) while Annual 96 → 88 (−8%); Monthly share of new subscriptions 66.7% → 58.1%. Accept a ratio of 0.45-0.8 (the post-change period holds about 215 purchases, so the ratio is noisy).
- **Evidence:** H4-monthly-price-change; Insights, `subscription purchased`, breakdown `plan`, weekly; `-- EVAL Q8`.
- **Context needed:** 02-timeline.md (price change), 01-business.md (plans).
- **Grading:** must use a control or mix analysis. Wrong: reading only the total (288 → 210 purchases) with no control. The answer must show that the drop is much larger in Monthly (−36%) than in Annual (−8%), whose price did not change; the gap between the plans is the price signal. Also wrong: claiming no effect.

### Q9 — Did the price change pay off in bookings?
- **Prompt:** "Even if we sold fewer monthly plans, did the higher price bring in more monthly bookings?"
- **Type:** external-join
- **Answer:** **No.** Joining Mixpanel purchases to `list_price_usd`, Monthly gross bookings fell from **$2,494 in August (192 × $12.99) to $1,829 in September (122 × $14.99)** while Annual bookings went from $9,599 (96 × $99.99) to $8,799 (88). Relative to Annual, Monthly bookings from Sep 1 are **0.86x** of before: the 15% higher price did not make up for the lost volume. Reading the billing table alone gives the same answer: Monthly $2,455 (189) → $1,859 (124), Annual $10,199 (102) → $9,099 (91), ratio 0.86x. Accept 0.6-0.92 from either source and "did not pay off".
- **Evidence:** H4-monthly-price-change; warehouse `subscription_billing_daily` joined to `subscription purchased` on date and plan; `-- EVAL Q9`.
- **Context needed:** 04-metrics-and-tables.md (billing table and its first-payment caveat), 02-timeline.md.
- **Grading:** must use warehouse prices (price is not on events). Wrong: multiplying all purchases by $14.99; reading the Monthly drop without the Annual control.

### Q10 — Summer Shred CAC
- **Prompt:** "What did a paid social signup cost us during Summer Shred compared with the rest of the period?"
- **Type:** external-join
- **Answer:** Paid social spend per Mixpanel signup was **$19.25 during Summer Shred (Jun 15-Jul 14) vs $9.23 outside it**, about **2.09x**. Spend: $9,434 for 490 signups in the campaign vs $4,873 for 528 signups outside. Paid search ($15.05 vs $15.05) and app-store ads ($7.43 vs $6.85) cost about the same per signup in and out of the campaign. Daily cost per signup swings widely, because spend follows the media plan and the platforms' install counts rather than each day's Mixpanel signups. Accept 1.8x-2.3x.
- **Evidence:** H5-summer-shred-paid-social; warehouse `paid_acquisition_daily.spend_usd` joined to `account created` by date and `acquisition_channel`; `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (campaign dates), 04-metrics-and-tables.md (CAC definition, spend table).
- **Grading:** must divide by Mixpanel signups, not `platform_reported_installs`. Wrong: using platform installs (understates CAC about 8%); comparing total spend only; reading CAC from single days.

### Q11 — Did Summer Shred add new members?
- **Prompt:** "Did Summer Shred actually bring in extra members, or did paid social just take credit for people who would have joined anyway?"
- **Type:** attribution
- **Answer:** **It added real members.** New-member signups ran at **43.3 per day during the campaign vs 30.7 per day** in the rest of the window (**1.41x**), about **376 extra members** over the 30 days. Most of the extra came through paid social: 16.3 vs 5.9 paid-social signups per day (2.8x; share of signups 19.1% → 37.8%). The other channels did not lose volume (combined 1.08x): organic 11.9 vs 10.2 per day, referral 5.5 vs 4.9, paid search 4.4 vs 4.4, app-store ads 5.1 vs 5.4. Only organic's rise stands out from day-to-day noise (z ≈ 2.5, one of four channels tested, so weak evidence of a halo at most); none fell. There is no sign of cannibalization. Extra paid-social spend was about $7,809, or **about $21 per extra member** (higher than the $19.25 average because the campaign also paid double for paid-social members who would have come anyway). Accept a lift of 1.2x-1.5x, 250-450 extra members, and $17-$27 per extra member.
- **Evidence:** H5-summer-shred-paid-social; Insights, `account created`, breakdown `acquisition_channel`, daily or weekly, compare date ranges; warehouse spend for the cost; `-- EVAL Q11`.
- **Context needed:** 02-timeline.md (campaign dates), 04-metrics-and-tables.md (spend table).
- **Grading:** must compare absolute daily volume per channel, not only shares. Wrong: "paid social cannibalized organic" (shares fell, but absolute organic volume did not); reporting only the share shift; ignoring that the paid-social members buy Plus at a much lower rate (see Q12).

### Q12 — Which channel converts to Plus?
- **Prompt:** "Which acquisition channel brings members who actually pay? Is paid social worth it?"
- **Type:** attribution
- **Answer:** New members from **paid social buy Plus at a much lower rate** than other channels. Counting a purchase at any time after signup (a 120-day conversion window covers the whole dataset): paid social 11.4% vs 18-22% for organic (21.6%), paid search (21.1%), referral (18.5%), and app-store ads (18.5%). With Mixpanel's default 30-day funnel window the rates are lower and the gap is similar: paid social 10.5% vs 18.1% for all other channels. Comparing signups from the same weeks, paid social's purchase rate is **about 0.50x** the other channels'. Spend per paying member: **paid social ≈ $123**, paid search ≈ $71, app-store ads ≈ $38. Paid social is the most expensive way to get a paying member. Accept 0.40x-0.65x, and rates from either window if the answer names it.
- **Evidence:** H5-summer-shred-paid-social; Funnels `account created` → `subscription purchased`, breakdown `acquisition_channel`, uniques, conversion window 120 days (or the default 30 days, which reads lower rates); warehouse spend; `-- EVAL Q12`.
- **Context needed:** 01-business.md (channels), 04-metrics-and-tables.md (cost per paying member).
- **Grading:** must compare paying rates, not signup volume. Bonus for controlling for signup week. Wrong: "paid social is our best channel" because it drove the most signups.

### Q13 — First-week behavior that predicts retention
- **Prompt:** "Is there something new members do in their first week that predicts whether they stick around?"
- **Type:** retention
- **Answer:** **The number of workouts completed in the first 7 days.** Week-4 retention (any activity in days 28-34 after signup) climbs with early workouts: **0 workouts 15.7%**, 1 → 20.1%, 2 → 31.7%, 3 → 32.4%, 4 → 38.5%, 5 → 46.8%, **6 or more 62.2%** (5 and 6+ are small groups of 79 and 119 members). There is no single cliff; each extra early workout helps. Grouped: 0 → 15.7%, 1-2 → 24.7%, 3-4 → 34.4%, **5+ → 56.1%** (5+ vs 0 ≈ **3.6x**). Split at 3: 41.3% (3+) vs 20.5% (0-2). 79% of new members (of 3,002 who signed up by Aug 27) complete 0-2 workouts in their first week. A Mixpanel cohort version (workouts from the start of the signup week to 7 days after its end) gives the same shape: 14.8%, 21.1%, 30.0%, 48.1%. Accept a rising curve, 5+ vs 0 of 2.5x-4.0x, and rates within ±3 points.
- **Evidence:** H6-first-week-habit; Retention, birth `account created`, return any event, weekly unit, Week 4 bucket, segmented by per-signup-week cohorts on `workout completed` count (approximate first week), members who signed up by 2026-08-27; exact per-member first-week counts need the raw export; `-- EVAL Q13`.
- **Context needed:** 01-business.md (activation goal), 04-metrics-and-tables.md (Week-N retention definition).
- **Grading:** must define the behavior from the first week only and show that more early workouts means better retention. Wrong: using total workouts over the whole window (leaks the outcome into the cohort); claiming a hard threshold with no gain past it.

### Q14 — Team vs solo challenges
- **Prompt:** "Do team challenges get finished more often than solo challenges?"
- **Type:** funnel
- **Answer:** Yes. Per challenge (each `challenge_id` counted on its own), for joins from Jun 4 to Aug 31 with a 31-day window (so every challenge has ended): **team challenges complete 57.4%** (13,019 of 22,667) vs **solo 28.3%** (6,412 of 22,632), about **2.0x**. Completions come near the end of each challenge (median 6.0, 12.5, 18.5, and 26.4 days after the join for 7-, 14-, 21-, and 30-day challenges). Weekly completions are flat from the first week (1,464-1,570 in every full week, 0.41-0.45 per join), because challenges joined in May still finish in June; the per-day rate in the partial first week (Jun 4-7, 221 a day) matches later weeks. Accept 54%-63% team and 26%-32% solo, or a ratio of 1.8x-2.2x.
- **Evidence:** H7-team-vs-solo-challenges; Funnels `challenge joined` → `challenge completed`, totals, hold `challenge_id` constant, breakdown `challenge_format`, date range Jun 4 - Aug 31, conversion window 31 days; `-- EVAL Q14`.
- **Context needed:** 03-event-dictionary.md (challenge_id, duration_days, completion at the end), 04-metrics-and-tables.md (completion-rate definition).
- **Grading:** must count per challenge and give challenges time to finish. Wrong: unique-member funnel rates (members join many challenges, so 78.7% of team joiners and 57.4% of solo joiners complete at least one, which hides most of the gap); a short conversion window (a 7-day window misses every 14-30-day challenge); including September joins without comment (50.0% vs 24.5%, because many of those challenges were still running on October 1; the 2x ratio holds). Also wrong: reading a growth trend from weekly challenge completions (they are flat from June).

### Q15 — Too many notifications?
- **Prompt:** "Are we sending too many notifications? Is there a point where people stop opening them?"
- **Type:** segmentation
- **Answer:** Yes. Open rates fall as the number of notifications a member gets rises. By a member's notification count in the window: under 12 → **19.5%**, 12-23 → 17.7%, 24-35 → 15.1%, 36-47 → 11.3%, 48+ → **10.1%**. The driver is recent volume: by how many other notifications the member received in the previous 30 days (notifications from Jul 4, when the 30-day look-back is complete), 0-4 → **20.3%** (a normal rate for fitness-app notifications; 48% of notifications), 5-7 → 17.3%, 8-11 → 11.9%, 12-15 → 7.5%, 16+ → **7.9%** (12+ combined 7.7%). About 14% of notifications go out to members who already had 12 or more in the last 30 days, and 1,008 members (15% of members with notifications) reached that level at some point. The overall open rate is flat over time (16.0%, 16.6%, 16.7%, 16.1% for June-September), so this is a volume effect, not a calendar trend. Accept: decline begins around 5 notifications in 30 days (or about a dozen in the window per member), settles near 8% (±2 points, or 0.33x-0.45x of the fresh rate) at about 12+ in 30 days, gradual rather than a single step, and no time trend.
- **Evidence:** H8-push-fatigue; Insights, `notification received`, share `opened = true`, broken down by cohorts on notification count; recent-volume read from the raw export or the `-- EVAL Q15` query.
- **Context needed:** 01-business.md (lifecycle goal), 02-timeline.md (caps under review; sending rules unchanged).
- **Grading:** must show that open rate depends on how many notifications a member has received recently (or in total), and give a level where it drops. Wrong: "no effect"; "a hard cutoff at exactly N"; "there is a sweet spot" (the rate only declines); "open rates have been falling since July" or crediting the July 20 org change (the monthly open rate is flat).

### Q16 — Did Fall Reset work?
- **Prompt:** "Did the Fall Reset program actually get people working out more?"
- **Type:** trend
- **Answer:** Yes. During Fall Reset (Sep 8-21) vs the two weeks before, completed workouts rose from 18,405 to 28,285 while meal logging (not part of the program) was flat (10,112 → 10,280): workouts per meal logged rose **1.51x**. App opens rose modestly (11,046 → 13,726; 1.22x relative to meals), so completed workouts per app open rose **1.24x** (1.67 → 2.06). Workout planning and progress checks show the same pattern (progress checks per completed workout stayed at 0.64). Accept a workout lift of 1.35x-1.6x against an untouched baseline, and app opens up about 1.1x-1.3x.
- **Evidence:** H9-fall-reset-program; Insights, `workout completed`, `app opened`, `meal logged` daily, formulas; `-- EVAL Q16`.
- **Context needed:** 02-timeline.md (program dates).
- **Grading:** must compare against an untouched baseline (meals, or the period before) and separate workouts from app traffic. Wrong: crediting Labor Day; saying only app traffic rose; reporting raw counts without a baseline.

### Q17 — iOS vs Android onboarding (null)
- **Prompt:** "Do Android users finish onboarding at a lower rate than iOS users?"
- **Type:** null-hypothesis
- **Answer:** **No meaningful difference.** 7-day onboarding completion is **49.6% on Android (1,498 signups) vs 49.5% on iOS (2,565)**. The 0.1-point gap is noise (two-proportion z = 0.08, p ≈ 0.94). Within each test variant the gap is not significant either (Control 43.3% vs 45.3%, p ≈ 0.45; Guided Plan 57.7% vs 56.7%, p ≈ 0.72; not enrolled 47.8% vs 44.2%, p ≈ 0.27). Platform has no role in onboarding in the product. Accept "no meaningful difference".
- **Evidence:** Funnels onboarding steps, breakdown `Platform`; `-- EVAL Q17`.
- **Context needed:** 03-event-dictionary.md.
- **Grading:** a correct answer says the platforms convert about the same and treats the small gap as noise (ideally with a significance check). Wrong: "yes, Android is lower".

### Q18 — Did the sync incident affect other activity? (null)
- **Prompt:** "During the August sync incident, did the members whose watch or band workouts stopped syncing also log fewer meals or open the app less?"
- **Type:** null-hypothesis
- **Answer:** **No.** Comparing each member's daily rate during the incident with their own rate on the 7 days on each side, smartwatch and fitness-band owners (3,295 active members) vs everyone else (2,620): app opens **1.09x** (z = 0.82, p ≈ 0.42) and meals logged **1.03x** (z = 0.29, p ≈ 0.77), both inside noise and not lower. Meals logged per app open across all members were 0.920 during the incident vs 0.909 in the surrounding week (1.01x). App opens for everyone ran 727 per day vs 734 on the same weekdays one week before and after, and the incident's Thursday-Saturday total (2,180 opens) sits inside the range of the same three days in the other 13 full weeks (1,893-2,302). Only wearable-synced workouts were affected. Accept "no meaningful change".
- **Evidence:** `-- EVAL Q18`; Insights, `meal logged` and `app opened`, daily, breakdown user property `wearable_type`, compare Aug 20-22 with Aug 13-19 and Aug 23-29.
- **Context needed:** 02-timeline.md (incident dates), 03-event-dictionary.md (`wearable_type`).
- **Grading:** must check the data and compare the affected members with a control. Wrong: "engagement fell across the board" or "affected members gave up on the app". A significance test on pooled event totals treats every event as independent and overstates the evidence, because heavy users dominate the counts; a member-level comparison is the right test.

### Q19 — Bookings by month
- **Prompt:** "What were our new subscription bookings by month this summer, gross and net of store fees?"
- **Type:** external-join
- **Answer:** From `subscription_billing_daily`: **June (from Jun 4, 27 days) $12,058 gross / $10,249 net** (292 new subscriptions); **July $15,353 / $13,050** (338); **August $12,654 / $10,756** (291); **September $10,958 / $9,314** (215); October 1 only $260 / $221 (6). Net is gross minus the 15% store fee. Per day, new subscriptions ran 10.8 in June, 10.9 in July, 9.4 in August, and 7.2 in September. June has no ramp from zero: its weeks run 10.4-11.5 per day, inside the July-August range (8.1-12.3). July was the strongest month in bookings; September bookings fell about 13% from August (Monthly gross −$596 after the price change, Annual −$1,100). The billing counts differ slightly from Mixpanel purchases (292/338/291/215 vs 291/337/288/210) because of settlement timing, failed or refunded first payments, and store-page purchases. Accept within ±1%.
- **Evidence:** warehouse `subscription_billing_daily`; `-- EVAL Q19`.
- **Context needed:** 04-metrics-and-tables.md (billing table, first-payment caveat), 02-timeline.md.
- **Grading:** must use the warehouse table (prices are not in events) and note that June is a partial month (start June 4). Normalized per day, June and July are about level (10.8 and 10.9 per day) and the decline starts in August. Credit an answer that links July's bookings to more new members buying: Summer Shred sign-ups (new paid-social members bought 47 subscriptions in July vs 18-28 in each other month: 18 in partial June, 28 in August, 22 in September) and the Guided Plan variant from July 1. Wrong: reading the raw June-to-July rise without normalizing for days; multiplying purchases by a single price; using Mixpanel purchase counts as bookings without the warehouse price.

### Q20 — What to worry about in Q4
- **Prompt:** "Looking at this data, what should we worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names most of these, with numbers:
  1. **Paid social quality and cost**: Summer Shred did add members (1.41x daily signups, about 376 extra, about $21 each in extra spend), but paid-social members buy Plus at about half the rate of same-week signups from other channels (0.50x), the campaign doubled paid-social cost per signup ($9.23 → $19.25), and a paying member costs about $123 via paid social vs $38-71 elsewhere.
  2. **Monthly price change**: Monthly purchases fell to about 0.74x of the Annual trend after Sep 1 and Monthly bookings relative to Annual fell to about 0.86x; the increase did not pay off so far, and September bookings fell about 13% from August.
  3. **Activation**: 79% of new members do 0-2 workouts in their first week; Week-4 retention climbs from 16% (0 workouts) to 56% (5+). Members who finish onboarding buy Plus about twice as often (25% vs 11%). Ship Guided Plan (1.28x onboarding completion, about 30% faster).
  4. **Notification fatigue**: open rates fall from 20% to about 8% once a member has had 12 or more notifications in 30 days, and about 14% of notifications go out at that level. Set a frequency cap.
  5. **Wearable partner reliability**: a 3-day partner incident lost about 73% of watch and band workouts.
  Positive signals to keep: Stride Coach adoption ramped to about 45% of Plus workouts within three weeks and coached sessions run about 20% longer; team challenges finish at 2x the solo rate; Fall Reset lifted workouts about 1.5x against untouched activity. Long-time free members convert slowly (about 7.5% bought Plus in the window).
- **Evidence:** H1-H9; `-- EVAL Q20` (headline numbers).
- **Context needed:** all guides.
- **Grading:** full credit for at least four risks with supporting numbers and at least one recommended action. Partial credit for risks without numbers. Wrong: a generic list not grounded in the data.
