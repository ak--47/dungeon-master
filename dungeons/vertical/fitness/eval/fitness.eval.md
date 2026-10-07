# Stridewell (fitness) — 20-question eval

- **Data:** `data/verify-fitness` (full fidelity: 9,078 members with events, 4,047 new-member signups, 1,063,039 events, 2026-06-04 → 2026-10-01 UTC). The USERS file holds 9,091 profiles: 13 pre-existing members have a profile but no events in the window. Member counts in the answers use members with events.
- **Run date:** 2026-10-06 (third fix round on engine d15c80d: Fall Reset adds whole Workout Loop units, deactivations land on the lapse day and continue to October 1, challenges and social features differ by segment with a Free-plan limit of 3 running challenges, more app opens; every number re-measured)
- **Period labels:** "August" and "September" always mean calendar months (Aug 1-31, Sep 1-30). "Before / after the price change" means before Sep 1 / Sep 1 through Oct 1.
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query in `dungeons/vertical/fitness/fitness.sql` on that data.
- **Stories:** ids refer to the `stories` export in `fitness.js` (H1-H9).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Did the onboarding test work?
- **Prompt:** "We've been running the Guided First Week onboarding test since July. Is the Guided Plan variant actually better? By how much?"
- **Type:** funnel
- **Answer:** Yes. 7-day onboarding completion (account created → goal quiz completed → plan generated → starter workout completed): **Guided Plan 59.5%** (892 of 1,500) vs **Control 45.1%** (699 of 1,549), a **relative lift of about 1.32x** (+14.4 points). Accept 1.17x-1.43x and rates within ±1.5 points. Bonus: finishing onboarding goes with buying. Across all new members, 26.0% of those who finish buy Plus vs 11.9% of those who do not (non-finishers also log about half as many workouts: 3.2 vs 6.7). Guided Plan also has more buyers per enrolled signup so far (19.1% vs 15.8%, 1.21x, z ≈ 2.4), which fits the higher completion: more members finish, and finishers buy about twice as often.
- **Evidence:** H1-guided-first-week; Funnels report with the four onboarding steps, 7-day window, breakdown by user property `Experiment: Guided First Week`; `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (test start and enrollment), 03-event-dictionary.md (onboarding events, experiment property).
- **Grading:** must restrict to enrolled members (signups from 2026-07-01) and compare variants on the same funnel. Wrong answers: comparing all new members before vs after July 1; counting `workout completed` instead of `starter workout completed`; reporting the lift as absolute points only without the rates; claiming members who skip onboarding never buy (11.9% of them do). Credit an answer that links the buyer gap to onboarding completion rather than treating it as a separate effect.

### Q2 — Is onboarding faster in the new variant?
- **Prompt:** "For people who finish onboarding, how long does it take in each variant of the Guided First Week test?"
- **Type:** funnel
- **Answer:** Median time from signup to starter workout: **Guided Plan ≈ 12.6 hours vs Control ≈ 18.0 hours**, about **0.70x** the control time (about 30% faster). Accept 0.63x-0.77x.
- **Evidence:** H1-guided-first-week; Funnels time-to-convert, same steps, breakdown by variant; `-- EVAL Q2`.
- **Context needed:** 03-event-dictionary.md.
- **Grading:** must use medians (or say the mean shows the same direction) on converters only. Wrong: computing time to `workout completed`.

### Q3 — Stride Coach and workout length
- **Prompt:** "What happened to workout duration after we launched Stride Coach?"
- **Type:** trend
- **Answer:** After the 2026-08-12 launch, workouts by members with Plus features (`subscription_tier` monthly, annual, or trial) done with Stride Coach (`coaching_mode = ai_coach`) average **50.0 minutes vs 41.4 minutes** for self-guided ones, about **1.21x longer**. Self-guided Plus workouts did not change (41.2 min before launch, 41.4 after). Free workouts are all self-guided. Accept 1.12x-1.28x.
- **Evidence:** H2-stride-coach-launch; Insights, `workout completed`, average `duration_minutes`, breakdown `coaching_mode`, filter `subscription_tier` ≠ free; `-- EVAL Q3`.
- **Context needed:** 02-timeline.md (launch date, Plus and trial), 01-business.md, 03-event-dictionary.md (`subscription_tier` values).
- **Grading:** must separate AI-coached from self-guided workouts and restrict to members with Plus features. Wrong: comparing all workouts before vs after launch (41.4 → 42.6 minutes, about 1.03x, because it mixes in self-guided and free workouts and the adoption ramp).

### Q4 — Stride Coach adoption
- **Prompt:** "What share of Plus workouts use Stride Coach since it launched? Is adoption growing?"
- **Type:** segmentation
- **Answer:** Adoption **ramped for about three weeks, then leveled off near 41-45%**. Weekly share of completed workouts by members with Plus features that use Stride Coach: 20.3% in the launch week (week of Aug 10, partial), 27.5%, 37.3%, 45.2%, then 41.3%-44.9% every week in September. Since launch overall: 39.4%; from Sep 2: 43.6%. Use varies by member: among the 712 Plus members with 10+ workouts since Sep 2, 40.2% never use Stride Coach, 10.0% use it for under half of their workouts (2.7% under 25%, 7.3% for 25-49%), 15.0% for 50-74%, and 34.8% for 75% or more. Accept a ramp that plateaus at 40%-48%, and a note that about 40% of Plus members do not use it while users vary in how much they use it.
- **Evidence:** H2-stride-coach-launch; Insights, `workout completed`, filter `subscription_tier` ≠ free and after launch, breakdown `coaching_mode`, weekly; per-member split needs a breakdown by user or the raw export; `-- EVAL Q4`.
- **Context needed:** 02-timeline.md, 04-metrics-and-tables.md (adoption definition).
- **Grading:** denominator is workouts by members with Plus features, not all workouts. Wrong: share of all workouts (much lower); "still growing steadily" (it plateaued in September); "every Plus member uses it a little" (about 40% never use it, and most users use it for half or more of their workouts).

### Q5 — Do Stride Coach workouts push people harder? (null)
- **Prompt:** "Stride Coach sessions run longer. Are people also working harder in them — higher heart rate or effort?"
- **Type:** null-hypothesis
- **Answer:** **No meaningful difference in intensity.** Plus workouts after launch: average heart rate **125.9 vs 125.8 bpm** (ai_coach vs self-guided); perceived effort 5.98 vs 5.98; calories per minute 5.64 vs 5.65. Stride Coach sessions burn more total calories only because they last longer (281.7 vs 233.5 calories per workout, about the same 1.2x as duration). Accept any answer that says intensity did not change (heart rate and effort within ±2%).
- **Evidence:** Insights, `workout completed`, average `avg_heart_rate` and `perceived_effort` (and calories ÷ minutes), breakdown `coaching_mode`, Plus and after launch; `-- EVAL Q5`.
- **Context needed:** 03-event-dictionary.md.
- **Grading:** must check intensity directly, not infer it from total calories. Wrong: "yes, they burn about 20% more calories, so they are harder workouts" (the extra calories come from the extra minutes).

### Q6 — The late-August dip
- **Prompt:** "Workout logging looks like it dropped for a few days in late August. What happened and how big was it?"
- **Type:** external-join
- **Answer:** The **2026-08-20 to 2026-08-22 wearable sync incident** at the health-data partner. On those three days (Thursday to Saturday), smartwatch and fitness-band workouts fell to about **133 per day, from about 526 per day** on the same weekdays one week before and after, while all other workouts (phone, manual, chest strap) dipped only slightly (585 vs 633 per day). Against the full 7 days on each side, unaffected workouts read 585 vs 730 per day mostly because Friday and Saturday are quiet days. Relative to the unaffected workouts, watch and band workouts ran at **about 27%** of normal (0.271 ratio of ratios vs the 7 days on each side). The warehouse table `wearable_sync_daily` shows `sync_error_rate` ≈ 0.73-0.76 and `partner_api_status = major_outage` on exactly those days. Workouts that failed to sync are missing from Mixpanel. Accept 0.20-0.32. Also accept the device-owner read: breaking down `workout completed` by `wearable_type` only (no `tracking_source` filter), watch and band owners' workouts ran at **about 0.40** of normal against other members' (0.400), a drop of about 60%. That read is diluted because watch and band owners also log some workouts with the phone, and those kept syncing. Accept 0.33-0.47 for it when the answer names the scope (all workouts by watch and band owners).
- **Evidence:** H3-wearable-sync-outage; Insights daily `workout completed` by `tracking_source` and `wearable_type`; warehouse join on date and `wearable_type`; `-- EVAL Q6`.
- **Context needed:** 02-timeline.md (incident dates), 04-metrics-and-tables.md (`wearable_sync_daily`).
- **Grading:** must name the incident, the dates, the device scope, and a size. Either size is correct if its scope is stated: about 27% of normal for wearable-tracked watch and band workouts, or about 40% for all workouts by watch and band owners. A size near 0.40 presented as the share of wearable-synced workouts that got through is a partial answer (it mixes in phone-tracked workouts). Wrong: blaming the dip on members working out less (unaffected workouts held near the same weekdays' level), or on the Stride Coach launch.

### Q7 — Which devices were hit?
- **Prompt:** "Was the August sync incident only smartwatches, or did it hit other trackers too?"
- **Type:** external-join
- **Answer:** **Smartwatches and fitness bands** were hit: during the incident they ran at 0.28x (smartwatch) and 0.25x (fitness band) of their normal level relative to phone workouts. **Chest straps** (1.07x) and **manual entries** (0.94x) were not hit. Broken down by `wearable_type` only (all workouts by each device's owners, against members with no wearable): smartwatch owners 0.41x, fitness-band owners 0.39x, chest-strap owners 1.06x. The warehouse agrees: `major_outage` with a 0.73-0.76 error rate for smartwatch and fitness_band only; chest_strap stayed `operational` (≈0.9% errors). Accept 0.15-0.35 for affected devices and 0.85-1.2 for unaffected. With the `wearable_type`-only breakdown, accept 0.30-0.50 for smartwatch and fitness-band owners when the answer says it covers all of their workouts (some are phone-tracked and kept syncing).
- **Evidence:** H3-wearable-sync-outage; `-- EVAL Q7`.
- **Context needed:** 04-metrics-and-tables.md (`wearable_sync_daily`), 03-event-dictionary.md (`tracking_source`, `wearable_type`).
- **Grading:** must separate chest straps from watches and bands. The device ranking is the same with or without a `tracking_source = wearable` filter; only the size of the drop differs. Wrong: "all wearables".

### Q8 — Did the price change hurt sign-ups?
- **Prompt:** "Did the September Plus Monthly price increase hurt new subscriptions?"
- **Type:** trend
- **Answer:** **Yes, for Monthly.** Annual (whose price did not change) is the control. Monthly purchases per Annual purchase fell from **1.93 before Sep 1 to 0.97 after**, a ratio of **0.50** (about half as many Monthly purchases as the Annual trend predicts). August vs September (calendar months): Monthly 208 → 102 (−51%) while Annual 111 → 106 (−5%); Monthly share of new subscriptions 65.2% → 49.0%. Accept a ratio of 0.4-0.8 (the post-change period holds about 210 purchases, so the ratio is noisy).
- **Evidence:** H4-monthly-price-change; Insights, `subscription purchased`, breakdown `plan`, weekly; `-- EVAL Q8`.
- **Context needed:** 02-timeline.md (price change), 01-business.md (plans).
- **Grading:** must use a control or mix analysis. Wrong: reading only the total (319 → 208 purchases) with no control. The answer must show that the drop is much larger in Monthly (−51%) than in Annual (−5%), whose price did not change; the gap between the plans is the price signal. Also wrong: claiming no effect.

### Q9 — Did the price change pay off in bookings?
- **Prompt:** "Even if we sold fewer monthly plans, did the higher price bring in more monthly bookings?"
- **Type:** external-join
- **Answer:** **No.** Joining Mixpanel purchases to `list_price_usd`, Monthly gross bookings fell from **$2,702 in August (208 × $12.99) to $1,529 in September (102 × $14.99)** while Annual bookings went from $11,099 (111 × $99.99) to $10,599 (106). Relative to Annual, Monthly bookings from Sep 1 are **0.58x** of before: the 15% higher price did not make up for the lost volume. Reading the billing table alone gives the same answer: Monthly $2,624 (202) → $1,559 (104), Annual $11,699 (117) → $10,699 (107), ratio 0.61x. Accept 0.45-0.85 from either source and "did not pay off".
- **Evidence:** H4-monthly-price-change; warehouse `subscription_billing_daily` joined to `subscription purchased` on date and plan; `-- EVAL Q9`.
- **Context needed:** 04-metrics-and-tables.md (billing table and its first-payment caveat), 02-timeline.md.
- **Grading:** must use warehouse prices (price is not on events). Wrong: multiplying all purchases by $14.99; reading the Monthly drop without the Annual control.

### Q10 — Summer Shred CAC
- **Prompt:** "What did a paid social signup cost us during Summer Shred compared with the rest of the period?"
- **Type:** external-join
- **Answer:** Paid social spend per Mixpanel signup was **$20.51 during Summer Shred (Jun 15-Jul 14) vs $9.67 outside it**, about **2.12x**. Spend: $9,434 for 460 signups in the campaign vs $4,873 for 504 signups outside. Paid search ($14.40 vs $15.05) and app-store ads ($6.28 vs $6.40) cost about the same per signup in and out of the campaign. Daily cost per signup swings widely, because spend follows the media plan and the platforms' install counts rather than each day's Mixpanel signups. Accept 1.8x-2.3x.
- **Evidence:** H5-summer-shred-paid-social; warehouse `paid_acquisition_daily.spend_usd` joined to `account created` by date and `acquisition_channel`; `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (campaign dates), 04-metrics-and-tables.md (CAC definition, spend table).
- **Grading:** must divide by Mixpanel signups, not `platform_reported_installs`. Wrong: using platform installs (understates CAC about 8%); comparing total spend only; reading CAC from single days.

### Q11 — Did Summer Shred add new members?
- **Prompt:** "Did Summer Shred actually bring in extra members, or did paid social just take credit for people who would have joined anyway?"
- **Type:** attribution
- **Answer:** **It added real members.** New-member signups ran at **42.0 per day during the campaign vs 31.0 per day** in the rest of the window (**1.36x**), about **331 extra members** over the 30 days. Nearly all of the extra came through paid social: 15.3 vs 5.6 paid-social signups per day (2.7x; share of signups 18.1% → 36.5%). The other channels did not lose volume (combined 1.05x): organic 10.8 vs 10.0 per day, referral 5.3 vs 5.2, paid search 4.6 vs 4.4, app-store ads 6.0 vs 5.7. None of those differences stands out from day-to-day noise (every z ≤ 1.1), so there is no halo and no cannibalization. Extra paid-social spend was about $7,809, or **about $24 per extra member** (higher than the $20.51 average because the campaign also paid double for paid-social members who would have come anyway). Accept a lift of 1.2x-1.5x, 250-450 extra members, and $17-$30 per extra member.
- **Evidence:** H5-summer-shred-paid-social; Insights, `account created`, breakdown `acquisition_channel`, daily or weekly, compare date ranges; warehouse spend for the cost; `-- EVAL Q11`.
- **Context needed:** 02-timeline.md (campaign dates), 04-metrics-and-tables.md (spend table).
- **Grading:** must compare absolute daily volume per channel, not only shares. Wrong: "paid social cannibalized organic" (shares fell, but absolute organic volume did not); reporting only the share shift; ignoring that the paid-social members buy Plus at a much lower rate (see Q12). Outside the campaign, paid social's weekly share of signups moves between about 14% and 22% (for example 14% in the partial first week, Jun 4-7, and 22% in the week of Jul 20); do not read a single week's share as the campaign starting early or running long.

### Q12 — Which channel converts to Plus?
- **Prompt:** "Which acquisition channel brings members who actually pay? Is paid social worth it?"
- **Type:** attribution
- **Answer:** New members from **paid social buy Plus at a much lower rate** than other channels. Counting a purchase at any time after signup (a 120-day conversion window covers the whole dataset): paid social 9.8% vs 21-23% for organic (22.5%), paid search (23.1%), referral (21.2%), and app-store ads (20.5%). With Mixpanel's default 30-day funnel window the rates are lower and the gap is similar: paid social 8.6% vs 20.0% for all other channels. Comparing signups from the same weeks, paid social's purchase rate is **about 0.41x** the other channels'. Spend per paying member: **paid social ≈ $152**, paid search ≈ $64, app-store ads ≈ $31. Paid social is the most expensive way to get a paying member. Accept 0.30x-0.65x, and rates from either window if the answer names it.
- **Evidence:** H5-summer-shred-paid-social; Funnels `account created` → `subscription purchased`, breakdown `acquisition_channel`, uniques, conversion window 120 days (or the default 30 days, which reads lower rates); warehouse spend; `-- EVAL Q12`.
- **Context needed:** 01-business.md (channels), 04-metrics-and-tables.md (cost per paying member).
- **Grading:** must compare paying rates, not signup volume. Bonus for controlling for signup week. Wrong: "paid social is our best channel" because it drove the most signups.

### Q13 — First-week behavior that predicts retention
- **Prompt:** "Is there something new members do in their first week that predicts whether they stick around?"
- **Type:** retention
- **Answer:** **The number of workouts completed in the first 7 days.** Week-4 retention (any activity in days 28-34 after signup) climbs with early workouts: **0 workouts 15.6%**, 1 → 21.0%, 2 → 32.6%, 3 → 41.5%, 4 → 49.0%, **5 → 55.6%, 6 or more 56.1%** (5 and 6+ are small groups of 81 and 114 members). There is no single cliff; each extra early workout up to five helps, and the curve levels off from five. Grouped: 0 → 15.6%, 1-2 → 25.2%, 3-4 → 44.3%, **5+ → 55.9%** (5+ vs 0 ≈ **3.6x**). Split at 3: 48.1% (3+) vs 20.8% (0-2). 80% of new members (of 2,981 who signed up by Aug 27) complete 0-2 workouts in their first week. A Mixpanel cohort version (workouts from the start of the signup week to 7 days after its end) gives the same shape: 15.0%, 21.6%, 38.3%, 47.5%. Accept a rising curve, 5+ vs 0 of 2.5x-4.2x, and rates within ±3 points.
- **Evidence:** H6-first-week-habit; Retention, birth `account created`, return any event, weekly unit, Week 4 bucket, segmented by per-signup-week cohorts on `workout completed` count (approximate first week), members who signed up by 2026-08-27; exact per-member first-week counts need the raw export; `-- EVAL Q13`.
- **Context needed:** 01-business.md (activation goal), 04-metrics-and-tables.md (Week-N retention definition).
- **Grading:** must define the behavior from the first week only and show that more early workouts means better retention. Wrong: using total workouts over the whole window (leaks the outcome into the cohort); claiming a hard threshold with no gain before it. A note that gains stop after about five workouts is correct.

### Q14 — Team vs solo challenges
- **Prompt:** "Do team challenges get finished more often than solo challenges?"
- **Type:** funnel
- **Answer:** Yes. Per challenge (each `challenge_id` counted on its own), for joins from Jun 4 to Aug 31 with a 31-day window (so every challenge has ended): **team challenges complete 56.9%** (7,767 of 13,648) vs **solo 28.3%** (3,764 of 13,309), about **2.0x**. Completions come near the end of each challenge (median 6.0, 12.5, 18.4, and 26.4 days after the join for 7-, 14-, 21-, and 30-day challenges). Weekly completions are flat from the first week (847-958 in every full week, 0.39-0.46 per join), because challenges joined in May still finish in June; the partial first week (Jun 4-7) has 119 completions a day against 121-137 later and 0.44 per join. Accept 54%-63% team and 26%-32% solo, or a ratio of 1.8x-2.2x.
- **Evidence:** H7-team-vs-solo-challenges; Funnels `challenge joined` → `challenge completed`, totals, hold `challenge_id` constant, breakdown `challenge_format`, date range Jun 4 - Aug 31, conversion window 31 days; `-- EVAL Q14`.
- **Context needed:** 03-event-dictionary.md (challenge_id, duration_days, completion at the end), 04-metrics-and-tables.md (completion-rate definition).
- **Grading:** must count per challenge and give challenges time to finish. Wrong: unique-member funnel rates (members join many challenges, so 74.9% of team joiners and 50.5% of solo joiners complete at least one, which hides most of the gap); a short conversion window (a 7-day window misses every 14-30-day challenge); including September joins without comment (49.6% vs 24.7%, because many of those challenges were still running on October 1; the 2x ratio holds). Also wrong: reading a growth trend from weekly challenge completions (they are flat from June). Joins in the partial first week (Jun 4-7) run at about 269 a day, about 89% of the 288-317 a day of later weeks, because the export starts mid-week for members whose activity began before June 4; do not read it as a June ramp in challenge interest.

### Q15 — Too many notifications?
- **Prompt:** "Are we sending too many notifications? Is there a point where people stop opening them?"
- **Type:** segmentation
- **Answer:** Yes. Open rates fall as the number of notifications a member gets rises. By a member's notification count in the window: under 12 → **19.4%**, 12-23 → 17.6%, 24-35 → 15.0%, 36-47 → 11.7%, 48+ → **9.8%**. The driver is recent volume: by how many other notifications the member received in the previous 30 days (notifications from Jul 4, when the 30-day look-back is complete), 0-4 → **19.9%** (a normal rate for fitness-app notifications; 49% of notifications), 5-7 → 16.8%, 8-11 → 12.6%, 12-15 → 8.0%, 16+ → **7.6%** (12+ combined 7.8%). About 13% of notifications go out to members who already had 12 or more in the last 30 days, and 993 members (15% of members with notifications) reached that level at some point. The overall open rate is flat over time (16.3%, 16.7%, 16.5%, 16.4% for June-September), so this is a volume effect, not a calendar trend. Accept: decline begins around 5 notifications in 30 days (or about a dozen in the window per member), settles near 8% (±2 points, or 0.33x-0.45x of the fresh rate) at about 12+ in 30 days, gradual rather than a single step, and no time trend.
- **Evidence:** H8-push-fatigue; Insights, `notification received`, share `opened = true`, broken down by cohorts on notification count; recent-volume read from the raw export or the `-- EVAL Q15` query.
- **Context needed:** 01-business.md (lifecycle goal), 02-timeline.md (caps under review; sending rules unchanged).
- **Grading:** must show that open rate depends on how many notifications a member has received recently (or in total), and give a level where it drops. Wrong: "no effect"; "a hard cutoff at exactly N"; "there is a sweet spot" (the rate only declines); "open rates have been falling since July" or crediting the July 20 org change (the monthly open rate is flat).

### Q16 — Did Fall Reset work?
- **Prompt:** "Did the Fall Reset program actually get people working out more?"
- **Type:** trend
- **Answer:** Yes. During Fall Reset (Sep 8-21) vs the two weeks before, completed workouts rose from 18,650 to 28,190 while meal logging (not part of the program) was flat (11,044 → 11,370): workouts per meal logged rose **1.47x**. App opens rose modestly (16,078 → 19,755; 1.19x relative to meals), so completed workouts per app open rose **1.23x** (1.16 → 1.43). The extra sessions were real training sessions: the share of planned workouts followed by a completed workout within 4 hours (the Workout Loop funnel window) held at **79.1% before and 79.3% during** the program (85.7% and 86.6% within a day), and progress checks per completed workout stayed at 0.64. Accept a workout lift of 1.35x-1.6x against an untouched baseline, app opens up about 1.1x-1.3x, and follow-through unchanged (±3 points).
- **Evidence:** H9-fall-reset-program; Insights, `workout completed`, `app opened`, `meal logged` daily, formulas; Funnels `workout planned` → `workout completed`, totals, 4-hour conversion window (the Workout Loop funnel's), Sep 8-21 vs Aug 25 - Sep 7; `-- EVAL Q16`.
- **Context needed:** 02-timeline.md (program dates).
- **Grading:** must compare against an untouched baseline (meals, or the period before) and separate workouts from app traffic. Wrong: crediting Labor Day; saying only app traffic rose; reporting raw counts without a baseline; claiming the program lowered follow-through (members planned more and completed more in the same proportion).

### Q17 — iOS vs Android onboarding (null)
- **Prompt:** "Do Android users finish onboarding at a lower rate than iOS users?"
- **Type:** null-hypothesis
- **Answer:** **No meaningful difference.** 7-day onboarding completion is **49.7% on Android (1,531 signups) vs 50.8% on iOS (2,516)**. The 1.1-point gap is noise (two-proportion z = −0.67, p ≈ 0.50). Within the test variants the picture is mixed and consistent with chance: Guided Plan 59.3% vs 59.6% (p ≈ 0.92), not enrolled 46.9% vs 43.7% (p ≈ 0.33, Android higher), and Control 41.8% vs 47.1% (p ≈ 0.04). The Control gap is one of three subgroup tests and does not survive a correction for three comparisons (threshold ≈ 0.017); the other two subgroups show no gap or the opposite sign. Platform has no role in onboarding in the product. Accept "no meaningful difference".
- **Evidence:** Funnels onboarding steps, breakdown `Platform`; `-- EVAL Q17`.
- **Context needed:** 03-event-dictionary.md.
- **Grading:** a correct answer says the platforms convert about the same and treats the small gap as noise (ideally with a significance check). Wrong: "yes, Android is lower", including a claim built only on the Control subgroup without a multiple-comparison caveat.

### Q18 — Did the sync incident affect other activity? (null)
- **Prompt:** "During the August sync incident, did the members whose watch or band workouts stopped syncing also log fewer meals or open the app less?"
- **Type:** null-hypothesis
- **Answer:** **No.** Comparing each member's daily rate during the incident with their own rate on the 7 days on each side, smartwatch and fitness-band owners (3,296 active members) vs everyone else (2,732): app opens **0.98x** (z = −0.18, p ≈ 0.86) and meals logged **0.93x** (z = −0.87, p ≈ 0.38), both inside noise. Meals logged per app open across all members were 0.697 during the incident vs 0.686 in the surrounding week (1.02x). App opens for everyone ran 961 per day vs 1,036 on the same weekdays one week before and after, and the incident's Thursday-Saturday total (2,882 opens) sits inside the range of the same three days in the other 13 full weeks (2,868-3,169), so the small dip for everyone is ordinary week-to-week variation. Only wearable-synced workouts were affected. Accept "no meaningful change".
- **Evidence:** `-- EVAL Q18`; Insights, `meal logged` and `app opened`, daily, breakdown user property `wearable_type`, compare Aug 20-22 with Aug 13-19 and Aug 23-29.
- **Context needed:** 02-timeline.md (incident dates), 03-event-dictionary.md (`wearable_type`).
- **Grading:** must check the data and compare the affected members with a control. Wrong: "engagement fell across the board" or "affected members gave up on the app". A significance test on pooled event totals treats every event as independent and overstates the evidence, because heavy users dominate the counts; a member-level comparison is the right test.

### Q19 — Bookings by month
- **Prompt:** "What were our new subscription bookings by month this summer, gross and net of store fees?"
- **Type:** external-join
- **Answer:** From `subscription_billing_daily`: **June (from Jun 4, 27 days) $12,398 gross / $10,538 net** (278 new subscriptions); **July $13,978 / $11,881** (346); **August $14,323 / $12,174** (319); **September $12,258 / $10,419** (211); October 1 only $390 / $331 (9). Net is gross minus the 15% store fee. Per day, new subscriptions ran 10.3 in June, 11.2 in July, 10.3 in August, and 7.0 in September. June has no ramp from zero: its weeks run 9.8-11.3 per day, inside the July-August range (8.4-14.1). August was the strongest month in bookings (more Annual plans) and July in subscription count; September bookings fell about 14% from August (Monthly gross −$1,065 after the price change, Annual −$1,000). The billing counts differ slightly from Mixpanel purchases (278/346/319/211 vs 272/348/319/208) because of settlement timing, failed or refunded first payments, and store-page purchases. Accept within ±1%.
- **Evidence:** warehouse `subscription_billing_daily`; `-- EVAL Q19`.
- **Context needed:** 04-metrics-and-tables.md (billing table, first-payment caveat), 02-timeline.md.
- **Grading:** must use the warehouse table (prices are not in events) and note that June is a partial month (start June 4). Normalized per day, June and August are about level (10.3 per day), July is a little higher (11.2), and the decline starts in September. Credit an answer that links July's subscriptions to more new members buying: Summer Shred sign-ups (new paid-social members bought 40 subscriptions in July vs 8-29 in each other month: 17 in partial June, 29 in August, 8 in September) and the Guided Plan variant from July 1. Wrong: reading the raw June-to-July rise without normalizing for days; multiplying purchases by a single price; using Mixpanel purchase counts as bookings without the warehouse price.

### Q20 — What to worry about in Q4
- **Prompt:** "Looking at this data, what should we worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names most of these, with numbers:
  1. **Paid social quality and cost**: Summer Shred did add members (1.36x daily signups, about 331 extra, about $24 each in extra spend), but paid-social members buy Plus at about 0.4x the rate of same-week signups from other channels, the campaign doubled paid-social cost per signup ($9.67 → $20.51), and a paying member costs about $152 via paid social vs $31-64 elsewhere.
  2. **Monthly price change**: Monthly purchases fell to about 0.50x of the Annual trend after Sep 1 and Monthly bookings relative to Annual fell to about 0.58x; the increase did not pay off so far, and September bookings fell about 14% from August.
  3. **Activation**: 80% of new members do 0-2 workouts in their first week; Week-4 retention climbs from 16% (0 workouts) to 56% (5+). Members who finish onboarding buy Plus about twice as often (26% vs 12%). Ship Guided Plan (1.32x onboarding completion, about 30% faster, and already more buyers per enrolled signup).
  4. **Notification fatigue**: open rates fall from 20% to about 8% once a member has had 12 or more notifications in 30 days, and about 13% of notifications go out at that level. Set a frequency cap.
  5. **Wearable partner reliability**: a 3-day partner incident lost about 73% of watch and band workouts.
  Positive signals to keep: Stride Coach adoption ramped to about 44% of Plus workouts within three weeks and coached sessions run about 20% longer; team challenges finish at 2x the solo rate; Fall Reset lifted workouts about 1.47x against untouched activity without lowering follow-through. Long-time free members convert slowly (about 7.4% bought Plus in the window). Account deactivations are steady (about 8-13 a day in every week from June 4 to October 1), so there is no churn spike or recent improvement to report.
- **Evidence:** H1-H9; `-- EVAL Q20` (headline numbers); deactivation trend in the CHECKS section of `fitness.sql`.
- **Context needed:** all guides.
- **Grading:** full credit for at least four risks with supporting numbers and at least one recommended action. Partial credit for risks without numbers. Wrong: a generic list not grounded in the data; claiming churn fell in September or crediting Fall Reset with fewer deactivations (deactivations per day are 10.3 in June-August and 8.6 in September, inside the week-to-week range).
