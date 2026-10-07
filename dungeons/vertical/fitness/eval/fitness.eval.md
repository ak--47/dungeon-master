# Stridewell (fitness) — 20-question eval

- **Data:** `data/verify-fitness` (full fidelity: 8,976 members with events, 4,001 new-member signups, 1,058,557 events, 2026-06-04 → 2026-10-01 UTC). The USERS file holds 8,985 profiles: 9 pre-existing members have a profile but no events in the window. Member counts in the answers use members with events.
- **Run date:** 2026-10-07 (fourth fix round on engine 352f463: one phone per member with Platform taken from the device os, more app opens, Plus includes one coach session per billing month, notifications keep reaching members who stopped using the app, retention counts member-initiated events only, the sync incident fails syncs in rotation; every number re-measured)
- **Period labels:** "August" and "September" always mean calendar months (Aug 1-31, Sep 1-30). "Before / after the price change" means before Sep 1 / Sep 1 through Oct 1.
- **Active:** "active", "retained", and "returned" mean a member-initiated event: every event except `notification received` and `account deactivated` (the Active action custom event in 04-metrics-and-tables.md).
- **Numbers:** every answer comes from the matching `-- EVAL Q<n>` query in `dungeons/vertical/fitness/fitness.sql` on that data.
- **Stories:** ids refer to the `stories` export in `fitness.js` (H1-H9).
- This file is the answer key. Keep it out of the analyst's context.

---

### Q1 — Did the onboarding test work?
- **Prompt:** "We've been running the Guided First Week onboarding test since July. Is the Guided Plan variant actually better? By how much?"
- **Type:** funnel
- **Answer:** Yes, for onboarding. 7-day onboarding completion (account created → goal quiz completed → plan generated → starter workout completed): **Guided Plan 60.6%** (917 of 1,512) vs **Control 46.8%** (682 of 1,458), a **relative lift of about 1.30x** (+13.9 points). Accept 1.17x-1.43x and rates within ±1.5 points. Finishing onboarding goes with buying: across all new members, 21.3% of those who finish buy Plus vs 10.5% of those who do not (non-finishers also log about half as many workouts: 2.9 vs 5.6). The test has not yet moved Plus purchases per enrolled signup: Guided Plan 14.2% vs Control 14.3% (0.99x, z ≈ −0.09). The completion lift is clear; a purchase lift, if there is one, is too small to see with about 1,500 signups per arm and many members still early in their life.
- **Evidence:** H1-guided-first-week; Funnels report with the four onboarding steps, 7-day window, breakdown by user property `Experiment: Guided First Week`; `-- EVAL Q1`.
- **Context needed:** 02-timeline.md (test start and enrollment), 03-event-dictionary.md (onboarding events, experiment property).
- **Grading:** must restrict to enrolled members (signups from 2026-07-01) and compare variants on the same funnel. Wrong answers: comparing all new members before vs after July 1; counting `workout completed` instead of `starter workout completed`; reporting the lift as absolute points only without the rates; claiming members who skip onboarding never buy (10.5% of them do); claiming the test already lifted Plus purchases (buyers per enrolled signup are equal so far). Credit an answer that recommends shipping on the completion lift while it keeps measuring purchases.

### Q2 — Is onboarding faster in the new variant?
- **Prompt:** "For people who finish onboarding, how long does it take in each variant of the Guided First Week test?"
- **Type:** funnel
- **Answer:** Median time from signup to starter workout: **Guided Plan ≈ 12.6 hours vs Control ≈ 17.8 hours**, about **0.71x** the control time (about 29% faster). Accept 0.63x-0.77x.
- **Evidence:** H1-guided-first-week; Funnels time-to-convert, same steps, breakdown by variant; `-- EVAL Q2`.
- **Context needed:** 03-event-dictionary.md.
- **Grading:** must use medians (or say the mean shows the same direction) on converters only. Wrong: computing time to `workout completed`.

### Q3 — Stride Coach and workout length
- **Prompt:** "What happened to workout duration after we launched Stride Coach?"
- **Type:** trend
- **Answer:** After the 2026-08-12 launch, workouts by members with Plus features (`subscription_tier` monthly, annual, or trial) done with Stride Coach (`coaching_mode = ai_coach`) average **49.6 minutes vs 41.3 minutes** for self-guided ones, about **1.20x longer**. Self-guided Plus workouts did not change (41.6 min before launch, 41.3 after). Free workouts are all self-guided. Accept 1.12x-1.28x.
- **Evidence:** H2-stride-coach-launch; Insights, `workout completed`, average `duration_minutes`, breakdown `coaching_mode`, filter `subscription_tier` ≠ free; `-- EVAL Q3`.
- **Context needed:** 02-timeline.md (launch date, Plus and trial), 01-business.md, 03-event-dictionary.md (`subscription_tier` values).
- **Grading:** must separate AI-coached from self-guided workouts and restrict to members with Plus features. Wrong: comparing all workouts before vs after launch (41.5 → 42.5 minutes, about 1.02x, because it mixes in self-guided and free workouts and the adoption ramp).

### Q4 — Stride Coach adoption
- **Prompt:** "What share of Plus workouts use Stride Coach since it launched? Is adoption growing?"
- **Type:** segmentation
- **Answer:** Adoption **ramped for about three weeks, then leveled off near 43-45%**. Weekly share of completed workouts by members with Plus features that use Stride Coach: 20.1% in the launch week (week of Aug 10, from Wednesday Aug 12), 27.7%, 36.1%, 43.1%, then 43.2%-45.3% every week in September. Since launch overall: 39.2%; from Sep 2: 43.8%. Use varies by member: among the 649 Plus members with 10+ workouts since Sep 2, 40.8% never use Stride Coach, 6.8% use it for under half of their workouts (1.4% under 25%, 5.4% for 25-49%), 18.0% for 50-74%, and 34.4% for 75% or more. Accept a ramp that plateaus at 40%-48%, and a note that about 40% of Plus members do not use it while users vary in how much they use it.
- **Evidence:** H2-stride-coach-launch; Insights, `workout completed`, filter `subscription_tier` ≠ free and after launch, breakdown `coaching_mode`, weekly; per-member split needs a breakdown by user or the raw export; `-- EVAL Q4`.
- **Context needed:** 02-timeline.md, 04-metrics-and-tables.md (adoption definition).
- **Grading:** denominator is workouts by members with Plus features, not all workouts. Wrong: share of all workouts (much lower); "still growing steadily" (it plateaued in September); "every Plus member uses it a little" (about 40% never use it, and most users use it for half or more of their workouts).

### Q5 — Do Stride Coach workouts push people harder? (null)
- **Prompt:** "Stride Coach sessions run longer. Are people also working harder in them — higher heart rate or effort?"
- **Type:** null-hypothesis
- **Answer:** **No meaningful difference in intensity.** Plus workouts after launch: average heart rate **125.5 vs 126.0 bpm** (ai_coach vs self-guided); perceived effort 6.03 vs 6.01; calories per minute 8.09 vs 8.07. Stride Coach sessions burn more total calories only because they last longer (401.5 vs 332.8 calories per workout, about the same 1.2x as duration). Accept any answer that says intensity did not change (heart rate and effort within ±2%).
- **Evidence:** Insights, `workout completed`, average `avg_heart_rate` and `perceived_effort` (and calories ÷ minutes), breakdown `coaching_mode`, Plus and after launch; `-- EVAL Q5`.
- **Context needed:** 03-event-dictionary.md.
- **Grading:** must check intensity directly, not infer it from total calories. Wrong: "yes, they burn about 20% more calories, so they are harder workouts" (the extra calories come from the extra minutes).

### Q6 — The late-August dip
- **Prompt:** "Workout logging looks like it dropped for a few days in late August. What happened and how big was it?"
- **Type:** external-join
- **Answer:** The **2026-08-20 to 2026-08-22 wearable sync incident** at the health-data partner. On those three days (Thursday to Saturday), wearable-tracked smartwatch and fitness-band workouts fell to about **119 per day, from about 455 per day** on the same weekdays one week before and after, while all other workouts (phone, manual, chest strap) held (562 vs 554 per day). Against the full 7 days on each side, unaffected workouts read 562 vs 644 per day mostly because Friday and Saturday are quiet days. Size, three equivalent reads: (a) watch and band owners' wearable-tracked workouts per planned workout fell from 0.631 to 0.167, **about 26% of normal** (0.264; planning is untouched, so the same members are their own control); (b) relative to all unaffected workouts, watch and band workouts ran at **about 25%** of normal (0.250 ratio of ratios vs the 7 days on each side); (c) the most obvious breakdown, `workout completed` by user `wearable_type` only (no `tracking_source` filter), shows watch and band owners' workouts at **about 38%** of normal against other members' (0.381), a drop of about 62%; that read is diluted because watch and band owners also log some workouts with the phone, and those kept syncing. The warehouse table `wearable_sync_daily` shows `sync_error_rate` 0.73-0.77 and `partner_api_status = major_outage` on exactly those days. Workouts that failed to sync are missing from Mixpanel. Accept 0.20-0.32 for reads (a) and (b), and 0.30-0.47 for read (c).
- **Evidence:** H3-wearable-sync-outage; Insights daily `workout completed` by `tracking_source` and `wearable_type` (and `workout planned` by user `wearable_type` for the per-plan formula); warehouse join on date and `wearable_type`; `-- EVAL Q6`.
- **Context needed:** 02-timeline.md (incident dates), 04-metrics-and-tables.md (`wearable_sync_daily`).
- **Grading:** must name the incident, the dates, the device scope, and a size. Any of the three sizes is correct; the analyst does not need to name its scope, but an answer that presents the 38% read as "the share of wearable-synced workouts that got through" without noting phone-tracked workouts are mixed in loses a little credit. Wrong: blaming the dip on members working out less (unaffected workouts held at the same weekdays' level, and planned workouts did not drop), or on the Stride Coach launch.

### Q7 — Which devices were hit?
- **Prompt:** "Was the August sync incident only smartwatches, or did it hit other trackers too?"
- **Type:** external-join
- **Answer:** **Smartwatches and fitness bands** were hit: during the incident their wearable-tracked workouts ran at 0.26x (smartwatch) and 0.23x (fitness band) of their normal level relative to phone workouts. **Chest straps** (1.01x) and **manual entries** (0.95x) were not hit. Broken down by user `wearable_type` only (all workouts by each device's owners, against members with no wearable): smartwatch owners 0.40x, fitness-band owners 0.35x, chest-strap owners 1.02x. The warehouse agrees: `major_outage` with a 0.73-0.77 error rate for smartwatch and fitness_band only; chest_strap stayed `operational` (≈0.9% errors). Accept 0.15-0.35 for affected devices with a `tracking_source = wearable` filter, 0.28-0.48 for affected device owners with the `wearable_type`-only breakdown, and 0.85-1.2 for unaffected trackers either way.
- **Evidence:** H3-wearable-sync-outage; `-- EVAL Q7`.
- **Context needed:** 04-metrics-and-tables.md (`wearable_sync_daily`), 03-event-dictionary.md (`tracking_source`, `wearable_type`).
- **Grading:** must separate chest straps from watches and bands. The device ranking is the same with or without a `tracking_source = wearable` filter; only the size of the drop differs, and both sizes are correct. Wrong: "all wearables".

### Q8 — Did the price change hurt sign-ups?
- **Prompt:** "Did the September Plus Monthly price increase hurt new subscriptions?"
- **Type:** trend
- **Answer:** **Yes, for Monthly.** Annual (whose price did not change) is the control. Monthly purchases per Annual purchase fell from **2.03 before Sep 1 to 1.27 after**, a ratio of **0.63** (about a third fewer Monthly purchases than the Annual trend predicts). August vs September (calendar months): Monthly 191 → 111 (−42%) while Annual 84 → 84 (unchanged); Monthly share of new subscriptions 69.5% → 56.9%. Accept a ratio of 0.45-0.8 (the post-change period holds about 200 purchases, so the ratio is noisy).
- **Evidence:** H4-monthly-price-change; Insights, `subscription purchased`, breakdown `plan`, weekly; `-- EVAL Q8`.
- **Context needed:** 02-timeline.md (price change), 01-business.md (plans).
- **Grading:** must use a control or mix analysis. Wrong: reading only the total (275 → 195 purchases) with no control. The answer must show that the drop is concentrated in Monthly (−42%) while Annual, whose price did not change, held; the gap between the plans is the price signal. Also wrong: claiming no effect.

### Q9 — Did the price change pay off in bookings?
- **Prompt:** "Even if we sold fewer monthly plans, did the higher price bring in more monthly bookings?"
- **Type:** external-join
- **Answer:** **No.** Joining Mixpanel purchases to `list_price_usd`, Monthly gross bookings fell from **$2,481 in August (191 × $12.99) to $1,664 in September (111 × $14.99)** while Annual bookings held at $8,399 (84 × $99.99) in both months. Relative to Annual, Monthly bookings from Sep 1 are **0.72x** of before: the 15% higher price did not make up for the lost volume. Reading the billing table alone gives the same answer: Monthly $2,468 (190) → $1,739 (116), Annual $9,199 (92) → $8,599 (86), ratio 0.78x. Accept 0.55-0.9 from either source and "did not pay off".
- **Evidence:** H4-monthly-price-change; warehouse `subscription_billing_daily` joined to `subscription purchased` on date and plan; `-- EVAL Q9`.
- **Context needed:** 04-metrics-and-tables.md (billing table and its first-payment caveat), 02-timeline.md.
- **Grading:** must use warehouse prices (price is not on events). Wrong: multiplying all purchases by $14.99; reading the Monthly drop without the Annual control.

### Q10 — Summer Shred CAC
- **Prompt:** "What did a paid social signup cost us during Summer Shred compared with the rest of the period?"
- **Type:** external-join
- **Answer:** Paid social spend per Mixpanel signup was **$19.78 during Summer Shred (Jun 15-Jul 14) vs $9.73 outside it**, about **2.03x**. Spend: $9,434 for 477 signups in the campaign vs $4,873 for 501 signups outside. Paid search ($14.94 vs $14.15) and app-store ads ($6.80 vs $7.16) cost about the same per signup in and out of the campaign. Daily cost per signup swings widely, because spend follows the media plan and the platforms' install counts rather than each day's Mixpanel signups. Accept 1.8x-2.3x.
- **Evidence:** H5-summer-shred-paid-social; warehouse `paid_acquisition_daily.spend_usd` joined to `account created` by date and `acquisition_channel`; `-- EVAL Q10`.
- **Context needed:** 02-timeline.md (campaign dates), 04-metrics-and-tables.md (CAC definition, spend table).
- **Grading:** must divide by Mixpanel signups, not `platform_reported_installs`. Wrong: using platform installs (understates CAC about 8%); comparing total spend only; reading CAC from single days.

### Q11 — Did Summer Shred add new members?
- **Prompt:** "Did Summer Shred actually bring in extra members, or did paid social just take credit for people who would have joined anyway?"
- **Type:** attribution
- **Answer:** **It added real members.** New-member signups ran at **40.9 per day during the campaign vs 30.8 per day** in the rest of the window (**1.33x**), about **304 extra members** over the 30 days. Nearly all of the extra came through paid social: 15.9 vs 5.6 paid-social signups per day (2.9x; share of signups 18.1% → 38.8%). The other channels did not lose volume (combined 0.99x): organic 10.1 vs 10.1 per day, referral 4.9 vs 5.4, paid search 4.4 vs 4.7, app-store ads 5.5 vs 5.1. None of those differences stands out from day-to-day noise (every |z| ≤ 0.94), so there is no halo and no cannibalization. Extra paid-social spend was about $7,809, or **about $26 per extra member** (higher than the $19.78 average because the campaign also paid double for paid-social members who would have come anyway). Accept a lift of 1.2x-1.5x, 230-420 extra members, and $18-$35 per extra member.
- **Evidence:** H5-summer-shred-paid-social; Insights, `account created`, breakdown `acquisition_channel`, daily or weekly, compare date ranges; warehouse spend for the cost; `-- EVAL Q11`.
- **Context needed:** 02-timeline.md (campaign dates), 04-metrics-and-tables.md (spend table).
- **Grading:** must compare absolute daily volume per channel, not only shares. Wrong: "paid social cannibalized organic" (shares fell, but absolute organic volume did not); reporting only the share shift; ignoring that the paid-social members buy Plus at a lower rate (see Q12). Outside the campaign, paid social's weekly share of signups moves around by several points; do not read a single week's share as the campaign starting early or running long.

### Q12 — Which channel converts to Plus?
- **Prompt:** "Which acquisition channel brings members who actually pay? Is paid social worth it?"
- **Type:** attribution
- **Answer:** New members from **paid social buy Plus at a lower rate** than other channels. Counting a purchase at any time after signup (a 120-day conversion window covers the whole dataset): paid social 11.4% vs 16-18% for organic (17.9%), referral (18.0%), app-store ads (17.4%), and paid search (16.1%). With Mixpanel's default 30-day funnel window the rates are lower and the gap is similar: paid social 9.8% vs 15.6% for all other channels. Comparing signups from the same weeks, paid social's purchase rate is **about 0.61x** the other channels'. Spend per paying member: **paid social ≈ $129**, paid search ≈ $89, app-store ads ≈ $41. Paid social is the most expensive way to get a paying member. Accept 0.40x-0.75x, and rates from either window if the answer names it.
- **Evidence:** H5-summer-shred-paid-social; Funnels `account created` → `subscription purchased`, breakdown `acquisition_channel`, uniques, conversion window 120 days (or the default 30 days, which reads lower rates); warehouse spend; `-- EVAL Q12`.
- **Context needed:** 01-business.md (channels), 04-metrics-and-tables.md (cost per paying member).
- **Grading:** must compare paying rates, not signup volume. Bonus for controlling for signup week. Wrong: "paid social is our best channel" because it drove the most signups.

### Q13 — First-week behavior that predicts retention
- **Prompt:** "Is there something new members do in their first week that predicts whether they stick around?"
- **Type:** retention
- **Answer:** **The number of workouts completed in the first 7 days.** Week-4 retention (any active event, as defined in 04-metrics-and-tables.md, in days 28-34 after signup) climbs with early workouts: **0 workouts 13.8%**, 1 → 19.1%, 2 → 31.8%, 3 → 38.3%, 4 → 41.7%, **5 → 53.7%, 6 or more 59.0%** (5 and 6+ are small groups of 67 and 95 members). There is no single cliff; each extra early workout helps. Grouped: 0 → 13.8%, 1-2 → 23.4%, 3-4 → 39.6%, **5+ → 56.8%** (5+ vs 0 ≈ **4.1x**). Split at 3: 45.1% (3+) vs 18.8% (0-2). Overall Week-4 retention is 23.3%, and 82.9% of new members (of 2,946 who signed up by Aug 27) complete 0-2 workouts in their first week. A Mixpanel cohort version (workouts from the start of the signup week to 7 days after its end) gives the same shape: 13.5%, 20.4%, 32.3%, 48.1%. Accept a rising curve, 5+ vs 0 of 3.0x-5.0x, and rates within ±3 points.
- **Evidence:** H6-first-week-habit; Retention, birth `account created`, return the Active action custom event, weekly unit, Week 4 bucket, segmented by per-signup-week cohorts on `workout completed` count (approximate first week), members who signed up by 2026-08-27; exact per-member first-week counts need the raw export; `-- EVAL Q13`.
- **Context needed:** 01-business.md (activation goal), 04-metrics-and-tables.md (Week-N retention and active definitions).
- **Grading:** must define the behavior from the first week only and show that more early workouts means better retention. Partial credit for a return event of "any event": notifications keep arriving after members stop using the app, so every bucket reads higher (24.7% for 0 early workouts) and the 5+ vs 0 ratio shrinks to about 2.7x; the direction is right but the definition is wrong. Wrong: using total workouts over the whole window (leaks the outcome into the cohort); claiming a hard threshold with no gain before it.

### Q14 — Team vs solo challenges
- **Prompt:** "Do team challenges get finished more often than solo challenges?"
- **Type:** funnel
- **Answer:** Yes. Per challenge (each `challenge_id` counted on its own), for joins from Jun 4 to Aug 31 with a 31-day window (so every challenge has ended): **team challenges complete 56.6%** (6,844 of 12,087) vs **solo 27.9%** (3,422 of 12,267), about **2.0x**. Completions come near the end of each challenge (median 6.0, 12.5, 18.5, and 26.4 days after the join for 7-, 14-, 21-, and 30-day challenges). Weekly completions are flat from the first week (753-857 in every full week, 0.39-0.45 per join), because challenges joined in May still finish in June; the partial first week (Jun 4-7) has 112 completions a day against 108-122 later and 0.46 per join. Accept 54%-63% team and 25%-32% solo, or a ratio of 1.8x-2.2x.
- **Evidence:** H7-team-vs-solo-challenges; Funnels `challenge joined` → `challenge completed`, totals, hold `challenge_id` constant, breakdown `challenge_format`, date range Jun 4 - Aug 31, conversion window 31 days; `-- EVAL Q14`.
- **Context needed:** 03-event-dictionary.md (challenge_id, duration_days, completion at the end), 04-metrics-and-tables.md (completion-rate definition).
- **Grading:** must count per challenge and give challenges time to finish. Wrong: unique-member funnel rates (members join many challenges, so 73.2% of team joiners and 48.5% of solo joiners complete at least one, which hides most of the gap); a short conversion window (a 7-day window misses every 14-30-day challenge); including September joins without comment (49.1% vs 24.0%, because many of those challenges were still running on October 1; the 2x ratio holds). Also wrong: reading a growth trend from weekly challenge completions (they are flat from June). Joins in the partial first week (Jun 4-7, Thursday to Sunday) run at about 244 a day, about 89% of the 261-291 a day of later weeks, because Friday and Saturday are quiet days; do not read it as a June ramp in challenge interest.

### Q15 — Too many notifications?
- **Prompt:** "Are we sending too many notifications? Is there a point where people stop opening them?"
- **Type:** segmentation
- **Answer:** Yes. Open rates fall as the number of notifications a member gets rises, once members who have stopped using the app are set aside. New members who stop using the app keep receiving notifications (they go out while the account is open) and almost never open them: 0.3% of new members' notifications after their last active event are opened, vs 18.0% before. Among members who joined before June 4 (who do not drop out in the window), by notification count in the window: under 12 → **19.6%**, 12-23 → 18.0%, 24-35 → 14.2%, 36-47 → 12.2%, 48+ → **9.6%**. The driver is recent volume: by how many other notifications the member received in the previous 30 days (notifications from Jul 4, when the 30-day look-back is complete), 0-4 → **20.0%** (a normal rate for fitness-app notifications; 49% of notifications), 5-7 → 17.3%, 8-11 → 12.5%, 12-15 → 7.2%, 16+ → **8.8%** (12+ combined 7.75%). About 12% of notifications go out to members who already had 12 or more in the last 30 days, and 822 members (17% of pre-window members with notifications) reached that level at some point. Their open rate is flat over time (16.5%, 16.2%, 16.6%, 17.1% for June-September), so this is a volume effect, not a calendar trend. Over all members the same breakdown reads 15.7%, 16.6%, 13.9%, 12.1%, 9.6% (the lowest-count group is pulled down by members who stopped using the app), and the monthly open rate drifts from 16.5% to 14.6%, also because unopened notifications to lapsed members pile up. Accept: decline begins around 5 notifications in 30 days (or about a dozen in the window per member), settles near 8% (±2 points, or 0.33x-0.45x of the fresh rate) at about 12+ in 30 days, gradual rather than a single step, and no time trend among active members.
- **Evidence:** H8-push-fatigue; Insights, `notification received`, share `opened = true`, filter cohort "did not do account created in the window" (or excluding members who stopped using the app), broken down by cohorts on notification count; recent-volume read from the raw export or the `-- EVAL Q15` query.
- **Context needed:** 01-business.md (lifecycle goal), 02-timeline.md (caps under review; sending rules unchanged), 03-event-dictionary.md (notifications are server-side and continue while the account is open).
- **Grading:** must show that open rate depends on how many notifications a member has received recently (or in total), and give a level where it drops. Full credit requires separating out members who stopped using the app (or members who joined in the window), or explaining why the all-member lowest-count group reads low. Wrong: "no effect"; "a hard cutoff at exactly N"; "there is a sweet spot around 12-23 notifications" (that bump in the all-member read comes from lapsed new members in the lowest group); "open rates have been falling since July" or crediting the July 20 org change (the drift comes from lapsed members; active members' rate is flat).

### Q16 — Did Fall Reset work?
- **Prompt:** "Did the Fall Reset program actually get people working out more?"
- **Type:** trend
- **Answer:** Yes. During Fall Reset (Sep 8-21) vs the two weeks before, completed workouts rose from 16,321 to 25,205 while meal logging (not part of the program) rose only a little (8,698 → 9,255): workouts per meal logged rose **1.45x**. App opens rose modestly (26,723 → 33,824; 1.19x relative to meals), so completed workouts per app open rose **1.22x** (0.611 → 0.745). The extra sessions were real training sessions: the share of planned workouts followed by a completed workout within 4 hours (the Workout Loop funnel window) held at **78.3% before and 79.2% during** the program (84.7% and 86.0% within a day), and progress checks per completed workout stayed at 0.64-0.65. Accept a workout lift of 1.35x-1.6x against an untouched baseline, app opens up about 1.1x-1.3x, and follow-through unchanged (±3 points).
- **Evidence:** H9-fall-reset-program; Insights, `workout completed`, `app opened`, `meal logged` daily, formulas; Funnels `workout planned` → `workout completed`, totals, 4-hour conversion window (the Workout Loop funnel's), Sep 8-21 vs Aug 25 - Sep 7; `-- EVAL Q16`.
- **Context needed:** 02-timeline.md (program dates).
- **Grading:** must compare against an untouched baseline (meals, or the period before) and separate workouts from app traffic. Wrong: crediting Labor Day; saying only app traffic rose; reporting raw counts without a baseline; claiming the program lowered follow-through (members planned more and completed more in the same proportion).

### Q17 — iOS vs Android onboarding (null)
- **Prompt:** "Do Android users finish onboarding at a lower rate than iOS users?"
- **Type:** null-hypothesis
- **Answer:** **No difference.** 7-day onboarding completion is **50.9% on Android (2,173 signups) vs 50.9% on iOS (1,828)** (two-proportion z = 0.01, p ≈ 0.99). The null also holds inside every group: Control 46.7% vs 46.9% (p ≈ 0.96), Guided Plan 60.1% vs 61.3% (p ≈ 0.65), not enrolled 42.9% vs 42.2% (p ≈ 0.81). `Platform` and `os` agree on every event (iPhone and iPad are `ios`), so a breakdown by either gives the same answer. Accept "no meaningful difference".
- **Evidence:** Funnels onboarding steps, breakdown `Platform` (or `os`); `-- EVAL Q17`.
- **Context needed:** 03-event-dictionary.md.
- **Grading:** a correct answer says the platforms convert the same, ideally with a significance check or the variant split. Wrong: "yes, Android is lower".

### Q18 — Did the sync incident affect other activity? (null)
- **Prompt:** "During the August sync incident, did the members whose watch or band workouts stopped syncing also log fewer meals or open the app less?"
- **Type:** null-hypothesis
- **Answer:** **No.** Comparing each member's daily rate during the incident with their own rate on the 7 days on each side, smartwatch and fitness-band owners (3,439 active members) vs everyone else (2,858): app opens **0.91x** (z = −1.03, p ≈ 0.31) and meals logged **0.95x** (z = −0.51, p ≈ 0.61), both inside noise. Meals logged per app open across all members were 0.322 during the incident and 0.322 in the surrounding week (1.00x). App opens for everyone ran 1,580 per day vs 1,718 on the same weekdays one week before and after, and the incident's Thursday-Saturday total (4,740 opens) sits inside the range of the same three days in the other 13 full weeks (4,725-5,823), so the small dip for everyone is ordinary week-to-week variation. Only wearable-synced workouts were affected. Accept "no meaningful change".
- **Evidence:** `-- EVAL Q18`; Insights, `meal logged` and `app opened`, daily, breakdown user property `wearable_type`, compare Aug 20-22 with Aug 13-19 and Aug 23-29.
- **Context needed:** 02-timeline.md (incident dates), 03-event-dictionary.md (`wearable_type`).
- **Grading:** must check the data and compare the affected members with a control. Wrong: "engagement fell across the board" or "affected members gave up on the app". A significance test on pooled event totals treats every event as independent and overstates the evidence, because heavy users dominate the counts; a member-level comparison is the right test.

### Q19 — Bookings by month
- **Prompt:** "What were our new subscription bookings by month this summer, gross and net of store fees?"
- **Type:** external-join
- **Answer:** From `subscription_billing_daily`: **June (from Jun 4, 27 days) $11,729 gross / $9,970 net** (260 new subscriptions); **July $12,032 / $10,227** (290); **August $11,667 / $9,917** (282); **September $10,338 / $8,787** (202); October 1 only $315 / $268 (4). Net is gross minus the 15% store fee. Per day, new subscriptions ran 9.6 in June, 9.4 in July, 9.1 in August, and 6.7 in September. June has no ramp from zero: its weeks run 8.8-11.1 per day, inside or just above the July-August range (7.7-10.1). July was the strongest month in bookings and subscription count; September bookings fell about 11% from August (Monthly gross −$729 after the price change, Annual −$600). The billing counts differ slightly from Mixpanel purchases (260/290/282/202 vs 255/289/275/195) because of settlement timing, failed or refunded first payments, and store-page purchases. Accept within ±1%.
- **Evidence:** warehouse `subscription_billing_daily`; `-- EVAL Q19`.
- **Context needed:** 04-metrics-and-tables.md (billing table, first-payment caveat), 02-timeline.md.
- **Grading:** must use the warehouse table (prices are not in events) and note that June is a partial month (start June 4). Normalized per day, June through August are about level (9.1-9.6 per day) and the decline starts in September. Credit an answer that explains the mix behind the flat summer: purchases by members who joined before June 4 fall from 152 in June to 96 in July and 78 in August (early June includes members who joined shortly before June 4 and converted from their trial), while purchases by new members grow as the new cohorts build (103 in June, 193 in July, 197 in August; new paid-social members bought 48 in July during Summer Shred vs 19-23 in other full months). Wrong: reading the raw June-to-July rise without normalizing for days; multiplying purchases by a single price; using Mixpanel purchase counts as bookings without the warehouse price.

### Q20 — What to worry about in Q4
- **Prompt:** "Looking at this data, what should we worry about going into Q4?"
- **Type:** open-ended
- **Answer:** A strong answer names most of these, with numbers:
  1. **Paid social quality and cost**: Summer Shred did add members (1.33x daily signups, about 304 extra, about $26 each in extra spend), but paid-social members buy Plus at about 0.6x the rate of same-week signups from other channels, the campaign doubled paid-social cost per signup ($9.73 → $19.78), and a paying member costs about $129 via paid social vs $41-89 elsewhere.
  2. **Monthly price change**: Monthly purchases fell to about 0.63x of the Annual trend after Sep 1 and Monthly bookings relative to Annual fell to about 0.72x; the increase did not pay off so far, and September bookings fell about 11% from August.
  3. **Activation**: 83% of new members do 0-2 workouts in their first week; Week-4 retention climbs from 14% (0 workouts) to 57% (5+). Members who finish onboarding buy Plus about twice as often (21% vs 10.5%). Ship Guided Plan (1.30x onboarding completion, about 29% faster), and keep measuring whether it lifts purchases (no difference yet).
  4. **Notification fatigue**: among active members, open rates fall from 20% to about 8% once a member has had 12 or more notifications in 30 days, and about 12% of notifications go out at that level. Messages also keep going to members who stopped using the app, unopened. Set a frequency cap.
  5. **Wearable partner reliability**: a 3-day partner incident lost about three quarters of watch and band workouts.
  Positive signals to keep: Stride Coach adoption ramped to about 44% of Plus workouts within three weeks and coached sessions run about 20% longer; team challenges finish at 2x the solo rate; Fall Reset lifted workouts about 1.45x against untouched activity without lowering follow-through. Long-time free members convert slowly (about 7.6% bought Plus in the window). Account deactivations are steady (about 7-11 a day in every week from June 4 to October 1), so there is no churn spike or recent improvement to report.
- **Evidence:** H1-H9; `-- EVAL Q20` (headline numbers); deactivation trend in the CHECKS section of `fitness.sql`.
- **Context needed:** all guides.
- **Grading:** full credit for at least four risks with supporting numbers and at least one recommended action. Partial credit for risks without numbers. Wrong: a generic list not grounded in the data; claiming churn fell in September or crediting Fall Reset with fewer deactivations (deactivations per day are 9.4 in June-August and 8.7 in September, inside the week-to-week range); reading the all-member notification open-rate drift as worsening engagement.
